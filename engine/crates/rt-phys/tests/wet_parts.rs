//! S3c: rain, dust and snow on the parts ([`rt_phys::wet_parts`]). The criteria of the roadmap's S3
//! on a mesh: a drop on glass tilted 30° stays up to the critical radius of the table and slides past
//! it, down the slope, on the surface; two drops that touch sum their volumes (± 1 %); the trail
//! cleans the dust; the dust on a face at 60° is less than a tenth of the dust on a level one; the
//! rain lands at its flux and not where something is in the way; a drop under a face that looks down
//! drips once it is heavy enough, and one that runs off an open edge drips there, onto what is
//! below; a fast drop splashes and no water is lost on the way; a film part wets at its rate; the
//! snow piles where it can rest; determinism, by steps and through the frames the page records; the
//! pinned parts of the parity scene.

use rt_core::math::Vec3;
use rt_phys::example::{
    parts_spec, plate_mesh, wet_parts, DUST_REPOSE_DEG, GLASS_ADVANCING_DEG, GLASS_RECEDING_DEG,
    PARTS_STEPS, SNOW_REPOSE_DEG,
};
use rt_phys::math::Quat;
use rt_phys::wet_parts::{
    samples_of, PartsMesh, PartsSource, PartsSourceKind, PartsSpec, WetPartSpec, WetParts, NEVER,
    PART_FILM, PINCH_OFF_SHARE, PINCH_TIMES,
};
use rt_phys::Transform;

/// Pinned hash of the parity parts after [`PARTS_STEPS`] ([`WetParts::hash`]); the page's test with
/// the real `rt.wasm` (`tests/s3c-parts.test.ts`) checks the module against it.
const PINNED_WET_PARTS: u32 = 0xdc58_fa46;

/// A plate tilted `deg` about X (its slope runs down −Y for a positive angle) at `at`.
fn tilted(deg: f32, at: Vec3) -> Transform {
    Transform::from_pose(
        at,
        Quat::from_axis_angle(Vec3::new(1.0, 0.0, 0.0), deg.to_radians()),
    )
}

fn glass_part(mesh: u32, transform: Transform) -> WetPartSpec {
    WetPartSpec {
        mesh,
        transform,
        advancing_deg: GLASS_ADVANCING_DEG,
        receding_deg: GLASS_RECEDING_DEG,
        soak_mm_s: 0.0,
        flags: 0,
    }
}

fn spec(meshes: Vec<PartsMesh>, parts: Vec<WetPartSpec>, sources: Vec<PartsSource>) -> PartsSpec {
    PartsSpec {
        seed: 21,
        cell_mm: 1.0,
        max_samples: 400_000,
        repose_deg: DUST_REPOSE_DEG,
        snow_repose_deg: SNOW_REPOSE_DEG,
        meshes,
        parts,
        sources,
    }
}

fn rain(density: f32, velocity: Vec3, size: f32) -> PartsSource {
    PartsSource {
        kind: PartsSourceKind::Drops,
        density,
        velocity,
        size_mm: size,
        size_var: 0.0,
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

/// The volume over the cube of the contact radius of a cap at `deg`, in `f64`.
fn cap_factor(deg: f64) -> f64 {
    let t = deg.to_radians();
    std::f64::consts::PI * (2.0 - 3.0 * t.cos() + t.cos().powi(3)) / (3.0 * t.sin().powi(3))
}

/// The critical contact radius from the tangent balance, in `f64` and SI units.
fn furmidge_radius_mm(alpha_deg: f64) -> f64 {
    let (gamma, rho, g) = (0.072, 1000.0, 9.81);
    let (ta, tr) = (
        f64::from(GLASS_ADVANCING_DEG),
        f64::from(GLASS_RECEDING_DEG),
    );
    let hysteresis = tr.to_radians().cos() - ta.to_radians().cos();
    let k = cap_factor(0.5 * (ta + tr));
    (2.0 * gamma * hysteresis / (rho * g * k * alpha_deg.to_radians().sin())).sqrt() * 1000.0
}

/// The volume of a drop of contact radius `a` on glass, mm³.
fn glass_volume(a: f64) -> f32 {
    (cap_factor(0.5 * f64::from(GLASS_ADVANCING_DEG + GLASS_RECEDING_DEG)) * a * a * a) as f32
}

#[test]
fn a_spec_round_trips_and_bad_ones_are_refused() {
    let spec = parts_spec();
    let bytes = spec.to_bytes();
    assert_eq!(PartsSpec::parse(&bytes), Ok(spec.clone()));
    assert!(PartsSpec::parse(&bytes[..bytes.len() - 4]).is_err());
    let mut longer = bytes.clone();
    longer.extend_from_slice(&[0; 4]);
    assert!(PartsSpec::parse(&longer).is_err());
    assert!(PartsSpec::parse(b"WPT2").is_err());
    let mut bad = spec.clone();
    bad.meshes[0].indices[0] = 9999;
    assert!(PartsSpec::parse(&bad.to_bytes()).is_err());
    let mut bad = spec.clone();
    bad.parts[0].mesh = 7;
    assert!(PartsSpec::parse(&bad.to_bytes()).is_err());
    let mut bad = spec.clone();
    bad.sources[0].size_var = 2.0;
    assert!(PartsSpec::parse(&bad.to_bytes()).is_err());
    let mut bad = spec;
    bad.cell_mm = 0.0;
    assert!(PartsSpec::parse(&bad.to_bytes()).is_err());
}

#[test]
fn the_samples_cover_every_triangle_and_keep_under_the_budget() {
    let one = spec(
        vec![plate_mesh(100.0, 50.0, 4, 2)],
        vec![glass_part(0, Transform::IDENTITY)],
        vec![],
    );
    let parts = WetParts::new(one.clone());
    // 25 mm by 25 mm quads: the triangles' longest edge is the diagonal, 35.4 mm: 36 steps of 1 mm.
    assert_eq!(parts.resolution(0, 0), 36);
    assert_eq!(parts.sample_count(), 16 * samples_of(36) as usize);
    // A budget of 2 000 makes the cells coarser.
    let small = WetParts::new(PartsSpec {
        max_samples: 2000,
        ..one
    });
    assert!(small.sample_count() <= 2000);
    assert!(small.cell_mm() > 1.0);
    // A sample of triangle 0 at (i, j) = (R, 0) is its corner 1.
    let r = small.resolution(0, 0) as usize;
    let corner = small.sample_position(r);
    assert!(
        (corner - Vec3::new(-25.0, -25.0, 0.0)).length() < 1e-3,
        "{corner:?}"
    );
}

#[test]
fn a_sliver_spends_samples_by_its_area_and_a_film_part_keeps_to_a_third() {
    // A strip 400 mm long and 1 mm wide, two triangles (a slice of a backdrop's cove): its longest
    // edge would give 400 steps; its area, 200 mm², gives 2√200 = 28.3: 29 steps of 1 mm.
    let strip = PartsMesh {
        positions: vec![
            Vec3::new(0.0, 0.0, 0.0),
            Vec3::new(400.0, 0.0, 0.0),
            Vec3::new(400.0, 1.0, 0.0),
            Vec3::new(0.0, 1.0, 0.0),
        ],
        indices: vec![0, 1, 2, 0, 2, 3],
    };
    let one = WetParts::new(spec(
        vec![strip],
        vec![glass_part(0, Transform::IDENTITY)],
        vec![],
    ));
    assert_eq!(one.resolution(0, 0), 29);
    assert_eq!(one.cell_mm(), 1.0);
    // A product beside a set whose film would take every sample at the product's cell: the film
    // keeps to a third of the budget, the product's cell stays fine.
    let mut film = glass_part(1, Transform::IDENTITY);
    film.flags = PART_FILM;
    let both = WetParts::new(PartsSpec {
        max_samples: 30_000,
        ..spec(
            vec![
                plate_mesh(50.0, 50.0, 2, 2),
                plate_mesh(2000.0, 2000.0, 8, 8),
            ],
            vec![glass_part(0, Transform::IDENTITY), film],
            vec![],
        )
    });
    let on = |part: usize| {
        (0..both.sample_count())
            .filter(|&s| both.sample_part(s) == part)
            .count()
    };
    assert!(on(1) <= 10_000, "{}", on(1));
    assert!(on(0) + on(1) <= 30_000);
    // 25 mm quads, diagonal 35.4 mm: the product keeps its 1 mm cell.
    assert_eq!(both.resolution(0, 0), 36);
    assert_eq!(both.cell_mm(), 1.0);
}

#[test]
fn a_drop_on_glass_tilted_30_degrees_stays_up_to_its_critical_radius_and_slides_past_it() {
    let crit = furmidge_radius_mm(30.0);
    let crit_engine = rt_phys::wet::critical_radius(GLASS_ADVANCING_DEG, GLASS_RECEDING_DEG, 0.5);
    assert!(
        (f64::from(crit_engine) / crit - 1.0).abs() < 0.005,
        "{crit_engine} vs {crit}"
    );
    let plate = spec(
        vec![plate_mesh(200.0, 200.0, 8, 8)],
        vec![glass_part(0, tilted(30.0, Vec3::ZERO))],
        vec![],
    );
    for (factor, slides) in [(0.97, false), (0.995, false), (1.005, true), (1.05, true)] {
        let mut parts = WetParts::new(plate.clone());
        // A triangle in the middle of the plate.
        parts.add_drop(0, 2 * (4 * 8 + 4), 0.3, 0.3, glass_volume(crit * factor));
        let before = parts.drops()[0].2;
        let water = parts.water();
        parts.step(240);
        let after = parts.drops()[0].2;
        let moved = (after - before).length();
        assert_eq!(moved > 0.1, slides, "{factor}: moved {moved} mm");
        // The trail takes a film of 2 µm as wide as the drop for every millimetre it runs.
        let a = parts.drops()[0].3;
        let film = 0.002 * 2.0 * a * moved;
        assert!(
            (parts.water_shed() - film).abs() <= 0.02 * film + 1e-6,
            "{} vs {film}",
            parts.water_shed()
        );
        assert!((water - parts.water() - parts.water_shed()).abs() < 1e-3 * water);
        if slides {
            // Down the slope, on the surface: the plate's −Y tilted 30° down.
            let way = (after - before) / moved;
            let down = Vec3::new(
                0.0,
                -(30f32.to_radians().cos()),
                -(30f32.to_radians().sin()),
            );
            assert!(way.dot(down) > 0.999, "{way:?}");
            let normal = Vec3::new(0.0, -(30f32.to_radians().sin()), 30f32.to_radians().cos());
            assert!(
                after.dot(normal).abs() < 1e-3,
                "off the plate by {}",
                after.dot(normal)
            );
        }
    }
}

#[test]
fn a_sliding_drop_follows_the_surface_from_face_to_face() {
    // A roof ridge: from 20° on one side to 60° on the other, one mesh (shared edge along X at y = 0).
    let mut m = PartsMesh::default();
    let (s20, c20) = (20f32.to_radians().sin(), 20f32.to_radians().cos());
    let (s60, c60) = (60f32.to_radians().sin(), 60f32.to_radians().cos());
    for x in [-50.0f32, 50.0] {
        m.positions
            .push(Vec3::new(x, 80.0 * c20, 80.0 * s20 + 100.0));
        m.positions.push(Vec3::new(x, 0.0, 100.0));
        m.positions
            .push(Vec3::new(x, -80.0 * c60, 100.0 - 80.0 * s60));
    }
    // Corners (x−) 0 1 2, (x+) 3 4 5; the upper face 0-1 / 3-4, the steep one 1-2 / 4-5, facing +Z.
    m.indices = vec![0, 1, 4, 0, 4, 3, 1, 2, 5, 1, 5, 4];
    let mut parts = WetParts::new(spec(
        vec![m],
        vec![glass_part(0, Transform::IDENTITY)],
        vec![],
    ));
    let a = furmidge_radius_mm(20.0) * 1.3;
    parts.add_drop(0, 0, 0.2, 0.3, glass_volume(a));
    let start = parts.drops()[0].2;
    let mut last = start;
    let mut crossed = false;
    for _ in 0..400 {
        parts.step(12);
        let Some(d) = parts.drops().first().copied() else {
            break;
        };
        // Always on one of the two faces, always going down.
        let on_upper = d.2.y >= -1e-3;
        let normal = if on_upper {
            Vec3::new(0.0, -s20, c20)
        } else {
            Vec3::new(0.0, -s60, c60)
        };
        assert!(
            (d.2 - Vec3::new(0.0, 0.0, 100.0)).dot(normal).abs() < 1e-2,
            "{d:?}"
        );
        // S3f: always going down, but once it hangs at the edge (where the centre of a merge may
        // relax back up towards the centre of volume).
        let held = parts.drop_states()[0].edge;
        assert!(held || d.2.z <= last.z + 1e-4);
        crossed |= d.1 >= 2;
        last = d.2;
    }
    assert!(crossed, "the drop never reached the steep face: {last:?}");
    // S3f: it reached the open lower edge of the steep face and hangs there (S3c and S3d ran it off
    // the edge as a drip): far too light for its contact line to let go. Running fast down the
    // steep face it left the beads of a rivulet behind it, on its path, smaller.
    assert_eq!(parts.counts().2, 0);
    let held = parts.drop_states();
    let edge: Vec<_> = held.iter().filter(|d| d.edge).collect();
    assert_eq!(edge.len(), 1, "{held:?}");
    assert!(
        (edge[0].p.z - (100.0 - 80.0 * s60)).abs() < 0.05,
        "{held:?}"
    );
    assert!(
        held.iter().all(|d| d.edge || d.a < 0.5 * edge[0].a),
        "{held:?}"
    );
}

#[test]
fn two_drops_that_touch_merge_into_their_summed_volume() {
    let mut parts = WetParts::new(spec(
        vec![plate_mesh(100.0, 100.0, 4, 4)],
        vec![glass_part(0, Transform::IDENTITY)],
        vec![],
    ));
    parts.add_drop(0, 10, 0.3, 0.3, 4.0);
    parts.add_drop(0, 10, 0.32, 0.33, 2.5);
    parts.add_drop(0, 2, 0.3, 0.3, 1.0);
    let before: Vec<_> = parts.drops();
    let water = parts.water();
    // A level plate: nothing slides; the drops put by hand merge at the next step.
    parts.step(1);
    let after = parts.drops();
    assert_eq!(after.len(), 2, "{after:?}");
    assert!((parts.water() / water - 1.0).abs() < 0.01);
    // S3f: the survivor stays where it was, and relaxes to the centre of volume of the two over the
    // next steps (S3c put it there at once).
    let centre = (before[0].2 * 4.0 + before[1].2 * 2.5) / 6.5;
    let offset = (centre - before[0].2).length();
    assert!(offset > 0.1, "{offset}");
    assert!((after[0].2 - before[0].2).length() < 1e-4, "{after:?}");
    parts.step(120);
    let after = parts.drops();
    assert!(
        (after[0].2 - centre).length() <= 0.011 * offset + 1e-4,
        "{:?} vs {centre:?}",
        after[0].2
    );
    assert!((parts.water() / water - 1.0).abs() < 1e-5);
}

#[test]
fn the_trail_wipes_the_dust_and_the_rain_leaves_less_of_it() {
    let dust = source(
        PartsSourceKind::Dust,
        2.0e-2,
        Vec3::new(0.0, 0.0, -100.0),
        0.1,
    );
    let plate = |sources| {
        spec(
            vec![plate_mesh(120.0, 120.0, 6, 6)],
            vec![glass_part(0, tilted(30.0, Vec3::ZERO))],
            sources,
        )
    };
    let mut parts = WetParts::new(plate(vec![dust]));
    parts.step(240);
    let a = furmidge_radius_mm(30.0) * 1.5;
    parts.add_drop(0, 2 * (6 * 4 + 3), 0.3, 0.3, glass_volume(a));
    let x = parts.drops()[0].2.x;
    parts.step(240);
    // Down the band the drop ran in, no dust; beside it, the dust of two seconds.
    let (mut band, mut aside) = (Vec::new(), Vec::new());
    for s in 0..parts.sample_count() {
        let p = parts.sample_position(s);
        if parts.wet_step(s) != NEVER {
            band.push(parts.dust_at(s));
        } else if (p.x - x).abs() > 10.0 {
            aside.push(parts.dust_at(s));
        }
    }
    assert!(!band.is_empty() && !aside.is_empty());
    let mean = |v: &[f32]| v.iter().sum::<f32>() / v.len() as f32;
    assert!(mean(&aside) > 0.0);
    assert!(
        mean(&band) < 0.6 * mean(&aside),
        "{} vs {}",
        mean(&band),
        mean(&aside)
    );
    // Rain on the same plate leaves less dust than none.
    let mut dry = WetParts::new(plate(vec![dust]));
    let mut rained = WetParts::new(plate(vec![
        dust,
        rain(1.0e-5, Vec3::new(0.0, 0.0, -6500.0), 1.6),
    ]));
    dry.step(960);
    rained.step(960);
    let total = |p: &WetParts| (0..p.sample_count()).map(|s| p.dust_at(s)).sum::<f32>();
    assert!(
        total(&rained) < 0.9 * total(&dry),
        "{} vs {}",
        total(&rained),
        total(&dry)
    );
}

#[test]
fn dust_rests_where_the_face_is_flat_enough_and_in_the_open() {
    let down = Vec3::new(0.0, 0.0, -100.0);
    let at = |deg: f32| {
        let mut p = WetParts::new(spec(
            vec![plate_mesh(40.0, 40.0, 2, 2)],
            vec![glass_part(0, tilted(deg, Vec3::ZERO))],
            vec![source(PartsSourceKind::Dust, 1.0e-3, down, 0.2)],
        ));
        p.step(2400);
        let n = p.sample_count();
        (0..n).map(|s| p.dust_at(s)).sum::<f32>() / n as f32
    };
    let (level, thirty, sixty) = (at(0.0), at(30.0), at(60.0));
    assert!(level > 0.0);
    assert!(sixty < 0.1 * level, "{sixty} vs {level}");
    // Below the repose, the flux through the face: its cosine (with a little less, as 1 − e^−kt).
    assert!(
        (thirty / level / 30f32.to_radians().cos() - 1.0).abs() < 0.1,
        "{thirty} vs {level}"
    );
    // Face down: none.
    assert_eq!(at(180.0), 0.0);
    // Under a roof: none where the roof is in the way.
    let mut roofed = WetParts::new(spec(
        vec![plate_mesh(40.0, 40.0, 4, 4), plate_mesh(20.0, 40.0, 1, 1)],
        vec![
            glass_part(0, Transform::IDENTITY),
            glass_part(1, Transform::translation(Vec3::new(10.0, 0.0, 30.0))),
        ],
        vec![source(PartsSourceKind::Dust, 1.0e-3, down, 0.2)],
    ));
    roofed.step(240);
    for s in 0..roofed.sample_count() {
        let p = roofed.sample_position(s);
        if roofed.sample_part(s) == 0 && p.x > 0.5 && p.x < 19.5 && p.y.abs() < 19.5 {
            assert_eq!(roofed.dust_at(s), 0.0, "{p:?}");
        }
        if roofed.sample_part(s) == 0 && p.x < -0.5 {
            assert!(roofed.dust_at(s) > 0.0, "{p:?}");
        }
    }
}

#[test]
fn rain_lands_at_its_flux_and_never_where_something_is_in_the_way() {
    // 1e-5 drops per mm³ at 5 m/s on a 100 × 100 mm level plate for a second: 50 000 × 1e-5 ×
    // 5000 / 50... λ = n v A t = 1e-5 × 5000 × 1e4 × 1 = 500.
    let mut parts = WetParts::new(spec(
        vec![plate_mesh(100.0, 100.0, 5, 5)],
        vec![glass_part(0, Transform::IDENTITY)],
        vec![rain(1.0e-5, Vec3::new(0.0, 0.0, -5000.0), 0.2)],
    ));
    parts.step(240);
    let landed = parts.counts().0 as f32;
    assert!((landed - 500.0).abs() < 4.0 * 500f32.sqrt(), "{landed}");
    // Drops of 0.2 mm at 5 m/s: K = 47, below the threshold, no splash.
    assert_eq!(parts.counts().1, 0);
    // Moving away from the face: nothing.
    let mut away = WetParts::new(spec(
        vec![plate_mesh(100.0, 100.0, 5, 5)],
        vec![glass_part(0, Transform::IDENTITY)],
        vec![rain(1.0e-5, Vec3::new(0.0, 0.0, 5000.0), 0.2)],
    ));
    away.step(240);
    assert_eq!(away.counts().0, 0);
    // Under a roof: no drop lands where the roof covers.
    let mut roofed = WetParts::new(spec(
        vec![
            plate_mesh(100.0, 100.0, 5, 5),
            plate_mesh(50.0, 100.0, 1, 1),
        ],
        vec![
            glass_part(0, Transform::IDENTITY),
            glass_part(1, Transform::translation(Vec3::new(25.0, 0.0, 30.0))),
        ],
        vec![rain(1.0e-5, Vec3::new(0.0, 0.0, -5000.0), 0.2)],
    ));
    roofed.step(240);
    let under: Vec<_> = roofed
        .drops()
        .into_iter()
        .filter(|d| d.0 == 0 && d.2.x > 1.0)
        .collect();
    assert!(under.is_empty(), "{under:?}");
    assert!(roofed.drops().iter().any(|d| d.0 == 0 && d.2.x < -1.0));
    assert!(roofed.drops().iter().any(|d| d.0 == 1));
}

#[test]
fn a_hanging_drop_drips_once_it_is_heavy_enough_onto_what_is_below() {
    // A ceiling (facing down) 50 mm above a floor plate.
    let mut ceiling = plate_mesh(60.0, 60.0, 2, 2);
    ceiling
        .indices
        .chunks_exact_mut(3)
        .for_each(|t| t.swap(1, 2));
    let scene = spec(
        vec![ceiling, plate_mesh(200.0, 200.0, 4, 4)],
        vec![
            glass_part(0, Transform::translation(Vec3::new(0.0, 0.0, 50.0))),
            glass_part(1, Transform::IDENTITY),
        ],
        vec![],
    );
    // Its hold: 2π a γ sin θ̄ against ρ g V: at 60° a contact radius of about 6.3 mm.
    let (gamma, rho_g) = (7.2e-5f64, 9.81e-6f64);
    let k = cap_factor(60.0);
    let a_crit =
        (2.0 * std::f64::consts::PI * gamma * 60f64.to_radians().sin() / (rho_g * k)).sqrt();
    for (factor, drips) in [(0.95, false), (1.05, true)] {
        let mut parts = WetParts::new(scene.clone());
        let total = glass_volume(a_crit * factor);
        parts.add_drop(0, 0, 0.3, 0.3, total);
        // S3f: it necks before it lets go: nothing falls before its pinch time, PINCH_TIMES
        // capillary times √(ρ a³ / γ).
        let a = a_crit * factor;
        let pinch =
            (f64::from(PINCH_TIMES) * (1.0e-6 * a * a * a / 0.072).sqrt() * 240.0).ceil() as u32;
        parts.step(pinch - 2);
        assert_eq!(parts.counts().2, 0, "{factor}");
        assert_eq!(parts.drop_states()[0].pinch > 0.5, drips, "{factor}");
        parts.step(4);
        assert_eq!(parts.counts().2 == 1, drips, "{factor}");
        if !drips {
            parts.step(46);
            assert_eq!(parts.counts().2, 0);
            assert!(parts.falling().is_empty());
            assert_eq!(parts.drops().len(), 1);
            continue;
        }
        // One drop in the air of PINCH_OFF_SHARE of the water (Harkins and Brown: about 60 % of a
        // pendant drop falls); the rest stays on the ceiling where it hung.
        assert_eq!(parts.falling().len(), 1, "{factor}");
        let off = PINCH_OFF_SHARE * total;
        let rest = parts.drop_states();
        assert_eq!(rest.len(), 1, "{rest:?}");
        assert_eq!(rest[0].part, 0);
        assert!(
            (rest[0].volume / (total - off) - 1.0).abs() < 1e-4,
            "{rest:?}"
        );
        // S3d: the drip is in the air, not yet on the floor: it falls the 44 mm in about 0.095 s
        // (√(2 h / g)), some 23 steps.
        let mut fell = 0;
        let mut last_z = f32::INFINITY;
        while parts.drops().iter().all(|d| d.0 != 1) && fell < 60 {
            let (part, p, r) = parts.falling()[0];
            assert_eq!(part, 0, "it left the ceiling");
            assert!(p.z < last_z, "it falls: {p:?}");
            assert!((r - 0.5 * (6.0 * off / std::f32::consts::PI).cbrt()).abs() < 1e-3);
            last_z = p.z;
            parts.step(1);
            fell += 1;
        }
        assert!((20..=26).contains(&fell), "{fell} steps in the air");
        assert_eq!(parts.landed_from_air(), 1);
        // The water is on the parts or in the air, but for what the splash threw off the plate.
        assert!(parts.water() + parts.water_in_air() + parts.water_lost() > 0.999 * total);
        assert!(parts.drops().iter().all(|d| d.0 == 0 || d.2.z.abs() < 1e-3));
        // A drop of 6.9 mm falling 44 mm meets the floor at √(2 g h) ≈ 0.93 m/s: K ≈ 81, it splashes.
        assert_eq!(parts.counts().1, 1);
        // Its two drops fly from the next step, and land on the floor too.
        assert_eq!(parts.falling().len(), 2);
        parts.step(48);
        assert!(parts.falling().is_empty());
        assert_eq!(parts.landed_from_air(), 3);
        assert!(parts.water() + parts.water_lost() > 0.999 * total);
        // What stayed is held, and grows again: fed back past its hold, it lets go once more.
        parts.step(100);
        assert_eq!(parts.counts().2, 1);
        parts.add_drop(0, 0, 0.3, 0.3, 0.7 * total);
        parts.step(2 * pinch);
        assert_eq!(parts.counts().2, 2);
    }
    // From 5 mm it lands at 0.3 m/s (K ≈ 24) and stays whole.
    let mut low = scene.clone();
    low.parts[0].transform = Transform::translation(Vec3::new(0.0, 0.0, 12.0));
    let mut parts = WetParts::new(low);
    let total = glass_volume(a_crit * 1.05);
    parts.add_drop(0, 0, 0.3, 0.3, total);
    parts.step(80);
    assert_eq!(parts.counts(), (0, 0, 1));
    assert_eq!(parts.drops().len(), 2);
    assert!((parts.water() / total - 1.0).abs() < 1e-4);
}

#[test]
fn a_drop_in_the_air_falls_at_most_at_its_terminal_speed_and_is_gone_below_the_floor() {
    use rt_phys::wet_parts::terminal_speed;
    // Atlas, Srivastava and Sekhon (1973) at 2 mm: 9.65 − 10.3 e^−1.2 = 6.55 m/s.
    assert!(
        (terminal_speed(2.0) - 6547.8).abs() < 1.0,
        "{}",
        terminal_speed(2.0)
    );
    // Below 0.6 mm, a line through 0: a drop of 0.3 mm at half of 0.6 mm's.
    assert!((terminal_speed(0.3) - 0.5 * terminal_speed(0.6)).abs() < 1e-3);
    // A drop of 2 mm let go 20 m above a plate: it speeds up to its terminal speed, never past it.
    let mut parts = WetParts::new(spec(
        vec![plate_mesh(100.0, 100.0, 1, 1)],
        vec![glass_part(0, Transform::IDENTITY)],
        vec![],
    ));
    let volume = std::f32::consts::PI / 6.0 * 8.0;
    parts.add_falling(0, Vec3::new(0.0, 0.0, 20_000.0), Vec3::ZERO, volume);
    let mut top = 0.0f32;
    for _ in 0..240 * 3 {
        parts.step(1);
        let Some(&v) = parts.falling_velocities().first() else {
            break;
        };
        top = top.max(v.length());
    }
    assert!(top <= terminal_speed(2.0) * 1.0001, "{top}");
    assert!(top > terminal_speed(2.0) * 0.99, "{top}");
    // One that misses every part is gone below the floor (z = 0, the lowest of the parts and it).
    parts.add_falling(0, Vec3::new(500.0, 0.0, 100.0), Vec3::ZERO, volume);
    let lost = parts.water_lost();
    parts.step(240);
    assert!(parts.falling().is_empty());
    assert!((parts.water_lost() - lost - volume).abs() < 1e-4);
}

#[test]
fn a_splash_throws_its_drops_through_the_air_to_land_within_its_reach() {
    // One drop of 2.5 mm at 9 m/s onto a level plate: K about 650, it splashes. It lands on a
    // pad of 2 mm (part 0) a hair above a large plate (part 1), so that the drops it throws land on
    // another part than its own and none merges with it.
    let mut parts = WetParts::new(spec(
        vec![plate_mesh(2.0, 2.0, 1, 1), plate_mesh(300.0, 300.0, 6, 6)],
        vec![
            glass_part(0, Transform::translation(Vec3::new(10.0, -20.0, 0.0))),
            glass_part(1, Transform::translation(Vec3::new(0.0, 0.0, -0.01))),
        ],
        vec![],
    ));
    let volume = std::f32::consts::PI / 6.0 * 2.5f32.powi(3);
    parts.add_falling(
        0,
        Vec3::new(10.0, -20.0, 20.0),
        Vec3::new(0.0, 0.0, -9000.0),
        volume,
    );
    // The step it lands in.
    while parts.landed_from_air() == 0 {
        parts.step(1);
    }
    assert_eq!(parts.counts(), (0, 1, 0));
    let landing = parts.drops()[0].2;
    assert!((landing - Vec3::new(10.0, -20.0, 0.0)).length() < 1e-3);
    // Its two drops are in the air, above the plate, and none landed in the step it splashed.
    let thrown = parts.falling();
    assert_eq!(thrown.len(), 2);
    assert_eq!(parts.drops().len(), 1);
    assert_eq!(parts.landed_from_air(), 1);
    let mut highest = 0.0f32;
    let mut steps = 0;
    while !parts.falling().is_empty() && steps < 240 {
        for f in parts.falling() {
            assert!(f.1.z >= 0.0, "{f:?}");
            highest = highest.max(f.1.z);
        }
        parts.step(1);
        steps += 1;
    }
    assert!(highest > 0.1, "they fly: {highest}");
    assert!(steps >= 2, "they land later: {steps}");
    assert_eq!(parts.landed_from_air(), 3);
    assert!((parts.water() / volume - 1.0).abs() < 1e-4, "no water lost");
    // They land between one diameter and the reach of the splash (◆: up to 4 diameters), each a
    // drop of its own on the plate.
    let others: Vec<_> = parts.drops().iter().filter(|d| d.0 == 1).copied().collect();
    assert_eq!(others.len(), 2, "{:?}", parts.drops());
    for d in others {
        let r = (d.2 - landing).length();
        assert!((0.8 * 2.5..=4.0 * 2.5).contains(&r), "{r} mm");
    }
}

#[test]
fn a_fast_drop_splashes_and_no_water_is_lost_on_the_way() {
    // Drops of 2.5 mm at 9 m/s (K about 650: every one splashes), few enough not to touch.
    let mut parts = WetParts::new(spec(
        vec![plate_mesh(300.0, 300.0, 6, 6)],
        vec![glass_part(0, Transform::IDENTITY)],
        vec![rain(1.0e-8, Vec3::new(0.0, 0.0, -9000.0), 2.5)],
    ));
    parts.step(480);
    let (landed, splashes, _) = parts.counts();
    assert!(landed > 5, "{landed}");
    assert_eq!(splashes, landed);
    // Every drop that landed is on the plate, merged, in the air, or was thrown off its edge.
    let each = std::f32::consts::PI / 6.0 * 2.5f32.powi(3);
    let total = each * landed as f32;
    let seen = parts.water() + parts.water_in_air() + parts.water_lost() + parts.water_shed();
    assert!((seen / total - 1.0).abs() < 1e-3, "{seen} vs {total}");
    // S3d: let the last thrown drops land.
    parts.step(48);
    let (landed, _, _) = parts.counts();
    let total = each * landed as f32;
    let seen = parts.water() + parts.water_in_air() + parts.water_lost() + parts.water_shed();
    assert!((seen / total - 1.0).abs() < 1e-3, "{seen} vs {total}");
    // Each landing left a drop of 70 % of its volume and threw two of 15 % each.
    let volumes: Vec<f32> = parts
        .drops()
        .iter()
        .map(|d| glass_volume(f64::from(d.3)))
        .collect();
    let big: Vec<f32> = volumes
        .iter()
        .copied()
        .filter(|&v| v > 0.69 * each)
        .collect();
    let small = volumes
        .iter()
        .filter(|&&v| (v / (0.15 * each) - 1.0).abs() < 0.01)
        .count();
    // (A thrown drop may land on another drop and merge with it: a big one with thrown ones on it
    // is 70 % and some 15 %s.)
    let merged: usize = big
        .iter()
        .map(|&v| ((v - 0.7 * each) / (0.15 * each)).round() as usize)
        .sum();
    assert!(big.len() + 2 >= landed as usize, "{volumes:?}");
    assert!(small + merged >= landed as usize, "{volumes:?}");
}

#[test]
fn a_film_part_wets_at_its_rate_without_drops() {
    let mut part = glass_part(0, Transform::IDENTITY);
    part.flags = PART_FILM;
    let mut parts = WetParts::new(spec(
        vec![plate_mesh(100.0, 100.0, 4, 4)],
        vec![part],
        vec![rain(2.0e-6, Vec3::new(0.0, 0.0, -5000.0), 1.0)],
    ));
    // A sample's rate: n v × π (spread D / 2)² = 2e-6 × 5000 × π = 0.0314 per second.
    parts.step(240 * 20);
    assert!(parts.drops().is_empty());
    let n = parts.sample_count();
    let wet = (0..n).filter(|&s| parts.wet_step(s) != NEVER).count() as f32 / n as f32;
    let want = 1.0 - (-0.0314f32 * 20.0).exp();
    assert!((wet - want).abs() < 0.03, "{wet} vs {want}");
}

#[test]
fn snow_piles_where_it_can_rest() {
    let at = |deg: f32| {
        let mut p = WetParts::new(spec(
            vec![plate_mesh(40.0, 40.0, 2, 2)],
            vec![glass_part(0, tilted(deg, Vec3::ZERO))],
            vec![source(
                PartsSourceKind::Snow,
                1.0e-6,
                Vec3::new(0.0, 0.0, -1000.0),
                4.0,
            )],
        ));
        p.step(2400);
        let n = p.sample_count();
        (0..n).map(|s| p.snow_at(s)).sum::<f32>() / n as f32
    };
    // n v × π/6 D³ / packing for 10 s: 1e-6 × 1000 × 33.5 / 0.5 × 10 = 0.67 mm.
    let level = at(0.0);
    assert!((level / 0.67 - 1.0).abs() < 0.01, "{level}");
    assert_eq!(at(70.0), 0.0);
    // Snow does not slide: the same at 30°, by its cosine.
    assert!((at(30.0) / level / 30f32.to_radians().cos() - 1.0).abs() < 0.01);
}

#[test]
fn the_same_parts_by_steps_and_through_the_frames() {
    let mut once = WetParts::new(parts_spec());
    let mut parts = WetParts::new(parts_spec());
    once.step(240);
    for _ in 0..10 {
        parts.step(24);
    }
    assert_eq!(once.hash(), parts.hash());
    // The frames say every sample that got wet, once, and the drops of the end: what changed and
    // what went, by number.
    let mut framed = WetParts::new(parts_spec());
    let layout = framed.layout();
    assert_eq!(u32::from_le_bytes(layout[0..4].try_into().unwrap()), 4);
    let mut wet = vec![false; framed.sample_count()];
    let mut drops: std::collections::BTreeMap<u32, (u32, u32, [u32; 4])> = Default::default();
    let mut shapes: std::collections::BTreeMap<u32, Vec<u32>> = Default::default();
    let mut flown = 0;
    for _ in 0..10 {
        framed.step(24);
        let rec = framed.frame();
        let w = |i: usize| u32::from_le_bytes(rec[4 * i..4 * i + 4].try_into().unwrap());
        let nc = w(0) as usize;
        for k in 0..nc {
            let at = 1 + 7 * k;
            drops.insert(
                w(at),
                (
                    w(at + 1),
                    w(at + 2),
                    [w(at + 3), w(at + 4), w(at + 5), w(at + 6)],
                ),
            );
        }
        let mut at = 1 + 7 * nc;
        let ng = w(at) as usize;
        for k in 0..ng {
            drops.remove(&w(at + 1 + k));
        }
        at += 1 + ng;
        let nw = w(at) as usize;
        for k in 0..nw {
            let s = w(at + 1 + k) as usize;
            assert!(!wet[s], "sample {s} wet twice");
            wet[s] = true;
        }
        at += 1 + nw;
        let nx = w(at) as usize;
        at += 1 + nx;
        assert_eq!(w(at + 1) as usize, drops.len(), "the count of drops");
        // S3d: the drops in the air, whole, by number: what the parts give.
        at += 2;
        let nf = w(at) as usize;
        let falling = framed.falling();
        assert_eq!(nf, falling.len());
        for (k, (part, p, r)) in falling.iter().enumerate() {
            let f = at + 1 + 6 * k;
            assert!(!drops.contains_key(&w(f)), "a number of its own");
            assert!(k == 0 || w(f) > w(f - 6), "by number");
            assert_eq!(w(f + 1), *part);
            assert_eq!(
                [w(f + 2), w(f + 3), w(f + 4), w(f + 5)],
                [p.x.to_bits(), p.y.to_bits(), p.z.to_bits(), r.to_bits()]
            );
        }
        flown += nf;
        // S3f: the shapes of the changed drops, in their order.
        at += 1 + 6 * nf;
        assert_eq!(w(at) as usize, nc, "a shape per changed drop");
        let ids: Vec<u32> = (0..nc).map(|k| w(1 + 7 * k)).collect();
        for (k, id) in ids.iter().enumerate() {
            let f: Vec<u32> = (0..15).map(|c| w(at + 1 + 15 * k + c)).collect();
            shapes.insert(*id, f);
        }
        for id in drops.keys() {
            assert!(shapes.contains_key(id));
        }
        assert_eq!(4 * (at + 1 + 15 * nc), rec.len());
    }
    assert!(flown > 0, "drops were in the air in some frame");
    for (s, &w) in wet.iter().enumerate() {
        assert_eq!(w, framed.wet_step(s) != NEVER, "{s}");
    }
    // The drops rebuilt from the frames are the parts' weather, part by part, by number.
    let weather = framed.weather();
    for (part, w) in weather.iter().enumerate() {
        let mine: Vec<_> = drops.iter().filter(|d| d.1 .0 == part as u32).collect();
        assert_eq!(mine.len(), w.drops.len());
        assert_eq!(w.shapes.len(), w.drops.len());
        for ((id, d), ((tri, p, a), shape)) in mine.iter().zip(w.drops.iter().zip(&w.shapes)) {
            assert_eq!(d.1, *tri);
            assert_eq!(
                d.2,
                [p.x.to_bits(), p.y.to_bits(), p.z.to_bits(), a.to_bits()]
            );
            // S3f: and its shape is the one of the frame it last changed in.
            let bits: Vec<u32> = shape.to_floats().iter().map(|v| v.to_bits()).collect();
            assert_eq!(shapes[*id], bits, "drop {id}");
        }
    }
    assert_eq!(framed.hash(), once.hash());
}

#[test]
fn the_parity_parts_have_a_pinned_hash() {
    let parts = wet_parts();
    let (landed, splashes, drips) = parts.counts();
    let wet = (0..parts.sample_count())
        .filter(|&s| parts.wet_step(s) != NEVER)
        .count();
    eprintln!(
        "S3c wet parts after {PARTS_STEPS} steps: {:#010x}, {} samples (cell {:.2} mm), {} drops, {} in the air, {landed} landed, {splashes} splashes, {drips} drips, {} from the air, {wet} wet samples, {:.1} mm³ on, {:.1} mm³ in the air, {:.1} mm³ shed, {:.1} mm³ lost",
        parts.hash(),
        parts.sample_count(),
        parts.cell_mm(),
        parts.drops().len(),
        parts.falling().len(),
        parts.landed_from_air(),
        parts.water(),
        parts.water_in_air(),
        parts.water_shed(),
        parts.water_lost(),
    );
    assert!(parts.drops().len() > 50);
    // S3f: the drops that run down the plastic plate stop at its open lower edge and hang there
    // (none is heavy enough to let go in five seconds: S3c and S3d ran them off it as drips).
    assert!(splashes > 0);
    assert!(parts.drop_states().iter().any(|d| d.edge));
    eprintln!(
        "S3f: {drips} drips, {} at an edge",
        parts.drop_states().iter().filter(|d| d.edge).count()
    );
    // S3d: some of what the splashes threw is in the air.
    assert!(!parts.falling().is_empty());
    assert_eq!(parts.hash(), PINNED_WET_PARTS);
}

/// Pinned hash of the S3c parity scene ([`s3c_wet_scene`]) at 4 samples per pixel;
/// `tools/wasm-parity.mjs` checks the module against it (`rt --write-s3c-wet-example`).
const PINNED_S3C_WET_4SPP: u32 = 0xfc96_fb05;

/// FNV-1a over the little-endian bytes of the resolved film (the hash of the render tests and of
/// `tools/wasm-parity.mjs`).
fn film_hash(values: &[f32]) -> u32 {
    values
        .iter()
        .flat_map(|v| v.to_le_bytes())
        .fold(0x811c_9dc5u32, |h, b| {
            (h ^ u32::from(b)).wrapping_mul(0x0100_0193)
        })
}

/// The film of `scene` at 4 samples per pixel on `isa`.
fn render(scene: &rt_core::scene::Scene, isa: rt_core::simd::Isa) -> Vec<f32> {
    use rt_core::render::{render_tile_prepared, tile_grid};
    let (w, h) = (scene.render.width, scene.render.height);
    let prepared = rt_core::integrator::Prepared::new(scene);
    let mut film = rt_core::image::Film::new(w, h);
    for tile in tile_grid(w, h, 32) {
        for sample in 0..4 {
            render_tile_prepared(scene, &prepared, tile, sample, &mut film, isa);
        }
    }
    film.resolve()
}

#[test]
fn the_s3c_scene_has_a_pinned_hash_on_every_simd_path() {
    use rt_phys::example::s3c_wet_scene;
    let scene = s3c_wet_scene();
    assert_eq!(scene.wet_parts.len(), 4);
    let caps = scene.caps().expect("drops");
    assert_eq!(caps.instance, 4);
    let drops: usize = scene.wet_parts.iter().map(|w| w.drops.len()).sum();
    assert_eq!(drops, wet_parts().drops().len());
    // Through an RSB round trip: the weather travels instance by instance, the caps are meshed again.
    let read = rt_core::scene::Scene::from_rsb(&scene.to_rsb()).expect("read");
    assert_eq!(read, scene);
    let mut found = Vec::new();
    for isa in rt_core::simd::Isa::available() {
        let hash = film_hash(&render(&read, isa));
        eprintln!("S3c wet parts at 4 spp on {}: {hash:#010x}", isa.name());
        found.push((isa.name(), hash));
    }
    for (isa, hash) in found {
        assert_eq!(hash, PINNED_S3C_WET_4SPP, "{isa}");
    }
}

/// Pinned hash of the S3d parity scene ([`s3d_flight_scene`]: the S3c scene with the drops in the
/// air in its `WETF`) at 4 samples per pixel; `tools/wasm-parity.mjs` checks the module against it
/// (`rt --write-s3d-flight-example`).
const PINNED_S3D_FLIGHT_4SPP: u32 = 0x3ba0_0640;

/// Pinned hashes of the six exact passes of the S3d scene (4 albedo samples), in the order of
/// `PASS_KEYS` (`PINNED_S3D_PASS_<KEY>` for CI): a drop on a part and a drop in the air name their
/// part in the part and material passes.
const PINNED_S3D_PASS_ALBEDO: u32 = 0x95e5_9402;
const PINNED_S3D_PASS_NORMAL: u32 = 0x6373_4817;
const PINNED_S3D_PASS_DEPTH: u32 = 0x04de_e46d;
const PINNED_S3D_PASS_PART_ID: u32 = 0x787b_3f07;
const PINNED_S3D_PASS_MATERIAL_ID: u32 = 0x787b_3f07;
const PINNED_S3D_PASS_COC: u32 = 0x7918_3f06;

/// The six exact passes of `scene` (4 albedo samples) on `isa`, as the hosts render them.
fn passes(scene: &rt_core::scene::Scene, isa: rt_core::simd::Isa) -> rt_core::passes::Passes {
    use rt_core::passes::{PassFilm, Passes, PASS_X2};
    use rt_core::render::{render_tile_albedo, render_tile_exact, tile_grid};
    let (w, h) = (scene.render.width, scene.render.height);
    let prepared = rt_core::integrator::Prepared::new(scene);
    let mut whole = Passes::new(w, h, PASS_X2);
    for tile in tile_grid(w, h, 32) {
        let mut film = PassFilm::region(tile.x, tile.y, tile.w, tile.h, PASS_X2);
        render_tile_exact(scene, &prepared, tile, &mut film, isa);
        for s in 0..4 {
            render_tile_albedo(scene, &prepared, tile, s, &mut film, isa);
        }
        whole.copy_region(tile.x, tile.y, &film.resolve());
    }
    whole
}

#[test]
fn the_s3d_scene_draws_the_drops_in_the_air_with_a_pinned_hash_on_every_simd_path() {
    use rt_phys::example::{s3c_wet_scene, s3d_flight_scene};
    let scene = s3d_flight_scene();
    let falling = wet_parts().falling();
    assert!(!falling.is_empty());
    assert_eq!(scene.wet_falling.len(), falling.len());
    let caps = scene.caps().expect("drops");
    let on_parts: usize = scene.wet_parts.iter().map(|w| w.drops.len()).sum();
    assert_eq!(caps.caps as usize, on_parts);
    // Through an RSB round trip: the drops in the air travel in WETF and are meshed again.
    let bytes = scene.to_rsb();
    let read = rt_core::scene::Scene::from_rsb(&bytes).expect("read");
    assert_eq!(read, scene);
    // Without them it is the S3c scene; with them, the image changes.
    let plain = s3c_wet_scene();
    assert_eq!(plain.wet_falling.len(), 0);
    let isa = rt_core::simd::Isa::detect();
    assert_ne!(
        film_hash(&render(&read, isa)),
        film_hash(&render(&plain, isa))
    );
    let mut found = Vec::new();
    for isa in rt_core::simd::Isa::available() {
        let hash = film_hash(&render(&read, isa));
        eprintln!(
            "S3d drops in the air at 4 spp on {}: {hash:#010x}",
            isa.name()
        );
        found.push((isa.name(), hash));
    }
    for (isa, hash) in found {
        assert_eq!(hash, PINNED_S3D_FLIGHT_4SPP, "{isa}");
    }
}

#[test]
fn the_passes_name_a_drop_by_its_part_with_pinned_hashes_on_every_simd_path() {
    use rt_phys::example::s3d_flight_scene;
    let scene = s3d_flight_scene();
    let caps = scene.caps().expect("drops");
    let p = passes(&scene, rt_core::simd::Isa::detect());
    // No pixel names the drops' own instance: a cap or a drop in the air is its part.
    assert!(p.part_id.iter().all(|&id| id != caps.instance + 1));
    assert!(p.material_id.iter().all(|&id| id != caps.material + 1));
    // And some pixels see drops: their part id is a part's (1..=4), their depth is the drop's.
    let w = scene.render.width;
    let mut on_drops = 0;
    for (k, &id) in p.part_id.iter().enumerate() {
        let (x, y) = (k as u32 % w, k as u32 / w);
        let ray = rt_core::render::centre_ray(&scene, x, y);
        if let Some(hit) = scene.pick(&ray) {
            if hit.instance == caps.instance {
                on_drops += 1;
                assert!((1..=4).contains(&id), "{id}");
                let material = scene.geometry.material_of(id - 1).unwrap();
                assert_eq!(p.material_id[k], material + 1);
            }
        }
    }
    assert!(on_drops > 0, "the camera sees drops");
    let pinned = [
        PINNED_S3D_PASS_ALBEDO,
        PINNED_S3D_PASS_NORMAL,
        PINNED_S3D_PASS_DEPTH,
        PINNED_S3D_PASS_PART_ID,
        PINNED_S3D_PASS_MATERIAL_ID,
        PINNED_S3D_PASS_COC,
    ];
    let mut found = Vec::new();
    for isa in rt_core::simd::Isa::available() {
        let hashes: Vec<u32> = passes(&scene, isa)
            .planes()
            .iter()
            .map(|plane| plane.fnv1a())
            .collect();
        eprintln!("S3d passes on {}: {:#010x?}", isa.name(), hashes);
        found.push((isa.name(), hashes));
    }
    for (isa, hashes) in found {
        assert_eq!(hashes, pinned, "{isa}");
    }
}

#[test]
fn weather_with_nothing_on_it_changes_no_pixel_and_the_weather_changes_the_image() {
    use rt_core::weather::PartWeather;
    use rt_phys::example::s3c_wet_scene;
    let wet = s3c_wet_scene();
    let mut dry = wet.clone();
    dry.set_wet_parts(Vec::new()).expect("none");
    assert!(dry.caps().is_none());
    assert_eq!(dry.geometry.instances().len(), 4);
    // The same parts with every sample at 0 and no drop: not a bit changes.
    let clear: Vec<PartWeather> = wet
        .wet_parts
        .iter()
        .map(|w| {
            PartWeather::new(
                w.instance,
                w.resolution.clone(),
                vec![[0; 3]; w.values.len()],
                w.cap_angle_deg,
                w.porosity,
                Vec::new(),
            )
            .unwrap()
        })
        .collect();
    let mut clean = dry.clone();
    clean.set_wet_parts(clear).expect("fits");
    let read = rt_core::scene::Scene::from_rsb(&clean.to_rsb()).expect("read");
    let isa = rt_core::simd::Isa::detect();
    let base = render(&dry, isa);
    assert_eq!(render(&read, isa), base);
    // The weather does change it, and so do the drops alone.
    assert_ne!(render(&wet, isa), base);
    let mut drops_only = dry.clone();
    let only: Vec<PartWeather> = wet
        .wet_parts
        .iter()
        .map(|w| {
            PartWeather::new(
                w.instance,
                w.resolution.clone(),
                vec![[0; 3]; w.values.len()],
                w.cap_angle_deg,
                w.porosity,
                w.drops.clone(),
            )
            .unwrap()
        })
        .collect();
    drops_only.set_wet_parts(only).expect("fits");
    assert!(drops_only.caps().is_some());
    assert_ne!(render(&drops_only, isa), base);
    // The weather alone (no drops) changes it too.
    let mut values_only = dry.clone();
    let only: Vec<PartWeather> = wet
        .wet_parts
        .iter()
        .map(|w| {
            PartWeather::new(
                w.instance,
                w.resolution.clone(),
                w.values.clone(),
                w.cap_angle_deg,
                w.porosity,
                Vec::new(),
            )
            .unwrap()
        })
        .collect();
    values_only.set_wet_parts(only).expect("fits");
    assert!(values_only.caps().is_none());
    assert_ne!(render(&values_only, isa), base);
    // An update without meshes keeps the file's meshes and meshes the caps again, not the old ones
    // as well; again and again.
    let mut updated = wet.clone();
    let bytes = without_meshes(&wet.to_rsb());
    for _ in 0..3 {
        updated.update_from_rsb(&bytes).expect("update");
        assert_eq!(updated.geometry.meshes().len(), 5);
    }
    assert_eq!(updated, wet);
}

/// An RSB file without its `MESH` sections (an update that keeps the loaded meshes).
fn without_meshes(bytes: &[u8]) -> Vec<u8> {
    let header = u32::from_le_bytes(bytes[4..8].try_into().unwrap()) as usize;
    let mut out = bytes[..8 + header].to_vec();
    let mut at = 8 + header;
    while at < bytes.len() {
        let len = u32::from_le_bytes(bytes[at + 4..at + 8].try_into().unwrap()) as usize;
        if &bytes[at..at + 4] != b"MESH" {
            out.extend_from_slice(&bytes[at..at + 8 + len]);
        }
        at += 8 + len;
    }
    out
}

// ---------------------------------------------------------------------------------------------
// S3f: organic drops
// ---------------------------------------------------------------------------------------------

/// Pinned hash of the organic parts ([`rt_phys::example::organic_parts`]) after
/// [`rt_phys::example::ORGANIC_STEPS`]; the page's test with the real `rt.wasm`
/// (`tests/s3f-organic.test.ts`) checks the module against it.
const PINNED_S3F_PARTS: u32 = 0x1c5a_82bb;

/// Pinned hash of the S3f parity scene ([`rt_phys::example::s3f_organic_scene`]: the drops with
/// their shapes in `WETP`) at 4 samples per pixel; `tools/wasm-parity.mjs` checks the module against
/// it (`rt --write-s3f-organic-example`).
const PINNED_S3F_ORGANIC_4SPP: u32 = 0xbfb0_b45a;

fn part_of(adv: f32, rec: f32, transform: Transform) -> WetPartSpec {
    WetPartSpec {
        mesh: 0,
        transform,
        advancing_deg: adv,
        receding_deg: rec,
        soak_mm_s: 0.0,
        flags: 0,
    }
}

/// `K(θ̄)` of a part's caps, `f32`.
fn k_of(adv: f32, rec: f32) -> f32 {
    cap_factor(0.5 * f64::from(adv + rec)) as f32
}

/// The triangle and barycentric weights of the point `(x, y)` of a [`plate_mesh`] of `w` × `h` mm
/// and `nx` × `ny` quads, about the origin.
fn on_plate(nx: u32, ny: u32, w: f32, h: f32, x: f32, y: f32) -> (usize, f32, f32) {
    let (fx, fy) = (
        (x + 0.5 * w) / (w / nx as f32),
        (y + 0.5 * h) / (h / ny as f32),
    );
    let (i, j) = (fx.floor(), fy.floor());
    let (u, v) = (fx - i, fy - j);
    let quad = (j as u32 * nx + i as u32) as usize;
    if u >= v {
        (2 * quad, u - v, v)
    } else {
        (2 * quad + 1, u, v - u)
    }
}

#[test]
fn a_drop_grows_by_merging_and_lets_go_once_past_the_critical_size_of_its_tilt_and_wettability() {
    use rt_phys::example::{PLASTIC_ADVANCING_DEG, PLASTIC_RECEDING_DEG};
    for (adv, rec) in [
        (GLASS_ADVANCING_DEG, GLASS_RECEDING_DEG),
        (PLASTIC_ADVANCING_DEG, PLASTIC_RECEDING_DEG),
    ] {
        for tilt in [20.0f32, 45.0, 90.0] {
            let mut parts = WetParts::new(spec(
                vec![plate_mesh(200.0, 200.0, 8, 8)],
                vec![part_of(adv, rec, tilted(tilt, Vec3::ZERO))],
                vec![],
            ));
            let crit = parts.critical_radius(0, tilt.to_radians().sin());
            let k = k_of(adv, rec);
            let critical = k * crit * crit * crit;
            let piece = critical / 40.0;
            let tri = 2 * (4 * 8 + 4);
            // Drops of a fortieth of the critical volume onto one point, one a step: it grows.
            parts.add_drop(0, tri, 0.3, 0.3, piece);
            parts.step(1);
            let start = parts.drops()[0].2;
            let mut fed = piece;
            while fed + piece < 0.985 * critical {
                parts.add_drop(0, tri, 0.3, 0.3, piece);
                parts.step(1);
                fed += piece;
                let d = parts.drops();
                assert_eq!(d.len(), 1, "{adv}/{rec} at {tilt}°: they merge");
                assert!(
                    (d[0].2 - start).length() < 1e-4,
                    "{adv}/{rec} at {tilt}°: pinned below its size, {fed} of {critical} mm³"
                );
            }
            assert!((parts.water() / fed - 1.0).abs() < 1e-5);
            // Past it, it lets go and slides down.
            while fed < 1.05 * critical {
                parts.add_drop(0, tri, 0.3, 0.3, piece);
                parts.step(1);
                fed += piece;
            }
            parts.step(240);
            let d = parts.drop_states();
            assert_eq!(d.len(), 1);
            let moved = d[0].p - start;
            assert!(
                moved.length() > 1.0,
                "{adv}/{rec} at {tilt}°: moved {moved:?}"
            );
            assert!(moved.z < 0.0, "downhill: {moved:?}");
        }
    }
}

#[test]
fn a_sliding_drop_gathers_the_drops_on_its_path_and_none_beside_it() {
    // A glass pane tilted 60° (down −Y): a drop past its size near the top, a file of nine small
    // pinned drops straight below it and the same file 6.5 mm beside.
    let (w, h) = (160.0f32, 240.0f32);
    let mut parts = WetParts::new(spec(
        vec![plate_mesh(w, h, 8, 12)],
        vec![glass_part(0, tilted(60.0, Vec3::ZERO))],
        vec![],
    ));
    let crit = parts.critical_radius(0, 60f32.to_radians().sin());
    let k = k_of(GLASS_ADVANCING_DEG, GLASS_RECEDING_DEG);
    let small = 0.5 * crit;
    let mut on_path = Vec::new();
    let mut beside = Vec::new();
    for n in 0..9 {
        let y = 80.0 - 20.0 * n as f32;
        for (x, list) in [(0.0f32, &mut on_path), (6.5, &mut beside)] {
            let (tri, u, v) = on_plate(8, 12, w, h, x, y);
            parts.add_drop(0, tri, u, v, k * small * small * small);
            list.push(parts.drop_states().last().unwrap().id);
        }
    }
    let (tri, u, v) = on_plate(8, 12, w, h, 0.0, 100.0);
    let slider = 1.4 * crit;
    parts.add_drop(0, tri, u, v, k * slider * slider * slider);
    let before = parts.drop_states();
    let total = parts.water();
    let start = before.last().unwrap().p;
    let mut speeds = Vec::new();
    for _ in 0..120 {
        parts.step(4);
        let big = parts
            .drop_states()
            .into_iter()
            .max_by(|a, b| a.volume.total_cmp(&b.volume))
            .unwrap();
        speeds.push(big.velocity.length());
        let sum = parts.water() + parts.water_shed() + parts.water_lost() + parts.water_in_air();
        assert!((sum / total - 1.0).abs() < 2e-5, "{sum} of {total}");
    }
    let after = parts.drop_states();
    // Every drop on its path is gone into it (none is left as it was: the survivor of a merge
    // takes the lower number, so a number may live on in the drop that took it); every drop beside
    // it is where it was, as it was.
    for id in &on_path {
        let was = before.iter().find(|d| d.id == *id).unwrap();
        assert!(
            after.iter().all(|d| (d.p, d.volume) != (was.p, was.volume)),
            "drop {id} on the path"
        );
    }
    for id in &beside {
        let was = before.iter().find(|d| d.id == *id).unwrap();
        let now = after.iter().find(|d| d.id == *id).expect("still there");
        assert_eq!((now.p, now.volume), (was.p, was.volume), "drop {id} beside");
    }
    // It grew by what it gathered, and ran faster as it grew.
    let big = after
        .iter()
        .max_by(|a, b| a.volume.total_cmp(&b.volume))
        .unwrap();
    let gathered = 9.0 * k * small * small * small;
    let alone = k * slider * slider * slider;
    assert!(big.volume > alone + 0.6 * gathered, "{big:?}");
    assert!(big.p.z < start.z - 100.0, "{big:?}");
    let first = speeds.iter().copied().find(|&v| v > 0.0).unwrap();
    let fastest = speeds.iter().copied().fold(0.0f32, f32::max);
    assert!(fastest > 1.3 * first, "{first} → {fastest}");
}

#[test]
fn volume_is_conserved_through_any_merge_cascade() {
    // A pane at 70° crowded with 400 small drops from a hash and three past their size at its top:
    // merges into merges, runs, beads.
    use rt_core::rng::mix64;
    let unit = |h: u64| (h >> 40) as f32 / 16_777_216.0;
    let (w, h) = (160.0f32, 240.0f32);
    let mut parts = WetParts::new(spec(
        vec![plate_mesh(w, h, 8, 12)],
        vec![glass_part(0, tilted(70.0, Vec3::ZERO))],
        vec![],
    ));
    let crit = parts.critical_radius(0, 70f32.to_radians().sin());
    let k = k_of(GLASS_ADVANCING_DEG, GLASS_RECEDING_DEG);
    for n in 0..400u64 {
        let hh = mix64(0xc0ffee ^ n);
        let x = (unit(hh) - 0.5) * 0.95 * w;
        let y = (unit(mix64(hh ^ 1)) - 0.5) * 0.95 * h;
        let a = crit * (0.2 + 0.6 * unit(mix64(hh ^ 2)));
        let (tri, u, v) = on_plate(8, 12, w, h, x, y);
        parts.add_drop(0, tri, u, v, k * a * a * a);
    }
    for x in [-50.0f32, 0.0, 50.0] {
        let (tri, u, v) = on_plate(8, 12, w, h, x, 110.0);
        let a = 1.6 * crit;
        parts.add_drop(0, tri, u, v, k * a * a * a);
    }
    let count = parts.drops().len();
    let start = parts.drop_states();
    let total = parts.water();
    for _ in 0..96 {
        parts.step(5);
        let sum = parts.water() + parts.water_shed() + parts.water_lost() + parts.water_in_air();
        assert!((sum / total - 1.0).abs() < 2e-5, "{sum} of {total}");
    }
    // Many of them were taken: not where and as they were.
    let now = parts.drop_states();
    let untouched = start
        .iter()
        .filter(|d| {
            now.iter()
                .any(|n| (n.id, n.p, n.volume) == (d.id, d.p, d.volume))
        })
        .count();
    assert!(untouched < count * 9 / 10, "{untouched} of {count}");
}

#[test]
fn the_shape_follows_the_speed_and_the_tilt_monotonically() {
    use rt_phys::wet_parts::base_shape;
    let (adv, rec) = (GLASS_ADVANCING_DEG, GLASS_RECEDING_DEG);
    let round = base_shape(adv, rec, 0.0, 0.0);
    assert_eq!((round.aspect, round.bulge, round.taper), (1.0, 0.0, 0.0));
    // Pinned: longer and bulging more as the load (the tilt) grows.
    let mut last = round;
    for n in 1..=20 {
        let s = base_shape(adv, rec, n as f32 / 20.0, 0.0);
        assert!(s.aspect > last.aspect && s.bulge > last.bulge, "{n}: {s:?}");
        assert_eq!(s.taper, 0.0);
        last = s;
    }
    // Sliding: on from where the pinned drop let go, longer, thinner behind and steeper in front
    // as it runs faster.
    let off = base_shape(adv, rec, 1.0, 1.0e-7);
    assert!((off.aspect - last.aspect).abs() < 1e-3 && (off.bulge - last.bulge).abs() < 1e-3);
    let mut last = off;
    for n in 1..=20 {
        let s = base_shape(adv, rec, 1.0, 0.0002 * n as f32);
        assert!(
            s.aspect > last.aspect && s.taper > last.taper && s.bulge > last.bulge,
            "{n}: {s:?}"
        );
        last = s;
    }
    // On the parts: the same drop pinned on faces tilted more is longer and bulges more, downhill.
    let crit40 = rt_phys::wet::critical_radius(adv, rec, 40f32.to_radians().sin()) * 0.9;
    let k = k_of(adv, rec);
    let mut last = round;
    for tilt in [10.0f32, 20.0, 30.0, 40.0] {
        let mut parts = WetParts::new(spec(
            vec![plate_mesh(200.0, 200.0, 8, 8)],
            vec![glass_part(0, tilted(tilt, Vec3::ZERO))],
            vec![],
        ));
        parts.add_drop(0, 2 * (4 * 8 + 4), 0.3, 0.3, k * crit40 * crit40 * crit40);
        parts.step(2);
        let s = parts.shapes()[0];
        assert!(
            s.aspect > last.aspect && s.bulge > last.bulge,
            "{tilt}°: {s:?}"
        );
        let down = Vec3::new(0.0, -tilt.to_radians().cos(), -tilt.to_radians().sin());
        assert!(s.axis.dot(down) > 0.999, "{tilt}°: {s:?}");
        last = s;
    }
    // And sliding faster (a larger drop at 45°), longer along its motion.
    let crit45 = rt_phys::wet::critical_radius(adv, rec, 45f32.to_radians().sin());
    let mut last = (0.0f32, round);
    for size in [1.2f32, 1.6, 2.0] {
        let mut parts = WetParts::new(spec(
            vec![plate_mesh(300.0, 300.0, 6, 6)],
            vec![glass_part(0, tilted(45.0, Vec3::ZERO))],
            vec![],
        ));
        let a = crit45 * size;
        parts.add_drop(0, 2 * (5 * 6 + 3), 0.3, 0.3, k * a * a * a);
        parts.step(24);
        let d = parts.drop_states()[0];
        let s = parts.shapes()[0];
        let v = d.velocity.length();
        assert!(v > last.0 && s.aspect > last.1.aspect, "{size}: {v} {s:?}");
        assert!(s.axis.dot(d.velocity / v) > 0.999, "{s:?}");
        last = (v, s);
    }
}

#[test]
fn a_merge_moves_the_centre_continuously_to_the_centre_of_volume() {
    // Two equal drops on a level plate, 0.9 of their two radii apart.
    let mut parts = WetParts::new(spec(
        vec![plate_mesh(100.0, 100.0, 2, 2)],
        vec![glass_part(0, Transform::IDENTITY)],
        vec![],
    ));
    let k = k_of(GLASS_ADVANCING_DEG, GLASS_RECEDING_DEG);
    let a = 1.5f32;
    let (tri, u, v) = on_plate(2, 2, 100.0, 100.0, 10.0, 5.0);
    parts.add_drop(0, tri, u, v, k * a * a * a);
    let (tri, u, v) = on_plate(2, 2, 100.0, 100.0, 10.0 + 1.8 * a, 5.0);
    parts.add_drop(0, tri, u, v, k * a * a * a);
    let first = parts.drop_states();
    let centre = (first[0].p + first[1].p) * 0.5;
    parts.step(1);
    let merged = parts.drop_states();
    assert_eq!(merged.len(), 1);
    assert_eq!(merged[0].id, first[0].id);
    let total = 2.0 * k * a * a * a;
    assert!((merged[0].volume / total - 1.0).abs() < 1e-6);
    // At first its outline spans the two, with a neck between them, centred between them.
    let s = parts.shapes()[0];
    let a2 = merged[0].a;
    assert!(s.neck > 0.4, "{s:?}");
    assert!(
        ((s.merge_along * a2) / (0.5 * (1.8 * a + 2.0 * a)) - 1.0).abs() < 1e-3,
        "{s:?}"
    );
    assert!((s.shift * a2 - 0.9 * a).abs() < 1e-3, "{s:?}");
    // Its centre moves on to the centre of volume, never by more than a few hundredths of the two
    // radii in a step (a merge does not teleport), and the neck fills.
    let bound = 0.12 * 2.0 * a;
    let mut last = merged[0].p;
    for _ in 0..240 {
        parts.step(1);
        let d = parts.drop_states()[0];
        assert!((d.p - last).length() <= bound, "{:?} → {:?}", last, d.p);
        last = d.p;
    }
    assert!(
        (last - centre).length() <= 0.011 * 0.9 * a + 1e-4,
        "{last:?} vs {centre:?}"
    );
    let s = parts.shapes()[0];
    assert_eq!((s.neck, s.merge_along, s.shift), (0.0, 1.0, 0.0), "{s:?}");
    assert!((parts.water() / total - 1.0).abs() < 1e-6);
}

#[test]
fn a_drop_that_reaches_an_open_edge_hangs_there_until_it_pinches_off() {
    // A vertical glass plate, its lower edge open at z = 20: a drop past its size slides down to it
    // and stops there, hanging.
    let mut parts = WetParts::new(spec(
        vec![plate_mesh(100.0, 160.0, 4, 8)],
        vec![glass_part(0, tilted(90.0, Vec3::new(0.0, 0.0, 100.0)))],
        vec![],
    ));
    let crit = parts.critical_radius(0, 1.0);
    let k = k_of(GLASS_ADVANCING_DEG, GLASS_RECEDING_DEG);
    let (tri, u, v) = on_plate(4, 8, 100.0, 160.0, 0.0, -40.0);
    let a = 1.3 * crit;
    parts.add_drop(0, tri, u, v, k * a * a * a);
    parts.step(480);
    let d = parts.drop_states();
    assert_eq!(d.len(), 1);
    assert!(d[0].edge && (d[0].p.z - 20.0).abs() < 1e-3, "{d:?}");
    assert_eq!(parts.counts().2, 0);
    // It hangs along gravity, the more the heavier.
    let sag = parts.shapes()[0].sag;
    assert!(sag > 0.0);
    // Fed at the edge past what its contact line holds (Tate: ρ g V = 2π a γ sin θ̄), it necks and
    // lets go of one drop, the rest staying.
    let hold = (2.0 * std::f64::consts::PI * 7.2e-5 * 60f64.to_radians().sin()
        / (9.81e-6 * f64::from(k)))
    .sqrt() as f32;
    let at = d[0].p;
    let (tri, u, v) = on_plate(4, 8, 100.0, 160.0, at.x, -79.99);
    let need = k * hold * hold * hold * 1.05 - d[0].volume;
    parts.add_drop(0, tri, u, v, need);
    parts.step(2);
    let hung = parts.drop_states();
    assert_eq!(hung.len(), 1, "{hung:?}");
    assert!(parts.shapes()[0].sag > sag);
    let volume = hung[0].volume;
    let mut steps = 0;
    while parts.counts().2 == 0 && steps < 240 {
        assert!(parts.falling().is_empty());
        parts.step(1);
        steps += 1;
    }
    assert!(steps > 10, "it necks first: {steps} steps");
    assert_eq!(parts.counts().2, 1);
    let left = parts.drop_states();
    assert_eq!(left.len(), 1);
    assert!(left[0].edge);
    assert!((left[0].volume / (volume * (1.0 - PINCH_OFF_SHARE)) - 1.0).abs() < 1e-4);
    let falling = parts.falling();
    assert_eq!(falling.len(), 1);
    let r = 0.5 * (6.0 * PINCH_OFF_SHARE * volume / std::f32::consts::PI).cbrt();
    assert!((falling[0].2 - r).abs() < 1e-3);
    assert!(falling[0].1.z < 20.0);
}

#[test]
fn a_fast_drop_on_a_steep_face_leaves_a_continuous_run_and_a_slow_one_does_not() {
    let k = k_of(GLASS_ADVANCING_DEG, GLASS_RECEDING_DEG);
    let crit = rt_phys::wet::critical_radius(GLASS_ADVANCING_DEG, GLASS_RECEDING_DEG, 1.0);
    let a = 2.0 * crit;
    let run = |tilt: f32| {
        let mut parts = WetParts::new(spec(
            vec![plate_mesh(100.0, 400.0, 4, 20)],
            vec![glass_part(0, tilted(tilt, Vec3::new(0.0, 0.0, 300.0)))],
            vec![],
        ));
        let (tri, u, v) = on_plate(4, 20, 100.0, 400.0, 0.0, 180.0);
        parts.add_drop(0, tri, u, v, k * a * a * a);
        parts.step(60);
        parts
    };
    // Vertical: it runs at its fastest, its rear angle falls below RUN_REAR_SHARE of the receding
    // one, and it leaves the beads of a rivulet on its path, above it, elongated along it.
    let mut steep = run(90.0);
    let states = steep.drop_states();
    let shapes = steep.shapes();
    let head = states
        .iter()
        .max_by(|x, y| x.volume.total_cmp(&y.volume))
        .unwrap();
    let beads: Vec<usize> = (0..states.len()).filter(|&i| states[i].bead).collect();
    assert!(beads.len() >= 5, "{} beads", beads.len());
    for &i in &beads {
        let b = states[i];
        assert!(b.p.z > head.p.z && (b.p.x - head.p.x).abs() < 0.5, "{b:?}");
        assert!(
            shapes[i].aspect > 1.0 && shapes[i].axis.z.abs() > 0.99,
            "{:?}",
            shapes[i]
        );
        assert!(b.a < 0.5 * head.a);
    }
    // The newest, just behind it, still as long as RUN_BEAD times their width.
    let longest = beads.iter().fold(0.0f32, |m, &i| m.max(shapes[i].aspect));
    assert!(longest > 2.5, "{longest}");
    // They relax into small round drops that stay where they are.
    let left: Vec<_> = beads.iter().map(|&i| (states[i].id, states[i].p)).collect();
    steep.step(480);
    let later = steep.drop_states();
    for (id, p) in left {
        let b = later.iter().find(|d| d.id == id).expect("still there");
        assert!(!b.bead && b.p == p, "{b:?}");
    }
    // At 25° the same drop runs slower and leaves none.
    let gentle = run(25.0);
    assert!(gentle.drop_states().iter().all(|d| !d.bead));
    assert_eq!(gentle.drop_states().len(), 1);
}

#[test]
fn the_organic_parts_are_the_same_however_the_steps_are_split_with_a_pinned_hash() {
    use rt_phys::example::{organic_parts, ORGANIC_STEPS};
    let mut once = organic_parts();
    once.step(ORGANIC_STEPS);
    let mut split = organic_parts();
    let mut done = 0;
    for chunk in [1u32, 7, 24, 100] {
        split.step(chunk);
        let _ = split.frame();
        done += chunk;
    }
    split.step(ORGANIC_STEPS - done);
    assert_eq!(split.hash(), once.hash());
    assert_eq!(split.weather(), once.weather());
    let states = once.drop_states();
    let shapes = once.shapes();
    let (landed, splashes, drips) = once.counts();
    eprintln!(
        "S3f organic parts after {ORGANIC_STEPS} steps: {:#010x}, {} drops ({} sliding, {} relaxing a merge, {} beads, {} at an edge), {} in the air, {landed} landed, {splashes} splashes, {drips} drips, {:.1} mm³ on",
        once.hash(),
        states.len(),
        states.iter().filter(|d| d.velocity.length() > 0.0).count(),
        states.iter().filter(|d| d.merging > 0.0).count(),
        states.iter().filter(|d| d.bead).count(),
        states.iter().filter(|d| d.edge).count(),
        once.falling().len(),
        once.water(),
    );
    // Something of every kind is there.
    assert!(states.iter().any(|d| d.velocity.length() > 0.0));
    assert!(states.iter().any(|d| d.merging > 0.0));
    assert!(states.iter().any(|d| d.bead));
    assert!(shapes.iter().any(|s| s.neck > 0.0));
    assert!(shapes.iter().any(|s| s.sag > 0.0));
    assert!(drips >= 1);
    assert_eq!(once.hash(), PINNED_S3F_PARTS);
}

#[test]
fn the_s3f_scene_draws_the_drops_shaped_with_a_pinned_hash_on_every_simd_path() {
    use rt_core::weather::{DropShape, PartWeather, CAP_TRIANGLES, SHAPED_CAP_TRIANGLES};
    use rt_phys::example::s3f_organic_scene;
    let scene = s3f_organic_scene();
    let caps = scene.caps().expect("drops");
    assert_eq!(caps.cap_triangles, SHAPED_CAP_TRIANGLES);
    assert!(scene
        .wet_parts
        .iter()
        .flat_map(|w| &w.shapes)
        .any(|s| !s.is_round()));
    let read = rt_core::scene::Scene::from_rsb(&scene.to_rsb()).expect("read");
    assert_eq!(read, scene);
    // As an engine without bit 10 draws it (it ignores the tail): round caps, another image.
    let mut round = scene.clone();
    let plain: Vec<PartWeather> = scene
        .wet_parts
        .iter()
        .map(|w| w.clone().with_shapes(Vec::new()).unwrap())
        .collect();
    round.set_wet_parts(plain).unwrap();
    assert_eq!(round.caps().unwrap().cap_triangles, CAP_TRIANGLES);
    let isa = rt_core::simd::Isa::detect();
    assert_ne!(
        film_hash(&render(&read, isa)),
        film_hash(&render(&round, isa))
    );
    // All round shapes: the finer mesh of the same round caps (and the same parts in the passes).
    let mut same = scene.clone();
    let rounds: Vec<PartWeather> = scene
        .wet_parts
        .iter()
        .map(|w| {
            let n = w.drops.len();
            w.clone().with_shapes(vec![DropShape::ROUND; n]).unwrap()
        })
        .collect();
    same.set_wet_parts(rounds).unwrap();
    assert_eq!(same.caps().unwrap().cap_triangles, SHAPED_CAP_TRIANGLES);
    let mut found = Vec::new();
    for isa in rt_core::simd::Isa::available() {
        let hash = film_hash(&render(&read, isa));
        eprintln!("S3f organic drops at 4 spp on {}: {hash:#010x}", isa.name());
        found.push((isa.name(), hash));
    }
    for (isa, hash) in found {
        assert_eq!(hash, PINNED_S3F_ORGANIC_4SPP, "{isa}");
    }
}
