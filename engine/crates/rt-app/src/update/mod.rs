//! Updating the application from inside it (phase P5).
//!
//! The page asks `POST /api/update/install` with the release's package and `SHA256SUMS.txt`
//! (both on GitHub's `releases/download/`, [`feed`]) and follows `GET /api/update`. The launcher
//! does the rest, with the system's `curl` like every other download (`ai/download.rs`):
//!
//! 1. **DOWNLOADING**: `SHA256SUMS.txt`, then the package, into `<data>/cache/update/`;
//! 2. **VERIFYING**: the package's SHA-256, with this crate's own ([`crate::sha256`]), against the
//!    sum the release lists for it. A package that does not match is deleted and nothing is installed;
//! 3. **INSTALLING**: an installed Windows copy keeps the verified installer for the end; a portable
//!    copy (Windows and Linux) unpacks the package into `<exe folder>/update-<tag>/` and swaps the
//!    files in place ([`portable`]: extract everything first, rename after, and put everything back
//!    when a step fails).
//!
//! Then the launcher waits to be closed: the page closes the window after its own question about
//! unsaved changes (or, with `--serve-only`, which has no window, the launcher stops by itself).
//! **Only when it has stopped** ([`Updater::finish`], called by `launcher::run` after the server and
//! the window are gone) the installer is started (`setup.exe /S /LAUNCH`) or the new executable
//! (`--after-update`), detached: so the new version never starts beside an old one that still holds
//! the port, the window's profile and `instance.json`.
//!
//! Nothing here changes without the person having asked: every request is checked against the feed
//! and the kind of copy this is (a copy that is neither installed nor portable refuses).

pub mod feed;
pub mod portable;

use crate::ai::download::{self, Downloader, Expect, Outcome, Transfer};
use crate::http::{Request as HttpRequest, Response};
use crate::json::{self, Value};
use crate::paths::Paths;
use crate::sha256::{hex, Sha256};
use feed::{Feed, Kind};
use std::ffi::OsString;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::thread::JoinHandle;
use std::time::Duration;

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(PoisonError::into_inner)
}

/// The most a package may weigh (the real ones are tens of megabytes).
pub const MAX_PACKAGE: u64 = 1 << 30;
/// The most `SHA256SUMS.txt` may weigh.
pub const MAX_SUMS: u64 = 1 << 20;
/// How many times a download that was cut resumes.
const ATTEMPTS: usize = 3;
/// What the installer is run with: NSIS's silent switch, and the option `installer.nsi` reads to start
/// the application again when it is done (`.onInstSuccess`). `tests/installer.rs` reads the script.
pub const INSTALLER_ARGS: [&str; 2] = ["/S", "/LAUNCH"];
/// The uninstaller the installer writes beside the program: what tells an installed copy.
pub const UNINSTALLER: &str = "uninstall.exe";

/// What kind of copy this is, and so how it is updated.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mode {
    /// Installed by the Windows installer: it is run again, silently, to replace the program.
    Installed,
    /// A portable folder: unpacked and swapped in place.
    Portable(Kind),
    /// Neither (a build run from a development folder, another system or processor): it says why.
    Unsupported(&'static str),
}

impl Mode {
    /// The mode of a copy by what is known of it. Only x86-64 packages exist; an installed copy has
    /// the installer's `uninstall.exe` beside the program; a portable one has `portable.txt` (the data
    /// folder is then `data/` beside it, which `--data-dir` would override).
    pub fn of(os: &str, arch: &str, portable: bool, has_uninstaller: bool) -> Mode {
        if arch != "x86_64" {
            return Mode::Unsupported("there are packages for x86-64 computers only");
        }
        match (os, portable, has_uninstaller) {
            ("windows", true, _) => Mode::Portable(Kind::WindowsPortable),
            ("linux", true, _) => Mode::Portable(Kind::LinuxPortable),
            ("windows", false, true) => Mode::Installed,
            ("windows" | "linux", false, false) => Mode::Unsupported(
                "this copy is neither installed nor portable (no uninstall.exe or portable.txt beside the program)",
            ),
            _ => Mode::Unsupported("there are packages for Windows and Linux only"),
        }
    }

    /// The mode of the running launcher.
    pub fn detect(paths: &Paths) -> Mode {
        Mode::of(
            std::env::consts::OS,
            std::env::consts::ARCH,
            paths.portable,
            paths.exe_dir.join(UNINSTALLER).is_file(),
        )
    }

    /// The package that updates a copy of this mode.
    pub fn kind(self) -> Option<Kind> {
        match self {
            Mode::Installed => Some(Kind::Setup),
            Mode::Portable(kind) => Some(kind),
            Mode::Unsupported(_) => None,
        }
    }

    /// The word `GET /api/update` gives.
    pub fn word(self) -> Option<&'static str> {
        match self {
            Mode::Installed => Some("installer"),
            Mode::Portable(_) => Some("portable"),
            Mode::Unsupported(_) => None,
        }
    }
}

/// What the updater is made of. The application always takes [`Config::of`]; only the tests build
/// another (a local server in place of GitHub, a mode a Linux computer cannot have).
#[derive(Clone, Debug)]
pub struct Config {
    /// Where releases come from.
    pub feed: Feed,
    /// How files are downloaded.
    pub downloader: Downloader,
    /// What kind of copy this is.
    pub mode: Mode,
    /// The program's folder (a portable copy is swapped in place there).
    pub exe_dir: PathBuf,
    /// Where downloads go while they are checked.
    pub cache_dir: PathBuf,
    /// The arguments this launcher was started with, handed to the new one.
    pub args: Vec<OsString>,
    /// The system's `tar`, for the Linux package.
    pub tar: Option<PathBuf>,
}

fn in_path(name: &str) -> Option<PathBuf> {
    std::env::var_os("PATH").and_then(|paths| {
        std::env::split_paths(&paths)
            .map(|d| d.join(name))
            .find(|p| p.is_file())
    })
}

impl Config {
    /// The configuration of the running application.
    pub fn of(paths: &Paths) -> Config {
        Config {
            feed: Feed::embedded(),
            downloader: Downloader::system(),
            mode: Mode::detect(paths),
            exe_dir: paths.exe_dir.clone(),
            cache_dir: paths.data_dir.join("cache").join("update"),
            args: std::env::args_os().skip(1).collect(),
            tar: in_path("tar"),
        }
    }
}

/// Where the update is.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Phase {
    /// Nothing under way.
    Idle,
    /// Downloading the checksums and the package.
    Downloading,
    /// Checking the package's SHA-256.
    Verifying,
    /// Unpacking and swapping the files, or ready and waiting for the window to close.
    Installing,
    /// It stopped; `error` and `message` say why. Nothing was changed.
    Failed,
}

impl Phase {
    fn word(self) -> &'static str {
        match self {
            Phase::Idle => "IDLE",
            Phase::Downloading => "DOWNLOADING",
            Phase::Verifying => "VERIFYING",
            Phase::Installing => "INSTALLING",
            Phase::Failed => "FAILED",
        }
    }

    fn active(self) -> bool {
        matches!(
            self,
            Phase::Downloading | Phase::Verifying | Phase::Installing
        )
    }
}

/// What starts when the launcher has stopped.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Finish {
    /// The verified installer, run silently.
    Installer {
        /// Where it is.
        setup: PathBuf,
    },
    /// The new executable of a portable folder, whose files were swapped.
    Relaunch {
        /// Where it is.
        exe: PathBuf,
    },
}

/// Why an update stopped.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Failure {
    /// The code the page words: `download`, `disk-full`, `sums`, `checksum`, `extract`, `install`.
    pub code: &'static str,
    /// What happened, in English.
    pub message: String,
}

fn fail(code: &'static str, message: impl Into<String>) -> Stop {
    Stop::Failed(Failure {
        code,
        message: message.into(),
    })
}

enum Stop {
    Cancelled,
    Failed(Failure),
}

struct Shared {
    phase: Phase,
    tag: Option<String>,
    total: u64,
    failure: Option<Failure>,
    finish: Option<Finish>,
    /// Which install this is; a worker that was superseded writes nothing.
    job: u64,
    transfer: Arc<Transfer>,
    worker: Option<JoinHandle<()>>,
}

/// The update in progress and what it needs.
pub struct Updater {
    cfg: Config,
    shared: Mutex<Shared>,
    exit: AtomicBool,
    after_update: AtomicBool,
}

impl Updater {
    /// An updater for `cfg`.
    pub fn new(cfg: Config) -> Arc<Updater> {
        Arc::new(Updater {
            cfg,
            shared: Mutex::new(Shared {
                phase: Phase::Idle,
                tag: None,
                total: 0,
                failure: None,
                finish: None,
                job: 0,
                transfer: Arc::new(Transfer::default()),
                worker: None,
            }),
            exit: AtomicBool::new(false),
            after_update: AtomicBool::new(false),
        })
    }

    /// The mode of this copy.
    pub fn mode(&self) -> Mode {
        self.cfg.mode
    }

    /// This launcher was started by an update (`--after-update`).
    pub fn mark_after_update(&self) {
        self.after_update.store(true, Ordering::Relaxed);
    }

    /// Whether this launcher was started by an update.
    pub fn after_update(&self) -> bool {
        self.after_update.load(Ordering::Relaxed)
    }

    /// The update is ready and the launcher is to stop (a launcher with no window stops by itself).
    pub fn exit_requested(&self) -> bool {
        self.exit.load(Ordering::Acquire)
    }

    /// The state, for `GET /api/update`.
    pub fn status_json(&self) -> String {
        let sh = lock(&self.shared);
        let done = sh.transfer.done.load(Ordering::Relaxed);
        let received = if sh.phase == Phase::Idle { 0 } else { done };
        let total = if sh.total == 0 { done } else { sh.total };
        json::Object::new()
            .str("state", sh.phase.word())
            .opt_str("tag", sh.tag.as_deref())
            .num("received", received as f64)
            .num(
                "total",
                if sh.phase == Phase::Idle {
                    0.0
                } else {
                    total as f64
                },
            )
            // INSTALLING is also the unpacking and the swapping of files: `ready` is the launcher
            // waiting to be closed (the page closes its window then, not before).
            .bool("ready", sh.finish.is_some())
            .opt_str("error", sh.failure.as_ref().map(|f| f.code))
            .opt_str("message", sh.failure.as_ref().map(|f| f.message.as_str()))
            .opt_str("mode", self.cfg.mode.word())
            .build()
    }

    /// The phase.
    pub fn phase(&self) -> Phase {
        lock(&self.shared).phase
    }

    /// Starts installing `req`. `Err` is the HTTP answer: 400 for a request the feed does not allow,
    /// 409 for a copy that cannot update itself or an update already under way.
    pub fn install(
        self: &Arc<Updater>,
        tag: &str,
        asset_url: &str,
        sums_url: &str,
        size: u64,
    ) -> Result<(), Response> {
        let Some(kind) = self.cfg.mode.kind() else {
            let Mode::Unsupported(why) = self.cfg.mode else {
                unreachable!("only an unsupported copy has no package");
            };
            return Err(Response::error(409, "not-updatable", why));
        };
        let req = feed::check(&self.cfg.feed, kind, tag, asset_url, sums_url, size)
            .map_err(|r| Response::error(400, r.code, &r.message))?;
        if req.size > MAX_PACKAGE {
            return Err(Response::error(
                400,
                "bad-body",
                "size is more than a package weighs",
            ));
        }
        let previous = {
            let mut sh = lock(&self.shared);
            if sh.phase.active() {
                return Err(Response::error(409, "busy", "an update is under way"));
            }
            sh.job += 1;
            sh.phase = Phase::Downloading;
            sh.tag = Some(req.tag.clone());
            sh.total = req.size;
            sh.failure = None;
            sh.finish = None;
            sh.transfer = Arc::new(Transfer::default());
            sh.worker.take()
        };
        // A worker of an earlier attempt has finished or is about to; it never writes after this.
        if let Some(h) = previous {
            let _ = h.join();
        }
        let (job, transfer) = {
            let sh = lock(&self.shared);
            (sh.job, Arc::clone(&sh.transfer))
        };
        let me = Arc::clone(self);
        let handle = std::thread::Builder::new()
            .name("update".into())
            .spawn(move || me.run(&req, job, &transfer))
            .map_err(|e| {
                let mut sh = lock(&self.shared);
                sh.phase = Phase::Failed;
                sh.failure = Some(Failure {
                    code: "install",
                    message: format!("cannot start the update: {e}"),
                });
                Response::error(500, "io", "cannot start the update")
            })?;
        lock(&self.shared).worker = Some(handle);
        Ok(())
    }

    /// Stops a download or a check. `Ok` when nothing is under way too (and clears a failure);
    /// `Err` once the files are being swapped, which cannot be taken back.
    pub fn cancel(&self) -> Result<(), Response> {
        let handle = {
            let mut sh = lock(&self.shared);
            match sh.phase {
                Phase::Idle => return Ok(()),
                Phase::Failed => {
                    sh.phase = Phase::Idle;
                    sh.failure = None;
                    sh.tag = None;
                    return Ok(());
                }
                Phase::Installing => {
                    return Err(Response::error(
                        409,
                        "not-cancellable",
                        "the update is being installed",
                    ))
                }
                Phase::Downloading | Phase::Verifying => {
                    sh.transfer.stop.store(true, Ordering::Relaxed);
                    sh.worker.take()
                }
            }
        };
        if let Some(h) = handle {
            let _ = h.join();
        }
        let mut sh = lock(&self.shared);
        // The worker saw the stop and went to Idle; if it had just finished, leave what it made.
        if sh.phase == Phase::Downloading || sh.phase == Phase::Verifying {
            sh.phase = Phase::Idle;
        }
        Ok(())
    }

    /// Stops what is running (the launcher is ending).
    pub fn shutdown(&self) {
        let handle = {
            let mut sh = lock(&self.shared);
            if matches!(sh.phase, Phase::Downloading | Phase::Verifying) {
                sh.transfer.stop.store(true, Ordering::Relaxed);
            }
            sh.worker.take()
        };
        if let Some(h) = handle {
            let _ = h.join();
        }
    }

    fn set_phase(&self, job: u64, phase: Phase) {
        let mut sh = lock(&self.shared);
        if sh.job == job {
            sh.phase = phase;
        }
    }

    /// The worker: download, check, install; then the state says how it went.
    fn run(&self, req: &feed::Request, job: u64, transfer: &Arc<Transfer>) {
        let result = self.work(req, job, transfer);
        let mut sh = lock(&self.shared);
        if sh.job != job {
            return;
        }
        match result {
            Ok(finish) => {
                crate::log!("update {}: ready, waiting for the window to close", req.tag);
                sh.finish = Some(finish);
                sh.phase = Phase::Installing;
                self.exit.store(true, Ordering::Release);
            }
            Err(Stop::Cancelled) => {
                crate::log!("update {}: cancelled", req.tag);
                sh.phase = Phase::Idle;
                sh.tag = None;
                let _ = std::fs::remove_dir_all(&self.cfg.cache_dir);
            }
            Err(Stop::Failed(f)) => {
                crate::log!("update {}: failed ({}): {}", req.tag, f.code, f.message);
                sh.phase = Phase::Failed;
                sh.failure = Some(f);
                let _ = std::fs::remove_dir_all(&self.cfg.cache_dir);
            }
        }
    }

    fn work(&self, req: &feed::Request, job: u64, t: &Arc<Transfer>) -> Result<Finish, Stop> {
        let cache = &self.cfg.cache_dir;
        let _ = std::fs::remove_dir_all(cache);
        std::fs::create_dir_all(cache).map_err(|e| io_failure("download", cache, &e))?;
        crate::log!("update {}: downloading {}", req.tag, req.asset_name);

        // 1. The checksums: small, and what the package is held to.
        let sums_part = cache.join(format!("{}.part", feed::SUMS_NAME));
        self.download(&req.sums_url, &sums_part, Expect::AtMost(MAX_SUMS), t)?;
        let sums = std::fs::read(&sums_part)
            .ok()
            .and_then(|b| String::from_utf8(b).ok())
            .ok_or_else(|| fail("sums", "SHA256SUMS.txt is not text"))?;
        let _ = std::fs::remove_file(&sums_part);
        let want = feed::sum_for(&sums, &req.asset_name).ok_or_else(|| {
            fail(
                "sums",
                format!("SHA256SUMS.txt has no single sum for {}", req.asset_name),
            )
        })?;

        // 2. The package.
        let part = cache.join(format!("{}.part", req.asset_name));
        self.download(&req.asset_url, &part, Expect::AtMost(MAX_PACKAGE), t)?;
        if std::fs::metadata(&part).map_or(true, |m| m.len() == 0) {
            return Err(fail("download", "the download is empty"));
        }

        // 3. The check.
        self.set_phase(job, Phase::Verifying);
        let got = hash_file(&part, t)?;
        if got != want {
            let _ = std::fs::remove_file(&part);
            return Err(fail(
                "checksum",
                format!(
                    "the SHA-256 of {} is {got}, but SHA256SUMS.txt says {want}: nothing was installed",
                    req.asset_name
                ),
            ));
        }
        let file = cache.join(&req.asset_name);
        std::fs::rename(&part, &file).map_err(|e| io_failure("install", &file, &e))?;

        // 4. Ready for what this kind of copy does.
        self.set_phase(job, Phase::Installing);
        match self.cfg.mode {
            Mode::Installed => Ok(Finish::Installer { setup: file }),
            Mode::Portable(kind) => {
                let dest = self.cfg.exe_dir.join(portable::update_dir_name(&req.tag));
                let _ = std::fs::remove_dir_all(&dest);
                let step = |what: &'static str, r: Result<(), String>| {
                    r.map_err(|m| fail(failure_code(&m, what), m))
                };
                step(
                    "extract",
                    portable::extract(kind, &file, &dest, self.cfg.tar.as_deref()),
                )?;
                let root = portable::package_root(&dest, kind.exe_name()).map_err(|m| {
                    let _ = std::fs::remove_dir_all(&dest);
                    fail("extract", m)
                })?;
                let exe = portable::apply(&self.cfg.exe_dir, &root, kind.exe_name(), &req.tag)
                    .map_err(|m| {
                        let _ = std::fs::remove_dir_all(&dest);
                        fail(failure_code(&m, "install"), m)
                    })?;
                let _ = std::fs::remove_dir_all(&dest);
                let _ = std::fs::remove_dir_all(cache);
                Ok(Finish::Relaunch { exe })
            }
            Mode::Unsupported(why) => Err(fail("install", why)),
        }
    }

    /// One download with resuming: a cut connection continues from the bytes already there.
    fn download(
        &self,
        url: &str,
        part: &Path,
        expect: Expect,
        t: &Arc<Transfer>,
    ) -> Result<(), Stop> {
        for attempt in 1..=ATTEMPTS {
            match download::fetch_to(&self.cfg.downloader, url, part, expect, t) {
                Outcome::Complete => return Ok(()),
                Outcome::Stopped => return Err(Stop::Cancelled),
                Outcome::Failed { message, code } => {
                    if code == Some(download::CANNOT_RESUME) {
                        let _ = std::fs::remove_file(part);
                    }
                    let again = download::transient(code) || code == Some(download::CANNOT_RESUME);
                    if attempt < ATTEMPTS && again {
                        // A pause the person can cut short.
                        for _ in 0..10 {
                            if t.stop.load(Ordering::Relaxed) {
                                return Err(Stop::Cancelled);
                            }
                            std::thread::sleep(Duration::from_millis(100));
                        }
                        continue;
                    }
                    return Err(fail(failure_code(&message, "download"), message));
                }
            }
        }
        Err(fail("download", "the download did not finish"))
    }

    /// What starts now that the launcher has stopped: the installer, or the new version. Does
    /// nothing when no update is ready. The program that starts is detached from this process.
    pub fn finish(&self) {
        let finish = lock(&self.shared).finish.take();
        match finish {
            None => {}
            Some(Finish::Installer { setup }) => {
                let args = INSTALLER_ARGS.map(OsString::from);
                match crate::process::spawn_detached(&setup, &args, setup.parent(), false) {
                    Ok(child) => crate::log!("update: the installer started (pid {})", child.id()),
                    Err(e) => crate::log!("update: cannot start {}: {e}", setup.display()),
                }
            }
            Some(Finish::Relaunch { exe }) => {
                let mut args: Vec<OsString> = self
                    .cfg
                    .args
                    .iter()
                    .filter(|a| *a != "--after-update")
                    .cloned()
                    .collect();
                args.push(OsString::from("--after-update"));
                match crate::process::spawn_detached(&exe, &args, Some(&self.cfg.exe_dir), true) {
                    Ok(child) => {
                        crate::log!("update: the new version started (pid {})", child.id());
                    }
                    Err(e) => crate::log!("update: cannot start {}: {e}", exe.display()),
                }
            }
        }
    }
}

/// `disk-full` when the message says there is no room, else `otherwise`.
fn failure_code(message: &str, otherwise: &'static str) -> &'static str {
    let m = message.to_ascii_lowercase();
    let full = [
        "no space left",
        "not enough space",
        "os error 28",
        "os error 112",
        "disk full",
    ];
    if full.iter().any(|f| m.contains(f)) {
        "disk-full"
    } else {
        otherwise
    }
}

fn io_failure(code: &'static str, path: &Path, e: &std::io::Error) -> Stop {
    let message = format!("{}: {e}", path.display());
    let code = if e.kind() == std::io::ErrorKind::StorageFull {
        "disk-full"
    } else {
        code
    };
    fail(code, message)
}

/// The SHA-256 of a file, lower case; stops when the transfer is stopped.
fn hash_file(path: &Path, t: &Arc<Transfer>) -> Result<String, Stop> {
    let mut file = std::fs::File::open(path).map_err(|e| io_failure("install", path, &e))?;
    let mut sha = Sha256::new();
    let mut buf = vec![0u8; 1 << 20];
    loop {
        if t.stop.load(Ordering::Relaxed) {
            return Err(Stop::Cancelled);
        }
        match file.read(&mut buf) {
            Ok(0) => return Ok(hex(&sha.finish())),
            Ok(n) => sha.update(&buf[..n]),
            Err(e) if e.kind() == std::io::ErrorKind::Interrupted => {}
            Err(e) => return Err(io_failure("install", path, &e)),
        }
    }
}

/// Removes what an earlier update left (the `.old` files, the `update-*` folders, the downloaded
/// package), at the start of the launcher and again for a few seconds: on Windows the old
/// executable may still be running for a moment after the new one starts.
pub fn start_cleanup(exe_dir: PathBuf, cache_dir: PathBuf) {
    let _ = std::thread::Builder::new()
        .name("update-cleanup".into())
        .spawn(move || {
            for _ in 0..30 {
                let cleaned = portable::cleanup(&exe_dir);
                let _ = std::fs::remove_dir_all(&cache_dir);
                if !cleaned.removed.is_empty() {
                    crate::log!("update: removed {}", cleaned.removed.join(", "));
                }
                if cleaned.kept.is_empty() {
                    return;
                }
                std::thread::sleep(Duration::from_secs(1));
            }
            crate::log!("update: could not remove the old files yet; the next start tries again");
        });
}

/// `/api/update`, `/api/update/install` and `/api/update/cancel`.
pub fn route(
    up: &Arc<Updater>,
    req: &HttpRequest,
    parts: &[&str],
    body: &mut dyn Read,
) -> Option<Response> {
    let rest = match parts {
        ["update", rest @ ..] => rest,
        _ => return None,
    };
    let status = || Response::json(200, up.status_json());
    Some(match (req.method.as_str(), rest) {
        ("GET", []) => status(),
        ("POST", ["install"]) => {
            let v = match crate::server::read_json(req, body) {
                Ok(v) => v,
                Err(r) => return Some(r),
            };
            let text = |k: &str| v.get(k).and_then(Value::as_str);
            let (Some(tag), Some(asset), Some(sums)) =
                (text("tag"), text("assetUrl"), text("sumsUrl"))
            else {
                return Some(Response::error(
                    400,
                    "bad-body",
                    "expected {\"tag\", \"assetUrl\", \"sumsUrl\"}",
                ));
            };
            let size = v.get("size").and_then(Value::as_f64).unwrap_or(0.0);
            if !(0.0..=(MAX_PACKAGE as f64)).contains(&size) {
                return Some(Response::error(400, "bad-body", "size"));
            }
            match up.install(tag, asset, sums, size as u64) {
                Ok(()) => Response::json(202, up.status_json()),
                Err(r) => r,
            }
        }
        ("POST", ["cancel"]) => match up.cancel() {
            Ok(()) => status(),
            Err(r) => r,
        },
        (_, [] | ["install" | "cancel"]) => Response::error(405, "method", "method not allowed"),
        _ => Response::error(404, "not-found", "no such endpoint"),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_mode_follows_what_the_copy_is() {
        assert_eq!(
            Mode::of("windows", "x86_64", true, false),
            Mode::Portable(Kind::WindowsPortable)
        );
        assert_eq!(
            Mode::of("windows", "x86_64", true, true),
            Mode::Portable(Kind::WindowsPortable)
        );
        assert_eq!(
            Mode::of("linux", "x86_64", true, false),
            Mode::Portable(Kind::LinuxPortable)
        );
        assert_eq!(Mode::of("windows", "x86_64", false, true), Mode::Installed);
        for (os, arch, portable, uninstaller) in [
            // Neither installed nor portable.
            ("windows", "x86_64", false, false),
            ("linux", "x86_64", false, false),
            ("linux", "x86_64", false, true),
            // Another processor or system: there is no package.
            ("windows", "aarch64", true, false),
            ("linux", "aarch64", true, false),
            ("macos", "x86_64", true, false),
            ("macos", "aarch64", false, false),
        ] {
            assert!(
                matches!(
                    Mode::of(os, arch, portable, uninstaller),
                    Mode::Unsupported(_)
                ),
                "{os} {arch} {portable} {uninstaller}"
            );
        }
        assert_eq!(Mode::Installed.kind(), Some(Kind::Setup));
        assert_eq!(
            Mode::Portable(Kind::LinuxPortable).kind(),
            Some(Kind::LinuxPortable)
        );
        assert_eq!(Mode::Unsupported("x").kind(), None);
    }

    #[test]
    fn full_disks_are_told_from_other_failures() {
        assert_eq!(
            failure_code("No space left on device (os error 28)", "download"),
            "disk-full"
        );
        assert_eq!(
            failure_code(
                "There is not enough space on the disk. (os error 112)",
                "install"
            ),
            "disk-full"
        );
        assert_eq!(failure_code("curl 22", "download"), "download");
    }

    #[test]
    fn the_embedded_feed_is_the_one_the_application_checks() {
        // The launcher and the page name the same repository, because one reads the other's file.
        let source = include_str!("../../../../../src/data/update-feed.ts");
        let f = Feed::embedded();
        assert!(source.contains(&format!("owner: '{}'", f.owner)));
        assert!(source.contains(&format!("repo: '{}'", f.repo)));
    }
}
