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
        out.push(Material {
            base_color: Rgb::new(0.7, 0.2, 0.1),
            metallic: 0.5,
            roughness,
            coat: 0.7,
            coat_roughness: 0.6,
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
fn rough_white_metal_reflects_everything_once_compensated() {
    // With α = 1 GGX is uniform (D = 1/π) and, seen head on, Λ(wo) = 0, so single scattering
    // gives a white metal the albedo ∫ μ / (1 + μ) dμ = 1 - ln 2 (the table says so, see the
    // energy tests). E9a gives the rest back (Kulla and Conty 2017): white metal reflects
    // everything at every roughness and angle.
    for roughness in [0.2f32, 0.5, 0.8, 1.0] {
        let rough = Bsdf::principled(&Material {
            base_color: Rgb::WHITE,
            metallic: 1.0,
            roughness,
            ..Material::default()
        });
        for theta in [0.0f32, 30.0, 60.0, 80.0] {
            let a = albedo(&rough, dir(theta, 20.0), 200_000);
            assert!((a.g - 1.0).abs() < 0.01, "{roughness} at {theta}: {a:?}");
        }
    }
    // A coloured metal keeps its colour, more saturated than one bounce: gold's blue loses more
    // in the extra lobe (F_avg² E_avg / (1 - F_avg (1 - E_avg)) < F_avg) than its red.
    let gold = Material {
        base_color: Rgb::new(1.0, 0.77, 0.34),
        metallic: 1.0,
        roughness: 0.8,
        ..Material::default()
    };
    let compensated = albedo(&Bsdf::principled(&gold), dir(0.0, 0.0), 200_000);
    let single = {
        let mut b = Bsdf::principled(&gold);
        b.ms = MultiScatter::NONE;
        albedo(&b, dir(0.0, 0.0), 200_000)
    };
    assert!(
        compensated.r > single.r && compensated.b > single.b,
        "{compensated:?} {single:?}"
    );
    assert!(compensated.r <= 1.01, "{compensated:?}");
    assert!(
        compensated.b / compensated.r < single.b / single.r,
        "{compensated:?} vs {single:?}"
    );
}

#[test]
fn smooth_surfaces_have_no_compensation_and_rough_ones_do() {
    // Roughness 0 (the GGX width MIN_ALPHA) must render exactly as before E9a.
    for m in [
        Material {
            roughness: 0.0,
            ..Material::default()
        },
        Material {
            metallic: 1.0,
            roughness: 0.0,
            ..Material::default()
        },
        Material {
            roughness: 0.0,
            coat: 1.0,
            coat_roughness: 0.0,
            ..Material::default()
        },
        glass(0.0, 1.5),
    ] {
        for entering in [true, false] {
            assert_eq!(Bsdf::surface(&m, entering).ms, MultiScatter::NONE, "{m:?}");
        }
    }
    let rough = Bsdf::principled(&Material {
        roughness: 0.5,
        coat: 1.0,
        coat_roughness: 0.5,
        ..Material::default()
    });
    assert!(rough.ms.spec.is_some() && rough.ms.coat.is_some() && rough.ms.clear.is_none());
    let rough_glass = Bsdf::surface(&glass(0.5, 1.5), false);
    assert!(rough_glass.ms.clear.is_some() && rough_glass.ms.spec.is_none());
    // A rough plastic's extra lobe is tiny (a dielectric's F_avg is 0.09: F_ms 0.006 or so).
    let (lobe, colour) = rough.ms.spec.expect("lobe");
    assert!(colour.g > 0.0 && colour.g < 0.01, "{colour:?}");
    assert!(lobe.lost(1.0) > 0.0);
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
                // Single scattering lost energy when rough, more from inside: before E9a it
                // kept 0.99 for roughness 0.1, 0.86 for 0.3, 0.73 for 0.6 and 0.42 for 1 at
                // worst. Turquin's compensation gives it back.
                assert!(total > 0.985, "{roughness} {entering} {theta}: {total}");
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

// --- E9a: the energy tables -------------------------------------------------------------

/// The source of `bsdf/energy_table.rs` for these tables.
fn energy_table_source(
    reflection: &[u16],
    avg: &[f32],
    schlick: &[u16],
    schlick_avg: &[f32],
    clear_in: &[u16],
    clear_out: &[u16],
) -> String {
    use super::energy::{MAX_IOR, NODES_IOR, NODES_MU, NODES_ROUGHNESS, SEED, STRATA};
    use std::fmt::Write as _;
    let mut s = String::new();
    let _ = write!(
        s,
        "//! The multiple-scattering tables of the GGX lobes (phase E9a), generated by the test\n\
         //! `energy_tables_are_what_the_generator_writes` of `bsdf/tests.rs` from our own Monte Carlo\n\
         //! integration (`bsdf/energy.rs`, which documents the recipe): do not edit by hand.\n\
         //!\n\
         //! Recipe: seed {SEED:#x}, {STRATA} x {STRATA} jittered visible normals per node, {NODES_MU} nodes in\n\
         //! sqrt(mu), {NODES_ROUGHNESS} in roughness, {NODES_IOR} indices of refraction from 1 to {MAX_IOR}; values as\n\
         //! 16-bit fractions (E * 65535). Regenerate with\n\
         //! `REPACK_WRITE_TABLES=1 cargo test --release -p rt-core energy_tables_are_what_the_generator_writes`\n\
         //! from `engine/`.\n\n"
    );
    let block = |s: &mut String, doc: &str, name: &str, values: &[u16]| {
        let _ = write!(
            s,
            "/// {doc}\n#[rustfmt::skip]\npub static {name}: [u16; {}] = [\n",
            values.len()
        );
        for row in values.chunks(16) {
            s.push_str("   ");
            for v in row {
                let _ = write!(s, " {v},");
            }
            s.push('\n');
        }
        s.push_str("];\n\n");
    };
    block(
        &mut s,
        "`E(μ, α)` of GGX reflection with a Fresnel of one, `[roughness][μ]`.",
        "ALBEDO",
        reflection,
    );
    let floats = |s: &mut String, doc: &str, name: &str, values: &[f32]| {
        let _ = write!(
            s,
            "/// {doc}\n#[rustfmt::skip]\npub static {name}: [f32; {}] = [\n",
            values.len()
        );
        for row in values.chunks(8) {
            s.push_str("   ");
            for v in row {
                let _ = write!(s, " {v:?},");
            }
            s.push('\n');
        }
        s.push_str("];\n\n");
    };
    floats(
        &mut s,
        "`E_avg(α) = 2 ∫ E μ dμ` of [`ALBEDO`], per roughness node.",
        "ALBEDO_AVG",
        avg,
    );
    block(
        &mut s,
        "The Schlick moment `E₅(μ, α)`: the albedo with the Fresnel `(1 - wo·h)⁵`, `[roughness][μ]`.",
        "SCHLICK",
        schlick,
    );
    floats(
        &mut s,
        "`E₅,avg(α) = 2 ∫ E₅ μ dμ` of [`SCHLICK`], per roughness node.",
        "SCHLICK_AVG",
        schlick_avg,
    );
    block(
        &mut s,
        "Power albedo of the clear lobe entering a solid (`η = ior`), `[ior][roughness][μ]`.",
        "CLEAR_IN",
        clear_in,
    );
    block(
        &mut s,
        "Power albedo of the clear lobe leaving a solid (`η = 1 / ior`), `[ior][roughness][μ]`.",
        "CLEAR_OUT",
        clear_out,
    );
    s.truncate(s.trim_end().len());
    s.push('\n');
    s
}

#[test]
fn energy_tables_are_what_the_generator_writes() {
    use super::energy::*;
    use super::energy_table::*;
    if std::env::var_os("REPACK_WRITE_TABLES").is_some() {
        let albedo = generate_albedo(STRATA);
        let avg = generate_albedo_avg(&albedo);
        let schlick = generate_schlick(STRATA);
        let schlick_avg = generate_albedo_avg(&schlick);
        let clear_in = generate_clear(true, STRATA);
        let clear_out = generate_clear(false, STRATA);
        let path = concat!(env!("CARGO_MANIFEST_DIR"), "/src/bsdf/energy_table.rs");
        std::fs::write(
            path,
            energy_table_source(&albedo, &avg, &schlick, &schlick_avg, &clear_in, &clear_out),
        )
        .expect("write the table");
        return;
    }
    // A spread of nodes (every 37th, 113th) integrates to exactly the committed bits, and the
    // averages are the integral of the committed table.
    for n in (0..ALBEDO.len()).step_by(37) {
        let (j, i) = (n / NODES_MU, n % NODES_MU);
        let v = integrate_albedo(node_mu(i), node_alpha(j), STRATA, n as u64);
        assert_eq!(
            (v.clamp(0.0, 1.0) * 65535.0).round() as u16,
            ALBEDO[n],
            "node {n}"
        );
    }
    assert_eq!(generate_albedo_avg(&ALBEDO), ALBEDO_AVG.to_vec());
    for n in (5..SCHLICK.len()).step_by(41) {
        let (j, i) = (n / NODES_MU, n % NODES_MU);
        let v = integrate_schlick(node_mu(i), node_alpha(j), STRATA, n as u64 + (1 << 24));
        assert_eq!(
            (v.clamp(0.0, 1.0) * 65535.0).round() as u16,
            SCHLICK[n],
            "Schlick node {n}"
        );
    }
    assert_eq!(generate_albedo_avg(&SCHLICK), SCHLICK_AVG.to_vec());
    let slice = NODES_MU * NODES_ROUGHNESS;
    for n in (0..CLEAR_IN.len()).step_by(113) {
        let (k, rest) = (n / slice, n % slice);
        let (j, i) = (rest / NODES_MU, rest % NODES_MU);
        for (entering, table, offset) in [(true, &CLEAR_IN, 0u64), (false, &CLEAR_OUT, 1 << 20)] {
            let ior = node_ior(k);
            let eta = if entering { ior } else { 1.0 / ior };
            let v = integrate_clear(node_mu(i), node_alpha(j), eta, STRATA, n as u64 + offset);
            assert_eq!(
                (v.clamp(0.0, 1.0) * 65535.0).round() as u16,
                table[n],
                "clear node {n}, entering {entering}"
            );
        }
    }
    // Smooth limits: a mirror and an interface without roughness keep everything.
    assert_eq!(ALBEDO[NODES_MU - 1], 65535);
    assert_eq!(CLEAR_IN[NODES_MU - 1], 65535);
}

#[test]
fn the_energy_tables_are_within_half_a_percent_of_a_finer_integration() {
    use super::energy::*;
    // Points between the nodes, against 16 times the samples (256 x 256 visible normals), for
    // every incidence up to 87 degrees.
    let mut rng = Pcg32::seeded(0xe9a, 5);
    let mut worst = 0.0f64;
    for n in 0..24u64 {
        let mu = 0.05 + 0.95 * rng.next_f32();
        let r = rng.next_f32();
        let alpha = r * r;
        let reference = integrate_albedo(mu, alpha, 4 * STRATA, 1000 + n);
        let table = f64::from(albedo(mu, alpha));
        worst = worst.max((table - reference).abs());
        assert!(
            (table - reference).abs() < 0.005,
            "E({mu}, {alpha}): {table} vs {reference}"
        );
        let reference = integrate_schlick(mu, alpha, 4 * STRATA, 3000 + n);
        let table = f64::from(schlick_albedo(mu, alpha));
        worst = worst.max((table - reference).abs());
        assert!(
            (table - reference).abs() < 0.005,
            "E5({mu}, {alpha}): {table} vs {reference}"
        );
        for ior in [1.33f32, 1.45, 1.52, 1.585, 2.42] {
            if n % 4 != u64::from(ior.to_bits()) % 4 {
                continue;
            }
            for eta in [ior, 1.0 / ior] {
                let reference = integrate_clear(mu, alpha, eta, 4 * STRATA, 2000 + n);
                let table = f64::from(clear_albedo(mu, alpha, eta));
                worst = worst.max((table - reference).abs());
                assert!(
                    (table - reference).abs() < 0.005,
                    "E_t({mu}, {alpha}, {eta}): {table} vs {reference}"
                );
            }
        }
    }
    eprintln!("energy tables: worst absolute error {worst:.5}");
    // The averages against an independent Monte Carlo integration of 2 ∫ E μ dμ.
    for j in [3usize, 10, 20, 31] {
        let alpha = node_alpha(j);
        let mc = integrate_albedo_avg(alpha, STRATA, 77 + j as u64);
        let table = f64::from(albedo_avg(alpha));
        assert!(
            (table - mc).abs() < 0.003,
            "E_avg({alpha}): {table} vs {mc}"
        );
    }
    // The analytic value at α = 1 head on: D = 1/π, Λ(wo) = 0, E = ∫ μ / (1 + μ) dμ... = 1 - ln 2.
    let e = albedo(1.0, 1.0);
    assert!((e - (1.0 - std::f32::consts::LN_2)).abs() < 0.001, "{e}");
}

#[test]
fn the_extra_lobes_are_kulla_and_contys_shape_times_their_fresnel() {
    use super::energy::{multiple_fresnel, schlick_average, Lobe};
    // The lobe's own albedo is 1 - E(μo) (its normalisation and E_avg agree with the table).
    for alpha in [0.04f32, 0.25, 0.64, 1.0] {
        let lobe = Lobe::new(alpha).expect("rough");
        for mu_o in [0.1f32, 0.5, 0.9] {
            let steps = 4000;
            let integral: f32 = (0..steps)
                .map(|k| {
                    let mu = (k as f32 + 0.5) / steps as f32;
                    lobe.shape(mu_o, mu) * mu * fmath::TAU / steps as f32
                })
                .sum();
            assert!(
                (integral - lobe.lost(mu_o)).abs() < 1.0e-3,
                "α {alpha}, μ {mu_o}: {integral} vs {}",
                lobe.lost(mu_o)
            );
        }
    }
    // A rough coat over rough gold: what the compensation adds to `eval` is the coat's
    // coat · F_ms(0.04, 1) shape plus the attenuated metal's F_ms(f0, f90) shape per channel.
    let m = Material {
        base_color: Rgb::new(1.0, 0.77, 0.34),
        metallic: 1.0,
        roughness: 0.7,
        coat: 0.8,
        coat_roughness: 0.6,
        ..Material::default()
    };
    let full = Bsdf::principled(&m);
    let mut single = full;
    single.ms = MultiScatter::NONE;
    let spec = Lobe::new(0.49).expect("lobe");
    let coat = Lobe::new(0.36).expect("lobe");
    for (a, b) in [
        (dir(20.0, 0.0), dir(50.0, 120.0)),
        (dir(70.0, 10.0), dir(5.0, 200.0)),
    ] {
        let (f, s) = (full.eval(a, b, Lobes::All), single.eval(a, b, Lobes::All));
        let added = Rgb::new(f.r - s.r, f.g - s.g, f.b - s.b);
        let attenuation = full.coat_layer.passes(a.z) * full.coat_layer.passes(b.z);
        let coat_part =
            0.8 * multiple_fresnel(schlick_average(0.04, 1.0), coat.e_avg) * coat.shape(a.z, b.z);
        for (got, f0) in [(added.r, 1.0f32), (added.g, 0.77), (added.b, 0.34)] {
            let metal =
                multiple_fresnel(schlick_average(f0, 1.0), spec.e_avg) * spec.shape(a.z, b.z);
            let want = attenuation * metal + coat_part;
            assert!(
                (got - want).abs() <= 1.0e-5 + 1.0e-4 * want,
                "{got} vs {want}"
            );
        }
        assert!(coat_part > 0.0);
    }
}

#[test]
fn layers_pass_what_they_do_not_reflect() {
    use super::energy::{joint_norm, schlick_average, Layer};
    // The quadrature integrates 2μ (1 - μ)^10 = 1/66 (Schlick's curve squared) exactly.
    let gauss: f32 = (0..1000)
        .map(|k| {
            let mu = (k as f32 + 0.5) / 1000.0;
            2.0 * mu * (1.0 - mu).powi(10) / 1000.0
        })
        .sum();
    assert!((gauss - 1.0 / 66.0).abs() < 1.0e-4, "{gauss}");
    // A smooth layer is Schlick's curve: E_s(μ) = F(μ), E_s,avg = f0 + (f90 - f0) / 21.
    let smooth = Layer::new(0.04, 1.0, 1.0, MIN_ALPHA, 0.0);
    for mu in [0.05f32, 0.3, 1.0] {
        assert!((smooth.albedo(mu) - schlick(0.04, 1.0, mu)).abs() < 1.0e-6);
    }
    assert!((smooth.norm() - 1.0 / (1.0 - schlick_average(0.04, 1.0))).abs() < 1.0e-5);
    // A diffuse lobe under one layer gives back exactly what passes it.
    for alpha in [0.01f32, 0.25, 1.0] {
        let layer = Layer::new(0.04, 1.0, 1.0, alpha, 0.006);
        for mu_o in [0.2f32, 0.6, 1.0] {
            let steps = 2000;
            let back: f32 = (0..steps)
                .map(|k| {
                    let mu = (k as f32 + 0.5) / steps as f32;
                    layer.under(mu_o, mu) * 2.0 * mu / steps as f32
                })
                .sum();
            assert!(
                (back - layer.passes(mu_o)).abs() < 2.0e-3,
                "{alpha} {mu_o}: {back}"
            );
        }
        // And under two, with the joint normalisation.
        let coat = Layer::new(0.04, 1.0, 0.7, 0.09, 0.006);
        let norm = joint_norm(&layer, &coat);
        let steps = 2000;
        let back: f32 = (0..steps)
            .map(|k| {
                let mu = (k as f32 + 0.5) / steps as f32;
                layer.passes(mu) * coat.passes(mu) * 2.0 * mu / steps as f32
            })
            .sum();
        assert!(
            (back * norm - 1.0).abs() < 2.0e-3,
            "{alpha}: {}",
            back * norm
        );
    }
    // Nothing on top is exactly nothing (the floor and index-matched bases keep their bits).
    let clear = Layer::new(0.0, 0.0, 1.0, 0.5, 0.0);
    assert_eq!(clear, Layer::CLEAR);
    assert_eq!(
        (clear.passes(0.3), clear.norm(), joint_norm(&clear, &clear)),
        (1.0, 1.0, 1.0)
    );
}
