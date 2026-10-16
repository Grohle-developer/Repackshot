use super::*;
use rt_core::fmath;
use rt_core::rng::Pcg32;

/// A synthetic film: `width × height`, `samples` samples per pixel; the left part (id 1) a flat
/// grey of `left`, the right part (id 2) of `right`, noisy with the given relative spread, and
/// the top row background (id 0). Returns the owned buffers of a [`DenoiseInput`].
struct Synthetic {
    width: u32,
    height: u32,
    samples: u32,
    sums: Vec<f32>,
    lum2: Vec<f32>,
    albedo: Vec<f32>,
    normal: Vec<f32>,
    depth: Vec<f32>,
    part_id: Vec<u32>,
    material_id: Vec<u32>,
}

impl Synthetic {
    fn new(width: u32, height: u32, samples: u32, left: f32, right: f32, spread: f32) -> Synthetic {
        let n = (width * height) as usize;
        let mut s = Synthetic {
            width,
            height,
            samples,
            sums: vec![0.0; n * 4],
            lum2: vec![0.0; n],
            albedo: vec![0.0; n * 3],
            normal: vec![0.0; n * 3],
            depth: vec![f32::INFINITY; n],
            part_id: vec![0; n],
            material_id: vec![0; n],
        };
        let mut rng = Pcg32::seeded(7, 11);
        for y in 0..height {
            for x in 0..width {
                let p = (y * width + x) as usize;
                if y == 0 {
                    // Background: a gradient, never touched.
                    for k in 0..3 {
                        s.sums[p * 4 + k] = (x as f32 * 0.01 + k as f32) * samples as f32;
                    }
                    s.sums[p * 4 + 3] = samples as f32;
                    continue;
                }
                let left_side = x < width / 2;
                let id = if left_side { 1 } else { 2 };
                let base = if left_side { left } else { right };
                s.part_id[p] = id;
                s.material_id[p] = id;
                s.albedo[p * 3..p * 3 + 3].copy_from_slice(&[0.8, 0.8, 0.8]);
                s.normal[p * 3..p * 3 + 3].copy_from_slice(&[0.0, 0.0, 1.0]);
                s.depth[p] = 500.0;
                for _ in 0..samples {
                    // Exponential-ish noise around `base` (positive, like radiance).
                    let u = rng.next_f32().max(1.0e-6);
                    let v = base * (1.0 + spread * (-fmath::ln(u) - 1.0)).max(0.0);
                    for k in 0..3 {
                        s.sums[p * 4 + k] += v;
                    }
                    s.sums[p * 4 + 3] += 1.0;
                    let l = luminance(v, v, v);
                    s.lum2[p] += l * l;
                }
            }
        }
        s
    }

    fn input(&self) -> DenoiseInput<'_> {
        self.band(0, self.height)
    }

    fn band(&self, y0: u32, y1: u32) -> DenoiseInput<'_> {
        let w = self.width as usize;
        let (a, b) = (y0 as usize * w, y1 as usize * w);
        DenoiseInput {
            width: self.width,
            height: self.height,
            origin_y: y0,
            rows: y1 - y0,
            samples: self.samples,
            counts: &[],
            sums: &self.sums[a * 4..b * 4],
            lum2: &self.lum2[a..b],
            albedo: &self.albedo[a * 3..b * 3],
            normal: &self.normal[a * 3..b * 3],
            depth: &self.depth[a..b],
            part_id: &self.part_id[a..b],
            material_id: &self.material_id[a..b],
        }
    }
}

/// Mean squared error of the means of `sums` (`samples` each) against `truth`, over the pixels
/// of part `id`.
fn mse(s: &Synthetic, sums: &[f32], id: u32, truth: f32) -> f64 {
    let inv = 1.0 / s.samples as f32;
    let mut e = 0.0f64;
    let mut count = 0;
    for p in 0..s.part_id.len() {
        if s.part_id[p] == id {
            let d = f64::from(sums[p * 4 + 1] * inv - truth);
            e += d * d;
            count += 1;
        }
    }
    e / f64::from(count)
}

#[test]
fn it_lowers_the_error_of_a_noisy_flat_surface() {
    for samples in [1u32, 2, 4, 16] {
        let s = Synthetic::new(48, 40, samples, 0.5, 2.0, 1.0);
        let out = denoise(&s.input()).expect("denoise");
        for (id, truth) in [(1u32, 0.5f32), (2, 2.0)] {
            let (before, after) = (mse(&s, &s.sums, id, truth), mse(&s, &out, id, truth));
            eprintln!("{samples} spp, part {id}: mse {before:.5} -> {after:.5}");
            assert!(
                after < 0.25 * before,
                "{samples} spp part {id}: {before} -> {after}"
            );
        }
    }
}

#[test]
fn it_never_mixes_two_parts_and_leaves_the_background_alone() {
    // The left part is black: nothing of the bright right part may reach it, and the right part's
    // result does not depend on the left's values at all.
    let s = Synthetic::new(40, 32, 8, 0.0, 3.0, 1.5);
    let out = denoise(&s.input()).expect("denoise");
    for p in 0..s.part_id.len() {
        match s.part_id[p] {
            0 => assert_eq!(
                out[p * 4..p * 4 + 4],
                s.sums[p * 4..p * 4 + 4],
                "background {p}"
            ),
            1 => assert!(out[p * 4..p * 4 + 3].iter().all(|&v| v == 0.0), "left {p}"),
            _ => {}
        }
        // Coverage is never changed.
        assert_eq!(out[p * 4 + 3], s.sums[p * 4 + 3]);
    }
    let mut brighter_left = Synthetic::new(40, 32, 8, 0.0, 3.0, 1.5);
    for p in 0..brighter_left.part_id.len() {
        if brighter_left.part_id[p] == 1 {
            brighter_left.sums[p * 4] = 5.0;
            brighter_left.lum2[p] = 40.0;
        }
    }
    let other = denoise(&brighter_left.input()).expect("denoise");
    for p in 0..s.part_id.len() {
        if s.part_id[p] == 2 {
            assert_eq!(other[p * 4..p * 4 + 4], out[p * 4..p * 4 + 4], "right {p}");
        }
    }
    // Another material on the same part is another surface too.
    let mut two_materials = Synthetic::new(40, 32, 8, 3.0, 3.0, 1.5);
    for p in 0..two_materials.part_id.len() {
        if two_materials.part_id[p] != 0 {
            two_materials.part_id[p] = 1;
            if p % 40 < 20 {
                two_materials.sums[p * 4..p * 4 + 3].copy_from_slice(&[0.0; 3]);
                two_materials.lum2[p] = 0.0;
            }
        }
    }
    let mixed = denoise(&two_materials.input()).expect("denoise");
    for p in 0..two_materials.part_id.len() {
        if two_materials.part_id[p] == 1 && two_materials.material_id[p] == 1 {
            assert!(
                mixed[p * 4..p * 4 + 3].iter().all(|&v| v == 0.0),
                "material {p}"
            );
        }
    }
}

#[test]
fn a_band_of_rows_is_exactly_those_rows_of_the_whole_image() {
    let s = Synthetic::new(30, 200, 6, 0.7, 1.4, 1.0);
    let whole = denoise(&s.input()).expect("denoise");
    let w = 30usize;
    for (y0, y1) in [(0u32, 40u32), (40, 41), (100, 160), (150, 200), (0, 200)] {
        let lo = y0.saturating_sub(HALO);
        let hi = (y1 + HALO).min(200);
        let rows = denoise_rows(&s.band(lo, hi), y0, y1).expect("band");
        assert_eq!(
            rows[..],
            whole[y0 as usize * w * 4..y1 as usize * w * 4],
            "rows {y0}..{y1}"
        );
    }
    // A band without its halo is refused, not computed wrong.
    assert_eq!(
        denoise_rows(&s.band(90, 200), 100, 110),
        Err(DenoiseError::Rows)
    );
    assert_eq!(
        denoise_rows(&s.band(0, 120), 100, 110),
        Err(DenoiseError::Rows)
    );
}

#[test]
fn bad_shapes_are_refused() {
    let s = Synthetic::new(8, 8, 2, 1.0, 1.0, 0.5);
    let mut input = s.input();
    input.lum2 = &s.lum2[..10];
    assert_eq!(denoise(&input), Err(DenoiseError::Shape("lum2")));
    let mut input = s.input();
    input.rows = 9;
    assert_eq!(denoise(&input), Err(DenoiseError::Shape("the band")));
}

#[test]
fn each_pixel_s_own_count_weighs_its_variance_and_equal_counts_change_nothing() {
    // E10: the sums are those of `samples` samples; `counts` says how many each pixel really has.
    let s = Synthetic::new(40, 120, 16, 0.5, 2.0, 1.0);
    let plain = denoise(&s.input()).expect("denoise");
    let n = s.part_id.len();
    let equal = vec![16.0f32; n];
    let same = denoise(&s.input().with_counts(&equal).expect("counts")).expect("denoise");
    assert_eq!(same, plain, "counts equal to the samples are no counts");
    assert_eq!(
        s.input().with_counts(&equal[..n - 1]).err(),
        Some(DenoiseError::Shape("counts"))
    );
    // The right part with four times the samples: the variance of its means is a quarter, so the
    // filter stops sooner there and moves its pixels less; the left part is the same.
    let counts: Vec<f32> = (0..n)
        .map(|p| if s.part_id[p] == 2 { 64.0 } else { 16.0 })
        .collect();
    let weighed = denoise(&s.input().with_counts(&counts).expect("counts")).expect("denoise");
    let moved = |out: &[f32], id: u32| -> f64 {
        (0..n)
            .filter(|&p| s.part_id[p] == id)
            .map(|p| f64::from((out[p * 4 + 1] - s.sums[p * 4 + 1]).abs()))
            .sum()
    };
    assert!(
        moved(&weighed, 2) < 0.9 * moved(&plain, 2),
        "{} vs {}",
        moved(&weighed, 2),
        moved(&plain, 2)
    );
    for p in 0..n {
        if s.part_id[p] == 1 {
            assert_eq!(weighed[p * 4..p * 4 + 4], plain[p * 4..p * 4 + 4], "left {p}");
        }
    }
    // A band with its halo cuts the counts with the rest: the same rows as the whole image.
    let w = 40usize;
    let (y0, y1) = (80u32, 100u32);
    let band = s.band(y0.saturating_sub(HALO), (y1 + HALO).min(120));
    let lo = y0.saturating_sub(HALO) as usize * w;
    let hi = (y1 + HALO).min(120) as usize * w;
    let rows = denoise_rows(&band.with_counts(&counts[lo..hi]).expect("band"), y0, y1)
        .expect("rows");
    assert_eq!(
        rows[..],
        weighed[y0 as usize * w * 4..y1 as usize * w * 4],
        "rows {y0}..{y1}"
    );
}

#[test]
fn a_clean_image_stays_clean() {
    // With no noise (every sample the same) the variance is zero and the filter keeps each
    // pixel's own value: edges and gradients inside a part survive.
    let mut s = Synthetic::new(32, 24, 16, 1.0, 1.0, 0.0);
    for y in 1..24u32 {
        for x in 0..32u32 {
            let p = (y * 32 + x) as usize;
            let v = 0.1 + 0.05 * x as f32;
            for k in 0..3 {
                s.sums[p * 4 + k] = v * 16.0;
            }
            let l = luminance(v, v, v);
            s.lum2[p] = l * l * 16.0;
        }
    }
    let out = denoise(&s.input()).expect("denoise");
    for p in 32..s.part_id.len() {
        let (a, b) = (out[p * 4 + 1] / 16.0, s.sums[p * 4 + 1] / 16.0);
        assert!((a - b).abs() <= 1.0e-3 * b, "{p}: {a} vs {b}");
    }
}

#[test]
fn a_film_and_its_passes_make_the_input_and_bands_of_it_need_no_copies() {
    let mut film = Film::new(4, 3);
    film.splat_alpha(1, 1, rt_core::color::Rgb::new(1.0, 2.0, 3.0), 0.5);
    let sums = rgba_sums(&film);
    assert_eq!(sums[(4 + 1) * 4..(4 + 1) * 4 + 4], [1.0, 2.0, 3.0, 0.5]);
    let passes = Passes::new(4, 3, GUIDE_PASSES);
    let whole = DenoiseInput::whole(1, &sums, &film.lum2, &passes).expect("input");
    assert_eq!((whole.width, whole.height, whole.rows), (4, 3, 3));
    let band = whole.with_halo(1, 2);
    assert_eq!((band.origin_y, band.rows), (0, 3));
    // Without the guides there is nothing to denoise with.
    let few = Passes::new(4, 3, PASS_ALBEDO);
    assert_eq!(
        DenoiseInput::whole(1, &sums, &film.lum2, &few).err(),
        Some(DenoiseError::Shape("the passes"))
    );
    // A tall image: the band of a few rows holds them and their halo only.
    let s = Synthetic::new(6, 400, 4, 1.0, 1.0, 0.5);
    let b = s.input().with_halo(200, 210);
    assert_eq!((b.origin_y, b.rows), (200 - HALO, 10 + 2 * HALO));
    assert_eq!(b.sums.len(), b.rows as usize * 6 * 4);
    assert_eq!(
        denoise_rows(&b, 200, 210).expect("band"),
        denoise(&s.input()).expect("whole")[200 * 6 * 4..210 * 6 * 4]
    );
}

/// FNV-1a over the little-endian bytes of every float.
fn fnv1a(values: &[f32]) -> u32 {
    values
        .iter()
        .flat_map(|v| v.to_le_bytes())
        .fold(0x811c_9dc5u32, |hash, byte| {
            (hash ^ u32::from(byte)).wrapping_mul(0x0100_0193)
        })
}

/// The example at `samples` samples (32-pixel tiles, samples in order, as every host renders it)
/// with the guide passes: its film and passes.
pub(crate) fn example_with_guides(samples: u32) -> (Film, Passes) {
    use rt_core::integrator::Prepared;
    use rt_core::passes::PassFilm;
    use rt_core::render::{render_tile_albedo, render_tile_exact, render_tile_prepared, tile_grid};
    use rt_core::simd::Isa;
    let scene = rt_core::example::scene();
    let prepared = Prepared::new(&scene);
    let (w, h) = (scene.render.width, scene.render.height);
    let mut film = Film::new(w, h);
    let mut passes = Passes::new(w, h, GUIDE_PASSES);
    for tile in tile_grid(w, h, 32) {
        let mut pf = PassFilm::region(tile.x, tile.y, tile.w, tile.h, GUIDE_PASSES);
        render_tile_exact(&scene, &prepared, tile, &mut pf, Isa::detect());
        for sample in 0..samples {
            render_tile_prepared(&scene, &prepared, tile, sample, &mut film, Isa::detect());
            render_tile_albedo(&scene, &prepared, tile, sample, &mut pf, Isa::detect());
        }
        passes.copy_region(tile.x, tile.y, &pf.resolve());
    }
    (film, passes)
}

/// The denoised means (`sum × (1/n)` in `f32`, RGB) of RGBA sums of `samples` samples.
pub(crate) fn means(sums: &[f32], samples: u32) -> Vec<f32> {
    let inv = 1.0 / samples as f32;
    sums.chunks_exact(4)
        .flat_map(|p| [p[0] * inv, p[1] * inv, p[2] * inv])
        .collect()
}

#[test]
fn the_denoised_example_has_a_pinned_hash() {
    // The same bits on every platform: `tools/wasm-parity.mjs --denoise` gets them from the real
    // rt_wasm.wasm (`rt_denoise`, with the squared luminance summed by the page's own rule).
    let (film, passes) = example_with_guides(4);
    let sums = rgba_sums(&film);
    let input = DenoiseInput::whole(4, &sums, &film.lum2, &passes).expect("input");
    let out = denoise(&input).expect("denoise");
    let hash = fnv1a(&means(&out, 4));
    eprintln!("denoised example at 4 spp: {hash:#010x}");
    assert_eq!(hash, PINNED_DENOISED_EXAMPLE_4SPP);
    // Bands of any height give the same image.
    let h = film.height;
    let mut banded = Vec::new();
    for k in 0..5 {
        let (y0, y1) = (h * k / 5, h * (k + 1) / 5);
        banded.extend(denoise_rows(&input.with_halo(y0, y1), y0, y1).expect("band"));
    }
    assert_eq!(banded, out);
    // The image without denoise keeps its own pinned hash.
    assert_eq!(fnv1a(&film.resolve()), 0x75ba_4cb4);
}

/// Pinned hash of the denoised example image at 4 samples per pixel.
pub(crate) const PINNED_DENOISED_EXAMPLE_4SPP: u32 = 0x2a43_0f92;

// ------------------------------------------------------------------ the viewport's preset (U11)

#[test]
fn the_presets_halos_hold_the_filter_and_the_full_one_is_the_same_filter() {
    assert_eq!(Preset::FULL.halo(), HALO);
    assert_eq!(HALO, 72);
    assert_eq!(Preset::FULL.levels, LEVELS);
    const { assert!(Preset::VIEWPORT.levels < Preset::FULL.levels) };
    const { assert!(Preset::VIEWPORT.halo() < Preset::FULL.halo()) };
    // The default calls are the full filter.
    let s = Synthetic::new(30, 60, 2, 0.7, 1.4, 1.0);
    assert_eq!(
        denoise(&s.input()).expect("full"),
        denoise_with(&s.input(), Preset::FULL).expect("full")
    );
    assert_eq!(
        denoise_rows(&s.input(), 10, 20).expect("full"),
        denoise_rows_with(&s.input(), 10, 20, Preset::FULL).expect("full")
    );
    // Out of range fields are brought into it (a host cannot ask for more than the full filter).
    let wild = Preset {
        levels: 9,
        variance_radius: 0,
    };
    assert_eq!(
        wild.clamped(),
        Preset {
            levels: LEVELS,
            variance_radius: 1
        }
    );
}

#[test]
fn the_viewport_preset_is_deterministic_and_a_band_of_it_is_exactly_those_rows() {
    // Below four samples (the spatial variance) and above.
    for samples in [2u32, 6] {
        let s = Synthetic::new(30, 200, samples, 0.7, 1.4, 1.0);
        let p = Preset::VIEWPORT;
        let whole = denoise_with(&s.input(), p).expect("denoise");
        assert_eq!(whole, denoise_with(&s.input(), p).expect("again"));
        // Another filter than the full one.
        assert_ne!(whole, denoise(&s.input()).expect("full"));
        let w = 30usize;
        let halo = p.halo();
        for (y0, y1) in [(0u32, 40u32), (40, 41), (100, 160), (150, 200), (0, 200)] {
            let lo = y0.saturating_sub(halo);
            let hi = (y1 + halo).min(200);
            let rows = denoise_rows_with(&s.band(lo, hi), y0, y1, p).expect("band");
            assert_eq!(
                rows[..],
                whole[y0 as usize * w * 4..y1 as usize * w * 4],
                "{samples} spp, rows {y0}..{y1}"
            );
            // The input's own band of the rows is the same band.
            let b = s.input().with_halo_of(y0, y1, p);
            assert_eq!((b.origin_y, b.origin_y + b.rows), (lo, hi));
        }
        // A band without its halo is refused, not computed wrong; the full filter needs more.
        assert_eq!(
            denoise_rows_with(&s.band(100 - halo + 1, 200), 100, 110, p),
            Err(DenoiseError::Rows)
        );
        assert_eq!(
            denoise_rows(&s.band(100 - halo, 200), 100, 110),
            Err(DenoiseError::Rows)
        );
    }
}

#[test]
fn the_viewport_preset_lowers_the_error_and_never_mixes_two_parts() {
    for samples in [1u32, 2, 4, 16] {
        let s = Synthetic::new(48, 40, samples, 0.5, 2.0, 1.0);
        let out = denoise_with(&s.input(), Preset::VIEWPORT).expect("denoise");
        for (id, truth) in [(1u32, 0.5f32), (2, 2.0)] {
            let (before, after) = (mse(&s, &s.sums, id, truth), mse(&s, &out, id, truth));
            eprintln!("viewport preset, {samples} spp, part {id}: mse {before:.5} -> {after:.5}");
            assert!(
                after < 0.35 * before,
                "{samples} spp part {id}: {before} -> {after}"
            );
        }
    }
    let s = Synthetic::new(40, 32, 8, 0.0, 3.0, 1.5);
    let out = denoise_with(&s.input(), Preset::VIEWPORT).expect("denoise");
    for p in 0..s.part_id.len() {
        match s.part_id[p] {
            0 => assert_eq!(
                out[p * 4..p * 4 + 4],
                s.sums[p * 4..p * 4 + 4],
                "background {p}"
            ),
            1 => assert!(out[p * 4..p * 4 + 3].iter().all(|&v| v == 0.0), "left {p}"),
            _ => {}
        }
        assert_eq!(out[p * 4 + 3], s.sums[p * 4 + 3]);
    }
}

#[test]
fn the_example_denoised_for_the_viewport_has_a_pinned_hash() {
    // The page's pool (rt.wasm, `rt_denoise_with`) and the launcher give these bits too
    // (tests/denoise.test.ts with the real module). At 2 samples the 3 × 3 variance estimate
    // works, at 4 the film's own variance.
    let p = Preset::VIEWPORT;
    for (samples, pinned) in [
        (2u32, PINNED_DENOISED_VIEWPORT_EXAMPLE_2SPP),
        (4, PINNED_DENOISED_VIEWPORT_EXAMPLE_4SPP),
    ] {
        let (film, passes) = example_with_guides(samples);
        let sums = rgba_sums(&film);
        let input = DenoiseInput::whole(samples, &sums, &film.lum2, &passes).expect("input");
        let out = denoise_with(&input, p).expect("denoise");
        let hash = fnv1a(&means(&out, samples));
        eprintln!("example denoised for the viewport at {samples} spp: {hash:#010x}");
        assert_eq!(hash, pinned, "{samples} spp");
        let h = film.height;
        let mut banded = Vec::new();
        for k in 0..7 {
            let (y0, y1) = (h * k / 7, h * (k + 1) / 7);
            banded.extend(
                denoise_rows_with(&input.with_halo_of(y0, y1, p), y0, y1, p).expect("band"),
            );
        }
        assert_eq!(banded, out);
        // The full filter's image is another one.
        assert_ne!(out, denoise(&input).expect("full"));
    }
}

/// Pinned hashes of the example image at 2 and 4 samples per pixel denoised with
/// [`Preset::VIEWPORT`].
pub(crate) const PINNED_DENOISED_VIEWPORT_EXAMPLE_2SPP: u32 = 0x7000_ceb2;
pub(crate) const PINNED_DENOISED_VIEWPORT_EXAMPLE_4SPP: u32 = 0x5318_d4c5;

// ------------------------------------------------------------------ the strength (U11b)

#[test]
fn half_strength_is_the_mean_of_the_two_images_none_is_the_noisy_one_and_all_the_filter() {
    let s = Synthetic::new(30, 200, 6, 0.7, 1.4, 1.0);
    let w = 30usize;
    for preset in [Preset::FULL, Preset::VIEWPORT] {
        let clean = denoise_with(&s.input(), preset).expect("clean");
        let noisy = &s.sums[..];
        let half = denoise_rows_at(&s.input(), 0, 200, preset, 0.5).expect("half");
        for (i, (&h, (&n, &c))) in half.iter().zip(noisy.iter().zip(&clean)).enumerate() {
            let want = if i % 4 == 3 { n } else { (n + c) * 0.5 };
            assert_eq!(h.to_bits(), want.to_bits(), "{preset:?} {i}");
        }
        assert_eq!(
            denoise_rows_at(&s.input(), 0, 200, preset, 0.0).expect("none"),
            noisy
        );
        assert_eq!(
            denoise_rows_at(&s.input(), 0, 200, preset, 1.0).expect("all"),
            clean
        );
        // Out of range is brought into it; NaN is all of the filter.
        assert_eq!(
            denoise_rows_at(&s.input(), 0, 200, preset, 7.0).expect("7"),
            clean
        );
        assert_eq!(
            denoise_rows_at(&s.input(), 0, 200, preset, -1.0).expect("-1"),
            noisy
        );
        assert_eq!(
            denoise_rows_at(&s.input(), 0, 200, preset, f32::NAN).expect("nan"),
            clean
        );
        // A band at a strength is those rows of the whole image at that strength, and a band
        // without its halo is refused even when no filter runs.
        let halo = preset.halo();
        let (y0, y1) = (90u32, 100u32);
        let band = s.band(y0 - halo, (y1 + halo).min(200));
        for strength in [0.0f32, 0.3, 1.0] {
            let rows = denoise_rows_at(&band, y0, y1, preset, strength).expect("band");
            let whole = denoise_rows_at(&s.input(), 0, 200, preset, strength).expect("whole");
            assert_eq!(rows[..], whole[y0 as usize * w * 4..y1 as usize * w * 4]);
            assert_eq!(
                denoise_rows_at(&s.band(y0 - halo + 1, 200), y0, y1, preset, strength),
                Err(DenoiseError::Rows)
            );
        }
    }
    // The blend itself: in place, coverage untouched.
    let mut clean = vec![2.0f32, 4.0, 6.0, 1.0];
    blend(&[0.0, 0.0, 2.0, 0.5], &mut clean, 0.25);
    assert_eq!(clean, [0.5, 1.0, 3.0, 1.0]);
}

#[test]
fn the_denoised_example_at_full_strength_keeps_its_pinned_hash() {
    let (film, passes) = example_with_guides(4);
    let sums = rgba_sums(&film);
    let input = DenoiseInput::whole(4, &sums, &film.lum2, &passes).expect("input");
    let out = denoise_rows_at(&input, 0, film.height, Preset::FULL, 1.0).expect("denoise");
    assert_eq!(fnv1a(&means(&out, 4)), PINNED_DENOISED_EXAMPLE_4SPP);
}
