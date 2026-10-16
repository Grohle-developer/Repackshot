//! The desktop AI post-processing pipeline (phase X3c, `docs/AI-POST.md` §7.3): `POST
//! /api/ai/post` and its job.
//!
//! The pixels do not travel: a final render that asked for passes is kept by the launcher with
//! its linear image and its exact passes ([`crate::kept`]), and the page asks for it by id
//! (`RENDER`). The Fast-mode preview sends its picture and passes along instead (`INLINE`, at most
//! [`PREVIEW_MAX_SIDE`] a side). Then, in the launcher:
//!
//! 1. `rt_post::plan`: the tiles, the strength of every attempt. With nothing to change
//!    (Intervention 0, every aspect at 0) the plan has no tiles: the inference runtime is **never
//!    started** and the delivered image is the engine's, bit for bit.
//! 2. Per tile, `rt_post::tile_input` (8-bit sRGB with the render's tone curve) and the control
//!    image from `rt_post::control_planes` (depth when the model family has a depth ControlNet,
//!    else the tile itself when it has a tile ControlNet, else none), both PNG.
//! 3. Each tile through the runtime ([`super::sidecar::Sidecar::run`], the X3b server mode: the
//!    model stays loaded between calls), at the attempt's strength, the seed and the tile's exact
//!    padded size.
//! 4. `rt_post::accept`: accepted (the guarded image), retry at `RETRY_FACTOR` of the strength
//!    (up to `MAX_ATTEMPTS`), or rejected (the engine image, unchanged). A tile of another size
//!    is a failed `size` check and rejects at once.
//!
//! The job is followed like a render job: `GET /api/ai/post/<id>?after=<version>` (long poll) and
//! cancelled with `DELETE`; its image is `GET /api/ai/post/<id>/image` ([`IMAGE_MAGIC`]). The
//! contract is in this crate's `README.md`.

use super::sidecar::{Job as SidecarJob, Progress, SidecarError, Stage};
use super::{b64, png, Ai, ModelRun, Refusal, MAX_SIDE, MIN_SIDE, SIDE_MULTIPLE};
use crate::json::{self, Value};
use crate::kept::{read_passes, Look};
use crate::recommend::valid_name;
use crate::render::Frame;
use rt_core::passes::{
    Passes as EnginePasses, PASS_COC, PASS_DEPTH, PASS_MATERIAL_ID, PASS_NORMAL, PASS_PART_ID,
};
use rt_post::{
    Job as GuardJob, LinearImage, MaterialInfo, Outcome, Passes, Plan, Rgb8Image, Settings, Tile,
    Tonemap, MAX_ATTEMPTS, MAX_MATERIALS,
};
use std::collections::BTreeMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant};

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(PoisonError::into_inner)
}

/// Largest side of an `INLINE` source (`PREVIEW_MAX_SIDE` of `src/core/ai.ts`).
pub const PREVIEW_MAX_SIDE: u32 = 512;
/// Largest body of `POST /api/ai/post`: an inline preview with every pass, and its JSON.
pub const MAX_POST_BODY: u64 = 64 << 20;
/// Largest JSON part of an inline body.
pub const MAX_POST_JSON: usize = 1 << 20;
/// Magic of an inline body: `"RPI1"`, `u32` JSON length, the JSON, an image ([`IMAGE_MAGIC`]) and
/// the passes (`RPP1`, [`crate::kept`]).
pub const INLINE_MAGIC: [u8; 4] = *b"RPI1";
/// Magic of a linear image: `"RPL1"`, `u32` header length (16), `u32` width, `u32` height, then
/// `width × height × 4` little-endian `f32`, straight-alpha RGBA, rows from the top.
pub const IMAGE_MAGIC: [u8; 4] = *b"RPL1";
/// Bytes of the linear image's header.
pub const IMAGE_HEADER: usize = 16;
/// Posts waiting or running at once.
pub const MAX_POSTS: usize = 4;
/// Finished posts kept for the page to collect.
pub const KEEP_POSTS: usize = 8;
/// A running post nobody has asked about for this long is stopped: its page went away (closed,
/// reloaded) and the runtime has better things to do. The page asks at least every second
/// (`?after=`, the long poll).
pub const ORPHAN_AFTER: Duration = Duration::from_secs(120);

/// A straight-alpha pixel at least this opaque is opaque (`OPAQUE` of `src/render/tiles.ts`).
const OPAQUE: f64 = 1.0 - 1.0e-6;

/// The render's average as the page converts it (`exactBytes` of `src/render/tiles.ts`): the sums
/// over the samples, colour divided by alpha where it is not opaque, alpha 1 where it is. The
/// guard multiplies this by a gain, so an image nothing changed is this, bit for bit.
pub fn linear_of(frame: &Frame) -> Option<LinearImage> {
    let n = frame.width as usize * frame.height as usize;
    if frame.sums.len() != n * 4 {
        return None;
    }
    // `Math.fround(1 / Math.max(1, samples))`, and every operation after it one f32 rounding.
    let inv = (1.0f64 / f64::from(frame.samples.max(1))) as f32;
    let mut rgba = Vec::with_capacity(n * 4);
    for px in frame.sums.chunks_exact(4) {
        let a = px[3] * inv;
        let (mut r, mut g, mut b) = (px[0] * inv, px[1] * inv, px[2] * inv);
        let opaque = f64::from(a) >= OPAQUE;
        if !opaque {
            if a > 0.0 {
                r /= a;
                g /= a;
                b /= a;
            } else {
                (r, g, b) = (0.0, 0.0, 0.0);
            }
        }
        rgba.extend_from_slice(&[r, g, b, if opaque { 1.0 } else { a }]);
    }
    Some(LinearImage {
        width: frame.width,
        height: frame.height,
        rgba,
    })
}

/// A linear image as [`IMAGE_MAGIC`] bytes.
pub fn write_image(image: &LinearImage) -> Vec<u8> {
    let mut out = Vec::with_capacity(IMAGE_HEADER + image.rgba.len() * 4);
    out.extend_from_slice(&IMAGE_MAGIC);
    for v in [IMAGE_HEADER as u32, image.width, image.height] {
        out.extend_from_slice(&v.to_le_bytes());
    }
    for v in &image.rgba {
        out.extend_from_slice(&v.to_le_bytes());
    }
    out
}

fn u32_at(b: &[u8], i: usize) -> Option<u32> {
    Some(u32::from_le_bytes(b.get(i..i + 4)?.try_into().ok()?))
}

/// Reads [`write_image`]'s bytes at the start of `bytes`: the image and the bytes it took.
pub fn read_image(bytes: &[u8], max_side: u32) -> Option<(LinearImage, usize)> {
    if bytes.get(..4)? != IMAGE_MAGIC {
        return None;
    }
    let header = u32_at(bytes, 4)? as usize;
    let (width, height) = (u32_at(bytes, 8)?, u32_at(bytes, 12)?);
    if header < IMAGE_HEADER || width == 0 || height == 0 || width > max_side || height > max_side {
        return None;
    }
    let floats = width as usize * height as usize * 4;
    let end = header.checked_add(floats.checked_mul(4)?)?;
    let data = bytes.get(header..end)?;
    let rgba = data
        .chunks_exact(4)
        .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
        .collect();
    Some((
        LinearImage {
            width,
            height,
            rgba,
        },
        end,
    ))
}

/// Where the image and its passes come from.
#[derive(Clone, Debug)]
pub enum PostSource {
    /// A final render the launcher kept, by its job id.
    Render(u32),
    /// Sent along (the Fast-mode preview): the image, its passes, and how it is looked at
    /// (linear and 0 EV unless the body says otherwise: the preview's picture is already what the
    /// person sees).
    Inline {
        /// The picture.
        image: LinearImage,
        /// Its passes.
        passes: Box<EnginePasses>,
        /// Its tone curve and exposure.
        look: Look,
    },
}

/// What `POST /api/ai/post` asks for.
#[derive(Clone, Debug)]
pub struct PostRequest {
    /// The image and its passes.
    pub source: PostSource,
    /// The configurator's controls and the seed.
    pub settings: Settings,
    /// The prompt (`src/ai/prompt.ts`).
    pub prompt: String,
    /// The negative prompt.
    pub negative: String,
    /// `ai-models.json` key (or an imported model's).
    pub model: String,
    /// The material regions the passes name (`AiGuardMaterial`).
    pub materials: Vec<MaterialInfo>,
    /// Tolerances in place of the provisional ones (X1 part B calibrates with them).
    pub tolerances: Vec<(String, f32)>,
    /// The backend the person forced (`VULKAN`, `CPU`).
    pub force: Option<String>,
    /// The person chose the CPU (`ai.device`).
    pub cpu: bool,
    /// Sampling steps in place of the family's.
    pub steps: Option<u32>,
}

fn control(v: &Value, key: &str) -> Result<u32, Refusal> {
    let n = v
        .get(key)
        .and_then(Value::as_f64)
        .filter(|n| (0.0..=100.0).contains(n) && n.fract() == 0.0)
        .ok_or_else(|| Refusal::bad(format!("'settings.{key}' must be a whole number 0..100")))?;
    Ok(n as u32)
}

impl PostRequest {
    /// Reads the JSON of a post; `source` is resolved by the caller for `INLINE`.
    pub fn from_json(
        v: &Value,
        inline: Option<(LinearImage, EnginePasses)>,
    ) -> Result<PostRequest, Refusal> {
        let text = |k: &str| v.get(k).and_then(Value::as_str);
        let source = v.get("source").ok_or_else(|| {
            Refusal::bad("'source' must be {kind: RENDER, renderId} or {kind: INLINE}")
        })?;
        let kind = source.get("kind").and_then(Value::as_str);
        let source = match (kind, inline) {
            (Some("RENDER"), None) => {
                let id = match source.get("renderId") {
                    Some(Value::String(s)) => s.parse::<u32>().ok(),
                    Some(Value::Number(n))
                        if n.fract() == 0.0 && *n >= 1.0 && *n <= f64::from(u32::MAX) =>
                    {
                        Some(*n as u32)
                    }
                    _ => None,
                }
                .ok_or_else(|| Refusal::bad("'source.renderId' must be a render's id"))?;
                PostSource::Render(id)
            }
            (Some("INLINE"), Some((image, passes))) => {
                let tonemap = source
                    .get("tonemap")
                    .and_then(Value::as_f64)
                    .filter(|t| (0.0..=16.0).contains(t) && t.fract() == 0.0)
                    .map_or(0, |t| t as u32);
                let exposure_ev = source
                    .get("exposureEv")
                    .and_then(Value::as_f64)
                    .filter(|e| e.is_finite() && e.abs() <= 64.0)
                    .map_or(0.0, |e| e as f32);
                PostSource::Inline {
                    image,
                    passes: Box::new(passes),
                    look: Look {
                        tonemap,
                        exposure_ev,
                    },
                }
            }
            (Some("INLINE"), None) => {
                return Err(Refusal::bad(
                    "an INLINE source is sent as an RPI1 body with the image and its passes",
                ))
            }
            _ => return Err(Refusal::bad("'source.kind' must be RENDER or INLINE")),
        };
        let s = v
            .get("settings")
            .filter(|s| matches!(s, Value::Object(_)))
            .ok_or_else(|| Refusal::bad("'settings' must be the pipeline's settings"))?;
        let seed = s
            .get("seed")
            .and_then(Value::as_f64)
            .filter(|n| (0.0..=f64::from(u32::MAX)).contains(n) && n.fract() == 0.0)
            .ok_or_else(|| Refusal::bad("'settings.seed' must be a whole number 0..2^32-1"))?;
        let settings = Settings {
            intervention: control(s, "intervention")?,
            light: control(s, "light")?,
            bounce: control(s, "bounce")?,
            wear: control(s, "wear")?,
            style_strength: control(s, "styleStrength")?,
            seed: seed as u32,
        };
        let model = text("modelKey")
            .filter(|k| valid_name(k))
            .ok_or_else(|| Refusal::bad("'modelKey' must be a model key"))?;
        let prompt = text("prompt").unwrap_or("");
        let negative = text("negative").unwrap_or("");
        if prompt.chars().count() > 8000 || negative.chars().count() > 8000 {
            return Err(Refusal::bad("prompts of at most 8000 characters"));
        }
        let mut materials = Vec::new();
        match v.get("materials") {
            None | Some(Value::Null) => {}
            Some(Value::Array(list)) if list.len() <= MAX_MATERIALS => {
                for m in list {
                    let id = m
                        .get("materialId")
                        .and_then(Value::as_f64)
                        .filter(|n| (1.0..=f64::from(u32::MAX)).contains(n) && n.fract() == 0.0);
                    let name = m
                        .get("name")
                        .and_then(Value::as_str)
                        .filter(|n| n.chars().count() <= 200);
                    let flag = |k: &str| m.get(k).and_then(Value::as_bool);
                    match (id, name, flag("allowsWear"), flag("locked")) {
                        (Some(id), Some(name), Some(allows_wear), Some(locked)) => {
                            materials.push(MaterialInfo {
                                id: id as u32,
                                name: name.to_string(),
                                allows_wear,
                                locked,
                            })
                        }
                        _ => {
                            return Err(Refusal::bad(
                                "'materials' must be [{materialId, name, allowsWear, locked}]",
                            ))
                        }
                    }
                }
            }
            Some(_) => {
                return Err(Refusal::bad(
                    "'materials' must be a list of the guard's materials",
                ))
            }
        }
        let mut tolerances = Vec::new();
        match v.get("tolerances") {
            None | Some(Value::Null) => {}
            Some(Value::Object(fields)) if fields.len() <= 32 => {
                for (k, val) in fields {
                    let n = val
                        .as_f64()
                        .ok_or_else(|| Refusal::bad(format!("tolerance {k}: not a number")))?;
                    // Checked by the guard's own rules (a known key, a non-negative number).
                    let mut check = rt_post::Tolerances::PROVISIONAL;
                    check
                        .set(k, n as f32)
                        .map_err(|e| Refusal::bad(e.to_string()))?;
                    tolerances.push((k.clone(), n as f32));
                }
            }
            Some(_) => return Err(Refusal::bad("'tolerances' must be {key: number}")),
        }
        let steps = match v.get("steps") {
            None | Some(Value::Null) => None,
            Some(n) => Some(
                n.as_f64()
                    .filter(|n| (1.0..=200.0).contains(n) && n.fract() == 0.0)
                    .ok_or_else(|| Refusal::bad("'steps' must be a whole number 1..200"))?
                    as u32,
            ),
        };
        Ok(PostRequest {
            source,
            settings,
            prompt: prompt.to_string(),
            negative: negative.to_string(),
            model: model.to_string(),
            materials,
            tolerances,
            force: text("force").map(str::to_string),
            cpu: text("device") == Some("cpu"),
            steps,
        })
    }

    /// Reads an inline body: [`INLINE_MAGIC`], the JSON, the image and the passes.
    pub fn from_inline(bytes: &[u8]) -> Result<PostRequest, Refusal> {
        if bytes.get(..4) != Some(&INLINE_MAGIC[..]) {
            return Err(Refusal::bad("an inline body starts with RPI1"));
        }
        let len = u32_at(bytes, 4).ok_or_else(|| Refusal::bad("the body ends too early"))? as usize;
        if len > MAX_POST_JSON {
            return Err(Refusal::bad("the JSON part is too long"));
        }
        let text = bytes
            .get(8..8 + len)
            .and_then(|t| std::str::from_utf8(t).ok())
            .ok_or_else(|| Refusal::bad("the JSON part is not UTF-8 text"))?;
        let v = json::parse(text).map_err(|e| Refusal::bad(e.to_string()))?;
        let rest = &bytes[8 + len..];
        let (image, used) = read_image(rest, PREVIEW_MAX_SIDE).ok_or_else(|| {
            Refusal::bad(format!(
                "the image must be RPL1 of at most {PREVIEW_MAX_SIDE} px a side"
            ))
        })?;
        let (_, _, passes) = read_passes(&rest[used..])
            .ok_or_else(|| Refusal::bad("the passes must be an RPP1 file"))?;
        if (passes.width, passes.height) != (image.width, image.height) {
            return Err(Refusal::bad("the passes are not the image's size"));
        }
        PostRequest::from_json(&v, Some((image, passes)))
    }
}

/// The guard's view of a render's passes; the ids are required.
fn guard_passes(p: &EnginePasses) -> Option<Passes<'_>> {
    let has = |bit: u32| p.mask & bit != 0;
    if !has(PASS_PART_ID) || !has(PASS_MATERIAL_ID) {
        return None;
    }
    Some(Passes {
        width: p.width,
        height: p.height,
        part_id: &p.part_id,
        material_id: &p.material_id,
        normal: has(PASS_NORMAL).then_some(&p.normal[..]),
        depth: has(PASS_DEPTH).then_some(&p.depth[..]),
        coc: has(PASS_COC).then_some(&p.coc[..]),
    })
}

/// The state of one post.
#[derive(Debug)]
struct PostState {
    version: u32,
    /// `QUEUED`, an `AiPostStage` (`LOADING`, `CONDITIONING`, `INFERENCE`, `GUARD`, `RETRY`), or
    /// `DONE`, `FAILED`, `CANCELLED`.
    phase: &'static str,
    /// 1-based tile and attempt.
    tile: u32,
    attempt: u32,
    strength: f32,
    step: u32,
    steps: u32,
    fraction: f64,
    /// The fraction where this attempt's work started, and where its slice of the bar ends.
    base: f64,
    top: f64,
    /// Why the guard sent the previous attempt back (its words); none until one was.
    last_failure: Option<String>,
    started: Instant,
    ended: Option<Instant>,
    error: Option<(String, String)>,
    image: Option<Arc<LinearImage>>,
    report: Option<String>,
    verdict: Option<&'static str>,
    /// Calls made to the inference runtime.
    calls: u32,
}

/// One post-processing job.
#[derive(Debug)]
pub struct Post {
    /// Its id.
    pub id: u32,
    /// The render it post-processes (`RENDER` sources).
    pub render_id: Option<u32>,
    width: u32,
    height: u32,
    tiles: u32,
    model: String,
    runtime: String,
    look: Look,
    cancel: AtomicBool,
    state: Mutex<PostState>,
    changed: Condvar,
    /// When its page last asked about it, and how long it may go unasked.
    seen: Mutex<Instant>,
    orphan_after: Duration,
}

/// Where an attempt's inference ends, as a fraction of its slice of the bar.
const INFERENCE_SHARE: f64 = 0.9;

/// The slice of the bar an attempt (0 first) owns: the bar is split by the most attempts there can be, so
/// it only reaches the end when the work does, and a retry moves it to the start of the next slice.
fn attempt_range(attempt: u32) -> (f64, f64) {
    let width = 1.0 / f64::from(MAX_ATTEMPTS);
    (f64::from(attempt) * width, f64::from(attempt + 1) * width)
}

impl Post {
    fn set(&self, f: impl FnOnce(&mut PostState)) {
        let mut s = lock(&self.state);
        f(&mut s);
        s.version += 1;
        self.changed.notify_all();
    }

    /// The fraction at the end of an attempt's inference, in its slice from `base` to `top`.
    fn inference_end(base: f64, top: f64) -> f64 {
        base + (top - base) * INFERENCE_SHARE
    }

    /// Its page asked about it: it is still wanted.
    pub fn touch(&self) {
        *lock(&self.seen) = Instant::now();
    }

    /// Nobody asked about it for longer than its limit: it is cancelled (the runtime hears it
    /// at its next look) and true is returned.
    fn reap_if_orphaned(&self) -> bool {
        let gone = lock(&self.seen).elapsed() > self.orphan_after;
        if gone && !self.cancel.swap(true, Ordering::AcqRel) {
            crate::log!("AI post {}: nobody asked for it, stopped", self.id);
        }
        gone
    }

    /// A tile's runtime progress.
    fn tile_progress(&self, tile: u32, p: Progress) {
        self.reap_if_orphaned();
        let mut s = lock(&self.state);
        let retry = s.attempt > 1;
        let phase = match p.stage {
            Stage::Starting | Stage::Loading => "LOADING",
            _ if retry => "RETRY",
            _ => "INFERENCE",
        };
        let part = if p.steps > 0 && matches!(p.stage, Stage::Inference | Stage::Finishing) {
            f64::from(p.step) / f64::from(p.steps)
        } else {
            0.0
        };
        let done = (f64::from(tile - 1) + part) / f64::from(self.tiles.max(1));
        let fraction =
            (s.base + (Post::inference_end(s.base, s.top) - s.base) * done).max(s.fraction);
        if (s.phase, s.tile, s.step, s.steps) != (phase, tile, p.step, p.steps)
            || fraction != s.fraction
        {
            s.phase = phase;
            s.tile = tile;
            s.step = p.step;
            s.steps = p.steps;
            s.fraction = fraction;
            s.version += 1;
            self.changed.notify_all();
        }
    }

    fn finished(&self) -> bool {
        lock(&self.state).ended.is_some()
    }

    /// Waits up to `limit` for a state newer than `after`.
    pub fn wait_newer(&self, after: u32, limit: Duration) {
        let deadline = Instant::now() + limit;
        let mut s = lock(&self.state);
        while s.version <= after && s.ended.is_none() {
            let left = deadline.saturating_duration_since(Instant::now());
            if left.is_zero() {
                break;
            }
            s = self
                .changed
                .wait_timeout(s, left)
                .map(|(g, _)| g)
                .unwrap_or_else(|e| e.into_inner().0);
        }
    }

    /// The delivered image of a finished post (the engine's when it was rejected).
    pub fn image(&self) -> Option<Arc<LinearImage>> {
        lock(&self.state).image.clone()
    }

    /// Calls made to the inference runtime so far.
    pub fn calls(&self) -> u32 {
        lock(&self.state).calls
    }

    /// `GET /api/ai/post/<id>`.
    pub fn to_json(&self) -> String {
        let s = lock(&self.state);
        let seconds = s
            .ended
            .unwrap_or_else(Instant::now)
            .duration_since(s.started)
            .as_secs_f64();
        let stage = matches!(
            s.phase,
            "LOADING" | "CONDITIONING" | "INFERENCE" | "GUARD" | "RETRY"
        )
        .then_some(s.phase);
        json::Object::new()
            .num("id", f64::from(self.id))
            .str("state", s.phase)
            .opt_str("stage", stage)
            .num("tile", f64::from(s.tile))
            .num("tiles", f64::from(self.tiles))
            .num("attempt", f64::from(s.attempt))
            .num("maxAttempts", f64::from(MAX_ATTEMPTS))
            .opt_str("lastFailure", s.last_failure.as_deref())
            .num("strength", (f64::from(s.strength) * 1.0e6).round() / 1.0e6)
            .num("step", f64::from(s.step))
            .num("steps", f64::from(s.steps))
            .num("fraction", (s.fraction * 1000.0).round() / 1000.0)
            .num("seconds", (seconds * 1000.0).round() / 1000.0)
            .num("version", f64::from(s.version))
            .num("calls", f64::from(s.calls))
            .opt_num("renderId", self.render_id.map(f64::from))
            .str("model", &self.model)
            .str("runtime", &self.runtime)
            .num("width", f64::from(self.width))
            .num("height", f64::from(self.height))
            .num("tonemap", f64::from(self.look.tonemap))
            .num("exposureEv", f64::from(self.look.exposure_ev))
            .opt_str("verdict", s.verdict)
            .raw("report", s.report.as_deref().unwrap_or("null"))
            .opt_str("error", s.error.as_ref().map(|e| e.0.as_str()))
            .opt_str("message", s.error.as_ref().map(|e| e.1.as_str()))
            .build()
    }
}

/// Everything a post's thread needs.
struct Work {
    plan: Plan,
    original: LinearImage,
    passes: Arc<EnginePasses>,
    /// How the runtime runs the model, when the plan runs it.
    run: Option<ModelRun>,
    prompt: String,
    negative: String,
}

/// What the runtime is given for one tile: its image and its control image, PNG in base64.
struct TileInputs {
    image: String,
    control: Option<String>,
}

/// A PNG of 8-bit RGB, in base64.
fn png_b64(width: u32, height: u32, rgb: &[u8]) -> String {
    b64::encode(&rt_core::png::encode(width, height, rgb))
}

/// The control image of a tile for the runtime: the depth plane as grey, or the tile itself.
fn control_image(kind: &str, input: &Rgb8Image, ctl: &rt_post::TileControl) -> Vec<u8> {
    match kind {
        "tile" => input.rgb.clone(),
        "depth" => ctl.depth.iter().flat_map(|&d| [d, d, d]).collect(),
        _ => ctl.edges.iter().flat_map(|&d| [d, d, d]).collect(),
    }
}

/// What a tile came back as: the image, or a stand-in of the size it came back at (the guard's
/// size check rejects it and the engine image is delivered).
enum TileOutcome {
    Image(Rgb8Image),
    Failed(SidecarError),
}

fn decode_tile(bytes: &[u8], tile: &Tile) -> Result<Rgb8Image, SidecarError> {
    let img = png::decode(
        bytes,
        u64::from(tile.padded_width) * u64::from(tile.padded_height),
    )
    .map_err(|e| SidecarError::BadImage(e.to_string()))?;
    Ok(Rgb8Image {
        width: img.width,
        height: img.height,
        rgb: png::rgb_of(&img),
    })
}

impl Ai {
    /// Checks a post and starts it (`POST /api/ai/post`). Nothing that runs the model is checked
    /// when the plan does not run it: Intervention 0 works with no runtime and no model.
    pub fn submit_post(
        self: &Arc<Self>,
        engine: &crate::render::Engine,
        models: &crate::models::Store,
        req: PostRequest,
        gpu: Option<bool>,
    ) -> Result<Arc<Post>, Refusal> {
        let (original, passes, look, render_id) = match req.source {
            PostSource::Render(id) => {
                let kept = engine.kept(id).ok_or_else(|| Refusal {
                    status: 404,
                    code: "not-kept",
                    reason: None,
                    message: format!(
                        "render {id} is not kept (only the last few finals that asked for passes are)"
                    ),
                })?;
                let image = linear_of(&kept.image)
                    .ok_or_else(|| Refusal::bad(format!("render {id} has no image")))?;
                (image, kept.passes, kept.look, Some(id))
            }
            PostSource::Inline {
                image,
                passes,
                look,
            } => (image, Arc::new(*passes), look, None),
        };
        if guard_passes(&passes).is_none() {
            return Err(Refusal {
                status: 409,
                code: "no-passes",
                reason: None,
                message: "the image's passes have no part and material ids".into(),
            });
        }
        let mut job = GuardJob::new(original.width, original.height, req.settings);
        job.tonemap = Tonemap::from_u32(look.tonemap);
        job.exposure_ev = look.exposure_ev;
        job.materials = req.materials;
        for (k, v) in &req.tolerances {
            job.tolerances
                .set(k, *v)
                .map_err(|e| Refusal::bad(e.to_string()))?;
        }
        job.model_key.clone_from(&req.model);
        let chosen = self
            .choice(gpu, req.force.as_deref())
            .and_then(|c| c.key)
            .unwrap_or_default();
        job.runtime.clone_from(&chosen);
        let plan = rt_post::plan(&job).map_err(|e| Refusal::bad(e.to_string()))?;
        let run = if plan.runs_model() {
            let fits =
                |s: u32| (MIN_SIDE..=MAX_SIDE).contains(&s) && s.is_multiple_of(SIDE_MULTIPLE);
            if let Some(t) = plan
                .tiles()
                .iter()
                .find(|t| !fits(t.padded_width) || !fits(t.padded_height))
            {
                return Err(Refusal {
                    status: 400,
                    code: "size",
                    reason: None,
                    message: format!(
                        "tiles of {}×{}: the runtime takes sides from {MIN_SIDE} to {MAX_SIDE} pixels",
                        t.padded_width, t.padded_height
                    ),
                });
            }
            let run = self.prepare_model(
                models,
                &req.model,
                req.force.as_deref(),
                gpu,
                super::ControlWish::FirstOf(&["depth", "tile"]),
                req.steps,
            )?;
            Some(run)
        } else {
            None
        };
        let runtime = run.as_ref().map_or(chosen, |r| r.runtime.clone());
        let mut posts = lock(&self.posts);
        if posts.values().filter(|p| !p.finished()).count() >= MAX_POSTS {
            return Err(Refusal {
                status: 503,
                code: "busy",
                reason: None,
                message: format!("{MAX_POSTS} posts are already waiting"),
            });
        }
        let finished: Vec<u32> = posts
            .iter()
            .filter(|(_, p)| p.finished())
            .map(|(id, _)| *id)
            .collect();
        let too_old = |p: &Post| {
            lock(&p.state)
                .ended
                .is_some_and(|e| e.elapsed() > Duration::from_secs(600))
        };
        let excess = finished.len().saturating_sub(KEEP_POSTS);
        for (i, id) in finished.iter().enumerate() {
            if i < excess || posts.get(id).is_some_and(|p| too_old(p)) {
                posts.remove(id);
            }
        }
        let id = self.next_post.fetch_add(1, Ordering::Relaxed);
        let post = Arc::new(Post {
            id,
            render_id,
            width: original.width,
            height: original.height,
            tiles: plan.tiles().len() as u32,
            model: req.model.clone(),
            runtime,
            look,
            cancel: AtomicBool::new(false),
            state: Mutex::new(PostState {
                version: 1,
                phase: "QUEUED",
                tile: 0,
                attempt: 0,
                strength: 0.0,
                step: 0,
                steps: 0,
                fraction: 0.0,
                base: 0.0,
                top: 1.0,
                last_failure: None,
                started: Instant::now(),
                ended: None,
                error: None,
                image: None,
                report: None,
                verdict: None,
                calls: 0,
            }),
            changed: Condvar::new(),
            seen: Mutex::new(Instant::now()),
            orphan_after: *lock(&self.post_orphan),
        });
        posts.insert(id, Arc::clone(&post));
        drop(posts);
        let work = Work {
            plan,
            original,
            passes,
            run,
            prompt: req.prompt,
            negative: req.negative,
        };
        let (ai, p) = (Arc::clone(self), Arc::clone(&post));
        std::thread::Builder::new()
            .name("ai-post".into())
            .spawn(move || {
                // A panic in the guard ends the post as failed, not with a page waiting for ever.
                let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    ai.run_post(&p, work)
                }));
                if result.is_err() {
                    p.set(|s| {
                        if s.ended.is_none() {
                            s.ended = Some(Instant::now());
                            s.phase = "FAILED";
                            s.error =
                                Some(("panic".into(), "the pipeline stopped unexpectedly".into()));
                        }
                    });
                }
            })
            .map_err(|e| Refusal {
                status: 500,
                code: "thread",
                reason: None,
                message: e.to_string(),
            })?;
        Ok(post)
    }

    /// A post's thread: conditioning, the tiles through the runtime, the guard, the retries.
    fn run_post(&self, post: &Post, work: Work) {
        let Work {
            plan,
            original,
            passes,
            run,
            prompt,
            negative,
        } = work;
        let Some(view) = guard_passes(&passes) else {
            return self.fail_post(post, "no-passes", "the passes have no ids".into());
        };
        let finish = |image: LinearImage, mut report: rt_post::Report, s: &mut PostState| {
            report.seconds = s.started.elapsed().as_secs_f32();
            s.verdict = Some(report.verdict.key());
            s.report = Some(report.to_json());
            s.image = Some(Arc::new(image));
            s.phase = "DONE";
            s.fraction = 1.0;
            s.ended = Some(Instant::now());
        };
        let Some(run) = run.filter(|_| plan.runs_model()) else {
            // Nothing may change: the guard's own answer (the engine image, bit for bit), and the
            // runtime is never asked.
            match rt_post::accept(&plan, &original, &view, &[], 0) {
                Ok(Outcome::Accepted { image, report }) => post.set(|s| finish(image, report, s)),
                Ok(other) => self.fail_post(post, "guard", format!("unexpected {other:?}")),
                Err(e) => self.fail_post(post, "guard", e.to_string()),
            }
            return;
        };
        post.set(|s| {
            s.phase = "CONDITIONING";
            s.fraction = 0.01;
            // The first attempt's slice starts after the conditioning.
            s.base = 0.02;
            s.top = attempt_range(0).1;
        });
        // Every tile's image and control image, as the runtime takes them (PNG in base64), once.
        let prepared: Result<Vec<TileInputs>, rt_post::PostError> = (|| {
            let planes = rt_post::control_planes(&plan, &view)?;
            (0..plan.tiles().len())
                .map(|i| {
                    let input = rt_post::tile_input(&plan, &original, i)?;
                    let control = match &run.control {
                        Some((kind, _)) => {
                            let ctl = rt_post::tile_control(&plan, &planes, i)?;
                            Some(png_b64(
                                ctl.width,
                                ctl.height,
                                &control_image(kind, &input, &ctl),
                            ))
                        }
                        None => None,
                    };
                    Ok(TileInputs {
                        image: png_b64(input.width, input.height, &input.rgb),
                        control,
                    })
                })
                .collect()
        })();
        let inputs = match prepared {
            Ok(p) => p,
            Err(e) => return self.fail_post(post, "guard", e.to_string()),
        };
        let mut attempt = 0u32;
        loop {
            let strength = plan.strength(attempt);
            post.set(|s| {
                s.attempt = attempt + 1;
                s.strength = strength;
                s.tile = 0;
                s.step = 0;
                s.steps = 0;
                if attempt > 0 {
                    let (base, top) = attempt_range(attempt);
                    s.phase = "RETRY";
                    s.base = base;
                    s.top = top;
                    s.fraction = s.fraction.max(base);
                }
            });
            let mut outputs = Vec::with_capacity(plan.tiles().len());
            for (i, tile) in plan.tiles().iter().enumerate() {
                if post.reap_if_orphaned() || post.cancel.load(Ordering::Acquire) {
                    return self.cancel_post(post);
                }
                let job = SidecarJob {
                    prompt: prompt.clone(),
                    negative: negative.clone(),
                    width: tile.padded_width,
                    height: tile.padded_height,
                    strength: f64::from(strength),
                    seed: u64::from(plan.job().settings.seed),
                    steps: run.steps,
                    cfg_scale: run.cfg_scale,
                    sampler: run.sampler.clone(),
                    flow_shift: run.flow_shift,
                    image_b64: inputs[i].image.clone(),
                    as_reference: run.as_reference,
                    control: match (&inputs[i].control, &run.control) {
                        (Some(img), Some((_, s))) => Some((img.clone(), *s)),
                        _ => None,
                    },
                };
                let n = i as u32 + 1;
                post.set(|s| s.calls += 1);
                // Every tile says it started (a quick one may end between two looks at the
                // runtime): loading while the model is not the one loaded, else inference.
                let loaded = self.sidecar.info().label.as_deref() == Some(run.spec.label.as_str());
                post.tile_progress(
                    n,
                    Progress {
                        stage: if loaded {
                            Stage::Queued
                        } else {
                            Stage::Loading
                        },
                        step: 0,
                        steps: 0,
                    },
                );
                let result = self.sidecar.run(&run.spec, &job, &post.cancel, &mut |p| {
                    post.tile_progress(n, p)
                });
                let outcome = match result {
                    Ok(bytes) => match decode_tile(&bytes, tile) {
                        Ok(img) => TileOutcome::Image(img),
                        Err(e) => TileOutcome::Failed(e),
                    },
                    Err(e) => TileOutcome::Failed(e),
                };
                match outcome {
                    TileOutcome::Image(img) => outputs.push(img),
                    // Another size: what the guard's size check is for (it rejects at once).
                    TileOutcome::Failed(SidecarError::WrongSize { got, .. }) => {
                        outputs.push(Rgb8Image {
                            width: got.0,
                            height: got.1,
                            rgb: Vec::new(),
                        });
                    }
                    TileOutcome::Failed(SidecarError::Cancelled) => return self.cancel_post(post),
                    TileOutcome::Failed(e) => {
                        if post.cancel.load(Ordering::Acquire) {
                            return self.cancel_post(post);
                        }
                        return self.fail_post(post, e.code(), e.message());
                    }
                }
            }
            if post.cancel.load(Ordering::Acquire) {
                return self.cancel_post(post);
            }
            post.set(|s| {
                s.phase = "GUARD";
                s.fraction = s.fraction.max(Post::inference_end(s.base, s.top));
            });
            match rt_post::accept(&plan, &original, &view, &outputs, attempt) {
                Ok(Outcome::Accepted { image, report }) => {
                    post.set(|s| finish(image, report, s));
                    return;
                }
                Ok(Outcome::Rejected { report }) => {
                    crate::log!(
                        "AI post {}: rejected ({})",
                        post.id,
                        report.reason.as_deref().unwrap_or("")
                    );
                    post.set(|s| finish(original.clone(), report, s));
                    return;
                }
                Ok(Outcome::Retry {
                    attempt: next,
                    reason,
                    ..
                }) => {
                    crate::log!(
                        "AI post {}: attempt {} of {MAX_ATTEMPTS} failed: {reason}",
                        post.id,
                        attempt + 1
                    );
                    // The next attempt's slice starts where this one's ended; the page shows why.
                    post.set(|s| {
                        s.fraction = s.fraction.max(attempt_range(next).0);
                        s.last_failure = Some(reason);
                    });
                    attempt = next;
                }
                Err(e) => return self.fail_post(post, "guard", e.to_string()),
            }
        }
    }

    fn fail_post(&self, post: &Post, code: &str, message: String) {
        crate::log!("AI post {}: {message}", post.id);
        post.set(|s| {
            s.phase = "FAILED";
            s.error = Some((code.to_string(), message));
            s.ended = Some(Instant::now());
        });
    }

    fn cancel_post(&self, post: &Post) {
        post.set(|s| {
            s.phase = "CANCELLED";
            s.ended = Some(Instant::now());
        });
    }

    /// A post by id.
    pub fn post(&self, id: u32) -> Option<Arc<Post>> {
        lock(&self.posts).get(&id).cloned()
    }

    /// How long a running post may go unasked ([`ORPHAN_AFTER`]; the tests shorten it).
    pub fn set_post_orphan_after(&self, limit: Duration) {
        *lock(&self.post_orphan) = limit;
    }

    /// Cancels every post (the application ends).
    pub(super) fn cancel_posts(&self) {
        for p in lock(&self.posts).values() {
            p.cancel.store(true, Ordering::Release);
        }
    }

    /// `DELETE /api/ai/post/<id>`: cancels a running post, forgets a finished one.
    pub fn forget_post(&self, post: &Post) {
        if post.finished() {
            lock(&self.posts).remove(&post.id);
        } else {
            post.cancel.store(true, Ordering::Release);
        }
    }
}

/// The posts, by id (kept in [`Ai`]).
pub(super) type Posts = Mutex<BTreeMap<u32, Arc<Post>>>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_bar_is_split_by_the_most_attempts_there_can_be() {
        // Four attempts, a quarter of the bar each, one after the other, none past the end.
        let ranges: Vec<(f64, f64)> = (0..MAX_ATTEMPTS).map(attempt_range).collect();
        assert_eq!(ranges.len(), 4);
        assert_eq!(ranges[0].0, 0.0);
        assert_eq!(ranges[3].1, 1.0);
        for w in ranges.windows(2) {
            assert_eq!(w[0].1, w[1].0, "{ranges:?}");
        }
        // Inference ends before its slice does, so the guard has room, and never at the slice's end.
        for (base, top) in ranges {
            let end = Post::inference_end(base, top);
            assert!(base < end && end < top, "{base} {end} {top}");
        }
    }

    #[test]
    fn the_linear_image_is_the_pages_conversion_of_the_sums() {
        // Opaque, half covered, empty, and a sum whose alpha rounds to just below opaque.
        let frame = Frame {
            pass: 1,
            samples: 3,
            width: 4,
            height: 1,
            seconds: 0.0,
            flags: 0,
            max_samples: 3,
            threads: 1,
            rays: 0,
            sums: Arc::new(vec![
                0.9, 0.6, 0.3, 3.0, //
                0.3, 0.15, 0.6, 1.5, //
                0.0, 0.0, 0.0, 0.0, //
                1.0, 1.0, 1.0, 2.999_99,
            ]),
            noisy: None,
            version: 1,
            adaptive: None,
        };
        let img = linear_of(&frame).unwrap();
        let inv = (1.0f64 / 3.0) as f32;
        assert_eq!(&img.rgba[..4], &[0.9 * inv, 0.6 * inv, 0.3 * inv, 1.0]);
        let a = 1.5 * inv;
        assert_eq!(
            &img.rgba[4..8],
            &[0.3 * inv / a, 0.15 * inv / a, 0.6 * inv / a, a]
        );
        assert_eq!(&img.rgba[8..12], &[0.0; 4]);
        let a = 2.999_99f32 * inv;
        assert!(f64::from(a) < OPAQUE);
        assert_eq!(img.rgba[15], a);
        // The f32 just below the page's 1 − 1e-6 (a double) is not opaque, as on the page; an
        // f32 threshold would round onto it and call it opaque.
        let edge = OPAQUE as f32;
        assert!(f64::from(edge) < OPAQUE);
        let single = Frame {
            samples: 1,
            width: 1,
            sums: Arc::new(vec![0.5, 0.5, 0.5, edge]),
            ..frame.clone()
        };
        let px = linear_of(&single).unwrap().rgba;
        assert_eq!(px, vec![0.5 / edge, 0.5 / edge, 0.5 / edge, edge]);
        // The bytes round trip.
        let bytes = write_image(&img);
        assert_eq!(&bytes[..4], b"RPL1");
        let (back, used) = read_image(&bytes, 16).unwrap();
        assert_eq!((back, used), (img.clone(), bytes.len()));
        assert!(read_image(&bytes, 3).is_none(), "wider than allowed");
        assert!(read_image(&bytes[..bytes.len() - 1], 16).is_none());
        let wrong = Frame {
            sums: Arc::new(vec![0.0; 3]),
            ..frame
        };
        assert!(linear_of(&wrong).is_none());
    }

    #[test]
    fn requests_are_read_and_refused_with_a_reason() {
        let body = |extra: &str| {
            format!(
                "{{\"source\":{{\"kind\":\"RENDER\",\"renderId\":\"7\"}},\"settings\":{{\"intervention\":30,\"light\":50,\"bounce\":40,\"wear\":20,\"style\":\"NATURAL\",\"styleStrength\":30,\"seed\":4294967295}},\"prompt\":\"p\",\"negative\":\"n\",\"modelKey\":\"ZIMAGE_Q4\"{extra}}}"
            )
        };
        let read = |text: &str| PostRequest::from_json(&json::parse(text).unwrap(), None);
        let r = read(&body(
            ",\"materials\":[{\"materialId\":4294967295,\"name\":\"Floor\",\"allowsWear\":false,\"locked\":false}],\"tolerances\":{\"edgesPx\":0.5},\"device\":\"cpu\"",
        ))
        .unwrap();
        assert!(matches!(r.source, PostSource::Render(7)));
        assert_eq!(r.settings.intervention, 30);
        assert_eq!(r.settings.seed, u32::MAX);
        assert_eq!(r.materials[0].id, rt_post::FLOOR_ID);
        assert_eq!(r.tolerances, vec![("edgesPx".to_string(), 0.5)]);
        assert!(r.cpu);
        for bad in [
            body(",\"materials\":[{\"materialId\":0,\"name\":\"x\",\"allowsWear\":false,\"locked\":false}]"),
            body(",\"tolerances\":{\"nope\":1}"),
            body(",\"tolerances\":{\"edgesPx\":-1}"),
            body(",\"steps\":0"),
            body("").replace("\"intervention\":30", "\"intervention\":101"),
            body("").replace("\"light\":50", "\"light\":0.5"),
            body("").replace("\"RENDER\"", "\"INLINE\""),
            body("").replace("\"7\"", "\"x\""),
            body("").replace("ZIMAGE_Q4", "../x"),
        ] {
            let e = read(&bad).unwrap_err();
            assert_eq!(e.status, 400, "{bad}: {e:?}");
        }
    }
}
