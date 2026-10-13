//! The built-in example scene: an icosphere on a floor, a second, smaller instance of the same
//! sphere, lit by one rectangular light.
//!
//! Used by `rt --example`, by `rt --write-example` and by the tests of every host crate.

use crate::color::Rgb;
use crate::math::Vec3;
use crate::scene::{
    Camera, EnvKind, Environment, Floor, Geometry, Instance, Light, LightKind, Material, Mesh,
    RenderSettings, Scene, Transform, LIGHT_FLAG_CAMERA, LIGHT_FLAG_GLOSSY,
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
        },
        bitmaps: Vec::new(),
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
    fn bad_input_gives_an_empty_sphere() {
        assert_eq!(icosphere(Vec3::ZERO, f32::NAN, 1).triangle_count(), 0);
    }
}
