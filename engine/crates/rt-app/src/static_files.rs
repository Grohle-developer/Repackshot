//! The interface's files, from the `app/` folder, and the file responses (with `Range`) that the
//! model store reuses.
//!
//! A request path can never leave the folder: it must be absolute, without NUL, backslashes,
//! empty, `.` or `..` segments, and the canonical path of the file must still start with the
//! canonical folder (which also stops symbolic links that point outside).

use crate::http::{parse_range, Body, RangeAnswer, Request, Response};
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

/// Serves an interface file (GET or HEAD).
pub fn serve(root: &Path, req: &Request) -> Response {
    match resolve(root, &req.path) {
        Ok(path) => {
            let name = path
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default();
            // Vite names everything under assets/ by content hash; the rest is checked every time.
            let cache = if req.path.starts_with("/assets/") && !name.ends_with(".html") {
                "public, max-age=31536000, immutable"
            } else {
                "no-cache"
            };
            file_response(&path, req, mime(&name), cache)
        }
        Err(PathError::Forbidden) => Response::text(400, "bad path"),
        Err(PathError::NotFound) => Response::text(404, "not found"),
    }
}

/// A file as a response: 200, or 206 / 416 for a `Range`, or 304 when `If-None-Match` matches.
pub fn file_response(path: &Path, req: &Request, content_type: &str, cache: &str) -> Response {
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
    let etag = format!("\"{len:x}-{mtime:x}\"");
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
        std::fs::write(dir.join("app/assets/a-1234.js"), "console.log(1)").unwrap();
        std::fs::write(dir.join("app/engine/rt.wasm"), b"\0asm0123456789").unwrap();
        std::fs::write(dir.join("secret.txt"), "outside").unwrap();
        dir
    }

    #[test]
    fn paths_cannot_leave_the_folder() {
        let dir = site();
        let root = dir.join("app");
        assert_eq!(
            resolve(&root, "/").unwrap(),
            root.join("index.html").canonicalize().unwrap()
        );
        assert!(resolve(&root, "/assets/a-1234.js").is_ok());
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
            "/assets//a-1234.js",
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
        let dir = site();
        let root = dir.join("app");
        let (status, headers, bytes) = body(serve(&root, &request("/", &[])));
        assert_eq!(status, 200);
        assert_eq!(bytes, b"<!doctype html>hi");
        assert!(headers.contains(&("Cache-Control".into(), "no-cache".into())));
        assert!(headers.contains(&("Content-Type".into(), "text/html; charset=utf-8".into())));
        let (_, headers, _) = body(serve(&root, &request("/assets/a-1234.js", &[])));
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
}
