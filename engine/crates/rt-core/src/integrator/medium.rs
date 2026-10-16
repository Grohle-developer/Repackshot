//! Scattering media inside closed solids (phase E9b): translucent plastics, wax, soap, milk,
//! juice.
//!
//! **The model.** A clear solid (`transmission` above zero, not a thin wall, not metal, not an
//! emitter) with `MATL.scatter_mm` above zero is filled with a homogeneous medium: mean free path
//! `scatter_mm`, single-scattering albedo `scatter_color` per channel, Henyey–Greenstein phase of
//! anisotropy `scatter_g` (L. G. Henyey and J. L. Greenstein, "Diffuse radiation in the Galaxy",
//! *Astrophys. J.* 93, 1941; clamped to ±0.9). So `σt = 1 / scatter_mm`, `σs = albedo σt` and
//! `σa = (1 - albedo) σt` per channel, plus the Beer–Lambert absorption of `absorption_mm` and
//! `base_color` when the material has one, which makes `σt` differ between channels.
//!
//! **The random walk** (the approach of M. J.-Y. Chiang, P. Kutz and B. Burley, "Practical and
//! Controllable Subsurface Scattering for Production Path Tracing", SIGGRAPH 2016 Talks, Walt
//! Disney Animation Studios, written from the talk): a path that refracts into the solid walks
//! inside it. Each step samples a free
//! distance `-ln(ξ) / σt` of one channel, the *hero* channel chosen once per walk, and the
//! throughput carries the one-sample balance heuristic over the three channels for the whole walk
//! (spectral MIS, as in A. Wilkie et al., "Hero Wavelength Spectral Sampling", EGSR 2014): with
//! `p_k` the density the walk would have had with channel `k` leading, channel `c` gets
//! `f_c / (⅓ Σ_k p_k)`, kept as running ratios to the hero's density and renormalised at every
//! step, so a long walk never overflows. A step shorter than the boundary is a scattering event: a
//! new direction from the phase function, and, after [`ROULETTE_AFTER`] events, Russian roulette
//! on the walk's own weight: survival `max(throughput) / max(throughput at the entry)`, what the
//! walk has lost since it entered (the path entered carrying the `1/η²` of refraction, which its
//! exit gives back, so a roulette on the throughput itself would kill half of the walks for
//! nothing). There is **no next-event estimation inside**: lights are found where the walk leaves.
//!
//! **The boundary.** A step that reaches the boundary without having scattered is a plain
//! crossing: the surface's own BSDF takes the path, as for clear glass. After scattering, the
//! surface's Fresnel at the angle the walk arrives decides ([`exit_or_reflect`]): with probability
//! `F` (one beyond the critical angle) the walk reflects back in, mirrored about the boundary, and
//! goes on; otherwise it leaves, and the boundary becomes an ordinary surface vertex with a
//! Lambertian transmission lobe ([`crate::bsdf::Bsdf::medium_exit`]): the directions a dense walk
//! arrives with are nearly isotropic, so what leaves is treated as diffuse, `(1 - F)` times (the
//! probability of leaving) a lobe of albedo `η²` (radiance inside a solid is `η²` that outside;
//! the path that refracted in carries the `1/η²`). The integrator then samples a light from there
//! with multiple importance sampling and continues with a cosine-distributed direction, as at any
//! surface. That is the talk's production approximation: it ignores where the exit direction
//! would refract to and gives every exit the same angular spread, and it is what lets milk
//! converge. A white medium in a uniform world comes out white whatever the angle a walk arrives
//! at (the energy test). Roughness of the boundary does not change the exit lobe; it acts on the
//! entry and on the specular reflection above.
//!
//! **The cap.** Media do not count against `RNDR.max_depth` (a walk can take hundreds of events);
//! instead a path takes at most [`MAX_MEDIUM_EVENTS`] steps in all (events and reflections at the
//! boundary). Past them the walk goes straight to the boundary keeping its throughput but for
//! absorption (the rest of the scattering folded into the forward direction) and leaves there by
//! the exit lobe, without the Fresnel reflection (a folded walk would otherwise be trapped in a
//! curved solid by total internal reflection, as in clear glass). The energy stays; only where it
//! comes from is approximate, for the few paths that get that far.
//!
//! **The exact boundary** (tests only, [`WalkPath::exact`]): a walk that scattered also hands the
//! path to the surface's own BSDF where it reaches the boundary, which refracts it out or reflects
//! it back in as clear glass does. That is the physically exact estimator the exit lobe
//! approximates (noisier: a light behind the boundary is found only by the refracted direction);
//! the tests measure the lobe against it.
//!
//! **Random numbers.** Every number a walk uses is a hashed dimension beyond the Sobol table
//! ([`crate::sampler::medium_dim`], like the cut-outs), so a scene without media draws exactly the
//! numbers it drew before E9 and keeps its image to the bit.
//!
//! **Caustics.** A scattering medium is a receiver ([`crate::caustics::is_caster`] says no): the
//! photon map stores photons on its surface and none enter it.

use super::{peak, Tracer};
use crate::bsdf::fresnel_dielectric;
use crate::color::Rgb;
use crate::fmath;
use crate::geometry::RayHit;
use crate::math::{offset_origin, Frame, Ray, Vec3};
use crate::sampler::{medium_dim, PixelSampler};
use crate::scene::{Material, Scene, MATERIAL_FLAG_THIN, MATERIAL_GLASS};

/// Most steps (scattering events and reflections at the boundary) of one camera path, over all
/// its walks.
pub const MAX_MEDIUM_EVENTS: u32 = crate::sampler::MEDIUM_EVENTS;
/// Events of a walk before Russian roulette starts.
pub const ROULETTE_AFTER: u32 = 32;
/// Largest `|g|` of the phase function.
pub const MAX_G: f32 = 0.9;

/// Offsets inside the dimensions of one step ([`medium_dim`]).
const OFFSET_DISTANCE: u32 = 0;
const OFFSET_PHASE: u32 = 1;
const OFFSET_ROULETTE: u32 = 3;
const OFFSET_FRESNEL: u32 = 4;
const OFFSET_HERO: u32 = 5;

/// The homogeneous medium inside one material's solids.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ScatterMedium {
    /// Scattering coefficient per millimetre, per channel.
    pub sigma_s: Rgb,
    /// Absorption coefficient per millimetre, per channel.
    pub sigma_a: Rgb,
    /// Extinction `σs + σa`, per channel.
    pub sigma_t: Rgb,
    /// Henyey–Greenstein anisotropy.
    pub g: f32,
    /// The solid's index of refraction (the Fresnel of its boundary from inside).
    pub ior: f32,
}

/// True when the surface of `m` bounds a solid with an inside (clear, not a thin wall, not metal,
/// not an emitter).
pub fn is_clear_solid(m: &Material) -> bool {
    let metal = m.kind != MATERIAL_GLASS && m.metallic >= 1.0;
    // An index-matched surface is a thin wall to the BSDF (`crate::bsdf`): it has no inside.
    m.transmission > 0.0
        && !metal
        && m.flags & MATERIAL_FLAG_THIN == 0
        && !m.is_emissive()
        && m.ior >= 1.0001
}

/// The scattering medium inside the solids of `m`, if it has one.
pub fn of(m: &Material) -> Option<ScatterMedium> {
    if !(m.scatter_mm > 0.0 && m.scatter_mm.is_finite() && is_clear_solid(m)) {
        return None;
    }
    let sigma = 1.0 / m.scatter_mm;
    let albedo = m.scatter_color.map(|v| v.clamp(0.0, 1.0));
    let mut sigma_a = albedo.map(|a| (1.0 - a) * sigma);
    if m.absorption_mm > 0.0 {
        sigma_a += m
            .base_color
            .map(|c| -fmath::ln(c.clamp(1.0e-4, 1.0)) / m.absorption_mm);
    }
    let sigma_s = albedo * sigma;
    Some(ScatterMedium {
        sigma_s,
        sigma_a,
        sigma_t: sigma_s + sigma_a,
        g: if m.scatter_g.is_finite() {
            m.scatter_g.clamp(-MAX_G, MAX_G)
        } else {
            0.0
        },
        ior: m.ior,
    })
}

/// The Henyey–Greenstein phase function for the cosine between the direction the path arrived
/// along and the one it leaves along (per steradian; symmetric, so the light's and the camera's
/// view agree).
#[inline]
pub fn phase(cos: f32, g: f32) -> f32 {
    let d = 1.0 + g * g - 2.0 * g * cos;
    (1.0 - g * g) / (4.0 * fmath::PI * d * d.max(1.0e-12).sqrt())
}

/// A direction around `dir` distributed by the phase function (the inverse of its cumulative
/// distribution in the cosine), and its density.
pub fn sample_phase(dir: Vec3, g: f32, u: (f32, f32)) -> (Vec3, f32) {
    let cos = if g.abs() < 1.0e-3 {
        1.0 - 2.0 * u.0
    } else {
        let s = (1.0 - g * g) / (1.0 - g + 2.0 * g * u.0);
        ((1.0 + g * g - s * s) / (2.0 * g)).clamp(-1.0, 1.0)
    };
    let sin = (1.0 - cos * cos).max(0.0).sqrt();
    let (sp, cp) = fmath::sin_cos(fmath::TAU * u.1);
    let frame = Frame::from_normal(dir);
    let out = frame
        .to_world(Vec3::new(sin * cp, sin * sp, cos))
        .normalize();
    (out, phase(cos, g))
}

/// Channel `k` of a colour.
#[inline]
fn channel(c: Rgb, k: usize) -> f32 {
    match k {
        0 => c.r,
        1 => c.g,
        _ => c.b,
    }
}

/// `exp(-σ t)` per channel.
#[inline]
fn transmittance(sigma: Rgb, t: f32) -> Rgb {
    sigma.map(|s| fmath::exp(-s * t))
}

/// How a walk ended.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) enum WalkEnd {
    /// The path crossed the solid without scattering and reached `hit` (along the walk's last
    /// ray): the surface's own BSDF takes it.
    Crossed { hit: RayHit },
    /// After scattering, the walk leaves through the surface at `hit`: the integrator shades it
    /// with the exit lobe of albedo `η²` ([`crate::bsdf::Bsdf::medium_exit`]). `pdf` is the
    /// density of the last direction.
    Exit { hit: RayHit, eta2: f32, pdf: f32 },
    /// The last ray left without hitting anything (an open mesh).
    Escaped,
    /// Russian roulette or a black throughput ended the path inside.
    Absorbed,
}

/// The state of one camera path that a walk reads and updates.
pub(crate) struct WalkPath<'a> {
    /// The ray inside the medium: on return, the last segment of the walk.
    pub ray: &'a mut Ray,
    /// The path throughput: on return, times the walk's (spectral MIS) weight.
    pub throughput: &'a mut Rgb,
    /// Steps of the path so far (all its walks).
    pub events: &'a mut u32,
    /// Rays cast.
    pub rays: &'a mut u64,
    /// The path vertex the walk started after (its surface entry).
    pub bounce: u32,
    /// Leave through the surface's own BSDF instead of the exit lobe (the exact boundary).
    pub exact: bool,
}

/// The boundary's decision for a walk that arrives at `cos` from the normal (inside): reflect
/// back in with the probability of the Fresnel of leaving a solid of index `ior` (one beyond the
/// critical angle), leave otherwise.
#[inline]
pub fn exit_or_reflect(cos: f32, ior: f32, u: f32) -> bool {
    u >= fresnel_dielectric(cos, 1.0 / ior.max(1.0001))
}

/// Walks the path inside `medium` until it leaves it (see the module documentation).
pub(crate) fn walk<T: Tracer>(
    scene: &Scene,
    tracer: &T,
    sampler: &PixelSampler,
    medium: &ScatterMedium,
    path: WalkPath<'_>,
) -> WalkEnd {
    let WalkPath {
        ray,
        throughput,
        events: path_events,
        rays,
        bounce,
        exact,
    } = path;
    let first = medium_dim(bounce, 0);
    let hero = ((sampler.get1(first + OFFSET_HERO) * 3.0) as usize).min(2);
    let sigma_hero = channel(medium.sigma_t, hero);
    // Π f / Π p_hero and Π p_k / Π p_hero, renormalised so that the largest ratio is one.
    let mut w = Rgb::WHITE;
    let mut ratio = Rgb::WHITE;
    let mut events = 0u32;
    let mut steps = 0u32;
    let mut pdf = 0.0f32;
    let entry = *throughput;
    let effective = |w: Rgb, ratio: Rgb| w * (3.0 / (ratio.r + ratio.g + ratio.b));
    loop {
        *rays += 1;
        let hit = tracer.trace(ray);
        let t_hit = hit.map_or(f32::INFINITY, |h| h.t);
        let capped = *path_events >= MAX_MEDIUM_EVENTS || sigma_hero.is_nan() || sigma_hero <= 0.0;
        let dims = medium_dim(bounce, steps);
        steps += 1;
        let t = if capped {
            f32::INFINITY
        } else {
            let u = sampler.get1(dims + OFFSET_DISTANCE);
            -fmath::ln(1.0 - u) / sigma_hero
        };
        if t < t_hit {
            // A scattering event.
            let p = medium.sigma_t * transmittance(medium.sigma_t, t);
            let f = medium.sigma_s * transmittance(medium.sigma_t, t);
            let ph = channel(p, hero);
            if ph.is_nan() || ph <= 0.0 {
                return WalkEnd::Absorbed;
            }
            w = w * (f / ph);
            ratio = ratio * (p / ph);
            let m = peak(ratio);
            if m > 0.0 {
                w = w / m;
                ratio = ratio / m;
            }
            events += 1;
            *path_events += 1;
            let current = entry * effective(w, ratio);
            if !(peak(current) > 0.0 && peak(current).is_finite()) {
                return WalkEnd::Absorbed;
            }
            if events > ROULETTE_AFTER {
                let survive = (peak(current) / peak(entry)).clamp(0.05, 1.0);
                if sampler.get1(dims + OFFSET_ROULETTE) >= survive {
                    return WalkEnd::Absorbed;
                }
                w = w / survive;
            }
            let x = ray.at(t);
            let (dir, density) = sample_phase(ray.dir, medium.g, sampler.get2(dims + OFFSET_PHASE));
            pdf = density;
            *ray = Ray::new(x, dir);
            continue;
        }
        // The boundary (or, past the last step, straight to it keeping all but absorption).
        if t_hit.is_finite() {
            if capped {
                w = w * transmittance(medium.sigma_a, t_hit);
            } else {
                let p = transmittance(medium.sigma_t, t_hit);
                let ph = channel(p, hero);
                if ph.is_nan() || ph <= 0.0 {
                    return WalkEnd::Absorbed;
                }
                w = w * (p / ph);
                ratio = ratio * (p / ph);
            }
        }
        *throughput = entry * effective(w, ratio);
        if !(peak(*throughput) > 0.0 && peak(*throughput).is_finite()) {
            return WalkEnd::Absorbed;
        }
        let Some(hit) = hit else {
            return WalkEnd::Escaped;
        };
        if events == 0 || exact {
            return WalkEnd::Crossed { hit };
        }
        let Some(details) = scene.geometry.hit_details(ray, hit) else {
            return WalkEnd::Absorbed;
        };
        let ng = details.geometric_normal;
        let cos = (-ray.dir.dot(ng)).clamp(0.0, 1.0);
        let leave = capped || exit_or_reflect(cos, medium.ior, sampler.get1(dims + OFFSET_FRESNEL));
        if leave {
            return WalkEnd::Exit {
                hit,
                eta2: medium.ior * medium.ior,
                pdf,
            };
        }
        // Reflected back in (a step of the path, for the cap).
        *path_events += 1;
        let dir = (ray.dir + ng * (2.0 * cos)).normalize();
        *ray = Ray::new(offset_origin(details.point, ng), dir);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rng::Pcg32;

    #[test]
    fn the_phase_function_is_a_density_and_its_samples_follow_it() {
        let mut rng = Pcg32::seeded(9, 2);
        for g in [-0.6f32, 0.0, 0.3, 0.85] {
            // ∫ p dω = 2π ∫ p(cos) dcos = 1, and the mean cosine is g.
            let steps = 20_000;
            let (mut total, mut mean) = (0.0f64, 0.0f64);
            for k in 0..steps {
                let c = -1.0 + 2.0 * (k as f32 + 0.5) / steps as f32;
                let p = f64::from(phase(c, g)) * std::f64::consts::TAU * 2.0 / f64::from(steps);
                total += p;
                mean += p * f64::from(c);
            }
            assert!((total - 1.0).abs() < 1.0e-3, "g {g}: {total}");
            assert!(
                (mean - f64::from(g)).abs() < 2.0e-3,
                "g {g}: mean cosine {mean}"
            );
            // Sampled directions: E[1 / pdf] = 4π and the sampled cosines average g.
            let dir = Vec3::new(0.3, -0.4, 0.866).normalize();
            let n = 200_000;
            let (mut inv, mut cos) = (0.0f64, 0.0f64);
            for _ in 0..n {
                let (d, pdf) = sample_phase(dir, g, (rng.next_f32(), rng.next_f32()));
                assert!((d.length() - 1.0).abs() < 1.0e-4);
                assert!((pdf - phase(d.dot(dir), g)).abs() <= 1.0e-3 * pdf.max(1.0));
                inv += 1.0 / f64::from(pdf);
                cos += f64::from(d.dot(dir));
            }
            let sphere = inv / f64::from(n) / (4.0 * std::f64::consts::PI);
            assert!((sphere - 1.0).abs() < 0.03, "g {g}: {sphere}");
            assert!((cos / f64::from(n) - f64::from(g)).abs() < 0.01, "g {g}");
        }
    }

    #[test]
    fn a_medium_is_its_mean_free_path_albedo_and_absorption() {
        let m = Material {
            kind: MATERIAL_GLASS,
            transmission: 1.0,
            scatter_mm: 4.0,
            scatter_color: Rgb::new(1.0, 0.5, 0.0),
            scatter_g: 2.0,
            ..Material::default()
        };
        let s = of(&m).expect("a medium");
        assert_eq!(s.sigma_t, Rgb::splat(0.25));
        assert_eq!(s.sigma_s, Rgb::new(0.25, 0.125, 0.0));
        assert_eq!(s.g, MAX_G);
        // Absorption adds to the extinction, per channel.
        let absorbing = Material {
            base_color: Rgb::new(1.0, 0.5, 0.25),
            absorption_mm: 10.0,
            ..m.clone()
        };
        let a = of(&absorbing).expect("a medium");
        assert!((a.sigma_t.g - (0.25 + 0.5f32.ln().abs() / 10.0)).abs() < 1.0e-6);
        assert_eq!(a.sigma_s, s.sigma_s);
        // No medium without a mean free path, on thin walls, on metal, on opaque surfaces.
        for none in [
            Material {
                scatter_mm: 0.0,
                ..m.clone()
            },
            Material {
                flags: MATERIAL_FLAG_THIN,
                ..m.clone()
            },
            Material {
                kind: 0,
                metallic: 1.0,
                ..m.clone()
            },
            Material {
                transmission: 0.0,
                ..m.clone()
            },
        ] {
            assert_eq!(of(&none), None, "{none:?}");
        }
    }
}
