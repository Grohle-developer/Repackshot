//! Tests of the edge bevel: the normal on a cube, at corners, along curved edges, across meshes
//! of one part, on open rims and in concave corners; untouched where there is nothing to round;
//! renders that show the edge catching light that misses it without the bevel.

use super::*;
use crate::color::Rgb;
use crate::geometry::edges::faceted_box;
use crate::geometry::{Geometry, Instance, Mesh, Transform};
use crate::image::Film;
use crate::integrator::Prepared;
use crate::render::{render_tile_prepared, TileRect};
use crate::scene::{
    Camera, EnvKind, Environment, Light, LightKind, Material, RenderSettings, BACKGROUND_COLOR,
    BACKGROUND_ENVIRONMENT, LIGHT_FLAG_GLOSSY,
};
use crate::simd::Isa;

const HALF: f32 = 10.0;
const R: f32 = 2.0;

fn bevelled(r: f32) -> Material {
    Material {
        base_color: Rgb::splat(0.5),
        bevel_mm: r,
        ..Material::default()
    }
}

fn scene_of(meshes: Vec<Mesh>, instances: Vec<Instance>, materials: Vec<Material>) -> Scene {
    Scene {
        materials,
        geometry: Geometry::new(meshes, instances).expect("geometry"),
        ..Scene::default()
    }
}

/// A cube of side 20 centred at the origin with bevel `r`.
fn cube_scene(r: f32) -> Scene {
    let cube = faceted_box(Vec3::splat(-HALF), Vec3::splat(HALF), false);
    scene_of(
        vec![cube],
        vec![Instance::new(0, Transform::IDENTITY, 0)],
        vec![bevelled(r)],
    )
}

/// The shading point where a ray from `from` along `dir` hits the scene.
fn shade(scene: &Scene, from: Vec3, dir: Vec3) -> ShadingPoint {
    let setup = BevelSetup::new(scene);
    let ray = Ray::new(from, dir);
    let hit = scene.geometry.intersect(&ray).expect("hit");
    setup.shading_point(scene, &ray, &hit)
}

/// The normal on the top face (z = top) at `(x, y)`.
fn top_normal(scene: &Scene, x: f32, y: f32) -> Vec3 {
    shade(scene, Vec3::new(x, y, 100.0), Vec3::new(0.0, 0.0, -1.0)).normal
}

fn close(a: Vec3, b: Vec3, tolerance: f32) -> bool {
    (a - b).length() <= tolerance
}

#[test]
fn a_cube_rounds_only_within_the_radius_of_its_edges() {
    let scene = cube_scene(R);
    let up = Vec3::new(0.0, 0.0, 1.0);
    // The centre and everything at or beyond the radius keep the face normal, bit for bit.
    for (x, y) in [
        (0.0, 0.0),
        (HALF - R, 0.0),
        (HALF - 2.5, 3.0),
        (-HALF + R, 1.0),
    ] {
        assert_eq!(top_normal(&scene, x, y), up, "at ({x}, {y})");
    }
    // Within it, the normal of a fillet of radius R: normalize((R - d) x + R z).
    for d in [1.9, 1.5, 1.0, 0.5, 0.1, 0.001] {
        let n = top_normal(&scene, HALF - d, 0.0);
        let want = Vec3::new(R - d, 0.0, R).normalize();
        assert!(close(n, want, 2.0e-5), "d {d}: {n:?} vs {want:?}");
        assert!((n.length() - 1.0).abs() < 1.0e-6);
    }
    // At the edge, the bisector of the two faces.
    let at_edge = top_normal(&scene, HALF - 1.0e-4, 0.0);
    assert!(close(at_edge, Vec3::new(1.0, 0.0, 1.0).normalize(), 1.0e-4));
}

#[test]
fn both_faces_of_an_edge_round_symmetrically() {
    let scene = cube_scene(R);
    for d in [1.7, 1.0, 0.3] {
        let top = top_normal(&scene, HALF - d, 2.0);
        let side = shade(
            &scene,
            Vec3::new(100.0, 2.0, HALF - d),
            Vec3::new(-1.0, 0.0, 0.0),
        )
        .normal;
        // Mirror images across the plane of the bisector: swap x and z.
        assert!(
            close(top, Vec3::new(side.z, side.y, side.x), 2.0e-5),
            "{top:?} {side:?}"
        );
    }
}

#[test]
fn a_cube_corner_rounds_like_a_sphere() {
    // Near a corner the offset satisfies both edges at once: the normal of a box rounded by a
    // sphere, normalize((R - dx) x + (R - dy) y + R z).
    let scene = cube_scene(R);
    for (dx, dy) in [(0.5, 0.5), (1.5, 0.2), (0.1, 1.9), (1.0, 3.0)] {
        let n = top_normal(&scene, HALF - dx, HALF - dy);
        let want = Vec3::new((R - dx).max(0.0), (R - dy).max(0.0), R).normalize();
        assert!(close(n, want, 3.0e-5), "({dx}, {dy}): {n:?} vs {want:?}");
    }
}

#[test]
fn a_smooth_sphere_is_untouched() {
    let sphere = crate::example::icosphere(Vec3::ZERO, 50.0, 2);
    let scene = scene_of(
        vec![sphere],
        vec![Instance::new(0, Transform::IDENTITY, 0)],
        vec![bevelled(5.0)],
    );
    let plain = {
        let mut s = scene.clone();
        s.materials[0].bevel_mm = 0.0;
        s
    };
    assert!(scene.geometry.meshes()[0].sharp_edges().is_empty());
    let (with, without) = (BevelSetup::new(&scene), BevelSetup::new(&plain));
    assert!(!with.is_empty() && without.is_empty());
    let mut rng = crate::rng::Pcg32::seeded(3, 9);
    for _ in 0..200 {
        let dir = Vec3::new(
            rng.next_f32() - 0.5,
            rng.next_f32() - 0.5,
            rng.next_f32() - 0.5,
        )
        .normalize();
        let ray = Ray::new(dir * -300.0, dir);
        let hit = scene.geometry.intersect(&ray).expect("hit");
        assert_eq!(
            with.shading_point(&scene, &ray, &hit),
            without.shading_point(&plain, &ray, &hit)
        );
    }
}

/// A flat-shaded prism of `sides` around Z: radius `radius`, from z = 0 to `height`, capped.
fn prism(sides: u32, radius: f32, height: f32) -> Mesh {
    let mut p = vec![Vec3::new(0.0, 0.0, 0.0), Vec3::new(0.0, 0.0, height)];
    for i in 0..sides {
        let (s, c) = crate::fmath::sin_cos(crate::fmath::TAU * i as f32 / sides as f32);
        p.push(Vec3::new(radius * c, radius * s, 0.0));
        p.push(Vec3::new(radius * c, radius * s, height));
    }
    let mut idx = Vec::new();
    for i in 0..sides {
        let j = (i + 1) % sides;
        let (b0, t0, b1, t1) = (2 + 2 * i, 3 + 2 * i, 2 + 2 * j, 3 + 2 * j);
        idx.extend_from_slice(&[0, b1, b0, 1, t0, t1, b0, b1, t1, b0, t1, t0]);
    }
    Mesh::new(&p, &[], &idx, 0).expect("prism")
}

#[test]
fn curved_edges_do_not_bead_at_their_vertices() {
    // A 48-sided prism: its rim is a chain of 2.6 mm segments, 7.5° apart. At the same distance
    // from the rim, the normal turns as much at a vertex of the chain as in the middle of a
    // segment (the exact rounded prism differs by 1/cos 3.75°), not twice as much.
    let sides = 48;
    let (radius, height, r) = (20.0, 20.0, 1.0);
    let scene = scene_of(
        vec![prism(sides, radius, height)],
        vec![Instance::new(0, Transform::IDENTITY, 0)],
        vec![bevelled(r)],
    );
    let edges = scene.geometry.meshes()[0].sharp_edges();
    assert_eq!(edges.edges().len(), 2 * sides as usize);
    let half = crate::fmath::PI / sides as f32;
    let inradius = radius * crate::fmath::cos(half);
    for d in [0.8f32, 0.5, 0.2] {
        let tilt = |angle: f32, rho: f32| {
            let (s, c) = crate::fmath::sin_cos(angle);
            let n = top_normal(&scene, rho * c, rho * s);
            (n.x * n.x + n.y * n.y).sqrt() / n.z
        };
        // Mid-segment: the rim's line is `inradius` away along this direction.
        let mid = tilt(3.0 * 2.0 * half + half, inradius - d);
        // A vertex direction: the two segments' lines are d away from a point at
        // (radius - d / cos(half)) along it.
        let vertex = tilt(3.0 * 2.0 * half, radius - d / crate::fmath::cos(half));
        let want = (r - d) / r;
        assert!((mid - want).abs() < 1.0e-3, "mid {mid} vs {want}");
        let exact = want / crate::fmath::cos(half);
        assert!(
            (vertex - exact).abs() < 2.0e-3,
            "vertex {vertex} vs {exact}"
        );
    }
}

#[test]
fn the_lift_of_a_curved_edge_stays_inside_the_faces_it_rounds() {
    // Points on the wall of the 48-sided prism just below its top rim, near a vertex of the
    // rim's chain (where the next segment is within the radius too): the rays leave from a
    // point lifted towards the fillet's outside, which must stay below the plane of the top
    // face (one edge's lift keeps it there). Lifting by a farther segment pushed it through:
    // on the interface's example bottle the cap's rim, resting on the collar, went black.
    let sides = 48;
    let (radius, height, r) = (20.0, 20.0, 1.0);
    let scene = scene_of(
        vec![prism(sides, radius, height)],
        vec![Instance::new(0, Transform::IDENTITY, 0)],
        vec![bevelled(r)],
    );
    let step = crate::fmath::TAU / sides as f32;
    let (s0, c0) = crate::fmath::sin_cos(5.0 * step);
    let (s1, c1) = crate::fmath::sin_cos(6.0 * step);
    let (v0, v1) = (
        Vec3::new(radius * c0, radius * s0, 0.0),
        Vec3::new(radius * c1, radius * s1, 0.0),
    );
    let outward = Vec3::new(c0 + c1, s0 + s1, 0.0).normalize();
    let mut lifted = 0;
    for along in [0.02f32, 0.1, 0.25, 0.5] {
        // On the segment from v0 towards v1, `along` mm from the vertex v0.
        let on_wall = v0 + (v1 - v0).normalize() * along;
        for h in [0.005f32, 0.02, 0.1, 0.4, 0.9] {
            let at = Vec3::new(on_wall.x, on_wall.y, height - h);
            let sp = shade(&scene, at + outward * 50.0, -outward);
            assert!(sp.point.z < height, "along {along}, h {h}: {:?}", sp.point);
            if sp.point.z > at.z + 1.0e-4 {
                lifted += 1;
            }
        }
    }
    assert!(lifted > 0);
}

#[test]
fn a_part_split_in_meshes_rounds_like_one_mesh_and_seams_stay_flat() {
    // The cube with its top face sent as a mesh of its own (the same transform, as the
    // interface sends a part with face materials): the top's rim is still a sharp edge.
    let whole = faceted_box(Vec3::splat(-HALF), Vec3::splat(HALF), false);
    let positions: Vec<Vec3> = (0..whole.vertex_count())
        .filter_map(|i| whole.position(i))
        .collect();
    let indices = whole.indices();
    // Faces in faceted_box order: bottom, top, front, back, left, right (two triangles each).
    let top: Vec<u32> = indices[6..12].to_vec();
    let rest: Vec<u32> = indices[..6].iter().chain(&indices[12..]).copied().collect();
    let split = scene_of(
        vec![
            Mesh::new(&positions, &[], &rest, 0).expect("rest"),
            Mesh::new(&positions, &[], &top, 0).expect("top"),
        ],
        vec![
            Instance::new(0, Transform::IDENTITY, 0),
            Instance::new(1, Transform::IDENTITY, 1),
        ],
        vec![bevelled(R), bevelled(R)],
    );
    let one = cube_scene(R);
    for (x, y) in [
        (HALF - 0.5, 0.0),
        (HALF - 1.5, HALF - 0.7),
        (0.0, -HALF + 1.0),
    ] {
        let (a, b) = (top_normal(&split, x, y), top_normal(&one, x, y));
        assert!(close(a, b, 1.0e-6), "top ({x}, {y}): {a:?} vs {b:?}");
    }
    let from_side = |s: &Scene| {
        shade(
            s,
            Vec3::new(100.0, 0.0, HALF - 0.6),
            Vec3::new(-1.0, 0.0, 0.0),
        )
        .normal
    };
    assert!(close(from_side(&split), from_side(&one), 1.0e-6));
    assert!(from_side(&one).z > 0.3);

    // A flat square sent as two halves: the seam between them is not an edge.
    let half_quad = |x0: f32, x1: f32| {
        Mesh::new(
            &[
                Vec3::new(x0, -HALF, 0.0),
                Vec3::new(x1, -HALF, 0.0),
                Vec3::new(x1, HALF, 0.0),
                Vec3::new(x0, HALF, 0.0),
            ],
            &[],
            &[0, 1, 2, 0, 2, 3],
            0,
        )
        .expect("quad")
    };
    let halves = scene_of(
        vec![half_quad(-HALF, 0.0), half_quad(0.0, HALF)],
        vec![
            Instance::new(0, Transform::IDENTITY, 0),
            Instance::new(1, Transform::IDENTITY, 0),
        ],
        vec![bevelled(R)],
    );
    let up = Vec3::new(0.0, 0.0, 1.0);
    for x in [-0.5, -0.01, 0.01, 1.0] {
        let n = shade(&halves, Vec3::new(x, 0.0, 50.0), Vec3::new(0.0, 0.0, -1.0)).normal;
        assert_eq!(n, up, "at the seam, x = {x}");
    }
    // The outer rim is open: it rounds over towards the outside.
    let rim = shade(
        &halves,
        Vec3::new(HALF - 0.5, 0.0, 50.0),
        Vec3::new(0.0, 0.0, -1.0),
    )
    .normal;
    assert!(close(rim, Vec3::new(R - 0.5, 0.0, R).normalize(), 2.0e-5));
}

#[test]
fn concave_edges_round_as_an_inside_fillet() {
    // A floor (z = 0, x from 0 to 40) meeting a wall (x = 0) that rises from it: the floor's
    // normal near the wall turns away from it, as the fillet filling the corner would.
    let floor_and_wall = Mesh::new(
        &[
            Vec3::new(0.0, -20.0, 0.0),
            Vec3::new(40.0, -20.0, 0.0),
            Vec3::new(40.0, 20.0, 0.0),
            Vec3::new(0.0, 20.0, 0.0),
            Vec3::new(0.0, -20.0, 40.0),
            Vec3::new(0.0, 20.0, 40.0),
        ],
        &[],
        &[0, 1, 2, 0, 2, 3, 0, 3, 5, 0, 5, 4],
        0,
    )
    .expect("corner");
    let scene = scene_of(
        vec![floor_and_wall],
        vec![Instance::new(0, Transform::IDENTITY, 0)],
        vec![bevelled(R)],
    );
    for d in [1.5, 0.8, 0.2] {
        let floor = shade(&scene, Vec3::new(d, 0.0, 50.0), Vec3::new(0.0, 0.0, -1.0)).normal;
        assert!(
            close(floor, Vec3::new(R - d, 0.0, R).normalize(), 2.0e-5),
            "floor {floor:?}"
        );
        let wall = shade(&scene, Vec3::new(50.0, 0.0, d), Vec3::new(-1.0, 0.0, 0.0)).normal;
        assert!(
            close(wall, Vec3::new(R, 0.0, R - d).normalize(), 2.0e-5),
            "wall {wall:?}"
        );
    }
}

#[test]
fn a_rim_thinner_than_the_radius_becomes_a_full_round() {
    // A 1 mm thick plate with a 2 mm bevel: the two fillets of its 1 mm edge face cannot both
    // have a radius of 2, so the radius shrinks to the half thickness and the face reads as a
    // full round: its normal turns continuously from the bottom bisector (-45°) through the
    // face's own normal to the top bisector (+45°), where the top and bottom faces carry on.
    let plate = faceted_box(
        Vec3::new(-HALF, -HALF, 0.0),
        Vec3::new(HALF, HALF, 1.0),
        false,
    );
    let scene = scene_of(
        vec![plate],
        vec![Instance::new(0, Transform::IDENTITY, 0)],
        vec![bevelled(R)],
    );
    let on_rim = |z: f32| shade(&scene, Vec3::new(100.0, 0.0, z), Vec3::new(-1.0, 0.0, 0.0)).normal;
    let mut last = -1.0f32;
    for i in 1..20 {
        let z = i as f32 / 20.0;
        let n = on_rim(z);
        assert!(n.is_finite() && (n.length() - 1.0).abs() < 1.0e-5);
        // Radius 0.5: normalize(0.5 x + (z - 0.5) z).
        let want = Vec3::new(0.5, 0.0, z - 0.5).normalize();
        assert!(close(n, want, 1.0e-3), "z {z}: {n:?} vs {want:?}");
        assert!(n.z > last, "not monotonic at {z}");
        last = n.z;
    }
    // The top face sees only its own edge: its fillet keeps the full radius (the round is
    // elliptical, 2 mm over the top and 0.5 mm down the rim), and both meet at the bisector.
    let top = |d: f32| {
        shade(
            &scene,
            Vec3::new(HALF - d, 0.0, 50.0),
            Vec3::new(0.0, 0.0, -1.0),
        )
        .normal
    };
    assert!(close(
        top(0.25),
        Vec3::new(R - 0.25, 0.0, R).normalize(),
        1.0e-4
    ));
    assert!(close(top(1.0e-4), on_rim(1.0 - 1.0e-4), 1.0e-3));
    assert_eq!(top(R + 0.1), Vec3::new(0.0, 0.0, 1.0));
}

#[test]
fn the_radius_is_in_world_millimetres_under_an_instance_scale() {
    // A cube of side 10 drawn twice as large reads like the cube of side 20.
    let small = faceted_box(Vec3::splat(-HALF / 2.0), Vec3::splat(HALF / 2.0), false);
    let scaled = scene_of(
        vec![small],
        vec![Instance::new(0, Transform::scale(Vec3::splat(2.0)), 0)],
        vec![bevelled(R)],
    );
    let one = cube_scene(R);
    for d in [1.8, 1.0, 0.4, 2.5] {
        let (a, b) = (
            top_normal(&scaled, HALF - d, 1.0),
            top_normal(&one, HALF - d, 1.0),
        );
        assert!(close(a, b, 1.0e-5), "d {d}: {a:?} vs {b:?}");
    }
}

#[test]
fn shortest_offset_is_the_rounded_corner_and_shrinks_when_it_cannot_fit() {
    let pull = |v: [f32; 2], d: f32| Pull {
        v,
        m: 1.0,
        g: 1.0,
        d,
        convex: true,
    };
    // Two perpendicular edges: both asks hold with equality.
    let w = shortest_offset(&[pull([1.0, 0.0], 0.5), pull([0.0, 1.0], 1.5)], 2.0).expect("fits");
    assert!((w[0] - 1.5).abs() < 1.0e-6 && (w[1] - 0.5).abs() < 1.0e-6);
    // Two nearly parallel edges: the larger ask alone, not the sum.
    let (s, c) = crate::fmath::sin_cos(0.05);
    let w = shortest_offset(&[pull([1.0, 0.0], 0.5), pull([c, s], 1.0)], 2.0).expect("fits");
    assert!((w[0] - 1.5).abs() < 1.0e-5 && w[1].abs() < 1.0e-5, "{w:?}");
    // Opposite edges 1 apart with a radius of 2: nothing fits at 2; the radius shrinks to 0.5
    // (the half-thickness) and the point a quarter in turns by half the full round.
    let pulls = [pull([1.0, 0.0], 0.25), pull([-1.0, 0.0], 0.75)];
    assert_eq!(shortest_offset(&pulls, 2.0), None);
    let (r, w) = fit_offset(&pulls, 2.0);
    assert!((r - 0.5).abs() < 1.0e-4, "{r}");
    assert!((w[0] - 0.25).abs() < 1.0e-3 && w[1] == 0.0, "{w:?}");
}

/// A key light at the +X side of the cube, its centre `elevation` degrees above (or below) the
/// plane of the cube's top face, seen from the top face's +X edge.
fn side_light(elevation_deg: f32) -> Light {
    let (s, c) = crate::fmath::sin_cos(elevation_deg * crate::fmath::DEG_TO_RAD);
    let from = Vec3::new(HALF, 0.0, HALF) + Vec3::new(c, 0.0, s) * 300.0;
    Light {
        kind: LightKind::Rect,
        position: from,
        direction: Vec3::new(-c, 0.0, -s),
        up: Vec3::new(0.0, 1.0, 0.0),
        size_x: 60.0,
        size_y: 60.0,
        power: 40.0,
        flags: LIGHT_FLAG_GLOSSY,
        ..Light::default()
    }
}

/// The cube seen from straight above (30 mm across, 60 x 60 pixels: 0.5 mm per pixel), black
/// world, lit by `light`, bevel `r`; 16 samples.
fn render_top(r: f32, light: Light) -> Film {
    let mut scene = cube_scene(r);
    scene.materials[0].roughness = 0.3;
    render_scene_top(scene, light)
}

/// `scene` seen from straight above as in [`render_top`].
fn render_scene_top(mut scene: Scene, light: Light) -> Film {
    scene.camera = Camera {
        position: Vec3::new(0.0, 0.0, 500.0),
        target: Vec3::ZERO,
        up: Vec3::new(0.0, 1.0, 0.0),
        ortho: true,
        ortho_width: 30.0,
        ..Camera::default()
    };
    scene.lights = vec![light];
    scene.environment = Environment {
        kind: EnvKind::Flat,
        horizon: 0.0,
        strength: 0.0,
        background_color: Rgb::BLACK,
        background_mode: BACKGROUND_COLOR,
        ..Environment::default()
    };
    scene.render = RenderSettings {
        width: 60,
        height: 60,
        tonemap: 0,
        ..RenderSettings::default()
    };
    let prepared = Prepared::new(&scene);
    let mut film = Film::new(60, 60);
    let tile = TileRect {
        x: 0,
        y: 0,
        w: 60,
        h: 60,
    };
    for s in 0..16 {
        render_tile_prepared(&scene, &prepared, tile, s, &mut film, Isa::detect());
    }
    film
}

/// Mean luminance over the pixels whose centre is at x (world, mm) in `[x0, x1]` and |y| < 6.
fn band(film: &Film, x0: f32, x1: f32) -> f32 {
    let pixels = film.resolve();
    let (mut sum, mut n) = (0.0f32, 0);
    for py in 0..60u32 {
        for px in 0..60u32 {
            let x = (px as f32 + 0.5) * 0.5 - 15.0;
            let y = 15.0 - (py as f32 + 0.5) * 0.5;
            if x >= x0 && x <= x1 && y.abs() < 6.0 {
                let i = ((py * 60 + px) * 3) as usize;
                sum += Rgb::new(pixels[i], pixels[i + 1], pixels[i + 2]).luminance();
                n += 1;
            }
        }
    }
    sum / n as f32
}

#[test]
fn the_edge_catches_a_light_from_below_the_face() {
    // The light sits 12° below the plane of the top face: without a bevel the top face cannot
    // see it, and every pixel of it is black. With a 2 mm bevel the strip along the +X edge
    // faces it (the fillet is tilted up to 45° towards it) and its shadow rays clear the face
    // and the side it replaces: the strip lights up. The middle of the face is identical.
    let light = side_light(-12.0);
    let sharp = render_top(0.0, light.clone());
    let round = render_top(R, light);
    let (strip_sharp, strip_round) = (band(&sharp, 8.5, 10.0), band(&round, 8.5, 10.0));
    eprintln!("strip: sharp {strip_sharp}, round {strip_round}");
    assert_eq!(strip_sharp, 0.0);
    assert!(strip_round > 0.02, "{strip_round}");
    // The rest of the top face, beyond the radius, has the same pixels.
    let pixels = (sharp.resolve(), round.resolve());
    for py in 0..60usize {
        for px in 0..60usize {
            let x = (px as f32 + 0.5) * 0.5 - 15.0;
            let y = 15.0 - (py as f32 + 0.5) * 0.5;
            if x.abs() < HALF - R - 0.5 && y.abs() < HALF - R - 0.5 {
                let i = (py * 60 + px) * 3;
                assert_eq!(pixels.0[i..i + 3], pixels.1[i..i + 3], "({px}, {py})");
            }
        }
    }
}

#[test]
fn the_edge_shows_a_highlight_a_sharp_edge_misses() {
    // A light low above the face (8°) and a camera from straight above: the flat face reflects
    // it away from the camera, the fillet towards it. The strip along the +X edge is far
    // brighter than the same strip without a bevel, and brighter than the face's middle.
    let light = side_light(8.0);
    let sharp = render_top(0.0, light.clone());
    let round = render_top(R, light);
    let (strip_sharp, strip_round) = (band(&sharp, 8.5, 10.0), band(&round, 8.5, 10.0));
    let middle = band(&round, -3.0, 3.0);
    eprintln!("strip: sharp {strip_sharp}, round {strip_round}, middle {middle}");
    assert!(
        strip_round > 3.0 * strip_sharp,
        "{strip_round} vs {strip_sharp}"
    );
    assert!(strip_round > 3.0 * middle);
}

#[test]
fn a_white_furnace_stays_close_to_white_on_the_bevel() {
    // The bias of a shading normal: an albedo-1 Lambertian cube in a uniform world of radiance
    // 1 is invisible, except where shading normals break energy conservation. On the strips it
    // stays within a few percent (measured: see the printed values).
    let mut scene = cube_scene(R);
    scene.materials[0] = Material {
        base_color: Rgb::WHITE,
        ior: 1.0,
        bevel_mm: R,
        ..Material::default()
    };
    scene.camera = Camera {
        position: Vec3::new(300.0, -400.0, 350.0),
        target: Vec3::ZERO,
        up: Vec3::new(0.0, 0.0, 1.0),
        ortho: true,
        ortho_width: 40.0,
        ..Camera::default()
    };
    scene.environment = Environment {
        kind: EnvKind::Flat,
        horizon: 1.0,
        strength: 1.0,
        background_mode: BACKGROUND_ENVIRONMENT,
        ..Environment::default()
    };
    scene.render = RenderSettings {
        width: 40,
        height: 40,
        tonemap: 0,
        max_depth: 64,
        ..RenderSettings::default()
    };
    let prepared = Prepared::new(&scene);
    let mut film = Film::new(40, 40);
    let tile = TileRect {
        x: 0,
        y: 0,
        w: 40,
        h: 40,
    };
    for s in 0..256 {
        render_tile_prepared(&scene, &prepared, tile, s, &mut film, Isa::detect());
    }
    let pixels = film.resolve();
    let mean: f32 = pixels.iter().sum::<f32>() / pixels.len() as f32;
    let (lo, hi) = pixels
        .chunks(3)
        .map(|p| (p[0] + p[1] + p[2]) / 3.0)
        .fold((f32::INFINITY, f32::NEG_INFINITY), |(a, b), v| {
            (a.min(v), b.max(v))
        });
    eprintln!("furnace with bevel: mean {mean}, darkest pixel {lo}, brightest {hi}");
    assert!((mean - 1.0).abs() < 0.02, "{mean}");
    assert!(lo > 0.85 && hi < 1.15, "{lo} {hi}");
}

#[test]
fn the_normal_pass_shows_the_bevel() {
    let scene = cube_scene(R);
    let prepared = Prepared::new(&scene);
    let tracer = crate::integrator::BvhTracer {
        geometry: &scene.geometry,
        isa: Isa::detect(),
    };
    let normal_at = |x: f32| {
        let ray = Ray::new(Vec3::new(x, 0.0, 100.0), Vec3::new(0.0, 0.0, -1.0));
        match crate::integrator::first_hit(&scene, &prepared, &tracer, &ray) {
            crate::integrator::FirstHit::Surface { normal, .. } => normal,
            other => panic!("{other:?}"),
        }
    };
    assert_eq!(normal_at(0.0), Vec3::new(0.0, 0.0, 1.0));
    assert!(close(
        normal_at(HALF - 1.0),
        Vec3::new(1.0, 0.0, 2.0).normalize(),
        2.0e-5
    ));
}

/// A triangular prism along Y (from -20 to 20): its cross-section has a base of `width` on the
/// floor and an apex `height` above its middle. Flat shaded.
fn wedge(width: f32, height: f32) -> Mesh {
    let (h, w) = (20.0, width / 2.0);
    let p = [
        Vec3::new(-w, -h, 0.0),
        Vec3::new(w, -h, 0.0),
        Vec3::new(0.0, -h, height),
        Vec3::new(-w, h, 0.0),
        Vec3::new(w, h, 0.0),
        Vec3::new(0.0, h, height),
    ];
    let idx = [
        0, 1, 2, 3, 5, 4, // the two ends
        0, 2, 5, 0, 5, 3, // the left slope
        1, 4, 5, 1, 5, 2, // the right slope
        0, 3, 4, 0, 4, 1, // the base
    ];
    Mesh::new(&p, &[], &idx, 0).expect("wedge")
}

#[test]
fn the_normal_changes_only_within_the_radius_whatever_the_angle() {
    // An acute ridge (30° between the slopes, 150° between their normals) and a shallow one
    // (the slopes 15° off the base's plane on the base edges of a flat wedge): the fillet's
    // footprint never passes the radius, and at the ridge the normal is the bisector.
    for (width, height) in [(10.0f32, 18.660_254), (40.0, 5.358_984)] {
        let scene = scene_of(
            vec![wedge(width, height)],
            vec![Instance::new(0, Transform::IDENTITY, 0)],
            vec![bevelled(R)],
        );
        // A point on the right slope at distance d from the apex, along the slope.
        let slope = Vec3::new(width / 2.0, 0.0, -height).normalize();
        let face_normal = Vec3::new(height, 0.0, width / 2.0).normalize();
        let at = |d: f32| {
            let p = Vec3::new(0.0, 0.0, height) + slope * d;
            shade(&scene, p + face_normal * 50.0, -face_normal).normal
        };
        // tan(θ/2), θ the angle between the slopes' normals: the fillet starts R tan(θ/2) from
        // the ridge, but never farther than R.
        let half = (width / 2.0 / height).atan(); // half the apex angle
        let theta = crate::fmath::PI - 2.0 * half;
        let footprint = R * (theta / 2.0).tan().min(1.0);
        eprintln!("ridge of {:.0}°: footprint {footprint}", theta.to_degrees());
        for d in [footprint + 0.02, footprint + 0.5, R + 0.05, 3.0 * R] {
            assert!(
                close(at(d), face_normal, 1.0e-6),
                "{width}: d {d}: {:?}",
                at(d)
            );
        }
        for d in [footprint - 0.02, footprint / 2.0, 0.05] {
            assert!(at(d).dot(face_normal) < 1.0 - 1.0e-6, "{width}: d {d}");
        }
        let apex = at(1.0e-3);
        assert!(
            close(apex, Vec3::new(0.0, 0.0, 1.0), 2.0e-3),
            "{width}: {apex:?}"
        );
    }
}

/// A mirror cube with bevel `r` seen from 45° above its -X side, 16 samples of 60 x 60 pixels,
/// black world; lit 12° below the plane of its top face on the +X side by a rect light, or by
/// an emissive panel in its place that only rays leaving a surface can find (it is no light).
/// The sum of the image.
fn mirror_cube(r: f32, panel: bool) -> f64 {
    let mut scene = cube_scene(r);
    scene.materials[0] = Material {
        base_color: Rgb::splat(0.95),
        metallic: 1.0,
        roughness: 0.02,
        bevel_mm: r,
        ..Material::default()
    };
    let light = side_light(-12.0);
    if panel {
        // The light's 60 mm square as the -X face of a thin box, glowing, not sampled.
        let c = light.position;
        let slab = faceted_box(
            Vec3::new(c.x, c.y - 30.0, c.z - 30.0),
            Vec3::new(c.x + 2.0, c.y + 30.0, c.z + 30.0),
            false,
        );
        let cube = faceted_box(Vec3::splat(-HALF), Vec3::splat(HALF), false);
        let glow = Material {
            kind: crate::scene::MATERIAL_EMISSIVE,
            emission: Rgb::WHITE,
            emission_power: 1.0,
            flags: 0,
            ..Material::default()
        };
        let materials = vec![scene.materials[0].clone(), glow];
        scene = scene_of(
            vec![cube, slab],
            vec![
                Instance::new(0, Transform::IDENTITY, 0),
                Instance::new(1, Transform::IDENTITY, 1),
            ],
            materials,
        );
    } else {
        scene.lights = vec![light];
    }
    scene.camera = Camera {
        position: Vec3::new(-400.0, 0.0, 400.0 + HALF),
        target: Vec3::new(0.0, 0.0, HALF),
        up: Vec3::new(0.0, 0.0, 1.0),
        ortho: true,
        ortho_width: 30.0,
        ..Camera::default()
    };
    scene.environment = Environment {
        kind: EnvKind::Flat,
        horizon: 0.0,
        strength: 0.0,
        background_color: Rgb::BLACK,
        background_mode: BACKGROUND_COLOR,
        ..Environment::default()
    };
    scene.render = RenderSettings {
        width: 60,
        height: 60,
        tonemap: 0,
        ..RenderSettings::default()
    };
    let prepared = Prepared::new(&scene);
    let mut film = Film::new(60, 60);
    let tile = TileRect {
        x: 0,
        y: 0,
        w: 60,
        h: 60,
    };
    for s in 0..16 {
        render_tile_prepared(&scene, &prepared, tile, s, &mut film, Isa::detect());
    }
    film.resolve().iter().map(|&v| f64::from(v)).sum::<f64>()
}

#[test]
fn a_mirror_edge_reflects_what_lies_below_the_face() {
    // The flat top reflects the sky (black), the side facing the light is hidden, so without a
    // bevel the image is black. The fillet along the top's +X edge turns the view (about 28° of
    // tilt) towards the light: the reflection leaves it below the face's plane, which the
    // integrator allows because the bevelled point's geometric normal is the fillet's (and the
    // lift lets it clear the face). The light is found by its own samples; the panel only by
    // the reflected ray, which the integrator drops when it goes below the geometric normal.
    // Measured: light 1.19e5 (1.1e3 with the face's geometric normal), panel 32.6 (0).
    for (panel, least) in [(false, 2.0e4), (true, 5.0)] {
        let (sharp, round) = (mirror_cube(0.0, panel), mirror_cube(R, panel));
        eprintln!("mirror (panel {panel}): sharp {sharp}, round {round}");
        assert_eq!(sharp, 0.0);
        assert!(round > least, "{round}");
    }
}

#[test]
fn a_neighbour_across_a_gap_does_not_bend_the_normal() {
    // Two boxes in one mesh, half a millimetre apart: the edge of the second one is within the
    // radius of a point on the first one's top, but on the far side of the gap. Only the
    // first box's own edge rounds the point.
    let a = faceted_box(Vec3::splat(-HALF), Vec3::splat(HALF), false);
    let b = faceted_box(
        Vec3::new(HALF + 0.5, -HALF, -HALF),
        Vec3::new(3.0 * HALF, HALF, HALF),
        false,
    );
    let mut p: Vec<Vec3> = (0..a.vertex_count())
        .filter_map(|i| a.position(i))
        .collect();
    let offset = p.len() as u32;
    p.extend((0..b.vertex_count()).filter_map(|i| b.position(i)));
    let idx: Vec<u32> = a
        .indices()
        .iter()
        .copied()
        .chain(b.indices().iter().map(|&i| i + offset))
        .collect();
    let pair = scene_of(
        vec![Mesh::new(&p, &[], &idx, 0).expect("pair")],
        vec![Instance::new(0, Transform::IDENTITY, 0)],
        vec![bevelled(R)],
    );
    let one = cube_scene(R);
    for d in [0.2, 0.9, 1.6] {
        let (n, want) = (
            top_normal(&pair, HALF - d, 0.0),
            top_normal(&one, HALF - d, 0.0),
        );
        assert!(close(n, want, 1.0e-6), "d {d}: {n:?} vs {want:?}");
    }
}

#[test]
fn bevelled_normals_never_face_away_from_the_viewer() {
    // Grazing views of the strips: the normal is bent towards the viewer up to MIN_FACING.
    let scene = cube_scene(R);
    let setup = BevelSetup::new(&scene);
    let mut rng = crate::rng::Pcg32::seeded(11, 4);
    let mut bevelled = 0;
    for _ in 0..4000 {
        // Aim at a point near the top's +X edge from a random direction above the top face.
        let target = Vec3::new(HALF - rng.next_f32() * R, rng.next_f32() * 16.0 - 8.0, HALF);
        let (s, c) = crate::fmath::sin_cos(rng.next_f32() * crate::fmath::TAU);
        let up = 0.02 + rng.next_f32() * 0.3;
        let dir = -Vec3::new(c, s, up).normalize();
        let ray = Ray::new(target - dir * 100.0, dir);
        let Some(hit) = scene.geometry.intersect(&ray) else {
            continue;
        };
        let sp = setup.shading_point(&scene, &ray, &hit);
        if sp.normal != hit.normal {
            bevelled += 1;
        }
        assert!(sp.normal.dot(-dir) >= MIN_FACING - 1.0e-4, "{sp:?} {dir:?}");
        assert!(sp.geometric.dot(-dir) >= MIN_FACING - 1.0e-4);
        assert!((sp.normal.length() - 1.0).abs() < 1.0e-5);
    }
    assert!(bevelled > 1000, "{bevelled}");
}

#[test]
fn emitters_and_zero_radii_have_no_bevel() {
    let mut scene = cube_scene(R);
    assert!(BevelSetup::new(&scene).radius(0) > 0.0);
    scene.materials[0].kind = crate::scene::MATERIAL_EMISSIVE;
    assert!(BevelSetup::new(&scene).is_empty());
    scene.materials[0] = bevelled(0.0);
    assert!(BevelSetup::new(&scene).is_empty());
    scene.materials[0] = bevelled(-1.0);
    assert!(BevelSetup::new(&scene).is_empty());
    // A mesh nobody bevels never has its edges extracted.
    let fresh = cube_scene(0.0);
    let _ = BevelSetup::new(&fresh);
    assert!(format!("{:?}", fresh.geometry.meshes()[0]).contains("not extracted"));
}
