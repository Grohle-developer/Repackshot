//! The Win32 window of the native host: a normal top-level window (`WS_OVERLAPPEDWINDOW`) with
//! the system's own title bar, frame, snapping, shadow and accessibility, and:
//!
//! * **our icon and title**: the big and small icons of `repackshot.exe`'s icon resource at the
//!   window's DPI (`WM_SETICON`), and `Repackshot — <project>` as the page names it;
//! * **a dark title bar with a dark theme** (`DWMWA_USE_IMMERSIVE_DARK_MODE`, 20 on Windows 10
//!   20H1 and later, 19 on the builds before);
//! * **its place remembered** (`state.rs`), per-monitor DPI aware (`WM_DPICHANGED` applies the
//!   suggested rectangle), with a minimum size;
//! * **closing asked**: `WM_CLOSE` (its close button, `Alt F4`, the taskbar, the system menu all
//!   end there) goes to the [`Target`], which may keep the window open while the page asks.

use super::state::{scale, Area, Theme, WindowState, MIN_SIZE};
use super::win32::*;
use std::cell::{Cell, RefCell};
use std::ffi::c_void;
use std::path::PathBuf;
use std::rc::Rc;

/// The window's class.
pub const MAIN_CLASS: &str = "RepackshotWindow";
/// The title before the page names its project.
pub const TITLE: &str = "Repackshot";
/// Posted to close the window outside of a callback.
pub const WM_APP_DESTROY: u32 = WM_APP + 1;
/// The icon resource of `repackshot.exe` (`build.rs`: `1 ICON`).
const ICON_ID: usize = 1;
/// `DWMWA_USE_IMMERSIVE_DARK_MODE` before Windows 10 20H1 (build 19041).
const DWMWA_USE_IMMERSIVE_DARK_MODE_BEFORE_20H1: u32 = 19;

/// What the window asks of its owner (the WebView2 host, or a test).
pub trait Target {
    /// The window.
    fn frame(&self) -> &Frame;
    /// `WM_CLOSE`: true closes now; false keeps the window (the page was asked).
    fn close_requested(&self) -> bool;
    /// The client area changed: the web view goes there.
    fn layout(&self, client: RECT);
    /// The window moved (popups of the web view follow).
    fn moved(&self) {}
    /// The window got the keyboard focus: pass it to the web view.
    fn take_focus(&self) {}
    /// The window is going: release the web view (called once, before `DestroyWindow`).
    fn closing(&self) {}
}

thread_local! {
    static TARGET: RefCell<Option<Rc<dyn Target>>> = const { RefCell::new(None) };
}

/// Routes this thread's window messages to `target` (until [`uninstall`]).
pub fn install(target: Rc<dyn Target>) {
    TARGET.with(|t| *t.borrow_mut() = Some(target));
}

/// Stops routing messages (they get the default handling).
pub fn uninstall() {
    TARGET.with(|t| t.borrow_mut().take());
}

fn target() -> Option<Rc<dyn Target>> {
    // The Rc is cloned out, so no borrow is held while a handler runs (handlers re-enter).
    TARGET.with(|t| t.borrow().clone())
}

unsafe extern "system" fn window_proc(hwnd: HWND, msg: u32, w: WPARAM, l: LPARAM) -> LRESULT {
    match target() {
        Some(t) => t.frame().on_message(&*t, hwnd, msg, w, l),
        // SAFETY: the default handling of a message of our own window.
        None => unsafe { DefWindowProcW(hwnd, msg, w, l) },
    }
}

/// The work areas of the screens.
pub fn screens() -> Vec<Area> {
    unsafe extern "system" fn collect(m: HMONITOR, _dc: HDC, _r: *mut RECT, data: LPARAM) -> BOOL {
        let mut info = monitor_info();
        // SAFETY: `m` is the monitor being enumerated; `info` has its size set; `data` is the
        // Vec passed below, alive for the whole (synchronous) enumeration.
        unsafe {
            if GetMonitorInfoW(m, &mut info) != 0 {
                (*(data as *mut Vec<Area>)).push(area(info.rcWork));
            }
        }
        1
    }
    let mut out: Vec<Area> = Vec::new();
    // SAFETY: a synchronous enumeration of every monitor with a callback that only appends to
    // `out`, which outlives it.
    unsafe {
        EnumDisplayMonitors(
            std::ptr::null_mut(),
            std::ptr::null(),
            collect,
            &mut out as *mut Vec<Area> as LPARAM,
        );
    }
    out
}

fn monitor_info() -> MONITORINFO {
    MONITORINFO {
        cbSize: std::mem::size_of::<MONITORINFO>() as u32,
        rcMonitor: RECT::default(),
        rcWork: RECT::default(),
        dwFlags: 0,
    }
}

fn area(r: RECT) -> Area {
    Area {
        left: r.left,
        top: r.top,
        right: r.right,
        bottom: r.bottom,
    }
}

fn work_area_of(hwnd: HWND) -> Area {
    let mut info = monitor_info();
    // SAFETY: a valid window; `info` has its size set.
    let ok =
        unsafe { GetMonitorInfoW(MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST), &mut info) }
            != 0;
    let w = area(info.rcWork);
    if ok && w.width() > 0 && w.height() > 0 {
        w
    } else {
        Area {
            left: 0,
            top: 0,
            right: 1280,
            bottom: 800,
        }
    }
}

fn register() -> Result<(), String> {
    let class = super::com::wide(MAIN_CLASS);
    // SAFETY: the module of this program; a resource number for the icon (null when the build
    // has none: the system's); a stock cursor.
    let (instance, big, small, arrow) = unsafe {
        let instance = GetModuleHandleW(std::ptr::null());
        let load = |metric_index| {
            let size = GetSystemMetrics(metric_index);
            LoadImageW(
                instance,
                int_resource(ICON_ID),
                IMAGE_ICON,
                size,
                size,
                LR_DEFAULTCOLOR,
            )
        };
        (
            instance,
            load(SM_CXICON),
            load(SM_CXSMICON),
            LoadCursorW(std::ptr::null_mut(), int_resource(IDC_ARROW)),
        )
    };
    let wc = WNDCLASSEXW {
        cbSize: std::mem::size_of::<WNDCLASSEXW>() as u32,
        style: 0,
        lpfnWndProc: Some(window_proc),
        cbClsExtra: 0,
        cbWndExtra: 0,
        hInstance: instance,
        hIcon: big,
        hCursor: arrow,
        // No class brush: WM_ERASEBKGND paints the page's background colour.
        hbrBackground: std::ptr::null_mut(),
        lpszMenuName: std::ptr::null(),
        lpszClassName: class.as_ptr(),
        hIconSm: small,
    };
    // SAFETY: a filled-in class; `class` outlives the call (Windows copies the name).
    if unsafe { RegisterClassExW(&wc) } == 0 {
        // SAFETY: no arguments.
        let e = unsafe { GetLastError() };
        if e != ERROR_CLASS_ALREADY_EXISTS {
            return Err(format!("RegisterClassExW: error {e}"));
        }
    }
    Ok(())
}

/// The window.
pub struct Frame {
    hwnd: Cell<HWND>,
    background: Cell<[u8; 3]>,
    dark: Cell<bool>,
    brush: Cell<HBRUSH>,
    icons: Cell<(HICON, HICON)>,
    title: RefCell<String>,
    start_maximized: Cell<bool>,
    closed: Cell<bool>,
    data_dir: PathBuf,
}

impl Frame {
    /// A window not created yet; `data_dir` keeps `window.json`.
    pub fn new(data_dir: PathBuf, background: [u8; 3]) -> Frame {
        Frame {
            hwnd: Cell::new(std::ptr::null_mut()),
            background: Cell::new(background),
            dark: Cell::new(true),
            brush: Cell::new(std::ptr::null_mut()),
            icons: Cell::new((std::ptr::null_mut(), std::ptr::null_mut())),
            title: RefCell::new(TITLE.to_string()),
            start_maximized: Cell::new(false),
            closed: Cell::new(false),
            data_dir,
        }
    }

    /// The window (null before [`Frame::create`] and after it is destroyed).
    pub fn hwnd(&self) -> HWND {
        self.hwnd.get()
    }

    /// Creates the window, hidden, where it was last time (or centred at its default size). The
    /// [`Target`] must be installed first.
    pub fn create(&self) -> Result<HWND, String> {
        register()?;
        let saved = WindowState::load(&self.data_dir).filter(|s| s.reachable(&screens(), 96));
        // Created right where it was, so it is born on that monitor with that monitor's DPI
        // (moving it there afterwards would rescale it).
        let (x, y, w, h) = match saved {
            Some(s) => (s.x, s.y, s.width, s.height),
            None => (CW_USEDEFAULT, CW_USEDEFAULT, CW_USEDEFAULT, CW_USEDEFAULT),
        };
        self.start_maximized.set(saved.is_some_and(|s| s.maximized));
        // The last theme, so the window opens in the page's colours before the page paints.
        if let Some(t) = saved.and_then(|s| s.theme) {
            self.background.set(t.background);
            self.dark.set(t.dark);
        }
        self.brush.set(Self::make_brush(self.background.get()));
        let class = super::com::wide(MAIN_CLASS);
        let title = super::com::wide(TITLE);
        // SAFETY: registered class, NUL-terminated strings that outlive the call, our module.
        let hwnd = unsafe {
            CreateWindowExW(
                0,
                class.as_ptr(),
                title.as_ptr(),
                WS_OVERLAPPEDWINDOW | WS_CLIPCHILDREN,
                x,
                y,
                w,
                h,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                GetModuleHandleW(std::ptr::null()),
                std::ptr::null_mut(),
            )
        };
        if hwnd.is_null() {
            // SAFETY: no arguments.
            return Err(format!("CreateWindowExW: error {}", unsafe {
                GetLastError()
            }));
        }
        self.hwnd.set(hwnd);
        let dpi = dpi_of(hwnd);
        if saved.is_none() {
            let s = WindowState::default_in(work_area_of(hwnd), dpi);
            // SAFETY: our window; a size on its own monitor (no DPI change).
            unsafe {
                SetWindowPos(
                    hwnd,
                    std::ptr::null_mut(),
                    s.x,
                    s.y,
                    s.width,
                    s.height,
                    SWP_NOZORDER | SWP_NOACTIVATE,
                )
            };
        }
        self.set_icons(hwnd, dpi);
        self.set_theme(self.dark.get(), None);
        Ok(hwnd)
    }

    /// Shows the window as it was (maximised or not) and brings it to the front.
    pub fn show(&self) {
        let cmd = if self.start_maximized.get() {
            SW_SHOWMAXIMIZED
        } else {
            SW_SHOWNORMAL
        };
        // SAFETY: our window.
        unsafe {
            ShowWindow(self.hwnd(), cmd);
            SetForegroundWindow(self.hwnd());
        }
    }

    fn make_brush(rgb: [u8; 3]) -> HBRUSH {
        // SAFETY: creates a GDI brush, deleted when replaced or when the window goes.
        unsafe { CreateSolidBrush(colorref(rgb)) }
    }

    fn set_icons(&self, hwnd: HWND, dpi: u32) {
        // SAFETY: our module and our window; WM_SETICON takes the icon handles, and the old
        // ones (ours, not shared) are destroyed after being replaced.
        unsafe {
            let instance = GetModuleHandleW(std::ptr::null());
            let load = |metric_index| {
                let size = metric(metric_index, dpi);
                LoadImageW(
                    instance,
                    int_resource(ICON_ID),
                    IMAGE_ICON,
                    size,
                    size,
                    LR_DEFAULTCOLOR,
                )
            };
            let (big, small) = (load(SM_CXICON), load(SM_CXSMICON));
            if big.is_null() && small.is_null() {
                return;
            }
            SendMessageW(hwnd, WM_SETICON, ICON_BIG, big as LPARAM);
            SendMessageW(hwnd, WM_SETICON, ICON_SMALL, small as LPARAM);
            let (old_big, old_small) = self.icons.replace((big, small));
            for old in [old_big, old_small] {
                if !old.is_null() {
                    DestroyIcon(old);
                }
            }
        }
    }

    /// Whether the window shows an icon of ours (false in a build without the icon resource).
    pub fn has_icon(&self) -> bool {
        let (big, small) = self.icons.get();
        !big.is_null() || !small.is_null()
    }

    /// The title (`Repackshot — <project>`).
    pub fn set_title(&self, title: &str) {
        if *self.title.borrow() == title {
            return;
        }
        *self.title.borrow_mut() = title.to_string();
        let text = super::com::wide(title);
        // SAFETY: our window; a NUL-terminated string Windows copies.
        unsafe { SetWindowTextW(self.hwnd(), text.as_ptr()) };
    }

    /// The title last set.
    #[cfg(test)]
    pub fn title(&self) -> String {
        self.title.borrow().clone()
    }

    /// The page's colours: a dark or light title bar, and the background behind the page.
    /// Returns whether Windows took the title bar's colour.
    pub fn set_theme(&self, dark: bool, background: Option<[u8; 3]>) -> bool {
        let hwnd = self.hwnd();
        if hwnd.is_null() {
            return false;
        }
        self.dark.set(dark);
        if let Some(rgb) = background {
            self.background.set(rgb);
            let old = self.brush.replace(Self::make_brush(rgb));
            if !old.is_null() {
                // SAFETY: our brush, no longer selected anywhere.
                unsafe { DeleteObject(old) };
            }
        }
        let value: BOOL = i32::from(dark);
        let set = |attribute| {
            // SAFETY: our window; a BOOL attribute with its size.
            unsafe {
                DwmSetWindowAttribute(hwnd, attribute, (&value as *const BOOL).cast::<c_void>(), 4)
            }
        };
        let taken = !super::com::failed(set(DWMWA_USE_IMMERSIVE_DARK_MODE))
            || !super::com::failed(set(DWMWA_USE_IMMERSIVE_DARK_MODE_BEFORE_20H1));
        // SAFETY: our window: repaint the background, and the title bar in its new colour.
        unsafe {
            InvalidateRect(hwnd, std::ptr::null(), 1);
            SetWindowPos(
                hwnd,
                std::ptr::null_mut(),
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED,
            );
        }
        taken
    }

    /// The background colour.
    pub fn background(&self) -> [u8; 3] {
        self.background.get()
    }

    /// Close as the system does: ends in `WM_CLOSE`, which asks the [`Target`].
    pub fn close(&self) {
        // SAFETY: our window; the standard close command.
        unsafe { PostMessageW(self.hwnd(), WM_SYSCOMMAND, SC_CLOSE, 0) };
    }

    /// Closes the window without asking (after the page agreed), outside of any callback.
    pub fn destroy_later(&self) {
        // SAFETY: our window.
        unsafe { PostMessageW(self.hwnd(), WM_APP_DESTROY, 0, 0) };
    }

    /// Saves where the window is (once, when it closes).
    fn save_state(&self) {
        let hwnd = self.hwnd();
        let mut wp = WINDOWPLACEMENT {
            length: std::mem::size_of::<WINDOWPLACEMENT>() as u32,
            flags: 0,
            showCmd: 0,
            ptMinPosition: POINT::default(),
            ptMaxPosition: POINT::default(),
            rcNormalPosition: RECT::default(),
        };
        // SAFETY: our window; `wp` has its length set.
        if hwnd.is_null() || unsafe { GetWindowPlacement(hwnd, &mut wp) } == 0 {
            return;
        }
        let r = wp.rcNormalPosition;
        let maximized = wp.showCmd == SW_SHOWMAXIMIZED as u32
            || (wp.showCmd == SW_SHOWMINIMIZED as u32 && wp.flags & WPF_RESTORETOMAXIMIZED != 0);
        let s = WindowState {
            x: r.left,
            y: r.top,
            width: r.right - r.left,
            height: r.bottom - r.top,
            maximized,
            theme: Some(Theme {
                dark: self.dark.get(),
                background: self.background.get(),
            }),
        };
        if s.width > 0 && s.height > 0 {
            if let Err(e) = s.save(&self.data_dir) {
                crate::log!("native window: cannot save its place: {e}");
            }
        }
    }

    /// Destroys the window now: saves its place, lets the target release the web view, then
    /// `DestroyWindow` (whose `WM_DESTROY` ends the message loop).
    pub fn destroy(&self, target: &dyn Target) {
        if !self.closed.replace(true) {
            self.save_state();
            target.closing();
        }
        let hwnd = self.hwnd();
        if !hwnd.is_null() {
            // SAFETY: our window, on its own thread.
            unsafe { DestroyWindow(hwnd) };
        }
    }

    /// The window's messages.
    pub fn on_message(
        &self,
        target: &dyn Target,
        hwnd: HWND,
        msg: u32,
        w: WPARAM,
        l: LPARAM,
    ) -> LRESULT {
        // SAFETY (whole match): the messages of our own window on its thread; pointers in `l`
        // are those the message documents (MINMAXINFO, the suggested RECT of WM_DPICHANGED),
        // valid for the duration of the call.
        unsafe {
            match msg {
                WM_GETMINMAXINFO => {
                    let mmi = &mut *(l as *mut MINMAXINFO);
                    let dpi = dpi_of(hwnd);
                    mmi.ptMinTrackSize = POINT {
                        x: scale(MIN_SIZE.0, dpi),
                        y: scale(MIN_SIZE.1, dpi),
                    };
                    0
                }
                WM_DPICHANGED => {
                    let r = *(l as *const RECT);
                    SetWindowPos(
                        hwnd,
                        std::ptr::null_mut(),
                        r.left,
                        r.top,
                        r.right - r.left,
                        r.bottom - r.top,
                        SWP_NOZORDER | SWP_NOACTIVATE,
                    );
                    self.set_icons(hwnd, u32::from(loword(w)));
                    0
                }
                WM_SIZE => {
                    if w != SIZE_MINIMIZED {
                        let mut c = RECT::default();
                        GetClientRect(hwnd, &mut c);
                        target.layout(c);
                    }
                    0
                }
                WM_MOVE | WM_MOVING => {
                    target.moved();
                    DefWindowProcW(hwnd, msg, w, l)
                }
                WM_SETFOCUS => {
                    target.take_focus();
                    0
                }
                WM_CLOSE => {
                    if self.closed.get() || target.close_requested() {
                        self.destroy(target);
                    }
                    0
                }
                WM_APP_DESTROY => {
                    self.destroy(target);
                    0
                }
                WM_DESTROY => {
                    if !self.closed.replace(true) {
                        self.save_state();
                        target.closing();
                    }
                    let brush = self.brush.replace(std::ptr::null_mut());
                    if !brush.is_null() {
                        DeleteObject(brush);
                    }
                    self.hwnd.set(std::ptr::null_mut());
                    PostQuitMessage(0);
                    0
                }
                WM_ERASEBKGND => {
                    let mut c = RECT::default();
                    GetClientRect(hwnd, &mut c);
                    FillRect(w as HDC, &c, self.brush.get());
                    1
                }
                WM_PAINT => {
                    let mut ps: PAINTSTRUCT = std::mem::zeroed();
                    BeginPaint(hwnd, &mut ps);
                    EndPaint(hwnd, &ps);
                    0
                }
                _ => DefWindowProcW(hwnd, msg, w, l),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A target without a web view: counts what the window asks.
    struct Fake {
        frame: Frame,
        allow_close: Cell<bool>,
        asked: Cell<u32>,
        layouts: Cell<u32>,
        closings: Cell<u32>,
    }

    impl Target for Fake {
        fn frame(&self) -> &Frame {
            &self.frame
        }
        fn close_requested(&self) -> bool {
            self.asked.set(self.asked.get() + 1);
            self.allow_close.get()
        }
        fn layout(&self, _client: RECT) {
            self.layouts.set(self.layouts.get() + 1);
        }
        fn closing(&self) {
            self.closings.set(self.closings.get() + 1);
        }
    }

    fn pump() {
        // SAFETY: the standard non-blocking loop of this thread's windows.
        unsafe {
            let mut msg: MSG = std::mem::zeroed();
            while PeekMessageW(&mut msg, std::ptr::null_mut(), 0, 0, PM_REMOVE) != 0 {
                TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
        }
    }

    fn rect_of(hwnd: HWND) -> RECT {
        let mut r = RECT::default();
        // SAFETY: a window of this test.
        unsafe { GetWindowRect(hwnd, &mut r) };
        r
    }

    fn title_of(hwnd: HWND) -> String {
        let mut buf = [0u16; 512];
        // SAFETY: a window of this test; a buffer of its stated length.
        let n = unsafe { GetWindowTextW(hwnd, buf.as_mut_ptr(), buf.len() as i32) };
        String::from_utf16_lossy(&buf[..n.max(0) as usize])
    }

    fn fake(dir: &std::path::Path) -> Rc<Fake> {
        Rc::new(Fake {
            frame: Frame::new(dir.to_path_buf(), [0x0e, 0x0e, 0x0e]),
            allow_close: Cell::new(false),
            asked: Cell::new(0),
            layouts: Cell::new(0),
            closings: Cell::new(0),
        })
    }

    /// The real window, without WebView2 (which cannot run here): created with the system's
    /// title bar, titled, themed, asked to close, closed, and opened again where it was. Run
    /// under Wine on Linux (`CARGO_TARGET_X86_64_PC_WINDOWS_GNU_RUNNER=wine`, with a display
    /// such as Xvfb) and on Windows.
    #[test]
    fn the_window_asks_before_closing_and_remembers_its_place() {
        let dir = crate::test_dir("frame");
        let f = fake(&dir);
        install(f.clone());
        let hwnd = f.frame.create().expect("the window");
        f.frame.show();
        pump();
        // SAFETY (whole test): windows of this test, on this thread.
        unsafe {
            assert_ne!(IsWindow(hwnd), 0);
            assert!(f.layouts.get() >= 1, "WM_SIZE lays the web view out");

            // The system's own title bar: the client area starts below the caption.
            let w = rect_of(hwnd);
            let mut origin = POINT::default();
            ClientToScreen(hwnd, &mut origin);
            assert!(origin.y > w.top, "a standard caption");
            assert_eq!(title_of(hwnd), "Repackshot");
            f.frame
                .set_title(&super::super::protocol::window_title("Bottle"));
            assert_eq!(title_of(hwnd), "Repackshot — Bottle");
            assert_eq!(f.frame.title(), "Repackshot — Bottle");
            f.frame.set_theme(true, Some([1, 2, 3]));
            assert_eq!(f.frame.background(), [1, 2, 3]);

            // The minimum size, scaled to the window's dpi.
            let mut mmi: MINMAXINFO = std::mem::zeroed();
            SendMessageW(
                hwnd,
                WM_GETMINMAXINFO,
                0,
                &mut mmi as *mut MINMAXINFO as LPARAM,
            );
            let dpi = dpi_of(hwnd);
            assert_eq!(
                (mmi.ptMinTrackSize.x, mmi.ptMinTrackSize.y),
                (scale(500, dpi), scale(400, dpi))
            );

            // Closing asks the target; while it says no, the window stays. The system menu's
            // Close and Alt F4 are SC_CLOSE, which ends in the same WM_CLOSE.
            SendMessageW(hwnd, WM_CLOSE, 0, 0);
            f.frame.close();
            pump();
            assert_eq!(f.asked.get(), 2);
            assert_ne!(IsWindow(hwnd), 0);
            assert_eq!(f.closings.get(), 0);

            // Move it, then let it close: its place is saved and the web view released once.
            SetWindowPos(
                hwnd,
                std::ptr::null_mut(),
                40,
                30,
                900,
                640,
                SWP_NOZORDER | SWP_NOACTIVATE,
            );
            pump();
            f.allow_close.set(true);
            SendMessageW(hwnd, WM_CLOSE, 0, 0);
            pump();
            assert_eq!(IsWindow(hwnd), 0, "closed");
            assert!(f.frame.hwnd().is_null());
            assert_eq!(f.closings.get(), 1);
            let saved = WindowState::load(&dir).expect("window.json");
            assert_eq!(
                (saved.x, saved.y, saved.width, saved.height, saved.maximized),
                (40, 30, 900, 640, false)
            );
            assert_eq!(
                saved.theme,
                Some(Theme {
                    dark: true,
                    background: [1, 2, 3]
                })
            );
        }
        uninstall();

        // The next window opens where the last one was.
        let again = fake(&dir);
        install(again.clone());
        let hwnd = again.frame.create().expect("the window again");
        assert_eq!(
            again.frame.background(),
            [1, 2, 3],
            "the last theme's colours"
        );
        let r = rect_of(hwnd);
        assert_eq!(
            (r.left, r.top, r.right - r.left, r.bottom - r.top),
            (40, 30, 900, 640)
        );
        again.frame.destroy(&*again);
        pump();
        assert_eq!(again.closings.get(), 1);
        uninstall();
    }

    /// A place on a screen that is gone is not used.
    #[test]
    fn a_place_off_every_screen_is_forgotten() {
        let dir = crate::test_dir("frame-off");
        WindowState {
            x: -30_000,
            y: -30_000,
            width: 800,
            height: 600,
            maximized: true,
            theme: None,
        }
        .save(&dir)
        .unwrap();
        let f = fake(&dir);
        install(f.clone());
        let hwnd = f.frame.create().expect("the window");
        let r = rect_of(hwnd);
        assert!(
            r.left > -10_000 && r.top > -10_000,
            "opened on a screen: {r:?}"
        );
        assert!(!f.frame.start_maximized.get());
        f.frame.destroy(&*f);
        pump();
        uninstall();
    }
}
