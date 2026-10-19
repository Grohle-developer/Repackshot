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

// --- S9: cloth -----------------------------------------------------------------------------------

/// S9: a fabric of `weight` g/m², `stretch` and `shear` N/m, `bend` N·m, `damping` 1/s,
/// `thickness` mm and `friction`, colliding with itself, its warp along world X.
pub const fn fabric(
    weight: f32,
    stretch: f32,
    shear: f32,
    bend: f32,
    damping: f32,
    thickness: f32,
    friction: f32,
) -> crate::cloth::ClothParams {
    crate::cloth::ClothParams {
        mass_per_area: weight / 1000.0,
        stretch,
        shear,
        bend,
        damping,
        thickness,
        friction,
        area: 0.0,
        pressure: 0.0,
        warp: crate::cloth::WARP,
        flags: crate::cloth::FLAG_SELF_COLLISION,
    }
}

/// S9: the fabric presets of `src/data/fabrics.ts`, by key and in its order (the tests and the
/// fixture `tests/fixtures/cloth-fabrics.json` check that the two agree).
pub const FABRICS: [(&str, crate::cloth::ClothParams); 11] = [
    ("SILK", fabric(60.0, 2000.0, 20.0, 3.0e-7, 0.6, 1.0, 0.3)),
    (
        "COTTON_FINE",
        fabric(120.0, 3000.0, 35.0, 5.0e-6, 0.8, 1.0, 0.5),
    ),
    ("POPLIN", fabric(150.0, 4000.0, 45.0, 8.0e-6, 0.8, 1.0, 0.5)),
    ("LINEN", fabric(200.0, 5000.0, 55.0, 2.0e-5, 1.0, 1.0, 0.55)),
    ("WOOL", fabric(300.0, 2500.0, 40.0, 3.0e-5, 1.2, 1.5, 0.6)),
    ("DENIM", fabric(400.0, 8000.0, 100.0, 6.0e-5, 1.2, 1.5, 0.6)),
    (
        "CANVAS",
        fabric(600.0, 12000.0, 140.0, 2.0e-4, 1.5, 1.5, 0.6),
    ),
    ("FELT", fabric(800.0, 3000.0, 750.0, 5.0e-4, 2.0, 3.0, 0.7)),
    (
        "LEATHER_THIN",
        fabric(900.0, 10000.0, 1000.0, 5.0e-4, 1.5, 2.0, 0.6),
    ),
    (
        "LEATHER_THICK",
        fabric(1200.0, 20000.0, 2000.0, 2.0e-3, 2.0, 3.0, 0.6),
    ),
    (
        "NEOPRENE",
        fabric(1500.0, 1500.0, 500.0, 1.5e-3, 2.5, 3.0, 0.8),
    ),
];

/// S9: silk, 60 g/m² (`SILK` of [`FABRICS`]).
pub const SILK: crate::cloth::ClothParams = FABRICS[0].1;

/// S9: denim, 400 g/m² (`DENIM` of [`FABRICS`]).
pub const DENIM: crate::cloth::ClothParams = FABRICS[5].1;

/// S9: thick leather, 1,200 g/m² (`LEATHER_THICK` of [`FABRICS`]).
pub const LEATHER_THICK: crate::cloth::ClothParams = FABRICS[9].1;

/// S9: a flat sheet of `size_x × size_y` mm centred on `center`, facing up, `nx × ny` squares each
/// split along alternating diagonals (so the sheet has no preferred direction to fold in).
pub fn cloth_sheet(
    size_x: f32,
    size_y: f32,
    nx: u32,
    ny: u32,
    center: Vec3,
) -> (Vec<Vec3>, Vec<u32>) {
    let mut positions = Vec::new();
    for j in 0..=ny {
        for i in 0..=nx {
            positions.push(Vec3::new(
                center.x + size_x * (i as f32 / nx as f32 - 0.5),
                center.y + size_y * (j as f32 / ny as f32 - 0.5),
                center.z,
            ));
        }
    }
    let at = |i: u32, j: u32| j * (nx + 1) + i;
    let mut indices = Vec::new();
    for j in 0..ny {
        for i in 0..nx {
            let (a, b, c, d) = (at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1));
            if (i + j) % 2 == 0 {
                indices.extend_from_slice(&[a, b, c, a, c, d]);
            } else {
                indices.extend_from_slice(&[a, b, d, b, c, d]);
            }
        }
    }
    (positions, indices)
}

/// S9: a flat disc of `radius` mm centred on `center`, facing up, of `rings` concentric rings of
/// vertices (ring `k` of `6 k`, evenly spaced), each joined to the one inside it by a strip of
/// triangles that advances along whichever ring's next vertex comes first by angle: triangles of
/// about the same size everywhere, with no preferred direction but the six of its sectors.
pub fn cloth_disc(radius: f32, rings: u32, center: Vec3) -> (Vec<Vec3>, Vec<u32>) {
    let mut positions = vec![center];
    let start = |k: u32| if k == 0 { 0 } else { 1 + 3 * k * (k - 1) };
    let count = |k: u32| if k == 0 { 1 } else { 6 * k };
    for k in 1..=rings {
        let r = radius * k as f32 / rings as f32;
        for i in 0..count(k) {
            let (s, c) = fmath::sin_cos(std::f32::consts::TAU * i as f32 / count(k) as f32);
            positions.push(center + Vec3::new(c * r, s * r, 0.0));
        }
    }
    let mut indices = Vec::new();
    for k in 1..=rings {
        let (outer, inner) = (count(k), count(k - 1));
        let (o0, i0) = (start(k), start(k - 1));
        let (mut i, mut j) = (0u32, 0u32);
        // Walk both rings once around by angle (as fractions of a turn: i / outer, j / inner).
        while i < outer || (k > 1 && j < inner) {
            let a = o0 + i % outer;
            let b = i0 + j % inner;
            let next_outer = (i + 1) as u64 * inner as u64;
            let next_inner = (j + 1) as u64 * outer as u64;
            if k == 1 || (i < outer && (j >= inner || next_outer <= next_inner)) {
                indices.extend_from_slice(&[b, a, o0 + (i + 1) % outer]);
                i += 1;
            } else {
                indices.extend_from_slice(&[b, a, i0 + (j + 1) % inner]);
                j += 1;
            }
        }
    }
    (positions, indices)
}

/// S9: the sphere the drape tests lay a cloth over: radius 150 mm, centre 400 mm above the floor.
pub const DRAPE_SPHERE: (Vec3, f32) = (Vec3::new(0.0, 0.0, 400.0), 150.0);

/// S9: a 600 mm square of `params` (64 × 64 squares) 20 mm above the top of [`DRAPE_SPHERE`],
/// a static UV sphere of 48 × 96, and the floor.
pub fn drape_spec(params: crate::cloth::ClothParams) -> crate::cloth::ClothSpec {
    let (c, r) = DRAPE_SPHERE;
    let (positions, indices) = cloth_sheet(600.0, 600.0, 64, 64, c + Vec3::new(0.0, 0.0, r + 20.0));
    let n = positions.len();
    let ball = sphere_mesh(r, 48, 96);
    crate::cloth::ClothSpec {
        pieces: vec![crate::cloth::ClothPiece {
            positions,
            indices,
            pinned: vec![false; n],
            params,
        }],
        statics: vec![crate::cloth::ClothStatic {
            positions: ball.positions.iter().map(|p| *p + c).collect(),
            indices: ball.indices,
        }],
        floor: Some((0.0, 0.6)),
        wind: crate::cloth::ClothWind::default(),
    }
}

/// S9: steps the cloth parity scene is simulated for (two seconds).
pub const CLOTH_STEPS: u32 = 480;

/// S9: the cloth parity scene: a box dropped onto the floor ([`cloth_world`]) and, above it, a
/// 300 mm sheet of fine cotton (24 × 24 squares, self-collision on) that falls on it in a gusty
/// 1 m/s breeze, beside a static block.
pub fn cloth_parity_spec() -> crate::cloth::ClothSpec {
    let (positions, indices) = cloth_sheet(300.0, 300.0, 24, 24, Vec3::new(20.0, 0.0, 220.0));
    let n = positions.len();
    let pinned = vec![false; n];
    let block = box_mesh(Vec3::new(40.0, 40.0, 30.0));
    crate::cloth::ClothSpec {
        pieces: vec![crate::cloth::ClothPiece {
            positions,
            indices,
            pinned,
            params: crate::cloth::ClothParams {
                mass_per_area: 0.12,
                stretch: 3000.0,
                shear: 35.0,
                bend: 5.0e-6,
                damping: 0.8,
                thickness: 1.5,
                friction: 0.4,
                area: 0.0,
                pressure: 0.0,
                warp: crate::cloth::WARP,
                flags: crate::cloth::FLAG_SELF_COLLISION,
            },
        }],
        statics: vec![crate::cloth::ClothStatic {
            positions: block
                .positions
                .iter()
                .map(|p| *p + Vec3::new(-120.0, 0.0, 30.0))
                .collect(),
            indices: block.indices,
        }],
        floor: Some((0.0, 0.6)),
        wind: crate::cloth::ClothWind {
            velocity: Vec3::new(1000.0, 300.0, 0.0),
            gust: 0.4,
            scale: 150.0,
            speed: 800.0,
            seed: 11,
        },
    }
}

/// S9: the rigid side of the cloth parity scene (`PHY1`): a box falling from 120 mm onto the floor,
/// tilted, and the static block of [`cloth_parity_spec`].
pub fn cloth_world() -> Scene {
    let params = BodyParams {
        density: 700.0,
        friction: 0.6,
        restitution: 0.1,
    };
    let tilt = Quat::from_axis_angle(Vec3::new(0.0, 1.0, 1.0), 0.4);
    Scene {
        meshes: vec![
            box_mesh(Vec3::new(50.0, 35.0, 25.0)),
            box_mesh(Vec3::new(40.0, 40.0, 30.0)),
        ],
        bodies: vec![
            SceneBody {
                dynamic: true,
                params,
                pieces: vec![Piece {
                    mesh: 0,
                    transform: Transform::from_pose(Vec3::new(30.0, 0.0, 120.0), tilt),
                }],
            },
            SceneBody {
                dynamic: false,
                params,
                pieces: vec![Piece {
                    mesh: 1,
                    transform: Transform::translation(Vec3::new(-120.0, 0.0, 30.0)),
                }],
            },
        ],
        floor: Some(Floor {
            z: 0.0,
            friction: 0.6,
            restitution: 0.1,
        }),
    }
}
