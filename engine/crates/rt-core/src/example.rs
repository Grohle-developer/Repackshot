//! The built-in example scene: an icosphere on a floor, lit by one rectangular light.
//!
//! Used by `rt --example`, by `rt --write-example` and by the tests of every host crate.

use crate::color::Rgb;
use crate::math::Vec3;
use crate::scene::{
    Camera, EnvKind, Environment, Light, LightKind, Material, Mesh, RenderSettings, Scene,
    LIGHT_FLAG_CAMERA, LIGHT_FLAG_GLOSSY,
};
use std::collections::BTreeMap;

/// Builds an icosphere: an icosahedron whose triangles are split `subdivisions` times and whose
/// vertices are pushed onto the sphere. 0 gives 20 triangles, 1 gives 80, 2 gives 320.
/// Normals are the unit radial directions (smooth shading). `material_id` is 0.
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

    Mesh {
        positions: dirs.iter().map(|&d| center + d * radius).collect(),
        normals: dirs,
        indices: faces.into_iter().flatten().collect(),
        material_id: 0,
    }
}

/// A horizontal quad at height `z`, spanning `[-half, half]` on X and Y, facing up.
fn floor_quad(z: f32, half: f32, material_id: u32) -> Mesh {
    Mesh {
        positions: vec![
            Vec3::new(-half, -half, z),
            Vec3::new(half, -half, z),
            Vec3::new(half, half, z),
            Vec3::new(-half, half, z),
        ],
        normals: vec![Vec3::new(0.0, 0.0, 1.0); 4],
        indices: vec![0, 1, 2, 0, 2, 3],
        material_id,
    }
}

/// The example scene (millimetres): a 100 mm radius icosphere of 320 triangles resting on a
/// floor quad, one rectangular light above and beside the camera, an 85 mm camera at f/11.
pub fn scene() -> Scene {
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
        ],
        meshes: vec![
            icosphere(Vec3::new(0.0, 0.0, 100.0), 100.0, 2),
            floor_quad(0.0, 900.0, 1),
        ],
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
            assert_eq!(mesh.positions.len(), vertices);
            assert_eq!(mesh.normals.len(), vertices);
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
        for &p in &mesh.positions {
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
        assert_eq!(scene.lights.len(), 1);
        for mesh in &scene.meshes {
            assert!((mesh.material_id as usize) < scene.materials.len());
            assert!(mesh
                .indices
                .iter()
                .all(|&i| (i as usize) < mesh.positions.len()));
        }
        assert_eq!(Scene::from_rsb(&scene.to_rsb()), Ok(scene));
    }
}
