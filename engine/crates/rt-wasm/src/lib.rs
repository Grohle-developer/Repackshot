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

use rt_core::image::Film;
use rt_core::render::{render_tile as render_core_tile, TileRect};
use rt_core::scene::Scene;
use std::sync::{Mutex, MutexGuard, PoisonError};

pub mod ffi;

/// Status returned by `rt_render_tile`: success.
pub const STATUS_OK: u32 = 0;
/// Status returned by `rt_render_tile` and `rt_scene_free`: the handle is not a loaded scene.
pub const STATUS_BAD_HANDLE: u32 = 1;
/// Status returned by `rt_render_tile`: empty tile or more than [`MAX_TILE_PIXELS`] pixels.
pub const STATUS_BAD_TILE: u32 = 2;
/// Status returned by `rt_render_tile`: the output pointer is null.
pub const STATUS_NULL_POINTER: u32 = 3;

/// Largest tile (in pixels) `rt_render_tile` accepts: 2048 x 2048.
pub const MAX_TILE_PIXELS: u64 = 1 << 22;

/// Loaded scenes and the last load error.
struct Registry {
    /// Slot `i` holds the scene with handle `i + 1`; freed slots are reused.
    scenes: Vec<Option<Scene>>,
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
            reg.scenes[slot] = Some(scene);
            slot as u32 + 1
        }
        Err(error) => {
            reg.error = error.to_string();
            0
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
    if w == 0 || h == 0 || u64::from(w) * u64::from(h) > MAX_TILE_PIXELS {
        return Err(STATUS_BAD_TILE);
    }
    let reg = registry();
    let scene = handle
        .checked_sub(1)
        .and_then(|i| reg.scenes.get(i as usize))
        .and_then(Option::as_ref)
        .ok_or(STATUS_BAD_HANDLE)?;
    let mut film = Film::region(x, y, w, h);
    render_core_tile(scene, TileRect { x, y, w, h }, sample_index, &mut film);
    Ok(film.resolve())
}

#[cfg(test)]
#[allow(unsafe_code)] // The tests call the unsafe C ABI exactly like a host would.
mod tests {
    use super::*;
    use crate::ffi::*;
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
        render_core_tile(&scene, TileRect { x, y, w, h }, 0, &mut film);
        assert_eq!(pixels, film.resolve());
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
    fn version_and_zero_length_allocations() {
        assert_eq!(rt_version(), rt_core::VERSION);
        let ptr = rt_alloc(0);
        assert!(!ptr.is_null());
        // SAFETY: `ptr` came from `rt_alloc(0)`.
        unsafe { rt_free(ptr, 0) };
    }
}
