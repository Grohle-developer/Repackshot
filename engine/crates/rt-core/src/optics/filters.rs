//! Effect filters on the lens (O3a): the sheets screwed in front of a lens that scatter part of
//! the light that comes in (diffusion, glimmer, soft, net, star, streak), as scattering at the
//! pupil.
//!
//! * **Model** (decision 1): a camera ray, with probability `s` (from the filter's grade), is
//!   turned by an angle drawn from the filter's **angular PSF** `K`; otherwise it goes straight
//!   on. What the image gets is `(1 − s)·I + s·a·(I ⊗ K_T)`: `a` is what the particles let through
//!   (1 for the white and gold diffusions; below 1 for the black one, whose halo lifts the shadows
//!   less: it keeps the contrast), and the tint `T` (luminance 1) goes on the wide parts of the
//!   PSF only, the diffusion's tail (the halation) and the lines: the narrow core that sits on the
//!   picture itself stays neutral (the lead's verdict on the first sheet). It happens at the pupil
//!   sample of O1, so the bokeh and the focus come for free and a light outside the frame still
//!   veils it.
//! * **PSFs** (decision 2): each kind is a radial or a line profile in angle (the tangent of the
//!   deflection, radians), sampled by a tabulated inverse CDF in `f32` built when the lens is
//!   loaded; the loop only looks up and interpolates. Diffusion: a narrow Gaussian of
//!   [`SIGMA_CORE_DEG`] and a wide Cauchy tail of [`SIGMA_TAIL_DEG`]; soft: the Gaussian alone;
//!   glimmer: the Gaussian and a cloud of [`GLIMMER_SPARKLES`] fine sparkles (fixed directions and
//!   brightnesses, one drawn per sample); net: the Gaussian and a short cross along two axes at 90°; star:
//!   `points` straight lines at `angle`, as long as the grade says, with a 1/r falloff that tapers
//!   to their end; streak: one horizontal line.
//! * **Stack** (decision 3): up to [`MAX_FILTERS`], applied in order, each with its own numbers.
//! * Determinism: the tables are built with [`crate::fmath`]; the loop only adds, multiplies,
//!   divides and takes square roots (and the turn of the star's lines, precomputed).

use crate::fmath;
use crate::math::Vec3;
use crate::warp;

/// `FilterParams.kind`: no filter.
pub const FILTER_NONE: u32 = 0;
/// White diffusion: a halo and lower contrast.
pub const FILTER_DIFFUSION_WHITE: u32 = 1;
/// Black diffusion: the same shape, part of the scattered light absorbed.
pub const FILTER_DIFFUSION_BLACK: u32 = 2;
/// Gold diffusion: the diffusion with a warm tint.
pub const FILTER_DIFFUSION_GOLD: u32 = 3;
/// Glimmer: small sparkles around the lights.
pub const FILTER_GLIMMER: u32 = 4;
/// Soft: less sharpness without a halo.
pub const FILTER_SOFT: u32 = 5;
/// Net: scattering along two axes at 90°, softly tinted.
pub const FILTER_NET: u32 = 6;
/// Star: 4, 6 or 8 straight rays from the lights.
pub const FILTER_STAR: u32 = 7;
/// Streak: one horizontal line, blue by default.
pub const FILTER_STREAK: u32 = 8;

/// Filters in a camera's stack.
pub const MAX_FILTERS: usize = 3;
/// The largest grade.
pub const MAX_GRADE: f32 = 2.0;

/// The grades of the real filters and the scattered fraction `s` of each (decision 2; the lead's
/// proposal, fixed from the sheet): the diffusions', the glimmer's and the net's. Between two
/// grades every table here is interpolated; below 1/8, towards 0.
pub const GRADES: [f32; 5] = [0.125, 0.25, 0.5, 1.0, 2.0];
/// See [`GRADES`].
pub const GRADE_S: [f32; 5] = [0.03, 0.06, 0.12, 0.22, 0.38];
/// The star's `s` by grade: its rays keep their brightness near the light (so they do not widen)
/// while the grade makes them longer, so `s` grows as the 1/r falloff's integral to their length.
pub const STAR_S: [f32; 5] = [0.073, 0.082, 0.091, 0.1, 0.11];
/// The length of the star's rays by grade, degrees: on the sheet's 85 mm (a half-frame of 12°),
/// a quarter of the half-frame at 1/4, 60 % of it at 1 and all of it at 2.
pub const STAR_LENGTH_DEG: [f32; 5] = [1.9, 3.0, 4.6, 7.2, 12.0];
/// The length of the net's cross by grade, degrees: at 2, 15 % of the sheet's frame width.
pub const NET_LENGTH_DEG: [f32; 5] = [0.6, 0.95, 1.45, 2.25, 3.5];
/// The streak's `s` by grade: its line is the whole of its scattered light, and the picture
/// along it takes the line's tint, so it scatters little.
pub const STREAK_S: [f32; 5] = [0.02, 0.025, 0.035, 0.045, 0.07];
/// Width of the narrow Gaussian of the diffusions, degrees of field.
pub const SIGMA_CORE_DEG: f32 = 0.25;
/// Width of the wide tail of the diffusions, degrees of field.
pub const SIGMA_TAIL_DEG: f32 = 2.5;
/// Share of the diffusions' scattered light in the narrow Gaussian (the rest is the tail).
pub const CORE_SHARE: f32 = 0.6;
/// What the black diffusion's particles let through of the light they scatter.
pub const BLACK_TRANSMISSION: f32 = 0.7;
/// The soft filter scatters this many times the diffusions' `s` (at most [`SOFT_MAX_S`]).
pub const SOFT_S_SCALE: f32 = 2.0;
/// See [`SOFT_S_SCALE`].
pub const SOFT_MAX_S: f32 = 0.8;
/// Glimmer: the sparkles of its cloud, fixed directions of which each scattered sample takes one
/// (by its brightness, which is a speckle's: exponential, from a hash).
pub const GLIMMER_SPARKLES: u32 = 4096;
/// Glimmer: the width of the cloud, degrees (the sparkles lie as a 2-D Gaussian of this width).
pub const GLIMMER_CLOUD_DEG: f32 = 1.0;
/// Glimmer: share of the scattered light in the sparkles (the rest in the narrow Gaussian).
pub const GLIMMER_SHARE: f32 = 0.5;
/// Glimmer: half the width of a sparkle, degrees.
pub const GLIMMER_SIGMA_DEG: f32 = 0.03;
/// Net: share of the scattered light in the cross (the rest in the narrow Gaussian, its softening).
pub const NET_AXIS_SHARE: f32 = 0.1;
/// Lines (star, streak, net): where the 1/r falloff starts, degrees (it tapers to 0 at the line's
/// length).
pub const LINE_START_DEG: f32 = 0.05;
/// The streak's length at every grade, degrees.
pub const STREAK_END_DEG: f32 = 15.0;
/// Width of a line, degrees.
pub const LINE_WIDTH_DEG: f32 = 0.02;
/// The default tints of the halation and the lines: gold, net and streak (before they are brought
/// to luminance 1).
pub const TINT_GOLD: [f32; 3] = [1.08, 1.0, 0.86];
/// See [`TINT_GOLD`].
pub const TINT_NET: [f32; 3] = [1.06, 1.0, 0.94];
/// See [`TINT_GOLD`].
pub const TINT_STREAK: [f32; 3] = [0.82, 0.95, 1.25];

/// Entries of an inverse CDF table.
const TABLE: usize = 256;
/// Steps of the numerical integral a table is built from.
const STEPS: usize = 4096;
/// The diffusion tail stops here, in widths of the tail (the rest of the Cauchy is dropped).
const TAIL_REACH: f32 = 12.0;
const LUMA: [f32; 3] = [0.2126, 0.7152, 0.0722];
/// The glimmer's sparkles hash with this as their second coordinate (their brightness with the
/// next one).
const SPARKLE_SALT: u32 = 0x51ed;
/// The glimmer's sparkles are binned in a grid of this many cells a side, for the connections.
const SPARKLE_GRID: usize = 64;

/// One filter of a camera's stack, as the `LENS` section holds it.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct FilterParams {
    /// `FILTER_*`.
    pub kind: u32,
    /// Grade, 0 (off) to [`MAX_GRADE`]: 1/8, 1/4, 1/2, 1 and 2 are the real ones.
    pub grade: f32,
    /// Tint of the scattered light (gold, net, streak); all zero: the kind's own.
    pub tint: [f32; 3],
    /// Star and streak: the angle of the first line from the horizontal, degrees; net: of the axes.
    pub angle_deg: f32,
    /// Star: 4, 6 or 8 rays (0: 6).
    pub points: u32,
}

impl Default for FilterParams {
    fn default() -> Self {
        FilterParams {
            kind: FILTER_NONE,
            grade: 0.0,
            tint: [0.0; 3],
            angle_deg: 0.0,
            points: 0,
        }
    }
}

/// `x > 0`, false for NaN.
#[inline]
fn positive(x: f32) -> bool {
    x > 0.0
}

/// A table by [`GRADES`] at `grade`: linear between two grades, towards 0 below 1/8, the last
/// value above 2.
pub fn by_grade(table: &[f32; 5], grade: f32) -> f32 {
    if !positive(grade) {
        return 0.0;
    }
    if grade <= GRADES[0] {
        return table[0] * grade / GRADES[0];
    }
    for i in 1..GRADES.len() {
        if grade <= GRADES[i] {
            let t = (grade - GRADES[i - 1]) / (GRADES[i] - GRADES[i - 1]);
            return table[i - 1] + (table[i] - table[i - 1]) * t;
        }
    }
    table[GRADES.len() - 1]
}

/// The scattered fraction `s` of a grade (the diffusions' table, [`GRADE_S`]).
pub fn grade_s(grade: f32) -> f32 {
    by_grade(&GRADE_S, grade)
}

/// The scattered fraction of a filter kind at a grade: the star's and the streak's own tables,
/// the soft filter's [`SOFT_S_SCALE`] times the diffusions', the diffusions' for the rest.
pub fn kind_s(kind: u32, grade: f32) -> f32 {
    match kind {
        FILTER_STAR => by_grade(&STAR_S, grade),
        FILTER_STREAK => by_grade(&STREAK_S, grade),
        FILTER_SOFT => (grade_s(grade) * SOFT_S_SCALE).min(SOFT_MAX_S),
        _ => grade_s(grade),
    }
}

/// The length of a kind's lines at a grade, degrees (0 for the kinds without lines).
pub fn line_length_deg(kind: u32, grade: f32) -> f32 {
    let length = match kind {
        FILTER_STAR => by_grade(&STAR_LENGTH_DEG, grade),
        FILTER_NET => by_grade(&NET_LENGTH_DEG, grade),
        FILTER_STREAK => STREAK_END_DEG,
        _ => return 0.0,
    };
    length.max(4.0 * LINE_START_DEG)
}

/// An inverse CDF: `TABLE` values of the variable at evenly spaced probabilities `0..=1`.
#[derive(Clone, Debug, PartialEq)]
struct Inverse(Vec<f32>);

impl Inverse {
    /// From a density `pdf(x)` on `[0, end]` (not normalised), integrated in `STEPS` steps of
    /// `x = end t²` (finer near 0, where the PSFs are steep).
    fn new(end: f32, pdf: impl Fn(f32) -> f32) -> Inverse {
        let mut xs = Vec::with_capacity(STEPS + 1);
        let mut cdf = Vec::with_capacity(STEPS + 1);
        let mut total = 0.0f32;
        let mut prev = 0.0f32;
        xs.push(0.0);
        cdf.push(0.0);
        for k in 1..=STEPS {
            let t = k as f32 / STEPS as f32;
            let x = end * t * t;
            let mid = 0.5 * (prev + x);
            total += pdf(mid) * (x - prev);
            xs.push(x);
            cdf.push(total);
            prev = x;
        }
        let mut table = Vec::with_capacity(TABLE);
        let mut j = 0;
        for i in 0..TABLE {
            let target = total * i as f32 / (TABLE - 1) as f32;
            while j + 1 < STEPS && cdf[j + 1] < target {
                j += 1;
            }
            let (c0, c1) = (cdf[j], cdf[j + 1]);
            let f = if c1 > c0 {
                ((target - c0) / (c1 - c0)).clamp(0.0, 1.0)
            } else {
                0.0
            };
            table.push(xs[j] + (xs[j + 1] - xs[j]) * f);
        }
        Inverse(table)
    }

    /// The variable at probability `u` in `[0, 1)`.
    fn at(&self, u: f32) -> f32 {
        let f = u * (TABLE - 1) as f32;
        let i = (f as usize).min(TABLE - 2);
        let t = f - i as f32;
        self.0[i] + (self.0[i + 1] - self.0[i]) * t
    }

    /// The density `at` samples with at `x` (constant between two table values), 0 outside.
    fn density(&self, x: f32) -> f32 {
        let t = &self.0;
        let n = t.len();
        if !(x >= t[0] && x <= t[n - 1]) {
            return 0.0;
        }
        let i = t.partition_point(|&v| v <= x).clamp(1, n - 1) - 1;
        let w = t[i + 1] - t[i];
        if w > 0.0 {
            1.0 / ((n - 1) as f32 * w)
        } else {
            0.0
        }
    }

    /// The probability that `at` gives a value below `x`.
    fn cdf(&self, x: f32) -> f32 {
        let t = &self.0;
        let n = t.len();
        if !positive(x - t[0]) {
            return 0.0;
        }
        if x >= t[n - 1] {
            return 1.0;
        }
        let i = t.partition_point(|&v| v <= x).clamp(1, n - 1) - 1;
        let w = t[i + 1] - t[i];
        let f = if w > 0.0 { (x - t[i]) / w } else { 0.0 };
        (i as f32 + f) / (n - 1) as f32
    }

    /// Where `x` falls in the table: the entry below it and the fraction to the next one.
    fn locate(&self, x: f32) -> (usize, f32) {
        let t = &self.0;
        let n = t.len();
        let i = t.partition_point(|&v| v <= x).clamp(1, n - 1) - 1;
        let w = t[i + 1] - t[i];
        let f = if w > 0.0 {
            ((x - t[i]) / w).clamp(0.0, 1.0)
        } else {
            0.0
        };
        (i, f)
    }

    /// The largest value.
    fn end(&self) -> f32 {
        self.0[self.0.len() - 1]
    }
}

/// Which part of a filter's PSF a scattered sample came from (the PSF is a mixture: the radial
/// lobe, the lines, the glimmer's sparkle), and where in it.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Lobe {
    /// The radial lobe (the diffusions, the soft filter, the cores of the glimmer and the net).
    Radial,
    /// Line `k` of the star, the streak or the net, at distance `t` along it.
    Line {
        /// The line.
        k: u32,
        /// Distance along it, in tangent units.
        t: f32,
    },
    /// Sparkle `j` of the glimmer.
    Sparkle {
        /// The sparkle.
        j: u32,
    },
}

/// A scattered camera sample: the deflection (tangent units along the camera's right and up), its
/// colour weight (`a`, times the tint where the lobe has it) and the lobe it came from.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Scatter {
    /// The deflection.
    pub delta: (f32, f32),
    /// The colour weight.
    pub weight: [f32; 3],
    /// Where in the PSF.
    pub lobe: Lobe,
}

/// A light as the deflections of one camera sample see it: the disc of the deflection plane
/// (`d + right·δx + up·δy`) that holds every direction to it.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Disc {
    /// The deflection to the light's centre.
    pub centre: (f32, f32),
    /// The radius, a little more than the light's bounding sphere covers.
    pub radius: f32,
}

/// The disc of a light (bounding sphere `centre`, `radius`) seen from `origin` by a camera ray of
/// unit direction `d` with the camera's `right` and `up`; `None` when the light is behind the
/// deflection plane, holds the origin or is too close to grazing it (the pupil scattering alone
/// covers it then).
pub fn light_disc(
    origin: Vec3,
    d: Vec3,
    right: Vec3,
    up: Vec3,
    centre: Vec3,
    radius: f32,
) -> Option<Disc> {
    let n = right.cross(up);
    let h = d.dot(n);
    let v = centre - origin;
    let vn = v.dot(n);
    if !positive(h.abs() - 1.0e-6) || !positive(vn * h) {
        return None;
    }
    let dist2 = v.dot(v);
    let r2 = radius * radius;
    if !positive(dist2 - r2 * 1.0001) {
        return None;
    }
    let p = v * (h / vn) - d;
    // tan θ of the centre from the plane's normal and of the sphere's half angle, and the plane
    // distance between the centre's image and the far edge: h (tan(θ + α) − tan θ).
    let side = v - n * vn;
    let tan_c = side.dot(side).sqrt() / vn.abs();
    let tan_a = radius / (dist2 - r2).sqrt();
    let den = 1.0 - tan_c * tan_a;
    if den < 0.05 {
        return None;
    }
    let spread = h.abs() * ((tan_c + tan_a) / den - tan_c);
    Some(Disc {
        centre: (p.dot(right), p.dot(up)),
        radius: 1.02 * spread + 1.0e-7,
    })
}

/// A filter ready to sample.
#[derive(Clone, Debug, PartialEq)]
pub struct Filter {
    kind: u32,
    /// Scattered fraction.
    s: f32,
    /// The weight of a scattered sample on the neutral parts (the narrow core, the sparkles).
    core: [f32; 3],
    /// The weight on the tinted parts: the diffusion's tail and the lines (`a·T`).
    tinted: [f32; 3],
    /// Radial inverse CDF (the narrow Gaussian, or the whole diffusion PSF).
    radial: Inverse,
    /// The share of the tail in the diffusion's radial density at each entry of `radial` (empty
    /// when the core and the tail have the same weight).
    tail: Vec<f32>,
    /// Line inverse CDF (1/r tapering to the line's length).
    line: Option<Inverse>,
    /// Directions of the lines `(cos, sin)` in the image.
    lines: Vec<(f32, f32)>,
    /// The glimmer's sparkles.
    sparkles: Option<Sparkles>,
    /// Share of the second lobe (glimmer's sparkles, net's axes).
    second: f32,
}

fn deg(x: f32) -> f32 {
    x * fmath::DEG_TO_RAD
}

/// The unit Gaussian disc density `exp(−r² / 2σ²)` times `r` (radial measure).
fn gaussian(sigma: f32) -> impl Fn(f32) -> f32 {
    let k = 1.0 / (2.0 * sigma * sigma);
    move |r| r * fmath::exp(-r * r * k)
}

impl Filter {
    /// A filter from its parameters; `None` when it scatters nothing.
    pub fn new(p: &FilterParams) -> Result<Option<Filter>, &'static str> {
        if p.kind > FILTER_STREAK {
            return Err("unknown filter kind");
        }
        if !(0.0..=MAX_GRADE).contains(&p.grade) {
            return Err("a filter grade must be between 0 and 2");
        }
        if p.tint.iter().any(|&t| t < 0.0 || !t.is_finite()) {
            return Err("a filter tint must not be negative");
        }
        if !p.angle_deg.is_finite() {
            return Err("a filter angle must be finite");
        }
        if !matches!(p.points, 0 | 4 | 6 | 8) {
            return Err("a star has 4, 6 or 8 points");
        }
        let s = kind_s(p.kind, p.grade);
        if p.kind == FILTER_NONE || s == 0.0 {
            return Ok(None);
        }
        let own = match p.kind {
            FILTER_DIFFUSION_GOLD => TINT_GOLD,
            FILTER_NET => TINT_NET,
            FILTER_STREAK => TINT_STREAK,
            _ => [1.0; 3],
        };
        let tinted_kind = matches!(p.kind, FILTER_DIFFUSION_GOLD | FILTER_NET | FILTER_STREAK);
        let tint = if tinted_kind && p.tint.iter().any(|&t| t > 0.0) {
            p.tint
        } else {
            own
        };
        let lum = LUMA[0] * tint[0] + LUMA[1] * tint[1] + LUMA[2] * tint[2];
        if !positive(lum) {
            return Err("a filter tint must not be black");
        }
        let a = if p.kind == FILTER_DIFFUSION_BLACK {
            BLACK_TRANSMISSION
        } else {
            1.0
        };
        let tinted = tint.map(|t| a * t / lum);
        // The neutral parts weigh what an untinted filter's scattered light does (bit for bit the
        // same for the kinds without a tint).
        let core_weight = if tinted_kind {
            let l = LUMA[0] + LUMA[1] + LUMA[2];
            [a / l; 3]
        } else {
            tinted
        };
        let core = deg(SIGMA_CORE_DEG);
        let tail = deg(SIGMA_TAIL_DEG);
        let gn = core * core; // ∫ r exp(−r²/2σ²) dr
                              // The diffusion's radial density per unit of r, without its factor r: the core and the
                              // 2-D Cauchy (Poisson) tail, 1 / (1 + (r / γ)²)^(3/2), each normalised to 1.
        let parts = move |r: f32| {
            let q = 1.0 + (r / tail) * (r / tail);
            (
                CORE_SHARE * fmath::exp(-r * r / (2.0 * core * core)) / gn,
                (1.0 - CORE_SHARE) / (q * q.sqrt()) / (tail * tail),
            )
        };
        let diffusion = matches!(
            p.kind,
            FILTER_DIFFUSION_WHITE | FILTER_DIFFUSION_BLACK | FILTER_DIFFUSION_GOLD
        );
        let radial = if diffusion {
            let g = gaussian(core);
            Inverse::new(tail * TAIL_REACH, move |r| {
                let q = 1.0 + (r / tail) * (r / tail);
                CORE_SHARE * g(r) / gn + (1.0 - CORE_SHARE) * r / (q * q.sqrt()) / (tail * tail)
            })
        } else {
            Inverse::new(5.0 * core, gaussian(core))
        };
        let tail_share = if diffusion && core_weight != tinted {
            radial
                .0
                .iter()
                .map(|&r| {
                    let (c, t) = parts(r);
                    t / (c + t)
                })
                .collect()
        } else {
            Vec::new()
        };
        let (line, lines, second) = match p.kind {
            FILTER_STAR | FILTER_STREAK | FILTER_NET => {
                let (start, end) = (deg(LINE_START_DEG), deg(line_length_deg(p.kind, p.grade)));
                // 1/r from `start` (flat below it), tapering linearly to 0 at the line's end.
                let line = Inverse::new(end, move |r| (1.0 - r / end).max(0.0) / r.max(start));
                let n = match p.kind {
                    FILTER_STREAK => 2,
                    FILTER_NET => 4,
                    _ => {
                        if p.points == 0 {
                            6
                        } else {
                            p.points
                        }
                    }
                };
                let lines = (0..n)
                    .map(|k| {
                        let (sn, cs) = fmath::sin_cos(
                            deg(p.angle_deg) + std::f32::consts::TAU * k as f32 / n as f32,
                        );
                        (cs, sn)
                    })
                    .collect();
                let second = if p.kind == FILTER_NET {
                    NET_AXIS_SHARE
                } else {
                    1.0
                };
                (Some(line), lines, second)
            }
            FILTER_GLIMMER => (None, Vec::new(), GLIMMER_SHARE),
            _ => (None, Vec::new(), 0.0),
        };
        let sparkles = (p.kind == FILTER_GLIMMER).then(Sparkles::new);
        Ok(Some(Filter {
            kind: p.kind,
            s,
            core: core_weight,
            tinted,
            radial,
            tail: tail_share,
            line,
            lines,
            sparkles,
            second,
        }))
    }

    /// The colour weight of a scattered sample of `lobe` at `delta`: the tint on the lines and on
    /// the diffusion's tail (by its share of the density there), neutral on the core and the
    /// sparkles.
    pub fn colour_at(&self, lobe: Lobe, delta: (f32, f32)) -> [f32; 3] {
        match lobe {
            Lobe::Line { .. } => self.tinted,
            Lobe::Sparkle { .. } => self.core,
            Lobe::Radial if self.tail.is_empty() => self.core,
            Lobe::Radial => {
                let r = (delta.0 * delta.0 + delta.1 * delta.1).sqrt();
                let (i, f) = self.radial.locate(r);
                let share = self.tail[i] + (self.tail[i + 1] - self.tail[i]) * f;
                [0, 1, 2].map(|c| self.core[c] + share * (self.tinted[c] - self.core[c]))
            }
        }
    }

    /// The glimmer's sparkles: the deflections to their centres and their shares of the cloud's
    /// light (empty for the other kinds).
    pub fn sparkles(&self) -> (&[(f32, f32)], &[f32]) {
        match &self.sparkles {
            Some(c) => (&c.centres, &c.shares),
            None => (&[], &[]),
        }
    }

    /// The scattered fraction.
    pub fn s(&self) -> f32 {
        self.s
    }

    /// The deflection of one camera sample and its colour weight, or `None` when it goes straight
    /// on. `u` are four uniform numbers (the choice, two for the angle, one for the lobe and the
    /// line or the sparkle).
    pub fn scatter(&self, u: [f32; 4]) -> Option<Scatter> {
        if u[0] >= self.s {
            return None;
        }
        // The choice's number, reused for the azimuth: uniform in [0, 1) once divided by s.
        let azimuth = u[0] / self.s;
        let along_line = self.line.is_some() && u[3] < self.second;
        let (delta, lobe) = if along_line {
            let t = self.line.as_ref().map_or(0.0, |l| l.at(u[1]));
            let k = (((u[3] / self.second) * self.lines.len() as f32) as usize)
                .min(self.lines.len() - 1);
            let (c, s) = self.lines[k];
            // A thin line: a small offset across it.
            let across = deg(LINE_WIDTH_DEG) * (2.0 * u[2] - 1.0);
            (
                (c * t - s * across, s * t + c * across),
                Lobe::Line { k: k as u32, t },
            )
        } else if let (Some(cloud), true) = (&self.sparkles, u[3] < self.second) {
            // One of the sparkles by its share, from the lobe's number, and a small spread around
            // it.
            let j = cloud.pick(u[3] / self.second);
            let (cx, cy) = cloud.centres[j];
            let spread = deg(GLIMMER_SIGMA_DEG);
            (
                (
                    cx + spread * (2.0 * u[1] - 1.0),
                    cy + spread * (2.0 * u[2] - 1.0),
                ),
                Lobe::Sparkle { j: j as u32 },
            )
        } else {
            let r = self.radial.at(u[1]);
            let (sn, cs) = fmath::sin_cos(std::f32::consts::TAU * azimuth);
            ((cs * r, sn * r), Lobe::Radial)
        };
        Some(Scatter {
            delta,
            weight: self.colour_at(lobe, delta),
            lobe,
        })
    }

    /// The line intervals `[t1, t2]` of `disc` (widened by the lines' width) and their
    /// probability under the line lobe, per line; and their sum.
    fn line_spans(&self, disc: &Disc) -> ([(f32, f32, f32); 8], f32) {
        let mut spans = [(0.0f32, 0.0f32, 0.0f32); 8];
        let mut total = 0.0;
        let Some(line) = &self.line else {
            return (spans, 0.0);
        };
        let rho = disc.radius + deg(LINE_WIDTH_DEG);
        let (cx, cy) = disc.centre;
        let c2 = cx * cx + cy * cy;
        for (k, &(c, s)) in self.lines.iter().enumerate().take(8) {
            let b = c * cx + s * cy;
            let d = b * b - c2 + rho * rho;
            if d <= 0.0 {
                continue;
            }
            let q = d.sqrt();
            let (t1, t2) = ((b - q).max(0.0), (b + q).min(line.end()));
            if t2 <= t1 {
                continue;
            }
            let p = line.cdf(t2) - line.cdf(t1);
            spans[k] = (t1, t2, p);
            total += p;
        }
        (spans, total)
    }

    /// The weight of the pupil scattering against the connection to a light (multiple importance
    /// sampling, the balance heuristic, per lobe): for a deflection `delta` of `lobe` that reaches
    /// the light of `disc`, chosen for the connection with probability `p_light`,
    /// `K / (K + p_light·q)` with `K` the lobe's density and `q` the connection's. A deflection the
    /// connection cannot draw weighs 1; the connection's own estimate is `s·L` times the colour
    /// and this weight at the deflection it drew.
    pub fn mis_weight(&self, lobe: Lobe, delta: (f32, f32), disc: &Disc, p_light: f32) -> f32 {
        match lobe {
            Lobe::Radial => {
                let (dx, dy) = (delta.0 - disc.centre.0, delta.1 - disc.centre.1);
                if dx * dx + dy * dy > disc.radius * disc.radius {
                    return 1.0;
                }
                let r = (delta.0 * delta.0 + delta.1 * delta.1).sqrt();
                if !positive(r) {
                    return 1.0;
                }
                let k = self.radial.density(r) / (std::f32::consts::TAU * r);
                let q = p_light / (std::f32::consts::PI * disc.radius * disc.radius);
                if k + q > 0.0 {
                    k / (k + q)
                } else {
                    1.0
                }
            }
            Lobe::Line { k, t } => {
                let (spans, total) = self.line_spans(disc);
                let (t1, t2, p) = spans[(k as usize).min(7)];
                if !positive(p) || t < t1 || t > t2 {
                    return 1.0;
                }
                // Per line: K = p(t) / (n · width) and q = p(t) / (Σ P · width).
                let n = self.lines.len() as f32;
                total / (total + n * p_light)
            }
            Lobe::Sparkle { .. } => {
                // K = Σ w / box and q = Σ w / A over the sparkles whose box holds the deflection,
                // inside the square that bounds the light (w: a sparkle's share; A: the boxes'
                // area inside it, each by its share): the sums cancel.
                let (r, (dx, dy)) = (disc.radius, disc.centre);
                let Some(cloud) = &self.sparkles else {
                    return 1.0;
                };
                if (delta.0 - dx).abs() > r || (delta.1 - dy).abs() > r {
                    return 1.0;
                }
                let area = cloud.area(disc);
                if !positive(area) {
                    return 1.0;
                }
                let spread = deg(GLIMMER_SIGMA_DEG);
                area / (area + 4.0 * spread * spread * p_light)
            }
        }
    }

    /// The connection of a camera sample to the light of `disc` (chosen with probability
    /// `p_light`) through this filter: a lobe chosen by its share, a deflection drawn inside the
    /// light from that lobe's connection density (the glimmer: a sparkle by the area of its box
    /// inside the light, a point in that part), its weight (`mis_weight` there) and its colour;
    /// `None` when the lobe cannot reach the light. The estimate of the light is
    /// `s·L·colour·weight` (see [`Filter::s`]).
    pub fn connect(
        &self,
        disc: &Disc,
        p_light: f32,
        u: [f32; 4],
    ) -> Option<((f32, f32), f32, [f32; 3])> {
        let second = u[0] < self.second;
        let (delta, lobe) = if second && self.line.is_some() {
            let (spans, total) = self.line_spans(disc);
            if !positive(total) {
                return None;
            }
            // A line by its probability inside the light, a distance by the line's density there.
            let line = self.line.as_ref()?;
            let mut pick = u[1] * total;
            let mut k = 0;
            for (i, span) in spans.iter().enumerate().take(self.lines.len()) {
                if span.2 > 0.0 {
                    k = i;
                    if pick < span.2 {
                        break;
                    }
                    pick -= span.2;
                }
            }
            let (t1, t2, p) = spans[k];
            let t = line
                .at((line.cdf(t1) + u[2] * p).min(0.999_999))
                .clamp(t1, t2);
            let (c, s) = self.lines[k];
            let across = deg(LINE_WIDTH_DEG) * (2.0 * u[3] - 1.0);
            (
                (c * t - s * across, s * t + c * across),
                Lobe::Line { k: k as u32, t },
            )
        } else if let (Some(cloud), true) = (&self.sparkles, second) {
            let (j, (x0, x1, y0, y1)) = cloud.pick_in(disc, u[1])?;
            (
                (x0 + (x1 - x0) * u[2], y0 + (y1 - y0) * u[3]),
                Lobe::Sparkle { j },
            )
        } else {
            let (x, y) = warp::concentric_disk((u[1], u[2]));
            (
                (
                    disc.centre.0 + disc.radius * x,
                    disc.centre.1 + disc.radius * y,
                ),
                Lobe::Radial,
            )
        };
        let w = self.mis_weight(lobe, delta, disc, p_light);
        (w > 0.0).then_some((delta, w, self.colour_at(lobe, delta)))
    }
}

/// The glimmer's cloud of sparkles: [`GLIMMER_SPARKLES`] deflections, their directions from a hash
/// and their distances those of a 2-D Gaussian of [`GLIMMER_CLOUD_DEG`] (a soft halo, densest near
/// the light, no ring), one per stratum of that distribution jittered by the hash; their shares of
/// the cloud's light exponential (a speckle's) from another hash; and a grid of them for the
/// connections, which only visit the sparkles near a light.
#[derive(Clone, Debug, PartialEq)]
struct Sparkles {
    centres: Vec<(f32, f32)>,
    /// Each one's share of the light (they add up to 1).
    shares: Vec<f32>,
    /// The shares added up, for drawing one.
    cdf: Vec<f32>,
    /// The grid: its lower corner and cell size, and the sparkles of each cell (`order` from
    /// `starts[c]` to `starts[c + 1]`).
    origin: f32,
    cell: f32,
    starts: Vec<u32>,
    order: Vec<u32>,
}

impl Sparkles {
    fn new() -> Sparkles {
        let sigma = deg(GLIMMER_CLOUD_DEG);
        let n = GLIMMER_SPARKLES as f32;
        let mut centres = Vec::with_capacity(GLIMMER_SPARKLES as usize);
        let mut weights = Vec::with_capacity(GLIMMER_SPARKLES as usize);
        for j in 0..GLIMMER_SPARKLES {
            let (hx, hy) = unit_pair(cell_hash(j, SPARKLE_SALT));
            let q = (j as f32 + hx) / n;
            let r = sigma * (-2.0 * fmath::ln(1.0 - q)).sqrt();
            let (sn, cs) = fmath::sin_cos(std::f32::consts::TAU * hy);
            centres.push((cs * r, sn * r));
            let (hw, _) = unit_pair(cell_hash(j, SPARKLE_SALT + 1));
            weights.push(-fmath::ln(1.0 - hw) + 1.0e-3);
        }
        let total: f32 = weights.iter().sum();
        let shares: Vec<f32> = weights.iter().map(|w| w / total).collect();
        let mut cdf = Vec::with_capacity(shares.len());
        let mut acc = 0.0f32;
        for w in &shares {
            acc += w;
            cdf.push(acc);
        }
        // The grid covers every box.
        let spread = deg(GLIMMER_SIGMA_DEG);
        let reach = centres
            .iter()
            .fold(0.0f32, |m, &(x, y)| m.max(x.abs()).max(y.abs()))
            + 2.0 * spread;
        let (origin, cell) = (-reach, 2.0 * reach / SPARKLE_GRID as f32);
        let index = |v: f32| (((v - origin) / cell) as usize).min(SPARKLE_GRID - 1);
        let cell_of = |&(x, y): &(f32, f32)| index(y) * SPARKLE_GRID + index(x);
        let mut counts = vec![0u32; SPARKLE_GRID * SPARKLE_GRID + 1];
        for c in &centres {
            counts[cell_of(c) + 1] += 1;
        }
        for i in 1..counts.len() {
            counts[i] += counts[i - 1];
        }
        let starts = counts.clone();
        let mut fill = counts;
        let mut order = vec![0u32; centres.len()];
        for (j, c) in centres.iter().enumerate() {
            let k = cell_of(c);
            order[fill[k] as usize] = j as u32;
            fill[k] += 1;
        }
        Sparkles {
            centres,
            shares,
            cdf,
            origin,
            cell,
            starts,
            order,
        }
    }

    /// The sparkle at probability `u` of the shares.
    fn pick(&self, u: f32) -> usize {
        let target = u * self.cdf[self.cdf.len() - 1];
        self.cdf
            .partition_point(|&c| c <= target)
            .min(self.cdf.len() - 1)
    }

    /// Calls `f` with every sparkle whose box meets the square that bounds `disc`, and that part
    /// of its box, in a fixed order.
    fn near(&self, disc: &Disc, mut f: impl FnMut(usize, (f32, f32, f32, f32))) {
        let spread = deg(GLIMMER_SIGMA_DEG);
        let (r, (dx, dy)) = (disc.radius + spread, disc.centre);
        let range = |lo: f32, hi: f32| {
            let a = ((lo - self.origin) / self.cell).floor().max(0.0);
            let b = ((hi - self.origin) / self.cell).floor();
            if b < 0.0 || a >= SPARKLE_GRID as f32 {
                return 0..0;
            }
            (a as usize)..((b as usize).min(SPARKLE_GRID - 1) + 1)
        };
        for y in range(dy - r, dy + r) {
            for x in range(dx - r, dx + r) {
                let c = y * SPARKLE_GRID + x;
                for &j in &self.order[self.starts[c] as usize..self.starts[c + 1] as usize] {
                    if let Some(rect) = sparkle_rect(self.centres[j as usize], disc) {
                        f(j as usize, rect);
                    }
                }
            }
        }
    }

    /// The area of the sparkles' boxes inside the square that bounds `disc`, each by its share.
    fn area(&self, disc: &Disc) -> f32 {
        let mut total = 0.0;
        self.near(disc, |j, (x0, x1, y0, y1)| {
            total += self.shares[j] * (x1 - x0) * (y1 - y0);
        });
        total
    }

    /// A sparkle near `disc` by its share times its part of the box, from `u`, and that part.
    fn pick_in(&self, disc: &Disc, u: f32) -> Option<(u32, (f32, f32, f32, f32))> {
        let total = self.area(disc);
        if !positive(total) {
            return None;
        }
        let mut pick = u * total;
        let mut chosen = None;
        let mut done = false;
        self.near(disc, |j, rect| {
            if done {
                return;
            }
            chosen = Some((j as u32, rect));
            let a = self.shares[j] * (rect.1 - rect.0) * (rect.3 - rect.2);
            if pick < a {
                done = true;
            } else {
                pick -= a;
            }
        });
        chosen
    }
}

/// The part `(x0, x1, y0, y1)` of the box of the sparkle at `centre` inside the square that bounds
/// `disc`, if any.
fn sparkle_rect(centre: (f32, f32), disc: &Disc) -> Option<(f32, f32, f32, f32)> {
    let spread = deg(GLIMMER_SIGMA_DEG);
    let (r, (dx, dy)) = (disc.radius, disc.centre);
    let (x0, x1) = (
        (centre.0 - spread).max(dx - r),
        (centre.0 + spread).min(dx + r),
    );
    let (y0, y1) = (
        (centre.1 - spread).max(dy - r),
        (centre.1 + spread).min(dy + r),
    );
    (x1 > x0 && y1 > y0).then_some((x0, x1, y0, y1))
}

/// A hash of two numbers (the glimmer's sparkles).
pub(crate) fn cell_hash(x: u32, y: u32) -> u32 {
    let mut h = x.wrapping_mul(0x9e37_79b1) ^ y.wrapping_mul(0x85eb_ca77) ^ 0x27d4_eb2f;
    h ^= h >> 15;
    h = h.wrapping_mul(0x2c1b_3c6d);
    h ^= h >> 12;
    h = h.wrapping_mul(0x297a_2d39);
    h ^ (h >> 15)
}

/// Two numbers in `[0, 1)` from a hash.
fn unit_pair(h: u32) -> (f32, f32) {
    ((h >> 16) as f32 / 65536.0, (h & 0xffff) as f32 / 65536.0)
}
