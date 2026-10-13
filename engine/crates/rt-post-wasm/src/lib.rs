//! WebAssembly build of the AI post-processing guard (`rt-post`), `public/engine/post.wasm`.
//!
//! The interface is a plain C ABI written by hand (no `wasm-bindgen`), in the style of `rt-wasm`:
//! the host (a web worker, or Node in the tests) copies bytes into memory obtained from
//! `post_alloc`, and reads results back from buffers it allocated. A **session** holds one job:
//! its plan, the engine image, the passes, the model's tiles of the current attempt and the last
//! delivered image. The step machine is `rt-post`'s; this crate only keeps its inputs between the
//! host's calls and turns its outputs into bytes and JSON.
//!
//! This file holds the safe logic. The raw-pointer shims live in [`ffi`], the only module allowed
//! to use `unsafe`. Every multi-byte value crosses the boundary as little-endian bytes, so no
//! pointer needs to be aligned.

#![deny(unsafe_code)]

use rt_post::{
    accept, control_planes, plan, tile_control, tile_input, Job, LinearImage, Outcome, Passes,
    Plan, Rgb8Image,
};
use std::sync::{Mutex, MutexGuard, PoisonError};

pub mod ffi;

/// Status: success.
pub const STATUS_OK: u32 = 0;
/// Status: the handle is not an open session.
pub const STATUS_BAD_HANDLE: u32 = 1;
/// Status: a tile index, a control kind or a size is wrong.
pub const STATUS_BAD_ARGUMENT: u32 = 2;
/// Status: a required pointer is null.
pub const STATUS_NULL_POINTER: u32 = 3;
/// Status: the image, the passes or a tile output has not been set.
pub const STATUS_MISSING: u32 = 4;
/// Status: `rt-post` refused the input (the message is the last error).
pub const STATUS_INVALID: u32 = 5;

/// `post_accept`: every check passed (the result image is the guarded one).
pub const OUTCOME_ACCEPTED: u32 = 0;
/// `post_accept`: run the model again at the strength in the text.
pub const OUTCOME_RETRY: u32 = 1;
/// `post_accept`: no attempt passed (the result image is the engine's, unchanged).
pub const OUTCOME_REJECTED: u32 = 2;
/// `post_accept` returns `OUTCOME_ERROR + status` when it could not run.
pub const OUTCOME_ERROR: u32 = 16;

/// Control image kinds of `post_tile_control`.
pub const CONTROL_EDGES: u32 = 0;
/// The depth image.
pub const CONTROL_DEPTH: u32 = 1;

/// The passes of a session, owned.
struct OwnedPasses {
    width: u32,
    height: u32,
    part: Vec<u32>,
    material: Vec<u32>,
    normal: Option<Vec<f32>>,
    depth: Option<Vec<f32>>,
    coc: Option<Vec<f32>>,
}

impl OwnedPasses {
    fn view(&self) -> Passes<'_> {
        Passes {
            width: self.width,
            height: self.height,
            part_id: &self.part,
            material_id: &self.material,
            normal: self.normal.as_deref(),
            depth: self.depth.as_deref(),
            coc: self.coc.as_deref(),
        }
    }
}

struct Session {
    plan: Plan,
    image: Option<LinearImage>,
    passes: Option<OwnedPasses>,
    planes: Option<(Vec<u8>, Vec<u8>)>,
    outputs: Vec<Option<Rgb8Image>>,
    result: Option<LinearImage>,
}

struct Registry {
    /// Slot `i` holds the session with handle `i + 1`; freed slots are reused.
    sessions: Vec<Option<Session>>,
    /// The last error message; empty after a call that succeeded.
    error: String,
    /// The last JSON produced (a plan or an outcome).
    text: String,
}

static REGISTRY: Mutex<Registry> = Mutex::new(Registry {
    sessions: Vec::new(),
    error: String::new(),
    text: String::new(),
});

fn registry() -> MutexGuard<'static, Registry> {
    // The registry holds plain data; a panic elsewhere cannot leave it half updated.
    REGISTRY.lock().unwrap_or_else(PoisonError::into_inner)
}

/// The open session `handle` of `sessions` (a free function, so that the registry's other fields
/// stay free to write while it is borrowed).
fn session_of(sessions: &mut [Option<Session>], handle: u32) -> Result<&mut Session, u32> {
    handle
        .checked_sub(1)
        .and_then(|i| sessions.get_mut(i as usize))
        .and_then(Option::as_mut)
        .ok_or(STATUS_BAD_HANDLE)
}

impl Registry {
    fn session(&mut self, handle: u32) -> Result<&mut Session, u32> {
        session_of(&mut self.sessions, handle)
    }
}

/// Little-endian `f32`s from bytes.
pub fn f32s(bytes: &[u8]) -> Vec<f32> {
    bytes
        .chunks_exact(4)
        .map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]]))
        .collect()
}

/// Little-endian `u32`s from bytes.
pub fn u32s(bytes: &[u8]) -> Vec<u32> {
    bytes
        .chunks_exact(4)
        .map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]]))
        .collect()
}

/// Little-endian bytes of `f32`s.
pub fn f32_bytes(values: &[f32]) -> Vec<u8> {
    values.iter().flat_map(|v| v.to_le_bytes()).collect()
}

/// Records `message` as the last error.
pub(crate) fn set_error(message: &str) {
    registry().error = message.to_owned();
}

/// The last error as UTF-8.
pub fn error_message() -> Vec<u8> {
    registry().error.as_bytes().to_vec()
}

/// The last JSON text as UTF-8.
pub fn text() -> Vec<u8> {
    registry().text.as_bytes().to_vec()
}

/// Opens a session for the binary job `bytes` (`Job::from_bytes`); the text is then the plan's
/// JSON. Returns the handle, or 0 after recording the error.
pub fn open(bytes: &[u8]) -> u32 {
    let mut reg = registry();
    let made = Job::from_bytes(bytes).and_then(|job| plan(&job));
    match made {
        Ok(plan) => {
            reg.error.clear();
            reg.text = plan.to_json();
            let tiles = plan.tiles().len();
            let session = Session {
                plan,
                image: None,
                passes: None,
                planes: None,
                outputs: vec![None; tiles],
                result: None,
            };
            let slot = match reg.sessions.iter().position(Option::is_none) {
                Some(free) => free,
                None => {
                    reg.sessions.push(None);
                    reg.sessions.len() - 1
                }
            };
            reg.sessions[slot] = Some(session);
            slot as u32 + 1
        }
        Err(e) => {
            reg.error = e.to_string();
            0
        }
    }
}

/// Closes a session.
pub fn close(handle: u32) -> u32 {
    let mut reg = registry();
    match handle
        .checked_sub(1)
        .and_then(|i| reg.sessions.get_mut(i as usize))
    {
        Some(slot) if slot.is_some() => {
            *slot = None;
            STATUS_OK
        }
        _ => STATUS_BAD_HANDLE,
    }
}

/// Sets the engine image: `width * height * 4` little-endian floats, RGBA.
pub fn set_image(handle: u32, bytes: &[u8], width: u32, height: u32) -> u32 {
    let mut reg = registry();
    let s = match reg.session(handle) {
        Ok(s) => s,
        Err(status) => return status,
    };
    let job = s.plan.job();
    if width != job.width || height != job.height || bytes.len() != (width * height * 16) as usize {
        return STATUS_BAD_ARGUMENT;
    }
    s.image = Some(LinearImage {
        width,
        height,
        rgba: f32s(bytes),
    });
    s.result = None;
    STATUS_OK
}

/// The passes as bytes: the ids required, the rest optional (`None` when not sent).
pub struct PassBytes<'a> {
    /// Width (the job's).
    pub width: u32,
    /// Height.
    pub height: u32,
    /// `partId`, little-endian `u32` per pixel.
    pub part: &'a [u8],
    /// `materialId`.
    pub material: &'a [u8],
    /// `normal`, 3 floats a pixel.
    pub normal: Option<&'a [u8]>,
    /// `depth`.
    pub depth: Option<&'a [u8]>,
    /// `coc`.
    pub coc: Option<&'a [u8]>,
}

/// Sets the passes; they are checked against the job.
pub fn set_passes(handle: u32, passes: PassBytes) -> u32 {
    let mut guard = registry();
    let reg = &mut *guard;
    let s = match session_of(&mut reg.sessions, handle) {
        Ok(s) => s,
        Err(status) => return status,
    };
    let owned = OwnedPasses {
        width: passes.width,
        height: passes.height,
        part: u32s(passes.part),
        material: u32s(passes.material),
        normal: passes.normal.map(f32s),
        depth: passes.depth.map(f32s),
        coc: passes.coc.map(f32s),
    };
    match control_planes(&s.plan, &owned.view()) {
        Ok(planes) => {
            s.planes = Some(planes);
            s.passes = Some(owned);
            s.result = None;
            STATUS_OK
        }
        Err(e) => {
            reg.error = e.to_string();
            STATUS_INVALID
        }
    }
}

/// The model's input for tile `tile`: padded width x height x 3 bytes of sRGB.
pub fn tile_input_bytes(handle: u32, tile: u32) -> Result<Vec<u8>, u32> {
    let mut reg = registry();
    let s = reg.session(handle)?;
    let image = s.image.as_ref().ok_or(STATUS_MISSING)?;
    if tile as usize >= s.plan.tiles().len() {
        return Err(STATUS_BAD_ARGUMENT);
    }
    tile_input(&s.plan, image, tile as usize)
        .map(|i| i.rgb)
        .map_err(|_| STATUS_INVALID)
}

/// A control image of tile `tile` ([`CONTROL_EDGES`] or [`CONTROL_DEPTH`]): padded width x height
/// bytes.
pub fn tile_control_bytes(handle: u32, tile: u32, kind: u32) -> Result<Vec<u8>, u32> {
    let mut reg = registry();
    let s = reg.session(handle)?;
    let planes = s.planes.as_ref().ok_or(STATUS_MISSING)?;
    if tile as usize >= s.plan.tiles().len() || kind > CONTROL_DEPTH {
        return Err(STATUS_BAD_ARGUMENT);
    }
    let control = tile_control(&s.plan, planes, tile as usize).map_err(|_| STATUS_INVALID)?;
    Ok(if kind == CONTROL_EDGES {
        control.edges
    } else {
        control.depth
    })
}

/// Sets the model's output for tile `tile` in this attempt: `width x height x 3` bytes. Any size
/// is taken; one that is not the tile's padded size fails the `size` check in `accept`.
pub fn set_output(handle: u32, tile: u32, width: u32, height: u32, rgb: &[u8]) -> u32 {
    let mut reg = registry();
    let s = match reg.session(handle) {
        Ok(s) => s,
        Err(status) => return status,
    };
    if tile as usize >= s.outputs.len()
        || u64::from(width) * u64::from(height) * 3 != rgb.len() as u64
    {
        return STATUS_BAD_ARGUMENT;
    }
    s.outputs[tile as usize] = Some(Rgb8Image {
        width,
        height,
        rgb: rgb.to_vec(),
    });
    STATUS_OK
}

/// The strength of attempt `attempt` (NaN for a bad handle).
pub fn strength(handle: u32, attempt: u32) -> f32 {
    let mut reg = registry();
    reg.session(handle)
        .map_or(f32::NAN, |s| s.plan.strength(attempt))
}

/// Step 3 on the tiles set for attempt `attempt`. Returns an `OUTCOME_*` and leaves the outcome as
/// JSON in the text (`{"outcome":"ACCEPTED"|"REJECTED","report":{…}}` or
/// `{"outcome":"RETRY","strength":…,"attempt":…,"reason":"…"}`) and the image to deliver in the
/// session (`result_bytes`). The tiles are cleared: a retry sets new ones.
pub fn accept_attempt(handle: u32, attempt: u32) -> u32 {
    let mut guard = registry();
    let reg = &mut *guard;
    let s = match session_of(&mut reg.sessions, handle) {
        Ok(s) => s,
        Err(status) => return OUTCOME_ERROR + status,
    };
    let (Some(image), Some(passes)) = (s.image.as_ref(), s.passes.as_ref()) else {
        return OUTCOME_ERROR + STATUS_MISSING;
    };
    let outputs: Option<Vec<Rgb8Image>> = s.outputs.iter().cloned().collect();
    let Some(outputs) = outputs else {
        return OUTCOME_ERROR + STATUS_MISSING;
    };
    let outcome = accept(&s.plan, image, &passes.view(), &outputs, attempt);
    s.outputs.iter_mut().for_each(|o| *o = None);
    match outcome {
        Ok(Outcome::Accepted { image, report }) => {
            reg.text = format!(
                "{{\"outcome\":\"ACCEPTED\",\"report\":{}}}",
                report.to_json()
            );
            s.result = Some(image);
            reg.error.clear();
            OUTCOME_ACCEPTED
        }
        Ok(Outcome::Retry {
            strength,
            attempt,
            reason,
        }) => {
            reg.text = format!(
                "{{\"outcome\":\"RETRY\",\"strength\":{},\"attempt\":{},\"reason\":{}}}",
                rt_post::report_number(strength),
                attempt,
                rt_post::report_string(&reason)
            );
            s.result = None;
            reg.error.clear();
            OUTCOME_RETRY
        }
        Ok(Outcome::Rejected { report }) => {
            reg.text = format!(
                "{{\"outcome\":\"REJECTED\",\"report\":{}}}",
                report.to_json()
            );
            s.result = Some(image.clone());
            reg.error.clear();
            OUTCOME_REJECTED
        }
        Err(e) => {
            reg.error = e.to_string();
            OUTCOME_ERROR + STATUS_INVALID
        }
    }
}

/// The image the last `accept` delivers, as little-endian RGBA floats.
pub fn result_bytes(handle: u32) -> Result<Vec<u8>, u32> {
    let mut reg = registry();
    let s = reg.session(handle)?;
    s.result
        .as_ref()
        .map(|r| f32_bytes(&r.rgba))
        .ok_or(STATUS_MISSING)
}

#[cfg(test)]
mod tests;
