//! Running system programs (`reg`, `powershell`, `nvidia-smi`, the browser, `xdg-open`): with a
//! time limit, without a console window on Windows, and never through a shell string.

use std::ffi::{OsStr, OsString};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, ExitStatus, Stdio};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::{Duration, Instant};

/// `CREATE_NO_WINDOW`: a console program started by the (windowless) launcher shows no window.
#[cfg(windows)]
pub const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// At most this much of a program's standard error is kept (the rest is read and dropped).
const STDERR_KEPT: usize = 64 << 10;

/// How long the outputs may stay open after the program exits (a grandchild holding them).
const OUTPUT_GRACE: Duration = Duration::from_secs(2);

/// `DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP`: a program that goes on running when the
/// launcher that started it exits.
#[cfg(windows)]
pub const DETACHED: u32 = 0x0000_0008 | 0x0000_0200;

/// Starts `program` and leaves it running on its own: it has no console, no input and a process
/// group of its own, so closing the launcher (or the terminal it was started from) does not stop
/// it. `keep_output` hands it the launcher's standard output and error (the new version of the
/// application, whose `--serve-only` prints the address to whoever started it); otherwise they
/// go nowhere (an installer). The caller drops the child: it is never waited for.
pub fn spawn_detached(
    program: &Path,
    args: &[OsString],
    cwd: Option<&Path>,
    keep_output: bool,
) -> std::io::Result<Child> {
    let mut cmd = Command::new(program);
    cmd.args(args).stdin(Stdio::null());
    if keep_output {
        cmd.stdout(Stdio::inherit()).stderr(Stdio::inherit());
    } else {
        cmd.stdout(Stdio::null()).stderr(Stdio::null());
    }
    if let Some(dir) = cwd {
        cmd.current_dir(dir);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(DETACHED);
    }
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        cmd.process_group(0);
    }
    cmd.spawn()
}

/// Prepares `program` with `args` and no console window.
pub fn command(program: impl AsRef<OsStr>, args: &[&str]) -> Command {
    let mut cmd = Command::new(program);
    cmd.args(args);
    no_window(&mut cmd);
    cmd
}

/// Keeps a console program from opening a window (Windows; nothing elsewhere).
pub fn no_window(cmd: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    #[cfg(not(windows))]
    let _ = cmd;
}

/// A program of Windows' own `System32` folder by its absolute path
/// (`%SystemRoot%\System32\<parts>`), so a program of the same name next to ours, in the current
/// folder or early on `PATH` is never the one started. The last part alone (found the usual way)
/// when `SystemRoot` is not set or the file is not there.
pub fn system32(parts: &[&str]) -> PathBuf {
    let bare = || PathBuf::from(parts.last().copied().unwrap_or_default());
    std::env::var_os("SystemRoot")
        .map(|root| {
            parts
                .iter()
                .fold(PathBuf::from(root).join("System32"), |p, part| p.join(part))
        })
        .filter(|p| p.is_file())
        .unwrap_or_else(bare)
}

/// What a program printed before it exited, and how it exited.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Ran {
    /// Its standard output, as text.
    pub stdout: String,
    /// Its standard error, as text (the first 64 KiB).
    pub stderr: String,
    /// Its exit code (`None`: ended by a signal).
    pub code: Option<i32>,
}

impl Ran {
    /// It exited with 0.
    pub fn success(&self) -> bool {
        self.code == Some(0)
    }

    /// How it ended, for the log: `exit 0`, or `exit 1 ("ERROR: Access is denied.")` with the
    /// first line of what it said on standard error.
    pub fn exit_text(&self) -> String {
        let code = self
            .code
            .map_or_else(|| "a signal".to_string(), |c| format!("exit {c}"));
        match self.stderr.lines().map(str::trim).find(|l| !l.is_empty()) {
            Some(first) => format!(
                "{code} (\"{}\")",
                first.chars().take(200).collect::<String>()
            ),
            None => code,
        }
    }
}

/// Text of a program's output: UTF-8 (invalid bytes become U+FFFD), or UTF-16LE when it starts
/// with its byte order mark (what some Windows tools write when their output is not a console).
pub fn decode(bytes: &[u8]) -> String {
    if let Some(rest) = bytes.strip_prefix(&[0xFF, 0xFE]) {
        let units: Vec<u16> = rest
            .chunks_exact(2)
            .map(|c| u16::from_le_bytes([c[0], c[1]]))
            .collect();
        return String::from_utf16_lossy(&units);
    }
    String::from_utf8_lossy(bytes).into_owned()
}

/// What a reader thread has read so far, and the thread.
type Reading = (Arc<Mutex<Vec<u8>>>, std::thread::JoinHandle<()>);

/// Reads `r` to its end on another thread (so a chatty program never blocks on a full pipe),
/// keeping the first `keep` bytes.
fn read_on_thread<R: Read + Send + 'static>(mut r: R, keep: usize) -> Reading {
    let kept = Arc::new(Mutex::new(Vec::new()));
    let shared = Arc::clone(&kept);
    let handle = std::thread::spawn(move || {
        let mut buf = [0u8; 8192];
        loop {
            match r.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let mut k = shared.lock().unwrap_or_else(PoisonError::into_inner);
                    let room = keep.saturating_sub(k.len());
                    k.extend_from_slice(&buf[..n.min(room)]);
                }
                Err(e) if e.kind() == std::io::ErrorKind::Interrupted => {}
                Err(_) => break,
            }
        }
    });
    (kept, handle)
}

/// What a reader read: everything, or what it had after [`OUTPUT_GRACE`] when a grandchild of
/// the program still holds the pipe open.
fn collected(reading: Option<Reading>, since: Instant) -> String {
    let Some((kept, handle)) = reading else {
        return String::new();
    };
    while !handle.is_finished() && since.elapsed() < OUTPUT_GRACE {
        std::thread::sleep(Duration::from_millis(5));
    }
    let bytes = kept.lock().unwrap_or_else(PoisonError::into_inner);
    decode(&bytes)
}

/// Runs `cmd` and returns what it printed and how it exited, **whatever the exit code**: Windows'
/// own tools exit non-zero after printing what they could (`reg query /s` exits 1 when one subkey
/// is access denied, after every key it could read), so the caller decides what the code means.
/// `Err` says why there is nothing: the program could not start, or it did not finish within
/// `limit` (it is then killed).
pub fn output_any(mut cmd: Command, limit: Duration) -> Result<Ran, String> {
    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = cmd.spawn().map_err(|e| format!("cannot start it: {e}"))?;
    let out = child.stdout.take().map(|s| read_on_thread(s, usize::MAX));
    let err = child.stderr.take().map(|s| read_on_thread(s, STDERR_KEPT));
    let Some(status) = wait(&mut child, limit) else {
        let _ = child.kill();
        let _ = child.wait();
        // A grandchild may still hold the pipes: the readers are left to finish on their own.
        return Err(format!(
            "no answer within {} s (stopped)",
            limit.as_secs_f32()
        ));
    };
    let exited = Instant::now();
    Ok(Ran {
        stdout: collected(out, exited),
        stderr: collected(err, exited),
        code: status.code(),
    })
}

/// Runs `cmd` and returns its standard output if it exits **successfully** within `limit`; a
/// program that takes longer is killed. For programs whose non-zero exit means "nothing to read"
/// (a registry value that is not there); [`output_any`] for the others.
pub fn output(cmd: Command, limit: Duration) -> Option<String> {
    output_any(cmd, limit)
        .ok()
        .filter(Ran::success)
        .map(|r| r.stdout)
}

/// Waits for `child` up to `limit`: its exit status, or `None` when it is still running.
fn wait(child: &mut Child, limit: Duration) -> Option<ExitStatus> {
    let start = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return Some(status),
            Ok(None) if start.elapsed() < limit => std::thread::sleep(Duration::from_millis(20)),
            _ => return None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A command-line program that prints `text`, a line on standard error, and exits with `code`.
    fn prints_and_exits(text: &str, code: i32) -> Command {
        if cfg!(windows) {
            command(
                "cmd",
                &[
                    "/d",
                    "/c",
                    &format!("echo {text}& echo ERROR: Access is denied. 1>&2& exit /b {code}"),
                ],
            )
        } else {
            command(
                "sh",
                &[
                    "-c",
                    &format!("echo {text}; echo 'ERROR: Access is denied.' >&2; exit {code}"),
                ],
            )
        }
    }

    #[test]
    fn reads_a_program_that_prints_and_exits_non_zero() {
        // `reg query /s` on the display class prints every adapter, then exits 1 because one
        // subkey is access denied: its output is read anyway (the launcher of v0.1.2 threw it
        // away and found no graphics card on any Windows).
        let ran = output_any(prints_and_exits("adapters", 1), Duration::from_secs(20)).unwrap();
        assert_eq!(ran.stdout.trim_end(), "adapters");
        assert_eq!(ran.code, Some(1));
        assert!(!ran.success());
        assert_eq!(ran.stderr.trim_end(), "ERROR: Access is denied.");
        assert_eq!(ran.exit_text(), "exit 1 (\"ERROR: Access is denied.\")");
        // The strict reading still means "only a success counts", for the callers that want it.
        assert_eq!(
            output(prints_and_exits("adapters", 1), Duration::from_secs(20)),
            None
        );
        let ok = output_any(prints_and_exits("fine", 0), Duration::from_secs(20)).unwrap();
        assert!(ok.success() && ok.stdout.trim_end() == "fine");
        assert_eq!(
            output(prints_and_exits("fine", 0), Duration::from_secs(20))
                .as_deref()
                .map(str::trim_end),
            Some("fine")
        );
    }

    #[test]
    fn says_why_there_is_nothing() {
        let e = output_any(command("/nonexistent/program", &[]), Duration::from_secs(1));
        assert!(e.unwrap_err().starts_with("cannot start it"));
        assert_eq!(
            output(command("/nonexistent/program", &[]), Duration::from_secs(1)),
            None
        );
    }

    #[test]
    fn decodes_utf8_and_utf16_with_its_mark() {
        assert_eq!(decode(b"NVIDIA \xc3\xb1"), "NVIDIA ñ");
        assert_eq!(decode(&[0xFF, 0xFE, b'A', 0, 0xF1, 0, b'\n', 0]), "Añ\n");
        assert_eq!(decode(b"bad \xff"), "bad \u{fffd}");
    }

    #[test]
    fn system_programs_by_their_absolute_path() {
        let reg = system32(&["reg.exe"]);
        if cfg!(windows) {
            assert!(reg.is_absolute() && reg.is_file(), "{}", reg.display());
            assert!(reg.ends_with("System32/reg.exe") || reg.ends_with(r"System32\reg.exe"));
        } else if std::env::var_os("SystemRoot").is_none() {
            assert_eq!(reg, PathBuf::from("reg.exe"));
        }
        assert_eq!(
            system32(&["no-such-dir", "nothing.exe"]),
            PathBuf::from("nothing.exe")
        );
    }

    #[cfg(unix)]
    #[test]
    fn captures_output_and_enforces_the_limit() {
        assert_eq!(
            output(command("sh", &["-c", "echo hi"]), Duration::from_secs(5)).as_deref(),
            Some("hi\n")
        );
        assert_eq!(
            output(command("sh", &["-c", "exit 3"]), Duration::from_secs(5)),
            None
        );
        let start = Instant::now();
        assert_eq!(
            output(
                command("sh", &["-c", "sleep 5"]),
                Duration::from_millis(200)
            ),
            None
        );
        let e = output_any(
            command("sh", &["-c", "sleep 5"]),
            Duration::from_millis(200),
        );
        assert!(e.unwrap_err().starts_with("no answer within"));
        assert!(start.elapsed() < Duration::from_secs(4));
        // A grandchild that keeps the output open does not hold the answer back for long.
        let start = Instant::now();
        let ran = output_any(
            command("sh", &["-c", "echo early; sleep 6 & exit 0"]),
            Duration::from_secs(10),
        )
        .unwrap();
        assert!(ran.success() && ran.stdout == "early\n", "{ran:?}");
        assert!(start.elapsed() < Duration::from_secs(5));
    }
}
