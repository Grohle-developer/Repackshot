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

/// The denoiser (E5b-1) on a band of `rows` image rows from `origin_y` of an image
/// `width × height` of `samples` samples per pixel. `in_ptr` holds `width * rows * 14`
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
    if in_ptr.is_null() || out_ptr.is_null() {
        return STATUS_NULL_POINTER;
    }
    let len = width as usize * rows as usize * crate::DENOISE_WORDS * 4;
    // SAFETY: non-null, and the caller promises `len` readable bytes; the slice does not outlive
    // this call.
    let input = unsafe { std::slice::from_raw_parts(in_ptr, len) };
    match crate::denoise(width, height, origin_y, rows, samples, y0, y1, input) {
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
