//! Native front end of the Repackshot engine.
//!
//! `rt-core` is pure computation; everything that touches the operating system lives here:
//! reading and writing files, spawning threads and measuring time.

use rt_core::adaptive::{gather, Adaptive, BlockWork};
use rt_core::caustics::PhotonMap;
use rt_core::color::Tonemap;
use rt_core::image::Film;
use rt_core::integrator::Prepared;
use rt_core::passes::{PassFilm, Passes, PASS_ALL};
use rt_core::pixel_filter::EdgeMask;
use rt_core::render::{
    render_block, render_tile_albedo_edges, render_tile_edges, render_tile_exact, tile_grid,
};
use rt_core::scene::{Scene, DENOISE_IMAGE};
use rt_core::simd::Isa;
use rt_post::denoise::{denoise_rows_at, DenoiseInput, Preset, GUIDE_PASSES};
use std::path::Path;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Mutex, OnceLock, PoisonError};
use std::time::{Duration, Instant};

pub mod adaptive_noise;
pub mod bench;
pub mod cli;
pub mod filter_sheet;
pub mod lens_catalogue;
pub mod lens_sheet;
pub mod pattern_sheet;
pub mod scenes;
pub mod sheet;
pub mod sss_sheet;
pub mod tilt_sheet;
pub mod tone;

/// Edge length of the square tiles handed to the worker threads.
pub const TILE_SIZE: u32 = 32;

/// Most samples per tile in one progressive pass (passes grow 1, 2, 4, ... up to this).
pub const MAX_PASS_SAMPLES: u32 = 16;

/// The result of [`render`].
pub struct RenderOutput {
    /// The accumulated film of the whole image.
    pub film: Film,
    /// Samples per pixel actually rendered (fewer than asked when the time budget ran out).
    pub samples: u32,
    /// Number of rays cast (camera, extension and shadow rays).
    pub rays: u64,
    /// Wall clock time spent rendering (excluding file output).
    pub elapsed: Duration,
    /// The exact passes rendered next to the image: those of `RNDR.passes` and, when the scene
    /// asks for denoise, the denoiser's guides (`rt_post::denoise::GUIDE_PASSES`).
    pub passes: Option<Passes>,
    /// E10: what adaptive sampling did (`RNDR.adaptive`); `None` without it. The film's pixels
    /// then have their own counts (`Film::weight`), `samples` being the most of them.
    pub adaptive: Option<AdaptiveRun>,
}

/// What an adaptive render did (E10, [`rt_core::adaptive`]).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct AdaptiveRun {
    /// The fewest samples of a pixel.
    pub min: u32,
    /// The most.
    pub max: u32,
    /// Rounds decided (the first, of every pixel, included).
    pub rounds: u32,
    /// It stopped because no block needed more (under the noise target or at the cap).
    pub converged: bool,
    /// The last decision.
    pub last: Option<rt_core::adaptive::Decision>,
}

/// The passes a render of `scene` needs: its own, and the denoiser's guides when it denoises.
pub fn passes_for(scene: &Scene) -> u32 {
    let guides = if scene.render.denoise & DENOISE_IMAGE != 0 {
        GUIDE_PASSES
    } else {
        0
    };
    (scene.render.passes | guides) & PASS_ALL
}

/// Denoises `film` (`samples` samples per pixel) with its `passes` on `threads` threads: bands
/// of rows with their halo, each exactly those rows of the whole image, so the result does not
/// depend on the thread count. Returns the film with its radiance replaced, or `None` when the
/// passes lack the guides.
pub fn denoise_film(film: &Film, passes: &Passes, samples: u32, threads: usize) -> Option<Film> {
    denoise_film_at(film, passes, samples, threads, 1.0)
}

/// [`denoise_film`] at a strength (U11b, `0..=1`, `RNDR.denoise_strength`): the denoised film
/// blended with `film`, `film × (1 − s) + denoised × s` per channel; 0 runs no filter.
pub fn denoise_film_at(
    film: &Film,
    passes: &Passes,
    samples: u32,
    threads: usize,
    strength: f32,
) -> Option<Film> {
    // E10: an adaptive film's pixels have their own counts: its sums go to the denoiser as sums
    // of `samples` samples, each pixel's variance with its own count.
    let adaptive = film.weight.iter().any(|&w| w != samples as f32);
    let counts = if adaptive {
        film.weight.clone()
    } else {
        Vec::new()
    };
    let rescaled;
    let film = if adaptive {
        rescaled = rt_core::adaptive::rescale_film(film, samples);
        &rescaled
    } else {
        film
    };
    let sums = rt_post::denoise::rgba_sums(film);
    let whole = DenoiseInput::whole(samples, &sums, &film.lum2, passes)
        .ok()?
        .with_counts(&counts)
        .ok()?;
    let h = film.height;
    let bands = (threads.max(1) as u32).min(h.max(1));
    let rows: Vec<Option<Vec<f32>>> = std::thread::scope(|scope| {
        let workers: Vec<_> = (0..bands)
            .map(|k| {
                let (y0, y1) = (h * k / bands, h * (k + 1) / bands);
                let band = whole.with_halo(y0, y1);
                scope.spawn(move || denoise_rows_at(&band, y0, y1, Preset::FULL, strength).ok())
            })
            .collect();
        workers
            .into_iter()
            .map(|w| {
                w.join()
                    .unwrap_or_else(|payload| std::panic::resume_unwind(payload))
            })
            .collect()
    });
    let mut out = film.clone();
    let mut p = 0usize;
    for band in rows {
        for px in band?.chunks_exact(4) {
            out.rgb[p * 3..p * 3 + 3].copy_from_slice(&px[..3]);
            p += 1;
        }
    }
    Some(out)
}

impl RenderOutput {
    /// The denoised film (with the scene's `RNDR.denoise`, or for anyone who asks), on
    /// `threads` threads; `None` without the guide passes.
    pub fn denoised(&self, threads: usize) -> Option<Film> {
        denoise_film(&self.film, self.passes.as_ref()?, self.samples, threads)
    }

    /// [`RenderOutput::denoised`] at a strength (U11b; the scene's `RNDR.denoise_strength`).
    pub fn denoised_at(&self, threads: usize, strength: f32) -> Option<Film> {
        denoise_film_at(
            &self.film,
            self.passes.as_ref()?,
            self.samples,
            threads,
            strength,
        )
    }

    /// Converts the film to 8-bit sRGB using the exposure and tone mapping stored in `scene`.
    pub fn to_rgb8(&self, scene: &Scene) -> Vec<u8> {
        self.film.to_srgb8_tonemapped(
            scene.render.exposure_ev,
            Tonemap::from_u32(scene.render.tonemap),
        )
    }

    /// Rays per second, or zero when the elapsed time is too small to measure.
    pub fn rays_per_second(&self) -> f64 {
        let seconds = self.elapsed.as_secs_f64();
        if seconds > 0.0 {
            self.rays as f64 / seconds
        } else {
            0.0
        }
    }
}

/// The photon maps of sample indices `first .. first + count` of a scene with caustics (none
/// without), each traced on `threads` threads: its photons cut in as many ranges, traced in
/// parallel and put back together in range order, so the maps are the same bits for any thread
/// count. Returns the maps and the rays cast.
pub fn photon_maps(
    scene: &Scene,
    prepared: &Prepared,
    first: u32,
    count: u32,
    threads: usize,
    isa: Isa,
) -> (Vec<PhotonMap>, u64) {
    if !prepared.has_caustics() {
        return (Vec::new(), 0);
    }
    let photons = scene.render.caustic_photons;
    let threads = threads.clamp(1, photons.max(1) as usize) as u32;
    let mut maps = Vec::with_capacity(count as usize);
    let mut rays = 0u64;
    for sample in first..first + count {
        let parts: Vec<(Vec<rt_core::caustics::Photon>, u64)> = std::thread::scope(|scope| {
            let workers: Vec<_> = (0..threads)
                .map(|k| {
                    let range = (photons as u64 * k as u64 / threads as u64) as u32
                        ..(photons as u64 * (k as u64 + 1) / threads as u64) as u32;
                    scope.spawn(move || PhotonMap::trace_range(scene, prepared, sample, range, isa))
                })
                .collect();
            workers
                .into_iter()
                .map(|w| {
                    w.join()
                        .unwrap_or_else(|payload| std::panic::resume_unwind(payload))
                })
                .collect()
        });
        let mut all = Vec::new();
        let mut map_rays = 0u64;
        for (part, r) in parts {
            all.extend(part);
            map_rays += r;
        }
        rays += map_rays;
        maps.push(PhotonMap::build(prepared, sample, all, map_rays));
    }
    (maps, rays)
}

/// Renders `samples` samples per pixel on `threads` threads, with no time limit.
pub fn render(scene: &Scene, samples: u32, threads: usize) -> RenderOutput {
    render_progressive(scene, samples, threads, None)
}

/// Renders up to `samples` samples per pixel on `threads` threads, progressively.
///
/// The image is cut into [`TILE_SIZE`] tiles, each with its own film. Rendering goes in passes:
/// every pass renders the next 1, 2, 4, ... (at most [`MAX_PASS_SAMPLES`]) sample indices of every
/// tile, tiles claimed from one shared queue (an [`AtomicUsize`] counter). Between passes, when
/// `budget` is given and spent, rendering stops: every pixel then has the same number of samples
/// (at least one pass is always rendered). Because `rt-core` derives its random numbers from the
/// pixel and the sample index only, and a tile's samples are always added in index order, the
/// result does not depend on the thread count, on which thread rendered which tile or on the pass
/// sizes. A scene that asks for adaptive sampling (E10) renders with [`render_adaptive`].
pub fn render_progressive(
    scene: &Scene,
    samples: u32,
    threads: usize,
    budget: Option<Duration>,
) -> RenderOutput {
    let spent = |_rays: u64, elapsed: Duration| budget.is_some_and(|b| elapsed >= b);
    render_until(scene, samples, threads, &spent)
}

/// [`render_progressive`] that stops between passes once `spent(rays, elapsed)` says so (the
/// rays cast and the time since the start): a time budget, or the cost of another render (the
/// measurement of E10, [`adaptive_noise`]).
pub fn render_until(
    scene: &Scene,
    samples: u32,
    threads: usize,
    spent: &dyn Fn(u64, Duration) -> bool,
) -> RenderOutput {
    if Adaptive::enabled(&scene.render) {
        return render_adaptive_until(scene, samples, threads, spent);
    }
    let start = Instant::now();
    let (width, height) = (scene.render.width, scene.render.height);
    let prepared = Prepared::new(scene);
    let isa = Isa::detect();
    let tiles = tile_grid(width, height, TILE_SIZE);
    let threads = threads.clamp(1, tiles.len().max(1));
    let films: Vec<Mutex<Film>> = tiles
        .iter()
        .map(|t| Mutex::new(Film::region(t.x, t.y, t.w, t.h)))
        .collect();
    let mask = passes_for(scene);
    let pass_films: Vec<Mutex<PassFilm>> = if mask == 0 {
        Vec::new()
    } else {
        tiles
            .iter()
            .map(|t| Mutex::new(PassFilm::region(t.x, t.y, t.w, t.h, mask)))
            .collect()
    };
    // E11: each tile's edge pixels, found once (from the centre rays) by whoever renders it first.
    let edges: Vec<OnceLock<EdgeMask>> = tiles.iter().map(|_| OnceLock::new()).collect();
    let edges = &edges;

    let mut done = 0u32;
    let mut rays = 0u64;
    let mut pass = 1u32;
    while done < samples {
        let count = pass.min(samples - done);
        let first = done;
        // Caustics: the photon maps of this pass's samples, before its tiles.
        let (maps, map_rays) = photon_maps(scene, &prepared, first, count, threads, isa);
        rays += map_rays;
        let maps = &maps;
        let next_tile = AtomicUsize::new(0);
        let pass_rays: u64 = std::thread::scope(|scope| {
            let workers: Vec<_> = (0..threads)
                .map(|_| {
                    scope.spawn(|| {
                        let mut rays = 0u64;
                        loop {
                            let i = next_tile.fetch_add(1, Ordering::Relaxed);
                            let (Some(&tile), Some(film)) = (tiles.get(i), films.get(i)) else {
                                break;
                            };
                            // Each tile is claimed by one thread per pass: never contended.
                            let mut film = film.lock().unwrap_or_else(PoisonError::into_inner);
                            let mut passes = pass_films
                                .get(i)
                                .map(|f| f.lock().unwrap_or_else(PoisonError::into_inner));
                            if let (Some(passes), 0) = (passes.as_deref_mut(), first) {
                                rays += render_tile_exact(scene, &prepared, tile, passes, isa);
                            }
                            let edges = edges[i].get_or_init(|| {
                                let mask = EdgeMask::of(scene, &prepared, tile, isa);
                                rays += mask.rays();
                                mask
                            });
                            for sample in first..first + count {
                                let map = maps.get((sample - first) as usize);
                                rays += render_tile_edges(
                                    scene, &prepared, map, edges, sample, &mut film, isa,
                                );
                                if let Some(passes) = passes.as_deref_mut() {
                                    rays += render_tile_albedo_edges(
                                        scene, &prepared, edges, sample, passes, isa,
                                    );
                                }
                            }
                        }
                        rays
                    })
                })
                .collect();
            workers
                .into_iter()
                .map(|w| {
                    w.join()
                        .unwrap_or_else(|payload| std::panic::resume_unwind(payload))
                })
                .sum()
        });
        rays += pass_rays;
        done += count;
        if spent(rays, start.elapsed()) {
            break;
        }
        pass = (pass * 2).min(MAX_PASS_SAMPLES);
    }
    finish(
        width, height, films, pass_films, mask, done, rays, start, None,
    )
}

/// What the AI post-processing starts from (X6, `--ai-inputs`): the film's linear image as `RPL1`
/// (straight-alpha RGBA `f32`, the sums over the samples, the colour over the coverage where it is
/// not opaque: `linear_of` of the launcher) and the passes as `RPP1` (`rt-app`'s `kept.rs`).
pub fn ai_inputs(film: &Film, passes: &Passes) -> (Vec<u8>, Vec<u8>) {
    let n = film.weight.len();
    let mut rpl = Vec::with_capacity(16 + n * 16);
    rpl.extend_from_slice(b"RPL1");
    for v in [16u32, film.width, film.height] {
        rpl.extend_from_slice(&v.to_le_bytes());
    }
    for p in 0..n {
        let inv = 1.0 / film.weight[p].max(1.0);
        let a = film.alpha[p] * inv;
        let mut c = [0, 1, 2].map(|k| film.rgb[p * 3 + k] * inv);
        let opaque = f64::from(a) >= 1.0 - 1.0e-6;
        if !opaque {
            c = if a > 0.0 { c.map(|v| v / a) } else { [0.0; 3] };
        }
        for v in [c[0], c[1], c[2], if opaque { 1.0 } else { a }] {
            rpl.extend_from_slice(&v.to_le_bytes());
        }
    }
    let mut rpp = Vec::with_capacity(32 + passes.byte_len());
    rpp.extend_from_slice(b"RPP1");
    for v in [32u32, passes.width, passes.height, passes.mask, 0, 0, 0] {
        rpp.extend_from_slice(&v.to_le_bytes());
    }
    passes.write_planes(&mut rpp);
    (rpl, rpp)
}

/// Puts the tile films (and the passes) of a render together.
#[allow(clippy::too_many_arguments)]
fn finish(
    width: u32,
    height: u32,
    films: Vec<Mutex<Film>>,
    pass_films: Vec<Mutex<PassFilm>>,
    mask: u32,
    done: u32,
    rays: u64,
    start: Instant,
    adaptive: Option<AdaptiveRun>,
) -> RenderOutput {
    let mut film = Film::new(width, height);
    for tile_film in films {
        film.copy_region(
            &tile_film
                .into_inner()
                .unwrap_or_else(PoisonError::into_inner),
        );
    }
    let passes = (!pass_films.is_empty()).then(|| {
        let mut passes = Passes::new(width, height, mask);
        for f in pass_films {
            let f = f.into_inner().unwrap_or_else(PoisonError::into_inner);
            passes.copy_region(f.origin_x, f.origin_y, &f.resolve());
        }
        passes
    });
    RenderOutput {
        film,
        samples: done,
        rays,
        elapsed: start.elapsed(),
        passes,
        adaptive,
    }
}

/// [`render_progressive`] of a scene that asks for adaptive sampling (E10, `RNDR.adaptive`;
/// [`rt_core::adaptive`]): rounds decided by the image's noise, at most `samples` per pixel, until
/// no block needs more or `budget` is spent (checked between passes, so a round may stop
/// half-way). The first round renders every tile as [`render_progressive`] does (its exact passes
/// and its albedo too, in passes of 1, 2, 4, 8 samples); the later rounds only the active blocks,
/// claimed one by one by the threads, in passes of up to [`MAX_PASS_SAMPLES`] samples (where a
/// round is cut changes no pixel). The decisions read the whole image, put together between rounds, so the film does
/// not depend on the thread count or on which thread rendered which tile.
pub fn render_adaptive(
    scene: &Scene,
    samples: u32,
    threads: usize,
    budget: Option<Duration>,
) -> RenderOutput {
    let spent = |_rays: u64, elapsed: Duration| budget.is_some_and(|b| elapsed >= b);
    render_adaptive_until(scene, samples, threads, &spent)
}

/// [`render_adaptive`] that stops between passes once `spent(rays, elapsed)` says so.
pub fn render_adaptive_until(
    scene: &Scene,
    samples: u32,
    threads: usize,
    spent: &dyn Fn(u64, Duration) -> bool,
) -> RenderOutput {
    let start = Instant::now();
    let (width, height) = (scene.render.width, scene.render.height);
    let prepared = Prepared::new(scene);
    let isa = Isa::detect();
    let tiles = tile_grid(width, height, TILE_SIZE);
    let threads = threads.clamp(1, tiles.len().max(1));
    let films: Vec<Mutex<Film>> = tiles
        .iter()
        .map(|t| Mutex::new(Film::region(t.x, t.y, t.w, t.h)))
        .collect();
    let mask = passes_for(scene);
    let pass_films: Vec<Mutex<PassFilm>> = if mask == 0 {
        Vec::new()
    } else {
        tiles
            .iter()
            .map(|t| Mutex::new(PassFilm::region(t.x, t.y, t.w, t.h, mask)))
            .collect()
    };
    let edges: Vec<OnceLock<EdgeMask>> = tiles.iter().map(|_| OnceLock::new()).collect();
    let edges = &edges;
    let mut adaptive = Adaptive::new(&scene.render, samples);
    let (w, h) = (width as usize, height as usize);
    let (mut sums, mut lum2) = (vec![0.0f32; w * h * 3], vec![0.0f32; w * h]);
    let mut rays = 0u64;
    let mut pass = 1u32;
    let mut rounds = 0u32;
    loop {
        if adaptive.left() == 0 {
            for film in &films {
                let film = film.lock().unwrap_or_else(PoisonError::into_inner);
                gather(&film, width, &mut sums, &mut lum2);
            }
            adaptive.decide(&sums, 3, &lum2);
            rounds += 1;
            if adaptive.converged() {
                break;
            }
        }
        let count = pass.min(adaptive.left());
        let first = adaptive.iteration();
        // The photon maps of the pass: map `j` serves sample `j` of the pass of every block.
        let (maps, map_rays) = photon_maps(scene, &prepared, first, count, threads, isa);
        rays += map_rays;
        let (maps, state) = (&maps, &adaptive);
        let warm = state.warming_up();
        // After the first round the work is the active blocks of every tile, claimed one by one
        // (a block's pixels cut from its tile's film, rendered and put back: the same bits), so
        // the threads share it however few tiles have any.
        let mut units: Vec<(usize, BlockWork)> = Vec::new();
        if !warm {
            let mut work = Vec::new();
            for (i, &tile) in tiles.iter().enumerate() {
                state.work(tile, count, &mut work);
                units.extend(work.iter().map(|&b| (i, b)));
            }
        }
        let units = &units;
        let next_tile = AtomicUsize::new(0);
        let pass_rays: u64 = std::thread::scope(|scope| {
            let workers: Vec<_> = (0..threads)
                .map(|_| {
                    scope.spawn(|| {
                        let mut rays = 0u64;
                        loop {
                            let k = next_tile.fetch_add(1, Ordering::Relaxed);
                            if !warm {
                                let Some(&(i, block)) = units.get(k) else {
                                    break;
                                };
                                let edges = edges[i].get_or_init(|| {
                                    let mask = EdgeMask::of(scene, &prepared, tiles[i], isa);
                                    rays += mask.rays();
                                    mask
                                });
                                let r = block.rect;
                                let mut part = films[i]
                                    .lock()
                                    .unwrap_or_else(PoisonError::into_inner)
                                    .cut(r.x, r.y, r.w, r.h);
                                for j in 0..block.count {
                                    rays += render_block(
                                        scene,
                                        &prepared,
                                        maps.get(j as usize),
                                        edges,
                                        r,
                                        block.first + j,
                                        &mut part,
                                        isa,
                                    );
                                }
                                films[i]
                                    .lock()
                                    .unwrap_or_else(PoisonError::into_inner)
                                    .copy_region(&part);
                                continue;
                            }
                            let i = k;
                            let (Some(&tile), Some(film)) = (tiles.get(i), films.get(i)) else {
                                break;
                            };
                            let mut film = film.lock().unwrap_or_else(PoisonError::into_inner);
                            let edges = edges[i].get_or_init(|| {
                                let mask = EdgeMask::of(scene, &prepared, tile, isa);
                                rays += mask.rays();
                                mask
                            });
                            {
                                // The first round: every pixel, as without adaptive sampling.
                                let mut passes = pass_films
                                    .get(i)
                                    .map(|f| f.lock().unwrap_or_else(PoisonError::into_inner));
                                if let (Some(passes), 0) = (passes.as_deref_mut(), first) {
                                    rays += render_tile_exact(scene, &prepared, tile, passes, isa);
                                }
                                for sample in first..first + count {
                                    let map = maps.get((sample - first) as usize);
                                    rays += render_tile_edges(
                                        scene, &prepared, map, edges, sample, &mut film, isa,
                                    );
                                    if let Some(passes) = passes.as_deref_mut() {
                                        rays += render_tile_albedo_edges(
                                            scene, &prepared, edges, sample, passes, isa,
                                        );
                                    }
                                }
                            }
                        }
                        rays
                    })
                })
                .collect();
            workers
                .into_iter()
                .map(|w| {
                    w.join()
                        .unwrap_or_else(|payload| std::panic::resume_unwind(payload))
                })
                .sum()
        });
        rays += pass_rays;
        adaptive.advance(count);
        if spent(rays, start.elapsed()) {
            break;
        }
        // After the first round, passes as long as a round allows (every pass waits for its last
        // block: fewer of them, less waiting).
        pass = if adaptive.warming_up() {
            (pass * 2).min(MAX_PASS_SAMPLES)
        } else {
            MAX_PASS_SAMPLES
        };
    }
    let (min, max) = adaptive.min_max();
    let run = AdaptiveRun {
        min,
        max,
        rounds,
        converged: adaptive.converged(),
        last: adaptive.last(),
    };
    finish(
        width,
        height,
        films,
        pass_films,
        mask,
        max,
        rays,
        start,
        Some(run),
    )
}

/// Writes `bytes` to `path`, creating missing parent directories.
pub fn write_file(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    if let Some(parent) = path.parent().filter(|p| !p.as_os_str().is_empty()) {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(path, bytes)
}

/// Encodes `rgb8` as a PNG and writes it to `path`, creating missing parent directories.
pub fn write_png(path: &Path, width: u32, height: u32, rgb8: &[u8]) -> std::io::Result<()> {
    write_file(path, &rt_core::png::encode(width, height, rgb8))
}

/// The file formats `rt` writes.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum OutputFormat {
    /// 8-bit sRGB PNG (the default).
    Png,
    /// Uncompressed TIFF: 8 or 16 bit sRGB, or 32-bit float in linear light.
    Tiff,
    /// Linear raw DNG: 32-bit float in linear light, a camera raw to a raw developer.
    Dng,
}

/// Dots per inch `rt` writes into a TIFF.
pub const TIFF_DPI: u32 = 72;

/// What `rt` writes: the format and the bits per sample.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct OutputSpec {
    /// The file format.
    pub format: OutputFormat,
    /// Bits per sample: 8 or 16 (sRGB, tone mapped) or 32 (float, linear light).
    pub bits: u32,
}

impl OutputSpec {
    /// Settles the output from `--format` and `--bits` (if given) and the extension of the
    /// output path (`.tif`, `.tiff` and `.dng` choose their format when `--format` is absent).
    /// A PNG is 8-bit, a TIFF is 8 (the default), 16 or 32, a DNG is 32.
    pub fn resolve(
        format: Option<OutputFormat>,
        bits: Option<u32>,
        path: &Path,
    ) -> Result<OutputSpec, String> {
        let by_extension = || match path
            .extension()
            .map(|e| e.to_string_lossy().to_ascii_lowercase())
            .as_deref()
        {
            Some("tif" | "tiff") => OutputFormat::Tiff,
            Some("dng") => OutputFormat::Dng,
            _ => OutputFormat::Png,
        };
        let format = format.unwrap_or_else(by_extension);
        let bits = match (format, bits) {
            (OutputFormat::Png, None | Some(8)) => 8,
            (OutputFormat::Png, Some(_)) => {
                return Err(
                    "a PNG is written with 8 bits per channel: use --format tiff for 16 or 32"
                        .into(),
                )
            }
            (OutputFormat::Tiff, None) => 8,
            (OutputFormat::Tiff, Some(b @ (8 | 16 | 32))) => b,
            (OutputFormat::Tiff, Some(_)) => return Err("--bits expects 8, 16 or 32".into()),
            (OutputFormat::Dng, None | Some(32)) => 32,
            (OutputFormat::Dng, Some(_)) => {
                return Err("a DNG is always 32-bit float: --bits can only be 32".into())
            }
        };
        Ok(OutputSpec { format, bits })
    }
}

/// The file `spec` asks for, from the film's pixels: tone mapped sRGB for a PNG and the 8 and 16
/// bit TIFFs, scene-linear light with the exposure applied (no curve, no clamp) for the 32-bit
/// TIFF and the DNG. Colour only: the film's coverage is not written.
pub fn encode_film(film: &Film, exposure_ev: f32, tonemap: Tonemap, spec: OutputSpec) -> Vec<u8> {
    use rt_core::tiff::{encode as tiff, Samples};
    let (w, h) = (film.width, film.height);
    match (spec.format, spec.bits) {
        (OutputFormat::Png, _) => {
            rt_core::png::encode(w, h, &film.to_srgb8_tonemapped(exposure_ev, tonemap))
        }
        (OutputFormat::Tiff, 8) => {
            let px = film.to_srgb8_tonemapped(exposure_ev, tonemap);
            tiff(w, h, 3, Samples::U8(&px), TIFF_DPI)
        }
        (OutputFormat::Tiff, 16) => {
            let px = film.to_srgb16_tonemapped(exposure_ev, tonemap);
            tiff(w, h, 3, Samples::U16(&px), TIFF_DPI)
        }
        (OutputFormat::Tiff, _) => {
            let px = film.to_linear_exposed(exposure_ev);
            tiff(w, h, 3, Samples::F32(&px), TIFF_DPI)
        }
        (OutputFormat::Dng, _) => rt_core::dng::encode(w, h, &film.to_linear_exposed(exposure_ev)),
    }
}
