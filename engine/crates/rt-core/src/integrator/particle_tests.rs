//! The particles of S4b through the integrator: the forward lobe of dust is unbiased under either
//! technique of next-event estimation's MIS and conserves energy in the white furnace, and lights
//! a mote from behind; drops make no caustics (rays after a rough vertex do not see them unless
//! they cast shadows, and then cross them straight as shadow rays do, with the same transmittance)
//! while camera rays still see them refract; and smooth drops leaving their lights to their BSDF
//! rays changes no expected value.

use super::*;
use crate::geometry::{BvhWidth, Instance, ParticleSet, PixelFootprint};
use crate::image::Film;
use crate::light::Techniques;
use crate::render::{render_tile_prepared, TileRect};
use crate::scene::{
    AmbientParams, Camera, EnvKind, Environment, Light, LightKind, Mesh, RenderSettings,
    BACKGROUND_COLOR, BACKGROUND_ENVIRONMENT, LIGHT_FLAG_GLOSSY, MATERIAL_EMISSIVE,
};
use rt_sim::{Particle, Shape, FLAG_CAMERA, FLAG_REFLECTIONS, FLAG_SHADOW};

/// A white (or `albedo`) Lambertian material: index 1 is a mirror-free dielectric.
fn lambert(albedo: f32) -> Material {
    Material {
        base_color: Rgb::splat(albedo),
        ior: 1.0,
        ..Material::default()
    }
}

/// Smooth clear water.
fn water() -> Material {
    Material {
        kind: crate::scene::MATERIAL_GLASS,
        base_color: Rgb::WHITE,
        roughness: 0.0,
        ior: 1.33,
        transmission: 1.0,
        ..Material::default()
    }
}

fn world(value: f32) -> Environment {
    Environment {
        kind: EnvKind::Flat,
        horizon: value,
        strength: 1.0,
        background_mode: BACKGROUND_ENVIRONMENT,
        ..Environment::default()
    }
}

fn black() -> Environment {
    Environment {
        strength: 0.0,
        background_color: Rgb::BLACK,
        background_mode: BACKGROUND_COLOR,
        ..Environment::default()
    }
}

/// Orthographic, along +Y at the origin, `width` wide.
fn front(width: f32) -> Camera {
    Camera {
        position: Vec3::new(0.0, -1000.0, 0.0),
        target: Vec3::ZERO,
        up: Vec3::new(0.0, 0.0, 1.0),
        ortho: true,
        ortho_width: width,
        ..Camera::default()
    }
}

/// Orthographic, straight down at the origin from 2 m, `width` wide.
fn down(width: f32) -> Camera {
    Camera {
        position: Vec3::new(0.0, 0.0, 2000.0),
        target: Vec3::ZERO,
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

/// A square of `half` around `centre` facing +Z (or, `facing_y`, facing -Y), of material
/// `material`.
fn quad(centre: Vec3, half: f32, material: u32, facing_y: bool) -> Mesh {
    let corner = |a: f32, b: f32| {
        if facing_y {
            centre + Vec3::new(a * half, 0.0, b * half)
        } else {
            centre + Vec3::new(a * half, b * half, 0.0)
        }
    };
    Mesh::new(
        &[
            corner(-1.0, -1.0),
            corner(1.0, -1.0),
            corner(1.0, 1.0),
            corner(-1.0, 1.0),
        ],
        &[],
        &[0, 1, 2, 0, 2, 3],
        material,
    )
    .expect("quad")
}

/// One particle (a sphere of `radius` at `centre`) of an effect with `params`.
fn one(centre: Vec3, radius: f32) -> Particle {
    Particle {
        centre: [centre.x, centre.y, centre.z],
        radius,
        axis: [0.0; 3],
        tint: 0,
        id: 0,
    }
}

/// The scene `base` with `meshes` (one identity instance each, of its own material) and one
/// particle set of `particles` and `params` (its material `params.material_id`).
fn with_particles(
    mut base: Scene,
    meshes: Vec<Mesh>,
    params: AmbientParams,
    particles: &[Particle],
) -> Scene {
    let width = BvhWidth::native();
    let footprint = PixelFootprint::of(&base.camera, base.render.width, base.render.height);
    let set = ParticleSet::new(&params, particles, footprint, width)
        .with_material(base.materials.get(params.material_id as usize));
    let instances: Vec<Instance> = Geometry::implicit_instances(&meshes);
    base.effects = vec![params];
    base.geometry = Geometry::with_particles(meshes, instances, vec![set], width).unwrap();
    base
}

fn effect(material_id: u32, flags: u32) -> AmbientParams {
    AmbientParams {
        count: 1,
        shape: Shape::Sphere,
        material_id,
        flags,
        ..AmbientParams::default()
    }
}

/// The mean of the green channel over `tile` after `spp` samples, with the prepared scene
/// tweaked by `tweak` first.
fn mean(scene: &Scene, tile: TileRect, spp: u32, tweak: impl Fn(&mut Prepared)) -> f64 {
    let mut prepared = Prepared::new(scene);
    tweak(&mut prepared);
    let mut film = Film::region(tile.x, tile.y, tile.w, tile.h);
    for s in 0..spp {
        render_tile_prepared(scene, &prepared, tile, s, &mut film, Isa::detect());
    }
    let pixels = film.resolve();
    pixels
        .iter()
        .skip(1)
        .step_by(3)
        .map(|&v| v as f64)
        .sum::<f64>()
        / film.weight.len() as f64
}

fn tile(x: u32, y: u32, w: u32, h: u32) -> TileRect {
    TileRect { x, y, w, h }
}

/// A mote of dust 120 mm across at the origin, white, with a forward lobe of `share`, seen from
/// the front; a glossy sphere light behind it and to the side (or none), in a dim world.
fn backlit_mote(share: f32, light: bool) -> Scene {
    let base = Scene {
        camera: front(160.0),
        materials: vec![lambert(1.0)],
        environment: world(0.05),
        lights: if light {
            vec![Light {
                kind: LightKind::Point,
                position: Vec3::new(150.0, 700.0, 100.0),
                size_x: 120.0,
                size_y: 120.0,
                power: 40.0,
                flags: LIGHT_FLAG_GLOSSY,
                ..Light::default()
            }]
        } else {
            Vec::new()
        },
        render: settings(16, 16),
        ..Scene::default()
    };
    // It casts shadows too (the presets' dust does not; a person may switch it on): the shadow
    // rays and the rays of the lobe that go through it leave from its far side.
    let params = AmbientParams {
        forward: share,
        forward_g: 0.7,
        ..effect(0, FLAG_CAMERA | FLAG_REFLECTIONS | FLAG_SHADOW)
    };
    with_particles(base, Vec::new(), params, &[one(Vec3::ZERO, 60.0)])
}

#[test]
fn the_forward_lobe_is_unbiased_with_either_technique_and_with_both() {
    // The middle of the mote (well inside its silhouette), lit through its forward lobe by a light
    // behind it: next-event estimation alone, BSDF sampling alone and both by MIS converge to the
    // same image (4096 samples per pixel over 8 x 8 pixels, to 1 %), which needs the lobe in the
    // density MIS weighs against and in the evaluation of light samples alike.
    let crop = tile(4, 4, 8, 8);
    let scene = backlit_mote(0.5, true);
    let by = |techniques| mean(&scene, crop, 4096, |p| p.lights.techniques = techniques);
    let both = by(Techniques::Mis);
    let lights_only = by(Techniques::LightsOnly);
    let bsdf_only = by(Techniques::BsdfOnly);
    eprintln!("backlit mote: MIS {both}, lights only {lights_only}, BSDF only {bsdf_only}");
    assert!(both > 0.1, "lit: {both}");
    assert!(
        (lights_only / both - 1.0).abs() < 0.01,
        "{lights_only} vs {both}"
    );
    assert!(
        (bsdf_only / both - 1.0).abs() < 0.01,
        "{bsdf_only} vs {both}"
    );
}

#[test]
fn a_white_mote_with_a_forward_lobe_vanishes_in_the_white_furnace() {
    // A white mote whose lobe is white too, in a uniform world of radiance 1: it scatters what it
    // receives, so it is invisible (every pixel 1, to 1 %), with any share.
    for share in [0.5, 1.0] {
        let mut scene = backlit_mote(share, false);
        scene.environment = world(1.0);
        let m = mean(&scene, tile(4, 4, 8, 8), 1024, |_| {});
        eprintln!("furnace, share {share}: {m}");
        assert!((m - 1.0).abs() < 0.01, "share {share}: {m}");
    }
}

#[test]
fn a_light_behind_a_mote_lights_it_through_its_forward_lobe() {
    // Seen from the front, an opaque white sphere lit from behind shows its dark side; with the
    // lobe of the dust presets it glows (the criterion of the sheet's backlit dust).
    let crop = tile(4, 4, 8, 8);
    let without = mean(&backlit_mote(0.0, true), crop, 256, |_| {});
    let with = mean(&backlit_mote(0.5, true), crop, 256, |_| {});
    eprintln!("backlit mote: without the lobe {without}, with it {with}");
    assert!(with > 3.0 * without, "{with} vs {without}");
}

/// A white floor lit from above by a glossy light (a sphere 80 mm across, or a 1 m panel), a drop
/// of water 80 mm across (or, `big`, 240 mm) between them, seen straight down by a camera that
/// does not see the drop (`flags`).
fn drop_over_floor(flags: u32, drop: bool, panel: bool, big: bool) -> Scene {
    let light = if panel {
        Light {
            kind: LightKind::Rect,
            position: Vec3::new(0.0, 0.0, 600.0),
            direction: Vec3::new(0.0, 0.0, -1.0),
            up: Vec3::new(0.0, 1.0, 0.0),
            size_x: 1000.0,
            size_y: 1000.0,
            power: 20.0,
            flags: LIGHT_FLAG_GLOSSY,
            ..Light::default()
        }
    } else {
        Light {
            kind: LightKind::Point,
            position: Vec3::new(0.0, 0.0, 600.0),
            size_x: 80.0,
            size_y: 80.0,
            power: 20.0,
            flags: LIGHT_FLAG_GLOSSY,
            ..Light::default()
        }
    };
    let base = Scene {
        camera: down(200.0),
        materials: vec![lambert(0.8), water()],
        environment: black(),
        lights: vec![light],
        render: settings(16, 16),
        ..Scene::default()
    };
    let floor = quad(Vec3::ZERO, 2000.0, 0, false);
    let radius = if big { 120.0 } else { 40.0 };
    let particles = if drop {
        vec![one(Vec3::new(0.0, 0.0, 200.0), radius)]
    } else {
        Vec::new()
    };
    with_particles(base, vec![floor], effect(1, flags), &particles)
}

#[test]
fn rough_paths_do_not_see_a_drop_that_casts_no_shadow() {
    // Rain casts no shadow: the floor's rays (rough: Lambertian) used to refract through the drop
    // and find the light, a caustic of speckles; now nothing but the camera and the rays of
    // sharp paths sees it, and the floor is the floor without it, bit for bit.
    let scene = drop_over_floor(FLAG_REFLECTIONS, true, false, false);
    assert!(scene.geometry.particle_sets()[0].is_clear());
    let empty = drop_over_floor(FLAG_REFLECTIONS, false, false, false);
    let all = tile(0, 0, 16, 16);
    let render = |s: &Scene| {
        let mut film = Film::region(0, 0, 16, 16);
        for sample in 0..64 {
            crate::render::render_tile(s, all, sample, &mut film);
        }
        film.resolve()
    };
    assert_eq!(render(&scene), render(&empty));
}

#[test]
fn shadow_rays_cross_a_drop_straight_with_its_transmittance() {
    // Under the drop, all of the small light arrives through it straight, without refraction,
    // keeping the thin wall's straight transmittance of water at normal incidence (both faces,
    // once): `(1 - R) / (1 + R)` with `R` = ((1.33 - 1) / 2.33)², 0.9607 (to 1 %).
    let crop = tile(6, 6, 4, 4);
    let lit = mean(
        &drop_over_floor(FLAG_REFLECTIONS, false, false, false),
        crop,
        1024,
        |_| {},
    );
    let scene = drop_over_floor(FLAG_REFLECTIONS | FLAG_SHADOW, true, false, false);
    let through = mean(&scene, crop, 1024, |_| {});
    let r = ((1.33f64 - 1.0) / 2.33).powi(2);
    let expected = (1.0 - r) / (1.0 + r);
    eprintln!(
        "under the drop {through}, without it {lit}: {} (expected {expected})",
        through / lit
    );
    assert!(
        (through / lit / expected - 1.0).abs() < 0.01,
        "{}",
        through / lit
    );
}

#[test]
fn rough_paths_cross_a_drop_that_casts_shadows_as_shadow_rays_do() {
    // Under a big drop and a panel: next-event estimation alone and BSDF sampling alone agree
    // with MIS (to 1 %), so the floor's rays cross the drop as its shadow rays do; and less light
    // arrives than without the drop (no caustic focuses it).
    let crop = tile(4, 4, 8, 8);
    let scene = drop_over_floor(FLAG_REFLECTIONS | FLAG_SHADOW, true, true, true);
    let by = |techniques| mean(&scene, crop, 4096, |p| p.lights.techniques = techniques);
    let both = by(Techniques::Mis);
    let lights_only = by(Techniques::LightsOnly);
    let bsdf_only = by(Techniques::BsdfOnly);
    let open = mean(
        &drop_over_floor(FLAG_REFLECTIONS, false, true, true),
        crop,
        1024,
        |_| {},
    );
    eprintln!(
        "under the drop: MIS {both}, lights only {lights_only}, BSDF only {bsdf_only}; open {open}"
    );
    assert!(both < open && both > 0.8 * open, "{both} vs {open}");
    assert!(
        (lights_only / both - 1.0).abs() < 0.01,
        "{lights_only} vs {both}"
    );
    assert!(
        (bsdf_only / both - 1.0).abs() < 0.01,
        "{bsdf_only} vs {both}"
    );
}

#[test]
fn camera_rays_still_see_a_drop_refract() {
    // A drop of water 100 mm across in front of a wall that glows on its left half only: a ball
    // lens (focus about 100 mm behind its centre), so the camera sees the wall upside down
    // through it, the dark half on the drop's left and the bright half on its right.
    let base = Scene {
        camera: front(200.0),
        materials: vec![
            Material {
                kind: MATERIAL_EMISSIVE,
                emission: Rgb::WHITE,
                emission_power: 1.0,
                ..Material::default()
            },
            lambert(0.0),
            water(),
        ],
        environment: black(),
        render: settings(40, 40),
        ..Scene::default()
    };
    let bright = quad(Vec3::new(-1000.0, 1000.0, 0.0), 1000.0, 0, true);
    let dark = quad(Vec3::new(1000.0, 1000.0, 0.0), 1000.0, 1, true);
    let scene = with_particles(
        base,
        vec![bright, dark],
        effect(2, FLAG_CAMERA | FLAG_REFLECTIONS),
        &[one(Vec3::ZERO, 50.0)],
    );
    // 5 mm pixels: the drop spans columns 10..30; its left part 13..18, its right part 22..27.
    let left = mean(&scene, tile(13, 17, 5, 6), 64, |_| {});
    let right = mean(&scene, tile(22, 17, 5, 6), 64, |_| {});
    let outside = mean(&scene, tile(1, 17, 5, 6), 16, |_| {});
    eprintln!("through the drop: left {left}, right {right}; the wall on the left {outside}");
    assert!(outside > 0.99, "{outside}");
    assert!(
        right > 0.5 && left < 0.2 * right,
        "left {left}, right {right}"
    );
}

/// A drop of water 100 mm across seen from the front, a glossy sphere light behind it and to the
/// side, a dim world.
fn drop_in_front_of_a_light() -> Scene {
    let base = Scene {
        camera: front(160.0),
        materials: vec![water()],
        environment: world(0.05),
        lights: vec![Light {
            kind: LightKind::Point,
            position: Vec3::new(120.0, 500.0, 60.0),
            size_x: 200.0,
            size_y: 200.0,
            power: 30.0,
            flags: LIGHT_FLAG_GLOSSY,
            ..Light::default()
        }],
        render: settings(16, 16),
        ..Scene::default()
    };
    with_particles(
        base,
        Vec::new(),
        effect(0, FLAG_CAMERA | FLAG_REFLECTIONS | FLAG_SHADOW),
        &[one(Vec3::ZERO, 50.0)],
    )
}

#[test]
fn smooth_drops_leave_their_lights_to_their_bsdf_rays_without_bias() {
    // On a smooth clear particle next-event estimation can only find delta lights: the others are
    // left to the BSDF ray, which then counts them whole. The image is what MIS with next-event
    // estimation at the drop gives (4096 samples over 8 x 8 pixels, to 1 %).
    let scene = drop_in_front_of_a_light();
    let crop = tile(4, 4, 8, 8);
    let mirror = mean(&scene, crop, 4096, |_| {});
    let reference = mean(&scene, crop, 4096, |p| p.mirror_particles = false);
    eprintln!("drop: mirror rule {mirror}, next-event estimation on it {reference}");
    assert!(mirror > 0.05, "{mirror}");
    assert!(
        (mirror / reference - 1.0).abs() < 0.01,
        "{mirror} vs {reference}"
    );
}
