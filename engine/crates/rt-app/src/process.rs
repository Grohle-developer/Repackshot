//! Running system programs (`reg`, `powershell`, `nvidia-smi`, the browser, `xdg-open`): with a
//! time limit, without a console window on Windows, and never through a shell string.

use std::io::Read;
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

/// `CREATE_NO_WINDOW`: a console program started by the (windowless) launcher shows no window.
#[cfg(windows)]
pub const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Prepares `program` with `args` and no console window.
pub fn command(program: &str, args: &[&str]) -> Command {
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

/// Runs `cmd` and returns its standard output if it exits successfully within `limit`; a program
/// that takes longer is killed. Standard error is discarded.
pub fn output(mut cmd: Command, limit: Duration) -> Option<String> {
    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    let mut child = cmd.spawn().ok()?;
    let mut stdout = child.stdout.take()?;
    // Read on another thread so a chatty program cannot block on a full pipe.
    let reader = std::thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = stdout.read_to_end(&mut buf);
        buf
    });
    if !wait(&mut child, limit) {
        let _ = child.kill();
        let _ = child.wait();
        // A grandchild may still hold the pipe: leave the reader to finish on its own.
        return None;
    }
    let bytes = reader.join().ok()?;
    Some(String::from_utf8_lossy(&bytes).into_owned())
}

/// Waits for `child` up to `limit`; true when it exited successfully.
fn wait(child: &mut Child, limit: Duration) -> bool {
    let start = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return status.success(),
            Ok(None) if start.elapsed() < limit => std::thread::sleep(Duration::from_millis(20)),
            _ => return false,
        }
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;

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
        assert!(start.elapsed() < Duration::from_secs(3));
        assert_eq!(
            output(command("/nonexistent/program", &[]), Duration::from_secs(1)),
            None
        );
    }
}
