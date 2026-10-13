//! The simulated atmosphere: a spherical, stratified shell around the Earth, with air molecules
//! (Rayleigh scattering), aerosols (the turbidity) and ozone (absorption), over a Lambertian
//! ground.
//!
//! **Geometry.** A sphere of radius [`EARTH_RADIUS`] (the IUGG mean radius) and an atmosphere up to
//! [`TOP_ALTITUDE`] (86 km, the top of the 1976 standard's lower model), cut into [`SHELLS`]
//! concentric shells whose thickness grows geometrically from 50 m at the ground. Within a shell
//! every density is constant, its mean over the shell's altitudes, so vertical columns are exact
//! and any straight ray can be integrated and sampled in closed form, shell by shell.
//!
//! **Air.** Number density from the U.S. Standard Atmosphere 1976 (NOAA/NASA/USAF, public
//! domain): temperature linear in geopotential altitude by layers from 288.15 K and 101 325 Pa at
//! sea level, hydrostatic pressure, `n = p / (k T)`. Rayleigh cross-section per molecule
//! (A. Bucholtz, Appl. Opt. 34, 1995; B. A. Bodhaine, N. B. Wood, E. G. Dutton and J. R. Slusser,
//! "On Rayleigh optical depth calculations", J. Atmos. Oceanic Technol. 16, 1999):
//!
//! ```text
//! σ(λ) = 24 π³ / (λ⁴ N_s²) · ((n_s² - 1) / (n_s² + 2))² · F_K(λ)
//! ```
//!
//! with `N_s` the number density of the standard air in which the refractive index `n_s` is given
//! (288.15 K, 1013.25 hPa): `n_s` from E. R. Peck and K. Reeder, JOSA 62, 1972 (300 ppm CO₂),
//! scaled to 360 ppm as in Bodhaine et al. (their eqs. 4 and 5); the King factor `F_K` of air from
//! D. R. Bates, Planet. Space Sci. 32, 1984, for N₂, O₂, Ar and CO₂ (Bodhaine et al. eqs. 23 to
//! 27). The phase function is Rayleigh's with the molecular anisotropy (S. Chandrasekhar,
//! *Radiative Transfer*, 1950): `p(Θ) ∝ (1 + 3γ) + (1 - γ) cos² Θ`, `γ = ρ / (2 - ρ)`, the
//! depolarisation `ρ = 6 (F_K - 1) / (3 + 7 F_K)`. At 550 nm this gives a sea-level Rayleigh
//! optical depth of 0.097, as tabulated by Bodhaine et al.
//!
//! **Aerosols.** The turbidity `T` is Linke's (F. Linke, Beitr. Phys. fr. Atmos. 10, 1922): the
//! optical depth of the hazy atmosphere over that of the clean one, here at 550 nm, so the aerosol
//! optical depth at 550 nm is `(T - 1) τ_R(550)`; its spectral dependence is Ångström's
//! `λ^-α` with `α = 1.3` (A. Ångström, Geogr. Ann. 11, 1929). This is the relation A. J. Preetham,
//! P. Shirley and B. Smits give between their turbidity and Ångström's β (SIGGRAPH 1999,
//! Appendix A.3), so the two models mean the same thing by the same number. The aerosols decay
//! exponentially with altitude, scale height 1.2 km; single-scattering albedo 0.95 and asymmetry
//! factor 0.7, typical values of rural continental aerosol (E. P. Shettle and R. W. Fenn,
//! AFGL-TR-79-0214, 1979). The phase function is W. M. Cornette and J. G. Shanks's (Appl. Opt.
//! 31, 1992), whose parameter `g` is not its mean cosine: that is `3g (4 + g²) / (5 (2 + g²))`,
//! so `g` is solved for the asymmetry factor (0.638 for 0.7; [`cornette_shanks_parameter`]).
//!
//! **Ozone.** Absorption only, in the Chappuis band: the absorption coefficients of K. Leckner,
//! Solar Energy 20, 1978, as tabulated by R. E. Bird and C. Riordan, J. Clim. Appl. Meteor. 25,
//! 1986 (in (atm cm)⁻¹, divided by Loschmidt's number to get a cross-section), for a column of
//! 300 Dobson units (a typical mid-latitude value) in a Gaussian layer centred at 22 km, 15 km at
//! half maximum.

use crate::dmath;
use crate::spectrum::{band_centre, band_mean, BANDS};

/// Mean radius of the Earth (IUGG), m.
pub const EARTH_RADIUS: f64 = 6_371_000.0;
/// Top of the simulated atmosphere above the ground, m.
pub const TOP_ALTITUDE: f64 = 86_000.0;
/// Number of shells.
pub const SHELLS: usize = 64;
/// Thickness of the lowest shell, m.
pub const FIRST_SHELL: f64 = 50.0;

/// Number density of standard air at 288.15 K and 1013.25 hPa (Bodhaine et al. 1999), m⁻³.
const N_STANDARD: f64 = 2.546_899e25;
/// CO₂ in parts per volume by percent (360 ppm).
const CO2_PERCENT: f64 = 0.036;
/// Loschmidt's number (molecules per cm³ at 0 °C and 1 atm, CODATA), as m⁻³.
const LOSCHMIDT: f64 = 2.686_780_111e25;
/// One Dobson unit, molecules per m².
const DOBSON: f64 = 2.686_780_111e20;

/// Ångström's wavelength exponent of the aerosols.
pub const ANGSTROM_ALPHA: f64 = 1.3;
/// Aerosol scale height, m.
pub const AEROSOL_SCALE_HEIGHT: f64 = 1_200.0;
/// Aerosol single-scattering albedo.
pub const AEROSOL_ALBEDO: f64 = 0.95;
/// Asymmetry factor (mean cosine of the scattering angle) of the aerosols.
pub const AEROSOL_ASYMMETRY: f64 = 0.7;
/// Ozone column, Dobson units.
pub const OZONE_DU: f64 = 300.0;
/// Altitude of the ozone maximum, m.
pub const OZONE_PEAK: f64 = 22_000.0;
/// Full width at half maximum of the ozone layer, m.
pub const OZONE_FWHM: f64 = 15_000.0;

/// Ozone absorption coefficients in (atm cm)⁻¹ by wavelength in µm (Leckner 1978, as tabulated by
/// Bird and Riordan 1986), the visible part; zero below 0.44 µm in their table.
const OZONE_LECKNER: [(f64, f64); 24] = [
    (0.44, 0.0),
    (0.45, 0.003),
    (0.46, 0.006),
    (0.47, 0.009),
    (0.48, 0.014),
    (0.49, 0.021),
    (0.50, 0.030),
    (0.51, 0.040),
    (0.52, 0.048),
    (0.53, 0.063),
    (0.54, 0.075),
    (0.55, 0.085),
    (0.57, 0.120),
    (0.593, 0.119),
    (0.61, 0.120),
    (0.63, 0.090),
    (0.656, 0.065),
    (0.6676, 0.051),
    (0.69, 0.028),
    (0.71, 0.018),
    (0.718, 0.015),
    (0.7244, 0.012),
    (0.74, 0.010),
    (0.7525, 0.008),
];

/// U.S. Standard Atmosphere 1976, lower layers: base geopotential altitude (m) and lapse rate
/// (K/m).
const LAYERS: [(f64, f64); 7] = [
    (0.0, -0.0065),
    (11_000.0, 0.0),
    (20_000.0, 0.001),
    (32_000.0, 0.0028),
    (47_000.0, 0.0),
    (51_000.0, -0.0028),
    (71_000.0, -0.002),
];
/// Its constants: g₀ (m/s²), R* (J / (kmol K)), M₀ (kg/kmol), r₀ (m), k (J/K, the 1976 value).
const G0: f64 = 9.806_65;
const R_STAR: f64 = 8_314.32;
const M0: f64 = 28.964_4;
const R0: f64 = 6_356_766.0;
const K_1976: f64 = 1.380_622e-23;

/// Temperature (K) and pressure (Pa) of the 1976 standard atmosphere at geometric altitude `z`
/// (m, up to 86 km).
pub fn standard_atmosphere(z: f64) -> (f64, f64) {
    let h = R0 * z / (R0 + z); // geopotential altitude
    let (mut t, mut p) = (288.15, 101_325.0);
    for (i, &(hb, lapse)) in LAYERS.iter().enumerate() {
        let top = LAYERS.get(i + 1).map_or(f64::INFINITY, |l| l.0);
        let dh = h.min(top) - hb;
        if dh <= 0.0 && i > 0 {
            break;
        }
        let dh = dh.max(0.0);
        let k = G0 * M0 / R_STAR;
        if lapse == 0.0 {
            p *= dmath::exp(-k * dh / t);
        } else {
            let t1 = t + lapse * dh;
            p *= dmath::powf(t / t1, k / lapse);
            t = t1;
        }
        if h <= top {
            break;
        }
    }
    (t, p)
}

/// Number density of air at geometric altitude `z`, m⁻³.
pub fn air_density(z: f64) -> f64 {
    let (t, p) = standard_atmosphere(z.clamp(0.0, TOP_ALTITUDE));
    p / (K_1976 * t)
}

/// Refractive index of standard air minus one at `lambda_nm` (Peck and Reeder 1972, 360 ppm CO₂).
pub fn refractivity(lambda_nm: f64) -> f64 {
    let s2 = {
        let s = 1000.0 / lambda_nm; // µm⁻¹
        s * s
    };
    let n300 = (8_060.51 + 2_480_990.0 / (132.274 - s2) + 17_455.7 / (39.329_57 - s2)) * 1.0e-8;
    n300 * (1.0 + 0.54 * (CO2_PERCENT * 0.01 - 0.0003))
}

/// King factor of air at `lambda_nm` (Bates 1984).
pub fn king_factor(lambda_nm: f64) -> f64 {
    let l = lambda_nm * 1.0e-3; // µm
    let l2 = l * l;
    let n2 = 1.034 + 3.17e-4 / l2;
    let o2 = 1.096 + 1.385e-3 / l2 + 1.448e-4 / (l2 * l2);
    (78.084 * n2 + 20.946 * o2 + 0.934 + CO2_PERCENT * 1.15)
        / (78.084 + 20.946 + 0.934 + CO2_PERCENT)
}

/// Rayleigh scattering cross-section of an air molecule at `lambda_nm`, m².
pub fn rayleigh_cross_section(lambda_nm: f64) -> f64 {
    let n = 1.0 + refractivity(lambda_nm);
    let n2 = n * n;
    let ratio = (n2 - 1.0) / (n2 + 2.0);
    let l = lambda_nm * 1.0e-9;
    let l4 = l * l * l * l;
    24.0 * dmath::PI * dmath::PI * dmath::PI / (l4 * N_STANDARD * N_STANDARD)
        * ratio
        * ratio
        * king_factor(lambda_nm)
}

/// The molecular anisotropy `γ` of the Rayleigh phase function at `lambda_nm`.
pub fn rayleigh_gamma(lambda_nm: f64) -> f64 {
    let f = king_factor(lambda_nm);
    let rho = 6.0 * (f - 1.0) / (3.0 + 7.0 * f);
    rho / (2.0 - rho)
}

/// Ozone absorption cross-section at `lambda_nm`, m² (linear between the table's wavelengths).
pub fn ozone_cross_section(lambda_nm: f64) -> f64 {
    let l = lambda_nm * 1.0e-3;
    let t = &OZONE_LECKNER;
    let k = if l <= t[0].0 {
        0.0
    } else if l >= t[t.len() - 1].0 {
        t[t.len() - 1].1
    } else {
        let i = t.iter().position(|&(w, _)| w > l).unwrap_or(t.len() - 1);
        let ((l0, k0), (l1, k1)) = (t[i - 1], t[i]);
        k0 + (k1 - k0) * (l - l0) / (l1 - l0)
    };
    // (atm cm)⁻¹ → cm² per molecule → m².
    k / (LOSCHMIDT * 1.0e-6) * 1.0e-4
}

/// Shape of the ozone layer (not normalised).
fn ozone_shape(z: f64) -> f64 {
    let sigma = OZONE_FWHM / (2.0 * (2.0 * dmath::ln(2.0)).sqrt());
    let t = (z - OZONE_PEAK) / sigma;
    dmath::exp(-0.5 * t * t)
}

/// Mean of `f` over `[a, b]` (Simpson's rule, 64 intervals).
fn mean_over(a: f64, b: f64, f: impl Fn(f64) -> f64) -> f64 {
    let n = 64;
    let h = (b - a) / n as f64;
    let mut s = f(a) + f(b);
    for i in 1..n {
        s += f(a + h * i as f64) * if i % 2 == 1 { 4.0 } else { 2.0 };
    }
    s * h / 3.0 / (b - a)
}

/// One shell: its densities.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Shell {
    /// Air molecules, m⁻³.
    pub air: f64,
    /// Aerosol extinction per unit of vertical aerosol optical depth, m⁻¹.
    pub aerosol: f64,
    /// Ozone molecules, m⁻³.
    pub ozone: f64,
}

/// Per band, the coefficients that turn the three columns (air molecules, aerosol, ozone) into
/// optical depths, and the scattering parts.
#[derive(Clone, Debug, PartialEq)]
pub struct Optics {
    /// Rayleigh cross-section, m² (scattering only).
    pub rayleigh: [f64; BANDS],
    /// Rayleigh anisotropy `γ`.
    pub rayleigh_gamma: [f64; BANDS],
    /// Vertical aerosol optical depth (extinction).
    pub aerosol: [f64; BANDS],
    /// Ozone cross-section, m² (absorption only).
    pub ozone: [f64; BANDS],
    /// Solar irradiance at the top of the atmosphere, W / (m² nm).
    pub sun: [f64; BANDS],
}

/// The atmosphere of one turbidity.
#[derive(Clone, Debug, PartialEq)]
pub struct Atmosphere {
    /// Shell boundaries as radii from the Earth's centre: `SHELLS + 1` values from the ground up.
    pub radii: Vec<f64>,
    /// The shells, from the ground up.
    pub shells: Vec<Shell>,
    /// The per-band coefficients.
    pub optics: Optics,
    /// Linke turbidity.
    pub turbidity: f64,
    /// The Cornette–Shanks parameter of the aerosols.
    pub aerosol_g: f64,
}

/// Altitudes of the shell boundaries: `SHELLS + 1` values from 0 to [`TOP_ALTITUDE`], thickness
/// growing geometrically from [`FIRST_SHELL`].
pub fn shell_altitudes() -> Vec<f64> {
    // Solve FIRST_SHELL (q^N - 1) / (q - 1) = TOP for q by bisection.
    let n = SHELLS as f64;
    let total = |q: f64| FIRST_SHELL * (dmath::powf(q, n) - 1.0) / (q - 1.0);
    let (mut lo, mut hi) = (1.000_001, 2.0);
    for _ in 0..200 {
        let mid = 0.5 * (lo + hi);
        if total(mid) < TOP_ALTITUDE {
            lo = mid;
        } else {
            hi = mid;
        }
    }
    let q = 0.5 * (lo + hi);
    let mut z = vec![0.0; SHELLS + 1];
    let mut thickness = FIRST_SHELL;
    for i in 1..=SHELLS {
        z[i] = z[i - 1] + thickness;
        thickness *= q;
    }
    z[SHELLS] = TOP_ALTITUDE;
    z
}

/// Vertical optical depth of the molecules (Rayleigh) at `lambda_nm`, from the shells.
pub fn rayleigh_depth(shells: &[Shell], altitudes: &[f64], lambda_nm: f64) -> f64 {
    let column: f64 = shells
        .iter()
        .zip(altitudes.windows(2))
        .map(|(s, z)| s.air * (z[1] - z[0]))
        .sum();
    column * rayleigh_cross_section(lambda_nm)
}

impl Atmosphere {
    /// The atmosphere of Linke turbidity `turbidity` (1: clean air).
    pub fn new(turbidity: f64) -> Atmosphere {
        Atmosphere::with_ozone(turbidity, OZONE_DU)
    }

    /// The atmosphere of Linke turbidity `turbidity` with `ozone_du` Dobson units of ozone (for
    /// the checks: the table uses [`OZONE_DU`]).
    pub fn with_ozone(turbidity: f64, ozone_du: f64) -> Atmosphere {
        let z = shell_altitudes();
        let h = AEROSOL_SCALE_HEIGHT;
        let aerosol_norm = h * (1.0 - dmath::exp(-TOP_ALTITUDE / h));
        let ozone_norm = {
            // ∫ shape dz over the atmosphere, by Simpson over 1-km pieces.
            let mut s = 0.0;
            let mut a = 0.0;
            while a < TOP_ALTITUDE {
                let b = (a + 1_000.0).min(TOP_ALTITUDE);
                s += mean_over(a, b, ozone_shape) * (b - a);
                a = b;
            }
            s
        };
        let ozone_column = ozone_du * DOBSON;
        let shells: Vec<Shell> = z
            .windows(2)
            .map(|w| {
                let (a, b) = (w[0], w[1]);
                Shell {
                    air: mean_over(a, b, air_density),
                    aerosol: (dmath::exp(-a / h) - dmath::exp(-b / h)) / (b - a) * h / aerosol_norm,
                    ozone: mean_over(a, b, ozone_shape) * ozone_column / ozone_norm,
                }
            })
            .collect();
        let tau_r550 = rayleigh_depth(&shells, &z, 550.0);
        let haze = (turbidity - 1.0).max(0.0) * tau_r550;
        let mut optics = Optics {
            rayleigh: [0.0; BANDS],
            rayleigh_gamma: [0.0; BANDS],
            aerosol: [0.0; BANDS],
            ozone: [0.0; BANDS],
            sun: [0.0; BANDS],
        };
        for k in 0..BANDS {
            optics.rayleigh[k] = band_mean(k, rayleigh_cross_section);
            optics.rayleigh_gamma[k] = rayleigh_gamma(band_centre(k));
            optics.aerosol[k] = band_mean(k, |l| haze * dmath::powf(l / 550.0, -ANGSTROM_ALPHA));
            optics.ozone[k] = band_mean(k, ozone_cross_section);
            optics.sun[k] = band_mean(k, crate::spectrum::solar_irradiance);
        }
        Atmosphere {
            radii: z.iter().map(|a| EARTH_RADIUS + a).collect(),
            shells,
            optics,
            turbidity,
            aerosol_g: cornette_shanks_parameter(AEROSOL_ASYMMETRY),
        }
    }

    /// Total extinction coefficient of shell `i` in band `k`, m⁻¹.
    #[inline]
    pub fn extinction(&self, i: usize, k: usize) -> f64 {
        let s = &self.shells[i];
        let o = &self.optics;
        o.rayleigh[k] * s.air + o.aerosol[k] * s.aerosol + o.ozone[k] * s.ozone
    }
}

/// The mean cosine of the Cornette–Shanks phase function of parameter `g`.
pub fn cornette_shanks_asymmetry(g: f64) -> f64 {
    0.6 * g * (4.0 + g * g) / (2.0 + g * g)
}

/// The Cornette–Shanks parameter whose mean cosine is `asymmetry` (bisection; the mean cosine
/// grows with `g` on `[0, 1]`).
pub fn cornette_shanks_parameter(asymmetry: f64) -> f64 {
    let (mut lo, mut hi) = (0.0, 1.0);
    for _ in 0..100 {
        let mid = 0.5 * (lo + hi);
        if cornette_shanks_asymmetry(mid) < asymmetry {
            lo = mid;
        } else {
            hi = mid;
        }
    }
    0.5 * (lo + hi)
}

/// The Rayleigh phase function per steradian for `cos Θ` and anisotropy `gamma`.
#[inline]
pub fn rayleigh_phase(mu: f64, gamma: f64) -> f64 {
    3.0 / (16.0 * dmath::PI * (1.0 + 2.0 * gamma)) * ((1.0 + 3.0 * gamma) + (1.0 - gamma) * mu * mu)
}

/// The Cornette–Shanks phase function per steradian for `cos Θ` and asymmetry `g`.
#[inline]
pub fn cornette_shanks(mu: f64, g: f64) -> f64 {
    let d = 1.0 + g * g - 2.0 * g * mu;
    3.0 / (8.0 * dmath::PI) * (1.0 - g * g) / (2.0 + g * g) * (1.0 + mu * mu) / (d * d.sqrt())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_standard_atmosphere_matches_its_tables() {
        // Published values of the 1976 standard: 11 km 226.32 hPa / 216.65 K, 20 km 54.75 hPa,
        // 32 km 8.68 hPa (geopotential), 47 km 1.109 hPa.
        let geometric = |h: f64| R0 * h / (R0 - h);
        for (h, p, t) in [
            (0.0, 101_325.0, 288.15),
            (11_000.0, 22_632.1, 216.65),
            (20_000.0, 5_474.89, 216.65),
            (32_000.0, 868.019, 228.65),
            (47_000.0, 110.906, 270.65),
        ] {
            let (tt, pp) = standard_atmosphere(geometric(h));
            assert!((pp / p - 1.0).abs() < 2.0e-4, "{h}: {pp} vs {p}");
            assert!((tt - t).abs() < 1.0e-6, "{h}: {tt}");
        }
        // Sea level: 2.547e25 molecules per m³.
        assert!((air_density(0.0) / 2.547e25 - 1.0).abs() < 1.0e-3);
    }

    #[test]
    fn rayleigh_scattering_matches_bodhaine() {
        // Bodhaine et al. 1999, table 3 (360 ppm CO₂): σ(550 nm) = 4.513e-27 cm², F_K = 1.0490;
        // optical depth at sea level 0.0973 at 550 nm, about 0.36 at 400 nm.
        let s = rayleigh_cross_section(550.0) * 1.0e4;
        assert!((s / 4.513e-27 - 1.0).abs() < 3.0e-3, "{s}");
        assert!((king_factor(550.0) - 1.049).abs() < 1.0e-3);
        let z = shell_altitudes();
        let atm = Atmosphere::new(1.0);
        let tau = rayleigh_depth(&atm.shells, &z, 550.0);
        assert!((tau - 0.0973).abs() < 0.002, "{tau}");
        let tau400 = rayleigh_depth(&atm.shells, &z, 400.0);
        assert!((tau400 - 0.364).abs() < 0.01, "{tau400}");
    }

    #[test]
    fn phase_functions_integrate_to_one() {
        for (f, name) in [
            (
                Box::new(|m: f64| rayleigh_phase(m, 0.0143)) as Box<dyn Fn(f64) -> f64>,
                "Rayleigh",
            ),
            (
                Box::new(|m: f64| cornette_shanks(m, 0.638)),
                "Cornette-Shanks",
            ),
        ] {
            let n = 200_000;
            let integral: f64 = (0..n)
                .map(|i| {
                    let mu = -1.0 + 2.0 * (i as f64 + 0.5) / n as f64;
                    f(mu) * 2.0 * dmath::PI * 2.0 / n as f64
                })
                .sum();
            assert!((integral - 1.0).abs() < 1.0e-4, "{name}: {integral}");
        }
        // The aerosols' mean cosine is the asymmetry factor, not the phase function's parameter.
        let g = cornette_shanks_parameter(AEROSOL_ASYMMETRY);
        assert!((g - 0.638).abs() < 0.001, "{g}");
        let n = 200_000;
        let mean: f64 = (0..n)
            .map(|i| {
                let mu = -1.0 + 2.0 * (i as f64 + 0.5) / n as f64;
                mu * cornette_shanks(mu, g) * 2.0 * dmath::PI * 2.0 / n as f64
            })
            .sum();
        assert!((mean - AEROSOL_ASYMMETRY).abs() < 1.0e-4, "{mean}");
        // And that is the parameter the simulated atmosphere scatters with.
        assert_eq!(Atmosphere::new(3.0).aerosol_g, g);
    }

    #[test]
    fn turbidity_is_the_linke_ratio_at_550_nm() {
        let z = shell_altitudes();
        assert_eq!(z.len(), SHELLS + 1);
        assert!((z[1] - FIRST_SHELL).abs() < 1.0e-9 && z[SHELLS] == TOP_ALTITUDE);
        for t in [1.0, 3.0, 10.0] {
            let atm = Atmosphere::new(t);
            let tau_r = rayleigh_depth(&atm.shells, &z, 550.0);
            // Band 17 is 550-560 nm; the aerosol depth there is (T - 1) τ_R(550) (555/550)^-1.3.
            let aerosol = atm.optics.aerosol[17];
            let column: f64 = atm
                .shells
                .iter()
                .zip(z.windows(2))
                .map(|(s, w)| s.aerosol * (w[1] - w[0]))
                .sum();
            assert!((column - 1.0).abs() < 1.0e-9);
            let want = (t - 1.0) * tau_r * dmath::powf(555.0 / 550.0, -1.3);
            assert!(
                (aerosol - want).abs() < 2.0e-4 * want.max(1.0),
                "{t}: {aerosol} vs {want}"
            );
        }
        // 300 DU of ozone: an optical depth of about 0.03 near 600 nm, none at 400 nm.
        let atm = Atmosphere::new(3.0);
        let column: f64 = atm
            .shells
            .iter()
            .zip(z.windows(2))
            .map(|(s, w)| s.ozone * (w[1] - w[0]))
            .sum();
        assert!((column / (OZONE_DU * DOBSON) - 1.0).abs() < 1.0e-6);
        let tau600 = column * atm.optics.ozone[22];
        assert!((0.025..0.04).contains(&tau600), "{tau600}");
        assert_eq!(atm.optics.ozone[1], 0.0);
    }
}
