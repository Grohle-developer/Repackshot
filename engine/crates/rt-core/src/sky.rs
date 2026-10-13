//! The procedural daylight sky of `ENVR.kind` 2: the analytic model of A. J. Preetham, P. Shirley
//! and B. Smits, "A Practical Analytic Model for Daylight", SIGGRAPH 1999 (formulas and the
//! coefficient table of its Appendix A.2, public literature). The preferred model is L. Hošek and
//! A. Wilkie's (SIGGRAPH 2012; reference implementation v1.4a, 3-clause BSD), whose coefficient
//! tables were not ported in E5: this model is the fallback the phase allows, behind the same
//! interface (`Preetham::new`, `radiance`), so the other one can replace it.
//!
//! The sky's luminance `Y` and chromaticity `x`, `y` in a direction at angle `θ` from the zenith
//! and `γ` from the sun follow the distribution of R. Perez, R. Seals and J. Michalsky (1993),
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
//! **Scale.** The model's absolute level (kilocandela per square metre) has no meaning next to the
//! recipes' lights, which were tuned against the studio dome. So the sky is scaled to give a
//! horizontal surface the same irradiance as the dome of the same `ENVR` values would
//! (`2π (horizon / 6 + zenith / 3)` times `strength`): switching a setup between the dome and
//! the sky keeps its fill light, and only its colour and distribution change. The sun disc is the
//! scene's `SUN` light, not part of the sky; the sky only puts the sun's glow where that light is.
//!
//! **Below the horizon** the sky is a neutral ground of radiance `floor · strength`, like the
//! dome's floor. The sun's elevation is clamped to `[1°, 90°]` (the model does not describe
//! twilight). The sky is tabulated once per scene into a [`SKY_WIDTH`] x [`SKY_HEIGHT`]
//! equirectangular image ([`crate::environment`] looks it up and importance-samples it).

use crate::color::Rgb;
use crate::fmath;
use crate::math::Vec3;

/// Columns of the tabulated sky.
pub const SKY_WIDTH: u32 = 256;
/// Rows of the tabulated sky (the horizon falls between rows).
pub const SKY_HEIGHT: u32 = 128;
/// Turbidity used when the file gives none (a clear day).
pub const DEFAULT_TURBIDITY: f32 = 3.0;

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
    fn xyy_of_d65_white_is_grey() {
        let c = xyy_to_rgb(0.312_7, 0.329, 1.0);
        for v in [c.r, c.g, c.b] {
            assert!((v - 1.0).abs() < 2.0e-3, "{c:?}");
        }
    }
}
