//! Native front end of the Repackshot engine.
//!
//! `rt-core` is pure computation; everything that touches the operating system lives here:
//! reading and writing files, spawning threads and measuring time.

use rt_core::color::Tonemap;
use rt_core::image::Film;
use rt_core::integrator::Prepared;
use rt_core::render::{render_tile_prepared, tile_grid};
use rt_core::scene::Scene;
use rt_core::simd::Isa;
use std::path::Path;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Mutex, PoisonError};
use std::time::{Duration, Instant};

pub mod bench;
pub mod cli;
pub mod scenes;
pub mod sheet;
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
}

impl RenderOutput {
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
/// sizes.
pub fn render_progressive(
    scene: &Scene,
    samples: u32,
    threads: usize,
    budget: Option<Duration>,
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

    let mut done = 0u32;
    let mut rays = 0u64;
    let mut pass = 1u32;
    while done < samples {
        let count = pass.min(samples - done);
        let first = done;
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
                            for sample in first..first + count {
                                rays += render_tile_prepared(
                                    scene, &prepared, tile, sample, &mut film, isa,
                                );
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
        if budget.is_some_and(|b| start.elapsed() >= b) {
            break;
        }
        pass = (pass * 2).min(MAX_PASS_SAMPLES);
    }

    let mut film = Film::new(width, height);
    for tile_film in films {
        film.copy_region(
            &tile_film
                .into_inner()
                .unwrap_or_else(PoisonError::into_inner),
        );
    }
    RenderOutput {
        film,
        samples: done,
        rays,
        elapsed: start.elapsed(),
    }
}

/// Encodes `rgb8` as a PNG and writes it to `path`, creating missing parent directories.
pub fn write_png(path: &Path, width: u32, height: u32, rgb8: &[u8]) -> std::io::Result<()> {
    if let Some(parent) = path.parent().filter(|p| !p.as_os_str().is_empty()) {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(path, rt_core::png::encode(width, height, rgb8))
}
