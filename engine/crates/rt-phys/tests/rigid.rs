//! The acceptance tests of S2 (ROADMAP): a ball rests at its radius, a stack of three boxes
//! stands, a tilted box falls flat, a cube slides off a ball, a thousand balls settle in time,
//! sleeping stops the simulation, and the pose hash is the same whatever the run and the number of
//! narrow-phase chunks, and the one pinned for the WebAssembly check.

use rt_core::math::Vec3;
use rt_phys::example::{box_mesh, cylinder_mesh, drop_scene, sphere_mesh, DROP_STEPS};
use rt_phys::{BodyParams, Quat, Scene, ShapeKind, ShapeSource, Transform, World};

const STEPS_PER_SECOND: u32 = 240;

fn params(friction: f32, restitution: f32) -> BodyParams {
    BodyParams {
        density: 1000.0,
        friction,
        restitution,
    }
}

fn floor(w: &mut World) {
    w.add_floor(0.0, (0.0, 0.0), 100_000.0, 0.6, 0.0);
}

/// Runs until settled or `seconds`; returns the steps taken.
fn settle(w: &mut World, seconds: u32) -> u32 {
    let mut n = 0;
    while !w.settled() && n < seconds * STEPS_PER_SECOND {
        w.step(1);
        n += 1;
    }
    n
}

/// The world direction of the body-frame axis `axis` given its initial rotation `q0`.
fn axis_now(w: &World, body: u32, q0: Quat, axis: Vec3) -> Vec3 {
    (w.pose(body).unwrap().rotation * q0).rotate(axis)
}

#[test]
fn a_ball_rests_on_the_floor_at_its_radius() {
    let mut w = World::new();
    floor(&mut w);
    let ball = sphere_mesh(25.0, 16, 32);
    let b = w
        .add_dynamic(
            ShapeSource::Points(&ball.positions),
            &Transform::translation(Vec3::new(3.0, -4.0, 200.0)),
            params(0.6, 0.3),
        )
        .unwrap();
    assert_eq!(w.shape_kind(b), Some(ShapeKind::Sphere));
    let steps = settle(&mut w, 10);
    assert!(w.settled(), "still moving after {steps} steps");
    let z = w.pose(b).unwrap().translation.z;
    assert!((z - 25.0).abs() <= 0.1, "rests at z = {z}");
    // Dropped straight down: it does not wander.
    let p = w.pose(b).unwrap().translation;
    assert!((p.x - 3.0).abs() < 0.5 && (p.y + 4.0).abs() < 0.5, "{p:?}");
}

#[test]
fn a_stack_of_three_boxes_stays_stacked_for_five_seconds() {
    let mut w = World::new();
    floor(&mut w);
    let half = Vec3::new(30.0, 30.0, 20.0);
    let mesh = box_mesh(half);
    let mut ids = Vec::new();
    for k in 0..3 {
        // Each box exactly on the one below, the upper ones a little off centre.
        let z = 20.0 + 40.0 * k as f32;
        let x = 4.0 * k as f32;
        ids.push(
            w.add_dynamic(
                ShapeSource::Points(&mesh.positions),
                &Transform::translation(Vec3::new(x, 0.0, z)),
                params(0.6, 0.0),
            )
            .unwrap(),
        );
    }
    for _ in 0..5 * STEPS_PER_SECOND {
        w.step(1);
    }
    for (k, &id) in ids.iter().enumerate() {
        let p = w.pose(id).unwrap();
        let want = Vec3::new(4.0 * k as f32, 0.0, 20.0 + 40.0 * k as f32);
        assert!(
            (p.translation - want).length() < 0.5,
            "box {k}: {:?}",
            p.translation
        );
        // Still upright.
        let up = p.rotation.rotate(Vec3::new(0.0, 0.0, 1.0));
        assert!(up.z > 0.9999, "box {k} tilts: {up:?}");
    }
    assert!(w.settled(), "a stack at rest sleeps");
}

#[test]
fn a_box_tilted_thirty_degrees_falls_flat() {
    let mut w = World::new();
    floor(&mut w);
    let half = Vec3::new(40.0, 25.0, 10.0);
    let mesh = box_mesh(half);
    let tilt = Quat::from_axis_angle(Vec3::new(1.0, 0.0, 0.0), 30f32.to_radians());
    let b = w
        .add_dynamic(
            ShapeSource::Points(&mesh.positions),
            &Transform::from_pose(Vec3::new(0.0, 0.0, 120.0), tilt),
            params(0.6, 0.1),
        )
        .unwrap();
    let steps = settle(&mut w, 10);
    assert!(w.settled(), "still moving after {steps} steps");
    // Its thin axis is vertical again: it lies on a large face, at its half thickness.
    let thin = axis_now(&w, b, tilt, Vec3::new(0.0, 0.0, 1.0));
    assert!(thin.z.abs() > 0.9999, "lies on a side: {thin:?}");
    let z = w.pose(b).unwrap().translation.z;
    assert!((z - 10.0).abs() < 0.1, "rests at z = {z}");
}

#[test]
fn a_cube_on_a_static_ball_slides_off() {
    let mut w = World::new();
    floor(&mut w);
    let ball = sphere_mesh(60.0, 32, 64);
    w.add_static_mesh(
        &ball.positions,
        &ball.indices,
        &Transform::translation(Vec3::new(0.0, 0.0, 60.0)),
        0.2,
        0.0,
    );
    let cube = box_mesh(Vec3::splat(15.0));
    // Just off the ball's crown, where its surface is steeper than the friction angle (11°).
    let b = w
        .add_dynamic(
            ShapeSource::Points(&cube.positions),
            &Transform::translation(Vec3::new(14.0, 4.0, 120.0 + 15.0)),
            params(0.2, 0.0),
        )
        .unwrap();
    let steps = settle(&mut w, 15);
    assert!(w.settled(), "still moving after {steps} steps");
    let p = w.pose(b).unwrap().translation;
    // On the floor, beside the ball.
    assert!(p.z < 16.0, "the cube stayed up: {p:?}");
    assert!((p.x * p.x + p.y * p.y).sqrt() > 30.0, "{p:?}");
}

/// A box on a ramp tilted 15° (tan 15° ≈ 0.27): `friction` for both. Returns how far it moved in
/// three seconds, mm.
fn ramp_slide(friction: f32) -> f32 {
    let mut w = World::new();
    floor(&mut w);
    let tilt = Quat::from_axis_angle(Vec3::new(0.0, 1.0, 0.0), 15f32.to_radians());
    let ramp = box_mesh(Vec3::new(150.0, 60.0, 5.0));
    let centre = Vec3::new(0.0, 0.0, 80.0);
    w.add_static_mesh(
        &ramp.positions,
        &ramp.indices,
        &Transform::from_pose(centre, tilt),
        friction,
        0.0,
    );
    let n = tilt.rotate(Vec3::new(0.0, 0.0, 1.0));
    let cube = box_mesh(Vec3::new(15.0, 15.0, 10.0));
    let start = centre + n * (5.0 + 10.0 + 0.01);
    let b = w
        .add_dynamic(
            ShapeSource::Points(&cube.positions),
            &Transform::from_pose(start, tilt),
            params(friction, 0.0),
        )
        .unwrap();
    w.step(3 * STEPS_PER_SECOND);
    (w.pose(b).unwrap().translation - start).length()
}

#[test]
fn a_box_on_a_ramp_holds_below_its_friction_angle_and_slides_above() {
    let held = ramp_slide(0.6);
    assert!(held < 0.2, "crept {held} mm");
    let slid = ramp_slide(0.1);
    assert!(slid > 100.0, "slid only {slid} mm");
}

#[test]
fn a_thousand_balls_settle_in_time() {
    let mut w = World::new();
    floor(&mut w);
    // A square tray: four static walls.
    let wall = box_mesh(Vec3::new(210.0, 5.0, 100.0));
    for (x, y, turn) in [
        (0.0, 205.0, false),
        (0.0, -205.0, false),
        (205.0, 0.0, true),
        (-205.0, 0.0, true),
    ] {
        let q = if turn {
            Quat::from_axis_angle(Vec3::new(0.0, 0.0, 1.0), std::f32::consts::FRAC_PI_2)
        } else {
            Quat::IDENTITY
        };
        w.add_static_mesh(
            &wall.positions,
            &wall.indices,
            &Transform::from_pose(Vec3::new(x, y, 100.0), q),
            0.5,
            0.0,
        );
    }
    // Ten layers of ten by ten, jittered so they do not land exactly on each other.
    let mut rng = rt_core::rng::Pcg32::seeded(11, 3);
    for k in 0..10 {
        for j in 0..10 {
            for i in 0..10 {
                let jitter = |r: &mut rt_core::rng::Pcg32| (r.next_f32() - 0.5) * 4.0;
                let c = Vec3::new(
                    -135.0 + 30.0 * i as f32 + jitter(&mut rng),
                    -135.0 + 30.0 * j as f32 + jitter(&mut rng),
                    20.0 + 30.0 * k as f32,
                );
                w.add_dynamic(
                    ShapeSource::Sphere(10.0),
                    &Transform::translation(c),
                    params(0.5, 0.1),
                )
                .unwrap();
            }
        }
    }
    assert_eq!(w.body_count(), 1000);
    let start = std::time::Instant::now();
    let steps = settle(&mut w, 30);
    let seconds = start.elapsed().as_secs_f32();
    println!(
        "1000 balls: settled = {} after {:.2} s simulated, {:.2} s of wall time",
        w.settled(),
        steps as f32 / STEPS_PER_SECOND as f32,
        seconds
    );
    assert!(w.settled(), "{} balls still awake", w.awake_count());
    // Nothing went through the floor or the walls.
    for p in w.poses() {
        let t = p.translation;
        assert!(t.z > 9.5 && t.x.abs() < 200.5 && t.y.abs() < 200.5, "{t:?}");
    }
    if !cfg!(debug_assertions) {
        assert!(seconds < 20.0, "took {seconds} s");
    }
}

#[test]
fn sleeping_stops_the_simulation() {
    let mut w = World::new();
    floor(&mut w);
    let mesh = box_mesh(Vec3::new(20.0, 20.0, 20.0));
    w.add_dynamic(
        ShapeSource::Points(&mesh.positions),
        &Transform::translation(Vec3::new(0.0, 0.0, 60.0)),
        params(0.6, 0.0),
    )
    .unwrap();
    assert_eq!(w.awake_count(), 1);
    let steps = settle(&mut w, 10);
    assert!(w.settled() && w.awake_count() == 0);
    // Asleep for exactly the sleep time: no longer than about a second after landing.
    assert!(steps < 2 * STEPS_PER_SECOND, "{steps}");
    let before = w.hash();
    w.step(240);
    assert_eq!(w.hash(), before, "a settled world does not move");
    // A push wakes it.
    w.set_velocity(0, Vec3::new(200.0, 0.0, 0.0), Vec3::ZERO);
    assert_eq!(w.awake_count(), 1);
    w.step(10);
    assert_ne!(w.hash(), before);
}

/// Twenty balls and six boxes dropped in a heap.
fn pile_world() -> World {
    let mut w = World::new();
    floor(&mut w);
    let cube = box_mesh(Vec3::new(12.0, 8.0, 6.0));
    let mut rng = rt_core::rng::Pcg32::seeded(5, 9);
    for k in 0..26 {
        let c = Vec3::new(
            (rng.next_f32() - 0.5) * 40.0,
            (rng.next_f32() - 0.5) * 40.0,
            15.0 + 22.0 * k as f32,
        );
        if k % 4 == 3 {
            let q =
                Quat::from_axis_angle(Vec3::new(rng.next_f32(), 1.0, 0.5), rng.next_f32() * 3.0);
            w.add_dynamic(
                ShapeSource::Points(&cube.positions),
                &Transform::from_pose(c, q),
                params(0.5, 0.2),
            )
            .unwrap();
        } else {
            w.add_dynamic(
                ShapeSource::Sphere(8.0),
                &Transform::translation(c),
                params(0.5, 0.2),
            )
            .unwrap();
        }
    }
    w
}

fn drop_world(workers: usize) -> World {
    let (mut w, ids) = drop_scene().build();
    assert!(ids.iter().all(|i| i.is_some()));
    w.set_workers(workers);
    w
}

/// The pose hash of the drop scene after these steps. The WebAssembly check
/// (`tests/physics-engine.test.ts`, with the scene and these numbers in
/// `tests/fixtures/phys-drop.json`) and the rt-phys tests run as WebAssembly must get the same.
pub const PINNED_DROP: [(u32, u32); 4] = [
    (60, 0x2744_893b),
    (90, 0x46f7_bc67),
    (120, 0x2e80_f36c),
    (DROP_STEPS, 0x2a66_6e14),
];

fn drop_hashes() -> Vec<(u32, u32)> {
    let mut w = drop_world(1);
    let mut out = Vec::new();
    let mut at = 0;
    for (steps, _) in PINNED_DROP {
        w.step(steps - at);
        at = steps;
        out.push((steps, w.hash()));
    }
    out
}

#[test]
fn the_drop_scene_hashes_are_the_pinned_ones() {
    let got = drop_hashes();
    let pinned: Vec<(u32, u32)> = PINNED_DROP.to_vec();
    assert_eq!(got, pinned, "{got:#010x?}");
}

/// The standard base64 alphabet, with padding.
fn base64(bytes: &[u8]) -> String {
    const A: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::new();
    for c in bytes.chunks(3) {
        let n = (c[0] as u32) << 16
            | (*c.get(1).unwrap_or(&0) as u32) << 8
            | *c.get(2).unwrap_or(&0) as u32;
        for k in 0..4 {
            if k <= c.len() {
                out.push(A[(n >> (18 - 6 * k) & 63) as usize] as char);
            } else {
                out.push('=');
            }
        }
    }
    out
}

/// The fixture the interface's WebAssembly check reads: the scene's bytes and the pinned hashes.
#[cfg(not(target_family = "wasm"))]
#[test]
fn the_fixture_is_the_checked_in_one() {
    let mut json = String::from("{\n \"steps\": [");
    json.push_str(
        &PINNED_DROP
            .iter()
            .map(|p| p.0.to_string())
            .collect::<Vec<_>>()
            .join(", "),
    );
    json.push_str("],\n \"hashes\": [");
    json.push_str(
        &PINNED_DROP
            .iter()
            .map(|p| format!("\"0x{:08x}\"", p.1))
            .collect::<Vec<_>>()
            .join(", "),
    );
    json.push_str("],\n \"bodies\": 3,\n \"scene\": \"");
    json.push_str(&base64(&drop_scene().to_bytes()));
    json.push_str("\"\n}\n");
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../tests/fixtures/phys-drop.json"
    );
    if std::env::var_os("REPACK_WRITE_FIXTURES").is_some() {
        std::fs::write(path, &json).expect("write the fixture");
    }
    let pinned = std::fs::read_to_string(path).unwrap_or_default();
    assert_eq!(
        json, pinned,
        "tests/fixtures/phys-drop.json is stale: REPACK_WRITE_FIXTURES=1 cargo test -p rt-phys"
    );
}

#[test]
fn the_pose_hash_does_not_depend_on_the_run_or_the_chunks() {
    let mut runs = Vec::new();
    for workers in [1, 1, 3, 8] {
        let mut w = drop_world(workers);
        w.step(DROP_STEPS);
        runs.push(w.hash());
    }
    assert!(runs.iter().all(|&h| h == runs[0]), "{runs:x?}");
    // A pile, where bodies touch bodies: the narrow phase split any way gives the same contacts in
    // the same order.
    let pile: Vec<u32> = [1, 2, 5, 13]
        .into_iter()
        .map(|workers| {
            let mut w = pile_world();
            w.set_workers(workers);
            w.step(STEPS_PER_SECOND);
            w.hash()
        })
        .collect();
    assert!(pile.iter().all(|&h| h == pile[0]), "{pile:x?}");
    // And in parallel threads, each its own world (WebAssembly test binaries have no threads).
    #[cfg(not(target_family = "wasm"))]
    {
        let handles: Vec<_> = (0..3)
            .map(|_| {
                std::thread::spawn(|| {
                    let mut w = drop_world(4);
                    w.step(DROP_STEPS);
                    w.hash()
                })
            })
            .collect();
        for h in handles {
            assert_eq!(h.join().unwrap(), runs[0]);
        }
    }
    println!(
        "drop scene hash after {DROP_STEPS} steps: {:#010x}",
        runs[0]
    );
}

#[test]
fn the_drop_scene_shapes() {
    let (w, _) = drop_scene().build();
    assert_eq!(w.body_count(), 3);
    assert_eq!(w.shape_kind(0), Some(ShapeKind::Hull));
    assert_eq!(w.shape_kind(1), Some(ShapeKind::Sphere));
    assert_eq!(w.shape_kind(2), Some(ShapeKind::Hull));
    // The scene survives its own format.
    let bytes = drop_scene().to_bytes();
    assert_eq!(Scene::parse(&bytes).unwrap(), drop_scene());
    let _ = cylinder_mesh;
}
