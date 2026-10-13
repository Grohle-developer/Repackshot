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
    INSTANCE_ONE_SIDED, LIGHT_FLAG_CAMERA, LIGHT_FLAG_GLOSSY, LIGHT_FLAG_NO_SHADOW,
    MATERIAL_EMISSIVE, MATERIAL_FLAG_LIGHT,
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

/// A point light (L4) of `power` W and `diameter` mm, `h` above a white floor seen straight down
/// at a 2 mm spot.
fn point_scene(kind: LightKind, diameter: f32, h: f32, power: f32, flags: u32) -> Scene {
    Scene {
        camera: ortho_down(0.0, 0.0, 2.0),
        materials: vec![lambert(1.0)],
        geometry: Geometry::from_meshes(vec![floor_quad(2000.0)]),
        lights: vec![Light {
            kind,
            position: Vec3::new(0.0, 0.0, h),
            direction: Vec3::new(0.0, 0.0, -1.0),
            size_x: diameter,
            size_y: diameter,
            power,
            spread_deg: 50.0,
            angle_deg: 5.0,
            flags,
            ..Light::default()
        }],
        environment: black_world(),
        render: settings(8, 8),
        ..Scene::default()
    }
}

#[test]
fn point_and_spot_lights_give_the_inverse_square_irradiance() {
    // 6 W, 300 mm above a white Lambertian floor: E = 6 / (4π 0.3²) W/m² and the floor's
    // radiance E / π, for a point, a sphere of 80 mm (the same on its axis, found by both
    // techniques), and a spot looking straight down (its axis is its point light's).
    let (h, power) = (300.0f32, 6.0f32);
    let e = power as f64 / (4.0 * std::f64::consts::PI * (h as f64 * 1.0e-3).powi(2));
    let want = e / std::f64::consts::PI;
    for (kind, diameter, spp) in [
        (LightKind::Point, 0.0, 4),
        (LightKind::Point, 80.0, 2048),
        (LightKind::Spot, 0.0, 4),
        (LightKind::Spot, 80.0, 2048),
    ] {
        let film = render(
            &point_scene(kind, diameter, h, power, LIGHT_FLAG_GLOSSY),
            spp,
        );
        let got = mean_where(&film, 1, |_, _| true);
        assert!(
            (got / want - 1.0).abs() < 0.01,
            "{kind:?} {diameter}: {got} vs {want}"
        );
    }
}

#[test]
fn sphere_lights_are_counted_once_whichever_way_they_are_found() {
    // A glowing sphere close to a floor, wide to the camera: next-event estimation and BSDF
    // sampling with MIS (glossy) light it as next-event estimation alone (not glossy) does.
    let scene = |flags| Scene {
        camera: ortho_down(0.0, 0.0, 1200.0),
        render: settings(24, 24),
        ..point_scene(LightKind::Point, 300.0, 250.0, 6.0, flags)
    };
    let both = mean_where(&render(&scene(LIGHT_FLAG_GLOSSY), 512), 1, |_, _| true);
    let alone = mean_where(&render(&scene(0), 512), 1, |_, _| true);
    assert!(both > 0.01);
    assert!((both / alone - 1.0).abs() < 0.02, "{both} vs {alone}");
}

#[test]
fn a_spot_leaves_dark_what_is_outside_its_cone() {
    // A 50 degree spot 300 mm up: 200 mm to the side (34 degrees off its axis) is dark; a point
    // light there is not.
    let wide = |kind| Scene {
        camera: ortho_down(200.0, 0.0, 2.0),
        ..point_scene(kind, 0.0, 300.0, 6.0, LIGHT_FLAG_GLOSSY)
    };
    assert_eq!(
        mean_where(&render(&wide(LightKind::Spot), 4), 1, |_, _| true),
        0.0
    );
    assert!(mean_where(&render(&wide(LightKind::Point), 4), 1, |_, _| true) > 0.01);
}

#[test]
fn a_light_without_shadow_lights_through_what_is_in_its_way() {
    // A slab between a point light and the floor: dark under it, unless the light casts no
    // shadow (L4), when the floor is lit as if the slab were not there. Direct light only (the
    // floor around the shadow lights the slab's underside, which would light the floor under it).
    let blocked = |flags| {
        let mut scene = point_scene(LightKind::Point, 0.0, 300.0, 6.0, flags);
        scene.render.max_depth = 1;
        let slab = box_mesh(Vec3::new(-50.0, -50.0, 150.0), Vec3::new(50.0, 50.0, 160.0));
        scene.geometry = Geometry::new(
            vec![floor_quad(2000.0), slab],
            vec![
                Instance::new(0, Transform::IDENTITY, 0),
                Instance::new(1, Transform::IDENTITY, 0),
            ],
        )
        .expect("geometry");
        // Straight down through the slab would see the slab: the camera is under it.
        scene.camera = Camera {
            position: Vec3::new(0.0, -1.0, 100.0),
            target: Vec3::new(0.0, 0.0, 0.0),
            up: Vec3::new(0.0, 0.0, 1.0),
            ortho: true,
            ortho_width: 2.0,
            ..Camera::default()
        };
        mean_where(&render(&scene, 4), 1, |_, _| true)
    };
    let free = mean_where(
        &render(
            &point_scene(LightKind::Point, 0.0, 300.0, 6.0, LIGHT_FLAG_GLOSSY),
            4,
        ),
        1,
        |_, _| true,
    );
    assert_eq!(blocked(LIGHT_FLAG_GLOSSY), 0.0);
    let through = blocked(LIGHT_FLAG_GLOSSY | LIGHT_FLAG_NO_SHADOW);
    assert!((through / free - 1.0).abs() < 0.01, "{through} vs {free}");
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
        bitmaps: Vec::new(),
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
    // An HDRI without its bitmap renders as the dome; glass without transmission (and without
    // metal, as the example's) as the principled surface; a backplate without its bitmap as
    // the background colour. The sky (E5) is not the dome any more.
    scene.environment.kind = EnvKind::Hdri;
    assert_eq!(render(&scene, 2), base);
    scene.materials[0].kind = 1;
    assert_eq!(render(&scene, 2), base);
    scene.environment.background_mode = BACKGROUND_COLOR;
    let colour = render(&scene, 2);
    scene.environment.background_mode = 3;
    assert_eq!(render(&scene, 2), colour);
    scene.environment.background_mode = 0;
    scene.environment.kind = EnvKind::Sky;
    assert_ne!(render(&scene, 2), base);
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

// ------------------------------------------------------------------ E5: glass, cut-outs, maps

/// A closed box from `min` to `max`, wound counter-clockwise seen from outside, no normals.
fn box_mesh(min: Vec3, max: Vec3) -> Mesh {
    let p = |x: bool, y: bool, z: bool| {
        Vec3::new(
            if x { max.x } else { min.x },
            if y { max.y } else { min.y },
            if z { max.z } else { min.z },
        )
    };
    let corners = [
        p(false, false, false),
        p(true, false, false),
        p(true, true, false),
        p(false, true, false),
        p(false, false, true),
        p(true, false, true),
        p(true, true, true),
        p(false, true, true),
    ];
    let quads = [
        [0, 3, 2, 1], // bottom (-z)
        [4, 5, 6, 7], // top (+z)
        [0, 1, 5, 4], // -y
        [2, 3, 7, 6], // +y
        [1, 2, 6, 5], // +x
        [3, 0, 4, 7], // -x
    ];
    let indices: Vec<u32> = quads
        .iter()
        .flat_map(|q| [q[0], q[1], q[2], q[0], q[2], q[3]])
        .collect();
    Mesh::new(&corners, &[], &indices, 0).expect("box")
}

fn clear_glass(roughness: f32) -> Material {
    Material {
        kind: crate::scene::MATERIAL_GLASS,
        base_color: Rgb::WHITE,
        roughness,
        ior: 1.5,
        transmission: 1.0,
        ..Material::default()
    }
}

#[test]
fn glass_in_a_white_furnace_conserves_energy() {
    // A clear sphere without absorption in a uniform world of radiance 1 refracts and reflects
    // the world back: every pixel converges to 1 (the radiance compressed by η² inside comes
    // back on the way out). Flat facets, so that shading and geometric normals agree.
    for (roughness, low) in [(0.0f32, 0.98), (0.3, 0.9)] {
        let scene = Scene {
            camera: ortho_front(260.0),
            materials: vec![clear_glass(roughness)],
            geometry: Geometry::from_meshes(vec![faceted_sphere(Vec3::ZERO, 100.0, 3)]),
            environment: uniform_world(1.0),
            render: RenderSettings {
                max_depth: 64,
                ..settings(16, 16)
            },
            ..Scene::default()
        };
        let film = render(&scene, 256);
        let mean = mean_where(&film, 1, |_, _| true);
        assert!(
            mean > low && mean < 1.02,
            "roughness {roughness}: mean {mean}"
        );
        // The middle of the sphere too, not only the background around it.
        let centre = mean_where(&film, 1, |x, y| {
            (6..10).contains(&x) && (6..10).contains(&y)
        });
        assert!(
            centre > low - 0.02 && centre < 1.03,
            "roughness {roughness}: centre {centre}"
        );
    }
}

#[test]
fn a_glass_sphere_before_a_camera_visible_panel_shows_the_bright_field() {
    // BACKLIT: a panel the camera sees, 600 mm square, behind a clear sphere in a black world.
    // Around the sphere and through its middle the panel shows (through the middle at
    // `(1 - F)²` of its radiance); near the rim refraction bends the view off the panel, so the
    // sphere is drawn by a dark outline on a bright field.
    let radiance = 1.0 / (fmath::PI * 0.36);
    let scene = Scene {
        camera: ortho_front(500.0),
        materials: vec![clear_glass(0.0)],
        geometry: Geometry::from_meshes(vec![icosphere(Vec3::ZERO, 100.0, 4)]),
        lights: vec![Light {
            kind: LightKind::Rect,
            position: Vec3::new(0.0, 300.0, 0.0),
            direction: Vec3::new(0.0, -1.0, 0.0),
            up: Vec3::new(0.0, 0.0, 1.0),
            size_x: 600.0,
            size_y: 600.0,
            power: 1.0,
            flags: LIGHT_FLAG_CAMERA | LIGHT_FLAG_GLOSSY,
            ..Light::default()
        }],
        environment: black_world(),
        render: settings(80, 80),
        ..Scene::default()
    };
    let film = render(&scene, 16);
    // Distance of a pixel centre from the sphere's centre in the image, in radii.
    let r = |x: u32, y: u32| {
        let (u, v) = ((x as f32 + 0.5) / 80.0 - 0.5, (y as f32 + 0.5) / 80.0 - 0.5);
        (u * u + v * v).sqrt() * 500.0 / 100.0
    };
    let field = mean_where(&film, 1, |x, y| (1.15..1.6).contains(&r(x, y)));
    let middle = mean_where(&film, 1, |x, y| r(x, y) < 0.15);
    let rim = mean_where(&film, 1, |x, y| (0.93..0.985).contains(&r(x, y)));
    let l = radiance as f64;
    assert!((field / l - 1.0).abs() < 1.0e-3, "field {field} vs {l}");
    assert!(middle > 0.85 * l && middle < 0.96 * l, "middle {middle}");
    // Measured 0.37 of the field (what light the rim still sends comes from inner reflections
    // and from the pixels' edges).
    assert!(rim < 0.5 * l && rim < 0.5 * middle, "rim {rim}");
}

/// A slab of glass 10 mm thick (z from 0 to 10) over an emitter of radiance 1 at z = -50,
/// in a black world, seen straight down.
fn slab_scene(glass: Material) -> Scene {
    let emitter = Material {
        kind: MATERIAL_EMISSIVE,
        emission: Rgb::WHITE,
        emission_power: 1.0,
        ..Material::default()
    };
    let mut panel = floor_quad(3000.0);
    panel = Mesh::new(
        &(0..panel.vertex_count())
            .filter_map(|i| panel.position(i))
            .map(|p| p - Vec3::new(0.0, 0.0, 50.0))
            .collect::<Vec<_>>(),
        &[],
        panel.indices(),
        1,
    )
    .expect("panel");
    let meshes = vec![
        box_mesh(
            Vec3::new(-1000.0, -1000.0, 0.0),
            Vec3::new(1000.0, 1000.0, 10.0),
        ),
        panel,
    ];
    Scene {
        camera: ortho_down(0.0, 0.0, 40.0),
        materials: vec![glass, emitter],
        geometry: Geometry::from_meshes(meshes),
        environment: black_world(),
        render: RenderSettings {
            max_depth: 64,
            ..settings(8, 8)
        },
        ..Scene::default()
    }
}

#[test]
fn a_glass_slab_transmits_the_analytic_amount() {
    // Normal incidence on a slab: each face reflects R = ((n - 1) / (n + 1))² = 0.04, the inside
    // keeps τ of the light per pass, and the reflections between the faces add up to
    // T = (1 - R)² τ / (1 - R² τ²) (incoherent multiple reflections).
    let r = crate::bsdf::fresnel_dielectric(1.0, 1.5) as f64;
    assert!((r - 0.04).abs() < 1.0e-6);
    // Beer–Lambert: base colour 0.5 at 10 mm, a slab of 10 mm: τ = 0.5 (and 0.25 for blue,
    // given 0.25 at 10 mm).
    let absorbing = Material {
        base_color: Rgb::new(0.5, 0.5, 0.25),
        absorption_mm: 10.0,
        ..clear_glass(0.0)
    };
    let film = render(&slab_scene(absorbing), 512);
    for (channel, tau) in [(1usize, 0.5f64), (2, 0.25)] {
        let want = (1.0 - r) * (1.0 - r) * tau / (1.0 - r * r * tau * tau);
        let got = mean_where(&film, channel, |_, _| true);
        assert!(
            (got / want - 1.0).abs() < 0.01,
            "channel {channel}: {got} vs {want}"
        );
    }
    // Without an absorption distance the colour tints the two crossings (√c each) and not the
    // reflections inside: T = (1 - R)² c / (1 - R²).
    let tinted = Material {
        base_color: Rgb::splat(0.36),
        ..clear_glass(0.0)
    };
    let got = mean_where(&render(&slab_scene(tinted), 512), 1, |_, _| true);
    let want = (1.0 - r) * (1.0 - r) * 0.36 / (1.0 - r * r);
    assert!((got / want - 1.0).abs() < 0.01, "{got} vs {want}");
    // Clear glass: (1 - R)² / (1 - R²) = (1 - R) / (1 + R).
    let got = mean_where(&render(&slab_scene(clear_glass(0.0)), 512), 1, |_, _| true);
    let want = (1.0 - r) / (1.0 + r);
    assert!((got / want - 1.0).abs() < 0.01, "{got} vs {want}");
}

/// A grey floor under a delta sun from straight above and, at z = 200, a strip of `sheet`
/// 100 mm wide (|x| < 50) and long in y, seen by an orthographic camera tilted 45 degrees so
/// that the floor under the strip is seen past it.
fn strip_scene(sheet: Option<Material>) -> Scene {
    let mut meshes = vec![floor_quad(3000.0)];
    let mut instances = vec![Instance::new(0, Transform::IDENTITY, 0)];
    let mut materials = vec![lambert(0.5)];
    if let Some(m) = sheet {
        let strip = Mesh::new(
            &[
                Vec3::new(-50.0, -3000.0, 200.0),
                Vec3::new(50.0, -3000.0, 200.0),
                Vec3::new(50.0, 3000.0, 200.0),
                Vec3::new(-50.0, 3000.0, 200.0),
            ],
            &[],
            &[0, 1, 2, 0, 2, 3],
            0,
        )
        .expect("strip");
        meshes.push(strip);
        instances.push(Instance::new(1, Transform::IDENTITY, 1));
        materials.push(m);
    }
    Scene {
        camera: Camera {
            position: Vec3::new(2000.0, 0.0, 2000.0),
            target: Vec3::ZERO,
            up: Vec3::new(0.0, 0.0, 1.0),
            ortho: true,
            ortho_width: 400.0,
            ..Camera::default()
        },
        materials,
        geometry: Geometry::new(meshes, instances).expect("geometry"),
        lights: vec![Light {
            kind: LightKind::Sun,
            direction: Vec3::new(0.0, 0.0, -1.0),
            power: 1.0,
            angle_deg: 0.0,
            flags: LIGHT_FLAG_GLOSSY,
            ..Light::default()
        }],
        environment: black_world(),
        render: settings(16, 16),
        ..Scene::default()
    }
}

/// Mean green of the pixels of `strip_scene` whose ray meets the floor at `|x| < 30`, and of
/// those at `x > 120` (on the other side the camera sees the floor through the strip).
fn under_and_beside(film: &Film) -> (f64, f64) {
    // The camera looks along (-1, 0, -1) / √2 over a square 400 mm wide: the rows step along
    // its up vector (-1, 0, 1) / √2, which meets the floor at x = -up offset · √2.
    let x_of_row = |y: u32| {
        let v = (y as f32 + 0.5) / 16.0;
        let up = (0.5 - v) * 400.0;
        -up * std::f32::consts::SQRT_2
    };
    let under = mean_where(film, 1, |_, y| x_of_row(y).abs() < 30.0);
    let beside = mean_where(film, 1, |_, y| x_of_row(y) > 120.0);
    (under, beside)
}

#[test]
fn thin_walls_and_cut_outs_cast_partial_shadows() {
    let open = under_and_beside(&render(&strip_scene(None), 64));
    // Unshadowed floor: albedo / π times the sun's irradiance.
    let lit = 0.5 / std::f64::consts::PI;
    assert!(
        (open.0 / lit - 1.0).abs() < 0.01 && (open.1 / lit - 1.0).abs() < 0.01,
        "{open:?} vs {lit}"
    );
    // An opaque strip: a full shadow.
    let opaque = under_and_beside(&render(&strip_scene(Some(lambert(0.0))), 64));
    assert!(opaque.0 < 0.01 * lit, "{opaque:?}");
    // A black cut-out of opacity 0.3: 70 % of the light.
    let cut = Material {
        opacity: 0.3,
        ..lambert(0.0)
    };
    let cut = under_and_beside(&render(&strip_scene(Some(cut)), 64));
    assert!((cut.0 / lit - 0.7).abs() < 0.01, "{cut:?}");
    assert!((cut.1 / lit - 1.0).abs() < 0.01, "{cut:?}");
    // A thin wall of clear glass tinted green: 1 - R' of the light, tinted once (the floor sees
    // a little more, from the light it reflects back down from the wall's underside).
    let r1 = crate::bsdf::fresnel_dielectric(1.0, 1.5) as f64;
    let through = 1.0 - 2.0 * r1 / (1.0 + r1);
    let wall = Material {
        base_color: Rgb::new(0.2, 0.8, 0.2),
        flags: crate::scene::MATERIAL_FLAG_THIN,
        ..clear_glass(0.0)
    };
    let wall = under_and_beside(&render(&strip_scene(Some(wall)), 256));
    let want = 0.8 * through;
    assert!(
        wall.0 / lit > want - 0.005 && wall.0 / lit < want + 0.03,
        "{} vs {want}",
        wall.0 / lit
    );
    // A solid (refracting) sheet stops shadow rays: its light arrives only by refraction, and
    // a delta sun cannot be found that way.
    let solid = under_and_beside(&render(&strip_scene(Some(clear_glass(0.0))), 64));
    assert!(solid.0 < 0.05 * lit, "{solid:?}");
}

#[test]
fn light_through_thin_walls_is_counted_once_whichever_way_it_is_found() {
    // The emitter scene of `emitters_are_counted_once_whichever_way_they_are_found` with a thin
    // clear wall between the floor and the light: light sampling sends shadow rays through it,
    // BSDF sampling goes straight through it, and multiple importance sampling weighs them
    // with the distance from the floor, not from the wall.
    let with_wall = |kind: &str| {
        let mut scene = emitter_scene(kind);
        let wall = Mesh::new(
            &[
                Vec3::new(-2000.0, -2000.0, 150.0),
                Vec3::new(2000.0, -2000.0, 150.0),
                Vec3::new(2000.0, 2000.0, 150.0),
                Vec3::new(-2000.0, 2000.0, 150.0),
            ],
            &[],
            &[0, 1, 2, 0, 2, 3],
            0,
        )
        .expect("wall");
        let mut meshes = scene.geometry.meshes().to_vec();
        let mut instances = scene.geometry.instances().to_vec();
        meshes.push(wall);
        let material = scene.materials.len() as u32;
        instances.push(Instance::new(
            meshes.len() as u32 - 1,
            Transform::IDENTITY,
            material,
        ));
        scene.materials.push(Material {
            flags: crate::scene::MATERIAL_FLAG_THIN,
            ..clear_glass(0.0)
        });
        scene.geometry = Geometry::new(meshes, instances).expect("geometry");
        scene
    };
    // The wall also mirrors the emitter (a light without the glossy flag shows in no
    // reflection): only the floor outside the mirror image, |x|, |y| > 150 mm, is compared.
    let outer = |x: u32, y: u32| !((8..16).contains(&x) && (8..16).contains(&y));
    let reference = mean_where(&render(&with_wall("light"), 1024), 1, outer);
    for (kind, spp) in [
        ("light without glossy", 1024),
        ("emitter sampled", 1024),
        ("emitter unsampled", 4096),
    ] {
        let mean = mean_where(&render(&with_wall(kind), spp), 1, outer);
        assert!(
            (mean / reference - 1.0).abs() < 0.025,
            "{kind}: {mean} vs light {reference}"
        );
    }
    // And the wall takes its share: the floor is darker than without it.
    let open = mean_where(&render(&emitter_scene("light"), 512), 1, outer);
    assert!(
        reference < 0.95 * open && reference > 0.7 * open,
        "{reference} vs {open}"
    );
}

#[test]
fn an_emitter_inside_a_thin_bulb_lights_the_room() {
    // A small emissive sphere inside a thin glass bulb above a floor: the floor under it gets
    // about 1 - R' of what it gets without the bulb.
    let build = |bulb: bool| {
        let mut meshes = vec![
            floor_quad(3000.0),
            icosphere(Vec3::new(0.0, 0.0, 300.0), 20.0, 2),
        ];
        let mut instances = vec![
            Instance::new(0, Transform::IDENTITY, 0),
            Instance::new(1, Transform::IDENTITY, 1),
        ];
        if bulb {
            meshes.push(icosphere(Vec3::new(0.0, 0.0, 300.0), 60.0, 3));
            instances.push(Instance::new(2, Transform::IDENTITY, 2));
        }
        Scene {
            camera: ortho_down(0.0, 0.0, 100.0),
            materials: vec![
                lambert(0.5),
                Material {
                    kind: MATERIAL_EMISSIVE,
                    emission: Rgb::WHITE,
                    emission_power: 20.0,
                    flags: MATERIAL_FLAG_LIGHT,
                    ..Material::default()
                },
                Material {
                    flags: crate::scene::MATERIAL_FLAG_THIN,
                    ..clear_glass(0.0)
                },
            ],
            geometry: Geometry::new(meshes, instances).expect("geometry"),
            environment: black_world(),
            render: settings(8, 8),
            ..Scene::default()
        }
    };
    let open = mean_where(&render(&build(false), 256), 1, |_, _| true);
    let bulb = mean_where(&render(&build(true), 256), 1, |_, _| true);
    let r1 = crate::bsdf::fresnel_dielectric(1.0, 1.5) as f64;
    let through = 1.0 - 2.0 * r1 / (1.0 + r1);
    assert!(open > 0.0);
    assert!(
        bulb / open > through - 0.02 && bulb / open < through + 0.04,
        "{} vs {through}",
        bulb / open
    );
}

#[test]
fn cut_outs_show_the_background_through_their_holes() {
    let card = Mesh::new(
        &[
            Vec3::new(-500.0, 0.0, -500.0),
            Vec3::new(500.0, 0.0, -500.0),
            Vec3::new(500.0, 0.0, 500.0),
            Vec3::new(-500.0, 0.0, 500.0),
        ],
        &[],
        &[0, 1, 2, 0, 2, 3],
        0,
    )
    .expect("card");
    let mut scene = Scene {
        camera: ortho_front(200.0),
        materials: vec![Material {
            opacity: 0.25,
            ..lambert(0.0)
        }],
        geometry: Geometry::from_meshes(vec![card]),
        environment: Environment {
            background_color: Rgb::new(0.2, 0.4, 0.8),
            ..black_world()
        },
        render: settings(8, 8),
        ..Scene::default()
    };
    let film = render(&scene, 1024);
    let b = mean_where(&film, 2, |_, _| true);
    assert!((b - 0.75 * 0.8).abs() < 0.01, "{b}");
    // With a transparent background, a quarter of the samples are covered.
    scene.environment.background_mode = BACKGROUND_TRANSPARENT;
    let film = render(&scene, 1024);
    let a: f64 = (0..8)
        .flat_map(|y| (0..8).map(move |x| (x, y)))
        .map(|(x, y)| alpha(&film, x, y) as f64)
        .sum::<f64>()
        / 64.0;
    assert!((a - 0.25).abs() < 0.01, "{a}");
}

/// A `w x h` bitmap of linear pixels given by `f(x, y)`.
fn bitmap(w: u32, h: u32, f: impl Fn(u32, u32) -> Rgb) -> crate::bitmap::Bitmap {
    let mut rgb = Vec::new();
    for y in 0..h {
        for x in 0..w {
            let c = f(x, y);
            rgb.extend_from_slice(&[c.r, c.g, c.b]);
        }
    }
    crate::bitmap::Bitmap::from_linear(w, h, &rgb).expect("bitmap")
}

#[test]
fn a_uniform_hdri_lights_like_the_flat_environment_of_its_value() {
    let mut scene = Scene {
        camera: ortho_front(260.0),
        materials: vec![Material {
            base_color: Rgb::new(0.7, 0.5, 0.3),
            roughness: 0.4,
            ..Material::default()
        }],
        geometry: Geometry::from_meshes(vec![icosphere(Vec3::ZERO, 100.0, 3)]),
        environment: uniform_world(0.8),
        render: settings(16, 16),
        ..Scene::default()
    };
    let flat = render(&scene, 256);
    scene.bitmaps = vec![bitmap(16, 8, |_, _| Rgb::splat(0.4))];
    scene.environment = Environment {
        kind: EnvKind::Hdri,
        hdri_map: 0,
        strength: 2.0,
        rotation_deg: 33.0,
        ..uniform_world(0.0)
    };
    let hdri = render(&scene, 256);
    for channel in 0..3 {
        let (a, b) = (
            mean_where(&flat, channel, |_, _| true),
            mean_where(&hdri, channel, |_, _| true),
        );
        assert!((a / b - 1.0).abs() < 0.02, "channel {channel}: {a} vs {b}");
    }
}

#[test]
fn the_background_image_fills_fits_or_stretches_the_frame_and_lights_nothing() {
    // A 4 x 2 image, red on the left half and blue on the right, behind a square frame.
    let image = bitmap(4, 2, |x, _| {
        if x < 2 {
            Rgb::new(1.0, 0.0, 0.0)
        } else {
            Rgb::new(0.0, 0.0, 1.0)
        }
    });
    let mut scene = Scene {
        camera: ortho_front(200.0),
        environment: Environment {
            background_mode: crate::scene::BACKGROUND_BACKPLATE,
            backplate_map: 0,
            background_color: Rgb::new(0.0, 1.0, 0.0),
            ..black_world()
        },
        bitmaps: vec![image.clone()],
        render: settings(16, 16),
        ..Scene::default()
    };
    // Fill: the middle half of the image covers the square frame.
    let fill = render(&scene, 1);
    assert_eq!(pixel(&fill, 2, 8), Rgb::new(1.0, 0.0, 0.0));
    assert_eq!(pixel(&fill, 13, 8), Rgb::new(0.0, 0.0, 1.0));
    assert_eq!(pixel(&fill, 2, 0), Rgb::new(1.0, 0.0, 0.0));
    // Fit: the whole image, letterboxed in the background colour above and below.
    scene.environment.backplate_fit = crate::scene::BACKPLATE_FIT;
    let fit = render(&scene, 1);
    assert_eq!(pixel(&fit, 8, 1), Rgb::new(0.0, 1.0, 0.0));
    assert_eq!(pixel(&fit, 0, 8), Rgb::new(1.0, 0.0, 0.0));
    assert_eq!(pixel(&fit, 15, 8), Rgb::new(0.0, 0.0, 1.0));
    // Stretch: the image squeezed into the frame.
    scene.environment.backplate_fit = crate::scene::BACKPLATE_STRETCH;
    let stretch = render(&scene, 1);
    assert_eq!(pixel(&stretch, 0, 1), Rgb::new(1.0, 0.0, 0.0));
    assert_eq!(pixel(&stretch, 15, 14), Rgb::new(0.0, 0.0, 1.0));
    // A frame rect: the image is fitted to the left half of the rendered image.
    scene.environment.backplate_rect = [0.0, 0.0, 0.5, 1.0];
    let half = render(&scene, 1);
    assert_eq!(pixel(&half, 6, 8), Rgb::new(0.0, 0.0, 1.0));

    // A tall image (2 x 4: red, yellow, cyan and blue rows) in the square frame.
    scene.bitmaps = vec![bitmap(2, 4, |_, y| match y {
        0 => Rgb::new(1.0, 0.0, 0.0),
        1 => Rgb::new(1.0, 1.0, 0.0),
        2 => Rgb::new(0.0, 1.0, 1.0),
        _ => Rgb::new(0.0, 0.0, 1.0),
    })];
    scene.environment.backplate_rect = [0.0, 0.0, 1.0, 1.0];
    // Fill crops it to its middle rows: the top of the frame is mostly yellow, not red.
    scene.environment.backplate_fit = crate::scene::BACKPLATE_FILL;
    let fill = render(&scene, 1);
    assert!(pixel(&fill, 8, 0).g > 0.4, "{:?}", pixel(&fill, 8, 0));
    assert!(pixel(&fill, 8, 15).r < 0.6, "{:?}", pixel(&fill, 8, 15));
    // Fit shows every row, with bands of background colour left and right.
    scene.environment.backplate_fit = crate::scene::BACKPLATE_FIT;
    let fit = render(&scene, 1);
    assert_eq!(pixel(&fit, 1, 8), Rgb::new(0.0, 1.0, 0.0));
    assert_eq!(pixel(&fit, 14, 8), Rgb::new(0.0, 1.0, 0.0));
    assert!(
        pixel(&fit, 8, 0).r > 0.9 && pixel(&fit, 8, 0).g < 0.2,
        "{:?}",
        pixel(&fit, 8, 0)
    );
    scene.bitmaps = vec![image.clone()];

    // It lights nothing: a sphere lit by the world is the same over the image or a colour.
    let lit = |mode: u32| {
        let s = Scene {
            materials: vec![lambert(0.8)],
            geometry: Geometry::from_meshes(vec![icosphere(Vec3::ZERO, 50.0, 2)]),
            environment: Environment {
                background_mode: mode,
                backplate_map: 0,
                ..uniform_world(0.5)
            },
            ..scene.clone()
        };
        render(&s, 16)
    };
    let (over_image, over_colour) = (
        lit(crate::scene::BACKGROUND_BACKPLATE),
        lit(BACKGROUND_COLOR),
    );
    for (x, y) in [(8, 8), (7, 9), (9, 6)] {
        assert_eq!(pixel(&over_image, x, y), pixel(&over_colour, x, y));
    }
    assert_ne!(pixel(&over_image, 0, 0), pixel(&over_colour, 0, 0));
}

#[test]
fn anisotropic_tangents_run_around_the_instance_axis() {
    let scene = Scene {
        materials: vec![Material {
            metallic: 1.0,
            anisotropy: 0.6,
            ..Material::default()
        }],
        geometry: Geometry::new(
            vec![icosphere(Vec3::ZERO, 50.0, 2)],
            vec![Instance::new(
                0,
                Transform::translation(Vec3::new(10.0, 20.0, 30.0)),
                0,
            )],
        )
        .expect("geometry"),
        ..Scene::default()
    };
    let prepared = Prepared::new(&scene);
    let centre = Vec3::new(10.0, 20.0, 30.0);
    // On the side of the sphere (+X of its centre) the tangent runs along ±Y.
    let p = centre + Vec3::new(50.0, 0.0, 0.0);
    let f = prepared.frame(Some(0), p, Vec3::new(1.0, 0.0, 0.0));
    assert!((f.x.y.abs() - 1.0).abs() < 1.0e-5, "{f:?}");
    assert!((f.x.dot(f.z)).abs() < 1.0e-6 && (f.y.dot(f.z)).abs() < 1.0e-6);
    assert!((f.x.cross(f.y) - f.z).length() < 1.0e-5);
    // On the axis (the top) it falls back to the instance's X axis, projected.
    let top = prepared.frame(
        Some(0),
        centre + Vec3::new(0.0, 0.0, 50.0),
        Vec3::new(0.0, 0.0, 1.0),
    );
    assert!(
        (top.x - Vec3::new(1.0, 0.0, 0.0)).length() < 1.0e-5,
        "{top:?}"
    );
    // Isotropic materials keep the plain frame.
    let plain = Scene {
        materials: vec![Material::default()],
        ..scene.clone()
    };
    let n = Vec3::new(0.0, 0.6, 0.8);
    assert_eq!(
        Prepared::new(&plain).frame(Some(0), p, n),
        Frame::from_normal(n)
    );
}
