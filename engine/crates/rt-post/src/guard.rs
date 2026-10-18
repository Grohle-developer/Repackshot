//! The deterministic guard (AI-POST.md §3.2 step 4): from the model's image it builds the result
//! the controls allow, strongest protection first. The result is always the engine image times a
//! per-pixel gain, so nothing the gain does not carry can enter it.
//!
//! * **(a) Shading transfer.** The model's change is low-passed in the log domain: the log of the
//!   ratio of the blurs, `ln blur(model) − ln blur(engine)`, of display-linear light (a normalised
//!   Gaussian over the open regions only, 8–32 px by megapixel). It is turned into a change of
//!   scene light through the tone curve's local slope (low-passed too), and split into the change
//!   common to the image (Style strength), the local change of luminance (Light: a grey gain, like
//!   more or less light) and the local change of colour (Bounce), each scaled by its control and
//!   capped by its control times the attempt's strength. Edges, texture, text and the depth of
//!   field are the engine's by construction: a smooth gain cannot move or sharpen them.
//! * **(b) Frequency separation.** The engine's high band is always kept; the model's mid band
//!   (wear, micro-detail) enters only inside materials that allow wear, scaled by Wear, capped,
//!   and only where the image is in focus and away from edges.
//! * **(c) Regions by id.** The background (`partId` 0) and locked materials never change; each
//!   material's colour change is lowered until its ΔE₀₀ (mean and 95th percentile, measured as the
//!   checks measure it) is within the tolerances.
//! * **(d) The style's own grade** (X6, [`crate::style`]): a smooth gain from the low band of the
//!   engine's luminance, the same for any model, by Style strength and the attempt's scale.
//!
//! X6: each band control is a gain on the model's change in its band (0 none, 50 as the model made
//! it, 100 twice), the change clamped at the attempt's cap first; how much of the open image each
//! cap held back is in the report (`capped`), so the interface can say where the guard limited an
//! effect.

use crate::blur::masked_low_pass as low_pass;
use crate::blur::{gaussian, masked_low_pass};
use crate::checks::{grade_of, lum_allow, region_deltas, RegionAllowance};
use crate::image::{decode_table, encode8, ln_eps, luma, LUMA};
use crate::prepared::{Aspects, Caps, Histogram, Prepared, BACKGROUND, SIGMA_WEAR};
use rt_core::fmath;

/// Which guard steps run. Always all of them; the tests switch one off to show that the checks
/// catch what it protects.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct Steps {
    pub transfer: bool,
    pub bands: bool,
    pub regions: bool,
}

impl Steps {
    pub const ALL: Steps = Steps {
        transfer: true,
        bands: true,
        regions: true,
    };
}

/// The ΔE limit of (c) aims at this fraction of the tolerance, so the check after it passes.
const MARGIN: f32 = 0.8;
/// Rounds of the ΔE limit before a region's colour change is dropped.
const LIMIT_ROUNDS: usize = 6;
/// Regions larger than this are measured on every other pixel in each direction while limiting.
const SUBSAMPLE_ABOVE: u32 = 20_000;
/// The model's mid band never enters this close to an edge, pixels: an edge the model moved
/// must not come back as "wear".
const EDGE_GUARD: usize = 8;
/// Bounds of the tone curve's log-log slope when a display change is read as a scene change.
const SLOPE_MIN: f32 = 0.25;
const SLOPE_MAX: f32 = 8.0;
/// The scene-linear log step that measures the slope.
const SLOPE_PROBE: f32 = 0.1;
/// Largest scene-linear log gain of one pixel, whatever a step lets through.
const MAX_LOG_GAIN: f32 = 1.5;

/// The guard's result of one attempt.
pub(crate) struct Candidate {
    /// Scene-linear RGBA: the delivered image if the checks pass.
    pub rgba: Vec<f32>,
    /// Its display-linear RGB.
    pub disp: Vec<f32>,
    /// Per region: the fraction of its colour change that the ΔE limit kept.
    pub kept: Vec<f32>,
    /// The style's own grade applied, scene log gain, 3 floats a pixel (empty when none).
    pub style: Vec<f32>,
    /// The share of the open image where each band's cap held the model's change back (X6).
    pub capped: crate::report::Capped,
}

/// (d) The style's own grade of an attempt of `scale` over the open pixels: empty when it is 0.
fn style_plane(
    prep: &Prepared,
    open: &[bool],
    mask: &[f32],
    sigma_low: f32,
    scale: f32,
) -> Vec<f32> {
    let amount = crate::style::amount(prep.job, scale);
    if amount <= 0.0 {
        return Vec::new();
    }
    let (w, h) = (prep.w, prep.h);
    let n = w * h;
    let grade = crate::style::grade(prep.job.settings.style);
    let y: Vec<f32> = (0..n).map(|p| luma(&prep.disp[p * 3..p * 3 + 3])).collect();
    let low = low_pass(&y, mask, w, h, sigma_low);
    let mut out = vec![0.0f32; n * 3];
    for p in (0..n).filter(|&p| open[p]) {
        let g = crate::style::gain_at(&grade, low[p], amount);
        out[p * 3..p * 3 + 3].copy_from_slice(&g);
    }
    out
}

/// The style's own grade of an attempt of `scale` (what [`candidate`] applies), for measuring a
/// result afresh.
#[cfg(test)]
pub(crate) fn style_for(prep: &Prepared, sigma_low: f32, scale: f32) -> Vec<f32> {
    let open = prep.open_mask();
    let mask: Vec<f32> = open.iter().map(|&o| if o { 1.0 } else { 0.0 }).collect();
    style_plane(prep, &open, &mask, sigma_low, scale)
}

/// Counts of the pixels where a cap held a band back, over the pixels it applies to.
#[derive(Clone, Copy, Default)]
struct Tally {
    held: u32,
    of: u32,
}

impl Tally {
    fn add(&mut self, held: bool) {
        self.of += 1;
        self.held += u32::from(held);
    }

    fn share(&self) -> f32 {
        if self.of == 0 {
            0.0
        } else {
            self.held as f32 / self.of as f32
        }
    }
}

/// How much of the mid band a pixel may take for its focus: all in focus, none out of focus.
fn focus_weight(prep: &Prepared, p: usize) -> f32 {
    let t = &prep.job.tolerances;
    let coc = prep.coc(p);
    if coc <= t.in_focus_coc {
        1.0
    } else if coc >= t.out_of_focus_coc || t.out_of_focus_coc <= t.in_focus_coc {
        0.0
    } else {
        (t.out_of_focus_coc - coc) / (t.out_of_focus_coc - t.in_focus_coc)
    }
}

/// Median per channel of a 3-channel plane over the open pixels: the mean of the samples in the
/// histogram's median bin. X6: it was the bin's centre, half a bin (5e-4) away from a change of
/// exactly 0, which only cancelled out while Light and Style strength scaled it alike; with any
/// other pair an identity model brightened the image by that much.
fn median3(plane: &[f32], open: &[bool]) -> [f32; 3] {
    let mut out = [0.0f32; 3];
    for (c, o) in out.iter_mut().enumerate() {
        let mut hist = Histogram::new(-4.0, 4.0, 8192);
        for (p, &is_open) in open.iter().enumerate() {
            if is_open {
                hist.add(plane[p * 3 + c]);
            }
        }
        if hist.count() == 0 {
            continue;
        }
        let bin = hist.median_bin();
        let (mut sum, mut n) = (crate::prepared::Sum::default(), 0u32);
        for (p, &is_open) in open.iter().enumerate() {
            let v = plane[p * 3 + c];
            if is_open && hist.bin_of(v) == bin {
                sum.add(v);
                n += 1;
            }
        }
        *o = if n > 0 { sum.get() / n as f32 } else { 0.0 };
    }
    out
}

/// The tone curve's log-log slope (display log change over scene log change) per channel and for
/// the luminance (index 3), measured with a grey probe at every open pixel and low-passed.
fn slopes(prep: &Prepared, open: &[bool], mask: &[f32], sigma_low: f32) -> [Vec<f32>; 4] {
    let (w, h) = (prep.w, prep.h);
    let n = w * h;
    let probe = fmath::exp(SLOPE_PROBE);
    let mut s = [0, 1, 2, 3].map(|_| vec![0.0f32; n]);
    for p in (0..n).filter(|&p| open[p]) {
        let o = &prep.orig[p * 4..p * 4 + 3];
        let d0 = &prep.disp[p * 3..p * 3 + 3];
        let d1 = prep.display.apply(o[0] * probe, o[1] * probe, o[2] * probe);
        for c in 0..3 {
            s[c][p] = (ln_eps(d1[c]) - ln_eps(d0[c])) / SLOPE_PROBE;
        }
        s[3][p] = (ln_eps(luma(&d1)) - ln_eps(luma(d0))) / SLOPE_PROBE;
    }
    s.map(|plane| {
        masked_low_pass(&plane, mask, w, h, sigma_low)
            .into_iter()
            .map(|v| {
                if v.is_nan() {
                    SLOPE_MIN
                } else {
                    v.clamp(SLOPE_MIN, SLOPE_MAX)
                }
            })
            .collect()
    })
}

/// The scene-linear pixel `p` with the log gain `u` (3 channels).
#[inline]
fn gained(prep: &Prepared, p: usize, u: [f32; 3]) -> [f32; 3] {
    let o = &prep.orig[p * 4..p * 4 + 3];
    [0, 1, 2].map(|c| o[c] * fmath::exp(u[c].clamp(-MAX_LOG_GAIN, MAX_LOG_GAIN)))
}

/// (c) The kept fraction of each region's colour change so that the ΔE₀₀ of what the display will
/// show fits the tolerances, measured as the checks measure it.
fn limit_colour(
    prep: &Prepared,
    u: &[f32],
    chroma: &[f32],
    open: &[bool],
    caps: &Caps,
    style: &[f32],
) -> Vec<f32> {
    let tol = &prep.job.tolerances;
    let regions = prep.regions.len();
    let mut kept = vec![1.0f32; regions];
    if caps.bounce <= 0.0 {
        return kept;
    }
    let mut active: Vec<bool> = (0..regions as u32).map(|r| prep.region_open(r)).collect();
    let mut size = vec![0u32; regions];
    for &r in &prep.region {
        if r != BACKGROUND {
            size[r as usize] += 1;
        }
    }
    let w = prep.w;
    let grid = |p: usize| (p % w).is_multiple_of(2) && (p / w).is_multiple_of(2);
    let take = |p: usize| {
        let r = prep.region[p];
        r != BACKGROUND && (size[r as usize] <= SUBSAMPLE_ABOVE || grid(p))
    };
    let (lim_mean, lim_p95) = (MARGIN * tol.delta_e_mean, MARGIN * tol.delta_e_p95);
    for round in 0..LIMIT_ROUNDS {
        if !active.iter().any(|&a| a) {
            break;
        }
        let scene = |p: usize| {
            let k = kept[prep.region[p] as usize];
            gained(
                prep,
                p,
                [0, 1, 2].map(|c| u[p * 3 + c] + k * chroma[p * 3 + c]),
            )
        };
        // The change common to the image as the check estimates it, on a uniform grid so that no
        // region weighs more than it does in the full image.
        let grade = grade_of(prep, &|p| open[p] && grid(p), &scene, caps, style);
        let allow: Vec<RegionAllowance> = (0..regions as u32)
            .map(|r| RegionAllowance {
                grade,
                lum: lum_allow(prep, r, caps),
                active: active[r as usize],
            })
            .collect();
        let shown = |p: usize| {
            let s = scene(p);
            (s, prep.display.apply(s[0], s[1], s[2]))
        };
        let deltas = region_deltas(prep, &shown, &take, &allow, style);
        for r in 0..regions {
            if !active[r] {
                continue;
            }
            let (mean, p95) = deltas[r];
            if mean <= lim_mean && p95 <= lim_p95 {
                active[r] = false;
            } else if round + 1 == LIMIT_ROUNDS {
                kept[r] = 0.0;
                active[r] = false;
            } else {
                let f = (lim_mean / mean.max(1e-6)).min(lim_p95 / p95.max(1e-6));
                kept[r] *= (0.9 * f).clamp(0.0, 0.95);
            }
        }
    }
    kept
}

/// The guarded result of one attempt from the blended model image `model` (display-linear RGB),
/// with the low band at `sigma_low` and the caps of `scale` (strength over `MAX_STRENGTH`).
pub(crate) fn candidate(
    prep: &Prepared,
    model: &[f32],
    sigma_low: f32,
    scale: f32,
    steps: Steps,
) -> Candidate {
    let (w, h) = (prep.w, prep.h);
    let n = w * h;
    let a = Aspects::of(prep.job);
    let caps = Caps::of(prep.job, scale);
    let open: Vec<bool> = if steps.regions {
        prep.open_mask()
    } else {
        vec![true; n]
    };
    let mask: Vec<f32> = open.iter().map(|&o| if o { 1.0 } else { 0.0 }).collect();
    let table = decode_table();
    // What the model saw (the engine image in 8 bits) and what it returned, as logs.
    let seen: Vec<f32> = prep
        .disp
        .iter()
        .map(|&v| table[encode8(v) as usize])
        .collect();
    let lo: Vec<f32> = seen.iter().map(|&v| ln_eps(v)).collect();
    let lm: Vec<f32> = model.iter().map(|&v| ln_eps(v)).collect();
    let slope = slopes(prep, &open, &mask, sigma_low);
    // (d) The style's own grade, known pixel by pixel (the checks take it as asked for).
    let style = style_plane(prep, &open, &mask, sigma_low, scale);
    // The scene log gain, and its local colour part, which (c) may lower per region.
    let mut u = vec![0.0f32; n * 3];
    let mut chroma = vec![0.0f32; n * 3];
    let mut kept = vec![1.0f32; prep.regions.len()];
    let (mut t_light, mut t_bounce, mut t_wear) =
        (Tally::default(), Tally::default(), Tally::default());
    let mut style_held = false;

    if !steps.transfer {
        for p in (0..n).filter(|&p| open[p]) {
            for (c, s) in slope.iter().enumerate().take(3) {
                u[p * 3 + c] = (lm[p * 3 + c] - lo[p * 3 + c]) / s[p];
            }
        }
    } else {
        // (a) The low band of the change: the log of the ratio of the blurs (of light, not of
        // logs, so a blurred texture does not read as a change of light), as a scene change.
        let mut low = vec![0.0f32; n * 3];
        let mut low_scene = vec![0.0f32; n * 3];
        for c in 0..3 {
            let pm: Vec<f32> = (0..n).map(|p| model[p * 3 + c]).collect();
            let po: Vec<f32> = (0..n).map(|p| seen[p * 3 + c]).collect();
            let bm = masked_low_pass(&pm, &mask, w, h, sigma_low);
            let bo = masked_low_pass(&po, &mask, w, h, sigma_low);
            for p in 0..n {
                let l = ln_eps(bm[p]) - ln_eps(bo[p]);
                low[p * 3 + c] = l;
                low_scene[p * 3 + c] = l / slope[c][p];
            }
        }
        let common = median3(&low_scene, &open);
        let grade = common.map(|g| (a.style * g).clamp(-caps.style, caps.style));
        style_held = caps.style > 0.0 && common.iter().any(|&g| (a.style * g).abs() > caps.style);
        for p in (0..n).filter(|&p| open[p]) {
            let l = [0, 1, 2].map(|c| low_scene[p * 3 + c] - common[c]);
            let y = LUMA[0] * l[0] + LUMA[1] * l[1] + LUMA[2] * l[2];
            let ty = (a.light * y).clamp(-caps.light, caps.light);
            if caps.light > 0.0 {
                t_light.add((a.light * y).abs() > caps.light);
            }
            let mut x = l.map(|v| a.bounce * (v - y));
            let m = x[0].abs().max(x[1].abs()).max(x[2].abs());
            if caps.bounce > 0.0 {
                t_bounce.add(m > caps.bounce);
            }
            if m > caps.bounce {
                let k = if m > 0.0 { caps.bounce / m } else { 0.0 };
                x = x.map(|v| v * k);
            }
            let k = crate::checks::known_at(&style, p);
            for c in 0..3 {
                u[p * 3 + c] = grade[c] + ty + k[c];
                chroma[p * 3 + c] = x[c];
            }
        }

        // (b) The mid band: wear, only where it is allowed.
        if steps.bands {
            let wearing = a.wear > 0.0
                && caps.wear > 0.0
                && prep
                    .regions
                    .iter()
                    .enumerate()
                    .any(|(r, reg)| reg.allows_wear && prep.region_open(r as u32));
            if wearing {
                let d: Vec<f32> = (0..n)
                    .map(|p| {
                        let i = p * 3;
                        ln_eps(luma(&model[i..i + 3])) - ln_eps(luma(&seen[i..i + 3]))
                    })
                    .collect();
                let fine = gaussian(&d, w, h, SIGMA_WEAR);
                let coarse = masked_low_pass(&d, &mask, w, h, sigma_low);
                let near = prep.near_edges(EDGE_GUARD);
                for p in (0..n).filter(|&p| open[p] && !near[p]) {
                    let r = prep.region[p];
                    if r == BACKGROUND || !prep.regions[r as usize].allows_wear {
                        continue;
                    }
                    let weight = focus_weight(prep, p);
                    if weight <= 0.0 {
                        continue;
                    }
                    let mid = (fine[p] - coarse[p]) / slope[3][p];
                    t_wear.add((a.wear * mid).abs() > caps.wear);
                    let tw = (a.wear * mid).clamp(-caps.wear, caps.wear) * weight;
                    for c in 0..3 {
                        u[p * 3 + c] += tw;
                    }
                }
            }
        } else {
            // Without the separation the model's whole mid and high band would enter everywhere.
            for p in (0..n).filter(|&p| open[p]) {
                for (c, s) in slope.iter().enumerate().take(3) {
                    let i = p * 3 + c;
                    u[i] += ((lm[i] - lo[i]) - low[i]) / s[p];
                }
            }
        }

        // (c) Each region keeps only the colour change its ΔE allows.
        if steps.regions {
            kept = limit_colour(prep, &u, &chroma, &open, &caps, &style);
        }
        for p in (0..n).filter(|&p| open[p]) {
            let r = prep.region[p];
            let k = if r == BACKGROUND {
                1.0
            } else {
                kept[r as usize]
            };
            for c in 0..3 {
                u[p * 3 + c] += k * chroma[p * 3 + c];
            }
        }
    }

    let mut rgba = prep.orig.to_vec();
    for p in (0..n).filter(|&p| open[p]) {
        let up = [u[p * 3], u[p * 3 + 1], u[p * 3 + 2]];
        let o = &prep.orig[p * 4..p * 4 + 3];
        if up == [0.0; 3] || !o.iter().all(|v| v.is_finite()) {
            continue;
        }
        let g = gained(prep, p, up);
        rgba[p * 4..p * 4 + 3].copy_from_slice(&g);
    }
    let disp = prep.display.image(&rgba);
    Candidate {
        rgba,
        disp,
        kept,
        style,
        capped: crate::report::Capped {
            light: t_light.share(),
            bounce: t_bounce.share(),
            wear: t_wear.share(),
            style: if style_held { 1.0 } else { 0.0 },
        },
    }
}
