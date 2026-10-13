//! The procedural daylight sky of `ENVR.kind` 2, in two models (`ENVR.sky_model`).
//!
//! **Physical** (the default, E5c): [`PhysicalSky`], the functional form of L. Hošek and
//! A. Wilkie, "An Analytic Model for Full Spectral Sky-Dome Radiance", ACM TOG 31(4), 2012, with
//! coefficients of our own: they were fitted (`engine/crates/rt-sky`) to skies simulated by our
//! own spectral radiative transfer through a spherical, stratified atmosphere (molecules, aerosols
//! by turbidity, ozone, a Lambertian ground), not taken from the paper's reference implementation
//! or its tables. The radiance in a direction at angle `θ` from the zenith and `γ` from the Sun
//! is, per linear Rec. 709 channel,
//!
//! ```text
//! L = F(θ, γ) · L_M
//! F(θ, γ) = (1 + A e^(B / (cos θ + 0.01))) · (C + D e^(E γ) + F cos² γ + G χ(H, γ) + I √cos θ)
//! χ(H, γ) = (1 + cos² γ) / (1 + H² - 2 H cos γ)^(3/2)
//! ```
//!
//! where `A..I` and `L_M` are quintic Bézier curves (six control points, [`crate::sky_table`])
//! over `x = (elevation / 90°)^(1/3)`, for each integer turbidity from 1 to 10 and ground albedo 0
//! and 1; the sky is linear between them (the radiances are blended, not the coefficients). The
//! ground albedo is [`GROUND_ALBEDO`]. `1 + H² - 2 H cos γ` is evaluated as `(1 - H)² + H |v - s|²`
//! and `γ` as `atan2(|v × s|, v · s)` (`v`, `s` the unit vectors towards the view and the Sun),
//! which stay accurate near the Sun. Sun elevations from 0 to 90 degrees.
//!
//! **Classic**: [`Preetham`], the analytic model of A. J. Preetham, P. Shirley and B. Smits, "A
//! Practical Analytic Model for Daylight", SIGGRAPH 1999 (formulas and the coefficient table of
//! its Appendix A.2, public literature), the sky of E5, which old scenes may ask for.
//!
//! The classic sky's luminance `Y` and chromaticity `x`, `y` in a direction at angle `θ` from the
//! zenith and `γ` from the sun follow the distribution of R. Perez, R. Seals and J. Michalsky
//! (1993),
//!
//! ```text
//! F(θ, γ) = (1 + A e^(B / cos θ)) (1 + C e^(D γ) + E cos² γ)
//! Y(θ, γ) = Y_z F(θ, γ) / F(0, θs)        (and the same for x and y)
//! ```
//!
//! with `A..E` linear in the turbidity `T` and the zenith values `Y_z`, `x_z`, `y_z` given by the
//! paper's fits in `T` and the sun's zenith angle `θs`. `xyY` goes to CIE XYZ and then to linear
//! Rec. 709 RGB (the matrix of IEC 61966-2-1 for D65).
//!
//! **Scale.** Neither model's absolute level means anything next to the recipes' lights, which
//! were tuned against the studio dome. So the sky is scaled to give a horizontal surface the same
//! irradiance as the dome of the same `ENVR` values would (`2π (horizon / 6 + zenith / 3)` times
//! `strength`): switching a setup between the dome and the sky keeps its fill light, and only its
//! colour and distribution change. The sun disc is the scene's `SUN` light, not part of the sky;
//! the sky only puts the sun's glow where that light is.
//!
//! **Below the horizon** the sky is a neutral ground of radiance `floor · strength`, like the
//! dome's floor. The classic sky clamps the sun's elevation to `[1°, 90°]` (it does not describe
//! twilight), the physical one to `[0°, 90°]`. The sky is tabulated once per scene into a
//! [`SKY_WIDTH`] x [`SKY_HEIGHT`] equirectangular image ([`crate::environment`] looks it up and
//! importance-samples it).

use crate::color::Rgb;
use crate::fmath;
use crate::math::Vec3;
use crate::sky_table::{COEFFICIENTS, RADIANCE};

/// Columns of the tabulated sky.
pub const SKY_WIDTH: u32 = 256;
/// Rows of the tabulated sky (the horizon falls between rows).
pub const SKY_HEIGHT: u32 = 128;
/// Turbidity used when the file gives none (a clear day).
pub const DEFAULT_TURBIDITY: f32 = 3.0;
/// Ground albedo of the physical sky (0.2, the usual default ground reflectance of daylight and
/// solar engineering).
pub const GROUND_ALBEDO: f32 = 0.2;

/// Coefficients per Bézier control point of the physical sky (`A` to `I`).
const PARAMS: usize = 9;
/// Bézier control points per curve.
const CONTROL: usize = 6;

/// One knot of the physical sky's table at the sun's elevation, with its weight.
#[derive(Clone, Copy, Debug, PartialEq)]
struct Knot {
    weight: f32,
    /// `A..I` per channel.
    coefficients: [[f32; PARAMS]; 3],
    /// `L_M` per channel.
    radiance: [f32; 3],
}

/// The physical sky (E5c) for one sun position, turbidity and ground albedo, before scaling.
#[derive(Clone, Debug, PartialEq)]
pub struct PhysicalSky {
    /// Unit direction towards the sun.
    pub sun: Vec3,
    /// The (up to four) knots the sky blends: two turbidities times two albedos.
    knots: Vec<Knot>,
}

/// The six quintic Bernstein polynomials at `x`.
fn bernstein(x: f32) -> [f32; CONTROL] {
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

impl PhysicalSky {
    /// The sky with the sun `elevation_deg` above the horizon (clamped to `[0, 90]`) at
    /// `azimuth_deg` (measured from +X towards +Y, Z up), turbidity `turbidity` (clamped to
    /// `[1, 10]`) and ground albedo `albedo` (clamped to `[0, 1]`).
    pub fn new(azimuth_deg: f32, elevation_deg: f32, turbidity: f32, albedo: f32) -> PhysicalSky {
        let t = if turbidity.is_finite() {
            turbidity.clamp(1.0, 10.0)
        } else {
            DEFAULT_TURBIDITY
        };
        let elevation = if elevation_deg.is_finite() {
            elevation_deg.clamp(0.0, 90.0)
        } else {
            45.0
        };
        let azimuth = if azimuth_deg.is_finite() {
            azimuth_deg
        } else {
            0.0
        };
        let albedo = if albedo.is_finite() {
            albedo.clamp(0.0, 1.0)
        } else {
            GROUND_ALBEDO
        };
        let (se, ce) = fmath::sin_cos(elevation * fmath::DEG_TO_RAD);
        let (sa, ca) = fmath::sin_cos(azimuth * fmath::DEG_TO_RAD);
        let sun = Vec3::new(ce * ca, ce * sa, se);
        let x = fmath::powf(elevation / 90.0, 1.0 / 3.0);
        let b = bernstein(x);
        let tt = t - 1.0;
        let i = (tt.floor() as usize).min(8);
        let f = tt - i as f32;
        let mut knots = Vec::with_capacity(4);
        for (ti, wt) in [(i, 1.0 - f), (i + 1, f)] {
            for (ai, wa) in [(0usize, 1.0 - albedo), (1, albedo)] {
                let weight = wt * wa;
                if weight <= 0.0 {
                    continue;
                }
                let mut knot = Knot {
                    weight,
                    coefficients: [[0.0; PARAMS]; 3],
                    radiance: [0.0; 3],
                };
                for c in 0..3 {
                    let base = (ti * 2 + ai) * 3 + c;
                    for (k, &bk) in b.iter().enumerate() {
                        for j in 0..PARAMS {
                            knot.coefficients[c][j] +=
                                bk * COEFFICIENTS[(base * CONTROL + k) * PARAMS + j];
                        }
                        knot.radiance[c] += bk * RADIANCE[base * CONTROL + k];
                    }
                }
                knots.push(knot);
            }
        }
        PhysicalSky { sun, knots }
    }

    /// Linear Rec. 709 radiance of the sky in the unit direction `dir` (above the horizon), in the
    /// model's units; zero below.
    pub fn radiance(&self, dir: Vec3) -> Rgb {
        if dir.z <= 0.0 {
            return Rgb::BLACK;
        }
        let s = self.sun;
        let cos_theta = dir.z;
        let cos_gamma = dir.dot(s).clamp(-1.0, 1.0);
        let gamma = fmath::atan2(dir.cross(s).length(), dir.dot(s));
        let chord = dir - s;
        let chord2 = chord.dot(chord);
        let cg2 = cos_gamma * cos_gamma;
        let horizon = 1.0 / (cos_theta + 0.01);
        let sq = cos_theta.sqrt();
        let mut out = [0.0f32; 3];
        for knot in &self.knots {
            for (c, o) in out.iter_mut().enumerate() {
                let [a, b, cc, d, e, f, g, h, i] = knot.coefficients[c];
                let den = (1.0 - h) * (1.0 - h) + h * chord2;
                let chi = (1.0 + cg2) / (den * den.sqrt());
                let value = (1.0 + a * exp(b * horizon))
                    * (cc + d * exp(e * gamma) + f * cg2 + g * chi + i * sq);
                *o += knot.weight * value * knot.radiance[c];
            }
        }
        Rgb::new(out[0].max(0.0), out[1].max(0.0), out[2].max(0.0))
    }
}

/// The Perez coefficients `[A, B, C, D, E]` as `(slope, intercept)` in the turbidity, for `Y`,
/// `x` and `y` (Preetham et al. 1999, Appendix A.2).
const PEREZ: [[(f32, f32); 5]; 3] = [
    [
        (0.1787, -1.4630),
        (-0.3554, 0.4275),
        (-0.0227, 5.3251),
        (0.1206, -2.5771),
        (-0.0670, 0.3703),
    ],
    [
        (-0.0193, -0.2592),
        (-0.0665, 0.0008),
        (-0.0004, 0.2125),
        (-0.0641, -0.8989),
        (-0.0033, 0.0452),
    ],
    [
        (-0.0167, -0.2608),
        (-0.0950, 0.0092),
        (-0.0079, 0.2102),
        (-0.0441, -1.6537),
        (-0.0109, 0.0529),
    ],
];

/// The zenith chromaticity fits: `x_z`, `y_z` = `[T², T, 1] · M · [θs³, θs², θs, 1]`.
const ZENITH_X: [[f32; 4]; 3] = [
    [0.00166, -0.00375, 0.00209, 0.0],
    [-0.02903, 0.06377, -0.03202, 0.00394],
    [0.11693, -0.21196, 0.06052, 0.25886],
];
const ZENITH_Y: [[f32; 4]; 3] = [
    [0.00275, -0.00610, 0.00317, 0.0],
    [-0.04214, 0.08970, -0.04153, 0.00516],
    [0.15346, -0.26756, 0.06670, 0.26688],
];

/// `e^x` for the Perez terms, with the argument kept where `f32` lives.
#[inline]
fn exp(x: f32) -> f32 {
    fmath::exp(x.clamp(-80.0, 80.0))
}

/// The Preetham sky for one sun position and turbidity, before scaling.
#[derive(Clone, Debug, PartialEq)]
pub struct Preetham {
    /// Unit direction towards the sun.
    pub sun: Vec3,
    coefficients: [[f32; 5]; 3],
    /// `Y_z / F(0, θs)`, `x_z / F(0, θs)`, `y_z / F(0, θs)` per quantity.
    zenith_over_perez: [f32; 3],
}

impl Preetham {
    /// The sky with the sun `elevation_deg` above the horizon at `azimuth_deg` (measured from +X
    /// towards +Y, Z up) and turbidity `turbidity` (clamped to `[1.7, 10]`, the model's range).
    pub fn new(azimuth_deg: f32, elevation_deg: f32, turbidity: f32) -> Preetham {
        let t = if turbidity.is_finite() {
            turbidity.clamp(1.7, 10.0)
        } else {
            DEFAULT_TURBIDITY
        };
        let elevation = if elevation_deg.is_finite() {
            elevation_deg.clamp(1.0, 90.0)
        } else {
            45.0
        };
        let azimuth = if azimuth_deg.is_finite() {
            azimuth_deg
        } else {
            0.0
        };
        let (se, ce) = fmath::sin_cos(elevation * fmath::DEG_TO_RAD);
        let (sa, ca) = fmath::sin_cos(azimuth * fmath::DEG_TO_RAD);
        let sun = Vec3::new(ce * ca, ce * sa, se);
        let theta_s = (90.0 - elevation) * fmath::DEG_TO_RAD;

        let mut coefficients = [[0.0f32; 5]; 3];
        for (q, row) in PEREZ.iter().enumerate() {
            for (k, &(slope, intercept)) in row.iter().enumerate() {
                coefficients[q][k] = slope * t + intercept;
            }
        }
        // Zenith luminance (kcd/m²) and chromaticity.
        let chi = (4.0 / 9.0 - t / 120.0) * (fmath::PI - 2.0 * theta_s);
        let (sc, cc) = fmath::sin_cos(chi);
        let y_z = (4.0453 * t - 4.9710) * (sc / cc) - 0.2155 * t + 2.4192;
        let th = [theta_s * theta_s * theta_s, theta_s * theta_s, theta_s, 1.0];
        let poly = |m: &[[f32; 4]; 3]| -> f32 {
            let tt = [t * t, t, 1.0];
            let mut s = 0.0;
            for (i, row) in m.iter().enumerate() {
                let mut r = 0.0;
                for (j, &c) in row.iter().enumerate() {
                    r += c * th[j];
                }
                s += tt[i] * r;
            }
            s
        };
        let zenith = [y_z.max(1.0e-3), poly(&ZENITH_X), poly(&ZENITH_Y)];
        let cs = fmath::cos(theta_s);
        let mut zenith_over_perez = [0.0f32; 3];
        for q in 0..3 {
            let f0 = perez(&coefficients[q], 1.0, theta_s, cs);
            zenith_over_perez[q] = zenith[q] / f0;
        }
        Preetham {
            sun,
            coefficients,
            zenith_over_perez,
        }
    }

    /// Linear Rec. 709 radiance of the sky in the unit direction `dir` (above the horizon), in the
    /// model's units; zero below.
    pub fn radiance(&self, dir: Vec3) -> Rgb {
        if dir.z <= 0.0 {
            return Rgb::BLACK;
        }
        let cos_gamma = dir.dot(self.sun).clamp(-1.0, 1.0);
        let gamma = fmath::acos(cos_gamma);
        let cos_theta = dir.z.max(1.0e-3);
        let mut v = [0.0f32; 3];
        for (q, out) in v.iter_mut().enumerate() {
            *out = self.zenith_over_perez[q]
                * perez(&self.coefficients[q], cos_theta, gamma, cos_gamma);
        }
        let (lum, x, y) = (v[0].max(0.0), v[1], v[2].max(1.0e-4));
        xyy_to_rgb(x, y, lum)
    }
}

/// The Perez distribution `F(θ, γ)` with `cos θ` and `γ`, `cos γ` given.
#[inline]
fn perez(c: &[f32; 5], cos_theta: f32, gamma: f32, cos_gamma: f32) -> f32 {
    (1.0 + c[0] * exp(c[1] / cos_theta))
        * (1.0 + c[2] * exp(c[3] * gamma) + c[4] * cos_gamma * cos_gamma)
}

/// CIE `xyY` to linear Rec. 709 RGB (D65), negatives clamped.
pub fn xyy_to_rgb(x: f32, y: f32, lum: f32) -> Rgb {
    let big_x = x / y * lum;
    let big_z = (1.0 - x - y) / y * lum;
    let r = 3.240_454_2 * big_x - 1.537_138_5 * lum - 0.498_531_4 * big_z;
    let g = -0.969_266 * big_x + 1.876_010_8 * lum + 0.041_556 * big_z;
    let b = 0.055_643_4 * big_x - 0.204_025_9 * lum + 1.057_225_2 * big_z;
    Rgb::new(r.max(0.0), g.max(0.0), b.max(0.0))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dir(azimuth_deg: f32, elevation_deg: f32) -> Vec3 {
        let (se, ce) = fmath::sin_cos(elevation_deg * fmath::DEG_TO_RAD);
        let (sa, ca) = fmath::sin_cos(azimuth_deg * fmath::DEG_TO_RAD);
        Vec3::new(ce * ca, ce * sa, se)
    }

    #[test]
    fn the_zenith_is_darker_and_bluer_than_the_horizon_away_from_the_sun() {
        // A low or middle sun (a high one brightens the zenith with its own glow).
        for (elevation, turbidity) in [(30.0, 2.5), (20.0, 3.0), (12.0, 4.0)] {
            let sky = Preetham::new(0.0, elevation, turbidity);
            let zenith = sky.radiance(Vec3::new(0.0, 0.0, 1.0));
            let horizon = sky.radiance(dir(180.0, 3.0));
            assert!(
                horizon.luminance() > zenith.luminance(),
                "{elevation}: {zenith:?} vs {horizon:?}"
            );
            let blue = |c: Rgb| c.b / c.r;
            assert!(
                blue(zenith) > blue(horizon),
                "{elevation}: {zenith:?} vs {horizon:?}"
            );
            assert!(zenith.b > zenith.r, "the zenith is blue: {zenith:?}");
            // Brightest near the sun, darkest about 90 degrees away from it (the Perez minimum).
            let near = sky.radiance(dir(0.0, elevation + 3.0));
            let away = sky.radiance(dir(180.0, 90.0 - elevation));
            assert!(near.luminance() > 3.0 * away.luminance());
            assert_eq!(sky.radiance(dir(40.0, -5.0)), Rgb::BLACK);
        }
    }

    #[test]
    fn hazier_skies_are_whiter() {
        let saturation = |c: Rgb| (c.b - c.r) / c.luminance();
        let clear = Preetham::new(0.0, 40.0, 2.0).radiance(dir(180.0, 50.0));
        let hazy = Preetham::new(0.0, 40.0, 8.0).radiance(dir(180.0, 50.0));
        assert!(saturation(clear) > saturation(hazy), "{clear:?} {hazy:?}");
    }

    #[test]
    fn the_physical_sky_is_blue_brightest_near_the_sun_and_black_below_the_horizon() {
        for (elevation, turbidity) in [(30.0, 2.5), (12.0, 3.0), (2.0, 4.0), (65.0, 2.0)] {
            let sky = PhysicalSky::new(0.0, elevation, turbidity, GROUND_ALBEDO);
            let zenith = sky.radiance(Vec3::new(0.0, 0.0, 1.0));
            assert!(
                zenith.b > zenith.r,
                "{elevation}: the zenith is blue: {zenith:?}"
            );
            let near = sky.radiance(dir(0.0, elevation + 3.0));
            let away = sky.radiance(dir(180.0, (90.0 - elevation).min(60.0)));
            assert!(near.luminance() > 3.0 * away.luminance(), "{elevation}");
            assert_eq!(sky.radiance(dir(40.0, -5.0)), Rgb::BLACK);
            for d in [dir(10.0, 1.0), dir(200.0, 0.2), dir(90.0, 45.0)] {
                let c = sky.radiance(d);
                assert!(c.r > 0.0 && c.g > 0.0 && c.b > 0.0 && c.luminance().is_finite());
            }
        }
        // Hazier is whiter; a lower sun is warmer at the horizon beside it.
        let saturation = |c: Rgb| (c.b - c.r) / c.luminance();
        let clear = PhysicalSky::new(0.0, 40.0, 2.0, GROUND_ALBEDO).radiance(dir(180.0, 50.0));
        let hazy = PhysicalSky::new(0.0, 40.0, 8.0, GROUND_ALBEDO).radiance(dir(180.0, 50.0));
        assert!(saturation(clear) > saturation(hazy), "{clear:?} {hazy:?}");
        let warm = |el: f32| {
            let c = PhysicalSky::new(0.0, el, 3.0, GROUND_ALBEDO).radiance(dir(20.0, 2.0));
            c.r / c.b
        };
        assert!(warm(1.0) > warm(40.0));
    }

    #[test]
    fn the_physical_sky_is_linear_between_knots_and_clamps_its_inputs() {
        // A quarter of the way between two turbidities (and two albedos) is the weighted mean
        // of their radiances.
        for d in [Vec3::new(0.0, 0.0, 1.0), dir(30.0, 20.0), dir(200.0, 3.0)] {
            let r = |t: f32, a: f32| PhysicalSky::new(10.0, 15.0, t, a).radiance(d);
            let (mid, lo, hi) = (r(4.25, 0.0), r(4.0, 0.0), r(5.0, 0.0));
            for (m, (a, b)) in [mid.r, mid.g, mid.b]
                .into_iter()
                .zip([lo.r, lo.g, lo.b].into_iter().zip([hi.r, hi.g, hi.b]))
            {
                let want = 0.75 * a + 0.25 * b;
                assert!(
                    (m - want).abs() <= 2.0e-6 * m.abs().max(1.0e-9),
                    "{m} {a} {b}"
                );
            }
            let (grey, black, white) = (r(4.0, 0.25), r(4.0, 0.0), r(4.0, 1.0));
            let want = 0.75 * black.g + 0.25 * white.g;
            assert!((grey.g - want).abs() <= 2.0e-6 * want, "{grey:?}");
        }
        // Out-of-range and non-finite inputs are clamped like the classic sky's.
        let a = PhysicalSky::new(0.0, 30.0, 10.0, 0.2);
        assert_eq!(PhysicalSky::new(0.0, 30.0, 25.0, 0.2), a);
        assert_eq!(
            PhysicalSky::new(0.0, -5.0, 3.0, 0.2),
            PhysicalSky::new(0.0, 0.0, 3.0, 0.2)
        );
        assert_eq!(
            PhysicalSky::new(0.0, 30.0, f32::NAN, 0.2),
            PhysicalSky::new(0.0, 30.0, DEFAULT_TURBIDITY, 0.2)
        );
        assert_eq!(
            PhysicalSky::new(0.0, 30.0, 3.0, 7.0),
            PhysicalSky::new(0.0, 30.0, 3.0, 1.0)
        );
        // The table is the one rt-sky wrote (its own test checks the hash and the sources).
        assert_eq!(crate::sky_table::SHA256.len(), 64);
    }

    #[test]
    fn xyy_of_d65_white_is_grey() {
        let c = xyy_to_rgb(0.312_7, 0.329, 1.0);
        for v in [c.r, c.g, c.b] {
            assert!((v - 1.0).abs() < 2.0e-3, "{c:?}");
        }
    }
}
