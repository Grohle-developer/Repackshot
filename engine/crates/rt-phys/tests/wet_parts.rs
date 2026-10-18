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
    PART_FILM,
};
use rt_phys::Transform;

/// Pinned hash of the parity parts after [`PARTS_STEPS`] ([`WetParts::hash`]); the page's test with
/// the real `rt.wasm` (`tests/s3c-parts.test.ts`) checks the module against it.
const PINNED_WET_PARTS: u32 = 0x9fb6_9a83;

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
        assert!(d.2.z <= last.z + 1e-4);
        crossed |= d.1 >= 2;
        last = d.2;
    }
    assert!(crossed, "the drop never reached the steep face: {last:?}");
    // It ran off the open lower edge of the steep face and dripped.
    assert_eq!(parts.counts().2, 1);
    assert!(parts.drops().is_empty());
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
    let centre = (before[0].2 * 4.0 + before[1].2 * 2.5) / 6.5;
    assert!(
        (after[0].2 - centre).length() < 1e-3,
        "{:?} vs {centre:?}",
        after[0].2
    );
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
        parts.add_drop(0, 0, 0.3, 0.3, glass_volume(a_crit * factor));
        parts.step(24);
        assert_eq!(parts.counts().2 == 1, drips, "{factor}");
        let on_floor = parts.drops().iter().filter(|d| d.0 == 1).count();
        assert_eq!(on_floor > 0, drips, "{factor}: {:?}", parts.drops());
        if drips {
            // The water is on the floor, but for what the splash threw off the plate.
            let total = glass_volume(a_crit * factor);
            assert!(parts.water() + parts.water_lost() > 0.999 * total);
            assert!(parts.drops().iter().all(|d| d.2.z.abs() < 1e-3));
            // A drop of 8 mm falling 44 mm meets the floor at √(2 g h) ≈ 0.93 m/s: K ≈ 93, it splashes.
            assert_eq!(parts.counts().1, 1);
        }
    }
    // From 5 mm it lands at 0.3 m/s (K ≈ 24) and stays whole.
    let mut low = scene.clone();
    low.parts[0].transform = Transform::translation(Vec3::new(0.0, 0.0, 12.0));
    let mut parts = WetParts::new(low);
    parts.add_drop(0, 0, 0.3, 0.3, glass_volume(a_crit * 1.05));
    parts.step(24);
    assert_eq!(parts.counts(), (0, 0, 1));
    assert_eq!(parts.drops().len(), 1);
    assert!((parts.water() / glass_volume(a_crit * 1.05) - 1.0).abs() < 1e-4);
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
    // Every drop that landed is on the plate, merged, or was thrown off its edge.
    let each = std::f32::consts::PI / 6.0 * 2.5f32.powi(3);
    let total = each * landed as f32;
    let seen = parts.water() + parts.water_lost() + parts.water_shed();
    assert!((seen / total - 1.0).abs() < 1e-3, "{seen} vs {total}");
    // Each landing left a drop of 70 % of its volume and threw two of 15 % each.
    let volumes: Vec<f32> = parts
        .drops()
        .iter()
        .map(|d| glass_volume(f64::from(d.3)))
        .collect();
    let big = volumes
        .iter()
        .filter(|&&v| (v / (0.7 * each) - 1.0).abs() < 0.01)
        .count();
    let small = volumes
        .iter()
        .filter(|&&v| (v / (0.15 * each) - 1.0).abs() < 0.01)
        .count();
    // (A thrown drop may land on another drop and merge with it.)
    assert!(big + 2 >= landed as usize, "{volumes:?}");
    assert!(small >= landed as usize, "{volumes:?}");
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
        assert_eq!(4 * (at + 2), rec.len());
    }
    for (s, &w) in wet.iter().enumerate() {
        assert_eq!(w, framed.wet_step(s) != NEVER, "{s}");
    }
    // The drops rebuilt from the frames are the parts' weather, part by part, by number.
    let weather = framed.weather();
    for (part, w) in weather.iter().enumerate() {
        let mine: Vec<_> = drops.values().filter(|d| d.0 == part as u32).collect();
        assert_eq!(mine.len(), w.drops.len());
        for (d, (tri, p, a)) in mine.iter().zip(&w.drops) {
            assert_eq!(d.1, *tri);
            assert_eq!(
                d.2,
                [p.x.to_bits(), p.y.to_bits(), p.z.to_bits(), a.to_bits()]
            );
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
        "S3c wet parts after {PARTS_STEPS} steps: {:#010x}, {} samples (cell {:.2} mm), {} drops, {landed} landed, {splashes} splashes, {drips} drips, {wet} wet samples, {:.1} mm³ on, {:.1} mm³ shed, {:.1} mm³ lost",
        parts.hash(),
        parts.sample_count(),
        parts.cell_mm(),
        parts.drops().len(),
        parts.water(),
        parts.water_shed(),
        parts.water_lost(),
    );
    assert!(parts.drops().len() > 50);
    assert!(drips > 0 && splashes > 0);
    assert_eq!(parts.hash(), PINNED_WET_PARTS);
}

/// Pinned hash of the S3c parity scene ([`s3c_wet_scene`]) at 4 samples per pixel;
/// `tools/wasm-parity.mjs` checks the module against it (`rt --write-s3c-wet-example`).
const PINNED_S3C_WET_4SPP: u32 = 0x7bad_d7de;

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
