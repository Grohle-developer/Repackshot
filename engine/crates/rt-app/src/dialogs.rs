//! The system's own dialogs for choosing a folder, files to open and a file to save, asked to
//! programs of the system (never through FFI, so no `unsafe`):
//!
//! * **Windows**: Windows PowerShell with `System.Windows.Forms` (`OpenFileDialog`,
//!   `SaveFileDialog`; folders with the Vista-style `IFileOpenDialog` in `FOS_PICKFOLDERS` mode,
//!   compiled once by `Add-Type` and cached, falling back to the file dialog's folder trick),
//!   started hidden (`-NoProfile -NonInteractive -WindowStyle Hidden -STA`, no console window)
//!   and owned by the application's window when the launcher knows it
//!   ([`Dialogs::set_owner_window`]), else by a hidden top-most form, so the dialog comes up in
//!   front of the app window. Everything the page sends (title, file name, filters, folder) goes
//!   to the script through environment variables, never into its text, and the chosen paths come
//!   back in base64 of UTF-8, whatever the console code page.
//! * **Linux**: `zenity`, else `kdialog`, else a clear error.
//!
//! A dialog stays open as long as the person needs; only one is open at a time, and the ones
//! still open when the application ends are closed with it ([`Dialogs::close_all`]).

use std::ffi::OsString;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Mutex, PoisonError};
use std::time::Duration;

/// A file type of an open or save dialog: a name and extensions without the dot (`png`, `repack`,
/// `repack.json`); `*` is every file. The first extension is what a save dialog adds to a bare name.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Filter {
    /// What the dialog shows (`PNG image`).
    pub name: String,
    /// Extensions, without the dot.
    pub extensions: Vec<String>,
}

/// What to ask.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Kind {
    /// One folder.
    Folder,
    /// Files to read.
    Open {
        /// Several at once.
        multiple: bool,
    },
    /// A file to write.
    Save {
        /// The name proposed.
        default_name: String,
    },
}

/// A dialog to show.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Request {
    /// What it asks for.
    pub kind: Kind,
    /// The window title (the page's words, in its language).
    pub title: String,
    /// File types (open and save).
    pub filters: Vec<Filter>,
    /// The folder the dialog starts in, when it exists.
    pub start: Option<PathBuf>,
    /// Windows' folder trick only: the name shown in the file name box ("Folder selection").
    pub folder_item: String,
}

/// What the person did.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Outcome {
    /// The paths chosen (one, or several for a multiple open).
    Chosen(Vec<PathBuf>),
    /// Closed without choosing.
    Cancelled,
}

/// Why no dialog could be shown.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum DialogError {
    /// Another dialog is open.
    Busy,
    /// The system has no program for dialogs (Linux without `zenity` or `kdialog`).
    Unavailable(String),
    /// The program failed.
    Failed(String),
}

impl std::fmt::Display for DialogError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            DialogError::Busy => write!(f, "another dialog is open"),
            DialogError::Unavailable(m) | DialogError::Failed(m) => write!(f, "{m}"),
        }
    }
}

/// The program that shows the dialogs.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Backend {
    /// Windows PowerShell (`powershell.exe`).
    PowerShell(PathBuf),
    /// GNOME's `zenity`.
    Zenity(PathBuf),
    /// KDE's `kdialog`.
    Kdialog(PathBuf),
}

/// Longest title or filter name accepted, in characters.
pub const MAX_TEXT: usize = 200;

/// The dialogs of one launch.
pub struct Dialogs {
    busy: AtomicBool,
    stopping: AtomicBool,
    child: Mutex<Option<Child>>,
    owner: AtomicU64,
    backend: Mutex<Option<Backend>>,
    cache: Mutex<Option<PathBuf>>,
}

impl Default for Dialogs {
    fn default() -> Self {
        Dialogs::new()
    }
}

impl Dialogs {
    /// Dialogs with the system's program, found when the first one is asked.
    pub fn new() -> Dialogs {
        Dialogs {
            busy: AtomicBool::new(false),
            stopping: AtomicBool::new(false),
            child: Mutex::new(None),
            owner: AtomicU64::new(0),
            backend: Mutex::new(None),
            cache: Mutex::new(None),
        }
    }

    /// The application's own window (a Windows `HWND`), so dialogs are owned by it and come up
    /// in front of it. 0: none known (a hidden top-most form owns them).
    pub fn set_owner_window(&self, hwnd: u64) {
        self.owner.store(hwnd, Ordering::Relaxed);
    }

    /// Uses this program instead of looking for one (tests, and a host that knows better).
    pub fn use_backend(&self, backend: Backend) {
        *self.backend.lock().unwrap_or_else(PoisonError::into_inner) = Some(backend);
    }

    /// Where the Windows folder picker keeps its compiled helper (`<data>/cache`).
    pub fn set_cache_dir(&self, dir: PathBuf) {
        *self.cache.lock().unwrap_or_else(PoisonError::into_inner) = Some(dir);
    }

    fn backend(&self) -> Result<Backend, DialogError> {
        let mut b = self.backend.lock().unwrap_or_else(PoisonError::into_inner);
        if let Some(found) = b.as_ref() {
            return Ok(found.clone());
        }
        let found = find_backend()?;
        *b = Some(found.clone());
        Ok(found)
    }

    /// Shows a dialog and waits for the person. Only one at a time: a second one is
    /// [`DialogError::Busy`].
    pub fn show(&self, req: &Request) -> Result<Outcome, DialogError> {
        if self.stopping.load(Ordering::Relaxed) {
            return Err(DialogError::Failed("the application is closing".into()));
        }
        if self.busy.swap(true, Ordering::AcqRel) {
            return Err(DialogError::Busy);
        }
        let result = self.backend().and_then(|b| self.run(&b, req));
        self.busy.store(false, Ordering::Release);
        result
    }

    fn run(&self, backend: &Backend, req: &Request) -> Result<Outcome, DialogError> {
        let mut cmd = match backend {
            Backend::PowerShell(exe) => {
                let mut c = Command::new(exe);
                c.args(POWERSHELL_ARGS)
                    .arg(encoded_command(POWERSHELL_SCRIPT));
                let cache = self
                    .cache
                    .lock()
                    .unwrap_or_else(PoisonError::into_inner)
                    .clone();
                for (k, v) in powershell_env(req, self.owner.load(Ordering::Relaxed), cache) {
                    c.env(k, v);
                }
                crate::process::no_window(&mut c);
                c
            }
            Backend::Zenity(exe) => {
                let mut c = Command::new(exe);
                c.args(zenity_args(req));
                c
            }
            Backend::Kdialog(exe) => {
                let mut c = Command::new(exe);
                c.args(kdialog_args(req));
                c
            }
        };
        cmd.stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        let mut child = cmd
            .spawn()
            .map_err(|e| DialogError::Unavailable(format!("cannot start the dialog: {e}")))?;
        // Read on other threads (a full pipe must not block the program); a grandchild that keeps
        // the pipe open after the dialog is gone is not waited for.
        let (out_tx, out_rx) = std::sync::mpsc::channel();
        let (err_tx, err_rx) = std::sync::mpsc::channel();
        if let Some(mut s) = child.stdout.take() {
            std::thread::spawn(move || {
                let mut buf = Vec::new();
                let _ = s.read_to_end(&mut buf);
                let _ = out_tx.send(buf);
            });
        }
        if let Some(s) = child.stderr.take() {
            std::thread::spawn(move || {
                let mut buf = Vec::new();
                let _ = s.take(64 * 1024).read_to_end(&mut buf);
                let _ = err_tx.send(buf);
            });
        }
        *self.child.lock().unwrap_or_else(PoisonError::into_inner) = Some(child);
        // Wait without holding the lock, so close_all can kill it.
        let status = loop {
            {
                let mut slot = self.child.lock().unwrap_or_else(PoisonError::into_inner);
                match slot.as_mut().map(Child::try_wait) {
                    Some(Ok(Some(status))) => {
                        slot.take();
                        break Some(status);
                    }
                    Some(Ok(None)) => {}
                    Some(Err(_)) | None => {
                        slot.take();
                        break None;
                    }
                }
            }
            std::thread::sleep(Duration::from_millis(40));
        };
        let grace = Duration::from_secs(2);
        let stdout = out_rx.recv_timeout(grace).unwrap_or_default();
        let stderr =
            String::from_utf8_lossy(&err_rx.recv_timeout(grace).unwrap_or_default()).into_owned();
        if self.stopping.load(Ordering::Relaxed) {
            return Err(DialogError::Failed("the application is closing".into()));
        }
        let Some(status) = status else {
            return Err(DialogError::Failed("the dialog was closed".into()));
        };
        match backend {
            Backend::PowerShell(_) => parse_powershell(&stdout, status.code(), &stderr),
            Backend::Zenity(_) => parse_zenity(&stdout, status.code(), &stderr, req),
            Backend::Kdialog(_) => parse_kdialog(&stdout, status.code(), &stderr, req),
        }
    }

    /// Closes the dialog that is open (the application is ending) and refuses new ones.
    pub fn close_all(&self) {
        self.stopping.store(true, Ordering::Relaxed);
        if let Some(c) = self
            .child
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .as_mut()
        {
            let _ = c.kill();
        }
    }
}

/// The program for dialogs on this system.
pub fn find_backend() -> Result<Backend, DialogError> {
    if cfg!(windows) {
        return Ok(Backend::PowerShell(crate::process::system32(&[
            "WindowsPowerShell",
            "v1.0",
            "powershell.exe",
        ])));
    }
    if let Some(p) = on_path("zenity") {
        return Ok(Backend::Zenity(p));
    }
    if let Some(p) = on_path("kdialog") {
        return Ok(Backend::Kdialog(p));
    }
    Err(DialogError::Unavailable(
        "no dialog program: install zenity (GNOME) or kdialog (KDE)".into(),
    ))
}

fn on_path(name: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path)
        .map(|d| d.join(name))
        .find(|p| p.is_file())
}

/// A title, file name or filter name as the dialog gets it: control characters removed, at most
/// [`MAX_TEXT`] characters.
pub fn clean_text(text: &str) -> String {
    text.chars()
        .filter(|c| !c.is_control())
        .take(MAX_TEXT)
        .collect::<String>()
        .trim()
        .to_string()
}

/// An extension accepted in a filter: `*`, or letters, digits and `.+_-` (not first), up to 32.
pub fn valid_extension(ext: &str) -> bool {
    ext == "*"
        || (!ext.is_empty()
            && ext.len() <= 32
            && ext.as_bytes()[0].is_ascii_alphanumeric()
            && ext
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b".+_-".contains(&b))
            && !ext.ends_with('.'))
}

fn patterns(f: &Filter) -> Vec<String> {
    let mut out = Vec::new();
    for e in &f.extensions {
        if e == "*" {
            out.push("*".to_string());
            continue;
        }
        out.push(format!("*.{}", e.to_ascii_lowercase()));
        let upper = format!("*.{}", e.to_ascii_uppercase());
        if !out.contains(&upper) {
            out.push(upper);
        }
    }
    out.dedup();
    out
}

/// The `Filter` property of a Windows file dialog: `Name|*.png;*.jpg|All files|*.*`.
pub fn windows_filter(filters: &[Filter]) -> String {
    filters
        .iter()
        .map(|f| {
            let pats: Vec<String> = f
                .extensions
                .iter()
                .map(|e| {
                    if e == "*" {
                        "*.*".to_string()
                    } else {
                        format!("*.{e}")
                    }
                })
                .collect();
            format!(
                "{}|{}",
                clean_text(&f.name).replace('|', " "),
                pats.join(";")
            )
        })
        .collect::<Vec<_>>()
        .join("|")
}

/// The first real extension of the filters (what a save dialog adds to a bare name).
pub fn default_extension(filters: &[Filter]) -> Option<String> {
    filters
        .iter()
        .flat_map(|f| f.extensions.iter())
        .find(|e| *e != "*")
        .cloned()
}

/// `zenity` arguments.
pub fn zenity_args(req: &Request) -> Vec<OsString> {
    let mut a: Vec<OsString> = vec!["--file-selection".into(), "--modal".into()];
    let title = clean_text(&req.title);
    if !title.is_empty() {
        a.push(format!("--title={title}").into());
    }
    match &req.kind {
        Kind::Folder => {
            a.push("--directory".into());
            if let Some(s) = &req.start {
                a.push(path_arg("--filename=", &s.join("")));
            }
        }
        Kind::Open { multiple } => {
            if *multiple {
                a.push("--multiple".into());
                a.push("--separator=\n".into());
            }
            if let Some(s) = &req.start {
                a.push(path_arg("--filename=", &s.join("")));
            }
        }
        Kind::Save { default_name } => {
            a.push("--save".into());
            a.push("--confirm-overwrite".into());
            let name = clean_text(default_name);
            let target = match &req.start {
                Some(s) => s.join(&name),
                None => PathBuf::from(&name),
            };
            a.push(path_arg("--filename=", &target));
        }
    }
    if !matches!(req.kind, Kind::Folder) {
        for f in &req.filters {
            a.push(
                format!(
                    "--file-filter={} | {}",
                    clean_text(&f.name).replace('|', " "),
                    patterns(f).join(" ")
                )
                .into(),
            );
        }
    }
    a
}

/// `kdialog` arguments.
pub fn kdialog_args(req: &Request) -> Vec<OsString> {
    let mut a: Vec<OsString> = Vec::new();
    let title = clean_text(&req.title);
    if !title.is_empty() {
        a.push("--title".into());
        a.push(title.into());
    }
    let start = req
        .start
        .clone()
        .or_else(|| std::env::var_os("HOME").map(PathBuf::from))
        .unwrap_or_else(|| PathBuf::from("."));
    let filter = req
        .filters
        .iter()
        .map(|f| {
            format!(
                "{}|{}",
                patterns(f).join(" "),
                clean_text(&f.name).replace('|', " ")
            )
        })
        .collect::<Vec<_>>()
        .join("\n");
    match &req.kind {
        Kind::Folder => {
            a.push("--getexistingdirectory".into());
            a.push(start.into_os_string());
        }
        Kind::Open { multiple } => {
            a.push("--getopenfilename".into());
            a.push(start.into_os_string());
            a.push(filter.into());
            if *multiple {
                a.push("--multiple".into());
                a.push("--separate-output".into());
            }
        }
        Kind::Save { default_name } => {
            a.push("--getsavefilename".into());
            a.push(start.join(clean_text(default_name)).into_os_string());
            a.push(filter.into());
        }
    }
    a
}

fn path_arg(prefix: &str, path: &Path) -> OsString {
    let mut s = OsString::from(prefix);
    s.push(path);
    s
}

/// Lines of a program's output as paths (bytes as they are on Unix; UTF-8 elsewhere).
fn lines_as_paths(stdout: &[u8]) -> Vec<PathBuf> {
    stdout
        .split(|&b| b == b'\n')
        .map(|l| l.strip_suffix(b"\r").unwrap_or(l))
        .filter(|l| !l.is_empty())
        .map(bytes_to_path)
        .collect()
}

#[cfg(unix)]
fn bytes_to_path(bytes: &[u8]) -> PathBuf {
    use std::os::unix::ffi::OsStringExt;
    PathBuf::from(OsString::from_vec(bytes.to_vec()))
}

#[cfg(not(unix))]
fn bytes_to_path(bytes: &[u8]) -> PathBuf {
    PathBuf::from(String::from_utf8_lossy(bytes).into_owned())
}

fn chosen(paths: Vec<PathBuf>, req: &Request) -> Result<Outcome, DialogError> {
    let paths: Vec<PathBuf> = paths.into_iter().filter(|p| p.is_absolute()).collect();
    if paths.is_empty() {
        return Ok(Outcome::Cancelled);
    }
    match req.kind {
        Kind::Open { multiple: true } => Ok(Outcome::Chosen(paths)),
        _ => Ok(Outcome::Chosen(paths.into_iter().take(1).collect())),
    }
}

/// Reads what `zenity` said: exit 0 with the paths, 1 cancelled, anything else an error.
pub fn parse_zenity(
    stdout: &[u8],
    code: Option<i32>,
    stderr: &str,
    req: &Request,
) -> Result<Outcome, DialogError> {
    match code {
        Some(0) => chosen(lines_as_paths(stdout), req),
        Some(1) => Ok(Outcome::Cancelled),
        other => Err(DialogError::Failed(format!(
            "zenity failed ({other:?}): {}",
            stderr.trim()
        ))),
    }
}

/// Reads what `kdialog` said (the same codes as `zenity`).
pub fn parse_kdialog(
    stdout: &[u8],
    code: Option<i32>,
    stderr: &str,
    req: &Request,
) -> Result<Outcome, DialogError> {
    match code {
        Some(0) => chosen(lines_as_paths(stdout), req),
        Some(1) => Ok(Outcome::Cancelled),
        other => Err(DialogError::Failed(format!(
            "kdialog failed ({other:?}): {}",
            stderr.trim()
        ))),
    }
}

/// Reads what the PowerShell script said: `PATH <base64>` lines, `CANCEL`, or `ERROR <base64>`.
pub fn parse_powershell(
    stdout: &[u8],
    code: Option<i32>,
    stderr: &str,
) -> Result<Outcome, DialogError> {
    let text = String::from_utf8_lossy(stdout);
    let mut paths = Vec::new();
    for line in text.lines().map(str::trim) {
        if let Some(b) = line.strip_prefix("PATH ") {
            let bytes = base64_decode(b)
                .ok_or_else(|| DialogError::Failed("unreadable path from the dialog".into()))?;
            paths.push(PathBuf::from(String::from_utf8_lossy(&bytes).into_owned()));
        } else if let Some(b) = line.strip_prefix("ERROR ") {
            let message = base64_decode(b)
                .map(|m| String::from_utf8_lossy(&m).into_owned())
                .unwrap_or_else(|| b.to_string());
            return Err(DialogError::Failed(format!("the dialog failed: {message}")));
        } else if line == "CANCEL" {
            return Ok(Outcome::Cancelled);
        }
    }
    if !paths.is_empty() {
        return Ok(Outcome::Chosen(paths));
    }
    Err(DialogError::Failed(format!(
        "the dialog said nothing (exit {code:?}): {}",
        stderr.trim()
    )))
}

/// The environment the script reads (everything the page sent, as data).
pub fn powershell_env(
    req: &Request,
    owner: u64,
    cache: Option<PathBuf>,
) -> Vec<(String, OsString)> {
    let mut env: Vec<(String, OsString)> = vec![
        (
            "RPX_KIND".into(),
            match req.kind {
                Kind::Folder => "folder",
                Kind::Open { .. } => "open",
                Kind::Save { .. } => "save",
            }
            .into(),
        ),
        ("RPX_TITLE".into(), clean_text(&req.title).into()),
        ("RPX_FILTER".into(), windows_filter(&req.filters).into()),
        (
            "RPX_MULTI".into(),
            if matches!(req.kind, Kind::Open { multiple: true }) {
                "1"
            } else {
                "0"
            }
            .into(),
        ),
        (
            "RPX_NAME".into(),
            match &req.kind {
                Kind::Save { default_name } => clean_text(default_name),
                _ => String::new(),
            }
            .into(),
        ),
        (
            "RPX_EXT".into(),
            default_extension(&req.filters).unwrap_or_default().into(),
        ),
        (
            "RPX_START".into(),
            req.start
                .as_ref()
                .map(|p| p.as_os_str().to_os_string())
                .unwrap_or_default(),
        ),
        (
            "RPX_FOLDER_ITEM".into(),
            clean_text(&req.folder_item).into(),
        ),
        (
            "RPX_OWNER".into(),
            if owner == 0 {
                OsString::new()
            } else {
                owner.to_string().into()
            },
        ),
    ];
    if let Some(dir) = cache {
        let mut dll = dir.into_os_string();
        dll.push(std::path::MAIN_SEPARATOR_STR);
        dll.push(format!("folder-picker-{FOLDER_PICKER_VERSION}.dll"));
        env.push(("RPX_CACHE".into(), dll));
    } else {
        env.push(("RPX_CACHE".into(), OsString::new()));
    }
    env
}

/// The version of the compiled folder picker (a new one when its source changes).
pub const FOLDER_PICKER_VERSION: u32 = 1;

/// PowerShell's switches: no profile, no prompts, no window, single-threaded apartment (what
/// Windows Forms dialogs need).
pub const POWERSHELL_ARGS: [&str; 7] = [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-WindowStyle",
    "Hidden",
    "-STA",
    "-EncodedCommand",
];

/// `-EncodedCommand`'s argument: the script in UTF-16LE, base64.
pub fn encoded_command(script: &str) -> String {
    let bytes: Vec<u8> = script.encode_utf16().flat_map(u16::to_le_bytes).collect();
    base64_encode(&bytes)
}

const B64: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/// Standard base64 with padding.
pub fn base64_encode(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let n = match chunk.len() {
            3 => (u32::from(chunk[0]) << 16) | (u32::from(chunk[1]) << 8) | u32::from(chunk[2]),
            2 => (u32::from(chunk[0]) << 16) | (u32::from(chunk[1]) << 8),
            _ => u32::from(chunk[0]) << 16,
        };
        let idx = [(n >> 18) & 63, (n >> 12) & 63, (n >> 6) & 63, n & 63];
        for (i, &k) in idx.iter().enumerate() {
            if i <= chunk.len() {
                out.push(B64[k as usize] as char);
            } else {
                out.push('=');
            }
        }
    }
    out
}

/// Standard base64 (padding optional); `None` for anything else.
pub fn base64_decode(text: &str) -> Option<Vec<u8>> {
    let text = text.trim_end_matches('=');
    let mut out = Vec::with_capacity(text.len() * 3 / 4);
    let mut acc = 0u32;
    let mut bits = 0u32;
    for b in text.bytes() {
        let v = B64.iter().position(|&c| c == b)? as u32;
        acc = (acc << 6) | v;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((acc >> bits) as u8);
            acc &= (1 << bits) - 1;
        }
    }
    Some(out)
}

/// The script behind every Windows dialog. It reads its inputs from `RPX_*` environment
/// variables and prints `PATH <base64 of UTF-8>` per chosen path, `CANCEL`, or
/// `ERROR <base64 of UTF-8>`.
pub const POWERSHELL_SCRIPT: &str = r#"$ErrorActionPreference = 'Stop'
$src = @'
using System;
using System.Runtime.InteropServices;
namespace Repackshot {
  [ComImport, Guid("DC1C5A9C-E88A-4dde-A5A1-60F82A20AEF7")] class FileOpenDialogCom { }
  [ComImport, Guid("42f85136-db7e-439c-85f1-e4075d135fc8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IFileDialog {
    [PreserveSig] int Show(IntPtr owner);
    void SetFileTypes(uint count, IntPtr specs);
    void SetFileTypeIndex(uint index);
    void GetFileTypeIndex(out uint index);
    void Advise(IntPtr events, out uint cookie);
    void Unadvise(uint cookie);
    void SetOptions(uint options);
    void GetOptions(out uint options);
    void SetDefaultFolder(IShellItem item);
    void SetFolder(IShellItem item);
    void GetFolder(out IShellItem item);
    void GetCurrentSelection(out IShellItem item);
    void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string name);
    void GetFileName([MarshalAs(UnmanagedType.LPWStr)] out string name);
    void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string title);
    void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string text);
    void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string label);
    void GetResult(out IShellItem item);
  }
  [ComImport, Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IShellItem {
    void BindToHandler(IntPtr bc, ref Guid bhid, ref Guid riid, out IntPtr ppv);
    void GetParent(out IShellItem parent);
    void GetDisplayName(uint sigdn, [MarshalAs(UnmanagedType.LPWStr)] out string name);
  }
  public static class FolderPicker {
    [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
    static extern void SHCreateItemFromParsingName([MarshalAs(UnmanagedType.LPWStr)] string path, IntPtr bc, [MarshalAs(UnmanagedType.LPStruct)] Guid riid, out IShellItem item);
    public static string Pick(IntPtr owner, string title, string start) {
      IFileDialog d = (IFileDialog)new FileOpenDialogCom();
      uint o;
      d.GetOptions(out o);
      d.SetOptions(o | 0x20u | 0x40u | 0x800u);
      if (!String.IsNullOrEmpty(title)) d.SetTitle(title);
      if (!String.IsNullOrEmpty(start)) {
        try { IShellItem s; SHCreateItemFromParsingName(start, IntPtr.Zero, typeof(IShellItem).GUID, out s); d.SetFolder(s); } catch (Exception) { }
      }
      if (d.Show(owner) != 0) return null;
      IShellItem r;
      d.GetResult(out r);
      string p;
      r.GetDisplayName(0x80058000u, out p);
      return p;
    }
  }
}
'@
function Say([string]$tag, [string]$text) {
  [Console]::Out.WriteLine($tag + ' ' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($text)))
}
$form = $null
try {
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing
  [System.Windows.Forms.Application]::EnableVisualStyles()
  $kind = $env:RPX_KIND
  $title = $env:RPX_TITLE
  $start = $env:RPX_START
  if ($start -and -not (Test-Path -LiteralPath $start -PathType Container)) { $start = '' }
  if ($env:RPX_OWNER) {
    $owner = New-Object System.Windows.Forms.NativeWindow
    $owner.AssignHandle([IntPtr][Int64]$env:RPX_OWNER)
  } else {
    $form = New-Object System.Windows.Forms.Form
    $form.TopMost = $true
    $form.ShowInTaskbar = $false
    $form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None
    $form.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen
    $form.Size = New-Object System.Drawing.Size(1, 1)
    $form.Opacity = 0
    $form.Show()
    $form.Activate()
    $owner = $form
  }
  $ok = [System.Windows.Forms.DialogResult]::OK
  $paths = @()
  if ($kind -eq 'folder') {
    $modern = $false
    try {
      if (-not ('Repackshot.FolderPicker' -as [type])) {
        $dll = $env:RPX_CACHE
        $loaded = $false
        if ($dll -and (Test-Path -LiteralPath $dll)) {
          try { Add-Type -LiteralPath $dll; $loaded = $true } catch { $loaded = $false }
        }
        if (-not $loaded -and $dll) {
          try {
            $folder = Split-Path -Parent $dll
            if (-not (Test-Path -LiteralPath $folder)) { New-Item -ItemType Directory -Path $folder | Out-Null }
            Add-Type -TypeDefinition $src -Language CSharp -OutputAssembly $dll -OutputType Library
            Add-Type -LiteralPath $dll
            $loaded = $true
          } catch { $loaded = $false }
        }
        if (-not $loaded) { Add-Type -TypeDefinition $src -Language CSharp }
      }
      $picked = [Repackshot.FolderPicker]::Pick($owner.Handle, $title, $start)
      $modern = $true
      if ($picked) { $paths = @($picked) }
    } catch { $modern = $false }
    if (-not $modern) {
      $d = New-Object System.Windows.Forms.OpenFileDialog
      $d.Title = $title
      $d.ValidateNames = $false
      $d.CheckFileExists = $false
      $d.CheckPathExists = $true
      $d.FileName = $env:RPX_FOLDER_ITEM
      if ($start) { $d.InitialDirectory = $start }
      if ($d.ShowDialog($owner) -eq $ok) { $paths = @([System.IO.Path]::GetDirectoryName($d.FileName)) }
    }
  } elseif ($kind -eq 'open') {
    $d = New-Object System.Windows.Forms.OpenFileDialog
    $d.Title = $title
    $d.Filter = $env:RPX_FILTER
    $d.Multiselect = ($env:RPX_MULTI -eq '1')
    $d.CheckFileExists = $true
    if ($start) { $d.InitialDirectory = $start }
    if ($d.ShowDialog($owner) -eq $ok) { $paths = @($d.FileNames) }
  } elseif ($kind -eq 'save') {
    $d = New-Object System.Windows.Forms.SaveFileDialog
    $d.Title = $title
    $d.Filter = $env:RPX_FILTER
    $d.FileName = $env:RPX_NAME
    $d.OverwritePrompt = $true
    $d.AddExtension = $true
    if ($env:RPX_EXT) { $d.DefaultExt = $env:RPX_EXT }
    if ($start) { $d.InitialDirectory = $start }
    if ($d.ShowDialog($owner) -eq $ok) { $paths = @($d.FileName) }
  } else {
    throw ('unknown dialog: ' + $kind)
  }
  if ($paths.Count -gt 0) {
    foreach ($p in $paths) { Say 'PATH' $p }
  } else {
    [Console]::Out.WriteLine('CANCEL')
  }
} catch {
  Say 'ERROR' $_.Exception.Message
  exit 3
} finally {
  if ($form -ne $null) { $form.Close(); $form.Dispose() }
}
"#;

#[cfg(test)]
mod tests {
    use super::*;

    /// An absolute path of this system for a Unix-style one: `/home/a` itself, `C:\home\a` on
    /// Windows (where `/home/a` is not absolute). The zenity and kdialog code runs on Linux only,
    /// but its tests run on every target, so their paths must be absolute on each.
    fn abs(unix: &str) -> PathBuf {
        if cfg!(windows) {
            PathBuf::from(format!("C:{}", unix.replace('/', "\\")))
        } else {
            PathBuf::from(unix)
        }
    }

    fn abs_s(unix: &str) -> String {
        abs(unix).to_string_lossy().into_owned()
    }

    fn req(kind: Kind) -> Request {
        Request {
            kind,
            title: "Choose\u{7} the folder".into(),
            filters: vec![
                Filter {
                    name: "Repackshot project|x".into(),
                    extensions: vec!["repack".into(), "repack.json".into()],
                },
                Filter {
                    name: "All files".into(),
                    extensions: vec!["*".into()],
                },
            ],
            start: Some(abs("/home/a/Renders")),
            folder_item: "Folder selection".into(),
        }
    }

    fn strings(args: Vec<OsString>) -> Vec<String> {
        args.into_iter()
            .map(|a| a.to_string_lossy().into_owned())
            .collect()
    }

    #[test]
    fn base64_round_trips() {
        for (raw, enc) in [
            (&b""[..], ""),
            (b"f", "Zg=="),
            (b"fo", "Zm8="),
            (b"foo", "Zm9v"),
            (b"foob", "Zm9vYg=="),
            (b"fooba", "Zm9vYmE="),
            (b"foobar", "Zm9vYmFy"),
        ] {
            assert_eq!(base64_encode(raw), enc);
            assert_eq!(base64_decode(enc).unwrap(), raw);
        }
        assert_eq!(base64_decode("Zm9v!"), None);
        // -EncodedCommand is UTF-16LE: "a" is 61 00.
        assert_eq!(encoded_command("a"), "YQA=");
    }

    #[test]
    fn texts_and_extensions_are_checked() {
        assert_eq!(clean_text("  a\u{0}b\nc  "), "abc");
        assert_eq!(clean_text(&"x".repeat(500)).len(), MAX_TEXT);
        for ok in ["png", "repack", "repack.json", "*", "c++", "glb"] {
            assert!(valid_extension(ok), "{ok}");
        }
        for bad in [
            "",
            ".png",
            "png.",
            "a b",
            "a/b",
            "a\\b",
            "a;b",
            "a|b",
            &"x".repeat(40),
        ] {
            assert!(!valid_extension(bad), "{bad}");
        }
    }

    #[test]
    fn zenity_and_kdialog_command_lines() {
        let folder = strings(zenity_args(&req(Kind::Folder)));
        assert_eq!(folder[0], "--file-selection");
        assert!(folder.contains(&"--directory".to_string()));
        assert!(folder.contains(&"--title=Choose the folder".to_string()));
        // The folder with a trailing separator: zenity starts inside it.
        let sep = std::path::MAIN_SEPARATOR;
        assert!(folder.contains(&format!("--filename={}{sep}", abs_s("/home/a/Renders"))));
        assert!(!folder.iter().any(|a| a.starts_with("--file-filter")));
        let open = strings(zenity_args(&req(Kind::Open { multiple: true })));
        assert!(open.contains(&"--multiple".to_string()));
        assert!(open.contains(&"--separator=\n".to_string()));
        assert!(open.contains(
            &"--file-filter=Repackshot project x | *.repack *.REPACK *.repack.json *.REPACK.JSON"
                .to_string()
        ));
        assert!(open.contains(&"--file-filter=All files | *".to_string()));
        let save = strings(zenity_args(&req(Kind::Save {
            default_name: "bottle.repack".into(),
        })));
        assert!(save.contains(&"--save".to_string()));
        assert!(save.contains(&format!(
            "--filename={}",
            abs_s("/home/a/Renders/bottle.repack")
        )));

        let k = strings(kdialog_args(&req(Kind::Open { multiple: true })));
        assert_eq!(&k[..2], &["--title", "Choose the folder"]);
        assert_eq!(k[2], "--getopenfilename");
        assert_eq!(k[3], abs_s("/home/a/Renders"));
        assert_eq!(
            k[4],
            "*.repack *.REPACK *.repack.json *.REPACK.JSON|Repackshot project x\n*|All files"
        );
        assert!(k.ends_with(&["--multiple".to_string(), "--separate-output".to_string()]));
        let k = strings(kdialog_args(&req(Kind::Save {
            default_name: "a.png".into(),
        })));
        assert_eq!(k[2], "--getsavefilename");
        assert_eq!(k[3], abs_s("/home/a/Renders/a.png"));
        let k = strings(kdialog_args(&req(Kind::Folder)));
        assert_eq!(
            &k[2..],
            &[
                "--getexistingdirectory".to_string(),
                abs_s("/home/a/Renders")
            ]
        );
    }

    #[test]
    fn outputs_are_read() {
        let r = req(Kind::Open { multiple: true });
        assert_eq!(
            parse_zenity(
                format!("{}\n{}\n", abs_s("/a/b.glb"), abs_s("/a/c d.obj")).as_bytes(),
                Some(0),
                "",
                &r
            ),
            Ok(Outcome::Chosen(vec![abs("/a/b.glb"), abs("/a/c d.obj")]))
        );
        let single = req(Kind::Folder);
        assert_eq!(
            parse_zenity(
                format!("{}\n{}\n", abs_s("/a"), abs_s("/b")).as_bytes(),
                Some(0),
                "",
                &single
            ),
            Ok(Outcome::Chosen(vec![abs("/a")]))
        );
        assert_eq!(parse_zenity(b"", Some(1), "", &r), Ok(Outcome::Cancelled));
        // A relative answer is not a choice.
        assert_eq!(
            parse_zenity(b"x\n", Some(0), "", &r),
            Ok(Outcome::Cancelled)
        );
        assert!(matches!(
            parse_zenity(b"", Some(255), "boom", &r),
            Err(DialogError::Failed(m)) if m.contains("boom")
        ));
        assert_eq!(parse_kdialog(b"", Some(1), "", &r), Ok(Outcome::Cancelled));

        let path = "C:\\Users\\José\\Imágenes";
        let out = format!("PATH {}\r\n", base64_encode(path.as_bytes()));
        assert_eq!(
            parse_powershell(out.as_bytes(), Some(0), ""),
            Ok(Outcome::Chosen(vec![PathBuf::from(path)]))
        );
        assert_eq!(
            parse_powershell(b"CANCEL\r\n", Some(0), ""),
            Ok(Outcome::Cancelled)
        );
        let err = format!("ERROR {}\n", base64_encode(b"no forms"));
        assert!(matches!(
            parse_powershell(err.as_bytes(), Some(3), ""),
            Err(DialogError::Failed(m)) if m.contains("no forms")
        ));
        assert!(parse_powershell(b"", Some(1), "").is_err());
    }

    #[test]
    fn the_script_gets_its_inputs_as_data() {
        let r = req(Kind::Save {
            default_name: "x'; Remove-Item C:\\ -Recurse; '.png".into(),
        });
        let env = powershell_env(&r, 0x1234, Some(PathBuf::from("/d/cache")));
        let get = |k: &str| {
            env.iter()
                .find(|(n, _)| n == k)
                .map(|(_, v)| v.to_string_lossy().into_owned())
                .unwrap()
        };
        assert_eq!(get("RPX_KIND"), "save");
        assert_eq!(get("RPX_NAME"), "x'; Remove-Item C:\\ -Recurse; '.png");
        assert_eq!(
            get("RPX_FILTER"),
            "Repackshot project x|*.repack;*.repack.json|All files|*.*"
        );
        // A bare name in the save dialog gets the first extension.
        assert_eq!(get("RPX_EXT"), "repack");
        assert_eq!(get("RPX_OWNER"), "4660");
        assert!(get("RPX_CACHE").ends_with(&format!("folder-picker-{FOLDER_PICKER_VERSION}.dll")));
        // The page's words never become part of the script itself.
        assert!(!POWERSHELL_SCRIPT.contains("Remove-Item"));
        assert_eq!(get("RPX_MULTI"), "0");
        assert_eq!(
            powershell_env(&req(Kind::Folder), 0, None)
                .iter()
                .find(|(n, _)| n == "RPX_OWNER")
                .map(|(_, v)| v.is_empty()),
            Some(true)
        );
        // The encoded script fits a Windows command line (32767 characters) with room to spare.
        assert!(encoded_command(POWERSHELL_SCRIPT).len() < 24_000);
    }

    #[cfg(unix)]
    #[test]
    fn runs_a_dialog_program_and_refuses_a_second_one() {
        use std::os::unix::fs::PermissionsExt;
        let dir = crate::test_dir("dialogs-fake");
        let fake = dir.join("zenity");
        std::fs::write(
            &fake,
            "#!/bin/sh\nfor a in \"$@\"; do echo \"$a\" >> \"$0.args\"; done\nsleep 0.3\necho /picked/folder\n",
        )
        .unwrap();
        std::fs::set_permissions(&fake, std::fs::Permissions::from_mode(0o755)).unwrap();
        let d = std::sync::Arc::new(Dialogs::new());
        d.use_backend(Backend::Zenity(fake.clone()));
        let d2 = std::sync::Arc::clone(&d);
        let first = std::thread::spawn(move || d2.show(&req(Kind::Folder)));
        std::thread::sleep(Duration::from_millis(100));
        assert_eq!(d.show(&req(Kind::Folder)), Err(DialogError::Busy));
        assert_eq!(
            first.join().unwrap(),
            Ok(Outcome::Chosen(vec![PathBuf::from("/picked/folder")]))
        );
        let args = std::fs::read_to_string(dir.join("zenity.args")).unwrap();
        assert!(args.contains("--directory"));
        // Closing the application closes an open dialog.
        std::fs::write(&fake, "#!/bin/sh\nsleep 30\necho /late\n").unwrap();
        let d3 = std::sync::Arc::clone(&d);
        let slow = std::thread::spawn(move || d3.show(&req(Kind::Folder)));
        std::thread::sleep(Duration::from_millis(200));
        let t0 = std::time::Instant::now();
        d.close_all();
        assert!(slow.join().unwrap().is_err());
        assert!(t0.elapsed() < Duration::from_secs(5));
        assert!(d.show(&req(Kind::Folder)).is_err());
    }
}
