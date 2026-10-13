//! COM by hand, the part that does not need Windows: GUIDs, `HRESULT`s, the `IUnknown` layout, a
//! counted pointer to an interface ([`ComPtr`]), UTF-16 strings, and our own COM objects for the
//! callbacks WebView2 calls back ([`completed`], [`event`]).
//!
//! A COM interface pointer points to an object whose first field is a pointer to a table of
//! functions (the vtable); the first three are `QueryInterface`, `AddRef` and `Release`, the
//! rest are the interface's methods in the order of its IDL, the ones of the interface it
//! derives from first. Every function takes the interface pointer (`this`) first and uses the
//! `system` calling convention (`stdcall` on 32-bit x86, the only convention on x86-64 and
//! ARM64). Sources: Microsoft's *The Component Object Model* and *IUnknown* reference pages
//! (learn.microsoft.com/windows/win32/com) and the WebView2 IDL (`webview2.rs`).
//!
//! Nothing here calls the operating system, so it compiles and is tested on every platform
//! (`system` is the C convention outside Windows): the reference counting, `QueryInterface` and
//! `Invoke` of our objects are checked on Linux too.

use std::ffi::c_void;
use std::ptr::NonNull;
use std::sync::atomic::{AtomicU32, Ordering};

/// A COM result: negative is a failure.
pub type HRESULT = i32;
/// Success.
pub const S_OK: HRESULT = 0;
/// Not implemented.
pub const E_NOTIMPL: HRESULT = 0x8000_4001_u32 as i32;
/// The object does not have that interface.
pub const E_NOINTERFACE: HRESULT = 0x8000_4002_u32 as i32;
/// A null pointer where one was needed.
pub const E_POINTER: HRESULT = 0x8000_4003_u32 as i32;
/// Unspecified failure.
pub const E_FAIL: HRESULT = 0x8000_4005_u32 as i32;
/// Out of memory.
pub const E_OUTOFMEMORY: HRESULT = 0x8007_000E_u32 as i32;

/// Whether an `HRESULT` is a failure.
pub fn failed(hr: HRESULT) -> bool {
    hr < 0
}

/// An `HRESULT` as Windows prints it (`0x80070002`), for the log.
pub fn hr_text(hr: HRESULT) -> String {
    format!("0x{:08x}", hr as u32)
}

/// A GUID (an interface identifier, IID), laid out as Windows lays it out.
#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct GUID {
    /// The first 8 hexadecimal digits.
    pub data1: u32,
    /// The next 4.
    pub data2: u16,
    /// The next 4.
    pub data3: u16,
    /// The last 16, as bytes in the order they are written.
    pub data4: [u8; 8],
}

const fn hex_digit(c: u8) -> u64 {
    match c {
        b'0'..=b'9' => (c - b'0') as u64,
        b'a'..=b'f' => (c - b'a' + 10) as u64,
        b'A'..=b'F' => (c - b'A' + 10) as u64,
        _ => panic!("a GUID has hexadecimal digits only"),
    }
}

const fn hex_field(b: &[u8], start: usize, len: usize) -> u64 {
    let mut v = 0;
    let mut i = 0;
    while i < len {
        v = (v << 4) | hex_digit(b[start + i]);
        i += 1;
    }
    v
}

impl GUID {
    /// Reads `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx` (any case), at compile time for constants.
    ///
    /// # Panics
    ///
    /// On anything else (in a constant, that is a compile error).
    pub const fn parse(text: &str) -> GUID {
        let b = text.as_bytes();
        assert!(b.len() == 36, "a GUID has 36 characters");
        assert!(
            b[8] == b'-' && b[13] == b'-' && b[18] == b'-' && b[23] == b'-',
            "a GUID has dashes after 8, 12, 16 and 20 digits"
        );
        let mut data4 = [0u8; 8];
        data4[0] = hex_field(b, 19, 2) as u8;
        data4[1] = hex_field(b, 21, 2) as u8;
        let mut i = 0;
        while i < 6 {
            data4[2 + i] = hex_field(b, 24 + 2 * i, 2) as u8;
            i += 1;
        }
        GUID {
            data1: hex_field(b, 0, 8) as u32,
            data2: hex_field(b, 9, 4) as u16,
            data3: hex_field(b, 14, 4) as u16,
            data4,
        }
    }

    /// The text form, lower case.
    pub fn to_text(&self) -> String {
        let d = &self.data4;
        format!(
            "{:08x}-{:04x}-{:04x}-{:02x}{:02x}-{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}",
            self.data1, self.data2, self.data3, d[0], d[1], d[2], d[3], d[4], d[5], d[6], d[7]
        )
    }
}

/// `IUnknown`.
pub const IID_IUNKNOWN: GUID = GUID::parse("00000000-0000-0000-c000-000000000046");

/// A vtable slot this program never calls: it only has to take its place.
pub type Slot = usize;

/// `IUnknown`'s three functions, the start of every vtable.
#[allow(non_snake_case, missing_docs)]
#[repr(C)]
pub struct IUnknownVtbl {
    pub QueryInterface: unsafe extern "system" fn(
        this: *mut c_void,
        iid: *const GUID,
        out: *mut *mut c_void,
    ) -> HRESULT,
    pub AddRef: unsafe extern "system" fn(this: *mut c_void) -> u32,
    pub Release: unsafe extern "system" fn(this: *mut c_void) -> u32,
}

/// A vtable that starts with `IUnknown`'s three functions.
///
/// # Safety
///
/// Only for `#[repr(C)]` structs whose first field is an [`IUnknownVtbl`] (directly, or through
/// a first field that is itself such a struct), so a pointer to the vtable is a pointer to an
/// `IUnknownVtbl`.
pub unsafe trait Interface {}

// SAFETY: it is the IUnknownVtbl itself.
unsafe impl Interface for IUnknownVtbl {}

/// A counted reference to a COM interface whose vtable has the layout `V`: `Clone` is `AddRef`,
/// `Drop` is `Release`.
pub struct ComPtr<V: Interface> {
    /// The interface pointer: the object, whose first field points to the vtable.
    ptr: NonNull<*const V>,
}

impl<V: Interface> ComPtr<V> {
    /// Takes over one reference of `ptr` (as returned in an out parameter). `None` for null.
    ///
    /// # Safety
    ///
    /// `ptr` is null or a live interface pointer whose vtable has the layout `V`, and the caller
    /// owns the reference it hands over.
    pub unsafe fn from_raw(ptr: *mut c_void) -> Option<ComPtr<V>> {
        NonNull::new(ptr.cast::<*const V>()).map(|ptr| ComPtr { ptr })
    }

    /// Keeps `ptr` with a reference of its own (`AddRef`): for a pointer the callee only lends,
    /// like the arguments of a callback. `None` for null.
    ///
    /// # Safety
    ///
    /// As [`ComPtr::from_raw`], except that the reference stays the caller's.
    pub unsafe fn from_borrowed(ptr: *mut c_void) -> Option<ComPtr<V>> {
        // SAFETY: the caller's contract; the AddRef gives this ComPtr its own reference.
        let p = unsafe { Self::from_raw(ptr) }?;
        // SAFETY: a live interface pointer starts with IUnknown's functions (V: Interface).
        unsafe { (p.unknown().AddRef)(p.as_raw()) };
        Some(p)
    }

    /// The interface pointer, to pass to a method (the reference stays this ComPtr's).
    pub fn as_raw(&self) -> *mut c_void {
        self.ptr.as_ptr().cast()
    }

    /// The vtable.
    pub fn vtbl(&self) -> &V {
        // SAFETY: the object is alive while this ComPtr holds its reference, and its first field
        // points to a vtable with the layout V (the contract of from_raw).
        unsafe { &**self.ptr.as_ptr() }
    }

    fn unknown(&self) -> &IUnknownVtbl {
        // SAFETY: V: Interface starts with an IUnknownVtbl, so the cast reads the same memory.
        unsafe { &*(self.vtbl() as *const V).cast::<IUnknownVtbl>() }
    }

    /// `QueryInterface`: the same object seen through another interface, when it has it.
    ///
    /// # Safety
    ///
    /// `iid` must be the identifier of an interface whose vtable has the layout `U`.
    pub unsafe fn cast<U: Interface>(&self, iid: &GUID) -> Option<ComPtr<U>> {
        let mut out: *mut c_void = std::ptr::null_mut();
        // SAFETY: a live interface pointer; `out` is a valid place for the answer.
        let hr = unsafe { (self.unknown().QueryInterface)(self.as_raw(), iid, &mut out) };
        if failed(hr) {
            return None;
        }
        // SAFETY: QueryInterface succeeded: `out` holds a reference we own to interface `iid`,
        // whose layout is U (the caller's contract).
        unsafe { ComPtr::from_raw(out) }
    }

    /// Gives up the reference without releasing it (to hand it to a caller as an out value).
    pub fn into_raw(self) -> *mut c_void {
        let p = self.as_raw();
        std::mem::forget(self);
        p
    }
}

impl<V: Interface> Clone for ComPtr<V> {
    fn clone(&self) -> Self {
        // SAFETY: a live interface pointer; the AddRef is the new ComPtr's reference.
        unsafe { (self.unknown().AddRef)(self.as_raw()) };
        ComPtr { ptr: self.ptr }
    }
}

impl<V: Interface> Drop for ComPtr<V> {
    fn drop(&mut self) {
        // SAFETY: a live interface pointer; this releases the one reference this ComPtr holds.
        unsafe { (self.unknown().Release)(self.as_raw()) };
    }
}

/// A NUL-terminated UTF-16 copy of `text`, for `LPCWSTR` arguments.
pub fn wide(text: &str) -> Vec<u16> {
    text.encode_utf16().chain(std::iter::once(0)).collect()
}

/// Reads a NUL-terminated UTF-16 string (unpaired surrogates become U+FFFD). `None` for null.
///
/// # Safety
///
/// `p` is null or points to readable UTF-16 code units up to and including a NUL.
pub unsafe fn read_wide(p: *const u16) -> Option<String> {
    if p.is_null() {
        return None;
    }
    let mut len = 0;
    // SAFETY: the caller guarantees a NUL terminator, so every unit up to it is readable.
    while unsafe { *p.add(len) } != 0 {
        len += 1;
    }
    // SAFETY: the `len` units before the NUL are readable (just walked).
    let units = unsafe { std::slice::from_raw_parts(p, len) };
    Some(String::from_utf16_lossy(units))
}

// ------------------------------------------------------------------ our own COM objects

/// The vtable of a completion handler: `Invoke(HRESULT errorCode, Interface* result)`
/// (`ICoreWebView2Create...CompletedHandler`).
#[allow(non_snake_case, missing_docs)]
#[repr(C)]
pub struct CompletedVtbl {
    pub unknown: IUnknownVtbl,
    pub Invoke:
        unsafe extern "system" fn(this: *mut c_void, hr: HRESULT, result: *mut c_void) -> HRESULT,
}
// SAFETY: starts with an IUnknownVtbl.
unsafe impl Interface for CompletedVtbl {}

/// The vtable of an event handler: `Invoke(ICoreWebView2* sender, Args* args)`
/// (`ICoreWebView2...EventHandler`).
#[allow(non_snake_case, missing_docs)]
#[repr(C)]
pub struct EventVtbl {
    pub unknown: IUnknownVtbl,
    pub Invoke: unsafe extern "system" fn(
        this: *mut c_void,
        sender: *mut c_void,
        args: *mut c_void,
    ) -> HRESULT,
}
// SAFETY: starts with an IUnknownVtbl.
unsafe impl Interface for EventVtbl {}

/// What one of our handler objects runs.
enum Call {
    Completed(Box<dyn Fn(HRESULT, *mut c_void) -> HRESULT>),
    Event(Box<dyn Fn(*mut c_void, *mut c_void) -> HRESULT>),
}

/// One of our handler objects. `#[repr(C)]` with the vtable pointer first, as COM requires.
#[repr(C)]
struct Handler {
    vtbl: *const c_void,
    refs: AtomicU32,
    /// The handler interface it implements (besides `IUnknown`).
    iid: GUID,
    call: Call,
}

static COMPLETED_VTBL: CompletedVtbl = CompletedVtbl {
    unknown: IUnknownVtbl {
        QueryInterface: handler_query,
        AddRef: handler_add_ref,
        Release: handler_release,
    },
    Invoke: completed_invoke,
};

static EVENT_VTBL: EventVtbl = EventVtbl {
    unknown: IUnknownVtbl {
        QueryInterface: handler_query,
        AddRef: handler_add_ref,
        Release: handler_release,
    },
    Invoke: event_invoke,
};

unsafe extern "system" fn handler_query(
    this: *mut c_void,
    iid: *const GUID,
    out: *mut *mut c_void,
) -> HRESULT {
    if out.is_null() {
        return E_POINTER;
    }
    // SAFETY: `this` is one of our Handler objects (only our vtables point here) and `iid` is a
    // valid GUID pointer by the COM contract, checked for null first.
    let known = !iid.is_null() && {
        let h = unsafe { &*this.cast::<Handler>() };
        let iid = unsafe { &*iid };
        *iid == IID_IUNKNOWN || *iid == h.iid
    };
    if !known {
        // SAFETY: `out` is a valid place to write (checked non-null; COM contract).
        unsafe { *out = std::ptr::null_mut() };
        return E_NOINTERFACE;
    }
    // SAFETY: as above; the AddRef is the reference handed out through `out`.
    unsafe {
        handler_add_ref(this);
        *out = this;
    }
    S_OK
}

unsafe extern "system" fn handler_add_ref(this: *mut c_void) -> u32 {
    // SAFETY: `this` is a live Handler (the caller holds a reference).
    let h = unsafe { &*this.cast::<Handler>() };
    h.refs.fetch_add(1, Ordering::Relaxed) + 1
}

unsafe extern "system" fn handler_release(this: *mut c_void) -> u32 {
    // SAFETY: `this` is a live Handler (the caller holds the reference it is releasing).
    let left = unsafe { &*this.cast::<Handler>() }
        .refs
        .fetch_sub(1, Ordering::AcqRel)
        - 1;
    if left == 0 {
        // SAFETY: the last reference is gone: nobody can reach the object any more, and it was
        // made by Box::into_raw in `new_handler`.
        drop(unsafe { Box::from_raw(this.cast::<Handler>()) });
    }
    left
}

unsafe extern "system" fn completed_invoke(
    this: *mut c_void,
    hr: HRESULT,
    result: *mut c_void,
) -> HRESULT {
    // SAFETY: `this` is a live Handler made with COMPLETED_VTBL.
    match &unsafe { &*this.cast::<Handler>() }.call {
        Call::Completed(f) => f(hr, result),
        Call::Event(_) => E_FAIL,
    }
}

unsafe extern "system" fn event_invoke(
    this: *mut c_void,
    sender: *mut c_void,
    args: *mut c_void,
) -> HRESULT {
    // SAFETY: `this` is a live Handler made with EVENT_VTBL.
    match &unsafe { &*this.cast::<Handler>() }.call {
        Call::Event(f) => f(sender, args),
        Call::Completed(_) => E_FAIL,
    }
}

fn new_handler<V: Interface>(vtbl: &'static V, iid: GUID, call: Call) -> ComPtr<V> {
    let object = Box::new(Handler {
        vtbl: (vtbl as *const V).cast(),
        refs: AtomicU32::new(1),
        iid,
        call,
    });
    // SAFETY: a fresh object whose first field points to a vtable of layout V, with one
    // reference that the ComPtr takes over.
    unsafe { ComPtr::from_raw(Box::into_raw(object).cast()) }.expect("Box::into_raw is not null")
}

/// A completion handler implementing interface `iid` (`Invoke(HRESULT, Interface*)`). The
/// callback's pointer is lent: keep it with [`ComPtr::from_borrowed`].
pub fn completed(
    iid: GUID,
    f: impl Fn(HRESULT, *mut c_void) -> HRESULT + 'static,
) -> ComPtr<CompletedVtbl> {
    new_handler(&COMPLETED_VTBL, iid, Call::Completed(Box::new(f)))
}

/// An event handler implementing interface `iid` (`Invoke(ICoreWebView2* sender, Args* args)`).
pub fn event(
    iid: GUID,
    f: impl Fn(*mut c_void, *mut c_void) -> HRESULT + 'static,
) -> ComPtr<EventVtbl> {
    new_handler(&EVENT_VTBL, iid, Call::Event(Box::new(f)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;
    use std::rc::Rc;

    #[test]
    fn guids_parse_and_print() {
        let g = GUID::parse("76ECEACB-0462-4d94-ac83-423a6793775e");
        assert_eq!(g.data1, 0x76ec_eacb);
        assert_eq!(g.data2, 0x0462);
        assert_eq!(g.data3, 0x4d94);
        assert_eq!(g.data4, [0xac, 0x83, 0x42, 0x3a, 0x67, 0x93, 0x77, 0x5e]);
        assert_eq!(g.to_text(), "76eceacb-0462-4d94-ac83-423a6793775e");
        assert_eq!(IID_IUNKNOWN.data4, [0xc0, 0, 0, 0, 0, 0, 0, 0x46]);
        assert_eq!(std::mem::size_of::<GUID>(), 16);
        assert_eq!(std::mem::align_of::<GUID>(), 4);
    }

    #[test]
    fn hresults() {
        assert!(failed(E_NOINTERFACE) && failed(E_FAIL) && !failed(S_OK) && !failed(1));
        assert_eq!(hr_text(E_NOINTERFACE), "0x80004002");
        assert_eq!(hr_text(-2147024894), "0x80070002");
    }

    #[test]
    fn wide_strings_round_trip() {
        let w = wide("Repackshot ñ 𝄞");
        assert_eq!(*w.last().unwrap(), 0);
        // SAFETY: a NUL-terminated buffer.
        assert_eq!(
            unsafe { read_wide(w.as_ptr()) }.as_deref(),
            Some("Repackshot ñ 𝄞")
        );
        // SAFETY: null is allowed.
        assert_eq!(unsafe { read_wide(std::ptr::null()) }, None);
        let lone = [0xd800u16, b'a' as u16, 0];
        // SAFETY: a NUL-terminated buffer.
        assert_eq!(
            unsafe { read_wide(lone.as_ptr()) }.as_deref(),
            Some("\u{fffd}a")
        );
    }

    #[test]
    fn vtable_layouts() {
        let slot = std::mem::size_of::<usize>();
        assert_eq!(std::mem::size_of::<IUnknownVtbl>(), 3 * slot);
        assert_eq!(std::mem::size_of::<CompletedVtbl>(), 4 * slot);
        assert_eq!(std::mem::size_of::<EventVtbl>(), 4 * slot);
        assert_eq!(std::mem::offset_of!(EventVtbl, Invoke), 3 * slot);
    }

    struct DropFlag(Rc<Cell<bool>>);
    impl Drop for DropFlag {
        fn drop(&mut self) {
            self.0.set(true);
        }
    }

    const IID_TEST: GUID = GUID::parse("9adbe429-f36d-432b-9ddc-f8881fbd76e3");

    #[test]
    fn handlers_count_references_and_answer_query_interface() {
        let dropped = Rc::new(Cell::new(false));
        let seen = Rc::new(Cell::new((0usize, 0usize)));
        let flag = DropFlag(Rc::clone(&dropped));
        let s = Rc::clone(&seen);
        let h = event(IID_TEST, move |sender, args| {
            let _keep = &flag;
            s.set((sender as usize, args as usize));
            S_OK
        });
        // Invoke through the vtable, as WebView2 does.
        // SAFETY: a live handler made by `event`.
        let hr = unsafe { (h.vtbl().Invoke)(h.as_raw(), 7 as *mut c_void, 9 as *mut c_void) };
        assert_eq!(hr, S_OK);
        assert_eq!(seen.get(), (7, 9));

        // QueryInterface: IUnknown and its own interface, nothing else.
        // SAFETY: the IIDs name interfaces with these layouts.
        let as_unknown = unsafe { h.cast::<IUnknownVtbl>(&IID_IUNKNOWN) }.expect("IUnknown");
        let again = unsafe { h.cast::<EventVtbl>(&IID_TEST) }.expect("its own interface");
        assert_eq!(as_unknown.as_raw(), h.as_raw());
        let other = GUID::parse("4e8a3389-c9d8-4bd2-b6b5-124fee6cc14d");
        // SAFETY: as above (the cast fails).
        assert!(unsafe { h.cast::<IUnknownVtbl>(&other) }.is_none());
        let mut out = std::ptr::dangling_mut::<c_void>();
        // SAFETY: a live handler; `out` is writable.
        let hr = unsafe { (h.vtbl().unknown.QueryInterface)(h.as_raw(), &other, &mut out) };
        assert_eq!((hr, out), (E_NOINTERFACE, std::ptr::null_mut()));
        // SAFETY: a null `out` is refused, not written.
        let hr = unsafe {
            (h.vtbl().unknown.QueryInterface)(h.as_raw(), &IID_TEST, std::ptr::null_mut())
        };
        assert_eq!(hr, E_POINTER);

        // Three references now (h, as_unknown, again): the object lives until the last goes.
        let clone = h.clone();
        drop(h);
        drop(as_unknown);
        drop(again);
        assert!(!dropped.get());
        // SAFETY: a live handler; AddRef/Release in pairs report the count.
        let n = unsafe { (clone.vtbl().unknown.AddRef)(clone.as_raw()) };
        assert_eq!(n, 2);
        let n = unsafe { (clone.vtbl().unknown.Release)(clone.as_raw()) };
        assert_eq!(n, 1);
        drop(clone);
        assert!(
            dropped.get(),
            "the last Release frees the object and its closure"
        );
    }

    #[test]
    fn completion_handlers_receive_the_result_code() {
        let got = Rc::new(Cell::new((0, 0usize)));
        let g = Rc::clone(&got);
        let h = completed(IID_TEST, move |hr, p| {
            g.set((hr, p as usize));
            S_OK
        });
        // SAFETY: a live handler made by `completed`.
        unsafe { (h.vtbl().Invoke)(h.as_raw(), E_FAIL, 42 as *mut c_void) };
        assert_eq!(got.get(), (E_FAIL, 42));
        // A lent pointer kept with from_borrowed adds its own reference.
        // SAFETY: a live handler; its vtable starts with IUnknown.
        let kept = unsafe { ComPtr::<IUnknownVtbl>::from_borrowed(h.as_raw()) }.unwrap();
        let raw = kept.into_raw();
        // SAFETY: `raw` is the reference into_raw gave up; from_raw takes it back.
        drop(unsafe { ComPtr::<IUnknownVtbl>::from_raw(raw) });
        drop(h);
    }
}
