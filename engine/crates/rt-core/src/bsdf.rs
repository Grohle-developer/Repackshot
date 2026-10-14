//! Surface scattering: the principled BSDF of `MATL.kind` 0 and 1 (glass is the principled
//! surface without metal).
//!
//! Lobes, all evaluated in the local shading frame (`z` is the shading normal on the side of
//! `wo`; `wo` and `wi` point away from the surface, `wi.z < 0` is transmission):
//!
//! * **Diffuse**: Lambert, albedo `base_color * (1 - metallic) * (1 - transmission)`, under the
//!   dielectric's specular layer, weighted (E9a2) by Kulla and Conty's
//!   `(1 - E_s(μo)) (1 - E_s(μi)) / (1 - E_s,avg)`, where `E_s` is the directional albedo of that
//!   specular layer (its single scattering with Schlick's Fresnel plus its extra lobe, from the
//!   energy tables; Schlick's `F(μ)` itself when smooth): a white base gives back exactly the
//!   energy the specular layer does not reflect, and the BSDF stays reciprocal. (Until E9a2 the
//!   weight was `(1 - F(μo)) (1 - F(μi))`, which lost `F_avg` of the diffuse, 8.6 % at ior 1.5.)
//!   Burley's retro-reflection term (B. Burley, "Physically-Based Shading at Disney", 2012) could
//!   replace the plain Lambert later.
//! * **Specular**: GGX / Trowbridge–Reitz microfacets (B. Walter et al., "Microfacet Models for
//!   Refraction through Rough Surfaces", EGSR 2007) with width `α = roughness²` (at least
//!   [`MIN_ALPHA`]), the height-correlated Smith masking-shadowing term (E. Heitz,
//!   "Understanding the Masking-Shadowing Function in Microfacet-Based BRDFs", *JCGT* 3(2), 2014)
//!   and Schlick's Fresnel (C. Schlick, "An Inexpensive BRDF Model for Physically-based
//!   Rendering", 1994): `F0 = ((ior - 1) / (ior + 1))²` for the opaque dielectric and
//!   `base_color` for the metal, blended by `metallic`. The grazing value is `F90 = min(1, 50 F0)`
//!   (S. Lagarde and C. de Rousiers, "Moving Frostbite to PBR", SIGGRAPH 2014 course notes), so an
//!   index-matched dielectric (`ior` 1) has no specular lobe at all instead of Schlick's invented
//!   grazing reflection.
//! * **Clear (transmission)**: the `transmission` share of the dielectric is clear glass: the
//!   same GGX microfacets reflect with the exact dielectric Fresnel `F(η)` and refract the rest
//!   (Walter et al. 2007, eqs. 15–21: the generalised half vector `h ∝ -(wo + η wi)`, the
//!   Jacobian `η² |wi·h| / (wo·h + η wi·h)²`, with the `1/η²` of radiance transport, so the
//!   radiance entering and leaving a solid comes back to what it was), with total internal
//!   reflection where `F = 1`. `η` is the index on the side of `wi` over the one of `wo`: `ior`
//!   entering, `1 / ior` leaving. Transmitted light is tinted by `√base_color` at each crossing
//!   (so a solid shows its colour once), or not at all when the material has an absorption
//!   distance (Beer–Lambert, applied by the integrator along the path inside). A **thin wall**
//!   (`MATL.flags` bit 1) has no inside: it reflects `R' = 2R / (1 + R)` (the sum of the
//!   reflections between its two faces, R the Fresnel of one) and transmits `1 - R'` straight
//!   through, tinted by `base_color`, without refraction; that straight lobe is a direction
//!   delta that only BSDF sampling produces ([`BsdfSample::straight`]).
//! * **Clear coat**: a second GGX lobe of width `coat_roughness²`, `ior` 1.5, scaled by `coat`;
//!   the specular lobes below are attenuated by `(1 - coat E_c(μo)) (1 - coat E_c(μi))` (the
//!   albedo-scaling layering, energy-conserving: what the coat reflects never reaches the base),
//!   with `E_c` the coat's directional albedo (E9a2; Schlick's curve when smooth), and the diffuse
//!   lobe by the product of both layers' transmissions normalised by their joint mean
//!   ([`energy::joint_norm`]). A solid clear material's coat is on its outside only, and the light
//!   it lets into the solid is `1 - coat E_c(μo)`.
//! * **Anisotropy**: with `anisotropy` `a > 0` the specular and clear lobes have the widths
//!   `αx = α / s`, `αy = α s` with `s = √(1 - 0.9 a)` (B. Burley 2012, the convention of the
//!   recipes' Blender materials) along the frame's `x` (the tangent the integrator gives) and `y`;
//!   the distribution, Smith term and visible-normal sampling are the anisotropic GGX ones
//!   (Heitz 2014, 2018). `a = 0` computes exactly what the isotropic lobe computes.
//!
//! * **Multiple scattering** (E9a, [`energy`]): rough lobes get back the light that single
//!   scattering loses between microfacets. The specular lobe (metal and opaque dielectric) and the
//!   coat get Kulla and Conty's extra lobe `F_ms (1 - E(μo)) (1 - E(μi)) / (π (1 - E_avg))`,
//!   sampled by the cosine; the clear part is divided by its own power albedo (Turquin 2019).
//!   Roughness 0 changes nothing.
//!
//! Sampling picks a lobe in proportion to an estimate of its reflectance towards `wo` (the
//! choice reuses the first BSDF dimension, rescaled): coat, specular, diffuse, clear. Inside the
//! clear lobe the same dimension, rescaled again, chooses reflection with the probability of the
//! macroscopic Fresnel `F(μo)` (at most 0.99) and refraction otherwise, then the GGX lobes are
//! sampled by their distribution of visible normals (E. Heitz, "Sampling the GGX Distribution of
//! Visible Normals", *JCGT* 7(4), 2018) and the diffuse lobe by the cosine. [`Bsdf::pdf`] is the
//! density of that whole procedure (the mixture of the lobes), which is what multiple importance
//! sampling needs, and the sample weight is `f |cos| / pdf` of the mixture.

use crate::color::Rgb;
use crate::fmath;
use crate::math::Vec3;
use crate::scene::{Material, MATERIAL_FLAG_THIN, MATERIAL_GLASS};
use crate::warp;

pub mod energy;
pub mod energy_table;

/// Smallest GGX width: roughness 0 renders as an almost perfect mirror.
pub const MIN_ALPHA: f32 = 1.0e-3;
/// Specular reflectance at normal incidence of the clear coat (ior 1.5).
const COAT_F0: f32 = 0.04;
/// Largest probability of choosing reflection inside the clear lobe (the rest refracts).
const MAX_REFLECT_PROBABILITY: f32 = 0.99;

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
    /// Incident direction in the local frame (`z > 0` reflection, `z < 0` transmission).
    pub wi: Vec3,
    /// `f(wo, wi) |cos(θi)| / pdf(wi)`; for a straight sample, its throughput.
    pub weight: Rgb,
    /// Density of the sampling procedure at `wi`, per steradian; for a straight sample, the
    /// probability of having chosen it.
    pub pdf: f32,
    /// The thin wall's straight transmission (`wi = -wo`, a direction delta): no other technique
    /// can find it, so it takes no part in multiple importance sampling.
    pub straight: bool,
}

/// A GGX distribution, isotropic or anisotropic.
#[derive(Clone, Copy, Debug, PartialEq)]
struct Ggx {
    ax: f32,
    ay: f32,
    /// `α²` of the isotropic lobe.
    a2: f32,
    iso: bool,
}

impl Ggx {
    fn new(alpha: f32, anisotropy: f32) -> Ggx {
        if anisotropy > 0.0 {
            let s = (1.0 - 0.9 * anisotropy).sqrt();
            Ggx {
                ax: (alpha / s).max(MIN_ALPHA),
                ay: (alpha * s).max(MIN_ALPHA),
                a2: alpha * alpha,
                iso: false,
            }
        } else {
            Ggx {
                ax: alpha,
                ay: alpha,
                a2: alpha * alpha,
                iso: true,
            }
        }
    }

    /// `D(h)` for a unit half vector in the local frame.
    #[inline]
    fn d(&self, h: Vec3) -> f32 {
        if self.iso {
            ggx_d(h, self.a2)
        } else {
            let x = h.x / self.ax;
            let y = h.y / self.ay;
            let t = x * x + y * y + h.z * h.z;
            if t <= 0.0 {
                return 0.0;
            }
            1.0 / (fmath::PI * self.ax * self.ay * t * t)
        }
    }

    /// Smith `Λ(w)`.
    #[inline]
    fn lambda(&self, w: Vec3) -> f32 {
        if self.iso {
            return ggx_lambda(w, self.a2);
        }
        let cos2 = w.z * w.z;
        if cos2 <= 0.0 {
            return f32::INFINITY;
        }
        let x = self.ax * w.x;
        let y = self.ay * w.y;
        ((1.0 + (x * x + y * y) / cos2).sqrt() - 1.0) * 0.5
    }

    /// `G1(wo) D(h) / (4 μo)`: the density of [`sample_vndf`] followed by mirror reflection.
    #[inline]
    fn reflection_pdf(&self, wo: Vec3, h: Vec3) -> f32 {
        let g1 = 1.0 / (1.0 + self.lambda(wo));
        g1 * self.d(h) / (4.0 * wo.z)
    }

    /// `D G2 / (4 μo μi)`: the microfacet reflection term without Fresnel.
    #[inline]
    fn microfacet(&self, wo: Vec3, wi: Vec3, h: Vec3) -> f32 {
        let g2 = 1.0 / (1.0 + self.lambda(wo) + self.lambda(wi));
        self.d(h) * g2 / (4.0 * wo.z * wi.z)
    }
}

/// Largest channel.
#[inline]
fn peak_of(c: Rgb) -> f32 {
    c.r.max(c.g).max(c.b)
}

/// Schlick's approximation between `f0` (normal incidence) and `f90` (grazing).
#[inline]
fn schlick(f0: f32, f90: f32, cos: f32) -> f32 {
    let m = (1.0 - cos).clamp(0.0, 1.0);
    let m2 = m * m;
    f0 + (f90 - f0) * (m2 * m2 * m)
}

/// The exact Fresnel reflectance of unpolarised light arriving at `cos_i` (≥ 0) on an interface
/// where the index rises by `eta` (the index of the far side over the near one): 1 under total
/// internal reflection. At normal incidence it is `((eta - 1) / (eta + 1))²`.
pub fn fresnel_dielectric(cos_i: f32, eta: f32) -> f32 {
    let cos_i = cos_i.clamp(0.0, 1.0);
    let sin2_t = (1.0 - cos_i * cos_i) / (eta * eta);
    if sin2_t >= 1.0 {
        return 1.0;
    }
    let cos_t = (1.0 - sin2_t).sqrt();
    let rs = (cos_i - eta * cos_t) / (cos_i + eta * cos_t);
    let rp = (eta * cos_i - cos_t) / (eta * cos_i + cos_t);
    0.5 * (rs * rs + rp * rp)
}

/// Reflectance `2R / (1 + R)` of a thin sheet of index `eta` (both faces, every bounce between).
#[inline]
fn thin_reflectance(cos: f32, eta: f32) -> f32 {
    let r = fresnel_dielectric(cos, eta);
    2.0 * r / (1.0 + r)
}

/// `wo` refracted through the microfacet `h` (`wo·h > 0`) into a medium `eta` times denser;
/// `None` under total internal reflection.
#[inline]
pub(crate) fn refract(wo: Vec3, h: Vec3, eta: f32) -> Option<Vec3> {
    let cos_i = wo.dot(h);
    let sin2_t = (1.0 - cos_i * cos_i) / (eta * eta);
    if sin2_t >= 1.0 {
        return None;
    }
    let cos_t = (1.0 - sin2_t).sqrt();
    Some((h * (cos_i / eta - cos_t) - wo / eta).normalize())
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

/// A half vector distributed as the GGX visible normals seen from `wo` (Heitz 2018), for the
/// widths `ax`, `ay` along the frame's axes.
fn sample_vndf(wo: Vec3, ax: f32, ay: f32, u: (f32, f32)) -> Vec3 {
    let vh = Vec3::new(ax * wo.x, ay * wo.y, wo.z).normalize();
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
    Vec3::new(ax * nh.x, ay * nh.y, nh.z.max(1.0e-7)).normalize()
}

/// Lobe selection probabilities `(coat, specular, diffuse, clear)` towards `wo`, and the
/// multiple-scattering lobes', sampled by the cosine with the diffuse one.
struct LobeWeights {
    coat: f32,
    specular: f32,
    diffuse: f32,
    clear: f32,
    ms: f32,
}

/// The multiple-scattering compensation of one surface (E9a, [`energy`]); every part is `None`
/// when its lobe is smooth (or absent), so a smooth surface computes exactly what it did before.
#[derive(Clone, Copy, Debug, PartialEq)]
struct MultiScatter {
    /// The specular lobe's extra lobe and its colour: `F_ms` of the metal and of the opaque
    /// dielectric, by their weights.
    spec: Option<(energy::Lobe, Rgb)>,
    /// The coat's extra lobe and `coat · F_ms`.
    coat: Option<(energy::Lobe, f32)>,
    /// The clear part's GGX width when it is divided by its own albedo (Turquin).
    clear: Option<f32>,
}

impl MultiScatter {
    const NONE: MultiScatter = MultiScatter {
        spec: None,
        coat: None,
        clear: None,
    };
}

/// The principled BSDF of one surface point, in its local frame.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Bsdf {
    /// Lambert albedo before Fresnel weighting: `base * (1 - metallic) * (1 - transmission)`.
    diffuse: Rgb,
    /// Metal reflectance at normal incidence (the base colour).
    metal_f0: Rgb,
    /// Metal reflectance at grazing incidence.
    metal_f90: Rgb,
    /// Weight of the metal Fresnel in the specular lobe.
    metallic: f32,
    /// Weight of the opaque dielectric's Fresnel in the specular lobe:
    /// `(1 - metallic)(1 - transmission)`.
    dielectric: f32,
    /// Opaque dielectric reflectance at normal and grazing incidence.
    f0: f32,
    f90: f32,
    /// The specular (and clear) lobe's distribution.
    spec: Ggx,
    /// Clear coat strength and distribution.
    coat: f32,
    coat_ggx: Ggx,
    /// Weight of the clear part: `(1 - metallic) transmission`.
    clear: f32,
    /// Relative index across the surface, the side of `wi` over the side of `wo`.
    eta: f32,
    /// Colour of one crossing of the clear part.
    tint: Rgb,
    /// The clear part is a thin wall (or index-matched): straight transmission.
    thin: bool,
    /// Multiple-scattering compensation (E9a).
    ms: MultiScatter,
    /// Above zero, the surface is the exit of a scattering medium (E9b): a Lambertian
    /// transmission lobe of this albedo and nothing else ([`Bsdf::medium_exit`]).
    exit: f32,
    /// The opaque dielectric's specular layer, as the diffuse lobe under it sees it (E9a2).
    base_layer: energy::Layer,
    /// The clear coat, as the layers under it see it (E9a2).
    coat_layer: energy::Layer,
    /// The diffuse lobe's normalisation under both layers ([`energy::joint_norm`]).
    diffuse_norm: f32,
}

impl Bsdf {
    /// The BSDF of a principled material seen from outside (kinds 0 and 1). Parameters are
    /// clamped to their valid ranges: an albedo above one would create energy.
    pub fn principled(m: &Material) -> Bsdf {
        Bsdf::surface(m, true)
    }

    /// The BSDF of a principled material, with `wo` on the outside of the surface (`entering`)
    /// or inside it: only the clear part of a solid tells the difference (its relative index
    /// and coat).
    pub fn surface(m: &Material, entering: bool) -> Bsdf {
        let base = m.base_color.map(|v| v.clamp(0.0, 1.0));
        let metallic = if m.kind == MATERIAL_GLASS {
            0.0
        } else {
            m.metallic.clamp(0.0, 1.0)
        };
        let transmission = m.transmission.clamp(0.0, 1.0);
        let ior = m.ior.max(1.0);
        let f0 = ((ior - 1.0) / (ior + 1.0)) * ((ior - 1.0) / (ior + 1.0));
        let roughness = m.roughness.clamp(0.0, 1.0);
        let coat_roughness = m.coat_roughness.clamp(0.0, 1.0);
        let anisotropy = m.anisotropy.clamp(0.0, 1.0);
        let clear = (1.0 - metallic) * transmission;
        // An index-matched solid does not refract either: it is a thin wall.
        let thin = m.flags & MATERIAL_FLAG_THIN != 0 || ior < 1.0001;
        let eta = if thin || entering { ior } else { 1.0 / ior };
        let tint = if thin {
            base
        } else if m.absorption_mm > 0.0 {
            Rgb::WHITE
        } else {
            base.map(|v| v.sqrt())
        };
        let coat = if clear > 0.0 && !thin && !entering {
            0.0
        } else {
            m.coat.clamp(0.0, 1.0)
        };
        let mut bsdf = Bsdf {
            diffuse: base * ((1.0 - metallic) * (1.0 - transmission)),
            metal_f0: base,
            metal_f90: base.map(|v| (50.0 * v).min(1.0)),
            metallic,
            dielectric: (1.0 - metallic) * (1.0 - transmission),
            f0,
            f90: (50.0 * f0).min(1.0),
            spec: Ggx::new((roughness * roughness).max(MIN_ALPHA), anisotropy),
            coat,
            coat_ggx: Ggx::new((coat_roughness * coat_roughness).max(MIN_ALPHA), 0.0),
            clear,
            eta,
            tint,
            thin,
            ms: MultiScatter::NONE,
            exit: 0.0,
            base_layer: energy::Layer::CLEAR,
            coat_layer: energy::Layer::CLEAR,
            diffuse_norm: 1.0,
        };
        bsdf.ms = bsdf.multiple_scattering();
        bsdf.layers();
        bsdf
    }

    /// The specular layer over the diffuse lobe and the coat over everything, with their
    /// albedos from the energy tables (E9a2, [`energy::Layer`]).
    fn layers(&mut self) {
        let alpha = if self.spec.iso {
            self.spec.ax
        } else {
            (self.spec.ax * self.spec.ay).sqrt()
        };
        if self.diffuse.r > 0.0 || self.diffuse.g > 0.0 || self.diffuse.b > 0.0 {
            let ms = self.ms.spec.map_or(0.0, |(lobe, _)| {
                energy::multiple_fresnel(energy::schlick_average(self.f0, self.f90), lobe.e_avg)
            });
            self.base_layer = energy::Layer::new(self.f0, self.f90, 1.0, alpha, ms);
        }
        if self.coat > 0.0 {
            let ms = self.ms.coat.map_or(0.0, |(lobe, _)| {
                energy::multiple_fresnel(energy::schlick_average(COAT_F0, 1.0), lobe.e_avg)
            });
            self.coat_layer = energy::Layer::new(COAT_F0, 1.0, self.coat, self.coat_ggx.ax, ms);
        }
        self.diffuse_norm = energy::joint_norm(&self.base_layer, &self.coat_layer);
    }

    /// The compensation of this surface's rough lobes (E9a).
    fn multiple_scattering(&self) -> MultiScatter {
        // Anisotropic lobes use the isotropic tables at the geometric mean of their widths.
        let alpha = if self.spec.iso {
            self.spec.ax
        } else {
            (self.spec.ax * self.spec.ay).sqrt()
        };
        let spec = energy::Lobe::new(alpha)
            .filter(|_| self.has_specular())
            .and_then(|lobe| {
                let ms = |f0: f32, f90: f32| {
                    energy::multiple_fresnel(energy::schlick_average(f0, f90), lobe.e_avg)
                };
                let dielectric = if self.dielectric > 0.0 {
                    self.dielectric * ms(self.f0, self.f90)
                } else {
                    0.0
                };
                let colour = if self.metallic > 0.0 {
                    Rgb::new(
                        ms(self.metal_f0.r, self.metal_f90.r),
                        ms(self.metal_f0.g, self.metal_f90.g),
                        ms(self.metal_f0.b, self.metal_f90.b),
                    ) * self.metallic
                        + Rgb::splat(dielectric)
                } else {
                    Rgb::splat(dielectric)
                };
                (peak_of(colour) > 0.0).then_some((lobe, colour))
            });
        let coat = if self.coat > 0.0 {
            energy::Lobe::new(self.coat_ggx.ax).and_then(|lobe| {
                let c = self.coat
                    * energy::multiple_fresnel(energy::schlick_average(COAT_F0, 1.0), lobe.e_avg);
                (c > 0.0).then_some((lobe, c))
            })
        } else {
            None
        };
        let clear = (self.clear > 0.0 && !self.thin && alpha >= energy::MIN_COMPENSATED_ALPHA)
            .then_some(alpha);
        MultiScatter { spec, coat, clear }
    }

    /// Turquin's factor of the clear part towards `wo`: one over its single-scattering power
    /// albedo (1 when it is not compensated).
    #[inline]
    fn clear_compensation(&self, mu_o: f32) -> Option<f32> {
        self.ms.clear.map(|alpha| {
            let e = energy::clear_albedo(mu_o, alpha, self.eta);
            1.0 / e.max(0.05)
        })
    }

    /// A pure Lambertian BSDF of `albedo` (the visible floor).
    pub fn lambert(albedo: Rgb) -> Bsdf {
        Bsdf {
            diffuse: albedo.map(|v| v.clamp(0.0, 1.0)),
            metal_f0: Rgb::BLACK,
            metal_f90: Rgb::BLACK,
            metallic: 0.0,
            dielectric: 1.0,
            f0: 0.0,
            f90: 0.0,
            spec: Ggx::new(1.0, 0.0),
            coat: 0.0,
            coat_ggx: Ggx::new(1.0, 0.0),
            clear: 0.0,
            eta: 1.0,
            tint: Rgb::WHITE,
            thin: false,
            ms: MultiScatter::NONE,
            exit: 0.0,
            base_layer: energy::Layer::CLEAR,
            coat_layer: energy::Layer::CLEAR,
            diffuse_norm: 1.0,
        }
    }

    /// Where a random walk leaves a scattering medium (E9b, [`crate::integrator::medium`]): a
    /// Lambertian lobe that transmits through the surface (to `wi.z < 0`, the outside) with
    /// albedo `albedo` (`η²` of the solid: radiance inside is that much brighter), and reflects
    /// nothing. The walk has already chosen to leave with the probability `1 - F` of the
    /// boundary's Fresnel; the directions it arrives with are taken as isotropic.
    pub fn medium_exit(albedo: f32) -> Bsdf {
        Bsdf {
            exit: albedo.max(0.0),
            diffuse: Rgb::BLACK,
            clear: 1.0,
            ..Bsdf::lambert(Rgb::BLACK)
        }
    }

    /// True when the surface transmits (it has a clear part).
    pub fn is_transmissive(&self) -> bool {
        self.clear > 0.0
    }

    /// The relative index across the surface: the index on the side of `wi` over the one on the
    /// side of `wo` (`ior` entering a solid, `1 / ior` leaving it, `ior` for a thin wall). The
    /// refraction of [`Bsdf::sample`] carries the `1/η²` of radiance; light particles (the
    /// photons of [`crate::caustics`]) carry flux and take it back out.
    pub fn eta(&self) -> f32 {
        self.eta
    }

    /// True when the surface transmits straight through (a thin wall's clear part).
    pub fn is_thin(&self) -> bool {
        self.thin && self.clear > 0.0
    }

    /// What a ray that crosses this surface straight keeps (thin walls: `1 - R'` of the clear
    /// part, tinted; opaque parts block). `cos` is the cosine with the normal. Shadow rays
    /// through thin walls use it.
    pub fn straight_transmittance(&self, cos: f32) -> Rgb {
        if !self.is_thin() {
            return Rgb::BLACK;
        }
        let cos = cos.abs().min(1.0);
        let t = 1.0 - thin_reflectance(cos, self.eta);
        self.tint * (self.clear * (1.0 - self.coat_fresnel(cos)) * t)
    }

    /// True when the specular lobe can reflect anything.
    #[inline]
    fn has_specular(&self) -> bool {
        (self.f90 > 0.0 && self.dielectric > 0.0) || self.metallic > 0.0
    }

    /// Specular Fresnel at `cos` (opaque dielectric and metal blended by their weights).
    #[inline]
    fn specular_fresnel(&self, cos: f32) -> Rgb {
        let d = schlick(self.f0, self.f90, cos);
        if self.metallic <= 0.0 && self.clear <= 0.0 {
            return Rgb::splat(d);
        }
        let metal = Rgb::new(
            schlick(self.metal_f0.r, self.metal_f90.r, cos),
            schlick(self.metal_f0.g, self.metal_f90.g, cos),
            schlick(self.metal_f0.b, self.metal_f90.b, cos),
        );
        Rgb::splat(d) * self.dielectric + metal * self.metallic
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

    /// Fresnel reflectance of the clear part at the microfacet cosine `cos`.
    #[inline]
    fn clear_fresnel(&self, cos: f32) -> f32 {
        if self.thin {
            thin_reflectance(cos, self.eta)
        } else {
            fresnel_dielectric(cos, self.eta)
        }
    }

    /// Probability of choosing reflection inside the clear lobe, for `wo` at `cos` from the
    /// normal.
    #[inline]
    fn reflect_probability(&self, cos: f32) -> f32 {
        self.clear_fresnel(cos).min(MAX_REFLECT_PROBABILITY)
    }

    /// The probability with which the clear lobe reflects through the microfacet at `cos_h` from
    /// `wo` (at `mu_o` from the normal): the macroscopic choice of the smooth lobe, the
    /// microfacet's own Fresnel for the rough one ([`Bsdf::sample_rough_clear`]).
    #[inline]
    fn reflect_chance(&self, mu_o: f32, cos_h: f32) -> f32 {
        if self.ms.clear.is_some() {
            self.clear_fresnel(cos_h)
        } else {
            self.reflect_probability(mu_o)
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
        let diffuse = below * self.diffuse.luminance() * self.base_layer.passes(wo.z);
        let clear = below * self.clear;
        let mut ms = 0.0;
        if let Some((lobe, colour)) = self.ms.spec {
            ms += below * colour.luminance().max(0.0) * lobe.lost(wo.z);
        }
        if let Some((lobe, c)) = self.ms.coat {
            ms += c * lobe.lost(wo.z);
        }
        let total = coat + specular + diffuse + clear + ms;
        if total > 0.0 {
            let inv = 1.0 / total;
            LobeWeights {
                coat: coat * inv,
                specular: specular * inv,
                diffuse: diffuse * inv,
                clear: clear * inv,
                ms: ms * inv,
            }
        } else {
            LobeWeights {
                coat: 0.0,
                specular: 0.0,
                diffuse: 0.0,
                clear: 0.0,
                ms: 0.0,
            }
        }
    }

    /// `f(wo, wi)` (without the cosine). Zero unless `wo` is above the surface; `wi` below it
    /// is the refraction of a solid clear part (thin walls transmit only straight, which no
    /// evaluation sees).
    pub fn eval(&self, wo: Vec3, wi: Vec3, lobes: Lobes) -> Rgb {
        if wo.z <= 0.0 {
            return Rgb::BLACK;
        }
        if self.exit > 0.0 {
            return if wi.z < 0.0 {
                Rgb::splat(self.exit * fmath::FRAC_1_PI)
            } else {
                Rgb::BLACK
            };
        }
        if wi.z <= 0.0 {
            if wi.z < 0.0 && lobes == Lobes::All && self.clear > 0.0 && !self.thin {
                return self.eval_refraction(wo, wi);
            }
            return Rgb::BLACK;
        }
        // Under the coat, specular lobes keep what passes it down and back up; the diffuse lobe,
        // which spreads light over the hemisphere, is normalised under both layers (E9a2).
        let attenuation = self.coat_layer.passes(wo.z) * self.coat_layer.passes(wi.z);
        let diffuse = self.diffuse
            * (fmath::FRAC_1_PI
                * self.base_layer.passes(wo.z)
                * self.base_layer.passes(wi.z)
                * self.diffuse_norm);
        if lobes == Lobes::Diffuse {
            return diffuse * attenuation;
        }
        let h = (wo + wi).normalize();
        let cos_h = wo.dot(h).max(0.0);
        let mut below = diffuse;
        if self.has_specular() {
            below += self.specular_fresnel(cos_h) * self.spec.microfacet(wo, wi, h);
        }
        if let Some((lobe, colour)) = self.ms.spec {
            below += colour * lobe.shape(wo.z, wi.z);
        }
        if self.clear > 0.0 {
            let mut clear =
                self.clear * self.clear_fresnel(cos_h) * self.spec.microfacet(wo, wi, h);
            if let Some(k) = self.clear_compensation(wo.z) {
                clear *= k;
            }
            below += Rgb::splat(clear);
        }
        let mut f = below * attenuation;
        if self.coat > 0.0 {
            f += Rgb::splat(self.coat_fresnel(cos_h) * self.coat_ggx.microfacet(wo, wi, h));
        }
        if let Some((lobe, c)) = self.ms.coat {
            f += Rgb::splat(c * lobe.shape(wo.z, wi.z));
        }
        f
    }

    /// The half vector of a refraction, facing `wo`, and `(wo·h, wi·h)`; `None` when `wo` and
    /// `wi` are not on the two sides of it.
    #[inline]
    fn refraction_half(&self, wo: Vec3, wi: Vec3) -> Option<(Vec3, f32, f32)> {
        let mut h = (wo + wi * self.eta).normalize();
        if h.z < 0.0 {
            h = -h;
        }
        let (co, ci) = (wo.dot(h), wi.dot(h));
        (co > 0.0 && ci < 0.0 && h.length_squared() > 0.5).then_some((h, co, ci))
    }

    /// Walter et al.'s refraction term (radiance transport) of the clear part, coat and tint.
    fn eval_refraction(&self, wo: Vec3, wi: Vec3) -> Rgb {
        let Some((h, co, ci)) = self.refraction_half(wo, wi) else {
            return Rgb::BLACK;
        };
        let f = fresnel_dielectric(co, self.eta);
        let denom = co + self.eta * ci;
        let g2 = 1.0 / (1.0 + self.spec.lambda(wo) + self.spec.lambda(wi));
        let mut value =
            (1.0 - f) * self.spec.d(h) * g2 * (-ci) * co / (-wi.z * wo.z * denom * denom);
        if let Some(k) = self.clear_compensation(wo.z) {
            value *= k;
        }
        let attenuation = self.coat_layer.passes(wo.z);
        self.tint * (self.clear * attenuation * value)
    }

    /// Density, per steradian, with which [`Bsdf::sample`] returns `wi` for this `wo` (the
    /// straight transmission of thin walls, a delta, is not part of it).
    pub fn pdf(&self, wo: Vec3, wi: Vec3) -> f32 {
        if wo.z <= 0.0 {
            return 0.0;
        }
        if self.exit > 0.0 {
            return (-wi.z).max(0.0) * fmath::FRAC_1_PI;
        }
        if wi.z <= 0.0 {
            if wi.z < 0.0 && self.clear > 0.0 && !self.thin {
                return self.refraction_pdf(&self.lobe_weights(wo), wo, wi);
            }
            return 0.0;
        }
        self.pdf_with(&self.lobe_weights(wo), wo, wi)
    }

    /// [`Bsdf::pdf`] of a reflected `wi` with the lobe weights of `wo` already computed.
    fn pdf_with(&self, w: &LobeWeights, wo: Vec3, wi: Vec3) -> f32 {
        let mut pdf = (w.diffuse + w.ms) * wi.z * fmath::FRAC_1_PI;
        if w.specular > 0.0 || w.coat > 0.0 || w.clear > 0.0 {
            let h = (wo + wi).normalize();
            if wo.dot(h) > 0.0 {
                if w.specular > 0.0 {
                    pdf += w.specular * self.spec.reflection_pdf(wo, h);
                }
                if w.coat > 0.0 {
                    pdf += w.coat * self.coat_ggx.reflection_pdf(wo, h);
                }
                if w.clear > 0.0 {
                    pdf += w.clear
                        * self.reflect_chance(wo.z, wo.dot(h))
                        * self.spec.reflection_pdf(wo, h);
                }
            }
        }
        pdf
    }

    /// The density of a refracted `wi`: visible normals times the refraction Jacobian.
    fn refraction_pdf(&self, w: &LobeWeights, wo: Vec3, wi: Vec3) -> f32 {
        if w.clear.is_nan() || w.clear <= 0.0 {
            return 0.0;
        }
        let Some((h, co, ci)) = self.refraction_half(wo, wi) else {
            return 0.0;
        };
        let g1 = 1.0 / (1.0 + self.spec.lambda(wo));
        let visible = g1 * self.spec.d(h) * co / wo.z;
        let denom = co + self.eta * ci;
        let jacobian = self.eta * self.eta * (-ci) / (denom * denom);
        w.clear * (1.0 - self.reflect_chance(wo.z, co)) * visible * jacobian
    }

    /// Samples an incident direction for `wo` from the 2-D sample `u`. `None` when the surface
    /// scatters nothing towards `wo`, or the sampled direction is not on the side its lobe
    /// scatters to (total internal reflection of a microfacet included).
    pub fn sample(&self, wo: Vec3, u: (f32, f32)) -> Option<BsdfSample> {
        if wo.z <= 0.0 {
            return None;
        }
        if self.exit > 0.0 {
            let d = warp::cosine_hemisphere(u);
            let wi = Vec3::new(d.x, d.y, -d.z);
            let pdf = d.z * fmath::FRAC_1_PI;
            return (pdf > 0.0).then_some(BsdfSample {
                wi,
                weight: Rgb::splat(self.exit),
                pdf,
                straight: false,
            });
        }
        let w = self.lobe_weights(wo);
        let (u0, u1) = u;
        let wi = if u0 < w.coat {
            let h = sample_vndf(wo, self.coat_ggx.ax, self.coat_ggx.ay, (u0 / w.coat, u1));
            h * (2.0 * wo.dot(h)) - wo
        } else if u0 < w.coat + w.specular {
            let h = sample_vndf(
                wo,
                self.spec.ax,
                self.spec.ay,
                ((u0 - w.coat) / w.specular, u1),
            );
            h * (2.0 * wo.dot(h)) - wo
        } else if w.diffuse + w.ms > 0.0
            && (w.clear <= 0.0 || u0 < w.coat + w.specular + (w.diffuse + w.ms))
        {
            // The diffuse and multiple-scattering lobes are both sampled by the cosine.
            let start = w.coat + w.specular;
            let u0 = ((u0 - start) / (w.diffuse + w.ms)).clamp(0.0, 0.999_999_94);
            warp::cosine_hemisphere((u0, u1))
        } else if w.clear > 0.0 {
            return self.sample_clear(&w, wo, u);
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
        Some(BsdfSample {
            wi,
            weight,
            pdf,
            straight: false,
        })
    }

    /// The clear lobe's part of [`Bsdf::sample`].
    fn sample_clear(&self, w: &LobeWeights, wo: Vec3, u: (f32, f32)) -> Option<BsdfSample> {
        let start = w.coat + w.specular + (w.diffuse + w.ms);
        let uc = ((u.0 - start) / w.clear).clamp(0.0, 0.999_999_94);
        if self.ms.clear.is_some() {
            return self.sample_rough_clear(w, wo, (uc, u.1));
        }
        let pr = self.reflect_probability(wo.z);
        if uc < pr {
            let h = sample_vndf(wo, self.spec.ax, self.spec.ay, (uc / pr, u.1));
            let wi = h * (2.0 * wo.dot(h)) - wo;
            if wi.z <= 0.0 {
                return None;
            }
            let pdf = self.pdf_with(w, wo, wi);
            if !(pdf > 0.0 && pdf.is_finite()) {
                return None;
            }
            let weight = self.eval(wo, wi, Lobes::All) * (wi.z / pdf);
            return Some(BsdfSample {
                wi,
                weight,
                pdf,
                straight: false,
            });
        }
        if self.thin {
            // Straight through: chosen with probability w.clear (1 - pr).
            let chance = w.clear * (1.0 - pr);
            if chance.is_nan() || chance <= 0.0 {
                return None;
            }
            let weight = self.straight_transmittance(wo.z) / chance;
            return Some(BsdfSample {
                wi: -wo,
                weight,
                pdf: chance,
                straight: true,
            });
        }
        let ut = ((uc - pr) / (1.0 - pr)).clamp(0.0, 0.999_999_94);
        let h = sample_vndf(wo, self.spec.ax, self.spec.ay, (ut, u.1));
        let wi = refract(wo, h, self.eta)?;
        if wi.z >= 0.0 {
            return None;
        }
        let pdf = self.refraction_pdf(w, wo, wi);
        if !(pdf > 0.0 && pdf.is_finite()) {
            return None;
        }
        let weight = self.eval_refraction(wo, wi) * (-wi.z / pdf);
        Some(BsdfSample {
            wi,
            weight,
            pdf,
            straight: false,
        })
    }

    /// The rough (compensated) clear lobe: the microfacet first, from the visible normals, then
    /// reflection with the probability of its own Fresnel, refraction otherwise (Walter et al.
    /// 2007, §5.3). Choosing by the macroscopic Fresnel instead, as the smooth lobe does, leaves
    /// the microfacets that reflect totally inside a solid to the rarely chosen reflection and
    /// gives them weights of tens, which the compensation would multiply. The choice takes a
    /// number hashed from the sample (the lobe already used both dimensions).
    fn sample_rough_clear(&self, w: &LobeWeights, wo: Vec3, u: (f32, f32)) -> Option<BsdfSample> {
        let h = sample_vndf(wo, self.spec.ax, self.spec.ay, u);
        let fresnel = self.clear_fresnel(wo.dot(h));
        let key = (u64::from(u.0.to_bits()) << 32) | u64::from(u.1.to_bits());
        let choice =
            (crate::rng::mix64(key ^ 0x9e37_79b9_7f4a_7c15) >> 40) as f32 * (1.0 / 16_777_216.0);
        if choice < fresnel {
            let wi = h * (2.0 * wo.dot(h)) - wo;
            if wi.z <= 0.0 {
                return None;
            }
            let pdf = self.pdf_with(w, wo, wi);
            if !(pdf > 0.0 && pdf.is_finite()) {
                return None;
            }
            let weight = self.eval(wo, wi, Lobes::All) * (wi.z / pdf);
            return Some(BsdfSample {
                wi,
                weight,
                pdf,
                straight: false,
            });
        }
        let wi = refract(wo, h, self.eta)?;
        if wi.z >= 0.0 {
            return None;
        }
        let pdf = self.refraction_pdf(w, wo, wi);
        if !(pdf > 0.0 && pdf.is_finite()) {
            return None;
        }
        let weight = self.eval_refraction(wo, wi) * (-wi.z / pdf);
        Some(BsdfSample {
            wi,
            weight,
            pdf,
            straight: false,
        })
    }
}

#[cfg(test)]
mod tests;
