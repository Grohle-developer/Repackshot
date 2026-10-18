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

/// S3e: `n` steps (at most [`MAX_STEPS_PER_CALL`]) of the parts of `handle` and of the bodies of
/// the world `world` (a handle of [`crate::phys`]) together, one after the other: the parts that
/// move go where their bodies are ([`WetParts::step_with`]). False for a bad handle.
pub fn step_with(handle: u32, world: u32, n: u32) -> bool {
    let mut reg = sims();
    let Some(l) = handle
        .checked_sub(1)
        .and_then(|i| reg.get_mut(i as usize))
        .and_then(Option::as_mut)
    else {
        return false;
    };
    crate::phys::with_world(world, |w, ids| {
        l.parts.step_with(w, ids, n.min(MAX_STEPS_PER_CALL))
    })
    .is_some()
}

/// S3e: the parts that move with a body.
pub fn moving(handle: u32) -> Option<u32> {
    with(handle, |l| l.parts.moving_parts() as u32)
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

    #[test]
    fn parts_that_move_step_with_their_world_as_natively() {
        use rt_core::math::Vec3;
        use rt_phys::example::{box_mesh, drop_scene, parts_mesh};
        use rt_phys::wet_parts::{
            PartsExtras, PartsSource, PartsSourceKind, PartsSpec, WetPartSpec,
        };
        let scene = drop_scene();
        let spec = PartsSpec {
            seed: 4,
            cell_mm: 2.0,
            max_samples: 20_000,
            repose_deg: 35.0,
            snow_repose_deg: 50.0,
            meshes: vec![parts_mesh(box_mesh(Vec3::new(30.0, 20.0, 15.0)))],
            parts: vec![WetPartSpec {
                mesh: 0,
                transform: scene.bodies[0].pieces[0].transform,
                advancing_deg: 70.0,
                receding_deg: 50.0,
                soak_mm_s: 0.0,
                flags: 0,
                body: 0,
            }],
            sources: vec![PartsSource {
                kind: PartsSourceKind::Drops,
                density: 3.0e-5,
                velocity: Vec3::new(0.0, 0.0, -6500.0),
                size_mm: 1.2,
                size_var: 0.3,
            }],
            extras: PartsExtras::default(),
        };
        let world = crate::phys::new(&scene.to_bytes());
        let h = new(&spec.to_bytes());
        assert_eq!(moving(h), Some(1));
        assert!(step_with(h, world, 200));
        assert!(step_with(h, world, 40));
        let (mut native_world, ids) = scene.build();
        let mut native = WetParts::new(spec);
        native.step_with(&mut native_world, &ids, 240);
        assert_eq!(hash(h), Some(native.hash()));
        assert_eq!(crate::phys::hash(world), Some(native_world.hash()));
        assert!(!step_with(h, 999, 1));
        assert!(!step_with(999, world, 1));
        assert!(free(h));
        assert!(crate::phys::free(world));
    }
}
