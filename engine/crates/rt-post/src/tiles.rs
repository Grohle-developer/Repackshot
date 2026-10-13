//! The tiling plan (AI-POST.md §3.2 step 3): tiles of about 1024² that overlap by at least 128
//! pixels, padded to a multiple of 16 by repeating the edge, and the raised-cosine weights that
//! blend the model's tiles back into one image of exactly the job's size.

use rt_core::fmath;

/// Largest tile side the model is given (before padding).
pub const TILE_SIZE: u32 = 1024;
/// Least overlap between neighbouring tiles, pixels.
pub const TILE_OVERLAP: u32 = 128;
/// Tile sides the model is given are multiples of this.
pub const PAD_MULTIPLE: u32 = 16;

/// One tile: a rectangle of the image, and the padded size the model works at.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Tile {
    /// Left column in the image.
    pub x: u32,
    /// Top row in the image.
    pub y: u32,
    /// Columns of the image the tile covers.
    pub width: u32,
    /// Rows of the image the tile covers.
    pub height: u32,
    /// `width` rounded up to [`PAD_MULTIPLE`]: the model's input and output width.
    pub padded_width: u32,
    /// `height` rounded up to [`PAD_MULTIPLE`].
    pub padded_height: u32,
}

/// `v` rounded up to a multiple of `m`.
pub(crate) fn round_up(v: u32, m: u32) -> u32 {
    v.div_ceil(m) * m
}

/// Tile origins and the common tile length along one axis of `len` pixels.
pub(crate) fn axis(len: u32) -> (Vec<u32>, u32) {
    if len <= TILE_SIZE {
        return (vec![0], len);
    }
    let step = TILE_SIZE - TILE_OVERLAP;
    let n = (len - TILE_OVERLAP).div_ceil(step);
    // The shortest common length that covers `len` with `n` tiles overlapping by TILE_OVERLAP,
    // rounded up to the padding multiple (still at most TILE_SIZE, which is a multiple of it).
    let size = round_up((len + (n - 1) * TILE_OVERLAP).div_ceil(n), PAD_MULTIPLE);
    let span = len - size;
    let origins = (0..n)
        .map(|i| (u64::from(i) * u64::from(span) / u64::from(n - 1)) as u32)
        .collect();
    (origins, size)
}

/// Every tile of a `width` x `height` image, row by row.
pub(crate) fn plan_tiles(width: u32, height: u32) -> Vec<Tile> {
    let (xs, tw) = axis(width);
    let (ys, th) = axis(height);
    let mut tiles = Vec::with_capacity(xs.len() * ys.len());
    for &y in &ys {
        for &x in &xs {
            tiles.push(Tile {
                x,
                y,
                width: tw,
                height: th,
                padded_width: round_up(tw, PAD_MULTIPLE),
                padded_height: round_up(th, PAD_MULTIPLE),
            });
        }
    }
    tiles
}

/// The raised cosine from 0 at `t = 0` to 1 at `t = 1`.
#[inline]
fn ramp(t: f32) -> f32 {
    0.5 - 0.5 * fmath::cos(fmath::PI * t.clamp(0.0, 1.0))
}

/// Blend weights along one axis for the tile starting at `origins[i]` with length `size`: 1 inside,
/// a raised cosine over each overlap with a neighbour (so two neighbours' weights sum to one).
pub(crate) fn axis_weights(origins: &[u32], size: u32, i: usize) -> Vec<f32> {
    let o = origins[i];
    let mut w = vec![1.0f32; size as usize];
    if i > 0 {
        let overlap = origins[i - 1] + size - o;
        for (d, v) in w.iter_mut().enumerate().take(overlap as usize) {
            *v *= ramp((d as f32 + 0.5) / overlap as f32);
        }
    }
    if i + 1 < origins.len() {
        let overlap = o + size - origins[i + 1];
        for d in 0..overlap.min(size) {
            let v = &mut w[(size - 1 - d) as usize];
            *v *= ramp((d as f32 + 0.5) / overlap as f32);
        }
    }
    w
}

/// Copies the `tile` rectangle of a full-size plane with `channels` values a pixel and pads it to
/// the tile's padded size by repeating the last column and row.
pub(crate) fn crop_pad<T: Copy>(src: &[T], width: u32, channels: usize, tile: &Tile) -> Vec<T> {
    let (pw, ph) = (tile.padded_width as usize, tile.padded_height as usize);
    let mut out = Vec::with_capacity(pw * ph * channels);
    for j in 0..ph {
        let y = tile.y as usize + j.min(tile.height as usize - 1);
        for i in 0..pw {
            let x = tile.x as usize + i.min(tile.width as usize - 1);
            let at = (y * width as usize + x) * channels;
            out.extend_from_slice(&src[at..at + channels]);
        }
    }
    out
}

/// The model's tiles (display-linear RGB, each `padded_width * padded_height * 3`) blended into
/// one `width * height * 3` image with the raised-cosine weights. Where tiles agree the result is
/// exactly their value: the blend adds weighted differences to the first tile's value.
pub(crate) fn blend(width: u32, height: u32, tiles: &[Tile], images: &[Vec<f32>]) -> Vec<f32> {
    let n = width as usize * height as usize;
    let (xs, tw) = axis(width);
    let (ys, th) = axis(height);
    let wx: Vec<Vec<f32>> = (0..xs.len()).map(|i| axis_weights(&xs, tw, i)).collect();
    let wy: Vec<Vec<f32>> = (0..ys.len()).map(|j| axis_weights(&ys, th, j)).collect();
    let mut first = vec![f32::NAN; n * 3];
    let mut acc = vec![0.0f32; n * 3];
    let mut weight = vec![0.0f32; n];
    // Pass 1: the first tile to reach a pixel gives its base value; pass 2 the weighted deltas.
    for (k, tile) in tiles.iter().enumerate() {
        let img = &images[k];
        for j in 0..tile.height as usize {
            let y = tile.y as usize + j;
            for i in 0..tile.width as usize {
                let p = y * width as usize + tile.x as usize + i;
                if first[p * 3].is_nan() {
                    let s = (j * tile.padded_width as usize + i) * 3;
                    first[p * 3..p * 3 + 3].copy_from_slice(&img[s..s + 3]);
                }
            }
        }
    }
    for (k, tile) in tiles.iter().enumerate() {
        let img = &images[k];
        let (ix, iy) = (k % xs.len(), k / xs.len());
        for (j, &weight_y) in wy[iy].iter().enumerate().take(tile.height as usize) {
            let y = tile.y as usize + j;
            for (i, &weight_x) in wx[ix].iter().enumerate().take(tile.width as usize) {
                let p = y * width as usize + tile.x as usize + i;
                let w = weight_x * weight_y;
                weight[p] += w;
                let s = (j * tile.padded_width as usize + i) * 3;
                for c in 0..3 {
                    acc[p * 3 + c] += w * (img[s + c] - first[p * 3 + c]);
                }
            }
        }
    }
    for p in 0..n {
        let w = weight[p];
        for c in 0..3 {
            let d = acc[p * 3 + c];
            if d != 0.0 && w > 0.0 {
                first[p * 3 + c] += d / w;
            }
        }
    }
    first
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn small_images_are_one_padded_tile() {
        assert_eq!(
            plan_tiles(300, 200),
            vec![Tile {
                x: 0,
                y: 0,
                width: 300,
                height: 200,
                padded_width: 304,
                padded_height: 208,
            }]
        );
        let t = plan_tiles(1024, 16)[0];
        assert_eq!((t.padded_width, t.padded_height), (1024, 16));
        let t = plan_tiles(1, 1)[0];
        assert_eq!((t.padded_width, t.padded_height), (16, 16));
    }

    #[test]
    fn large_images_are_covered_by_overlapping_tiles_within_the_image() {
        for len in [1025u32, 1160, 1500, 2048, 3000, 4096, 5123, 8192, 16_384] {
            let (origins, size) = axis(len);
            assert!(size <= TILE_SIZE, "{len}: {size}");
            assert_eq!(size % PAD_MULTIPLE, 0, "{len}");
            assert_eq!(origins[0], 0);
            assert_eq!(
                *origins.last().unwrap() + size,
                len,
                "{len} ends at the edge"
            );
            for w in origins.windows(2) {
                let overlap = w[0] + size - w[1];
                assert!(overlap >= TILE_OVERLAP, "{len}: overlap {overlap}");
            }
            for w in origins.windows(3) {
                assert!(w[2] >= w[0] + size, "{len}: three tiles overlap");
            }
            // Not more tiles than needed: one fewer could not cover the axis.
            let n = origins.len() as u32;
            assert!(
                (n - 1) * (TILE_SIZE - TILE_OVERLAP) + TILE_OVERLAP < len,
                "{len}: {n}"
            );
        }
    }

    #[test]
    fn neighbouring_weights_sum_to_one() {
        let (origins, size) = axis(3000);
        let ws: Vec<Vec<f32>> = (0..origins.len())
            .map(|i| axis_weights(&origins, size, i))
            .collect();
        for p in 0..3000u32 {
            let mut sum = 0.0;
            for (i, &o) in origins.iter().enumerate() {
                if p >= o && p < o + size {
                    sum += ws[i][(p - o) as usize];
                }
            }
            assert!((sum - 1.0).abs() < 1e-5, "{p}: {sum}");
        }
        // Image borders keep full weight.
        assert_eq!(ws[0][0], 1.0);
        assert_eq!(*ws.last().unwrap().last().unwrap(), 1.0);
    }

    #[test]
    fn crop_and_pad_repeat_the_edge() {
        let src: Vec<u8> = (0..20).collect(); // 5 x 4, one channel
        let tile = Tile {
            x: 3,
            y: 2,
            width: 2,
            height: 2,
            padded_width: 3,
            padded_height: 3,
        };
        assert_eq!(
            crop_pad(&src, 5, 1, &tile),
            vec![13, 14, 14, 18, 19, 19, 18, 19, 19]
        );
    }

    #[test]
    fn blending_identical_tiles_is_exact() {
        let (w, h) = (1500u32, 40u32);
        let tiles = plan_tiles(w, h);
        assert_eq!(tiles.len(), 2);
        let value = |x: u32, y: u32, c: usize| (x * 7 + y * 3 + c as u32) as f32 / 9000.0;
        let images: Vec<Vec<f32>> = tiles
            .iter()
            .map(|t| {
                let mut v = Vec::new();
                for j in 0..t.padded_height {
                    for i in 0..t.padded_width {
                        let (x, y) = (t.x + i.min(t.width - 1), t.y + j.min(t.height - 1));
                        for c in 0..3 {
                            v.push(value(x, y, c));
                        }
                    }
                }
                v
            })
            .collect();
        let out = blend(w, h, &tiles, &images);
        for y in 0..h {
            for x in 0..w {
                for c in 0..3 {
                    assert_eq!(out[((y * w + x) * 3) as usize + c], value(x, y, c));
                }
            }
        }
        // Different tiles meet smoothly: halfway through the overlap both count half.
        let mut images2 = images.clone();
        images2[1].iter_mut().for_each(|v| *v = 1.0);
        images2[0].iter_mut().for_each(|v| *v = 0.0);
        let out = blend(w, h, &tiles, &images2);
        let (a, b) = (tiles[1].x, tiles[0].x + tiles[0].width);
        assert_eq!(out[(a as usize - 1) * 3], 0.0);
        assert_eq!(out[b as usize * 3], 1.0);
        let mid = out[(((a + b) / 2) as usize) * 3];
        assert!((mid - 0.5).abs() < 0.02, "{mid}");
        for x in a..b - 1 {
            assert!(
                out[(x as usize + 1) * 3] >= out[x as usize * 3],
                "monotone at {x}"
            );
        }
    }
}
