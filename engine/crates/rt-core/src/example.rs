//! The built-in example scene: an icosphere on a floor, a second, smaller instance of the same
//! sphere, lit by one rectangular light.
//!
//! Used by `rt --example`, by `rt --write-example` and by the tests of every host crate.

use crate::color::Rgb;
use crate::math::Vec3;
use crate::optics::filters::FilterParams;
use crate::scene::{
    Camera, EnvKind, Environment, Floor, Geometry, Instance, Lens, LensParams, Light, LightKind,
    Material, Mesh, RenderSettings, Scene, Transform, LIGHT_FLAG_CAMERA, LIGHT_FLAG_GLOSSY,
};
use std::collections::BTreeMap;

/// Builds an icosphere: an icosahedron whose triangles are split `subdivisions` times and whose
/// vertices are pushed onto the sphere. 0 gives 20 triangles, 1 gives 80, 2 gives 320.
/// Normals are the unit radial directions (smooth shading). `material_id` is 0.
///
/// A non-finite `center` or `radius` gives an empty mesh.
pub fn icosphere(center: Vec3, radius: f32, subdivisions: u32) -> Mesh {
    let t = (1.0 + 5.0f32.sqrt()) / 2.0;
    let mut dirs: Vec<Vec3> = [
        (-1.0, t, 0.0),
        (1.0, t, 0.0),
        (-1.0, -t, 0.0),
        (1.0, -t, 0.0),
        (0.0, -1.0, t),
        (0.0, 1.0, t),
        (0.0, -1.0, -t),
        (0.0, 1.0, -t),
        (t, 0.0, -1.0),
        (t, 0.0, 1.0),
        (-t, 0.0, -1.0),
        (-t, 0.0, 1.0),
    ]
    .iter()
    .map(|&(x, y, z)| Vec3::new(x, y, z).normalize())
    .collect();
    let mut faces: Vec<[u32; 3]> = vec![
        [0, 11, 5],
        [0, 5, 1],
        [0, 1, 7],
        [0, 7, 10],
        [0, 10, 11],
        [1, 5, 9],
        [5, 11, 4],
        [11, 10, 2],
        [10, 7, 6],
        [7, 1, 8],
        [3, 9, 4],
        [3, 4, 2],
        [3, 2, 6],
        [3, 6, 8],
        [3, 8, 9],
        [4, 9, 5],
        [2, 4, 11],
        [6, 2, 10],
        [8, 6, 7],
        [9, 8, 1],
    ];

    for _ in 0..subdivisions {
        // A BTreeMap (not a HashMap) keeps the construction deterministic everywhere.
        let mut midpoints: BTreeMap<(u32, u32), u32> = BTreeMap::new();
        let mut midpoint = |a: u32, b: u32, dirs: &mut Vec<Vec3>| -> u32 {
            let key = (a.min(b), a.max(b));
            *midpoints.entry(key).or_insert_with(|| {
                dirs.push((dirs[a as usize] + dirs[b as usize]).normalize());
                (dirs.len() - 1) as u32
            })
        };
        let mut next = Vec::with_capacity(faces.len() * 4);
        for &[a, b, c] in &faces {
            let ab = midpoint(a, b, &mut dirs);
            let bc = midpoint(b, c, &mut dirs);
            let ca = midpoint(c, a, &mut dirs);
            next.extend_from_slice(&[[a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]]);
        }
        faces = next;
    }

    let positions: Vec<Vec3> = dirs.iter().map(|&d| center + d * radius).collect();
    let indices: Vec<u32> = faces.into_iter().flatten().collect();
    Mesh::new(&positions, &dirs, &indices, 0).unwrap_or_default()
}

/// A horizontal quad at height `z`, spanning `[-half, half]` on X and Y, facing up.
fn floor_quad(z: f32, half: f32, material_id: u32) -> Mesh {
    let positions = [
        Vec3::new(-half, -half, z),
        Vec3::new(half, -half, z),
        Vec3::new(half, half, z),
        Vec3::new(-half, half, z),
    ];
    let normals = [Vec3::new(0.0, 0.0, 1.0); 4];
    Mesh::new(&positions, &normals, &[0, 1, 2, 0, 2, 3], material_id).unwrap_or_default()
}

/// Where the second sphere goes: half size, resting on the floor, left of and behind the first
/// one as the camera sees it. Only scale and translation, so the matrix is exact.
pub const SMALL_SPHERE: Transform = Transform::from_rows([
    [0.5, 0.0, 0.0, -330.0],
    [0.0, 0.5, 0.0, 120.0],
    [0.0, 0.0, 0.5, 0.0],
]);

/// The example scene (millimetres): a 100 mm radius icosphere of 320 triangles resting on a
/// floor quad, a second instance of the same sphere mesh at half size ([`SMALL_SPHERE`], its own
/// material), one rectangular 5 W light above and beside the camera, the studio dome, an 85 mm
/// camera at f/11.
///
/// Instances: 0 is the sphere, 1 the floor, 2 the small sphere.
pub fn scene() -> Scene {
    let meshes = vec![
        icosphere(Vec3::new(0.0, 0.0, 100.0), 100.0, 2),
        floor_quad(0.0, 900.0, 1),
    ];
    let instances = vec![
        Instance::new(0, Transform::IDENTITY, 0),
        Instance::new(1, Transform::IDENTITY, 1),
        Instance::new(0, SMALL_SPHERE, 2),
    ];
    let light_position = Vec3::new(250.0, -450.0, 650.0);
    let camera_position = Vec3::new(560.0, -900.0, 400.0);
    let target = Vec3::new(0.0, 0.0, 90.0);
    Scene {
        camera: Camera {
            position: camera_position,
            target,
            up: Vec3::new(0.0, 0.0, 1.0),
            focal_mm: 85.0,
            sensor_mm: 36.0,
            fstop: 11.0,
            focus_dist: (target - camera_position).length(),
            ortho: false,
            ortho_width: 600.0,
            lens: None,
        },
        materials: vec![
            Material {
                base_color: Rgb::new(0.92, 0.38, 0.22),
                roughness: 0.35,
                ..Material::default()
            },
            Material {
                base_color: Rgb::new(0.3, 0.3, 0.32),
                roughness: 0.8,
                ..Material::default()
            },
            Material {
                base_color: Rgb::new(0.2, 0.42, 0.85),
                roughness: 0.25,
                ..Material::default()
            },
        ],
        // Constant data: the instance list only refers to the two meshes above.
        geometry: Geometry::new(meshes, instances).unwrap_or_default(),
        lights: vec![Light {
            kind: LightKind::Rect,
            position: light_position,
            direction: (target - light_position).normalize(),
            up: Vec3::new(0.0, 0.0, 1.0),
            size_x: 400.0,
            size_y: 400.0,
            color: Rgb::WHITE,
            // Watts of flux: about 3 W/m² on the sphere, 0.76 m away.
            power: 5.0,
            spread_deg: 180.0,
            angle_deg: 0.0,
            flags: LIGHT_FLAG_GLOSSY | LIGHT_FLAG_CAMERA,
        }],
        environment: Environment {
            kind: EnvKind::Studio,
            floor: 0.05,
            horizon: 0.12,
            zenith: 0.3,
            strength: 1.0,
            rotation_deg: 0.0,
            background_color: Rgb::splat(0.05),
            background_mode: 0,
            ..Environment::default()
        },
        floor: Floor::default(),
        render: RenderSettings {
            width: 512,
            height: 384,
            max_samples: 16,
            seed: 1,
            max_seconds: 0.0,
            exposure_ev: 0.0,
            tonemap: 1,
            max_depth: RenderSettings::DEFAULT_MAX_DEPTH,
            clamp_indirect: 0.0,
            passes: 0,
            denoise: 0,
            caustic_photons: 0,
            caustic_radius: 0.0,
            denoise_strength: 1.0,
            pixel_filter: 0,
            edge_supersample: 1,
        },
        bitmaps: Vec::new(),
        effects: Vec::new(),
    }
}

/// The example made of the materials and environments of E5, for the parity tests (`render.rs`
/// pins its hash; `rt --write-e5-example` writes it for `tools/wasm-parity.mjs`): the big sphere
/// in blue glass coloured by absorption, the floor lacquered (a clear coat), the small sphere in
/// brushed metal (anisotropic), a thin glass card and a cut-out card in front, lit by an HDRI (a
/// small Radiance file, so its reader is part of the hash) and shown over a background image.
/// `sky` lights it with the daylight sky of E5 (the classic model) and a sun instead.
pub fn e5_scene(sky: bool) -> Scene {
    use crate::bitmap::{Bitmap, FORMAT_HDR, FORMAT_RGB8};
    use crate::scene::{BACKGROUND_BACKPLATE, MATERIAL_FLAG_THIN, MATERIAL_GLASS, NO_BITMAP};
    let mut scene = scene();
    scene.render.width = 160;
    scene.render.height = 120;
    scene.render.max_depth = 12;
    scene.materials = vec![
        Material {
            kind: MATERIAL_GLASS,
            base_color: Rgb::new(0.3, 0.5, 0.95),
            roughness: 0.05,
            ior: 1.5,
            transmission: 1.0,
            absorption_mm: 80.0,
            ..Material::default()
        },
        Material {
            base_color: Rgb::new(0.3, 0.3, 0.32),
            roughness: 0.6,
            coat: 1.0,
            coat_roughness: 0.05,
            ..Material::default()
        },
        Material {
            base_color: Rgb::new(0.9, 0.85, 0.8),
            metallic: 1.0,
            roughness: 0.35,
            anisotropy: 0.8,
            ..Material::default()
        },
        Material {
            kind: MATERIAL_GLASS,
            base_color: Rgb::new(0.9, 0.6, 0.6),
            roughness: 0.0,
            transmission: 1.0,
            flags: MATERIAL_FLAG_THIN,
            ..Material::default()
        },
        Material {
            base_color: Rgb::new(0.9, 0.9, 0.2),
            opacity: 0.4,
            ..Material::default()
        },
    ];
    let card = |x: f32| {
        Mesh::new(
            &[
                Vec3::new(x - 60.0, -260.0, 0.0),
                Vec3::new(x + 60.0, -260.0, 0.0),
                Vec3::new(x + 60.0, -260.0, 160.0),
                Vec3::new(x - 60.0, -260.0, 160.0),
            ],
            &[],
            &[0, 1, 2, 0, 2, 3],
            0,
        )
        .unwrap_or_default()
    };
    let mut meshes = scene.geometry.meshes().to_vec();
    let mut instances = scene.geometry.instances().to_vec();
    for (x, material) in [(150.0, 3), (-80.0, 4)] {
        meshes.push(card(x));
        instances.push(Instance::new(
            meshes.len() as u32 - 1,
            Transform::IDENTITY,
            material,
        ));
    }
    scene.geometry = Geometry::new(meshes, instances).unwrap_or_default();
    // A 64 x 32 panorama: a grey gradient with two bright panels, as a Radiance file.
    let (w, h) = (64u32, 32u32);
    let mut rgb = Vec::new();
    for y in 0..h {
        for x in 0..w {
            let up = 1.0 - y as f32 / h as f32;
            let panel = if (20..28).contains(&x) && (8..14).contains(&y) {
                8.0
            } else if (44..47).contains(&x) && (6..18).contains(&y) {
                12.0
            } else {
                0.0
            };
            rgb.extend_from_slice(&[
                0.05 + 0.2 * up + panel,
                0.06 + 0.2 * up + panel,
                0.08 + 0.25 * up + panel,
            ]);
        }
    }
    let hdr = Bitmap::decode(FORMAT_HDR, 0, 0, crate::hdr::encode(w, h, &rgb)).ok();
    let plate: Vec<u8> = (0..16 * 8)
        .flat_map(|i| [(i * 13 % 256) as u8, 120, (255 - i * 7 % 256) as u8])
        .collect();
    let backplate = Bitmap::decode(FORMAT_RGB8, 16, 8, plate).ok();
    scene.bitmaps = hdr.into_iter().chain(backplate).collect();
    let maps = scene.bitmaps.len() == 2;
    scene.environment = Environment {
        kind: EnvKind::Hdri,
        hdri_map: if maps { 0 } else { NO_BITMAP },
        backplate_map: if maps { 1 } else { NO_BITMAP },
        background_mode: BACKGROUND_BACKPLATE,
        strength: 1.0,
        rotation_deg: 30.0,
        ..Environment::default()
    };
    if sky {
        scene.environment.kind = EnvKind::Sky;
        scene.environment.sky_model = crate::scene::SkyModel::Classic;
        scene.environment.background_mode = 0;
        scene.environment.sun_azimuth_deg = -60.0;
        scene.environment.sun_elevation_deg = 35.0;
        scene.lights = vec![Light {
            kind: LightKind::Sun,
            direction: -Vec3::new(0.41, -0.71, 0.574),
            color: Rgb::new(1.0, 0.91, 0.83),
            power: 3.0,
            angle_deg: 0.545,
            flags: LIGHT_FLAG_GLOSSY | LIGHT_FLAG_CAMERA,
            ..Light::default()
        }];
    }
    scene
}

/// The E5 sky example under the physical sky of E5c (`render.rs` pins its hash; `rt
/// --write-e5c-example` writes it for `tools/wasm-parity.mjs`): a low sun, 12 degrees up, and a
/// turbidity between two of the table's knots, so the elevation curves and the blend are both in
/// the hash.
pub fn e5c_scene() -> Scene {
    let mut scene = e5_scene(true);
    let e = &mut scene.environment;
    e.sky_model = crate::scene::SkyModel::Physical;
    e.sky_turbidity = 2.5;
    e.sun_azimuth_deg = -60.0;
    e.sun_elevation_deg = 12.0;
    let (se, ce) = crate::fmath::sin_cos(12.0 * crate::fmath::DEG_TO_RAD);
    let (sa, ca) = crate::fmath::sin_cos(-60.0 * crate::fmath::DEG_TO_RAD);
    scene.lights[0].direction = -Vec3::new(ce * ca, ce * sa, se);
    scene.lights[0].color = Rgb::new(1.0, 0.78, 0.6);
    scene
}

/// The E5b-1 parity scene: the E5 scene ([`e5_scene`], HDRI) with caustics, 2048 photons per
/// sample from its light panel through the glass, the chrome, the cut-outs and the thin walls,
/// gathered with a 4-pixel first radius. `rt --write-e5b-example` writes it for
/// `tools/wasm-parity.mjs`.
pub fn e5b_scene() -> Scene {
    let mut scene = e5_scene(false);
    scene.render.caustic_photons = 2048;
    scene.render.caustic_radius = 4.0;
    scene
}

/// The E9 parity scene (`render.rs` pins its hash; `rt --write-e9-example` writes it for
/// `tools/wasm-parity.mjs`): the E5 scene ([`e5_scene`], HDRI) with its big sphere filled with a
/// scattering medium (a warm, slightly forward-scattering wax with an absorption distance, so the
/// extinction differs between channels and the walk's spectral MIS is in the hash) behind a rough
/// boundary, so walks, their reflections back in, their exit vertices with their light samples and
/// the plain crossings all take part; and (E9c) a sphere of dispersive crystal (index 1.56, Abbe
/// number 40) at the front right, so the wavelength a path chooses is in the hash too.
pub fn e9_scene() -> Scene {
    let mut scene = e5_scene(false);
    scene.materials.push(Material {
        kind: crate::scene::MATERIAL_GLASS,
        roughness: 0.0,
        ior: 1.56,
        transmission: 1.0,
        abbe: 40.0,
        ..Material::default()
    });
    let mut instances = scene.geometry.instances().to_vec();
    instances.push(Instance::new(
        0,
        Transform::from_rows([
            [0.4, 0.0, 0.0, 200.0],
            [0.0, 0.4, 0.0, -120.0],
            [0.0, 0.0, 0.4, 0.0],
        ]),
        scene.materials.len() as u32 - 1,
    ));
    scene.geometry = Geometry::new(scene.geometry.meshes().to_vec(), instances).unwrap_or_default();
    scene.materials[0] = Material {
        kind: crate::scene::MATERIAL_GLASS,
        base_color: Rgb::new(0.85, 0.7, 0.5),
        roughness: 0.3,
        ior: 1.44,
        transmission: 1.0,
        absorption_mm: 120.0,
        scatter_mm: 4.0,
        scatter_color: Rgb::new(0.995, 0.98, 0.95),
        scatter_g: 0.3,
        ..Material::default()
    };
    scene
}

/// The E11 parity scene: the example with the Blackman–Harris filter and twice the samples on
/// its edges (`rt --write-e11-example`; `tools/wasm-parity.mjs` checks the real module renders
/// rt-core's pinned image of it).
pub fn e11_scene() -> Scene {
    let mut scene = scene();
    scene.render.pixel_filter = crate::pixel_filter::FILTER_BLACKMAN_HARRIS;
    scene.render.edge_supersample = 2;
    scene
}

/// The S4a parity scene: the example at 160 x 120 with three ambient effects, one of each shape:
/// 20 000 motes of dust (spheres, fine enough to be widened to the minimum size on screen, with
/// turbulence and tint variation), 3 000 raindrops (glass capsules slanted by the wind) and 2 000
/// spinning snowflakes (discs, from a palette) that cast no shadow. `render.rs` pins its hash;
/// `rt --write-ambient-example` writes it for `tools/wasm-parity.mjs`.
pub fn ambient_scene() -> Scene {
    use crate::scene::{AmbientParams, MATERIAL_GLASS};
    use rt_sim::{Shape, FLAG_CAMERA, FLAG_REFLECTIONS, FLAG_SHADOW};
    let mut scene = scene();
    scene.render.width = 160;
    scene.render.height = 120;
    let first = scene.materials.len() as u32;
    scene.materials.extend([
        Material {
            base_color: Rgb::splat(0.75),
            roughness: 0.45,
            ..Material::default()
        },
        Material {
            kind: MATERIAL_GLASS,
            base_color: Rgb::WHITE,
            roughness: 0.0,
            ior: 1.33,
            transmission: 1.0,
            ..Material::default()
        },
        Material {
            base_color: Rgb::splat(0.92),
            roughness: 0.6,
            ..Material::default()
        },
    ]);
    let all = FLAG_CAMERA | FLAG_REFLECTIONS | FLAG_SHADOW;
    let region = AmbientParams {
        region_centre: [0.0, 0.0, 220.0],
        region_half: [450.0, 350.0, 220.0],
        ..AmbientParams::default()
    };
    scene.effects = vec![
        AmbientParams {
            kind: 1,
            seed: 7,
            time: 1.25,
            count: 20_000,
            size_mm: 0.3,
            size_var: 0.5,
            fall_speed: 6.0,
            fall_var: 0.5,
            wind: [15.0, 5.0, 0.0],
            turbulence: [10.0, 120.0, 20.0],
            material_id: first,
            tint_var: 0.4,
            flags: all,
            energy: 20.0,
            ..region
        },
        AmbientParams {
            kind: 3,
            seed: 3,
            time: 1.25,
            count: 3_000,
            size_mm: 1.0,
            size_var: 0.3,
            shape: Shape::Capsule,
            fall_speed: 6_500.0,
            fall_var: 0.2,
            wind: [900.0, 0.0, 0.0],
            material_id: first + 1,
            flags: all,
            streak: 0.01,
            ..region
        },
        AmbientParams {
            kind: 4,
            seed: 5,
            time: 1.25,
            count: 2_000,
            size_mm: 5.0,
            size_var: 0.4,
            shape: Shape::Disc,
            fall_speed: 900.0,
            fall_var: 0.3,
            wind: [120.0, 40.0, 0.0],
            turbulence: [20.0, 150.0, 40.0],
            material_id: first + 2,
            tint_var: 0.2,
            flags: FLAG_CAMERA | FLAG_REFLECTIONS,
            spin: 0.8,
            palette_count: 2,
            palette: [[1.0, 1.0, 1.0], [0.85, 0.9, 1.0], [1.0; 3], [1.0; 3]],
            ..region
        },
    ];
    scene.build_particles(Vec::new());
    scene
}

/// A lens that uses every knob of the enhanced thin lens (O1) at once: seven curved blades, a
/// bright ring, an obstruction, cat's eye, a 1.33× squeeze, shift and tilt, chromatic aberration
/// and swirl (no picture; [`o1_scene`] adds one).
pub fn busy_lens() -> LensParams {
    LensParams {
        blades: 7,
        roundness: 0.3,
        rotation_deg: 10.0,
        profile: crate::optics::pupil::PROFILE_RING_BRIGHT,
        profile_param: 0.6,
        obstruction: 0.2,
        cats_eye: 0.5,
        squeeze: 1.33,
        shift_x_mm: 1.5,
        shift_y_mm: -2.0,
        tilt_deg: 2.0,
        tilt_axis_deg: 15.0,
        ca_amount: 0.7,
        swirl: 0.6,
        field_mm: 21.6,
        ..LensParams::default()
    }
}

/// A `size × size` pupil texture from integer arithmetic only: concentric rings and specks.
pub fn ring_texture(size: u32) -> Vec<u8> {
    let mut out = Vec::with_capacity((size * size) as usize);
    let half = size as i64;
    for j in 0..size as i64 {
        for i in 0..size as i64 {
            let (x, y) = (2 * i + 1 - half, half - 2 * j - 1);
            let r2 = x * x + y * y;
            let ring = (r2 * 7 / (half * half) % 2) == 0;
            let hash = (i as u64)
                .wrapping_mul(0x9e37_79b9_7f4a_7c15)
                .wrapping_add((j as u64).wrapping_mul(0xc2b2_ae3d_27d4_eb4f));
            let speck = (hash >> 59) == 0;
            out.push(if speck {
                40
            } else if ring {
                255
            } else {
                170
            });
        }
    }
    out
}

/// The O1 parity scene (`render.rs` pins its hash; `rt --write-o1-example` writes it for
/// `tools/wasm-parity.mjs`): the example at f/2 focused on the big sphere, with six small lights
/// far behind it that the lens turns into bokeh, seen through [`busy_lens`] with a ring texture
/// on the pupil.
pub fn o1_scene() -> Scene {
    let mut scene = scene();
    scene.render.width = 256;
    scene.render.height = 192;
    scene.camera.fstop = 2.0;
    let size = 48;
    let lens = Lens::new(LensParams {
        mask_kind: crate::optics::MASK_TEXTURE,
        mask_width: size,
        mask_height: size,
        mask: ring_texture(size),
        ..busy_lens()
    })
    .unwrap_or_else(|_| unreachable!("the busy lens is valid"));
    scene.camera.lens = Some(lens);
    add_far_lights(&mut scene);
    scene
}

/// The six small lights far behind the example's parts that [`o1_scene`] and [`o3a_scene`] turn
/// into bokeh (seen by camera rays only).
fn add_far_lights(scene: &mut Scene) {
    let towards = scene.camera.position;
    let (forward, right, up) = scene.camera.basis();
    for k in 0..6 {
        let position = towards
            + forward * 2600.0
            + right * (-450.0 + 180.0 * k as f32)
            + up * (250.0 + 70.0 * (k % 3) as f32);
        scene.lights.push(Light {
            kind: LightKind::Disk,
            position,
            direction: (towards - position).normalize(),
            up: Vec3::new(0.0, 0.0, 1.0),
            size_x: 14.0,
            size_y: 14.0,
            color: Rgb::new(1.0, 0.85 + 0.03 * k as f32, 0.7),
            power: 0.004,
            spread_deg: 180.0,
            angle_deg: 0.0,
            flags: LIGHT_FLAG_CAMERA,
        });
    }
}

/// A stack of three effect filters (O3a): black diffusion 1/2, a six-point star at 15° and a
/// streak of grade 1/2 with its own tint.
pub fn filter_stack() -> [FilterParams; 3] {
    use crate::optics::filters::*;
    [
        FilterParams {
            kind: FILTER_DIFFUSION_BLACK,
            grade: 0.5,
            ..FilterParams::default()
        },
        FilterParams {
            kind: FILTER_STAR,
            grade: 1.0,
            angle_deg: 15.0,
            points: 6,
            ..FilterParams::default()
        },
        FilterParams {
            kind: FILTER_STREAK,
            grade: 0.5,
            ..FilterParams::default()
        },
    ]
}

/// The O3a parity scene (`render.rs` pins its hash; `rt --write-o3a-example` writes it): the
/// example at f/2.8 with the far lights of [`o1_scene`], through a six-blade iris and
/// [`filter_stack`].
pub fn o3a_scene() -> Scene {
    let mut scene = scene();
    scene.render.width = 256;
    scene.render.height = 192;
    scene.camera.fstop = 2.8;
    let lens = Lens::new(LensParams {
        blades: 6,
        filters: filter_stack(),
        ..LensParams::default()
    })
    .unwrap_or_else(|_| unreachable!("the filter stack is valid"));
    scene.camera.lens = Some(lens);
    add_far_lights(&mut scene);
    scene
}

/// The double Gauss of Smith, *Modern Lens Design* (1992) p. 312, as printed in Kolb, Mitchell and
/// Hanrahan (1995) Fig. 1 (`double_gauss_normal` of `src/data/lenses.json`): radius, distance to
/// the next surface, `nd`, `vd`, semi-aperture; the stop is the sixth surface.
pub const DOUBLE_GAUSS: [(f32, f32, f32, f32, f32); 11] = [
    (58.95, 7.52, 1.67, 47.1, 25.2),
    (169.66, 0.24, 1.0, 0.0, 25.2),
    (38.55, 8.05, 1.67, 47.1, 23.0),
    (81.54, 6.55, 1.699, 30.1, 23.0),
    (25.5, 11.41, 1.0, 0.0, 18.0),
    (0.0, 9.0, 1.0, 0.0, 17.1),
    (-28.99, 2.36, 1.603, 38.0, 17.0),
    (81.54, 12.13, 1.658, 57.3, 20.0),
    (-40.77, 0.38, 1.0, 0.0, 20.0),
    (874.13, 6.44, 1.717, 48.0, 20.0),
    (-79.46, 72.228, 1.0, 0.0, 20.0),
];

/// [`DOUBLE_GAUSS`] as the prescription of a traced lens (multi-layer coatings on the air–glass
/// surfaces, unit focus, f/2.03 at its fastest).
pub fn double_gauss() -> crate::optics::traced::Prescription {
    use crate::optics::traced::*;
    let surfaces = DOUBLE_GAUSS
        .iter()
        .enumerate()
        .map(|(i, &(radius, thickness, nd, vd, semi))| {
            let before = if i == 0 { 1.0 } else { DOUBLE_GAUSS[i - 1].2 };
            let air_glass = (before == 1.0) != (nd == 1.0);
            SurfaceSpec {
                kind: if radius == 0.0 {
                    SURFACE_PLANE
                } else {
                    SURFACE_SPHERE
                },
                radius,
                thickness,
                nd,
                vd,
                semi_aperture: semi,
                coating: if air_glass {
                    COATING_MULTI
                } else {
                    COATING_NONE
                },
                conic: 0.0,
                aspheric: [0.0; 4],
            }
        })
        .collect();
    Prescription {
        stop: 5,
        focus_mode: FOCUS_UNIT,
        f_number_min: 2.03,
        magnification: (0.0, 0.0),
        distortion: 0.0,
        vignetting: 0.0,
        spherical: 0.0,
        breathing: 0.0,
        moving: Vec::new(),
        surfaces,
    }
}

/// The O2 parity scene (`render.rs` pins its hash; `rt --write-o2-example` writes it for
/// `tools/wasm-parity.mjs`): the example at f/2.8 through the traced double Gauss with seven
/// curved blades, focused on the big sphere, with the bokeh lights of [`o1_scene`] behind it.
pub fn o2_scene() -> Scene {
    let mut scene = o1_scene();
    scene.camera.fstop = 2.8;
    let lens = Lens::new(LensParams {
        blades: 7,
        roundness: 0.3,
        prescription: Some(double_gauss()),
        ..LensParams::default()
    })
    .unwrap_or_else(|_| unreachable!("the double Gauss is valid"));
    scene.camera.lens = Some(lens);
    scene
        .camera
        .prepare_lens()
        .unwrap_or_else(|_| unreachable!("the double Gauss forms an image"));
    scene
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn icosphere_has_the_expected_topology() {
        for (subdivisions, triangles, vertices) in [(0, 20, 12), (1, 80, 42), (2, 320, 162)] {
            let mesh = icosphere(Vec3::ZERO, 1.0, subdivisions);
            assert_eq!(mesh.triangle_count(), triangles);
            assert_eq!(mesh.vertex_count(), vertices);
            assert!(mesh.has_normals());
            // Euler characteristic of a closed genus-0 surface: V - E + F = 2 with E = 3F / 2.
            assert_eq!(
                vertices as i64 - (3 * triangles as i64) / 2 + triangles as i64,
                2
            );
        }
    }

    #[test]
    fn icosphere_vertices_lie_on_the_sphere_and_faces_point_outwards() {
        let center = Vec3::new(1.0, 2.0, 3.0);
        let mesh = icosphere(center, 5.0, 2);
        for p in (0..mesh.vertex_count()).filter_map(|i| mesh.position(i)) {
            assert!(((p - center).length() - 5.0).abs() < 1.0e-4);
        }
        for i in 0..mesh.triangle_count() {
            let [a, b, c] = mesh.triangle(i).expect("triangle");
            let normal = (b - a).cross(c - a);
            let outward = (a + b + c) / 3.0 - center;
            assert!(normal.dot(outward) > 0.0, "triangle {i} is wound inwards");
        }
    }

    #[test]
    fn example_scene_is_valid_and_round_trips_through_rsb() {
        let scene = scene();
        assert_eq!(scene.triangle_count(), 322);
        assert_eq!(scene.geometry.instances().len(), 3);
        assert_eq!(scene.geometry.instanced_triangle_count(), 642);
        assert_eq!(scene.lights.len(), 1);
        for instance in scene.geometry.instances() {
            assert!((instance.material_id as usize) < scene.materials.len());
            assert!((instance.mesh as usize) < scene.geometry.meshes().len());
        }
        // The small sphere rests on the floor, clear of the big one.
        let small = SMALL_SPHERE.aabb(&scene.geometry.meshes()[0].bounds());
        assert!(small.min.z >= 0.0 && small.min.z < 5.0);
        assert!(small.max.x < -100.0);
        assert_eq!(Scene::from_rsb(&scene.to_rsb()), Ok(scene));
    }

    #[test]
    fn the_ambient_example_has_its_three_effects_and_round_trips() {
        let scene = ambient_scene();
        assert_eq!(scene.effects.len(), 3);
        assert_eq!(scene.geometry.particle_count(), 25_000);
        assert!(scene.geometry.particle_sets()[0].widened());
        assert_eq!(Scene::from_rsb(&scene.to_rsb()).as_ref(), Ok(&scene));
    }

    #[test]
    fn bad_input_gives_an_empty_sphere() {
        assert_eq!(icosphere(Vec3::ZERO, f32::NAN, 1).triangle_count(), 0);
    }
}
