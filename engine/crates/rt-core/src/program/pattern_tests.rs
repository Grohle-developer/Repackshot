//! Tests of the pattern nodes (M3c): a material program's `WOOD*` and `CLOTH*` instructions give,
//! point by point, what the material's pattern (`PATN`, E6) gives at the same parameters — the
//! colour, the roughness, the anisotropy and its grain, the bent normal, the albedo — bit for bit,
//! placed on each part as the material's pattern is (its frame, its knots); and what they give
//! without a part.

use super::build::{Builder, N, P};
use super::interp::{Context, NoHost, Outputs, Runner};
use super::*;
use crate::geometry::Hit;
use crate::integrator::Prepared;
use crate::math::{Ray, Vec3};
use crate::pattern::{sample_at, Pattern, Placement, PATTERN_CLOTH, PATTERN_WOOD};
use crate::scene::Scene;
use crate::texture::Footprint;

/// Rays at the parts of `scene` (every instance but the floor, 0) from outside: from points on a
/// sphere three times the part's size around its centre, above the floor, at points near its
/// centre; the hits on the part itself.
fn hits(scene: &Scene) -> Vec<(Ray, Hit)> {
    let geometry = &scene.geometry;
    let mut out = Vec::new();
    for i in 1..geometry.instances().len() as u32 {
        let (mesh, _) = geometry.instance_mesh(i).expect("mesh");
        let b = mesh.bounds();
        let inst = &geometry.instances()[i as usize];
        let centre = inst.transform.point(b.min + (b.max - b.min) * 0.5);
        let size = (b.max - b.min).length();
        let n = 400;
        for k in 0..n {
            // A Fibonacci sphere, upper half.
            let z = 1.0 - (k as f32 + 0.5) / n as f32;
            let r = (1.0 - z * z).max(0.0).sqrt();
            let a = k as f32 * 2.399_963;
            let d = Vec3::new(r * a.cos(), r * a.sin(), z.max(0.05));
            let jitter = Vec3::new(
                ((k * 7) % 11) as f32 / 11.0 - 0.5,
                ((k * 5) % 13) as f32 / 13.0 - 0.5,
                ((k * 3) % 7) as f32 / 7.0 - 0.5,
            ) * (0.6 * size);
            let target = centre + jitter;
            let origin = target + d.normalize() * (3.0 * size);
            let ray = Ray::new(origin, (target - origin).normalize());
            if let Some(hit) = geometry.intersect(&ray) {
                if hit.instance == i && hit.front_face {
                    out.push((ray, hit));
                }
            }
        }
    }
    out
}

fn bits(v: Vec3) -> [u32; 3] {
    [v.x.to_bits(), v.y.to_bits(), v.z.to_bits()]
}

/// Compares, at every hit of `hits`, the family's pattern in `family` with the program of the
/// same instance in `nodes`: the material, the shading normal, the frame and the albedo, bit for
/// bit. Returns how many hits it compared.
fn same_at_every_hit(family: &Scene, nodes: &Scene) -> usize {
    let (pf, pn) = (Prepared::new(family), Prepared::new(nodes));
    assert!(pn.patterns.is_empty(), "the node scene has no PATN drawn");
    let list = hits(family);
    for (ray, hit) in &list {
        let plain_f = pf.material(family, hit.instance);
        let plain_n = pn.material(nodes, hit.instance);
        let mut shade_f = pf.bevel.shading_point(family, ray, hit);
        let tint = pf
            .patterns
            .apply(family, ray, hit, &mut shade_f)
            .expect("a pattern");
        let mf = tint.apply(plain_f);
        let mut shade_n = pn.bevel.shading_point(nodes, ray, hit);
        let res = pn
            .programs
            .apply(
                nodes,
                &pn.bevel,
                ray,
                hit,
                &mut shade_n,
                plain_n,
                &Footprint::NONE,
            )
            .expect("a program");
        let mn = &res.material;
        let at = format!("instance {} at {:?}", hit.instance, hit.point);
        assert_eq!(
            [mf.base_color.r, mf.base_color.g, mf.base_color.b].map(f32::to_bits),
            [mn.base_color.r, mn.base_color.g, mn.base_color.b].map(f32::to_bits),
            "colour, {at}"
        );
        assert_eq!(
            mf.roughness.to_bits(),
            mn.roughness.to_bits(),
            "roughness, {at}"
        );
        assert_eq!(
            mf.anisotropy.to_bits(),
            mn.anisotropy.to_bits(),
            "anisotropy, {at}"
        );
        assert_eq!(bits(shade_f.normal), bits(shade_n.normal), "normal, {at}");
        let (ff, fn_) = (tint.frame(shade_f.normal), res.frame(shade_n.normal));
        assert_eq!(ff.is_some(), fn_.is_some(), "a grain, {at}");
        if let (Some(a), Some(b)) = (ff, fn_) {
            assert_eq!(bits(a.x), bits(b.x), "grain, {at}");
        }
        let albedo_f = pf.patterns.albedo(family, hit).expect("albedo");
        let albedo_n = pn
            .programs
            .albedo(nodes, &pn.bevel, ray, hit, plain_n, &Footprint::NONE)
            .expect("albedo")
            .base_color;
        assert_eq!(
            [albedo_f.r, albedo_f.g, albedo_f.b].map(f32::to_bits),
            [albedo_n.r, albedo_n.g, albedo_n.b].map(f32::to_bits),
            "albedo, {at}"
        );
    }
    list.len()
}

#[test]
fn wood_nodes_give_the_wood_family_bit_for_bit_at_every_point() {
    // The E6 pattern scene: an oak board with three knots and pores, bevelled, and a walnut
    // sphere; and the same with WOOD nodes (`Builder::pattern_material`).
    let family = crate::example::e6_patterns_scene();
    let nodes = crate::example::m3c_wood_scene();
    let n = same_at_every_hit(&family, &nodes);
    assert!(n > 300, "{n} hits");
    // The knots are the family's, placed on the part with its own test of the surface.
    let (pf, pn) = (Prepared::new(&family), Prepared::new(&nodes));
    let counts = pf.patterns.knot_counts();
    assert!(counts[1] > 0, "the board has knots: {counts:?}");
    let got = pn.programs.knot_counts(1);
    assert_eq!(got.len(), 1);
    assert_eq!(got[0].1, counts[1]);
}

#[test]
fn cloth_nodes_give_the_fabric_family_bit_for_bit_off_a_bevel() {
    // The E6 cloth scene (a denim twill 3/1 and a knit) without the cushion's bevel: inside a
    // bevel the node's box projection follows its normal input, the bevelled normal, where the
    // material's follows the interpolated one.
    let mut family = crate::example::e6_cloth_scene();
    for m in &mut family.materials {
        m.bevel_mm = 0.0;
    }
    let nodes = crate::example::as_pattern_nodes(family.clone());
    let n = same_at_every_hit(&family, &nodes);
    assert!(n > 300, "{n} hits");
}

#[test]
fn every_wood_figure_and_weave_gives_its_family_bit_for_bit() {
    // The other figures (bamboo strips, fibreboard speckle, streaked ebony) and weaves (plain,
    // 2/2 twill, satin, canvas, felt) on the same parts.
    for variant in [1, 2, 3] {
        let mut family = crate::example::e6_patterns_scene();
        for p in &mut family.patterns {
            p.variant = variant;
        }
        let nodes = crate::example::as_pattern_nodes(family.clone());
        assert!(same_at_every_hit(&family, &nodes) > 300, "figure {variant}");
    }
    for variant in [0, 1, 2, 3, 5] {
        let mut family = crate::example::e6_cloth_scene();
        for m in &mut family.materials {
            m.bevel_mm = 0.0;
        }
        for p in &mut family.patterns {
            p.variant = variant;
        }
        let nodes = crate::example::as_pattern_nodes(family.clone());
        assert!(same_at_every_hit(&family, &nodes) > 300, "weave {variant}");
    }
}

/// A program of every output of a pattern instruction (`ops`: colour, roughness, height,
/// normal) over `pattern`, the roughness read from 0.5.
fn all_outputs(pattern: &Pattern, ops: [u32; 4]) -> Program {
    let mut b = Builder::new();
    let k = b.pattern_consts(pattern);
    let colour = b.v(ops[0], P, N, NONE, k);
    let half = b.fconst(0.5);
    let rough = b.f(ops[1], P, N, half, k);
    let height = b.f(ops[2], P, N, NONE, k);
    let normal = b.v(ops[3], P, N, NONE, k);
    b.out(OUT_BASE_COLOR, colour, true);
    b.out(OUT_ROUGHNESS, rough, false);
    b.out(OUT_BUMP, height, false);
    b.out(OUT_NORMAL, normal, true);
    b.build()
}

#[test]
fn without_a_part_a_pattern_lies_in_the_points_own_space() {
    // The reference's host (and the cross test's): no part, the frame of the point itself in
    // millimetres, no knots. Each output is what `sample_at` gives there.
    let wood = crate::example::e6_patterns_scene().patterns[0].clone();
    let cloth = crate::example::e6_cloth_scene().patterns[0].clone();
    for (pattern, ops) in [
        (&wood, [op::WOOD, op::WOODR, op::WOODH, op::WOODN]),
        (&cloth, [op::CLOTH, op::CLOTHR, op::CLOTHH, op::CLOTHN]),
    ] {
        let runner = Runner::new(all_outputs(pattern, ops), Vec::new());
        let recipe = pattern.recipe().expect("a recipe");
        for i in 0..200 {
            let t = i as f32 * 0.37;
            let p = Vec3::new(40.0 * t.sin(), 30.0 + 10.0 * t.cos(), 3.0 * t);
            let n = Vec3::new(t.cos(), -0.5, t.sin()).normalize();
            let ctx = Context {
                p: [p.x, p.y, p.z],
                n: [n.x, n.y, n.z],
                ..Context::default()
            };
            let mut out = Outputs::default();
            runner.run(&ctx, &mut NoHost, &mut out);
            let s = sample_at(&recipe, &Placement::IDENTITY, p, n, n);
            let c = s.tint.base_color;
            assert_eq!(out.vec(OUT_BASE_COLOR), [c.r, c.g, c.b]);
            assert_eq!(
                out.scalar(OUT_ROUGHNESS).to_bits(),
                (0.5 * s.tint.roughness + s.tint.roughness_add).to_bits()
            );
            assert_eq!(out.scalar(OUT_BUMP).to_bits(), s.height.to_bits());
            let want = s.slope.map_or(n, |g| crate::pattern::bump(n, g));
            assert_eq!(out.vec(OUT_NORMAL), [want.x, want.y, want.z]);
        }
    }
    assert_eq!(wood.kind, PATTERN_WOOD);
    assert_eq!(cloth.kind, PATTERN_CLOTH);
}

#[test]
fn a_pattern_whose_scale_is_not_positive_draws_nothing() {
    // No recipe: black, the roughness read, height 0 and the normal read.
    let mut wood = crate::example::e6_patterns_scene().patterns[0].clone();
    wood.scale_mm = 0.0;
    let runner = Runner::new(
        all_outputs(&wood, [op::WOOD, op::WOODR, op::WOODH, op::WOODN]),
        Vec::new(),
    );
    let ctx = Context {
        p: [10.0, 20.0, 30.0],
        n: [0.0, -1.0, 0.0],
        ..Context::default()
    };
    let mut out = Outputs::default();
    runner.run(&ctx, &mut NoHost, &mut out);
    assert_eq!(out.vec(OUT_BASE_COLOR), [0.0; 3]);
    assert_eq!(out.scalar(OUT_ROUGHNESS), 0.5);
    assert_eq!(out.scalar(OUT_BUMP), 0.0);
    assert_eq!(out.vec(OUT_NORMAL), [0.0, -1.0, 0.0]);
}

#[test]
fn the_pattern_constants_are_the_patn_layout_and_are_checked() {
    let wood = crate::example::e6_patterns_scene().patterns[0].clone();
    let p = all_outputs(&wood, [op::WOOD, op::WOODR, op::WOODH, op::WOODN]);
    // Read back as the pattern it came from (its material aside).
    let back = p.pattern_of(&p.code[0]).expect("a pattern");
    assert_eq!(
        Pattern {
            material: 0,
            ..wood.clone()
        },
        back
    );
    assert_eq!(p.code[2].op, op::WOODR);
    assert_eq!(p.pattern_of(&p.code[2]), Some(back.clone()));
    assert_eq!(p.pattern_of(&p.code[1]), None, "an FCONST");
    // A program whose constants stop short of the 25 is refused.
    let mut short = p.clone();
    short
        .consts
        .truncate(short.code[0].k as usize + PATTERN_CONSTS - 1);
    assert!(Program::decode(&short.encode()).is_err());
    // So is one reading its point from a register nothing wrote.
    let mut wrong = p.clone();
    wrong.code[0].a = wrong.nv + 5;
    assert!(Program::decode(&wrong.encode()).is_err());
}
