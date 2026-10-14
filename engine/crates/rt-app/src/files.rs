//! Files the person chose: the system's dialogs (`POST /api/dialog/*`) and the file API
//! (`/api/files*`, `/api/projects/last`, `/api/open-url`), so the desktop window never needs the
//! browser's file pickers, downloads or permission prompts.
//!
//! **Security model.** The page never names a path the launcher then reads or writes. Every path
//! the file API touches is one the person chose in a system dialog of this launch, kept here as a
//! **grant**: an id (a hash of the path, so the same folder chosen again gets the same id) with
//! what it allows:
//!
//! * a folder from `POST /api/dialog/folder`: create **new** files in it (`PUT /api/files?dir=`,
//!   never overwriting: `name (2).png`), and, when asked for an import (`read`), list and read
//!   the files under it;
//! * files from `POST /api/dialog/open`: read them (streamed, with `Range`); write them in place
//!   only when the dialog was asked `writable` (a project to save again) and the extension is one
//!   the application writes;
//! * a file from `POST /api/dialog/save`: write it (atomically: a temporary file renamed over).
//!
//! Two entries are the launcher's own, not the page's: `downloads`, the system's Downloads folder
//! (create new files only: the render window's *Downloads*), and the last project file, which the
//! launcher itself remembers in its data folder after a project was opened or saved through a
//! dialog (`/api/projects/last`, General ▸ On start ▸ Last project). Written files must have an
//! extension the application produces ([`WRITABLE_EXTENSIONS`]), so nothing executable can be
//! dropped anywhere, and names are made safe for every system ([`safe_name`]). Nothing outside a
//! grant is readable or writable; `/api/open-url` opens only `https://` addresses in the
//! system's browser.

use crate::dialogs::{self, DialogError, Filter, Kind, Outcome};
use crate::http::{Request, Response};
use crate::json::{self, Value};
use crate::server::App;
use crate::sha256::Sha256;
use std::collections::HashMap;
use std::fs::{File, OpenOptions};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard, PoisonError};

/// Extensions the file API writes: what the application produces (images, scenes, projects,
/// libraries, videos).
pub const WRITABLE_EXTENSIONS: [&str; 11] = [
    "png", "jpg", "jpeg", "exr", "tif", "tiff", "dng", "json", "rsb", "mp4", "webm",
];

/// The id of the system's Downloads folder.
pub const DOWNLOADS: &str = "downloads";

/// Most files a folder import lists.
pub const MAX_LISTED: usize = 4096;

/// Most numbered names tried (`name (2).png` ... `name (999).png`).
pub const MAX_NUMBERED: u32 = 999;

/// The extension of a project file.
pub const PROJECT_EXTENSION: &str = ".repack.json";

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(PoisonError::into_inner)
}

/// A path the person chose, and what it allows.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Grant {
    /// Its id in the API.
    pub id: String,
    /// The path used for reading and writing (canonical).
    pub path: PathBuf,
    /// The path as the person reads it (without Windows' `\\?\`).
    pub shown: PathBuf,
    /// A folder (else a file).
    pub folder: bool,
    /// Its files can be read (a file: itself).
    pub read: bool,
    /// New files can be created in it (a folder), or it can be written (a file).
    pub write: bool,
}

impl Grant {
    /// The last component of the path.
    pub fn name(&self) -> String {
        self.shown
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| self.shown.to_string_lossy().into_owned())
    }

    /// The grant as JSON: `{id, name, path, folder, read, write, size}`.
    pub fn to_json(&self) -> String {
        let size = if self.folder {
            None
        } else {
            std::fs::metadata(&self.path).ok().map(|m| m.len() as f64)
        };
        json::Object::new()
            .str("id", &self.id)
            .str("name", &self.name())
            .str("path", &self.shown.to_string_lossy())
            .bool("folder", self.folder)
            .bool("read", self.read)
            .bool("write", self.write)
            .opt_num("size", size)
            .build()
    }
}

/// Why a file operation was refused.
#[derive(Debug)]
pub enum FileError {
    /// No grant with that id in this launch: 404.
    NotGranted,
    /// The grant does not allow it: 403.
    Forbidden(&'static str),
    /// The name cannot be used: 400.
    BadName,
    /// Every numbered name is taken: 409.
    Taken,
    /// The body was shorter than announced: 400.
    ShortBody,
    /// The system refused.
    Io(io::Error),
}

impl From<io::Error> for FileError {
    fn from(e: io::Error) -> Self {
        FileError::Io(e)
    }
}

/// The HTTP answer to a [`FileError`].
pub fn file_error(e: FileError) -> Response {
    match e {
        FileError::NotGranted => Response::error(
            404,
            "not-granted",
            "no such file or folder chosen in this launch",
        ),
        FileError::Forbidden(m) => Response::error(403, "forbidden", m),
        FileError::BadName => Response::error(400, "bad-name", "the name cannot be used"),
        FileError::Taken => Response::error(409, "taken", "every numbered name is taken"),
        FileError::ShortBody => Response::error(400, "bad-body", "short body"),
        FileError::Io(e) if e.kind() == io::ErrorKind::StorageFull => {
            Response::error(507, "disk-full", "not enough space on the disk")
        }
        FileError::Io(e) if e.kind() == io::ErrorKind::NotFound => {
            Response::error(410, "gone", &e.to_string())
        }
        FileError::Io(e) if e.kind() == io::ErrorKind::PermissionDenied => {
            Response::error(403, "denied", &e.to_string())
        }
        FileError::Io(e) => Response::error(500, "io", &e.to_string()),
    }
}

/// The lower-case extension of a name (after the last dot), if any.
pub fn extension(name: &str) -> Option<String> {
    let (stem, ext) = name.rsplit_once('.')?;
    (!stem.is_empty() && !ext.is_empty()).then(|| ext.to_ascii_lowercase())
}

/// True when the application writes files with this name's extension.
pub fn writable_name(name: &str) -> bool {
    extension(name).is_some_and(|e| WRITABLE_EXTENSIONS.contains(&e.as_str()))
}

/// A file name that is safe on every system: characters Windows forbids (`\ / : * ? " < > |`)
/// and control characters become `_`, trailing dots and spaces go, Windows' device names (`CON`,
/// `NUL`, `COM1`...) get a `_` in front, at most 200 bytes (the extension kept). `None` when
/// nothing usable is left.
pub fn safe_name(name: &str) -> Option<String> {
    let mut s: String = name
        .chars()
        .map(|c| {
            if c.is_control() || "\\/:*?\"<>|".contains(c) {
                '_'
            } else {
                c
            }
        })
        .collect();
    s = s.trim_start().trim_end_matches(['.', ' ']).to_string();
    if s.is_empty() || s == "." || s == ".." || s.chars().all(|c| c == '.') {
        return None;
    }
    let stem = s
        .split('.')
        .next()
        .unwrap_or("")
        .trim_end()
        .to_ascii_uppercase();
    let device = matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || ((stem.starts_with("COM") || stem.starts_with("LPT"))
            && stem.len() == 4
            && stem.as_bytes()[3].is_ascii_digit());
    if device {
        s.insert(0, '_');
    }
    if s.len() > 200 {
        let (base, ext) = match s.rsplit_once('.') {
            Some((b, e)) if e.len() <= 16 && !b.is_empty() => (b.to_string(), format!(".{e}")),
            _ => (s.clone(), String::new()),
        };
        let mut cut = 200 - ext.len();
        while !base.is_char_boundary(cut) {
            cut -= 1;
        }
        s = format!("{}{ext}", &base[..cut]);
    }
    Some(s)
}

/// `name (2).ext`, `name (3).ext`... (k = 1 is the name itself). A double extension such as
/// `.repack.json` stays whole.
pub fn numbered(name: &str, k: u32) -> String {
    if k <= 1 {
        return name.to_string();
    }
    let lower = name.to_ascii_lowercase();
    let split = if lower.ends_with(PROJECT_EXTENSION) && name.len() > PROJECT_EXTENSION.len() {
        Some(name.len() - PROJECT_EXTENSION.len())
    } else {
        name.rfind('.').filter(|&i| i > 0)
    };
    match split {
        Some(i) => format!("{} ({k}){}", &name[..i], &name[i..]),
        None => format!("{name} ({k})"),
    }
}

/// The grant id of a path: `d…` for a folder, `f…` for a file, then 24 hexadecimal digits of the
/// SHA-256 of the path (the same path gets the same id in every launch; the id gives nothing
/// away and grants nothing by itself).
pub fn grant_id(folder: bool, path: &Path) -> String {
    let mut h = Sha256::new();
    h.update(if folder { b"folder\0" } else { b"file\0\0\0" });
    h.update(path.to_string_lossy().as_bytes());
    let hex = crate::sha256::hex(&h.finish());
    format!("{}{}", if folder { 'd' } else { 'f' }, &hex[..24])
}

/// The grants of this launch.
pub struct Files {
    grants: Mutex<HashMap<String, Grant>>,
    hashing: Mutex<HashMap<String, (u64, u64)>>,
    last_project: PathBuf,
    downloads: Mutex<Option<PathBuf>>,
}

impl Files {
    /// No grants yet; the last project is remembered in `<data>/last-project.json`.
    pub fn new(data_dir: &Path) -> Files {
        Files {
            grants: Mutex::new(HashMap::new()),
            hashing: Mutex::new(HashMap::new()),
            last_project: data_dir.join("last-project.json"),
            downloads: Mutex::new(None),
        }
    }

    /// Uses this folder as the Downloads folder (tests; a portable copy could too).
    pub fn set_downloads_dir(&self, dir: PathBuf) {
        *lock(&self.downloads) = Some(dir);
    }

    /// Grants `path` (a folder or a file; a file to be created needs its folder to exist). A
    /// path granted again keeps the larger permissions.
    pub fn grant(&self, path: &Path, folder: bool, read: bool, write: bool) -> io::Result<Grant> {
        let real = if folder || path.exists() {
            path.canonicalize()?
        } else {
            let parent = path
                .parent()
                .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "no folder"))?;
            let name = path
                .file_name()
                .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "no name"))?;
            parent.canonicalize()?.join(name)
        };
        let meta = std::fs::metadata(&real);
        match (&meta, folder) {
            (Ok(m), true) if !m.is_dir() => {
                return Err(io::Error::new(io::ErrorKind::InvalidInput, "not a folder"))
            }
            (Ok(m), false) if !m.is_file() => {
                return Err(io::Error::new(io::ErrorKind::InvalidInput, "not a file"))
            }
            (Err(e), true) => return Err(io::Error::new(e.kind(), e.to_string())),
            _ => {}
        }
        let shown = crate::paths::simplify(real.clone());
        let id = grant_id(folder, &shown);
        let mut grants = lock(&self.grants);
        let g = grants.entry(id.clone()).or_insert_with(|| Grant {
            id,
            path: real,
            shown,
            folder,
            read: false,
            write: false,
        });
        g.read |= read;
        g.write |= write;
        Ok(g.clone())
    }

    /// The grant `id`; `downloads` is the system's Downloads folder (created if missing).
    pub fn get(&self, id: &str) -> Option<Grant> {
        if id == DOWNLOADS {
            let dir = lock(&self.downloads).clone().or_else(downloads_dir)?;
            std::fs::create_dir_all(&dir).ok()?;
            let real = dir.canonicalize().ok()?;
            return Some(Grant {
                id: DOWNLOADS.into(),
                shown: crate::paths::simplify(real.clone()),
                path: real,
                folder: true,
                read: false,
                write: true,
            });
        }
        lock(&self.grants).get(id).cloned()
    }

    fn need(&self, id: &str) -> Result<Grant, FileError> {
        self.get(id).ok_or(FileError::NotGranted)
    }

    /// Creates a new file in the folder `dir` from `len` bytes of `body`: `name`, or
    /// `name (2)`... when taken (never an overwrite). Returns the new file's grant (it can be
    /// shown in the file manager, not read or written).
    pub fn write_new(
        &self,
        dir: &str,
        name: &str,
        len: u64,
        body: &mut dyn Read,
    ) -> Result<Grant, FileError> {
        let folder = self.need(dir)?;
        if !folder.folder || !folder.write {
            return Err(FileError::Forbidden("files cannot be created there"));
        }
        let name = safe_name(name).ok_or(FileError::BadName)?;
        if !writable_name(&name) {
            return Err(FileError::Forbidden(
                "the application does not write that kind of file",
            ));
        }
        for k in 1..=MAX_NUMBERED {
            let path = folder.path.join(numbered(&name, k));
            let mut file = match OpenOptions::new().write(true).create_new(true).open(&path) {
                Ok(f) => f,
                Err(e) if e.kind() == io::ErrorKind::AlreadyExists => continue,
                Err(e) => return Err(e.into()),
            };
            let copied = io::copy(&mut body.take(len), &mut file);
            let complete = matches!(copied, Ok(n) if n == len) && file.flush().is_ok();
            drop(file);
            if !complete {
                let _ = std::fs::remove_file(&path);
                return Err(match copied {
                    Err(e) => FileError::Io(e),
                    Ok(_) => FileError::ShortBody,
                });
            }
            let real = path.canonicalize()?;
            let shown = crate::paths::simplify(real.clone());
            let g = Grant {
                id: grant_id(false, &shown),
                path: real,
                shown,
                folder: false,
                read: false,
                write: false,
            };
            lock(&self.grants)
                .entry(g.id.clone())
                .or_insert_with(|| g.clone());
            return Ok(g);
        }
        Err(FileError::Taken)
    }

    /// Writes the file `id` with `len` bytes of `body`: into a temporary file next to it, renamed
    /// over it once complete, so a failed save never leaves half a file.
    pub fn write_over(&self, id: &str, len: u64, body: &mut dyn Read) -> Result<Grant, FileError> {
        let g = self.need(id)?;
        if g.folder || !g.write {
            return Err(FileError::Forbidden("this file cannot be written"));
        }
        if !writable_name(&g.name()) {
            return Err(FileError::Forbidden(
                "the application does not write that kind of file",
            ));
        }
        let dir = g
            .path
            .parent()
            .ok_or(FileError::Forbidden("no folder"))?
            .to_path_buf();
        let tmp = dir.join(format!(
            ".{}.{}.repackshot-part",
            g.name(),
            &crate::token::generate()[..8]
        ));
        let mut file = OpenOptions::new().write(true).create_new(true).open(&tmp)?;
        let copied = io::copy(&mut body.take(len), &mut file);
        let complete = matches!(copied, Ok(n) if n == len) && file.sync_all().is_ok();
        drop(file);
        if !complete {
            let _ = std::fs::remove_file(&tmp);
            return Err(match copied {
                Err(e) => FileError::Io(e),
                Ok(_) => FileError::ShortBody,
            });
        }
        if let Err(e) = std::fs::rename(&tmp, &g.path) {
            let _ = std::fs::remove_file(&tmp);
            return Err(e.into());
        }
        Ok(g)
    }

    /// The readable file `id`.
    pub fn readable(&self, id: &str) -> Result<Grant, FileError> {
        let g = self.need(id)?;
        if g.folder || !g.read {
            return Err(FileError::Forbidden("this file cannot be read"));
        }
        Ok(g)
    }

    /// The files under the readable folder `id` (regular files only, symbolic links skipped, at
    /// most [`MAX_LISTED`], eight levels deep), each with a read grant and its path relative to
    /// the folder (with `/`).
    pub fn list(&self, id: &str) -> Result<Vec<(Grant, String, u64)>, FileError> {
        let g = self.need(id)?;
        if !g.folder || !g.read {
            return Err(FileError::Forbidden("this folder cannot be read"));
        }
        let mut found = Vec::new();
        let mut stack = vec![(g.path.clone(), String::new(), 0usize)];
        while let Some((dir, rel, depth)) = stack.pop() {
            let mut entries: Vec<_> = std::fs::read_dir(&dir)?.filter_map(Result::ok).collect();
            entries.sort_by_key(std::fs::DirEntry::file_name);
            for e in entries {
                let Ok(meta) = std::fs::symlink_metadata(e.path()) else {
                    continue;
                };
                let name = e.file_name().to_string_lossy().into_owned();
                let child_rel = if rel.is_empty() {
                    name.clone()
                } else {
                    format!("{rel}/{name}")
                };
                if meta.is_dir() && depth < 8 {
                    stack.push((e.path(), child_rel, depth + 1));
                } else if meta.is_file() {
                    found.push((e.path(), child_rel, meta.len()));
                }
                if found.len() >= MAX_LISTED {
                    break;
                }
            }
            if found.len() >= MAX_LISTED {
                break;
            }
        }
        found.sort_by(|a, b| a.1.cmp(&b.1));
        let mut out = Vec::new();
        for (path, rel, size) in found {
            out.push((self.grant(&path, false, true, false)?, rel, size));
        }
        Ok(out)
    }

    /// The SHA-256 of the readable file `id`, computed in streaming (progress in
    /// [`Files::progress`] meanwhile).
    pub fn sha256(&self, id: &str) -> Result<(String, u64), FileError> {
        let g = self.readable(id)?;
        let mut file = File::open(&g.path)?;
        let total = file.metadata()?.len();
        lock(&self.hashing).insert(id.to_string(), (0, total));
        let mut h = Sha256::new();
        let mut buf = vec![0u8; 1 << 20];
        let mut done = 0u64;
        let result = loop {
            match file.read(&mut buf) {
                Ok(0) => break Ok(()),
                Ok(n) => {
                    h.update(&buf[..n]);
                    done += n as u64;
                    if let Some(p) = lock(&self.hashing).get_mut(id) {
                        p.0 = done;
                    }
                }
                Err(e) if e.kind() == io::ErrorKind::Interrupted => {}
                Err(e) => break Err(e),
            }
        };
        lock(&self.hashing).remove(id);
        result?;
        Ok((crate::sha256::hex(&h.finish()), done))
    }

    /// `(done, total)` while `sha256` reads the file `id`.
    pub fn progress(&self, id: &str) -> Option<(u64, u64)> {
        lock(&self.hashing).get(id).copied()
    }

    /// Remembers the project file `id` (a file of this launch's dialogs, ending in
    /// `.repack.json`) as the last one.
    pub fn set_last_project(&self, id: &str) -> Result<(), FileError> {
        let g = self.need(id)?;
        if g.folder || !g.name().to_ascii_lowercase().ends_with(PROJECT_EXTENSION) {
            return Err(FileError::Forbidden("not a project file"));
        }
        let text = json::Object::new()
            .str("path", &g.path.to_string_lossy())
            .build();
        if let Some(dir) = self.last_project.parent() {
            std::fs::create_dir_all(dir)?;
        }
        std::fs::write(&self.last_project, text)?;
        Ok(())
    }

    /// The last project file the launcher remembers, granted again (read and write), when it is
    /// still there.
    pub fn last_project(&self) -> Option<Grant> {
        let text = std::fs::read_to_string(&self.last_project).ok()?;
        let path = PathBuf::from(json::parse(&text).ok()?.get("path")?.as_str()?);
        let name = path.file_name()?.to_string_lossy().to_ascii_lowercase();
        if !name.ends_with(PROJECT_EXTENSION) || !path.is_file() {
            return None;
        }
        self.grant(&path, false, true, true).ok()
    }
}

/// The system's Downloads folder: on Windows the *Downloads* known folder from the registry
/// (`User Shell Folders`, which follows a moved folder), else `%USERPROFILE%\Downloads`; on
/// Linux `XDG_DOWNLOAD_DIR` (the environment, then `user-dirs.dirs`), else `~/Downloads`.
pub fn downloads_dir() -> Option<PathBuf> {
    if cfg!(windows) {
        let key = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders";
        let text = crate::process::output(
            crate::process::command(
                crate::process::system32(&["reg.exe"]),
                &["query", key, "/v", "{374DE290-123F-4565-9164-39C4925E467B}"],
            ),
            std::time::Duration::from_secs(5),
        );
        if let Some(p) = text.as_deref().and_then(|t| {
            t.lines()
                .filter_map(crate::hardware::parse_reg_value)
                .map(|(_, _, data)| PathBuf::from(crate::browser::expand(data.trim())))
                .find(|p| p.is_absolute())
        }) {
            return Some(p);
        }
        return std::env::var_os("USERPROFILE").map(|h| PathBuf::from(h).join("Downloads"));
    }
    let home = std::env::var_os("HOME").map(PathBuf::from);
    if let Some(p) = std::env::var_os("XDG_DOWNLOAD_DIR")
        .map(PathBuf::from)
        .filter(|p| p.is_absolute())
    {
        return Some(p);
    }
    let config = std::env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .filter(|p| p.is_absolute())
        .or_else(|| home.as_ref().map(|h| h.join(".config")));
    if let (Some(config), Some(home)) = (&config, &home) {
        if let Ok(text) = std::fs::read_to_string(config.join("user-dirs.dirs")) {
            if let Some(p) = parse_user_dirs(&text, home) {
                return Some(p);
            }
        }
    }
    home.map(|h| h.join("Downloads"))
}

/// `XDG_DOWNLOAD_DIR="$HOME/Downloads"` from `user-dirs.dirs`.
pub fn parse_user_dirs(text: &str, home: &Path) -> Option<PathBuf> {
    let line = text
        .lines()
        .map(str::trim)
        .find(|l| l.starts_with("XDG_DOWNLOAD_DIR="))?;
    let value = line["XDG_DOWNLOAD_DIR=".len()..].trim().trim_matches('"');
    let path = match value.strip_prefix("$HOME") {
        Some(rest) => home.join(rest.trim_start_matches('/')),
        None => PathBuf::from(value),
    };
    (path.is_absolute() && path != home).then_some(path)
}

/// Shows a file (selected) or a folder in the system's file manager.
pub fn reveal(g: &Grant) -> io::Result<()> {
    if g.folder {
        return crate::browser::open_folder(&g.shown);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let shown = g.shown.to_string_lossy();
        if shown.contains('"') {
            return Err(io::Error::new(io::ErrorKind::InvalidInput, "bad path"));
        }
        let mut cmd = std::process::Command::new("explorer");
        // explorer reads `/select,"<path>"` itself; raw_arg keeps the quotes as written.
        cmd.raw_arg(format!("/select,\"{shown}\""));
        cmd.stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null());
        let mut child = cmd.spawn()?;
        std::thread::spawn(move || {
            let _ = child.wait();
        });
        Ok(())
    }
    #[cfg(not(windows))]
    {
        match g.shown.parent() {
            Some(dir) => crate::browser::open_folder(dir),
            None => Err(io::Error::new(io::ErrorKind::InvalidInput, "no folder")),
        }
    }
}

/// True for an address `/api/open-url` opens: `https://`, at most 2048 characters, nothing a
/// command line or a shell could read as more than one argument.
pub fn openable_url(url: &str) -> bool {
    url.len() <= 2048
        && url.starts_with("https://")
        && url.len() > "https://".len()
        && url
            .bytes()
            .all(|b| b.is_ascii_graphic() && !b"\"'<>\\^`{|}".contains(&b))
}

/// Opens an `https://` address in the system's browser.
pub fn open_url(url: &str) -> io::Result<()> {
    if !openable_url(url) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "not an https address",
        ));
    }
    let mut cmd = if cfg!(windows) {
        // The URL protocol handler, without cmd.exe in between.
        let mut c = std::process::Command::new("rundll32");
        c.arg("url.dll,FileProtocolHandler").arg(url);
        c
    } else {
        let mut c = std::process::Command::new("xdg-open");
        c.arg(url);
        c
    };
    cmd.stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    crate::process::no_window(&mut cmd);
    let mut child = cmd.spawn()?;
    std::thread::spawn(move || {
        let _ = child.wait();
    });
    Ok(())
}

// ------------------------------------------------------------------ HTTP

fn dialog_error(e: DialogError) -> Response {
    match e {
        DialogError::Busy => Response::error(409, "dialog-open", "another dialog is open"),
        DialogError::Unavailable(m) => Response::error(501, "no-dialog", &m),
        DialogError::Failed(m) => Response::error(500, "dialog-failed", &m),
    }
}

fn text_of(v: &Value, key: &str) -> String {
    v.get(key)
        .and_then(Value::as_str)
        .map(dialogs::clean_text)
        .unwrap_or_default()
}

fn filters_of(v: &Value) -> Result<Vec<Filter>, Response> {
    let Some(list) = v.get("filters") else {
        return Ok(Vec::new());
    };
    let Some(items) = list.as_array() else {
        return Err(Response::error(400, "bad-body", "filters must be an array"));
    };
    if items.len() > 16 {
        return Err(Response::error(400, "bad-body", "too many filters"));
    }
    let mut out = Vec::new();
    for f in items {
        let name = text_of(f, "name");
        let exts: Vec<String> = f
            .get("extensions")
            .and_then(Value::as_array)
            .unwrap_or(&[])
            .iter()
            .filter_map(Value::as_str)
            .map(|e| e.trim_start_matches('.').to_string())
            .collect();
        if name.is_empty()
            || exts.is_empty()
            || exts.len() > 64
            || !exts.iter().all(|e| dialogs::valid_extension(e))
        {
            return Err(Response::error(
                400,
                "bad-body",
                "a filter needs a name and valid extensions",
            ));
        }
        out.push(Filter {
            name,
            extensions: exts,
        });
    }
    Ok(out)
}

/// Where a dialog starts: a grant's folder (`start` is its id), else an absolute folder that
/// exists (only a hint for the dialog: it grants nothing).
fn start_of(app: &App, v: &Value) -> Option<PathBuf> {
    let s = v.get("start").and_then(Value::as_str)?;
    if let Some(g) = app.files.get(s) {
        return if g.folder {
            Some(g.shown)
        } else {
            g.shown.parent().map(Path::to_path_buf)
        };
    }
    let p = PathBuf::from(s);
    (p.is_absolute() && p.is_dir()).then_some(p)
}

fn dialog(app: &App, kind: &str, req: &Request, body: &mut dyn Read) -> Response {
    let v = match crate::server::read_json(req, body) {
        Ok(v) => v,
        Err(r) => return r,
    };
    let filters = match filters_of(&v) {
        Ok(f) => f,
        Err(r) => return r,
    };
    let flag = |k: &str| v.get(k).and_then(Value::as_bool);
    let request = dialogs::Request {
        kind: match kind {
            "folder" => Kind::Folder,
            "open" => Kind::Open {
                multiple: flag("multiple") == Some(true),
            },
            "save" => {
                let name = text_of(&v, "defaultName");
                Kind::Save {
                    default_name: safe_name(&name).unwrap_or_default(),
                }
            }
            _ => return Response::error(404, "not-found", "folder, open or save"),
        },
        title: text_of(&v, "title"),
        filters,
        start: start_of(app, &v),
        folder_item: text_of(&v, "folderItem"),
    };
    let paths = match app.dialogs.show(&request) {
        Ok(Outcome::Cancelled) => {
            return Response::json(200, json::Object::new().bool("cancelled", true).build())
        }
        Ok(Outcome::Chosen(p)) => p,
        Err(e) => return dialog_error(e),
    };
    let done = |grants: &[Grant]| {
        let first = grants
            .first()
            .map(Grant::to_json)
            .unwrap_or_else(|| "null".into());
        Response::json(
            200,
            json::Object::new()
                .bool("cancelled", false)
                .raw("files", &json::array(grants.iter().map(Grant::to_json)))
                .raw("file", &first)
                .build(),
        )
    };
    let refused = |e: io::Error| Response::error(400, "bad-choice", &e.to_string());
    match request.kind {
        Kind::Folder => {
            let read = flag("read") == Some(true);
            let write = flag("write") != Some(false);
            match app.files.grant(&paths[0], true, read, write) {
                Ok(g) => done(&[g]),
                Err(e) => refused(e),
            }
        }
        Kind::Open { .. } => {
            let writable = flag("writable") == Some(true);
            let mut grants = Vec::new();
            for p in &paths {
                let write = writable
                    && p.file_name()
                        .is_some_and(|n| writable_name(&n.to_string_lossy()));
                match app.files.grant(p, false, true, write) {
                    Ok(g) => grants.push(g),
                    Err(e) => return refused(e),
                }
            }
            done(&grants)
        }
        Kind::Save { .. } => {
            let name = paths[0]
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default();
            if !writable_name(&name) {
                return Response::error(
                    422,
                    "extension",
                    "the application does not write files with that extension",
                );
            }
            match app.files.grant(&paths[0], false, true, true) {
                Ok(g) => done(&[g]),
                Err(e) => refused(e),
            }
        }
    }
}

/// Answers the routes of this module (`parts` is the path after `/api/`); `None` for any other.
pub fn route(app: &App, req: &Request, parts: &[&str], body: &mut dyn Read) -> Option<Response> {
    let m = req.method.as_str();
    let ok_json = |g: &Grant| Response::json(200, g.to_json());
    Some(match (m, parts) {
        ("POST", ["dialog", kind]) => dialog(app, kind, req, body),
        ("PUT", ["files"]) => {
            let (Some(dir), Some(name)) = (req.query("dir"), req.query("name")) else {
                return Some(Response::error(
                    400,
                    "bad-query",
                    "dir=<id>&name=<file name>",
                ));
            };
            match app.files.write_new(dir, name, req.content_length, body) {
                Ok(g) => Response::json(201, g.to_json()),
                Err(e) => file_error(e),
            }
        }
        ("PUT", ["files", id]) => match app.files.write_over(id, req.content_length, body) {
            Ok(g) => ok_json(&g),
            Err(e) => file_error(e),
        },
        ("GET" | "HEAD", ["files", id]) => match app.files.readable(id) {
            Ok(g) => crate::static_files::file_response(
                &g.path,
                req,
                "application/octet-stream",
                "no-store",
            ),
            Err(e) => file_error(e),
        },
        ("GET", ["files", id, "info"]) => match app.files.get(id) {
            Some(g) => {
                let mut text = g.to_json();
                text.pop();
                let hashing = app.files.progress(id).map_or_else(
                    || "null".to_string(),
                    |(d, t)| {
                        json::Object::new()
                            .num("done", d as f64)
                            .num("total", t as f64)
                            .build()
                    },
                );
                Response::json(200, format!("{text},\"hashing\":{hashing}}}"))
            }
            None => file_error(FileError::NotGranted),
        },
        ("POST", ["files", id, "sha256"]) => match app.files.sha256(id) {
            Ok((sha, bytes)) => Response::json(
                200,
                json::Object::new()
                    .str("sha256", &sha)
                    .num("bytes", bytes as f64)
                    .build(),
            ),
            Err(e) => file_error(e),
        },
        ("GET", ["files", id, "list"]) => match app.files.list(id) {
            Ok(list) => Response::json(
                200,
                json::Object::new()
                    .raw(
                        "files",
                        &json::array(list.iter().map(|(g, rel, size)| {
                            json::Object::new()
                                .str("id", &g.id)
                                .str("name", &g.name())
                                .str("rel", rel)
                                .num("size", *size as f64)
                                .build()
                        })),
                    )
                    .build(),
            ),
            Err(e) => file_error(e),
        },
        ("POST", ["files", id, "reveal"]) => match app.files.get(id) {
            Some(g) if !g.path.exists() => {
                file_error(FileError::Io(io::Error::from(io::ErrorKind::NotFound)))
            }
            Some(g) => match reveal(&g) {
                Ok(()) => Response::empty(204),
                Err(e) => Response::error(500, "no-file-manager", &e.to_string()),
            },
            None => file_error(FileError::NotGranted),
        },
        ("GET", ["projects", "last"]) => Response::json(
            200,
            app.files
                .last_project()
                .map_or_else(|| "null".into(), |g| g.to_json()),
        ),
        ("PUT", ["projects", "last"]) => match crate::server::read_json(req, body) {
            Ok(v) => match v.get("id").and_then(Value::as_str) {
                Some(id) => match app.files.set_last_project(id) {
                    Ok(()) => Response::empty(204),
                    Err(e) => file_error(e),
                },
                None => Response::error(400, "bad-body", "expected {\"id\": ...}"),
            },
            Err(r) => r,
        },
        ("POST", ["open-url"]) => match crate::server::read_json(req, body) {
            Ok(v) => match v.get("url").and_then(Value::as_str) {
                Some(url) if openable_url(url) => match open_url(url) {
                    Ok(()) => Response::empty(204),
                    Err(e) => file_error(FileError::Io(e)),
                },
                _ => Response::error(400, "bad-url", "only https:// addresses"),
            },
            Err(r) => r,
        },
        (_, ["dialog" | "files" | "projects" | "open-url", ..]) => {
            Response::error(405, "method", "method not allowed")
        }
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_are_made_safe() {
        assert_eq!(
            safe_name("Bottle_Camera 1_0001.png").as_deref(),
            Some("Bottle_Camera 1_0001.png")
        );
        assert_eq!(
            safe_name("a/b\\c:d*e?f\"g<h>i|j.png").as_deref(),
            Some("a_b_c_d_e_f_g_h_i_j.png")
        );
        assert_eq!(safe_name("  x.png. . ").as_deref(), Some("x.png"));
        assert_eq!(safe_name("CON.png").as_deref(), Some("_CON.png"));
        assert_eq!(safe_name("com1").as_deref(), Some("_com1"));
        assert_eq!(safe_name("COM10.png").as_deref(), Some("COM10.png"));
        assert_eq!(
            safe_name("line\nbreak.png").as_deref(),
            Some("line_break.png")
        );
        for bad in ["", "   ", ".", "..", "...", " . "] {
            assert_eq!(safe_name(bad), None, "{bad:?}");
        }
        let long = format!("{}.png", "é".repeat(300));
        let s = safe_name(&long).unwrap();
        assert!(s.len() <= 200 && s.ends_with(".png"), "{}", s.len());
    }

    #[test]
    fn numbered_names_and_extensions() {
        assert_eq!(numbered("a.png", 1), "a.png");
        assert_eq!(numbered("a.png", 2), "a (2).png");
        assert_eq!(numbered("bottle.repack.json", 3), "bottle (3).repack.json");
        assert_eq!(numbered("noext", 2), "noext (2)");
        assert_eq!(numbered(".hidden", 2), ".hidden (2)");
        assert_eq!(extension("A.PNG").as_deref(), Some("png"));
        assert_eq!(extension(".png"), None);
        assert!(writable_name("x.repack.json") && writable_name("x.EXR"));
        assert!(writable_name("x.tif") && writable_name("x.TIFF") && writable_name("x.dng"));
        for bad in [
            "x.exe",
            "x.bat",
            "x.lnk",
            "x.desktop",
            "x.sh",
            "x",
            "x.png.exe",
        ] {
            assert!(!writable_name(bad), "{bad}");
        }
    }

    #[test]
    fn ids_are_stable_and_distinct() {
        let a = grant_id(true, Path::new("/a/b"));
        assert_eq!(a, grant_id(true, Path::new("/a/b")));
        assert_ne!(a, grant_id(false, Path::new("/a/b")));
        assert_ne!(a, grant_id(true, Path::new("/a/c")));
        assert!(a.starts_with('d') && a.len() == 25);
    }

    /// An absolute path of this system for a Unix-style one (`C:\home\a` on Windows, where
    /// `/home/a` is not absolute): `user-dirs.dirs` is read on Linux only, but its test runs on
    /// every target.
    fn abs(unix: &str) -> PathBuf {
        if cfg!(windows) {
            PathBuf::from(format!("C:{}", unix.replace('/', "\\")))
        } else {
            PathBuf::from(unix)
        }
    }

    #[test]
    fn user_dirs_and_urls() {
        let home = abs("/home/a");
        let home = home.as_path();
        assert_eq!(
            parse_user_dirs(
                "# x\nXDG_DESKTOP_DIR=\"$HOME/Desktop\"\nXDG_DOWNLOAD_DIR=\"$HOME/Descargas\"\n",
                home
            ),
            Some(abs("/home/a/Descargas"))
        );
        assert_eq!(
            parse_user_dirs(
                &format!("XDG_DOWNLOAD_DIR=\"{}\"", abs("/data/dl").display()),
                home
            ),
            Some(abs("/data/dl"))
        );
        // A relative folder is not one.
        assert_eq!(parse_user_dirs("XDG_DOWNLOAD_DIR=\"dl\"", home), None);
        assert_eq!(parse_user_dirs("XDG_DOWNLOAD_DIR=\"$HOME/\"", home), None);
        assert_eq!(parse_user_dirs("", home), None);
        assert!(openable_url(
            "https://polyformproject.org/licenses/noncommercial/1.0.0/"
        ));
        assert!(openable_url("https://example.org/a?b=1&c=2#d"));
        for bad in [
            "http://example.org",
            "https://",
            "file:///etc/passwd",
            "https://a b",
            "https://a\"&calc",
            "https://a|b",
            "javascript:alert(1)",
            "https://a\nb",
        ] {
            assert!(!openable_url(bad), "{bad}");
        }
        assert!(!openable_url(&format!("https://{}", "a".repeat(3000))));
    }

    #[test]
    fn grants_limit_what_can_be_read_and_written() {
        let dir = crate::test_dir("files-grants");
        let out = dir.join("out");
        std::fs::create_dir_all(&out).unwrap();
        std::fs::write(dir.join("model.glb"), b"glTF....").unwrap();
        let files = Files::new(&dir.join("data"));
        // Nothing is granted yet.
        assert!(matches!(
            files.write_new("d000", "a.png", 1, &mut &b"x"[..]),
            Err(FileError::NotGranted)
        ));
        let folder = files.grant(&out, true, false, true).unwrap();
        let a = files
            .write_new(&folder.id, "a.png", 3, &mut &b"one"[..])
            .unwrap();
        let b = files
            .write_new(&folder.id, "a.png", 3, &mut &b"two"[..])
            .unwrap();
        assert_eq!(a.name(), "a.png");
        assert_eq!(b.name(), "a (2).png");
        assert_eq!(std::fs::read(out.join("a.png")).unwrap(), b"one");
        assert_eq!(std::fs::read(out.join("a (2).png")).unwrap(), b"two");
        // A short body leaves nothing behind.
        assert!(matches!(
            files.write_new(&folder.id, "c.png", 10, &mut &b"abc"[..]),
            Err(FileError::ShortBody)
        ));
        assert!(!out.join("c.png").exists());
        // Names cannot leave the folder; executables are not written.
        let g = files
            .write_new(&folder.id, "../escape.png", 1, &mut &b"x"[..])
            .unwrap();
        assert_eq!(g.path.parent().unwrap(), out.canonicalize().unwrap());
        assert!(matches!(
            files.write_new(&folder.id, "run.bat", 1, &mut &b"x"[..]),
            Err(FileError::Forbidden(_))
        ));
        // An output folder is not readable; its new files are neither readable nor writable.
        assert!(matches!(
            files.list(&folder.id),
            Err(FileError::Forbidden(_))
        ));
        assert!(matches!(
            files.readable(&a.id),
            Err(FileError::Forbidden(_))
        ));
        assert!(matches!(
            files.write_over(&a.id, 1, &mut &b"x"[..]),
            Err(FileError::Forbidden(_))
        ));
        // A file opened for reading is read, not written.
        let model = files
            .grant(&dir.join("model.glb"), false, true, false)
            .unwrap();
        assert!(files.readable(&model.id).is_ok());
        assert!(matches!(
            files.write_over(&model.id, 1, &mut &b"x"[..]),
            Err(FileError::Forbidden(_))
        ));
        let (sha, n) = files.sha256(&model.id).unwrap();
        assert_eq!(n, 8);
        assert_eq!(sha, crate::sha256::hex(&Sha256::digest(b"glTF....")));
        // A saved file is replaced whole.
        let save = files
            .grant(&dir.join("p.repack.json"), false, true, true)
            .unwrap();
        files.write_over(&save.id, 2, &mut &b"{}"[..]).unwrap();
        files
            .write_over(&save.id, 10, &mut &b"[1,2"[..])
            .unwrap_err();
        assert_eq!(std::fs::read(dir.join("p.repack.json")).unwrap(), b"{}");
        assert!(std::fs::read_dir(&dir).unwrap().all(|e| !e
            .unwrap()
            .file_name()
            .to_string_lossy()
            .ends_with(".repackshot-part")));
        // The last project survives the launch (a new Files), and only a project file is one.
        files.set_last_project(&save.id).unwrap();
        assert!(matches!(
            files.set_last_project(&model.id),
            Err(FileError::Forbidden(_))
        ));
        let next = Files::new(&dir.join("data"));
        let last = next.last_project().unwrap();
        assert_eq!(last.id, save.id);
        assert!(last.read && last.write);
        std::fs::remove_file(dir.join("p.repack.json")).unwrap();
        assert_eq!(Files::new(&dir.join("data")).last_project(), None);
    }

    #[test]
    fn readable_folders_list_their_files_without_following_links() {
        let dir = crate::test_dir("files-list");
        std::fs::create_dir_all(dir.join("m/sub")).unwrap();
        std::fs::write(dir.join("m/a.safetensors"), b"aa").unwrap();
        std::fs::write(dir.join("m/sub/b.json"), b"b").unwrap();
        std::fs::write(dir.join("secret.txt"), b"s").unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(dir.join("secret.txt"), dir.join("m/link.txt")).unwrap();
        let files = Files::new(&dir.join("data"));
        let out_only = files.grant(&dir.join("m"), true, false, true).unwrap();
        assert!(files.list(&out_only.id).is_err());
        let g = files.grant(&dir.join("m"), true, true, false).unwrap();
        let list = files.list(&g.id).unwrap();
        let rels: Vec<&str> = list.iter().map(|(_, r, _)| r.as_str()).collect();
        assert_eq!(rels, ["a.safetensors", "sub/b.json"]);
        assert_eq!(list[0].2, 2);
        assert!(files.readable(&list[1].0.id).is_ok());
    }

    #[test]
    fn downloads_take_new_files_only() {
        let dir = crate::test_dir("files-downloads");
        let files = Files::new(&dir.join("data"));
        files.set_downloads_dir(dir.join("Downloads"));
        let g = files
            .write_new(DOWNLOADS, "x.png", 1, &mut &b"1"[..])
            .unwrap();
        files
            .write_new(DOWNLOADS, "x.png", 1, &mut &b"2"[..])
            .unwrap();
        assert_eq!(g.name(), "x.png");
        assert!(dir.join("Downloads/x (2).png").is_file());
        assert!(files.list(DOWNLOADS).is_err());
        assert!(files.readable(DOWNLOADS).is_err());
    }
}
