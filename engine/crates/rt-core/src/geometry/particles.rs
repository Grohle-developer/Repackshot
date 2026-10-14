//! Particle sets (S4a): the particles of one ambient effect ([`rt_sim`]) as analytic primitives,
//! with a flat BVH of their own that is a single leaf of the instance BVH.
//!
//! **Primitives.** A sphere (dust, pollen, droplets, bubbles), an oriented disc (a snowflake, a
//! flake of confetti or ash) and a capsule, the sphere swept along a segment (the streak of a
//! raindrop without motion blur). The ray–sphere test is the numerically stable one of E.
//! Haines, J. Günther and T. Akenine-Möller, "Precision Improvements for Ray/Sphere
//! Intersection", *Ray Tracing Gems*, ch. 7, 2019: the discriminant from the squared distance of
//! the centre to the ray's line (no cancellation of `b² − c` for a tiny sphere far away), and
//! the two roots by the quadratic formula's stable form, the nearer one as `c / q`. The capsule
//! is its cylinder (the same test in the plane across its axis, kept between its ends) and its two
//! end spheres (kept beyond the ends): every candidate root is the boundary of the convex
//! capsule, so the nearest one in range is the entry or, from inside, the exit.
//!
//! **Ids.** A hit names the particle by its id in the effect (`RayHit::triangle`), never by where
//! it sits in the BVH's order, so the tie-break of the traversal, and with it every pixel, does not
//! depend on how the tree was built.
//!
//! **Minimum size on screen** (S0 §4). For camera rays a particle thinner than [`MIN_PIXELS`]
//! pixels is widened to that many ([`PixelFootprint`]: a pixel's size at the particle's distance
//! from the camera); [`ParticleSet::coverage`] is the real area over the widened one, by which
//! the integrator scales the particle's contribution, letting the rest of the widened area show
//! what is behind it (see [`crate::integrator`]). Other rays see the particle's real size. The
//! BVH is built over the real sizes, once per effect: a camera ray grows its boxes by the most
//! any particle of the set is widened ([`ParticleSet::camera_pad`]), so moving the camera or
//! changing the image size never builds it again.

use super::bvh::{leaf_range, leaf_ref, BuildParams, Bvh, BvhWidth};
use crate::math::{Aabb, Ray, Vec3};
use crate::scene::Camera;
use rt_sim::{AmbientParams, Particle, Shape};

/// The thinnest a particle looks to a camera ray, in pixels (S0 §4).
pub const MIN_PIXELS: f32 = 0.35;

/// Leaf policy of a particle BVH.
const PARTICLE_LEAVES: BuildParams = BuildParams {
    leaf_target: 1,
    leaf_max: 1,
};

/// What a camera ray "sees" of a pixel: its width at a distance, for the minimum size.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PixelFootprint {
    /// Where camera rays come from (the lens centre).
    pub origin: Vec3,
    /// Width of a pixel per unit of distance from `origin` (perspective; 0 orthographic).
    pub per_distance: f32,
    /// Width of a pixel at any distance (orthographic; 0 perspective).
    pub constant: f32,
}

impl PixelFootprint {
    /// No widening.
    pub const NONE: PixelFootprint = PixelFootprint {
        origin: Vec3::ZERO,
        per_distance: 0.0,
        constant: 0.0,
    };

    /// The footprint of a pixel of a `width x height` image through `camera` (the sensor size
    /// applies to the longer side, as [`Camera::generate_ray`] does).
    pub fn of(camera: &Camera, width: u32, height: u32) -> PixelFootprint {
        let (width, height) = (width.max(1), height.max(1));
        if camera.ortho {
            return PixelFootprint {
                origin: camera.position,
                per_distance: 0.0,
                constant: camera.ortho_width / width as f32,
            };
        }
        let long = width.max(height) as f32;
        PixelFootprint {
            origin: camera.position,
            per_distance: camera.sensor_mm / (long * camera.focal_mm.max(1.0e-6)),
            constant: 0.0,
        }
    }

    /// Width of a pixel at `p`.
    pub fn at(&self, p: Vec3) -> f32 {
        self.constant + self.per_distance * (p - self.origin).length()
    }
}

/// The particles of one effect, ready to be traced.
#[derive(Clone, Debug, PartialEq)]
pub struct ParticleSet {
    params: AmbientParams,
    footprint: PixelFootprint,
    shape: Shape,
    // Per particle, in the order of the BVH's leaves.
    centres: Vec<Vec3>,
    radii: Vec<f32>,
    /// Disc: unit normal; capsule: half segment; sphere: zero.
    axes: Vec<Vec3>,
    tints: Vec<u32>,
    ids: Vec<u32>,
    /// Slot of each id.
    slots: Vec<u32>,
    bvh: Bvh,
    bounds: Aabb,
    /// Some particle is widened for camera rays.
    widened: bool,
    /// The most a particle is widened for camera rays (an upper bound), by which their boxes grow.
    camera_pad: f32,
}

/// The nearest root of `a t² + 2 b t + c = 0` in `[t_min, t_max]` given the reduced discriminant
/// `disc = b² / a − c` computed without cancellation (`disc >= 0`), and the far root as well.
#[inline(always)]
fn stable_roots(a: f32, b: f32, c: f32, disc: f32) -> (f32, f32) {
    let s = (a * disc).sqrt();
    // q = -(b + sign(b) sqrt(b² - a c)): no cancellation.
    let q = -(b + if b < 0.0 { -s } else { s });
    if q == 0.0 {
        return (0.0, 0.0);
    }
    let (t0, t1) = (c / q, q / a);
    if t0 <= t1 {
        (t0, t1)
    } else {
        (t1, t0)
    }
}

/// Roots of a ray against a sphere (centre `c`, radius `r`), `None` when it misses.
#[inline(always)]
fn sphere_roots(ray: &Ray, c: Vec3, r: f32) -> Option<(f32, f32)> {
    let f = ray.origin - c;
    let a = ray.dir.dot(ray.dir);
    let b = f.dot(ray.dir);
    // The centre's squared distance to the ray's line, as Haines et al. compute it.
    let l = f - ray.dir * (b / a);
    let disc = r * r - l.dot(l);
    // NaN (a zero direction) misses as well.
    if disc.is_nan() || disc < 0.0 {
        return None;
    }
    let cc = f.dot(f) - r * r;
    Some(stable_roots(a, b, cc, disc))
}

/// The smallest of `t0`, `t1` in `[t_min, t_max]`, folded into `best`.
#[inline(always)]
fn keep(best: &mut Option<f32>, t: f32, t_min: f32, t_max: f32) {
    let nearer = match *best {
        Some(b) => t < b,
        None => true,
    };
    if t >= t_min && t <= t_max && nearer {
        *best = Some(t);
    }
}

/// Every root of the ray against the capsule's surface (centre `c`, half segment `half`, radius
/// `r`): up to two of its cylinder (kept between its ends) and two of each end sphere (kept beyond
/// its end); the unused entries are NaN. No closures: this must inline into the traversal kernel.
#[inline(always)]
fn capsule_roots(ray: &Ray, c: Vec3, half: Vec3, r: f32) -> [f32; 6] {
    let mut roots = [f32::NAN; 6];
    let a_end = c - half;
    let axis_len = 2.0 * half.length();
    if axis_len <= 0.0 {
        if let Some((t0, t1)) = sphere_roots(ray, c, r) {
            roots[0] = t0;
            roots[1] = t1;
        }
        return roots;
    }
    let u = half * (2.0 / axis_len);
    // The cylinder: the same quadratic in the plane across the axis.
    let o = ray.origin - a_end;
    let d_perp = ray.dir - u * ray.dir.dot(u);
    let o_perp = o - u * o.dot(u);
    let a = d_perp.dot(d_perp);
    if a > 0.0 {
        let b = o_perp.dot(d_perp);
        let l = o_perp - d_perp * (b / a);
        let disc = r * r - l.dot(l);
        if disc >= 0.0 {
            let cc = o_perp.dot(o_perp) - r * r;
            let (t0, t1) = stable_roots(a, b, cc, disc);
            let s0 = (ray.at(t0) - a_end).dot(u);
            let s1 = (ray.at(t1) - a_end).dot(u);
            if (0.0..=axis_len).contains(&s0) {
                roots[0] = t0;
            }
            if (0.0..=axis_len).contains(&s1) {
                roots[1] = t1;
            }
        }
    }
    // The end spheres, beyond the ends.
    if let Some((t0, t1)) = sphere_roots(ray, a_end, r) {
        if (ray.at(t0) - a_end).dot(u) < 0.0 {
            roots[2] = t0;
        }
        if (ray.at(t1) - a_end).dot(u) < 0.0 {
            roots[3] = t1;
        }
    }
    if let Some((t0, t1)) = sphere_roots(ray, c + half, r) {
        if (ray.at(t0) - a_end).dot(u) > axis_len {
            roots[4] = t0;
        }
        if (ray.at(t1) - a_end).dot(u) > axis_len {
            roots[5] = t1;
        }
    }
    roots
}

impl ParticleSet {
    /// The particles of `params` (in id order, as [`rt_sim::evaluate`] gives them), widened for
    /// camera rays by `footprint`, with their BVH.
    pub fn new(
        params: &AmbientParams,
        particles: &[Particle],
        footprint: PixelFootprint,
        width: BvhWidth,
    ) -> ParticleSet {
        let shape = params.shape;
        let n = particles.len();
        let centre = |p: &Particle| Vec3::new(p.centre[0], p.centre[1], p.centre[2]);
        let axis = |p: &Particle| Vec3::new(p.axis[0], p.axis[1], p.axis[2]);
        let mut boxes = Vec::with_capacity(n);
        let mut centroids = Vec::with_capacity(n);
        for p in particles {
            let c = centre(p);
            let extent = match shape {
                Shape::Capsule => axis(p).abs() + Vec3::splat(p.radius),
                _ => Vec3::splat(p.radius),
            };
            // Padded so that the rounding of the box test can never cut off a hit.
            let pad = extent * 1.0e-4 + Vec3::splat(c.abs().max_component() * 1.0e-6);
            boxes.push(Aabb::new(c - extent - pad, c + extent + pad));
            centroids.push(c);
        }
        let mut order: Vec<u32> = Vec::with_capacity(n);
        let bvh = Bvh::build(&boxes, &centroids, PARTICLE_LEAVES, width, |prims| {
            let first = order.len();
            order.extend_from_slice(prims);
            leaf_ref(first, prims.len())
        });
        let mut slots = vec![0u32; n];
        for (slot, &i) in order.iter().enumerate() {
            slots[i as usize] = slot as u32;
        }
        let bounds = boxes.iter().fold(Aabb::EMPTY, |acc, b| acc.union(*b));
        let pick = |i: &u32| &particles[*i as usize];
        let set = ParticleSet {
            params: *params,
            footprint: PixelFootprint::NONE,
            shape,
            centres: order.iter().map(|i| centre(pick(i))).collect(),
            radii: order.iter().map(|i| pick(i).radius).collect(),
            axes: order.iter().map(|i| axis(pick(i))).collect(),
            tints: order.iter().map(|i| pick(i).tint).collect(),
            ids: order.iter().map(|i| pick(i).id).collect(),
            slots,
            bvh,
            bounds,
            widened: false,
            camera_pad: 0.0,
        };
        set.with_footprint(footprint, width)
    }

    /// Evaluates the particles of `params` ([`rt_sim::evaluate`], all `count` of them) and
    /// builds the set.
    pub fn evaluate(
        params: &AmbientParams,
        footprint: PixelFootprint,
        width: BvhWidth,
    ) -> ParticleSet {
        ParticleSet::new(
            params,
            &rt_sim::evaluate(params, params.count),
            footprint,
            width,
        )
    }

    /// The particles again, in id order (what [`rt_sim::evaluate`] gave).
    pub fn particles(&self) -> Vec<Particle> {
        self.slots
            .iter()
            .map(|&s| {
                let s = s as usize;
                let (c, a) = (self.centres[s], self.axes[s]);
                Particle {
                    centre: [c.x, c.y, c.z],
                    radius: self.radii[s],
                    axis: [a.x, a.y, a.z],
                    tint: self.tints[s],
                    id: self.ids[s],
                }
            })
            .collect()
    }

    /// The same particles for another camera footprint: only how much camera rays widen them
    /// changes, neither the particles nor their BVH (built again only for another `width`).
    pub fn with_footprint(mut self, footprint: PixelFootprint, width: BvhWidth) -> ParticleSet {
        if self.bvh.stats().width != width && !self.is_empty() {
            let particles = self.particles();
            return ParticleSet::new(&self.params, &particles, footprint, width);
        }
        self.footprint = footprint;
        self.widened = (0..self.len()).any(|s| self.camera_radius(s) > self.radii[s]);
        // The farthest a particle can be is a corner of the bounds: no particle is widened by more.
        let b = self.bounds;
        self.camera_pad = if self.widened && !b.is_empty() {
            let mut farthest = 0.0f32;
            for corner in 0..8 {
                let pick = |bit: u32, lo: f32, hi: f32| if corner & bit != 0 { hi } else { lo };
                let p = Vec3::new(
                    pick(1, b.min.x, b.max.x),
                    pick(2, b.min.y, b.max.y),
                    pick(4, b.min.z, b.max.z),
                );
                farthest = farthest.max(footprint.at(p));
            }
            // A little more than the widest radius, for the rounding of the box test.
            0.5 * MIN_PIXELS * farthest * (1.0 + 1.0e-4)
        } else {
            0.0
        };
        self
    }

    /// The radius a camera ray sees of the particle in `slot`: its own, or the minimum size on
    /// screen at its distance from the camera.
    #[inline(always)]
    fn camera_radius(&self, slot: usize) -> f32 {
        let r = self.radii[slot];
        if self.footprint.per_distance == 0.0 && self.footprint.constant == 0.0 {
            return r;
        }
        r.max(0.5 * MIN_PIXELS * self.footprint.at(self.centres[slot]))
    }

    /// How much the boxes of the particles grow for camera rays (the most any is widened).
    #[inline(always)]
    pub fn camera_pad(&self) -> f32 {
        self.camera_pad
    }

    /// The effect's parameters.
    pub fn params(&self) -> &AmbientParams {
        &self.params
    }

    /// The camera footprint the set was widened for.
    pub fn footprint(&self) -> PixelFootprint {
        self.footprint
    }

    /// Number of particles.
    pub fn len(&self) -> usize {
        self.ids.len()
    }

    /// True without particles.
    pub fn is_empty(&self) -> bool {
        self.ids.is_empty()
    }

    /// The box of every particle (at its real size).
    pub fn bounds(&self) -> Aabb {
        self.bounds
    }

    /// Index of the effect's material.
    pub fn material_id(&self) -> u32 {
        self.params.material_id
    }

    /// True when some particle is widened for camera rays.
    pub fn widened(&self) -> bool {
        self.widened
    }

    pub(crate) fn bvh(&self) -> &Bvh {
        &self.bvh
    }

    /// The slot of particle `id`.
    #[inline(always)]
    pub(crate) fn slot(&self, id: u32) -> Option<usize> {
        self.slots.get(id as usize).map(|&s| s as usize)
    }

    /// The id of the particle in `slot`.
    #[inline(always)]
    pub(crate) fn id(&self, slot: usize) -> u32 {
        self.ids[slot]
    }

    /// The slots of a leaf reference.
    #[inline(always)]
    pub(crate) fn leaf(&self, reference: u32) -> std::ops::Range<usize> {
        let (first, count) = leaf_range(reference);
        let end = (first + count).min(self.ids.len());
        first.min(end)..end
    }

    /// Nearest `t` in `[t_min, t_max]` where `ray` meets the particle in `slot` (seen by a camera
    /// ray: widened).
    #[inline(always)]
    pub(crate) fn hit(
        &self,
        slot: usize,
        ray: &Ray,
        t_min: f32,
        t_max: f32,
        camera: bool,
    ) -> Option<f32> {
        let c = self.centres[slot];
        let r = if camera && self.widened {
            self.camera_radius(slot)
        } else {
            self.radii[slot]
        };
        let mut best = None;
        match self.shape {
            Shape::Sphere => {
                let (t0, t1) = sphere_roots(ray, c, r)?;
                keep(&mut best, t0, t_min, t_max);
                keep(&mut best, t1, t_min, t_max);
            }
            Shape::Disc => {
                let n = self.axes[slot];
                let denom = ray.dir.dot(n);
                if denom == 0.0 {
                    return None;
                }
                let t = (c - ray.origin).dot(n) / denom;
                let q = ray.at(t) - c;
                if q.dot(q) <= r * r {
                    keep(&mut best, t, t_min, t_max);
                }
            }
            Shape::Capsule => {
                for t in capsule_roots(ray, c, self.axes[slot], r) {
                    keep(&mut best, t, t_min, t_max);
                }
            }
        }
        best
    }

    /// Where `ray` leaves the particle `id` it entered at `t` (the farthest boundary along it; `t`
    /// itself for a disc), for camera rays (widened) or not.
    pub fn exit(&self, id: u32, ray: &Ray, t: f32, camera: bool) -> f32 {
        let Some(slot) = self.slot(id) else {
            return t;
        };
        let c = self.centres[slot];
        let r = if camera && self.widened {
            self.camera_radius(slot)
        } else {
            self.radii[slot]
        };
        let mut far = t;
        match self.shape {
            Shape::Sphere => {
                if let Some((_, t1)) = sphere_roots(ray, c, r) {
                    far = far.max(t1);
                }
            }
            Shape::Disc => {}
            Shape::Capsule => {
                for root in capsule_roots(ray, c, self.axes[slot], r) {
                    if root > far {
                        far = root;
                    }
                }
            }
        }
        far
    }

    /// The outward unit normal of particle `id` at a point `p` of its surface.
    pub fn normal(&self, id: u32, p: Vec3) -> Vec3 {
        let Some(slot) = self.slot(id) else {
            return Vec3::new(0.0, 0.0, 1.0);
        };
        let c = self.centres[slot];
        let n = match self.shape {
            Shape::Sphere => p - c,
            Shape::Disc => self.axes[slot],
            Shape::Capsule => {
                let half = self.axes[slot];
                let len2 = half.dot(half);
                let s = if len2 > 0.0 {
                    ((p - c).dot(half) / len2).clamp(-1.0, 1.0)
                } else {
                    0.0
                };
                p - (c + half * s)
            }
        };
        let n = n.normalize();
        if n.length_squared() > 0.0 {
            n
        } else {
            Vec3::new(0.0, 0.0, 1.0)
        }
    }

    /// The real area of particle `id` over the area camera rays see (1 when it is not widened).
    pub fn coverage(&self, id: u32) -> f32 {
        let Some(slot) = self.slot(id) else {
            return 1.0;
        };
        let (r, w) = (self.radii[slot], self.camera_radius(slot));
        if w <= r {
            return 1.0;
        }
        match self.shape {
            Shape::Capsule => {
                let length = 2.0 * self.axes[slot].length();
                let pi = crate::fmath::PI;
                (2.0 * r * length + pi * r * r) / (2.0 * w * length + pi * w * w)
            }
            _ => (r / w) * (r / w),
        }
    }

    /// The tint seed of particle `id`.
    pub fn tint(&self, id: u32) -> u32 {
        self.slot(id).map_or(0, |s| self.tints[s])
    }

    /// Particle `id`'s real radius, centre and axis (tests and tools).
    pub fn particle(&self, id: u32) -> Option<(Vec3, f32, Vec3)> {
        let s = self.slot(id)?;
        Some((self.centres[s], self.radii[s], self.axes[s]))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn set_of(shape: Shape, particles: Vec<Particle>, footprint: PixelFootprint) -> ParticleSet {
        let params = AmbientParams {
            shape,
            count: particles.len() as u32,
            ..AmbientParams::default()
        };
        ParticleSet::new(&params, &particles, footprint, BvhWidth::Four)
    }

    fn particle(id: u32, c: [f32; 3], r: f32, axis: [f32; 3]) -> Particle {
        Particle {
            centre: c,
            radius: r,
            axis,
            tint: id * 7,
            id,
        }
    }

    #[test]
    fn a_tiny_far_sphere_is_hit_where_the_maths_says() {
        // 0.01 mm at 2 m: b² - c would lose the radius entirely in f32.
        let set = set_of(
            Shape::Sphere,
            vec![particle(0, [0.0, 2000.0, 0.0], 0.01, [0.0; 3])],
            PixelFootprint::NONE,
        );
        let ray = Ray::new(Vec3::new(0.005, 0.0, 0.0), Vec3::new(0.0, 1.0, 0.0));
        let t = set.hit(0, &ray, ray.t_min, f32::MAX, false).expect("hit");
        let expected = 2000.0 - (0.01f32 * 0.01 - 0.005 * 0.005).sqrt();
        assert!((t - expected).abs() < 2.0e-4, "{t} vs {expected}");
        let miss = Ray::new(Vec3::new(0.011, 0.0, 0.0), Vec3::new(0.0, 1.0, 0.0));
        assert_eq!(set.hit(0, &miss, miss.t_min, f32::MAX, false), None);
        // From inside, the exit.
        let inside = Ray::new(Vec3::new(0.0, 2000.0, 0.0), Vec3::new(0.0, 0.0, 1.0));
        let t = set.hit(0, &inside, 0.0, f32::MAX, false).expect("exit");
        assert!((t - 0.01).abs() < 1.0e-6, "{t}");
    }

    #[test]
    fn discs_and_capsules_are_hit_on_their_surface() {
        let disc = set_of(
            Shape::Disc,
            vec![particle(0, [0.0, 10.0, 0.0], 1.0, [0.0, 1.0, 0.0])],
            PixelFootprint::NONE,
        );
        let ray = Ray::new(Vec3::new(0.5, 0.0, 0.5), Vec3::new(0.0, 1.0, 0.0));
        assert_eq!(disc.hit(0, &ray, 0.0, f32::MAX, false), Some(10.0));
        let edge_on = Ray::new(Vec3::new(-5.0, 10.0, 0.0), Vec3::new(1.0, 0.0, 0.0));
        assert_eq!(disc.hit(0, &edge_on, 0.0, f32::MAX, false), None);
        let outside = Ray::new(Vec3::new(0.9, 0.0, 0.9), Vec3::new(0.0, 1.0, 0.0));
        assert_eq!(disc.hit(0, &outside, 0.0, f32::MAX, false), None);

        // A vertical capsule from z = -5 to 5, radius 1, at y = 10.
        let capsule = set_of(
            Shape::Capsule,
            vec![particle(0, [0.0, 10.0, 0.0], 1.0, [0.0, 0.0, 5.0])],
            PixelFootprint::NONE,
        );
        let body = Ray::new(Vec3::new(0.0, 0.0, 3.0), Vec3::new(0.0, 1.0, 0.0));
        assert!((capsule.hit(0, &body, 0.0, f32::MAX, false).unwrap() - 9.0).abs() < 1.0e-5);
        assert!((capsule.exit(0, &body, 9.0, false) - 11.0).abs() < 1.0e-5);
        let cap = Ray::new(Vec3::new(0.0, 10.0, 20.0), Vec3::new(0.0, 0.0, -1.0));
        assert!((capsule.hit(0, &cap, 0.0, f32::MAX, false).unwrap() - 14.0).abs() < 1.0e-5);
        let n = capsule.normal(0, Vec3::new(0.0, 10.0, 6.0));
        assert!((n - Vec3::new(0.0, 0.0, 1.0)).length() < 1.0e-5);
        let side = capsule.normal(0, Vec3::new(0.0, 9.0, 2.0));
        assert!((side - Vec3::new(0.0, -1.0, 0.0)).length() < 1.0e-5);
        // Past the end the cylinder does not count: a ray along x at z = 5.9 misses the body
        // but meets the end sphere.
        let near_end = Ray::new(Vec3::new(-10.0, 10.0, 5.5), Vec3::new(1.0, 0.0, 0.0));
        let t = capsule.hit(0, &near_end, 0.0, f32::MAX, false).unwrap();
        let expected = 10.0 - (1.0f32 - 0.25).sqrt();
        assert!((t - expected).abs() < 1.0e-5, "{t} vs {expected}");
        let past = Ray::new(Vec3::new(-10.0, 10.0, 6.1), Vec3::new(1.0, 0.0, 0.0));
        assert_eq!(capsule.hit(0, &past, 0.0, f32::MAX, false), None);
    }

    #[test]
    fn camera_rays_see_at_least_the_minimum_size_and_the_coverage_says_by_how_much() {
        let camera = Camera::default(); // at (0, -1000, 0), 50 mm on 36 mm
        let footprint = PixelFootprint::of(&camera, 360, 200);
        // A pixel at 1 m: 36 / 360 / 50 * 1000 = 2 mm; 0.35 px = 0.7 mm across.
        assert!((footprint.at(Vec3::ZERO) - 2.0).abs() < 1.0e-4);
        let set = set_of(
            Shape::Sphere,
            vec![
                particle(0, [0.0, 0.0, 0.0], 0.05, [0.0; 3]),
                particle(1, [5.0, 0.0, 0.0], 1.0, [0.0; 3]),
            ],
            footprint,
        );
        assert!(set.widened());
        let ray = Ray::new(Vec3::new(0.3, -1000.0, 0.0), Vec3::new(0.0, 1.0, 0.0));
        assert!(set
            .hit(set.slot(0).unwrap(), &ray, 0.0, f32::MAX, true)
            .is_some());
        assert!(set
            .hit(set.slot(0).unwrap(), &ray, 0.0, f32::MAX, false)
            .is_none());
        let expected = (0.05f32 / 0.35) * (0.05 / 0.35);
        assert!(
            (set.coverage(0) - expected).abs() < 1.0e-4,
            "{}",
            set.coverage(0)
        );
        assert_eq!(set.coverage(1), 1.0);
        // The ids survive the BVH's order, and the particles come back in id order.
        assert_eq!(set.tint(1), 7);
        assert_eq!(set.particles()[1].centre, [5.0, 0.0, 0.0]);
        // An orthographic camera's pixels are the same size everywhere.
        let ortho = Camera {
            ortho: true,
            ortho_width: 360.0,
            ..Camera::default()
        };
        assert_eq!(
            PixelFootprint::of(&ortho, 360, 200).at(Vec3::splat(77.0)),
            1.0
        );
    }
}
