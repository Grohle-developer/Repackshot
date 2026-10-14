//! Tests of the pixel filters and the edge samples (E11).

use super::*;
use crate::image::Film;
use crate::passes::{PassFilm, PASS_ALBEDO};
use crate::render::{
    camera_sample, render_tile_albedo, render_tile_albedo_edges, render_tile_edges,
    render_tile_prepared, tile_grid,
};
use crate::rng::Pcg32;
use crate::sampler::PixelSampler;

/// The Blackman–Harris window's CDF at `t` in `[0, 1]` (the whole window), in `f64`.
fn blackman_harris_cdf(t: f64) -> f64 {
    use std::f64::consts::PI;
    let (a0, a1, a2, a3) = (0.35875, 0.48829, 0.14128, 0.01168);
    (a0 * t - a1 * (2.0 * PI * t).sin() / (2.0 * PI) + a2 * (4.0 * PI * t).sin() / (4.0 * PI)
        - a3 * (6.0 * PI * t).sin() / (6.0 * PI))
        / a0
}

/// The CDF of the Blackman–Harris filter at `x` pixels from the centre.
fn blackman_harris_cdf_px(x: f64) -> f64 {
    let r = f64::from(BLACKMAN_HARRIS_RADIUS);
    blackman_harris_cdf(((x + r) / (2.0 * r)).clamp(0.0, 1.0))
}

/// The CDF of the tent `1 − |x|` at `x`.
fn tent_cdf(x: f64) -> f64 {
    let x = x.clamp(-1.0, 1.0);
    if x < 0.0 {
        0.5 * (1.0 + x) * (1.0 + x)
    } else {
        1.0 - 0.5 * (1.0 - x) * (1.0 - x)
    }
}

/// Inverts a CDF on `[lo, hi]` by bisection, in `f64`.
fn invert(cdf: impl Fn(f64) -> f64, u: f64, lo: f64, hi: f64) -> f64 {
    let (mut a, mut b) = (lo, hi);
    for _ in 0..100 {
        let m = 0.5 * (a + b);
        if cdf(m) < u {
            a = m;
        } else {
            b = m;
        }
    }
    0.5 * (a + b)
}

#[test]
fn the_blackman_harris_table_is_the_inverse_of_the_window_s_cdf() {
    // The reference: each entry by bisection on the window's integral in f64, then rounded to f32.
    // `REPACK_PRINT_TABLES=1 cargo test -p rt-core blackman_harris_table -- --nocapture` prints it.
    let r = f64::from(BLACKMAN_HARRIS_RADIUS);
    let n = BLACKMAN_HARRIS_INV_CDF.len();
    let q = |s: f64| {
        if s < 0.5 {
            2.0 * s * s
        } else {
            1.0 - 2.0 * (1.0 - s) * (1.0 - s)
        }
    };
    let made: Vec<f32> = (0..n)
        .map(|i| {
            let u = q(i as f64 / (n - 1) as f64);
            invert(blackman_harris_cdf_px, u, -r, r) as f32
        })
        .collect();
    // The points of the table: q⁻¹ undoes q.
    for i in 0..n {
        let s = i as f32 / (n - 1) as f32;
        assert!(
            (table_point(q(f64::from(s)) as f32) - s).abs() < 1e-6,
            "{i}"
        );
    }
    if std::env::var_os("REPACK_PRINT_TABLES").is_some() {
        for row in made.chunks(8) {
            let row: Vec<String> = row.iter().map(|v| format!("{v:?}")).collect();
            println!("    {},", row.join(", "));
        }
    }
    for (i, (&table, &want)) in BLACKMAN_HARRIS_INV_CDF.iter().zip(&made).enumerate() {
        assert!((table - want).abs() <= 2e-7, "entry {i}: {table} vs {want}");
        // Symmetric about the centre, increasing, inside the filter.
        assert_eq!(table, -BLACKMAN_HARRIS_INV_CDF[n - 1 - i], "entry {i}");
        assert!(
            i == 0 || table > BLACKMAN_HARRIS_INV_CDF[i - 1],
            "entry {i}"
        );
    }
    assert_eq!(BLACKMAN_HARRIS_INV_CDF[0], -BLACKMAN_HARRIS_RADIUS);
}

#[test]
fn the_standard_filter_is_the_uniform_position_itself_and_none_is_the_centre() {
    let mut rng = Pcg32::seeded(7, 1);
    for _ in 0..10_000 {
        let u = rng.next_f32();
        assert_eq!(offset(FILTER_STANDARD, u).to_bits(), u.to_bits());
        // An unknown filter is the standard one.
        assert_eq!(offset(99, u).to_bits(), u.to_bits());
        assert_eq!(offset(FILTER_NONE, u), 0.5);
        let soft = offset(FILTER_TENT, u);
        assert!((-0.5..=1.5).contains(&soft), "{u} {soft}");
        let fine = offset(FILTER_BLACKMAN_HARRIS, u);
        assert!((-1.0..=2.0).contains(&fine), "{u} {fine}");
    }
    // The ends of the sampler's range.
    assert_eq!(offset(FILTER_TENT, 0.0), -0.5);
    assert_eq!(offset(FILTER_BLACKMAN_HARRIS, 0.0), -1.0);
    assert!(offset(FILTER_BLACKMAN_HARRIS, 1.0 - f32::EPSILON) < 2.0);
}

#[test]
fn the_table_is_interpolated_linearly_and_the_offsets_have_the_filters_spread() {
    // Between two points of the table the offset is on the straight line between them.
    let q = |s: f32| {
        if s < 0.5 {
            2.0 * s * s
        } else {
            1.0 - 2.0 * (1.0 - s) * (1.0 - s)
        }
    };
    for i in [0usize, 1, 37, 127, 200, 254] {
        let (a, b) = (BLACKMAN_HARRIS_INV_CDF[i], BLACKMAN_HARRIS_INV_CDF[i + 1]);
        let u = q((i as f32 + 0.5) / 255.0);
        let x = offset(FILTER_BLACKMAN_HARRIS, u) - 0.5;
        let mid = a + (b - a) * 0.5;
        assert!((x - mid).abs() < 0.02 * (b - a), "{i}: {x} vs {a}..{b}");
    }
    // The variance of the offsets is the filter's (∫ x² w(x) dx / ∫ w), within 0.3 % over 10⁶.
    let variance = |cdf: &dyn Fn(f64) -> f64, r: f64| {
        let n = 20_000;
        let mut m2 = 0.0;
        for k in 0..n {
            let (x0, x1) = (
                -r + 2.0 * r * k as f64 / n as f64,
                -r + 2.0 * r * (k + 1) as f64 / n as f64,
            );
            let xm = 0.5 * (x0 + x1);
            m2 += xm * xm * (cdf(x1) - cdf(x0));
        }
        m2
    };
    let sampled = |filter: u32| {
        let mut rng = Pcg32::seeded(5, 9);
        let n = 1_000_000;
        let mut m2 = 0.0f64;
        for _ in 0..n {
            let x = f64::from(offset(filter, rng.next_f32())) - 0.5;
            m2 += x * x;
        }
        m2 / f64::from(n)
    };
    let fine = (
        sampled(FILTER_BLACKMAN_HARRIS),
        variance(&blackman_harris_cdf_px, 1.5),
    );
    let soft = (sampled(FILTER_TENT), variance(&tent_cdf, 1.0));
    eprintln!("variance: fine {fine:?}, soft {soft:?}");
    assert!((fine.0 / fine.1 - 1.0).abs() < 0.003, "{fine:?}");
    assert!((soft.0 / soft.1 - 1.0).abs() < 0.003, "{soft:?}");
    // The tent is 1/6, a box would be 1/12.
    assert!((soft.1 - 1.0 / 6.0).abs() < 1e-4);
}

#[test]
fn a_pixel_is_an_edge_beside_another_part_or_material_or_a_depth_more_than_2_percent_away() {
    let at = |part: u32, material: u32, depth: f32| Exact {
        part_id: part,
        material_id: material,
        depth,
        ..Exact::BACKGROUND
    };
    let c = at(3, 2, 100.0);
    assert!(!differs(&c, &c));
    assert!(differs(&c, &at(4, 2, 100.0)));
    assert!(differs(&c, &at(3, 1, 100.0)));
    assert!(!differs(&c, &at(3, 2, 101.9)));
    assert!(differs(&c, &at(3, 2, 102.1)));
    assert!(differs(&c, &at(3, 2, 97.9)));
    // The background against itself is never an edge; against anything else it is.
    assert!(!differs(&Exact::BACKGROUND, &Exact::BACKGROUND));
    assert!(differs(&Exact::BACKGROUND, &c));
    assert!(differs(&c, &Exact::BACKGROUND));
}

#[test]
fn a_filter_wider_than_the_pixel_keeps_the_screen_position_inside_the_image() {
    let mut scene = example_with(FILTER_TENT, 1);
    scene.camera.fstop = 0.0;
    let (w, h) = (scene.render.width, scene.render.height);
    let mut outside = 0;
    for (x, y) in [(0, 0), (w - 1, h - 1), (0, h - 1)] {
        for s in 0..256 {
            let sampler = PixelSampler::new(0, x, y, s);
            let (_, (u, v)) = camera_sample(&scene, &sampler, x, y);
            assert!(
                (0.0..=1.0).contains(&u) && (0.0..=1.0).contains(&v),
                "({x}, {y}) {s}: {u} {v}"
            );
            let (du, dv) = sampler.get2(crate::sampler::DIM_CAMERA);
            let (ox, oy) = (offset(FILTER_TENT, du), offset(FILTER_TENT, dv));
            if !(0.0..=1.0).contains(&((x as f32 + ox) / w as f32))
                || !(0.0..=1.0).contains(&((y as f32 + oy) / h as f32))
            {
                outside += 1;
            }
        }
    }
    // Some samples did pass beyond the border (the case being checked).
    assert!(outside > 0);
}

/// Pearson's χ² of `samples` offsets of `filter` (made from uniform numbers of a fixed seed)
/// against `cdf` over the bins between `edges`.
fn chi_square(filter: u32, samples: u32, edges: &[f64], cdf: impl Fn(f64) -> f64) -> f64 {
    let mut counts = vec![0u32; edges.len() - 1];
    let mut rng = Pcg32::seeded(0x0e11, 3);
    for _ in 0..samples {
        let x = f64::from(offset(filter, rng.next_f32())) - 0.5;
        let bin = edges.partition_point(|&e| e <= x).clamp(1, edges.len() - 1) - 1;
        counts[bin] += 1;
    }
    counts
        .iter()
        .zip(edges.windows(2))
        .map(|(&observed, e)| {
            let expected = f64::from(samples) * (cdf(e[1]) - cdf(e[0]));
            let d = f64::from(observed) - expected;
            d * d / expected
        })
        .sum()
}

#[test]
fn soft_and_fine_offsets_follow_the_filter_s_cdf() {
    // χ² over 10⁶ offsets in bins a tenth of a pixel wide over the whole filter: 30 for
    // Blackman–Harris (29 degrees of freedom: at a significance of 0.001 the bound is 58.30), 20
    // for the tent (19: 43.82). Expected counts from the filter's own CDF in f64.
    let samples = 1_000_000;
    let r = f64::from(BLACKMAN_HARRIS_RADIUS);
    let bins = |lo: f64, hi: f64, n: usize| -> Vec<f64> {
        (0..=n)
            .map(|k| lo + (hi - lo) * k as f64 / n as f64)
            .collect()
    };
    let fine_edges = bins(-r, r, 30);
    let tent_edges = bins(-1.0, 1.0, 20);
    let fine = chi_square(
        FILTER_BLACKMAN_HARRIS,
        samples,
        &fine_edges,
        blackman_harris_cdf_px,
    );
    let soft = chi_square(FILTER_TENT, samples, &tent_edges, tent_cdf);
    eprintln!("chi-square: fine {fine:.1} (30 bins), soft {soft:.1} (20 bins)");
    assert!(fine < 58.30, "fine {fine}");
    assert!(soft < 43.82, "soft {soft}");
    // And it tells a wrong filter apart: the tent against Blackman–Harris and back, the box.
    assert!(chi_square(FILTER_TENT, samples, &fine_edges, blackman_harris_cdf_px) > 1000.0);
    assert!(chi_square(FILTER_BLACKMAN_HARRIS, samples, &tent_edges, tent_cdf) > 1000.0);
    assert!(chi_square(FILTER_STANDARD, samples, &tent_edges, tent_cdf) > 1000.0);
}

/// The example scene through a pinhole, with a pixel filter and edge samples.
fn example_with(filter: u32, edges: u32) -> Scene {
    let mut scene = crate::example::scene();
    scene.render.pixel_filter = filter;
    scene.render.edge_supersample = edges;
    scene
}

#[test]
fn with_no_filter_every_sample_of_a_pixel_has_the_same_primary_ray() {
    let mut pinhole = example_with(FILTER_NONE, 1);
    pinhole.camera.fstop = 0.0;
    for (x, y) in [(0, 0), (101, 77), (511, 383)] {
        let first = camera_sample(&pinhole, &PixelSampler::new(0, x, y, 0), x, y);
        for s in 1..64 {
            let (ray, screen) = camera_sample(&pinhole, &PixelSampler::new(0, x, y, s), x, y);
            assert_eq!(
                (ray.origin, ray.dir, screen),
                (first.0.origin, first.0.dir, first.1)
            );
        }
        // Through a lens the point on the image is still the same.
        let lens = example_with(FILTER_NONE, 1);
        let at = |s| camera_sample(&lens, &PixelSampler::new(0, x, y, s), x, y).1;
        assert!((1..64).all(|s| at(s) == at(0)));
        // The standard filter moves it.
        let mut standard = pinhole.clone();
        standard.render.pixel_filter = FILTER_STANDARD;
        let at = |s| camera_sample(&standard, &PixelSampler::new(0, x, y, s), x, y).1;
        assert!((1..64).all(|s| at(s) != at(0)));
    }
}

#[test]
fn the_edges_are_the_pixels_beside_another_part_and_do_not_depend_on_the_tile_cut() {
    let scene = example_with(FILTER_BLACKMAN_HARRIS, 2);
    let prepared = Prepared::new(&scene);
    let (w, h) = (scene.render.width, scene.render.height);
    let whole = EdgeMask::of(
        &scene,
        &prepared,
        TileRect { x: 0, y: 0, w, h },
        Isa::detect(),
    );
    let count = whole.edges();

    // Some pixels and not most of them: silhouettes, contacts, the parts' borders.
    assert!(count > 500 && count < (w * h / 8) as usize, "{count} edges");
    for tile in tile_grid(w, h, 23) {
        let mask = EdgeMask::of(&scene, &prepared, tile, Isa::detect());
        for y in tile.y..tile.y + tile.h {
            for x in tile.x..tile.x + tile.w {
                assert_eq!(mask.factor_at(x, y), whole.factor_at(x, y), "({x}, {y})");
            }
        }
    }
    // Along the row through the middle of the image every edge is beside a change of part or
    // material, or of depth.
    let tracer = BvhTracer {
        geometry: &scene.geometry,
        isa: Isa::detect(),
    };
    let exact = |x: u32, y: u32| {
        let ray = centre_ray(&scene, x, y);
        Exact::of(&scene, &ray, first_hit(&scene, &prepared, &tracer, &ray))
    };
    let y = h / 2;
    for x in 1..w - 1 {
        let around = [
            exact(x - 1, y - 1),
            exact(x, y - 1),
            exact(x + 1, y - 1),
            exact(x - 1, y),
            exact(x + 1, y),
            exact(x - 1, y + 1),
            exact(x, y + 1),
            exact(x + 1, y + 1),
        ];
        let c = exact(x, y);
        let want = around.iter().any(|n| differs(&c, n));
        assert_eq!(whole.factor_at(x, y) == 2, want, "({x}, {y})");
    }
    // Without edge samples nothing is traced and every pixel takes one sample.
    let plain = example_with(FILTER_BLACKMAN_HARRIS, 1);
    let none = EdgeMask::of(
        &plain,
        &Prepared::new(&plain),
        TileRect { x: 0, y: 0, w, h },
        Isa::detect(),
    );
    assert_eq!(none.edges(), 0);
    assert_eq!(none.factor_at(w / 2, h / 2), 1);
}

#[test]
fn an_edge_pixel_takes_k_samples_of_its_own_sequence_and_the_others_one() {
    // Sample index s of an edge pixel at ×k is the mean of the samples s·k … s·k + k − 1 of the
    // plain renderer; every other pixel is sample s itself.
    for k in [2u32, 4] {
        let scene = example_with(FILTER_BLACKMAN_HARRIS, k);
        let prepared = Prepared::new(&scene);
        let isa = Isa::detect();
        // The tile of 40 pixels with the most edges (a part's border runs through it).
        let (w, h) = (scene.render.width, scene.render.height);
        let mask = tile_grid(w, h, 40)
            .into_iter()
            .map(|t| EdgeMask::of(&scene, &prepared, t, isa))
            .max_by_key(EdgeMask::edges)
            .expect("tiles");
        let tile = mask.tile();
        assert!(
            mask.edges() > 40 && mask.edges() < 1600,
            "{} edges",
            mask.edges()
        );
        for s in [0u32, 3] {
            let mut film = Film::region(tile.x, tile.y, tile.w, tile.h);
            render_tile_edges(&scene, &prepared, None, &mask, s, &mut film, isa);
            let got = film.resolve();
            let one = |index: u32| {
                let mut f = Film::region(tile.x, tile.y, tile.w, tile.h);
                render_tile_prepared(&scene, &prepared, tile, index, &mut f, isa);
                f.resolve()
            };
            let plain = one(s);
            let subs: Vec<Vec<f32>> = (0..k).map(|j| one(s * k + j)).collect();
            for (i, px) in got.chunks_exact(3).enumerate() {
                let (x, y) = (tile.x + i as u32 % tile.w, tile.y + i as u32 / tile.w);
                let want: Vec<f32> = if mask.factor_at(x, y) == k {
                    let inv = 1.0 / k as f32;
                    (0..3)
                        .map(|c| {
                            let mut sum = 0.0f32;
                            for sub in &subs {
                                sum += sub[i * 3 + c];
                            }
                            sum * inv
                        })
                        .collect()
                } else {
                    plain[i * 3..i * 3 + 3].to_vec()
                };
                assert_eq!(px, &want[..], "×{k} sample {s} ({x}, {y})");
            }
            // The albedo of the guides: the mean of the same samples' albedo.
            let mut albedo = PassFilm::region(tile.x, tile.y, tile.w, tile.h, PASS_ALBEDO);
            render_tile_albedo_edges(&scene, &prepared, &mask, s, &mut albedo, isa);
            let one_albedo = |index: u32| {
                let mut f = PassFilm::region(tile.x, tile.y, tile.w, tile.h, PASS_ALBEDO);
                render_tile_albedo(&scene, &prepared, tile, index, &mut f, isa);
                f.albedo
            };
            let plain = one_albedo(s);
            let subs: Vec<Vec<f32>> = (0..k).map(|j| one_albedo(s * k + j)).collect();
            for (i, px) in albedo.albedo.chunks_exact(3).enumerate() {
                let (x, y) = (tile.x + i as u32 % tile.w, tile.y + i as u32 / tile.w);
                let want: Vec<f32> = if mask.factor_at(x, y) == k {
                    (0..3)
                        .map(|c| {
                            let mut sum = 0.0f32;
                            for sub in &subs {
                                sum += sub[i * 3 + c];
                            }
                            sum * (1.0 / k as f32)
                        })
                        .collect()
                } else {
                    plain[i * 3..i * 3 + 3].to_vec()
                };
                assert_eq!(px, &want[..], "albedo ×{k} sample {s} ({x}, {y})");
            }
        }
    }
}
