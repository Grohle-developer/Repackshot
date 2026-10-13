//! Wavelength bands, the Sun's spectrum and colour.
//!
//! * **Bands.** [`BANDS`] bands of 10 nm from 380 to 720 nm; every quantity of a band is its mean
//!   over 1-nm steps.
//! * **The Sun** outside the atmosphere is a black body at the nominal effective temperature
//!   5772 K, seen with the nominal solar radius 6.957·10⁸ m from 1 au (IAU 2015 Resolution B3;
//!   the astronomical unit of IAU 2012 Resolution B2), which gives a total irradiance of about
//!   1361 W/m² (G. Kopp and J. L. Lean, GRL 38, 2011). The real spectrum has the Fraunhofer lines
//!   and is some 10 % above this one between 450 and 550 nm; the sky model is scaled to the
//!   studio dome afterwards, so only the colour is affected, and only slightly.
//! * **Colour.** The CIE 1931 2° colour-matching functions as the multi-lobe Gaussian fit of
//!   C. Wyman, P.-P. Sloan and P. Shirley, "Simple Analytic Approximations to the CIE XYZ Color
//!   Matching Functions", JCGT 2(2), 2013 (their equation 2), integrated over each band; XYZ to
//!   linear Rec. 709 RGB with the matrix of IEC 61966-2-1 (D65), the one of `rt_core::sky`.

use crate::dmath;

/// Number of bands.
pub const BANDS: usize = 34;
/// Lower edge of the first band, nm.
pub const LAMBDA_MIN: f64 = 380.0;
/// Width of a band, nm.
pub const BAND_WIDTH: f64 = 10.0;

/// Planck's constant (SI 2019, exact), J s.
pub const PLANCK: f64 = 6.626_070_15e-34;
/// Speed of light, m/s.
pub const LIGHT_SPEED: f64 = 299_792_458.0;
/// Boltzmann's constant (SI 2019, exact), J/K.
pub const BOLTZMANN: f64 = 1.380_649e-23;
/// Nominal effective temperature of the Sun (IAU 2015 B3), K.
pub const SUN_TEMPERATURE: f64 = 5772.0;
/// Nominal solar radius (IAU 2015 B3), m.
pub const SUN_RADIUS: f64 = 6.957e8;
/// Astronomical unit (IAU 2012 B2), m.
pub const AU: f64 = 1.495_978_707e11;

/// Centre of band `k`, nm.
pub fn band_centre(k: usize) -> f64 {
    LAMBDA_MIN + BAND_WIDTH * (k as f64 + 0.5)
}

/// The 1-nm sample wavelengths of band `k` (their centres).
pub fn band_samples(k: usize) -> impl Iterator<Item = f64> {
    let start = LAMBDA_MIN + BAND_WIDTH * k as f64;
    (0..BAND_WIDTH as usize).map(move |i| start + i as f64 + 0.5)
}

/// Mean of `f` over band `k`.
pub fn band_mean(k: usize, f: impl Fn(f64) -> f64) -> f64 {
    band_samples(k).map(f).sum::<f64>() / BAND_WIDTH
}

/// Spectral radiance of a black body, W / (m² sr nm), at `lambda_nm`.
pub fn planck(lambda_nm: f64, temperature: f64) -> f64 {
    let l = lambda_nm * 1.0e-9;
    let x = PLANCK * LIGHT_SPEED / (l * BOLTZMANN * temperature);
    let b = 2.0 * PLANCK * LIGHT_SPEED * LIGHT_SPEED / (l * l * l * l * l) / (dmath::exp(x) - 1.0);
    b * 1.0e-9
}

/// Solar spectral irradiance at the top of the atmosphere, W / (m² nm).
pub fn solar_irradiance(lambda_nm: f64) -> f64 {
    let ratio = SUN_RADIUS / AU;
    dmath::PI * planck(lambda_nm, SUN_TEMPERATURE) * ratio * ratio
}

/// A piecewise Gaussian of Wyman, Sloan and Shirley: `σ1` left of the mean, `σ2` right of it.
#[inline]
fn lobe(x: f64, mu: f64, s1: f64, s2: f64) -> f64 {
    let t = (x - mu) / if x < mu { s1 } else { s2 };
    dmath::exp(-0.5 * t * t)
}

/// The CIE 1931 2° colour-matching functions at `lambda_nm` (the multi-lobe fit).
pub fn cie_xyz(lambda_nm: f64) -> [f64; 3] {
    let l = lambda_nm;
    let x = 1.056 * lobe(l, 599.8, 37.9, 31.0) + 0.362 * lobe(l, 442.0, 16.0, 26.7)
        - 0.065 * lobe(l, 501.1, 20.4, 26.2);
    let y = 0.821 * lobe(l, 568.8, 46.9, 40.5) + 0.286 * lobe(l, 530.9, 16.3, 31.1);
    let z = 1.217 * lobe(l, 437.0, 11.8, 36.0) + 0.681 * lobe(l, 459.0, 26.0, 13.8);
    [x, y, z]
}

/// XYZ to linear Rec. 709 RGB (D65, IEC 61966-2-1).
pub fn xyz_to_rgb(c: [f64; 3]) -> [f64; 3] {
    let [x, y, z] = c;
    [
        3.240_454_2 * x - 1.537_138_5 * y - 0.498_531_4 * z,
        -0.969_266 * x + 1.876_010_8 * y + 0.041_556 * z,
        0.055_643_4 * x - 0.204_025_9 * y + 1.057_225_2 * z,
    ]
}

/// Per band, the integral of each colour-matching function over the band (nm), so that
/// `X = Σ L_k w_k.x` for band radiances `L_k` per nm.
pub fn cmf_weights() -> [[f64; 3]; BANDS] {
    let mut w = [[0.0; 3]; BANDS];
    for (k, wk) in w.iter_mut().enumerate() {
        for l in band_samples(k) {
            let c = cie_xyz(l);
            for i in 0..3 {
                wk[i] += c[i]; // 1-nm steps
            }
        }
    }
    w
}

/// Band radiances to linear Rec. 709 RGB (same units, weighted by the colour-matching functions).
pub fn bands_to_rgb(l: &[f64; BANDS], w: &[[f64; 3]; BANDS]) -> [f64; 3] {
    let mut xyz = [0.0; 3];
    for k in 0..BANDS {
        for i in 0..3 {
            xyz[i] += l[k] * w[k][i];
        }
    }
    xyz_to_rgb(xyz)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_sun_gives_the_solar_constant() {
        // ∫ π B dλ = σ T⁴: numerically from 100 nm to 100 µm.
        let mut total = 0.0;
        let mut l = 100.0;
        while l < 100_000.0 {
            total += solar_irradiance(l + 0.25) * 0.5;
            l += 0.5;
        }
        assert!((total - 1361.0).abs() < 2.0, "{total}");
        // About 1.75 W/m²/nm at 550 nm.
        assert!((solar_irradiance(550.0) - 1.751).abs() < 0.01);
    }

    #[test]
    fn the_colour_matching_fit_has_the_cie_landmarks() {
        // ȳ peaks near 555 nm at about 1; its integral is about 106.9 nm; x̄, ȳ and z̄ integrate
        // to nearly the same value (equal-energy white is x = y = 1/3).
        let w = cmf_weights();
        let sum = |i: usize| w.iter().map(|b| b[i]).sum::<f64>();
        let (x, y, z) = (sum(0), sum(1), sum(2));
        assert!((y - 106.8).abs() < 1.5, "{y}");
        let (cx, cy) = (x / (x + y + z), y / (x + y + z));
        assert!(
            (cx - 1.0 / 3.0).abs() < 0.005 && (cy - 1.0 / 3.0).abs() < 0.005,
            "{cx} {cy}"
        );
        assert!(cie_xyz(555.0)[1] > 0.99 && cie_xyz(555.0)[1] < 1.01);
        // D65 white (xy 0.3127, 0.3290) is RGB (1, 1, 1).
        let y = 1.0;
        let rgb = xyz_to_rgb([0.3127 / 0.329 * y, y, (1.0 - 0.3127 - 0.329) / 0.329 * y]);
        for c in rgb {
            assert!((c - 1.0).abs() < 2.0e-3, "{rgb:?}");
        }
    }
}
