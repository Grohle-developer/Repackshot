//! Meshes for tests and the parity scene: a box, a UV sphere and a cylinder (trigonometry from
//! `fmath`, so the bytes are the same everywhere), and [`drop_scene`], three primitives dropped on
//! a floor with a static block, which the native tests and the WebAssembly check both run.

use crate::math::Quat;
use crate::scene::{Floor, Piece, Scene, SceneBody, SceneMesh};
use crate::world::{BodyParams, Transform};
use rt_core::fmath;
use rt_core::math::Vec3;

/// Steps the parity check runs the drop scene for (two seconds).
pub const DROP_STEPS: u32 = 480;

/// A box of half extents `half` about the origin (8 vertices, 12 triangles, outward).
pub fn box_mesh(half: Vec3) -> SceneMesh {
    let mut positions = Vec::with_capacity(8);
    for i in 0..8 {
        positions.push(Vec3::new(
            if i & 1 != 0 { half.x } else { -half.x },
            if i & 2 != 0 { half.y } else { -half.y },
            if i & 4 != 0 { half.z } else { -half.z },
        ));
    }
    let quads: [[u32; 4]; 6] = [
        [0, 4, 6, 2],
        [1, 3, 7, 5],
        [0, 1, 5, 4],
        [2, 6, 7, 3],
        [0, 2, 3, 1],
        [4, 5, 7, 6],
    ];
    let mut indices = Vec::with_capacity(36);
    for q in quads {
        indices.extend_from_slice(&[q[0], q[1], q[2], q[0], q[2], q[3]]);
    }
    SceneMesh { positions, indices }
}

/// A UV sphere of `radius` about the origin.
pub fn sphere_mesh(radius: f32, rings: u32, segments: u32) -> SceneMesh {
    let mut positions = vec![Vec3::new(0.0, 0.0, radius)];
    for r in 1..rings {
        let (st, ct) = fmath::sin_cos(std::f32::consts::PI * r as f32 / rings as f32);
        for s in 0..segments {
            let (sp, cp) = fmath::sin_cos(std::f32::consts::TAU * s as f32 / segments as f32);
            positions.push(Vec3::new(st * cp, st * sp, ct) * radius);
        }
    }
    positions.push(Vec3::new(0.0, 0.0, -radius));
    let last = positions.len() as u32 - 1;
    let ring = |r: u32, s: u32| 1 + (r - 1) * segments + s % segments;
    let mut indices = Vec::new();
    for s in 0..segments {
        indices.extend_from_slice(&[0, ring(1, s), ring(1, s + 1)]);
        indices.extend_from_slice(&[last, ring(rings - 1, s + 1), ring(rings - 1, s)]);
    }
    for r in 1..rings - 1 {
        for s in 0..segments {
            let (a, b, c, d) = (
                ring(r, s),
                ring(r, s + 1),
                ring(r + 1, s),
                ring(r + 1, s + 1),
            );
            indices.extend_from_slice(&[a, c, d, a, d, b]);
        }
    }
    SceneMesh { positions, indices }
}

/// A closed cylinder of `radius` and `height` about the origin, axis Z.
pub fn cylinder_mesh(radius: f32, height: f32, segments: u32) -> SceneMesh {
    let mut positions = Vec::new();
    for s in 0..segments {
        let (sp, cp) = fmath::sin_cos(std::f32::consts::TAU * s as f32 / segments as f32);
        positions.push(Vec3::new(cp * radius, sp * radius, -0.5 * height));
        positions.push(Vec3::new(cp * radius, sp * radius, 0.5 * height));
    }
    let bottom = positions.len() as u32;
    positions.push(Vec3::new(0.0, 0.0, -0.5 * height));
    positions.push(Vec3::new(0.0, 0.0, 0.5 * height));
    let mut indices = Vec::new();
    for s in 0..segments {
        let (a0, a1) = (2 * s, 2 * s + 1);
        let (b0, b1) = (2 * ((s + 1) % segments), 2 * ((s + 1) % segments) + 1);
        indices.extend_from_slice(&[a0, b0, b1, a0, b1, a1]);
        indices.extend_from_slice(&[bottom, b0, a0]);
        indices.extend_from_slice(&[bottom + 1, a1, b1]);
    }
    SceneMesh { positions, indices }
}

/// The parity scene: a tilted box, a ball and a cylinder lying on its side dropped onto a floor,
/// the ball onto a static block.
pub fn drop_scene() -> Scene {
    let params = BodyParams {
        density: 1000.0,
        friction: 0.6,
        restitution: 0.2,
    };
    let tilt = Quat::from_axis_angle(Vec3::new(1.0, 1.0, 0.0), 0.5);
    let side = Quat::from_axis_angle(Vec3::new(1.0, 0.0, 0.0), std::f32::consts::FRAC_PI_2);
    Scene {
        meshes: vec![
            box_mesh(Vec3::new(30.0, 20.0, 15.0)),
            sphere_mesh(25.0, 16, 32),
            cylinder_mesh(20.0, 60.0, 24),
            box_mesh(Vec3::new(40.0, 40.0, 20.0)),
        ],
        bodies: vec![
            SceneBody {
                dynamic: true,
                params,
                pieces: vec![Piece {
                    mesh: 0,
                    transform: Transform::from_pose(Vec3::new(-80.0, 0.0, 90.0), tilt),
                }],
            },
            SceneBody {
                dynamic: true,
                params,
                pieces: vec![Piece {
                    mesh: 1,
                    transform: Transform::translation(Vec3::new(10.0, 15.0, 140.0)),
                }],
            },
            SceneBody {
                dynamic: true,
                params,
                pieces: vec![Piece {
                    mesh: 2,
                    transform: Transform::from_pose(Vec3::new(90.0, -10.0, 60.0), side),
                }],
            },
            SceneBody {
                dynamic: false,
                params,
                pieces: vec![Piece {
                    mesh: 3,
                    transform: Transform::translation(Vec3::new(0.0, 0.0, 20.0)),
                }],
            },
        ],
        floor: Some(Floor {
            z: 0.0,
            friction: 0.6,
            restitution: 0.2,
        }),
    }
}
