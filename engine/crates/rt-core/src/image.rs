//! The film: a floating point accumulation buffer for (a region of) the image.

use crate::color::{srgb_encode, Rgb, Tonemap};

/// A rectangular region of the image, accumulating linear radiance.
///
/// Every [`Film::splat`] adds one sample to a pixel; [`Film::resolve`] divides by the number of
/// samples. Coordinates given to `splat` are in *image* space, so a film can cover only part of
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

    /// Adds one sample `c` to the image-space pixel `(x, y)`. Pixels outside the film are ignored.
    #[inline]
    pub fn splat(&mut self, x: u32, y: u32, c: Rgb) {
        if let Some(i) = self.index(x, y) {
            self.rgb[i * 3] += c.r;
            self.rgb[i * 3 + 1] += c.g;
            self.rgb[i * 3 + 2] += c.b;
            self.weight[i] += 1.0;
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
        true
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
