//! S3e: what the parts simulation ([`rt_phys::wet_parts`]) adds on top of S3c, S3d and S3f: parts
//! that move with the rigid bodies get wet where they are at each step (the flux they see with the
//! rain's velocity less theirs, what is in the way where they stand, the gravity their drops feel
//! less their acceleration); the studio floor gets wet, dusty and snowy as a film, and takes the
//! drips; the film triangles a shadow edge crosses take fine samples; the wind pushes the drops in
//! the air; a drop that reaches a sloping open edge runs along it to the lowest corner.

use rt_core::math::Vec3;
use rt_phys::example::{
    box_mesh, parts_mesh, plate_mesh, DUST_REPOSE_DEG, GLASS_ADVANCING_DEG, GLASS_RECEDING_DEG,
    SNOW_REPOSE_DEG,
};
use rt_phys::math::Quat;
use rt_phys::wet_parts::{
    FloorSpec, PartsExtras, PartsMesh, PartsSource, PartsSourceKind, PartsSpec, WetPartSpec,
    WetParts, NEVER, NO_BODY, PART_FILM,
};
use rt_phys::world::Pose;
use rt_phys::Transform;

fn glass(mesh: u32, transform: Transform, body: u32) -> WetPartSpec {
    WetPartSpec {
        mesh,
        transform,
        advancing_deg: GLASS_ADVANCING_DEG,
        receding_deg: GLASS_RECEDING_DEG,
        soak_mm_s: 0.0,
        flags: 0,
        body,
    }
}

fn spec(meshes: Vec<PartsMesh>, parts: Vec<WetPartSpec>, sources: Vec<PartsSource>) -> PartsSpec {
    PartsSpec {
        seed: 33,
        cell_mm: 1.0,
        max_samples: 400_000,
        repose_deg: DUST_REPOSE_DEG,
        snow_repose_deg: SNOW_REPOSE_DEG,
        meshes,
        parts,
        sources,
        extras: PartsExtras::default(),
    }
}

fn source(kind: PartsSourceKind, density: f32, velocity: Vec3, size: f32) -> PartsSource {
    PartsSource {
        kind,
        density,
        velocity,
        size_mm: size,
        size_var: 0.0,
    }
}

/// The volume over the cube of the contact radius of a cap at the mean of glass's angles.
fn glass_k() -> f32 {
    let t = (0.5 * f64::from(GLASS_ADVANCING_DEG + GLASS_RECEDING_DEG)).to_radians();
    (std::f64::consts::PI * (2.0 - 3.0 * t.cos() + t.cos().powi(3)) / (3.0 * t.sin().powi(3)))
        as f32
}

/// A plate facing down (its triangles wound the other way).
fn ceiling(size: f32, n: u32) -> PartsMesh {
    let mut m = plate_mesh(size, size, n, n);
    m.indices.chunks_exact_mut(3).for_each(|t| t.swap(1, 2));
    m
}

/// A translation pose of a body that started at `c0`.
fn at(p: Vec3) -> Option<Pose> {
    Some(Pose {
        translation: p,
        rotation: Quat::IDENTITY,
    })
}

// --- A drop that runs along a sloping open edge -------------------------------------------------

/// A glass plate 60 mm wide and 160 mm long, tilted 60° about X (its slope down −Y) and rolled
/// `roll` degrees about Y: its corners, world, and the transform.
fn tilted_plate(roll: f32) -> (Transform, [Vec3; 4]) {
    let q = Quat::from_axis_angle(Vec3::new(0.0, 1.0, 0.0), roll.to_radians())
        * Quat::from_axis_angle(Vec3::new(1.0, 0.0, 0.0), 60f32.to_radians());
    let t = Transform::from_pose(Vec3::new(0.0, 0.0, 120.0), q);
    let c = [
        Vec3::new(-30.0, -80.0, 0.0),
        Vec3::new(30.0, -80.0, 0.0),
        Vec3::new(30.0, 80.0, 0.0),
        Vec3::new(-30.0, 80.0, 0.0),
    ]
    .map(|p| t.apply(p));
    (t, c)
}

/// The object point of world point `p` of a plate placed by the rigid `t`.
fn t_inverse_apply(t: &Transform, p: Vec3) -> Vec3 {
    let r = &t.rows;
    let d = p - Vec3::new(r[0][3], r[1][3], r[2][3]);
    Vec3::new(
        r[0][0] * d.x + r[1][0] * d.y + r[2][0] * d.z,
        r[0][1] * d.x + r[1][1] * d.y + r[2][1] * d.z,
        r[0][2] * d.x + r[1][2] * d.y + r[2][2] * d.z,
    )
}

/// The triangle and weights of the point `(x, y)` of a 3 × 8 plate of 60 × 160 mm.
fn on_plate(x: f32, y: f32) -> (usize, f32, f32) {
    let (fx, fy) = ((x + 30.0) / 20.0, (y + 80.0) / 20.0);
    let (i, j) = (fx.floor(), fy.floor());
    let (u, v) = (fx - i, fy - j);
    let quad = (j as u32 * 3 + i as u32) as usize;
    if u >= v {
        (2 * quad, u - v, v)
    } else {
        (2 * quad + 1, u, v - u)
    }
}

#[test]
fn drops_that_reach_a_side_edge_run_down_it_and_gather_at_the_lowest_corner() {
    // Rolled 12°: one side edge runs steeply down to the lowest corner, the lower edge slopes a
    // little towards it too.
    let (t, corners) = tilted_plate(12.0);
    let lowest = corners
        .iter()
        .copied()
        .fold(corners[0], |m, c| if c.z < m.z { c } else { m });
    // The side the lowest corner is on (its object X).
    let side = if (lowest - corners[0]).length() < 1e-3 || (lowest - corners[3]).length() < 1e-3 {
        -1.0
    } else {
        1.0
    };
    let mut parts = WetParts::new(spec(
        vec![plate_mesh(60.0, 160.0, 3, 8)],
        vec![glass(0, t, NO_BODY)],
        vec![],
    ));
    let crit = parts.critical_radius(0, 60f32.to_radians().sin());
    let k = glass_k();
    // Three drops past their size, 4 mm in from that side edge, high up the plate.
    let a = 1.6 * crit;
    for y in [70.0, 50.0, 30.0] {
        let (tri, u, v) = on_plate(side * 26.0, y);
        parts.add_drop(0, tri, u, v, k * a * a * a);
    }
    let water = parts.water();
    let mut reached_side = false;
    for _ in 0..1600 {
        parts.step(1);
        reached_side |= parts
            .drop_states()
            .iter()
            .any(|d| d.edge && (d.p - lowest).length() > 20.0);
    }
    assert!(reached_side, "the drops reach the side edge first");
    // (The beads of their rivulets stay behind them on the face: S3f.)
    let d: Vec<_> = parts
        .drop_states()
        .into_iter()
        .filter(|d| d.volume > 5.0)
        .collect();
    // They ran down the edge to the lowest corner and gathered there into one drop that hangs (or
    // let go of a drip from it), from rest.
    let (_, _, drips) = parts.counts();
    assert!(!d.is_empty() || drips > 0, "{d:?}");
    for x in &d {
        assert!(
            (x.p - lowest).length() < x.a + 1.0,
            "a drop is not at the lowest corner: {x:?} {lowest:?}"
        );
        assert!(x.edge);
        assert!(x.velocity.length() < 1e-3, "it is at rest there: {x:?}");
    }
    assert_eq!(d.len(), 1, "gathered into one: {d:?}");
    // Its water: what was seeded, less its trail's film and what dripped.
    assert!(
        parts.water() + parts.water_shed() + parts.water_in_air() + parts.water_lost()
            > 0.999 * water
    );
}

#[test]
fn the_lowest_edge_holds_and_a_drop_at_a_corner_lets_go_from_rest() {
    // Not rolled: the lower edge is level, the drops that reach it stay where they reached it.
    let (t, corners) = tilted_plate(0.0);
    let mut parts = WetParts::new(spec(
        vec![plate_mesh(60.0, 160.0, 3, 8)],
        vec![glass(0, t, NO_BODY)],
        vec![],
    ));
    let crit = parts.critical_radius(0, 60f32.to_radians().sin());
    let k = glass_k();
    let a = 1.6 * crit;
    for x in [-15.0, 0.0, 15.0] {
        let (tri, u, v) = on_plate(x, 40.0);
        parts.add_drop(0, tri, u, v, k * a * a * a);
    }
    parts.step(1200);
    let d: Vec<_> = parts
        .drop_states()
        .into_iter()
        .filter(|d| d.volume > 5.0)
        .collect();
    assert_eq!(d.len(), 3, "{d:?}");
    let bottom = corners[0].z;
    for (x, want) in d.iter().zip([-15.0f32, 0.0, 15.0]) {
        assert!(x.edge && (x.p.z - bottom).abs() < 1e-2, "{x:?}");
        assert!(
            (x.p.x - want).abs() < 0.5,
            "it stayed where it reached the edge: {x:?}"
        );
    }
    // At a corner of the rolled plate, fed past what its contact line holds, it pinches off a drop
    // that starts from rest.
    let (t, corners) = tilted_plate(12.0);
    let lowest = corners
        .iter()
        .copied()
        .fold(corners[0], |m, c| if c.z < m.z { c } else { m });
    let mut parts = WetParts::new(spec(
        vec![plate_mesh(60.0, 160.0, 3, 8)],
        vec![glass(0, t, NO_BODY)],
        vec![],
    ));
    let side = if (lowest - corners[0]).length() < 1e-3 {
        -1.0
    } else {
        1.0
    };
    let a = 1.6 * crit;
    let (tri, u, v) = on_plate(side * 26.0, 0.0);
    parts.add_drop(0, tri, u, v, k * a * a * a);
    let mut steps = 0;
    let corner = loop {
        parts.step(1);
        steps += 1;
        assert!(steps < 2400, "it never reached the corner");
        let at = parts
            .drop_states()
            .into_iter()
            .find(|d| d.edge && (d.p - lowest).length() < 1.0 && d.velocity == Vec3::ZERO);
        if let Some(d) = at {
            break d;
        }
    };
    assert_eq!(parts.counts().2, 0);
    // Fed there past what its contact line holds (Tate: ρ g V = 2π a γ sin θ̄), it necks and lets
    // go of a drop that starts from rest.
    let hold =
        (2.0 * std::f32::consts::PI * 7.2e-5 * 60f32.to_radians().sin() / (9.81e-6 * k)).sqrt();
    let need = k * hold * hold * hold * 1.1 - corner.volume;
    let into = Vec3::new(-side * 2.0, 2.0, 0.0);
    let local = t_inverse_apply(&t, corner.p) + into;
    let (tri, u, v) = on_plate(local.x, local.y);
    parts.add_drop(0, tri, u, v, need);
    let mut launched = None;
    for _ in 0..600 {
        let before = parts.falling().len();
        parts.step(1);
        if parts.falling().len() > before {
            launched = Some((parts.falling()[before], parts.falling_velocities()[before]));
            break;
        }
    }
    let ((part, p, _), v) = launched.expect("it lets go");
    assert_eq!(part, 0);
    assert!((p - lowest).length() < hold + 4.0, "{p:?} {lowest:?}");
    assert_eq!(v, Vec3::ZERO, "from rest");
}

// --- The wind on the drops in the air -----------------------------------------------------------

#[test]
fn the_wind_carries_the_drops_in_the_air_downwind_and_without_it_nothing_changes() {
    let floor = plate_mesh(600.0, 600.0, 4, 4);
    let base = spec(
        vec![floor],
        vec![glass(0, Transform::IDENTITY, NO_BODY)],
        vec![],
    );
    let fall = |wind: Vec3| {
        let mut s = base.clone();
        s.extras.wind = wind;
        let mut parts = WetParts::new(s);
        // A 2 mm drop released at rest 30 mm up (it lands at 0.77 m/s: K ≈ 25, no splash).
        let v = std::f32::consts::PI / 6.0 * 8.0;
        parts.add_falling(0, Vec3::new(10.0, 7.0, 30.0), Vec3::ZERO, v);
        let mut steps = 0;
        let mut last = Vec3::ZERO;
        while !parts.falling().is_empty() && steps < 2000 {
            last = parts.falling_velocities()[0];
            parts.step(1);
            steps += 1;
        }
        (parts.drops(), last)
    };
    let (still, _) = fall(Vec3::ZERO);
    let (blown, v) = fall(Vec3::new(3000.0, 0.0, 0.0));
    assert_eq!(still.len(), 1);
    assert!((still[0].2.x - 10.0).abs() < 1e-3, "{still:?}");
    // Downwind: the drag of 3 m/s of air on a 2 mm drop (terminal at 6.55 m/s) is about 2 m/s², a
    // few millimetres over the 80 ms it falls; it never goes faster than the wind.
    assert_eq!(blown.len(), 1);
    assert!(blown[0].2.x > 12.0 && blown[0].2.x < 30.0, "{blown:?}");
    assert!(v.x > 0.0 && v.x < 3000.0, "{v:?}");
    // A wind of nothing is the spec of before (version 1): the S3d pins hold it.
    let mut zero = base.clone();
    zero.extras.wind = Vec3::ZERO;
    assert_eq!(zero.to_bytes(), base.to_bytes());
    assert_eq!(&base.to_bytes()[4..8], &1u32.to_le_bytes());
}

#[test]
fn a_drip_under_a_side_wind_lands_downwind() {
    // A glass ceiling 80 mm above the studio floor; a drop under it past its hold pinches off.
    let mut s = spec(
        vec![ceiling(60.0, 2)],
        vec![glass(
            0,
            Transform::translation(Vec3::new(0.0, 0.0, 80.0)),
            NO_BODY,
        )],
        vec![],
    );
    s.extras.floor = Some(FloorSpec {
        z: 0.0,
        min: [-200.0, -200.0],
        max: [200.0, 200.0],
        cell_mm: 2.0,
        max_cells: 100_000,
    });
    let k = glass_k();
    let hold =
        (2.0 * std::f32::consts::PI * 7.2e-5 * 60f32.to_radians().sin() / (9.81e-6 * k)).sqrt();
    let landing = |wind: Vec3| {
        let mut s = s.clone();
        s.extras.wind = wind;
        let mut parts = WetParts::new(s);
        let a = 1.05 * hold;
        parts.add_drop(0, 0, 0.3, 0.3, k * a * a * a);
        let release = parts.drop_states()[0].p;
        parts.step(600);
        let (nx, ny, cell) = parts.floor_cells().unwrap();
        let wet: Vec<Vec3> = (0..(nx * ny) as usize)
            .filter(|&c| parts.floor_wet_step(c) != NEVER)
            .map(|c| {
                Vec3::new(
                    -200.0 + ((c as u32 % nx) as f32 + 0.5) * cell,
                    -200.0 + ((c as u32 / nx) as f32 + 0.5) * cell,
                    0.0,
                )
            })
            .collect();
        assert!(!wet.is_empty(), "the drip wets the floor where it lands");
        let x = wet.iter().map(|p| p.x).sum::<f32>() / wet.len() as f32;
        assert!(parts.floor_water().1 >= 1);
        (x - release.x, parts.floor_water().0)
    };
    let (calm, water) = landing(Vec3::ZERO);
    let (windy, _) = landing(Vec3::new(4000.0, 0.0, 0.0));
    assert!(calm.abs() < 2.0, "{calm}");
    assert!(windy > calm + 3.0, "downwind: {windy} against {calm}");
    // The drip's water is on the floor (the floor is a film: no splash, no drop).
    assert!(water > 0.0);
}

// --- Moving parts -------------------------------------------------------------------------------

#[test]
fn a_part_that_moves_out_from_under_a_roof_gets_wet_where_it_comes_into_the_rain() {
    // A roof over x < 0 at 100 mm, a plate (100 mm square) under it at 40 mm that slides 150 mm
    // along +X in the first second (its body's poses), then stays; rain slow enough not to splash
    // off the roof.
    let rain = source(
        PartsSourceKind::Drops,
        1.0e-4,
        Vec3::new(0.0, 0.0, -2000.0),
        1.0,
    );
    let s = spec(
        vec![
            plate_mesh(200.0, 200.0, 2, 2),
            plate_mesh(100.0, 100.0, 4, 4),
        ],
        vec![
            glass(
                0,
                Transform::translation(Vec3::new(-100.0, 0.0, 100.0)),
                NO_BODY,
            ),
            glass(1, Transform::translation(Vec3::new(0.0, 0.0, 40.0)), 0),
        ],
        vec![rain],
    );
    let run = |moves: bool| {
        let mut parts = WetParts::new(s.clone());
        assert_eq!(parts.moving_parts(), 1);
        let c0 = Vec3::new(0.0, 0.0, 40.0);
        parts.begin_poses(&[at(c0)]);
        for k in 1..=720u32 {
            let x = if moves {
                150.0 * (k.min(240) as f32 / 240.0)
            } else {
                0.0
            };
            parts.step_posed(&[at(c0 + Vec3::new(x, 0.0, 0.0))]);
        }
        parts
    };
    let wet_left = |parts: &WetParts| {
        // The plate's samples whose object X is below −10 (the half that started under the roof).
        let w = &parts.weather()[1];
        let mut n = 0;
        let mut first = 0usize;
        for &r in &w.resolution {
            let r = u32::from(r);
            let count = ((r + 1) * (r + 2) / 2) as usize;
            for k in 0..count {
                let p = parts.sample_position(parts_first(parts, 1) + first + k);
                let o = p - parts_offset(parts);
                if o.x < -10.0 && w.wet[first + k] {
                    n += 1;
                }
            }
            first += count;
        }
        n
    };
    let moved = run(true);
    let stayed = run(false);
    assert_eq!(wet_left(&stayed), 0, "under the roof it stays dry");
    assert!(wet_left(&moved) > 100, "out in the rain it gets wet");
    // Its drops ride on it: on its surface where it stands now, inside its square.
    let drops: Vec<_> = moved.drops().into_iter().filter(|d| d.0 == 1).collect();
    assert!(!drops.is_empty());
    for d in &drops {
        assert!((d.2.z - 40.0).abs() < 1e-3, "{d:?}");
        assert!(d.2.x > 100.0 - 1e-3 && d.2.x < 200.0 + 1e-3, "{d:?}");
    }
    // In its own space they lie on the plate (the frames and the renderer take them there).
    for w in moved.weather()[1].drops.iter() {
        assert!(
            w.1.x.abs() <= 50.0 + 1e-3 && w.1.y.abs() <= 50.0 + 1e-3,
            "{w:?}"
        );
        assert!(w.1.z.abs() < 1e-3);
    }
    // Pinned on it, they keep their place on it as it moves: from one step to the next, in the
    // middle of its slide, its drops are where they were in its own space.
    // (Twenty small drops put on it, without rain: none merges.)
    let mut dry = s.clone();
    dry.sources.clear();
    let mut parts = WetParts::new(dry);
    for n in 0..20 {
        parts.add_drop(1, n % 32, 0.2, 0.3, 0.5);
    }
    let c0 = Vec3::new(0.0, 0.0, 40.0);
    parts.begin_poses(&[at(c0)]);
    let slide = |k: u32| at(c0 + Vec3::new(150.0 * k as f32 / 240.0, 0.0, 0.0));
    // (Its first step is a jolt, 0.6 mm in a 240th of a second, that throws them back a little:
    // from the second on, at a steady speed, nothing pushes them.)
    parts.step_posed(&[slide(1)]);
    let before: Vec<Vec3> = parts.weather()[1].drops.iter().map(|d| d.1).collect();
    for k in 2..=120u32 {
        parts.step_posed(&[slide(k)]);
    }
    let after: Vec<Vec3> = parts.weather()[1].drops.iter().map(|d| d.1).collect();
    assert_eq!(before.len(), 20);
    assert_eq!(after.len(), 20);
    for (p, q) in before.iter().zip(&after) {
        assert!((*p - *q).length() < 1e-3, "{p:?} {q:?}");
    }
}

/// The first sample of part `k` (the samples of the parts before it).
fn parts_first(parts: &WetParts, k: usize) -> usize {
    (0..parts.sample_count())
        .find(|&s| parts.sample_part(s) == k)
        .unwrap_or(0)
}

/// Where the moving plate's object origin is now (its first sample is its corner −50, −50).
fn parts_offset(parts: &WetParts) -> Vec3 {
    parts.sample_position(parts_first(parts, 1)) + Vec3::new(50.0, 50.0, 0.0)
}

#[test]
fn a_part_that_moves_into_the_rain_sees_more_of_it_and_one_that_falls_with_it_none() {
    // A level plate under rain falling at 6.5 m/s: still, rising at 6.5 m/s (twice the flux) and
    // falling at 6.5 m/s (none).
    let rain = source(
        PartsSourceKind::Drops,
        2.0e-6,
        Vec3::new(0.0, 0.0, -6500.0),
        0.4,
    );
    let s = spec(
        vec![plate_mesh(200.0, 200.0, 2, 2)],
        vec![glass(0, Transform::IDENTITY, 0)],
        vec![rain],
    );
    let landed = |speed: f32| {
        let mut parts = WetParts::new(s.clone());
        parts.begin_poses(&[at(Vec3::ZERO)]);
        for k in 1..=240u32 {
            parts.step_posed(&[at(Vec3::new(0.0, 0.0, speed * k as f32 / 240.0))]);
        }
        parts.counts().0 as f32
    };
    let still = landed(0.0);
    let up = landed(6500.0);
    let down = landed(-6500.0);
    // The mean: density × speed × area × time = 2e-6 × 6500 × 40 000 × 1 = 520 drops.
    assert!((still - 520.0).abs() < 4.0 * 520f32.sqrt(), "{still}");
    assert!((up - 1040.0).abs() < 4.0 * 1040f32.sqrt(), "{up}");
    assert!(down < 3.0, "{down}");
}

#[test]
fn a_drop_on_a_part_in_free_fall_does_not_slide_and_slides_once_it_stands() {
    // A glass plate tilted 60° with a drop past its size: standing, it slides; falling freely (its
    // body's poses at −½ g t²), its drop feels no weight and stays where it is on it.
    let (t, _) = tilted_plate(0.0);
    let s = spec(
        vec![plate_mesh(60.0, 160.0, 3, 8)],
        vec![glass(0, t, 0)],
        vec![],
    );
    let c0 = Vec3::new(0.0, 0.0, 120.0);
    let start = |s: &PartsSpec| {
        let mut parts = WetParts::new(s.clone());
        let crit = parts.critical_radius(0, 60f32.to_radians().sin());
        let k = glass_k();
        let a = 1.5 * crit;
        let (tri, u, v) = on_plate(0.0, 60.0);
        parts.add_drop(0, tri, u, v, k * a * a * a);
        parts.begin_poses(&[at(c0)]);
        parts
    };
    let object = |parts: &WetParts| parts.weather()[0].drops[0].1;
    let mut standing = start(&s);
    let mut falling = start(&s);
    let from = object(&falling);
    for k in 1..=24u32 {
        let t = k as f32 / 240.0;
        standing.step_posed(&[at(c0)]);
        falling.step_posed(&[at(c0 - Vec3::new(0.0, 0.0, 0.5 * 9810.0 * t * t))]);
    }
    let slid = (object(&standing) - from).length();
    let fell = (object(&falling) - from).length();
    assert!(slid > 5.0, "{slid}");
    // Only its first step (half its weight while the fall begins) moves it a little.
    assert!(fell < 0.1 * slid, "{fell} against {slid}");
    assert!(
        falling.part_gravity(0).length() < 1e-2,
        "{:?}",
        falling.part_gravity(0)
    );
    assert_eq!(standing.part_gravity(0), Vec3::new(0.0, 0.0, -1.0));
    // Standing again (its pose no longer changes): it slides down.
    let rest = c0 - Vec3::new(0.0, 0.0, 0.5 * 9810.0 * 0.01);
    let was = object(&falling);
    for _ in 0..48 {
        falling.step_posed(&[at(rest)]);
    }
    assert!((object(&falling) - was).length() > 3.0);
    assert_eq!(falling.part_gravity(0), Vec3::new(0.0, 0.0, -1.0));
}

#[test]
fn a_dynamic_body_dropped_in_the_rain_gets_wet_on_its_faces_the_same_however_the_steps_go() {
    use rt_phys::example::drop_scene;
    // The parity drop scene's tilted box (its body 0) as a wet part, under rain.
    let scene = drop_scene();
    let piece = scene.bodies[0].pieces[0];
    let s = spec(
        vec![parts_mesh(box_mesh(Vec3::new(30.0, 20.0, 15.0)))],
        vec![glass(0, piece.transform, 0)],
        vec![source(
            PartsSourceKind::Drops,
            3.0e-5,
            Vec3::new(500.0, 0.0, -6500.0),
            1.2,
        )],
    );
    let run = |chunks: &[u32]| {
        let (mut world, ids) = scene.build();
        let mut parts = WetParts::new(s.clone());
        for &n in chunks {
            parts.step_with(&mut world, &ids, n);
        }
        (parts, world)
    };
    let (parts, world) = run(&[480]);
    let (split, _) = run(&[100, 1, 379]);
    assert_eq!(parts.hash(), split.hash());
    assert_eq!(parts.steps(), 480);
    // The box fell onto the floor and its drops are on its faces, in its own space.
    let pose = world.pose(0).unwrap();
    assert!(pose.translation.z < 40.0, "{pose:?}");
    let w = &parts.weather()[0];
    assert!(w.drops.len() > 5, "{}", w.drops.len());
    for d in &w.drops {
        let q = d.1;
        let on = (q.x.abs() - 30.0).abs() < 1e-2
            || (q.y.abs() - 20.0).abs() < 1e-2
            || (q.z.abs() - 15.0).abs() < 1e-2;
        assert!(on, "a drop off the box's faces: {q:?}");
    }
    assert!(w.wet.iter().any(|&x| x));
}

// --- The studio floor ---------------------------------------------------------------------------

#[test]
fn the_studio_floor_gets_wet_and_dusty_at_its_rate_in_the_open_and_stays_dry_under_a_roof() {
    // Rain slow enough not to splash off the roof (K ≈ 50 at 2 m/s for 1 mm).
    let rain = source(
        PartsSourceKind::Drops,
        2.0e-5,
        Vec3::new(0.0, 0.0, -2000.0),
        1.0,
    );
    let dust = source(PartsSourceKind::Dust, 0.1, Vec3::new(0.0, 0.0, -200.0), 0.2);
    let snow = source(
        PartsSourceKind::Snow,
        2.0e-6,
        Vec3::new(0.0, 0.0, -1000.0),
        3.0,
    );
    let mut s = spec(
        vec![plate_mesh(100.0, 100.0, 1, 1)],
        vec![glass(
            0,
            Transform::translation(Vec3::new(-50.0, 0.0, 60.0)),
            NO_BODY,
        )],
        vec![rain, dust, snow],
    );
    s.extras.floor = Some(FloorSpec {
        z: 0.0,
        min: [-100.0, -40.0],
        max: [100.0, 40.0],
        cell_mm: 2.0,
        max_cells: 100_000,
    });
    let mut parts = WetParts::new(s.clone());
    let (nx, ny, cell) = parts.floor_cells().unwrap();
    assert_eq!((nx, ny, cell), (100, 40, 2.0));
    parts.step(240);
    let f = parts.floor_weather(0.5).unwrap();
    let (mut open, mut open_wet, mut roof_wet) = (0, 0, 0);
    for c in 0..(nx * ny) as usize {
        let x = -100.0 + ((c as u32 % nx) as f32 + 0.5) * cell;
        let wet = parts.floor_wet_step(c) != NEVER;
        if x > 5.0 {
            open += 1;
            open_wet += usize::from(wet);
            // Dust: 1 − e^(−k t), k = density × speed × π r² = 0.1 × 200 × π 0.01 per second.
            let k = 0.1 * 200.0 * std::f32::consts::PI * 0.01;
            let want = 1.0 - (-k).exp();
            assert!((f32::from(f.values[c][1]) / 255.0 - want).abs() < 2.0 / 255.0);
            assert!(f.values[c][2] > 0, "snow piles on it");
        } else if x < -5.0 {
            roof_wet += usize::from(wet);
            assert_eq!(f.values[c][1], 0, "no dust under the roof");
        }
    }
    // Each open cell wet at its first landing within the spread of a drop: 1 − e^(−rate t), rate
    // = density × speed × π (D)² (the landing spreads to two diameters).
    let rate = 2.0e-5 * 2000.0 * std::f32::consts::PI;
    let want = (1.0 - (-rate).exp()) * open as f32;
    let sigma = (want * (1.0 - want / open as f32)).sqrt();
    assert!(
        (open_wet as f32 - want).abs() < 4.0 * sigma + 2.0,
        "{open_wet} {want}"
    );
    assert_eq!(roof_wet, 0);
    // The layout carries the floor (its dimensions and its rates of dust and snow); the frames
    // list the cells as they get wet, by number.
    let mut by_frames = WetParts::new(s.clone());
    let mut without = s.clone();
    without.extras.floor = None;
    assert_eq!(
        by_frames.layout().len(),
        WetParts::new(without).layout().len() + 4 * (7 + 2 * (nx * ny) as usize)
    );
    let mut seen = std::collections::BTreeSet::new();
    for _ in 0..24 {
        by_frames.step(10);
        seen.extend(floor_block(&by_frames.frame()));
    }
    let wet: std::collections::BTreeSet<u32> = (0..(nx * ny))
        .filter(|&c| by_frames.floor_wet_step(c as usize) != NEVER)
        .collect();
    assert_eq!(seen, wet);
    assert_eq!(by_frames.hash(), parts.hash());
}

/// The cells of the floor's block of a frame's record (after the S3f shapes).
fn floor_block(rec: &[u8]) -> Vec<u32> {
    let w: Vec<u32> = rec
        .chunks_exact(4)
        .map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]]))
        .collect();
    let changed = w[0] as usize;
    let mut at = 1 + 7 * changed;
    for _ in 0..3 {
        at += 1 + w[at] as usize;
    }
    at += 2;
    at += 1 + 6 * w[at] as usize;
    assert_eq!(w[at] as usize, changed);
    at += 1 + 15 * changed;
    let n = w[at] as usize;
    assert_eq!(at + 1 + n, w.len());
    w[at + 1..].to_vec()
}

// --- Fine samples on the set's films ------------------------------------------------------------

#[test]
fn a_film_triangle_a_shadow_edge_crosses_takes_fine_samples_and_one_in_the_open_does_not() {
    // A set's card (600 mm square, two triangles, a film) under a box that shades part of it from
    // dust falling straight down; another card far away, all in the open.
    let dust = source(
        PartsSourceKind::Dust,
        1.0e-3,
        Vec3::new(0.0, 0.0, -200.0),
        0.2,
    );
    let card = |at: Vec3| WetPartSpec {
        mesh: 0,
        transform: Transform::translation(at),
        advancing_deg: 100.0,
        receding_deg: 20.0,
        soak_mm_s: 0.0,
        flags: PART_FILM,
        body: NO_BODY,
    };
    let mut s = spec(
        vec![
            plate_mesh(600.0, 600.0, 1, 1),
            parts_mesh(box_mesh(Vec3::new(40.0, 40.0, 40.0))),
        ],
        vec![
            card(Vec3::ZERO),
            card(Vec3::new(1500.0, 0.0, 0.0)),
            glass(
                1,
                Transform::translation(Vec3::new(0.0, 0.0, 60.0)),
                NO_BODY,
            ),
        ],
        vec![dust],
    );
    s.max_samples = 30_000;
    let coarse = WetParts::new(s.clone());
    assert!(coarse.resolution(0, 0) < 100, "{}", coarse.resolution(0, 0));
    assert_eq!(coarse.refined_triangles(), 0);
    s.extras.edge_cell_mm = 2.0;
    s.extras.edge_budget = 200_000;
    let fine = WetParts::new(s.clone());
    assert_eq!(fine.refined_triangles(), 2);
    // The diagonal of the card is 849 mm: 425 steps of 2 mm or more (two bytes each).
    for t in 0..2 {
        assert!(fine.resolution(0, t) >= 424, "{}", fine.resolution(0, t));
        assert_eq!(
            fine.resolution(1, t),
            coarse.resolution(1, t),
            "the open card"
        );
    }
    // Across the shadow's edge (x = 40, the box's side), the dust goes from none to all within one
    // step of the grid, at most 2 mm (the card's edge along X is 600 / R).
    let mut fine = fine;
    fine.step(240);
    let w = fine.weather();
    let w = &w[0];
    let r = u32::from(w.resolution[0]);
    let step = 600.0 / r as f32;
    assert!(step <= 2.0, "{step}");
    let mut row: Vec<(f32, f32)> = (0..fine.sample_count())
        .filter(|&s| fine.sample_part(s) == 0)
        .map(|s| (fine.sample_position(s), w.dust[s]))
        .filter(|(p, _)| p.y.abs() < 1.0 && p.x > 20.0 && p.x < 60.0)
        .map(|(p, d)| (p.x, d))
        .collect();
    row.sort_by(|a, b| a.0.total_cmp(&b.0));
    let last_dark = row
        .iter()
        .filter(|r| r.1 == 0.0)
        .map(|r| r.0)
        .fold(f32::MIN, f32::max);
    let first_lit = row
        .iter()
        .filter(|r| r.1 > 0.0)
        .map(|r| r.0)
        .fold(f32::MAX, f32::min);
    assert!(
        first_lit - last_dark <= 2.0 + 1e-3,
        "{last_dark} {first_lit}"
    );
    // The budget holds: a smaller one makes the refined cells coarser.
    s.extras.edge_budget = 20_000;
    let thrifty = WetParts::new(s.clone());
    let total: u32 = (0..2)
        .map(|t| {
            let r = thrifty.resolution(0, t);
            (r + 1) * (r + 2) / 2
        })
        .sum();
    assert!(total <= 20_000, "{total}");
    assert!(thrifty.resolution(0, 0) < fine.resolution(0, 0));
    // A spec of before (version 1) refines nothing and keeps its bytes.
    let mut old = s.clone();
    old.extras = PartsExtras::default();
    assert!(!old.needs_v2());
    assert_eq!(&old.to_bytes()[4..8], &1u32.to_le_bytes());
    assert_eq!(PartsSpec::parse(&s.to_bytes()), Ok(s.clone()));
    // Its weather is a two-byte one, and travels through RSB as WTP2.
    let pw = w.part_weather(0, 1.0).unwrap();
    assert!(pw.wide());
    let bytes = pw.encode();
    assert_eq!(rt_core::weather::PartWeather::decode_wide(&bytes), Ok(pw));
}

#[test]
fn a_spec_of_version_two_round_trips_and_bad_ones_are_refused() {
    let mut s = spec(
        vec![plate_mesh(10.0, 10.0, 1, 1)],
        vec![glass(0, Transform::IDENTITY, 3)],
        vec![source(
            PartsSourceKind::Drops,
            1e-5,
            Vec3::new(0.0, 0.0, -1.0),
            1.0,
        )],
    );
    s.extras = PartsExtras {
        wind: Vec3::new(1.0, 2.0, 0.0),
        floor: Some(FloorSpec {
            z: 0.0,
            min: [-1.0, -2.0],
            max: [3.0, 4.0],
            cell_mm: 0.5,
            max_cells: 1000,
        }),
        edge_cell_mm: 2.0,
        edge_budget: 5000,
    };
    let bytes = s.to_bytes();
    assert_eq!(&bytes[4..8], &2u32.to_le_bytes());
    assert_eq!(PartsSpec::parse(&bytes), Ok(s.clone()));
    assert!(PartsSpec::parse(&bytes[..bytes.len() - 4]).is_err());
    let mut bad = s.clone();
    bad.extras.floor.as_mut().unwrap().max = [-5.0, 4.0];
    assert!(PartsSpec::parse(&bad.to_bytes()).is_err());
    let mut bad = s.clone();
    bad.extras.edge_cell_mm = -1.0;
    assert!(PartsSpec::parse(&bad.to_bytes()).is_err());
    let mut bad = bytes.clone();
    bad[4] = 3;
    assert!(PartsSpec::parse(&bad).is_err());
}
