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
//!
//! **Screen grid** (S4b). Camera rays of a pinhole camera all leave one point, so a particle can
//! only be hit by the rays whose direction projects into the particle's projection. For a
//! perspective camera every set keeps a grid of [`GRID_CELL_PIXELS`]-pixel cells over the image
//! with, per cell, the particles whose box (widened as camera rays see it, with the rounding pad)
//! projects onto it ([`ScreenProjection`]): a camera ray from the camera tests the particles of its
//! cell instead of walking the BVH. A box in front of the camera projects inside the convex hull of
//! its corners' projections, and every point of a ray from the centre projects where its direction
//! does, so the cell holds every particle the ray can hit and the nearest hit (with the same order)
//! is the BVH's, bit for bit. A thin lens (aperture radius `R`, focus plane at depth `z_f`) is the
//! same with the circle of confusion: a ray that starts on the aperture disc and crosses the focus
//! plane at `F` is, at depth `z`, within `R |1/z − 1/z_f|` (in tangent units) of `F`'s
//! projection, so each particle's rectangle grows by that at the worst depth of its box and the
//! ray looks up the cell of `F`. Particles whose box reaches the camera's plane are tested by every
//! ray; cells clamp to the image's border, so do the rays past it. A ray that does not start on
//! the aperture disc (a traced lens's, a continuation from a cut-out) walks the BVH.

use super::bvh::{leaf_range, leaf_ref, BuildParams, Bvh, BvhWidth};
use crate::math::{Aabb, Ray, Vec3};
use crate::scene::{Camera, Material, MATERIAL_GLASS};
use rt_sim::{AmbientParams, Particle, Shape};

/// The thinnest a particle looks to a camera ray, in pixels (S0 §4).
pub const MIN_PIXELS: f32 = 0.35;

/// True when particles of material `m` are small clear drops, bubbles or crystals (S4b): no
/// emitter, and at least half of the surface is clear dielectric (`(1 - metallic) transmission`,
/// glass having no metal). Rays that already scattered off a rough lobe, and shadow rays, cross
/// them straight instead of refracting (no caustics of particles); see [`crate::integrator`].
pub fn is_clear_material(m: &Material) -> bool {
    let metallic = if m.kind == MATERIAL_GLASS {
        0.0
    } else {
        m.metallic.clamp(0.0, 1.0)
    };
    !m.is_emissive() && (1.0 - metallic) * m.transmission.clamp(0.0, 1.0) >= 0.5
}

/// Width of a cell of the screen grid, in pixels (S4b).
pub const GRID_CELL_PIXELS: f32 = 4.0;
/// Most cells of a screen grid: a larger image gets larger cells.
const GRID_MAX_CELLS: u64 = 1 << 20;
/// Most pieces a long capsule is laid out on the screen grid in.
const GRID_MAX_PIECES: usize = 32;
/// Most particles a camera ray tests from a cell of the screen grid: a ray of a fuller cell (or of
/// a set with more particles that every ray tests) walks the BVH instead, which stops at the
/// nearest hit where the cell would test them all. Measured on 200 000 widened motes (S4b): best
/// or as good as the BVH at 128 x 72, 512 x 288 and 1920 x 1080.
pub const GRID_MAX_CANDIDATES: usize = 128;

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
    /// How the camera's centre projects the world onto the image (perspective cameras; the
    /// screen grid of camera rays, S4b).
    pub screen: Option<ScreenProjection>,
}

/// The projection of a perspective camera onto its image, in pixels (S4b): what the screen grid of
/// a particle set is laid out by.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ScreenProjection {
    /// The camera's centre (of its lens).
    pub origin: Vec3,
    /// Unit view direction.
    pub forward: Vec3,
    /// Unit right of the image.
    pub right: Vec3,
    /// Unit up of the image.
    pub up: Vec3,
    /// Pixels per unit of tangent across the view direction.
    pub scale: f32,
    /// Image width, pixels.
    pub width: u32,
    /// Image height, pixels.
    pub height: u32,
    /// Radius of the thin lens's aperture (0: a pinhole, whose rays all leave `origin`).
    pub lens_radius: f32,
    /// Depth of the focus plane along `forward` (with a lens).
    pub focus: f32,
}

impl ScreenProjection {
    /// Where the direction (or offset from the centre) `d` lands on the image, in pixels (x to the
    /// right, y down); `None` when it does not point clearly in front of the camera or does not
    /// give a finite position.
    #[inline(always)]
    pub fn project(&self, d: Vec3) -> Option<(f32, f32)> {
        let z = d.dot(self.forward);
        if z.is_nan() || z <= 1.0e-6 * d.abs().max_component() {
            return None;
        }
        let k = self.scale / z;
        let x = 0.5 * self.width as f32 + d.dot(self.right) * k;
        let y = 0.5 * self.height as f32 - d.dot(self.up) * k;
        (x.is_finite() && y.is_finite()).then_some((x, y))
    }

    /// Where a camera ray is looked up on the grid: for a pinhole, its direction when it leaves
    /// exactly the centre; for a thin lens, the offset from the centre of the point where it
    /// crosses the focus plane, when it leaves the aperture disc. `None` for any other ray.
    #[inline(always)]
    fn lookup(&self, ray: &Ray) -> Option<Vec3> {
        let o = ray.origin - self.origin;
        if self.lens_radius == 0.0 {
            return (o.x == 0.0 && o.y == 0.0 && o.z == 0.0).then_some(ray.dir);
        }
        // On the lens's plane and inside its disc, within the rounding of the lens sample.
        let tol = 1.0e-5 * (self.origin.abs().max_component() + self.lens_radius);
        let along = o.dot(self.forward);
        let across = o - self.forward * along;
        let r = self.lens_radius * (1.0 + 1.0e-5) + tol;
        let dz = ray.dir.dot(self.forward);
        if along.abs() > tol || across.dot(across) > r * r || dz.is_nan() || dz <= 0.0 {
            return None;
        }
        Some(o + ray.dir * ((self.focus - along) / dz))
    }

    /// How far, in pixels, a lens ray at depths `z0..z1` (> 0) strays from the projection of its
    /// focus point: the circle of confusion at the worse end (0 for a pinhole).
    #[inline]
    fn confusion(&self, z0: f32, z1: f32) -> f32 {
        if self.lens_radius == 0.0 {
            return 0.0;
        }
        let inv_f = 1.0 / self.focus;
        let worst = (1.0 / z0 - inv_f).abs().max((1.0 / z1 - inv_f).abs());
        self.scale * self.lens_radius * (1.0 + 1.0e-3) * worst
    }
}

impl PixelFootprint {
    /// No widening.
    pub const NONE: PixelFootprint = PixelFootprint {
        origin: Vec3::ZERO,
        per_distance: 0.0,
        constant: 0.0,
        screen: None,
    };

    /// The footprint of a pixel of a `width x height` image through `camera` (the sensor size
    /// applies to the longer side, as [`Camera::generate_ray`] does).
    pub fn of(camera: &Camera, width: u32, height: u32) -> PixelFootprint {
        let (width, height) = (width.max(1), height.max(1));
        if camera.panoramic() {
            // K3: a pinhole whose pixels are an angle wide (the field across the width over the
            // pixels), and no screen grid (its image is no plane).
            return PixelFootprint {
                origin: camera.position,
                per_distance: camera.fov_x_deg * crate::fmath::DEG_TO_RAD / width as f32,
                constant: 0.0,
                screen: None,
            };
        }
        if camera.ortho {
            return PixelFootprint {
                origin: camera.position,
                per_distance: 0.0,
                constant: camera.ortho_width / width as f32,
                screen: None,
            };
        }
        let long = width.max(height) as f32;
        let per_distance = camera.sensor_mm / (long * camera.focal_mm.max(1.0e-6));
        let (forward, right, up) = camera.basis();
        let scale = 1.0 / per_distance;
        let lens_radius = camera.lens_radius();
        let usable = scale.is_finite()
            && scale > 0.0
            && lens_radius.is_finite()
            && (lens_radius == 0.0 || (camera.focus_dist.is_finite() && camera.focus_dist > 0.0));
        PixelFootprint {
            origin: camera.position,
            per_distance,
            constant: 0.0,
            screen: usable.then_some(ScreenProjection {
                origin: camera.position,
                forward,
                right,
                up,
                scale,
                width,
                height,
                lens_radius,
                focus: camera.focus_dist,
            }),
        }
    }

    /// Width of a pixel at `p`.
    pub fn at(&self, p: Vec3) -> f32 {
        self.constant + self.per_distance * (p - self.origin).length()
    }
}

/// The screen grid of a particle set (S4b): per cell of the image, the slots of the particles
/// whose widened box projects onto it.
#[derive(Clone, Debug, PartialEq)]
struct ScreenGrid {
    projection: ScreenProjection,
    /// Cell size, pixels.
    cell: f32,
    cols: u32,
    rows: u32,
    /// The slots of cell `c` are `slots[starts[c]..starts[c + 1]]`, in slot order.
    starts: Vec<u32>,
    slots: Vec<u32>,
    /// Particles whose box reaches the camera's plane: every ray tests them.
    everywhere: Vec<u32>,
}

impl ScreenGrid {
    /// The cell of a pixel position, clamped to the grid.
    #[inline(always)]
    fn cell_of(&self, x: f32, y: f32) -> (u32, u32) {
        let col = (x / self.cell).floor().clamp(0.0, (self.cols - 1) as f32) as u32;
        let row = (y / self.cell).floor().clamp(0.0, (self.rows - 1) as f32) as u32;
        (col, row)
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
    /// Camera rays of a pinhole camera: the particles per cell of the image (S4b).
    grid: Option<ScreenGrid>,
    /// The effect's material is clear ([`is_clear_material`]), S4b.
    clear: bool,
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
        // A ray clearly outside the infinite cylinder around the axis misses the end spheres too
        // (they lie inside it): no more roots (S4b). Not for a ray almost along the axis, whose
        // distance to it is not that accurate, nor within rounding of the cylinder.
        if disc < -1.0e-3 * r * r && a > 1.0e-6 * ray.dir.dot(ray.dir) {
            return roots;
        }
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
            grid: None,
            clear: false,
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
        self.grid = footprint.screen.and_then(|p| self.screen_grid(p));
        self
    }

    /// The boxes that hold the particle in `slot` as camera rays see it (widened), with the rounding
    /// pad of the BVH's boxes, into `out`: one box, or for a capsule much longer than it is wide
    /// the boxes of up to [`GRID_MAX_PIECES`] pieces of its axis, each swept by the radius (their
    /// union holds the capsule, and lies far closer to it than its box when it is slanted).
    fn camera_boxes(&self, slot: usize, out: &mut Vec<Aabb>) {
        out.clear();
        let c = self.centres[slot];
        let r = self.camera_radius(slot);
        let rounding =
            |extent: Vec3| extent * 1.0e-4 + Vec3::splat(c.abs().max_component() * 1.0e-6);
        if self.shape != Shape::Capsule {
            let extent = Vec3::splat(r);
            let pad = rounding(extent);
            out.push(Aabb::new(c - extent - pad, c + extent + pad));
            return;
        }
        let half = self.axes[slot];
        let extent = half.abs() + Vec3::splat(r);
        let pad = rounding(extent);
        let length = 2.0 * half.length();
        let pieces = if r > 0.0 {
            ((length / (4.0 * r)).ceil() as usize).clamp(1, GRID_MAX_PIECES)
        } else {
            1
        };
        let (a, b) = (c - half, c + half);
        // The ends of the pieces, the first and the last exactly at the capsule's.
        let end = |k: usize| match k {
            0 => a,
            k if k == pieces => b,
            k => a + (b - a) * (k as f32 / pieces as f32),
        };
        for k in 0..pieces {
            let (p0, p1) = (end(k), end(k + 1));
            let lo = Vec3::new(p0.x.min(p1.x), p0.y.min(p1.y), p0.z.min(p1.z)) - Vec3::splat(r);
            let hi = Vec3::new(p0.x.max(p1.x), p0.y.max(p1.y), p0.z.max(p1.z)) + Vec3::splat(r);
            // The pieces overlap by the rounding of their ends as well.
            let seam = (b - a).abs() * (1.0e-4 / pieces as f32);
            out.push(Aabb::new(lo - pad - seam, hi + pad + seam));
        }
    }

    /// Lays the particles out on the image of `projection` ([`ScreenGrid`]). `None` without
    /// particles.
    fn screen_grid(&self, projection: ScreenProjection) -> Option<ScreenGrid> {
        let (w, h) = (projection.width.max(1), projection.height.max(1));
        if self.is_empty() {
            return None;
        }
        let mut cell = GRID_CELL_PIXELS;
        let cells = |cell: f32| {
            let cols = (w as f32 / cell).ceil().max(1.0) as u64;
            let rows = (h as f32 / cell).ceil().max(1.0) as u64;
            (cols, rows)
        };
        while {
            let (cols, rows) = cells(cell);
            cols * rows > GRID_MAX_CELLS
        } {
            cell *= 2.0;
        }
        let (cols, rows) = cells(cell);
        let mut grid = ScreenGrid {
            projection,
            cell,
            cols: cols as u32,
            rows: rows as u32,
            starts: Vec::new(),
            slots: Vec::new(),
            everywhere: Vec::new(),
        };
        // Each particle's cells (sorted, once each), from its boxes' corners; or everywhere.
        let mut boxes = Vec::new();
        let mut mine: Vec<u32> = Vec::new();
        let mut cells_of: Vec<u32> = Vec::new();
        let mut first_cell: Vec<u32> = Vec::with_capacity(self.len() + 1);
        first_cell.push(0);
        'particles: for slot in 0..self.len() {
            self.camera_boxes(slot, &mut boxes);
            mine.clear();
            for b in &boxes {
                let mut lo = (f32::INFINITY, f32::INFINITY);
                let mut hi = (f32::NEG_INFINITY, f32::NEG_INFINITY);
                let mut depth = (f32::INFINITY, f32::NEG_INFINITY);
                for corner in 0..8 {
                    let pick = |bit: u32, a: f32, b: f32| if corner & bit != 0 { b } else { a };
                    let p = Vec3::new(
                        pick(1, b.min.x, b.max.x),
                        pick(2, b.min.y, b.max.y),
                        pick(4, b.min.z, b.max.z),
                    );
                    let d = p - projection.origin;
                    let Some((x, y)) = projection.project(d) else {
                        grid.everywhere.push(slot as u32);
                        first_cell.push(cells_of.len() as u32);
                        continue 'particles;
                    };
                    lo = (lo.0.min(x), lo.1.min(y));
                    hi = (hi.0.max(x), hi.1.max(y));
                    let z = d.dot(projection.forward);
                    depth = (depth.0.min(z), depth.1.max(z));
                }
                // The circle of confusion at the box's worst depth (a lens), and the rounding of
                // the projections (the corners' and the rays').
                let coc = projection.confusion(depth.0, depth.1);
                if !coc.is_finite() {
                    grid.everywhere.push(slot as u32);
                    first_cell.push(cells_of.len() as u32);
                    continue 'particles;
                }
                let margin = |v: f32| coc + 0.01 + 1.0e-5 * v.abs();
                let (c0, r0) = grid.cell_of(lo.0 - margin(lo.0), lo.1 - margin(lo.1));
                let (c1, r1) = grid.cell_of(hi.0 + margin(hi.0), hi.1 + margin(hi.1));
                for row in r0..=r1 {
                    for col in c0..=c1 {
                        mine.push(row * grid.cols + col);
                    }
                }
            }
            mine.sort_unstable();
            mine.dedup();
            cells_of.extend_from_slice(&mine);
            first_cell.push(cells_of.len() as u32);
        }
        // Counting sort by cell, slots in order within each.
        let n = (cols * rows) as usize;
        let mut starts = vec![0u32; n + 1];
        for &c in &cells_of {
            starts[c as usize + 1] += 1;
        }
        for i in 0..n {
            starts[i + 1] += starts[i];
        }
        let mut next = starts.clone();
        let mut slots = vec![0u32; cells_of.len()];
        for slot in 0..self.len() {
            let (a, b) = (first_cell[slot] as usize, first_cell[slot + 1] as usize);
            for &c in &cells_of[a..b] {
                slots[next[c as usize] as usize] = slot as u32;
                next[c as usize] += 1;
            }
        }
        grid.starts = starts;
        grid.slots = slots;
        (grid.everywhere.len() <= GRID_MAX_CANDIDATES).then_some(grid)
    }

    /// For a camera ray that leaves the camera's centre (a pinhole) or its aperture disc (a thin
    /// lens): the slots of the particles it can hit, those of its cell of the screen grid and those
    /// every ray tests (S4b). `None` for any other ray, for a cell with more than
    /// [`GRID_MAX_CANDIDATES`] particles, or without a grid: the BVH then.
    #[inline(always)]
    pub(crate) fn screen_candidates(&self, ray: &Ray) -> Option<(&[u32], &[u32])> {
        let grid = self.grid.as_ref()?;
        let at = grid.projection.lookup(ray)?;
        let (x, y) = grid.projection.project(at)?;
        let (col, row) = grid.cell_of(x, y);
        let c = (row * grid.cols + col) as usize;
        let (a, b) = (grid.starts[c] as usize, grid.starts[c + 1] as usize);
        (b - a <= GRID_MAX_CANDIDATES).then(|| (&grid.slots[a..b], &grid.everywhere[..]))
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

    /// The same particles made of `material` (the effect's, `None` when its index is out of range:
    /// the default material): only whether they are clear ([`is_clear_material`]) is kept.
    pub fn with_material(mut self, material: Option<&Material>) -> ParticleSet {
        self.clear = material.is_some_and(is_clear_material);
        self
    }

    /// True when the particles are small clear drops or bubbles ([`is_clear_material`]): rays after
    /// a rough lobe and shadow rays cross them straight (S4b).
    pub fn is_clear(&self) -> bool {
        self.clear
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

#[cfg(test)]
mod grid_tests {
    use super::*;
    use crate::geometry::{Geometry, RayClass};
    use crate::rng::Pcg32;
    use crate::simd::Isa;

    /// `n` particles of `shape` in front of a camera at `(0, -1000, 100)` looking along +Y, from
    /// specks that camera rays widen to drops 30 mm across, and a few that reach the camera's
    /// plane or lie behind it.
    fn particles(shape: Shape, n: u32, seed: u64) -> Vec<Particle> {
        let mut rng = Pcg32::seeded(seed, 7);
        let mut f = |lo: f32, hi: f32| lo + (hi - lo) * rng.next_f32();
        (0..n)
            .map(|id| {
                let y = if id % 100 == 0 {
                    f(-1060.0, -980.0) // straddling or behind the camera's plane
                } else {
                    f(-700.0, 400.0)
                };
                let centre = [f(-500.0, 500.0), y, f(-250.0, 450.0)];
                let radius = if id % 3 == 0 {
                    f(0.02, 0.3)
                } else {
                    f(0.5, 15.0)
                };
                let axis = match shape {
                    Shape::Sphere => [0.0; 3],
                    Shape::Disc => {
                        let a = Vec3::new(f(-1.0, 1.0), f(-1.0, 1.0), f(-1.0, 1.0)).normalize();
                        [a.x, a.y, a.z]
                    }
                    Shape::Capsule => [f(-15.0, 15.0), f(-15.0, 15.0), f(-40.0, 40.0)],
                };
                Particle {
                    centre,
                    radius,
                    axis,
                    tint: 0,
                    id,
                }
            })
            .collect()
    }

    #[test]
    fn camera_rays_find_through_the_screen_grid_what_brute_force_finds() {
        let width = crate::geometry::BvhWidth::native();
        for (fstop, focus) in [(0.0, 0.0), (2.0, 900.0), (1.4, 300.0)] {
            let camera = Camera {
                position: Vec3::new(0.0, -1000.0, 100.0),
                target: Vec3::new(0.0, 0.0, 100.0),
                fstop,
                focus_dist: focus,
                ..Camera::default()
            };
            let (w, h) = (120, 80);
            let footprint = PixelFootprint::of(&camera, w, h);
            assert_eq!(
                footprint.screen.map(|s| s.lens_radius > 0.0),
                Some(fstop > 0.0)
            );
            for (k, shape) in [Shape::Sphere, Shape::Disc, Shape::Capsule]
                .into_iter()
                .enumerate()
            {
                let params = AmbientParams {
                    shape,
                    count: 600,
                    ..AmbientParams::default()
                };
                let set =
                    ParticleSet::new(&params, &particles(shape, 600, k as u64), footprint, width);
                assert!(set.widened());
                let grid = set.grid.as_ref().expect("a grid");
                assert!(!grid.everywhere.is_empty(), "some reach the camera's plane");
                let geometry = Geometry::with_particles(Vec::new(), Vec::new(), vec![set], width)
                    .expect("geometry");
                let set = &geometry.particle_sets()[0];
                let mut rng = Pcg32::seeded(11, k as u64);
                let (mut hits, mut gridded) = (0, 0);
                for _ in 0..6000 {
                    // Beyond the frame too (the filter's reach, and the clamped border cells).
                    let u = -0.1 + 1.2 * rng.next_f32();
                    let v = -0.1 + 1.2 * rng.next_f32();
                    let lens = crate::warp::concentric_disk((rng.next_f32(), rng.next_f32()));
                    let ray = camera.generate_ray(w as f32 / h as f32, u, v, lens);
                    gridded += set.screen_candidates(&ray).is_some() as u32;
                    let found = geometry.trace_class(&ray, Isa::detect(), RayClass::Camera);
                    assert_eq!(
                        found,
                        geometry.brute_force(&ray, RayClass::Camera).0,
                        "f/{fstop}, {shape:?}, {ray:?}"
                    );
                    hits += found.is_some() as u32;
                    // A ray that does not leave the lens walks the BVH, and finds the same.
                    let mut off = ray;
                    off.origin += camera.basis().0 * 2.0;
                    assert!(set.screen_candidates(&off).is_none());
                    assert_eq!(
                        geometry.trace_class(&off, Isa::detect(), RayClass::Camera),
                        geometry.brute_force(&off, RayClass::Camera).0
                    );
                }
                eprintln!(
                    "f/{fstop} at {focus}, {shape:?}: {hits} hits of 6000, {gridded} by the grid"
                );
                assert!(gridded >= 2000, "many camera rays use the grid: {gridded}");
                assert!(hits > 300, "{hits}");
            }
        }
        // A crowd (40 000 particles 4 mm across in a box of 150 mm): the rays of its full cells
        // walk the BVH, and every ray still finds what brute force finds.
        let camera = Camera {
            position: Vec3::new(0.0, -1000.0, 100.0),
            target: Vec3::new(0.0, 0.0, 100.0),
            ..Camera::default()
        };
        let mut rng = Pcg32::seeded(5, 5);
        let crowd: Vec<Particle> = (0..40_000)
            .map(|id| Particle {
                centre: [
                    -75.0 + 150.0 * rng.next_f32(),
                    -75.0 + 150.0 * rng.next_f32(),
                    25.0 + 150.0 * rng.next_f32(),
                ],
                radius: 2.0,
                axis: [0.0; 3],
                tint: 0,
                id,
            })
            .collect();
        let params = AmbientParams {
            count: 40_000,
            ..AmbientParams::default()
        };
        let footprint = PixelFootprint::of(&camera, 120, 80);
        let set = ParticleSet::new(&params, &crowd, footprint, width);
        let geometry =
            Geometry::with_particles(Vec::new(), Vec::new(), vec![set], width).expect("geometry");
        let set = &geometry.particle_sets()[0];
        let (mut gridded, mut walked) = (0, 0);
        for _ in 0..3000 {
            let (u, v) = (0.4 + 0.2 * rng.next_f32(), 0.3 + 0.4 * rng.next_f32());
            let ray = camera.generate_ray(1.5, u, v, (0.0, 0.0));
            match set.screen_candidates(&ray) {
                Some((cell, _)) => {
                    assert!(cell.len() <= GRID_MAX_CANDIDATES);
                    gridded += 1;
                }
                None => walked += 1,
            }
            assert_eq!(
                geometry.trace_class(&ray, Isa::detect(), RayClass::Camera),
                geometry.brute_force(&ray, RayClass::Camera).0
            );
        }
        eprintln!("crowd: {gridded} rays by the grid, {walked} by the BVH");
        assert!(walked > 300, "{walked}");
    }
}
