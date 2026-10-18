//! Rain and dust on the front glass (`rt_phys::wet`, phase S3b) for the page's physics worker: a
//! registry of panes built from `WET1` specs, stepped, and read back a frame at a time. The safe
//! logic only; the C ABI shims are in [`crate::ffi`] (`wet_*`).

use rt_phys::wet::{WetPane, WetSpec};
use std::sync::{Mutex, MutexGuard, PoisonError};

/// Most steps one `wet_step` call runs (a minute of simulated time).
pub const MAX_STEPS_PER_CALL: u32 = 240 * 60;

struct Loaded {
    pane: WetPane,
    /// The record of the last frame asked for (`wet_frame`), until it is copied.
    frame: Vec<u8>,
}

static PANES: Mutex<Vec<Option<Loaded>>> = Mutex::new(Vec::new());

fn panes() -> MutexGuard<'static, Vec<Option<Loaded>>> {
    PANES.lock().unwrap_or_else(PoisonError::into_inner)
}

/// Builds a pane from `WET1` bytes. Returns its handle, or 0 after recording the error.
pub fn new(bytes: &[u8]) -> u32 {
    let spec = match WetSpec::parse(bytes) {
        Ok(s) => s,
        Err(e) => {
            crate::set_error(&e);
            return 0;
        }
    };
    crate::set_error("");
    let loaded = Loaded {
        pane: WetPane::new(spec),
        frame: Vec::new(),
    };
    let mut reg = panes();
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
    let mut reg = panes();
    handle
        .checked_sub(1)
        .and_then(|i| reg.get_mut(i as usize))
        .and_then(Option::as_mut)
        .map(f)
}

/// Forgets a pane. True when there was one.
pub fn free(handle: u32) -> bool {
    let mut reg = panes();
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
    with(handle, |l| l.pane.step(n.min(MAX_STEPS_PER_CALL))).is_some()
}

/// Steps simulated so far.
pub fn steps(handle: u32) -> Option<u32> {
    with(handle, |l| l.pane.steps())
}

/// The pane's hash ([`WetPane::hash`]).
pub fn hash(handle: u32) -> Option<u32> {
    with(handle, |l| l.pane.hash())
}

/// Takes the record of a frame ([`WetPane::frame`]: the next one starts now) and keeps it for
/// [`frame_bytes`]; its length in bytes.
pub fn frame(handle: u32) -> Option<u32> {
    with(handle, |l| {
        l.frame = l.pane.frame();
        l.frame.len() as u32
    })
}

/// The record [`frame`] took last.
pub fn frame_bytes(handle: u32) -> Option<Vec<u8>> {
    with(handle, |l| l.frame.clone())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rt_phys::example::{wet_pane, wet_spec, WET_STEPS};

    #[test]
    fn a_pane_through_the_registry_is_the_native_one() {
        let h = new(&wet_spec().to_bytes());
        assert_ne!(h, 0);
        assert!(step(h, WET_STEPS));
        assert_eq!(steps(h), Some(WET_STEPS));
        assert_eq!(hash(h), Some(wet_pane().hash()));
        let len = frame(h).unwrap();
        let bytes = frame_bytes(h).unwrap();
        assert_eq!(bytes.len() as u32, len);
        assert_eq!(bytes, wet_pane().frame());
        // The next frame has the same drops and nothing new.
        let again = frame(h).unwrap();
        assert!(again < len || wet_pane().motes_landed() == 0);
        assert!(free(h));
        assert!(!free(h));
        assert_eq!(hash(h), None);
        assert_eq!(new(b"WET0"), 0);
        assert!(!crate::error_message().is_empty());
    }
}
