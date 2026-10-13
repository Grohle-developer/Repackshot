//! The installed inference runtimes, by the SHA-256 of their archive (`docs/AI-POST.md` §7.1):
//!
//! ```text
//! <data>/ai/runtimes/<sha256>.zip.part    an archive being downloaded (resumes from its length)
//! <data>/ai/runtimes/<sha256>.tmp/        being unpacked (removed if a launch finds one)
//! <data>/ai/runtimes/<sha256>/            installed: the archive's files, and
//!     repackshot-runtime.json             {key, sha256, name, bytes}
//!     repackshot-probe.json               {version, devices[{name, description}], error}
//! ```
//!
//! A download (or a file the person chose) becomes a runtime only when its SHA-256 is the pinned
//! one: a mismatch deletes the part and installs nothing. Then the archive is unpacked with
//! [`super::zip`] (never a system `unzip`), the two executables are looked for, the folder is
//! renamed into place in one step and the command-line program is asked its version and its
//! devices (`--version`, `--list-devices`), which the status shows.

use super::catalogue::{Backend, Runtime, RuntimeCatalogue};
use super::download::{self, Downloader, Outcome, Transfer};
use super::proc;
use super::zip;
use crate::json::{self, Value};
use crate::sha256::{hex, Sha256};
use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{self, Read};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::thread::JoinHandle;
use std::time::Duration;

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(PoisonError::into_inner)
}

/// A device the runtime can compute on (a line of `--list-devices`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Device {
    /// ggml's name (`CPU`, `Vulkan0`).
    pub name: String,
    /// What the system calls it.
    pub description: String,
}

/// What the runtime said about itself.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Probe {
    /// The line of `--version` (`stable-diffusion.cpp version unknown, commit d637cfb`).
    pub version: Option<String>,
    /// From `--list-devices`, in its order.
    pub devices: Vec<Device>,
    /// Why it could not answer (a missing DLL or library...).
    pub error: Option<String>,
}

impl Probe {
    /// The device it will compute on: the first Vulkan device, else the CPU.
    pub fn device(&self) -> Option<(Backend, &Device)> {
        self.devices
            .iter()
            .find(|d| d.name.starts_with("Vulkan"))
            .map(|d| (Backend::Vulkan, d))
            .or_else(|| self.devices.first().map(|d| (Backend::Cpu, d)))
    }

    fn to_json(&self) -> String {
        json::Object::new()
            .opt_str("version", self.version.as_deref())
            .raw(
                "devices",
                &json::array(self.devices.iter().map(|d| {
                    json::Object::new()
                        .str("name", &d.name)
                        .str("description", &d.description)
                        .build()
                })),
            )
            .opt_str("error", self.error.as_deref())
            .build()
    }

    fn from_json(v: &Value) -> Probe {
        Probe {
            version: v.get("version").and_then(Value::as_str).map(str::to_string),
            devices: v
                .get("devices")
                .and_then(Value::as_array)
                .unwrap_or(&[])
                .iter()
                .filter_map(|d| {
                    Some(Device {
                        name: d.get("name")?.as_str()?.to_string(),
                        description: d.get("description")?.as_str()?.to_string(),
                    })
                })
                .collect(),
            error: v.get("error").and_then(Value::as_str).map(str::to_string),
        }
    }
}

/// Reads `--version` and `--list-devices` outputs.
pub fn parse_probe(version_out: &str, devices_out: &str) -> Probe {
    Probe {
        version: version_out
            .lines()
            .map(str::trim)
            .find(|l| l.contains("stable-diffusion.cpp") || l.contains("version"))
            .map(str::to_string),
        devices: devices_out
            .lines()
            .filter_map(|l| {
                let (name, description) = l.trim_end().split_once('\t')?;
                (!name.is_empty() && !name.contains(' ')).then(|| Device {
                    name: name.to_string(),
                    description: description.trim().to_string(),
                })
            })
            .collect(),
        error: None,
    }
}

/// An installed runtime.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Installed {
    /// Its key.
    pub key: String,
    /// Its folder.
    pub dir: PathBuf,
    /// The server executable.
    pub server: PathBuf,
    /// The command-line executable.
    pub cli: PathBuf,
}

/// Where a runtime is.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum State {
    /// Nothing on disk.
    Missing,
    /// Part of the archive is here and nothing is transferring.
    Paused {
        /// Bytes here.
        done: u64,
    },
    /// Downloading (or copying a chosen file).
    Downloading {
        /// Bytes here.
        done: u64,
    },
    /// Checking the SHA-256.
    Verifying {
        /// Bytes hashed.
        done: u64,
    },
    /// Unpacking and asking the runtime its version.
    Installing,
    /// Ready.
    Installed(Installed),
}

/// Why a runtime operation was refused.
#[derive(Debug, PartialEq, Eq)]
pub enum RuntimeError {
    /// No such key in `ai-runtimes.json`.
    UnknownKey,
    /// A build for another system.
    OtherSystem,
    /// Already busy with it (removing while it downloads...).
    Busy,
    /// The disk.
    Io(String),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Phase {
    Downloading,
    Verifying,
    Installing,
}

struct Job {
    transfer: Arc<Transfer>,
    phase: Arc<Mutex<Phase>>,
    hashed: Arc<AtomicU64>,
    handle: Option<JoinHandle<()>>,
}

/// Where a job takes the archive from.
#[derive(Clone, Debug)]
pub enum Source {
    /// Its pinned URL.
    Download,
    /// A file the person chose (they downloaded it with a browser).
    File(PathBuf),
}

/// The store.
pub struct Runtimes {
    root: PathBuf,
    cat: RuntimeCatalogue,
    downloader: Downloader,
    jobs: Mutex<HashMap<String, Job>>,
    errors: Mutex<HashMap<String, String>>,
    probes: Mutex<HashMap<String, Probe>>,
    /// Waits between attempts after a network failure.
    retry_waits: Vec<Duration>,
}

const RUNTIME_FILE: &str = "repackshot-runtime.json";
const PROBE_FILE: &str = "repackshot-probe.json";

impl Runtimes {
    /// The store in `root` (`<data>/ai/runtimes`). A half-unpacked folder of a previous launch
    /// is removed.
    pub fn new(root: PathBuf, cat: RuntimeCatalogue, downloader: Downloader) -> Runtimes {
        if let Ok(dir) = fs::read_dir(&root) {
            for e in dir.flatten() {
                if e.file_name().to_string_lossy().ends_with(".tmp") {
                    let _ = fs::remove_dir_all(e.path());
                }
            }
        }
        Runtimes {
            root,
            cat,
            downloader,
            jobs: Mutex::new(HashMap::new()),
            errors: Mutex::new(HashMap::new()),
            probes: Mutex::new(HashMap::new()),
            retry_waits: vec![Duration::from_secs(2), Duration::from_secs(5)],
        }
    }

    /// Shorter waits between attempts (tests).
    pub fn set_retry_waits(&mut self, waits: Vec<Duration>) {
        self.retry_waits = waits;
    }

    /// The catalogue it installs from.
    pub fn catalogue(&self) -> &RuntimeCatalogue {
        &self.cat
    }

    /// The downloader.
    pub fn downloader(&self) -> &Downloader {
        &self.downloader
    }

    /// The folder.
    pub fn root(&self) -> &Path {
        &self.root
    }

    fn dir_of(&self, rt: &Runtime) -> PathBuf {
        self.root.join(&rt.sha256)
    }

    fn part_of(&self, rt: &Runtime) -> PathBuf {
        self.root.join(format!("{}.zip.part", rt.sha256))
    }

    fn tmp_of(&self, rt: &Runtime) -> PathBuf {
        self.root.join(format!("{}.tmp", rt.sha256))
    }

    /// True for a build of this computer's system.
    pub fn is_here(rt: &Runtime) -> bool {
        rt.os == std::env::consts::OS && rt.arch == std::env::consts::ARCH
    }

    /// The runtime with `key` if it is installed.
    pub fn installed(&self, key: &str) -> Option<Installed> {
        let rt = self.cat.runtime(key)?;
        let dir = self.dir_of(rt);
        let text = fs::read_to_string(dir.join(RUNTIME_FILE)).ok()?;
        let v = json::parse(&text).ok()?;
        if v.get("sha256").and_then(Value::as_str) != Some(rt.sha256.as_str()) {
            return None;
        }
        let (server, cli) = (dir.join(&rt.server), dir.join(&rt.cli));
        (server.is_file() && cli.is_file()).then(|| Installed {
            key: rt.key.clone(),
            dir,
            server,
            cli,
        })
    }

    /// Where `key` is.
    pub fn state(&self, key: &str) -> Result<State, RuntimeError> {
        let rt = self.cat.runtime(key).ok_or(RuntimeError::UnknownKey)?;
        if let Some(job) = lock(&self.jobs).get(key) {
            return Ok(match *lock(&job.phase) {
                Phase::Downloading => State::Downloading {
                    done: job.transfer.done.load(Ordering::Relaxed),
                },
                Phase::Verifying => State::Verifying {
                    done: job.hashed.load(Ordering::Relaxed),
                },
                Phase::Installing => State::Installing,
            });
        }
        if let Some(i) = self.installed(key) {
            return Ok(State::Installed(i));
        }
        Ok(match fs::metadata(self.part_of(rt)) {
            Ok(m) => State::Paused { done: m.len() },
            Err(_) => State::Missing,
        })
    }

    /// The last failure of `key`, until it is started again.
    pub fn error(&self, key: &str) -> Option<String> {
        lock(&self.errors).get(key).cloned()
    }

    fn fail(&self, key: &str, message: String) {
        crate::log!("ai runtime {key}: {message}");
        lock(&self.errors).insert(key.to_string(), message);
    }

    /// What the installed runtime said about itself (asked once, then kept in its folder).
    pub fn probe(&self, key: &str) -> Option<Probe> {
        if let Some(p) = lock(&self.probes).get(key) {
            return Some(p.clone());
        }
        let i = self.installed(key)?;
        let p = fs::read_to_string(i.dir.join(PROBE_FILE))
            .ok()
            .and_then(|t| json::parse(&t).ok())
            .map(|v| Probe::from_json(&v))
            .unwrap_or_else(|| self.run_probe(&i));
        lock(&self.probes).insert(key.to_string(), p.clone());
        Some(p)
    }

    /// Asks the runtime again (`POST .../probe`).
    pub fn reprobe(&self, key: &str) -> Option<Probe> {
        let i = self.installed(key)?;
        let p = self.run_probe(&i);
        lock(&self.probes).insert(key.to_string(), p.clone());
        Some(p)
    }

    fn run_probe(&self, i: &Installed) -> Probe {
        let ask = |arg: &str| {
            let mut c = Command::new(&i.cli);
            c.arg(arg).current_dir(&i.dir);
            proc::capture(c, Duration::from_secs(60))
        };
        let p = match (ask("--version"), ask("--list-devices")) {
            (Ok(v), Ok(d)) if v.ok() && d.ok() => parse_probe(&v.stdout, &d.stdout),
            (Ok(v), Ok(d)) => {
                let bad = if v.ok() { d } else { v };
                let tail = bad
                    .stderr
                    .lines()
                    .rev()
                    .find(|l| !l.trim().is_empty())
                    .unwrap_or("");
                Probe {
                    error: Some(if bad.timed_out {
                        "it did not answer within a minute".to_string()
                    } else {
                        format!(
                            "{}{}",
                            proc::describe_exit(bad.code),
                            if tail.is_empty() {
                                String::new()
                            } else {
                                format!(": {}", tail.trim())
                            }
                        )
                    }),
                    ..Probe::default()
                }
            }
            (Err(e), _) | (_, Err(e)) => Probe {
                error: Some(format!("it does not start: {e}")),
                ..Probe::default()
            },
        };
        let _ = fs::write(i.dir.join(PROBE_FILE), p.to_json());
        p
    }

    /// Starts downloading (or resumes), or installs from a chosen file. Nothing happens if it
    /// is installed or already on its way.
    pub fn start(self: &Arc<Self>, key: &str, source: Source) -> Result<(), RuntimeError> {
        let rt = self
            .cat
            .runtime(key)
            .ok_or(RuntimeError::UnknownKey)?
            .clone();
        if !Self::is_here(&rt) {
            return Err(RuntimeError::OtherSystem);
        }
        let mut jobs = lock(&self.jobs);
        if jobs.contains_key(key) || self.installed(key).is_some() {
            return Ok(());
        }
        fs::create_dir_all(&self.root).map_err(|e| RuntimeError::Io(e.to_string()))?;
        lock(&self.errors).remove(key);
        let job = Job {
            transfer: Arc::new(Transfer::default()),
            phase: Arc::new(Mutex::new(Phase::Downloading)),
            hashed: Arc::new(AtomicU64::new(0)),
            handle: None,
        };
        let (transfer, phase, hashed) = (
            Arc::clone(&job.transfer),
            Arc::clone(&job.phase),
            Arc::clone(&job.hashed),
        );
        jobs.insert(key.to_string(), job);
        let me = Arc::clone(self);
        let handle = std::thread::Builder::new()
            .name("ai-runtime".into())
            .spawn(move || {
                let result = me.run_job(&rt, &source, &transfer, &phase, &hashed);
                if let Err(message) = result {
                    me.fail(&rt.key, message);
                }
                lock(&me.jobs).remove(&rt.key);
            })
            .map_err(|e| RuntimeError::Io(e.to_string()))?;
        if let Some(j) = jobs.get_mut(key) {
            j.handle = Some(handle);
        }
        Ok(())
    }

    /// Pauses a download (the part stays; [`Runtimes::start`] resumes it).
    pub fn pause(&self, key: &str) -> Result<(), RuntimeError> {
        self.cat.runtime(key).ok_or(RuntimeError::UnknownKey)?;
        if let Some(j) = lock(&self.jobs).get(key) {
            j.transfer.stop.store(true, Ordering::Relaxed);
        }
        Ok(())
    }

    /// Stops what `key` is doing and deletes everything of it (installed folder, part).
    pub fn remove(&self, key: &str) -> Result<(), RuntimeError> {
        let rt = self.cat.runtime(key).ok_or(RuntimeError::UnknownKey)?;
        let handle = lock(&self.jobs).get_mut(key).and_then(|j| {
            j.transfer.stop.store(true, Ordering::Relaxed);
            j.handle.take()
        });
        if let Some(h) = handle {
            let _ = h.join();
        }
        if lock(&self.jobs).contains_key(key) {
            return Err(RuntimeError::Busy);
        }
        let io = |e: io::Error| RuntimeError::Io(e.to_string());
        for dir in [self.dir_of(rt), self.tmp_of(rt)] {
            match fs::remove_dir_all(&dir) {
                Err(e) if e.kind() != io::ErrorKind::NotFound => return Err(io(e)),
                _ => {}
            }
        }
        match fs::remove_file(self.part_of(rt)) {
            Err(e) if e.kind() != io::ErrorKind::NotFound => return Err(io(e)),
            _ => {}
        }
        lock(&self.probes).remove(key);
        lock(&self.errors).remove(key);
        Ok(())
    }

    /// Stops every job (the application ends); parts stay for the next launch.
    pub fn shutdown(&self) {
        let handles: Vec<JoinHandle<()>> = lock(&self.jobs)
            .values_mut()
            .filter_map(|j| {
                j.transfer.stop.store(true, Ordering::Relaxed);
                j.handle.take()
            })
            .collect();
        for h in handles {
            let _ = h.join();
        }
    }

    fn run_job(
        &self,
        rt: &Runtime,
        source: &Source,
        transfer: &Arc<Transfer>,
        phase: &Mutex<Phase>,
        hashed: &AtomicU64,
    ) -> Result<(), String> {
        let part = self.part_of(rt);
        match source {
            Source::Download => {
                let mut attempt = 0;
                let mut restarted = false;
                loop {
                    match download::fetch(&self.downloader, &rt.url, &part, rt.bytes, transfer) {
                        Outcome::Complete => break,
                        Outcome::Stopped => return Ok(()),
                        Outcome::Failed { message, code } => {
                            if code == Some(download::CANNOT_RESUME) && !restarted {
                                // The server sends it whole: start again from the first byte.
                                restarted = true;
                                let _ = fs::remove_file(&part);
                                continue;
                            }
                            if !download::transient(code) || attempt >= self.retry_waits.len() {
                                return Err(message);
                            }
                            let wait = self.retry_waits[attempt];
                            attempt += 1;
                            let until = std::time::Instant::now() + wait;
                            while std::time::Instant::now() < until {
                                if transfer.stop.load(Ordering::Relaxed) {
                                    return Ok(());
                                }
                                std::thread::sleep(Duration::from_millis(50));
                            }
                        }
                    }
                }
            }
            Source::File(path) => {
                if !copy_file(path, &part, rt.bytes, transfer)? {
                    return Ok(());
                }
            }
        }
        *lock(phase) = Phase::Verifying;
        let digest = hash_file(&part, hashed).map_err(|e| format!("{}: {e}", part.display()))?;
        if digest != rt.sha256 {
            let _ = fs::remove_file(&part);
            return Err(format!(
                "sha256-mismatch: the archive's SHA-256 is {digest}, not the pinned {}; nothing was installed",
                rt.sha256
            ));
        }
        *lock(phase) = Phase::Installing;
        self.unpack(rt, &part).inspect_err(|_| {
            let _ = fs::remove_dir_all(self.tmp_of(rt));
        })?;
        let _ = fs::remove_file(&part);
        if let Some(i) = self.installed(&rt.key) {
            let p = self.run_probe(&i);
            if let Some(e) = &p.error {
                crate::log!("ai runtime {}: installed, but {e}", rt.key);
            }
            lock(&self.probes).insert(rt.key.clone(), p);
        }
        Ok(())
    }

    fn unpack(&self, rt: &Runtime, part: &Path) -> Result<(), String> {
        let tmp = self.tmp_of(rt);
        let _ = fs::remove_dir_all(&tmp);
        zip::extract(part, &tmp, zip::Limits::default()).map_err(|e| e.to_string())?;
        for exe in [&rt.server, &rt.cli] {
            if !tmp.join(exe).is_file() {
                return Err(format!("the archive has no {exe}"));
            }
        }
        let meta = json::Object::new()
            .str("key", &rt.key)
            .str("sha256", &rt.sha256)
            .str("name", &rt.name)
            .num("bytes", rt.bytes as f64)
            .build();
        fs::write(tmp.join(RUNTIME_FILE), meta).map_err(|e| e.to_string())?;
        let dir = self.dir_of(rt);
        let _ = fs::remove_dir_all(&dir);
        fs::rename(&tmp, &dir).map_err(|e| e.to_string())
    }
}

/// Copies a chosen archive into the part file; `false` when stopped half way.
fn copy_file(from: &Path, part: &Path, total: u64, t: &Transfer) -> Result<bool, String> {
    let mut src = File::open(from).map_err(|e| format!("{}: {e}", from.display()))?;
    let len = src.metadata().map(|m| m.len()).unwrap_or(0);
    if len != total {
        return Err(format!(
            "size-mismatch: the chosen file has {len} bytes, the pinned archive {total}"
        ));
    }
    let mut dst = File::create(part).map_err(|e| e.to_string())?;
    let mut buf = vec![0u8; 1 << 20];
    let mut done = 0u64;
    loop {
        if t.stop.load(Ordering::Relaxed) {
            return Ok(false);
        }
        let n = src.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        io::Write::write_all(&mut dst, &buf[..n]).map_err(|e| e.to_string())?;
        done += n as u64;
        t.done.store(done, Ordering::Relaxed);
    }
    dst.sync_all().map_err(|e| e.to_string())?;
    Ok(true)
}

fn hash_file(path: &Path, hashed: &AtomicU64) -> io::Result<String> {
    let mut f = File::open(path)?;
    let mut h = Sha256::new();
    let mut buf = vec![0u8; 1 << 20];
    let mut done = 0u64;
    loop {
        let n = f.read(&mut buf)?;
        if n == 0 {
            return Ok(hex(&h.finish()));
        }
        h.update(&buf[..n]);
        done += n as u64;
        hashed.store(done, Ordering::Relaxed);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_and_devices_are_read() {
        let p = parse_probe(
            "stable-diffusion.cpp version unknown, commit d637cfb\n",
            "CPU\tIntel(R) Xeon(R) Processor @ 2.80GHz\nVulkan0\tNVIDIA GeForce RTX 4070\nload_backend: x\n",
        );
        assert_eq!(
            p.version.as_deref(),
            Some("stable-diffusion.cpp version unknown, commit d637cfb")
        );
        assert_eq!(p.devices.len(), 2);
        let (b, d) = p.device().unwrap();
        assert_eq!(
            (b, d.description.as_str()),
            (Backend::Vulkan, "NVIDIA GeForce RTX 4070")
        );
        let cpu = parse_probe("v", "CPU\tSome CPU\n");
        assert_eq!(cpu.device().map(|(b, _)| b), Some(Backend::Cpu));
        assert_eq!(Probe::from_json(&json::parse(&p.to_json()).unwrap()), p);
    }
}
