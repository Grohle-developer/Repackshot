//! The pixel filters (E11): where in or around its pixel a camera sample passes, and which
//! pixels of a tile get more samples (the edges).
//!
//! A filter is applied by importance sampling (filter importance sampling): the uniform position
//! in the pixel that the sampler gives ([`crate::sampler::DIM_CAMERA`]) is moved with the
//! inverse of the filter's cumulative distribution, one axis at a time (the filters are
//! separable), and the sample keeps a weight of 1 and its own pixel. So the image is still the
//! plain mean of the samples of each pixel, a tile is still independent of its neighbours, and
//! changing the filter changes only where the samples go.
//!
//! * [`FILTER_STANDARD`] (0, the default and what every scene of before means): the box of one
//!   pixel, the uniform position itself (the same bits as before E11).
//! * [`FILTER_NONE`] (1): every sample through the centre of the pixel (no jitter on the image
//!   plane): jagged edges, the cheapest.
//! * [`FILTER_TENT`] (2): a tent two pixels wide, `1 − |x|` on `[−1, 1]`: its inverse CDF is two
//!   square roots (`f32::sqrt` is correctly rounded everywhere, wasm included).
//! * [`FILTER_BLACKMAN_HARRIS`] (3): the Blackman–Harris window (F. J. Harris, "On the use of
//!   windows for harmonic analysis with the discrete Fourier transform", *Proc. IEEE* 66, 1978:
//!   `a0 − a1 cos 2πt + a2 cos 4πt − a3 cos 6πt` with 0.35875, 0.48829, 0.14128, 0.01168) three
//!   pixels wide. Its inverse CDF is tabulated in `f32` ([`BLACKMAN_HARRIS_INV_CDF`], 256 values,
//!   closer together towards the ends; made and checked by a test from the window's integral in
//!   `f64`) and interpolated linearly: no `exp`, `sin` or `cos` while rendering, the same bits on
//!   every platform.
//!
//! Unknown filter numbers are the standard one.
//!
//! **Edges** (`RNDR.edge_supersample` = `k` > 1): a pixel is an edge when one of its eight
//! neighbours (inside the image) sees another part or another material through its centre, or a
//! depth more than 2 % away ([`EdgeMask`], from the centre rays of the exact passes: the same
//! for any tile cut). In every sample index `s` an edge pixel renders `k` samples, with the
//! sample indices `s·k … s·k + k − 1` of its own sequence, and splats their mean: so every pixel
//! still holds one splat per sample index (the film's weight, the hosts' sample count, the
//! denoiser's variance of the mean all stay right) and an edge pixel ends with `k` times the
//! samples. The photon map of the caustics is the one of `s` for all of them.

use crate::integrator::{first_hit, BvhTracer, Prepared};
use crate::passes::Exact;
use crate::render::{centre_ray, TileRect};
use crate::scene::Scene;
use crate::simd::Isa;

/// The box of one pixel, uniform jitter: the default.
pub const FILTER_STANDARD: u32 = 0;
/// Every sample through the pixel's centre.
pub const FILTER_NONE: u32 = 1;
/// A tent two pixels wide.
pub const FILTER_TENT: u32 = 2;
/// Blackman–Harris three pixels wide.
pub const FILTER_BLACKMAN_HARRIS: u32 = 3;

/// The most samples an edge pixel takes per sample index (`RNDR.edge_supersample`).
pub const MAX_EDGE_SUPERSAMPLE: u32 = 16;

/// Half the width of the Blackman–Harris filter, in pixels.
pub const BLACKMAN_HARRIS_RADIUS: f32 = 1.5;

/// The inverse CDF of the Blackman–Harris window of radius [`BLACKMAN_HARRIS_RADIUS`], in pixels
/// from the centre, at `u = q(i / 255)` with `q(s) = 2s²` below one half and `1 − 2(1 − s)²`
/// above: the points are closer together towards both ends, where the window is almost zero
/// and its inverse CDF steepest (with points evenly spaced in `u` the last ones would spread a
/// sample of every 255 over the outer half pixel). The test
/// `the_blackman_harris_table_is_the_inverse_of_the_window_s_cdf` makes it and checks it.
#[rustfmt::skip]
pub const BLACKMAN_HARRIS_INV_CDF: [f32; 256] = [
    -1.5, -1.3936005, -1.3292565, -1.2808065, -1.2409095, -1.2065654, -1.17617, -1.148747,
    -1.1236522, -1.1004363, -1.0787721, -1.058413, -1.0391692, -1.0208899, -1.0034542, -0.98676306,
    -0.97073436, -0.9552992, -0.94039905, -0.9259839, -0.9120105, -0.8984412, -0.88524306, -0.8723871,
    -0.85984755, -0.8476014, -0.8356282, -0.82390934, -0.8124283, -0.80116975, -0.7901201, -0.7792667,
    -0.7685981, -0.7581036, -0.7477736, -0.737599, -0.7275716, -0.71768355, -0.7079278, -0.69829756,
    -0.6887866, -0.67938906, -0.6700995, -0.66091275, -0.65182394, -0.64282846, -0.6339221, -0.6251007,
    -0.6163604, -0.6076976, -0.59910876, -0.5905906, -0.58213997, -0.57375383, -0.5654294, -0.5571638,
    -0.5489544, -0.54079884, -0.5326946, -0.5246393, -0.5166308, -0.50866693, -0.50074553, -0.49286464,
    -0.4850223, -0.4772167, -0.4694459, -0.46170822, -0.45400187, -0.44632524, -0.43867669, -0.4310546,
    -0.4234574, -0.41588363, -0.40833178, -0.4008004, -0.39328805, -0.38579333, -0.37831485, -0.37085128,
    -0.36340126, -0.3559635, -0.34853664, -0.34111944, -0.3337106, -0.32630885, -0.3189129, -0.31152153,
    -0.3041335, -0.29674754, -0.2893624, -0.28197688, -0.2745897, -0.26719958, -0.25980532, -0.25240567,
    -0.24499933, -0.23758505, -0.23016153, -0.22272749, -0.2152816, -0.20782255, -0.20034899, -0.19285955,
    -0.18535285, -0.17782746, -0.17028196, -0.1627149, -0.15512475, -0.14751, -0.1398691, -0.13220042,
    -0.124502316, -0.116773106, -0.109011054, -0.10121437, -0.0933812, -0.08550965, -0.07759775, -0.06964346,
    -0.06164468, -0.05359922, -0.04550481, -0.037359085, -0.029159598, -0.020903783, -0.012588973, -0.0042123757,
    0.0042123757, 0.012588973, 0.020903783, 0.029159598, 0.037359085, 0.04550481, 0.05359922, 0.06164468,
    0.06964346, 0.07759775, 0.08550965, 0.0933812, 0.10121437, 0.109011054, 0.116773106, 0.124502316,
    0.13220042, 0.1398691, 0.14751, 0.15512475, 0.1627149, 0.17028196, 0.17782746, 0.18535285,
    0.19285955, 0.20034899, 0.20782255, 0.2152816, 0.22272749, 0.23016153, 0.23758505, 0.24499933,
    0.25240567, 0.25980532, 0.26719958, 0.2745897, 0.28197688, 0.2893624, 0.29674754, 0.3041335,
    0.31152153, 0.3189129, 0.32630885, 0.3337106, 0.34111944, 0.34853664, 0.3559635, 0.36340126,
    0.37085128, 0.37831485, 0.38579333, 0.39328805, 0.4008004, 0.40833178, 0.41588363, 0.4234574,
    0.4310546, 0.43867669, 0.44632524, 0.45400187, 0.46170822, 0.4694459, 0.4772167, 0.4850223,
    0.49286464, 0.50074553, 0.50866693, 0.5166308, 0.5246393, 0.5326946, 0.54079884, 0.5489544,
    0.5571638, 0.5654294, 0.57375383, 0.58213997, 0.5905906, 0.59910876, 0.6076976, 0.6163604,
    0.6251007, 0.6339221, 0.64282846, 0.65182394, 0.66091275, 0.6700995, 0.67938906, 0.6887866,
    0.69829756, 0.7079278, 0.71768355, 0.7275716, 0.737599, 0.7477736, 0.7581036, 0.7685981,
    0.7792667, 0.7901201, 0.80116975, 0.8124283, 0.82390934, 0.8356282, 0.8476014, 0.85984755,
    0.8723871, 0.88524306, 0.8984412, 0.9120105, 0.9259839, 0.94039905, 0.9552992, 0.97073436,
    0.98676306, 1.0034542, 1.0208899, 1.0391692, 1.058413, 1.0787721, 1.1004363, 1.1236522,
    1.148747, 1.17617, 1.2065654, 1.2409095, 1.2808065, 1.3292565, 1.3936005, 1.5,
];

/// Where a sample passes on one axis, in pixels from the pixel's left (or top) side, for the
/// filter `filter` and the uniform number `u` in `[0, 1)` of the sampler. The standard filter
/// gives `u` itself.
#[inline]
pub fn offset(filter: u32, u: f32) -> f32 {
    match filter {
        FILTER_NONE => 0.5,
        FILTER_TENT => 0.5 + tent(u),
        FILTER_BLACKMAN_HARRIS => 0.5 + blackman_harris(u),
        _ => u,
    }
}

/// The inverse CDF of the tent `1 − |x|` on `[−1, 1]`.
#[inline]
fn tent(u: f32) -> f32 {
    if u < 0.5 {
        (2.0 * u).sqrt() - 1.0
    } else {
        1.0 - (2.0 - 2.0 * u).sqrt()
    }
}

/// The tabulated inverse CDF of Blackman–Harris, linearly interpolated between the points
/// `s = q⁻¹(u)` of the table (`q⁻¹` is two square roots: correctly rounded everywhere).
#[inline]
fn blackman_harris(u: f32) -> f32 {
    let last = (BLACKMAN_HARRIS_INV_CDF.len() - 1) as f32;
    let s = table_point(u);
    let f = (s * last).clamp(0.0, last);
    let i = (f as usize).min(BLACKMAN_HARRIS_INV_CDF.len() - 2);
    let t = f - i as f32;
    let (a, b) = (BLACKMAN_HARRIS_INV_CDF[i], BLACKMAN_HARRIS_INV_CDF[i + 1]);
    a + (b - a) * t
}

/// Where `u` falls among the points of [`BLACKMAN_HARRIS_INV_CDF`]: the inverse of
/// `q(s) = 2s²` (below one half) and `1 − 2(1 − s)²` (above).
#[inline]
pub fn table_point(u: f32) -> f32 {
    if u < 0.5 {
        (0.5 * u).sqrt()
    } else {
        1.0 - (0.5 - 0.5 * u).sqrt()
    }
}

/// Which pixels of a tile are edges, and how many samples per sample index they take (see the
/// module's documentation). Hosts make one per tile and keep it while the scene does not change.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EdgeMask {
    tile: TileRect,
    factor: u32,
    /// The width of `tile` clipped to the image (0 when `factor` is 1).
    width: u32,
    /// One per pixel of `tile` (clipped to the image), rows from the top; empty when `factor` is 1.
    edge: Vec<bool>,
    /// The centre rays cast to find the edges.
    rays: u64,
}

impl EdgeMask {
    /// No edges: every pixel takes one sample per sample index.
    pub fn none(tile: TileRect) -> EdgeMask {
        EdgeMask {
            tile,
            factor: 1,
            width: 0,
            edge: Vec::new(),
            rays: 0,
        }
    }

    /// The edges of `tile` (clipped to the image) for `scene.render.edge_supersample`, from the
    /// centre rays of the tile and of a one-pixel ring around it (inside the image). Casts no ray
    /// when the scene asks for no edge samples.
    pub fn of(scene: &Scene, prepared: &Prepared, tile: TileRect, isa: Isa) -> EdgeMask {
        let factor = scene.render.edge_factor();
        let (width, height) = (scene.render.width, scene.render.height);
        let x_end = tile.x.saturating_add(tile.w).min(width);
        let y_end = tile.y.saturating_add(tile.h).min(height);
        if factor <= 1 || tile.x >= x_end || tile.y >= y_end {
            return EdgeMask::none(tile);
        }
        let tracer = BvhTracer {
            geometry: &scene.geometry,
            isa,
        };
        // The centre rays of the tile and its ring.
        let (rx, ry) = (tile.x.saturating_sub(1), tile.y.saturating_sub(1));
        let (rx_end, ry_end) = ((x_end + 1).min(width), (y_end + 1).min(height));
        let rw = (rx_end - rx) as usize;
        let mut ring = Vec::with_capacity(rw * (ry_end - ry) as usize);
        for y in ry..ry_end {
            for x in rx..rx_end {
                let ray = centre_ray(scene, x, y);
                ring.push(Exact::of(
                    scene,
                    &ray,
                    first_hit(scene, prepared, &tracer, &ray),
                ));
            }
        }
        let at = |x: u32, y: u32| &ring[(y - ry) as usize * rw + (x - rx) as usize];
        let mut edge = Vec::with_capacity(((x_end - tile.x) * (y_end - tile.y)) as usize);
        for y in tile.y..y_end {
            for x in tile.x..x_end {
                let c = at(x, y);
                let mut is_edge = false;
                for ny in y.saturating_sub(1)..(y + 2).min(height) {
                    for nx in x.saturating_sub(1)..(x + 2).min(width) {
                        is_edge |= differs(c, at(nx, ny));
                    }
                }
                edge.push(is_edge);
            }
        }
        EdgeMask {
            tile,
            factor,
            width: x_end - tile.x,
            edge,
            rays: ring.len() as u64,
        }
    }

    /// The tile it was made for.
    pub fn tile(&self) -> TileRect {
        self.tile
    }

    /// The samples pixel `(x, y)` takes per sample index: the factor on an edge, 1 elsewhere
    /// (and outside the tile).
    #[inline]
    pub fn factor_at(&self, x: u32, y: u32) -> u32 {
        if self.factor <= 1 || x < self.tile.x || y < self.tile.y {
            return 1;
        }
        let (dx, dy) = (x - self.tile.x, y - self.tile.y);
        if dx >= self.width {
            return 1;
        }
        match self
            .edge
            .get(dy as usize * self.width as usize + dx as usize)
        {
            Some(true) => self.factor,
            _ => 1,
        }
    }

    /// The centre rays cast to find the edges (0 without edge samples).
    pub fn rays(&self) -> u64 {
        self.rays
    }

    /// The edge pixels of the tile.
    pub fn edges(&self) -> usize {
        self.edge.iter().filter(|&&e| e).count()
    }
}

/// True when two neighbours' centre rays see different things: another part, another material,
/// or a depth more than 2 % away (two background pixels never differ).
fn differs(a: &Exact, b: &Exact) -> bool {
    a.part_id != b.part_id
        || a.material_id != b.material_id
        || (a.depth - b.depth).abs() > 0.02 * a.depth.min(b.depth)
}

#[cfg(test)]
mod tests;
