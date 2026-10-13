//! `repackshot --shortcut-id <file.lnk>`: writes our AppUserModelID (`Repackshot.App`, the one the
//! native window gives its process) into a shortcut's `System.AppUserModel.ID` property, so a
//! pinned shortcut and the running window are one taskbar button with our icon (Microsoft,
//! *Application User Model IDs*: "an application must set the same AppUserModelID on its
//! shortcut as on its process"). The installer runs it after each `CreateShortCut` (Start menu,
//! desktop); NSIS has no way to set it without a plug-in.
//!
//! COM: a `ShellLink` object (`CoCreateInstance(CLSID_ShellLink)` as `IShellLinkW`), loaded from
//! the file with `IPersistFile::Load`, its target checked to be `repackshot.exe` (this command
//! changes our shortcuts only), the property set with `IPropertyStore::SetValue` and `Commit`,
//! and the file written back with `IPersistFile::Save`. Layouts from the Windows SDK headers
//! (`shobjidl_core.h`, `objidl.h`, `propsys.h`, `propkeydef.h`), checked by the tests; plain
//! types, so the checks run on every system.

#![allow(non_snake_case, missing_docs)]

use super::com::{IUnknownVtbl, Interface, Slot, GUID, HRESULT};
use std::ffi::c_void;
use std::path::Path;

/// `CLSID_ShellLink`.
pub const CLSID_SHELL_LINK: GUID = GUID::parse("00021401-0000-0000-c000-000000000046");
/// `IShellLinkW`.
pub const IID_SHELL_LINK_W: GUID = GUID::parse("000214f9-0000-0000-c000-000000000046");
/// `IPersistFile`.
pub const IID_PERSIST_FILE: GUID = GUID::parse("0000010b-0000-0000-c000-000000000046");
/// `IPropertyStore`.
pub const IID_PROPERTY_STORE: GUID = GUID::parse("886d8eeb-8cf2-4446-8d02-cdba1dbdcf99");

/// `PROPERTYKEY`.
#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PROPERTYKEY {
    pub fmtid: GUID,
    pub pid: u32,
}

/// `PKEY_AppUserModel_ID` (`propkey.h`): `{9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3}, 5`.
pub const PKEY_APP_USER_MODEL_ID: PROPERTYKEY = PROPERTYKEY {
    fmtid: GUID::parse("9f4c2855-9f79-4b39-a8d0-e1d42de1d5f3"),
    pid: 5,
};

/// `VT_LPWSTR`.
pub const VT_LPWSTR: u16 = 31;

/// `PROPVARIANT`: the type, three reserved words, then the value (here a `LPWSTR` in `data[0]`);
/// 16 bytes on 32-bit Windows, 24 on 64-bit, as the SDK's union of pointers and `BLOB`s.
#[repr(C)]
#[derive(Clone, Copy, Debug)]
pub struct PROPVARIANT {
    pub vt: u16,
    pub reserved: [u16; 3],
    pub data: [usize; 2],
}

/// `IShellLinkW`: 18 methods of its own, in `shobjidl_core.h` order.
#[repr(C)]
pub struct ShellLinkWVtbl {
    pub unknown: IUnknownVtbl,
    pub GetPath: unsafe extern "system" fn(
        this: *mut c_void,
        file: *mut u16,
        cch: i32,
        find_data: *mut c_void,
        flags: u32,
    ) -> HRESULT,
    pub GetIDList: Slot,
    pub SetIDList: Slot,
    pub GetDescription: Slot,
    pub SetDescription: Slot,
    pub GetWorkingDirectory: Slot,
    pub SetWorkingDirectory: Slot,
    pub GetArguments: Slot,
    pub SetArguments: Slot,
    pub GetHotkey: Slot,
    pub SetHotkey: Slot,
    pub GetShowCmd: Slot,
    pub SetShowCmd: Slot,
    pub GetIconLocation: Slot,
    pub SetIconLocation: Slot,
    pub SetRelativePath: Slot,
    pub Resolve: Slot,
    pub SetPath: unsafe extern "system" fn(this: *mut c_void, file: *const u16) -> HRESULT,
}

/// `IPersistFile` (after `IPersist::GetClassID`): 5 methods of its own.
#[repr(C)]
pub struct PersistFileVtbl {
    pub unknown: IUnknownVtbl,
    pub GetClassID: Slot,
    pub IsDirty: Slot,
    pub Load: unsafe extern "system" fn(this: *mut c_void, file: *const u16, mode: u32) -> HRESULT,
    pub Save:
        unsafe extern "system" fn(this: *mut c_void, file: *const u16, remember: i32) -> HRESULT,
    pub SaveCompleted: Slot,
    pub GetCurFile: Slot,
}

/// `IPropertyStore`: 5 methods of its own.
#[repr(C)]
pub struct PropertyStoreVtbl {
    pub unknown: IUnknownVtbl,
    pub GetCount: Slot,
    pub GetAt: Slot,
    pub GetValue: unsafe extern "system" fn(
        this: *mut c_void,
        key: *const PROPERTYKEY,
        value: *mut PROPVARIANT,
    ) -> HRESULT,
    pub SetValue: unsafe extern "system" fn(
        this: *mut c_void,
        key: *const PROPERTYKEY,
        value: *const PROPVARIANT,
    ) -> HRESULT,
    pub Commit: unsafe extern "system" fn(this: *mut c_void) -> HRESULT,
}

// SAFETY: each starts with IUnknownVtbl.
unsafe impl Interface for ShellLinkWVtbl {}
unsafe impl Interface for PersistFileVtbl {}
unsafe impl Interface for PropertyStoreVtbl {}

/// The shortcut the command may change: an existing `.lnk` file.
pub fn check_link(path: &Path) -> Result<(), String> {
    let is_lnk = path
        .extension()
        .is_some_and(|e| e.eq_ignore_ascii_case("lnk"));
    if !is_lnk {
        return Err(format!("{}: not a shortcut (.lnk)", path.display()));
    }
    if !path.is_file() {
        return Err(format!("{}: no such shortcut", path.display()));
    }
    Ok(())
}

/// Whether a shortcut's target is this application (`…\repackshot.exe`, any case).
pub fn is_our_target(target: &str) -> bool {
    target
        .rsplit(['\\', '/'])
        .next()
        .is_some_and(|name| name.eq_ignore_ascii_case("repackshot.exe"))
}

/// Writes [`super::APP_USER_MODEL_ID`] into the shortcut at `path`.
pub fn set_app_user_model_id(path: &Path) -> Result<(), String> {
    check_link(path)?;
    #[cfg(windows)]
    {
        windows::set_id(path, super::APP_USER_MODEL_ID)
    }
    #[cfg(not(windows))]
    {
        Err("--shortcut-id works on Windows only".into())
    }
}

#[cfg(windows)]
mod windows {
    use super::*;
    use crate::platform::com::{failed, hr_text, wide, ComPtr, E_NOTIMPL};
    use crate::platform::win32::{
        wide_path, CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize,
        COINIT_APARTMENTTHREADED, S_FALSE,
    };

    /// `CLSCTX_INPROC_SERVER`.
    const CLSCTX_INPROC_SERVER: u32 = 0x1;
    /// `STGM_READWRITE`.
    const STGM_READWRITE: u32 = 0x2;

    fn check(what: &str, hr: HRESULT) -> Result<(), String> {
        if failed(hr) {
            Err(format!("{what}: {}", hr_text(hr)))
        } else {
            Ok(())
        }
    }

    /// The shell link object for `path`, loaded. COM must be initialised on this thread.
    pub(super) fn load(path: &Path) -> Result<ComPtr<ShellLinkWVtbl>, String> {
        let mut raw: *mut c_void = std::ptr::null_mut();
        // SAFETY: documented class and interface identifiers; `raw` receives an IShellLinkW
        // reference we own.
        let hr = unsafe {
            CoCreateInstance(
                &CLSID_SHELL_LINK,
                std::ptr::null_mut(),
                CLSCTX_INPROC_SERVER,
                &IID_SHELL_LINK_W,
                &mut raw,
            )
        };
        check("CoCreateInstance(ShellLink)", hr)?;
        // SAFETY: on success `raw` is an IShellLinkW we own.
        let link = unsafe { ComPtr::<ShellLinkWVtbl>::from_raw(raw) }.ok_or("no shell link")?;
        // SAFETY: IID_PERSIST_FILE names IPersistFile, whose layout is PersistFileVtbl.
        let file = unsafe { link.cast::<PersistFileVtbl>(&IID_PERSIST_FILE) }
            .ok_or("the shell link has no IPersistFile")?;
        let name = wide_path(path);
        // SAFETY: a live IPersistFile; a NUL-terminated path.
        check("IPersistFile::Load", unsafe {
            (file.vtbl().Load)(file.as_raw(), name.as_ptr(), STGM_READWRITE)
        })?;
        Ok(link)
    }

    /// The shortcut's target.
    pub(super) fn target(link: &ComPtr<ShellLinkWVtbl>) -> Result<String, String> {
        let mut buf = vec![0u16; 1024];
        // SAFETY: a live IShellLinkW; a buffer of the length given; no WIN32_FIND_DATA wanted.
        check("IShellLinkW::GetPath", unsafe {
            (link.vtbl().GetPath)(
                link.as_raw(),
                buf.as_mut_ptr(),
                buf.len() as i32,
                std::ptr::null_mut(),
                0,
            )
        })?;
        let len = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
        Ok(String::from_utf16_lossy(&buf[..len]))
    }

    /// The `System.AppUserModel.ID` of a loaded shortcut, if it has one.
    pub(super) fn read_id(link: &ComPtr<ShellLinkWVtbl>) -> Result<Option<String>, String> {
        // SAFETY: IID_PROPERTY_STORE names IPropertyStore, whose layout is PropertyStoreVtbl.
        let store = unsafe { link.cast::<PropertyStoreVtbl>(&IID_PROPERTY_STORE) }
            .ok_or("the shell link has no IPropertyStore")?;
        let mut v = PROPVARIANT {
            vt: 0,
            reserved: [0; 3],
            data: [0; 2],
        };
        // SAFETY: a live store; a documented key; `v` receives a PROPVARIANT we own.
        check("IPropertyStore::GetValue", unsafe {
            (store.vtbl().GetValue)(store.as_raw(), &PKEY_APP_USER_MODEL_ID, &mut v)
        })?;
        if v.vt != VT_LPWSTR || v.data[0] == 0 {
            return Ok(None);
        }
        let p = v.data[0] as *mut u16;
        // SAFETY: a VT_LPWSTR PROPVARIANT holds a NUL-terminated string allocated with
        // CoTaskMemAlloc, which we own and free (what PropVariantClear does for this type).
        let s = unsafe { crate::platform::com::read_wide(p) };
        unsafe { CoTaskMemFree(p.cast()) };
        Ok(s)
    }

    pub(super) fn write_id(link: &ComPtr<ShellLinkWVtbl>, id: &str) -> Result<(), String> {
        // SAFETY: IID_PROPERTY_STORE names IPropertyStore, whose layout is PropertyStoreVtbl.
        let store = unsafe { link.cast::<PropertyStoreVtbl>(&IID_PROPERTY_STORE) }
            .ok_or("the shell link has no IPropertyStore")?;
        let text = wide(id);
        let v = PROPVARIANT {
            vt: VT_LPWSTR,
            reserved: [0; 3],
            data: [text.as_ptr() as usize, 0],
        };
        // SAFETY: a live store; SetValue copies the value, so `text` only has to outlive the
        // call; Commit writes it into the link object.
        unsafe {
            check(
                "IPropertyStore::SetValue",
                (store.vtbl().SetValue)(store.as_raw(), &PKEY_APP_USER_MODEL_ID, &v),
            )?;
            check(
                "IPropertyStore::Commit",
                (store.vtbl().Commit)(store.as_raw()),
            )?;
        }
        // SAFETY: as in `load`.
        let file = unsafe { link.cast::<PersistFileVtbl>(&IID_PERSIST_FILE) }
            .ok_or("the shell link has no IPersistFile")?;
        // SAFETY: a live IPersistFile; null saves to the file it was loaded from.
        check("IPersistFile::Save", unsafe {
            (file.vtbl().Save)(file.as_raw(), std::ptr::null(), 1)
        })
    }

    /// COM for one call on this thread.
    pub(super) fn with_com<T>(f: impl FnOnce() -> Result<T, String>) -> Result<T, String> {
        // SAFETY: initialises COM for this thread; balanced below whenever it succeeded.
        let hr = unsafe { CoInitializeEx(std::ptr::null_mut(), COINIT_APARTMENTTHREADED) };
        let ours = hr == 0 || hr == S_FALSE;
        let r = f();
        if ours {
            // SAFETY: balances the successful CoInitializeEx above; every COM object of `f`
            // is released by then.
            unsafe { CoUninitialize() };
        }
        r
    }

    pub(super) fn set_id(path: &Path, id: &str) -> Result<(), String> {
        with_com(|| {
            let link = load(path)?;
            let target = target(&link)?;
            if !is_our_target(&target) {
                return Err(format!(
                    "{}: points to {target}, not to repackshot.exe",
                    path.display()
                ));
            }
            write_id(&link, id)?;
            // Read back from the file, so a shell that took the value without keeping it fails.
            match read_id(&load(path)?) {
                Ok(Some(kept)) if kept == id => Ok(()),
                // A shell that cannot read properties back (Wine's stub): written, not checked.
                Err(e) if e.ends_with(&hr_text(E_NOTIMPL)) => {
                    eprintln!(
                        "repackshot: {}: written; this system cannot read it back ({e})",
                        path.display()
                    );
                    Ok(())
                }
                Err(e) => Err(e),
                Ok(other) => Err(format!(
                    "{}: the shortcut did not keep the id ({other:?})",
                    path.display()
                )),
            }
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::mem::{offset_of, size_of};

    const SLOT: usize = size_of::<usize>();

    #[test]
    fn layouts_match_the_sdk() {
        assert_eq!(size_of::<ShellLinkWVtbl>(), 21 * SLOT);
        assert_eq!(offset_of!(ShellLinkWVtbl, GetPath) / SLOT, 3);
        assert_eq!(offset_of!(ShellLinkWVtbl, SetPath) / SLOT, 20);
        assert_eq!(size_of::<PersistFileVtbl>(), 9 * SLOT);
        assert_eq!(offset_of!(PersistFileVtbl, Load) / SLOT, 5);
        assert_eq!(offset_of!(PersistFileVtbl, Save) / SLOT, 6);
        assert_eq!(size_of::<PropertyStoreVtbl>(), 8 * SLOT);
        assert_eq!(offset_of!(PropertyStoreVtbl, SetValue) / SLOT, 6);
        assert_eq!(offset_of!(PropertyStoreVtbl, Commit) / SLOT, 7);
        assert_eq!(size_of::<PROPERTYKEY>(), 20);
        assert_eq!(size_of::<PROPVARIANT>(), if SLOT == 8 { 24 } else { 16 });
        assert_eq!(offset_of!(PROPVARIANT, data), 8);
        assert_eq!(
            PKEY_APP_USER_MODEL_ID.fmtid.to_text(),
            "9f4c2855-9f79-4b39-a8d0-e1d42de1d5f3"
        );
        assert_eq!(
            IID_PROPERTY_STORE.to_text(),
            "886d8eeb-8cf2-4446-8d02-cdba1dbdcf99"
        );
    }

    #[test]
    fn only_our_shortcuts() {
        let dir = crate::test_dir("shortcut");
        assert!(check_link(&dir.join("x.lnk"))
            .unwrap_err()
            .contains("no such"));
        std::fs::write(dir.join("notes.txt"), "").unwrap();
        assert!(check_link(&dir.join("notes.txt"))
            .unwrap_err()
            .contains("not a shortcut"));
        std::fs::write(dir.join("Repackshot.LNK"), "").unwrap();
        assert!(check_link(&dir.join("Repackshot.LNK")).is_ok());
        assert!(is_our_target(
            r"C:\Users\a\AppData\Local\Programs\Repackshot\repackshot.exe"
        ));
        assert!(is_our_target(r"D:\Tools\REPACKSHOT.EXE"));
        assert!(!is_our_target(r"C:\Windows\notepad.exe"));
        assert!(!is_our_target(r"C:\x\repackshot.exe.bak"));
        assert!(!is_our_target(""));
        if !cfg!(windows) {
            assert!(set_app_user_model_id(&dir.join("Repackshot.LNK"))
                .unwrap_err()
                .contains("Windows only"));
        }
    }

    /// The whole command against a real shortcut (Windows, or Wine where its shell implements
    /// a shell link's property store).
    #[cfg(windows)]
    #[test]
    fn writes_the_id_into_a_shortcut_to_us_and_refuses_others() {
        use crate::platform::com::{failed, wide};
        let dir = crate::test_dir("shortcut-real");
        let make = |name: &str, target: &str| {
            let lnk = dir.join(name);
            windows::with_com(|| {
                let mut raw: *mut c_void = std::ptr::null_mut();
                // SAFETY: as in `load`, for a new, empty shell link.
                let hr = unsafe {
                    crate::platform::win32::CoCreateInstance(
                        &CLSID_SHELL_LINK,
                        std::ptr::null_mut(),
                        1,
                        &IID_SHELL_LINK_W,
                        &mut raw,
                    )
                };
                assert!(!failed(hr), "CoCreateInstance {hr:x}");
                // SAFETY: an IShellLinkW we own.
                let link = unsafe { crate::platform::com::ComPtr::<ShellLinkWVtbl>::from_raw(raw) }
                    .unwrap();
                let t = wide(target);
                // SAFETY: live objects; NUL-terminated strings; Save writes a new file.
                unsafe {
                    assert!(!failed((link.vtbl().SetPath)(link.as_raw(), t.as_ptr())));
                    let file = link.cast::<PersistFileVtbl>(&IID_PERSIST_FILE).unwrap();
                    let path = crate::platform::win32::wide_path(&lnk);
                    assert!(!failed((file.vtbl().Save)(file.as_raw(), path.as_ptr(), 1)));
                }
                Ok(())
            })
            .unwrap();
            lnk
        };
        let ours = make(
            "Repackshot.lnk",
            r"C:\Program Files\Repackshot\repackshot.exe",
        );
        let other = make("Notepad.lnk", r"C:\Windows\notepad.exe");
        assert!(set_app_user_model_id(&other)
            .unwrap_err()
            .contains("not to repackshot.exe"));
        set_app_user_model_id(&ours).expect("the id is written");
        match windows::with_com(|| windows::read_id(&windows::load(&ours)?)) {
            Ok(read) => assert_eq!(read.as_deref(), Some(super::super::APP_USER_MODEL_ID)),
            // Wine's shell link stores properties but cannot read them back (E_NOTIMPL): the
            // read-back is checked on Windows.
            Err(e) => assert!(e.ends_with("0x80004001"), "{e}"),
        }
    }
}
