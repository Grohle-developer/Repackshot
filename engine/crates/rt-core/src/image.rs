//! The film: a floating point accumulation buffer for (a region of) the image, with coverage
//! (alpha) and the sum of the squared luminance of the samples (their variance, for the
//! denoiser of `rt-post`).

use crate::color::{srgb_encode, Rgb, Tonemap};

/// A rectangular region of the image, accumulating linear radiance.
///
/// Every [`Film::splat`] adds one sample to a pixel; [`Film::resolve`] divides by the number of
/// samples. Radiance is premultiplied by coverage: a sample that sees a transparent background
/// adds black with alpha 0. Coordinates given to `splat` are in *image* space, so a film can cover only part of
/// the image (see [`Film::region`]) and still be fed by [`crate::render::render_tile`].
#[derive(Clone, Debug, PartialEq)]
pub struct Film {
    /// Width of the film in pixels.
    pub width: u32,
    /// Height of the film in pixels.
    pub height: u32,
    /// Image-space x coordinate of the film's left column.
    pub origin_x: u32,
    /// Image-space y coordinate of the film's top row.
    pub origin_y: u32,
    /// Summed linear radiance per pixel, `3 * width * height` values, row major from the top.
    pub rgb: Vec<f32>,
    /// Number of samples summed into each pixel, `width * height` values.
    pub weight: Vec<f32>,
    /// Summed coverage per pixel, `width * height` values: 1 per sample that saw something
    /// opaque (always, unless the background is transparent), between 0 and 1 for a shadow on
    /// a shadow catcher.
    pub alpha: Vec<f32>,
    /// Summed square of each sample's luminance ([`Rgb::luminance`] of the premultiplied
    /// radiance), `width * height` values, in `f32` and in sample order like `rgb`. With the
    /// mean it gives each pixel's sample variance (E5b-1, the denoiser's guide); it never
    /// changes `rgb`, `weight` or `alpha`, so the image is the same bits with or without it.
    pub lum2: Vec<f32>,
}

impl Film {
    /// Creates an empty film covering the image rectangle `[0, width) x [0, height)`.
    pub fn new(width: u32, height: u32) -> Film {
        Film::region(0, 0, width, height)
    }

    /// Creates an empty film covering `width x height` pixels whose top-left pixel is
    /// `(origin_x, origin_y)` in image space.
    pub fn region(origin_x: u32, origin_y: u32, width: u32, height: u32) -> Film {
        let pixels = width as usize * height as usize;
        Film {
            width,
            height,
            origin_x,
            origin_y,
            rgb: vec![0.0; pixels * 3],
            weight: vec![0.0; pixels],
            alpha: vec![0.0; pixels],
            lum2: vec![0.0; pixels],
        }
    }

    /// Index of the image-space pixel `(x, y)` in `weight`, or `None` outside of the film.
    #[inline]
    fn index(&self, x: u32, y: u32) -> Option<usize> {
        let lx = x.checked_sub(self.origin_x)?;
        let ly = y.checked_sub(self.origin_y)?;
        if lx < self.width && ly < self.height {
            Some(ly as usize * self.width as usize + lx as usize)
        } else {
            None
        }
    }

    /// Adds one opaque sample `c` to the image-space pixel `(x, y)`. Pixels outside the film are
    /// ignored.
    #[inline]
    pub fn splat(&mut self, x: u32, y: u32, c: Rgb) {
        self.splat_alpha(x, y, c, 1.0);
    }

    /// Adds one sample of (premultiplied) radiance `c` and coverage `alpha` to the image-space
    /// pixel `(x, y)`. Pixels outside the film are ignored.
    #[inline]
    pub fn splat_alpha(&mut self, x: u32, y: u32, c: Rgb, alpha: f32) {
        if let Some(i) = self.index(x, y) {
            self.rgb[i * 3] += c.r;
            self.rgb[i * 3 + 1] += c.g;
            self.rgb[i * 3 + 2] += c.b;
            self.weight[i] += 1.0;
            self.alpha[i] += alpha;
            let l = c.luminance();
            self.lum2[i] += l * l;
        }
    }

    /// Adds the accumulated samples of `other` into this film. Both films must have the same
    /// geometry; otherwise nothing is merged and `false` is returned.
    pub fn merge(&mut self, other: &Film) -> bool {
        if self.width != other.width
            || self.height != other.height
            || self.origin_x != other.origin_x
            || self.origin_y != other.origin_y
        {
            return false;
        }
        for (a, b) in self.rgb.iter_mut().zip(&other.rgb) {
            *a += *b;
        }
        for (a, b) in self.weight.iter_mut().zip(&other.weight) {
            *a += *b;
        }
        for (a, b) in self.alpha.iter_mut().zip(&other.alpha) {
            *a += *b;
        }
        for (a, b) in self.lum2.iter_mut().zip(&other.lum2) {
            *a += *b;
        }
        true
    }

    /// Copies the pixels of `region` (a film covering part of this one) into this film,
    /// replacing what was there. Pixels of `region` outside this film are ignored.
    pub fn copy_region(&mut self, region: &Film) {
        for ly in 0..region.height {
            for lx in 0..region.width {
                let (x, y) = (region.origin_x + lx, region.origin_y + ly);
                if let Some(i) = self.index(x, y) {
                    let j = (ly * region.width + lx) as usize;
                    self.rgb[i * 3..i * 3 + 3].copy_from_slice(&region.rgb[j * 3..j * 3 + 3]);
                    self.weight[i] = region.weight[j];
                    self.alpha[i] = region.alpha[j];
                    self.lum2[i] = region.lum2[j];
                }
            }
        }
    }

    /// Average linear radiance per pixel: `3 * width * height` floats. Pixels that received no
    /// sample are black.
    pub fn resolve(&self) -> Vec<f32> {
        let mut out = vec![0.0; self.rgb.len()];
        for (i, &w) in self.weight.iter().enumerate() {
            if w > 0.0 {
                let inv = 1.0 / w;
                for c in 0..3 {
                    out[i * 3 + c] = self.rgb[i * 3 + c] * inv;
                }
            }
        }
        out
    }

    /// Average coverage per pixel: `width * height` floats in `[0, 1]`. Pixels that received no
    /// sample are 0.
    pub fn resolve_alpha(&self) -> Vec<f32> {
        self.alpha
            .iter()
            .zip(&self.weight)
            .map(|(&a, &w)| if w > 0.0 { a * (1.0 / w) } else { 0.0 })
            .collect()
    }

    /// Resolves and converts to 8-bit sRGB (no exposure, no tone curve, values clamped).
    pub fn to_srgb8(&self) -> Vec<u8> {
        self.to_srgb8_tonemapped(0.0, Tonemap::Linear)
    }

    /// Resolves, applies `ev` stops of exposure and `tonemap`, and converts to 8-bit sRGB.
    pub fn to_srgb8_tonemapped(&self, ev: f32, tonemap: Tonemap) -> Vec<u8> {
        let gain = crate::color::exposure(ev);
        let linear = self.resolve();
        let mut out = Vec::with_capacity(linear.len());
        for px in linear.chunks_exact(3) {
            let mapped = tonemap.apply(Rgb::new(px[0], px[1], px[2]) * gain);
            for v in [mapped.r, mapped.g, mapped.b] {
                out.push((srgb_encode(v) * 255.0 + 0.5) as u8);
            }
        }
        out
    }

    /// Resolves, applies `ev` stops of exposure and `tonemap`, and converts to 16-bit sRGB words:
    /// the rule of [`Film::to_srgb8_tonemapped`] at 16 bits (`srgb_encode(v) * 65535 + 0.5`,
    /// truncated).
    pub fn to_srgb16_tonemapped(&self, ev: f32, tonemap: Tonemap) -> Vec<u16> {
        let gain = crate::color::exposure(ev);
        let linear = self.resolve();
        let mut out = Vec::with_capacity(linear.len());
        for px in linear.chunks_exact(3) {
            let mapped = tonemap.apply(Rgb::new(px[0], px[1], px[2]) * gain);
            for v in [mapped.r, mapped.g, mapped.b] {
                out.push((srgb_encode(v) * 65535.0 + 0.5) as u16);
            }
        }
        out
    }

    /// Resolves and applies `ev` stops of exposure: scene-linear light with no tone curve and no
    /// clamp, `3 * width * height` floats (what the EXR, the 32-bit TIFF and the DNG hold).
    pub fn to_linear_exposed(&self, ev: f32) -> Vec<f32> {
        let gain = crate::color::exposure(ev);
        self.resolve().into_iter().map(|v| v * gain).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splat_accumulates_and_resolve_averages() {
        let mut film = Film::new(2, 2);
        film.splat(1, 0, Rgb::new(1.0, 0.0, 0.5));
        film.splat(1, 0, Rgb::new(3.0, 0.0, 0.5));
        let out = film.resolve();
        assert_eq!(out.len(), 12);
        assert_eq!(&out[3..6], &[2.0, 0.0, 0.5]);
        assert_eq!(film.weight, vec![0.0, 2.0, 0.0, 0.0]);
        // Untouched pixels stay black instead of dividing by zero.
        assert!(out[..3].iter().chain(&out[6..]).all(|&v| v == 0.0));
    }

    #[test]
    fn splat_outside_the_film_is_ignored() {
        let mut film = Film::new(2, 2);
        film.splat(2, 0, Rgb::WHITE);
        film.splat(0, 2, Rgb::WHITE);
        assert!(film.rgb.iter().all(|&v| v == 0.0));
        assert!(film.weight.iter().all(|&v| v == 0.0));
    }

    #[test]
    fn region_uses_image_space_coordinates() {
        let mut film = Film::region(10, 20, 2, 2);
        film.splat(9, 20, Rgb::WHITE); // left of the region
        film.splat(11, 21, Rgb::WHITE); // bottom-right pixel of the region
        assert_eq!(film.weight, vec![0.0, 0.0, 0.0, 1.0]);
        assert_eq!(&film.rgb[9..12], &[1.0, 1.0, 1.0]);
    }

    #[test]
    fn merge_adds_films_of_equal_geometry() {
        let mut a = Film::new(2, 1);
        let mut b = Film::new(2, 1);
        a.splat(0, 0, Rgb::splat(1.0));
        b.splat(0, 0, Rgb::splat(3.0));
        b.splat(1, 0, Rgb::splat(5.0));
        assert!(a.merge(&b));
        assert_eq!(a.resolve(), vec![2.0, 2.0, 2.0, 5.0, 5.0, 5.0]);
        assert!(!a.merge(&Film::new(1, 1)));
    }

    #[test]
    fn alpha_averages_coverage_and_merges() {
        let mut film = Film::new(2, 1);
        film.splat_alpha(0, 0, Rgb::BLACK, 0.0);
        film.splat_alpha(0, 0, Rgb::WHITE, 1.0);
        film.splat_alpha(0, 0, Rgb::splat(0.5), 0.5);
        film.splat(1, 0, Rgb::WHITE);
        assert_eq!(film.resolve_alpha(), vec![0.5, 1.0]);
        let mut other = Film::new(2, 1);
        other.splat_alpha(1, 0, Rgb::BLACK, 0.0);
        assert!(film.merge(&other));
        assert_eq!(film.resolve_alpha(), vec![0.5, 0.5]);
        assert_eq!(Film::new(1, 1).resolve_alpha(), vec![0.0]);

        // A region copied into a full film lands at its own pixels, alpha included.
        let mut region = Film::region(1, 0, 1, 1);
        region.splat_alpha(1, 0, Rgb::splat(2.0), 0.25);
        let mut full = Film::new(2, 1);
        full.splat(0, 0, Rgb::WHITE);
        full.copy_region(&region);
        assert_eq!(full.resolve(), vec![1.0, 1.0, 1.0, 2.0, 2.0, 2.0]);
        assert_eq!(full.resolve_alpha(), vec![1.0, 0.25]);
    }

    #[test]
    fn the_squared_luminance_is_summed_without_touching_the_image() {
        let mut film = Film::new(2, 1);
        film.splat(0, 0, Rgb::new(1.0, 0.0, 0.0));
        film.splat(0, 0, Rgb::new(0.0, 1.0, 0.0));
        film.splat_alpha(1, 0, Rgb::splat(2.0), 0.5);
        let (r, g) = (
            Rgb::new(1.0, 0.0, 0.0).luminance(),
            Rgb::new(0.0, 1.0, 0.0).luminance(),
        );
        assert_eq!(film.lum2, vec![r * r + g * g, 4.0]);
        // The radiance, weights and coverage are what they would be without it.
        assert_eq!(film.rgb, vec![1.0, 1.0, 0.0, 2.0, 2.0, 2.0]);
        assert_eq!(film.weight, vec![2.0, 1.0]);
        assert_eq!(film.alpha, vec![2.0, 0.5]);
        // Merges and region copies carry it.
        let mut other = Film::new(2, 1);
        other.splat(1, 0, Rgb::splat(1.0));
        assert!(film.merge(&other));
        assert_eq!(film.lum2[1], 5.0);
        let mut region = Film::region(1, 0, 1, 1);
        region.splat(1, 0, Rgb::splat(3.0));
        film.copy_region(&region);
        assert_eq!(film.lum2[1], 9.0);
    }

    #[test]
    fn srgb8_conversion() {
        let mut film = Film::new(3, 1);
        film.splat(0, 0, Rgb::BLACK);
        film.splat(1, 0, Rgb::WHITE);
        film.splat(2, 0, Rgb::splat(0.5));
        let bytes = film.to_srgb8();
        assert_eq!(bytes.len(), 9);
        assert_eq!(&bytes[0..3], &[0, 0, 0]);
        assert_eq!(&bytes[3..6], &[255, 255, 255]);
        assert_eq!(&bytes[6..9], &[188, 188, 188]); // sRGB(0.5) * 255 = 187.5 -> 188
    }

    #[test]
    fn srgb16_follows_the_8_bit_rule() {
        let mut film = Film::new(3, 1);
        film.splat(0, 0, Rgb::BLACK);
        film.splat(1, 0, Rgb::WHITE);
        film.splat(2, 0, Rgb::splat(0.5));
        let words = film.to_srgb16_tonemapped(0.0, Tonemap::Linear);
        assert_eq!(&words[0..3], &[0, 0, 0]);
        assert_eq!(&words[3..6], &[65535, 65535, 65535]);
        let half = (srgb_encode(0.5) * 65535.0 + 0.5) as u16;
        assert_eq!(&words[6..9], &[half, half, half]);
        // The same pixel in 8 bits is the word's high byte, give or take the rounding.
        let bytes = film.to_srgb8();
        for (w, b) in words.iter().zip(&bytes) {
            assert!((i32::from(*w) / 257 - i32::from(*b)).abs() <= 1);
        }
    }

    #[test]
    fn linear_output_has_the_exposure_and_no_curve() {
        let mut film = Film::new(2, 1);
        film.splat(0, 0, Rgb::splat(0.25));
        film.splat(1, 0, Rgb::new(8.0, 0.0, 0.5));
        // +2 EV: times 4, nothing clamped (the 8.0 becomes 32.0).
        assert_eq!(
            film.to_linear_exposed(2.0),
            vec![1.0, 1.0, 1.0, 32.0, 0.0, 2.0]
        );
        assert_eq!(film.to_linear_exposed(0.0)[3], 8.0);
    }

    #[test]
    fn exposure_and_tonemap_are_applied_before_encoding() {
        let mut film = Film::new(1, 1);
        film.splat(0, 0, Rgb::splat(0.25));
        // +2 EV turns 0.25 into 1.0: white in linear mode.
        assert_eq!(
            film.to_srgb8_tonemapped(2.0, Tonemap::Linear),
            vec![255, 255, 255]
        );
        // ACES keeps a headroom below white.
        let aces = film.to_srgb8_tonemapped(2.0, Tonemap::Aces);
        assert!(aces[0] < 255 && aces[0] > 200);
    }
}
