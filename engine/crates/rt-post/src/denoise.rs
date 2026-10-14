//! Our own denoiser (E5b-1): an edge-avoiding à-trous wavelet filter guided by the exact passes
//! and by each pixel's sample variance. Written from the public papers, with no network and no
//! third-party weights:
//!
//! * H. Dammertz, D. Sewtz, J. Hanika and H. P. A. Lensch, "Edge-Avoiding À-Trous Wavelet
//!   Transform for fast Global Illumination Filtering", *High Performance Graphics* 2010: the
//!   B3-spline kernel `(1, 4, 6, 4, 1) / 16`, five passes whose taps spread `2^k` pixels apart,
//!   each tap weighted by edge-stopping functions of the guides.
//! * C. Schied et al., "Spatiotemporal Variance-Guided Filtering: Real-Time Reconstruction for
//!   Path-Traced Global Illumination", *High Performance Graphics* 2017: the luminance
//!   edge-stopping function `exp(-|l_p - l_q| / (σ_l √g(Var_p)))` with the variance filtered by a
//!   3 × 3 Gaussian, the variance carried from pass to pass (`Σ w² Var / (Σ w)²`), the normal
//!   weight `max(0, n_p · n_q)^σ_n` and the depth weight `exp(-|z_p - z_q| / (σ_z |∇z · Δ|))`,
//!   with their parameters (σ_l = 4, σ_n = 128, σ_z = 1), the illumination filtered with the
//!   albedo divided out and multiplied back, and the spatial estimate of the variance (7 × 7) where
//!   a pixel has too few samples for its own (fewer than four).
//!
//! What is ours: a firefly (a pixel [`FIREFLY_RATIO`] times brighter than every neighbour on its
//! surface) is brought down to that before filtering, which the edge-stopping functions would
//! otherwise leave as it is; the variance comes from the film itself (the sum of squared luminance next to
//! the radiance: `Var = (E[l²] - E[l]²) / (n - 1)` of the mean of `n` samples, Film::lum2), the
//! guides are the exact passes of X2 (albedo, normal, depth, part id, material id), and a tap of
//! another part or another material (or the background) has weight zero: **the filter never mixes
//! two parts**, and it leaves the background (part id 0) as it is. The exponentials of the
//! edge-stopping functions are `(1 - x/16)^16` (their limit definition, four squarings). Everything
//! is `f32` (no `std` transcendental), in a fixed order: the same input gives the same
//! bits natively and in WebAssembly, and a band of rows ([`denoise_rows`]) is exactly those rows
//! of the whole image, so hosts can split the work among threads or workers.
//!
//! Two presets ([`Preset`], U11): [`Preset::FULL`], the filter above, for a render; and
//! [`Preset::VIEWPORT`], lighter, for the live denoise of the viewport while it accumulates (fewer
//! passes, a smaller neighbourhood for the spatial variance), so it keeps up with the image. Each
//! has its own halo ([`Preset::halo`]); a band of either is exactly those rows of the whole image.

use rt_core::image::Film;
use rt_core::passes::{
    Passes, PASS_ALBEDO, PASS_DEPTH, PASS_MATERIAL_ID, PASS_NORMAL, PASS_PART_ID,
};

/// The exact passes the filter is guided by: a host that denoises renders at least these.
pub const GUIDE_PASSES: u32 =
    PASS_ALBEDO | PASS_NORMAL | PASS_DEPTH | PASS_PART_ID | PASS_MATERIAL_ID;

/// Passes of the filter (taps `1, 2, 4, 8, 16` pixels apart).
pub const LEVELS: u32 = 5;
/// σ_l of the luminance edge-stopping function (Schied et al. 2017).
pub const SIGMA_LUMINANCE: f32 = 4.0;
/// Exponent of the normal weight (Schied et al. 2017).
pub const SIGMA_NORMAL: u32 = 128;
/// σ_z of the depth weight (Schied et al. 2017).
pub const SIGMA_DEPTH: f32 = 1.0;
/// Albedo difference (sum over the channels) at which a tap's weight falls to `1/e`.
pub const SIGMA_ALBEDO: f32 = 0.1;
/// Below this many samples a pixel's variance is estimated from its neighbours.
pub const MIN_SAMPLES_FOR_VARIANCE: u32 = 4;
/// Rows a band must hold above and below the rows it computes: the reach of the whole filter
/// (the 7 × 7 variance estimate, the depth gradient, then `2 · 2^k` per pass), rounded up
/// ([`Preset::FULL`]'s [`Preset::halo`]).
pub const HALO: u32 = Preset::FULL.halo();

/// How hard the filter works (U11): the passes of the à-trous transform and the neighbourhood of
/// the spatial variance estimate (below [`MIN_SAMPLES_FOR_VARIANCE`] samples). Everything else
/// (the edge-stopping functions and their parameters, the firefly clamp, the guides) is the same.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Preset {
    /// Passes of the transform, taps `1, 2, … 2^(levels - 1)` pixels apart (1 to [`LEVELS`]).
    pub levels: u32,
    /// The spatial variance estimate looks `radius` pixels around (3: 7 × 7; 1 to 3).
    pub variance_radius: u32,
}

impl Preset {
    /// The final render's filter (E5b-1): five passes, the 7 × 7 variance estimate.
    pub const FULL: Preset = Preset {
        levels: LEVELS,
        variance_radius: 3,
    };
    /// The viewport's live filter (U11): three passes (taps 1, 2, 4 apart) and a 3 × 3 variance
    /// estimate. Measured against references of 1024 samples (ROADMAP U11): from eight samples on
    /// its error is within 3 % of the full filter's, at four within 3 to 11 %, below four from
    /// better (the smaller neighbourhood mixes less across features) to worse on smooth surfaces;
    /// in about 60 % of the time on one thread, and 40 % in bands (its halo is a third).
    pub const VIEWPORT: Preset = Preset {
        levels: 3,
        variance_radius: 1,
    };

    /// Rows a band of this preset holds above and below the rows it computes: `2^(levels + 1) + 8`,
    /// more than the filter's reach (the variance estimate, the firefly clamp and the depth
    /// gradient, at most 6 rows, and then `2 · 2^k + 1` per pass), so the band's rows are exactly
    /// the whole image's: 72 for the full filter, 24 for the viewport's.
    pub const fn halo(self) -> u32 {
        (2 << self.levels) + 8
    }

    /// The preset with its fields in their ranges.
    const fn clamped(self) -> Preset {
        let levels = if self.levels < 1 {
            1
        } else if self.levels > LEVELS {
            LEVELS
        } else {
            self.levels
        };
        let variance_radius = if self.variance_radius < 1 {
            1
        } else if self.variance_radius > 3 {
            3
        } else {
            self.variance_radius
        };
        Preset {
            levels,
            variance_radius,
        }
    }
}
/// Smallest albedo divided out (black materials keep their light).
const MIN_ALBEDO: f32 = 0.01;
/// A pixel brighter than this many times its brightest neighbour is a firefly.
pub const FIREFLY_RATIO: f32 = 4.0;
/// ...and brighter than this (linear, after the albedo is divided out): dark noise is no firefly.
const FIREFLY_FLOOR: f32 = 0.05;
/// The B3-spline kernel.
const KERNEL: [f32; 5] = [1.0 / 16.0, 1.0 / 4.0, 3.0 / 8.0, 1.0 / 4.0, 1.0 / 16.0];
/// The 3 × 3 Gaussian of the variance.
const GAUSS3: [f32; 3] = [0.25, 0.5, 0.25];

/// What the filter reads: (a band of rows of) the accumulated image and its passes. Every slice
/// holds `width × rows` pixels from row `origin_y` of the image, in rows from the top.
#[derive(Clone, Copy, Debug)]
pub struct DenoiseInput<'a> {
    /// Image width.
    pub width: u32,
    /// Image height.
    pub height: u32,
    /// The image row of the slices' first row.
    pub origin_y: u32,
    /// Rows in the slices.
    pub rows: u32,
    /// Samples summed into every pixel.
    pub samples: u32,
    /// Sums of premultiplied radiance and coverage, RGBA (4 per pixel).
    pub sums: &'a [f32],
    /// Sums of the squared luminance of the samples (1 per pixel, `Film::lum2`).
    pub lum2: &'a [f32],
    /// Mean albedo (3 per pixel, the `albedo` pass).
    pub albedo: &'a [f32],
    /// Unit normal facing the camera (3 per pixel, the `normal` pass).
    pub normal: &'a [f32],
    /// Depth along the view axis (1 per pixel; +∞ on the background).
    pub depth: &'a [f32],
    /// Part ids (0: background).
    pub part_id: &'a [u32],
    /// Material ids.
    pub material_id: &'a [u32],
}

/// Why the filter refused its input.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum DenoiseError {
    /// A slice is not as long as the band says, or the band is not inside the image.
    Shape(&'static str),
    /// The rows asked for are not in the band with their halo.
    Rows,
}

impl std::fmt::Display for DenoiseError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            DenoiseError::Shape(what) => write!(f, "denoise: {what} does not fit the image"),
            DenoiseError::Rows => write!(f, "denoise: the band does not hold the rows' halo"),
        }
    }
}

impl std::error::Error for DenoiseError {}

impl<'a> DenoiseInput<'a> {
    /// The whole image: its RGBA sums and squared-luminance sums of `samples` samples, and its
    /// resolved passes (which must hold [`GUIDE_PASSES`]).
    pub fn whole(
        samples: u32,
        sums: &'a [f32],
        lum2: &'a [f32],
        passes: &'a Passes,
    ) -> Result<DenoiseInput<'a>, DenoiseError> {
        if passes.mask & GUIDE_PASSES != GUIDE_PASSES {
            return Err(DenoiseError::Shape("the passes"));
        }
        let input = DenoiseInput {
            width: passes.width,
            height: passes.height,
            origin_y: 0,
            rows: passes.height,
            samples,
            sums,
            lum2,
            albedo: &passes.albedo,
            normal: &passes.normal,
            depth: &passes.depth,
            part_id: &passes.part_id,
            material_id: &passes.material_id,
        };
        input.check()?;
        Ok(input)
    }

    /// The band of this input that [`denoise_rows`] needs for image rows `y0 .. y1`: those rows
    /// and [`HALO`] rows around them, within the image and within this input.
    pub fn with_halo(&self, y0: u32, y1: u32) -> DenoiseInput<'a> {
        self.with_halo_of(y0, y1, Preset::FULL)
    }

    /// The band of this input that [`denoise_rows_with`] needs for image rows `y0 .. y1` with
    /// `preset`: those rows and its [`Preset::halo`] rows around them, within the image and within
    /// this input.
    pub fn with_halo_of(&self, y0: u32, y1: u32, preset: Preset) -> DenoiseInput<'a> {
        let halo = preset.clamped().halo();
        let lo = y0.saturating_sub(halo).max(self.origin_y);
        let hi = y1
            .saturating_add(halo)
            .min(self.height)
            .min(self.origin_y + self.rows)
            .max(lo);
        let w = self.width as usize;
        let (a, b) = (
            (lo - self.origin_y) as usize * w,
            (hi - self.origin_y) as usize * w,
        );
        let cut = |n: usize, len: usize| (a * n).min(len)..(b * n).min(len);
        DenoiseInput {
            origin_y: lo,
            rows: hi - lo,
            sums: &self.sums[cut(4, self.sums.len())],
            lum2: &self.lum2[cut(1, self.lum2.len())],
            albedo: &self.albedo[cut(3, self.albedo.len())],
            normal: &self.normal[cut(3, self.normal.len())],
            depth: &self.depth[cut(1, self.depth.len())],
            part_id: &self.part_id[cut(1, self.part_id.len())],
            material_id: &self.material_id[cut(1, self.material_id.len())],
            ..*self
        }
    }

    fn check(&self) -> Result<usize, DenoiseError> {
        if self.width == 0 || self.origin_y.saturating_add(self.rows) > self.height {
            return Err(DenoiseError::Shape("the band"));
        }
        let n = self.width as usize * self.rows as usize;
        let checks: [(usize, usize, &'static str); 7] = [
            (self.sums.len(), n * 4, "sums"),
            (self.lum2.len(), n, "lum2"),
            (self.albedo.len(), n * 3, "albedo"),
            (self.normal.len(), n * 3, "normal"),
            (self.depth.len(), n, "depth"),
            (self.part_id.len(), n, "part_id"),
            (self.material_id.len(), n, "material_id"),
        ];
        for (len, want, what) in checks {
            if len != want {
                return Err(DenoiseError::Shape(what));
            }
        }
        Ok(n)
    }
}

/// The RGBA sums of a film (radiance and coverage, 4 per pixel): what the hosts publish and the
/// filter reads.
pub fn rgba_sums(film: &Film) -> Vec<f32> {
    let mut out = Vec::with_capacity(film.alpha.len() * 4);
    for (rgb, &a) in film.rgb.chunks_exact(3).zip(&film.alpha) {
        out.extend_from_slice(rgb);
        out.push(a);
    }
    out
}

/// Denoises every row of the input with the full filter: RGBA sums (`samples` × the denoised
/// mean, coverage as it was), `width × rows` pixels.
pub fn denoise(input: &DenoiseInput) -> Result<Vec<f32>, DenoiseError> {
    denoise_with(input, Preset::FULL)
}

/// [`denoise`] with another preset.
pub fn denoise_with(input: &DenoiseInput, preset: Preset) -> Result<Vec<f32>, DenoiseError> {
    denoise_rows_with(input, input.origin_y, input.origin_y + input.rows, preset)
}

/// Denoises image rows `y0 .. y1` with the full filter, which the input must hold with [`HALO`]
/// rows around them (or up to the image's edge): exactly those rows of [`denoise`] over the whole
/// image. RGBA sums, `width × (y1 - y0)` pixels.
pub fn denoise_rows(input: &DenoiseInput, y0: u32, y1: u32) -> Result<Vec<f32>, DenoiseError> {
    denoise_rows_with(input, y0, y1, Preset::FULL)
}

/// [`denoise_rows`] with another preset: the input must hold the rows with its
/// [`Preset::halo`] around them, and they are exactly those rows of [`denoise_with`] over the
/// whole image with the same preset.
pub fn denoise_rows_with(
    input: &DenoiseInput,
    y0: u32,
    y1: u32,
    preset: Preset,
) -> Result<Vec<f32>, DenoiseError> {
    let n = input.check()?;
    let preset = preset.clamped();
    let halo = preset.halo();
    let band_end = input.origin_y + input.rows;
    if y0 > y1
        || y0 < input.origin_y
        || y1 > band_end
        || input.origin_y > y0.saturating_sub(halo)
        || band_end < y1.saturating_add(halo).min(input.height)
    {
        return Err(DenoiseError::Rows);
    }
    let filtered = filter_band(input, n, preset);
    let w = input.width as usize;
    let from = (y0 - input.origin_y) as usize * w * 4;
    let to = (y1 - input.origin_y) as usize * w * 4;
    Ok(filtered[from..to].to_vec())
}

/// Rec. 709 luminance, as `rt_core::color::Rgb::luminance`.
#[inline]
fn luminance(r: f32, g: f32, b: f32) -> f32 {
    0.2126 * r + 0.7152 * g + 0.0722 * b
}

/// `x^128` for `x >= 0`: seven squarings.
#[inline]
fn pow128(x: f32) -> f32 {
    let mut v = x;
    for _ in 0..7 {
        v *= v;
    }
    v
}

/// The guides of one pixel.
#[derive(Clone, Copy)]
struct Guide {
    part: u32,
    material: u32,
    n: [f32; 3],
    z: f32,
    /// Depth gradient per pixel along x and y.
    dz: [f32; 2],
    a: [f32; 3],
}

impl Guide {
    #[inline]
    fn foreground(&self) -> bool {
        self.part != 0
    }

    #[inline]
    fn same_surface(&self, o: &Guide) -> bool {
        self.part == o.part && self.material == o.material
    }
}

/// The filter over the whole band (rows outside it count as missing): RGBA sums.
fn filter_band(input: &DenoiseInput, n: usize, preset: Preset) -> Vec<f32> {
    let (w, h) = (input.width as usize, input.rows as usize);
    let samples = input.samples.max(1);
    let inv = 1.0 / samples as f32;
    let mut out = input.sums.to_vec();

    // Guides, the albedo divisor, the illumination and its variance.
    let mut guides = Vec::with_capacity(n);
    for p in 0..n {
        let finite = |v: f32| if v.is_finite() { v } else { 0.0 };
        guides.push(Guide {
            part: input.part_id[p],
            material: input.material_id[p],
            n: [
                finite(input.normal[p * 3]),
                finite(input.normal[p * 3 + 1]),
                finite(input.normal[p * 3 + 2]),
            ],
            z: input.depth[p],
            dz: [0.0, 0.0],
            a: [
                finite(input.albedo[p * 3]),
                finite(input.albedo[p * 3 + 1]),
                finite(input.albedo[p * 3 + 2]),
            ],
        });
    }
    for y in 0..h {
        for x in 0..w {
            let p = y * w + x;
            let g = guides[p];
            if !g.foreground() || !g.z.is_finite() {
                continue;
            }
            let grad = |a: Option<usize>, b: Option<usize>| -> f32 {
                let z = |q: Option<usize>| {
                    q.filter(|&q| guides[q].same_surface(&g) && guides[q].z.is_finite())
                        .map(|q| guides[q].z)
                };
                match (z(a), z(b)) {
                    (Some(za), Some(zb)) => 0.5 * (zb - za),
                    (Some(za), None) => g.z - za,
                    (None, Some(zb)) => zb - g.z,
                    (None, None) => 0.0,
                }
            };
            let left = (x > 0).then(|| p - 1);
            let right = (x + 1 < w).then(|| p + 1);
            let up = (y > 0).then(|| p - w);
            let down = (y + 1 < h).then(|| p + w);
            guides[p].dz = [grad(left, right), grad(up, down)];
        }
    }
    let mut divisor = vec![1.0f32; n * 3];
    let mut light = vec![0.0f32; n * 3];
    let mut var = vec![0.0f32; n];
    for p in 0..n {
        let g = &guides[p];
        if !g.foreground() {
            continue;
        }
        let c = [
            input.sums[p * 4] * inv,
            input.sums[p * 4 + 1] * inv,
            input.sums[p * 4 + 2] * inv,
        ];
        for k in 0..3 {
            let d = g.a[k].max(MIN_ALBEDO);
            divisor[p * 3 + k] = d;
            light[p * 3 + k] = c[k] / d;
        }
        if samples >= MIN_SAMPLES_FOR_VARIANCE {
            let l = luminance(c[0], c[1], c[2]);
            let m2 = input.lum2[p] * inv;
            let v = (m2 - l * l).max(0.0) / (samples - 1) as f32;
            let ld = luminance(divisor[p * 3], divisor[p * 3 + 1], divisor[p * 3 + 2]);
            var[p] = v / (ld * ld);
        }
    }
    let lum_of =
        |light: &[f32], p: usize| luminance(light[p * 3], light[p * 3 + 1], light[p * 3 + 2]);
    // Fireflies: a pixel many times brighter than every neighbour on its surface (3 × 3) is
    // brought down to [`FIREFLY_RATIO`] times the brightest of them, and takes their largest
    // variance; the edge-stopping functions would otherwise keep it as it is. (Its excess of
    // energy is lost: that is the price of not smearing it.)
    let before: Vec<f32> = (0..n).map(|p| lum_of(&light, p)).collect();
    for y in 0..h {
        for x in 0..w {
            let p = y * w + x;
            let g = guides[p];
            if !g.foreground() {
                continue;
            }
            let (mut brightest, mut count, mut vmax) = (0.0f32, 0u32, 0.0f32);
            for dy in -1i32..=1 {
                for dx in -1i32..=1 {
                    let (qx, qy) = (x as i32 + dx, y as i32 + dy);
                    if (dx == 0 && dy == 0) || qx < 0 || qy < 0 || qx >= w as i32 || qy >= h as i32
                    {
                        continue;
                    }
                    let q = qy as usize * w + qx as usize;
                    if !g.same_surface(&guides[q]) {
                        continue;
                    }
                    brightest = brightest.max(before[q]);
                    vmax = vmax.max(var[q]);
                    count += 1;
                }
            }
            let limit = FIREFLY_RATIO * brightest + FIREFLY_FLOOR;
            if count >= 3 && before[p] > limit {
                let k = limit / before[p];
                for c in 0..3 {
                    light[p * 3 + c] *= k;
                }
                var[p] = vmax;
            }
        }
    }
    if samples < MIN_SAMPLES_FOR_VARIANCE {
        // Too few samples for a pixel's own variance: the spread of its neighbours on the same
        // surface (7 × 7 with the full filter, normal and depth weights).
        let r = preset.variance_radius as i32;
        for y in 0..h {
            for x in 0..w {
                let p = y * w + x;
                let g = guides[p];
                if !g.foreground() {
                    continue;
                }
                let (mut sw, mut m1, mut m2) = (0.0f32, 0.0f32, 0.0f32);
                for dy in -r..=r {
                    let qy = y as i32 + dy;
                    if qy < 0 || qy >= h as i32 {
                        continue;
                    }
                    for dx in -r..=r {
                        let qx = x as i32 + dx;
                        if qx < 0 || qx >= w as i32 {
                            continue;
                        }
                        let q = qy as usize * w + qx as usize;
                        let gq = &guides[q];
                        if !g.same_surface(gq) {
                            continue;
                        }
                        let wgt = surface_weight(&g, gq, dx as f32, dy as f32);
                        let l = lum_of(&light, q);
                        sw += wgt;
                        m1 += wgt * l;
                        m2 += wgt * l * l;
                    }
                }
                if sw > 0.0 {
                    let (m1, m2) = (m1 / sw, m2 / sw);
                    var[p] = (m2 - m1 * m1).max(0.0);
                }
            }
        }
    }

    // The passes of the à-trous transform.
    let mut next_light = light.clone();
    let mut next_var = var.clone();
    let mut gvar = vec![0.0f32; n];
    let mut lum = vec![0.0f32; n];
    for level in 0..preset.levels {
        let step = 1i32 << level;
        for (p, l) in lum.iter_mut().enumerate() {
            *l = lum_of(&light, p);
        }
        // The variance, blurred by a 3 × 3 Gaussian on the same surface.
        for y in 0..h {
            for x in 0..w {
                let p = y * w + x;
                let g = guides[p];
                if !g.foreground() {
                    continue;
                }
                let (mut sw, mut sv) = (0.0f32, 0.0f32);
                for (j, ky) in GAUSS3.iter().enumerate() {
                    let qy = y as i32 + j as i32 - 1;
                    if qy < 0 || qy >= h as i32 {
                        continue;
                    }
                    for (i, kx) in GAUSS3.iter().enumerate() {
                        let qx = x as i32 + i as i32 - 1;
                        if qx < 0 || qx >= w as i32 {
                            continue;
                        }
                        let q = qy as usize * w + qx as usize;
                        if !g.same_surface(&guides[q]) {
                            continue;
                        }
                        let k = ky * kx;
                        sw += k;
                        sv += k * var[q];
                    }
                }
                gvar[p] = if sw > 0.0 { sv / sw } else { var[p] };
            }
        }
        for y in 0..h {
            for x in 0..w {
                let p = y * w + x;
                let g = guides[p];
                if !g.foreground() {
                    continue;
                }
                let lp = lum[p];
                let inv_sigma_l = 1.0 / (SIGMA_LUMINANCE * (gvar[p].max(0.0) + 1.0e-10).sqrt());
                let (mut sw, mut sv) = (0.0f32, 0.0f32);
                let mut sc = [0.0f32; 3];
                for (j, ky) in KERNEL.iter().enumerate() {
                    let dy = (j as i32 - 2) * step;
                    let qy = y as i32 + dy;
                    if qy < 0 || qy >= h as i32 {
                        continue;
                    }
                    for (i, kx) in KERNEL.iter().enumerate() {
                        let dx = (i as i32 - 2) * step;
                        let qx = x as i32 + dx;
                        if qx < 0 || qx >= w as i32 {
                            continue;
                        }
                        let q = qy as usize * w + qx as usize;
                        let gq = &guides[q];
                        if !g.same_surface(gq) {
                            continue;
                        }
                        let wn = if q == p {
                            1.0
                        } else {
                            pow128(dot3(g.n, gq.n).max(0.0))
                        };
                        if wn <= 0.0 {
                            continue;
                        }
                        let exponent = (lp - lum[q]).abs() * inv_sigma_l
                            + depth_term(&g, gq, dx as f32, dy as f32)
                            + albedo_term(&g, gq);
                        let wgt = ky * kx * wn * falloff(exponent);
                        sw += wgt;
                        sv += wgt * wgt * var[q];
                        for k in 0..3 {
                            sc[k] += wgt * light[q * 3 + k];
                        }
                    }
                }
                // The centre tap always counts (weight 9/64), so `sw` is positive.
                let inv_w = 1.0 / sw;
                for k in 0..3 {
                    next_light[p * 3 + k] = sc[k] * inv_w;
                }
                next_var[p] = sv * inv_w * inv_w;
            }
        }
        std::mem::swap(&mut light, &mut next_light);
        std::mem::swap(&mut var, &mut next_var);
    }

    // The albedo multiplied back, as sums of `samples` samples.
    let count = samples as f32;
    for p in 0..n {
        if !guides[p].foreground() {
            continue;
        }
        for k in 0..3 {
            let c = light[p * 3 + k] * divisor[p * 3 + k];
            out[p * 4 + k] = if c.is_finite() {
                c * count
            } else {
                input.sums[p * 4 + k]
            };
        }
    }
    out
}

#[inline]
fn dot3(a: [f32; 3], b: [f32; 3]) -> f32 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

/// `|z_p - z_q| / (σ_z |∇z_p · Δ| + ε)`, the depth term of a tap `(dx, dy)` pixels away.
#[inline]
fn depth_term(g: &Guide, q: &Guide, dx: f32, dy: f32) -> f32 {
    if !(g.z.is_finite() && q.z.is_finite()) {
        return if g.z == q.z { 0.0 } else { f32::INFINITY };
    }
    let expected = (g.dz[0] * dx + g.dz[1] * dy).abs();
    let eps = 1.0e-3 * g.z.abs() + 1.0e-6;
    (g.z - q.z).abs() / (SIGMA_DEPTH * expected + eps)
}

/// The albedo term of a tap (sum of the channels' differences over [`SIGMA_ALBEDO`]).
#[inline]
fn albedo_term(g: &Guide, q: &Guide) -> f32 {
    ((g.a[0] - q.a[0]).abs() + (g.a[1] - q.a[1]).abs() + (g.a[2] - q.a[2]).abs()) / SIGMA_ALBEDO
}

/// `e^-x` for the edge-stopping functions, as `(1 - x/16)^16` (its limit definition; zero from
/// `x = 16`, where `e^-x` is 10⁻⁷): four squarings instead of an exponential, the same shape
/// where the weights matter. `x` is not negative (NaN gives 0).
#[inline]
fn falloff(x: f32) -> f32 {
    let t = 1.0 - x * (1.0 / 16.0);
    if t.is_nan() || t <= 0.0 {
        return 0.0;
    }
    let t = t * t;
    let t = t * t;
    let t = t * t;
    t * t
}

/// Normal and depth weight of a neighbour on the same surface (the spatial variance estimate).
#[inline]
fn surface_weight(g: &Guide, q: &Guide, dx: f32, dy: f32) -> f32 {
    pow128(dot3(g.n, q.n).max(0.0)) * falloff(depth_term(g, q, dx, dy))
}

#[cfg(test)]
mod tests;
