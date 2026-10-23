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

/// The priority the sheet and the parity scene give the glass (above the liquid's, so where the
/// liquid's surface reaches into the glass's wall the overlap is glass).
pub const GLASS_PRIORITY: u32 = 2;
/// The priority they give the liquid.
pub const LIQUID_PRIORITY: u32 = 1;

/// Clear glass (index 1.5, smooth).
pub fn glass_material() -> rt_core::scene::Material {
    rt_core::scene::Material {
        kind: rt_core::scene::MATERIAL_GLASS,
        base_color: rt_core::color::Rgb::new(0.97, 0.99, 0.98),
        roughness: 0.0,
        ior: 1.5,
        transmission: 1.0,
        ..rt_core::scene::Material::default()
    }
}

/// Water: index 1.333, a faint blue-green over 2 m.
pub fn water_material() -> rt_core::scene::Material {
    rt_core::scene::Material {
        kind: rt_core::scene::MATERIAL_GLASS,
        base_color: rt_core::color::Rgb::new(0.86, 0.95, 0.97),
        roughness: 0.0,
        ior: 1.333,
        transmission: 1.0,
        absorption_mm: 2000.0,
        ..rt_core::scene::Material::default()
    }
}

/// The scene of a liquid world as the page renders it: the static parts of `spec` in `glass`
/// (priority [`GLASS_PRIORITY`]), each liquid's surface now (rebuilt from its frame record) in
/// its material of `liquids` (priority [`LIQUID_PRIORITY`]), on the example's studio (its light,
/// dome and floor), seen by `camera`.
pub fn render_scene(
    spec: &LiquidSpec,
    world: &super::LiquidWorld,
    glass: rt_core::scene::Material,
    liquids: &[rt_core::scene::Material],
    camera: rt_core::scene::Camera,
    width: u32,
    height: u32,
) -> rt_core::scene::Scene {
    use rt_core::scene::{Instance, Mesh, Transform as RtTransform};
    let mut scene = rt_core::example::scene();
    scene.camera = camera;
    scene.render.width = width;
    scene.render.height = height;
    let floor = scene.materials[1].clone();
    // The example's floor quad (its second mesh).
    let mut meshes = vec![scene.geometry.meshes()[1].clone()];
    let mut instances = vec![Instance::new(0, RtTransform::IDENTITY, 0)];
    let mut materials = vec![floor, glass];
    let mut priorities = vec![0, GLASS_PRIORITY];
    for s in &spec.statics {
        let m = &spec.meshes[s.mesh as usize];
        meshes.push(Mesh::new(&m.positions, &[], &m.indices, 0).expect("a valid mesh"));
        instances.push(Instance::new(
            meshes.len() as u32 - 1,
            RtTransform {
                rows: s.transform.rows,
            },
            1,
        ));
    }
    for i in 0..world.liquids() {
        let surface = world.surface(i);
        if surface.indices.is_empty() {
            continue;
        }
        let material = liquids
            .get(i)
            .or(liquids.last())
            .cloned()
            .unwrap_or_default();
        materials.push(material);
        priorities.push(LIQUID_PRIORITY);
        meshes.push(
            Mesh::new(&surface.positions, &surface.normals, &surface.indices, 0)
                .expect("a valid surface"),
        );
        instances.push(Instance::new(
            meshes.len() as u32 - 1,
            RtTransform::IDENTITY,
            materials.len() as u32 - 1,
        ));
    }
    scene.materials = materials;
    scene.priorities = priorities;
    scene.geometry = rt_core::geometry::Geometry::new(meshes, instances).expect("a valid geometry");
    scene.apply_section();
    scene
}

/// The S7 parity scene: [`pour_spec`] after [`POUR_STEPS`], water in its glass, seen from the
/// front and a little above at 160 × 120. `tests/liquid.rs` pins its image; `rt
/// --write-s7-liquid-example` writes it for `tools/wasm-parity.mjs`.
pub fn s7_scene() -> rt_core::scene::Scene {
    let spec = pour_spec();
    let mut world = super::LiquidWorld::new(&spec);
    world.step(POUR_STEPS);
    let target = Vec3::new(0.0, 0.0, 25.0);
    let position = Vec3::new(40.0, -230.0, 110.0);
    let camera = rt_core::scene::Camera {
        position,
        target,
        up: Vec3::new(0.0, 0.0, 1.0),
        focal_mm: 85.0,
        fstop: 0.0,
        focus_dist: (target - position).length(),
        ..rt_core::scene::Camera::default()
    };
    render_scene(
        &spec,
        &world,
        glass_material(),
        &[water_material()],
        camera,
        160,
        120,
    )
}
