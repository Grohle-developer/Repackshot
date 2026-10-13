//! Gaussian filters on single-channel planes, in `f32` with a fixed order of operations.
//!
//! [`gaussian`] is a direct separable convolution for small radii (the high band). The low band
//! needs radii of 8–32 pixels; [`masked_low_pass`] computes it as a *normalised convolution*
//! (Knutsson and Westin, "Normalized and differential convolution", CVPR 1993): the blur of
//! `value × mask` divided by the blur of `mask`, so pixels outside the mask (the background, or
//! beyond the image's border) contribute nothing. Large radii are filtered on a grid up to 8
//! times coarser and brought back with the cubic B-spline (smooth to the second derivative, so the
//! low band adds nothing to the high band), which costs the same at any radius.

use rt_core::fmath;

/// Normalised Gaussian taps of standard deviation `sigma`, half-width `ceil(3 sigma)`.
pub(crate) fn kernel(sigma: f32) -> Vec<f32> {
    let radius = (3.0 * sigma).ceil().max(1.0) as i32;
    let inv = 1.0 / (2.0 * sigma * sigma);
    let taps: Vec<f32> = (-radius..=radius)
        .map(|i| fmath::exp(-((i * i) as f32) * inv))
        .collect();
    let mut sum = 0.0f32;
    for &t in &taps {
        sum += t;
    }
    taps.into_iter().map(|t| t / sum).collect()
}

/// Separable convolution with `taps` (odd length), treating everything beyond the border as 0.
fn convolve(src: &[f32], width: usize, height: usize, taps: &[f32]) -> Vec<f32> {
    let r = (taps.len() / 2) as isize;
    let mut tmp = vec![0.0f32; src.len()];
    for y in 0..height {
        let row = &src[y * width..(y + 1) * width];
        for x in 0..width {
            let mut acc = 0.0f32;
            for (k, &t) in taps.iter().enumerate() {
                let sx = x as isize + k as isize - r;
                if sx >= 0 && (sx as usize) < width {
                    acc += t * row[sx as usize];
                }
            }
            tmp[y * width + x] = acc;
        }
    }
    let mut out = vec![0.0f32; src.len()];
    for y in 0..height {
        for (k, &t) in taps.iter().enumerate() {
            let sy = y as isize + k as isize - r;
            if sy < 0 || sy as usize >= height {
                continue;
            }
            let from = &tmp[sy as usize * width..(sy as usize + 1) * width];
            let to = &mut out[y * width..(y + 1) * width];
            for (o, &v) in to.iter_mut().zip(from) {
                *o += t * v;
            }
        }
    }
    out
}

/// Gaussian blur of a plane, normalised at the border (the image's edge does not darken it).
pub(crate) fn gaussian(src: &[f32], width: usize, height: usize, sigma: f32) -> Vec<f32> {
    let taps = kernel(sigma);
    let blurred = convolve(src, width, height, &taps);
    let ones = convolve(&vec![1.0; src.len()], width, height, &taps);
    blurred.iter().zip(&ones).map(|(&v, &w)| v / w).collect()
}

/// Normalised convolution of `value` with weights `mask` (0..1), Gaussian of `sigma` pixels:
/// the mask-weighted local mean of `value`. Where the mask has (almost) no support the result is 0.
pub(crate) fn masked_low_pass(
    value: &[f32],
    mask: &[f32],
    width: usize,
    height: usize,
    sigma: f32,
) -> Vec<f32> {
    let f = ((sigma / 4.0).floor() as usize).clamp(1, 8);
    let (lw, lh) = (width.div_ceil(f), height.div_ceil(f));
    // Box sums over f x f blocks on the coarse grid.
    let mut a = vec![0.0f32; lw * lh];
    let mut b = vec![0.0f32; lw * lh];
    for y in 0..height {
        let ly = y / f;
        for x in 0..width {
            let p = y * width + x;
            let m = mask[p];
            if m != 0.0 {
                let q = ly * lw + x / f;
                a[q] += value[p] * m;
                b[q] += m;
            }
        }
    }
    let taps = kernel(sigma / f as f32);
    let a = convolve(&a, lw, lh, &taps);
    let b = convolve(&b, lw, lh, &taps);
    // Cubic B-spline interpolation of both at the full-resolution pixel centres, then the ratio.
    let xs: Vec<Spline> = (0..width).map(|x| Spline::at(x, f, lw)).collect();
    let floor = 1.0e-4 * (f * f) as f32;
    let mut out = vec![0.0f32; width * height];
    let mut row_a = vec![0.0f32; lw];
    let mut row_b = vec![0.0f32; lw];
    for y in 0..height {
        let sy = Spline::at(y, f, lh);
        for i in 0..lw {
            let (mut va, mut vb) = (0.0f32, 0.0f32);
            for k in 0..4 {
                let q = sy.index[k] * lw + i;
                va += sy.weight[k] * a[q];
                vb += sy.weight[k] * b[q];
            }
            row_a[i] = va;
            row_b[i] = vb;
        }
        for (x, sx) in xs.iter().enumerate() {
            let (mut va, mut vb) = (0.0f32, 0.0f32);
            for k in 0..4 {
                va += sx.weight[k] * row_a[sx.index[k]];
                vb += sx.weight[k] * row_b[sx.index[k]];
            }
            if vb > floor {
                out[y * width + x] = va / vb;
            }
        }
    }
    out
}

/// The four coarse samples and cubic B-spline weights of one full-resolution coordinate.
struct Spline {
    index: [usize; 4],
    weight: [f32; 4],
}

impl Spline {
    fn at(x: usize, f: usize, len: usize) -> Spline {
        let g = (x as f32 + 0.5) / f as f32 - 0.5;
        let i0 = g.floor();
        let t = g - i0;
        let (t2, t3) = (t * t, t * t * t);
        let u = 1.0 - t;
        let weight = [
            u * u * u / 6.0,
            (3.0 * t3 - 6.0 * t2 + 4.0) / 6.0,
            (-3.0 * t3 + 3.0 * t2 + 3.0 * t + 1.0) / 6.0,
            t3 / 6.0,
        ];
        let base = i0 as isize - 1;
        let index = [0, 1, 2, 3].map(|k| (base + k).clamp(0, len as isize - 1) as usize);
        Spline { index, weight }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kernels_are_normalised_and_symmetric() {
        for sigma in [0.8f32, 1.5, 4.0, 7.9] {
            let k = kernel(sigma);
            assert_eq!(k.len() % 2, 1);
            let sum: f32 = k.iter().sum();
            assert!((sum - 1.0).abs() < 1e-5);
            for i in 0..k.len() / 2 {
                assert_eq!(k[i], k[k.len() - 1 - i]);
            }
        }
    }

    #[test]
    fn a_constant_stays_constant_everywhere() {
        let (w, h) = (37usize, 23usize);
        let v = vec![0.25f32; w * h];
        for g in gaussian(&v, w, h, 1.5) {
            assert!((g - 0.25).abs() < 1e-6);
        }
        let mask = vec![1.0f32; w * h];
        for sigma in [2.0f32, 8.0, 16.0, 32.0] {
            for g in masked_low_pass(&v, &mask, w, h, sigma) {
                assert!((g - 0.25).abs() < 1e-5, "{sigma}: {g}");
            }
        }
    }

    #[test]
    fn the_mask_keeps_the_outside_out() {
        // Left half 1 inside the mask, right half 100 outside: the masked mean never sees 100.
        let (w, h) = (64usize, 32usize);
        let mut v = vec![0.0f32; w * h];
        let mut mask = vec![0.0f32; w * h];
        for y in 0..h {
            for x in 0..w {
                let inside = x < w / 2;
                v[y * w + x] = if inside { 1.0 } else { 100.0 };
                mask[y * w + x] = if inside { 1.0 } else { 0.0 };
            }
        }
        let out = masked_low_pass(&v, &mask, w, h, 16.0);
        for y in 0..h {
            for x in 0..w / 2 {
                assert!((out[y * w + x] - 1.0).abs() < 1e-4, "{x},{y}");
            }
        }
    }

    #[test]
    fn the_low_pass_is_smooth_to_the_second_derivative() {
        // A ramp low-passed and brought back from the coarse grid has no kinks: its discrete
        // second difference stays tiny everywhere inside (bilinear interpolation would spike).
        let (w, h) = (256usize, 8usize);
        let v: Vec<f32> = (0..w * h)
            .map(|p| if p % w < w / 2 { 0.0 } else { 1.0 })
            .collect();
        let mask = vec![1.0f32; w * h];
        let out = masked_low_pass(&v, &mask, w, h, 16.0);
        let row = &out[4 * w..5 * w];
        let mut worst = 0.0f32;
        for x in 40..w - 40 {
            let d2 = (row[x + 1] - 2.0 * row[x] + row[x - 1]).abs();
            let d2_prev = (row[x] - 2.0 * row[x - 1] + row[x - 2]).abs();
            worst = worst.max((d2 - d2_prev).abs());
        }
        assert!(worst < 2.0e-4, "third difference {worst}");
    }

    #[test]
    fn the_low_pass_removes_fine_detail() {
        let (w, h) = (128usize, 128usize);
        let v: Vec<f32> = (0..w * h)
            .map(|p| if (p % w) % 2 == 0 { 1.0 } else { 0.0 })
            .collect();
        let mask = vec![1.0f32; w * h];
        let out = masked_low_pass(&v, &mask, w, h, 8.0);
        for y in 16..h - 16 {
            for x in 16..w - 16 {
                assert!((out[y * w + x] - 0.5).abs() < 0.02, "{}", out[y * w + x]);
            }
        }
    }
}
