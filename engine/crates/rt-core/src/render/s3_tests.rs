//! S3 through the renderer: the drops and the mixes of shapes of the ambient effects, and the front
//! glass. The pinned hashes of the two parity scenes on every SIMD path; the particles and their
//! shapes; drops and mixes render exactly as brute force does; a front glass with nothing on it
//! changes no pixel of the example and none of its passes (the criterion: bit for bit); a drop on
//! the glass turns what it shows upside down.

use super::passes_tests::passes_of;
use super::tests::{scene_4spp_hash, PINNED_EXAMPLE_4SPP};
use super::*;
use crate::color::Rgb;
use crate::image::Film;
use crate::math::Vec3;
use crate::optics::glass::{GlassDrop, GlassParams};
use crate::passes::PASS_ALL;
use crate::scene::{Camera, EnvKind, Environment, Material, RenderSettings, MATERIAL_EMISSIVE};

/// Pinned hash of the S3 drops scene ([`crate::example::s3_drops_scene`]) at 4 samples per pixel.
pub(crate) const PINNED_S3_DROPS_4SPP: u32 = 0x73eb_de26;
/// Pinned hash of the particles of its two effects, one after the other
/// ([`rt_sim::positions_hash`]); `tools/wasm-parity.mjs --expect-particles` checks the module.
pub(crate) const PINNED_S3_DROPS_PARTICLES: u32 = 0x401e_61d5;
/// Pinned hash of their shapes ([`rt_sim::shapes_hash`]); `--expect-shapes` checks the module's
/// `rt_particles_shapes`.
pub(crate) const PINNED_S3_DROPS_SHAPES: u32 = 0xec38_0974;
/// Pinned hash of the S3 front glass scene ([`crate::example::s3_glass_scene`]) at 4 samples per
/// pixel.
pub(crate) const PINNED_S3_GLASS_4SPP: u32 = 0xf410_d5f0;

#[test]
fn the_s3_scenes_have_pinned_hashes_on_every_platform() {
    // Through an RSB round trip (the S3 fields of FXAM, the GLAS section: the reader evaluates the
    // particles and lays the glass out again, the same bits); `tools/wasm-parity.mjs` checks the
    // real module against them (`rt --write-s3-drops-example`, `rt --write-s3-glass-example`).
    let mut found = Vec::new();
    for (name, scene, pinned) in [
        (
            "drops",
            crate::example::s3_drops_scene(),
            PINNED_S3_DROPS_4SPP,
        ),
        (
            "glass",
            crate::example::s3_glass_scene(),
            PINNED_S3_GLASS_4SPP,
        ),
    ] {
        assert_eq!(
            Scene::from_rsb(&scene.to_rsb()).as_ref(),
            Ok(&scene),
            "{name}"
        );
        for isa in Isa::available() {
            let hash = scene_4spp_hash(&scene, isa);
            eprintln!("S3 {name} at 4 spp on {}: {hash:#010x}", isa.name());
            found.push((name, isa.name(), hash, pinned));
        }
    }
    for (name, isa, hash, pinned) in found {
        assert_eq!(hash, pinned, "{name} on {isa}");
    }
}

#[test]
fn the_particles_of_the_drops_scene_and_their_shapes_have_pinned_hashes() {
    let scene = crate::example::s3_drops_scene();
    let all: Vec<rt_sim::Particle> = scene
        .effects
        .iter()
        .flat_map(|e| rt_sim::evaluate(e, e.count))
        .collect();
    let (hash, shapes) = (rt_sim::positions_hash(&all), rt_sim::shapes_hash(&all));
    eprintln!("particles of the S3 drops scene: {hash:#010x}, shapes {shapes:#010x}");
    // Every shape is there: the drops of the rain and the four of the mix.
    for shape in rt_sim::MIX_SHAPES {
        assert!(all.iter().any(|p| p.shape == shape), "{shape:?}");
    }
    let rendered: Vec<rt_sim::Particle> = scene
        .geometry
        .particle_sets()
        .iter()
        .flat_map(|s| s.particles())
        .collect();
    assert_eq!(rendered, all);
    assert_eq!(hash, PINNED_S3_DROPS_PARTICLES);
    assert_eq!(shapes, PINNED_S3_DROPS_SHAPES);
}

/// The drops scene, small, for the slow references.
fn small_drops() -> Scene {
    let mut scene = crate::example::s3_drops_scene();
    scene.render.width = 48;
    scene.render.height = 36;
    for e in &mut scene.effects {
        e.count /= 3;
    }
    scene.build_particles(Vec::new());
    scene
}

#[test]
fn drops_and_mixes_render_exactly_what_brute_force_renders() {
    let scene = small_drops();
    let tile = TileRect {
        x: 0,
        y: 0,
        w: scene.render.width,
        h: scene.render.height,
    };
    for sample in 0..2 {
        let mut accelerated = Film::new(scene.render.width, scene.render.height);
        render_tile(&scene, tile, sample, &mut accelerated);
        let mut reference = Film::new(scene.render.width, scene.render.height);
        render_tile_brute_force(&scene, tile, sample, &mut reference);
        assert_eq!(accelerated, reference, "sample {sample}");
    }
}

#[test]
fn a_front_glass_with_nothing_on_it_changes_no_pixel_and_no_pass() {
    let isa = Isa::detect();
    let plain = crate::example::scene();
    let mut clean = crate::example::scene();
    // Drops of every size and the dust's size, opacity and contact angle: none of it is there.
    clean.set_glass(Some(GlassParams {
        drop_coverage: 0.0,
        dust_coverage: 0.0,
        ..crate::example::wet_glass()
    }));
    assert!(clean.glass.as_ref().is_some_and(|g| g.is_clear()));
    assert_eq!(scene_4spp_hash(&clean, isa), PINNED_EXAMPLE_4SPP);
    let (w, h) = (plain.render.width, plain.render.height);
    let tiles = tile_grid(w, h, 32);
    assert_eq!(
        passes_of(&clean, PASS_ALL, 2, &tiles, isa),
        passes_of(&plain, PASS_ALL, 2, &tiles, isa)
    );
    // Through a file too (the GLAS section is written, and read back as a clean pane).
    let back = Scene::from_rsb(&clean.to_rsb()).expect("read");
    assert!(back.glass.is_some());
    assert_eq!(scene_4spp_hash(&back, isa), PINNED_EXAMPLE_4SPP);
    // And the wet pane does change the picture.
    assert_ne!(
        scene_4spp_hash(&crate::example::s3_glass_scene(), isa),
        scene_4spp_hash(
            &Scene {
                glass: None,
                ..crate::example::s3_glass_scene()
            },
            isa
        )
    );
}

/// A pinhole camera 1 m in front of a wall whose left half (seen from the camera) glows, 64 x 48.
fn half_lit_wall() -> Scene {
    let wall = crate::geometry::Mesh::new(
        &[
            Vec3::new(-2000.0, 0.0, -1500.0),
            Vec3::new(0.0, 0.0, -1500.0),
            Vec3::new(0.0, 0.0, 1500.0),
            Vec3::new(-2000.0, 0.0, 1500.0),
        ],
        &[],
        &[0, 1, 2, 0, 2, 3],
        0,
    )
    .expect("wall");
    Scene {
        camera: Camera {
            position: Vec3::new(0.0, -1000.0, 0.0),
            target: Vec3::ZERO,
            ..Camera::default()
        },
        materials: vec![Material {
            kind: MATERIAL_EMISSIVE,
            emission: Rgb::WHITE,
            emission_power: 1.0,
            ..Material::default()
        }],
        geometry: crate::geometry::Geometry::from_meshes(vec![wall]),
        environment: Environment {
            kind: EnvKind::Flat,
            floor: 0.0,
            horizon: 0.0,
            zenith: 0.0,
            ..Environment::default()
        },
        render: RenderSettings {
            width: 64,
            height: 48,
            max_depth: 1,
            tonemap: 0,
            ..RenderSettings::default()
        },
        ..Scene::default()
    }
}

/// The mean green of the pixels of row band `rows` and columns `cols` after 4 samples.
fn mean(scene: &Scene, cols: std::ops::Range<u32>, rows: std::ops::Range<u32>) -> f32 {
    let (w, h) = (scene.render.width, scene.render.height);
    let mut film = Film::new(w, h);
    let prepared = Prepared::new(scene);
    for tile in tile_grid(w, h, 32) {
        for s in 0..4 {
            render_tile_prepared(scene, &prepared, tile, s, &mut film, Isa::detect());
        }
    }
    let rgba = film.resolve();
    let (mut sum, mut n) = (0.0f32, 0.0f32);
    for y in rows {
        for x in cols.clone() {
            sum += rgba[((y * w + x) * 3 + 1) as usize];
            n += 1.0;
        }
    }
    sum / n
}

#[test]
fn a_drop_on_the_glass_shows_the_scene_upside_down() {
    let plain = half_lit_wall();
    // Without the drop: the left of the middle is lit, the right dark.
    let (left, right) = (mean(&plain, 26..31, 20..28), mean(&plain, 33..38, 20..28));
    assert!(left > 0.9 && right < 0.01, "{left} {right}");
    // A drop of 6 mm across in the middle of the pane, 25 mm in front of a pinhole: the rays
    // through its left half cross the axis a few millimetres behind it and see the right of the
    // wall, and the other way round.
    let mut wet = half_lit_wall();
    let params = GlassParams {
        contact_angle_deg: 60.0,
        ..GlassParams::default()
    };
    wet.glass = Some(crate::optics::glass::FrontGlass::with_drops(
        params,
        &wet.camera,
        vec![GlassDrop {
            x: 0.0,
            y: 0.0,
            a: 3.0,
        }],
    ));
    let (left, right) = (mean(&wet, 26..31, 20..28), mean(&wet, 33..38, 20..28));
    assert!(left < 0.05 && right > 0.8, "{left} {right}");
    // Away from the drop nothing changed.
    assert_eq!(mean(&wet, 2..10, 2..10), mean(&plain, 2..10, 2..10));
    assert_eq!(mean(&wet, 54..62, 2..10), mean(&plain, 54..62, 2..10));
}
