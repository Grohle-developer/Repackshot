//! The AI model store, content-addressed.
//!
//! ```text
//! <data>/models/blobs/<sha256>             a complete file, checked against its name
//! <data>/models/blobs/<sha256>.part        a file being downloaded (chunks at any offset)
//! <data>/models/blobs/<sha256>.part.json   what of it is written: {"total", "ranges", "damaged", "actual"}
//! <data>/models/installed.json             {"installed": [keys]}: models ready to use
//! <data>/models/imported/<key>.json        manifests of imported models (files: name, role, bytes, sha256)
//! ```
//!
//! A file shared by several models (the Qwen3-4B text encoder of four of them, the Z-Image VAE
//! of three) is stored once. The page downloads with `fetch` and hands the bytes over in chunks;
//! chunks may come in any order and from several connections, and are written straight to the
//! part file (nothing is buffered whole). The written ranges are kept next to it, so a download
//! resumes from the first byte missing ("contiguous" bytes). `finish` hashes the part file with
//! [`crate::sha256`], streaming, and renames it to its final name only when the digest equals the
//! name; otherwise it stays, marked damaged, until it is deleted. Deleting a model removes only
//! the blobs that no other installed model (nor a model the caller is still downloading) uses.

use crate::json::{self, Value};
use crate::recommend::{parse_files, valid_name, valid_sha256, Catalogue, ModelFile};
use crate::sha256::{hex, Sha256};
use std::collections::{BTreeSet, HashMap};
use std::fs::{self, File, OpenOptions};
use std::io::{self, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard, PoisonError};

/// Largest blob accepted (1 TiB): a sanity bound, not a quota.
pub const MAX_BLOB: u64 = 1 << 40;
/// Largest imported manifest.
pub const MAX_MANIFEST: u64 = 1 << 20;

/// What is written of a blob being downloaded.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Part {
    /// Written byte ranges `[start, end)`, sorted, merged.
    pub ranges: Vec<(u64, u64)>,
    /// The final size, when the client said it.
    pub total: Option<u64>,
    /// The digest did not match: the bytes are wrong somewhere; delete and download again.
    pub damaged: bool,
    /// The digest computed when it did not match.
    pub actual: Option<String>,
}

impl Part {
    /// Bytes written from offset 0 without a gap: where a download resumes.
    pub fn contiguous(&self) -> u64 {
        match self.ranges.first() {
            Some(&(0, end)) => end,
            _ => 0,
        }
    }

    /// Bytes written in total.
    pub fn written(&self) -> u64 {
        self.ranges.iter().map(|(a, b)| b - a).sum()
    }

    /// Every byte up to the known size is written.
    pub fn ready(&self) -> bool {
        self.total
            .is_some_and(|t| self.ranges == [(0, t)] || (t == 0 && self.ranges.is_empty()))
    }

    /// Records `[start, end)` as written.
    pub fn add(&mut self, start: u64, end: u64) {
        if end <= start {
            return;
        }
        self.ranges.push((start, end));
        self.ranges.sort_unstable();
        let mut merged: Vec<(u64, u64)> = Vec::with_capacity(self.ranges.len());
        for &(a, b) in &self.ranges {
            match merged.last_mut() {
                Some(last) if a <= last.1 => last.1 = last.1.max(b),
                _ => merged.push((a, b)),
            }
        }
        self.ranges = merged;
    }

    fn to_json(&self) -> String {
        json::Object::new()
            .opt_num("total", self.total.map(|t| t as f64))
            .raw(
                "ranges",
                &json::array(self.ranges.iter().map(|(a, b)| format!("[{a},{b}]"))),
            )
            .bool("damaged", self.damaged)
            .opt_str("actual", self.actual.as_deref())
            .build()
    }

    fn from_json(text: &str) -> Option<Part> {
        let v = json::parse(text).ok()?;
        let num = |v: &Value| {
            v.as_f64()
                .filter(|n| *n >= 0.0 && n.fract() == 0.0)
                .map(|n| n as u64)
        };
        let mut part = Part {
            total: v.get("total").and_then(num),
            damaged: v.get("damaged").and_then(Value::as_bool).unwrap_or(false),
            actual: v.get("actual").and_then(Value::as_str).map(str::to_string),
            ..Part::default()
        };
        for r in v.get("ranges")?.as_array()? {
            let r = r.as_array()?;
            part.add(num(r.first()?)?, num(r.get(1)?)?);
        }
        Some(part)
    }
}

/// The state of one blob.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Blob {
    /// Nothing on disk.
    Missing,
    /// Being downloaded (or damaged).
    Partial(Part),
    /// Complete and checked; its size.
    Complete(u64),
}

/// Why a store operation failed.
#[derive(Debug)]
pub enum StoreError {
    /// A key, file name or digest that is not valid.
    BadName,
    /// A key that is neither in the catalogue nor imported.
    UnknownKey,
    /// No such blob or part.
    NotFound,
    /// The part is damaged: delete it first.
    Damaged,
    /// The part is being checked right now.
    Checking,
    /// Something contradicts what is stored (another total size, a catalogue key...).
    Conflict(String),
    /// The chunk does not fit (past the total, past [`MAX_BLOB`]).
    OutOfRange,
    /// `finish` before every byte is written.
    Incomplete {
        /// Bytes written from 0.
        contiguous: u64,
    },
    /// The digest is not the blob's name; the part is now damaged.
    Mismatch {
        /// The digest of the bytes.
        actual: String,
    },
    /// The model needs blobs that are not complete.
    Missing(Vec<String>),
    /// A bad request body.
    BadBody(String),
    /// The disk.
    Io(io::Error),
}

impl From<io::Error> for StoreError {
    fn from(e: io::Error) -> StoreError {
        StoreError::Io(e)
    }
}

/// A model the store knows: from the catalogue or imported.
#[derive(Clone, Debug, PartialEq)]
pub struct Known {
    /// Its key.
    pub key: String,
    /// `catalogue` or `imported`.
    pub source: &'static str,
    /// Its files.
    pub files: Vec<ModelFile>,
    /// The imported manifest as stored (imported models only).
    pub manifest: Option<String>,
}

/// The store.
pub struct Store {
    root: PathBuf,
    catalogue: Catalogue,
    /// Blobs being checked: bytes hashed so far.
    checking: Mutex<HashMap<String, (u64, u64)>>,
    /// Serialises the small metadata files (part ranges, installed.json).
    meta: Mutex<()>,
}

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(PoisonError::into_inner)
}

/// Writes `bytes` to `path` through a temporary file and a rename, so a crash never leaves half
/// a file.
fn write_atomic(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let mut tmp = path.as_os_str().to_owned();
    tmp.push(".tmp");
    let tmp = PathBuf::from(tmp);
    {
        let mut f = File::create(&tmp)?;
        f.write_all(bytes)?;
        f.sync_all()?;
    }
    fs::rename(&tmp, path)
}

fn remove_if_present(path: &Path) -> io::Result<()> {
    match fs::remove_file(path) {
        Err(e) if e.kind() != io::ErrorKind::NotFound => Err(e),
        _ => Ok(()),
    }
}

impl Store {
    /// A store in `root` (`<data>/models`) for `catalogue`.
    pub fn new(root: PathBuf, catalogue: Catalogue) -> Store {
        Store {
            root,
            catalogue,
            checking: Mutex::new(HashMap::new()),
            meta: Mutex::new(()),
        }
    }

    /// The store's folder.
    pub fn root(&self) -> &Path {
        &self.root
    }

    fn blobs(&self) -> PathBuf {
        self.root.join("blobs")
    }

    fn blob_path(&self, sha: &str) -> PathBuf {
        self.blobs().join(sha)
    }

    fn part_path(&self, sha: &str) -> PathBuf {
        self.blobs().join(format!("{sha}.part"))
    }

    fn ranges_path(&self, sha: &str) -> PathBuf {
        self.blobs().join(format!("{sha}.part.json"))
    }

    fn installed_path(&self) -> PathBuf {
        self.root.join("installed.json")
    }

    fn imported_dir(&self) -> PathBuf {
        self.root.join("imported")
    }

    fn read_part(&self, sha: &str) -> Option<Part> {
        if !self.part_path(sha).is_file() {
            return None;
        }
        Some(
            fs::read_to_string(self.ranges_path(sha))
                .ok()
                .and_then(|t| Part::from_json(&t))
                .unwrap_or_default(),
        )
    }

    /// The state of a blob.
    pub fn blob(&self, sha: &str) -> Result<Blob, StoreError> {
        if !valid_sha256(sha) {
            return Err(StoreError::BadName);
        }
        if let Ok(meta) = fs::metadata(self.blob_path(sha)) {
            return Ok(Blob::Complete(meta.len()));
        }
        Ok(self.read_part(sha).map_or(Blob::Missing, Blob::Partial))
    }

    /// Bytes hashed so far and the size, while `finish` checks the blob.
    pub fn checking(&self, sha: &str) -> Option<(u64, u64)> {
        lock(&self.checking).get(sha).copied()
    }

    /// Writes `len` bytes from `body` at `offset` of the blob `sha`. `total` is the blob's size
    /// when the client knows it. An already complete blob is left alone (the caller drains the
    /// body). Returns the blob's state afterwards.
    pub fn write_chunk(
        &self,
        sha: &str,
        offset: u64,
        total: Option<u64>,
        len: u64,
        body: &mut dyn Read,
    ) -> Result<Blob, StoreError> {
        let blob = self.blob(sha)?;
        if let Blob::Complete(_) = blob {
            return Ok(blob);
        }
        let end = offset.checked_add(len).ok_or(StoreError::OutOfRange)?;
        if end > MAX_BLOB || total.is_some_and(|t| end > t || t > MAX_BLOB) {
            return Err(StoreError::OutOfRange);
        }
        {
            let _meta = lock(&self.meta);
            if self.checking(sha).is_some() {
                return Err(StoreError::Checking);
            }
            let part = self.read_part(sha).unwrap_or_default();
            if part.damaged {
                return Err(StoreError::Damaged);
            }
            if let (Some(known), Some(t)) = (part.total, total) {
                if known != t {
                    return Err(StoreError::Conflict(format!(
                        "the blob was started with {known} bytes, not {t}"
                    )));
                }
            }
            if part.total.is_some_and(|t| end > t) {
                return Err(StoreError::OutOfRange);
            }
            fs::create_dir_all(self.blobs())?;
            if !self.part_path(sha).is_file() {
                File::create(self.part_path(sha))?;
                let mut fresh = part.clone();
                fresh.total = total;
                write_atomic(&self.ranges_path(sha), fresh.to_json().as_bytes())?;
            }
        }
        // The data goes straight to its place, outside the lock (other chunks write elsewhere).
        let mut file = OpenOptions::new().write(true).open(self.part_path(sha))?;
        file.seek(SeekFrom::Start(offset))?;
        let mut buf = vec![0u8; 1 << 20];
        let mut written = 0u64;
        let mut failure = None;
        while written < len {
            let want = (len - written).min(buf.len() as u64) as usize;
            match body.read(&mut buf[..want]) {
                Ok(0) => {
                    failure = Some(io::Error::new(
                        io::ErrorKind::UnexpectedEof,
                        "the chunk ended early",
                    ));
                    break;
                }
                Ok(n) => {
                    if let Err(e) = file.write_all(&buf[..n]) {
                        failure = Some(e);
                        break;
                    }
                    written += n as u64;
                }
                Err(e) if e.kind() == io::ErrorKind::Interrupted => {}
                Err(e) => {
                    failure = Some(e);
                    break;
                }
            }
        }
        file.sync_data()?;
        drop(file);
        // Whatever arrived is real data: record it, so a cut chunk still counts.
        let part = {
            let _meta = lock(&self.meta);
            let mut part = self.read_part(sha).unwrap_or_default();
            part.add(offset, offset + written);
            if part.total.is_none() {
                part.total = total;
            }
            write_atomic(&self.ranges_path(sha), part.to_json().as_bytes())?;
            part
        };
        match failure {
            Some(e) => Err(StoreError::Io(e)),
            None => Ok(Blob::Partial(part)),
        }
    }

    /// Checks a fully written blob against its name and makes it complete (returns its size), or
    /// marks it damaged ([`StoreError::Mismatch`]). `expected` is its size when known.
    pub fn finish(&self, sha: &str, expected: Option<u64>) -> Result<u64, StoreError> {
        let size = {
            let _meta = lock(&self.meta);
            match self.blob(sha)? {
                Blob::Complete(len) => return Ok(len),
                Blob::Missing => return Err(StoreError::NotFound),
                Blob::Partial(part) => {
                    if part.damaged {
                        return Err(StoreError::Damaged);
                    }
                    if self.checking(sha).is_some() {
                        return Err(StoreError::Checking);
                    }
                    let file_len = fs::metadata(self.part_path(sha))?.len();
                    let size = expected.or(part.total).unwrap_or(file_len);
                    if part.total.is_some_and(|t| t != size) {
                        return Err(StoreError::Conflict(format!(
                            "the blob was started with {} bytes, not {size}",
                            part.total.unwrap_or(0)
                        )));
                    }
                    let complete = if size == 0 {
                        part.ranges.is_empty()
                    } else {
                        part.ranges == [(0, size)]
                    };
                    if !complete || file_len != size {
                        return Err(StoreError::Incomplete {
                            contiguous: part.contiguous().min(size),
                        });
                    }
                    lock(&self.checking).insert(sha.to_string(), (0, size));
                    size
                }
            }
        };
        let digest = self.hash_part(sha, size);
        let _meta = lock(&self.meta);
        lock(&self.checking).remove(sha);
        let actual = hex(&digest?);
        if actual == sha {
            fs::rename(self.part_path(sha), self.blob_path(sha))?;
            remove_if_present(&self.ranges_path(sha))?;
            Ok(size)
        } else {
            let mut part = self.read_part(sha).unwrap_or_default();
            part.damaged = true;
            part.actual = Some(actual.clone());
            write_atomic(&self.ranges_path(sha), part.to_json().as_bytes())?;
            Err(StoreError::Mismatch { actual })
        }
    }

    fn hash_part(&self, sha: &str, size: u64) -> io::Result<[u8; 32]> {
        let mut file = File::open(self.part_path(sha))?;
        let mut h = Sha256::new();
        let mut buf = vec![0u8; 1 << 20];
        let mut done = 0u64;
        let mut reported = 0u64;
        while done < size {
            let want = (size - done).min(buf.len() as u64) as usize;
            let n = file.read(&mut buf[..want])?;
            if n == 0 {
                return Err(io::Error::new(
                    io::ErrorKind::UnexpectedEof,
                    "the part file is short",
                ));
            }
            h.update(&buf[..n]);
            done += n as u64;
            if done - reported >= 64 << 20 {
                reported = done;
                if let Some(p) = lock(&self.checking).get_mut(sha) {
                    p.0 = done;
                }
            }
        }
        Ok(h.finish())
    }

    /// Deletes a blob (complete or partial) that no installed model uses.
    pub fn delete_blob(&self, sha: &str) -> Result<(), StoreError> {
        if !valid_sha256(sha) {
            return Err(StoreError::BadName);
        }
        let _meta = lock(&self.meta);
        if self.checking(sha).is_some() {
            return Err(StoreError::Checking);
        }
        let users: Vec<String> = self
            .installed_locked()
            .into_iter()
            .filter(|k| {
                self.known(k)
                    .is_some_and(|m| m.files.iter().any(|f| f.sha256 == sha))
            })
            .collect();
        if !users.is_empty() {
            return Err(StoreError::Conflict(format!(
                "installed models use it: {}",
                users.join(", ")
            )));
        }
        self.remove_blob_files(sha)
    }

    fn remove_blob_files(&self, sha: &str) -> Result<(), StoreError> {
        remove_if_present(&self.blob_path(sha))?;
        remove_if_present(&self.part_path(sha))?;
        remove_if_present(&self.ranges_path(sha))?;
        Ok(())
    }

    /// The keys in `installed.json`.
    pub fn installed(&self) -> Vec<String> {
        let _meta = lock(&self.meta);
        self.installed_locked()
    }

    fn installed_locked(&self) -> Vec<String> {
        fs::read_to_string(self.installed_path())
            .ok()
            .and_then(|t| json::parse(&t).ok())
            .and_then(|v| {
                v.get("installed").and_then(Value::as_array).map(|a| {
                    a.iter()
                        .filter_map(|k| k.as_str().filter(|k| valid_name(k)).map(str::to_string))
                        .collect()
                })
            })
            .unwrap_or_default()
    }

    fn save_installed(&self, keys: &[String]) -> io::Result<()> {
        fs::create_dir_all(&self.root)?;
        let body = json::Object::new()
            .raw(
                "installed",
                &json::array(keys.iter().map(|k| json::string(k))),
            )
            .build();
        write_atomic(&self.installed_path(), body.as_bytes())
    }

    /// A model of the catalogue or an imported one.
    pub fn known(&self, key: &str) -> Option<Known> {
        if let Some(m) = self.catalogue.model(key) {
            return Some(Known {
                key: m.key.clone(),
                source: "catalogue",
                files: m.files.clone(),
                manifest: None,
            });
        }
        if !valid_name(key) {
            return None;
        }
        let text = fs::read_to_string(self.imported_dir().join(format!("{key}.json"))).ok()?;
        let files = json::parse(&text).ok().and_then(|v| parse_files(&v).ok())?;
        Some(Known {
            key: key.to_string(),
            source: "imported",
            files,
            manifest: Some(text),
        })
    }

    /// Every known model: the catalogue's, then the imported ones by key.
    pub fn all_known(&self) -> Vec<Known> {
        let mut out: Vec<Known> = self
            .catalogue
            .models
            .iter()
            .filter_map(|m| self.known(&m.key))
            .collect();
        let mut imported: Vec<String> = fs::read_dir(self.imported_dir())
            .map(|dir| {
                dir.filter_map(|e| e.ok())
                    .filter_map(|e| {
                        e.file_name()
                            .to_str()
                            .and_then(|n| n.strip_suffix(".json"))
                            .filter(|k| valid_name(k))
                            .map(str::to_string)
                    })
                    .collect()
            })
            .unwrap_or_default();
        imported.sort();
        out.extend(
            imported
                .iter()
                .filter(|k| self.catalogue.model(k).is_none())
                .filter_map(|k| self.known(k)),
        );
        out
    }

    /// Stores the manifest of an imported model (a JSON object with `files`, each with `name`,
    /// `role`, `bytes` and `sha256`).
    pub fn put_imported(&self, key: &str, body: &str) -> Result<(), StoreError> {
        if !valid_name(key) {
            return Err(StoreError::BadName);
        }
        if self.catalogue.model(key).is_some() {
            return Err(StoreError::Conflict(format!("{key} is a catalogue model")));
        }
        let v = json::parse(body).map_err(|e| StoreError::BadBody(e.to_string()))?;
        if !matches!(v, Value::Object(_)) {
            return Err(StoreError::BadBody("the manifest is not an object".into()));
        }
        if v.get("key")
            .and_then(Value::as_str)
            .is_some_and(|k| k != key)
        {
            return Err(StoreError::BadBody("'key' differs from the URL".into()));
        }
        parse_files(&v).map_err(StoreError::BadBody)?;
        let _meta = lock(&self.meta);
        fs::create_dir_all(self.imported_dir())?;
        write_atomic(
            &self.imported_dir().join(format!("{key}.json")),
            v.to_json().as_bytes(),
        )?;
        Ok(())
    }

    /// Marks a model installed: every blob it needs must be complete.
    pub fn install(&self, key: &str) -> Result<Vec<String>, StoreError> {
        if !valid_name(key) {
            return Err(StoreError::BadName);
        }
        let model = self.known(key).ok_or(StoreError::UnknownKey)?;
        let _meta = lock(&self.meta);
        let missing: Vec<String> = model
            .files
            .iter()
            .filter(|f| !self.blob_path(&f.sha256).is_file())
            .map(|f| f.name.clone())
            .collect();
        if !missing.is_empty() {
            return Err(StoreError::Missing(missing));
        }
        let mut keys = self.installed_locked();
        if !keys.iter().any(|k| k == key) {
            keys.push(key.to_string());
            self.save_installed(&keys)?;
        }
        Ok(keys)
    }

    /// Uninstalls `key` (and forgets its manifest if it was imported), then deletes its blobs
    /// that no installed model and no model in `keep` (downloads in progress) uses. Returns the
    /// blobs deleted.
    pub fn remove(&self, key: &str, keep: &[String]) -> Result<Vec<String>, StoreError> {
        if !valid_name(key) {
            return Err(StoreError::BadName);
        }
        let model = self.known(key);
        let _meta = lock(&self.meta);
        let mut keys = self.installed_locked();
        let was_installed = keys.iter().any(|k| k == key);
        if model.is_none() && !was_installed {
            return Err(StoreError::UnknownKey);
        }
        keys.retain(|k| k != key);
        if was_installed {
            self.save_installed(&keys)?;
        }
        let Some(model) = model else {
            return Ok(Vec::new());
        };
        if model.source == "imported" {
            remove_if_present(&self.imported_dir().join(format!("{key}.json")))?;
        }
        let used: BTreeSet<String> = keys
            .iter()
            .chain(keep.iter().filter(|k| k.as_str() != key))
            .filter_map(|k| self.known(k))
            .flat_map(|m| m.files.into_iter().map(|f| f.sha256))
            .collect();
        let mut deleted = Vec::new();
        for f in &model.files {
            if used.contains(&f.sha256) || deleted.contains(&f.sha256) {
                continue;
            }
            if self.checking(&f.sha256).is_some() {
                continue;
            }
            let present = self.blob_path(&f.sha256).exists() || self.part_path(&f.sha256).exists();
            self.remove_blob_files(&f.sha256)?;
            if present {
                deleted.push(f.sha256.clone());
            }
        }
        Ok(deleted)
    }

    fn file_json(&self, f: &ModelFile) -> (String, &'static str, u64) {
        let (state, present, extra) = match self.blob(&f.sha256) {
            Ok(Blob::Complete(len)) => ("complete", len, String::new()),
            Ok(Blob::Partial(p)) => {
                let checking = self.checking(&f.sha256);
                (
                    "partial",
                    p.written(),
                    format!(
                        ",\"written\":{},\"contiguous\":{},\"damaged\":{},\"checking\":{}",
                        p.written(),
                        p.contiguous(),
                        p.damaged,
                        checking.is_some()
                    ),
                )
            }
            _ => ("missing", 0, String::new()),
        };
        let mut obj = json::Object::new()
            .str("name", &f.name)
            .str("role", &f.role)
            .str("sha256", &f.sha256)
            .num("bytes", f.bytes as f64)
            .str("state", state)
            .build();
        obj.pop();
        obj.push_str(&extra);
        obj.push('}');
        (obj, state, present)
    }

    /// `GET /api/models`: the installed keys and, for every known model, the state of its
    /// blobs.
    pub fn list_json(&self) -> String {
        let installed = self.installed();
        let models = self.all_known().into_iter().map(|m| {
            let files: Vec<(String, &str, u64)> =
                m.files.iter().map(|f| self.file_json(f)).collect();
            let state = if !files.is_empty() && files.iter().all(|f| f.1 == "complete") {
                "complete"
            } else if files.iter().all(|f| f.1 == "missing") {
                "missing"
            } else {
                "partial"
            };
            let mut o = json::Object::new()
                .str("key", &m.key)
                .str("source", m.source)
                .bool("installed", installed.contains(&m.key))
                .str("state", state)
                .num(
                    "totalBytes",
                    m.files.iter().map(|f| f.bytes).sum::<u64>() as f64,
                )
                .num(
                    "presentBytes",
                    files.iter().map(|f| f.2).sum::<u64>() as f64,
                )
                .raw("files", &json::array(files.into_iter().map(|f| f.0)));
            if let Some(manifest) = &m.manifest {
                o = o.raw(
                    "manifest",
                    &json::parse(manifest).map_or_else(|_| "null".into(), |v| v.to_json()),
                );
            }
            o.build()
        });
        json::Object::new()
            .str("dir", &self.root.to_string_lossy())
            .raw(
                "installed",
                &json::array(installed.iter().map(|k| json::string(k))),
            )
            .raw("models", &json::array(models))
            .build()
    }

    /// The state of one blob as JSON (`GET /api/models/blobs/<sha256>/status`).
    pub fn blob_json(&self, sha: &str) -> Result<String, StoreError> {
        let o = json::Object::new().str("sha256", sha);
        Ok(match self.blob(sha)? {
            Blob::Missing => o
                .str("state", "missing")
                .num("contiguous", 0.0)
                .num("written", 0.0)
                .build(),
            Blob::Complete(len) => o
                .str("state", "complete")
                .num("bytes", len as f64)
                .num("contiguous", len as f64)
                .num("written", len as f64)
                .build(),
            Blob::Partial(p) => {
                let checking = self.checking(sha);
                o.str("state", "partial")
                    .opt_num("total", p.total.map(|t| t as f64))
                    .num("contiguous", p.contiguous() as f64)
                    .num("written", p.written() as f64)
                    .bool("ready", p.ready())
                    .bool("damaged", p.damaged)
                    .opt_str("actual", p.actual.as_deref())
                    .raw(
                        "checking",
                        &checking.map_or_else(
                            || "null".into(),
                            |(done, total)| {
                                json::Object::new()
                                    .num("done", done as f64)
                                    .num("total", total as f64)
                                    .build()
                            },
                        ),
                    )
                    .build()
            }
        })
    }

    /// The path of a complete blob (for `GET`).
    pub fn complete_path(&self, sha: &str) -> Result<PathBuf, StoreError> {
        match self.blob(sha)? {
            Blob::Complete(_) => Ok(self.blob_path(sha)),
            _ => Err(StoreError::NotFound),
        }
    }
}

/// The installer's choice (`pending-models.json`): the device it ran the recommendation for, the
/// models, and (phase U10) the inference runtime it ticked beside them.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Pending {
    /// `gpu` or `cpu`.
    pub device: String,
    /// Model keys (`ai-models.json`), the valid names only.
    pub keys: Vec<String>,
    /// A runtime key (`ai-runtimes.json`): downloaded at the first launch, like the models. Only
    /// the shape of the name is checked here; whether it is a build for this system is the
    /// runtime store's to say.
    pub runtime: Option<String>,
}

/// Reads `pending-models.json`; `None` when there is none or it is not valid.
pub fn load_pending(path: &Path) -> Option<Pending> {
    let text = fs::read_to_string(path).ok()?;
    let v = json::parse(&text).ok()?;
    let device = v.get("device").and_then(Value::as_str)?;
    if device != "gpu" && device != "cpu" {
        return None;
    }
    let keys: Vec<String> = v
        .get("keys")?
        .as_array()?
        .iter()
        .filter_map(|k| k.as_str().filter(|k| valid_name(k)).map(str::to_string))
        .collect();
    let runtime = v
        .get("runtime")
        .and_then(Value::as_str)
        .filter(|k| valid_name(k))
        .map(str::to_string);
    Some(Pending {
        device: device.to_string(),
        keys,
        runtime,
    })
}

/// The installer's choice normalised for the page (`GET /api/pending-models`): `{"device", "keys"}`
/// and `"runtime"` when the installer ticked one; `None` when there is no valid choice.
pub fn read_pending(path: &Path) -> Option<String> {
    let p = load_pending(path)?;
    let mut o = json::Object::new()
        .str("device", &p.device)
        .raw("keys", &json::array(p.keys.iter().map(|k| json::string(k))));
    if let Some(r) = &p.runtime {
        o = o.str("runtime", r);
    }
    Some(o.build())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::recommend::{Model, Row};

    fn sha(data: &[u8]) -> String {
        hex(&Sha256::digest(data))
    }

    fn data(n: usize, seed: u8) -> Vec<u8> {
        (0..n)
            .map(|i| (i as u32 * 31 + u32::from(seed) * 7 + (i as u32 >> 9)) as u8)
            .collect()
    }

    fn model(key: &str, files: &[(&str, &[u8])]) -> Model {
        Model {
            key: key.into(),
            label_en: key.into(),
            label_es: key.into(),
            summary_en: String::new(),
            summary_es: String::new(),
            runtimes: vec!["desktop".into()],
            default: false,
            available: true,
            licence: "Apache-2.0".into(),
            commercial: true,
            restrictions: false,
            total_bytes: files.iter().map(|(_, d)| d.len() as u64).sum(),
            files: files
                .iter()
                .map(|(name, d)| ModelFile {
                    role: "transformer".into(),
                    name: (*name).into(),
                    bytes: d.len() as u64,
                    sha256: sha(d),
                })
                .collect(),
        }
    }

    /// Two models sharing a text encoder, like ZIMAGE_Q8 and ZIMAGE_Q4.
    fn store(name: &str) -> (Store, Vec<u8>, Vec<u8>, Vec<u8>) {
        let a = data(300_000, 1);
        let b = data(200_000, 2);
        let shared = data(150_001, 3);
        let catalogue = Catalogue {
            models: vec![
                model("BIG", &[("big.gguf", &a), ("encoder.gguf", &shared)]),
                model("SMALL", &[("small.gguf", &b), ("encoder.gguf", &shared)]),
            ],
            rows: Vec::<Row>::new(),
            provisional: true,
        };
        let dir = crate::test_dir(name);
        (Store::new(dir.join("models"), catalogue), a, b, shared)
    }

    fn put(store: &Store, data: &[u8], start: usize, end: usize) -> Result<Blob, StoreError> {
        let mut chunk = &data[start..end];
        store.write_chunk(
            &sha(data),
            start as u64,
            Some(data.len() as u64),
            (end - start) as u64,
            &mut chunk,
        )
    }

    fn download(store: &Store, data: &[u8]) {
        for (s, e) in [(0, data.len() / 2), (data.len() / 2, data.len())] {
            put(store, data, s, e).unwrap();
        }
        store.finish(&sha(data), Some(data.len() as u64)).unwrap();
    }

    #[test]
    fn ranges_merge() {
        let mut p = Part::default();
        p.add(10, 20);
        p.add(30, 40);
        assert_eq!(p.contiguous(), 0);
        p.add(0, 10);
        assert_eq!(p.ranges, [(0, 20), (30, 40)]);
        assert_eq!((p.contiguous(), p.written()), (20, 30));
        p.add(15, 35);
        assert_eq!(p.ranges, [(0, 40)]);
        p.add(5, 5);
        assert_eq!(p.ranges, [(0, 40)]);
        p.total = Some(40);
        assert!(p.ready());
        assert_eq!(Part::from_json(&p.to_json()), Some(p));
    }

    #[test]
    fn chunks_out_of_order_and_resumed_give_the_expected_sha256() {
        let (store, a, _, _) = store("models-out-of-order");
        let id = sha(&a);
        // Chunks of odd sizes, out of order; the download is "interrupted" after three.
        let cuts = [0usize, 65_537, 100_000, 177_777, 250_000, a.len()];
        let order = [3usize, 0, 4];
        for &i in &order {
            put(&store, &a, cuts[i], cuts[i + 1]).unwrap();
        }
        // A reopened store (the application restarted) knows where to resume.
        let catalogue = store.catalogue.clone();
        let store = Store::new(store.root().to_path_buf(), catalogue);
        let Blob::Partial(part) = store.blob(&id).unwrap() else {
            panic!("partial expected")
        };
        assert_eq!(part.contiguous(), cuts[1] as u64);
        assert_eq!(part.total, Some(a.len() as u64));
        assert!(matches!(
            store.finish(&id, None),
            Err(StoreError::Incomplete { contiguous: 65_537 })
        ));
        // Resume from the first missing byte; one chunk overlaps what is there.
        put(&store, &a, cuts[1] - 10, cuts[2]).unwrap();
        put(&store, &a, cuts[2], cuts[3]).unwrap();
        assert!(store.blob_json(&id).unwrap().contains("\"ready\":true"));
        assert_eq!(
            store.finish(&id, Some(a.len() as u64)).unwrap(),
            a.len() as u64
        );
        assert_eq!(store.blob(&id).unwrap(), Blob::Complete(a.len() as u64));
        assert_eq!(fs::read(store.complete_path(&id).unwrap()).unwrap(), a);
        assert!(!store.part_path(&id).exists() && !store.ranges_path(&id).exists());
        // Finishing again is harmless; writing to a complete blob changes nothing.
        assert!(store.finish(&id, None).is_ok());
        assert!(matches!(put(&store, &a, 0, 10), Ok(Blob::Complete(_))));
    }

    #[test]
    fn a_wrong_hash_leaves_the_part_damaged() {
        let (store, a, _, _) = store("models-damaged");
        let id = sha(&a);
        let mut bad = a.clone();
        bad[123_456] ^= 1;
        let mut chunk = &bad[..];
        store
            .write_chunk(&id, 0, Some(a.len() as u64), a.len() as u64, &mut chunk)
            .unwrap();
        let Err(StoreError::Mismatch { actual }) = store.finish(&id, None) else {
            panic!("mismatch expected")
        };
        assert_eq!(actual, sha(&bad));
        assert!(store.part_path(&id).exists(), "the part is kept");
        assert!(!store.blob_path(&id).exists());
        let Blob::Partial(part) = store.blob(&id).unwrap() else {
            panic!("partial expected")
        };
        assert!(part.damaged);
        assert!(matches!(put(&store, &a, 0, 10), Err(StoreError::Damaged)));
        assert!(matches!(store.finish(&id, None), Err(StoreError::Damaged)));
        // Deleted, it downloads again from scratch.
        store.delete_blob(&id).unwrap();
        assert_eq!(store.blob(&id).unwrap(), Blob::Missing);
        download(&store, &a);
        assert!(matches!(store.blob(&id).unwrap(), Blob::Complete(_)));
    }

    #[test]
    fn bad_names_sizes_and_totals_are_refused() {
        let (store, a, _, _) = store("models-refusals");
        let id = sha(&a);
        let mut empty: &[u8] = &[];
        for bad in ["", "../x", &"A".repeat(64), &"a".repeat(63)] {
            assert!(matches!(
                store.write_chunk(bad, 0, None, 0, &mut empty),
                Err(StoreError::BadName)
            ));
        }
        let mut chunk = &a[..10];
        assert!(matches!(
            store.write_chunk(&id, 5, Some(10), 10, &mut chunk),
            Err(StoreError::OutOfRange)
        ));
        put(&store, &a, 0, 10).unwrap();
        let mut chunk = &a[10..20];
        assert!(matches!(
            store.write_chunk(&id, 10, Some(99), 10, &mut chunk),
            Err(StoreError::Conflict(_))
        ));
        // A chunk cut short still records what arrived.
        let mut short = &a[10..15];
        assert!(store.write_chunk(&id, 10, None, 10, &mut short).is_err());
        let Blob::Partial(part) = store.blob(&id).unwrap() else {
            panic!()
        };
        assert_eq!(part.contiguous(), 15);
    }

    #[test]
    fn a_shared_blob_stays_while_another_installed_model_uses_it() {
        let (store, a, b, shared) = store("models-shared");
        assert!(matches!(store.install("BIG"), Err(StoreError::Missing(_))));
        download(&store, &a);
        download(&store, &shared);
        assert_eq!(store.install("BIG").unwrap(), ["BIG"]);
        download(&store, &b);
        assert_eq!(store.install("SMALL").unwrap(), ["BIG", "SMALL"]);
        assert!(matches!(
            store.delete_blob(&sha(&shared)),
            Err(StoreError::Conflict(_))
        ));
        let list = store.list_json();
        assert!(list.contains("\"installed\":[\"BIG\",\"SMALL\"]"));
        // Deleting BIG keeps the encoder SMALL needs.
        let deleted = store.remove("BIG", &[]).unwrap();
        assert_eq!(deleted, [sha(&a)]);
        assert!(store.blob_path(&sha(&shared)).is_file());
        assert_eq!(store.installed(), ["SMALL"]);
        // A download in progress protects its blobs too (`keep`).
        put(&store, &a, 0, 1000).unwrap();
        assert!(store.remove("SMALL", &["BIG".into()]).unwrap() == [sha(&b)]);
        assert!(store.blob_path(&sha(&shared)).is_file());
        assert!(store.part_path(&sha(&a)).is_file());
        // Without anyone left, everything goes.
        let gone = store.remove("BIG", &[]).unwrap();
        assert_eq!(gone, [sha(&a), sha(&shared)]);
        assert!(!store.blobs().join(sha(&shared)).exists());
        assert!(matches!(
            store.remove("NOPE", &[]),
            Err(StoreError::UnknownKey)
        ));
    }

    #[test]
    fn imported_models_and_listing() {
        let (store, a, _, shared) = store("models-imported");
        let manifest = format!(
            r#"{{"key":"MINE","label":"My model","licence":{{"spdx":"unknown"}},"files":[{{"name":"mine.safetensors","role":"transformer","bytes":{},"sha256":"{}"}},{{"name":"encoder.gguf","role":"text-encoder","bytes":{},"sha256":"{}"}}]}}"#,
            a.len(),
            sha(&a),
            shared.len(),
            sha(&shared)
        );
        assert!(matches!(
            store.put_imported("BIG", &manifest),
            Err(StoreError::Conflict(_))
        ));
        assert!(matches!(
            store.put_imported("OTHER", &manifest),
            Err(StoreError::BadBody(_))
        ));
        assert!(matches!(
            store.put_imported(
                "MINE",
                r#"{"files":[{"name":"../x","role":"vae","bytes":1,"sha256":"00"}]}"#
            ),
            Err(StoreError::BadBody(_))
        ));
        store.put_imported("MINE", &manifest).unwrap();
        put(&store, &shared, 0, 100).unwrap();
        let list = json::parse(&store.list_json()).unwrap();
        let models = list.get("models").unwrap().as_array().unwrap();
        let keys: Vec<&str> = models
            .iter()
            .map(|m| m.get("key").unwrap().as_str().unwrap())
            .collect();
        assert_eq!(keys, ["BIG", "SMALL", "MINE"]);
        let mine = &models[2];
        assert_eq!(mine.get("source").unwrap().as_str(), Some("imported"));
        assert_eq!(mine.get("state").unwrap().as_str(), Some("partial"));
        let files = mine.get("files").unwrap().as_array().unwrap();
        assert_eq!(files[0].get("state").unwrap().as_str(), Some("missing"));
        assert_eq!(files[1].get("state").unwrap().as_str(), Some("partial"));
        assert_eq!(files[1].get("contiguous").unwrap().as_f64(), Some(100.0));
        assert_eq!(mine.get("presentBytes").unwrap().as_f64(), Some(100.0));
        assert!(mine.get("manifest").unwrap().get("label").is_some());
        download(&store, &a);
        store.finish(&sha(&shared), None).unwrap_err();
        put(&store, &shared, 100, shared.len()).unwrap();
        store.finish(&sha(&shared), None).unwrap();
        store.install("MINE").unwrap();
        store.remove("MINE", &[]).unwrap();
        assert!(store.known("MINE").is_none(), "the manifest is gone");
    }

    #[test]
    fn pending_models_are_validated() {
        let dir = crate::test_dir("models-pending");
        let path = dir.join("pending-models.json");
        assert_eq!(read_pending(&path), None);
        fs::write(
            &path,
            "\u{feff}{ \"device\": \"gpu\", \"keys\": [\"ZIMAGE_Q8\", \"../bad\", 3] }",
        )
        .unwrap();
        assert_eq!(
            read_pending(&path).as_deref(),
            Some(r#"{"device":"gpu","keys":["ZIMAGE_Q8"]}"#)
        );
        fs::write(&path, r#"{"device":"tpu","keys":[]}"#).unwrap();
        assert_eq!(read_pending(&path), None);
        fs::write(&path, "not json").unwrap();
        assert_eq!(read_pending(&path), None);
    }

    #[test]
    fn pending_models_carry_the_runtime_the_installer_ticked() {
        let dir = crate::test_dir("models-pending-runtime");
        let path = dir.join("pending-models.json");
        // What models-page.nsh writes with a model chosen and the runtime ticked.
        fs::write(
            &path,
            "{\"device\": \"gpu\", \"keys\": [\"ZIMAGE_Q8\"], \"runtime\": \"SDCPP_WIN_VULKAN\"}\r\n",
        )
        .unwrap();
        assert_eq!(
            read_pending(&path).as_deref(),
            Some(r#"{"device":"gpu","keys":["ZIMAGE_Q8"],"runtime":"SDCPP_WIN_VULKAN"}"#)
        );
        assert_eq!(
            load_pending(&path),
            Some(Pending {
                device: "gpu".into(),
                keys: vec!["ZIMAGE_Q8".into()],
                runtime: Some("SDCPP_WIN_VULKAN".into()),
            })
        );
        // Unticked: no member at all, so the page sees `undefined`.
        fs::write(&path, r#"{"device":"cpu","keys":["SD15_LIGHT"]}"#).unwrap();
        assert_eq!(
            read_pending(&path).as_deref(),
            Some(r#"{"device":"cpu","keys":["SD15_LIGHT"]}"#)
        );
        // A runtime that is not a name (a path, another type) is dropped; the models stay.
        for bad in [r#""../x""#, r#""""#, "3", "null", r#""a b""#] {
            fs::write(
                &path,
                format!(r#"{{"device":"gpu","keys":["ZIMAGE_Q8"],"runtime":{bad}}}"#),
            )
            .unwrap();
            assert_eq!(
                read_pending(&path).as_deref(),
                Some(r#"{"device":"gpu","keys":["ZIMAGE_Q8"]}"#),
                "{bad}"
            );
        }
    }
}
