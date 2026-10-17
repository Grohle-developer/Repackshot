//! The exact passes (phase X2, AI-POST.md §7.4): what each one holds, against `pick`, analytic
//! floors and lenses and the shared circle-of-confusion fixture of `src/core/lens-coc.ts`; that
//! asking for them changes no pixel of the image; and their pinned hashes on every SIMD path
//! (`tools/wasm-parity.mjs --passes` checks the real `rt_wasm.wasm` against the same values).

use super::*;
use crate::color::Rgb;
use crate::math::Vec3;
use crate::passes::*;
use crate::scene::{
    Camera, Environment, Floor, FloorMode, Geometry, Light, LightKind, Material, Mesh,
    RenderSettings, BACKGROUND_COLOR, BACKGROUND_TRANSPARENT, LIGHT_FLAG_CAMERA, LIGHT_FLAG_GLOSSY,
    MATERIAL_EMISSIVE, MATERIAL_GLASS,
};

/// The passes of `mask` of the whole image: the exact ones once per tile, the albedo of samples
/// `0..samples`, the tiles in the order given.
pub(crate) fn passes_of(
    scene: &Scene,
    mask: u32,
    samples: u32,
    tiles: &[TileRect],
    isa: Isa,
) -> Passes {
    let prepared = Prepared::new(scene);
    let (w, h) = (scene.render.width, scene.render.height);
    let mut whole = Passes::new(w, h, mask);
    for &tile in tiles {
        let mut film = PassFilm::region(tile.x, tile.y, tile.w, tile.h, mask);
        render_tile_exact(scene, &prepared, tile, &mut film, isa);
        for s in 0..samples {
            render_tile_albedo(scene, &prepared, tile, s, &mut film, isa);
        }
        whole.copy_region(tile.x, tile.y, &film.resolve());
    }
    whole
}

/// FNV-1a of every plane, in the order of `PASS_KEYS`.
fn hashes(p: &Passes) -> Vec<u32> {
    p.planes().iter().map(Plane::fnv1a).collect()
}

/// FNV-1a over the little-endian bytes of every float.
fn fnv1a(values: &[f32]) -> u32 {
    Plane::F32(values).fnv1a()
}

fn whole(scene: &Scene) -> Vec<TileRect> {
    vec![TileRect {
        x: 0,
        y: 0,
        w: scene.render.width,
        h: scene.render.height,
    }]
}

/// A quad in the plane `y = depth` spanning `x` in `[x0, x1]` and `z` in `[z0, z1]`, wound to
/// face `-Y` (towards a camera on the -Y side), with or without vertex normals.
fn quad(depth: f32, x: (f32, f32), z: (f32, f32), material: u32, normals: bool) -> Mesh {
    let p = [
        Vec3::new(x.0, depth, z.0),
        Vec3::new(x.1, depth, z.0),
        Vec3::new(x.1, depth, z.1),
        Vec3::new(x.0, depth, z.1),
    ];
    let n = [Vec3::new(0.0, -1.0, 0.0); 4];
    Mesh::new(
        &p,
        if normals { &n } else { &[] },
        &[0, 1, 2, 0, 2, 3],
        material,
    )
    .expect("valid quad")
}

fn lambert(rgb: Rgb) -> Material {
    Material {
        base_color: rgb,
        ior: 1.0,
        ..Material::default()
    }
}

/// A camera at `(0, -dist, height)` looking along +Y at height `height`, 50 mm on 36 mm, in a
/// black world with a black backdrop, `w × h` pixels.
fn looking_along_y(dist: f32, height: f32, w: u32, h: u32) -> Scene {
    Scene {
        camera: Camera {
            position: Vec3::new(0.0, -dist, height),
            target: Vec3::new(0.0, 0.0, height),
            focal_mm: 50.0,
            sensor_mm: 36.0,
            ..Camera::default()
        },
        environment: Environment {
            strength: 0.0,
            background_color: Rgb::BLACK,
            background_mode: BACKGROUND_COLOR,
            ..Environment::default()
        },
        render: RenderSettings {
            width: w,
            height: h,
            ..RenderSettings::default()
        },
        ..Scene::default()
    }
}

#[test]
fn asking_for_passes_changes_no_pixel_of_the_image() {
    // The image of each scene rendered as the hosts render it, with every pass interleaved
    // (exact passes before the samples, an albedo ray after every sample), must keep its pinned
    // hash: the passes have rays of their own and touch neither the film nor its random numbers.
    let render_with_passes = |scene: &Scene| {
        let prepared = Prepared::new(scene);
        let (w, h) = (scene.render.width, scene.render.height);
        let mut film = Film::new(w, h);
        let mut passes = Passes::new(w, h, PASS_ALL);
        for tile in tile_grid(w, h, 32) {
            let mut pf = PassFilm::region(tile.x, tile.y, tile.w, tile.h, PASS_ALL);
            render_tile_exact(scene, &prepared, tile, &mut pf, Isa::detect());
            for sample in 0..4 {
                render_tile_prepared(scene, &prepared, tile, sample, &mut film, Isa::detect());
                render_tile_albedo(scene, &prepared, tile, sample, &mut pf, Isa::detect());
            }
            passes.copy_region(tile.x, tile.y, &pf.resolve());
        }
        assert!(
            passes.part_id.iter().any(|&id| id > 0),
            "the passes were drawn"
        );
        fnv1a(&film.resolve())
    };
    assert_eq!(
        render_with_passes(&crate::example::scene()),
        super::tests::PINNED_EXAMPLE_4SPP
    );
    assert_eq!(
        render_with_passes(&crate::example::e5_scene(false)),
        super::tests::PINNED_E5_HDRI_4SPP
    );
    assert_eq!(
        render_with_passes(&crate::example::e5_scene(true)),
        super::tests::PINNED_E5_SKY_4SPP
    );
    assert_eq!(
        render_with_passes(&crate::example::e6_scene()),
        super::tests::PINNED_E6_BEVEL_4SPP
    );
}

#[test]
fn the_passes_of_the_example_have_pinned_hashes_on_every_platform() {
    // Like the image's hashes: only IEEE arithmetic, `fmath` and integers, every SIMD path gives
    // the same hits, so the planes are the same bits on x86-64 (scalar, SSE2, AVX2), aarch64 and
    // wasm32 (scalar and simd128, through the WASI run of these tests), and through the real
    // `rt_wasm.wasm` (`tools/wasm-parity.mjs --passes`). The albedo is of 4 samples.
    let scene = crate::example::scene();
    let (w, h) = (scene.render.width, scene.render.height);
    let tiles = tile_grid(w, h, 32);
    let mut reference = None;
    for isa in Isa::available() {
        let passes = passes_of(&scene, PASS_X2, 4, &tiles, isa);
        let got = hashes(&passes);
        for (key, hash) in PASS_KEYS.iter().zip(&got) {
            eprintln!("example {key} on {}: {hash:#010x}", isa.name());
        }
        assert_eq!(got, PINNED_EXAMPLE_PASSES, "on {}", isa.name());
        reference.get_or_insert(passes);
    }
    // Any tiling, in any order, gives the same planes.
    let reference = reference.expect("at least the scalar path");
    let mut odd = tile_grid(w, h, 13);
    odd.reverse();
    assert_eq!(
        passes_of(&scene, PASS_X2, 4, &odd, Isa::detect()),
        reference
    );
    // A subset of the passes is the same planes.
    let some = passes_of(&scene, PASS_DEPTH | PASS_COC, 4, &tiles, Isa::detect());
    assert_eq!(
        (some.depth.as_slice(), some.coc.as_slice()),
        (reference.depth.as_slice(), reference.coc.as_slice())
    );
    assert!(some.albedo.is_empty() && some.part_id.is_empty());
    // The example has the three instances, the background over the floor's far edge, and depth
    // of field (f/11): the planes are not trivial.
    for id in 0..=3 {
        assert!(reference.part_id.contains(&id), "part id {id}");
    }
    assert!(reference.coc.iter().any(|&c| c > 0.5));
}

#[test]
fn the_passes_of_the_e5_example_have_pinned_hashes_on_every_platform() {
    // Glass (its tint is the albedo, the refracted world behind it is not), a thin glass card and
    // a cut-out card in front (every surface stops the pass ray), an HDRI and a background image
    // (background). `tools/wasm-parity.mjs` checks the real module against the same values.
    let scene = crate::example::e5_scene(false);
    let tiles = tile_grid(scene.render.width, scene.render.height, 32);
    for isa in Isa::available() {
        let passes = passes_of(&scene, PASS_X2, 4, &tiles, isa);
        let got = hashes(&passes);
        for (key, hash) in PASS_KEYS.iter().zip(&got) {
            eprintln!("E5 {key} on {}: {hash:#010x}", isa.name());
        }
        assert_eq!(got, PINNED_E5_PASSES, "on {}", isa.name());
        // Instance 0 is the glass sphere: its albedo is the glass's colour, not what it shows.
        let glass = scene.materials[0].base_color;
        let tinted = passes
            .part_id
            .iter()
            .zip(passes.albedo.chunks_exact(3))
            .filter(|(&id, a)| {
                id == 1
                    && (a[0] - glass.r).abs() < 1.0e-6
                    && (a[1] - glass.g).abs() < 1.0e-6
                    && (a[2] - glass.b).abs() < 1.0e-6
            })
            .count();
        assert!(tinted > 100, "{tinted} pixels of the glass sphere");
    }
}

#[test]
fn the_passes_of_the_e6_example_have_pinned_hashes_on_every_platform() {
    // E6: the normal pass is the bevelled shading normal (what the image is shaded with; the
    // denoiser's normal guide follows the rounded strips). `tools/wasm-parity.mjs` checks the real
    // module against the same values; the image keeps its hash with the passes interleaved.
    let scene = crate::example::e6_scene();
    let tiles = tile_grid(scene.render.width, scene.render.height, 32);
    for isa in Isa::available() {
        let passes = passes_of(&scene, PASS_X2, 4, &tiles, isa);
        let got = hashes(&passes);
        for (key, hash) in PASS_KEYS.iter().zip(&got) {
            eprintln!("E6 {key} on {}: {hash:#010x}", isa.name());
        }
        assert_eq!(got, PINNED_E6_PASSES, "on {}", isa.name());
    }
    let mut sharp = scene.clone();
    for m in &mut sharp.materials {
        m.bevel_mm = 0.0;
    }
    let plain = hashes(&passes_of(&sharp, PASS_X2, 4, &tiles, Isa::detect()));
    assert_ne!(
        plain[1], PINNED_E6_PASS_NORMAL,
        "the bevel shows in the normal pass"
    );
    assert_eq!(
        plain[2], PINNED_E6_PASS_DEPTH,
        "and nowhere in the geometry"
    );
}

/// The pinned hashes of the E6 example's passes (4 samples of albedo), in the order of
/// `PASS_KEYS` (`PINNED_E6_PASS_<KEY>` for CI).
const PINNED_E6_PASSES: [u32; 6] = [
    PINNED_E6_PASS_ALBEDO,
    PINNED_E6_PASS_NORMAL,
    PINNED_E6_PASS_DEPTH,
    PINNED_E6_PASS_PART_ID,
    PINNED_E6_PASS_MATERIAL_ID,
    PINNED_E6_PASS_COC,
];
pub(crate) const PINNED_E6_PASS_ALBEDO: u32 = 0x2545_e8ce;
pub(crate) const PINNED_E6_PASS_NORMAL: u32 = 0xfdbd_1a5b;
pub(crate) const PINNED_E6_PASS_DEPTH: u32 = 0xda55_e505;
pub(crate) const PINNED_E6_PASS_PART_ID: u32 = 0xf0c7_5106;
pub(crate) const PINNED_E6_PASS_MATERIAL_ID: u32 = 0xf0c7_5106;
pub(crate) const PINNED_E6_PASS_COC: u32 = 0x6ad5_8dc5;

#[test]
fn the_passes_of_the_m2b_example_have_pinned_hashes_on_every_platform() {
    // M2b: the albedo pass is the textured base colour (the colour images and the labels over
    // it, read with the footprint of the sample's camera ray); the other planes are the
    // geometry's. `tools/wasm-parity.mjs` checks the real module against the same values; the
    // image keeps its hash with the passes interleaved.
    let scene = crate::example::m2b_scene();
    let tiles = tile_grid(scene.render.width, scene.render.height, 32);
    for isa in Isa::available() {
        let passes = passes_of(&scene, PASS_X2, 4, &tiles, isa);
        let got = hashes(&passes);
        for (key, hash) in PASS_KEYS.iter().zip(&got) {
            eprintln!("M2b {key} on {}: {hash:#010x}", isa.name());
        }
        assert_eq!(got, PINNED_M2B_PASSES, "on {}", isa.name());
    }
    let mut plain = scene.clone();
    plain.textures.clear();
    let without = hashes(&passes_of(&plain, PASS_X2, 4, &tiles, Isa::detect()));
    assert_ne!(
        without[0], PINNED_M2B_PASS_ALBEDO,
        "the textures show in the albedo pass"
    );
    assert_eq!(
        without[2], PINNED_M2B_PASS_DEPTH,
        "and nowhere in the geometry"
    );
}

#[test]
fn the_passes_of_the_m3b_example_have_pinned_hashes_on_every_platform() {
    // M3b: the albedo pass is the programs' base colour (read with the footprint of the
    // sample's camera ray); the normal pass is the bevel's, without the programs' normals (as
    // without the normal maps of M2b); the other planes are the geometry's.
    let scene = crate::example::m3b_scene();
    let tiles = tile_grid(scene.render.width, scene.render.height, 32);
    for isa in Isa::available() {
        let passes = passes_of(&scene, PASS_X2, 4, &tiles, isa);
        let got = hashes(&passes);
        for (key, hash) in PASS_KEYS.iter().zip(&got) {
            eprintln!("M3b {key} on {}: {hash:#010x}", isa.name());
        }
        assert_eq!(got, PINNED_M3B_PASSES, "on {}", isa.name());
    }
    let mut plain = scene.clone();
    plain.programs.clear();
    let without = hashes(&passes_of(&plain, PASS_X2, 4, &tiles, Isa::detect()));
    assert_ne!(
        without[0], PINNED_M3B_PASS_ALBEDO,
        "the programs show in the albedo pass"
    );
    assert_eq!(
        without[2], PINNED_M3B_PASS_DEPTH,
        "and nowhere in the geometry"
    );
}

/// The pinned hashes of the M3b example's passes (4 samples of albedo), in the order of
/// `PASS_KEYS` (`PINNED_M3B_PASS_<KEY>` for CI).
const PINNED_M3B_PASSES: [u32; 6] = [
    PINNED_M3B_PASS_ALBEDO,
    PINNED_M3B_PASS_NORMAL,
    PINNED_M3B_PASS_DEPTH,
    PINNED_M3B_PASS_PART_ID,
    PINNED_M3B_PASS_MATERIAL_ID,
    PINNED_M3B_PASS_COC,
];
pub(crate) const PINNED_M3B_PASS_ALBEDO: u32 = 0xa054_3b58;
pub(crate) const PINNED_M3B_PASS_NORMAL: u32 = 0xc28e_f77c;
pub(crate) const PINNED_M3B_PASS_DEPTH: u32 = 0x8f3d_03ed;
pub(crate) const PINNED_M3B_PASS_PART_ID: u32 = 0xa67f_d1e5;
pub(crate) const PINNED_M3B_PASS_MATERIAL_ID: u32 = 0xa67f_d1e5;
pub(crate) const PINNED_M3B_PASS_COC: u32 = 0x6ad5_8dc5;

/// The pinned hashes of the M2b example's passes (4 samples of albedo), in the order of
/// `PASS_KEYS` (`PINNED_M2B_PASS_<KEY>` for CI).
const PINNED_M2B_PASSES: [u32; 6] = [
    PINNED_M2B_PASS_ALBEDO,
    PINNED_M2B_PASS_NORMAL,
    PINNED_M2B_PASS_DEPTH,
    PINNED_M2B_PASS_PART_ID,
    PINNED_M2B_PASS_MATERIAL_ID,
    PINNED_M2B_PASS_COC,
];
pub(crate) const PINNED_M2B_PASS_ALBEDO: u32 = 0x478b_fcc8;
pub(crate) const PINNED_M2B_PASS_NORMAL: u32 = 0xc149_1d6a;
pub(crate) const PINNED_M2B_PASS_DEPTH: u32 = 0x3047_4c2a;
pub(crate) const PINNED_M2B_PASS_PART_ID: u32 = 0xb4c6_eb60;
pub(crate) const PINNED_M2B_PASS_MATERIAL_ID: u32 = 0xb4c6_eb60;
pub(crate) const PINNED_M2B_PASS_COC: u32 = 0x6ad5_8dc5;

/// The pinned hashes of the example's passes (4 samples of albedo), in the order of
/// `PASS_KEYS`. CI reads them from here (`PINNED_PASS_<KEY>`) for `tools/wasm-parity.mjs`.
const PINNED_EXAMPLE_PASSES: [u32; 6] = [
    PINNED_PASS_ALBEDO,
    PINNED_PASS_NORMAL,
    PINNED_PASS_DEPTH,
    PINNED_PASS_PART_ID,
    PINNED_PASS_MATERIAL_ID,
    PINNED_PASS_COC,
];
pub(crate) const PINNED_PASS_ALBEDO: u32 = 0x4357_1da9;
pub(crate) const PINNED_PASS_NORMAL: u32 = 0x0aab_fd24;
pub(crate) const PINNED_PASS_DEPTH: u32 = 0x25f8_dd11;
// The example's instance i carries material i: the two id planes are the same numbers.
pub(crate) const PINNED_PASS_PART_ID: u32 = 0xccd3_d6c7;
pub(crate) const PINNED_PASS_MATERIAL_ID: u32 = 0xccd3_d6c7;
pub(crate) const PINNED_PASS_COC: u32 = 0xdf87_494c;

/// The pinned hashes of the E5 example's passes (HDRI, 4 samples of albedo), in the order of
/// `PASS_KEYS` (`PINNED_E5_PASS_<KEY>` for CI).
const PINNED_E5_PASSES: [u32; 6] = [
    PINNED_E5_PASS_ALBEDO,
    PINNED_E5_PASS_NORMAL,
    PINNED_E5_PASS_DEPTH,
    PINNED_E5_PASS_PART_ID,
    PINNED_E5_PASS_MATERIAL_ID,
    PINNED_E5_PASS_COC,
];
pub(crate) const PINNED_E5_PASS_ALBEDO: u32 = 0xace9_3461;
pub(crate) const PINNED_E5_PASS_NORMAL: u32 = 0x7142_53d6;
pub(crate) const PINNED_E5_PASS_DEPTH: u32 = 0x9b1b_61c8;
pub(crate) const PINNED_E5_PASS_PART_ID: u32 = 0x2c21_fa55;
pub(crate) const PINNED_E5_PASS_MATERIAL_ID: u32 = 0x2c21_fa55;
pub(crate) const PINNED_E5_PASS_COC: u32 = 0x73bf_76f1;

#[test]
fn part_and_material_ids_are_what_pick_finds_at_the_pixel_centre() {
    let mut scene = crate::example::scene();
    scene.render.width = 128;
    scene.render.height = 96;
    let passes = passes_of(&scene, PASS_ALL, 1, &tile_grid(128, 96, 32), Isa::detect());
    let (forward, _, _) = scene.camera.basis();
    let prepared = Prepared::new(&scene);
    let lights = prepared.lights();
    let mut seen = [0usize; 4];
    for y in 0..96u32 {
        for x in 0..128u32 {
            // The ray through the centre of the pixel, built here, not by `centre_ray`.
            let ray = scene.camera.generate_ray(
                128.0 / 96.0,
                (x as f32 + 0.5) / 128.0,
                (y as f32 + 0.5) / 96.0,
                (0.0, 0.0),
            );
            let i = (y * 128 + x) as usize;
            match scene.pick(&ray) {
                Some(hit) if !lights.camera_sees_panel(&ray, hit.t) => {
                    let inst = &scene.geometry.instances()[hit.instance as usize];
                    assert_eq!(passes.part_id[i], hit.instance + 1, "({x}, {y})");
                    assert_eq!(passes.material_id[i], inst.material_id + 1, "({x}, {y})");
                    let depth = hit.t * ray.dir.dot(forward);
                    assert!(
                        (passes.depth[i] - depth).abs() <= 1.0e-4 * depth,
                        "({x}, {y})"
                    );
                    assert_eq!(
                        passes.normal[i * 3..i * 3 + 3],
                        [hit.normal.x, hit.normal.y, hit.normal.z]
                    );
                    seen[(hit.instance + 1) as usize] += 1;
                }
                _ => {
                    assert_eq!(
                        (passes.part_id[i], passes.material_id[i]),
                        (0, 0),
                        "({x}, {y})"
                    );
                    assert_eq!(passes.depth[i], f32::INFINITY);
                    assert_eq!(passes.normal[i * 3..i * 3 + 3], [0.0; 3]);
                    assert_eq!(passes.coc[i], 0.0);
                    seen[0] += 1;
                }
            }
        }
    }
    assert!(
        seen.iter().all(|&n| n > 20),
        "background, sphere, floor and small sphere: {seen:?}"
    );
}

#[test]
fn the_studio_floor_is_floor_id_and_escaping_rays_are_background() {
    // The camera looks slightly down along +Y: the upper rows see the sky, the lower ones the
    // floor plane z = 0, and a quad hides part of both.
    let mut scene = looking_along_y(200.0, 50.0, 40, 30);
    scene.camera.target = Vec3::new(0.0, 0.0, 35.0);
    scene.materials = vec![lambert(Rgb::new(0.7, 0.2, 0.1))];
    scene.geometry = Geometry::from_meshes(vec![quad(0.0, (-12.0, 12.0), (20.0, 60.0), 0, false)]);
    let floor_color = Rgb::new(0.3, 0.6, 0.9);
    let (forward, _, _) = scene.camera.basis();
    for mode in [
        FloorMode::Visible,
        FloorMode::ShadowCatcher,
        FloorMode::None,
    ] {
        for background in [BACKGROUND_COLOR, BACKGROUND_TRANSPARENT] {
            scene.floor = Floor {
                mode,
                z: 0.0,
                color: floor_color,
            };
            scene.environment.background_mode = background;
            let passes = passes_of(&scene, PASS_ALL, 2, &whole(&scene), Isa::detect());
            let mut counts = [0usize; 3];
            for y in 0..30u32 {
                for x in 0..40u32 {
                    let i = (y * 40 + x) as usize;
                    let ray = centre_ray(&scene, x, y);
                    let px = (passes.part_id[i], passes.material_id[i]);
                    if scene.pick(&ray).is_some() {
                        assert_eq!(px, (1, 1), "the quad at ({x}, {y})");
                        counts[0] += 1;
                    } else if ray.dir.z < 0.0 && mode != FloorMode::None {
                        assert_eq!(px, (FLOOR_ID, FLOOR_ID), "floor at ({x}, {y}), {mode:?}");
                        let t = -ray.origin.z / ray.dir.z;
                        let depth = t * ray.dir.dot(forward);
                        assert!((passes.depth[i] - depth).abs() <= 1.0e-4 * depth);
                        assert_eq!(passes.normal[i * 3..i * 3 + 3], [0.0, 0.0, 1.0]);
                        // Both albedo samples see the floor away from the quad's edges.
                        let a = &passes.albedo[i * 3..i * 3 + 3];
                        if a[0] == floor_color.r {
                            assert_eq!(a, [floor_color.r, floor_color.g, floor_color.b]);
                        }
                        counts[1] += 1;
                    } else {
                        assert_eq!(px, (0, 0), "background at ({x}, {y}), {mode:?}");
                        assert_eq!(passes.depth[i], f32::INFINITY);
                        assert_eq!(passes.normal[i * 3..i * 3 + 3], [0.0; 3]);
                        counts[2] += 1;
                    }
                }
            }
            assert!(counts[0] > 20 && counts[2] > 20, "{mode:?}: {counts:?}");
            assert_eq!(
                counts[1] > 20,
                mode != FloorMode::None,
                "{mode:?}: {counts:?}"
            );
            // The floor's albedo is its colour (most floor pixels see only the floor).
            if mode != FloorMode::None {
                let floor_albedo = passes
                    .albedo
                    .chunks_exact(3)
                    .zip(&passes.part_id)
                    .filter(|(a, &id)| id == FLOOR_ID && a[1] == floor_color.g)
                    .count();
                assert!(floor_albedo > 20, "{mode:?}: {floor_albedo}");
            }
        }
    }
}

#[test]
fn a_light_panel_the_camera_sees_is_background() {
    let mut scene = looking_along_y(100.0, 0.0, 24, 24);
    scene.materials = vec![lambert(Rgb::splat(0.5))];
    scene.geometry = Geometry::from_meshes(vec![quad(0.0, (-60.0, 60.0), (-60.0, 60.0), 0, true)]);
    // A small panel between the camera and the quad, facing the camera, over the left half.
    let panel = |flags: u32, direction: Vec3| Light {
        kind: LightKind::Rect,
        position: Vec3::new(-6.0, -50.0, 0.0),
        direction,
        up: Vec3::new(0.0, 0.0, 1.0),
        size_x: 10.0,
        size_y: 10.0,
        power: 2.0,
        flags,
        ..Light::default()
    };
    let towards_camera = Vec3::new(0.0, -1.0, 0.0);
    let count = |scene: &Scene| {
        let p = passes_of(scene, PASS_ALL, 2, &whole(scene), Isa::detect());
        let background = p.part_id.iter().filter(|&&id| id == 0).count();
        // A background pixel holds nothing at all.
        for (i, &id) in p.part_id.iter().enumerate() {
            if id == 0 {
                assert_eq!(
                    (p.depth[i], p.material_id[i], p.coc[i]),
                    (f32::INFINITY, 0, 0.0)
                );
                assert_eq!(p.normal[i * 3..i * 3 + 3], [0.0; 3]);
            }
        }
        (background, p.albedo.iter().filter(|&&a| a == 0.0).count())
    };
    scene.lights = vec![panel(LIGHT_FLAG_CAMERA | LIGHT_FLAG_GLOSSY, towards_camera)];
    let (seen, black) = count(&scene);
    assert!(
        seen > 10 && seen < 24 * 24 / 2,
        "{seen} pixels behind the panel"
    );
    assert!(black >= seen * 3, "and they have no albedo either");
    // Not flagged for the camera, or seen from its back: the quad behind it shows.
    scene.lights = vec![panel(LIGHT_FLAG_GLOSSY, towards_camera)];
    assert_eq!(count(&scene).0, 0);
    scene.lights = vec![panel(LIGHT_FLAG_CAMERA, -towards_camera)];
    assert_eq!(count(&scene).0, 0);
}

#[test]
fn the_albedo_is_the_base_colour_at_the_first_hit_averaged_over_the_samples() {
    // Three quads side by side fill the frame: a diffuse one, a clear glass one (its tint, not
    // what lies behind it) and an emitter (its base colour).
    let mut scene = looking_along_y(100.0, 0.0, 48, 16);
    let diffuse = Rgb::new(0.8, 0.3, 0.1);
    let tint = Rgb::new(0.2, 0.9, 0.6);
    scene.materials = vec![
        lambert(diffuse),
        Material {
            kind: MATERIAL_GLASS,
            base_color: tint,
            transmission: 1.0,
            roughness: 0.0,
            ..Material::default()
        },
        Material {
            kind: MATERIAL_EMISSIVE,
            base_color: Rgb::splat(0.03),
            emission: Rgb::WHITE,
            emission_power: 5.0,
            ..Material::default()
        },
    ];
    // The frame spans x in [-36, 36] at y = 0 (36 mm on 50 mm at 100 mm), 1.5 mm a pixel: the
    // quads meet across the middle of pixels 16 and 31.
    scene.geometry = Geometry::from_meshes(vec![
        quad(0.0, (-50.0, -11.25), (-50.0, 50.0), 0, false),
        quad(0.0, (-11.25, 11.25), (-50.0, 50.0), 1, false),
        quad(0.0, (11.25, 50.0), (-50.0, 50.0), 2, false),
        // Behind the glass: what a refracted path would see, never the albedo.
        quad(30.0, (-50.0, 50.0), (-50.0, 50.0), 0, false),
    ]);
    let samples = 5;
    let p = passes_of(
        &scene,
        PASS_ALBEDO | PASS_PART_ID,
        samples,
        &whole(&scene),
        Isa::detect(),
    );
    let mut blended = 0;
    for (i, a) in p.albedo.chunks_exact(3).enumerate() {
        let expected = match p.part_id[i] {
            1 => diffuse,
            2 => tint,
            3 => Rgb::splat(0.03),
            id => panic!("pixel {i} sees instance {id}"),
        };
        let close = |v: f32, e: f32| (v - e).abs() <= 1.0e-6 * e.max(1.0);
        if !(close(a[0], expected.r) && close(a[1], expected.g) && close(a[2], expected.b)) {
            // A pixel on the boundary of two quads averages what its samples saw.
            let (x, y) = (i % 48, i / 48);
            assert!(x == 16 || x == 31, "({x}, {y}): {a:?}");
            blended += 1;
        }
    }
    assert!(blended > 0, "the samples of an edge pixel see both sides");
    // Five identical samples average back to the colour, within the rounding of f32.
    let centre = (8 * 48 + 4) * 3;
    assert!((p.albedo[centre] - diffuse.r).abs() < 1.0e-6);
}

/// The scene of the alpha tests: a quad in front of the sky and of a floor, 40 × 30 pixels.
fn quad_over_floor() -> Scene {
    let mut scene = looking_along_y(200.0, 50.0, 40, 30);
    scene.camera.target = Vec3::new(0.0, 0.0, 35.0);
    scene.materials = vec![lambert(Rgb::new(0.7, 0.2, 0.1))];
    scene.geometry = Geometry::from_meshes(vec![quad(0.0, (-12.0, 12.0), (20.0, 60.0), 0, false)]);
    scene
}

#[test]
fn alpha_is_the_coverage_of_the_objects_and_nothing_else() {
    // N2: 1 inside the quad, 0 on the floor (visible, a shadow catcher or absent), the sky, the
    // colour and the transparency; fractional only along the quad's edge, where the samples of a
    // pixel see both sides. The floor and the background do not change a bit of it.
    let mut scene = quad_over_floor();
    let mut reference: Option<Vec<f32>> = None;
    for mode in [
        FloorMode::Visible,
        FloorMode::ShadowCatcher,
        FloorMode::None,
    ] {
        for background in [BACKGROUND_COLOR, BACKGROUND_TRANSPARENT] {
            scene.floor = Floor {
                mode,
                z: 0.0,
                color: Rgb::new(0.3, 0.6, 0.9),
            };
            scene.environment.background_mode = background;
            let p = passes_of(
                &scene,
                PASS_ALPHA | PASS_PART_ID,
                8,
                &whole(&scene),
                Isa::detect(),
            );
            assert!(
                p.albedo.is_empty() && p.depth.is_empty(),
                "only what was asked"
            );
            let (mut inside, mut outside, mut edge) = (0, 0, 0);
            for y in 0..30usize {
                for x in 0..40usize {
                    let i = y * 40 + x;
                    // Whether the pixel and its eight neighbours all see the quad, or none does.
                    let around = |want: bool| {
                        (y.saturating_sub(1)..=(y + 1).min(29)).all(|yy| {
                            (x.saturating_sub(1)..=(x + 1).min(39))
                                .all(|xx| (p.part_id[yy * 40 + xx] == 1) == want)
                        })
                    };
                    let a = p.alpha[i];
                    assert!((0.0..=1.0).contains(&a), "({x}, {y}): {a}");
                    if around(true) {
                        assert_eq!(a, 1.0, "inside at ({x}, {y})");
                        inside += 1;
                    } else if around(false) {
                        assert_eq!(a, 0.0, "outside at ({x}, {y}), {mode:?}, {background}");
                        outside += 1;
                    } else if a > 0.0 && a < 1.0 {
                        edge += 1;
                    }
                }
            }
            assert!(inside > 20 && outside > 100, "{inside} in, {outside} out");
            assert!(edge > 10, "the edge is anti-aliased: {edge} pixels");
            match &reference {
                None => reference = Some(p.alpha),
                Some(r) => assert_eq!(&p.alpha, r, "{mode:?} over {background}"),
            }
        }
    }
}

#[test]
fn alpha_is_the_alpha_of_a_transparent_render_of_opaque_objects() {
    // Where nothing but opaque objects and the background are, the coverage the pass counts is the
    // film's own alpha with a transparent background, bit for bit: the same camera sample, the same
    // answer, the same division. (Glass the path goes through and the floor's shadow are not
    // coverage in the pass: that is the difference, noted in the module's table.)
    let mut scene = quad_over_floor();
    scene.floor = Floor {
        mode: FloorMode::None,
        z: 0.0,
        color: Rgb::BLACK,
    };
    scene.environment.background_mode = BACKGROUND_TRANSPARENT;
    scene.render.max_samples = 8;
    let prepared = Prepared::new(&scene);
    let mut film = Film::new(40, 30);
    for tile in tile_grid(40, 30, 16) {
        for sample in 0..8 {
            render_tile_prepared(&scene, &prepared, tile, sample, &mut film, Isa::detect());
        }
    }
    let p = passes_of(&scene, PASS_ALPHA, 8, &tile_grid(40, 30, 16), Isa::detect());
    let image = film.resolve_alpha();
    assert!(image.iter().any(|&a| a > 0.0 && a < 1.0), "has soft edges");
    assert_eq!(p.alpha, image);
}

#[test]
fn alpha_with_edge_samples_is_the_alpha_of_the_film_with_them() {
    // E11: an edge pixel renders k samples of each index and splats their mean once; the pass does
    // the same with the coverage of those k samples, so it is still the film's alpha bit for bit
    // (and finer than the base samples alone could tell: an eighth, from 2 samples at k = 4).
    let mut scene = quad_over_floor();
    scene.floor = Floor {
        mode: FloorMode::None,
        z: 0.0,
        color: Rgb::BLACK,
    };
    scene.environment.background_mode = BACKGROUND_TRANSPARENT;
    scene.render.edge_supersample = 4;
    let prepared = Prepared::new(&scene);
    let isa = Isa::detect();
    let mut film = Film::new(40, 30);
    let mut passes = Passes::new(40, 30, PASS_ALPHA);
    for tile in tile_grid(40, 30, 16) {
        let edges = crate::pixel_filter::EdgeMask::of(&scene, &prepared, tile, isa);
        let mut pf = PassFilm::region(tile.x, tile.y, tile.w, tile.h, PASS_ALPHA);
        for sample in 0..2 {
            render_tile_edges(&scene, &prepared, None, &edges, sample, &mut film, isa);
            render_tile_albedo_edges(&scene, &prepared, &edges, sample, &mut pf, isa);
        }
        passes.copy_region(tile.x, tile.y, &pf.resolve());
    }
    assert_eq!(passes.alpha, film.resolve_alpha());
    assert!(
        passes
            .alpha
            .iter()
            .any(|&a| (a * 8.0).fract() == 0.0 && (a * 8.0) as u32 % 2 == 1),
        "an edge pixel has an odd eighth: its sub-samples were counted"
    );
}

#[test]
fn a_light_panel_the_camera_sees_has_no_coverage() {
    let mut scene = looking_along_y(100.0, 0.0, 24, 24);
    scene.materials = vec![lambert(Rgb::splat(0.5))];
    scene.geometry = Geometry::from_meshes(vec![quad(0.0, (-60.0, 60.0), (-60.0, 60.0), 0, true)]);
    let panel = Light {
        kind: LightKind::Rect,
        position: Vec3::new(-6.0, -50.0, 0.0),
        direction: Vec3::new(0.0, -1.0, 0.0),
        up: Vec3::new(0.0, 0.0, 1.0),
        size_x: 10.0,
        size_y: 10.0,
        power: 2.0,
        flags: LIGHT_FLAG_CAMERA | LIGHT_FLAG_GLOSSY,
        ..Light::default()
    };
    let without = passes_of(&scene, PASS_ALPHA, 2, &whole(&scene), Isa::detect());
    assert!(
        without.alpha.iter().all(|&a| a == 1.0),
        "the quad fills the frame"
    );
    scene.lights = vec![panel];
    let with = passes_of(
        &scene,
        PASS_ALPHA | PASS_PART_ID,
        2,
        &whole(&scene),
        Isa::detect(),
    );
    let behind = with.part_id.iter().filter(|&&id| id == 0).count();
    assert!(behind > 10, "{behind} pixels behind the panel");
    for (a, id) in with.alpha.iter().zip(&with.part_id) {
        if *id == 0 {
            assert_eq!(*a, 0.0, "background where the panel is");
        }
    }
}

#[test]
fn alpha_with_the_other_passes_and_in_any_tiling_is_the_same_plane() {
    let scene = quad_over_floor();
    let tiles = tile_grid(40, 30, 32);
    let alone = passes_of(&scene, PASS_ALPHA, 4, &tiles, Isa::detect());
    let mut odd = tile_grid(40, 30, 7);
    odd.reverse();
    assert_eq!(
        passes_of(&scene, PASS_ALPHA, 4, &odd, Isa::detect()).alpha,
        alone.alpha
    );
    // With the albedo asked too (one trace serves both) and with every pass.
    assert_eq!(
        passes_of(&scene, PASS_ALPHA | PASS_ALBEDO, 4, &tiles, Isa::detect()).alpha,
        alone.alpha
    );
    let all = passes_of(&scene, PASS_ALL, 4, &tiles, Isa::detect());
    assert_eq!(all.alpha, alone.alpha);
    // And the albedo does not change with the alpha beside it.
    assert_eq!(
        passes_of(&scene, PASS_ALBEDO, 4, &tiles, Isa::detect()).albedo,
        all.albedo
    );
    // Without the pass the plane is empty, and asking for it costs no ray when no sampled pass is asked.
    let none = passes_of(&scene, PASS_DEPTH, 4, &tiles, Isa::detect());
    assert!(none.alpha.is_empty());
}

#[test]
fn the_alpha_of_the_example_and_of_the_e5_example_have_pinned_hashes_on_every_platform() {
    // N2: the alpha plane of the two scenes the X2 pins use, 4 samples, on every SIMD path (the
    // glass sphere and the cut-out card count as objects: every surface stops the pass ray).
    // `tools/wasm-parity.mjs --expect-alpha` checks the real `rt_wasm.wasm` against the same values.
    for (name, scene, pinned) in [
        ("example", crate::example::scene(), PINNED_PASS_ALPHA),
        ("E5", crate::example::e5_scene(false), PINNED_E5_PASS_ALPHA),
    ] {
        let tiles = tile_grid(scene.render.width, scene.render.height, 32);
        for isa in Isa::available() {
            let p = passes_of(&scene, PASS_ALPHA, 4, &tiles, isa);
            let got = hashes(&p);
            eprintln!("{name} alpha on {}: {:#010x}", isa.name(), got[0]);
            assert_eq!(got, [pinned], "{name} on {}", isa.name());
            assert!(
                p.alpha.contains(&0.0)
                    && p.alpha.contains(&1.0)
                    && p.alpha.iter().any(|&a| a > 0.0 && a < 1.0),
                "{name}: background, object and edge"
            );
        }
    }
}

/// The pinned hash of the example's alpha plane (4 samples; `PINNED_PASS_ALPHA` for CI).
pub(crate) const PINNED_PASS_ALPHA: u32 = 0xd4ea_ac78;
/// The same for the E5 example (`PINNED_E5_PASS_ALPHA` for CI).
pub(crate) const PINNED_E5_PASS_ALPHA: u32 = 0xef9e_ad68;

#[test]
fn normals_face_the_camera_on_both_sides_of_a_triangle() {
    // The same quad wound towards the camera and away from it, with vertex normals that point
    // away: the pass gives the unit normal towards the camera either way.
    let mut scene = looking_along_y(100.0, 0.0, 16, 16);
    scene.materials = vec![lambert(Rgb::splat(0.5))];
    let p0 = [
        Vec3::new(-60.0, 0.0, -60.0),
        Vec3::new(60.0, 0.0, -60.0),
        Vec3::new(60.0, 0.0, 60.0),
        Vec3::new(-60.0, 0.0, 60.0),
    ];
    let away = [Vec3::new(0.0, 1.0, 0.0); 4];
    let tilted = [Vec3::new(0.3, 1.0, 0.2); 4];
    for (indices, normals) in [
        ([0u32, 1, 2, 0, 2, 3], &away[..]),
        ([0u32, 2, 1, 0, 3, 2], &away[..]),
        ([0u32, 2, 1, 0, 3, 2], &[][..]),
        ([0u32, 1, 2, 0, 2, 3], &tilted[..]),
    ] {
        scene.geometry =
            Geometry::from_meshes(vec![Mesh::new(&p0, normals, &indices, 0).expect("valid")]);
        let p = passes_of(&scene, PASS_NORMAL, 1, &whole(&scene), Isa::detect());
        for y in 0..16 {
            for x in 0..16 {
                let i = (y * 16 + x) as usize;
                let n = Vec3::new(p.normal[i * 3], p.normal[i * 3 + 1], p.normal[i * 3 + 2]);
                let ray = centre_ray(&scene, x, y);
                assert!((n.length() - 1.0).abs() < 1.0e-5, "unit: {n:?}");
                assert!(n.dot(ray.dir) < 0.0, "faces the camera: {n:?}");
                if normals.is_empty() || normals[0] == away[0] {
                    assert_eq!(n, Vec3::new(0.0, -1.0, 0.0));
                } else {
                    // The shading normal itself, turned towards the camera.
                    let s = (-tilted[0]).normalize();
                    assert!((n - s).length() < 1.0e-5, "{n:?}");
                }
            }
        }
    }
}

/// The blur of the engine's own thin lens, measured: the screen positions, in pixels, at which
/// rays through the left and the right rim of the lens pass through the point at `depth` on the
/// centre ray of pixel `(x, y)` (found by bisection on `Camera::generate_ray`), apart.
fn measured_coc(scene: &Scene, x: u32, y: u32, depth: f32) -> f32 {
    let (w, h) = (scene.render.width, scene.render.height);
    let aspect = w as f32 / h as f32;
    let cam = &scene.camera;
    let (forward, right, _) = cam.basis();
    let centre = centre_ray(scene, x, y);
    let point = centre.origin + centre.dir * (depth / centre.dir.dot(forward));
    let v = (y as f32 + 0.5) / h as f32;
    let u0 = (x as f32 + 0.5) / w as f32;
    // Signed distance of the point from the ray through (u, v) and the lens point, along `right`.
    let side = |u: f32, lens: (f32, f32)| {
        let ray = cam.generate_ray(aspect, u, v, lens);
        let q = point - ray.origin;
        (q - ray.dir * q.dot(ray.dir)).dot(right)
    };
    let through = |lens: (f32, f32)| {
        let (mut lo, mut hi) = (u0 - 0.5, u0 + 0.5);
        let low_side = side(lo, lens) > 0.0;
        assert_ne!(side(hi, lens) > 0.0, low_side, "the root is in the bracket");
        for _ in 0..80 {
            let mid = 0.5 * (lo + hi);
            if (side(mid, lens) > 0.0) == low_side {
                lo = mid;
            } else {
                hi = mid;
            }
        }
        0.5 * (lo + hi)
    };
    (through((1.0, 0.0)) - through((-1.0, 0.0))).abs() * w as f32
}

#[test]
fn the_circle_of_confusion_is_the_blur_of_the_lens() {
    // A 50 mm f/2 lens focused at 1 m, a wall at several depths: the pass is zero on the focus
    // plane and, elsewhere, the blur the camera really renders, within 1 %.
    let mut scene = looking_along_y(1000.0, 0.0, 160, 90);
    scene.camera.fstop = 2.0;
    scene.camera.focus_dist = 1000.0;
    scene.materials = vec![lambert(Rgb::splat(0.5))];
    for depth in [300.0f32, 600.0, 1000.0, 1700.0, 4000.0] {
        let wall = depth - 1000.0;
        let big = 4.0 * depth;
        scene.geometry =
            Geometry::from_meshes(vec![quad(wall, (-big, big), (-big, big), 0, false)]);
        let p = passes_of(
            &scene,
            PASS_DEPTH | PASS_COC,
            1,
            &whole(&scene),
            Isa::detect(),
        );
        for (x, y) in [(80u32, 45u32), (12, 7), (150, 80)] {
            let i = (y * 160 + x) as usize;
            assert!(
                (p.depth[i] - depth).abs() <= 1.0e-5 * depth,
                "{} vs {depth}",
                p.depth[i]
            );
            let measured = measured_coc(&scene, x, y, p.depth[i]);
            let coc = p.coc[i];
            if depth == 1000.0 {
                assert!(
                    coc < 1.0e-3 && measured < 1.0e-2,
                    "in focus: {coc}, {measured}"
                );
            } else {
                assert!(coc > 1.0, "{depth}: {coc}");
                assert!(
                    (coc - measured).abs() <= 0.01 * measured,
                    "{depth} at ({x}, {y}): pass {coc}, lens {measured}"
                );
            }
            assert_eq!(coc, coc_diameter(&scene.camera, p.depth[i], 160));
        }
    }
    // No depth of field: zero everywhere, also with a wall far out of focus.
    scene.camera.fstop = 0.0;
    let p = passes_of(&scene, PASS_COC, 1, &whole(&scene), Isa::detect());
    assert!(p.coc.iter().all(|&c| c == 0.0));
}

#[test]
fn the_circle_of_confusion_matches_lens_coc_ts_on_the_shared_fixture() {
    // tests/fixtures/lens-coc.json: cases and the f64 values of `cocDiameter` (src/core/lens-coc.ts),
    // which tests/lens-coc.test.ts checks too. The engine computes in f32.
    let text = include_str!("../../../../../tests/fixtures/lens-coc.json");
    let cases = fixture_rows(text);
    assert!(cases.len() >= 10, "{} cases", cases.len());
    for row in cases {
        let [focal, fstop, focus, sensor, ortho, depth, long_side, expected] = row[..] else {
            panic!("a case has 8 columns: {row:?}");
        };
        let camera = Camera {
            focal_mm: focal as f32,
            fstop: fstop as f32,
            focus_dist: focus as f32,
            sensor_mm: sensor as f32,
            ortho: ortho != 0.0,
            ..Camera::default()
        };
        let got = f64::from(coc_diameter(&camera, depth as f32, long_side as u32));
        assert!(
            (got - expected).abs() <= 1.0e-5 * expected.abs() + 1.0e-7,
            "{row:?}: engine {got}"
        );
        assert_eq!(got == 0.0, expected == 0.0, "{row:?}");
    }
}

/// The rows of numbers of the fixture's `"cases": [[...], ...]`.
fn fixture_rows(text: &str) -> Vec<Vec<f64>> {
    let start = text.find("\"cases\"").expect("a cases array");
    let body = &text[start..];
    let open = body.find('[').expect("[");
    let mut rows = Vec::new();
    let mut depth = 0;
    let mut row = Vec::new();
    let mut number = String::new();
    for ch in body[open..].chars() {
        match ch {
            '[' => depth += 1,
            ']' | ',' if depth == 2 => {
                if !number.trim().is_empty() {
                    row.push(number.trim().parse::<f64>().expect("a number"));
                }
                number.clear();
                if ch == ']' {
                    depth -= 1;
                    rows.push(std::mem::take(&mut row));
                }
            }
            ']' => {
                depth -= 1;
                if depth == 0 {
                    break;
                }
            }
            _ if depth == 2 => number.push(ch),
            _ => {}
        }
    }
    rows
}
