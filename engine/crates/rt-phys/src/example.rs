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
        body: crate::wet_parts::NO_BODY,
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
        extras: crate::wet_parts::PartsExtras::default(),
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

/// S3f: steps of the organic parity scene (1.1 s: the drop that slides is near the foot of the
/// pane, a rivulet's beads behind it).
pub const ORGANIC_STEPS: u32 = 264;
/// S3f: the steps of the frames of the strip of the organic scene (`docs/ui/rain-organic.png`).
pub const ORGANIC_STRIP_STEPS: [u32; 6] = [0, 60, 120, 180, 240, 300];
/// S3f: the drops seeded on the pane of the organic scene.
pub const ORGANIC_SEEDS: u32 = 220;

/// S3f: the organic parity scene's parts: a vertical glass pane (120 mm by 160 mm, its lower edge
/// open at 20 mm above the floor, facing −Y) and a glass ceiling to its side (a plate facing down,
/// 60 mm square at 150 mm), under a light rain blown onto the pane.
pub fn organic_spec() -> crate::wet_parts::PartsSpec {
    use crate::wet_parts::{PartsSource, PartsSourceKind, PartsSpec, WetPartSpec};
    let glass = |mesh: u32, transform: Transform| WetPartSpec {
        mesh,
        transform,
        advancing_deg: GLASS_ADVANCING_DEG,
        receding_deg: GLASS_RECEDING_DEG,
        soak_mm_s: 0.0,
        flags: 0,
        body: crate::wet_parts::NO_BODY,
    };
    let mut ceiling = plate_mesh(60.0, 60.0, 3, 3);
    ceiling
        .indices
        .chunks_exact_mut(3)
        .for_each(|t| t.swap(1, 2));
    PartsSpec {
        seed: 7,
        cell_mm: 1.0,
        max_samples: 60_000,
        repose_deg: DUST_REPOSE_DEG,
        snow_repose_deg: SNOW_REPOSE_DEG,
        meshes: vec![plate_mesh(120.0, 160.0, 6, 8), ceiling],
        parts: vec![
            glass(
                0,
                Transform::from_pose(
                    Vec3::new(0.0, 0.0, 100.0),
                    Quat::from_axis_angle(Vec3::new(1.0, 0.0, 0.0), std::f32::consts::FRAC_PI_2),
                ),
            ),
            glass(1, Transform::translation(Vec3::new(130.0, -40.0, 150.0))),
        ],
        sources: vec![PartsSource {
            kind: PartsSourceKind::Drops,
            density: 4.0e-6,
            velocity: Vec3::new(0.0, 2500.0, -6500.0),
            size_mm: 1.4,
            size_var: 0.4,
        }],
        extras: crate::wet_parts::PartsExtras::default(),
    }
}

/// S3f: the parts of [`organic_spec`] at the start: [`ORGANIC_SEEDS`] drops below their critical
/// size scattered over the pane (from a hash, the same everywhere), a drop past it near the top of
/// the pane that slides down through them, and one under the ceiling about to pinch off.
pub fn organic_parts() -> crate::wet_parts::WetParts {
    use rt_core::rng::mix64;
    let mut parts = crate::wet_parts::WetParts::new(organic_spec());
    let unit = |h: u64| (h >> 40) as f32 * (1.0 / 16_777_216.0);
    let k = {
        let t = 0.5 * (GLASS_ADVANCING_DEG + GLASS_RECEDING_DEG) * fmath::DEG_TO_RAD;
        let (s, c) = fmath::sin_cos(t);
        fmath::PI * (2.0 - 3.0 * c + c * c * c) / (3.0 * s * s * s)
    };
    let crit = parts.critical_radius(0, 1.0);
    // The pane: 6 × 8 quads of 20 mm, two triangles each.
    for n in 0..ORGANIC_SEEDS {
        let h = mix64(0x53f0_0000_0000_0001 ^ u64::from(n));
        let quad = (unit(h) * 48.0) as usize % 48;
        let (u, v) = (unit(mix64(h ^ 1)), unit(mix64(h ^ 2)));
        let (u, v) = if u + v > 1.0 {
            (1.0 - u, 1.0 - v)
        } else {
            (u, v)
        };
        let a = crit * (0.15 + 0.5 * unit(mix64(h ^ 3)));
        parts.add_drop(0, 2 * quad + (n as usize & 1), u, v, k * a * a * a);
    }
    // The drop past its size: near the top, in the middle (quad (2, 7), its upper triangle).
    let big = crit * 1.25;
    parts.add_drop(0, 2 * (7 * 6 + 2) + 1, 0.6, 0.2, k * big * big * big);
    // Under the ceiling: a drop a little heavier than its contact line holds.
    let hang = {
        let t = 0.5 * (GLASS_ADVANCING_DEG + GLASS_RECEDING_DEG) * fmath::DEG_TO_RAD;
        (2.0 * fmath::PI * crate::wet::SURFACE_TENSION * fmath::sin(t)
            / (crate::wet::WATER_WEIGHT * k))
            .sqrt()
            * 1.03
    };
    parts.add_drop(1, 8, 0.3, 0.3, k * hang * hang * hang);
    parts
}

/// S3f: the organic parity scene at step `steps` of [`organic_parts`]: the pane in a dark glossy
/// paint (its drops read as highlights and refractions) and the ceiling in clear glass, seen close
/// by a 250 mm lens at f/11 from the front, aimed a little above the largest drop on the pane (the
/// one that slides, and what it gathered: its path above it), under one soft light; their weather
/// with the shapes of the drops in `WETP` (bit 10) and the drops in the air in `WETF`.
pub fn s3f_organic_scene_at(steps: u32) -> rt_core::scene::Scene {
    use rt_core::color::Rgb;
    use rt_core::scene::{
        FloorMode, Instance, Light, LightKind, Material, Mesh, Transform as RtTransform,
        MATERIAL_GLASS,
    };
    let spec = organic_spec();
    let mut parts = organic_parts();
    parts.step(steps);
    let mut scene = rt_core::example::scene();
    scene.render.width = 160;
    scene.render.height = 120;
    let largest = parts
        .drop_states()
        .into_iter()
        .filter(|d| d.part == 0)
        .fold(None, |m: Option<crate::wet_parts::DropState>, d| match m {
            Some(x) if x.volume >= d.volume => Some(x),
            _ => Some(d),
        });
    let at = largest.map_or(Vec3::new(0.0, 0.0, 130.0), |d| d.p);
    let target = Vec3::new(at.x, 0.0, (at.z + 8.0).clamp(40.0, 158.0));
    scene.camera.position = target + Vec3::new(-30.0, -330.0, 40.0);
    scene.camera.target = target;
    scene.camera.focal_mm = 250.0;
    scene.camera.fstop = 11.0;
    scene.camera.focus_dist = (target - scene.camera.position).length();
    scene.floor.mode = FloorMode::None;
    scene.environment.strength = 0.35;
    let light = target + Vec3::new(-260.0, -380.0, 230.0);
    scene.lights = vec![Light {
        kind: LightKind::Rect,
        position: light,
        direction: (target - light).normalize(),
        up: Vec3::new(0.0, 0.0, 1.0),
        size_x: 120.0,
        size_y: 120.0,
        color: Rgb::WHITE,
        power: 10.0,
        spread_deg: 180.0,
        angle_deg: 0.0,
        flags: scene.lights[0].flags,
        ies: None,
    }];
    scene.materials = vec![
        Material {
            base_color: Rgb::new(0.015, 0.02, 0.035),
            roughness: 0.3,
            ..Material::default()
        },
        Material {
            kind: MATERIAL_GLASS,
            base_color: Rgb::new(0.9, 0.95, 0.95),
            roughness: 0.0,
            transmission: 1.0,
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
    let weather = parts
        .weather()
        .iter()
        .enumerate()
        .map(|(k, w)| w.part_weather_shaped(k as u32, 0.0).expect("valid weather"))
        .collect();
    scene.set_wet_parts(weather).expect("weather that fits");
    let falling = parts
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

/// S3f: the organic parity scene after [`ORGANIC_STEPS`] (`tests/wet_parts.rs` pins its image; `rt
/// --write-s3f-organic-example` writes it).
pub fn s3f_organic_scene() -> rt_core::scene::Scene {
    s3f_organic_scene_at(ORGANIC_STEPS)
}

/// S3e: steps of the S3e parity scene (five seconds).
pub const S3E_STEPS: u32 = 1200;
/// S3e: the wind of the S3e parity scene, mm/s.
pub const S3E_WIND: Vec3 = Vec3::new(1500.0, 400.0, 0.0);

/// S3e: the S3e parity scene's parts: a glass bottle standing on the studio floor, a glass ledge
/// facing down over the floor (a drop hangs under it and pinches off: its drips fall onto the floor
/// and the wind carries them), a plastic plate tilted on two axes (its drops reach its side edges
/// and run down them to its lowest corner) and a paper card of the set as a film beside the bottle
/// (its triangles that the bottle's shadow crosses take fine samples), under the page's *Rain*
/// with a side wind and a *Dust cloud*'s dust, over a studio floor of 2 mm cells.
pub fn s3e_spec() -> crate::wet_parts::PartsSpec {
    use crate::wet_parts::{
        FloorSpec, PartsExtras, PartsSource, PartsSourceKind, PartsSpec, WetPartSpec, NO_BODY,
        PART_FILM,
    };
    let part = |mesh: u32, transform: Transform, adv: f32, rec: f32, flags: u32| WetPartSpec {
        mesh,
        transform,
        advancing_deg: adv,
        receding_deg: rec,
        soak_mm_s: 0.0,
        flags,
        body: NO_BODY,
    };
    let mut ledge = plate_mesh(60.0, 60.0, 3, 3);
    ledge.indices.chunks_exact_mut(3).for_each(|t| t.swap(1, 2));
    let rolled = Quat::from_axis_angle(Vec3::new(0.0, 1.0, 0.0), 12.0 * fmath::DEG_TO_RAD)
        * Quat::from_axis_angle(Vec3::new(1.0, 0.0, 0.0), 55.0 * fmath::DEG_TO_RAD);
    PartsSpec {
        seed: 11,
        cell_mm: 1.5,
        max_samples: 60_000,
        repose_deg: DUST_REPOSE_DEG,
        snow_repose_deg: SNOW_REPOSE_DEG,
        meshes: vec![
            parts_mesh(cylinder_mesh(35.0, 160.0, 32)),
            ledge,
            plate_mesh(60.0, 120.0, 3, 6),
            plate_mesh(300.0, 300.0, 1, 1),
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
                Transform::translation(Vec3::new(120.0, 40.0, 140.0)),
                GLASS_ADVANCING_DEG,
                GLASS_RECEDING_DEG,
                0,
            ),
            part(
                2,
                Transform::from_pose(Vec3::new(-120.0, 60.0, 70.0), rolled),
                PLASTIC_ADVANCING_DEG,
                PLASTIC_RECEDING_DEG,
                0,
            ),
            part(
                3,
                Transform::translation(Vec3::new(160.0, -160.0, 0.5)),
                PAPER_ADVANCING_DEG,
                PAPER_RECEDING_DEG,
                PART_FILM,
            ),
        ],
        sources: vec![
            PartsSource {
                kind: PartsSourceKind::Drops,
                density: 2.0e-5,
                velocity: Vec3::new(S3E_WIND.x, S3E_WIND.y, -6500.0),
                size_mm: 1.2,
                size_var: 0.4,
            },
            PartsSource {
                kind: PartsSourceKind::Dust,
                density: 3.0e-3,
                velocity: Vec3::new(400.0, -300.0, -300.0),
                size_mm: 0.3,
                size_var: 0.6,
            },
        ],
        extras: PartsExtras {
            wind: S3E_WIND,
            floor: Some(FloorSpec {
                z: 0.0,
                min: [-300.0, -320.0],
                max: [340.0, 260.0],
                cell_mm: 2.0,
                max_cells: 120_000,
            }),
            edge_cell_mm: 2.0,
            edge_budget: 60_000,
        },
    }
}

/// S3e: the parts of [`s3e_spec`] with three drops under the ledge's upwind side past what their
/// contact lines hold (each pinches off twice within the first second; the drips fall onto the
/// floor in the dry patch the ledge keeps from the rain), after `steps`.
pub fn s3e_parts_at(steps: u32) -> crate::wet_parts::WetParts {
    let mut parts = crate::wet_parts::WetParts::new(s3e_spec());
    let k = {
        let t = 0.5 * (GLASS_ADVANCING_DEG + GLASS_RECEDING_DEG) * fmath::DEG_TO_RAD;
        let (s, c) = fmath::sin_cos(t);
        fmath::PI * (2.0 - 3.0 * c + c * c * c) / (3.0 * s * s * s)
    };
    let hang = (2.0
        * fmath::PI
        * crate::wet::SURFACE_TENSION
        * fmath::sin(0.5 * (GLASS_ADVANCING_DEG + GLASS_RECEDING_DEG) * fmath::DEG_TO_RAD)
        / (crate::wet::WATER_WEIGHT * k))
        .sqrt()
        * 1.6;
    for (tri, u, v) in [(6, 0.2, 0.2), (6, 0.6, 0.2), (0, 0.4, 0.3)] {
        parts.add_drop(1, tri, u, v, k * hang * hang * hang);
    }
    parts.step(steps);
    parts
}

/// S3e: the parts of [`s3e_spec`] after [`S3E_STEPS`].
pub fn s3e_parts() -> crate::wet_parts::WetParts {
    s3e_parts_at(S3E_STEPS)
}

/// The instances of `spec`'s parts where `parts` has them now, one per part (instance `k`
/// material `k`).
fn instances_of(
    spec: &crate::wet_parts::PartsSpec,
    parts: &crate::wet_parts::WetParts,
) -> rt_core::geometry::Geometry {
    use rt_core::scene::{Instance, Mesh, Transform as RtTransform};
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
                    rows: parts.placement(k).rows,
                },
                k as u32,
            )
        })
        .collect();
    rt_core::geometry::Geometry::new(meshes, instances).expect("a valid geometry")
}

/// The weather of `parts` on instances `0..` (instance `k` is part `k`) with the shapes of the
/// drops, the dust's motes of `motes` and `porosity` per part, the drops in the air, and the
/// studio floor's (of `floor_porosity`), into `scene`.
fn weather_into(
    scene: &mut rt_core::scene::Scene,
    parts: &crate::wet_parts::WetParts,
    porosity: &[f32],
    motes: Option<rt_core::weather::MoteSpec>,
    floor_porosity: f32,
) {
    let weather = parts
        .weather()
        .iter()
        .enumerate()
        .map(|(k, w)| {
            let p = w
                .part_weather_shaped(k as u32, porosity.get(k).copied().unwrap_or(0.0))
                .expect("valid weather");
            match motes {
                Some(m) if w.dust.iter().any(|&d| d > 0.0) => p.with_motes(m).expect("motes"),
                _ => p,
            }
        })
        .collect();
    scene.set_wet_parts(weather).expect("weather that fits");
    let falling = parts
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
        .set_wet_floor(parts.floor_weather(floor_porosity))
        .expect("a floor that fits");
}

/// S3e: the porosity of the studio floor in the example scenes (◆ the page's, `src/data/wet-parts.ts`).
pub const FLOOR_POROSITY: f32 = 0.5;

/// S3e: the S3e parity scene at `steps` of [`s3e_parts_at`]: the bottle in clear glass, the ledge in
/// glass, the plate in a red plastic and the card in paper, over the studio floor as the page writes
/// it (a shadow catcher on a light grey background), seen by a 40 mm lens at f/8 from the front and
/// above; their weather with the shapes and the motes (`WETP`, `WTP2` for the card), the drops in the
/// air (`WETF`) and the floor's (`WETG`).
pub fn s3e_scene_at(steps: u32) -> rt_core::scene::Scene {
    use rt_core::color::Rgb;
    use rt_core::scene::{FloorMode, Material, BACKGROUND_COLOR, MATERIAL_GLASS};
    let spec = s3e_spec();
    let parts = s3e_parts_at(steps);
    let mut scene = rt_core::example::scene();
    scene.render.width = 160;
    scene.render.height = 120;
    let target = Vec3::new(20.0, -20.0, 40.0);
    scene.camera.position = Vec3::new(40.0, -560.0, 330.0);
    scene.camera.target = target;
    scene.camera.focal_mm = 40.0;
    scene.camera.fstop = 8.0;
    scene.camera.focus_dist = (target - scene.camera.position).length();
    scene.floor.mode = FloorMode::ShadowCatcher;
    scene.floor.z = 0.0;
    scene.environment.background_mode = BACKGROUND_COLOR;
    scene.environment.background_color = Rgb::splat(0.72);
    let glass = Material {
        kind: MATERIAL_GLASS,
        base_color: Rgb::new(0.85, 0.95, 0.9),
        roughness: 0.0,
        transmission: 1.0,
        ..Material::default()
    };
    scene.materials = vec![
        glass.clone(),
        glass,
        Material {
            base_color: Rgb::new(0.7, 0.12, 0.08),
            roughness: 0.35,
            ..Material::default()
        },
        Material {
            base_color: Rgb::new(0.75, 0.74, 0.7),
            roughness: 0.7,
            ..Material::default()
        },
    ];
    scene.geometry = instances_of(&spec, &parts);
    scene.apply_section();
    weather_into(
        &mut scene,
        &parts,
        &[0.0, 0.0, 0.0, PAPER_POROSITY],
        Some(rt_core::weather::MoteSpec {
            size_mm: 0.3,
            size_var: 0.6,
            seed: spec.seed,
        }),
        FLOOR_POROSITY,
    );
    scene
}

/// S3e: the S3e parity scene after [`S3E_STEPS`] (`tests/wet_parts_s3e.rs` pins its image; `rt
/// --write-s3e-example` writes it).
pub fn s3e_scene() -> rt_core::scene::Scene {
    s3e_scene_at(S3E_STEPS)
}

/// S3e: steps of the moving parity parts (two seconds).
pub const MOVING_STEPS: u32 = 480;
/// S3e: the steps of the frames of the strip of the moving part (`docs/ui/rain-moving.png`).
pub const MOVING_STRIP_STEPS: [u32; 6] = [0, 36, 60, 84, 120, 480];

/// S3e: the moving parity parts: the parity drop scene's tilted box (its dynamic body 0) and its
/// static block, both glass, under heavy rain: the box gets wet as it falls and lands on the floor.
pub fn moving_spec() -> crate::wet_parts::PartsSpec {
    use crate::wet_parts::{
        PartsExtras, PartsSource, PartsSourceKind, PartsSpec, WetPartSpec, NO_BODY,
    };
    let scene = drop_scene();
    let part = |mesh: u32, transform: Transform, body: u32| WetPartSpec {
        mesh,
        transform,
        advancing_deg: PLASTIC_ADVANCING_DEG,
        receding_deg: PLASTIC_RECEDING_DEG,
        soak_mm_s: 0.0,
        flags: 0,
        body,
    };
    PartsSpec {
        seed: 13,
        cell_mm: 1.0,
        max_samples: 60_000,
        repose_deg: DUST_REPOSE_DEG,
        snow_repose_deg: SNOW_REPOSE_DEG,
        meshes: vec![
            parts_mesh(box_mesh(Vec3::new(30.0, 20.0, 15.0))),
            parts_mesh(box_mesh(Vec3::new(40.0, 40.0, 20.0))),
        ],
        parts: vec![
            part(0, scene.bodies[0].pieces[0].transform, 0),
            part(1, scene.bodies[3].pieces[0].transform, NO_BODY),
        ],
        sources: vec![PartsSource {
            kind: PartsSourceKind::Drops,
            density: 1.0e-4,
            velocity: Vec3::new(600.0, 0.0, -6500.0),
            size_mm: 1.4,
            size_var: 0.4,
        }],
        extras: PartsExtras {
            wind: Vec3::new(600.0, 0.0, 0.0),
            ..PartsExtras::default()
        },
    }
}

/// S3e: the moving parts of [`moving_spec`] stepped `steps` with the bodies of [`drop_scene`].
pub fn moving_parts_at(steps: u32) -> (crate::wet_parts::WetParts, crate::World) {
    let (mut world, ids) = drop_scene().build();
    let mut parts = crate::wet_parts::WetParts::new(moving_spec());
    parts.step_with(&mut world, &ids, steps);
    (parts, world)
}

/// S3e: the moving parity scene at `steps`: the box (a red plastic) where its body is then and the
/// block (a grey one), seen by a 60 mm lens at f/8, their weather and the drops in the air.
pub fn moving_scene_at(steps: u32) -> rt_core::scene::Scene {
    use rt_core::color::Rgb;
    use rt_core::scene::{FloorMode, Material};
    let spec = moving_spec();
    let (parts, _) = moving_parts_at(steps);
    let mut scene = rt_core::example::scene();
    scene.render.width = 160;
    scene.render.height = 120;
    let target = Vec3::new(-50.0, 0.0, 40.0);
    scene.camera.position = Vec3::new(-140.0, -420.0, 200.0);
    scene.camera.target = target;
    scene.camera.focal_mm = 60.0;
    scene.camera.fstop = 8.0;
    scene.camera.focus_dist = (target - scene.camera.position).length();
    scene.floor.mode = FloorMode::Visible;
    scene.floor.color = Rgb::splat(0.45);
    scene.materials = vec![
        Material {
            base_color: Rgb::new(0.65, 0.1, 0.07),
            roughness: 0.3,
            ..Material::default()
        },
        Material {
            base_color: Rgb::new(0.55, 0.55, 0.57),
            roughness: 0.5,
            ..Material::default()
        },
    ];
    scene.geometry = instances_of(&spec, &parts);
    scene.apply_section();
    weather_into(&mut scene, &parts, &[0.0, 0.0], None, FLOOR_POROSITY);
    scene
}

/// S3e: the dust sheet's parts: the bottle on a paper card of the set (a film, 700 mm square: two
/// triangles a metre long, which the budget of a third of the samples for the films leaves at a
/// cell of about 7 mm), under a *Dust cloud*'s dust, with the card's fine samples (`fine`: the two
/// triangles the bottle's shadow crosses at 2 mm, within [`DUST_EDGE_BUDGET`]) or without.
pub fn dust_spec(fine: bool) -> crate::wet_parts::PartsSpec {
    let mut spec = s3e_spec();
    spec.meshes.push(plate_mesh(700.0, 700.0, 1, 1));
    spec.extras.edge_budget = DUST_EDGE_BUDGET;
    spec.parts.truncate(1);
    spec.parts.push(crate::wet_parts::WetPartSpec {
        mesh: 4,
        transform: Transform::translation(Vec3::new(0.0, 0.0, 0.5)),
        advancing_deg: PAPER_ADVANCING_DEG,
        receding_deg: PAPER_RECEDING_DEG,
        soak_mm_s: 0.0,
        flags: crate::wet_parts::PART_FILM,
        body: crate::wet_parts::NO_BODY,
    });
    spec.sources
        .retain(|s| s.kind == crate::wet_parts::PartsSourceKind::Dust);
    spec.sources[0].velocity = Vec3::new(250.0, 150.0, -300.0);
    spec.extras.floor = None;
    if !fine {
        spec.extras.edge_cell_mm = 0.0;
        spec.extras.edge_budget = 0;
    }
    spec
}

/// S3e: the samples the fine cells of the dust sheet's card may take (the page's
/// `PARTS_EDGE_BUDGET`, ◆).
pub const DUST_EDGE_BUDGET: u32 = 300_000;

/// S3e: the dust sheet's scene at `seconds`: the bottle on the card, close, from above, its dust and
/// its motes; with the card's fine samples or without.
pub fn dust_scene_at(seconds: u32, fine: bool) -> rt_core::scene::Scene {
    use rt_core::color::Rgb;
    use rt_core::scene::{FloorMode, Material, MATERIAL_GLASS};
    let spec = dust_spec(fine);
    let mut parts = crate::wet_parts::WetParts::new(spec.clone());
    parts.step(seconds * crate::world::STEPS_PER_SECOND);
    let mut scene = rt_core::example::scene();
    scene.render.width = 160;
    scene.render.height = 120;
    let target = Vec3::new(-28.0, -40.0, 20.0);
    scene.camera.position = Vec3::new(-60.0, -260.0, 230.0);
    scene.camera.target = target;
    scene.camera.focal_mm = 90.0;
    scene.camera.fstop = 11.0;
    scene.camera.focus_dist = (target - scene.camera.position).length();
    scene.floor.mode = FloorMode::None;
    scene.materials = vec![
        Material {
            kind: MATERIAL_GLASS,
            base_color: Rgb::new(0.85, 0.95, 0.9),
            roughness: 0.0,
            transmission: 1.0,
            ..Material::default()
        },
        Material {
            base_color: Rgb::new(0.1, 0.1, 0.11),
            roughness: 0.6,
            ..Material::default()
        },
    ];
    scene.geometry = instances_of(&spec, &parts);
    scene.apply_section();
    weather_into(
        &mut scene,
        &parts,
        &[0.0, PAPER_POROSITY],
        Some(rt_core::weather::MoteSpec {
            size_mm: spec.sources[0].size_mm,
            size_var: spec.sources[0].size_var,
            seed: spec.seed,
        }),
        FLOOR_POROSITY,
    );
    scene
}

/// S3e: the frames of the S3e captures (`tools/s3e-strip.mjs`), by name: the moving box at the
/// steps of [`MOVING_STRIP_STEPS`] (`moving-<step>`), the S3e scene at 1, 3 and 5 s (`floor-<s>`),
/// the dust on the set card at 30 and 120 s (`dust-<s>`) and its shadow's edge at 120 s without and
/// with the fine samples (`edge-coarse`, `edge-fine`, a closer camera).
pub fn s3e_strip() -> Vec<(String, rt_core::scene::Scene)> {
    let mut out = Vec::new();
    for steps in MOVING_STRIP_STEPS {
        out.push((format!("moving-{steps}"), moving_scene_at(steps)));
    }
    for s in [1u32, 3, 5] {
        out.push((
            format!("floor-{s}"),
            s3e_scene_at(s * crate::world::STEPS_PER_SECOND),
        ));
    }
    // Close, on the patch the ledge keeps dry and the drips that fell on it.
    let mut close = s3e_scene();
    let target = Vec3::new(95.0, 30.0, 0.0);
    close.camera.position = target + Vec3::new(-40.0, -260.0, 230.0);
    close.camera.target = target;
    close.camera.focal_mm = 70.0;
    close.camera.focus_dist = (target - close.camera.position).length();
    out.push(("floor-close".to_string(), close));
    for s in [30u32, 120] {
        out.push((format!("dust-{s}"), dust_scene_at(s, true)));
    }
    for (name, fine) in [("edge-coarse", false), ("edge-fine", true)] {
        let mut scene = dust_scene_at(120, fine);
        // On the side edge of the bottle's dust shadow on the card.
        let target = Vec3::new(51.0, 71.0, 0.5);
        scene.camera.position = target + Vec3::new(-10.0, -110.0, 140.0);
        scene.camera.target = target;
        scene.camera.focal_mm = 100.0;
        scene.camera.focus_dist = (target - scene.camera.position).length();
        out.push((name.to_string(), scene));
    }
    out
}
