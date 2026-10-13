//! The inference server: stable-diffusion.cpp's `sd-server`, a separate process the launcher
//! starts with the arguments of the model it must load, talks to over HTTP on a loopback address,
//! and stops.
//!
//! **Server, not one command per image.** The release has a server that keeps the model loaded
//! (`docs/AI-POST.md` §7.3: preview after preview without loading several GB again), with a
//! native asynchronous API: `POST /sdcpp/v1/img_gen` answers `202 {id}`, `GET
//! /sdcpp/v1/jobs/<id>` the state (`queued`, `generating`, `completed` with the images in base64
//! PNG, `failed`, `cancelled`) and `POST /sdcpp/v1/jobs/<id>/cancel` stops it. It is ready when
//! `GET /sdcpp/v1/capabilities` answers (it listens only once the model is loaded). Progress is
//! what both programs print on their standard output: `|=====>   | 3/8 - 1.23s/it` per sampling
//! step and the same bar of `#` while loading the weights ([`parse_progress`]).
//!
//! **Address.** `sd-server` answers every origin with `Access-Control-Allow-Origin` (it reflects
//! the `Origin` header) and its job ids count up, so a page of another site that found it could
//! read the images. It listens on a random loopback address `127.a.b.c` (the whole of 127/8 is
//! the loopback on Linux and on Windows) and a free port, about 2^40 places to look for, and is
//! never on `127.0.0.1`; the browsers' Local Network Access permission adds to that.
//!
//! **Watching it.** A run fails, and the process is stopped, when it exits (a crash: the last
//! lines it printed say why), stays silent (no output and no change of state) for
//! [`Limits::silence`] (hung), or takes longer than [`Limits::load`] to load or [`Limits::run`] to
//! answer. A cancel is asked of the server first and, after 15 s, enforced by stopping it. The
//! process is stopped when the application ends, after [`Limits::idle`] without use, and when
//! another model or runtime is needed; its id is kept in `<data>/ai/sidecar.json` so a launch
//! after a crash stops the one left behind ([`Sidecar::clean_stale`]). No console window on
//! Windows (`CREATE_NO_WINDOW`).

use super::{b64, png, proc};
use crate::client::{read_reply, Reply};
use crate::json::{self, Value};
use std::collections::VecDeque;
use std::io::{self, BufReader, Read, Write};
use std::net::{Ipv4Addr, SocketAddr, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant};

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(PoisonError::into_inner)
}

/// How long things may take. Starting values, calibrated with real runs in X1 part B.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Limits {
    /// Loading the model, until the server answers.
    pub load: Duration,
    /// One image, from submitting it to the answer.
    pub run: Duration,
    /// Without any output or change of state: hung.
    pub silence: Duration,
    /// Unused this long, the server is stopped to give the memory back.
    pub idle: Duration,
}

impl Default for Limits {
    fn default() -> Limits {
        Limits {
            load: Duration::from_secs(30 * 60),
            run: Duration::from_secs(60 * 60),
            silence: Duration::from_secs(10 * 60),
            idle: Duration::from_secs(5 * 60),
        }
    }
}

/// What to start: a server executable with the arguments that load one model.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Spec {
    /// `sd-server` of an installed runtime.
    pub server: PathBuf,
    /// Its folder (the working directory; the DLLs and libraries are there).
    pub dir: PathBuf,
    /// The load arguments (`--diffusion-model <path>`...), without the address.
    pub args: Vec<String>,
    /// For the status: `<runtime key>/<model key>[+control]`.
    pub label: String,
}

impl Spec {
    fn identity(&self) -> String {
        let mut s = self.server.to_string_lossy().into_owned();
        for a in &self.args {
            s.push('\0');
            s.push_str(a);
        }
        s
    }
}

/// One image to make.
#[derive(Clone, Debug, PartialEq)]
pub struct Job {
    /// The prompt.
    pub prompt: String,
    /// The negative prompt.
    pub negative: String,
    /// Output width: the input image's.
    pub width: u32,
    /// Output height.
    pub height: u32,
    /// img2img strength, 0 to 1.
    pub strength: f64,
    /// The seed.
    pub seed: u64,
    /// Sampling steps.
    pub steps: u32,
    /// Guidance scale.
    pub cfg_scale: f64,
    /// Sampling method, or the model's default.
    pub sampler: Option<String>,
    /// Flow shift, or the model's default.
    pub flow_shift: Option<f64>,
    /// The input image, PNG in base64.
    pub image_b64: String,
    /// Also send it as the reference image (the edit models).
    pub as_reference: bool,
    /// A control image (PNG in base64) and its strength.
    pub control: Option<(String, f64)>,
}

impl Job {
    /// The body of `POST /sdcpp/v1/img_gen` (the fields of `examples/server/api.md`).
    pub fn to_json(&self) -> String {
        let mut sample = json::Object::new()
            .num("sample_steps", f64::from(self.steps))
            .raw(
                "guidance",
                &json::Object::new().num("txt_cfg", self.cfg_scale).build(),
            );
        if let Some(m) = &self.sampler {
            sample = sample.str("sample_method", m);
        }
        if let Some(f) = self.flow_shift {
            sample = sample.num("flow_shift", f);
        }
        let image = json::string(&self.image_b64);
        let mut o = json::Object::new()
            .str("prompt", &self.prompt)
            .str("negative_prompt", &self.negative)
            .num("width", f64::from(self.width))
            .num("height", f64::from(self.height))
            .num("strength", self.strength)
            .num("seed", self.seed as f64)
            .num("batch_count", 1.0)
            .raw("init_image", &image)
            .raw(
                "ref_images",
                &if self.as_reference {
                    format!("[{image}]")
                } else {
                    "[]".into()
                },
            );
        o = match &self.control {
            Some((img, strength)) => o
                .raw("control_image", &json::string(img))
                .num("control_strength", *strength),
            None => o.raw("control_image", "null"),
        };
        o.raw("sample_params", &sample.build())
            .bool("embed_image_metadata", false)
            .str("output_format", "png")
            .str("preview", "none")
            .build()
    }
}

/// Where a run is.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Stage {
    /// Starting the process.
    Starting,
    /// Loading the model.
    Loading,
    /// Waiting in the server's queue.
    Queued,
    /// Sampling.
    Inference,
    /// The last step is done: decoding and encoding the image.
    Finishing,
}

impl Stage {
    /// `STARTING`, `LOADING`...
    pub fn name(self) -> &'static str {
        match self {
            Stage::Starting => "STARTING",
            Stage::Loading => "LOADING",
            Stage::Queued => "QUEUED",
            Stage::Inference => "INFERENCE",
            Stage::Finishing => "FINISHING",
        }
    }
}

/// A run's progress.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Progress {
    /// Where it is.
    pub stage: Stage,
    /// Step done (loading: chunks of weights read), of `steps`.
    pub step: u32,
    /// Steps of this stage, 0 when not known.
    pub steps: u32,
}

/// Why a run failed.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SidecarError {
    /// The program did not start.
    Start(String),
    /// It ended by itself: why, and the last lines it printed.
    Crashed(String),
    /// Silent for longer than [`Limits::silence`], in this stage (`loading`, `inference`).
    Hung(&'static str),
    /// Past [`Limits::load`] or [`Limits::run`].
    TimedOut(&'static str),
    /// Cancelled.
    Cancelled,
    /// The server says the job failed.
    Failed(String),
    /// An answer that does not follow the protocol.
    Protocol(String),
    /// An image of another size than asked: refused.
    WrongSize {
        /// What came.
        got: (u32, u32),
        /// What was asked.
        want: (u32, u32),
    },
    /// The image does not decode.
    BadImage(String),
}

impl SidecarError {
    /// A stable code for the API.
    pub fn code(&self) -> &'static str {
        match self {
            SidecarError::Start(_) => "start",
            SidecarError::Crashed(_) => "crashed",
            SidecarError::Hung(_) => "hung",
            SidecarError::TimedOut(_) => "timeout",
            SidecarError::Cancelled => "cancelled",
            SidecarError::Failed(_) => "failed",
            SidecarError::Protocol(_) => "protocol",
            SidecarError::WrongSize { .. } => "wrong-size",
            SidecarError::BadImage(_) => "bad-image",
        }
    }

    /// In words, in English (the interface words it from the code).
    pub fn message(&self) -> String {
        match self {
            SidecarError::Start(m) => format!("the runtime did not start: {m}"),
            SidecarError::Crashed(m) => format!("the runtime stopped: {m}"),
            SidecarError::Hung(s) => format!("the runtime stopped answering while {s}"),
            SidecarError::TimedOut(s) => format!("the runtime took too long {s}"),
            SidecarError::Cancelled => "cancelled".into(),
            SidecarError::Failed(m) => format!("the runtime could not make the image: {m}"),
            SidecarError::Protocol(m) => format!("the runtime answered something unexpected: {m}"),
            SidecarError::WrongSize { got, want } => format!(
                "the runtime returned {}×{} instead of {}×{}",
                got.0, got.1, want.0, want.1
            ),
            SidecarError::BadImage(m) => format!("the runtime returned an unreadable image: {m}"),
        }
    }
}

/// A progress line: `(loading, step, steps)`. Loading bars are made of `#`, sampling (and
/// tiling) bars of `=` and `>`.
pub fn parse_progress(line: &str) -> Option<(bool, u32, u32)> {
    let first = line.find('|')?;
    let last = line.rfind('|')?;
    if last <= first {
        return None;
    }
    let bar = &line[first + 1..last];
    if bar.is_empty() || !bar.bytes().all(|b| matches!(b, b'=' | b'>' | b'#' | b' ')) {
        return None;
    }
    let rest = line[last + 1..].trim();
    let fraction = rest.split_whitespace().next()?;
    let (a, b) = fraction.split_once('/')?;
    let (step, steps) = (a.parse::<u32>().ok()?, b.parse::<u32>().ok()?);
    (steps > 0 && step <= steps).then_some((bar.contains('#'), step, steps))
}

/// Removes terminal escape sequences (`ESC [ ... letter`).
fn strip_escapes(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\u{1b}' {
            if chars.peek() == Some(&'[') {
                chars.next();
                for d in chars.by_ref() {
                    if d.is_ascii_alphabetic() {
                        break;
                    }
                }
            }
            continue;
        }
        out.push(c);
    }
    out
}

#[derive(Debug)]
struct OutputState {
    last: Instant,
    loading: Option<(u32, u32)>,
    sampling: Option<(u32, u32)>,
    tail: VecDeque<String>,
}

/// What the process printed: when it last said anything, the progress, the last lines.
#[derive(Debug)]
pub struct Output {
    state: Mutex<OutputState>,
    /// Outputs still being read.
    open: AtomicUsize,
}

impl Default for Output {
    fn default() -> Output {
        Output {
            open: AtomicUsize::new(0),
            state: Mutex::new(OutputState {
                last: Instant::now(),
                loading: None,
                sampling: None,
                tail: VecDeque::new(),
            }),
        }
    }
}

impl Output {
    /// Takes bytes of one output; `line` is that output's unfinished line (each output has its
    /// own: the progress bar of one, which ends in `\r`, must not swallow a line of the other).
    pub fn feed(&self, line: &mut Vec<u8>, bytes: &[u8]) {
        let mut s = lock(&self.state);
        s.last = Instant::now();
        for &b in bytes {
            if b == b'\r' || b == b'\n' {
                Output::line(&mut s, std::mem::take(line));
            } else if line.len() < 8192 {
                line.push(b);
            }
        }
    }

    /// The output ended: what is left of its last line counts too.
    pub fn end(&self, line: Vec<u8>) {
        Output::line(&mut lock(&self.state), line);
    }

    fn line(s: &mut OutputState, line: Vec<u8>) {
        let text = strip_escapes(&String::from_utf8_lossy(&line));
        let text = text.trim();
        if text.is_empty() {
            return;
        }
        match parse_progress(text) {
            Some((true, a, b)) => s.loading = Some((a, b)),
            Some((false, a, b)) => s.sampling = Some((a, b)),
            None => {
                if s.tail.len() == 40 {
                    s.tail.pop_front();
                }
                s.tail.push_back(text.chars().take(400).collect());
            }
        }
    }

    /// Waits (up to `limit`) until both outputs are read to their end, so the last words of a
    /// process that just ended are in [`Output::tail`].
    fn drain(&self, limit: Duration) {
        let start = Instant::now();
        while self.open.load(Ordering::Acquire) > 0 && start.elapsed() < limit {
            std::thread::sleep(Duration::from_millis(5));
        }
    }

    fn last(&self) -> Instant {
        lock(&self.state).last
    }

    fn loading(&self) -> Option<(u32, u32)> {
        lock(&self.state).loading
    }

    fn sampling(&self) -> Option<(u32, u32)> {
        lock(&self.state).sampling
    }

    /// A new job: its progress starts from nothing (weights it loads on first use print the
    /// loading bar again).
    fn reset_progress(&self) {
        let mut s = lock(&self.state);
        s.sampling = None;
        s.loading = None;
    }

    /// The last lines that were not progress, newest last.
    pub fn tail(&self, n: usize) -> Vec<String> {
        let s = lock(&self.state);
        s.tail
            .iter()
            .skip(s.tail.len().saturating_sub(n))
            .cloned()
            .collect()
    }
}

fn pump<R: Read>(mut r: R, out: &Output) {
    let mut buf = [0u8; 4096];
    let mut line = Vec::new();
    while let Ok(n) = r.read(&mut buf) {
        if n == 0 {
            break;
        }
        out.feed(&mut line, &buf[..n]);
    }
    out.end(line);
    out.open.fetch_sub(1, Ordering::AcqRel);
}

/// A random loopback address that is not `127.0.0.1` (see the module's documentation).
pub fn random_loopback() -> Ipv4Addr {
    let hex = crate::token::generate();
    let byte = |i: usize| u8::from_str_radix(&hex[i * 2..i * 2 + 2], 16).unwrap_or(1);
    Ipv4Addr::new(127, 1 + byte(0) % 254, byte(1), 1 + byte(2) % 254)
}

/// A free port on `ip` (bound, read and released), with the address it was found on: the random
/// one, or `127.0.0.1` where the system lets programs listen on that one only.
fn free_address() -> io::Result<SocketAddr> {
    let ip = random_loopback();
    let listener =
        TcpListener::bind((ip, 0)).or_else(|_| TcpListener::bind((Ipv4Addr::LOCALHOST, 0)))?;
    listener.local_addr()
}

/// The undoing of chunked transfer coding (RFC 9112 §7.1), for a server that uses it.
fn dechunk(body: &[u8]) -> Option<Vec<u8>> {
    let mut out = Vec::new();
    let mut p = 0;
    loop {
        let eol = body[p..].windows(2).position(|w| w == b"\r\n")? + p;
        let size_text = std::str::from_utf8(&body[p..eol]).ok()?;
        let size = usize::from_str_radix(size_text.split(';').next()?.trim(), 16).ok()?;
        p = eol + 2;
        if size == 0 {
            return Some(out);
        }
        out.extend_from_slice(body.get(p..p + size)?);
        p += size + 2;
    }
}

/// One HTTP/1.1 request to the server (`Connection: close`).
pub fn http(
    addr: SocketAddr,
    method: &str,
    path: &str,
    body: &[u8],
    timeout: Duration,
) -> io::Result<Reply> {
    let mut stream = TcpStream::connect_timeout(&addr, Duration::from_secs(2))?;
    stream.set_read_timeout(Some(timeout))?;
    stream.set_write_timeout(Some(timeout))?;
    let head = format!(
        "{method} {path} HTTP/1.1\r\nHost: {addr}\r\nAccept: application/json\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    );
    stream.write_all(head.as_bytes())?;
    stream.write_all(body)?;
    stream.flush()?;
    let mut reply = read_reply(&mut BufReader::new(stream), method == "HEAD")?;
    if reply
        .header("transfer-encoding")
        .is_some_and(|t| t.eq_ignore_ascii_case("chunked"))
    {
        reply.body = dechunk(&reply.body)
            .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "bad chunked body"))?;
    }
    Ok(reply)
}

struct Session {
    identity: String,
    label: String,
    child: Arc<Mutex<Child>>,
    addr: SocketAddr,
    output: Arc<Output>,
}

impl Session {
    fn exited(&self) -> Option<Option<i32>> {
        lock(&self.child)
            .try_wait()
            .ok()
            .flatten()
            .map(|s| s.code())
    }

    fn crash(&self) -> Option<SidecarError> {
        let code = self.exited()?;
        self.output.drain(Duration::from_secs(2));
        let tail = self.output.tail(6).join(" / ");
        Some(SidecarError::Crashed(if tail.is_empty() {
            proc::describe_exit(code)
        } else {
            format!("{}: {tail}", proc::describe_exit(code))
        }))
    }
}

fn kill(child: &Mutex<Child>) {
    let mut c = lock(child);
    let _ = c.kill();
    let _ = c.wait();
}

/// What the status shows.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Info {
    /// `stopped`, `loading`, `ready` or `busy`.
    pub state: &'static str,
    /// What is loaded (`<runtime>/<model>`).
    pub label: Option<String>,
    /// Its process id.
    pub pid: Option<u32>,
    /// Seconds since it was last used.
    pub idle_seconds: u64,
}

/// The server, at most one at a time.
pub struct Sidecar {
    /// The loaded server; a run holds this lock from start to answer, so runs queue on it.
    session: Mutex<Option<Session>>,
    /// The live process, killable from any thread (the application ending).
    live: Mutex<Option<Arc<Mutex<Child>>>>,
    state: Mutex<(&'static str, Option<String>, Option<u32>)>,
    pid_file: PathBuf,
    limits: Mutex<Limits>,
    last_used: Mutex<Instant>,
    busy: AtomicUsize,
    stopping: AtomicBool,
}

struct Busy<'a>(&'a AtomicUsize);

impl Drop for Busy<'_> {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::AcqRel);
    }
}

impl Sidecar {
    /// No server yet; its id will be kept in `pid_file` (`<data>/ai/sidecar.json`).
    pub fn new(pid_file: PathBuf) -> Sidecar {
        Sidecar {
            session: Mutex::new(None),
            live: Mutex::new(None),
            state: Mutex::new(("stopped", None, None)),
            pid_file,
            limits: Mutex::new(Limits::default()),
            last_used: Mutex::new(Instant::now()),
            busy: AtomicUsize::new(0),
            stopping: AtomicBool::new(false),
        }
    }

    /// The limits.
    pub fn limits(&self) -> Limits {
        *lock(&self.limits)
    }

    /// Other limits (tests, and X1 part B's measurements).
    pub fn set_limits(&self, limits: Limits) {
        *lock(&self.limits) = limits;
    }

    /// What is running.
    pub fn info(&self) -> Info {
        let s = lock(&self.state);
        Info {
            state: s.0,
            label: s.1.clone(),
            pid: s.2,
            idle_seconds: lock(&self.last_used).elapsed().as_secs(),
        }
    }

    fn set_state(&self, state: &'static str, label: Option<String>, pid: Option<u32>) {
        *lock(&self.state) = (state, label, pid);
    }

    /// A launch that ended badly may have left a server running: if `sidecar.json` names a
    /// process that is still our server (an executable under `runtimes_root`, and the very file
    /// the process runs: [`proc::runs_server`]), it is stopped. Returns the process id it stopped.
    pub fn clean_stale(&self, runtimes_root: &Path) -> Option<u32> {
        let text = std::fs::read_to_string(&self.pid_file).ok();
        let _ = std::fs::remove_file(&self.pid_file);
        let v = json::parse(&text?).ok()?;
        let pid = v.get("pid")?.as_f64()? as u32;
        let server = PathBuf::from(v.get("server")?.as_str()?);
        let inside = server.starts_with(runtimes_root)
            || proc::resolved(&server).starts_with(proc::resolved(runtimes_root));
        if !inside || pid == std::process::id() || !proc::runs_server(pid, &server) {
            return None;
        }
        crate::log!("stopping the AI runtime a previous launch left running (pid {pid})");
        proc::kill_pid(pid).then_some(pid)
    }

    fn write_pid(&self, pid: u32, server: &Path) {
        if let Some(dir) = self.pid_file.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let body = json::Object::new()
            .num("pid", f64::from(pid))
            .str("server", &server.to_string_lossy())
            .build();
        let _ = std::fs::write(&self.pid_file, body);
    }

    fn drop_session(&self, session: &mut Option<Session>) {
        if let Some(s) = session.take() {
            kill(&s.child);
        }
        // A server that never became a session (it hung, took too long or was cancelled while
        // loading) is only here.
        if let Some(child) = lock(&self.live).take() {
            kill(&child);
        }
        let _ = std::fs::remove_file(&self.pid_file);
        self.set_state("stopped", None, None);
    }

    /// Stops the server now, whatever it is doing (the application ends, or the person removed
    /// the runtime). A run in progress fails as cancelled.
    pub fn stop(&self) {
        self.stopping.store(true, Ordering::Release);
        if let Some(child) = lock(&self.live).take() {
            kill(&child);
        }
        let mut s = lock(&self.session);
        self.drop_session(&mut s);
        self.stopping.store(false, Ordering::Release);
    }

    /// Stops the server if no run uses it (`DELETE /api/ai/sidecar`, closing the AI section);
    /// false when one does.
    pub fn release(&self) -> bool {
        if self.busy.load(Ordering::Acquire) > 0 {
            return false;
        }
        match self.session.try_lock() {
            Ok(mut s) => {
                self.drop_session(&mut s);
                true
            }
            Err(_) => false,
        }
    }

    /// Stops a server unused for [`Limits::idle`]; true if it did.
    pub fn release_if_idle(&self) -> bool {
        let loaded = lock(&self.live).is_some();
        let idle = lock(&self.last_used).elapsed() >= self.limits().idle;
        loaded && idle && self.release()
    }

    /// Makes one image: starts the server for `spec` if it is not the one loaded, submits `job`,
    /// follows it until the answer and checks the image (a PNG of exactly the asked size).
    /// `cancel` is read all along; `progress` hears every change.
    pub fn run(
        &self,
        spec: &Spec,
        job: &Job,
        cancel: &AtomicBool,
        progress: &mut dyn FnMut(Progress),
    ) -> Result<Vec<u8>, SidecarError> {
        self.busy.fetch_add(1, Ordering::AcqRel);
        let _busy = Busy(&self.busy);
        let mut guard = lock(&self.session);
        if cancel.load(Ordering::Acquire) {
            return Err(SidecarError::Cancelled);
        }
        let stale = guard
            .as_ref()
            .is_some_and(|s| s.identity != spec.identity() || s.exited().is_some());
        if stale {
            self.drop_session(&mut guard);
        }
        if guard.is_none() {
            progress(Progress {
                stage: Stage::Starting,
                step: 0,
                steps: 0,
            });
            let session = self.start(spec, cancel, progress);
            match session {
                Ok(s) => *guard = Some(s),
                Err(e) => {
                    self.drop_session(&mut guard);
                    return Err(self.cancelled_or(e));
                }
            }
        }
        let Some(session) = guard.as_ref() else {
            return Err(SidecarError::Protocol("no session".into()));
        };
        self.set_state(
            "busy",
            Some(session.label.clone()),
            Some(lock(&session.child).id()),
        );
        let result = self.generate(session, job, cancel, progress);
        *lock(&self.last_used) = Instant::now();
        let keep = match &result {
            Ok(_)
            | Err(
                SidecarError::Failed(_)
                | SidecarError::WrongSize { .. }
                | SidecarError::BadImage(_),
            ) => true,
            Err(SidecarError::Cancelled) => session.exited().is_none(),
            Err(_) => false,
        };
        if keep {
            self.set_state(
                "ready",
                Some(session.label.clone()),
                Some(lock(&session.child).id()),
            );
        } else {
            self.drop_session(&mut guard);
        }
        result.map_err(|e| self.cancelled_or(e))
    }

    /// An error caused by [`Sidecar::stop`] reads as a cancel.
    fn cancelled_or(&self, e: SidecarError) -> SidecarError {
        if self.stopping.load(Ordering::Acquire) {
            SidecarError::Cancelled
        } else {
            e
        }
    }

    fn start(
        &self,
        spec: &Spec,
        cancel: &AtomicBool,
        progress: &mut dyn FnMut(Progress),
    ) -> Result<Session, SidecarError> {
        let limits = self.limits();
        let addr = free_address().map_err(|e| SidecarError::Start(e.to_string()))?;
        let mut cmd = Command::new(&spec.server);
        cmd.args(&spec.args)
            .arg("--listen-ip")
            .arg(addr.ip().to_string())
            .arg("--listen-port")
            .arg(addr.port().to_string())
            .current_dir(&spec.dir)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        crate::process::no_window(&mut cmd);
        let mut child = cmd
            .spawn()
            .map_err(|e| SidecarError::Start(format!("{}: {e}", spec.server.display())))?;
        let pid = child.id();
        let output = Arc::new(Output::default());
        for stream in [
            child
                .stdout
                .take()
                .map(|s| Box::new(s) as Box<dyn Read + Send>),
            child
                .stderr
                .take()
                .map(|s| Box::new(s) as Box<dyn Read + Send>),
        ]
        .into_iter()
        .flatten()
        {
            let out = Arc::clone(&output);
            output.open.fetch_add(1, Ordering::AcqRel);
            std::thread::spawn(move || pump(stream, &out));
        }
        let child = Arc::new(Mutex::new(child));
        *lock(&self.live) = Some(Arc::clone(&child));
        self.write_pid(pid, &spec.server);
        self.set_state("loading", Some(spec.label.clone()), Some(pid));
        crate::log!("AI runtime started: {} (pid {pid}, {addr})", spec.label);
        let session = Session {
            identity: spec.identity(),
            label: spec.label.clone(),
            child,
            addr,
            output,
        };
        let started = Instant::now();
        loop {
            if let Some(e) = session.crash() {
                return Err(e);
            }
            if cancel.load(Ordering::Acquire) {
                return Err(SidecarError::Cancelled);
            }
            if started.elapsed() > limits.load {
                return Err(SidecarError::TimedOut("loading the model"));
            }
            if session.output.last().elapsed() > limits.silence {
                return Err(SidecarError::Hung("loading the model"));
            }
            let (step, steps) = session.output.loading().unwrap_or((0, 0));
            progress(Progress {
                stage: Stage::Loading,
                step,
                steps,
            });
            if let Ok(r) = http(
                addr,
                "GET",
                "/sdcpp/v1/capabilities",
                b"",
                Duration::from_secs(5),
            ) {
                if r.status == 200 {
                    self.set_state("ready", Some(spec.label.clone()), Some(pid));
                    return Ok(session);
                }
            }
            std::thread::sleep(Duration::from_millis(100));
        }
    }

    fn generate(
        &self,
        s: &Session,
        job: &Job,
        cancel: &AtomicBool,
        progress: &mut dyn FnMut(Progress),
    ) -> Result<Vec<u8>, SidecarError> {
        let limits = self.limits();
        let started = Instant::now();
        s.output.reset_progress();
        let io_error = |e: io::Error| {
            s.crash().unwrap_or_else(|| {
                SidecarError::Protocol(format!("the server did not answer: {e}"))
            })
        };
        let r = http(
            s.addr,
            "POST",
            "/sdcpp/v1/img_gen",
            job.to_json().as_bytes(),
            Duration::from_secs(120),
        )
        .map_err(io_error)?;
        let body = json::parse(&r.text()).ok();
        if r.status != 202 && r.status != 200 {
            let why = body
                .as_ref()
                .and_then(|b| b.get("error"))
                .and_then(|e| {
                    e.as_str()
                        .map(str::to_string)
                        .or_else(|| e.get("message").and_then(Value::as_str).map(str::to_string))
                })
                .unwrap_or_else(|| format!("HTTP {}", r.status));
            return Err(SidecarError::Failed(why));
        }
        let id = body
            .as_ref()
            .and_then(|b| b.get("id"))
            .and_then(Value::as_str)
            .filter(|id| {
                id.bytes()
                    .all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-')
            })
            .ok_or_else(|| SidecarError::Protocol("no job id".into()))?
            .to_string();
        let mut last_status = String::new();
        let mut last_change = Instant::now();
        let mut cancel_sent: Option<Instant> = None;
        loop {
            std::thread::sleep(Duration::from_millis(150));
            if let Some(e) = s.crash() {
                return Err(e);
            }
            if cancel.load(Ordering::Acquire) && cancel_sent.is_none() {
                cancel_sent = Some(Instant::now());
                let _ = http(
                    s.addr,
                    "POST",
                    &format!("/sdcpp/v1/jobs/{id}/cancel"),
                    b"",
                    Duration::from_secs(10),
                );
            }
            if cancel_sent.is_some_and(|t| t.elapsed() > Duration::from_secs(15)) {
                kill(&s.child);
                return Err(SidecarError::Cancelled);
            }
            if started.elapsed() > limits.run {
                kill(&s.child);
                return Err(SidecarError::TimedOut("making the image"));
            }
            let quiet = s.output.last().max(last_change).elapsed();
            if quiet > limits.silence {
                kill(&s.child);
                return Err(SidecarError::Hung("making the image"));
            }
            let r = match http(
                s.addr,
                "GET",
                &format!("/sdcpp/v1/jobs/{id}"),
                b"",
                Duration::from_secs(120),
            ) {
                Ok(r) => r,
                Err(e) => {
                    if let Some(e) = s.crash() {
                        return Err(e);
                    }
                    crate::log!("AI runtime poll: {e}");
                    continue;
                }
            };
            if r.status != 200 {
                return Err(SidecarError::Protocol(format!(
                    "job {id}: HTTP {}",
                    r.status
                )));
            }
            let v = json::parse(&r.text()).map_err(|e| SidecarError::Protocol(e.to_string()))?;
            let status = v
                .get("status")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            if status != last_status {
                last_status.clone_from(&status);
                last_change = Instant::now();
            }
            match status.as_str() {
                "queued" => progress(Progress {
                    stage: Stage::Queued,
                    step: 0,
                    steps: 0,
                }),
                "generating" => {
                    // stable-diffusion.cpp loads weights on first use: before the first step,
                    // a loading bar is loading.
                    let p = match (s.output.sampling(), s.output.loading()) {
                        (None, Some((step, steps))) => Progress {
                            stage: Stage::Loading,
                            step,
                            steps,
                        },
                        (sampling, _) => {
                            let (step, steps) = sampling.unwrap_or((0, 0));
                            Progress {
                                stage: if steps > 0 && step == steps {
                                    Stage::Finishing
                                } else {
                                    Stage::Inference
                                },
                                step,
                                steps,
                            }
                        }
                    };
                    progress(p);
                }
                "completed" => return check_image(&v, job),
                "cancelled" => return Err(SidecarError::Cancelled),
                "failed" => {
                    let m = v
                        .get("error")
                        .and_then(|e| e.get("message"))
                        .and_then(Value::as_str)
                        .unwrap_or("no reason given");
                    return Err(SidecarError::Failed(m.to_string()));
                }
                other => return Err(SidecarError::Protocol(format!("job state {other:?}"))),
            }
        }
    }
}

/// The image of a completed job, checked: base64, a PNG that decodes, of exactly the asked size.
fn check_image(v: &Value, job: &Job) -> Result<Vec<u8>, SidecarError> {
    let b64_text = v
        .get("result")
        .and_then(|r| r.get("images"))
        .and_then(Value::as_array)
        .and_then(|a| a.first())
        .and_then(|i| i.get("b64_json"))
        .and_then(Value::as_str)
        .ok_or_else(|| SidecarError::Protocol("a completed job without an image".into()))?;
    let bytes = b64::decode(b64_text).ok_or_else(|| SidecarError::BadImage("not base64".into()))?;
    let h = png::header(&bytes).map_err(|e| SidecarError::BadImage(e.to_string()))?;
    if (h.width, h.height) != (job.width, job.height) {
        return Err(SidecarError::WrongSize {
            got: (h.width, h.height),
            want: (job.width, job.height),
        });
    }
    png::decode(&bytes, u64::from(job.width) * u64::from(job.height))
        .map_err(|e| SidecarError::BadImage(e.to_string()))?;
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn progress_lines_as_the_release_prints_them() {
        // print_progress_line of src/core/util.cpp: "\r  |<50 chars>| 3/8 - 1.23s/it\033[K".
        let bar =
            |c: char, n: usize| format!("  |{}{}| ", c.to_string().repeat(n), " ".repeat(50 - n));
        assert_eq!(
            parse_progress(&format!("{}3/8 - 1.23s/it", bar('=', 18))),
            Some((false, 3, 8))
        );
        assert_eq!(
            parse_progress(&format!("{}120/400 - 98.10MB/s", bar('#', 15))),
            Some((true, 120, 400))
        );
        assert_eq!(
            parse_progress("  |==================================================| 8/8 - 2.50it/s"),
            Some((false, 8, 8))
        );
        for not in [
            "[INFO ] stable-diffusion.cpp:123 - loading | done",
            "| a | b |",
            "  |====| 9/8 - x",
            "  |==| 1/0 - x",
        ] {
            assert_eq!(parse_progress(not), None, "{not}");
        }
        let out = Output::default();
        let (mut stdout, mut stderr) = (Vec::new(), Vec::new());
        out.feed(
            &mut stdout,
            b"[INFO ] loading model\n  |##   | 1/4 - 1MB/s\x1b[K\r  |#### | 4/4 - 1MB/s\x1b[K\n",
        );
        out.feed(
            &mut stdout,
            b"  |=>   | 1/8 - 0.5s/it\x1b[K\r  |==>  | 2/8 - 0.5",
        );
        // A line of the other output in the middle of an unfinished progress line stays whole.
        out.feed(&mut stderr, b"[ERROR] GGML_ASSERT failed\n");
        out.feed(&mut stdout, b"s/it\x1b[K\rlast line\n");
        out.feed(&mut stdout, b"no newline");
        out.end(stdout);
        assert_eq!(out.loading(), Some((4, 4)));
        assert_eq!(out.sampling(), Some((2, 8)));
        assert_eq!(
            out.tail(5),
            [
                "[INFO ] loading model",
                "[ERROR] GGML_ASSERT failed",
                "last line",
                "no newline"
            ]
        );
    }

    #[test]
    fn the_job_follows_the_native_api() {
        let job = Job {
            prompt: "a \"studio\" photo".into(),
            negative: "text".into(),
            width: 512,
            height: 384,
            strength: 0.3,
            seed: 42,
            steps: 8,
            cfg_scale: 1.0,
            sampler: Some("euler".into()),
            flow_shift: Some(3.0),
            image_b64: "iVBORw0K".into(),
            as_reference: true,
            control: Some(("Q09OVA==".into(), 0.9)),
        };
        let v = json::parse(&job.to_json()).unwrap();
        assert_eq!(
            v.get("prompt").unwrap().as_str(),
            Some("a \"studio\" photo")
        );
        assert_eq!(v.get("width").unwrap().as_f64(), Some(512.0));
        assert_eq!(v.get("strength").unwrap().as_f64(), Some(0.3));
        assert_eq!(v.get("init_image").unwrap().as_str(), Some("iVBORw0K"));
        assert_eq!(v.get("ref_images").unwrap().as_array().unwrap().len(), 1);
        assert_eq!(v.get("control_image").unwrap().as_str(), Some("Q09OVA=="));
        assert_eq!(
            v.get("embed_image_metadata").unwrap().as_bool(),
            Some(false)
        );
        let s = v.get("sample_params").unwrap();
        assert_eq!(s.get("sample_steps").unwrap().as_f64(), Some(8.0));
        assert_eq!(
            s.get("guidance").unwrap().get("txt_cfg").unwrap().as_f64(),
            Some(1.0)
        );
        assert_eq!(s.get("sample_method").unwrap().as_str(), Some("euler"));
        // Integers are written as integers (the server reads `seed` and `width` only so).
        let text = job.to_json();
        assert!(text.contains("\"seed\":42,") && text.contains("\"width\":512,"));
        let plain = Job {
            as_reference: false,
            control: None,
            sampler: None,
            flow_shift: None,
            ..job
        };
        let v = json::parse(&plain.to_json()).unwrap();
        assert!(v.get("control_image").unwrap().is_null());
        assert!(v.get("ref_images").unwrap().as_array().unwrap().is_empty());
        assert!(v
            .get("sample_params")
            .unwrap()
            .get("sample_method")
            .is_none());
    }

    #[test]
    fn loopback_addresses_and_chunks() {
        for _ in 0..50 {
            let ip = random_loopback();
            assert!(ip.is_loopback() && ip != Ipv4Addr::LOCALHOST);
            assert!(ip.octets()[1] != 0 && ip.octets()[3] != 0 && ip.octets()[3] != 255);
        }
        assert!(free_address().unwrap().ip().is_loopback());
        assert_eq!(
            dechunk(b"4\r\nWiki\r\n5;x=1\r\npedia\r\n0\r\n\r\n").unwrap(),
            b"Wikipedia"
        );
        assert_eq!(dechunk(b"4\r\nWi"), None);
        assert_eq!(strip_escapes("a\u{1b}[Kb\u{1b}[1;31mc"), "abc");
    }

    #[test]
    fn a_stale_pid_file_of_another_program_is_left_alone() {
        let dir = crate::test_dir("sidecar-stale");
        let s = Sidecar::new(dir.join("sidecar.json"));
        // Our own process is never "the runtime", and a server outside the runtimes folder is
        // never touched.
        std::fs::write(
            dir.join("sidecar.json"),
            format!(
                "{{\"pid\":{},\"server\":\"{}\"}}",
                std::process::id(),
                dir.join("runtimes/x/sd-server").display()
            ),
        )
        .unwrap();
        assert_eq!(s.clean_stale(&dir.join("runtimes")), None);
        assert!(!dir.join("sidecar.json").exists());
        std::fs::write(
            dir.join("sidecar.json"),
            "{\"pid\":1,\"server\":\"/usr/bin/sd-server\"}",
        )
        .unwrap();
        assert_eq!(s.clean_stale(&dir.join("runtimes")), None);
        assert_eq!(s.info().state, "stopped");
    }
}
