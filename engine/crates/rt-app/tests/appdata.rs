//! The page's state in the data folder (phase P3e) over real sockets: the same security as every
//! other endpoint, names confined to the data folder, atomic writes, and everything still there
//! for the next launch.

mod common;

use common::{TestServer, TOKEN};
use rt_app::json::Value;
use rt_app::paths::Paths;
use rt_app::server::Server;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::time::Duration;

/// Every file under `dir` whose name ends in `.tmp`: an atomic write never leaves one.
fn temporaries(dir: &std::path::Path) -> Vec<String> {
    let mut out = Vec::new();
    let mut stack = vec![dir.to_path_buf()];
    while let Some(p) = stack.pop() {
        for e in std::fs::read_dir(&p).into_iter().flatten().flatten() {
            let path = e.path();
            if path.is_dir() {
                stack.push(path);
            } else if path.to_string_lossy().ends_with(".tmp") {
                out.push(path.to_string_lossy().into_owned());
            }
        }
    }
    out
}

#[test]
fn the_store_wants_the_token_its_host_and_its_origin() {
    let t = TestServer::start("appdata-security", 1);
    let port = t.port();
    for (method, path) in [
        ("GET", "/api/store/settings"),
        ("PUT", "/api/store/settings"),
        ("GET", "/api/store/docs"),
        ("PUT", "/api/store/docs/x"),
        ("GET", "/api/store/library"),
        ("GET", "/api/store/results"),
        ("PUT", "/api/store/results/r1?type=image/png"),
        ("DELETE", "/api/store/results"),
        ("PUT", "/api/store/cache/k"),
        ("GET", "/api/storage/usage"),
    ] {
        assert_eq!(
            t.raw(method, path, &[], b"{}").status,
            401,
            "{method} {path}"
        );
        assert_eq!(
            t.raw(
                method,
                path,
                &[
                    ("X-Repackshot-Token", TOKEN),
                    ("Origin", "https://evil.example")
                ],
                b"{}"
            )
            .status,
            403,
            "{method} {path}"
        );
        assert_eq!(
            t.raw(
                method,
                path,
                &[("X-Repackshot-Token", TOKEN), ("Host", "evil.example:80")],
                b"{}"
            )
            .status,
            421,
            "{method} {path}"
        );
    }
    // The app's own origin is fine; nothing was written by the refused requests.
    let own = t.raw(
        "GET",
        "/api/store/settings",
        &[
            ("X-Repackshot-Token", TOKEN),
            ("Origin", &format!("http://127.0.0.1:{port}")),
        ],
        b"",
    );
    assert_eq!(own.status, 200);
    assert_eq!(own.text(), "null");
    assert_eq!(own.header("cache-control"), Some("no-store"));
    assert!(!t.dir.join("data/settings.json").exists());
    assert!(!t.dir.join("data/state").exists());
}

#[test]
fn settings_documents_and_the_library_survive_a_new_launch() {
    let t = TestServer::start("appdata-docs", 1);
    let settings = br#"{"schema":3,"settings":{"general.lang":"es"},"layout":{"leftWidth":300}}"#;
    assert_eq!(t.api("PUT", "/api/store/settings", settings).status, 204);
    assert_eq!(
        std::fs::read(t.dir.join("data/settings.json")).unwrap(),
        settings
    );
    assert_eq!(
        t.api(
            "PUT",
            "/api/store/docs/models.downloads",
            br#"{"keys":["A"]}"#
        )
        .status,
        204
    );
    assert_eq!(
        t.api("PUT", "/api/store/docs/migration", br#"{"from":"browser"}"#)
            .status,
        204
    );
    // A document can be any JSON value; the settings and the library must be objects.
    assert_eq!(t.api("PUT", "/api/store/docs/flag", b"true").status, 204);
    assert_eq!(t.api("PUT", "/api/store/settings", b"[1]").status, 400);
    assert_eq!(t.api("PUT", "/api/store/library", b"\"x\"").status, 400);
    assert_eq!(t.api("PUT", "/api/store/settings", b"{nope").status, 400);
    assert_eq!(t.api("PUT", "/api/store/settings", b"\xff\xfe").status, 400);
    let library = br#"{"format":"repackshot-library","schema":1,"items":[]}"#;
    assert_eq!(t.api("PUT", "/api/store/library", library).status, 204);
    assert!(t.dir.join("data/library/library.json").is_file());
    assert!(t.dir.join("data/state/models.downloads.json").is_file());

    // Another launch on the same data folder (another port, so another origin for the window).
    let paths = Paths {
        exe_dir: t.dir.clone(),
        app_dir: t.dir.join("app"),
        data_dir: t.dir.join("data"),
        portable: false,
    };
    let next = Server::start(paths, 0, TOKEN.into(), 1).unwrap();
    assert_ne!(next.port(), t.port());
    let get = |path: &str| {
        let r = rt_app::client::request(
            next.port(),
            "GET",
            path,
            &[("X-Repackshot-Token", TOKEN)],
            b"",
            Duration::from_secs(30),
        )
        .unwrap();
        assert_eq!(r.status, 200, "{path}");
        r.text()
    };
    assert_eq!(get("/api/store/settings").as_bytes(), settings);
    assert_eq!(get("/api/store/library").as_bytes(), library);
    let docs = rt_app::json::parse(&get("/api/store/docs")).unwrap();
    assert_eq!(
        docs.get("models.downloads")
            .and_then(|v| v.get("keys"))
            .and_then(Value::as_array)
            .map(<[Value]>::len),
        Some(1)
    );
    assert_eq!(docs.get("flag"), Some(&Value::Bool(true)));
    assert!(docs.get("migration").is_some());
    assert_eq!(get("/api/store/docs/none-yet"), "null");

    // Deleting leaves nothing behind, and reads as none again.
    assert_eq!(t.api("DELETE", "/api/store/docs/flag", b"").status, 204);
    assert_eq!(t.api("DELETE", "/api/store/docs/flag", b"").status, 204);
    assert_eq!(t.api("GET", "/api/store/docs/flag", b"").text(), "null");
    assert_eq!(t.api("DELETE", "/api/store/library", b"").status, 204);
    assert_eq!(t.api("GET", "/api/store/library", b"").text(), "null");
    assert!(temporaries(&t.dir.join("data")).is_empty());
}

#[test]
fn names_never_leave_their_folder() {
    let t = TestServer::start("appdata-names", 1);
    for path in [
        "/api/store/docs/..%2Fsettings",
        "/api/store/docs/a%2Fb",
        "/api/store/docs/a%5Cb",
        "/api/store/docs/C:x",
        "/api/store/docs/Upper",
        "/api/store/docs/con",
        "/api/store/docs/nul.x",
        "/api/store/docs/.hidden",
        "/api/store/docs/trailing.",
        "/api/store/results/..%2F..%2Fx",
        "/api/store/results/R1",
        "/api/store/cache/a%2Fb",
        "/api/store/cache/lpt1",
    ] {
        // 400 for a name the store refuses; 404 when a decoded `/` made it another path.
        let r = t.api("PUT", path, b"{}");
        assert!(matches!(r.status, 400 | 404), "{path}: {}", r.text());
    }
    // `.` and `..` segments never reach the store at all.
    assert_eq!(t.api("PUT", "/api/store/docs/../x", b"{}").status, 400);
    assert_eq!(t.api("PUT", "/api/store/docs/%2E%2E", b"{}").status, 400);
    assert!(!t.dir.join("data/state").exists());
    assert!(!t.dir.join("settings.json").exists());
    assert_eq!(
        std::fs::read_to_string(t.dir.join("outside.txt")).unwrap(),
        "secret"
    );
    // Unknown paths and methods.
    assert_eq!(t.api("GET", "/api/store/nothing", b"").status, 404);
    assert_eq!(t.api("POST", "/api/store/settings", b"{}").status, 405);
    assert_eq!(t.api("PATCH", "/api/store/results/r1", b"").status, 405);
    assert_eq!(t.api("POST", "/api/storage/usage", b"").status, 405);
}

#[cfg(unix)]
#[test]
fn a_link_planted_in_the_data_folder_is_not_followed() {
    let t = TestServer::start("appdata-link", 1);
    let elsewhere = t.dir.join("elsewhere");
    std::fs::create_dir_all(&elsewhere).unwrap();
    std::os::unix::fs::symlink(&elsewhere, t.dir.join("data/results")).unwrap();
    std::os::unix::fs::symlink(&elsewhere, t.dir.join("data/library")).unwrap();
    assert_eq!(
        t.api("PUT", "/api/store/results/r1?type=image/png", b"png")
            .status,
        403
    );
    assert_eq!(t.api("PUT", "/api/store/library", b"{}").status, 403);
    assert_eq!(t.api("GET", "/api/store/library", b"").status, 403);
    assert_eq!(std::fs::read_dir(&elsewhere).unwrap().count(), 0);
}

/// The status of a request that announces `len` bytes and sends none: the limits are checked on the
/// announced length, before anything is read (and the connection is closed instead of drained).
fn announced(t: &TestServer, method: &str, path: &str, len: u64) -> u16 {
    let mut s = TcpStream::connect(("127.0.0.1", t.port())).unwrap();
    s.set_read_timeout(Some(Duration::from_secs(30))).unwrap();
    write!(
        s,
        "{method} {path} HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nX-Repackshot-Token: {TOKEN}\r\nContent-Length: {len}\r\n\r\n",
        t.port()
    )
    .unwrap();
    let mut reply = Vec::new();
    let _ = s.read_to_end(&mut reply);
    let head = String::from_utf8_lossy(&reply);
    head.split(' ')
        .nth(1)
        .and_then(|c| c.parse().ok())
        .unwrap_or(0)
}

#[test]
fn bodies_have_limits() {
    let t = TestServer::start("appdata-limits", 1);
    let doc = rt_app::appdata::MAX_DOC + 1;
    assert_eq!(announced(&t, "PUT", "/api/store/settings", doc), 413);
    assert_eq!(announced(&t, "PUT", "/api/store/docs/x", doc), 413);
    assert_eq!(announced(&t, "PUT", "/api/store/cache/x", doc), 413);
    assert_eq!(
        announced(
            &t,
            "PUT",
            "/api/store/library",
            rt_app::appdata::MAX_LIBRARY + 1
        ),
        413
    );
    assert_eq!(
        announced(
            &t,
            "PUT",
            "/api/store/results/r1?type=image/png",
            rt_app::appdata::MAX_RESULT + 1
        ),
        413
    );
    assert!(!t.dir.join("data/settings.json").exists());
    // A file type that is not an image is refused.
    assert_eq!(
        t.api("PUT", "/api/store/results/r1?type=text/html", b"<p>")
            .status,
        415
    );
    assert_eq!(t.api("PUT", "/api/store/results/r1", b"x").status, 415);
}

#[test]
fn a_cut_request_leaves_the_old_file() {
    let t = TestServer::start("appdata-cut", 1);
    let old = br#"{"schema":3,"settings":{},"layout":{}}"#;
    assert_eq!(t.api("PUT", "/api/store/settings", old).status, 204);
    // Promise 400 bytes, send 20 and close the connection.
    let mut s = TcpStream::connect(("127.0.0.1", t.port())).unwrap();
    write!(
        s,
        "PUT /api/store/settings HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nX-Repackshot-Token: {TOKEN}\r\nContent-Length: 400\r\n\r\n{{\"schema\":3,\"cut\":",
        t.port()
    )
    .unwrap();
    s.shutdown(std::net::Shutdown::Write).unwrap();
    let mut reply = String::new();
    let _ = s.read_to_string(&mut reply);
    assert_eq!(
        std::fs::read(t.dir.join("data/settings.json")).unwrap(),
        old
    );
    // Same for a result's file, streamed to the disk.
    let mut s = TcpStream::connect(("127.0.0.1", t.port())).unwrap();
    write!(
        s,
        "PUT /api/store/results/r9?type=image/png HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nX-Repackshot-Token: {TOKEN}\r\nContent-Length: 100000\r\n\r\npartial bytes",
        t.port()
    )
    .unwrap();
    s.shutdown(std::net::Shutdown::Write).unwrap();
    let mut reply = String::new();
    let _ = s.read_to_string(&mut reply);
    assert!(!t.dir.join("data/results/r9.png").exists());
    // The server is fine, and left no temporary file.
    std::thread::sleep(Duration::from_millis(100));
    assert_eq!(
        t.api("GET", "/api/store/settings", b"").text().as_bytes(),
        old
    );
    assert!(temporaries(&t.dir.join("data")).is_empty());
}

#[test]
fn results_are_files_in_the_results_folder_with_an_index() {
    let t = TestServer::start("appdata-results", 1);
    let png = b"\x89PNG\r\n\x1a\nfile-bytes".to_vec();
    let exr = b"v/1\x01exr-bytes".to_vec();
    let meta = |id: &str, at: u64| {
        format!(
            r#"{{"id":"{id}","jobId":"j1","name":"Shot {id}.png","createdAt":{at},"width":64,"height":32,"bytes":20,"thumb":""}}"#
        )
    };
    // The record needs its file first.
    assert_eq!(
        t.api(
            "PUT",
            "/api/store/results/r1/meta",
            meta("r1", 1).as_bytes()
        )
        .status,
        409
    );
    assert_eq!(
        t.api("PUT", "/api/store/results/r1?type=image/png", &png)
            .status,
        204
    );
    // The id of the record must be the one of the path.
    assert_eq!(
        t.api(
            "PUT",
            "/api/store/results/r1/meta",
            meta("r2", 1).as_bytes()
        )
        .status,
        400
    );
    assert_eq!(
        t.api(
            "PUT",
            "/api/store/results/r1/meta",
            meta("r1", 1).as_bytes()
        )
        .status,
        204
    );
    // An EXR with its picture.
    assert_eq!(
        t.api("PUT", "/api/store/results/r2?type=image/x-exr", &exr)
            .status,
        204
    );
    assert_eq!(
        t.api("PUT", "/api/store/results/r2/display", &png).status,
        204
    );
    assert_eq!(
        t.api(
            "PUT",
            "/api/store/results/r2/meta",
            meta("r2", 2).as_bytes()
        )
        .status,
        204
    );
    let dir = t.dir.join("data/results");
    assert_eq!(std::fs::read(dir.join("r1.png")).unwrap(), png);
    assert_eq!(std::fs::read(dir.join("r2.exr")).unwrap(), exr);
    assert_eq!(std::fs::read(dir.join("r2.display.png")).unwrap(), png);
    assert!(dir.join("index.json").is_file());

    let list = t.json("GET", "/api/store/results", b"");
    let ids: Vec<&str> = list
        .get("results")
        .and_then(Value::as_array)
        .unwrap()
        .iter()
        .map(|m| m.get("id").and_then(Value::as_str).unwrap())
        .collect();
    assert_eq!(ids, ["r1", "r2"]);

    let file = t.api("GET", "/api/store/results/r2", b"");
    assert_eq!(file.status, 200);
    assert_eq!(file.header("content-type"), Some("image/x-exr"));
    assert_eq!(file.body, exr);
    let pic = t.api("GET", "/api/store/results/r2/display", b"");
    assert_eq!((pic.status, pic.body), (200, png.clone()));
    assert_eq!(
        t.api("GET", "/api/store/results/r1/display", b"").status,
        404
    );
    assert_eq!(t.api("GET", "/api/store/results/r7", b"").status, 404);
    // Ranges work as for every other file.
    let part = t.raw(
        "GET",
        "/api/store/results/r1",
        &[("X-Repackshot-Token", TOKEN), ("Range", "bytes=0-3")],
        b"",
    );
    assert_eq!((part.status, part.body), (206, png[..4].to_vec()));

    // A result whose file was deleted in the file manager is not listed.
    std::fs::remove_file(dir.join("r1.png")).unwrap();
    let list = t.json("GET", "/api/store/results", b"");
    assert_eq!(
        list.get("results").and_then(Value::as_array).unwrap().len(),
        1
    );

    // Deleting one removes its files; clearing removes what the store wrote, and nothing else.
    std::fs::write(dir.join("mine.txt"), "the person's own file").unwrap();
    assert_eq!(t.api("DELETE", "/api/store/results/r2", b"").status, 204);
    assert!(!dir.join("r2.exr").exists() && !dir.join("r2.display.png").exists());
    assert_eq!(
        t.api("PUT", "/api/store/results/r3?type=image/jpeg", b"jpg")
            .status,
        204
    );
    assert_eq!(
        t.api(
            "PUT",
            "/api/store/results/r3/meta",
            meta("r3", 3).as_bytes()
        )
        .status,
        204
    );
    assert_eq!(
        t.api("PUT", "/api/store/results/r4?type=image/png", b"orphan")
            .status,
        204
    );
    let cleared = t.json("DELETE", "/api/store/results", b"");
    // r1 (its file gone, still in the index) and r3; the orphan r4 is removed but was never a result.
    assert_eq!(cleared.get("deleted").and_then(Value::as_f64), Some(2.0));
    assert!(!dir.join("r3.jpg").exists() && !dir.join("r4.png").exists());
    assert!(dir.join("mine.txt").is_file());
    let list = t.json("GET", "/api/store/results", b"");
    assert_eq!(
        list.get("results").and_then(Value::as_array).unwrap().len(),
        0
    );
    assert!(temporaries(&t.dir.join("data")).is_empty());
}

#[test]
fn a_result_keeps_the_image_the_ai_made_next_to_its_own() {
    let t = TestServer::start("appdata-ai-image", 1);
    let png = b"\x89PNG\r\n\x1a\nengine-image".to_vec();
    let ai = b"\xff\xd8\xffai-image".to_vec();
    let meta = |id: &str, at: u64| {
        format!(
            r#"{{"id":"{id}","jobId":"j1","name":"Shot {id}.png","createdAt":{at},"width":64,"height":32,"bytes":40,"thumb":""}}"#
        )
    };
    let put = |id: &str, ai: Option<&[u8]>| {
        assert_eq!(
            t.api(
                "PUT",
                &format!("/api/store/results/{id}?type=image/png"),
                &png
            )
            .status,
            204
        );
        if let Some(bytes) = ai {
            assert_eq!(
                t.api(
                    "PUT",
                    &format!("/api/store/results/{id}/ai?type=image/jpeg"),
                    bytes
                )
                .status,
                204
            );
        }
        assert_eq!(
            t.api(
                "PUT",
                &format!("/api/store/results/{id}/meta"),
                meta(id, 1).as_bytes()
            )
            .status,
            204
        );
    };
    put("r1", Some(&ai));
    put("r2", None);
    let dir = t.dir.join("data/results");
    assert_eq!(std::fs::read(dir.join("r1.png")).unwrap(), png);
    assert_eq!(std::fs::read(dir.join("r1.ai.jpg")).unwrap(), ai);

    // The AI image comes back as it went in, with its own type, and Range as for every file.
    let got = t.api("GET", "/api/store/results/r1/ai", b"");
    assert_eq!(got.status, 200);
    assert_eq!(got.header("content-type"), Some("image/jpeg"));
    assert_eq!(got.body, ai);
    let part = t.raw(
        "GET",
        "/api/store/results/r1/ai",
        &[("X-Repackshot-Token", TOKEN), ("Range", "bytes=0-2")],
        b"",
    );
    assert_eq!((part.status, part.body), (206, ai[..3].to_vec()));
    // The engine's file is untouched, and a result without one says so.
    assert_eq!(t.api("GET", "/api/store/results/r1", b"").body, png);
    assert_eq!(t.api("GET", "/api/store/results/r2/ai", b"").status, 404);
    assert_eq!(t.api("GET", "/api/store/results/r9/ai", b"").status, 404);

    // Only the types of images, and only a PUT.
    assert_eq!(
        t.api("PUT", "/api/store/results/r1/ai?type=text/html", b"x")
            .status,
        415
    );
    assert_eq!(t.api("DELETE", "/api/store/results/r1/ai", b"").status, 405);

    // The same image sent again in another type leaves one file.
    assert_eq!(
        t.api("PUT", "/api/store/results/r1/ai?type=image/png", &png)
            .status,
        204
    );
    assert!(dir.join("r1.ai.png").is_file() && !dir.join("r1.ai.jpg").exists());

    // Deleting a result removes its AI image; clearing removes every one.
    assert_eq!(
        t.api(
            "PUT",
            "/api/store/results/r2/ai?type=image/webp",
            b"RIFFxxxxWEBP"
        )
        .status,
        204
    );
    assert_eq!(t.api("DELETE", "/api/store/results/r1", b"").status, 204);
    assert!(!dir.join("r1.png").exists() && !dir.join("r1.ai.png").exists());
    assert!(dir.join("r2.ai.webp").is_file());
    t.json("DELETE", "/api/store/results", b"");
    assert!(!dir.join("r2.png").exists() && !dir.join("r2.ai.webp").exists());
    assert!(temporaries(&t.dir.join("data")).is_empty());
}

#[test]
fn the_thumbnail_cache_and_the_space_used() {
    let t = TestServer::start("appdata-usage", 1);
    let url = b"data:image/png;base64,AAAA";
    assert_eq!(t.api("GET", "/api/store/cache/k1", b"").status, 204);
    assert_eq!(t.api("PUT", "/api/store/cache/k1", url).status, 204);
    let hit = t.api("GET", "/api/store/cache/k1", b"");
    assert_eq!((hit.status, hit.body), (200, url.to_vec()));
    assert_eq!(
        t.api("PUT", "/api/store/results/r1?type=image/png", &[7u8; 100])
            .status,
        204
    );
    std::fs::create_dir_all(t.dir.join("data/models/blobs")).unwrap();
    std::fs::write(t.dir.join("data/models/blobs/x"), vec![1u8; 1000]).unwrap();
    std::fs::create_dir_all(t.dir.join("data/browser-profile/Default")).unwrap();
    std::fs::write(
        t.dir.join("data/browser-profile/Default/Cookies"),
        [0u8; 50],
    )
    .unwrap();
    // A cache of the dialogs (another phase) next to the thumbnails is not the thumbnails'.
    std::fs::write(t.dir.join("data/cache/helper.dll"), [0u8; 9]).unwrap();
    let u = t.json("GET", "/api/storage/usage", b"");
    let bytes = |id: &str| {
        u.get("folders")
            .and_then(Value::as_array)
            .unwrap()
            .iter()
            .find(|f| f.get("id").and_then(Value::as_str) == Some(id))
            .and_then(|f| f.get("bytes"))
            .and_then(Value::as_f64)
            .unwrap()
    };
    assert_eq!(bytes("models"), 1000.0);
    assert_eq!(bytes("results"), 100.0);
    assert_eq!(bytes("thumbs"), url.len() as f64);
    assert_eq!(bytes("window"), 50.0);
    assert_eq!(bytes("library"), 0.0);
    let total = u.get("total").and_then(Value::as_f64).unwrap();
    let parts: f64 = [
        "models", "results", "library", "thumbs", "logs", "window", "other",
    ]
    .iter()
    .map(|id| bytes(id))
    .sum();
    assert_eq!(total, parts);
    assert!(bytes("other") >= 9.0);
    assert!(u
        .get("dataDir")
        .and_then(Value::as_str)
        .unwrap()
        .ends_with("data"));
    // Free up: the thumbnails go, the other cache stays.
    let freed = t.json("DELETE", "/api/store/cache", b"");
    assert_eq!(
        freed.get("freed").and_then(Value::as_f64),
        Some(url.len() as f64)
    );
    assert_eq!(t.api("GET", "/api/store/cache/k1", b"").status, 204);
    assert!(t.dir.join("data/cache/helper.dll").is_file());
}
