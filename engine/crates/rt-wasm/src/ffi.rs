//! The C ABI exported to the host. Every function here is a thin shim over the safe code in the
//! crate root; the pointer handling is the only `unsafe` in the whole engine and every block says
//! why it is sound.
//!
//! All pointers are offsets into the wasm linear memory. Buffers are created with [`rt_alloc`]
//! and released with [`rt_free`] (same length). Nothing here requires pointer alignment.
#![allow(unsafe_code)]

use crate::{STATUS_NULL_POINTER, STATUS_OK};

/// Engine version, packed as `major << 16 | minor << 8 | patch`.
#[no_mangle]
pub extern "C" fn rt_version() -> u32 {
    rt_core::VERSION
}

/// What the engine reads beyond the RSB every engine reads (`rt_core::FEATURES`; bit 0, M2b: the
/// texture data; bit 1, M3b: the material programs). The page writes them only when this says
/// so.
#[no_mangle]
pub extern "C" fn rt_features() -> u32 {
    rt_core::FEATURES
}

/// Allocates `len` zeroed bytes in linear memory and returns their address. Never returns null
/// (a zero length gives a dangling but non-null pointer). Release with [`rt_free`].
#[no_mangle]
pub extern "C" fn rt_alloc(len: u32) -> *mut u8 {
    let buffer: Box<[u8]> = vec![0u8; len as usize].into_boxed_slice();
    Box::into_raw(buffer).cast::<u8>()
}

/// Releases a buffer obtained from [`rt_alloc`]. Null is ignored.
///
/// # Safety
///
/// `ptr` must be null or a pointer returned by `rt_alloc(len)` with exactly this `len`, and it
/// must not have been freed already.
#[no_mangle]
pub unsafe extern "C" fn rt_free(ptr: *mut u8, len: u32) {
    if ptr.is_null() {
        return;
    }
    // SAFETY: by the contract above `ptr` and `len` describe the boxed slice that `rt_alloc`
    // leaked, so rebuilding the box returns ownership (and the allocation) to Rust.
    drop(unsafe { Box::from_raw(std::ptr::slice_from_raw_parts_mut(ptr, len as usize)) });
}

/// Parses `len` bytes of RSB data at `ptr` and returns a scene handle, or 0 on error (then see
/// [`rt_scene_error_len`]). The bytes are copied; the caller may free them straight away.
///
/// # Safety
///
/// `ptr` must be null or point to `len` readable bytes.
#[no_mangle]
pub unsafe extern "C" fn rt_scene_load(ptr: *const u8, len: u32) -> u32 {
    if ptr.is_null() {
        crate::set_error("rt_scene_load: null pointer");
        return 0;
    }
    // SAFETY: non-null, and the caller promises `len` readable bytes; the slice does not outlive
    // this call.
    let bytes = unsafe { std::slice::from_raw_parts(ptr, len as usize) };
    crate::scene_load(bytes)
}

/// Replaces the loaded scene `handle` with the `len` bytes of RSB data at `ptr`. A file without
/// `MESH` sections keeps the scene's meshes and BVHs, so a host sends only what changed besides
/// the geometry (camera, image size, instances, materials, lights...). Returns 0 on success, 1
/// for a bad handle, 3 for a null `ptr`, 4 when the bytes are not a valid scene (then see
/// [`rt_scene_error_len`]; the scene is unchanged). The bytes are copied.
///
/// # Safety
///
/// `ptr` must be null or point to `len` readable bytes.
#[no_mangle]
pub unsafe extern "C" fn rt_scene_update(handle: u32, ptr: *const u8, len: u32) -> u32 {
    if ptr.is_null() {
        crate::set_error("rt_scene_update: null pointer");
        return STATUS_NULL_POINTER;
    }
    // SAFETY: non-null, and the caller promises `len` readable bytes; the slice does not outlive
    // this call.
    let bytes = unsafe { std::slice::from_raw_parts(ptr, len as usize) };
    crate::scene_update(handle, bytes)
}

/// Length in bytes of the last load error message (0 if the last load succeeded).
#[no_mangle]
pub extern "C" fn rt_scene_error_len() -> u32 {
    crate::error_message().len() as u32
}

/// Copies the last load error message (UTF-8, no terminator) to `ptr`.
///
/// # Safety
///
/// `ptr` must be null or point to at least [`rt_scene_error_len`] writable bytes.
#[no_mangle]
pub unsafe extern "C" fn rt_scene_error_copy(ptr: *mut u8) {
    if ptr.is_null() {
        return;
    }
    let message = crate::error_message();
    // SAFETY: the caller promises room for `rt_scene_error_len()` bytes, which is
    // `message.len()` unless the error changed in between (single threaded host); the regions
    // cannot overlap because `message` is a fresh allocation.
    unsafe { std::ptr::copy_nonoverlapping(message.as_ptr(), ptr, message.len()) };
}

/// Forgets a scene. Returns 0, or 1 if `handle` is not a loaded scene.
#[no_mangle]
pub extern "C" fn rt_scene_free(handle: u32) -> u32 {
    crate::scene_free(handle)
}

/// Renders sample `sample_index` of the pixel rectangle `(x, y, w, h)` of the image and writes
/// `w * h * 3` linear RGB floats (row major, no padding) to `out_ptr`. Parts of the tile outside
/// the image are written as zero. Returns 0 on success, 1 for a bad handle, 2 for an empty or
/// oversized tile (more than 2048 x 2048 pixels), 3 for a null `out_ptr`.
///
/// # Safety
///
/// `out_ptr` must be null or point to at least `w * h * 3 * 4` writable bytes (alignment is not
/// required).
#[no_mangle]
pub unsafe extern "C" fn rt_render_tile(
    handle: u32,
    x: u32,
    y: u32,
    w: u32,
    h: u32,
    sample_index: u32,
    out_ptr: *mut f32,
) -> u32 {
    if out_ptr.is_null() {
        return STATUS_NULL_POINTER;
    }
    match crate::render_tile(handle, x, y, w, h, sample_index) {
        Ok(pixels) => {
            // SAFETY: the caller promises `w * h * 3 * 4` writable bytes and `pixels` holds
            // exactly `w * h * 3` floats; byte-wise copy avoids any alignment requirement, and
            // `pixels` is a fresh allocation so the regions do not overlap.
            unsafe {
                std::ptr::copy_nonoverlapping(
                    pixels.as_ptr().cast::<u8>(),
                    out_ptr.cast::<u8>(),
                    pixels.len() * std::mem::size_of::<f32>(),
                );
            }
            STATUS_OK
        }
        Err(status) => status,
    }
}

/// Like [`rt_render_tile`] with coverage: writes `w * h * 4` floats, RGBA, radiance premultiplied
/// by alpha (alpha is 0 where a transparent background shows). Same status codes.
///
/// # Safety
///
/// `out_ptr` must be null or point to at least `w * h * 4 * 4` writable bytes (alignment is not
/// required).
#[no_mangle]
pub unsafe extern "C" fn rt_render_tile_rgba(
    handle: u32,
    x: u32,
    y: u32,
    w: u32,
    h: u32,
    sample_index: u32,
    out_ptr: *mut f32,
) -> u32 {
    if out_ptr.is_null() {
        return STATUS_NULL_POINTER;
    }
    match crate::render_tile_rgba(handle, x, y, w, h, sample_index) {
        Ok(pixels) => {
            // SAFETY: the caller promises `w * h * 4 * 4` writable bytes and `pixels` holds
            // exactly `w * h * 4` floats; byte-wise copy needs no alignment, and `pixels` is a
            // fresh allocation so the regions do not overlap.
            unsafe {
                std::ptr::copy_nonoverlapping(
                    pixels.as_ptr().cast::<u8>(),
                    out_ptr.cast::<u8>(),
                    pixels.len() * std::mem::size_of::<f32>(),
                );
            }
            STATUS_OK
        }
        Err(status) => status,
    }
}

/// Writes the exact passes of `mask` (normal 2, depth 4, part id 8, material id 16, circle of
/// confusion 32; the albedo bit 1 and unknown bits are ignored) of the pixel rectangle
/// `(x, y, w, h)` to `out_ptr`: the planes one after another in that order, each
/// `w * h * channels` little-endian words (3 for the normal, 1 for the others; `f32`, `u32` for
/// the ids), rows from the top. One ray through the centre of each pixel: the same for every
/// sample. Same status codes as [`rt_render_tile`].
///
/// # Safety
///
/// `out_ptr` must be null or point to at least `w * h * 4 * (words per pixel of mask)` writable
/// bytes (alignment is not required).
#[no_mangle]
pub unsafe extern "C" fn rt_render_tile_passes(
    handle: u32,
    x: u32,
    y: u32,
    w: u32,
    h: u32,
    mask: u32,
    out_ptr: *mut u8,
) -> u32 {
    if out_ptr.is_null() {
        return STATUS_NULL_POINTER;
    }
    match crate::render_tile_passes(handle, x, y, w, h, mask) {
        Ok(bytes) => {
            // SAFETY: the caller promises room for the planes of `mask`, which is exactly
            // `bytes.len()`; byte-wise copy needs no alignment, and `bytes` is a fresh allocation
            // so the regions do not overlap.
            unsafe { std::ptr::copy_nonoverlapping(bytes.as_ptr(), out_ptr, bytes.len()) };
            STATUS_OK
        }
        Err(status) => status,
    }
}

/// Writes the albedo of sample `sample_index` of the pixel rectangle `(x, y, w, h)`: `w * h * 3`
/// linear floats, the base colour of what that sample's camera ray met first (0 for the
/// background and outside the image). Same status codes as [`rt_render_tile`].
///
/// # Safety
///
/// `out_ptr` must be null or point to at least `w * h * 3 * 4` writable bytes (alignment is not
/// required).
#[no_mangle]
pub unsafe extern "C" fn rt_render_tile_albedo(
    handle: u32,
    x: u32,
    y: u32,
    w: u32,
    h: u32,
    sample_index: u32,
    out_ptr: *mut f32,
) -> u32 {
    if out_ptr.is_null() {
        return STATUS_NULL_POINTER;
    }
    match crate::render_tile_albedo_sample(handle, x, y, w, h, sample_index) {
        Ok(albedo) => {
            // SAFETY: the caller promises `w * h * 3 * 4` writable bytes and `albedo` holds
            // exactly `w * h * 3` floats; byte-wise copy needs no alignment, and `albedo` is a
            // fresh allocation so the regions do not overlap.
            unsafe {
                std::ptr::copy_nonoverlapping(
                    albedo.as_ptr().cast::<u8>(),
                    out_ptr.cast::<u8>(),
                    albedo.len() * std::mem::size_of::<f32>(),
                );
            }
            STATUS_OK
        }
        Err(status) => status,
    }
}

/// Caustic photons per sample the scene `handle` renders: 0 without caustics (none asked for, or
/// nothing that focuses light, or no light that sends photons), `u32::MAX` for a bad handle.
#[no_mangle]
pub extern "C" fn rt_scene_caustics(handle: u32) -> u32 {
    crate::scene_caustics(handle).unwrap_or(u32::MAX)
}

/// The particles of an ambient effect (S4a) for the Fast preview: reads the `FXAM` payload of
/// `params_len` bytes at `params_ptr` and writes at most `max` particles, 8 floats each (centre,
/// radius, axis, tint seed bits: [`crate::PARTICLE_FLOATS`]), to `out_ptr`. Returns the number of
/// particles written, or `u32::MAX` when a pointer is null or the payload is invalid (then see
/// [`rt_scene_error_len`]).
///
/// # Safety
///
/// `params_ptr` must be null or point to `params_len` readable bytes, and `out_ptr` null or to
/// `max * 8 * 4` writable bytes (alignment is not required).
#[no_mangle]
pub unsafe extern "C" fn rt_particles_eval(
    params_ptr: *const u8,
    params_len: u32,
    max: u32,
    out_ptr: *mut f32,
) -> u32 {
    if params_ptr.is_null() || out_ptr.is_null() {
        crate::set_error("rt_particles_eval: null pointer");
        return u32::MAX;
    }
    // SAFETY: non-null, and the caller promises `params_len` readable bytes; the slice does not
    // outlive this call.
    let params = unsafe { std::slice::from_raw_parts(params_ptr, params_len as usize) };
    match crate::particles_eval(params, max) {
        Ok(out) => {
            // SAFETY: at most `max` particles of 8 floats were evaluated, for which the caller
            // promises room; byte-wise copy needs no alignment, and `out` is a fresh allocation so
            // the regions do not overlap.
            unsafe {
                std::ptr::copy_nonoverlapping(
                    out.as_ptr().cast::<u8>(),
                    out_ptr.cast::<u8>(),
                    out.len() * std::mem::size_of::<f32>(),
                );
            }
            (out.len() / crate::PARTICLE_FLOATS) as u32
        }
        Err(_) => u32::MAX,
    }
}

/// Length in bytes of the lens information of scene `handle` (O2, JSON: [`crate::scene_lens_info`]),
/// `u32::MAX` for a bad handle.
#[no_mangle]
pub extern "C" fn rt_scene_lens_info_len(handle: u32) -> u32 {
    crate::scene_lens_info(handle).map_or(u32::MAX, |s| s.len() as u32)
}

/// Copies the lens information of scene `handle` (UTF-8, no terminator) to `ptr`. Returns 0, 1 for
/// a bad handle, 3 for a null `ptr`.
///
/// # Safety
///
/// `ptr` must be null or point to at least [`rt_scene_lens_info_len`] writable bytes.
#[no_mangle]
pub unsafe extern "C" fn rt_scene_lens_info_copy(handle: u32, ptr: *mut u8) -> u32 {
    if ptr.is_null() {
        return crate::STATUS_NULL_POINTER;
    }
    let Some(info) = crate::scene_lens_info(handle) else {
        return crate::STATUS_BAD_HANDLE;
    };
    // SAFETY: the caller promises room for `rt_scene_lens_info_len(handle)` bytes, which is
    // `info.len()` (the scene does not change in between: single threaded host); the regions
    // cannot overlap because `info` is a fresh allocation.
    unsafe { std::ptr::copy_nonoverlapping(info.as_ptr(), ptr, info.len()) };
    crate::STATUS_OK
}

/// The denoiser (E5b-1, the full filter) on a band of `rows` image rows from `origin_y` of an
/// image `width × height` of `samples` samples per pixel. `in_ptr` holds `width * rows * 14`
/// little-endian words: the planes `sums` (RGBA), `lum2`, `albedo` (3), `normal` (3), `depth`,
/// `part_id` and `material_id`, one after another. Writes the denoised RGBA sums of image rows
/// `y0 .. y1` (`width * (y1 - y0) * 4` floats) to `out_ptr`. Returns `STATUS_OK`,
/// `STATUS_NULL_POINTER` or `STATUS_BAD_DENOISE` (the sizes, the band or its halo do not fit).
///
/// # Safety
///
/// `in_ptr` must be null or point to `width * rows * 14 * 4` readable bytes, and `out_ptr` null
/// or to `width * (y1 - y0) * 4 * 4` writable bytes (alignment is not required).
#[no_mangle]
#[allow(clippy::too_many_arguments)]
pub unsafe extern "C" fn rt_denoise(
    width: u32,
    height: u32,
    origin_y: u32,
    rows: u32,
    samples: u32,
    y0: u32,
    y1: u32,
    in_ptr: *const u8,
    out_ptr: *mut f32,
) -> u32 {
    // SAFETY: the caller's promises are those of `rt_denoise_with`.
    unsafe {
        rt_denoise_with(
            0, 1.0, width, height, origin_y, rows, samples, y0, y1, in_ptr, out_ptr,
        )
    }
}

/// [`rt_denoise`] with a preset (U11): 0 the full filter, 1 the viewport's lighter one
/// (`rt_post::denoise::Preset::VIEWPORT`), whose band holds the rows with
/// [`rt_denoise_halo`]`(1)` rows around them; and a strength (U11b, `0..=1`): the rows are
/// `noisy × (1 − s) + denoised × s`, and at 0 the noisy rows (no filter runs). An unknown preset
/// is `STATUS_BAD_DENOISE`.
///
/// # Safety
///
/// As [`rt_denoise`].
#[no_mangle]
#[allow(clippy::too_many_arguments)]
pub unsafe extern "C" fn rt_denoise_with(
    preset: u32,
    strength: f32,
    width: u32,
    height: u32,
    origin_y: u32,
    rows: u32,
    samples: u32,
    y0: u32,
    y1: u32,
    in_ptr: *const u8,
    out_ptr: *mut f32,
) -> u32 {
    if in_ptr.is_null() || out_ptr.is_null() {
        return STATUS_NULL_POINTER;
    }
    let Some(preset) = crate::denoise_preset(preset) else {
        return crate::STATUS_BAD_DENOISE;
    };
    let len = width as usize * rows as usize * crate::DENOISE_WORDS * 4;
    // SAFETY: non-null, and the caller promises `len` readable bytes; the slice does not outlive
    // this call.
    let input = unsafe { std::slice::from_raw_parts(in_ptr, len) };
    match crate::denoise_with(
        preset, strength, width, height, origin_y, rows, samples, y0, y1, input,
    ) {
        Ok(out) => {
            // SAFETY: the caller promises room for `width * (y1 - y0) * 4` floats, which is
            // exactly `out.len()` (the rows asked for); byte-wise copy needs no alignment, and
            // `out` is a fresh allocation so the regions do not overlap.
            unsafe {
                std::ptr::copy_nonoverlapping(
                    out.as_ptr().cast::<u8>(),
                    out_ptr.cast::<u8>(),
                    out.len() * std::mem::size_of::<f32>(),
                );
            }
            STATUS_OK
        }
        Err(status) => status,
    }
}

/// Rows a band of denoiser preset `preset` holds above and below the rows it computes
/// (`rt_post::denoise::Preset::halo`: 72 for the full filter, the viewport's fewer); 0 for an
/// unknown preset.
#[no_mangle]
pub extern "C" fn rt_denoise_halo(preset: u32) -> u32 {
    crate::denoise_preset(preset).map_or(0, |p| p.halo())
}

// --- The rigid body simulator (S2) --------------------------------------------------------------

/// Builds a physics world from `len` bytes of a `PHY1` scene at `ptr` (rt-phys `scene` module) and
/// returns its handle, or 0 on error (then see [`rt_scene_error_len`]). The bytes are copied.
///
/// # Safety
///
/// `ptr` must be null or point to `len` readable bytes.
#[no_mangle]
pub unsafe extern "C" fn phys_new(ptr: *const u8, len: u32) -> u32 {
    if ptr.is_null() {
        crate::set_error("phys_new: null pointer");
        return 0;
    }
    // SAFETY: non-null, and the caller promises `len` readable bytes; the slice does not outlive
    // this call.
    let bytes = unsafe { std::slice::from_raw_parts(ptr, len as usize) };
    crate::phys::new(bytes)
}

/// Forgets a physics world. Returns 0, or 1 for a bad handle.
#[no_mangle]
pub extern "C" fn phys_free(handle: u32) -> u32 {
    if crate::phys::free(handle) {
        STATUS_OK
    } else {
        crate::STATUS_BAD_HANDLE
    }
}

/// Simulates `n` fixed steps of 1/240 s (at most a minute per call). Returns 0, or 1 for a bad
/// handle.
#[no_mangle]
pub extern "C" fn phys_step(handle: u32, n: u32) -> u32 {
    if crate::phys::step(handle, n) {
        STATUS_OK
    } else {
        crate::STATUS_BAD_HANDLE
    }
}

/// Number of dynamic bodies (0 for a bad handle).
#[no_mangle]
pub extern "C" fn phys_bodies(handle: u32) -> u32 {
    crate::phys::bodies(handle).unwrap_or(0)
}

/// Writes, for each dynamic body of the scene in order, its index among the poses (`u32::MAX`
/// when it had no mass and stayed static) to `out` (one little-endian `u32` each). Returns 0, 1
/// for a bad handle, 3 for a null `out`.
///
/// # Safety
///
/// `out` must be null or point to 4 writable bytes per dynamic body of the scene.
#[no_mangle]
pub unsafe extern "C" fn phys_ids(handle: u32, out: *mut u8) -> u32 {
    if out.is_null() {
        return STATUS_NULL_POINTER;
    }
    let Some(ids) = crate::phys::ids(handle) else {
        return crate::STATUS_BAD_HANDLE;
    };
    let bytes: Vec<u8> = ids.iter().flat_map(|v| v.to_le_bytes()).collect();
    // SAFETY: the caller promises 4 writable bytes per dynamic body, which is `bytes.len()`;
    // byte-wise copy needs no alignment and `bytes` is a fresh allocation.
    unsafe { std::ptr::copy_nonoverlapping(bytes.as_ptr(), out, bytes.len()) };
    STATUS_OK
}

/// Writes the pose of every body to `out`: 7 little-endian `f32` each (translation x, y, z, then
/// the rotation quaternion x, y, z, w). Returns 0, 1 for a bad handle, 3 for a null `out`.
///
/// # Safety
///
/// `out` must be null or point to `phys_bodies(handle) * 28` writable bytes.
#[no_mangle]
pub unsafe extern "C" fn phys_poses(handle: u32, out: *mut u8) -> u32 {
    if out.is_null() {
        return STATUS_NULL_POINTER;
    }
    let Some(poses) = crate::phys::poses(handle) else {
        return crate::STATUS_BAD_HANDLE;
    };
    let bytes: Vec<u8> = poses.iter().flat_map(|v| v.to_le_bytes()).collect();
    // SAFETY: the caller promises 28 writable bytes per body, which is `bytes.len()`; byte-wise
    // copy needs no alignment and `bytes` is a fresh allocation.
    unsafe { std::ptr::copy_nonoverlapping(bytes.as_ptr(), out, bytes.len()) };
    STATUS_OK
}

/// Bodies awake (0 for a bad handle).
#[no_mangle]
pub extern "C" fn phys_awake(handle: u32) -> u32 {
    crate::phys::awake(handle).unwrap_or(0)
}

/// 1 when every body sleeps (the simulation stops by itself), 0 when not, 2 for a bad handle.
#[no_mangle]
pub extern "C" fn phys_settled(handle: u32) -> u32 {
    match crate::phys::settled(handle) {
        Some(true) => 1,
        Some(false) => 0,
        None => 2,
    }
}

/// Steps simulated so far (0 for a bad handle): the simulated time is this over 240.
#[no_mangle]
pub extern "C" fn phys_steps(handle: u32) -> u32 {
    crate::phys::steps(handle).unwrap_or(0)
}

/// FNV-1a of the poses (rt-phys `World::hash`), for the parity check (0 for a bad handle).
#[no_mangle]
pub extern "C" fn phys_hash(handle: u32) -> u32 {
    crate::phys::hash(handle).unwrap_or(0)
}
