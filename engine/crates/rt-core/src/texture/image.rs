//! A texture image of the `IMGS` section and its mipmaps, and how it is read.
//!
//! The page decodes the PNG or JPEG and sends 8-bit rows from the top, 1 (grey), 3 (RGB) or 4
//! (RGBA, straight alpha) bytes per pixel, sRGB (colour: decoded to linear by a table) or linear
//! (data). The engine keeps them as bytes and computes the **mipmaps** when the scene is read:
//! each level is half the one before (rounded down, at least 1), every texel the box average of
//! the texels of the level before that it covers (fractional weights when a side is odd), in
//! linear values, stored back as bytes in the image's own encoding (sRGB by the nearest entry of
//! the decoding table). The alpha is averaged straight, as a GPU builds the Fast preview's.
//!
//! **Reading** ([`TextureImage::bilinear`]) is the M3a `TEX` contract (ARCHITECTURE §5.2 quater)
//! on any level: each coordinate is brought back by the wrap (repeat `u − ⌊u⌋`, clamp
//! `clamp01(u)`, mirror `u − 2⌊u/2⌋`; not finite: 0), `v` is read upside down (rows from the top),
//! `x = u·w − ½`, the four texels around it are taken with the wrap (repeat modulo, clamp to the
//! edge, mirror of period `2w`), decoded, and blended along x and then y. [`TextureImage::sample`]
//! blends the two levels around a level of detail (trilinear); [`TextureImage::lod`] is that
//! level for the derivatives of the coordinates across the footprint: `log2` of the larger of the
//! two footprint axes in texels of level 0, as a GPU's isotropic filter chooses it.

use super::{CHANNEL_LUMINANCE, WRAP_CLAMP, WRAP_MIRROR};
use crate::fmath;
use std::fmt;

/// `IMGS` colour space 0: sRGB (colour; decoded to linear).
pub const COLOR_SRGB: u32 = 0;
/// `IMGS` colour space 1: linear (data, and alpha always).
pub const COLOR_LINEAR: u32 = 1;
/// Longest side accepted.
pub const MAX_SIDE: u32 = 16_384;

/// `byte / 255` for every byte (data channels and alpha).
fn unit_table() -> &'static [f32; 256] {
    use std::sync::OnceLock;
    static TABLE: OnceLock<[f32; 256]> = OnceLock::new();
    TABLE.get_or_init(|| {
        let mut t = [0.0f32; 256];
        for (i, v) in t.iter_mut().enumerate() {
            *v = i as f32 / 255.0;
        }
        t
    })
}

/// One level of the pyramid: its size and its bytes (the image's channels per texel).
#[derive(Clone, PartialEq)]
struct Level {
    width: u32,
    height: u32,
    data: Vec<u8>,
}

/// A texture image and its mipmaps.
#[derive(Clone, PartialEq)]
pub struct TextureImage {
    channels: u32,
    color_space: u32,
    levels: Vec<Level>,
}

impl fmt::Debug for TextureImage {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("TextureImage")
            .field("width", &self.width())
            .field("height", &self.height())
            .field("channels", &self.channels)
            .field("color_space", &self.color_space)
            .field("levels", &self.levels.len())
            .finish()
    }
}

impl TextureImage {
    /// An image of `width × height` pixels of `channels` bytes (1, 3 or 4), rows from the top, in
    /// `color_space` ([`COLOR_SRGB`] or [`COLOR_LINEAR`]); its mipmaps are computed here.
    pub fn new(
        width: u32,
        height: u32,
        channels: u32,
        color_space: u32,
        data: Vec<u8>,
    ) -> Result<TextureImage, &'static str> {
        if !matches!(channels, 1 | 3 | 4) {
            return Err("an image has 1, 3 or 4 channels");
        }
        if color_space > COLOR_LINEAR {
            return Err("unknown image colour space");
        }
        if width == 0 || height == 0 || width > MAX_SIDE || height > MAX_SIDE {
            return Err("image sides must be between 1 and 16384");
        }
        if data.len() as u64 != u64::from(width) * u64::from(height) * u64::from(channels) {
            return Err("image size does not match its data");
        }
        let mut image = TextureImage {
            channels,
            color_space,
            levels: vec![Level {
                width,
                height,
                data,
            }],
        };
        while let Some(next) = image.reduce(image.levels.len() - 1) {
            image.levels.push(next);
        }
        Ok(image)
    }

    /// Width of level 0.
    pub fn width(&self) -> u32 {
        self.levels[0].width
    }

    /// Height of level 0.
    pub fn height(&self) -> u32 {
        self.levels[0].height
    }

    /// Bytes per pixel (1, 3 or 4).
    pub fn channels(&self) -> u32 {
        self.channels
    }

    /// [`COLOR_SRGB`] or [`COLOR_LINEAR`].
    pub fn color_space(&self) -> u32 {
        self.color_space
    }

    /// The pixels as the file sent them (level 0).
    pub fn pixels(&self) -> &[u8] {
        &self.levels[0].data
    }

    /// Number of levels (1 for a 1 × 1 image).
    pub fn level_count(&self) -> usize {
        self.levels.len()
    }

    /// The size of level `level` (`None` past the last).
    pub fn level_size(&self, level: usize) -> Option<(u32, u32)> {
        self.levels.get(level).map(|l| (l.width, l.height))
    }

    /// Width over height.
    pub fn aspect(&self) -> f32 {
        self.width() as f32 / self.height() as f32
    }

    /// The texel `(x, y)` of `level` (inside it), decoded: linear RGBA (grey: the three the same;
    /// without alpha, 1).
    #[inline]
    pub fn texel(&self, level: usize, x: u32, y: u32) -> [f32; 4] {
        let l = &self.levels[level.min(self.levels.len() - 1)];
        let x = x.min(l.width - 1) as usize;
        let y = y.min(l.height - 1) as usize;
        let c = self.channels as usize;
        let at = (y * l.width as usize + x) * c;
        let unit = unit_table();
        let colour = if self.color_space == COLOR_SRGB {
            crate::bitmap::srgb_table()
        } else {
            unit
        };
        match c {
            1 => {
                let g = colour[l.data[at] as usize];
                [g, g, g, 1.0]
            }
            3 => [
                colour[l.data[at] as usize],
                colour[l.data[at + 1] as usize],
                colour[l.data[at + 2] as usize],
                1.0,
            ],
            _ => [
                colour[l.data[at] as usize],
                colour[l.data[at + 1] as usize],
                colour[l.data[at + 2] as usize],
                unit[l.data[at + 3] as usize],
            ],
        }
    }

    /// Bilinear reading of `level` at `(u, v)` (v up) with the wrap `wrap` (the M3a `TEX`
    /// formula, on any level).
    pub fn bilinear(&self, level: usize, u: f32, v: f32, wrap: u32) -> [f32; 4] {
        let level = level.min(self.levels.len() - 1);
        let (w, h) = (self.levels[level].width, self.levels[level].height);
        let ru = reduce(u, wrap);
        let rv = reduce(1.0 - v, wrap);
        let x = ru * w as f32 - 0.5;
        let y = rv * h as f32 - 0.5;
        let x0 = x.floor();
        let y0 = y.floor();
        let fx = x - x0;
        let fy = y - y0;
        let (x0, y0) = (x0 as i64, y0 as i64);
        let i0 = wrap_index(x0, w, wrap);
        let i1 = wrap_index(x0 + 1, w, wrap);
        let j0 = wrap_index(y0, h, wrap);
        let j1 = wrap_index(y0 + 1, h, wrap);
        let a = self.texel(level, i0, j0);
        let b = self.texel(level, i1, j0);
        let c = self.texel(level, i0, j1);
        let d = self.texel(level, i1, j1);
        let mut out = [0.0f32; 4];
        for k in 0..4 {
            let top = lerp(a[k], b[k], fx);
            let bottom = lerp(c[k], d[k], fx);
            out[k] = lerp(top, bottom, fy);
        }
        out
    }

    /// The image at `(u, v)` for the level of detail `lod` (≤ 0: level 0, bilinear; between two
    /// levels: both, blended; past the last: the last).
    pub fn sample(&self, u: f32, v: f32, lod: f32, wrap: u32) -> [f32; 4] {
        if lod.is_nan() || lod <= 0.0 || self.levels.len() == 1 {
            return self.bilinear(0, u, v, wrap);
        }
        let last = (self.levels.len() - 1) as f32;
        if lod >= last {
            return self.bilinear(self.levels.len() - 1, u, v, wrap);
        }
        let l0 = lod.floor();
        let t = lod - l0;
        let l0 = l0 as usize;
        let a = self.bilinear(l0, u, v, wrap);
        if t <= 0.0 {
            return a;
        }
        let b = self.bilinear(l0 + 1, u, v, wrap);
        [
            lerp(a[0], b[0], t),
            lerp(a[1], b[1], t),
            lerp(a[2], b[2], t),
            lerp(a[3], b[3], t),
        ]
    }

    /// The level of detail for coordinates that change by `dx` and `dy` (in u, v) across the two
    /// axes of the footprint: `log2` of the longer axis in texels of level 0 (0 when it is a
    /// texel or less; the last level for an infinite one).
    pub fn lod(&self, dx: (f32, f32), dy: (f32, f32)) -> f32 {
        let (w, h) = (self.width() as f32, self.height() as f32);
        let a = (dx.0 * w) * (dx.0 * w) + (dx.1 * h) * (dx.1 * h);
        let b = (dy.0 * w) * (dy.0 * w) + (dy.1 * h) * (dy.1 * h);
        let rho2 = if b > a { b } else { a };
        if rho2.is_nan() || rho2 <= 1.0 {
            return 0.0;
        }
        if !rho2.is_finite() {
            return (self.levels.len() - 1) as f32;
        }
        0.5 * fmath::log2(rho2)
    }

    /// The scalar a slot reads from a decoded texel: channel 0 to 3, or the Rec. 709 luminance.
    #[inline]
    pub fn channel_of(texel: [f32; 4], channel: u32) -> f32 {
        if channel >= CHANNEL_LUMINANCE {
            (texel[0] * 0.2126 + texel[1] * 0.7152) + texel[2] * 0.0722
        } else {
            texel[channel as usize]
        }
    }

    /// The level after `level`, or `None` when it is 1 × 1.
    fn reduce(&self, level: usize) -> Option<Level> {
        let src = &self.levels[level];
        if src.width == 1 && src.height == 1 {
            return None;
        }
        let width = (src.width / 2).max(1);
        let height = (src.height / 2).max(1);
        let c = self.channels as usize;
        let sx = src.width as f32 / width as f32;
        let sy = src.height as f32 / height as f32;
        let unit = unit_table();
        let srgb = crate::bitmap::srgb_table();
        let colour = if self.color_space == COLOR_SRGB {
            srgb
        } else {
            unit
        };
        let alpha_channel = if c == 4 { Some(3) } else { None };
        let mut data = vec![0u8; width as usize * height as usize * c];
        // The source texels each destination texel covers, with their coverage along one axis.
        let spans = |count: u32, scale: f32, limit: u32| -> Vec<Vec<(u32, f32)>> {
            (0..count)
                .map(|i| {
                    let start = i as f32 * scale;
                    let end = (i + 1) as f32 * scale;
                    let mut out = Vec::new();
                    let mut k = start.floor() as u32;
                    while (k as f32) < end && k < limit {
                        let lo = if (k as f32) > start { k as f32 } else { start };
                        let hi = if ((k + 1) as f32) < end {
                            (k + 1) as f32
                        } else {
                            end
                        };
                        let w = hi - lo;
                        if w > 0.0 {
                            out.push((k, w));
                        }
                        k += 1;
                    }
                    out
                })
                .collect()
        };
        let xs = spans(width, sx, src.width);
        let ys = spans(height, sy, src.height);
        let row = src.width as usize * c;
        for (j, ylist) in ys.iter().enumerate() {
            for (i, xlist) in xs.iter().enumerate() {
                let mut sum = [0.0f32; 4];
                let mut total = 0.0f32;
                for &(y, wy) in ylist {
                    for &(x, wx) in xlist {
                        let w = wx * wy;
                        let at = y as usize * row + x as usize * c;
                        for (k, s) in sum.iter_mut().enumerate().take(c) {
                            let table = if Some(k) == alpha_channel {
                                unit
                            } else {
                                colour
                            };
                            *s += table[src.data[at + k] as usize] * w;
                        }
                        total += w;
                    }
                }
                let out = (j * width as usize + i) * c;
                for k in 0..c {
                    let mean = if total > 0.0 { sum[k] / total } else { 0.0 };
                    data[out + k] = if Some(k) == alpha_channel || self.color_space != COLOR_SRGB {
                        encode_unit(mean)
                    } else {
                        encode_srgb(mean, srgb)
                    };
                }
            }
        }
        Some(Level {
            width,
            height,
            data,
        })
    }
}

/// `a + t·(b − a)`.
#[inline]
fn lerp(a: f32, b: f32, t: f32) -> f32 {
    a + t * (b - a)
}

/// A coordinate brought back into the image by the wrap (not finite: 0).
#[inline]
pub fn reduce(u: f32, wrap: u32) -> f32 {
    if !u.is_finite() {
        return 0.0;
    }
    match wrap {
        WRAP_CLAMP => u.clamp(0.0, 1.0),
        WRAP_MIRROR => u - 2.0 * (u * 0.5).floor(),
        _ => u - u.floor(),
    }
}

/// A texel index brought inside `0..n` by the wrap.
#[inline]
fn wrap_index(i: i64, n: u32, wrap: u32) -> u32 {
    let n = i64::from(n);
    match wrap {
        WRAP_CLAMP => i.clamp(0, n - 1) as u32,
        WRAP_MIRROR => {
            let m = i.rem_euclid(2 * n);
            (if m < n { m } else { 2 * n - 1 - m }) as u32
        }
        _ => i.rem_euclid(n) as u32,
    }
}

/// A linear value as the byte nearest `v · 255`.
#[inline]
fn encode_unit(v: f32) -> u8 {
    (v * 255.0 + 0.5).floor().clamp(0.0, 255.0) as u8
}

/// A linear value as the sRGB byte whose decoding is nearest (ties to the lower byte).
fn encode_srgb(v: f32, table: &[f32; 256]) -> u8 {
    let above = table.partition_point(|&t| t < v);
    if above == 0 {
        return 0;
    }
    if above >= 256 {
        return 255;
    }
    let (lo, hi) = (table[above - 1], table[above]);
    if hi - v < v - lo {
        above as u8
    } else {
        (above - 1) as u8
    }
}
