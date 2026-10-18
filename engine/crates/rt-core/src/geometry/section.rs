//! The section view (Q1): a plane that removes one side of the model and caps the cut.
//!
//! The scene's [`SectionPlane`] (the `SECT` section of the RSB) splits space in two: the **kept**
//! side, `normal · p <= distance`, and the **removed** side beyond the plane (the normal points
//! to what goes). Every query of the geometry (camera, reflection, refraction and shadow rays,
//! photons, picking) sees the model as if the removed side were empty:
//!
//! * a ray is clipped to the interval where it is on the kept side (a half-space meets a ray in
//!   one interval), so geometry on the removed side is never hit and never blocks a shadow ray.
//!   Nothing of the kernels changes: the clipped ray is an ordinary ray with other `t_min` and
//!   `t_max` (`t` is the same in the world and in a mesh's space), so every path of the SIMD
//!   traversal answers alike and a scene without a section takes exactly the code it took
//!   before;
//! * the cut is **capped** where it goes through the inside of a closed solid ([`super::solid`]).
//!   A ray that crosses the plane has been outside every surface it did not hit, so whether the
//!   crossing point is inside a solid is decided by the next surface of the ray along its own
//!   direction: if it is met from behind, the point was inside that solid. The cap is then a hit
//!   on the plane, at the crossing, of the instance of that surface: it shades with that
//!   instance's material as a flat surface whose normal is the plane's (facing the removed side),
//!   so a cut piece looks cut from a polished solid of its colour, and light interacts with it as
//!   with any surface (glass refracts through it, metal reflects). A ray that enters the kept
//!   side (from the removed side, where the camera usually is) needs no extra work for it: the
//!   nearest surface it finds after the crossing is that next surface. A ray that leaves the kept
//!   side without having hit anything looks for it beyond the plane in the whole model.
//!
//! The cap has no texture, pattern, program or bevel (it has no triangle: [`CAP_TRIANGLE`]): it
//! is the material's plain colour. Open meshes ([`super::Solid::Open`]) and thin-walled materials
//! are not capped: the former show their inside, the latter have none. The decision is made on
//! meshes and nothing else, so it is the same for every ray, thread and architecture.
//!
//! **The studio is not cut.** An instance with [`super::INSTANCE_NO_SECTION`] (the page flags the
//! pieces of a set: backdrop, floor, cards) is the room the model is in, not the model: the plane
//! neither removes nor caps it, and it keeps lighting, shadowing and being seen from both sides
//! of the plane. A ray looks for it on the removed side too: it walks the removed part of its
//! range surface by surface, past the cut model (which is not there) until it meets an exempt
//! instance, at most [`MAX_SKIPS`] surfaces deep (deeper, the rest of the removed part shows
//! nothing). A scene without exempt instances never takes that path.
//!
//! Two limits, both rare: a ray with a finite `t_max` that enters the kept side inside a solid
//! and ends before leaving it finds no cap (the next surface is beyond its end), and an emissive
//! mesh sampled as a light still lights from its removed part.

use super::solid::Solid;
use super::{Geometry, Hit, RayClass, RayHit, INSTANCE_NO_SECTION};
use crate::math::{Aabb, Ray, Vec3};
use crate::simd::Isa;

/// The `triangle` of a [`RayHit`] or [`Hit`] on the cap of a cut solid (its `instance` is the
/// solid's): there is no triangle to look up.
pub const CAP_TRIANGLE: u32 = u32::MAX;

/// The cutting plane of a section: what the `SECT` section of the RSB holds.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SectionPlane {
    /// Unit normal of the plane, pointing to the side that is removed.
    pub normal: Vec3,
    /// The plane is `normal · p = distance` (millimetres from the origin along the normal); the
    /// kept side is `normal · p <= distance`.
    pub distance: f32,
    /// Cap the closed solids the plane cuts (off: the cut shows their inside).
    pub cap: bool,
}

impl SectionPlane {
    /// A plane with `normal`, `distance` along it and the cap on or off; `None` when the normal is
    /// zero or not finite, or the distance is not finite. The normal is normalised unless it is
    /// unit already to rounding (within 10⁻⁶), so that a plane written and read again is the same
    /// bits.
    pub fn new(normal: Vec3, distance: f32, cap: bool) -> Option<SectionPlane> {
        let length = normal.length();
        if !(normal.is_finite() && length.is_finite() && length > 0.0 && distance.is_finite()) {
            return None;
        }
        let normal = if (length - 1.0).abs() <= 1.0e-6 {
            normal
        } else {
            normal * (1.0 / length)
        };
        Some(SectionPlane {
            normal,
            distance,
            cap,
        })
    }

    /// Signed distance of `p` from the plane: positive on the removed side, zero on the plane.
    #[inline]
    pub fn side(&self, p: Vec3) -> f32 {
        self.normal.dot(p) - self.distance
    }
}

/// Most surfaces of the cut model a ray steps over, on the removed side, looking for an exempt
/// instance behind them.
const MAX_SKIPS: usize = 48;

/// A plane and what the geometry works out of it once: how each instance is capped, and which
/// ones it does not touch.
#[derive(Clone, Debug, PartialEq)]
pub(super) struct Section {
    plane: SectionPlane,
    /// Per instance: how a hit on it tells the inside of its solid ([`Solid::Open`]: not capped).
    caps: Vec<Solid>,
    /// The union of the world boxes of the capped instances, grown a little (empty: no cap).
    cap_bounds: Aabb,
    /// Per instance: the section does not cut it ([`INSTANCE_NO_SECTION`]). Empty when no
    /// instance is exempt.
    exempt: Vec<bool>,
    /// The world box of every exempt instance, grown a little.
    exempt_boxes: Vec<Aabb>,
}

/// Where a ray is on the kept side.
#[derive(Clone, Copy, Debug, PartialEq)]
enum Span {
    /// Never within its range.
    Removed,
    /// All of its range.
    Whole,
    /// From `t` on: it crosses the plane there, into the kept side.
    Enters(f32),
    /// Until `t`: it crosses the plane there, out of the kept side.
    Leaves(f32),
}

impl Section {
    fn span(&self, ray: &Ray) -> Span {
        let n = self.plane.normal;
        let from_plane = n.dot(ray.origin) - self.plane.distance;
        let towards = n.dot(ray.dir);
        if towards == 0.0 {
            return if from_plane <= 0.0 {
                Span::Whole
            } else {
                Span::Removed
            };
        }
        let t = -from_plane / towards;
        if towards > 0.0 {
            // Moving to the removed side: kept until the crossing.
            if t < ray.t_min {
                Span::Removed
            } else if t >= ray.t_max {
                Span::Whole
            } else {
                Span::Leaves(t)
            }
        } else if t <= ray.t_min {
            Span::Whole
        } else if t > ray.t_max {
            Span::Removed
        } else {
            Span::Enters(t)
        }
    }

    /// True when `p` may lie on a cap (inside the box of a capped instance).
    fn may_cap(&self, p: Vec3) -> bool {
        let b = self.cap_bounds;
        !b.is_empty()
            && p.x >= b.min.x
            && p.x <= b.max.x
            && p.y >= b.min.y
            && p.y <= b.max.y
            && p.z >= b.min.z
            && p.z <= b.max.z
    }
}

/// `ray` limited to `[t_min, t_max]`.
#[inline]
fn limited(ray: &Ray, t_min: f32, t_max: f32) -> Ray {
    Ray {
        t_min,
        t_max,
        ..*ray
    }
}

impl Geometry {
    /// Sets the section view: the plane (`None`: no section, the geometry answers as it was built)
    /// and which instances it may cap, by instance index (`capped[i]` false for a thin-walled
    /// material, say; a missing entry is true). An instance is capped when it also is a closed
    /// solid ([`super::Mesh::solid`]) and the plane asks for caps. Call it again whenever the
    /// instances change: it is part of the geometry, so a rebuilt geometry has none.
    pub fn set_section(&mut self, plane: Option<SectionPlane>, capped: &[bool]) {
        self.section = plane.map(|plane| {
            let mut caps = Vec::with_capacity(self.instances.len());
            let mut cap_bounds = Aabb::EMPTY;
            let mut exempt = Vec::new();
            let mut exempt_boxes = Vec::new();
            for (i, instance) in self.instances.iter().enumerate() {
                let mesh = self.meshes.get(instance.mesh as usize);
                let live = self.prepared.get(i).is_some_and(|p| p.active);
                let is_exempt = instance.flags & INSTANCE_NO_SECTION != 0;
                if is_exempt && live {
                    if let Some(m) = mesh {
                        if exempt.is_empty() {
                            exempt = vec![false; self.instances.len()];
                        }
                        exempt[i] = true;
                        exempt_boxes.push(grown(super::instance_bounds(m, &instance.transform)));
                    }
                }
                let wanted = plane.cap && !is_exempt && capped.get(i).copied().unwrap_or(true);
                let solid = match mesh {
                    Some(m) if wanted && live => m.solid(),
                    _ => Solid::Open,
                };
                if let (Some(m), true) = (mesh, solid != Solid::Open) {
                    cap_bounds =
                        cap_bounds.union(grown(super::instance_bounds(m, &instance.transform)));
                }
                caps.push(solid);
            }
            Section {
                plane,
                caps,
                cap_bounds,
                exempt,
                exempt_boxes,
            }
        });
    }

    /// The section view's plane, if there is one.
    pub fn section_plane(&self) -> Option<&SectionPlane> {
        self.section.as_ref().map(|s| &s.plane)
    }

    /// The instances the section caps (a closed solid that is not thin-walled), or none without a
    /// section.
    pub fn capped_instances(&self) -> Vec<u32> {
        self.section.as_ref().map_or_else(Vec::new, |s| {
            (0..s.caps.len() as u32)
                .filter(|&i| s.caps[i as usize] != Solid::Open)
                .collect()
        })
    }

    /// The nearest hit of a query against the geometry with its section: [`Geometry::trace_class`]
    /// when there is one.
    pub(super) fn trace_sectioned(
        &self,
        section: &Section,
        ray: &Ray,
        isa: Isa,
        class: RayClass,
    ) -> Option<RayHit> {
        match section.span(ray) {
            Span::Removed => self.exempt_in(section, ray, ray.t_min, ray.t_max, isa, class),
            Span::Whole => self.trace_raw(ray, isa, class),
            Span::Leaves(t) => {
                // The part of the ray on the kept side; a cap only where nothing else is met
                // first, looked for beyond the plane (K3: a camera ray sees no cap of an instance
                // hidden to the camera); then the studio on the removed side.
                self.trace_raw(&limited(ray, ray.t_min, t), isa, class)
                    .or_else(|| {
                        self.cap_beyond(section, ray, t, isa)
                            .filter(|h| !self.cap_hidden(class, h))
                    })
                    .or_else(|| self.exempt_in(section, ray, t, ray.t_max, isa, class))
            }
            Span::Enters(t) => {
                // The studio on the removed side is nearer than anything on the kept one.
                if let Some(hit) = self.exempt_in(section, ray, ray.t_min, t, isa, class) {
                    return Some(hit);
                }
                let beyond = limited(ray, t, ray.t_max);
                let nearest = self.trace_raw(&beyond, isa, class);
                if section.plane.cap && section.may_cap(ray.at(t)) {
                    // The next surface of the parts (particles are no solids) tells the inside.
                    let seen_by_class = self.particles.iter().any(|set| class.sees(set));
                    let next = if seen_by_class {
                        self.trace_raw(&beyond, isa, RayClass::Parts)
                    } else {
                        nearest
                    };
                    if let Some(hit) = next {
                        if self.met_from_inside(section, ray, &hit) && !self.cap_hidden(class, &hit)
                        {
                            return Some(cap(hit.instance, t));
                        }
                    }
                }
                nearest
            }
        }
    }

    /// K3: true when `hit` (on a cap, or on the surface that tells one) is of an instance a query of
    /// `class` does not see: a camera query and an instance hidden to the camera.
    fn cap_hidden(&self, class: RayClass, hit: &RayHit) -> bool {
        class.skips_camera_hidden() && self.camera_hidden(hit.instance)
    }

    /// [`Geometry::occluded_class`] against the geometry with its section.
    pub(super) fn occluded_sectioned(
        &self,
        section: &Section,
        ray: &Ray,
        isa: Isa,
        class: RayClass,
    ) -> bool {
        match section.span(ray) {
            Span::Removed => self
                .exempt_in(section, ray, ray.t_min, ray.t_max, isa, class)
                .is_some(),
            Span::Whole => self.occluded_raw(ray, isa, class),
            Span::Leaves(t) => {
                self.occluded_raw(&limited(ray, ray.t_min, t), isa, class)
                    || self.cap_beyond(section, ray, t, isa).is_some()
                    || self
                        .exempt_in(section, ray, t, ray.t_max, isa, class)
                        .is_some()
            }
            // The cap of a ray that enters is at the start of what it can hit anyway.
            Span::Enters(t) => {
                self.occluded_raw(&limited(ray, t, ray.t_max), isa, class)
                    || self
                        .exempt_in(section, ray, ray.t_min, t, isa, class)
                        .is_some()
            }
        }
    }

    /// The nearest hit of `ray` on an exempt instance ([`INSTANCE_NO_SECTION`]) within
    /// `[from, to]`, which is the removed part of its range: the cut model is not there, so the
    /// search steps over its surfaces. Looks only inside the world box of each exempt instance
    /// (a floor is a thin slab: the ray's passage through it is short and holds little else).
    fn exempt_in(
        &self,
        section: &Section,
        ray: &Ray,
        from: f32,
        to: f32,
        isa: Isa,
        class: RayClass,
    ) -> Option<RayHit> {
        if section.exempt_boxes.is_empty() || from.is_nan() || to.is_nan() || from > to {
            return None;
        }
        let inv_dir = ray.dir.recip();
        let mut best: Option<RayHit> = None;
        for boxed in &section.exempt_boxes {
            let end = best.map_or(to, |h| h.t.min(to));
            let Some((near, far)) = boxed.intersect(&limited(ray, from, end), inv_dir) else {
                continue;
            };
            if let Some(hit) = self.first_exempt(section, ray, near, far.min(end), isa, class) {
                if best.is_none_or(|b| hit.t < b.t) {
                    best = Some(hit);
                }
            }
        }
        best
    }

    /// The first exempt instance `ray` meets within `[near, far]`, stepping over the surfaces of
    /// the others (at most [`MAX_SKIPS`]).
    fn first_exempt(
        &self,
        section: &Section,
        ray: &Ray,
        near: f32,
        far: f32,
        isa: Isa,
        class: RayClass,
    ) -> Option<RayHit> {
        let mut t = near;
        for _ in 0..MAX_SKIPS {
            let hit = self.trace_raw(&limited(ray, t, far), isa, class)?;
            if section.exempt.get(hit.instance as usize).copied() == Some(true) {
                return Some(hit);
            }
            // Strictly past the surface just stepped over.
            t = f32::from_bits(hit.t.max(0.0).to_bits() + 1);
            if t > far {
                return None;
            }
        }
        None
    }

    /// The cap at `t`, where `ray` leaves the kept side without having hit anything: there when
    /// the next surface along the ray, in the whole model, is met from inside its solid.
    fn cap_beyond(&self, section: &Section, ray: &Ray, t: f32, isa: Isa) -> Option<RayHit> {
        if !section.plane.cap || !section.may_cap(ray.at(t)) {
            return None;
        }
        let probe = limited(ray, t, f32::INFINITY);
        let hit = self.trace_raw(&probe, isa, RayClass::Parts)?;
        self.met_from_inside(section, ray, &hit)
            .then(|| cap(hit.instance, t))
    }

    /// True when `hit` is on a capped instance and `ray` meets its triangle from the inside of
    /// the solid.
    fn met_from_inside(&self, section: &Section, ray: &Ray, hit: &RayHit) -> bool {
        let solid = match section.caps.get(hit.instance as usize) {
            Some(&s) if s != Solid::Open => s,
            _ => return false,
        };
        let Some((mesh, prepared)) = self.instance_parts(hit.instance) else {
            return false;
        };
        let Some([p0, p1, p2]) = mesh.triangle(hit.triangle as usize) else {
            return false;
        };
        let winding = (p1 - p0).cross(p2 - p0);
        let winding = if prepared.identity {
            winding
        } else {
            prepared.to_local.transpose_vector(winding)
        };
        solid.inside_before(winding.dot(ray.dir) < 0.0)
    }

    /// The details of a hit on a cap: on the plane, facing the side `ray` came from.
    pub(super) fn cap_details(&self, ray: &Ray, hit: RayHit) -> Option<Hit> {
        let plane = self.section.as_ref()?.plane;
        self.instances.get(hit.instance as usize)?;
        // On the plane exactly, whatever the rounding of `origin + dir · t`.
        let at = ray.at(hit.t);
        let point = at - plane.normal * plane.side(at);
        let front_face = plane.normal.dot(ray.dir) < 0.0;
        let normal = if front_face {
            plane.normal
        } else {
            -plane.normal
        };
        Some(Hit {
            instance: hit.instance,
            triangle: CAP_TRIANGLE,
            t: hit.t,
            point,
            normal,
            geometric_normal: normal,
            barycentrics: [1.0, 0.0, 0.0],
            front_face,
            outside: front_face,
        })
    }
}

/// A hit on the cap of `instance`, `t` along the ray.
#[inline]
fn cap(instance: u32, t: f32) -> RayHit {
    RayHit {
        instance,
        triangle: CAP_TRIANGLE,
        t,
    }
}

/// `b` grown by a hair, so that a crossing point that rounding puts on the surface of a box is in
/// it.
fn grown(b: Aabb) -> Aabb {
    let size = (b.max - b.min).max_component();
    let pad = Vec3::splat(size * 1.0e-5 + 1.0e-4);
    Aabb::new(b.min - pad, b.max + pad)
}
