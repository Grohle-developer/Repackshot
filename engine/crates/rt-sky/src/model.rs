//! The sky model's functional form, in `f64` (the engine has it in `f32`, `rt_core::sky`).
//!
//! L. Hošek and A. Wilkie, "An Analytic Model for Full Spectral Sky-Dome Radiance", ACM TOG
//! 31(4), 2012, extend the Perez distribution with a circumsolar halo:
//!
//! ```text
//! F(θ, γ) = (1 + A e^(B / (cos θ + 0.01))) · (C + D e^(E γ) + F cos² γ + G χ(H, γ) + I √cos θ)
//! χ(g, α) = (1 + cos² α) / (1 + g² - 2 g cos α)^(3/2)
//! L(θ, γ) = F(θ, γ) · L_M
//! ```
//!
//! with `θ` the view's zenith angle and `γ` its angle from the Sun. Each of the nine coefficients
//! and the radiance `L_M` is a quintic Bézier curve over `x = (elevation / 90°)^(1/3)` with six
//! control points, per colour channel, ground albedo (0 and 1) and integer turbidity (1 to 10);
//! between knots the model is linear in albedo and turbidity. Only this form comes from the
//! paper; the numbers in the table are fitted here ([`crate::fit`]).
//!
//! `1 + H² - 2 H cos γ` is evaluated as `(1 - H)² + H |v - s|²` (`v`, `s` unit vectors towards
//! the view and the Sun: `|v - s|² = 2 (1 - cos γ)`), and `γ` as `atan2(|v × s|, v · s)`, the
//! forms that stay accurate near the Sun.

use crate::dmath;

/// Coefficients per curve: `A` to `I`.
pub const PARAMS: usize = 9;
/// Control points per Bézier curve.
pub const CONTROL: usize = 6;
/// Integer turbidities of the table (1 to 10).
pub const TURBIDITIES: usize = 10;
/// Ground albedos of the table (0 and 1).
pub const ALBEDOS: usize = 2;
/// Colour channels (linear Rec. 709 R, G, B).
pub const CHANNELS: usize = 3;

/// The direction-dependent quantities of one view.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct View {
    /// `cos θ` (clamped at 0).
    pub cos_theta: f64,
    /// `γ`, radians.
    pub gamma: f64,
    /// `cos γ`.
    pub cos_gamma: f64,
    /// `|v - s|²`.
    pub chord2: f64,
}

impl View {
    /// The view along unit `v` with the Sun along unit `s`.
    pub fn new(v: [f64; 3], s: [f64; 3]) -> View {
        let dot = v[0] * s[0] + v[1] * s[1] + v[2] * s[2];
        let cross = [
            v[1] * s[2] - v[2] * s[1],
            v[2] * s[0] - v[0] * s[2],
            v[0] * s[1] - v[1] * s[0],
        ];
        let sin = (cross[0] * cross[0] + cross[1] * cross[1] + cross[2] * cross[2]).sqrt();
        let d = [v[0] - s[0], v[1] - s[1], v[2] - s[2]];
        View {
            cos_theta: v[2].max(0.0),
            gamma: dmath::atan2(sin, dot),
            cos_gamma: dot.clamp(-1.0, 1.0),
            chord2: d[0] * d[0] + d[1] * d[1] + d[2] * d[2],
        }
    }
}

/// The halo `χ(H, γ)`.
#[inline]
pub fn chi(h: f64, v: &View) -> f64 {
    let den = (1.0 - h) * (1.0 - h) + h * v.chord2;
    (1.0 + v.cos_gamma * v.cos_gamma) / (den * den.sqrt())
}

/// `e^x` with the argument kept in `[-80, 80]` (as the engine does in `f32`).
#[inline]
pub fn exp_clamped(x: f64) -> f64 {
    dmath::exp(x.clamp(-80.0, 80.0))
}

/// `F(θ, γ)` for coefficients `p = [A, B, C, D, E, F, G, H, I]`.
pub fn distribution(p: &[f64; PARAMS], v: &View) -> f64 {
    let [a, b, c, d, e, f, g, h, i] = *p;
    let ct = v.cos_theta;
    (1.0 + a * exp_clamped(b / (ct + 0.01)))
        * (c + d * exp_clamped(e * v.gamma)
            + f * v.cos_gamma * v.cos_gamma
            + g * chi(h, v)
            + i * ct.sqrt())
}

/// `F` and its derivatives with respect to the nine coefficients.
pub fn distribution_gradient(p: &[f64; PARAMS], v: &View) -> (f64, [f64; PARAMS]) {
    let [a, b, c, d, e, f, g, h, i] = *p;
    let ct = v.cos_theta;
    let inv = 1.0 / (ct + 0.01);
    let eb = exp_clamped(b * inv);
    let first = 1.0 + a * eb;
    let ee = exp_clamped(e * v.gamma);
    let den = (1.0 - h) * (1.0 - h) + h * v.chord2;
    let num = 1.0 + v.cos_gamma * v.cos_gamma;
    let chi = num / (den * den.sqrt());
    // d den / d H = -2 (1 - H) + |v - s|²
    let dchi = -1.5 * chi / den * (-2.0 * (1.0 - h) + v.chord2);
    let sq = ct.sqrt();
    let cg2 = v.cos_gamma * v.cos_gamma;
    let second = c + d * ee + f * cg2 + g * chi + i * sq;
    let clamped_b = (b * inv).abs() >= 80.0;
    let grad = [
        eb * second,
        if clamped_b {
            0.0
        } else {
            a * eb * inv * second
        },
        first,
        first * ee,
        if (e * v.gamma).abs() >= 80.0 {
            0.0
        } else {
            first * d * v.gamma * ee
        },
        first * cg2,
        first * chi,
        first * g * dchi,
        first * sq,
    ];
    (first * second, grad)
}

/// `x = (elevation / 90°)^(1/3)` for an elevation in degrees (clamped to `[0, 90]`).
pub fn elevation_parameter(elevation_deg: f64) -> f64 {
    dmath::cbrt((elevation_deg / 90.0).clamp(0.0, 1.0))
}

/// The six quintic Bernstein polynomials at `x`.
pub fn bernstein(x: f64) -> [f64; CONTROL] {
    let y = 1.0 - x;
    let (x2, y2) = (x * x, y * y);
    let (x3, y3) = (x2 * x, y2 * y);
    [
        y3 * y2,
        5.0 * x * y2 * y2,
        10.0 * x2 * y3,
        10.0 * x3 * y2,
        5.0 * x2 * x2 * y,
        x3 * x2,
    ]
}

/// A Bézier curve of six control points at `x`.
pub fn bezier(control: &[f64; CONTROL], x: f64) -> f64 {
    let b = bernstein(x);
    (0..CONTROL).map(|k| b[k] * control[k]).sum()
}

/// One knot of the table (one turbidity, albedo and channel): the control points of the nine
/// coefficients and of the radiance.
#[derive(Clone, Debug, PartialEq)]
pub struct Knot {
    /// `[control][coefficient]`.
    pub coefficients: [[f64; PARAMS]; CONTROL],
    /// The radiance scale's control points.
    pub radiance: [f64; CONTROL],
}

impl Knot {
    /// The nine coefficients at elevation parameter `x`.
    pub fn coefficients_at(&self, x: f64) -> [f64; PARAMS] {
        let b = bernstein(x);
        let mut p = [0.0; PARAMS];
        for (k, row) in self.coefficients.iter().enumerate() {
            for j in 0..PARAMS {
                p[j] += b[k] * row[j];
            }
        }
        p
    }

    /// The modelled radiance of `view` with the Sun at elevation parameter `x`.
    pub fn radiance_at(&self, x: f64, view: &View) -> f64 {
        distribution(&self.coefficients_at(x), view) * bezier(&self.radiance, x)
    }
}

/// The whole table: `[turbidity][albedo][channel]`.
#[derive(Clone, Debug, PartialEq)]
pub struct Table {
    /// The knots.
    pub knots: Vec<Knot>,
}

impl Table {
    /// Index of a knot.
    pub fn index(turbidity: usize, albedo: usize, channel: usize) -> usize {
        (turbidity * ALBEDOS + albedo) * CHANNELS + channel
    }

    /// The modelled RGB radiance (linear in turbidity and albedo between knots) of the view `v`
    /// with the Sun at `s` (unit vectors, observer frame), the Sun `elevation_deg` up.
    pub fn rgb(
        &self,
        turbidity: f64,
        albedo: f64,
        elevation_deg: f64,
        v: [f64; 3],
        s: [f64; 3],
    ) -> [f64; 3] {
        let x = elevation_parameter(elevation_deg);
        let view = View::new(v, s);
        let t = turbidity.clamp(1.0, TURBIDITIES as f64) - 1.0;
        let i = (t.floor() as usize).min(TURBIDITIES - 2);
        let f = t - i as f64;
        let a = albedo.clamp(0.0, 1.0);
        let mut out = [0.0; 3];
        for (ti, wt) in [(i, 1.0 - f), (i + 1, f)] {
            for (ai, wa) in [(0, 1.0 - a), (1, a)] {
                let w = wt * wa;
                if w == 0.0 {
                    continue;
                }
                for (c, o) in out.iter_mut().enumerate() {
                    *o += w * self.knots[Table::index(ti, ai, c)].radiance_at(x, &view);
                }
            }
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_gradient_is_the_derivative() {
        let p = [-0.9, -0.4, 1.2, 0.8, -3.0, 0.3, 0.05, 0.7, 0.4];
        let s = [0.8, 0.0, 0.6];
        for v in [
            [0.0f64, 0.0, 1.0],
            [0.6, 0.0, 0.8],
            [-0.7, 0.7, 0.14],
            [0.79, 0.1, 0.6],
        ] {
            let l = (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]).sqrt();
            let view = View::new([v[0] / l, v[1] / l, v[2] / l], s);
            let (f, g) = distribution_gradient(&p, &view);
            assert!((f - distribution(&p, &view)).abs() < 1.0e-12);
            for j in 0..PARAMS {
                let mut q = p;
                let h = 1.0e-6;
                q[j] += h;
                let up = distribution(&q, &view);
                q[j] -= 2.0 * h;
                let down = distribution(&q, &view);
                let numeric = (up - down) / (2.0 * h);
                assert!(
                    (numeric - g[j]).abs() < 1.0e-5 * (1.0 + g[j].abs()),
                    "{j}: {numeric} vs {}",
                    g[j]
                );
            }
        }
    }

    #[test]
    fn bernstein_polynomials_partition_unity() {
        for i in 0..=10 {
            let x = i as f64 / 10.0;
            let b = bernstein(x);
            assert!((b.iter().sum::<f64>() - 1.0).abs() < 1.0e-14);
        }
        assert_eq!(bernstein(0.0)[0], 1.0);
        assert_eq!(bernstein(1.0)[5], 1.0);
        assert!((elevation_parameter(90.0) - 1.0).abs() < 1.0e-15);
        assert!((elevation_parameter(11.25) - 0.5).abs() < 1.0e-15);
    }
}
