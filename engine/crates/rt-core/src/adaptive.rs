//! Adaptive sampling (E10): the samples go where the noise is, deterministically.
//!
//! With `RNDR.adaptive` bit 0 ([`ADAPTIVE_ON`]) a host renders in **rounds**. The first one gives
//! every pixel [`WARMUP`] samples (the sample index of each is its photon-map iteration, exactly
//! as without adaptive sampling). At the end of every round, with every tile of it rendered by
//! whatever threads, the image decides the next one ([`decide`]):
//!
//! 1. Each pixel's **relative error of the mean**, `sqrt(Var / n) / (mean + ε)`: the variance of
//!    its samples' luminance from the film's sums (`Film::lum2`), `(E[l²] − E[l]²) / (n − 1)` of
//!    the mean of `n` samples (the denoiser's estimate), over its mean luminance plus a floor
//!    `ε` = [`EPSILON`] of display white (`EPSILON / 2^ev`), so dark noise counts in proportion
//!    to what shows.
//! 2. That error smoothed by the 3 × 3 mean around the pixel (inside the image), so one noisy
//!    estimate does not decide alone.
//! 3. Per **block** of [`BLOCK`] × [`BLOCK`] pixels the largest smoothed error: a block is
//!    sampled or not as a whole, so its pixels always share their count, and the rays of a
//!    round stay together for the BVH and the caches.
//! 4. The **candidates** are the blocks above the noise target (`RNDR.noise_threshold`; with
//!    none, every block with any error) that have not reached the sample cap. The next round goes
//!    to the candidates at or above the 50 % quantile of their errors: the threshold of the
//!    moment, which falls as the image converges. With no candidate the render has converged.
//!    A block that gets no round keeps its samples and its mean: every pixel is still the plain
//!    mean of its own samples, its sample indices `0..n` in order.
//! 5. The size of the next round: [`ROUND`] samples, more when few blocks are active (the round
//!    costs as much as the decision then), never more than the least sampled active block has
//!    already: `ROUND × clamp(blocks / (4 × active), 1, 16)`, at most `max(ROUND, n_min)`.
//!
//! The decision reads the image only (sums, squared luminance, counts), in a fixed order and in
//! `f32`, so it is the same with any number of threads, any tile size and order, natively and in
//! WebAssembly (`src/render/adaptive.ts` is its bit-exact port for the page's pool). Where a
//! round is cut into host passes (of any size, by time, by the live denoise) changes no pixel:
//! decisions happen only at round ends. In a pass, every active block is at the same offset of
//! the round, so sample `j` of the pass uses photon map `iteration + j` for all of them: a pass
//! traces as many maps as without adaptive sampling, and two samples of a pixel never share one.
//!
//! The exact passes and the albedo are rendered as before in the first round (all the pixels,
//! the plain tile renderer); the later rounds render the image only ([`crate::render::render_block`]).

use crate::color::exposure;
use crate::image::Film;
use crate::render::TileRect;
use crate::scene::RenderSettings;

/// `RNDR.adaptive` bit 0: the host samples adaptively.
pub const ADAPTIVE_ON: u32 = 1;
/// Edge of the square blocks a decision takes or leaves whole.
pub const BLOCK: u32 = 8;
/// Samples every pixel gets before the first decision.
pub const WARMUP: u32 = 16;
/// Samples of a round (the smallest; see the module's step 5).
pub const ROUND: u32 = 16;
/// Largest factor a round grows by when few blocks are active.
pub const MAX_ROUND_FACTOR: u32 = 16;
/// The floor of the mean in the relative error, as a fraction of display white (before the
/// exposure).
pub const EPSILON: f32 = 0.01;
/// The error of a pixel that cannot be measured (fewer than two samples, a non-finite sum):
/// large and finite, so that the 3 × 3 sums stay finite.
pub const UNMEASURED: f32 = 1.0e30;
/// Largest `RNDR.noise_threshold` (a relative error of 100 %).
pub const MAX_NOISE_THRESHOLD: f32 = 1.0;

/// What a decision found and chose ([`decide`]).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Decision {
    /// Samples of the next round for each active block (before the cap); 0: converged.
    pub round: u32,
    /// Blocks that get it.
    pub active: u32,
    /// Blocks of the image.
    pub blocks: u32,
    /// The threshold of the moment: the 50 % quantile of the candidates' errors (0 when there is
    /// no candidate).
    pub threshold: f32,
    /// The largest block error of the image.
    pub max_error: f32,
    /// With a noise target: the pixel-samples still needed to bring every block to it, from the
    /// error falling as `1/√n` (each block at most to the cap); +∞ when a block cannot be
    /// measured and there is no cap; 0 without a target.
    pub remaining: f32,
}

/// The floor `ε` of the mean in the relative error for an exposure of `ev` stops (scene-linear
/// light).
pub fn floor_for(ev: f32) -> f32 {
    EPSILON / exposure(ev)
}

/// The relative error of the mean of one pixel: the sums `r g b` of its premultiplied radiance
/// over `n` samples and the sum `lum2` of their squared luminance. [`UNMEASURED`] for fewer than
/// two samples or non-finite sums.
#[inline]
pub fn pixel_error(r: f32, g: f32, b: f32, lum2: f32, n: u32, floor: f32) -> f32 {
    if n < 2 {
        return UNMEASURED;
    }
    let nf = n as f32;
    let inv = 1.0 / nf;
    let l = 0.2126 * (r * inv) + 0.7152 * (g * inv) + 0.0722 * (b * inv);
    let m2 = lum2 * inv;
    if !(l.is_finite() && m2.is_finite()) {
        return UNMEASURED;
    }
    let d = m2 - l * l;
    let spread = if d > 0.0 { d } else { 0.0 };
    let var = spread / (nf - 1.0);
    let mean = if l > 0.0 { l } else { 0.0 };
    let e = var.sqrt() / (mean + floor);
    if e.is_finite() && e < UNMEASURED {
        e
    } else {
        UNMEASURED
    }
}

/// The blocks of a `width × height` image: columns and rows.
pub fn block_grid(width: u32, height: u32) -> (u32, u32) {
    (width.div_ceil(BLOCK), height.div_ceil(BLOCK))
}

/// Decides the next round from the image (the module's steps 1 to 5): `counts` the samples of
/// every block (row by row, [`block_grid`]), `sums` the radiance sums of every pixel (`stride`
/// floats per pixel, red green blue first: 3 for a film's, 4 for RGBA sums), `lum2` the sums of
/// the squared luminance (`Film::lum2`), `floor` the floor of the mean ([`floor_for`]), `target`
/// the noise threshold (0: none), `cap` the most samples a pixel may have (0: none). Writes the
/// blocks of the next round into `active` and returns what it found.
///
/// # Panics
///
/// When the slices are shorter than the image says.
#[allow(clippy::too_many_arguments)]
pub fn decide(
    width: u32,
    height: u32,
    counts: &[u32],
    sums: &[f32],
    stride: usize,
    lum2: &[f32],
    floor: f32,
    target: f32,
    cap: u32,
    active: &mut [bool],
) -> Decision {
    let (w, h) = (width as usize, height as usize);
    let (cols, rows) = block_grid(width, height);
    let (cols, rows) = (cols as usize, rows as usize);
    let blocks = cols * rows;
    let block_of = |x: usize, y: usize| (y / BLOCK as usize) * cols + x / BLOCK as usize;
    // 1. The error of every pixel.
    let mut error = vec![0.0f32; w * h];
    for y in 0..h {
        for x in 0..w {
            let p = y * w + x;
            let i = p * stride;
            error[p] = pixel_error(
                sums[i],
                sums[i + 1],
                sums[i + 2],
                lum2[p],
                counts[block_of(x, y)],
                floor,
            );
        }
    }
    // 2 and 3. Smoothed 3 × 3, and the largest per block.
    let mut block_error = vec![0.0f32; blocks];
    for y in 0..h {
        let (y0, y1) = (y.saturating_sub(1), (y + 2).min(h));
        for x in 0..w {
            let (x0, x1) = (x.saturating_sub(1), (x + 2).min(w));
            let mut sum = 0.0f32;
            for ny in y0..y1 {
                for nx in x0..x1 {
                    sum += error[ny * w + nx];
                }
            }
            let s = sum / ((y1 - y0) * (x1 - x0)) as f32;
            let b = block_of(x, y);
            if s > block_error[b] {
                block_error[b] = s;
            }
        }
    }
    // 4. The candidates, the threshold of the moment, the blocks of the next round.
    let floor_target = if target > 0.0 { target } else { 0.0 };
    let candidate = |b: usize| block_error[b] > floor_target && (cap == 0 || counts[b] < cap);
    let mut errors: Vec<f32> = (0..blocks)
        .filter(|&b| candidate(b))
        .map(|b| block_error[b])
        .collect();
    let mut max_error = 0.0f32;
    for &e in &block_error {
        if e > max_error {
            max_error = e;
        }
    }
    // What is still needed to reach the target (for a time estimate only).
    let mut remaining = 0.0f32;
    if floor_target > 0.0 {
        for b in 0..blocks {
            if !candidate(b) {
                continue;
            }
            let ratio = block_error[b] / floor_target;
            let n = counts[b] as f32;
            let mut need = n * (ratio * ratio - 1.0);
            if cap > 0 {
                let room = (cap - counts[b]) as f32;
                if need > room {
                    need = room;
                }
            }
            let (bx, by) = (b % cols, b / cols);
            let bw = (w - bx * BLOCK as usize).min(BLOCK as usize);
            let bh = (h - by * BLOCK as usize).min(BLOCK as usize);
            remaining += need * (bw * bh) as f32;
        }
    }
    for a in active.iter_mut() {
        *a = false;
    }
    if errors.is_empty() {
        return Decision {
            round: 0,
            active: 0,
            blocks: blocks as u32,
            threshold: 0.0,
            max_error,
            remaining,
        };
    }
    errors.sort_unstable_by(f32::total_cmp);
    let threshold = errors[(errors.len() - 1) / 2];
    let mut count = 0u32;
    let mut least = u32::MAX;
    for b in 0..blocks {
        if candidate(b) && block_error[b] >= threshold {
            active[b] = true;
            count += 1;
            least = least.min(counts[b]);
        }
    }
    // 5. The size of the next round.
    let factor = (blocks as u32 / (4 * count)).clamp(1, MAX_ROUND_FACTOR);
    let round = (ROUND * factor).min(least.max(ROUND));
    Decision {
        round,
        active: count,
        blocks: blocks as u32,
        threshold,
        max_error,
        remaining,
    }
}

/// The sum of `n` samples as a sum of `s` (the hosts' frames of an adaptive image, where pixels
/// have different counts and a frame has one, `s`): the sum itself when `n == s`, else
/// `(sum × (1/n)) × s` in `f32`; 0 for a pixel without samples.
#[inline]
pub fn rescale(sum: f32, n: f32, s: f32) -> f32 {
    if n == s {
        sum
    } else if n > 0.0 {
        sum * (1.0 / n) * s
    } else {
        0.0
    }
}

/// The film with every pixel's sums rescaled to `samples` samples ([`rescale`]): radiance,
/// coverage and squared luminance, the weight `samples` everywhere. A pixel that has `samples`
/// keeps its bits.
pub fn rescale_film(film: &Film, samples: u32) -> Film {
    let s = samples as f32;
    let mut out = film.clone();
    for (p, w) in out.weight.iter_mut().enumerate() {
        let n = *w;
        for c in &mut out.rgb[p * 3..p * 3 + 3] {
            *c = rescale(*c, n, s);
        }
        out.alpha[p] = rescale(out.alpha[p], n, s);
        out.lum2[p] = rescale(out.lum2[p], n, s);
        *w = s;
    }
    out
}

/// Copies a tile film's radiance sums (3 per pixel) and squared-luminance sums into whole-image
/// planes of a `width`-pixel-wide image (what [`decide`] reads).
pub fn gather(film: &Film, width: u32, sums: &mut [f32], lum2: &mut [f32]) {
    let w = width as usize;
    for ly in 0..film.height as usize {
        let row = (film.origin_y as usize + ly) * w + film.origin_x as usize;
        let j = ly * film.width as usize;
        let n = film.width as usize;
        sums[row * 3..(row + n) * 3].copy_from_slice(&film.rgb[j * 3..(j + n) * 3]);
        lum2[row..row + n].copy_from_slice(&film.lum2[j..j + n]);
    }
}

/// The samples of a pass in one block: the pixels `rect` (the block clipped to the tile and the
/// image), sample indices `first .. first + count`, the `j`-th of them with the pass's photon map
/// `j` ([`Adaptive::iteration`] + `j`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct BlockWork {
    /// The pixels.
    pub rect: TileRect,
    /// The sample index of the block's first sample in the pass.
    pub first: u32,
    /// Its samples in the pass (at most the pass's).
    pub count: u32,
}

/// An adaptive render's state: the samples of every block, the round under way and what the last
/// decision said. Hosts render [`Adaptive::work`] in passes, [`Adaptive::advance`] after each,
/// and [`Adaptive::decide`] when the round is over ([`Adaptive::left`] is 0).
#[derive(Clone, Debug, PartialEq)]
pub struct Adaptive {
    width: u32,
    height: u32,
    cols: u32,
    rows: u32,
    /// Samples of every block at the start of the round.
    counts: Vec<u32>,
    /// The blocks of the round.
    active: Vec<bool>,
    /// Samples of the round per active block (before the cap); 0 once converged.
    round: u32,
    /// Samples of the round rendered so far.
    done: u32,
    /// The photon-map iteration of the round's first sample: the samples of a block active in
    /// every round so far.
    iteration: u32,
    cap: u32,
    target: f32,
    floor: f32,
    last: Option<Decision>,
}

impl Adaptive {
    /// True when `settings` ask for adaptive sampling (`RNDR.adaptive` bit 0).
    pub fn enabled(settings: &RenderSettings) -> bool {
        settings.adaptive & ADAPTIVE_ON != 0
    }

    /// The state of a new render of `settings` (its size, exposure and noise target) with at most
    /// `cap` samples per pixel (0: none): the first round, [`WARMUP`] samples (at most `cap`) for
    /// every block.
    pub fn new(settings: &RenderSettings, cap: u32) -> Adaptive {
        let (cols, rows) = block_grid(settings.width, settings.height);
        let blocks = (cols * rows) as usize;
        Adaptive {
            width: settings.width,
            height: settings.height,
            cols,
            rows,
            counts: vec![0; blocks],
            active: vec![true; blocks],
            round: if cap > 0 { WARMUP.min(cap) } else { WARMUP },
            done: 0,
            iteration: 0,
            cap,
            target: settings.noise_threshold.max(0.0),
            floor: floor_for(settings.exposure_ev),
            last: None,
        }
    }

    /// The first round (every block, each sample's index its photon-map iteration: the plain
    /// tile renderer gives the same pixels).
    pub fn warming_up(&self) -> bool {
        self.last.is_none()
    }

    /// Samples of the round still to render (0: the round is over, [`Adaptive::decide`]).
    pub fn left(&self) -> u32 {
        self.round - self.done
    }

    /// No block gets more samples: every one is under the target, at the cap, or exact.
    pub fn converged(&self) -> bool {
        self.round == 0
    }

    /// The photon-map iteration of the next sample of the round (sample `j` of the next pass uses
    /// map `iteration() + j`).
    pub fn iteration(&self) -> u32 {
        self.iteration + self.done
    }

    /// The decision that started the round under way (`None` in the first round).
    pub fn last(&self) -> Option<Decision> {
        self.last
    }

    /// Blocks of the image.
    pub fn blocks(&self) -> usize {
        self.counts.len()
    }

    /// The block of image pixel `(x, y)`.
    #[inline]
    pub fn block_of(&self, x: u32, y: u32) -> usize {
        ((y / BLOCK) * self.cols + x / BLOCK) as usize
    }

    /// Samples block `b` gets in the round.
    #[inline]
    pub fn quota(&self, b: usize) -> u32 {
        if !self.active[b] {
            0
        } else if self.cap > 0 {
            self.round.min(self.cap.saturating_sub(self.counts[b]))
        } else {
            self.round
        }
    }

    /// Samples block `b` has in the image now.
    #[inline]
    pub fn samples_of(&self, b: usize) -> u32 {
        self.counts[b] + self.quota(b).min(self.done)
    }

    /// The fewest and the most samples of a pixel now.
    pub fn min_max(&self) -> (u32, u32) {
        let (mut lo, mut hi) = (u32::MAX, 0);
        for b in 0..self.counts.len() {
            let n = self.samples_of(b);
            lo = lo.min(n);
            hi = hi.max(n);
        }
        if lo == u32::MAX {
            (0, 0)
        } else {
            (lo, hi)
        }
    }

    /// Each pixel's samples now, as `f32` (the denoiser's counts), row by row.
    pub fn pixel_counts(&self) -> Vec<f32> {
        let mut out = Vec::with_capacity(self.width as usize * self.height as usize);
        for y in 0..self.height {
            for x in 0..self.width {
                out.push(self.samples_of(self.block_of(x, y)) as f32);
            }
        }
        out
    }

    /// Pixel-samples a pass of `count` samples renders (every active block's pixels times its
    /// samples in the pass): its cost.
    pub fn pass_cost(&self, count: u32) -> u64 {
        let mut total = 0u64;
        for b in 0..self.counts.len() {
            let q = self.quota(b);
            if q <= self.done {
                continue;
            }
            let (bx, by) = (b as u32 % self.cols, b as u32 / self.cols);
            let bw = (self.width - bx * BLOCK).min(BLOCK);
            let bh = (self.height - by * BLOCK).min(BLOCK);
            total += u64::from((q - self.done).min(count)) * u64::from(bw * bh);
        }
        total
    }

    /// The work of a pass of `count` samples (at most [`Adaptive::left`]) in `tile`, into `out`
    /// (cleared): every active block that overlaps it, clipped to it and to the image, with its
    /// samples of the pass.
    pub fn work(&self, tile: TileRect, count: u32, out: &mut Vec<BlockWork>) {
        out.clear();
        let x_end = tile.x.saturating_add(tile.w).min(self.width);
        let y_end = tile.y.saturating_add(tile.h).min(self.height);
        if tile.x >= x_end || tile.y >= y_end || count == 0 {
            return;
        }
        for by in tile.y / BLOCK..=(y_end - 1) / BLOCK {
            for bx in tile.x / BLOCK..=(x_end - 1) / BLOCK {
                let b = (by * self.cols + bx) as usize;
                let q = self.quota(b);
                if q <= self.done {
                    continue;
                }
                let (x0, y0) = ((bx * BLOCK).max(tile.x), (by * BLOCK).max(tile.y));
                let (x1, y1) = (((bx + 1) * BLOCK).min(x_end), ((by + 1) * BLOCK).min(y_end));
                out.push(BlockWork {
                    rect: TileRect {
                        x: x0,
                        y: y0,
                        w: x1 - x0,
                        h: y1 - y0,
                    },
                    first: self.counts[b] + self.done,
                    count: (q - self.done).min(count),
                });
            }
        }
    }

    /// A pass of `count` samples of the round was rendered (in every tile).
    pub fn advance(&mut self, count: u32) {
        self.done = (self.done + count).min(self.round);
    }

    /// The round is over: its samples are counted, the photon-map iteration moves past it, and
    /// the image (`sums` with `stride` floats per pixel and `lum2`, whole-image planes) decides
    /// the next round ([`decide`]). Returns the decision.
    ///
    /// # Panics
    ///
    /// When the round is not over, or the planes are shorter than the image.
    pub fn decide(&mut self, sums: &[f32], stride: usize, lum2: &[f32]) -> Decision {
        assert_eq!(self.left(), 0, "the round is not over");
        for b in 0..self.counts.len() {
            self.counts[b] += self.quota(b);
        }
        self.iteration += self.round;
        self.done = 0;
        let d = decide(
            self.width,
            self.height,
            &self.counts,
            sums,
            stride,
            lum2,
            self.floor,
            self.target,
            self.cap,
            &mut self.active,
        );
        self.round = d.round;
        self.last = Some(d);
        d
    }

    /// The samples of every block at the start of the round, row by row ([`block_grid`]).
    pub fn counts(&self) -> &[u32] {
        &self.counts
    }

    /// The blocks of the round.
    pub fn active(&self) -> &[bool] {
        &self.active
    }

    /// Columns and rows of blocks.
    pub fn grid(&self) -> (u32, u32) {
        (self.cols, self.rows)
    }
}

#[cfg(test)]
mod tests;
