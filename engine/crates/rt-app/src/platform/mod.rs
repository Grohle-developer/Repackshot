//! The native window (phase P3c): on Windows, a Win32 window of our own with the system's title
//! bar (our icon, `Repackshot — <project>`, dark with a dark theme, its own taskbar identity) and
//! **WebView2** in it, so that nothing on screen is a browser's — no menus, bars, dialogs,
//! prompts or second windows; closing asks with the page's own question. Where it cannot open
//! (another system, no WebView2 runtime, a failure at any step), the launcher falls back to the
//! Edge/Chromium app window of `browser.rs` and says why in the log and in `/api/info`
//! (`window`).
//!
//! **`unsafe` lives here and only here** (CLAUDE.md rule 8b): Win32 and WebView2's COM
//! interface can only be reached through FFI. Every `unsafe` block says why it is sound. The
//! split:
//!
//! * plain Rust, compiled and tested on every system: [`com`] (GUIDs, `IUnknown`, our own COM
//!   objects), [`webview2`] (the interface layouts, checked against the IDL's method counts),
//!   [`protocol`] (the messages with the page), [`state`] (where the window was), [`policy`]
//!   (what the web view may do), [`flags`] (Chromium switches);
//! * Windows only: `win32` (the system functions), `window` (the window: icon, title, theme,
//!   place, size, the close it asks about), `host` (WebView2: loader, environment, controller,
//!   settings, events, the message loop, the AppUserModelID).
//!
//! The loader is Microsoft's `WebView2Loader.dll`, shipped next to `repackshot.exe` (the
//! release pins its SHA-256; see `packaging/lib/webview2.mjs`); the runtime is the WebView2
//! Evergreen runtime that Windows 10 and 11 keep up to date.

pub mod com;
pub mod flags;
pub mod policy;
pub mod protocol;
pub mod shortcut;
pub mod state;
pub mod webview2;

#[cfg(windows)]
mod host;
#[cfg(windows)]
mod win32;
#[cfg(windows)]
mod window;

use crate::json;
use std::path::PathBuf;
use std::sync::{Mutex, PoisonError};

/// The process's AppUserModelID: the taskbar shows our icon and groups our windows under it. The
/// installer's shortcuts carry the same ID (`System.AppUserModel.ID`, written by `repackshot
/// --shortcut-id`, [`shortcut`]), so a pinned shortcut and the running window are one taskbar
/// button (Microsoft, *Application User Model IDs*).
pub const APP_USER_MODEL_ID: &str = "Repackshot.App";

/// `--window`: which window to open.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum WindowChoice {
    /// Our own window where possible, else the browser's (the default).
    #[default]
    Auto,
    /// Only our own window: fail rather than fall back (for debugging).
    WebView2,
    /// The browser's app window, as before P3c.
    Browser,
}

impl WindowChoice {
    /// `webview2`, `browser` or `auto`.
    pub fn parse(text: &str) -> Option<WindowChoice> {
        match text {
            "auto" => Some(WindowChoice::Auto),
            "webview2" => Some(WindowChoice::WebView2),
            "browser" => Some(WindowChoice::Browser),
            _ => None,
        }
    }
}

/// Why the window is not our own.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Reason {
    /// `--window=browser`.
    Forced,
    /// Not Windows: the browser's app window is the window there (a native one is phase P3d).
    NotWindows,
    /// `WebView2Loader.dll` is not next to the program.
    LoaderMissing,
    /// The WebView2 runtime is not installed.
    RuntimeMissing,
    /// Something else failed (the log says what).
    Failed,
}

impl Reason {
    /// The code `/api/info` gives (the interface words it in each language).
    pub fn code(self) -> &'static str {
        match self {
            Reason::Forced => "forced",
            Reason::NotWindows => "not-windows",
            Reason::LoaderMissing => "loader-missing",
            Reason::RuntimeMissing => "runtime-missing",
            Reason::Failed => "failed",
        }
    }
}

/// Our own window could not open (or broke before the page came up).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Unavailable {
    /// Why, for the interface.
    pub reason: Reason,
    /// The details, for the log (in English).
    pub detail: String,
}

impl Unavailable {
    /// A reason with its details.
    pub fn new(reason: Reason, detail: impl Into<String>) -> Unavailable {
        Unavailable {
            reason,
            detail: detail.into(),
        }
    }
}

impl std::fmt::Display for Unavailable {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        if self.detail.is_empty() {
            f.write_str(self.reason.code())
        } else {
            write!(f, "{}: {}", self.reason.code(), self.detail)
        }
    }
}

/// What draws the window, for `/api/info` (`window`) and Settings ▸ Desktop.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct WindowReport {
    /// `webview2`, `browser` (an app window), `default` (the default browser) or `none`.
    pub kind: String,
    /// The WebView2 version, or the browser's name (`msedge`, `chromium`...).
    pub detail: Option<String>,
    /// Why it is not our own window, when it is not.
    pub reason: Option<Reason>,
}

impl WindowReport {
    /// Our own window, with the runtime's version.
    pub fn webview2(version: &str) -> WindowReport {
        WindowReport {
            kind: "webview2".into(),
            detail: Some(version.to_string()),
            reason: None,
        }
    }

    /// The fallback: `browser` is what `browser.rs` opened (`None`: nothing could be opened,
    /// `"default"`: the default browser).
    pub fn fallback(browser: Option<&str>, reason: Option<Reason>) -> WindowReport {
        let kind = match browser {
            None => "none",
            Some("default") => "default",
            Some(_) => "browser",
        };
        WindowReport {
            kind: kind.into(),
            detail: browser.filter(|b| *b != "default").map(str::to_string),
            reason,
        }
    }

    /// The JSON object of `/api/info`'s `window`.
    pub fn to_json(&self) -> String {
        json::Object::new()
            .str("kind", &self.kind)
            .opt_str("detail", self.detail.as_deref())
            .opt_str("reason", self.reason.map(Reason::code))
            .build()
    }
}

static REPORT: Mutex<Option<WindowReport>> = Mutex::new(None);

/// Records what draws the window.
pub fn set_report(report: WindowReport) {
    *REPORT.lock().unwrap_or_else(PoisonError::into_inner) = Some(report);
}

/// `/api/info`'s `window`: the report, or `null` before the window opens (`--serve-only`).
pub fn report_json() -> String {
    REPORT
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .as_ref()
        .map_or_else(|| "null".to_string(), WindowReport::to_json)
}

/// Whether to try our own window: `Err` with the reason when not.
pub fn plan(choice: WindowChoice, windows: bool) -> Result<(), Reason> {
    match (choice, windows) {
        (WindowChoice::Browser, _) => Err(Reason::Forced),
        (_, false) => Err(Reason::NotWindows),
        _ => Ok(()),
    }
}

/// What the native window needs.
pub struct HostOptions {
    /// The page, `http://127.0.0.1:<port>/#token=<hex>`.
    pub url: String,
    /// Its origin, `http://127.0.0.1:<port>`: the only place the web view may go.
    pub origin: String,
    /// The data folder: `window.json` and the WebView2 profile (`webview2/`) go there.
    pub data_dir: PathBuf,
    /// The program's folder, where `WebView2Loader.dll` is.
    pub exe_dir: PathBuf,
    /// Whether the page's heartbeat is recent: a page that stopped answering is not asked
    /// before closing.
    pub page_alive: std::rc::Rc<dyn Fn() -> bool>,
    /// Hears the window's handle once it exists, and 0 when it is gone: the system's dialogs
    /// (`dialogs.rs`) open in front of it, owned by it.
    pub on_window: std::rc::Rc<dyn Fn(u64)>,
}

/// The origin of a launcher URL (`http://127.0.0.1:<port>`).
pub fn origin_of(url: &str) -> String {
    let after = url.find("://").map_or(0, |i| i + 3);
    let end = url[after..]
        .find(['/', '?', '#'])
        .map_or(url.len(), |i| after + i);
    url[..end].to_string()
}

/// The WebView2 profile in the data folder (cookies, `localStorage`, IndexedDB, caches).
pub fn webview2_profile(data_dir: &std::path::Path) -> PathBuf {
    data_dir.join("webview2")
}

/// Opens our own window and runs it until it closes (`Ok`), or says why it could not
/// (`Err`): then the caller opens the browser's window instead. Sets the report on success.
pub fn run_native_window(opts: &HostOptions) -> Result<(), Unavailable> {
    #[cfg(windows)]
    {
        host::run(opts)
    }
    #[cfg(not(windows))]
    {
        let _ = opts;
        Err(Unavailable::new(Reason::NotWindows, ""))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn choices_and_plans() {
        assert_eq!(
            WindowChoice::parse("webview2"),
            Some(WindowChoice::WebView2)
        );
        assert_eq!(WindowChoice::parse("browser"), Some(WindowChoice::Browser));
        assert_eq!(WindowChoice::parse("auto"), Some(WindowChoice::Auto));
        assert_eq!(WindowChoice::parse("WebView2"), None);
        assert_eq!(plan(WindowChoice::Auto, true), Ok(()));
        assert_eq!(plan(WindowChoice::WebView2, true), Ok(()));
        assert_eq!(plan(WindowChoice::Browser, true), Err(Reason::Forced));
        assert_eq!(plan(WindowChoice::Auto, false), Err(Reason::NotWindows));
        assert_eq!(plan(WindowChoice::Browser, false), Err(Reason::Forced));
        if !cfg!(windows) {
            let o = HostOptions {
                url: String::new(),
                origin: String::new(),
                data_dir: PathBuf::new(),
                exe_dir: PathBuf::new(),
                page_alive: std::rc::Rc::new(|| true),
                on_window: std::rc::Rc::new(|_| ()),
            };
            assert_eq!(
                run_native_window(&o).unwrap_err().reason,
                Reason::NotWindows
            );
        }
    }

    #[test]
    fn reports_for_the_interface() {
        assert_eq!(
            WindowReport::webview2("129.0.2792.65").to_json(),
            r#"{"kind":"webview2","detail":"129.0.2792.65","reason":null}"#
        );
        assert_eq!(
            WindowReport::fallback(Some("msedge"), Some(Reason::RuntimeMissing)).to_json(),
            r#"{"kind":"browser","detail":"msedge","reason":"runtime-missing"}"#
        );
        assert_eq!(
            WindowReport::fallback(Some("default"), Some(Reason::LoaderMissing)).to_json(),
            r#"{"kind":"default","detail":null,"reason":"loader-missing"}"#
        );
        assert_eq!(
            WindowReport::fallback(Some("chromium"), None).to_json(),
            r#"{"kind":"browser","detail":"chromium","reason":null}"#
        );
        assert_eq!(
            WindowReport::fallback(None, Some(Reason::Failed)).kind,
            "none"
        );
        for r in [
            Reason::Forced,
            Reason::NotWindows,
            Reason::LoaderMissing,
            Reason::RuntimeMissing,
            Reason::Failed,
        ] {
            assert!(r.code().chars().all(|c| c.is_ascii_lowercase() || c == '-'));
        }
        assert_eq!(
            Unavailable::new(Reason::Failed, "CreateWindowExW: 5").to_string(),
            "failed: CreateWindowExW: 5"
        );
        assert_eq!(Unavailable::new(Reason::Forced, "").to_string(), "forced");
    }

    #[test]
    fn origins_of_launcher_urls() {
        assert_eq!(
            origin_of("http://127.0.0.1:8123/#token=ab"),
            "http://127.0.0.1:8123"
        );
        assert_eq!(
            origin_of("http://127.0.0.1:8123#token=ab"),
            "http://127.0.0.1:8123"
        );
        assert_eq!(origin_of("http://127.0.0.1:8123"), "http://127.0.0.1:8123");
        assert_eq!(
            webview2_profile(std::path::Path::new("/d")),
            PathBuf::from("/d/webview2")
        );
    }
}
