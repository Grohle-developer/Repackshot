//! The path tracer: unidirectional path tracing with next-event estimation and multiple
//! importance sampling (E. Veach, *Robust Monte Carlo Methods for Light Transport Simulation*,
//! PhD thesis, Stanford 1997, ch. 9; J. Kajiya, "The Rendering Equation", SIGGRAPH 1986).
//!
//! At every surface the path (1) adds the emission of what it hit, (2) samples **one** light
//! ([`Lights::sample`]) and traces a shadow ray, (3) samples the BSDF for the next direction.
//! Emitters reached by BSDF-sampled rays (area lights with the `glossy` flag, the environment,
//! sun discs, emissive meshes sampled as lights) are weighted against the light sampling with the
//! power heuristic, and light samples against the BSDF density, so nothing is counted twice.
//!
//! * **Depth**: at most [`RenderSettings::depth`](crate::scene::RenderSettings::depth) surface
//!   interactions (one: direct lighting only). Russian roulette from the third vertex on
//!   survives with probability `max(throughput)`, clamped to `[0.05, 1]`.
//! * **Clamp**: with `clamp_indirect > 0`, every contribution of light that bounced at least
//!   twice before reaching the camera is scaled so that its largest channel is at most that.
//! * **Random numbers**: the [`PixelSampler`] of the pixel and sample, with the dimension layout
//!   of [`crate::sampler`]: the same numbers whatever the tile, thread or order.
//! * **Floor**: `FLOR` mode 1 is an infinite Lambertian plane seen by every ray; mode 2 (shadow
//!   catcher) is only seen by camera rays, which see the background darkened by the fraction of
//!   the light reaching the plane that the scene blocks: next-event estimation and one BSDF
//!   sample are evaluated with and without occlusion, and their ratio (in luminance) is the
//!   shadow. With a transparent background the shadow becomes alpha over black.
//! * **Background**: camera rays that escape see the environment (with sun discs flagged
//!   `camera`), the background colour, or nothing (alpha 0), per `ENVR.background_mode`. The
//!   environment lights the scene in every mode.

use crate::bsdf::{Bsdf, Lobes};
use crate::color::Rgb;
use crate::geometry::{Geometry, RayHit};
use crate::light::{power_heuristic, Lights};
use crate::math::{offset_origin, Frame, Ray, Vec3};
use crate::sampler::{
    bounce_dim, PixelSampler, OFFSET_BSDF, OFFSET_LIGHT, OFFSET_LIGHT_SELECT, OFFSET_ROULETTE,
};
use crate::scene::{Background, FloorMode, Material, Scene, INSTANCE_ONE_SIDED};
use crate::simd::Isa;

/// Nearest-hit and shadow queries against the scene geometry.
pub trait Tracer {
    /// Nearest hit of `ray` within `[t_min, t_max]`.
    fn trace(&self, ray: &Ray) -> Option<RayHit>;
    /// True when anything blocks `ray` within `[t_min, t_max]`.
    fn occluded(&self, ray: &Ray) -> bool;
}

/// The BVH of a [`Geometry`], on one SIMD path.
#[derive(Clone, Copy, Debug)]
pub struct BvhTracer<'a> {
    /// The geometry.
    pub geometry: &'a Geometry,
    /// SIMD path of the traversal (every path gives the same answers).
    pub isa: Isa,
}

impl Tracer for BvhTracer<'_> {
    #[inline]
    fn trace(&self, ray: &Ray) -> Option<RayHit> {
        self.geometry.trace_with(ray, self.isa)
    }

    #[inline]
    fn occluded(&self, ray: &Ray) -> bool {
        self.geometry.occluded_with(ray, self.isa)
    }
}

/// What the integrator needs besides the scene, computed once per scene (lights, their
/// selection distribution, background and floor settings).
#[derive(Clone, Debug, PartialEq)]
pub struct Prepared {
    lights: Lights,
    background: Background,
    background_color: Rgb,
    floor_mode: FloorMode,
    floor_z: f32,
    floor_bsdf: Bsdf,
    max_depth: u32,
    clamp_indirect: f32,
    /// Used for instances whose material index is out of range.
    fallback: Material,
}

impl Prepared {
    /// Prepares `scene` for rendering.
    pub fn new(scene: &Scene) -> Prepared {
        Prepared {
            lights: Lights::new(scene),
            background: scene.environment.background(),
            background_color: scene.environment.background_color.map(|v| v.max(0.0)),
            floor_mode: scene.floor.mode,
            floor_z: scene.floor.z,
            floor_bsdf: Bsdf::lambert(scene.floor.color),
            max_depth: scene.render.depth(),
            clamp_indirect: scene.render.clamp_indirect,
            fallback: Material::default(),
        }
    }

    /// The prepared lights.
    pub fn lights(&self) -> &Lights {
        &self.lights
    }

    /// Ray parameter where `ray` meets the floor plane, if the floor is there for this ray.
    fn floor_t(&self, ray: &Ray, camera_ray: bool) -> f32 {
        let present = match self.floor_mode {
            FloorMode::None => false,
            FloorMode::Visible => true,
            FloorMode::ShadowCatcher => camera_ray,
        };
        if !present || ray.dir.z == 0.0 {
            return f32::INFINITY;
        }
        let t = (self.floor_z - ray.origin.z) / ray.dir.z;
        if t > ray.t_min && t < ray.t_max {
            t
        } else {
            f32::INFINITY
        }
    }

    /// Shadow-ray test: the geometry, and the floor when it is visible.
    fn occluded<T: Tracer>(&self, tracer: &T, ray: &Ray) -> bool {
        (self.floor_mode == FloorMode::Visible && self.floor_t(ray, false) < f32::INFINITY)
            || tracer.occluded(ray)
    }

    /// Adds `c` to `sum`, dropping non-finite values and clamping indirect light.
    #[inline]
    fn add(&self, sum: &mut Rgb, c: Rgb, indirect: bool) {
        if !(c.r.is_finite() && c.g.is_finite() && c.b.is_finite()) {
            return;
        }
        let peak = c.r.max(c.g).max(c.b);
        if indirect && self.clamp_indirect > 0.0 && peak > self.clamp_indirect {
            *sum += c * (self.clamp_indirect / peak);
        } else {
            *sum += c;
        }
    }
}

/// Largest channel.
#[inline]
fn peak(c: Rgb) -> f32 {
    c.r.max(c.g).max(c.b)
}

/// A shadow ray from `origin` towards a light sample at `distance` (infinite for distant lights),
/// stopping just short of the light so that an emissive triangle does not shadow itself.
#[inline]
fn shadow_ray(origin: Vec3, dir: Vec3, distance: f32) -> Ray {
    let mut ray = Ray::new(origin, dir);
    if distance.is_finite() {
        ray.t_max = distance * (1.0 - 1.0e-4);
    }
    ray
}

/// What a camera or BSDF ray found.
struct Surface {
    /// Where lights are sampled from and new rays start (for smooth-shaded meshes, the hit
    /// lifted onto the smooth surface: [`Geometry::terminator_point`]).
    point: Vec3,
    /// Shading normal, facing the side the ray came from.
    normal: Vec3,
    /// Geometric normal, facing the side the ray came from.
    geometric: Vec3,
    /// The floor (`None`) or an instance with its material.
    instance: Option<(u32, bool)>,
}

/// Radiance and coverage arriving at the camera along `camera_ray`, for one sample of one
/// pixel. `rays` counts every ray cast (camera, extension and shadow rays).
pub fn radiance<T: Tracer>(
    scene: &Scene,
    prepared: &Prepared,
    tracer: &T,
    sampler: &PixelSampler,
    camera_ray: Ray,
    rays: &mut u64,
) -> (Rgb, f32) {
    let lights = &prepared.lights;
    let mut ray = camera_ray;
    let mut throughput = Rgb::WHITE;
    let mut sum = Rgb::BLACK;
    let mut alpha = 1.0;
    // Density of the BSDF sample that produced `ray`; `None` for the camera ray.
    let mut bsdf_pdf: Option<f32> = None;
    let mut bounce = 0u32;
    loop {
        *rays += 1;
        let hit = tracer.trace(&ray);
        let t_geometry = hit.map_or(f32::INFINITY, |h| h.t);
        let t_floor = prepared.floor_t(&ray, bounce == 0);
        let t_nearest = t_geometry.min(t_floor);

        // Area lights are transparent emitters: add every one crossed on the way.
        let crossed = lights.crossed(&ray, t_nearest, bsdf_pdf);
        prepared.add(&mut sum, throughput * crossed, bounce >= 2);

        if t_nearest == f32::INFINITY {
            match (bounce, prepared.background) {
                (0, Background::Environment) => sum += lights.escaped(ray.dir, None),
                (0, Background::Color) => sum += prepared.background_color,
                (0, Background::Transparent) => {
                    alpha = if peak(crossed) > 0.0 { 1.0 } else { 0.0 };
                }
                _ => {
                    let c = throughput * lights.escaped(ray.dir, bsdf_pdf);
                    prepared.add(&mut sum, c, bounce >= 2);
                }
            }
            break;
        }

        let surface = if t_floor < t_geometry {
            if prepared.floor_mode == FloorMode::ShadowCatcher {
                let (c, a) = shadow_catcher(prepared, tracer, sampler, &ray, t_floor, rays);
                return (sum + c, a);
            }
            let p = ray.at(t_floor);
            let n = Vec3::new(0.0, 0.0, if ray.dir.z < 0.0 { 1.0 } else { -1.0 });
            Surface {
                point: Vec3::new(p.x, p.y, prepared.floor_z),
                normal: n,
                geometric: n,
                instance: None,
            }
        } else {
            let Some(details) = hit.and_then(|h| scene.geometry.hit_details(&ray, h)) else {
                break;
            };
            // Keep the shading normal on the geometric side; where it would still face away
            // from the viewer (silhouettes of coarse smooth meshes), shade flat.
            let ng = details.geometric_normal;
            let mut normal = details.normal;
            if normal.dot(ng) < 0.0 {
                normal = -normal;
            }
            if normal.dot(ray.dir) >= -1.0e-4 {
                normal = ng;
            }
            Surface {
                point: scene.geometry.terminator_point(&details),
                normal,
                geometric: ng,
                instance: Some((details.instance, details.front_face)),
            }
        };

        let material = surface.instance.map(|(instance, _)| {
            scene
                .geometry
                .instances()
                .get(instance as usize)
                .and_then(|i| scene.materials.get(i.material_id as usize))
                .unwrap_or(&prepared.fallback)
        });

        // Emitters reflect nothing: add their light and stop.
        if let (Some((instance, front)), Some(m)) = (surface.instance, material) {
            if m.is_emissive() {
                let one_sided = scene
                    .geometry
                    .instances()
                    .get(instance as usize)
                    .is_some_and(|i| i.flags & INSTANCE_ONE_SIDED != 0);
                if front || !one_sided {
                    let weight = bsdf_pdf.map_or(1.0, |pdf| {
                        let cos = surface.geometric.dot(ray.dir);
                        lights.emitter_weight(instance, pdf, t_geometry, cos)
                    });
                    prepared.add(&mut sum, throughput * m.radiance() * weight, bounce >= 2);
                }
                break;
            }
        }

        if bounce >= prepared.max_depth {
            break;
        }

        let bsdf = material.map_or(prepared.floor_bsdf, Bsdf::principled);
        let frame = Frame::from_normal(surface.normal);
        let wo = frame.to_local(-ray.dir);
        let ng = surface.geometric;
        let origin = offset_origin(surface.point, ng);
        let dims = bounce_dim(bounce);

        // Next-event estimation: one light.
        let light_sample = lights.sample(
            surface.point,
            sampler.get1(dims + OFFSET_LIGHT_SELECT),
            sampler.get2(dims + OFFSET_LIGHT),
        );
        // No test against the geometric normal here: a light above the shading horizon but
        // below a coarse facet's plane is decided by the shadow ray from the lifted point, which
        // keeps the terminator smooth (a ray into the surface hits it and is shadowed).
        if let Some(ls) = light_sample {
            let wi = frame.to_local(ls.wi);
            let lobes = if ls.glossy {
                Lobes::All
            } else {
                Lobes::Diffuse
            };
            let f = bsdf.eval(wo, wi, lobes);
            if peak(f) > 0.0 {
                *rays += 1;
                if !prepared.occluded(tracer, &shadow_ray(origin, ls.wi, ls.distance)) {
                    let weight = if ls.delta || !ls.glossy {
                        1.0
                    } else {
                        power_heuristic(ls.pdf, bsdf.pdf(wo, wi))
                    };
                    let c = throughput * f * ls.radiance * (wi.z * weight / ls.pdf);
                    prepared.add(&mut sum, c, bounce >= 1);
                }
            }
        }

        // The next direction.
        let Some(bs) = bsdf.sample(wo, sampler.get2(dims + OFFSET_BSDF)) else {
            break;
        };
        let wi = frame.to_world(bs.wi).normalize();
        if wi.dot(ng) <= 0.0 {
            break; // the shading normal sent it below the actual surface
        }
        throughput = throughput * bs.weight;
        if bounce >= 2 {
            let survive = peak(throughput).clamp(0.05, 1.0);
            if sampler.get1(dims + OFFSET_ROULETTE) >= survive {
                break;
            }
            throughput = throughput / survive;
        }
        if !(peak(throughput) > 0.0 && peak(throughput).is_finite()) {
            break;
        }
        bsdf_pdf = Some(bs.pdf);
        ray = Ray::new(origin, wi);
        bounce += 1;
    }
    (sum, alpha)
}

/// A camera ray that hit the shadow catcher at `t`: the background behind it times the fraction
/// of light the scene does not block, or (transparent background) black with the blocked
/// fraction as alpha.
fn shadow_catcher<T: Tracer>(
    prepared: &Prepared,
    tracer: &T,
    sampler: &PixelSampler,
    ray: &Ray,
    t: f32,
    rays: &mut u64,
) -> (Rgb, f32) {
    let lights = &prepared.lights;
    let p = ray.at(t);
    let x = Vec3::new(p.x, p.y, prepared.floor_z);
    let n = Vec3::new(0.0, 0.0, if ray.dir.z < 0.0 { 1.0 } else { -1.0 });
    let frame = Frame::from_normal(n);
    let origin = offset_origin(x, n);
    let lambert = Bsdf::lambert(Rgb::WHITE);
    let wo = frame.to_local(-ray.dir);
    let dims = bounce_dim(0);
    // Luminance of the light reaching the plane with and without the scene in the way.
    let mut lit = 0.0f32;
    let mut open = 0.0f32;

    let light_sample = lights.sample(
        x,
        sampler.get1(dims + OFFSET_LIGHT_SELECT),
        sampler.get2(dims + OFFSET_LIGHT),
    );
    if let Some(ls) = light_sample.filter(|ls| ls.wi.dot(n) > 0.0) {
        let wi = frame.to_local(ls.wi);
        let weight = if ls.delta || !ls.glossy {
            1.0
        } else {
            power_heuristic(ls.pdf, lambert.pdf(wo, wi))
        };
        let c =
            (lambert.eval(wo, wi, Lobes::All) * ls.radiance).luminance() * wi.z * weight / ls.pdf;
        if c.is_finite() {
            open += c;
            *rays += 1;
            // The catcher itself is invisible: only the geometry blocks.
            if !tracer.occluded(&shadow_ray(origin, ls.wi, ls.distance)) {
                lit += c;
            }
        }
    }

    if let Some(bs) = lambert.sample(wo, sampler.get2(dims + OFFSET_BSDF)) {
        let wi = frame.to_world(bs.wi).normalize();
        let probe = Ray::new(origin, wi);
        *rays += 1;
        let blocker = tracer.trace(&probe).map_or(f32::INFINITY, |h| h.t);
        let pdf = Some(bs.pdf);
        let all = lights.crossed(&probe, f32::INFINITY, pdf) + lights.escaped(wi, pdf);
        let reached = if blocker == f32::INFINITY {
            all
        } else {
            lights.crossed(&probe, blocker, pdf)
        };
        let (a, r) = (
            (all * bs.weight).luminance(),
            (reached * bs.weight).luminance(),
        );
        if a.is_finite() && r.is_finite() {
            open += a;
            lit += r;
        }
    }

    let unshadowed = if open > 0.0 {
        (lit / open).clamp(0.0, 1.0)
    } else {
        1.0
    };
    match prepared.background {
        Background::Transparent => (Rgb::BLACK, 1.0 - unshadowed),
        Background::Environment => (lights.escaped(ray.dir, None) * unshadowed, 1.0),
        Background::Color => (prepared.background_color * unshadowed, 1.0),
    }
}

#[cfg(test)]
mod tests;
