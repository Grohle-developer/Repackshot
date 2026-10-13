//! The AI runtime (phase X3b) over real sockets, with the fake runtime `rt-fake-sd` (a binary of
//! this crate that speaks stable-diffusion.cpp's command line and server protocol) and, for the
//! downloads, the system's real `curl` against a local server.
//!
//! The test server is built with `server::Options` holding a catalogue whose build for this
//! system is the fake, so nothing here touches the network. That is the only way in: nothing in
//! the data folder replaces the embedded catalogue, in a debug or a release build (an earlier
//! override file, read by debug builds only, let these tests pass where the shipped binary
//! would not have run them).

mod common;

use common::{temp_dir, TestServer};
use rt_app::ai::download::Downloader;
use rt_app::ai::runtimes::{Runtimes, Source, State};
use rt_app::ai::sidecar::Limits;
use rt_app::ai::{b64, catalogue, png, zip};
use rt_app::json::{self, Value};
use rt_app::server::Options;
use rt_app::sha256::{hex, Sha256};
use std::io::{BufReader, BufWriter, Write};
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

const FAKE: &str = env!("CARGO_BIN_EXE_rt-fake-sd");
const EXE: &str = std::env::consts::EXE_SUFFIX;
/// The fake's SHA-256 does not matter where it is put in place by hand: any pinned value.
const PLACED: &str = "1111111111111111111111111111111111111111111111111111111111111111";

fn sha(d: &[u8]) -> String {
    hex(&Sha256::digest(d))
}

fn server_name() -> String {
    format!("sd-server{EXE}")
}

/// A catalogue whose CPU build for this system is the fake at `url` (and a Vulkan build that is
/// never installed, and one for another system), with the real choice rows and profiles.
fn override_json(url: &str, bytes: u64, sha256: &str) -> String {
    let real = json::parse(catalogue::RUNTIMES_JSON).unwrap();
    let keys = real.get("runtimes").unwrap().as_array().unwrap()[0]
        .get("supports")
        .unwrap()
        .to_json();
    let rt = |key: &str, os: &str, backend: &str, url: &str, bytes: u64, sha: &str| {
        json::Object::new()
            .str("key", key)
            .str("os", os)
            .str("arch", std::env::consts::ARCH)
            .str("backend", backend)
            .str("name", &format!("{key}.zip"))
            .str("url", url)
            .num("bytes", bytes as f64)
            .str("sha256", sha)
            .raw(
                "archive",
                &json::Object::new()
                    .str("format", "zip")
                    .str("server", &server_name())
                    .str("cli", &server_name())
                    .build(),
            )
            .raw("supports", &keys)
            .raw("verified", "[]")
            .build()
    };
    json::Object::new()
        .num("schema", 1.0)
        .raw("release", &real.get("release").unwrap().to_json())
        .raw(
            "runtimes",
            &json::array([
                rt("TEST_CPU", std::env::consts::OS, "CPU", url, bytes, sha256),
                rt(
                    "TEST_VULKAN",
                    std::env::consts::OS,
                    "VULKAN",
                    "http://127.0.0.1:9/none.zip",
                    1,
                    &"2".repeat(64),
                ),
                rt(
                    "TEST_OTHER",
                    "plan9",
                    "CPU",
                    "http://127.0.0.1:9/other.zip",
                    1,
                    &"3".repeat(64),
                ),
            ]),
        )
        .raw("choice", &real.get("choice").unwrap().to_json())
        .raw("profiles", &real.get("profiles").unwrap().to_json())
        .build()
}

/// Server options that put the catalogue `override_json` in place of the embedded one, with a
/// downloader that may use `http://` (the local `FileServer`).
fn with_catalogue(text: &str) -> Options {
    Options {
        ai_runtimes: Some((
            catalogue::parse_runtimes_allowing_http(text).unwrap(),
            Downloader {
                allow_http: true,
                ..Downloader::system()
            },
        )),
    }
}

fn link_or_copy(from: &str, to: &Path) {
    if std::fs::hard_link(from, to).is_err() {
        std::fs::copy(from, to).unwrap();
    }
}

/// Puts the fake in place as the installed `TEST_CPU`, as an unpacked archive would be.
fn place_fake(data: &Path) -> PathBuf {
    let dir = data.join("ai/runtimes").join(PLACED);
    std::fs::create_dir_all(&dir).unwrap();
    link_or_copy(FAKE, &dir.join(server_name()));
    std::fs::write(
        dir.join("repackshot-runtime.json"),
        format!("{{\"key\":\"TEST_CPU\",\"sha256\":\"{PLACED}\"}}"),
    )
    .unwrap();
    dir
}

/// The blobs of a catalogue model (any bytes: the fake reads no weights), so it is "downloaded".
fn place_model(data: &Path, key: &str) {
    let blobs = data.join("models").join("blobs");
    std::fs::create_dir_all(&blobs).unwrap();
    for f in &rt_app::recommend::catalogue().model(key).unwrap().files {
        std::fs::write(blobs.join(&f.sha256), b"fake weights").unwrap();
    }
}

fn blob(data: &Path, key: &str, role: &str, hint: &str) -> String {
    let f = rt_app::recommend::catalogue()
        .model(key)
        .unwrap()
        .files
        .iter()
        .find(|f| f.role == role && f.name.contains(hint))
        .unwrap()
        .clone();
    data.join("models")
        .join("blobs")
        .join(f.sha256)
        .to_string_lossy()
        .into_owned()
}

/// A server whose runtime is the fake, already installed, with these models downloaded.
fn ready(name: &str, models: &[&str]) -> (TestServer, PathBuf, PathBuf) {
    let models: Vec<String> = models.iter().map(|s| s.to_string()).collect();
    let options = with_catalogue(&override_json("http://127.0.0.1:9/fake.zip", 1, PLACED));
    let t = TestServer::start_with_options(name, 1, options, |data| {
        place_fake(data);
        for m in &models {
            place_model(data, m);
        }
    });
    let data = t.dir.join("data");
    let rt = data.join("ai/runtimes").join(PLACED);
    (t, data, rt)
}

/// An RGB picture, as PNG in base64.
fn picture(w: u32, h: u32) -> (Vec<u8>, String) {
    let rgb: Vec<u8> = (0..w * h)
        .flat_map(|i| {
            let (x, y) = (i % w, i / w);
            [(x * 4) as u8, (y * 5) as u8, ((x + y) * 3) as u8]
        })
        .collect();
    let png = rt_core::png::encode(w, h, &rgb);
    (rgb, b64::encode(&png))
}

fn run_body(model: &str, prompt: &str, strength: f64, extra: &str) -> String {
    let (_, image) = picture(80, 64);
    format!(
        "{{\"model\":\"{model}\",\"image\":\"{image}\",\"prompt\":{},\"negative\":\"text, logos\",\"strength\":{strength},\"seed\":12,\"device\":\"cpu\"{extra}}}",
        json::string(prompt)
    )
}

fn post_run(t: &TestServer, body: &str) -> Value {
    let r = t.api("POST", "/api/ai/run", body.as_bytes());
    assert_eq!(r.status, 202, "{}", r.text());
    json::parse(&r.text()).unwrap()
}

fn id_of(v: &Value) -> u32 {
    v.get("id").unwrap().as_f64().unwrap() as u32
}

/// Follows a run to its end; every state seen, in order.
fn follow(t: &TestServer, id: u32, on: impl FnMut(&Value)) -> Value {
    follow_for(t, id, Duration::from_secs(60), on)
}

fn follow_for(t: &TestServer, id: u32, limit: Duration, mut on: impl FnMut(&Value)) -> Value {
    let start = Instant::now();
    let mut version = 0;
    loop {
        let v = t.json("GET", &format!("/api/ai/run/{id}?after={version}"), b"");
        on(&v);
        version = v.get("version").unwrap().as_f64().unwrap() as u32;
        let state = v.get("state").unwrap().as_str().unwrap().to_string();
        if matches!(state.as_str(), "DONE" | "FAILED" | "CANCELLED") {
            return v;
        }
        assert!(
            start.elapsed() < limit,
            "run {id} never ended: {}",
            v.to_json()
        );
    }
}

fn wait_end(t: &TestServer, id: u32) -> Value {
    follow(t, id, |_| {})
}

fn state(v: &Value) -> &str {
    v.get("state").unwrap().as_str().unwrap()
}

fn lines(path: &Path) -> Vec<Value> {
    std::fs::read_to_string(path)
        .unwrap_or_default()
        .lines()
        .map(|l| json::parse(l).unwrap())
        .collect()
}

fn strings(v: &Value) -> Vec<String> {
    v.as_array()
        .unwrap()
        .iter()
        .map(|s| s.as_str().unwrap().to_string())
        .collect()
}

/// Processes running an executable of `dir` (a runtime folder).
#[cfg(target_os = "linux")]
fn running_from(dir: &Path) -> Vec<u32> {
    std::fs::read_dir("/proc")
        .unwrap()
        .flatten()
        .filter_map(|e| {
            let pid: u32 = e.file_name().to_str()?.parse().ok()?;
            let exe = std::fs::read_link(e.path().join("exe")).ok()?;
            (exe.starts_with(dir) && alive(pid)).then_some(pid)
        })
        .collect()
}

#[cfg(target_os = "linux")]
fn alive(pid: u32) -> bool {
    // A zombie is not running.
    std::fs::read_to_string(format!("/proc/{pid}/stat"))
        .is_ok_and(|s| !s.split(") ").nth(1).is_some_and(|r| r.starts_with('Z')))
}

fn cleanup(t: TestServer) {
    let dir = t.dir.clone();
    drop(t);
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn exact_arguments_and_request_per_model_key() {
    let keys = [
        "ZIMAGE_Q8",
        "ZIMAGE_Q4",
        "ZIMAGE_Q2",
        "KLEIN4B_Q4",
        "QWENEDIT_Q4",
        "SD15_LIGHT",
    ];
    let (t, data, rt) = ready("ai-args", &keys);
    let s = |v: &[&str]| v.iter().map(|x| x.to_string()).collect::<Vec<_>>();
    for (n, key) in keys.iter().enumerate() {
        let p = |role: &str| blob(&data, key, role, "");
        let expected: Vec<String> = match *key {
            "QWENEDIT_Q4" => {
                let mut v = s(&["--diffusion-model"]);
                v.extend([
                    p("transformer"),
                    "--llm".into(),
                    p("text-encoder"),
                    "--llm_vision".into(),
                    p("mmproj"),
                    "--vae".into(),
                    p("vae"),
                ]);
                v.extend(s(&[
                    "--diffusion-fa",
                    "--model-args",
                    "qwen_image_zero_cond_t=true",
                ]));
                v
            }
            "SD15_LIGHT" => vec!["-m".into(), p("transformer")],
            _ => vec![
                "--diffusion-model".into(),
                p("transformer"),
                "--llm".into(),
                p("text-encoder"),
                "--vae".into(),
                p("vae"),
                "--diffusion-fa".into(),
            ],
        };
        let v = post_run(&t, &run_body(key, "a studio photograph", 0.25, ""));
        let end = wait_end(&t, id_of(&v));
        assert_eq!(state(&end), "DONE", "{key}: {}", end.to_json());
        // One start per model: the server is restarted with the next model's arguments.
        let starts = lines(&rt.join("args.log"));
        assert_eq!(starts.len(), n + 1, "{key}");
        let args = strings(starts.last().unwrap());
        let (load, listen) = args.split_at(args.len() - 4);
        assert_eq!(load, expected.as_slice(), "{key}");
        assert_eq!(listen[0], "--listen-ip");
        let ip: std::net::Ipv4Addr = listen[1].parse().unwrap();
        assert!(
            ip.is_loopback() && ip != std::net::Ipv4Addr::LOCALHOST,
            "{ip}"
        );
        assert_eq!(listen[2], "--listen-port");
        assert!(listen[3].parse::<u16>().unwrap() > 0);
        // What the job asked.
        let req = lines(&rt.join("requests.log")).pop().unwrap();
        let num = |k: &str| req.get(k).and_then(Value::as_f64);
        assert_eq!(
            (num("width"), num("height")),
            (Some(80.0), Some(64.0)),
            "{key}"
        );
        assert_eq!(
            (num("strength"), num("seed"), num("batch_count")),
            (Some(0.25), Some(12.0), Some(1.0))
        );
        assert_eq!(
            req.get("prompt").unwrap().as_str(),
            Some("a studio photograph")
        );
        assert_eq!(
            req.get("negative_prompt").unwrap().as_str(),
            Some("text, logos")
        );
        assert_eq!(
            req.get("embed_image_metadata").unwrap().as_bool(),
            Some(false)
        );
        assert_eq!(req.get("output_format").unwrap().as_str(), Some("png"));
        assert!(req
            .get("init_image")
            .unwrap()
            .as_str()
            .unwrap()
            .starts_with('<'));
        let sp = req.get("sample_params").unwrap();
        let (steps, cfg, method, shift, refs) = match *key {
            "KLEIN4B_Q4" => (4.0, 1.0, Some("euler"), None, 1.0),
            "QWENEDIT_Q4" => (20.0, 2.5, Some("euler"), Some(3.0), 1.0),
            "SD15_LIGHT" => (20.0, 7.0, None, None, 0.0),
            _ => (8.0, 1.0, None, None, 0.0),
        };
        assert_eq!(
            sp.get("sample_steps").unwrap().as_f64(),
            Some(steps),
            "{key}"
        );
        assert_eq!(
            sp.get("guidance").unwrap().get("txt_cfg").unwrap().as_f64(),
            Some(cfg),
            "{key}"
        );
        assert_eq!(
            sp.get("sample_method").and_then(Value::as_str),
            method,
            "{key}"
        );
        assert_eq!(sp.get("flow_shift").and_then(Value::as_f64), shift, "{key}");
        assert_eq!(num("ref_images"), Some(refs), "{key}");
        assert!(req.get("control_image").unwrap().is_null(), "{key}");
    }
    // SD 1.5 with each ControlNet: the server is started with that one, and the job carries the
    // control image and its strength.
    let (_, control) = picture(80, 64);
    for kind in ["tile", "depth"] {
        let extra =
            format!(",\"control\":{{\"kind\":\"{kind}\",\"image\":\"{control}\"}},\"steps\":6");
        let v = post_run(&t, &run_body("SD15_LIGHT", "p", 0.5, &extra));
        assert_eq!(state(&wait_end(&t, id_of(&v))), "DONE");
        let args = strings(lines(&rt.join("args.log")).last().unwrap());
        assert_eq!(
            &args[..4],
            &[
                "-m".to_string(),
                blob(&data, "SD15_LIGHT", "transformer", ""),
                "--control-net".into(),
                blob(&data, "SD15_LIGHT", "controlnet", kind)
            ],
            "{kind}"
        );
        let req = lines(&rt.join("requests.log")).pop().unwrap();
        assert!(req
            .get("control_image")
            .unwrap()
            .as_str()
            .unwrap()
            .starts_with('<'));
        assert_eq!(req.get("control_strength").unwrap().as_f64(), Some(0.9));
        assert_eq!(
            req.get("sample_params")
                .unwrap()
                .get("sample_steps")
                .unwrap()
                .as_f64(),
            Some(6.0)
        );
    }
    // The same model again: the loaded server is reused (no new start).
    let before = lines(&rt.join("args.log")).len();
    let extra = format!(",\"control\":{{\"kind\":\"depth\",\"image\":\"{control}\"}}");
    let v = post_run(&t, &run_body("SD15_LIGHT", "again", 0.5, &extra));
    assert_eq!(state(&wait_end(&t, id_of(&v))), "DONE");
    assert_eq!(lines(&rt.join("args.log")).len(), before);
    cleanup(t);
}

#[test]
fn the_image_comes_back_checked_and_whole() {
    let (t, _data, _rt) = ready("ai-image", &["ZIMAGE_Q4"]);
    let v = post_run(
        &t,
        &run_body("ZIMAGE_Q4", "p", 0.5, ",\"width\":80,\"height\":64"),
    );
    let id = id_of(&v);
    assert_eq!(v.get("width").unwrap().as_f64(), Some(80.0));
    let end = wait_end(&t, id);
    assert_eq!(state(&end), "DONE");
    assert_eq!(end.get("fraction").unwrap().as_f64(), Some(1.0));
    assert_eq!(end.get("runtime").unwrap().as_str(), Some("TEST_CPU"));
    let img = t.api("GET", &format!("/api/ai/run/{id}/image"), b"");
    assert_eq!(img.status, 200);
    assert_eq!(img.header("content-type"), Some("image/png"));
    let out = png::decode(&img.body, 1 << 20).unwrap();
    assert_eq!((out.width, out.height), (80, 64));
    // The fake's image: the input lifted by round(strength × 64) + seed mod 7.
    let (rgb, _) = picture(80, 64);
    let lift = 32 + 12 % 7;
    assert_eq!(
        png::rgb_of(&out),
        rgb.iter()
            .map(|&v| ((u32::from(v) + lift) % 256) as u8)
            .collect::<Vec<_>>()
    );
    // Collected, the run can be forgotten.
    assert_eq!(
        t.api("DELETE", &format!("/api/ai/run/{id}"), b"").status,
        204
    );
    assert_eq!(t.api("GET", &format!("/api/ai/run/{id}"), b"").status, 404);
    cleanup(t);
}

#[test]
fn progress_then_cancel_keeps_the_model_loaded() {
    let (t, _data, rt) = ready("ai-cancel", &["ZIMAGE_Q4"]);
    // [fake:slow]: 300 ms a step, 8 steps × strength 1.
    let v = post_run(&t, &run_body("ZIMAGE_Q4", "[fake:slow]", 1.0, ""));
    let id = id_of(&v);
    let mut seen: Vec<(String, u32, f64)> = Vec::new();
    let mut cancelled_at = None;
    let end = follow(&t, id, |v| {
        let step = v.get("step").unwrap().as_f64().unwrap() as u32;
        seen.push((
            state(v).to_string(),
            step,
            v.get("fraction").unwrap().as_f64().unwrap(),
        ));
        if state(v) == "INFERENCE" && step >= 2 && cancelled_at.is_none() {
            assert_eq!(v.get("steps").unwrap().as_f64(), Some(8.0));
            assert_eq!(
                t.api("DELETE", &format!("/api/ai/run/{id}"), b"").status,
                204
            );
            cancelled_at = Some(Instant::now());
        }
    });
    assert_eq!(state(&end), "CANCELLED", "{seen:?}");
    assert!(cancelled_at.unwrap().elapsed() < Duration::from_secs(5));
    assert!(seen.iter().any(|(s, _, _)| s == "LOADING"), "{seen:?}");
    let fractions: Vec<f64> = seen
        .iter()
        .filter(|(s, _, _)| s == "INFERENCE")
        .map(|(_, _, f)| *f)
        .collect();
    assert!(
        fractions.windows(2).all(|w| w[0] <= w[1]) && fractions.len() >= 2,
        "{seen:?}"
    );
    // The server answered the cancel itself: it is still loaded and the next run reuses it.
    let st = t.json("GET", "/api/ai/runtime?device=cpu", b"");
    assert_eq!(
        st.get("sidecar").unwrap().get("state").unwrap().as_str(),
        Some("ready")
    );
    let v = post_run(&t, &run_body("ZIMAGE_Q4", "p", 0.5, ""));
    assert_eq!(state(&wait_end(&t, id_of(&v))), "DONE");
    assert_eq!(lines(&rt.join("args.log")).len(), 1);
    cleanup(t);
}

#[test]
fn hung_slow_crashed_failed_and_wrong_size_runs_fail_cleanly() {
    let (t, _data, rt) = ready("ai-failures", &["ZIMAGE_Q4"]);
    let ai = &t.server.app.ai;
    let limits = Limits {
        silence: Duration::from_millis(900),
        run: Duration::from_secs(30),
        load: Duration::from_secs(30),
        idle: Duration::from_secs(600),
    };
    ai.sidecar.set_limits(limits);
    let fail = |prompt: &str| {
        let v = post_run(&t, &run_body("ZIMAGE_Q4", prompt, 1.0, ""));
        let end = wait_end(&t, id_of(&v));
        assert_eq!(state(&end), "FAILED", "{prompt}: {}", end.to_json());
        (
            end.get("error").unwrap().as_str().unwrap().to_string(),
            end.get("message").unwrap().as_str().unwrap().to_string(),
        )
    };
    // Hung: no output and no change of state for longer than the silence limit; stopped.
    let start = Instant::now();
    let pid_before = {
        let v = post_run(&t, &run_body("ZIMAGE_Q4", "warm up", 0.5, ""));
        assert_eq!(state(&wait_end(&t, id_of(&v))), "DONE");
        t.json("GET", "/api/ai/runtime?device=cpu", b"")
            .get("sidecar")
            .unwrap()
            .get("pid")
            .unwrap()
            .as_f64()
            .unwrap() as u32
    };
    let (code, message) = fail("[fake:hang]");
    assert_eq!(code, "hung", "{message}");
    assert!(start.elapsed() < Duration::from_secs(20));
    let st = t.json("GET", "/api/ai/runtime?device=cpu", b"");
    assert_eq!(
        st.get("sidecar").unwrap().get("state").unwrap().as_str(),
        Some("stopped")
    );
    #[cfg(target_os = "linux")]
    assert!(!alive(pid_before), "the hung server was stopped");
    let _ = pid_before;
    // Too long: past the run limit (8 slow steps take 2.4 s).
    ai.sidecar.set_limits(Limits {
        run: Duration::from_millis(1200),
        silence: Duration::from_secs(30),
        ..limits
    });
    assert_eq!(fail("[fake:slow]").0, "timeout");
    ai.sidecar.set_limits(Limits {
        silence: Duration::from_secs(30),
        ..limits
    });
    // A crash: why, with what it printed last.
    let (code, message) = fail("[fake:crash]");
    assert_eq!(code, "crashed");
    assert!(
        message.contains("GGML_ASSERT") && message.contains("code 3"),
        "{message}"
    );
    // The server says the job failed: the model stays loaded.
    let (code, message) = fail("[fake:fail]");
    assert_eq!(code, "failed");
    assert!(message.contains("empty results"), "{message}");
    let starts = lines(&rt.join("args.log")).len();
    let (code, _) = fail("[fake:fail]");
    assert_eq!(code, "failed");
    // An image of another size is refused.
    let (code, message) = fail("[fake:size=32x32]");
    assert_eq!(code, "wrong-size");
    assert!(message.contains("32×32 instead of 80×64"), "{message}");
    assert_eq!(
        lines(&rt.join("args.log")).len(),
        starts,
        "neither stopped the server"
    );
    // A run without progress lines still ends (the job state is enough).
    let v = post_run(&t, &run_body("ZIMAGE_Q4", "[fake:quiet]", 0.5, ""));
    assert_eq!(state(&wait_end(&t, id_of(&v))), "DONE");
    // Loading: a crash and a hang.
    std::fs::write(rt.join("fake-sd.json"), "{\"load\":\"crash\"}").unwrap();
    ai.sidecar.stop();
    let (code, message) = fail("p");
    assert_eq!(code, "crashed");
    assert!(message.contains("not a model"), "{message}");
    std::fs::write(rt.join("fake-sd.json"), "{\"load\":\"hang\"}").unwrap();
    ai.sidecar.set_limits(limits);
    let (code, message) = fail("p");
    assert_eq!(code, "hung");
    assert!(message.contains("loading"), "{message}");
    // Nothing of all that is left running: not even the server that hung while loading.
    #[cfg(target_os = "linux")]
    assert_eq!(running_from(&rt), Vec::<u32>::new());
    cleanup(t);
}

#[test]
fn requests_that_cannot_run_are_refused_with_the_reason() {
    let (t, data, _rt) = ready("ai-refusals", &["ZIMAGE_Q4", "SD15_LIGHT"]);
    let refuse = |body: String, status: u16, code: &str| {
        let r = t.api("POST", "/api/ai/run", body.as_bytes());
        assert_eq!(r.status, status, "{}", r.text());
        let v = json::parse(&r.text()).unwrap();
        assert_eq!(v.get("error").unwrap().as_str(), Some(code), "{}", r.text());
        v
    };
    let reason = |v: &Value| v.get("reason").and_then(Value::as_str).map(str::to_string);
    // Not downloaded; a web-only model; no such model.
    assert_eq!(
        reason(&refuse(
            run_body("ZIMAGE_Q8", "p", 0.3, ""),
            409,
            "unavailable"
        ))
        .as_deref(),
        Some("NO_MODEL")
    );
    assert_eq!(
        reason(&refuse(
            run_body("ZIMAGE_WEB", "p", 0.3, ""),
            409,
            "unavailable"
        ))
        .as_deref(),
        Some("MODEL_UNSUPPORTED")
    );
    assert_eq!(
        reason(&refuse(run_body("NOPE", "p", 0.3, ""), 409, "unavailable")).as_deref(),
        Some("NO_MODEL")
    );
    // Bad values.
    refuse(run_body("ZIMAGE_Q4", "p", 0.0, ""), 400, "bad-body");
    refuse(run_body("ZIMAGE_Q4", "p", 1.5, ""), 400, "bad-body");
    refuse(
        run_body("ZIMAGE_Q4", "p", 0.3, ",\"width\":64,\"height\":64"),
        400,
        "size",
    );
    refuse(
        run_body("ZIMAGE_Q4", "p", 0.3, ",\"force\":\"CUDA\""),
        400,
        "bad-body",
    );
    let (_, odd) = picture(65, 64);
    let (_, fine) = picture(80, 64);
    refuse(
        format!("{{\"model\":\"ZIMAGE_Q4\",\"image\":\"{fine}\",\"strength\":0.3,\"seed\":-1}}"),
        400,
        "bad-body",
    );
    refuse(
        format!(
            "{{\"model\":\"ZIMAGE_Q4\",\"image\":\"{odd}\",\"strength\":0.3,\"device\":\"cpu\"}}"
        ),
        400,
        "size",
    );
    // On the CPU like the others: without it, a computer with a usable graphics card asks for the
    // Vulkan build, which is not installed here, and is refused for that before the image is read.
    refuse(
        "{\"model\":\"ZIMAGE_Q4\",\"image\":\"bm90IGEgcG5n\",\"strength\":0.3,\"device\":\"cpu\"}"
            .into(),
        400,
        "bad-body",
    );
    // Control images: a model without ControlNets, an unknown kind, another size.
    let (_, control) = picture(80, 64);
    let (_, small) = picture(32, 32);
    refuse(
        run_body(
            "ZIMAGE_Q4",
            "p",
            0.3,
            &format!(",\"control\":{{\"kind\":\"depth\",\"image\":\"{control}\"}}"),
        ),
        409,
        "control-unsupported",
    );
    refuse(
        run_body(
            "SD15_LIGHT",
            "p",
            0.3,
            &format!(",\"control\":{{\"kind\":\"canny\",\"image\":\"{control}\"}}"),
        ),
        409,
        "control-unsupported",
    );
    refuse(
        run_body(
            "SD15_LIGHT",
            "p",
            0.3,
            &format!(",\"control\":{{\"kind\":\"tile\",\"image\":\"{small}\"}}"),
        ),
        400,
        "size",
    );
    // Forced Vulkan: that build is not installed.
    assert_eq!(
        reason(&refuse(
            run_body("ZIMAGE_Q4", "p", 0.3, ",\"force\":\"VULKAN\""),
            409,
            "unavailable"
        ))
        .as_deref(),
        Some("NO_RUNTIME")
    );
    // Nothing reached the runtime.
    assert!(!data
        .join("ai/runtimes")
        .join(PLACED)
        .join("args.log")
        .exists());
    assert_eq!(t.api("GET", "/api/ai/run/999", b"").status, 404);
    assert_eq!(t.api("PUT", "/api/ai/run", b"").status, 405);
    cleanup(t);
}

#[test]
fn the_status_is_an_ai_runtime_status() {
    let (t, _data, _rt) = ready("ai-status", &["ZIMAGE_Q4"]);
    let st = t.json("GET", "/api/ai/runtime?device=cpu&model=ZIMAGE_Q4", b"");
    assert_eq!(
        st.get("available").unwrap().as_bool(),
        Some(true),
        "{}",
        st.to_json()
    );
    assert!(st.get("reason").unwrap().is_null());
    assert_eq!(st.get("backend").unwrap().as_str(), Some("CPU"));
    assert_eq!(st.get("device").unwrap().as_str(), Some("Fake CPU"));
    assert_eq!(st.get("activeModel").unwrap().as_str(), Some("ZIMAGE_Q4"));
    assert!(strings(st.get("supports").unwrap()).contains(&"SD15_LIGHT".to_string()));
    let rt = st.get("runtime").unwrap();
    assert_eq!(rt.get("key").unwrap().as_str(), Some("TEST_CPU"));
    assert_eq!(rt.get("state").unwrap().as_str(), Some("installed"));
    assert_eq!(
        rt.get("version").unwrap().as_str(),
        Some("stable-diffusion.cpp version fake, commit fake000")
    );
    assert_eq!(
        st.get("choice").unwrap().get("rowId").unwrap().as_str(),
        Some("no-gpu")
    );
    assert_eq!(
        st.get("release").unwrap().get("tag").unwrap().as_str(),
        Some("master-959-d637cfb")
    );
    // Without a model, a model not downloaded, a model the runtime does not load; forced Vulkan.
    let reason = |q: &str| {
        let v = t.json("GET", &format!("/api/ai/runtime?device=cpu{q}"), b"");
        assert_eq!(v.get("available").unwrap().as_bool(), Some(false), "{q}");
        v.get("reason").unwrap().as_str().unwrap().to_string()
    };
    assert_eq!(reason(""), "NO_MODEL");
    assert_eq!(reason("&model=ZIMAGE_Q8"), "NO_MODEL");
    assert_eq!(reason("&model=ZIMAGE_WEB"), "MODEL_UNSUPPORTED");
    assert_eq!(reason("&model=ZIMAGE_Q4&force=VULKAN"), "NO_RUNTIME");
    let v = t.json("GET", "/api/ai/runtime?device=cpu&force=VULKAN", b"");
    assert_eq!(v.get("backend").unwrap().as_str(), Some("VULKAN"));
    assert!(v.get("device").unwrap().is_null());
    assert_eq!(
        v.get("runtime").unwrap().get("state").unwrap().as_str(),
        Some("missing")
    );
    // A runtime that does not start says why (a missing library), and is not available.
    let dir = t.dir.join("data/ai/runtimes").join(PLACED);
    std::fs::write(dir.join("fake-sd.json"), "{\"fail\":\"version\"}").unwrap();
    let rt = t.json("POST", "/api/ai/runtimes/TEST_CPU/probe", b"");
    assert!(
        rt.get("probeError")
            .unwrap()
            .as_str()
            .unwrap()
            .contains("libfake.so"),
        "{}",
        rt.to_json()
    );
    assert_eq!(reason("&model=ZIMAGE_Q4"), "NO_RUNTIME");
    std::fs::remove_file(dir.join("fake-sd.json")).unwrap();
    t.api("POST", "/api/ai/runtimes/TEST_CPU/probe", b"");
    assert_eq!(
        t.json("GET", "/api/info", b"")
            .get("aiApi")
            .unwrap()
            .as_f64(),
        Some(1.0)
    );
    // The same checks as the rest of the API: the token, and no foreign origin.
    assert_eq!(t.raw("GET", "/api/ai/runtime", &[], b"").status, 401);
    assert_eq!(t.raw("POST", "/api/ai/run", &[], b"{}").status, 401);
    let foreign = [
        ("X-Repackshot-Token", common::TOKEN),
        ("Origin", "https://evil.example"),
    ];
    assert_eq!(
        t.raw("POST", "/api/ai/runtimes/TEST_CPU/download", &foreign, b"")
            .status,
        403
    );
    cleanup(t);
}

/// A shipped binary takes its runtime catalogue from nowhere but itself: a catalogue file in the
/// data folder (the name the debug-only override used to read, which let these tests pass where a
/// release build would not have run them) changes nothing, in a debug or a release build.
#[test]
fn a_catalogue_in_the_data_folder_is_never_read() {
    let t = TestServer::start_with("ai-no-override", 1, |data| {
        std::fs::create_dir_all(data.join("ai")).unwrap();
        std::fs::write(
            data.join("ai/runtimes-override.json"),
            override_json("http://127.0.0.1:9/fake.zip", 1, PLACED),
        )
        .unwrap();
        place_fake(data);
        place_model(data, "ZIMAGE_Q4");
    });
    let rt = t.dir.join("data/ai/runtimes").join(PLACED);
    let st = t.json("GET", "/api/ai/runtime?device=cpu&model=ZIMAGE_Q4", b"");
    assert_eq!(
        st.get("available").unwrap().as_bool(),
        Some(false),
        "{}",
        st.to_json()
    );
    let keys: Vec<String> = st
        .get("runtimes")
        .unwrap()
        .as_array()
        .unwrap()
        .iter()
        .map(|r| r.get("key").unwrap().as_str().unwrap().to_string())
        .collect();
    let embedded: Vec<String> = catalogue::runtime_catalogue()
        .runtimes
        .iter()
        .map(|r| r.key.clone())
        .collect();
    assert_eq!(keys, embedded, "{}", st.to_json());
    assert_eq!(t.api("GET", "/api/ai/runtimes/TEST_CPU", b"").status, 404);
    // The fake put where the override's build would be installed is never started.
    let r = t.api(
        "POST",
        "/api/ai/run",
        run_body("ZIMAGE_Q4", "p", 0.3, "").as_bytes(),
    );
    assert_eq!(r.status, 409, "{}", r.text());
    assert!(!rt.join("args.log").exists());
    cleanup(t);
}

#[cfg(target_os = "linux")]
#[test]
fn the_server_is_stopped_when_idle_when_released_and_when_the_application_ends() {
    let (mut t, _data, _rt) = ready("ai-lifecycle", &["ZIMAGE_Q4"]);
    let ai = Arc::clone(&t.server.app.ai);
    let pid = |t: &TestServer| {
        t.json("GET", "/api/ai/runtime?device=cpu", b"")
            .get("sidecar")
            .unwrap()
            .get("pid")
            .and_then(Value::as_f64)
            .map(|p| p as u32)
    };
    let wait_dead = |p: u32| {
        let start = Instant::now();
        while alive(p) {
            assert!(start.elapsed() < Duration::from_secs(10), "{p} still runs");
            std::thread::sleep(Duration::from_millis(50));
        }
    };
    let one = |t: &TestServer| {
        let v = post_run(t, &run_body("ZIMAGE_Q4", "p", 0.5, ""));
        assert_eq!(state(&wait_end(t, id_of(&v))), "DONE");
    };
    // Released on request (closing the AI section).
    one(&t);
    let p1 = pid(&t).unwrap();
    assert!(alive(p1));
    assert_eq!(t.api("DELETE", "/api/ai/sidecar", b"").status, 204);
    wait_dead(p1);
    assert_eq!(pid(&t), None);
    // Released after a while unused.
    ai.sidecar.set_limits(Limits {
        idle: Duration::from_millis(1500),
        ..Limits::default()
    });
    one(&t);
    let p2 = pid(&t).unwrap();
    wait_dead(p2);
    // Stopped with the application.
    ai.sidecar.set_limits(Limits::default());
    one(&t);
    let p3 = pid(&t).unwrap();
    t.server.stop();
    wait_dead(p3);
    assert!(!t.dir.join("data/ai/sidecar.json").exists());
    cleanup(t);
}

/// A child process killed when the test ends, passed or failed, so a failure leaves nothing
/// running (CI's runner had to stop a fake server a failed run had left).
#[cfg(target_os = "linux")]
struct Reaped(std::process::Child);

#[cfg(target_os = "linux")]
impl Drop for Reaped {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

/// A server a previous launch left running, recorded in `<data>/ai/sidecar.json`, is stopped
/// when the next launch starts (`Ai::new`).
///
/// The test starts that server an instant before, so it first waits until the server really runs:
/// until it has created `args.log`, which only the fake's own code does. Until its `execve` has
/// finished, Linux may already have let the parent go on (`posix_spawn` is a vfork) while
/// `/proc/<pid>/exe` still names the parent's executable, the test binary, and a clean-up that
/// does not kill that process is right. On the CI runner, without this wait, the test failed in
/// about one run in two. A server a previous launch left has long finished starting.
#[cfg(target_os = "linux")]
fn a_stale_server_is_stopped(data: &Path) {
    let rt = place_fake(data);
    let server = rt.join(server_name());
    let mut orphan = Reaped(
        std::process::Command::new(&server)
            .args(["--listen-ip", "127.0.0.1", "--listen-port", "0"])
            .current_dir(&rt)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .unwrap(),
    );
    let start = Instant::now();
    while !rt.join("args.log").exists() {
        assert!(
            orphan.0.try_wait().unwrap().is_none(),
            "the fake server ended before it ran"
        );
        assert!(
            start.elapsed() < Duration::from_secs(60),
            "the fake server never started"
        );
        std::thread::sleep(Duration::from_millis(10));
    }
    std::fs::write(
        data.join("ai/sidecar.json"),
        json::Object::new()
            .num("pid", f64::from(orphan.0.id()))
            .str("server", &server.to_string_lossy())
            .build(),
    )
    .unwrap();
    let ai = rt_app::ai::Ai::new(data);
    let start = Instant::now();
    while orphan.0.try_wait().unwrap().is_none() {
        assert!(
            start.elapsed() < Duration::from_secs(60),
            "the orphan still runs"
        );
        std::thread::sleep(Duration::from_millis(20));
    }
    assert!(!data.join("ai/sidecar.json").exists());
    ai.shutdown();
}

#[cfg(target_os = "linux")]
#[test]
fn a_server_left_by_a_previous_launch_is_stopped_at_start() {
    let base = temp_dir("ai-stale");
    a_stale_server_is_stopped(&base.join("data"));
    let _ = std::fs::remove_dir_all(base);
}

/// The same with the data folder reached through a symbolic link: the kernel names the server
/// by its real path, the pid file by the path the launch used, and an orphan left there must be
/// stopped all the same (the path as written was compared, and it was never stopped).
#[cfg(target_os = "linux")]
#[test]
fn a_server_left_in_a_data_folder_behind_a_link_is_stopped_too() {
    let base = temp_dir("ai-stale-link");
    std::fs::create_dir_all(base.join("real")).unwrap();
    std::os::unix::fs::symlink(base.join("real"), base.join("link")).unwrap();
    a_stale_server_is_stopped(&base.join("link").join("data"));
    let _ = std::fs::remove_dir_all(base);
}

// ------------------------------------------------------------------ downloads, with real curl

/// Serves `bytes` at any path, with `Range: bytes=N-`; records the ranges asked; `throttle`
/// sleeps between 256 KiB pieces.
struct FileServer {
    port: u16,
    ranges: Arc<Mutex<Vec<String>>>,
    stop: Arc<AtomicBool>,
}

impl FileServer {
    fn start(bytes: Vec<u8>, throttle: Duration) -> FileServer {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let ranges = Arc::new(Mutex::new(Vec::new()));
        let stop = Arc::new(AtomicBool::new(false));
        let bytes = Arc::new(bytes);
        let (r, s) = (Arc::clone(&ranges), Arc::clone(&stop));
        std::thread::spawn(move || {
            for stream in listener.incoming().flatten() {
                if s.load(Ordering::Relaxed) {
                    break;
                }
                let (bytes, r) = (Arc::clone(&bytes), Arc::clone(&r));
                std::thread::spawn(move || {
                    let mut reader = BufReader::new(stream.try_clone().unwrap());
                    let Ok(req) = rt_app::http::read_request(&mut reader) else {
                        return;
                    };
                    let range = req.header("range").map(str::to_string);
                    r.lock().unwrap().push(range.clone().unwrap_or_default());
                    let start: usize = range
                        .as_deref()
                        .and_then(|v| v.strip_prefix("bytes="))
                        .and_then(|v| v.strip_suffix('-'))
                        .and_then(|v| v.parse().ok())
                        .unwrap_or(0);
                    let mut w = BufWriter::new(stream);
                    let head = if range.is_some() {
                        format!(
                            "HTTP/1.1 206 Partial Content\r\nContent-Length: {}\r\nContent-Range: bytes {start}-{}/{}\r\nConnection: close\r\n\r\n",
                            bytes.len() - start,
                            bytes.len() - 1,
                            bytes.len()
                        )
                    } else {
                        format!(
                            "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                            bytes.len()
                        )
                    };
                    if w.write_all(head.as_bytes()).is_err() {
                        return;
                    }
                    for piece in bytes[start..].chunks(256 << 10) {
                        if w.write_all(piece).and_then(|_| w.flush()).is_err() {
                            return;
                        }
                        std::thread::sleep(throttle);
                    }
                });
            }
        });
        FileServer { port, ranges, stop }
    }

    fn url(&self) -> String {
        format!("http://127.0.0.1:{}/fake.zip", self.port)
    }
}

impl Drop for FileServer {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        let _ = std::net::TcpStream::connect(("127.0.0.1", self.port));
    }
}

fn have_curl() -> bool {
    let found = rt_app::ai::download::Downloader::system().program.is_some();
    if !found {
        eprintln!("no curl on this computer: download tests skipped");
    }
    found
}

/// The fake as a release archive (one executable: the catalogue names it as server and cli),
/// padded with 8 MiB of filler: the fake is several times smaller in a release build than in a
/// debug one, and the download tests need an archive that takes a while at any build profile.
fn fake_zip() -> Vec<u8> {
    let bin = std::fs::read(FAKE).unwrap();
    let filler: Vec<u8> = (0..8u32 << 20)
        .map(|i| (i.wrapping_mul(2_654_435_761) >> 24) as u8)
        .collect();
    zip::write_stored(
        &[
            (server_name().as_str(), &bin, 0o100755),
            (
                "stable-diffusion.cpp.txt",
                b"MIT License (fake)\n",
                0o100644,
            ),
            ("filler.bin", &filler, 0o100644),
        ],
        false,
    )
}

fn wait_entry(t: &TestServer, key: &str, until: impl Fn(&Value) -> bool) -> Value {
    let start = Instant::now();
    loop {
        let v = t.json("GET", &format!("/api/ai/runtimes/{key}"), b"");
        if until(&v) {
            return v;
        }
        assert!(start.elapsed() < Duration::from_secs(60), "{}", v.to_json());
        std::thread::sleep(Duration::from_millis(20));
    }
}

fn entry_state(v: &Value) -> &str {
    v.get("state").unwrap().as_str().unwrap()
}

#[test]
fn download_pause_resume_check_unpack_and_remove() {
    if !have_curl() {
        return;
    }
    let zip_bytes = fake_zip();
    let (len, digest) = (zip_bytes.len() as u64, sha(&zip_bytes));
    let files = FileServer::start(zip_bytes, Duration::from_millis(30));
    let url = files.url();
    let options = with_catalogue(&override_json(&url, len, &digest));
    let t = TestServer::start_with_options("ai-download", 1, options, |_| {});
    let root = t.dir.join("data/ai/runtimes");
    let v = t.json("GET", "/api/ai/runtimes/TEST_CPU", b"");
    assert_eq!(entry_state(&v), "missing");
    // Another system's build, an unknown key.
    assert_eq!(
        t.api("POST", "/api/ai/runtimes/TEST_OTHER/download", b"")
            .status,
        409
    );
    assert_eq!(
        t.api("POST", "/api/ai/runtimes/NOPE/download", b"").status,
        404
    );
    assert_eq!(
        t.api("POST", "/api/ai/runtimes/TEST_CPU/download", b"")
            .status,
        202
    );
    let v = wait_entry(&t, "TEST_CPU", |v| {
        v.get("done").unwrap().as_f64().unwrap() > len as f64 / 8.0
    });
    assert_eq!(entry_state(&v), "downloading");
    assert_eq!(v.get("total").unwrap().as_f64(), Some(len as f64));
    assert_eq!(
        t.api("POST", "/api/ai/runtimes/TEST_CPU/pause", b"").status,
        200
    );
    let paused = wait_entry(&t, "TEST_CPU", |v| entry_state(v) == "paused");
    let done = paused.get("done").unwrap().as_f64().unwrap() as u64;
    assert!(done > 0 && done < len, "{done} of {len}");
    assert_eq!(
        std::fs::metadata(root.join(format!("{digest}.zip.part")))
            .unwrap()
            .len(),
        done
    );
    // Resumed from the byte where it stopped.
    assert_eq!(
        t.api("POST", "/api/ai/runtimes/TEST_CPU/download", b"")
            .status,
        202
    );
    let v = wait_entry(&t, "TEST_CPU", |v| entry_state(v) == "installed");
    assert_eq!(
        files.ranges.lock().unwrap().last().map(String::as_str),
        Some(format!("bytes={done}-").as_str())
    );
    assert_eq!(
        v.get("version").unwrap().as_str(),
        Some("stable-diffusion.cpp version fake, commit fake000")
    );
    assert_eq!(
        v.get("devices").unwrap().as_array().unwrap()[0]
            .get("description")
            .unwrap()
            .as_str(),
        Some("Fake CPU")
    );
    assert!(v.get("error").unwrap().is_null());
    assert!(root.join(&digest).join(server_name()).is_file());
    assert!(
        !root.join(format!("{digest}.zip.part")).exists(),
        "the archive is not kept"
    );
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = std::fs::metadata(root.join(&digest).join(server_name()))
            .unwrap()
            .permissions()
            .mode();
        assert_eq!(mode & 0o777, 0o755);
    }
    // Installed, it is the status's runtime; removed, everything of it goes.
    let st = t.json("GET", "/api/ai/runtime?device=cpu", b"");
    assert_eq!(st.get("reason").unwrap().as_str(), Some("NO_MODEL"));
    assert_eq!(st.get("device").unwrap().as_str(), Some("Fake CPU"));
    assert_eq!(
        t.api("DELETE", "/api/ai/runtimes/TEST_CPU", b"").status,
        204
    );
    assert!(!root.join(&digest).exists());
    assert_eq!(
        entry_state(&t.json("GET", "/api/ai/runtimes/TEST_CPU", b"")),
        "missing"
    );
    drop(files);
    cleanup(t);
}

#[test]
fn a_sha256_mismatch_never_installs() {
    if !have_curl() {
        return;
    }
    let good = fake_zip();
    let mut bad = good.clone();
    let middle = bad.len() / 2;
    bad[middle] ^= 0x55;
    let (len, digest) = (good.len() as u64, sha(&good));
    let files = FileServer::start(bad, Duration::ZERO);
    let url = files.url();
    let options = with_catalogue(&override_json(&url, len, &digest));
    let t = TestServer::start_with_options("ai-mismatch", 1, options, |_| {});
    assert_eq!(
        t.api("POST", "/api/ai/runtimes/TEST_CPU/download", b"")
            .status,
        202
    );
    let v = wait_entry(&t, "TEST_CPU", |v| !v.get("error").unwrap().is_null());
    assert_eq!(entry_state(&v), "missing", "{}", v.to_json());
    let error = v.get("error").unwrap().as_str().unwrap();
    assert!(
        error.starts_with("sha256-mismatch") && error.contains(&digest),
        "{error}"
    );
    let root = t.dir.join("data/ai/runtimes");
    assert!(!root.join(&digest).exists(), "nothing installed");
    assert!(
        !root.join(format!("{digest}.zip.part")).exists(),
        "the bad bytes are deleted"
    );
    assert!(std::fs::read_dir(&root).unwrap().next().is_none());
    let st = t.json("GET", "/api/ai/runtime?device=cpu&model=ZIMAGE_Q4", b"");
    assert_eq!(st.get("reason").unwrap().as_str(), Some("NO_RUNTIME"));
    drop(files);
    cleanup(t);
}

#[test]
fn an_archive_the_person_downloaded_installs_only_if_it_is_the_pinned_one() {
    let base = temp_dir("ai-from-file");
    let zip_bytes = fake_zip();
    let archive = base.join("downloaded.zip");
    std::fs::write(&archive, &zip_bytes).unwrap();
    let cat = catalogue::parse_runtimes_allowing_http(&override_json(
        "http://127.0.0.1:9/x.zip",
        zip_bytes.len() as u64,
        &sha(&zip_bytes),
    ))
    .unwrap();
    let none = rt_app::ai::download::Downloader {
        program: None,
        allow_http: false,
    };
    let store = Arc::new(Runtimes::new(
        base.join("runtimes"),
        cat.clone(),
        none.clone(),
    ));
    let wait = |store: &Runtimes| {
        let start = Instant::now();
        loop {
            match store.state("TEST_CPU").unwrap() {
                State::Downloading { .. } | State::Verifying { .. } | State::Installing => {}
                s => return s,
            }
            assert!(start.elapsed() < Duration::from_secs(60));
            std::thread::sleep(Duration::from_millis(20));
        }
    };
    // Another file of the same size: refused by its SHA-256.
    let mut other = zip_bytes.clone();
    other[10] ^= 1;
    std::fs::write(base.join("other.zip"), &other).unwrap();
    store
        .start("TEST_CPU", Source::File(base.join("other.zip")))
        .unwrap();
    assert_eq!(wait(&store), State::Missing);
    assert!(store
        .error("TEST_CPU")
        .unwrap()
        .starts_with("sha256-mismatch"));
    // A file of another size is refused before reading it.
    std::fs::write(base.join("short.zip"), b"PK").unwrap();
    store
        .start("TEST_CPU", Source::File(base.join("short.zip")))
        .unwrap();
    assert_eq!(wait(&store), State::Missing);
    assert!(store
        .error("TEST_CPU")
        .unwrap()
        .starts_with("size-mismatch"));
    // The right one.
    store.start("TEST_CPU", Source::File(archive)).unwrap();
    assert!(matches!(wait(&store), State::Installed(_)));
    assert!(store.error("TEST_CPU").is_none());
    let probe = store.probe("TEST_CPU").unwrap();
    assert_eq!(
        probe.version.as_deref(),
        Some("stable-diffusion.cpp version fake, commit fake000")
    );
    // A new store over the same folder (the next launch) finds it installed.
    let again = Runtimes::new(base.join("runtimes"), cat, none);
    assert!(again.installed("TEST_CPU").is_some());
    let _ = std::fs::remove_dir_all(base);
}

/// With the real Linux CPU build of the pinned release:
/// `RPX_SDCPP_LINUX_CPU_ZIP=<sd-master-d637cfb-bin-Linux-Ubuntu-24.04-x86_64.zip> cargo test -p
/// rt-app --test ai real_linux_cpu -- --ignored --nocapture`: it installs through the store
/// (SHA-256, unpack), answers `--version`, `--list-devices` and `--help`, and the status shows it.
#[test]
#[ignore = "needs RPX_SDCPP_LINUX_CPU_ZIP, the real release archive"]
fn real_linux_cpu_build() {
    let Some(zip_path) = std::env::var_os("RPX_SDCPP_LINUX_CPU_ZIP") else {
        return;
    };
    let t = TestServer::start("ai-real", 1);
    let ai = &t.server.app.ai;
    ai.runtimes
        .start("SDCPP_LINUX_CPU", Source::File(PathBuf::from(zip_path)))
        .unwrap();
    let start = Instant::now();
    let v = loop {
        let v = t.json("GET", "/api/ai/runtimes/SDCPP_LINUX_CPU", b"");
        if entry_state(&v) == "installed" || !v.get("error").unwrap().is_null() {
            break v;
        }
        assert!(start.elapsed() < Duration::from_secs(300));
        std::thread::sleep(Duration::from_millis(100));
    };
    println!("{}", v.to_json());
    assert_eq!(entry_state(&v), "installed", "{}", v.to_json());
    let version = v.get("version").unwrap().as_str().unwrap();
    assert!(version.contains("commit d637cfb"), "{version}");
    let st = t.json("GET", "/api/ai/runtime?device=cpu", b"");
    println!("{}", st.to_json());
    assert_eq!(st.get("backend").unwrap().as_str(), Some("CPU"));
    assert!(st.get("device").unwrap().as_str().is_some());
    let i = ai.runtimes.installed("SDCPP_LINUX_CPU").unwrap();
    for exe in [&i.cli, &i.server] {
        let mut c = std::process::Command::new(exe);
        c.arg("--help").current_dir(&i.dir);
        let out = rt_app::ai::proc::capture(c, Duration::from_secs(60)).unwrap();
        assert!(out.ok() && out.stdout.contains("Usage:"), "{}", out.stderr);
        assert!(out.stdout.contains("--listen-port") || exe == &i.cli);
    }
    cleanup(t);
}

/// One real img2img with SD 1.5 on the CPU: `RPX_SDCPP_LINUX_CPU_ZIP` as above and
/// `RPX_SD15_WEIGHTS=<v1-5-pruned-emaonly-fp16.safetensors>` (checked against its pinned SHA-256);
/// the two ControlNets are not loaded without a control image, so placeholders stand in for them.
/// `RPX_SD15_OUT` keeps the result.
#[test]
#[ignore = "needs the real runtime archive and the SD 1.5 weights (2.1 GB)"]
fn real_img2img_sd15_on_the_cpu() {
    let (Some(zip_path), Some(weights)) = (
        std::env::var_os("RPX_SDCPP_LINUX_CPU_ZIP"),
        std::env::var_os("RPX_SD15_WEIGHTS"),
    ) else {
        return;
    };
    let model = rt_app::recommend::catalogue()
        .model("SD15_LIGHT")
        .unwrap()
        .clone();
    let t = TestServer::start_with("ai-real-sd15", 1, |data| {
        let blobs = data.join("models").join("blobs");
        std::fs::create_dir_all(&blobs).unwrap();
        for f in &model.files {
            if f.role == "transformer" {
                link_or_copy(&weights.to_string_lossy(), &blobs.join(&f.sha256));
            } else {
                std::fs::write(
                    blobs.join(&f.sha256),
                    b"placeholder: not loaded without a control image",
                )
                .unwrap();
            }
        }
    });
    let ai = &t.server.app.ai;
    ai.runtimes
        .start("SDCPP_LINUX_CPU", Source::File(PathBuf::from(zip_path)))
        .unwrap();
    let start = Instant::now();
    while ai.runtimes.installed("SDCPP_LINUX_CPU").is_none() {
        assert!(
            start.elapsed() < Duration::from_secs(300),
            "{:?}",
            ai.runtimes.error("SDCPP_LINUX_CPU")
        );
        std::thread::sleep(Duration::from_millis(100));
    }
    // A 512 × 512 picture: a grey gradient with a bright square.
    let (w, h) = (512u32, 512u32);
    let rgb: Vec<u8> = (0..w * h)
        .flat_map(|i| {
            let (x, y) = (i % w, i / w);
            let inside = (160..352).contains(&x) && (160..352).contains(&y);
            let v = if inside {
                220
            } else {
                (40 + y / 4) as u8 as u32
            } as u8;
            [v, v, if inside { 120 } else { v }]
        })
        .collect();
    let image = b64::encode(&rt_core::png::encode(w, h, &rgb));
    let body = format!(
        "{{\"model\":\"SD15_LIGHT\",\"image\":\"{image}\",\"prompt\":\"a product photograph of a yellow box on a grey studio background, soft light\",\"negative\":\"text, watermark\",\"strength\":0.5,\"seed\":7,\"steps\":8,\"device\":\"cpu\"}}"
    );
    let started = Instant::now();
    let v = post_run(&t, &body);
    let id = id_of(&v);
    let mut last = String::new();
    let end = follow_for(&t, id, Duration::from_secs(45 * 60), |v| {
        let s = format!(
            "{} {}/{}",
            state(v),
            v.get("step").unwrap().to_json(),
            v.get("steps").unwrap().to_json()
        );
        if s != last {
            println!("{:>7.1} s  {s}", started.elapsed().as_secs_f64());
            last = s;
        }
    });
    println!("{}", end.to_json());
    assert_eq!(state(&end), "DONE", "{}", end.to_json());
    let img = t.api("GET", &format!("/api/ai/run/{id}/image"), b"");
    let out = png::decode(&img.body, 1 << 22).unwrap();
    assert_eq!((out.width, out.height), (w, h));
    if let Some(path) = std::env::var_os("RPX_SD15_OUT") {
        std::fs::write(path, &img.body).unwrap();
    }
    println!(
        "img2img 512² × 8 steps × strength 0.5 on the CPU: {:.1} s",
        started.elapsed().as_secs_f64()
    );
    cleanup(t);
}

/// The pinned Linux CPU build downloaded for real, from GitHub, with the system's `curl`:
/// `RPX_REAL_DOWNLOAD=1 cargo test -p rt-app --test ai real_download -- --ignored --nocapture`.
/// Paused after a few MB and resumed (`--continue-at`), checked, unpacked, asked its version.
#[test]
#[ignore = "downloads 26 MB from GitHub"]
fn real_download_from_github() {
    if std::env::var_os("RPX_REAL_DOWNLOAD").is_none() || !have_curl() {
        return;
    }
    let base = temp_dir("ai-real-download");
    let store = Arc::new(Runtimes::new(
        base.join("runtimes"),
        catalogue::runtime_catalogue().clone(),
        rt_app::ai::download::Downloader::system(),
    ));
    let key = "SDCPP_LINUX_CPU";
    let started = Instant::now();
    store.start(key, Source::Download).unwrap();
    loop {
        match store.state(key).unwrap() {
            State::Downloading { done } if done > 3 << 20 => break,
            State::Downloading { .. } => {}
            other => panic!("{other:?} {:?}", store.error(key)),
        }
        assert!(started.elapsed() < Duration::from_secs(300));
        std::thread::sleep(Duration::from_millis(20));
    }
    store.pause(key).unwrap();
    let paused = loop {
        if let State::Paused { done } = store.state(key).unwrap() {
            break done;
        }
        std::thread::sleep(Duration::from_millis(20));
    };
    println!(
        "paused at {paused} bytes after {:.1} s",
        started.elapsed().as_secs_f64()
    );
    store.start(key, Source::Download).unwrap();
    loop {
        match store.state(key).unwrap() {
            State::Installed(_) => break,
            State::Missing | State::Paused { .. } => panic!("{:?}", store.error(key)),
            _ => {}
        }
        assert!(started.elapsed() < Duration::from_secs(600));
        std::thread::sleep(Duration::from_millis(50));
    }
    let p = store.probe(key).unwrap();
    println!(
        "installed in {:.1} s: {:?}",
        started.elapsed().as_secs_f64(),
        p
    );
    assert!(p.version.unwrap().contains("commit d637cfb"));
    let _ = std::fs::remove_dir_all(base);
}
