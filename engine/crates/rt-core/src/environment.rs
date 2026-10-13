//! The environment as a light: the procedural studio dome (`ENVR.kind` 0) and the flat colour
//! (kind 1). The reserved sky (2) and HDRI (3) kinds render as the dome until E5.
//!
//! The dome's radiance depends only on the `z` of the direction (the world is Z-up): it ramps
//! linearly from `floor` at `z = -1` to `horizon` at `z = 0` and on to `zenith` at `z = +1`, the
//! ramp of the interface's preview (`p = (1 + z) / 2` over floor, horizon, zenith), scaled by
//! `strength`. A flat environment is the same ramp with three equal values.
//!
//! **Importance sampling.** Because `dω = dz dφ`, a direction density proportional to the
//! radiance is a density proportional to `L(z)` over `z ∈ [-1, 1]` times a uniform azimuth. That
//! 1-D density is piecewise linear, so its CDF is piecewise quadratic and is inverted in closed
//! form (one square root): pick the lower or upper half by its mass, then solve for `z` inside
//! it. The density per steradian is `L(z) / (2π ∫L dz)`, exact, which multiple importance
//! sampling needs.

use crate::color::Rgb;
use crate::fmath;
use crate::math::Vec3;
use crate::scene::{EnvKind, Environment};

/// The environment prepared for rendering.
#[derive(Clone, Debug, PartialEq)]
pub struct EnvLight {
    /// Radiance straight down, at the horizon and straight up (strength applied, never negative).
    floor: f32,
    horizon: f32,
    zenith: f32,
    /// `∫ L dz` over the lower half (`z ∈ [-1, 0]`) and over the whole range.
    lower_mass: f32,
    total_mass: f32,
}

impl EnvLight {
    /// Prepares `env`.
    pub fn new(env: &Environment) -> EnvLight {
        let strength = env.strength.max(0.0);
        let (floor, horizon, zenith) = match env.kind {
            EnvKind::Flat => (env.horizon, env.horizon, env.horizon),
            // The sky and HDRI kinds are reserved for E5: the dome stands in for them.
            EnvKind::Studio | EnvKind::Sky | EnvKind::Hdri => (env.floor, env.horizon, env.zenith),
        };
        let (floor, horizon, zenith) = (
            (floor * strength).max(0.0),
            (horizon * strength).max(0.0),
            (zenith * strength).max(0.0),
        );
        let lower_mass = 0.5 * (floor + horizon);
        let upper_mass = 0.5 * (horizon + zenith);
        EnvLight {
            floor,
            horizon,
            zenith,
            lower_mass,
            total_mass: lower_mass + upper_mass,
        }
    }

    /// True when the environment emits nothing.
    pub fn is_black(&self) -> bool {
        self.total_mass <= 0.0
    }

    /// Radiance as a function of the `z` of a unit direction.
    #[inline]
    fn value(&self, z: f32) -> f32 {
        let z = z.clamp(-1.0, 1.0);
        // Written as weighted sums so that the three stops are reproduced exactly.
        if z < 0.0 {
            self.floor * -z + self.horizon * (1.0 + z)
        } else {
            self.horizon * (1.0 - z) + self.zenith * z
        }
    }

    /// Radiance arriving from the unit direction `dir` (looking along `dir`).
    pub fn radiance(&self, dir: Vec3) -> Rgb {
        Rgb::splat(self.value(dir.z))
    }

    /// Mean radiance over the sphere of directions.
    pub fn mean_radiance(&self) -> f32 {
        0.5 * self.total_mass
    }

    /// Density per steradian with which [`EnvLight::sample`] returns the unit direction `dir`.
    pub fn pdf(&self, dir: Vec3) -> f32 {
        if self.is_black() {
            return 0.0;
        }
        self.value(dir.z) / (fmath::TAU * self.total_mass)
    }

    /// A direction distributed in proportion to the radiance, and its density per steradian.
    /// `None` for a black environment.
    pub fn sample(&self, u: (f32, f32)) -> Option<(Vec3, f32)> {
        if self.is_black() {
            return None;
        }
        let target = u.0 * self.total_mass;
        let z = if target < self.lower_mass {
            -1.0 + invert_linear(self.floor, self.horizon, target / self.lower_mass)
        } else {
            let upper = self.total_mass - self.lower_mass;
            let fraction = ((target - self.lower_mass) / upper).clamp(0.0, 1.0);
            invert_linear(self.horizon, self.zenith, fraction)
        };
        let z = z.clamp(-1.0, 1.0);
        let r = ((1.0 - z) * (1.0 + z)).max(0.0).sqrt();
        let (s, c) = fmath::sin_cos(fmath::TAU * u.1);
        let dir = Vec3::new(r * c, r * s, z);
        let pdf = self.pdf(dir);
        (pdf > 0.0).then_some((dir, pdf))
    }
}

/// Inverse CDF on `[0, 1]` of the density proportional to `a + (b - a) t`: the `t` below which a
/// fraction `u` of the mass lies. Solves `(b - a) t² / 2 + a t = u (a + b) / 2` in the form that
/// does not cancel.
#[inline]
fn invert_linear(a: f32, b: f32, u: f32) -> f32 {
    let c = u * 0.5 * (a + b);
    let denom = a + (a * a + 2.0 * (b - a) * c).max(0.0).sqrt();
    if denom > 0.0 {
        (2.0 * c / denom).clamp(0.0, 1.0)
    } else {
        0.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rng::Pcg32;

    fn dome(floor: f32, horizon: f32, zenith: f32) -> EnvLight {
        EnvLight::new(&Environment {
            kind: EnvKind::Studio,
            floor,
            horizon,
            zenith,
            strength: 2.0,
            ..Environment::default()
        })
    }

    #[test]
    fn the_dome_ramps_from_floor_through_horizon_to_zenith() {
        let env = dome(0.1, 0.3, 0.6);
        assert_eq!(env.radiance(Vec3::new(0.0, 0.0, -1.0)).g, 0.2);
        assert_eq!(env.radiance(Vec3::new(1.0, 0.0, 0.0)).g, 0.6);
        assert_eq!(env.radiance(Vec3::new(0.0, 0.0, 1.0)).g, 1.2);
        assert!((env.radiance(Vec3::new(0.0, 0.8, 0.6)).g - (0.6 + 0.6 * 0.6)).abs() < 1.0e-6);
        // Mean over the sphere: (0.2 + 0.6) / 4 + (0.6 + 1.2) / 4.
        assert!((env.mean_radiance() - 0.65).abs() < 1.0e-6);
        // Flat: horizon everywhere; the reserved kinds fall back to the dome.
        let flat = EnvLight::new(&Environment {
            kind: EnvKind::Flat,
            horizon: 0.5,
            strength: 1.0,
            ..Environment::default()
        });
        assert_eq!(flat.radiance(Vec3::new(0.0, 0.0, -1.0)).r, 0.5);
        assert_eq!(flat.radiance(Vec3::new(0.0, 0.0, 1.0)).r, 0.5);
        for kind in [EnvKind::Sky, EnvKind::Hdri] {
            let e = Environment {
                kind,
                ..Environment::default()
            };
            assert_eq!(
                EnvLight::new(&e),
                EnvLight::new(&Environment {
                    kind: EnvKind::Studio,
                    ..e.clone()
                })
            );
        }
        assert!(EnvLight::new(&Environment {
            strength: 0.0,
            ..Environment::default()
        })
        .is_black());
    }

    #[test]
    fn sampling_follows_the_pdf_and_the_pdf_integrates_to_one() {
        for env in [
            dome(0.1, 0.3, 0.6),
            dome(0.0, 0.0, 1.0),
            dome(1.0, 0.0, 0.0),
            dome(0.4, 0.4, 0.4),
        ] {
            let mut rng = Pcg32::seeded(4, 2);
            let n = 200_000;
            // E[1/pdf] over sampled directions is the measure of the support. Where the
            // radiance is zero nothing is sampled, so compare with the support's measure.
            let mut inv = 0.0f64;
            let mut bins = [0u32; 8];
            for _ in 0..n {
                let (d, pdf) = env
                    .sample((rng.next_f32(), rng.next_f32()))
                    .expect("sample");
                assert!((d.length() - 1.0).abs() < 1.0e-5);
                assert!((env.pdf(d) - pdf).abs() <= 1.0e-6 * pdf);
                inv += 1.0 / pdf as f64;
                bins[(((d.z + 1.0) * 4.0) as usize).min(7)] += 1;
            }
            let support = inv / n as f64 / (4.0 * std::f64::consts::PI);
            assert!(support <= 1.02, "{env:?}: support {support}");
            // Each z bin holds the share of the radiance mass it covers.
            for (i, &count) in bins.iter().enumerate() {
                let (z0, z1) = (-1.0 + i as f32 * 0.25, -1.0 + (i + 1) as f32 * 0.25);
                let mass = 0.125 * (env.value(z0) + env.value(z1));
                let want = mass / env.total_mass;
                let got = count as f32 / n as f32;
                assert!(
                    (got - want).abs() < 0.005,
                    "{env:?} bin {i}: {got} vs {want}"
                );
            }
        }
        // Uniform: the support is the whole sphere and every direction has density 1 / 4π.
        let flat = dome(0.4, 0.4, 0.4);
        let pdf = flat.pdf(Vec3::new(0.0, 1.0, 0.0));
        assert!((pdf - 1.0 / (4.0 * fmath::PI)).abs() < 1.0e-7);
        assert_eq!(dome(0.0, 0.0, 0.0).sample((0.5, 0.5)), None);
    }

    #[test]
    fn the_linear_inverse_cdf_is_exact() {
        for (a, b) in [
            (1.0f32, 1.0f32),
            (0.0, 1.0),
            (1.0, 0.0),
            (0.2, 0.7),
            (3.0, 0.5),
        ] {
            for i in 0..=10 {
                let u = i as f32 / 10.0;
                let t = invert_linear(a, b, u);
                // The mass below t, as a fraction of the whole.
                let mass = (a * t + 0.5 * (b - a) * t * t) / (0.5 * (a + b));
                assert!((mass - u).abs() < 1.0e-5, "a {a} b {b} u {u}: t {t}");
            }
        }
    }
}
