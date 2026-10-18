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

/// S3b: steps the wet pane of the parity scene is simulated for (five seconds).
pub const WET_STEPS: u32 = 1200;
/// S3b: the contact angles of water on glass, advancing and receding (the page's
/// `src/data/wettability.ts`, family `GLASS`: ◆ a proposal), and the dust's angle of repose (its
/// `DUST_REPOSE_DEG`).
pub const GLASS_ADVANCING_DEG: f32 = 70.0;
/// See [`GLASS_ADVANCING_DEG`].
pub const GLASS_RECEDING_DEG: f32 = 50.0;
/// See [`GLASS_ADVANCING_DEG`].
pub const DUST_REPOSE_DEG: f32 = 35.0;

/// A world vector in the axes of the front glass of `camera`: to its right, up, and out of the
/// pane's outer face (the camera's forward).
pub fn pane_axes(camera: &rt_core::scene::Camera, v: Vec3) -> [f32; 3] {
    let (forward, right, up) = camera.basis();
    [v.dot(right), v.dot(up), v.dot(forward)]
}

/// The S3b parity pane: the front glass of [`rt_core::example::s3_glass_scene`]'s camera under rain
/// that a 3 m/s wind drives at the lens (20 000 drops of 1.2 mm ± 40 % per m³ falling at 6.5 m/s,
/// the page's *Rain*) and pollen (40 000 grains of 0.3 mm per m³), five seconds of it. The camera
/// looks a little down, so the rain reaches the lens only because of the wind, and no pollen stays
/// on a face that looks down.
pub fn wet_spec() -> crate::wet::WetSpec {
    use crate::wet::{SourceKind, WetSource, WetSpec};
    use rt_core::optics::glass::{FrontGlass, GlassParams};
    let scene = rt_core::example::s3_glass_scene();
    let camera = &scene.camera;
    let distance = FrontGlass::new(GlassParams::default(), camera).distance();
    let half_extent = FrontGlass::half_extent_of(camera, distance);
    let mut towards = camera.position - camera.target;
    towards.z = 0.0;
    let towards = towards.normalize();
    let gravity = pane_axes(camera, Vec3::new(0.0, 0.0, -1.0));
    let rain = towards * 3000.0 + Vec3::new(0.0, 0.0, -6500.0);
    let pollen = towards * 50.0 + Vec3::new(0.0, 0.0, -20.0);
    WetSpec {
        seed: 3,
        half_extent,
        gravity,
        advancing_deg: GLASS_ADVANCING_DEG,
        receding_deg: GLASS_RECEDING_DEG,
        repose_deg: DUST_REPOSE_DEG,
        sources: vec![
            WetSource {
                kind: SourceKind::Drops,
                density: 2.0e-5,
                velocity: pane_axes(camera, rain),
                size_mm: 1.2,
                size_var: 0.4,
            },
            WetSource {
                kind: SourceKind::Dust,
                density: 4.0e-5,
                velocity: pane_axes(camera, pollen),
                size_mm: 0.3,
                size_var: 0.4,
            },
        ],
    }
}

/// The pane of [`wet_spec`] after [`WET_STEPS`].
pub fn wet_pane() -> crate::wet::WetPane {
    let mut pane = crate::wet::WetPane::new(wet_spec());
    pane.step(WET_STEPS);
    pane
}

/// The S3b parity scene: [`rt_core::example::s3_glass_scene`] through the pane the simulation left
/// ([`wet_pane`]): its drops one by one in the `GLAS` section (no scatter, no dust coverage), at
/// the cap angle of the glass's contact angles and with the drops' and motes' optics of the front
/// glass. `tests/wet.rs` pins its image; `rt --write-s3b-wet-example` writes it.
pub fn s3b_wet_scene() -> rt_core::scene::Scene {
    use rt_core::optics::glass::GlassParams;
    let mut scene = rt_core::example::s3_glass_scene();
    let pane = wet_pane();
    let params = GlassParams {
        seed: 0,
        drop_coverage: 0.0,
        dust_coverage: 0.0,
        contact_angle_deg: pane.spec().cap_angle_deg(),
        ior: 1.333,
        dust_opacity: 0.9,
        ..GlassParams::default()
    };
    scene.set_glass_layout(params, pane.layout());
    scene
}

/// S3c: steps the wet parts of the parity scene are simulated for (five seconds).
pub const PARTS_STEPS: u32 = 1200;
/// S3c: the contact angles of water on plastic and metal and the soak of paint (the page's
/// `src/data/wettability.ts`, families `PLASTIC`, `METAL` and `PAINT`: ◆ proposals), and the snow's
/// angle of repose (its `SNOW_REPOSE_DEG`).
pub const PLASTIC_ADVANCING_DEG: f32 = 90.0;
/// See [`PLASTIC_ADVANCING_DEG`].
pub const PLASTIC_RECEDING_DEG: f32 = 65.0;
/// See [`PLASTIC_ADVANCING_DEG`].
pub const METAL_ADVANCING_DEG: f32 = 80.0;
/// See [`PLASTIC_ADVANCING_DEG`].
pub const METAL_RECEDING_DEG: f32 = 50.0;
/// See [`PLASTIC_ADVANCING_DEG`].
pub const PAINT_ADVANCING_DEG: f32 = 85.0;
/// See [`PLASTIC_ADVANCING_DEG`].
pub const PAINT_RECEDING_DEG: f32 = 60.0;
/// See [`PLASTIC_ADVANCING_DEG`].
pub const SNOW_REPOSE_DEG: f32 = 50.0;
/// S3c: paper's contact angles and how much a wet film darkens it (the page's family `PAPER`:
/// its `porosity`, ◆).
pub const PAPER_ADVANCING_DEG: f32 = 100.0;
/// See [`PAPER_ADVANCING_DEG`].
pub const PAPER_RECEDING_DEG: f32 = 20.0;
/// See [`PAPER_ADVANCING_DEG`].
pub const PAPER_POROSITY: f32 = 1.0;

/// A flat plate of `size_x` × `size_y` mm in the XY plane about the origin, facing +Z, `nx` × `ny`
/// quads of two triangles each (counter-clockwise from above).
pub fn plate_mesh(size_x: f32, size_y: f32, nx: u32, ny: u32) -> crate::wet_parts::PartsMesh {
    let mut positions = Vec::new();
    for j in 0..=ny {
        for i in 0..=nx {
            positions.push(Vec3::new(
                size_x * (i as f32 / nx as f32 - 0.5),
                size_y * (j as f32 / ny as f32 - 0.5),
                0.0,
            ));
        }
    }
    let at = |i: u32, j: u32| j * (nx + 1) + i;
    let mut indices = Vec::new();
    for j in 0..ny {
        for i in 0..nx {
            let (a, b, c, d) = (at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1));
            indices.extend_from_slice(&[a, b, c, a, c, d]);
        }
    }
    crate::wet_parts::PartsMesh { positions, indices }
}

/// A [`SceneMesh`] as a mesh of wet parts.
pub fn parts_mesh(m: SceneMesh) -> crate::wet_parts::PartsMesh {
    crate::wet_parts::PartsMesh {
        positions: m.positions,
        indices: m.indices,
    }
}

/// S3c: the parity scene's parts: a glass bottle (a closed cylinder of 35 mm by 160 mm standing on
/// the floor), a plastic plate tilted 45° beside it, a metal shelf tilted 20° above the plate (its
/// drops run to its low edge and hang under it), and a paper floor card as a film; under the
/// page's *Rain* driven by 1.5 m/s of wind, a *Dust cloud*'s dust and a light snow.
pub fn parts_spec() -> crate::wet_parts::PartsSpec {
    use crate::wet_parts::{PartsSource, PartsSourceKind, PartsSpec, WetPartSpec, PART_FILM};
    let tilt = |deg: f32, t: Vec3| {
        Transform::from_pose(
            t,
            Quat::from_axis_angle(Vec3::new(1.0, 0.0, 0.0), deg * fmath::DEG_TO_RAD),
        )
    };
    let part = |mesh: u32, transform: Transform, adv: f32, rec: f32, flags: u32| WetPartSpec {
        mesh,
        transform,
        advancing_deg: adv,
        receding_deg: rec,
        soak_mm_s: 0.0,
        flags,
    };
    PartsSpec {
        seed: 5,
        cell_mm: 1.5,
        max_samples: 40_000,
        repose_deg: DUST_REPOSE_DEG,
        snow_repose_deg: SNOW_REPOSE_DEG,
        meshes: vec![
            parts_mesh(cylinder_mesh(35.0, 160.0, 32)),
            plate_mesh(120.0, 80.0, 12, 8),
            parts_mesh(box_mesh(Vec3::new(40.0, 30.0, 2.0))),
            plate_mesh(300.0, 300.0, 6, 6),
        ],
        parts: vec![
            part(
                0,
                Transform::translation(Vec3::new(0.0, 0.0, 80.0)),
                GLASS_ADVANCING_DEG,
                GLASS_RECEDING_DEG,
                0,
            ),
            part(
                1,
                tilt(45.0, Vec3::new(110.0, 0.0, 40.0)),
                PLASTIC_ADVANCING_DEG,
                PLASTIC_RECEDING_DEG,
                0,
            ),
            part(
                2,
                tilt(20.0, Vec3::new(110.0, 10.0, 130.0)),
                METAL_ADVANCING_DEG,
                METAL_RECEDING_DEG,
                0,
            ),
            part(
                3,
                Transform::translation(Vec3::new(0.0, 0.0, -0.5)),
                PAPER_ADVANCING_DEG,
                PAPER_RECEDING_DEG,
                PART_FILM,
            ),
        ],
        sources: vec![
            PartsSource {
                kind: PartsSourceKind::Drops,
                density: 2.0e-5,
                velocity: Vec3::new(1500.0, 0.0, -6500.0),
                size_mm: 1.2,
                size_var: 0.4,
            },
            PartsSource {
                kind: PartsSourceKind::Dust,
                density: 4.0e-3,
                velocity: Vec3::new(200.0, 100.0, -150.0),
                size_mm: 0.15,
                size_var: 0.5,
            },
            PartsSource {
                kind: PartsSourceKind::Snow,
                density: 2.0e-6,
                velocity: Vec3::new(300.0, 0.0, -1000.0),
                size_mm: 3.0,
                size_var: 0.5,
            },
        ],
    }
}

/// The parts of [`parts_spec`] after [`PARTS_STEPS`].
pub fn wet_parts() -> crate::wet_parts::WetParts {
    let mut parts = crate::wet_parts::WetParts::new(parts_spec());
    parts.step(PARTS_STEPS);
    parts
}

/// S3c: the parity scene of the wet parts: the parts of [`parts_spec`] as instances (a clear glass
/// bottle, a red plastic plate, a metal shelf and a paper card under them), seen by a 50 mm lens at
/// f/8 under the example's light, with what [`wet_parts`] left on each in its `WETP` section (the
/// card's wet film darkens it: paper is porous). `tests/wet_parts.rs` pins its image; `rt
/// --write-s3c-wet-example` writes it.
pub fn s3c_wet_scene() -> rt_core::scene::Scene {
    use rt_core::color::Rgb;
    use rt_core::scene::{
        FloorMode, Instance, Material, Mesh, Transform as RtTransform, MATERIAL_GLASS,
    };
    let spec = parts_spec();
    let mut scene = rt_core::example::scene();
    scene.render.width = 160;
    scene.render.height = 120;
    let target = Vec3::new(60.0, 0.0, 70.0);
    scene.camera.position = Vec3::new(-60.0, -520.0, 300.0);
    scene.camera.target = target;
    scene.camera.focal_mm = 50.0;
    scene.camera.fstop = 8.0;
    scene.camera.focus_dist = (target - scene.camera.position).length();
    scene.floor.mode = FloorMode::None;
    scene.materials = vec![
        Material {
            kind: MATERIAL_GLASS,
            base_color: Rgb::new(0.85, 0.95, 0.88),
            roughness: 0.0,
            transmission: 1.0,
            ..Material::default()
        },
        Material {
            base_color: Rgb::new(0.7, 0.12, 0.08),
            roughness: 0.35,
            ..Material::default()
        },
        Material {
            base_color: Rgb::new(0.6, 0.6, 0.62),
            metallic: 1.0,
            roughness: 0.3,
            ..Material::default()
        },
        Material {
            base_color: Rgb::new(0.7, 0.7, 0.68),
            roughness: 0.6,
            ..Material::default()
        },
    ];
    let meshes: Vec<Mesh> = spec
        .meshes
        .iter()
        .map(|m| Mesh::new(&m.positions, &[], &m.indices, 0).expect("a valid mesh"))
        .collect();
    let instances: Vec<Instance> = spec
        .parts
        .iter()
        .enumerate()
        .map(|(k, p)| {
            Instance::new(
                p.mesh,
                RtTransform {
                    rows: p.transform.rows,
                },
                k as u32,
            )
        })
        .collect();
    scene.geometry = rt_core::geometry::Geometry::new(meshes, instances).expect("a valid geometry");
    scene.apply_section();
    let porosity = [0.0, 0.0, 0.0, PAPER_POROSITY];
    let parts = wet_parts()
        .weather()
        .iter()
        .enumerate()
        .map(|(k, w)| {
            w.part_weather(k as u32, porosity[k])
                .expect("valid weather")
        })
        .collect();
    scene.set_wet_parts(parts).expect("weather that fits");
    scene
}

/// S3d: the parity scene of the drops in the air: [`s3c_wet_scene`] with the drops [`wet_parts`]
/// has in the air (drips and the drops splashes threw) in its `WETF` section, each from the
/// instance of the part it left. `tests/wet_parts.rs` pins its image and its passes; `rt
/// --write-s3d-flight-example` writes it.
pub fn s3d_flight_scene() -> rt_core::scene::Scene {
    let mut scene = s3c_wet_scene();
    let falling = wet_parts()
        .falling()
        .iter()
        .map(|&(part, position, radius)| rt_core::weather::FallingDrop {
            instance: part,
            position,
            radius,
        })
        .collect();
    scene.set_wet_falling(falling).expect("drops that fit");
    scene
}
