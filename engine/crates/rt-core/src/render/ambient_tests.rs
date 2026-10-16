//! The ambient effects (S4a) through the renderer: the pinned hash of the parity scene on every
//! SIMD path, that an effect without particles changes no reference hash, that the particles
//! render exactly as brute force does, that widening thin particles to the minimum size on screen
//! keeps the image's energy, the camera / reflection / shadow flags and the ids of the passes.

use super::passes_tests::passes_of;
use super::tests::{
    scene_4spp_hash, PINNED_E5B_CAUSTICS_4SPP, PINNED_E5C_SKY_4SPP, PINNED_E5_HDRI_4SPP,
    PINNED_EXAMPLE_4SPP,
};
use super::*;
use crate::color::Rgb;
use crate::geometry::PixelFootprint;
use crate::image::Film;
use crate::math::Vec3;
use crate::passes::{PASS_ALL, PASS_MATERIAL_ID, PASS_PART_ID};
use crate::scene::{
    AmbientParams, Camera, EnvKind, Environment, Geometry, Material, ParticleSet, RenderSettings,
    MATERIAL_EMISSIVE,
};
use rt_sim::{Shape, FLAG_CAMERA, FLAG_REFLECTIONS, FLAG_SHADOW};

/// Pinned hash of the S4a parity scene ([`crate::example::ambient_scene`]) at 4 samples per pixel
/// (pinned again with the per-point light selection of E12).
pub(crate) const PINNED_AMBIENT_4SPP: u32 = 0xeb60_bea2;

#[test]
fn the_ambient_example_has_a_pinned_hash_on_every_platform() {
    // Dust widened to the minimum size, glass rain and spinning snow over the example; through
    // an RSB round trip (the particles are evaluated again by the reader and are the same bits);
    // `tools/wasm-parity.mjs` checks the real module against it (`rt --write-ambient-example`).
    let scene = crate::example::ambient_scene();
    assert_eq!(Scene::from_rsb(&scene.to_rsb()).as_ref(), Ok(&scene));
    for isa in Isa::available() {
        let hash = scene_4spp_hash(&scene, isa);
        eprintln!("ambient example at 4 spp on {}: {hash:#010x}", isa.name());
        assert_eq!(hash, PINNED_AMBIENT_4SPP, "particles on {}", isa.name());
    }
}

/// Pinned hash of the particles of the S4a parity scene's three effects, one after another
/// ([`rt_sim::positions_hash`]); `tools/wasm-parity.mjs --expect-particles` checks what the real
/// module's `rt_particles_eval` gives against it.
pub(crate) const PINNED_AMBIENT_PARTICLES: u32 = 0xe38b_8480;

#[test]
fn the_particles_of_the_ambient_example_have_a_pinned_hash() {
    let scene = crate::example::ambient_scene();
    let all: Vec<rt_sim::Particle> = scene
        .effects
        .iter()
        .flat_map(|e| rt_sim::evaluate(e, e.count))
        .collect();
    let hash = rt_sim::positions_hash(&all);
    eprintln!("particles of the ambient example: {hash:#010x}");
    assert_eq!(hash, PINNED_AMBIENT_PARTICLES);
    // The scene renders exactly those.
    let rendered: Vec<rt_sim::Particle> = scene
        .geometry
        .particle_sets()
        .iter()
        .flat_map(|s| s.particles())
        .collect();
    assert_eq!(rendered, all);
}

/// An effect with every field set and no particles.
fn empty_effect() -> AmbientParams {
    AmbientParams {
        count: 0,
        size_mm: 2.0,
        region_half: [100.0; 3],
        region_centre: [0.0, 0.0, 100.0],
        ..AmbientParams::default()
    }
}

fn with_empty_effects(mut scene: Scene) -> Scene {
    scene.effects = vec![empty_effect(), empty_effect()];
    scene.build_particles(Vec::new());
    scene
}

#[test]
fn effects_without_particles_change_no_reference_hash() {
    let isa = Isa::detect();
    let example = with_empty_effects(crate::example::scene());
    assert_eq!(scene_4spp_hash(&example, isa), PINNED_EXAMPLE_4SPP);
    let e5 = with_empty_effects(crate::example::e5_scene(false));
    assert_eq!(scene_4spp_hash(&e5, isa), PINNED_E5_HDRI_4SPP);
    let e5c = with_empty_effects(crate::example::e5c_scene());
    assert_eq!(scene_4spp_hash(&e5c, isa), PINNED_E5C_SKY_4SPP);
    let e5b = with_empty_effects(crate::example::e5b_scene());
    assert_eq!(
        super::tests::caustic_4spp_hash(&e5b, isa),
        PINNED_E5B_CAUSTICS_4SPP
    );
    // The passes too.
    let (w, h) = (example.render.width, example.render.height);
    let tiles = tile_grid(w, h, 32);
    let plain = passes_of(&crate::example::scene(), PASS_ALL, 2, &tiles, isa);
    assert_eq!(passes_of(&example, PASS_ALL, 2, &tiles, isa), plain);
    // And through a file.
    assert_eq!(Scene::from_rsb(&example.to_rsb()).as_ref(), Ok(&example));
}

/// The ambient example, small, for the slow references.
fn small_ambient() -> Scene {
    let mut scene = crate::example::ambient_scene();
    scene.render.width = 48;
    scene.render.height = 36;
    for e in &mut scene.effects {
        e.count /= 4;
    }
    scene.build_particles(Vec::new());
    scene
}

#[test]
fn particles_render_exactly_what_brute_force_renders() {
    let scene = small_ambient();
    for sample in 0..2 {
        let tile = TileRect {
            x: 0,
            y: 0,
            w: scene.render.width,
            h: scene.render.height,
        };
        let mut accelerated = Film::new(scene.render.width, scene.render.height);
        render_tile(&scene, tile, sample, &mut accelerated);
        let mut reference = Film::new(scene.render.width, scene.render.height);
        render_tile_brute_force(&scene, tile, sample, &mut reference);
        assert_eq!(accelerated, reference, "sample {sample}");
    }
}

#[test]
fn tiles_in_any_order_give_the_same_particles() {
    let scene = small_ambient();
    let prepared = Prepared::new(&scene);
    let (w, h) = (scene.render.width, scene.render.height);
    let render = |tiles: Vec<TileRect>| {
        let mut film = Film::new(w, h);
        for tile in tiles {
            for sample in 0..2 {
                render_tile_prepared(&scene, &prepared, tile, sample, &mut film, Isa::detect());
            }
        }
        film
    };
    let forward = render(tile_grid(w, h, 16));
    let mut backward = tile_grid(w, h, 7);
    backward.reverse();
    assert_eq!(forward, render(backward));
}

/// Emissive specks in front of a flat white environment (radiance 1), 64 x 48 pixels of 11 mm
/// at the specks: 1 mm across is 0.09 pixels.
fn specks(count: u32) -> Scene {
    let camera = Camera {
        position: Vec3::new(0.0, -1000.0, 300.0),
        target: Vec3::new(0.0, 0.0, 300.0),
        ..Camera::default()
    };
    let mut scene = Scene {
        camera,
        materials: vec![Material {
            kind: MATERIAL_EMISSIVE,
            emission: Rgb::WHITE,
            emission_power: 20.0,
            ..Material::default()
        }],
        environment: Environment {
            kind: EnvKind::Flat,
            floor: 1.0,
            horizon: 1.0,
            zenith: 1.0,
            ..Environment::default()
        },
        render: RenderSettings {
            width: 64,
            height: 48,
            max_depth: 1,
            tonemap: 0,
            ..RenderSettings::default()
        },
        effects: vec![AmbientParams {
            count,
            seed: 21,
            region_centre: [0.0, 0.0, 300.0],
            region_half: [250.0, 150.0, 180.0],
            size_mm: 1.0,
            size_var: 0.3,
            flags: FLAG_CAMERA | FLAG_REFLECTIONS | FLAG_SHADOW,
            ..AmbientParams::default()
        }],
        ..Scene::default()
    };
    scene.build_particles(Vec::new());
    scene
}

/// The mean of every channel of every pixel of `samples` samples.
fn mean(scene: &Scene, samples: u32) -> f32 {
    let (w, h) = (scene.render.width, scene.render.height);
    let prepared = Prepared::new(scene);
    let mut film = Film::new(w, h);
    for sample in 0..samples {
        for tile in tile_grid(w, h, 32) {
            render_tile_prepared(scene, &prepared, tile, sample, &mut film, Isa::detect());
        }
    }
    let pixels = film.resolve();
    pixels.iter().sum::<f32>() / pixels.len() as f32
}

#[test]
fn widening_thin_particles_keeps_the_energy() {
    let widened = specks(2_000);
    let set = &widened.geometry.particle_sets()[0];
    assert!(
        set.widened() && set.coverage(0) < 0.1,
        "{}",
        set.coverage(0)
    );
    // The same specks at their real size: what the image converges to.
    let mut exact = widened.clone();
    let real = ParticleSet::new(
        &exact.effects[0],
        &set.particles(),
        PixelFootprint::NONE,
        crate::geometry::BvhWidth::native(),
    );
    let instances = exact.geometry.instances().to_vec();
    let meshes = std::mem::take(&mut exact.geometry).into_meshes();
    exact.geometry = Geometry::with_particles(
        meshes,
        instances,
        vec![real],
        crate::geometry::BvhWidth::native(),
    )
    .unwrap();
    assert!(!exact.geometry.particle_sets()[0].widened());

    let reference = mean(&exact, 256);
    let background = mean(&specks(0), 1);
    assert!((background - 1.0).abs() < 1.0e-6, "{background}");
    // The specks add a few per cent: enough for a lost share to show.
    assert!(reference > 1.03, "{reference}");
    let few = mean(&widened, 4);
    let many = mean(&widened, 256);
    eprintln!("exact 256 spp {reference}, widened 4 spp {few}, 256 spp {many}");
    assert!(
        (few / many - 1.0).abs() < 0.02,
        "4 spp {few} vs 256 spp {many}"
    );
    assert!(
        (few / reference - 1.0).abs() < 0.02,
        "4 spp {few} vs exact {reference}"
    );
    assert!(
        (many / reference - 1.0).abs() < 0.01,
        "256 spp {many} vs exact {reference}"
    );
}

#[test]
fn the_flags_say_who_sees_the_particles() {
    // A wall of dense, large particles between the camera and the example's spheres.
    let base = crate::example::scene();
    let with = |flags: u32| {
        let mut scene = base.clone();
        scene.render.width = 40;
        scene.render.height = 30;
        scene.effects = vec![AmbientParams {
            count: 4_000,
            seed: 2,
            region_centre: [0.0, 0.0, 200.0],
            region_half: [400.0, 300.0, 200.0],
            size_mm: 12.0,
            material_id: 1,
            flags,
            shape: Shape::Sphere,
            ..AmbientParams::default()
        }];
        scene.build_particles(Vec::new());
        scene
    };
    let render = |scene: &Scene| {
        let mut film = Film::new(scene.render.width, scene.render.height);
        let tile = TileRect {
            x: 0,
            y: 0,
            w: scene.render.width,
            h: scene.render.height,
        };
        render_tile(scene, tile, 0, &mut film);
        film.resolve()
    };
    let mut plain = base.clone();
    plain.render.width = 40;
    plain.render.height = 30;
    let nothing = render(&plain);
    // Seen by nobody: the image of the scene without them.
    assert_eq!(render(&with(0)), nothing);
    // Seen only by camera rays, or only in reflections, or only casting shadows: each changes it.
    for flags in [FLAG_CAMERA, FLAG_REFLECTIONS, FLAG_SHADOW] {
        assert_ne!(render(&with(flags)), nothing, "flags {flags}");
    }
    // The camera sees them first: the ids of the passes are the effect's.
    let scene = with(FLAG_CAMERA);
    let (w, h) = (scene.render.width, scene.render.height);
    let passes = passes_of(
        &scene,
        PASS_PART_ID | PASS_MATERIAL_ID,
        1,
        &[TileRect { x: 0, y: 0, w, h }],
        Isa::detect(),
    );
    let effect_part = scene.geometry.instances().len() as u32 + 1;
    let particle_pixels = passes.part_id.iter().filter(|&&p| p == effect_part).count();
    assert!(particle_pixels > 10, "{particle_pixels}");
    for (part, material) in passes.part_id.iter().zip(&passes.material_id) {
        if *part == effect_part {
            assert_eq!(*material, 2);
        }
    }
    // Picking never finds a particle.
    let ray = crate::render::centre_ray(&scene, w / 2, h / 2);
    assert!(scene
        .pick(&ray)
        .is_none_or(|hit| (hit.instance as usize) < scene.geometry.instances().len()));
}

#[test]
fn an_update_with_the_same_effects_keeps_the_particles() {
    let mut scene = small_ambient();
    let before = scene.geometry.particle_sets().to_vec();
    // Only the camera moves: the particles stay, their BVH is built for the new camera.
    let mut moved = scene.clone();
    moved.camera.position *= 1.1;
    let bytes = moved.to_rsb();
    scene.update_from_rsb(&bytes).unwrap();
    assert_eq!(scene, Scene::from_rsb(&bytes).unwrap());
    for (a, b) in before.iter().zip(scene.geometry.particle_sets()) {
        assert_eq!(a.particles(), b.particles());
        assert_ne!(a.footprint(), b.footprint());
    }
    // Another seed is another effect.
    let mut reseeded = scene.clone();
    reseeded.effects[0].seed += 1;
    scene.update_from_rsb(&reseeded.to_rsb()).unwrap();
    assert_ne!(
        scene.geometry.particle_sets()[0].particles(),
        before[0].particles()
    );
}

#[test]
fn the_engine_and_the_simulator_share_their_maths() {
    // rt-sim compiles the engine's own fmath and rng sources: the same bits.
    for i in 0..1000 {
        let x = i as f32 * 0.037 - 18.0;
        assert_eq!(
            crate::fmath::exp(x).to_bits(),
            rt_sim::fmath::exp(x).to_bits()
        );
        assert_eq!(crate::fmath::sin_cos(x), rt_sim::fmath::sin_cos(x));
        let k = (i as u64).wrapping_mul(0x9E37_79B9_7F4A_7C15);
        assert_eq!(crate::rng::mix64(k), rt_sim::rng::mix64(k));
    }
}
