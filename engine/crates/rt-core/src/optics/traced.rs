//! The traced lens (O2): a camera ray is traced from the sensor through the real surfaces of a
//! prescription, after A. Kolb, D. Mitchell and P. Hanrahan, "A Realistic Camera Model for
//! Computer Graphics", SIGGRAPH 1995, and `docs/research/optics.md` §3 and §6.
//!
//! * **Surfaces** (`LENS` trailing fields, [`SurfaceSpec`]): sphere, plane, even asphere (conic
//!   and A4 to A10), cylinder (power in one meridian) and mirror (the light turns back; the
//!   distances after it are negative, the catadioptric lens is one unfolded sequence); one of
//!   them is the aperture stop, where the iris is (blades, roundness, rotation and the central
//!   obstruction of [`crate::optics::LensParams`]). Every length is scaled by one factor so that
//!   the paraxial focal length is the camera's `focal_mm`.
//! * **Intersection**: from the tangent plane of the vertex, the stable root of §6.5,
//!   `t = c r² / (B + sign(B) sqrt(B² − c² r²))` with `B = N − c (x L + y M)`, and the unit
//!   normal `(c x, c y, c z − 1)` without a square root; an asphere refines the sphere's point
//!   with a fixed number of Newton steps on its sag. Refraction is the vector form of Snell's law;
//!   total internal reflection, a surface missed or a point outside a semi-aperture blocks the ray.
//!   Only `+ − × ÷ sqrt`: the same bits on every platform.
//! * **Glass**: the index of each band from `nd` and `vd` by the two-term Cauchy fit of §3.3
//!   (`n = A + B / λ²` through the d, F and C lines), at the band's wavelength
//!   ([`BAND_WAVELENGTHS_UM`]). The artistic chromatic aberration multiplies `B`.
//! * **Focus** (`focus_mode`): *unit* moves the whole lens (the sensor sits where the paraxial
//!   image of the focus point falls); *internal* moves the listed gaps between their two states
//!   (bisection on the fraction) with the sensor where infinity focuses; *floating* is unit focus
//!   with the listed gaps following the magnification between the two states. The focal length
//!   changes as the gaps move: focus breathing comes out of the trace.
//! * **Pupil**: the camera position is the paraxial entrance pupil at infinity focus, so the
//!   perspective is the thin lens's; the stop radius gives the requested f-number (never faster
//!   than the lens), from the entrance pupil of the focused lens. For every image height (32
//!   bins up to beyond the sensor's corner) a grid on the plane of the rear vertex is traced in
//!   the three bands at load time; the rectangle around what passes (one cell wider) is where a
//!   sample goes (§3.5), turned to the sample's azimuth. Surfaces without a semi-aperture in the
//!   source get one from a paraxial marginal ray at full aperture plus a chief ray to the
//!   corner of a 36 × 24 frame.
//! * **Radiometry**: a sample weighs `A cos⁴θ / Z²` (Kolb eq. 6, the area `A` of its rectangle)
//!   over the same integral on the axis, so the centre of the frame is exposed as by the thin lens
//!   and the falloff (natural and mechanical vignetting) is the lens's. The coatings make the
//!   per-surface transmittance (`1 − R` per air–glass surface; uncoated by Fresnel, single and
//!   multi-layer by the band values of §4.1); the image keeps its brightness and gets the tint
//!   (each band over the luminance of the three), and the T-stop is reported. No ghosts (decision
//!   5 of the lead).
//! * **Bands** (decision 3): every sample takes one band, stratified per pixel, traces with its
//!   indices and weighs its channel.

use super::paraxial;
use super::pupil::Iris;
use crate::math::Vec3;

/// `SurfaceSpec.kind`: a sphere.
pub const SURFACE_SPHERE: u32 = 0;
/// A plane.
pub const SURFACE_PLANE: u32 = 1;
/// An even asphere: conic and A4 to A10.
pub const SURFACE_ASPHERE: u32 = 2;
/// A cylinder whose axis (the straight generator) is x: power in the y meridian.
pub const SURFACE_CYLINDER_X: u32 = 3;
/// A cylinder whose axis is y: power in the x meridian.
pub const SURFACE_CYLINDER_Y: u32 = 4;
/// A mirror (spherical, or plane with radius 0).
pub const SURFACE_MIRROR: u32 = 5;

/// `SurfaceSpec.coating`: not an air–glass surface (cemented, a stop, a mirror).
pub const COATING_NONE: u32 = 0;
/// Uncoated air–glass surface: Fresnel at normal incidence.
pub const COATING_UNCOATED: u32 = 1;
/// A single quarter-wave layer of magnesium fluoride.
pub const COATING_SINGLE: u32 = 2;
/// A multi-layer coating.
pub const COATING_MULTI: u32 = 3;

/// `focus_mode`: the whole lens moves.
pub const FOCUS_UNIT: u32 = 0;
/// The listed gaps move; the lens does not.
pub const FOCUS_INTERNAL: u32 = 1;
/// The whole lens moves and the listed gaps float with the magnification.
pub const FOCUS_FLOATING: u32 = 2;
/// An anamorphic adapter in front of a lens: the whole lens moves (the master's focus, in the
/// vertical meridian) and the listed gap of the adapter follows, so that the squeezed (horizontal)
/// meridian focuses at the same distance, as the focus ring of a front adapter does.
pub const FOCUS_ANAMORPHIC: u32 = 3;

/// Wavelengths of the three bands, micrometres (R, G, B): near the middle of each channel.
pub const BAND_WAVELENGTHS_UM: [f32; 3] = [0.610, 0.545, 0.465];
/// The bands' share of luminance (Rec. 709).
const LUMA: [f32; 3] = [0.2126, 0.7152, 0.0722];
/// Fraunhofer d, F and C lines, micrometres.
const LAMBDA_D: f32 = 0.587_56;
const LAMBDA_F: f32 = 0.486_13;
const LAMBDA_C: f32 = 0.656_27;

/// Image-height bins of the exit-pupil bounds.
pub const PUPIL_BINS: usize = 32;
/// Cells per side of the grid traced for each bin.
pub const PUPIL_GRID: usize = 24;
/// Cells per side of the grid over a bin's rectangle that measures its irradiance.
pub const IRRADIANCE_GRID: usize = 40;
/// Newton steps of an aspheric intersection.
const ASPHERE_STEPS: usize = 8;
/// Image heights of the fast profile (distortion, relative illumination).
pub const PROFILE_POINTS: usize = 16;

/// One surface of a prescription, as the `LENS` section holds it.
#[derive(Clone, Debug, PartialEq)]
pub struct SurfaceSpec {
    /// `SURFACE_*`.
    pub kind: u32,
    /// Radius of curvature, mm (0: plane).
    pub radius: f32,
    /// Distance to the next surface, mm, negative while the light travels back after a mirror.
    pub thickness: f32,
    /// d-line index of the medium after the surface (1: air).
    pub nd: f32,
    /// Abbe number of that medium (ignored for air).
    pub vd: f32,
    /// Clear semi-aperture, mm (0: not given; derived).
    pub semi_aperture: f32,
    /// `COATING_*`.
    pub coating: u32,
    /// Conic constant of an asphere.
    pub conic: f32,
    /// A4, A6, A8 and A10 of an asphere.
    pub aspheric: [f32; 4],
}

/// A gap that moves to focus (or floats).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct MovingGap {
    /// The surface whose `thickness` changes.
    pub surface: u32,
    /// Its value in the prescription's own state (infinity, or the base magnification).
    pub base: f32,
    /// Its value in the near state.
    pub near: f32,
}

/// The prescription of a traced lens and its artistic overrides (each 0: off).
#[derive(Clone, Debug, PartialEq)]
pub struct Prescription {
    /// The index of the aperture stop among the surfaces (a plane, or the mirror lens's primary).
    pub stop: u32,
    /// `FOCUS_*`.
    pub focus_mode: u32,
    /// The fastest f-number of the lens (0: what the stop's semi-aperture allows, or none).
    pub f_number_min: f32,
    /// Floating focus: the magnifications of the base and near states.
    pub magnification: (f32, f32),
    /// Artistic: barrel (negative) or pincushion (positive) distortion, −1 to 1.
    pub distortion: f32,
    /// Artistic: extra falloff towards the corner, 0 to 1.
    pub vignetting: f32,
    /// Artistic: spherical aberration from an aspheric plate at the stop, −1 (under) to 1 (over).
    pub spherical: f32,
    /// Artistic: focus breathing, −1 (none) to 1 (twice the lens's).
    pub breathing: f32,
    /// The gaps that move.
    pub moving: Vec<MovingGap>,
    /// The surfaces, object side first.
    pub surfaces: Vec<SurfaceSpec>,
}

/// A surface ready to trace (scaled, with its band indices and position).
#[derive(Clone, Debug, PartialEq)]
pub struct Surface {
    /// `SURFACE_*`.
    pub kind: u32,
    /// Curvature 1 / R (0: plane).
    pub curvature: f32,
    /// Distance to the next surface (scaled).
    pub thickness: f32,
    /// Index of the medium after the surface in each band (R, G, B).
    pub index: [f32; 3],
    /// Semi-aperture (scaled; 0: no limit).
    pub semi_aperture: f32,
    /// Conic constant and A4..A10 (scaled).
    pub conic: f32,
    /// Aspheric coefficients, scaled to millimetres.
    pub aspheric: [f32; 4],
    /// Transmittance of the surface per band.
    pub transmittance: [f32; 3],
}

/// What the engine computes of a traced lens (rule 10: the interface shows these, never its own).
#[derive(Clone, Debug, PartialEq)]
pub struct LensInfo {
    /// Paraxial focal length at infinity focus, mm (the camera's `focal_mm`).
    pub efl_mm: f32,
    /// Back focal distance at infinity, from the rear vertex, mm.
    pub bfl_mm: f32,
    /// Focal length at the focus distance (breathing), mm.
    pub efl_focused_mm: f32,
    /// The f-number in use (the requested one, never faster than the lens).
    pub f_number: f32,
    /// The fastest f-number of the lens.
    pub f_number_min: f32,
    /// The T-stop: the f-number over the square root of the transmittance.
    pub t_stop: f32,
    /// Transmittance of the lens per band (R, G, B).
    pub transmittance: [f32; 3],
    /// Distance from the first to the last vertex, mm.
    pub length_mm: f32,
    /// Entrance pupil: distance behind the first vertex, mm, and diameter.
    pub entrance_pupil_mm: (f32, f32),
    /// Glass elements and groups (cemented ones count as one group).
    pub elements: u32,
    /// See `elements`.
    pub groups: u32,
    /// Distortion, percent, against image height (mm on the sensor).
    pub distortion: Vec<(f32, f32)>,
    /// Relative illumination against image height.
    pub relative_illumination: Vec<(f32, f32)>,
    /// The sensor's position behind the rear vertex, mm (the focus).
    pub sensor_mm: f32,
    /// An anamorphic lens's squeeze at its focus (1 without cylinders).
    pub squeeze: f32,
}

/// What a traced lens is prepared for: the camera's optics (not where it is or looks).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct CameraOptics {
    /// Focal length the prescription is scaled to, mm.
    pub focal_mm: f32,
    /// Requested f-number (0: wide open).
    pub fstop: f32,
    /// Focus distance from the camera position (the entrance pupil), mm.
    pub focus_dist: f32,
    /// Sensor size along the longer image side, mm.
    pub sensor_mm: f32,
}

/// The two-term Cauchy coefficients `(A, B)` of a glass (`n = A + B / λ²`, λ in µm) through its
/// d, F and C lines; air (nd 1) is `(1, 0)`.
pub fn cauchy(nd: f32, vd: f32) -> (f32, f32) {
    if nd <= 1.0 || vd <= 0.0 {
        return (nd.max(1.0), 0.0);
    }
    let b = (nd - 1.0) / (vd * (1.0 / (LAMBDA_F * LAMBDA_F) - 1.0 / (LAMBDA_C * LAMBDA_C)));
    (nd - b / (LAMBDA_D * LAMBDA_D), b)
}

/// The index of a glass in each band, with its dispersion multiplied by `dispersion`.
pub fn band_indices(nd: f32, vd: f32, dispersion: f32) -> [f32; 3] {
    let (_, b) = cauchy(nd, vd);
    let b = b * dispersion;
    let a = nd - b / (LAMBDA_D * LAMBDA_D);
    let mut out = [nd; 3];
    if b != 0.0 {
        for (o, &l) in out.iter_mut().zip(&BAND_WAVELENGTHS_UM) {
            *o = a + b / (l * l);
        }
    }
    out
}

/// Reflectance per band of an air–glass surface of index `n` (per band) with a coating.
pub fn reflectance(coating: u32, n: [f32; 3]) -> [f32; 3] {
    match coating {
        COATING_UNCOATED => n.map(|n| {
            let r = (n - 1.0) / (n + 1.0);
            r * r
        }),
        COATING_SINGLE => {
            // A quarter wave of MgF2 (1.38) at 550 nm: ((nc² − ns) / (nc² + ns))² there, and
            // the colour of its residual at the band edges from the transfer-matrix table of
            // research §4.1 (n 1.52: 1.44 %, 1.26 %, 1.62 % at 650, 550 and 450 nm).
            let nc2 = 1.38f32 * 1.38;
            let g = n[1];
            let r = (nc2 - g) / (nc2 + g);
            let base = r * r;
            [base * (1.44 / 1.26), base, base * (1.62 / 1.26)]
        }
        COATING_MULTI => [0.0007, 0.0009, 0.0025],
        _ => [0.0; 3],
    }
}

/// Unit vector in the direction of `v` (the zero vector unchanged).
fn unit(v: Vec3) -> Vec3 {
    v.normalize()
}

/// Snell's law in vector form: `d` (unit) through a surface of unit normal `n` (either side) from
/// index ratio `eta = n1 / n2`; `None` on total internal reflection.
pub fn refract(d: Vec3, n: Vec3, eta: f32) -> Option<Vec3> {
    let mut normal = n;
    let mut cos_i = -d.dot(normal);
    if cos_i < 0.0 {
        normal = -normal;
        cos_i = -cos_i;
    }
    let k = 1.0 - eta * eta * (1.0 - cos_i * cos_i);
    if k < 0.0 {
        return None;
    }
    Some(d * eta + normal * (eta * cos_i - k.sqrt()))
}

/// The sag of an even asphere and its derivative at radius `r`; `None` past the conic's rim.
fn asphere_sag(s: &Surface, r: f32) -> Option<(f32, f32)> {
    let c = s.curvature;
    let r2 = r * r;
    let q = 1.0 - (1.0 + s.conic) * c * c * r2;
    if q < 0.0 {
        return None;
    }
    let root = q.sqrt();
    let mut z = c * r2 / (1.0 + root);
    let mut dz = if root > 0.0 { c * r / root } else { 0.0 };
    let mut rp = r2 * r; // r^3
    let mut rk = r2 * r2; // r^4
    for (k, &a) in s.aspheric.iter().enumerate() {
        let order = (2 * k + 4) as f32;
        z += a * rk;
        dz += a * order * rp;
        rk *= r2;
        rp *= r2;
    }
    Some((z, dz))
}

/// The point where a ray from `p` along `d` meets surface `s` whose vertex is at `zv`, relative to
/// the vertex `(x, y, z)`, and the surface's unit normal there (facing −z at the vertex).
fn intersect(s: &Surface, zv: f32, p: Vec3, d: Vec3) -> Option<(Vec3, Vec3)> {
    if d.z == 0.0 {
        return None;
    }
    // To the tangent plane of the vertex.
    let t0 = (zv - p.z) / d.z;
    let x0 = p.x + d.x * t0;
    let y0 = p.y + d.y * t0;
    let c = s.curvature;
    if c == 0.0 || s.kind == SURFACE_PLANE {
        return Some((Vec3::new(x0, y0, 0.0), Vec3::new(0.0, 0.0, -1.0)));
    }
    // The stable root of §6.5 (the intersection nearest the vertex plane), on the meridian(s)
    // that have power.
    let (r2, dot) = match s.kind {
        SURFACE_CYLINDER_Y => (x0 * x0, x0 * d.x),
        SURFACE_CYLINDER_X => (y0 * y0, y0 * d.y),
        _ => (x0 * x0 + y0 * y0, x0 * d.x + y0 * d.y),
    };
    let b = d.z - c * dot;
    let disc = b * b - c * c * r2;
    if disc < 0.0 {
        return None;
    }
    let root = disc.sqrt();
    let den = if b >= 0.0 { b + root } else { b - root };
    if den == 0.0 {
        return None;
    }
    let mut t = c * r2 / den;
    let mut q = Vec3::new(x0 + d.x * t, y0 + d.y * t, d.z * t);
    if s.kind == SURFACE_ASPHERE {
        // Newton on z(t) − sag(r(t)), from the sphere's point.
        for _ in 0..ASPHERE_STEPS {
            let r = (q.x * q.x + q.y * q.y).sqrt();
            let (sag, dsag) = asphere_sag(s, r)?;
            let f = q.z - sag;
            let drdt = if r > 0.0 {
                (q.x * d.x + q.y * d.y) / r
            } else {
                0.0
            };
            let df = d.z - dsag * drdt;
            if df == 0.0 {
                break;
            }
            t -= f / df;
            q = Vec3::new(x0 + d.x * t, y0 + d.y * t, d.z * t);
        }
        let r = (q.x * q.x + q.y * q.y).sqrt();
        let (_, dsag) = asphere_sag(s, r)?;
        let (gx, gy) = if r > 0.0 {
            (dsag * q.x / r, dsag * q.y / r)
        } else {
            (0.0, 0.0)
        };
        return Some((q, unit(Vec3::new(gx, gy, -1.0))));
    }
    let normal = match s.kind {
        SURFACE_CYLINDER_Y => Vec3::new(c * q.x, 0.0, c * q.z - 1.0),
        SURFACE_CYLINDER_X => Vec3::new(0.0, c * q.y, c * q.z - 1.0),
        _ => Vec3::new(c * q.x, c * q.y, c * q.z - 1.0),
    };
    Some((q, normal))
}

/// How a traced ray ended.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Traced {
    /// It left the front of the lens at `origin` along `dir` (lens frame).
    Out {
        /// Where it left the first surface.
        origin: Vec3,
        /// Its direction, unit.
        dir: Vec3,
    },
    /// A rim, the iris, a missed surface or total internal reflection stopped it.
    Blocked,
}

/// A traced lens prepared for one camera.
#[derive(Clone, Debug, PartialEq)]
pub struct TracedLens {
    /// The surfaces, scaled, with their band indices and transmittances.
    surfaces: Vec<Surface>,
    /// The vertices' positions along the axis (the first at 0), focused.
    z: Vec<f32>,
    /// The aperture stop.
    stop: usize,
    /// Its radius for the f-number in use.
    stop_radius: f32,
    /// The iris (blades, roundness, rotation), circumradius 1.
    iris: Iris,
    /// Central obstruction, as a fraction of the stop radius.
    obstruction: f32,
    /// The sensor plane's position.
    sensor_z: f32,
    /// The camera position on the axis (the entrance pupil at infinity focus).
    pupil_z: f32,
    /// Radius of the rear plane where samples are drawn.
    rear_radius: f32,
    /// Image height per bin of the bounds.
    bin: f32,
    /// Per bin, the rectangle `[x0, x1, y0, y1]` on the rear vertex plane that the rays of a film
    /// point on +x at that height pass through (empty: `x1 < x0`).
    bounds: Vec<[f32; 4]>,
    /// Per bin, where the chief ray of a film point on +x crosses the rear plane (x).
    chief_x: Vec<f32>,
    /// The on-axis integral of `cos⁴θ / Z²` over what passes.
    normaliser: f32,
    /// The colour of the lens's transmittance, luminance 1.
    tint: [f32; 3],
    /// Artistic spherical aberration: the slope change per r³ at the stop.
    plate: f32,
    /// Artistic distortion: `k` of `r (1 + k (r / field)²)` on the sensor.
    distortion: f32,
    /// Artistic vignetting: `1 − v (r / field)²`.
    vignetting: f32,
    /// Sensor scale of the breathing override.
    breathing: f32,
    /// The image height of the frame's corner, for the overrides, mm.
    field: f32,
    /// An anamorphic lens's squeeze as traced at its focus (the horizontal over the vertical
    /// magnification near the axis), what the image is desqueezed by; 0 for a lens without
    /// cylinders.
    squeeze: f32,
    /// What the engine reports.
    info: LensInfo,
    /// What it was prepared for.
    key: CameraOptics,
}

/// A prescription scaled and with its band indices, before focusing.
struct Built {
    surfaces: Vec<Surface>,
    stop: usize,
    efl: f32,
    moving: Vec<MovingGap>,
}

fn positions(surfaces: &[Surface]) -> Vec<f32> {
    let mut z = Vec::with_capacity(surfaces.len());
    let mut at = 0.0f32;
    for s in surfaces {
        z.push(at);
        at += s.thickness;
    }
    z
}

fn with_gaps(surfaces: &[Surface], moving: &[MovingGap], t: f32) -> Vec<Surface> {
    let mut out = surfaces.to_vec();
    for m in moving {
        if let Some(s) = out.get_mut(m.surface as usize) {
            s.thickness = m.base + (m.near - m.base) * t;
        }
    }
    out
}

impl TracedLens {
    /// Checks a prescription, scales it to the camera's focal length, focuses it, sizes the stop
    /// and precomputes the pupil bounds and the fast profile.
    pub fn new(
        p: &Prescription,
        lens: &super::LensParams,
        camera: CameraOptics,
    ) -> Result<TracedLens, &'static str> {
        let built = build(p, lens, camera.focal_mm)?;
        prepare(built, p, lens, camera)
    }

    /// The camera this lens was prepared for.
    pub fn key(&self) -> CameraOptics {
        self.key
    }

    /// What the engine computed of the lens.
    pub fn info(&self) -> &LensInfo {
        &self.info
    }

    /// An anamorphic lens's squeeze as traced at its focus, `None` for a lens without cylinders.
    pub fn squeeze(&self) -> Option<f32> {
        (self.squeeze > 0.0).then_some(self.squeeze)
    }

    /// The camera position on the axis (lens frame): the entrance pupil at infinity focus.
    pub fn pupil_z(&self) -> f32 {
        self.pupil_z
    }

    /// Traces a ray from `p` (behind the lens) along `d` (unit) back through every surface in the
    /// band `band`, checking rims and the iris when `clip`.
    pub fn trace(&self, p: Vec3, d: Vec3, band: usize, clip: bool) -> Traced {
        let n = self.surfaces.len();
        let mut p = p;
        let mut d = d;
        let mut n_cur = self.surfaces[n - 1].index[band];
        for i in (0..n).rev() {
            let s = &self.surfaces[i];
            let zv = self.z[i];
            let Some((q, normal)) = intersect(s, zv, p, d) else {
                return Traced::Blocked;
            };
            if clip {
                let r2 = q.x * q.x + q.y * q.y;
                if s.semi_aperture > 0.0 && r2 > s.semi_aperture * s.semi_aperture {
                    return Traced::Blocked;
                }
                if i == self.stop {
                    let (x, y) = (q.x / self.stop_radius, q.y / self.stop_radius);
                    if self.iris.signed_distance(x, y) > 0.0
                        || (self.obstruction > 0.0 && self.iris.gauge(x, y) < self.obstruction)
                    {
                        return Traced::Blocked;
                    }
                }
            }
            p = Vec3::new(q.x, q.y, zv + q.z);
            if s.kind == SURFACE_MIRROR {
                d = d - normal * (2.0 * d.dot(normal));
            } else {
                let n_next = if i == 0 {
                    1.0
                } else {
                    self.surfaces[i - 1].index[band]
                };
                if n_next != n_cur {
                    match refract(d, normal, n_cur / n_next) {
                        Some(t) => d = t,
                        None => return Traced::Blocked,
                    }
                    n_cur = n_next;
                }
            }
            if i == self.stop && self.plate != 0.0 {
                // The aspheric plate of the spherical-aberration override: a radial slope change
                // of −4 (n − 1) A r³ with n − 1 folded into `plate`.
                let r2 = q.x * q.x + q.y * q.y;
                d = unit(Vec3::new(
                    d.x - self.plate * r2 * q.x,
                    d.y - self.plate * r2 * q.y,
                    d.z,
                ));
            }
        }
        Traced::Out { origin: p, dir: d }
    }
}

/// Checks a prescription and scales it to `focal_mm`, with its band indices and transmittances.
fn build(p: &Prescription, lens: &super::LensParams, focal_mm: f32) -> Result<Built, &'static str> {
    let n = p.surfaces.len();
    if !(2..=64).contains(&n) {
        return Err("a prescription has 2 to 64 surfaces");
    }
    let stop = p.stop as usize;
    if stop >= n {
        return Err("the stop is not one of the surfaces");
    }
    if focal_mm.is_nan() || focal_mm <= 0.0 {
        return Err("the focal length must be positive");
    }
    let dispersion = 1.0 + 3.0 * lens.ca_amount;
    let mut surfaces = Vec::with_capacity(n);
    for (i, s) in p.surfaces.iter().enumerate() {
        if s.kind > SURFACE_MIRROR {
            return Err("unknown surface kind");
        }
        if !(1.0..=3.0).contains(&s.nd) || s.vd < 0.0 || s.semi_aperture < 0.0 {
            return Err(
                "a surface has an index outside 1 to 3, or a negative Abbe number or semi-aperture",
            );
        }
        if s.coating > COATING_MULTI {
            return Err("unknown coating");
        }
        let plane = s.radius == 0.0 || s.kind == SURFACE_PLANE;
        if s.kind == SURFACE_MIRROR && i > 0 && p.surfaces[i - 1].nd != s.nd {
            return Err("a mirror keeps the medium it reflects in");
        }
        surfaces.push(Surface {
            kind: if plane && s.kind != SURFACE_MIRROR {
                SURFACE_PLANE
            } else {
                s.kind
            },
            curvature: if plane { 0.0 } else { 1.0 / s.radius },
            thickness: s.thickness,
            index: band_indices(s.nd, s.vd, dispersion),
            semi_aperture: s.semi_aperture,
            conic: s.conic,
            aspheric: s.aspheric,
            transmittance: [1.0; 3],
        });
    }
    if p.focus_mode > FOCUS_ANAMORPHIC {
        return Err("unknown focus mode");
    }
    for m in &p.moving {
        if m.surface as usize >= n - 1 || !(m.base >= 0.0 && m.near >= 0.0) {
            return Err("a moving gap is not a gap of the prescription");
        }
    }
    if p.surfaces[n - 1].nd != 1.0 {
        return Err("a lens ends in air");
    }
    let (efl, _) = paraxial::efl_bfl(&surfaces, 1).ok_or("the prescription is afocal")?;
    if !efl.is_finite() || efl <= 0.0 {
        return Err("the prescription does not form a real image");
    }
    let k = focal_mm / efl;
    for s in &mut surfaces {
        s.curvature /= k;
        s.thickness *= k;
        s.semi_aperture *= k;
        // z = A r^(2j + 4) scaled: z' = k z at r' = k r.
        let mut f = k * k * k;
        for a in &mut s.aspheric {
            *a /= f;
            f *= k * k;
        }
    }
    // Transmittance of each air-glass surface (the glass side's index).
    for i in 0..n {
        let coating = p.surfaces[i].coating;
        if coating == COATING_NONE {
            continue;
        }
        let after = surfaces[i].index;
        let before = if i == 0 {
            [1.0; 3]
        } else {
            surfaces[i - 1].index
        };
        let glass = if after[1] > before[1] { after } else { before };
        let r = reflectance(coating, glass);
        surfaces[i].transmittance = [1.0 - r[0], 1.0 - r[1], 1.0 - r[2]];
    }
    let moving = p
        .moving
        .iter()
        .map(|m| MovingGap {
            surface: m.surface,
            base: m.base * k,
            near: m.near * k,
        })
        .collect();
    Ok(Built {
        surfaces,
        stop,
        efl: focal_mm,
        moving,
    })
}

/// The axial image distance past the last vertex of `surfaces` for an object `distance` in front
/// of the first vertex (infinity for a non-positive or infinite distance), and the lateral
/// magnification; `None` when the image is not real.
fn focus_of(surfaces: &[Surface], distance: f32) -> Option<(f32, f32)> {
    let far = !(distance > 0.0 && distance.is_finite());
    let image = paraxial::image_distance(surfaces, 1, if far { f32::INFINITY } else { distance })?;
    if !image.is_finite() || image <= 0.0 {
        return None;
    }
    // Lateral magnification: an object point 1 above the axis, its chief-free ray through the
    // first vertex; simpler from the ratio of the conjugate slopes of an axial ray.
    let m = if far {
        0.0
    } else {
        let mut h = Vec::new();
        let out = paraxial::trace_forward(
            surfaces,
            1,
            0,
            paraxial::ParaxialRay {
                y: 1.0,
                u: 1.0 / distance,
            },
            &mut h,
        );
        ((1.0 / distance) / out.u).abs()
    };
    Some((image, m))
}

fn prepare(
    built: Built,
    p: &Prescription,
    lens: &super::LensParams,
    camera: CameraOptics,
) -> Result<TracedLens, &'static str> {
    let Built {
        surfaces: base,
        stop,
        efl,
        moving,
    } = built;
    let n = base.len();
    let z_base = positions(&base);
    // The marginal ray at infinity: its height at the stop sizes the stop for an f-number.
    let mut heights = Vec::new();
    paraxial::trace_forward(
        &base,
        1,
        0,
        paraxial::ParaxialRay { y: 1.0, u: 0.0 },
        &mut heights,
    );
    let at_stop = heights[stop].abs().max(1.0e-6);
    let stop_semi = base[stop].semi_aperture;
    let n_min = if p.f_number_min > 0.0 {
        p.f_number_min
    } else if stop_semi > 0.0 {
        efl / (2.0 * stop_semi / at_stop)
    } else {
        0.0
    };
    let requested = if camera.fstop > 0.0 {
        camera.fstop
    } else {
        n_min
    };
    let f_number = if requested > 0.0 {
        requested.max(n_min)
    } else {
        2.8
    };
    let n_full = if n_min > 0.0 { n_min } else { f_number };
    let stop_radius = efl / (2.0 * f_number) * at_stop;
    // Semi-apertures the source does not give: the beam of the frame's corner at full aperture.
    let corner = 0.6 * camera.sensor_mm;
    let (marginal, chief) = paraxial::marginal_and_chief(&base, &z_base, stop, 1, corner / efl);
    let pupil_full = efl / (2.0 * n_full);
    let mut surfaces = base;
    for (i, s) in surfaces.iter_mut().enumerate() {
        if s.semi_aperture == 0.0 {
            s.semi_aperture = if i == stop {
                pupil_full * at_stop
            } else {
                1.02 * (marginal[i].abs() * pupil_full + chief[i].abs())
            };
        }
    }
    // The camera position: the entrance pupil at infinity focus.
    let (pupil_z, _) = paraxial::entrance_pupil(&surfaces, &z_base, stop, 1);
    // Focus: the object `focus_dist` in front of the camera position.
    let object = camera.focus_dist - (pupil_z - z_base[0]);
    let last = |s: &[Surface]| positions(s)[n - 1];
    let (_, infinity) = (
        0,
        focus_of(&surfaces, f32::INFINITY).ok_or("no real image at infinity")?,
    );
    let sensor_far = z_base[n - 1] + infinity.0;
    let mut t = 0.0f32;
    let sensor_z = match p.focus_mode {
        FOCUS_INTERNAL if !moving.is_empty() => {
            let miss = |t: f32| -> Option<f32> {
                let s = with_gaps(&surfaces, &moving, t);
                let (img, _) = focus_of(&s, object)?;
                Some(last(&s) + img - sensor_far)
            };
            let (mut lo, mut hi) = (0.0f32, 2.0f32);
            match (miss(lo), miss(hi)) {
                (Some(a), Some(b)) if a.signum() != b.signum() => {
                    for _ in 0..40 {
                        let mid = 0.5 * (lo + hi);
                        match miss(mid) {
                            Some(m) if m.signum() == a.signum() => lo = mid,
                            _ => hi = mid,
                        }
                    }
                    t = 0.5 * (lo + hi);
                    sensor_far
                }
                _ => {
                    // Closer than the gaps reach: the furthest state, then the whole lens moves.
                    t = if miss(0.0).is_some_and(|m| m.abs() < 1.0e-3) {
                        0.0
                    } else {
                        2.0
                    };
                    let s = with_gaps(&surfaces, &moving, t);
                    let (img, _) = focus_of(&s, object).unwrap_or(infinity);
                    last(&s) + img
                }
            }
        }
        FOCUS_ANAMORPHIC if !moving.is_empty() => {
            // The vertical meridian focuses as one unit; the adapter's gap brings the horizontal
            // one to the same image, both from the moved lens (the front vertex stays).
            let focus_y = |s: &[Surface]| focus_of(s, object).map(|(img, _)| last(s) + img);
            let miss = |t: f32| -> Option<f32> {
                let s = with_gaps(&surfaces, &moving, t);
                let x = paraxial::image_distance_in(&s, 1, object, true)?;
                Some(last(&s) + x - focus_y(&s)?)
            };
            let (mut lo, mut hi) = (0.0f32, 2.0f32);
            t = match (miss(lo), miss(hi)) {
                (Some(a), _) if a.abs() < 1.0e-4 => 0.0,
                (Some(a), Some(b)) if a.signum() != b.signum() => {
                    for _ in 0..40 {
                        let mid = 0.5 * (lo + hi);
                        match miss(mid) {
                            Some(m) if m.signum() == a.signum() => lo = mid,
                            _ => hi = mid,
                        }
                    }
                    0.5 * (lo + hi)
                }
                // Beyond what the gap reaches: the adapter stays afocal.
                _ => 0.0,
            };
            let s = with_gaps(&surfaces, &moving, t);
            focus_y(&s).unwrap_or(z_base[n - 1] + infinity.0)
        }
        FOCUS_FLOATING if !moving.is_empty() => {
            let (mb, mn) = p.magnification;
            let mut z_sensor = sensor_far;
            for _ in 0..4 {
                let s = with_gaps(&surfaces, &moving, t);
                let (img, m) = focus_of(&s, object).unwrap_or(infinity);
                z_sensor = last(&s) + img;
                t = if mn != mb {
                    ((m - mb) / (mn - mb)).clamp(0.0, 1.0)
                } else {
                    0.0
                };
            }
            z_sensor
        }
        _ => {
            let (img, _) = focus_of(&surfaces, object).unwrap_or(infinity);
            z_base[n - 1] + img
        }
    };
    if t != 0.0 {
        surfaces = with_gaps(&surfaces, &moving, t);
    }
    let z = positions(&surfaces);
    let efl_focused = paraxial::efl_bfl(&surfaces, 1).map_or(efl, |(f, _)| f);
    // Transmittance and its tint.
    let mut trans = [1.0f32; 3];
    for s in &surfaces {
        for (t, st) in trans.iter_mut().zip(&s.transmittance) {
            *t *= st;
        }
    }
    let lum = LUMA[0] * trans[0] + LUMA[1] * trans[1] + LUMA[2] * trans[2];
    let tint = trans.map(|t| t / lum);
    let iris = Iris::new(lens.blades, lens.roundness, lens.rotation_deg);
    let plate = 0.025 * p.spherical / (f_number * stop_radius * stop_radius * stop_radius);
    let field = corner;
    let mut lens_out = TracedLens {
        stop,
        stop_radius,
        iris,
        obstruction: lens.obstruction,
        sensor_z,
        pupil_z,
        rear_radius: 1.05 * surfaces[n - 1].semi_aperture,
        bin: 0.0,
        bounds: Vec::new(),
        chief_x: Vec::new(),
        normaliser: 1.0,
        tint,
        plate,
        distortion: 0.25 * p.distortion,
        vignetting: p.vignetting,
        breathing: 1.0,
        field,
        squeeze: 0.0,
        info: LensInfo {
            efl_mm: efl,
            bfl_mm: infinity.0,
            efl_focused_mm: efl_focused,
            f_number,
            f_number_min: n_min,
            t_stop: f_number / lum.sqrt(),
            transmittance: trans,
            length_mm: (z[n - 1] - z[0]).abs(),
            entrance_pupil_mm: (pupil_z - z[0], efl / f_number),
            elements: 0,
            groups: 0,
            distortion: Vec::new(),
            relative_illumination: Vec::new(),
            sensor_mm: sensor_z - z[n - 1],
            squeeze: 1.0,
        },
        key: camera,
        surfaces,
        z,
    };
    let (elements, groups) = lens_out.count_elements();
    lens_out.info.elements = elements;
    lens_out.info.groups = groups;
    // Breathing override: the paraxial image height of a small angle, focused against infinity.
    if p.breathing != 0.0 {
        let beta = (sensor_z - lens_out.z[n - 1]) / infinity.0.max(1.0e-6) * (efl_focused / efl);
        if beta > 0.0 {
            lens_out.breathing = crate::fmath::exp(-p.breathing * crate::fmath::ln(beta));
        }
    }
    let shift = (lens.shift_x_mm * lens.shift_x_mm + lens.shift_y_mm * lens.shift_y_mm).sqrt();
    lens_out.precompute(0.75 * camera.sensor_mm + shift)?;
    // An anamorphic lens: the squeeze as the chief rays of two points near the axis trace it.
    if lens_out
        .surfaces
        .iter()
        .any(|s| matches!(s.kind, SURFACE_CYLINDER_X | SURFACE_CYLINDER_Y))
    {
        let h = 0.02 * camera.sensor_mm;
        let tan = |x: f32, y: f32| match lens_out.chief(x, y, (0.0, 0.0)) {
            Traced::Out { dir, .. } if dir.z != 0.0 => {
                Some(((dir.x / dir.z).abs(), (dir.y / dir.z).abs()))
            }
            _ => None,
        };
        if let (Some((tx, _)), Some((_, ty))) = (tan(h, 0.0), tan(0.0, h)) {
            if tx > 0.0 && ty > 0.0 {
                lens_out.squeeze = tx / ty;
                lens_out.info.squeeze = tx / ty;
            }
        }
    }
    Ok(lens_out)
}

impl TracedLens {
    /// Glass elements and groups: every surface followed by glass starts an element, every one
    /// followed by glass after air starts a group; a folded lens counts its way out only.
    fn count_elements(&self) -> (u32, u32) {
        let last_mirror = self.surfaces.iter().rposition(|s| s.kind == SURFACE_MIRROR);
        let end = last_mirror.unwrap_or(self.surfaces.len());
        let (mut elements, mut groups) = (0, 0);
        for i in 0..end {
            let s = &self.surfaces[i];
            if s.kind == SURFACE_MIRROR || s.index[1] <= 1.0 {
                continue;
            }
            elements += 1;
            let before = if i == 0 {
                1.0
            } else {
                self.surfaces[i - 1].index[1]
            };
            if before <= 1.0 {
                groups += 1;
            }
        }
        (elements, groups)
    }

    /// The film point of a sensor position (camera frame: x right, y up, millimetres from the
    /// optical axis), in the lens frame: the image is upside down on the sensor.
    fn film(&self, x: f32, y: f32) -> Vec3 {
        Vec3::new(-x, -y, self.sensor_z)
    }

    /// The bounds of the exit pupil, the on-axis normaliser, the relative illumination and the
    /// distortion, for image heights up to `reach` (millimetres on the sensor).
    fn precompute(&mut self, reach: f32) -> Result<(), &'static str> {
        let g = PUPIL_GRID;
        let r = self.rear_radius;
        let cell = 2.0 * r / g as f32;
        let rear_z = self.z[self.z.len() - 1];
        self.bin = reach / (PUPIL_BINS - 1) as f32;
        let mut bounds = Vec::with_capacity(PUPIL_BINS);
        let mut irradiance = Vec::with_capacity(PUPIL_BINS);
        for b in 0..PUPIL_BINS {
            // A film point on +x of the lens frame.
            let film = Vec3::new(b as f32 * self.bin, 0.0, self.sensor_z);
            let (mut x0, mut x1, mut y0, mut y1) = (f32::MAX, f32::MIN, f32::MAX, f32::MIN);
            for j in 0..g {
                for i in 0..g {
                    let q = Vec3::new(
                        -r + (i as f32 + 0.5) * cell,
                        -r + (j as f32 + 0.5) * cell,
                        rear_z,
                    );
                    let d = unit(q - film);
                    let any = (0..3)
                        .any(|band| matches!(self.trace(film, d, band, true), Traced::Out { .. }));
                    if any {
                        x0 = x0.min(q.x - cell);
                        x1 = x1.max(q.x + cell);
                        y0 = y0.min(q.y - cell);
                        y1 = y1.max(q.y + cell);
                    }
                }
            }
            let rect = if x1 >= x0 {
                [x0.max(-r), x1.min(r), y0.max(-r), y1.min(r)]
            } else {
                [0.0, -1.0, 0.0, -1.0]
            };
            // The irradiance (band G) on a finer grid over the rectangle itself, where the light
            // passes: the normaliser of the samples and the relative illumination.
            let mut e = 0.0f32;
            if rect[1] > rect[0] && rect[3] > rect[2] {
                let n = IRRADIANCE_GRID;
                let (cw, ch) = (
                    (rect[1] - rect[0]) / n as f32,
                    (rect[3] - rect[2]) / n as f32,
                );
                let zz = film.z - rear_z;
                for j in 0..n {
                    for i in 0..n {
                        let q = Vec3::new(
                            rect[0] + (i as f32 + 0.5) * cw,
                            rect[2] + (j as f32 + 0.5) * ch,
                            rear_z,
                        );
                        let d = unit(q - film);
                        if let Traced::Out { .. } = self.trace(film, d, 1, true) {
                            e += cw * ch * d.z * d.z * d.z * d.z / (zz * zz);
                        }
                    }
                }
            }
            bounds.push(rect);
            irradiance.push(e);
        }
        if irradiance[0].is_nan() || irradiance[0] <= 0.0 {
            return Err("no light passes the lens on its axis");
        }
        self.normaliser = irradiance[0];
        self.bounds = bounds;
        // The chief rays (the last one found carries on where the search fails, at the rim).
        let mut last = 0.0f32;
        self.chief_x = (0..PUPIL_BINS)
            .map(|b| {
                if let Some(x) = self.chief_rear_x(b as f32 * self.bin) {
                    last = x;
                }
                last
            })
            .collect();
        let profile_bins = (0..PUPIL_BINS).filter(|&b| b as f32 * self.bin <= self.field * 1.0001);
        self.info.relative_illumination = profile_bins
            .map(|b| (b as f32 * self.bin, irradiance[b] / irradiance[0]))
            .collect();
        self.info.distortion = (1..=PROFILE_POINTS)
            .filter_map(|k| {
                let h = self.field * k as f32 / PROFILE_POINTS as f32;
                self.distortion_at(h).map(|d| (h, d))
            })
            .collect();
        Ok(())
    }

    /// Where on the rear plane (x) the chief ray of a film point at height `h` on +x crosses: the
    /// ray through the centre of the stop, by bisection on the stop height (band G).
    fn chief_rear_x(&self, h: f32) -> Option<f32> {
        let film = Vec3::new(h, 0.0, self.sensor_z);
        let rear_z = self.z[self.z.len() - 1];
        let r = self.rear_radius;
        let at_stop = |x: f32| -> Option<f32> {
            let d = unit(Vec3::new(x, 0.0, rear_z) - film);
            self.stop_height(film, d)
        };
        // A bracket of the stop's centre: the first pair of neighbouring points of a scan of the
        // rear plane where the ray reaches the stop on either side of its centre (rays near the
        // rim may miss a surface).
        const SCAN: usize = 32;
        let mut bracket = None;
        let mut prev: Option<(f32, f32)> = None;
        for k in 0..=SCAN {
            let x = -r + 2.0 * r * k as f32 / SCAN as f32;
            let Some(f) = at_stop(x) else {
                prev = None;
                continue;
            };
            if let Some((px, pf)) = prev {
                if pf.signum() != f.signum() {
                    bracket = Some((px, pf, x));
                    break;
                }
            }
            prev = Some((x, f));
        }
        let (mut lo, flo, mut hi) = bracket?;
        for _ in 0..40 {
            let mid = 0.5 * (lo + hi);
            match at_stop(mid) {
                Some(f) if f.signum() == flo.signum() => lo = mid,
                Some(_) => hi = mid,
                None => return None,
            }
        }
        Some(0.5 * (lo + hi))
    }

    /// The distortion at image height `h`, percent: `(h − f tan θ) / f tan θ` with θ the angle of
    /// the chief ray in object space.
    fn distortion_at(&self, h: f32) -> Option<f32> {
        let x = self.chief_rear_x(h)?;
        let film = Vec3::new(h, 0.0, self.sensor_z);
        let rear_z = self.z[self.z.len() - 1];
        let d = unit(Vec3::new(x, 0.0, rear_z) - film);
        match self.trace(film, d, 1, false) {
            Traced::Out { dir, .. } => {
                let tan = (dir.x * dir.x + dir.y * dir.y).sqrt() / dir.z.abs();
                let ideal = self.info.efl_focused_mm * tan;
                (ideal > 0.0).then(|| 100.0 * (h - ideal) / ideal)
            }
            Traced::Blocked => None,
        }
    }

    /// Where a ray from the film crosses the stop, x only (no rim checked), band G.
    fn stop_height(&self, p: Vec3, d: Vec3) -> Option<f32> {
        let n = self.surfaces.len();
        let (mut p, mut d) = (p, d);
        let mut n_cur = self.surfaces[n - 1].index[1];
        for i in (self.stop..n).rev() {
            let s = &self.surfaces[i];
            let (q, normal) = intersect(s, self.z[i], p, d)?;
            if i == self.stop {
                return Some(q.x);
            }
            p = Vec3::new(q.x, q.y, self.z[i] + q.z);
            if s.kind == SURFACE_MIRROR {
                d = d - normal * (2.0 * d.dot(normal));
            } else {
                let n_next = self.surfaces[i - 1].index[1];
                if n_next != n_cur {
                    d = refract(d, normal, n_cur / n_next)?;
                    n_cur = n_next;
                }
            }
        }
        None
    }

    /// One camera sample: the sensor position `(x, y)` (camera frame, millimetres from the optical
    /// axis, the shift included), the uniform numbers `u` for the point on the rear plane, the
    /// band, and the swirl (artistic, 0 to 1). The ray in the lens frame and its weight
    /// (relative to the axis; the band's channel is weighted by the caller).
    pub fn sample(&self, x: f32, y: f32, u: (f32, f32), band: usize, swirl: f32) -> (Traced, f32) {
        let (mut x, mut y) = (x * self.breathing, y * self.breathing);
        let r_sensor = (x * x + y * y).sqrt();
        let h = r_sensor / self.field;
        if self.distortion != 0.0 {
            let k = 1.0 + self.distortion * h * h;
            x *= k;
            y *= k;
        }
        let film = self.film(x, y);
        let r = (film.x * film.x + film.y * film.y).sqrt();
        let (c, s) = if r > 0.0 {
            (film.x / r, film.y / r)
        } else {
            (1.0, 0.0)
        };
        // The bounds of the two bins around the height, joined.
        let f = r / self.bin;
        let b0 = (f as usize).min(PUPIL_BINS - 1);
        let b1 = (b0 + 1).min(PUPIL_BINS - 1);
        let (p0, p1) = (self.bounds[b0], self.bounds[b1]);
        let rect = [
            p0[0].min(p1[0]),
            p0[1].max(p1[1]),
            p0[2].min(p1[2]),
            p0[3].max(p1[3]),
        ];
        if rect[1] < rect[0] || rect[3] < rect[2] {
            return (Traced::Blocked, 0.0);
        }
        let (w, hgt) = (rect[1] - rect[0], rect[3] - rect[2]);
        let mut px = rect[0] + u.0 * w;
        let mut py = rect[2] + u.1 * hgt;
        let mut jacobian = 1.0;
        if swirl > 0.0 {
            // Artistic: squeeze the rectangle along the radius and stretch it along the tangent
            // about its centre, and turn it, more towards the corner.
            let k = swirl * h;
            let (cx, cy) = (0.5 * (rect[0] + rect[1]), 0.5 * (rect[2] + rect[3]));
            let radial = (px - cx) * (1.0 - super::SWIRL_COMPRESS * k).max(0.05);
            let tangential = (py - cy) * (1.0 + super::SWIRL_STRETCH * k);
            let (sn, cs) = crate::fmath::sin_cos(super::SWIRL_TURN * k);
            px = cx + cs * radial - sn * tangential;
            py = cy + sn * radial + cs * tangential;
            jacobian =
                (1.0 - super::SWIRL_COMPRESS * k).max(0.05) * (1.0 + super::SWIRL_STRETCH * k);
        }
        let rear_z = self.z[self.z.len() - 1];
        let q = Vec3::new(c * px - s * py, s * px + c * py, rear_z);
        let delta = q - film;
        let len2 = delta.dot(delta);
        let d = delta * (1.0 / len2.sqrt());
        let traced = self.trace(film, d, band, true);
        if let Traced::Blocked = traced {
            return (Traced::Blocked, 0.0);
        }
        let zz = film.z - rear_z;
        let cos4 = d.z * d.z * d.z * d.z;
        let mut weight = w * hgt * jacobian * cos4 / (zz * zz) / self.normaliser * self.tint[band];
        if self.vignetting > 0.0 {
            weight *= (1.0 - self.vignetting * h * h).max(0.0);
        }
        (traced, weight)
    }
}

impl TracedLens {
    /// The ray of the sensor position `(x, y)` (camera frame, from the axis) through the centre
    /// of the stop (the chief ray, band G, no rim checked), or for `p` in the unit disc through the
    /// point `p` of the bounds' rectangle around it: what [`crate::scene::Camera::generate_ray`]
    /// and the exact passes use.
    pub fn chief(&self, x: f32, y: f32, p: (f32, f32)) -> Traced {
        let film = self.film(x * self.breathing, y * self.breathing);
        let r = (film.x * film.x + film.y * film.y).sqrt();
        let (c, s) = if r > 0.0 {
            (film.x / r, film.y / r)
        } else {
            (1.0, 0.0)
        };
        let f = (r / self.bin).min((PUPIL_BINS - 1) as f32);
        let b0 = f as usize;
        let b1 = (b0 + 1).min(PUPIL_BINS - 1);
        let t = f - b0 as f32;
        let cx = self.chief_x[b0] + (self.chief_x[b1] - self.chief_x[b0]) * t;
        let rect = self.bounds[b0];
        let (hw, hh) = if rect[1] >= rect[0] {
            (0.5 * (rect[1] - rect[0]), 0.5 * (rect[3] - rect[2]))
        } else {
            (0.0, 0.0)
        };
        let (px, py) = (cx + p.0 * hw, p.1 * hh);
        let rear_z = self.z[self.z.len() - 1];
        let q = Vec3::new(c * px - s * py, s * px + c * py, rear_z);
        self.trace(film, unit(q - film), 1, false)
    }
}

/// A number for JSON: finite values with up to six significant digits, `null` otherwise.
fn json_number(v: f32) -> String {
    if v.is_finite() {
        let s = format!("{v:.6}");
        let s = s.trim_end_matches('0').trim_end_matches('.');
        if s.is_empty() || s == "-" {
            "0".to_string()
        } else {
            s.to_string()
        }
    } else {
        "null".to_string()
    }
}

impl LensInfo {
    /// The info as JSON (what `rt_scene_lens_info` and `/api/lens/info` hand out):
    /// `{"traced":true,"eflMm":…,"bflMm":…,"eflFocusedMm":…,"fNumber":…,"fNumberMin":…,
    /// "tStop":…,"transmittance":[r,g,b],"lengthMm":…,"entrancePupilMm":[position,diameter],
    /// "elements":…,"groups":…,"sensorMm":…,"distortion":[[h,%],…],
    /// "relativeIllumination":[[h,ratio],…]}`.
    pub fn to_json(&self) -> String {
        let pairs = |v: &[(f32, f32)]| -> String {
            let items: Vec<String> = v
                .iter()
                .map(|&(a, b)| format!("[{},{}]", json_number(a), json_number(b)))
                .collect();
            format!("[{}]", items.join(","))
        };
        format!(
            "{{\"traced\":true,\"eflMm\":{},\"bflMm\":{},\"eflFocusedMm\":{},\"fNumber\":{},\"fNumberMin\":{},\"tStop\":{},\"transmittance\":[{},{},{}],\"lengthMm\":{},\"entrancePupilMm\":[{},{}],\"elements\":{},\"groups\":{},\"sensorMm\":{},\"squeeze\":{},\"distortion\":{},\"relativeIllumination\":{}}}",
            json_number(self.efl_mm),
            json_number(self.bfl_mm),
            json_number(self.efl_focused_mm),
            json_number(self.f_number),
            json_number(self.f_number_min),
            json_number(self.t_stop),
            json_number(self.transmittance[0]),
            json_number(self.transmittance[1]),
            json_number(self.transmittance[2]),
            json_number(self.length_mm),
            json_number(self.entrance_pupil_mm.0),
            json_number(self.entrance_pupil_mm.1),
            self.elements,
            self.groups,
            json_number(self.sensor_mm),
            json_number(self.squeeze),
            pairs(&self.distortion),
            pairs(&self.relative_illumination),
        )
    }
}

#[cfg(test)]
impl TracedLens {
    /// A tracer over ready surfaces with nothing precomputed: no rims, a round stop as large as
    /// its surface, the sensor at the origin (tests trace with `clip = false`).
    pub(crate) fn bare(surfaces: Vec<Surface>, stop: usize) -> TracedLens {
        let z = positions(&surfaces);
        let n = surfaces.len();
        TracedLens {
            stop,
            stop_radius: 1.0e6,
            iris: Iris::new(0, 0.0, 0.0),
            obstruction: 0.0,
            sensor_z: z[n - 1],
            pupil_z: 0.0,
            rear_radius: 1.0,
            bin: 1.0,
            bounds: Vec::new(),
            chief_x: Vec::new(),
            normaliser: 1.0,
            tint: [1.0; 3],
            plate: 0.0,
            distortion: 0.0,
            vignetting: 0.0,
            breathing: 1.0,
            field: 1.0,
            squeeze: 0.0,
            info: LensInfo {
                efl_mm: 0.0,
                bfl_mm: 0.0,
                efl_focused_mm: 0.0,
                f_number: 0.0,
                f_number_min: 0.0,
                t_stop: 0.0,
                transmittance: [1.0; 3],
                length_mm: 0.0,
                entrance_pupil_mm: (0.0, 0.0),
                elements: 0,
                groups: 0,
                distortion: Vec::new(),
                relative_illumination: Vec::new(),
                sensor_mm: 0.0,
                squeeze: 1.0,
            },
            key: CameraOptics {
                focal_mm: 0.0,
                fstop: 0.0,
                focus_dist: 0.0,
                sensor_mm: 0.0,
            },
            surfaces,
            z,
        }
    }
}
