//! Chromatic dispersion of solid glass (phase E9c).
//!
//! **The index per wavelength.** A material with `MATL.abbe` above zero that bounds a clear solid
//! ([`super::medium::is_clear_solid`]) without a scattering medium refracts each wavelength with its own index, from
//! Cauchy's two-term formula `n(λ) = A + B / λ²` (A. L. Cauchy, 1836) fitted to the material's
//! `ior` as the index at the helium d line (587.6 nm) and its Abbe number
//! `V = (n_d - 1) / (n_F - n_C)` (F 486.1 nm, C 656.3 nm, the hydrogen lines):
//! `B = (n_d - 1) / (V (1/λ_F² - 1/λ_C²))`, `A = n_d - B / λ_d²`. Crown glass is about 60, flint
//! and crystal 30 to 40; the lower, the more the colours part.
//!
//! **One wavelength per path.** The renderer has three channels, not a spectrum: each channel is
//! a band of wavelengths (a box: blue 400–490 nm, green 490–580 nm, red 580–700 nm). At the first
//! dispersive surface it meets, a path chooses one channel with probability ⅓ and one wavelength
//! uniformly inside its band, from one hashed dimension of its own ([`crate::sampler::DIM_DISPERSION`]),
//! and from there on carries only that channel, times 3, and refracts at that wavelength at every
//! dispersive surface: the expectation of each channel is what refracting the whole band would
//! give. Paths that meet no dispersive surface stay white, so a scene without one draws exactly
//! the numbers and the pixels it drew before. The photons of [`crate::caustics`] do the same
//! with their own generator. The colour noise this adds is the price of a spectrum in three
//! channels; a light seen through a crystal converges like its caustic.

use super::medium;
use crate::color::Rgb;
use crate::scene::Material;

/// The helium d line, nm: where `ior` is the index.
pub const LAMBDA_D: f32 = 587.6;
/// The hydrogen F line, nm.
pub const LAMBDA_F: f32 = 486.1;
/// The hydrogen C line, nm.
pub const LAMBDA_C: f32 = 656.3;
/// The band of wavelengths of each channel (red, green, blue), nm.
pub const BANDS: [(f32, f32); 3] = [(580.0, 700.0), (490.0, 580.0), (400.0, 490.0)];

/// True when `m` disperses: an Abbe number above zero on a clear solid without a scattering
/// medium (a walk inside one leaves through its boundary at `ior`, so its surface keeps it too).
pub fn is_dispersive(m: &Material) -> bool {
    m.abbe > 0.0 && m.abbe.is_finite() && medium::is_clear_solid(m) && medium::of(m).is_none()
}

/// The index of refraction at `lambda` nm of a glass of index `ior` (at the d line) and Abbe
/// number `abbe` (Cauchy's two terms; at least 1).
pub fn index_at(ior: f32, abbe: f32, lambda: f32) -> f32 {
    let inv2 = |l: f32| 1.0 / (l * l);
    let b = (ior - 1.0) / (abbe * (inv2(LAMBDA_F) - inv2(LAMBDA_C)));
    let a = ior - b * inv2(LAMBDA_D);
    (a + b * inv2(lambda)).max(1.0)
}

/// The channel a path carries from its first dispersive surface on, and its wavelength.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Band {
    /// 0 red, 1 green, 2 blue.
    pub channel: usize,
    /// Wavelength, nm, inside the channel's band.
    pub lambda: f32,
}

impl Band {
    /// The band of the uniform number `u` in `[0, 1)`: a channel with probability ⅓ each, then a
    /// wavelength uniformly in its band.
    pub fn choose(u: f32) -> Band {
        let x = (u.clamp(0.0, 1.0) * 3.0).min(2.999_999_8);
        let channel = (x as usize).min(2);
        let (lo, hi) = BANDS[channel];
        Band {
            channel,
            lambda: lo + (hi - lo) * (x - channel as f32),
        }
    }

    /// `c` carried by this channel alone, times 3 (the probability of having chosen it).
    pub fn mask(self, c: Rgb) -> Rgb {
        match self.channel {
            0 => Rgb::new(3.0 * c.r, 0.0, 0.0),
            1 => Rgb::new(0.0, 3.0 * c.g, 0.0),
            _ => Rgb::new(0.0, 0.0, 3.0 * c.b),
        }
    }

    /// The index of `m` at this wavelength.
    pub fn index(self, m: &Material) -> f32 {
        index_at(m.ior, m.abbe, self.lambda)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_index_follows_cauchy_through_the_d_line_and_the_abbe_number() {
        for (ior, abbe) in [(1.5f32, 60.0f32), (1.56, 40.0), (1.7, 25.0)] {
            assert!((index_at(ior, abbe, LAMBDA_D) - ior).abs() < 1.0e-5);
            let (f, c) = (index_at(ior, abbe, LAMBDA_F), index_at(ior, abbe, LAMBDA_C));
            assert!(
                ((ior - 1.0) / (f - c) - abbe).abs() < 0.01 * abbe,
                "{ior} {abbe}"
            );
            // Blue bends more than red.
            assert!(index_at(ior, abbe, 420.0) > index_at(ior, abbe, 680.0));
        }
    }

    #[test]
    fn a_band_is_a_third_of_the_channels_and_keeps_the_mean() {
        let n = 3000;
        let mut sum = Rgb::BLACK;
        for k in 0..n {
            let b = Band::choose((k as f32 + 0.5) / n as f32);
            let (lo, hi) = BANDS[b.channel];
            assert!(b.lambda >= lo && b.lambda <= hi);
            sum += b.mask(Rgb::new(0.2, 0.5, 0.7));
        }
        let mean = sum * (1.0 / n as f32);
        assert!((mean.r - 0.2).abs() < 1.0e-4 && (mean.g - 0.5).abs() < 1.0e-4);
        assert!((mean.b - 0.7).abs() < 1.0e-4);
        assert_eq!(Band::choose(0.0).channel, 0);
        assert_eq!(Band::choose(0.999_999_9).channel, 2);
    }
}
