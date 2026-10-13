//! The Win32 functions, structures and constants the native window uses, declared by hand from
//! Microsoft's Win32 reference (learn.microsoft.com/windows/win32/api) and the Windows SDK
//! headers' values (`winuser.h`, `objbase.h`, `dwmapi.h`, `shobjidl_core.h`). Functions newer
//! than Windows 10's first release (the DPI ones of 1607) are looked up at run time, so the
//! program still starts where they are missing.

#![allow(non_snake_case, non_camel_case_types, clippy::upper_case_acronyms)]

use super::com::HRESULT;
pub use super::webview2::{BOOL, HWND, RECT};
use std::ffi::c_void;
use std::sync::OnceLock;

pub type HANDLE = *mut c_void;
pub type HINSTANCE = *mut c_void;
pub type HMODULE = *mut c_void;
pub type HICON = *mut c_void;
pub type HCURSOR = *mut c_void;
pub type HBRUSH = *mut c_void;
pub type HMENU = *mut c_void;
pub type HMONITOR = *mut c_void;
pub type HDC = *mut c_void;
pub type WPARAM = usize;
pub type LPARAM = isize;
pub type LRESULT = isize;
pub type WNDPROC = unsafe extern "system" fn(HWND, u32, WPARAM, LPARAM) -> LRESULT;

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct POINT {
    pub x: i32,
    pub y: i32,
}

#[repr(C)]
pub struct WNDCLASSEXW {
    pub cbSize: u32,
    pub style: u32,
    pub lpfnWndProc: Option<WNDPROC>,
    pub cbClsExtra: i32,
    pub cbWndExtra: i32,
    pub hInstance: HINSTANCE,
    pub hIcon: HICON,
    pub hCursor: HCURSOR,
    pub hbrBackground: HBRUSH,
    pub lpszMenuName: *const u16,
    pub lpszClassName: *const u16,
    pub hIconSm: HICON,
}

#[repr(C)]
pub struct MSG {
    pub hwnd: HWND,
    pub message: u32,
    pub wParam: WPARAM,
    pub lParam: LPARAM,
    pub time: u32,
    pub pt: POINT,
    pub lPrivate: u32,
}

#[repr(C)]
pub struct MINMAXINFO {
    pub ptReserved: POINT,
    pub ptMaxSize: POINT,
    pub ptMaxPosition: POINT,
    pub ptMinTrackSize: POINT,
    pub ptMaxTrackSize: POINT,
}

#[repr(C)]
pub struct WINDOWPLACEMENT {
    pub length: u32,
    pub flags: u32,
    pub showCmd: u32,
    pub ptMinPosition: POINT,
    pub ptMaxPosition: POINT,
    pub rcNormalPosition: RECT,
}

#[repr(C)]
pub struct MONITORINFO {
    pub cbSize: u32,
    pub rcMonitor: RECT,
    pub rcWork: RECT,
    pub dwFlags: u32,
}

#[repr(C)]
pub struct PAINTSTRUCT {
    pub hdc: HDC,
    pub fErase: BOOL,
    pub rcPaint: RECT,
    pub fRestore: BOOL,
    pub fIncUpdate: BOOL,
    pub rgbReserved: [u8; 32],
}

// Window styles.
pub const WS_OVERLAPPEDWINDOW: u32 = 0x00CF_0000;
pub const WS_CLIPCHILDREN: u32 = 0x0200_0000;
pub const CW_USEDEFAULT: i32 = 0x8000_0000_u32 as i32;

// Messages.
pub const WM_DESTROY: u32 = 0x0002;
pub const WM_MOVE: u32 = 0x0003;
pub const WM_SIZE: u32 = 0x0005;
pub const WM_SETFOCUS: u32 = 0x0007;
pub const WM_PAINT: u32 = 0x000F;
pub const WM_CLOSE: u32 = 0x0010;
pub const WM_ERASEBKGND: u32 = 0x0014;
pub const WM_GETMINMAXINFO: u32 = 0x0024;
pub const WM_SETICON: u32 = 0x0080;
pub const WM_SYSCOMMAND: u32 = 0x0112;
pub const WM_MOVING: u32 = 0x0216;
pub const WM_DPICHANGED: u32 = 0x02E0;
pub const WM_APP: u32 = 0x8000;
#[cfg(test)]
pub const PM_REMOVE: u32 = 0x0001;

// WM_SIZE kinds, WM_SETICON kinds, system commands.
pub const SIZE_MINIMIZED: usize = 1;
pub const ICON_SMALL: usize = 0;
pub const ICON_BIG: usize = 1;
pub const SC_CLOSE: usize = 0xF060;

// ShowWindow.
pub const SW_SHOWNORMAL: i32 = 1;
pub const SW_SHOWMINIMIZED: i32 = 2;
pub const SW_SHOWMAXIMIZED: i32 = 3;

// SetWindowPos.
pub const SWP_NOSIZE: u32 = 0x0001;
pub const SWP_NOMOVE: u32 = 0x0002;
pub const SWP_NOZORDER: u32 = 0x0004;
pub const SWP_NOACTIVATE: u32 = 0x0010;
pub const SWP_FRAMECHANGED: u32 = 0x0020;

// Window placement flags, monitors, cursors, icons, metrics, errors.
pub const WPF_RESTORETOMAXIMIZED: u32 = 0x0002;
pub const MONITOR_DEFAULTTONEAREST: u32 = 2;
pub const IDC_ARROW: usize = 32512;
pub const IMAGE_ICON: u32 = 1;
pub const LR_DEFAULTCOLOR: u32 = 0;
pub const SM_CXICON: i32 = 11;
pub const SM_CXSMICON: i32 = 49;
pub const ERROR_CLASS_ALREADY_EXISTS: u32 = 1410;

// COM, libraries, DWM, DPI.
pub const COINIT_APARTMENTTHREADED: u32 = 0x2;
pub const COINIT_DISABLE_OLE1DDE: u32 = 0x4;
pub const S_FALSE: HRESULT = 1;
pub const LOAD_WITH_ALTERED_SEARCH_PATH: u32 = 0x0000_0008;
/// `DWMWA_USE_IMMERSIVE_DARK_MODE` (Windows 10 20H1 and later; 19 before).
pub const DWMWA_USE_IMMERSIVE_DARK_MODE: u32 = 20;
/// `DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2`, a pseudo-handle.
pub const DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2: isize = -4;

#[link(name = "user32")]
extern "system" {
    pub fn RegisterClassExW(class: *const WNDCLASSEXW) -> u16;
    pub fn CreateWindowExW(
        ex_style: u32,
        class: *const u16,
        title: *const u16,
        style: u32,
        x: i32,
        y: i32,
        w: i32,
        h: i32,
        parent: HWND,
        menu: HMENU,
        instance: HINSTANCE,
        param: *mut c_void,
    ) -> HWND;
    pub fn DefWindowProcW(hwnd: HWND, msg: u32, w: WPARAM, l: LPARAM) -> LRESULT;
    pub fn DestroyWindow(hwnd: HWND) -> BOOL;
    pub fn ShowWindow(hwnd: HWND, cmd: i32) -> BOOL;
    pub fn GetMessageW(msg: *mut MSG, hwnd: HWND, min: u32, max: u32) -> BOOL;
    pub fn TranslateMessage(msg: *const MSG) -> BOOL;
    pub fn DispatchMessageW(msg: *const MSG) -> LRESULT;
    pub fn PostMessageW(hwnd: HWND, msg: u32, w: WPARAM, l: LPARAM) -> BOOL;
    pub fn SendMessageW(hwnd: HWND, msg: u32, w: WPARAM, l: LPARAM) -> LRESULT;
    pub fn PostQuitMessage(code: i32);
    pub fn GetClientRect(hwnd: HWND, rect: *mut RECT) -> BOOL;
    pub fn SetWindowPos(
        hwnd: HWND,
        after: HWND,
        x: i32,
        y: i32,
        w: i32,
        h: i32,
        flags: u32,
    ) -> BOOL;
    pub fn SetWindowTextW(hwnd: HWND, text: *const u16) -> BOOL;
    pub fn GetWindowPlacement(hwnd: HWND, wp: *mut WINDOWPLACEMENT) -> BOOL;
    pub fn MonitorFromWindow(hwnd: HWND, flags: u32) -> HMONITOR;
    pub fn GetMonitorInfoW(monitor: HMONITOR, info: *mut MONITORINFO) -> BOOL;
    pub fn EnumDisplayMonitors(
        hdc: HDC,
        clip: *const RECT,
        callback: unsafe extern "system" fn(HMONITOR, HDC, *mut RECT, LPARAM) -> BOOL,
        data: LPARAM,
    ) -> BOOL;
    pub fn LoadCursorW(instance: HINSTANCE, name: *const u16) -> HCURSOR;
    pub fn LoadImageW(
        instance: HINSTANCE,
        name: *const u16,
        kind: u32,
        cx: i32,
        cy: i32,
        flags: u32,
    ) -> HANDLE;
    pub fn BeginPaint(hwnd: HWND, ps: *mut PAINTSTRUCT) -> HDC;
    pub fn EndPaint(hwnd: HWND, ps: *const PAINTSTRUCT) -> BOOL;
    pub fn FillRect(hdc: HDC, rect: *const RECT, brush: HBRUSH) -> i32;
    pub fn InvalidateRect(hwnd: HWND, rect: *const RECT, erase: BOOL) -> BOOL;
    pub fn GetSystemMetrics(index: i32) -> i32;
    pub fn SetForegroundWindow(hwnd: HWND) -> BOOL;
    pub fn DestroyIcon(icon: HICON) -> BOOL;
    #[cfg(test)]
    pub fn IsWindow(hwnd: HWND) -> BOOL;
    #[cfg(test)]
    pub fn GetWindowRect(hwnd: HWND, rect: *mut RECT) -> BOOL;
    #[cfg(test)]
    pub fn GetWindowTextW(hwnd: HWND, text: *mut u16, max: i32) -> i32;
    #[cfg(test)]
    pub fn ClientToScreen(hwnd: HWND, point: *mut POINT) -> BOOL;
    #[cfg(test)]
    pub fn PeekMessageW(msg: *mut MSG, hwnd: HWND, min: u32, max: u32, remove: u32) -> BOOL;
}

#[link(name = "kernel32")]
extern "system" {
    pub fn GetModuleHandleW(name: *const u16) -> HMODULE;
    pub fn LoadLibraryExW(name: *const u16, file: HANDLE, flags: u32) -> HMODULE;
    pub fn GetProcAddress(module: HMODULE, name: *const std::ffi::c_char) -> *mut c_void;
    pub fn GetLastError() -> u32;
}

#[link(name = "gdi32")]
extern "system" {
    pub fn CreateSolidBrush(colour: u32) -> HBRUSH;
    pub fn DeleteObject(object: *mut c_void) -> BOOL;
}

#[link(name = "ole32")]
extern "system" {
    pub fn CoInitializeEx(reserved: *mut c_void, flags: u32) -> HRESULT;
    pub fn CoUninitialize();
    pub fn CoTaskMemAlloc(bytes: usize) -> *mut c_void;
    pub fn CoTaskMemFree(p: *mut c_void);
    pub fn CoCreateInstance(
        class: *const super::com::GUID,
        outer: *mut c_void,
        context: u32,
        iid: *const super::com::GUID,
        out: *mut *mut c_void,
    ) -> HRESULT;
}

#[link(name = "shell32")]
extern "system" {
    pub fn ShellExecuteW(
        hwnd: HWND,
        operation: *const u16,
        file: *const u16,
        parameters: *const u16,
        directory: *const u16,
        show: i32,
    ) -> HINSTANCE;
    pub fn SetCurrentProcessExplicitAppUserModelID(id: *const u16) -> HRESULT;
}

#[link(name = "dwmapi")]
extern "system" {
    pub fn DwmSetWindowAttribute(
        hwnd: HWND,
        attribute: u32,
        value: *const c_void,
        size: u32,
    ) -> HRESULT;
}

/// `MAKEINTRESOURCEW`: a resource or cursor number where a name is expected.
pub fn int_resource(id: usize) -> *const u16 {
    id as *const u16
}

/// The low 16 bits of a message parameter.
pub fn loword(v: usize) -> u16 {
    (v & 0xffff) as u16
}

/// A `COLORREF` (`0x00bbggrr`).
pub fn colorref(rgb: [u8; 3]) -> u32 {
    u32::from(rgb[0]) | (u32::from(rgb[1]) << 8) | (u32::from(rgb[2]) << 16)
}

/// UTF-16 of a path, NUL-terminated.
pub fn wide_path(path: &std::path::Path) -> Vec<u16> {
    use std::os::windows::ffi::OsStrExt;
    path.as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect()
}

struct Dpi {
    for_window: Option<unsafe extern "system" fn(HWND) -> u32>,
    metrics: Option<unsafe extern "system" fn(i32, u32) -> i32>,
    awareness: Option<unsafe extern "system" fn(isize) -> BOOL>,
}

fn dpi_functions() -> &'static Dpi {
    static DPI: OnceLock<Dpi> = OnceLock::new();
    DPI.get_or_init(|| {
        let user32 = super::com::wide("user32.dll");
        // SAFETY: user32 is loaded in every GUI process (this module links it); the name is a
        // NUL-terminated UTF-16 string.
        let module = unsafe { GetModuleHandleW(user32.as_ptr()) };
        let find = |name: &std::ffi::CStr| -> *mut c_void {
            if module.is_null() {
                return std::ptr::null_mut();
            }
            // SAFETY: a valid module handle and a NUL-terminated ASCII name.
            unsafe { GetProcAddress(module, name.as_ptr()) }
        };
        let (a, b, c) = (
            find(c"GetDpiForWindow"),
            find(c"GetSystemMetricsForDpi"),
            find(c"SetProcessDpiAwarenessContext"),
        );
        // SAFETY: each pointer, when not null, is the export of that name, whose signature is
        // the one documented by Microsoft (UINT GetDpiForWindow(HWND); int
        // GetSystemMetricsForDpi(int, UINT); BOOL SetProcessDpiAwarenessContext(HANDLE)).
        unsafe {
            Dpi {
                for_window: (!a.is_null()).then(|| {
                    std::mem::transmute::<*mut c_void, unsafe extern "system" fn(HWND) -> u32>(a)
                }),
                metrics: (!b.is_null()).then(|| {
                    std::mem::transmute::<*mut c_void, unsafe extern "system" fn(i32, u32) -> i32>(
                        b,
                    )
                }),
                awareness: (!c.is_null()).then(|| {
                    std::mem::transmute::<*mut c_void, unsafe extern "system" fn(isize) -> BOOL>(c)
                }),
            }
        }
    })
}

/// Makes this process aware of each monitor's scale (per-monitor v2): its windows get physical
/// pixels and `WM_DPICHANGED`. Must run before the first window. False where unsupported.
pub fn set_per_monitor_dpi() -> bool {
    match dpi_functions().awareness {
        // SAFETY: the documented pseudo-handle for per-monitor v2.
        Some(f) => unsafe { f(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2) != 0 },
        None => false,
    }
}

/// The scale of the window's monitor, in dpi (96 is 100 %).
pub fn dpi_of(hwnd: HWND) -> u32 {
    match dpi_functions().for_window {
        // SAFETY: any window handle (an invalid one gives 0).
        Some(f) => match unsafe { f(hwnd) } {
            0 => 96,
            d => d,
        },
        None => 96,
    }
}

/// A system metric at `dpi`.
pub fn metric(index: i32, dpi: u32) -> i32 {
    match dpi_functions().metrics {
        // SAFETY: a documented metric index.
        Some(f) => unsafe { f(index, dpi) },
        // SAFETY: as above, at the system's scale.
        None => unsafe { GetSystemMetrics(index) },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn layouts_and_helpers() {
        assert_eq!(loword(0x0002_0001), 1);
        assert_eq!(colorref([0x11, 0x22, 0x33]), 0x0033_2211);
        assert_eq!(std::mem::size_of::<MSG>(), 48);
        assert_eq!(std::mem::size_of::<WNDCLASSEXW>(), 80);
        assert_eq!(std::mem::size_of::<WINDOWPLACEMENT>(), 44);
        assert_eq!(std::mem::size_of::<MONITORINFO>(), 40);
        assert_eq!(std::mem::size_of::<PAINTSTRUCT>(), 72);
        assert_eq!(std::mem::size_of::<MINMAXINFO>(), 40);
    }
}
