//! What the native window lets the web view do, as plain data and functions the Windows host
//! applies (and the tests check on every platform). The rule (ROADMAP P3c): **nothing that is
//! not Repackshot's own interface ever appears** — no browser menu, dialog, bar, bubble,
//! download shelf or second window; links to the web open in the person's browser.

use super::webview2::{
    DIALOG_BEFOREUNLOAD, PERMISSION_ALLOW, PERMISSION_DENY, PERMISSION_KIND_FILE_READ_WRITE,
    PERMISSION_KIND_PERSISTENT_STORAGE,
};

/// The `ICoreWebView2Settings*` values the host sets (the interface that has each in brackets).
/// Settings that a runtime too old to have their interface lacks are logged and skipped: the
/// defaults of those runtimes are the old behaviour, never a new web prompt.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct HostSettings {
    /// `IsScriptEnabled` (1): the interface is JavaScript.
    pub script: bool,
    /// `IsWebMessageEnabled` (1): the page talks to the window with `postMessage`.
    pub web_message: bool,
    /// `AreDefaultScriptDialogsEnabled` (1): no browser `alert`/`confirm`/`prompt`/"leave site?"
    /// box; `ScriptDialogOpening` is answered instead.
    pub default_script_dialogs: bool,
    /// `IsStatusBarEnabled` (1): no link preview in the bottom corner.
    pub status_bar: bool,
    /// `AreDevToolsEnabled` (1): only in debug builds.
    pub dev_tools: bool,
    /// `AreDefaultContextMenusEnabled` (1): no browser menu on right click.
    pub default_context_menus: bool,
    /// `AreHostObjectsAllowed` (1): no COM objects in the page.
    pub host_objects: bool,
    /// `IsZoomControlEnabled` (1): Ctrl + wheel, Ctrl + / - do not zoom the whole page.
    pub zoom_control: bool,
    /// `IsBuiltInErrorPageEnabled` (1): no browser error page (the host falls back instead).
    pub built_in_error_page: bool,
    /// `AreBrowserAcceleratorKeysEnabled` (3): no F5, Ctrl R, Ctrl F, Ctrl P, Ctrl S of the
    /// browser; the page gets those keys.
    pub browser_accelerator_keys: bool,
    /// `IsPasswordAutosaveEnabled` (4).
    pub password_autosave: bool,
    /// `IsGeneralAutofillEnabled` (4): no autofill suggestions under text fields.
    pub general_autofill: bool,
    /// `IsPinchZoomEnabled` (5): a touchpad pinch does not zoom the page.
    pub pinch_zoom: bool,
    /// `IsSwipeNavigationEnabled` (6): a two-finger swipe does not go back.
    pub swipe_navigation: bool,
    /// `IsReputationCheckingRequired` (8): no SmartScreen lookups of our own local pages.
    pub reputation_checking: bool,
}

/// The settings of the host; `debug` keeps the developer tools.
pub fn host_settings(debug: bool) -> HostSettings {
    HostSettings {
        script: true,
        web_message: true,
        default_script_dialogs: false,
        status_bar: false,
        dev_tools: debug,
        default_context_menus: false,
        host_objects: false,
        zoom_control: false,
        built_in_error_page: false,
        browser_accelerator_keys: false,
        password_autosave: false,
        general_autofill: false,
        pinch_zoom: false,
        swipe_navigation: false,
        reputation_checking: false,
    }
}

/// What to do with a navigation or a new window.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Navigation {
    /// Our own page: go ahead.
    Allow,
    /// Not ours: cancel.
    Block,
    /// A link to the web the person clicked: cancel here, open in the default browser.
    OpenExternally(String),
}

/// Whether `uri` is on `origin` (`http://127.0.0.1:<port>`, no trailing slash): the origin,
/// then the end or one of `/ ? #` (so `http://127.0.0.1:80800` and `...:8080@evil` are not).
pub fn same_origin(uri: &str, origin: &str) -> bool {
    uri.len() >= origin.len()
        && uri.is_char_boundary(origin.len())
        && uri[..origin.len()].eq_ignore_ascii_case(origin)
        && matches!(
            uri.as_bytes().get(origin.len()),
            None | Some(b'/' | b'?' | b'#')
        )
}

/// `uri` when it is a plain `https://` address worth handing to the system's browser: a host,
/// no spaces or control characters, no credentials, at most 2048 characters.
pub fn external_https(uri: &str) -> Option<&str> {
    let rest = uri
        .get(..8)
        .filter(|s| s.eq_ignore_ascii_case("https://"))
        .map(|_| &uri[8..])?;
    let host_end = rest.find(['/', '?', '#']).unwrap_or(rest.len());
    let authority = &rest[..host_end];
    let ok = uri.len() <= 2048
        && !authority.is_empty()
        && !authority.contains('@')
        && !uri
            .chars()
            .any(|c| c.is_whitespace() || c.is_control() || c == '"');
    ok.then_some(uri)
}

/// A navigation of the main page (`NavigationStarting`) or of a frame (`frame`).
pub fn navigation(uri: &str, origin: &str, user_initiated: bool, frame: bool) -> Navigation {
    if same_origin(uri, origin) {
        return Navigation::Allow;
    }
    match external_https(uri) {
        Some(u) if user_initiated && !frame => Navigation::OpenExternally(u.to_string()),
        _ => Navigation::Block,
    }
}

/// A new window the page asked for (`target="_blank"`, `window.open`): never one of ours; a
/// clicked web link goes to the default browser.
pub fn new_window(uri: &str, user_initiated: bool) -> Navigation {
    match external_https(uri) {
        Some(u) if user_initiated => Navigation::OpenExternally(u.to_string()),
        _ => Navigation::Block,
    }
}

/// The answer to a permission request (`PermissionRequested`): denied, except for our own page
/// writing a file or folder the person chose in the system's dialog and keeping its storage,
/// which a desktop program does without asking. Answering is what keeps the browser's
/// permission bubble from ever appearing.
pub fn permission(kind: i32, ours: bool) -> i32 {
    match kind {
        PERMISSION_KIND_FILE_READ_WRITE | PERMISSION_KIND_PERSISTENT_STORAGE if ours => {
            PERMISSION_ALLOW
        }
        _ => PERMISSION_DENY,
    }
}

/// The answer to a script dialog (`ScriptDialogOpening`, with the browser's own dialogs off).
/// `true`: `Accept()`. A "leave this page?" is accepted (the window never navigates away; the
/// question about unsaved work is ours, on close); `alert`, `confirm` and `prompt` are
/// dismissed (`confirm` gives false, `prompt` null): the interface never uses them.
pub fn accept_script_dialog(kind: i32) -> bool {
    kind == DIALOG_BEFOREUNLOAD
}

#[cfg(test)]
mod tests {
    use super::super::webview2::{DIALOG_ALERT, DIALOG_CONFIRM, DIALOG_PROMPT};
    use super::*;

    const O: &str = "http://127.0.0.1:8080";

    #[test]
    fn everything_that_is_not_our_interface_is_off() {
        let s = host_settings(false);
        assert!(s.script && s.web_message);
        for (name, on) in [
            ("default script dialogs", s.default_script_dialogs),
            ("status bar", s.status_bar),
            ("dev tools", s.dev_tools),
            ("context menus", s.default_context_menus),
            ("host objects", s.host_objects),
            ("zoom control", s.zoom_control),
            ("error page", s.built_in_error_page),
            ("accelerator keys", s.browser_accelerator_keys),
            ("password autosave", s.password_autosave),
            ("autofill", s.general_autofill),
            ("pinch zoom", s.pinch_zoom),
            ("swipe navigation", s.swipe_navigation),
            ("reputation checking", s.reputation_checking),
        ] {
            assert!(!on, "{name} must be off in a release build");
        }
        assert!(host_settings(true).dev_tools);
        assert_eq!(
            host_settings(true),
            HostSettings {
                dev_tools: true,
                ..s
            }
        );
    }

    #[test]
    fn navigation_stays_on_our_origin() {
        assert!(same_origin("http://127.0.0.1:8080/", O));
        assert!(same_origin("http://127.0.0.1:8080/#token=ab", O));
        assert!(same_origin("http://127.0.0.1:8080", O));
        assert!(same_origin("HTTP://127.0.0.1:8080/x?y", O));
        for other in [
            "http://127.0.0.1:80800/",
            "http://127.0.0.1:8080@evil.example/",
            "http://127.0.0.1:8080.evil.example/",
            "http://127.0.0.1:8081/",
            "http://localhost:8080/",
            "https://127.0.0.1:8080/",
            "file:///C:/Windows/",
            "about:blank",
            "",
        ] {
            assert!(!same_origin(other, O), "{other}");
        }
        assert_eq!(
            navigation("http://127.0.0.1:8080/app", O, false, false),
            Navigation::Allow
        );
        assert_eq!(
            navigation("https://github.com/x", O, true, false),
            Navigation::OpenExternally("https://github.com/x".into())
        );
        // Not clicked, in a frame, or not https: blocked and nothing opens.
        assert_eq!(
            navigation("https://github.com/x", O, false, false),
            Navigation::Block
        );
        assert_eq!(
            navigation("https://github.com/x", O, true, true),
            Navigation::Block
        );
        for blocked in [
            "http://example.com/",
            "file:///C:/",
            "mailto:a@b.c",
            "javascript:alert(1)",
            "data:text/html,x",
            "ms-settings:",
        ] {
            assert_eq!(
                navigation(blocked, O, true, false),
                Navigation::Block,
                "{blocked}"
            );
        }
    }

    #[test]
    fn new_windows_never_open_here() {
        assert_eq!(
            new_window(
                "https://polyformproject.org/licenses/noncommercial/1.0.0/",
                true
            ),
            Navigation::OpenExternally(
                "https://polyformproject.org/licenses/noncommercial/1.0.0/".into()
            )
        );
        assert_eq!(new_window("https://example.com/", false), Navigation::Block);
        assert_eq!(
            new_window("http://127.0.0.1:8080/", true),
            Navigation::Block
        );
        for odd in [
            "https://",
            "https:///x",
            "https://a b/",
            "https://user:pw@host/",
            "https://h/\"x",
        ] {
            assert_eq!(external_https(odd), None, "{odd}");
        }
        assert_eq!(
            external_https(&format!("https://h/{}", "a".repeat(3000))),
            None
        );
    }

    #[test]
    fn permissions_are_denied_but_our_own_files_and_storage() {
        for kind in 0..14 {
            let ours = permission(kind, true);
            let expected = if kind == PERMISSION_KIND_FILE_READ_WRITE
                || kind == PERMISSION_KIND_PERSISTENT_STORAGE
            {
                PERMISSION_ALLOW
            } else {
                PERMISSION_DENY
            };
            assert_eq!(ours, expected, "kind {kind}");
            assert_eq!(
                permission(kind, false),
                PERMISSION_DENY,
                "kind {kind} of another origin"
            );
        }
        assert_eq!(permission(99, true), PERMISSION_DENY);
    }

    #[test]
    fn script_dialogs_never_show() {
        assert!(accept_script_dialog(DIALOG_BEFOREUNLOAD));
        for kind in [DIALOG_ALERT, DIALOG_CONFIRM, DIALOG_PROMPT, 7] {
            assert!(!accept_script_dialog(kind));
        }
    }
}
