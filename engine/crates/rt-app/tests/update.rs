//! Updating from inside the application (phase P5) over real sockets: the launcher's
//! `/api/update/*` against a local server that stands in for GitHub's release downloads, with the
//! system's real `curl` and `tar`. The whitelist (only the feed's `releases/download/` URLs), the
//! SHA-256 check (a package that does not match installs nothing), the portable self-replacement
//! of an application folder (new files in, `.old` beside them, `data/` and `portable.txt`
//! untouched, the new executable started with `--after-update`), the installer's silent start, the
//! clean-up at the next start, cancelling, resuming a cut download.
//!
//! The test server is built with `server::Options::update`, which only a test can set: the
//! application always starts with the real feed (`github.com`), so nothing here touches the network.

mod common;

use common::{temp_dir, TestServer};
use rt_app::ai::download::Downloader;
use rt_app::ai::zip;
use rt_app::json::{self, Value};
use rt_app::server::Options;
use rt_app::sha256::{hex, Sha256};
use rt_app::update::feed::{Feed, Kind};
use rt_app::update::{portable, Config, Mode};
use std::collections::{HashMap, HashSet};
use std::io::{BufReader, BufWriter, Write};
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

const TAG: &str = "0.2.0";
const OWNER: &str = "Grohle-developer";
const REPO: &str = "Repackshot";

fn sha(data: &[u8]) -> String {
    hex(&Sha256::digest(data))
}

fn tool(name: &str) -> Option<PathBuf> {
    std::env::var_os("PATH").and_then(|paths| {
        std::env::split_paths(&paths)
            .map(|d| d.join(name))
            .find(|p| p.is_file())
    })
}

/// The tests need the system's `curl` (and `tar` for the Linux package), as the application does.
fn have_tools() -> bool {
    let ok = Downloader::system().program.is_some() && tool("tar").is_some();
    if !ok {
        eprintln!("no curl or tar on this computer: update tests skipped");
    }
    ok
}

// ------------------------------------------------------------------ the stand-in for GitHub

/// Serves files under `/<owner>/<repo>/releases/download/…`, with `Range` for resuming. It can be
/// slow (`throttle`, per 64 KiB), and it can cut a download once, halfway.
/// What was asked of the server: the path and the `Range` header.
type Requests = Arc<Mutex<Vec<(String, Option<String>)>>>;

struct Releases {
    port: u16,
    files: Arc<Mutex<HashMap<String, Vec<u8>>>>,
    requests: Requests,
    throttle_ms: Arc<AtomicU64>,
    cut_once: Arc<Mutex<HashSet<String>>>,
    stop: Arc<AtomicBool>,
}

impl Releases {
    fn start() -> Releases {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let files: Arc<Mutex<HashMap<String, Vec<u8>>>> = Arc::default();
        let requests: Requests = Arc::default();
        let throttle_ms = Arc::new(AtomicU64::new(0));
        let cut_once: Arc<Mutex<HashSet<String>>> = Arc::default();
        let stop = Arc::new(AtomicBool::new(false));
        let (f, r, th, cut, s) = (
            Arc::clone(&files),
            Arc::clone(&requests),
            Arc::clone(&throttle_ms),
            Arc::clone(&cut_once),
            Arc::clone(&stop),
        );
        std::thread::spawn(move || {
            for stream in listener.incoming().flatten() {
                if s.load(Ordering::Relaxed) {
                    break;
                }
                let (f, r, th, cut) = (
                    Arc::clone(&f),
                    Arc::clone(&r),
                    Arc::clone(&th),
                    Arc::clone(&cut),
                );
                std::thread::spawn(move || {
                    let mut reader = BufReader::new(stream.try_clone().unwrap());
                    let Ok(req) = rt_app::http::read_request(&mut reader) else {
                        return;
                    };
                    let range = req.header("range").map(str::to_string);
                    r.lock().unwrap().push((req.path.clone(), range.clone()));
                    let mut w = BufWriter::new(stream);
                    let Some(bytes) = f.lock().unwrap().get(&req.path).cloned() else {
                        let _ = w.write_all(
                            b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                        );
                        return;
                    };
                    let start: usize = range
                        .as_deref()
                        .and_then(|v| v.strip_prefix("bytes="))
                        .and_then(|v| v.strip_suffix('-'))
                        .and_then(|v| v.parse().ok())
                        .unwrap_or(0);
                    let head = if range.is_some() {
                        format!(
                            "HTTP/1.1 206 Partial Content\r\nContent-Length: {}\r\nContent-Range: bytes {start}-{}/{}\r\nConnection: close\r\n\r\n",
                            bytes.len() - start,
                            bytes.len() - 1,
                            bytes.len()
                        )
                    } else {
                        format!(
                            "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                            bytes.len()
                        )
                    };
                    let _ = w.write_all(head.as_bytes());
                    // The first whole download of a file that was asked to be cut stops halfway.
                    let end = if range.is_none() && cut.lock().unwrap().remove(&req.path) {
                        start + (bytes.len() - start) / 2
                    } else {
                        bytes.len()
                    };
                    for piece in bytes[start..end].chunks(64 << 10) {
                        if w.write_all(piece).and_then(|_| w.flush()).is_err() {
                            return;
                        }
                        let ms = th.load(Ordering::Relaxed);
                        if ms > 0 {
                            std::thread::sleep(Duration::from_millis(ms));
                        }
                    }
                });
            }
        });
        Releases {
            port,
            files,
            requests,
            throttle_ms,
            cut_once,
            stop,
        }
    }

    fn origin(&self) -> String {
        format!("http://127.0.0.1:{}", self.port)
    }

    fn path(tag: &str, file: &str) -> String {
        format!("/{OWNER}/{REPO}/releases/download/v{tag}/{file}")
    }

    fn url(&self, file: &str) -> String {
        format!("{}{}", self.origin(), Releases::path(TAG, file))
    }

    fn put(&self, file: &str, bytes: Vec<u8>) {
        self.files
            .lock()
            .unwrap()
            .insert(Releases::path(TAG, file), bytes);
    }

    fn asked(&self) -> Vec<String> {
        self.requests
            .lock()
            .unwrap()
            .iter()
            .map(|(p, _)| p.clone())
            .collect()
    }

    fn ranges(&self) -> Vec<Option<String>> {
        self.requests
            .lock()
            .unwrap()
            .iter()
            .map(|(_, r)| r.clone())
            .collect()
    }
}

impl Drop for Releases {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        let _ = std::net::TcpStream::connect(("127.0.0.1", self.port));
    }
}

// ------------------------------------------------------------------ an application folder and a package

fn write(path: &Path, text: &str) {
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, text).unwrap();
}

fn read(path: &Path) -> String {
    std::fs::read_to_string(path).unwrap_or_else(|e| panic!("{}: {e}", path.display()))
}

#[cfg(unix)]
fn make_executable(path: &Path) {
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755)).unwrap();
}
#[cfg(not(unix))]
fn make_executable(_: &Path) {}

/// The executable of the new version: it writes the arguments it got beside itself.
const NEW_EXE: &str = "#!/bin/sh\necho \"$@\" > \"$(dirname \"$0\")/started.txt\"\n";

/// The files of version 0.2.0's package, under `Repackshot-0.2.0/`, as (name, text, executable).
fn package_files(exe: &str) -> Vec<(String, String, bool)> {
    let top = format!("Repackshot-{TAG}");
    vec![
        (format!("{top}/{exe}"), NEW_EXE.into(), true),
        (format!("{top}/app/index.html"), "new ui".into(), false),
        (
            format!("{top}/app/assets/new-only.js"),
            "new chunk".into(),
            false,
        ),
        (
            format!("{top}/portable.txt"),
            "the package's mark".into(),
            false,
        ),
        (format!("{top}/LICENSE"), "new licence".into(), false),
    ]
}

fn zip_of(files: &[(String, String, bool)]) -> Vec<u8> {
    let entries: Vec<(&str, &[u8], u32)> = files
        .iter()
        .map(|(n, t, x)| {
            (
                n.as_str(),
                t.as_bytes(),
                if *x { 0o100755 } else { 0o100644 },
            )
        })
        .collect();
    zip::write_stored(&entries, false)
}

fn targz_of(files: &[(String, String, bool)]) -> Vec<u8> {
    let stage = temp_dir("update-targz");
    for (name, text, exec) in files {
        write(&stage.join(name), text);
        if *exec {
            make_executable(&stage.join(name));
        }
    }
    let out = stage.join("package.tar.gz");
    let ran = std::process::Command::new(tool("tar").unwrap())
        .arg("-czf")
        .arg(&out)
        .arg("-C")
        .arg(&stage)
        .arg(format!("Repackshot-{TAG}"))
        .status()
        .unwrap();
    assert!(ran.success());
    std::fs::read(&out).unwrap()
}

/// `n` bytes of text that does not compress much (an archive worth waiting for).
fn noise(n: usize) -> String {
    let mut x = 12345u32;
    (0..n)
        .map(|_| {
            x = x.wrapping_mul(1_103_515_245).wrapping_add(12345);
            char::from(b' ' + ((x >> 16) % 95) as u8)
        })
        .collect()
}

struct Fixture {
    server: TestServer,
    releases: Releases,
    /// The application folder being updated.
    app: PathBuf,
    kind: Kind,
}

impl Fixture {
    /// An application folder of "version 0.1.0", an updater in `mode`, and the release 0.2.0 on the
    /// local server (the package for `kind`, its sums; `package` and `sum` can be replaced).
    fn start(name: &str, mode: Mode) -> Fixture {
        let releases = Releases::start();
        let app = temp_dir(&format!("{name}-folder")).join("Repackshot");
        let exe = if matches!(mode, Mode::Portable(Kind::WindowsPortable)) {
            "repackshot.exe"
        } else {
            "repackshot"
        };
        write(&app.join(exe), "old exe");
        write(&app.join("app/index.html"), "old ui");
        write(&app.join("app/assets/old-only.js"), "old chunk");
        write(&app.join("LICENSE"), "old licence");
        write(&app.join("portable.txt"), "mine");
        write(&app.join("data/settings.json"), "{\"mine\":true}");
        // The data folder's cache is the application's own: the download goes in it and leaves it empty.
        std::fs::create_dir_all(app.join("data/cache")).unwrap();
        let kind = mode.kind().unwrap_or(Kind::LinuxPortable);
        let cfg = Config {
            feed: Feed {
                origin: releases.origin(),
                owner: OWNER.into(),
                repo: REPO.into(),
            },
            downloader: Downloader {
                allow_http: true,
                ..Downloader::system()
            },
            mode,
            exe_dir: app.clone(),
            cache_dir: app.join("data/cache/update"),
            args: vec!["--serve-only".into(), "--port".into(), "4455".into()],
            tar: tool("tar"),
        };
        let server = TestServer::start_with_options(
            name,
            1,
            Options {
                update: Some(cfg),
                ..Options::default()
            },
            |_| {},
        );
        Fixture {
            server,
            releases,
            app,
            kind,
        }
    }

    fn package_name(&self) -> String {
        self.kind.package_name(TAG)
    }

    /// Publishes `package` and the sums that list it (or `sum`, to publish a wrong one).
    fn publish(&self, package: Vec<u8>, sum: Option<String>) {
        let name = self.package_name();
        let sums = format!(
            "{}  {name}\n{}  Other-file.zip\n",
            sum.unwrap_or_else(|| sha(&package)),
            "e".repeat(64)
        );
        self.releases.put(&name, package);
        self.releases.put("SHA256SUMS.txt", sums.into_bytes());
    }

    fn publish_portable(&self) {
        let exe = self.kind.exe_name();
        let files = package_files(exe);
        self.publish(
            if self.kind == Kind::WindowsPortable {
                zip_of(&files)
            } else {
                targz_of(&files)
            },
            None,
        );
    }

    fn body(&self, size: Option<u64>) -> String {
        let mut o = json::Object::new()
            .str("tag", &format!("v{TAG}"))
            .str("assetUrl", &self.releases.url(&self.package_name()))
            .str("sumsUrl", &self.releases.url("SHA256SUMS.txt"));
        if let Some(n) = size {
            o = o.num("size", n as f64);
        }
        o.build()
    }

    fn install(&self, body: &str) -> rt_app::client::Reply {
        self.server
            .api("POST", "/api/update/install", body.as_bytes())
    }

    fn status(&self) -> Value {
        self.server.json("GET", "/api/update", b"")
    }

    /// Follows `GET /api/update` until `done(state)`; the last answer.
    fn wait(&self, what: &str, done: impl Fn(&str) -> bool) -> Value {
        let start = Instant::now();
        loop {
            let v = self.status();
            if done(state(&v)) {
                return v;
            }
            assert!(
                start.elapsed() < Duration::from_secs(60),
                "{what}: still {}",
                v.to_json()
            );
            std::thread::sleep(Duration::from_millis(20));
        }
    }

    /// Until the update failed, was cancelled, or is ready: installed, waiting for the window to close.
    fn wait_end(&self) -> Value {
        let start = Instant::now();
        loop {
            let v = self.status();
            let ready = v.get("ready").and_then(Value::as_bool) == Some(true);
            if matches!(state(&v), "FAILED" | "IDLE") || (state(&v) == "INSTALLING" && ready) {
                return v;
            }
            assert!(
                start.elapsed() < Duration::from_secs(60),
                "the update never ended: {}",
                v.to_json()
            );
            std::thread::sleep(Duration::from_millis(20));
        }
    }
}

fn state(v: &Value) -> &str {
    v.get("state").unwrap().as_str().unwrap()
}

fn text<'a>(v: &'a Value, key: &str) -> Option<&'a str> {
    v.get(key).and_then(Value::as_str)
}

/// Every file under `dir` as (relative path, content), sorted.
fn snapshot(dir: &Path) -> Vec<(String, String)> {
    fn walk(base: &Path, dir: &Path, out: &mut Vec<(String, String)>) {
        for e in std::fs::read_dir(dir).unwrap().flatten() {
            let path = e.path();
            let rel = path
                .strip_prefix(base)
                .unwrap()
                .to_string_lossy()
                .into_owned();
            if path.is_dir() {
                out.push((format!("{rel}/"), String::new()));
                walk(base, &path, out);
            } else {
                out.push((rel, std::fs::read_to_string(&path).unwrap_or_default()));
            }
        }
    }
    let mut out = Vec::new();
    walk(dir, dir, &mut out);
    out.sort();
    out
}

fn wait_for_file(path: &Path) -> String {
    let start = Instant::now();
    while !path.exists() {
        assert!(
            start.elapsed() < Duration::from_secs(20),
            "{} never appeared",
            path.display()
        );
        std::thread::sleep(Duration::from_millis(20));
    }
    // The shell that writes it may not have finished.
    std::thread::sleep(Duration::from_millis(100));
    read(path)
}

// ------------------------------------------------------------------ portable, end to end

fn portable_end_to_end(mode: Mode, name: &str) {
    if !have_tools() {
        return;
    }
    let f = Fixture::start(name, mode);
    let exe = f.kind.exe_name();
    f.publish_portable();
    let size = f.releases.files.lock().unwrap()[&Releases::path(TAG, &f.package_name())].len();

    let r = f.install(&f.body(Some(size as u64)));
    assert_eq!(r.status, 202, "{}", r.text());
    let v = f.wait_end();
    assert_eq!(state(&v), "INSTALLING", "{}", v.to_json());
    assert_eq!(text(&v, "tag"), Some(TAG));
    assert_eq!(text(&v, "mode"), Some("portable"));
    assert!(v.get("error").unwrap().is_null());
    assert_eq!(v.get("received").unwrap().as_f64(), Some(size as f64));
    assert_eq!(v.get("total").unwrap().as_f64(), Some(size as f64));
    // The sums first, then the package.
    assert_eq!(
        f.releases.asked(),
        [
            Releases::path(TAG, "SHA256SUMS.txt"),
            Releases::path(TAG, &f.package_name())
        ]
    );

    // The new files are in place, the old ones beside them, the person's things untouched.
    assert_eq!(read(&f.app.join(exe)), NEW_EXE);
    assert_eq!(read(&f.app.join("app/index.html")), "new ui");
    assert_eq!(read(&f.app.join("app/assets/new-only.js")), "new chunk");
    assert!(!f.app.join("app/assets/old-only.js").exists());
    assert_eq!(read(&f.app.join("LICENSE")), "new licence");
    assert_eq!(read(&f.app.join(portable::old_name(exe))), "old exe");
    assert_eq!(read(&f.app.join("app.old/index.html")), "old ui");
    assert_eq!(read(&f.app.join("LICENSE.old")), "old licence");
    assert_eq!(read(&f.app.join("data/settings.json")), "{\"mine\":true}");
    assert_eq!(read(&f.app.join("portable.txt")), "mine");
    // The unpacked package and the download are gone.
    assert!(!f.app.join(format!("update-{TAG}")).exists());
    assert!(!f.app.join("data/cache/update").exists());
    assert!(
        !f.app.join("started.txt").exists(),
        "nothing starts before the launcher stops"
    );

    // The launcher stops, then the new version starts, detached, with the old arguments and --after-update.
    assert!(f.server.server.app.update.exit_requested());
    f.server.server.app.update.finish();
    let started = wait_for_file(&f.app.join("started.txt"));
    assert_eq!(started.trim(), "--serve-only --port 4455 --after-update");
    // Finishing twice starts nothing twice.
    std::fs::remove_file(f.app.join("started.txt")).unwrap();
    f.server.server.app.update.finish();
    std::thread::sleep(Duration::from_millis(300));
    assert!(!f.app.join("started.txt").exists());

    // The next start (the new version) deletes the old files and the update folders.
    let cleaned = portable::cleanup(&f.app);
    assert!(cleaned.kept.is_empty());
    assert!(cleaned.removed.contains(&portable::old_name(exe)));
    assert!(cleaned.removed.contains(&"app.old".to_string()));
    assert!(!f.app.join("app.old").exists());
    assert!(!f.app.join(portable::old_name(exe)).exists());
    assert!(!f.app.join("update.json").exists());
    assert_eq!(read(&f.app.join(exe)), NEW_EXE);
    assert_eq!(read(&f.app.join("data/settings.json")), "{\"mine\":true}");
}

#[test]
fn a_linux_portable_copy_updates_itself_from_a_tar_gz() {
    portable_end_to_end(Mode::Portable(Kind::LinuxPortable), "update-linux");
}

#[test]
fn a_windows_portable_copy_updates_itself_from_a_zip() {
    // The same swap, with the Windows package's names, on whatever system the tests run.
    portable_end_to_end(Mode::Portable(Kind::WindowsPortable), "update-windows-zip");
}

#[test]
fn nothing_starts_before_the_launcher_has_stopped() {
    // `finish` is what the launcher calls once the server and the window are gone: until then
    // nothing starts, however ready the update is.
    if !have_tools() {
        return;
    }
    let f = Fixture::start("update-finish-late", Mode::Portable(Kind::LinuxPortable));
    f.publish_portable();
    assert_eq!(f.install(&f.body(None)).status, 202);
    assert_eq!(state(&f.wait_end()), "INSTALLING");
    std::thread::sleep(Duration::from_millis(500));
    assert!(!f.app.join("started.txt").exists());
}

// ------------------------------------------------------------------ the sum

#[test]
fn a_package_that_does_not_match_its_sum_installs_nothing() {
    if !have_tools() {
        return;
    }
    let f = Fixture::start("update-bad-sum", Mode::Portable(Kind::LinuxPortable));
    let before = snapshot(&f.app);
    let package = targz_of(&package_files("repackshot"));
    // The sums list another file's hash for it.
    f.publish(package, Some(sha(b"something else")));
    assert_eq!(f.install(&f.body(None)).status, 202);
    let v = f.wait_end();
    assert_eq!(state(&v), "FAILED", "{}", v.to_json());
    assert_eq!(text(&v, "error"), Some("checksum"));
    assert!(text(&v, "message")
        .unwrap()
        .contains("nothing was installed"));
    // Nothing moved, nothing was unpacked, nothing is left to start.
    assert_eq!(snapshot(&f.app), before);
    assert!(!f.server.server.app.update.exit_requested());
    f.server.server.app.update.finish();
    std::thread::sleep(Duration::from_millis(300));
    assert!(!f.app.join("started.txt").exists());
    // A failure can be tried again (and cleared with cancel).
    f.publish_portable();
    assert_eq!(f.install(&f.body(None)).status, 202);
    assert_eq!(state(&f.wait_end()), "INSTALLING");
}

#[test]
fn a_package_the_sums_do_not_list_installs_nothing() {
    if !have_tools() {
        return;
    }
    let f = Fixture::start("update-unlisted", Mode::Portable(Kind::LinuxPortable));
    let before = snapshot(&f.app);
    f.releases
        .put(&f.package_name(), targz_of(&package_files("repackshot")));
    f.releases.put(
        "SHA256SUMS.txt",
        format!("{}  Other-file.zip\n", "a".repeat(64)).into_bytes(),
    );
    assert_eq!(f.install(&f.body(None)).status, 202);
    let v = f.wait_end();
    assert_eq!((state(&v), text(&v, "error")), ("FAILED", Some("sums")));
    assert_eq!(snapshot(&f.app), before);
    // The package itself was never downloaded: the sums said enough.
    assert_eq!(f.releases.asked(), [Releases::path(TAG, "SHA256SUMS.txt")]);
}

#[test]
fn a_release_without_its_files_fails_in_words() {
    if !have_tools() {
        return;
    }
    let f = Fixture::start("update-404", Mode::Portable(Kind::LinuxPortable));
    let before = snapshot(&f.app);
    assert_eq!(f.install(&f.body(None)).status, 202);
    let v = f.wait_end();
    assert_eq!((state(&v), text(&v, "error")), ("FAILED", Some("download")));
    assert!(
        text(&v, "message").unwrap().contains("error"),
        "{}",
        v.to_json()
    );
    assert_eq!(snapshot(&f.app), before);
}

// ------------------------------------------------------------------ a package that is not one

#[test]
fn a_package_that_is_not_the_application_changes_nothing() {
    if !have_tools() {
        return;
    }
    // No interface inside; an archive that climbs out of its folder; a link; not an archive at all.
    let no_ui = vec![(
        "Repackshot-0.2.0/repackshot".to_string(),
        NEW_EXE.to_string(),
        true,
    )];
    let climbing = zip_of(&[("../outside.txt".to_string(), "x".into(), false)]);
    for (name, mode, package) in [
        (
            "update-no-ui-tar",
            Mode::Portable(Kind::LinuxPortable),
            targz_of(&no_ui),
        ),
        (
            "update-no-ui-zip",
            Mode::Portable(Kind::WindowsPortable),
            zip_of(&no_ui),
        ),
        (
            "update-climbing-zip",
            Mode::Portable(Kind::WindowsPortable),
            climbing,
        ),
        (
            "update-garbage-tar",
            Mode::Portable(Kind::LinuxPortable),
            b"not an archive".to_vec(),
        ),
        (
            "update-garbage-zip",
            Mode::Portable(Kind::WindowsPortable),
            b"not an archive".to_vec(),
        ),
    ] {
        let f = Fixture::start(name, mode);
        let before = snapshot(&f.app);
        f.publish(package, None);
        assert_eq!(f.install(&f.body(None)).status, 202);
        let v = f.wait_end();
        assert_eq!(
            (state(&v), text(&v, "error")),
            ("FAILED", Some("extract")),
            "{name}: {}",
            v.to_json()
        );
        assert_eq!(snapshot(&f.app), before, "{name}");
        assert!(
            !f.app.parent().unwrap().join("outside.txt").exists(),
            "{name}"
        );
    }
}

#[cfg(unix)]
#[test]
fn a_tar_with_a_link_inside_is_refused() {
    if !have_tools() {
        return;
    }
    let f = Fixture::start("update-tar-link", Mode::Portable(Kind::LinuxPortable));
    let before = snapshot(&f.app);
    let stage = temp_dir("update-tar-link-stage");
    for (name, text, exec) in package_files("repackshot") {
        write(&stage.join(&name), &text);
        if exec {
            make_executable(&stage.join(&name));
        }
    }
    std::os::unix::fs::symlink("/etc/passwd", stage.join("Repackshot-0.2.0/app/link")).unwrap();
    let out = stage.join("p.tar.gz");
    assert!(std::process::Command::new(tool("tar").unwrap())
        .arg("-czf")
        .arg(&out)
        .arg("-C")
        .arg(&stage)
        .arg("Repackshot-0.2.0")
        .status()
        .unwrap()
        .success());
    f.publish(std::fs::read(&out).unwrap(), None);
    assert_eq!(f.install(&f.body(None)).status, 202);
    let v = f.wait_end();
    assert_eq!(
        (state(&v), text(&v, "error")),
        ("FAILED", Some("extract")),
        "{}",
        v.to_json()
    );
    assert!(
        text(&v, "message").unwrap().contains("not a file"),
        "{}",
        v.to_json()
    );
    assert_eq!(snapshot(&f.app), before);
}

// ------------------------------------------------------------------ the installer

#[cfg(unix)]
#[test]
fn an_installed_copy_starts_the_verified_installer_silently_when_the_launcher_has_stopped() {
    if !have_tools() {
        return;
    }
    let f = Fixture::start("update-installer", Mode::Installed);
    let before = snapshot(&f.app);
    // The "installer" writes what it was started with; the real one is NSIS (it does not run here).
    let setup = "#!/bin/sh\necho \"$@\" > \"$(dirname \"$0\")/installer-ran.txt\"\n";
    f.publish(setup.as_bytes().to_vec(), None);
    assert_eq!(
        f.package_name(),
        format!("Repackshot-{TAG}-windows-x64-setup.exe")
    );
    assert_eq!(f.install(&f.body(None)).status, 202);
    let v = f.wait_end();
    assert_eq!(state(&v), "INSTALLING", "{}", v.to_json());
    assert_eq!(text(&v, "mode"), Some("installer"));
    // The application's own folder is not touched (the installer does that, once this has stopped):
    // the verified installer is in the cache and nothing else is.
    let after: Vec<_> = snapshot(&f.app)
        .into_iter()
        .filter(|(p, _)| !p.starts_with("data/cache/update"))
        .collect();
    assert_eq!(after, before);
    let cached: Vec<_> = std::fs::read_dir(f.app.join("data/cache/update"))
        .unwrap()
        .flatten()
        .map(|e| e.file_name().into_string().unwrap())
        .collect();
    assert_eq!(cached, [f.package_name()]);
    assert!(f.server.server.app.update.exit_requested());
    let kept = f.app.join("data/cache/update").join(f.package_name());
    assert_eq!(read(&kept), setup);
    assert!(!kept.with_file_name("installer-ran.txt").exists());
    make_executable(&kept);
    f.server.server.app.update.finish();
    let ran = wait_for_file(&kept.with_file_name("installer-ran.txt"));
    assert_eq!(ran.trim(), "/S /LAUNCH");
}

// ------------------------------------------------------------------ the whitelist

#[test]
fn only_the_feeds_release_downloads_are_accepted() {
    if !have_tools() {
        return;
    }
    let f = Fixture::start("update-whitelist", Mode::Portable(Kind::LinuxPortable));
    let name = f.package_name();
    let sums = f.releases.url("SHA256SUMS.txt");
    let ask = |asset: &str, sums: &str, tag: &str| {
        let body = json::Object::new()
            .str("tag", tag)
            .str("assetUrl", asset)
            .str("sumsUrl", sums)
            .build();
        let r = f.install(&body);
        (
            r.status,
            text(&json::parse(&r.text()).unwrap(), "error").map(str::to_string),
        )
    };
    let base = format!(
        "{}/{OWNER}/{REPO}/releases/download/v{TAG}",
        f.releases.origin()
    );
    let bad_url = |what: &str, asset: String, sums: &str| {
        assert_eq!(
            ask(&asset, sums, TAG),
            (400, Some("bad-url".into())),
            "{what}: {asset}"
        );
    };
    bad_url(
        "another host",
        format!("http://127.0.0.2:1/{OWNER}/{REPO}/releases/download/v{TAG}/{name}"),
        &sums,
    );
    bad_url(
        "github itself, but not this feed",
        format!("https://github.com/{OWNER}/{REPO}/releases/download/v{TAG}/{name}"),
        &sums,
    );
    bad_url(
        "another repository",
        format!(
            "{}/{OWNER}/Other/releases/download/v{TAG}/{name}",
            f.releases.origin()
        ),
        &sums,
    );
    bad_url("a query", format!("{base}/{name}?x=1"), &sums);
    bad_url("climbing", format!("{base}/../v{TAG}/{name}"), &sums);
    bad_url(
        "another version",
        format!(
            "{}/{OWNER}/{REPO}/releases/download/v0.9.0/{name}",
            f.releases.origin()
        ),
        &sums,
    );
    bad_url(
        "an escape",
        format!("{base}/{}", name.replace("-x64", "%2Dx64")),
        &sums,
    );
    bad_url("no file", format!("{base}/"), &sums);
    assert_eq!(
        ask(&format!("{base}/{name}"), "file:///etc/passwd", TAG),
        (400, Some("bad-url".into()))
    );
    // The wrong package for this kind of copy, and the wrong file for the sums.
    let setup = format!("{base}/Repackshot-{TAG}-windows-x64-setup.exe");
    assert_eq!(ask(&setup, &sums, TAG), (400, Some("bad-asset".into())));
    let zip = format!("{base}/Repackshot-{TAG}-windows-x64-portable.zip");
    assert_eq!(ask(&zip, &sums, TAG), (400, Some("bad-asset".into())));
    assert_eq!(
        ask(&format!("{base}/{name}"), &format!("{base}/{name}"), TAG),
        (400, Some("bad-asset".into()))
    );
    assert_eq!(
        ask(&format!("{base}/{name}"), &sums, "../1.0.0"),
        (400, Some("bad-tag".into()))
    );
    // Nothing of it was downloaded, and nothing started.
    assert!(f.releases.asked().is_empty(), "{:?}", f.releases.asked());
    assert_eq!(state(&f.status()), "IDLE");
    // A body that is not the request.
    for body in [
        "",
        "[]",
        "{}",
        r#"{"tag":"0.2.0"}"#,
        r#"{"tag":1,"assetUrl":2,"sumsUrl":3}"#,
    ] {
        assert_eq!(f.install(body).status, 400, "{body:?}");
    }
    let huge = format!(
        r#"{{"tag":"{TAG}","assetUrl":"{base}/{name}","sumsUrl":"{sums}","size":99999999999}}"#
    );
    assert_eq!(f.install(&huge).status, 400);
    assert_eq!(f.server.api("GET", "/api/update/install", b"").status, 405);
    assert_eq!(f.server.api("PUT", "/api/update", b"").status, 405);
    assert_eq!(f.server.api("GET", "/api/update/nothing", b"").status, 404);
    // And as every API: only with the token.
    let anon = f.server.raw("POST", "/api/update/install", &[], b"{}");
    assert_eq!(anon.status, 401);
    assert_eq!(f.server.raw("GET", "/api/update", &[], b"").status, 401);
}

#[test]
fn a_copy_that_is_neither_installed_nor_portable_refuses() {
    if !have_tools() {
        return;
    }
    let f = Fixture::start(
        "update-unsupported",
        Mode::Unsupported("this copy is neither installed nor portable"),
    );
    let before = snapshot(&f.app);
    let r = f.install(&f.body(None));
    assert_eq!(r.status, 409, "{}", r.text());
    let v = json::parse(&r.text()).unwrap();
    assert_eq!(text(&v, "error"), Some("not-updatable"));
    assert!(text(&v, "message")
        .unwrap()
        .contains("neither installed nor portable"));
    assert_eq!(state(&f.status()), "IDLE");
    assert!(f.status().get("mode").unwrap().is_null());
    assert!(f.releases.asked().is_empty());
    assert_eq!(snapshot(&f.app), before);
}

// ------------------------------------------------------------------ progress, cancel, resume

#[test]
fn progress_is_what_arrived_and_cancel_stops_it_and_leaves_nothing() {
    if !have_tools() {
        return;
    }
    let f = Fixture::start("update-cancel", Mode::Portable(Kind::LinuxPortable));
    let before = snapshot(&f.app);
    // 2 MiB of filler in the package, slowly served.
    let mut files = package_files("repackshot");
    files.push((
        "Repackshot-0.2.0/app/filler.bin".into(),
        noise(2 << 20),
        false,
    ));
    let package = targz_of(&files);
    let size = package.len() as u64;
    f.publish(package, None);
    f.releases.throttle_ms.store(40, Ordering::Relaxed);
    assert_eq!(f.install(&f.body(Some(size))).status, 202);
    // A second update while one is under way is refused.
    let again = f.install(&f.body(Some(size)));
    assert_eq!(again.status, 409);
    assert_eq!(
        text(&json::parse(&again.text()).unwrap(), "error"),
        Some("busy")
    );
    // Bytes arrive: received grows, total is the size the page gave.
    let v = f.wait("no progress", |_| {
        let v = f.status();
        v.get("received").unwrap().as_f64().unwrap() > 0.0 && state(&v) == "DOWNLOADING"
    });
    assert_eq!(v.get("total").unwrap().as_f64(), Some(size as f64));
    assert!(v.get("received").unwrap().as_f64().unwrap() < size as f64);
    let r = f.server.api("POST", "/api/update/cancel", b"");
    assert_eq!(r.status, 200, "{}", r.text());
    let v = json::parse(&r.text()).unwrap();
    assert_eq!(state(&v), "IDLE");
    assert_eq!(v.get("received").unwrap().as_f64(), Some(0.0));
    assert!(!f.server.server.app.update.exit_requested());
    assert_eq!(
        snapshot(&f.app),
        before,
        "a cancelled download leaves no part files"
    );
    // Cancelling when nothing runs is fine, and the next update goes through.
    assert_eq!(f.server.api("POST", "/api/update/cancel", b"").status, 200);
    f.releases.throttle_ms.store(0, Ordering::Relaxed);
    assert_eq!(f.install(&f.body(Some(size))).status, 202);
    assert_eq!(state(&f.wait_end()), "INSTALLING");
}

#[test]
fn a_failure_is_cleared_by_cancel_and_the_update_can_be_tried_again() {
    if !have_tools() {
        return;
    }
    let f = Fixture::start("update-retry", Mode::Portable(Kind::LinuxPortable));
    assert_eq!(f.install(&f.body(None)).status, 202);
    assert_eq!(state(&f.wait_end()), "FAILED");
    let r = f.server.api("POST", "/api/update/cancel", b"");
    assert_eq!(state(&json::parse(&r.text()).unwrap()), "IDLE");
    assert!(json::parse(&r.text())
        .unwrap()
        .get("error")
        .unwrap()
        .is_null());
    f.publish_portable();
    assert_eq!(f.install(&f.body(None)).status, 202);
    assert_eq!(state(&f.wait_end()), "INSTALLING");
    // Once the files are in place there is no cancelling.
    let late = f.server.api("POST", "/api/update/cancel", b"");
    assert_eq!(late.status, 409);
    assert_eq!(
        text(&json::parse(&late.text()).unwrap(), "error"),
        Some("not-cancellable")
    );
    assert_eq!(state(&f.status()), "INSTALLING");
}

#[test]
fn a_download_that_was_cut_resumes_from_the_last_byte() {
    if !have_tools() {
        return;
    }
    let f = Fixture::start("update-resume", Mode::Portable(Kind::LinuxPortable));
    let mut files = package_files("repackshot");
    files.push((
        "Repackshot-0.2.0/app/filler.bin".into(),
        noise(1 << 20),
        false,
    ));
    f.publish(targz_of(&files), None);
    f.releases
        .cut_once
        .lock()
        .unwrap()
        .insert(Releases::path(TAG, &f.package_name()));
    assert_eq!(f.install(&f.body(None)).status, 202);
    let v = f.wait_end();
    assert_eq!(state(&v), "INSTALLING", "{}", v.to_json());
    // The second request for the package asked for the rest, from where the first stopped.
    let package_ranges: Vec<Option<String>> = f
        .releases
        .requests
        .lock()
        .unwrap()
        .iter()
        .filter(|(p, _)| p.ends_with(".tar.gz"))
        .map(|(_, r)| r.clone())
        .collect();
    assert_eq!(package_ranges.len(), 2, "{:?}", f.releases.ranges());
    assert_eq!(package_ranges[0], None);
    assert!(package_ranges[1].as_deref().unwrap().starts_with("bytes="));
    assert_eq!(read(&f.app.join("app/assets/new-only.js")), "new chunk");
}

// ------------------------------------------------------------------ the rest of the API

#[test]
fn info_says_whether_this_launcher_was_started_by_an_update() {
    let t = TestServer::start("update-info", 1);
    let info = t.json("GET", "/api/info", b"");
    assert_eq!(info.get("updateApi").unwrap().as_f64(), Some(1.0));
    assert_eq!(info.get("afterUpdate").unwrap().as_bool(), Some(false));
    t.server.app.update.mark_after_update();
    let info = t.json("GET", "/api/info", b"");
    assert_eq!(info.get("afterUpdate").unwrap().as_bool(), Some(true));
    // The idle state, as the page reads it. The test server runs from a folder that is neither
    // installed nor portable, so it says so instead of offering an update it could not make.
    let v = t.json("GET", "/api/update", b"");
    assert_eq!(state(&v), "IDLE");
    assert_eq!(v.get("received").unwrap().as_f64(), Some(0.0));
    assert!(v.get("tag").unwrap().is_null() && v.get("error").unwrap().is_null());
    assert!(v.get("mode").unwrap().is_null());
}
