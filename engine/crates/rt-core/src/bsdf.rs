//! Surface scattering: the principled BSDF of `MATL.kind` 0 (and, until E5, of glass).
//!
//! Lobes, all evaluated in the local shading frame (`z` is the shading normal, `wo` and `wi`
//! point away from the surface):
//!
//! * **Diffuse**: Lambert, albedo `base_color * (1 - metallic)`, weighted by
//!   `(1 - F(μo)) (1 - F(μi))` with the dielectric Fresnel `F`, which keeps the sum with the
//!   specular lobe from creating energy and keeps the BSDF reciprocal. (Burley's retro-reflection
//!   term, B. Burley, "Physically-Based Shading at Disney", 2012, could replace the plain Lambert
//!   later.)
//! * **Specular**: GGX / Trowbridge–Reitz microfacets (B. Walter et al., "Microfacet Models for
//!   Refraction through Rough Surfaces", EGSR 2007) with width `α = roughness²` (at least
//!   [`MIN_ALPHA`]), the height-correlated Smith masking-shadowing term (E. Heitz,
//!   "Understanding the Masking-Shadowing Function in Microfacet-Based BRDFs", *JCGT* 3(2), 2014)
//!   and Schlick's Fresnel (C. Schlick, "An Inexpensive BRDF Model for Physically-based
//!   Rendering", 1994): `F0 = ((ior - 1) / (ior + 1))²` for the dielectric and `base_color` for
//!   the metal, blended by `metallic`. The grazing value is `F90 = min(1, 50 F0)` (S. Lagarde and
//!   C. de Rousiers, "Moving Frostbite to PBR", SIGGRAPH 2014 course notes), so an index-matched
//!   dielectric (`ior` 1) has no specular lobe at all instead of Schlick's invented grazing
//!   reflection.
//! * **Clear coat**: a second GGX lobe of width `coat_roughness²`, `ior` 1.5, scaled by `coat`;
//!   the layers below are attenuated by `(1 - coat F_c(μo)) (1 - coat F_c(μi))`.
//!
//! Sampling picks a lobe in proportion to an estimate of its reflectance towards `wo` (the
//! choice reuses the first BSDF dimension, rescaled), samples the GGX lobes by their distribution
//! of visible normals (E. Heitz, "Sampling the GGX Distribution of Visible Normals", *JCGT* 7(4),
//! 2018) and the diffuse lobe by the cosine. [`Bsdf::pdf`] is the density of that whole
//! procedure (the mixture of the three), which is what multiple importance sampling needs, and
//! the sample weight is `f cos / pdf` of the mixture.

use crate::color::Rgb;
use crate::fmath;
use crate::math::Vec3;
use crate::scene::Material;
use crate::warp;

/// Smallest GGX width: roughness 0 renders as an almost perfect mirror.
pub const MIN_ALPHA: f32 = 1.0e-3;
/// Specular reflectance at normal incidence of the clear coat (ior 1.5).
const COAT_F0: f32 = 0.04;

/// Which lobes an evaluation includes.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Lobes {
    /// Everything.
    All,
    /// The diffuse lobe only (seen through the coat): what a light without the `glossy` flag
    /// lights.
    Diffuse,
}

/// A direction sampled from a [`Bsdf`].
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct BsdfSample {
    /// Incident direction in the local frame (`z > 0`).
    pub wi: Vec3,
    /// `f(wo, wi) cos(θi) / pdf(wi)`.
    pub weight: Rgb,
    /// Density of the sampling procedure at `wi`, per steradian.
    pub pdf: f32,
}

/// The principled BSDF of one surface point, in its local frame.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Bsdf {
    /// Lambert albedo before Fresnel weighting: `base * (1 - metallic)`.
    diffuse: Rgb,
    /// Metal reflectance at normal incidence (the base colour).
    metal_f0: Rgb,
    /// Metal reflectance at grazing incidence.
    metal_f90: Rgb,
    /// Weight of the metal Fresnel in the specular lobe.
    metallic: f32,
    /// Dielectric reflectance at normal and grazing incidence.
    f0: f32,
    f90: f32,
    /// GGX width of the specular lobe.
    alpha: f32,
    /// Clear coat strength and GGX width.
    coat: f32,
    coat_alpha: f32,
}

/// Schlick's approximation between `f0` (normal incidence) and `f90` (grazing).
#[inline]
fn schlick(f0: f32, f90: f32, cos: f32) -> f32 {
    let m = (1.0 - cos).clamp(0.0, 1.0);
    let m2 = m * m;
    f0 + (f90 - f0) * (m2 * m2 * m)
}

/// GGX normal distribution `D(h)` for a unit half vector in the local frame. Written with
/// `sin²` and `cos²` separately so that narrow lobes do not cancel catastrophically.
#[inline]
fn ggx_d(h: Vec3, a2: f32) -> f32 {
    let t = a2 * h.z * h.z + (h.x * h.x + h.y * h.y);
    if t <= 0.0 {
        return 0.0;
    }
    a2 / (fmath::PI * t * t)
}

/// Smith `Λ(w)` of GGX.
#[inline]
fn ggx_lambda(w: Vec3, a2: f32) -> f32 {
    let cos2 = w.z * w.z;
    if cos2 <= 0.0 {
        return f32::INFINITY;
    }
    let tan2 = (w.x * w.x + w.y * w.y) / cos2;
    ((1.0 + a2 * tan2).sqrt() - 1.0) * 0.5
}

/// A half vector distributed as the GGX visible normals seen from `wo` (Heitz 2018).
fn sample_vndf(wo: Vec3, alpha: f32, u: (f32, f32)) -> Vec3 {
    let vh = Vec3::new(alpha * wo.x, alpha * wo.y, wo.z).normalize();
    let lensq = vh.x * vh.x + vh.y * vh.y;
    let t1 = if lensq > 0.0 {
        Vec3::new(-vh.y, vh.x, 0.0) / lensq.sqrt()
    } else {
        Vec3::new(1.0, 0.0, 0.0)
    };
    let t2 = vh.cross(t1);
    let r = u.0.sqrt();
    let (sp, cp) = fmath::sin_cos(fmath::TAU * u.1);
    let p1 = r * cp;
    let s = 0.5 * (1.0 + vh.z);
    let p2 = (1.0 - s) * (1.0 - p1 * p1).max(0.0).sqrt() + s * (r * sp);
    let nh = t1 * p1 + t2 * p2 + vh * (1.0 - p1 * p1 - p2 * p2).max(0.0).sqrt();
    Vec3::new(alpha * nh.x, alpha * nh.y, nh.z.max(1.0e-7)).normalize()
}

/// Density of [`sample_vndf`] followed by mirror reflection, at `wi`: `G1(wo) D(h) / (4 μo)`.
#[inline]
fn vndf_reflection_pdf(wo: Vec3, h: Vec3, a2: f32) -> f32 {
    let g1 = 1.0 / (1.0 + ggx_lambda(wo, a2));
    g1 * ggx_d(h, a2) / (4.0 * wo.z)
}

/// `D G2 / (4 μo μi)`: the microfacet term without Fresnel.
#[inline]
fn microfacet(wo: Vec3, wi: Vec3, h: Vec3, a2: f32) -> f32 {
    let g2 = 1.0 / (1.0 + ggx_lambda(wo, a2) + ggx_lambda(wi, a2));
    ggx_d(h, a2) * g2 / (4.0 * wo.z * wi.z)
}

/// Lobe selection probabilities `(coat, specular, diffuse)` towards `wo`.
struct LobeWeights {
    coat: f32,
    specular: f32,
    diffuse: f32,
}

impl Bsdf {
    /// The BSDF of a principled material (kinds 0 and, until E5, 1). Parameters are clamped to
    /// their valid ranges: an albedo above one would create energy.
    pub fn principled(m: &Material) -> Bsdf {
        let base = m.base_color.map(|v| v.clamp(0.0, 1.0));
        let metallic = m.metallic.clamp(0.0, 1.0);
        let ior = m.ior.max(1.0);
        let f0 = ((ior - 1.0) / (ior + 1.0)) * ((ior - 1.0) / (ior + 1.0));
        let roughness = m.roughness.clamp(0.0, 1.0);
        let coat_roughness = m.coat_roughness.clamp(0.0, 1.0);
        Bsdf {
            diffuse: base * (1.0 - metallic),
            metal_f0: base,
            metal_f90: base.map(|v| (50.0 * v).min(1.0)),
            metallic,
            f0,
            f90: (50.0 * f0).min(1.0),
            alpha: (roughness * roughness).max(MIN_ALPHA),
            coat: m.coat.clamp(0.0, 1.0),
            coat_alpha: (coat_roughness * coat_roughness).max(MIN_ALPHA),
        }
    }

    /// A pure Lambertian BSDF of `albedo` (the visible floor).
    pub fn lambert(albedo: Rgb) -> Bsdf {
        Bsdf {
            diffuse: albedo.map(|v| v.clamp(0.0, 1.0)),
            metal_f0: Rgb::BLACK,
            metal_f90: Rgb::BLACK,
            metallic: 0.0,
            f0: 0.0,
            f90: 0.0,
            alpha: 1.0,
            coat: 0.0,
            coat_alpha: 1.0,
        }
    }

    /// True when the specular lobe can reflect anything.
    #[inline]
    fn has_specular(&self) -> bool {
        self.f90 > 0.0 || self.metallic > 0.0
    }

    /// Specular Fresnel at `cos` (dielectric and metal blended by `metallic`).
    #[inline]
    fn specular_fresnel(&self, cos: f32) -> Rgb {
        let d = schlick(self.f0, self.f90, cos);
        if self.metallic <= 0.0 {
            return Rgb::splat(d);
        }
        let metal = Rgb::new(
            schlick(self.metal_f0.r, self.metal_f90.r, cos),
            schlick(self.metal_f0.g, self.metal_f90.g, cos),
            schlick(self.metal_f0.b, self.metal_f90.b, cos),
        );
        Rgb::splat(d) * (1.0 - self.metallic) + metal * self.metallic
    }

    /// Clear coat Fresnel at `cos`, times the coat strength.
    #[inline]
    fn coat_fresnel(&self, cos: f32) -> f32 {
        if self.coat <= 0.0 {
            0.0
        } else {
            self.coat * schlick(COAT_F0, 1.0, cos)
        }
    }

    fn lobe_weights(&self, wo: Vec3) -> LobeWeights {
        let coat = self.coat_fresnel(wo.z);
        let below = 1.0 - coat;
        let specular = if self.has_specular() {
            below * self.specular_fresnel(wo.z).luminance().max(0.0)
        } else {
            0.0
        };
        let diffuse = below * self.diffuse.luminance() * (1.0 - schlick(self.f0, self.f90, wo.z));
        let total = coat + specular + diffuse;
        if total > 0.0 {
            let inv = 1.0 / total;
            LobeWeights {
                coat: coat * inv,
                specular: specular * inv,
                diffuse: diffuse * inv,
            }
        } else {
            LobeWeights {
                coat: 0.0,
                specular: 0.0,
                diffuse: 0.0,
            }
        }
    }

    /// `f(wo, wi)` (without the cosine). Zero unless both directions are above the surface.
    pub fn eval(&self, wo: Vec3, wi: Vec3, lobes: Lobes) -> Rgb {
        if wo.z <= 0.0 || wi.z <= 0.0 {
            return Rgb::BLACK;
        }
        let attenuation = (1.0 - self.coat_fresnel(wo.z)) * (1.0 - self.coat_fresnel(wi.z));
        let diffuse = self.diffuse
            * (fmath::FRAC_1_PI
                * (1.0 - schlick(self.f0, self.f90, wo.z))
                * (1.0 - schlick(self.f0, self.f90, wi.z)));
        if lobes == Lobes::Diffuse {
            return diffuse * attenuation;
        }
        let h = (wo + wi).normalize();
        let cos_h = wo.dot(h).max(0.0);
        let mut below = diffuse;
        if self.has_specular() {
            let a2 = self.alpha * self.alpha;
            below += self.specular_fresnel(cos_h) * microfacet(wo, wi, h, a2);
        }
        let mut f = below * attenuation;
        if self.coat > 0.0 {
            let a2 = self.coat_alpha * self.coat_alpha;
            f += Rgb::splat(self.coat_fresnel(cos_h) * microfacet(wo, wi, h, a2));
        }
        f
    }

    /// Density, per steradian, with which [`Bsdf::sample`] returns `wi` for this `wo`.
    pub fn pdf(&self, wo: Vec3, wi: Vec3) -> f32 {
        if wo.z <= 0.0 || wi.z <= 0.0 {
            return 0.0;
        }
        self.pdf_with(&self.lobe_weights(wo), wo, wi)
    }

    /// [`Bsdf::pdf`] with the lobe weights of `wo` already computed (both directions above).
    fn pdf_with(&self, w: &LobeWeights, wo: Vec3, wi: Vec3) -> f32 {
        let mut pdf = w.diffuse * wi.z * fmath::FRAC_1_PI;
        if w.specular > 0.0 || w.coat > 0.0 {
            let h = (wo + wi).normalize();
            if wo.dot(h) > 0.0 {
                if w.specular > 0.0 {
                    pdf += w.specular * vndf_reflection_pdf(wo, h, self.alpha * self.alpha);
                }
                if w.coat > 0.0 {
                    let a2 = self.coat_alpha * self.coat_alpha;
                    pdf += w.coat * vndf_reflection_pdf(wo, h, a2);
                }
            }
        }
        pdf
    }

    /// Samples an incident direction for `wo` from the 2-D sample `u`. `None` when the surface
    /// reflects nothing towards `wo` or the sampled direction falls below the surface.
    pub fn sample(&self, wo: Vec3, u: (f32, f32)) -> Option<BsdfSample> {
        if wo.z <= 0.0 {
            return None;
        }
        let w = self.lobe_weights(wo);
        let (u0, u1) = u;
        let wi = if u0 < w.coat {
            let h = sample_vndf(wo, self.coat_alpha, (u0 / w.coat, u1));
            h * (2.0 * wo.dot(h)) - wo
        } else if u0 < w.coat + w.specular {
            let h = sample_vndf(wo, self.alpha, ((u0 - w.coat) / w.specular, u1));
            h * (2.0 * wo.dot(h)) - wo
        } else if w.diffuse > 0.0 {
            let start = w.coat + w.specular;
            let u0 = ((u0 - start) / w.diffuse).clamp(0.0, 0.999_999_94);
            warp::cosine_hemisphere((u0, u1))
        } else {
            return None;
        };
        if wi.z <= 0.0 {
            return None;
        }
        let pdf = self.pdf_with(&w, wo, wi);
        if !(pdf > 0.0 && pdf.is_finite()) {
            return None;
        }
        let weight = self.eval(wo, wi, Lobes::All) * (wi.z / pdf);
        Some(BsdfSample { wi, weight, pdf })
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

    fn materials() -> Vec<Material> {
        let mut out = Vec::new();
        for roughness in [0.0, 0.05, 0.3, 0.6, 1.0] {
            out.push(Material {
                base_color: Rgb::new(0.9, 0.6, 0.3),
                roughness,
                ..Material::default()
            });
            out.push(Material {
                base_color: Rgb::new(0.95, 0.8, 0.5),
                metallic: 1.0,
                roughness,
                ..Material::default()
            });
            out.push(Material {
                base_color: Rgb::new(0.2, 0.4, 0.8),
                roughness,
                coat: 1.0,
                coat_roughness: 0.1,
                ..Material::default()
            });
        }
        out
    }

    /// Directional albedo `∫ f cos dωi` for `wo`, estimated by sampling the BSDF.
    fn albedo(bsdf: &Bsdf, wo: Vec3, n: u32) -> Rgb {
        let mut rng = Pcg32::seeded(17, u64::from(n));
        let mut sum = Rgb::BLACK;
        for _ in 0..n {
            if let Some(s) = bsdf.sample(wo, (rng.next_f32(), rng.next_f32())) {
                sum += s.weight;
            }
        }
        sum / n as f32
    }

    #[test]
    fn the_bsdf_is_reciprocal() {
        let mut rng = Pcg32::seeded(3, 3);
        for m in materials() {
            let bsdf = Bsdf::principled(&m);
            for _ in 0..200 {
                let a = dir(rng.next_f32() * 89.0, rng.next_f32() * 360.0);
                let b = dir(rng.next_f32() * 89.0, rng.next_f32() * 360.0);
                let ab = bsdf.eval(a, b, Lobes::All);
                let ba = bsdf.eval(b, a, Lobes::All);
                for (x, y) in [(ab.r, ba.r), (ab.g, ba.g), (ab.b, ba.b)] {
                    assert!(
                        (x - y).abs() <= 1.0e-5 * x.abs().max(1.0),
                        "{m:?}: {x} vs {y}"
                    );
                }
                assert_eq!(bsdf.eval(a, -b, Lobes::All), Rgb::BLACK);
            }
        }
    }

    #[test]
    fn no_material_reflects_more_than_it_receives() {
        for m in materials() {
            let bsdf = Bsdf::principled(&m);
            for theta in [0.0, 30.0, 60.0, 80.0, 89.0] {
                let a = albedo(&bsdf, dir(theta, 20.0), 40_000);
                for v in [a.r, a.g, a.b] {
                    assert!(v <= 1.01, "{m:?} at {theta} degrees reflects {v}");
                }
            }
        }
        // A white, index-matched dielectric is exactly Lambertian: albedo one at every angle.
        let white = Bsdf::principled(&Material {
            base_color: Rgb::WHITE,
            ior: 1.0,
            ..Material::default()
        });
        for theta in [0.0, 45.0, 85.0] {
            let a = albedo(&white, dir(theta, 0.0), 1000);
            assert!((a.g - 1.0).abs() < 1.0e-5, "{theta}: {a:?}");
        }
        // A white mirror metal reflects (almost) everything.
        let mirror = Bsdf::principled(&Material {
            base_color: Rgb::WHITE,
            metallic: 1.0,
            roughness: 0.0,
            ..Material::default()
        });
        let a = albedo(&mirror, dir(30.0, 0.0), 1000);
        assert!(a.g > 0.99 && a.g <= 1.0 + 1.0e-4, "{a:?}");
    }

    #[test]
    fn the_roughest_metal_has_the_analytic_single_scattering_albedo() {
        // With α = 1 GGX is uniform (D = 1/π) and, seen head on, Λ(wo) = 0, so the albedo of a
        // white metal is ∫ μ / (1 + μ) dμ = 1 - ln 2. Single scattering loses that energy (a
        // multiple-scattering compensation, Kulla and Conty 2017, could give it back later).
        let rough = Bsdf::principled(&Material {
            base_color: Rgb::WHITE,
            metallic: 1.0,
            roughness: 1.0,
            ..Material::default()
        });
        let a = albedo(&rough, Vec3::new(0.0, 0.0, 1.0), 400_000);
        assert!(
            (a.g - (1.0 - std::f32::consts::LN_2)).abs() < 0.003,
            "{a:?}"
        );
    }

    #[test]
    fn sampled_weights_are_eval_cos_over_pdf_and_the_pdf_is_a_density() {
        let mut rng = Pcg32::seeded(8, 1);
        for m in materials()
            .into_iter()
            .filter(|m| m.roughness >= 0.3 && m.roughness <= 0.6)
        {
            let bsdf = Bsdf::principled(&m);
            let wo = dir(35.0, 10.0);
            // E[1 / pdf] over sampled directions is the solid angle of the support (2π): this
            // holds only if `pdf` is the density the sampler really has.
            let n = 400_000;
            let mut inv = 0.0f64;
            for _ in 0..n {
                if let Some(s) = bsdf.sample(wo, (rng.next_f32(), rng.next_f32())) {
                    let f = bsdf.eval(wo, s.wi, Lobes::All);
                    let expect = f * (s.wi.z / s.pdf);
                    assert!((expect.g - s.weight.g).abs() <= 1.0e-5 * expect.g.max(1.0));
                    assert!((bsdf.pdf(wo, s.wi) - s.pdf).abs() <= 1.0e-6 * s.pdf);
                    inv += 1.0 / s.pdf as f64;
                }
            }
            let support = inv / n as f64;
            let tau = std::f64::consts::TAU;
            assert!((support / tau - 1.0).abs() < 0.03, "{m:?}: {support} vs 2π");
        }
    }

    #[test]
    fn the_diffuse_only_evaluation_drops_the_highlight() {
        let m = Material {
            roughness: 0.2,
            ..Material::default()
        };
        let bsdf = Bsdf::principled(&m);
        let wo = dir(40.0, 0.0);
        let mirror = dir(40.0, 180.0);
        let all = bsdf.eval(wo, mirror, Lobes::All);
        let diffuse = bsdf.eval(wo, mirror, Lobes::Diffuse);
        assert!(all.g > 5.0 * diffuse.g, "{all:?} vs {diffuse:?}");
        assert!(diffuse.g > 0.0);
        // A black, non-metal, index-matched surface reflects nothing and samples nothing.
        let black = Bsdf::principled(&Material {
            base_color: Rgb::BLACK,
            ior: 1.0,
            ..Material::default()
        });
        assert_eq!(black.sample(wo, (0.3, 0.3)), None);
        assert_eq!(black.pdf(wo, mirror), 0.0);
        // Below the surface nothing is sampled.
        assert_eq!(bsdf.sample(-wo, (0.3, 0.3)), None);
    }
}
