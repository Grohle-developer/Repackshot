//! Parity: the same RSB rendered through `/api/render` gives the same film, bit for bit, as
//! `rt` natively (`rt_cli::render`) and as the pinned hash of rt-core, which the WebAssembly
//! pool reproduces in the browser (phase E4). So the page cannot tell the native engine from the
//! wasm one except by its speed.

mod common;

use common::{fnv1a, TestServer};
use rt_app::render::{FLAG_DATA, FLAG_DONE, FRAME_HEADER};
use std::time::{Duration, Instant};

struct Frame {
    pass: u32,
    samples: u32,
    width: u32,
    height: u32,
    flags: u32,
    sums: Vec<f32>,
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
    }
}

/// Posts a job and long-polls it to the end, as the page does.
fn render(t: &TestServer, kind: &str, rsb: &[u8], extra: &str) -> Frame {
    let r = t.api("POST", &format!("/api/render?kind={kind}{extra}"), rsb);
    assert_eq!(r.status, 200, "{}", r.text());
    let job = rt_app::json::parse(&r.text()).unwrap();
    let id = job.get("id").unwrap().as_f64().unwrap() as u32;
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

fn pinned_example_hash() -> u32 {
    let src = include_str!("../../rt-core/src/render.rs");
    let line = src
        .lines()
        .find(|l| l.contains("PINNED_EXAMPLE_4SPP: u32 = 0x"))
        .expect("the pinned hash in rt-core");
    let hex: String = line
        .split("0x")
        .nth(1)
        .unwrap()
        .chars()
        .filter(|c| c.is_ascii_hexdigit())
        .collect();
    u32::from_str_radix(&hex, 16).unwrap()
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
