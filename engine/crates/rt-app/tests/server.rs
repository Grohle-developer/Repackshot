//! The server over real sockets: security, files, ranges, the model store.

mod common;

use common::{TestServer, TOKEN};
use rt_app::sha256::{hex, Sha256};
use std::io::{BufReader, Read, Write};
use std::net::TcpStream;
use std::time::Duration;

#[test]
fn foreign_hosts_origins_and_missing_tokens_are_refused() {
    let t = TestServer::start("security", 1);
    let port = t.port();
    let own = format!("127.0.0.1:{port}");
    // The page itself needs no token, but its own host.
    let page = t.raw("GET", "/", &[], b"");
    assert_eq!(page.status, 200);
    assert!(page.text().contains("Repackshot"));
    assert_eq!(page.header("cache-control"), Some("no-cache"));
    assert_eq!(
        t.raw("GET", "/", &[("Host", &format!("localhost:{port}"))], b"")
            .status,
        200
    );
    // DNS rebinding: another name, or another port.
    for host in [
        "evil.example:80".to_string(),
        format!("evil.example:{port}"),
        "127.0.0.1".into(),
        format!("127.0.0.1:{}", port.wrapping_add(1)),
    ] {
        assert_eq!(
            t.raw("GET", "/", &[("Host", &host)], b"").status,
            421,
            "{host}"
        );
        assert_eq!(
            t.raw(
                "GET",
                "/api/info",
                &[("Host", &host), ("X-Repackshot-Token", TOKEN)],
                b""
            )
            .status,
            421,
            "{host}"
        );
    }
    // The API wants the token.
    assert_eq!(t.raw("GET", "/api/info", &[], b"").status, 401);
    assert_eq!(
        t.raw(
            "GET",
            "/api/info",
            &[("X-Repackshot-Token", "00112233445566778899aabbccddeefe")],
            b""
        )
        .status,
        401
    );
    assert_eq!(
        t.raw("POST", "/api/render?kind=final", &[], b"RSB1").status,
        401
    );
    assert_eq!(
        t.raw(
            "PUT",
            &format!("/api/models/blobs/{}?offset=0", "0".repeat(64)),
            &[],
            b"x"
        )
        .status,
        401
    );
    // A foreign Origin is refused even with the token; the app's own is fine.
    assert_eq!(
        t.raw(
            "GET",
            "/api/info",
            &[
                ("X-Repackshot-Token", TOKEN),
                ("Origin", "https://evil.example")
            ],
            b""
        )
        .status,
        403
    );
    assert_eq!(
        t.raw(
            "GET",
            "/api/info",
            &[("X-Repackshot-Token", TOKEN), ("Origin", "null")],
            b""
        )
        .status,
        403
    );
    let ok = t.raw(
        "GET",
        "/api/info",
        &[
            ("X-Repackshot-Token", TOKEN),
            ("Origin", &format!("http://{own}")),
        ],
        b"",
    );
    assert_eq!(ok.status, 200);
    // No CORS header ever, not even for a preflight.
    let preflight = t.raw(
        "OPTIONS",
        "/api/info",
        &[
            ("Origin", "https://evil.example"),
            ("Access-Control-Request-Method", "GET"),
        ],
        b"",
    );
    assert!(preflight.status >= 400);
    for r in [&page, &ok, &preflight] {
        assert!(r
            .headers
            .iter()
            .all(|(n, _)| !n.starts_with("access-control")));
        assert_eq!(r.header("x-content-type-options"), Some("nosniff"));
    }
    let info = rt_app::json::parse(&ok.text()).unwrap();
    assert_eq!(info.get("app").unwrap().as_str(), Some("repackshot"));
    assert!(info.get("threads").unwrap().as_f64().unwrap() >= 1.0);
    // M2b: the engine says it reads the texture data, and the page sends it then.
    assert_eq!(
        info.get("features").unwrap().as_f64(),
        Some(f64::from(rt_core::FEATURES))
    );
    assert_eq!(rt_core::FEATURES & rt_core::FEATURE_TEXTURES, 1);
    // M3b: and the material programs.
    assert_eq!(rt_core::FEATURES & rt_core::FEATURE_PROGRAMS, 2);
    // Q1: and the section view.
    assert_eq!(rt_core::FEATURES & rt_core::FEATURE_SECTION, 4);
    // L5: and the IES lights.
    assert_eq!(rt_core::FEATURES & rt_core::FEATURE_IES, 8);
    // K3: and the interior cameras.
    assert_eq!(rt_core::FEATURES & rt_core::FEATURE_CAMERAS, 16);
    // M3c: and the pattern nodes of a program.
    assert_eq!(rt_core::FEATURES & rt_core::FEATURE_PATTERN_NODES, 32);
    // S3: and the drops (the drop shape and the mixes of the ambient effects, the front glass).
    assert_eq!(rt_core::FEATURES & rt_core::FEATURE_DROPS, 64);
    // S3b: and the front glass laid out drop by drop (a pane the scene's rain and dust wet).
    assert_eq!(rt_core::FEATURES & rt_core::FEATURE_GLASS_LAYOUT, 128);
    // S3c: and the rain, dust and snow on the parts.
    assert_eq!(rt_core::FEATURES & rt_core::FEATURE_WET_PARTS, 256);
    // S3d: and the drops in the air (and a drop named as its part in the passes).
    assert_eq!(rt_core::FEATURES & rt_core::FEATURE_WET_FLIGHT, 512);
    // S3f: and the drops on the parts with their shapes.
    assert_eq!(rt_core::FEATURES & rt_core::FEATURE_WET_SHAPES, 1024);
    // S3e: and the studio floor, the set's fine samples and the dust's motes.
    assert_eq!(rt_core::FEATURES & rt_core::FEATURE_WET_FLOOR, 2048);
    assert_eq!(rt_core::FEATURES & rt_core::FEATURE_WET_FINE, 4096);
    assert_eq!(rt_core::FEATURES & rt_core::FEATURE_WET_MOTES, 8192);
    assert_eq!(info.get("features").unwrap().as_f64(), Some(16383.0));
    assert_eq!(info.get("portable").unwrap().as_bool(), Some(false));
    assert!(!ok.text().contains(TOKEN), "the token is never echoed");
}

#[test]
fn static_files_ranges_and_paths() {
    let t = TestServer::start("static", 1);
    let wasm = t.raw("GET", "/engine/rt.wasm", &[], b"");
    assert_eq!(wasm.status, 200);
    assert_eq!(wasm.header("content-type"), Some("application/wasm"));
    assert_eq!(wasm.body.len(), 16);
    let part = t.raw("GET", "/engine/rt.wasm", &[("Range", "bytes=8-11")], b"");
    assert_eq!(part.status, 206);
    assert_eq!(part.body, b"abcd");
    assert_eq!(part.header("content-range"), Some("bytes 8-11/16"));
    let tail = t.raw("GET", "/engine/rt.wasm", &[("Range", "bytes=-3")], b"");
    assert_eq!((tail.status, tail.body.as_slice()), (206, &b"fgh"[..]));
    let past = t.raw("GET", "/engine/rt.wasm", &[("Range", "bytes=16-")], b"");
    assert_eq!(past.status, 416);
    assert_eq!(past.header("content-range"), Some("bytes */16"));
    let head = t.raw("HEAD", "/engine/rt.wasm", &[], b"");
    assert_eq!(
        (head.status, head.header("content-length")),
        (200, Some("16"))
    );
    for bad in [
        "/../outside.txt",
        "/engine/../../outside.txt",
        "/%2e%2e/outside.txt",
        "/engine%5c..%5c..%5coutside.txt",
    ] {
        let r = t.raw("GET", bad, &[], b"");
        assert!(r.status == 400 || r.status == 404, "{bad}: {}", r.status);
        assert!(!r.text().contains("secret"));
    }
    assert_eq!(t.raw("GET", "/%00", &[], b"").status, 400);
    assert_eq!(t.raw("POST", "/", &[], b"x").status, 405);
    assert_eq!(t.raw("GET", "/missing.js", &[], b"").status, 404);
}

#[test]
fn keep_alive_and_bad_requests() {
    let t = TestServer::start("keepalive", 1);
    let mut s = TcpStream::connect(("127.0.0.1", t.port())).unwrap();
    s.set_read_timeout(Some(Duration::from_secs(10))).unwrap();
    let host = format!("127.0.0.1:{}", t.port());
    let mut r = BufReader::new(s.try_clone().unwrap());
    for _ in 0..3 {
        write!(
            s,
            "GET /api/info HTTP/1.1\r\nHost: {host}\r\nX-Repackshot-Token: {TOKEN}\r\n\r\n"
        )
        .unwrap();
        let reply = rt_app::client::read_reply(&mut r, false).unwrap();
        assert_eq!(reply.status, 200);
        assert_eq!(reply.header("connection"), Some("keep-alive"));
    }
    // A body the handler does not read is drained; the connection goes on.
    write!(s, "POST /api/alive HTTP/1.1\r\nHost: {host}\r\nX-Repackshot-Token: {TOKEN}\r\nContent-Length: 5\r\n\r\nhello").unwrap();
    assert_eq!(
        rt_app::client::read_reply(&mut r, false).unwrap().status,
        204
    );
    write!(s, "GET / HTTP/1.1\r\nHost: {host}\r\n\r\n").unwrap();
    assert_eq!(
        rt_app::client::read_reply(&mut r, false).unwrap().status,
        200
    );
    // A malformed request: 400 and the connection closes.
    write!(s, "GET / HTTP/1.1\r\nHost {host}\r\n\r\n").unwrap();
    let bad = rt_app::client::read_reply(&mut r, false).unwrap();
    assert_eq!(bad.status, 400);
    assert_eq!(bad.header("connection"), Some("close"));
    let mut rest = Vec::new();
    assert_eq!(r.read_to_end(&mut rest).unwrap_or(0), 0);
    // Chunked bodies are not supported: 501.
    let mut s = TcpStream::connect(("127.0.0.1", t.port())).unwrap();
    write!(
        s,
        "POST /api/alive HTTP/1.1\r\nHost: {host}\r\nTransfer-Encoding: chunked\r\n\r\n0\r\n\r\n"
    )
    .unwrap();
    let reply = rt_app::client::read_reply(&mut BufReader::new(s), false).unwrap();
    assert_eq!(reply.status, 501);
}

fn sha(data: &[u8]) -> String {
    hex(&Sha256::digest(data))
}

fn data(n: usize, seed: u32) -> Vec<u8> {
    (0..n as u32)
        .map(|i| (i.wrapping_mul(2654435761).rotate_left(seed) >> 24) as u8)
        .collect()
}

#[test]
fn models_by_blob_out_of_order_resumed_damaged_and_shared() {
    let t = TestServer::start("models", 1);
    let weights = data(3_000_017, 3);
    let encoder = data(1_234_567, 7);
    let other = data(400_000, 11);
    let (w, e, o) = (sha(&weights), sha(&encoder), sha(&other));
    // Two imported models sharing the encoder.
    let manifest = |files: &[(&str, &[u8])]| {
        let files: Vec<String> = files
            .iter()
            .map(|(name, d)| {
                format!(
                    r#"{{"name":"{name}","role":"transformer","bytes":{},"sha256":"{}"}}"#,
                    d.len(),
                    sha(d)
                )
            })
            .collect();
        format!(r#"{{"label":"test","files":[{}]}}"#, files.join(","))
    };
    assert_eq!(
        t.api(
            "PUT",
            "/api/models/imported/ALPHA",
            manifest(&[("w.gguf", &weights), ("enc.gguf", &encoder)]).as_bytes()
        )
        .status,
        204
    );
    assert_eq!(
        t.api(
            "PUT",
            "/api/models/imported/BETA",
            manifest(&[("o.gguf", &other), ("enc.gguf", &encoder)]).as_bytes()
        )
        .status,
        204
    );
    assert_eq!(
        t.api("PUT", "/api/models/imported/ZIMAGE_Q8", b"{\"files\":[]}")
            .status,
        409,
        "catalogue keys are not imported"
    );
    assert_eq!(
        t.api("PUT", "/api/models/imported/..", b"{\"files\":[]}")
            .status,
        400
    );

    // The weights, in chunks out of order; the "download" stops halfway.
    let total = weights.len();
    let cuts = [0, 1_000_000, 1_500_001, 2_222_222, total];
    for &i in &[2usize, 0] {
        let r = t.api(
            "PUT",
            &format!("/api/models/blobs/{w}?offset={}&total={total}", cuts[i]),
            &weights[cuts[i]..cuts[i + 1]],
        );
        assert_eq!(r.status, 200, "{}", r.text());
    }
    let status = t.json("GET", &format!("/api/models/blobs/{w}/status"), b"");
    assert_eq!(status.get("state").unwrap().as_str(), Some("partial"));
    assert_eq!(
        status.get("contiguous").unwrap().as_f64(),
        Some(1_000_000.0)
    );
    let early = t.api("POST", &format!("/api/models/blobs/{w}/finish"), b"");
    assert_eq!(early.status, 409);
    assert!(early.text().contains("\"contiguous\":1000000"));
    // Resume from the contiguous bytes.
    for i in [1usize, 3] {
        assert_eq!(
            t.api(
                "PUT",
                &format!("/api/models/blobs/{w}?offset={}&total={total}", cuts[i]),
                &weights[cuts[i]..cuts[i + 1]]
            )
            .status,
            200
        );
    }
    let done = t.api(
        "POST",
        &format!("/api/models/blobs/{w}/finish?bytes={total}"),
        b"",
    );
    assert_eq!(done.status, 200, "{}", done.text());
    let back = t.api("GET", &format!("/api/models/blobs/{w}"), b"");
    assert_eq!(sha(&back.body), w);
    let range = t.raw(
        "GET",
        &format!("/api/models/blobs/{w}"),
        &[("X-Repackshot-Token", TOKEN), ("Range", "bytes=10-19")],
        b"",
    );
    assert_eq!(
        (range.status, range.body.as_slice()),
        (206, &weights[10..20])
    );
    assert_eq!(
        t.api("GET", &format!("/api/models/blobs/{e}"), b"").status,
        404,
        "not downloaded"
    );

    // A wrong byte: 422, and the part stays damaged until deleted.
    let mut bad = encoder.clone();
    bad[777] ^= 0x40;
    assert_eq!(
        t.api(
            "PUT",
            &format!("/api/models/blobs/{e}?offset=0&total={}", bad.len()),
            &bad
        )
        .status,
        200
    );
    let mismatch = t.api("POST", &format!("/api/models/blobs/{e}/finish"), b"");
    assert_eq!(mismatch.status, 422);
    assert!(mismatch.text().contains(&sha(&bad)));
    let st = t.json("GET", &format!("/api/models/blobs/{e}/status"), b"");
    assert_eq!(st.get("damaged").unwrap().as_bool(), Some(true));
    assert_eq!(
        t.api(
            "PUT",
            &format!("/api/models/blobs/{e}?offset=0"),
            &encoder[..10]
        )
        .status,
        409
    );
    assert_eq!(
        t.api("DELETE", &format!("/api/models/blobs/{e}"), b"")
            .status,
        204
    );
    assert_eq!(
        t.api(
            "PUT",
            &format!("/api/models/blobs/{e}?offset=0&total={}", encoder.len()),
            &encoder
        )
        .status,
        200
    );
    assert_eq!(
        t.api("POST", &format!("/api/models/blobs/{e}/finish"), b"")
            .status,
        200
    );

    // Installing needs every blob; then the shared one survives deleting one of two models.
    assert_eq!(
        t.api("POST", "/api/models/installed", br#"{"key":"BETA"}"#)
            .status,
        409
    );
    assert_eq!(
        t.api("PUT", &format!("/api/models/blobs/{o}?offset=0"), &other)
            .status,
        200
    );
    assert_eq!(
        t.api("POST", &format!("/api/models/blobs/{o}/finish"), b"")
            .status,
        200
    );
    assert_eq!(
        t.api("POST", "/api/models/installed", br#"{"key":"ALPHA"}"#)
            .status,
        200
    );
    assert_eq!(
        t.api("POST", "/api/models/installed", br#"{"key":"BETA"}"#)
            .status,
        200
    );
    let list = t.json("GET", "/api/models", b"");
    let installed: Vec<&str> = list
        .get("installed")
        .unwrap()
        .as_array()
        .unwrap()
        .iter()
        .map(|k| k.as_str().unwrap())
        .collect();
    assert_eq!(installed, ["ALPHA", "BETA"]);
    assert_eq!(
        t.api("DELETE", &format!("/api/models/blobs/{e}"), b"")
            .status,
        409,
        "in use"
    );
    let gone = t.json("DELETE", "/api/models/ALPHA", b"");
    let deleted: Vec<&str> = gone
        .get("deleted")
        .unwrap()
        .as_array()
        .unwrap()
        .iter()
        .map(|k| k.as_str().unwrap())
        .collect();
    assert_eq!(deleted, [w.as_str()], "only the weights nobody else uses");
    assert_eq!(
        t.api("GET", &format!("/api/models/blobs/{e}"), b"").status,
        200,
        "the shared encoder stays"
    );
    assert_eq!(
        t.api("GET", &format!("/api/models/blobs/{w}"), b"").status,
        404
    );
    let list = t.json("GET", "/api/models", b"");
    let models = list.get("models").unwrap().as_array().unwrap();
    let beta = models
        .iter()
        .find(|m| m.get("key").unwrap().as_str() == Some("BETA"))
        .unwrap();
    assert_eq!(beta.get("state").unwrap().as_str(), Some("complete"));
    // The catalogue's models are listed too, with their blobs missing.
    let q8 = models
        .iter()
        .find(|m| m.get("key").unwrap().as_str() == Some("ZIMAGE_Q8"))
        .unwrap();
    assert_eq!(q8.get("state").unwrap().as_str(), Some("missing"));
    assert_eq!(q8.get("source").unwrap().as_str(), Some("catalogue"));
    // Names are validated.
    assert_eq!(
        t.api(
            "PUT",
            &format!("/api/models/blobs/{}?offset=0", w.to_uppercase()),
            b"x"
        )
        .status,
        400
    );
    assert_eq!(
        t.api("PUT", "/api/models/blobs/..%2f..%2fx?offset=0", b"x")
            .status,
        400
    );
    assert_eq!(t.api("DELETE", "/api/models/a..b", b"").status, 400);
    assert_eq!(
        t.api("PUT", &format!("/api/models/blobs/{o}"), b"x").status,
        400,
        "offset is required"
    );
}

#[test]
fn pending_models_from_the_installer() {
    let t = TestServer::start("pending", 1);
    assert_eq!(t.api("GET", "/api/pending-models", b"").text(), "null");
    std::fs::write(
        t.dir.join("data/pending-models.json"),
        "{\"device\":\"cpu\",\"keys\":[\"ZIMAGE_Q4\"]}\r\n",
    )
    .unwrap();
    assert_eq!(
        t.api("GET", "/api/pending-models", b"").text(),
        r#"{"device":"cpu","keys":["ZIMAGE_Q4"]}"#
    );
    assert_eq!(t.api("DELETE", "/api/pending-models", b"").status, 204);
    assert!(!t.dir.join("data/pending-models.json").exists());
    assert_eq!(t.api("GET", "/api/pending-models", b"").text(), "null");
    assert_eq!(t.api("DELETE", "/api/pending-models", b"").status, 204);
}

#[test]
fn hardware_and_open_folder_validation() {
    let t = TestServer::start("hardware", 1);
    let hw = t.json("GET", "/api/hardware?device=cpu", b"");
    assert_eq!(hw.get("device").unwrap().as_str(), Some("cpu"));
    assert!(hw.get("threads").unwrap().as_f64().unwrap() >= 1.0);
    assert!(hw.get("gpus").unwrap().as_array().is_some());
    if hw.get("detected").unwrap().as_bool() == Some(true) {
        assert!(hw.get("recommendation").unwrap().get("rowId").is_some());
    }
    assert_eq!(
        t.api("POST", "/api/open-folder", br#"{"path":"/"}"#).status,
        403
    );
    assert_eq!(
        t.api("POST", "/api/open-folder", br#"{"folder":"nope"}"#)
            .status,
        400
    );
    assert_eq!(t.api("POST", "/api/open-folder", b"not json").status, 400);
    assert_eq!(t.api("GET", "/api/nothing", b"").status, 404);
    assert_eq!(t.api("PUT", "/api/info", b"").status, 405);
}

/// An id from a `POST /api/render` answer.
fn job_id(t: &TestServer, target: &str, rsb: &[u8]) -> u32 {
    let r = t.api("POST", target, rsb);
    assert_eq!(r.status, 200, "{target}: {}", r.text());
    rt_app::json::parse(&r.text())
        .unwrap()
        .get("id")
        .unwrap()
        .as_f64()
        .unwrap() as u32
}

/// A scene with no geometry (cheap to render at any size), marked whole with `full=1`.
fn empty_scene(samples: u32, w: u32, h: u32) -> Vec<u8> {
    let mut scene = rt_core::example::scene();
    scene.geometry = rt_core::scene::Geometry::default();
    scene.render.width = w;
    scene.render.height = h;
    scene.render.max_samples = samples;
    scene.to_rsb()
}

#[test]
fn viewport_views_in_order_shares_and_the_render_state() {
    let t = TestServer::start("render-options", 4);
    let rsb = empty_scene(100_000, 64, 48);
    let view = "/api/render?kind=viewport&mesh=e&client=w&full=1";
    let newer = job_id(&t, &format!("{view}&seq=5&share=1"), &rsb);
    // A view that arrives after a newer one of the same window: 409 stale, and the newer one goes on.
    let late = t.api("POST", &format!("{view}&seq=4&share=1"), &rsb);
    assert_eq!(late.status, 409);
    assert!(late.text().contains("\"stale\""), "{}", late.text());
    assert_eq!(
        t.api("GET", &format!("/api/render/{newer}?data=0"), b"")
            .status,
        200
    );
    // Bad numbers are refused.
    for q in ["&seq=x", "&share=-1"] {
        assert_eq!(
            t.api("POST", &format!("{view}{q}"), &rsb).status,
            400,
            "{q}"
        );
    }
    // The diagnostics: the gate, the jobs (with their share) and the windows.
    let state = t.json("GET", "/api/render/state", b"");
    let engine = state.get("engine").unwrap();
    assert_eq!(engine.get("threads").unwrap().as_f64(), Some(4.0));
    let jobs = engine.get("jobs").unwrap().as_array().unwrap();
    let job = jobs
        .iter()
        .find(|j| j.get("id").unwrap().as_f64() == Some(f64::from(newer)))
        .expect("the viewport job");
    assert_eq!(job.get("kind").unwrap().as_str(), Some("viewport"));
    assert_eq!(job.get("share").unwrap().as_f64(), Some(1.0));
    let windows = engine.get("viewports").unwrap().as_array().unwrap();
    assert_eq!(windows[0].get("lastSeq").unwrap().as_f64(), Some(5.0));
    assert!(state.get("connections").unwrap().as_f64().unwrap() >= 1.0);
    // With log=1 it also goes to the log (the page's watchdog asks for this).
    assert_eq!(
        t.api(
            "GET",
            "/api/render/state?log=1&reason=no%20pass%20for%2030%20s",
            b""
        )
        .status,
        200
    );
    assert_eq!(
        t.api("DELETE", &format!("/api/render/{newer}"), b"").status,
        204
    );
}

#[test]
fn a_long_polled_frame_nobody_reads_frees_its_connection() {
    let t = TestServer::start("unread-frame", 2);
    t.server
        .app
        .frame_write_timeout_ms
        .store(300, std::sync::atomic::Ordering::Relaxed);
    // 2400 x 2400: 92 MB of sums, more than the sockets hold.
    let id = job_id(
        &t,
        "/api/render?kind=viewport&mesh=e&client=w&full=1",
        &empty_scene(100_000, 2400, 2400),
    );
    let deadline = std::time::Instant::now() + Duration::from_secs(120);
    loop {
        let r = t.api("GET", &format!("/api/render/{id}?after=0&data=0"), b"");
        if u32::from_le_bytes(r.body[8..12].try_into().unwrap()) >= 1 {
            break;
        }
        assert!(std::time::Instant::now() < deadline, "no first pass");
    }
    // A page that asked for the frame and then went on to a newer view without reading it.
    let mut s = TcpStream::connect(("127.0.0.1", t.port())).unwrap();
    write!(
        s,
        "GET /api/render/{id}?after=0 HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nX-Repackshot-Token: {TOKEN}\r\n\r\n",
        t.port()
    )
    .unwrap();
    let mut seen = Vec::new();
    for _ in 0..10 {
        seen.push(t.server.app.connections());
        std::thread::sleep(Duration::from_millis(20));
    }
    assert!(seen.iter().any(|&n| n >= 1), "{seen:?}");
    // The server gives the write up soon and closes that connection; it does not keep the thread
    // (and the browser its connection) for minutes.
    let deadline = std::time::Instant::now() + Duration::from_secs(10);
    while t.server.app.connections() > 0 {
        assert!(
            std::time::Instant::now() < deadline,
            "the unread frame still holds its connection"
        );
        std::thread::sleep(Duration::from_millis(20));
    }
    assert_eq!(
        t.api("DELETE", &format!("/api/render/{id}"), b"").status,
        204
    );
    drop(s);
}

#[test]
fn a_final_s_frame_comes_scaled_to_the_live_view_s_box() {
    // U14: the queue's live view asks for a final's frame with `fit=`: the sums come averaged by a
    // whole factor (here 64 x 48 into 16 x 16: k = 4, a 16 x 12 picture), the header says the
    // picture's size and FLAG_SCALED, and a header alone or a bad box change nothing / are refused.
    use rt_app::render::{Frame, FLAG_DATA, FLAG_DONE, FLAG_SCALED, FRAME_HEADER};
    let t = TestServer::start("live-fit", 2);
    let id = job_id(
        &t,
        "/api/render?kind=final&mesh=e&full=1",
        &empty_scene(3, 64, 48),
    );
    let deadline = std::time::Instant::now() + Duration::from_secs(60);
    let whole = loop {
        let r = t.api("GET", &format!("/api/render/{id}"), b"");
        assert_eq!(r.status, 200);
        let f = Frame::read(&r.body).unwrap();
        if f.flags & FLAG_DONE != 0 {
            break f;
        }
        assert!(
            std::time::Instant::now() < deadline,
            "the final did not end"
        );
        std::thread::sleep(Duration::from_millis(20));
    };
    assert_eq!((whole.width, whole.height, whole.samples), (64, 48, 3));
    let r = t.api("GET", &format!("/api/render/{id}?fit=16x16"), b"");
    assert_eq!(r.status, 200);
    assert_eq!(r.body.len(), FRAME_HEADER + 16 * 12 * 4 * 4);
    let flags = u32::from_le_bytes(r.body[28..32].try_into().unwrap());
    assert_eq!(flags & (FLAG_DATA | FLAG_SCALED), FLAG_DATA | FLAG_SCALED);
    let scaled = Frame::read(&r.body).unwrap();
    assert_eq!(
        (scaled.width, scaled.height, scaled.samples),
        (16, 12, whole.samples)
    );
    assert_eq!(scaled.sums, whole.fitted(16, 16).sums);
    // Pixel (1, 2) of the picture is the mean of pixels (4..8, 8..12) of the render.
    for c in 0..4 {
        let mut sum = 0f32;
        for y in 8..12 {
            for x in 4..8 {
                sum += whole.sums[(y * 64 + x) * 4 + c];
            }
        }
        assert_eq!(scaled.sums[(2 * 16 + 1) * 4 + c], sum * (1.0 / 16.0));
    }
    // A header alone keeps the render's size; a bad box is refused.
    let head = t.api("GET", &format!("/api/render/{id}?fit=16x16&data=0"), b"");
    assert_eq!(head.body.len(), FRAME_HEADER);
    let h = Frame::read(&head.body).unwrap();
    assert_eq!((h.width, h.height, h.flags & FLAG_SCALED), (64, 48, 0));
    for bad in ["0x10", "16", "16x99999", "ax3"] {
        let r = t.api("GET", &format!("/api/render/{id}?fit={bad}"), b"");
        assert_eq!(r.status, 400, "{bad}");
        assert!(r.text().contains("bad-query"), "{}", r.text());
    }
    assert_eq!(
        t.api("DELETE", &format!("/api/render/{id}"), b"").status,
        204
    );
}

#[test]
fn startup_project_serves_the_file_passed_on_the_command_line() {
    // No file passed: nothing to open.
    let bare = TestServer::start("startup-project-none", 1);
    assert_eq!(bare.api("GET", "/api/startup-project", b"").status, 404);

    // The file passed: its bytes, with its name in the header (percent-encoded).
    let dir = std::env::temp_dir().join(format!("rt-app-it-startup-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let file = dir.join("mi botella.repack");
    std::fs::write(&file, b"{\"format\":\"repackshot\"}").unwrap();
    let options = rt_app::server::Options {
        open_file: Some(file.clone()),
        ..rt_app::server::Options::default()
    };
    let t = TestServer::start_with_options("startup-project", 1, options, |_| {});
    let r = t.api("GET", "/api/startup-project", b"");
    assert_eq!(r.status, 200);
    assert_eq!(r.text(), "{\"format\":\"repackshot\"}");
    assert_eq!(
        r.header("x-repackshot-file-name"),
        Some("mi%20botella.repack")
    );
    std::fs::remove_file(&file).unwrap();
    std::fs::remove_dir(&dir).unwrap();

    // The file passed but gone: nothing to open, not a crash.
    let gone = TestServer::start_with_options(
        "startup-project-gone",
        1,
        rt_app::server::Options {
            open_file: Some(file),
            ..rt_app::server::Options::default()
        },
        |_| {},
    );
    assert_eq!(gone.api("GET", "/api/startup-project", b"").status, 404);
}
