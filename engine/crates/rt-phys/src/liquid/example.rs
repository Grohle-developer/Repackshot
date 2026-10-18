//! Scenes for the liquid tests and the parity checks (S7): a glass (a solid cup: outer wall, rim,
//! inner wall and bottom, trigonometry from `fmath`, so the bytes are the same everywhere), a
//! litre poured into it under a lid, a tank where a block of liquid levels, and a small pour the
//! WebAssembly check runs.

use super::{LiquidParams, LiquidSource, LiquidSpec, StaticPiece};
use crate::example::box_mesh;
use crate::scene::SceneMesh;
use crate::world::Transform;
use rt_core::fmath;
use rt_core::math::Vec3;

/// A glass standing on `z = 0`: a cup of outer radius `outer`, inner radius `inner`, height
/// `height` and a bottom `bottom` thick, as one closed solid facing out.
pub fn glass_mesh(outer: f32, inner: f32, height: f32, bottom: f32, segments: u32) -> SceneMesh {
    let mut positions = Vec::new();
    let ring = |r: f32, z: f32, positions: &mut Vec<Vec3>| {
        let first = positions.len() as u32;
        for s in 0..segments {
            let (sin, cos) = fmath::sin_cos(std::f32::consts::TAU * s as f32 / segments as f32);
            positions.push(Vec3::new(r * cos, r * sin, z));
        }
        first
    };
    let outer_bottom = ring(outer, 0.0, &mut positions);
    let outer_top = ring(outer, height, &mut positions);
    let inner_top = ring(inner, height, &mut positions);
    let inner_bottom = ring(inner, bottom, &mut positions);
    let centre_low = positions.len() as u32;
    positions.push(Vec3::ZERO);
    let centre_high = positions.len() as u32;
    positions.push(Vec3::new(0.0, 0.0, bottom));
    let mut indices = Vec::new();
    let next = |s: u32| (s + 1) % segments;
    for s in 0..segments {
        let n = next(s);
        // Outer wall, facing out.
        indices.extend_from_slice(&[outer_bottom + s, outer_bottom + n, outer_top + n]);
        indices.extend_from_slice(&[outer_bottom + s, outer_top + n, outer_top + s]);
        // Rim, facing up.
        indices.extend_from_slice(&[outer_top + s, outer_top + n, inner_top + n]);
        indices.extend_from_slice(&[outer_top + s, inner_top + n, inner_top + s]);
        // Inner wall, facing the axis.
        indices.extend_from_slice(&[inner_top + s, inner_top + n, inner_bottom + n]);
        indices.extend_from_slice(&[inner_top + s, inner_bottom + n, inner_bottom + s]);
        // The inside of the bottom, facing up.
        indices.extend_from_slice(&[centre_high, inner_bottom + n, inner_bottom + s]);
        // Underneath, facing down.
        indices.extend_from_slice(&[centre_low, outer_bottom + s, outer_bottom + n]);
    }
    SceneMesh { positions, indices }
}

/// A flat disc of `radius` and `thickness` centred at the origin (a lid), facing out.
pub fn disc_mesh(radius: f32, thickness: f32, segments: u32) -> SceneMesh {
    let mut positions = Vec::new();
    for z in [-0.5 * thickness, 0.5 * thickness] {
        for s in 0..segments {
            let (sin, cos) = fmath::sin_cos(std::f32::consts::TAU * s as f32 / segments as f32);
            positions.push(Vec3::new(radius * cos, radius * sin, z));
        }
    }
    let (low, high) = (2 * segments, 2 * segments + 1);
    positions.push(Vec3::new(0.0, 0.0, -0.5 * thickness));
    positions.push(Vec3::new(0.0, 0.0, 0.5 * thickness));
    let mut indices = Vec::new();
    for s in 0..segments {
        let n = (s + 1) % segments;
        indices.extend_from_slice(&[s, n, segments + n]);
        indices.extend_from_slice(&[s, segments + n, segments + s]);
        indices.extend_from_slice(&[high, segments + s, segments + n]);
        indices.extend_from_slice(&[low, n, s]);
    }
    SceneMesh { positions, indices }
}

/// The litre's glass: inner radius, mm.
pub const LITRE_INNER: f32 = 75.0;
/// The litre's glass: the inside of its bottom, mm.
pub const LITRE_BOTTOM: f32 = 5.0;
/// The litre's glass: height, mm (the lid sits on it).
pub const LITRE_HEIGHT: f32 = 240.0;
/// The litre's particle spacing, mm.
pub const LITRE_SPACING: f32 = 100.0 / 12.0;

/// A litre of `params` (a cube of 100 mm) poured into a closed glass: the cube starts with its
/// base 80 mm above the glass's bottom, falls, splashes and settles under the lid.
pub fn litre_spec(params: LiquidParams) -> LiquidSpec {
    let cube = box_mesh(Vec3::splat(50.0));
    LiquidSpec {
        meshes: vec![
            glass_mesh(
                LITRE_INNER + 3.0,
                LITRE_INNER,
                LITRE_HEIGHT,
                LITRE_BOTTOM,
                48,
            ),
            disc_mesh(LITRE_INNER + 3.0, 4.0, 48),
            cube,
        ],
        statics: vec![
            StaticPiece {
                mesh: 0,
                transform: Transform::IDENTITY,
            },
            StaticPiece {
                mesh: 1,
                transform: Transform::translation(Vec3::new(0.0, 0.0, LITRE_HEIGHT + 2.0)),
            },
        ],
        floor: Some(0.0),
        liquids: vec![LiquidSource {
            mesh: 2,
            transform: Transform::translation(Vec3::new(0.0, 0.0, LITRE_BOTTOM + 80.0 + 50.0)),
            spacing: LITRE_SPACING,
            params,
        }],
    }
}

/// The tank of the levelling test: inside 120 × 30 mm, walls to 80 mm (a closed box with a
/// lid), on the floor.
pub const TANK: Vec3 = Vec3::new(120.0, 30.0, 80.0);
/// The tank's block of liquid: 30 × 30 × 60 mm against its left wall.
pub const TANK_BLOCK: Vec3 = Vec3::new(30.0, 30.0, 60.0);
/// The tank's particle spacing, mm.
pub const TANK_SPACING: f32 = 4.0;

/// A tank (a box the liquid is inside of: its triangles are the walls) with a block of `params`
/// standing against its left wall, which falls over and levels.
pub fn tank_spec(params: LiquidParams) -> LiquidSpec {
    let tank = box_mesh(TANK * 0.5);
    let block = box_mesh(TANK_BLOCK * 0.5);
    let at_left = Vec3::new(-0.5 * TANK.x + 0.5 * TANK_BLOCK.x, 0.0, 0.5 * TANK_BLOCK.z);
    LiquidSpec {
        meshes: vec![tank, block],
        statics: vec![StaticPiece {
            mesh: 0,
            transform: Transform::translation(Vec3::new(0.0, 0.0, 0.5 * TANK.z)),
        }],
        floor: Some(0.0),
        liquids: vec![LiquidSource {
            mesh: 1,
            transform: Transform::translation(at_left),
            spacing: TANK_SPACING,
            params,
        }],
    }
}

/// Steps the parity check runs the pour for (a quarter of a second).
pub const POUR_STEPS: u32 = 60;

/// The parity scene: a small block of water (8 × 8 × 8 particles of 4 mm) dropped into a glass,
/// with the floor.
pub fn pour_spec() -> LiquidSpec {
    LiquidSpec {
        meshes: vec![
            glass_mesh(28.0, 25.0, 60.0, 3.0, 32),
            box_mesh(Vec3::splat(16.0)),
        ],
        statics: vec![StaticPiece {
            mesh: 0,
            transform: Transform::IDENTITY,
        }],
        floor: Some(0.0),
        liquids: vec![LiquidSource {
            mesh: 1,
            transform: Transform::translation(Vec3::new(0.0, 0.0, 30.0)),
            spacing: 4.0,
            params: LiquidParams::WATER,
        }],
    }
}
