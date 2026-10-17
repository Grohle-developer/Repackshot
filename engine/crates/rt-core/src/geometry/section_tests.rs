//! The section view (Q1) at the level of rays: what is clipped, where the cut is capped, which
//! meshes are solids.

use super::edges::faceted_box;
use super::*;
use crate::math::Ray;

const DOWN: Vec3 = Vec3::new(0.0, 0.0, -1.0);
const UP: Vec3 = Vec3::new(0.0, 0.0, 1.0);

fn plane(normal: Vec3, distance: f32, cap: bool) -> SectionPlane {
    SectionPlane::new(normal, distance, cap).expect("a plane")
}

/// A 100 mm box centred on the origin with a section at the given height, removing the top.
fn cut_box(cap: bool) -> Geometry {
    let mut g = Geometry::from_meshes(vec![faceted_box(
        Vec3::splat(-50.0),
        Vec3::splat(50.0),
        true,
    )]);
    g.set_section(Some(plane(UP, 0.0, cap)), &[]);
    g
}

fn ray(origin: Vec3, dir: Vec3) -> Ray {
    Ray::new(origin, dir.normalize())
}

fn is_cap(hit: &RayHit) -> bool {
    hit.triangle == CAP_TRIANGLE
}

#[test]
fn a_plane_needs_a_normal_and_normalises_it() {
    assert!(SectionPlane::new(Vec3::ZERO, 0.0, true).is_none());
    assert!(SectionPlane::new(Vec3::new(f32::NAN, 0.0, 1.0), 0.0, true).is_none());
    assert!(SectionPlane::new(UP, f32::INFINITY, true).is_none());
    let p = plane(Vec3::new(0.0, 0.0, 4.0), 7.0, false);
    assert_eq!(p.normal, UP);
    assert_eq!((p.distance, p.cap), (7.0, false));
    // A unit normal is kept bit for bit (so a plane written and read again is the same).
    let unit = Vec3::new(0.6, 0.0, 0.8);
    assert_eq!(plane(unit, 1.0, true).normal, unit);
    assert_eq!(p.side(Vec3::new(1.0, 2.0, 10.0)), 3.0);
    assert_eq!(p.side(Vec3::new(1.0, 2.0, 7.0)), 0.0);
}

#[test]
fn meshes_are_solids_only_when_closed_and_wound_consistently() {
    // A box in 24 vertices (split per face): welded by position, it is closed.
    let cube = faceted_box(Vec3::splat(-1.0), Vec3::splat(1.0), true);
    assert_eq!(cube.solid(), Solid::Outward);
    // Without vertex normals too: the answer is the winding's.
    assert_eq!(
        faceted_box(Vec3::splat(-1.0), Vec3::splat(1.0), false).solid(),
        Solid::Outward
    );
    // Wound the other way round it is closed and inside out.
    let positions: Vec<Vec3> = (0..cube.vertex_count())
        .filter_map(|i| cube.position(i))
        .collect();
    let flipped: Vec<u32> = cube
        .indices()
        .chunks(3)
        .flat_map(|t| [t[0], t[2], t[1]])
        .collect();
    assert_eq!(
        Mesh::new(&positions, &[], &flipped, 0).unwrap().solid(),
        Solid::Inward
    );
    // A missing triangle opens it; one triangle flipped is wound inconsistently.
    let open = &cube.indices()[..cube.indices().len() - 3];
    assert_eq!(
        Mesh::new(&positions, &[], open, 0).unwrap().solid(),
        Solid::Open
    );
    let mut one_flipped = cube.indices().to_vec();
    one_flipped.swap(1, 2);
    assert_eq!(
        Mesh::new(&positions, &[], &one_flipped, 0).unwrap().solid(),
        Solid::Open
    );
    // A sphere is a solid; a lone triangle and an empty mesh are not.
    assert_eq!(
        crate::example::icosphere(Vec3::ZERO, 10.0, 2).solid(),
        Solid::Outward
    );
    let sheet = Mesh::new(
        &[
            Vec3::ZERO,
            Vec3::new(1.0, 0.0, 0.0),
            Vec3::new(0.0, 1.0, 0.0),
        ],
        &[],
        &[0, 1, 2],
        0,
    )
    .unwrap();
    assert_eq!(sheet.solid(), Solid::Open);
    assert_eq!(Mesh::default().solid(), Solid::Open);
    // A face shared by two boxes that touch makes an edge of four triangles: not a solid.
    let (a, b) = (
        faceted_box(Vec3::splat(-1.0), Vec3::splat(1.0), false),
        faceted_box(Vec3::new(1.0, -1.0, -1.0), Vec3::new(3.0, 1.0, 1.0), false),
    );
    let mut p: Vec<Vec3> = (0..a.vertex_count())
        .filter_map(|i| a.position(i))
        .collect();
    let base = p.len() as u32;
    p.extend((0..b.vertex_count()).filter_map(|i| b.position(i)));
    let mut idx = a.indices().to_vec();
    idx.extend(b.indices().iter().map(|i| i + base));
    assert_eq!(Mesh::new(&p, &[], &idx, 0).unwrap().solid(), Solid::Open);
}

#[test]
fn a_ray_on_the_removed_side_sees_nothing_there() {
    let g = cut_box(true);
    // Level with the top half of the box, from the side: removed.
    let r = ray(Vec3::new(-200.0, 0.0, 25.0), Vec3::new(1.0, 0.0, 0.0));
    assert_eq!(g.trace(&r), None);
    assert!(!g.occluded(&r));
    // The same without the section hits the box's side face.
    let whole = Geometry::from_meshes(vec![faceted_box(
        Vec3::splat(-50.0),
        Vec3::splat(50.0),
        true,
    )]);
    assert!(whole.trace(&r).is_some() && whole.occluded(&r));
    // Level with the bottom half: the side face, as always.
    let r = ray(Vec3::new(-200.0, 0.0, -25.0), Vec3::new(1.0, 0.0, 0.0));
    let hit = g.trace(&r).expect("the kept half");
    assert!(!is_cap(&hit));
    assert!((hit.t - 150.0).abs() < 1.0e-3);
    // Looking up from below: the bottom face, then nothing above the plane.
    let r = ray(Vec3::new(0.0, 0.0, -200.0), UP);
    assert!((g.trace(&r).unwrap().t - 150.0).abs() < 1.0e-3);
    // A ray that goes past the box on the removed side, then into the kept side far from it.
    let r = ray(Vec3::new(-200.0, 0.0, 40.0), Vec3::new(1.0, 0.0, -0.5));
    let hit = g.trace(&r).expect("enters the kept side outside the box");
    assert!(!is_cap(&hit));
    assert!(
        (hit.t * r.dir.x + r.origin.x + 50.0).abs() < 1.0e-2,
        "{hit:?}"
    );
}

#[test]
fn the_cut_of_a_closed_solid_is_capped_on_the_plane() {
    let g = cut_box(true);
    let r = ray(Vec3::new(10.0, -20.0, 200.0), DOWN);
    let hit = g.trace(&r).expect("the cap");
    assert!(is_cap(&hit), "{hit:?}");
    assert_eq!((hit.instance, hit.t), (0, 200.0));
    let details = g.hit_details(&r, hit).expect("details");
    assert_eq!(details.triangle, CAP_TRIANGLE);
    assert_eq!(details.point, Vec3::new(10.0, -20.0, 0.0));
    assert_eq!((details.normal, details.geometric_normal), (UP, UP));
    assert!(details.front_face && details.outside);
    assert_eq!(g.intersect(&r), Some(details));
    // Outside the box's footprint there is nothing to cap.
    assert_eq!(g.trace(&ray(Vec3::new(80.0, 0.0, 200.0), DOWN)), None);
    // Without caps the ray goes into the box and meets the back of its bottom face: its inside.
    let open_cut = cut_box(false);
    let hit = open_cut.trace(&r).expect("the inside");
    assert!(!is_cap(&hit));
    assert!((hit.t - 250.0).abs() < 1.0e-3);
    let inside = open_cut.hit_details(&r, hit).expect("details");
    assert!(!inside.front_face);
    // From below the cap is met from inside the solid: the same hit, the other way round.
    let from_inside = Ray::new(Vec3::new(10.0, -20.0, -10.0), UP);
    let hit = g.trace(&from_inside).expect("the cap from inside");
    assert!(is_cap(&hit), "{hit:?}");
    assert!((hit.t - 10.0).abs() < 1.0e-4);
    let details = g.hit_details(&from_inside, hit).expect("details");
    assert_eq!(details.normal, DOWN);
    assert!(!details.front_face && !details.outside);
    // A ray inside the solid that goes the other way meets its bottom face as usual.
    let hit = g
        .trace(&Ray::new(Vec3::new(0.0, 0.0, -10.0), DOWN))
        .unwrap();
    assert!(!is_cap(&hit) && (hit.t - 40.0).abs() < 1.0e-4);
}

#[test]
fn the_cap_area_is_the_cross_section() {
    // Rays on a grid straight down over a box 100 x 60 wide: the caps are its cross-section.
    let mut g = Geometry::from_meshes(vec![faceted_box(
        Vec3::new(-50.0, -30.0, -50.0),
        Vec3::new(50.0, 30.0, 50.0),
        true,
    )]);
    g.set_section(Some(plane(UP, 10.0, true)), &[]);
    let n = 400;
    let (mut caps, mut other) = (0, 0);
    for i in 0..n {
        for j in 0..n {
            let x = -100.0 + 200.0 * (i as f32 + 0.5) / n as f32;
            let y = -100.0 + 200.0 * (j as f32 + 0.5) / n as f32;
            match g.trace(&Ray::new(Vec3::new(x, y, 300.0), DOWN)) {
                Some(h) if is_cap(&h) => {
                    caps += 1;
                    assert!((h.t - 290.0).abs() < 1.0e-3);
                }
                Some(_) => other += 1,
                None => {}
            }
        }
    }
    assert_eq!(other, 0);
    let area = caps as f32 * (200.0 / n as f32).powi(2);
    assert!((area - 6000.0).abs() < 6000.0 * 0.01, "area {area}");
}

#[test]
fn open_meshes_and_thin_walls_are_not_capped() {
    // A box without its lid is open: the cut shows the inside (the back of the far wall).
    let full = faceted_box(Vec3::splat(-50.0), Vec3::splat(50.0), true);
    let positions: Vec<Vec3> = (0..full.vertex_count())
        .filter_map(|i| full.position(i))
        .collect();
    // The second face of `faceted_box` (indices 6..12) is the top one.
    let mut idx = full.indices().to_vec();
    idx.drain(6..12);
    let lidless = Mesh::new(&positions, &[], &idx, 0).unwrap();
    assert_eq!(lidless.solid(), Solid::Open);
    let mut g = Geometry::from_meshes(vec![lidless]);
    g.set_section(Some(plane(UP, 0.0, true)), &[]);
    assert!(g.capped_instances().is_empty());
    let r = Ray::new(Vec3::new(0.0, 0.0, 200.0), DOWN);
    let hit = g.trace(&r).expect("the floor of the box, from inside");
    assert!(!is_cap(&hit) && (hit.t - 250.0).abs() < 1.0e-3);
    // A closed mesh whose material is a thin wall: the caller says so.
    let mut g = cut_box(true);
    assert_eq!(g.capped_instances(), vec![0]);
    g.set_section(Some(plane(UP, 0.0, true)), &[false]);
    assert!(g.capped_instances().is_empty());
    assert!(!is_cap(&g.trace(&r).expect("the inside")));
}

#[test]
fn a_ray_leaving_the_kept_side_finds_the_cap_beyond_the_plane() {
    let g = cut_box(true);
    // Inside the solid, going up: the cap is at the plane, though nothing is met before it.
    let r = Ray::new(Vec3::new(5.0, 5.0, -30.0), UP);
    let hit = g.trace(&r).expect("cap");
    assert!(is_cap(&hit) && (hit.t - 30.0).abs() < 1.0e-4, "{hit:?}");
    // Outside the solid, going up past its side: nothing, however far the removed part would be.
    assert_eq!(g.trace(&Ray::new(Vec3::new(80.0, 0.0, -30.0), UP)), None);
    // A shadow ray from inside the solid towards a light above is stopped by the cap, one from a
    // point beside it is not, and one that stays above the plane never sees the removed lid.
    let up = Ray::new(Vec3::new(5.0, 5.0, -30.0), UP);
    assert!(g.occluded(&up));
    assert!(!g.occluded(&Ray::new(Vec3::new(80.0, 0.0, -30.0), UP)));
    assert!(!g.occluded(&ray(Vec3::new(80.0, 0.0, 30.0), Vec3::new(-1.0, 0.0, 0.0))));
    // Without caps a shadow ray from inside the solid passes the plane freely.
    assert!(!cut_box(false).occluded(&up));
    // A bounded ray ends where it ends: short of the plane there is no cap to meet.
    let mut short = up;
    short.t_max = 20.0;
    assert_eq!(g.trace(&short), None);
    assert!(!g.occluded(&short));
}

#[test]
fn a_cut_through_a_moved_mirrored_instance_is_capped_the_same() {
    // The box mirrored in x and turned a quarter about z (a negative determinant), moved aside.
    let mesh = faceted_box(
        Vec3::new(-50.0, -20.0, -50.0),
        Vec3::new(50.0, 20.0, 50.0),
        true,
    );
    let to_world = Transform::from_rows([
        [0.0, -1.0, 0.0, 300.0],
        [-1.0, 0.0, 0.0, 0.0],
        [0.0, 0.0, 1.0, 0.0],
    ]);
    assert!(to_world.determinant() < 0.0);
    let mut g = Geometry::new(vec![mesh], vec![Instance::new(0, to_world, 0)]).unwrap();
    g.set_section(Some(plane(UP, 0.0, true)), &[]);
    assert_eq!(g.capped_instances(), vec![0]);
    // The footprint is x in 300 +- 20, y in +- 50.
    let hit = g
        .trace(&Ray::new(Vec3::new(310.0, 40.0, 200.0), DOWN))
        .unwrap();
    assert!(is_cap(&hit), "{hit:?}");
    assert_eq!(g.trace(&Ray::new(Vec3::new(330.0, 0.0, 200.0), DOWN)), None);
    assert_eq!(
        g.trace(&Ray::new(Vec3::new(310.0, 60.0, 200.0), DOWN)),
        None
    );
    // And the same cut seen from inside the solid.
    let hit = g
        .trace(&Ray::new(Vec3::new(310.0, 40.0, -10.0), UP))
        .unwrap();
    assert!(is_cap(&hit) && (hit.t - 10.0).abs() < 1.0e-4);
}

#[test]
fn a_tilted_plane_caps_where_it_cuts_and_the_cap_lies_on_it() {
    let normal = Vec3::new(1.0, 0.0, 1.0);
    let mut g = Geometry::from_meshes(vec![faceted_box(
        Vec3::splat(-50.0),
        Vec3::splat(50.0),
        true,
    )]);
    let p = plane(normal, 0.0, true);
    g.set_section(Some(p), &[]);
    // Seen along the normal from the removed side.
    let r = Ray::new(Vec3::new(10.0, 3.0, 10.0) + p.normal * 300.0, -p.normal);
    let hit = g.trace(&r).expect("cap");
    assert!(is_cap(&hit));
    let d = g.hit_details(&r, hit).unwrap();
    assert!(p.side(d.point).abs() < 1.0e-4, "{:?}", d.point);
    assert!((d.normal - p.normal).length() < 1.0e-6);
    // Straight down at x = 45 the plane is crossed at z = -45, inside the box; at x = 60 it is
    // crossed at z = -60, below it.
    let r = Ray::new(Vec3::new(45.0, 0.0, 300.0), DOWN);
    let hit = g.trace(&r).expect("cap");
    assert!(is_cap(&hit) && (g.hit_details(&r, hit).unwrap().point.z + 45.0).abs() < 1.0e-3);
    assert_eq!(g.trace(&Ray::new(Vec3::new(60.0, 0.0, 300.0), DOWN)), None);
}

#[test]
fn picking_through_a_cut_finds_the_cap_and_never_the_removed_part() {
    let mut scene = crate::scene::Scene {
        geometry: Geometry::from_meshes(vec![faceted_box(
            Vec3::splat(-50.0),
            Vec3::splat(50.0),
            true,
        )]),
        section: Some(plane(UP, 0.0, true)),
        ..crate::scene::Scene::default()
    };
    scene.apply_section();
    let hit = scene
        .pick(&Ray::new(Vec3::new(0.0, 0.0, 400.0), DOWN))
        .expect("the cap");
    assert_eq!((hit.instance, hit.triangle), (0, CAP_TRIANGLE));
    assert_eq!(hit.point.z, 0.0);
    assert!(scene
        .pick(&Ray::new(
            Vec3::new(-300.0, 0.0, 25.0),
            Vec3::new(1.0, 0.0, 0.0)
        ))
        .is_none());
}

#[test]
fn the_batches_and_every_instruction_set_answer_the_same() {
    let mut g = Geometry::from_meshes(vec![
        faceted_box(Vec3::splat(-50.0), Vec3::splat(50.0), true),
        crate::example::icosphere(Vec3::new(120.0, 0.0, 0.0), 40.0, 3),
    ]);
    g.set_section(Some(plane(Vec3::new(0.3, 0.2, 1.0), 5.0, true)), &[]);
    let mut rng = crate::rng::Pcg32::seeded(5, 9);
    let rays: Vec<Ray> = (0..400)
        .map(|_| {
            let o = Vec3::new(
                rng.next_f32() - 0.5,
                rng.next_f32() - 0.5,
                rng.next_f32() - 0.5,
            ) * 500.0;
            let d = Vec3::new(
                rng.next_f32() - 0.5,
                rng.next_f32() - 0.5,
                rng.next_f32() - 0.5,
            );
            Ray::new(o, d.normalize())
        })
        .collect();
    let mut batch = vec![None; rays.len()];
    g.trace_batch_with(&rays, &mut batch, Isa::Scalar);
    let mut any = vec![false; rays.len()];
    g.occluded_batch_with(&rays, &mut any, Isa::Scalar);
    let mut caps = 0;
    for (i, r) in rays.iter().enumerate() {
        let one = g.trace_with(r, Isa::Scalar);
        assert_eq!(one, g.trace(r));
        assert_eq!(one, batch[i]);
        assert_eq!(any[i], g.occluded_with(r, Isa::Scalar));
        caps += usize::from(one.is_some_and(|h| is_cap(&h)));
        // An any-hit query agrees with the nearest-hit one for rays that are not bounded.
        assert_eq!(any[i], one.is_some(), "{r:?}");
    }
    assert!(caps > 0 && caps < rays.len());
}

/// A 100 mm model box at the origin (cut), a ball and a floor slab that are studio
/// ([`INSTANCE_NO_SECTION`]); the plane removes `x > 0`.
fn model_and_studio(cap: bool) -> Geometry {
    let meshes = vec![
        faceted_box(Vec3::splat(-50.0), Vec3::splat(50.0), true),
        crate::example::icosphere(Vec3::new(300.0, 0.0, 0.0), 60.0, 3),
        faceted_box(
            Vec3::new(-600.0, -600.0, -70.0),
            Vec3::new(600.0, 600.0, -60.0),
            true,
        ),
    ];
    let studio = |mesh| Instance {
        flags: INSTANCE_NO_SECTION,
        ..Instance::new(mesh, Transform::IDENTITY, 0)
    };
    let mut g = Geometry::new(
        meshes,
        vec![
            Instance::new(0, Transform::IDENTITY, 0),
            studio(1),
            studio(2),
        ],
    )
    .unwrap();
    g.set_section(Some(plane(Vec3::new(1.0, 0.0, 0.0), 0.0, cap)), &[]);
    g
}

#[test]
fn the_studio_is_seen_on_the_removed_side_and_the_model_is_not() {
    let g = model_and_studio(true);
    // Straight down on the removed side, over the cut box and then over the floor: the box is
    // gone and the floor (an exempt slab) is there, top face at z = -60.
    let hit = g
        .trace(&Ray::new(Vec3::new(25.0, 0.0, 200.0), DOWN))
        .expect("the floor");
    assert_eq!(hit.instance, 2);
    assert!(!is_cap(&hit) && (hit.t - 260.0).abs() < 1.0e-3, "{hit:?}");
    // On the kept side the model is still there.
    let hit = g
        .trace(&Ray::new(Vec3::new(-25.0, 0.0, 200.0), DOWN))
        .unwrap();
    assert_eq!(hit.instance, 0);
    assert!((hit.t - 150.0).abs() < 1.0e-3);
    // The ball, wholly on the removed side, is a ball: from the side, from the removed side.
    let hit = g
        .trace(&ray(Vec3::new(600.0, 0.0, 0.0), Vec3::new(-1.0, 0.0, 0.0)))
        .unwrap();
    assert_eq!(hit.instance, 1);
    assert!((hit.t - 240.0).abs() < 1.0, "{hit:?}");
    // A ray that crosses the plane inside the box still finds the cap there, and a ray that has
    // the floor ahead on the kept side finds the floor.
    let hit = g
        .trace(&ray(Vec3::new(40.0, 0.0, 0.0), Vec3::new(-1.0, 0.0, -0.1)))
        .unwrap();
    assert!(is_cap(&hit) && hit.instance == 0, "{hit:?}");
    let hit = g
        .trace(&ray(
            Vec3::new(-500.0, 0.0, 100.0),
            Vec3::new(0.0, 0.0, -1.0),
        ))
        .unwrap();
    assert_eq!(hit.instance, 2);
    // Coming from the removed side, over the model, into the kept side with the floor in the
    // way on the removed side first: the floor, not the cap of the model behind it.
    let hit = g
        .trace(&ray(
            Vec3::new(60.0, 0.0, -50.0),
            Vec3::new(-1.0, 0.0, -0.4),
        ))
        .unwrap();
    assert_eq!(hit.instance, 2, "{hit:?}");
}

#[test]
fn the_studio_is_not_capped_and_casts_its_shadow_from_the_removed_side() {
    // A studio box that the plane goes through is whole: no cap, both halves there.
    let mut g = Geometry::new(
        vec![faceted_box(Vec3::splat(-50.0), Vec3::splat(50.0), true)],
        vec![Instance {
            flags: INSTANCE_NO_SECTION,
            ..Instance::new(0, Transform::IDENTITY, 0)
        }],
    )
    .unwrap();
    g.set_section(Some(plane(Vec3::new(1.0, 0.0, 0.0), 0.0, true)), &[]);
    assert!(g.capped_instances().is_empty());
    let hit = g
        .trace(&Ray::new(Vec3::new(25.0, 0.0, 200.0), DOWN))
        .unwrap();
    assert!(!is_cap(&hit) && (hit.t - 150.0).abs() < 1.0e-3, "{hit:?}");
    let hit = g
        .trace(&ray(Vec3::new(300.0, 0.0, 0.0), Vec3::new(-1.0, 0.0, 0.0)))
        .unwrap();
    assert!(!is_cap(&hit) && (hit.t - 250.0).abs() < 1.0e-3, "{hit:?}");
    // The shadow rays: the ball blocks a ray over the removed side, the cut box does not.
    let g = model_and_studio(true);
    let toward_ball = ray(Vec3::new(-100.0, 0.0, 0.0), Vec3::new(1.0, 0.0, 0.0));
    // From the box's left face, through the box (cut, so open to the plane) and on to the ball.
    assert!(g.occluded(&toward_ball));
    // Between the plane and the ball: only the ball (studio) is in the way.
    assert!(g.occluded(&ray(Vec3::new(100.0, 0.0, 0.0), Vec3::new(1.0, 0.0, 0.0))));
    // Over the ball there is nothing, and the cut box does not shade the floor behind it.
    assert!(!g.occluded(&ray(Vec3::new(100.0, 0.0, 200.0), Vec3::new(1.0, 0.0, 1.0))));
    let mut to_floor = ray(Vec3::new(25.0, 0.0, 10.0), Vec3::new(0.0, 0.0, -1.0));
    to_floor.t_max = 60.0;
    assert!(!g.occluded(&to_floor), "the removed box does not block");
    to_floor.t_max = 90.0;
    assert!(g.occluded(&to_floor), "the floor slab does");
}

/// What a query of `model` alone with the section, and of `studio` alone without it, find
/// together: the nearest of the two (the model's cap rule never sees the studio, which is
/// disjoint from the model).
#[test]
fn the_studio_and_the_model_together_are_the_nearest_of_each_alone() {
    for cap in [true, false] {
        let g = model_and_studio(cap);
        let meshes = |i: &[usize]| -> Vec<Mesh> {
            let all = [
                faceted_box(Vec3::splat(-50.0), Vec3::splat(50.0), true),
                crate::example::icosphere(Vec3::new(300.0, 0.0, 0.0), 60.0, 3),
                faceted_box(
                    Vec3::new(-600.0, -600.0, -70.0),
                    Vec3::new(600.0, 600.0, -60.0),
                    true,
                ),
            ];
            i.iter().map(|&k| all[k].clone()).collect()
        };
        let mut model = Geometry::from_meshes(meshes(&[0]));
        model.set_section(Some(plane(Vec3::new(1.0, 0.0, 0.0), 0.0, cap)), &[]);
        let studio = Geometry::from_meshes(meshes(&[1, 2]));
        let mut rng = crate::rng::Pcg32::seeded(11, 3);
        let (mut studio_wins, mut model_wins, mut caps) = (0, 0, 0);
        for _ in 0..3000 {
            let o = Vec3::new(
                rng.next_f32() - 0.5,
                rng.next_f32() - 0.5,
                rng.next_f32() - 0.5,
            ) * 1200.0;
            // Aimed at the neighbourhood of the model, so that many of them meet it.
            let aim = Vec3::new(
                rng.next_f32() - 0.5,
                rng.next_f32() - 0.5,
                rng.next_f32() - 0.5,
            ) * 160.0;
            let d = aim - o;
            let r = Ray::new(o, d.normalize());
            let m = model.trace(&r);
            let s = studio.trace(&r);
            let want = match (m, s) {
                (Some(m), Some(s)) if s.t < m.t => Some((1 + s.instance, s.triangle, s.t)),
                (Some(m), _) => Some((0, m.triangle, m.t)),
                (None, Some(s)) => Some((1 + s.instance, s.triangle, s.t)),
                (None, None) => None,
            };
            let got = g.trace(&r).map(|h| (h.instance, h.triangle, h.t));
            match (want, got) {
                (None, None) => {}
                (Some(w), Some(h)) => {
                    assert_eq!((w.0, w.1), (h.0, h.1), "{r:?}");
                    assert!((w.2 - h.2).abs() <= 1.0e-3 * w.2.max(1.0), "{r:?}");
                    studio_wins += usize::from(w.0 > 0);
                    model_wins += usize::from(w.0 == 0);
                    caps += usize::from(w.1 == CAP_TRIANGLE);
                }
                other => panic!("{other:?} for {r:?}"),
            }
            assert_eq!(
                g.occluded(&r),
                want.is_some(),
                "an unbounded shadow ray is blocked by what a trace finds: {r:?}"
            );
        }
        assert!(
            studio_wins > 300 && model_wins > 100,
            "{studio_wins} {model_wins}"
        );
        assert_eq!(caps > 0, cap, "{caps}");
    }
}

#[test]
fn the_studio_answers_alike_in_every_instruction_set_and_batch() {
    let g = model_and_studio(true);
    let mut rng = crate::rng::Pcg32::seeded(2, 8);
    let rays: Vec<Ray> = (0..400)
        .map(|_| {
            let o = Vec3::new(
                rng.next_f32() - 0.5,
                rng.next_f32() - 0.5,
                rng.next_f32() - 0.5,
            ) * 1000.0;
            let d = Vec3::new(
                rng.next_f32() - 0.5,
                rng.next_f32() - 0.5,
                rng.next_f32() - 0.5,
            );
            Ray::new(o, d.normalize())
        })
        .collect();
    let mut batch = vec![None; rays.len()];
    g.trace_batch_with(&rays, &mut batch, Isa::Scalar);
    for (i, r) in rays.iter().enumerate() {
        let one = g.trace_with(r, Isa::Scalar);
        assert_eq!(one, g.trace(r));
        assert_eq!(one, batch[i]);
        assert_eq!(one.is_some(), g.occluded_with(r, Isa::Scalar));
    }
}

#[test]
fn a_scene_where_everything_is_studio_is_a_scene_without_a_section() {
    let meshes = vec![
        faceted_box(Vec3::splat(-50.0), Vec3::splat(50.0), true),
        crate::example::icosphere(Vec3::new(120.0, 0.0, 0.0), 40.0, 3),
    ];
    let instances: Vec<Instance> = (0..2)
        .map(|k| Instance {
            flags: INSTANCE_NO_SECTION,
            ..Instance::new(k, Transform::IDENTITY, 0)
        })
        .collect();
    let mut cut = Geometry::new(meshes.clone(), instances.clone()).unwrap();
    cut.set_section(Some(plane(Vec3::new(0.3, 0.2, 1.0), 5.0, true)), &[]);
    let whole = Geometry::new(
        meshes,
        instances
            .iter()
            .map(|i| Instance { flags: 0, ..*i })
            .collect(),
    )
    .unwrap();
    assert!(cut.capped_instances().is_empty());
    let mut rng = crate::rng::Pcg32::seeded(4, 4);
    for _ in 0..500 {
        let o = Vec3::new(
            rng.next_f32() - 0.5,
            rng.next_f32() - 0.5,
            rng.next_f32() - 0.5,
        ) * 600.0;
        let d = Vec3::new(
            rng.next_f32() - 0.5,
            rng.next_f32() - 0.5,
            rng.next_f32() - 0.5,
        );
        let r = Ray::new(o, d.normalize());
        assert_eq!(cut.trace(&r), whole.trace(&r), "{r:?}");
        assert_eq!(cut.occluded(&r), whole.occluded(&r), "{r:?}");
    }
}
