//! Cloth (`rt_phys::cloth`, phase S9) for the page's physics worker: a registry of cloths built from
//! `CLT1` specs, stepped (with the rigid world of a `phys_*` handle, which steps with them, or alone)
//! and read back a frame at a time. The safe logic only; the C ABI shims are in [`crate::ffi`]
//! (`cloth_*`).

use rt_phys::cloth::{Cloth, ClothSpec};
use std::sync::{Mutex, MutexGuard, PoisonError};

/// Most steps one `cloth_step` call runs (a minute of simulated time).
pub const MAX_STEPS_PER_CALL: u32 = 240 * 60;

static CLOTHS: Mutex<Vec<Option<Cloth>>> = Mutex::new(Vec::new());

fn cloths() -> MutexGuard<'static, Vec<Option<Cloth>>> {
    CLOTHS.lock().unwrap_or_else(PoisonError::into_inner)
}

/// Builds the cloth of `CLT1` bytes. Returns the handle, or 0 after recording the error.
pub fn new(bytes: &[u8]) -> u32 {
    let spec = match ClothSpec::parse(bytes) {
        Ok(s) => s,
        Err(e) => {
            crate::set_error(&e);
            return 0;
        }
    };
    crate::set_error("");
    let cloth = Cloth::new(&spec);
    let mut reg = cloths();
    let slot = match reg.iter().position(Option::is_none) {
        Some(free) => free,
        None => {
            reg.push(None);
            reg.len() - 1
        }
    };
    reg[slot] = Some(cloth);
    slot as u32 + 1
}

fn with<R>(handle: u32, f: impl FnOnce(&mut Cloth) -> R) -> Option<R> {
    let mut reg = cloths();
    handle
        .checked_sub(1)
        .and_then(|i| reg.get_mut(i as usize))
        .and_then(Option::as_mut)
        .map(f)
}

/// Forgets a cloth. True when there was one.
pub fn free(handle: u32) -> bool {
    let mut reg = cloths();
    match handle.checked_sub(1).and_then(|i| reg.get_mut(i as usize)) {
        Some(slot) if slot.is_some() => {
            *slot = None;
            true
        }
        _ => false,
    }
}

/// Simulates `n` steps (at most [`MAX_STEPS_PER_CALL`]); with `world` (a `phys_*` handle, 0 for
/// none) the rigid world steps too, a step ahead of the cloth each time. False for a bad handle
/// (the cloth's, or a world that is not there).
pub fn step(handle: u32, world: u32, n: u32) -> bool {
    let n = n.min(MAX_STEPS_PER_CALL);
    with(handle, |c| {
        if world == 0 {
            c.step(n, None);
            true
        } else {
            crate::phys::with_world(world, |w| c.step(n, Some(w))).is_some()
        }
    })
    .unwrap_or(false)
}

/// Vertices of all its pieces.
pub fn vertices(handle: u32) -> Option<u32> {
    with(handle, |c| c.vertex_count() as u32)
}

/// Every vertex of every piece, world mm, x y z each ([`Cloth::positions`]).
pub fn positions(handle: u32) -> Option<Vec<f32>> {
    with(handle, |c| c.positions())
}

/// It has settled ([`Cloth::settled`]).
pub fn settled(handle: u32) -> Option<bool> {
    with(handle, |c| c.settled())
}

/// Steps simulated so far.
pub fn steps(handle: u32) -> Option<u32> {
    with(handle, |c| c.steps().min(u32::MAX as u64) as u32)
}

/// The cloth's hash ([`Cloth::hash`]).
pub fn hash(handle: u32) -> Option<u32> {
    with(handle, |c| c.hash())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rt_phys::example::{cloth_parity_spec, cloth_world, CLOTH_STEPS};

    #[test]
    fn a_cloth_through_the_registry_is_the_native_one() {
        let world = crate::phys::new(&cloth_world().to_bytes());
        assert_ne!(world, 0);
        let h = new(&cloth_parity_spec().to_bytes());
        assert_ne!(h, 0);
        assert_eq!(vertices(h), Some(625));
        assert!(step(h, world, CLOTH_STEPS));
        assert_eq!(steps(h), Some(CLOTH_STEPS));
        assert_eq!(crate::phys::steps(world), Some(CLOTH_STEPS));
        let (mut native_world, _) = cloth_world().build();
        let mut native = Cloth::new(&cloth_parity_spec());
        native.step(CLOTH_STEPS, Some(&mut native_world));
        assert_eq!(hash(h), Some(native.hash()));
        assert_eq!(crate::phys::hash(world), Some(native_world.hash()));
        assert_eq!(positions(h).unwrap(), native.positions());
        // A world that is not there: nothing is stepped.
        assert!(!step(h, 9999, 1));
        assert_eq!(steps(h), Some(CLOTH_STEPS));
        assert!(free(h));
        assert!(!free(h));
        assert_eq!(hash(h), None);
        assert!(crate::phys::free(world));
        assert_eq!(new(b"CLT0"), 0);
        assert!(!crate::error_message().is_empty());
    }
}
