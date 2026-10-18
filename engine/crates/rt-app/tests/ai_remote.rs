//! The AI model through a remote API on the desktop (phase X7, `docs/AI-POST.md` §8), end to end
//! over real sockets and the system's real `curl`: a final render kept by the launcher, a post
//! with `remote`, a **local fake HTTP server** standing in for the service (never the network),
//! the guard of `rt-post` deciding, and the keys in the launcher's data folder. Every failure the
//! service can make (a refused key, a rate limit, a time-out, an answer that is not an image, one
//! far too large, a redirect) ends the post with its code, its tries and no key anywhere.

mod common;

use common::TestServer;
use rt_app::ai::post::{linear_of, read_image};
use rt_app::json::{self, Value};
use rt_post::LinearImage;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

/// Not a real key: what the tests store and then look for where it must never be.
const KEY: &str = "test-key-0000-not-a-secret-7f3a";
const GUARD_PASSES: &str = "normal,depth,partId,materialId,coc";

// ------------------------------------------------------------------ the fake service

/// What the fake answers to one request.
#[derive(Clone, Debug)]
enum Answer {
    /// The image it got back, as JSON at a dotted path (`image`, `data.0.b64_json`).
    EchoJson(&'static str),
    /// The image it got back, as the body.
    EchoRaw,
    /// The image it got back with every colour inverted (the guard must reject it).
    Invert(&'static str),
    /// A status, a body and a Retry-After.
    Status(u16, String, Option<&'static str>),
    /// No answer for this long.
    Hang(Duration),
    /// 200 with this text.
    Text(&'static str),
    /// 200 with these bytes as the image (raw).
    Bytes(Vec<u8>),
    /// 200 with a Content-Length far past the limit, then nothing.
    Declared(u64),
    /// A redirect to another host.
    Redirect,
}

/// One request the fake received.
#[derive(Clone, Debug)]
struct Seen {
    method: String,
    path: String,
    headers: Vec<(String, String)>,
    body: Vec<u8>,
}

impl Seen {
    fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(k, _)| k.eq_ignore_ascii_case(name))
            .map(|(_, v)| v.as_str())
    }
}

struct Fake {
    port: u16,
    seen: Arc<Mutex<Vec<Seen>>>,
}

impl Fake {
    /// Answers `script` in order, then `then` for ever.
    fn start(script: Vec<Answer>, then: Answer) -> Fake {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let script = Arc::new(Mutex::new((script, then)));
        let seen = Arc::new(Mutex::new(Vec::new()));
        let (s2, seen2) = (Arc::clone(&script), Arc::clone(&seen));
        std::thread::spawn(move || {
            for stream in listener.incoming().flatten() {
                let (s3, seen3) = (Arc::clone(&s2), Arc::clone(&seen2));
                std::thread::spawn(move || serve(stream, &s3, &seen3));
            }
        });
        Fake { port, seen }
    }

    fn url(&self, path: &str) -> String {
        format!("http://127.0.0.1:{}{path}", self.port)
    }

    fn host(&self) -> String {
        format!("127.0.0.1:{}", self.port)
    }

    fn seen(&self) -> Vec<Seen> {
        self.seen.lock().unwrap().clone()
    }
}

/// The PNG inside a request: a multipart part's bytes, or a JSON body's `image` (a data URI or
/// base64, at `image` or `input.image`).
fn png_in(body: &[u8]) -> Vec<u8> {
    let sig = [0x89u8, b'P', b'N', b'G'];
    if let Some(start) = body.windows(4).position(|w| w == sig) {
        let end = body.windows(8).position(|w| &w[..4] == b"IEND").unwrap() + 8;
        return body[start..end].to_vec();
    }
    let v = json::parse(std::str::from_utf8(body).unwrap()).unwrap();
    let s = v
        .get("image")
        .or_else(|| v.get("input").and_then(|i| i.get("image")))
        .and_then(Value::as_str)
        .unwrap();
    let b64 = s.split_once("base64,").map_or(s, |(_, b)| b);
    rt_app::ai::b64::decode(b64).unwrap()
}

fn json_at(path: &str, b64: &str) -> String {
    // `data.0.b64_json` → {"data":[{"b64_json":"…"}]}.
    let mut out = json::string(b64);
    for key in path.split('.').rev() {
        out = if key.bytes().all(|b| b.is_ascii_digit()) {
            format!("[{out}]")
        } else {
            format!("{{{}:{out}}}", json::string(key))
        };
    }
    out
}

fn serve(mut stream: TcpStream, script: &Mutex<(Vec<Answer>, Answer)>, seen: &Mutex<Vec<Seen>>) {
    let mut reader = BufReader::new(stream.try_clone().unwrap());
    let mut line = String::new();
    if reader.read_line(&mut line).unwrap_or(0) == 0 {
        return;
    }
    let mut parts = line.split_whitespace();
    let method = parts.next().unwrap_or("").to_string();
    let path = parts.next().unwrap_or("").to_string();
    let mut headers = Vec::new();
    loop {
        let mut h = String::new();
        if reader.read_line(&mut h).unwrap_or(0) == 0 || h == "\r\n" {
            break;
        }
        if let Some((k, v)) = h.trim_end().split_once(':') {
            headers.push((k.trim().to_string(), v.trim().to_string()));
        }
    }
    let len: usize = headers
        .iter()
        .find(|(k, _)| k.eq_ignore_ascii_case("content-length"))
        .and_then(|(_, v)| v.parse().ok())
        .unwrap_or(0);
    let mut body = vec![0u8; len];
    reader.read_exact(&mut body).unwrap();
    let req = Seen {
        method,
        path,
        headers,
        body,
    };
    seen.lock().unwrap().push(req.clone());
    let answer = {
        let mut s = script.lock().unwrap();
        if s.0.is_empty() {
            s.1.clone()
        } else {
            s.0.remove(0)
        }
    };
    let reply = |status: u16, ctype: &str, extra: &str, body: &[u8]| {
        let head = format!(
            "HTTP/1.1 {status} X\r\nContent-Type: {ctype}\r\nContent-Length: {}\r\n{extra}Connection: close\r\n\r\n",
            body.len()
        );
        let mut s = &stream;
        let _ = s.write_all(head.as_bytes());
        let _ = s.write_all(body);
    };
    match answer {
        Answer::EchoJson(p) => {
            let b64 = rt_app::ai::b64::encode(&png_in(&req.body));
            reply(200, "application/json", "", json_at(p, &b64).as_bytes());
        }
        Answer::EchoRaw => reply(200, "image/png", "", &png_in(&req.body)),
        Answer::Invert(p) => {
            let img = rt_app::ai::png::decode(&png_in(&req.body), 1 << 26).unwrap();
            let rgb: Vec<u8> = rt_app::ai::png::rgb_of(&img)
                .iter()
                .map(|v| 255 - v)
                .collect();
            let png = rt_core::png::encode(img.width, img.height, &rgb);
            reply(
                200,
                "application/json",
                "",
                json_at(p, &rt_app::ai::b64::encode(&png)).as_bytes(),
            );
        }
        Answer::Status(code, text, retry) => {
            let extra = retry
                .map(|r| format!("Retry-After: {r}\r\n"))
                .unwrap_or_default();
            reply(code, "application/json", &extra, text.as_bytes());
        }
        Answer::Hang(d) => std::thread::sleep(d),
        Answer::Text(t) => reply(200, "text/plain", "", t.as_bytes()),
        Answer::Bytes(b) => reply(200, "image/png", "", &b),
        Answer::Declared(n) => {
            let head = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: image/png\r\nContent-Length: {n}\r\n\r\n"
            );
            let _ = stream.write_all(head.as_bytes());
            let _ = stream.write_all(&[0u8; 1024]);
            std::thread::sleep(Duration::from_secs(2));
        }
        Answer::Redirect => reply(
            302,
            "text/plain",
            "Location: https://elsewhere.example/steal\r\n",
            b"moved",
        ),
    }
}

// ------------------------------------------------------------------ the launcher's side

/// The log of this test binary, opened once (the launcher's own `log::open`), to look for the key.
fn log_file() -> PathBuf {
    static DIR: OnceLock<PathBuf> = OnceLock::new();
    DIR.get_or_init(|| {
        let d = common::temp_dir("remote-logs");
        rt_app::log::open(&d).unwrap();
        d
    })
    .join("repackshot.log")
}

fn render_final(t: &TestServer, w: u32, h: u32) -> u32 {
    let mut scene = rt_core::example::scene();
    scene.render.width = w;
    scene.render.height = h;
    scene.render.max_samples = 2;
    let r = t.api(
        "POST",
        &format!("/api/render?kind=final&passes={GUARD_PASSES}"),
        &scene.to_rsb(),
    );
    assert_eq!(r.status, 200, "{}", r.text());
    let id = json::parse(&r.text())
        .unwrap()
        .get("id")
        .unwrap()
        .as_f64()
        .unwrap() as u32;
    let deadline = Instant::now() + Duration::from_secs(300);
    while t.server.app.engine.kept(id).is_none() {
        assert!(Instant::now() < deadline, "render {id} was never kept");
        std::thread::sleep(Duration::from_millis(20));
    }
    id
}

/// An endpoint as the page sends it (`remoteJson` of `src/io/ai-post.ts`).
struct Ep {
    url: String,
    body: &'static str,
    template: String,
    response: &'static str,
    path: &'static str,
    sizes: &'static str,
    auth: &'static str,
    timeout: u32,
    attempts: u32,
    host: String,
}

impl Ep {
    fn generic(fake: &Fake) -> Ep {
        Ep {
            url: fake.url("/v1/img"),
            body: "JSON",
            template: r#"{"image":"{{image_data_uri}}","prompt":"{{prompt}}","negative_prompt":"{{negative}}","strength":"{{strength}}","seed":"{{seed}}","width":"{{width}}","height":"{{height}}"}"#.into(),
            response: "JSON",
            path: "image",
            sizes: "[]",
            auth: "Authorization",
            timeout: 30,
            attempts: 2,
            host: fake.host(),
        }
    }

    fn json(&self) -> String {
        format!(
            "{{\"endpoint\":{{\"url\":{},\"method\":\"POST\",\"authHeader\":\"{}\",\"authPrefix\":\"Bearer \",\"headers\":{{\"Accept\":\"application/json\"}},\"body\":\"{}\",\"template\":{},\"response\":\"{}\",\"responsePath\":\"{}\",\"maxSide\":1024,\"multipleOf\":16,\"sizes\":{}}},\"options\":{{\"sendPasses\":false,\"timeoutSeconds\":{},\"attempts\":{}}},\"consentedHost\":{},\"provider\":\"GENERIC\"}}",
            json::string(&self.url),
            self.auth,
            self.body,
            json::string(&self.template),
            self.response,
            self.path,
            self.sizes,
            self.timeout,
            self.attempts,
            json::string(&self.host)
        )
    }
}

/// The strength a call carries for an attempt at `scale` of the full intervention (Intervention /
/// 100 × RETRY_FACTOR^attempt): × `MAX_STRENGTH`, in `f32` as the plan makes it, rounded as sent.
fn sent_strength(scale: f32) -> f64 {
    rt_app::ai::remote::round_strength(f64::from(scale * rt_post::MAX_STRENGTH))
}

fn post_body(render: u32, intervention: u32, remote: &str) -> String {
    format!(
        "{{\"source\":{{\"kind\":\"RENDER\",\"renderId\":\"{render}\"}},\"settings\":{{\"intervention\":{intervention},\"light\":100,\"bounce\":40,\"wear\":0,\"style\":\"NATURAL\",\"styleStrength\":30,\"seed\":7}},\"prompt\":\"a studio photograph\",\"negative\":\"changed shape\",\"modelKey\":\"API_GENERIC\",\"materials\":[{{\"materialId\":1,\"name\":\"Coral\",\"allowsWear\":true,\"locked\":false}}],\"remote\":{remote}}}"
    )
}

fn num(v: &Value, k: &str) -> f64 {
    v.get(k)
        .and_then(Value::as_f64)
        .unwrap_or_else(|| panic!("{k} in {}", v.to_json()))
}

fn text<'a>(v: &'a Value, k: &str) -> &'a str {
    v.get(k).and_then(Value::as_str).unwrap_or("")
}

/// Starts a post and follows it to its end; the end and every state's JSON seen.
fn run(t: &TestServer, body: &str) -> (Value, Vec<String>) {
    let r = t.api("POST", "/api/ai/post", body.as_bytes());
    assert_eq!(r.status, 202, "{}", r.text());
    let first = json::parse(&r.text()).unwrap();
    let id = num(&first, "id") as u32;
    let mut states = vec![r.text()];
    let mut version = 0;
    let start = Instant::now();
    loop {
        let r = t.api("GET", &format!("/api/ai/post/{id}?after={version}"), b"");
        let v = json::parse(&r.text()).unwrap();
        states.push(r.text());
        version = num(&v, "version") as u32;
        if matches!(text(&v, "state"), "DONE" | "FAILED" | "CANCELLED") {
            return (v, states);
        }
        assert!(
            start.elapsed() < Duration::from_secs(300),
            "post {id} never ended"
        );
    }
}

fn store_key(t: &TestServer, host: &str) {
    let r = t.api(
        "PUT",
        "/api/ai/apikeys",
        format!(
            "{{\"host\":{},\"key\":{}}}",
            json::string(host),
            json::string(KEY)
        )
        .as_bytes(),
    );
    assert_eq!(r.status, 204, "{}", r.text());
}

fn image_of(t: &TestServer, id: u32) -> LinearImage {
    let r = t.api("GET", &format!("/api/ai/post/{id}/image"), b"");
    assert_eq!(r.status, 200);
    read_image(&r.body, 16_384).unwrap().0
}

/// The key is nowhere it must not be: the states the page read, the key listing, the log, the
/// scratch folder of the calls, and every file of the data folder but the key store.
fn assert_key_kept(t: &TestServer, states: &[String]) {
    for s in states {
        assert!(!s.contains(KEY), "a post's state holds the key: {s}");
    }
    let list = t.api("GET", "/api/ai/apikeys", b"").text();
    assert!(!list.contains(KEY), "{list}");
    let log = std::fs::read_to_string(log_file()).unwrap_or_default();
    assert!(!log.contains(KEY), "the log holds the key");
    let data = t.dir.join("data");
    let keys = data.join("ai").join("api-keys.json");
    let mut stack = vec![data];
    while let Some(dir) = stack.pop() {
        for e in std::fs::read_dir(&dir).into_iter().flatten().flatten() {
            let p = e.path();
            if p.is_dir() {
                stack.push(p);
            } else if p != keys {
                let bytes = std::fs::read(&p).unwrap_or_default();
                assert!(
                    !bytes.windows(KEY.len()).any(|w| w == KEY.as_bytes()),
                    "{} holds the key",
                    p.display()
                );
            }
        }
    }
    let calls = t.dir.join("data").join("ai").join("api-calls");
    assert_eq!(
        std::fs::read_dir(&calls).map(|d| d.count()).unwrap_or(0),
        0,
        "the calls' scratch files stay behind"
    );
}

fn cleanup(t: TestServer) {
    let dir = t.dir.clone();
    drop(t);
    let _ = std::fs::remove_dir_all(dir);
}

// ------------------------------------------------------------------ the tests

#[test]
fn an_api_post_goes_through_the_guard_and_its_key_never_leaves_the_launcher() {
    let _ = log_file();
    let fake = Fake::start(vec![], Answer::EchoJson("image"));
    let t = TestServer::start("remote-ok", 2);
    store_key(&t, &fake.host());
    let id = render_final(&t, 96, 64);
    let ep = Ep::generic(&fake);
    let (end, states) = run(&t, &post_body(id, 60, &ep.json()));
    assert_eq!(text(&end, "state"), "DONE", "{}", end.to_json());
    let report = end.get("report").unwrap();
    // The same guard and report as a local model: an image identical to the input is accepted.
    assert_eq!(text(report, "verdict"), "ACCEPTED", "{}", report.to_json());
    assert_eq!(text(report, "runtime"), format!("api:{}", fake.host()));
    assert_eq!(text(report, "modelKey"), "API_GENERIC");
    assert_eq!(num(&end, "calls"), 1.0);
    let seen = fake.seen();
    assert_eq!(seen.len(), 1);
    let r = &seen[0];
    assert_eq!((r.method.as_str(), r.path.as_str()), ("POST", "/v1/img"));
    // The key goes in its header, to the host it was stored for, and nowhere else.
    assert_eq!(
        r.header("authorization"),
        Some(format!("Bearer {KEY}").as_str())
    );
    assert_eq!(r.header("content-type"), Some("application/json"));
    assert_eq!(r.header("accept"), Some("application/json"));
    let body = json::parse(std::str::from_utf8(&r.body).unwrap()).unwrap();
    assert!(!std::str::from_utf8(&r.body).unwrap().contains(KEY));
    assert_eq!(text(&body, "prompt"), "a studio photograph");
    assert_eq!(text(&body, "negative_prompt"), "changed shape");
    // Numbers as numbers: the attempt's strength (Intervention 60 × MAX_STRENGTH) with three
    // decimals, the seed.
    assert_eq!(num(&body, "strength"), sent_strength(0.6));
    assert_eq!(
        (
            num(&body, "seed"),
            num(&body, "width"),
            num(&body, "height")
        ),
        (7.0, 96.0, 64.0)
    );
    let png = png_in(&r.body);
    let img = rt_app::ai::png::decode(&png, 1 << 20).unwrap();
    assert_eq!(
        (img.width, img.height),
        (96, 64),
        "the tile at its own size (it fits)"
    );
    assert_key_kept(&t, &states);
    // The key listing is masked; the store is the user's alone.
    let list = t.json("GET", "/api/ai/apikeys", b"");
    let k = &list.get("keys").and_then(Value::as_array).unwrap()[0];
    assert_eq!(
        (text(k, "host"), text(k, "masked")),
        (fake.host().as_str(), "••••7f3a")
    );
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = std::fs::metadata(t.dir.join("data/ai/api-keys.json"))
            .unwrap()
            .permissions()
            .mode();
        assert_eq!(mode & 0o077, 0, "{mode:o}");
    }
    // Forgotten: the next post is refused before anything is sent.
    let r = t.api(
        "POST",
        "/api/ai/apikeys/forget",
        format!("{{\"host\":{}}}", json::string(&fake.host())).as_bytes(),
    );
    assert_eq!(r.status, 204);
    let r = t.api(
        "POST",
        "/api/ai/post",
        post_body(id, 60, &ep.json()).as_bytes(),
    );
    assert_eq!(r.status, 409, "{}", r.text());
    assert_eq!(
        text(&json::parse(&r.text()).unwrap(), "error"),
        "api-no-key"
    );
    assert_eq!(fake.seen().len(), 1);
    cleanup(t);
}

#[test]
fn intervention_zero_never_calls_the_api() {
    let fake = Fake::start(vec![], Answer::EchoJson("image"));
    let t = TestServer::start("remote-zero", 2);
    store_key(&t, &fake.host());
    let id = render_final(&t, 96, 64);
    let (end, _) = run(&t, &post_body(id, 0, &Ep::generic(&fake).json()));
    assert_eq!(text(&end, "state"), "DONE");
    assert_eq!(num(&end, "calls"), 0.0);
    assert!(fake.seen().is_empty());
    let engine = linear_of(&t.server.app.engine.kept(id).unwrap().image).unwrap();
    let img = image_of(&t, num(&end, "id") as u32);
    assert!(img
        .rgba
        .iter()
        .zip(&engine.rgba)
        .all(|(a, b)| a.to_bits() == b.to_bits()));
    cleanup(t);
}

#[test]
fn the_presets_send_a_form_and_a_fixed_size_and_read_their_answers() {
    let _ = log_file();
    // Shaped like the Stability preset (a form, the answer's `image`) and like the OpenAI one (a
    // form, fixed sizes, `data.0.b64_json`): the fake checks the form and echoes the image.
    let fake = Fake::start(
        vec![Answer::EchoJson("image")],
        Answer::EchoJson("data.0.b64_json"),
    );
    let t = TestServer::start("remote-presets", 2);
    store_key(&t, &fake.host());
    let id = render_final(&t, 96, 64);
    let stability = Ep {
        body: "MULTIPART",
        template: r#"{"mode":"image-to-image","image":"{{image}}","prompt":"{{prompt}}","negative_prompt":"{{negative}}","strength":"{{strength}}","seed":"{{seed}}","model":"sd3.5-large","output_format":"png"}"#.into(),
        ..Ep::generic(&fake)
    };
    let (end, states) = run(&t, &post_body(id, 60, &stability.json()));
    assert_eq!(text(&end, "state"), "DONE", "{}", end.to_json());
    let r = &fake.seen()[0];
    let ct = r.header("content-type").unwrap();
    let boundary = ct.strip_prefix("multipart/form-data; boundary=").unwrap();
    let body = String::from_utf8_lossy(&r.body);
    for (name, value) in [
        ("mode", "image-to-image"),
        ("prompt", "a studio photograph"),
        ("strength", format!("{}", sent_strength(0.6)).as_str()),
        ("seed", "7"),
        ("output_format", "png"),
    ] {
        assert!(
            body.contains(&format!("name=\"{name}\"\r\n\r\n{value}\r\n")),
            "{name} in the form"
        );
    }
    assert!(body.contains("name=\"image\"; filename=\"image.png\"\r\nContent-Type: image/png"));
    assert!(body.trim_end().ends_with(&format!("--{boundary}--")));
    let openai = Ep {
        body: "MULTIPART",
        template: r#"{"model":"gpt-image-1","image":"{{image}}","prompt":"{{prompt}} Avoid: {{negative}}","size":"{{size}}","n":"1"}"#.into(),
        path: "data.0.b64_json",
        sizes: "[[1024,1024],[1536,1024],[1024,1536]]",
        ..Ep::generic(&fake)
    };
    let (end, states2) = run(&t, &post_body(id, 60, &openai.json()));
    assert_eq!(text(&end, "state"), "DONE", "{}", end.to_json());
    assert_eq!(text(end.get("report").unwrap(), "verdict"), "ACCEPTED");
    let r = &fake.seen()[1];
    let body = String::from_utf8_lossy(&r.body);
    // 96 × 64 is 3:2: the 1536 × 1024 canvas, the tile filling it; its answer comes back cut and scaled.
    assert!(
        body.contains("name=\"size\"\r\n\r\n1536x1024\r\n"),
        "{}",
        &body[..400.min(body.len())]
    );
    assert!(body.contains("name=\"prompt\"\r\n\r\na studio photograph Avoid: changed shape\r\n"));
    let img = rt_app::ai::png::decode(&png_in(&r.body), 1 << 22).unwrap();
    assert_eq!((img.width, img.height), (1536, 1024));
    // An answer that is the image itself.
    let raw = Fake::start(vec![], Answer::EchoRaw);
    store_key(&t, &raw.host());
    let (end, states3) = run(
        &t,
        &post_body(
            id,
            60,
            &Ep {
                response: "IMAGE",
                ..Ep::generic(&raw)
            }
            .json(),
        ),
    );
    assert_eq!(text(&end, "state"), "DONE", "{}", end.to_json());
    assert_key_kept(&t, &[states, states2, states3].concat());
    cleanup(t);
}

#[test]
fn a_refused_key_fails_at_once_with_its_status_and_never_the_key() {
    let _ = log_file();
    // The service echoes the key it was sent in its error: the launcher masks it.
    let fake = Fake::start(
        vec![],
        Answer::Status(401, format!("{{\"message\":\"invalid key {KEY}\"}}"), None),
    );
    let t = TestServer::start("remote-auth", 2);
    store_key(&t, &fake.host());
    let id = render_final(&t, 96, 64);
    let (end, states) = run(&t, &post_body(id, 60, &Ep::generic(&fake).json()));
    assert_eq!(text(&end, "state"), "FAILED");
    assert_eq!(text(&end, "error"), "api-auth");
    assert_eq!(
        (num(&end, "apiAttempts"), num(&end, "apiStatus")),
        (1.0, 401.0),
        "a refused key is not tried again"
    );
    assert_eq!(text(&end, "apiDetail"), "invalid key ••••7f3a");
    assert_eq!(fake.seen().len(), 1);
    assert_key_kept(&t, &states);
    cleanup(t);
}

#[test]
fn rate_limits_and_server_failures_are_tried_again_a_bounded_number_of_times() {
    // Two tries in all: a 429 with Retry-After 1, again a 429: it stops and says so.
    let fake = Fake::start(
        vec![],
        Answer::Status(429, "{\"message\":\"slow down\"}".into(), Some("1")),
    );
    let t = TestServer::start("remote-rate", 2);
    store_key(&t, &fake.host());
    let id = render_final(&t, 96, 64);
    let started = Instant::now();
    let (end, _) = run(&t, &post_body(id, 60, &Ep::generic(&fake).json()));
    assert_eq!(text(&end, "error"), "api-rate-limit", "{}", end.to_json());
    assert_eq!(num(&end, "apiAttempts"), 2.0);
    assert_eq!(text(&end, "apiDetail"), "slow down");
    assert_eq!(fake.seen().len(), 2, "never more than the tries");
    assert!(
        started.elapsed() >= Duration::from_secs(1),
        "the Retry-After was waited"
    );
    // A Retry-After past 30 s is not waited for: one try, at once.
    let fake2 = Fake::start(vec![], Answer::Status(429, "{}".into(), Some("3600")));
    store_key(&t, &fake2.host());
    let (end, _) = run(
        &t,
        &post_body(
            id,
            60,
            &Ep {
                attempts: 5,
                ..Ep::generic(&fake2)
            }
            .json(),
        ),
    );
    assert_eq!(
        (text(&end, "error"), num(&end, "apiAttempts")),
        ("api-rate-limit", 1.0)
    );
    assert_eq!(fake2.seen().len(), 1);
    // A server failure, then an answer: the post goes on.
    let fake3 = Fake::start(
        vec![Answer::Status(503, "busy".into(), None)],
        Answer::EchoJson("image"),
    );
    store_key(&t, &fake3.host());
    let (end, _) = run(&t, &post_body(id, 60, &Ep::generic(&fake3).json()));
    assert_eq!(text(&end, "state"), "DONE", "{}", end.to_json());
    assert_eq!(fake3.seen().len(), 2);
    cleanup(t);
}

#[test]
fn a_service_that_does_not_answer_times_out_without_hanging() {
    let fake = Fake::start(vec![], Answer::Hang(Duration::from_secs(40)));
    let t = TestServer::start("remote-timeout", 2);
    store_key(&t, &fake.host());
    let id = render_final(&t, 96, 64);
    let started = Instant::now();
    let (end, _) = run(
        &t,
        &post_body(
            id,
            60,
            &Ep {
                timeout: 10,
                attempts: 1,
                ..Ep::generic(&fake)
            }
            .json(),
        ),
    );
    assert_eq!(text(&end, "error"), "api-timeout", "{}", end.to_json());
    assert!(
        started.elapsed() < Duration::from_secs(30),
        "{:?}",
        started.elapsed()
    );
    assert_eq!(fake.seen().len(), 1);
    cleanup(t);
}

#[test]
fn answers_that_are_not_an_image_or_far_too_large_are_refused() {
    let t = TestServer::start("remote-format", 2);
    let id = render_final(&t, 96, 64);
    // A PNG whose header claims 9000 × 9000 (nothing past the header).
    let mut huge = vec![0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13];
    huge.extend_from_slice(b"IHDR");
    huge.extend_from_slice(&9000u32.to_be_bytes());
    huge.extend_from_slice(&9000u32.to_be_bytes());
    huge.extend_from_slice(&[8, 2, 0, 0, 0, 0, 0, 0, 0]);
    let cases: Vec<(Answer, &str, &str, &str)> = vec![
        (Answer::Text("hello"), "JSON", "api-format", "json"),
        (
            Answer::Status(200, "{\"other\":1}".into(), None),
            "JSON",
            "api-format",
            "path",
        ),
        (
            Answer::Bytes(vec![0xff, 0xd8, 0xff, 0xe0, 0, 0]),
            "IMAGE",
            "api-format",
            "JPEG",
        ),
        (Answer::Bytes(huge), "IMAGE", "api-oversize", "9000x9000"),
        (Answer::Declared(80 << 20), "IMAGE", "api-oversize", ""),
        (Answer::Redirect, "JSON", "api-redirect", ""),
    ];
    for (answer, response, code, detail) in cases {
        let fake = Fake::start(vec![], answer.clone());
        store_key(&t, &fake.host());
        let ep = Ep {
            response,
            ..Ep::generic(&fake)
        };
        let (end, _) = run(&t, &post_body(id, 60, &ep.json()));
        assert_eq!(text(&end, "error"), code, "{answer:?}: {}", end.to_json());
        assert_eq!(num(&end, "apiAttempts"), 1.0, "{answer:?}: not tried again");
        if !detail.is_empty() {
            assert_eq!(text(&end, "apiDetail"), detail, "{answer:?}");
        }
        assert_eq!(
            fake.seen().len(),
            1,
            "{answer:?}: one request, no redirect followed"
        );
    }
    cleanup(t);
}

#[test]
fn a_result_the_guard_rejects_delivers_the_engine_image_unchanged() {
    let fake = Fake::start(vec![], Answer::Invert("image"));
    let t = TestServer::start("remote-reject", 2);
    store_key(&t, &fake.host());
    let id = render_final(&t, 96, 64);
    // The guard is strict here (the tolerances a request may carry, as X1b calibrates with): no
    // attempt of an inverted image passes, so all four are made and none is kept.
    let body = post_body(id, 100, &Ep::generic(&fake).json()).replacen(
        "\"remote\":",
        "\"tolerances\":{\"detailSsim\":0.99999},\"remote\":",
        1,
    );
    let (end, _) = run(&t, &body);
    assert_eq!(text(&end, "state"), "DONE", "{}", end.to_json());
    let report = end.get("report").unwrap();
    assert_eq!(text(report, "verdict"), "REJECTED", "{}", report.to_json());
    assert_eq!(num(report, "attempts"), 4.0);
    // One tile, four attempts at lower strengths: four calls, and no more.
    assert_eq!(fake.seen().len(), 4);
    let strengths: Vec<f64> = fake
        .seen()
        .iter()
        .map(|r| {
            num(
                &json::parse(std::str::from_utf8(&r.body).unwrap()).unwrap(),
                "strength",
            )
        })
        .collect();
    let planned: Vec<f64> = (0..4)
        .map(|a| sent_strength(rt_post::RETRY_FACTOR.powi(a)))
        .collect();
    assert_eq!(strengths, planned);
    let engine = linear_of(&t.server.app.engine.kept(id).unwrap().image).unwrap();
    let img = image_of(&t, num(&end, "id") as u32);
    assert!(
        img.rgba
            .iter()
            .zip(&engine.rgba)
            .all(|(a, b)| a.to_bits() == b.to_bits()),
        "bit for bit"
    );
    cleanup(t);
}

#[test]
fn a_post_to_a_host_not_allowed_or_not_safe_is_refused_before_anything_is_sent() {
    let fake = Fake::start(vec![], Answer::EchoJson("image"));
    let t = TestServer::start("remote-refuse", 2);
    store_key(&t, &fake.host());
    let id = render_final(&t, 96, 64);
    let refuse = |ep: Ep, status: u16, code: &str| {
        let r = t.api(
            "POST",
            "/api/ai/post",
            post_body(id, 60, &ep.json()).as_bytes(),
        );
        assert_eq!(r.status, status, "{}", r.text());
        assert_eq!(
            text(&json::parse(&r.text()).unwrap(), "error"),
            code,
            "{}",
            r.text()
        );
    };
    // Another host than the one the person allowed.
    refuse(
        Ep {
            host: "api.example.com".into(),
            ..Ep::generic(&fake)
        },
        400,
        "api-consent",
    );
    // Plain http beyond this computer.
    refuse(
        Ep {
            url: "http://api.example.com/v1".into(),
            host: "api.example.com".into(),
            ..Ep::generic(&fake)
        },
        400,
        "api-config",
    );
    // An unknown placeholder.
    refuse(
        Ep {
            template: r#"{"image":"{{image}}","x":"{{secret}}"}"#.into(),
            ..Ep::generic(&fake)
        },
        400,
        "api-config",
    );
    // A host with no key.
    let other = Fake::start(vec![], Answer::EchoJson("image"));
    refuse(Ep::generic(&other), 409, "api-no-key");
    // An endpoint without a key header needs none.
    let (end, _) = run(
        &t,
        &post_body(
            id,
            60,
            &Ep {
                auth: "",
                ..Ep::generic(&other)
            }
            .json(),
        ),
    );
    assert_eq!(text(&end, "state"), "DONE", "{}", end.to_json());
    assert_eq!(other.seen()[0].header("authorization"), None);
    assert!(fake.seen().is_empty());
    cleanup(t);
}
