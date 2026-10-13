//! The window: an app window (`--app=<url>`) of Edge on Windows (it comes with the system) or of
//! the first Chromium-family browser found on Linux, with its own profile in the data folder;
//! the default browser when there is none. `REPACKSHOT_BROWSER` names a browser to use instead.

use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::Duration;

/// Browsers tried on Linux, in order.
pub const LINUX_BROWSERS: [&str; 7] = [
    "chromium",
    "chromium-browser",
    "google-chrome",
    "google-chrome-stable",
    "microsoft-edge",
    "microsoft-edge-stable",
    "brave-browser",
];

/// The command line of the app window.
pub fn app_args(url: &str, profile: &Path) -> Vec<OsString> {
    let mut profile_arg = OsString::from("--user-data-dir=");
    profile_arg.push(profile);
    let mut args: Vec<OsString> = vec![
        format!("--app={url}").into(),
        profile_arg,
        "--no-first-run".into(),
        "--no-default-browser-check".into(),
        "--window-size=1600,1000".into(),
        // The page's heartbeat keeps the launcher alive: timers must not be throttled when the
        // window is minimised or covered.
        "--disable-background-timer-throttling".into(),
        "--disable-backgrounding-occluded-windows".into(),
        "--disable-renderer-backgrounding".into(),
    ];
    if cfg!(target_os = "linux") {
        args.push("--class=Repackshot".into());
    }
    args
}

/// The browser for the app window: `REPACKSHOT_BROWSER`, else Edge or Chrome (Windows) or the
/// first of [`LINUX_BROWSERS`] on `PATH`.
pub fn find() -> Option<PathBuf> {
    if let Some(p) = std::env::var_os("REPACKSHOT_BROWSER").filter(|p| !p.is_empty()) {
        return Some(PathBuf::from(p));
    }
    if cfg!(windows) {
        find_windows()
    } else {
        let path = std::env::var_os("PATH")?;
        LINUX_BROWSERS.iter().find_map(|name| {
            std::env::split_paths(&path)
                .map(|dir| dir.join(name))
                .find(|p| p.is_file())
        })
    }
}

/// Expands `%VAR%` in a registry path.
fn expand(text: &str) -> String {
    let mut out = String::new();
    let mut rest = text;
    while let Some(start) = rest.find('%') {
        out.push_str(&rest[..start]);
        let after = &rest[start + 1..];
        match after.find('%') {
            Some(end) => {
                let name = &after[..end];
                match std::env::var(name) {
                    Ok(v) => out.push_str(&v),
                    Err(_) => {
                        out.push('%');
                        out.push_str(name);
                        out.push('%');
                    }
                }
                rest = &after[end + 1..];
            }
            None => {
                out.push_str(&rest[start..]);
                rest = "";
            }
        }
    }
    out.push_str(rest);
    out
}

/// The executable registered under `App Paths\<exe>` (`reg query ... /ve`).
fn app_path(root: &str, exe: &str) -> Option<PathBuf> {
    let key = format!(r"{root}\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\{exe}");
    let out = crate::process::output(
        crate::process::command("reg", &["query", &key, "/ve"]),
        Duration::from_secs(5),
    )?;
    out.lines()
        .filter_map(crate::hardware::parse_reg_value)
        .find(|(_, kind, _)| kind.starts_with("REG_SZ") || kind.starts_with("REG_EXPAND_SZ"))
        .map(|(_, _, data)| PathBuf::from(expand(data.trim_matches('"'))))
        .filter(|p| p.is_file())
}

fn find_windows() -> Option<PathBuf> {
    let env = |name: &str| std::env::var_os(name).map(PathBuf::from);
    for exe in ["msedge.exe", "chrome.exe"] {
        for root in ["HKCU", "HKLM"] {
            if let Some(p) = app_path(root, exe) {
                return Some(p);
            }
        }
        let rel: &[&str] = if exe == "msedge.exe" {
            &["Microsoft", "Edge", "Application", "msedge.exe"]
        } else {
            &["Google", "Chrome", "Application", "chrome.exe"]
        };
        for base in ["ProgramFiles(x86)", "ProgramFiles", "LOCALAPPDATA"]
            .iter()
            .filter_map(|v| env(v))
        {
            let p = rel.iter().fold(base, |p, part| p.join(part));
            if p.is_file() {
                return Some(p);
            }
        }
    }
    None
}

/// A short name for a browser path (`msedge`, `chromium`...), for `/api/info`.
pub fn name_of(path: &Path) -> String {
    path.file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default()
}

/// Opens the app window.
pub fn launch_app(browser: &Path, url: &str, profile: &Path) -> std::io::Result<Child> {
    let mut cmd = Command::new(browser);
    cmd.args(app_args(url, profile))
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    cmd.spawn()
}

/// Opens `url` in the default browser.
pub fn open_default(url: &str) -> std::io::Result<Child> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // `start "" "<url>"`: the quoted URL keeps `&` and `#` away from cmd; raw_arg keeps the
        // quotes exactly as written. The URL is ours: http://127.0.0.1:<port>/#token=<hex>.
        let mut cmd = Command::new("cmd");
        cmd.raw_arg(format!("/C start \"\" \"{url}\""));
        crate::process::no_window(&mut cmd);
        cmd.stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        cmd.spawn()
    }
    #[cfg(not(windows))]
    {
        Command::new("xdg-open")
            .arg(url)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
    }
}

/// Shows a folder in the file manager.
pub fn open_folder(path: &Path) -> std::io::Result<()> {
    let program = if cfg!(windows) {
        "explorer"
    } else {
        "xdg-open"
    };
    let mut cmd = Command::new(program);
    cmd.arg(path)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    crate::process::no_window(&mut cmd);
    let mut child = cmd.spawn()?;
    // Reap it in the background (explorer exits with 1 even when it worked).
    std::thread::spawn(move || {
        let _ = child.wait();
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn app_window_arguments() {
        let args = app_args(
            "http://127.0.0.1:5/#token=ab",
            Path::new("/d/browser-profile"),
        );
        let args: Vec<String> = args
            .iter()
            .map(|a| a.to_string_lossy().into_owned())
            .collect();
        assert_eq!(args[0], "--app=http://127.0.0.1:5/#token=ab");
        assert_eq!(args[1], "--user-data-dir=/d/browser-profile");
        for flag in [
            "--no-first-run",
            "--no-default-browser-check",
            "--window-size=1600,1000",
        ] {
            assert!(args.iter().any(|a| a == flag), "{flag}");
        }
        assert_eq!(
            args.iter().any(|a| a == "--class=Repackshot"),
            cfg!(target_os = "linux")
        );
        assert_eq!(
            name_of(Path::new("/usr/bin/chromium-browser")),
            "chromium-browser"
        );
    }

    #[test]
    fn expands_environment_variables() {
        std::env::set_var("RT_APP_TEST_VAR", "C:\\PF");
        assert_eq!(expand("%RT_APP_TEST_VAR%\\x.exe"), "C:\\PF\\x.exe");
        assert_eq!(expand("%NO_SUCH_VAR_HERE%\\x"), "%NO_SUCH_VAR_HERE%\\x");
        assert_eq!(expand("50%"), "50%");
    }
}
