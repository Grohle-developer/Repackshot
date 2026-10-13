//! Bitmaps of a scene (RSB `BMAP` sections): environment images (HDRI) and background plates.
//!
//! A bitmap is stored as the file sent it ([`Bitmap::format`], [`Bitmap::data`]) and decoded once,
//! when the scene is read, into an [`Image`]: 8-bit sRGB kept as bytes (backplates; decoded to
//! linear by a table on lookup) or linear `f32` RGB (HDR images). Formats:
//!
//! | `format` | Data | `width`, `height` |
//! |---|---|---|
//! | 0 [`FORMAT_RGB8`] | `3 w h` bytes of sRGB, rows top to bottom | the size |
//! | 1 [`FORMAT_RGBA8`] | `4 w h` bytes of sRGB with straight alpha (alpha is ignored) | the size |
//! | 2 [`FORMAT_RGB_F32`] | `3 w h` little-endian linear floats | the size |
//! | 16 [`FORMAT_HDR`] | a Radiance `.hdr` file ([`crate::hdr`]) | 0, or the file's size |
//! | 17 [`FORMAT_EXR`] | an OpenEXR file ([`crate::exr`]) | 0, or the file's size |
//!
//! Linear images wider than [`MAX_LINEAR_WIDTH`] are halved (2 x 2 box filter, in a fixed order)
//! until they fit: an environment needs no more, and four workers holding a 16K panorama each
//! would not fit in a browser. Non-finite and negative values become zero.
//!
//! [`Distribution2D`] importance-samples an image (or any table of weights) by a marginal
//! distribution over rows and a conditional one over the columns of each row, as in M. Pharr,
//! W. Jakob and G. Humphreys, *Physically Based Rendering*, 3rd ed., §13.6.7.

use crate::color::Rgb;
use crate::exr;
use crate::hdr;
use std::fmt;
use std::sync::Arc;

/// `BMAP.format` 0: 8-bit sRGB RGB.
pub const FORMAT_RGB8: u32 = 0;
/// `BMAP.format` 1: 8-bit sRGB RGBA (alpha ignored).
pub const FORMAT_RGBA8: u32 = 1;
/// `BMAP.format` 2: linear 32-bit float RGB.
pub const FORMAT_RGB_F32: u32 = 2;
/// `BMAP.format` 16: a Radiance RGBE file.
pub const FORMAT_HDR: u32 = 16;
/// `BMAP.format` 17: an OpenEXR file.
pub const FORMAT_EXR: u32 = 17;

/// Widest linear image kept; wider ones are halved on reading.
pub const MAX_LINEAR_WIDTH: u32 = 4096;
/// Largest image accepted, in pixels, before any halving.
pub const MAX_PIXELS: u64 = 1 << 28;
/// Largest side of an image.
pub const MAX_SIDE: u32 = 65_536;

/// Why a bitmap could not be decoded.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum BitmapError {
    /// The format code is unknown.
    UnknownFormat,
    /// The size does not match the data, or is zero or too large.
    BadSize,
    /// The HDR file is unreadable.
    Hdr(hdr::HdrError),
    /// The EXR file is unreadable.
    Exr(exr::ExrError),
}

impl fmt::Display for BitmapError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            BitmapError::UnknownFormat => f.write_str("unknown bitmap format"),
            BitmapError::BadSize => f.write_str("bitmap size does not match its data"),
            BitmapError::Hdr(e) => write!(f, "{e}"),
            BitmapError::Exr(e) => write!(f, "{e}"),
        }
    }
}

impl std::error::Error for BitmapError {}

impl BitmapError {
    /// A static description, for the RSB error.
    pub fn reason(&self) -> &'static str {
        match self {
            BitmapError::UnknownFormat => "unknown bitmap format",
            BitmapError::BadSize => "bitmap size does not match its data",
            BitmapError::Hdr(_) => "unreadable Radiance HDR image",
            BitmapError::Exr(exr::ExrError::Unsupported(what)) => what,
            BitmapError::Exr(_) => "unreadable OpenEXR image",
        }
    }
}

/// Pixels ready for lookups.
#[derive(Clone, Debug, PartialEq)]
pub enum Pixels {
    /// sRGB bytes, three per pixel.
    Srgb8(Vec<u8>),
    /// Linear floats, three per pixel.
    Linear(Vec<f32>),
}

/// A decoded image, rows top to bottom.
#[derive(Clone, Debug, PartialEq)]
pub struct Image {
    /// Width in pixels.
    pub width: u32,
    /// Height in pixels.
    pub height: u32,
    /// The pixels.
    pub pixels: Pixels,
}

/// The sRGB decoding of every byte value (IEC 61966-2-1), computed once with `fmath`.
fn srgb_table() -> &'static [f32; 256] {
    use std::sync::OnceLock;
    static TABLE: OnceLock<[f32; 256]> = OnceLock::new();
    TABLE.get_or_init(|| {
        let mut t = [0.0f32; 256];
        for (i, v) in t.iter_mut().enumerate() {
            let c = i as f32 / 255.0;
            *v = if c <= 0.04045 {
                c / 12.92
            } else {
                crate::fmath::powf((c + 0.055) / 1.055, 2.4)
            };
        }
        t
    })
}

impl Image {
    /// The pixel at `(x, y)` (clamped into the image), linear RGB.
    #[inline]
    pub fn texel(&self, x: u32, y: u32) -> Rgb {
        let x = x.min(self.width - 1) as usize;
        let y = y.min(self.height - 1) as usize;
        let i = 3 * (y * self.width as usize + x);
        match &self.pixels {
            Pixels::Linear(v) => Rgb::new(v[i], v[i + 1], v[i + 2]),
            Pixels::Srgb8(v) => {
                let t = srgb_table();
                Rgb::new(
                    t[usize::from(v[i])],
                    t[usize::from(v[i + 1])],
                    t[usize::from(v[i + 2])],
                )
            }
        }
    }

    /// Bilinear lookup at `(u, v)` in `[0, 1]²` (pixel centres at `(i + ½) / n`). `wrap_u`
    /// wraps the columns (panoramas); otherwise edges are clamped.
    pub fn bilinear(&self, u: f32, v: f32, wrap_u: bool) -> Rgb {
        let (w, h) = (self.width as f32, self.height as f32);
        let fx = u * w - 0.5;
        let fy = (v * h - 0.5).clamp(0.0, h - 1.0);
        let x0f = fx.floor();
        let y0f = fy.floor();
        let (tx, ty) = (fx - x0f, fy - y0f);
        let column = |x: f32| -> u32 {
            if wrap_u {
                (x.rem_euclid(w) as u32).min(self.width - 1)
            } else {
                x.clamp(0.0, w - 1.0) as u32
            }
        };
        let (x0, x1) = (column(x0f), column(x0f + 1.0));
        let y0 = y0f as u32;
        let y1 = (y0 + 1).min(self.height - 1);
        let top = self.texel(x0, y0) * (1.0 - tx) + self.texel(x1, y0) * tx;
        let bottom = self.texel(x0, y1) * (1.0 - tx) + self.texel(x1, y1) * tx;
        top * (1.0 - ty) + bottom * ty
    }

    /// Mean of the pixels, linear RGB.
    pub fn mean(&self) -> Rgb {
        let mut sum = Rgb::BLACK;
        for y in 0..self.height {
            let mut row = Rgb::BLACK;
            for x in 0..self.width {
                row += self.texel(x, y);
            }
            sum += row / self.width as f32;
        }
        sum / self.height as f32
    }
}

/// Halves a linear image (2 x 2 box filter; an odd last column or row is averaged with itself).
fn halve(w: usize, h: usize, rgb: &[f32]) -> (usize, usize, Vec<f32>) {
    let (nw, nh) = (w.div_ceil(2), h.div_ceil(2));
    let mut out = vec![0.0f32; 3 * nw * nh];
    for y in 0..nh {
        let (ya, yb) = (2 * y, (2 * y + 1).min(h - 1));
        for x in 0..nw {
            let (xa, xb) = (2 * x, (2 * x + 1).min(w - 1));
            for c in 0..3 {
                let a = rgb[3 * (ya * w + xa) + c] + rgb[3 * (ya * w + xb) + c];
                let b = rgb[3 * (yb * w + xa) + c] + rgb[3 * (yb * w + xb) + c];
                out[3 * (y * nw + x) + c] = (a + b) * 0.25;
            }
        }
    }
    (nw, nh, out)
}

/// A linear image from decoded floats: cleaned, then halved until it fits.
fn linear(width: u32, height: u32, mut rgb: Vec<f32>) -> Image {
    for v in rgb.iter_mut() {
        if !(v.is_finite() && *v > 0.0) {
            *v = 0.0;
        }
    }
    let (mut w, mut h) = (width as usize, height as usize);
    while w > MAX_LINEAR_WIDTH as usize {
        let (nw, nh, next) = halve(w, h, &rgb);
        (w, h, rgb) = (nw, nh, next);
    }
    Image {
        width: w as u32,
        height: h as u32,
        pixels: Pixels::Linear(rgb),
    }
}

/// A bitmap section: its bytes as sent, and the decoded image.
#[derive(Clone, Debug, PartialEq)]
pub struct Bitmap {
    /// `BMAP.format`.
    pub format: u32,
    /// `BMAP.width` as written (0 for encoded files that carry their own size).
    pub width: u32,
    /// `BMAP.height` as written.
    pub height: u32,
    /// The data bytes.
    pub data: Vec<u8>,
    /// The decoded image (shared with the lights and the background that use it).
    pub image: Arc<Image>,
}

impl Bitmap {
    /// Decodes a bitmap section's content.
    pub fn decode(
        format: u32,
        width: u32,
        height: u32,
        data: Vec<u8>,
    ) -> Result<Bitmap, BitmapError> {
        let raw_size = |bytes_per_pixel: u64| -> Result<(), BitmapError> {
            let pixels = u64::from(width) * u64::from(height);
            if width == 0
                || height == 0
                || width > MAX_SIDE
                || height > MAX_SIDE
                || pixels > MAX_PIXELS
                || pixels * bytes_per_pixel != data.len() as u64
            {
                Err(BitmapError::BadSize)
            } else {
                Ok(())
            }
        };
        let image = match format {
            FORMAT_RGB8 => {
                raw_size(3)?;
                Image {
                    width,
                    height,
                    pixels: Pixels::Srgb8(data.clone()),
                }
            }
            FORMAT_RGBA8 => {
                raw_size(4)?;
                let rgb: Vec<u8> = data
                    .chunks_exact(4)
                    .flat_map(|p| [p[0], p[1], p[2]])
                    .collect();
                Image {
                    width,
                    height,
                    pixels: Pixels::Srgb8(rgb),
                }
            }
            FORMAT_RGB_F32 => {
                raw_size(12)?;
                let rgb = data
                    .chunks_exact(4)
                    .map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]]))
                    .collect();
                linear(width, height, rgb)
            }
            FORMAT_HDR => {
                let img = hdr::decode(&data, MAX_PIXELS).map_err(BitmapError::Hdr)?;
                if (width, height) != (0, 0) && (width, height) != (img.width, img.height) {
                    return Err(BitmapError::BadSize);
                }
                linear(img.width, img.height, img.rgb)
            }
            FORMAT_EXR => {
                let img = exr::decode(&data, MAX_PIXELS).map_err(BitmapError::Exr)?;
                if (width, height) != (0, 0) && (width, height) != (img.width, img.height) {
                    return Err(BitmapError::BadSize);
                }
                linear(img.width, img.height, img.rgb)
            }
            _ => return Err(BitmapError::UnknownFormat),
        };
        Ok(Bitmap {
            format,
            width,
            height,
            data,
            image: Arc::new(image),
        })
    }

    /// A bitmap of linear float pixels (format 2), for scenes built in code.
    pub fn from_linear(width: u32, height: u32, rgb: &[f32]) -> Result<Bitmap, BitmapError> {
        let data = rgb.iter().flat_map(|v| v.to_le_bytes()).collect();
        Bitmap::decode(FORMAT_RGB_F32, width, height, data)
    }
}

/// Index of the bucket of a normalised CDF holding `u`, and `u` rescaled into it.
fn search(cdf: &[f32], u: f32) -> (usize, f32) {
    let i = cdf
        .partition_point(|&c| c <= u)
        .min(cdf.len().saturating_sub(1));
    let lo = if i == 0 { 0.0 } else { cdf[i - 1] };
    let width = cdf[i] - lo;
    let rest = if width > 0.0 {
        ((u - lo) / width).clamp(0.0, 0.999_999_94)
    } else {
        0.5
    };
    (i, rest)
}

/// A piecewise-constant distribution over `[0, 1]²` with `width x height` cells.
#[derive(Clone, Debug, PartialEq)]
pub struct Distribution2D {
    width: usize,
    height: usize,
    /// Weight of every cell (non-negative), row-major.
    weights: Vec<f32>,
    /// Normalised CDF over the columns of each row (`width` entries per row).
    conditional: Vec<f32>,
    /// Normalised CDF over the rows.
    marginal: Vec<f32>,
    /// Sum of all weights divided by the number of cells: the mean weight.
    mean: f32,
}

impl Distribution2D {
    /// The distribution proportional to `weights` (`width * height`, row-major). `None` when
    /// they are all zero.
    pub fn new(width: usize, height: usize, weights: Vec<f32>) -> Option<Distribution2D> {
        assert_eq!(weights.len(), width * height);
        let mut conditional = vec![0.0f32; width * height];
        let mut row_sums = vec![0.0f32; height];
        for y in 0..height {
            let row = &weights[y * width..(y + 1) * width];
            let mut acc = 0.0f32;
            for (x, &w) in row.iter().enumerate() {
                acc += w;
                conditional[y * width + x] = acc;
            }
            row_sums[y] = acc;
            if acc > 0.0 {
                for c in &mut conditional[y * width..(y + 1) * width] {
                    *c /= acc;
                }
                conditional[(y + 1) * width - 1] = 1.0;
            }
        }
        let mut marginal = vec![0.0f32; height];
        let mut acc = 0.0f32;
        for (y, &s) in row_sums.iter().enumerate() {
            acc += s;
            marginal[y] = acc;
        }
        if !(acc > 0.0 && acc.is_finite()) {
            return None;
        }
        for m in &mut marginal {
            *m /= acc;
        }
        marginal[height - 1] = 1.0;
        Some(Distribution2D {
            width,
            height,
            weights,
            conditional,
            marginal,
            mean: acc / (width * height) as f32,
        })
    }

    /// A point of `[0, 1)²` (`(u, v)`, `v` along the rows) and its density over the square.
    pub fn sample(&self, s: (f32, f32)) -> ((f32, f32), f32) {
        let (y, fy) = search(&self.marginal, s.1);
        let row = &self.conditional[y * self.width..(y + 1) * self.width];
        let (x, fx) = search(row, s.0);
        let u = (x as f32 + fx) / self.width as f32;
        let v = (y as f32 + fy) / self.height as f32;
        ((u, v), self.weights[y * self.width + x] / self.mean)
    }

    /// Density over the square at `(u, v)`.
    pub fn pdf(&self, u: f32, v: f32) -> f32 {
        let x = ((u * self.width as f32) as usize).min(self.width - 1);
        let y = ((v * self.height as f32) as usize).min(self.height - 1);
        self.weights[y * self.width + x] / self.mean
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rng::Pcg32;

    #[test]
    fn raw_formats_decode_and_check_their_size() {
        let rgb8 = Bitmap::decode(FORMAT_RGB8, 2, 1, vec![0, 128, 255, 255, 0, 0]).unwrap();
        assert_eq!(rgb8.image.texel(0, 0).r, 0.0);
        assert!((rgb8.image.texel(0, 0).g - 0.215_861).abs() < 1.0e-5);
        assert_eq!(rgb8.image.texel(0, 0).b, 1.0);
        assert_eq!(rgb8.image.texel(1, 0), Rgb::new(1.0, 0.0, 0.0));
        let rgba = Bitmap::decode(FORMAT_RGBA8, 1, 1, vec![255, 0, 0, 7]).unwrap();
        assert_eq!(rgba.image.texel(0, 0), Rgb::new(1.0, 0.0, 0.0));
        let f = Bitmap::from_linear(1, 2, &[1.0, 2.0, 3.0, -1.0, f32::NAN, 5.0]).unwrap();
        assert_eq!(f.image.texel(0, 0), Rgb::new(1.0, 2.0, 3.0));
        assert_eq!(f.image.texel(0, 1), Rgb::new(0.0, 0.0, 5.0));
        assert_eq!(
            Bitmap::decode(FORMAT_RGB8, 2, 2, vec![0; 6]),
            Err(BitmapError::BadSize)
        );
        assert_eq!(
            Bitmap::decode(FORMAT_RGB8, 0, 0, vec![]),
            Err(BitmapError::BadSize)
        );
        assert_eq!(
            Bitmap::decode(99, 1, 1, vec![0; 3]),
            Err(BitmapError::UnknownFormat)
        );
    }

    #[test]
    fn encoded_files_decode_and_wide_images_are_halved() {
        let (w, h) = (MAX_LINEAR_WIDTH + 2, 3);
        let rgb: Vec<f32> = (0..3 * w * h).map(|i| (i % 5) as f32).collect();
        let hdr_file = hdr::encode(w, h, &rgb);
        let b = Bitmap::decode(FORMAT_HDR, 0, 0, hdr_file.clone()).unwrap();
        assert_eq!((b.image.width, b.image.height), (w.div_ceil(2), 2));
        assert_eq!(
            Bitmap::decode(FORMAT_HDR, 5, 5, hdr_file),
            Err(BitmapError::BadSize)
        );
        let exr_file = exr::encode(4, 2, &[0.25; 24], exr::PixelType::Half);
        let e = Bitmap::decode(FORMAT_EXR, 4, 2, exr_file).unwrap();
        assert_eq!(e.image.texel(3, 1), Rgb::splat(0.25));
        assert!(matches!(
            Bitmap::decode(FORMAT_EXR, 0, 0, b"nope".to_vec()),
            Err(BitmapError::Exr(_))
        ));
    }

    #[test]
    fn bilinear_lookups_hit_pixel_centres_and_wrap() {
        let img = Bitmap::from_linear(2, 1, &[0.0, 0.0, 0.0, 1.0, 1.0, 1.0])
            .unwrap()
            .image;
        assert_eq!(img.bilinear(0.25, 0.5, false).r, 0.0);
        assert_eq!(img.bilinear(0.75, 0.5, false).r, 1.0);
        assert_eq!(img.bilinear(0.5, 0.5, false).r, 0.5);
        // Past the right edge: clamped, or wrapped back towards the first column.
        assert_eq!(img.bilinear(1.0, 0.5, false).r, 1.0);
        assert_eq!(img.bilinear(1.0, 0.5, true).r, 0.5);
        assert_eq!(img.bilinear(0.0, 0.5, true).r, 0.5);
    }

    #[test]
    fn the_2d_distribution_samples_in_proportion_and_knows_its_density() {
        let (w, h) = (8usize, 4usize);
        let weights: Vec<f32> = (0..w * h).map(|i| ((i * 7) % 5) as f32).collect();
        let d = Distribution2D::new(w, h, weights.clone()).unwrap();
        let total: f32 = weights.iter().sum();
        let mut counts = vec![0u32; w * h];
        let mut rng = Pcg32::seeded(5, 5);
        let n = 400_000;
        for _ in 0..n {
            let ((u, v), pdf) = d.sample((rng.next_f32(), rng.next_f32()));
            assert!((0.0..1.0).contains(&u) && (0.0..1.0).contains(&v));
            assert!((pdf - d.pdf(u, v)).abs() < 1.0e-5 * pdf.max(1.0));
            let cell = (v * h as f32) as usize * w + (u * w as f32) as usize;
            counts[cell] += 1;
        }
        for (i, &c) in counts.iter().enumerate() {
            let want = weights[i] / total;
            let got = c as f32 / n as f32;
            assert!((got - want).abs() < 0.003, "cell {i}: {got} vs {want}");
            if weights[i] == 0.0 {
                assert_eq!(c, 0);
            }
        }
        assert!(Distribution2D::new(2, 2, vec![0.0; 4]).is_none());
    }
}
