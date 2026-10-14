//! The page's state in the data folder (phase P3e). On the desktop the page is only the interface:
//! everything it keeps between launches is written here by the launcher, never into the browser's
//! storage of the window. (That storage would not even last: the launcher listens on a new port at
//! every launch, and a new port is a new origin, with empty storage.)
//!
//! ```text
//! <data>/settings.json              the settings document (src/core/settings.ts: {schema, settings, layout})
//! <data>/state/<name>.json          small documents of the page (downloads to resume, the migration mark...)
//! <data>/library/library.json       the user's library (U4)
//! <data>/results/index.json         the results history: {"version": 1, "results": [{id, file, type, display, ai, aiType, aiVariants, meta}]}
//! <data>/results/<id>.<ext>         a result's file as it was saved (png, jpg, exr, webp, tif)
//! <data>/results/<id>.display.png   its picture for the viewer, when the file is one a page cannot show (EXR)
//! <data>/results/<id>.ai.<n>.<ext>  the AI post-processing's variant n (1 to MAX_AI_VARIANTS), when the result went through it (X4b)
//! <data>/results/<id>.ai.<ext>      the single AI image of a result of before X4b (phase X4): read as its variant 1
//! <data>/cache/thumbs/<key>.txt     the material spheres (data URLs): a cache, freed at will
//! ```
//!
//! Every write is **atomic**: the bytes go to a temporary file next to the target, are flushed to
//! the disk, and the file is renamed over the target, so a crash or a cut request leaves the old
//! file or the new one, never half of one. **Names** are `[a-z0-9._-]` (lower case, so two names
//! never meet on a case-insensitive disk), 1 to [`MAX_NAME`] characters, not starting or ending
//! with a dot, without `..`, and never a Windows device name (`con`, `nul`, `com1`...). Every path
//! is the data folder joined with fixed folder names and one such name, and every folder on the
//! way is checked to be a real folder, not a link, so nothing planted inside leads out
//! (**confinement**). The API contract is in this crate's `README.md` (§ *Estado de la página*).

use crate::http::{Request, Response};
use crate::json::{self, Value};
use crate::paths::Paths;
use std::fs::{self, File};
use std::io::{self, Read};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, MutexGuard, PoisonError};

/// Largest settings document, small document, result record or cached thumbnail.
pub const MAX_DOC: u64 = 1 << 20;
/// Largest library (its thumbnails are data URLs).
pub const MAX_LIBRARY: u64 = 64 << 20;
/// Largest result file (a 16-bit PNG or an EXR of a big render).
pub const MAX_RESULT: u64 = 4 << 30;
/// Largest picture of a result.
pub const MAX_DISPLAY: u64 = 512 << 20;
/// Longest name.
pub const MAX_NAME: usize = 96;
/// The files a result may be, by media type, and their extension on the disk.
pub const RESULT_TYPES: [(&str, &str); 5] = [
    ("image/png", "png"),
    ("image/jpeg", "jpg"),
    ("image/x-exr", "exr"),
    ("image/webp", "webp"),
    ("image/tiff", "tif"),
];
/// Most AI variants a result keeps (`<id>.ai.<n>.<ext>`, n from 1), as the page's `MAX_VARIANTS` (X4b).
pub const MAX_AI_VARIANTS: u32 = 8;
/// Entries a measurement walks at most (a sanity bound for a folder full of files).
pub const WALK_LIMIT: u64 = 2_000_000;

const SETTINGS: &str = "settings.json";
const STATE: &str = "state";
const LIBRARY: &str = "library";
const LIBRARY_FILE: &str = "library.json";
const RESULTS: &str = "results";
const INDEX: &str = "index.json";
const CACHE: &str = "cache";
const THUMBS: &str = "thumbs";
const DISPLAY_SUFFIX: &str = ".display.png";

/// Serialises the read-modify-write of the small files (the results index above all).
static LOCK: Mutex<()> = Mutex::new(());
static TEMP: AtomicU64 = AtomicU64::new(0);

fn lock() -> MutexGuard<'static, ()> {
    LOCK.lock().unwrap_or_else(PoisonError::into_inner)
}

/// True for a name of this store (see the module's documentation).
pub fn valid_name(name: &str) -> bool {
    let b = name.as_bytes();
    (1..=MAX_NAME).contains(&b.len())
        && b[0] != b'.'
        && !name.ends_with('.')
        && !name.contains("..")
        && b.iter().all(|c| {
            c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, b'.' | b'_' | b'-')
        })
        && !windows_device(name)
}

/// `con`, `prn`, `aux`, `nul`, `com0`–`com9`, `lpt0`–`lpt9`, with any extension: Windows opens the
/// device instead of a file of that name.
fn windows_device(name: &str) -> bool {
    let stem = name.split('.').next().unwrap_or("");
    matches!(stem, "con" | "prn" | "aux" | "nul")
        || (stem.len() == 4
            && (stem.starts_with("com") || stem.starts_with("lpt"))
            && stem.as_bytes()[3].is_ascii_digit())
}

/// The extension of a result file of this media type.
pub fn result_extension(media_type: &str) -> Option<&'static str> {
    let t = media_type
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();
    RESULT_TYPES
        .iter()
        .find(|(m, _)| *m == t)
        .map(|(_, ext)| *ext)
}

fn temp_for(path: &Path) -> PathBuf {
    let mut name = path
        .file_name()
        .map(|n| n.to_os_string())
        .unwrap_or_default();
    name.push(format!(
        ".{}-{}.tmp",
        std::process::id(),
        TEMP.fetch_add(1, Ordering::Relaxed)
    ));
    path.with_file_name(name)
}

/// Writes `bytes` to `path` atomically (a temporary file, flushed, renamed over it).
pub fn write_atomic(path: &Path, bytes: &[u8]) -> io::Result<()> {
    write_atomic_from(path, bytes.len() as u64, &mut &bytes[..])
}

/// Copies exactly `len` bytes of `body` to `path` atomically. A body that ends early is an error
/// (`UnexpectedEof`) and leaves `path` as it was; the temporary file is always removed.
pub fn write_atomic_from(path: &Path, len: u64, body: &mut dyn Read) -> io::Result<()> {
    let tmp = temp_for(path);
    let result = (|| {
        let mut file = File::create(&tmp)?;
        let copied = io::copy(&mut (&mut *body).take(len), &mut file)?;
        if copied != len {
            return Err(io::Error::new(
                io::ErrorKind::UnexpectedEof,
                "the body ended early",
            ));
        }
        file.sync_all()?;
        drop(file);
        fs::rename(&tmp, path)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result
}

// ------------------------------------------------------------------ confinement

fn outside() -> Response {
    Response::error(
        403,
        "outside",
        "a link or a file is in the way: only real folders of the data folder are used",
    )
}

fn io_error(e: &io::Error) -> Response {
    match e.kind() {
        io::ErrorKind::StorageFull => {
            Response::error(507, "disk-full", "not enough space on the disk")
        }
        io::ErrorKind::UnexpectedEof => Response::error(400, "short-body", "the body ended early"),
        _ => Response::error(500, "io", &e.to_string()),
    }
}

/// `<data>/<rel...>`, every folder of it a real folder (created when `create`); `Ok(None)` when it
/// does not exist and is not to be created, `Err` (403) when a link or a file is in the way.
fn folder(data: &Path, rel: &[&str], create: bool) -> Result<Option<PathBuf>, Response> {
    if create {
        fs::create_dir_all(data).map_err(|e| io_error(&e))?;
    } else if !data.is_dir() {
        return Ok(None);
    }
    let mut dir = data.to_path_buf();
    for part in rel {
        dir.push(part);
        match fs::symlink_metadata(&dir) {
            Ok(m) if m.file_type().is_symlink() || !m.is_dir() => return Err(outside()),
            Ok(_) => {}
            Err(e) if e.kind() == io::ErrorKind::NotFound => {
                if !create {
                    return Ok(None);
                }
                match fs::create_dir(&dir) {
                    Ok(()) => {}
                    Err(e) if e.kind() == io::ErrorKind::AlreadyExists => {}
                    Err(e) => return Err(io_error(&e)),
                }
            }
            Err(e) => return Err(io_error(&e)),
        }
    }
    Ok(Some(dir))
}

/// A file in a checked folder: refused when it is a link (it would point anywhere).
fn file_in(dir: &Path, name: &str) -> Result<PathBuf, Response> {
    let path = dir.join(name);
    match fs::symlink_metadata(&path) {
        Ok(m) if m.file_type().is_symlink() || m.is_dir() => Err(outside()),
        _ => Ok(path),
    }
}

/// The path of a file to write: its folder made and checked, the file not a link.
fn target(data: &Path, rel: &[&str], name: &str) -> Result<PathBuf, Response> {
    let dir = folder(data, rel, true)?.ok_or_else(outside)?;
    file_in(&dir, name)
}

/// The path of a file to read, or `None` when it (or its folder) is not there.
fn existing(data: &Path, rel: &[&str], name: &str) -> Result<Option<PathBuf>, Response> {
    match folder(data, rel, false)? {
        None => Ok(None),
        Some(dir) => {
            let path = file_in(&dir, name)?;
            Ok(path.is_file().then_some(path))
        }
    }
}

fn remove_if_present(path: &Path) -> io::Result<()> {
    match fs::remove_file(path) {
        Err(e) if e.kind() != io::ErrorKind::NotFound => Err(e),
        _ => Ok(()),
    }
}

// ------------------------------------------------------------------ bodies

fn read_body(req: &Request, body: &mut dyn Read, limit: u64) -> Result<Vec<u8>, Response> {
    if req.content_length > limit {
        return Err(Response::error(413, "too-large", "body too large"));
    }
    let mut bytes = Vec::with_capacity(req.content_length as usize);
    (&mut *body)
        .take(req.content_length)
        .read_to_end(&mut bytes)
        .map_err(|e| io_error(&e))?;
    if bytes.len() as u64 != req.content_length {
        return Err(Response::error(400, "short-body", "the body ended early"));
    }
    Ok(bytes)
}

/// A JSON body as its text (kept as sent, so the file reads as the page wrote it) and its value.
fn read_json(
    req: &Request,
    body: &mut dyn Read,
    limit: u64,
    object: bool,
) -> Result<(String, Value), Response> {
    let bytes = read_body(req, body, limit)?;
    let text = String::from_utf8(bytes)
        .map_err(|_| Response::error(400, "bad-body", "the body is not UTF-8 text"))?;
    let value = json::parse(&text).map_err(|e| Response::error(400, "bad-json", &e.to_string()))?;
    if object && !matches!(value, Value::Object(_)) {
        return Err(Response::error(400, "bad-body", "expected a JSON object"));
    }
    Ok((text, value))
}

// ------------------------------------------------------------------ JSON documents

/// A stored JSON document, `None` when there is none. A file that is not JSON (edited by hand,
/// a disk fault) is moved aside to `<name>.corrupt` for a look and reads as none, so the page
/// starts from its factory values instead of failing.
fn read_doc(data: &Path, rel: &[&str], name: &str) -> Result<Option<String>, Response> {
    let Some(path) = existing(data, rel, name)? else {
        return Ok(None);
    };
    let text = match fs::read(&path) {
        Ok(bytes) => String::from_utf8(bytes).ok(),
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(io_error(&e)),
    };
    match text {
        Some(t) if json::parse(&t).is_ok() => Ok(Some(t)),
        _ => {
            let mut aside = path.as_os_str().to_owned();
            aside.push(".corrupt");
            let _ = fs::rename(&path, PathBuf::from(aside));
            Ok(None)
        }
    }
}

fn get_doc(data: &Path, rel: &[&str], name: &str) -> Response {
    let _guard = lock();
    match read_doc(data, rel, name) {
        Ok(Some(text)) => Response::json(200, text),
        Ok(None) => Response::json(200, "null".into()),
        Err(r) => r,
    }
}

#[allow(clippy::too_many_arguments)]
fn put_doc(
    req: &Request,
    body: &mut dyn Read,
    data: &Path,
    rel: &[&str],
    name: &str,
    limit: u64,
    object: bool,
) -> Response {
    let (text, _) = match read_json(req, body, limit, object) {
        Ok(v) => v,
        Err(r) => return r,
    };
    let _guard = lock();
    let path = match target(data, rel, name) {
        Ok(p) => p,
        Err(r) => return r,
    };
    match write_atomic(&path, text.as_bytes()) {
        Ok(()) => Response::empty(204),
        Err(e) => io_error(&e),
    }
}

fn delete_doc(data: &Path, rel: &[&str], name: &str) -> Response {
    let _guard = lock();
    match existing(data, rel, name) {
        Ok(Some(path)) => match remove_if_present(&path) {
            Ok(()) => Response::empty(204),
            Err(e) => io_error(&e),
        },
        Ok(None) => Response::empty(204),
        Err(r) => r,
    }
}

/// Every small document: `{"<name>": <value>, ...}`.
fn all_docs(data: &Path) -> Response {
    let _guard = lock();
    let dir = match folder(data, &[STATE], false) {
        Ok(Some(d)) => d,
        Ok(None) => return Response::json(200, "{}".into()),
        Err(r) => return r,
    };
    let mut names: Vec<String> = match fs::read_dir(&dir) {
        Ok(entries) => entries
            .filter_map(Result::ok)
            .filter_map(|e| e.file_name().into_string().ok())
            .filter_map(|n| n.strip_suffix(".json").map(str::to_string))
            .filter(|n| valid_name(n))
            .collect(),
        Err(e) => return io_error(&e),
    };
    names.sort();
    let mut out = json::Object::new();
    for name in names {
        if let Ok(Some(text)) = read_doc(data, &[STATE], &format!("{name}.json")) {
            out = out.raw(&name, text.trim());
        }
    }
    Response::json(200, out.build())
}

// ------------------------------------------------------------------ results

/// One result of the history.
#[derive(Clone, Debug, PartialEq)]
pub struct ResultEntry {
    /// Its id (a name of this store).
    pub id: String,
    /// The file in `results/`.
    pub file: String,
    /// The file's media type.
    pub media_type: String,
    /// The picture for the viewer, when there is one.
    pub display: Option<String>,
    /// The image the AI post-processing made, when there is one.
    pub ai: Option<String>,
    /// The media type of that image.
    pub ai_type: Option<String>,
    /// The AI's variants (X4b), by number from 1, each in the type it came in.
    pub ai_variants: Vec<AiVariant>,
    /// What the page keeps about it (`ResultMeta` of src/core/results.ts), as it sent it.
    pub meta: Value,
}

/// One AI variant of a result (X4b): its number (from 1), its file in `results/` and its media type.
#[derive(Clone, Debug, PartialEq)]
pub struct AiVariant {
    /// Its number, from 1.
    pub n: u32,
    /// Its file in `results/`.
    pub file: String,
    /// The file's media type.
    pub media_type: String,
}

impl AiVariant {
    fn to_json(&self) -> String {
        json::Object::new()
            .num("n", f64::from(self.n))
            .str("file", &self.file)
            .str("type", &self.media_type)
            .build()
    }

    fn from_json(v: &Value) -> Option<AiVariant> {
        let n = v.get("n").and_then(Value::as_f64)?;
        let file = v.get("file")?.as_str()?.to_string();
        let ok = n.fract() == 0.0
            && (1.0..=f64::from(MAX_AI_VARIANTS)).contains(&n)
            && valid_name(&file);
        ok.then(|| AiVariant {
            n: n as u32,
            file,
            media_type: v
                .get("type")
                .and_then(Value::as_str)
                .unwrap_or("application/octet-stream")
                .to_string(),
        })
    }
}

impl ResultEntry {
    fn to_json(&self) -> String {
        let mut o = json::Object::new()
            .str("id", &self.id)
            .str("file", &self.file)
            .str("type", &self.media_type)
            .opt_str("display", self.display.as_deref())
            .opt_str("ai", self.ai.as_deref())
            .opt_str("aiType", self.ai_type.as_deref());
        if !self.ai_variants.is_empty() {
            o = o.raw(
                "aiVariants",
                &json::array(self.ai_variants.iter().map(AiVariant::to_json)),
            );
        }
        o.raw("meta", &self.meta.to_json()).build()
    }

    /// Variant `n`'s file and type: one of the variants, or for variant 1 the single AI image of before X4b.
    fn ai_file(&self, n: u32) -> Option<(String, String)> {
        if let Some(v) = self.ai_variants.iter().find(|v| v.n == n) {
            return Some((v.file.clone(), v.media_type.clone()));
        }
        if n != 1 {
            return None;
        }
        self.ai.clone().map(|a| {
            (
                a,
                self.ai_type
                    .clone()
                    .unwrap_or_else(|| "application/octet-stream".to_string()),
            )
        })
    }

    fn from_json(v: &Value) -> Option<ResultEntry> {
        let id = v.get("id")?.as_str()?.to_string();
        let file = v.get("file")?.as_str()?.to_string();
        let display = v.get("display").and_then(Value::as_str).map(str::to_string);
        let ai = v.get("ai").and_then(Value::as_str).map(str::to_string);
        let ok = valid_name(&id)
            && valid_name(&file)
            && display.as_deref().is_none_or(valid_name)
            && ai.as_deref().is_none_or(valid_name)
            && matches!(v.get("meta"), Some(Value::Object(_)));
        ok.then(|| ResultEntry {
            id,
            file,
            media_type: v
                .get("type")
                .and_then(Value::as_str)
                .unwrap_or("application/octet-stream")
                .to_string(),
            display,
            ai,
            ai_type: v.get("aiType").and_then(Value::as_str).map(str::to_string),
            ai_variants: v
                .get("aiVariants")
                .and_then(Value::as_array)
                .map(|items| items.iter().filter_map(AiVariant::from_json).collect())
                .unwrap_or_default(),
            meta: v.get("meta").cloned().unwrap_or(Value::Null),
        })
    }
}

/// The results index (call with the lock held). A missing or broken index is an empty history.
pub fn read_index(data: &Path) -> Vec<ResultEntry> {
    let Ok(Some(path)) = existing(data, &[RESULTS], INDEX) else {
        return Vec::new();
    };
    fs::read_to_string(path)
        .ok()
        .and_then(|t| json::parse(&t).ok())
        .and_then(|v| {
            v.get("results")
                .and_then(Value::as_array)
                .map(|items| items.iter().filter_map(ResultEntry::from_json).collect())
        })
        .unwrap_or_default()
}

fn write_index(data: &Path, entries: &[ResultEntry]) -> Result<(), Response> {
    let path = target(data, &[RESULTS], INDEX)?;
    let text = json::Object::new()
        .num("version", 1.0)
        .raw(
            "results",
            &json::array(entries.iter().map(ResultEntry::to_json)),
        )
        .build();
    write_atomic(&path, text.as_bytes()).map_err(|e| io_error(&e))
}

/// The files of a result on the disk (the file in any of its types, its picture and the AI's images).
fn result_files(id: &str) -> Vec<String> {
    let mut names: Vec<String> = RESULT_TYPES
        .iter()
        .flat_map(|(_, ext)| {
            [format!("{id}.{ext}"), format!("{id}.ai.{ext}")]
                .into_iter()
                .chain((1..=MAX_AI_VARIANTS).map(move |n| format!("{id}.ai.{n}.{ext}")))
        })
        .collect();
    names.push(format!("{id}{DISPLAY_SUFFIX}"));
    names
}

/// The name of the AI's image of a result: variant `n` (X4b), or the single one of before (`None`).
fn ai_name(id: &str, n: Option<u32>, ext: &str) -> String {
    match n {
        Some(n) => format!("{id}.ai.{n}.{ext}"),
        None => format!("{id}.ai.{ext}"),
    }
}

/// A variant's number from the path (`.../ai/<n>`): 1 to [`MAX_AI_VARIANTS`], written plainly.
fn variant_of(text: &str) -> Result<u32, Response> {
    let plain = !text.is_empty()
        && text.len() <= 2
        && text.bytes().all(|b| b.is_ascii_digit())
        && !text.starts_with('0');
    match text.parse::<u32>() {
        Ok(n) if plain && (1..=MAX_AI_VARIANTS).contains(&n) => Ok(n),
        _ => Err(Response::error(
            400,
            "bad-variant",
            "an AI variant is a number from 1 to 8",
        )),
    }
}

fn check_id(id: &str) -> Result<(), Response> {
    if valid_name(id) {
        Ok(())
    } else {
        Err(Response::error(400, "bad-name", "invalid result id"))
    }
}

fn list_results(data: &Path) -> Response {
    let _guard = lock();
    let dir = folder(data, &[RESULTS], false).ok().flatten();
    // A result whose file is gone (deleted in the file manager) is not listed.
    let metas = read_index(data)
        .into_iter()
        .filter(|e| dir.as_ref().is_some_and(|d| d.join(&e.file).is_file()))
        .map(|e| e.meta.to_json());
    Response::json(
        200,
        json::Object::new()
            .raw("results", &json::array(metas))
            .build(),
    )
}

fn put_result_file(req: &Request, body: &mut dyn Read, data: &Path, id: &str) -> Response {
    if let Err(r) = check_id(id) {
        return r;
    }
    let media = req
        .query("type")
        .or_else(|| req.header("content-type"))
        .unwrap_or("");
    let Some(ext) = result_extension(media) else {
        return Response::error(415, "bad-type", "png, jpeg, exr, webp or tiff");
    };
    if req.content_length > MAX_RESULT {
        return Response::error(413, "too-large", "the file is too large");
    }
    let path = match target(data, &[RESULTS], &format!("{id}.{ext}")) {
        Ok(p) => p,
        Err(r) => return r,
    };
    // Outside the lock: big files take a while, and each result writes its own names.
    if let Err(e) = write_atomic_from(&path, req.content_length, body) {
        return io_error(&e);
    }
    // The same result sent again in another type leaves one file.
    if let Some(dir) = path.parent() {
        for (_, other) in RESULT_TYPES.iter().filter(|(_, e)| *e != ext) {
            let _ = remove_if_present(&dir.join(format!("{id}.{other}")));
        }
    }
    Response::empty(204)
}

fn put_result_display(req: &Request, body: &mut dyn Read, data: &Path, id: &str) -> Response {
    if let Err(r) = check_id(id) {
        return r;
    }
    let media = req
        .query("type")
        .or_else(|| req.header("content-type"))
        .unwrap_or("image/png");
    if result_extension(media) != Some("png") {
        return Response::error(415, "bad-type", "the picture is a PNG");
    }
    if req.content_length > MAX_DISPLAY {
        return Response::error(413, "too-large", "the picture is too large");
    }
    let path = match target(data, &[RESULTS], &format!("{id}{DISPLAY_SUFFIX}")) {
        Ok(p) => p,
        Err(r) => return r,
    };
    match write_atomic_from(&path, req.content_length, body) {
        Ok(()) => Response::empty(204),
        Err(e) => io_error(&e),
    }
}

/// An image the AI post-processing made: variant `n` (`PUT .../<id>/ai/<n>`, X4b) or the single one of before
/// (`PUT .../<id>/ai`), kept next to the result's file in the type it came in.
fn put_result_ai(
    req: &Request,
    body: &mut dyn Read,
    data: &Path,
    id: &str,
    n: Option<u32>,
) -> Response {
    if let Err(r) = check_id(id) {
        return r;
    }
    let media = req
        .query("type")
        .or_else(|| req.header("content-type"))
        .unwrap_or("");
    let Some(ext) = result_extension(media) else {
        return Response::error(415, "bad-type", "png, jpeg, exr, webp or tiff");
    };
    if req.content_length > MAX_RESULT {
        return Response::error(413, "too-large", "the file is too large");
    }
    let path = match target(data, &[RESULTS], &ai_name(id, n, ext)) {
        Ok(p) => p,
        Err(r) => return r,
    };
    if let Err(e) = write_atomic_from(&path, req.content_length, body) {
        return io_error(&e);
    }
    // The same image sent again in another type leaves one file.
    if let Some(dir) = path.parent() {
        for (_, other) in RESULT_TYPES.iter().filter(|(_, e)| *e != ext) {
            let _ = remove_if_present(&dir.join(ai_name(id, n, other)));
        }
    }
    Response::empty(204)
}

/// Adds the result to the history once its file is there (`PUT .../<id>/meta`).
fn commit_result(req: &Request, body: &mut dyn Read, data: &Path, id: &str) -> Response {
    if let Err(r) = check_id(id) {
        return r;
    }
    let (_, meta) = match read_json(req, body, MAX_DOC, true) {
        Ok(v) => v,
        Err(r) => return r,
    };
    if meta.get("id").and_then(Value::as_str) != Some(id) {
        return Response::error(
            400,
            "id-mismatch",
            "the record's id is not the one in the path",
        );
    }
    let _guard = lock();
    let Ok(Some(dir)) = folder(data, &[RESULTS], false) else {
        return Response::error(409, "no-file", "send the result's file first");
    };
    let Some((media, ext)) = RESULT_TYPES
        .iter()
        .find(|(_, ext)| dir.join(format!("{id}.{ext}")).is_file())
    else {
        return Response::error(409, "no-file", "send the result's file first");
    };
    let display = format!("{id}{DISPLAY_SUFFIX}");
    let ai = RESULT_TYPES
        .iter()
        .find(|(_, e)| dir.join(format!("{id}.ai.{e}")).is_file());
    // X4b: every variant that was sent, by its number.
    let ai_variants = (1..=MAX_AI_VARIANTS)
        .filter_map(|n| {
            RESULT_TYPES
                .iter()
                .find(|(_, e)| dir.join(ai_name(id, Some(n), e)).is_file())
                .map(|(m, e)| AiVariant {
                    n,
                    file: ai_name(id, Some(n), e),
                    media_type: (*m).to_string(),
                })
        })
        .collect();
    let entry = ResultEntry {
        id: id.to_string(),
        file: format!("{id}.{ext}"),
        media_type: (*media).to_string(),
        display: dir.join(&display).is_file().then_some(display),
        ai: ai.map(|(_, e)| format!("{id}.ai.{e}")),
        ai_type: ai.map(|(m, _)| (*m).to_string()),
        ai_variants,
        meta,
    };
    let mut entries: Vec<ResultEntry> = read_index(data)
        .into_iter()
        .filter(|e| e.id != id)
        .collect();
    entries.push(entry);
    match write_index(data, &entries) {
        Ok(()) => Response::empty(204),
        Err(r) => r,
    }
}

/// Which of a result's files a request asks for: the AI's image by its variant (1 for `.../ai`).
#[derive(Clone, Copy, PartialEq, Eq)]
enum Part {
    File,
    Display,
    Ai(u32),
}

fn serve_result(req: &Request, data: &Path, id: &str, part: Part) -> Response {
    if let Err(r) = check_id(id) {
        return r;
    }
    let (name, media) = {
        let _guard = lock();
        match read_index(data).into_iter().find(|e| e.id == id) {
            Some(e) if part == Part::Display => match e.display {
                Some(d) => (d, "image/png".to_string()),
                None => return Response::error(404, "not-found", "this result has no picture"),
            },
            Some(e) => match part {
                Part::Ai(n) => match e.ai_file(n) {
                    Some(found) => found,
                    None => {
                        return Response::error(
                            404,
                            "not-found",
                            "this result has no such AI image",
                        )
                    }
                },
                _ => (e.file, e.media_type),
            },
            None => return Response::error(404, "not-found", "no such result"),
        }
    };
    match existing(data, &[RESULTS], &name) {
        Ok(Some(path)) => crate::static_files::file_response(&path, req, &media, "no-store"),
        Ok(None) => Response::error(404, "not-found", "the result's file is gone"),
        Err(r) => r,
    }
}

fn delete_result(data: &Path, id: &str) -> Response {
    if let Err(r) = check_id(id) {
        return r;
    }
    let _guard = lock();
    let entries = read_index(data);
    if entries.iter().any(|e| e.id == id) {
        let rest: Vec<ResultEntry> = entries.into_iter().filter(|e| e.id != id).collect();
        if let Err(r) = write_index(data, &rest) {
            return r;
        }
    }
    if let Ok(Some(dir)) = folder(data, &[RESULTS], false) {
        for name in result_files(id) {
            if let Err(e) = remove_if_present(&dir.join(name)) {
                return io_error(&e);
            }
        }
    }
    Response::empty(204)
}

/// True for a file of `results/` this store wrote (a result's file or picture, or a temporary one).
fn is_result_file(name: &str) -> bool {
    if name.ends_with(".tmp") {
        return true;
    }
    if let Some(id) = name.strip_suffix(DISPLAY_SUFFIX) {
        return valid_name(id);
    }
    RESULT_TYPES.iter().any(|(_, ext)| {
        name.strip_suffix(&format!(".{ext}"))
            .is_some_and(valid_name)
    })
}

fn clear_results(data: &Path) -> Response {
    let _guard = lock();
    let Ok(Some(dir)) = folder(data, &[RESULTS], false) else {
        return Response::json(200, "{\"deleted\":0}".into());
    };
    let deleted = read_index(data).len();
    if let Err(r) = write_index(data, &[]) {
        return r;
    }
    // Only what this store wrote: a file the person put in the folder stays.
    let names: Vec<String> = fs::read_dir(&dir)
        .map(|it| {
            it.filter_map(Result::ok)
                .filter(|e| e.file_type().is_ok_and(|t| t.is_file()))
                .filter_map(|e| e.file_name().into_string().ok())
                .filter(|n| n != INDEX && is_result_file(n))
                .collect()
        })
        .unwrap_or_default();
    for name in names {
        if let Err(e) = remove_if_present(&dir.join(&name)) {
            return io_error(&e);
        }
    }
    Response::json(
        200,
        json::Object::new().num("deleted", deleted as f64).build(),
    )
}

// ------------------------------------------------------------------ the thumbnail cache

/// A cached thumbnail (200), or 204 when there is none: a miss is the usual case, not an error.
fn get_cache(data: &Path, key: &str) -> Response {
    if !valid_name(key) {
        return Response::error(400, "bad-name", "invalid cache key");
    }
    match existing(data, &[CACHE, THUMBS], &format!("{key}.txt")) {
        Ok(Some(path)) => match fs::read(path) {
            Ok(bytes) => Response::bytes(200, "text/plain; charset=utf-8", bytes),
            Err(_) => Response::empty(204),
        },
        Ok(None) => Response::empty(204),
        Err(r) => r,
    }
}

fn put_cache(req: &Request, body: &mut dyn Read, data: &Path, key: &str) -> Response {
    if !valid_name(key) {
        return Response::error(400, "bad-name", "invalid cache key");
    }
    let bytes = match read_body(req, body, MAX_DOC) {
        Ok(b) => b,
        Err(r) => return r,
    };
    if std::str::from_utf8(&bytes).is_err() {
        return Response::error(400, "bad-body", "the body is not UTF-8 text");
    }
    let path = match target(data, &[CACHE, THUMBS], &format!("{key}.txt")) {
        Ok(p) => p,
        Err(r) => return r,
    };
    match write_atomic(&path, &bytes) {
        Ok(()) => Response::empty(204),
        Err(e) => io_error(&e),
    }
}

fn clear_cache(data: &Path) -> Response {
    let dir = match folder(data, &[CACHE, THUMBS], false) {
        Ok(Some(d)) => d,
        Ok(None) => return Response::json(200, "{\"freed\":0}".into()),
        Err(r) => return r,
    };
    let mut freed = 0u64;
    if let Ok(entries) = fs::read_dir(&dir) {
        for e in entries.filter_map(Result::ok) {
            let name = e.file_name().into_string().unwrap_or_default();
            let ours = name.ends_with(".tmp") || name.strip_suffix(".txt").is_some_and(valid_name);
            let Ok(meta) = fs::symlink_metadata(e.path()) else {
                continue;
            };
            if ours && meta.is_file() && fs::remove_file(e.path()).is_ok() {
                freed += meta.len();
            }
        }
    }
    Response::json(200, json::Object::new().num("freed", freed as f64).build())
}

// ------------------------------------------------------------------ space used

/// Bytes and files under `path`, links not followed (a link counts as nothing), at most
/// [`WALK_LIMIT`] entries.
pub fn measure(path: &Path) -> (u64, u64) {
    let mut bytes = 0u64;
    let mut files = 0u64;
    let mut seen = 0u64;
    let mut stack = vec![path.to_path_buf()];
    while let Some(p) = stack.pop() {
        seen += 1;
        if seen > WALK_LIMIT {
            break;
        }
        let Ok(meta) = fs::symlink_metadata(&p) else {
            continue;
        };
        if meta.file_type().is_symlink() {
            continue;
        }
        if meta.is_dir() {
            if let Ok(entries) = fs::read_dir(&p) {
                stack.extend(entries.filter_map(Result::ok).map(|e| e.path()));
            }
        } else {
            bytes += meta.len();
            files += 1;
        }
    }
    (bytes, files)
}

/// The data folder and what is in it, by part (`GET /api/storage/usage`).
pub fn usage_json(paths: &Paths) -> String {
    let data = &paths.data_dir;
    let (total, total_files) = measure(data);
    let parts: [(&str, Vec<PathBuf>); 6] = [
        ("models", vec![paths.models()]),
        ("results", vec![data.join(RESULTS)]),
        ("library", vec![data.join(LIBRARY)]),
        ("thumbs", vec![data.join(CACHE).join(THUMBS)]),
        ("logs", vec![paths.logs()]),
        // The window's own profile: the app window's browser profile, or the WebView2 one (P3c).
        (
            "window",
            vec![paths.browser_profile(), data.join("webview2")],
        ),
    ];
    let mut listed = (0u64, 0u64);
    let mut items: Vec<String> = parts
        .iter()
        .map(|(id, dirs)| {
            let (b, f) = dirs
                .iter()
                .map(|d| measure(d))
                .fold((0, 0), |a, m| (a.0 + m.0, a.1 + m.1));
            listed = (listed.0 + b, listed.1 + f);
            json::Object::new()
                .str("id", id)
                .str("path", &dirs[0].to_string_lossy())
                .num("bytes", b as f64)
                .num("files", f as f64)
                .build()
        })
        .collect();
    items.push(
        json::Object::new()
            .str("id", "other")
            .opt_str("path", None)
            .num("bytes", total.saturating_sub(listed.0) as f64)
            .num("files", total_files.saturating_sub(listed.1) as f64)
            .build(),
    );
    json::Object::new()
        .str("dataDir", &data.to_string_lossy())
        .num("total", total as f64)
        .num("files", total_files as f64)
        .raw("folders", &json::array(items))
        .build()
}

// ------------------------------------------------------------------ routes

/// Answers `/api/store/*` and `/api/storage/*` (`parts`: the path after `/api/`, split at `/`,
/// already free of empty, `.` and `..` segments); `None` for any other path. The caller has
/// checked the host, the origin and the token.
pub fn route(
    paths: &Paths,
    req: &Request,
    parts: &[&str],
    body: &mut dyn Read,
) -> Option<Response> {
    let data = paths.data_dir.as_path();
    let doc = |name: &str| -> Result<String, Response> {
        if valid_name(name) {
            Ok(format!("{name}.json"))
        } else {
            Err(Response::error(400, "bad-name", "invalid document name"))
        }
    };
    let m = req.method.as_str();
    let response = match (m, parts) {
        ("GET", ["store", "settings"]) => get_doc(data, &[], SETTINGS),
        ("PUT", ["store", "settings"]) => put_doc(req, body, data, &[], SETTINGS, MAX_DOC, true),
        ("DELETE", ["store", "settings"]) => delete_doc(data, &[], SETTINGS),
        ("GET", ["store", "docs"]) => all_docs(data),
        ("GET", ["store", "docs", name]) => match doc(name) {
            Ok(file) => get_doc(data, &[STATE], &file),
            Err(r) => r,
        },
        ("PUT", ["store", "docs", name]) => match doc(name) {
            Ok(file) => put_doc(req, body, data, &[STATE], &file, MAX_DOC, false),
            Err(r) => r,
        },
        ("DELETE", ["store", "docs", name]) => match doc(name) {
            Ok(file) => delete_doc(data, &[STATE], &file),
            Err(r) => r,
        },
        ("GET", ["store", "library"]) => get_doc(data, &[LIBRARY], LIBRARY_FILE),
        ("PUT", ["store", "library"]) => {
            put_doc(req, body, data, &[LIBRARY], LIBRARY_FILE, MAX_LIBRARY, true)
        }
        ("DELETE", ["store", "library"]) => delete_doc(data, &[LIBRARY], LIBRARY_FILE),
        ("GET", ["store", "results"]) => list_results(data),
        ("DELETE", ["store", "results"]) => clear_results(data),
        ("PUT", ["store", "results", id]) => put_result_file(req, body, data, id),
        ("GET" | "HEAD", ["store", "results", id]) => serve_result(req, data, id, Part::File),
        ("DELETE", ["store", "results", id]) => delete_result(data, id),
        ("PUT", ["store", "results", id, "display"]) => put_result_display(req, body, data, id),
        ("GET" | "HEAD", ["store", "results", id, "display"]) => {
            serve_result(req, data, id, Part::Display)
        }
        ("PUT", ["store", "results", id, "ai"]) => put_result_ai(req, body, data, id, None),
        ("GET" | "HEAD", ["store", "results", id, "ai"]) => {
            serve_result(req, data, id, Part::Ai(1))
        }
        ("PUT", ["store", "results", id, "ai", n]) => match variant_of(n) {
            Ok(n) => put_result_ai(req, body, data, id, Some(n)),
            Err(r) => r,
        },
        ("GET" | "HEAD", ["store", "results", id, "ai", n]) => match variant_of(n) {
            Ok(n) => serve_result(req, data, id, Part::Ai(n)),
            Err(r) => r,
        },
        ("PUT", ["store", "results", id, "meta"]) => commit_result(req, body, data, id),
        ("GET", ["store", "cache", key]) => get_cache(data, key),
        ("PUT", ["store", "cache", key]) => put_cache(req, body, data, key),
        ("DELETE", ["store", "cache"]) => clear_cache(data),
        ("GET", ["storage", "usage"]) => Response::json(200, usage_json(paths)),
        (
            _,
            ["store", "settings" | "docs" | "library" | "results" | "cache"]
            | ["store", "docs" | "results" | "cache", _]
            | ["store", "results", _, "display" | "meta" | "ai"]
            | ["store", "results", _, "ai", _]
            | ["storage", "usage"],
        ) => Response::error(405, "method", "method not allowed"),
        (_, ["store" | "storage", ..]) => Response::error(404, "not-found", "no such endpoint"),
        _ => return None,
    };
    Some(response)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_are_lower_case_plain_and_never_a_device() {
        for ok in [
            "settings",
            "models.downloads",
            "r1abc2",
            "desktop.folders",
            "a",
            "x-y_z.1",
            "console",
            "com10",
            "lpt",
        ] {
            assert!(valid_name(ok), "{ok}");
        }
        for bad in [
            "",
            ".hidden",
            "a..b",
            "..",
            "trailing.",
            "Upper",
            "with space",
            "slash/x",
            "back\\x",
            "colon:x",
            "nul",
            "CON",
            "con",
            "con.json",
            "aux.txt",
            "prn",
            "com1",
            "lpt9.log",
            "é",
            &"a".repeat(MAX_NAME + 1),
        ] {
            assert!(!valid_name(bad), "{bad}");
        }
        assert!(valid_name(&"a".repeat(MAX_NAME)));
    }

    #[test]
    fn result_types_map_to_extensions() {
        assert_eq!(result_extension("image/png"), Some("png"));
        assert_eq!(result_extension("IMAGE/JPEG; q=1"), Some("jpg"));
        assert_eq!(result_extension("image/x-exr"), Some("exr"));
        assert_eq!(result_extension("text/html"), None);
        assert_eq!(result_extension(""), None);
        assert!(is_result_file("r1.png"));
        assert!(is_result_file("r1.display.png"));
        assert!(is_result_file("r1.png.123-4.tmp"));
        assert!(!is_result_file("index.json"));
        assert!(!is_result_file("holiday.PNG"));
        assert!(!is_result_file("notes.txt"));
    }

    #[test]
    fn an_atomic_write_leaves_the_old_file_when_the_body_is_short() {
        let dir = crate::test_dir("appdata-atomic");
        let path = dir.join("doc.json");
        write_atomic(&path, b"{\"v\":1}").unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"{\"v\":1}");
        // Promised 100 bytes, gave 3.
        let err = write_atomic_from(&path, 100, &mut &b"abc"[..]).unwrap_err();
        assert_eq!(err.kind(), io::ErrorKind::UnexpectedEof);
        assert_eq!(fs::read(&path).unwrap(), b"{\"v\":1}");
        write_atomic(&path, b"{\"v\":2}").unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"{\"v\":2}");
        // No temporary file is ever left behind.
        let left: Vec<String> = fs::read_dir(&dir)
            .unwrap()
            .filter_map(Result::ok)
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(left, vec!["doc.json".to_string()]);
    }

    #[test]
    fn a_corrupt_document_is_moved_aside_and_reads_as_none() {
        let dir = crate::test_dir("appdata-corrupt");
        fs::write(dir.join(SETTINGS), "{not json").unwrap();
        assert_eq!(read_doc(&dir, &[], SETTINGS).ok(), Some(None));
        assert!(!dir.join(SETTINGS).exists());
        assert_eq!(
            fs::read_to_string(dir.join("settings.json.corrupt")).unwrap(),
            "{not json"
        );
        fs::write(dir.join(SETTINGS), "{\"schema\":1}").unwrap();
        assert_eq!(
            read_doc(&dir, &[], SETTINGS).ok(),
            Some(Some("{\"schema\":1}".to_string()))
        );
    }

    #[cfg(unix)]
    #[test]
    fn links_inside_the_data_folder_lead_nowhere() {
        let dir = crate::test_dir("appdata-links");
        let data = dir.join("data");
        let elsewhere = dir.join("elsewhere");
        fs::create_dir_all(&data).unwrap();
        fs::create_dir_all(&elsewhere).unwrap();
        std::os::unix::fs::symlink(&elsewhere, data.join(RESULTS)).unwrap();
        assert_eq!(
            target(&data, &[RESULTS], "r1.png").err().map(|r| r.status),
            Some(403)
        );
        assert_eq!(
            existing(&data, &[RESULTS], INDEX).err().map(|r| r.status),
            Some(403)
        );
        // A link where a file goes is refused too.
        fs::create_dir_all(data.join(STATE)).unwrap();
        fs::write(elsewhere.join("x"), "secret").unwrap();
        std::os::unix::fs::symlink(elsewhere.join("x"), data.join(STATE).join("a.json")).unwrap();
        assert_eq!(
            target(&data, &[STATE], "a.json").err().map(|r| r.status),
            Some(403)
        );
        assert_eq!(
            existing(&data, &[STATE], "a.json").err().map(|r| r.status),
            Some(403)
        );
        assert_eq!(fs::read_to_string(elsewhere.join("x")).unwrap(), "secret");
        assert!(fs::read_dir(&elsewhere).unwrap().count() == 1);
    }

    #[test]
    fn a_file_where_a_folder_goes_is_refused() {
        let dir = crate::test_dir("appdata-file-in-the-way");
        fs::write(dir.join(LIBRARY), "not a folder").unwrap();
        assert_eq!(
            target(&dir, &[LIBRARY], LIBRARY_FILE)
                .err()
                .map(|r| r.status),
            Some(403)
        );
    }

    #[test]
    fn measuring_counts_files_and_not_links() {
        let dir = crate::test_dir("appdata-measure");
        fs::create_dir_all(dir.join("a/b")).unwrap();
        fs::write(dir.join("a/one"), vec![0u8; 10]).unwrap();
        fs::write(dir.join("a/b/two"), vec![0u8; 32]).unwrap();
        assert_eq!(measure(&dir), (42, 2));
        assert_eq!(measure(&dir.join("missing")), (0, 0));
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(dir.join("a"), dir.join("link")).unwrap();
            assert_eq!(measure(&dir), (42, 2));
        }
    }
}
