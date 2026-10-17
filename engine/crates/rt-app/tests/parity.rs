//! Parity: the same RSB rendered through `/api/render` gives the same film, bit for bit, as
//! `rt` natively (`rt_cli::render`) and as the pinned hash of rt-core, which the WebAssembly
//! pool reproduces in the browser (phase E4). So the page cannot tell the native engine from the
//! wasm one except by its speed.

mod common;

use common::{fnv1a, TestServer};
use rt_app::render::{FLAG_DATA, FLAG_DENOISED, FLAG_DONE, FRAME_HEADER};
use std::time::{Duration, Instant};

struct Frame {
    pass: u32,
    samples: u32,
    width: u32,
    height: u32,
    flags: u32,
    sums: Vec<f32>,
    /// U11: the number of the image.
    version: u32,
}

fn u32_at(b: &[u8], i: usize) -> u32 {
    u32::from_le_bytes([b[i], b[i + 1], b[i + 2], b[i + 3]])
}

fn parse(body: &[u8]) -> Frame {
    assert!(body.len() >= FRAME_HEADER);
    assert_eq!(&body[..4], b"RPX1");
    assert_eq!(u32_at(body, 4) as usize, FRAME_HEADER);
    let flags = u32_at(body, 28);
    let sums = if flags & FLAG_DATA != 0 {
        body[FRAME_HEADER..]
            .chunks_exact(4)
            .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
            .collect()
    } else {
        Vec::new()
    };
    Frame {
        pass: u32_at(body, 8),
        samples: u32_at(body, 12),
        width: u32_at(body, 16),
        height: u32_at(body, 20),
        flags,
        sums,
        version: u32_at(body, 48),
    }
}

/// Posts a job and long-polls it to the end, as the page does.
fn render(t: &TestServer, kind: &str, rsb: &[u8], extra: &str) -> Frame {
    let r = t.api("POST", &format!("/api/render?kind={kind}{extra}"), rsb);
    assert_eq!(r.status, 200, "{}", r.text());
    let job = rt_app::json::parse(&r.text()).unwrap();
    poll(t, job.get("id").unwrap().as_f64().unwrap() as u32)
}

/// Long-polls job `id` to the end and returns its last frame with data.
fn poll(t: &TestServer, id: u32) -> Frame {
    let mut last = 0u32;
    let mut frame = None;
    let deadline = Instant::now() + Duration::from_secs(600);
    loop {
        let reply = t.api("GET", &format!("/api/render/{id}?after={last}"), b"");
        assert_eq!(reply.status, 200);
        let f = parse(&reply.body);
        if f.flags & FLAG_DATA != 0 {
            assert!(f.pass > last, "data only with a newer pass");
            last = f.pass;
            frame = Some(f);
        } else if f.flags & FLAG_DONE != 0 {
            // Done with no newer pass: the last data frame was the final one (the end can land between two
            // polls, so the reply that says so carries no data).
            if let Some(last) = frame.as_mut() {
                last.flags |= FLAG_DONE;
            }
            break;
        }
        if frame.as_ref().is_some_and(|f| f.flags & FLAG_DONE != 0) {
            break;
        }
        assert!(Instant::now() < deadline);
    }
    frame.expect("at least one pass")
}

/// The film's mean per pixel as `Film::resolve` computes it, from the RGBA sums.
fn resolve(f: &Frame) -> Vec<f32> {
    let inv = 1.0 / f.samples as f32;
    f.sums
        .chunks_exact(4)
        .flat_map(|px| [px[0] * inv, px[1] * inv, px[2] * inv])
        .collect()
}

/// The value of `const <name>: u32 = 0x...;` in `src`.
fn pinned(src: &str, name: &str) -> u32 {
    let line = src
        .lines()
        .find(|l| l.contains(&format!("{name}: u32 = 0x")))
        .unwrap_or_else(|| panic!("the pinned {name} in rt-core"));
    let hex: String = line
        .split("0x")
        .nth(1)
        .unwrap()
        .chars()
        .filter(|c| c.is_ascii_hexdigit())
        .collect();
    u32::from_str_radix(&hex, 16).unwrap()
}

fn pinned_example_hash() -> u32 {
    pinned(
        include_str!("../../rt-core/src/render.rs"),
        "PINNED_EXAMPLE_4SPP",
    )
}

/// The pinned hashes of the example's passes, in the order of `PASS_KEYS`: the six of X2, then the
/// alpha of N2.
fn pinned_pass_hashes() -> Vec<u32> {
    let src = include_str!("../../rt-core/src/render/passes_tests.rs");
    [
        "ALBEDO",
        "NORMAL",
        "DEPTH",
        "PART_ID",
        "MATERIAL_ID",
        "COC",
        "ALPHA",
    ]
    .iter()
    .map(|k| pinned(src, &format!("PINNED_PASS_{k}")))
    .collect()
}

fn job_id(reply: &rt_app::client::Reply) -> u32 {
    rt_app::json::parse(&reply.text())
        .unwrap()
        .get("id")
        .unwrap()
        .as_f64()
        .unwrap() as u32
}

#[test]
fn passes_through_the_api_are_the_pinned_ones_and_leave_the_image_alone() {
    // The example at 4 samples with every pass (X2, and the alpha of N2): the image is still the
    // pinned film, the passes the launcher keeps are rt-core's pinned planes, with 1 and 4 threads.
    let mut scene = rt_core::example::scene();
    scene.render.max_samples = 4;
    let rsb = scene.to_rsb();
    let keys = rt_core::passes::PASS_KEYS.join(",");
    for threads in [1usize, 4] {
        let t = TestServer::start("parity-passes", threads);
        let reply = t.api(
            "POST",
            &format!("/api/render?kind=final&passes={keys}"),
            &rsb,
        );
        assert_eq!(reply.status, 200, "{}", reply.text());
        assert!(
            reply.text().contains(
                r#""passes":["albedo","normal","depth","partId","materialId","coc","alpha"]"#
            ),
            "{}",
            reply.text()
        );
        let id = job_id(&reply);
        let f = poll(&t, id);
        assert_eq!(
            fnv1a(&resolve(&f)),
            pinned_example_hash(),
            "{threads} threads: the image"
        );
        let body = t.api("GET", &format!("/api/render/{id}/passes"), b"");
        assert_eq!(body.status, 200, "{}", body.text());
        let (kept_id, samples, passes) =
            rt_app::kept::read_passes(&body.body).expect("an RPP1 file");
        assert_eq!(
            (kept_id, samples, passes.width, passes.height),
            (id, 4, 512, 384)
        );
        let hashes: Vec<u32> = passes.planes().iter().map(|p| p.fnv1a()).collect();
        assert_eq!(
            hashes,
            pinned_pass_hashes(),
            "{threads} threads: the passes"
        );
        // The page forgets the job once it has the image: the passes stay for the AI.
        assert_eq!(
            t.api("DELETE", &format!("/api/render/{id}"), b"").status,
            204
        );
        assert_eq!(t.api("GET", &format!("/api/render/{id}"), b"").status, 404);
        let again = t.api("GET", &format!("/api/render/{id}/passes"), b"");
        assert_eq!((again.status, again.body.len()), (200, body.body.len()));
        let kept = t.server.app.engine.kept(id).expect("kept for X3c");
        assert_eq!(*kept.image.sums, f.sums);
    }
}

#[test]
fn the_launcher_keeps_a_few_renders_refuses_unknown_ones_and_bad_requests() {
    // A store of two renders, every one on the disk.
    let options = rt_app::server::Options {
        keep: Some(rt_app::kept::KeepLimits {
            renders: 2,
            in_memory: 0,
        }),
        ..rt_app::server::Options::default()
    };
    let t = TestServer::start_with_options("keep-passes", 2, options, |data| {
        // A previous launch's leftovers in the cache.
        std::fs::create_dir_all(data.join("cache/ai")).unwrap();
        std::fs::write(data.join("cache/ai/1.rpp"), b"stale").unwrap();
    });
    let cache = t.dir.join("data/cache/ai");
    assert!(
        !cache.join("1.rpp").exists(),
        "removed at start: ids start again"
    );
    let mut scene = rt_core::example::scene();
    scene.render.width = 48;
    scene.render.height = 32;
    scene.render.max_samples = 2;
    let rsb = scene.to_rsb();
    let mut ids = Vec::new();
    for _ in 0..3 {
        let reply = t.api("POST", "/api/render?kind=final&passes=depth,partId", &rsb);
        assert_eq!(reply.status, 200, "{}", reply.text());
        let id = job_id(&reply);
        poll(&t, id);
        ids.push(id);
    }
    // The oldest was evicted, with its files; the others are on the disk and served from it.
    let status = |id: u32| {
        t.api("GET", &format!("/api/render/{id}/passes"), b"")
            .status
    };
    assert_eq!(status(ids[0]), 404);
    assert!(!cache.join(format!("{}.rpp", ids[0])).exists());
    for &id in &ids[1..] {
        assert_eq!(status(id), 200);
        assert!(
            cache.join(format!("{id}.rpp")).exists() && cache.join(format!("{id}.rpx")).exists()
        );
        let body = t.api("GET", &format!("/api/render/{id}/passes"), b"").body;
        let (_, _, p) = rt_app::kept::read_passes(&body).unwrap();
        assert_eq!(
            p.mask,
            rt_core::passes::PASS_DEPTH | rt_core::passes::PASS_PART_ID
        );
        assert!(p.albedo.is_empty() && p.depth.len() == 48 * 32);
    }
    assert_eq!(t.server.app.engine.kept_ids(), ids[1..]);
    // Unknown ids, ids that are not numbers, a render that asked for nothing.
    assert_eq!(status(9999), 404);
    assert_eq!(t.api("GET", "/api/render/abc/passes", b"").status, 404);
    let plain = t.api("POST", "/api/render?kind=final", &rsb);
    let plain = job_id(&plain);
    poll(&t, plain);
    assert_eq!(status(plain), 404);
    // Still rendering: not yet.
    scene.render.max_samples = 100_000;
    let long = t.api(
        "POST",
        "/api/render?kind=final&passes=normal",
        &scene.to_rsb(),
    );
    let long = job_id(&long);
    let r = t.api("GET", &format!("/api/render/{long}/passes"), b"");
    assert_eq!(r.status, 409, "{}", r.text());
    assert!(r.text().contains("not-ready"));
    assert_eq!(
        t.api("DELETE", &format!("/api/render/{long}"), b"").status,
        204
    );
    // A pass nobody knows, or passes for the viewport: refused.
    let r = t.api("POST", "/api/render?kind=final&passes=depth,shadow", &rsb);
    assert_eq!(r.status, 400);
    assert!(r.text().contains("shadow"), "{}", r.text());
    let r = t.api(
        "POST",
        "/api/render?kind=viewport&passes=depth&mesh=m&client=w",
        &rsb,
    );
    assert_eq!(r.status, 400, "{}", r.text());
    assert_eq!(t.api("POST", "/api/render/1/passes", b"").status, 405);
}

#[test]
fn the_example_through_the_api_equals_rt_bit_for_bit() {
    let mut scene = rt_core::example::scene();
    scene.render.max_samples = 4;
    let rsb = scene.to_rsb();
    let reference = rt_cli::render(&scene, 4, 3);
    let reference_hash = fnv1a(&reference.film.resolve());
    assert_eq!(
        reference_hash,
        pinned_example_hash(),
        "rt itself matches the pinned hash"
    );
    for threads in [1usize, 4] {
        let t = TestServer::start("parity", threads);
        let f = render(&t, "final", &rsb, "");
        assert_eq!(
            (f.width, f.height),
            (scene.render.width, scene.render.height)
        );
        assert_eq!((f.samples, f.pass), (4, 3), "passes of 1, 2 and 1 samples");
        assert_eq!(fnv1a(&resolve(&f)), reference_hash, "{threads} threads");
        // The coverage sums are the sample counts (an opaque scene).
        assert!(f.sums.chunks_exact(4).all(|px| px[3] == 4.0));
        // The sums themselves are rt's film, unchanged.
        let rgb: Vec<f32> = f
            .sums
            .chunks_exact(4)
            .flat_map(|px| [px[0], px[1], px[2]])
            .collect();
        assert_eq!(rgb, reference.film.rgb);
        // And the 8-bit image too.
        let mut film = rt_core::image::Film::new(f.width, f.height);
        film.rgb = rgb;
        film.weight = vec![4.0; (f.width * f.height) as usize];
        assert_eq!(
            film.to_srgb8_tonemapped(
                scene.render.exposure_ev,
                rt_core::color::Tonemap::from_u32(scene.render.tonemap)
            ),
            reference.to_rgb8(&scene)
        );
    }
}

#[test]
fn ies_lights_through_the_api_are_the_pinned_image_with_one_and_four_threads() {
    // L5: the scene file carries the profiles as text (`IESP`) and the launcher reads them; its film is
    // `rt`'s and the pinned one, with any number of threads.
    let mut scene = rt_core::example::l5_scene();
    scene.render.max_samples = 4;
    let rsb = scene.to_rsb();
    let want = pinned(
        include_str!("../../rt-core/src/render.rs"),
        "PINNED_L5_IES_4SPP",
    );
    let reference = rt_cli::render(&scene, 4, 3);
    assert_eq!(fnv1a(&reference.film.resolve()), want, "rt itself");
    for threads in [1usize, 4] {
        let t = TestServer::start("parity-ies", threads);
        let f = render(&t, "final", &rsb, "");
        assert_eq!(f.samples, 4);
        assert_eq!(fnv1a(&resolve(&f)), want, "{threads} threads");
    }
}

#[test]
fn the_k3_panorama_through_the_api_is_the_pinned_image_with_one_and_four_threads() {
    // K3: the scene file carries the projection and the exterior factor at the end of CAMR; the
    // launcher reads them, and its film is `rt`'s and the pinned one with any number of threads.
    let mut scene = rt_core::example::k3_panorama_scene();
    scene.render.max_samples = 4;
    let rsb = scene.to_rsb();
    let want = pinned(
        include_str!("../../rt-core/src/render/k3_tests.rs"),
        "PINNED_K3_PANORAMA_4SPP",
    );
    let reference = rt_cli::render(&scene, 4, 3);
    assert_eq!(fnv1a(&reference.film.resolve()), want, "rt itself");
    for threads in [1usize, 4] {
        let t = TestServer::start("parity-k3", threads);
        let f = render(&t, "final", &rsb, "");
        assert_eq!(f.samples, 4);
        assert_eq!(fnv1a(&resolve(&f)), want, "{threads} threads");
    }
}

#[test]
fn a_viewport_update_without_meshes_renders_the_same_film() {
    let t = TestServer::start("parity-viewport", 2);
    let mut scene = rt_core::example::scene();
    scene.render.width = 160;
    scene.render.height = 120;
    scene.render.max_samples = 3;
    let first = render(&t, "viewport", &scene.to_rsb(), "&mesh=example&client=w1");
    assert_eq!(first.samples, 3);
    // The camera moves: the update carries no MESH section.
    scene.camera.position.x += 25.0;
    let full = scene.to_rsb();
    let update = strip_meshes(&full);
    let moved = render(&t, "viewport", &update, "&mesh=example&client=w1");
    let reference = rt_cli::render(&scene, 3, 2);
    assert_eq!(fnv1a(&resolve(&moved)), fnv1a(&reference.film.resolve()));
    // Another window has no meshes loaded: 409, and the page sends everything.
    let r = t.api(
        "POST",
        "/api/render?kind=viewport&mesh=example&client=w2",
        &update,
    );
    assert_eq!(r.status, 409);
    assert!(r.text().contains("need-meshes"));
    let again = render(&t, "viewport", &full, "&mesh=example&client=w2");
    assert_eq!(again.sums, moved.sums);
    // A final job never takes an update.
    assert_eq!(t.api("POST", "/api/render?kind=final", &update).status, 409);
    assert_eq!(
        t.api("POST", "/api/render?kind=sideways", &full).status,
        400
    );
    assert_eq!(
        t.api(
            "POST",
            "/api/render?kind=final",
            b"RSB1\0\0\0\0MESH\x01\0\0\0x"
        )
        .status,
        400
    );
}

/// The scene of an empty project (no model): the studio's lights and dome, no `MESH`, no `INST`.
fn empty_studio() -> rt_core::scene::Scene {
    let mut scene = rt_core::example::scene();
    scene.geometry = rt_core::scene::Geometry::default();
    scene.render.width = 96;
    scene.render.height = 64;
    scene.render.max_samples = 3;
    scene
}

#[test]
fn an_empty_scene_renders_through_the_api_and_equals_rt_bit_for_bit() {
    let scene = empty_studio();
    let rsb = scene.to_rsb();
    assert!(
        !rt_app::render::has_meshes(&rsb),
        "the page writes no MESH for an empty project"
    );
    let reference = fnv1a(&rt_cli::render(&scene, 3, 2).film.resolve());
    let t = TestServer::start("parity-empty", 2);
    // Without the flag it is an update of a scene nobody loaded: refused, as before.
    for kind in ["viewport", "final"] {
        let r = t.api(
            "POST",
            &format!("/api/render?kind={kind}&mesh=e&client=w"),
            &rsb,
        );
        assert_eq!((r.status, kind), (409, kind));
        assert!(r.text().contains("need-meshes"));
    }
    // Marked as the whole scene, both kinds render it, to the same film as `rt`.
    for kind in ["viewport", "final"] {
        let f = render(&t, kind, &rsb, "&full=1&mesh=e&client=w");
        assert_eq!((f.width, f.height, f.samples), (96, 64, 3), "{kind}");
        assert_ne!(f.flags & FLAG_DONE, 0, "{kind} finished");
        assert_eq!(fnv1a(&resolve(&f)), reference, "{kind}");
        assert!(
            resolve(&f).iter().any(|v| *v > 0.0),
            "{kind}: the dome is lit"
        );
    }
    // The camera moves in the empty project: an update without the flag, same key, is applied.
    let mut moved = scene.clone();
    moved.camera.position.x += 25.0;
    let update = moved.to_rsb();
    let f = render(&t, "viewport", &update, "&mesh=e&client=w");
    assert_eq!(
        fnv1a(&resolve(&f)),
        fnv1a(&rt_cli::render(&moved, 3, 2).film.resolve())
    );
}

#[test]
fn cancel_and_progress_without_data() {
    let t = TestServer::start("cancel", 2);
    let mut scene = rt_core::example::scene();
    scene.render.max_samples = 100_000;
    let r = t.api("POST", "/api/render?kind=final", &scene.to_rsb());
    let id = rt_app::json::parse(&r.text())
        .unwrap()
        .get("id")
        .unwrap()
        .as_f64()
        .unwrap() as u32;
    let progress = t.api("GET", &format!("/api/render/{id}?after=0&data=0"), b"");
    let f = parse(&progress.body);
    assert_eq!(progress.body.len(), FRAME_HEADER, "data=0: the header only");
    assert_eq!(f.flags & FLAG_DATA, 0);
    assert_eq!(
        t.api("DELETE", &format!("/api/render/{id}"), b"").status,
        204
    );
    assert_eq!(t.api("GET", &format!("/api/render/{id}"), b"").status, 404);
    assert_eq!(
        t.api("DELETE", &format!("/api/render/{id}"), b"").status,
        404
    );
}

fn strip_meshes(rsb: &[u8]) -> Vec<u8> {
    let mut out = rsb[..8].to_vec();
    let mut pos = 8;
    while pos + 8 <= rsb.len() {
        let len = u32_at(rsb, pos + 4) as usize;
        if &rsb[pos..pos + 4] != b"MESH" {
            out.extend_from_slice(&rsb[pos..pos + 8 + len]);
        }
        pos += 8 + len;
    }
    out
}

#[test]
fn a_live_viewport_does_not_change_a_bit_of_the_render() {
    // The user's 16 threads: the viewport keeps a quarter while the final renders.
    let mut scene = rt_core::example::scene();
    scene.render.max_samples = 4;
    let rsb = scene.to_rsb();
    let t = TestServer::start("parity-live", 16);
    let mut view = rt_core::example::scene();
    view.camera.position.x += 3.0;
    view.render.width = 160;
    view.render.height = 120;
    view.render.max_samples = 100_000;
    let r = t.api(
        "POST",
        &format!(
            "/api/render?kind=viewport&mesh=v&client=w&seq=1&share={}",
            rt_app::render::viewport_share(16)
        ),
        &view.to_rsb(),
    );
    assert_eq!(r.status, 200, "{}", r.text());
    let f = render(&t, "final", &rsb, "");
    assert_eq!(f.samples, 4);
    assert_eq!(
        fnv1a(&resolve(&f)),
        pinned_example_hash(),
        "with a live viewport"
    );
}

#[test]
fn a_live_viewport_is_switched_through_the_api() {
    // U11: `denoise=0` posts a view with its live denoise off; `POST /api/render/<id>/denoise`
    // turns it; a follower that asks with `version` gets the sums only for a newer image, and
    // waits for the one the switch asked for even once the job is over.
    let t = TestServer::start("live-denoise", 2);
    let mut scene = rt_core::example::scene();
    scene.render.width = 64;
    scene.render.height = 48;
    scene.render.max_samples = 6;
    scene.render.denoise = rt_core::scene::DENOISE_IMAGE;
    let rsb = scene.to_rsb();
    let r = t.api(
        "POST",
        "/api/render?kind=viewport&full=1&mesh=e&client=w&denoise=0",
        &rsb,
    );
    assert_eq!(r.status, 200, "{}", r.text());
    let id = job_id(&r);
    let noisy = poll(&t, id);
    assert_eq!((noisy.samples, noisy.flags & FLAG_DENOISED), (6, 0));
    assert_eq!(
        fnv1a(&resolve(&noisy)),
        fnv1a(&rt_cli::render(&scene, 6, 2).film.resolve())
    );
    // Its image now: the header only for the same image.
    let same = t.api(
        "GET",
        &format!(
            "/api/render/{id}?after={}&version={}",
            noisy.pass, noisy.version
        ),
        b"",
    );
    let f = parse(&same.body);
    assert_eq!((f.version, f.flags & FLAG_DATA), (noisy.version, 0));
    // On: the follower waits for the denoised image of the accumulation, which comes with data.
    let on = t.api("POST", &format!("/api/render/{id}/denoise?on=1"), b"");
    assert_eq!(on.status, 200, "{}", on.text());
    assert_eq!(
        rt_app::json::parse(&on.text())
            .unwrap()
            .get("on")
            .and_then(|v| v.as_bool()),
        Some(true)
    );
    let reply = t.api(
        "GET",
        &format!(
            "/api/render/{id}?after={}&version={}",
            noisy.pass, noisy.version
        ),
        b"",
    );
    let clean = parse(&reply.body);
    assert_eq!(
        clean.flags & (FLAG_DATA | FLAG_DENOISED | FLAG_DONE),
        FLAG_DATA | FLAG_DENOISED | FLAG_DONE
    );
    assert_eq!((clean.samples, clean.version), (6, noisy.version + 1));
    assert_ne!(clean.sums, noisy.sums);
    // Off: the noisy accumulation again, at once.
    let off = t.api("POST", &format!("/api/render/{id}/denoise?on=0"), b"");
    assert_eq!(off.status, 200);
    let reply = t.api(
        "GET",
        &format!(
            "/api/render/{id}?after={}&version={}",
            clean.pass, clean.version
        ),
        b"",
    );
    let back = parse(&reply.body);
    assert_eq!(
        (back.flags & (FLAG_DATA | FLAG_DENOISED), back.version),
        (FLAG_DATA, clean.version + 1)
    );
    assert_eq!(back.sums, noisy.sums);
    // Bad requests: the query, a final (no switch), no such job, a final posted with the switch.
    assert_eq!(
        t.api("POST", &format!("/api/render/{id}/denoise?on=yes"), b"")
            .status,
        400
    );
    let fin = t.api("POST", "/api/render?kind=final", &rsb);
    let fin = job_id(&fin);
    assert_eq!(
        t.api("POST", &format!("/api/render/{fin}/denoise?on=1"), b"")
            .status,
        409
    );
    assert_eq!(
        t.api("POST", "/api/render/999999/denoise?on=1", b"").status,
        404
    );
    assert_eq!(
        t.api("POST", "/api/render?kind=final&denoise=1", &rsb)
            .status,
        400
    );
    assert_eq!(
        t.api(
            "POST",
            "/api/render?kind=viewport&full=1&mesh=e&client=x&denoise=maybe",
            &rsb
        )
        .status,
        400
    );
}

#[test]
fn the_lens_information_through_the_api_is_the_engines() {
    // O2: the launcher answers `POST /api/lens/info` with the engine's numbers of the traced lens
    // of the scene in the body, the very JSON `rt_wasm` gives the page; the thin lens says so.
    let t = TestServer::start("lens-info", 1);
    let scene = rt_core::example::o2_scene();
    let r = t.api("POST", "/api/lens/info", &scene.to_rsb());
    assert_eq!(r.status, 200, "{}", r.text());
    assert_eq!(r.text(), scene.camera.lens_info_json());
    let info = rt_app::json::parse(&r.text()).unwrap();
    let efl = info.get("eflMm").and_then(|v| v.as_f64()).unwrap();
    assert!(
        (efl - f64::from(scene.camera.focal_mm)).abs() < 1.0e-2,
        "{efl}"
    );
    let thin = t.api(
        "POST",
        "/api/lens/info",
        &rt_core::example::scene().to_rsb(),
    );
    assert_eq!(thin.status, 200);
    assert_eq!(thin.text(), "{\"traced\":false}");
    assert_eq!(t.api("POST", "/api/lens/info", b"not an rsb").status, 400);
    // O4: a tilted lens says the angle it takes.
    let tilted = rt_core::example::o4_scene();
    let r = t.api("POST", "/api/lens/info", &tilted.to_rsb());
    assert_eq!(r.status, 200, "{}", r.text());
    assert_eq!(r.text(), tilted.camera.lens_info_json());
    assert!(r.text().contains("\"tiltDeg\":"), "{}", r.text());
}
