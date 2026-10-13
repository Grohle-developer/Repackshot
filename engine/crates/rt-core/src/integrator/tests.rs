//! Analytic and consistency tests of the path tracer, on whole (small) scenes.

use super::*;
use crate::color::Rgb;
use crate::example::icosphere;
use crate::fmath;
use crate::image::Film;
use crate::render::{render_tile_prepared, TileRect};
use crate::scene::{
    Camera, EnvKind, Environment, Floor, Geometry, Instance, Light, LightKind, Material, Mesh,
    RenderSettings, Transform, BACKGROUND_COLOR, BACKGROUND_ENVIRONMENT, BACKGROUND_TRANSPARENT,
    INSTANCE_ONE_SIDED, LIGHT_FLAG_CAMERA, LIGHT_FLAG_GLOSSY, MATERIAL_EMISSIVE,
    MATERIAL_FLAG_LIGHT,
};

/// Renders samples `0..spp` of the whole image (one thread, one prepared scene).
fn render(scene: &Scene, spp: u32) -> Film {
    let prepared = Prepared::new(scene);
    let (w, h) = (scene.render.width, scene.render.height);
    let mut film = Film::new(w, h);
    let tile = TileRect { x: 0, y: 0, w, h };
    for s in 0..spp {
        render_tile_prepared(scene, &prepared, tile, s, &mut film, Isa::detect());
    }
    film
}

/// Mean of one channel over the pixels selected by `keep(x, y)`.
fn mean_where(film: &Film, channel: usize, keep: impl Fn(u32, u32) -> bool) -> f64 {
    let pixels = film.resolve();
    let (mut sum, mut n) = (0.0f64, 0usize);
    for y in 0..film.height {
        for x in 0..film.width {
            if keep(x, y) {
                sum += pixels[((y * film.width + x) * 3) as usize + channel] as f64;
                n += 1;
            }
        }
    }
    sum / n.max(1) as f64
}

/// Value of one channel of one pixel.
fn pixel(film: &Film, x: u32, y: u32) -> Rgb {
    let p = film.resolve();
    let i = ((y * film.width + x) * 3) as usize;
    Rgb::new(p[i], p[i + 1], p[i + 2])
}

fn alpha(film: &Film, x: u32, y: u32) -> f32 {
    film.resolve_alpha()[(y * film.width + x) as usize]
}

/// A Lambertian material (index-matched: no specular lobe).
fn lambert(albedo: f32) -> Material {
    Material {
        base_color: Rgb::splat(albedo),
        ior: 1.0,
        ..Material::default()
    }
}

/// An icosphere without vertex normals (flat facets: shading normal = geometric normal).
fn faceted_sphere(center: Vec3, radius: f32, subdivisions: u32) -> Mesh {
    let smooth = icosphere(center, radius, subdivisions);
    let positions: Vec<Vec3> = (0..smooth.vertex_count())
        .filter_map(|i| smooth.position(i))
        .collect();
    Mesh::new(&positions, &[], smooth.indices(), 0).expect("sphere")
}

/// A uniform world of radiance `value`.
fn uniform_world(value: f32) -> Environment {
    Environment {
        kind: EnvKind::Flat,
        horizon: value,
        strength: 1.0,
        background_mode: BACKGROUND_ENVIRONMENT,
        ..Environment::default()
    }
}

/// A black world with a black background colour.
fn black_world() -> Environment {
    Environment {
        strength: 0.0,
        background_color: Rgb::BLACK,
        background_mode: BACKGROUND_COLOR,
        ..Environment::default()
    }
}

/// Orthographic camera looking along +Y at the origin, `width` wide.
fn ortho_front(width: f32) -> Camera {
    Camera {
        position: Vec3::new(0.0, -1000.0, 0.0),
        target: Vec3::ZERO,
        up: Vec3::new(0.0, 0.0, 1.0),
        ortho: true,
        ortho_width: width,
        ..Camera::default()
    }
}

/// Orthographic camera looking straight down at `(x, y)` from z = 2000, `width` wide.
fn ortho_down(x: f32, y: f32, width: f32) -> Camera {
    Camera {
        position: Vec3::new(x, y, 2000.0),
        target: Vec3::new(x, y, 0.0),
        up: Vec3::new(0.0, 1.0, 0.0),
        ortho: true,
        ortho_width: width,
        ..Camera::default()
    }
}

fn settings(width: u32, height: u32) -> RenderSettings {
    RenderSettings {
        width,
        height,
        tonemap: 0,
        ..RenderSettings::default()
    }
}

#[test]
fn white_furnace_converges_to_the_environment() {
    // An albedo-1 Lambertian convex body in a uniform world of radiance 1 is invisible: every
    // pixel converges to 1, whatever it hits.
    let scene = Scene {
        camera: ortho_front(260.0),
        materials: vec![lambert(1.0)],
        geometry: Geometry::from_meshes(vec![faceted_sphere(Vec3::ZERO, 100.0, 3)]),
        environment: uniform_world(1.0),
        render: settings(16, 16),
        ..Scene::default()
    };
    let film = render(&scene, 1024);
    // Pixels whose centre is well inside the sphere's silhouette.
    let inside = |x: u32, y: u32| {
        let (u, v) = ((x as f32 + 0.5) / 16.0 - 0.5, (y as f32 + 0.5) / 16.0 - 0.5);
        (u * u + v * v).sqrt() * 260.0 < 85.0
    };
    let sphere = mean_where(&film, 1, inside);
    let all = mean_where(&film, 1, |_, _| true);
    assert!((sphere - 1.0).abs() < 0.01, "sphere pixels {sphere}");
    assert!((all - 1.0).abs() < 0.01, "all pixels {all}");
    for x in 0..16 {
        for y in 0..16 {
            if inside(x, y) {
                let v = pixel(&film, x, y).g;
                assert!((v - 1.0).abs() < 0.05, "pixel ({x}, {y}) = {v}");
            }
        }
    }
}

#[test]
fn rough_metal_never_gains_energy() {
    let mut previous = f64::INFINITY;
    for roughness in [0.05f32, 0.3, 1.0] {
        let scene = Scene {
            camera: ortho_front(220.0),
            materials: vec![Material {
                base_color: Rgb::WHITE,
                metallic: 1.0,
                roughness,
                ..Material::default()
            }],
            geometry: Geometry::from_meshes(vec![icosphere(Vec3::ZERO, 100.0, 3)]),
            environment: uniform_world(1.0),
            render: settings(16, 16),
            ..Scene::default()
        };
        let film = render(&scene, 256);
        let inside = |x: u32, y: u32| {
            let (u, v) = ((x as f32 + 0.5) / 16.0 - 0.5, (y as f32 + 0.5) / 16.0 - 0.5);
            (u * u + v * v).sqrt() * 220.0 < 90.0
        };
        let mean = mean_where(&film, 1, inside);
        assert!(mean <= 1.002, "roughness {roughness}: mean {mean}");
        // Single-scattering GGX loses energy as it gets rougher (about 60 % at roughness 1,
        // see the BSDF tests), and never gains any: a nearly smooth mirror keeps almost all.
        assert!(
            mean < previous,
            "roughness {roughness}: {mean} after {previous}"
        );
        if roughness < 0.1 {
            assert!(mean > 0.98, "roughness {roughness}: mean {mean}");
        }
        previous = mean;
        for x in 0..16 {
            for y in 0..16 {
                let v = pixel(&film, x, y);
                assert!(
                    v.r.max(v.g).max(v.b) <= 1.03,
                    "{roughness} ({x}, {y}): {v:?}"
                );
            }
        }
    }
}

/// Irradiance factor of a rectangle `a x b` parallel to and centred above a point at height `h`:
/// `E = L * this`. Four times the corner form factor, times π.
fn rect_irradiance_factor(a: f64, b: f64, h: f64) -> f64 {
    let (x, y) = (0.5 * a / h, 0.5 * b / h);
    let corner = (x / (1.0 + x * x).sqrt() * (y / (1.0 + x * x).sqrt()).atan()
        + y / (1.0 + y * y).sqrt() * (x / (1.0 + y * y).sqrt()).atan())
        / (2.0 * std::f64::consts::PI);
    4.0 * std::f64::consts::PI * corner
}

/// A square floor of half-size `half` at z = 0 facing up.
fn floor_quad(half: f32) -> Mesh {
    Mesh::new(
        &[
            Vec3::new(-half, -half, 0.0),
            Vec3::new(half, -half, 0.0),
            Vec3::new(half, half, 0.0),
            Vec3::new(-half, half, 0.0),
        ],
        &[],
        &[0, 1, 2, 0, 2, 3],
        0,
    )
    .expect("floor")
}

#[test]
fn a_rect_light_gives_the_analytic_irradiance() {
    // A 400 x 200 mm panel 300 mm above a white Lambertian floor, seen straight down through the
    // (camera-invisible) panel at a 2 mm wide spot: radiance = L * F, F the form factor term.
    let (a, b, h, power) = (400.0f32, 200.0f32, 300.0f32, 8.0f32);
    let scene = Scene {
        camera: ortho_down(0.0, 0.0, 2.0),
        materials: vec![lambert(1.0)],
        geometry: Geometry::from_meshes(vec![floor_quad(1000.0)]),
        lights: vec![Light {
            kind: LightKind::Rect,
            position: Vec3::new(0.0, 0.0, h),
            direction: Vec3::new(0.0, 0.0, -1.0),
            up: Vec3::new(0.0, 1.0, 0.0),
            size_x: a,
            size_y: b,
            power,
            flags: LIGHT_FLAG_GLOSSY,
            ..Light::default()
        }],
        environment: black_world(),
        render: settings(8, 8),
        ..Scene::default()
    };
    let film = render(&scene, 4096);
    let radiance = power as f64 / (std::f64::consts::PI * (a * b) as f64 * 1.0e-6);
    let want =
        radiance * rect_irradiance_factor(a as f64, b as f64, h as f64) / std::f64::consts::PI;
    let got = mean_where(&film, 1, |_, _| true);
    assert!((got / want - 1.0).abs() < 0.02, "{got} vs analytic {want}");
}

#[test]
fn a_mirror_sphere_reflects_the_dome_in_order() {
    let (floor, horizon, zenith) = (0.1f32, 0.4f32, 0.9f32);
    let scene = Scene {
        camera: ortho_front(220.0),
        materials: vec![Material {
            base_color: Rgb::WHITE,
            metallic: 1.0,
            roughness: 0.0,
            ..Material::default()
        }],
        geometry: Geometry::from_meshes(vec![icosphere(Vec3::ZERO, 100.0, 5)]),
        environment: Environment {
            kind: EnvKind::Studio,
            floor,
            horizon,
            zenith,
            strength: 1.0,
            background_mode: BACKGROUND_ENVIRONMENT,
            ..Environment::default()
        },
        render: settings(64, 64),
        ..Scene::default()
    };
    let film = render(&scene, 16);
    // Rows where the sphere's normal points 45 degrees up, level and 45 degrees down: their
    // mirror directions are the zenith, the horizon (back at the camera) and the floor.
    let row = |elevation_deg: f32| {
        let z = 100.0 * fmath::sin(elevation_deg * fmath::DEG_TO_RAD);
        ((0.5 - z / 220.0) * 64.0) as u32
    };
    let band = |elevation_deg: f32| {
        let r = row(elevation_deg);
        (0.5 * (pixel(&film, 31, r).g + pixel(&film, 32, r).g)) as f64
    };
    let (up, level, down) = (band(45.0), band(0.0), band(-45.0));
    assert!(down < level && level < up, "{down} < {level} < {up}");
    assert!((up - zenith as f64).abs() < 0.03, "zenith band {up}");
    assert!(
        (level - horizon as f64).abs() < 0.03,
        "horizon band {level}"
    );
    assert!((down - floor as f64).abs() < 0.03, "floor band {down}");
    // The background around the sphere is the dome itself, seen level: the horizon value.
    assert!((pixel(&film, 0, 32).g - horizon).abs() < 0.02);
}

/// A 200 x 200 mm emitter 300 mm above a grey floor, as a light or as an emissive quad.
fn emitter_scene(kind: &str) -> Scene {
    let (half, h, power) = (100.0f32, 300.0f32, 4.0f32);
    let radiance = power / (fmath::PI * (4.0 * half * half) * 1.0e-6);
    let mut scene = Scene {
        camera: ortho_down(0.0, 0.0, 1200.0),
        materials: vec![lambert(0.5)],
        geometry: Geometry::from_meshes(vec![floor_quad(2000.0)]),
        environment: black_world(),
        render: settings(24, 24),
        ..Scene::default()
    };
    let light = Light {
        kind: LightKind::Rect,
        position: Vec3::new(0.0, 0.0, h),
        direction: Vec3::new(0.0, 0.0, -1.0),
        up: Vec3::new(0.0, 1.0, 0.0),
        size_x: 2.0 * half,
        size_y: 2.0 * half,
        power,
        flags: LIGHT_FLAG_GLOSSY,
        ..Light::default()
    };
    match kind {
        "light" => scene.lights.push(light),
        "light without glossy" => scene.lights.push(Light { flags: 0, ..light }),
        _ => {
            // Wound so that the front face looks down; one-sided, so the camera above looks
            // through its back.
            let quad = Mesh::new(
                &[
                    Vec3::new(-half, -half, h),
                    Vec3::new(-half, half, h),
                    Vec3::new(half, half, h),
                    Vec3::new(half, -half, h),
                ],
                &[],
                &[0, 1, 2, 0, 2, 3],
                1,
            )
            .expect("quad");
            let meshes = vec![floor_quad(2000.0), quad];
            let instances = vec![
                Instance::new(0, Transform::IDENTITY, 0),
                Instance {
                    flags: INSTANCE_ONE_SIDED,
                    ..Instance::new(1, Transform::IDENTITY, 1)
                },
            ];
            scene.geometry = Geometry::new(meshes, instances).expect("geometry");
            scene.materials.push(Material {
                kind: MATERIAL_EMISSIVE,
                emission: Rgb::WHITE,
                emission_power: radiance,
                flags: if kind == "emitter sampled" {
                    MATERIAL_FLAG_LIGHT
                } else {
                    0
                },
                ..Material::default()
            });
        }
    }
    scene
}

#[test]
fn emitters_are_counted_once_whichever_way_they_are_found() {
    // The same emitter found by next-event estimation and BSDF sampling with MIS (a light, an
    // emissive quad sampled as a light), by light sampling alone (no glossy flag) or by BSDF
    // sampling alone (an emissive quad not sampled as a light) lights the floor the same.
    let reference = mean_where(&render(&emitter_scene("light"), 512), 1, |_, _| true);
    for kind in [
        "light without glossy",
        "emitter sampled",
        "emitter unsampled",
    ] {
        let spp = if kind == "emitter unsampled" {
            2048
        } else {
            512
        };
        let mean = mean_where(&render(&emitter_scene(kind), spp), 1, |_, _| true);
        assert!(
            (mean / reference - 1.0).abs() < 0.02,
            "{kind}: {mean} vs light {reference}"
        );
    }
    assert!(reference > 0.01);
}

/// A diffuse sphere of radius 100 resting on z = 0, a light above and to the right.
fn sphere_on_floor(floor: Floor, background_mode: u32) -> Scene {
    Scene {
        camera: ortho_down(0.0, 0.0, 1600.0),
        materials: vec![lambert(0.7)],
        geometry: Geometry::from_meshes(vec![icosphere(Vec3::new(0.0, 0.0, 100.0), 100.0, 3)]),
        lights: vec![Light {
            kind: LightKind::Rect,
            position: Vec3::new(400.0, 0.0, 600.0),
            direction: Vec3::new(-400.0, 0.0, -600.0).normalize(),
            up: Vec3::new(0.0, 1.0, 0.0),
            size_x: 150.0,
            size_y: 150.0,
            power: 4.0,
            flags: LIGHT_FLAG_GLOSSY,
            ..Light::default()
        }],
        environment: Environment {
            kind: EnvKind::Studio,
            floor: 0.2,
            horizon: 0.4,
            zenith: 0.6,
            strength: 1.0,
            background_color: Rgb::new(0.2, 0.3, 0.4),
            background_mode,
            ..Environment::default()
        },
        floor,
        render: settings(32, 32),
    }
}

/// Pixel of the top view over world point `(x, y)` (camera of [`sphere_on_floor`]).
fn top_view_pixel(x: f32, y: f32) -> (u32, u32) {
    let px = ((x / 1600.0 + 0.5) * 32.0) as u32;
    let py = ((0.5 - y / 1600.0) * 32.0) as u32;
    (px, py)
}

#[test]
fn the_shadow_catcher_keeps_the_shadow_and_writes_alpha() {
    let catcher = Floor {
        mode: FloorMode::ShadowCatcher,
        z: 0.0,
        color: Rgb::splat(0.5),
    };
    // (-170, 0) is in the shadow of the sphere and not under it as seen from above; (650, 650)
    // is open floor.
    let (sx, sy) = top_view_pixel(-170.0, 0.0);
    let (fx, fy) = top_view_pixel(650.0, 650.0);

    let transparent = render(
        &sphere_on_floor(catcher.clone(), BACKGROUND_TRANSPARENT),
        256,
    );
    let (a_shadow, a_far) = (alpha(&transparent, sx, sy), alpha(&transparent, fx, fy));
    assert!(a_shadow > 0.3, "shadow alpha {a_shadow}");
    assert!(a_far < 0.05, "open floor alpha {a_far}");
    assert_eq!(pixel(&transparent, sx, sy), Rgb::BLACK);
    assert_eq!(pixel(&transparent, fx, fy), Rgb::BLACK);
    // The sphere itself is opaque.
    let (cx, cy) = top_view_pixel(0.0, 0.0);
    assert_eq!(alpha(&transparent, cx, cy), 1.0);

    // Over the environment and over a colour: darker in the shadow, opaque everywhere.
    for mode in [BACKGROUND_ENVIRONMENT, BACKGROUND_COLOR] {
        let film = render(&sphere_on_floor(catcher.clone(), mode), 256);
        let (shadow, far) = (pixel(&film, sx, sy).g, pixel(&film, fx, fy).g);
        assert!(
            shadow < 0.7 * far,
            "mode {mode}: shadow {shadow} vs far {far}"
        );
        assert_eq!(alpha(&film, sx, sy), 1.0);
        assert_eq!(alpha(&film, fx, fy), 1.0);
        // The open floor shows the background (nearly) unchanged.
        let background = if mode == BACKGROUND_COLOR { 0.3 } else { 0.2 };
        assert!((far - background).abs() < 0.02, "mode {mode}: far {far}");
    }

    // A visible floor is a real surface: lit, shadowed, opaque.
    let visible = Floor {
        mode: FloorMode::Visible,
        ..catcher
    };
    let film = render(&sphere_on_floor(visible, BACKGROUND_TRANSPARENT), 128);
    let (shadow, far) = (pixel(&film, sx, sy).g, pixel(&film, fx, fy).g);
    assert!(
        shadow < 0.85 * far && far > 0.0,
        "visible floor {shadow} vs {far}"
    );
    assert_eq!(alpha(&film, fx, fy), 1.0);
}

#[test]
fn transparent_backgrounds_cover_only_what_is_there() {
    let mut scene = Scene {
        camera: ortho_front(400.0),
        materials: vec![lambert(0.5)],
        geometry: Geometry::from_meshes(vec![icosphere(Vec3::ZERO, 100.0, 3)]),
        environment: Environment {
            background_mode: BACKGROUND_TRANSPARENT,
            ..uniform_world(0.5)
        },
        render: settings(20, 20),
        ..Scene::default()
    };
    let film = render(&scene, 16);
    // Centre: the sphere, opaque and lit by the world; corner: nothing.
    assert_eq!(alpha(&film, 10, 10), 1.0);
    assert!(pixel(&film, 10, 10).g > 0.1);
    assert_eq!(alpha(&film, 0, 0), 0.0);
    assert_eq!(pixel(&film, 0, 0), Rgb::BLACK);
    // The silhouette is partly covered.
    let edge: Vec<f32> = film
        .resolve_alpha()
        .into_iter()
        .filter(|&a| a > 0.0 && a < 1.0)
        .collect();
    assert!(!edge.is_empty(), "anti-aliased silhouette");

    // A background colour or the environment are opaque everywhere.
    for (mode, corner) in [(BACKGROUND_COLOR, 0.05f32), (BACKGROUND_ENVIRONMENT, 0.5)] {
        scene.environment.background_mode = mode;
        scene.environment.background_color = Rgb::splat(0.05);
        let film = render(&scene, 4);
        assert_eq!(alpha(&film, 0, 0), 1.0);
        assert!((pixel(&film, 0, 0).g - corner).abs() < 1.0e-5);
    }
}

#[test]
fn camera_and_glossy_flags_decide_who_sees_a_light() {
    // A panel behind a mirror sphere, facing the camera.
    let panel = |flags: u32| Light {
        kind: LightKind::Rect,
        position: Vec3::new(0.0, 300.0, 0.0),
        direction: Vec3::new(0.0, -1.0, 0.0),
        up: Vec3::new(0.0, 0.0, 1.0),
        size_x: 600.0,
        size_y: 600.0,
        power: 1.0,
        flags,
        ..Light::default()
    };
    let radiance = 1.0 / (fmath::PI * 0.36);
    let scene = |flags: u32| Scene {
        camera: ortho_front(500.0),
        materials: vec![Material {
            base_color: Rgb::WHITE,
            metallic: 1.0,
            roughness: 0.0,
            ..Material::default()
        }],
        // A mirror sphere far in front of the panel (seen from the camera side).
        geometry: Geometry::from_meshes(vec![icosphere(Vec3::new(0.0, -600.0, 0.0), 60.0, 4)]),
        lights: vec![panel(flags)],
        environment: black_world(),
        render: settings(20, 20),
        ..Scene::default()
    };
    // Corner pixel: the panel straight behind; centre: the mirror sphere, whose middle reflects
    // back towards the camera (black), whose rim reflects the panel behind it.
    let visible = render(&scene(LIGHT_FLAG_CAMERA), 4);
    assert!((pixel(&visible, 1, 1).g - radiance).abs() < 1.0e-3 * radiance);
    let hidden = render(&scene(LIGHT_FLAG_GLOSSY), 4);
    assert_eq!(pixel(&hidden, 1, 1), Rgb::BLACK);
    // The glossy flag makes it appear in the mirror: total reflected light on the sphere.
    let sphere = |x: u32, y: u32| {
        let (u, v) = ((x as f32 + 0.5) / 20.0 - 0.5, (y as f32 + 0.5) / 20.0 - 0.5);
        (u * u + v * v).sqrt() * 500.0 < 55.0
    };
    let glossy = mean_where(&render(&scene(LIGHT_FLAG_GLOSSY), 64), 1, sphere);
    let matte = mean_where(&render(&scene(0), 64), 1, sphere);
    // Only the rim of the sphere reflects the panel behind it.
    assert!(glossy > 1.0e-3 * radiance as f64, "glossy {glossy}");
    assert!(
        matte < 1.0e-3 * glossy,
        "no reflection without the flag: {matte}"
    );
}

#[test]
fn depth_and_clamp_shape_the_indirect_light() {
    let mut scene = crate::example::scene();
    scene.render.width = 48;
    scene.render.height = 36;
    scene.render.max_depth = 1;
    let direct = render(&scene, 16);
    scene.render.max_depth = 8;
    let full = render(&scene, 16);
    let mean = |f: &Film| mean_where(f, 1, |_, _| true);
    assert!(mean(&full) > 1.02 * mean(&direct), "bounces add light");
    // The clamp touches indirect light only: direct-only renders do not change.
    scene.render.clamp_indirect = 1.0e-3;
    let clamped = render(&scene, 16);
    assert!(mean(&clamped) < mean(&full));
    assert!(mean(&clamped) > mean(&direct) * 0.999);
    scene.render.max_depth = 1;
    assert_eq!(render(&scene, 16), direct);
}

#[test]
fn reserved_kinds_render_like_their_stand_ins() {
    let mut scene = crate::example::scene();
    scene.render.width = 24;
    scene.render.height = 18;
    let base = render(&scene, 2);
    // Point and spot lights (L4) add nothing yet.
    scene.lights.push(Light {
        kind: LightKind::Point,
        power: 1000.0,
        ..Light::default()
    });
    scene.lights.push(Light {
        kind: LightKind::Spot,
        power: 1000.0,
        ..Light::default()
    });
    assert_eq!(render(&scene, 2), base);
    // Sky and HDRI (E5) render as the dome; glass (E5) as the principled surface; the
    // backplate (M2) as the background colour.
    scene.environment.kind = EnvKind::Sky;
    assert_eq!(render(&scene, 2), base);
    scene.environment.kind = EnvKind::Hdri;
    assert_eq!(render(&scene, 2), base);
    scene.materials[0].kind = 1;
    assert_eq!(render(&scene, 2), base);
    scene.environment.background_mode = BACKGROUND_COLOR;
    let colour = render(&scene, 2);
    scene.environment.background_mode = 3;
    assert_eq!(render(&scene, 2), colour);
}

#[test]
fn rays_leave_coarse_smooth_meshes_from_the_smooth_surface() {
    // Near the shadow terminator of a coarse sphere with smooth normals, a light the smooth
    // normal says is visible (5 degrees above the shading horizon) can be below the flat
    // facet's plane: a shadow ray from the facet then hits the facet itself, and the terminator
    // comes out in facet-shaped steps. From the lifted point it much more rarely does. The lift
    // never goes inside the facet and stays within the facet's sag (about 1.6 mm for this
    // 320-triangle sphere) of the true sphere.
    let centre = Vec3::new(10.0, -20.0, 30.0);
    let smooth = Geometry::from_meshes(vec![icosphere(centre, 100.0, 2)]);
    let moved = Geometry::new(
        vec![icosphere(Vec3::ZERO, 50.0, 2)],
        vec![Instance::new(
            0,
            Transform::from_rows([
                [2.0, 0.0, 0.0, centre.x],
                [0.0, 2.0, 0.0, centre.y],
                [0.0, 0.0, 2.0, centre.z],
            ]),
            0,
        )],
    )
    .expect("geometry");
    let flat = Geometry::from_meshes(vec![faceted_sphere(centre, 100.0, 2)]);
    let mut rng = crate::rng::Pcg32::seeded(2, 2);
    for geometry in [&smooth, &moved] {
        let (mut blocked_flat, mut blocked_lifted) = (0, 0);
        for _ in 0..2000 {
            let dir = crate::warp::uniform_sphere((rng.next_f32(), rng.next_f32()));
            let ray = Ray::new(centre - dir * 500.0, dir);
            let hit = geometry.intersect(&ray).expect("hit");
            let lifted = geometry.terminator_point(&hit);
            let before = (hit.point - centre).length();
            let after = (lifted - centre).length();
            assert!(after >= before - 1.0e-3, "{before} -> {after}");
            assert!((after - 100.0).abs() < 2.0, "lifted to {after}");
            let frame = Frame::from_normal(hit.normal);
            let (s, c) = fmath::sin_cos(5.0 * fmath::DEG_TO_RAD);
            let to_light = (frame.x * c + hit.normal * s).normalize();
            let ng = hit.geometric_normal;
            if to_light.dot(ng) > 0.0 {
                continue; // above the facet: a convex mesh cannot shadow itself there
            }
            let shadow = |p: Vec3| geometry.occluded(&Ray::new(offset_origin(p, ng), to_light));
            blocked_flat += usize::from(shadow(hit.point));
            blocked_lifted += usize::from(shadow(lifted));
            let hit = flat.intersect(&ray).expect("hit");
            assert_eq!(flat.terminator_point(&hit), hit.point);
        }
        assert!(
            blocked_flat > 50,
            "the test must reach the terminator: {blocked_flat}"
        );
        assert!(
            blocked_lifted * 4 < blocked_flat,
            "lifted {blocked_lifted} vs flat {blocked_flat}"
        );
    }
}
