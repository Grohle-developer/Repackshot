//! The rigid body simulator (`rt-phys`, phase S2) for the page's physics worker: a registry of
//! worlds built from `PHY1` scenes, stepped and read back. The safe logic only; the C ABI shims are
//! in [`crate::ffi`] (`phys_*`).

use rt_phys::{Scene, World};
use std::sync::{Mutex, MutexGuard, PoisonError};

/// Floats per body in [`poses`]: translation x, y, z, then the rotation x, y, z, w.
pub const POSE_FLOATS: usize = 7;

/// Most steps one `phys_step` call runs (a minute of simulated time), so a host cannot hang a
/// worker by mistake.
pub const MAX_STEPS_PER_CALL: u32 = 240 * 60;

struct Loaded {
    world: World,
    /// For each dynamic body of the scene, its index in the world (or `u32::MAX`: no mass).
    ids: Vec<u32>,
}

static WORLDS: Mutex<Vec<Option<Loaded>>> = Mutex::new(Vec::new());

fn worlds() -> MutexGuard<'static, Vec<Option<Loaded>>> {
    WORLDS.lock().unwrap_or_else(PoisonError::into_inner)
}

/// Builds a world from `PHY1` bytes. Returns its handle, or 0 after recording the error (read it
/// with `rt_scene_error_len` and `rt_scene_error_copy`).
pub fn new(bytes: &[u8]) -> u32 {
    let scene = match Scene::parse(bytes) {
        Ok(s) => s,
        Err(e) => {
            crate::set_error(&e);
            return 0;
        }
    };
    let (world, ids) = scene.build();
    crate::set_error("");
    let loaded = Loaded {
        world,
        ids: ids.into_iter().map(|i| i.unwrap_or(u32::MAX)).collect(),
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

/// Runs `f` on the world of `handle`, or `None` for a bad handle.
fn with<R>(handle: u32, f: impl FnOnce(&mut Loaded) -> R) -> Option<R> {
    let mut reg = worlds();
    handle
        .checked_sub(1)
        .and_then(|i| reg.get_mut(i as usize))
        .and_then(Option::as_mut)
        .map(f)
}

/// S3e: runs `f` on the world of `handle` and the pose of each dynamic body of its scene (`None`:
/// no mass), or `None` for a bad handle (S9: the cloth steps the world with itself through it).
pub(crate) fn with_world<R>(
    handle: u32,
    f: impl FnOnce(&mut World, &[Option<u32>]) -> R,
) -> Option<R> {
    with(handle, |w| {
        let ids: Vec<Option<u32>> = w
            .ids
            .iter()
            .map(|&i| (i != u32::MAX).then_some(i))
            .collect();
        f(&mut w.world, &ids)
    })
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
    with(handle, |w| w.world.step(n.min(MAX_STEPS_PER_CALL))).is_some()
}

/// Number of dynamic bodies in the world.
pub fn bodies(handle: u32) -> Option<u32> {
    with(handle, |w| w.world.body_count() as u32)
}

/// The world index of each dynamic body of the scene (`u32::MAX`: it had no mass and is static).
pub fn ids(handle: u32) -> Option<Vec<u32>> {
    with(handle, |w| w.ids.clone())
}

/// The poses, [`POSE_FLOATS`] per body.
pub fn poses(handle: u32) -> Option<Vec<f32>> {
    with(handle, |w| {
        let mut out = Vec::with_capacity(w.world.body_count() * POSE_FLOATS);
        for p in w.world.poses() {
            let (t, q) = (p.translation, p.rotation);
            out.extend_from_slice(&[t.x, t.y, t.z, q.x, q.y, q.z, q.w]);
        }
        out
    })
}

/// Bodies awake.
pub fn awake(handle: u32) -> Option<u32> {
    with(handle, |w| w.world.awake_count() as u32)
}

/// Every body asleep.
pub fn settled(handle: u32) -> Option<bool> {
    with(handle, |w| w.world.settled())
}

/// Steps simulated so far.
pub fn steps(handle: u32) -> Option<u32> {
    with(handle, |w| w.world.steps().min(u32::MAX as u64) as u32)
}

/// The pose hash ([`World::hash`]).
pub fn hash(handle: u32) -> Option<u32> {
    with(handle, |w| w.world.hash())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rt_phys::example::{drop_scene, DROP_STEPS};

    #[test]
    fn a_world_through_the_registry_is_the_native_one() {
        let bytes = drop_scene().to_bytes();
        let h = new(&bytes);
        assert_ne!(h, 0);
        assert_eq!(bodies(h), Some(3));
        assert_eq!(ids(h), Some(vec![0, 1, 2]));
        assert!(step(h, DROP_STEPS));
        let (mut native, _) = drop_scene().build();
        native.step(DROP_STEPS);
        assert_eq!(hash(h), Some(native.hash()));
        assert_eq!(poses(h).unwrap().len(), 3 * POSE_FLOATS);
        assert_eq!(steps(h), Some(DROP_STEPS));
        assert!(free(h));
        assert!(!free(h));
        assert_eq!(hash(h), None);
        assert_eq!(new(b"nope"), 0);
        assert!(!crate::error_message().is_empty());
    }
}
