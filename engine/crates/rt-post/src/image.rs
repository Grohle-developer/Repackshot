//! Images and passes as the guard takes them, and the display transform: the render's exposure
//! and tone curve, then sRGB, exactly as the engine converts a film to 8 bits.

use crate::job::{Job, PostError};
use rt_core::color::{srgb_encode, Rgb, Tonemap};
use rt_core::fmath;

/// Linear RGBA, 4 floats a pixel, row-major from the top-left, straight alpha: the render's
/// average (`LinearImage` in `src/core/ai.ts`).
#[derive(Clone, Debug, PartialEq)]
pub struct LinearImage {
    /// Width in pixels.
    pub width: u32,
    /// Height in pixels.
    pub height: u32,
    /// `width * height * 4` floats.
    pub rgba: Vec<f32>,
}

impl LinearImage {
    /// A black, transparent image.
    pub fn new(width: u32, height: u32) -> LinearImage {
        LinearImage {
            width,
            height,
            rgba: vec![0.0; width as usize * height as usize * 4],
        }
    }

    pub(crate) fn check(&self, job: &Job) -> Result<(), PostError> {
        if self.width != job.width || self.height != job.height {
            return Err(PostError::new(format!(
                "the image is {}x{}, the job {}x{}",
                self.width, self.height, job.width, job.height
            )));
        }
        if self.rgba.len() != self.width as usize * self.height as usize * 4 {
            return Err(PostError::new("the image has the wrong number of floats"));
        }
        Ok(())
    }
}

/// 8-bit sRGB, 3 bytes a pixel, row-major: what the model is given and what it returns.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Rgb8Image {
    /// Width in pixels.
    pub width: u32,
    /// Height in pixels.
    pub height: u32,
    /// `width * height * 3` bytes.
    pub rgb: Vec<u8>,
}

/// The exact passes of the render (`RenderPasses` in `src/core/passes.ts`), borrowed. The ids are
/// required; a missing `normal` gives edges from the ids alone, a missing `depth` a black depth
/// image, a missing `coc` an image in focus everywhere.
#[derive(Clone, Copy, Debug)]
pub struct Passes<'a> {
    /// Width in pixels (the job's).
    pub width: u32,
    /// Height in pixels.
    pub height: u32,
    /// RSB instance index + 1 per pixel; 0 is background.
    pub part_id: &'a [u32],
    /// RSB material index + 1 per pixel; 0 is background.
    pub material_id: &'a [u32],
    /// World-space unit shading normal, 3 floats a pixel.
    pub normal: Option<&'a [f32]>,
    /// Distance along the camera axis; `+inf` for background.
    pub depth: Option<&'a [f32]>,
    /// Circle-of-confusion diameter in pixels.
    pub coc: Option<&'a [f32]>,
}

impl Passes<'_> {
    pub(crate) fn check(&self, job: &Job) -> Result<(), PostError> {
        if self.width != job.width || self.height != job.height {
            return Err(PostError::new(format!(
                "the passes are {}x{}, the job {}x{}",
                self.width, self.height, job.width, job.height
            )));
        }
        let n = self.width as usize * self.height as usize;
        let ok = |len: usize, channels: usize| len == n * channels;
        if !ok(self.part_id.len(), 1) || !ok(self.material_id.len(), 1) {
            return Err(PostError::new("the id passes have the wrong size"));
        }
        if self.normal.is_some_and(|v| !ok(v.len(), 3))
            || self.depth.is_some_and(|v| !ok(v.len(), 1))
            || self.coc.is_some_and(|v| !ok(v.len(), 1))
        {
            return Err(PostError::new("a pass has the wrong size"));
        }
        Ok(())
    }
}

/// Added to display-linear values before their logarithm, so black stays finite.
pub(crate) const LOG_EPS: f32 = 1.0 / 1024.0;

/// Rec. 709 luminance weights (they also split a log ratio into luminance and colour).
pub(crate) const LUMA: [f32; 3] = [0.2126, 0.7152, 0.0722];

/// Exposure and tone curve: scene-linear to display-linear in `[0, 1]`.
#[derive(Clone, Copy, Debug)]
pub(crate) struct Display {
    tonemap: Tonemap,
    gain: f32,
}

impl Display {
    pub(crate) fn of(job: &Job) -> Display {
        Display {
            tonemap: job.tonemap,
            gain: rt_core::color::exposure(job.exposure_ev),
        }
    }

    /// Display-linear RGB of one scene-linear pixel. Non-finite input shows as black.
    pub(crate) fn apply(&self, r: f32, g: f32, b: f32) -> [f32; 3] {
        let finite = |v: f32| if v.is_finite() { v } else { 0.0 };
        let c = self
            .tonemap
            .apply(Rgb::new(finite(r), finite(g), finite(b)) * self.gain);
        [
            c.r.clamp(0.0, 1.0),
            c.g.clamp(0.0, 1.0),
            c.b.clamp(0.0, 1.0),
        ]
    }

    /// Display-linear RGB of a whole RGBA image, 3 floats a pixel.
    pub(crate) fn image(&self, rgba: &[f32]) -> Vec<f32> {
        let mut out = Vec::with_capacity(rgba.len() / 4 * 3);
        for px in rgba.chunks_exact(4) {
            out.extend_from_slice(&self.apply(px[0], px[1], px[2]));
        }
        out
    }
}

/// One display-linear value as an 8-bit sRGB code, rounded like `Film::to_srgb8_tonemapped`.
#[inline]
pub(crate) fn encode8(v: f32) -> u8 {
    (srgb_encode(v) * 255.0 + 0.5) as u8
}

/// Display-linear value of every 8-bit sRGB code.
pub(crate) fn decode_table() -> [f32; 256] {
    let mut t = [0.0f32; 256];
    for (i, v) in t.iter_mut().enumerate() {
        let c = i as f32 / 255.0;
        *v = if c <= 0.040_45 {
            c / 12.92
        } else {
            fmath::powf((c + 0.055) / 1.055, 2.4)
        };
    }
    t
}

/// Luminance of a display-linear pixel.
#[inline]
pub(crate) fn luma(c: &[f32]) -> f32 {
    LUMA[0] * c[0] + LUMA[1] * c[1] + LUMA[2] * c[2]
}

/// `ln(v + LOG_EPS)`.
#[inline]
pub(crate) fn ln_eps(v: f32) -> f32 {
    fmath::ln(v + LOG_EPS)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::job::Settings;

    #[test]
    fn decoding_inverts_encoding_for_every_code() {
        let table = decode_table();
        for (code, &v) in table.iter().enumerate() {
            assert_eq!(encode8(v) as usize, code, "code {code} -> {v}");
        }
        assert_eq!(table[0], 0.0);
        assert!((table[255] - 1.0).abs() < 1e-6);
    }

    #[test]
    fn the_display_is_the_engine_film_conversion() {
        // Same bytes as Film::to_srgb8_tonemapped for a few pixels and every curve.
        for tonemap in 0..5 {
            let mut job = Job::new(1, 1, Settings::NONE);
            job.tonemap = Tonemap::from_u32(tonemap);
            job.exposure_ev = 0.5;
            let display = Display::of(&job);
            let mut film = rt_core::image::Film::new(4, 1);
            let pixels = [
                [0.0, 0.0, 0.0],
                [0.18, 0.18, 0.18],
                [0.9, 0.3, 0.05],
                [4.0, 2.0, 1.0],
            ];
            for (x, p) in pixels.iter().enumerate() {
                film.splat(x as u32, 0, Rgb::new(p[0], p[1], p[2]));
            }
            let want = film.to_srgb8_tonemapped(0.5, job.tonemap);
            let got: Vec<u8> = pixels
                .iter()
                .flat_map(|p| display.apply(p[0], p[1], p[2]))
                .map(encode8)
                .collect();
            assert_eq!(got, want, "tonemap {tonemap}");
        }
        let display = Display::of(&Job::new(1, 1, Settings::NONE));
        assert_eq!(
            display.apply(f32::NAN, f32::INFINITY, -1.0),
            [0.0, 0.0, 0.0]
        );
    }
}
