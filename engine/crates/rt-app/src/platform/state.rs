//! Where the native window was: `<data>/window.json` keeps its normal (not maximised) rectangle
//! in physical pixels, whether it was maximised and the page's last theme (a dark or light title
//! bar and the background), so the next start opens it there and in those colours before the page
//! has painted. In a portable folder that is `data/window.json` next to the program, like
//! everything else.
//!
//! A remembered place is used only if the top of the window, where the title bar is, still
//! lands on a screen (a monitor may have gone); otherwise the window opens at its default size,
//! centred on the main screen.

use crate::json::{self, Value};
use std::path::Path;

/// The file in the data folder.
pub const FILE: &str = "window.json";
/// The default size, in pixels at 100 % (96 dpi).
pub const DEFAULT_SIZE: (i32, i32) = (1600, 1000);
/// The smallest window, in pixels at 100 %: 500 is what Windows 11's Snap Layouts need to fit
/// a third of a common screen (Microsoft, *Support snap layouts for desktop apps*).
pub const MIN_SIZE: (i32, i32) = (500, 400);
/// The largest coordinate or size kept (Windows' own limit for window coordinates).
const LIMIT: i64 = 32_767;

/// A rectangle in screen pixels, edges exclusive at right and bottom (a Win32 `RECT`).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Area {
    /// Left.
    pub left: i32,
    /// Top.
    pub top: i32,
    /// Right.
    pub right: i32,
    /// Bottom.
    pub bottom: i32,
}

impl Area {
    /// Width.
    pub fn width(&self) -> i32 {
        self.right - self.left
    }
    /// Height.
    pub fn height(&self) -> i32 {
        self.bottom - self.top
    }
    fn intersect(&self, o: &Area) -> Option<Area> {
        let a = Area {
            left: self.left.max(o.left),
            top: self.top.max(o.top),
            right: self.right.min(o.right),
            bottom: self.bottom.min(o.bottom),
        };
        (a.right > a.left && a.bottom > a.top).then_some(a)
    }
}

/// The page's colours, as the window shows them.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Theme {
    /// A dark title bar.
    pub dark: bool,
    /// The colour behind the page.
    pub background: [u8; 3],
}

/// The window's place.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct WindowState {
    /// Left edge of the normal rectangle.
    pub x: i32,
    /// Top edge.
    pub y: i32,
    /// Width.
    pub width: i32,
    /// Height.
    pub height: i32,
    /// Maximised when it closed.
    pub maximized: bool,
    /// The page's theme when it closed.
    pub theme: Option<Theme>,
}

/// Scales pixels at 100 % to `dpi`, rounded.
pub fn scale(px: i32, dpi: u32) -> i32 {
    ((i64::from(px) * i64::from(dpi.max(1)) + 48) / 96) as i32
}

impl WindowState {
    /// Reads `window.json`; `None` when it is missing, damaged or out of range.
    pub fn parse(text: &str) -> Option<WindowState> {
        let v = json::parse(text).ok()?;
        let int = |k: &str| -> Option<i32> {
            let f = v.get(k)?.as_f64()?;
            (f.is_finite() && f.fract() == 0.0 && (f as i64).abs() <= LIMIT).then_some(f as i32)
        };
        let s = WindowState {
            x: int("x")?,
            y: int("y")?,
            width: int("width")?,
            height: int("height")?,
            maximized: v.get("maximized").and_then(Value::as_bool).unwrap_or(false),
            theme: match (
                v.get("dark").and_then(Value::as_bool),
                v.get("background")
                    .and_then(Value::as_str)
                    .and_then(super::protocol::parse_colour),
            ) {
                (Some(dark), Some(background)) => Some(Theme { dark, background }),
                _ => None,
            },
        };
        (s.width > 0 && s.height > 0).then_some(s)
    }

    /// The text of `window.json`.
    pub fn to_json(&self) -> String {
        let o = json::Object::new()
            .num("x", f64::from(self.x))
            .num("y", f64::from(self.y))
            .num("width", f64::from(self.width))
            .num("height", f64::from(self.height))
            .bool("maximized", self.maximized);
        match self.theme {
            Some(t) => o
                .bool("dark", t.dark)
                .str(
                    "background",
                    &format!(
                        "#{:02x}{:02x}{:02x}",
                        t.background[0], t.background[1], t.background[2]
                    ),
                )
                .build(),
            None => o.build(),
        }
    }

    /// Reads the file in `data_dir`.
    pub fn load(data_dir: &Path) -> Option<WindowState> {
        WindowState::parse(&std::fs::read_to_string(data_dir.join(FILE)).ok()?)
    }

    /// Writes the file in `data_dir` (through a temporary file, so a crash never leaves half).
    pub fn save(&self, data_dir: &Path) -> std::io::Result<()> {
        let tmp = data_dir.join(format!("{FILE}.tmp"));
        std::fs::write(&tmp, self.to_json())?;
        std::fs::rename(&tmp, data_dir.join(FILE))
    }

    /// The rectangle.
    pub fn area(&self) -> Area {
        Area {
            left: self.x,
            top: self.y,
            right: self.x.saturating_add(self.width),
            bottom: self.y.saturating_add(self.height),
        }
    }

    /// At least `min` (pixels at this dpi) in each direction.
    pub fn at_least(mut self, min: (i32, i32)) -> WindowState {
        self.width = self.width.max(min.0);
        self.height = self.height.max(min.1);
        self
    }

    /// Whether the person can still reach the title bar: a strip of the window's top, 32 pixels
    /// at 100 % high and 100 wide at least, lies on one of `screens` (their work areas).
    pub fn reachable(&self, screens: &[Area], dpi: u32) -> bool {
        let strip = Area {
            bottom: self.y.saturating_add(scale(32, dpi).min(self.height)),
            ..self.area()
        };
        let need = scale(100, dpi).min(self.width);
        screens
            .iter()
            .filter_map(|s| strip.intersect(s))
            .any(|a| a.width() >= need && a.height() >= scale(8, dpi).min(strip.height()))
    }

    /// The first window: [`DEFAULT_SIZE`] at `dpi`, at most 90 % of the work area, centred on it.
    pub fn default_in(work: Area, dpi: u32) -> WindowState {
        let w = scale(DEFAULT_SIZE.0, dpi).min(work.width() * 9 / 10).max(1);
        let h = scale(DEFAULT_SIZE.1, dpi)
            .min(work.height() * 9 / 10)
            .max(1);
        WindowState {
            x: work.left + (work.width() - w) / 2,
            y: work.top + (work.height() - h) / 2,
            width: w,
            height: h,
            maximized: false,
            theme: None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SCREEN: Area = Area {
        left: 0,
        top: 0,
        right: 1920,
        bottom: 1040,
    };

    #[test]
    fn round_trips_through_the_file() {
        let dir = crate::test_dir("window-state");
        assert_eq!(WindowState::load(&dir), None);
        let s = WindowState {
            x: -1200,
            y: 40,
            width: 1100,
            height: 700,
            maximized: true,
            theme: Some(Theme {
                dark: false,
                background: [0xf4, 0xf4, 0xf4],
            }),
        };
        s.save(&dir).unwrap();
        assert!(std::fs::read_to_string(dir.join(FILE))
            .unwrap()
            .contains(r##""dark":false,"background":"#f4f4f4""##));
        assert_eq!(WindowState::load(&dir), Some(s));
        assert!(!dir.join("window.json.tmp").exists());
        std::fs::write(dir.join(FILE), "{oops").unwrap();
        assert_eq!(WindowState::load(&dir), None);
    }

    #[test]
    fn refuses_damaged_or_absurd_files() {
        for bad in [
            "",
            "[]",
            r#"{"x":0,"y":0,"width":0,"height":10}"#,
            r#"{"x":0,"y":0,"width":-5,"height":10}"#,
            r#"{"x":0,"y":0,"width":10.5,"height":10}"#,
            r#"{"x":99999,"y":0,"width":10,"height":10}"#,
            r#"{"x":0,"y":0,"width":10}"#,
            r#"{"x":"0","y":0,"width":10,"height":10}"#,
        ] {
            assert_eq!(WindowState::parse(bad), None, "{bad}");
        }
        assert_eq!(
            WindowState::parse(r#"{"x":5,"y":6,"width":7,"height":8}"#),
            Some(WindowState {
                x: 5,
                y: 6,
                width: 7,
                height: 8,
                maximized: false,
                theme: None
            })
        );
    }

    #[test]
    fn a_window_whose_title_bar_left_every_screen_is_not_restored() {
        let at = |x, y| WindowState {
            x,
            y,
            width: 1200,
            height: 800,
            maximized: false,
            theme: None,
        };
        assert!(at(100, 100).reachable(&[SCREEN], 96));
        // Mostly off to the right, but 200 pixels of the title bar are still on the screen.
        assert!(at(1720, 100).reachable(&[SCREEN], 96));
        // Only 40 pixels left: not enough to grab.
        assert!(!at(1880, 100).reachable(&[SCREEN], 96));
        // The title bar above the screen (the body below does not help).
        assert!(!at(100, -400).reachable(&[SCREEN], 96));
        // On a second monitor that is gone, and on one that is still there.
        let left = Area {
            left: -2560,
            top: 0,
            right: 0,
            bottom: 1400,
        };
        assert!(!at(-2000, 100).reachable(&[SCREEN], 96));
        assert!(at(-2000, 100).reachable(&[SCREEN, left], 96));
        assert!(!at(100, 100).reachable(&[], 96));
    }

    #[test]
    fn the_first_window_fits_the_screen_at_any_scale() {
        let s = WindowState::default_in(SCREEN, 96);
        assert_eq!((s.width, s.height), (1600, 936));
        assert_eq!((s.x, s.y), (160, 52));
        // 150 % on a 4K screen: 2400 x 1500.
        let k4 = Area {
            left: 0,
            top: 0,
            right: 3840,
            bottom: 2100,
        };
        let s = WindowState::default_in(k4, 144);
        assert_eq!((s.width, s.height), (2400, 1500));
        assert!(s.reachable(&[k4], 144));
        // A small laptop at 125 %.
        let small = Area {
            left: 0,
            top: 0,
            right: 1366,
            bottom: 728,
        };
        let s = WindowState::default_in(small, 120);
        assert!(s.width <= 1366 * 9 / 10 && s.height <= 728 * 9 / 10);
        assert_eq!(scale(500, 144), 750);
        assert_eq!(scale(500, 120), 625);
        let tiny = WindowState {
            width: 10,
            height: 10,
            ..s
        };
        assert_eq!(
            tiny.at_least((scale(MIN_SIZE.0, 120), scale(MIN_SIZE.1, 120)))
                .width,
            625
        );
    }
}
