//! The WebView2 host: Microsoft's loader, the environment and its options, the controller in
//! our window, the settings that switch off everything that is not our interface, the events
//! that keep it so, the messages with the page, and the message loop. Windows only.
//!
//! The sequence (all on this thread, a COM single-threaded apartment; WebView2 calls back on
//! it from the message loop): `CoInitializeEx` → `WebView2Loader.dll` →
//! `GetAvailableCoreWebView2BrowserVersionString` (no runtime: fall back before any window
//! shows) → our window → `CreateCoreWebView2EnvironmentWithOptions` (profile in the data
//! folder, our switches) → `CreateCoreWebView2Controller` → settings, events, `Navigate` →
//! the message loop, until the window is destroyed.
//!
//! Sources: Microsoft's WebView2 Win32 reference (learn.microsoft.com/microsoft-edge/webview2/
//! reference/win32), *Get started with WebView2 in Win32 apps*, *Distribute your app and the
//! WebView2 Runtime* (the loader and the Evergreen runtime), and the SDK's `WebView2.idl`.

use super::com::{
    self, failed, hr_text, read_wide, wide, ComPtr, IUnknownVtbl, Interface, GUID, HRESULT,
    IID_IUNKNOWN,
};
use super::com::{E_NOINTERFACE, E_OUTOFMEMORY, E_POINTER, S_OK};
use super::policy::{self, Navigation};
use super::protocol::{window_title, HostMessage, PageMessage, PROTOCOL};
use super::webview2::*;
use super::win32::*;
use super::window::{self, Frame, Target};
use super::{
    flags, set_report, webview2_profile, HostOptions, Reason, Unavailable, WindowReport,
    APP_USER_MODEL_ID,
};
use std::cell::{Cell, RefCell};
use std::ffi::c_void;
use std::path::Path;
use std::rc::{Rc, Weak};
use std::sync::atomic::{AtomicI32, AtomicU32, Ordering};
use std::sync::{Mutex, PoisonError};

/// Microsoft's loader, next to `repackshot.exe`.
pub const LOADER_DLL: &str = "WebView2Loader.dll";
/// The oldest runtime accepted: the first stable WebView2 (86.0.616.0, October 2020). Every
/// interface newer than that is asked for with `QueryInterface` and its absence degrades.
pub const MIN_RUNTIME: &str = "86.0.616.0";
/// The colour behind the page until it says its own: the dark theme's `--bg-0` (theme.css).
const DEFAULT_BACKGROUND: [u8; 3] = [0x0e, 0x0e, 0x0e];
/// `HRESULT_FROM_WIN32(ERROR_FILE_NOT_FOUND)`: what the loader answers without a runtime.
const HR_FILE_NOT_FOUND: HRESULT = 0x8007_0002_u32 as i32;
/// Renderer crashes reloaded before giving up on the window.
const MAX_RELOADS: u32 = 3;

type CreateEnvironmentFn =
    unsafe extern "system" fn(*const u16, *const u16, *mut c_void, *mut c_void) -> HRESULT;
type VersionFn = unsafe extern "system" fn(*const u16, *mut *mut u16) -> HRESULT;

/// Reads and frees a string the callee allocated with `CoTaskMemAlloc` (an `LPWSTR*` out).
///
/// # Safety
///
/// `p` is null or a NUL-terminated string allocated with `CoTaskMemAlloc` that we own.
unsafe fn take_string(p: *mut u16) -> Option<String> {
    // SAFETY: the caller's contract.
    let s = unsafe { read_wide(p) };
    if !p.is_null() {
        // SAFETY: ours to free, allocated by CoTaskMemAlloc.
        unsafe { CoTaskMemFree(p.cast()) };
    }
    s
}

/// A copy of `units` (no NUL) allocated with `CoTaskMemAlloc`, NUL-terminated, for an
/// `LPWSTR*` we answer; null when empty.
fn co_string(units: &[u16]) -> Result<*mut u16, HRESULT> {
    if units.is_empty() {
        return Ok(std::ptr::null_mut());
    }
    // SAFETY: allocates units + 1 code units; the caller (WebView2) frees it with CoTaskMemFree.
    let p = unsafe { CoTaskMemAlloc((units.len() + 1) * 2) }.cast::<u16>();
    if p.is_null() {
        return Err(E_OUTOFMEMORY);
    }
    // SAFETY: `p` has room for len + 1 units; the source is a valid slice that cannot overlap
    // a fresh allocation.
    unsafe {
        std::ptr::copy_nonoverlapping(units.as_ptr(), p, units.len());
        *p.add(units.len()) = 0;
    }
    Ok(p)
}

/// A string property of a WebView2 object.
///
/// # Safety
///
/// `get` is a getter of `this`'s vtable that writes a `CoTaskMemAlloc` string.
unsafe fn get_string(
    this: *mut c_void,
    get: unsafe extern "system" fn(*mut c_void, *mut *mut u16) -> HRESULT,
) -> Option<String> {
    let mut p: *mut u16 = std::ptr::null_mut();
    // SAFETY: the caller's contract; `p` is a valid out parameter.
    let hr = unsafe { get(this, &mut p) };
    // SAFETY: on success `p` is null or a string we own.
    let s = unsafe { take_string(p) };
    if failed(hr) {
        None
    } else {
        s
    }
}

/// A short form of a text for the log.
fn short(text: &str) -> String {
    let mut s: String = text.chars().take(160).collect();
    if s.len() < text.len() {
        s.push('…');
    }
    s
}

// ------------------------------------------------------------------ the loader

struct Loader {
    create: CreateEnvironmentFn,
    version: VersionFn,
}

impl Loader {
    fn load(exe_dir: &Path) -> Result<Loader, Unavailable> {
        let dll = exe_dir.join(LOADER_DLL);
        if !dll.is_file() {
            return Err(Unavailable::new(
                Reason::LoaderMissing,
                format!("{} is missing", dll.display()),
            ));
        }
        let path = wide_path(&dll);
        // SAFETY: an absolute path, NUL-terminated; LOAD_WITH_ALTERED_SEARCH_PATH resolves the
        // DLL's own imports from its folder first (it imports only kernel32).
        let module = unsafe {
            LoadLibraryExW(
                path.as_ptr(),
                std::ptr::null_mut(),
                LOAD_WITH_ALTERED_SEARCH_PATH,
            )
        };
        if module.is_null() {
            // SAFETY: no arguments.
            let e = unsafe { GetLastError() };
            return Err(Unavailable::new(
                Reason::Failed,
                format!("cannot load {}: error {e}", dll.display()),
            ));
        }
        // SAFETY: a loaded module and NUL-terminated ASCII names.
        let (create, version) = unsafe {
            (
                GetProcAddress(module, c"CreateCoreWebView2EnvironmentWithOptions".as_ptr()),
                GetProcAddress(
                    module,
                    c"GetAvailableCoreWebView2BrowserVersionString".as_ptr(),
                ),
            )
        };
        if create.is_null() || version.is_null() {
            return Err(Unavailable::new(
                Reason::Failed,
                format!("{} is not a WebView2 loader", dll.display()),
            ));
        }
        // SAFETY: the two exports have these signatures (WebView2.idl: STDAPI
        // CreateCoreWebView2EnvironmentWithOptions(PCWSTR, PCWSTR, ICoreWebView2EnvironmentOptions*,
        // ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler*); STDAPI
        // GetAvailableCoreWebView2BrowserVersionString(PCWSTR, LPWSTR*)), STDAPI being stdcall.
        // The module is never unloaded, so the pointers stay valid.
        unsafe {
            Ok(Loader {
                create: std::mem::transmute::<*mut c_void, CreateEnvironmentFn>(create),
                version: std::mem::transmute::<*mut c_void, VersionFn>(version),
            })
        }
    }

    /// The installed runtime's version, or why there is none.
    fn runtime_version(&self) -> Result<String, Unavailable> {
        let mut p: *mut u16 = std::ptr::null_mut();
        // SAFETY: null asks for the installed (Evergreen) runtime; `p` is a valid out parameter.
        let hr = unsafe { (self.version)(std::ptr::null(), &mut p) };
        // SAFETY: on return `p` is null or a CoTaskMemAlloc string we own.
        let v = unsafe { take_string(p) };
        match v {
            Some(v) if !failed(hr) && !v.is_empty() => Ok(v),
            _ => Err(Unavailable::new(
                Reason::RuntimeMissing,
                format!("no WebView2 runtime ({})", hr_text(hr)),
            )),
        }
    }
}

// ------------------------------------------------------------------ our environment options

/// `ICoreWebView2EnvironmentOptions`, ours: the additional browser arguments and the oldest
/// runtime accepted; no language override (the system's), no single sign-on.
#[repr(C)]
struct Options {
    vtbl: *const EnvironmentOptionsVtbl,
    refs: AtomicU32,
    // Mutexes, not cells: the loader may read the options from another thread.
    args: Mutex<Vec<u16>>,
    language: Mutex<Vec<u16>>,
    target: Mutex<Vec<u16>>,
    sso: AtomicI32,
}

static OPTIONS_VTBL: EnvironmentOptionsVtbl = EnvironmentOptionsVtbl {
    unknown: IUnknownVtbl {
        QueryInterface: options_query,
        AddRef: options_add_ref,
        Release: options_release,
    },
    get_AdditionalBrowserArguments: get_args,
    put_AdditionalBrowserArguments: put_args,
    get_Language: get_language,
    put_Language: put_language,
    get_TargetCompatibleBrowserVersion: get_target,
    put_TargetCompatibleBrowserVersion: put_target,
    get_AllowSingleSignOnUsingOSPrimaryAccount: options_get_sso,
    put_AllowSingleSignOnUsingOSPrimaryAccount: options_put_sso,
};

unsafe extern "system" fn get_args(this: *mut c_void, out: *mut *mut u16) -> HRESULT {
    options_get(this, out, |o| &o.args)
}
unsafe extern "system" fn put_args(this: *mut c_void, value: *const u16) -> HRESULT {
    options_put(this, value, |o| &o.args)
}
unsafe extern "system" fn get_language(this: *mut c_void, out: *mut *mut u16) -> HRESULT {
    options_get(this, out, |o| &o.language)
}
unsafe extern "system" fn put_language(this: *mut c_void, value: *const u16) -> HRESULT {
    options_put(this, value, |o| &o.language)
}
unsafe extern "system" fn get_target(this: *mut c_void, out: *mut *mut u16) -> HRESULT {
    options_get(this, out, |o| &o.target)
}
unsafe extern "system" fn put_target(this: *mut c_void, value: *const u16) -> HRESULT {
    options_put(this, value, |o| &o.target)
}

fn options(args: &str, min_runtime: &str) -> ComPtr<EnvironmentOptionsVtbl> {
    let o = Box::new(Options {
        vtbl: &OPTIONS_VTBL,
        refs: AtomicU32::new(1),
        args: Mutex::new(args.encode_utf16().collect()),
        language: Mutex::new(Vec::new()),
        target: Mutex::new(min_runtime.encode_utf16().collect()),
        sso: AtomicI32::new(0),
    });
    // SAFETY: a fresh object whose first field points to an EnvironmentOptionsVtbl, with one
    // reference the ComPtr takes over.
    unsafe { ComPtr::from_raw(Box::into_raw(o).cast()) }.expect("Box::into_raw is not null")
}

/// # Safety
/// `this` is one of our Options objects.
unsafe fn options_of<'a>(this: *mut c_void) -> &'a Options {
    // SAFETY: the caller's contract (only OPTIONS_VTBL leads here).
    unsafe { &*this.cast::<Options>() }
}

unsafe extern "system" fn options_query(
    this: *mut c_void,
    iid: *const GUID,
    out: *mut *mut c_void,
) -> HRESULT {
    if out.is_null() || iid.is_null() {
        return E_POINTER;
    }
    // SAFETY: valid pointers (checked); `this` is our object.
    unsafe {
        if *iid == IID_IUNKNOWN || *iid == IID_ENVIRONMENT_OPTIONS {
            options_add_ref(this);
            *out = this;
            S_OK
        } else {
            *out = std::ptr::null_mut();
            E_NOINTERFACE
        }
    }
}

unsafe extern "system" fn options_add_ref(this: *mut c_void) -> u32 {
    // SAFETY: a live object (the caller holds a reference).
    unsafe { options_of(this) }
        .refs
        .fetch_add(1, Ordering::Relaxed)
        + 1
}

unsafe extern "system" fn options_release(this: *mut c_void) -> u32 {
    // SAFETY: a live object (the caller releases its reference).
    let left = unsafe { options_of(this) }
        .refs
        .fetch_sub(1, Ordering::AcqRel)
        - 1;
    if left == 0 {
        // SAFETY: the last reference: made by Box::into_raw in `options`.
        drop(unsafe { Box::from_raw(this.cast::<Options>()) });
    }
    left
}

fn options_get(
    this: *mut c_void,
    out: *mut *mut u16,
    field: fn(&Options) -> &Mutex<Vec<u16>>,
) -> HRESULT {
    if out.is_null() {
        return E_POINTER;
    }
    // SAFETY: only reached through OPTIONS_VTBL, so `this` is our object.
    let o = unsafe { options_of(this) };
    let units = field(o).lock().unwrap_or_else(PoisonError::into_inner);
    match co_string(&units) {
        Ok(p) => {
            // SAFETY: `out` is a valid out parameter (checked).
            unsafe { *out = p };
            S_OK
        }
        Err(hr) => hr,
    }
}

fn options_put(
    this: *mut c_void,
    value: *const u16,
    field: fn(&Options) -> &Mutex<Vec<u16>>,
) -> HRESULT {
    // SAFETY: only reached through OPTIONS_VTBL; `value` is null or a NUL-terminated string.
    let (o, text) = unsafe { (options_of(this), read_wide(value)) };
    *field(o).lock().unwrap_or_else(PoisonError::into_inner) =
        text.unwrap_or_default().encode_utf16().collect();
    S_OK
}

unsafe extern "system" fn options_get_sso(this: *mut c_void, out: *mut BOOL) -> HRESULT {
    if out.is_null() {
        return E_POINTER;
    }
    // SAFETY: our object; `out` checked.
    unsafe { *out = options_of(this).sso.load(Ordering::Relaxed) };
    S_OK
}

unsafe extern "system" fn options_put_sso(this: *mut c_void, value: BOOL) -> HRESULT {
    // SAFETY: our object.
    unsafe { options_of(this) }
        .sso
        .store(value, Ordering::Relaxed);
    S_OK
}

// ------------------------------------------------------------------ the host

struct Host {
    frame: Frame,
    url: String,
    origin: String,
    runtime: String,
    page_alive: Rc<dyn Fn() -> bool>,
    environment: RefCell<Option<ComPtr<EnvironmentVtbl>>>,
    controller: RefCell<Option<ComPtr<ControllerVtbl>>>,
    webview: RefCell<Option<ComPtr<WebViewVtbl>>>,
    /// The first navigation finished.
    loaded: Cell<bool>,
    /// The page said `ready`.
    page_ready: Cell<bool>,
    /// The renderer stopped answering.
    unresponsive: Cell<bool>,
    /// The page agreed to close.
    closing: Cell<bool>,
    reloads: Cell<u32>,
    failure: RefCell<Option<Unavailable>>,
}

/// A `Weak` to the host for a callback: WebView2 holds the callbacks, so they must not keep
/// the host alive.
fn weak(host: &Rc<Host>) -> Weak<Host> {
    Rc::downgrade(host)
}

/// Registers an event handler.
///
/// # Safety
///
/// `add` is an `add_*` method of the object `this`, taking a handler of interface `iid`.
unsafe fn subscribe(
    this: *mut c_void,
    add: unsafe extern "system" fn(
        *mut c_void,
        *mut c_void,
        *mut EventRegistrationToken,
    ) -> HRESULT,
    iid: GUID,
    name: &str,
    f: impl Fn(*mut c_void, *mut c_void) -> HRESULT + 'static,
) {
    let handler = com::event(iid, f);
    let mut token = EventRegistrationToken::default();
    // SAFETY: the caller's contract; WebView2 keeps its own reference to the handler.
    let hr = unsafe { add(this, handler.as_raw(), &mut token) };
    if failed(hr) {
        crate::log!("native window: cannot listen to {name} ({})", hr_text(hr));
    }
}

/// The arguments of an event, kept for the call.
///
/// # Safety
///
/// `args` is null or a live interface pointer of layout `V`.
unsafe fn args_of<V: Interface>(args: *mut c_void) -> Option<ComPtr<V>> {
    // SAFETY: the caller's contract; from_borrowed adds our own reference.
    unsafe { ComPtr::from_borrowed(args) }
}

impl Host {
    fn new(opts: &HostOptions, runtime: String) -> Host {
        Host {
            frame: Frame::new(opts.data_dir.clone(), DEFAULT_BACKGROUND),
            url: opts.url.clone(),
            origin: opts.origin.clone(),
            runtime,
            page_alive: Rc::clone(&opts.page_alive),
            environment: RefCell::new(None),
            controller: RefCell::new(None),
            webview: RefCell::new(None),
            loaded: Cell::new(false),
            page_ready: Cell::new(false),
            unresponsive: Cell::new(false),
            closing: Cell::new(false),
            reloads: Cell::new(0),
            failure: RefCell::new(None),
        }
    }

    // Clones (an AddRef each) so no RefCell borrow is held while WebView2 runs: its calls can
    // dispatch window messages that come back here.
    fn controller(&self) -> Option<ComPtr<ControllerVtbl>> {
        self.controller.borrow().clone()
    }
    fn webview(&self) -> Option<ComPtr<WebViewVtbl>> {
        self.webview.borrow().clone()
    }

    /// Gives up: logs, remembers why (the launcher falls back), closes the window.
    fn fail(&self, why: Unavailable) {
        crate::log!("native window: {why}");
        let mut f = self.failure.borrow_mut();
        if f.is_none() {
            *f = Some(why);
        }
        drop(f);
        self.closing.set(true);
        if !self.frame.hwnd().is_null() {
            self.frame.destroy_later();
        }
    }

    fn post(&self, msg: &HostMessage) {
        let Some(wv) = self.webview() else { return };
        let text = wide(&msg.to_json());
        // SAFETY: a live web view; a NUL-terminated JSON string.
        let hr = unsafe { (wv.vtbl().PostWebMessageAsJson)(wv.as_raw(), text.as_ptr()) };
        if failed(hr) {
            crate::log!("native window: PostWebMessageAsJson {}", hr_text(hr));
        }
    }

    fn set_background(&self, rgb: [u8; 3]) {
        let Some(c) = self.controller() else { return };
        // SAFETY: IID_CONTROLLER2 names ICoreWebView2Controller2, whose layout is Controller2Vtbl.
        if let Some(c2) = unsafe { c.cast::<Controller2Vtbl>(&IID_CONTROLLER2) } {
            let colour = COLOR {
                a: 255,
                r: rgb[0],
                g: rgb[1],
                b: rgb[2],
            };
            // SAFETY: a live controller; a COLOR by value.
            unsafe { (c2.vtbl().put_DefaultBackgroundColor)(c2.as_raw(), colour) };
        }
    }

    /// `CreateCoreWebView2EnvironmentWithOptions`: the rest follows in callbacks.
    fn start(self: &Rc<Self>, loader: &Loader, profile: &Path) -> Result<(), Unavailable> {
        let opts = options(&flags::webview2_arguments(), MIN_RUNTIME);
        let w = weak(self);
        let handler = com::completed(IID_ENVIRONMENT_COMPLETED, move |hr, env| {
            if let Some(h) = w.upgrade() {
                h.on_environment(hr, env);
            }
            S_OK
        });
        let folder = wide_path(profile);
        // SAFETY: the loader's export; null browser folder (the installed runtime), our
        // profile folder, our options and handler objects, which WebView2 AddRefs as it needs.
        let hr = unsafe {
            (loader.create)(
                std::ptr::null(),
                folder.as_ptr(),
                opts.as_raw(),
                handler.as_raw(),
            )
        };
        if failed(hr) {
            let reason = if hr == HR_FILE_NOT_FOUND {
                Reason::RuntimeMissing
            } else {
                Reason::Failed
            };
            return Err(Unavailable::new(
                reason,
                format!("CreateCoreWebView2EnvironmentWithOptions: {}", hr_text(hr)),
            ));
        }
        Ok(())
    }

    fn on_environment(self: &Rc<Self>, hr: HRESULT, env: *mut c_void) {
        if failed(hr) || env.is_null() {
            self.fail(Unavailable::new(
                Reason::Failed,
                format!("creating the WebView2 environment: {}", hr_text(hr)),
            ));
            return;
        }
        let hwnd = self.frame.hwnd();
        if hwnd.is_null() {
            return; // closed while starting
        }
        // SAFETY: the callback's environment, an ICoreWebView2Environment (lent: AddRef).
        let Some(env) = (unsafe { ComPtr::<EnvironmentVtbl>::from_borrowed(env) }) else {
            return;
        };
        let w = weak(self);
        let handler = com::completed(IID_CONTROLLER_COMPLETED, move |hr, c| {
            if let Some(h) = w.upgrade() {
                h.on_controller(hr, c);
            }
            S_OK
        });
        // SAFETY: a live environment; our window as parent; our handler.
        let hr = unsafe {
            (env.vtbl().CreateCoreWebView2Controller)(env.as_raw(), hwnd, handler.as_raw())
        };
        *self.environment.borrow_mut() = Some(env);
        if failed(hr) {
            self.fail(Unavailable::new(
                Reason::Failed,
                format!("CreateCoreWebView2Controller: {}", hr_text(hr)),
            ));
        }
    }

    fn on_controller(self: &Rc<Self>, hr: HRESULT, c: *mut c_void) {
        if failed(hr) || c.is_null() {
            self.fail(Unavailable::new(
                Reason::Failed,
                format!("creating the WebView2 controller: {}", hr_text(hr)),
            ));
            return;
        }
        // SAFETY: the callback's controller, an ICoreWebView2Controller (lent: AddRef).
        let Some(controller) = (unsafe { ComPtr::<ControllerVtbl>::from_borrowed(c) }) else {
            return;
        };
        if self.frame.hwnd().is_null() || self.closing.get() {
            // SAFETY: a live controller we will not use.
            unsafe { (controller.vtbl().Close)(controller.as_raw()) };
            return;
        }
        let mut raw: *mut c_void = std::ptr::null_mut();
        // SAFETY: a live controller; `raw` receives an ICoreWebView2 reference we own.
        let hr = unsafe { (controller.vtbl().get_CoreWebView2)(controller.as_raw(), &mut raw) };
        // SAFETY: on success, `raw` is an ICoreWebView2 we own.
        let Some(webview) =
            (unsafe { ComPtr::<WebViewVtbl>::from_raw(raw) }).filter(|_| !failed(hr))
        else {
            self.fail(Unavailable::new(
                Reason::Failed,
                format!("get_CoreWebView2: {}", hr_text(hr)),
            ));
            return;
        };
        *self.controller.borrow_mut() = Some(controller.clone());
        *self.webview.borrow_mut() = Some(webview.clone());
        self.set_background(self.frame.background());
        self.apply_settings(&webview);
        self.listen(&webview);
        let mut client = RECT::default();
        // SAFETY: our window; a live controller; a RECT by value.
        unsafe {
            GetClientRect(self.frame.hwnd(), &mut client);
            (controller.vtbl().put_Bounds)(controller.as_raw(), client);
            (controller.vtbl().put_IsVisible)(controller.as_raw(), 1);
            (controller.vtbl().MoveFocus)(controller.as_raw(), MOVE_FOCUS_PROGRAMMATIC);
        }
        let url = wide(&self.url);
        // SAFETY: a live web view; a NUL-terminated URL.
        let hr = unsafe { (webview.vtbl().Navigate)(webview.as_raw(), url.as_ptr()) };
        if failed(hr) {
            self.fail(Unavailable::new(
                Reason::Failed,
                format!("Navigate: {}", hr_text(hr)),
            ));
        }
    }

    /// Everything that is not our interface, off (`policy::host_settings`).
    fn apply_settings(&self, webview: &ComPtr<WebViewVtbl>) {
        let mut raw: *mut c_void = std::ptr::null_mut();
        // SAFETY: a live web view; `raw` receives an ICoreWebView2Settings we own.
        let hr = unsafe { (webview.vtbl().get_Settings)(webview.as_raw(), &mut raw) };
        // SAFETY: on success, `raw` is an ICoreWebView2Settings we own.
        let Some(s) = (unsafe { ComPtr::<SettingsVtbl>::from_raw(raw) }).filter(|_| !failed(hr))
        else {
            crate::log!("native window: no settings ({})", hr_text(hr));
            return;
        };
        let p = policy::host_settings(cfg!(debug_assertions));
        let mut failures: Vec<String> = Vec::new();
        let check = |failures: &mut Vec<String>, name: &str, hr: HRESULT| {
            if failed(hr) {
                failures.push(format!("{name} {}", hr_text(hr)));
            }
        };
        let b = |v: bool| -> BOOL { i32::from(v) };
        let v = s.vtbl();
        let this = s.as_raw();
        // SAFETY: a live ICoreWebView2Settings; BOOL setters of its own vtable.
        unsafe {
            check(
                &mut failures,
                "IsScriptEnabled",
                (v.put_IsScriptEnabled)(this, b(p.script)),
            );
            check(
                &mut failures,
                "IsWebMessageEnabled",
                (v.put_IsWebMessageEnabled)(this, b(p.web_message)),
            );
            check(
                &mut failures,
                "AreDefaultScriptDialogsEnabled",
                (v.put_AreDefaultScriptDialogsEnabled)(this, b(p.default_script_dialogs)),
            );
            check(
                &mut failures,
                "IsStatusBarEnabled",
                (v.put_IsStatusBarEnabled)(this, b(p.status_bar)),
            );
            check(
                &mut failures,
                "AreDevToolsEnabled",
                (v.put_AreDevToolsEnabled)(this, b(p.dev_tools)),
            );
            check(
                &mut failures,
                "AreDefaultContextMenusEnabled",
                (v.put_AreDefaultContextMenusEnabled)(this, b(p.default_context_menus)),
            );
            check(
                &mut failures,
                "AreHostObjectsAllowed",
                (v.put_AreHostObjectsAllowed)(this, b(p.host_objects)),
            );
            check(
                &mut failures,
                "IsZoomControlEnabled",
                (v.put_IsZoomControlEnabled)(this, b(p.zoom_control)),
            );
            check(
                &mut failures,
                "IsBuiltInErrorPageEnabled",
                (v.put_IsBuiltInErrorPageEnabled)(this, b(p.built_in_error_page)),
            );
        }
        let mut missing: Vec<&str> = Vec::new();
        // Each newer interface is the same object seen through a longer vtable; an old runtime
        // answers E_NOINTERFACE and keeps its (older, quieter) behaviour.
        // SAFETY (each cast): the IID names the interface whose layout is the type given.
        match unsafe { s.cast::<Settings3Vtbl>(&IID_SETTINGS3) } {
            // SAFETY: a live ICoreWebView2Settings3.
            Some(s3) => check(&mut failures, "AreBrowserAcceleratorKeysEnabled", unsafe {
                (s3.vtbl().put_AreBrowserAcceleratorKeysEnabled)(
                    s3.as_raw(),
                    b(p.browser_accelerator_keys),
                )
            }),
            None => missing.push("Settings3 (browser shortcuts)"),
        }
        match unsafe { s.cast::<Settings4Vtbl>(&IID_SETTINGS4) } {
            // SAFETY: a live ICoreWebView2Settings4.
            Some(s4) => unsafe {
                check(
                    &mut failures,
                    "IsPasswordAutosaveEnabled",
                    (s4.vtbl().put_IsPasswordAutosaveEnabled)(s4.as_raw(), b(p.password_autosave)),
                );
                check(
                    &mut failures,
                    "IsGeneralAutofillEnabled",
                    (s4.vtbl().put_IsGeneralAutofillEnabled)(s4.as_raw(), b(p.general_autofill)),
                );
            },
            None => missing.push("Settings4 (autofill)"),
        }
        match unsafe { s.cast::<Settings5Vtbl>(&IID_SETTINGS5) } {
            // SAFETY: a live ICoreWebView2Settings5.
            Some(s5) => check(&mut failures, "IsPinchZoomEnabled", unsafe {
                (s5.vtbl().put_IsPinchZoomEnabled)(s5.as_raw(), b(p.pinch_zoom))
            }),
            None => missing.push("Settings5 (pinch zoom)"),
        }
        match unsafe { s.cast::<Settings6Vtbl>(&IID_SETTINGS6) } {
            // SAFETY: a live ICoreWebView2Settings6.
            Some(s6) => check(&mut failures, "IsSwipeNavigationEnabled", unsafe {
                (s6.vtbl().put_IsSwipeNavigationEnabled)(s6.as_raw(), b(p.swipe_navigation))
            }),
            None => missing.push("Settings6 (swipe navigation)"),
        }
        match unsafe { s.cast::<Settings8Vtbl>(&IID_SETTINGS8) } {
            // SAFETY: a live ICoreWebView2Settings8.
            Some(s8) => check(&mut failures, "IsReputationCheckingRequired", unsafe {
                (s8.vtbl().put_IsReputationCheckingRequired)(s8.as_raw(), b(p.reputation_checking))
            }),
            None => missing.push("Settings8 (SmartScreen)"),
        }
        if !missing.is_empty() {
            crate::log!(
                "native window: WebView2 {} lacks {}",
                self.runtime,
                missing.join(", ")
            );
        }
        if !failures.is_empty() {
            crate::log!("native window: settings refused: {}", failures.join(", "));
        }
    }

    /// The events that keep everything ours.
    fn listen(self: &Rc<Self>, webview: &ComPtr<WebViewVtbl>) {
        let v = webview.vtbl();
        let this = webview.as_raw();
        macro_rules! on {
            ($add:expr, $iid:expr, $name:expr, |$h:ident, $args:ident| $body:expr) => {{
                let w = weak(self);
                // SAFETY: `$add` is an add_* method of this web view taking a handler of `$iid`.
                unsafe {
                    subscribe(this, $add, $iid, $name, move |_sender, $args| {
                        if let Some($h) = w.upgrade() {
                            $body;
                        }
                        S_OK
                    })
                };
            }};
        }
        on!(
            v.add_NavigationStarting,
            IID_NAVIGATION_STARTING_HANDLER,
            "NavigationStarting",
            |h, args| h.on_navigation_starting(args, false)
        );
        on!(
            v.add_FrameNavigationStarting,
            IID_NAVIGATION_STARTING_HANDLER,
            "FrameNavigationStarting",
            |h, args| h.on_navigation_starting(args, true)
        );
        on!(
            v.add_NavigationCompleted,
            IID_NAVIGATION_COMPLETED_HANDLER,
            "NavigationCompleted",
            |h, args| h.on_navigation_completed(args)
        );
        on!(
            v.add_ScriptDialogOpening,
            IID_SCRIPT_DIALOG_OPENING_HANDLER,
            "ScriptDialogOpening",
            |h, args| h.on_script_dialog(args)
        );
        on!(
            v.add_PermissionRequested,
            IID_PERMISSION_REQUESTED_HANDLER,
            "PermissionRequested",
            |h, args| h.on_permission(args)
        );
        on!(
            v.add_ProcessFailed,
            IID_PROCESS_FAILED_HANDLER,
            "ProcessFailed",
            |h, args| h.on_process_failed(args)
        );
        on!(
            v.add_WebMessageReceived,
            IID_WEB_MESSAGE_RECEIVED_HANDLER,
            "WebMessageReceived",
            |h, args| h.on_web_message(args)
        );
        on!(
            v.add_NewWindowRequested,
            IID_NEW_WINDOW_REQUESTED_HANDLER,
            "NewWindowRequested",
            |h, args| h.on_new_window(args)
        );
        // SAFETY: IID_WEBVIEW2_4 names ICoreWebView2_4, whose layout is WebView2_4Vtbl.
        match unsafe { webview.cast::<WebView2_4Vtbl>(&IID_WEBVIEW2_4) } {
            Some(w4) => {
                let w = weak(self);
                // SAFETY: add_DownloadStarting of a live ICoreWebView2_4, with a handler of its
                // interface.
                unsafe {
                    subscribe(
                        w4.as_raw(),
                        w4.vtbl().add_DownloadStarting,
                        IID_DOWNLOAD_STARTING_HANDLER,
                        "DownloadStarting",
                        move |_s, args| {
                            if let Some(h) = w.upgrade() {
                                h.on_download(args);
                            }
                            S_OK
                        },
                    )
                };
            }
            None => crate::log!(
                "native window: WebView2 {} lacks ICoreWebView2_4 (downloads)",
                self.runtime
            ),
        }
    }

    fn open_external(&self, url: &str) {
        let (verb, file) = (wide("open"), wide(url));
        // SAFETY: NUL-terminated strings; ShellExecuteW opens the URL in the default browser.
        let r = unsafe {
            ShellExecuteW(
                self.frame.hwnd(),
                verb.as_ptr(),
                file.as_ptr(),
                std::ptr::null(),
                std::ptr::null(),
                SW_SHOWNORMAL,
            )
        };
        if (r as isize) <= 32 {
            crate::log!(
                "native window: cannot open {} (ShellExecuteW {})",
                short(url),
                r as isize
            );
        }
    }

    fn on_navigation_starting(&self, args: *mut c_void, frame: bool) {
        // SAFETY: the event's arguments are an ICoreWebView2NavigationStartingEventArgs.
        let Some(a) = (unsafe { args_of::<NavigationStartingArgsVtbl>(args) }) else {
            return;
        };
        let v = a.vtbl();
        // SAFETY: getters of a live object.
        let (uri, user) = unsafe {
            let mut user: BOOL = 0;
            (v.get_IsUserInitiated)(a.as_raw(), &mut user);
            (
                get_string(a.as_raw(), v.get_Uri).unwrap_or_default(),
                user != 0,
            )
        };
        let decision = policy::navigation(&uri, &self.origin, user, frame);
        if decision != Navigation::Allow {
            // SAFETY: a live object.
            unsafe { (v.put_Cancel)(a.as_raw(), 1) };
            crate::log!("native window: navigation to {} stopped", short(&uri));
        }
        if let Navigation::OpenExternally(u) = decision {
            self.open_external(&u);
        }
    }

    fn on_navigation_completed(&self, args: *mut c_void) {
        // SAFETY: the event's arguments are an ICoreWebView2NavigationCompletedEventArgs.
        let Some(a) = (unsafe { args_of::<NavigationCompletedArgsVtbl>(args) }) else {
            return;
        };
        let (mut ok, mut status): (BOOL, i32) = (0, 0);
        // SAFETY: getters of a live object.
        unsafe {
            (a.vtbl().get_IsSuccess)(a.as_raw(), &mut ok);
            (a.vtbl().get_WebErrorStatus)(a.as_raw(), &mut status);
        }
        if self.loaded.get() {
            if ok == 0 {
                crate::log!("native window: a navigation failed (web error status {status})");
            }
            return;
        }
        if ok != 0 {
            self.loaded.set(true);
            crate::log!(
                "native window: the interface loaded in WebView2 {}",
                self.runtime
            );
        } else {
            self.fail(Unavailable::new(
                Reason::Failed,
                format!("the interface did not load (web error status {status})"),
            ));
        }
    }

    fn on_script_dialog(&self, args: *mut c_void) {
        // SAFETY: the event's arguments are an ICoreWebView2ScriptDialogOpeningEventArgs.
        let Some(a) = (unsafe { args_of::<ScriptDialogOpeningArgsVtbl>(args) }) else {
            return;
        };
        let mut kind = 0;
        // SAFETY: getters and Accept of a live object.
        unsafe {
            (a.vtbl().get_Kind)(a.as_raw(), &mut kind);
            if policy::accept_script_dialog(kind) {
                (a.vtbl().Accept)(a.as_raw());
            } else {
                let message = get_string(a.as_raw(), a.vtbl().get_Message).unwrap_or_default();
                crate::log!(
                    "native window: script dialog {kind} not shown: {}",
                    short(&message)
                );
            }
        }
    }

    fn on_permission(&self, args: *mut c_void) {
        // SAFETY: the event's arguments are an ICoreWebView2PermissionRequestedEventArgs.
        let Some(a) = (unsafe { args_of::<PermissionRequestedArgsVtbl>(args) }) else {
            return;
        };
        let mut kind = 0;
        // SAFETY: getters and a setter of a live object.
        unsafe {
            (a.vtbl().get_PermissionKind)(a.as_raw(), &mut kind);
            let uri = get_string(a.as_raw(), a.vtbl().get_Uri).unwrap_or_default();
            let state = policy::permission(kind, policy::same_origin(&uri, &self.origin));
            (a.vtbl().put_State)(a.as_raw(), state);
            let name = usize::try_from(kind)
                .ok()
                .and_then(|k| PERMISSION_KINDS.get(k))
                .copied()
                .unwrap_or("?");
            crate::log!(
                "native window: permission {name} {}",
                if state == PERMISSION_ALLOW {
                    "granted"
                } else {
                    "denied"
                }
            );
        }
    }

    fn on_process_failed(&self, args: *mut c_void) {
        // SAFETY: the event's arguments are an ICoreWebView2ProcessFailedEventArgs.
        let Some(a) = (unsafe { args_of::<ProcessFailedArgsVtbl>(args) }) else {
            return;
        };
        let mut kind = -1;
        // SAFETY: a getter of a live object.
        unsafe { (a.vtbl().get_ProcessFailedKind)(a.as_raw(), &mut kind) };
        match kind {
            PROCESS_BROWSER_EXITED => self.fail(Unavailable::new(
                Reason::Failed,
                "the WebView2 browser process exited",
            )),
            PROCESS_RENDER_EXITED => {
                let n = self.reloads.get() + 1;
                self.reloads.set(n);
                if n > MAX_RELOADS {
                    self.fail(Unavailable::new(
                        Reason::Failed,
                        "the page's renderer keeps exiting",
                    ));
                } else if let Some(wv) = self.webview() {
                    crate::log!("native window: the page's renderer exited; reloading");
                    self.page_ready.set(false);
                    // SAFETY: a live web view.
                    unsafe { (wv.vtbl().Reload)(wv.as_raw()) };
                }
            }
            PROCESS_RENDER_UNRESPONSIVE => {
                crate::log!("native window: the page stopped answering; closing will not ask it");
                self.unresponsive.set(true);
            }
            other => crate::log!("native window: a WebView2 helper process exited (kind {other})"),
        }
    }

    fn on_web_message(&self, args: *mut c_void) {
        // SAFETY: the event's arguments are an ICoreWebView2WebMessageReceivedEventArgs.
        let Some(a) = (unsafe { args_of::<WebMessageReceivedArgsVtbl>(args) }) else {
            return;
        };
        // SAFETY: getters of a live object.
        let (source, text) = unsafe {
            (
                get_string(a.as_raw(), a.vtbl().get_Source).unwrap_or_default(),
                get_string(a.as_raw(), a.vtbl().get_WebMessageAsJson).unwrap_or_default(),
            )
        };
        if !policy::same_origin(&source, &self.origin) {
            crate::log!("native window: a message from {} ignored", short(&source));
            return;
        }
        self.unresponsive.set(false);
        match PageMessage::parse(&text) {
            Ok(m) => self.on_page(m),
            Err(e) => crate::log!("native window: a message from the page ignored: {e}"),
        }
    }

    fn on_page(&self, msg: PageMessage) {
        match msg {
            PageMessage::Ready { protocol } => {
                if protocol != PROTOCOL {
                    crate::log!(
                        "native window: the page speaks protocol {protocol}, the window {PROTOCOL}"
                    );
                }
                self.page_ready.set(true);
                self.post(&HostMessage::Host {
                    runtime: self.runtime.clone(),
                });
            }
            PageMessage::Title { project } => self.frame.set_title(&window_title(&project)),
            PageMessage::Close => self.frame.close(),
            PageMessage::CloseOk => {
                self.closing.set(true);
                self.frame.destroy_later();
            }
            PageMessage::Theme { dark, background } => {
                if !self.frame.set_theme(dark, background) && dark {
                    crate::log!("native window: this Windows has no dark title bar");
                }
                if let Some(rgb) = background {
                    self.set_background(rgb);
                }
            }
        }
    }

    fn on_new_window(&self, args: *mut c_void) {
        // SAFETY: the event's arguments are an ICoreWebView2NewWindowRequestedEventArgs.
        let Some(a) = (unsafe { args_of::<NewWindowRequestedArgsVtbl>(args) }) else {
            return;
        };
        // SAFETY: getters and a setter of a live object. Handled with no new window given:
        // nothing opens.
        let (uri, user) = unsafe {
            let mut user: BOOL = 0;
            (a.vtbl().get_IsUserInitiated)(a.as_raw(), &mut user);
            (a.vtbl().put_Handled)(a.as_raw(), 1);
            (
                get_string(a.as_raw(), a.vtbl().get_Uri).unwrap_or_default(),
                user != 0,
            )
        };
        match policy::new_window(&uri, user) {
            Navigation::OpenExternally(u) => self.open_external(&u),
            _ => crate::log!("native window: new window for {} refused", short(&uri)),
        }
    }

    fn on_download(&self, args: *mut c_void) {
        // SAFETY: the event's arguments are an ICoreWebView2DownloadStartingEventArgs.
        let Some(a) = (unsafe { args_of::<DownloadStartingArgsVtbl>(args) }) else {
            return;
        };
        // SAFETY: getters and setters of a live object: cancelled, and handled so the browser's
        // download flyout never shows.
        let path = unsafe {
            (a.vtbl().put_Cancel)(a.as_raw(), 1);
            (a.vtbl().put_Handled)(a.as_raw(), 1);
            get_string(a.as_raw(), a.vtbl().get_ResultFilePath).unwrap_or_default()
        };
        let name = Path::new(&path)
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        crate::log!(
            "native window: a browser download was cancelled ({}): files go through the launcher",
            short(&name)
        );
    }
}

impl Target for Host {
    fn frame(&self) -> &Frame {
        &self.frame
    }

    fn close_requested(&self) -> bool {
        if self.closing.get() {
            return true;
        }
        // A page that is not there, not ready or not answering cannot ask: close.
        let ask = self.loaded.get()
            && self.page_ready.get()
            && !self.unresponsive.get()
            && (self.page_alive)();
        if ask {
            self.post(&HostMessage::CloseRequested);
        }
        !ask
    }

    fn layout(&self, client: RECT) {
        if let Some(c) = self.controller() {
            // SAFETY: a live controller; a RECT by value.
            unsafe { (c.vtbl().put_Bounds)(c.as_raw(), client) };
        }
    }

    fn moved(&self) {
        if let Some(c) = self.controller() {
            // SAFETY: a live controller.
            unsafe { (c.vtbl().NotifyParentWindowPositionChanged)(c.as_raw()) };
        }
    }

    fn take_focus(&self) {
        if let Some(c) = self.controller() {
            // SAFETY: a live controller.
            unsafe { (c.vtbl().MoveFocus)(c.as_raw(), MOVE_FOCUS_PROGRAMMATIC) };
        }
    }

    fn closing(&self) {
        self.closing.set(true);
        self.webview.borrow_mut().take();
        let controller = self.controller.borrow_mut().take();
        if let Some(c) = controller {
            // SAFETY: a live controller, closed before its parent window goes (as WebView2
            // requires); its handlers are released with it.
            unsafe { (c.vtbl().Close)(c.as_raw()) };
        }
        self.environment.borrow_mut().take();
    }
}

/// COM on this thread for the life of the window.
struct Com;

impl Com {
    fn init() -> Result<Com, Unavailable> {
        // SAFETY: initialises COM for this thread as a single-threaded apartment, which
        // WebView2 requires; balanced by CoUninitialize in Drop.
        let hr = unsafe {
            CoInitializeEx(
                std::ptr::null_mut(),
                COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE,
            )
        };
        if hr == S_OK || hr == S_FALSE {
            Ok(Com)
        } else {
            Err(Unavailable::new(
                Reason::Failed,
                format!("CoInitializeEx: {}", hr_text(hr)),
            ))
        }
    }
}

impl Drop for Com {
    fn drop(&mut self) {
        // SAFETY: balances the successful CoInitializeEx of `init`, after every COM object of
        // this thread was released.
        unsafe { CoUninitialize() };
    }
}

fn message_loop() {
    // SAFETY: a plain MSG; the standard loop of this thread's windows.
    unsafe {
        let mut msg: MSG = std::mem::zeroed();
        loop {
            let r = GetMessageW(&mut msg, std::ptr::null_mut(), 0, 0);
            if r == 0 || r == -1 {
                break;
            }
            TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
    }
}

/// Runs the native window until it closes; see [`super::run_native_window`].
pub fn run(opts: &HostOptions) -> Result<(), Unavailable> {
    let loader = Loader::load(&opts.exe_dir)?;
    let runtime = loader.runtime_version()?;
    crate::log!("native window: WebView2 runtime {runtime}");
    let profile = webview2_profile(&opts.data_dir);
    std::fs::create_dir_all(&profile)
        .map_err(|e| Unavailable::new(Reason::Failed, format!("{}: {e}", profile.display())))?;
    let com = Com::init()?;
    if !set_per_monitor_dpi() {
        crate::log!("native window: no per-monitor DPI awareness on this system");
    }
    let id = wide(APP_USER_MODEL_ID);
    // SAFETY: a NUL-terminated string; set before the first window, as the API requires.
    let hr = unsafe { SetCurrentProcessExplicitAppUserModelID(id.as_ptr()) };
    if failed(hr) {
        crate::log!("native window: no AppUserModelID ({})", hr_text(hr));
    }
    let host = Rc::new(Host::new(opts, runtime.clone()));
    window::install(host.clone());
    // The app window's profile preferences (browser::PROFILE_PREFERENCES: no translation, no
    // spelling service, no Edge mini menu...) in WebView2's profile too (<profile>/EBWebView).
    if let Err(e) = crate::browser::seed_profile(&profile.join("EBWebView")) {
        crate::log!("native window: cannot write the profile's preferences: {e}");
    }
    let started = (|| {
        let hwnd = host
            .frame
            .create()
            .map_err(|e| Unavailable::new(Reason::Failed, e))?;
        // The launcher's file dialogs open owned by this window, in front of it.
        (opts.on_window)(hwnd as usize as u64);
        if !host.frame.has_icon() {
            crate::log!("native window: this build has no icon resource (the system's is shown)");
        }
        set_report(WindowReport::webview2(&runtime));
        host.frame.show();
        host.start(&loader, &profile)
    })();
    match started {
        Ok(()) => message_loop(),
        Err(ref e) => {
            crate::log!("native window: {e}");
            if !host.frame.hwnd().is_null() {
                host.frame.destroy(&*host);
            }
        }
    }
    host.closing();
    (opts.on_window)(0);
    window::uninstall();
    let failure = host.failure.borrow_mut().take();
    drop(host);
    drop(com);
    match (started, failure) {
        (Err(e), _) | (Ok(()), Some(e)) => Err(e),
        (Ok(()), None) => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn our_environment_options_answer_like_com() {
        // SAFETY: COM for the test thread (CoTaskMemAlloc works either way).
        unsafe { CoInitializeEx(std::ptr::null_mut(), COINIT_APARTMENTTHREADED) };
        let o = options("--a --b", MIN_RUNTIME);
        let v = o.vtbl();
        // SAFETY: our own object through its vtable, as the loader calls it.
        unsafe {
            let mut p: *mut u16 = std::ptr::null_mut();
            assert_eq!((v.get_AdditionalBrowserArguments)(o.as_raw(), &mut p), S_OK);
            assert_eq!(take_string(p).as_deref(), Some("--a --b"));
            assert_eq!(
                (v.get_TargetCompatibleBrowserVersion)(o.as_raw(), &mut p),
                S_OK
            );
            assert_eq!(take_string(p).as_deref(), Some(MIN_RUNTIME));
            // No language: a null string, S_OK (the system's language).
            p = std::ptr::dangling_mut::<u16>();
            assert_eq!((v.get_Language)(o.as_raw(), &mut p), S_OK);
            assert!(p.is_null());
            let es = wide("es-ES");
            assert_eq!((v.put_Language)(o.as_raw(), es.as_ptr()), S_OK);
            assert_eq!((v.get_Language)(o.as_raw(), &mut p), S_OK);
            assert_eq!(take_string(p).as_deref(), Some("es-ES"));
            let mut sso: BOOL = 7;
            assert_eq!(
                (v.get_AllowSingleSignOnUsingOSPrimaryAccount)(o.as_raw(), &mut sso),
                S_OK
            );
            assert_eq!(sso, 0);
            assert_eq!(
                (v.get_AdditionalBrowserArguments)(o.as_raw(), std::ptr::null_mut()),
                E_POINTER
            );
            // QueryInterface: itself, nothing newer (ICoreWebView2EnvironmentOptions2 and on).
            assert!(o
                .cast::<EnvironmentOptionsVtbl>(&IID_ENVIRONMENT_OPTIONS)
                .is_some());
            assert!(o.cast::<IUnknownVtbl>(&IID_IUNKNOWN).is_some());
            assert!(o.cast::<IUnknownVtbl>(&IID_SETTINGS9).is_none());
            CoUninitialize();
        }
    }

    #[test]
    fn a_missing_loader_is_reported_as_such() {
        let dir = crate::test_dir("no-loader");
        let e = Loader::load(&dir).err().unwrap();
        assert_eq!(e.reason, Reason::LoaderMissing);
        // Something that is not a DLL is a failure, not a missing runtime.
        std::fs::write(dir.join(LOADER_DLL), b"not a dll").unwrap();
        assert_eq!(Loader::load(&dir).err().unwrap().reason, Reason::Failed);
    }
}
