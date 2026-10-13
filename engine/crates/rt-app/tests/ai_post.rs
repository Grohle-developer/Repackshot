//! The desktop AI pipeline (phase X3c, `POST /api/ai/post`) end to end over real sockets: a final
//! render with passes kept by the launcher, the fake runtime `rt-fake-sd` making the model's tiles,
//! the guard of `rt-post` deciding, and the page's view of it all (states, progress, the image).

mod common;

use common::ai::*;
use common::TestServer;
use rt_app::ai::post::{linear_of, read_image, write_image, INLINE_MAGIC};
use rt_app::json::{self, Value};
use rt_app::kept::write_passes;
use rt_core::passes::{Passes, FLOOR_ID, PASS_EXACT};
use rt_core::scene::{FloorMode, Geometry, Instance, Scene, Transform};
use rt_post::LinearImage;
use std::path::Path;
use std::time::{Duration, Instant};

/// The guard's passes, without the albedo (it does not use it).
const GUARD_PASSES: &str = "normal,depth,partId,materialId,coc";

/// The example scene at `w × h`, `samples` a pixel.
fn example(w: u32, h: u32, samples: u32) -> Scene {
    let mut scene = rt_core::example::scene();
    scene.render.width = w;
    scene.render.height = h;
    scene.render.max_samples = samples;
    scene
}

/// Renders a final with the guard's passes and waits until the launcher keeps it.
fn render_final(t: &TestServer, scene: &Scene) -> u32 {
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

/// The pipeline's settings as the page sends them.
fn settings(intervention: u32, light: u32, bounce: u32, wear: u32, style: u32) -> String {
    format!(
        "{{\"intervention\":{intervention},\"light\":{light},\"bounce\":{bounce},\"wear\":{wear},\"style\":\"WARM\",\"styleStrength\":{style},\"seed\":5}}"
    )
}

fn body(render: u32, settings: &str, model: &str, prompt: &str, extra: &str) -> String {
    format!(
        "{{\"source\":{{\"kind\":\"RENDER\",\"renderId\":\"{render}\"}},\"settings\":{settings},\"prompt\":{},\"negative\":\"changed shape\",\"modelKey\":\"{model}\",\"device\":\"cpu\",\"materials\":[{{\"materialId\":1,\"name\":\"Coral\",\"allowsWear\":true,\"locked\":false}},{{\"materialId\":2,\"name\":\"Slate\",\"allowsWear\":true,\"locked\":false}},{{\"materialId\":3,\"name\":\"Blue\",\"allowsWear\":false,\"locked\":false}}]{extra}}}",
        json::string(prompt)
    )
}

fn submit(t: &TestServer, body: &str) -> Value {
    let r = t.api("POST", "/api/ai/post", body.as_bytes());
    assert_eq!(r.status, 202, "{}", r.text());
    json::parse(&r.text()).unwrap()
}

fn num(v: &Value, k: &str) -> f64 {
    v.get(k)
        .and_then(Value::as_f64)
        .unwrap_or_else(|| panic!("{k} in {}", v.to_json()))
}

fn text<'a>(v: &'a Value, k: &str) -> &'a str {
    v.get(k).and_then(Value::as_str).unwrap_or("")
}

/// Follows a post to its end with the long poll; every state seen, in order.
fn follow(t: &TestServer, id: u32, mut on: impl FnMut(&Value)) -> Value {
    let start = Instant::now();
    let mut version = 0;
    loop {
        let v = t.json("GET", &format!("/api/ai/post/{id}?after={version}"), b"");
        on(&v);
        version = num(&v, "version") as u32;
        if matches!(text(&v, "state"), "DONE" | "FAILED" | "CANCELLED") {
            return v;
        }
        assert!(
            start.elapsed() < Duration::from_secs(600),
            "post {id} never ended: {}",
            v.to_json()
        );
    }
}

fn image_of(t: &TestServer, id: u32) -> LinearImage {
    let r = t.api("GET", &format!("/api/ai/post/{id}/image"), b"");
    assert_eq!(r.status, 200, "{}", r.text());
    assert_eq!(r.header("content-type"), Some("application/octet-stream"));
    let (img, used) = read_image(&r.body, 16_384).expect("an RPL1 image");
    assert_eq!(used, r.body.len());
    img
}

fn engine_image(t: &TestServer, render: u32) -> LinearImage {
    linear_of(&t.server.app.engine.kept(render).unwrap().image).unwrap()
}

fn same_bits(a: &LinearImage, b: &LinearImage) -> bool {
    (a.width, a.height) == (b.width, b.height)
        && a.rgba.len() == b.rgba.len()
        && a.rgba
            .iter()
            .zip(&b.rgba)
            .all(|(x, y)| x.to_bits() == y.to_bits())
}

fn cleanup(t: TestServer) {
    let dir = t.dir.clone();
    drop(t);
    let _ = std::fs::remove_dir_all(dir);
}

fn write_control(rt: &Path, json: &str) {
    std::fs::write(rt.join("fake-sd.json"), json).unwrap();
}

fn requests(rt: &Path) -> Vec<Value> {
    std::fs::read_to_string(rt.join("requests.log"))
        .unwrap_or_default()
        .lines()
        .map(|l| json::parse(l).unwrap())
        .collect()
}

fn starts(rt: &Path) -> usize {
    std::fs::read_to_string(rt.join("args.log"))
        .unwrap_or_default()
        .lines()
        .count()
}

fn sidecar_state(t: &TestServer) -> String {
    let st = t.json("GET", "/api/ai/runtime?device=cpu", b"");
    st.get("sidecar")
        .and_then(|s| s.get("state"))
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string()
}

#[test]
fn intervention_zero_is_the_engine_image_bit_for_bit_and_never_starts_the_runtime() {
    // With a runtime and a model ready, and with neither: nothing may change, so nothing runs.
    let (ready_t, _data, rt) = ready("post-zero", &["ZIMAGE_Q4"]);
    let bare = TestServer::start("post-zero-bare", 2);
    for (t, model) in [(&ready_t, "ZIMAGE_Q4"), (&bare, "SD15_LIGHT")] {
        let id = render_final(t, &example(96, 64, 2));
        for s in [settings(0, 50, 40, 20, 30), settings(30, 0, 0, 0, 0)] {
            let v = submit(t, &body(id, &s, model, "a studio photograph", ""));
            assert_eq!(num(&v, "tiles"), 0.0, "{s}: no tiles, no model");
            let end = follow(t, num(&v, "id") as u32, |_| {});
            assert_eq!(text(&end, "state"), "DONE", "{}", end.to_json());
            let report = end.get("report").unwrap();
            assert_eq!(text(report, "verdict"), "ACCEPTED");
            assert_eq!(num(report, "attempts"), 0.0);
            assert_eq!(num(report, "usedFraction"), 1.0);
            assert_eq!(text(report, "modelKey"), model);
            assert_eq!(num(&end, "calls"), 0.0);
            let img = image_of(t, num(&v, "id") as u32);
            assert!(same_bits(&img, &engine_image(t, id)), "{s}: bit for bit");
        }
    }
    assert_eq!(starts(&rt), 0, "the runtime was never started");
    assert_eq!(sidecar_state(&ready_t), "stopped");
    // The linear image is the page's conversion of the sums (opaque pixels: sum / samples).
    let kept = ready_t.server.app.engine.kept(1).unwrap();
    let img = engine_image(&ready_t, 1);
    let inv = (1.0f64 / f64::from(kept.image.samples)) as f32;
    for p in [0usize, 777, 96 * 64 - 1] {
        assert_eq!(img.rgba[p * 4], kept.image.sums[p * 4] * inv);
        assert_eq!(img.rgba[p * 4 + 3], 1.0);
    }
    cleanup(ready_t);
    cleanup(bare);
}

#[test]
fn a_final_render_goes_through_every_tile_and_the_guard_with_progress_per_tile() {
    let (t, _data, rt) = ready("post-tiles", &["ZIMAGE_Q4"]);
    write_control(&rt, r#"{"image":"gain","stepMs":120}"#);
    // 1160 px wide: two tiles of 656 × 112 (padded from 100). 20 steps at strength 0.24: four
    // sampling steps a tile, long enough to be seen.
    let id = render_final(&t, &example(1160, 100, 1));
    let v = submit(
        &t,
        &body(
            id,
            &settings(60, 100, 40, 0, 30),
            "ZIMAGE_Q4",
            "a studio photograph",
            ",\"steps\":20",
        ),
    );
    assert_eq!((num(&v, "tiles"), text(&v, "state")), (2.0, "QUEUED"));
    let pid = num(&v, "id") as u32;
    let mut seen: Vec<(String, u32, u32, f64)> = Vec::new();
    let end = follow(&t, pid, |s| {
        seen.push((
            text(s, "state").to_string(),
            num(s, "tile") as u32,
            num(s, "attempt") as u32,
            num(s, "fraction"),
        ));
    });
    assert_eq!(text(&end, "state"), "DONE", "{}", end.to_json());
    let report = end.get("report").unwrap();
    assert_eq!(text(report, "verdict"), "ACCEPTED", "{}", report.to_json());
    assert_eq!(num(report, "attempts"), 1.0);
    assert_eq!(text(report, "runtime"), "TEST_CPU");
    assert!(num(report, "seconds") > 0.0);
    // Per tile: tile 1 then tile 2 in inference, then the guard; the fraction never goes back.
    let tiles: Vec<u32> = seen
        .iter()
        .filter(|s| s.0 == "INFERENCE")
        .map(|s| s.1)
        .collect();
    assert!(tiles.contains(&1) && tiles.contains(&2), "{seen:?}");
    assert!(tiles.windows(2).all(|w| w[0] <= w[1]), "{seen:?}");
    assert!(seen.iter().any(|s| s.0 == "GUARD"), "{seen:?}");
    assert!(seen.iter().any(|s| s.0 == "LOADING"), "{seen:?}");
    assert!(
        seen.windows(2).all(|w| w[0].3 <= w[1].3),
        "the fraction goes forward only: {seen:?}"
    );
    assert_eq!(end.get("fraction").unwrap().as_f64(), Some(1.0));
    // Each tile was asked at its exact padded size, the first attempt's strength and the seed.
    let reqs = requests(&rt);
    assert_eq!(reqs.len(), 2);
    for r in &reqs {
        assert_eq!((num(r, "width"), num(r, "height")), (656.0, 112.0));
        assert_eq!(num(r, "strength"), f64::from(0.6f32 * 0.4f32));
        assert_eq!(num(r, "seed"), 5.0);
        assert_eq!(text(r, "prompt"), "a studio photograph");
        let sp = r.get("sample_params").unwrap();
        assert_eq!(num(sp, "sample_steps"), 20.0);
        assert!(
            r.get("control_image").unwrap().is_null(),
            "z-image has no ControlNet"
        );
    }
    // The image: the job's size, changed where the light may change it, the background kept.
    let img = image_of(&t, pid);
    let orig = engine_image(&t, id);
    assert_eq!((img.width, img.height), (1160, 100));
    let kept = t.server.app.engine.kept(id).unwrap();
    let (mut changed, mut background_changed) = (0, 0);
    for p in 0..(1160 * 100) {
        let differs =
            (0..4).any(|c| img.rgba[p * 4 + c].to_bits() != orig.rgba[p * 4 + c].to_bits());
        if kept.passes.part_id[p] == 0 {
            background_changed += usize::from(differs);
        } else {
            changed += usize::from(differs);
        }
    }
    assert_eq!(background_changed, 0);
    assert!(changed > 1000, "{changed}");
    // The model stays loaded: a second post starts no new server. Its tiles are too quick for the
    // runtime to report a sampling step (one step of 5 ms), and still each says it started, as
    // inference (the model is loaded: nothing to load), and says so while the runtime takes its
    // time to accept the job (250 ms: long enough to be seen).
    write_control(&rt, r#"{"image":"gain","stepMs":5,"acceptMs":250}"#);
    let v = submit(
        &t,
        &body(id, &settings(30, 50, 0, 0, 0), "ZIMAGE_Q4", "again", ""),
    );
    let mut quick: Vec<(String, u32)> = Vec::new();
    let again = follow(&t, num(&v, "id") as u32, |s| {
        quick.push((text(s, "state").to_string(), num(s, "tile") as u32));
    });
    assert_eq!(text(&again, "state"), "DONE");
    for tile in [1, 2] {
        assert!(
            quick.contains(&("INFERENCE".to_string(), tile)),
            "tile {tile}: {quick:?}"
        );
    }
    assert!(!quick.iter().any(|q| q.0 == "LOADING"), "{quick:?}");
    assert_eq!(starts(&rt), 1);
    assert_eq!(sidecar_state(&t), "ready");
    cleanup(t);
}

#[test]
fn retries_lower_the_strength_by_the_retry_factor_then_deliver_the_engine_image() {
    let (t, _data, rt) = ready("post-retry", &["SD15_LIGHT"]);
    write_control(&rt, r#"{"image":"gain"}"#);
    let id = render_final(&t, &example(160, 96, 1));
    // A floor no result can reach (an SSIM is at most 1): every attempt fails.
    let v = submit(
        &t,
        &body(
            id,
            &settings(80, 50, 40, 20, 30),
            "SD15_LIGHT",
            "p",
            ",\"tolerances\":{\"detailSsim\":2}",
        ),
    );
    let mut retries = Vec::new();
    let end = follow(&t, num(&v, "id") as u32, |s| {
        if text(s, "state") == "RETRY" {
            retries.push(num(s, "attempt") as u32);
        }
    });
    assert_eq!(text(&end, "state"), "DONE");
    let report = end.get("report").unwrap();
    assert_eq!(text(report, "verdict"), "REJECTED");
    assert_eq!(num(report, "attempts"), f64::from(rt_post::MAX_ATTEMPTS));
    assert_eq!(num(report, "usedFraction"), 0.0);
    assert!(text(report, "reason").starts_with("no attempt passed"));
    assert!(retries.contains(&2) && retries.contains(&4), "{retries:?}");
    // The strengths asked, exactly the plan's: Intervention × MAX_STRENGTH × RETRY_FACTOR^attempt.
    let plan = rt_post::plan(&rt_post::Job::new(
        160,
        96,
        rt_post::Settings {
            intervention: 80,
            ..rt_post::Settings::DEFAULT
        },
    ))
    .unwrap();
    let asked: Vec<f64> = requests(&rt).iter().map(|r| num(r, "strength")).collect();
    let want: Vec<f64> = (0..rt_post::MAX_ATTEMPTS)
        .map(|a| f64::from(plan.strength(a)))
        .collect();
    assert_eq!(asked, want);
    // The same numbers worked out by hand: 0.8 × 0.6^attempt, then × 0.4, in f32.
    let mut scale = 0.8f32;
    for a in &asked {
        assert_eq!(*a, f64::from(scale * 0.4));
        scale *= 0.6;
    }
    // SD 1.5 has a depth ControlNet: every tile carried the depth image of the exact passes.
    for r in requests(&rt) {
        assert!(
            text(&r, "control_image").starts_with('<'),
            "{}",
            r.to_json()
        );
        assert_eq!(num(&r, "control_strength"), 0.9);
    }
    let args = std::fs::read_to_string(rt.join("args.log")).unwrap();
    assert!(args.contains("--control-net"), "{args}");
    // Rejected: the engine image, unchanged.
    assert!(same_bits(
        &image_of(&t, num(&v, "id") as u32),
        &engine_image(&t, id)
    ));
    cleanup(t);
}

#[test]
fn a_tile_of_another_size_is_rejected_and_the_engine_image_delivered() {
    let (t, _data, rt) = ready("post-size", &["ZIMAGE_Q4"]);
    let id = render_final(&t, &example(96, 64, 1));
    let v = submit(
        &t,
        &body(
            id,
            &settings(30, 50, 40, 20, 30),
            "ZIMAGE_Q4",
            "[fake:size=64x64]",
            "",
        ),
    );
    let end = follow(&t, num(&v, "id") as u32, |_| {});
    assert_eq!(text(&end, "state"), "DONE", "{}", end.to_json());
    let report = end.get("report").unwrap();
    assert_eq!(text(report, "verdict"), "REJECTED");
    let size = report.get("size").unwrap();
    assert_eq!(size.get("ok").unwrap().as_bool(), Some(false));
    assert!(
        text(report, "reason").contains("came back 64x64 instead of 96x64"),
        "{}",
        report.to_json()
    );
    // At once: a lower strength would not change the size.
    assert_eq!(requests(&rt).len(), 1);
    assert!(same_bits(
        &image_of(&t, num(&v, "id") as u32),
        &engine_image(&t, id)
    ));
    cleanup(t);
}

#[test]
fn cancelling_mid_way_keeps_the_engine_image_and_the_loaded_model() {
    let (t, _data, rt) = ready("post-cancel", &["ZIMAGE_Q4"]);
    write_control(&rt, r#"{"image":"gain","stepMs":300}"#);
    let id = render_final(&t, &example(96, 64, 1));
    let v = submit(
        &t,
        &body(id, &settings(100, 50, 40, 20, 30), "ZIMAGE_Q4", "p", ""),
    );
    let pid = num(&v, "id") as u32;
    let mut cancelled_at = None;
    let end = follow(&t, pid, |s| {
        if text(s, "state") == "INFERENCE" && num(s, "step") >= 1.0 && cancelled_at.is_none() {
            assert_eq!(
                t.api("DELETE", &format!("/api/ai/post/{pid}"), b"").status,
                204
            );
            cancelled_at = Some(Instant::now());
        }
    });
    assert_eq!(text(&end, "state"), "CANCELLED", "{}", end.to_json());
    assert!(cancelled_at.unwrap().elapsed() < Duration::from_secs(10));
    assert_eq!(
        t.api("GET", &format!("/api/ai/post/{pid}/image"), b"")
            .status,
        409
    );
    // The engine's render is still kept, as it was; the model is still loaded.
    assert!(t.server.app.engine.kept(id).is_some());
    assert_eq!(sidecar_state(&t), "ready");
    // A finished post is forgotten by the same DELETE.
    assert_eq!(
        t.api("DELETE", &format!("/api/ai/post/{pid}"), b"").status,
        204
    );
    assert_eq!(
        t.api("GET", &format!("/api/ai/post/{pid}"), b"").status,
        404
    );
    cleanup(t);
}

#[test]
fn a_model_the_runtime_does_not_load_says_so_and_bad_requests_are_refused() {
    // A build that loads the two Z-Image models below, and not SD 1.5.
    let text_cat = override_json("http://127.0.0.1:9/fake.zip", 1, PLACED).replacen(
        "\"supports\":[",
        "\"supports\":[\"ZIMAGE_Q4\",\"ZIMAGE_Q8\"],\"x\":[",
        1,
    );
    let options = with_catalogue(&text_cat);
    let t = TestServer::start_with_options("post-unsupported", 2, options, |data| {
        place_fake(data);
        place_model(data, "ZIMAGE_Q4");
        place_model(data, "SD15_LIGHT");
    });
    let id = render_final(&t, &example(96, 64, 1));
    let refused = |b: &str| {
        let r = t.api("POST", "/api/ai/post", b.as_bytes());
        (r.status, json::parse(&r.text()).unwrap())
    };
    let (status, v) = refused(&body(
        id,
        &settings(30, 50, 40, 20, 30),
        "SD15_LIGHT",
        "p",
        "",
    ));
    assert_eq!(status, 409, "{}", v.to_json());
    assert_eq!(text(&v, "reason"), "MODEL_UNSUPPORTED");
    // Not downloaded: NO_MODEL.
    let (status, v) = refused(&body(
        id,
        &settings(30, 50, 40, 20, 30),
        "ZIMAGE_Q8",
        "p",
        "",
    ));
    assert_eq!((status, text(&v, "reason")), (409, "NO_MODEL"));
    // A render that is not kept, a bad body, a missing source.
    let (status, v) = refused(&body(
        999,
        &settings(30, 50, 40, 20, 30),
        "ZIMAGE_Q4",
        "p",
        "",
    ));
    assert_eq!((status, text(&v, "error")), (404, "not-kept"));
    let (status, _) = refused("{\"source\":{\"kind\":\"RENDER\",\"renderId\":\"1\"}}");
    assert_eq!(status, 400);
    let (status, _) = refused(&body(
        id,
        &settings(30, 50, 40, 20, 30),
        "ZIMAGE_Q4",
        "p",
        ",\"tolerances\":{\"nope\":1}",
    ));
    assert_eq!(status, 400);
    assert_eq!(t.api("GET", "/api/ai/post/77", b"").status, 404);
    assert_eq!(t.api("PUT", "/api/ai/post/77", b"").status, 405);
    // A final rendered without passes is not kept: there is nothing to post-process.
    let plain = t.api(
        "POST",
        "/api/render?kind=final",
        &example(32, 32, 1).to_rsb(),
    );
    let plain_id = json::parse(&plain.text())
        .unwrap()
        .get("id")
        .unwrap()
        .as_f64()
        .unwrap() as u32;
    let (status, _) = refused(&body(
        plain_id,
        &settings(30, 50, 40, 20, 30),
        "ZIMAGE_Q4",
        "p",
        "",
    ));
    assert_eq!(status, 404);
    cleanup(t);
}

/// An inline body: the JSON, the image and its passes.
fn inline_body(json_text: &str, image: &LinearImage, passes: &Passes) -> Vec<u8> {
    let mut out = INLINE_MAGIC.to_vec();
    out.extend_from_slice(&(json_text.len() as u32).to_le_bytes());
    out.extend_from_slice(json_text.as_bytes());
    out.extend_from_slice(&write_image(image));
    write_passes(0, 1, passes, &mut out).unwrap();
    out
}

#[test]
fn the_preview_goes_inline_and_is_guarded_the_same_way() {
    let (t, _data, rt) = ready("post-inline", &["ZIMAGE_Q4"]);
    write_control(&rt, r#"{"image":"gain"}"#);
    // A preview frame: a lit square (part 1) on a dark background, linear light already on screen.
    let (w, h) = (128u32, 96u32);
    let mut passes = Passes::new(w, h, PASS_EXACT);
    let mut image = LinearImage::new(w, h);
    for y in 0..h {
        for x in 0..w {
            let p = (y * w + x) as usize;
            let inside = (32..96).contains(&x) && (24..72).contains(&y);
            let v = if inside {
                0.2 + 0.4 * x as f32 / w as f32
            } else {
                0.05
            };
            image.rgba[p * 4..p * 4 + 4].copy_from_slice(&[v, v * 0.8, v * 0.6, 1.0]);
            if inside {
                passes.part_id[p] = 1;
                passes.material_id[p] = 1;
                passes.normal[p * 3 + 2] = 1.0;
                passes.depth[p] = 500.0;
            }
        }
    }
    let json_text = "{\"source\":{\"kind\":\"INLINE\"},\"settings\":{\"intervention\":50,\"light\":80,\"bounce\":20,\"wear\":0,\"style\":\"WARM\",\"styleStrength\":60,\"seed\":1},\"prompt\":\"preview\",\"negative\":\"n\",\"modelKey\":\"ZIMAGE_Q4\",\"device\":\"cpu\"}";
    let r = t.raw(
        "POST",
        "/api/ai/post",
        &[
            ("X-Repackshot-Token", common::TOKEN),
            ("Content-Type", "application/octet-stream"),
        ],
        &inline_body(json_text, &image, &passes),
    );
    assert_eq!(r.status, 202, "{}", r.text());
    let v = json::parse(&r.text()).unwrap();
    assert!(v.get("renderId").is_none_or(Value::is_null));
    let end = follow(&t, num(&v, "id") as u32, |_| {});
    assert_eq!(text(&end, "state"), "DONE", "{}", end.to_json());
    assert_eq!(text(end.get("report").unwrap(), "verdict"), "ACCEPTED");
    // The model saw the preview's own bytes (linear curve, 0 EV): the tile's exact size.
    let req = requests(&rt).pop().unwrap();
    assert_eq!((num(&req, "width"), num(&req, "height")), (128.0, 96.0));
    let out = image_of(&t, num(&v, "id") as u32);
    assert_eq!((out.width, out.height), (w, h));
    for p in 0..(w * h) as usize {
        if passes.part_id[p] == 0 {
            assert_eq!(
                out.rgba[p * 4].to_bits(),
                image.rgba[p * 4].to_bits(),
                "background {p}"
            );
        }
    }
    let centre = ((48 * w + 64) * 4) as usize;
    assert!(out.rgba[centre] > image.rgba[centre], "the light went up");
    // Larger than a preview: refused.
    let big = LinearImage::new(520, 8);
    let r = t.raw(
        "POST",
        "/api/ai/post",
        &[
            ("X-Repackshot-Token", common::TOKEN),
            ("Content-Type", "application/octet-stream"),
        ],
        &inline_body(json_text, &big, &Passes::new(520, 8, PASS_EXACT)),
    );
    assert_eq!(r.status, 400, "{}", r.text());
    // An inline source sent as JSON: refused with the reason.
    let r = t.api("POST", "/api/ai/post", json_text.as_bytes());
    assert_eq!(r.status, 400);
    assert!(r.text().contains("RPI1"), "{}", r.text());
    cleanup(t);
}

#[test]
fn the_studio_floor_is_relit_and_colour_checked_never_background() {
    let (t, _data, rt) = ready("post-floor", &["ZIMAGE_Q4"]);
    write_control(&rt, r#"{"image":"gain"}"#);
    // The example with the studio floor as a shadow catcher in place of its floor mesh.
    let mut scene = example(160, 96, 2);
    let meshes: Vec<_> = scene.geometry.meshes().to_vec();
    scene.geometry = Geometry::new(
        meshes,
        vec![
            Instance::new(0, Transform::IDENTITY, 0),
            Instance::new(0, rt_core::example::SMALL_SPHERE, 2),
        ],
    )
    .unwrap();
    scene.floor.mode = FloorMode::ShadowCatcher;
    let id = render_final(&t, &scene);
    let kept = t.server.app.engine.kept(id).unwrap();
    let floor = kept
        .passes
        .part_id
        .iter()
        .filter(|&&p| p == FLOOR_ID)
        .count();
    assert!(floor > 2000, "the floor is in view: {floor}");
    assert!(
        kept.passes
            .part_id
            .iter()
            .zip(&kept.passes.material_id)
            .filter(|(p, _)| **p == FLOOR_ID)
            .all(|(_, m)| *m == FLOOR_ID),
        "the floor is FLOOR_ID in both ids"
    );
    let v = submit(
        &t,
        &body(id, &settings(80, 100, 40, 0, 0), "ZIMAGE_Q4", "floor", ""),
    );
    let end = follow(&t, num(&v, "id") as u32, |_| {});
    assert_eq!(text(&end, "state"), "DONE", "{}", end.to_json());
    let report = end.get("report").unwrap();
    assert_ne!(text(report, "verdict"), "REJECTED", "{}", report.to_json());
    // Its own colour check, named.
    let check = report
        .get("materials")
        .and_then(Value::as_array)
        .unwrap()
        .iter()
        .find(|m| num(m, "materialId") == f64::from(FLOOR_ID))
        .expect("the floor's colour check")
        .clone();
    assert_eq!(text(&check, "name"), "Floor");
    assert_eq!(check.get("ok").unwrap().as_bool(), Some(true));
    // The floor relit, the background as it was.
    let (img, orig) = (image_of(&t, num(&v, "id") as u32), engine_image(&t, id));
    let (mut lit, mut background_changed) = (0, 0);
    for p in 0..(160 * 96) {
        let differs =
            (0..4).any(|c| img.rgba[p * 4 + c].to_bits() != orig.rgba[p * 4 + c].to_bits());
        match kept.passes.part_id[p] {
            0 => background_changed += usize::from(differs),
            FLOOR_ID => lit += usize::from(differs),
            _ => {}
        }
    }
    assert_eq!(background_changed, 0);
    assert!(lit * 2 > floor, "the floor changed: {lit} of {floor}");
    cleanup(t);
}

#[test]
fn a_post_its_page_stopped_asking_about_is_stopped_and_one_followed_is_not() {
    let (t, _data, rt) = ready("post-orphan", &["ZIMAGE_Q4"]);
    write_control(&rt, r#"{"image":"gain","stepMs":300}"#);
    t.server
        .app
        .ai
        .set_post_orphan_after(Duration::from_millis(700));
    let id = render_final(&t, &example(96, 64, 1));
    // Followed (the long poll asks every second at most): it runs to its end, past the limit.
    let v = submit(
        &t,
        &body(id, &settings(100, 50, 40, 20, 30), "ZIMAGE_Q4", "p", ""),
    );
    let end = follow(&t, num(&v, "id") as u32, |_| {});
    assert_eq!(text(&end, "state"), "DONE", "{}", end.to_json());
    assert!(num(&end, "seconds") > 1.0, "{}", end.to_json());
    // Nobody asks: stopped, the model kept loaded.
    let v = submit(
        &t,
        &body(id, &settings(100, 50, 40, 20, 30), "ZIMAGE_Q4", "p", ""),
    );
    let post = t.server.app.ai.post(num(&v, "id") as u32).unwrap();
    let deadline = Instant::now() + Duration::from_secs(60);
    loop {
        let s = json::parse(&post.to_json()).unwrap();
        if text(&s, "state") == "CANCELLED" {
            break;
        }
        assert!(Instant::now() < deadline, "never stopped: {}", s.to_json());
        std::thread::sleep(Duration::from_millis(50));
    }
    assert_eq!(sidecar_state(&t), "ready");
    cleanup(t);
}

/// The whole pipeline with the real runtime and SD 1.5 with its depth ControlNet on the CPU (X3c):
/// `RPX_SDCPP_LINUX_CPU_ZIP` (the pinned Linux CPU archive), `RPX_SD15_WEIGHTS`
/// (`v1-5-pruned-emaonly-fp16.safetensors`) and `RPX_SD15_DEPTH`
/// (`control_v11f1p_sd15_depth_fp16.safetensors`), checked against their pinned SHA-256 by the
/// store's own names (the tile ControlNet, not loaded, has a placeholder). A final render of the
/// example with the studio floor, posted by its id: one tile, the depth image of its exact passes,
/// the guard, the report. `RPX_SD15_OUT` keeps the AI image as a 16-bit-per-channel PPM.
#[test]
#[ignore = "needs the real runtime archive and the SD 1.5 weights (2.9 GB)"]
fn real_post_with_sd15_and_its_depth_controlnet_on_the_cpu() {
    use rt_app::ai::runtimes::Source;
    let (Some(zip_path), Some(weights), Some(depth)) = (
        std::env::var_os("RPX_SDCPP_LINUX_CPU_ZIP"),
        std::env::var_os("RPX_SD15_WEIGHTS"),
        std::env::var_os("RPX_SD15_DEPTH"),
    ) else {
        return;
    };
    let model = rt_app::recommend::catalogue()
        .model("SD15_LIGHT")
        .unwrap()
        .clone();
    let t = TestServer::start_with("ai-post-real-sd15", 2, |data| {
        let blobs = data.join("models").join("blobs");
        std::fs::create_dir_all(&blobs).unwrap();
        for f in &model.files {
            let target = blobs.join(&f.sha256);
            let from = if f.role == "transformer" {
                Some(&weights)
            } else if f.name.contains("depth") {
                Some(&depth)
            } else {
                None
            };
            match from {
                Some(p) => {
                    if std::fs::hard_link(p, &target).is_err() {
                        std::fs::copy(p, &target).unwrap();
                    }
                }
                None => std::fs::write(&target, b"placeholder: the tile ControlNet is not loaded")
                    .unwrap(),
            }
        }
    });
    let ai = &t.server.app.ai;
    ai.runtimes
        .start("SDCPP_LINUX_CPU", Source::File(zip_path.into()))
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
    // The example with the studio floor, 256 × 192, 16 samples.
    let mut scene = example(256, 192, 16);
    let meshes: Vec<_> = scene.geometry.meshes().to_vec();
    scene.geometry = Geometry::new(
        meshes,
        vec![
            Instance::new(0, Transform::IDENTITY, 0),
            Instance::new(0, rt_core::example::SMALL_SPHERE, 2),
        ],
    )
    .unwrap();
    scene.floor.mode = FloorMode::ShadowCatcher;
    let id = render_final(&t, &scene);
    let started = Instant::now();
    let v = submit(
        &t,
        &body(
            id,
            &settings(100, 80, 40, 20, 30),
            "SD15_LIGHT",
            "Professional product photograph of a coral sphere and a small blue sphere on a grey studio floor. Natural light with soft penumbras and gentle highlight roll-off. Same object, same shapes, same framing.",
            ",\"steps\":10",
        ),
    );
    let mut last = String::new();
    let end = follow(&t, num(&v, "id") as u32, |s| {
        let line = format!(
            "{} tile {}/{} attempt {} step {}/{}",
            text(s, "state"),
            num(s, "tile"),
            num(s, "tiles"),
            num(s, "attempt"),
            num(s, "step"),
            num(s, "steps")
        );
        if line != last {
            println!("{:>7.1} s  {line}", started.elapsed().as_secs_f64());
            last = line;
        }
    });
    println!("{}", end.to_json());
    assert_eq!(text(&end, "state"), "DONE", "{}", end.to_json());
    let report = end.get("report").unwrap();
    println!(
        "real post 256×192 SD 1.5 + depth on the CPU: {:.1} s, {}",
        started.elapsed().as_secs_f64(),
        report.to_json()
    );
    let img = image_of(&t, num(&v, "id") as u32);
    assert_eq!((img.width, img.height), (256, 192));
    let req = requests_of_real(&t);
    assert!(req.is_empty(), "the real runtime keeps no request log");
    if let Some(path) = std::env::var_os("RPX_SD15_OUT") {
        // A 16-bit PPM of the display (ACES, 0 EV is the example's look): enough to look at.
        let mut ppm = b"P6 256 192 65535\n".to_vec();
        let display = |v: f32| {
            let v = v.max(0.0);
            let aces = (v * (2.51 * v + 0.03)) / (v * (2.43 * v + 0.59) + 0.14);
            let s = if aces <= 0.003_130_8 {
                aces * 12.92
            } else {
                1.055 * aces.powf(1.0 / 2.4) - 0.055
            };
            ((s.clamp(0.0, 1.0) * 65535.0).round() as u16).to_be_bytes()
        };
        for px in img.rgba.chunks_exact(4) {
            for &c in &px[..3] {
                ppm.extend_from_slice(&display(c));
            }
        }
        std::fs::write(path, ppm).unwrap();
    }
    cleanup(t);
}

/// The real runtime writes no `requests.log` (only the fake does).
fn requests_of_real(t: &TestServer) -> Vec<Value> {
    let dir = t.dir.join("data/ai/runtimes");
    std::fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .flat_map(|e| requests(&e.path()))
        .collect()
}
