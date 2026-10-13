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
use crate::render::{has_meshes, Engine, Finish, Kind, SubmitError};
use crate::static_files;
use std::io::{self, BufReader, BufWriter, Read, Write};
use std::net::{Shutdown, TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant};

/// Connections served at once.
pub const MAX_CONNECTIONS: usize = 64;
/// Largest RSB accepted by `/api/render`.
pub const MAX_RSB: u64 = 2 << 30;
/// Largest JSON body.
pub const MAX_JSON: u64 = 1 << 20;
/// How long an idle keep-alive connection stays open.
pub const IDLE: Duration = Duration::from_secs(30);
/// Longest wait of `GET /api/render/<id>?after=<n>`.
pub const LONG_POLL: Duration = Duration::from_secs(1);

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
    last_alive: Mutex<Instant>,
    hardware: Mutex<Option<Hardware>>,
    connections: AtomicUsize,
    stopping: AtomicBool,
}

impl App {
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

    fn hardware(&self, refresh: bool) -> Hardware {
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
        let m = req.method.as_str();
        api(match (m, parts.as_slice()) {
            ("GET", ["info"]) => self.info(),
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
            ("GET", ["render", id]) => self.get_render(req, id),
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
                .num("pid", f64::from(std::process::id()))
                .build(),
        )
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
        let mesh = req.query("mesh").unwrap_or("");
        let client = req.query("client").unwrap_or("");
        // `full=1`: the body is the complete scene even without `MESH` sections (an empty project).
        let whole = req.query("full") == Some("1") || has_meshes(&rsb);
        match self
            .engine
            .submit_scene(kind, &rsb, whole, mesh, client, finish)
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
                    .build(),
            ),
            Err(SubmitError::NeedMeshes) => Response::error(
                409,
                "need-meshes",
                "the meshes of this update are not loaded: send the whole scene",
            ),
            Err(SubmitError::BadScene(e)) => Response::error(400, "bad-scene", &e),
            Err(SubmitError::Busy) => Response::error(503, "busy", "too many windows rendering"),
        }
    }

    fn get_render(&self, req: &Request, id: &str) -> Response {
        let Some(job) = id.parse::<u32>().ok().and_then(|id| self.engine.job(id)) else {
            return Response::error(404, "not-found", "no such job");
        };
        let after = req.query("after").and_then(|a| a.parse::<u32>().ok());
        let frame = match after {
            Some(n) => job.wait_newer(n, LONG_POLL),
            None => job.frame(),
        };
        let data = req.query("data") != Some("0")
            && !frame.is_empty()
            && after.is_none_or(|n| frame.pass > n);
        Response {
            status: 200,
            headers: vec![("Content-Type".into(), "application/octet-stream".into())],
            body: Body::Stream {
                len: frame.len(data),
                write: Box::new(move |w| frame.write(data, w)),
            },
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

fn read_json(req: &Request, body: &mut dyn Read) -> Result<Value, Response> {
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
    let _ = stream.set_write_timeout(Some(Duration::from_secs(120)));
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
        if write_response(&mut writer, response, head, keep).is_err() || !keep {
            return;
        }
    }
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
        let listener = TcpListener::bind(("127.0.0.1", port))?;
        let port = listener.local_addr()?.port();
        let models = Store::new(paths.models(), crate::recommend::catalogue().clone());
        let app = Arc::new(App {
            paths,
            token,
            port,
            engine: Engine::new(threads),
            models,
            browser: Mutex::new(None),
            last_alive: Mutex::new(Instant::now()),
            hardware: Mutex::new(None),
            connections: AtomicUsize::new(0),
            stopping: AtomicBool::new(false),
        });
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
        // Wake the accept loop.
        let _ = TcpStream::connect(("127.0.0.1", self.app.port));
        if let Some(h) = self.listener.take() {
            let _ = h.join();
        }
        self.app.engine.shutdown();
    }
}

impl Drop for Server {
    fn drop(&mut self) {
        self.stop();
    }
}
