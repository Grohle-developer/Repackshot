//! Tests of the effect filters (O3a).

use super::filters::*;
use super::{Lens, LensParams};
use crate::image::Film;
use crate::math::Vec3;
use crate::render::{render_tile, render_tile_with, TileRect};
use crate::scene::{Camera, EnvKind, Environment, Light, LightKind, Scene, LIGHT_FLAG_CAMERA};

fn filter(kind: u32, grade: f32) -> FilterParams {
    FilterParams {
        kind,
        grade,
        ..FilterParams::default()
    }
}

fn lens_with(filters: [FilterParams; 3]) -> Lens {
    Lens::new(LensParams {
        filters,
        ..LensParams::default()
    })
    .unwrap()
}

/// Uniform numbers of a fixed low-discrepancy-free walk (a 2-D Halton-like pair and two hashes).
fn numbers(i: u32) -> [f32; 4] {
    let mix = |mut h: u32| {
        h ^= h >> 16;
        h = h.wrapping_mul(0x7feb_352d);
        h ^= h >> 15;
        h = h.wrapping_mul(0x846c_a68b);
        h ^= h >> 16;
        (h >> 8) as f32 / (1u32 << 24) as f32
    };
    [
        mix(i.wrapping_mul(4)),
        mix(i.wrapping_mul(4) + 1),
        mix(i.wrapping_mul(4) + 2),
        mix(i.wrapping_mul(4) + 3),
    ]
}

/// A white furnace seen through `lens`: every ray sees radiance 1.
fn furnace(lens: Option<Lens>) -> Scene {
    let mut scene = Scene {
        environment: Environment {
            kind: EnvKind::Flat,
            floor: 1.0,
            horizon: 1.0,
            zenith: 1.0,
            strength: 1.0,
            ..Environment::default()
        },
        ..Scene::default()
    };
    scene.render.width = 24;
    scene.render.height = 16;
    scene.camera = Camera {
        fstop: 2.8,
        focus_dist: 500.0,
        lens,
        ..Camera::default()
    };
    scene
}

fn mean_rgb(scene: &Scene, samples: u32) -> [f64; 3] {
    let (w, h) = (scene.render.width, scene.render.height);
    let mut film = Film::new(w, h);
    for s in 0..samples {
        render_tile(scene, TileRect { x: 0, y: 0, w, h }, s, &mut film);
    }
    let rgb = film.resolve();
    let mut sum = [0.0f64; 3];
    for p in rgb.chunks_exact(3) {
        for c in 0..3 {
            sum[c] += f64::from(p[c]);
        }
    }
    let n = (w * h) as f64;
    sum.map(|v| v / n)
}

#[test]
fn the_grades_give_the_proposed_scattered_fractions() {
    for (g, s) in GRADES.iter().zip(GRADE_S) {
        assert_eq!(grade_s(*g), s);
    }
    assert_eq!(grade_s(0.0), 0.0);
    assert!((grade_s(0.75) - 0.5 * (GRADE_S[2] + GRADE_S[3])).abs() < 1.0e-6);
    assert!(grade_s(0.0625) > 0.0 && grade_s(0.0625) < GRADE_S[0]);
}

#[test]
fn white_diffusion_keeps_the_mean_of_a_white_field() {
    let scene = furnace(Some(lens_with([
        filter(FILTER_DIFFUSION_WHITE, 1.0),
        FilterParams::default(),
        FilterParams::default(),
    ])));
    let m = mean_rgb(&scene, 32);
    for c in m {
        assert!((c - 1.0).abs() < 0.005, "{m:?}");
    }
}

#[test]
fn black_diffusion_lowers_a_white_field_between_ninety_and_ninety_seven_percent() {
    let scene = furnace(Some(lens_with([
        filter(FILTER_DIFFUSION_BLACK, 1.0),
        FilterParams::default(),
        FilterParams::default(),
    ])));
    let m = mean_rgb(&scene, 64);
    let expected = 1.0 - f64::from(grade_s(1.0) * (1.0 - BLACK_TRANSMISSION));
    for c in m {
        assert!((0.90..=0.97).contains(&c), "{m:?}");
        assert!((c - expected).abs() < 0.01, "{m:?} against {expected}");
    }
}

#[test]
fn a_six_point_star_puts_its_energy_on_six_lines() {
    // The PSF of a point source: the deflections of the scattered samples, binned by angle,
    // beyond 1° of the centre (nearer, the lines' width is a wide angle).
    for angle in [0.0f32, 15.0, 37.0] {
        let f = Filter::new(&FilterParams {
            kind: FILTER_STAR,
            grade: 2.0,
            angle_deg: angle,
            points: 6,
            ..FilterParams::default()
        })
        .unwrap()
        .unwrap();
        let mut bins = [0.0f64; 360];
        let mut scattered = 0;
        for i in 0..200_000 {
            let mut u = numbers(i);
            u[0] *= f.s(); // always scatter
            if let Some(Scatter {
                delta: (dx, dy),
                weight: w,
                ..
            }) = f.scatter(u)
            {
                scattered += 1;
                if f64::from(dx).hypot(f64::from(dy)) < 1.0f64.to_radians() {
                    continue;
                }
                let a = f64::from(dy)
                    .atan2(f64::from(dx))
                    .to_degrees()
                    .rem_euclid(360.0);
                bins[(a as usize).min(359)] += f64::from(w[1]);
            }
        }
        assert_eq!(scattered, 200_000);
        // Six peaks, 60° apart from `angle`, each within 2° of where it should be, and next to
        // nothing between them.
        let total: f64 = bins.iter().sum();
        for k in 0..6 {
            let at = (f64::from(angle) + 60.0 * f64::from(k)).rem_euclid(360.0);
            let near: f64 = (0..360)
                .filter(|&b| {
                    let d = (b as f64 + 0.5 - at).rem_euclid(360.0);
                    d.min(360.0 - d) <= 2.0
                })
                .map(|b| bins[b])
                .sum();
            assert!(
                near > 0.15 * total,
                "angle {angle}: line {k} holds {}",
                near / total
            );
            let peak = (0..360)
                .filter(|&b| {
                    let d = (b as f64 + 0.5 - at).rem_euclid(360.0);
                    d.min(360.0 - d) <= 30.0
                })
                .max_by(|&a, &b| bins[a].total_cmp(&bins[b]))
                .unwrap();
            let d = (peak as f64 + 0.5 - at).rem_euclid(360.0);
            assert!(
                d.min(360.0 - d) <= 2.0,
                "angle {angle}: peak {k} at {peak}°, not {at}°"
            );
        }
        let between: f64 = (0..360)
            .filter(|&b| {
                (0..6).all(|k| {
                    let at = (f64::from(angle) + 60.0 * f64::from(k)).rem_euclid(360.0);
                    let d = (b as f64 + 0.5 - at).rem_euclid(360.0);
                    d.min(360.0 - d) > 5.0
                })
            })
            .map(|b| bins[b])
            .sum();
        assert!(
            between < 0.01 * total,
            "angle {angle}: {} between the lines",
            between / total
        );
    }
}

#[test]
fn gold_diffusion_warms_its_halation_and_leaves_its_core_neutral() {
    let gold = Filter::new(&filter(FILTER_DIFFUSION_GOLD, 1.0))
        .unwrap()
        .unwrap();
    let white = Filter::new(&filter(FILTER_DIFFUSION_WHITE, 1.0))
        .unwrap()
        .unwrap();
    // The same numbers, far out in the tail and in the core.
    let at = |f: &Filter, radial: f32| {
        let mut u = numbers(1);
        u[0] = 0.0;
        u[1] = radial;
        f.scatter(u).unwrap()
    };
    let (far, near) = (at(&gold, 0.995), at(&gold, 0.05));
    assert!(far.delta.0.hypot(far.delta.1) > 5.0f32.to_radians());
    assert!(near.delta.0.hypot(near.delta.1) < 0.3f32.to_radians());
    assert_eq!(at(&white, 0.995).weight, [1.0, 1.0, 1.0]);
    assert_eq!(at(&white, 0.05).weight, [1.0, 1.0, 1.0]);
    let (g, c) = (far.weight, near.weight);
    assert!(g[0] > 1.05 && g[2] < 0.9, "the tail is warm: {g:?}");
    assert!(
        (c[0] - 1.0).abs() < 0.01 && (c[2] - 1.0).abs() < 0.01,
        "the core is neutral: {c:?}"
    );
    for w in [g, c] {
        let luma = 0.2126 * w[0] + 0.7152 * w[1] + 0.0722 * w[2];
        assert!(
            (luma - 1.0).abs() < 1.0e-5,
            "the tint keeps the luminance: {luma}"
        );
    }
    // And in a picture: a white light on black, its halo warm and its core white.
    let mut scene = furnace(None);
    scene.environment = Environment {
        kind: EnvKind::Flat,
        floor: 0.0,
        horizon: 0.0,
        zenith: 0.0,
        strength: 0.0,
        ..Environment::default()
    };
    scene.render.width = 48;
    scene.render.height = 48;
    scene.camera = Camera {
        position: Vec3::new(0.0, -2000.0, 0.0),
        target: Vec3::ZERO,
        focal_mm: 200.0,
        fstop: 8.0,
        focus_dist: 2000.0,
        lens: Some(lens_with([
            filter(FILTER_DIFFUSION_GOLD, 2.0),
            FilterParams::default(),
            FilterParams::default(),
        ])),
        ..Camera::default()
    };
    scene.lights.push(Light {
        kind: LightKind::Disk,
        position: Vec3::ZERO,
        direction: Vec3::new(0.0, -1.0, 0.0),
        up: Vec3::new(0.0, 0.0, 1.0),
        size_x: 60.0,
        size_y: 60.0,
        color: crate::color::Rgb::WHITE,
        power: 2.0,
        spread_deg: 180.0,
        angle_deg: 0.0,
        flags: LIGHT_FLAG_CAMERA,
    });
    let mut film = Film::new(48, 48);
    for s in 0..256 {
        render_tile(
            &scene,
            TileRect {
                x: 0,
                y: 0,
                w: 48,
                h: 48,
            },
            s,
            &mut film,
        );
    }
    let rgb = film.resolve();
    let (mut core, mut halo) = ([0.0f64; 3], [0.0f64; 3]);
    for y in 0..48 {
        for x in 0..48 {
            let r = ((x as f64 - 23.5).powi(2) + (y as f64 - 23.5).powi(2)).sqrt();
            let p = &rgb[(y * 48 + x) * 3..][..3];
            let into = if r < 3.0 {
                &mut core
            } else if r > 8.0 {
                &mut halo
            } else {
                continue;
            };
            for c in 0..3 {
                into[c] += f64::from(p[c]);
            }
        }
    }
    assert!(halo[0] > 1.1 * halo[2], "the halo is warm: {halo:?}");
    assert!(core[0] < 1.05 * core[2], "the core stays white: {core:?}");
}

#[test]
fn a_stack_of_three_filters_of_grade_zero_renders_as_no_filter_bit_for_bit() {
    let base = crate::example::o1_scene();
    let mut zeros = base.clone();
    let mut params = base.camera.lens.as_ref().unwrap().params().clone();
    params.filters = [
        filter(FILTER_DIFFUSION_BLACK, 0.0),
        FilterParams {
            kind: FILTER_STAR,
            points: 8,
            angle_deg: 30.0,
            ..FilterParams::default()
        },
        FilterParams {
            kind: FILTER_STREAK,
            tint: [0.2, 0.4, 1.0],
            ..FilterParams::default()
        },
    ];
    zeros.camera.lens = Some(Lens::new(params).unwrap());
    assert!(zeros.camera.lens.as_ref().unwrap().filters().is_empty());
    let (w, h) = (base.render.width, base.render.height);
    let tile = TileRect { x: 0, y: 0, w, h };
    let (mut a, mut b) = (Film::new(w, h), Film::new(w, h));
    for s in 0..2 {
        render_tile(&base, tile, s, &mut a);
        render_tile(&zeros, tile, s, &mut b);
    }
    assert_eq!(a, b);
}

#[test]
fn filters_change_the_image_and_keep_their_bits_on_every_simd_path() {
    let scene = crate::example::o3a_scene();
    let mut plain = scene.clone();
    let mut params = plain.camera.lens.as_ref().unwrap().params().clone();
    params.filters = [FilterParams::default(); 3];
    plain.camera.lens = Some(Lens::new(params).unwrap());
    let (w, h) = (64, 48);
    let (mut scene, mut plain) = (scene, plain);
    for s in [&mut scene, &mut plain] {
        s.render.width = w;
        s.render.height = h;
    }
    let tile = TileRect { x: 0, y: 0, w, h };
    let mut a = Film::new(w, h);
    let mut b = Film::new(w, h);
    for s in 0..2 {
        render_tile(&scene, tile, s, &mut a);
        render_tile(&plain, tile, s, &mut b);
    }
    assert_ne!(a.resolve(), b.resolve());
    for isa in crate::simd::Isa::available() {
        let mut c = Film::new(w, h);
        for s in 0..2 {
            render_tile_with(&scene, tile, s, &mut c, isa);
        }
        assert_eq!(a, c, "{isa:?}");
    }
}

#[test]
fn the_filters_round_trip_through_the_lens_section_and_an_o1_lens_writes_no_filters() {
    let scene = crate::example::o3a_scene();
    let back = Scene::from_rsb(&scene.to_rsb()).unwrap();
    assert_eq!(back.camera.lens, scene.camera.lens);
    // An O1 lens (no filters) writes the O1 section, byte for byte.
    let o1 = crate::example::o1_scene();
    let bytes = o1.to_rsb();
    assert_eq!(Scene::from_rsb(&bytes).unwrap().camera.lens, o1.camera.lens);
    assert_eq!(
        bytes,
        include_bytes!("../../../../../tests/fixtures/o1.rsb")
    );
}

#[test]
fn out_of_range_filters_are_refused() {
    for f in [
        FilterParams {
            kind: 9,
            grade: 1.0,
            ..FilterParams::default()
        },
        filter(FILTER_SOFT, 2.5),
        filter(FILTER_SOFT, -0.1),
        FilterParams {
            kind: FILTER_STAR,
            grade: 1.0,
            points: 5,
            ..FilterParams::default()
        },
        FilterParams {
            kind: FILTER_DIFFUSION_GOLD,
            grade: 1.0,
            tint: [-1.0, 1.0, 1.0],
            ..FilterParams::default()
        },
    ] {
        assert!(
            Lens::new(LensParams {
                filters: [f, FilterParams::default(), FilterParams::default()],
                ..LensParams::default()
            })
            .is_err(),
            "{f:?}"
        );
    }
}

#[test]
fn the_glimmer_sparkles_hash_the_same_on_every_platform() {
    // The cloud of sparkles is fixed: its hash is pinned.
    assert_eq!(
        [
            super::filters::cell_hash(0, 0),
            super::filters::cell_hash(3, 2),
            super::filters::cell_hash(5, 5)
        ],
        [0xdf7a_aac7, 0xae2b_81d2, 0x42ed_0265]
    );
}

/// One camera-visible disk light on black, seen through `filter` (O3a: the connections).
fn light_on_black(filter: FilterParams, size: f32) -> Scene {
    let mut scene = furnace(None);
    scene.environment = Environment {
        kind: EnvKind::Flat,
        floor: 0.0,
        horizon: 0.0,
        zenith: 0.0,
        strength: 0.0,
        ..Environment::default()
    };
    scene.render.width = 32;
    scene.render.height = 32;
    scene.camera = Camera {
        position: Vec3::new(0.0, -2000.0, 0.0),
        target: Vec3::ZERO,
        focal_mm: 50.0,
        fstop: 8.0,
        focus_dist: 2000.0,
        lens: Some(lens_with([
            filter,
            FilterParams::default(),
            FilterParams::default(),
        ])),
        ..Camera::default()
    };
    scene.lights.push(Light {
        kind: LightKind::Disk,
        position: Vec3::new(120.0, 0.0, 60.0),
        direction: Vec3::new(0.0, -1.0, 0.0),
        up: Vec3::new(0.0, 0.0, 1.0),
        size_x: size,
        size_y: size,
        color: crate::color::Rgb::WHITE,
        power: 1.0,
        spread_deg: 180.0,
        angle_deg: 0.0,
        flags: LIGHT_FLAG_CAMERA,
    });
    scene
}

/// The film of `scene` at `samples` (from sample `first`), with or without the connections.
fn rendered(scene: &Scene, samples: u32, connect: bool) -> Vec<f32> {
    let mut scene = scene.clone();
    let lens = scene
        .camera
        .lens
        .take()
        .map(|l| l.with_connections(connect));
    scene.camera.lens = lens;
    let (w, h) = (scene.render.width, scene.render.height);
    let mut film = Film::new(w, h);
    for s in 0..samples {
        render_tile(&scene, TileRect { x: 0, y: 0, w, h }, s, &mut film);
    }
    film.resolve()
}

#[test]
fn the_connections_to_the_lights_keep_the_image() {
    // Every kind's scattered light around a light (one large enough for the scattering alone to
    // converge at 1024 samples), away from the middle of its own image: the same with the
    // connections at 128 samples.
    for (kind, points) in [
        (FILTER_STAR, 6),
        (FILTER_STREAK, 0),
        (FILTER_GLIMMER, 0),
        (FILTER_DIFFUSION_WHITE, 0),
        (FILTER_NET, 0),
    ] {
        let scene = light_on_black(
            FilterParams {
                kind,
                grade: 2.0,
                points,
                ..FilterParams::default()
            },
            250.0,
        );
        let plain = rendered(&scene, 1024, false);
        let mis = rendered(&scene, 128, true);
        let halo = |img: &[f32]| -> f64 {
            // Away from the light's own image (around pixel (19, 14)).
            img.chunks_exact(3)
                .enumerate()
                .filter(|(i, _)| {
                    let (x, y) = ((i % 32) as f64, (i / 32) as f64);
                    (x - 19.0).hypot(y - 14.0) > 3.0
                })
                .map(|(_, p)| f64::from(p[1]))
                .sum()
        };
        let (a, b) = (halo(&plain), halo(&mis));
        assert!(
            a > 0.0 && (a - b).abs() < 0.04 * a,
            "kind {kind}: {a} without the connections, {b} with them"
        );
    }
}

#[test]
fn the_scattering_and_the_connection_add_up_to_the_scattering_alone_on_every_lobe() {
    // A light that fills a disc of the deflection plane: what the scattering alone brings of it
    // (the share of the PSF inside) against the two estimators weighted (the scattering times its
    // weight, plus the connection's), with many numbers and no rendering.
    let cases = [
        (FILTER_STAR, 6, (0.005, 0.0005), 0.003, false),
        // Around the star's own centre, a light that is only the right half of the disc: every
        // line crosses the disc, and only some of them reach the light.
        (FILTER_STAR, 6, (0.0008, 0.0003), 0.004, true),
        (FILTER_STREAK, 0, (-0.03, 0.0005), 0.006, false),
        (FILTER_NET, 0, (0.0, 0.006), 0.003, false),
        (FILTER_DIFFUSION_WHITE, 0, (0.012, -0.006), 0.01, false),
        (FILTER_SOFT, 0, (0.003, 0.002), 0.002, false),
        (FILTER_GLIMMER, 0, (0.0, 0.0), 0.008, false),
        (FILTER_GLIMMER, 0, (0.004, 0.0), 0.006, true),
        // A small light out in the cloud: some of its sparkles reach it.
        (FILTER_GLIMMER, 0, (0.008, -0.005), 0.005, false),
        (FILTER_DIFFUSION_GOLD, 0, (0.03, 0.0), 0.02, false),
    ];
    for (kind, points, centre, radius, half) in cases {
        let f = Filter::new(&FilterParams {
            kind,
            grade: 2.0,
            points,
            ..FilterParams::default()
        })
        .unwrap()
        .unwrap();
        let disc = Disc { centre, radius };
        let inside = |d: (f32, f32)| {
            let (x, y) = (d.0 - centre.0, d.1 - centre.1);
            x * x + y * y <= radius * radius && (!half || x > 0.0)
        };
        let p_light = 0.5;
        // The glimmer's connections visit the sparkles near the light: fewer numbers.
        let n = if kind == FILTER_GLIMMER {
            400_000
        } else {
            1_000_000
        };
        // Red, the channel the tints change most, weighs each estimate.
        let (mut alone, mut weighted, mut connected) = (0.0f64, 0.0f64, 0.0f64);
        for i in 0..n {
            let mut u = numbers(i);
            u[0] *= f.s(); // always scatter
            let sc = f.scatter(u).unwrap();
            if inside(sc.delta) {
                let red = f64::from(sc.weight[0]);
                alone += red;
                weighted += red * f64::from(f.mis_weight(sc.lobe, sc.delta, &disc, p_light));
            }
            // The connection, which chooses this light with probability p_light.
            if let Some(c) = f.connect(&disc, p_light, numbers(n + i)) {
                if inside(c.delta) {
                    connected += f64::from(p_light * c.weight * c.colour[0]);
                }
            }
        }
        let alone = alone / f64::from(n);
        let both = (weighted + connected) / f64::from(n);
        eprintln!("kind {kind}: {alone:.5} alone, {both:.5} weighted");
        assert!(
            alone > 0.01,
            "kind {kind}: too little of the PSF in the light ({alone})"
        );
        assert!(
            (both - alone).abs() < 0.02 * alone,
            "kind {kind}: {both} weighted against {alone} alone"
        );
    }
}

#[test]
fn the_glimmer_is_a_cloud_of_fine_sparkles_not_a_ring() {
    let f = Filter::new(&filter(FILTER_GLIMMER, 1.0)).unwrap().unwrap();
    let (sparkles, shares) = f.sparkles();
    assert_eq!(sparkles.len(), GLIMMER_SPARKLES as usize);
    // Every sparkle its own direction.
    let mut seen = std::collections::BTreeSet::new();
    for &(x, y) in sparkles {
        seen.insert(((x * 1.0e6) as i64, (y * 1.0e6) as i64));
    }
    assert_eq!(seen.len(), sparkles.len());
    // Their distances are a 2-D Gaussian's (the cloud is densest near the light): a ring, as
    // the 6 × 6 cells of the first sheet were, has none of them near the centre.
    let sigma = GLIMMER_CLOUD_DEG.to_radians();
    let mut r: Vec<f32> = sparkles.iter().map(|&(x, y)| x.hypot(y) / sigma).collect();
    r.sort_by(f32::total_cmp);
    let median = r[r.len() / 2];
    assert!((median - 1.1774).abs() < 0.02, "median {median}σ");
    let near = r.iter().filter(|&&v| v < 0.5).count() as f32 / r.len() as f32;
    assert!((0.1..0.135).contains(&near), "{near} within σ/2");
    // Their brightness a speckle's: shares adding up to 1, a few sparkles much brighter.
    let total: f32 = shares.iter().sum();
    assert!((total - 1.0).abs() < 1.0e-4, "{total}");
    let mean = 1.0 / shares.len() as f32;
    let bright = shares.iter().filter(|&&w| w > 4.0 * mean).count();
    assert!(
        (20..200).contains(&bright),
        "{bright} sparkles above 4 times the mean"
    );
    // And the sparkle a scattered sample takes comes from its own numbers, not from where it
    // crosses the pupil (there is no pupil in it): over many samples, most of them.
    let mut taken = std::collections::BTreeSet::new();
    for i in 0..40_000 {
        let mut u = numbers(i);
        u[0] *= f.s();
        u[3] *= GLIMMER_SHARE; // the sparkles' lobe
        let sc = f.scatter(u).unwrap();
        let Lobe::Sparkle { j } = sc.lobe else {
            panic!("{:?}", sc.lobe);
        };
        let (cx, cy) = sparkles[j as usize];
        let spread = GLIMMER_SIGMA_DEG.to_radians() * 1.0001;
        assert!((sc.delta.0 - cx).abs() <= spread && (sc.delta.1 - cy).abs() <= spread);
        taken.insert(j);
    }
    assert!(taken.len() > 3000, "{} sparkles taken", taken.len());
}

#[test]
fn the_glimmer_takes_and_connects_its_sparkles_by_their_brightness() {
    let f = Filter::new(&filter(FILTER_GLIMMER, 1.0)).unwrap().unwrap();
    let (centres, shares) = f.sparkles();
    // The scattering takes a sparkle with its share: the brightest ones as often as that.
    let n = 400_000;
    let mut taken = vec![0u32; centres.len()];
    for i in 0..n {
        let mut u = numbers(i);
        u[0] *= f.s();
        u[3] *= GLIMMER_SHARE;
        if let Lobe::Sparkle { j } = f.scatter(u).unwrap().lobe {
            taken[j as usize] += 1;
        }
    }
    let mut order: Vec<usize> = (0..centres.len()).collect();
    order.sort_by(|&a, &b| shares[b].total_cmp(&shares[a]));
    for &j in &order[..10] {
        let expected = f64::from(shares[j]) * f64::from(n);
        assert!(
            (f64::from(taken[j]) / expected - 1.0).abs() < 0.15,
            "sparkle {j}: taken {} times, {expected} expected",
            taken[j]
        );
    }
    // The connection takes one of the sparkles near the light by its share times its box's part
    // inside the light's square.
    let disc = Disc {
        centre: (0.004, 0.002),
        radius: 0.003,
    };
    let spread = GLIMMER_SIGMA_DEG.to_radians();
    let part = |c: (f32, f32)| {
        let (r, (dx, dy)) = (disc.radius, disc.centre);
        let w = (c.0 + spread).min(dx + r) - (c.0 - spread).max(dx - r);
        let h = (c.1 + spread).min(dy + r) - (c.1 - spread).max(dy - r);
        if w > 0.0 && h > 0.0 {
            f64::from(w * h)
        } else {
            0.0
        }
    };
    let weights: Vec<f64> = (0..centres.len())
        .map(|j| f64::from(shares[j]) * part(centres[j]))
        .collect();
    let total: f64 = weights.iter().sum();
    let near = weights.iter().filter(|&&w| w > 0.0).count();
    assert!(near > 20, "{near} sparkles near the light");
    let mut picked = vec![0u32; centres.len()];
    let m = 200_000;
    for i in 0..m {
        let mut u = numbers(n + i);
        u[0] *= GLIMMER_SHARE; // the sparkles' lobe
        let c = f.connect(&disc, 0.5, u).unwrap();
        let Lobe::Sparkle { j } = c.lobe else {
            panic!("{:?}", c.lobe);
        };
        picked[j as usize] += 1;
    }
    let mut by_weight: Vec<usize> = (0..centres.len()).filter(|&j| weights[j] > 0.0).collect();
    by_weight.sort_by(|&a, &b| weights[b].total_cmp(&weights[a]));
    for &j in &by_weight[..5] {
        let expected = weights[j] / total * f64::from(m);
        assert!(
            (f64::from(picked[j]) / expected - 1.0).abs() < 0.15,
            "sparkle {j}: picked {} times, {expected} expected",
            picked[j]
        );
    }
}

#[test]
fn the_star_grows_longer_with_its_grade_and_no_wider() {
    let star = |grade: f32| {
        Filter::new(&FilterParams {
            kind: FILTER_STAR,
            grade,
            points: 6,
            ..FilterParams::default()
        })
        .unwrap()
        .unwrap()
    };
    let mut near_density = Vec::new();
    for (g, length) in GRADES.iter().zip(STAR_LENGTH_DEG) {
        let f = star(*g);
        let (mut longest, mut widest, mut near) = (0.0f32, 0.0f32, 0usize);
        let n = 100_000;
        for i in 0..n {
            let mut u = numbers(i);
            u[0] *= f.s();
            let sc = f.scatter(u).unwrap();
            let Lobe::Line { k, t } = sc.lobe else {
                panic!("a star scatters along its lines");
            };
            let a = std::f32::consts::TAU * k as f32 / 6.0;
            let across = -sc.delta.0 * a.sin() + sc.delta.1 * a.cos();
            longest = longest.max(t);
            widest = widest.max(across.abs());
            if (0.1f32.to_radians()..0.3f32.to_radians()).contains(&t) {
                near += 1;
            }
        }
        let length = length.to_radians();
        assert!(
            longest <= length * 1.0001 && longest > 0.8 * length,
            "grade {g}: rays to {longest}, length {length}"
        );
        assert!(
            widest <= LINE_WIDTH_DEG.to_radians() * 1.0001,
            "grade {g}: {widest}"
        );
        // The brightness of the rays near the light: s times the share of the line there.
        near_density.push(f64::from(f.s()) * near as f64 / f64::from(n));
    }
    for (g, d) in GRADES.iter().zip(&near_density) {
        assert!(
            (d / near_density[3] - 1.0).abs() < 0.15,
            "grade {g}: rays near the light {d} against {} at 1",
            near_density[3]
        );
    }
    assert!(STAR_LENGTH_DEG.windows(2).all(|w| w[1] > w[0]));
}

#[test]
fn the_net_gives_a_short_faint_cross_and_softens_with_most_of_its_light() {
    // Most of what the net scatters is its softening; its cross is shorter than the star's and
    // fainter per line near the light, at every grade.
    assert!(NET_AXIS_SHARE < 0.5);
    for (i, g) in GRADES.iter().enumerate() {
        let net = Filter::new(&filter(FILTER_NET, *g)).unwrap().unwrap();
        let star = Filter::new(&FilterParams {
            kind: FILTER_STAR,
            grade: *g,
            points: 6,
            ..FilterParams::default()
        })
        .unwrap()
        .unwrap();
        assert!(NET_LENGTH_DEG[i] < 0.5 * STAR_LENGTH_DEG[i]);
        let near = |f: &Filter, lines: f64| {
            let n = 100_000;
            let mut hits = 0;
            for j in 0..n {
                let mut u = numbers(j);
                u[0] *= f.s();
                if let Some(Scatter {
                    lobe: Lobe::Line { t, .. },
                    ..
                }) = f.scatter(u)
                {
                    if (0.1f32.to_radians()..0.3f32.to_radians()).contains(&t) {
                        hits += 1;
                    }
                }
            }
            f64::from(f.s()) * f64::from(hits) / f64::from(n) / lines
        };
        let (a, b) = (near(&net, 4.0), near(&star, 6.0));
        assert!(a < 0.85 * b, "grade {g}: a net line {a}, a star ray {b}");
    }
}
