//! Geometry and ray queries: meshes, instances, BVHs and the intersection kernels.
//!
//! * [`Mesh`]: an indexed triangle mesh in its own space, structure-of-arrays, with its own wide
//!   BVH (the bottom level) built when the mesh is created.
//! * [`Instance`]: a mesh placed in the world by a 3x4 [`Transform`], with its own material.
//! * [`Geometry`]: the meshes, the instances and a wide BVH over the instances' world boxes (the
//!   top level). Rays are moved into a mesh's space by the precomputed inverse transform, so the
//!   ray parameter `t` is the same in both spaces; normals go back by the inverse transpose.
//! * [`ParticleSet`] (S4a): the particles of an ambient effect, analytic spheres, discs or
//!   capsules in world space with a flat BVH of their own, one more entry of the top level (walked
//!   after the instance BVH, bounded by the nearest part).
//!   A hit on one reports as its `instance` the number of instances plus the effect's index, and
//!   as its `triangle` the particle's id; [`RayClass`] says which effects a query sees (their
//!   camera, reflection and shadow flags).
//!
//! Queries: [`Geometry::intersect`] (nearest hit with point, normals and barycentrics),
//! [`Geometry::trace`] (nearest hit, indices and `t` only) and [`Geometry::occluded`] (any hit
//! in `[t_min, t_max]`, with early exit, for shadow rays). The `_with` variants take an explicit
//! [`Isa`]; the others use [`Isa::detect`]. All paths return identical results.

mod bvh;
pub mod edges;
mod mesh;
pub mod particles;
mod section;
mod solid;
mod transform;
mod traverse;
pub mod triangle;

#[cfg(test)]
mod section_tests;
#[cfg(test)]
mod tests;

pub use bvh::{BvhStats, BvhWidth, BINS, SAH_DEPTH_LIMIT};
pub use mesh::{Mesh, MeshError, MAX_TRIANGLES, MAX_UV_SETS};
pub use particles::{is_clear_material, ParticleSet, PixelFootprint, ScreenProjection, MIN_PIXELS};
pub use section::{SectionPlane, CAP_TRIANGLE};
pub use solid::Solid;
pub use transform::Transform;
pub use triangle::{intersect_triangle, Cull, TriangleHit};

use bvh::{leaf_ref, BuildParams, Bvh, MAX_LEAF_FIRST};
use section::Section;
use traverse::{AnyBatchKernel, AnyKernel, NearestBatchKernel, NearestKernel};
use triangle::{watertight, PreparedRay};

use crate::math::{Aabb, Ray, Vec3};
use crate::simd::Isa;
use std::fmt;

/// Instance flag: back faces (as wound in the mesh) are not hit.
pub const INSTANCE_ONE_SIDED: u32 = 1;

/// Instance flag: the section view (Q1) does not cut this instance, neither removes nor caps it:
/// the studio around the product (a set's backdrop, floor and cards), not the model.
pub const INSTANCE_NO_SECTION: u32 = 2;

/// Instance flag (K3): the instance is invisible to camera rays ([`RayClass::Camera`]: the camera's
/// rays and the rays that continue them straight through cut-outs and thin walls) and to nothing
/// else: reflections, refractions, shadows, photons and the light it sends all see it. The plan
/// view of a room through its ceiling: the ceiling is not in the picture and still lights the room.
pub const INSTANCE_NO_CAMERA: u32 = 4;

/// Largest number of instances in one [`Geometry`] (particle sets included).
pub const MAX_INSTANCES: usize = MAX_LEAF_FIRST;

/// Which particle sets a query sees, by the flags of their effects (`rt_sim::FLAG_*`). Meshes are
/// seen by every query.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RayClass {
    /// Camera rays (and the rays that continue them straight): the effects seen by the camera,
    /// widened to the minimum size on screen. The only class that does not see the instances hidden
    /// to the camera ([`INSTANCE_NO_CAMERA`], K3).
    Camera,
    /// Rays scattered by a surface (reflection, refraction, diffuse): the effects seen in
    /// reflections.
    Secondary,
    /// Shadow rays: the effects that cast shadows.
    Shadow,
    /// Rays of a path that scattered off a rough lobe (S4b): the effects seen in reflections,
    /// except the clear ones ([`ParticleSet::is_clear`]), which such a ray crosses straight as a
    /// shadow ray does, so it sees them only when they cast shadows.
    Rough,
    /// Only the parts, no particles (picking).
    Parts,
    /// The parts as the camera sees them, no particles: what the image shows at a point (focus with
    /// a click). Like [`RayClass::Parts`], and it does not see the instances hidden to the camera.
    Seen,
}

impl RayClass {
    /// True when a query of this class sees the particles of `set`.
    #[inline(always)]
    pub fn sees(self, set: &ParticleSet) -> bool {
        let flag = match self {
            RayClass::Camera => rt_sim::FLAG_CAMERA,
            RayClass::Secondary => rt_sim::FLAG_REFLECTIONS,
            RayClass::Shadow => rt_sim::FLAG_SHADOW,
            RayClass::Rough if set.is_clear() => rt_sim::FLAG_SHADOW,
            RayClass::Rough => rt_sim::FLAG_REFLECTIONS,
            RayClass::Parts | RayClass::Seen => return false,
        };
        set.params().visible_to(flag)
    }

    /// True when a query of this class steps over the instances hidden to the camera
    /// ([`INSTANCE_NO_CAMERA`]): the camera's rays and what the image shows.
    #[inline(always)]
    pub fn skips_camera_hidden(self) -> bool {
        matches!(self, RayClass::Camera | RayClass::Seen)
    }
}

/// Leaf policy of the instance BVH: one instance per leaf.
const INSTANCE_LEAVES: BuildParams = BuildParams {
    leaf_target: 1,
    leaf_max: 1,
};

/// A mesh placed in the world.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Instance {
    /// Index into [`Geometry::meshes`].
    pub mesh: u32,
    /// Object-to-world transform.
    pub transform: Transform,
    /// Index into the scene's materials.
    pub material_id: u32,
    /// Bit set of `INSTANCE_*` flags.
    pub flags: u32,
}

impl Instance {
    /// An instance of `mesh` with `transform` and `material_id`, no flags.
    pub fn new(mesh: u32, transform: Transform, material_id: u32) -> Instance {
        Instance {
            mesh,
            transform,
            material_id,
            flags: 0,
        }
    }

    /// Which faces the instance shows.
    pub fn cull(&self) -> Cull {
        if self.flags & INSTANCE_ONE_SIDED != 0 {
            Cull::Back
        } else {
            Cull::None
        }
    }
}

/// Why a [`Geometry`] could not be built.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum GeometryError {
    /// An instance refers to a mesh that does not exist.
    MeshOutOfRange {
        /// Index of the offending instance.
        instance: u32,
    },
    /// More than [`MAX_INSTANCES`] instances and particle sets.
    TooManyInstances,
}

impl fmt::Display for GeometryError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            GeometryError::MeshOutOfRange { instance } => {
                write!(
                    f,
                    "instance {instance} refers to a mesh that does not exist"
                )
            }
            GeometryError::TooManyInstances => write!(f, "too many instances"),
        }
    }
}

impl std::error::Error for GeometryError {}

/// What the kernels need of an instance, precomputed.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct PreparedInstance {
    /// World-to-object transform.
    to_local: Transform,
    /// The transform is exactly the identity: rays are used unchanged.
    identity: bool,
    /// Faces shown.
    pub cull: Cull,
    /// False for instances that can never be hit (empty mesh, singular transform).
    active: bool,
    /// K3: the instance is hidden to the camera ([`INSTANCE_NO_CAMERA`]): camera rays step over it.
    pub camera_hidden: bool,
}

impl PreparedInstance {
    /// `ray` in the space of the instance's mesh (same `t`).
    #[inline(always)]
    pub fn local_ray(&self, ray: &Ray) -> Ray {
        if self.identity {
            *ray
        } else {
            self.to_local.ray(ray)
        }
    }

    /// `ray` prepared in the space of the instance's mesh. `world` must be
    /// `PreparedRay::new(ray)`: an identity instance reuses it (it is exactly what
    /// `PreparedRay::new(&self.local_ray(ray))` would compute).
    #[inline(always)]
    pub fn prepare(&self, ray: &Ray, world: &PreparedRay) -> PreparedRay {
        if self.identity {
            *world
        } else {
            PreparedRay::new(&self.to_local.ray(ray))
        }
    }
}

/// The nearest hit of a ray, without surface details. See [`Geometry::trace`].
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct RayHit {
    /// Index of the instance hit.
    pub instance: u32,
    /// Index of the triangle in the instance's mesh.
    pub triangle: u32,
    /// Ray parameter of the hit.
    pub t: f32,
}

/// The nearest hit of a ray with everything needed to shade it or to pick it.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Hit {
    /// Index of the instance hit.
    pub instance: u32,
    /// Index of the triangle in the instance's mesh.
    pub triangle: u32,
    /// Ray parameter of the hit.
    pub t: f32,
    /// World-space point on the triangle (barycentric interpolation of its corners).
    pub point: Vec3,
    /// Unit shading normal in world space: interpolated vertex normals when the mesh has them,
    /// the geometric normal otherwise. Faces the side the ray came from.
    pub normal: Vec3,
    /// Unit normal of the triangle's plane in world space, facing the side the ray came from.
    pub geometric_normal: Vec3,
    /// Weights of the triangle's three corners (they sum to one).
    pub barycentrics: [f32; 3],
    /// True when the ray hit the front face (counter-clockwise corners, as wound in the mesh).
    pub front_face: bool,
    /// True when the ray arrives from the outside of the surface: the front face, unless the
    /// mesh's vertex normals say its winding is reversed ([`Mesh::inside_out`]).
    pub outside: bool,
}

/// Every mesh and instance of a scene, with the instance-level BVH. Immutable once built.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Geometry {
    meshes: Vec<Mesh>,
    instances: Vec<Instance>,
    prepared: Vec<PreparedInstance>,
    tlas: Bvh,
    /// Instance index of each leaf slot of `tlas`.
    tlas_instances: Vec<u32>,
    bounds: Aabb,
    /// The particle sets of the ambient effects (S4a), in effect order.
    particles: Vec<ParticleSet>,
    /// The section view (Q1): a plane that removes one side of the model, capping the cut. None
    /// until [`Geometry::set_section`], and then every query sees the cut model.
    section: Option<Section>,
}

/// True when `ray` can be traced: finite origin and a finite, non-zero direction.
#[inline(always)]
pub(crate) fn usable(ray: &Ray) -> bool {
    ray.origin.is_finite() && ray.dir.is_finite() && ray.dir != Vec3::ZERO
}

/// World box of an instance, padded when the transform is not the identity so that the
/// rounding of the transforms can never make the top level miss what the bottom level hits.
fn instance_bounds(mesh: &Mesh, transform: &Transform) -> Aabb {
    if transform.is_identity() {
        return mesh.bounds();
    }
    let b = transform.aabb(&mesh.bounds());
    let scale = b.min.abs().max(b.max.abs()).max_component();
    let pad = Vec3::splat(scale * 1.0e-5);
    Aabb::new(b.min - pad, b.max + pad)
}

impl Geometry {
    /// One identity instance per mesh, with the mesh's material: what a scene without explicit
    /// instances renders.
    pub fn implicit_instances(meshes: &[Mesh]) -> Vec<Instance> {
        meshes
            .iter()
            .enumerate()
            .map(|(i, m)| Instance::new(i as u32, Transform::IDENTITY, m.material_id()))
            .collect()
    }

    /// Geometry with one identity instance per mesh (see [`Geometry::implicit_instances`]).
    /// More than [`MAX_INSTANCES`] meshes give an empty geometry.
    pub fn from_meshes(meshes: Vec<Mesh>) -> Geometry {
        let instances = Geometry::implicit_instances(&meshes);
        // Implicit instances always refer to existing meshes; only the count can be too large.
        Geometry::new(meshes, instances).unwrap_or_default()
    }

    /// Builds the instance BVH (of the [native width](BvhWidth::native)).
    pub fn new(meshes: Vec<Mesh>, instances: Vec<Instance>) -> Result<Geometry, GeometryError> {
        Geometry::with_width(meshes, instances, BvhWidth::native())
    }

    /// Like [`Geometry::new`] with an explicit width for the instance BVH.
    ///
    /// Instances whose mesh has no triangles, or whose transform is singular or not finite, are
    /// kept but can never be hit.
    pub fn with_width(
        meshes: Vec<Mesh>,
        instances: Vec<Instance>,
        width: BvhWidth,
    ) -> Result<Geometry, GeometryError> {
        Geometry::with_particles(meshes, instances, Vec::new(), width)
    }

    /// Like [`Geometry::with_width`] with the particle sets of the scene's effects: each is one
    /// more entry of the top level, beside the instance BVH. Without sets the geometry is exactly
    /// the one of [`Geometry::with_width`].
    pub fn with_particles(
        meshes: Vec<Mesh>,
        instances: Vec<Instance>,
        particles: Vec<ParticleSet>,
        width: BvhWidth,
    ) -> Result<Geometry, GeometryError> {
        if instances.len() + particles.len() > MAX_INSTANCES {
            return Err(GeometryError::TooManyInstances);
        }
        let mut prepared = Vec::with_capacity(instances.len());
        let mut boxes = Vec::new();
        let mut centroids = Vec::new();
        let mut active = Vec::new();
        let mut bounds = Aabb::EMPTY;
        for (i, instance) in instances.iter().enumerate() {
            let mesh = meshes
                .get(instance.mesh as usize)
                .ok_or(GeometryError::MeshOutOfRange { instance: i as u32 })?;
            let inverse = instance.transform.inverse();
            let live = mesh.triangle_count() > 0 && inverse.is_some();
            prepared.push(PreparedInstance {
                to_local: inverse.unwrap_or(Transform::IDENTITY),
                identity: instance.transform.is_identity(),
                cull: instance.cull(),
                active: live,
                camera_hidden: instance.flags & INSTANCE_NO_CAMERA != 0,
            });
            if live {
                let b = instance_bounds(mesh, &instance.transform);
                bounds = bounds.union(b);
                boxes.push(b);
                centroids.push(b.centroid());
                active.push(i as u32);
            }
        }
        let mut tlas_instances = Vec::with_capacity(active.len());
        let tlas = Bvh::build(&boxes, &centroids, INSTANCE_LEAVES, width, |prims| {
            let first = tlas_instances.len();
            tlas_instances.extend(prims.iter().map(|&p| active[p as usize]));
            leaf_ref(first, prims.len())
        });
        Ok(Geometry {
            meshes,
            instances,
            prepared,
            tlas,
            tlas_instances,
            bounds,
            particles,
            section: None,
        })
    }

    /// The meshes.
    pub fn meshes(&self) -> &[Mesh] {
        &self.meshes
    }

    /// Gives the meshes (with their BVHs) back, dropping the instances: a host that changes only
    /// the instances, materials or lights of a scene rebuilds the geometry from them without
    /// building any mesh BVH again.
    pub fn into_meshes(self) -> Vec<Mesh> {
        self.meshes
    }

    /// Gives the meshes and the particle sets back (see [`Geometry::into_meshes`]).
    pub fn into_parts(self) -> (Vec<Mesh>, Vec<ParticleSet>) {
        (self.meshes, self.particles)
    }

    /// Takes the particle sets out (the geometry then has none to hit).
    pub(crate) fn take_particles(&mut self) -> Vec<ParticleSet> {
        std::mem::take(&mut self.particles)
    }

    /// The particle sets, in effect order.
    pub fn particle_sets(&self) -> &[ParticleSet] {
        &self.particles
    }

    /// The particle set whose hits report `instance` (`instances().len() + k` for set `k`).
    #[inline(always)]
    pub fn particle_set(&self, instance: u32) -> Option<&ParticleSet> {
        let k = (instance as usize).checked_sub(self.instances.len())?;
        self.particles.get(k)
    }

    /// The material index of what a hit on `instance` shades with: the instance's, or the
    /// particle set's.
    pub fn material_of(&self, instance: u32) -> Option<u32> {
        match self.instances.get(instance as usize) {
            Some(i) => Some(i.material_id),
            None => self.particle_set(instance).map(ParticleSet::material_id),
        }
    }

    /// Number of particles of every set.
    pub fn particle_count(&self) -> usize {
        self.particles.iter().map(ParticleSet::len).sum()
    }

    /// The instances.
    pub fn instances(&self) -> &[Instance] {
        &self.instances
    }

    /// True when the instances are exactly [`Geometry::implicit_instances`].
    pub fn has_implicit_instances(&self) -> bool {
        self.instances == Geometry::implicit_instances(&self.meshes)
    }

    /// Number of distinct triangles (each mesh counted once).
    pub fn triangle_count(&self) -> usize {
        self.meshes.iter().map(Mesh::triangle_count).sum()
    }

    /// Number of triangles placed in the world (each instance counts its mesh).
    pub fn instanced_triangle_count(&self) -> usize {
        self.instances
            .iter()
            .filter_map(|i| self.meshes.get(i.mesh as usize))
            .map(Mesh::triangle_count)
            .sum()
    }

    /// World bounding box of every instance that can be hit ([`Aabb::EMPTY`] when none). The
    /// particles are not in it (what lights the scene is framed by the parts).
    pub fn bounds(&self) -> Aabb {
        self.bounds
    }

    /// Size figures of the instance BVH.
    pub fn bvh_stats(&self) -> BvhStats {
        self.tlas.stats()
    }

    pub(crate) fn tlas(&self) -> &Bvh {
        &self.tlas
    }

    /// The mesh and prepared data of an instance that can be hit.
    #[inline(always)]
    pub(crate) fn instance_parts(&self, instance: u32) -> Option<(&Mesh, &PreparedInstance)> {
        let prepared = self.prepared.get(instance as usize)?;
        if !prepared.active {
            return None;
        }
        let mesh = self
            .meshes
            .get(self.instances[instance as usize].mesh as usize)?;
        Some((mesh, prepared))
    }

    /// K3: true when `instance` is hidden to the camera ([`INSTANCE_NO_CAMERA`]).
    #[inline]
    pub(crate) fn camera_hidden(&self, instance: u32) -> bool {
        self.prepared
            .get(instance as usize)
            .is_some_and(|p| p.camera_hidden)
    }

    /// The mesh and the instance of an instance that can be hit.
    pub(crate) fn instance_mesh(&self, instance: u32) -> Option<(&Mesh, &Instance)> {
        let (mesh, _) = self.instance_parts(instance)?;
        Some((mesh, self.instances.get(instance as usize)?))
    }

    /// A normal of instance `instance`'s mesh space in world space (by the inverse transpose; not
    /// normalised).
    pub(crate) fn normal_to_world(&self, instance: u32, n: Vec3) -> Vec3 {
        match self.prepared.get(instance as usize) {
            Some(p) if !p.identity => p.to_local.transpose_vector(n),
            _ => n,
        }
    }

    /// A world normal in instance `instance`'s mesh space (by the transpose; not normalised).
    pub(crate) fn normal_to_object(&self, instance: u32, n: Vec3) -> Vec3 {
        match (
            self.prepared.get(instance as usize),
            self.instances.get(instance as usize),
        ) {
            (Some(p), Some(i)) if !p.identity => i.transform.transpose_vector(n),
            _ => n,
        }
    }

    /// A displacement in world space in instance `instance`'s mesh space (by the inverse).
    pub(crate) fn vector_to_object(&self, instance: u32, v: Vec3) -> Vec3 {
        match self.prepared.get(instance as usize) {
            Some(p) if !p.identity => p.to_local.vector(v),
            _ => v,
        }
    }

    /// A displacement of instance `instance`'s mesh space in world space.
    pub(crate) fn vector_to_world(&self, instance: u32, v: Vec3) -> Vec3 {
        match (
            self.prepared.get(instance as usize),
            self.instances.get(instance as usize),
        ) {
            (Some(p), Some(i)) if !p.identity => i.transform.vector(v),
            _ => v,
        }
    }

    /// The instance in leaf slot `slot` of the instance BVH.
    #[inline(always)]
    pub(crate) fn tlas_instance(&self, slot: usize) -> Option<(u32, &Mesh, &PreparedInstance)> {
        let instance = *self.tlas_instances.get(slot)?;
        let (mesh, prepared) = self.instance_parts(instance)?;
        Some((instance, mesh, prepared))
    }

    /// The brute-force reference of [`Geometry::trace`] and [`Geometry::occluded`]: every
    /// triangle of every instance, no BVH. Tests only.
    #[cfg(test)]
    pub(crate) fn brute_force(&self, ray: &Ray, class: RayClass) -> (Option<RayHit>, bool) {
        traverse::brute_force(self, ray, class)
    }

    /// Nearest hit of `ray` within `[t_min, t_max]`: instance, triangle and `t` only. Particles
    /// are seen as by a scattered ray ([`RayClass::Secondary`]).
    pub fn trace(&self, ray: &Ray) -> Option<RayHit> {
        self.trace_with(ray, Isa::detect())
    }

    /// [`Geometry::trace`] on an explicit SIMD path.
    pub fn trace_with(&self, ray: &Ray, isa: Isa) -> Option<RayHit> {
        self.trace_class(ray, isa, RayClass::Secondary)
    }

    /// [`Geometry::trace`] seeing the particles as a ray of `class` does.
    pub fn trace_class(&self, ray: &Ray, isa: Isa, class: RayClass) -> Option<RayHit> {
        if !usable(ray) {
            return None;
        }
        match &self.section {
            Some(section) => self.trace_sectioned(section, ray, isa, class),
            None => self.trace_raw(ray, isa, class),
        }
    }

    /// The nearest hit of a usable `ray`, whole (the section view, if any, left out).
    fn trace_raw(&self, ray: &Ray, isa: Isa, class: RayClass) -> Option<RayHit> {
        isa.dispatch(NearestKernel {
            geometry: self,
            ray,
            class,
        })
    }

    /// [`Geometry::trace`] for every ray of `rays`, into `out` (one dispatch for the batch).
    /// Extra entries of the longer slice are left alone.
    pub fn trace_batch_with(&self, rays: &[Ray], out: &mut [Option<RayHit>], isa: Isa) {
        if self.section.is_some() {
            for (ray, slot) in rays.iter().zip(out.iter_mut()) {
                *slot = self.trace_class(ray, isa, RayClass::Secondary);
            }
            return;
        }
        isa.dispatch(NearestBatchKernel {
            geometry: self,
            rays,
            out,
            class: RayClass::Secondary,
        });
    }

    /// True when `ray` hits anything within `[t_min, t_max]` (shadow rays: particles that cast
    /// shadows, [`RayClass::Shadow`]). Stops at the first hit found.
    pub fn occluded(&self, ray: &Ray) -> bool {
        self.occluded_with(ray, Isa::detect())
    }

    /// [`Geometry::occluded`] on an explicit SIMD path.
    pub fn occluded_with(&self, ray: &Ray, isa: Isa) -> bool {
        self.occluded_class(ray, isa, RayClass::Shadow)
    }

    /// [`Geometry::occluded`] seeing the particles as a ray of `class` does.
    pub fn occluded_class(&self, ray: &Ray, isa: Isa, class: RayClass) -> bool {
        usable(ray)
            && match &self.section {
                Some(section) => self.occluded_sectioned(section, ray, isa, class),
                None => self.occluded_raw(ray, isa, class),
            }
    }

    /// Whether a usable `ray` hits anything, whole (the section view, if any, left out).
    fn occluded_raw(&self, ray: &Ray, isa: Isa, class: RayClass) -> bool {
        isa.dispatch(AnyKernel {
            geometry: self,
            ray,
            class,
        })
    }

    /// [`Geometry::occluded`] for every ray of `rays`, into `out` (one dispatch for the batch).
    pub fn occluded_batch_with(&self, rays: &[Ray], out: &mut [bool], isa: Isa) {
        if self.section.is_some() {
            for (ray, slot) in rays.iter().zip(out.iter_mut()) {
                *slot = self.occluded_class(ray, isa, RayClass::Shadow);
            }
            return;
        }
        isa.dispatch(AnyBatchKernel {
            geometry: self,
            rays,
            out,
            class: RayClass::Shadow,
        });
    }

    /// Nearest hit of `ray` with its surface details ([`RayClass::Secondary`]).
    pub fn intersect(&self, ray: &Ray) -> Option<Hit> {
        self.intersect_with(ray, Isa::detect())
    }

    /// [`Geometry::intersect`] on an explicit SIMD path.
    pub fn intersect_with(&self, ray: &Ray, isa: Isa) -> Option<Hit> {
        self.intersect_class(ray, isa, RayClass::Secondary)
    }

    /// [`Geometry::intersect`] seeing the particles as a ray of `class` does.
    pub fn intersect_class(&self, ray: &Ray, isa: Isa, class: RayClass) -> Option<Hit> {
        let hit = self.trace_class(ray, isa, class)?;
        self.hit_details(ray, hit)
    }

    /// For a camera ray's hit on a particle widened to the minimum size on screen: the share of
    /// the widened area the particle really covers (below one), and where the ray leaves the
    /// widened particle. `None` for anything else.
    pub fn widened_hit(&self, ray: &Ray, hit: &RayHit) -> Option<(f32, f32)> {
        let set = self.particle_set(hit.instance)?;
        if !set.widened() {
            return None;
        }
        let coverage = set.coverage(hit.triangle);
        (coverage < 1.0).then(|| (coverage, set.exit(hit.triangle, ray, hit.t, true)))
    }

    /// The point rays leaving a smooth-shaded hit should start from: the hit point lifted onto
    /// the curved surface the vertex normals describe (J. Hanika, "Hacking the Shadow
    /// Terminator", *Ray Tracing Gems II*, 2021). Each corner's tangent plane is a local
    /// approximation of that surface; the point is projected onto the planes it lies below and
    /// the projections are blended with the barycentrics. Without it, a coarse mesh with smooth
    /// normals shades its facets into a jagged shadow terminator. Meshes without vertex normals
    /// (and hits that cannot be resolved) return `hit.point`.
    pub fn terminator_point(&self, hit: &Hit) -> Vec3 {
        let Some((mesh, prepared)) = self.instance_parts(hit.instance) else {
            return hit.point;
        };
        let (Some(corners), Some([p0, p1, p2])) = (
            mesh.triangle_indices(hit.triangle as usize),
            mesh.triangle(hit.triangle as usize),
        ) else {
            return hit.point;
        };
        let [Some(n0), Some(n1), Some(n2)] = corners.map(|c| mesh.normal(c as usize)) else {
            return hit.point;
        };
        let [b0, b1, b2] = hit.barycentrics;
        let p = p0 * b0 + p1 * b1 + p2 * b2;
        // Orient the vertex normals towards the side the ray came from.
        let interpolated = n0 * b0 + n1 * b1 + n2 * b2;
        let world_normal = if prepared.identity {
            interpolated
        } else {
            prepared.to_local.transpose_vector(interpolated)
        };
        let side = if world_normal.dot(hit.geometric_normal) < 0.0 {
            -1.0
        } else {
            1.0
        };
        let mut lifted = p;
        for (corner, normal, weight) in [(p0, n0, b0), (p1, n1, b1), (p2, n2, b2)] {
            let n = normal.normalize() * side;
            let below = (p - corner).dot(n);
            if below < 0.0 {
                lifted -= n * (below * weight);
            }
        }
        if !lifted.is_finite() {
            return hit.point;
        }
        if prepared.identity {
            lifted
        } else {
            match self.instances.get(hit.instance as usize) {
                Some(instance) => instance.transform.point(lifted),
                None => hit.point,
            }
        }
    }

    /// Surface details of a hit returned by [`Geometry::trace`] for the same `ray`.
    pub fn hit_details(&self, ray: &Ray, hit: RayHit) -> Option<Hit> {
        if hit.triangle == CAP_TRIANGLE {
            return self.cap_details(ray, hit);
        }
        if let Some(set) = self.particle_set(hit.instance) {
            set.slot(hit.triangle)?;
            let point = ray.at(hit.t);
            let outward = set.normal(hit.triangle, point);
            let front_face = outward.dot(ray.dir) < 0.0;
            let n = if front_face { outward } else { -outward };
            return Some(Hit {
                instance: hit.instance,
                triangle: hit.triangle,
                t: hit.t,
                point,
                normal: n,
                geometric_normal: n,
                barycentrics: [1.0, 0.0, 0.0],
                front_face,
                outside: front_face,
            });
        }
        let (mesh, prepared) = self.instance_parts(hit.instance)?;
        let to_world = &self.instances.get(hit.instance as usize)?.transform;
        let corners = mesh.triangle_indices(hit.triangle as usize)?;
        let [p0, p1, p2] = mesh.triangle(hit.triangle as usize)?;

        // The kernels only keep `t`; the scalar test gives the same bits and the weights.
        let local = prepared.local_ray(ray);
        let r = PreparedRay::new(&local);
        let barycentrics = match watertight(&r, p0, p1, p2, f32::MAX, Cull::None) {
            Some(h) => h.uvw.map(|w| w / h.det),
            None => [1.0 / 3.0; 3],
        };
        let [b0, b1, b2] = barycentrics;
        let point_local = p0 * b0 + p1 * b1 + p2 * b2;

        let to_normal = |n: Vec3| {
            if prepared.identity {
                n
            } else {
                prepared.to_local.transpose_vector(n)
            }
        };
        let winding = to_normal((p1 - p0).cross(p2 - p0)).normalize();
        let incoming = ray.dir.normalize();
        let geometric = if winding.length_squared() > 0.0 {
            winding
        } else {
            -incoming // A degenerate triangle has no plane: face the ray.
        };
        let front_face = winding.dot(ray.dir) < 0.0;
        let smooth = match corners.map(|c| mesh.normal(c as usize)) {
            [Some(n0), Some(n1), Some(n2)] => to_normal(n0 * b0 + n1 * b1 + n2 * b2),
            _ => Vec3::ZERO,
        };
        let normal = if smooth.length_squared() > 1.0e-12 {
            smooth.normalize()
        } else {
            geometric
        };
        let face = |n: Vec3| if n.dot(ray.dir) > 0.0 { -n } else { n };
        Some(Hit {
            instance: hit.instance,
            triangle: hit.triangle,
            t: hit.t,
            point: if prepared.identity {
                point_local
            } else {
                to_world.point(point_local)
            },
            normal: face(normal),
            geometric_normal: face(geometric),
            barycentrics,
            front_face,
            outside: front_face != mesh.inside_out(),
        })
    }
}
