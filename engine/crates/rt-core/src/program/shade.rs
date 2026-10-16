//! What a material program makes of a hit (M3b), prepared once per scene ([`ProgramSetup`], held
//! by [`crate::integrator::Prepared`]) and run at every camera and BSDF hit of an instance whose
//! material has one, before its textures (M2b), which multiply what it gives as they multiply a
//! plain material's values.
//!
//! * **The shading point** ([`Context`]), in the part's own space (the mesh's coordinates,
//!   whatever the instance's transform): the point; the shading normal (the bevelled one of
//!   [`crate::bevel`]) turned to the outside of the part; the UV sets (the second one is the first
//!   when the mesh has one; zero without UVs); the direction to the viewer (the ray's origin);
//!   the tangent along the first set's `u` (its surface gradient, orthogonalised against the
//!   normal; `onb(N)` without UVs), `B = N × T` and the change of the first set along both, per
//!   millimetre.
//! * **The material** ([`Resolved`]): the material of the file (`MATL`, which the page's writer
//!   fills with the program's material values: its kind, absorption distance and thin walls)
//!   with each point's base colour, metal, roughness, anisotropy, clear coat and its roughness,
//!   transmission, index of refraction and opacity, each brought to its range (a value that is
//!   not a number keeps the file's). The `subsurface` output is not read: E9's medium is the
//!   volume's (a mean free path, a colour, a direction), not a point's, and a plain material's
//!   `subsurface` does not reach the engine either.
//! * **The normal**: the program's normal (bump and normal maps applied, part space) back to the
//!   world and to the side the ray came from, never facing away from the viewer (as M2b bends
//!   it); the point rays leave from and the geometric normal do not change.
//! * **Emission**: an emitter (kind 2) sends `emission × emission strength` of the point and
//!   reflects nothing; any other material adds it to what it reflects, as M2b's emission slot.
//!   An emitter whose emission is not a constant of the program is found by the rays that hit
//!   it, not sampled as a light by its flux ([`emission_varies`]).
//! * **Bevel**: the output is a weight of the material's radius. A constant weight scales it for
//!   the whole part; a computed one runs the program twice, at the plain shading point for the
//!   weight and at the point bevelled by it for everything else.
//! * **Curvature** (`EDGE`, `CAVITY`): from the bevel's sharp edges
//!   ([`crate::bevel::BevelSetup::curvature`]); E7 is not there yet.
//! * **Images** are filtered over the ray's footprint (the camera's ray differentials, the path's
//!   cone after, as M2b's), on level 0 for shadow rays.
//!
//! The particles of the ambient effects (S4a) keep their material's plain values, and so do the
//! photons of the caustics, as with the textures and the patterns.

use super::interp::{onb_tangent, Context, Footprint as LodFootprint, Host, Outputs, Runner};
use super::{
    Program, ValueRef, OUT_ANISOTROPY, OUT_BASE_COLOR, OUT_BEVEL, OUT_COAT, OUT_COAT_ROUGHNESS,
    OUT_EMISSION, OUT_EMISSION_STRENGTH, OUT_IOR, OUT_METALLIC, OUT_NORMAL, OUT_OPACITY,
    OUT_ROUGHNESS, OUT_TRANSMISSION,
};
use crate::bevel::{BevelSetup, ShadingPoint, MIN_FACING};
use crate::color::Rgb;
use crate::geometry::Hit;
use crate::math::{Ray, Vec3};
use crate::scene::{Material, Scene};
use crate::texture::shade::Local;
use crate::texture::Footprint;
use std::sync::Arc;

/// The bevel output of a program.
#[derive(Clone, Copy, Debug, PartialEq)]
enum Bevel {
    /// The material's radius as it is (no bevel, or a weight of 1).
    Plain,
    /// A constant weight other than 1.
    Scaled(f32),
    /// A weight computed at each point.
    Varies,
}

/// A program prepared for the instances of one material.
#[derive(Clone, Debug, PartialEq)]
struct Prepared {
    runner: Runner,
    /// The normal output is something else than the shading point's normal.
    normal: bool,
    bevel: Bevel,
    /// The opacity is not a constant of 1 or more: rays may pass the surface.
    see_through: bool,
    /// The program reads the part's curvature.
    curvature: bool,
}

impl Prepared {
    fn new(
        program: Program,
        images: Vec<Option<Arc<crate::texture::TextureImage>>>,
        m: &Material,
    ) -> Prepared {
        let normal = program.outputs[OUT_NORMAL] != ValueRef::V(1);
        let bevel = if m.is_emissive() || m.bevel_mm.is_nan() || m.bevel_mm <= 0.0 {
            Bevel::Plain
        } else {
            match program.constant(OUT_BEVEL) {
                Some([w, ..]) => {
                    let w = if w.is_nan() { 1.0 } else { w.clamp(0.0, 1.0) };
                    if w == 1.0 {
                        Bevel::Plain
                    } else {
                        Bevel::Scaled(w)
                    }
                }
                None => Bevel::Varies,
            }
        };
        let see_through = !m.is_emissive()
            && match program.constant(OUT_OPACITY) {
                Some([o, ..]) => o.is_nan() || o < 1.0,
                None => true,
            };
        let curvature = program.uses(super::op::EDGE) || program.uses(super::op::CAVITY);
        Prepared {
            runner: Runner::new(program, images),
            normal,
            bevel,
            see_through,
            curvature,
        }
    }
}

/// What a program makes of a material at a point.
#[derive(Clone, Debug, PartialEq)]
pub struct Resolved {
    /// The material there.
    pub material: Material,
    /// The radiance the surface sends there: an emitter's whole radiance, or what the program's
    /// emission adds to any other material (black: nothing).
    pub emission: Rgb,
}

/// The programs of every instance of a scene, prepared once per scene.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct ProgramSetup {
    /// Per instance (particles have none).
    instances: Vec<Option<Arc<Prepared>>>,
}

/// Where a program runs in the engine: the footprint, and the curvature of the part at the hit.
struct HitHost<'a> {
    scene: &'a Scene,
    bevel: &'a BevelSetup,
    details: &'a Hit,
    footprint: Option<LodFootprint>,
    /// The last curvature measured: (radius, convexity, concavity).
    curvature: Option<(f32, f32, f32)>,
}

impl HitHost<'_> {
    fn measure(&mut self, radius: f32) -> (f32, f32) {
        match self.curvature {
            Some((r, e, c)) if r == radius => (e, c),
            _ => {
                let (e, c) = self.bevel.curvature(self.scene, self.details, radius);
                self.curvature = Some((radius, e, c));
                (e, c)
            }
        }
    }
}

impl Host for HitHost<'_> {
    fn footprint(&self) -> Option<&LodFootprint> {
        self.footprint.as_ref()
    }
    fn edge(&mut self, radius: f32) -> f32 {
        self.measure(radius).0
    }
    fn cavity(&mut self, radius: f32) -> f32 {
        self.measure(radius).1
    }
}

#[inline]
fn arr(v: Vec3) -> [f32; 3] {
    [v.x, v.y, v.z]
}

#[inline]
fn vec(a: [f32; 3]) -> Vec3 {
    Vec3::new(a[0], a[1], a[2])
}

/// The shading point of a hit in the part's space, and the side (+1 or −1) that turns the
/// shading normal `normal` (world) to the outside of the part.
fn context(
    scene: &Scene,
    details: &Hit,
    normal: Vec3,
    to_viewer: Vec3,
    local: &Local,
) -> (Context, f32) {
    let geometry = &scene.geometry;
    let ns = geometry
        .normal_to_object(details.instance, normal)
        .normalize();
    let side = if ns.dot(local.n) < 0.0 { -1.0 } else { 1.0 };
    let n = if ns.is_finite() && ns != Vec3::ZERO {
        ns * side
    } else {
        local.n
    };
    let sets = geometry
        .instance_mesh(details.instance)
        .map_or(0, |(mesh, _)| mesh.uv_sets().min(2));
    let uv = &local.uv;
    let uv0 = if sets >= 1 {
        [uv.uv[0][0], uv.uv[0][1], 0.0]
    } else {
        [0.0; 3]
    };
    let uv1 = if sets >= 2 {
        [uv.uv[1][0], uv.uv[1][1], 0.0]
    } else {
        uv0
    };
    let i = geometry
        .vector_to_object(details.instance, to_viewer)
        .normalize();
    let i = if i.is_finite() && i != Vec3::ZERO {
        i
    } else {
        n
    };
    // T along the first set's u, in the tangent plane; onb(N) without UVs.
    let (gu, gv) = if sets >= 1 {
        (uv.grad[0][0], uv.grad[0][1])
    } else {
        (Vec3::ZERO, Vec3::ZERO)
    };
    let along = gu - n * n.dot(gu);
    let t = if sets >= 1 && along.length_squared() > 1.0e-20 {
        along.normalize()
    } else {
        vec(onb_tangent(arr(n)))
    };
    let b = n.cross(t);
    let ctx = Context {
        p: arr(local.p),
        n: arr(n),
        uv0,
        uv1,
        i: arr(i),
        t: arr(t),
        b: arr(b),
        duv_t: [gu.dot(t), gv.dot(t), 0.0],
        duv_b: [gu.dot(b), gv.dot(b), 0.0],
    };
    (ctx, side)
}

/// [`context`] for the tests of the module.
#[cfg(test)]
pub(crate) fn context_for_tests(
    scene: &Scene,
    details: &Hit,
    normal: Vec3,
    to_viewer: Vec3,
    local: &Local,
) -> (Context, f32) {
    context(scene, details, normal, to_viewer, local)
}

/// The footprint of the ray at the hit in the part's space, and the change of each UV set along
/// its axes (`None`: level 0).
fn lod_footprint(
    scene: &Scene,
    details: &Hit,
    local: &Local,
    f: &Footprint,
) -> Option<LodFootprint> {
    if f.dx == Vec3::ZERO && f.dy == Vec3::ZERO {
        return None;
    }
    let geometry = &scene.geometry;
    let dx = geometry.vector_to_object(details.instance, f.dx);
    let dy = geometry.vector_to_object(details.instance, f.dy);
    let g = &local.uv.grad;
    let duv = [0usize, 1].map(|s| [dx, dy].map(|d| [g[s][0].dot(d), g[s][1].dot(d)]));
    Some(LodFootprint {
        dx: arr(dx),
        dy: arr(dy),
        duv,
    })
}

/// `v` if it is a number, else `fallback`, within `lo..=hi`.
#[inline]
fn ranged(v: f32, fallback: f32, lo: f32, hi: f32) -> f32 {
    if v.is_nan() {
        fallback
    } else {
        v.clamp(lo, hi)
    }
}

/// The material `base` with the program's outputs `o`.
fn resolve(base: &Material, o: &Outputs) -> Resolved {
    let mut m = base.clone();
    let c = o.vec(OUT_BASE_COLOR);
    m.base_color = Rgb::new(
        ranged(c[0], base.base_color.r, 0.0, 1.0),
        ranged(c[1], base.base_color.g, 0.0, 1.0),
        ranged(c[2], base.base_color.b, 0.0, 1.0),
    );
    m.metallic = ranged(o.scalar(OUT_METALLIC), base.metallic, 0.0, 1.0);
    m.roughness = ranged(o.scalar(OUT_ROUGHNESS), base.roughness, 0.0, 1.0);
    m.anisotropy = ranged(o.scalar(OUT_ANISOTROPY), base.anisotropy, 0.0, 1.0);
    m.coat = ranged(o.scalar(OUT_COAT), base.coat, 0.0, 1.0);
    m.coat_roughness = ranged(o.scalar(OUT_COAT_ROUGHNESS), base.coat_roughness, 0.0, 1.0);
    m.transmission = ranged(o.scalar(OUT_TRANSMISSION), base.transmission, 0.0, 1.0);
    m.ior = ranged(o.scalar(OUT_IOR), base.ior, 1.0, f32::MAX);
    m.opacity = ranged(o.scalar(OUT_OPACITY), base.opacity, 0.0, 1.0);
    let e = o.vec(OUT_EMISSION);
    let colour = Rgb::new(
        ranged(e[0], 0.0, 0.0, f32::MAX),
        ranged(e[1], 0.0, 0.0, f32::MAX),
        ranged(e[2], 0.0, 0.0, f32::MAX),
    );
    let strength = ranged(o.scalar(OUT_EMISSION_STRENGTH), 0.0, 0.0, f32::MAX);
    if m.is_emissive() {
        m.emission = colour;
        m.emission_power = strength;
        let emission = m.radiance();
        Resolved {
            material: m,
            emission,
        }
    } else {
        Resolved {
            material: m,
            emission: colour * strength,
        }
    }
}

impl ProgramSetup {
    /// The program of every instance whose material has one (a material program of this
    /// version, `PROG`), with its images.
    pub fn new(scene: &Scene) -> ProgramSetup {
        if scene.programs.iter().all(Option::is_none) {
            return ProgramSetup::default();
        }
        let per_material: Vec<Option<Arc<Prepared>>> = (0..scene.materials.len())
            .map(|i| {
                let p = scene.programs.get(i)?.as_ref()?;
                if !p.is_material() {
                    return None;
                }
                let images = p
                    .images
                    .iter()
                    .map(|e| e.image.and_then(|k| scene.images.get(k as usize).cloned()))
                    .collect();
                Some(Arc::new(Prepared::new(
                    Program::clone(p),
                    images,
                    &scene.materials[i],
                )))
            })
            .collect();
        if per_material.iter().all(Option::is_none) {
            return ProgramSetup::default();
        }
        let instances: Vec<Option<Arc<Prepared>>> = scene
            .geometry
            .instances()
            .iter()
            .map(|inst| per_material.get(inst.material_id as usize)?.clone())
            .collect();
        // The sharp edges the curvature is measured from, found now rather than at a first hit.
        for (i, p) in instances.iter().enumerate() {
            if p.as_ref().is_some_and(|p| p.curvature) {
                if let Some((mesh, _)) = scene.geometry.instance_mesh(i as u32) {
                    mesh.sharp_edges();
                }
            }
        }
        ProgramSetup { instances }
    }

    /// True when no instance has a program.
    pub fn is_empty(&self) -> bool {
        self.instances.iter().all(Option::is_none)
    }

    /// True when instance `i` has a program.
    pub fn has(&self, i: u32) -> bool {
        matches!(self.instances.get(i as usize), Some(Some(_)))
    }

    /// True when instance `i`'s program may make it see-through somewhere (its opacity is not a
    /// constant of 1): rays, shadow rays included, may pass it.
    pub fn see_through(&self, i: u32) -> bool {
        matches!(self.instances.get(i as usize), Some(Some(p)) if p.see_through)
    }

    /// The program at the hit `details` of `ray` on a surface of material `base`, with the
    /// footprint of the ray there: the material and the radiance it sends, and the shading point
    /// `shade` with the program's normal (and bevelled by its weight). `None` (and `shade`
    /// untouched) for an instance without a program.
    #[allow(clippy::too_many_arguments)]
    pub fn apply(
        &self,
        scene: &Scene,
        bevel: &BevelSetup,
        ray: &Ray,
        details: &Hit,
        shade: &mut ShadingPoint,
        base: &Material,
        footprint: &Footprint,
    ) -> Option<Resolved> {
        let prog = self.instances.get(details.instance as usize)?.as_ref()?;
        let local = Local::of(&scene.geometry, details)?;
        let to_viewer = -ray.dir.normalize();
        let mut host = HitHost {
            scene,
            bevel,
            details,
            footprint: lod_footprint(scene, details, &local, footprint),
            curvature: None,
        };
        let mut out = Outputs::default();
        let run = |shade: &ShadingPoint, host: &mut HitHost, out: &mut Outputs| -> f32 {
            let (ctx, side) = context(scene, details, shade.normal, to_viewer, &local);
            prog.runner.run(&ctx, host, out);
            side
        };
        let side = match prog.bevel {
            Bevel::Plain => run(shade, &mut host, &mut out),
            Bevel::Scaled(w) => {
                *shade = bevel.shading_point_scaled(scene, ray, details, w);
                run(shade, &mut host, &mut out)
            }
            Bevel::Varies => {
                let plain = bevel.shading_point_scaled(scene, ray, details, 0.0);
                let side = run(&plain, &mut host, &mut out);
                let w = ranged(out.scalar(OUT_BEVEL), 1.0, 0.0, 1.0);
                if w > 0.0 {
                    *shade = bevel.shading_point_scaled(scene, ray, details, w);
                    run(shade, &mut host, &mut out)
                } else {
                    *shade = plain;
                    side
                }
            }
        };
        if prog.normal {
            let n = vec(out.vec(OUT_NORMAL));
            let n = scene
                .geometry
                .normal_to_world(details.instance, n * side)
                .normalize();
            let c = n.dot(to_viewer);
            let n = if c < MIN_FACING {
                (n + to_viewer * (MIN_FACING - c)).normalize()
            } else {
                n
            };
            if n.is_finite() && n != Vec3::ZERO {
                shade.normal = n;
            }
        }
        Some(resolve(base, &out))
    }

    /// The material of a surface a shadow ray along `dir` crosses (a cut-out, a thin wall) at the
    /// hit `details`, with the program's values there (images on level 0, no bevel weight):
    /// `None` without a program.
    pub fn at_shadow(
        &self,
        scene: &Scene,
        details: &Hit,
        dir: Vec3,
        base: &Material,
    ) -> Option<Material> {
        Some(self.plain(scene, details, dir, base)?.material)
    }

    /// The base colour the program gives the hit `details` of the camera ray `ray`, its images
    /// filtered over `footprint` (the albedo pass), `None` without a program.
    pub fn albedo(
        &self,
        scene: &Scene,
        bevel: &BevelSetup,
        ray: &Ray,
        details: &Hit,
        base: &Material,
        footprint: &Footprint,
    ) -> Option<Material> {
        let mut shade = bevel.shading_point(scene, ray, details);
        Some(
            self.apply(scene, bevel, ray, details, &mut shade, base, footprint)?
                .material,
        )
    }

    /// The program at a hit seen along `dir`, at its interpolated shading normal, every image on
    /// level 0.
    fn plain(&self, scene: &Scene, details: &Hit, dir: Vec3, base: &Material) -> Option<Resolved> {
        let prog = self.instances.get(details.instance as usize)?.as_ref()?;
        let local = Local::of(&scene.geometry, details)?;
        let mut host = HitHost {
            scene,
            bevel: &BevelSetup::default(),
            details,
            footprint: None,
            curvature: None,
        };
        // `context` turns the interpolated normal to the outside of the part.
        let (ctx, _) = context(scene, details, details.normal, -dir.normalize(), &local);
        let mut out = Outputs::default();
        prog.runner.run(&ctx, &mut host, &mut out);
        Some(resolve(base, &out))
    }
}

/// True when the emitted radiance of material `material` of `scene` varies over its surface (an
/// emitter whose program's emission or strength is not a constant): it is not sampled as a light
/// by its flux, only found by the rays that hit it.
pub fn emission_varies(scene: &Scene, material: u32) -> bool {
    let Some(Some(p)) = scene.programs.get(material as usize) else {
        return false;
    };
    let emitter = scene
        .materials
        .get(material as usize)
        .is_some_and(Material::is_emissive);
    emitter
        && p.is_material()
        && (p.constant(OUT_EMISSION).is_none() || p.constant(OUT_EMISSION_STRENGTH).is_none())
}
