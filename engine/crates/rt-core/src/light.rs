//! Light sources prepared for rendering, and their sampling for next-event estimation.
//!
//! * **Rect and disk area lights** (`LGHT.kind` 0 and 1): one-sided emitters facing
//!   `direction`, sampled uniformly by area (density `d² / (A cos θl)` per steradian). Solid-angle
//!   sampling of rectangles (C. Ureña, J. Fajardo and A. King, "An Area-Preserving
//!   Parametrization for Spherical Rectangles", EGSR 2013) would lower the noise of large, close
//!   panels and can replace it later. Radiance is `color * power / (π A)` with the area in m²
//!   (the flux of a Lambertian emitter of `power` watts), times the spread falloff `cos^n θ`
//!   whose intensity halves at `spread_deg / 2`; on-axis radiance does not change with spread.
//!   Lights are transparent: they never occlude anything.
//! * **Sun** (kind 2): a disc of angular diameter `angle_deg`, sampled uniformly inside its cone;
//!   radiance `E / (π sin² θmax)` so that a surface facing it receives `E = power` W/m². An
//!   angle of zero is a delta direction.
//! * **Point and spot lights** (kinds 3 and 4, phase L4): a sphere of diameter `size_x` and
//!   uniform radiance `I / (π r²)`, with the intensity `I = power / 4π` W/sr of an isotropic
//!   source of `power` watts, so that a surface facing it at `d` receives `I / d²` whatever its
//!   size. Sampled uniformly inside the cone of directions it fills (density `1 / (2π (1 −
//!   cos θmax))`); a sphere of no size (or too small to tell from a point at that distance) is a
//!   delta position, `I / d²` with no other technique to find it. A spot is the point light it
//!   would be, masked by the direction from its centre: 1 inside its inner cone, a smoothstep to
//!   0 at the edge of its cone of `spread_deg` (the soft edge is `angle_deg` wide), as the
//!   preview's spot light draws it. Its sphere shows to the camera and in reflections like a
//!   panel does (flags `camera`, `glossy`).
//! * **Emissive meshes**: instances whose material is emissive and carries
//!   [`crate::scene::MATERIAL_FLAG_LIGHT`]; triangles are chosen in proportion to their area,
//!   points uniformly on them. Two-sided unless the instance is one-sided.
//! * **The environment** ([`EnvLight`]), importance sampled.
//!
//! Next-event estimation picks **one** of them per vertex, with probability proportional to an
//! estimate of the flux it sends into the scene's bounding sphere (flux and distance for area
//! lights and emitters, `π E` for the sun, `4π² L̄` for the environment; a point light by its
//! flux and distance, a spot as the point light it is when its cone takes in the scene's centre). A light tree (Conty and
//! Kulla 2018) replaces this in phase K4. A light flagged `LIGHT_FLAG_NO_SHADOW` (L4) lights
//! through everything: its samples say so ([`LightSample::shadow`]) and no shadow ray is traced.

use crate::color::Rgb;
use crate::environment::EnvLight;
use crate::fmath;
use crate::math::{Frame, Ray, Vec3};
use crate::scene::{
    LightKind, Scene, INSTANCE_ONE_SIDED, LIGHT_FLAG_CAMERA, LIGHT_FLAG_GLOSSY,
    LIGHT_FLAG_NO_SHADOW, MATERIAL_FLAG_LIGHT,
};
use crate::warp;

/// Square millimetres to square metres.
const MM2_TO_M2: f32 = 1.0e-6;
/// Millimetres to metres.
const MM_TO_M: f32 = 1.0e-3;

/// The power heuristic with exponent 2 (E. Veach and L. Guibas, "Optimally Combining Sampling
/// Techniques for Monte Carlo Rendering", SIGGRAPH 1995): the weight of a sample drawn with
/// density `pa` against a technique of density `pb`. Written as `1 / (1 + (pb/pa)²)` so that
/// huge densities (near-mirror lobes) cannot overflow.
#[inline]
pub fn power_heuristic(pa: f32, pb: f32) -> f32 {
    if !positive(pa) {
        return 0.0;
    }
    let r = pb / pa;
    1.0 / (1.0 + r * r)
}

/// `x > 0`, false for NaN: the guard against degenerate (zero, negative or NaN) quantities.
#[inline]
fn positive(x: f32) -> bool {
    x > 0.0
}

/// Shape of an area light in its own frame.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) enum AreaShape {
    /// Half extents along the frame's x and y axes.
    Rect { half_x: f32, half_y: f32 },
    /// Radius in the frame's xy plane.
    Disk { radius: f32 },
}

/// A rect or disk light.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct AreaLight {
    pub(crate) shape: AreaShape,
    pub(crate) centre: Vec3,
    /// `z` is the emission normal, `x` and `y` the rectangle's axes.
    pub(crate) frame: Frame,
    /// Area in scene units (mm²).
    pub(crate) area: f32,
    /// Radiance along the normal.
    pub(crate) radiance: Rgb,
    /// Spread falloff exponent (0: Lambertian).
    pub(crate) exponent: f32,
    pub(crate) glossy: bool,
    camera: bool,
    shadow: bool,
    /// Probability of being chosen for next-event estimation.
    pmf: f32,
}

/// The `cos^n` exponent whose intensity halves at `spread_deg / 2` (0 for 180 degrees or more).
pub fn spread_exponent(spread_deg: f32) -> f32 {
    if spread_deg >= 180.0 {
        return 0.0;
    }
    let half = 0.5 * spread_deg.max(1.0) * fmath::DEG_TO_RAD;
    -1.0 / fmath::log2(fmath::cos(half))
}

/// The orthonormal frame of a light: `z` along `normal`, `y` as close to `up` as possible.
fn light_frame(normal: Vec3, up: Vec3) -> Frame {
    let z = normal.normalize();
    let y = (up - z * z.dot(up)).normalize();
    if y.length_squared() < 0.5 {
        return Frame::from_normal(z);
    }
    Frame {
        x: y.cross(z),
        y,
        z,
    }
}

impl AreaLight {
    /// Radiance leaving at angle `cos` from the normal.
    #[inline]
    pub(crate) fn radiance_at(&self, cos: f32) -> Rgb {
        if self.exponent == 0.0 {
            self.radiance
        } else {
            self.radiance * fmath::powf(cos, self.exponent)
        }
    }

    pub(crate) fn sample_point(&self, u: (f32, f32)) -> Vec3 {
        let (x, y) = match self.shape {
            AreaShape::Rect { half_x, half_y } => {
                ((2.0 * u.0 - 1.0) * half_x, (2.0 * u.1 - 1.0) * half_y)
            }
            AreaShape::Disk { radius } => {
                let (x, y) = warp::concentric_disk(u);
                (x * radius, y * radius)
            }
        };
        self.centre + self.frame.x * x + self.frame.y * y
    }

    /// Where `ray` (unit direction) crosses the emitting face before `t_max`: `(t, cos θl)`.
    fn intersect(&self, ray: &Ray, t_max: f32) -> Option<(f32, f32)> {
        let n = self.frame.z;
        let denom = ray.dir.dot(n);
        if denom >= 0.0 {
            return None; // parallel or seen from the back
        }
        let t = (self.centre - ray.origin).dot(n) / denom;
        if !(t > ray.t_min && t < t_max) {
            return None;
        }
        let q = ray.at(t) - self.centre;
        let (x, y) = (q.dot(self.frame.x), q.dot(self.frame.y));
        let inside = match self.shape {
            AreaShape::Rect { half_x, half_y } => x.abs() <= half_x && y.abs() <= half_y,
            AreaShape::Disk { radius } => x * x + y * y <= radius * radius,
        };
        inside.then_some((t, -denom))
    }
}

/// A sun.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct SunLight {
    /// `z` points at the sun.
    pub(crate) frame: Frame,
    cos_max: f32,
    pub(crate) one_minus_cos_max: f32,
    pub(crate) solid_angle: f32,
    /// Radiance of the disc; for a delta sun, the irradiance.
    pub(crate) radiance: Rgb,
    pub(crate) delta: bool,
    pub(crate) glossy: bool,
    camera: bool,
    shadow: bool,
    pmf: f32,
}

impl SunLight {
    fn contains(&self, dir: Vec3) -> bool {
        !self.delta && dir.dot(self.frame.z) >= self.cos_max
    }
}

/// Below this `1 − cos θmax` a sphere light is a point: its cone of directions is too narrow to
/// sample (f32) and its radiance too large to matter apart from its intensity.
const POINT_CONE: f32 = 1.0e-7;

/// A point light or a spot (kinds 3 and 4): a sphere of uniform radiance, a spot's masked by
/// the direction from its centre.
#[derive(Clone, Debug, PartialEq)]
struct SphereLight {
    centre: Vec3,
    /// Scene units (mm); 0 is a point.
    radius: f32,
    /// W/sr: `power / 4π`.
    intensity: Rgb,
    /// Radiance of the sphere's surface: `intensity / (π r²)`, r in metres (0 for a point).
    radiance: Rgb,
    /// A spot's axis and the cosines of the edge of its cone and of its inner cone; a point
    /// light has `cos_outer` below -1 (no mask).
    axis: Vec3,
    cos_outer: f32,
    cos_inner: f32,
    glossy: bool,
    camera: bool,
    shadow: bool,
    pmf: f32,
}

impl SphereLight {
    /// How much of its light reaches `x`: 1 for a point light; for a spot a smoothstep from 0 at
    /// the edge of its cone to 1 at its inner cone, by the direction from its centre to `x`.
    fn mask(&self, x: Vec3) -> f32 {
        if self.cos_outer < -1.0 {
            return 1.0;
        }
        let d = x - self.centre;
        let len2 = d.length_squared();
        if !positive(len2) {
            return 0.0;
        }
        let c = d.dot(self.axis) / len2.sqrt();
        if c <= self.cos_outer {
            0.0
        } else if c >= self.cos_inner {
            1.0
        } else {
            let t = (c - self.cos_outer) / (self.cos_inner - self.cos_outer);
            t * t * (3.0 - 2.0 * t)
        }
    }

    /// `1 − cos θmax` of the cone of directions the sphere fills seen from `dist2` (mm²) away;
    /// None from inside it, and below [`POINT_CONE`] (a point) zero.
    fn cone(&self, dist2: f32) -> Option<f32> {
        let r2 = self.radius * self.radius;
        if !positive(dist2 - r2) {
            return None;
        }
        let sin2 = r2 / dist2;
        let omc = sin2 / (1.0 + (1.0 - sin2).max(0.0).sqrt());
        Some(if omc < POINT_CONE { 0.0 } else { omc })
    }

    /// Where `ray` (unit direction) meets the sphere from outside before `t_max`.
    fn intersect(&self, ray: &Ray, t_max: f32) -> Option<f32> {
        if !positive(self.radius) {
            return None;
        }
        let oc = ray.origin - self.centre;
        let r2 = self.radius * self.radius;
        if oc.length_squared() <= r2 {
            return None; // from inside
        }
        let b = oc.dot(ray.dir);
        // The distance from the centre to the line, without the cancellation of b² − c.
        let disc = r2 - (oc - ray.dir * b).length_squared();
        if disc < 0.0 {
            return None;
        }
        let t = -b - disc.sqrt();
        (t > ray.t_min && t < t_max).then_some(t)
    }
}

/// An emissive instance sampled as an area light.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct MeshEmitter {
    /// World-space corners of each triangle.
    pub(crate) corners: Vec<[Vec3; 3]>,
    /// Unit normal of each triangle (winding order: the front face).
    pub(crate) normals: Vec<Vec3>,
    /// Cumulative area fractions.
    pub(crate) cdf: Vec<f32>,
    /// Total area (mm²).
    pub(crate) area: f32,
    pub(crate) radiance: Rgb,
    pub(crate) two_sided: bool,
    pmf: f32,
}

/// One entry of the light selection distribution.
#[derive(Clone, Copy, Debug, PartialEq)]
enum LightRef {
    Area(u32),
    Sun(u32),
    Sphere(u32),
    Mesh(u32),
    Environment,
}

/// A light sample for next-event estimation.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct LightSample {
    /// Unit direction from the shading point towards the light.
    pub wi: Vec3,
    /// Distance to the sampled point (infinite for the sun and the environment).
    pub distance: f32,
    /// Radiance arriving along `-wi` (for a delta sun: the irradiance).
    pub radiance: Rgb,
    /// Density per steradian of this sample, light selection included (for a delta sun: the
    /// selection probability).
    pub pdf: f32,
    /// A delta direction: no other technique can find it, so no MIS.
    pub delta: bool,
    /// The light lights every lobe and BSDF sampling can find it (MIS applies); otherwise it
    /// lights the diffuse lobe only and its weight is one.
    pub glossy: bool,
    /// The light also sends caustic photons ([`crate::caustics`]): a glossy area light or sun,
    /// or an emissive mesh; not the environment, nor a point light or a spot (L4).
    pub photon: bool,
    /// The light casts shadows: a shadow ray decides whether the sample arrives. Without it
    /// (`LIGHT_FLAG_NO_SHADOW`, L4) it always does.
    pub shadow: bool,
}

/// Every light of a scene, ready for sampling.
#[derive(Clone, Debug, PartialEq)]
pub struct Lights {
    pub(crate) areas: Vec<AreaLight>,
    pub(crate) suns: Vec<SunLight>,
    spheres: Vec<SphereLight>,
    pub(crate) meshes: Vec<MeshEmitter>,
    env: EnvLight,
    env_pmf: f32,
    entries: Vec<LightRef>,
    /// Cumulative selection probabilities of `entries` (the last one is exactly 1).
    cdf: Vec<f32>,
    /// Emitter index of each instance, if it is one.
    instance_emitter: Vec<Option<u32>>,
    /// The lights a camera ray sees (O3a: the lens's filters connect to them), in the order of
    /// [`Lights::camera_lights`].
    camera: Vec<CameraLight>,
}

/// A light a camera ray can see: an area light or a sphere flagged `camera`, with the sphere
/// that bounds it (O3a, the connection of the lens's effect filters to the lights).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct CameraLight {
    /// The centre of its bounding sphere.
    pub centre: Vec3,
    /// The radius of its bounding sphere.
    pub radius: f32,
    /// A sphere light (else an area light), and its index there.
    sphere: bool,
    index: u32,
}

/// Index of the bucket of a CDF that holds `u`, and `u` rescaled to `[0, 1)` inside it.
pub(crate) fn pick(cdf: &[f32], u: f32) -> (usize, f32) {
    let i = cdf
        .partition_point(|&c| c <= u)
        .min(cdf.len().saturating_sub(1));
    let lo = if i == 0 { 0.0 } else { cdf[i - 1] };
    let width = cdf[i] - lo;
    let rest = if width > 0.0 {
        ((u - lo) / width).clamp(0.0, 0.999_999_94)
    } else {
        0.0
    };
    (i, rest)
}

/// Cumulative, normalised version of `weights` (the last entry exactly 1), or empty when they
/// sum to zero.
pub(crate) fn build_cdf(weights: &[f32]) -> Vec<f32> {
    let total: f32 = weights.iter().sum();
    if !(total > 0.0 && total.is_finite()) {
        return Vec::new();
    }
    let mut acc = 0.0;
    let mut cdf: Vec<f32> = weights
        .iter()
        .map(|&w| {
            acc += w;
            acc / total
        })
        .collect();
    if let Some(last) = cdf.last_mut() {
        *last = 1.0;
    }
    cdf
}

impl Lights {
    /// Prepares the lights of `scene`.
    pub fn new(scene: &Scene) -> Lights {
        let bounds = scene.bounds();
        let (centre, radius) = if bounds.is_empty() {
            (Vec3::ZERO, 1000.0)
        } else {
            (
                bounds.centroid(),
                (0.5 * (bounds.max - bounds.min).length()).max(1.0),
            )
        };
        let radius_m = radius * MM_TO_M;
        // Share of an emitter's flux that reaches the bounding sphere, over R².
        let reach = |p: Vec3, normal: Option<Vec3>| -> f32 {
            let to_centre = centre - p;
            let d = to_centre.length() * MM_TO_M;
            let facing =
                normal.map_or(1.0, |n| 0.05 + 0.95 * n.dot(to_centre.normalize()).max(0.0));
            let d = d.max(radius_m);
            facing / (d * d)
        };

        let mut areas = Vec::new();
        let mut suns = Vec::new();
        let mut spheres = Vec::new();
        let mut weights = Vec::new();
        let mut entries = Vec::new();
        for light in &scene.lights {
            let glossy = light.flags & LIGHT_FLAG_GLOSSY != 0;
            let camera = light.flags & LIGHT_FLAG_CAMERA != 0;
            let shadow = light.flags & LIGHT_FLAG_NO_SHADOW == 0;
            let power = light.power.max(0.0);
            match light.kind {
                LightKind::Rect | LightKind::Disk => {
                    let shape = if light.kind == LightKind::Rect {
                        AreaShape::Rect {
                            half_x: 0.5 * light.size_x.abs(),
                            half_y: 0.5 * light.size_y.abs(),
                        }
                    } else {
                        AreaShape::Disk {
                            radius: 0.5 * light.size_x.abs(),
                        }
                    };
                    let area = match shape {
                        AreaShape::Rect { half_x, half_y } => 4.0 * half_x * half_y,
                        AreaShape::Disk { radius } => fmath::PI * radius * radius,
                    };
                    let frame = light_frame(light.direction, light.up);
                    if !positive(area) || frame.z.length_squared() < 0.5 {
                        continue;
                    }
                    let color = light.color.map(|v| v.max(0.0));
                    let radiance = color * (power / (fmath::PI * area * MM2_TO_M2));
                    let exponent = spread_exponent(light.spread_deg);
                    let flux = color.luminance() * power * 2.0 / (exponent + 2.0);
                    if !positive(flux) {
                        continue;
                    }
                    weights.push(flux * reach(light.position, Some(frame.z)));
                    entries.push(LightRef::Area(areas.len() as u32));
                    areas.push(AreaLight {
                        shape,
                        centre: light.position,
                        frame,
                        area,
                        radiance,
                        exponent,
                        glossy,
                        camera,
                        shadow,
                        pmf: 0.0,
                    });
                }
                LightKind::Sun => {
                    let to_sun = -light.direction.normalize();
                    if to_sun.length_squared() < 0.5 {
                        continue;
                    }
                    let half =
                        (0.5 * light.angle_deg.max(0.0) * fmath::DEG_TO_RAD).min(fmath::FRAC_PI_2);
                    let color = light.color.map(|v| v.max(0.0));
                    let irradiance = color * power;
                    if !positive(irradiance.luminance()) {
                        continue;
                    }
                    let delta = half < 1.0e-5;
                    let s = fmath::sin(0.5 * half);
                    let one_minus_cos_max = 2.0 * s * s;
                    let sin_max = fmath::sin(half);
                    let radiance = if delta {
                        irradiance
                    } else {
                        irradiance * (1.0 / (fmath::PI * sin_max * sin_max))
                    };
                    weights.push(fmath::PI * irradiance.luminance());
                    entries.push(LightRef::Sun(suns.len() as u32));
                    suns.push(SunLight {
                        frame: Frame::from_normal(to_sun),
                        cos_max: 1.0 - one_minus_cos_max,
                        one_minus_cos_max,
                        solid_angle: fmath::TAU * one_minus_cos_max,
                        radiance,
                        delta,
                        glossy,
                        camera,
                        shadow,
                        pmf: 0.0,
                    });
                }
                LightKind::Point | LightKind::Spot => {
                    let color = light.color.map(|v| v.max(0.0));
                    let intensity = color * (power / (4.0 * fmath::PI));
                    let radius = 0.5 * light.size_x.abs();
                    let radius = if radius.is_finite() { radius } else { 0.0 };
                    let (axis, cos_outer, cos_inner) = if light.kind == LightKind::Spot {
                        let axis = light.direction.normalize();
                        if axis.length_squared() < 0.5 {
                            continue;
                        }
                        let half = 0.5 * light.spread_deg.clamp(1.0, 180.0) * fmath::DEG_TO_RAD;
                        let soft = light.angle_deg.max(0.0) * fmath::DEG_TO_RAD;
                        let inner = (half - soft).max(0.0);
                        (axis, fmath::cos(half), fmath::cos(inner))
                    } else {
                        (Vec3::new(0.0, 0.0, -1.0), -2.0, -2.0)
                    };
                    let flux = color.luminance() * power;
                    if !positive(flux) {
                        continue;
                    }
                    let r_m = radius * MM_TO_M;
                    let radiance = if radius > 0.0 {
                        intensity * (1.0 / (fmath::PI * r_m * r_m))
                    } else {
                        Rgb::BLACK
                    };
                    let sphere = SphereLight {
                        centre: light.position,
                        radius,
                        intensity,
                        radiance,
                        axis,
                        cos_outer,
                        cos_inner,
                        glossy,
                        camera,
                        shadow,
                        pmf: 0.0,
                    };
                    // What matters is how bright it is where the scene is, not the little flux of a narrow cone: a
                    // spot aimed at the scene weighs as its point light would, one aimed away a twentieth of it.
                    let toward = 0.05 + 0.95 * sphere.mask(centre);
                    weights.push(flux * toward * reach(light.position, None));
                    entries.push(LightRef::Sphere(spheres.len() as u32));
                    spheres.push(sphere);
                }
            }
        }

        let mut meshes = Vec::new();
        let mut instance_emitter = vec![None; scene.geometry.instances().len()];
        for (i, instance) in scene.geometry.instances().iter().enumerate() {
            let Some(material) = scene.materials.get(instance.material_id as usize) else {
                continue;
            };
            let radiance = material.radiance();
            if material.flags & MATERIAL_FLAG_LIGHT == 0 || !positive(radiance.luminance()) {
                continue;
            }
            let Some(mesh) = scene.geometry.meshes().get(instance.mesh as usize) else {
                continue;
            };
            if instance.transform.inverse().is_none() {
                continue; // never hit, so never lit either
            }
            let mut corners = Vec::new();
            let mut normals = Vec::new();
            let mut tri_areas = Vec::new();
            let mut centroid = Vec3::ZERO;
            for t in 0..mesh.triangle_count() {
                let Some(local) = mesh.triangle(t) else {
                    continue;
                };
                let w = local.map(|p| instance.transform.point(p));
                let cross = (w[1] - w[0]).cross(w[2] - w[0]);
                let area = 0.5 * cross.length();
                if !(area > 0.0 && area.is_finite()) {
                    continue;
                }
                centroid += (w[0] + w[1] + w[2]) * (area / 3.0);
                corners.push(w);
                normals.push(cross.normalize());
                tri_areas.push(area);
            }
            let area: f32 = tri_areas.iter().sum();
            let cdf = build_cdf(&tri_areas);
            if cdf.is_empty() {
                continue;
            }
            let two_sided = instance.flags & INSTANCE_ONE_SIDED == 0;
            let sides = if two_sided { 2.0 } else { 1.0 };
            let flux = radiance.luminance() * fmath::PI * area * MM2_TO_M2 * sides;
            weights.push(flux * reach(centroid / area, None));
            entries.push(LightRef::Mesh(meshes.len() as u32));
            instance_emitter[i] = Some(meshes.len() as u32);
            meshes.push(MeshEmitter {
                corners,
                normals,
                cdf,
                area,
                radiance,
                two_sided,
                pmf: 0.0,
            });
        }

        let env = EnvLight::new(&scene.environment, &scene.bitmaps);
        if !env.is_black() {
            weights.push(4.0 * fmath::PI * fmath::PI * env.mean_radiance());
            entries.push(LightRef::Environment);
        }

        let cdf = build_cdf(&weights);
        let mut lights = Lights {
            areas,
            suns,
            spheres,
            meshes,
            env,
            env_pmf: 0.0,
            entries: if cdf.is_empty() { Vec::new() } else { entries },
            cdf,
            instance_emitter,
            camera: Vec::new(),
        };
        let mut camera = Vec::new();
        for (i, a) in lights.areas.iter().enumerate() {
            if a.camera {
                let radius = match a.shape {
                    AreaShape::Rect { half_x, half_y } => {
                        (half_x * half_x + half_y * half_y).sqrt()
                    }
                    AreaShape::Disk { radius } => radius,
                };
                camera.push(CameraLight {
                    centre: a.centre,
                    radius,
                    sphere: false,
                    index: i as u32,
                });
            }
        }
        for (i, l) in lights.spheres.iter().enumerate() {
            if l.camera && positive(l.radius) {
                camera.push(CameraLight {
                    centre: l.centre,
                    radius: l.radius,
                    sphere: true,
                    index: i as u32,
                });
            }
        }
        lights.camera = camera;
        for i in 0..lights.entries.len() {
            let pmf = lights.cdf[i] - if i == 0 { 0.0 } else { lights.cdf[i - 1] };
            match lights.entries[i] {
                LightRef::Area(a) => lights.areas[a as usize].pmf = pmf,
                LightRef::Sun(s) => lights.suns[s as usize].pmf = pmf,
                LightRef::Sphere(s) => lights.spheres[s as usize].pmf = pmf,
                LightRef::Mesh(m) => lights.meshes[m as usize].pmf = pmf,
                LightRef::Environment => lights.env_pmf = pmf,
            }
        }
        lights
    }

    /// The environment.
    pub fn environment(&self) -> &EnvLight {
        &self.env
    }

    /// Number of lights next-event estimation chooses from.
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    /// True when there is nothing to sample.
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    /// Picks a light with `u_select` and a point on it with `u`, as seen from `x`.
    pub fn sample(&self, x: Vec3, u_select: f32, u: (f32, f32)) -> Option<LightSample> {
        if self.cdf.is_empty() {
            return None;
        }
        let (index, rest) = pick(&self.cdf, u_select);
        let sample = match self.entries[index] {
            LightRef::Area(a) => {
                let light = &self.areas[a as usize];
                let p = light.sample_point(u);
                let d = p - x;
                let dist2 = d.length_squared();
                let distance = dist2.sqrt();
                let wi = d / distance;
                let cos = -wi.dot(light.frame.z);
                if !(cos > 0.0 && distance > 0.0) {
                    return None;
                }
                LightSample {
                    wi,
                    distance,
                    radiance: light.radiance_at(cos),
                    pdf: light.pmf * dist2 / (light.area * cos),
                    delta: false,
                    glossy: light.glossy,
                    photon: light.glossy,
                    shadow: light.shadow,
                }
            }
            LightRef::Sun(s) => {
                let sun = &self.suns[s as usize];
                if sun.delta {
                    LightSample {
                        wi: sun.frame.z,
                        distance: f32::INFINITY,
                        radiance: sun.radiance,
                        pdf: sun.pmf,
                        delta: true,
                        glossy: sun.glossy,
                        photon: sun.glossy,
                        shadow: sun.shadow,
                    }
                } else {
                    let local = warp::uniform_cone(u, sun.one_minus_cos_max);
                    LightSample {
                        wi: sun.frame.to_world(local).normalize(),
                        distance: f32::INFINITY,
                        radiance: sun.radiance,
                        pdf: sun.pmf / sun.solid_angle,
                        delta: false,
                        glossy: sun.glossy,
                        photon: sun.glossy,
                        shadow: sun.shadow,
                    }
                }
            }
            LightRef::Sphere(s) => {
                let light = &self.spheres[s as usize];
                let mask = light.mask(x);
                let d = light.centre - x;
                let dist2 = d.length_squared();
                if !(mask > 0.0 && dist2 > 0.0) {
                    return None;
                }
                let dist = dist2.sqrt();
                let towards = d / dist;
                let omc = if light.radius > 0.0 {
                    light.cone(dist2)?
                } else {
                    0.0
                };
                if omc == 0.0 {
                    // A point (or a sphere too small to tell from one): its intensity over d².
                    LightSample {
                        wi: towards,
                        distance: dist,
                        radiance: light.intensity * (mask / (dist2 * MM2_TO_M2)),
                        pdf: light.pmf,
                        delta: true,
                        glossy: light.glossy,
                        photon: false,
                        shadow: light.shadow,
                    }
                } else {
                    let local = warp::uniform_cone(u, omc);
                    let wi = Frame::from_normal(towards).to_world(local).normalize();
                    // The near side of the sphere along wi.
                    let b = wi.dot(d);
                    let r2 = light.radius * light.radius;
                    let near = b - (r2 - (d - wi * b).length_squared()).max(0.0).sqrt();
                    LightSample {
                        wi,
                        distance: near.max(0.0),
                        radiance: light.radiance * mask,
                        pdf: light.pmf / (fmath::TAU * omc),
                        delta: false,
                        glossy: light.glossy,
                        photon: false,
                        shadow: light.shadow,
                    }
                }
            }
            LightRef::Mesh(m) => {
                let emitter = &self.meshes[m as usize];
                let (t, _) = pick(&emitter.cdf, rest);
                let [a, b, c] = emitter.corners[t];
                let w = warp::uniform_triangle(u);
                let p = a * w[0] + b * w[1] + c * w[2];
                let d = p - x;
                let dist2 = d.length_squared();
                let distance = dist2.sqrt();
                let wi = d / distance;
                let facing = -wi.dot(emitter.normals[t]);
                if !positive(distance) || (!emitter.two_sided && facing <= 0.0) {
                    return None;
                }
                let cos = facing.abs();
                if !positive(cos) {
                    return None;
                }
                LightSample {
                    wi,
                    distance,
                    radiance: emitter.radiance,
                    pdf: emitter.pmf * dist2 / (emitter.area * cos),
                    delta: false,
                    glossy: true,
                    photon: true,
                    shadow: true,
                }
            }
            LightRef::Environment => {
                let (wi, pdf) = self.env.sample(u)?;
                LightSample {
                    wi,
                    distance: f32::INFINITY,
                    radiance: self.env.radiance(wi),
                    pdf: self.env_pmf * pdf,
                    delta: false,
                    glossy: true,
                    photon: false,
                    shadow: true,
                }
            }
        };
        (sample.pdf > 0.0 && sample.pdf.is_finite() && sample.radiance.luminance() > 0.0)
            .then_some(sample)
    }

    /// Radiance of the area lights that `ray` (unit direction) crosses from the front before
    /// `t_max`. A camera ray (`bsdf_pdf` `None`) sees the lights flagged `camera`, at full
    /// weight; a BSDF-sampled ray sees the lights flagged `glossy`, weighted against
    /// next-event estimation with the power heuristic.
    pub fn crossed(&self, ray: &Ray, t_max: f32, bsdf_pdf: Option<f32>) -> Rgb {
        self.crossed_from(ray, t_max, bsdf_pdf, 0.0)
    }

    /// [`Lights::crossed`] for a ray that continues, straight, one that left the last scattering
    /// vertex `offset` earlier (it went through thin walls or cut-outs): the MIS weights use the
    /// distance from that vertex, as next-event estimation there did.
    pub fn crossed_from(&self, ray: &Ray, t_max: f32, bsdf_pdf: Option<f32>, offset: f32) -> Rgb {
        // The spheres add to the areas' sum in the same order as ever (the same bits).
        let areas = self.crossed_areas(ray, t_max, bsdf_pdf, offset);
        self.crossed_spheres(areas, ray, t_max, bsdf_pdf, offset)
    }

    /// [`Lights::crossed_from`] of the lights that send no caustic photons only (the spheres of
    /// point lights and spots): what a path adds where the photon map brings the rest
    /// ([`crate::caustics`]). Every area light a BSDF-sampled ray can see sends photons.
    pub(crate) fn crossed_without_photons(
        &self,
        ray: &Ray,
        t_max: f32,
        bsdf_pdf: Option<f32>,
        offset: f32,
    ) -> Rgb {
        self.crossed_spheres(Rgb::BLACK, ray, t_max, bsdf_pdf, offset)
    }

    fn crossed_areas(&self, ray: &Ray, t_max: f32, bsdf_pdf: Option<f32>, offset: f32) -> Rgb {
        let mut sum = Rgb::BLACK;
        for light in &self.areas {
            let visible = match bsdf_pdf {
                None => light.camera,
                Some(_) => light.glossy,
            };
            if !visible {
                continue;
            }
            let Some((t, cos)) = light.intersect(ray, t_max) else {
                continue;
            };
            let weight = match bsdf_pdf {
                None => 1.0,
                Some(pdf) => {
                    let d = offset + t;
                    let light_pdf = light.pmf * d * d / (light.area * cos);
                    power_heuristic(pdf, light_pdf)
                }
            };
            sum += light.radiance_at(cos) * weight;
        }
        sum
    }

    /// `sum` plus the light of the spheres `ray` crosses.
    fn crossed_spheres(
        &self,
        mut sum: Rgb,
        ray: &Ray,
        t_max: f32,
        bsdf_pdf: Option<f32>,
        offset: f32,
    ) -> Rgb {
        for light in &self.spheres {
            let visible = match bsdf_pdf {
                None => light.camera,
                Some(_) => light.glossy,
            };
            if !visible {
                continue;
            }
            let Some(_) = light.intersect(ray, t_max) else {
                continue;
            };
            // Seen from the vertex the ray left (offset back along it), as next-event estimation saw it.
            let vertex = ray.origin - ray.dir * offset;
            let mask = light.mask(vertex);
            if !positive(mask) {
                continue;
            }
            let weight = match bsdf_pdf {
                None => 1.0,
                Some(pdf) => match light.cone((light.centre - vertex).length_squared()) {
                    // Next-event estimation takes it for a point there: only it counts it.
                    Some(omc) if omc > 0.0 => power_heuristic(pdf, light.pmf / (fmath::TAU * omc)),
                    _ => 0.0,
                },
            };
            sum += light.radiance * (mask * weight);
        }
        sum
    }

    /// The lights a camera ray sees, with their bounding spheres (O3a).
    pub fn camera_lights(&self) -> &[CameraLight] {
        &self.camera
    }

    /// The radiance of camera light `i` ([`Lights::camera_lights`]) that a camera ray crosses
    /// before `t_max`, as [`Lights::crossed`] counts it (black when it misses).
    pub fn camera_light_radiance(&self, i: usize, ray: &Ray, t_max: f32) -> Rgb {
        let Some(c) = self.camera.get(i) else {
            return Rgb::BLACK;
        };
        if c.sphere {
            let light = &self.spheres[c.index as usize];
            if light.intersect(ray, t_max).is_none() {
                return Rgb::BLACK;
            }
            let mask = light.mask(ray.origin);
            if positive(mask) {
                light.radiance * mask
            } else {
                Rgb::BLACK
            }
        } else {
            let light = &self.areas[c.index as usize];
            light
                .intersect(ray, t_max)
                .map_or(Rgb::BLACK, |(_, cos)| light.radiance_at(cos))
        }
    }

    /// The light a camera ray crosses before `t_max`, each camera light `i` weighted by
    /// `weight(i)` (O3a: against the filters' connections to the lights); the lights a camera ray
    /// does not see add nothing, as in [`Lights::crossed`].
    pub fn crossed_camera_weighted(
        &self,
        ray: &Ray,
        t_max: f32,
        weight: &dyn Fn(usize) -> f32,
    ) -> Rgb {
        let mut sum = Rgb::BLACK;
        for i in 0..self.camera.len() {
            let le = self.camera_light_radiance(i, ray, t_max);
            if positive(le.r + le.g + le.b) {
                sum += le * weight(i);
            }
        }
        sum
    }

    /// True when `ray` (unit direction) crosses the emitting face of an area light flagged
    /// `camera` before `t_max`: a light panel the camera sees (the passes count it as background,
    /// AI-POST.md §7.4).
    pub fn camera_sees_panel(&self, ray: &Ray, t_max: f32) -> bool {
        self.areas
            .iter()
            .any(|light| light.camera && light.intersect(ray, t_max).is_some())
            || self.spheres.iter().any(|light| {
                light.camera
                    && light.intersect(ray, t_max).is_some()
                    && light.mask(ray.origin) > 0.0
            })
    }

    /// True when a camera ray could see any light directly (the alpha of a transparent
    /// background then needs [`Lights::crossed`]).
    pub fn any_camera_visible(&self) -> bool {
        self.areas.iter().any(|l| l.camera)
            || self.suns.iter().any(|s| s.camera && !s.delta)
            || self.spheres.iter().any(|l| l.camera && l.radius > 0.0)
    }

    /// Radiance from the sky along the unit direction `dir` of a ray that left the scene: the
    /// environment and the sun discs. A camera ray (`bsdf_pdf` `None`) sees the environment and
    /// the suns flagged `camera`; a BSDF-sampled ray sees the environment and the suns flagged
    /// `glossy`, weighted against next-event estimation.
    pub fn escaped(&self, dir: Vec3, bsdf_pdf: Option<f32>) -> Rgb {
        let env = self.env.radiance(dir);
        let mut sum = match bsdf_pdf {
            Some(pdf) if self.env_pmf > 0.0 => {
                env * power_heuristic(pdf, self.env_pmf * self.env.pdf(dir))
            }
            _ => env,
        };
        for sun in &self.suns {
            let visible = match bsdf_pdf {
                None => sun.camera,
                Some(_) => sun.glossy,
            };
            if visible && sun.contains(dir) {
                let weight =
                    bsdf_pdf.map_or(1.0, |pdf| power_heuristic(pdf, sun.pmf / sun.solid_angle));
                sum += sun.radiance * weight;
            }
        }
        sum
    }

    /// [`Lights::escaped`] without the suns (they send caustic photons): what a BSDF-sampled ray
    /// whose light the photon map brings instead sees of the sky ([`crate::caustics`]).
    pub fn escaped_environment(&self, dir: Vec3, bsdf_pdf: f32) -> Rgb {
        let env = self.env.radiance(dir);
        if self.env_pmf > 0.0 {
            env * power_heuristic(bsdf_pdf, self.env_pmf * self.env.pdf(dir))
        } else {
            env
        }
    }

    /// True when instance `instance` is an emissive mesh sampled as a light (it sends caustic
    /// photons).
    pub fn is_mesh_light(&self, instance: u32) -> bool {
        matches!(self.instance_emitter.get(instance as usize), Some(Some(_)))
    }

    /// For a BSDF-sampled ray that hit instance `instance` at distance `t` (unit direction) with
    /// `cos` between the ray and the surface normal: the MIS weight of the emission found, or 1
    /// when the instance is not sampled by next-event estimation.
    pub fn emitter_weight(&self, instance: u32, bsdf_pdf: f32, t: f32, cos: f32) -> f32 {
        let Some(Some(m)) = self.instance_emitter.get(instance as usize) else {
            return 1.0;
        };
        let emitter = &self.meshes[*m as usize];
        let light_pdf = emitter.pmf * t * t / (emitter.area * cos.abs().max(1.0e-7));
        power_heuristic(bsdf_pdf, light_pdf)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::scene::{Environment, Light, Material, Mesh, MATERIAL_EMISSIVE};

    #[test]
    fn sphere_lights_too_small_to_tell_from_a_point_are_points() {
        // 0.01 mm across at 10 m: its cone underflows, so it is sampled as the point it looks like.
        let lights = Lights::new(&Scene {
            lights: vec![Light {
                kind: LightKind::Point,
                position: Vec3::new(0.0, 0.0, 10_000.0),
                size_x: 0.000_01,
                power: 5.0,
                ..Light::default()
            }],
            environment: Environment {
                strength: 0.0,
                ..Environment::default()
            },
            ..Scene::default()
        });
        let s = lights
            .sample(Vec3::ZERO, 0.5, (0.5, 0.5))
            .expect("tiny sphere");
        assert!(s.delta);
        assert!((s.radiance.g - 5.0 / (4.0 * fmath::PI * 100.0)).abs() < 1.0e-6);
    }

    fn rect(position: Vec3, direction: Vec3, size: f32, power: f32) -> Light {
        Light {
            kind: LightKind::Rect,
            position,
            direction,
            up: Vec3::new(0.0, 1.0, 0.0),
            size_x: size,
            size_y: size,
            power,
            ..Light::default()
        }
    }

    fn black_env() -> Environment {
        Environment {
            strength: 0.0,
            ..Environment::default()
        }
    }

    #[test]
    fn a_rect_light_has_the_radiance_of_its_flux() {
        let scene = Scene {
            lights: vec![rect(
                Vec3::new(0.0, 0.0, 1000.0),
                Vec3::new(0.0, 0.0, -1.0),
                500.0,
                10.0,
            )],
            environment: black_env(),
            ..Scene::default()
        };
        let lights = Lights::new(&scene);
        assert_eq!(lights.len(), 1);
        // 10 W over 0.25 m² of Lambertian emitter: L = 10 / (π 0.25).
        let s = lights
            .sample(Vec3::ZERO, 0.5, (0.5, 0.5))
            .expect("light above");
        assert!((s.radiance.g - 10.0 / (fmath::PI * 0.25)).abs() < 1.0e-4);
        assert!((s.wi - Vec3::new(0.0, 0.0, 1.0)).length() < 1.0e-6);
        assert!((s.distance - 1000.0).abs() < 1.0e-3);
        // pdf = d² / (A cos) with A in mm².
        assert!((s.pdf - 1.0e6 / 250_000.0).abs() < 1.0e-4);
        assert!(s.glossy && !s.delta);
        // From behind the light nothing is lit.
        assert_eq!(
            lights.sample(Vec3::new(0.0, 0.0, 2000.0), 0.5, (0.5, 0.5)),
            None
        );
        // A ray crossing it from below sees it; from above it does not.
        let up = Ray::new(Vec3::ZERO, Vec3::new(0.0, 0.0, 1.0));
        assert!(lights.crossed(&up, f32::INFINITY, None).g > 0.0);
        assert_eq!(lights.crossed(&up, 999.0, None), Rgb::BLACK);
        let down = Ray::new(Vec3::new(0.0, 0.0, 2000.0), Vec3::new(0.0, 0.0, -1.0));
        assert_eq!(lights.crossed(&down, f32::INFINITY, None), Rgb::BLACK);
        // The integral of radiance * cos over the hemisphere of emission is the flux.
        let mut flux = 0.0f64;
        let n = 400;
        for i in 0..n {
            let cos = (i as f32 + 0.5) / n as f32;
            flux += (s.radiance.g * cos) as f64 * std::f64::consts::TAU / n as f64;
        }
        assert!((flux * 0.25 - 10.0).abs() < 1.0e-3, "{flux}");
    }

    #[test]
    fn spread_halves_the_intensity_at_half_the_angle() {
        assert_eq!(spread_exponent(180.0), 0.0);
        for spread in [10.0f32, 60.0, 120.0, 179.0] {
            let n = spread_exponent(spread);
            let half = fmath::cos(0.5 * spread * fmath::DEG_TO_RAD);
            assert!(
                (fmath::powf(half, n) - 0.5).abs() < 1.0e-4,
                "{spread}: n = {n}"
            );
        }
        assert!((spread_exponent(90.0) - 2.0).abs() < 1.0e-4);
        assert!((spread_exponent(120.0) - 1.0).abs() < 1.0e-4);
    }

    #[test]
    fn suns_give_their_irradiance_and_cover_their_disc() {
        let mut sun = Light {
            kind: LightKind::Sun,
            direction: Vec3::new(0.0, 0.0, -1.0),
            power: 3.0,
            angle_deg: 0.53,
            ..Light::default()
        };
        let scene = Scene {
            lights: vec![sun.clone()],
            environment: black_env(),
            ..Scene::default()
        };
        let lights = Lights::new(&scene);
        // Irradiance on a horizontal surface: E[L cos / pdf] over cone samples equals 3.
        let mut e = 0.0f64;
        for i in 0..64 {
            for j in 0..64 {
                let u = ((i as f32 + 0.5) / 64.0, (j as f32 + 0.5) / 64.0);
                let s = lights.sample(Vec3::ZERO, 0.3, u).expect("sun");
                assert!(lights.suns[0].contains(s.wi));
                e += (s.radiance.g * s.wi.z / s.pdf) as f64;
            }
        }
        assert!((e / 4096.0 - 3.0).abs() < 1.0e-3, "{}", e / 4096.0);
        assert!(lights.escaped(Vec3::new(0.0, 0.0, 1.0), None).g > 1.0e3);
        assert_eq!(
            lights.escaped(Vec3::new(0.0, 0.1, 1.0).normalize(), None),
            Rgb::BLACK
        );
        // A delta sun: the irradiance itself, selection probability as density.
        sun.angle_deg = 0.0;
        let scene = Scene {
            lights: vec![sun],
            environment: black_env(),
            ..Scene::default()
        };
        let lights = Lights::new(&scene);
        let s = lights.sample(Vec3::ZERO, 0.9, (0.1, 0.2)).expect("sun");
        assert!(s.delta && s.pdf == 1.0 && s.radiance.g == 3.0);
        assert_eq!(lights.escaped(Vec3::new(0.0, 0.0, 1.0), None), Rgb::BLACK);
    }

    #[test]
    fn selection_follows_power() {
        let scene = Scene {
            lights: vec![
                rect(
                    Vec3::new(0.0, 0.0, 1000.0),
                    Vec3::new(0.0, 0.0, -1.0),
                    100.0,
                    30.0,
                ),
                rect(
                    Vec3::new(0.0, 0.0, 1000.0),
                    Vec3::new(0.0, 0.0, -1.0),
                    100.0,
                    10.0,
                ),
                rect(Vec3::ZERO, Vec3::new(0.0, 0.0, -1.0), 100.0, 0.0),
            ],
            environment: black_env(),
            ..Scene::default()
        };
        let lights = Lights::new(&scene);
        assert_eq!(lights.len(), 2);
        assert!((lights.areas[0].pmf - 0.75).abs() < 1.0e-6);
        assert!((lights.areas[1].pmf - 0.25).abs() < 1.0e-6);
        assert_eq!(pick(&lights.cdf, 0.0).0, 0);
        assert_eq!(pick(&lights.cdf, 0.74).0, 0);
        assert_eq!(pick(&lights.cdf, 0.76).0, 1);
        assert_eq!(pick(&lights.cdf, 0.999_999_9).0, 1);
        let (_, rest) = pick(&lights.cdf, 0.375);
        assert!((rest - 0.5).abs() < 1.0e-6);
        // No lights at all, and a black environment: nothing to sample.
        let empty = Lights::new(&Scene {
            environment: black_env(),
            ..Scene::default()
        });
        assert!(empty.is_empty());
        assert_eq!(empty.sample(Vec3::ZERO, 0.5, (0.5, 0.5)), None);
    }

    fn point(position: Vec3, diameter: f32, power: f32) -> Light {
        Light {
            kind: LightKind::Point,
            position,
            direction: Vec3::new(0.0, 0.0, -1.0),
            size_x: diameter,
            size_y: diameter,
            power,
            flags: LIGHT_FLAG_GLOSSY,
            ..Light::default()
        }
    }

    /// Irradiance at `x` on a surface facing +Z, by stratified samples of the only light.
    fn irradiance_up(lights: &Lights, x: Vec3) -> f64 {
        let mut e = 0.0f64;
        let n = 64;
        for i in 0..n {
            for j in 0..n {
                let u = ((i as f32 + 0.5) / n as f32, (j as f32 + 0.5) / n as f32);
                if let Some(s) = lights.sample(x, 0.5, u) {
                    e += (s.radiance.g * s.wi.z.max(0.0) / s.pdf) as f64;
                }
            }
        }
        e / (n * n) as f64
    }

    #[test]
    fn a_point_light_gives_its_intensity_over_the_distance_squared() {
        // 12 W sent the same in every direction, 400 mm above: E = 12 / (4π · 0.4²) W/m², a
        // delta position (no other technique finds it); off the axis, cos θ / d².
        let scene = Scene {
            lights: vec![point(Vec3::new(0.0, 0.0, 400.0), 0.0, 12.0)],
            environment: black_env(),
            ..Scene::default()
        };
        let lights = Lights::new(&scene);
        assert_eq!(lights.len(), 1);
        let s = lights
            .sample(Vec3::ZERO, 0.5, (0.3, 0.7))
            .expect("point above");
        let want = 12.0 / (4.0 * fmath::PI * 0.16);
        assert!(s.delta && s.pdf == 1.0 && s.shadow);
        assert!(
            (s.radiance.g - want).abs() < want * 1.0e-5,
            "{}",
            s.radiance.g
        );
        assert!((s.distance - 400.0).abs() < 1.0e-3);
        let side = Vec3::new(300.0, 0.0, 0.0);
        let e = irradiance_up(&lights, side);
        let (d2, cos) = (0.25f64, 0.8f64);
        let want = 12.0 / (4.0 * std::f64::consts::PI * d2) * cos;
        assert!((e / want - 1.0).abs() < 1.0e-4, "{e} vs {want}");
        // A point is never seen: no camera or reflection rays find it.
        let up = Ray::new(Vec3::ZERO, Vec3::new(0.0, 0.0, 1.0));
        assert_eq!(lights.crossed(&up, f32::INFINITY, None), Rgb::BLACK);
        assert!(!lights.any_camera_visible());
    }

    #[test]
    fn a_sphere_light_lights_like_its_point_and_shows_its_radiance() {
        // A sphere of 100 mm diameter and 12 W, 400 mm above: on its axis a facing surface
        // receives exactly I / d², the point light's irradiance, whatever its size.
        let scene = Scene {
            lights: vec![Light {
                flags: LIGHT_FLAG_GLOSSY | LIGHT_FLAG_CAMERA,
                ..point(Vec3::new(0.0, 0.0, 400.0), 100.0, 12.0)
            }],
            environment: black_env(),
            ..Scene::default()
        };
        let lights = Lights::new(&scene);
        let e = irradiance_up(&lights, Vec3::ZERO);
        let want = 12.0 / (4.0 * std::f64::consts::PI * 0.16);
        assert!((e / want - 1.0).abs() < 2.0e-3, "{e} vs {want}");
        let s = lights.sample(Vec3::ZERO, 0.5, (0.5, 0.5)).expect("sphere");
        assert!(!s.delta && s.distance > 340.0 && s.distance < 400.0);
        // Its surface has the radiance I / (π r²); the camera and reflections see it.
        let radiance = 12.0 / (4.0 * fmath::PI) / (fmath::PI * 0.05 * 0.05);
        let up = Ray::new(Vec3::ZERO, Vec3::new(0.0, 0.0, 1.0));
        assert!((lights.crossed(&up, f32::INFINITY, None).g - radiance).abs() < radiance * 1.0e-4);
        assert!(lights.crossed(&up, 300.0, None) == Rgb::BLACK);
        let w = lights.crossed(&up, f32::INFINITY, Some(1.0)).g;
        assert!(w > 0.0 && w < radiance, "MIS weight of a BSDF ray: {w}");
        assert!(lights.camera_sees_panel(&up, f32::INFINITY));
        assert!(lights.any_camera_visible());
        // From inside the sphere nothing is sampled.
        assert_eq!(
            lights.sample(Vec3::new(0.0, 0.0, 390.0), 0.5, (0.5, 0.5)),
            None
        );
    }

    #[test]
    fn a_spot_lights_its_cone_and_fades_at_its_edge() {
        // A 60 degree cone pointing down with a 10 degree soft edge: inside the inner cone it is
        // its point light; past the edge nothing; in between the smoothstep.
        let spot = Light {
            kind: LightKind::Spot,
            spread_deg: 60.0,
            angle_deg: 10.0,
            ..point(Vec3::new(0.0, 0.0, 1000.0), 0.0, 20.0)
        };
        let lights = Lights::new(&Scene {
            lights: vec![spot],
            environment: black_env(),
            ..Scene::default()
        });
        let on_axis = lights.sample(Vec3::ZERO, 0.5, (0.5, 0.5)).expect("axis");
        let want = 20.0 / (4.0 * fmath::PI * 1.0);
        assert!((on_axis.radiance.g - want).abs() < want * 1.0e-5);
        let at = |deg: f32| {
            let a = deg * fmath::DEG_TO_RAD;
            Vec3::new(1000.0 * fmath::sin(a) / fmath::cos(a), 0.0, 0.0)
        };
        // 15 degrees: inside the inner cone (20 degrees); 31: outside the cone (30).
        let inner = lights
            .sample(at(15.0), 0.5, (0.5, 0.5))
            .expect("inner cone");
        let d2 = at(15.0).length_squared() + 1.0e6;
        assert!((inner.radiance.g - 20.0 / (4.0 * fmath::PI * d2 * 1.0e-6)).abs() < 1.0e-4);
        assert_eq!(lights.sample(at(31.0), 0.5, (0.5, 0.5)), None);
        // 25 degrees: half way through the soft edge, the smoothstep of one half.
        let edge = lights.sample(at(25.0), 0.5, (0.5, 0.5)).expect("soft edge");
        let d2 = at(25.0).length_squared() + 1.0e6;
        let full = 20.0 / (4.0 * fmath::PI * d2 * 1.0e-6);
        let t = (fmath::cos(25.0 * fmath::DEG_TO_RAD) - fmath::cos(30.0 * fmath::DEG_TO_RAD))
            / (fmath::cos(20.0 * fmath::DEG_TO_RAD) - fmath::cos(30.0 * fmath::DEG_TO_RAD));
        let smooth = t * t * (3.0 - 2.0 * t);
        assert!((edge.radiance.g - full * smooth).abs() < full * 1.0e-4);
        // A hard edge (no soft edge): all or nothing.
        let hard = Lights::new(&Scene {
            lights: vec![Light {
                angle_deg: 0.0,
                ..lights_spot(60.0)
            }],
            environment: black_env(),
            ..Scene::default()
        });
        assert!(hard.sample(at(29.0), 0.5, (0.5, 0.5)).is_some());
        assert_eq!(hard.sample(at(31.0), 0.5, (0.5, 0.5)), None);
    }

    fn lights_spot(spread: f32) -> Light {
        Light {
            kind: LightKind::Spot,
            spread_deg: spread,
            ..point(Vec3::new(0.0, 0.0, 1000.0), 0.0, 20.0)
        }
    }

    #[test]
    fn a_spot_sends_the_flux_of_its_cone() {
        // The flux through a sphere around a spot of 80 degrees with a soft edge of 15: its
        // point's intensity times the solid angle of its mask, which the interface's lumens use
        // (`spotFraction` of core/photometry.ts): integrated here by sampling the mask.
        let spot = Light {
            angle_deg: 15.0,
            ..lights_spot(80.0)
        };
        let lights = Lights::new(&Scene {
            lights: vec![spot],
            environment: black_env(),
            ..Scene::default()
        });
        let light = &lights.spheres[0];
        let n = 4096;
        let mut sum = 0.0f64;
        for i in 0..n {
            // Uniform in cos over the lower hemisphere (the cone points down): mask times dω.
            let c = (i as f64 + 0.5) / n as f64;
            let s = (1.0 - c * c).sqrt();
            let x = light.centre + Vec3::new(s as f32, 0.0, -c as f32) * 100.0;
            sum += light.mask(x) as f64 * std::f64::consts::TAU / n as f64;
        }
        let half = 40.0f64.to_radians();
        let inner = 25.0f64.to_radians();
        // Bounds: between the solid angles of the inner cone and of the whole cone.
        let solid = |a: f64| std::f64::consts::TAU * (1.0 - a.cos());
        assert!(sum > solid(inner) && sum < solid(half), "{sum}");
        // The same as the interface's 256-step midpoint integral of the smoothstep, to 0.1 %.
        let mut ui = 0.0f64;
        for i in 0..256 {
            let a = (i as f64 + 0.5) / 256.0 * half;
            let (co, ci) = (half.cos(), inner.cos());
            let t = ((a.cos() - co) / (ci - co)).clamp(0.0, 1.0);
            let mask = if a <= inner {
                1.0
            } else {
                t * t * (3.0 - 2.0 * t)
            };
            ui += mask * a.sin() * half / 256.0;
        }
        let ui = ui * std::f64::consts::TAU;
        assert!((sum / ui - 1.0).abs() < 1.0e-3, "{sum} vs {ui}");
    }

    #[test]
    fn a_narrow_spot_aimed_at_the_scene_is_chosen_like_its_point_light() {
        // With a bright environment, a 9 degree spot aimed at the scene is picked as often as the
        // point light it masks would be (its little flux would leave its pool noisy); aimed away,
        // a twentieth of that.
        let env = Environment {
            strength: 1.0,
            ..Environment::default()
        };
        let quad = Mesh::new(
            &[
                Vec3::new(-100.0, -100.0, 0.0),
                Vec3::new(100.0, -100.0, 0.0),
                Vec3::new(100.0, 100.0, 0.0),
            ],
            &[],
            &[0, 1, 2],
            0,
        )
        .expect("triangle");
        let pmf = |light: Light| {
            let lights = Lights::new(&Scene {
                lights: vec![light],
                geometry: crate::scene::Geometry::from_meshes(vec![quad.clone()]),
                environment: env.clone(),
                ..Scene::default()
            });
            lights.spheres[0].pmf
        };
        let at = Vec3::new(0.0, 0.0, 600.0);
        let bare = pmf(point(at, 0.0, 5.0));
        let spot = |direction: Vec3| Light {
            kind: LightKind::Spot,
            spread_deg: 9.0,
            angle_deg: 2.0,
            direction,
            ..point(at, 0.0, 5.0)
        };
        let aimed = pmf(spot(Vec3::new(0.0, 0.0, -1.0)));
        let away = pmf(spot(Vec3::new(0.0, 0.0, 1.0)));
        assert!(bare > 0.01 && bare < 0.99, "{bare}");
        assert!((aimed - bare).abs() < 1.0e-6, "{aimed} vs {bare}");
        assert!(away < aimed * 0.1, "{away} vs {aimed}");
    }

    #[test]
    fn a_light_without_shadow_says_so() {
        let lights = Lights::new(&Scene {
            lights: vec![
                Light {
                    flags: LIGHT_FLAG_GLOSSY | LIGHT_FLAG_NO_SHADOW,
                    ..point(Vec3::new(0.0, 0.0, 400.0), 0.0, 12.0)
                },
                Light {
                    flags: LIGHT_FLAG_NO_SHADOW,
                    ..rect(
                        Vec3::new(0.0, 0.0, 1000.0),
                        Vec3::new(0.0, 0.0, -1.0),
                        100.0,
                        1.0e-6,
                    )
                },
            ],
            environment: black_env(),
            ..Scene::default()
        });
        assert!(!lights.sample(Vec3::ZERO, 0.1, (0.5, 0.5)).unwrap().shadow);
        assert!(
            !lights
                .sample(Vec3::ZERO, 0.999_999_9, (0.5, 0.5))
                .unwrap()
                .shadow
        );
    }

    #[test]
    fn emissive_meshes_are_sampled_by_area() {
        // Two triangles of different size forming one quad at z = 100, facing down.
        let quad = Mesh::new(
            &[
                Vec3::new(-50.0, -50.0, 100.0),
                Vec3::new(50.0, -50.0, 100.0),
                Vec3::new(50.0, 50.0, 100.0),
                Vec3::new(-50.0, 50.0, 100.0),
            ],
            &[],
            &[0, 2, 1, 0, 3, 2],
            0,
        )
        .expect("quad");
        let scene = Scene {
            materials: vec![Material {
                kind: MATERIAL_EMISSIVE,
                emission: Rgb::WHITE,
                emission_power: 2.0,
                flags: MATERIAL_FLAG_LIGHT,
                ..Material::default()
            }],
            geometry: crate::scene::Geometry::from_meshes(vec![quad]),
            environment: black_env(),
            ..Scene::default()
        };
        let lights = Lights::new(&scene);
        assert_eq!(lights.len(), 1);
        assert!((lights.meshes[0].area - 10_000.0).abs() < 1.0e-2);
        // Irradiance at the centre below: E[L cos / pdf] = L · (solid-angle integral of cos).
        let mut e = 0.0f64;
        for i in 0..64 {
            for j in 0..64 {
                let u = ((i as f32 + 0.5) / 64.0, (j as f32 + 0.5) / 64.0);
                let sel = ((i * 64 + j) as f32 + 0.5) / 4096.0;
                let s = lights.sample(Vec3::ZERO, sel, u).expect("emitter");
                e += (s.radiance.g * s.wi.z / s.pdf) as f64;
            }
        }
        // A square of half-size a at height h: E = 4 L F with the corner form factor.
        let x = 0.5f64;
        let f = |x: f64, y: f64| {
            (x / (1.0 + x * x).sqrt() * (y / (1.0 + x * x).sqrt()).atan()
                + y / (1.0 + y * y).sqrt() * (x / (1.0 + y * y).sqrt()).atan())
                / (2.0 * std::f64::consts::PI)
        };
        let want = 2.0 * 4.0 * std::f64::consts::PI * f(x, x);
        assert!(
            (e / 4096.0 / want - 1.0).abs() < 0.01,
            "{} vs {want}",
            e / 4096.0
        );
        assert_eq!(lights.emitter_weight(5, 1.0, 1.0, 1.0), 1.0);
        assert!(lights.emitter_weight(0, 1.0, 100.0, 1.0) < 1.0);
    }
}
