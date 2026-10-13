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
//!   `camera`), the background colour, the background image, or nothing (alpha 0), per
//!   `ENVR.background_mode`. The environment lights the scene in every mode.
//!
//! **Glass and other clear materials** (E5). A refracted ray continues inside the solid; the
//! surface it leaves through is told apart by the side the ray arrives from
//! ([`crate::geometry::Hit::outside`]). Inside a solid with an absorption distance the throughput
//! falls by Beer–Lambert, `exp(-σ t)` with `σ = -ln(base_color) / absorption_mm` per channel.
//! Shadow rays are stopped by refracting surfaces (the light that crosses a solid arrives by the
//! paths that refract, the caustics); thin walls and cut-outs let them through attenuated by what
//! a straight ray keeps ([`Bsdf::straight_transmittance`], `1 - opacity`).
//!
//! **Straight events.** A cut-out the ray passes (probability `1 - opacity`, decided by a hashed
//! dimension of its own, [`cutout_dim`]) and a thin wall's straight transmission do not change
//! the direction. They are not scattering for multiple importance sampling: the ray keeps the
//! density of the last real vertex, and the distance travelled since it, so an emitter found
//! behind them is weighted exactly against the shadow ray that next-event estimation sent through
//! them from that vertex. A camera ray that only went straight is still a camera ray: it sees the
//! background and the lights flagged `camera`. A cut-out pass is not a path vertex (at most
//! [`MAX_CUTOUTS`] per path); a thin wall is.
//!
//! **Anisotropy**: the shading frame's tangent runs around the instance's local Z axis through
//! the centre of its mesh's bounds (Blender's default radial tangent, which the recipes' brushed
//! metals were tuned with), projected onto the tangent plane; where that degenerates, the
//! instance's X axis; then any.

use crate::bitmap::Image;
use crate::bsdf::{Bsdf, Lobes};
use crate::color::Rgb;
use crate::fmath;
use crate::geometry::{Geometry, RayHit};
use crate::light::{power_heuristic, Lights};
use crate::math::{offset_origin, Frame, Ray, Vec3};
use crate::sampler::{
    bounce_dim, cutout_dim, PixelSampler, OFFSET_BSDF, OFFSET_LIGHT, OFFSET_LIGHT_SELECT,
    OFFSET_ROULETTE,
};
use crate::scene::{
    Background, FloorMode, Material, Scene, BACKPLATE_FIT, BACKPLATE_STRETCH, INSTANCE_ONE_SIDED,
    MATERIAL_FLAG_THIN, NO_BITMAP,
};
use crate::simd::Isa;
use std::sync::Arc;

/// Most cut-outs a path passes through (beyond them they are opaque).
pub const MAX_CUTOUTS: u32 = 64;
/// Most surfaces a shadow ray crosses through thin walls and cut-outs before it counts as
/// blocked.
pub const MAX_SHADOW_CROSSINGS: u32 = 32;

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

/// The background image, fitted to the frame.
#[derive(Clone, Debug, PartialEq)]
struct Backplate {
    image: Arc<Image>,
    fit: u32,
    /// The output frame inside the rendered image: `[u0, v0, u1, v1]`.
    rect: [f32; 4],
    /// Width over height of the output frame and of the image.
    frame_aspect: f32,
    image_aspect: f32,
}

impl Backplate {
    /// The image at the screen position `(u, v)` of the rendered image (`None`: the background
    /// colour, outside a fitted image).
    fn lookup(&self, screen: (f32, f32)) -> Option<Rgb> {
        let [u0, v0, u1, v1] = self.rect;
        let mut u = (screen.0 - u0) / (u1 - u0);
        let mut v = (screen.1 - v0) / (v1 - v0);
        if self.fit != BACKPLATE_STRETCH {
            // Fill crops the image's longer side, fit shows all of it and leaves a band of
            // background colour along the frame's longer side. `k` is below one for an image
            // wider than the frame.
            let fit = self.fit == BACKPLATE_FIT;
            let k = self.frame_aspect / self.image_aspect;
            if self.image_aspect > self.frame_aspect {
                if fit {
                    v = 0.5 + (v - 0.5) * (1.0 / k);
                } else {
                    u = 0.5 + (u - 0.5) * k;
                }
            } else if fit {
                u = 0.5 + (u - 0.5) * k;
            } else {
                v = 0.5 + (v - 0.5) * (self.image_aspect / self.frame_aspect);
            }
        }
        if self.fit == BACKPLATE_FIT && !((0.0..=1.0).contains(&u) && (0.0..=1.0).contains(&v)) {
            return None;
        }
        Some(
            self.image
                .bilinear(u.clamp(0.0, 1.0), v.clamp(0.0, 1.0), false),
        )
    }
}

/// What the integrator needs besides the scene, computed once per scene (lights, their
/// selection distribution, background and floor settings).
#[derive(Clone, Debug, PartialEq)]
pub struct Prepared {
    lights: Lights,
    background: Background,
    background_color: Rgb,
    backplate: Option<Backplate>,
    floor_mode: FloorMode,
    floor_z: f32,
    floor_bsdf: Bsdf,
    max_depth: u32,
    clamp_indirect: f32,
    /// Used for instances whose material index is out of range.
    fallback: Material,
    /// Per instance: shadow rays may pass it (a cut-out or a thin wall).
    passable: Vec<bool>,
    any_passable: bool,
    /// Per material: the absorption coefficients per millimetre of its inside, if any.
    media: Vec<Option<Rgb>>,
    /// Per instance with an anisotropic material: the world centre and axis of its tangents.
    tangent_axes: Vec<Option<(Vec3, Vec3, Vec3)>>,
}

/// Absorption coefficients (per millimetre) of a clear material with an absorption distance.
fn medium_of(m: &Material) -> Option<Rgb> {
    let clear = m.transmission > 0.0 && m.metallic < 1.0 && m.flags & MATERIAL_FLAG_THIN == 0;
    if !(clear && m.absorption_mm > 0.0 && !m.is_emissive()) {
        return None;
    }
    let sigma = m
        .base_color
        .map(|c| -fmath::ln(c.clamp(1.0e-4, 1.0)) / m.absorption_mm);
    (sigma.r > 0.0 || sigma.g > 0.0 || sigma.b > 0.0).then_some(sigma)
}

impl Prepared {
    /// Prepares `scene` for rendering.
    pub fn new(scene: &Scene) -> Prepared {
        let env = &scene.environment;
        let backplate = (env.backplate_map != NO_BITMAP)
            .then(|| scene.bitmaps.get(env.backplate_map as usize))
            .flatten()
            .map(|b| {
                let (w, h) = (scene.render.width.max(1), scene.render.height.max(1));
                let [u0, v0, u1, v1] = env.backplate_rect;
                let rect = if u1 > u0 && v1 > v0 {
                    [u0, v0, u1, v1]
                } else {
                    [0.0, 0.0, 1.0, 1.0]
                };
                Backplate {
                    image: b.image.clone(),
                    fit: env.backplate_fit,
                    frame_aspect: ((rect[2] - rect[0]) * w as f32)
                        / ((rect[3] - rect[1]) * h as f32),
                    image_aspect: b.image.width as f32 / b.image.height as f32,
                    rect,
                }
            });
        let background = match env.background() {
            Background::Backplate if backplate.is_none() => Background::Color,
            other => other,
        };
        let instances = scene.geometry.instances();
        let material = |i: usize| {
            instances
                .get(i)
                .and_then(|inst| scene.materials.get(inst.material_id as usize))
        };
        let passable: Vec<bool> = (0..instances.len())
            .map(|i| {
                material(i).is_some_and(|m| {
                    !m.is_emissive()
                        && (m.opacity < 1.0
                            || (m.flags & MATERIAL_FLAG_THIN != 0
                                && m.transmission > 0.0
                                && (m.metallic < 1.0 || m.kind == crate::scene::MATERIAL_GLASS)))
                })
            })
            .collect();
        let tangent_axes = (0..instances.len())
            .map(|i| {
                let m = material(i)?;
                if m.anisotropy.is_nan() || m.anisotropy <= 0.0 || m.is_emissive() {
                    return None;
                }
                let inst = &instances[i];
                let mesh = scene.geometry.meshes().get(inst.mesh as usize)?;
                let centre = inst.transform.point(mesh.bounds().centroid());
                let axis = inst.transform.vector(Vec3::new(0.0, 0.0, 1.0)).normalize();
                let x_axis = inst.transform.vector(Vec3::new(1.0, 0.0, 0.0)).normalize();
                Some((centre, axis, x_axis))
            })
            .collect();
        Prepared {
            lights: Lights::new(scene),
            background,
            background_color: env.background_color.map(|v| v.max(0.0)),
            backplate,
            floor_mode: scene.floor.mode,
            floor_z: scene.floor.z,
            floor_bsdf: Bsdf::lambert(scene.floor.color),
            max_depth: scene.render.depth(),
            clamp_indirect: scene.render.clamp_indirect,
            fallback: Material::default(),
            any_passable: passable.iter().any(|&p| p),
            passable,
            media: scene.materials.iter().map(medium_of).collect(),
            tangent_axes,
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

    /// The material of instance `i`.
    fn material<'a>(&'a self, scene: &'a Scene, i: u32) -> &'a Material {
        scene
            .geometry
            .instances()
            .get(i as usize)
            .and_then(|inst| scene.materials.get(inst.material_id as usize))
            .unwrap_or(&self.fallback)
    }

    /// Follows `ray` through the cut-outs and thin walls it meets: what a straight ray keeps up
    /// to the first surface that stops it, and that surface's distance (infinite when nothing
    /// does; the visible floor stops it too).
    fn walk<T: Tracer>(&self, scene: &Scene, tracer: &T, ray: &Ray) -> (Rgb, f32) {
        let floor = if self.floor_mode == FloorMode::Visible {
            self.floor_t(ray, false)
        } else {
            f32::INFINITY
        };
        if !self.any_passable {
            let blocker = tracer.trace(ray).map_or(f32::INFINITY, |h| h.t);
            return (Rgb::WHITE, blocker.min(floor));
        }
        let mut keep = Rgb::WHITE;
        let mut r = *ray;
        let mut travelled = 0.0f32;
        for _ in 0..MAX_SHADOW_CROSSINGS {
            let Some(hit) = tracer.trace(&r) else {
                return (keep, floor);
            };
            let t = travelled + hit.t;
            if t >= floor {
                return (keep, floor);
            }
            if !self
                .passable
                .get(hit.instance as usize)
                .copied()
                .unwrap_or(false)
            {
                return (keep, t);
            }
            let Some(details) = scene.geometry.hit_details(&r, hit) else {
                return (keep, t);
            };
            let m = self.material(scene, hit.instance);
            let cos = details.geometric_normal.dot(r.dir);
            let opacity = m.opacity.clamp(0.0, 1.0);
            let through = Bsdf::principled(m).straight_transmittance(cos) * opacity
                + Rgb::splat(1.0 - opacity);
            keep = keep * through;
            if keep.r.max(keep.g).max(keep.b) <= 0.0 {
                return (Rgb::BLACK, t);
            }
            let origin = offset_origin(details.point, -details.geometric_normal);
            travelled += (origin - r.origin).dot(r.dir);
            let mut next = Ray::new(origin, r.dir);
            next.t_max = ray.t_max - travelled;
            if next.t_max.is_nan() || next.t_max <= next.t_min {
                return (keep, f32::INFINITY);
            }
            r = next;
        }
        (Rgb::BLACK, travelled)
    }

    /// Shadow-ray test: `None` when the geometry or the visible floor blocks `ray`, else what
    /// passes (white unless it crossed cut-outs or thin walls).
    fn shadow<T: Tracer>(&self, scene: &Scene, tracer: &T, ray: &Ray) -> Option<Rgb> {
        if !self.any_passable {
            let blocked = (self.floor_mode == FloorMode::Visible
                && self.floor_t(ray, false) < f32::INFINITY)
                || tracer.occluded(ray);
            return (!blocked).then_some(Rgb::WHITE);
        }
        let (keep, blocker) = self.walk(scene, tracer, ray);
        (blocker == f32::INFINITY && peak(keep) > 0.0).then_some(keep)
    }

    /// The shading frame of instance `instance` at `point` with shading normal `n`.
    fn frame(&self, instance: Option<u32>, point: Vec3, n: Vec3) -> Frame {
        let axes = instance.and_then(|i| self.tangent_axes.get(i as usize).copied().flatten());
        let Some((centre, axis, x_axis)) = axes else {
            return Frame::from_normal(n);
        };
        for t in [axis.cross(point - centre), x_axis] {
            let t = t - n * n.dot(t);
            if t.length_squared() > 1.0e-12 {
                let x = t.normalize();
                return Frame {
                    x,
                    y: n.cross(x),
                    z: n,
                };
            }
        }
        Frame::from_normal(n)
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

    /// What a camera ray that escapes sees at `screen`: the background colour or image.
    fn backdrop(&self, screen: (f32, f32)) -> Rgb {
        match &self.backplate {
            Some(b) if self.background == Background::Backplate => {
                b.lookup(screen).unwrap_or(self.background_color)
            }
            _ => self.background_color,
        }
    }
}

/// Largest channel.
#[inline]
fn peak(c: Rgb) -> f32 {
    c.r.max(c.g).max(c.b)
}

/// `exp(-σ t)` per channel.
#[inline]
fn beer_lambert(sigma: Rgb, t: f32) -> Rgb {
    sigma.map(|s| fmath::exp(-s * t))
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
    /// Where lights are sampled from and reflected rays start (for smooth-shaded meshes, the hit
    /// lifted onto the smooth surface: [`Geometry::terminator_point`]).
    point: Vec3,
    /// The hit itself, where transmitted rays leave from.
    hit_point: Vec3,
    /// Shading normal, facing the side the ray came from.
    normal: Vec3,
    /// Geometric normal, facing the side the ray came from.
    geometric: Vec3,
    /// The floor (`None`) or an instance with its material.
    instance: Option<(u32, bool)>,
    /// The ray arrived from the outside of the surface.
    outside: bool,
}

/// Radiance and coverage arriving at the camera along `camera_ray`, for one sample of one
/// pixel. `rays` counts every ray cast (camera, extension and shadow rays). A background image
/// is looked up at the centre of the frame; [`radiance_at`] gives the screen position.
pub fn radiance<T: Tracer>(
    scene: &Scene,
    prepared: &Prepared,
    tracer: &T,
    sampler: &PixelSampler,
    camera_ray: Ray,
    rays: &mut u64,
) -> (Rgb, f32) {
    radiance_at(
        scene,
        prepared,
        tracer,
        sampler,
        camera_ray,
        (0.5, 0.5),
        rays,
    )
}

/// [`radiance`] for the camera ray through the screen position `screen` (`u` left to right, `v`
/// top to bottom, in `[0, 1]`), where the background image is looked up.
pub fn radiance_at<T: Tracer>(
    scene: &Scene,
    prepared: &Prepared,
    tracer: &T,
    sampler: &PixelSampler,
    camera_ray: Ray,
    screen: (f32, f32),
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
    // Nothing but straight events since the camera.
    let mut primary = true;
    // Distance from the last scattering vertex to the origin of `ray` (straight events).
    let mut offset = 0.0f32;
    // Absorption coefficients of the solid the ray is inside.
    let mut medium: Option<Rgb> = None;
    let mut cutouts = 0u32;
    loop {
        *rays += 1;
        let hit = tracer.trace(&ray);
        let t_geometry = hit.map_or(f32::INFINITY, |h| h.t);
        let t_floor = prepared.floor_t(&ray, primary);
        let t_nearest = t_geometry.min(t_floor);

        if let Some(sigma) = medium {
            if t_nearest.is_finite() {
                throughput = throughput * beer_lambert(sigma, t_nearest);
            }
        }

        // Area lights are transparent emitters: add every one crossed on the way.
        let crossed = lights.crossed_from(&ray, t_nearest, bsdf_pdf, offset);
        prepared.add(&mut sum, throughput * crossed, bounce >= 2);

        if t_nearest == f32::INFINITY {
            match (primary, prepared.background) {
                (true, Background::Environment) => {
                    sum += throughput * lights.escaped(ray.dir, None);
                }
                (true, Background::Color | Background::Backplate) => {
                    sum += throughput * prepared.backdrop(screen);
                }
                (true, Background::Transparent) => {
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
                let (c, a) = shadow_catcher(
                    scene, prepared, tracer, sampler, &ray, t_floor, screen, rays,
                );
                return (sum + throughput * c, a);
            }
            let p = ray.at(t_floor);
            let n = Vec3::new(0.0, 0.0, if ray.dir.z < 0.0 { 1.0 } else { -1.0 });
            let point = Vec3::new(p.x, p.y, prepared.floor_z);
            Surface {
                point,
                hit_point: point,
                normal: n,
                geometric: n,
                instance: None,
                outside: true,
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
                hit_point: details.point,
                normal,
                geometric: ng,
                instance: Some((details.instance, details.front_face)),
                outside: details.outside,
            }
        };

        let material = surface
            .instance
            .map(|(instance, _)| prepared.material(scene, instance));

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
                        lights.emitter_weight(instance, pdf, offset + t_geometry, cos)
                    });
                    prepared.add(&mut sum, throughput * m.radiance() * weight, bounce >= 2);
                }
                break;
            }
            // A cut-out lets the ray through with probability 1 - opacity.
            if m.opacity < 1.0 && cutouts < MAX_CUTOUTS {
                let u = sampler.get1(cutout_dim(bounce, cutouts));
                cutouts += 1;
                if u >= m.opacity.max(0.0) {
                    let origin = offset_origin(surface.hit_point, -surface.geometric);
                    offset += (origin - ray.origin).dot(ray.dir);
                    ray = Ray::new(origin, ray.dir);
                    continue;
                }
            }
        }

        if bounce >= prepared.max_depth {
            break;
        }

        let bsdf = material.map_or(prepared.floor_bsdf, |m| Bsdf::surface(m, surface.outside));
        let frame = prepared.frame(
            surface.instance.map(|(i, _)| i),
            surface.point,
            surface.normal,
        );
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
                // Light behind a refracting surface: the shadow ray leaves from its other side.
                let from = if wi.z < 0.0 {
                    offset_origin(surface.hit_point, -ng)
                } else {
                    origin
                };
                if let Some(pass) =
                    prepared.shadow(scene, tracer, &shadow_ray(from, ls.wi, ls.distance))
                {
                    let weight = if ls.delta || !ls.glossy {
                        1.0
                    } else {
                        power_heuristic(ls.pdf, bsdf.pdf(wo, wi))
                    };
                    let mut c = throughput * f * ls.radiance * (wi.z.abs() * weight / ls.pdf);
                    if pass != Rgb::WHITE {
                        c = c * pass;
                    }
                    prepared.add(&mut sum, c, bounce >= 1);
                }
            }
        }

        // The next direction.
        let Some(bs) = bsdf.sample(wo, sampler.get2(dims + OFFSET_BSDF)) else {
            break;
        };
        let transmitted = bs.wi.z < 0.0;
        let wi = if bs.straight {
            ray.dir
        } else {
            frame.to_world(bs.wi).normalize()
        };
        if transmitted {
            if wi.dot(ng) >= 0.0 {
                break; // a refraction the shading normal sent back out
            }
        } else if wi.dot(ng) <= 0.0 {
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
        let next_origin = if transmitted {
            offset_origin(surface.hit_point, -ng)
        } else {
            origin
        };
        if bs.straight {
            offset += (next_origin - ray.origin).dot(ray.dir);
        } else {
            bsdf_pdf = Some(bs.pdf);
            primary = false;
            offset = 0.0;
            if transmitted {
                // Into the solid, or out of it.
                medium = if surface.outside {
                    material.and_then(|_| {
                        surface.instance.and_then(|(i, _)| {
                            let id = scene.geometry.instances().get(i as usize)?.material_id;
                            prepared.media.get(id as usize).copied().flatten()
                        })
                    })
                } else {
                    None
                };
            }
        }
        ray = Ray::new(next_origin, wi);
        bounce += 1;
    }
    (sum, alpha)
}

/// A camera ray that hit the shadow catcher at `t`: the background behind it times the fraction
/// of light the scene does not block, or (transparent background) black with the blocked
/// fraction as alpha.
#[allow(clippy::too_many_arguments)]
fn shadow_catcher<T: Tracer>(
    scene: &Scene,
    prepared: &Prepared,
    tracer: &T,
    sampler: &PixelSampler,
    ray: &Ray,
    t: f32,
    screen: (f32, f32),
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
            // The catcher itself is invisible: only the geometry blocks (cut-outs and thin
            // walls in part).
            let probe = shadow_ray(origin, ls.wi, ls.distance);
            if !prepared.any_passable {
                if !tracer.occluded(&probe) {
                    lit += c;
                }
            } else {
                let (keep, blocker) = prepared.walk(scene, tracer, &probe);
                if blocker == f32::INFINITY {
                    lit += c * keep.luminance();
                }
            }
        }
    }

    if let Some(bs) = lambert.sample(wo, sampler.get2(dims + OFFSET_BSDF)) {
        let wi = frame.to_world(bs.wi).normalize();
        let probe = Ray::new(origin, wi);
        *rays += 1;
        let (keep, blocker) = if prepared.any_passable {
            prepared.walk(scene, tracer, &probe)
        } else {
            (
                Rgb::WHITE,
                tracer.trace(&probe).map_or(f32::INFINITY, |h| h.t),
            )
        };
        let pdf = Some(bs.pdf);
        let all = lights.crossed(&probe, f32::INFINITY, pdf) + lights.escaped(wi, pdf);
        let mut reached = if blocker == f32::INFINITY {
            all
        } else {
            lights.crossed(&probe, blocker, pdf)
        };
        if keep != Rgb::WHITE {
            reached = reached * keep;
        }
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
        Background::Color | Background::Backplate => (prepared.backdrop(screen) * unshadowed, 1.0),
    }
}

#[cfg(test)]
mod tests;
