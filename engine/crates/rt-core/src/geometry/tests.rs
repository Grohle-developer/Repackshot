//! The BVH against brute force, determinism, containment, instances and `pick`.

use super::bvh::{leaf_range, WideNode, WideNodes, EMPTY, LEAF};
use super::traverse::brute_force;
use super::*;
use crate::rng::Pcg32;

/// The same mesh with a BVH of `width`.
fn rebuilt(mesh: &Mesh, width: BvhWidth) -> Mesh {
    let positions: Vec<Vec3> = (0..mesh.vertex_count())
        .filter_map(|i| mesh.position(i))
        .collect();
    let normals: Vec<Vec3> = (0..mesh.vertex_count())
        .filter_map(|i| mesh.normal(i))
        .collect();
    Mesh::with_width(
        &positions,
        &normals,
        mesh.indices(),
        mesh.material_id(),
        width,
    )
    .expect("a valid mesh stays valid")
}

/// The same geometry with every BVH (meshes and instances) of `width`.
fn with_width(geometry: &Geometry, width: BvhWidth) -> Geometry {
    let meshes = geometry
        .meshes()
        .iter()
        .map(|m| rebuilt(m, width))
        .collect();
    Geometry::with_width(meshes, geometry.instances().to_vec(), width).expect("valid")
}

fn icosphere_geometry() -> Geometry {
    Geometry::from_meshes(vec![crate::example::icosphere(
        Vec3::new(10.0, -20.0, 100.0),
        100.0,
        4,
    )])
}

fn example_geometry() -> Geometry {
    crate::example::scene().geometry
}

/// 5 000 triangles: random ones and degenerate ones (points, repeated corners, collinear
/// corners, slivers and exact duplicates of earlier triangles).
fn soup_geometry() -> Geometry {
    let mut rng = Pcg32::seeded(2024, 7);
    let mut f = move || rng.next_f32();
    let mut positions: Vec<Vec3> = Vec::new();
    let mut indices: Vec<u32> = Vec::new();
    while indices.len() < 5000 * 3 {
        let kind = (f() * 10.0) as u32;
        let center = Vec3::new(f() - 0.5, f() - 0.5, f() - 0.5) * 100.0;
        let mut corner = |size: f32| center + Vec3::new(f() - 0.5, f() - 0.5, f() - 0.5) * size;
        let base = positions.len() as u32;
        match kind {
            0 => positions.extend([center; 3]),
            1 => {
                let a = corner(20.0);
                positions.extend([a, corner(20.0), a]);
            }
            2 => {
                let (a, b) = (corner(20.0), corner(20.0));
                positions.extend([a, b, a.lerp(b, 0.375)]);
            }
            3 if indices.len() >= 3 => {
                let t = (indices.len() / 3) as u32;
                let pick = (((t as f32) * 0.618) as u32 % t) as usize * 3;
                let copy = [indices[pick], indices[pick + 1], indices[pick + 2]];
                indices.extend(copy);
                continue;
            }
            4 => {
                let (a, b) = (corner(30.0), corner(30.0));
                positions.extend([a, b, a.lerp(b, 0.5) + Vec3::new(0.0, 0.0, 1.0e-4)]);
            }
            _ => positions.extend([corner(15.0), corner(15.0), corner(15.0)]),
        }
        indices.extend([base, base + 1, base + 2]);
    }
    let mesh = Mesh::new(&positions, &[], &indices, 0).expect("valid soup");
    assert_eq!(mesh.triangle_count(), 5000);
    Geometry::from_meshes(vec![mesh])
}

/// `count` rays around `geometry`: random origins and directions, rays aimed at random
/// triangles (degenerate ones included), axis-aligned rays and random parameter intervals.
fn random_rays(geometry: &Geometry, count: usize, seed: u64) -> Vec<Ray> {
    let mut rng = Pcg32::seeded(seed, 99);
    let b = geometry.bounds();
    let size = (b.max - b.min).max_component();
    let lo = b.min - Vec3::splat(size * 0.5);
    let span = (b.max - b.min) + Vec3::splat(size);
    let mut rays = Vec::with_capacity(count);
    let mut f = || rng.next_f32();
    while rays.len() < count {
        let origin = lo + Vec3::new(f() * span.x, f() * span.y, f() * span.z);
        let dir = match rays.len() % 4 {
            // Aimed at a vertex combination of a random triangle of a random instance.
            0 | 1 => {
                let instance = &geometry.instances()[(f() * geometry.instances().len() as f32)
                    as usize
                    % geometry.instances().len()];
                let mesh = &geometry.meshes()[instance.mesh as usize];
                let tri = (f() * mesh.triangle_count() as f32) as usize % mesh.triangle_count();
                let [p0, p1, p2] = mesh.triangle(tri).expect("triangle");
                let (u, v) = (f(), f());
                let (u, v) = if u + v > 1.0 {
                    (1.0 - u, 1.0 - v)
                } else {
                    (u, v)
                };
                let target = p0 * (1.0 - u - v) + p1 * u + p2 * v;
                instance.transform.point(target) - origin
            }
            // Axis aligned, both signs and signed zeros.
            2 if rays.len() % 32 == 2 => {
                let axis = (f() * 3.0) as usize % 3;
                let sign = if f() < 0.5 { -1.0 } else { 1.0 };
                let zero = if f() < 0.5 { -0.0 } else { 0.0 };
                let mut d = [zero; 3];
                d[axis] = sign;
                Vec3::new(d[0], d[1], d[2])
            }
            _ => Vec3::new(f() - 0.5, f() - 0.5, f() - 0.5),
        };
        let mut ray = Ray::new(origin, dir);
        match rays.len() % 7 {
            0 => ray.t_max = f() * 1.5,
            1 => ray.t_min = f() * 0.5,
            _ => {}
        }
        rays.push(ray);
    }
    rays
}

/// Every available SIMD path, on BVH4 and BVH8, against brute force, for 10 000 rays.
fn agrees_with_brute_force(geometry: &Geometry, seed: u64) {
    let rays = random_rays(geometry, 10_000, seed);
    let reference: Vec<(Option<RayHit>, bool)> =
        rays.iter().map(|r| brute_force(geometry, r)).collect();
    let hits = reference.iter().filter(|(h, _)| h.is_some()).count();
    assert!(
        hits > 2_000,
        "only {hits} rays hit: the test would prove little"
    );
    assert!(reference.iter().any(|(h, any)| h.is_none() && !any));

    for width in [BvhWidth::Four, BvhWidth::Eight] {
        let g = with_width(geometry, width);
        for isa in Isa::available() {
            for (i, (ray, (expected, expected_any))) in rays.iter().zip(&reference).enumerate() {
                let got = g.trace_with(ray, isa);
                match (got, expected) {
                    (Some(a), Some(b)) => {
                        assert_eq!(
                            (a.instance, a.triangle),
                            (b.instance, b.triangle),
                            "{} {width:?} ray {i}: {ray:?}",
                            isa.name()
                        );
                        assert!(
                            (a.t - b.t).abs() <= 1.0e-6 * b.t.abs(),
                            "{} {width:?} ray {i}: t {} vs {}",
                            isa.name(),
                            a.t,
                            b.t
                        );
                    }
                    (None, None) => {}
                    _ => panic!(
                        "{} {width:?} ray {i}: BVH {got:?}, brute force {expected:?}, {ray:?}",
                        isa.name()
                    ),
                }
                assert_eq!(
                    g.occluded_with(ray, isa),
                    *expected_any,
                    "{} {width:?} any-hit, ray {i}: {ray:?}",
                    isa.name()
                );
            }
            // The batch entry points give the same answers.
            let mut batch = vec![None; rays.len()];
            g.trace_batch_with(&rays, &mut batch, isa);
            let mut any = vec![false; rays.len()];
            g.occluded_batch_with(&rays, &mut any, isa);
            for (i, (expected, expected_any)) in reference.iter().enumerate() {
                assert_eq!(
                    batch[i].map(|h| (h.instance, h.triangle)),
                    expected.map(|h| (h.instance, h.triangle))
                );
                assert_eq!(any[i], *expected_any);
            }
        }
    }
}

#[test]
fn bvh_matches_brute_force_on_the_icosphere() {
    agrees_with_brute_force(&icosphere_geometry(), 1);
}

#[test]
fn bvh_matches_brute_force_on_the_example_scene_with_instances() {
    let geometry = example_geometry();
    assert!(geometry.instances().len() >= 3);
    assert!(geometry
        .instances()
        .iter()
        .any(|i| !i.transform.is_identity()));
    agrees_with_brute_force(&geometry, 2);
}

#[test]
fn bvh_matches_brute_force_on_a_degenerate_triangle_soup() {
    agrees_with_brute_force(&soup_geometry(), 3);
}

#[test]
fn degenerate_triangles_never_produce_nan() {
    let geometry = soup_geometry();
    for ray in random_rays(&geometry, 4000, 4) {
        if let Some(hit) = geometry.intersect(&ray) {
            assert!(hit.t.is_finite() && hit.t >= ray.t_min && hit.t <= ray.t_max);
            assert!(hit.point.is_finite(), "{hit:?}");
            assert!((hit.normal.length() - 1.0).abs() < 1.0e-3, "{hit:?}");
            assert!(
                (hit.geometric_normal.length() - 1.0).abs() < 1.0e-3,
                "{hit:?}"
            );
            assert!(hit.barycentrics.iter().all(|b| b.is_finite()), "{hit:?}");
        }
    }
}

#[test]
fn construction_is_deterministic() {
    for width in [BvhWidth::Four, BvhWidth::Eight] {
        for make in [icosphere_geometry, example_geometry, soup_geometry] {
            let a = with_width(&make(), width);
            let b = with_width(&make(), width);
            assert_eq!(a, b);
        }
    }
}

/// Checks that every slot box of every node contains what is below it.
fn check_mesh_tree<const N: usize>(nodes: &[WideNode<N>], mesh: &Mesh) -> usize {
    let (_, packets) = mesh.accel();
    let contains = |outer: &Aabb, p: Vec3| {
        p.x >= outer.min.x
            && p.y >= outer.min.y
            && p.z >= outer.min.z
            && p.x <= outer.max.x
            && p.y <= outer.max.y
            && p.z <= outer.max.z
    };
    let mut checked = 0;
    for node in nodes {
        for slot in 0..N {
            let child = node.child[slot];
            let b = node.child_bounds(slot);
            if child == EMPTY {
                assert!(b.is_empty());
            } else if child & LEAF != 0 {
                let (first, count) = leaf_range(child);
                for p in &packets[first..first + count] {
                    for &id in &p.id {
                        for corner in mesh.triangle(id as usize).expect("triangle") {
                            assert!(contains(&b, corner), "triangle {id} outside its leaf box");
                            checked += 1;
                        }
                    }
                }
            } else {
                let inner = &nodes[child as usize];
                for s in 0..N {
                    if inner.child[s] != EMPTY {
                        let c = inner.child_bounds(s);
                        assert!(contains(&b, c.min) && contains(&b, c.max));
                    }
                }
            }
        }
    }
    checked
}

#[test]
fn wide_node_bounds_contain_their_children() {
    for width in [BvhWidth::Four, BvhWidth::Eight] {
        let g = with_width(&soup_geometry(), width);
        let mesh = &g.meshes()[0];
        let (bvh, _) = mesh.accel();
        let checked = match &bvh.nodes {
            WideNodes::Four(n) => check_mesh_tree(n, mesh),
            WideNodes::Eight(n) => check_mesh_tree(n, mesh),
        };
        assert!(checked >= 5000 * 3);
        let stats = mesh.bvh_stats();
        assert_eq!(stats.width, width);
        assert!(stats.leaves >= 5000 / 8, "{stats:?}");
    }
}

/// Two parallel quads facing -Y at y = 10 and y = 20 (instances of one mesh).
fn two_walls() -> Geometry {
    let quad = Mesh::new(
        &[
            Vec3::new(-5.0, 0.0, -5.0),
            Vec3::new(5.0, 0.0, -5.0),
            Vec3::new(5.0, 0.0, 5.0),
            Vec3::new(-5.0, 0.0, 5.0),
        ],
        &[],
        &[0, 1, 2, 0, 2, 3],
        0,
    )
    .expect("quad");
    let at = |y: f32| Transform::translation(Vec3::new(0.0, y, 0.0));
    Geometry::new(
        vec![quad],
        vec![Instance::new(0, at(20.0), 1), Instance::new(0, at(10.0), 2)],
    )
    .expect("valid")
}

#[test]
fn pick_returns_the_front_most_hit() {
    let g = two_walls();
    let ray = Ray::new(Vec3::new(1.0, -10.0, 2.0), Vec3::new(0.0, 1.0, 0.0));
    let hit = g.intersect(&ray).expect("hit");
    assert_eq!(hit.instance, 1, "the wall at y = 10 is in front");
    assert!((hit.t - 20.0).abs() < 1.0e-5);
    assert!((hit.point - Vec3::new(1.0, 10.0, 2.0)).length() < 1.0e-5);
    assert!((hit.normal - Vec3::new(0.0, -1.0, 0.0)).length() < 1.0e-6);
    assert!(hit.front_face, "the quads are wound to face -Y");
    assert!((hit.barycentrics.iter().sum::<f32>() - 1.0).abs() < 1.0e-6);
    // Starting past the first wall finds the second; shadow rays see both.
    let mut beyond = ray;
    beyond.t_min = 25.0;
    assert_eq!(g.intersect(&beyond).map(|h| h.instance), Some(0));
    assert!(g.occluded(&ray));
    let mut short = ray;
    short.t_max = 15.0;
    assert!(!g.occluded(&short));
    assert_eq!(g.trace(&short), None);
    // Seen from behind: the nearest is now the other wall, and it is a back face.
    let back = Ray::new(Vec3::new(1.0, 40.0, 2.0), Vec3::new(0.0, -1.0, 0.0));
    let hit = g.intersect(&back).expect("hit");
    assert_eq!(hit.instance, 0);
    assert!(!hit.front_face);
    assert!((hit.normal - Vec3::new(0.0, 1.0, 0.0)).length() < 1.0e-6);
    // Unusable rays never hit.
    for bad in [
        Ray::new(Vec3::new(f32::NAN, 0.0, 0.0), Vec3::new(0.0, 1.0, 0.0)),
        Ray::new(Vec3::ZERO, Vec3::ZERO),
        Ray::new(Vec3::ZERO, Vec3::new(0.0, f32::INFINITY, 0.0)),
    ] {
        assert_eq!(g.intersect(&bad), None);
        assert!(!g.occluded(&bad));
    }
}

#[test]
fn pick_on_the_example_scene_finds_the_second_sphere_instance() {
    let scene = crate::example::scene();
    let small = scene
        .geometry
        .instances()
        .iter()
        .position(|i| !i.transform.is_identity())
        .expect("a transformed instance") as u32;
    let instance = scene.geometry.instances()[small as usize];
    // The sphere mesh is centred at (0, 0, 100) with radius 100.
    let centre = instance.transform.point(Vec3::new(0.0, 0.0, 100.0));
    let radius = (instance.transform.point(Vec3::new(0.0, 0.0, 200.0)) - centre).length();
    let ray = Ray::new(scene.camera.position, centre - scene.camera.position);
    let hit = scene.pick(&ray).expect("the small sphere is visible");
    assert_eq!(hit.instance, small);
    assert!(((hit.point - centre).length() - radius).abs() < radius * 0.02);
    // The normal faces the camera and is close to the radial direction.
    assert!(hit.normal.dot(ray.dir) < 0.0);
    assert!(hit.normal.dot((hit.point - centre).normalize()) > 0.99);
    assert!(hit.front_face);
}

#[test]
fn one_sided_instances_hide_their_back_faces() {
    let g = two_walls();
    let mut instances = g.instances().to_vec();
    for i in &mut instances {
        i.flags |= INSTANCE_ONE_SIDED;
    }
    let one_sided = Geometry::new(g.meshes().to_vec(), instances).expect("valid");
    let front = Ray::new(Vec3::new(1.0, -10.0, 2.0), Vec3::new(0.0, 1.0, 0.0));
    let back = Ray::new(Vec3::new(1.0, 40.0, 2.0), Vec3::new(0.0, -1.0, 0.0));
    assert_eq!(one_sided.trace(&front).map(|h| h.instance), Some(1));
    assert_eq!(one_sided.trace(&back), None);
    assert!(!one_sided.occluded(&back));
    for isa in Isa::available() {
        assert_eq!(brute_force(&one_sided, &back), (None, false));
        assert_eq!(one_sided.trace_with(&back, isa), None);
    }
}

#[test]
fn transformed_instances_move_points_and_normals() {
    // A mirrored, scaled and translated copy of a triangle that faces +Z in its mesh.
    let mesh = Mesh::new(
        &[
            Vec3::ZERO,
            Vec3::new(1.0, 0.0, 0.0),
            Vec3::new(0.0, 1.0, 0.0),
        ],
        &[Vec3::new(0.0, 0.0, 1.0); 3],
        &[0, 1, 2],
        0,
    )
    .expect("triangle");
    let mirror = Transform::from_rows([
        [-2.0, 0.0, 0.0, 10.0],
        [0.0, 2.0, 0.0, 0.0],
        [0.0, 0.0, 4.0, 3.0],
    ]);
    let g = Geometry::new(vec![mesh], vec![Instance::new(0, mirror, 0)]).expect("valid");
    // World triangle: (10,0,3), (8,0,3), (10,2,3); plane z = 3, front faces +Z.
    let ray = Ray::new(Vec3::new(9.5, 0.5, 10.0), Vec3::new(0.0, 0.0, -2.0));
    let hit = g.intersect(&ray).expect("hit");
    assert!((hit.t - 3.5).abs() < 1.0e-5);
    assert!((hit.point - Vec3::new(9.5, 0.5, 3.0)).length() < 1.0e-5);
    assert!((hit.normal - Vec3::new(0.0, 0.0, 1.0)).length() < 1.0e-6);
    assert!((hit.geometric_normal - Vec3::new(0.0, 0.0, 1.0)).length() < 1.0e-6);
    assert!(hit.front_face);
    assert!(g.bounds().max.z >= 3.0 && g.bounds().min.x <= 8.0);
    // A singular transform makes an instance that is never hit.
    let flat = Transform::scale(Vec3::new(1.0, 1.0, 0.0));
    let g = Geometry::new(g.meshes().to_vec(), vec![Instance::new(0, flat, 0)]).expect("valid");
    assert_eq!(g.trace(&ray), None);
    assert!(g.bounds().is_empty());
}

#[test]
fn geometry_validation_and_counts() {
    let g = example_geometry();
    assert_eq!(g.triangle_count(), 322);
    assert_eq!(g.instanced_triangle_count(), 642);
    assert!(!g.has_implicit_instances());
    assert!(Geometry::from_meshes(g.meshes().to_vec()).has_implicit_instances());
    assert_eq!(
        Geometry::new(
            g.meshes().to_vec(),
            vec![Instance::new(9, Transform::IDENTITY, 0)]
        ),
        Err(GeometryError::MeshOutOfRange { instance: 0 })
    );
    assert_eq!(
        GeometryError::MeshOutOfRange { instance: 3 }.to_string(),
        "instance 3 refers to a mesh that does not exist"
    );
    let empty = Geometry::default();
    let ray = Ray::new(Vec3::ZERO, Vec3::new(1.0, 0.0, 0.0));
    assert_eq!(empty.trace(&ray), None);
    assert!(!empty.occluded(&ray));
    assert!(empty.bounds().is_empty());
    assert_eq!(g.bvh_stats().leaves, 3);
}
