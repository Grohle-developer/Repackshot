//! Tests of focus with a click (F1): the chief ray of a pixel is the ray the image and its exact
//! passes are centred on, the pick meets what the depth pass sees, and a camera focused at the
//! distance the pick reports brings that point into focus: every ray of the pixel through the
//! thin lens (with or without a tilt) passes through it, and a traced lens is sharpest there
//! (its best focus, and the render's own samples through focus), which its paraxial focus is not.

use super::*;
use crate::example;
use crate::integrator::{first_hit, BvhTracer, Prepared};
use crate::optics::{Lens, LensParams};
use crate::passes::{Exact, FLOOR_ID};
use crate::render::centre_ray;
use crate::simd::Isa;

/// The image point of the centre of pixel `(x, y)`.
fn centre(scene: &Scene, x: u32, y: u32) -> (f32, f32) {
    (
        (x as f32 + 0.5) / scene.render.width as f32,
        (y as f32 + 0.5) / scene.render.height as f32,
    )
}

/// A 7 × 5 grid of pixels over the image, its corners included.
fn grid(scene: &Scene) -> Vec<(u32, u32)> {
    let (w, h) = (scene.render.width, scene.render.height);
    let mut out = Vec::new();
    for j in 0..5 {
        for i in 0..7 {
            out.push(((w - 1) * i / 6, (h - 1) * j / 4));
        }
    }
    out
}

/// How far from `p` the ray passes.
fn miss(ray: &Ray, p: Vec3) -> f32 {
    let w = p - ray.origin;
    (w - ray.dir * w.dot(ray.dir)).length()
}

fn scenes() -> Vec<(&'static str, Scene)> {
    vec![
        ("example", example::scene()),
        ("o1", example::o1_scene()),
        ("o2", example::o2_scene()),
        ("q1", example::q1_scene()),
    ]
}

#[test]
fn the_chief_ray_of_a_pixel_centre_is_the_ray_of_the_exact_passes() {
    for (name, scene) in scenes() {
        for (x, y) in grid(&scene) {
            let (u, v) = centre(&scene, x, y);
            assert_eq!(
                image_ray(&scene, u, v),
                centre_ray(&scene, x, y),
                "{name} ({x}, {y})"
            );
        }
    }
}

#[test]
fn the_pick_meets_the_part_the_depth_pass_sees_at_its_depth() {
    let mut parts = 0;
    for (name, scene) in scenes() {
        let prepared = Prepared::new(&scene);
        let tracer = BvhTracer {
            geometry: &scene.geometry,
            isa: Isa::detect(),
        };
        for (x, y) in grid(&scene) {
            let (u, v) = centre(&scene, x, y);
            let ray = centre_ray(&scene, x, y);
            let exact = Exact::of(&scene, &ray, first_hit(&scene, &prepared, &tracer, &ray));
            let pick = pick(&scene, u, v);
            if exact.part_id == 0 || exact.part_id == FLOOR_ID {
                continue;
            }
            let hit = pick
                .hit
                .unwrap_or_else(|| panic!("{name} ({x}, {y}): the pick meets nothing"));
            assert_eq!(hit.instance + 1, exact.part_id, "{name} ({x}, {y})");
            assert!(
                (hit.depth - exact.depth).abs() <= 1.0e-4 * exact.depth,
                "{name} ({x}, {y}): depth {} against the pass's {}",
                hit.depth,
                exact.depth
            );
            assert!(miss(&pick.ray, hit.point) <= 1.0e-4 * hit.t);
            parts += 1;
        }
    }
    assert!(parts > 30, "the grid met {parts} parts");
}

#[test]
fn a_camera_alone_gives_the_ray_and_meets_nothing() {
    let mut scene = example::o2_scene();
    scene.geometry = crate::geometry::Geometry::default();
    let p = pick(&scene, 0.3, 0.7);
    assert_eq!(p.hit, None);
    assert_eq!(p.ray, image_ray(&example::o2_scene(), 0.3, 0.7));
    let floats = p.to_floats();
    assert_eq!(floats[6], 0.0);
    assert!(floats[7..].iter().all(|f| f.is_nan()));
}

/// The rays of image point `(u, v)` through points of the pupil, the centre's included.
fn pupil_rays(camera: &Camera, aspect: f32, u: f32, v: f32) -> Vec<Ray> {
    [
        (0.0, 0.0),
        (0.9, 0.0),
        (-0.9, 0.0),
        (0.0, 0.9),
        (0.0, -0.9),
        (0.6, 0.6),
        (-0.5, 0.7),
    ]
    .iter()
    .map(|&p| camera.generate_ray(aspect, u, v, p))
    .collect()
}

#[test]
fn a_thin_lens_focused_at_the_pick_brings_every_ray_of_the_pixel_through_the_point() {
    // The plain thin lens at f/2, the busy lens of O1 (shift, a 2° tilt, squeeze, swirl...) and a
    // strong 10° tilt about a slanted axis.
    let mut plain = example::scene();
    plain.camera.fstop = 2.0;
    let mut busy = example::scene();
    busy.camera.fstop = 2.0;
    busy.camera.lens = Some(Lens::new(example::busy_lens()).expect("valid"));
    let mut tilted = busy.clone();
    tilted.camera.lens = Some(
        Lens::new(LensParams {
            tilt_deg: 10.0,
            tilt_axis_deg: 30.0,
            ..example::busy_lens()
        })
        .expect("valid"),
    );
    let mut checked = 0;
    for (name, scene) in [("plain", plain), ("busy", busy), ("tilted", tilted)] {
        let aspect = scene.render.width as f32 / scene.render.height as f32;
        for (x, y) in grid(&scene) {
            let (u, v) = centre(&scene, x, y);
            let Some(hit) = pick(&scene, u, v).hit else {
                continue;
            };
            let focus = hit.focus_dist.expect("a focus distance");
            let mut camera = scene.camera.clone();
            camera.focus_dist = focus;
            for ray in pupil_rays(&camera, aspect, u, v) {
                let off = miss(&ray, hit.point);
                assert!(
                    off <= 2.0e-5 * hit.t,
                    "{name} ({x}, {y}): a ray misses by {off} mm"
                );
            }
            // The paraxial answer (the depth) is the plane's only without a tilt.
            if name == "tilted" && (focus - hit.depth).abs() > 1.0e-3 * hit.depth {
                checked += 1;
            }
            checked += 1;
        }
    }
    assert!(checked > 40, "{checked} pixels checked");
}

#[test]
fn no_focus_puts_a_point_behind_the_lens_or_beyond_the_hinge_in_focus() {
    let scene = example::scene();
    let (forward, _, up) = scene.camera.basis();
    let behind = scene.camera.position - forward * 100.0;
    assert_eq!(scene.camera.focus_distance_to(behind), None);
    let mut camera = scene.camera.clone();
    camera.fstop = 2.0;
    camera.lens = Some(
        Lens::new(LensParams {
            tilt_deg: 20.0,
            ..LensParams::default()
        })
        .expect("valid"),
    );
    // A tilt about the horizontal axis: the plane leans back, and it never reaches points far
    // enough towards `b` (below the axis, at the hinge's side) whatever the distance.
    let beyond = camera.focus_distance_to(camera.position + forward * 1000.0 - up * 5000.0);
    let above = camera.focus_distance_to(camera.position + forward * 1000.0 + up * 300.0);
    let on_axis = camera.focus_distance_to(camera.position + forward * 1000.0);
    assert_eq!(beyond, None);
    assert_eq!(on_axis, Some(1000.0));
    // Above the axis the plane leaning back reaches it with a nearer axis point.
    assert!(above.is_some_and(|u| u < 1000.0), "{above:?}");
}

/// How far along the axis a traced lens's best focus ([`TracedLens::best_focus`]: the most
/// contrast of fine detail) lies beyond `point` with the camera focused at `focus`.
fn traced_error(camera: &Camera, point: Vec3, focus: f32) -> f32 {
    let mut c = camera.clone();
    c.focus_dist = focus;
    c.prepare_lens().expect("prepares");
    let lens = c.lens.as_ref().and_then(Lens::traced).expect("traced");
    let (forward, right, up) = c.basis();
    let d = point - c.position;
    let depth = d.dot(forward);
    let q = Vec3::new(d.dot(right), d.dot(up), lens.pupil_z() - depth);
    let (x, y) = lens
        .film_position_through(q, (c.focal_mm * q.x / depth, c.focal_mm * q.y / depth))
        .expect("imaged");
    let (origin, dir, s) = lens.best_focus(x, y, 0.0).expect("light passes");
    (s - (q - origin).dot(dir)) * -dir.z
}

#[test]
fn a_traced_lens_focused_at_the_pick_has_its_best_focus_at_the_point() {
    // The O2 scene's double Gauss, wide open: its spherical aberration and field curvature put the
    // sharpest image of the paraxial focus plane millimetres away from it, a few depths of field.
    let mut scene = example::o2_scene();
    scene.camera.fstop = 2.03;
    scene.camera.prepare_lens().expect("prepares");
    let mut checked = 0;
    let mut paraxial_worst = 0.0f32;
    for (x, y) in grid(&scene) {
        let (u, v) = centre(&scene, x, y);
        let Some(hit) = pick(&scene, u, v).hit else {
            continue;
        };
        let focus = hit.focus_dist.expect("a focus distance");
        let at_pick = traced_error(&scene.camera, hit.point, focus);
        let paraxial = traced_error(&scene.camera, hit.point, hit.depth);
        assert!(
            at_pick.abs() <= 1.0e-4 * hit.depth,
            "({x}, {y}): the best focus lies {at_pick} mm from the point"
        );
        paraxial_worst = paraxial_worst.max(paraxial.abs());
        checked += 1;
    }
    assert!(checked >= 10, "{checked} pixels checked");
    assert!(
        paraxial_worst > 1.0,
        "the paraxial focus is off by at most {paraxial_worst} mm"
    );
}

/// FNV-1a over the little-endian bytes of every float (the engine's test hash).
fn fnv1a(values: &[f32]) -> u32 {
    values
        .iter()
        .flat_map(|v| v.to_le_bytes())
        .fold(0x811c_9dc5u32, |hash, byte| {
            (hash ^ u32::from(byte)).wrapping_mul(0x0100_0193)
        })
}

/// The floats of the picks of a 5 × 4 grid of image points (`((i + 0.5) / 5, (j + 0.5) / 4)`,
/// row by row), one after another: what `tools/wasm-parity.mjs --pick` hashes through
/// `rt_scene_pick`.
pub(crate) fn grid_picks(scene: &Scene) -> Vec<f32> {
    let mut out = Vec::new();
    for j in 0..4 {
        for i in 0..5 {
            out.extend(pick(scene, (i as f32 + 0.5) / 5.0, (j as f32 + 0.5) / 4.0).to_floats());
        }
    }
    out
}

/// The picks of the O1 scene (the busy thin lens, tilted and shifted) and of the O2 scene (the
/// traced double Gauss, whose focus is solved), the same bits on every platform and in wasm.
pub(crate) const PINNED_FOCUS_PICK_O1: u32 = 0x53a4_2182;
/// See [`PINNED_FOCUS_PICK_O1`].
pub(crate) const PINNED_FOCUS_PICK_O2: u32 = 0xecc9_2038;

#[test]
fn the_picks_of_the_lens_scenes_have_pinned_hashes() {
    let o1 = fnv1a(&grid_picks(&example::o1_scene()));
    let o2 = fnv1a(&grid_picks(&example::o2_scene()));
    assert_eq!(
        (o1, o2),
        (PINNED_FOCUS_PICK_O1, PINNED_FOCUS_PICK_O2),
        "{o1:#010x} {o2:#010x}"
    );
}

/// The O2 scene's camera with the double Gauss at its strongest artistic distortion, its sensor
/// `sensor` mm and the frame's said or not.
fn distorting(sensor: f32, frame: f32) -> Camera {
    let mut camera = example::o2_scene().camera;
    camera.sensor_mm = sensor;
    camera.lens = Some(
        Lens::new(LensParams {
            prescription: Some(crate::optics::traced::Prescription {
                distortion: 1.0,
                ..example::double_gauss()
            }),
            frame_sensor_mm: frame,
            ..LensParams::default()
        })
        .expect("valid"),
    );
    camera.prepare_lens().expect("prepares");
    camera
}

/// The largest angle (radians) between the chief rays of two cameras' traced lenses over the
/// sensor positions of a 36 × 20.25 mm frame.
fn worst_angle(a: &Camera, b: &Camera) -> f32 {
    let (la, lb) = (
        a.lens.as_ref().and_then(Lens::traced).expect("traced"),
        b.lens.as_ref().and_then(Lens::traced).expect("traced"),
    );
    let mut worst = 0.0f32;
    for j in 0..=4 {
        for i in 0..=6 {
            let (x, y) = (-18.0 + 6.0 * i as f32, -10.125 + 5.0625 * j as f32);
            match (la.chief(x, y, (0.0, 0.0)), lb.chief(x, y, (0.0, 0.0))) {
                (
                    crate::optics::traced::Traced::Out { dir: da, .. },
                    crate::optics::traced::Traced::Out { dir: db, .. },
                ) => worst = worst.max((da - db).length()),
                _ => panic!("a chief ray of the frame is blocked at ({x}, {y})"),
            }
        }
    }
    worst
}

#[test]
fn a_viewport_sees_the_traced_lens_of_the_frame() {
    // The Full view renders the frame inset in a larger image: its camera's sensor is the
    // viewport's (here 25 % more than the frame's 36 mm). A traced lens measured its artistic
    // distortion against 0.6 of that sensor, so the Full view bent the frame less than the render
    // did. With the frame's sensor said, the chief rays of the frame's positions are the render's.
    let render = distorting(36.0, 0.0);
    let viewport = distorting(45.0, 36.0);
    let before = distorting(45.0, 0.0);
    let same = worst_angle(&render, &viewport);
    let apart = worst_angle(&render, &before);
    assert!(
        same < 1.0e-4,
        "the viewport's chief rays part from the render's by {same} rad"
    );
    assert!(
        apart > 2.0e-3,
        "without the frame's sensor they part by only {apart} rad"
    );
    // The section keeps it.
    let mut scene = example::o2_scene();
    scene.camera = viewport;
    let read = Scene::from_rsb(&scene.to_rsb()).expect("reads");
    assert_eq!(
        read.camera
            .lens
            .as_ref()
            .map(|l| l.params().frame_sensor_mm),
        Some(36.0)
    );
}

#[test]
fn the_viewport_and_the_render_solve_the_same_traced_focus() {
    // The Full view's camera (a larger sensor, the frame's said) and the render's (the frame's own) focus a point
    // through the same traced lens at the same distance, within a fiftieth of a millimetre wide open.
    let mut render = example::o2_scene().camera;
    render.fstop = 2.03;
    render.prepare_lens().expect("prepares");
    let mut viewport = render.clone();
    viewport.sensor_mm = 45.0;
    if let Some(lens) = &viewport.lens {
        viewport.lens = Some(
            Lens::new(LensParams {
                frame_sensor_mm: 36.0,
                ..lens.params().clone()
            })
            .expect("valid"),
        );
    }
    viewport.prepare_lens().expect("prepares");
    let (forward, right, up) = render.basis();
    let mut worst = 0.0f32;
    for (x, y) in [(0.0, 0.0), (60.0, 30.0), (-80.0, -40.0), (100.0, 55.0)] {
        let p = render.position + forward * 650.0 + right * x + up * y;
        let a = render.focus_distance_to(p).expect("a focus");
        let b = viewport.focus_distance_to(p).expect("a focus");
        worst = worst.max((a - b).abs());
    }
    assert!(worst < 0.02, "the two solves part by {worst} mm");
}

/// What the render's own camera samples of image point `(u, v)` make of fine detail at `depth`:
/// the light of `samples` samples ([`Camera::sample_ray`], the pixel sampler, luminance weights)
/// where it crosses the plane square to the view axis at that depth, and the modulation there of
/// patterns of `nu` and `nu / 2` cycles per millimetre (the mean, across and up), and how widely
/// it spreads about its centroid (RMS, mm).
fn rendered_focus(
    camera: &Camera,
    aspect: f32,
    uv: (f32, f32),
    depth: f32,
    nu: f32,
    samples: u32,
) -> (f32, f32) {
    let (forward, right, up) = camera.basis();
    let mut pts = Vec::new();
    for i in 0..samples {
        let sampler = crate::sampler::PixelSampler::new(11, 0, 0, i);
        let (ray, w) = camera.sample_ray(aspect, uv.0, uv.1, &sampler);
        let luma = 0.2126 * w.r + 0.7152 * w.g + 0.0722 * w.b;
        let along = ray.dir.dot(forward);
        if luma.is_nan() || luma <= 0.0 || along <= 0.0 {
            continue;
        }
        let q =
            ray.origin + ray.dir * ((depth - (ray.origin - camera.position).dot(forward)) / along);
        pts.push((q.dot(right), q.dot(up), luma));
    }
    let total: f32 = pts.iter().map(|p| p.2).sum();
    let modulation = |nu: f32, axis: usize| {
        let tau = 2.0 * std::f32::consts::PI * nu;
        let (mut c, mut s) = (0.0f32, 0.0f32);
        for p in &pts {
            let x = if axis == 0 { p.0 } else { p.1 };
            c += p.2 * (tau * x).cos();
            s += p.2 * (tau * x).sin();
        }
        (c * c + s * s).sqrt() / total
    };
    let contrast = 0.25
        * (modulation(nu, 0)
            + modulation(nu, 1)
            + modulation(0.5 * nu, 0)
            + modulation(0.5 * nu, 1));
    let cx = pts.iter().map(|p| p.0 * p.2).sum::<f32>() / total;
    let cy = pts.iter().map(|p| p.1 * p.2).sum::<f32>() / total;
    let rms = (pts
        .iter()
        .map(|p| ((p.0 - cx).powi(2) + (p.1 - cy).powi(2)) * p.2)
        .sum::<f32>()
        / total)
        .sqrt();
    (contrast, rms)
}

#[test]
fn a_traced_lens_wide_open_renders_sharpest_where_the_pick_focuses() {
    // The render, not the solve: through focus, the camera's own samples of an image point give
    // fine detail at the point their most contrast at the distance the pick reports. The
    // catalogue's fast double Gauss wide open (135 mm at f/1.4, 600 mm away): its least confusion
    // (the least squares of its halo, what F1 first solved for) lies millimetres from there at the
    // centre, and the render was soft at the click; near the top edge a side lobe of the contrast
    // stood above its weak main one (the best focus is the maximum nearest the least squares).
    let mut scene = example::o2_scene();
    scene.camera.lens = Some(
        Lens::new(LensParams {
            prescription: Some(crate::optics::traced_tests::catalogue_prescription(
                "double_gauss_fast",
            )),
            ..LensParams::default()
        })
        .expect("valid"),
    );
    scene.camera.focal_mm = 135.0;
    scene.camera.fstop = 1.4;
    scene.camera.focus_dist = 600.0;
    scene.camera.prepare_lens().expect("prepares");
    let aspect = scene.render.width as f32 / scene.render.height as f32;
    let (forward, _, _) = scene.camera.basis();
    for (uv, depth, samples) in [((0.5, 0.5), 600.0f32, 3000), ((0.5, 0.12), 581.0, 6000)] {
        let chief = scene.camera.generate_ray(aspect, uv.0, uv.1, (0.0, 0.0));
        let point = chief.origin
            + chief.dir
                * ((depth - (chief.origin - scene.camera.position).dot(forward))
                    / chief.dir.dot(forward));
        let focus = scene.camera.focus_distance_to(point).expect("a focus");
        let nu = crate::optics::traced::FOCUS_LP_MM * scene.camera.focal_mm / depth;
        // Through focus, the render's contrast there; at the distance the pick reports it is at
        // its best (within 3 % of the most, the curve is flat round its top), and wide open at the
        // centre the least confusion's is well short of it.
        let at = |f: f32| {
            let mut camera = scene.camera.clone();
            camera.focus_dist = f;
            camera.prepare_lens().expect("prepares");
            rendered_focus(&camera, aspect, uv, depth, nu, samples)
        };
        let (span, steps) = (0.03 * depth, 72);
        let step = span / steps as f32;
        let (mut sharpest, mut least) = ((0.0f32, f32::MIN), (0.0f32, f32::MAX, 0.0f32));
        for k in -steps..=steps {
            let f = depth + step * k as f32;
            let (m, rms) = at(f);
            if m > sharpest.1 {
                sharpest = (f, m);
            }
            if rms < least.1 {
                least = (f, rms, m);
            }
        }
        let picked = at(focus).0;
        assert!(
            picked >= 0.97 * sharpest.1,
            "{uv:?}: at the pick's {focus} mm the render's contrast is {picked}, at {} mm {} (least confusion {} mm)",
            sharpest.0,
            sharpest.1,
            least.0
        );
        if uv == (0.5, 0.5) {
            assert!(
                least.2 < 0.85 * sharpest.1,
                "at the least confusion ({} mm) the contrast is {}, the most {} at {} mm: the check tells nothing",
                least.0,
                least.2,
                sharpest.1,
                sharpest.0
            );
        }
    }
}
