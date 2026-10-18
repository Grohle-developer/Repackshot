//! The **test model** (X6): a deterministic stand-in for an img2img model, for the tests, the
//! stored example of the interface's preview (`tools/ai-preview-sheet.mjs`) and the desktop
//! pipeline's fake runtime (`rt-fake-sd`'s `model` image). It is not a model and it learns nothing:
//! it does what a well-behaved small img2img model does to a product render at a given strength,
//! in every band the guard separates, so that each control of the configurator has something to
//! act on and its effect can be measured:
//!
//! * **light**: the low band of the luminance is pulled towards a mid tone (the shadows open, the
//!   highlights roll off), as a model that "makes the light more natural" does;
//! * **bounce**: the shadows take a warm colour, as light bounced from a warm surroundings;
//! * **common**: the whole picture is a little warmer (the habit of many models);
//! * **mid band**: a seeded micro-variation of 3 and 6 px (what Wear may let into materials);
//! * **high band**: a seeded per-pixel grain (what no control lets through: the guard keeps the
//!   engine's high band).
//!
//! Every change scales with the strength (0 returns the input bit for bit), the seed moves the
//! grain, the micro-variation and a slight wobble of the light, and it **ignores the prompt**, as a
//! small img2img model largely does. The grain and the micro-variation follow the image's
//! coordinates (the tile's origin is given), so overlapping tiles draw the same pattern.

use crate::blur::gaussian;
use crate::image::{decode_table, encode8, luma, Rgb8Image};
use crate::TileRequest;
use rt_core::fmath;

/// The mid tone the light is pulled towards (display-linear luminance).
const MID: f32 = 0.25;
/// How strongly, per unit of strength (natural log of the gain per natural log of distance).
const LIGHT: f32 = 0.35;
/// Below this low-band luminance a pixel is in the shade (where the bounce colours it).
const SHADE: f32 = 0.5;
/// The bounce's colour per unit of strength, scene log per channel, at full shade.
const BOUNCE: [f32; 3] = [0.35, 0.10, -0.25];
/// The common warming per unit of strength.
const COMMON: [f32; 3] = [0.06, 0.01, -0.05];
/// Amplitude of the micro-variation per unit of strength (natural log of luminance).
const MID_BAND: f32 = 0.3;
/// Amplitude of the grain per unit of strength (8-bit codes).
const GRAIN: f32 = 4.0;

/// A 32-bit hash of a lattice point and the seed.
fn hash(x: i32, y: i32, seed: u32, salt: u32) -> u32 {
    let mut h = (x as u32).wrapping_mul(0x9E37_79B1)
        ^ (y as u32).wrapping_mul(0x85EB_CA77)
        ^ seed.wrapping_mul(0xC2B2_AE3D)
        ^ salt.wrapping_mul(0x27D4_EB2F);
    h ^= h >> 15;
    h = h.wrapping_mul(0x2C1B_3C6D);
    h ^= h >> 12;
    h = h.wrapping_mul(0x297A_2D39);
    h ^ (h >> 15)
}

/// `hash` as a value in `[-1, 1)`.
fn signed(h: u32) -> f32 {
    (h >> 8) as f32 / (1u32 << 23) as f32 - 1.0
}

/// Smooth value noise in `[-1, 1]` on a lattice of `cell` pixels.
fn value_noise(x: f32, y: f32, cell: f32, seed: u32, salt: u32) -> f32 {
    let (gx, gy) = (x / cell, y / cell);
    let (ix, iy) = (gx.floor(), gy.floor());
    let (fx, fy) = (gx - ix, gy - iy);
    let (sx, sy) = (fx * fx * (3.0 - 2.0 * fx), fy * fy * (3.0 - 2.0 * fy));
    let (ix, iy) = (ix as i32, iy as i32);
    let v = |dx: i32, dy: i32| signed(hash(ix + dx, iy + dy, seed, salt));
    let top = v(0, 0) + (v(1, 0) - v(0, 0)) * sx;
    let bottom = v(0, 1) + (v(1, 1) - v(0, 1)) * sx;
    top + (bottom - top) * sy
}

/// The test model on one image whose top-left pixel is `(x0, y0)` of the job's image.
pub fn apply(input: &Rgb8Image, x0: u32, y0: u32, strength: f32, seed: u32) -> Rgb8Image {
    let s = if strength.is_finite() {
        strength.clamp(0.0, 1.0)
    } else {
        0.0
    };
    let (w, h) = (input.width as usize, input.height as usize);
    if s == 0.0 || w == 0 || h == 0 || input.rgb.len() != w * h * 3 {
        return input.clone();
    }
    let table = decode_table();
    let disp: Vec<f32> = input.rgb.iter().map(|&b| table[b as usize]).collect();
    let y: Vec<f32> = disp.chunks_exact(3).map(luma).collect();
    let sigma = (0.04 * w.max(h) as f32).max(4.0);
    let low = gaussian(&y, w, h, sigma);
    let mut rgb = Vec::with_capacity(w * h * 3);
    for j in 0..h {
        for i in 0..w {
            let p = j * w + i;
            let (x, yy) = ((x0 as usize + i) as f32, (y0 as usize + j) as f32);
            let lb = low[p].max(0.0);
            let wobble = 1.0 + 0.05 * value_noise(x, yy, 192.0, seed, 1);
            let light =
                (s * LIGHT * wobble * (fmath::ln(MID) - fmath::ln(lb + 1.0e-3))).clamp(-0.5, 0.5);
            let shade = (1.0 - lb / SHADE).clamp(0.0, 1.0);
            let mid = s
                * MID_BAND
                * (0.6 * value_noise(x, yy, 3.0, seed, 2) + 0.4 * value_noise(x, yy, 6.0, seed, 3));
            for c in 0..3 {
                let g = light + s * shade * BOUNCE[c] + s * COMMON[c] + mid;
                let v = disp[p * 3 + c] * fmath::exp(g);
                let grain = s * GRAIN * signed(hash(x as i32, yy as i32, seed, 4 + c as u32));
                let code = f32::from(encode8(v.clamp(0.0, 1.0))) + grain;
                rgb.push(code.round().clamp(0.0, 255.0) as u8);
            }
        }
    }
    Rgb8Image {
        width: input.width,
        height: input.height,
        rgb,
    }
}

/// The test model as the driver calls a model ([`crate::run`]).
pub fn model(req: &TileRequest) -> Rgb8Image {
    apply(req.input, req.tile.x, req.tile.y, req.strength, req.seed)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn grey(w: u32, h: u32) -> Rgb8Image {
        let rgb = (0..w * h)
            .flat_map(|p| {
                let v = (40 + (p % w) * 160 / w) as u8;
                [v, v, v]
            })
            .collect();
        Rgb8Image {
            width: w,
            height: h,
            rgb,
        }
    }

    #[test]
    fn it_does_more_with_more_strength_and_nothing_at_zero() {
        let img = grey(64, 48);
        assert_eq!(apply(&img, 0, 0, 0.0, 7), img);
        let change = |s: f32| -> u64 {
            let out = apply(&img, 0, 0, s, 7);
            out.rgb
                .iter()
                .zip(&img.rgb)
                .map(|(&a, &b)| u64::from(a.abs_diff(b)))
                .sum()
        };
        let steps: Vec<u64> = [0.1, 0.2, 0.4, 0.6].map(change).to_vec();
        assert!(steps.windows(2).all(|w| w[0] < w[1]), "{steps:?}");
        // Deterministic, and the seed moves it.
        assert_eq!(apply(&img, 0, 0, 0.3, 7), apply(&img, 0, 0, 0.3, 7));
        assert_ne!(apply(&img, 0, 0, 0.3, 7), apply(&img, 0, 0, 0.3, 8));
        // The grain and the micro-variation follow the image's coordinates, not the tile's.
        assert_ne!(apply(&img, 0, 0, 0.3, 7), apply(&img, 5, 0, 0.3, 7));
    }
}
