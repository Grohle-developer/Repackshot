//! S7, nested dielectrics through the path tracer: a ray through a flat glass wall into water
//! leaves the glass at Snell's angle for 1.5 / 1.33 (beyond the angle where glass against air
//! reflects it all), and a scene whose clear solids do not overlap renders with priorities the
//! same numbers as without, bit for bit.

use super::*;
use crate::color::Rgb;
use crate::fmath;
use crate::image::Film;
use crate::render::{render_tile_prepared, TileRect};
use crate::scene::{
    Camera, Environment, Geometry, Instance, Material, Mesh, RenderSettings, Transform,
    MATERIAL_EMISSIVE, MATERIAL_GLASS,
};

/// A convex solid from its eight corners (`c[k]`, bit 0 x, bit 1 y, bit 2 z of a box's corner),
/// its faces facing out from `inside`.
fn hexahedron(c: [Vec3; 8], inside: Vec3) -> Mesh {
    let quads: [[usize; 4]; 6] = [
        [0, 2, 3, 1],
        [4, 5, 7, 6],
        [0, 1, 5, 4],
        [2, 6, 7, 3],
        [0, 4, 6, 2],
        [1, 3, 7, 5],
    ];
    let mut positions = Vec::new();
    for q in quads {
        for t in [[q[0], q[1], q[2]], [q[0], q[2], q[3]]] {
            let (a, b, d) = (c[t[0]], c[t[1]], c[t[2]]);
            let out = (b - a).cross(d - a).dot((a + b + d) * (1.0 / 3.0) - inside) > 0.0;
            positions.extend(if out { [a, b, d] } else { [a, d, b] });
        }
    }
    let indices: Vec<u32> = (0..positions.len() as u32).collect();
    Mesh::new(&positions, &[], &indices, 0).expect("hexahedron")
}

fn boxed(lo: Vec3, hi: Vec3) -> Mesh {
    let c = std::array::from_fn(|k| {
        Vec3::new(
            if k & 1 != 0 { hi.x } else { lo.x },
            if k & 2 != 0 { hi.y } else { lo.y },
            if k & 4 != 0 { hi.z } else { lo.z },
        )
    });
    hexahedron(c, (lo + hi) * 0.5)
}

/// The angle inside the glass, from the vertical, degrees.
const INSIDE_DEG: f32 = 50.0;
/// Depth of the light strip under the glass, mm.
const DEPTH: f32 = 100.0;

fn clear(ior: f32) -> Material {
    Material {
        kind: MATERIAL_GLASS,
        base_color: Rgb::WHITE,
        roughness: 0.0,
        ior,
        transmission: 1.0,
        ..Material::default()
    }
}

/// A glass wedge on the plane z = 0 whose top faces the camera (a ray enters it straight and runs
/// at [`INSIDE_DEG`] from the vertical to its flat bottom), water below it (a solid whose top is
/// inside the glass, 0.5 to 5.5 mm above its bottom across the wedge: modelled overlapping, and
/// not parallel to the bottom, so that the plain rule, which takes the water's top for an
/// interface with the air, sends the ray elsewhere), of lower priority, and a strip of light 2 mm
/// wide in the water, [`DEPTH`] under the bottom where the camera's central ray lands if it leaves
/// the glass for the water at `water_deg` from the vertical. `priorities` false: none (the plain
/// rule).
fn wedge_scene(water_deg: f32, priorities: bool) -> Scene {
    let (s, c) = fmath::sin_cos(INSIDE_DEG.to_radians());
    let d = Vec3::new(s, 0.0, -c);
    // The wedge: x and y within ±40 mm, the top plane perpendicular to d.
    let top = |x: f32| 60.0 + x * s / c;
    let corners = std::array::from_fn(|k| {
        let x = if k & 1 != 0 { 40.0 } else { -40.0 };
        let y = if k & 2 != 0 { 40.0 } else { -40.0 };
        Vec3::new(x, y, if k & 4 != 0 { top(x) } else { 0.0 })
    });
    let wedge = hexahedron(corners, Vec3::new(0.0, 0.0, 30.0));
    let surface = |x: f32| 3.0 + x / 16.0;
    let water = hexahedron(
        std::array::from_fn(|k| {
            let x = if k & 1 != 0 { 600.0 } else { -40.0 };
            let y = if k & 2 != 0 { 600.0 } else { -600.0 };
            Vec3::new(x, y, if k & 4 != 0 { surface(x) } else { -600.0 })
        }),
        Vec3::new(0.0, 0.0, -300.0),
    );
    let x = DEPTH * water_deg.to_radians().tan();
    let strip = boxed(
        Vec3::new(x - 1.0, -300.0, -DEPTH - 0.5),
        Vec3::new(x + 1.0, 300.0, -DEPTH),
    );
    let light = Material {
        kind: MATERIAL_EMISSIVE,
        emission: Rgb::WHITE,
        emission_power: 1.0,
        ..Material::default()
    };
    Scene {
        camera: Camera {
            position: d * -500.0,
            target: Vec3::ZERO,
            up: Vec3::new(0.0, 1.0, 0.0),
            ortho: true,
            ortho_width: 20.0,
            ..Camera::default()
        },
        materials: vec![clear(1.5), clear(1.33), light],
        geometry: Geometry::new(
            vec![wedge, water, strip],
            vec![
                Instance::new(0, Transform::IDENTITY, 0),
                Instance::new(1, Transform::IDENTITY, 1),
                Instance::new(2, Transform::IDENTITY, 2),
            ],
        )
        .expect("geometry"),
        environment: Environment {
            strength: 0.0,
            ..Environment::default()
        },
        render: RenderSettings {
            width: 64,
            height: 4,
            tonemap: 0,
            max_depth: 16,
            ..RenderSettings::default()
        },
        priorities: if priorities {
            vec![2, 1, 0]
        } else {
            Vec::new()
        },
        ..Scene::default()
    }
}

fn render(scene: &Scene, spp: u32) -> Film {
    let prepared = Prepared::new(scene);
    let (w, h) = (scene.render.width, scene.render.height);
    let mut film = Film::new(w, h);
    for s in 0..spp {
        render_tile_prepared(
            scene,
            &prepared,
            TileRect { x: 0, y: 0, w, h },
            s,
            &mut film,
            Isa::detect(),
        );
    }
    film
}

/// The light per column (green, summed over the rows) and its centroid, in pixels.
fn columns(film: &Film) -> (Vec<f64>, f64) {
    let img = film.resolve();
    let w = film.width as usize;
    let mut cols = vec![0.0f64; w];
    for (i, px) in img.chunks_exact(3).enumerate() {
        cols[i % w] += f64::from(px[1]);
    }
    let total: f64 = cols.iter().sum();
    let centroid = cols
        .iter()
        .enumerate()
        .map(|(k, v)| (k as f64 + 0.5) * v)
        .sum::<f64>()
        / total.max(1.0e-30);
    (cols, centroid)
}

#[test]
fn a_ray_through_a_glass_wall_into_water_leaves_it_at_snells_angle_for_the_two_indices() {
    // 1.5 sin 50° = 1.33 sin θ: θ = 59.77°. Glass against air would reflect it all (beyond its
    // critical angle of 41.8°), water against air would bend it to 35.2°.
    let snell = (1.5 / 1.33 * INSIDE_DEG.to_radians().sin())
        .asin()
        .to_degrees();
    assert!((snell - 59.77).abs() < 0.01, "{snell}");
    let film = render(&wedge_scene(snell, true), 8);
    let (cols, centroid) = columns(&film);
    let total: f64 = cols.iter().sum();
    assert!(total > 1.0, "the strip is not seen: {total}");
    // The strip is where the central ray lands: in the middle of the image, to a pixel (a pixel
    // is 0.07° of the angle in the water).
    let middle = film.width as f64 / 2.0;
    assert!(
        (centroid - middle).abs() < 1.0,
        "the strip at column {centroid}, {cols:?}"
    );
    // Moved by half a degree, it is half a dozen pixels off the middle.
    let (_, off) = columns(&render(&wedge_scene(snell + 0.5, true), 8));
    assert!((off - middle).abs() > 4.0, "{off}");
    // Without priorities the water's top inside the glass bends the ray as air to water would and
    // the glass's bottom as glass to air: the ray leaves for another angle and the strip is not
    // in the middle (or not seen at all).
    let (plain, at) = columns(&render(&wedge_scene(snell, false), 8));
    let seen: f64 = plain.iter().sum();
    assert!(
        seen < 1.0e-3 * total || (at - middle).abs() > 4.0,
        "{seen} vs {total} at {at}"
    );
}

#[test]
fn the_bsdf_of_a_true_interface_refracts_at_the_ratio_of_the_indices() {
    // Out of glass (1.5) into water (1.33), 50° from the normal: the transmitted direction is at
    // asin(1.5 / 1.33 sin 50°).
    let m = clear(1.5);
    let bsdf = Bsdf::surface_nested(&m, false, 1.5, 1.33);
    assert_eq!(bsdf.eta(), 1.33 / 1.5);
    let (s, c) = fmath::sin_cos(50f32.to_radians());
    let wo = Vec3::new(s, 0.0, c);
    let want = (1.5 / 1.33 * s).asin();
    let angle = |wi: Vec3| (wi.x * wi.x + wi.y * wi.y).sqrt().atan2(-wi.z);
    // Through the macroscopic normal: exactly Snell's.
    let wi = crate::bsdf::refract(wo, Vec3::new(0.0, 0.0, 1.0), bsdf.eta()).expect("refracted");
    assert!((angle(wi) - want).abs() < 1.0e-5, "{} vs {want}", angle(wi));
    // And the samples of the lobe (a smooth surface's microfacets lean a thousandth at most for
    // the middle of the distribution).
    let mut found = false;
    for k in 0..16 {
        let u = (0.45 + k as f32 / 16.0 * 0.4, 0.37);
        if let Some(b) = bsdf.sample(wo, u) {
            if b.wi.z < 0.0 {
                assert!(
                    (angle(b.wi) - want).abs() < 5.0e-3,
                    "{} vs {want}",
                    angle(b.wi)
                );
                found = true;
            }
        }
    }
    assert!(found, "nothing was transmitted");
    // The plain BSDF of the glass leaving into air reflects all of it at 50°.
    let plain = Bsdf::surface(&m, false);
    for k in 0..64 {
        let u = (k as f32 / 64.0, 0.37);
        if let Some(b) = plain.sample(wo, u) {
            assert!(b.wi.z > 0.0);
        }
    }
}

#[test]
fn solids_that_do_not_overlap_render_the_same_with_priorities() {
    // The E9 scene (glass, a medium behind a rough boundary, a dispersive crystal, an HDRI) with
    // a priority on every material: every path takes the nested branch, and no two of its solids
    // overlap, so every number is the plain rule's, bit for bit.
    let plain = crate::example::e9_scene();
    let mut nested = plain.clone();
    nested.priorities = vec![1; nested.materials.len()];
    assert!(Prepared::new(&nested).nested());
    assert!(!Prepared::new(&plain).nested());
    let hash = |scene: &Scene| {
        render(scene, 2)
            .resolve()
            .iter()
            .flat_map(|v| v.to_le_bytes())
            .fold(0x811c_9dc5u32, |h, b| {
                (h ^ u32::from(b)).wrapping_mul(0x0100_0193)
            })
    };
    assert_eq!(hash(&nested), hash(&plain));
    // And priorities all 0 (or none) are not nesting at all.
    let mut zero = plain.clone();
    zero.priorities = vec![0; zero.materials.len()];
    assert!(!Prepared::new(&zero).nested());
}
