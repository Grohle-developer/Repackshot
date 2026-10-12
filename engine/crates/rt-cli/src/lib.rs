//! Native front end of the Repackshot engine.
//!
//! `rt-core` is pure computation; everything that touches the operating system lives here:
//! reading and writing files, spawning threads and measuring time.

use rt_core::color::Tonemap;
use rt_core::image::Film;
use rt_core::render::{render_tile, tile_grid};
use rt_core::scene::Scene;
use std::path::Path;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::{Duration, Instant};

pub mod bench;
pub mod cli;

/// Edge length of the square tiles handed to the worker threads.
pub const TILE_SIZE: u32 = 32;

/// The result of [`render`].
pub struct RenderOutput {
    /// The accumulated film of the whole image.
    pub film: Film,
    /// Number of rays cast.
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

/// Renders `samples` samples per pixel on `threads` threads.
///
/// Tiles are claimed from one shared queue (an [`AtomicUsize`] counter); every thread accumulates
/// into its own full-size [`Film`] and the films are merged at the end. Because `rt-core` derives
/// its random numbers from the pixel and the sample index only, the result does not depend on the
/// thread count or on which thread picked which tile.
pub fn render(scene: &Scene, samples: u32, threads: usize) -> RenderOutput {
    let start = Instant::now();
    let (width, height) = (scene.render.width, scene.render.height);
    let tiles = tile_grid(width, height, TILE_SIZE);
    let threads = threads.clamp(1, tiles.len().max(1));
    let next_tile = AtomicUsize::new(0);

    let partials: Vec<(Film, u64)> = std::thread::scope(|scope| {
        let workers: Vec<_> = (0..threads)
            .map(|_| {
                scope.spawn(|| {
                    let mut film = Film::new(width, height);
                    let mut rays = 0u64;
                    while let Some(&tile) = tiles.get(next_tile.fetch_add(1, Ordering::Relaxed)) {
                        for sample in 0..samples {
                            rays += render_tile(scene, tile, sample, &mut film);
                        }
                    }
                    (film, rays)
                })
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

    let mut film = Film::new(width, height);
    let mut rays = 0;
    for (partial, partial_rays) in &partials {
        film.merge(partial);
        rays += partial_rays;
    }
    RenderOutput {
        film,
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
