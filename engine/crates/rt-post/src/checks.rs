//! The checks (AI-POST.md §3.2 step 5): numbers measured on a result against the engine image,
//! independent of how the result was made, so they also catch what a disabled or broken guard
//! step lets through.
//!
//! Structure is measured in the log of scene-linear light (detail and focus on the luminance,
//! edges on each channel), where a change of light is a smooth additive term: its high band,
//! sharpness and edge positions do not change when only light and colour of low frequency do. The
//! tone curve is left out on purpose: it compresses the contrast of highlights exactly as it would
//! for a brighter render, which is not a blur. Colour is measured on the display, as the user sees
//! it, against the engine image under the change the controls allow.

use crate::blur::gaussian;
use crate::color::{delta_e_2000, lab};
use crate::conditioning::discontinuity;
use crate::image::{ln_eps, luma, Display, LUMA};
use crate::prepared::{Caps, Histogram, Prepared, Sum, BACKGROUND, SIGMA_HIGH};
use rt_core::fmath;

/// Half-width of the profile searched across an edge, pixels.
const EDGE_REACH: usize = 4;
/// Side of the blocks of the high-band SSIM.
const DETAIL_BLOCK: usize = 8;
/// Stabiliser of the high-band SSIM (log units squared).
const DETAIL_C: f32 = 1.0e-4;
/// Side of the blocks of the focus check.
const FOCUS_BLOCK: usize = 32;
/// Floor added to the high-band energy of a focus block.
const FOCUS_E0: f32 = 1.0e-5;
/// Detail and focus look at the inside of regions: pixels this close to an id or normal edge are
/// left to the edge check (relighting one side of a silhouette changes its step, which is not a
/// loss of detail).
const INTERIOR: usize = 4;

/// `ln(b / a)` of two scene-linear values: 0 when both are 0, bounded for a value from or to 0.
#[inline]
pub(crate) fn log_ratio(a: f32, b: f32) -> f32 {
    if a.to_bits() == b.to_bits() || (a <= 0.0 && b <= 0.0) {
        return 0.0;
    }
    (fmath::ln(b.max(1.0e-12)) - fmath::ln(a.max(1.0e-12))).clamp(-16.0, 16.0)
}

/// ΔE₀₀ between what the display shows for a result pixel (`out`, scene-linear RGB, shown as
/// `out_disp`) and what it would show for the engine pixel (`orig`, shown as `orig_disp`) under
/// the change the controls allow: the change common to the image (`grade`, scene log per channel:
/// the style) and up to `lum_allow` of scene log luminance (light and wear), both through the
/// render's own tone curve. What remains is a change of the material's colour itself; a pure
/// change of light, which the tone curve may desaturate in its shoulder, leaves nothing.
pub(crate) fn colour_delta(
    display: &Display,
    orig: [f32; 3],
    orig_disp: [f32; 3],
    out: [f32; 3],
    out_disp: [f32; 3],
    grade: [f32; 3],
    lum_allow: f32,
) -> f32 {
    if orig == out {
        return 0.0;
    }
    let mut r = [0.0f32; 3];
    for c in 0..3 {
        r[c] = log_ratio(orig[c], out[c]) - grade[c];
    }
    let y = (LUMA[0] * r[0] + LUMA[1] * r[1] + LUMA[2] * r[2]).clamp(-lum_allow, lum_allow);
    let reference = if grade == [0.0; 3] && y == 0.0 {
        orig_disp
    } else {
        let g = [0, 1, 2].map(|c| fmath::exp(grade[c] + y));
        display.apply(orig[0] * g[0], orig[1] * g[1], orig[2] * g[2])
    };
    delta_e_2000(lab(reference), lab(out_disp))
}

/// What the checks measured on one result.
#[derive(Clone, Debug)]
pub(crate) struct Measures {
    /// Pixels changed where no control may change anything.
    pub outside: u32,
    /// Worst edge displacement, pixels.
    pub edges: f32,
    /// Mean SSIM of the high band.
    pub detail: f32,
    /// Worst relative sharpness change against the blur map.
    pub focus: f32,
    /// Per region present (same order as `Prepared::regions`): ΔE₀₀ mean and 95th percentile.
    pub colour: Vec<(f32, f32)>,
}

/// The change common to the open part of the image, per channel: the median of the scene log
/// ratio over the pixels `take` selects, within what the style may change.
pub(crate) fn grade_of(
    prep: &Prepared,
    take: &dyn Fn(usize) -> bool,
    out: &dyn Fn(usize) -> [f32; 3],
    caps: &Caps,
) -> [f32; 3] {
    let mut grade = [0.0f32; 3];
    if caps.style <= 0.0 {
        return grade;
    }
    let mut hists = [0, 1, 2].map(|_| Histogram::new(-4.0, 4.0, 8192));
    for p in (0..prep.w * prep.h).filter(|&p| take(p)) {
        let o = out(p);
        for c in 0..3 {
            hists[c].add(log_ratio(prep.orig[p * 4 + c], o[c]));
        }
    }
    for c in 0..3 {
        grade[c] = hists[c].quantile(0.5).clamp(-caps.style, caps.style);
    }
    grade
}

/// How [`region_deltas`] measures one region: the change allowed there, and whether to measure it.
#[derive(Clone, Copy)]
pub(crate) struct RegionAllowance {
    pub grade: [f32; 3],
    pub lum: f32,
    pub active: bool,
}

/// Mean and 95th percentile of ΔE₀₀ of every active region, in one pass over the pixels for which
/// `take(p)` holds; `out(p)` is the result's scene-linear pixel and its display.
pub(crate) fn region_deltas(
    prep: &Prepared,
    out: &dyn Fn(usize) -> ([f32; 3], [f32; 3]),
    take: &dyn Fn(usize) -> bool,
    allow: &[RegionAllowance],
) -> Vec<(f32, f32)> {
    let mut sums = vec![Sum::default(); allow.len()];
    let mut hists: Vec<Option<Histogram>> = allow
        .iter()
        .map(|a| a.active.then(|| Histogram::new(0.0, 32.0, 4096)))
        .collect();
    for p in 0..prep.w * prep.h {
        let r = prep.region[p];
        if r == BACKGROUND {
            continue;
        }
        let Some(hist) = hists[r as usize].as_mut() else {
            continue;
        };
        if !take(p) {
            continue;
        }
        let a = &allow[r as usize];
        let (scene, shown) = out(p);
        let orig = [prep.orig[p * 4], prep.orig[p * 4 + 1], prep.orig[p * 4 + 2]];
        let orig_disp = [prep.disp[p * 3], prep.disp[p * 3 + 1], prep.disp[p * 3 + 2]];
        let d = colour_delta(&prep.display, orig, orig_disp, scene, shown, a.grade, a.lum);
        sums[r as usize].add(d);
        hist.add(d);
    }
    hists
        .iter()
        .zip(&sums)
        .map(|(h, s)| match h {
            Some(h) if h.count() > 0 => (s.get() / h.count() as f32, h.quantile(0.95)),
            _ => (0.0, 0.0),
        })
        .collect()
}

/// The luminance allowance of region `r` in one attempt: light, plus wear where it is allowed.
pub(crate) fn lum_allow(prep: &Prepared, r: u32, caps: &Caps) -> f32 {
    let region = &prep.regions[r as usize];
    if region.locked {
        0.0
    } else if region.allows_wear {
        caps.light + caps.wear
    } else {
        caps.light
    }
}

/// Peak of a gradient profile with parabolic refinement, relative to the profile's centre.
fn peak(g: &[f32]) -> f32 {
    let mut k = 0;
    for i in 1..g.len() {
        if g[i] > g[k] {
            k = i;
        }
    }
    let mut pos = k as f32;
    if k > 0 && k + 1 < g.len() {
        let denom = g[k - 1] - 2.0 * g[k] + g[k + 1];
        if denom < 0.0 {
            pos += (0.5 * (g[k - 1] - g[k + 1]) / denom).clamp(-0.5, 0.5);
        }
    }
    pos - (g.len() / 2) as f32
}

/// The log of the scene-linear RGB of an image (scaled by the exposure), 3 floats a pixel.
pub(crate) fn rgb_log(prep: &Prepared, rgba: &[f32]) -> Vec<f32> {
    let mut out = Vec::with_capacity(rgba.len() / 4 * 3);
    for px in rgba.chunks_exact(4) {
        for &v in &px[..3] {
            let v = v * prep.gain;
            out.push(ln_eps(if v.is_finite() { v.max(0.0) } else { 0.0 }));
        }
    }
    out
}

/// Worst displacement of the step across every id or normal edge that the engine image shows
/// clearly: a step of at least `edge_contrast` in the log of some channel (colour edges count, so
/// relighting one side to the other's luminance does not hide an edge) that dominates its
/// neighbourhood. The step's position is the peak of the gradient, refined between pixels.
fn edge_displacement(prep: &Prepared, lo: &[f32], lc: &[f32]) -> f32 {
    let (w, h) = (prep.w, prep.h);
    let contrast = prep.job.tolerances.edge_contrast;
    let mut worst = 0.0f32;
    let mut go = [0.0f32; 2 * EDGE_REACH - 1];
    let mut gc = [0.0f32; 2 * EDGE_REACH - 1];
    let step = |v: &[f32], a: usize, b: usize| {
        let d = |c: usize| (v[b * 3 + c] - v[a * 3 + c]).abs();
        d(0).max(d(1)).max(d(2))
    };
    // Along x (an edge between columns x and x+1), then along y.
    for (dx, dy) in [(1usize, 0usize), (0, 1)] {
        let stride = dx + dy * w;
        let (len, other) = if dx == 1 { (w, h) } else { (h, w) };
        for o in 0..other {
            for i in EDGE_REACH - 1..len.saturating_sub(EDGE_REACH) {
                let p = if dx == 1 { o * w + i } else { i * w + o };
                if !discontinuity(&prep.passes, p, p + stride, prep.crease_cos) {
                    continue;
                }
                let first = p - (EDGE_REACH - 1) * stride;
                for k in 0..go.len() {
                    let a = first + k * stride;
                    go[k] = step(lo, a, a + stride);
                    gc[k] = step(lc, a, a + stride);
                }
                let centre = go[EDGE_REACH - 1];
                if centre < contrast {
                    continue;
                }
                let rival = go
                    .iter()
                    .enumerate()
                    .filter(|&(k, _)| k != EDGE_REACH - 1)
                    .fold(0.0f32, |m, (_, &v)| m.max(v));
                if centre < 2.0 * rival {
                    continue;
                }
                let d = (peak(&gc) - peak(&go)).abs();
                worst = worst.max(d);
            }
        }
    }
    worst
}

/// Mean SSIM (contrast and structure) of the high band over 8 x 8 blocks of the inside of surfaces
/// (`skip` marks edges, and the pixels where the Wear control may add detail).
fn detail_ssim(prep: &Prepared, ho: &[f32], hc: &[f32], skip: &[bool]) -> f32 {
    let (w, h) = (prep.w, prep.h);
    let b = DETAIL_BLOCK;
    let mut total = Sum::default();
    let mut blocks = 0u32;
    for by in 0..h / b {
        for bx in 0..w / b {
            let mut idx = [0usize; DETAIL_BLOCK * DETAIL_BLOCK];
            let mut n = 0;
            for y in by * b..by * b + b {
                for x in bx * b..bx * b + b {
                    let p = y * w + x;
                    if prep.region[p] != BACKGROUND && !skip[p] {
                        idx[n] = p;
                        n += 1;
                    }
                }
            }
            if n * 4 < b * b * 3 {
                continue;
            }
            let inv = 1.0 / n as f32;
            let (mut mo, mut mc) = (0.0f32, 0.0f32);
            for &p in &idx[..n] {
                mo += ho[p];
                mc += hc[p];
            }
            mo *= inv;
            mc *= inv;
            let (mut vo, mut vc, mut cov) = (0.0f32, 0.0f32, 0.0f32);
            for &p in &idx[..n] {
                let (a, c) = (ho[p] - mo, hc[p] - mc);
                vo += a * a;
                vc += c * c;
                cov += a * c;
            }
            let ssim = (2.0 * cov * inv + DETAIL_C) / ((vo + vc) * inv + DETAIL_C);
            total.add(ssim);
            blocks += 1;
        }
    }
    if blocks == 0 {
        1.0
    } else {
        total.get() / blocks as f32
    }
}

/// Worst relative change of high-band energy of a 32 x 32 block of the inside of surfaces (`near`
/// marks edges): in-focus blocks must not get softer, out-of-focus blocks must not get sharper.
fn focus_deviation(prep: &Prepared, ho: &[f32], hc: &[f32], near: &[bool]) -> f32 {
    let (w, h) = (prep.w, prep.h);
    let t = &prep.job.tolerances;
    let b = FOCUS_BLOCK;
    let mut worst = 0.0f32;
    for by in 0..h.div_ceil(b) {
        for bx in 0..w.div_ceil(b) {
            let (mut eo, mut ec, mut coc) = (0.0f32, 0.0f32, 0.0f32);
            let (mut n, mut all) = (0u32, 0u32);
            for y in by * b..(by * b + b).min(h) {
                for x in bx * b..(bx * b + b).min(w) {
                    all += 1;
                    let p = y * w + x;
                    if prep.region[p] == BACKGROUND || near[p] {
                        continue;
                    }
                    n += 1;
                    eo += ho[p] * ho[p];
                    ec += hc[p] * hc[p];
                    coc += prep.coc(p);
                }
            }
            if n * 2 < all || n == 0 {
                continue;
            }
            let inv = 1.0 / n as f32;
            let ratio = (ec * inv + FOCUS_E0) / (eo * inv + FOCUS_E0);
            let coc = coc * inv;
            let dev = if coc <= t.in_focus_coc {
                1.0 - ratio
            } else if coc >= t.out_of_focus_coc {
                ratio - 1.0
            } else {
                0.0
            };
            worst = worst.max(dev);
        }
    }
    worst
}

/// The log of the scene-linear luminance of an RGBA image (scaled by the exposure, so the floor
/// [`LOG_EPS`] means what it does on the display), and its high band.
pub(crate) fn high_band(prep: &Prepared, rgba: &[f32]) -> (Vec<f32>, Vec<f32>) {
    let log: Vec<f32> = rgba
        .chunks_exact(4)
        .map(|c| {
            let y = luma(&c[..3]) * prep.gain;
            ln_eps(if y.is_finite() { y.max(0.0) } else { 0.0 })
        })
        .collect();
    let low = gaussian(&log, prep.w, prep.h, SIGMA_HIGH);
    let high = log.iter().zip(&low).map(|(&v, &l)| v - l).collect();
    (log, high)
}

/// Per pixel: whether the Wear control may add detail there in this attempt.
pub(crate) fn wear_open(prep: &Prepared, caps: &Caps) -> Vec<bool> {
    let open: Vec<bool> = (0..prep.regions.len() as u32)
        .map(|r| caps.wear > 0.0 && prep.regions[r as usize].allows_wear && prep.region_open(r))
        .collect();
    prep.region
        .iter()
        .map(|&r| r != BACKGROUND && open[r as usize])
        .collect()
}

/// Every check on a result (`out` RGBA scene-linear, `out_disp` its display image) of one attempt.
pub(crate) fn measure(prep: &Prepared, out: &[f32], out_disp: &[f32], caps: &Caps) -> Measures {
    let n = prep.w * prep.h;
    let open = prep.open_mask();
    let mut outside = 0u32;
    for p in 0..n {
        if !open[p] {
            let same = (0..4).all(|c| out[p * 4 + c].to_bits() == prep.orig[p * 4 + c].to_bits());
            if !same {
                outside += 1;
            }
        }
    }
    let (_, ho) = high_band(prep, prep.orig);
    let (_, hc) = high_band(prep, out);
    let edges = edge_displacement(prep, &rgb_log(prep, prep.orig), &rgb_log(prep, out));
    let near = prep.near_edges(INTERIOR);
    let skip: Vec<bool> = near
        .iter()
        .zip(wear_open(prep, caps))
        .map(|(&e, w)| e || w)
        .collect();
    let detail = detail_ssim(prep, &ho, &hc, &skip);
    let focus = focus_deviation(prep, &ho, &hc, &near);
    let pixel = |p: usize| [out[p * 4], out[p * 4 + 1], out[p * 4 + 2]];
    let grade = grade_of(prep, &|p| open[p], &pixel, caps);
    let cand = |p: usize| {
        (
            pixel(p),
            [out_disp[p * 3], out_disp[p * 3 + 1], out_disp[p * 3 + 2]],
        )
    };
    let allow: Vec<RegionAllowance> = (0..prep.regions.len() as u32)
        .map(|r| RegionAllowance {
            grade: if prep.regions[r as usize].locked {
                [0.0; 3]
            } else {
                grade
            },
            lum: lum_allow(prep, r, caps),
            active: true,
        })
        .collect();
    let colour = region_deltas(prep, &cand, &|_| true, &allow);
    Measures {
        outside,
        edges,
        detail,
        focus,
        colour,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn colour_delta_ignores_what_is_allowed_and_sees_the_rest() {
        let job = crate::Job::new(1, 1, crate::Settings::NONE);
        let display = Display::of(&job);
        let show = |c: [f32; 3]| display.apply(c[0], c[1], c[2]);
        let orig = [0.9f32, 0.45, 0.2];
        let d = |out: [f32; 3], grade: [f32; 3], allow: f32| {
            colour_delta(&display, orig, show(orig), out, show(out), grade, allow)
        };
        assert_eq!(d(orig, [0.0; 3], 0.0), 0.0);
        // A pure change of light of 30 %, desaturated by the curve's shoulder: nothing left within
        // an allowance of ln 1.3, plenty without one.
        let g = 1.3f32;
        let brighter = orig.map(|v| v * g);
        assert!(d(brighter, [0.0; 3], fmath::ln(g) + 1e-4) < 0.05);
        assert!(d(brighter, [0.0; 3], 0.0) > 2.0);
        // A warm grade of the whole image, removed as the style's.
        let grade = [0.15f32, 0.0, -0.15];
        let warm = [0, 1, 2].map(|c| orig[c] * fmath::exp(grade[c]));
        assert!(d(warm, grade, 0.0) < 0.05);
        assert!(d(warm, [0.0; 3], 0.2) > 1.0);
        // A hue change stays whatever the allowances.
        assert!(d([0.2, 0.45, 0.9], [0.0; 3], 1.0) > 10.0);
        assert_eq!(log_ratio(0.0, 0.0), 0.0);
        assert!((log_ratio(0.5, 1.0) - fmath::LN_2).abs() < 1e-6);
    }

    #[test]
    fn peaks_are_refined_between_pixels() {
        assert_eq!(peak(&[0.0, 0.0, 1.0, 0.0, 0.0]), 0.0);
        assert_eq!(peak(&[0.0, 0.0, 0.0, 1.0, 0.0]), 1.0);
        let p = peak(&[0.0, 0.0, 1.0, 1.0, 0.0]);
        assert!((p - 0.5).abs() < 1e-6, "{p}");
    }
}
