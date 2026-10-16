//! The pupil of the enhanced thin lens (O1): where on the aperture a camera sample passes.
//!
//! A [`Pupil`] maps two uniform numbers (the lens dimensions of the sampler, [`DIM_LENS`]) to a
//! point of the unit pupil, with the density the lens asks for and no rejection, so the
//! stratification of the Sobol points carries over to the aperture:
//!
//! * **Disc**: the concentric map of Shirley and Chiu (what the plain thin lens uses), its radius
//!   then remapped through the inverse CDF of the radial profile. Uniform without an obstruction,
//!   it is the plain thin lens bit for bit.
//! * **Fan**: a polygon star-shaped about the centre, as a fan of triangles from the centre: the
//!   straight iris of `N` blades (`N` equal triangles), or the curved one (each blade an arc,
//!   [`ARC_SEGMENTS`] chords per blade). The first number picks the triangle by area and, by what
//!   is left of it, a point along its outer edge; the second the radius along that direction,
//!   `ρ = sqrt(s)` with `s` from the profile's inverse CDF (with the uniform profile this is the
//!   square-root parametrisation of a triangle). The profile is therefore a function of the
//!   *gauge* of the shape (1 on its edge), so a bright ring follows the polygon.
//! * **Grid**: a picture: an aperture mask that replaces the shape of the stop, or a texture
//!   (dust, rings) multiplied with the analytic shape, which is then drawn into the grid with an
//!   anti-aliased edge. The profile and the obstruction are multiplied in too, and the point comes
//!   from the marginal and conditional CDFs of the grid (row from the first number, column from
//!   the second, the position inside the texel from what is left of each), so a texel is chosen
//!   in proportion to its weight. The profile of a mask is a function of the plain radius.
//!
//! Radial profiles (`src/data/bokeh.ts` `PUPIL_PROFILES`), with `s = ρ²` and the strength `k`:
//! uniform `1`, bright centre `1 − k s`, bright ring `(1 − k) + k s`, apodized
//! `exp(−s / (2σ²))` with `σ = k`; an obstruction `ε` removes `s < ε²`. Each is sampled through
//! the exact inverse of its CDF in `s` (the stable roots of a quadratic, or `fmath` `exp`/`ln`).
//!
//! [`DIM_LENS`]: crate::sampler::DIM_LENS

use crate::fmath;
use crate::warp;

/// Chords per blade of a curved iris.
pub const ARC_SEGMENTS: usize = 24;

/// `LENS.profile` 0: every point of the pupil passes the same light.
pub const PROFILE_UNIFORM: u32 = 0;
/// `LENS.profile` 1: brighter in the centre, `1 − k ρ²`.
pub const PROFILE_CENTRE_BRIGHT: u32 = 1;
/// `LENS.profile` 2: brighter at the rim, `(1 − k) + k ρ²`.
pub const PROFILE_RING_BRIGHT: u32 = 2;
/// `LENS.profile` 3: a Gaussian of `ρ` with a standard deviation of `k`.
pub const PROFILE_APODIZED: u32 = 3;

/// Smallest standard deviation of the apodized profile (a smaller `k` is read as this).
pub const APODIZED_MIN_SIGMA: f32 = 0.05;

/// A radial density over the pupil, as a function of `s = ρ²` in `[ε², 1]`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Profile {
    kind: u32,
    k: f32,
    /// `ε²`: the obstruction.
    eps2: f32,
    /// For the apodized profile: `2σ²`, and `exp(−ε² / 2σ²)`, `exp(−1 / 2σ²)`.
    two_sigma2: f32,
    e_lo: f32,
    e_hi: f32,
}

impl Profile {
    /// The profile `kind` (`PROFILE_*`; unknown values are uniform) of strength `k` in `[0, 1]`
    /// with a central obstruction `eps` (a fraction of the radius, below one).
    pub fn new(kind: u32, k: f32, eps: f32) -> Profile {
        let kind = if kind <= PROFILE_APODIZED {
            kind
        } else {
            PROFILE_UNIFORM
        };
        let k = k.clamp(0.0, 1.0);
        let eps2 = (eps * eps).clamp(0.0, 0.99);
        let sigma = k.max(APODIZED_MIN_SIGMA);
        let two_sigma2 = 2.0 * sigma * sigma;
        let (e_lo, e_hi) = if kind == PROFILE_APODIZED {
            (
                fmath::exp(-eps2 / two_sigma2),
                fmath::exp(-1.0 / two_sigma2),
            )
        } else {
            (1.0, 1.0)
        };
        Profile {
            kind,
            k,
            eps2,
            two_sigma2,
            e_lo,
            e_hi,
        }
    }

    /// True when the profile is uniform over the whole disc (nothing to remap).
    pub fn is_identity(&self) -> bool {
        (self.kind == PROFILE_UNIFORM || self.k == 0.0 && self.kind != PROFILE_APODIZED)
            && self.eps2 == 0.0
    }

    /// The (unnormalised) density at `s = ρ²`: zero inside the obstruction and outside the pupil.
    pub fn weight(&self, s: f32) -> f32 {
        if s < self.eps2 || s > 1.0 {
            return 0.0;
        }
        match self.kind {
            PROFILE_CENTRE_BRIGHT => 1.0 - self.k * s,
            PROFILE_RING_BRIGHT => (1.0 - self.k) + self.k * s,
            PROFILE_APODIZED => fmath::exp(-s / self.two_sigma2),
            _ => 1.0,
        }
    }

    /// The `s = ρ²` whose CDF is `u` in `[0, 1)`: `s` is distributed with the density
    /// [`Profile::weight`] in `s` (uniform in area), within `[ε², 1]`.
    pub fn sample_s(&self, u: f32) -> f32 {
        let lo = self.eps2;
        let s = match self.kind {
            PROFILE_CENTRE_BRIGHT if self.k > 0.0 => {
                // G(s) = s − k s²/2; solve G(s) = G(lo) + u (G(1) − G(lo)) with the stable root.
                let k = self.k;
                let g = |s: f32| s - 0.5 * k * s * s;
                let c = g(lo) + u * (g(1.0) - g(lo));
                2.0 * c / (1.0 + (1.0 - 2.0 * k * c).max(0.0).sqrt())
            }
            PROFILE_RING_BRIGHT if self.k > 0.0 => {
                // G(s) = (1 − k) s + k s²/2.
                let k = self.k;
                let g = |s: f32| (1.0 - k) * s + 0.5 * k * s * s;
                let c = g(lo) + u * (g(1.0) - g(lo));
                let b = 1.0 - k;
                2.0 * c / (b + (b * b + 2.0 * k * c).max(0.0).sqrt())
            }
            PROFILE_APODIZED => {
                // G(s) = −2σ² exp(−s / 2σ²): exp(−s / 2σ²) = e_lo − u (e_lo − e_hi).
                let e = self.e_lo - u * (self.e_lo - self.e_hi);
                -self.two_sigma2 * fmath::ln(e.max(f32::MIN_POSITIVE))
            }
            _ => lo + u * (1.0 - lo),
        };
        s.clamp(lo, 1.0)
    }
}

/// Where a pupil sample lands, in the unit pupil (x right, y up), and how it was drawn.
#[derive(Clone, Debug, PartialEq)]
pub enum Pupil {
    /// A round iris: the concentric map, then the radial profile.
    Disc {
        /// The radial profile and obstruction.
        profile: Profile,
    },
    /// A polygonal or curved iris as a fan of triangles from the centre.
    Fan {
        /// The fan's outer vertices, counter-clockwise; triangle `i` is `(0, v[i], v[i + 1])`
        /// (wrapping).
        vertices: Vec<(f32, f32)>,
        /// Cumulative areas, `n + 1` values from 0 to 1; empty when all triangles are equal.
        cdf: Vec<f32>,
        /// The radial profile and obstruction, of the gauge of the shape.
        profile: Profile,
    },
    /// A picture of the pupil's transmission, sampled through its CDFs.
    Grid(Grid),
}

/// The CDFs of a `width × height` picture of the pupil covering `[−1, 1]²`, rows top to bottom.
#[derive(Clone, Debug, PartialEq)]
pub struct Grid {
    width: usize,
    height: usize,
    /// `height + 1` values from 0 to 1: the cumulative weight of the rows.
    marginal: Vec<f32>,
    /// `height × (width + 1)` values: each row's cumulative weight, 0 to 1.
    conditional: Vec<f32>,
    /// Sine and cosine of the rotation of the iris applied to every point (an aperture mask).
    rotation: (f32, f32),
}

/// The index `i` with `cdf[i] <= u < cdf[i + 1]` of a non-decreasing `cdf` from 0 to 1, for `u`
/// in `[0, 1)`: an interval of positive width (empty ones are never chosen).
fn find_interval(cdf: &[f32], u: f32) -> usize {
    let (mut lo, mut hi) = (0usize, cdf.len() - 1);
    while hi - lo > 1 {
        let mid = (lo + hi) / 2;
        if cdf[mid] <= u {
            lo = mid;
        } else {
            hi = mid;
        }
    }
    lo
}

/// Where `u` falls inside the interval `i` of `cdf`, in `[0, 1)`.
fn fraction(cdf: &[f32], i: usize, u: f32) -> f32 {
    let w = cdf[i + 1] - cdf[i];
    if w > 0.0 {
        ((u - cdf[i]) / w).clamp(0.0, 0.999_999_94)
    } else {
        0.5
    }
}

/// Normalises running sums in place to end at exactly 1 (all zero stays all zero).
fn normalise(cdf: &mut [f32]) -> bool {
    let total = cdf[cdf.len() - 1];
    if total > 0.0 {
        let inv = 1.0 / total;
        for c in cdf.iter_mut() {
            *c *= inv;
        }
        let last = cdf.len() - 1;
        cdf[last] = 1.0;
        true
    } else {
        false
    }
}

/// The shape of an iris of `blades` blades (3 to 18; 0 a circle) of `roundness` (0 straight,
/// 1 the inscribed circle) turned by `rotation_deg`, as in `tools/assets/aperture-masks.mjs`:
/// circumradius 1, the first vertex straight up before the rotation, edges whose middles touch
/// the inscribed circle; a curved blade is an arc of radius `apothem / roundness` tangent to the
/// straight edge at its middle.
#[derive(Clone, Debug, PartialEq)]
pub struct Iris {
    blades: u32,
    /// Apothem of the straight polygon, `cos(π / N)`.
    apothem: f32,
    /// Unit normals of the edges.
    normals: Vec<(f32, f32)>,
    /// Curved blades: the arc radius (0 for straight blades).
    arc_radius: f32,
}

impl Iris {
    /// The iris of a lens (see the type).
    pub fn new(blades: u32, roundness: f32, rotation_deg: f32) -> Iris {
        if blades < 3 {
            return Iris {
                blades: 0,
                apothem: 1.0,
                normals: Vec::new(),
                arc_radius: 0.0,
            };
        }
        let n = blades as f32;
        let apothem = fmath::cos(fmath::PI / n);
        let base = fmath::FRAC_PI_2 + rotation_deg * fmath::DEG_TO_RAD + fmath::PI / n;
        let normals = (0..blades)
            .map(|k| {
                let (s, c) = fmath::sin_cos(base + fmath::TAU * k as f32 / n);
                (c, s)
            })
            .collect();
        let roundness = roundness.clamp(0.0, 1.0);
        let arc_radius = if roundness > 1.0e-3 {
            apothem / roundness
        } else {
            0.0
        };
        Iris {
            blades,
            apothem,
            normals,
            arc_radius,
        }
    }

    /// True for a round iris.
    pub fn is_circle(&self) -> bool {
        self.blades == 0
    }

    /// The radius of the circle inside the iris (in units of the circumradius): the apothem of the
    /// polygon, which curved blades bulge beyond (1 for the round iris).
    pub fn inscribed(&self) -> f32 {
        self.apothem
    }

    /// Signed distance-like value to the edge (negative inside) of the point `(x, y)`, in units of
    /// the circumradius (exact for the circle and the straight polygon; for curved blades the
    /// largest distance to a blade's circle).
    pub fn signed_distance(&self, x: f32, y: f32) -> f32 {
        if self.is_circle() {
            return (x * x + y * y).sqrt() - 1.0;
        }
        let mut m = f32::NEG_INFINITY;
        for &(nx, ny) in &self.normals {
            let s = if self.arc_radius > 0.0 {
                let c = self.apothem - self.arc_radius;
                let (dx, dy) = (x - c * nx, y - c * ny);
                (dx * dx + dy * dy).sqrt() - self.arc_radius
            } else {
                nx * x + ny * y - self.apothem
            };
            if s > m {
                m = s;
            }
        }
        m
    }

    /// The gauge of `(x, y)`: the factor by which the shape must grow to put the point on its
    /// edge (0 at the centre, 1 on the edge).
    pub fn gauge(&self, x: f32, y: f32) -> f32 {
        let r2 = x * x + y * y;
        if self.is_circle() || r2 == 0.0 {
            return r2.sqrt();
        }
        let mut m = 0.0f32;
        for &(nx, ny) in &self.normals {
            let g = if self.arc_radius > 0.0 {
                // |p / g − c n| = R with c = a − R: the positive root in q = 1 / g of
                // r² q² − 2 (p·c n) q + (c² − R²) = 0, where c² − R² = a² − 2 a R < 0.
                let c = self.apothem - self.arc_radius;
                let pc = c * (nx * x + ny * y);
                let k = self.apothem * self.apothem - 2.0 * self.apothem * self.arc_radius;
                r2 / (pc + (pc * pc - r2 * k).max(0.0).sqrt())
            } else {
                (nx * x + ny * y) / self.apothem
            };
            if g > m {
                m = g;
            }
        }
        m
    }

    /// The outer vertices of the fan that draws this iris (counter-clockwise), and whether its
    /// triangles all have the same area.
    fn fan(&self) -> (Vec<(f32, f32)>, bool) {
        let n = self.normals.len();
        // Vertex k sits between the normals k - 1 and k.
        let corner = |k: usize| -> (f32, f32) {
            let (ax, ay) = self.normals[(k + n - 1) % n];
            let (bx, by) = self.normals[k % n];
            let (vx, vy) = (ax + bx, ay + by);
            let len = (vx * vx + vy * vy).sqrt();
            (vx / len, vy / len)
        };
        if self.arc_radius == 0.0 {
            return ((0..n).map(corner).collect(), true);
        }
        let (a, r) = (self.apothem, self.arc_radius);
        let c = a - r;
        let mut out = Vec::with_capacity(n * ARC_SEGMENTS);
        for k in 0..n {
            let (nx, ny) = self.normals[k];
            let (cx, cy) = (c * nx, c * ny);
            // The two ends of blade k's arc: where it meets the arcs of its neighbours, along the
            // directions of the corners k and k + 1 (|t v − c n| = R).
            let end = |v: (f32, f32)| -> (f32, f32) {
                let vc = v.0 * cx + v.1 * cy;
                let q = c * c - r * r;
                let t = vc + (vc * vc - q).max(0.0).sqrt();
                (t * v.0, t * v.1)
            };
            let (p0, p1) = (end(corner(k)), end(corner(k + 1)));
            let a0 = fmath::atan2(p0.1 - cy, p0.0 - cx);
            let mut a1 = fmath::atan2(p1.1 - cy, p1.0 - cx);
            if a1 < a0 {
                a1 += fmath::TAU;
            }
            for j in 0..ARC_SEGMENTS {
                if j == 0 {
                    out.push(p0);
                    continue;
                }
                let t = a0 + (a1 - a0) * j as f32 / ARC_SEGMENTS as f32;
                let (s, co) = fmath::sin_cos(t);
                out.push((cx + r * co, cy + r * s));
            }
        }
        (out, false)
    }
}

impl Pupil {
    /// The pupil of an analytic iris with a radial `profile`.
    pub fn analytic(iris: &Iris, profile: Profile) -> Pupil {
        if iris.is_circle() {
            return Pupil::Disc { profile };
        }
        let (vertices, equal) = iris.fan();
        let cdf = if equal {
            Vec::new()
        } else {
            let n = vertices.len();
            let mut cdf = Vec::with_capacity(n + 1);
            let mut sum = 0.0f32;
            cdf.push(0.0);
            for i in 0..n {
                let (a, b) = (vertices[i], vertices[(i + 1) % n]);
                sum += 0.5 * (a.0 * b.1 - a.1 * b.0).abs();
                cdf.push(sum);
            }
            normalise(&mut cdf);
            cdf
        };
        Pupil::Fan {
            vertices,
            cdf,
            profile,
        }
    }

    /// The point of the unit pupil for the uniform numbers `u`.
    pub fn sample(&self, u: (f32, f32)) -> (f32, f32) {
        match self {
            Pupil::Disc { profile } => {
                let (x, y) = warp::concentric_disk(u);
                if profile.is_identity() {
                    return (x, y);
                }
                let r2 = x * x + y * y;
                if r2 == 0.0 {
                    // The very centre: the direction is lost, any one does.
                    return (profile.sample_s(0.0).sqrt(), 0.0);
                }
                let scale = (profile.sample_s(r2.min(0.999_999_94)) / r2).sqrt();
                (x * scale, y * scale)
            }
            Pupil::Fan {
                vertices,
                cdf,
                profile,
            } => {
                let n = vertices.len();
                let (i, t) = if cdf.is_empty() {
                    let scaled = u.0 * n as f32;
                    let i = (scaled as usize).min(n - 1);
                    (i, (scaled - i as f32).clamp(0.0, 1.0))
                } else {
                    let i = find_interval(cdf, u.0);
                    (i, fraction(cdf, i, u.0))
                };
                let (a, b) = (vertices[i], vertices[(i + 1) % n]);
                let (ex, ey) = (a.0 + t * (b.0 - a.0), a.1 + t * (b.1 - a.1));
                let rho = profile.sample_s(u.1).sqrt();
                (rho * ex, rho * ey)
            }
            Pupil::Grid(grid) => grid.sample(u),
        }
    }
}

impl Grid {
    /// The CDFs of `weights` (row-major, rows top to bottom, `width × height`, non-negative);
    /// `None` when every weight is zero.
    pub fn new(width: usize, height: usize, weights: &[f32], rotation_deg: f32) -> Option<Grid> {
        if width == 0 || height == 0 || weights.len() != width * height {
            return None;
        }
        let mut conditional = Vec::with_capacity(height * (width + 1));
        let mut marginal = Vec::with_capacity(height + 1);
        marginal.push(0.0f32);
        let mut total = 0.0f32;
        for row in weights.chunks_exact(width) {
            let start = conditional.len();
            let mut sum = 0.0f32;
            conditional.push(0.0);
            for &w in row {
                sum += w.max(0.0);
                conditional.push(sum);
            }
            normalise(&mut conditional[start..]);
            total += sum;
            marginal.push(total);
        }
        if !normalise(&mut marginal) {
            return None;
        }
        let (s, c) = fmath::sin_cos(rotation_deg * fmath::DEG_TO_RAD);
        Some(Grid {
            width,
            height,
            marginal,
            conditional,
            rotation: (s, c),
        })
    }

    /// The point of the unit pupil for the uniform numbers `u`.
    pub fn sample(&self, u: (f32, f32)) -> (f32, f32) {
        let j = find_interval(&self.marginal, u.0);
        let fy = fraction(&self.marginal, j, u.0);
        let row = &self.conditional[j * (self.width + 1)..(j + 1) * (self.width + 1)];
        let i = find_interval(row, u.1);
        let fx = fraction(row, i, u.1);
        let x = (i as f32 + fx) * (2.0 / self.width as f32) - 1.0;
        let y = 1.0 - (j as f32 + fy) * (2.0 / self.height as f32);
        let (s, c) = self.rotation;
        if s == 0.0 && c == 1.0 {
            (x, y)
        } else {
            (c * x - s * y, s * x + c * y)
        }
    }
}

/// The weights of the grid of a lens with a picture: `mask` (8-bit, row-major, rows top to
/// bottom over `[−1, 1]²`) either replaces the iris (`aperture`, its profile of the plain radius)
/// or multiplies the analytic `iris` (a texture, drawn with an anti-aliased edge and its profile of
/// the gauge).
pub fn grid_weights(
    mask: &[u8],
    width: usize,
    height: usize,
    aperture: bool,
    iris: &Iris,
    profile: &Profile,
) -> Vec<f32> {
    let mut out = Vec::with_capacity(width * height);
    let (sx, sy) = (2.0 / width as f32, 2.0 / height as f32);
    let px = sx.max(sy);
    for j in 0..height {
        let y = 1.0 - (j as f32 + 0.5) * sy;
        for i in 0..width {
            let x = (i as f32 + 0.5) * sx - 1.0;
            let t = f32::from(mask[j * width + i]) * (1.0 / 255.0);
            let w = if aperture {
                t * profile.weight(x * x + y * y)
            } else {
                let cover = (0.5 - iris.signed_distance(x, y) / px).clamp(0.0, 1.0);
                if cover > 0.0 {
                    let g = iris.gauge(x, y).min(1.0);
                    t * cover * profile.weight(g * g)
                } else {
                    0.0
                }
            };
            out.push(w);
        }
    }
    out
}
