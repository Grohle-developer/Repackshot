//! Multiple-scattering energy compensation of the GGX lobes (phase E9a).
//!
//! Single-scattering microfacet models lose the light that bounces between microfacets more than
//! once: a white GGX metal at roughness 1 reflects only `1 - ln 2` of what it receives head on.
//! Two published fixes are used here, written from the papers (no code or tables from anywhere):
//!
//! * **Reflection** (the metal and opaque-dielectric specular lobe and the clear coat): the extra
//!   lobe of C. Kulla and A. Conty, "Revisiting Physically Based Shading at Imageworks",
//!   SIGGRAPH 2017 course *Physically Based Shading in Theory and Practice*:
//!   `f_ms(μo, μi) = (1 - E(μo)) (1 - E(μi)) / (π (1 - E_avg))`, where `E(μ)` is the directional
//!   albedo of the lobe with a Fresnel of one and `E_avg = 2 ∫ E(μ) μ dμ` its cosine-weighted
//!   mean. It is reciprocal and its own albedo is `1 - E(μo)`, so a white lobe reflects
//!   everything. With a Fresnel of mean `F_avg = 2 ∫ F(μ) μ dμ` (for Schlick's curve between `f0`
//!   and `f90`, `f0 + (f90 - f0) / 21`) the light that bounces `k` times keeps `F_avg^k`; summing
//!   the series, the lobe is scaled by `F_ms = F_avg² E_avg / (1 - F_avg (1 - E_avg))`, which is
//!   1 for a white metal and colours a gold one more than its single bounce (the saturation of
//!   multiple bounces). The lobe is sampled by the cosine and its density is part of the mixture
//!   [`super::Bsdf::pdf`] that multiple importance sampling uses.
//! * **Refraction** (the clear part, Walter et al. 2007): the scaling of E. Turquin, "Practical
//!   multiple scattering compensation for microfacet models", Weta Digital technical report,
//!   2019. A dielectric interface without absorption conserves energy, so the whole clear lobe,
//!   reflection and refraction together, is divided by its own single-scattering power albedo
//!   `E_t(μo, α, η)` (reflection plus `η²` times the transmitted radiance): the light single
//!   scattering loses is given back in the proportions single scattering has. That makes the
//!   clear lobe slightly non-reciprocal, which the paper accepts.
//!
//! Anisotropic lobes use the isotropic tables at the width `√(αx αy)` (an approximation). The
//! clear coat over the layers below is not attenuated by its own multiple scattering (its
//! `F_avg` is 0.08: the term is below 0.6 %). Thin walls are left as they are. Roughness 0 (the
//! width [`super::MIN_ALPHA`]) changes nothing at all: the compensation is switched off below
//! [`MIN_COMPENSATED_ALPHA`], so smooth materials keep every bit.
//!
//! **The tables** ([`super::energy_table`]) are integrated here, by Monte Carlo with a fixed
//! seed ([`SEED`]): each node samples the half vector by the distribution of visible normals
//! (Heitz 2018, [`super::sample_vndf`]) on a jittered `64 × 64` grid of the unit square, with a
//! PCG stream per node, and averages `G2 / G1` (times the Fresnel of each branch for the clear
//! lobe), which is `f cos / pdf` of the lobe. Nodes sit at `μ = (i / 31)²` (denser at grazing
//! incidence, where the albedo changes fastest; the first one is integrated at `μ = 1/2048`),
//! roughness `r = j / 31` (`α = r²`) and, for the clear lobe, 17 indices of refraction uniform in
//! `(ior - 1) / (ior + 1)` from 1 to 3, entering (`η = ior`) and leaving (`η = 1 / ior`). Lookups
//! are linear in `√μ` and `r` (and in `(ior - 1) / (ior + 1)`). The values are stored as 16-bit
//! fractions (`E · 65535`, rounded). `E_avg` is the integral of the table itself (a midpoint rule
//! over 4096 values of `μ` of [`albedo`]), so the extra lobe's albedo is exactly `1 - E(μo)` of
//! the table; a test checks it against an independent Monte Carlo integration. The size was
//! chosen by the error test of `bsdf/tests.rs`: against a reference integrated with 16 times the
//! samples, at points between the nodes, the interpolated albedo is within 0.5 % (absolute: the
//! error of a white furnace) for every incidence up to 87° (`μ ≥ 0.05`); 24 × 24 nodes were
//! not. Regenerate with `REPACK_WRITE_TABLES=1 cargo test --release -p rt-core
//! energy_tables_are_what_the_generator_writes` from `engine/` (a few seconds; the same recipe
//! gives the same bits on any machine).

use super::energy_table::{ALBEDO, ALBEDO_AVG, CLEAR_IN, CLEAR_OUT, SCHLICK, SCHLICK_AVG};
use super::{fresnel_dielectric, refract, sample_vndf, Ggx};
use crate::math::Vec3;
use crate::rng::Pcg32;

/// Below this GGX width there is no compensation (roughness 0 renders as it always did).
pub const MIN_COMPENSATED_ALPHA: f32 = 2.0e-3;
/// Nodes of every table along `√μ`.
pub const NODES_MU: usize = 32;
/// Nodes of every table along the roughness `√α`.
pub const NODES_ROUGHNESS: usize = 32;
/// Index-of-refraction nodes of the clear-lobe tables, uniform in `(ior - 1) / (ior + 1)`.
pub const NODES_IOR: usize = 17;
/// Largest index of refraction in the clear-lobe tables (larger ones use it).
pub const MAX_IOR: f32 = 3.0;
/// Seed of the generator.
pub const SEED: u64 = 0xe9a_e9a;
/// Strata per side of the jittered grid of one node.
pub const STRATA: u32 = 64;
/// `μ` at which the first node is integrated.
const MIN_MU: f32 = 1.0 / 2048.0;
/// Values of `μ` of the midpoint rule of `E_avg`.
const AVG_STEPS: u32 = 4096;
/// One unit of the 16-bit tables.
const UNIT: f32 = 1.0 / 65535.0;

/// `μ` of node `i`.
#[inline]
pub fn node_mu(i: usize) -> f32 {
    let t = i as f32 / (NODES_MU - 1) as f32;
    (t * t).max(MIN_MU)
}

/// The GGX width `α = r²` of roughness node `j`.
#[inline]
pub fn node_alpha(j: usize) -> f32 {
    let r = j as f32 / (NODES_ROUGHNESS - 1) as f32;
    r * r
}

/// `(ior - 1) / (ior + 1)` of the largest index.
const MAX_X: f32 = (MAX_IOR - 1.0) / (MAX_IOR + 1.0);

/// The index of refraction of node `k`.
#[inline]
pub fn node_ior(k: usize) -> f32 {
    let x = MAX_X * k as f32 / (NODES_IOR - 1) as f32;
    (1.0 + x) / (1.0 - x)
}

/// The outgoing direction at `μ` in the local frame.
#[inline]
fn outgoing(mu: f32) -> Vec3 {
    Vec3::new((1.0 - mu * mu).max(0.0).sqrt(), 0.0, mu)
}

/// One jittered point of stratum `s` of a `strata × strata` grid.
#[inline]
fn jitter(rng: &mut Pcg32, s: u32, strata: u32) -> (f32, f32) {
    let (i, j) = (s % strata, s / strata);
    let inv = 1.0 / strata as f32;
    (
        ((i as f32 + rng.next_f32()) * inv).min(0.999_999_94),
        ((j as f32 + rng.next_f32()) * inv).min(0.999_999_94),
    )
}

/// `G2 / G1` for the pair `wo`, `wi` of a GGX lobe (0 when `wi` is on the wrong side).
#[inline]
fn g2_over_g1(ggx: &Ggx, wo: Vec3, wi: Vec3) -> f64 {
    let lo = ggx.lambda(wo);
    let li = ggx.lambda(wi);
    f64::from((1.0 + lo) / (1.0 + lo + li))
}

/// Directional albedo `E(μ, α)` of GGX reflection with a Fresnel of one, by `strata²` jittered
/// samples of the visible normals (PCG stream `stream`).
pub fn integrate_albedo(mu: f32, alpha: f32, strata: u32, stream: u64) -> f64 {
    if alpha <= 0.0 {
        return 1.0;
    }
    let ggx = Ggx::new(alpha, 0.0);
    let wo = outgoing(mu);
    let mut rng = Pcg32::seeded(SEED, stream);
    let mut sum = 0.0f64;
    let n = strata * strata;
    for s in 0..n {
        let h = sample_vndf(wo, alpha, alpha, jitter(&mut rng, s, strata));
        let wi = h * (2.0 * wo.dot(h)) - wo;
        if wi.z > 0.0 {
            sum += g2_over_g1(&ggx, wo, wi);
        }
    }
    sum / f64::from(n)
}

/// The Schlick moment `E₅(μ, α)` of GGX reflection: the directional albedo with the Fresnel
/// `(1 - wo·h)⁵`, so that a lobe with Schlick's Fresnel between `f0` and `f90` has the albedo
/// `f0 E + (f90 - f0) E₅` (phase E9a2). `(1 - μ)⁵` for a mirror.
pub fn integrate_schlick(mu: f32, alpha: f32, strata: u32, stream: u64) -> f64 {
    if alpha <= 0.0 {
        let m = f64::from(1.0 - mu);
        return m * m * m * m * m;
    }
    let ggx = Ggx::new(alpha, 0.0);
    let wo = outgoing(mu);
    let mut rng = Pcg32::seeded(SEED ^ 0x5c41, stream);
    let mut sum = 0.0f64;
    let n = strata * strata;
    for s in 0..n {
        let h = sample_vndf(wo, alpha, alpha, jitter(&mut rng, s, strata));
        let c = wo.dot(h);
        let wi = h * (2.0 * c) - wo;
        if wi.z > 0.0 {
            let m = f64::from((1.0 - c).clamp(0.0, 1.0));
            sum += m * m * m * m * m * g2_over_g1(&ggx, wo, wi);
        }
    }
    sum / f64::from(n)
}

/// `E_avg(α) = 2 ∫ E(μ, α) μ dμ`, with `μ²` on 64 strata and `strata²` visible normals each.
pub fn integrate_albedo_avg(alpha: f32, strata: u32, stream: u64) -> f64 {
    if alpha <= 0.0 {
        return 1.0;
    }
    let ggx = Ggx::new(alpha, 0.0);
    let mut rng = Pcg32::seeded(SEED ^ 0xa7, stream);
    let mut sum = 0.0f64;
    let n = strata * strata;
    const MU_STRATA: u32 = 64;
    for m in 0..MU_STRATA {
        for s in 0..n {
            // μ² uniform: μ has the density 2μ, so the mean of E is E_avg.
            let mu = ((m as f32 + rng.next_f32()) / MU_STRATA as f32)
                .sqrt()
                .max(MIN_MU);
            let wo = outgoing(mu);
            let h = sample_vndf(wo, alpha, alpha, jitter(&mut rng, s, strata));
            let wi = h * (2.0 * wo.dot(h)) - wo;
            if wi.z > 0.0 {
                sum += g2_over_g1(&ggx, wo, wi);
            }
        }
    }
    sum / f64::from(n * MU_STRATA)
}

/// The single-scattering power albedo of the clear lobe (reflection and refraction with the
/// exact Fresnel of the relative index `eta`, white): `E_t(μ, α, η)`.
pub fn integrate_clear(mu: f32, alpha: f32, eta: f32, strata: u32, stream: u64) -> f64 {
    if alpha <= 0.0 || (eta - 1.0).abs() < 1.0e-6 {
        return 1.0;
    }
    let ggx = Ggx::new(alpha, 0.0);
    let wo = outgoing(mu);
    let mut rng = Pcg32::seeded(SEED ^ 0xc1ea, stream);
    let mut sum = 0.0f64;
    let n = strata * strata;
    for s in 0..n {
        let h = sample_vndf(wo, alpha, alpha, jitter(&mut rng, s, strata));
        let cos = wo.dot(h);
        let f = fresnel_dielectric(cos, eta);
        let wr = h * (2.0 * cos) - wo;
        if wr.z > 0.0 {
            sum += f64::from(f) * g2_over_g1(&ggx, wo, wr);
        }
        if f < 1.0 {
            if let Some(wt) = refract(wo, h, eta) {
                if wt.z < 0.0 {
                    sum += f64::from(1.0 - f) * g2_over_g1(&ggx, wo, wt);
                }
            }
        }
    }
    sum / f64::from(n)
}

/// A value in `[0, 1]` as a 16-bit fraction.
#[inline]
fn quantise(v: f64) -> u16 {
    (v.clamp(0.0, 1.0) * 65535.0).round() as u16
}

/// The reflection table `E(μ, α)`, roughness-major, as 16-bit fractions.
pub fn generate_albedo(strata: u32) -> Vec<u16> {
    let mut table = Vec::with_capacity(NODES_MU * NODES_ROUGHNESS);
    for j in 0..NODES_ROUGHNESS {
        for i in 0..NODES_MU {
            let stream = (j * NODES_MU + i) as u64;
            table.push(quantise(integrate_albedo(
                node_mu(i),
                node_alpha(j),
                strata,
                stream,
            )));
        }
    }
    table
}

/// The Schlick-moment table `E₅(μ, α)`, roughness-major, as 16-bit fractions.
pub fn generate_schlick(strata: u32) -> Vec<u16> {
    let mut table = Vec::with_capacity(NODES_MU * NODES_ROUGHNESS);
    for j in 0..NODES_ROUGHNESS {
        for i in 0..NODES_MU {
            let stream = (j * NODES_MU + i) as u64 + (1 << 24);
            table.push(quantise(integrate_schlick(
                node_mu(i),
                node_alpha(j),
                strata,
                stream,
            )));
        }
    }
    table
}

/// The cosine-weighted mean of every roughness node of a reflection table (`E_avg` of
/// [`ALBEDO`], `E₅,avg` of [`SCHLICK`]): `2 ∫ E μ dμ` of its own lookup, by the midpoint rule.
pub fn generate_albedo_avg(table: &[u16]) -> Vec<f32> {
    (0..NODES_ROUGHNESS)
        .map(|j| {
            let alpha = node_alpha(j);
            let mut sum = 0.0f64;
            for m in 0..AVG_STEPS {
                let mu = (m as f32 + 0.5) / AVG_STEPS as f32;
                sum += f64::from(lookup(table, mu, alpha)) * f64::from(mu);
            }
            (2.0 * sum / f64::from(AVG_STEPS)) as f32
        })
        .collect()
}

/// One clear-lobe table, entering (`η = ior`) or leaving (`η = 1 / ior`): by ior, roughness,
/// then `μ`, as 16-bit fractions.
pub fn generate_clear(entering: bool, strata: u32) -> Vec<u16> {
    let mut table = Vec::with_capacity(NODES_MU * NODES_ROUGHNESS * NODES_IOR);
    for k in 0..NODES_IOR {
        let ior = node_ior(k);
        let eta = if entering { ior } else { 1.0 / ior };
        for j in 0..NODES_ROUGHNESS {
            for i in 0..NODES_MU {
                let stream = ((k * NODES_ROUGHNESS + j) * NODES_MU + i) as u64
                    + if entering { 0 } else { 1 << 20 };
                table.push(quantise(integrate_clear(
                    node_mu(i),
                    node_alpha(j),
                    eta,
                    strata,
                    stream,
                )));
            }
        }
    }
    table
}

/// Fractional position of `x ∈ [0, 1]` on `n` uniform nodes: the lower node and the weight of
/// the upper one.
#[inline]
fn locate(x: f32, n: usize) -> (usize, f32) {
    let t = x.clamp(0.0, 1.0) * (n - 1) as f32;
    let i = (t as usize).min(n - 2);
    (i, t - i as f32)
}

/// Bilinear lookup (in `√μ` and `√α`) in one roughness-major `μ × roughness` slice.
#[inline]
fn lookup(table: &[u16], mu: f32, alpha: f32) -> f32 {
    let (i, u) = locate(mu.max(0.0).sqrt(), NODES_MU);
    let (j, v) = locate(alpha.max(0.0).sqrt(), NODES_ROUGHNESS);
    let at = |j: usize, i: usize| f32::from(table[j * NODES_MU + i]) * UNIT;
    let low = at(j, i) + (at(j, i + 1) - at(j, i)) * u;
    let high = at(j + 1, i) + (at(j + 1, i + 1) - at(j + 1, i)) * u;
    low + (high - low) * v
}

/// `E(μ, α)` of GGX reflection with a Fresnel of one, from the table.
#[inline]
pub fn albedo(mu: f32, alpha: f32) -> f32 {
    lookup(&ALBEDO, mu, alpha)
}

/// `E_avg(α)`, from the table.
#[inline]
pub fn albedo_avg(alpha: f32) -> f32 {
    let (j, v) = locate(alpha.max(0.0).sqrt(), NODES_ROUGHNESS);
    ALBEDO_AVG[j] + (ALBEDO_AVG[j + 1] - ALBEDO_AVG[j]) * v
}

/// `E₅(μ, α)`, from the table.
#[inline]
pub fn schlick_albedo(mu: f32, alpha: f32) -> f32 {
    lookup(&SCHLICK, mu, alpha)
}

/// `E₅,avg(α)`, from the table.
#[inline]
pub fn schlick_avg(alpha: f32) -> f32 {
    let (j, v) = locate(alpha.max(0.0).sqrt(), NODES_ROUGHNESS);
    SCHLICK_AVG[j] + (SCHLICK_AVG[j + 1] - SCHLICK_AVG[j]) * v
}

/// A Schlick-Fresnel GGX layer as the layers under it see it (phase E9a2): its directional
/// albedo `E_s(μ)` (single scattering `f0 E + (f90 - f0) E₅` plus its extra lobe's
/// `F_ms (1 - E)`, times its strength) and its cosine-weighted mean. Kulla and Conty (2017)
/// weight what lies under it by `(1 - E_s(μo)) (1 - E_s(μi)) / (1 - E_s,avg)`: the energy the
/// layer does not reflect, normalised so that a white Lambertian base under it gives back all
/// of it. A smooth layer (below [`MIN_COMPENSATED_ALPHA`]) uses Schlick's curve itself, `E_s =
/// F(μ)`, and `E_s,avg = f0 + (f90 - f0) / 21`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Layer {
    f0: f32,
    f90: f32,
    strength: f32,
    /// The rough lobe's width and its extra lobe's `F_ms` (0 without one); `None`: smooth.
    rough: Option<(f32, f32)>,
    /// `1 / (1 - E_s,avg)`.
    norm: f32,
}

impl Layer {
    /// Nothing on top: everything passes.
    pub const CLEAR: Layer = Layer {
        f0: 0.0,
        f90: 0.0,
        strength: 0.0,
        rough: None,
        norm: 1.0,
    };

    /// A layer of `strength` with Schlick's Fresnel between `f0` and `f90` and GGX width
    /// `alpha`, whose extra lobe (if any) has the colour `ms`.
    pub fn new(f0: f32, f90: f32, strength: f32, alpha: f32, ms: f32) -> Layer {
        if strength.is_nan() || strength <= 0.0 || (f90 <= 0.0 && f0 <= 0.0) {
            return Layer::CLEAR;
        }
        let rough = (alpha >= MIN_COMPENSATED_ALPHA).then_some((alpha, ms));
        let avg = match rough {
            Some((a, ms)) => {
                let e_avg = albedo_avg(a);
                f0 * e_avg + (f90 - f0) * schlick_avg(a) + ms * (1.0 - e_avg)
            }
            None => schlick_average(f0, f90),
        } * strength;
        Layer {
            f0,
            f90,
            strength,
            rough,
            norm: 1.0 / (1.0 - avg.min(0.999)),
        }
    }

    /// `E_s(μ)`: what the layer reflects of light arriving at `μ`.
    #[inline]
    pub fn albedo(&self, mu: f32) -> f32 {
        let e = match self.rough {
            Some((a, ms)) => {
                let e = albedo(mu, a);
                self.f0 * e + (self.f90 - self.f0) * schlick_albedo(mu, a) + ms * (1.0 - e)
            }
            None => {
                let m = (1.0 - mu).clamp(0.0, 1.0);
                let m2 = m * m;
                self.f0 + (self.f90 - self.f0) * (m2 * m2 * m)
            }
        };
        (e * self.strength).clamp(0.0, 1.0)
    }

    /// `1 - E_s(μ)`: what passes it at `μ`.
    #[inline]
    pub fn passes(&self, mu: f32) -> f32 {
        1.0 - self.albedo(mu)
    }

    /// `1 / (1 - E_s,avg)`.
    #[inline]
    pub fn norm(&self) -> f32 {
        self.norm
    }

    /// The weight of a diffuse lobe under the layer: `(1 - E_s(μo)) (1 - E_s(μi)) / (1 - E_s,avg)`.
    #[inline]
    pub fn under(&self, mu_o: f32, mu_i: f32) -> f32 {
        self.passes(mu_o) * self.passes(mu_i) * self.norm
    }

    /// True when the layer reflects nothing.
    #[inline]
    pub fn is_clear(&self) -> bool {
        self.strength <= 0.0
    }
}

/// Nodes and weights of 8-point Gauss–Legendre quadrature on `[0, 1]` (the textbook values on
/// `[-1, 1]`, halved and shifted).
const GAUSS_8: [(f32, f32); 8] = [
    (0.019_855_072, 0.050_614_27),
    (0.101_666_76, 0.111_190_52),
    (0.237_233_8, 0.156_853_32),
    (0.408_282_68, 0.181_341_89),
    (0.591_717_3, 0.181_341_89),
    (0.762_766_2, 0.156_853_32),
    (0.898_333_2, 0.111_190_52),
    (0.980_144_9, 0.050_614_27),
];

/// `1 / ∫ (1 - E_s(μ)) (1 - E_c(μ)) 2μ dμ`: the normalisation of a diffuse lobe under two
/// layers (the specular layer and the clear coat over it). The two transmissions are
/// correlated (both fall at grazing incidence), so the product of their own normalisations
/// would be about 1.4 % too bright for smooth layers; 8-point Gauss–Legendre integrates
/// Schlick's curves exactly (degree 11 in μ) and the tables' smooth curves closely.
pub fn joint_norm(below: &Layer, above: &Layer) -> f32 {
    if above.is_clear() {
        return below.norm;
    }
    if below.is_clear() {
        return above.norm;
    }
    let sum: f32 = GAUSS_8
        .iter()
        .map(|&(mu, w)| w * 2.0 * mu * below.passes(mu) * above.passes(mu))
        .sum();
    1.0 / sum.max(0.001)
}

/// `E_t(μ, α, η)` of the clear lobe, from the tables (`η > 1` entering, below 1 leaving).
#[inline]
pub fn clear_albedo(mu: f32, alpha: f32, eta: f32) -> f32 {
    let (table, ior) = if eta >= 1.0 {
        (&CLEAR_IN, eta)
    } else {
        (&CLEAR_OUT, 1.0 / eta)
    };
    let x = (ior - 1.0) / (ior + 1.0);
    let (k, w) = locate(x / MAX_X, NODES_IOR);
    let slice = NODES_MU * NODES_ROUGHNESS;
    let a = lookup(&table[k * slice..(k + 1) * slice], mu, alpha);
    let b = lookup(&table[(k + 1) * slice..(k + 2) * slice], mu, alpha);
    a + (b - a) * w
}

/// The cosine-weighted mean `2 ∫ F μ dμ` of Schlick's Fresnel between `f0` and `f90`:
/// `2 ∫ (1 - μ)⁵ μ dμ = 1 / 21`.
#[inline]
pub fn schlick_average(f0: f32, f90: f32) -> f32 {
    f0 + (f90 - f0) * (1.0 / 21.0)
}

/// Kulla and Conty's colour of the multiple-scattering lobe: `F_avg² E_avg / (1 - F_avg (1 -
/// E_avg))`.
#[inline]
pub fn multiple_fresnel(f_avg: f32, e_avg: f32) -> f32 {
    let d = 1.0 - f_avg * (1.0 - e_avg);
    if d > 0.0 {
        f_avg * f_avg * e_avg / d
    } else {
        0.0
    }
}

/// One GGX lobe's multiple-scattering shape: `(1 - E(μo)) (1 - E(μi)) / (π (1 - E_avg))` needs
/// its width, `1 / (π (1 - E_avg))` and `1 - E(μo)`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Lobe {
    /// The (isotropic, or geometric-mean) GGX width.
    pub alpha: f32,
    /// `1 / (π (1 - E_avg))`.
    pub norm: f32,
    /// `E_avg`.
    pub e_avg: f32,
}

impl Lobe {
    /// The lobe of width `alpha`, or `None` when it needs no compensation.
    pub fn new(alpha: f32) -> Option<Lobe> {
        if alpha.is_nan() || alpha < MIN_COMPENSATED_ALPHA {
            return None;
        }
        let e_avg = albedo_avg(alpha);
        let lost = 1.0 - e_avg;
        (lost > 1.0e-6).then(|| Lobe {
            alpha,
            norm: crate::fmath::FRAC_1_PI / lost,
            e_avg,
        })
    }

    /// `1 - E(μ)`.
    #[inline]
    pub fn lost(&self, mu: f32) -> f32 {
        (1.0 - albedo(mu, self.alpha)).max(0.0)
    }

    /// `(1 - E(μo)) (1 - E(μi)) / (π (1 - E_avg))`.
    #[inline]
    pub fn shape(&self, mu_o: f32, mu_i: f32) -> f32 {
        self.lost(mu_o) * self.lost(mu_i) * self.norm
    }
}
