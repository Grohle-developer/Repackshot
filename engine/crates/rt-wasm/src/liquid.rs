//! Liquids (`rt_phys::liquid`, phase S7) for the page: a registry of liquid worlds built from
//! `LIQ1` scenes, stepped, and read back a liquid at a time (its frame record, `LQF1`, and the
//! surface of that record), and the surface of any frame record without a world (the page's own
//! module rebuilds a recorded frame with it). The safe logic only; the C ABI shims are in
//! [`crate::ffi`] (`liq_*`).

use rt_phys::liquid::{mesh_from_frame, LiquidSpec, LiquidWorld};
use std::sync::{Mutex, MutexGuard, PoisonError};

/// Most steps one `liq_step` call runs (ten seconds of simulated time).
pub const MAX_STEPS_PER_CALL: u32 = 240 * 10;

struct Loaded {
    world: LiquidWorld,
    /// The last bytes asked for (`liq_frame`, `liq_surface`), until they are copied.
    out: Vec<u8>,
}

static WORLDS: Mutex<Vec<Option<Loaded>>> = Mutex::new(Vec::new());
/// The last surface `liq_mesh` built from a record, until it is copied.
static MESH: Mutex<Vec<u8>> = Mutex::new(Vec::new());

fn worlds() -> MutexGuard<'static, Vec<Option<Loaded>>> {
    WORLDS.lock().unwrap_or_else(PoisonError::into_inner)
}

/// Builds a liquid world from `LIQ1` bytes. Returns its handle, or 0 after recording the error.
pub fn new(bytes: &[u8]) -> u32 {
    let spec = match LiquidSpec::parse(bytes) {
        Ok(s) => s,
        Err(e) => {
            crate::set_error(&e);
            return 0;
        }
    };
    crate::set_error("");
    let loaded = Loaded {
        world: LiquidWorld::new(&spec),
        out: Vec::new(),
    };
    let mut reg = worlds();
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
    let mut reg = worlds();
    handle
        .checked_sub(1)
        .and_then(|i| reg.get_mut(i as usize))
        .and_then(Option::as_mut)
        .map(f)
}

/// Forgets a world. True when there was one.
pub fn free(handle: u32) -> bool {
    let mut reg = worlds();
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
    with(handle, |l| l.world.step(n.min(MAX_STEPS_PER_CALL))).is_some()
}

/// Steps simulated so far.
pub fn steps(handle: u32) -> Option<u32> {
    with(handle, |l| l.world.steps().min(u32::MAX as u64) as u32)
}

/// The number of liquids.
pub fn liquids(handle: u32) -> Option<u32> {
    with(handle, |l| l.world.liquids() as u32)
}

/// The particles of liquid `i`.
pub fn count(handle: u32, i: u32) -> Option<u32> {
    with(handle, |l| l.world.particles(i as usize).len() as u32)
}

/// The particles' hash ([`LiquidWorld::hash`]).
pub fn hash(handle: u32) -> Option<u32> {
    with(handle, |l| l.world.hash())
}

/// Takes the frame record of liquid `i` and keeps it for [`out_bytes`]; its length in bytes.
pub fn frame(handle: u32, i: u32) -> Option<u32> {
    with(handle, |l| {
        l.out = l.world.frame(i as usize);
        l.out.len() as u32
    })
}

/// Takes the surface of liquid `i` (rebuilt from its frame record, as the page draws it) and
/// keeps its bytes ([`rt_phys::liquid::surface::SurfaceMesh::to_bytes`]) for [`out_bytes`]; their
/// length.
pub fn surface(handle: u32, i: u32) -> Option<u32> {
    with(handle, |l| {
        l.out = l.world.surface(i as usize).to_bytes();
        l.out.len() as u32
    })
}

/// What [`frame`] or [`surface`] took last.
pub fn out_bytes(handle: u32) -> Option<Vec<u8>> {
    with(handle, |l| l.out.clone())
}

/// Builds the surface of a frame record and keeps its bytes for [`mesh_bytes`]: their length, or
/// `None` after recording the error for bytes that are not a record.
pub fn mesh(record: &[u8]) -> Option<u32> {
    match mesh_from_frame(record) {
        Ok(m) => {
            let bytes = m.to_bytes();
            let len = bytes.len() as u32;
            *MESH.lock().unwrap_or_else(PoisonError::into_inner) = bytes;
            crate::set_error("");
            Some(len)
        }
        Err(e) => {
            crate::set_error(&e);
            None
        }
    }
}

/// The surface [`mesh`] built last.
pub fn mesh_bytes() -> Vec<u8> {
    MESH.lock().unwrap_or_else(PoisonError::into_inner).clone()
}

#[cfg(test)]
mod tests {
    use super::*;
    use rt_phys::liquid::example::{pour_spec, POUR_STEPS};

    #[test]
    fn a_liquid_through_the_registry_is_the_native_one() {
        let h = new(&pour_spec().to_bytes());
        assert_ne!(h, 0);
        assert_eq!(liquids(h), Some(1));
        assert!(step(h, POUR_STEPS));
        assert_eq!(steps(h), Some(POUR_STEPS));
        let mut native = LiquidWorld::new(&pour_spec());
        native.step(POUR_STEPS);
        assert_eq!(hash(h), Some(native.hash()));
        assert_eq!(count(h, 0), Some(native.particles(0).len() as u32));
        let len = frame(h, 0).unwrap();
        let record = out_bytes(h).unwrap();
        assert_eq!(record.len() as u32, len);
        assert_eq!(record, native.frame(0));
        // The surface of the world and of its record alone are the same bytes.
        let len = surface(h, 0).unwrap();
        let from_world = out_bytes(h).unwrap();
        assert_eq!(from_world.len() as u32, len);
        assert_eq!(mesh(&record), Some(len));
        assert_eq!(mesh_bytes(), from_world);
        assert!(free(h));
        assert!(!free(h));
        assert_eq!(hash(h), None);
        assert_eq!(new(b"LIQ0"), 0);
        assert!(!crate::error_message().is_empty());
        assert_eq!(mesh(b"nope"), None);
    }
}
