//! The interface's files, from the `app/` folder, and the file responses (with `Range`) that the
//! model store reuses.
//!
//! A request path can never leave the folder: it must be absolute, without NUL, backslashes,
//! empty, `.` or `..` segments, and the canonical path of the file must still start with the
//! canonical folder (which also stops symbolic links that point outside).

use crate::http::{parse_range, Body, RangeAnswer, Request, Response};
use crate::sha256::{hex, Sha256};
use std::fs::File;
use std::io::{self, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

/// The media type of a file name.
pub fn mime(name: &str) -> &'static str {
    let ext = name
        .rsplit_once('.')
        .map(|(_, e)| e.to_ascii_lowercase())
        .unwrap_or_default();
    match ext.as_str() {
        "html" | "htm" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" | "map" => "application/json; charset=utf-8",
        "webmanifest" => "application/manifest+json; charset=utf-8",
        "wasm" => "application/wasm",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "ico" => "image/x-icon",
        "txt" | "md" => "text/plain; charset=utf-8",
        "woff2" => "font/woff2",
        "woff" => "font/woff",
        "ttf" => "font/ttf",
        "glb" => "model/gltf-binary",
        "gltf" => "model/gltf+json",
        "xml" => "application/xml",
        _ => "application/octet-stream",
    }
}

/// Why a path is not served.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PathError {
    /// A forbidden form (`..`, NUL, backslash...): 400.
    Forbidden,
    /// No such file inside the folder: 404.
    NotFound,
}

/// The file under `root` that the decoded URL `path` names (`/` and folders give `index.html`).
pub fn resolve(root: &Path, path: &str) -> Result<PathBuf, PathError> {
    let rel = path.strip_prefix('/').ok_or(PathError::Forbidden)?;
    if rel.contains(['\0', '\\']) || rel.contains(':') {
        return Err(PathError::Forbidden);
    }
    let mut segments: Vec<&str> = rel.split('/').collect();
    if segments.last() == Some(&"") {
        segments.pop();
        segments.push("index.html");
    }
    if segments
        .iter()
        .any(|s| s.is_empty() || *s == "." || *s == "..")
    {
        return Err(PathError::Forbidden);
    }
    let base = root.canonicalize().map_err(|_| PathError::NotFound)?;
    let mut candidate = base.clone();
    for s in &segments {
        candidate.push(s);
    }
    let mut real = candidate.canonicalize().map_err(|_| PathError::NotFound)?;
    if real.is_dir() {
        real = real
            .join("index.html")
            .canonicalize()
            .map_err(|_| PathError::NotFound)?;
    }
    if !real.starts_with(&base) || !real.is_file() {
        return Err(PathError::NotFound);
    }
    Ok(real)
}

/// What a file Vite named by content hash is told: it never changes under that name.
const IMMUTABLE: &str = "public, max-age=31536000, immutable";

/// The largest file whose ETag is made from its bytes (the interface's own small assets).
const CONTENT_ETAG_LIMIT: u64 = 8 << 20;

/// True for the build's own chunks and files: directly inside `/assets/` and named `name-HASH.ext`, where
/// the hash is the 8 characters (letters, digits, `_` and `-`) that Vite puts before the extension.
/// The generated assets that `public/assets/` adds (`aperture/`, `gobo/`, their `index.json`) are not
/// hashed and can change from one version to the next under the same name, so they are never immutable.
pub fn is_hashed_asset(path: &str) -> bool {
    let Some(name) = path.strip_prefix("/assets/") else {
        return false;
    };
    if name.contains('/') || name.ends_with(".html") {
        return false;
    }
    let Some((stem, ext)) = name.rsplit_once('.') else {
        return false;
    };
    let bytes = stem.as_bytes();
    // At least one character of name, the dash, and the 8 of the hash.
    if bytes.len() < 10 || ext.is_empty() || !ext.bytes().all(|b| b.is_ascii_alphanumeric()) {
        return false;
    }
    let (head, hash) = bytes.split_at(bytes.len() - 8);
    head[head.len() - 1] == b'-'
        && hash
            .iter()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-'))
}

/// A strong ETag from the bytes of a small file: its SHA-256 in quotes.
fn content_etag(path: &Path) -> Option<String> {
    let mut file = File::open(path).ok()?;
    if file.metadata().ok()?.len() > CONTENT_ETAG_LIMIT {
        return None;
    }
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes).ok()?;
    Some(format!("\"{}\"", hex(&Sha256::digest(&bytes))))
}

/// Serves an interface file (GET or HEAD).
///
/// Only the files that Vite named by content hash are immutable. Everything else is revalidated on every
/// request (`no-cache`); a small file under `/assets/` that is not hashed (the generated aperture masks and
/// gobos) is tagged with the hash of its bytes, so a regenerated file is never taken for the old one even if
/// its size and time are the same, and an unchanged one costs a 304.
pub fn serve(root: &Path, req: &Request) -> Response {
    match resolve(root, &req.path) {
        Ok(path) => {
            let name = path
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default();
            if is_hashed_asset(&req.path) {
                return file_response(&path, req, mime(&name), IMMUTABLE);
            }
            let etag = if req.path.starts_with("/assets/") {
                content_etag(&path)
            } else {
                None
            };
            file_response_tagged(&path, req, mime(&name), "no-cache", etag)
        }
        Err(PathError::Forbidden) => Response::text(400, "bad path"),
        Err(PathError::NotFound) => Response::text(404, "not found"),
    }
}

/// A file as a response: 200, or 206 / 416 for a `Range`, or 304 when `If-None-Match` matches.
pub fn file_response(path: &Path, req: &Request, content_type: &str, cache: &str) -> Response {
    file_response_tagged(path, req, content_type, cache, None)
}

/// [`file_response`] with the ETag given by the caller (default: the size and the modification time).
fn file_response_tagged(
    path: &Path,
    req: &Request,
    content_type: &str,
    cache: &str,
    etag: Option<String>,
) -> Response {
    let Ok(mut file) = File::open(path) else {
        return Response::text(404, "not found");
    };
    let Ok(meta) = file.metadata() else {
        return Response::text(404, "not found");
    };
    let len = meta.len();
    let mtime = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map_or(0, |d| d.as_nanos());
    let etag = etag.unwrap_or_else(|| format!("\"{len:x}-{mtime:x}\""));
    let common = |r: Response| {
        r.with("Cache-Control", cache)
            .with("Accept-Ranges", "bytes")
            .with("ETag", &etag)
    };
    if req.header("if-none-match") == Some(etag.as_str()) {
        return common(Response::empty(304));
    }
    let (status, start, count) = match parse_range(req.header("range"), len) {
        RangeAnswer::Whole => (200, 0, len),
        RangeAnswer::Partial { start, end } => (206, start, end - start + 1),
        RangeAnswer::Unsatisfiable => {
            return common(Response::text(416, "range not satisfiable"))
                .with("Content-Range", &format!("bytes */{len}"));
        }
    };
    if file.seek(SeekFrom::Start(start)).is_err() {
        return Response::text(500, "cannot read the file");
    }
    let mut response = common(Response {
        status,
        headers: vec![("Content-Type".into(), content_type.into())],
        body: Body::Stream {
            len: count,
            write: Box::new(move |w| {
                let copied = io::copy(&mut file.take(count), w)?;
                if copied == count {
                    Ok(())
                } else {
                    Err(io::Error::new(
                        io::ErrorKind::UnexpectedEof,
                        "the file got shorter",
                    ))
                }
            }),
        },
    });
    if status == 206 {
        response = response.with(
            "Content-Range",
            &format!("bytes {start}-{}/{len}", start + count - 1),
        );
    }
    response
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::http::write_response;

    fn request(path: &str, headers: &[(&str, &str)]) -> Request {
        Request {
            method: "GET".into(),
            target: path.into(),
            path: path.into(),
            query: Vec::new(),
            http11: true,
            headers: headers
                .iter()
                .map(|(n, v)| (n.to_string(), v.to_string()))
                .collect(),
            content_length: 0,
        }
    }

    fn body(r: Response) -> (u16, Vec<(String, String)>, Vec<u8>) {
        let status = r.status;
        let headers = r.headers.clone();
        let mut out = Vec::new();
        write_response(&mut out, r, false, true).unwrap();
        let split = out.windows(4).position(|w| w == b"\r\n\r\n").unwrap();
        (status, headers, out[split + 4..].to_vec())
    }

    fn site() -> PathBuf {
        let dir = crate::test_dir("static-site");
        std::fs::create_dir_all(dir.join("app/assets")).unwrap();
        std::fs::create_dir_all(dir.join("app/engine")).unwrap();
        std::fs::write(dir.join("app/index.html"), "<!doctype html>hi").unwrap();
        std::fs::write(dir.join("app/assets/a-AbCd1234.js"), "console.log(1)").unwrap();
        std::fs::write(dir.join("app/engine/rt.wasm"), b"\0asm0123456789").unwrap();
        std::fs::write(dir.join("secret.txt"), "outside").unwrap();
        dir
    }

    fn header(r: &Response, name: &str) -> Option<String> {
        r.headers
            .iter()
            .find(|(n, _)| n == name)
            .map(|(_, v)| v.clone())
    }

    #[test]
    fn paths_cannot_leave_the_folder() {
        let dir = site();
        let root = dir.join("app");
        assert_eq!(
            resolve(&root, "/").unwrap(),
            root.join("index.html").canonicalize().unwrap()
        );
        assert!(resolve(&root, "/assets/a-AbCd1234.js").is_ok());
        assert_eq!(
            resolve(&root, "/engine/").unwrap_err(),
            PathError::NotFound,
            "a folder without index.html"
        );
        for bad in [
            "/../secret.txt",
            "/assets/../../secret.txt",
            "/./index.html",
            "//etc/passwd",
            "/assets//a-AbCd1234.js",
            "/..\\secret.txt",
            "/a\0b",
            "/C:/Windows/win.ini",
            "relative",
        ] {
            assert_eq!(resolve(&root, bad), Err(PathError::Forbidden), "{bad:?}");
        }
        assert_eq!(resolve(&root, "/missing.js"), Err(PathError::NotFound));
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(dir.join("secret.txt"), root.join("link.txt")).unwrap();
            assert_eq!(resolve(&root, "/link.txt"), Err(PathError::NotFound));
        }
    }

    #[test]
    fn mime_types_and_caching() {
        assert_eq!(mime("rt.wasm"), "application/wasm");
        assert_eq!(mime("index.HTML"), "text/html; charset=utf-8");
        assert_eq!(mime("x.mjs"), "text/javascript; charset=utf-8");
        assert_eq!(mime("noext"), "application/octet-stream");
        assert_eq!(
            mime("manifest.webmanifest"),
            "application/manifest+json; charset=utf-8"
        );
        assert_eq!(mime("favicon.ico"), "image/x-icon");
        let dir = site();
        let root = dir.join("app");
        let (status, headers, bytes) = body(serve(&root, &request("/", &[])));
        assert_eq!(status, 200);
        assert_eq!(bytes, b"<!doctype html>hi");
        assert!(headers.contains(&("Cache-Control".into(), "no-cache".into())));
        assert!(headers.contains(&("Content-Type".into(), "text/html; charset=utf-8".into())));
        let (_, headers, _) = body(serve(&root, &request("/assets/a-AbCd1234.js", &[])));
        assert!(headers
            .iter()
            .any(|(n, v)| n == "Cache-Control" && v.contains("immutable")));
        let (_, headers, _) = body(serve(&root, &request("/engine/rt.wasm", &[])));
        assert!(headers.contains(&("Content-Type".into(), "application/wasm".into())));
        assert_eq!(serve(&root, &request("/../secret.txt", &[])).status, 400);
        assert_eq!(serve(&root, &request("/nope", &[])).status, 404);
    }

    #[test]
    fn ranges_and_conditional_requests() {
        let dir = site();
        let root = dir.join("app");
        let (status, headers, bytes) = body(serve(
            &root,
            &request("/engine/rt.wasm", &[("range", "bytes=4-7")]),
        ));
        assert_eq!(status, 206);
        assert_eq!(bytes, b"0123");
        assert!(headers.contains(&("Content-Range".into(), "bytes 4-7/14".into())));
        let (status, _, bytes) = body(serve(
            &root,
            &request("/engine/rt.wasm", &[("range", "bytes=-2")]),
        ));
        assert_eq!((status, bytes.as_slice()), (206, &b"89"[..]));
        let (status, headers, _) = body(serve(
            &root,
            &request("/engine/rt.wasm", &[("range", "bytes=14-")]),
        ));
        assert_eq!(status, 416);
        assert!(headers.contains(&("Content-Range".into(), "bytes */14".into())));
        let first = serve(&root, &request("/", &[]));
        let etag = first
            .headers
            .iter()
            .find(|(n, _)| n == "ETag")
            .map(|(_, v)| v.clone())
            .unwrap();
        let again = serve(&root, &request("/", &[("if-none-match", &etag)]));
        assert_eq!(again.status, 304);
        assert!(again.is_empty());
    }

    /// The names Vite gave the chunks of this very build (`dist/assets/`, Vite 8: `[name]-[hash]`, 8 characters
    /// of base64url) and the names `public/assets/` adds without a hash (phase A6).
    const VITE_NAMES: [&str; 8] = [
        "/assets/index-CrEVO15M.js",
        "/assets/index-CSYxRB1J.css",
        "/assets/fflate.module-DXbirBWY.js",
        "/assets/BufferGeometryUtils-CKdCIbpA.js",
        "/assets/step-worker-CS6AyHqv.js",
        "/assets/model-worker-BIUC3TRQ.js",
        "/assets/worker-eCYHXH04.js",
        "/assets/x-Ab-d_123.js",
    ];
    const UNHASHED_NAMES: [&str; 14] = [
        "/assets/aperture/index.json",
        "/assets/aperture/polygon-03.png",
        "/assets/aperture/polygon-03-curved.png",
        "/assets/aperture/filter-mesh.png",
        "/assets/gobo/index.json",
        "/assets/gobo/leaves-dense.png",
        "/assets/gobo/window-arched.png",
        "/assets/gobo/blinds-angled.png",
        "/assets/README.md",
        "/assets/scratches.png",
        // Hash-like names in a folder are still not the build's own.
        "/assets/aperture/index-CrEVO15M.js",
        // Too short, no name, no extension, an HTML page.
        "/assets/index-short.js",
        "/assets/-AbCd1234.js",
        "/assets/index-CrEVO15M",
    ];

    #[test]
    fn is_hashed_asset_matches_what_vite_emits_and_nothing_else() {
        for name in VITE_NAMES {
            assert!(is_hashed_asset(name), "{name}");
        }
        for name in UNHASHED_NAMES {
            assert!(!is_hashed_asset(name), "{name}");
        }
        assert!(!is_hashed_asset("/index-CrEVO15M.js"), "outside assets/");
        assert!(!is_hashed_asset("/assets/index-CrEVO15M.html"));
        assert!(!is_hashed_asset("/vendor/occt-import-js/occt-import-js.js"));
    }

    #[test]
    fn only_files_with_a_content_hash_are_immutable() {
        let dir = site();
        let root = dir.join("app");
        for name in VITE_NAMES.iter().chain(UNHASHED_NAMES.iter()) {
            let file = root.join(name.trim_start_matches('/'));
            if file.extension().is_none() {
                continue;
            }
            std::fs::create_dir_all(file.parent().unwrap()).unwrap();
            std::fs::write(&file, name.as_bytes()).unwrap();
        }
        for name in VITE_NAMES {
            let r = serve(&root, &request(name, &[]));
            assert_eq!(r.status, 200, "{name}");
            assert_eq!(
                header(&r, "Cache-Control").as_deref(),
                Some("public, max-age=31536000, immutable"),
                "{name}"
            );
        }
        for name in UNHASHED_NAMES {
            if !root.join(name.trim_start_matches('/')).is_file() {
                continue;
            }
            let r = serve(&root, &request(name, &[]));
            assert_eq!(r.status, 200, "{name}");
            let cache = header(&r, "Cache-Control").unwrap();
            assert_eq!(
                cache, "no-cache",
                "{name} must be revalidated, not immutable"
            );
            assert!(!cache.contains("immutable"), "{name}");
            assert!(header(&r, "ETag").is_some(), "{name}");
        }
        // The real aperture and gobo folders: a PNG and the index of each.
        for name in [
            "/assets/aperture/polygon-03.png",
            "/assets/gobo/leaves-dense.png",
            "/assets/aperture/index.json",
            "/assets/gobo/index.json",
        ] {
            let r = serve(&root, &request(name, &[]));
            assert_ne!(
                header(&r, "Cache-Control").as_deref(),
                Some("public, max-age=31536000, immutable"),
                "{name}"
            );
        }
    }

    #[test]
    fn an_unhashed_asset_is_tagged_by_its_bytes_and_a_changed_file_is_never_a_304() {
        let dir = site();
        let root = dir.join("app");
        let file = root.join("assets/aperture/index.json");
        std::fs::create_dir_all(file.parent().unwrap()).unwrap();
        std::fs::write(&file, b"{\"v\":1}").unwrap();
        let before = std::fs::metadata(&file).unwrap().modified().unwrap();

        let first = serve(&root, &request("/assets/aperture/index.json", &[]));
        let etag = header(&first, "ETag").unwrap();
        // A strong ETag (no W/) made of the SHA-256 of the bytes.
        assert_eq!(etag, format!("\"{}\"", hex(&Sha256::digest(b"{\"v\":1}"))));
        let same = serve(
            &root,
            &request("/assets/aperture/index.json", &[("if-none-match", &etag)]),
        );
        assert_eq!(same.status, 304);
        assert!(same.is_empty());
        assert_eq!(header(&same, "Cache-Control").as_deref(), Some("no-cache"));

        // The file is regenerated: other bytes, the same length and the same modification time (as in a package that
        // normalises its timestamps). Size and time cannot tell, the bytes can.
        std::fs::write(&file, b"{\"v\":2}").unwrap();
        File::options()
            .write(true)
            .open(&file)
            .unwrap()
            .set_modified(before)
            .unwrap();
        let changed = serve(
            &root,
            &request("/assets/aperture/index.json", &[("if-none-match", &etag)]),
        );
        assert_eq!(
            changed.status, 200,
            "the old ETag must not match the new bytes"
        );
        assert_ne!(header(&changed, "ETag").unwrap(), etag);

        // The interface's own files keep the size and time tag: no hashing of a big file for every request.
        let r = serve(&root, &request("/engine/rt.wasm", &[]));
        assert!(header(&r, "ETag").unwrap().contains('-'));
    }
}
