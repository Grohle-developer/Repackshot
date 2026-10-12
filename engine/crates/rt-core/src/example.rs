//! The built-in example scene: an icosphere on a floor, a second, smaller instance of the same
//! sphere, lit by one rectangular light.
//!
//! Used by `rt --example`, by `rt --write-example` and by the tests of every host crate.

use crate::color::Rgb;
use crate::math::Vec3;
use crate::scene::{
    Camera, EnvKind, Environment, Geometry, Instance, Light, LightKind, Material, Mesh,
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
/// material), one rectangular light above and beside the camera, an 85 mm camera at f/11.
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
            power: 1000.0,
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
        },
        render: RenderSettings {
            width: 512,
            height: 384,
            max_samples: 16,
            seed: 1,
            max_seconds: 0.0,
            exposure_ev: 0.0,
            tonemap: 1,
        },
    }
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
