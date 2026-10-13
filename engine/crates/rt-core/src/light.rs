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
//! * **Emissive meshes**: instances whose material is emissive and carries
//!   [`crate::scene::MATERIAL_FLAG_LIGHT`]; triangles are chosen in proportion to their area,
//!   points uniformly on them. Two-sided unless the instance is one-sided.
//! * **The environment** ([`EnvLight`]), importance sampled.
//!
//! Next-event estimation picks **one** of them per vertex, with probability proportional to an
//! estimate of the flux it sends into the scene's bounding sphere (flux and distance for area
//! lights and emitters, `π E` for the sun, `4π² L̄` for the environment). A light tree (Conty and
//! Kulla 2018) replaces this in phase K4. Point and spot lights (kinds 3 and 4) are reserved for
//! L4 and ignored here.

use crate::color::Rgb;
use crate::environment::EnvLight;
use crate::fmath;
use crate::math::{Frame, Ray, Vec3};
use crate::scene::{
    LightKind, Scene, INSTANCE_ONE_SIDED, LIGHT_FLAG_CAMERA, LIGHT_FLAG_GLOSSY, MATERIAL_FLAG_LIGHT,
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
enum AreaShape {
    /// Half extents along the frame's x and y axes.
    Rect { half_x: f32, half_y: f32 },
    /// Radius in the frame's xy plane.
    Disk { radius: f32 },
}

/// A rect or disk light.
#[derive(Clone, Debug, PartialEq)]
struct AreaLight {
    shape: AreaShape,
    centre: Vec3,
    /// `z` is the emission normal, `x` and `y` the rectangle's axes.
    frame: Frame,
    /// Area in scene units (mm²).
    area: f32,
    /// Radiance along the normal.
    radiance: Rgb,
    /// Spread falloff exponent (0: Lambertian).
    exponent: f32,
    glossy: bool,
    camera: bool,
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
    fn radiance_at(&self, cos: f32) -> Rgb {
        if self.exponent == 0.0 {
            self.radiance
        } else {
            self.radiance * fmath::powf(cos, self.exponent)
        }
    }

    fn sample_point(&self, u: (f32, f32)) -> Vec3 {
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
struct SunLight {
    /// `z` points at the sun.
    frame: Frame,
    cos_max: f32,
    one_minus_cos_max: f32,
    solid_angle: f32,
    /// Radiance of the disc; for a delta sun, the irradiance.
    radiance: Rgb,
    delta: bool,
    glossy: bool,
    camera: bool,
    pmf: f32,
}

impl SunLight {
    fn contains(&self, dir: Vec3) -> bool {
        !self.delta && dir.dot(self.frame.z) >= self.cos_max
    }
}

/// An emissive instance sampled as an area light.
#[derive(Clone, Debug, PartialEq)]
struct MeshEmitter {
    /// World-space corners of each triangle.
    corners: Vec<[Vec3; 3]>,
    /// Unit normal of each triangle (winding order: the front face).
    normals: Vec<Vec3>,
    /// Cumulative area fractions.
    cdf: Vec<f32>,
    /// Total area (mm²).
    area: f32,
    radiance: Rgb,
    two_sided: bool,
    pmf: f32,
}

/// One entry of the light selection distribution.
#[derive(Clone, Copy, Debug, PartialEq)]
enum LightRef {
    Area(u32),
    Sun(u32),
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
}

/// Every light of a scene, ready for sampling.
#[derive(Clone, Debug, PartialEq)]
pub struct Lights {
    areas: Vec<AreaLight>,
    suns: Vec<SunLight>,
    meshes: Vec<MeshEmitter>,
    env: EnvLight,
    env_pmf: f32,
    entries: Vec<LightRef>,
    /// Cumulative selection probabilities of `entries` (the last one is exactly 1).
    cdf: Vec<f32>,
    /// Emitter index of each instance, if it is one.
    instance_emitter: Vec<Option<u32>>,
}

/// Index of the bucket of a CDF that holds `u`, and `u` rescaled to `[0, 1)` inside it.
fn pick(cdf: &[f32], u: f32) -> (usize, f32) {
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
fn build_cdf(weights: &[f32]) -> Vec<f32> {
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
        let mut weights = Vec::new();
        let mut entries = Vec::new();
        for light in &scene.lights {
            let glossy = light.flags & LIGHT_FLAG_GLOSSY != 0;
            let camera = light.flags & LIGHT_FLAG_CAMERA != 0;
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
                        pmf: 0.0,
                    });
                }
                // Reserved for L4.
                LightKind::Point | LightKind::Spot => {}
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

        let env = EnvLight::new(&scene.environment);
        if !env.is_black() {
            weights.push(4.0 * fmath::PI * fmath::PI * env.mean_radiance());
            entries.push(LightRef::Environment);
        }

        let cdf = build_cdf(&weights);
        let mut lights = Lights {
            areas,
            suns,
            meshes,
            env,
            env_pmf: 0.0,
            entries: if cdf.is_empty() { Vec::new() } else { entries },
            cdf,
            instance_emitter,
        };
        for i in 0..lights.entries.len() {
            let pmf = lights.cdf[i] - if i == 0 { 0.0 } else { lights.cdf[i - 1] };
            match lights.entries[i] {
                LightRef::Area(a) => lights.areas[a as usize].pmf = pmf,
                LightRef::Sun(s) => lights.suns[s as usize].pmf = pmf,
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
                    let light_pdf = light.pmf * t * t / (light.area * cos);
                    power_heuristic(pdf, light_pdf)
                }
            };
            sum += light.radiance_at(cos) * weight;
        }
        sum
    }

    /// True when a camera ray could see any light directly (the alpha of a transparent
    /// background then needs [`Lights::crossed`]).
    pub fn any_camera_visible(&self) -> bool {
        self.areas.iter().any(|l| l.camera) || self.suns.iter().any(|s| s.camera && !s.delta)
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
    fn selection_follows_power_and_reserved_kinds_are_ignored() {
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
                Light {
                    kind: LightKind::Point,
                    ..Light::default()
                },
                Light {
                    kind: LightKind::Spot,
                    ..Light::default()
                },
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
