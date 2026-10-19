//! The acceptance tests of S9 (ROADMAP): a 1 m cloth hanging from two corners sags as the analytic
//! catenary; silk over a sphere wrinkles at least three times more (mean curvature) than thick
//! leather; nothing goes through the sphere; and the same scene gives the same bits whatever the
//! run and the number of narrow-phase chunks of the rigid world it runs with, pinned for the
//! WebAssembly check. With them: anchors, wind, pressure, self-collision and the rigid bodies.

use rt_core::math::Vec3;
use rt_phys::cloth::{
    mean_curvature, Cloth, ClothParams, ClothPiece, ClothSpec, ClothStatic, ClothWind,
    FLAG_SELF_COLLISION,
};
use rt_phys::collide::closest_on_triangle;
use rt_phys::example::{
    box_mesh, cloth_disc, cloth_parity_spec, cloth_sheet, cloth_world, cylinder_mesh, drape_spec,
    sphere_mesh, CLOTH_STEPS, DENIM, DRAPE_SPHERE, FABRICS, LEATHER_THICK, SILK,
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
        // Nor between the particles: the sphere's surface stays behind the cloth's.
        let (crossings, far, closest) = surface(&spec.statics[0], &pos, c.triangles());
        assert_eq!(crossings, 0, "an edge of the sphere goes through the cloth");
        assert_eq!(
            far, 0,
            "a vertex of the sphere on the far side of the cloth"
        );
        assert!(
            closest >= 0.9 * params.thickness,
            "the sphere {closest} mm from the cloth's surface"
        );
        // And it is draped: the middle rests on the top of the sphere.
        let top = DRAPE_SPHERE.0.z + DRAPE_SPHERE.1;
        let middle = pos.iter().fold(f32::NEG_INFINITY, |m, p| m.max(p.z));
        assert!(
            (middle - top - params.thickness).abs() < 2.0,
            "the top of the cloth at {middle}"
        );
        println!(
            "mean curvature {h:.6} /mm, nearest particle {nearest:.3} mm, nearest of the sphere to the surface {closest:.3} mm (thickness {})",
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
    // A sheet held by one corner hangs from it: the far corner the diagonal of the square away,
    // below the anchor (silk folds as it hangs, so the diagonal may lean a little).
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
    let far = c.particle(c.particle_of_vertex(n - 1));
    let diagonal = 200.0 * 2f32.sqrt();
    let reach = (far - corner).length();
    println!(
        "the far corner {reach:.1} mm from the anchor, {:.1} mm below it",
        corner.z - far.z
    );
    assert!(
        (reach / diagonal - 1.0).abs() < 0.03,
        "the far corner {reach} mm from the anchor"
    );
    assert!(
        corner.z - far.z > 0.9 * diagonal,
        "the far corner at {far:?}"
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
        // The cloth's surface is held off the box's edges and corners at its thickness, so the
        // particles next to them stand up to half a square higher.
        if depth < th + 0.5 * 300.0 / 24.0 {
            on_it += 1;
        }
    }
    assert!(
        on_it > 10,
        "the cloth rests on the box: {on_it} particles on it"
    );
    // Nor does the box poke through it between its particles.
    let mut faces = ClothStatic {
        positions: hull
            .vertices
            .iter()
            .map(|v| body.center + body.rotation.rotate(*v))
            .collect(),
        indices: Vec::new(),
    };
    for f in 0..hull.normals.len() {
        let l = &hull.loops[hull.loop_start[f] as usize..hull.loop_start[f + 1] as usize];
        for k in 1..l.len() - 1 {
            faces.indices.extend_from_slice(&[l[0], l[k], l[k + 1]]);
        }
    }
    let (crossings, far, nearest) = surface(&faces, &particles(&c), c.triangles());
    println!("the box: {crossings} edges through the cloth, {far} vertices on its far side, the nearest {nearest:.3} mm (thickness {th})");
    assert_eq!(crossings, 0, "an edge of the box goes through the cloth");
    assert_eq!(far, 0, "a corner of the box on the far side of the cloth");
    assert!(
        nearest >= 0.9 * th,
        "the box {nearest} mm from the cloth's surface"
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
/// Re-pinned in S9's second round, the cloth's only (the bodies do not feel the cloth): the
/// orthotropic membrane in place of the springs along the edges, 8 substeps of 2 iterations with
/// the bending in both, the bending's calibration, the feature collisions (the box's edges and
/// corners against the cloth's surface) and CLT1 version 2.
pub const PINNED_CLOTH: [(u32, u32, u32); 3] = [
    (60, 0x8a44_38ab, 0x7ce8_0b31),
    (240, 0x40bf_ccfc, 0x3b11_4ee3),
    (CLOTH_STEPS, 0x15bb_ac03, 0x3b11_4ee3),
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

/// The fabric presets (`rt_phys::example::FABRICS`), which `src/data/fabrics.ts` must give the
/// same values (`tests/cloth.test.ts` reads this fixture).
#[cfg(not(target_family = "wasm"))]
#[test]
fn the_fabric_fixture_is_the_checked_in_one() {
    let row = |key: &str, p: &ClothParams| {
        format!(
            "  \"{key}\": {{ \"weightGsm\": {}, \"stretch\": {}, \"shear\": {}, \"bend\": {:e}, \"damping\": {}, \"thicknessMm\": {}, \"friction\": {} }}",
            p.mass_per_area * 1000.0,
            p.stretch,
            p.shear,
            p.bend,
            p.damping,
            p.thickness,
            p.friction
        )
    };
    let rows: Vec<String> = FABRICS.iter().map(|(k, p)| row(k, p)).collect();
    let json = format!("{{\n{}\n}}\n", rows.join(",\n"));
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

// --- Second round: the drape of a woven fabric (Peirce's cantilever, Cusick's drape) ------------

/// Peirce's cantilever (ASTM D1388): a strip of `params` 25 mm wide, clamped flat behind the edge
/// of the platform and `overhang` mm sticking out past it, settled; the angle (degrees) from the
/// edge down to its tip, and the bending length that angle gives, `l (cos(θ/2) / (8 tan θ))^⅓`.
fn peirce(params: ClothParams, overhang: f32) -> (f32, f32) {
    // Nine squares along the overhang, four and a half to the bending length (Drape over the part
    // lays its sheet over the bottle in squares of about 10 mm: one to six to the bending length of
    // the presets), as many across the 25 mm as fit.
    let nx = 9u32;
    let ny = ((25.0 * nx as f32 / overhang).round() as u32).max(2);
    let (clamp, width) = (10.0f32, 25.0f32);
    let h = overhang / nx as f32;
    // A column of vertices at the clamp's edge, x = 0, and the clamped ones behind it.
    let behind = ((clamp / h).ceil() as u32).max(2);
    let cols = behind + nx;
    let (flat, indices) = cloth_sheet(
        cols as f32 * h,
        width,
        cols,
        ny,
        Vec3::new(0.5 * cols as f32 * h - behind as f32 * h, 0.0, 500.0),
    );
    let pinned: Vec<bool> = flat.iter().map(|p| p.x <= 1.0e-3).collect();
    let tip: Vec<usize> = (0..flat.len())
        .filter(|&i| flat[i].x >= overhang - 1.0e-3)
        .collect();
    let spec = ClothSpec {
        pieces: vec![ClothPiece {
            positions: flat,
            indices,
            pinned,
            params: ClothParams { flags: 0, ..params },
        }],
        ..ClothSpec::default()
    };
    let mut c = Cloth::new(&spec);
    settle(&mut c, 20);
    c.step(STEPS_PER_SECOND, None);
    let p = c.positions();
    let mut at = Vec3::ZERO;
    for &i in &tip {
        at += Vec3::new(p[3 * i], p[3 * i + 1], p[3 * i + 2]);
    }
    at *= 1.0 / tip.len() as f32;
    let theta = (500.0 - at.z).atan2(at.x);
    let l = overhang;
    let c_measured = l * ((theta * 0.5).cos() / (8.0 * theta.tan())).cbrt();
    (theta.to_degrees(), c_measured)
}

/// The bending length of a fabric, mm: `(B / (m g))^⅓`.
fn bending_length(p: &ClothParams) -> f32 {
    (p.bend / (p.mass_per_area * 9.81)).cbrt() * 1000.0
}

#[test]
fn peirce_cantilever_measures_the_bending_length_of_denim_and_thick_leather() {
    for (name, p) in [("denim", DENIM), ("thick leather", LEATHER_THICK)] {
        let want = bending_length(&p);
        let (theta, got) = peirce(p, 2.0 * want);
        println!(
            "Peirce {name}: overhang {:.1} mm, angle {theta:.2}°, bending length {got:.2} mm against {want:.2} mm ({:+.1} %)",
            2.0 * want,
            100.0 * (got / want - 1.0)
        );
        assert!(
            (got / want - 1.0).abs() <= 0.10,
            "{name}: {got} mm against {want} mm"
        );
    }
}

/// The disc Cusick's drape test lays a sample on (BS 5058, ISO 9073-9): 180 mm across, its top at
/// 300 mm.
const CUSICK_SUPPORT: (f32, f32) = (90.0, 300.0);

/// The longest a Cusick sample drapes for, seconds (most have their nodes long before).
const CUSICK_SECONDS: u32 = 4;

/// The shadow of a cloth seen from above (its triangles projected onto the floor, rasterised at a
/// millimetre within 160 mm of the axis): its area, mm², and its outline's farthest radius in each
/// degree around the axis.
fn shadow(pos: &[Vec3], tris: &[[u32; 3]]) -> (f32, Vec<f32>) {
    const HALF: i32 = 160;
    let n = (2 * HALF) as usize;
    let mut on = vec![false; n * n];
    for t in tris {
        let [a, b, c] = t.map(|i| pos[i as usize]);
        let lo = a.min(b).min(c);
        let hi = a.max(b).max(c);
        let cross =
            |o: Vec3, p: Vec3, q: (f32, f32)| (p.x - o.x) * (q.1 - o.y) - (p.y - o.y) * (q.0 - o.x);
        let area = cross(a, b, (c.x, c.y));
        if area == 0.0 {
            continue;
        }
        for y in (lo.y.floor() as i32).max(-HALF)..(hi.y.ceil() as i32).min(HALF) {
            for x in (lo.x.floor() as i32).max(-HALF)..(hi.x.ceil() as i32).min(HALF) {
                let q = (x as f32 + 0.5, y as f32 + 0.5);
                let (u, v, w) = (cross(b, c, q), cross(c, a, q), cross(a, b, q));
                let inside = if area > 0.0 {
                    u >= 0.0 && v >= 0.0 && w >= 0.0
                } else {
                    u <= 0.0 && v <= 0.0 && w <= 0.0
                };
                if inside {
                    on[(y + HALF) as usize * n + (x + HALF) as usize] = true;
                }
            }
        }
    }
    let mut radius = vec![0.0f32; 360];
    let mut count = 0usize;
    for y in 0..n {
        for x in 0..n {
            if !on[y * n + x] {
                continue;
            }
            count += 1;
            let (px, py) = (x as f32 - HALF as f32 + 0.5, y as f32 - HALF as f32 + 0.5);
            let deg = py.atan2(px).to_degrees().rem_euclid(360.0) as usize % 360;
            radius[deg] = radius[deg].max((px * px + py * py).sqrt());
        }
    }
    (count as f32, radius)
}

/// The nodes of a drape: the waves of its outline's radius around the axis (smoothed over 7°)
/// that rise above its mean by a sixth of its range after falling below it by as much.
fn nodes(radius: &[f32]) -> u32 {
    let n = radius.len();
    let smooth: Vec<f32> = (0..n)
        .map(|i| (0..7).map(|k| radius[(i + n + k - 3) % n]).sum::<f32>() / 7.0)
        .collect();
    let mean = smooth.iter().sum::<f32>() / n as f32;
    let (lo, hi) = smooth
        .iter()
        .fold((f32::INFINITY, f32::NEG_INFINITY), |(a, b), r| {
            (a.min(*r), b.max(*r))
        });
    let band = (hi - lo) / 6.0;
    if band < 1.0 {
        return 0;
    }
    // Start where it is lowest, so that the first wave is counted once.
    let first = (0..n).fold(0, |m, i| if smooth[i] < smooth[m] { i } else { m });
    let mut above = false;
    let mut count = 0;
    for k in 0..n {
        let r = smooth[(first + k) % n];
        if !above && r > mean + band {
            above = true;
            count += 1;
        } else if above && r < mean - band {
            above = false;
        }
    }
    count
}

/// Cusick's drape of a 300 mm disc of `params` held flat on [`CUSICK_SUPPORT`]: the drape
/// coefficient `(A_shadow − A_support) / (A_sample − A_support)` once it has settled (at most six
/// seconds), its nodes, and the cloth and its spec.
fn cusick(params: ClothParams) -> (f32, u32, Cloth, ClothSpec) {
    let (r, top) = CUSICK_SUPPORT;
    let (positions, indices) =
        cloth_disc(150.0, 24, Vec3::new(0.0, 0.0, top + params.thickness + 0.5));
    // Held flat between the support and the clamping disc above it, as the tester holds it.
    let pinned: Vec<bool> = positions
        .iter()
        .map(|p| p.x * p.x + p.y * p.y <= r * r)
        .collect();
    let support = cylinder_mesh(r, 100.0, 128);
    let spec = ClothSpec {
        pieces: vec![ClothPiece {
            positions,
            indices,
            pinned,
            params,
        }],
        statics: vec![ClothStatic {
            positions: support
                .positions
                .iter()
                .map(|p| *p + Vec3::new(0.0, 0.0, top - 50.0))
                .collect(),
            indices: support.indices,
        }],
        floor: Some((0.0, 0.6)),
        ..ClothSpec::default()
    };
    let mut c = Cloth::new(&spec);
    let (flat, _) = shadow(&particles(&c), c.triangles());
    settle(&mut c, CUSICK_SECONDS);
    let (area, radius) = shadow(&particles(&c), c.triangles());
    let disc = std::f32::consts::PI * r * r;
    ((area - disc) / (flat - disc), nodes(&radius), c, spec)
}

/// The woven presets (the others are felt, leather and neoprene).
const WOVEN: [&str; 7] = [
    "SILK",
    "COTTON_FINE",
    "POPLIN",
    "LINEN",
    "WOOL",
    "DENIM",
    "CANVAS",
];

#[test]
fn cusick_drape_of_every_preset() {
    // Every preset at once, a thread each (they do not share anything).
    let handles: Vec<_> = FABRICS
        .iter()
        .map(|&(key, p)| {
            std::thread::spawn(move || {
                let (dc, n, c, _) = cusick(p);
                (key, p, dc, n, c.settled(), c.steps())
            })
        })
        .collect();
    let rows: Vec<_> = handles.into_iter().map(|h| h.join().unwrap()).collect();
    for (key, p, dc, n, settled, steps) in &rows {
        println!(
            "Cusick {key:14} bending length {:5.1} mm: DC {dc:.3}, {n} nodes ({} after {:.2} s)",
            bending_length(p),
            if *settled { "settled" } else { "still moving" },
            *steps as f32 / STEPS_PER_SECOND as f32
        );
    }
    let woven: Vec<_> = rows.iter().filter(|r| WOVEN.contains(&r.0)).collect();
    for (key, _, dc, n, _, _) in &woven {
        assert!(*dc < 0.95, "{key}: DC {dc}, a woven fabric drapes");
        assert!(*n >= 4, "{key}: {n} nodes");
    }
    // The drape coefficient rises with the bending length (B / (m g))^⅓, the rigidity a drape
    // answers to (linen and wool have the same, so either may come first).
    for a in &woven {
        for b in &woven {
            if bending_length(&a.1) + 1.0 < bending_length(&b.1) {
                assert!(
                    a.2 < b.2,
                    "{} (DC {}) against {} (DC {})",
                    a.0,
                    a.2,
                    b.0,
                    b.2
                );
            }
        }
    }
    // The leathers within the range published for leathers (and the bending solved in every
    // iteration: once a substep, thick leather's sample sags to 0.53).
    for key in ["LEATHER_THIN", "LEATHER_THICK"] {
        let dc = rows.iter().find(|r| r.0 == key).unwrap().2;
        assert!((0.8..=0.95).contains(&dc), "{key}: DC {dc}");
    }
    let nodes = |key: &str| rows.iter().find(|r| r.0 == key).unwrap().3;
    assert!(
        nodes("SILK") > nodes("DENIM"),
        "silk {} nodes, denim {}",
        nodes("SILK"),
        nodes("DENIM")
    );
}

// --- Second round: the surface of the cloth against sharp features -----------------------------

/// The closest points of the segments `p0 p1` and `q0 q1`: their distance.
fn segment_distance(p0: Vec3, p1: Vec3, q0: Vec3, q1: Vec3) -> f32 {
    let (d1, d2, r) = (p1 - p0, q1 - q0, p0 - q0);
    let (a, e, f) = (d1.dot(d1), d2.dot(d2), d2.dot(r));
    let (c, b) = (d1.dot(r), d1.dot(d2));
    let den = a * e - b * b;
    let mut s = if den > 1.0e-12 * a * e {
        ((b * f - c * e) / den).clamp(0.0, 1.0)
    } else {
        0.0
    };
    let mut t = if e > 0.0 { (b * s + f) / e } else { 0.0 };
    if t < 0.0 {
        t = 0.0;
        s = if a > 0.0 {
            (-c / a).clamp(0.0, 1.0)
        } else {
            0.0
        };
    } else if t > 1.0 {
        t = 1.0;
        s = if a > 0.0 {
            ((b - c) / a).clamp(0.0, 1.0)
        } else {
            0.0
        };
    }
    ((p0 + d1 * s) - (q0 + d2 * t)).length()
}

/// Where along `p0 → p1` the segment passes through the triangle `a b c`, strictly inside it.
fn pierces(p0: Vec3, p1: Vec3, a: Vec3, b: Vec3, c: Vec3) -> bool {
    let (e1, e2, d) = (b - a, c - a, p1 - p0);
    let h = d.cross(e2);
    let det = e1.dot(h);
    if det.abs() < 1.0e-12 {
        return false;
    }
    let s = p0 - a;
    let u = s.dot(h) / det;
    let q = s.cross(e1);
    let v = d.dot(q) / det;
    let t = e2.dot(q) / det;
    u > 0.0 && v > 0.0 && u + v < 1.0 && t > 0.0 && t < 1.0
}

/// What the second round asks of a cloth laid over a static mesh, measured on every vertex and
/// edge of the mesh against every triangle of the cloth: the edges that cross a cloth triangle; the
/// vertices on the far side of the cloth (straight above them, the first cloth triangle shows them
/// its front, the face that looked up when the cloth was laid, or there is none: the cloth is
/// under them); and the least distance from a vertex or an edge to the cloth's surface (0 when
/// one crosses it).
fn surface(statics: &ClothStatic, pos: &[Vec3], tris: &[[u32; 3]]) -> (usize, usize, f32) {
    // The cloth's triangles in a grid of cells as big as the biggest of them (and 8 mm).
    let boxes: Vec<(Vec3, Vec3)> = tris
        .iter()
        .map(|t| {
            let [a, b, c] = t.map(|i| pos[i as usize]);
            (a.min(b).min(c), a.max(b).max(c))
        })
        .collect();
    let size = boxes.iter().fold(8.0f32, |m, (lo, hi)| {
        m.max((*hi - *lo).x).max((*hi - *lo).y).max((*hi - *lo).z)
    });
    let cell = |p: Vec3| {
        [
            (p.x / size).floor() as i32,
            (p.y / size).floor() as i32,
            (p.z / size).floor() as i32,
        ]
    };
    let mut grid: std::collections::HashMap<[i32; 3], Vec<usize>> = Default::default();
    for (k, (lo, _)) in boxes.iter().enumerate() {
        grid.entry(cell(*lo)).or_default().push(k);
    }
    // The triangles whose boxes come within `margin` of the box `lo hi`.
    let near = |lo: Vec3, hi: Vec3, margin: f32| -> Vec<usize> {
        let (a, b) = (
            cell(lo - Vec3::splat(margin + size)),
            cell(hi + Vec3::splat(margin)),
        );
        let mut out = Vec::new();
        for x in a[0]..=b[0] {
            for y in a[1]..=b[1] {
                for z in a[2]..=b[2] {
                    if let Some(v) = grid.get(&[x, y, z]) {
                        for &k in v {
                            let (l, h) = boxes[k];
                            if l.x <= hi.x + margin
                                && lo.x - margin <= h.x
                                && l.y <= hi.y + margin
                                && lo.y - margin <= h.y
                                && l.z <= hi.z + margin
                                && lo.z - margin <= h.z
                            {
                                out.push(k);
                            }
                        }
                    }
                }
            }
        }
        out
    };
    let mut nearest = f32::INFINITY;
    let mut far = 0;
    let probe = 20.0f32;
    // Straight up from each vertex, the first cloth triangle it meets.
    let mut columns: std::collections::HashMap<[i32; 2], Vec<usize>> = Default::default();
    for (k, (lo, hi)) in boxes.iter().enumerate() {
        let (a, b) = (cell(*lo), cell(*hi));
        for x in a[0]..=b[0] {
            for y in a[1]..=b[1] {
                columns.entry([x, y]).or_default().push(k);
            }
        }
    }
    for &p in &statics.positions {
        for k in near(p, p, probe) {
            let [a, b, c] = tris[k].map(|i| pos[i as usize]);
            nearest = nearest.min((p - closest_on_triangle(p, a, b, c)).length());
        }
        let c = cell(p);
        let mut first: Option<(f32, f32)> = None;
        for &k in columns
            .get(&[c[0], c[1]])
            .map(|v| v.as_slice())
            .unwrap_or(&[])
        {
            let [a, b, q] = tris[k].map(|i| pos[i as usize]);
            let up = p + Vec3::new(0.0, 0.0, 1.0e5);
            if !pierces(p, up, a, b, q) {
                continue;
            }
            let n = (b - a).cross(q - a);
            // Where it meets the plane.
            let t = (a - p).dot(n) / n.z;
            if first.is_none_or(|f| t < f.0) {
                first = Some((t, n.z));
            }
        }
        // The cloth's front looks up and away; from under it a vertex sees its back.
        if !first.is_some_and(|(_, nz)| nz > 0.0) {
            far += 1;
        }
    }
    let mut edges: Vec<(u32, u32)> = Vec::new();
    for t in statics.indices.chunks_exact(3) {
        for s in 0..3 {
            let (a, b) = (t[s], t[(s + 1) % 3]);
            edges.push((a.min(b), a.max(b)));
        }
    }
    edges.sort_unstable();
    edges.dedup();
    let mut crossings = 0;
    for (a, b) in edges {
        let (p0, p1) = (statics.positions[a as usize], statics.positions[b as usize]);
        let mut crossed = false;
        for k in near(p0.min(p1), p0.max(p1), probe) {
            let [x, y, z] = tris[k].map(|i| pos[i as usize]);
            if pierces(p0, p1, x, y, z) {
                crossed = true;
                nearest = 0.0;
                continue;
            }
            for (u, v) in [(x, y), (y, z), (z, x)] {
                nearest = nearest.min(segment_distance(p0, p1, u, v));
            }
        }
        if crossed {
            crossings += 1;
        }
    }
    (crossings, far, nearest)
}

/// A sheet of `params`, `size` mm square in `cells × cells`, laid flat `gap` mm above the top of
/// `mesh` (moved by `at`) and dropped for `seconds`: the cloth, the static mesh as the cloth saw
/// it.
fn dropped_on(
    mesh: rt_phys::scene::SceneMesh,
    at: Vec3,
    params: ClothParams,
    size: f32,
    cells: u32,
    seconds: u32,
) -> (Cloth, ClothStatic) {
    let positions: Vec<Vec3> = mesh.positions.iter().map(|p| *p + at).collect();
    let top = positions.iter().fold(f32::NEG_INFINITY, |m, p| m.max(p.z));
    let still = ClothStatic {
        positions,
        indices: mesh.indices,
    };
    let (sheet, indices) = cloth_sheet(size, size, cells, cells, Vec3::new(0.0, 0.0, top + 20.0));
    let n = sheet.len();
    let spec = ClothSpec {
        pieces: vec![ClothPiece {
            positions: sheet,
            indices,
            pinned: vec![false; n],
            params,
        }],
        statics: vec![still.clone()],
        floor: Some((0.0, 0.6)),
        ..ClothSpec::default()
    };
    let mut c = Cloth::new(&spec);
    c.step(seconds * STEPS_PER_SECOND, None);
    (c, still)
}

/// Silk dropped over `mesh`: nothing of it through the cloth, nothing on the cloth's far side,
/// nothing nearer the cloth's surface than 0.9 of its thickness, and the cloth draped down to the
/// floor around it.
fn no_poking_through(name: &str, mesh: rt_phys::scene::SceneMesh, at: Vec3, size: f32, cells: u32) {
    let (c, still) = dropped_on(mesh, at, SILK, size, cells, 2);
    let pos = particles(&c);
    let (crossings, far, nearest) = surface(&still, &pos, c.triangles());
    println!(
        "{name}: {crossings} edges through the cloth, {far} vertices on its far side, the nearest {nearest:.3} mm (thickness {})",
        SILK.thickness
    );
    assert_eq!(crossings, 0, "{name}: an edge goes through the cloth");
    assert_eq!(far, 0, "{name}: a vertex on the far side of the cloth");
    assert!(
        nearest >= 0.9 * SILK.thickness,
        "{name}: a feature {nearest} mm from the cloth's surface"
    );
    let lowest = pos.iter().fold(f32::INFINITY, |m, p| m.min(p.z));
    assert!(lowest < 10.0, "{name}: the lowest of the cloth at {lowest}");
}

#[test]
fn a_box_does_not_poke_through_silk() {
    // A 200 × 200 × 150 mm box on the floor under a 500 mm sheet of 10.4 mm squares.
    no_poking_through(
        "box",
        box_mesh(Vec3::new(100.0, 100.0, 75.0)),
        Vec3::new(0.0, 0.0, 75.0),
        500.0,
        48,
    );
}

#[test]
fn a_sharp_rimmed_cylinder_the_size_of_the_bottle_cap_does_not_poke_through_silk() {
    // The example bottle's cap is 28 mm across with a rounded rim; this one's rim is a right
    // angle, on a post 60 mm tall, under a 200 mm sheet of 10 mm squares (the size of the squares
    // Drape over the part lays over the bottle).
    no_poking_through(
        "cylinder",
        cylinder_mesh(14.0, 60.0, 96),
        Vec3::new(0.0, 0.0, 30.0),
        200.0,
        20,
    );
}
