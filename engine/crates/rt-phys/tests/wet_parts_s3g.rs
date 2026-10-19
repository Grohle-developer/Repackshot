//! S3g: water that reads as water. A runner leaves its continuous wet trail and no beads below the
//! pearling transition (its dynamic receding angle at `PEARL_REAR_DEG`); past it, its pearls are
//! sparse, small and irregularly spaced; the outline a drop is drawn with keeps its physical contact
//! area in every state; the water table measures what the drops do.

use rt_core::math::Vec3;
use rt_phys::example::{
    organic_parts, plate_mesh, water_row, WaterFamily, WaterRain, DUST_REPOSE_DEG,
    GLASS_ADVANCING_DEG, GLASS_RECEDING_DEG, SNOW_REPOSE_DEG,
};
use rt_phys::math::Quat;
use rt_phys::wet::{critical_radius, SURFACE_TENSION, WATER_VISCOSITY};
use rt_phys::wet_parts::{
    PartsExtras, PartsMesh, PartsSource, PartsSourceKind, PartsSpec, WetPartSpec, WetParts,
    COX_VOINOV_LOG, NEVER, NO_BODY, PEARL_REAR_DEG,
};
use rt_phys::Transform;

fn part(adv: f32, rec: f32, mesh: u32, transform: Transform) -> WetPartSpec {
    WetPartSpec {
        mesh,
        transform,
        advancing_deg: adv,
        receding_deg: rec,
        soak_mm_s: 0.0,
        flags: 0,
        body: NO_BODY,
    }
}

fn spec(meshes: Vec<PartsMesh>, parts: Vec<WetPartSpec>, sources: Vec<PartsSource>) -> PartsSpec {
    PartsSpec {
        seed: 47,
        cell_mm: 1.0,
        max_samples: 600_000,
        repose_deg: DUST_REPOSE_DEG,
        snow_repose_deg: SNOW_REPOSE_DEG,
        meshes,
        parts,
        sources,
        extras: PartsExtras::default(),
    }
}

/// A plate tilted `deg` about X (its +Y edge up), centred at `at`.
fn tilted(deg: f32, at: Vec3) -> Transform {
    Transform::from_pose(
        at,
        Quat::from_axis_angle(Vec3::new(1.0, 0.0, 0.0), deg.to_radians()),
    )
}

/// The volume over the cube of the contact radius of a cap at the mean of `adv` and `rec`.
fn k_of(adv: f32, rec: f32) -> f32 {
    let t = (0.5 * f64::from(adv + rec)).to_radians();
    (std::f64::consts::PI * (2.0 - 3.0 * t.cos() + t.cos().powi(3)) / (3.0 * t.sin().powi(3)))
        as f32
}

/// The triangle and weights of the point `(x, y)` of a [`plate_mesh`] of `w` × `h` mm and
/// `nx` × `ny` quads.
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

/// The capillary number at which a runner's rear angle falls to the pearling one.
fn pearling_ca(rec: f32) -> f32 {
    let (r, p) = (rec.to_radians(), PEARL_REAR_DEG.to_radians());
    (r * r * r - p * p * p).max(0.0) / (9.0 * COX_VOINOV_LOG)
}

#[test]
fn a_typical_runner_on_a_vertical_pane_leaves_its_trail_and_no_beads() {
    // Glass, vertical: drops of 1.5, 2 and 3 times their critical radius at the top of a pane
    // 400 mm tall run down it (the largest at the fastest a drop slides).
    let (adv, rec) = (GLASS_ADVANCING_DEG, GLASS_RECEDING_DEG);
    let k = k_of(adv, rec);
    let crit = critical_radius(adv, rec, 1.0);
    let ca_pearl = pearling_ca(rec);
    for share in [1.5f32, 2.0, 3.0] {
        let mut parts = WetParts::new(spec(
            vec![plate_mesh(100.0, 400.0, 4, 20)],
            vec![part(adv, rec, 0, tilted(90.0, Vec3::new(0.0, 0.0, 300.0)))],
            vec![],
        ));
        let a = share * crit;
        let (tri, u, v) = on_plate(4, 20, 100.0, 400.0, 0.0, 180.0);
        parts.add_drop(0, tri, u, v, k * a * a * a);
        let start = parts.drop_states()[0].p;
        let mut fastest = 0.0f32;
        for _ in 0..120 {
            parts.step(1);
            let states = parts.drop_states();
            // The runner alone: it leaves nothing behind it but its film.
            assert_eq!(states.len(), 1, "{share}: {states:?}");
            fastest = fastest.max(states[0].velocity.length());
        }
        assert_eq!(parts.pearls(), 0, "{share}");
        // Below the pearling transition: its capillary number (at most that of the fastest a drop
        // slides) is under that at which its rear angle would fall to the pearling one.
        let ca = WATER_VISCOSITY * fastest / SURFACE_TENSION;
        assert!(
            ca > 0.0 && ca < 0.6 * ca_pearl,
            "{share}: Ca {ca} vs {ca_pearl}"
        );
        // The trail is continuous: every sample within half its radius of the line it ran down,
        // from where it started to where it is (less its radius at each end), is wet.
        let end = parts.drop_states()[0];
        assert!(start.z - end.p.z > 20.0, "{share}: it did not run: {end:?}");
        let mut on_path = 0;
        for s in 0..parts.sample_count() {
            let p = parts.sample_position(s);
            if (p.x - start.x).abs() < 0.5 * end.a
                && p.z < start.z - a
                && p.z > end.p.z + end.a
                && (p.y - start.y).abs() < 0.5
            {
                on_path += 1;
                assert_ne!(parts.wet_step(s), NEVER, "{share}: a dry sample at {p:?}");
            }
        }
        assert!(on_path > 20, "{share}: {on_path} samples on its path");
    }
}

/// Pinned hash of the pearling run (six runners of twice their critical size down a vertical pane of
/// advancing 40° and receding 12°, three seconds): the same natively and in `wasm32-wasip1`, scalar
/// and simd128.
const PINNED_S3G_PEARLS: u32 = 0x533b_5c9d;

/// The pearls of six runners down a pane of `adv`/`rec` 1000 mm tall: per lane, the heights of the
/// pearls it left and the runner's contact radius at the end; and the run's hash.
fn pearling_lanes(adv: f32, rec: f32, share: f32) -> (Vec<(Vec<f32>, Vec<f32>, f32)>, u32) {
    let k = k_of(adv, rec);
    let crit = critical_radius(adv, rec, 1.0);
    let mut parts = WetParts::new(spec(
        vec![plate_mesh(360.0, 1000.0, 6, 50)],
        vec![part(adv, rec, 0, tilted(90.0, Vec3::new(0.0, 0.0, 600.0)))],
        vec![],
    ));
    let lanes: Vec<f32> = (0..6).map(|i| -150.0 + 60.0 * i as f32).collect();
    let a = share * crit;
    for &x in &lanes {
        let (tri, u, v) = on_plate(6, 50, 360.0, 1000.0, x, 470.0);
        parts.add_drop(0, tri, u, v, k * a * a * a);
    }
    let runners: Vec<u32> = parts.drop_states().iter().map(|d| d.id).collect();
    parts.step(720);
    let states = parts.drop_states();
    let lanes = lanes
        .iter()
        .map(|&x| {
            let near = |d: &&rt_phys::wet_parts::DropState| (d.p.x - x).abs() < 25.0;
            let runner = states
                .iter()
                .filter(near)
                .find(|d| runners.contains(&d.id))
                .expect("the runner is still on the pane");
            let pearls: Vec<_> = states
                .iter()
                .filter(near)
                .filter(|d| !runners.contains(&d.id))
                .collect();
            (
                pearls.iter().map(|d| d.p.z).collect(),
                pearls.iter().map(|d| d.a).collect(),
                runner.a,
            )
        })
        .collect();
    (lanes, parts.hash())
}

#[test]
fn past_the_pearling_transition_a_runner_leaves_sparse_small_irregular_pearls() {
    // A surface that water wets well (advancing 40°, receding 12°: the rear angle of a runner
    // reaches the pearling one at a few mm/s): six runners of twice their critical size.
    let (adv, rec) = (40.0f32, 12.0f32);
    let (lanes, hash) = pearling_lanes(adv, rec, 2.0);
    let mut gaps = Vec::new();
    let mut count = 0;
    let mut largest = 0.0f32;
    for (heights, radii, runner) in &lanes {
        let mut z = heights.clone();
        z.sort_by(|a, b| b.total_cmp(a));
        gaps.extend(z.windows(2).map(|w| w[0] - w[1]));
        count += z.len();
        // Every pearl is much smaller than its runner (◆ the limit).
        for &r in radii {
            assert!(
                r < 0.3 * runner,
                "a pearl of {r} mm behind a runner of {runner} mm"
            );
            largest = largest.max(r / runner);
        }
    }
    // Sparse: a few per lane over 700 mm, not a dotted line.
    assert!((12..=60).contains(&count), "{count} pearls");
    // Irregular: the coefficient of variation of their spacings is past 0.3 (◆ the limit).
    let n = gaps.len() as f32;
    let mean = gaps.iter().sum::<f32>() / n;
    let sd = (gaps.iter().map(|g| (g - mean) * (g - mean)).sum::<f32>() / n).sqrt();
    eprintln!(
        "pearling: {count} pearls behind 6 runners, spacing {mean:.1} ± {sd:.1} mm (CV {:.2}), the largest {largest:.2} of its runner's radius",
        sd / mean
    );
    assert!(gaps.len() >= 8, "{} gaps", gaps.len());
    assert!(sd / mean > 0.3, "spacings {mean} ± {sd}: {gaps:?}");
    // And none from the same runners on glass, whose rear angle never falls that far.
    let (glass, _) = pearling_lanes(GLASS_ADVANCING_DEG, GLASS_RECEDING_DEG, 2.0);
    assert!(glass.iter().all(|(z, _, _)| z.is_empty()), "{glass:?}");
    eprintln!("S3g pearls: {hash:#010x}");
    assert_eq!(hash, PINNED_S3G_PEARLS);
}

/// Every drop of `parts` at every one of `frames` frames of `steps` steps: its outline's area over
/// its contact area, and which of pinned on a slope (0), sliding (1), relaxing a merge (2) and
/// hanging (3) it is.
fn outlines(mut parts: WetParts, frames: u32, steps: u32) -> Vec<(usize, f32)> {
    let mut out = Vec::new();
    for _ in 0..frames {
        parts.step(steps);
        let ratios = parts.outline_ratios(720);
        for (d, r) in parts.drop_states().iter().zip(ratios) {
            let state = if d.hang > 0.0 || d.pinch > 0.0 {
                3
            } else if d.merging > 0.0 {
                2
            } else if d.velocity.length() > 0.0 {
                1
            } else {
                0
            };
            out.push((state, r));
        }
    }
    out
}

#[test]
fn the_outline_keeps_the_contact_area_in_every_state() {
    let rain = WaterRain {
        density: 2.0e-5,
        speed: 6576.0,
        size_mm: 1.2,
        size_var: 0.4,
    };
    let glass = WaterFamily {
        name: "GLASS".into(),
        advancing_deg: GLASS_ADVANCING_DEG,
        receding_deg: GLASS_RECEDING_DEG,
    };
    let mut all = outlines(organic_parts(), 75, 4);
    for tilt in [90.0, 30.0] {
        let p = WetParts::new(rt_phys::example::water_plate_spec(&glass, tilt, rain));
        all.extend(outlines(p, 48, 10));
    }
    // A drop under a ceiling tilted 30° that grows and pinches off, its gravity partly along it.
    let mut ceiling = plate_mesh(60.0, 60.0, 3, 3);
    ceiling
        .indices
        .chunks_exact_mut(3)
        .for_each(|t| t.swap(1, 2));
    let mut hanging = WetParts::new(spec(
        vec![ceiling],
        vec![part(
            GLASS_ADVANCING_DEG,
            GLASS_RECEDING_DEG,
            0,
            tilted(30.0, Vec3::new(0.0, 0.0, 200.0)),
        )],
        vec![PartsSource {
            kind: PartsSourceKind::Drops,
            density: 0.0,
            velocity: Vec3::new(0.0, 0.0, -1.0),
            size_mm: 1.0,
            size_var: 0.0,
        }],
    ));
    let k = k_of(GLASS_ADVANCING_DEG, GLASS_RECEDING_DEG);
    for (i, a) in [2.4f32, 2.9, 3.4].iter().enumerate() {
        hanging.add_drop(0, 8 + 2 * i, 0.3, 0.3, k * a * a * a);
    }
    all.extend(outlines(hanging, 60, 4));
    // Runners down a vertical pane, alone.
    let mut runners = WetParts::new(spec(
        vec![plate_mesh(100.0, 400.0, 4, 20)],
        vec![part(
            GLASS_ADVANCING_DEG,
            GLASS_RECEDING_DEG,
            0,
            tilted(90.0, Vec3::new(0.0, 0.0, 300.0)),
        )],
        vec![],
    ));
    let crit = critical_radius(GLASS_ADVANCING_DEG, GLASS_RECEDING_DEG, 1.0);
    for (x, share) in [(-30.0f32, 1.3f32), (0.0, 2.0), (30.0, 3.0)] {
        let (tri, u, v) = on_plate(4, 20, 100.0, 400.0, x, 180.0);
        let a = share * crit;
        runners.add_drop(0, tri, u, v, k * a * a * a);
    }
    all.extend(outlines(runners, 30, 2));
    let mut seen = [0usize; 4];
    let mut worst = [1.0f32; 4];
    for &(state, r) in &all {
        seen[state] += 1;
        if (r - 1.0).abs() > (worst[state] - 1.0).abs() {
            worst[state] = r;
        }
        assert!(
            (0.9..=1.1).contains(&r),
            "state {state}: the outline is {r} of the contact area"
        );
    }
    eprintln!("outline over contact area, the farthest from 1 (pinned, sliding, merging, hanging): {worst:?} in {seen:?} drops");
    assert!(seen.iter().all(|&n| n > 10), "{seen:?}");
}

#[test]
fn the_water_table_measures_depinning_at_the_critical_size() {
    // Glass at 60° under the default rain falling onto it square-on, for 4 s.
    let rain = WaterRain {
        density: 2.0e-5,
        speed: 6576.0,
        size_mm: 1.2,
        size_var: 0.4,
    };
    let glass = WaterFamily {
        name: "GLASS".into(),
        advancing_deg: GLASS_ADVANCING_DEG,
        receding_deg: GLASS_RECEDING_DEG,
    };
    let row = water_row(&glass, 60.0, rain, 4.0);
    let crit = 2.0
        * critical_radius(
            GLASS_ADVANCING_DEG,
            GLASS_RECEDING_DEG,
            60f32.to_radians().sin(),
        );
    assert!((row.critical_radius_mm * 2.0 / crit - 1.0).abs() < 1e-4);
    // The drops start to slide at their critical size, or a little past it (a merge overshoots).
    let d = row.depin_contact_mm;
    assert!(d.count > 10, "{d:?}");
    assert!(
        d.min > 0.95 * crit && d.median < 1.15 * crit,
        "{d:?} vs {crit}"
    );
    assert!(row.runner_contact_mm.count > 0);
    assert_eq!(row.pearls, 0);
    // Its outline is the contact area, within the renderer's points.
    for q in &row.outline {
        if q.count > 0 {
            assert!(q.min > 0.95 && q.max < 1.05, "{q:?}");
        }
    }
}
