//! `rt-post`: the AI post-processing guard of Repackshot and all its pixel work (AI-POST.md §3,
//! §7.2), in Rust from scratch with `std` only, `f32`, no `unsafe`, deterministic: the same job
//! gives the same bits natively and in WebAssembly (`rt-post-wasm`, `public/engine/post.wasm`).
//! `rt-core` does not know it exists; it only uses `rt-core`'s deterministic maths and tone curves.
//!
//! It is a **step machine**, not a loop with callbacks; the driver that calls the model between
//! steps is trivial and lives in `rt-app` (desktop) and in a web worker (`src/ai/`):
//!
//! 1. [`plan`]`(job) → Plan`: tiles of about 1024² with overlap, the padded size, the strength of
//!    each attempt (Intervention × `MAX_STRENGTH`, × `RETRY_FACTOR` per retry). With nothing to
//!    change (Intervention 0, or every aspect at 0) the plan has **no tiles**: the model is never
//!    called and the output is the input, bit for bit.
//! 2. [`tile_input`] and [`conditioning`]`(plan, passes)`: per tile, the engine image as the model
//!    sees it (8-bit sRGB, the render's tone curve) and the control images (edges, depth) from the
//!    exact passes.
//! 3. [`accept`]`(plan, original, passes, tile outputs, attempt) → Accepted{image, report} |
//!    Retry{strength} | Rejected{report}`: blends the tiles, runs the guard, checks the result and
//!    decides. At most `MAX_ATTEMPTS`; a rejection delivers the engine image unchanged.
//!
//! [`run`] is that driver for a model given as a function (tests, and `rt-app` later).
//!
//! It also holds the renderer's own denoiser ([`denoise`], E5b-1): an edge-avoiding à-trous
//! filter guided by the exact passes and the film's variance, run by the launcher and by the
//! web pool (through `rt-wasm`) on the finished image.

#![forbid(unsafe_code)]
#![deny(missing_docs)]

mod blur;
mod checks;
mod color;
mod conditioning;
pub mod denoise;
mod guard;
mod image;
mod job;
mod prepared;
mod report;
pub mod style;
pub mod test_model;
mod tiles;

#[cfg(test)]
mod fixture;
#[cfg(test)]
mod tests;

pub use conditioning::DEPTH_FAR;
pub use image::{LinearImage, Passes, Rgb8Image};
pub use job::{
    Job, MaterialInfo, PostError, Settings, Style, Tolerances, BAND_GAIN_AT_100, MAX_ATTEMPTS,
    MAX_MATERIALS, MAX_PIXELS, MAX_SIDE, MAX_STRENGTH, RETRY_FACTOR,
};
pub use prepared::FLOOR_NAME;
pub use report::{
    number as report_number, string as report_string, Capped, Check, MaterialCheck, Report, Verdict,
};
pub use rt_core::color::Tonemap;
/// `partId` and `materialId` of the studio floor in the passes (`FLOOR_ID` of `src/core/passes.ts`): a
/// surface the guard may relight and whose colour it checks, never background.
pub use rt_core::passes::FLOOR_ID;
pub use tiles::{Tile, PAD_MULTIPLE, TILE_OVERLAP, TILE_SIZE};

use guard::Steps;
use image::{decode_table, encode8, Display};
use job::fraction;
use prepared::{Caps, Prepared};

/// Version of the guard, packed as `major << 16 | minor << 8 | patch` (the workspace's).
pub const VERSION: u32 = rt_core::VERSION;

/// What to run for a job: the tiles, their padded size and the strength of every attempt. Made
/// only by [`plan`] and read-only, so it always matches the tiles [`accept`] blends.
#[derive(Clone, Debug)]
pub struct Plan {
    pub(crate) job: Job,
    pub(crate) tiles: Vec<Tile>,
    pub(crate) sigma_low: f32,
    pub(crate) steps: Steps,
}

impl Plan {
    /// The job.
    pub fn job(&self) -> &Job {
        &self.job
    }

    /// Tiles the model runs on, row by row. **Empty** when nothing may change.
    pub fn tiles(&self) -> &[Tile] {
        &self.tiles
    }

    /// Standard deviation of the low band, pixels (8–32, by megapixel).
    pub fn sigma_low(&self) -> f32 {
        self.sigma_low
    }

    /// Whether the model runs at all.
    pub fn runs_model(&self) -> bool {
        !self.tiles.is_empty()
    }

    /// The attempt's strength over `MAX_STRENGTH`: Intervention, times `RETRY_FACTOR` per retry.
    pub fn scale(&self, attempt: u32) -> f32 {
        let mut s = fraction(self.job.settings.intervention);
        for _ in 0..attempt {
            s *= RETRY_FACTOR;
        }
        s
    }

    /// The img2img strength of attempt `attempt` (0 is the first).
    pub fn strength(&self, attempt: u32) -> f32 {
        self.scale(attempt) * MAX_STRENGTH
    }

    /// Fraction of the asked strength used by attempt `attempt`.
    pub fn used_fraction(attempt: u32) -> f32 {
        let mut f = 1.0f32;
        for _ in 0..attempt {
            f *= RETRY_FACTOR;
        }
        f
    }

    /// The plan as JSON for a host: size, tiles, strengths, constants and the tolerances in force.
    pub fn to_json(&self) -> String {
        use report::number;
        let tiles: Vec<String> = self
            .tiles
            .iter()
            .map(|t| {
                format!(
                    "{{\"x\":{},\"y\":{},\"width\":{},\"height\":{},\"paddedWidth\":{},\"paddedHeight\":{}}}",
                    t.x, t.y, t.width, t.height, t.padded_width, t.padded_height
                )
            })
            .collect();
        let strengths: Vec<String> = (0..MAX_ATTEMPTS)
            .map(|a| number(self.strength(a)))
            .collect();
        let tolerances: Vec<String> = Tolerances::KEYS
            .iter()
            .zip(self.job.tolerances.values())
            .map(|(k, v)| format!("\"{k}\":{}", number(v)))
            .collect();
        format!(
            "{{\"width\":{},\"height\":{},\"tiles\":[{}],\"strengths\":[{}],\"maxStrength\":{},\"maxAttempts\":{},\"retryFactor\":{},\"sigmaLow\":{},\"tolerances\":{{{}}}}}",
            self.job.width,
            self.job.height,
            tiles.join(","),
            strengths.join(","),
            number(MAX_STRENGTH),
            MAX_ATTEMPTS,
            number(RETRY_FACTOR),
            number(self.sigma_low),
            tolerances.join(",")
        )
    }
}

/// Step 1: the plan of a job.
pub fn plan(job: &Job) -> Result<Plan, PostError> {
    job.validate()?;
    let s = &job.settings;
    let wears = s.wear > 0 && job.materials.iter().any(|m| m.allows_wear && !m.locked);
    let anything =
        s.intervention > 0 && (s.light > 0 || s.bounce > 0 || s.style_strength > 0 || wears);
    let megapixels = (job.width as f32 * job.height as f32) / 1.0e6;
    let sigma_low = (16.0 * megapixels.sqrt()).clamp(8.0, 32.0);
    Ok(Plan {
        job: job.clone(),
        tiles: if anything {
            tiles::plan_tiles(job.width, job.height)
        } else {
            Vec::new()
        },
        sigma_low,
        steps: Steps::ALL,
    })
}

fn tile_of(plan: &Plan, index: usize) -> Result<&Tile, PostError> {
    plan.tiles
        .get(index)
        .ok_or_else(|| PostError::new(format!("the plan has no tile {index}")))
}

/// Step 2a: the model's input for tile `index`: the engine image with the render's exposure and
/// tone curve, 8-bit sRGB, at the tile's padded size (edges repeated).
pub fn tile_input(
    plan: &Plan,
    original: &LinearImage,
    index: usize,
) -> Result<Rgb8Image, PostError> {
    original.check(&plan.job)?;
    let tile = tile_of(plan, index)?;
    let display = Display::of(&plan.job);
    let crop = tiles::crop_pad(&original.rgba, plan.job.width, 4, tile);
    let mut rgb = Vec::with_capacity(crop.len() / 4 * 3);
    for px in crop.chunks_exact(4) {
        rgb.extend(display.apply(px[0], px[1], px[2]).map(encode8));
    }
    Ok(Rgb8Image {
        width: tile.padded_width,
        height: tile.padded_height,
        rgb,
    })
}

/// The control images of one tile, one byte a pixel at the tile's padded size.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TileControl {
    /// Padded width.
    pub width: u32,
    /// Padded height.
    pub height: u32,
    /// Id and normal discontinuities: 255 on both sides of an edge, else 0.
    pub edges: Vec<u8>,
    /// Depth: near 255, the farthest surface [`DEPTH_FAR`], background 0.
    pub depth: Vec<u8>,
}

/// The full-size control images (edges, depth) of a job's passes.
pub fn control_planes(plan: &Plan, passes: &Passes) -> Result<(Vec<u8>, Vec<u8>), PostError> {
    passes.check(&plan.job)?;
    let crease = rt_core::fmath::cos(plan.job.tolerances.crease_deg * rt_core::fmath::DEG_TO_RAD);
    Ok((
        conditioning::edge_plane(passes, crease),
        conditioning::depth_plane(passes),
    ))
}

/// The control images of tile `index` cut from [`control_planes`].
pub fn tile_control(
    plan: &Plan,
    planes: &(Vec<u8>, Vec<u8>),
    index: usize,
) -> Result<TileControl, PostError> {
    let tile = tile_of(plan, index)?;
    Ok(TileControl {
        width: tile.padded_width,
        height: tile.padded_height,
        edges: tiles::crop_pad(&planes.0, plan.job.width, 1, tile),
        depth: tiles::crop_pad(&planes.1, plan.job.width, 1, tile),
    })
}

/// Step 2b: the control images of every tile.
pub fn conditioning(plan: &Plan, passes: &Passes) -> Result<Vec<TileControl>, PostError> {
    let planes = control_planes(plan, passes)?;
    (0..plan.tiles.len())
        .map(|i| tile_control(plan, &planes, i))
        .collect()
}

/// What [`accept`] decided.
#[derive(Clone, Debug, PartialEq)]
pub enum Outcome {
    /// Every check passed: deliver `image` (the job's size exactly).
    Accepted {
        /// The guarded image, scene-linear RGBA.
        image: LinearImage,
        /// Verdict ACCEPTED (first attempt) or LIMITED.
        report: Report,
    },
    /// A check failed and attempts remain: run the model again at `strength`.
    Retry {
        /// The next attempt's strength.
        strength: f32,
        /// The next attempt's index.
        attempt: u32,
        /// Which checks failed, for the log.
        reason: String,
    },
    /// No attempt passed: deliver the engine image unchanged.
    Rejected {
        /// Verdict REJECTED, with the last attempt's checks and the reason.
        report: Report,
    },
}

fn base_report(plan: &Plan) -> Report {
    let t = &plan.job.tolerances;
    Report {
        verdict: Verdict::Accepted,
        used_fraction: 1.0,
        attempts: 0,
        size: Check::floor(1.0, 1.0),
        outside: Check::ceiling(0.0, 0.0),
        edges: Check::ceiling(0.0, t.edges_px),
        detail: Check::floor(1.0, t.detail_ssim),
        focus: Check::ceiling(0.0, t.focus),
        materials: Vec::new(),
        capped: Capped::default(),
        reason: None,
        model_key: plan.job.model_key.clone(),
        runtime: plan.job.runtime.clone(),
        seed: plan.job.settings.seed,
        seconds: 0.0,
    }
}

fn percent(v: f32) -> u32 {
    (v * 100.0 + 0.5) as u32
}

/// Step 3: guard, check and decide on the model's tiles of attempt `attempt` (0 first).
///
/// `outputs` holds one image per plan tile, at the tile's padded size; a tile of another size
/// fails the `size` check and rejects the job at once (a lower strength would not fix it).
pub fn accept(
    plan: &Plan,
    original: &LinearImage,
    passes: &Passes,
    outputs: &[Rgb8Image],
    attempt: u32,
) -> Result<Outcome, PostError> {
    original.check(&plan.job)?;
    passes.check(&plan.job)?;
    if attempt >= MAX_ATTEMPTS {
        return Err(PostError::new(format!(
            "attempt {attempt} is beyond the last"
        )));
    }
    if outputs.len() != plan.tiles.len() {
        return Err(PostError::new(format!(
            "{} tile outputs for {} tiles",
            outputs.len(),
            plan.tiles.len()
        )));
    }
    let mut report = base_report(plan);
    if plan.tiles.is_empty() {
        // Nothing may change: the engine image, bit for bit, and the model never ran.
        return Ok(Outcome::Accepted {
            image: original.clone(),
            report,
        });
    }
    report.attempts = attempt + 1;
    for (i, (tile, out)) in plan.tiles.iter().zip(outputs).enumerate() {
        let want = tile.padded_width as usize * tile.padded_height as usize * 3;
        if out.width != tile.padded_width
            || out.height != tile.padded_height
            || out.rgb.len() != want
        {
            report.size = Check::floor(0.0, 1.0);
            report.verdict = Verdict::Rejected;
            report.used_fraction = 0.0;
            report.reason = Some(format!(
                "tile {} came back {}x{} instead of {}x{}",
                i + 1,
                out.width,
                out.height,
                tile.padded_width,
                tile.padded_height
            ));
            return Ok(Outcome::Rejected { report });
        }
    }
    let table = decode_table();
    let decoded: Vec<Vec<f32>> = outputs
        .iter()
        .map(|o| o.rgb.iter().map(|&b| table[b as usize]).collect())
        .collect();
    let model = tiles::blend(plan.job.width, plan.job.height, &plan.tiles, &decoded);
    drop(decoded);

    let prep = Prepared::new(&plan.job, original, *passes);
    let scale = plan.scale(attempt);
    let cand = guard::candidate(&prep, &model, plan.sigma_low, scale, plan.steps);
    let caps = Caps::of(&plan.job, scale);
    let m = checks::measure(&prep, &cand.rgba, &cand.disp, &caps, &cand.style);

    let t = &plan.job.tolerances;
    report.outside = Check::ceiling(m.outside as f32, 0.0);
    report.edges = Check::ceiling(m.edges, t.edges_px);
    report.detail = Check::floor(m.detail, t.detail_ssim);
    report.focus = Check::ceiling(m.focus, t.focus);
    report.materials = prep
        .regions
        .iter()
        .zip(&m.colour)
        .zip(&cand.kept)
        .map(|((r, &(mean, p95)), &kept)| MaterialCheck {
            material_id: r.id,
            name: r.name.clone(),
            delta_e_mean: mean,
            delta_e_p95: p95,
            limit: t.delta_e_mean,
            ok: mean <= t.delta_e_mean && p95 <= t.delta_e_p95,
            kept,
        })
        .collect();
    report.capped = cand.capped;

    let mut failed = Vec::new();
    if !report.outside.ok {
        failed.push(format!(
            "{} pixels changed outside the allowed regions",
            m.outside
        ));
    }
    if !report.edges.ok {
        failed.push(format!(
            "edges moved {:.2} px (limit {})",
            m.edges, t.edges_px
        ));
    }
    if !report.detail.ok {
        failed.push(format!(
            "detail SSIM {:.4} below {}",
            m.detail, t.detail_ssim
        ));
    }
    if !report.focus.ok {
        failed.push(format!("focus changed {:.2} (limit {})", m.focus, t.focus));
    }
    for mc in report.materials.iter().filter(|mc| !mc.ok) {
        failed.push(format!(
            "colour of {} changed ΔE mean {:.2} p95 {:.2}",
            mc.name, mc.delta_e_mean, mc.delta_e_p95
        ));
    }
    let limited: Vec<String> = prep
        .regions
        .iter()
        .zip(&cand.kept)
        .filter(|(_, &k)| k < 1.0)
        .map(|(r, &k)| format!("colour change of {} kept to {} %", r.name, percent(k)))
        .collect();

    if failed.is_empty() {
        report.verdict = if attempt == 0 {
            Verdict::Accepted
        } else {
            Verdict::Limited
        };
        report.used_fraction = Plan::used_fraction(attempt);
        let mut notes = Vec::new();
        if attempt > 0 {
            notes.push(format!(
                "strength lowered to {} % after {} failed attempt{}",
                percent(report.used_fraction),
                attempt,
                if attempt == 1 { "" } else { "s" }
            ));
        }
        notes.extend(limited);
        if !notes.is_empty() {
            report.reason = Some(notes.join("; "));
        }
        return Ok(Outcome::Accepted {
            image: LinearImage {
                width: plan.job.width,
                height: plan.job.height,
                rgba: cand.rgba,
            },
            report,
        });
    }
    let reason = failed.join("; ");
    if attempt + 1 < MAX_ATTEMPTS {
        return Ok(Outcome::Retry {
            strength: plan.strength(attempt + 1),
            attempt: attempt + 1,
            reason,
        });
    }
    report.verdict = Verdict::Rejected;
    report.used_fraction = 0.0;
    report.reason = Some(format!("no attempt passed: {reason}"));
    Ok(Outcome::Rejected { report })
}

/// One call of the model: the tile, what it is given and how strongly it may change it.
pub struct TileRequest<'a> {
    /// The tile's index in the plan.
    pub index: usize,
    /// The tile.
    pub tile: &'a Tile,
    /// The engine image as the model sees it (padded).
    pub input: &'a Rgb8Image,
    /// The control images (padded).
    pub control: &'a TileControl,
    /// The img2img strength.
    pub strength: f32,
    /// The attempt (0 first).
    pub attempt: u32,
    /// The seed.
    pub seed: u32,
}

/// The driver: plan, condition, call `model` for every tile of every attempt, accept or retry.
/// Returns the image to deliver (the engine's, unchanged, when rejected) and the report.
pub fn run(
    job: &Job,
    original: &LinearImage,
    passes: &Passes,
    mut model: impl FnMut(&TileRequest) -> Rgb8Image,
) -> Result<(LinearImage, Report), PostError> {
    let plan = plan(job)?;
    run_plan(&plan, original, passes, &mut model)
}

pub(crate) fn run_plan(
    plan: &Plan,
    original: &LinearImage,
    passes: &Passes,
    model: &mut dyn FnMut(&TileRequest) -> Rgb8Image,
) -> Result<(LinearImage, Report), PostError> {
    original.check(&plan.job)?;
    passes.check(&plan.job)?;
    let inputs: Vec<Rgb8Image> = (0..plan.tiles.len())
        .map(|i| tile_input(plan, original, i))
        .collect::<Result<_, _>>()?;
    let controls = conditioning(plan, passes)?;
    let mut attempt = 0;
    loop {
        let strength = plan.strength(attempt);
        let outputs: Vec<Rgb8Image> = plan
            .tiles
            .iter()
            .enumerate()
            .map(|(index, tile)| {
                model(&TileRequest {
                    index,
                    tile,
                    input: &inputs[index],
                    control: &controls[index],
                    strength,
                    attempt,
                    seed: plan.job.settings.seed,
                })
            })
            .collect();
        match accept(plan, original, passes, &outputs, attempt)? {
            Outcome::Accepted { image, report } => return Ok((image, report)),
            Outcome::Rejected { report } => return Ok((original.clone(), report)),
            Outcome::Retry { attempt: next, .. } => attempt = next,
        }
    }
}
