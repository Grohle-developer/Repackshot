//! The window: an app window (`--app=<url>`) of Edge on Windows (it comes with the system) or of
//! the first Chromium-family browser found on Linux, with its own profile in the data folder;
//! the default browser when there is none. `REPACKSHOT_BROWSER` names a browser to use instead.

use crate::json::{self, Value};
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

/// Chromium and Edge features turned off in the app window (`--disable-features=`; a WebView2
/// host passes the same list in its additional browser arguments). An unknown name is ignored,
/// so the Edge names do nothing in Chromium and the other way round. The Chromium names were
/// checked against the strings of Chromium 141 (base::Feature names); sources for each are in
/// `engine/crates/rt-app/README.md` (*Ventana sin navegador*).
pub const DISABLED_FEATURES: [&str; 9] = [
    // The translate bubble and its icon ("Translate this page?").
    "Translate",
    // The on-device page-language model that decides to offer a translation.
    "TFLiteLanguageDetectionEnabled",
    // Autofill's server predictions for the fields of a page.
    "AutofillServerCommunication",
    // Media keys and the system's media overlay.
    "HardwareMediaKeyHandling",
    // The Privacy Sandbox notice a new Chrome profile shows.
    "PrivacySandboxSettings4",
    // The Google Lens overlay (Chrome).
    "LensOverlay",
    // Background downloads of optimisation hints.
    "OptimizationHints",
    // Edge: the mini menu on text selection ("Hide menu · More actions · Copy · Search") on
    // pages and on PDFs (reported in Microsoft Q&A for kiosk windows; the profile preference
    // `edge_quick_search.show_mini_menu` below turns it off too).
    "msWebOOUI",
    "msPdfOOUI",
];

/// Switches of the app window that keep the browser's own interface away from it, each one
/// documented in Chromium's switch lists (`chrome_switches.cc`, `content_switches.cc`) and
/// present in Chromium 141. A WebView2 host can pass the same ones.
pub const HARDENING_SWITCHES: [&str; 16] = [
    // No first-run page or import, no "make this your default browser" bar.
    "--no-first-run",
    "--no-default-browser-check",
    // No "restore pages?" bubble after a crash.
    "--hide-crash-restore-bubble",
    // No sign-in or sync prompts, no extensions, no default apps.
    "--disable-sync",
    "--disable-extensions",
    "--disable-default-apps",
    // No component downloads and no background requests (translate models, hints, pings).
    "--disable-component-update",
    "--disable-background-networking",
    "--disable-domain-reliability",
    "--no-pings",
    // Permission prompts are denied instead of shown; no notifications.
    "--deny-permission-prompts",
    "--disable-notifications",
    // No search engine choice dialog (Chrome in the EEA) and no info bars.
    "--disable-search-engine-choice-screen",
    "--disable-infobars",
    // No pinch zoom, no swipe to go back or forward.
    "--disable-pinch",
    "--overscroll-history-navigation=0",
];

/// Environment of the app window's browser on Linux: a Chromium build without Google API keys
/// (Arch Linux's, Playwright's) shows a "Google API keys are missing" bar at the top of every
/// window unless these are set; any value counts, and the window uses no Google service (sync and
/// translation are off). Checked with Chromium 141 under Xvfb (`tools/desktop-window-check.mjs`).
pub const QUIET_ENV: [(&str, &str); 3] = [
    ("GOOGLE_API_KEY", "no"),
    ("GOOGLE_DEFAULT_CLIENT_ID", "no"),
    ("GOOGLE_DEFAULT_CLIENT_SECRET", "no"),
];

/// The page polls the native renderer and keeps the launcher's heartbeat: a minimised or covered
/// window must not slow its timers or its renderer. The app window passes these, and so does the
/// WebView2 window of `platform` (its additional browser arguments, `platform::flags`).
pub const NO_THROTTLING_SWITCHES: [&str; 3] = [
    "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
];

/// `--disable-features=<DISABLED_FEATURES>`.
pub fn disable_features_arg() -> String {
    format!("--disable-features={}", DISABLED_FEATURES.join(","))
}

/// The command line of the app window.
pub fn app_args(url: &str, profile: &Path) -> Vec<OsString> {
    let mut profile_arg = OsString::from("--user-data-dir=");
    profile_arg.push(profile);
    let mut args: Vec<OsString> = vec![format!("--app={url}").into(), profile_arg];
    args.extend(HARDENING_SWITCHES.iter().map(OsString::from));
    args.push(disable_features_arg().into());
    args.push("--window-size=1600,1000".into());
    args.extend(NO_THROTTLING_SWITCHES.iter().map(OsString::from));
    if cfg!(target_os = "linux") {
        args.push("--class=Repackshot".into());
        // No keyring unlock dialog: the profile keeps no passwords anyway.
        args.push("--password-store=basic".into());
        // No error dialogs of the browser.
        args.push("--noerrdialogs".into());
    }
    args
}

/// Preferences the app window's profile gets before every start (`<profile>/Default/Preferences`,
/// merged into what is there): what the switches cannot turn off. Names checked against
/// Chromium 141's strings; the Edge ones from Microsoft's documentation and Q&A.
pub const PROFILE_PREFERENCES: [(&str, &str); 14] = [
    // "Offer to translate pages": off.
    ("translate.enabled", "false"),
    // No spelling underline, no spelling service.
    ("browser.enable_spellchecking", "false"),
    // No address or card autofill, no password manager or automatic sign-in.
    ("autofill.profile_enabled", "false"),
    ("autofill.credit_card_enabled", "false"),
    ("credentials_enable_service", "false"),
    ("credentials_enable_autosignin", "false"),
    // The last exit was clean: no "restore pages?" bubble.
    ("profile.exit_type", "\"Normal\""),
    // No welcome page, no sign-in.
    ("browser.has_seen_welcome_page", "true"),
    ("signin.allowed", "false"),
    // No navigation error suggestions from the network.
    ("alternate_error_pages.enabled", "false"),
    // Edge: no mini menu or smart actions on selected text (edge://settings/appearance).
    ("edge_quick_search.show_mini_menu", "false"),
    ("edge_quick_search.PDF_show_mini_menu", "false"),
    ("edge_quick_search.show_smart_actions", "false"),
    // A download (the desktop page makes none: it writes through the launcher) never opens
    // the browser's Save As dialog.
    ("download.prompt_for_download", "false"),
];

/// Sets `value` at the dotted `key` of a JSON object, creating the objects on the way.
fn set_path(root: &mut Value, key: &str, value: Value) {
    let mut node = root;
    let mut parts = key.split('.').peekable();
    while let Some(part) = parts.next() {
        if !matches!(node, Value::Object(_)) {
            *node = Value::Object(Vec::new());
        }
        let Value::Object(members) = node else {
            return;
        };
        let i = match members.iter().position(|(k, _)| k == part) {
            Some(i) => i,
            None => {
                members.push((part.to_string(), Value::Object(Vec::new())));
                members.len() - 1
            }
        };
        if parts.peek().is_none() {
            members[i].1 = value;
            return;
        }
        node = &mut members[i].1;
    }
}

/// The profile's preferences with [`PROFILE_PREFERENCES`] merged in; `None` when the text is not
/// a JSON object (a profile the browser is writing, or damaged: left alone).
pub fn merged_preferences(existing: Option<&str>) -> Option<String> {
    let mut root = match existing {
        Some(text) => match json::parse(text) {
            Ok(v @ Value::Object(_)) => v,
            _ => return None,
        },
        None => Value::Object(Vec::new()),
    };
    for (key, value) in PROFILE_PREFERENCES {
        let v = json::parse(value).ok()?;
        set_path(&mut root, key, v);
    }
    Some(root.to_json())
}

/// Writes [`PROFILE_PREFERENCES`] into the profile before the browser starts.
pub fn seed_profile(profile: &Path) -> std::io::Result<()> {
    let dir = profile.join("Default");
    std::fs::create_dir_all(&dir)?;
    let file = dir.join("Preferences");
    let existing = match std::fs::read_to_string(&file) {
        Ok(t) => Some(t),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(e) => return Err(e),
    };
    let Some(text) = merged_preferences(existing.as_deref()) else {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "the profile's Preferences are not a JSON object",
        ));
    };
    let tmp = dir.join("Preferences.repackshot-part");
    std::fs::write(&tmp, text)?;
    std::fs::rename(&tmp, &file)
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
pub(crate) fn expand(text: &str) -> String {
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
    if let Err(e) = seed_profile(profile) {
        crate::log!("browser profile preferences not written: {e}");
    }
    let mut cmd = Command::new(browser);
    if cfg!(target_os = "linux") {
        for (k, v) in QUIET_ENV {
            if std::env::var_os(k).is_none() {
                cmd.env(k, v);
            }
        }
    }
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
            "--hide-crash-restore-bubble",
            "--deny-permission-prompts",
            "--disable-pinch",
            "--overscroll-history-navigation=0",
            "--disable-sync",
        ] {
            assert!(args.iter().any(|a| a == flag), "{flag}");
        }
        let features = args
            .iter()
            .find_map(|a| a.strip_prefix("--disable-features="))
            .expect("--disable-features");
        for f in [
            "Translate",
            "msWebOOUI",
            "msPdfOOUI",
            "AutofillServerCommunication",
        ] {
            assert!(features.split(',').any(|x| x == f), "{f}");
        }
        // One --disable-features only: a second one would replace the first.
        assert_eq!(
            args.iter()
                .filter(|a| a.starts_with("--disable-features"))
                .count(),
            1
        );
        assert_eq!(
            args.iter().any(|a| a == "--password-store=basic"),
            cfg!(target_os = "linux")
        );
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
    fn profile_preferences_are_merged_into_what_is_there() {
        let text = merged_preferences(Some(
            r#"{"translate":{"enabled":true,"x":1},"profile":"odd","keep":{"a":[1,2]}}"#,
        ))
        .unwrap();
        let v = json::parse(&text).unwrap();
        let at = |path: &str| path.split('.').try_fold(&v, |node, k| node.get(k)).cloned();
        assert_eq!(at("translate.enabled"), Some(Value::Bool(false)));
        assert_eq!(at("translate.x"), Some(Value::Number(1.0)));
        assert_eq!(
            at("keep.a").unwrap().as_array().map(<[Value]>::len),
            Some(2)
        );
        assert_eq!(
            at("profile.exit_type"),
            Some(Value::String("Normal".into()))
        );
        assert_eq!(
            at("edge_quick_search.show_mini_menu"),
            Some(Value::Bool(false))
        );
        assert_eq!(at("browser.enable_spellchecking"), Some(Value::Bool(false)));
        assert_eq!(merged_preferences(Some("[1]")), None);
        assert_eq!(merged_preferences(Some("{broken")), None);
        let fresh = json::parse(&merged_preferences(None).unwrap()).unwrap();
        assert_eq!(
            fresh.get("credentials_enable_service"),
            Some(&Value::Bool(false))
        );

        let dir = crate::test_dir("browser-profile");
        seed_profile(&dir).unwrap();
        std::fs::write(
            dir.join("Default/Preferences"),
            r#"{"translate":{"enabled":true},"session":{"restore_on_startup":4}}"#,
        )
        .unwrap();
        seed_profile(&dir).unwrap();
        let v = json::parse(&std::fs::read_to_string(dir.join("Default/Preferences")).unwrap())
            .unwrap();
        assert_eq!(
            v.get("translate").and_then(|t| t.get("enabled")),
            Some(&Value::Bool(false))
        );
        assert_eq!(
            v.get("session").and_then(|t| t.get("restore_on_startup")),
            Some(&Value::Number(4.0))
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
