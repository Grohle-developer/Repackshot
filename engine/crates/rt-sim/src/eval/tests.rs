use super::*;
use crate::params::{DROP_TAIL, FLAG_CAMERA, FLAG_REFLECTIONS, FLAG_SHADOW};

/// Floating dust in a box around a 300 mm part, with turbulence.
fn dust(count: u32) -> AmbientParams {
    AmbientParams {
        kind: 1,
        seed: 11,
        time: 0.0,
        count,
        region_centre: [0.0, 0.0, 200.0],
        region_half: [300.0, 250.0, 200.0],
        size_mm: 0.15,
        size_var: 0.5,
        fall_speed: 8.0,
        fall_var: 0.5,
        wind: [20.0, 5.0, 0.0],
        turbulence: [12.0, 90.0, 25.0],
        tint_var: 0.3,
        energy: 30.0,
        flags: FLAG_CAMERA | FLAG_REFLECTIONS | FLAG_SHADOW,
        ..AmbientParams::default()
    }
}

/// Rain through a box that reaches below the ground, slanted by the wind.
fn rain(count: u32) -> AmbientParams {
    AmbientParams {
        kind: 3,
        seed: 5,
        time: 0.0,
        count,
        region_centre: [0.0, 0.0, 100.0],
        region_half: [400.0, 400.0, 500.0],
        size_mm: 1.2,
        size_var: 0.4,
        shape: Shape::Capsule,
        fall_speed: 6500.0,
        fall_var: 0.25,
        wind: [800.0, 0.0, 0.0],
        turbulence: [40.0, 200.0, 100.0],
        streak: 0.015,
        ..AmbientParams::default()
    }
}

/// Snow: slow spinning flakes.
fn snow(count: u32) -> AmbientParams {
    AmbientParams {
        kind: 4,
        seed: 3,
        count,
        region_centre: [0.0, 0.0, 300.0],
        region_half: [300.0, 300.0, 300.0],
        size_mm: 4.0,
        size_var: 0.4,
        shape: Shape::Disc,
        fall_speed: 900.0,
        fall_var: 0.3,
        wind: [150.0, 60.0, 0.0],
        turbulence: [25.0, 150.0, 60.0],
        spin: 0.7,
        ..AmbientParams::default()
    }
}

fn at(mut p: AmbientParams, time: f32) -> AmbientParams {
    p.time = time;
    p
}

#[test]
fn any_prefix_and_any_order_give_the_same_particles() {
    for params in [dust(3000), rain(3000), snow(3000)] {
        let all = evaluate(&params, u32::MAX);
        assert_eq!(all.len(), 3000);
        assert_eq!(evaluate(&params, 1000), all[..1000].to_vec());
        // Chunks evaluated from the last to the first, as threads might finish them.
        let mut chunks: Vec<Vec<Particle>> = (0..6)
            .rev()
            .map(|c| evaluate_range(&params, c * 500, c * 500 + 500))
            .collect();
        chunks.reverse();
        let joined: Vec<Particle> = chunks.into_iter().flatten().collect();
        assert_eq!(positions_hash(&joined), positions_hash(&all));
        assert_eq!(joined, all);
        // One particle alone is the same particle.
        let e = Evaluator::new(&params);
        assert_eq!(e.particle(2999), all[2999]);
        assert!(all.iter().enumerate().all(|(i, p)| p.id == i as u32));
    }
    assert!(evaluate_range(&dust(10), 8, 4).is_empty());
    assert_eq!(evaluate_range(&dust(10), 8, 400).len(), 2);
}

#[cfg(not(target_family = "wasm"))]
#[test]
fn the_number_of_threads_does_not_matter() {
    let params = dust(8000);
    let one = positions_hash(&evaluate(&params, u32::MAX));
    for threads in [2u32, 3, 7] {
        let per = params.count.div_ceil(threads);
        let parts: Vec<Vec<Particle>> = std::thread::scope(|s| {
            let handles: Vec<_> = (0..threads)
                .map(|t| s.spawn(move || evaluate_range(&params, t * per, (t + 1) * per)))
                .collect();
            handles.into_iter().map(|h| h.join().unwrap()).collect()
        });
        let joined: Vec<Particle> = parts.into_iter().flatten().collect();
        assert_eq!(positions_hash(&joined), one, "{threads} threads");
    }
}

/// The hash of the reference effect (`reference_effect`): native and WebAssembly must both give it
/// (`rt_particles_eval` in tools/wasm-parity.mjs `--particles`).
pub const PINNED_PARTICLES_HASH: u32 = 0x41c4_28cf;

/// What the parity check evaluates: the dust, at 2.5 s, 4096 particles.
pub fn reference_effect() -> AmbientParams {
    at(dust(4096), 2.5)
}

#[test]
fn the_reference_effect_keeps_its_hash() {
    let h = positions_hash(&evaluate(&reference_effect(), u32::MAX));
    assert_eq!(h, PINNED_PARTICLES_HASH, "got {h:#010x}");
}

/// Particles inside the inner 80 % of the region box, split by height into a lower and an upper
/// half.
fn inner_counts(params: &AmbientParams, particles: &[Particle]) -> (usize, usize) {
    let c = params.region_centre;
    let h = params.region_half;
    let lo_z = (c[2] - h[2]).max(0.0);
    let hi_z = c[2] + h[2];
    let (mid_z, half_z) = ((lo_z + hi_z) / 2.0, (hi_z - lo_z) / 2.0);
    let inside = |p: &&Particle| {
        (p.centre[0] - c[0]).abs() < 0.8 * h[0]
            && (p.centre[1] - c[1]).abs() < 0.8 * h[1]
            && (p.centre[2] - mid_z).abs() < 0.8 * half_z
    };
    let kept: Vec<&Particle> = particles.iter().filter(inside).collect();
    let low = kept.iter().filter(|p| p.centre[2] < mid_z).count();
    (low, kept.len() - low)
}

#[test]
fn the_density_is_steady_from_the_first_instant() {
    for params in [dust(200_000), rain(200_000)] {
        let counts: Vec<(usize, usize)> = [0.0, 3.0, 60.0]
            .iter()
            .map(|&t| {
                let p = at(params, t);
                inner_counts(&p, &evaluate(&p, u32::MAX))
            })
            .collect();
        let (low0, high0) = counts[0];
        let total0 = (low0 + high0) as f32;
        for &(low, high) in &counts {
            let total = (low + high) as f32;
            assert!(
                ((total - total0) / total0).abs() < 0.03,
                "kind {}: {counts:?}",
                params.kind
            );
            // And it fills the box: the upper half of it holds as many as the lower half.
            assert!(
                ((low as f32 - high as f32) / total).abs() < 0.03,
                "kind {}: {counts:?}",
                params.kind
            );
        }
        // About the share of the box's volume: 0.8³ of the particles.
        assert!((total0 / 200_000.0 - 0.512).abs() < 0.03, "{counts:?}");
    }
}

#[test]
fn nothing_is_ever_below_the_ground() {
    let mut cloud = dust(20_000);
    cloud.cloud_radius = 150.0;
    cloud.cloud_softness = 0.8;
    cloud.cloud_centre = [0.0, 0.0, 40.0];
    cloud.turbulence = [80.0, 60.0, 50.0];
    for params in [rain(20_000), snow(20_000), cloud] {
        for t in [0.0, 0.37, 3.0, 60.0] {
            let p = at(params, t);
            let below = evaluate(&p, u32::MAX)
                .iter()
                .filter(|q| q.centre[2] < 0.0)
                .count();
            assert_eq!(below, 0, "kind {} at {t}", p.kind);
        }
    }
}

#[test]
fn rain_dies_on_the_ground_and_is_born_again_above() {
    let mut params = rain(64);
    params.turbulence = [0.0; 3];
    params.fall_var = 0.0;
    params.wind = [0.0; 3];
    let top = params.region_centre[2] + params.region_half[2];
    let mut falls = 0;
    let mut rebirths = 0;
    for id in 0..64 {
        let mut last = Evaluator::new(&at(params, 0.0)).particle(id).centre[2];
        for step in 1..200 {
            let z = Evaluator::new(&at(params, step as f32 * 0.004))
                .particle(id)
                .centre[2];
            assert!((0.0..=top).contains(&z));
            if z < last {
                falls += 1;
                // 4 ms at 6.5 m/s: 26 mm.
                assert!((last - z - 26.0).abs() < 0.5, "{last} -> {z}");
            } else {
                // Died on the ground (the last step took it below), born again on the top.
                rebirths += 1;
                assert!(last < 26.5 && z > top - 26.5, "{last} -> {z}");
            }
            last = z;
        }
    }
    // A life of 600 mm at 6.5 m/s is 92 ms: 23 steps of 4 ms.
    assert!(
        falls > 15 * rebirths && falls < 30 * rebirths,
        "{falls} falls, {rebirths} rebirths"
    );
    assert!(rebirths > 0);
}

#[test]
fn streaks_follow_the_velocity_and_flakes_have_unit_normals() {
    let mut params = rain(500);
    params.turbulence = [0.0; 3];
    params.fall_var = 0.0;
    for p in evaluate(&params, u32::MAX) {
        // Half of 15 ms of (800, 0, -6500) mm/s.
        assert!(
            (p.axis[0] - 6.0).abs() < 1.0e-3
                && p.axis[1].abs() < 1.0e-6
                && (p.axis[2] + 48.75).abs() < 1.0e-2,
            "{:?}",
            p.axis
        );
        assert!(p.radius > 0.0 && p.radius <= 0.6 * 1.4 + 1.0e-6);
    }
    for t in [0.0, 1.3] {
        for p in evaluate(&at(snow(500), t), u32::MAX) {
            assert!((dot(p.axis, p.axis) - 1.0).abs() < 1.0e-4, "{:?}", p.axis);
        }
    }
    assert!(evaluate(&dust(50), u32::MAX)
        .iter()
        .all(|p| p.axis == [0.0; 3]));
}

#[test]
fn spinning_flakes_turn_with_time_and_still_ones_do_not() {
    let mut still = snow(1);
    still.spin = 0.0;
    let n = |p: AmbientParams, t: f32| Evaluator::new(&at(p, t)).particle(0).axis;
    // Same life (10 s lives would be cut by the fall: keep it within a few milliseconds).
    let (a, b) = (n(snow(1), 0.0), n(snow(1), 0.05));
    assert!(dot(a, b) < 0.9999, "{a:?} {b:?}");
    assert_eq!(n(still, 0.0), n(still, 0.05));
}

#[test]
fn the_tables_agree_with_fmath() {
    let e = Evaluator::new(&dust(1));
    for i in 0..2000 {
        let x = i as f32 * 0.0091;
        assert!((e.exp_neg(x) - fmath::exp(-x)).abs() < 5.0e-5, "{x}");
        let turns = i as f32 * 0.0017 - 1.3;
        let (s, c) = e.sin_cos_turns(turns);
        let (fs, fc) = fmath::sin_cos(turns * fmath::TAU);
        assert!(
            (s - fs).abs() < 2.0e-5 && (c - fc).abs() < 2.0e-5,
            "{turns}"
        );
    }
    assert!(e.exp_neg(40.0) < 2.0e-7);
}

#[test]
fn the_curl_is_normalised_to_about_one() {
    let mut sum = 0.0f32;
    let n = 4000;
    for i in 0..n {
        let q = [
            i as f32 * 0.0173,
            i as f32 * 0.0311 + 0.5,
            i as f32 * 0.0057 - 3.0,
        ];
        let c = crate::noise::curl(42, q);
        sum += dot(c, c).sqrt() * CURL_NORM;
    }
    let mean = sum / n as f32;
    assert!((0.8..1.25).contains(&mean), "mean {mean}");
}

#[test]
fn a_cloud_stays_a_cloud_and_softness_spreads_it() {
    let make = |soft: f32| AmbientParams {
        cloud_radius: 100.0,
        cloud_softness: soft,
        cloud_centre: [0.0, 0.0, 200.0],
        turbulence: [0.0; 3],
        wind: [0.0; 3],
        energy: 0.0,
        fall_speed: 0.0,
        ..dust(20_000)
    };
    let spread = |soft: f32| -> (f32, f32) {
        let ps = evaluate(&make(soft), u32::MAX);
        let r: Vec<f32> = ps
            .iter()
            .map(|p| {
                dot(
                    add(p.centre, [0.0, 0.0, -200.0]),
                    add(p.centre, [0.0, 0.0, -200.0]),
                )
                .sqrt()
            })
            .collect();
        let max = r.iter().cloned().fold(0.0, f32::max);
        let inside = r.iter().filter(|&&d| d < 100.0).count() as f32 / r.len() as f32;
        (max, inside)
    };
    let (hard_max, hard_inside) = spread(0.0);
    // Nothing moves: a hard edge holds everything.
    assert!(
        hard_max <= 100.0 && hard_inside == 1.0,
        "{hard_max} {hard_inside}"
    );
    let (soft_max, soft_inside) = spread(1.0);
    assert!(
        soft_max > hard_max && soft_inside < hard_inside,
        "{soft_max} {soft_inside} {hard_inside}"
    );
}

#[test]
fn the_seed_and_the_time_change_the_particles() {
    let a = evaluate(&dust(100), u32::MAX);
    let mut other = dust(100);
    other.seed = 12;
    assert_ne!(
        positions_hash(&a),
        positions_hash(&evaluate(&other, u32::MAX))
    );
    assert_ne!(
        positions_hash(&a),
        positions_hash(&evaluate(&at(dust(100), 0.5), u32::MAX))
    );
    // Sizes vary within the variation.
    for p in &a {
        assert!(p.radius >= 0.5 * 0.15 * 0.5 - 1.0e-6 && p.radius <= 0.5 * 0.15 * 1.5 + 1.0e-6);
    }
}

#[test]
fn tints_pick_the_palette_and_vary_within_the_variation() {
    let mut params = dust(1);
    params.tint_var = 0.0;
    assert_eq!(tint_factor(&params, 12345), [1.0; 3]);
    params.palette_count = 2;
    params.palette[0] = [1.0, 0.0, 0.0];
    params.palette[1] = [0.0, 0.0, 1.0];
    assert_eq!(tint_factor(&params, 4), [1.0, 0.0, 0.0]);
    assert_eq!(tint_factor(&params, 5), [0.0, 0.0, 1.0]);
    params.palette_count = 0;
    params.tint_var = 1.0;
    let mut spread = 0.0f32;
    for t in 0..500u32 {
        let c = tint_factor(&params, t.wrapping_mul(2_654_435_761));
        for v in c {
            assert!(
                (0.5 * 0.85 - 1.0e-6..=1.5 * 1.15 + 1.0e-6).contains(&v),
                "{c:?}"
            );
        }
        spread = spread.max((c[0] - 1.0).abs());
    }
    assert!(spread > 0.3, "{spread}");
}

/// Rain of drops (S3): the rain of [`rain`] with the drop shape, no turbulence and one fall speed.
fn drops(count: u32) -> AmbientParams {
    AmbientParams {
        shape: Shape::Drop,
        turbulence: [0.0; 3],
        fall_var: 0.0,
        ..rain(count)
    }
}

#[test]
fn drops_trail_their_tip_behind_them_at_the_tail_s_length() {
    let mut params = drops(500);
    params.drop_tail = 2.0;
    params.drop_tip = 0.2;
    // The velocity is (800, 0, -6500) mm/s: the tip trails it, up and against the wind.
    let v = [800.0f32, 0.0, -6500.0];
    let speed = dot(v, v).sqrt();
    for p in evaluate(&params, u32::MAX) {
        assert_eq!(p.shape, Shape::Drop);
        let len = dot(p.axis, p.axis).sqrt();
        assert!(
            (len - 2.0 * p.radius).abs() <= 1.0e-4 * p.radius.max(1.0),
            "{len} {}",
            p.radius
        );
        let along = dot(p.axis, v) / (len * speed);
        assert!((along + 1.0).abs() < 1.0e-4, "{along}");
        assert!(p.axis[2] > 0.0, "the tip points up: {:?}", p.axis);
    }
    // A tail that would bury the tip in the body sticks out by the floor.
    params.drop_tail = 0.1;
    for p in evaluate(&params, 50) {
        let len = dot(p.axis, p.axis).sqrt();
        let want = (1.0 - 0.2 + MIN_DROP_PROTRUSION) * p.radius;
        assert!(
            (len - want).abs() <= 1.0e-4 * p.radius.max(1.0),
            "{len} vs {want}"
        );
    }
    // A drop that does not move points along its life's random normal: unit times the tail.
    let mut still = drops(200);
    still.fall_speed = 0.0;
    still.wind = [0.0; 3];
    still.energy = 0.0;
    for p in evaluate(&still, u32::MAX) {
        let len = dot(p.axis, p.axis).sqrt();
        assert!((len - DROP_TAIL * p.radius).abs() <= 1.0e-4 * p.radius.max(1.0));
    }
}

#[test]
fn a_shape_changes_no_position_and_a_mix_follows_its_weights() {
    // The shape and the mix decide the axes and the shapes, never where the particles are, how big
    // they are or their tints: the same centres, radii and tints as the capsules of S4a.
    let capsules = evaluate(&rain(4000), u32::MAX);
    for p in [
        AmbientParams {
            shape: Shape::Drop,
            ..rain(4000)
        },
        AmbientParams {
            mix: [1.0, 1.0, 1.0, 1.0],
            shape_var: 0.5,
            ..rain(4000)
        },
    ] {
        for (a, b) in evaluate(&p, u32::MAX).iter().zip(&capsules) {
            assert_eq!(
                (a.centre, a.radius, a.tint, a.id),
                (b.centre, b.radius, b.tint, b.id)
            );
        }
    }
    // Without a mix nor variation, the capsules are S4a's bit for bit (their S3 fields at the
    // defaults), and their shape is the effect's.
    assert!(capsules.iter().all(|p| p.shape == Shape::Capsule));
    // A mix of 1 : 2 : 0 : 5 over 40 000 particles: each share within 1.5 % of its weight's.
    let mixed = AmbientParams {
        mix: [1.0, 2.0, 0.0, 5.0],
        ..rain(40_000)
    };
    let all = evaluate(&mixed, u32::MAX);
    let mut counts = [0usize; 4];
    for p in &all {
        counts[p.shape.to_u32() as usize] += 1;
    }
    for (k, w) in [1.0f32, 2.0, 0.0, 5.0].iter().enumerate() {
        let share = counts[k] as f32 / all.len() as f32;
        assert!((share - w / 8.0).abs() < 0.015, "shape {k}: {share}");
    }
    // Each particle keeps its shape at any instant (it is drawn once, not per life).
    let later = evaluate(&at(mixed, 3.7), u32::MAX);
    assert!(all.iter().zip(&later).all(|(a, b)| a.shape == b.shape));
    assert_ne!(shapes_hash(&all), shapes_hash(&capsules[..0]));
    // Discs of a mix have unit normals, capsules follow the velocity, spheres have no axis.
    for p in &all {
        match p.shape {
            Shape::Disc => assert!((dot(p.axis, p.axis) - 1.0).abs() < 1.0e-4),
            Shape::Sphere => assert_eq!(p.axis, [0.0; 3]),
            _ => assert!(dot(p.axis, p.axis) > 0.0),
        }
    }
}

#[test]
fn the_shape_variation_stretches_drops_and_capsules_each_its_own_way() {
    let mut params = drops(3000);
    params.shape_var = 0.5;
    // A wide tip, so that no tail reaches its floor (1 - tip + MIN_DROP_PROTRUSION).
    params.drop_tip = 0.9;
    let all = evaluate(&params, u32::MAX);
    let ratios: Vec<f32> = all
        .iter()
        .map(|p| dot(p.axis, p.axis).sqrt() / (DROP_TAIL * p.radius))
        .collect();
    let (lo, hi) = ratios
        .iter()
        .fold((f32::MAX, f32::MIN), |(lo, hi), &r| (lo.min(r), hi.max(r)));
    // Within ± 50 %, spread over most of it (the floor of the tail is far below).
    assert!(lo >= 0.5 - 1.0e-4 && hi <= 1.5 + 1.0e-4, "{lo} {hi}");
    assert!(lo < 0.55 && hi > 1.45, "{lo} {hi}");
    let mean = ratios.iter().sum::<f32>() / ratios.len() as f32;
    assert!((mean - 1.0).abs() < 0.03, "{mean}");
    // The capsules of the same rain, by the same factor.
    let mut streaks = rain(3000);
    streaks.turbulence = [0.0; 3];
    streaks.fall_var = 0.0;
    streaks.shape_var = 0.5;
    for (c, r) in evaluate(&streaks, u32::MAX).iter().zip(&ratios) {
        let half = 0.5 * 0.015 * dot([800.0, 0.0, -6500.0], [800.0, 0.0, -6500.0]).sqrt();
        let got = dot(c.axis, c.axis).sqrt() / half;
        assert!((got - r).abs() < 1.0e-3, "{got} {r}");
    }
}
