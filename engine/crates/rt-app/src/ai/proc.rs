//! Running the runtime's programs: with a time limit, both outputs captured, no console window on
//! Windows ([`crate::process::no_window`], `CREATE_NO_WINDOW` through `CommandExt`: safe `std`),
//! and finding and stopping a server a previous launch left running.

use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::{Duration, Instant};

/// What a finished program said.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Captured {
    /// Its exit code (`None`: killed by a signal, or by us at the time limit).
    pub code: Option<i32>,
    /// Standard output, as text.
    pub stdout: String,
    /// Standard error, as text.
    pub stderr: String,
    /// It was killed at the time limit.
    pub timed_out: bool,
}

impl Captured {
    /// It ran and exited with 0.
    pub fn ok(&self) -> bool {
        self.code == Some(0) && !self.timed_out
    }
}

type Collected = Arc<Mutex<Vec<u8>>>;

/// Reads `r` into a shared buffer (at most `cap` bytes) on its own thread.
fn reader<R: Read + Send + 'static>(
    mut r: R,
    cap: usize,
) -> (Collected, std::thread::JoinHandle<()>) {
    let out: Collected = Arc::new(Mutex::new(Vec::new()));
    let shared = Arc::clone(&out);
    let handle = std::thread::spawn(move || {
        let mut buf = [0u8; 8192];
        while let Ok(n) = r.read(&mut buf) {
            if n == 0 {
                break;
            }
            let mut o = shared.lock().unwrap_or_else(PoisonError::into_inner);
            if o.len() < cap {
                let room = cap - o.len();
                o.extend_from_slice(&buf[..n.min(room)]);
            }
        }
    });
    (out, handle)
}

/// Runs `cmd` (stdin closed, no window) and captures up to 1 MiB of each output; killed after
/// `limit`. `Err` when it cannot start.
pub fn capture(mut cmd: Command, limit: Duration) -> Result<Captured, String> {
    crate::process::no_window(&mut cmd);
    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = cmd.spawn().map_err(|e| e.to_string())?;
    let out = child.stdout.take().map(|s| reader(s, 1 << 20));
    let err = child.stderr.take().map(|s| reader(s, 1 << 20));
    let start = Instant::now();
    let (status, timed_out) = loop {
        match child.try_wait() {
            Ok(Some(s)) => break (Some(s), false),
            Ok(None) if start.elapsed() < limit => std::thread::sleep(Duration::from_millis(15)),
            Ok(None) => {
                let _ = child.kill();
                break (child.wait().ok(), true);
            }
            Err(e) => return Err(e.to_string()),
        }
    };
    // The outputs end when every process holding them does: a grandchild of a killed program
    // may keep them open, so the readers get two seconds, and what they read is what there is.
    let waited = Instant::now();
    let text = |r: Option<(Collected, std::thread::JoinHandle<()>)>| {
        let Some((buf, handle)) = r else {
            return String::new();
        };
        while !handle.is_finished() && waited.elapsed() < Duration::from_secs(2) {
            std::thread::sleep(Duration::from_millis(5));
        }
        let b = buf.lock().unwrap_or_else(PoisonError::into_inner);
        String::from_utf8_lossy(&b).into_owned()
    };
    Ok(Captured {
        code: status.and_then(|s| s.code()),
        stdout: text(out),
        stderr: text(err),
        timed_out,
    })
}

/// Windows status codes a program that could not start exits with.
const STATUS_DLL_NOT_FOUND: u32 = 0xC000_0135;
const STATUS_INVALID_IMAGE_FORMAT: u32 = 0xC000_007B;
const STATUS_ENTRYPOINT_NOT_FOUND: u32 = 0xC000_0139;
const STATUS_ILLEGAL_INSTRUCTION: u32 = 0xC000_001D;

/// Why a program ended, in words for the log and the interface: the codes Windows uses when a
/// DLL is missing (the Visual C++ runtime the Windows builds need) are named.
pub fn describe_exit(code: Option<i32>) -> String {
    match code {
        None => "it was stopped (a signal)".into(),
        Some(c) => match c as u32 {
            STATUS_DLL_NOT_FOUND | STATUS_ENTRYPOINT_NOT_FOUND => format!(
                "a DLL it needs is missing (0x{:08X}): install the Microsoft Visual C++ 2015-2022 runtime (x64)",
                c as u32
            ),
            STATUS_INVALID_IMAGE_FORMAT => {
                format!("a DLL is for another processor (0x{:08X})", c as u32)
            }
            STATUS_ILLEGAL_INSTRUCTION => {
                format!("this processor lacks an instruction it uses (0x{:08X})", c as u32)
            }
            _ => format!("it exited with code {c}"),
        },
    }
}

/// The executable of a running process, when the system says (Linux: `/proc/<pid>/exe`).
#[cfg(target_os = "linux")]
pub fn exe_of(pid: u32) -> Option<PathBuf> {
    std::fs::read_link(format!("/proc/{pid}/exe")).ok()
}

/// The executable of a running process (Windows: its image name only, from `tasklist`).
#[cfg(windows)]
pub fn exe_of(pid: u32) -> Option<PathBuf> {
    let mut cmd = Command::new("tasklist");
    cmd.args(["/FI", &format!("PID eq {pid}"), "/FO", "CSV", "/NH"]);
    let out = capture(cmd, Duration::from_secs(10)).ok()?;
    // "sd-server.exe","1234","Console","1","12,345 K"
    let line = out.stdout.lines().find(|l| l.starts_with('"'))?;
    let name = line.split("\",\"").next()?.trim_start_matches('"');
    let pid_field = line.split("\",\"").nth(1)?;
    (pid_field == pid.to_string()).then(|| PathBuf::from(name))
}

/// Elsewhere the process cannot be named, so it is never touched.
#[cfg(not(any(windows, target_os = "linux")))]
pub fn exe_of(_pid: u32) -> Option<PathBuf> {
    None
}

/// Stops a process by id (a server of a previous launch): `kill -9` or `taskkill /F`.
pub fn kill_pid(pid: u32) -> bool {
    let cmd = if cfg!(windows) {
        let mut c = Command::new("taskkill");
        c.args(["/PID", &pid.to_string(), "/T", "/F"]);
        c
    } else {
        let mut c = Command::new("kill");
        c.args(["-9", &pid.to_string()]);
        c
    };
    capture(cmd, Duration::from_secs(10)).is_ok_and(|c| c.ok())
}

/// True when `exe` (what [`exe_of`] said) is the server `server` a launch started: the same file
/// on Linux, the same file name on Windows (all `tasklist` gives).
pub fn is_our_server(exe: &Path, server: &Path) -> bool {
    if cfg!(windows) {
        exe.file_name()
            .zip(server.file_name())
            .is_some_and(|(a, b)| a.eq_ignore_ascii_case(b))
    } else {
        // A deleted executable reads as "<path> (deleted)".
        let e = exe.to_string_lossy();
        let e = e.strip_suffix(" (deleted)").unwrap_or(&e);
        Path::new(e) == server
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(unix)]
    #[test]
    fn captures_both_outputs_codes_and_the_limit() {
        let mut c = Command::new("sh");
        c.args(["-c", "echo out; echo err >&2; exit 3"]);
        let r = capture(c, Duration::from_secs(10)).unwrap();
        assert_eq!(
            (r.code, r.stdout.as_str(), r.stderr.as_str()),
            (Some(3), "out\n", "err\n")
        );
        assert!(!r.ok());
        let mut c = Command::new("sh");
        c.args(["-c", "sleep 5"]);
        let start = Instant::now();
        let r = capture(c, Duration::from_millis(200)).unwrap();
        assert!(r.timed_out && start.elapsed() < Duration::from_secs(4));
        assert!(capture(Command::new("/nonexistent/x"), Duration::from_secs(1)).is_err());
    }

    #[test]
    fn exits_are_described() {
        assert!(describe_exit(Some(0xC000_0135u32 as i32)).contains("Visual C++"));
        assert!(describe_exit(Some(0xC000_001Du32 as i32)).contains("instruction"));
        assert_eq!(describe_exit(Some(2)), "it exited with code 2");
        assert!(describe_exit(None).contains("signal"));
    }

    #[test]
    fn our_server_is_recognised() {
        let server = Path::new("/d/ai/runtimes/abc/sd-server");
        if cfg!(windows) {
            assert!(is_our_server(
                Path::new("SD-SERVER"),
                Path::new("C:/x/sd-server")
            ));
        } else {
            assert!(is_our_server(server, server));
            assert!(is_our_server(
                Path::new("/d/ai/runtimes/abc/sd-server (deleted)"),
                server
            ));
            assert!(!is_our_server(Path::new("/usr/bin/sd-server"), server));
        }
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn this_process_is_found_and_a_gone_one_is_not() {
        assert!(exe_of(std::process::id()).is_some());
        assert_eq!(exe_of(u32::MAX - 7), None);
    }
}
