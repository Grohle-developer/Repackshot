//! Rain, dust and snow on the parts (`rt_phys::wet_parts`, phase S3c) for the page's physics
//! worker: a registry of simulations built from `WPT1` specs, stepped, and read back (the layout of
//! the samples once, a frame at a time). The safe logic only; the C ABI shims are in [`crate::ffi`]
//! (`wpt_*`).

use rt_phys::wet_parts::{PartsSpec, WetParts};
use std::sync::{Mutex, MutexGuard, PoisonError};

/// Most steps one `wpt_step` call runs (a minute of simulated time).
pub const MAX_STEPS_PER_CALL: u32 = 240 * 60;

struct Loaded {
    parts: WetParts,
    /// The last bytes asked for (`wpt_layout`, `wpt_frame`), until they are copied.
    out: Vec<u8>,
}

static SIMS: Mutex<Vec<Option<Loaded>>> = Mutex::new(Vec::new());

fn sims() -> MutexGuard<'static, Vec<Option<Loaded>>> {
    SIMS.lock().unwrap_or_else(PoisonError::into_inner)
}

/// Builds the parts from `WPT1` bytes. Returns the handle, or 0 after recording the error.
pub fn new(bytes: &[u8]) -> u32 {
    let spec = match PartsSpec::parse(bytes) {
        Ok(s) => s,
        Err(e) => {
            crate::set_error(&e);
            return 0;
        }
    };
    crate::set_error("");
    let loaded = Loaded {
        parts: WetParts::new(spec),
        out: Vec::new(),
    };
    let mut reg = sims();
    let slot = match reg.iter().position(Option::is_none) {
        Some(free) => free,
        None => {
            reg.push(None);
            reg.len() - 1
        }
    };
    reg[slot] = Some(loaded);
    slot as u32 + 1
}

fn with<R>(handle: u32, f: impl FnOnce(&mut Loaded) -> R) -> Option<R> {
    let mut reg = sims();
    handle
        .checked_sub(1)
        .and_then(|i| reg.get_mut(i as usize))
        .and_then(Option::as_mut)
        .map(f)
}

/// Forgets a simulation. True when there was one.
pub fn free(handle: u32) -> bool {
    let mut reg = sims();
    match handle.checked_sub(1).and_then(|i| reg.get_mut(i as usize)) {
        Some(slot) if slot.is_some() => {
            *slot = None;
            true
        }
        _ => false,
    }
}

/// Simulates `n` steps (at most [`MAX_STEPS_PER_CALL`]). False for a bad handle.
pub fn step(handle: u32, n: u32) -> bool {
    with(handle, |l| l.parts.step(n.min(MAX_STEPS_PER_CALL))).is_some()
}

/// Steps simulated so far.
pub fn steps(handle: u32) -> Option<u32> {
    with(handle, |l| l.parts.steps())
}

/// The simulation's hash ([`WetParts::hash`]).
pub fn hash(handle: u32) -> Option<u32> {
    with(handle, |l| l.parts.hash())
}

/// Keeps the layout of the samples ([`WetParts::layout`]) for [`out_bytes`]; its length.
pub fn layout(handle: u32) -> Option<u32> {
    with(handle, |l| {
        l.out = l.parts.layout();
        l.out.len() as u32
    })
}

/// Takes the record of a frame ([`WetParts::frame`]: the next one starts now) and keeps it for
/// [`out_bytes`]; its length.
pub fn frame(handle: u32) -> Option<u32> {
    with(handle, |l| {
        l.out = l.parts.frame();
        l.out.len() as u32
    })
}

/// The bytes [`layout`] or [`frame`] took last.
pub fn out_bytes(handle: u32) -> Option<Vec<u8>> {
    with(handle, |l| l.out.clone())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rt_phys::example::{parts_spec, wet_parts, PARTS_STEPS};

    #[test]
    fn parts_through_the_registry_are_the_native_ones() {
        let h = new(&parts_spec().to_bytes());
        assert_ne!(h, 0);
        let len = layout(h).unwrap();
        assert_eq!(out_bytes(h).unwrap().len() as u32, len);
        assert_eq!(out_bytes(h).unwrap(), WetParts::new(parts_spec()).layout());
        assert!(step(h, PARTS_STEPS));
        assert_eq!(steps(h), Some(PARTS_STEPS));
        assert_eq!(hash(h), Some(wet_parts().hash()));
        let len = frame(h).unwrap();
        let bytes = out_bytes(h).unwrap();
        assert_eq!(bytes.len() as u32, len);
        let mut native = WetParts::new(parts_spec());
        native.step(PARTS_STEPS);
        assert_eq!(bytes, native.frame());
        assert!(free(h));
        assert!(!free(h));
        assert_eq!(hash(h), None);
        assert_eq!(new(b"WPT0"), 0);
        assert!(!crate::error_message().is_empty());
    }
}
