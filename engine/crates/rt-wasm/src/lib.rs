//! WebAssembly build of the Repackshot engine.
//!
//! The interface is a plain C ABI written by hand (no `wasm-bindgen`): the host (JavaScript in a
//! Web Worker) copies bytes into memory obtained from `rt_alloc`, hands a pointer to
//! `rt_scene_load`, and reads rendered tiles back from a buffer it allocated itself.
//!
//! This file holds the safe logic: the scene registry and the tile renderer. The raw-pointer
//! shims live in [`ffi`], the only module of the engine allowed to use `unsafe`.
//!
//! **Threading.** A wasm instance is single threaded: the host gives each Web Worker its own
//! instance with its own registry. The registry is still protected by a `Mutex` so that the same
//! code is sound when `cargo test` drives it from several threads on the host target.

#![deny(unsafe_code)]

use rt_core::caustics::PhotonMap;
use rt_core::image::Film;
use rt_core::integrator::Prepared;
use rt_core::passes::{PassFilm, PASS_ALBEDO, PASS_EXACT};
use rt_core::render::{render_tile_albedo, render_tile_exact, render_tile_photons, TileRect};
use rt_core::scene::Scene;
use rt_core::simd::Isa;
use rt_post::denoise::{denoise_rows, DenoiseInput};
use std::sync::{Mutex, MutexGuard, PoisonError};

pub mod ffi;
pub mod phys;

/// Status returned by `rt_render_tile`: success.
pub const STATUS_OK: u32 = 0;
/// Status returned by `rt_render_tile` and `rt_scene_free`: the handle is not a loaded scene.
pub const STATUS_BAD_HANDLE: u32 = 1;
/// Status returned by `rt_render_tile`: empty tile or more than [`MAX_TILE_PIXELS`] pixels.
pub const STATUS_BAD_TILE: u32 = 2;
/// Status returned by `rt_render_tile` and `rt_scene_update`: a pointer is null.
pub const STATUS_NULL_POINTER: u32 = 3;
/// Status returned by `rt_scene_update`: the bytes are not a valid RSB update (the message is
/// the last load error); the scene is unchanged.
pub const STATUS_BAD_SCENE: u32 = 4;

/// Status returned by `rt_denoise`: the image, the band or the rows do not fit together.
pub const STATUS_BAD_DENOISE: u32 = 5;

/// Largest tile (in pixels) `rt_render_tile` accepts: 2048 x 2048.
pub const MAX_TILE_PIXELS: u64 = 1 << 22;

/// Photon maps a scene keeps (E5b-1): the samples of one pass of the host (at most 16), so a
/// worker that renders its tiles one after another, each with all the pass's samples, traces each
/// map once.
pub const KEPT_PHOTON_MAPS: usize = 16;

/// A loaded scene with its lights prepared once for every tile rendered from it, and the photon
/// maps of its last samples when it has caustics.
struct Loaded {
    scene: Scene,
    prepared: Prepared,
    maps: Vec<PhotonMap>,
}

impl Loaded {
    fn new(scene: Scene) -> Loaded {
        let prepared = Prepared::new(&scene);
        Loaded {
            scene,
            prepared,
            maps: Vec::new(),
        }
    }

    /// The photon map of `sample` (traced now if it is not kept), or `None` without caustics.
    /// The map is the same bits whoever traces it, so every worker's tiles agree.
    fn photon_map(&mut self, sample: u32) -> Option<usize> {
        if !self.prepared.has_caustics() {
            return None;
        }
        if let Some(i) = self.maps.iter().position(|m| m.iteration() == sample) {
            return Some(i);
        }
        if self.maps.len() >= KEPT_PHOTON_MAPS {
            self.maps.remove(0);
        }
        self.maps.push(PhotonMap::trace(
            &self.scene,
            &self.prepared,
            sample,
            Isa::detect(),
        ));
        Some(self.maps.len() - 1)
    }
}

/// Loaded scenes and the last load error.
struct Registry {
    /// Slot `i` holds the scene with handle `i + 1`; freed slots are reused.
    scenes: Vec<Option<Loaded>>,
    /// Message of the last failed `rt_scene_load`; empty after a successful load.
    error: String,
}

static REGISTRY: Mutex<Registry> = Mutex::new(Registry {
    scenes: Vec::new(),
    error: String::new(),
});

fn registry() -> MutexGuard<'static, Registry> {
    // The registry holds plain data; a panic elsewhere cannot leave it half updated.
    REGISTRY.lock().unwrap_or_else(PoisonError::into_inner)
}

/// Parses `bytes` as an RSB scene and registers it. Returns its handle, or 0 after recording the
/// error (see [`error_message`]).
pub fn scene_load(bytes: &[u8]) -> u32 {
    let mut reg = registry();
    match Scene::from_rsb(bytes) {
        Ok(scene) => {
            reg.error.clear();
            let slot = match reg.scenes.iter().position(Option::is_none) {
                Some(free) => free,
                None => {
                    reg.scenes.push(None);
                    reg.scenes.len() - 1
                }
            };
            reg.scenes[slot] = Some(Loaded::new(scene));
            slot as u32 + 1
        }
        Err(error) => {
            reg.error = error.to_string();
            0
        }
    }
}

/// Replaces the loaded scene `handle` with the RSB file `bytes`; a file without `MESH` sections
/// keeps the scene's meshes and their BVHs (see `Scene::update_from_rsb`). The lights are prepared
/// again. Returns [`STATUS_OK`], [`STATUS_BAD_HANDLE`] or [`STATUS_BAD_SCENE`] after recording the
/// error (the scene is then unchanged).
pub fn scene_update(handle: u32, bytes: &[u8]) -> u32 {
    let mut reg = registry();
    let Some(loaded) = handle
        .checked_sub(1)
        .and_then(|i| reg.scenes.get_mut(i as usize))
        .and_then(Option::as_mut)
    else {
        return STATUS_BAD_HANDLE;
    };
    match loaded.scene.update_from_rsb(bytes) {
        Ok(()) => {
            loaded.prepared = Prepared::new(&loaded.scene);
            loaded.maps.clear();
            reg.error.clear();
            STATUS_OK
        }
        Err(error) => {
            reg.error = error.to_string();
            STATUS_BAD_SCENE
        }
    }
}

/// Records `message` as the last load error.
pub(crate) fn set_error(message: &str) {
    registry().error = message.to_owned();
}

/// The last load error as UTF-8 bytes (empty when the last load succeeded).
pub fn error_message() -> Vec<u8> {
    registry().error.as_bytes().to_vec()
}

/// Forgets a scene. Returns [`STATUS_OK`] or [`STATUS_BAD_HANDLE`].
pub fn scene_free(handle: u32) -> u32 {
    let mut reg = registry();
    match handle
        .checked_sub(1)
        .and_then(|i| reg.scenes.get_mut(i as usize))
    {
        Some(slot) if slot.is_some() => {
            *slot = None;
            STATUS_OK
        }
        _ => STATUS_BAD_HANDLE,
    }
}

/// The loaded scene of `handle` after checking the tile, for `run`.
fn with_tile<R>(handle: u32, w: u32, h: u32, run: impl FnOnce(&mut Loaded) -> R) -> Result<R, u32> {
    if w == 0 || h == 0 || u64::from(w) * u64::from(h) > MAX_TILE_PIXELS {
        return Err(STATUS_BAD_TILE);
    }
    let mut reg = registry();
    let loaded = handle
        .checked_sub(1)
        .and_then(|i| reg.scenes.get_mut(i as usize))
        .and_then(Option::as_mut)
        .ok_or(STATUS_BAD_HANDLE)?;
    Ok(run(loaded))
}

/// Caustic photons per sample the scene `handle` renders (0: none, also when nothing in it
/// focuses light or no light sends photons), or `None` for a bad handle. What the meter says.
pub fn scene_caustics(handle: u32) -> Option<u32> {
    let reg = registry();
    let loaded = handle
        .checked_sub(1)
        .and_then(|i| reg.scenes.get(i as usize))
        .and_then(Option::as_ref)?;
    Some(if loaded.prepared.has_caustics() {
        loaded.scene.render.caustic_photons
    } else {
        0
    })
}

/// Words per pixel of the input of [`denoise`]: the planes `sums` (4), `lum2` (1), `albedo` (3),
/// `normal` (3), `depth` (1), `part_id` (1) and `material_id` (1), one after another.
pub const DENOISE_WORDS: usize = 14;

/// The denoiser (`rt_post::denoise`) on a band of `rows` image rows from `origin_y` of an image
/// `width × height` of `samples` samples per pixel: `input` holds its planes (little-endian words,
/// see [`DENOISE_WORDS`]); returns the denoised RGBA sums of image rows `y0 .. y1` (which the
/// band must hold with `rt_post::denoise::HALO` rows around them, or up to the image's edge).
#[allow(clippy::too_many_arguments)]
pub fn denoise(
    width: u32,
    height: u32,
    origin_y: u32,
    rows: u32,
    samples: u32,
    y0: u32,
    y1: u32,
    input: &[u8],
) -> Result<Vec<f32>, u32> {
    let n = width as usize * rows as usize;
    if input.len() != n * DENOISE_WORDS * 4 {
        return Err(STATUS_BAD_DENOISE);
    }
    let words = |from: usize, count: usize| -> Vec<u32> {
        input[from * 4..(from + count) * 4]
            .chunks_exact(4)
            .map(|c| u32::from_le_bytes([c[0], c[1], c[2], c[3]]))
            .collect()
    };
    let floats = |from: usize, count: usize| -> Vec<f32> {
        words(from, count).into_iter().map(f32::from_bits).collect()
    };
    let sums = floats(0, n * 4);
    let lum2 = floats(n * 4, n);
    let albedo = floats(n * 5, n * 3);
    let normal = floats(n * 8, n * 3);
    let depth = floats(n * 11, n);
    let part_id = words(n * 12, n);
    let material_id = words(n * 13, n);
    let band = DenoiseInput {
        width,
        height,
        origin_y,
        rows,
        samples,
        sums: &sums,
        lum2: &lum2,
        albedo: &albedo,
        normal: &normal,
        depth: &depth,
        part_id: &part_id,
        material_id: &material_id,
    };
    denoise_rows(&band, y0, y1).map_err(|_| STATUS_BAD_DENOISE)
}

/// The exact passes of `mask` (normal, depth, part id, material id, circle of confusion: the
/// known bits of [`PASS_EXACT`]; the albedo bit and unknown bits are ignored) of the pixel
/// rectangle `(x, y, w, h)`, from one ray through each pixel's centre (`rt_core::passes`). The
/// planes follow each other in the order of `PASS_KEYS`, each `w * h * channels` little-endian
/// words (`f32`, or `u32` for the ids), rows from the top; pixels outside the image are
/// background (depth +inf, the rest 0). They do not depend on the sample: a host asks once per
/// tile.
pub fn render_tile_passes(
    handle: u32,
    x: u32,
    y: u32,
    w: u32,
    h: u32,
    mask: u32,
) -> Result<Vec<u8>, u32> {
    with_tile(handle, w, h, |loaded| {
        let mut film = PassFilm::region(x, y, w, h, mask & PASS_EXACT);
        render_tile_exact(
            &loaded.scene,
            &loaded.prepared,
            TileRect { x, y, w, h },
            &mut film,
            Isa::detect(),
        );
        let mut out = Vec::new();
        film.resolve().write_planes(&mut out);
        out
    })
}

/// The albedo of sample `sample_index` of the pixel rectangle `(x, y, w, h)`: `w * h * 3` floats,
/// the base colour of what that sample's camera ray met first (0 for the background and outside
/// the image). The host sums the samples in index order in `f32` and divides like the image.
pub fn render_tile_albedo_sample(
    handle: u32,
    x: u32,
    y: u32,
    w: u32,
    h: u32,
    sample_index: u32,
) -> Result<Vec<f32>, u32> {
    with_tile(handle, w, h, |loaded| {
        let mut film = PassFilm::region(x, y, w, h, PASS_ALBEDO);
        render_tile_albedo(
            &loaded.scene,
            &loaded.prepared,
            TileRect { x, y, w, h },
            sample_index,
            &mut film,
            Isa::detect(),
        );
        film.albedo
    })
}

/// Renders sample `sample_index` of the pixel rectangle `(x, y, w, h)` into a film covering
/// exactly that rectangle.
fn render_region(
    handle: u32,
    x: u32,
    y: u32,
    w: u32,
    h: u32,
    sample_index: u32,
) -> Result<Film, u32> {
    with_tile(handle, w, h, |loaded| {
        let mut film = Film::region(x, y, w, h);
        let map = loaded.photon_map(sample_index);
        render_tile_photons(
            &loaded.scene,
            &loaded.prepared,
            map.map(|i| &loaded.maps[i]),
            TileRect { x, y, w, h },
            sample_index,
            &mut film,
            Isa::detect(),
        );
        film
    })
}

/// Renders sample `sample_index` of the pixel rectangle `(x, y, w, h)` and returns the linear
/// radiance as `w * h * 3` floats (row major, RGB). Pixels outside the image stay zero.
pub fn render_tile(
    handle: u32,
    x: u32,
    y: u32,
    w: u32,
    h: u32,
    sample_index: u32,
) -> Result<Vec<f32>, u32> {
    render_region(handle, x, y, w, h, sample_index).map(|film| film.resolve())
}

/// Like [`render_tile`], with coverage: `w * h * 4` floats (row major, RGBA). Radiance is
/// premultiplied by alpha; alpha is 0 where a transparent background shows (and outside the
/// image), between 0 and 1 for a shadow on a shadow catcher.
pub fn render_tile_rgba(
    handle: u32,
    x: u32,
    y: u32,
    w: u32,
    h: u32,
    sample_index: u32,
) -> Result<Vec<f32>, u32> {
    let film = render_region(handle, x, y, w, h, sample_index)?;
    let rgb = film.resolve();
    let alpha = film.resolve_alpha();
    let mut out = Vec::with_capacity(alpha.len() * 4);
    for (px, a) in rgb.chunks_exact(3).zip(alpha) {
        out.extend_from_slice(px);
        out.push(a);
    }
    Ok(out)
}

#[cfg(test)]
#[allow(unsafe_code)] // The tests call the unsafe C ABI exactly like a host would.
mod tests {
    use super::*;
    use crate::ffi::*;
    use rt_core::math::Vec3;
    use std::sync::Mutex;

    /// The registry is process-wide state: tests that touch it run one at a time.
    static SERIAL: Mutex<()> = Mutex::new(());

    fn serial() -> MutexGuard<'static, ()> {
        SERIAL.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Copies `bytes` into wasm-style memory obtained from `rt_alloc`.
    fn upload(bytes: &[u8]) -> *mut u8 {
        let ptr = rt_alloc(bytes.len() as u32);
        // SAFETY: `ptr` points to `bytes.len()` writable bytes just allocated by `rt_alloc`.
        unsafe { std::ptr::copy_nonoverlapping(bytes.as_ptr(), ptr, bytes.len()) };
        ptr
    }

    /// Reads `count` floats from a byte buffer that may be unaligned.
    fn read_floats(ptr: *const u8, count: usize) -> Vec<f32> {
        (0..count)
            // SAFETY: the caller allocated at least `count * 4` readable bytes at `ptr`.
            .map(|i| {
                f32::from_le_bytes(unsafe {
                    std::ptr::read_unaligned(ptr.add(i * 4).cast::<[u8; 4]>())
                })
            })
            .collect()
    }

    fn load_example() -> u32 {
        let rsb = rt_core::example::scene().to_rsb();
        let ptr = upload(&rsb);
        // SAFETY: `ptr` holds `rsb.len()` initialised bytes from `rt_alloc`.
        let handle = unsafe { rt_scene_load(ptr, rsb.len() as u32) };
        // SAFETY: `ptr` came from `rt_alloc(rsb.len())` and is freed once.
        unsafe { rt_free(ptr, rsb.len() as u32) };
        handle
    }

    #[test]
    fn example_scene_renders_a_tile_through_the_c_api() {
        let _guard = serial();
        let handle = load_example();
        assert_ne!(
            handle,
            0,
            "load failed: {}",
            String::from_utf8_lossy(&error_message())
        );
        assert_eq!(rt_scene_error_len(), 0);

        // A 16x16 tile around the image centre, where the sphere is.
        let (x, y, w, h) = (248u32, 184u32, 16u32, 16u32);
        let count = (w * h * 3) as usize;
        let out = rt_alloc(count as u32 * 4);
        // SAFETY: `out` has room for `count` floats, and `handle` is a loaded scene.
        let status = unsafe { rt_render_tile(handle, x, y, w, h, 0, out.cast::<f32>()) };
        assert_eq!(status, STATUS_OK);
        let pixels = read_floats(out, count);

        // Same pixels as rendering with the engine directly.
        let scene = rt_core::example::scene();
        let mut film = Film::region(x, y, w, h);
        rt_core::render::render_tile(&scene, TileRect { x, y, w, h }, 0, &mut film);
        assert_eq!(pixels, film.resolve());

        // The RGBA variant: the same colour, alpha 1 everywhere (the background is opaque).
        let out4 = rt_alloc(w * h * 4 * 4);
        // SAFETY: `out4` has room for `w * h * 4` floats, and `handle` is a loaded scene.
        let status = unsafe { rt_render_tile_rgba(handle, x, y, w, h, 0, out4.cast::<f32>()) };
        assert_eq!(status, STATUS_OK);
        let rgba = read_floats(out4, (w * h * 4) as usize);
        for (i, px) in rgba.chunks_exact(4).enumerate() {
            assert_eq!(px[..3], pixels[i * 3..i * 3 + 3]);
            assert_eq!(px[3], 1.0);
        }
        // SAFETY: `out4` came from `rt_alloc(w * h * 16)`.
        unsafe { rt_free(out4, w * h * 4 * 4) };
        assert!(
            pixels.iter().any(|&v| v > 0.1),
            "the centre of the example image is lit"
        );
        assert!(pixels.iter().all(|v| v.is_finite()));

        // SAFETY: `out` came from `rt_alloc(count * 4)`.
        unsafe { rt_free(out, count as u32 * 4) };
        assert_eq!(rt_scene_free(handle), STATUS_OK);
    }

    #[test]
    fn tiles_beyond_the_image_edge_are_zero_filled() {
        let _guard = serial();
        let handle = load_example();
        let (w, h) = (8u32, 8u32);
        // Image is 512x384: columns 508..516 straddle the right edge.
        let pixels = render_tile(handle, 508, 0, w, h, 0).expect("render");
        assert_eq!(pixels.len(), 8 * 8 * 3);
        for row in 0..8 {
            assert!(pixels[(row * 8 + 4) * 3..(row * 8 + 8) * 3]
                .iter()
                .all(|&v| v == 0.0));
        }
        scene_free(handle);
    }

    #[test]
    fn load_errors_are_reported_and_cleared() {
        let _guard = serial();
        let garbage = upload(b"this is not an RSB file");
        // SAFETY: `garbage` holds 23 initialised bytes.
        assert_eq!(unsafe { rt_scene_load(garbage, 23) }, 0);
        // SAFETY: freed once with the length it was allocated with.
        unsafe { rt_free(garbage, 23) };

        let len = rt_scene_error_len();
        assert!(len > 0);
        let buffer = rt_alloc(len);
        // SAFETY: `buffer` has room for the `len` error bytes.
        unsafe { rt_scene_error_copy(buffer) };
        let message = String::from_utf8(read_floats_as_bytes(buffer, len as usize)).expect("UTF-8");
        assert!(message.contains("RSB1"), "{message}");
        // SAFETY: `buffer` came from `rt_alloc(len)`.
        unsafe { rt_free(buffer, len) };

        // A null pointer is an error, not a crash.
        // SAFETY: a null pointer is explicitly handled.
        assert_eq!(unsafe { rt_scene_load(std::ptr::null(), 10) }, 0);
        assert!(rt_scene_error_len() > 0);

        // A successful load clears the error.
        let handle = load_example();
        assert_ne!(handle, 0);
        assert_eq!(rt_scene_error_len(), 0);
        scene_free(handle);
    }

    fn read_floats_as_bytes(ptr: *const u8, len: usize) -> Vec<u8> {
        // SAFETY: the caller allocated `len` readable bytes at `ptr`.
        unsafe { std::slice::from_raw_parts(ptr, len) }.to_vec()
    }

    #[test]
    fn bad_arguments_return_status_codes() {
        let _guard = serial();
        let handle = load_example();
        let out = rt_alloc(64 * 3 * 4);
        let out_f32 = out.cast::<f32>();
        // SAFETY (all calls below): `out` has room for the largest valid tile used here.
        unsafe {
            assert_eq!(rt_render_tile(0, 0, 0, 8, 8, 0, out_f32), STATUS_BAD_HANDLE);
            assert_eq!(
                rt_render_tile(handle + 50, 0, 0, 8, 8, 0, out_f32),
                STATUS_BAD_HANDLE
            );
            assert_eq!(
                rt_render_tile(handle, 0, 0, 0, 8, 0, out_f32),
                STATUS_BAD_TILE
            );
            assert_eq!(
                rt_render_tile(handle, 0, 0, 8, 0, 0, out_f32),
                STATUS_BAD_TILE
            );
            assert_eq!(
                rt_render_tile(handle, 0, 0, 4096, 4096, 0, out_f32),
                STATUS_BAD_TILE
            );
            assert_eq!(
                rt_render_tile(handle, 0, 0, 8, 8, 0, std::ptr::null_mut()),
                STATUS_NULL_POINTER
            );
            assert_eq!(rt_render_tile(handle, 0, 0, 8, 8, 0, out_f32), STATUS_OK);
            rt_free(out, 64 * 3 * 4);
            rt_free(std::ptr::null_mut(), 0); // freeing null is a no-op
        }
        assert_eq!(rt_scene_free(handle), STATUS_OK);
        assert_eq!(
            rt_scene_free(handle),
            STATUS_BAD_HANDLE,
            "double free is reported"
        );
        assert_eq!(rt_scene_free(0), STATUS_BAD_HANDLE);
        assert_eq!(render_tile(handle, 0, 0, 8, 8, 0), Err(STATUS_BAD_HANDLE));
    }

    #[test]
    fn transparent_backgrounds_come_back_as_alpha() {
        let _guard = serial();
        let mut scene = rt_core::example::scene();
        scene.environment.background_mode = rt_core::scene::BACKGROUND_TRANSPARENT;
        let handle = scene_load(&scene.to_rsb());
        assert_ne!(handle, 0);
        // The top rows of the example look over the floor's far edge into the background.
        let rgba = render_tile_rgba(handle, 0, 0, 16, 4, 0).expect("render");
        let alpha: Vec<f32> = rgba.chunks_exact(4).map(|p| p[3]).collect();
        assert!(alpha.iter().all(|&a| a == 0.0), "{alpha:?}");
        assert!(rgba.chunks_exact(4).all(|p| p[..3] == [0.0, 0.0, 0.0]));
        // Beyond the image edge: zero alpha too.
        let edge = render_tile_rgba(handle, 508, 300, 8, 1, 0).expect("render");
        assert_eq!(edge[4 * 4 + 3], 0.0);
        assert_eq!(edge[3], 1.0, "the floor inside the image is opaque");
        assert_eq!(
            render_tile_rgba(handle, 0, 0, 0, 1, 0),
            Err(STATUS_BAD_TILE)
        );
        scene_free(handle);
    }

    #[test]
    fn updates_keep_the_meshes_and_render_like_a_fresh_load() {
        let _guard = serial();
        let handle = load_example();
        // The example seen through another camera at another size, sent without its meshes.
        let mut moved = rt_core::example::scene();
        moved.camera.position = Vec3::new(-300.0, -800.0, 500.0);
        moved.render.width = 96;
        moved.render.height = 64;
        moved.materials[0].base_color = rt_core::color::Rgb::new(0.1, 0.8, 0.3);
        // What the prepared lights hold changes too: the update must prepare them again.
        moved.environment.background_mode = rt_core::scene::BACKGROUND_COLOR;
        moved.environment.background_color = rt_core::color::Rgb::new(0.9, 0.1, 0.1);
        moved.lights[0].power = 20.0;
        let full = moved.to_rsb();
        let mut update = full[..8].to_vec();
        let mut pos = 8;
        while pos < full.len() {
            let len = u32::from_le_bytes(full[pos + 4..pos + 8].try_into().unwrap()) as usize;
            if &full[pos..pos + 4] != b"MESH" {
                update.extend_from_slice(&full[pos..pos + 8 + len]);
            }
            pos += 8 + len;
        }
        assert!(
            update.len() < full.len() / 4,
            "the update carries no geometry"
        );
        let ptr = upload(&update);
        // SAFETY: `ptr` holds `update.len()` initialised bytes from `rt_alloc`.
        let status = unsafe { rt_scene_update(handle, ptr, update.len() as u32) };
        // SAFETY: `ptr` came from `rt_alloc(update.len())` and is freed once.
        unsafe { rt_free(ptr, update.len() as u32) };
        assert_eq!(status, STATUS_OK);
        let fresh = scene_load(&full);
        for sample in 0..2 {
            assert_eq!(
                render_tile_rgba(handle, 0, 0, 96, 64, sample),
                render_tile_rgba(fresh, 0, 0, 96, 64, sample)
            );
        }
        // Pixels beyond the new size are outside the image now.
        let edge = render_tile_rgba(handle, 90, 0, 8, 1, 0).expect("render");
        assert_eq!(edge[6 * 4 + 3], 0.0);

        // A bad update is reported and changes nothing.
        assert_eq!(scene_update(handle, b"garbage"), STATUS_BAD_SCENE);
        assert!(rt_scene_error_len() > 0);
        assert_eq!(
            render_tile_rgba(handle, 0, 0, 96, 64, 0),
            render_tile_rgba(fresh, 0, 0, 96, 64, 0)
        );
        assert_eq!(scene_update(handle, &update), STATUS_OK);
        assert_eq!(rt_scene_error_len(), 0, "a good update clears the error");
        assert_eq!(scene_update(0, &update), STATUS_BAD_HANDLE);
        assert_eq!(scene_update(handle + 40, &update), STATUS_BAD_HANDLE);
        // SAFETY: a null pointer is explicitly handled.
        assert_eq!(
            unsafe { rt_scene_update(handle, std::ptr::null(), 4) },
            STATUS_NULL_POINTER
        );
        scene_free(handle);
        scene_free(fresh);
    }

    #[test]
    fn freed_handles_are_reused_and_scenes_are_independent() {
        let _guard = serial();
        let a = load_example();
        let b = load_example();
        assert_ne!(a, b);
        assert_eq!(scene_free(a), STATUS_OK);
        let c = load_example();
        assert_eq!(c, a, "the freed slot is reused");
        assert!(render_tile(b, 0, 0, 4, 4, 0).is_ok());
        scene_free(b);
        scene_free(c);
    }

    #[test]
    fn passes_through_the_c_api_are_the_engines() {
        use rt_core::passes::{Passes, PASS_ALL};
        let _guard = serial();
        let mut scene = rt_core::example::scene();
        scene.render.width = 70;
        scene.render.height = 45;
        let handle = scene_load(&scene.to_rsb());
        assert_ne!(handle, 0);
        let prepared = Prepared::new(&scene);
        // What a host does: per 32-pixel tile, the exact planes once and the albedo of samples
        // 0..3, summed in f32 in sample order and divided like `Film::resolve`.
        let samples = 3u32;
        let mut reference = Passes::new(70, 45, PASS_ALL);
        let mut planes: Vec<(TileRect, Vec<u8>, Vec<f32>)> = Vec::new();
        for tile in rt_core::render::tile_grid(70, 45, 32) {
            let TileRect { x, y, w, h } = tile;
            let out = rt_alloc(w * h * 7 * 4);
            // SAFETY: `out` has room for 7 words per pixel (normal 3, depth, two ids, coc).
            let status = unsafe { rt_render_tile_passes(handle, x, y, w, h, PASS_ALL, out) };
            assert_eq!(status, STATUS_OK);
            let exact = read_floats_as_bytes(out, (w * h * 7 * 4) as usize);
            // SAFETY: `out` came from `rt_alloc(w * h * 28)`.
            unsafe { rt_free(out, w * h * 7 * 4) };
            let mut sum = vec![0.0f32; (w * h * 3) as usize];
            let one = rt_alloc(w * h * 3 * 4);
            for s in 0..samples {
                // SAFETY: `one` has room for `w * h * 3` floats.
                let status = unsafe { rt_render_tile_albedo(handle, x, y, w, h, s, one.cast()) };
                assert_eq!(status, STATUS_OK);
                for (a, b) in sum.iter_mut().zip(read_floats(one, (w * h * 3) as usize)) {
                    *a += b;
                }
            }
            // SAFETY: `one` came from `rt_alloc(w * h * 12)`.
            unsafe { rt_free(one, w * h * 3 * 4) };
            let inv = 1.0 / samples as f32;
            planes.push((tile, exact, sum.iter().map(|v| v * inv).collect()));
            let mut film = PassFilm::region(x, y, w, h, PASS_ALL);
            render_tile_exact(&scene, &prepared, tile, &mut film, Isa::detect());
            for s in 0..samples {
                render_tile_albedo(&scene, &prepared, tile, s, &mut film, Isa::detect());
            }
            reference.copy_region(x, y, &film.resolve());
        }
        // Assemble the host's planes the same way and compare bit for bit.
        let mut got = Passes::new(70, 45, PASS_ALL);
        for (tile, exact, albedo) in planes {
            let n = (tile.w * tile.h) as usize;
            let word = |i: usize| u32::from_le_bytes(exact[i * 4..i * 4 + 4].try_into().unwrap());
            let floats = |from: usize, len: usize| {
                (from..from + len)
                    .map(|i| f32::from_bits(word(i)))
                    .collect()
            };
            let ids = |from: usize| (from..from + n).map(word).collect();
            let region = Passes {
                width: tile.w,
                height: tile.h,
                mask: PASS_ALL,
                albedo,
                normal: floats(0, n * 3),
                depth: floats(n * 3, n),
                part_id: ids(n * 4),
                material_id: ids(n * 5),
                coc: floats(n * 6, n),
            };
            got.copy_region(tile.x, tile.y, &region);
        }
        assert_eq!(got, reference);
        assert!(got.part_id.contains(&1) && got.part_id.contains(&0));

        // A mask without exact passes writes nothing; bad arguments are the usual statuses.
        assert_eq!(render_tile_passes(handle, 0, 0, 4, 4, 1), Ok(Vec::new()));
        assert_eq!(
            render_tile_passes(handle, 0, 0, 4, 4, 1 << 3).map(|b| b.len()),
            Ok(64)
        );
        assert_eq!(
            render_tile_passes(0, 0, 0, 4, 4, PASS_ALL),
            Err(STATUS_BAD_HANDLE)
        );
        assert_eq!(
            render_tile_passes(handle, 0, 0, 0, 4, PASS_ALL),
            Err(STATUS_BAD_TILE)
        );
        assert_eq!(
            render_tile_albedo_sample(handle, 0, 0, 4096, 4096, 0),
            Err(STATUS_BAD_TILE)
        );
        // Beyond the image's edge: background.
        let edge = render_tile_passes(handle, 68, 0, 4, 1, 1 << 2).unwrap();
        assert_eq!(
            f32::from_le_bytes(edge[12..16].try_into().unwrap()),
            f32::INFINITY
        );
        assert_eq!(
            render_tile_albedo_sample(handle, 68, 0, 4, 1, 0).unwrap()[6..],
            [0.0; 6]
        );
        // SAFETY: null pointers are explicitly handled.
        unsafe {
            assert_eq!(
                rt_render_tile_passes(handle, 0, 0, 4, 4, PASS_ALL, std::ptr::null_mut()),
                STATUS_NULL_POINTER
            );
            assert_eq!(
                rt_render_tile_albedo(handle, 0, 0, 4, 4, 0, std::ptr::null_mut()),
                STATUS_NULL_POINTER
            );
        }
        scene_free(handle);
    }

    #[test]
    fn caustic_tiles_trace_each_photon_map_once_and_match_the_engine() {
        let _guard = serial();
        let scene = rt_core::example::e5b_scene();
        let rsb = scene.to_rsb();
        let handle = scene_load(&rsb);
        assert_ne!(handle, 0);
        assert_eq!(rt_scene_caustics(handle), 2048);
        assert_eq!(rt_scene_caustics(999), u32::MAX);
        let prepared = Prepared::new(&scene);
        let (x, y, w, h) = (40u32, 40u32, 24u32, 20u32);
        for sample in [0u32, 1, 0, 2] {
            let pixels = render_tile(handle, x, y, w, h, sample).expect("render");
            let map = PhotonMap::trace(&scene, &prepared, sample, Isa::detect());
            let mut film = Film::region(x, y, w, h);
            render_tile_photons(
                &scene,
                &prepared,
                Some(&map),
                TileRect { x, y, w, h },
                sample,
                &mut film,
                Isa::detect(),
            );
            assert_eq!(pixels, film.resolve(), "sample {sample}");
        }
        {
            let reg = registry();
            let loaded = reg.scenes[handle as usize - 1].as_ref().expect("loaded");
            assert_eq!(loaded.maps.len(), 3, "sample 0 traced once");
        }
        // An update drops the maps (the scene may have changed); a scene without photons has none.
        let mut off = scene.clone();
        off.render.caustic_photons = 0;
        assert_eq!(scene_update(handle, &off.to_rsb()), STATUS_OK);
        assert_eq!(rt_scene_caustics(handle), 0);
        let reg = registry();
        assert!(reg.scenes[handle as usize - 1]
            .as_ref()
            .expect("loaded")
            .maps
            .is_empty());
        drop(reg);
        scene_free(handle);
    }

    #[test]
    fn the_denoiser_through_the_c_api_is_rt_post_s() {
        let _guard = serial();
        use rt_core::passes::Passes;
        use rt_post::denoise::{denoise as denoise_whole, rgba_sums, GUIDE_PASSES, HALO};
        // A small render of the example with the guide passes.
        let mut scene = rt_core::example::scene();
        scene.render.width = 48;
        scene.render.height = 160;
        let prepared = Prepared::new(&scene);
        let mut film = Film::new(48, 160);
        let mut passes = Passes::new(48, 160, GUIDE_PASSES);
        for tile in rt_core::render::tile_grid(48, 160, 32) {
            let mut pf = PassFilm::region(tile.x, tile.y, tile.w, tile.h, GUIDE_PASSES);
            render_tile_exact(&scene, &prepared, tile, &mut pf, Isa::detect());
            for sample in 0..2 {
                render_tile_photons(
                    &scene,
                    &prepared,
                    None,
                    tile,
                    sample,
                    &mut film,
                    Isa::detect(),
                );
                render_tile_albedo(&scene, &prepared, tile, sample, &mut pf, Isa::detect());
            }
            passes.copy_region(tile.x, tile.y, &pf.resolve());
        }
        let sums = rgba_sums(&film);
        let whole = DenoiseInput::whole(2, &sums, &film.lum2, &passes).expect("input");
        let expected = denoise_whole(&whole).expect("denoise");
        // The band of rows 100..120 with its halo, packed as the page packs it.
        let band = whole.with_halo(100, 120);
        assert_eq!((band.origin_y, band.rows), (100 - HALO, 160 - (100 - HALO)));
        let mut bytes = Vec::new();
        for v in band
            .sums
            .iter()
            .chain(band.lum2)
            .chain(band.albedo)
            .chain(band.normal)
            .chain(band.depth)
        {
            bytes.extend_from_slice(&v.to_le_bytes());
        }
        for v in band.part_id.iter().chain(band.material_id) {
            bytes.extend_from_slice(&v.to_le_bytes());
        }
        let input = upload(&bytes);
        let out = rt_alloc(48 * 20 * 16);
        // SAFETY: `input` holds the band's planes and `out` room for 20 rows of RGBA floats.
        let status = unsafe {
            rt_denoise(
                48,
                160,
                band.origin_y,
                band.rows,
                2,
                100,
                120,
                input,
                out.cast::<f32>(),
            )
        };
        assert_eq!(status, STATUS_OK);
        assert_eq!(
            read_floats(out, 48 * 20 * 4),
            expected[100 * 48 * 4..120 * 48 * 4]
        );
        // Rows outside the band, a short buffer, or null pointers are refused.
        // SAFETY: as above; the calls read nothing out of bounds before refusing.
        unsafe {
            assert_eq!(
                rt_denoise(
                    48,
                    160,
                    band.origin_y,
                    band.rows,
                    2,
                    0,
                    10,
                    input,
                    out.cast::<f32>()
                ),
                STATUS_BAD_DENOISE
            );
            assert_eq!(
                rt_denoise(48, 160, 0, 1, 2, 0, 1, std::ptr::null(), out.cast::<f32>()),
                STATUS_NULL_POINTER
            );
        }
        assert_eq!(
            denoise(48, 160, 0, 2, 2, 0, 1, &bytes[..16]),
            Err(STATUS_BAD_DENOISE)
        );
        // SAFETY: both came from `rt_alloc` with these lengths.
        unsafe {
            rt_free(input, bytes.len() as u32);
            rt_free(out, 48 * 20 * 16);
        }
    }

    #[test]
    fn version_and_zero_length_allocations() {
        assert_eq!(rt_version(), rt_core::VERSION);
        let ptr = rt_alloc(0);
        assert!(!ptr.is_null());
        // SAFETY: `ptr` came from `rt_alloc(0)`.
        unsafe { rt_free(ptr, 0) };
    }
}
