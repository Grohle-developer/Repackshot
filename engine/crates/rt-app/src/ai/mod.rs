//! AI post-processing on the desktop: the inference runtime (phase X3b, `docs/AI-POST.md` §7.1).
//!
//! stable-diffusion.cpp runs as a **separate process** the launcher downloads, starts, feeds and
//! stops; it is never linked and never copied into `engine/`.
//!
//! * [`catalogue`]: `src/data/ai-runtimes.json` (the pinned builds, the rule that chooses one,
//!   how each model family is run).
//! * [`runtimes`]: the installed builds in `<data>/ai/runtimes/<sha256>/`, downloaded with
//!   [`download`] (the system's `curl`), checked by SHA-256, unpacked with [`zip`].
//! * [`sidecar`]: the running `sd-server`, its protocol, its progress, its limits.
//! * [`inflate`], [`png`], [`b64`]: the formats in between, written from their specifications.
//!
//! This module ties them together: the status the page shows (`GET /api/ai/runtime`, an
//! `AiRuntimeStatus` of `src/core/ai.ts` and more), the install endpoints, and **one raw img2img
//! inference** (`POST /api/ai/run`), with progress and cancel like the render jobs. The guard,
//! the tiles and the pipeline are not here (X3a, X3c); [`Ai::prepare`] and [`Ai::infer`] are what
//! the pipeline will call.

pub mod b64;
pub mod catalogue;
pub mod download;
pub mod inflate;
pub mod png;
pub mod proc;
pub mod runtimes;
pub mod sidecar;
pub mod zip;

use crate::http::{Body, Request, Response};
use crate::json::{self, Value};
use crate::models::Store;
use crate::recommend::{valid_name, ModelFile};
use crate::server::App;
use catalogue::{choose, resolve_args, Choice, ChoiceInput, ImageMode, RuntimeCatalogue};
use download::Downloader;
use runtimes::{Runtimes, Source, State};
use sidecar::{Job, Progress, Sidecar, SidecarError, Spec};
use std::collections::{BTreeMap, HashMap};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Condvar, Mutex, MutexGuard, OnceLock, PoisonError};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(PoisonError::into_inner)
}

/// Largest body of `POST /api/ai/run` (two PNG images in base64).
pub const MAX_RUN_BODY: u64 = 96 << 20;
/// Largest side of an image the runtime is sent (the server's own limit).
pub const MAX_SIDE: u32 = 4096;
/// Smallest side.
pub const MIN_SIDE: u32 = 64;
/// Sides are multiples of this (the pipeline pads to it: `AI-POST.md` §3.2).
pub const SIDE_MULTIPLE: u32 = 16;
/// Runs waiting or running at once.
pub const MAX_PENDING: usize = 4;
/// Finished runs kept for the page to collect.
pub const KEEP_FINISHED: usize = 8;

/// The `family` of every model of `ai-models.json`.
fn catalogue_families() -> &'static HashMap<String, String> {
    static F: OnceLock<HashMap<String, String>> = OnceLock::new();
    F.get_or_init(|| {
        json::parse(crate::recommend::CATALOGUE_JSON)
            .ok()
            .and_then(|v| {
                v.get("models").and_then(Value::as_array).map(|models| {
                    models
                        .iter()
                        .filter_map(|m| {
                            Some((
                                m.get("key")?.as_str()?.to_string(),
                                m.get("family")?.as_str()?.to_string(),
                            ))
                        })
                        .collect()
                })
            })
            .unwrap_or_default()
    })
}

/// The family of a model of the catalogue, or of an imported one (its manifest's `family`).
pub fn model_family(models: &Store, key: &str) -> Option<String> {
    if let Some(f) = catalogue_families().get(key) {
        return Some(f.clone());
    }
    let known = models.known(key)?;
    let manifest = json::parse(known.manifest.as_deref()?).ok()?;
    manifest
        .get("family")
        .and_then(Value::as_str)
        .map(str::to_string)
}

/// What the runtime is asked to do in `POST /api/ai/run`.
#[derive(Clone, Debug, PartialEq)]
pub struct RunRequest {
    /// The model (`ai-models.json` key, or an imported one).
    pub model: String,
    /// The image, PNG in base64 (a `data:` URL too).
    pub image: String,
    /// A control image: its kind (`tile`, `depth`) and the PNG in base64.
    pub control: Option<(String, String)>,
    /// The prompt.
    pub prompt: String,
    /// The negative prompt.
    pub negative: String,
    /// img2img strength, more than 0 and at most 1.
    pub strength: f64,
    /// The seed.
    pub seed: u64,
    /// Sampling steps (the family's when absent).
    pub steps: Option<u32>,
    /// The size asked; it must be the image's.
    pub size: Option<(u32, u32)>,
    /// The backend the person forced (`VULKAN`, `CPU`).
    pub force: Option<String>,
    /// The person chose the CPU as the device (`ai.device`).
    pub cpu: bool,
}

/// Why a request is refused, with its HTTP answer.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Refusal {
    /// HTTP status.
    pub status: u16,
    /// Error code.
    pub code: &'static str,
    /// The `AiUnavailableReason` it means, if any.
    pub reason: Option<&'static str>,
    /// In words.
    pub message: String,
}

impl Refusal {
    fn bad(message: impl Into<String>) -> Refusal {
        Refusal {
            status: 400,
            code: "bad-body",
            reason: None,
            message: message.into(),
        }
    }

    fn unavailable(reason: &'static str, message: impl Into<String>) -> Refusal {
        Refusal {
            status: 409,
            code: "unavailable",
            reason: Some(reason),
            message: message.into(),
        }
    }

    /// As an HTTP response.
    pub fn response(&self) -> Response {
        Response::json(
            self.status,
            json::Object::new()
                .str("error", self.code)
                .opt_str("reason", self.reason)
                .str("message", &self.message)
                .build(),
        )
    }
}

impl RunRequest {
    /// Reads the JSON body of `POST /api/ai/run`.
    pub fn from_json(v: &Value) -> Result<RunRequest, Refusal> {
        let text = |k: &str| v.get(k).and_then(Value::as_str);
        let model = text("model")
            .filter(|k| valid_name(k))
            .ok_or_else(|| Refusal::bad("'model' must be a model key"))?;
        let image = text("image").ok_or_else(|| Refusal::bad("'image' must be a PNG in base64"))?;
        let control = match v.get("control") {
            None | Some(Value::Null) => None,
            Some(c) => {
                let kind = c
                    .get("kind")
                    .and_then(Value::as_str)
                    .filter(|k| valid_name(k));
                let img = c.get("image").and_then(Value::as_str);
                match (kind, img) {
                    (Some(k), Some(i)) => Some((k.to_string(), i.to_string())),
                    _ => return Err(Refusal::bad("'control' must be {kind, image}")),
                }
            }
        };
        let prompt = text("prompt").unwrap_or("");
        let negative = text("negative").unwrap_or("");
        if prompt.chars().count() > 8000 || negative.chars().count() > 8000 {
            return Err(Refusal::bad("prompts of at most 8000 characters"));
        }
        let strength = v
            .get("strength")
            .and_then(Value::as_f64)
            .filter(|s| *s > 0.0 && *s <= 1.0)
            .ok_or_else(|| Refusal::bad("'strength' must be more than 0 and at most 1"))?;
        let whole = |k: &str, max: f64| -> Result<Option<f64>, Refusal> {
            match v.get(k) {
                None | Some(Value::Null) => Ok(None),
                Some(n) => n
                    .as_f64()
                    .filter(|n| *n >= 0.0 && *n <= max && n.fract() == 0.0)
                    .map(Some)
                    .ok_or_else(|| {
                        Refusal::bad(format!("'{k}' must be a whole number up to {max}"))
                    }),
            }
        };
        let seed = whole("seed", 4_294_967_295.0)?.unwrap_or(0.0) as u64;
        let steps = whole("steps", 200.0)?
            .filter(|s| *s >= 1.0)
            .map(|s| s as u32);
        let size = match (
            whole("width", f64::from(MAX_SIDE))?,
            whole("height", f64::from(MAX_SIDE))?,
        ) {
            (Some(w), Some(h)) => Some((w as u32, h as u32)),
            (None, None) => None,
            _ => return Err(Refusal::bad("'width' and 'height' go together")),
        };
        Ok(RunRequest {
            model: model.to_string(),
            image: image.to_string(),
            control,
            prompt: prompt.to_string(),
            negative: negative.to_string(),
            strength,
            seed,
            steps,
            size,
            force: text("force").map(str::to_string),
            cpu: text("device") == Some("cpu"),
        })
    }
}

/// The size of a base64 PNG, checked to decode and to fit the runtime's rules.
fn image_size(b64_text: &str, what: &str) -> Result<(u32, u32), Refusal> {
    let bytes =
        b64::decode(b64_text).ok_or_else(|| Refusal::bad(format!("'{what}' is not base64")))?;
    let img = png::decode(&bytes, u64::from(MAX_SIDE) * u64::from(MAX_SIDE))
        .map_err(|e| Refusal::bad(format!("'{what}': {e}")))?;
    let (w, h) = (img.width, img.height);
    let fits = |s: u32| (MIN_SIDE..=MAX_SIDE).contains(&s) && s.is_multiple_of(SIDE_MULTIPLE);
    if !fits(w) || !fits(h) {
        return Err(Refusal {
            status: 400,
            code: "size",
            reason: None,
            message: format!(
                "'{what}' is {w}×{h}: sides from {MIN_SIDE} to {MAX_SIDE} pixels, multiples of {SIDE_MULTIPLE}"
            ),
        });
    }
    Ok((w, h))
}

/// The state of one run of `POST /api/ai/run`.
#[derive(Debug)]
struct RunState {
    version: u32,
    phase: &'static str,
    step: u32,
    steps: u32,
    started: Instant,
    ended: Option<Instant>,
    error: Option<SidecarError>,
    image: Option<Arc<Vec<u8>>>,
}

/// One run.
#[derive(Debug)]
pub struct Run {
    /// Its id.
    pub id: u32,
    model: String,
    runtime: String,
    width: u32,
    height: u32,
    cancel: AtomicBool,
    state: Mutex<RunState>,
    changed: Condvar,
}

impl Run {
    fn update(&self, p: Progress) {
        let mut s = lock(&self.state);
        let phase = p.stage.name();
        if (s.phase, s.step, s.steps) != (phase, p.step, p.steps) {
            s.phase = phase;
            s.step = p.step;
            s.steps = p.steps;
            s.version += 1;
            self.changed.notify_all();
        }
    }

    fn finish(&self, result: Result<Vec<u8>, SidecarError>) {
        let mut s = lock(&self.state);
        s.ended = Some(Instant::now());
        match result {
            Ok(png) => {
                s.phase = "DONE";
                s.step = s.steps;
                s.image = Some(Arc::new(png));
            }
            Err(SidecarError::Cancelled) => s.phase = "CANCELLED",
            Err(e) => {
                crate::log!("AI run {}: {}", self.id, e.message());
                s.phase = "FAILED";
                s.error = Some(e);
            }
        }
        s.version += 1;
        self.changed.notify_all();
    }

    fn finished(&self) -> bool {
        lock(&self.state).ended.is_some()
    }

    /// Waits up to `limit` for a state newer than `after`.
    fn wait_newer(&self, after: u32, limit: Duration) {
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

    /// The image of a finished run.
    pub fn image(&self) -> Option<Arc<Vec<u8>>> {
        lock(&self.state).image.clone()
    }

    /// `GET /api/ai/run/<id>`.
    pub fn to_json(&self) -> String {
        let s = lock(&self.state);
        let part = |k: u32, n: u32| {
            if n > 0 {
                f64::from(k) / f64::from(n)
            } else {
                0.0
            }
        };
        let fraction = match s.phase {
            "LOADING" => 0.1 * part(s.step, s.steps),
            "INFERENCE" => 0.1 + 0.85 * part(s.step, s.steps),
            "FINISHING" => 0.95,
            "DONE" => 1.0,
            _ => 0.0,
        };
        let seconds = s
            .ended
            .unwrap_or_else(Instant::now)
            .duration_since(s.started)
            .as_secs_f64();
        json::Object::new()
            .num("id", f64::from(self.id))
            .str("state", s.phase)
            .num("step", f64::from(s.step))
            .num("steps", f64::from(s.steps))
            .num("fraction", (fraction * 1000.0).round() / 1000.0)
            .num("seconds", (seconds * 1000.0).round() / 1000.0)
            .num("version", f64::from(s.version))
            .str("model", &self.model)
            .str("runtime", &self.runtime)
            .num("width", f64::from(self.width))
            .num("height", f64::from(self.height))
            .opt_str("error", s.error.as_ref().map(SidecarError::code))
            .opt_str(
                "message",
                s.error.as_ref().map(SidecarError::message).as_deref(),
            )
            .build()
    }
}

/// Everything AI the launcher holds.
pub struct Ai {
    /// `<data>/ai`.
    root: PathBuf,
    /// The installed builds.
    pub runtimes: Arc<Runtimes>,
    /// The running server.
    pub sidecar: Arc<Sidecar>,
    runs: Mutex<BTreeMap<u32, Arc<Run>>>,
    next_run: AtomicU32,
    stop: Arc<AtomicBool>,
    watchdog: Mutex<Option<JoinHandle<()>>>,
}

impl Ai {
    /// The AI of the data folder `data_dir`, with the embedded catalogue and the system's
    /// `curl`. A server a previous launch left running is stopped.
    ///
    /// Debug builds only (the tests, development): `<data>/ai/runtimes-override.json`, when it
    /// is there, replaces the embedded catalogue and may name `http://` addresses (a local test
    /// server). Release builds never read it.
    pub fn new(data_dir: &Path) -> Arc<Ai> {
        let root = data_dir.join("ai");
        #[cfg(debug_assertions)]
        if let Ok(text) = std::fs::read_to_string(root.join("runtimes-override.json")) {
            match catalogue::parse_runtimes_allowing_http(&text) {
                Ok(cat) => {
                    let d = Downloader {
                        allow_http: true,
                        ..Downloader::system()
                    };
                    return Ai::with(root, cat, d);
                }
                Err(e) => crate::log!("runtimes-override.json: {e}"),
            }
        }
        Ai::with(
            root,
            catalogue::runtime_catalogue().clone(),
            Downloader::system(),
        )
    }

    /// The same with another catalogue and downloader (tests: a fake runtime, a local server).
    pub fn with(root: PathBuf, cat: RuntimeCatalogue, downloader: Downloader) -> Arc<Ai> {
        Ai::with_runtimes(
            root.clone(),
            Runtimes::new(root.join("runtimes"), cat, downloader),
        )
    }

    /// The same with a store built by the caller.
    pub fn with_runtimes(root: PathBuf, runtimes: Runtimes) -> Arc<Ai> {
        let sidecar = Arc::new(Sidecar::new(root.join("sidecar.json")));
        sidecar.clean_stale(runtimes.root());
        let stop = Arc::new(AtomicBool::new(false));
        let ai = Arc::new(Ai {
            root,
            runtimes: Arc::new(runtimes),
            sidecar: Arc::clone(&sidecar),
            runs: Mutex::new(BTreeMap::new()),
            next_run: AtomicU32::new(1),
            stop: Arc::clone(&stop),
            watchdog: Mutex::new(None),
        });
        // Gives the memory back after a while without use.
        let handle = std::thread::Builder::new()
            .name("ai-idle".into())
            .spawn(move || {
                while !stop.load(Ordering::Acquire) {
                    std::thread::sleep(Duration::from_millis(250));
                    if sidecar.release_if_idle() {
                        crate::log!(
                            "AI runtime stopped after {} s unused",
                            sidecar.limits().idle.as_secs()
                        );
                    }
                }
            })
            .ok();
        *lock(&ai.watchdog) = handle;
        ai
    }

    /// `<data>/ai`.
    pub fn root(&self) -> &Path {
        &self.root
    }

    /// The application ends: the server is stopped, downloads too (their parts stay).
    pub fn shutdown(&self) {
        self.stop.store(true, Ordering::Release);
        for r in lock(&self.runs).values() {
            r.cancel.store(true, Ordering::Release);
        }
        self.sidecar.stop();
        self.runtimes.shutdown();
        if let Some(h) = lock(&self.watchdog).take() {
            let _ = h.join();
        }
    }

    /// The rule for this computer.
    pub fn choice(&self, gpu: Option<bool>, force: Option<&str>) -> Option<Choice> {
        choose(
            self.runtimes.catalogue(),
            Some(&ChoiceInput {
                os: std::env::consts::OS.into(),
                arch: std::env::consts::ARCH.into(),
                gpu,
                force: force.map(str::to_string),
            }),
        )
    }

    fn runtime_json(&self, key: &str) -> String {
        let cat = self.runtimes.catalogue();
        let Some(rt) = cat.runtime(key) else {
            return "null".into();
        };
        let state = self.runtimes.state(key).unwrap_or(State::Missing);
        let (name, done) = match &state {
            State::Missing => ("missing", 0),
            State::Paused { done } => ("paused", *done),
            State::Downloading { done } => ("downloading", *done),
            State::Verifying { done } => ("verifying", *done),
            State::Installing => ("installing", rt.bytes),
            State::Installed(_) => ("installed", rt.bytes),
        };
        let probe = matches!(state, State::Installed(_))
            .then(|| self.runtimes.probe(key))
            .flatten();
        let strings = |v: &[String]| json::array(v.iter().map(|s| json::string(s)));
        json::Object::new()
            .str("key", &rt.key)
            .str("os", &rt.os)
            .str("arch", &rt.arch)
            .str("backend", rt.backend.name())
            .bool("here", Runtimes::is_here(rt))
            .str("name", &rt.name)
            .str("url", &rt.url)
            .str("sha256", &rt.sha256)
            .num("bytes", rt.bytes as f64)
            .str("state", name)
            .num("done", done as f64)
            .num("total", rt.bytes as f64)
            .opt_str("error", self.runtimes.error(key).as_deref())
            .opt_str("version", probe.as_ref().and_then(|p| p.version.as_deref()))
            .raw(
                "devices",
                &json::array(probe.iter().flat_map(|p| p.devices.iter()).map(|d| {
                    json::Object::new()
                        .str("name", &d.name)
                        .str("description", &d.description)
                        .build()
                })),
            )
            .opt_str(
                "probeError",
                probe.as_ref().and_then(|p| p.error.as_deref()),
            )
            .raw("supports", &strings(&rt.supports))
            .raw("verified", &strings(&rt.verified))
            .build()
    }

    /// `GET /api/ai/runtime`: an `AiRuntimeStatus` (`src/core/ai.ts`) and what the Settings row
    /// shows. `gpu`: the hardware report has a GPU to use; `model`: the active model.
    pub fn status_json(
        &self,
        models: &Store,
        gpu: Option<bool>,
        force: Option<&str>,
        model: Option<&str>,
    ) -> String {
        let cat = self.runtimes.catalogue();
        let choice = self.choice(gpu, force);
        let key = choice.as_ref().and_then(|c| c.key.clone());
        let installed = key.as_deref().and_then(|k| self.runtimes.installed(k));
        let probe = key
            .as_deref()
            .filter(|_| installed.is_some())
            .and_then(|k| self.runtimes.probe(k));
        let rt = key.as_deref().and_then(|k| cat.runtime(k));
        let (mut backend, mut device) = (choice.as_ref().map(|c| c.backend.name()), None::<String>);
        if let Some((b, d)) = probe.as_ref().and_then(|p| p.device()) {
            backend = Some(b.name());
            device = Some(d.description.clone());
        }
        let supports: Vec<String> = if installed.is_some() {
            rt.map(|r| r.supports.clone()).unwrap_or_default()
        } else {
            Vec::new()
        };
        let model = model.filter(|m| valid_name(m));
        let (reason, detail): (Option<&str>, Option<String>) = if choice.is_none() {
            (Some("NO_RUNTIME"), Some("no such backend".into()))
        } else if key.is_none() {
            (
                Some("NO_RUNTIME"),
                Some(format!(
                    "no pinned build for {} {}",
                    std::env::consts::OS,
                    std::env::consts::ARCH
                )),
            )
        } else if installed.is_none() {
            (
                Some("NO_RUNTIME"),
                Some("the runtime is not installed".into()),
            )
        } else if let Some(e) = probe.as_ref().and_then(|p| p.error.clone()) {
            (Some("NO_RUNTIME"), Some(e))
        } else if let Some(m) = model {
            match self.model_problem(models, m, rt.map(|r| r.supports.as_slice()).unwrap_or(&[])) {
                Some(r) => (r.reason, Some(r.message)),
                None => (None, None),
            }
        } else {
            (Some("NO_MODEL"), Some("no model is active".into()))
        };
        let choice_json = choice.as_ref().map_or_else(
            || "null".to_string(),
            |c| {
                json::Object::new()
                    .str("rowId", &c.row_id)
                    .str("backend", c.backend.name())
                    .opt_str("key", c.key.as_deref())
                    .build()
            },
        );
        let info = self.sidecar.info();
        json::Object::new()
            .bool("available", reason.is_none())
            .opt_str("reason", reason)
            .opt_str("backend", backend)
            .opt_str("device", device.as_deref())
            .raw(
                "supports",
                &json::array(supports.iter().map(|s| json::string(s))),
            )
            .opt_str("activeModel", model)
            .opt_str("detail", detail.as_deref())
            .raw("choice", &choice_json)
            .raw(
                "release",
                &json::Object::new()
                    .str("tag", &cat.release.tag)
                    .str("commit", &cat.release.commit)
                    .build(),
            )
            .raw(
                "platform",
                &json::Object::new()
                    .str("os", std::env::consts::OS)
                    .str("arch", std::env::consts::ARCH)
                    .build(),
            )
            .bool("gpu", gpu == Some(true))
            .opt_str("force", force)
            .raw(
                "runtime",
                &key.as_deref()
                    .map_or_else(|| "null".into(), |k| self.runtime_json(k)),
            )
            .raw(
                "runtimes",
                &json::array(cat.runtimes.iter().map(|r| self.runtime_json(&r.key))),
            )
            .raw(
                "sidecar",
                &json::Object::new()
                    .str("state", info.state)
                    .opt_str("label", info.label.as_deref())
                    .opt_num("pid", info.pid.map(f64::from))
                    .num("idleSeconds", info.idle_seconds as f64)
                    .build(),
            )
            .bool("downloader", self.runtimes.downloader().program.is_some())
            .build()
    }

    /// Why `model` cannot run on a runtime that supports `supports`, or `None`.
    fn model_problem(&self, models: &Store, model: &str, supports: &[String]) -> Option<Refusal> {
        let Some(known) = models.known(model) else {
            return Some(Refusal::unavailable(
                "NO_MODEL",
                format!("{model} is not a known model"),
            ));
        };
        let family = model_family(models, model);
        let supported = if known.source == "catalogue" {
            supports.iter().any(|k| k == model)
        } else {
            family
                .as_deref()
                .and_then(|f| self.runtimes.catalogue().profile(f))
                .is_some()
        };
        if !supported {
            return Some(Refusal::unavailable(
                "MODEL_UNSUPPORTED",
                format!("{model} is not one this runtime loads"),
            ));
        }
        let missing: Vec<&str> = known
            .files
            .iter()
            .filter(|f| models.complete_path(&f.sha256).is_err())
            .map(|f| f.name.as_str())
            .collect();
        if !missing.is_empty() {
            return Some(Refusal::unavailable(
                "NO_MODEL",
                format!("{model} is not downloaded: {}", missing.join(", ")),
            ));
        }
        None
    }

    /// Checks a request and turns it into what the server is started with and what it is asked.
    pub fn prepare(
        &self,
        models: &Store,
        req: &RunRequest,
        gpu: Option<bool>,
    ) -> Result<(Spec, Job, String), Refusal> {
        let cat = self.runtimes.catalogue();
        let choice = self
            .choice(gpu, req.force.as_deref())
            .ok_or_else(|| Refusal::bad("'force' must be VULKAN or CPU"))?;
        let key = choice.key.clone().ok_or_else(|| {
            Refusal::unavailable("NO_RUNTIME", "no pinned runtime build for this system")
        })?;
        let installed = self
            .runtimes
            .installed(&key)
            .ok_or_else(|| Refusal::unavailable("NO_RUNTIME", format!("{key} is not installed")))?;
        let rt = cat
            .runtime(&key)
            .ok_or_else(|| Refusal::bad("unknown runtime"))?;
        if let Some(r) = self.model_problem(models, &req.model, &rt.supports) {
            return Err(r);
        }
        let family = model_family(models, &req.model)
            .ok_or_else(|| Refusal::unavailable("MODEL_UNSUPPORTED", "the model has no family"))?;
        let profile = cat.profile(&family).ok_or_else(|| {
            Refusal::unavailable(
                "MODEL_UNSUPPORTED",
                format!("no way to run the {family} family"),
            )
        })?;
        let known = models
            .known(&req.model)
            .ok_or_else(|| Refusal::unavailable("NO_MODEL", "unknown model"))?;
        let files: Vec<(ModelFile, PathBuf)> = known
            .files
            .iter()
            .filter_map(|f| models.complete_path(&f.sha256).ok().map(|p| (f.clone(), p)))
            .collect();
        let unsupported = |e: String| Refusal::unavailable("MODEL_UNSUPPORTED", e);
        let mut args = resolve_args(&profile.load, &files).map_err(unsupported)?;
        let mut label = format!("{key}/{}", req.model);
        let (w, h) = image_size(&req.image, "image")?;
        if req.size.is_some_and(|s| s != (w, h)) {
            return Err(Refusal {
                status: 400,
                code: "size",
                reason: None,
                message: format!("the image is {w}×{h}, not the size asked"),
            });
        }
        let control = match &req.control {
            None => None,
            Some((kind, img)) => {
                let c = profile.control(kind).ok_or_else(|| Refusal {
                    status: 409,
                    code: "control-unsupported",
                    reason: None,
                    message: format!("{} takes no {kind} control image", req.model),
                })?;
                if image_size(img, "control.image")? != (w, h) {
                    return Err(Refusal::bad(
                        "the control image is not the size of the image",
                    ));
                }
                args.extend(resolve_args(&c.load, &files).map_err(unsupported)?);
                label.push_str(&format!("+{kind}"));
                Some((img.clone(), c.strength))
            }
        };
        let spec = Spec {
            server: installed.server.clone(),
            dir: installed.dir.clone(),
            args,
            label,
        };
        let job = Job {
            prompt: req.prompt.clone(),
            negative: req.negative.clone(),
            width: w,
            height: h,
            strength: req.strength,
            seed: req.seed,
            steps: req.steps.unwrap_or(profile.steps),
            cfg_scale: profile.cfg_scale,
            sampler: profile.sampler.clone(),
            flow_shift: profile.flow_shift,
            image_b64: req.image.clone(),
            as_reference: profile.image == ImageMode::InitRef,
            control,
        };
        Ok((spec, job, key))
    }

    /// One inference, blocking (what the pipeline of X3c calls between the guard's steps).
    pub fn infer(
        &self,
        spec: &Spec,
        job: &Job,
        cancel: &AtomicBool,
        progress: &mut dyn FnMut(Progress),
    ) -> Result<Vec<u8>, SidecarError> {
        self.sidecar.run(spec, job, cancel, progress)
    }

    /// Queues one inference and returns its run (`POST /api/ai/run`).
    pub fn submit(
        &self,
        spec: Spec,
        job: Job,
        runtime: String,
        model: String,
    ) -> Result<Arc<Run>, Refusal> {
        let mut runs = lock(&self.runs);
        if runs.values().filter(|r| !r.finished()).count() >= MAX_PENDING {
            return Err(Refusal {
                status: 503,
                code: "busy",
                reason: None,
                message: format!("{MAX_PENDING} runs are already waiting"),
            });
        }
        // Old finished runs go: the last KEEP_FINISHED, and none older than ten minutes.
        let finished: Vec<u32> = runs
            .iter()
            .filter(|(_, r)| r.finished())
            .map(|(id, _)| *id)
            .collect();
        let too_old = |r: &Run| {
            lock(&r.state)
                .ended
                .is_some_and(|e| e.elapsed() > Duration::from_secs(600))
        };
        let excess = finished.len().saturating_sub(KEEP_FINISHED);
        for (i, id) in finished.iter().enumerate() {
            if i < excess || runs.get(id).is_some_and(|r| too_old(r)) {
                runs.remove(id);
            }
        }
        let id = self.next_run.fetch_add(1, Ordering::Relaxed);
        let run = Arc::new(Run {
            id,
            model,
            runtime,
            width: job.width,
            height: job.height,
            cancel: AtomicBool::new(false),
            state: Mutex::new(RunState {
                version: 1,
                phase: "QUEUED",
                step: 0,
                steps: 0,
                started: Instant::now(),
                ended: None,
                error: None,
                image: None,
            }),
            changed: Condvar::new(),
        });
        runs.insert(id, Arc::clone(&run));
        drop(runs);
        let sidecar = Arc::clone(&self.sidecar);
        let r = Arc::clone(&run);
        std::thread::Builder::new()
            .name("ai-run".into())
            .spawn(move || {
                let result = sidecar.run(&spec, &job, &r.cancel, &mut |p| r.update(p));
                r.finish(result);
            })
            .map_err(|e| Refusal {
                status: 500,
                code: "thread",
                reason: None,
                message: e.to_string(),
            })?;
        Ok(run)
    }

    /// A run by id.
    pub fn run(&self, id: u32) -> Option<Arc<Run>> {
        lock(&self.runs).get(&id).cloned()
    }
}

fn read_json(req: &Request, body: &mut dyn Read, limit: u64) -> Result<Value, Response> {
    if req.content_length > limit {
        return Err(Response::error(413, "too-large", "body too large"));
    }
    let mut text = String::with_capacity(req.content_length as usize);
    body.read_to_string(&mut text)
        .map_err(|_| Response::error(400, "bad-body", "the body is not UTF-8 text"))?;
    json::parse(&text).map_err(|e| Response::error(400, "bad-json", &e.to_string()))
}

fn runtime_error(e: runtimes::RuntimeError) -> Response {
    match e {
        runtimes::RuntimeError::UnknownKey => {
            Response::error(404, "unknown-key", "no such runtime")
        }
        runtimes::RuntimeError::OtherSystem => {
            Response::error(409, "other-system", "a build for another system")
        }
        runtimes::RuntimeError::Busy => Response::error(409, "busy", "the runtime is busy"),
        runtimes::RuntimeError::Io(m) => Response::error(500, "io", &m),
    }
}

/// Whether the hardware report has a GPU to use, honouring `device=cpu` (the person chose the
/// CPU in *Settings*): the launcher's own assessment (a GPU with at least 4 effective GiB).
fn gpu_of(app: &App, cpu: bool) -> Option<bool> {
    if cpu {
        return Some(false);
    }
    let hw = app.hardware(false);
    let a = crate::hardware::assess(&hw, None, crate::recommend::catalogue());
    Some(a.device == crate::hardware::Device::Gpu)
}

/// The `/api/ai/*` endpoints (the contract is in this crate's `README.md`).
pub fn route(app: &App, req: &Request, parts: &[&str], body: &mut dyn Read) -> Option<Response> {
    let ai = &app.ai;
    let m = req.method.as_str();
    let rest = match parts {
        ["ai", rest @ ..] => rest,
        _ => return None,
    };
    let entry = |key: &str| Response::json(200, ai.runtime_json(key));
    Some(match (m, rest) {
        ("GET", ["runtime"]) => {
            let gpu = gpu_of(app, req.query("device") == Some("cpu"));
            Response::json(
                200,
                ai.status_json(&app.models, gpu, req.query("force"), req.query("model")),
            )
        }
        ("GET", ["runtimes", key]) => match ai.runtimes.catalogue().runtime(key) {
            Some(_) => entry(key),
            None => Response::error(404, "unknown-key", "no such runtime"),
        },
        ("POST", ["runtimes", key, "download"]) => match ai.runtimes.start(key, Source::Download) {
            Ok(()) => Response::json(202, ai.runtime_json(key)),
            Err(e) => runtime_error(e),
        },
        ("POST", ["runtimes", key, "import"]) => {
            let v = match read_json(req, body, crate::server::MAX_JSON) {
                Ok(v) => v,
                Err(r) => return Some(r),
            };
            let Some(id) = v.get("file").and_then(Value::as_str) else {
                return Some(Response::error(
                    400,
                    "bad-body",
                    "expected {\"file\": <grant id>}",
                ));
            };
            match app.files.readable(id) {
                Ok(g) => match ai.runtimes.start(key, Source::File(g.path)) {
                    Ok(()) => Response::json(202, ai.runtime_json(key)),
                    Err(e) => runtime_error(e),
                },
                Err(e) => crate::files::file_error(e),
            }
        }
        ("POST", ["runtimes", key, "pause"]) => match ai.runtimes.pause(key) {
            Ok(()) => entry(key),
            Err(e) => runtime_error(e),
        },
        ("POST", ["runtimes", key, "probe"]) => match ai.runtimes.catalogue().runtime(key) {
            Some(_) => {
                ai.runtimes.reprobe(key);
                entry(key)
            }
            None => Response::error(404, "unknown-key", "no such runtime"),
        },
        ("DELETE", ["runtimes", key]) => {
            // A runtime in use is stopped first.
            if ai
                .sidecar
                .info()
                .label
                .is_some_and(|l| l.starts_with(&format!("{key}/")))
            {
                ai.sidecar.stop();
            }
            match ai.runtimes.remove(key) {
                Ok(()) => Response::empty(204),
                Err(e) => runtime_error(e),
            }
        }
        ("POST", ["run"]) => {
            let v = match read_json(req, body, MAX_RUN_BODY) {
                Ok(v) => v,
                Err(r) => return Some(r),
            };
            let r = match RunRequest::from_json(&v) {
                Ok(r) => r,
                Err(e) => return Some(e.response()),
            };
            let gpu = gpu_of(app, r.cpu);
            match ai
                .prepare(&app.models, &r, gpu)
                .and_then(|(spec, job, key)| ai.submit(spec, job, key, r.model.clone()))
            {
                Ok(run) => Response::json(202, run.to_json()),
                Err(e) => e.response(),
            }
        }
        ("GET", ["run", id]) => match id.parse().ok().and_then(|id| ai.run(id)) {
            Some(run) => {
                if let Some(after) = req.query("after").and_then(|a| a.parse::<u32>().ok()) {
                    run.wait_newer(after, crate::server::LONG_POLL);
                }
                Response::json(200, run.to_json())
            }
            None => Response::error(404, "not-found", "no such run"),
        },
        ("GET", ["run", id, "image"]) => match id.parse().ok().and_then(|id| ai.run(id)) {
            Some(run) => match run.image() {
                Some(png) => {
                    let len = png.len() as u64;
                    Response {
                        status: 200,
                        headers: vec![("Content-Type".into(), "image/png".into())],
                        body: Body::Stream {
                            len,
                            write: Box::new(move |w| w.write_all(&png)),
                        },
                    }
                }
                None => Response::error(409, "not-done", "the run has no image"),
            },
            None => Response::error(404, "not-found", "no such run"),
        },
        ("DELETE", ["run", id]) => match id.parse().ok().and_then(|id| ai.run(id)) {
            Some(run) => {
                if run.finished() {
                    lock(&ai.runs).remove(&run.id);
                } else {
                    run.cancel.store(true, Ordering::Release);
                }
                Response::empty(204)
            }
            None => Response::error(404, "not-found", "no such run"),
        },
        ("DELETE", ["sidecar"]) => {
            if ai.sidecar.release() {
                Response::empty(204)
            } else {
                Response::error(409, "busy", "a run is using the runtime")
            }
        }
        (_, ["runtime" | "runtimes" | "run" | "sidecar", ..]) => {
            Response::error(405, "method", "method not allowed")
        }
        _ => Response::error(404, "not-found", "no such endpoint"),
    })
}
