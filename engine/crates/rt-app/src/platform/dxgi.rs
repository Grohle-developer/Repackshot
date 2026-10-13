//! The graphics adapters as DXGI lists them (Windows), the first source of the hardware
//! detection (`hardware.rs`): `CreateDXGIFactory1` → `IDXGIFactory1::EnumAdapters1` →
//! `IDXGIAdapter1::GetDesc1`, which gives each adapter's name, PCI vendor and device, its
//! **dedicated video memory as a 64-bit figure** (exact, unlike the 32-bit ones of WMI) and
//! whether it is a software adapter. It needs no child process and no registry permission, and
//! it lists only the adapters that are there now (never the driver keys a removed card leaves in
//! the registry).
//!
//! **Source**: Microsoft's DXGI reference (learn.microsoft.com/windows/win32/api/dxgi) and the
//! Windows SDK's `dxgi.idl`: the method order of `IDXGIObject`, `IDXGIFactory`, `IDXGIFactory1`,
//! `IDXGIAdapter` and `IDXGIAdapter1`, and `DXGI_ADAPTER_DESC1`. As in `webview2.rs`, every
//! vtable lists all its methods in IDL order (the inherited ones first), the ones never called
//! being a [`Slot`]; the tests check each table's size against the IDL's method count and the
//! position of every method called.
//!
//! `dxgi.dll` is loaded at run time from `System32` only (`LOAD_LIBRARY_SEARCH_SYSTEM32`, so a
//! `dxgi.dll` next to the program or in the current folder is never the one loaded), and is never
//! unloaded. DXGI's factory is free-threaded: no COM initialisation is needed.

#![allow(non_snake_case, missing_docs, clippy::upper_case_acronyms)]

use super::com::{IUnknownVtbl, Interface, Slot, GUID, HRESULT};
use std::ffi::c_void;

/// `IDXGIObject`: 4 methods of its own, 7 slots with `IUnknown`.
#[repr(C)]
pub struct ObjectVtbl {
    pub unknown: IUnknownVtbl,
    pub SetPrivateData: Slot,
    pub SetPrivateDataInterface: Slot,
    pub GetPrivateData: Slot,
    pub GetParent: Slot,
}
// SAFETY: starts with an IUnknownVtbl.
unsafe impl Interface for ObjectVtbl {}

/// `IDXGIFactory1` (`770aae78-f26f-4dba-a829-253c83d1b387`): `IDXGIFactory`'s 5 methods and 2 of
/// its own, 14 slots with `IDXGIObject` and `IUnknown`.
#[repr(C)]
pub struct Factory1Vtbl {
    pub object: ObjectVtbl,
    // IDXGIFactory
    pub EnumAdapters: Slot,
    pub MakeWindowAssociation: Slot,
    pub GetWindowAssociation: Slot,
    pub CreateSwapChain: Slot,
    pub CreateSoftwareAdapter: Slot,
    // IDXGIFactory1
    pub EnumAdapters1: unsafe extern "system" fn(
        this: *mut c_void,
        index: u32,
        adapter: *mut *mut c_void,
    ) -> HRESULT,
    pub IsCurrent: Slot,
}
// SAFETY: starts with an ObjectVtbl, which starts with an IUnknownVtbl.
unsafe impl Interface for Factory1Vtbl {}
/// `IDXGIFactory1`.
pub const IID_FACTORY1: GUID = GUID::parse("770aae78-f26f-4dba-a829-253c83d1b387");
/// Slots of `IDXGIFactory1` counted from the IDL, `IUnknown` included.
pub const FACTORY1_SLOTS: usize = 14;

/// `IDXGIAdapter1` (`29038f61-3839-4626-91fd-086879011a05`): `IDXGIAdapter`'s 3 methods and 1 of
/// its own, 11 slots with `IDXGIObject` and `IUnknown`.
#[repr(C)]
pub struct Adapter1Vtbl {
    pub object: ObjectVtbl,
    // IDXGIAdapter
    pub EnumOutputs: Slot,
    pub GetDesc: Slot,
    pub CheckInterfaceSupport: Slot,
    // IDXGIAdapter1
    pub GetDesc1: unsafe extern "system" fn(this: *mut c_void, desc: *mut ADAPTER_DESC1) -> HRESULT,
}
// SAFETY: starts with an ObjectVtbl, which starts with an IUnknownVtbl.
unsafe impl Interface for Adapter1Vtbl {}
/// `IDXGIAdapter1`.
pub const IID_ADAPTER1: GUID = GUID::parse("29038f61-3839-4626-91fd-086879011a05");
/// Slots of `IDXGIAdapter1` counted from the IDL, `IUnknown` included.
pub const ADAPTER1_SLOTS: usize = 11;

/// A locally unique identifier (`winnt.h`).
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct LUID {
    pub LowPart: u32,
    pub HighPart: i32,
}

/// `DXGI_ADAPTER_DESC1`.
#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ADAPTER_DESC1 {
    /// The adapter's name, UTF-16, NUL-terminated within the 128 units.
    pub Description: [u16; 128],
    pub VendorId: u32,
    pub DeviceId: u32,
    pub SubSysId: u32,
    pub Revision: u32,
    /// `SIZE_T`: video memory not shared with the processor.
    pub DedicatedVideoMemory: usize,
    pub DedicatedSystemMemory: usize,
    pub SharedSystemMemory: usize,
    pub AdapterLuid: LUID,
    /// `DXGI_ADAPTER_FLAG`.
    pub Flags: u32,
}

impl ADAPTER_DESC1 {
    /// All zeros, to be filled by `GetDesc1`.
    pub const fn zeroed() -> ADAPTER_DESC1 {
        ADAPTER_DESC1 {
            Description: [0; 128],
            VendorId: 0,
            DeviceId: 0,
            SubSysId: 0,
            Revision: 0,
            DedicatedVideoMemory: 0,
            DedicatedSystemMemory: 0,
            SharedSystemMemory: 0,
            AdapterLuid: LUID {
                LowPart: 0,
                HighPart: 0,
            },
            Flags: 0,
        }
    }
}

/// `DXGI_ADAPTER_FLAG_SOFTWARE`: a software adapter (the Microsoft Basic Render Driver).
pub const ADAPTER_FLAG_SOFTWARE: u32 = 2;
/// `DXGI_ERROR_NOT_FOUND`: `EnumAdapters1` past the last adapter.
pub const ERROR_NOT_FOUND: HRESULT = 0x887A_0002_u32 as i32;
/// Microsoft's PCI vendor id: its basic render and display drivers, its remote and virtual
/// display adapters; never a graphics card that can run a model.
pub const VENDOR_MICROSOFT: u32 = 0x1414;

/// An adapter as DXGI describes it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Adapter {
    /// Its name (`Description`).
    pub name: String,
    /// PCI vendor id (`0x10DE` NVIDIA, `0x1002` AMD, `0x8086` Intel...).
    pub vendor_id: u32,
    /// PCI device id.
    pub device_id: u32,
    /// Dedicated video memory, bytes (exact).
    pub dedicated_video_memory: u64,
    /// `DXGI_ADAPTER_FLAG` bits.
    pub flags: u32,
}

impl Adapter {
    /// What `GetDesc1` filled in.
    pub fn from_desc(desc: &ADAPTER_DESC1) -> Adapter {
        let len = desc
            .Description
            .iter()
            .position(|&u| u == 0)
            .unwrap_or(desc.Description.len());
        Adapter {
            name: String::from_utf16_lossy(&desc.Description[..len])
                .trim()
                .to_string(),
            vendor_id: desc.VendorId,
            device_id: desc.DeviceId,
            dedicated_video_memory: desc.DedicatedVideoMemory as u64,
            flags: desc.Flags,
        }
    }

    /// Why this adapter is not a graphics card, when it is not: a software adapter or one of
    /// Microsoft's (basic render or display driver, remote or virtual display).
    pub fn not_a_card(&self) -> Option<&'static str> {
        if self.flags & ADAPTER_FLAG_SOFTWARE != 0 {
            Some("software")
        } else if self.vendor_id == VENDOR_MICROSOFT {
            Some("Microsoft's")
        } else {
            None
        }
    }
}

/// Every adapter DXGI lists, software ones included (the caller decides and logs why it skips
/// them), or why DXGI could not be asked. Elsewhere than on Windows, always `Err`.
pub fn adapters() -> Result<Vec<Adapter>, String> {
    #[cfg(windows)]
    {
        windows::adapters()
    }
    #[cfg(not(windows))]
    {
        Err("DXGI is a Windows interface".into())
    }
}

#[cfg(windows)]
mod windows {
    use super::super::com::{failed, hr_text, wide, ComPtr, GUID, HRESULT};
    use super::super::win32::{
        GetLastError, GetProcAddress, LoadLibraryExW, LOAD_LIBRARY_SEARCH_SYSTEM32,
    };
    use super::{
        Adapter, Adapter1Vtbl, Factory1Vtbl, ADAPTER_DESC1, ERROR_NOT_FOUND, IID_FACTORY1,
    };
    use std::ffi::c_void;
    use std::sync::OnceLock;

    /// More adapters than any computer has: the enumeration stops there whatever DXGI says.
    const MAX_ADAPTERS: u32 = 64;

    /// `HRESULT WINAPI CreateDXGIFactory1(REFIID riid, void **ppFactory)` (`dxgi.h`).
    type CreateFactory1Fn =
        unsafe extern "system" fn(iid: *const GUID, factory: *mut *mut c_void) -> HRESULT;

    /// `CreateDXGIFactory1` of System32's `dxgi.dll`, loaded once and kept.
    fn create_factory1() -> Result<CreateFactory1Fn, String> {
        static FOUND: OnceLock<Result<CreateFactory1Fn, String>> = OnceLock::new();
        FOUND
            .get_or_init(|| {
                let name = wide("dxgi.dll");
                // SAFETY: a NUL-terminated UTF-16 name; LOAD_LIBRARY_SEARCH_SYSTEM32 loads it from
                // System32 only (Windows 8 and later, and Windows 7 with KB2533623).
                let module = unsafe {
                    LoadLibraryExW(
                        name.as_ptr(),
                        std::ptr::null_mut(),
                        LOAD_LIBRARY_SEARCH_SYSTEM32,
                    )
                };
                if module.is_null() {
                    // SAFETY: no arguments.
                    let e = unsafe { GetLastError() };
                    return Err(format!("cannot load dxgi.dll (error {e})"));
                }
                // SAFETY: a loaded module and a NUL-terminated ASCII name.
                let f = unsafe { GetProcAddress(module, c"CreateDXGIFactory1".as_ptr()) };
                if f.is_null() {
                    return Err("dxgi.dll has no CreateDXGIFactory1".into());
                }
                // SAFETY: the export has this signature (dxgi.h: HRESULT WINAPI
                // CreateDXGIFactory1(REFIID, void**), WINAPI being stdcall, the `system`
                // convention). The module is never unloaded, so the pointer stays valid.
                Ok(unsafe { std::mem::transmute::<*mut c_void, CreateFactory1Fn>(f) })
            })
            .clone()
    }

    pub(super) fn adapters() -> Result<Vec<Adapter>, String> {
        let create = create_factory1()?;
        let mut raw: *mut c_void = std::ptr::null_mut();
        // SAFETY: the IID of the interface asked for and a valid out parameter.
        let hr = unsafe { create(&IID_FACTORY1, &mut raw) };
        if failed(hr) {
            return Err(format!("CreateDXGIFactory1 failed ({})", hr_text(hr)));
        }
        // SAFETY: on success `raw` holds a reference we own to an IDXGIFactory1, whose vtable is
        // Factory1Vtbl.
        let factory = unsafe { ComPtr::<Factory1Vtbl>::from_raw(raw) }
            .ok_or("CreateDXGIFactory1 gave no factory")?;
        let mut list = Vec::new();
        for index in 0..MAX_ADAPTERS {
            let mut raw: *mut c_void = std::ptr::null_mut();
            // SAFETY: a live factory; `raw` is a valid out parameter.
            let hr = unsafe { (factory.vtbl().EnumAdapters1)(factory.as_raw(), index, &mut raw) };
            if hr == ERROR_NOT_FOUND {
                break;
            }
            if failed(hr) {
                if list.is_empty() {
                    return Err(format!("EnumAdapters1({index}) failed ({})", hr_text(hr)));
                }
                break;
            }
            // SAFETY: on success `raw` holds a reference we own to an IDXGIAdapter1, whose
            // vtable is Adapter1Vtbl.
            let Some(adapter) = (unsafe { ComPtr::<Adapter1Vtbl>::from_raw(raw) }) else {
                break;
            };
            let mut desc = ADAPTER_DESC1::zeroed();
            // SAFETY: a live adapter; `desc` is a writable DXGI_ADAPTER_DESC1.
            let hr = unsafe { (adapter.vtbl().GetDesc1)(adapter.as_raw(), &mut desc) };
            if !failed(hr) {
                list.push(Adapter::from_desc(&desc));
            }
        }
        Ok(list)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::mem::{offset_of, size_of};

    const SLOT: usize = size_of::<usize>();

    #[test]
    fn vtable_sizes_match_the_idl() {
        assert_eq!(size_of::<ObjectVtbl>(), 7 * SLOT);
        assert_eq!(size_of::<Factory1Vtbl>(), FACTORY1_SLOTS * SLOT);
        assert_eq!(size_of::<Adapter1Vtbl>(), ADAPTER1_SLOTS * SLOT);
        assert_eq!((FACTORY1_SLOTS, ADAPTER1_SLOTS), (14, 11));
    }

    #[test]
    fn the_methods_called_are_in_their_place() {
        // IUnknown 3 + IDXGIObject 4 + IDXGIFactory 5: EnumAdapters1 is the 13th function.
        assert_eq!(offset_of!(Factory1Vtbl, EnumAdapters1), 12 * SLOT);
        // IUnknown 3 + IDXGIObject 4 + IDXGIAdapter 3: GetDesc1 is the 11th.
        assert_eq!(offset_of!(Adapter1Vtbl, GetDesc1), 10 * SLOT);
        assert_eq!(
            IID_FACTORY1.to_text(),
            "770aae78-f26f-4dba-a829-253c83d1b387"
        );
        assert_eq!(
            IID_ADAPTER1.to_text(),
            "29038f61-3839-4626-91fd-086879011a05"
        );
    }

    #[test]
    fn the_description_is_laid_out_as_windows_lays_it_out() {
        // 128 UTF-16 units, four 32-bit ids, three SIZE_T, a LUID and the flags.
        assert_eq!(offset_of!(ADAPTER_DESC1, VendorId), 256);
        assert_eq!(offset_of!(ADAPTER_DESC1, Revision), 268);
        assert_eq!(offset_of!(ADAPTER_DESC1, DedicatedVideoMemory), 272);
        if SLOT == 8 {
            assert_eq!(offset_of!(ADAPTER_DESC1, AdapterLuid), 296);
            assert_eq!(offset_of!(ADAPTER_DESC1, Flags), 304);
            assert_eq!(size_of::<ADAPTER_DESC1>(), 312);
        } else {
            assert_eq!(offset_of!(ADAPTER_DESC1, AdapterLuid), 284);
            assert_eq!(offset_of!(ADAPTER_DESC1, Flags), 292);
            assert_eq!(size_of::<ADAPTER_DESC1>(), 296);
        }
        assert_eq!(size_of::<LUID>(), 8);
    }

    fn desc(name: &str, vendor: u32, vram: usize, flags: u32) -> ADAPTER_DESC1 {
        let mut d = ADAPTER_DESC1::zeroed();
        for (slot, unit) in d.Description.iter_mut().zip(name.encode_utf16()) {
            *slot = unit;
        }
        d.VendorId = vendor;
        d.DeviceId = 0x2520;
        d.DedicatedVideoMemory = vram;
        d.Flags = flags;
        d
    }

    #[test]
    fn reads_what_get_desc1_fills_in() {
        let a = Adapter::from_desc(&desc(
            "NVIDIA GeForce RTX 3060 Laptop GPU",
            0x10DE,
            6 << 30,
            0,
        ));
        assert_eq!(a.name, "NVIDIA GeForce RTX 3060 Laptop GPU");
        assert_eq!((a.vendor_id, a.device_id), (0x10DE, 0x2520));
        assert_eq!(a.dedicated_video_memory, 6 << 30);
        assert_eq!(a.not_a_card(), None);
        let basic = Adapter::from_desc(&desc(
            "Microsoft Basic Render Driver",
            VENDOR_MICROSOFT,
            0,
            ADAPTER_FLAG_SOFTWARE,
        ));
        assert_eq!(basic.not_a_card(), Some("software"));
        let remote = Adapter::from_desc(&desc("Microsoft Remote Display Adapter", 0x1414, 0, 0));
        assert_eq!(remote.not_a_card(), Some("Microsoft's"));
        // A name that fills all 128 units has no NUL: it is read to the end, not past it.
        let long = "x".repeat(130);
        assert_eq!(
            Adapter::from_desc(&desc(&long, 0x8086, 0, 0)).name.len(),
            128
        );
        assert_eq!(
            Adapter::from_desc(&desc("Señal ", 0x1002, 0, 0)).name,
            "Señal"
        );
    }

    /// DXGI itself: on Windows (and under Wine) the enumeration answers, listing adapters with a
    /// name, or says cleanly why not; elsewhere it says it is Windows only.
    #[test]
    fn asks_dxgi() {
        match adapters() {
            Ok(list) if !cfg!(windows) => {
                panic!("DXGI answered elsewhere than on Windows: {list:?}")
            }
            Ok(list) => {
                for a in &list {
                    assert!(!a.name.is_empty(), "{a:?}");
                }
                eprintln!("DXGI adapters: {list:?}");
            }
            Err(e) => {
                assert!(!e.is_empty());
                if !cfg!(windows) {
                    assert_eq!(e, "DXGI is a Windows interface");
                }
                eprintln!("DXGI: {e}");
            }
        }
        // Asking again gives the same answer (the library is loaded once and kept).
        assert_eq!(adapters().is_ok(), adapters().is_ok());
    }
}
