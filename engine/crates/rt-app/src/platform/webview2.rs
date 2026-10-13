//! The WebView2 interfaces the native window uses, written by hand: vtable layouts, interface
//! identifiers and the few enumerations, as `#[repr(C)]` types. Types only: nothing here calls
//! anything, so the layouts are checked by the tests on every platform.
//!
//! **Source**: `WebView2.idl` of the NuGet package `Microsoft.Web.WebView2` 1.0.4258.31
//! (Microsoft's WebView2 SDK, BSD-style licence, <https://aka.ms/webview2>), cross-checked with
//! the C vtables of its `WebView2.h`. Every interface is listed with all its methods in IDL
//! order, the inherited ones first (a derived interface's vtable starts with its base's, the
//! field `base`), because a method is found by its position. The methods this program calls
//! have their signature; the others are a [`Slot`] that only keeps its place. Each field is
//! named exactly as in the IDL (`get_`/`put_` for properties), so a reader can audit it line
//! by line against Microsoft's reference (learn.microsoft.com/microsoft-edge/webview2/reference/win32).
//! The tests check every table's size against the method count of the IDL.
//!
//! COM rules that apply to all of them: `this` first, `system` calling convention, `BOOL` is a
//! 32-bit integer, strings are UTF-16 (`LPCWSTR` in, `LPWSTR*` out, the latter allocated with
//! `CoTaskMemAlloc` and freed by the caller with `CoTaskMemFree`), interface pointers returned
//! in out parameters carry a reference the caller releases, and structs such as `RECT` are
//! passed by value as C passes them.

#![allow(non_snake_case, missing_docs)]

use super::com::{IUnknownVtbl, Interface, Slot, GUID, HRESULT};
use std::ffi::c_void;

/// A window handle.
pub type HWND = *mut c_void;
/// A Win32 `BOOL`.
pub type BOOL = i32;

/// A Win32 `RECT`.
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct RECT {
    pub left: i32,
    pub top: i32,
    pub right: i32,
    pub bottom: i32,
}

/// `COREWEBVIEW2_COLOR`: alpha first.
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct COLOR {
    pub a: u8,
    pub r: u8,
    pub g: u8,
    pub b: u8,
}

/// `EventRegistrationToken` (`eventtoken.h`).
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct EventRegistrationToken {
    pub value: i64,
}

/// `ICoreWebView2Environment` (`b96d755e-0319-4e92-a296-23436f46a1fc`): 5 methods of its own, 8 slots with `IUnknown`.
#[repr(C)]
pub struct EnvironmentVtbl {
    pub unknown: IUnknownVtbl,
    pub CreateCoreWebView2Controller:
        unsafe extern "system" fn(this: *mut c_void, parent: HWND, handler: *mut c_void) -> HRESULT,
    pub CreateWebResourceResponse: Slot,
    pub get_BrowserVersionString:
        unsafe extern "system" fn(this: *mut c_void, value: *mut *mut u16) -> HRESULT,
    pub add_NewBrowserVersionAvailable: Slot,
    pub remove_NewBrowserVersionAvailable: Slot,
}
/// `ICoreWebView2Environment`.
pub const IID_ENVIRONMENT: GUID = GUID::parse("b96d755e-0319-4e92-a296-23436f46a1fc");
/// Slots of `ICoreWebView2Environment` counted from the IDL, `IUnknown` included.
pub const ENVIRONMENT_SLOTS: usize = 8;

/// `ICoreWebView2Controller` (`4d00c0d1-9434-4eb6-8078-8697a560334f`): 23 methods of its own, 26 slots with `IUnknown`.
#[repr(C)]
pub struct ControllerVtbl {
    pub unknown: IUnknownVtbl,
    pub get_IsVisible: Slot,
    pub put_IsVisible: unsafe extern "system" fn(this: *mut c_void, value: BOOL) -> HRESULT,
    pub get_Bounds: Slot,
    pub put_Bounds: unsafe extern "system" fn(this: *mut c_void, bounds: RECT) -> HRESULT,
    pub get_ZoomFactor: Slot,
    pub put_ZoomFactor: Slot,
    pub add_ZoomFactorChanged: Slot,
    pub remove_ZoomFactorChanged: Slot,
    pub SetBoundsAndZoomFactor: Slot,
    pub MoveFocus: unsafe extern "system" fn(this: *mut c_void, reason: i32) -> HRESULT,
    pub add_MoveFocusRequested: Slot,
    pub remove_MoveFocusRequested: Slot,
    pub add_GotFocus: Slot,
    pub remove_GotFocus: Slot,
    pub add_LostFocus: Slot,
    pub remove_LostFocus: Slot,
    pub add_AcceleratorKeyPressed: Slot,
    pub remove_AcceleratorKeyPressed: Slot,
    pub get_ParentWindow: Slot,
    pub put_ParentWindow: Slot,
    pub NotifyParentWindowPositionChanged: unsafe extern "system" fn(this: *mut c_void) -> HRESULT,
    pub Close: unsafe extern "system" fn(this: *mut c_void) -> HRESULT,
    pub get_CoreWebView2:
        unsafe extern "system" fn(this: *mut c_void, value: *mut *mut c_void) -> HRESULT,
}
/// `ICoreWebView2Controller`.
pub const IID_CONTROLLER: GUID = GUID::parse("4d00c0d1-9434-4eb6-8078-8697a560334f");
/// Slots of `ICoreWebView2Controller` counted from the IDL, `IUnknown` included.
pub const CONTROLLER_SLOTS: usize = 26;

/// `ICoreWebView2Controller2` (`c979903e-d4ca-4228-92eb-47ee3fa96eab`): 2 methods of its own, 28 slots with `IUnknown`.
#[repr(C)]
pub struct Controller2Vtbl {
    pub base: ControllerVtbl,
    pub get_DefaultBackgroundColor: Slot,
    pub put_DefaultBackgroundColor:
        unsafe extern "system" fn(this: *mut c_void, value: COLOR) -> HRESULT,
}
/// `ICoreWebView2Controller2`.
pub const IID_CONTROLLER2: GUID = GUID::parse("c979903e-d4ca-4228-92eb-47ee3fa96eab");
/// Slots of `ICoreWebView2Controller2` counted from the IDL, `IUnknown` included.
pub const CONTROLLER2_SLOTS: usize = 28;

/// `ICoreWebView2` (`76eceacb-0462-4d94-ac83-423a6793775e`): 58 methods of its own, 61 slots with `IUnknown`.
#[repr(C)]
pub struct WebViewVtbl {
    pub unknown: IUnknownVtbl,
    pub get_Settings:
        unsafe extern "system" fn(this: *mut c_void, value: *mut *mut c_void) -> HRESULT,
    pub get_Source: unsafe extern "system" fn(this: *mut c_void, value: *mut *mut u16) -> HRESULT,
    pub Navigate: unsafe extern "system" fn(this: *mut c_void, uri: *const u16) -> HRESULT,
    pub NavigateToString: Slot,
    pub add_NavigationStarting: unsafe extern "system" fn(
        this: *mut c_void,
        handler: *mut c_void,
        token: *mut EventRegistrationToken,
    ) -> HRESULT,
    pub remove_NavigationStarting: Slot,
    pub add_ContentLoading: Slot,
    pub remove_ContentLoading: Slot,
    pub add_SourceChanged: Slot,
    pub remove_SourceChanged: Slot,
    pub add_HistoryChanged: Slot,
    pub remove_HistoryChanged: Slot,
    pub add_NavigationCompleted: unsafe extern "system" fn(
        this: *mut c_void,
        handler: *mut c_void,
        token: *mut EventRegistrationToken,
    ) -> HRESULT,
    pub remove_NavigationCompleted: Slot,
    pub add_FrameNavigationStarting: unsafe extern "system" fn(
        this: *mut c_void,
        handler: *mut c_void,
        token: *mut EventRegistrationToken,
    ) -> HRESULT,
    pub remove_FrameNavigationStarting: Slot,
    pub add_FrameNavigationCompleted: Slot,
    pub remove_FrameNavigationCompleted: Slot,
    pub add_ScriptDialogOpening: unsafe extern "system" fn(
        this: *mut c_void,
        handler: *mut c_void,
        token: *mut EventRegistrationToken,
    ) -> HRESULT,
    pub remove_ScriptDialogOpening: Slot,
    pub add_PermissionRequested: unsafe extern "system" fn(
        this: *mut c_void,
        handler: *mut c_void,
        token: *mut EventRegistrationToken,
    ) -> HRESULT,
    pub remove_PermissionRequested: Slot,
    pub add_ProcessFailed: unsafe extern "system" fn(
        this: *mut c_void,
        handler: *mut c_void,
        token: *mut EventRegistrationToken,
    ) -> HRESULT,
    pub remove_ProcessFailed: Slot,
    pub AddScriptToExecuteOnDocumentCreated: Slot,
    pub RemoveScriptToExecuteOnDocumentCreated: Slot,
    pub ExecuteScript: Slot,
    pub CapturePreview: Slot,
    pub Reload: unsafe extern "system" fn(this: *mut c_void) -> HRESULT,
    pub PostWebMessageAsJson:
        unsafe extern "system" fn(this: *mut c_void, json: *const u16) -> HRESULT,
    pub PostWebMessageAsString: Slot,
    pub add_WebMessageReceived: unsafe extern "system" fn(
        this: *mut c_void,
        handler: *mut c_void,
        token: *mut EventRegistrationToken,
    ) -> HRESULT,
    pub remove_WebMessageReceived: Slot,
    pub CallDevToolsProtocolMethod: Slot,
    pub get_BrowserProcessId: Slot,
    pub get_CanGoBack: Slot,
    pub get_CanGoForward: Slot,
    pub GoBack: Slot,
    pub GoForward: Slot,
    pub GetDevToolsProtocolEventReceiver: Slot,
    pub Stop: Slot,
    pub add_NewWindowRequested: unsafe extern "system" fn(
        this: *mut c_void,
        handler: *mut c_void,
        token: *mut EventRegistrationToken,
    ) -> HRESULT,
    pub remove_NewWindowRequested: Slot,
    pub add_DocumentTitleChanged: Slot,
    pub remove_DocumentTitleChanged: Slot,
    pub get_DocumentTitle: Slot,
    pub AddHostObjectToScript: Slot,
    pub RemoveHostObjectFromScript: Slot,
    pub OpenDevToolsWindow: Slot,
    pub add_ContainsFullScreenElementChanged: Slot,
    pub remove_ContainsFullScreenElementChanged: Slot,
    pub get_ContainsFullScreenElement: Slot,
    pub add_WebResourceRequested: Slot,
    pub remove_WebResourceRequested: Slot,
    pub AddWebResourceRequestedFilter: Slot,
    pub RemoveWebResourceRequestedFilter: Slot,
    pub add_WindowCloseRequested: Slot,
    pub remove_WindowCloseRequested: Slot,
}
/// `ICoreWebView2`.
pub const IID_WEBVIEW: GUID = GUID::parse("76eceacb-0462-4d94-ac83-423a6793775e");
/// Slots of `ICoreWebView2` counted from the IDL, `IUnknown` included.
pub const WEBVIEW_SLOTS: usize = 61;

/// `ICoreWebView2_2` (`9e8f0cf8-e670-4b5e-b2bc-73e061e3184c`): 7 methods of its own, 68 slots with `IUnknown`.
#[repr(C)]
pub struct WebView2_2Vtbl {
    pub base: WebViewVtbl,
    pub add_WebResourceResponseReceived: Slot,
    pub remove_WebResourceResponseReceived: Slot,
    pub NavigateWithWebResourceRequest: Slot,
    pub add_DOMContentLoaded: Slot,
    pub remove_DOMContentLoaded: Slot,
    pub get_CookieManager: Slot,
    pub get_Environment: Slot,
}
/// `ICoreWebView2_2`.
pub const IID_WEBVIEW2_2: GUID = GUID::parse("9e8f0cf8-e670-4b5e-b2bc-73e061e3184c");
/// Slots of `ICoreWebView2_2` counted from the IDL, `IUnknown` included.
pub const WEBVIEW2_2_SLOTS: usize = 68;

/// `ICoreWebView2_3` (`a0d6df20-3b92-416d-aa0c-437a9c727857`): 5 methods of its own, 73 slots with `IUnknown`.
#[repr(C)]
pub struct WebView2_3Vtbl {
    pub base: WebView2_2Vtbl,
    pub TrySuspend: Slot,
    pub Resume: Slot,
    pub get_IsSuspended: Slot,
    pub SetVirtualHostNameToFolderMapping: Slot,
    pub ClearVirtualHostNameToFolderMapping: Slot,
}
/// `ICoreWebView2_3`.
pub const IID_WEBVIEW2_3: GUID = GUID::parse("a0d6df20-3b92-416d-aa0c-437a9c727857");
/// Slots of `ICoreWebView2_3` counted from the IDL, `IUnknown` included.
pub const WEBVIEW2_3_SLOTS: usize = 73;

/// `ICoreWebView2_4` (`20d02d59-6df2-42dc-bd06-f98a694b1302`): 4 methods of its own, 77 slots with `IUnknown`.
#[repr(C)]
pub struct WebView2_4Vtbl {
    pub base: WebView2_3Vtbl,
    pub add_FrameCreated: Slot,
    pub remove_FrameCreated: Slot,
    pub add_DownloadStarting: unsafe extern "system" fn(
        this: *mut c_void,
        handler: *mut c_void,
        token: *mut EventRegistrationToken,
    ) -> HRESULT,
    pub remove_DownloadStarting: Slot,
}
/// `ICoreWebView2_4`.
pub const IID_WEBVIEW2_4: GUID = GUID::parse("20d02d59-6df2-42dc-bd06-f98a694b1302");
/// Slots of `ICoreWebView2_4` counted from the IDL, `IUnknown` included.
pub const WEBVIEW2_4_SLOTS: usize = 77;

/// `ICoreWebView2Settings` (`e562e4f0-d7fa-43ac-8d71-c05150499f00`): 18 methods of its own, 21 slots with `IUnknown`.
#[repr(C)]
pub struct SettingsVtbl {
    pub unknown: IUnknownVtbl,
    pub get_IsScriptEnabled: Slot,
    pub put_IsScriptEnabled: unsafe extern "system" fn(this: *mut c_void, value: BOOL) -> HRESULT,
    pub get_IsWebMessageEnabled: Slot,
    pub put_IsWebMessageEnabled:
        unsafe extern "system" fn(this: *mut c_void, value: BOOL) -> HRESULT,
    pub get_AreDefaultScriptDialogsEnabled: Slot,
    pub put_AreDefaultScriptDialogsEnabled:
        unsafe extern "system" fn(this: *mut c_void, value: BOOL) -> HRESULT,
    pub get_IsStatusBarEnabled: Slot,
    pub put_IsStatusBarEnabled:
        unsafe extern "system" fn(this: *mut c_void, value: BOOL) -> HRESULT,
    pub get_AreDevToolsEnabled: Slot,
    pub put_AreDevToolsEnabled:
        unsafe extern "system" fn(this: *mut c_void, value: BOOL) -> HRESULT,
    pub get_AreDefaultContextMenusEnabled: Slot,
    pub put_AreDefaultContextMenusEnabled:
        unsafe extern "system" fn(this: *mut c_void, value: BOOL) -> HRESULT,
    pub get_AreHostObjectsAllowed: Slot,
    pub put_AreHostObjectsAllowed:
        unsafe extern "system" fn(this: *mut c_void, value: BOOL) -> HRESULT,
    pub get_IsZoomControlEnabled: Slot,
    pub put_IsZoomControlEnabled:
        unsafe extern "system" fn(this: *mut c_void, value: BOOL) -> HRESULT,
    pub get_IsBuiltInErrorPageEnabled: Slot,
    pub put_IsBuiltInErrorPageEnabled:
        unsafe extern "system" fn(this: *mut c_void, value: BOOL) -> HRESULT,
}
/// `ICoreWebView2Settings`.
pub const IID_SETTINGS: GUID = GUID::parse("e562e4f0-d7fa-43ac-8d71-c05150499f00");
/// Slots of `ICoreWebView2Settings` counted from the IDL, `IUnknown` included.
pub const SETTINGS_SLOTS: usize = 21;

/// `ICoreWebView2Settings2` (`ee9a0f68-f46c-4e32-ac23-ef8cac224d2a`): 2 methods of its own, 23 slots with `IUnknown`.
#[repr(C)]
pub struct Settings2Vtbl {
    pub base: SettingsVtbl,
    pub get_UserAgent: Slot,
    pub put_UserAgent: Slot,
}
/// `ICoreWebView2Settings2`.
pub const IID_SETTINGS2: GUID = GUID::parse("ee9a0f68-f46c-4e32-ac23-ef8cac224d2a");
/// Slots of `ICoreWebView2Settings2` counted from the IDL, `IUnknown` included.
pub const SETTINGS2_SLOTS: usize = 23;

/// `ICoreWebView2Settings3` (`fdb5ab74-af33-4854-84f0-0a631deb5eba`): 2 methods of its own, 25 slots with `IUnknown`.
#[repr(C)]
pub struct Settings3Vtbl {
    pub base: Settings2Vtbl,
    pub get_AreBrowserAcceleratorKeysEnabled: Slot,
    pub put_AreBrowserAcceleratorKeysEnabled:
        unsafe extern "system" fn(this: *mut c_void, value: BOOL) -> HRESULT,
}
/// `ICoreWebView2Settings3`.
pub const IID_SETTINGS3: GUID = GUID::parse("fdb5ab74-af33-4854-84f0-0a631deb5eba");
/// Slots of `ICoreWebView2Settings3` counted from the IDL, `IUnknown` included.
pub const SETTINGS3_SLOTS: usize = 25;

/// `ICoreWebView2Settings4` (`cb56846c-4168-4d53-b04f-03b6d6796ff2`): 4 methods of its own, 29 slots with `IUnknown`.
#[repr(C)]
pub struct Settings4Vtbl {
    pub base: Settings3Vtbl,
    pub get_IsPasswordAutosaveEnabled: Slot,
    pub put_IsPasswordAutosaveEnabled:
        unsafe extern "system" fn(this: *mut c_void, value: BOOL) -> HRESULT,
    pub get_IsGeneralAutofillEnabled: Slot,
    pub put_IsGeneralAutofillEnabled:
        unsafe extern "system" fn(this: *mut c_void, value: BOOL) -> HRESULT,
}
/// `ICoreWebView2Settings4`.
pub const IID_SETTINGS4: GUID = GUID::parse("cb56846c-4168-4d53-b04f-03b6d6796ff2");
/// Slots of `ICoreWebView2Settings4` counted from the IDL, `IUnknown` included.
pub const SETTINGS4_SLOTS: usize = 29;

/// `ICoreWebView2Settings5` (`183e7052-1d03-43a0-ab99-98e043b66b39`): 2 methods of its own, 31 slots with `IUnknown`.
#[repr(C)]
pub struct Settings5Vtbl {
    pub base: Settings4Vtbl,
    pub get_IsPinchZoomEnabled: Slot,
    pub put_IsPinchZoomEnabled:
        unsafe extern "system" fn(this: *mut c_void, value: BOOL) -> HRESULT,
}
/// `ICoreWebView2Settings5`.
pub const IID_SETTINGS5: GUID = GUID::parse("183e7052-1d03-43a0-ab99-98e043b66b39");
/// Slots of `ICoreWebView2Settings5` counted from the IDL, `IUnknown` included.
pub const SETTINGS5_SLOTS: usize = 31;

/// `ICoreWebView2Settings6` (`11cb3acd-9bc8-43b8-83bf-f40753714f87`): 2 methods of its own, 33 slots with `IUnknown`.
#[repr(C)]
pub struct Settings6Vtbl {
    pub base: Settings5Vtbl,
    pub get_IsSwipeNavigationEnabled: Slot,
    pub put_IsSwipeNavigationEnabled:
        unsafe extern "system" fn(this: *mut c_void, value: BOOL) -> HRESULT,
}
/// `ICoreWebView2Settings6`.
pub const IID_SETTINGS6: GUID = GUID::parse("11cb3acd-9bc8-43b8-83bf-f40753714f87");
/// Slots of `ICoreWebView2Settings6` counted from the IDL, `IUnknown` included.
pub const SETTINGS6_SLOTS: usize = 33;

/// `ICoreWebView2Settings7` (`488dc902-35ef-42d2-bc7d-94b65c4bc49c`): 2 methods of its own, 35 slots with `IUnknown`.
#[repr(C)]
pub struct Settings7Vtbl {
    pub base: Settings6Vtbl,
    pub get_HiddenPdfToolbarItems: Slot,
    pub put_HiddenPdfToolbarItems: Slot,
}
/// `ICoreWebView2Settings7`.
pub const IID_SETTINGS7: GUID = GUID::parse("488dc902-35ef-42d2-bc7d-94b65c4bc49c");
/// Slots of `ICoreWebView2Settings7` counted from the IDL, `IUnknown` included.
pub const SETTINGS7_SLOTS: usize = 35;

/// `ICoreWebView2Settings8` (`9e6b0e8f-86ad-4e81-8147-a9b5edb68650`): 2 methods of its own, 37 slots with `IUnknown`.
#[repr(C)]
pub struct Settings8Vtbl {
    pub base: Settings7Vtbl,
    pub get_IsReputationCheckingRequired: Slot,
    pub put_IsReputationCheckingRequired:
        unsafe extern "system" fn(this: *mut c_void, value: BOOL) -> HRESULT,
}
/// `ICoreWebView2Settings8`.
pub const IID_SETTINGS8: GUID = GUID::parse("9e6b0e8f-86ad-4e81-8147-a9b5edb68650");
/// Slots of `ICoreWebView2Settings8` counted from the IDL, `IUnknown` included.
pub const SETTINGS8_SLOTS: usize = 37;

/// `ICoreWebView2Settings9` (`0528a73b-e92d-49f4-927a-e547dddaa37d`): 2 methods of its own, 39 slots with `IUnknown`.
#[repr(C)]
pub struct Settings9Vtbl {
    pub base: Settings8Vtbl,
    pub get_IsNonClientRegionSupportEnabled: Slot,
    pub put_IsNonClientRegionSupportEnabled:
        unsafe extern "system" fn(this: *mut c_void, value: BOOL) -> HRESULT,
}
/// `ICoreWebView2Settings9`.
pub const IID_SETTINGS9: GUID = GUID::parse("0528a73b-e92d-49f4-927a-e547dddaa37d");
/// Slots of `ICoreWebView2Settings9` counted from the IDL, `IUnknown` included.
pub const SETTINGS9_SLOTS: usize = 39;

/// `ICoreWebView2NavigationStartingEventArgs` (`5b495469-e119-438a-9b18-7604f25f2e49`): 7 methods of its own, 10 slots with `IUnknown`.
#[repr(C)]
pub struct NavigationStartingArgsVtbl {
    pub unknown: IUnknownVtbl,
    pub get_Uri: unsafe extern "system" fn(this: *mut c_void, value: *mut *mut u16) -> HRESULT,
    pub get_IsUserInitiated:
        unsafe extern "system" fn(this: *mut c_void, value: *mut BOOL) -> HRESULT,
    pub get_IsRedirected: Slot,
    pub get_RequestHeaders: Slot,
    pub get_Cancel: Slot,
    pub put_Cancel: unsafe extern "system" fn(this: *mut c_void, value: BOOL) -> HRESULT,
    pub get_NavigationId: Slot,
}
/// `ICoreWebView2NavigationStartingEventArgs`.
pub const IID_NAVIGATIONSTARTINGARGS: GUID = GUID::parse("5b495469-e119-438a-9b18-7604f25f2e49");
/// Slots of `ICoreWebView2NavigationStartingEventArgs` counted from the IDL, `IUnknown` included.
pub const NAVIGATIONSTARTINGARGS_SLOTS: usize = 10;

/// `ICoreWebView2NavigationCompletedEventArgs` (`30d68b7d-20d9-4752-a9ca-ec8448fbb5c1`): 3 methods of its own, 6 slots with `IUnknown`.
#[repr(C)]
pub struct NavigationCompletedArgsVtbl {
    pub unknown: IUnknownVtbl,
    pub get_IsSuccess: unsafe extern "system" fn(this: *mut c_void, value: *mut BOOL) -> HRESULT,
    pub get_WebErrorStatus:
        unsafe extern "system" fn(this: *mut c_void, value: *mut i32) -> HRESULT,
    pub get_NavigationId: Slot,
}
/// `ICoreWebView2NavigationCompletedEventArgs`.
pub const IID_NAVIGATIONCOMPLETEDARGS: GUID = GUID::parse("30d68b7d-20d9-4752-a9ca-ec8448fbb5c1");
/// Slots of `ICoreWebView2NavigationCompletedEventArgs` counted from the IDL, `IUnknown` included.
pub const NAVIGATIONCOMPLETEDARGS_SLOTS: usize = 6;

/// `ICoreWebView2NewWindowRequestedEventArgs` (`34acb11c-fc37-4418-9132-f9c21d1eafb9`): 8 methods of its own, 11 slots with `IUnknown`.
#[repr(C)]
pub struct NewWindowRequestedArgsVtbl {
    pub unknown: IUnknownVtbl,
    pub get_Uri: unsafe extern "system" fn(this: *mut c_void, value: *mut *mut u16) -> HRESULT,
    pub put_NewWindow: Slot,
    pub get_NewWindow: Slot,
    pub put_Handled: unsafe extern "system" fn(this: *mut c_void, value: BOOL) -> HRESULT,
    pub get_Handled: Slot,
    pub get_IsUserInitiated:
        unsafe extern "system" fn(this: *mut c_void, value: *mut BOOL) -> HRESULT,
    pub GetDeferral: Slot,
    pub get_WindowFeatures: Slot,
}
/// `ICoreWebView2NewWindowRequestedEventArgs`.
pub const IID_NEWWINDOWREQUESTEDARGS: GUID = GUID::parse("34acb11c-fc37-4418-9132-f9c21d1eafb9");
/// Slots of `ICoreWebView2NewWindowRequestedEventArgs` counted from the IDL, `IUnknown` included.
pub const NEWWINDOWREQUESTEDARGS_SLOTS: usize = 11;

/// `ICoreWebView2PermissionRequestedEventArgs` (`973ae2ef-ff18-4894-8fb2-3c758f046810`): 6 methods of its own, 9 slots with `IUnknown`.
#[repr(C)]
pub struct PermissionRequestedArgsVtbl {
    pub unknown: IUnknownVtbl,
    pub get_Uri: unsafe extern "system" fn(this: *mut c_void, value: *mut *mut u16) -> HRESULT,
    pub get_PermissionKind:
        unsafe extern "system" fn(this: *mut c_void, value: *mut i32) -> HRESULT,
    pub get_IsUserInitiated:
        unsafe extern "system" fn(this: *mut c_void, value: *mut BOOL) -> HRESULT,
    pub get_State: Slot,
    pub put_State: unsafe extern "system" fn(this: *mut c_void, value: i32) -> HRESULT,
    pub GetDeferral: Slot,
}
/// `ICoreWebView2PermissionRequestedEventArgs`.
pub const IID_PERMISSIONREQUESTEDARGS: GUID = GUID::parse("973ae2ef-ff18-4894-8fb2-3c758f046810");
/// Slots of `ICoreWebView2PermissionRequestedEventArgs` counted from the IDL, `IUnknown` included.
pub const PERMISSIONREQUESTEDARGS_SLOTS: usize = 9;

/// `ICoreWebView2ScriptDialogOpeningEventArgs` (`7390bb70-abe0-4843-9529-f143b31b03d6`): 8 methods of its own, 11 slots with `IUnknown`.
#[repr(C)]
pub struct ScriptDialogOpeningArgsVtbl {
    pub unknown: IUnknownVtbl,
    pub get_Uri: unsafe extern "system" fn(this: *mut c_void, value: *mut *mut u16) -> HRESULT,
    pub get_Kind: unsafe extern "system" fn(this: *mut c_void, value: *mut i32) -> HRESULT,
    pub get_Message: unsafe extern "system" fn(this: *mut c_void, value: *mut *mut u16) -> HRESULT,
    pub Accept: unsafe extern "system" fn(this: *mut c_void) -> HRESULT,
    pub get_DefaultText: Slot,
    pub get_ResultText: Slot,
    pub put_ResultText: Slot,
    pub GetDeferral: Slot,
}
/// `ICoreWebView2ScriptDialogOpeningEventArgs`.
pub const IID_SCRIPTDIALOGOPENINGARGS: GUID = GUID::parse("7390bb70-abe0-4843-9529-f143b31b03d6");
/// Slots of `ICoreWebView2ScriptDialogOpeningEventArgs` counted from the IDL, `IUnknown` included.
pub const SCRIPTDIALOGOPENINGARGS_SLOTS: usize = 11;

/// `ICoreWebView2WebMessageReceivedEventArgs` (`0f99a40c-e962-4207-9e92-e3d542eff849`): 3 methods of its own, 6 slots with `IUnknown`.
#[repr(C)]
pub struct WebMessageReceivedArgsVtbl {
    pub unknown: IUnknownVtbl,
    pub get_Source: unsafe extern "system" fn(this: *mut c_void, value: *mut *mut u16) -> HRESULT,
    pub get_WebMessageAsJson:
        unsafe extern "system" fn(this: *mut c_void, value: *mut *mut u16) -> HRESULT,
    pub TryGetWebMessageAsString: Slot,
}
/// `ICoreWebView2WebMessageReceivedEventArgs`.
pub const IID_WEBMESSAGERECEIVEDARGS: GUID = GUID::parse("0f99a40c-e962-4207-9e92-e3d542eff849");
/// Slots of `ICoreWebView2WebMessageReceivedEventArgs` counted from the IDL, `IUnknown` included.
pub const WEBMESSAGERECEIVEDARGS_SLOTS: usize = 6;

/// `ICoreWebView2DownloadStartingEventArgs` (`e99bbe21-43e9-4544-a732-282764eafa60`): 8 methods of its own, 11 slots with `IUnknown`.
#[repr(C)]
pub struct DownloadStartingArgsVtbl {
    pub unknown: IUnknownVtbl,
    pub get_DownloadOperation: Slot,
    pub get_Cancel: Slot,
    pub put_Cancel: unsafe extern "system" fn(this: *mut c_void, value: BOOL) -> HRESULT,
    pub get_ResultFilePath:
        unsafe extern "system" fn(this: *mut c_void, value: *mut *mut u16) -> HRESULT,
    pub put_ResultFilePath: Slot,
    pub get_Handled: Slot,
    pub put_Handled: unsafe extern "system" fn(this: *mut c_void, value: BOOL) -> HRESULT,
    pub GetDeferral: Slot,
}
/// `ICoreWebView2DownloadStartingEventArgs`.
pub const IID_DOWNLOADSTARTINGARGS: GUID = GUID::parse("e99bbe21-43e9-4544-a732-282764eafa60");
/// Slots of `ICoreWebView2DownloadStartingEventArgs` counted from the IDL, `IUnknown` included.
pub const DOWNLOADSTARTINGARGS_SLOTS: usize = 11;

/// `ICoreWebView2ProcessFailedEventArgs` (`8155a9a4-1474-4a86-8cae-151b0fa6b8ca`): 1 methods of its own, 4 slots with `IUnknown`.
#[repr(C)]
pub struct ProcessFailedArgsVtbl {
    pub unknown: IUnknownVtbl,
    pub get_ProcessFailedKind:
        unsafe extern "system" fn(this: *mut c_void, value: *mut i32) -> HRESULT,
}
/// `ICoreWebView2ProcessFailedEventArgs`.
pub const IID_PROCESSFAILEDARGS: GUID = GUID::parse("8155a9a4-1474-4a86-8cae-151b0fa6b8ca");
/// Slots of `ICoreWebView2ProcessFailedEventArgs` counted from the IDL, `IUnknown` included.
pub const PROCESSFAILEDARGS_SLOTS: usize = 4;

// SAFETY: every table above starts with IUnknownVtbl, directly (`unknown`) or through `base`.
unsafe impl Interface for EnvironmentVtbl {}
unsafe impl Interface for ControllerVtbl {}
unsafe impl Interface for Controller2Vtbl {}
unsafe impl Interface for WebViewVtbl {}
unsafe impl Interface for WebView2_2Vtbl {}
unsafe impl Interface for WebView2_3Vtbl {}
unsafe impl Interface for WebView2_4Vtbl {}
unsafe impl Interface for SettingsVtbl {}
unsafe impl Interface for Settings2Vtbl {}
unsafe impl Interface for Settings3Vtbl {}
unsafe impl Interface for Settings4Vtbl {}
unsafe impl Interface for Settings5Vtbl {}
unsafe impl Interface for Settings6Vtbl {}
unsafe impl Interface for Settings7Vtbl {}
unsafe impl Interface for Settings8Vtbl {}
unsafe impl Interface for Settings9Vtbl {}
unsafe impl Interface for NavigationStartingArgsVtbl {}
unsafe impl Interface for NavigationCompletedArgsVtbl {}
unsafe impl Interface for NewWindowRequestedArgsVtbl {}
unsafe impl Interface for PermissionRequestedArgsVtbl {}
unsafe impl Interface for ScriptDialogOpeningArgsVtbl {}
unsafe impl Interface for WebMessageReceivedArgsVtbl {}
unsafe impl Interface for DownloadStartingArgsVtbl {}
unsafe impl Interface for ProcessFailedArgsVtbl {}
unsafe impl Interface for EnvironmentOptionsVtbl {}

// ------------------------------------------------------------------ the handlers we implement

/// `ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler`: `Invoke(HRESULT, ICoreWebView2Environment*)`.
pub const IID_ENVIRONMENT_COMPLETED: GUID = GUID::parse("4e8a3389-c9d8-4bd2-b6b5-124fee6cc14d");
/// `ICoreWebView2CreateCoreWebView2ControllerCompletedHandler`: `Invoke(HRESULT, ICoreWebView2Controller*)`.
pub const IID_CONTROLLER_COMPLETED: GUID = GUID::parse("6c4819f3-c9b7-4260-8127-c9f5bde7f68c");
/// `ICoreWebView2NavigationStartingEventHandler` (also for `FrameNavigationStarting`).
pub const IID_NAVIGATION_STARTING_HANDLER: GUID =
    GUID::parse("9adbe429-f36d-432b-9ddc-f8881fbd76e3");
/// `ICoreWebView2NavigationCompletedEventHandler`.
pub const IID_NAVIGATION_COMPLETED_HANDLER: GUID =
    GUID::parse("d33a35bf-1c49-4f98-93ab-006e0533fe1c");
/// `ICoreWebView2ScriptDialogOpeningEventHandler`.
pub const IID_SCRIPT_DIALOG_OPENING_HANDLER: GUID =
    GUID::parse("ef381bf9-afa8-4e37-91c4-8ac48524bdfb");
/// `ICoreWebView2PermissionRequestedEventHandler`.
pub const IID_PERMISSION_REQUESTED_HANDLER: GUID =
    GUID::parse("15e1c6a3-c72a-4df3-91d7-d097fbec6bfd");
/// `ICoreWebView2ProcessFailedEventHandler`.
pub const IID_PROCESS_FAILED_HANDLER: GUID = GUID::parse("79e0aea4-990b-42d9-aa1d-0fcc2e5bc7f1");
/// `ICoreWebView2WebMessageReceivedEventHandler`.
pub const IID_WEB_MESSAGE_RECEIVED_HANDLER: GUID =
    GUID::parse("57213f19-00e6-49fa-8e07-898ea01ecbd2");
/// `ICoreWebView2NewWindowRequestedEventHandler`.
pub const IID_NEW_WINDOW_REQUESTED_HANDLER: GUID =
    GUID::parse("d4c185fe-c81c-4989-97af-2d3fa7ab5651");
/// `ICoreWebView2DownloadStartingEventHandler`.
pub const IID_DOWNLOAD_STARTING_HANDLER: GUID = GUID::parse("efedc989-c396-41ca-83f7-07f845a55724");

/// `ICoreWebView2EnvironmentOptions` (`2fde08a8-1e9a-4766-8c05-95a9ceb9d1c5`), which we implement:
/// 8 methods of its own, 11 slots with `IUnknown`.
#[repr(C)]
pub struct EnvironmentOptionsVtbl {
    pub unknown: IUnknownVtbl,
    pub get_AdditionalBrowserArguments:
        unsafe extern "system" fn(this: *mut c_void, value: *mut *mut u16) -> HRESULT,
    pub put_AdditionalBrowserArguments:
        unsafe extern "system" fn(this: *mut c_void, value: *const u16) -> HRESULT,
    pub get_Language: unsafe extern "system" fn(this: *mut c_void, value: *mut *mut u16) -> HRESULT,
    pub put_Language: unsafe extern "system" fn(this: *mut c_void, value: *const u16) -> HRESULT,
    pub get_TargetCompatibleBrowserVersion:
        unsafe extern "system" fn(this: *mut c_void, value: *mut *mut u16) -> HRESULT,
    pub put_TargetCompatibleBrowserVersion:
        unsafe extern "system" fn(this: *mut c_void, value: *const u16) -> HRESULT,
    pub get_AllowSingleSignOnUsingOSPrimaryAccount:
        unsafe extern "system" fn(this: *mut c_void, value: *mut BOOL) -> HRESULT,
    pub put_AllowSingleSignOnUsingOSPrimaryAccount:
        unsafe extern "system" fn(this: *mut c_void, value: BOOL) -> HRESULT,
}
/// `ICoreWebView2EnvironmentOptions`.
pub const IID_ENVIRONMENT_OPTIONS: GUID = GUID::parse("2fde08a8-1e9a-4766-8c05-95a9ceb9d1c5");
/// Slots of `ICoreWebView2EnvironmentOptions`, `IUnknown` included.
pub const ENVIRONMENT_OPTIONS_SLOTS: usize = 11;

// ------------------------------------------------------------------ enumerations (IDL values)

/// `COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC`.
pub const MOVE_FOCUS_PROGRAMMATIC: i32 = 0;
/// `COREWEBVIEW2_SCRIPT_DIALOG_KIND_ALERT`.
pub const DIALOG_ALERT: i32 = 0;
/// `COREWEBVIEW2_SCRIPT_DIALOG_KIND_CONFIRM`.
pub const DIALOG_CONFIRM: i32 = 1;
/// `COREWEBVIEW2_SCRIPT_DIALOG_KIND_PROMPT`.
pub const DIALOG_PROMPT: i32 = 2;
/// `COREWEBVIEW2_SCRIPT_DIALOG_KIND_BEFOREUNLOAD`.
pub const DIALOG_BEFOREUNLOAD: i32 = 3;
/// `COREWEBVIEW2_PERMISSION_STATE_DEFAULT`.
pub const PERMISSION_DEFAULT: i32 = 0;
/// `COREWEBVIEW2_PERMISSION_STATE_ALLOW`.
pub const PERMISSION_ALLOW: i32 = 1;
/// `COREWEBVIEW2_PERMISSION_STATE_DENY`.
pub const PERMISSION_DENY: i32 = 2;
/// `COREWEBVIEW2_PERMISSION_KIND_FILE_READ_WRITE` (the File System Access API on a file or
/// folder the person picked in the system's dialog).
pub const PERMISSION_KIND_FILE_READ_WRITE: i32 = 8;
/// `COREWEBVIEW2_PERMISSION_KIND_PERSISTENT_STORAGE` (`navigator.storage.persist()`).
pub const PERMISSION_KIND_PERSISTENT_STORAGE: i32 = 13;
/// `COREWEBVIEW2_PROCESS_FAILED_KIND_BROWSER_PROCESS_EXITED`.
pub const PROCESS_BROWSER_EXITED: i32 = 0;
/// `COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_EXITED`.
pub const PROCESS_RENDER_EXITED: i32 = 1;
/// `COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_UNRESPONSIVE`.
pub const PROCESS_RENDER_UNRESPONSIVE: i32 = 2;

/// The names of `COREWEBVIEW2_PERMISSION_KIND`, for the log.
pub const PERMISSION_KINDS: [&str; 14] = [
    "unknown",
    "microphone",
    "camera",
    "geolocation",
    "notifications",
    "other-sensors",
    "clipboard-read",
    "multiple-automatic-downloads",
    "file-read-write",
    "autoplay",
    "local-fonts",
    "midi-system-exclusive",
    "window-management",
    "persistent-storage",
];

#[cfg(test)]
mod tests {
    use super::*;
    use std::mem::{offset_of, size_of};

    const SLOT: usize = size_of::<usize>();

    #[test]
    fn every_table_has_the_idl_method_count() {
        // (size of our table, slots counted from WebView2.idl, also those of WebView2.h)
        let tables = [
            (size_of::<EnvironmentVtbl>(), ENVIRONMENT_SLOTS, 8),
            (size_of::<ControllerVtbl>(), CONTROLLER_SLOTS, 26),
            (size_of::<Controller2Vtbl>(), CONTROLLER2_SLOTS, 28),
            (size_of::<WebViewVtbl>(), WEBVIEW_SLOTS, 61),
            (size_of::<WebView2_2Vtbl>(), WEBVIEW2_2_SLOTS, 68),
            (size_of::<WebView2_3Vtbl>(), WEBVIEW2_3_SLOTS, 73),
            (size_of::<WebView2_4Vtbl>(), WEBVIEW2_4_SLOTS, 77),
            (size_of::<SettingsVtbl>(), SETTINGS_SLOTS, 21),
            (size_of::<Settings2Vtbl>(), SETTINGS2_SLOTS, 23),
            (size_of::<Settings3Vtbl>(), SETTINGS3_SLOTS, 25),
            (size_of::<Settings4Vtbl>(), SETTINGS4_SLOTS, 29),
            (size_of::<Settings5Vtbl>(), SETTINGS5_SLOTS, 31),
            (size_of::<Settings6Vtbl>(), SETTINGS6_SLOTS, 33),
            (size_of::<Settings7Vtbl>(), SETTINGS7_SLOTS, 35),
            (size_of::<Settings8Vtbl>(), SETTINGS8_SLOTS, 37),
            (size_of::<Settings9Vtbl>(), SETTINGS9_SLOTS, 39),
            (
                size_of::<NavigationStartingArgsVtbl>(),
                NAVIGATIONSTARTINGARGS_SLOTS,
                10,
            ),
            (
                size_of::<NavigationCompletedArgsVtbl>(),
                NAVIGATIONCOMPLETEDARGS_SLOTS,
                6,
            ),
            (
                size_of::<NewWindowRequestedArgsVtbl>(),
                NEWWINDOWREQUESTEDARGS_SLOTS,
                11,
            ),
            (
                size_of::<PermissionRequestedArgsVtbl>(),
                PERMISSIONREQUESTEDARGS_SLOTS,
                9,
            ),
            (
                size_of::<ScriptDialogOpeningArgsVtbl>(),
                SCRIPTDIALOGOPENINGARGS_SLOTS,
                11,
            ),
            (
                size_of::<WebMessageReceivedArgsVtbl>(),
                WEBMESSAGERECEIVEDARGS_SLOTS,
                6,
            ),
            (
                size_of::<DownloadStartingArgsVtbl>(),
                DOWNLOADSTARTINGARGS_SLOTS,
                11,
            ),
            (
                size_of::<ProcessFailedArgsVtbl>(),
                PROCESSFAILEDARGS_SLOTS,
                4,
            ),
            (
                size_of::<EnvironmentOptionsVtbl>(),
                ENVIRONMENT_OPTIONS_SLOTS,
                11,
            ),
        ];
        for (i, (size, slots, header)) in tables.into_iter().enumerate() {
            assert_eq!(slots, header, "table {i}: IDL and header disagree");
            assert_eq!(size, slots * SLOT, "table {i}");
        }
    }

    #[test]
    fn the_methods_we_call_are_where_the_idl_puts_them() {
        // Zero-based vtable index (IUnknown's three first), read off WebView2.idl.
        let at = |offset: usize| offset / SLOT;
        assert_eq!(
            at(offset_of!(EnvironmentVtbl, CreateCoreWebView2Controller)),
            3
        );
        assert_eq!(at(offset_of!(EnvironmentVtbl, get_BrowserVersionString)), 5);
        assert_eq!(at(offset_of!(ControllerVtbl, put_IsVisible)), 4);
        assert_eq!(at(offset_of!(ControllerVtbl, put_Bounds)), 6);
        assert_eq!(at(offset_of!(ControllerVtbl, MoveFocus)), 12);
        assert_eq!(
            at(offset_of!(
                ControllerVtbl,
                NotifyParentWindowPositionChanged
            )),
            23
        );
        assert_eq!(at(offset_of!(ControllerVtbl, Close)), 24);
        assert_eq!(at(offset_of!(ControllerVtbl, get_CoreWebView2)), 25);
        assert_eq!(
            at(offset_of!(Controller2Vtbl, put_DefaultBackgroundColor)),
            27
        );
        assert_eq!(at(offset_of!(WebViewVtbl, get_Settings)), 3);
        assert_eq!(at(offset_of!(WebViewVtbl, Navigate)), 5);
        assert_eq!(at(offset_of!(WebViewVtbl, add_NavigationStarting)), 7);
        assert_eq!(at(offset_of!(WebViewVtbl, add_NavigationCompleted)), 15);
        assert_eq!(at(offset_of!(WebViewVtbl, add_FrameNavigationStarting)), 17);
        assert_eq!(at(offset_of!(WebViewVtbl, add_ScriptDialogOpening)), 21);
        assert_eq!(at(offset_of!(WebViewVtbl, add_PermissionRequested)), 23);
        assert_eq!(at(offset_of!(WebViewVtbl, add_ProcessFailed)), 25);
        assert_eq!(at(offset_of!(WebViewVtbl, Reload)), 31);
        assert_eq!(at(offset_of!(WebViewVtbl, PostWebMessageAsJson)), 32);
        assert_eq!(at(offset_of!(WebViewVtbl, add_WebMessageReceived)), 34);
        assert_eq!(at(offset_of!(WebViewVtbl, add_NewWindowRequested)), 44);
        assert_eq!(at(offset_of!(WebView2_4Vtbl, add_DownloadStarting)), 75);
        assert_eq!(
            at(offset_of!(SettingsVtbl, put_AreDefaultScriptDialogsEnabled)),
            8
        );
        assert_eq!(at(offset_of!(SettingsVtbl, put_IsStatusBarEnabled)), 10);
        assert_eq!(at(offset_of!(SettingsVtbl, put_AreDevToolsEnabled)), 12);
        assert_eq!(
            at(offset_of!(SettingsVtbl, put_AreDefaultContextMenusEnabled)),
            14
        );
        assert_eq!(at(offset_of!(SettingsVtbl, put_IsZoomControlEnabled)), 18);
        assert_eq!(
            at(offset_of!(SettingsVtbl, put_IsBuiltInErrorPageEnabled)),
            20
        );
        assert_eq!(
            at(offset_of!(
                Settings3Vtbl,
                put_AreBrowserAcceleratorKeysEnabled
            )),
            24
        );
        assert_eq!(
            at(offset_of!(Settings4Vtbl, put_IsPasswordAutosaveEnabled)),
            26
        );
        assert_eq!(
            at(offset_of!(Settings4Vtbl, put_IsGeneralAutofillEnabled)),
            28
        );
        assert_eq!(at(offset_of!(Settings5Vtbl, put_IsPinchZoomEnabled)), 30);
        assert_eq!(
            at(offset_of!(Settings6Vtbl, put_IsSwipeNavigationEnabled)),
            32
        );
        assert_eq!(
            at(offset_of!(Settings8Vtbl, put_IsReputationCheckingRequired)),
            36
        );
        assert_eq!(
            at(offset_of!(
                Settings9Vtbl,
                put_IsNonClientRegionSupportEnabled
            )),
            38
        );
        assert_eq!(at(offset_of!(NavigationStartingArgsVtbl, put_Cancel)), 8);
        assert_eq!(at(offset_of!(NewWindowRequestedArgsVtbl, put_Handled)), 6);
        assert_eq!(
            at(offset_of!(NewWindowRequestedArgsVtbl, get_IsUserInitiated)),
            8
        );
        assert_eq!(at(offset_of!(PermissionRequestedArgsVtbl, put_State)), 7);
        assert_eq!(at(offset_of!(ScriptDialogOpeningArgsVtbl, Accept)), 6);
        assert_eq!(
            at(offset_of!(WebMessageReceivedArgsVtbl, get_WebMessageAsJson)),
            4
        );
        assert_eq!(at(offset_of!(DownloadStartingArgsVtbl, put_Cancel)), 5);
        assert_eq!(at(offset_of!(DownloadStartingArgsVtbl, put_Handled)), 9);
        assert_eq!(
            at(offset_of!(ProcessFailedArgsVtbl, get_ProcessFailedKind)),
            3
        );
        assert_eq!(
            at(offset_of!(
                EnvironmentOptionsVtbl,
                put_AllowSingleSignOnUsingOSPrimaryAccount
            )),
            10
        );
    }

    #[test]
    fn structs_passed_by_value_have_the_c_layout() {
        assert_eq!(size_of::<RECT>(), 16);
        assert_eq!(size_of::<COLOR>(), 4);
        assert_eq!(size_of::<EventRegistrationToken>(), 8);
        assert_eq!(offset_of!(COLOR, a), 0);
        assert_eq!(offset_of!(COLOR, b), 3);
    }

    #[test]
    fn interface_identifiers_are_distinct_and_print_back() {
        let iids = [
            ("b96d755e-0319-4e92-a296-23436f46a1fc", IID_ENVIRONMENT),
            ("4d00c0d1-9434-4eb6-8078-8697a560334f", IID_CONTROLLER),
            ("c979903e-d4ca-4228-92eb-47ee3fa96eab", IID_CONTROLLER2),
            ("76eceacb-0462-4d94-ac83-423a6793775e", IID_WEBVIEW),
            ("20d02d59-6df2-42dc-bd06-f98a694b1302", IID_WEBVIEW2_4),
            ("e562e4f0-d7fa-43ac-8d71-c05150499f00", IID_SETTINGS),
            ("fdb5ab74-af33-4854-84f0-0a631deb5eba", IID_SETTINGS3),
            ("cb56846c-4168-4d53-b04f-03b6d6796ff2", IID_SETTINGS4),
            ("183e7052-1d03-43a0-ab99-98e043b66b39", IID_SETTINGS5),
            ("11cb3acd-9bc8-43b8-83bf-f40753714f87", IID_SETTINGS6),
            ("9e6b0e8f-86ad-4e81-8147-a9b5edb68650", IID_SETTINGS8),
            ("0528a73b-e92d-49f4-927a-e547dddaa37d", IID_SETTINGS9),
            (
                "2fde08a8-1e9a-4766-8c05-95a9ceb9d1c5",
                IID_ENVIRONMENT_OPTIONS,
            ),
            (
                "4e8a3389-c9d8-4bd2-b6b5-124fee6cc14d",
                IID_ENVIRONMENT_COMPLETED,
            ),
            (
                "6c4819f3-c9b7-4260-8127-c9f5bde7f68c",
                IID_CONTROLLER_COMPLETED,
            ),
            (
                "9adbe429-f36d-432b-9ddc-f8881fbd76e3",
                IID_NAVIGATION_STARTING_HANDLER,
            ),
            (
                "d33a35bf-1c49-4f98-93ab-006e0533fe1c",
                IID_NAVIGATION_COMPLETED_HANDLER,
            ),
            (
                "ef381bf9-afa8-4e37-91c4-8ac48524bdfb",
                IID_SCRIPT_DIALOG_OPENING_HANDLER,
            ),
            (
                "15e1c6a3-c72a-4df3-91d7-d097fbec6bfd",
                IID_PERMISSION_REQUESTED_HANDLER,
            ),
            (
                "79e0aea4-990b-42d9-aa1d-0fcc2e5bc7f1",
                IID_PROCESS_FAILED_HANDLER,
            ),
            (
                "57213f19-00e6-49fa-8e07-898ea01ecbd2",
                IID_WEB_MESSAGE_RECEIVED_HANDLER,
            ),
            (
                "d4c185fe-c81c-4989-97af-2d3fa7ab5651",
                IID_NEW_WINDOW_REQUESTED_HANDLER,
            ),
            (
                "efedc989-c396-41ca-83f7-07f845a55724",
                IID_DOWNLOAD_STARTING_HANDLER,
            ),
        ];
        for (i, (text, iid)) in iids.iter().enumerate() {
            assert_eq!(iid.to_text(), *text);
            for (other, _) in &iids[i + 1..] {
                assert_ne!(text, other);
            }
        }
        assert_eq!(
            PERMISSION_KINDS[PERMISSION_KIND_FILE_READ_WRITE as usize],
            "file-read-write"
        );
        assert_eq!(
            PERMISSION_KINDS[PERMISSION_KIND_PERSISTENT_STORAGE as usize],
            "persistent-storage"
        );
    }
}
