use super::*;
use crate::caustics::PhotonMap;
use crate::integrator::Prepared;
use crate::pixel_filter::EdgeMask;
use crate::render::{render_block, render_tile_edges, tile_grid};
use crate::scene::Scene;
use crate::simd::Isa;

/// FNV-1a over the little-endian bytes of every float.
fn fnv1a(values: &[f32]) -> u32 {
    fnv1a_bytes(values.iter().flat_map(|v| v.to_le_bytes()))
}

fn fnv1a_bytes(bytes: impl Iterator<Item = u8>) -> u32 {
    bytes.fold(0x811c_9dc5u32, |hash, byte| {
        (hash ^ u32::from(byte)).wrapping_mul(0x0100_0193)
    })
}

fn settings(width: u32, height: u32, target: f32, ev: f32) -> RenderSettings {
    RenderSettings {
        width,
        height,
        exposure_ev: ev,
        adaptive: ADAPTIVE_ON,
        noise_threshold: target,
        ..RenderSettings::default()
    }
}

/// `n` samples of luminance `mean ± spread` (half of them each way): sums and squared sums of a
/// grey pixel, as a film holds them.
fn grey(n: u32, mean: f32, spread: f32) -> ([f32; 3], f32) {
    let (mut s, mut l2) = (0.0f32, 0.0f32);
    for i in 0..n {
        let v = if i % 2 == 0 { mean + spread } else { mean - spread };
        s += v;
        l2 += v * v;
    }
    ([s; 3], l2)
}

#[test]
fn the_error_of_a_pixel_is_the_relative_error_of_its_mean() {
    let floor = floor_for(0.0);
    assert_eq!(floor, EPSILON);
    // Constant samples: no error at all.
    let ([r, g, b], l2) = grey(16, 0.5, 0.0);
    assert_eq!(pixel_error(r, g, b, l2, 16, floor), 0.0);
    // ±0.1 around 0.5 over 16 samples: variance 0.01 · 16/15 of a sample, so of the mean
    // 0.01/15; relative to 0.5 + ε.
    let ([r, g, b], l2) = grey(16, 0.5, 0.1);
    let e = pixel_error(r, g, b, l2, 16, floor);
    let want = (0.01f32 / 15.0).sqrt() / 0.51;
    assert!((e - want).abs() < 1.0e-4 * want, "{e} vs {want}");
    // Four times the samples, half the error.
    let ([r, g, b], l2) = grey(64, 0.5, 0.1);
    let e64 = pixel_error(r, g, b, l2, 64, floor);
    assert!((e64 / e - 0.5).abs() < 0.02, "{e64} vs {e}");
    // Two stops brighter exposure: the floor is a quarter, dark noise weighs more.
    assert!(floor_for(2.0) < floor * 0.26);
    // Unmeasurable: fewer than two samples, a non-finite sum.
    assert_eq!(pixel_error(1.0, 1.0, 1.0, 1.0, 1, floor), UNMEASURED);
    assert_eq!(pixel_error(f32::NAN, 1.0, 1.0, 1.0, 8, floor), UNMEASURED);
    assert_eq!(pixel_error(1.0, 1.0, 1.0, f32::INFINITY, 8, floor), UNMEASURED);
}

/// A `width × height` image whose pixels left of `split` are noisy (±`spread` around 0.5) and the
/// others exact, every block with `counts` samples: sums (RGBA) and squared sums.
fn half_noisy(width: u32, height: u32, split: u32, spread: f32, n: u32) -> (Vec<f32>, Vec<f32>) {
    let mut sums = Vec::new();
    let mut lum2 = Vec::new();
    for _y in 0..height {
        for x in 0..width {
            let ([r, g, b], l2) = grey(n, 0.5, if x < split { spread } else { 0.0 });
            sums.extend_from_slice(&[r, g, b, n as f32]);
            lum2.push(l2);
        }
    }
    (sums, lum2)
}

#[test]
fn the_next_round_goes_to_the_noisy_blocks_above_the_median() {
    let (w, h) = (64u32, 16u32);
    let (cols, rows) = block_grid(w, h);
    assert_eq!((cols, rows), (8, 2));
    let counts = vec![16u32; 16];
    // Left half noisy: only its blocks are candidates; they are all alike, so all of them go.
    let (sums, lum2) = half_noisy(w, h, 32, 0.2, 16);
    let mut active = vec![true; 16];
    let d = decide(w, h, &counts, &sums, 4, &lum2, EPSILON, 0.0, 0, &mut active);
    let left: Vec<bool> = (0..16).map(|b| b % 8 < 4).collect();
    // The blocks next to the split see a third of noisy neighbours after smoothing: candidates
    // too (any error is above a target of 0), but below the median.
    assert_eq!(d.blocks, 16);
    assert!(d.threshold > 0.0 && d.max_error >= d.threshold);
    for b in 0..16 {
        if active[b] {
            assert!(left[b], "block {b} is clean and was chosen");
        }
    }
    assert!(d.active >= 4, "{d:?}");
    // The round: 16 samples (half the blocks active is a quarter or more of them).
    assert_eq!(d.round, ROUND);
    // With a target above the noise nothing is left: converged.
    let mut active = vec![true; 16];
    let d = decide(w, h, &counts, &sums, 4, &lum2, EPSILON, 0.5, 0, &mut active);
    assert_eq!((d.round, d.active), (0, 0));
    assert!(active.iter().all(|a| !a));
    assert_eq!(d.remaining, 0.0);
    // An exact image converges with no target at all.
    let (sums, lum2) = half_noisy(w, h, 0, 0.0, 16);
    let d = decide(w, h, &counts, &sums, 4, &lum2, EPSILON, 0.0, 0, &mut active);
    assert_eq!((d.round, d.max_error), (0, 0.0));
    // Blocks at the cap are no candidates.
    let (sums, lum2) = half_noisy(w, h, 32, 0.2, 16);
    let d = decide(w, h, &counts, &sums, 4, &lum2, EPSILON, 0.0, 16, &mut active);
    assert_eq!(d.round, 0);
}

/// A 64 × 64 image whose block 0 is noisy (±0.3 around 0.5) and the rest nearly exact (±0.001),
/// every block with its `counts`: sums (RGB) and squared sums.
fn one_noisy_block(counts: &[u32]) -> (Vec<f32>, Vec<f32>) {
    let mut sums = Vec::new();
    let mut lum2 = Vec::new();
    for y in 0..64u32 {
        for x in 0..64u32 {
            let spread = if x < 8 && y < 8 { 0.3 } else { 0.001 };
            let ([r, g, b], l2) = grey(counts[((y / 8) * 8 + x / 8) as usize], 0.5, spread);
            sums.extend_from_slice(&[r, g, b]);
            lum2.push(l2);
        }
    }
    (sums, lum2)
}

#[test]
fn a_noisier_block_wins_and_few_active_blocks_take_longer_rounds() {
    // One block in 64 is noisy: it alone goes (its neighbours' smoothed error stays under the
    // target), with a longer round, but never more than it has already.
    let mut counts = vec![16u32; 64];
    let (sums, lum2) = one_noisy_block(&counts);
    let mut active = vec![false; 64];
    let d = decide(64, 64, &counts, &sums, 3, &lum2, EPSILON, 0.06, 0, &mut active);
    assert_eq!(d.active, 1, "{d:?}");
    assert!(active[0]);
    // 64 blocks / (4 × 1) is 16 times the round, but block 0 has 16 samples: 16.
    assert_eq!(d.round, ROUND);
    // With 400 samples its error is under 3 %: at a target of 2 % it alone still goes, now for
    // 16 × 16 samples.
    counts[0] = 400;
    let (sums400, lum400) = one_noisy_block(&counts);
    let d = decide(64, 64, &counts, &sums400, 3, &lum400, EPSILON, 0.02, 0, &mut active);
    assert_eq!(d.active, 1, "{d:?}");
    assert!(active[0]);
    assert_eq!(d.round, ROUND * MAX_ROUND_FACTOR);
    // With a target, the time estimate counts what the noisy blocks still need, at most to the
    // cap.
    counts[0] = 16;
    let d = decide(64, 64, &counts, &sums, 3, &lum2, EPSILON, 0.01, 0, &mut active);
    assert!(d.remaining > 64.0 * 16.0 * 200.0, "{d:?}");
    let capped = decide(64, 64, &counts, &sums, 3, &lum2, EPSILON, 0.01, 100, &mut active);
    assert!(capped.remaining > 0.0 && capped.remaining <= 4.0 * 84.0 * 64.0, "{capped:?}");
}

#[test]
fn the_work_of_a_pass_covers_every_active_block_once_with_any_tiles() {
    let s = settings(37, 29, 0.0, 0.0);
    let mut ad = Adaptive::new(&s, 40);
    assert!(ad.warming_up());
    assert_eq!((ad.left(), ad.iteration()), (WARMUP, 0));
    // Block 3 only, by hand.
    ad.advance(WARMUP);
    for a in ad.active.iter_mut() {
        *a = false;
    }
    ad.counts.iter_mut().for_each(|c| *c = 16);
    ad.active[3] = true;
    ad.active[7] = true;
    ad.round = 30;
    ad.done = 0;
    ad.counts[7] = 30;
    for size in [8, 13, 32, 64] {
        let mut covered = vec![0u32; 37 * 29];
        let mut work = Vec::new();
        for tile in tile_grid(37, 29, size) {
            ad.work(tile, 16, &mut work);
            for wk in &work {
                for y in wk.rect.y..wk.rect.y + wk.rect.h {
                    for x in wk.rect.x..wk.rect.x + wk.rect.w {
                        assert!(tile.x <= x && x < tile.x + tile.w && tile.y <= y);
                        covered[(y * 37 + x) as usize] += wk.count;
                        let b = ad.block_of(x, y);
                        assert_eq!(wk.first, ad.counts[b]);
                    }
                }
            }
        }
        for y in 0..29 {
            for x in 0..37 {
                let b = ad.block_of(x, y);
                // Block 7 is at 30 of a cap of 40: 10 samples; block 3 the pass's 16.
                let want = match b {
                    3 => 16,
                    7 => 10,
                    _ => 0,
                };
                assert_eq!(covered[(y * 37 + x) as usize], want, "({x}, {y}) of tiles {size}");
            }
        }
    }
    assert_eq!(ad.pass_cost(16), 16 * 64 + 10 * 64);
    ad.advance(16);
    assert_eq!(ad.samples_of(3), 32);
    assert_eq!(ad.samples_of(7), 40);
    assert_eq!(ad.samples_of(0), 16);
    assert_eq!(ad.min_max(), (16, 40));
    assert_eq!(ad.left(), 14);
}

/// Renders `scene` adaptively with at most `cap` samples, its tiles in the order of `tiles`, in
/// passes of `pass` samples (cut at the rounds), each pass with its photon maps; the first round
/// through the plain tile renderer when `plain_first`. Returns the film and the final state.
pub(crate) fn adaptive_film(
    scene: &Scene,
    tiles: &[crate::render::TileRect],
    cap: u32,
    pass: u32,
    plain_first: bool,
) -> (Film, Adaptive) {
    let prepared = Prepared::new(scene);
    let isa = Isa::detect();
    let (w, h) = (scene.render.width, scene.render.height);
    let mut film = Film::new(w, h);
    let mut ad = Adaptive::new(&scene.render, cap);
    let edges: Vec<EdgeMask> = tiles
        .iter()
        .map(|&t| EdgeMask::of(scene, &prepared, t, isa))
        .collect();
    let mut work = Vec::new();
    loop {
        if ad.left() == 0 {
            ad.decide(&film.rgb, 3, &film.lum2);
            if ad.converged() {
                break;
            }
        }
        let count = pass.min(ad.left());
        let maps: Vec<PhotonMap> = if prepared.has_caustics() {
            (0..count)
                .map(|j| PhotonMap::trace(scene, &prepared, ad.iteration() + j, isa))
                .collect()
        } else {
            Vec::new()
        };
        for (i, &tile) in tiles.iter().enumerate() {
            if plain_first && ad.warming_up() {
                for j in 0..count {
                    let sample = ad.iteration() + j;
                    let map = maps.get(j as usize);
                    render_tile_edges(scene, &prepared, map, &edges[i], sample, &mut film, isa);
                }
                continue;
            }
            ad.work(tile, count, &mut work);
            for wk in &work {
                for j in 0..wk.count {
                    let map = maps.get(j as usize);
                    render_block(
                        scene,
                        &prepared,
                        map,
                        &edges[i],
                        wk.rect,
                        wk.first + j,
                        &mut film,
                        isa,
                    );
                }
            }
        }
        ad.advance(count);
    }
    (film, ad)
}

/// The E10 parity scene ([`crate::example::e10_scene`]) rendered adaptively to its cap.
pub(crate) fn e10_film() -> (Film, Adaptive) {
    let scene = crate::example::e10_scene();
    let tiles = tile_grid(scene.render.width, scene.render.height, 32);
    adaptive_film(&scene, &tiles, scene.render.max_samples, 16, true)
}

#[test]
fn an_adaptive_image_is_the_same_with_any_tiles_order_and_passes() {
    // The E10 scene: glass with caustics (the photon maps of the rounds), edge samples, a noise
    // target and a cap. Tiles of 32 in order (the first round by the plain tile renderer), of 24
    // reversed, of 13 shuffled, and passes of 16, 5 and 3 samples cut at the rounds: the same film,
    // bit for bit, and the same counts.
    let scene = crate::example::e10_scene();
    let (w, h) = (scene.render.width, scene.render.height);
    let cap = scene.render.max_samples;
    let (reference, ad) = adaptive_film(&scene, &tile_grid(w, h, 32), cap, 16, true);
    let mut reversed = tile_grid(w, h, 24);
    reversed.reverse();
    let (other, ad2) = adaptive_film(&scene, &reversed, cap, 5, false);
    assert_eq!(ad2.counts, ad.counts);
    assert!(other == reference, "tiles of 24 reversed, passes of 5");
    let mut shuffled = tile_grid(w, h, 13);
    shuffled.sort_by_key(|t| (t.x * 7 + t.y * 13) % 11);
    let (other, _) = adaptive_film(&scene, &shuffled, cap, 3, false);
    assert!(other == reference, "tiles of 13 shuffled, passes of 3");
    // Converged (or capped): every block is at the cap or under the target.
    assert!(ad.converged());
    let (lo, hi) = ad.min_max();
    assert_eq!(lo, WARMUP, "the clean blocks stop after the first round");
    assert!(hi > 2 * lo, "the noisy ones get more: {lo}..{hi}");
}

#[test]
fn every_pixel_of_an_adaptive_image_is_the_plain_mean_of_its_own_samples() {
    // Without caustics a sample is the same whatever round it is in: every pixel of an adaptive
    // image is bit for bit the pixel of the plain image of as many samples (no weights, no
    // mixing: a block that stops keeps its mean). The example, small, with a target.
    let mut scene = crate::example::scene();
    scene.render.width = 48;
    scene.render.height = 40;
    scene.render.adaptive = ADAPTIVE_ON;
    scene.render.noise_threshold = 0.03;
    let (w, h) = (48u32, 40u32);
    let tiles = tile_grid(w, h, 32);
    let (film, ad) = adaptive_film(&scene, &tiles, 96, 16, true);
    let counts = ad.pixel_counts();
    let (lo, hi) = ad.min_max();
    assert!(hi > lo, "{lo}..{hi}");
    let prepared = Prepared::new(&scene);
    let mut plain = Film::new(w, h);
    let mut checked = 0;
    for s in 0..hi {
        for &tile in &tiles {
            crate::render::render_tile_prepared(
                &scene,
                &prepared,
                tile,
                s,
                &mut plain,
                Isa::detect(),
            );
        }
        for (p, &n) in counts.iter().enumerate() {
            if n as u32 == s + 1 {
                assert_eq!(film.weight[p], n);
                assert_eq!(film.rgb[p * 3..p * 3 + 3], plain.rgb[p * 3..p * 3 + 3], "pixel {p}");
                assert_eq!(film.lum2[p], plain.lum2[p], "pixel {p}");
                checked += 1;
            }
        }
    }
    assert_eq!(checked, (w * h) as usize);
}

#[test]
fn the_e10_example_has_a_pinned_adaptive_image() {
    // `tools/wasm-parity.mjs --adaptive` renders the same with the real `rt_wasm.wasm` (its
    // decision through `rt_adaptive_decide`, its blocks through `rt_render_block_rgba`) and the
    // page's pool does with its own port of the decision (`tests/adaptive.test.ts`); the
    // launcher with 1, 4 and 16 threads (`rt-app`).
    let scene = crate::example::e10_scene();
    assert_eq!(Scene::from_rsb(&scene.to_rsb()).as_ref(), Ok(&scene));
    let (film, ad) = e10_film();
    let hash = fnv1a(&film.resolve());
    let (lo, hi) = ad.min_max();
    eprintln!("E10 example: {hash:#010x}, samples {lo}..{hi}");
    assert_eq!(hash, PINNED_E10_ADAPTIVE);
    assert_eq!((lo, hi), PINNED_E10_SAMPLES);
}

/// Pinned hash of the E10 example rendered adaptively to its cap (resolved film).
pub(crate) const PINNED_E10_ADAPTIVE: u32 = 0x264b_4106;
/// The fewest and most samples of a pixel of it.
pub(crate) const PINNED_E10_SAMPLES: (u32, u32) = (16, 48);

/// A synthetic image for the cross test of the decision with the page's port: per pixel a colour
/// and a spread from an integer hash of the pixel and `round`, the sums of `counts` samples of it.
pub(crate) fn synthetic(ad: &Adaptive, width: u32, height: u32, round: u32) -> (Vec<f32>, Vec<f32>) {
    let hash = |mut x: u32| {
        x ^= x >> 16;
        x = x.wrapping_mul(0x7feb_352d);
        x ^= x >> 15;
        x = x.wrapping_mul(0x846c_a68b);
        x ^= x >> 16;
        x
    };
    let mut sums = Vec::with_capacity((width * height * 4) as usize);
    let mut lum2 = Vec::with_capacity((width * height) as usize);
    for y in 0..height {
        for x in 0..width {
            let p = y * width + x;
            let v = hash(p.wrapping_mul(2_654_435_761) ^ round.wrapping_mul(0x9e37_79b9));
            let n = ad.samples_of(ad.block_of(x, y)) as f32;
            let c = [
                (v & 0xff) as f32 / 255.0,
                ((v >> 8) & 0xff) as f32 / 255.0,
                ((v >> 16) & 0xff) as f32 / 255.0,
            ];
            // A smooth band of noise across the image, and a noisy corner.
            let spread = ((v >> 24) & 0xff) as f32 / 255.0
                * if x < width / 3 { 0.5 } else { 0.05 }
                * if y < 9 { 2.0 } else { 1.0 };
            let l = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
            sums.extend_from_slice(&[c[0] * n, c[1] * n, c[2] * n, n]);
            lum2.push((l * l + spread * spread) * n);
        }
    }
    (sums, lum2)
}

/// The decisions of [`synthetic`] images over `rounds` rounds of a 45 × 37 image (a noise target
/// of 2 %, an exposure of +0.5, a cap of 200), hashed: each round's size, active blocks,
/// threshold, largest error and remaining work, and the blocks chosen.
pub(crate) fn synthetic_decisions(rounds: u32) -> u32 {
    let (w, h) = (45u32, 37u32);
    let s = settings(w, h, 0.02, 0.5);
    let mut ad = Adaptive::new(&s, 200);
    let mut bytes = Vec::new();
    for round in 0..rounds {
        let left = ad.left();
        ad.advance(left);
        let (sums, lum2) = synthetic(&ad, w, h, round);
        let d = ad.decide(&sums, 4, &lum2);
        for v in [d.round, d.active, d.blocks] {
            bytes.extend_from_slice(&v.to_le_bytes());
        }
        for v in [d.threshold, d.max_error, d.remaining] {
            bytes.extend_from_slice(&v.to_le_bytes());
        }
        bytes.extend(ad.active().iter().map(|&a| u8::from(a)));
        if ad.converged() {
            break;
        }
    }
    fnv1a_bytes(bytes.into_iter())
}

#[test]
fn the_decisions_of_a_synthetic_image_have_a_pinned_hash() {
    // `tests/adaptive.test.ts` makes the same images and runs the page's port of the decision
    // (`src/render/adaptive.ts`) on them: it must give these bits.
    let hash = synthetic_decisions(6);
    eprintln!("E10 synthetic decisions: {hash:#010x}");
    assert_eq!(hash, PINNED_E10_DECISIONS);
}

/// Pinned hash of six decisions of the synthetic image.
pub(crate) const PINNED_E10_DECISIONS: u32 = 0xb492_454a;

#[test]
fn rescaled_sums_keep_the_mean_and_leave_equal_counts_alone() {
    assert_eq!(rescale(3.0, 4.0, 4.0), 3.0);
    assert_eq!(rescale(3.0, 0.0, 4.0), 0.0);
    let r = rescale(3.0, 6.0, 16.0);
    assert!((r / 16.0 - 0.5).abs() < 1.0e-7);
    let mut film = Film::region(2, 1, 2, 2);
    film.splat(3, 2, crate::color::Rgb::splat(2.0));
    let mut sums = vec![0.0; 5 * 4 * 3];
    let mut lum2 = vec![0.0; 5 * 4];
    gather(&film, 5, &mut sums, &mut lum2);
    assert_eq!(sums[(2 * 5 + 3) * 3..(2 * 5 + 3) * 3 + 3], [2.0; 3]);
    assert!(lum2[2 * 5 + 3] > 0.0);
    assert_eq!(sums.iter().filter(|&&v| v != 0.0).count(), 3);
}
