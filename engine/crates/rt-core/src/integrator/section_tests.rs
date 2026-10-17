//! The section view (Q1) in the path tracer: the cap has the colour of the cut material, a cut
//! solid renders as the solid that was never longer, and the removed part is gone for the
//! shadows and the reflections too.

use super::*;
use crate::color::Rgb;
use crate::example::icosphere;
use crate::geometry::edges::faceted_box;
use crate::image::Film;
use crate::render::{render_tile_prepared, TileRect};
use crate::scene::{
    Camera, EnvKind, Environment, Floor, Geometry, Instance, Light, LightKind, Material, Mesh,
    RenderSettings, SectionPlane, Transform, BACKGROUND_ENVIRONMENT, LIGHT_FLAG_GLOSSY,
    MATERIAL_FLAG_THIN, MATERIAL_GLASS,
};

const UP: Vec3 = Vec3::new(0.0, 0.0, 1.0);

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

fn plane(normal: Vec3, distance: f32) -> SectionPlane {
    SectionPlane::new(normal, distance, true).expect("a plane")
}

fn settings(width: u32, height: u32) -> RenderSettings {
    RenderSettings {
        width,
        height,
        tonemap: 0,
        max_depth: 6,
        ..RenderSettings::default()
    }
}

fn pixel(film: &Film, x: u32, y: u32) -> Rgb {
    let p = film.resolve();
    let i = ((y * film.width + x) * 3) as usize;
    Rgb::new(p[i], p[i + 1], p[i + 2])
}

/// A uniform world of radiance 1.
fn furnace() -> Environment {
    Environment {
        kind: EnvKind::Flat,
        horizon: 1.0,
        strength: 1.0,
        background_mode: BACKGROUND_ENVIRONMENT,
        ..Environment::default()
    }
}

/// A Lambertian material (no specular lobe) of this colour.
fn matte(color: Rgb) -> Material {
    Material {
        base_color: color,
        ior: 1.0,
        ..Material::default()
    }
}

fn front_camera(width: f32) -> Camera {
    Camera {
        position: Vec3::new(0.0, -1000.0, 0.0),
        target: Vec3::ZERO,
        up: UP,
        ortho: true,
        ortho_width: width,
        ..Camera::default()
    }
}

fn top_camera(width: f32) -> Camera {
    Camera {
        position: Vec3::new(0.0, 0.0, 1000.0),
        target: Vec3::ZERO,
        up: Vec3::new(0.0, 1.0, 0.0),
        ortho: true,
        ortho_width: width,
        ..Camera::default()
    }
}

#[test]
fn the_cap_has_the_colour_of_the_cut_material_and_the_removed_half_is_gone() {
    // In a uniform world of radiance 1 a convex Lambertian body shows its albedo everywhere.
    let colour = Rgb::new(0.8, 0.3, 0.1);
    let cube = faceted_box(Vec3::splat(-50.0), Vec3::splat(50.0), true);
    let mut scene = Scene {
        camera: top_camera(200.0),
        materials: vec![matte(colour)],
        geometry: Geometry::from_meshes(vec![cube]),
        environment: furnace(),
        render: settings(16, 16),
        section: Some(plane(UP, 0.0)),
        ..Scene::default()
    };
    scene.apply_section();
    // From above: the cap, over the cube's footprint, and the world around it.
    let film = render(&scene, 256);
    let cap = pixel(&film, 8, 8);
    for (got, want) in [(cap.r, colour.r), (cap.g, colour.g), (cap.b, colour.b)] {
        assert!((got - want).abs() < 0.02, "cap {cap:?} against {colour:?}");
    }
    let world = pixel(&film, 0, 0);
    assert!((world.g - 1.0).abs() < 0.02, "{world:?}");
    // From the front: the lower half is the cube and the upper half is the world behind it.
    scene.camera = front_camera(200.0);
    let film = render(&scene, 256);
    let (upper, lower) = (pixel(&film, 8, 5), pixel(&film, 8, 11));
    assert!((upper.g - 1.0).abs() < 0.02, "upper half {upper:?}");
    assert!((lower.g - colour.g).abs() < 0.02, "lower half {lower:?}");
    // Without the section the cube is whole.
    scene.section = None;
    scene.apply_section();
    let whole = pixel(&render(&scene, 64), 8, 5);
    assert!((whole.g - colour.g).abs() < 0.02, "{whole:?}");
}

/// A studio: the box, a chrome sphere beside it, a floor, two lights and a dome; seen from above
/// and the side.
fn studio(top: f32, material: Material, section: Option<SectionPlane>) -> Scene {
    let cube = faceted_box(
        Vec3::new(-50.0, -40.0, -50.0),
        Vec3::new(50.0, 40.0, top),
        true,
    );
    let chrome = Material {
        metallic: 1.0,
        roughness: 0.05,
        base_color: Rgb::splat(0.9),
        ..Material::default()
    };
    let floor = Material {
        base_color: Rgb::splat(0.6),
        ior: 1.0,
        ..Material::default()
    };
    let floor_quad = Mesh::new(
        &[
            Vec3::new(-2000.0, -2000.0, -50.0),
            Vec3::new(2000.0, -2000.0, -50.0),
            Vec3::new(2000.0, 2000.0, -50.0),
            Vec3::new(-2000.0, 2000.0, -50.0),
        ],
        &[],
        &[0, 1, 2, 0, 2, 3],
        0,
    )
    .expect("floor");
    // Wholly below the cut (and on the floor), so that it is the same in both scenes.
    let sphere = icosphere(Vec3::ZERO, 45.0, 3);
    let instances = vec![
        Instance::new(0, Transform::IDENTITY, 0),
        Instance::new(1, Transform::translation(Vec3::new(0.0, 0.0, -50.0)), 2),
        Instance::new(2, Transform::translation(Vec3::new(170.0, -30.0, -55.0)), 1),
    ];
    let mut scene = Scene {
        camera: Camera {
            position: Vec3::new(260.0, -520.0, 330.0),
            target: Vec3::new(40.0, 0.0, -10.0),
            up: UP,
            focal_mm: 50.0,
            ..Camera::default()
        },
        materials: vec![material, chrome, floor],
        geometry: Geometry::new(vec![cube, floor_quad, sphere], instances).expect("geometry"),
        lights: vec![
            Light {
                kind: LightKind::Rect,
                position: Vec3::new(-300.0, -200.0, 500.0),
                direction: Vec3::new(0.5, 0.3, -0.8).normalize(),
                size_x: 300.0,
                size_y: 300.0,
                power: 40.0,
                flags: LIGHT_FLAG_GLOSSY,
                ..Light::default()
            },
            Light {
                kind: LightKind::Sun,
                direction: Vec3::new(-0.4, 0.3, -0.85).normalize(),
                power: 3.0,
                angle_deg: 1.0,
                ..Light::default()
            },
        ],
        environment: Environment {
            kind: EnvKind::Studio,
            floor: 0.05,
            horizon: 0.3,
            zenith: 0.6,
            strength: 1.0,
            ..Environment::default()
        },
        floor: Floor::default(),
        render: settings(48, 36),
        section,
        ..Scene::default()
    };
    scene.apply_section();
    scene
}

/// Mean and largest absolute difference between two images.
fn differ(a: &Film, b: &Film) -> (f32, f32) {
    let (a, b) = (a.resolve(), b.resolve());
    let diffs: Vec<f32> = a.iter().zip(&b).map(|(x, y)| (x - y).abs()).collect();
    (
        diffs.iter().sum::<f32>() / diffs.len() as f32,
        diffs.iter().cloned().fold(0.0, f32::max),
    )
}

#[test]
fn a_cut_solid_renders_as_the_solid_that_was_never_taller() {
    // The tall box cut at z = 0, and the box that ends at z = 0: the same picture, floor shadows,
    // the chrome sphere's reflection and the light the cap gets included. Everything the cut
    // removes is gone from the shadows and from the reflections as from the picture.
    let paint = Material {
        base_color: Rgb::new(0.7, 0.25, 0.12),
        roughness: 0.4,
        ..Material::default()
    };
    let cut = studio(50.0, paint.clone(), Some(plane(UP, 0.0)));
    let short = studio(0.0, paint, None);
    let (a, b) = (render(&cut, 24), render(&short, 24));
    let (mean, worst) = differ(&a, &b);
    // (Only the rounding of the hit point: on the plane against interpolated on a triangle.)
    assert!(mean < 1.0e-6, "mean difference {mean}");
    assert!(worst < 1.0e-4, "largest difference {worst}");
    // And it differs from the uncut tall box, which proves the comparison could fail.
    let mut whole = cut.clone();
    whole.section = None;
    whole.apply_section();
    let (mean_whole, _) = differ(&render(&whole, 24), &b);
    assert!(mean_whole > 1.0e-3, "the uncut box differs: {mean_whole}");
}

#[test]
fn a_cut_glass_solid_refracts_through_its_cap_like_a_glass_solid_that_ends_there() {
    let glass = Material {
        kind: MATERIAL_GLASS,
        base_color: Rgb::new(0.8, 0.95, 0.9),
        roughness: 0.0,
        transmission: 1.0,
        ior: 1.5,
        absorption_mm: 120.0,
        ..Material::default()
    };
    let cut = studio(50.0, glass.clone(), Some(plane(UP, 0.0)));
    let short = studio(0.0, glass, None);
    let (a, b) = (render(&cut, 32), render(&short, 32));
    let (mean, worst) = differ(&a, &b);
    assert!(mean < 1.0e-6, "mean difference {mean}");
    assert!(worst < 1.0e-4, "largest difference {worst}");
    let mut whole = cut.clone();
    whole.section = None;
    whole.apply_section();
    let (mean_whole, _) = differ(&render(&whole, 32), &b);
    assert!(mean_whole > 1.0e-3, "the uncut glass differs: {mean_whole}");
}

#[test]
fn a_thin_wall_and_an_open_mesh_show_their_inside_instead_of_a_cap() {
    // The same box with a thin-walled material: nothing is capped, the cut shows the far wall.
    let colour = Rgb::new(0.2, 0.7, 0.3);
    let thin = Material {
        flags: MATERIAL_FLAG_THIN,
        ..matte(colour)
    };
    let scene = studio(50.0, thin, Some(plane(UP, 0.0)));
    assert!(!scene.geometry.capped_instances().contains(&0));
    let normal = studio(50.0, matte(colour), Some(plane(UP, 0.0)));
    assert!(normal.geometry.capped_instances().contains(&0));
    // An open mesh: the same box without its lid, from above. Capped, the cut is the colour of the
    // material; open, it is the inside of a cup, the floor of which sees the walls (darker).
    let full = faceted_box(Vec3::splat(-50.0), Vec3::splat(50.0), true);
    let positions: Vec<Vec3> = (0..full.vertex_count())
        .filter_map(|i| full.position(i))
        .collect();
    let normals: Vec<Vec3> = (0..full.vertex_count())
        .filter_map(|i| full.normal(i))
        .collect();
    let mut indices = full.indices().to_vec();
    indices.drain(6..12); // the top face
    let lidless = Mesh::new(&positions, &normals, &indices, 0).expect("box");
    let top_view = |mesh: Mesh| {
        let mut scene = Scene {
            camera: top_camera(200.0),
            materials: vec![matte(colour)],
            geometry: Geometry::from_meshes(vec![mesh]),
            environment: furnace(),
            render: settings(16, 16),
            section: Some(plane(UP, 0.0)),
            ..Scene::default()
        };
        scene.apply_section();
        pixel(&render(&scene, 256), 8, 8).g
    };
    let (closed, open) = (top_view(full), top_view(lidless));
    assert!((closed - colour.g).abs() < 0.02, "capped {closed}");
    assert!(open < colour.g - 0.1, "the inside of a cup {open}");
}

#[test]
fn rays_see_the_cut_model_in_every_class_and_the_pass_planes_see_the_cap() {
    // The cap is what the passes of the first hit see: the instance, the depth, the normal up.
    let mut scene = studio(50.0, matte(Rgb::splat(0.5)), Some(plane(UP, 0.0)));
    scene.camera = top_camera(400.0);
    let prepared = Prepared::new(&scene);
    let tracer = BvhTracer {
        geometry: &scene.geometry,
        isa: Isa::detect(),
    };
    let ray = Ray::new(Vec3::new(0.0, 0.0, 1000.0), Vec3::new(0.0, 0.0, -1.0));
    match first_hit(&scene, &prepared, &tracer, &ray) {
        FirstHit::Surface {
            instance,
            t,
            normal,
            albedo,
        } => {
            assert_eq!(instance, 0);
            assert!((t - 1000.0).abs() < 1.0e-3);
            assert_eq!(normal, UP);
            assert_eq!(albedo, Rgb::splat(0.5));
        }
        other => panic!("{other:?}"),
    }
    // A ray level with the removed half: the sphere's neighbour, not the box.
    let level = Ray::new(Vec3::new(-300.0, 0.0, 30.0), Vec3::new(1.0, 0.0, 0.0));
    for class in [
        RayClass::Camera,
        RayClass::Secondary,
        RayClass::Shadow,
        RayClass::Rough,
        RayClass::Parts,
    ] {
        let hit = scene.geometry.trace_class(&level, Isa::detect(), class);
        assert!(hit.is_none_or(|h| h.instance != 0), "{class:?} {hit:?}");
    }
}
