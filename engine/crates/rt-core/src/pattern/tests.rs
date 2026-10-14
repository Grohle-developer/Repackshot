//! Tests of the patterns in the scene: where they lie, what they change, and what they leave.

use super::*;
use crate::bevel::BevelSetup;
use crate::geometry::{Instance, Transform};
use crate::image::Film;
use crate::integrator::Prepared;
use crate::render::{render_tile_prepared, TileRect};
use crate::simd::Isa;

fn oak(material: u32) -> Pattern {
    Pattern {
        material,
        kind: PATTERN_WOOD,
        color_a: Rgb::new(0.56, 0.38, 0.21),
        color_b: Rgb::new(0.3, 0.18, 0.09),
        scale_mm: 6.0,
        params: [
            0.45, 0.35, 0.25, 0.2, 0.35, 0.3, 0.5, 1.0, 1.0, 0.3, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0,
        ],
        variant: 0,
        seed: 0,
    }
}

/// Denim as the 2/2 twill of the other twills, coarser (1.5 mm threads, so a ray grid sees
/// them), its yarn twisted.
fn twill(material: u32) -> Pattern {
    Pattern {
        material,
        kind: PATTERN_CLOTH,
        color_a: Rgb::new(0.1, 0.16, 0.3),
        color_b: Rgb::new(0.66, 0.66, 0.64),
        scale_mm: 1.5,
        params: [
            0.6, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0,
        ],
        variant: 1,
        seed: 0,
    }
}

/// A sphere of radius 50 with one material carrying `pattern`.
fn sphere_scene(pattern: Option<Pattern>) -> Scene {
    Scene {
        materials: vec![Material {
            base_color: Rgb::splat(0.5),
            roughness: 0.4,
            ..Material::default()
        }],
        geometry: Geometry::new(
            vec![crate::example::icosphere(Vec3::ZERO, 50.0, 3)],
            vec![Instance::new(0, Transform::IDENTITY, 0)],
        )
        .expect("geometry"),
        patterns: pattern.into_iter().collect(),
        ..Scene::default()
    }
}

/// Shading point and tint where a ray from `from` towards the origin hits.
fn at(scene: &Scene, from: Vec3) -> (ShadingPoint, Option<Tint>) {
    let ray = Ray::new(from, (-from).normalize());
    let hit = scene.geometry.intersect(&ray).expect("hit");
    let mut shade = BevelSetup::new(scene).shading_point(scene, &ray, &hit);
    let tint = PatternSetup::new(scene).apply(scene, &ray, &hit, &mut shade);
    (shade, tint)
}

#[test]
fn a_pattern_colours_its_material_only() {
    let plain = sphere_scene(None);
    assert!(PatternSetup::new(&plain).is_empty());
    let from = Vec3::new(30.0, -200.0, 40.0);
    let (shade, tint) = at(&plain, from);
    assert_eq!(tint, None);
    // A pattern of another material changes nothing.
    let other = sphere_scene(Some(oak(3)));
    assert!(PatternSetup::new(&other).is_empty());
    assert_eq!(at(&other, from), (shade, None));
    // An emitter takes no pattern.
    let mut lamp = sphere_scene(Some(oak(0)));
    lamp.materials[0].kind = crate::scene::MATERIAL_EMISSIVE;
    assert!(PatternSetup::new(&lamp).is_empty());
}

#[test]
fn wood_varies_its_colour_and_its_pores_tilt_the_normal() {
    let scene = sphere_scene(Some(oak(0)));
    let mut colours = Vec::new();
    let mut tilted = 0;
    for k in 0..200 {
        let a = k as f32 * 0.071;
        let from = Vec3::new(
            200.0 * a.cos(),
            200.0 * a.sin(),
            (k % 17) as f32 * 9.0 - 70.0,
        );
        let plain = sphere_scene(None);
        let (base, _) = at(&plain, from);
        let (shade, tint) = at(&scene, from);
        let tint = tint.expect("wood");
        colours.push(tint.base_color.luminance());
        assert_eq!(shade.point, base.point);
        assert_eq!(shade.geometric, base.geometric);
        if shade.normal != base.normal {
            tilted += 1;
            // A pore's wall tilts the normal by less than 37° (measured: 34° at most here).
            assert!(
                shade.normal.dot(base.normal) > 0.8,
                "a pore is a gentle dip"
            );
        }
        assert!((0.5..2.0).contains(&tint.roughness));
    }
    let (lo, hi) = colours
        .iter()
        .fold((f32::INFINITY, 0.0f32), |(a, b), &c| (a.min(c), b.max(c)));
    assert!(hi > 1.5 * lo, "rings: {lo}..{hi}");
    assert!(tilted > 10, "{tilted} points in pores");
}

#[test]
fn cloth_projects_on_the_mesh_axes_and_its_relief_tilts_the_normal() {
    let scene = sphere_scene(Some(twill(0)));
    let plain = sphere_scene(None);
    let mut warp_like = 0;
    let mut tilted = 0;
    let mut across = 0;
    for k in 0..300 {
        let from = Vec3::new(
            (k % 23) as f32 * 3.0 - 33.0,
            -200.0,
            (k / 23) as f32 * 4.0 - 26.0,
        );
        let (base, _) = at(&plain, from);
        let (shade, tint) = at(&scene, from);
        let tint = tint.expect("cloth");
        let c = tint.base_color;
        // The highlights stretch across the thread on top: the warp runs upright on this side
        // of the ball (along z), the weft along x.
        assert_eq!(tint.anisotropy, 0.5);
        let t = tint.tangent.expect("a tangent across the thread on top");
        if c.b > c.r * 1.5 {
            warp_like += 1;
            across += usize::from(t == Vec3::new(1.0, 0.0, 0.0));
        } else if c.b < c.r * 1.2 {
            across += usize::from(t == Vec3::new(0.0, 0.0, 1.0));
        } else {
            across += 1;
        }
        if shade.normal != base.normal {
            tilted += 1;
            assert!(shade.normal.dot(base.normal) > 0.3, "a bump, not a fold");
        }
        assert_eq!((shade.point, shade.geometric), (base.point, base.geometric));
    }
    // Twill: half warp (dark blue), half weft (grey).
    assert!((100..200).contains(&warp_like), "{warp_like}");
    assert!(across > 285, "{across} of 300 across the thread on top");
    assert!(tilted > 250, "{tilted}");
    // Without relief, the normal stays.
    let mut flat = twill(0);
    flat.params[0] = 0.0;
    let flat = sphere_scene(Some(flat));
    let from = Vec3::new(5.0, -200.0, 3.0);
    assert_eq!(at(&flat, from).0, at(&plain, from).0);
    // Felt has no threads: no anisotropy.
    let mut felt = twill(0);
    felt.variant = 5;
    let tint = at(&sphere_scene(Some(felt)), from).1.expect("felt");
    assert_eq!((tint.anisotropy, tint.tangent), (0.0, None));
}

#[test]
fn the_box_projection_blends_without_a_seam() {
    // Along a great circle of the sphere, through the bands where the projection changes axis:
    // the colour of neighbouring points 0.05 mm apart never jumps by more than a thread's own
    // contrast does inside one projection. The weights are |n|^8: one axis rules away from the
    // diagonals.
    let pattern = twill(0);
    let scene = sphere_scene(Some(pattern));
    let setup = PatternSetup::new(&scene);
    let mut jumps = Vec::new();
    let mut last: Option<Rgb> = None;
    for i in 0..4000 {
        let a = 0.6 + i as f32 * 0.0001;
        let from = Vec3::new(200.0 * a.cos(), -200.0 * a.sin(), 0.0);
        let ray = Ray::new(from, (-from).normalize());
        let hit = scene.geometry.intersect(&ray).expect("hit");
        let c = setup.albedo(&scene, &hit).expect("cloth");
        if let Some(l) = last {
            jumps.push((c.luminance() - l.luminance()).abs());
        }
        last = Some(c);
    }
    let [w0, w1, _] = projection_weights(Vec3::new(0.6f32.cos(), 0.6f32.sin(), 0.0));
    assert!(w0 > 0.9 && w1 < 0.1, "the arc starts in one projection");
    let [w0, w1, _] = projection_weights(Vec3::new(1.0f32.cos(), 1.0f32.sin(), 0.0));
    assert!(w0 < 0.1 && w1 > 0.9, "and ends in the other");
    let big = jumps.iter().filter(|&&j| j > 0.05).count();
    assert!(big < jumps.len() / 50, "{big} jumps of {}", jumps.len());
}

#[test]
fn where_projections_meet_the_cloth_is_their_blend() {
    // On a diagonal the two projections weigh half each, at a cube corner's direction a third
    // each: the colour is their weighted mean, never one of them alone (nor nothing).
    let scene = sphere_scene(Some(twill(0)));
    let setup = PatternSetup::new(&scene);
    let placed = setup.instances[0].as_ref().expect("placed");
    let Recipe::Cloth(c) = &placed.recipe else {
        panic!("cloth")
    };
    let p = Vec3::new(31.3, -22.7, 17.9);
    let d = (p - placed.origin) * placed.mm;
    let at = [d.x, d.y, d.z];
    let plane = |k: usize| {
        let (a, b) = plane_axes(k);
        c.sample(at[a], at[b]).color
    };
    let s3 = 1.0 / 3.0f32.sqrt();
    for (n, want) in [
        (
            Vec3::new(s3, s3, s3),
            (plane(0) + plane(1) + plane(2)) * (1.0 / 3.0),
        ),
        (
            Vec3::new(0.5f32.sqrt(), 0.0, 0.5f32.sqrt()),
            (plane(0) + plane(2)) * 0.5,
        ),
    ] {
        let got = placed.color_only(p, n);
        for (g, w) in [(got.r, want.r), (got.g, want.g), (got.b, want.b)] {
            assert!((g - w).abs() < 1.0e-5, "{got:?} vs {want:?}");
        }
    }
    // The three projections differ there, so a blend is not any one of them.
    assert!(plane(0) != plane(1) || plane(1) != plane(2));
}

#[test]
fn a_cloth_pattern_decodes_its_colours_spacing_relief_twist_and_weave() {
    let mut p = twill(0);
    (p.params[0], p.params[1], p.variant) = (1.7, 0.25, 6);
    let Some(Recipe::Cloth(c)) = p.recipe() else {
        panic!("cloth")
    };
    assert_eq!(
        (c.warp, c.weft, c.pitch_mm, c.relief, c.twist, c.weave),
        (p.color_a, p.color_b, 1.5, 1.0, 0.25, cloth::Weave::Twill31)
    );
    p.params[1] = -3.0;
    let Some(Recipe::Cloth(c)) = p.recipe() else {
        panic!("cloth")
    };
    assert_eq!(c.twist, 0.0);
}

#[test]
fn the_albedo_pass_shows_the_colour_the_camera_path_shades_with() {
    for pattern in [oak(0), twill(0)] {
        let scene = sphere_scene(Some(pattern));
        let setup = PatternSetup::new(&scene);
        for k in 0..50 {
            let a = k as f32 * 0.13;
            let from = Vec3::new(
                200.0 * a.cos(),
                200.0 * a.sin(),
                (k % 7) as f32 * 12.0 - 36.0,
            );
            let ray = Ray::new(from, (-from).normalize());
            let hit = scene.geometry.intersect(&ray).expect("hit");
            let mut shade = BevelSetup::new(&scene).shading_point(&scene, &ray, &hit);
            let tint = setup.apply(&scene, &ray, &hit, &mut shade).expect("tint");
            assert_eq!(setup.albedo(&scene, &hit), Some(tint.base_color));
        }
    }
}

#[test]
fn the_pattern_sticks_to_the_part_and_scales_with_it() {
    // The same sphere moved and scaled 2x by its instance: the pattern at corresponding points
    // is the same, with the millimetre sizes of the recipe (a scaled instance shows rings of the
    // same width in the world, so twice as many in its mesh space).
    let near = Vec3::new(20.0, -200.0, 15.0);
    let a = sphere_scene(Some(oak(0)));
    let mut moved = sphere_scene(Some(oak(0)));
    moved.geometry = Geometry::new(
        vec![crate::example::icosphere(Vec3::ZERO, 50.0, 3)],
        vec![Instance::new(
            0,
            Transform::translation(Vec3::new(300.0, 0.0, 0.0)),
            0,
        )],
    )
    .expect("geometry");
    let ray = |s: &Scene, from: Vec3, to: Vec3| {
        let r = Ray::new(from, (to - from).normalize());
        let hit = s.geometry.intersect(&r).expect("hit");
        let mut shade = BevelSetup::new(s).shading_point(s, &r, &hit);
        PatternSetup::new(s).apply(s, &r, &hit, &mut shade)
    };
    let here = ray(&a, near, Vec3::ZERO);
    let there = ray(
        &moved,
        near + Vec3::new(300.0, 0.0, 0.0),
        Vec3::new(300.0, 0.0, 0.0),
    );
    assert_eq!(here, there);
    let setup = PatternSetup::new(&moved);
    let mut scaled = moved.clone();
    scaled.geometry = Geometry::new(
        vec![crate::example::icosphere(Vec3::ZERO, 25.0, 3)],
        vec![Instance::new(0, Transform::scale(Vec3::splat(2.0)), 0)],
    )
    .expect("geometry");
    let s2 = PatternSetup::new(&scaled);
    assert_ne!(setup, s2);
    let close = |x: Option<Tint>, y: Option<Tint>| {
        let (x, y) = (x.expect("x").base_color, y.expect("y").base_color);
        (x.r - y.r).abs() < 2.0e-3 && (x.g - y.g).abs() < 2.0e-3
    };
    assert!(close(
        ray(&a, near, Vec3::ZERO),
        ray(&scaled, near, Vec3::ZERO)
    ));
}

#[test]
fn the_wood_pith_runs_along_the_longest_side_below_the_box() {
    // A 200 mm board, 40 wide and 18 thick: the pith along it, 0.8 of its length (160 mm) below
    // its centre across its thickness and 0.35 of it (70 mm) aside, towards -x.
    let (pith, axes) = wood_frame(Vec3::ZERO, Vec3::new(40.0, 200.0, 18.0), 1.0);
    assert_eq!(axes[2], Vec3::new(0.0, 1.0, 0.0), "along the board");
    assert_eq!(axes[1], Vec3::new(0.0, 0.0, 1.0), "across its thickness");
    assert!((pith.z - (9.0 - 160.0)).abs() < 1.0e-4, "{pith:?}");
    assert!((pith.x - (20.0 - 70.0)).abs() < 1.0e-4, "{pith:?}");
    // A ball (a cube's box): the pith passes outside it on both sides, so no ring is centred on
    // its top.
    let (ball, _) = wood_frame(Vec3::splat(-50.0), Vec3::splat(100.0), 1.0);
    assert!(
        (ball.y * ball.y + ball.z * ball.z).sqrt() > 50.0 * 2.0f32.sqrt(),
        "{ball:?}"
    );
    // A block thicker than a log is wide: the pith still runs below it.
    let (block, _) = wood_frame(Vec3::ZERO, Vec3::new(2000.0, 1000.0, 900.0), 1.0);
    assert!(block.z < 0.0, "{block:?}");
    // A 2 m table top: never farther than a log's radius.
    let (far, _) = wood_frame(Vec3::ZERO, Vec3::new(2000.0, 900.0, 30.0), 1.0);
    assert!((far.z - (15.0 - MAX_PITH_MM)).abs() < 1.0e-3, "{far:?}");
    // In mesh units of 10 mm the same 250 mm.
    let (scaled, _) = wood_frame(Vec3::ZERO, Vec3::new(200.0, 90.0, 3.0), 10.0);
    assert!(
        (scaled.z - (1.5 - MAX_PITH_MM / 10.0)).abs() < 1.0e-3,
        "{scaled:?}"
    );
}

#[test]
fn wood_stretches_its_roughness_along_the_grain() {
    let scene = sphere_scene(Some(oak(0)));
    let from = Vec3::new(30.0, -200.0, 40.0);
    let (shade, tint) = at(&scene, from);
    let tint = tint.expect("wood");
    assert_eq!(tint.anisotropy, 0.3);
    let frame = tint.frame(shade.normal).expect("a tangent");
    // The sphere's box is a cube: the pith runs along X, the tangent follows it.
    assert!(
        frame.x.dot(Vec3::new(1.0, 0.0, 0.0)).abs() > 0.5,
        "{:?}",
        frame.x
    );
    assert!(frame.x.dot(shade.normal).abs() < 1.0e-5);
    let m = tint.apply(&scene.materials[0]);
    assert_eq!(m.anisotropy, 0.3);
    let mut plain = oak(0);
    plain.params[9] = 0.0;
    let (shade, tint) = at(&sphere_scene(Some(plain)), from);
    assert_eq!(tint.expect("wood").frame(shade.normal), None);
}

#[test]
fn a_patterned_render_is_deterministic_and_differs_from_the_flat_colour() {
    let mut scene = sphere_scene(Some(oak(0)));
    scene.camera.position = Vec3::new(0.0, -260.0, 40.0);
    scene.camera.target = Vec3::ZERO;
    scene.camera.focus_dist = 260.0;
    scene.render.width = 32;
    scene.render.height = 24;
    let render = |s: &Scene, isa: Isa| {
        let prepared = Prepared::new(s);
        let mut film = Film::new(32, 24);
        let tile = TileRect {
            x: 0,
            y: 0,
            w: 32,
            h: 24,
        };
        for k in 0..2 {
            render_tile_prepared(s, &prepared, tile, k, &mut film, isa);
        }
        film
    };
    let reference = render(&scene, Isa::Scalar);
    for isa in Isa::available() {
        assert_eq!(render(&scene, isa), reference, "{}", isa.name());
    }
    let flat = sphere_scene(None);
    let mut flat_scene = scene.clone();
    flat_scene.patterns = flat.patterns;
    assert_ne!(render(&flat_scene, Isa::detect()).rgb, reference.rgb);
}

/// Pine with `count` knots of `diameter` mm, contrast and noise off (so a knot is the only dark
/// thing on the board): a 400 x 120 x 20 mm board.
fn knotty(count: u32, diameter: f32, seed: u32) -> Scene {
    let mut pine = oak(0);
    pine.color_a = Rgb::new(0.7, 0.55, 0.35);
    pine.color_b = pine.color_a;
    pine.params = [
        0.4,
        0.3,
        0.2,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        count as f32,
        diameter,
        0.0,
        1.0,
        0.0,
        0.0,
    ];
    pine.scale_mm = 5.0;
    pine.seed = seed;
    let board = crate::geometry::edges::faceted_box(
        Vec3::new(-200.0, -60.0, -10.0),
        Vec3::new(200.0, 60.0, 10.0),
        false,
    );
    Scene {
        geometry: Geometry::new(vec![board], vec![Instance::new(0, Transform::IDENTITY, 0)])
            .expect("geometry"),
        patterns: vec![pine],
        ..sphere_scene(None)
    }
}

/// The albedo of the board's top seen straight from above every 0.5 mm (an albedo pass).
fn top_albedo(scene: &Scene) -> Vec<f32> {
    let setup = PatternSetup::new(scene);
    let mut out = Vec::with_capacity(800 * 240);
    for j in 0..240 {
        for i in 0..800 {
            let from = Vec3::new(-199.75 + i as f32 * 0.5, -59.75 + j as f32 * 0.5, 100.0);
            let ray = Ray::new(from, Vec3::new(0.0, 0.0, -1.0));
            let hit = scene.geometry.intersect(&ray).expect("the board");
            out.push(setup.albedo(scene, &hit).expect("wood").luminance());
        }
    }
    out
}

/// The dark discs of an albedo image of the board: the pixel count of each.
fn discs(albedo: &[f32], plain: f32) -> Vec<usize> {
    let (w, h) = (800usize, 240usize);
    let dark: Vec<bool> = albedo.iter().map(|&a| a < 0.8 * plain).collect();
    let mut seen = vec![false; w * h];
    let mut out = Vec::new();
    for start in 0..w * h {
        if !dark[start] || seen[start] {
            continue;
        }
        let (mut stack, mut n) = (vec![start], 0usize);
        seen[start] = true;
        while let Some(i) = stack.pop() {
            n += 1;
            let (x, y) = ((i % w) as i32, (i / w) as i32);
            for (dx, dy) in [(-1, 0), (1, 0), (0, -1), (0, 1)] {
                let (nx, ny) = (x + dx, y + dy);
                if nx >= 0 && ny >= 0 && (nx as usize) < w && (ny as usize) < h {
                    let j = ny as usize * w + nx as usize;
                    if dark[j] && !seen[j] {
                        seen[j] = true;
                        stack.push(j);
                    }
                }
            }
        }
        if n > 20 {
            out.push(n);
        }
    }
    out
}

#[test]
fn a_board_shows_as_many_knots_as_asked_and_of_the_size_asked() {
    let plain = top_albedo(&knotty(0, 15.0, 1));
    let level = plain.iter().sum::<f32>() / plain.len() as f32;
    for (count, d) in [(2u32, 15.0f32), (6, 15.0), (6, 30.0)] {
        let found = discs(&top_albedo(&knotty(count, d, 1)), level);
        assert_eq!(
            found.len(),
            count as usize,
            "{count} knots of {d} mm: {found:?}"
        );
        // The diameter of a disc of the same area (0.25 mm² a pixel): a knot crosses the face
        // a little obliquely (its branch tilts up the trunk), so somewhat wider.
        let mean = found
            .iter()
            .map(|&n| (4.0 * n as f32 * 0.25 / std::f32::consts::PI).sqrt())
            .sum::<f32>()
            / found.len() as f32;
        eprintln!(
            "{count} knots of {d} mm: {} discs, {mean:.1} mm across",
            found.len()
        );
        assert!(
            mean > 0.95 * d && mean < 1.35 * d,
            "{count} of {d} mm: {mean} mm"
        );
    }
}

#[test]
fn knots_follow_the_seed_and_none_change_nothing() {
    let a = top_albedo(&knotty(3, 18.0, 5));
    assert_eq!(a, top_albedo(&knotty(3, 18.0, 5)));
    assert_ne!(a, top_albedo(&knotty(3, 18.0, 6)));
    // No knots: the same bits whatever the other knot values (and the seed).
    let mut zero = knotty(0, 18.0, 5);
    let none = top_albedo(&zero);
    zero.patterns[0].params[11] = 0.0;
    zero.patterns[0].params[13] = 0.0;
    zero.patterns[0].seed = 0;
    assert_eq!(none, top_albedo(&zero));
    // Bamboo, fibreboard and ebony have none even when asked.
    let mut strips = knotty(3, 18.0, 5);
    strips.patterns[0].variant = 1;
    let asked = top_albedo(&strips);
    strips.patterns[0].params[10] = 0.0;
    assert_eq!(asked, top_albedo(&strips));
}

#[test]
fn a_knot_is_rougher_and_its_dish_tilts_the_normal() {
    // A roughness added after the multiplier.
    let tint = Tint {
        base_color: Rgb::splat(0.5),
        roughness: 1.0,
        roughness_add: 0.1,
        anisotropy: 0.0,
        tangent: None,
    };
    let m = Material {
        roughness: 0.4,
        ..Material::default()
    };
    assert!((tint.apply(&m).roughness - 0.5).abs() < 1.0e-6);
    // On a board of pine (no pores, so no other relief): straight down onto its knot, the darkest
    // point, the roughness rises; around it the dish tilts the normal, elsewhere nothing does.
    let scene = knotty(1, 20.0, 1);
    let albedo = top_albedo(&scene);
    let darkest = (0..albedo.len())
        .min_by(|&a, &b| albedo[a].total_cmp(&albedo[b]))
        .expect("pixels");
    let point = |i: usize| {
        Vec3::new(
            -199.75 + (i % 800) as f32 * 0.5,
            -59.75 + (i / 800) as f32 * 0.5,
            100.0,
        )
    };
    let shade = |s: &Scene, from: Vec3| {
        let ray = Ray::new(from, Vec3::new(0.0, 0.0, -1.0));
        let hit = s.geometry.intersect(&ray).expect("the board");
        let mut sp = BevelSetup::new(s).shading_point(s, &ray, &hit);
        let t = PatternSetup::new(s)
            .apply(s, &ray, &hit, &mut sp)
            .expect("wood");
        (sp.normal, t)
    };
    assert!(shade(&scene, point(darkest)).1.roughness_add > 0.09);
    let tilted = (0..albedo.len())
        .step_by(7)
        .filter(|&i| shade(&scene, point(i)).0.z < 1.0 - 1.0e-6)
        .count();
    assert!(tilted > 0, "the dish");
    let plain = knotty(0, 20.0, 1);
    let (n, t) = shade(&plain, point(darkest));
    assert_eq!((n, t.roughness_add), (Vec3::new(0.0, 0.0, 1.0), 0.0));
}

#[test]
fn knots_on_a_ball_never_graze_it() {
    // Twelve knots asked of a ball of 100 mm: those placed cross its surface at 45° or more
    // (against the radius, where the axis meets the sphere), the others are dropped.
    let mut pine = knotty(12, 10.0, 3).patterns[0].clone();
    pine.color_b = Rgb::new(0.4, 0.3, 0.2);
    let scene = sphere_scene(Some(pine));
    let setup = PatternSetup::new(&scene);
    let placed = setup.instances[0].as_ref().expect("wood");
    assert!(
        !placed.knots.is_empty() && placed.knots.list.len() < 12,
        "{}",
        placed.knots.list.len()
    );
    let to_mesh = |q: Vec3| {
        placed.origin
            + (placed.axes[0] * q.x + placed.axes[1] * q.y + placed.axes[2] * q.z)
                * (1.0 / placed.mm)
    };
    for k in &placed.knots.list {
        let (o, d) = (
            to_mesh(k.origin),
            (to_mesh(k.origin + k.axis) - to_mesh(k.origin)).normalize(),
        );
        // |o + t d| = 50: both crossings.
        let (b, c) = (o.dot(d), o.dot(o) - 2500.0);
        let disc = b * b - c;
        assert!(disc > 0.0, "every knot crosses the ball");
        for t in [-b - disc.sqrt(), -b + disc.sqrt()] {
            let n = (o + d * t).normalize();
            assert!(n.dot(d).abs() > 0.68, "{}", n.dot(d));
        }
    }
}
