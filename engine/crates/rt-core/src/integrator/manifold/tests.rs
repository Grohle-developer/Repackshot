//! Tests of manifold next-event estimation (E13): the Newton solver against closed-form
//! refraction paths, the Jacobian against finite differences, and whole scenes (MIS, references).

use super::*;
use crate::example::icosphere;
use crate::fmath;
use crate::integrator::{BvhTracer, Prepared};
use crate::scene::{Geometry, Instance, Mesh, Transform};
use crate::simd::Isa;

/// Clear smooth glass of index `ior`.
fn glass(ior: f32) -> Material {
    Material {
        kind: MATERIAL_GLASS,
        base_color: Rgb::WHITE,
        roughness: 0.0,
        ior,
        transmission: 1.0,
        ..Material::default()
    }
}

/// An axis-aligned box with flat faces, wound outwards.
fn box_mesh(min: Vec3, max: Vec3) -> Mesh {
    let p = |x: bool, y: bool, z: bool| {
        Vec3::new(
            if x { max.x } else { min.x },
            if y { max.y } else { min.y },
            if z { max.z } else { min.z },
        )
    };
    let corners = [
        p(false, false, false),
        p(true, false, false),
        p(true, true, false),
        p(false, true, false),
        p(false, false, true),
        p(true, false, true),
        p(true, true, true),
        p(false, true, true),
    ];
    let quads = [
        [0, 3, 2, 1],
        [4, 5, 6, 7],
        [0, 1, 5, 4],
        [2, 3, 7, 6],
        [1, 2, 6, 5],
        [3, 0, 4, 7],
    ];
    let indices: Vec<u32> = quads
        .iter()
        .flat_map(|q| [q[0], q[1], q[2], q[0], q[2], q[3]])
        .collect();
    Mesh::new(&corners, &[], &indices, 0).expect("box")
}

/// A scene of one mesh of glass of index `ior`, nothing else.
fn glass_scene(mesh: Mesh, ior: f32) -> Scene {
    Scene {
        materials: vec![glass(ior)],
        geometry: Geometry::new(vec![mesh], vec![Instance::new(0, Transform::IDENTITY, 0)])
            .expect("scene"),
        ..Scene::default()
    }
}

/// The refraction of the unit direction `d` through a surface of unit normal `n` (facing the
/// side `d` comes from), from index `from` to index `to`; `None` under total internal reflection.
fn snell(d: Vec3, n: Vec3, from: f32, to: f32) -> Option<Vec3> {
    let eta = from / to;
    let cos_i = -d.dot(n);
    let sin2 = eta * eta * (1.0 - cos_i * cos_i);
    if sin2 >= 1.0 {
        return None;
    }
    Some((d * eta + n * (eta * cos_i - (1.0 - sin2).sqrt())).normalize())
}

/// Seeds and solves the path from `x` to `end` in `scene`.
fn solve_in(scene: &Scene, x: Vec3, end: End) -> (Option<Path>, usize) {
    let prepared = Prepared::new(scene);
    let tracer = BvhTracer {
        geometry: &scene.geometry,
        isa: Isa::detect(),
    };
    let (dir, distance) = match end {
        End::Point { y, .. } => unit(y - x).expect("apart"),
        End::Direction { w } => (w, f32::INFINITY),
    };
    let mut rays = 0;
    let Some(seed) = seed(&prepared, scene, &tracer, x, dir, distance, &mut rays) else {
        return (None, 0);
    };
    let path = solve(&prepared, scene, &tracer, x, &seed, &end, &mut rays);
    (path, seed.chain.len)
}

fn close(a: Vec3, b: Vec3, tol: f32) -> bool {
    (a - b).length() <= tol
}

/// The closed-form path through a slab between z = 20 and z = 30 from the origin, leaving at
/// `angle` from the vertical towards azimuth `azimuth` (degrees): its two vertices and the point
/// at z = 80 it goes on to.
fn slab_path(ior: f32, angle: f32, azimuth: f32) -> (Vec3, Vec3, Vec3) {
    let (sa, ca) = fmath::sin_cos(angle * fmath::DEG_TO_RAD);
    let sg = sa / ior;
    let cg = (1.0 - sg * sg).sqrt();
    let (tan_a, tan_g) = (sa / ca, sg / cg);
    let (sz, cz) = fmath::sin_cos(azimuth * fmath::DEG_TO_RAD);
    let along = Vec3::new(cz, sz, 0.0);
    let h1 = 20.0 * tan_a;
    let h2 = h1 + 10.0 * tan_g;
    let h3 = h2 + 50.0 * tan_a;
    (
        along * h1 + Vec3::new(0.0, 0.0, 20.0),
        along * h2 + Vec3::new(0.0, 0.0, 30.0),
        along * h3 + Vec3::new(0.0, 0.0, 80.0),
    )
}

fn slab(ior: f32) -> Scene {
    glass_scene(
        box_mesh(
            Vec3::new(-400.0, -400.0, 20.0),
            Vec3::new(400.0, 400.0, 30.0),
        ),
        ior,
    )
}

#[test]
fn newton_finds_the_closed_form_path_through_a_flat_slab() {
    for ior in [1.33f32, 1.5, 1.9] {
        let scene = slab(ior);
        for (angle, azimuth) in [
            (0.0f32, 0.0f32),
            (15.0, 30.0),
            (35.0, -100.0),
            (55.0, 200.0),
        ] {
            let (v1, v2, y) = slab_path(ior, angle, azimuth);
            // To a point (a panel facing down), and to the same direction (a sun).
            let ends = [
                End::Point {
                    y,
                    normal: Vec3::new(0.0, 0.0, -1.0),
                },
                End::Direction {
                    w: (y - v2).normalize(),
                },
            ];
            for end in ends {
                let (path, k) = solve_in(&scene, Vec3::ZERO, end);
                assert_eq!(k, 2, "two surfaces in the way");
                let path = path.unwrap_or_else(|| panic!("ior {ior}, {angle}°: no path"));
                let p = path.points();
                assert!(
                    close(p[0], v1, 2.0e-3) && close(p[1], v2, 2.0e-3),
                    "ior {ior}, {angle}° to {end:?}: {p:?} vs {v1:?}, {v2:?}"
                );
                assert!(close(path.wi(), v1.normalize(), 1.0e-4));
            }
        }
    }
}

/// A glass sphere of radius 30 at the origin, smooth (vertex normals), finely tessellated.
fn ball() -> Scene {
    glass_scene(icosphere(Vec3::ZERO, 30.0, 6), 1.5)
}

/// The closed-form path from `x` into the exact sphere of radius 30 at the origin, entering at
/// the point in direction `at` from its centre: the entry, the exit and the direction it leaves
/// in.
fn sphere_path(x: Vec3, at: Vec3, ior: f32) -> (Vec3, Vec3, Vec3) {
    let r = 30.0;
    let v1 = at.normalize() * r;
    let d = (v1 - x).normalize();
    let inside = snell(d, v1 * (1.0 / r), 1.0, ior).expect("enters");
    let v2 = v1 + inside * (-2.0 * v1.dot(inside));
    let out = snell(inside, -(v2 * (1.0 / r)), ior, 1.0).expect("leaves");
    (v1, v2, out)
}

#[test]
fn newton_finds_the_closed_form_path_through_a_sphere() {
    let scene = ball();
    let x = Vec3::new(-150.0, 10.0, 20.0);
    for at in [
        Vec3::new(-1.0, 0.1, 0.2),
        Vec3::new(-1.0, -0.3, 0.1),
        Vec3::new(-0.9, 0.2, -0.35),
    ] {
        let (v1, v2, out) = sphere_path(x, at, 1.5);
        let y = v2 + out * 120.0;
        let end = End::Point { y, normal: -out };
        let (path, k) = solve_in(&scene, x, end);
        assert_eq!(k, 2);
        let path = path.unwrap_or_else(|| panic!("{at:?}: no path"));
        let p = path.points();
        // The mesh is within 0.002 mm of the sphere and its normals within 10⁻⁴ of radial.
        assert!(
            close(p[0], v1, 0.02) && close(p[1], v2, 0.02),
            "{at:?}: {p:?} vs {v1:?}, {v2:?}"
        );
        // One surface: a light inside the glass.
        let d = (v1 - x).normalize();
        let inside = snell(d, v1 * (1.0 / 30.0), 1.0, 1.5).expect("enters");
        let y = v1 + inside * 12.0;
        let (path, k) = solve_in(
            &scene,
            x,
            End::Point {
                y,
                normal: Vec3::ZERO,
            },
        );
        assert_eq!(k, 1);
        let p = path.expect("one refraction").points();
        assert!(close(p[0], v1, 0.02), "{p:?} vs {v1:?}");
    }
}

/// `|dω/dY|` of the path from `x` to `end` by central differences of the solver itself, along the
/// end's own basis ([`end_basis`]), `h` apart.
fn jacobian_by_differences(scene: &Scene, x: Vec3, end: End, h: f32) -> f32 {
    let (centre, _) = solve_in(scene, x, end);
    let centre = centre.expect("path");
    let v = centre.vertices();
    let last = v[v.len() - 1];
    let (wb, _) = onwards(v, v.len() - 1, &end).expect("end");
    let basis = end_basis(&end, wb);
    let moved = |s: usize, sign: f32| -> Vec3 {
        let shifted = match end {
            End::Point { y, normal } => End::Point {
                y: y + basis[s] * (sign * h),
                normal,
            },
            End::Direction { w } => End::Direction {
                w: (w + basis[s] * (sign * h)).normalize(),
            },
        };
        let _ = last;
        solve_in(scene, x, shifted).0.expect("moved path").wi()
    };
    let w = centre.wi();
    let f = Frame::from_normal(w);
    let rate = |s: usize| {
        let d = (moved(s, 1.0) - moved(s, -1.0)) * (1.0 / (2.0 * h));
        (d.dot(f.x), d.dot(f.y))
    };
    let (a, b) = (rate(0), rate(1));
    (a.0 * b.1 - a.1 * b.0).abs()
}

#[test]
fn the_jacobian_is_what_finite_differences_of_the_solver_give() {
    let slab = slab(1.5);
    let (_, v2, y) = slab_path(1.5, 35.0, 20.0);
    let ball = ball();
    let x = Vec3::new(-150.0, 10.0, 20.0);
    let (_, w2, out) = sphere_path(x, Vec3::new(-1.0, 0.1, 0.2), 1.5);
    let cases: [(&Scene, Vec3, End, f32); 5] = [
        // A panel seen through a slab, a point light across its beam, a sun.
        (
            &slab,
            Vec3::ZERO,
            End::Point {
                y,
                normal: Vec3::new(0.3, 0.0, -1.0).normalize(),
            },
            1.0,
        ),
        (
            &slab,
            Vec3::ZERO,
            End::Point {
                y,
                normal: Vec3::ZERO,
            },
            1.0,
        ),
        (
            &slab,
            Vec3::ZERO,
            End::Direction {
                w: (y - v2).normalize(),
            },
            0.01,
        ),
        // Through the ball (it focuses: the Jacobian is far from the straight one's).
        (
            &ball,
            x,
            End::Point {
                y: w2 + out * 120.0,
                normal: -out,
            },
            0.5,
        ),
        (&ball, x, End::Direction { w: out }, 0.003),
    ];
    for (scene, x, end, h) in cases {
        let analytic = solve_in(scene, x, end).0.expect("path").jacobian;
        let numeric = jacobian_by_differences(scene, x, end, h);
        eprintln!("jacobian {analytic:.6e} vs differences {numeric:.6e}");
        assert!(
            (analytic / numeric - 1.0).abs() < 0.01,
            "{end:?}: {analytic} vs {numeric}"
        );
    }
}

#[test]
fn through_a_thin_flat_pane_the_jacobian_is_nearly_the_straight_one() {
    // A pane of 0.5 mm shifts the path by less than that: |dω/dA| ≈ cos θy / d². (Its corners
    // are 100 mm away: the vertices are interpolated from them, and a pane of 800 mm in two
    // triangles would place them only to 5·10⁻⁵ mm, a tenth of the half vector's tolerance
    // across 0.5 mm.)
    let scene = glass_scene(
        box_mesh(
            Vec3::new(-100.0, -100.0, 50.0),
            Vec3::new(100.0, 100.0, 50.5),
        ),
        1.5,
    );
    let y = Vec3::new(40.0, -20.0, 300.0);
    let normal = Vec3::new(0.0, 0.0, -1.0);
    let path = solve_in(&scene, Vec3::ZERO, End::Point { y, normal })
        .0
        .expect("path");
    let d = y.length();
    let straight = (y.z / d) / (d * d);
    assert!(
        (path.jacobian / straight - 1.0).abs() < 0.01,
        "{} vs {straight}",
        path.jacobian
    );
}

#[test]
fn seeds_are_one_or_two_chain_surfaces_and_nothing_else() {
    // Two slabs in a row are four surfaces: not a seed. Rough glass is not a chain surface.
    let two = Scene {
        materials: vec![glass(1.5)],
        geometry: Geometry::from_meshes(vec![
            box_mesh(
                Vec3::new(-400.0, -400.0, 20.0),
                Vec3::new(400.0, 400.0, 30.0),
            ),
            box_mesh(
                Vec3::new(-400.0, -400.0, 40.0),
                Vec3::new(400.0, 400.0, 50.0),
            ),
        ]),
        ..Scene::default()
    };
    let up = End::Direction {
        w: Vec3::new(0.0, 0.0, 1.0),
    };
    assert_eq!(solve_in(&two, Vec3::ZERO, up).1, 0);
    assert!(solve_in(&slab(1.5), Vec3::ZERO, up).0.is_some());
    let mut rough = slab(1.5);
    rough.materials[0].roughness = 0.2;
    assert_eq!(solve_in(&rough, Vec3::ZERO, up).1, 0);
    assert!(!is_chain_material(&rough.materials[0]));
    // What the E9b wall takes, the connection takes (and no more: a coat, a cut-out, a medium,
    // dispersion, a thin wall, an index near one are not).
    for (m, chain) in [
        (
            Material {
                roughness: 0.05,
                ..glass(1.5)
            },
            true,
        ),
        (
            Material {
                coat: 0.5,
                ..glass(1.5)
            },
            false,
        ),
        (
            Material {
                opacity: 0.5,
                ..glass(1.5)
            },
            false,
        ),
        (
            Material {
                scatter_mm: 1.0,
                ..glass(1.5)
            },
            false,
        ),
        (
            Material {
                abbe: 40.0,
                ..glass(1.5)
            },
            false,
        ),
        (
            Material {
                flags: crate::scene::MATERIAL_FLAG_THIN,
                ..glass(1.5)
            },
            false,
        ),
        (glass(1.005), false),
    ] {
        assert_eq!(is_chain_material(&m), chain, "{m:?}");
    }
}

// Whole scenes.

use crate::image::Film;
use crate::light::Techniques;
use crate::render::{render_tile_prepared, TileRect};
use crate::scene::{
    Camera, Environment, Light, LightKind, RenderSettings, BACKGROUND_COLOR, LIGHT_FLAG_GLOSSY,
    MATERIAL_EMISSIVE, MATERIAL_FLAG_LIGHT,
};

/// Renders samples `0..spp` of the whole image with `prepared` (one thread).
fn render_with(scene: &Scene, prepared: &Prepared, spp: u32) -> Film {
    let (w, h) = (scene.render.width, scene.render.height);
    let mut film = Film::new(w, h);
    let tile = TileRect { x: 0, y: 0, w, h };
    for s in 0..spp {
        render_tile_prepared(scene, prepared, tile, s, &mut film, Isa::detect());
    }
    film
}

/// Mean of the green channel of the whole image.
fn green(film: &Film) -> f64 {
    let p = film.resolve();
    p.iter()
        .skip(1)
        .step_by(3)
        .map(|&v| f64::from(v))
        .sum::<f64>()
        / (p.len() / 3) as f64
}

/// A Lambertian material without a specular lobe.
fn lambert(albedo: f32) -> Material {
    Material {
        base_color: Rgb::splat(albedo),
        ior: 1.0,
        ..Material::default()
    }
}

/// A square of half-size `half` at height `z` facing up.
fn quad(half: f32, z: f32) -> Mesh {
    Mesh::new(
        &[
            Vec3::new(-half, -half, z),
            Vec3::new(half, -half, z),
            Vec3::new(half, half, z),
            Vec3::new(-half, half, z),
        ],
        &[],
        &[0, 1, 2, 0, 2, 3],
        0,
    )
    .expect("quad")
}

/// A white floor (albedo 0.8) under the 10 mm slab of glass between z = 40 and z = 50, seen
/// from below the slab by an orthographic camera looking down, `width` mm across, lit by
/// `lights` in a black world, `depth` vertices deep.
fn floor_under_slab(lights: Vec<Light>, width: f32, depth: u32) -> Scene {
    Scene {
        camera: Camera {
            position: Vec3::new(0.0, 0.0, 20.0),
            target: Vec3::ZERO,
            up: Vec3::new(0.0, 1.0, 0.0),
            ortho: true,
            ortho_width: width,
            ..Camera::default()
        },
        materials: vec![lambert(0.8), glass(1.5)],
        geometry: Geometry::new(
            vec![
                quad(2000.0, 0.0),
                box_mesh(
                    Vec3::new(-600.0, -600.0, 40.0),
                    Vec3::new(600.0, 600.0, 50.0),
                ),
            ],
            vec![
                Instance::new(0, Transform::IDENTITY, 0),
                Instance::new(1, Transform::IDENTITY, 1),
            ],
        )
        .expect("scene"),
        lights,
        environment: Environment {
            strength: 0.0,
            background_color: Rgb::BLACK,
            background_mode: BACKGROUND_COLOR,
            ..Environment::default()
        },
        render: RenderSettings {
            width: 8,
            height: 8,
            tonemap: 0,
            max_depth: depth,
            ..RenderSettings::default()
        },
        ..Scene::default()
    }
}

fn panel(position: Vec3, size: f32, power: f32) -> Light {
    Light {
        kind: LightKind::Rect,
        position,
        direction: Vec3::new(0.0, 0.0, -1.0),
        up: Vec3::new(0.0, 1.0, 0.0),
        size_x: size,
        size_y: size,
        color: Rgb::WHITE,
        power,
        spread_deg: 180.0,
        angle_deg: 0.0,
        flags: LIGHT_FLAG_GLOSSY,
    }
}

#[test]
fn a_point_light_lights_through_a_slab_as_its_image_does() {
    // A point light 300 mm above the floor through 10 mm of glass of index 1.5: under it the
    // floor sees the light's image raised by t (1 - 1/n) = 3.33 mm, and the two faces keep
    // (1 - R)² of it, so E = I (1 - R)² / (H - t (1 - 1/n))² (paraxial). Before E13 no technique
    // found a point light through glass: the floor was black.
    let power = 4.0;
    let mut light = panel(Vec3::new(0.0, 0.0, 300.0), 0.0, power);
    light.kind = LightKind::Point;
    let scene = floor_under_slab(vec![light], 2.0, 1);
    let got = green(&render_with(&scene, &Prepared::new(&scene), 16));
    let r = f64::from(fresnel_dielectric(1.0, 1.5));
    let h = (300.0 - 10.0 * (1.0 - 1.0 / 1.5)) * 1.0e-3;
    let intensity = f64::from(power) / (4.0 * std::f64::consts::PI);
    let want = 0.8 / std::f64::consts::PI * intensity * (1.0 - r) * (1.0 - r) / (h * h);
    eprintln!("point light through a slab: {got:.6} vs {want:.6}");
    assert!((got / want - 1.0).abs() < 0.003, "{got} vs {want}");
    let mut without = Prepared::new(&scene);
    without.manifold = false;
    assert_eq!(green(&render_with(&scene, &without, 4)), 0.0);
}

#[test]
fn a_sun_lights_through_a_pane_with_the_fresnel_of_both_faces() {
    // A delta sun 30° from the zenith through the slab: the direction is kept, each face keeps
    // 1 - F(30°) (the inside's angle has the same Fresnel), E = E_sun cos 30° (1 - F)².
    let (s, c) = fmath::sin_cos(30.0 * fmath::DEG_TO_RAD);
    let sun = Light {
        kind: LightKind::Sun,
        direction: -Vec3::new(s, 0.0, c),
        color: Rgb::WHITE,
        power: 2.0,
        angle_deg: 0.0,
        flags: LIGHT_FLAG_GLOSSY,
        ..Light::default()
    };
    let scene = floor_under_slab(vec![sun], 20.0, 1);
    let got = green(&render_with(&scene, &Prepared::new(&scene), 4));
    let f = f64::from(fresnel_dielectric(c, 1.5));
    let want = 0.8 / std::f64::consts::PI * 2.0 * f64::from(c) * (1.0 - f) * (1.0 - f);
    eprintln!("sun through a pane: {got:.6} vs {want:.6}");
    assert!((got / want - 1.0).abs() < 0.002, "{got} vs {want}");
}

/// The mean of `scene` rendered by both techniques under MIS, by next-event estimation alone (the
/// connections) and by BSDF sampling alone.
fn three_techniques(scene: &Scene, spp: u32) -> [f64; 3] {
    [
        Techniques::Mis,
        Techniques::LightsOnly,
        Techniques::BsdfOnly,
    ]
    .map(|t| {
        let mut prepared = Prepared::new(scene);
        prepared.lights.techniques = t;
        green(&render_with(scene, &prepared, spp))
    })
}

#[test]
fn light_through_glass_is_counted_once_with_either_technique_and_with_both() {
    // A panel above the slab lights the floor only through it: by the connections, by BSDF
    // samples that refract twice onto the panel, or by both under MIS, the floor gets the same
    // light. Without the BSDF side's factor it would get it twice.
    let scene = floor_under_slab(
        vec![panel(Vec3::new(30.0, 0.0, 300.0), 120.0, 3.0)],
        40.0,
        8,
    );
    let [mis, lights, bsdf] = three_techniques(&scene, 2048);
    eprintln!("floor under a slab: MIS {mis:.5}, connections {lights:.5}, BSDF {bsdf:.5}");
    assert!(mis > 0.0);
    for (name, v) in [("connections", lights), ("BSDF", bsdf)] {
        assert!((v / mis - 1.0).abs() < 0.02, "{name} {v} vs MIS {mis}");
    }
}

#[test]
fn next_event_estimation_and_bsdf_rays_give_a_connection_the_same_density() {
    // The density manifold next-event estimation draws a point with and the one the BSDF side
    // weighs the same point of the same light with are one function: for every kind of light, a
    // sample at x and the light found there agree.
    let emitter = Material {
        kind: MATERIAL_EMISSIVE,
        emission: Rgb::WHITE,
        emission_power: 1.0,
        flags: MATERIAL_FLAG_LIGHT,
        ..Material::default()
    };
    let mut spot = panel(Vec3::new(-150.0, 80.0, 250.0), 30.0, 3.0);
    spot.kind = LightKind::Spot;
    spot.direction = Vec3::new(0.5, -0.2, -1.0).normalize();
    spot.spread_deg = 60.0;
    let mut ball = panel(Vec3::new(120.0, -60.0, 200.0), 40.0, 2.0);
    ball.kind = LightKind::Point;
    let mut disk = panel(Vec3::new(0.0, 150.0, 260.0), 80.0, 2.0);
    disk.kind = LightKind::Disk;
    disk.direction = Vec3::new(0.0, -0.5, -1.0).normalize();
    let sun = Light {
        kind: LightKind::Sun,
        direction: -Vec3::new(0.3, 0.2, 1.0).normalize(),
        color: Rgb::WHITE,
        power: 2.0,
        angle_deg: 4.0,
        flags: LIGHT_FLAG_GLOSSY,
        ..Light::default()
    };
    let scene = Scene {
        materials: vec![lambert(0.5), emitter],
        geometry: Geometry::new(
            vec![
                quad(1000.0, 0.0),
                icosphere(Vec3::new(-80.0, -120.0, 180.0), 25.0, 2),
            ],
            vec![
                Instance::new(0, Transform::IDENTITY, 0),
                Instance::new(1, Transform::IDENTITY, 1),
            ],
        )
        .expect("scene"),
        lights: vec![
            panel(Vec3::new(40.0, 0.0, 300.0), 120.0, 3.0),
            disk,
            ball,
            spot,
            sun,
        ],
        ..Scene::default()
    };
    let lights = Lights::new(&scene);
    let x = Vec3::new(5.0, -3.0, 1.0);
    let selection = lights.select(x);
    let mut kinds = std::collections::BTreeSet::new();
    let mut rng = crate::rng::Pcg32::seeded(13, 7);
    for _ in 0..4000 {
        let u = (rng.next_f32(), (rng.next_f32(), rng.next_f32()));
        let Some(ls) = lights.sample_selected(&selection, u.0, u.1) else {
            continue;
        };
        let Some(end) = lights.manifold_end(&ls, x) else {
            continue; // the environment
        };
        if end.delta {
            continue; // no BSDF ray finds it
        }
        let at = match end.end {
            End::Point { y, .. } => y,
            End::Direction { w } => w,
        };
        let found = Found {
            entry: ls.entry,
            at,
            normal: ls.normal,
        };
        let back = lights
            .manifold_found(found, x, &selection)
            .unwrap_or_else(|| panic!("a sample the BSDF side cannot weigh: {ls:?}"));
        assert!(
            (back.density / end.density - 1.0).abs() < 1.0e-3,
            "{ls:?}: {} vs {}",
            back.density,
            end.density
        );
        kinds.insert(ls.entry);
    }
    // The panel, the disk, the ball, the spot's ball, the sun's disc and the emitter.
    assert_eq!(kinds.len(), 6, "{kinds:?}");
}

#[test]
fn on_faceted_glass_the_paths_through_other_facets_keep_their_weight() {
    // A disc light inside a flat-shaded glass ball lights a white block behind it. Through flat
    // facets every facet that can refract the light onto a point has its own path, and Newton's
    // method from the straight seed finds one: a BSDF path through a neighbouring facet, whose
    // direction may be within a degree of it, is not the path the connection drew and must keep
    // its whole weight (the BSDF side solves the specular path through the path's own facets and
    // compares). With MIS the block gets what BSDF sampling alone gives it; taking every close
    // path for the connection's lost 43 % of it.
    let mut ball = icosphere(Vec3::new(0.0, 0.0, 40.0), 40.0, 4);
    ball = Mesh::new(
        &(0..ball.vertex_count())
            .filter_map(|i| ball.position(i))
            .collect::<Vec<_>>(),
        &[],
        ball.indices(),
        0,
    )
    .expect("ball");
    let scene = Scene {
        camera: Camera {
            position: Vec3::new(0.0, 1000.0, 75.0),
            target: Vec3::new(0.0, 0.0, 75.0),
            up: Vec3::new(0.0, 0.0, 1.0),
            ortho: true,
            ortho_width: 300.0,
            ..Camera::default()
        },
        materials: vec![glass(1.5), lambert(0.8)],
        geometry: Geometry::new(
            vec![
                ball,
                box_mesh(
                    Vec3::new(-150.0, -110.0, 0.0),
                    Vec3::new(150.0, -80.0, 150.0),
                ),
            ],
            vec![
                Instance::new(0, Transform::IDENTITY, 0),
                Instance::new(1, Transform::IDENTITY, 1),
            ],
        )
        .expect("scene"),
        lights: vec![Light {
            kind: LightKind::Disk,
            position: Vec3::new(0.0, -5.0, 40.0),
            direction: Vec3::new(0.0, -1.0, 0.0),
            up: Vec3::new(0.0, 0.0, 1.0),
            size_x: 50.0,
            power: 2.0,
            flags: LIGHT_FLAG_GLOSSY,
            ..Light::default()
        }],
        environment: Environment {
            strength: 0.0,
            background_color: Rgb::BLACK,
            background_mode: BACKGROUND_COLOR,
            ..Environment::default()
        },
        render: RenderSettings {
            width: 16,
            height: 16,
            tonemap: 0,
            max_depth: 16,
            ..RenderSettings::default()
        },
        ..Scene::default()
    };
    let [mis, lights, bsdf] = three_techniques(&scene, 512);
    eprintln!("faceted ball: MIS {mis:.5}, connections {lights:.5}, BSDF {bsdf:.5}");
    assert!(bsdf > 0.0);
    assert!((mis / bsdf - 1.0).abs() < 0.03, "MIS {mis} vs BSDF {bsdf}");
}

/// Seeds the path from `x` to `end` in `scene` and solves it as the connection does (the straight
/// seed, then the one traced from the light): the straight seed's own solve, and the connection.
fn connect_in(scene: &Scene, x: Vec3, end: End) -> Option<(Option<Path>, Option<Path>)> {
    let prepared = Prepared::new(scene);
    let tracer = BvhTracer {
        geometry: &scene.geometry,
        isa: Isa::detect(),
    };
    let (dir, distance) = match end {
        End::Point { y, .. } => unit(y - x).expect("apart"),
        End::Direction { w } => (w, f32::INFINITY),
    };
    let mut rays = 0;
    let seed = seed(&prepared, scene, &tracer, x, dir, distance, &mut rays)?;
    if seed.chain.len != 2 {
        return None;
    }
    let straight = solve(&prepared, scene, &tracer, x, &seed, &end, &mut rays);
    let path = connection_path(&prepared, scene, &tracer, x, &seed, &end, &mut rays);
    Some((straight, path))
}

#[test]
fn the_seed_from_the_light_finds_the_sphere_paths_the_straight_seed_misses() {
    // Paths through the ball from a point just under it to lights far above, built in closed
    // form (each has a solution): they bend far from the straight line between their ends, and
    // the straight seed is mostly in another basin. The seed traced from the light finds some
    // of those it misses (within the 8 projections; most stay unsolved, the ROADMAP's E13).
    let scene = ball();
    let x = Vec3::new(4.0, 3.0, -40.0);
    let (mut cases, mut straight, mut connected) = (0, 0, 0);
    for i in 0..9 {
        for j in 0..9 {
            let at = Vec3::new(-0.8 + 0.2 * i as f32, -0.8 + 0.2 * j as f32, -1.0);
            let (_, v2, out) = sphere_path(x, at, 1.5);
            let y = v2 + out * 300.0;
            let end = End::Point { y, normal: -out };
            let Some((alone, path)) = connect_in(&scene, x, end) else {
                continue;
            };
            cases += 1;
            straight += usize::from(alone.is_some());
            if let Some(path) = path {
                // A refraction path of the exact sphere (a lens may have more than one between
                // two points, so not necessarily the one `at` was built from): Snell's law about
                // the radial normal at both vertices.
                let p = path.points();
                let inside = snell((p[0] - x).normalize(), p[0].normalize(), 1.0, 1.5);
                let inside = inside.expect("enters");
                let out = snell(inside, -p[1].normalize(), 1.5, 1.0).expect("leaves");
                assert!(
                    (p[0].length() - 30.0).abs() < 0.01 && (p[1].length() - 30.0).abs() < 0.01,
                    "{at:?}: {p:?}"
                );
                assert!(
                    (p[1] - p[0]).normalize().dot(inside) > 0.99999
                        && (y - p[1]).normalize().dot(out) > 0.99999,
                    "{at:?}: {p:?}"
                );
                connected += 1;
            }
        }
    }
    eprintln!(
        "under a ball: {cases} paths whose straight line crosses it twice; solved from the \
         straight seed {straight}, by the connection {connected}"
    );
    assert!(cases >= 60, "{cases}");
    assert!(straight > 0, "{straight}");
    assert!(connected > straight, "{connected} vs {straight}");
}
