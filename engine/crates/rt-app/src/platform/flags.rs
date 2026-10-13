//! The additional browser arguments of the WebView2 window, built from the same lists as the
//! Edge/Chromium app window of `browser.rs`, which is their one source:
//!
//! * **[`browser::DISABLED_FEATURES`]** as `--disable-features=…` ([`browser::disable_features_arg`]):
//!   no translation offer, no language model, no autofill server, no media keys overlay, no
//!   Privacy Sandbox notice, no Lens, no optimisation hints, no Edge mini menu on selections;
//! * **[`browser::NO_THROTTLING_SWITCHES`]**: the page polls the native renderer and keeps the
//!   heartbeat; a minimised or covered window must not slow its timers.
//!
//! `browser::HARDENING_SWITCHES` are not passed: they keep the *browser's* own interface away
//! (first run, default-browser bar, sync, extensions, info bars, permission prompts, pinch and
//! swipe), which a WebView2 does not have or which its API turns off (`policy.rs`), and they are
//! not documented for WebView2; this window answers permission requests itself.

use crate::browser;

/// Every switch, in order.
pub fn switches() -> Vec<String> {
    let mut all = vec![browser::disable_features_arg()];
    all.extend(
        browser::NO_THROTTLING_SWITCHES
            .iter()
            .map(|s| s.to_string()),
    );
    all
}

/// The switches as one string, for WebView2's `AdditionalBrowserArguments`.
pub fn webview2_arguments() -> String {
    switches().join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_webview2_window_switches_off_what_the_app_window_does() {
        let args = webview2_arguments();
        assert!(args.starts_with("--disable-features=Translate,"));
        for feature in browser::DISABLED_FEATURES {
            assert!(
                browser::disable_features_arg()
                    .split(['=', ','])
                    .any(|f| f == feature),
                "{feature}"
            );
        }
        for s in browser::NO_THROTTLING_SWITCHES {
            assert!(args.split(' ').any(|a| a == s), "{s}");
        }
        // The app window passes the same features and the same throttling switches.
        let app: Vec<String> = browser::app_args("http://127.0.0.1:1/", std::path::Path::new("/p"))
            .iter()
            .map(|a| a.to_string_lossy().into_owned())
            .collect();
        for s in switches() {
            assert!(app.contains(&s), "the app window lacks {s}");
        }
        for s in switches() {
            assert!(!s.contains(' ') && !s.contains('"'), "{s}");
        }
    }
}
