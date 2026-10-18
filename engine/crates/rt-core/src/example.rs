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
            ..Camera::default()
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
            ies: None,
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
            adaptive: 0,
            noise_threshold: 0.0,
        },
        bitmaps: Vec::new(),
        patterns: Vec::new(),
        effects: Vec::new(),
        section: None,
        images: Vec::new(),
        textures: Vec::new(),
        programs: Vec::new(),
        glass: None,
        textured: false,
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

/// The Q1 parity scene: the E5 scene (the blue glass sphere, the lacquered floor, the metal sphere,
/// the thin glass card and the cut-out card, lit by an HDRI over a background image) cut in two
/// by the plane `x = 0`, whose normal points at the camera's side (the section view removes the
/// right half and caps the cut). Its glass sphere is cut open and refracts through its cap, the
/// thin card is removed, the cut-out card and the other sphere stay. The lacquered floor is the
/// studio ([`crate::geometry::INSTANCE_NO_SECTION`]): the plane does not cut it, so the floor is
/// whole under the cut model and still catches its shadow and the light of its cap.
/// `rt --write-q1-example` writes it for `tools/wasm-parity.mjs`; `render::section_tests` pins
/// its hash.
pub fn q1_scene() -> Scene {
    let mut scene = e5_scene(false);
    let mut instances = scene.geometry.instances().to_vec();
    instances[1].flags |= crate::geometry::INSTANCE_NO_SECTION;
    let meshes = std::mem::take(&mut scene.geometry).into_meshes();
    scene.geometry = Geometry::new(meshes, instances).unwrap_or_default();
    scene.section = crate::geometry::SectionPlane::new(Vec3::new(1.0, 0.0, 0.0), 0.0, true);
    scene.apply_section();
    scene
}

/// The E10 parity scene: the E5b-1 scene ([`e5b_scene`]: glass, chrome, cut-outs and caustics)
/// sampled adaptively ([`crate::adaptive`]) to a noise target of 3 % with at most 48 samples per
/// pixel, its edges with two samples per index (E11). `rt --write-e10-example` writes it for
/// `tools/wasm-parity.mjs --adaptive`; `rt-core` pins its image.
pub fn e10_scene() -> Scene {
    let mut scene = e5b_scene();
    scene.render.adaptive = crate::adaptive::ADAPTIVE_ON;
    scene.render.noise_threshold = 0.03;
    scene.render.max_samples = 48;
    scene.render.edge_supersample = 2;
    scene
}

/// Faces of [`split_box`], in order.
pub const BOX_FACES: [&str; 6] = ["bottom", "top", "front", "back", "left", "right"];

/// The faces `faces` (indices into [`BOX_FACES`]) of the axis-aligned box from `lo` to `hi`: four
/// vertices of its own per face, wound counter-clockwise seen from outside, without vertex normals
/// (flat shading). A CAD box tessellated face by face, its edges mathematically sharp.
pub fn split_box(lo: Vec3, hi: Vec3, faces: &[usize]) -> Mesh {
    let c = |x: usize, y: usize, z: usize| {
        Vec3::new(
            if x == 0 { lo.x } else { hi.x },
            if y == 0 { lo.y } else { hi.y },
            if z == 0 { lo.z } else { hi.z },
        )
    };
    let quads = [
        [c(0, 0, 0), c(0, 1, 0), c(1, 1, 0), c(1, 0, 0)],
        [c(0, 0, 1), c(1, 0, 1), c(1, 1, 1), c(0, 1, 1)],
        [c(0, 0, 0), c(1, 0, 0), c(1, 0, 1), c(0, 0, 1)],
        [c(0, 1, 0), c(0, 1, 1), c(1, 1, 1), c(1, 1, 0)],
        [c(0, 0, 0), c(0, 0, 1), c(0, 1, 1), c(0, 1, 0)],
        [c(1, 0, 0), c(1, 1, 0), c(1, 1, 1), c(1, 0, 1)],
    ];
    let mut p = Vec::new();
    let mut idx = Vec::new();
    for &f in faces {
        let Some(quad) = quads.get(f) else {
            continue;
        };
        let base = p.len() as u32;
        p.extend_from_slice(quad);
        idx.extend_from_slice(&[base, base + 1, base + 2, base, base + 2, base + 3]);
    }
    Mesh::new(&p, &[], &idx, 0).unwrap_or_default()
}

/// A closed cylinder about Z through `(x, y)`, from `z0` to `z1`, of `segments` sides: smooth
/// vertex normals around its side and flat caps, the vertices split along the two rims (a CAD
/// cylinder: a curved face and two planar ones meeting at sharp circular edges).
pub fn cylinder(x: f32, y: f32, radius: f32, z0: f32, z1: f32, segments: u32) -> Mesh {
    let segments = segments.max(3);
    let mut p = Vec::new();
    let mut n = Vec::new();
    let ring = |i: u32| {
        let (s, c) =
            crate::fmath::sin_cos(crate::fmath::TAU * (i % segments) as f32 / segments as f32);
        (c, s)
    };
    let (down, up) = (Vec3::new(0.0, 0.0, -1.0), Vec3::new(0.0, 0.0, 1.0));
    // Cap centres, then per segment: bottom cap rim, top cap rim, side bottom, side top.
    p.extend_from_slice(&[Vec3::new(x, y, z0), Vec3::new(x, y, z1)]);
    n.extend_from_slice(&[down, up]);
    for i in 0..segments {
        let (c, s) = ring(i);
        let (b, t) = (
            Vec3::new(x + radius * c, y + radius * s, z0),
            Vec3::new(x + radius * c, y + radius * s, z1),
        );
        let side = Vec3::new(c, s, 0.0);
        p.extend_from_slice(&[b, t, b, t]);
        n.extend_from_slice(&[down, up, side, side]);
    }
    let mut idx = Vec::new();
    for i in 0..segments {
        let (a, b) = (2 + 4 * i, 2 + 4 * ((i + 1) % segments));
        idx.extend_from_slice(&[0, b, a, 1, a + 1, b + 1]);
        idx.extend_from_slice(&[a + 2, b + 2, b + 3, a + 2, b + 3, a + 3]);
    }
    Mesh::new(&p, &n, &idx, 0).unwrap_or_default()
}

/// The E6 parity scene (`render.rs` pins its hash; `rt --write-e6-example` writes it for
/// `tools/wasm-parity.mjs`): CAD-like parts with sharp edges, every one bevelled, on the floor
/// quad of the example under a key light and the studio dome. A two-tone box (its top face a mesh of its own, in
/// another material, with the same transform: the edge between them is found across the two
/// meshes), drawn from a unit cube with a non-uniform scale; a polished metal cylinder (a curved
/// edge of 48 segments, smooth side normals); a 4 mm ceramic plate, thinner than twice its bevel
/// along its rim. Instances: 0 floor, 1 box, 2 box top, 3 cylinder, 4 plate.
pub fn e6_scene() -> Scene {
    let unit = (Vec3::splat(-0.5), Vec3::splat(0.5));
    let meshes = vec![
        floor_quad(0.0, 900.0, 0),
        split_box(unit.0, unit.1, &[0, 2, 3, 4, 5]),
        split_box(unit.0, unit.1, &[1]),
        cylinder(0.0, 0.0, 32.0, 0.0, 64.0, 48),
        split_box(unit.0, unit.1, &[0, 1, 2, 3, 4, 5]),
    ];
    let scaled = |size: Vec3, at: Vec3| {
        Transform::from_rows([
            [size.x, 0.0, 0.0, at.x],
            [0.0, size.y, 0.0, at.y],
            [0.0, 0.0, size.z, at.z],
        ])
    };
    let box_at = scaled(Vec3::new(110.0, 70.0, 44.0), Vec3::new(-62.0, 18.0, 22.0));
    let instances = vec![
        Instance::new(0, Transform::IDENTITY, 0),
        Instance::new(1, box_at, 1),
        Instance::new(2, box_at, 2),
        Instance::new(3, Transform::translation(Vec3::new(66.0, 40.0, 0.0)), 3),
        Instance::new(
            4,
            scaled(Vec3::new(90.0, 46.0, 4.0), Vec3::new(30.0, -62.0, 2.0)),
            4,
        ),
    ];
    let camera_position = Vec3::new(330.0, -620.0, 300.0);
    let target = Vec3::new(10.0, 6.0, 26.0);
    let light_position = Vec3::new(-260.0, -420.0, 420.0);
    let mut scene = scene();
    scene.camera = Camera {
        position: camera_position,
        target,
        focal_mm: 115.0,
        fstop: 0.0,
        focus_dist: (target - camera_position).length(),
        ..scene.camera
    };
    scene.materials = vec![
        Material {
            base_color: Rgb::new(0.35, 0.35, 0.36),
            roughness: 0.7,
            ..Material::default()
        },
        Material {
            base_color: Rgb::new(0.85, 0.42, 0.2),
            roughness: 0.3,
            bevel_mm: 3.0,
            ..Material::default()
        },
        Material {
            base_color: Rgb::new(0.12, 0.12, 0.13),
            roughness: 0.2,
            bevel_mm: 3.0,
            ..Material::default()
        },
        Material {
            base_color: Rgb::new(0.9, 0.9, 0.92),
            metallic: 1.0,
            roughness: 0.12,
            bevel_mm: 2.0,
            ..Material::default()
        },
        Material {
            base_color: Rgb::new(0.82, 0.82, 0.8),
            roughness: 0.15,
            coat: 0.5,
            bevel_mm: 2.5,
            ..Material::default()
        },
    ];
    scene.geometry = Geometry::new(meshes, instances).unwrap_or_default();
    scene.lights[0].position = light_position;
    scene.lights[0].direction = (target - light_position).normalize();
    scene.lights[0].size_x = 250.0;
    scene.lights[0].size_y = 120.0;
    scene.lights[0].power = 4.0;
    scene.render.width = 160;
    scene.render.height = 120;
    scene
}

/// The E6 pattern scene (`render.rs` pins its hash; `rt --write-e6-patterns-example` writes it
/// for `tools/wasm-parity.mjs`): an oak board (a box with a 1 mm bevel, its pores and rings) and a
/// walnut sphere on the example's floor, under the example's key light. Instances: 0 floor, 1
/// board, 2 sphere.
pub fn e6_patterns_scene() -> Scene {
    use crate::pattern::{Pattern, PATTERN_WOOD};
    let mut scene = e6_scene();
    let meshes = vec![
        floor_quad(0.0, 900.0, 0),
        split_box(
            Vec3::new(-110.0, -40.0, 0.0),
            Vec3::new(50.0, 30.0, 18.0),
            &[0, 1, 2, 3, 4, 5],
        ),
        icosphere(Vec3::new(80.0, 20.0, 36.0), 36.0, 4),
    ];
    let instances = vec![
        Instance::new(0, Transform::IDENTITY, 0),
        Instance::new(1, Transform::IDENTITY, 1),
        Instance::new(2, Transform::IDENTITY, 2),
    ];
    scene.geometry = Geometry::new(meshes, instances).unwrap_or_default();
    scene.materials = vec![
        scene.materials[0].clone(),
        Material {
            base_color: Rgb::new(0.456, 0.3, 0.162),
            roughness: 0.4,
            bevel_mm: 1.0,
            ..Material::default()
        },
        Material {
            base_color: Rgb::new(0.236, 0.138, 0.078),
            roughness: 0.36,
            coat: 0.4,
            coat_roughness: 0.05,
            ..Material::default()
        },
    ];
    scene.patterns = vec![
        Pattern {
            material: 1,
            kind: PATTERN_WOOD,
            color_a: Rgb::new(0.56, 0.38, 0.21),
            color_b: Rgb::new(0.3, 0.18, 0.09),
            scale_mm: 3.0,
            // Three knots of 14 mm, so the pinned image covers them too.
            params: [
                0.45, 0.35, 0.25, 0.2, 0.35, 0.3, 0.5, 1.0, 1.0, 0.3, 3.0, 14.0, 0.3, 0.6, 0.0, 0.0,
            ],
            variant: 0,
            seed: 11,
        },
        Pattern {
            material: 2,
            kind: PATTERN_WOOD,
            color_a: Rgb::new(0.3, 0.18, 0.1),
            color_b: Rgb::new(0.14, 0.075, 0.045),
            scale_mm: 3.0,
            params: [
                0.4, 0.5, 0.35, 0.22, 0.35, 0.2, 0.175, 0.0, 1.0, 0.3, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0,
            ],
            variant: 0,
            seed: 0,
        },
    ];
    scene
}

/// The images of the M2b example, made here (no image file in the repository): 0 a red and cream
/// checker (64 × 64, sRGB RGB), 1 a normal map of round bumps (32 × 32, linear RGB), 2 a label
/// (64 × 32, sRGB RGBA: a dark card with rounded corners and two light bands), 3 grey bands (16 ×
/// 16, linear grey), 4 a mask of round holes (32 × 32, linear grey), 5 a warm ring (32 × 32,
/// sRGB RGB), 6 a grey checker (16 × 16, sRGB grey), 7 a gradient (8 × 8, sRGB RGBA).
pub fn m2b_images() -> Vec<crate::texture::TextureImage> {
    use crate::texture::image::{COLOR_LINEAR, COLOR_SRGB};
    use crate::texture::TextureImage;
    let image = |w: u32, h: u32, c: u32, space: u32, f: &dyn Fn(u32, u32) -> Vec<u8>| {
        let data: Vec<u8> = (0..h)
            .flat_map(|y| (0..w).flat_map(move |x| f(x, y)))
            .collect();
        TextureImage::new(w, h, c, space, data).expect("a valid example image")
    };
    // Distance from the centre of an 8 × 8 cell, 0 at its centre, 1 at its edge.
    let cell = |x: u32, y: u32, n: u32| -> (f32, f32) {
        let fx = ((x % n) as f32 + 0.5) / n as f32 * 2.0 - 1.0;
        let fy = ((y % n) as f32 + 0.5) / n as f32 * 2.0 - 1.0;
        (fx, fy)
    };
    vec![
        image(64, 64, 3, COLOR_SRGB, &|x, y| {
            if ((x / 8) + (y / 8)) % 2 == 0 {
                vec![200, 40, 30]
            } else {
                vec![235, 225, 200]
            }
        }),
        image(32, 32, 3, COLOR_LINEAR, &|x, y| {
            let (fx, fy) = cell(x, y, 8);
            let r2 = fx * fx + fy * fy;
            let (nx, ny) = if r2 < 0.8 {
                (fx * 0.6, -fy * 0.6)
            } else {
                (0.0, 0.0)
            };
            let nz = (1.0 - nx * nx - ny * ny).max(0.0).sqrt();
            let b = |v: f32| ((v * 0.5 + 0.5) * 255.0).round() as u8;
            vec![b(nx), b(ny), b(nz)]
        }),
        image(64, 32, 4, COLOR_SRGB, &|x, y| {
            let (dx, dy) = (
                (x as f32 + 0.5 - 32.0).abs() - 26.0,
                (y as f32 + 0.5 - 16.0).abs() - 10.0,
            );
            let outside = (dx.max(0.0) * dx.max(0.0) + dy.max(0.0) * dy.max(0.0)).sqrt();
            let alpha = (255.0 * (6.0 - outside).clamp(0.0, 1.0)) as u8;
            let band = (10..14).contains(&y) || (19..22).contains(&y);
            if band && (8..56).contains(&x) {
                vec![240, 236, 220, alpha]
            } else {
                vec![30, 40, 70, alpha]
            }
        }),
        image(16, 16, 1, COLOR_LINEAR, &|x, _| {
            vec![if (x / 4) % 2 == 0 { 60 } else { 230 }]
        }),
        image(32, 32, 1, COLOR_LINEAR, &|x, y| {
            let (fx, fy) = cell(x, y, 16);
            vec![if fx * fx + fy * fy < 0.35 { 0 } else { 255 }]
        }),
        image(32, 32, 3, COLOR_SRGB, &|x, y| {
            let (fx, fy) = cell(x, y, 32);
            let r = (fx * fx + fy * fy).sqrt();
            if (0.55..0.8).contains(&r) {
                vec![255, 170, 60]
            } else {
                vec![0, 0, 0]
            }
        }),
        image(16, 16, 1, COLOR_SRGB, &|x, y| {
            vec![if ((x / 2) + (y / 2)) % 2 == 0 {
                90
            } else {
                170
            }]
        }),
        image(8, 8, 4, COLOR_SRGB, &|x, y| {
            vec![(x * 36) as u8, (y * 36) as u8, 255 - (x * 30) as u8, 255]
        }),
    ]
}

/// The M2b texture scene (`render.rs` pins its hash; `rt --write-m2b-example` writes it for
/// `tools/wasm-parity.mjs`): the E6 floor, camera and key light with every kind of texture read.
/// The floor with a grey checker by a planar projection (minified far off: its mipmaps); a box
/// turned 20° about Z with a box-projected checker, a box-projected normal map of bumps and a
/// label on its front with a paper edge; a ball with a spherical checker, roughness from grey
/// bands (luminance, inverted) and metal from them; a bottle with cylindrical bands (mirrored)
/// and a label wrapped on its front within its reach; a card behind them, turned to the camera
/// (UVs, the second set for its emission), with round holes cut out, a warm emission ring and a
/// height map; a small emitter tinted by a gradient image (found by the rays that hit it, not
/// sampled as a light). Instances: 0 floor, 1 box, 2 ball, 3 bottle, 4 card, 5 emitter.
pub fn m2b_scene() -> Scene {
    use crate::texture::{
        Label, MaterialTextures, TextureSlot, AXIS_X, AXIS_Y, AXIS_Z, CHANNEL_LUMINANCE,
        PROJECTION_BOX, PROJECTION_CYLINDRICAL, PROJECTION_PLANAR, PROJECTION_SPHERICAL,
        PROJECTION_UV, SLOT_ALPHA, SLOT_COLOR, SLOT_EMISSION, SLOT_FLAG_CUTOUT, SLOT_FLAG_HEIGHT,
        SLOT_FLAG_INVERT, SLOT_METAL, SLOT_NORMAL, SLOT_ROUGHNESS, WRAP_CLAMP, WRAP_MIRROR,
    };
    let mut scene = e6_scene();
    // The card: 60 mm square in its own plane y = 0, both UV sets (the second turned).
    let card = {
        let p = [
            Vec3::new(-30.0, 0.0, 0.0),
            Vec3::new(30.0, 0.0, 0.0),
            Vec3::new(30.0, 0.0, 60.0),
            Vec3::new(-30.0, 0.0, 60.0),
        ];
        let n = [Vec3::new(0.0, -1.0, 0.0); 4];
        Mesh::new(&p, &n, &[0, 1, 2, 0, 2, 3], 0)
            .and_then(|m| {
                m.with_uvs(vec![
                    vec![[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]],
                    vec![[0.0, 1.0], [0.0, 0.0], [1.0, 0.0], [1.0, 1.0]],
                ])
            })
            .unwrap_or_default()
    };
    let lamp = {
        let p = [
            Vec3::new(-20.0, 0.0, 0.0),
            Vec3::new(20.0, 0.0, 0.0),
            Vec3::new(20.0, 0.0, 24.0),
            Vec3::new(-20.0, 0.0, 24.0),
        ];
        Mesh::new(&p, &[], &[0, 1, 2, 0, 2, 3], 0)
            .and_then(|m| m.with_uvs(vec![vec![[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]]]))
            .unwrap_or_default()
    };
    let meshes = vec![
        floor_quad(0.0, 900.0, 0),
        split_box(
            Vec3::new(-40.0, -30.0, 0.0),
            Vec3::new(40.0, 30.0, 44.0),
            &[0, 1, 2, 3, 4, 5],
        ),
        icosphere(Vec3::ZERO, 32.0, 2),
        cylinder(0.0, 0.0, 22.0, 0.0, 74.0, 48),
        card,
        lamp,
    ];
    let (s20, c20) = crate::fmath::sin_cos(20.0 * crate::fmath::DEG_TO_RAD);
    let (s25, c25) = crate::fmath::sin_cos(25.0 * crate::fmath::DEG_TO_RAD);
    let instances = vec![
        Instance::new(0, Transform::IDENTITY, 0),
        Instance::new(
            1,
            Transform::from_rows([
                [c20, -s20, 0.0, -78.0],
                [s20, c20, 0.0, 30.0],
                [0.0, 0.0, 1.0, 0.0],
            ]),
            1,
        ),
        Instance::new(2, Transform::translation(Vec3::new(74.0, 34.0, 32.0)), 2),
        Instance::new(3, Transform::translation(Vec3::new(22.0, -58.0, 0.0)), 3),
        Instance::new(
            4,
            Transform::from_rows([
                [c25, -s25, 0.0, -10.0],
                [s25, c25, 0.0, 80.0],
                [0.0, 0.0, 1.0, 0.0],
            ]),
            4,
        ),
        Instance::new(5, Transform::translation(Vec3::new(60.0, 140.0, 70.0)), 5),
    ];
    scene.geometry = Geometry::new(meshes, instances).unwrap_or_default();
    scene.materials = vec![
        Material {
            base_color: Rgb::new(0.6, 0.6, 0.62),
            roughness: 0.7,
            ..Material::default()
        },
        Material {
            base_color: Rgb::WHITE,
            roughness: 0.4,
            bevel_mm: 2.0,
            ..Material::default()
        },
        Material {
            base_color: Rgb::new(0.95, 0.95, 0.95),
            roughness: 0.6,
            metallic: 0.8,
            ..Material::default()
        },
        Material {
            base_color: Rgb::new(0.9, 0.92, 0.95),
            roughness: 0.25,
            coat: 0.6,
            coat_roughness: 0.05,
            ..Material::default()
        },
        Material {
            base_color: Rgb::new(0.2, 0.5, 0.8),
            roughness: 0.5,
            ..Material::default()
        },
        Material {
            kind: crate::scene::MATERIAL_EMISSIVE,
            emission: Rgb::WHITE,
            emission_power: 2.0,
            flags: crate::scene::MATERIAL_FLAG_LIGHT,
            ..Material::default()
        },
    ];
    scene.images = m2b_images().into_iter().map(std::sync::Arc::new).collect();
    let slot = |image: u32, projection: u32, size_mm: f32| TextureSlot {
        image: Some(image),
        projection,
        size_mm,
        ..TextureSlot::default()
    };
    let with = |slots: &[(usize, TextureSlot)], labels: Vec<Label>| {
        let mut t = MaterialTextures {
            labels,
            ..MaterialTextures::default()
        };
        for &(k, s) in slots {
            t.slots[k] = s;
        }
        t
    };
    let label = |origin: Vec3, width: f32, depth: f32, relief: f32| Label {
        image: Some(2),
        origin,
        u: Vec3::new(1.0, 0.0, 0.0),
        v: Vec3::new(0.0, 0.0, 1.0),
        normal: Vec3::new(0.0, -1.0, 0.0),
        width_mm: width,
        height_mm: width / 2.0,
        depth_mm: depth,
        roughness: 0.6,
        coat: 0.3,
        relief,
    };
    let floor = with(
        &[(
            SLOT_COLOR,
            TextureSlot {
                axis: AXIS_Z,
                ..slot(6, PROJECTION_PLANAR, 160.0)
            },
        )],
        Vec::new(),
    );
    let boxed = with(
        &[
            (
                SLOT_COLOR,
                TextureSlot {
                    rotation_deg: 10.0,
                    ..slot(0, PROJECTION_BOX, 48.0)
                },
            ),
            (
                SLOT_NORMAL,
                TextureSlot {
                    strength: 0.8,
                    ..slot(1, PROJECTION_BOX, 24.0)
                },
            ),
        ],
        vec![label(Vec3::new(0.0, -30.0, 22.0), 50.0, 4.0, 1.0)],
    );
    let ball = with(
        &[
            (
                SLOT_COLOR,
                TextureSlot {
                    axis: AXIS_Z,
                    repeat: [2.0, 2.0],
                    ..slot(0, PROJECTION_SPHERICAL, 100.0)
                },
            ),
            (
                SLOT_ROUGHNESS,
                TextureSlot {
                    channel: CHANNEL_LUMINANCE,
                    flags: SLOT_FLAG_INVERT,
                    axis: AXIS_Z,
                    ..slot(3, PROJECTION_SPHERICAL, 100.0)
                },
            ),
            (
                SLOT_METAL,
                TextureSlot {
                    axis: AXIS_Z,
                    ..slot(3, PROJECTION_SPHERICAL, 100.0)
                },
            ),
        ],
        Vec::new(),
    );
    let bottle = with(
        &[(
            SLOT_COLOR,
            TextureSlot {
                axis: AXIS_Z,
                offset: [0.25, 0.0],
                repeat: [3.0, 1.0],
                wrap: WRAP_MIRROR,
                ..slot(3, PROJECTION_CYLINDRICAL, 138.2)
            },
        )],
        vec![label(Vec3::new(0.0, -22.0, 36.0), 34.0, 12.0, 0.5)],
    );
    let card = with(
        &[
            (
                SLOT_ALPHA,
                TextureSlot {
                    flags: SLOT_FLAG_CUTOUT,
                    cutoff: 0.5,
                    ..slot(4, PROJECTION_UV, 100.0)
                },
            ),
            (
                SLOT_EMISSION,
                TextureSlot {
                    uv_set: 1,
                    strength: 3.0,
                    wrap: WRAP_CLAMP,
                    ..slot(5, PROJECTION_UV, 100.0)
                },
            ),
            (
                SLOT_NORMAL,
                TextureSlot {
                    flags: SLOT_FLAG_HEIGHT,
                    strength: 1.5,
                    axis: AXIS_Y,
                    ..slot(3, PROJECTION_PLANAR, 30.0)
                },
            ),
        ],
        Vec::new(),
    );
    let lamp_t = with(
        &[(
            SLOT_COLOR,
            TextureSlot {
                axis: AXIS_X,
                ..slot(7, PROJECTION_UV, 100.0)
            },
        )],
        Vec::new(),
    );
    let mut card = card;
    card.emission_tint = Rgb::new(1.0, 0.9, 0.8);
    scene.textures = vec![
        Some(floor),
        Some(boxed),
        Some(ball),
        Some(bottle),
        Some(card),
        Some(lamp_t),
    ];
    scene.render.width = 160;
    scene.render.height = 120;
    scene
}

/// The material programs of the M3b example, by material: 0 marble on the floor (the part's 3D
/// coordinates through a noise, a sine, a power and a colour ramp, under a coat), 1 checks by a
/// box projection with its edges worn lighter by the curvature (bevel weight 0.5), 2 leather (a
/// bump of three evaluations of a simplex noise's height, a mottled colour), 3 a label by a
/// cylindrical projection of an image with alpha over blue plastic (its bevel weight computed from
/// a noise), 4 a card cut out in bands by stripes on its UVs with a normal map of flakes from a
/// colour noise, 5 an emitter whose colour is a checker on its UVs (not sampled as a light), 6 a
/// thin glass pane dusted where it turns from the view (facing, Fresnel, a smooth step).
pub fn m3b_programs() -> Vec<crate::program::Program> {
    use crate::program::build::{Builder, I, N, P, T, UV0};
    use crate::program::{
        op, NONE, OUT_BASE_COLOR, OUT_BEVEL, OUT_COAT, OUT_COAT_ROUGHNESS, OUT_EMISSION,
        OUT_EMISSION_STRENGTH, OUT_IOR, OUT_METALLIC, OUT_NORMAL, OUT_OPACITY, OUT_ROUGHNESS,
        OUT_TRANSMISSION,
    };
    let mut out = Vec::new();
    // 0 Marble.
    let mut b = Builder::new();
    let m = b.map(5.0, 2.0, 400.0, 30.0, [1.0, 1.0], [0.0, 0.0]);
    let n = b.noise(m, 2.5, false, 5.0, 0.0);
    let x = b.f(op::VX, m, NONE, NONE, NONE);
    let five = b.fconst(5.0);
    let x5 = b.f(op::FMUL, x, five, NONE, NONE);
    let seven = b.fconst(7.0);
    let phase = b.f(op::FMADD, n, seven, x5, NONE);
    let s = b.f(op::FSIN, phase, NONE, NONE, NONE);
    let a = b.f(op::FABS, s, NONE, NONE, NONE);
    let e = b.fconst(0.55);
    let pw = b.f(op::FPOW, a, e, NONE, NONE);
    let col = b.ramp(
        pw,
        0.0,
        &[
            (0.0, [0.1, 0.1, 0.11]),
            (0.35, [0.5, 0.49, 0.48]),
            (1.0, [0.88, 0.87, 0.85]),
        ],
    );
    b.out(OUT_BASE_COLOR, col, true);
    b.out_const(OUT_ROUGHNESS, &[0.15]);
    b.out_const(OUT_COAT, &[0.7]);
    out.push(b.build());
    // 1 Checks, worn at the edges.
    let mut b = Builder::new();
    let m = b.map(2.0, 2.0, 80.0, 10.0, [1.0, 1.0], [0.0, 0.0]);
    let four = b.fconst(4.0);
    let chk = b.f(op::CHECK, m, four, NONE, NONE);
    let c1 = b.vconst([0.82, 0.82, 0.8]);
    let c2 = b.vconst([0.05, 0.06, 0.1]);
    let base = b.v(op::VLERP, c1, c2, chk, NONE);
    let r = b.konst(&[4.0]);
    let edge = b.f(op::EDGE, NONE, NONE, NONE, r);
    let worn = b.vconst([0.9, 0.75, 0.5]);
    let col = b.v(op::VLERP, base, worn, edge, NONE);
    let k = b.fconst(-0.3);
    let r0 = b.fconst(0.45);
    let rough = b.f(op::FMADD, edge, k, r0, NONE);
    b.out(OUT_BASE_COLOR, col, true);
    b.out(OUT_ROUGHNESS, rough, false);
    b.out_const(OUT_COAT, &[0.3]);
    b.out_const(OUT_BEVEL, &[0.5]);
    out.push(b.build());
    // 2 Leather: the height at the point and a hundredth of a millimetre along T and B.
    let mut b = Builder::new();
    let height = |b: &mut Builder, at: u32| -> u32 {
        let k = b.fconst(0.01);
        let obj = b.v(op::VSCALE, at, k, NONE, NONE);
        let g = b.noise(obj, 90.0, true, 3.0, 0.0);
        let e = b.fconst(1.8);
        b.f(op::FPOW, g, e, NONE, NONE)
    };
    let h0 = height(&mut b, P);
    let step = b.fconst(0.01);
    let stepped = |b: &mut Builder, along: u32| -> u32 {
        let d = b.v(op::VSCALE, along, step, NONE, NONE);
        let at = b.v(op::VADD, P, d, NONE, NONE);
        let h = height(b, at);
        let dh = b.f(op::FSUB, h, h0, NONE, NONE);
        let scale = b.fconst(12.0);
        b.f(op::FMUL, dh, scale, NONE, NONE)
    };
    let dt = stepped(&mut b, T);
    let db = stepped(&mut b, crate::program::build::B);
    let normal = b.v(op::BUMP, N, dt, db, NONE);
    let k = b.fconst(0.01);
    let obj = b.v(op::VSCALE, P, k, NONE, NONE);
    let mottle = b.noise(obj, 6.0, false, 4.0, 0.0);
    let col = b.ramp(
        mottle,
        1.0,
        &[(0.3, [0.07, 0.035, 0.018]), (0.7, [0.2, 0.1, 0.05])],
    );
    let k = b.fconst(0.3);
    let r0 = b.fconst(0.42);
    let rough = b.f(op::FMADD, h0, k, r0, NONE);
    b.out(OUT_BASE_COLOR, col, true);
    b.out(OUT_ROUGHNESS, rough, false);
    b.out(OUT_NORMAL, normal, true);
    b.out_const(OUT_COAT, &[0.08]);
    b.out_const(OUT_COAT_ROUGHNESS, &[0.3]);
    out.push(b.build());
    // 3 A label on blue plastic, its bevel weighed by a noise.
    let mut b = Builder::new();
    let m = b.map(3.0, 2.0, 40.0, 0.0, [3.0, 1.0], [0.0, -0.4]);
    let entry = b.image(Some(2), true, crate::texture::WRAP_CLAMP);
    let (rgb, alpha) = b.tex(entry, m);
    let blue = b.vconst([0.012, 0.06, 0.28]);
    let base = b.v(op::BLEND, blue, rgb, alpha, 0);
    let lo = b.fconst(0.16);
    let hi = b.fconst(0.55);
    let rough = b.f(op::FLERP, lo, hi, alpha, NONE);
    let k = b.fconst(-0.5);
    let half = b.fconst(0.5);
    let coat = b.f(op::FMADD, alpha, k, half, NONE);
    let k = b.fconst(0.05);
    let obj = b.v(op::VSCALE, P, k, NONE, NONE);
    let w = b.noise(obj, 1.0, false, 2.0, 5.0);
    b.out(OUT_BASE_COLOR, base, true);
    b.out(OUT_ROUGHNESS, rough, false);
    b.out(OUT_COAT, coat, false);
    b.out(OUT_BEVEL, w, false);
    b.out_const(OUT_COAT_ROUGHNESS, &[0.02]);
    out.push(b.build());
    // 4 A card cut out in bands, with flakes in its normal.
    let mut b = Builder::new();
    let six = b.fconst(6.0);
    let width = b.fconst(0.6);
    let axis = b.konst(&[0.0, 0.0]);
    let band = b.f(op::STRIPE, UV0, six, width, axis);
    let c1 = b.vconst([0.9, 0.3, 0.1]);
    let c2 = b.vconst([0.1, 0.4, 0.9]);
    let col = b.v(op::VLERP, c1, c2, band, NONE);
    let k = b.fconst(0.01);
    let obj = b.v(op::VSCALE, P, k, NONE, NONE);
    let s = b.fconst(300.0);
    let nk = b.konst(&[0.0, 1.0, 2.0, 0.5, 9.0]);
    let flakes = b.v(op::NOISEC, obj, s, NONE, nk);
    let strength = b.fconst(0.35);
    let normal = b.v(op::NMAP, flakes, strength, N, 0);
    b.out(OUT_BASE_COLOR, col, true);
    b.out(OUT_OPACITY, band, false);
    b.out(OUT_NORMAL, normal, true);
    b.out_const(OUT_METALLIC, &[0.3]);
    b.out_const(OUT_ROUGHNESS, &[0.35]);
    out.push(b.build());
    // 5 An emitter checked on its UVs.
    let mut b = Builder::new();
    let four = b.fconst(4.0);
    let chk = b.f(op::CHECK, UV0, four, NONE, NONE);
    let warm = b.vconst([1.0, 0.7, 0.4]);
    let cool = b.vconst([0.3, 0.5, 1.0]);
    let col = b.v(op::VLERP, warm, cool, chk, NONE);
    b.out(OUT_EMISSION, col, true);
    b.out_const(OUT_EMISSION_STRENGTH, &[3.0]);
    out.push(b.build());
    // 6 A thin glass pane, dusty where it turns from the view.
    let mut b = Builder::new();
    let blend = b.fconst(0.35);
    let facing = b.f(op::FACING, blend, N, I, NONE);
    let k = b.fconst(0.01);
    let obj = b.v(op::VSCALE, P, k, NONE, NONE);
    let noise = b.noise(obj, 8.0, false, 5.0, 0.0);
    let e0 = b.fconst(0.45);
    let e1 = b.fconst(0.7);
    let patch = b.f(op::FSSTEP, noise, e0, e1, NONE);
    let dirt = b.f(op::FMUL, facing, patch, NONE, NONE);
    let clear = b.vconst([0.97, 0.98, 0.98]);
    let dust = b.vconst([0.42, 0.37, 0.3]);
    let base = b.v(op::BLEND, clear, dust, dirt, 0);
    let k = b.fconst(-0.75);
    let one = b.fconst(1.0);
    let trans = b.f(op::FMADD, dirt, k, one, NONE);
    let ior = b.fconst(1.52);
    let fres = b.f(op::FRESNEL, ior, N, I, NONE);
    let k = b.fconst(0.3);
    let r0 = b.fconst(0.01);
    let rough = b.f(op::FMADD, fres, k, r0, NONE);
    b.out(OUT_BASE_COLOR, base, true);
    b.out(OUT_TRANSMISSION, trans, false);
    b.out(OUT_ROUGHNESS, rough, false);
    b.out_const(OUT_IOR, &[1.52]);
    b.material(0.0, true);
    out.push(b.build());
    out
}

/// The M3b scene of material programs (`render.rs` pins its hash; `rt --write-m3b-example` writes
/// it for `tools/wasm-parity.mjs`): the M2b floor, box, ball, bottle, card and lamp, each material
/// now a program ([`m3b_programs`]: marble, worn checks, leather, a label, a cut-out card with
/// flakes, a checked emitter) and a thin glass pane in front of the card, with the M2b images.
/// Instances: 0 floor, 1 box, 2 ball, 3 bottle, 4 card, 5 lamp, 6 pane.
pub fn m3b_scene() -> Scene {
    use crate::scene::{
        MATERIAL_EMISSIVE, MATERIAL_FLAG_LIGHT, MATERIAL_FLAG_THIN, MATERIAL_GLASS,
    };
    let mut scene = m2b_scene();
    scene.textures.clear();
    let pane = {
        let p = [
            Vec3::new(-30.0, 0.0, 0.0),
            Vec3::new(30.0, 0.0, 0.0),
            Vec3::new(30.0, 0.0, 50.0),
            Vec3::new(-30.0, 0.0, 50.0),
        ];
        let n = [Vec3::new(0.0, -1.0, 0.0); 4];
        Mesh::new(&p, &n, &[0, 1, 2, 0, 2, 3], 0).unwrap_or_default()
    };
    let mut meshes = scene.geometry.meshes().to_vec();
    meshes.push(pane);
    let mut instances = scene.geometry.instances().to_vec();
    let (s25, c25) = crate::fmath::sin_cos(-15.0 * crate::fmath::DEG_TO_RAD);
    instances.push(Instance::new(
        6,
        Transform::from_rows([
            [c25, -s25, 0.0, -40.0],
            [s25, c25, 0.0, -10.0],
            [0.0, 0.0, 1.0, 0.0],
        ]),
        6,
    ));
    scene.geometry = Geometry::new(meshes, instances).unwrap_or_default();
    scene.materials = vec![
        Material {
            base_color: Rgb::new(0.6, 0.6, 0.6),
            roughness: 0.15,
            coat: 0.7,
            ..Material::default()
        },
        Material {
            base_color: Rgb::new(0.5, 0.5, 0.5),
            roughness: 0.4,
            coat: 0.3,
            bevel_mm: 3.0,
            ..Material::default()
        },
        Material {
            base_color: Rgb::new(0.12, 0.06, 0.03),
            roughness: 0.6,
            coat: 0.08,
            coat_roughness: 0.3,
            ..Material::default()
        },
        Material {
            base_color: Rgb::new(0.1, 0.12, 0.3),
            roughness: 0.3,
            coat: 0.4,
            coat_roughness: 0.02,
            bevel_mm: 2.0,
            ..Material::default()
        },
        Material {
            base_color: Rgb::new(0.5, 0.35, 0.5),
            metallic: 0.3,
            roughness: 0.35,
            opacity: 0.6,
            ..Material::default()
        },
        Material {
            kind: MATERIAL_EMISSIVE,
            emission: Rgb::new(0.65, 0.6, 0.7),
            emission_power: 3.0,
            flags: MATERIAL_FLAG_LIGHT,
            ..Material::default()
        },
        Material {
            kind: MATERIAL_GLASS,
            base_color: Rgb::new(0.9, 0.9, 0.88),
            roughness: 0.05,
            ior: 1.52,
            transmission: 0.95,
            flags: MATERIAL_FLAG_THIN,
            ..Material::default()
        },
    ];
    scene.programs = m3b_programs()
        .into_iter()
        .map(|p| Some(std::sync::Arc::new(p)))
        .collect();
    scene
}

/// The E6 cloth scene (`render.rs` pins its hash; `rt --write-e6-cloth-example` writes it for
/// `tools/wasm-parity.mjs`): a denim cushion (a box with a 4 mm bevel, its 3/1 twill at 1.2 mm
/// so that a small image sees it) and a chunky knit ball (2 mm stitches) on the example's floor,
/// under the example's key light. Instances: 0 floor, 1 cushion, 2 ball.
pub fn e6_cloth_scene() -> Scene {
    use crate::pattern::{Pattern, PARAMS, PATTERN_CLOTH};
    let mut scene = e6_scene();
    let meshes = vec![
        floor_quad(0.0, 900.0, 0),
        split_box(
            Vec3::new(-110.0, -45.0, 0.0),
            Vec3::new(30.0, 45.0, 26.0),
            &[0, 1, 2, 3, 4, 5],
        ),
        icosphere(Vec3::new(80.0, 15.0, 36.0), 36.0, 4),
    ];
    let instances = vec![
        Instance::new(0, Transform::IDENTITY, 0),
        Instance::new(1, Transform::IDENTITY, 1),
        Instance::new(2, Transform::IDENTITY, 2),
    ];
    scene.geometry = Geometry::new(meshes, instances).unwrap_or_default();
    scene.materials = vec![
        scene.materials[0].clone(),
        Material {
            base_color: Rgb::new(0.38, 0.41, 0.47),
            roughness: 0.78,
            bevel_mm: 4.0,
            ..Material::default()
        },
        Material {
            base_color: Rgb::new(0.5, 0.38, 0.27),
            roughness: 0.85,
            ..Material::default()
        },
    ];
    // The relief, and a twisted yarn.
    let relief = |r: f32| {
        let mut p = [0.0; PARAMS];
        (p[0], p[1]) = (r, 1.0);
        p
    };
    scene.patterns = vec![
        Pattern {
            material: 1,
            kind: PATTERN_CLOTH,
            color_a: Rgb::new(0.1, 0.16, 0.3),
            color_b: Rgb::new(0.66, 0.66, 0.64),
            scale_mm: 1.2,
            params: relief(0.6),
            variant: 6,
            seed: 0,
        },
        Pattern {
            material: 2,
            kind: PATTERN_CLOTH,
            color_a: Rgb::new(0.55, 0.42, 0.3),
            color_b: Rgb::new(0.44, 0.33, 0.22),
            scale_mm: 2.0,
            params: relief(0.8),
            variant: 4,
            seed: 0,
        },
    ];
    scene
}

/// M3c: `scene` with every patterned material drawn by the program a graph of its pattern node
/// gives instead of its `PATN` ([`crate::program::build::Builder::pattern_material`]: the node's
/// colour, roughness and normal into the output, the material's own values elsewhere).
pub(crate) fn as_pattern_nodes(mut scene: Scene) -> Scene {
    let patterns = std::mem::take(&mut scene.patterns);
    let mut programs: Vec<Option<std::sync::Arc<crate::program::Program>>> =
        vec![None; scene.materials.len()];
    for p in &patterns {
        let i = p.material as usize;
        if i < programs.len() && programs[i].is_none() {
            programs[i] = Some(std::sync::Arc::new(
                crate::program::build::Builder::pattern_material(p, &scene.materials[i]),
            ));
        }
    }
    scene.programs = programs;
    scene
}

/// The M3c wood scene (`render.rs` pins its hash; `rt --write-m3c-wood-example` writes it for
/// `tools/wasm-parity.mjs`): the E6 pattern scene ([`e6_patterns_scene`]) with the oak board and
/// the walnut sphere drawn by `WOOD` nodes. The same picture as the E6 scene, bit for bit.
pub fn m3c_wood_scene() -> Scene {
    as_pattern_nodes(e6_patterns_scene())
}

/// The M3c cloth scene (`render.rs` pins its hash; `rt --write-m3c-cloth-example` writes it):
/// the E6 cloth scene ([`e6_cloth_scene`]) with the denim cushion and the knit ball drawn by
/// `CLOTH` nodes. Not the E6 picture bit for bit: inside the cushion's 4 mm bevel the node's box
/// projection follows the bevelled normal (its `normal` input), the material's the unbevelled one.
pub fn m3c_cloth_scene() -> Scene {
    as_pattern_nodes(e6_cloth_scene())
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

/// The first hand-written IES test profile (L5): a downlight of 1000 cd on its axis that falls as
/// `cos²`, the same around its axis (`tests/fixtures/ies/downlight-symmetric.ies`; the page's tests
/// read the file too). Typed by hand, not a measurement of any luminaire.
pub const IES_DOWNLIGHT: &str =
    include_str!("../../../../tests/fixtures/ies/downlight-symmetric.ies");

/// The second hand-written IES test profile (L5): a wall washer of 900 cd on its axis, different on
/// each of the four sides, with all 360 degrees of its horizontal angle given
/// (`tests/fixtures/ies/wall-washer.ies`).
pub const IES_WALL_WASHER: &str = include_str!("../../../../tests/fixtures/ies/wall-washer.ies");

/// The L5 parity scene: the example at 160 x 120 lit by its rectangular panel at a fifth of its
/// power and two IES lights: the downlight profile, a sphere of 24 mm above and in front of the big
/// sphere (sampled over its cone, MIS with the BSDF rays), and the wall-washer profile as a warm
/// point on the left, turned about its axis so that its horizontal angles do not line up with the
/// world. `render.rs` pins its hash; `rt --write-l5-example` writes it for `tools/wasm-parity.mjs`.
pub fn l5_scene() -> Scene {
    use crate::ies::IesProfile;
    use std::sync::Arc;
    let profile = |text: &str| {
        Arc::new(IesProfile::parse(text.as_bytes()).expect("the test profiles are valid"))
    };
    let mut scene = scene();
    scene.render.width = 160;
    scene.render.height = 120;
    scene.lights[0].power = 1.0;
    let above = Vec3::new(0.0, -250.0, 760.0);
    let washer = Vec3::new(-620.0, -180.0, 380.0);
    scene.lights.push(Light {
        kind: LightKind::Ies,
        position: above,
        direction: (Vec3::new(0.0, 0.0, 100.0) - above).normalize(),
        up: Vec3::new(0.0, 1.0, 0.0),
        size_x: 24.0,
        size_y: 24.0,
        color: Rgb::WHITE,
        power: 18.0,
        spread_deg: 180.0,
        angle_deg: 0.0,
        flags: LIGHT_FLAG_GLOSSY | LIGHT_FLAG_CAMERA,
        ies: Some(profile(IES_DOWNLIGHT)),
    });
    scene.lights.push(Light {
        kind: LightKind::Ies,
        position: washer,
        direction: (Vec3::new(-330.0, 120.0, 60.0) - washer).normalize(),
        up: Vec3::new(0.35, -0.2, 0.9),
        size_x: 0.0,
        size_y: 0.0,
        color: Rgb::new(1.0, 0.82, 0.62),
        power: 7.0,
        spread_deg: 180.0,
        angle_deg: 0.0,
        flags: LIGHT_FLAG_GLOSSY,
        ies: Some(profile(IES_WALL_WASHER)),
    });
    scene
}

/// The S4a parity scene: the example at 160 x 120 with three ambient effects, one of each shape:
/// 20 000 motes of dust (spheres, fine enough to be widened to the minimum size on screen, with
/// turbulence, tint variation and, since S4b, the forward lobe of the dust preset), 3 000
/// raindrops (glass capsules slanted by the wind, which shadow rays and the rays after a rough
/// vertex cross straight, S4b) and 2 000 spinning snowflakes (discs, from a palette) that cast no
/// shadow. `render.rs` pins its hash; `rt --write-ambient-example` writes it for
/// `tools/wasm-parity.mjs`.
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
            forward: 0.5,
            forward_g: 0.7,
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

/// The S3 parity scene of the drops: the example at 160 x 120 with two ambient effects, 2 500
/// falling drops of water (the drop shape, clear and smooth: the camera sees them refract, shadow
/// rays and rough paths cross them straight, their lengths varying by 40 %) and 3 000 opaque
/// particles that mix the four shapes (spheres, flakes, streaks and drops in 1 : 1 : 1 : 2, with a
/// palette and tint variation, casting shadows). `render/s3_tests.rs` pins its image, its particles
/// and their shapes; `rt --write-s3-drops-example` writes it for `tools/wasm-parity.mjs`.
pub fn s3_drops_scene() -> Scene {
    use crate::scene::{AmbientParams, MATERIAL_GLASS};
    use rt_sim::{Shape, FLAG_CAMERA, FLAG_REFLECTIONS, FLAG_SHADOW};
    let mut scene = scene();
    scene.render.width = 160;
    scene.render.height = 120;
    let first = scene.materials.len() as u32;
    scene.materials.extend([
        Material {
            kind: MATERIAL_GLASS,
            base_color: Rgb::WHITE,
            roughness: 0.0,
            ior: 1.33,
            transmission: 1.0,
            ..Material::default()
        },
        Material {
            base_color: Rgb::splat(0.8),
            roughness: 0.5,
            ..Material::default()
        },
    ]);
    let all = FLAG_CAMERA | FLAG_REFLECTIONS | FLAG_SHADOW;
    let region = AmbientParams {
        region_centre: [0.0, 0.0, 200.0],
        region_half: [400.0, 300.0, 200.0],
        ..AmbientParams::default()
    };
    scene.effects = vec![
        AmbientParams {
            kind: 3,
            seed: 13,
            time: 0.75,
            count: 2_500,
            size_mm: 3.0,
            size_var: 0.5,
            shape: Shape::Drop,
            fall_speed: 4_000.0,
            fall_var: 0.2,
            wind: [600.0, 0.0, 0.0],
            material_id: first,
            flags: all,
            shape_var: 0.4,
            ..region
        },
        AmbientParams {
            kind: 8,
            seed: 21,
            time: 0.75,
            count: 3_000,
            size_mm: 6.0,
            size_var: 0.4,
            shape: Shape::Drop,
            fall_speed: 800.0,
            fall_var: 0.4,
            wind: [150.0, 60.0, 0.0],
            turbulence: [15.0, 150.0, 40.0],
            material_id: first + 1,
            tint_var: 0.2,
            flags: all,
            streak: 0.01,
            spin: 1.0,
            palette_count: 3,
            palette: [[0.9, 0.2, 0.2], [0.2, 0.5, 0.9], [0.95, 0.8, 0.2], [1.0; 3]],
            mix: [1.0, 1.0, 1.0, 2.0],
            drop_tail: 2.0,
            drop_tip: 0.2,
            shape_var: 0.3,
            ..region
        },
    ];
    scene.build_particles(Vec::new());
    scene
}

/// The front glass of the S3 parity scene: a third of the pane under drops of 2 mm (± 60 %) at 60°,
/// and dust over 3 % of it, motes of 0.4 mm that stop 90 % of a ray.
pub fn wet_glass() -> crate::optics::glass::GlassParams {
    crate::optics::glass::GlassParams {
        seed: 5,
        drop_coverage: 0.35,
        drop_size_mm: 2.0,
        drop_size_var: 0.6,
        contact_angle_deg: 60.0,
        ior: 1.333,
        dust_coverage: 0.03,
        dust_size_mm: 0.4,
        dust_size_var: 0.5,
        dust_opacity: 0.9,
        ..crate::optics::glass::GlassParams::default()
    }
}

/// The S3 parity scene of the front glass: the example at 160 x 120 through a 28 mm lens at f/8
/// (closer, so that the product fills the frame as through the example's 85 mm), focused on the
/// product, with a pane 25 mm in front of the lens that has drops and dust on it ([`wet_glass`]):
/// the drops are soft discs with the scene upside down in them, the motes dark spots. A lens this
/// wide sees a wide patch of the pane through a small aperture, which is when drops on a lens show
/// (behind a long lens wide open they only lower the contrast). `render/s3_tests.rs` pins its
/// image; `rt --write-s3-glass-example` writes it for `tools/wasm-parity.mjs`.
pub fn s3_glass_scene() -> Scene {
    let mut scene = scene();
    scene.render.width = 160;
    scene.render.height = 120;
    let camera = &mut scene.camera;
    let k = 28.0 / camera.focal_mm;
    camera.position = camera.target + (camera.position - camera.target) * k;
    camera.focal_mm = 28.0;
    camera.fstop = 8.0;
    camera.focus_dist = (camera.target - camera.position).length();
    scene.set_glass(Some(wet_glass()));
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
            ies: None,
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

/// The O4 parity scene (`render.rs` pins its hash; `rt --write-o4-example` writes it for
/// `tools/wasm-parity.mjs`): [`o2_scene`] with the traced double Gauss tilted 6° about the
/// horizontal axis (the plane of sharp focus leans back to the floor, through the big sphere) and
/// shifted 3 mm down and 2 mm right.
pub fn o4_scene() -> Scene {
    let mut scene = o2_scene();
    let lens = Lens::new(LensParams {
        blades: 7,
        roundness: 0.3,
        tilt_deg: 6.0,
        tilt_axis_deg: 0.0,
        shift_x_mm: 2.0,
        shift_y_mm: -3.0,
        prescription: Some(double_gauss()),
        ..LensParams::default()
    })
    .unwrap_or_else(|_| unreachable!("the double Gauss is valid"));
    scene.camera.lens = Some(lens);
    scene
        .camera
        .prepare_lens()
        .unwrap_or_else(|_| unreachable!("the tilted double Gauss forms an image"));
    scene
}

/// K3: instance of the ceiling of [`k3_room`] (the one the plan view hides from the camera).
pub const K3_CEILING: usize = 1;
/// K3: instance of the window pane of [`k3_room`] (thin glass, which camera rays cross straight).
pub const K3_WINDOW: usize = 7;

/// The room of the K3 parity scenes (millimetres, Z up), built from boxes the way a test room is
/// before the `ROOM` node of K2: a floor slab and a ceiling slab 100 mm thick over an inside of
/// 4 × 3 m and 2.6 m high, four walls (the front one, at −y, in four pieces around a window
/// 1.6 m wide and 1.2 m high on a 0.8 m sill, with a pane of thin clear glass in it), a sofa-like
/// box, a side table and a ball. It is lit only from inside, by a disc on the floor behind the sofa
/// that shines at the white ceiling (an uplight: the room has the light the ceiling sends back) and,
/// through the window, by the daylight sky. No studio floor (`FLOR` none).
///
/// Instances: 0 floor, 1 ceiling ([`K3_CEILING`]), 2 back wall, 3 left wall, 4 right wall, 5–6 the
/// front wall left and right of the window, 7 the pane ([`K3_WINDOW`]), 8 under the window, 9 over
/// it, 10 sofa, 11 table, 12 ball. The camera is set by [`k3_plan_scene`], [`k3_panorama_scene`] and
/// [`k3_fisheye_scene`].
pub fn k3_room() -> Scene {
    use crate::scene::{MATERIAL_FLAG_THIN, MATERIAL_GLASS};
    let all = [0, 1, 2, 3, 4, 5];
    let slab = |lo: Vec3, hi: Vec3| split_box(lo, hi, &all);
    let (x0, x1, y0, y1, h) = (-2000.0, 2000.0, -1500.0, 1500.0, 2600.0);
    let (t, w0, w1, sill, head) = (100.0, -800.0, 800.0, 800.0, 2000.0);
    let meshes = vec![
        slab(
            Vec3::new(x0 - t, y0 - t, -t),
            Vec3::new(x1 + t, y1 + t, 0.0),
        ),
        slab(
            Vec3::new(x0 - t, y0 - t, h),
            Vec3::new(x1 + t, y1 + t, h + t),
        ),
        slab(Vec3::new(x0 - t, y1, 0.0), Vec3::new(x1 + t, y1 + t, h)),
        slab(Vec3::new(x0 - t, y0 - t, 0.0), Vec3::new(x0, y1, h)),
        slab(Vec3::new(x1, y0 - t, 0.0), Vec3::new(x1 + t, y1, h)),
        slab(Vec3::new(x0, y0 - t, 0.0), Vec3::new(w0, y0, h)),
        slab(Vec3::new(w1, y0 - t, 0.0), Vec3::new(x1, y0, h)),
        // The pane: a single quad facing the room, in the middle of the wall's thickness.
        Mesh::new(
            &[
                Vec3::new(w0, y0 - 0.5 * t, sill),
                Vec3::new(w1, y0 - 0.5 * t, sill),
                Vec3::new(w1, y0 - 0.5 * t, head),
                Vec3::new(w0, y0 - 0.5 * t, head),
            ],
            &[],
            &[0, 1, 2, 0, 2, 3],
            0,
        )
        .unwrap_or_default(),
        slab(Vec3::new(w0, y0 - t, 0.0), Vec3::new(w1, y0, sill)),
        slab(Vec3::new(w0, y0 - t, head), Vec3::new(w1, y0, h)),
        slab(
            Vec3::new(-900.0, 600.0, 0.0),
            Vec3::new(900.0, 1400.0, 700.0),
        ),
        cylinder(1300.0, 900.0, 300.0, 0.0, 550.0, 32),
        icosphere(Vec3::new(-400.0, -300.0, 250.0), 250.0, 2),
    ];
    // Materials: 0 white plaster (walls and ceiling), 1 oak-coloured floor, 2 the pane, 3 the sofa's
    // fabric, 4 the table's lacquer, 5 the ball's satin metal.
    let materials = vec![
        Material {
            base_color: Rgb::new(0.85, 0.84, 0.82),
            roughness: 0.9,
            ..Material::default()
        },
        Material {
            base_color: Rgb::new(0.55, 0.38, 0.24),
            roughness: 0.45,
            coat: 0.6,
            coat_roughness: 0.15,
            ..Material::default()
        },
        Material {
            kind: MATERIAL_GLASS,
            base_color: Rgb::new(0.96, 0.97, 0.98),
            roughness: 0.0,
            transmission: 1.0,
            flags: MATERIAL_FLAG_THIN,
            ..Material::default()
        },
        Material {
            base_color: Rgb::new(0.25, 0.34, 0.5),
            roughness: 0.95,
            ..Material::default()
        },
        Material {
            base_color: Rgb::new(0.12, 0.11, 0.1),
            roughness: 0.2,
            coat: 1.0,
            coat_roughness: 0.05,
            ..Material::default()
        },
        Material {
            base_color: Rgb::new(0.95, 0.75, 0.45),
            metallic: 1.0,
            roughness: 0.3,
            ..Material::default()
        },
    ];
    let material_of = [0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 3, 4, 5];
    let instances = material_of
        .iter()
        .enumerate()
        .map(|(i, &m)| Instance::new(i as u32, Transform::IDENTITY, m))
        .collect();
    let uplight = Vec3::new(0.0, 1450.0, 150.0);
    Scene {
        geometry: Geometry::new(meshes, instances).unwrap_or_default(),
        materials,
        lights: vec![Light {
            kind: LightKind::Disk,
            position: uplight,
            direction: (Vec3::new(0.0, 700.0, h) - uplight).normalize(),
            size_x: 300.0,
            size_y: 300.0,
            color: Rgb::new(1.0, 0.86, 0.7),
            power: 30.0,
            spread_deg: 120.0,
            flags: LIGHT_FLAG_GLOSSY,
            ..Light::default()
        }],
        environment: Environment {
            kind: EnvKind::Sky,
            sun_azimuth_deg: -100.0,
            sun_elevation_deg: 30.0,
            floor: 0.25,
            strength: 0.6,
            ..Environment::default()
        },
        floor: Floor::default(),
        render: RenderSettings {
            width: 96,
            height: 64,
            max_depth: 10,
            ..RenderSettings::default()
        },
        ..Scene::default()
    }
}

/// The K3 plan view: [`k3_room`] from straight above through an orthographic camera 4.6 m wide,
/// its ceiling hidden to the camera ([`crate::geometry::INSTANCE_NO_CAMERA`]) so the picture is the
/// room's floor plan, while the uplight's light still comes back from the ceiling; outside the room
/// the camera sees the sky's ground at half its brightness (`exterior` 0.5). `render::k3_tests`
/// pins it; `rt --write-k3-plan-example` writes it for `tools/wasm-parity.mjs`.
pub fn k3_plan_scene() -> Scene {
    let mut scene = k3_room();
    let mut instances = scene.geometry.instances().to_vec();
    instances[K3_CEILING].flags |= crate::geometry::INSTANCE_NO_CAMERA;
    let meshes = std::mem::take(&mut scene.geometry).into_meshes();
    scene.geometry = Geometry::new(meshes, instances).unwrap_or_default();
    scene.camera = Camera {
        position: Vec3::new(0.0, 0.0, 9000.0),
        target: Vec3::ZERO,
        up: Vec3::new(0.0, 1.0, 0.0),
        ortho: true,
        ortho_width: 4600.0,
        exterior: 0.5,
        ..Camera::default()
    };
    scene.render.width = 96;
    scene.render.height = 72;
    scene
}

/// The K3 panorama: [`k3_room`] seen from inside at eye height (1.5 m) by an equirectangular camera
/// of the whole sphere (360° × 180°, 128 × 64), the window behind it to the left, the sky through
/// the pane at 40 % (`exterior` 0.4). `render::k3_tests` pins it; `rt --write-k3-panorama-example`
/// writes it for `tools/wasm-parity.mjs`.
pub fn k3_panorama_scene() -> Scene {
    use crate::scene::Projection;
    let mut scene = k3_room();
    let eye = Vec3::new(600.0, 300.0, 1500.0);
    scene.camera = Camera {
        position: eye,
        target: eye + Vec3::new(-0.3, 1.0, 0.0),
        up: Vec3::new(0.0, 0.0, 1.0),
        projection: Projection::Equirectangular,
        exterior: 0.4,
        ..Camera::default()
    };
    scene.render.width = 128;
    scene.render.height = 64;
    scene
}

/// The K3 fisheye: [`k3_room`] through an equidistant fisheye of 300° across the width of a
/// 96 × 72 image, from a corner near the ceiling looking down at the room (its corners, more than
/// 180° from the axis, see nothing). `render::k3_tests` pins it; `rt --write-k3-fisheye-example`
/// writes it for `tools/wasm-parity.mjs`.
pub fn k3_fisheye_scene() -> Scene {
    use crate::scene::Projection;
    let mut scene = k3_room();
    let eye = Vec3::new(1600.0, 1100.0, 2300.0);
    scene.camera = Camera {
        position: eye,
        target: Vec3::new(-200.0, -200.0, 400.0),
        up: Vec3::new(0.0, 0.0, 1.0),
        projection: Projection::Fisheye,
        fov_x_deg: 300.0,
        ..Camera::default()
    };
    scene.render.width = 96;
    scene.render.height = 72;
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
