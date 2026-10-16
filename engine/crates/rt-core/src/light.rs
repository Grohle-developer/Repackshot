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
//!   points uniformly on them. Two-sided unless the instance is one-sided. Not an emitter whose
//!   textures change its radiance over the surface (M2b, [`crate::texture`]), nor one whose
//!   program's emission is not a constant (M3b, [`crate::program`]): only the rays that hit it
//!   find it.
//! * **The environment** ([`EnvLight`]), importance sampled.
//!
//! **Which light** (E12). Next-event estimation picks **one** of them per vertex, with a
//! probability proportional to a cheap upper bound of the irradiance each one, unoccluded, can give
//! the vertex `x` that is being shaded ([`Lights::select`]): the flat, one-level case of the light
//! tree of C. Conty Estevez and C. Kulla, "Importance Sampling of Many Lights with Adaptive Tree
//! Splitting" (HPG 2018), whose §4.3 gives the orientation bound (`orientation_bound`). The
//! weight of each light at `x`, all in the same units (W/m², distances in metres):
//!
//! * a point light or a spot: `lum(I) · mask(x) / max(d², r²)`, its intensity over the squared
//!   distance from its centre (never closer than its radius), times the spot's mask, which is
//!   exact (the spot's model masks by the direction from its centre);
//! * a rect or disk: `lum(L) · A · cos θ' / max(d², A)`, with the orientation bound of the
//!   reference: `θ` the angle between the panel's normal and the direction from its centre to
//!   `x`, `θu` the half angle of the panel's bounding sphere seen from `x` (`sin θu = r / d`;
//!   every direction inside it), the spread of the panel's normals `θo = 0` and of its emission
//!   `θe = π/2`, and `θ' = max(0, θ − θo − θu)`; zero only when `θ' ≥ θe`. So a panel that `x`
//!   sees edge on from its centre but not from its rim keeps a chance: no light that can light
//!   `x` from any of its points has probability zero there;
//! * an emissive mesh: the same as a panel from its centroid, with the cone of its front faces'
//!   normals as `θo` and the sphere around the centroid that holds it for `θu`; two-sided, or
//!   closed, it may face `x` from anywhere (`cos θ' = 1`), and it counts once: one side faces `x`;
//! * the sun: `lum(E)`; the environment: `π L̄`, what a uniform world of its mean radiance gives a
//!   surface.
//!
//! Nothing of the size of the light list is stored per vertex: [`Lights::select`] sums the weights
//! and keeps the first few ([`Selection`]), and the pick rebuilds their cumulative distribution
//! entry by entry, with the operations of `build_cdf` and `pick`, up to the light it takes. The
//! cost grows with the number of lights, so this is for two to [`MAX_LOCAL_LIGHTS`] entries (one is
//! chosen for certain either way, with the same bits, and by flux costs nothing); a scene with more
//! uses, everywhere, the static selection of before E12 ([`Lights::select_by_flux`]), by an
//! estimate of the flux each light sends into the scene's bounding sphere (flux and distance for
//! area lights and emitters, `π E` for the sun, `4π² L̄` for the environment; a point light by its
//! flux and distance, a spot as the point light it is when its cone takes in the scene's centre).
//! The shadow catcher keeps that static selection too: its shadow is a ratio of one sample's light
//! (`crate::integrator`), whose value depends on the choice. Light trees (K4) will hang their
//! hierarchy from the same per-point measure.
//!
//! **MIS** needs the probability with which next-event estimation would have chosen a light that
//! a BSDF-sampled ray finds. It is the same function (`Lights::pmf`), evaluated at the same
//! vertex: the one where the ray was sampled (its [`Selection`], carried by [`Scattered`]),
//! also when the ray went on through thin walls and cut-outs before it found the light. Caustic
//! photons ([`crate::caustics`]) are emitted from no vertex and keep choosing their light by flux.
//!
//! A light flagged `LIGHT_FLAG_NO_SHADOW` (L4) lights through everything: its samples say so
//! ([`LightSample::shadow`]) and no shadow ray is traced.

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

/// Most lights (entries of the selection: lights, emissive meshes and the environment) chosen
/// per shading point; a scene with more chooses by flux everywhere (the cost of the choice per
/// point grows with the number of lights).
pub const MAX_LOCAL_LIGHTS: usize = 64;

/// Weights a [`Selection`] keeps, so that neither the pick nor the MIS weights of the ray that
/// leaves the vertex compute them again; past them (scenes of more lights) they are computed
/// again where needed, with the same operations.
const KEPT_WEIGHTS: usize = 8;

/// Closest a point light is taken to be for its selection weight, in m² (1 mm): the weight of a
/// light at the shading point itself stays finite.
const MIN_DISTANCE2_M2: f32 = 1.0e-6;

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

/// A sum of selection weights that a probability can be divided by: positive and finite.
#[inline]
fn usable(total: f32) -> bool {
    total > 0.0 && total.is_finite()
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
    /// Its entry in the selection.
    entry: u32,
    /// Selection weight before distance and orientation: `lum(L) · A` (A in m²), its on-axis
    /// intensity.
    base: f32,
    /// Radius of the sphere that bounds the panel, around its centre (mm).
    bound: f32,
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

/// The orientation bound of Conty Estevez and Kulla (HPG 2018, §4.3) for an emitter whose normals
/// lie within `θo` of `axis` (`cos_sin_o` = `(cos θo, sin θo)`), that emits within `θe = π/2` of
/// its normals, inside a sphere of radius `bound` (mm) around its centre: an upper bound on the
/// cosine between an emitting normal and the direction from its point to `x`, `cos θ'` with `θ' =
/// max(0, θ − θo − θu)`, zero when `θ' ≥ θe`. `θ` is the angle between `axis` and the direction
/// from the centre to `x`, `θu` the half angle of the bounding sphere seen from `x` (`sin θu = r /
/// d`; inside it, any direction). `v` is `x` minus the centre and `d2` its squared length. Dot
/// products and square roots only: the angles add and subtract through `cos(a ± b) = cos a cos b ∓
/// sin a sin b`.
#[inline]
fn orientation_bound(v: Vec3, d2: f32, axis: Vec3, cos_sin_o: (f32, f32), bound: f32) -> f32 {
    if d2 <= bound * bound {
        return 1.0; // inside its bounding sphere: any direction
    }
    let (cos_o, sin_o) = cos_sin_o;
    let inv_d = 1.0 / d2.sqrt();
    let sin_u = bound * inv_d;
    let cos_u = (1.0 - sin_u * sin_u).max(0.0).sqrt();
    // θs = θo + θu, every direction when it reaches π.
    let cos_s = cos_o * cos_u - sin_o * sin_u;
    let sin_s = sin_o * cos_u + cos_o * sin_u;
    if sin_s < 0.0 {
        return 1.0;
    }
    let cos_t = v.dot(axis) * inv_d;
    if cos_t >= cos_s {
        return 1.0; // θ ≤ θo + θu: some normal may point straight at x
    }
    let sin_t = (1.0 - cos_t * cos_t).max(0.0).sqrt();
    (cos_t * cos_s + sin_t * sin_s).max(0.0)
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

    /// [`orientation_bound`] of a flat emitter (`θo = 0`): `v` is `x` minus the centre, `d2` its
    /// squared length (mm²).
    #[inline]
    fn orientation(&self, v: Vec3, d2: f32) -> f32 {
        orientation_bound(v, d2, self.frame.z, (1.0, 0.0), self.bound)
    }

    /// Selection weight at `x`: `lum(L) · A · cos θ' / max(d², A)`.
    #[inline]
    fn weight(&self, x: Vec3) -> f32 {
        let v = x - self.centre;
        let d2 = v.length_squared();
        let orientation = self.orientation(v, d2);
        if orientation <= 0.0 {
            return 0.0;
        }
        self.base * orientation / (d2.max(self.area) * MM2_TO_M2)
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
    entry: u32,
    /// Selection weight, the same everywhere: `lum(E)`, the irradiance it gives a surface facing it.
    base: f32,
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
    entry: u32,
    /// Selection weight before the mask and the distance: `lum(I)`.
    base: f32,
    /// Squared radius in m², at least [`MIN_DISTANCE2_M2`]: the closest its weight takes it.
    near2: f32,
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

    /// Selection weight at `x`: `lum(I) · mask(x) / max(d², r²)`.
    #[inline]
    fn weight(&self, x: Vec3) -> f32 {
        let mask = self.mask(x);
        if mask <= 0.0 {
            return 0.0;
        }
        let d2 = (x - self.centre).length_squared() * MM2_TO_M2;
        self.base * mask / d2.max(self.near2)
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
    entry: u32,
    /// Area-weighted centre of its triangles.
    centroid: Vec3,
    /// Radius of the sphere around the centroid that holds it (mm).
    bound: f32,
    /// The cone of its front faces' normals: axis and `(cos θo, sin θo)`; `cos θo = −1` (any
    /// direction) for a two-sided emitter, or a closed one.
    axis: Vec3,
    cos_sin_o: (f32, f32),
    /// Selection weight before distance and orientation: `lum(L) · A` (A in m²; one side faces x
    /// at a time, so a two-sided emitter counts once).
    base: f32,
}

impl MeshEmitter {
    /// Selection weight at `x`: `lum(L) · A · cos θ' / max(d², A)` from its centroid, with the
    /// cone of its normals for [`orientation_bound`].
    #[inline]
    fn weight(&self, x: Vec3) -> f32 {
        let v = x - self.centroid;
        let d2 = v.length_squared();
        let orientation = if self.cos_sin_o.0 <= -1.0 {
            1.0
        } else {
            orientation_bound(v, d2, self.axis, self.cos_sin_o, self.bound)
        };
        if orientation <= 0.0 {
            return 0.0;
        }
        self.base * orientation / (d2.max(self.area) * MM2_TO_M2)
    }
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
    /// Its entry in the selection (E13: what manifold next-event estimation connects to).
    pub(crate) entry: u32,
    /// The probability of having chosen that entry.
    pub(crate) pmf: f32,
    /// The point sampled on the light (zero for the sun and the environment).
    pub(crate) point: Vec3,
    /// The emitting surface's normal there (zero for a point, the sun and the environment).
    pub(crate) normal: Vec3,
}

/// Light selection at one shading vertex ([`Lights::select`]): the vertex, the sum of the weights
/// of every light seen from it and the first few of them, which is all a choice and its
/// probabilities need (the cumulative distribution is rebuilt entry by entry when a light is
/// picked, so nothing of the size of the light list is written per vertex). The BSDF-sampled ray that leaves the vertex
/// carries it ([`Scattered`]), so the MIS weights of whatever it finds use the probabilities
/// next-event estimation used there; only [`Lights::select`] and [`Lights::select_by_flux`] make
/// one.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Selection {
    point: Vec3,
    /// Sum of the weights at `point` (0 with the static selection).
    total: f32,
    /// Chosen by the static distribution (by flux), not per point.
    by_flux: bool,
    /// The weights of the first [`KEPT_WEIGHTS`] entries at `point`.
    weights: [f32; KEPT_WEIGHTS],
}

/// A BSDF-sampled ray, for the MIS weights of the lights it finds: its density per steradian and
/// the selection at the vertex it was sampled at (where it went on straight through thin walls
/// and cut-outs, still that vertex).
#[derive(Clone, Copy, Debug)]
pub struct Scattered<'a> {
    /// Density per steradian of the BSDF sample.
    pub pdf: f32,
    /// The light selection at the vertex it left.
    pub from: &'a Selection,
    /// E13: the ray left smooth refracting surfaces since a vertex that manifold next-event
    /// estimation connects from ([`Manifold`]); `None` for every other ray.
    pub manifold: Option<Manifold<'a>>,
}

impl<'a> Scattered<'a> {
    /// A BSDF-sampled ray of density `pdf` from the vertex of `from`, with no manifold hook.
    pub fn new(pdf: f32, from: &'a Selection) -> Scattered<'a> {
        Scattered {
            pdf,
            from,
            manifold: None,
        }
    }
}

/// A light that a BSDF-sampled ray found, as manifold next-event estimation looks at it (E13).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Found {
    /// The light's entry in the selection.
    pub entry: u32,
    /// The point found on it; for a sun, the direction towards it.
    pub at: Vec3,
    /// The emitting surface's front normal there (zero for a sun).
    pub normal: Vec3,
}

/// The MIS of a light that a BSDF-sampled ray finds after one or more smooth refractions,
/// against manifold next-event estimation from the last vertex before them (E13,
/// [`crate::integrator::manifold`]): MNEE may have connected that vertex to the same point of the
/// same light through the same surfaces, and then the two techniques share the path.
#[derive(Clone, Copy)]
pub struct Manifold<'a> {
    /// The density, the light selection and the distance from the last real scattering vertex
    /// (the refracting surface the ray left), when the [`Scattered`] carries instead those of a
    /// medium's exit vertex whose shadow rays cross thin walls (E9b, outside MNEE's domain);
    /// `None` when they are the same.
    pub raw: Option<(f32, &'a Selection, f32)>,
    /// `Some(b)` when manifold next-event estimation connects that vertex to the light found:
    /// the factor of the light's MIS weight against it (one when it cannot produce this path);
    /// `None` outside its domain, where the usual weight holds.
    pub weigh: &'a dyn Fn(Found) -> Option<f32>,
}

impl std::fmt::Debug for Manifold<'_> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Manifold").field("raw", &self.raw).finish()
    }
}

/// What manifold next-event estimation connects a vertex to (E13): a point of a light, or the
/// direction of a sun.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) enum End {
    /// A point `y`, on an emitting surface of front normal `normal` (zero for a point light: the
    /// measure is then the area across the last segment).
    Point { y: Vec3, normal: Vec3 },
    /// The unit direction `w` towards a sun.
    Direction { w: Vec3 },
}

/// A light sample, or a light found, as manifold next-event estimation connects to it (E13).
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct ManifoldEnd {
    /// The light's entry in the selection.
    pub(crate) entry: u32,
    /// Where the connection ends.
    pub(crate) end: End,
    /// The density next-event estimation at the vertex draws it with, light selection included:
    /// per mm² of the emitting surface (of the area across the last segment for a point light: a
    /// selection probability), per steradian for a sun's disc, the selection probability for a
    /// delta sun.
    pub(crate) density: f32,
    /// A point light or a delta sun: no other technique finds it.
    pub(crate) delta: bool,
    /// The light sends caustic photons ([`LightSample::photon`]).
    pub(crate) photon: bool,
}

/// Which techniques may find a light (tests of the estimators): both, weighted by MIS, as
/// rendering always does, or one of them alone.
#[cfg(test)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Techniques {
    Mis,
    LightsOnly,
    BsdfOnly,
}

/// Every light of a scene, ready for sampling.
#[derive(Clone, Debug, PartialEq)]
pub struct Lights {
    pub(crate) areas: Vec<AreaLight>,
    pub(crate) suns: Vec<SunLight>,
    spheres: Vec<SphereLight>,
    pub(crate) meshes: Vec<MeshEmitter>,
    env: EnvLight,
    /// The environment's entry, when it is one.
    env_entry: Option<u32>,
    /// Selection weight of the environment, the same everywhere: `π L̄`, the irradiance a uniform
    /// world of its mean radiance gives a surface.
    env_base: f32,
    entries: Vec<LightRef>,
    /// Cumulative selection probabilities of `entries` by flux (the last one is exactly 1): the
    /// static selection, for scenes of more than [`MAX_LOCAL_LIGHTS`] entries.
    cdf: Vec<f32>,
    /// The probability of each entry in `cdf`: its bucket's width.
    flux_pmf: Vec<f32>,
    /// Lights are chosen per shading point (from two to [`MAX_LOCAL_LIGHTS`] entries); otherwise
    /// by the static `cdf`, everywhere.
    pub(crate) per_point: bool,
    /// Emitter index of each instance, if it is one.
    instance_emitter: Vec<Option<u32>>,
    /// The lights a camera ray sees (O3a: the lens's filters connect to them), in the order of
    /// [`Lights::camera_lights`].
    camera: Vec<CameraLight>,
    #[cfg(test)]
    pub(crate) techniques: Techniques,
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

/// The lights a camera ray can see, by their bounding spheres: the area lights flagged `camera`
/// and the sphere lights flagged `camera` with a size (O3a).
fn camera_lights_of(areas: &[AreaLight], spheres: &[SphereLight]) -> Vec<CameraLight> {
    let mut camera = Vec::new();
    for (i, a) in areas.iter().enumerate() {
        if a.camera {
            let radius = match a.shape {
                AreaShape::Rect { half_x, half_y } => (half_x * half_x + half_y * half_y).sqrt(),
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
    for (i, l) in spheres.iter().enumerate() {
        if l.camera && positive(l.radius) {
            camera.push(CameraLight {
                centre: l.centre,
                radius: l.radius,
                sphere: true,
                index: i as u32,
            });
        }
    }
    camera
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

/// The MIS state and factor of a light `found` by the BSDF-sampled ray `s` (which went `offset`
/// straight since its vertex) against manifold next-event estimation (E13): `None` without a
/// hook or outside MNEE's domain (the usual weight); otherwise the density, selection and offset
/// to weigh the light with (those of the last real vertex) and the factor `b` to multiply it by.
#[inline]
fn manifold_factor<'a>(
    s: Scattered<'a>,
    offset: f32,
    found: Found,
) -> Option<((f32, &'a Selection, f32), f32)> {
    let m = s.manifold?;
    let b = (m.weigh)(found)?;
    Some((m.raw.unwrap_or((s.pdf, s.from, offset)), b))
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
        // The static selection: share of an emitter's flux that reaches the bounding sphere,
        // over R².
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
            let entry = entries.len() as u32;
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
                    let (area, bound) = match shape {
                        AreaShape::Rect { half_x, half_y } => (
                            4.0 * half_x * half_y,
                            (half_x * half_x + half_y * half_y).sqrt(),
                        ),
                        AreaShape::Disk { radius } => (fmath::PI * radius * radius, radius),
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
                        entry,
                        base: radiance.luminance() * area * MM2_TO_M2,
                        bound,
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
                        entry,
                        base: irradiance.luminance(),
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
                        entry,
                        base: intensity.luminance(),
                        near2: (r_m * r_m).max(MIN_DISTANCE2_M2),
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
            // M2b: an emitter whose textures change its radiance over the surface is found by
            // the rays that hit it, not sampled by its flux.
            if crate::texture::shade::emission_varies(scene, instance.material_id) {
                continue;
            }
            // M3b: and so is one whose program's emission is not a constant.
            if crate::program::shade::emission_varies(scene, instance.material_id) {
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
            let centroid = centroid / area;
            let bound = corners
                .iter()
                .flatten()
                .fold(0.0f32, |r, p| r.max((*p - centroid).length()));
            // The cone of the front faces' normals, about their area-weighted mean.
            let mut mean = Vec3::ZERO;
            for (n, a) in normals.iter().zip(&tri_areas) {
                mean += *n * *a;
            }
            let length = mean.length();
            let (axis, cos_sin_o) = if two_sided || length <= 1.0e-3 * area {
                (Vec3::new(0.0, 0.0, 1.0), (-1.0, 0.0))
            } else {
                let axis = mean / length;
                let cos_o = normals
                    .iter()
                    .fold(1.0f32, |c, n| c.min(n.dot(axis)))
                    .clamp(-1.0, 1.0);
                (axis, (cos_o, (1.0 - cos_o * cos_o).max(0.0).sqrt()))
            };
            weights.push(flux * reach(centroid, None));
            let entry = entries.len() as u32;
            entries.push(LightRef::Mesh(meshes.len() as u32));
            instance_emitter[i] = Some(meshes.len() as u32);
            meshes.push(MeshEmitter {
                corners,
                normals,
                cdf,
                area,
                radiance,
                two_sided,
                entry,
                centroid,
                bound,
                axis,
                cos_sin_o,
                base: radiance.luminance() * area * MM2_TO_M2,
            });
        }

        let env = EnvLight::new(&scene.environment, &scene.bitmaps);
        let mut env_entry = None;
        let env_base = fmath::PI * env.mean_radiance();
        if !env.is_black() {
            weights.push(4.0 * fmath::PI * fmath::PI * env.mean_radiance());
            env_entry = Some(entries.len() as u32);
            entries.push(LightRef::Environment);
        }

        let cdf = build_cdf(&weights);
        let entries = if cdf.is_empty() { Vec::new() } else { entries };
        let flux_pmf = (0..cdf.len())
            .map(|e| cdf[e] - if e == 0 { 0.0 } else { cdf[e - 1] })
            .collect();
        let camera = camera_lights_of(&areas, &spheres);
        Lights {
            areas,
            suns,
            spheres,
            meshes,
            env,
            env_entry: env_entry.filter(|_| !entries.is_empty()),
            env_base,
            // One entry is chosen for certain either way, with the same bits (a test renders it both
            // ways): by flux it costs nothing.
            per_point: (2..=MAX_LOCAL_LIGHTS).contains(&entries.len()),
            entries,
            cdf,
            flux_pmf,
            instance_emitter,
            camera,
            #[cfg(test)]
            techniques: Techniques::Mis,
        }
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

    /// Selection weight of entry `entry` seen from `x`: the bound of its unoccluded light there
    /// (the module's documentation).
    #[inline(always)]
    fn weight(&self, entry: usize, x: Vec3) -> f32 {
        match self.entries[entry] {
            LightRef::Area(a) => self.areas[a as usize].weight(x),
            LightRef::Sun(s) => self.suns[s as usize].base,
            LightRef::Sphere(s) => self.spheres[s as usize].weight(x),
            LightRef::Mesh(m) => self.meshes[m as usize].weight(x),
            LightRef::Environment => self.env_base,
        }
    }

    /// The light selection at the shading point `x`: the sum of every light's weight there
    /// (nothing to compute with the static selection).
    pub fn select(&self, x: Vec3) -> Selection {
        let n = self.entries.len();
        if !self.per_point || n == 0 {
            return self.select_by_flux(x);
        }
        // Summed in the order of the entries, as `build_cdf` sums.
        let mut selection = Selection {
            point: x,
            total: 0.0,
            by_flux: false,
            weights: [0.0; KEPT_WEIGHTS],
        };
        for entry in 0..n {
            let w = self.weight(entry, x);
            if let Some(kept) = selection.weights.get_mut(entry) {
                *kept = w;
            }
            selection.total += w;
        }
        selection
    }

    /// Weight of entry `entry` at the selection's vertex: kept, or computed again (the same
    /// value).
    #[inline(always)]
    fn weight_at(&self, entry: usize, selection: &Selection) -> f32 {
        match selection.weights.get(entry) {
            Some(&w) => w,
            None => self.weight(entry, selection.point),
        }
    }

    /// The static selection (by flux, as before E12) at `x`: the same at every point.
    pub fn select_by_flux(&self, x: Vec3) -> Selection {
        Selection {
            point: x,
            total: 0.0,
            by_flux: true,
            weights: [0.0; KEPT_WEIGHTS],
        }
    }

    /// Probability with which next-event estimation at `from` chooses entry `entry`: its weight
    /// there over the sum of all of them, or (static selection) its share of the flux. The one
    /// function behind every density of a light, for next-event estimation and for the MIS
    /// weights of BSDF-sampled rays alike.
    #[inline]
    pub(crate) fn pmf(&self, entry: u32, from: &Selection) -> f32 {
        let e = entry as usize;
        if e >= self.entries.len() {
            return 0.0;
        }
        if from.by_flux {
            return self.flux_pmf[e];
        }
        if !usable(from.total) {
            return 0.0;
        }
        self.weight_at(e, from) / from.total
    }

    /// The MIS weight of a light found by a BSDF-sampled ray of density `bsdf_pdf`, against
    /// next-event estimation's density `light_pdf` for it.
    #[inline]
    pub(crate) fn found_weight(&self, bsdf_pdf: f32, light_pdf: f32) -> f32 {
        #[cfg(test)]
        match self.techniques {
            Techniques::Mis => {}
            Techniques::LightsOnly => return if positive(light_pdf) { 0.0 } else { 1.0 },
            Techniques::BsdfOnly => return 1.0,
        }
        power_heuristic(bsdf_pdf, light_pdf)
    }

    /// The MIS weight of a light sample of density `light_pdf` that BSDF sampling would find
    /// with density `bsdf_pdf` (a glossy light that is not a delta).
    #[inline]
    pub(crate) fn sampled_weight(&self, light_pdf: f32, bsdf_pdf: f32) -> f32 {
        #[cfg(test)]
        match self.techniques {
            Techniques::Mis => {}
            Techniques::LightsOnly => return 1.0,
            Techniques::BsdfOnly => return 0.0,
        }
        power_heuristic(light_pdf, bsdf_pdf)
    }

    /// [`pick`] on the cumulative distribution [`build_cdf`] would make of the weights at the
    /// selection's vertex, built entry by entry with the same operations up to the bucket that
    /// holds `u`: the entry, `u` rescaled inside its bucket and its probability, `weight /
    /// total`, the very value of [`Lights::pmf`] there.
    #[inline]
    fn pick_at(&self, selection: &Selection, u: f32) -> (usize, f32, f32) {
        let total = selection.total;
        let last = self.entries.len() - 1;
        let mut acc = 0.0f32;
        let mut lo = 0.0f32;
        for entry in 0..=last {
            let w = self.weight_at(entry, selection);
            acc += w;
            // The last bucket ends at exactly 1, as `build_cdf` makes it.
            let hi = if entry == last { 1.0 } else { acc / total };
            // The first bucket whose end passes `u` (or the last), as `pick` finds it.
            if hi > u || entry == last {
                let width = hi - lo;
                let rest = if width > 0.0 {
                    ((u - lo) / width).clamp(0.0, 0.999_999_94)
                } else {
                    0.0
                };
                return (entry, rest, w / total);
            }
            lo = hi;
        }
        (last, 0.0, 0.0)
    }

    /// Picks a light with `u_select` and a point on it with `u`, as seen from `x`.
    pub fn sample(&self, x: Vec3, u_select: f32, u: (f32, f32)) -> Option<LightSample> {
        self.sample_selected(&self.select(x), u_select, u)
    }

    /// Picks a light from `selection` (made at the shading point by [`Lights::select`]) with
    /// `u_select`, and a point on it with `u`.
    pub fn sample_selected(
        &self,
        selection: &Selection,
        u_select: f32,
        u: (f32, f32),
    ) -> Option<LightSample> {
        let n = self.entries.len();
        if n == 0 {
            return None;
        }
        let from = selection;
        let x = from.point;
        let (index, rest, pmf) = if from.by_flux {
            let (index, rest) = pick(&self.cdf, u_select);
            (index, rest, self.pmf(index as u32, from))
        } else {
            if !usable(from.total) {
                return None;
            }
            self.pick_at(from, u_select)
        };
        if !positive(pmf) {
            return None;
        }
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
                    pdf: pmf * dist2 / (light.area * cos),
                    delta: false,
                    glossy: light.glossy,
                    photon: light.glossy,
                    shadow: light.shadow,
                    entry: light.entry,
                    pmf,
                    point: p,
                    normal: light.frame.z,
                }
            }
            LightRef::Sun(s) => {
                let sun = &self.suns[s as usize];
                if sun.delta {
                    LightSample {
                        wi: sun.frame.z,
                        distance: f32::INFINITY,
                        radiance: sun.radiance,
                        pdf: pmf,
                        delta: true,
                        glossy: sun.glossy,
                        photon: sun.glossy,
                        shadow: sun.shadow,
                        entry: sun.entry,
                        pmf,
                        point: Vec3::ZERO,
                        normal: Vec3::ZERO,
                    }
                } else {
                    let local = warp::uniform_cone(u, sun.one_minus_cos_max);
                    LightSample {
                        wi: sun.frame.to_world(local).normalize(),
                        distance: f32::INFINITY,
                        radiance: sun.radiance,
                        pdf: pmf / sun.solid_angle,
                        delta: false,
                        glossy: sun.glossy,
                        photon: sun.glossy,
                        shadow: sun.shadow,
                        entry: sun.entry,
                        pmf,
                        point: Vec3::ZERO,
                        normal: Vec3::ZERO,
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
                        pdf: pmf,
                        delta: true,
                        glossy: light.glossy,
                        photon: false,
                        shadow: light.shadow,
                        entry: light.entry,
                        pmf,
                        point: light.centre,
                        normal: Vec3::ZERO,
                    }
                } else {
                    let local = warp::uniform_cone(u, omc);
                    let wi = Frame::from_normal(towards).to_world(local).normalize();
                    // The near side of the sphere along wi.
                    let b = wi.dot(d);
                    let r2 = light.radius * light.radius;
                    let near = b - (r2 - (d - wi * b).length_squared()).max(0.0).sqrt();
                    let point = x + wi * near.max(0.0);
                    LightSample {
                        wi,
                        distance: near.max(0.0),
                        radiance: light.radiance * mask,
                        pdf: pmf / (fmath::TAU * omc),
                        delta: false,
                        glossy: light.glossy,
                        photon: false,
                        shadow: light.shadow,
                        entry: light.entry,
                        pmf,
                        point,
                        normal: (point - light.centre) * (1.0 / light.radius),
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
                    pdf: pmf * dist2 / (emitter.area * cos),
                    delta: false,
                    glossy: true,
                    photon: true,
                    shadow: true,
                    entry: emitter.entry,
                    pmf,
                    point: p,
                    normal: emitter.normals[t],
                }
            }
            LightRef::Environment => {
                let (wi, pdf) = self.env.sample(u)?;
                LightSample {
                    wi,
                    distance: f32::INFINITY,
                    radiance: self.env.radiance(wi),
                    pdf: pmf * pdf,
                    delta: false,
                    glossy: true,
                    photon: false,
                    shadow: true,
                    entry: index as u32,
                    pmf,
                    point: Vec3::ZERO,
                    normal: Vec3::ZERO,
                }
            }
        };
        (sample.pdf > 0.0 && sample.pdf.is_finite() && sample.radiance.luminance() > 0.0)
            .then_some(sample)
    }

    /// Radiance of the area lights that `ray` (unit direction) crosses from the front before
    /// `t_max`. A camera ray (`bsdf` `None`) sees the lights flagged `camera`, at full weight; a
    /// BSDF-sampled ray sees the lights flagged `glossy`, weighted against next-event estimation
    /// with the power heuristic.
    pub fn crossed(&self, ray: &Ray, t_max: f32, bsdf: Option<Scattered<'_>>) -> Rgb {
        self.crossed_from(ray, t_max, bsdf, 0.0)
    }

    /// [`Lights::crossed`] for a ray that continues, straight, one that left the last scattering
    /// vertex `offset` earlier (it went through thin walls or cut-outs): the MIS weights use the
    /// distance from that vertex, and the selection probabilities there, as next-event
    /// estimation there did.
    pub fn crossed_from(
        &self,
        ray: &Ray,
        t_max: f32,
        bsdf: Option<Scattered<'_>>,
        offset: f32,
    ) -> Rgb {
        // The spheres add to the areas' sum in the same order as ever (the same bits).
        let areas = self.crossed_areas(ray, t_max, bsdf, offset);
        self.crossed_spheres(areas, ray, t_max, bsdf, offset)
    }

    /// [`Lights::crossed_from`] of the lights that send no caustic photons only (the spheres of
    /// point lights and spots): what a path adds where the photon map brings the rest
    /// ([`crate::caustics`]). Every area light a BSDF-sampled ray can see sends photons.
    pub(crate) fn crossed_without_photons(
        &self,
        ray: &Ray,
        t_max: f32,
        bsdf: Option<Scattered<'_>>,
        offset: f32,
    ) -> Rgb {
        self.crossed_spheres(Rgb::BLACK, ray, t_max, bsdf, offset)
    }

    fn crossed_areas(
        &self,
        ray: &Ray,
        t_max: f32,
        bsdf: Option<Scattered<'_>>,
        offset: f32,
    ) -> Rgb {
        let mut sum = Rgb::BLACK;
        for light in &self.areas {
            let visible = match bsdf {
                None => light.camera,
                Some(_) => light.glossy,
            };
            if !visible {
                continue;
            }
            let Some((t, cos)) = light.intersect(ray, t_max) else {
                continue;
            };
            let weight = match bsdf {
                None => 1.0,
                Some(s) => {
                    let weigh = |pdf: f32, from: &Selection, offset: f32| {
                        let d = offset + t;
                        let light_pdf = self.pmf(light.entry, from) * d * d / (light.area * cos);
                        self.found_weight(pdf, light_pdf)
                    };
                    let found = Found {
                        entry: light.entry,
                        at: ray.at(t),
                        normal: light.frame.z,
                    };
                    match manifold_factor(s, offset, found) {
                        None => weigh(s.pdf, s.from, offset),
                        Some(((pdf, from, offset), b)) => weigh(pdf, from, offset) * b,
                    }
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
        bsdf: Option<Scattered<'_>>,
        offset: f32,
    ) -> Rgb {
        for light in &self.spheres {
            let visible = match bsdf {
                None => light.camera,
                Some(_) => light.glossy,
            };
            if !visible {
                continue;
            }
            let Some(t) = light.intersect(ray, t_max) else {
                continue;
            };
            // Seen from the vertex the ray left (offset back along it), as next-event estimation saw it.
            let vertex = ray.origin - ray.dir * offset;
            let mask = light.mask(vertex);
            if !positive(mask) {
                continue;
            }
            let weight = match bsdf {
                None => 1.0,
                Some(s) => {
                    let weigh = |pdf: f32, from: &Selection, vertex: Vec3| {
                        match light.cone((light.centre - vertex).length_squared()) {
                            // Next-event estimation takes it for a point there: only it counts it.
                            Some(omc) if omc > 0.0 => self.found_weight(
                                pdf,
                                self.pmf(light.entry, from) / (fmath::TAU * omc),
                            ),
                            _ => 0.0,
                        }
                    };
                    let at = ray.at(t);
                    let found = Found {
                        entry: light.entry,
                        at,
                        normal: (at - light.centre) * (1.0 / light.radius),
                    };
                    match manifold_factor(s, offset, found) {
                        None => weigh(s.pdf, s.from, vertex),
                        Some(((pdf, from, offset), b)) => {
                            weigh(pdf, from, ray.origin - ray.dir * offset) * b
                        }
                    }
                }
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
    /// environment and the sun discs. A camera ray (`bsdf` `None`) sees the environment and the
    /// suns flagged `camera`; a BSDF-sampled ray sees the environment and the suns flagged
    /// `glossy`, weighted against next-event estimation.
    pub fn escaped(&self, dir: Vec3, bsdf: Option<Scattered<'_>>) -> Rgb {
        let mut sum = match bsdf {
            Some(s) => self.escaped_environment(dir, s),
            None => self.env.radiance(dir),
        };
        for sun in &self.suns {
            let visible = match bsdf {
                None => sun.camera,
                Some(_) => sun.glossy,
            };
            if visible && sun.contains(dir) {
                let weight = bsdf.map_or(1.0, |s| {
                    let weigh = |pdf: f32, from: &Selection| {
                        self.found_weight(pdf, self.pmf(sun.entry, from) / sun.solid_angle)
                    };
                    let found = Found {
                        entry: sun.entry,
                        at: dir,
                        normal: Vec3::ZERO,
                    };
                    // A sun is at no distance: the offset does not matter.
                    match manifold_factor(s, 0.0, found) {
                        None => weigh(s.pdf, s.from),
                        Some(((pdf, from, _), b)) => weigh(pdf, from) * b,
                    }
                });
                sum += sun.radiance * weight;
            }
        }
        sum
    }

    /// [`Lights::escaped`] without the suns (they send caustic photons): what a BSDF-sampled ray
    /// whose light the photon map brings instead sees of the sky ([`crate::caustics`]).
    pub fn escaped_environment(&self, dir: Vec3, bsdf: Scattered<'_>) -> Rgb {
        let env = self.env.radiance(dir);
        match self.env_entry {
            Some(e) => {
                env * self.found_weight(bsdf.pdf, self.pmf(e, bsdf.from) * self.env.pdf(dir))
            }
            None => env,
        }
    }

    /// True when instance `instance` is an emissive mesh sampled as a light (it sends caustic
    /// photons).
    pub fn is_mesh_light(&self, instance: u32) -> bool {
        matches!(self.instance_emitter.get(instance as usize), Some(Some(_)))
    }

    /// For a BSDF-sampled ray that hit instance `instance` at distance `t` (unit direction, from
    /// the vertex it left) with `cos` between the ray and the surface normal: the MIS weight of
    /// the emission found, or 1 when the instance is not sampled by next-event estimation.
    pub fn emitter_weight(&self, instance: u32, bsdf: Scattered<'_>, t: f32, cos: f32) -> f32 {
        let Some(Some(m)) = self.instance_emitter.get(instance as usize) else {
            return 1.0;
        };
        let emitter = &self.meshes[*m as usize];
        let light_pdf =
            self.pmf(emitter.entry, bsdf.from) * t * t / (emitter.area * cos.abs().max(1.0e-7));
        self.found_weight(bsdf.pdf, light_pdf)
    }

    /// [`Lights::emitter_weight`] for a ray that met the emitter `t` after `offset` of straight
    /// events, at `at` on a triangle of front normal `normal`, weighted against manifold
    /// next-event estimation as its [`Manifold`] hook says (E13); without a hook it is exactly
    /// `emitter_weight(instance, bsdf, offset + t, cos)`.
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn emitter_weight_found(
        &self,
        instance: u32,
        bsdf: Scattered<'_>,
        t: f32,
        offset: f32,
        cos: f32,
        at: Vec3,
        normal: Vec3,
    ) -> f32 {
        if bsdf.manifold.is_none() {
            return self.emitter_weight(instance, bsdf, offset + t, cos);
        }
        let Some(Some(m)) = self.instance_emitter.get(instance as usize) else {
            return 1.0;
        };
        let found = Found {
            entry: self.meshes[*m as usize].entry,
            at,
            normal,
        };
        match manifold_factor(bsdf, offset, found) {
            None => self.emitter_weight(instance, bsdf, offset + t, cos),
            Some(((pdf, from, offset), b)) => {
                let raw = Scattered::new(pdf, from);
                self.emitter_weight(instance, raw, offset + t, cos) * b
            }
        }
    }

    /// What manifold next-event estimation connects the vertex `x` to for the light sample `ls`
    /// drawn there (E13): `None` for the environment, which it leaves to BSDF sampling.
    pub(crate) fn manifold_end(&self, ls: &LightSample, x: Vec3) -> Option<ManifoldEnd> {
        let (end, density) = match *self.entries.get(ls.entry as usize)? {
            LightRef::Area(a) => {
                let light = &self.areas[a as usize];
                let end = End::Point {
                    y: ls.point,
                    normal: light.frame.z,
                };
                (end, ls.pmf / light.area)
            }
            LightRef::Mesh(m) => {
                let end = End::Point {
                    y: ls.point,
                    normal: ls.normal,
                };
                (end, ls.pmf / self.meshes[m as usize].area)
            }
            LightRef::Sphere(_) if ls.delta => {
                let end = End::Point {
                    y: ls.point,
                    normal: Vec3::ZERO,
                };
                (end, ls.pmf)
            }
            LightRef::Sphere(_) => {
                // Sampled by solid angle at x: per unit area of the sphere at the point.
                let d2 = (ls.point - x).length_squared();
                let cos = ls.normal.dot(ls.wi).abs();
                let end = End::Point {
                    y: ls.point,
                    normal: ls.normal,
                };
                (end, ls.pdf * cos / d2)
            }
            LightRef::Sun(_) => (End::Direction { w: ls.wi }, ls.pdf),
            LightRef::Environment => return None,
        };
        (density > 0.0 && density.is_finite()).then_some(ManifoldEnd {
            entry: ls.entry,
            end,
            density,
            delta: ls.delta,
            photon: ls.photon,
        })
    }

    /// The light `found` by a BSDF-sampled ray, as next-event estimation at `x` (where the
    /// selection `from` was made) would have drawn it for manifold next-event estimation (E13):
    /// the same density as [`Lights::manifold_end`] gives that sample. `None` when next-event
    /// estimation there never draws that point of that light (a panel `x` is behind, the far side
    /// of a sphere, the back of a one-sided emitter, a light without shadows), or for the
    /// environment.
    pub(crate) fn manifold_found(
        &self,
        found: Found,
        x: Vec3,
        from: &Selection,
    ) -> Option<ManifoldEnd> {
        let pmf = self.pmf(found.entry, from);
        if !positive(pmf) {
            return None;
        }
        let towards = |y: Vec3| {
            let d = y - x;
            let dist2 = d.length_squared();
            (d * (1.0 / dist2.sqrt()), dist2)
        };
        let (end, density, photon) = match *self.entries.get(found.entry as usize)? {
            LightRef::Area(a) => {
                let light = &self.areas[a as usize];
                let (wi, _) = towards(found.at);
                if !light.shadow || !positive(-wi.dot(light.frame.z)) {
                    return None;
                }
                let end = End::Point {
                    y: found.at,
                    normal: light.frame.z,
                };
                (end, pmf / light.area, light.glossy)
            }
            LightRef::Mesh(m) => {
                let emitter = &self.meshes[m as usize];
                let (wi, _) = towards(found.at);
                if !emitter.two_sided && !positive(-wi.dot(found.normal)) {
                    return None;
                }
                let end = End::Point {
                    y: found.at,
                    normal: found.normal,
                };
                (end, pmf / emitter.area, true)
            }
            LightRef::Sphere(s) => {
                let light = &self.spheres[s as usize];
                let c = light.centre - x;
                let omc = light.cone(c.length_squared())?;
                if !light.shadow || omc <= 0.0 || !positive(light.mask(x)) {
                    return None;
                }
                // The point a sample in that direction lands on: the near side.
                let (wi, dist2) = towards(found.at);
                let b = wi.dot(c);
                let r2 = light.radius * light.radius;
                let near = b - (r2 - (c - wi * b).length_squared()).max(0.0).sqrt();
                if (x + wi * near - found.at).length() > 1.0e-3 * light.radius + 1.0e-3 {
                    return None;
                }
                let cos = found.normal.dot(wi).abs();
                let end = End::Point {
                    y: found.at,
                    normal: found.normal,
                };
                (end, pmf / (fmath::TAU * omc) * cos / dist2, false)
            }
            LightRef::Sun(s) => {
                let sun = &self.suns[s as usize];
                if !sun.shadow || sun.delta {
                    return None;
                }
                (
                    End::Direction { w: found.at },
                    pmf / sun.solid_angle,
                    sun.glossy,
                )
            }
            LightRef::Environment => return None,
        };
        (density > 0.0 && density.is_finite()).then_some(ManifoldEnd {
            entry: found.entry,
            end,
            density,
            delta: false,
            photon,
        })
    }

    /// What the light of entry `entry` sends along a manifold connection that leaves its point of
    /// `end` in the unit direction `towards` to the last refracting vertex `receiver` (E13): the
    /// radiance of an emitting surface in that direction (black from behind a one-sided one), a
    /// sun's radiance (a delta sun's irradiance), and for a point light its intensity, per unit
    /// area across the beam in mm² (the connection's Jacobian is per mm² there); a spot is masked
    /// by the direction to `receiver`.
    pub(crate) fn manifold_emission(
        &self,
        entry: u32,
        end: &End,
        towards: Vec3,
        receiver: Vec3,
    ) -> Rgb {
        let normal = match *end {
            End::Point { normal, .. } => normal,
            End::Direction { .. } => Vec3::ZERO,
        };
        match self.entries.get(entry as usize) {
            Some(&LightRef::Area(a)) => {
                let light = &self.areas[a as usize];
                let cos = towards.dot(light.frame.z);
                if cos > 0.0 {
                    light.radiance_at(cos)
                } else {
                    Rgb::BLACK
                }
            }
            Some(&LightRef::Mesh(m)) => {
                let emitter = &self.meshes[m as usize];
                if emitter.two_sided || towards.dot(normal) > 0.0 {
                    emitter.radiance
                } else {
                    Rgb::BLACK
                }
            }
            Some(&LightRef::Sphere(s)) => {
                let light = &self.spheres[s as usize];
                let mask = light.mask(receiver);
                if normal == Vec3::ZERO {
                    light.intensity * (mask / MM2_TO_M2)
                } else if towards.dot(normal) > 0.0 {
                    light.radiance * mask
                } else {
                    Rgb::BLACK
                }
            }
            Some(&LightRef::Sun(s)) => self.suns[s as usize].radiance,
            _ => Rgb::BLACK,
        }
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
        // By flux (the static selection) and, the two being in the same place, per point too.
        assert!((lights.cdf[0] - 0.75).abs() < 1.0e-6);
        assert!((lights.cdf[1] - lights.cdf[0] - 0.25).abs() < 1.0e-6);
        let at = lights.select(Vec3::ZERO);
        assert!((lights.pmf(0, &at) - 0.75).abs() < 1.0e-6);
        assert!((lights.pmf(1, &at) - 0.25).abs() < 1.0e-6);
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
        let at = lights.select(Vec3::ZERO);
        let bsdf = Scattered::new(1.0, &at);
        let w = lights.crossed(&up, f32::INFINITY, Some(bsdf)).g;
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
            // The static selection (by flux) of the sphere, entry 0.
            lights.cdf[0]
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
        let at = lights.select(Vec3::ZERO);
        let s = Scattered::new(1.0, &at);
        assert_eq!(lights.emitter_weight(5, s, 1.0, 1.0), 1.0);
        assert!(lights.emitter_weight(0, s, 100.0, 1.0) < 1.0);
    }

    #[test]
    fn a_light_close_to_the_point_is_chosen_there() {
        // Two equal point lights, one 100 mm above x and one 1000 mm away: per point the near
        // one weighs (1000/100)² = 100 times the far one; by flux (the static selection, as
        // before E12) they are chosen alike wherever the point is.
        let mut lights = Lights::new(&Scene {
            lights: vec![
                point(Vec3::new(0.0, 0.0, 100.0), 0.0, 5.0),
                point(Vec3::new(1000.0, 0.0, 0.0), 0.0, 5.0),
            ],
            environment: black_env(),
            ..Scene::default()
        });
        assert!(lights.per_point);
        let at = lights.select(Vec3::ZERO);
        let (near, far) = (lights.pmf(0, &at), lights.pmf(1, &at));
        assert!((near / far - 100.0).abs() < 1.0e-3, "{near} vs {far}");
        assert!((near + far - 1.0).abs() < 1.0e-6);
        // Next-event estimation's density is that probability (a point light: a delta).
        let s = lights
            .sample(Vec3::ZERO, 0.5, (0.5, 0.5))
            .expect("near light");
        assert!(s.delta && s.pdf == near && s.distance == 100.0);
        lights.per_point = false;
        let at = lights.select(Vec3::ZERO);
        assert!((lights.pmf(0, &at) - 0.5).abs() < 1.0e-6);
        assert!((lights.pmf(1, &at) - 0.5).abs() < 1.0e-6);
    }

    #[test]
    fn a_spot_is_chosen_only_where_its_cone_reaches() {
        // A spot aimed down at x and a panel above: inside the cone both may light x; outside it
        // the spot has no chance, and the panel takes it all.
        let spot = Light {
            kind: LightKind::Spot,
            spread_deg: 40.0,
            angle_deg: 5.0,
            ..point(Vec3::new(0.0, 0.0, 300.0), 20.0, 1.0)
        };
        let panel = rect(
            Vec3::new(0.0, 0.0, 2500.0),
            Vec3::new(0.0, 0.0, -1.0),
            1000.0,
            10.0,
        );
        let lights = Lights::new(&Scene {
            lights: vec![spot, panel],
            environment: black_env(),
            ..Scene::default()
        });
        let under = lights.select(Vec3::ZERO);
        assert!(lights.pmf(0, &under) > 0.5, "{}", lights.pmf(0, &under));
        let aside = lights.select(Vec3::new(800.0, 0.0, 0.0));
        assert_eq!(lights.pmf(0, &aside), 0.0);
        assert_eq!(lights.pmf(1, &aside), 1.0);
    }

    #[test]
    fn a_panel_seen_edge_on_keeps_a_chance() {
        // A 1 m panel facing up at the origin, and a point light to make the choice a choice.
        // A point in the panel's plane, beyond its rim, is edge on to its centre: a bound by the
        // centre's cosine alone would give the panel no chance there, and 1 mm above the plane,
        // where its rim lights the point at a grazing angle, next to none. The bound of the
        // reference (θu, the cone of the panel's points seen from x) keeps it in the choice,
        // and next-event estimation finds its light.
        let lights = Lights::new(&Scene {
            lights: vec![
                rect(Vec3::ZERO, Vec3::new(0.0, 0.0, 1.0), 1000.0, 10.0),
                point(Vec3::new(1500.0, 0.0, 400.0), 0.0, 10.0),
            ],
            environment: black_env(),
            ..Scene::default()
        });
        for x in [Vec3::new(1500.0, 0.0, 0.0), Vec3::new(1500.0, 0.0, 1.0)] {
            let at = lights.select(x);
            let pmf = lights.pmf(0, &at);
            assert!(pmf > 0.05, "{x:?}: {pmf}");
        }
        let x = Vec3::new(1500.0, 0.0, 1.0);
        let selection = lights.select(x);
        let mut found = 0;
        for i in 0..64 {
            let u = ((i % 8) as f32 / 8.0 + 0.0625, (i / 8) as f32 / 8.0 + 0.0625);
            if let Some(s) = lights.sample_selected(&selection, 0.01, u) {
                assert!(!s.delta && s.pdf > 0.0 && s.wi.z < 0.0);
                found += 1;
            }
        }
        assert_eq!(
            found, 64,
            "every point of the panel lights x from above its plane"
        );
        // Behind the panel, away from it, nothing of it can arrive: no chance at all.
        let behind = lights.select(Vec3::new(0.0, 0.0, -3000.0));
        assert_eq!(lights.pmf(0, &behind), 0.0);
        assert_eq!(lights.pmf(1, &behind), 1.0);
    }

    #[test]
    fn the_orientation_bound_holds_for_every_point_of_the_panel() {
        // Rects and disks in random orientations and points around them: the bound is never
        // below the cosine between the normal and the direction from any point of the panel to
        // x (checked on a grid of points over the panel), so the weight is not zero where the
        // panel can light x.
        let mut rng = crate::rng::Pcg32::seeded(12, 34);
        let mut r = || 2.0 * rng.next_f32() - 1.0;
        for case in 0..400 {
            let kind = if case % 2 == 0 {
                LightKind::Rect
            } else {
                LightKind::Disk
            };
            let light = Light {
                kind,
                position: Vec3::new(100.0 * r(), 100.0 * r(), 100.0 * r()),
                direction: Vec3::new(r(), r(), r()),
                up: Vec3::new(r(), r(), r()),
                size_x: 50.0 + 400.0 * r().abs(),
                size_y: 50.0 + 400.0 * r().abs(),
                ..Light::default()
            };
            let lights = Lights::new(&Scene {
                lights: vec![light],
                environment: black_env(),
                ..Scene::default()
            });
            let Some(panel) = lights.areas.first() else {
                continue;
            };
            let scale = if case % 3 == 0 { 200.0 } else { 2000.0 };
            let x = Vec3::new(scale * r(), scale * r(), scale * r());
            let v = x - panel.centre;
            let bound = panel.orientation(v, v.length_squared());
            let mut most = 0.0f32;
            for i in 0..=16 {
                for j in 0..=16 {
                    let p = panel.sample_point((i as f32 / 16.0, j as f32 / 16.0));
                    most = most.max((x - p).normalize().dot(panel.frame.z));
                }
            }
            assert!(bound >= most - 1.0e-5, "case {case}: {bound} < {most}");
            if most > 1.0e-5 {
                assert!(panel.weight(x) > 0.0, "case {case}");
            }
        }
    }

    #[test]
    fn the_orientation_bound_holds_for_every_face_of_a_one_sided_emitter() {
        // A one-sided cap of a sphere (its front faces look up and out, within some 60 degrees
        // of +Z) and points all around it: the bound from the cone of its normals is never below
        // the cosine between a front face's normal and the direction from a point of that face
        // to x. Two-sided, the same cap may face x from anywhere: the bound is 1.
        let sphere = crate::example::icosphere(Vec3::new(30.0, -20.0, 50.0), 200.0, 2);
        let positions: Vec<Vec3> = (0..sphere.vertex_count())
            .filter_map(|i| sphere.position(i))
            .collect();
        let indices: Vec<u32> = sphere
            .indices()
            .chunks(3)
            .filter(|t| {
                let c = (positions[t[0] as usize]
                    + positions[t[1] as usize]
                    + positions[t[2] as usize])
                    * (1.0 / 3.0);
                c.z - 50.0 > 100.0
            })
            .flatten()
            .copied()
            .collect();
        let cap = Mesh::new(&positions, &[], &indices, 0).expect("cap");
        let lights = |flags: u32| {
            Lights::new(&Scene {
                materials: vec![Material {
                    kind: MATERIAL_EMISSIVE,
                    emission: Rgb::WHITE,
                    emission_power: 1.0,
                    flags: MATERIAL_FLAG_LIGHT,
                    ..Material::default()
                }],
                geometry: crate::scene::Geometry::new(
                    vec![cap.clone()],
                    vec![crate::geometry::Instance {
                        flags,
                        ..crate::geometry::Instance::new(0, crate::geometry::Transform::IDENTITY, 0)
                    }],
                )
                .expect("geometry"),
                environment: black_env(),
                ..Scene::default()
            })
        };
        let one_sided = lights(INSTANCE_ONE_SIDED);
        let two_sided = lights(0);
        let emitter = &one_sided.meshes[0];
        assert!(
            emitter.cos_sin_o.0 > 0.3 && emitter.cos_sin_o.0 < 0.9,
            "{:?}",
            emitter.cos_sin_o
        );
        assert_eq!(two_sided.meshes[0].cos_sin_o.0, -1.0);
        let mut rng = crate::rng::Pcg32::seeded(7, 8);
        let mut r = || 2.0 * rng.next_f32() - 1.0;
        let mut lit = 0;
        for case in 0..300 {
            let scale = if case % 3 == 0 { 300.0 } else { 3000.0 };
            let x = emitter.centroid + Vec3::new(scale * r(), scale * r(), scale * r());
            let v = x - emitter.centroid;
            let bound = orientation_bound(
                v,
                v.length_squared(),
                emitter.axis,
                emitter.cos_sin_o,
                emitter.bound,
            );
            let mut most = 0.0f32;
            for (t, [a, b, c]) in emitter.corners.iter().enumerate() {
                for w in [
                    [1.0, 0.0, 0.0],
                    [0.0, 1.0, 0.0],
                    [0.0, 0.0, 1.0],
                    [1.0 / 3.0; 3],
                ] {
                    let p = *a * w[0] + *b * w[1] + *c * w[2];
                    most = most.max((x - p).normalize().dot(emitter.normals[t]));
                }
            }
            assert!(bound >= most - 1.0e-5, "case {case}: {bound} < {most}");
            if most > 1.0e-5 {
                assert!(emitter.weight(x) > 0.0, "case {case}");
                lit += 1;
            }
            assert!(two_sided.meshes[0].weight(x) > 0.0);
        }
        assert!(lit > 50 && lit < 300, "{lit}");
    }

    /// A scene with one light of every kind next-event estimation samples by area or solid
    /// angle, all found by BSDF rays too: two panels, a sphere light, a sun disc, an emissive
    /// quad sampled as a light and the studio dome.
    fn every_kind() -> Scene {
        let quad = Mesh::new(
            &[
                Vec3::new(-400.0, 300.0, 100.0),
                Vec3::new(-200.0, 300.0, 100.0),
                Vec3::new(-200.0, 300.0, 300.0),
                Vec3::new(-400.0, 300.0, 300.0),
            ],
            &[],
            &[0, 1, 2, 0, 2, 3],
            0,
        )
        .expect("quad");
        Scene {
            lights: vec![
                rect(
                    Vec3::new(0.0, 0.0, 800.0),
                    Vec3::new(0.0, 0.0, -1.0),
                    600.0,
                    20.0,
                ),
                Light {
                    kind: LightKind::Disk,
                    ..rect(
                        Vec3::new(700.0, 0.0, 300.0),
                        Vec3::new(-1.0, 0.0, -0.2),
                        300.0,
                        8.0,
                    )
                },
                Light {
                    kind: LightKind::Spot,
                    spread_deg: 120.0,
                    angle_deg: 20.0,
                    ..point(Vec3::new(-300.0, -300.0, 250.0), 80.0, 3.0)
                },
                Light {
                    kind: LightKind::Sun,
                    direction: Vec3::new(0.3, 0.2, -1.0),
                    power: 2.0,
                    angle_deg: 8.0,
                    ..Light::default()
                },
            ],
            materials: vec![Material {
                kind: MATERIAL_EMISSIVE,
                emission: Rgb::WHITE,
                emission_power: 4.0,
                flags: MATERIAL_FLAG_LIGHT,
                ..Material::default()
            }],
            geometry: crate::scene::Geometry::from_meshes(vec![quad]),
            ..Scene::default()
        }
    }

    #[test]
    fn next_event_estimation_and_bsdf_rays_agree_on_every_probability() {
        // MIS needs one density per light and direction, whichever technique found it. Here a
        // BSDF ray of the very density of a light sample, sent from the same vertex along the
        // sample's direction, must get the power heuristic's 1/2 for what it finds: the light's
        // density on the BSDF side (`crossed`, `escaped`, `emitter_weight`) is the sample's,
        // selection included.
        let lights = Lights::new(&every_kind());
        assert_eq!(lights.len(), 6);
        assert!(lights.per_point);
        let mut rng = crate::rng::Pcg32::seeded(5, 6);
        let mut checked = [0usize; 6];
        for _ in 0..4000 {
            let x = Vec3::new(
                600.0 * (rng.next_f32() - 0.5),
                400.0 * (rng.next_f32() - 0.5),
                10.0 + 50.0 * rng.next_f32(),
            );
            let selection = lights.select(x);
            let u_select = rng.next_f32();
            let u = (rng.next_f32(), rng.next_f32());
            let Some(s) = lights.sample_selected(&selection, u_select, u) else {
                continue;
            };
            if s.delta {
                continue;
            }
            // The entry chosen, by `pick` on what `build_cdf` makes of the weights at x (the
            // selection rebuilds that distribution entry by entry).
            let weights: Vec<f32> = (0..lights.len()).map(|e| lights.weight(e, x)).collect();
            let entry = pick(&build_cdf(&weights), u_select).0;
            let bsdf = Scattered::new(s.pdf, &selection);
            let ray = Ray::new(x, s.wi);
            // Only rays that cross the one light sampled (the sum would mix two weights).
            let crossings = lights
                .areas
                .iter()
                .filter(|l| l.intersect(&ray, f32::INFINITY).is_some())
                .count()
                + lights
                    .spheres
                    .iter()
                    .filter(|l| l.intersect(&ray, f32::INFINITY).is_some())
                    .count();
            let crosses_one = crossings == 1;
            let weight = match lights.entries[entry] {
                LightRef::Area(_) | LightRef::Sphere(_) if !crosses_one => continue,
                LightRef::Area(a) => {
                    let light = &lights.areas[a as usize];
                    let cos = -s.wi.dot(light.frame.z);
                    lights.crossed(&ray, f32::INFINITY, Some(bsdf)).g / light.radiance_at(cos).g
                }
                LightRef::Sphere(i) => {
                    let light = &lights.spheres[i as usize];
                    lights.crossed(&ray, f32::INFINITY, Some(bsdf)).g
                        / (light.radiance.g * light.mask(x))
                }
                LightRef::Sun(s0) => {
                    // What the sky adds beyond the environment is the sun disc.
                    let all = lights.escaped(s.wi, Some(bsdf)).g;
                    let env = lights.escaped_environment(s.wi, bsdf).g;
                    (all - env) / lights.suns[s0 as usize].radiance.g
                }
                LightRef::Environment => {
                    lights.escaped_environment(s.wi, bsdf).g / lights.env.radiance(s.wi).g
                }
                LightRef::Mesh(_) => {
                    let cos = s.wi.dot(Vec3::new(0.0, 1.0, 0.0));
                    lights.emitter_weight(0, bsdf, s.distance, cos)
                }
            };
            assert!(
                (weight - 0.5).abs() < 2.0e-3,
                "{:?} at {x:?}: {weight}",
                lights.entries[entry]
            );
            checked[entry] += 1;
        }
        assert!(checked.iter().all(|&n| n > 10), "{checked:?}");
    }

    #[test]
    fn beyond_sixty_four_lights_every_point_chooses_by_flux() {
        // Up to MAX_LOCAL_LIGHTS entries the choice is per point; one more and it is the static
        // one, for next-event estimation and for the MIS weights alike.
        let row = |n: usize| -> Vec<Light> {
            (0..n)
                .map(|i| point(Vec3::new(100.0 * i as f32, 0.0, 200.0), 0.0, 1.0))
                .collect()
        };
        for (n, per_point) in [(MAX_LOCAL_LIGHTS, true), (MAX_LOCAL_LIGHTS + 1, false)] {
            let lights = Lights::new(&Scene {
                lights: row(n),
                environment: black_env(),
                ..Scene::default()
            });
            assert_eq!((lights.len(), lights.per_point), (n, per_point));
            let x = Vec3::new(0.0, 0.0, 0.0);
            let s = lights.sample(x, 0.0, (0.5, 0.5)).expect("the first light");
            let at = lights.select(x);
            assert_eq!(s.pdf, lights.pmf(0, &at));
            if per_point {
                // The one straight above x weighs most.
                assert!(s.pdf > 0.2, "{}", s.pdf);
            } else {
                assert_eq!(s.pdf, lights.cdf[0]);
                assert!(s.pdf < 0.1, "{}", s.pdf);
            }
        }
    }

    #[test]
    fn one_light_is_chosen_with_probability_one_wherever_it_can_light() {
        // With a single entry the choice is certain, as it was by flux: the densities, and so
        // the pixels, of a scene with one light are those of before E12 (the render tests
        // compare whole films).
        for scene in [
            Scene {
                lights: vec![rect(
                    Vec3::new(0.0, 0.0, 800.0),
                    Vec3::new(0.0, 0.0, -1.0),
                    600.0,
                    20.0,
                )],
                environment: black_env(),
                ..Scene::default()
            },
            Scene {
                lights: vec![point(Vec3::new(0.0, 0.0, 300.0), 40.0, 3.0)],
                environment: black_env(),
                ..Scene::default()
            },
            Scene::default(),
        ] {
            let mut lights = Lights::new(&scene);
            assert_eq!(lights.len(), 1);
            // By flux it costs nothing, so a single entry is chosen that way; per point (forced
            // here) it is the same certainty.
            assert!(!lights.per_point);
            lights.per_point = true;
            for x in [Vec3::ZERO, Vec3::new(123.0, -45.0, 6.0)] {
                let at = lights.select(x);
                assert_eq!(lights.pmf(0, &at), 1.0);
            }
        }
    }
}
