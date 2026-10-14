//! Downloading a runtime archive with the system's `curl`.
//!
//! The launcher has no TLS of its own (`std` only), and the page cannot fetch the archives as it
//! fetches the model weights: GitHub's release downloads (`github.com` and the
//! `release-assets.githubusercontent.com` it redirects to) send no `Access-Control-Allow-Origin`,
//! so a `fetch` from `http://127.0.0.1:<port>` is refused by the browser. So the launcher runs
//! `curl` (in `System32` since Windows 10 1803; on every desktop Linux), as it runs `reg` or
//! `nvidia-smi`: only `https` (also after redirects), at most 5 redirects, failing on HTTP
//! errors, giving up when slower than 1 KiB/s for a minute. The bytes come through its standard
//! output and the launcher appends them to `<sha256>.zip.part` itself (no path handed to `curl`,
//! whatever the characters of the user's folder), so **resuming** is `-C <bytes already
//! there>`, and a server that cannot resume fails with code 33 instead of sending everything
//! again. Pausing is stopping `curl`; the part stays.

use std::fs::OpenOptions;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

/// How downloads are made.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Downloader {
    /// The `curl` program, when there is one.
    pub program: Option<PathBuf>,
    /// Plain `http` too (only the tests' local server).
    pub allow_http: bool,
}

fn in_path(name: &str) -> Option<PathBuf> {
    std::env::var_os("PATH").and_then(|paths| {
        std::env::split_paths(&paths)
            .map(|d| d.join(name))
            .find(|p| p.is_file())
    })
}

impl Downloader {
    /// The system's `curl`: `%SystemRoot%\System32\curl.exe` on Windows (never one found first
    /// in the `PATH`), else the first `curl` of the `PATH`.
    pub fn system() -> Downloader {
        let program = if cfg!(windows) {
            std::env::var_os("SystemRoot")
                .map(|r| PathBuf::from(r).join("System32").join("curl.exe"))
                .filter(|p| p.is_file())
                .or_else(|| in_path("curl.exe"))
        } else {
            in_path("curl")
        };
        Downloader {
            program,
            allow_http: false,
        }
    }

    /// The arguments for `url` from byte `offset`.
    pub fn args(&self, url: &str, offset: u64) -> Vec<String> {
        let proto = if self.allow_http {
            "=http,https"
        } else {
            "=https"
        };
        let mut a: Vec<String> = [
            "--silent",
            "--show-error",
            "--fail",
            "--location",
            "--max-redirs",
            "5",
            "--proto",
            proto,
            "--proto-redir",
            proto,
            "--connect-timeout",
            "30",
            "--speed-limit",
            "1024",
            "--speed-time",
            "60",
        ]
        .iter()
        .map(|s| s.to_string())
        .collect();
        if offset > 0 {
            a.push("--continue-at".into());
            a.push(offset.to_string());
        }
        a.push("--url".into());
        a.push(url.to_string());
        a
    }
}

/// A download's progress, shared with whoever reports it.
#[derive(Debug, Default)]
pub struct Transfer {
    /// Bytes in the part file.
    pub done: AtomicU64,
    /// Set to stop (pause or cancel): `curl` is stopped and the part kept.
    pub stop: AtomicBool,
}

/// How a download ended.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Outcome {
    /// Every byte is in the part file.
    Complete,
    /// [`Transfer::stop`] was set.
    Stopped,
    /// It failed; the part keeps what arrived.
    Failed {
        /// Why, in words.
        message: String,
        /// `curl`'s exit code, when it ran.
        code: Option<i32>,
    },
}

impl Outcome {
    fn failed(message: impl Into<String>) -> Outcome {
        Outcome::Failed {
            message: message.into(),
            code: None,
        }
    }
}

/// `curl` codes worth another attempt from where the part ends: no connection, cut, too slow.
pub fn transient(code: Option<i32>) -> bool {
    matches!(code, Some(7 | 18 | 28 | 52 | 55 | 56 | 92))
}

/// `curl`'s code for a server that cannot resume (then the download starts again from 0).
pub const CANNOT_RESUME: i32 = 33;

/// Why `curl` failed, in words (its exit codes, `man curl`).
pub fn curl_error(code: Option<i32>, stderr: &str) -> String {
    let why = match code {
        Some(6) => "the address could not be resolved: is there a connection?",
        Some(7) => "could not connect to the server",
        Some(22) => "the server answered with an error",
        Some(28) => "the download timed out or became too slow",
        Some(33) => "the server cannot resume this download",
        Some(35) | Some(60) | Some(77) | Some(83) => "the secure connection failed (certificate)",
        Some(18) | Some(52) | Some(55) | Some(56) | Some(92) => "the connection was cut",
        _ => "the download failed",
    };
    let detail = stderr
        .lines()
        .rev()
        .find(|l| !l.trim().is_empty())
        .unwrap_or("")
        .trim();
    let code = code.map_or_else(|| "killed".to_string(), |c| c.to_string());
    if detail.is_empty() {
        format!("{why} (curl {code})")
    } else {
        format!("{why} (curl {code}: {detail})")
    }
}

/// How many bytes a download is expected to bring.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Expect {
    /// Exactly this many (a runtime archive: the catalogue says how many).
    Exactly(u64),
    /// Any number up to this one (an application update: its size is the feed's word, and the
    /// SHA-256 of the file is what tells it is the right one).
    AtMost(u64),
}

/// Downloads `url` onto the end of `part` until it holds `total` bytes, or until `t.stop`.
/// One attempt; the caller decides about retrying (resuming from what is there).
pub fn fetch(d: &Downloader, url: &str, part: &Path, total: u64, t: &Arc<Transfer>) -> Outcome {
    fetch_to(d, url, part, Expect::Exactly(total), t)
}

/// [`fetch`] for a size that is exact or only bounded (see [`Expect`]).
pub fn fetch_to(
    d: &Downloader,
    url: &str,
    part: &Path,
    expect: Expect,
    t: &Arc<Transfer>,
) -> Outcome {
    let (total, exact) = match expect {
        Expect::Exactly(n) => (n, true),
        Expect::AtMost(n) => (n, false),
    };
    let Some(program) = &d.program else {
        return Outcome::failed("there is no curl on this computer to download with");
    };
    let mut file = match OpenOptions::new().create(true).append(true).open(part) {
        Ok(f) => f,
        Err(e) => return Outcome::failed(format!("{}: {e}", part.display())),
    };
    let have = file.metadata().map(|m| m.len()).unwrap_or(0);
    t.done.store(have, Ordering::Relaxed);
    if exact && have == total {
        return Outcome::Complete;
    }
    if have > total {
        return Outcome::failed("the part file is larger than the archive");
    }
    let mut cmd = Command::new(program);
    cmd.args(d.args(url, have))
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    crate::process::no_window(&mut cmd);
    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => return Outcome::failed(format!("curl did not start: {e}")),
    };
    let mut stdout = child.stdout.take();
    let stderr = child.stderr.take().map(|mut s| {
        std::thread::spawn(move || {
            let mut buf = Vec::new();
            let _ = (&mut s).take(16 << 10).read_to_end(&mut buf);
            String::from_utf8_lossy(&buf).into_owned()
        })
    });
    // The bytes are copied here while the thread below watches for a stop.
    let copy = {
        let t = Arc::clone(t);
        std::thread::spawn(move || -> Result<(), String> {
            let Some(out) = stdout.as_mut() else {
                return Ok(());
            };
            let mut buf = vec![0u8; 1 << 20];
            loop {
                let n = match out.read(&mut buf) {
                    Ok(0) => return Ok(()),
                    Ok(n) => n,
                    Err(e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
                    Err(e) => return Err(e.to_string()),
                };
                let done = t.done.load(Ordering::Relaxed) + n as u64;
                if done > total {
                    return Err("the server sent more bytes than the archive has".into());
                }
                file.write_all(&buf[..n]).map_err(|e| e.to_string())?;
                t.done.store(done, Ordering::Relaxed);
            }
        })
    };
    let mut stopped = false;
    loop {
        if copy.is_finished() {
            break;
        }
        if t.stop.load(Ordering::Relaxed) && !stopped {
            stopped = true;
            let _ = child.kill();
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    let copied = copy
        .join()
        .unwrap_or_else(|_| Err("the copy failed".into()));
    if copied.is_err() {
        let _ = child.kill();
    }
    let status = child.wait().ok();
    let err = stderr.and_then(|h| h.join().ok()).unwrap_or_default();
    if stopped {
        return Outcome::Stopped;
    }
    if let Err(e) = copied {
        return Outcome::failed(e);
    }
    let code = status.and_then(|s| s.code());
    if code != Some(0) {
        return Outcome::Failed {
            message: curl_error(code, &err),
            code,
        };
    }
    let done = t.done.load(Ordering::Relaxed);
    if !exact || done == total {
        Outcome::Complete
    } else {
        Outcome::failed(format!("the download ended at {done} of {total} bytes"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn https_only_resume_from_the_part_and_errors_in_words() {
        let d = Downloader {
            program: Some("curl".into()),
            allow_http: false,
        };
        let a = d.args("https://example.org/x.zip", 0);
        let joined = a.join(" ");
        assert!(joined.contains("--proto =https --proto-redir =https"));
        assert!(joined.contains("--fail") && joined.contains("--max-redirs 5"));
        assert!(!joined.contains("--continue-at"));
        assert_eq!(
            a.last().map(String::as_str),
            Some("https://example.org/x.zip")
        );
        let r = d.args("https://example.org/x.zip", 1234).join(" ");
        assert!(r.contains("--continue-at 1234 --url https://example.org/x.zip"));
        assert!(curl_error(
            Some(22),
            "curl: (22) The requested URL returned error: 404\n"
        )
        .contains("error: 404"));
        assert!(curl_error(Some(6), "").starts_with("the address could not be resolved"));
        assert!(curl_error(None, "").contains("killed"));
        // No curl: a clear failure, not a panic.
        let none = Downloader {
            program: None,
            allow_http: false,
        };
        let dir = crate::test_dir("download-none");
        let t = Arc::new(Transfer::default());
        assert!(matches!(
            fetch(&none, "https://x", &dir.join("p"), 10, &t),
            Outcome::Failed { message, .. } if message.contains("no curl")
        ));
    }
}
