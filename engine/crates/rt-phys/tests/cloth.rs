//! The acceptance tests of S9 (ROADMAP): a 1 m cloth hanging from two corners sags as the analytic
//! catenary; silk over a sphere wrinkles at least three times more (mean curvature) than thick
//! leather; nothing goes through the sphere; and the same scene gives the same bits whatever the
//! run and the number of narrow-phase chunks of the rigid world it runs with, pinned for the
//! WebAssembly check. With them: anchors, wind, pressure, self-collision and the rigid bodies.

use rt_core::math::Vec3;
use rt_phys::cloth::{
    mean_curvature, Cloth, ClothParams, ClothPiece, ClothSpec, ClothWind, FLAG_SELF_COLLISION,
};
use rt_phys::collide::closest_on_triangle;
use rt_phys::example::{
    box_mesh, cloth_parity_spec, cloth_sheet, cloth_world, drape_spec, sphere_mesh, CLOTH_STEPS,
    DRAPE_SPHERE, LEATHER_THICK, SILK,
};
use rt_phys::World;

const STEPS_PER_SECOND: u32 = 240;

/// Steps until settled or `seconds`; the steps taken.
fn settle(c: &mut Cloth, seconds: u32) -> u32 {
    let mut n = 0;
    while !c.settled() && n < seconds * STEPS_PER_SECOND {
        c.step(1, None);
        n += 1;
    }
    n
}

fn particles(c: &Cloth) -> Vec<Vec3> {
    (0..c.particle_count()).map(|i| c.particle(i)).collect()
}

/// The sag of a catenary of length `l` between two points at the same height `s` apart: the `a`
/// of `2 a sinh(s / 2a) = l` by bisection, then `a (cosh(s / 2a) − 1)`.
fn catenary_sag(l: f64, s: f64) -> f64 {
    let (mut lo, mut hi) = (1.0e-3 * s, 1.0e6 * s);
    for _ in 0..200 {
        let a = 0.5 * (lo + hi);
        if 2.0 * a * (s / (2.0 * a)).sinh() > l {
            lo = a;
        } else {
            hi = a;
        }
    }
    let a = 0.5 * (lo + hi);
    a * ((s / (2.0 * a)).cosh() - 1.0)
}

#[test]
fn a_cloth_hanging_from_two_corners_sags_as_the_catenary() {
    // A strip of silk 1 m long and 20 mm wide (50 × 1 squares) laid as a circular arc between its
    // two top corners, 800 mm apart (its rest shape, which its bending keeps a little of); nothing
    // else is anchored.
    let (length, width, span, n) = (1000.0f64, 20.0f32, 800.0f64, 50u32);
    let (mut lo, mut hi) = (0.5 * span, 100.0 * span);
    for _ in 0..200 {
        let r = 0.5 * (lo + hi);
        if 2.0 * r * (length / (2.0 * r)).sin() > span {
            hi = r;
        } else {
            lo = r;
        }
    }
    let r = 0.5 * (lo + hi);
    let half_angle = length / (2.0 * r);
    let mut positions = Vec::new();
    for j in 0..=1u32 {
        for i in 0..=n {
            let a = -half_angle + 2.0 * half_angle * (i as f64 / n as f64);
            let (x, z) = (
                0.5 * span + r * a.sin(),
                1000.0 - (r * a.cos() - r * half_angle.cos()),
            );
            positions.push(Vec3::new(x as f32, width * j as f32, z as f32));
        }
    }
    let at = |i: u32, j: u32| j * (n + 1) + i;
    let mut indices = Vec::new();
    for i in 0..n {
        indices.extend_from_slice(&[
            at(i, 0),
            at(i + 1, 0),
            at(i + 1, 1),
            at(i, 0),
            at(i + 1, 1),
            at(i, 1),
        ]);
    }
    let mut pinned = vec![false; positions.len()];
    pinned[at(0, 0) as usize] = true;
    pinned[at(n, 0) as usize] = true;
    let spec = ClothSpec {
        pieces: vec![ClothPiece {
            positions,
            indices,
            pinned,
            params: SILK,
        }],
        ..ClothSpec::default()
    };
    let mut c = Cloth::new(&spec);
    let steps = settle(&mut c, 30);
    assert!(c.settled(), "still moving after {steps} steps");
    // A little longer: settled means no particle wanders, not that the slow swing is over.
    c.step(4 * STEPS_PER_SECOND, None);
    let lowest = particles(&c).iter().fold(f32::INFINITY, |m, p| m.min(p.z));
    let sag = 1000.0 - lowest;
    let want = catenary_sag(length, span) as f32;
    println!("catenary: sag {sag:.2} mm, analytic {want:.2} mm, settled in {steps} steps");
    assert!(
        (sag - want).abs() <= 0.02 * want,
        "sag {sag} against {want}"
    );
}

/// The cloth of `params` dropped over the sphere for `seconds`.
fn draped(params: ClothParams, seconds: u32) -> (Cloth, ClothSpec) {
    let spec = drape_spec(params);
    let mut c = Cloth::new(&spec);
    c.step(seconds * STEPS_PER_SECOND, None);
    (c, spec)
}

/// The closest distance from `p` to the sphere's triangles, and whether it is on their outside.
fn to_sphere(spec: &ClothSpec, p: Vec3) -> (f32, bool) {
    let s = &spec.statics[0];
    let mut best = (f32::INFINITY, true);
    for t in s.indices.chunks_exact(3) {
        let [a, b, c] = [t[0], t[1], t[2]].map(|i| s.positions[i as usize]);
        let q = closest_on_triangle(p, a, b, c);
        let d = (p - q).length();
        if d < best.0 {
            let outward = (q - DRAPE_SPHERE.0).dot(p - q) >= 0.0;
            best = (d, outward);
        }
    }
    best
}

#[test]
fn silk_wrinkles_more_than_thick_leather_and_nothing_goes_through_the_sphere() {
    let mut curvature = Vec::new();
    for params in [SILK, LEATHER_THICK] {
        let (c, spec) = draped(params, 3);
        let pos = particles(&c);
        let h = mean_curvature(&pos, c.triangles());
        // Nothing goes through: every particle outside the sphere's triangles, at its thickness.
        let mut nearest = f32::INFINITY;
        for p in &pos {
            let (d, outward) = to_sphere(&spec, *p);
            assert!(outward, "a particle inside the sphere at {p:?}");
            nearest = nearest.min(d);
        }
        assert!(
            nearest >= 0.9 * params.thickness,
            "a particle {nearest} mm from the sphere"
        );
        // And it is draped: the middle rests on the top of the sphere.
        let top = DRAPE_SPHERE.0.z + DRAPE_SPHERE.1;
        let middle = pos.iter().fold(f32::NEG_INFINITY, |m, p| m.max(p.z));
        assert!(
            (middle - top - params.thickness).abs() < 2.0,
            "the top of the cloth at {middle}"
        );
        println!(
            "mean curvature {h:.6} /mm, nearest {nearest:.3} mm (thickness {})",
            params.thickness
        );
        curvature.push(h);
    }
    let ratio = curvature[0] / curvature[1];
    println!("silk / thick leather: {ratio:.2}");
    assert!(
        ratio >= 3.0,
        "silk {} against leather {}: {ratio}",
        curvature[0],
        curvature[1]
    );
}

#[test]
fn an_anchored_vertex_stays_and_the_rest_hangs_below_it() {
    // A sheet held by one corner hangs straight down from it.
    let (positions, indices) = cloth_sheet(200.0, 200.0, 10, 10, Vec3::new(0.0, 0.0, 500.0));
    let n = positions.len();
    let corner = positions[0];
    let mut pinned = vec![false; n];
    pinned[0] = true;
    let spec = ClothSpec {
        pieces: vec![ClothPiece {
            positions,
            indices,
            pinned,
            params: ClothParams { flags: 0, ..SILK },
        }],
        ..ClothSpec::default()
    };
    let mut c = Cloth::new(&spec);
    settle(&mut c, 20);
    let p = c.positions();
    assert_eq!(Vec3::new(p[0], p[1], p[2]), corner);
    let lowest = particles(&c).iter().fold(f32::INFINITY, |m, q| m.min(q.z));
    // The diagonal of the square (283 mm) below the corner, give or take the stretch.
    assert!(
        (corner.z - lowest - 200.0 * 2f32.sqrt()).abs() < 6.0,
        "lowest {lowest}"
    );
}

/// A sheet of `params` held along its top edge (y = 100 mm), hanging in the plane x = 0, after
/// `seconds` of `wind`; the mean x of its particles.
fn flag(params: ClothParams, wind: ClothWind, seconds: u32) -> f32 {
    let (flat, indices) = cloth_sheet(200.0, 200.0, 16, 16, Vec3::ZERO);
    let positions: Vec<Vec3> = flat
        .iter()
        .map(|p| Vec3::new(0.0, p.x, 500.0 + p.y))
        .collect();
    let pinned: Vec<bool> = positions.iter().map(|p| p.z >= 600.0 - 1.0e-3).collect();
    let spec = ClothSpec {
        pieces: vec![ClothPiece {
            positions,
            indices,
            pinned,
            params,
        }],
        wind,
        ..ClothSpec::default()
    };
    let mut c = Cloth::new(&spec);
    c.step(seconds * STEPS_PER_SECOND, None);
    let pos = particles(&c);
    pos.iter().map(|p| p.x).sum::<f32>() / pos.len() as f32
}

#[test]
fn the_wind_blows_a_cloth_and_a_light_one_more() {
    let breeze = ClothWind {
        velocity: Vec3::new(2500.0, 0.0, 0.0),
        ..ClothWind::default()
    };
    let still = flag(SILK, ClothWind::default(), 2);
    let silk = flag(SILK, breeze, 2);
    let leather = flag(LEATHER_THICK, breeze, 2);
    println!("mean x: still {still:.2}, silk {silk:.2}, leather {leather:.2} mm");
    assert!(still.abs() < 0.5, "no wind, no drift: {still}");
    assert!(silk > 60.0, "silk in a 2.5 m/s wind: {silk}");
    assert!(
        leather > 1.0 && leather < 0.6 * silk,
        "leather {leather} against silk {silk}"
    );
    // Gusts move it about, the same way every time.
    let gusty = ClothWind {
        gust: 0.6,
        scale: 100.0,
        speed: 1000.0,
        seed: 3,
        ..breeze
    };
    let a = flag(SILK, gusty, 1);
    assert_eq!(a.to_bits(), flag(SILK, gusty, 1).to_bits());
    assert_ne!(a.to_bits(), flag(SILK, breeze, 1).to_bits());
}

/// A closed box shell (each face 8 × 8 squares, welded at the edges) of 100 mm, resting on the
/// floor after a second, with `pressure`; its volume over the rest volume.
fn cushion(pressure: f32) -> f32 {
    let mut positions = Vec::new();
    let mut indices = Vec::new();
    let faces: [(Vec3, Vec3, Vec3); 6] = [
        (
            Vec3::new(0.0, 0.0, 1.0),
            Vec3::new(1.0, 0.0, 0.0),
            Vec3::new(0.0, 1.0, 0.0),
        ),
        (
            Vec3::new(0.0, 0.0, -1.0),
            Vec3::new(0.0, 1.0, 0.0),
            Vec3::new(1.0, 0.0, 0.0),
        ),
        (
            Vec3::new(1.0, 0.0, 0.0),
            Vec3::new(0.0, 1.0, 0.0),
            Vec3::new(0.0, 0.0, 1.0),
        ),
        (
            Vec3::new(-1.0, 0.0, 0.0),
            Vec3::new(0.0, 0.0, 1.0),
            Vec3::new(0.0, 1.0, 0.0),
        ),
        (
            Vec3::new(0.0, 1.0, 0.0),
            Vec3::new(0.0, 0.0, 1.0),
            Vec3::new(1.0, 0.0, 0.0),
        ),
        (
            Vec3::new(0.0, -1.0, 0.0),
            Vec3::new(1.0, 0.0, 0.0),
            Vec3::new(0.0, 0.0, 1.0),
        ),
    ];
    for (n, u, v) in faces {
        let (p, idx) = cloth_sheet(100.0, 100.0, 8, 8, Vec3::ZERO);
        let base = positions.len() as u32;
        for q in p {
            positions.push(Vec3::new(0.0, 0.0, 150.0) + n * 50.0 + u * q.x + v * q.y);
        }
        indices.extend(idx.iter().map(|i| i + base));
    }
    let n = positions.len();
    let spec = ClothSpec {
        pieces: vec![ClothPiece {
            positions,
            indices,
            pinned: vec![false; n],
            // A membrane: without bending, only the pressure holds its shape.
            params: ClothParams {
                pressure,
                bend: 0.0,
                flags: 0,
                ..SILK
            },
        }],
        floor: Some((0.0, 0.6)),
        ..ClothSpec::default()
    };
    let mut c = Cloth::new(&spec);
    c.step(STEPS_PER_SECOND, None);
    let pos = particles(&c);
    let volume = |pos: &[Vec3]| {
        let o = pos[0];
        c.triangles()
            .iter()
            .map(|t| {
                let [a, b, d] = t.map(|i| pos[i as usize] - o);
                a.cross(b).dot(d)
            })
            .sum::<f32>()
            / 6.0
    };
    (volume(&pos) / 1.0e6).abs()
}

#[test]
fn pressure_keeps_a_closed_shell_full() {
    let full = cushion(1.0);
    let empty = cushion(0.0);
    println!("volume with pressure {full:.3}, without {empty:.3} (of 1.0)");
    assert!(
        full > 0.9,
        "with pressure the cushion keeps {full} of its volume"
    );
    assert!(empty < 0.7 * full, "without it, it slumps: {empty}");
}

/// Two sheets of silk 10 mm apart over the floor; the upper one falls on the lower. The gap
/// between them at the end, at the middle.
fn stacked(self_collision: bool) -> f32 {
    let flags = if self_collision {
        FLAG_SELF_COLLISION
    } else {
        0
    };
    let piece = |z: f32| {
        let (positions, indices) = cloth_sheet(200.0, 200.0, 20, 20, Vec3::new(0.0, 0.0, z));
        let n = positions.len();
        ClothPiece {
            positions,
            indices,
            pinned: vec![false; n],
            params: ClothParams { flags, ..SILK },
        }
    };
    let spec = ClothSpec {
        pieces: vec![piece(2.0), piece(12.0)],
        floor: Some((0.0, 0.6)),
        ..ClothSpec::default()
    };
    let mut c = Cloth::new(&spec);
    c.step(STEPS_PER_SECOND, None);
    let p = c.positions();
    let middle = 220;
    let (low, high) = (p[3 * middle + 2], p[3 * (441 + middle) + 2]);
    high - low
}

#[test]
fn self_collision_keeps_two_layers_apart() {
    let apart = stacked(true);
    let through = stacked(false);
    println!("gap with self-collision {apart:.3} mm, without {through:.3} mm");
    assert!(apart >= 0.9 * 5.0, "the layers {apart} mm apart");
    assert!(
        through < 0.5,
        "without it the upper one falls through: {through}"
    );
}

#[test]
fn a_rigid_body_pushes_the_cloth_and_the_cloth_stays_outside_it() {
    // The parity scene: the cloth falls on a box that has just landed.
    let (mut world, ids) = cloth_world().build();
    assert_eq!(ids, vec![Some(0)]);
    let spec = cloth_parity_spec();
    let mut c = Cloth::new(&spec);
    c.step(CLOTH_STEPS, Some(&mut world));
    let body = world.collider(0).unwrap();
    let th = spec.pieces[0].params.thickness;
    let rt_phys::shape::Shape::Hull(hull) = body.shape else {
        panic!("a box is a hull")
    };
    let mut on_it = 0;
    for p in particles(&c) {
        let local = body.rotation.unrotate(p - body.center);
        let depth = hull
            .normals
            .iter()
            .zip(&hull.offsets)
            .map(|(n, o)| n.dot(local) - o)
            .fold(f32::NEG_INFINITY, f32::max);
        assert!(
            depth >= 0.9 * th - 0.25,
            "a particle {depth} mm inside the box"
        );
        if depth < 2.0 * th {
            on_it += 1;
        }
    }
    assert!(
        on_it > 10,
        "the cloth rests on the box: {on_it} particles on it"
    );
}

/// The cloth parity scene's hashes (cloth, world) after these steps, with the rigid world's narrow
/// phase split into `workers` chunks.
fn parity_hashes(workers: usize, at: &[u32]) -> Vec<(u32, u32, u32)> {
    let (mut world, _) = cloth_world().build();
    world.set_workers(workers);
    let mut c = Cloth::new(&cloth_parity_spec());
    let mut out = Vec::new();
    let mut done = 0;
    for &steps in at {
        c.step(steps - done, Some(&mut world));
        done = steps;
        out.push((steps, c.hash(), world.hash()));
    }
    out
}

/// The cloth hash and the world's of the cloth parity scene after these steps. The WebAssembly
/// check (`tests/cloth-engine.test.ts`, with the scene and these numbers in
/// `tests/fixtures/cloth-drape.json`) and these tests run as WebAssembly must get the same.
pub const PINNED_CLOTH: [(u32, u32, u32); 3] = [
    (60, 0x934a_b623, 0x7ce8_0b31),
    (240, 0x18e8_00e2, 0x3b11_4ee3),
    (CLOTH_STEPS, 0x04ef_32da, 0x3b11_4ee3),
];

#[test]
fn the_cloth_hashes_are_the_pinned_ones_whatever_the_chunks() {
    let at: Vec<u32> = PINNED_CLOTH.iter().map(|p| p.0).collect();
    let runs: Vec<Vec<(u32, u32, u32)>> = [1, 1, 3, 8]
        .iter()
        .map(|&w| parity_hashes(w, &at))
        .collect();
    for r in &runs {
        assert_eq!(r, &runs[0], "{runs:#010x?}");
    }
    #[cfg(not(target_family = "wasm"))]
    {
        let handles: Vec<_> = (0..3)
            .map(|k| {
                let at = at.clone();
                std::thread::spawn(move || parity_hashes(1 + 2 * k, &at))
            })
            .collect();
        for h in handles {
            assert_eq!(h.join().unwrap(), runs[0]);
        }
    }
    assert_eq!(runs[0], PINNED_CLOTH.to_vec(), "{:#010x?}", runs[0]);
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

fn fixture(path: &str, json: &str) {
    if std::env::var_os("REPACK_WRITE_FIXTURES").is_some() {
        std::fs::write(path, json).expect("write the fixture");
    }
    let pinned = std::fs::read_to_string(path).unwrap_or_default();
    assert_eq!(
        json, pinned,
        "{path} is stale: REPACK_WRITE_FIXTURES=1 cargo test -p rt-phys --test cloth"
    );
}

/// The fixture the interface's WebAssembly check reads: the two scenes' bytes and the pinned hashes.
#[cfg(not(target_family = "wasm"))]
#[test]
fn the_cloth_fixture_is_the_checked_in_one() {
    let steps: Vec<String> = PINNED_CLOTH.iter().map(|p| p.0.to_string()).collect();
    let cloth: Vec<String> = PINNED_CLOTH
        .iter()
        .map(|p| format!("\"0x{:08x}\"", p.1))
        .collect();
    let world: Vec<String> = PINNED_CLOTH
        .iter()
        .map(|p| format!("\"0x{:08x}\"", p.2))
        .collect();
    let json = format!(
        "{{\n \"steps\": [{}],\n \"cloth\": [{}],\n \"world\": [{}],\n \"vertices\": {},\n \"spec\": \"{}\",\n \"scene\": \"{}\"\n}}\n",
        steps.join(", "),
        cloth.join(", "),
        world.join(", "),
        cloth_parity_spec().pieces[0].positions.len(),
        base64(&cloth_parity_spec().to_bytes()),
        base64(&cloth_world().to_bytes()),
    );
    fixture(
        concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../../tests/fixtures/cloth-drape.json"
        ),
        &json,
    );
}

/// The fabrics of these tests, which `src/data/fabrics.ts` must give the same values
/// (`tests/cloth.test.ts` reads this fixture).
#[cfg(not(target_family = "wasm"))]
#[test]
fn the_fabric_fixture_is_the_checked_in_one() {
    let row = |key: &str, p: &ClothParams| {
        format!(
            "  \"{key}\": {{ \"weightGsm\": {}, \"stretch\": {}, \"bend\": {:e}, \"damping\": {}, \"thicknessMm\": {}, \"friction\": {} }}",
            p.mass_per_area * 1000.0,
            p.stretch,
            p.bend,
            p.damping,
            p.thickness,
            p.friction
        )
    };
    let json = format!(
        "{{\n{},\n{}\n}}\n",
        row("SILK", &SILK),
        row("LEATHER_THICK", &LEATHER_THICK)
    );
    fixture(
        concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../../tests/fixtures/cloth-fabrics.json"
        ),
        &json,
    );
}

#[test]
fn the_spec_survives_its_format_and_the_examples_load() {
    for spec in [cloth_parity_spec(), drape_spec(SILK)] {
        assert_eq!(ClothSpec::parse(&spec.to_bytes()).unwrap(), spec);
    }
    let _ = (box_mesh, sphere_mesh);
}

#[test]
fn a_world_without_cloth_and_a_cloth_without_world_step() {
    let mut empty = Cloth::new(&ClothSpec::default());
    empty.step(10, None);
    assert_eq!(empty.vertex_count(), 0);
    assert!(empty.settled() || empty.steps() == 10);
    let mut w = World::new();
    empty.step(5, Some(&mut w));
    assert_eq!(w.steps(), 5);
}
