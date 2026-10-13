//! The messages between the page and the native window, both ways, through WebView2's
//! `window.chrome.webview.postMessage` (page → window) and `PostWebMessageAsJson` (window →
//! page). Each message is a JSON object with a `type`; unknown types and fields are ignored, so
//! either side can grow. The page's side is `src/core/host-protocol.ts`; both read
//! `tests/fixtures/host-protocol.json`, which is the contract.
//!
//! The window has the system's own title bar; the page only says what goes in it and answers
//! the close.
//!
//! Page → window:
//!
//! | `type` | Fields | What the window does |
//! | --- | --- | --- |
//! | `ready` | `protocol` | The page listens: the window answers `host` |
//! | `title` | `project` | The title becomes `Repackshot — <project>` (taskbar, Alt Tab) |
//! | `theme` | `dark`, `background: "#rrggbb"` | A dark or light title bar, and the colour behind the page |
//! | `close` | | What the system's close does: asks the page with `close-requested` |
//! | `close-ok` | | The page agreed (saved, or chose not to): the window closes |
//!
//! Window → page:
//!
//! | `type` | Fields | |
//! | --- | --- | --- |
//! | `host` | `protocol`, `runtime` | Who answers: the WebView2 runtime's version |
//! | `close-requested` | | Someone wants the window closed (its close button, `Alt F4`, the taskbar, the system menu): ask about unsaved changes and answer `close-ok`, or nothing |

use crate::json::{self, Value};

/// The version of this protocol.
pub const PROTOCOL: u32 = 1;
/// The longest project name put in the title.
pub const MAX_TITLE: usize = 200;

/// What the page tells the window.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum PageMessage {
    /// The page listens.
    Ready {
        /// The protocol it speaks.
        protocol: u32,
    },
    /// The project's name, for the title.
    Title {
        /// The name (the page's word for "Untitled" when it has none).
        project: String,
    },
    /// The page's colours.
    Theme {
        /// A dark theme: a dark title bar.
        dark: bool,
        /// The background, when the page says it.
        background: Option<[u8; 3]>,
    },
    /// Close, as the system would (the window asks the page first).
    Close,
    /// The page agreed to close.
    CloseOk,
}

/// `#rrggbb` (either case).
pub fn parse_colour(text: &str) -> Option<[u8; 3]> {
    let hex = text.strip_prefix('#')?;
    if hex.len() != 6 || !hex.bytes().all(|b| b.is_ascii_hexdigit()) {
        return None;
    }
    let byte = |i: usize| u8::from_str_radix(&hex[i..i + 2], 16).ok();
    Some([byte(0)?, byte(2)?, byte(4)?])
}

/// The window's title for a project: `Repackshot — <name>`, the name on one line and at most
/// [`MAX_TITLE`] characters; `Repackshot` alone without a name.
pub fn window_title(project: &str) -> String {
    let name = project
        .chars()
        .map(|c| if c.is_control() { ' ' } else { c })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    if name.is_empty() {
        return "Repackshot".into();
    }
    let mut short: String = name.chars().take(MAX_TITLE).collect();
    if short.len() < name.len() {
        short.push('…');
    }
    format!("Repackshot — {short}")
}

impl PageMessage {
    /// Reads a message from its JSON text (what `get_WebMessageAsJson` gives).
    pub fn parse(text: &str) -> Result<PageMessage, String> {
        let v = json::parse(text).map_err(|e| e.to_string())?;
        let kind = v.get("type").and_then(Value::as_str).ok_or("no type")?;
        Ok(match kind {
            "ready" => PageMessage::Ready {
                protocol: v
                    .get("protocol")
                    .and_then(Value::as_f64)
                    .filter(|p| p.is_finite() && *p >= 0.0 && p.fract() == 0.0 && *p < 1e6)
                    .map_or(0, |p| p as u32),
            },
            "title" => PageMessage::Title {
                project: v
                    .get("project")
                    .and_then(Value::as_str)
                    .ok_or("title: project is not a string")?
                    .to_string(),
            },
            "theme" => PageMessage::Theme {
                dark: v
                    .get("dark")
                    .and_then(Value::as_bool)
                    .ok_or("theme: dark is not a boolean")?,
                background: match v.get("background") {
                    None | Some(Value::Null) => None,
                    Some(b) => Some(
                        b.as_str()
                            .and_then(parse_colour)
                            .ok_or("theme: background is not #rrggbb")?,
                    ),
                },
            },
            "close" => PageMessage::Close,
            "close-ok" => PageMessage::CloseOk,
            other => return Err(format!("unknown message type '{other}'")),
        })
    }
}

/// What the window tells the page.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum HostMessage {
    /// Who answers.
    Host {
        /// The WebView2 runtime version.
        runtime: String,
    },
    /// Someone wants the window closed.
    CloseRequested,
}

impl HostMessage {
    /// The JSON text for `PostWebMessageAsJson`.
    pub fn to_json(&self) -> String {
        match self {
            HostMessage::Host { runtime } => json::Object::new()
                .str("type", "host")
                .num("protocol", f64::from(PROTOCOL))
                .str("runtime", runtime)
                .build(),
            HostMessage::CloseRequested => {
                json::Object::new().str("type", "close-requested").build()
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The contract both sides pass.
    const FIXTURE: &str = include_str!("../../../../../tests/fixtures/host-protocol.json");

    fn fixture() -> Value {
        json::parse(FIXTURE).expect("the fixture is JSON")
    }

    /// The variant the fixture names, for comparing.
    fn expected(name: &str, v: &Value) -> PageMessage {
        match name {
            "ready" => PageMessage::Ready { protocol: 1 },
            "title" => PageMessage::Title {
                project: v.get("project").and_then(Value::as_str).unwrap().into(),
            },
            "theme" => PageMessage::Theme {
                dark: v.get("dark").and_then(Value::as_bool).unwrap(),
                background: v
                    .get("background")
                    .and_then(Value::as_str)
                    .and_then(parse_colour),
            },
            "close" => PageMessage::Close,
            "close-ok" => PageMessage::CloseOk,
            other => panic!("unknown fixture command {other}"),
        }
    }

    #[test]
    fn reads_every_page_message_of_the_contract() {
        let f = fixture();
        let cases = f.get("pageToHost").and_then(Value::as_array).unwrap();
        assert!(cases.len() >= 6);
        for case in cases {
            let name = case.get("command").and_then(Value::as_str).unwrap();
            let message = case.get("message").unwrap();
            let parsed =
                PageMessage::parse(&message.to_json()).unwrap_or_else(|e| panic!("{name}: {e}"));
            assert_eq!(parsed, expected(name, message), "{name}");
        }
    }

    #[test]
    fn writes_every_host_message_of_the_contract() {
        let f = fixture();
        let cases = f.get("hostToPage").and_then(Value::as_array).unwrap();
        let ours = [
            HostMessage::Host {
                runtime: "129.0.2792.65".into(),
            },
            HostMessage::CloseRequested,
        ];
        assert_eq!(cases.len(), ours.len());
        for (case, msg) in cases.iter().zip(&ours) {
            let want = case.get("message").unwrap();
            assert_eq!(&json::parse(&msg.to_json()).unwrap(), want, "{msg:?}");
        }
    }

    #[test]
    fn refuses_what_is_not_a_message() {
        for bad in [
            "",
            "[]",
            "{}",
            r#"{"type":"explode"}"#,
            r#"{"type":5}"#,
            r#"{"type":"title"}"#,
            r#"{"type":"title","project":7}"#,
            r#"{"type":"theme"}"#,
            r#"{"type":"theme","dark":true,"background":"red"}"#,
            r##"{"type":"theme","dark":true,"background":"#12345g"}"##,
        ] {
            assert!(PageMessage::parse(bad).is_err(), "{bad}");
        }
        // Unknown fields are ignored.
        assert_eq!(
            PageMessage::parse(r#"{"type":"close","why":"x"}"#),
            Ok(PageMessage::Close)
        );
        assert_eq!(parse_colour("#0E0e0e"), Some([14, 14, 14]));
        assert_eq!(parse_colour("0e0e0e"), None);
    }

    #[test]
    fn titles_name_the_project() {
        assert_eq!(window_title("Bottle"), "Repackshot — Bottle");
        assert_eq!(
            window_title("  Perfume\n bottle\t2 "),
            "Repackshot — Perfume bottle 2"
        );
        assert_eq!(window_title(""), "Repackshot");
        assert_eq!(window_title(" \u{7} "), "Repackshot");
        let long = window_title(&"ñ".repeat(500));
        assert_eq!(
            long.chars().count(),
            "Repackshot — ".chars().count() + MAX_TITLE + 1
        );
        assert!(long.ends_with('…'));
    }
}
