//! The forward lobe of the ambient particles (S4b): the share of the light that a mote of dust,
//! a grain of pollen or of a dust cloud scatters around the direction it was travelling, so that
//! a light behind the product lights them up in its beam.
//!
//! **The lobe.** The phase function of L. G. Henyey and J. L. Greenstein, "Diffuse radiation in
//! the galaxy", *Astrophysical Journal* 93, 1941:
//!
//! ```text
//! p(μ) = (1 − g²) / (4π (1 + g² − 2 g μ)^{3/2})
//! ```
//!
//! per steradian, where `μ` is the cosine between the direction the light travelled before the
//! particle and after it (`μ = −wi · wo`: `wi` points to the light, `wo` to the viewer) and `g`
//! the mean of that cosine, 0.7 for the presets: well forward, but broad. `∫ p dω = 1`. A particle
//! scatters like a small cloud of it, not like a surface: the lobe is
//! `share · albedo · p(μ)` per unit of incident radiance and solid angle, whatever the normal of
//! the point that was hit, so as a BSDF (whose integrand the integrator multiplies by `|cos θi|`)
//! it is that over `|wi.z|`. The particle's material keeps the rest, `1 − share`, of what it
//! scatters: the mixture never reflects more than the larger of the two parts would, and a white
//! one (albedo 1 and a white surface) gives back exactly what it receives.
//!
//! **Sampling.** The lobe is chosen with probability `share`, and inside it `μ` by inverting the
//! cumulative distribution, `μ = (1 + g² − ((1 − g²) / (1 − g + 2 g ξ))²) / (2 g)` (isotropic for
//! `|g| < 10⁻³`), the azimuth uniformly; [`Bsdf::pdf`] is the density of the whole mixture, which
//! is what the MIS of next-event estimation (E12) weighs against. The integrator sends the rays of
//! the lobe that go through the particle on from its far side ([`crate::integrator`]).

use super::{Bsdf, BsdfSample, Lobes};
use crate::color::Rgb;
use crate::fmath;
use crate::math::{Frame, Vec3};

/// Largest `|g|`: beyond it the lobe is so narrow that a light sample would almost never find it.
pub const MAX_G: f32 = 0.95;

/// Below this `|wi.z|` the lobe is left out of [`Bsdf::eval`] (it is `… / |wi.z|` there): a band
/// of directions of measure 4π·10⁻⁶ sr, where `f` would overflow.
const MIN_COS: f32 = 1.0e-6;

/// The forward lobe of a particle's BSDF.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Forward {
    /// Share of what the particle scatters that goes into the lobe, 0..1 (0: no lobe).
    pub share: f32,
    /// Henyey–Greenstein asymmetry, `−MAX_G..MAX_G`.
    pub g: f32,
    /// Albedo of the lobe (the particle's colour), 0..1 per channel.
    pub albedo: Rgb,
}

impl Forward {
    /// No lobe.
    pub const NONE: Forward = Forward {
        share: 0.0,
        g: 0.0,
        albedo: Rgb::BLACK,
    };

    /// A lobe of `share` (clamped to 0..1, NaN none) and asymmetry `g` (clamped to ±[`MAX_G`],
    /// NaN 0) with `albedo` (clamped to 0..1).
    pub fn new(share: f32, g: f32, albedo: Rgb) -> Forward {
        let share = if share.is_nan() {
            0.0
        } else {
            share.clamp(0.0, 1.0)
        };
        let g = if g.is_nan() {
            0.0
        } else {
            g.clamp(-MAX_G, MAX_G)
        };
        Forward {
            share,
            g,
            albedo: albedo.map(|v| if v.is_nan() { 0.0 } else { v.clamp(0.0, 1.0) }),
        }
    }

    /// True when there is a lobe.
    #[inline]
    pub fn is_on(&self) -> bool {
        self.share > 0.0
    }

    /// `p(μ)`, per steradian.
    #[inline]
    pub fn phase(&self, mu: f32) -> f32 {
        let g = self.g;
        let t = (1.0 + g * g - 2.0 * g * mu.clamp(-1.0, 1.0)).max(1.0e-12);
        (1.0 - g * g) * (0.25 * fmath::FRAC_1_PI) / (t * t.sqrt())
    }

    /// The lobe times `|cos θi|`, `share · albedo · p(−wi · wo)`, per unit of radiance arriving
    /// along `-wi` (any frame: it does not depend on the normal).
    #[inline]
    pub fn value(&self, wo: Vec3, wi: Vec3) -> Rgb {
        self.albedo * (self.share * self.phase(-wi.dot(wo)))
    }

    /// A direction of the lobe for the 2-D sample `u` (unit `wo` in any frame): `wi` and its
    /// density `p(μ)`.
    pub fn sample(&self, wo: Vec3, u: (f32, f32)) -> (Vec3, f32) {
        let g = self.g;
        let mu = if g.abs() < 1.0e-3 {
            1.0 - 2.0 * u.0
        } else {
            let s = (1.0 - g * g) / (1.0 - g + 2.0 * g * u.0);
            (1.0 + g * g - s * s) / (2.0 * g)
        }
        .clamp(-1.0, 1.0);
        let sin = (1.0 - mu * mu).max(0.0).sqrt();
        let (s, c) = fmath::sin_cos(fmath::TAU * u.1);
        // Around the direction the path travels on, -wo.
        let frame = Frame::from_normal(-wo);
        let wi = frame.to_world(Vec3::new(sin * c, sin * s, mu)).normalize();
        (wi, self.phase(-wi.dot(wo)))
    }
}

impl Bsdf {
    /// The same BSDF with the forward lobe `forward` (S4b): `forward.share` of what it scatters
    /// goes into the lobe, the rest is the surface's.
    pub fn with_forward(mut self, forward: Forward) -> Bsdf {
        self.forward = forward;
        self
    }

    /// The forward lobe (S4b; [`Forward::NONE`] for every surface but an ambient particle's).
    pub fn forward(&self) -> Forward {
        self.forward
    }

    /// `f(wo, wi)` (without the cosine). Zero unless `wo` is above the surface; `wi` below it
    /// is the refraction of a solid clear part (thin walls transmit only straight, which no
    /// evaluation sees), or the forward lobe of a particle (S4b), which every light lights as the
    /// diffuse lobe is (`lobes` does not leave it out).
    #[inline]
    pub fn eval(&self, wo: Vec3, wi: Vec3, lobes: Lobes) -> Rgb {
        let surface = self.eval_surface(wo, wi, lobes);
        if !self.forward.is_on() {
            return surface;
        }
        if wo.z <= 0.0 {
            return Rgb::BLACK;
        }
        let cos = wi.z.abs();
        let lobe = if cos > MIN_COS {
            self.forward.value(wo, wi) * (1.0 / cos)
        } else {
            Rgb::BLACK
        };
        surface * (1.0 - self.forward.share) + lobe
    }

    /// Density, per steradian, with which [`Bsdf::sample`] returns `wi` for this `wo` (the
    /// straight transmission of thin walls, a delta, is not part of it): with a forward lobe, the
    /// mixture of the surface's density and the lobe's, each by its probability.
    #[inline]
    pub fn pdf(&self, wo: Vec3, wi: Vec3) -> f32 {
        let surface = self.pdf_surface(wo, wi);
        if !self.forward.is_on() {
            return surface;
        }
        if wo.z <= 0.0 {
            return 0.0;
        }
        let p = self.forward.share;
        surface * (1.0 - p) + self.forward.phase(-wi.dot(wo)) * p
    }

    /// Samples an incident direction for `wo` from the 2-D sample `u`. `None` when the surface
    /// scatters nothing towards `wo`, or the sampled direction is not on the side its lobe
    /// scatters to (total internal reflection of a microfacet included). With a forward lobe the
    /// first dimension chooses it with probability `share` (rescaled for what follows), and the
    /// weight is that of the mixture, `f |cos| / pdf` with [`Bsdf::eval`] and [`Bsdf::pdf`].
    #[inline]
    pub fn sample(&self, wo: Vec3, u: (f32, f32)) -> Option<BsdfSample> {
        if !self.forward.is_on() {
            return self.sample_surface(wo, u);
        }
        if wo.z <= 0.0 {
            return None;
        }
        let p = self.forward.share;
        let wi = if u.0 < p {
            let u0 = (u.0 / p).clamp(0.0, 0.999_999_94);
            self.forward.sample(wo, (u0, u.1)).0
        } else {
            let u0 = ((u.0 - p) / (1.0 - p)).clamp(0.0, 0.999_999_94);
            let s = self.sample_surface(wo, (u0, u.1))?;
            if s.straight {
                // A thin wall's straight transmission: its share of the mixture, chosen as often.
                return Some(BsdfSample {
                    pdf: s.pdf * (1.0 - p),
                    ..s
                });
            }
            s.wi
        };
        let pdf = self.pdf(wo, wi);
        if !(pdf > 0.0 && pdf.is_finite()) {
            return None;
        }
        let weight = self.eval(wo, wi, Lobes::All) * (wi.z.abs() / pdf);
        Some(BsdfSample {
            wi,
            weight,
            pdf,
            straight: false,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rng::Pcg32;
    use crate::scene::Material;

    fn dir(theta_deg: f32, phi_deg: f32) -> Vec3 {
        let (st, ct) = fmath::sin_cos(theta_deg * fmath::DEG_TO_RAD);
        let (sp, cp) = fmath::sin_cos(phi_deg * fmath::DEG_TO_RAD);
        Vec3::new(st * cp, st * sp, ct)
    }

    /// `∫ f(μ) 2π dμ` over `[a, b]` by the midpoint rule, in f64.
    fn integral(f: impl Fn(f32) -> f64, a: f32, b: f32, steps: u32) -> f64 {
        let h = (b - a) as f64 / steps as f64;
        (0..steps)
            .map(|i| f((a as f64 + (i as f64 + 0.5) * h) as f32) * std::f64::consts::TAU * h)
            .sum()
    }

    #[test]
    fn the_phase_function_integrates_to_one_with_g_as_its_mean_cosine() {
        for g in [0.0, 0.3, 0.7, -0.5, 0.95] {
            let lobe = Forward::new(1.0, g, Rgb::WHITE);
            let total = integral(|mu| lobe.phase(mu) as f64, -1.0, 1.0, 400_000);
            let mean = integral(|mu| (mu * lobe.phase(mu)) as f64, -1.0, 1.0, 400_000);
            eprintln!("g {g}: ∫p {total}, mean cosine {mean}");
            assert!((total - 1.0).abs() < 1.0e-3, "g {g}: {total}");
            assert!((mean - g as f64).abs() < 2.0e-3, "g {g}: {mean}");
        }
        // The presets' lobe sends most of the light within 45° of where it was going.
        let lobe = Forward::new(1.0, 0.7, Rgb::WHITE);
        let ahead = integral(
            |mu| lobe.phase(mu) as f64,
            std::f32::consts::FRAC_1_SQRT_2,
            1.0,
            100_000,
        );
        assert!(ahead > 0.6, "{ahead}");
    }

    #[test]
    fn the_lobe_samples_its_own_density() {
        for g in [0.7, -0.4, 0.0] {
            let lobe = Forward::new(1.0, g, Rgb::WHITE);
            let wo = dir(30.0, 40.0);
            let n = 200_000u32;
            const BINS: usize = 20;
            let mut counts = [0u32; BINS];
            let mut rng = Pcg32::seeded(3, 9);
            for _ in 0..n {
                let (wi, pdf) = lobe.sample(wo, (rng.next_f32(), rng.next_f32()));
                assert!((wi.length() - 1.0).abs() < 1.0e-5);
                let mu = -wi.dot(wo);
                assert!((pdf / lobe.phase(mu) - 1.0).abs() < 1.0e-4, "{pdf}");
                let bin = (((mu + 1.0) * 0.5 * BINS as f32) as usize).min(BINS - 1);
                counts[bin] += 1;
            }
            for (bin, &count) in counts.iter().enumerate() {
                let a = -1.0 + 2.0 * bin as f32 / BINS as f32;
                let b = a + 2.0 / BINS as f32;
                let expected = integral(|mu| lobe.phase(mu) as f64, a, b, 2_000) * n as f64;
                let sigma = expected.sqrt().max(1.0);
                assert!(
                    (count as f64 - expected).abs() < 5.0 * sigma,
                    "g {g}, bin {bin}: {count} vs {expected}"
                );
            }
        }
    }

    /// `∫ f |cos| dωi` for `wo`, estimated by sampling the BSDF.
    fn albedo(bsdf: &Bsdf, wo: Vec3, n: u32) -> Rgb {
        let mut rng = Pcg32::seeded(23, u64::from(n));
        let mut sum = Rgb::BLACK;
        for _ in 0..n {
            if let Some(s) = bsdf.sample(wo, (rng.next_f32(), rng.next_f32())) {
                sum += s.weight;
            }
        }
        sum / n as f32
    }

    #[test]
    fn a_white_particle_with_a_forward_lobe_gives_back_all_it_receives() {
        // The white furnace of the BSDF: a white Lambertian surface with a white lobe of any
        // share reflects and scatters exactly what it receives, from any direction.
        for share in [0.25, 0.5, 1.0] {
            let bsdf = Bsdf::lambert(Rgb::WHITE).with_forward(Forward::new(share, 0.7, Rgb::WHITE));
            for theta in [0.0, 45.0, 80.0] {
                let a = albedo(&bsdf, dir(theta, 10.0), 400_000).g;
                assert!((a - 1.0).abs() < 0.01, "share {share}, {theta}°: {a}");
            }
        }
        // Otherwise the mixture: the surface's share of its own albedo and the lobe's share of
        // the particle's colour (the dust's material, rough and specular).
        let dust = Material {
            base_color: Rgb::new(0.8, 0.78, 0.74),
            roughness: 0.35,
            ..Material::default()
        };
        for theta in [10.0, 60.0] {
            let wo = dir(theta, 0.0);
            let surface = albedo(&Bsdf::principled(&dust), wo, 400_000);
            let lobe = Forward::new(0.5, 0.7, dust.base_color);
            let mixed = albedo(&Bsdf::principled(&dust).with_forward(lobe), wo, 400_000);
            let expected = surface * 0.5 + dust.base_color * 0.5;
            for (m, e) in [(mixed.r, expected.r), (mixed.b, expected.b)] {
                assert!((m / e - 1.0).abs() < 0.015, "{theta}°: {m} vs {e}");
            }
        }
    }

    #[test]
    fn sampled_weights_are_eval_cos_over_pdf_and_the_pdf_is_a_density() {
        let dust = Material {
            base_color: Rgb::new(0.8, 0.78, 0.74),
            roughness: 0.35,
            ..Material::default()
        };
        let plain = Bsdf::principled(&dust);
        let bsdf = plain.with_forward(Forward::new(0.5, 0.7, dust.base_color));
        let mut rng = Pcg32::seeded(5, 1);
        for theta in [5.0, 50.0, 85.0] {
            let wo = dir(theta, 120.0);
            for _ in 0..2000 {
                let Some(s) = bsdf.sample(wo, (rng.next_f32(), rng.next_f32())) else {
                    continue;
                };
                // The density MIS weighs against is the one the sample was drawn with.
                let pdf = bsdf.pdf(wo, s.wi);
                assert!((s.pdf / pdf - 1.0).abs() < 1.0e-4, "{} vs {pdf}", s.pdf);
                let w = bsdf.eval(wo, s.wi, Lobes::All) * (s.wi.z.abs() / pdf);
                assert!((s.weight.g - w.g).abs() <= 1.0e-4 * w.g.max(1.0), "{s:?}");
            }
            // The mixture's density integrates to one over the sphere (uniform directions).
            let n = 400_000;
            let mut total = 0.0f64;
            for _ in 0..n {
                let z = 1.0 - 2.0 * rng.next_f32();
                let r = (1.0 - z * z).max(0.0).sqrt();
                let (s, c) = fmath::sin_cos(fmath::TAU * rng.next_f32());
                total += bsdf.pdf(wo, Vec3::new(r * c, r * s, z)) as f64;
            }
            let total = total * 4.0 * std::f64::consts::PI / n as f64;
            assert!((total - 1.0).abs() < 0.02, "{theta}°: ∫pdf {total}");
        }
        // No lobe: the surface's own numbers, bit for bit.
        let none = plain.with_forward(Forward::NONE);
        for _ in 0..200 {
            let u = (rng.next_f32(), rng.next_f32());
            let (wo, wi) = (dir(35.0, 10.0), dir(60.0 * u.0, 360.0 * u.1));
            assert_eq!(none.sample(wo, u), plain.sample(wo, u));
            assert_eq!(none.pdf(wo, wi).to_bits(), plain.pdf(wo, wi).to_bits());
            assert_eq!(
                none.eval(wo, wi, Lobes::All),
                plain.eval(wo, wi, Lobes::All)
            );
        }
    }
}
