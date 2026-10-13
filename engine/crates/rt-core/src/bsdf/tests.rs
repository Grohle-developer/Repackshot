//! Tests of the principled BSDF: reciprocity, energy, densities; E5 adds the clear (glass)
//! lobe, thin walls and anisotropy.

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

/// Directional albedo split into what is reflected and what is transmitted (straight samples
/// included), estimated by sampling the BSDF.
fn albedo_split(bsdf: &Bsdf, wo: Vec3, n: u32) -> (Rgb, Rgb) {
    let mut rng = Pcg32::seeded(23, u64::from(n));
    let (mut r, mut t) = (Rgb::BLACK, Rgb::BLACK);
    for _ in 0..n {
        if let Some(s) = bsdf.sample(wo, (rng.next_f32(), rng.next_f32())) {
            if s.wi.z > 0.0 {
                r += s.weight;
            } else {
                t += s.weight;
            }
        }
    }
    (r / n as f32, t / n as f32)
}

fn glass(roughness: f32, ior: f32) -> Material {
    Material {
        kind: crate::scene::MATERIAL_GLASS,
        base_color: Rgb::WHITE,
        roughness,
        ior,
        transmission: 1.0,
        ..Material::default()
    }
}

#[test]
fn fresnel_at_normal_incidence_is_the_textbook_value_and_total_reflection_happens() {
    for n in [1.0f32, 1.33, 1.5, 1.52, 2.4] {
        let want = ((n - 1.0) / (n + 1.0)) * ((n - 1.0) / (n + 1.0));
        assert!((fresnel_dielectric(1.0, n) - want).abs() < 1.0e-7, "{n}");
        assert!(
            (fresnel_dielectric(1.0, 1.0 / n) - want).abs() < 1.0e-6,
            "{n}"
        );
    }
    // Inside glass of 1.5 the critical angle is asin(1 / 1.5) = 41.8 degrees.
    let critical = fmath::asin(1.0 / 1.5);
    assert_eq!(
        fresnel_dielectric(fmath::cos(critical + 0.01), 1.0 / 1.5),
        1.0
    );
    assert!(fresnel_dielectric(fmath::cos(critical - 0.01), 1.0 / 1.5) < 1.0);
    // Reciprocity across the interface: F(θi, η) = F(θt, 1/η).
    for deg in [0.0f32, 20.0, 40.0, 60.0, 80.0] {
        let ci = fmath::cos(deg * fmath::DEG_TO_RAD);
        let st = (1.0 - ci * ci).sqrt() / 1.5;
        let ct = (1.0 - st * st).sqrt();
        let (a, b) = (
            fresnel_dielectric(ci, 1.5),
            fresnel_dielectric(ct, 1.0 / 1.5),
        );
        assert!((a - b).abs() < 1.0e-5, "{deg}: {a} vs {b}");
    }
    // Grazing incidence reflects everything.
    assert!(fresnel_dielectric(0.0, 1.5) > 0.999);
}

/// The transmitted radiance of one crossing is `(1 - F) / η²` of what arrives (radiance is
/// compressed by `η²` entering a denser medium and expands again leaving it): this is the power
/// that crossed, as a fraction of the power that arrived.
fn power(t: Rgb, eta: f32) -> f32 {
    t.g * eta * eta
}

#[test]
fn smooth_glass_reflects_its_fresnel_and_transmits_the_rest() {
    let bsdf = Bsdf::principled(&glass(0.0, 1.5));
    let (r, t) = albedo_split(&bsdf, Vec3::new(0.0, 0.0, 1.0), 200_000);
    // Head on: 4 % reflected, 96 % of the power refracted.
    assert!((r.g - 0.04).abs() < 0.004, "{r:?}");
    assert!((power(t, 1.5) - 0.96).abs() < 0.004, "{t:?}");
    assert!((t.g - 0.96 / 2.25).abs() < 0.002, "{t:?}");
    for theta in [0.0f32, 30.0, 60.0, 80.0, 88.0] {
        let wo = dir(theta, 15.0);
        let (r, t) = albedo_split(&bsdf, wo, 100_000);
        let f = fresnel_dielectric(wo.z, 1.5);
        let total = r.g + power(t, 1.5);
        assert!((total - 1.0).abs() < 0.01, "{theta}: {total}");
        assert!((r.g - f).abs() < 0.01 + 0.05 * f, "{theta}: {} vs {f}", r.g);
    }
    // From inside, beyond the critical angle, everything is reflected.
    let inside = Bsdf::surface(&glass(0.0, 1.5), false);
    let (r, t) = albedo_split(&inside, dir(60.0, 0.0), 50_000);
    assert!((r.g - 1.0).abs() < 0.01 && t.g == 0.0, "{r:?} {t:?}");
    // Below it the inside transmits too, and the total is still one.
    let (r, t) = albedo_split(&inside, dir(20.0, 0.0), 50_000);
    let out = power(t, 1.0 / 1.5);
    assert!(out > 0.9 && (r.g + out - 1.0).abs() < 0.01, "{r:?} {t:?}");
}

#[test]
fn rough_glass_never_gains_energy() {
    for roughness in [0.1f32, 0.3, 0.6, 1.0] {
        for entering in [true, false] {
            let bsdf = Bsdf::surface(&glass(roughness, 1.5), entering);
            let eta = if entering { 1.5 } else { 1.0 / 1.5 };
            for theta in [0.0f32, 30.0, 60.0, 85.0] {
                let (r, t) = albedo_split(&bsdf, dir(theta, 40.0), 60_000);
                let total = r.g + power(t, eta);
                assert!(total <= 1.01, "{roughness} {entering} {theta}: {total}");
                // Single scattering loses energy when rough, more from inside (where light
                // that the microfacets reflect below the surface is lost): measured 0.99 for
                // roughness 0.1, 0.86 for 0.3, 0.73 for 0.6 and 0.42 for 1 at worst. A
                // multiple-scattering term (Heitz et al. 2016) could give it back later.
                let floor = match roughness {
                    r if r <= 0.1 => 0.98,
                    r if r <= 0.3 => 0.85,
                    r if r <= 0.6 => 0.7,
                    _ => 0.4,
                };
                assert!(total > floor, "{roughness} {entering} {theta}: {total}");
            }
        }
    }
}

#[test]
fn transmission_samples_are_eval_cos_over_pdf_and_the_pdf_is_a_density() {
    let mut rng = Pcg32::seeded(31, 4);
    for m in [glass(0.3, 1.5), glass(0.5, 1.33)] {
        for entering in [true, false] {
            let bsdf = Bsdf::surface(&m, entering);
            let wo = dir(35.0, 10.0);
            let n = 200_000;
            let mut found = 0u32;
            for _ in 0..n {
                if let Some(s) = bsdf.sample(wo, (rng.next_f32(), rng.next_f32())) {
                    let f = bsdf.eval(wo, s.wi, Lobes::All);
                    let expect = f * (s.wi.z.abs() / s.pdf);
                    assert!(
                        (expect.g - s.weight.g).abs() <= 1.0e-4 * expect.g.max(1.0),
                        "{expect:?} vs {:?}",
                        s.weight
                    );
                    assert!((bsdf.pdf(wo, s.wi) - s.pdf).abs() <= 1.0e-4 * s.pdf);
                    found += 1;
                }
            }
            // The density integrates over the sphere to the share of samples that succeed.
            let integral = sphere_integral(&bsdf, wo, 2_000_000);
            let success = f64::from(found) / f64::from(n);
            assert!(
                (integral / success - 1.0).abs() < 0.03,
                "{m:?} {entering}: ∫pdf {integral} vs {success}"
            );
        }
    }
}

#[test]
fn transmission_blends_the_diffuse_base_into_glass() {
    let wo = dir(30.0, 0.0);
    let mut previous = -1.0f32;
    let f = fresnel_dielectric(wo.z, 1.5);
    for t in [0.0f32, 0.25, 0.5, 0.75, 1.0] {
        let m = Material {
            base_color: Rgb::WHITE,
            roughness: 0.2,
            transmission: t,
            ..Material::default()
        };
        let (_, through) = albedo_split(&Bsdf::principled(&m), wo, 100_000);
        let crossed = power(through, 1.5);
        assert!(crossed > previous, "{t}: {through:?}");
        assert!((crossed - t * (1.0 - f)).abs() < 0.03, "{t}: {crossed}");
        previous = crossed;
    }
    // Without transmission nothing goes below the surface.
    let opaque = Bsdf::principled(&Material::default());
    assert_eq!(albedo_split(&opaque, wo, 1000).1, Rgb::BLACK);
}

#[test]
fn thin_walls_reflect_both_faces_and_pass_the_rest_straight() {
    let m = Material {
        base_color: Rgb::new(1.0, 0.5, 0.25),
        flags: crate::scene::MATERIAL_FLAG_THIN,
        ..glass(0.0, 1.5)
    };
    let bsdf = Bsdf::principled(&m);
    assert!(bsdf.is_thin());
    let wo = dir(0.0, 0.0);
    let r1 = fresnel_dielectric(1.0, 1.5);
    let r = 2.0 * r1 / (1.0 + r1);
    let mut rng = Pcg32::seeded(3, 1);
    let (mut refl, mut through) = (Rgb::BLACK, Rgb::BLACK);
    let n = 100_000;
    for _ in 0..n {
        let s = bsdf
            .sample(wo, (rng.next_f32(), rng.next_f32()))
            .expect("sample");
        if s.straight {
            assert_eq!(s.wi, -wo);
            through += s.weight;
        } else {
            assert!(s.wi.z > 0.0);
            refl += s.weight;
        }
    }
    let (refl, through) = (refl / n as f32, through / n as f32);
    assert!((refl.g - r).abs() < 0.004, "{refl:?} vs {r}");
    // The tint is applied once, to the 1 - R' that passes.
    for (got, c) in [(through.r, 1.0), (through.g, 0.5), (through.b, 0.25)] {
        assert!((got - c * (1.0 - r)).abs() < 0.01, "{through:?}");
    }
    assert_eq!(
        bsdf.straight_transmittance(1.0),
        Rgb::new(1.0, 0.5, 0.25) * (1.0 - r)
    );
    // A thin wall never refracts: nothing to evaluate below the surface.
    assert_eq!(bsdf.eval(wo, dir(170.0, 0.0), Lobes::All), Rgb::BLACK);
    assert_eq!(bsdf.pdf(wo, dir(170.0, 0.0)), 0.0);
    // Opaque materials block straight rays.
    assert_eq!(
        Bsdf::principled(&Material::default()).straight_transmittance(1.0),
        Rgb::BLACK
    );
}

#[test]
fn coloured_solid_glass_tints_each_crossing_by_the_square_root() {
    let m = Material {
        base_color: Rgb::new(0.25, 1.0, 0.64),
        ..glass(0.0, 1.5)
    };
    let (_, t) = albedo_split(&Bsdf::principled(&m), dir(0.0, 0.0), 50_000);
    let scale = t.g;
    assert!(
        (t.r / scale - 0.5).abs() < 1.0e-3 && (t.b / scale - 0.8).abs() < 1.0e-3,
        "{t:?}"
    );
    // With an absorption distance the surface does not tint: the medium does.
    let absorbing = Material {
        absorption_mm: 10.0,
        ..m
    };
    let (_, t) = albedo_split(&Bsdf::principled(&absorbing), dir(0.0, 0.0), 50_000);
    assert!(
        (t.r - t.g).abs() < 1.0e-6 && (t.b - t.g).abs() < 1.0e-6,
        "{t:?}"
    );
}

#[test]
fn anisotropy_stretches_the_highlight_along_the_tangent() {
    let iso = Material {
        base_color: Rgb::WHITE,
        metallic: 1.0,
        roughness: 0.3,
        ..Material::default()
    };
    let aniso = Material {
        anisotropy: 0.8,
        ..iso.clone()
    };
    let (a, b) = (Bsdf::principled(&iso), Bsdf::principled(&aniso));
    // Zero anisotropy is exactly the isotropic lobe.
    let zero = Bsdf::principled(&Material {
        anisotropy: 0.0,
        ..iso.clone()
    });
    assert_eq!(zero, a);
    let wo = dir(30.0, 180.0);
    let mirror = dir(30.0, 0.0);
    // Off the mirror direction by 15 degrees along x (the tangent) and along y.
    let along = dir(45.0, 0.0);
    let across = Vec3::new(mirror.x, 0.26, mirror.z).normalize();
    let ratio =
        |bsdf: &Bsdf| bsdf.eval(wo, along, Lobes::All).g / bsdf.eval(wo, across, Lobes::All).g;
    assert!(
        ratio(&b) > 2.0 * ratio(&a),
        "{} vs {}",
        ratio(&b),
        ratio(&a)
    );
    // It stays reciprocal, energy-conserving, and its density is one.
    let mut rng = Pcg32::seeded(9, 9);
    for _ in 0..200 {
        let x = dir(rng.next_f32() * 89.0, rng.next_f32() * 360.0);
        let y = dir(rng.next_f32() * 89.0, rng.next_f32() * 360.0);
        let (xy, yx) = (b.eval(x, y, Lobes::All), b.eval(y, x, Lobes::All));
        assert!((xy.g - yx.g).abs() <= 1.0e-5 * xy.g.max(1.0));
    }
    for theta in [0.0, 45.0, 80.0] {
        let alb = albedo(&b, dir(theta, 30.0), 100_000);
        assert!(alb.g <= 1.01, "{theta}: {alb:?}");
    }
    let n = 200_000;
    let mut found = 0u32;
    for _ in 0..n {
        if let Some(s) = b.sample(wo, (rng.next_f32(), rng.next_f32())) {
            assert!((b.pdf(wo, s.wi) - s.pdf).abs() <= 1.0e-5 * s.pdf);
            found += 1;
        }
    }
    let integral = sphere_integral(&b, wo, 2_000_000);
    let success = f64::from(found) / f64::from(n);
    assert!(
        (integral / success - 1.0).abs() < 0.03,
        "{integral} vs {success}"
    );
}

/// `∫ pdf(wo, wi) dωi` over the sphere, by uniform sampling.
fn sphere_integral(bsdf: &Bsdf, wo: Vec3, n: u32) -> f64 {
    let mut rng = Pcg32::seeded(77, u64::from(n));
    let mut sum = 0.0f64;
    for _ in 0..n {
        let wi = crate::warp::uniform_sphere((rng.next_f32(), rng.next_f32()));
        sum += f64::from(bsdf.pdf(wo, wi));
    }
    4.0 * std::f64::consts::PI * sum / f64::from(n)
}
