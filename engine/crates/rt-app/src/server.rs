//! The local server: the interface's files and the API, on `127.0.0.1` only.
//!
//! **Security model.** The server is reachable only from this computer, but any web page the
//! user opens could try to talk to it. So:
//!
//! * every request must carry `Host: 127.0.0.1:<port>` or `localhost:<port>`: a page of another
//!   site whose name was rebound to 127.0.0.1 (DNS rebinding) sends its own host name and is
//!   refused (421);
//! * every `/api/*` request must carry `X-Repackshot-Token` with this launch's random 128-bit
//!   token (401 otherwise); a custom header cannot be sent cross-origin without a CORS preflight,
//!   which this server never grants (it sends no CORS header at all);
//! * an `/api/*` request with an `Origin` that is not the app's own is refused (403);
//! * the token reaches the page only in the window URL's fragment, which browsers never send to
//!   a server nor put in `Referer`; the page keeps it in `sessionStorage`.
//!
//! One thread per connection (at most [`MAX_CONNECTIONS`]), keep-alive, `Content-Length` bodies.

use crate::hardware::{self, Device, Hardware};
use crate::http::{read_request, write_response, Body, ReadError, Request, Response};
use crate::json::{self, Value};
use crate::models::{Store, StoreError};
use crate::paths::Paths;
use crate::render::{
    has_meshes, parse_fit, Engine, Finish, Kind, Options as JobOptions, SubmitError,
};
use crate::static_files;
use std::io::{self, BufReader, BufWriter, Read, Write};
use std::net::{Shutdown, TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant};

/// Connections served at once.
pub const MAX_CONNECTIONS: usize = 64;
/// Largest RSB accepted by `/api/lens/info` (the page sends the camera without the meshes).
pub const MAX_LENS_RSB: u64 = 16 << 20;
/// Largest RSB accepted by `/api/render`.
pub const MAX_RSB: u64 = 2 << 30;
/// Largest JSON body.
pub const MAX_JSON: u64 = 1 << 20;
/// How long an idle keep-alive connection stays open.
pub const IDLE: Duration = Duration::from_secs(30);
/// Longest wait of `GET /api/render/<id>?after=<n>`.
pub const LONG_POLL: Duration = Duration::from_secs(1);
/// How long a write of a long-polled render frame may block: a page that stopped reading one (it
/// went on to a newer view) frees the connection and its thread instead of holding them for
/// minutes.
pub const FRAME_WRITE_TIMEOUT: Duration = Duration::from_secs(10);
/// How long any other write may block.
pub const WRITE_TIMEOUT: Duration = Duration::from_secs(120);

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(PoisonError::into_inner)
}

/// The version of the application (`package.json`).
pub fn app_version() -> String {
    json::parse(include_str!("../../../../package.json"))
        .ok()
        .and_then(|v| v.get("version").and_then(Value::as_str).map(str::to_string))
        .unwrap_or_else(|| env!("CARGO_PKG_VERSION").to_string())
}

/// The engine version, `major.minor.patch`.
pub fn engine_version() -> String {
    let v = rt_core::VERSION;
    format!("{}.{}.{}", v >> 16, (v >> 8) & 0xff, v & 0xff)
}

/// Everything the handlers share.
pub struct App {
    /// The folders.
    pub paths: Paths,
    /// This launch's token.
    pub token: String,
    /// The port, once bound.
    pub port: u16,
    /// The renderer.
    pub engine: Engine,
    /// The model store.
    pub models: Store,
    /// The browser drawing the window (for `/api/info`).
    pub browser: Mutex<Option<String>>,
    /// The system's dialogs (`/api/dialog/*`).
    pub dialogs: crate::dialogs::Dialogs,
    /// What the person chose in them (`/api/files*`).
    pub files: crate::files::Files,
    /// The AI runtime, its downloads and its server (`/api/ai/*`, `src/ai/`).
    pub ai: Arc<crate::ai::Ai>,
    /// Updating the application from inside it (`/api/update/*`, `src/update/`).
    pub update: Arc<crate::update::Updater>,
    /// A project file passed on the command line, for `/api/startup-project` (None: no file was passed).
    pub open_file: Option<std::path::PathBuf>,
    last_alive: Mutex<Instant>,
    hardware: Mutex<Option<Hardware>>,
    connections: AtomicUsize,
    stopping: AtomicBool,
    /// [`FRAME_WRITE_TIMEOUT`], in milliseconds (tests shorten it).
    pub frame_write_timeout_ms: AtomicU64,
}

impl App {
    /// Connections being served now.
    pub fn connections(&self) -> usize {
        self.connections.load(Ordering::Acquire)
    }

    /// The page's heartbeat arrived.
    pub fn alive(&self) {
        *lock(&self.last_alive) = Instant::now();
    }

    /// Time since the last heartbeat.
    pub fn silence(&self) -> Duration {
        lock(&self.last_alive).elapsed()
    }

    /// The window URL, with the token in the fragment.
    pub fn url(&self) -> String {
        format!("http://127.0.0.1:{}/#token={}", self.port, self.token)
    }

    pub(crate) fn hardware(&self, refresh: bool) -> Hardware {
        let mut cached = lock(&self.hardware);
        if refresh || cached.is_none() {
            *cached = Some(hardware::detect());
        }
        cached.clone().unwrap_or_default()
    }

    /// Refuses a request from a foreign host, origin or without the token.
    pub fn check(&self, req: &Request) -> Result<(), Response> {
        let host = req.header("host").unwrap_or("");
        let ok_host = [
            format!("127.0.0.1:{}", self.port),
            format!("localhost:{}", self.port),
        ];
        if !ok_host.iter().any(|h| h.eq_ignore_ascii_case(host)) {
            return Err(Response::text(
                421,
                "this server answers only to its own address",
            ));
        }
        if req.path.starts_with("/api/") || req.path == "/api" {
            if let Some(origin) = req.header("origin") {
                let own = ok_host.iter().any(|h| {
                    origin
                        .strip_prefix("http://")
                        .is_some_and(|o| o.eq_ignore_ascii_case(h))
                });
                if !own {
                    return Err(Response::error(403, "origin", "foreign origin"));
                }
            }
            let token = req.header("x-repackshot-token").unwrap_or("");
            if !crate::token::equals(token, &self.token) {
                return Err(Response::error(401, "token", "missing or wrong token"));
            }
        }
        Ok(())
    }

    /// Answers a request that passed [`App::check`]. `body` holds exactly the request body.
    pub fn route(&self, req: &Request, body: &mut dyn Read) -> Response {
        let api = |r: Response| r.with("Cache-Control", "no-store");
        let Some(rest) = req.path.strip_prefix("/api/") else {
            return match req.method.as_str() {
                "GET" | "HEAD" => static_files::serve(&self.paths.app_dir, req),
                _ => Response::text(405, "method not allowed").with("Allow", "GET, HEAD"),
            };
        };
        let parts: Vec<&str> = rest.split('/').collect();
        if parts
            .iter()
            .any(|p| p.is_empty() || *p == "." || *p == "..")
        {
            return api(Response::error(400, "bad-path", "empty, . or .. segment"));
        }
        // Dialogs and the files chosen in them (files.rs).
        if let Some(r) = crate::files::route(self, req, &parts, body) {
            return api(r);
        }
        // The page's state in the data folder (appdata.rs, phase P3e): /api/store/*, /api/storage/*.
        if let Some(r) = crate::appdata::route(&self.paths, req, &parts, body) {
            return api(r);
        }
        // The AI runtime (ai/mod.rs).
        if let Some(r) = crate::ai::route(self, req, &parts, body) {
            return api(r);
        }
        // Updating the application (update/mod.rs).
        if let Some(r) = crate::update::route(&self.update, req, &parts, body) {
            return api(r);
        }
        let m = req.method.as_str();
        api(match (m, parts.as_slice()) {
            ("GET", ["info"]) => self.info(),
            ("GET", ["startup-project"]) => self.get_startup_project(),
            ("POST", ["alive"]) => {
                self.alive();
                Response::empty(204)
            }
            ("GET", ["hardware"]) => {
                let device = req.query("device").and_then(Device::parse);
                let hw = self.hardware(req.query("refresh") == Some("1"));
                let a = hardware::assess(&hw, device, crate::recommend::catalogue());
                Response::json(200, hardware::to_json(&hw, &a))
            }
            ("POST", ["render"]) => self.post_render(req, body),
            ("POST", ["lens", "info"]) => self.post_lens_info(req, body),
            ("GET", ["render", "state"]) => self.render_state(req),
            ("GET", ["render", id]) => self.get_render(req, id),
            ("GET", ["render", id, "passes"]) => self.get_passes(id),
            ("POST", ["render", id, "denoise"]) => self.post_live_denoise(req, id),
            ("DELETE", ["render", id]) => match id.parse::<u32>() {
                Ok(id) if self.engine.cancel(id) => Response::empty(204),
                _ => Response::error(404, "not-found", "no such job"),
            },
            ("GET", ["models"]) => Response::json(200, self.models.list_json()),
            ("POST", ["models", "installed"]) => match read_json(req, body) {
                Ok(v) => match v.get("key").and_then(Value::as_str) {
                    Some(key) => match self.models.install(key) {
                        Ok(keys) => Response::json(
                            200,
                            json::Object::new()
                                .raw(
                                    "installed",
                                    &json::array(keys.iter().map(|k| json::string(k))),
                                )
                                .build(),
                        ),
                        Err(e) => store_error(e, None),
                    },
                    None => Response::error(400, "bad-body", "expected {\"key\": ...}"),
                },
                Err(r) => r,
            },
            ("PUT", ["models", "imported", key]) => match read_text(req, body, MAX_JSON) {
                Ok(text) => match self.models.put_imported(key, &text) {
                    Ok(()) => Response::empty(204),
                    Err(e) => store_error(e, None),
                },
                Err(r) => r,
            },
            ("GET", ["models", "imported", key]) => match self.models.known(key) {
                Some(k) if k.source == "imported" => {
                    Response::json(200, k.manifest.unwrap_or_default())
                }
                _ => Response::error(404, "not-found", "no such imported model"),
            },
            ("PUT", ["models", "blobs", sha]) => self.put_blob(req, sha, body),
            ("GET" | "HEAD", ["models", "blobs", sha]) => match self.models.complete_path(sha) {
                Ok(path) => {
                    static_files::file_response(&path, req, "application/octet-stream", "no-store")
                }
                Err(e) => store_error(e, Some(sha)),
            },
            ("DELETE", ["models", "blobs", sha]) => match self.models.delete_blob(sha) {
                Ok(()) => Response::empty(204),
                Err(e) => store_error(e, Some(sha)),
            },
            ("GET", ["models", "blobs", sha, "status"]) => match self.models.blob_json(sha) {
                Ok(j) => Response::json(200, j),
                Err(e) => store_error(e, Some(sha)),
            },
            ("POST", ["models", "blobs", sha, "finish"]) => {
                let expected = match req.query("bytes").map(str::parse::<u64>) {
                    None => None,
                    Some(Ok(n)) => Some(n),
                    Some(Err(_)) => return api(Response::error(400, "bad-query", "bytes")),
                };
                match self.models.finish(sha, expected) {
                    Ok(len) => Response::json(
                        200,
                        json::Object::new()
                            .str("sha256", sha)
                            .str("state", "complete")
                            .num("bytes", len as f64)
                            .build(),
                    ),
                    Err(e) => store_error(e, Some(sha)),
                }
            }
            ("DELETE", ["models", key]) => {
                let keep: Vec<String> = req
                    .query("keep")
                    .unwrap_or("")
                    .split(',')
                    .filter(|k| !k.is_empty())
                    .map(str::to_string)
                    .collect();
                match self.models.remove(key, &keep) {
                    Ok(deleted) => Response::json(
                        200,
                        json::Object::new()
                            .raw(
                                "deleted",
                                &json::array(deleted.iter().map(|s| json::string(s))),
                            )
                            .build(),
                    ),
                    Err(e) => store_error(e, None),
                }
            }
            ("GET", ["pending-models"]) => Response::json(
                200,
                crate::models::read_pending(&self.paths.pending_models())
                    .unwrap_or_else(|| "null".into()),
            ),
            ("DELETE", ["pending-models"]) => {
                match std::fs::remove_file(self.paths.pending_models()) {
                    Err(e) if e.kind() != io::ErrorKind::NotFound => io_error(&e),
                    _ => Response::empty(204),
                }
            }
            ("POST", ["open-folder"]) => self.open_folder(req, body),
            (
                _,
                ["info" | "alive" | "hardware" | "render" | "models" | "pending-models"
                | "open-folder", ..],
            ) => Response::error(405, "method", "method not allowed"),
            _ => Response::error(404, "not-found", "no such endpoint"),
        })
    }

    /// `GET /api/startup-project`: the project file passed on the command line, for the page to open at
    /// startup (a double-click in the file manager). Only ever that one file: the path comes from the
    /// command line, never from the request. 404 when no file was passed, or it cannot be read. The
    /// file name rides in `X-Repackshot-File-Name`, percent-encoded (a header cannot carry UTF-8).
    fn get_startup_project(&self) -> Response {
        let Some(path) = &self.open_file else {
            return Response::error(404, "not-found", "no project file was passed");
        };
        let Ok(bytes) = std::fs::read(path) else {
            return Response::error(404, "not-found", "the project file cannot be read");
        };
        let name = path.file_name().map(|n| n.to_string_lossy()).unwrap_or_default();
        let mut encoded = String::with_capacity(name.len());
        for b in name.as_bytes() {
            match b {
                b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' => encoded.push(*b as char),
                _ => encoded.push_str(&format!("%{b:02X}")),
            }
        }
        Response::bytes(200, "application/json", bytes).with("X-Repackshot-File-Name", &encoded)
    }

    fn info(&self) -> Response {
        let simd = rt_core::simd::Isa::available()
            .into_iter()
            .map(|i| json::string(i.name()));
        let p = &self.paths;
        Response::json(
            200,
            json::Object::new()
                .str("app", "repackshot")
                .str("version", &app_version())
                .str("engineVersion", &engine_version())
                // What the engine reads beyond the plain RSB (rt_core::FEATURES; bit 0, M2b:
                // the texture data; bit 1, M3b: the material programs; bit 2, Q1: the section
                // view; bit 3, L5: IES lights; bit 4, K3: the interior cameras; bit 5, M3c: the
                // pattern nodes of a program; bit 6, S3: the drops and the front glass; bit 7,
                // S3b: the front glass laid out drop by drop).
                .num("features", f64::from(rt_core::FEATURES))
                .num("threads", self.engine.threads() as f64)
                .str("isa", self.engine.isa().name())
                .raw("simd", &json::array(simd))
                .str("os", std::env::consts::OS)
                .str("arch", std::env::consts::ARCH)
                .str("dataDir", &p.data_dir.to_string_lossy())
                .str("modelsDir", &p.models().to_string_lossy())
                .str("logsDir", &p.logs().to_string_lossy())
                .str("resultsDir", &p.results().to_string_lossy())
                .bool("portable", p.portable)
                .opt_str("browser", lock(&self.browser).as_deref())
                .raw("window", &crate::platform::report_json())
                .num("pid", f64::from(std::process::id()))
                // The dialogs and file API of files.rs (version 1).
                .num("filesApi", 1.0)
                // The AI runtime API of ai/mod.rs (version 1).
                .num("aiApi", 1.0)
                // The AI post-processing pipeline of ai/post.rs (`/api/ai/post`, version 1).
                .num("aiPost", 1.0)
                // X7: a remote API in place of the local runtime, and its keys (`/api/ai/apikeys`).
                .num("aiRemote", 1.0)
                // Updating from inside the application (`/api/update/*`, version 1), and whether this
                // launcher was started by an update (`--after-update`).
                .num("updateApi", 1.0)
                .bool("afterUpdate", self.update.after_update())
                .build(),
        )
    }

    /// `POST /api/lens/info` (O2): the RSB of a scene in the body (the camera and its `LENS` are
    /// what counts); the engine's numbers of its traced lens as JSON
    /// ([`rt_core::scene::Camera::lens_info_json`], `{"traced":false}` for the thin lens), the
    /// same as `rt_wasm` gives the page.
    fn post_lens_info(&self, req: &Request, body: &mut dyn Read) -> Response {
        if req.content_length > MAX_LENS_RSB {
            return Response::error(413, "too-large", "scene too large");
        }
        let mut rsb = Vec::with_capacity(req.content_length as usize);
        if body.read_to_end(&mut rsb).is_err() || rsb.len() as u64 != req.content_length {
            return Response::error(400, "bad-body", "short body");
        }
        match rt_core::scene::Scene::from_rsb(&rsb) {
            Ok(scene) => Response::json(200, scene.camera.lens_info_json()),
            Err(e) => Response::error(400, "bad-scene", &e.to_string()),
        }
    }

    fn post_render(&self, req: &Request, body: &mut dyn Read) -> Response {
        let Some(kind) = req.query("kind").and_then(Kind::parse) else {
            return Response::error(400, "bad-query", "kind=viewport|final");
        };
        if req.content_length > MAX_RSB {
            return Response::error(413, "too-large", "scene too large");
        }
        let mut rsb = Vec::with_capacity(req.content_length as usize);
        if body.read_to_end(&mut rsb).is_err() || rsb.len() as u64 != req.content_length {
            return Response::error(400, "bad-body", "short body");
        }
        let finish = match req.query("finish") {
            None => None,
            Some(f) => match Finish::parse(f) {
                Some(f) => Some(f),
                None => return Response::error(400, "bad-query", "finish=samples|time|first"),
            },
        };
        // The exact passes a final job keeps for the AI post-processing (X2): `passes=albedo,depth`.
        let passes = match rt_core::passes::mask_of_keys(req.query("passes").unwrap_or("")) {
            Ok(mask) => mask,
            Err(key) => {
                return Response::error(
                    400,
                    "bad-query",
                    &format!(
                        "unknown pass {key:?}: passes={}",
                        rt_core::passes::PASS_KEYS.join(",")
                    ),
                )
            }
        };
        if passes != 0 && kind == Kind::Viewport {
            return Response::error(400, "bad-query", "passes are rendered by final jobs only");
        }
        let mesh = req.query("mesh").unwrap_or("");
        let client = req.query("client").unwrap_or("");
        // `share=<n>`: a viewport job that keeps n threads while a final runs (0: it pauses).
        let share = match req.query("share").map(str::parse::<usize>) {
            None => 0,
            Some(Ok(n)) => n,
            Some(Err(_)) => return Response::error(400, "bad-query", "share=<threads>"),
        };
        // `seq=<n>`: the view's number in the client's order; an older one arriving late is refused.
        let seq = match req.query("seq").map(str::parse::<u64>) {
            None => None,
            Some(Ok(n)) => Some(n),
            Some(Err(_)) => return Response::error(400, "bad-query", "seq=<n>"),
        };
        // `denoise=0|1` (U11): a viewport's live denoise switch to begin with (its RSB asks for
        // denoise; without the query it begins on).
        let live_denoise = match req.query("denoise") {
            None => None,
            Some("1") => Some(true),
            Some("0") => Some(false),
            Some(_) => return Response::error(400, "bad-query", "denoise=0|1"),
        };
        if live_denoise.is_some() && kind != Kind::Viewport {
            return Response::error(
                400,
                "bad-query",
                "denoise= is the live switch of a viewport job",
            );
        }
        // `full=1`: the body is the complete scene even without `MESH` sections (an empty project).
        let whole = req.query("full") == Some("1") || has_meshes(&rsb);
        let opts = JobOptions {
            finish,
            share,
            seq,
            passes,
            live_denoise,
            stand_in_denoise: None,
        };
        match self
            .engine
            .submit_with(kind, &rsb, whole, mesh, client, opts)
        {
            Ok(job) => Response::json(
                200,
                json::Object::new()
                    .num("id", f64::from(job.id))
                    .num("width", f64::from(job.width))
                    .num("height", f64::from(job.height))
                    .num("maxSamples", f64::from(job.max_samples))
                    .num("threads", self.engine.threads() as f64)
                    .str("isa", self.engine.isa().name())
                    .raw(
                        "passes",
                        &json::array(
                            rt_core::passes::keys_of_mask(job.passes)
                                .into_iter()
                                .map(json::string),
                        ),
                    )
                    .build(),
            ),
            Err(SubmitError::NeedMeshes) => Response::error(
                409,
                "need-meshes",
                "the meshes of this update are not loaded: send the whole scene",
            ),
            Err(SubmitError::BadScene(e)) => Response::error(400, "bad-scene", &e),
            Err(SubmitError::Busy) => Response::error(503, "busy", "too many windows rendering"),
            Err(SubmitError::Stale) => {
                Response::error(409, "stale", "a newer view of this window came first")
            }
        }
    }

    /// The renderer's diagnostics: the gate, the jobs, the windows' viewports and the connections.
    /// With `log=1` they also go to the log, with the page's `reason` (the viewport watchdog asks
    /// for this when it fires, so the log says what the launcher was doing).
    fn render_state(&self, req: &Request) -> Response {
        let state = json::Object::new()
            .num("connections", self.connections() as f64)
            .num("heartbeatSilenceMs", self.silence().as_millis() as f64)
            .raw("engine", &self.engine.state_json())
            .build();
        if req.query("log") == Some("1") {
            let reason: String = req
                .query("reason")
                .unwrap_or("")
                .chars()
                .filter(|c| c.is_ascii_alphanumeric() || " .,:;_-()".contains(*c))
                .take(200)
                .collect();
            crate::log!("render state ({reason}): {state}");
        }
        Response::json(200, state)
    }

    /// `GET /api/render/<id>`: the job's frame. With `after=<pass>` it waits (up to
    /// [`LONG_POLL`]) for a newer pass, the end, or a change in how it shares the threads; with
    /// `version=<n>` too (U11), also for a newer image (a live viewport's denoised one, or its
    /// switch turned), and the sums come only when the image is newer than `n` (without it, only
    /// with a newer pass). `data=0`: the header only. `fit=<w>x<h>` (U14, the queue's live view):
    /// the sums scaled down by a whole factor to fit that box ([`crate::render::Frame::fitted`], with
    /// `FLAG_SCALED` and the scaled size in the header); without sums it changes nothing.
    fn get_render(&self, req: &Request, id: &str) -> Response {
        let fit = match req.query("fit") {
            None => None,
            Some(text) => match parse_fit(text) {
                Some(fit) => Some(fit),
                None => return Response::error(400, "bad-query", "fit=<w>x<h>, 1 to 16384 each"),
            },
        };
        let Some(job) = id.parse::<u32>().ok().and_then(|id| self.engine.job(id)) else {
            return Response::error(404, "not-found", "no such job");
        };
        // Asked about: its page still wants it.
        job.touch();
        let after = req.query("after").and_then(|a| a.parse::<u32>().ok());
        let version = req.query("version").and_then(|v| v.parse::<u32>().ok());
        let frame = match after {
            Some(n) => job.wait_newer_image(n, version, LONG_POLL),
            None => job.frame(),
        };
        let data = req.query("data") != Some("0")
            && !frame.is_empty()
            && match (version, after) {
                (Some(v), _) => frame.version > v,
                (None, Some(n)) => frame.pass > n,
                (None, None) => true,
            };
        // Scaled only when the sums go out: a header alone keeps the image's size.
        let frame = match fit {
            Some((w, h)) if data => frame.fitted(w, h),
            _ => frame,
        };
        Response {
            status: 200,
            headers: vec![("Content-Type".into(), "application/octet-stream".into())],
            body: Body::Stream {
                len: frame.len(data),
                write: Box::new(move |w| frame.write(data, w)),
            },
        }
    }

    /// `POST /api/render/<id>/denoise?on=0|1` (U11): turns a viewport job's live denoise on or
    /// off. Off, its next frame is the noisy accumulation; on, it denoises what has accumulated at
    /// once (also once the job is over: a follower that asks with `version` waits for it). 409 for
    /// a job without live denoise (a final, or a view posted without denoise).
    fn post_live_denoise(&self, req: &Request, id: &str) -> Response {
        let Some(job) = id.parse::<u32>().ok().and_then(|id| self.engine.job(id)) else {
            return Response::error(404, "not-found", "no such job");
        };
        let on = match req.query("on") {
            Some("1") => true,
            Some("0") => false,
            _ => return Response::error(400, "bad-query", "on=0|1"),
        };
        job.touch();
        match job.set_live_denoise(on) {
            Some(on) => Response::json(
                200,
                json::Object::new()
                    .num("id", f64::from(job.id))
                    .bool("on", on)
                    .num("version", f64::from(job.frame().version))
                    .build(),
            ),
            None => Response::error(409, "not-live", "this job has no live denoise"),
        }
    }

    /// `GET /api/render/<id>/passes`: the kept passes of a final render (`kept.rs`, `RPP1`).
    fn get_passes(&self, id: &str) -> Response {
        let Ok(id) = id.parse::<u32>() else {
            return Response::error(404, "not-found", "no such render");
        };
        // The job first: one that finishes in between has kept its passes before it ended.
        let rendering = self
            .engine
            .job(id)
            .is_some_and(|job| job.passes != 0 && !job.frame().finished());
        if rendering {
            return Response::error(409, "not-ready", "the render is not finished");
        }
        match self.engine.kept_passes(id) {
            Some(body) => Response {
                status: 200,
                headers: vec![("Content-Type".into(), "application/octet-stream".into())],
                body: Body::Stream {
                    len: body.len,
                    write: body.write,
                },
            },
            None => Response::error(404, "not-found", "no passes kept for this render"),
        }
    }

    fn put_blob(&self, req: &Request, sha: &str, body: &mut dyn Read) -> Response {
        let num = |k: &str| req.query(k).map(str::parse::<u64>);
        let offset = match num("offset") {
            Some(Ok(n)) => n,
            _ => return Response::error(400, "bad-query", "offset=<n> is required"),
        };
        let total = match num("total") {
            None => None,
            Some(Ok(n)) => Some(n),
            Some(Err(_)) => return Response::error(400, "bad-query", "total"),
        };
        match self
            .models
            .write_chunk(sha, offset, total, req.content_length, body)
        {
            Ok(_) => match self.models.blob_json(sha) {
                Ok(j) => Response::json(200, j),
                Err(e) => store_error(e, Some(sha)),
            },
            Err(e) => store_error(e, Some(sha)),
        }
    }

    fn open_folder(&self, req: &Request, body: &mut dyn Read) -> Response {
        let v = match read_json(req, body) {
            Ok(v) => v,
            Err(r) => return r,
        };
        let p = &self.paths;
        let target = match (
            v.get("folder").and_then(Value::as_str),
            v.get("path").and_then(Value::as_str),
        ) {
            (Some("data"), _) => p.data_dir.clone(),
            (Some("models"), _) => p.models(),
            (Some("logs"), _) => p.logs(),
            (Some("results"), _) => p.results(),
            (None, Some(path)) => {
                let base = p.data_dir.canonicalize();
                let real = std::path::Path::new(path).canonicalize();
                match (base, real) {
                    (Ok(base), Ok(real)) if real.starts_with(&base) => crate::paths::simplify(real),
                    _ => return Response::error(403, "outside", "only folders in the data folder"),
                }
            }
            _ => {
                return Response::error(
                    400,
                    "bad-body",
                    "{\"folder\": data|models|logs|results} or {\"path\": ...}",
                )
            }
        };
        if let Err(e) = std::fs::create_dir_all(&target) {
            return io_error(&e);
        }
        match crate::browser::open_folder(&target) {
            Ok(()) => Response::empty(204),
            Err(e) => io_error(&e),
        }
    }
}

fn read_text(req: &Request, body: &mut dyn Read, limit: u64) -> Result<String, Response> {
    if req.content_length > limit {
        return Err(Response::error(413, "too-large", "body too large"));
    }
    let mut text = String::new();
    body.read_to_string(&mut text)
        .map_err(|_| Response::error(400, "bad-body", "the body is not UTF-8 text"))?;
    Ok(text)
}

/// A JSON request body (at most [`MAX_JSON`] bytes).
pub(crate) fn read_json(req: &Request, body: &mut dyn Read) -> Result<Value, Response> {
    let text = read_text(req, body, MAX_JSON)?;
    json::parse(&text).map_err(|e| Response::error(400, "bad-json", &e.to_string()))
}

fn io_error(e: &io::Error) -> Response {
    if e.kind() == io::ErrorKind::StorageFull {
        Response::error(507, "disk-full", "not enough space on the disk")
    } else {
        Response::error(500, "io", &e.to_string())
    }
}

/// The HTTP answer to a store error.
pub fn store_error(e: StoreError, sha: Option<&str>) -> Response {
    match e {
        StoreError::BadName => Response::error(400, "bad-name", "invalid key, file name or sha256"),
        StoreError::UnknownKey => Response::error(404, "unknown-key", "no such model"),
        StoreError::NotFound => Response::error(404, "not-found", "no such blob"),
        StoreError::Damaged => Response::error(
            409,
            "damaged",
            "the part is damaged: delete it and download again",
        ),
        StoreError::Checking => Response::error(409, "checking", "the blob is being checked"),
        StoreError::Conflict(m) => Response::error(409, "conflict", &m),
        StoreError::OutOfRange => {
            Response::error(416, "out-of-range", "the chunk does not fit the blob")
        }
        StoreError::Incomplete { contiguous } => Response::json(
            409,
            json::Object::new()
                .str("error", "incomplete")
                .str("message", "not every byte is written")
                .num("contiguous", contiguous as f64)
                .build(),
        ),
        StoreError::Mismatch { actual } => Response::json(
            422,
            json::Object::new()
                .str("error", "sha256-mismatch")
                .str(
                    "message",
                    "the bytes do not match the sha256: the part is now damaged",
                )
                .opt_str("expected", sha)
                .str("actual", &actual)
                .build(),
        ),
        StoreError::Missing(files) => Response::json(
            409,
            json::Object::new()
                .str("error", "missing")
                .str("message", "files of the model are not complete")
                .raw("files", &json::array(files.iter().map(|f| json::string(f))))
                .build(),
        ),
        StoreError::BadBody(m) => Response::error(400, "bad-body", &m),
        StoreError::Io(e) => io_error(&e),
    }
}

/// Serves one connection until it closes.
fn serve_connection(app: &App, stream: TcpStream) {
    let _ = stream.set_nodelay(true);
    let _ = stream.set_read_timeout(Some(IDLE));
    let _ = stream.set_write_timeout(Some(WRITE_TIMEOUT));
    let Ok(read_half) = stream.try_clone() else {
        return;
    };
    let mut reader = BufReader::with_capacity(256 * 1024, read_half);
    let mut writer = BufWriter::with_capacity(256 * 1024, stream);
    loop {
        let req = match read_request(&mut reader) {
            Ok(r) => r,
            Err(ReadError::Closed | ReadError::Io(_)) => return,
            Err(e) => {
                let r = match e {
                    ReadError::Bad(m) => Response::text(400, m),
                    ReadError::TooLarge => Response::text(431, "request head too large"),
                    ReadError::Unsupported(m) => Response::text(501, m),
                    _ => Response::text(505, "HTTP/1.1 only"),
                };
                let _ = write_response(&mut writer, r, false, false);
                return;
            }
        };
        let head = req.method == "HEAD";
        let mut keep = req.keep_alive() && !app.stopping.load(Ordering::Relaxed);
        let mut body = (&mut reader).take(req.content_length);
        let response = match app.check(&req) {
            Err(r) => r,
            Ok(()) => {
                if req
                    .header("expect")
                    .is_some_and(|e| e.eq_ignore_ascii_case("100-continue"))
                {
                    let _ = writer.write_all(b"HTTP/1.1 100 Continue\r\n\r\n");
                    let _ = writer.flush();
                }
                app.route(&req, &mut body)
            }
        };
        // Whatever the handler left of the body is drained (or the connection closed).
        let left = body.limit();
        if left > 0 && (left > (1 << 20) || io::copy(&mut body, &mut io::sink()).is_err()) {
            keep = false;
        }
        // A long-polled frame nobody reads any more (its page went on to a newer view) gives the
        // connection up soon: a short timeout cuts it and the connection closes. (The final image,
        // fetched without `after`, keeps the long timeout.)
        let frame = req.method == "GET"
            && req.path.starts_with("/api/render/")
            && req.query("after").is_some();
        if frame {
            let ms = app.frame_write_timeout_ms.load(Ordering::Relaxed).max(1);
            let _ = writer
                .get_ref()
                .set_write_timeout(Some(Duration::from_millis(ms)));
        }
        if write_response(&mut writer, response, head, keep).is_err() {
            // What is left in the buffer is dropped with the connection, not flushed with the
            // long timeout (a reader that stopped would keep the thread for minutes).
            let _ = writer.get_ref().shutdown(Shutdown::Both);
            return;
        }
        if frame {
            let _ = writer.get_ref().set_write_timeout(Some(WRITE_TIMEOUT));
        }
        if !keep {
            return;
        }
    }
}

/// What a server is built with besides its folders, port, token and threads. The application
/// (`port.rs`) always takes the default; only the tests set a field, so a shipped binary never
/// takes any of this from its data folder or its environment.
#[derive(Default)]
pub struct Options {
    /// The AI runtimes' catalogue and downloader in place of the embedded catalogue and the
    /// system's `curl` over https (`Ai::with`; the tests: a fake runtime, a local http server).
    pub ai_runtimes: Option<(
        crate::ai::catalogue::RuntimeCatalogue,
        crate::ai::download::Downloader,
    )>,
    /// How many final renders with passes are kept, and the largest kept in memory, in place of
    /// [`crate::kept::KeepLimits::default`] (the tests: a small store that spills to the disk).
    pub keep: Option<crate::kept::KeepLimits>,
    /// The updater's feed, downloader and mode in place of the real ones (the tests: a local server
    /// in place of GitHub, a kind of copy a Linux computer cannot be).
    pub update: Option<crate::update::Config>,
    /// A project file passed on the command line (`.repack` or `.repack.json`): the page reads it
    /// once at startup from `/api/startup-project` and opens it (a double-click in the file manager).
    pub open_file: Option<std::path::PathBuf>,
}

/// A running server.
pub struct Server {
    /// The shared state.
    pub app: Arc<App>,
    listener: Option<std::thread::JoinHandle<()>>,
}

impl Server {
    /// Binds `127.0.0.1:port` (0: any free port) and serves in the background.
    pub fn start(paths: Paths, port: u16, token: String, threads: usize) -> io::Result<Server> {
        Server::start_with(paths, port, token, threads, Options::default())
    }

    /// The same, built with `options`.
    pub fn start_with(
        paths: Paths,
        port: u16,
        token: String,
        threads: usize,
        options: Options,
    ) -> io::Result<Server> {
        let listener = TcpListener::bind(("127.0.0.1", port))?;
        let port = listener.local_addr()?.port();
        let models = Store::new(paths.models(), crate::recommend::catalogue().clone());
        let paths_data = paths.data_dir.clone();
        let update = crate::update::Updater::new(
            options
                .update
                .unwrap_or_else(|| crate::update::Config::of(&paths)),
        );
        let app = Arc::new(App {
            paths,
            token,
            port,
            engine: Engine::with_store(
                threads,
                crate::render::Limits::default(),
                options.keep.unwrap_or_default(),
                Some(paths_data.join("cache").join("ai")),
            ),
            models,
            browser: Mutex::new(None),
            dialogs: crate::dialogs::Dialogs::new(),
            files: crate::files::Files::new(&paths_data),
            ai: match options.ai_runtimes {
                Some((cat, downloader)) => {
                    crate::ai::Ai::with(paths_data.join("ai"), cat, downloader)
                }
                None => crate::ai::Ai::new(&paths_data),
            },
            update,
            open_file: options.open_file,
            last_alive: Mutex::new(Instant::now()),
            hardware: Mutex::new(None),
            connections: AtomicUsize::new(0),
            stopping: AtomicBool::new(false),
            frame_write_timeout_ms: AtomicU64::new(FRAME_WRITE_TIMEOUT.as_millis() as u64),
        });
        app.dialogs.set_cache_dir(app.paths.data_dir.join("cache"));
        // What the installer chose to download with the models (phase U10).
        app.ai.start_pending_runtime(&app.paths.pending_models());
        let shared = Arc::clone(&app);
        let handle = std::thread::spawn(move || {
            for stream in listener.incoming() {
                if shared.stopping.load(Ordering::Relaxed) {
                    break;
                }
                let Ok(mut stream) = stream else { continue };
                if shared.connections.fetch_add(1, Ordering::AcqRel) >= MAX_CONNECTIONS {
                    shared.connections.fetch_sub(1, Ordering::AcqRel);
                    let _ = write_response(
                        &mut stream,
                        Response::text(503, "too many connections"),
                        false,
                        false,
                    );
                    let _ = stream.shutdown(Shutdown::Both);
                    continue;
                }
                let app = Arc::clone(&shared);
                let spawned = std::thread::Builder::new()
                    .name("http".into())
                    .spawn(move || {
                        serve_connection(&app, stream);
                        app.connections.fetch_sub(1, Ordering::AcqRel);
                    });
                if spawned.is_err() {
                    shared.connections.fetch_sub(1, Ordering::AcqRel);
                }
            }
        });
        Ok(Server {
            app,
            listener: Some(handle),
        })
    }

    /// The port.
    pub fn port(&self) -> u16 {
        self.app.port
    }

    /// Stops accepting connections and every render job.
    pub fn stop(&mut self) {
        self.app.stopping.store(true, Ordering::Relaxed);
        self.app.dialogs.close_all();
        // Wake the accept loop.
        let _ = TcpStream::connect(("127.0.0.1", self.app.port));
        if let Some(h) = self.listener.take() {
            let _ = h.join();
        }
        self.app.engine.shutdown();
        self.app.ai.shutdown();
        self.app.update.shutdown();
    }
}

impl Drop for Server {
    fn drop(&mut self) {
        self.stop();
    }
}
