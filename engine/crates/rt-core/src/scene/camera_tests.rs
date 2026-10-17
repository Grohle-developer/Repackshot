//! The interior cameras of K3: the panoramic projections (equirectangular and fisheye), their
//! `CAMR` fields, and the straight verticals of a level camera with a lens shift (the camera the
//! page writes for *Verticales rectas*).

use super::*;
use crate::scene::rsb::{TAG_CAMR, TAG_LENS};

fn close(a: Vec3, b: Vec3, tol: f32) -> bool {
    (a - b).length() < tol
}

/// A panoramic camera at the origin looking along +y with z up.
fn pano(projection: Projection) -> Camera {
    Camera {
        position: Vec3::ZERO,
        target: Vec3::new(0.0, 1.0, 0.0),
        up: Vec3::new(0.0, 0.0, 1.0),
        projection,
        ..Camera::default()
    }
}

/// The payload of the first section `tag` of an RSB file.
fn section(bytes: &[u8], tag: [u8; 4]) -> Option<&[u8]> {
    let mut pos = 8 + u32::from_le_bytes(bytes[4..8].try_into().ok()?) as usize;
    while pos + 8 <= bytes.len() {
        let len = u32::from_le_bytes(bytes[pos + 4..pos + 8].try_into().ok()?) as usize;
        if bytes[pos..pos + 4] == tag {
            return bytes.get(pos + 8..pos + 8 + len);
        }
        pos += 8 + len;
    }
    None
}

#[test]
fn the_projection_codes_round_trip_and_unknown_ones_are_the_standard_camera() {
    for p in [
        Projection::Standard,
        Projection::Equirectangular,
        Projection::Fisheye,
    ] {
        assert_eq!(Projection::from_u32(p.to_u32()), p);
    }
    assert_eq!(Projection::from_u32(3), Projection::Standard);
    assert_eq!(Projection::from_u32(u32::MAX), Projection::Standard);
    assert_eq!(Camera::default().projection, Projection::Standard);
    assert!(!Camera::default().panoramic() && Camera::default().through_lens());
}

#[test]
fn an_equirectangular_panorama_sees_the_six_directions_where_its_mapping_says() {
    // The six test directions of the criterion: the centre of the image is the view axis, a
    // quarter turn to the right is three quarters across, the back is the left and right edges,
    // the zenith the top row and the nadir the bottom row (360° × 180° on 2:1).
    let cam = pano(Projection::Equirectangular);
    let (forward, right, up) = cam.basis();
    let cases = [
        (0.5, 0.5, forward),
        (0.75, 0.5, right),
        (0.25, 0.5, -right),
        (0.0, 0.5, -forward),
        (1.0, 0.5, -forward),
        (0.5, 0.0, up),
        (0.5, 1.0, -up),
    ];
    for (u, v, want) in cases {
        let ray = cam.generate_ray(2.0, u, v, (0.7, -0.2));
        assert!(close(ray.dir, want, 2.0e-6), "({u}, {v}): {:?}", ray.dir);
        assert_eq!(ray.origin, cam.position);
        assert!((ray.dir.length() - 1.0).abs() < 1.0e-6);
    }
    // The longitude grows linearly across the width and the latitude down the height.
    let r = cam.generate_ray(2.0, 0.5 + 30.0 / 360.0, 0.5 - 20.0 / 180.0, (0.0, 0.0));
    let lon = r.dir.dot(right).atan2(r.dir.dot(forward)).to_degrees();
    let lat = r.dir.dot(up).asin().to_degrees();
    assert!(
        (lon - 30.0).abs() < 1.0e-3 && (lat - 20.0).abs() < 1.0e-3,
        "{lon} {lat}"
    );
    // A view twice as wide as the output frame (a viewport image) spans 720°: its quarter is the
    // back.
    let wide = Camera {
        fov_x_deg: 720.0,
        ..cam.clone()
    };
    assert!(close(
        wide.generate_ray(2.0, 0.25, 0.5, (0.0, 0.0)).dir,
        -forward,
        2.0e-6
    ));
}

#[test]
fn a_fisheye_is_equidistant_square_and_blind_beyond_half_a_turn() {
    let cam = Camera {
        fov_x_deg: 180.0,
        ..pano(Projection::Fisheye)
    };
    let (forward, right, up) = cam.basis();
    let aspect = 1.5;
    assert!(close(
        cam.generate_ray(aspect, 0.5, 0.5, (0.0, 0.0)).dir,
        forward,
        1.0e-7
    ));
    // The edges of the width are 90° from the axis, so the image circle of 180° touches them.
    assert!(close(
        cam.generate_ray(aspect, 1.0, 0.5, (0.0, 0.0)).dir,
        right,
        2.0e-6
    ));
    assert!(close(
        cam.generate_ray(aspect, 0.0, 0.5, (0.0, 0.0)).dir,
        -right,
        2.0e-6
    ));
    // Square pixels: up the height, the same angle per pixel as across the width.
    let top = cam.generate_ray(aspect, 0.5, 0.0, (0.0, 0.0)).dir;
    let angle = top.dot(forward).acos().to_degrees();
    assert!((angle - 90.0 / aspect).abs() < 1.0e-3, "{angle}");
    assert!(top.dot(up) > 0.0 && top.dot(right).abs() < 1.0e-6);
    // Equidistant: the angle from the axis is proportional to the distance from the centre.
    for k in [0.1f32, 0.25, 0.4] {
        let d = cam.generate_ray(aspect, 0.5 + k * 0.6, 0.5 - k * 0.8 * aspect, (0.0, 0.0));
        let theta = d.dir.dot(forward).acos().to_degrees();
        assert!((theta - 180.0 * k).abs() < 2.0e-3, "{k}: {theta}");
    }
    // Wider than 360° across the width, the corners are more than half a turn from the axis:
    // they see nothing (an empty ray, weighed black), the middle still sees.
    let wide = Camera {
        fov_x_deg: 300.0,
        ..cam.clone()
    };
    assert_eq!(wide.panorama_dir(4.0 / 3.0, 0.0, 0.0), None);
    let corner = wide.generate_ray(4.0 / 3.0, 0.0, 0.0, (0.0, 0.0));
    assert!(corner.t_max < corner.t_min);
    let sampler = crate::sampler::PixelSampler::new(0, 0, 0, 0);
    assert_eq!(wide.sample_ray(4.0 / 3.0, 0.0, 0.0, &sampler).1, Rgb::BLACK);
    assert_eq!(wide.sample_ray(4.0 / 3.0, 0.5, 0.5, &sampler).1, Rgb::WHITE);
    // A sixth of the way in from the left, 100° from the axis: behind the camera's plane.
    let behind = wide.generate_ray(4.0 / 3.0, 1.0 / 6.0, 0.5, (0.0, 0.0)).dir;
    assert!(behind.dot(forward) < 0.0 && behind.dot(right) < 0.0);
}

#[test]
fn a_panoramic_camera_is_a_pinhole_whatever_its_lens_and_aperture() {
    let lens = Lens::new(LensParams {
        blades: 6,
        shift_x_mm: 4.0,
        tilt_deg: 8.0,
        ..LensParams::default()
    })
    .expect("a valid lens");
    for projection in [Projection::Equirectangular, Projection::Fisheye] {
        let plain = pano(projection);
        let busy = Camera {
            fstop: 1.4,
            focus_dist: 500.0,
            ortho: true,
            lens: Some(lens.clone()),
            ..plain.clone()
        };
        assert_eq!(busy.lens_radius(), 0.0);
        assert!(!busy.through_lens());
        let sampler = crate::sampler::PixelSampler::new(3, 10, 20, 5);
        for (u, v) in [(0.1, 0.2), (0.5, 0.5), (0.9, 0.7)] {
            assert_eq!(
                busy.generate_ray(1.6, u, v, (0.9, 0.1)),
                plain.generate_ray(1.6, u, v, (0.0, 0.0))
            );
            assert_eq!(
                busy.sample_ray(1.6, u, v, &sampler),
                plain.sample_ray(1.6, u, v, &sampler)
            );
        }
        assert_eq!(busy.lens_info_json(), "{\"traced\":false}");
    }
}

#[test]
fn the_k3_fields_of_camr_are_written_only_when_set_and_read_back() {
    // A camera of before K3 writes the 60 bytes of before.
    let scene = crate::example::scene();
    let bytes = scene.to_rsb();
    assert_eq!(section(&bytes, TAG_CAMR).map(<[u8]>::len), Some(60));
    // Each K3 field alone makes the section 76 bytes, and comes back.
    for camera in [
        pano(Projection::Equirectangular),
        Camera {
            fov_x_deg: 250.0,
            ..pano(Projection::Fisheye)
        },
        Camera {
            fov_y_deg: 120.0,
            ..pano(Projection::Equirectangular)
        },
        Camera {
            exterior: 0.25,
            ..Camera::default()
        },
    ] {
        let mut s = scene.clone();
        s.camera = camera.clone();
        let bytes = s.to_rsb();
        let camr = section(&bytes, TAG_CAMR).expect("a CAMR");
        assert_eq!(camr.len(), 76, "{camera:?}");
        assert_eq!(
            u32::from_le_bytes(camr[60..64].try_into().unwrap()),
            camera.projection.to_u32()
        );
        let read = Scene::from_rsb(&bytes).expect("reads back");
        assert_eq!(read.camera, camera);
    }
}

#[test]
fn a_camr_without_the_k3_fields_is_the_camera_of_before_and_bad_values_are_refused() {
    let read = Scene::from_rsb(&crate::example::scene().to_rsb()).expect("reads");
    assert_eq!(read.camera.projection, Projection::Standard);
    assert_eq!(
        (
            read.camera.fov_x_deg,
            read.camera.fov_y_deg,
            read.camera.exterior
        ),
        (360.0, 180.0, 1.0)
    );
    let mut scene = crate::example::scene();
    scene.camera.projection = Projection::Equirectangular;
    let good = scene.to_rsb();
    // Where the K3 fields are: right after the 60 bytes of before.
    let at = good.windows(4).position(|w| w == TAG_CAMR).expect("CAMR") + 8 + 60;
    let patched = |offset: usize, value: [u8; 4]| {
        let mut b = good.clone();
        b[at + offset..at + offset + 4].copy_from_slice(&value);
        Scene::from_rsb(&b)
    };
    // An unknown projection reads as the standard camera (a newer writer's).
    assert_eq!(
        patched(0, 9u32.to_le_bytes()).map(|s| s.camera.projection),
        Ok(Projection::Standard)
    );
    for (offset, value) in [
        (4, 0.0f32),
        (4, -10.0),
        (4, 4000.0),
        (8, 0.0),
        (8, f32::INFINITY),
        (12, -0.5),
        (12, f32::NAN),
    ] {
        assert!(
            patched(offset, value.to_le_bytes()).is_err(),
            "{offset} {value}"
        );
    }
    assert!(patched(12, 0.0f32.to_le_bytes()).is_ok());
}

/// Where the camera's own rays put `p` on its image: the `(u, v)` whose ray through the lens centre
/// passes through `p`, found with the engine's `generate_ray` itself (Newton steps on the angle
/// between that ray and `p`, the Jacobian by differences).
fn project(camera: &Camera, aspect: f32, p: Vec3) -> (f32, f32) {
    let error = |u: f32, v: f32| {
        let r = camera.generate_ray(aspect, u, v, (0.0, 0.0));
        let to = (p - r.origin).normalize();
        let (_, right, up) = camera.basis();
        let d = r.dir.normalize();
        // The offset of `to` from the ray, along the image's axes (small near the solution).
        ((to - d).dot(right), (to - d).dot(up))
    };
    let (mut u, mut v) = (0.5f32, 0.5f32);
    for _ in 0..40 {
        let (ex, ey) = error(u, v);
        let h = 1.0e-3;
        let (ax, ay) = error(u + h, v);
        let (bx, by) = error(u, v + h);
        let (j00, j10, j01, j11) = ((ax - ex) / h, (ay - ey) / h, (bx - ex) / h, (by - ey) / h);
        let det = j00 * j11 - j01 * j10;
        if det == 0.0 {
            break;
        }
        u -= (j11 * ex - j01 * ey) / det;
        v -= (j00 * ey - j10 * ex) / det;
    }
    (u, v)
}

/// The camera the page writes for an orbit camera tilted `tilt_deg` down (core/interior-camera.ts
/// `verticalsCamera`): level, at the same position, looking the same way, and the frame moved down
/// on the sensor by `f·tan(tilt)` (the lens shift of `LENS`), so the target stays in the middle.
fn level_with_shift(tilted: &Camera, tilt_deg: f32) -> Camera {
    let (forward, _, _) = tilted.basis();
    let level = Vec3::new(forward.x, forward.y, 0.0).normalize();
    let shift = -tilted.focal_mm * (tilt_deg * crate::fmath::DEG_TO_RAD).tan();
    Camera {
        target: tilted.position + level * 1000.0,
        lens: Some(
            Lens::new(LensParams {
                shift_y_mm: shift,
                ..LensParams::default()
            })
            .expect("a valid lens"),
        ),
        ..tilted.clone()
    }
}

#[test]
fn a_level_camera_with_its_lens_shifted_keeps_the_verticals_of_a_cube_parallel() {
    // The criterion of K3: tilted 10°, the vertical edges of a cube stay parallel in the
    // projection to a tenth of a pixel at 1080p. A 28 mm camera 3 m from a 600 mm cube, 1.5 m up,
    // looking down 10° at its middle; its rays are the engine's (`generate_ray` through the LENS
    // shift). Tilted without the shift the same edges lean by more than six pixels.
    let (w, h) = (1920.0f32, 1080.0f32);
    let aspect = w / h;
    let target = Vec3::new(0.0, 0.0, 300.0);
    let tilt = 10.0f32;
    let (s, c) = crate::fmath::sin_cos(tilt * crate::fmath::DEG_TO_RAD);
    let tilted = Camera {
        position: target + Vec3::new(0.0, -3000.0 * c, 3000.0 * s),
        target,
        up: Vec3::new(0.0, 0.0, 1.0),
        focal_mm: 28.0,
        ..Camera::default()
    };
    let level = level_with_shift(&tilted, tilt);
    // The target is where it was: in the middle of the frame.
    let (u, v) = project(&level, aspect, target);
    assert!(
        (u - 0.5).abs() * w < 0.01 && (v - 0.5).abs() * h < 0.01,
        "{u} {v}"
    );
    let lean = |camera: &Camera| -> f32 {
        let mut worst = 0.0f32;
        for (x, y) in [
            (-300.0, -300.0),
            (300.0, -300.0),
            (-300.0, 300.0),
            (300.0, 300.0),
        ] {
            let (u0, _) = project(camera, aspect, Vec3::new(x, y, 0.0));
            let (u1, _) = project(camera, aspect, Vec3::new(x, y, 600.0));
            worst = worst.max((u1 - u0).abs() * w);
        }
        worst
    };
    let straight = lean(&level);
    eprintln!(
        "verticals at 10°: {straight:.4} px with the shift, {:.1} px without",
        lean(&tilted)
    );
    assert!(straight <= 0.1, "{straight} px");
    assert!(lean(&tilted) > 6.0);
    // The shift travels in LENS, after CAMR.
    let mut scene = crate::example::scene();
    scene.camera = level.clone();
    let bytes = scene.to_rsb();
    assert!(section(&bytes, TAG_LENS).is_some());
    assert_eq!(Scene::from_rsb(&bytes).map(|s| s.camera), Ok(level));
}

#[test]
fn the_page_s_camera_with_straight_verticals_keeps_the_verticals_of_a_cube_parallel() {
    // The same criterion through the camera the page writes (tests/interior-camera.test.ts writes the file: a 28 mm
    // orbit camera 3 m from a 600 mm cube, tilted 10°, with straight verticals, at 1920 × 1080): the engine's own rays
    // put the bottom and the top of each vertical edge in the same column, to a tenth of a pixel.
    let bytes = include_bytes!("../../../../../tests/fixtures/k3-verticals.rsb");
    let scene = Scene::from_rsb(bytes).expect("the page's file reads");
    let (w, h) = (scene.render.width as f32, scene.render.height as f32);
    assert_eq!((w, h), (1920.0, 1080.0));
    let camera = &scene.camera;
    assert!(camera.lens.is_some(), "the shift travels in LENS");
    let aspect = w / h;
    let mut worst = 0.0f32;
    for (x, y) in [(-300.0, -300.0), (300.0, -300.0), (-300.0, 300.0), (300.0, 300.0)] {
        let (u0, _) = project(camera, aspect, Vec3::new(x, y, 0.0));
        let (u1, _) = project(camera, aspect, Vec3::new(x, y, 600.0));
        worst = worst.max((u1 - u0).abs() * w);
    }
    eprintln!("the page's 10° camera: verticals within {worst:.4} px");
    assert!(worst <= 0.1, "{worst} px");
    // And the cube's middle, the target, is in the middle of the frame.
    let (u, v) = project(camera, aspect, Vec3::new(0.0, 0.0, 300.0));
    assert!((u - 0.5).abs() * w < 0.05 && (v - 0.5).abs() * h < 0.05, "{u} {v}");
}
