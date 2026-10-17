//! Focus with a click (F1): the engine's own answer to "what is under this pixel, and how far must
//! the lens focus for it to be sharp".
//!
//! * [`image_ray`]: the chief ray of an image point, the ray through the centre of the pupil that
//!   every sample of that point is centred on. It is [`Camera::generate_ray`] with the pupil point
//!   `(0, 0)`, the ray of the exact passes ([`crate::render::centre_ray`]) at that point: the thin
//!   lens with its shift and tilt, a traced lens's chief ray through its real surfaces (with the
//!   artistic distortion and breathing), an orthographic camera's ray, and whatever camera kind
//!   comes next, because it is the camera's own projection and nothing is repeated here.
//! * [`pick`]: that ray and the front-most part it meets ([`Scene::pick`]: the parts only, cut by
//!   the section plane, both sides of every triangle, glass and cut-outs included), with the
//!   point's depth along the view axis and the focus distance that brings it into focus.
//! * [`Camera::focus_distance_to`]: that focus distance for any point. The engine focuses a plane:
//!   at right angles to the view axis at `focus_dist` from the lens centre (the thin lens, and a
//!   traced lens, whose object plane is `focus_dist` in front of the entrance pupil the camera
//!   position stands for), or with a tilt the plane of the hinge rule through the axis point at
//!   `focus_dist` ([`crate::optics`]). The distance is the one that puts the point on that plane:
//!   its depth along the axis, or with a tilt `u = f z / (f − sin α (p · b))`, `z` the point's
//!   depth, `p · b` its offset along `b = forward × axis` and `f` the focal length.
//!
//! The hosts hand these to the interface (`rt_scene_pick` and `rt_scene_focus_at` of `rt-wasm`),
//! which keeps them: nothing here changes what is rendered.

use crate::math::{Ray, Vec3};
use crate::scene::{Camera, Scene};

/// How many floats [`Pick::to_floats`] writes.
pub const PICK_FLOATS: usize = 14;

/// What the front-most part along a chief ray is.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PickHit {
    /// The RSB instance index.
    pub instance: u32,
    /// The ray parameter (the ray's direction is unit: the distance from its origin).
    pub t: f32,
    /// The point, world space.
    pub point: Vec3,
    /// Its depth along the camera's view axis, from the camera position.
    pub depth: f32,
    /// The focus distance that puts it on the plane of sharp focus ([`Camera::focus_distance_to`]).
    pub focus_dist: Option<f32>,
}

/// The chief ray of an image point and what it meets.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Pick {
    /// The chief ray (unit direction).
    pub ray: Ray,
    /// The front-most part along it, if any.
    pub hit: Option<PickHit>,
}

impl Pick {
    /// The pick as [`PICK_FLOATS`] floats, the layout of `rt_scene_pick`: the ray's origin and
    /// direction (x, y, z each), 1 or 0 for a hit, then the hit's `t`, point (x, y, z), instance
    /// index, depth and focus distance (NaN where there is none; all NaN without a hit).
    pub fn to_floats(&self) -> [f32; PICK_FLOATS] {
        let r = &self.ray;
        let mut out = [f32::NAN; PICK_FLOATS];
        out[..6].copy_from_slice(&[
            r.origin.x, r.origin.y, r.origin.z, r.dir.x, r.dir.y, r.dir.z,
        ]);
        out[6] = 0.0;
        if let Some(h) = &self.hit {
            out[6] = 1.0;
            out[7] = h.t;
            out[8] = h.point.x;
            out[9] = h.point.y;
            out[10] = h.point.z;
            out[11] = h.instance as f32;
            out[12] = h.depth;
            out[13] = h.focus_dist.unwrap_or(f32::NAN);
        }
        out
    }
}

/// The aspect ratio of the scene's image, width over height.
fn aspect(scene: &Scene) -> f32 {
    scene.render.width.max(1) as f32 / scene.render.height.max(1) as f32
}

/// The chief ray of image point `(u, v)` of `scene` (`u` left to right and `v` top to bottom over
/// the image, 0 to 1; a pixel's centre is `((x + 0.5) / width, (y + 0.5) / height)`).
pub fn image_ray(scene: &Scene, u: f32, v: f32) -> Ray {
    scene.camera.generate_ray(aspect(scene), u, v, (0.0, 0.0))
}

/// The chief ray of image point `(u, v)` and the front-most part it meets.
pub fn pick(scene: &Scene, u: f32, v: f32) -> Pick {
    let ray = image_ray(scene, u, v);
    let camera = &scene.camera;
    let forward = camera.basis().0;
    let hit = scene.pick(&ray).map(|h| PickHit {
        instance: h.instance,
        t: h.t,
        point: h.point,
        depth: (h.point - camera.position).dot(forward),
        focus_dist: camera.focus_distance_to(h.point),
    });
    Pick { ray, hit }
}

impl Camera {
    /// F1: the focus distance (`focus_dist`) that puts the world point `point` on the plane of
    /// sharp focus (see the module documentation); `None` when none does (a point behind the
    /// camera, or one a tilted plane never reaches). An orthographic camera has no depth of field:
    /// the point's depth.
    pub fn focus_distance_to(&self, point: Vec3) -> Option<f32> {
        if let (Some(lens), false) = (&self.lens, self.ortho) {
            return lens.focus_distance_to(self, point);
        }
        let depth = (point - self.position).dot(self.basis().0);
        (depth > 0.0 && depth.is_finite()).then_some(depth)
    }
}

#[cfg(test)]
mod tests;
