//! Tests of the enhanced thin lens (O1). The geometry is checked in `f64` where the test needs a
//! reference; the engine itself stays in `f32`.

use super::pupil::{
    Grid, Iris, Profile, Pupil, PROFILE_APODIZED, PROFILE_CENTRE_BRIGHT, PROFILE_RING_BRIGHT,
    PROFILE_UNIFORM,
};
use super::*;
use crate::color::Rgb;
use crate::example::busy_lens;
use crate::image::Film;
use crate::math::{Ray, Vec3};
use crate::render::{render_tile, render_tile_with, TileRect};
use crate::rng::Pcg32;
use crate::sampler::{PixelSampler, DIM_LENS, DIM_LENS_BAND};
use crate::scene::{Camera, EnvKind, Environment, Scene};
use crate::simd::Isa;

/// `n` stratified pupil numbers: the lens dimensions of one pixel's samples `0..n`.
fn lens_numbers(n: u32) -> impl Iterator<Item = (f32, f32)> {
    (0..n).map(|i| PixelSampler::new(7, 3, 5, i).get2(DIM_LENS))
}

fn lens(params: LensParams) -> Lens {
    Lens::new(params).expect("valid lens")
}

#[test]
fn six_blades_fall_inside_the_hexagon_and_outside_its_incircle_in_proportion() {
    // A straight hexagon of circumradius 1 has area (6/2) sin 60° and its incircle π cos² 30°:
    // a uniform sample is outside the incircle with probability 1 − π cos² 30° / (3 sin 60°).
    let iris = Iris::new(6, 0.0, 0.0);
    let pupil = Pupil::analytic(&iris, Profile::new(PROFILE_UNIFORM, 0.0, 0.0));
    let apothem = (std::f64::consts::PI / 6.0).cos();
    let expected =
        1.0 - std::f64::consts::PI * apothem * apothem / (3.0 * (std::f64::consts::PI / 3.0).sin());
    let n = 1 << 16;
    let mut outside = 0u32;
    for u in lens_numbers(n) {
        let (x, y) = pupil.sample(u);
        assert!(
            iris.signed_distance(x, y) <= 1.0e-6,
            "({x}, {y}) is outside the hexagon"
        );
        if f64::from(x).hypot(f64::from(y)) > apothem {
            outside += 1;
        }
    }
    let got = f64::from(outside) / f64::from(n);
    assert!(
        (got / expected - 1.0).abs() < 0.01,
        "outside the incircle: {got}, expected {expected}"
    );
}

#[test]
fn curved_blades_stay_inside_their_arcs_and_cover_the_whole_opening() {
    // Roundness 0.5 (the curved masks of A6): every sample inside the opening, which lies between
    // the incircle and the straight polygon; its points reach the arcs' ends.
    for blades in [5u32, 7, 9] {
        let iris = Iris::new(blades, 0.5, 13.0);
        let straight = Iris::new(blades, 0.0, 13.0);
        let pupil = Pupil::analytic(&iris, Profile::new(PROFILE_UNIFORM, 0.0, 0.0));
        let mut far = 0.0f32;
        for u in lens_numbers(1 << 14) {
            let (x, y) = pupil.sample(u);
            assert!(
                iris.signed_distance(x, y) <= 1.0e-4,
                "{blades} blades: ({x}, {y})"
            );
            assert!(straight.signed_distance(x, y) <= 1.0e-5);
            far = far.max((x * x + y * y).sqrt());
        }
        let apothem = fmath::cos(fmath::PI / blades as f32);
        assert!(
            far > apothem + 0.02,
            "{blades} blades: the corners are never reached ({far})"
        );
    }
}

/// The mean of `s = ρ²` under the profile, by a fine midpoint rule in `f64`.
fn profile_mean_s(profile: &Profile) -> f64 {
    let n = 200_000;
    let (mut num, mut den) = (0.0f64, 0.0f64);
    for i in 0..n {
        let s = (i as f64 + 0.5) / n as f64;
        let w = f64::from(profile.weight(s as f32));
        num += s * w;
        den += w;
    }
    num / den
}

#[test]
fn every_profile_is_sampled_with_its_own_density() {
    for (kind, k, eps) in [
        (PROFILE_UNIFORM, 0.0, 0.0),
        (PROFILE_UNIFORM, 0.0, 0.49),
        (PROFILE_CENTRE_BRIGHT, 0.8, 0.0),
        (PROFILE_CENTRE_BRIGHT, 1.0, 0.3),
        (PROFILE_RING_BRIGHT, 0.75, 0.0),
        (PROFILE_RING_BRIGHT, 1.0, 0.2),
        (PROFILE_APODIZED, 0.4, 0.0),
        (PROFILE_APODIZED, 0.15, 0.1),
    ] {
        let profile = Profile::new(kind, k, eps);
        let n = 1 << 15;
        let mut sum = 0.0f64;
        for (i, (u, _)) in lens_numbers(n).enumerate() {
            let s = profile.sample_s(u);
            assert!(
                s >= eps * eps * 0.999_99 && s <= 1.0,
                "profile {kind}: s = {s} at {i}"
            );
            sum += f64::from(s);
        }
        let got = sum / f64::from(n);
        let want = profile_mean_s(&profile);
        assert!(
            (got / want - 1.0).abs() < 0.005,
            "profile {kind} k {k} ε {eps}: E[s] {got} against {want}"
        );
    }
}

#[test]
fn an_obstruction_leaves_the_centre_dark_on_a_disc_and_on_a_polygon() {
    for blades in [0u32, 6] {
        let l = lens(LensParams {
            blades,
            obstruction: 0.49,
            ..LensParams::default()
        });
        let iris = Iris::new(blades, 0.0, 0.0);
        for u in lens_numbers(4096) {
            let (x, y) = l.pupil().sample(u);
            assert!(
                iris.gauge(x, y) >= 0.49 * 0.9999,
                "{blades} blades: ({x}, {y}) in the hole"
            );
        }
    }
}

/// The closest point between two rays (the middle of the shortest segment), in `f64`.
fn meeting_point(a: &Ray, b: &Ray) -> ([f64; 3], f64) {
    let v = |p: Vec3| [f64::from(p.x), f64::from(p.y), f64::from(p.z)];
    let (o1, d1, o2, d2) = (v(a.origin), v(a.dir), v(b.origin), v(b.dir));
    let dot = |p: [f64; 3], q: [f64; 3]| p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
    let w = [o1[0] - o2[0], o1[1] - o2[1], o1[2] - o2[2]];
    let (aa, bb, cc, dd, ee) = (
        dot(d1, d1),
        dot(d1, d2),
        dot(d2, d2),
        dot(d1, w),
        dot(d2, w),
    );
    let den = aa * cc - bb * bb;
    let s = (bb * ee - cc * dd) / den;
    let t = (aa * ee - bb * dd) / den;
    let p = [o1[0] + d1[0] * s, o1[1] + d1[1] * s, o1[2] + d1[2] * s];
    let q = [o2[0] + d2[0] * t, o2[1] + d2[1] * t, o2[2] + d2[2] * t];
    let gap = ((p[0] - q[0]).powi(2) + (p[1] - q[1]).powi(2) + (p[2] - q[2]).powi(2)).sqrt();
    (
        [
            (p[0] + q[0]) / 2.0,
            (p[1] + q[1]) / 2.0,
            (p[2] + q[2]) / 2.0,
        ],
        gap,
    )
}

fn tilted_camera(tilt_deg: f32, axis_deg: f32) -> Camera {
    Camera {
        position: Vec3::new(0.0, -1000.0, 0.0),
        target: Vec3::ZERO,
        focal_mm: 50.0,
        fstop: 2.0,
        focus_dist: 1000.0,
        lens: Some(lens(LensParams {
            tilt_deg,
            tilt_axis_deg: axis_deg,
            ..LensParams::default()
        })),
        ..Camera::default()
    }
}

#[test]
fn a_tilt_moves_the_focus_plane_as_scheimpflug_and_the_hinge_rule_say() {
    // Three points of the image, each where three rays through different points of the pupil
    // meet. The plane through them must hold the focus point on the axis, the hinge line (the
    // lens's front focal plane ∩ the plane through the lens parallel to the sensor, f / sin α
    // from the lens) and the Scheimpflug line (the sensor plane, f u / (u cos α − f) behind the
    // lens, ∩ the lens plane).
    for (tilt, axis) in [(8.0f32, 0.0f32), (-5.0, 0.0), (6.0, 90.0), (4.0, 30.0)] {
        let cam = tilted_camera(tilt, axis);
        let normal = cam.lens.as_ref().map(|l| l.lens_normal(&cam)).unwrap();
        let pupil = [(0.9, 0.0), (-0.3, 0.8), (0.0, -0.9)];
        let points: Vec<[f64; 3]> = [(0.5, 0.5), (0.2, 0.15), (0.85, 0.9)]
            .iter()
            .map(|&(u, v)| {
                let rays: Vec<Ray> = pupil
                    .iter()
                    .map(|&p| cam.generate_ray(1.5, u, v, p))
                    .collect();
                // The pupil turned with the lens: every ray leaves from the lens plane, as far
                // from its centre as on an untilted lens.
                for (ray, &(px, py)) in rays.iter().zip(&pupil) {
                    let from = ray.origin - cam.position;
                    let radius = cam.lens_radius() * (px * px + py * py).sqrt();
                    assert!(
                        from.dot(normal).abs() < 1.0e-3,
                        "tilt {tilt}: a pupil point {} mm off the lens plane",
                        from.dot(normal)
                    );
                    assert!(
                        (from.length() - radius).abs() < 1.0e-3,
                        "tilt {tilt}: a pupil point at {} mm, not {radius}",
                        from.length()
                    );
                }
                let (p01, gap01) = meeting_point(&rays[0], &rays[1]);
                let (p02, gap02) = meeting_point(&rays[0], &rays[2]);
                assert!(
                    gap01 < 0.05 && gap02 < 0.05,
                    "the rays of ({u}, {v}) do not meet"
                );
                let d = ((p01[0] - p02[0]).powi(2)
                    + (p01[1] - p02[1]).powi(2)
                    + (p01[2] - p02[2]).powi(2))
                .sqrt();
                assert!(
                    d < 0.2,
                    "three rays of ({u}, {v}) meet in two places, {d} mm apart"
                );
                p01
            })
            .collect();
        let sub = |p: [f64; 3], q: [f64; 3]| [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
        let (e1, e2) = (sub(points[1], points[0]), sub(points[2], points[0]));
        let n = [
            e1[1] * e2[2] - e1[2] * e2[1],
            e1[2] * e2[0] - e1[0] * e2[2],
            e1[0] * e2[1] - e1[1] * e2[0],
        ];
        let len = (n[0] * n[0] + n[1] * n[1] + n[2] * n[2]).sqrt();
        let n = [n[0] / len, n[1] / len, n[2] / len];
        let off = |p: [f64; 3]| {
            let d = sub(p, points[0]);
            (d[0] * n[0] + d[1] * n[1] + d[2] * n[2]).abs()
        };
        // The camera frame: forward +Y, right +X, up +Z; the tilt axis a and b = forward × a.
        let (ra, a_rad) = (f64::from(tilt).to_radians(), f64::from(axis).to_radians());
        let a = [a_rad.cos(), 0.0, a_rad.sin()];
        let fwd = [0.0, 1.0, 0.0];
        let b = [
            fwd[1] * a[2] - fwd[2] * a[1],
            fwd[2] * a[0] - fwd[0] * a[2],
            fwd[0] * a[1] - fwd[1] * a[0],
        ];
        let (f, u) = (50.0f64, 1000.0f64);
        let pos = [0.0, -1000.0, 0.0];
        let at = |base: [f64; 3], dir: [f64; 3], t: f64| {
            [
                base[0] + dir[0] * t,
                base[1] + dir[1] * t,
                base[2] + dir[2] * t,
            ]
        };
        assert!(
            off(at(pos, fwd, u)) < 0.5,
            "tilt {tilt}: the focus point is off the plane by {}",
            off(at(pos, fwd, u))
        );
        let hinge = at(pos, b, f / ra.sin());
        let v = f * u / (u * ra.cos() - f);
        let scheimpflug = at(at(pos, fwd, -v), b, v * ra.cos() / ra.sin());
        for t in [-400.0, 0.0, 400.0] {
            assert!(
                off(at(hinge, a, t)) < 0.5,
                "tilt {tilt}: the hinge line is {} mm off",
                off(at(hinge, a, t))
            );
            assert!(
                off(at(scheimpflug, a, t)) < 0.5,
                "tilt {tilt}: the Scheimpflug line is {} mm off",
                off(at(scheimpflug, a, t))
            );
        }
        // And the plane really turned: tan ψ = u sin α / f against the sensor-parallel plane.
        let psi = (n[1].abs()).acos();
        assert!(
            (psi.tan() - u * ra.sin().abs() / f).abs() < 0.01 * (u * ra.sin().abs() / f),
            "tilt {tilt}: ψ {psi}"
        );
    }
}

#[test]
fn a_positive_tilt_about_the_horizontal_axis_leans_the_focus_plane_back_to_the_floor() {
    // Lens tipped down: the bottom of the frame focuses nearer, the top farther.
    let cam = tilted_camera(3.0, 0.0);
    let depth_at = |v: f32| {
        let a = cam.generate_ray(1.0, 0.5, v, (0.8, 0.0));
        let b = cam.generate_ray(1.0, 0.5, v, (-0.8, 0.3));
        meeting_point(&a, &b).0[1] + 1000.0
    };
    assert!(
        depth_at(0.9) < 1000.0 && depth_at(0.1) > 1000.0,
        "{} {}",
        depth_at(0.9),
        depth_at(0.1)
    );
}

#[test]
fn without_a_tilt_a_shift_moves_the_frame_and_keeps_the_focus_plane() {
    let base = tilted_camera(0.0, 0.0);
    let shifted = Camera {
        lens: Some(lens(LensParams {
            shift_x_mm: 0.0,
            shift_y_mm: 6.0,
            ..LensParams::default()
        })),
        ..base.clone()
    };
    let centre = shifted.generate_ray(1.5, 0.5, 0.5, (0.0, 0.0));
    // Lens rise of 6 mm on a 50 mm lens: the frame's centre looks up by atan(6 / 50).
    assert!(
        (centre.dir.z / centre.dir.y - 6.0 / 50.0).abs() < 1.0e-6,
        "{:?}",
        centre.dir
    );
    // Still focused on the plane y = 0 (1000 mm along the axis).
    let a = shifted.generate_ray(1.5, 0.3, 0.2, (0.7, 0.1));
    let b = shifted.generate_ray(1.5, 0.3, 0.2, (-0.4, -0.6));
    assert!(meeting_point(&a, &b).0[1].abs() < 0.05);
    // The neutral lens is the plain thin lens, bit for bit.
    let plain = Camera {
        lens: None,
        ..base.clone()
    };
    for (u, v, p) in [
        (0.5, 0.5, (0.0, 0.0)),
        (0.1, 0.8, (0.3, -0.7)),
        (0.97, 0.02, (-0.9, 0.1)),
    ] {
        assert_eq!(
            base.generate_ray(1.5, u, v, p),
            plain.generate_ray(1.5, u, v, p)
        );
    }
}

#[test]
fn an_anamorphic_squeeze_makes_the_pupil_narrow_and_tall() {
    let cam = Camera {
        lens: Some(lens(LensParams {
            squeeze: 2.0,
            ..LensParams::default()
        })),
        ..tilted_camera(0.0, 0.0)
    };
    let radius = cam.lens_radius();
    let (mut wide, mut tall) = (0.0f32, 0.0f32);
    for i in 0..4096 {
        let s = PixelSampler::new(1, 2, 3, i);
        let (ray, w) = cam.sample_ray(1.0, 0.5, 0.5, &s);
        assert_eq!(w, Rgb::WHITE);
        let o = ray.origin - cam.position;
        wide = wide.max(o.x.abs() / radius);
        tall = tall.max(o.z.abs() / radius);
    }
    assert!(wide <= 0.5 + 1.0e-5 && wide > 0.49, "half width {wide}");
    assert!(tall > 0.99, "half height {tall}");
}

#[test]
fn the_cats_eye_blocks_the_part_of_the_pupil_outside_the_second_disc() {
    // At the corner (h = 1) with cats_eye 0.7 the pupil is the overlap of two unit discs 0.7
    // apart: 2 acos(d/2) − (d/2) sqrt(4 − d²) of π.
    let cam = Camera {
        lens: Some(lens(LensParams {
            cats_eye: 0.7,
            ..LensParams::default()
        })),
        ..tilted_camera(0.0, 0.0)
    };
    let d = 0.7f64;
    let overlap =
        (2.0 * (d / 2.0).acos() - (d / 2.0) * (4.0 - d * d).sqrt()) / std::f64::consts::PI;
    let n = 1 << 14;
    let mut passed = 0;
    for i in 0..n {
        let (_, w) = cam.sample_ray(1.5, 0.0, 0.0, &PixelSampler::new(4, 0, 0, i));
        if w == Rgb::WHITE {
            passed += 1;
        } else {
            assert_eq!(w, Rgb::BLACK);
        }
    }
    let got = f64::from(passed) / f64::from(n);
    assert!(
        (got / overlap - 1.0).abs() < 0.01,
        "passed {got}, overlap {overlap}"
    );
    // On the axis nothing is clipped.
    for i in 0..256 {
        assert_eq!(
            cam.sample_ray(1.5, 0.5, 0.5, &PixelSampler::new(4, 0, 0, i))
                .1,
            Rgb::WHITE
        );
    }
}

/// A star of `points` with a hole off-centre, drawn with grey levels: an asymmetric mask.
fn test_mask(size: usize) -> Vec<u8> {
    let mut out = Vec::with_capacity(size * size);
    for j in 0..size {
        let y = 1.0 - (j as f32 + 0.5) * 2.0 / size as f32;
        for i in 0..size {
            let x = (i as f32 + 0.5) * 2.0 / size as f32 - 1.0;
            let r = (x * x + y * y).sqrt();
            let a = fmath::atan2(y, x);
            let edge = 0.62 + 0.3 * fmath::cos(5.0 * a);
            let hole = ((x - 0.25) * (x - 0.25) + (y + 0.1) * (y + 0.1)).sqrt() < 0.18;
            let v = if r < edge && !hole {
                120.0 + 135.0 * (0.5 + 0.5 * x)
            } else {
                0.0
            };
            out.push(v as u8);
        }
    }
    out
}

#[test]
fn a_mask_sampled_by_its_cdf_has_the_mean_of_rejection_sampling() {
    let size = 64usize;
    let mask = test_mask(size);
    let weights: Vec<f32> = mask.iter().map(|&m| f32::from(m) / 255.0).collect();
    let grid = Grid::new(size, size, &weights, 0.0).expect("light passes");
    let n = 1 << 16;
    let (mut cx, mut cy, mut cr) = (0.0f64, 0.0f64, 0.0f64);
    for u in lens_numbers(n) {
        let (x, y) = grid.sample(u);
        let (x, y) = (f64::from(x), f64::from(y));
        cx += x;
        cy += y;
        cr += x * x + y * y;
    }
    let (cx, cy, cr) = (cx / f64::from(n), cy / f64::from(n), cr / f64::from(n));
    // Rejection: uniform points of the square, kept with the transmission of their texel.
    let mut rng = Pcg32::seeded(11, 3);
    let (mut rx, mut ry, mut rr, mut kept) = (0.0f64, 0.0f64, 0.0f64, 0u32);
    while kept < 400_000 {
        let x = rng.next_f32() * 2.0 - 1.0;
        let y = rng.next_f32() * 2.0 - 1.0;
        let i = (((x + 1.0) * 0.5 * size as f32) as usize).min(size - 1);
        let j = (((1.0 - y) * 0.5 * size as f32) as usize).min(size - 1);
        if rng.next_f32() < weights[j * size + i] {
            let (x, y) = (f64::from(x), f64::from(y));
            rx += x;
            ry += y;
            rr += x * x + y * y;
            kept += 1;
        }
    }
    let k = f64::from(kept);
    let (rx, ry, rr) = (rx / k, ry / k, rr / k);
    assert!(
        (cx - rx).abs() < 0.01 && (cy - ry).abs() < 0.01,
        "centroid ({cx}, {cy}) against ({rx}, {ry})"
    );
    assert!((cr / rr - 1.0).abs() < 0.01, "E[r²] {cr} against {rr}");
    // The centroid is off-centre (the mask is asymmetric), so the comparison means something.
    assert!(rx.abs() > 0.03, "{rx}");
}

#[test]
fn a_texture_is_drawn_inside_the_iris_and_an_aperture_mask_replaces_it() {
    let size = 64u32;
    let mask = test_mask(size as usize);
    let texture = lens(LensParams {
        blades: 6,
        mask_kind: MASK_TEXTURE,
        mask_width: size,
        mask_height: size,
        mask: mask.clone(),
        ..LensParams::default()
    });
    let iris = Iris::new(6, 0.0, 0.0);
    let px = 2.0 / size as f32;
    for u in lens_numbers(4096) {
        let (x, y) = texture.pupil().sample(u);
        assert!(
            iris.signed_distance(x, y) < px,
            "({x}, {y}) outside the hexagon"
        );
    }
    // As an aperture the mask replaces the iris: the blades are ignored and the pupil is the
    // picture's own, point for point.
    let aperture = lens(LensParams {
        blades: 6,
        mask_kind: MASK_APERTURE,
        mask_width: size,
        mask_height: size,
        mask: mask.clone(),
        ..LensParams::default()
    });
    let weights: Vec<f32> = mask.iter().map(|&m| f32::from(m) * (1.0 / 255.0)).collect();
    let alone = Grid::new(size as usize, size as usize, &weights, 0.0).expect("light passes");
    let mut beyond = 0;
    for u in lens_numbers(4096) {
        let p = aperture.pupil().sample(u);
        assert_eq!(p, alone.sample(u));
        if iris.signed_distance(p.0, p.1) > px {
            beyond += 1;
        }
    }
    assert!(beyond > 0, "the star's tips reach past the hexagon");
}

#[test]
fn every_three_samples_of_a_pixel_take_each_band_once() {
    for (x, y) in [(0u32, 0u32), (17, 3), (400, 222)] {
        let bands: Vec<u32> = (0..30)
            .map(|i| PixelSampler::new(5, x, y, i).stratum(DIM_LENS_BAND, 3))
            .collect();
        for chunk in bands.chunks(3) {
            let mut seen = [false; 3];
            for &b in chunk {
                seen[b as usize] = true;
            }
            assert_eq!(seen, [true; 3], "pixel ({x}, {y}): {bands:?}");
        }
    }
    // Pixels start at different bands.
    let first: Vec<u32> = (0..64)
        .map(|x| PixelSampler::new(5, x, 0, 0).stratum(DIM_LENS_BAND, 3))
        .collect();
    assert!((0..3).all(|b| first.contains(&b)));
}

#[test]
fn the_three_bands_of_a_group_share_one_point_of_the_pupil() {
    // On the axis (no field shift) the band's pupil point is the shared point scaled by
    // 1 + a CA_SCALE[band]: the three rays of a group are that one point, three times.
    let cam = Camera {
        lens: Some(lens(LensParams {
            ca_amount: 1.0,
            ..LensParams::default()
        })),
        ..tilted_camera(0.0, 0.0)
    };
    let radius = cam.lens_radius();
    let mut groups = std::collections::BTreeMap::<u32, Vec<(usize, Vec3)>>::new();
    for i in 0..60 {
        let s = PixelSampler::new(3, 9, 4, i);
        let (band, group) = s.strata(DIM_LENS_BAND, 3);
        let (ray, w) = cam.sample_ray(1.5, 0.5, 0.5, &s);
        assert_eq!(w, super::band_weight(band as usize));
        let shared =
            (ray.origin - cam.position) * (1.0 / (radius * (1.0 + CA_SCALE[band as usize])));
        groups
            .entry(group.get1(0).to_bits())
            .or_default()
            .push((band as usize, shared));
    }
    let mut full = 0;
    for list in groups.values() {
        for (_, p) in list {
            assert!((*p - list[0].1).length() < 1.0e-5, "{list:?}");
        }
        if list.len() == 3 {
            full += 1;
        }
    }
    assert!(full >= 19, "{full} full groups");
}

/// A flat grey environment and nothing else: every ray sees the same radiance.
fn neutral_scene(lens_params: Option<LensParams>) -> Scene {
    let mut scene = Scene {
        environment: Environment {
            kind: EnvKind::Flat,
            horizon: 0.5,
            ..Environment::default()
        },
        ..Scene::default()
    };
    scene.render.width = 16;
    scene.render.height = 16;
    scene.camera = Camera {
        fstop: 2.0,
        focus_dist: 300.0,
        lens: lens_params.map(lens),
        ..Camera::default()
    };
    scene
}

fn whole(scene: &Scene) -> TileRect {
    TileRect {
        x: 0,
        y: 0,
        w: scene.render.width,
        h: scene.render.height,
    }
}

#[test]
fn the_chromatic_bands_add_up_to_white_on_a_neutral_scene() {
    // With no obstruction and no cat's eye, a lens with chromatic aberration casts no colour:
    // three samples of a pixel are three bands, each three times its own channel.
    let scene = neutral_scene(Some(LensParams {
        ca_amount: 1.0,
        ..LensParams::default()
    }));
    let mut film = Film::new(16, 16);
    for s in 0..3 {
        render_tile(&scene, whole(&scene), s, &mut film);
    }
    for (i, v) in film.resolve().iter().enumerate() {
        assert!((v - 0.5).abs() < 1.0e-6, "value {i}: {v}");
    }
    // And with a number of samples the bands do not divide, the image still has no cast.
    let mut film = Film::new(16, 16);
    for s in 0..256 {
        render_tile(&scene, whole(&scene), s, &mut film);
    }
    let rgb = film.resolve();
    let mean = |c: usize| {
        rgb.iter()
            .skip(c)
            .step_by(3)
            .map(|&v| f64::from(v))
            .sum::<f64>()
            / 256.0
    };
    for c in 0..3 {
        assert!(
            (mean(c) / 0.5 - 1.0).abs() < 1.0e-3,
            "channel {c}: {}",
            mean(c)
        );
    }
}

#[test]
fn a_neutral_lens_renders_the_plain_thin_lens_bit_for_bit() {
    let mut plain = crate::example::scene();
    plain.render.width = 40;
    plain.render.height = 30;
    plain.camera.fstop = 2.8;
    plain.camera.focus_dist = 650.0;
    let mut neutral = plain.clone();
    neutral.camera.lens = Some(lens(LensParams::default()));
    for s in 0..3 {
        let (mut a, mut b) = (Film::new(40, 30), Film::new(40, 30));
        render_tile(&plain, whole(&plain), s, &mut a);
        render_tile(&neutral, whole(&neutral), s, &mut b);
        assert_eq!(a, b, "sample {s}");
    }
}

#[test]
fn a_busy_lens_renders_the_same_bits_on_every_simd_path_and_in_any_tile_order() {
    let mut scene = crate::example::scene();
    scene.render.width = 48;
    scene.render.height = 32;
    scene.camera.fstop = 2.0;
    scene.camera.focus_dist = 650.0;
    let mut params = busy_lens();
    params.mask_kind = MASK_TEXTURE;
    params.mask_width = 32;
    params.mask_height = 32;
    params.mask = test_mask(32);
    scene.camera.lens = Some(lens(params));
    let reference = {
        let mut film = Film::new(48, 32);
        for s in 0..2 {
            render_tile_with(&scene, whole(&scene), s, &mut film, Isa::detect());
        }
        film
    };
    for isa in Isa::available() {
        let mut film = Film::new(48, 32);
        for tile in crate::render::tile_grid(48, 32, 16).into_iter().rev() {
            for s in 0..2 {
                render_tile_with(&scene, tile, s, &mut film, isa);
            }
        }
        assert_eq!(film, reference, "{}", isa.name());
    }
}

#[test]
fn the_lens_section_round_trips_and_a_scene_without_one_has_none() {
    let mut scene = crate::example::scene();
    let plain_bytes = scene.to_rsb();
    assert!(
        !plain_bytes.windows(4).any(|w| w == b"LENS"),
        "a scene without a lens writes no LENS"
    );
    assert_eq!(
        Scene::from_rsb(&plain_bytes).expect("valid").camera.lens,
        None
    );
    let mut params = busy_lens();
    params.mask_kind = MASK_APERTURE;
    params.mask_width = 13; // 169 bytes: the padding is exercised
    params.mask_height = 13;
    params.mask = test_mask(13);
    scene.camera.lens = Some(lens(params));
    let bytes = scene.to_rsb();
    let back = Scene::from_rsb(&bytes).expect("valid");
    assert_eq!(back, scene);
    assert_eq!(back.to_rsb(), bytes);
}

#[test]
fn values_out_of_range_are_refused() {
    let bad = [
        LensParams {
            blades: 2,
            ..LensParams::default()
        },
        LensParams {
            blades: 19,
            ..LensParams::default()
        },
        LensParams {
            roundness: 1.5,
            ..LensParams::default()
        },
        LensParams {
            obstruction: 0.96,
            ..LensParams::default()
        },
        LensParams {
            squeeze: 0.5,
            ..LensParams::default()
        },
        LensParams {
            tilt_deg: 50.0,
            ..LensParams::default()
        },
        LensParams {
            ca_amount: -0.1,
            ..LensParams::default()
        },
        LensParams {
            field_mm: -1.0,
            ..LensParams::default()
        },
        LensParams {
            mask_kind: 3,
            ..LensParams::default()
        },
        LensParams {
            mask_kind: MASK_APERTURE,
            mask_width: 2,
            mask_height: 2,
            mask: vec![255; 3],
            ..LensParams::default()
        },
        LensParams {
            mask_kind: MASK_APERTURE,
            mask_width: 2,
            mask_height: 2,
            mask: vec![0; 4],
            ..LensParams::default()
        },
        LensParams {
            mask_width: 2,
            mask_height: 2,
            mask: vec![255; 4],
            ..LensParams::default()
        },
    ];
    for (i, p) in bad.into_iter().enumerate() {
        assert!(Lens::new(p).is_err(), "case {i} was accepted");
    }
}
