//! The C ABI exported to the host. Every function here is a thin shim over the safe code in the
//! crate root; the pointer handling is this crate's only `unsafe` and every block says why it is
//! sound.
//!
//! All pointers are offsets into the wasm linear memory. Buffers are created with [`post_alloc`]
//! and released with [`post_free`] (same length). Data crosses as bytes (little-endian numbers),
//! so nothing here requires pointer alignment.
#![allow(unsafe_code)]

use crate::{PassBytes, STATUS_BAD_ARGUMENT, STATUS_NULL_POINTER, STATUS_OK};

/// Guard version, packed as `major << 16 | minor << 8 | patch`.
#[no_mangle]
pub extern "C" fn post_version() -> u32 {
    rt_post::VERSION
}

/// Allocates `len` zeroed bytes in linear memory and returns their address. Never returns null
/// (a zero length gives a dangling but non-null pointer). Release with [`post_free`].
#[no_mangle]
pub extern "C" fn post_alloc(len: u32) -> *mut u8 {
    let buffer: Box<[u8]> = vec![0u8; len as usize].into_boxed_slice();
    Box::into_raw(buffer).cast::<u8>()
}

/// Releases a buffer obtained from [`post_alloc`]. Null is ignored.
///
/// # Safety
///
/// `ptr` must be null or a pointer returned by `post_alloc(len)` with exactly this `len`, and it
/// must not have been freed already.
#[no_mangle]
pub unsafe extern "C" fn post_free(ptr: *mut u8, len: u32) {
    if ptr.is_null() {
        return;
    }
    // SAFETY: by the contract above `ptr` and `len` describe the boxed slice that `post_alloc`
    // leaked, so rebuilding the box returns ownership (and the allocation) to Rust.
    drop(unsafe { Box::from_raw(std::ptr::slice_from_raw_parts_mut(ptr, len as usize)) });
}

/// `len` bytes at `ptr` as a slice, or `None` for a null pointer.
///
/// # Safety
///
/// `ptr` must be null or point to `len` readable bytes that stay valid and unchanged for the
/// lifetime the caller gives the slice (the duration of one exported call).
unsafe fn bytes<'a>(ptr: *const u8, len: usize) -> Option<&'a [u8]> {
    if ptr.is_null() {
        None
    } else {
        // SAFETY: non-null, and the caller promises `len` readable bytes for the slice's life.
        Some(unsafe { std::slice::from_raw_parts(ptr, len) })
    }
}

/// Copies `data` to `out`.
///
/// # Safety
///
/// `out` must point to at least `data.len()` writable bytes.
unsafe fn write(out: *mut u8, data: &[u8]) {
    // SAFETY: the caller promises room for `data.len()` bytes; `data` is a fresh allocation of
    // this crate, so the regions cannot overlap.
    unsafe { std::ptr::copy_nonoverlapping(data.as_ptr(), out, data.len()) };
}

/// Length in bytes of the last error message (0 after a call that succeeded).
#[no_mangle]
pub extern "C" fn post_error_len() -> u32 {
    crate::error_message().len() as u32
}

/// Copies the last error message (UTF-8, no terminator) to `ptr`.
///
/// # Safety
///
/// `ptr` must be null or point to at least [`post_error_len`] writable bytes.
#[no_mangle]
pub unsafe extern "C" fn post_error_copy(ptr: *mut u8) {
    if ptr.is_null() {
        return;
    }
    // SAFETY: the caller promises room for `post_error_len()` bytes (single-threaded host).
    unsafe { write(ptr, &crate::error_message()) };
}

/// Length in bytes of the last JSON text (a plan after `post_open`, an outcome after
/// `post_accept`).
#[no_mangle]
pub extern "C" fn post_text_len() -> u32 {
    crate::text().len() as u32
}

/// Copies the last JSON text (UTF-8, no terminator) to `ptr`.
///
/// # Safety
///
/// `ptr` must be null or point to at least [`post_text_len`] writable bytes.
#[no_mangle]
pub unsafe extern "C" fn post_text_copy(ptr: *mut u8) {
    if ptr.is_null() {
        return;
    }
    // SAFETY: the caller promises room for `post_text_len()` bytes (single-threaded host).
    unsafe { write(ptr, &crate::text()) };
}

/// Opens a session for the `len` bytes of a binary job at `ptr` (`Job::from_bytes`). Returns its
/// handle, or 0 (then see [`post_error_len`]). The text is the plan's JSON.
///
/// # Safety
///
/// `ptr` must be null or point to `len` readable bytes.
#[no_mangle]
pub unsafe extern "C" fn post_open(ptr: *const u8, len: u32) -> u32 {
    // SAFETY: forwarded contract; the slice lives for this call only.
    match unsafe { bytes(ptr, len as usize) } {
        Some(b) => crate::open(b),
        None => {
            crate::set_error("post_open: null pointer");
            0
        }
    }
}

/// Closes a session. Returns 0, or 1 if `handle` is not open.
#[no_mangle]
pub extern "C" fn post_close(handle: u32) -> u32 {
    crate::close(handle)
}

/// Sets the engine image: `width * height * 4` little-endian floats (RGBA) at `ptr`.
///
/// # Safety
///
/// `ptr` must be null or point to `width * height * 16` readable bytes.
#[no_mangle]
pub unsafe extern "C" fn post_set_image(
    handle: u32,
    ptr: *const u8,
    width: u32,
    height: u32,
) -> u32 {
    let len = u64::from(width) * u64::from(height) * 16;
    if len > u64::from(u32::MAX) {
        return STATUS_BAD_ARGUMENT;
    }
    // SAFETY: forwarded contract; the slice lives for this call only.
    match unsafe { bytes(ptr, len as usize) } {
        Some(b) => crate::set_image(handle, b, width, height),
        None => STATUS_NULL_POINTER,
    }
}

/// Sets the passes, each a plane of `width * height` pixels: `part` and `material` little-endian
/// `u32` (required), `normal` 3 floats a pixel, `depth` and `coc` one float (each may be null:
/// not rendered).
///
/// # Safety
///
/// Every non-null pointer must point to its plane's readable bytes (`4 * width * height`, or
/// `12 * width * height` for `normal`).
#[no_mangle]
#[allow(clippy::too_many_arguments)]
pub unsafe extern "C" fn post_set_passes(
    handle: u32,
    width: u32,
    height: u32,
    part: *const u8,
    material: *const u8,
    normal: *const u8,
    depth: *const u8,
    coc: *const u8,
) -> u32 {
    let n = u64::from(width) * u64::from(height) * 4;
    if n * 3 > u64::from(u32::MAX) {
        return STATUS_BAD_ARGUMENT;
    }
    let n = n as usize;
    // SAFETY (all five): forwarded contract; the slices live for this call only.
    let (part, material) = unsafe { (bytes(part, n), bytes(material, n)) };
    let (Some(part), Some(material)) = (part, material) else {
        return STATUS_NULL_POINTER;
    };
    let passes = PassBytes {
        width,
        height,
        part,
        material,
        // SAFETY: as above.
        normal: unsafe { bytes(normal, n * 3) },
        // SAFETY: as above.
        depth: unsafe { bytes(depth, n) },
        // SAFETY: as above.
        coc: unsafe { bytes(coc, n) },
    };
    crate::set_passes(handle, passes)
}

/// Writes the model's input for tile `tile` to `out`: padded width x height x 3 bytes (sRGB).
///
/// # Safety
///
/// `out` must be null or point to that many writable bytes (the plan's JSON gives the size).
#[no_mangle]
pub unsafe extern "C" fn post_tile_input(handle: u32, tile: u32, out: *mut u8) -> u32 {
    if out.is_null() {
        return STATUS_NULL_POINTER;
    }
    match crate::tile_input_bytes(handle, tile) {
        Ok(data) => {
            // SAFETY: the caller promises room for the padded tile.
            unsafe { write(out, &data) };
            STATUS_OK
        }
        Err(status) => status,
    }
}

/// Writes control image `kind` (0 edges, 1 depth) of tile `tile` to `out`: padded width x height
/// bytes.
///
/// # Safety
///
/// `out` must be null or point to that many writable bytes.
#[no_mangle]
pub unsafe extern "C" fn post_tile_control(handle: u32, tile: u32, kind: u32, out: *mut u8) -> u32 {
    if out.is_null() {
        return STATUS_NULL_POINTER;
    }
    match crate::tile_control_bytes(handle, tile, kind) {
        Ok(data) => {
            // SAFETY: the caller promises room for the padded tile.
            unsafe { write(out, &data) };
            STATUS_OK
        }
        Err(status) => status,
    }
}

/// Sets the model's output for tile `tile`: `width * height * 3` bytes of sRGB at `ptr`.
///
/// # Safety
///
/// `ptr` must be null or point to `width * height * 3` readable bytes.
#[no_mangle]
pub unsafe extern "C" fn post_set_output(
    handle: u32,
    tile: u32,
    width: u32,
    height: u32,
    ptr: *const u8,
) -> u32 {
    let len = u64::from(width) * u64::from(height) * 3;
    if len > u64::from(u32::MAX) {
        return STATUS_BAD_ARGUMENT;
    }
    // SAFETY: forwarded contract; the slice lives for this call only.
    match unsafe { bytes(ptr, len as usize) } {
        Some(b) => crate::set_output(handle, tile, width, height, b),
        None => STATUS_NULL_POINTER,
    }
}

/// The img2img strength of attempt `attempt` (NaN for a bad handle).
#[no_mangle]
pub extern "C" fn post_strength(handle: u32, attempt: u32) -> f32 {
    crate::strength(handle, attempt)
}

/// Guards, checks and decides on the tiles set for attempt `attempt`: 0 accepted, 1 retry, 2
/// rejected, 16 + status when it could not run. The text is the outcome's JSON.
#[no_mangle]
pub extern "C" fn post_accept(handle: u32, attempt: u32) -> u32 {
    crate::accept_attempt(handle, attempt)
}

/// Writes the image the last `post_accept` delivers to `out`: `width * height * 4`
/// little-endian floats (RGBA).
///
/// # Safety
///
/// `out` must be null or point to `width * height * 16` writable bytes.
#[no_mangle]
pub unsafe extern "C" fn post_result(handle: u32, out: *mut u8) -> u32 {
    if out.is_null() {
        return STATUS_NULL_POINTER;
    }
    match crate::result_bytes(handle) {
        Ok(data) => {
            // SAFETY: the caller promises room for the whole image.
            unsafe { write(out, &data) };
            STATUS_OK
        }
        Err(status) => status,
    }
}

/// The test model (X6) on `width * height * 3` sRGB bytes at `ptr` whose top-left pixel is
/// `(x0, y0)` of the image, at `strength` with `seed`, written to `out` (as many bytes).
///
/// # Safety
///
/// `ptr` and `out` must be null or point to `width * height * 3` readable (and writable) bytes.
#[no_mangle]
#[allow(clippy::too_many_arguments)]
pub unsafe extern "C" fn post_test_model(
    ptr: *const u8,
    width: u32,
    height: u32,
    x0: u32,
    y0: u32,
    strength: f32,
    seed: u32,
    out: *mut u8,
) -> u32 {
    let len = u64::from(width) * u64::from(height) * 3;
    if len > u64::from(u32::MAX) {
        return STATUS_BAD_ARGUMENT;
    }
    if out.is_null() {
        return STATUS_NULL_POINTER;
    }
    // SAFETY: forwarded contract; the slice lives for this call only.
    let Some(input) = (unsafe { bytes(ptr, len as usize) }) else {
        return STATUS_NULL_POINTER;
    };
    match crate::test_model_bytes(input, width, height, x0, y0, strength, seed) {
        Ok(data) => {
            // SAFETY: the caller promises room for as many bytes as it gave.
            unsafe { write(out, &data) };
            STATUS_OK
        }
        Err(status) => status,
    }
}
