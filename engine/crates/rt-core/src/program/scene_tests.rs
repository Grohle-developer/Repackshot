//! Tests of the material programs in scenes (M3b): the values of a program reach the BSDF point
//! by point in the part's own space, its normal bends the shading, its opacity cuts out (for the
//! camera and the shadow rays), its emission adds or emits (an emitter whose emission varies is
//! not a light), its bevel weight scales the bevel, the curvature is the bevel's sharp edges, its
//! images are filtered over the footprint (the reads of a bump on one level), the RSB carries the
//! programs (and files without them read and write as before), and patterns give way to them.

use super::build::{Builder, P, UV0};
use super::interp::{Context, Footprint as LodFootprint, Host, Outputs, Runner};
use super::*;
use crate::bevel::BevelSetup;
use crate::color::Rgb;
use crate::geometry::{Geometry, Instance, Mesh, Transform};
use crate::image::Film;
use crate::integrator::Prepared;
use crate::math::{Ray, Vec3};
use crate::render::{render_tile_prepared, TileRect};
use crate::scene::{
    Camera, EnvKind, Environment, Material, RenderSettings, RsbError, Scene,
    BACKGROUND_ENVIRONMENT, MATERIAL_EMISSIVE, MATERIAL_FLAG_LIGHT,
};
use crate::simd::Isa;
use crate::texture::image::{TextureImage, COLOR_LINEAR, COLOR_SRGB};
use crate::texture::Footprint;
use std::sync::Arc;

/// A square in the plane y = 0 facing −Y, `half` mm on each side, UVs 0..1 (u along +X, v along
/// +Z).
fn square(half: f32) -> Mesh {
    let p = [
        Vec3::new(-half, 0.0, -half),
        Vec3::new(half, 0.0, -half),
        Vec3::new(half, 0.0, half),
        Vec3::new(-half, 0.0, half),
    ];
    let n = [Vec3::new(0.0, -1.0, 0.0); 4];
    Mesh::new(&p, &n, &[0, 1, 2, 0, 2, 3], 0)
        .expect("square")
        .with_uvs(vec![vec![[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]]])
        .expect("uvs")
}

/// A matte Lambert material without a specular lobe.
fn matte(c: f32) -> Material {
    Material {
        base_color: Rgb::splat(c),
        roughness: 1.0,
        ior: 1.0,
        ..Material::default()
    }
}

/// `mesh` with `material` and `program`, seen from the front by an orthographic camera 200 mm
/// wide at `w × h`, in a uniform white world, with `instance`'s transform.
fn scene_of(
    mesh: Mesh,
    material: Material,
    program: Option<Program>,
    transform: Transform,
) -> Scene {
    Scene {
        camera: Camera {
            position: Vec3::new(0.0, -1000.0, 0.0),
            target: Vec3::ZERO,
            up: Vec3::new(0.0, 0.0, 1.0),
            ortho: true,
            ortho_width: 200.0,
            ..Camera::default()
        },
        materials: vec![material],
        geometry: Geometry::new(vec![mesh], vec![Instance::new(0, transform, 0)])
            .expect("geometry"),
        environment: Environment {
            kind: EnvKind::Flat,
            horizon: 1.0,
            strength: 1.0,
            background_mode: BACKGROUND_ENVIRONMENT,
            ..Environment::default()
        },
        render: RenderSettings {
            width: 16,
            height: 16,
            tonemap: 0,
            ..RenderSettings::default()
        },
        programs: vec![program.map(Arc::new)],
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

fn pixel(film: &Film, x: u32, y: u32) -> Rgb {
    let p = film.resolve();
    let i = ((y * film.width + x) * 3) as usize;
    Rgb::new(p[i], p[i + 1], p[i + 2])
}

/// Red where `x` (a scalar register) is below 0, green elsewhere: the base colour output.
fn red_green(b: &mut Builder, x: u32) {
    let zero = b.fconst(0.0);
    let right = b.f(op::FLT, zero, x, NONE, NONE);
    let red = b.vconst([1.0, 0.0, 0.0]);
    let green = b.vconst([0.0, 1.0, 0.0]);
    let c = b.v(op::VLERP, red, green, right, NONE);
    b.out(OUT_BASE_COLOR, c, true);
    b.out_const(OUT_ROUGHNESS, &[1.0]);
    b.out_const(OUT_IOR, &[1.0]);
}

#[test]
fn a_program_gives_the_material_its_values_point_by_point_in_the_parts_space() {
    // Red where the part's own x is negative, green where it is positive (its 3D coordinates,
    // OBJECT), on a matte square in a white world: the left half of the picture red, the right
    // green; the plain material is grey.
    let mut b = Builder::new();
    let x = b.f(op::VX, P, NONE, NONE, NONE);
    red_green(&mut b, x);
    let program = b.build();
    let scene = scene_of(
        square(100.0),
        matte(0.5),
        Some(program.clone()),
        Transform::IDENTITY,
    );
    let film = render(&scene, 16);
    let (left, right) = (pixel(&film, 3, 8), pixel(&film, 12, 8));
    assert!(left.r > 0.9 && left.g < 0.05, "left {left:?}");
    assert!(right.g > 0.9 && right.r < 0.05, "right {right:?}");
    let mut plain = scene.clone();
    plain.programs.clear();
    let grey = pixel(&render(&plain, 16), 3, 8);
    assert!(
        (grey.r - 0.5).abs() < 0.05 && (grey.g - 0.5).abs() < 0.05,
        "{grey:?}"
    );
    // The program runs in the part's own space: moved 50 mm to the right, the split goes with it
    // (pixel 10 is now on the red side of the part's own x = 0, at world x = 50).
    let moved = scene_of(
        square(100.0),
        matte(0.5),
        Some(program),
        Transform::translation(Vec3::new(50.0, 0.0, 0.0)),
    );
    let film = render(&moved, 16);
    assert!(pixel(&film, 10, 8).r > 0.9, "{:?}", pixel(&film, 10, 8));
    assert!(pixel(&film, 14, 8).g > 0.9, "{:?}", pixel(&film, 14, 8));
}

#[test]
fn the_uvs_the_tangent_and_the_view_reach_the_program() {
    // The shading point the integrator fills: at the square's centre seen from the front, P is
    // the point, N the outward normal (−Y), UV0 (0.5, 0.5), UV1 the same (one set), I towards the
    // camera, T along u (+X), B = N × T, and the UVs change by 1/200 per mm along T.
    let mut b = Builder::new();
    for (o, r) in [(OUT_BASE_COLOR, 2u32), (OUT_EMISSION, 4), (OUT_NORMAL, 5)] {
        b.out(o, r, true);
    }
    let program = b.build();
    let runner = Runner::new(program, Vec::new());
    let scene = scene_of(square(100.0), matte(0.5), None, Transform::IDENTITY);
    let ray = Ray::new(Vec3::new(10.0, -500.0, 20.0), Vec3::new(0.0, 1.0, 0.0));
    let hit = scene.geometry.intersect(&ray).expect("hit");
    let local = crate::texture::shade::Local::of(&scene.geometry, &hit).expect("local");
    let (ctx, side) = shade::context_for_tests(&scene, &hit, hit.normal, -ray.dir, &local);
    assert_eq!(side, 1.0);
    let close = |a: [f32; 3], b: [f32; 3]| (0..3).all(|i| (a[i] - b[i]).abs() < 1.0e-5);
    assert!(close(ctx.p, [10.0, 0.0, 20.0]), "{:?}", ctx.p);
    assert!(close(ctx.n, [0.0, -1.0, 0.0]), "{:?}", ctx.n);
    assert!(close(ctx.uv0, [0.55, 0.6, 0.0]), "{:?}", ctx.uv0);
    assert_eq!(ctx.uv1, ctx.uv0);
    assert!(close(ctx.i, [0.0, -1.0, 0.0]), "{:?}", ctx.i);
    assert!(close(ctx.t, [1.0, 0.0, 0.0]), "{:?}", ctx.t);
    assert!(close(ctx.b, [0.0, 0.0, 1.0]), "{:?}", ctx.b);
    assert!(close(ctx.duv_t, [0.005, 0.0, 0.0]), "{:?}", ctx.duv_t);
    assert!(close(ctx.duv_b, [0.0, 0.005, 0.0]), "{:?}", ctx.duv_b);
    let mut out = Outputs::default();
    runner.run(&ctx, &mut interp::NoHost, &mut out);
    assert_eq!(out.vec(OUT_BASE_COLOR), ctx.uv0);
    // From behind, the normal is still the outside's (the program sees the part, not the side).
    let back = Ray::new(Vec3::new(10.0, 500.0, 20.0), Vec3::new(0.0, -1.0, 0.0));
    let hit = scene.geometry.intersect(&back).expect("hit");
    let local = crate::texture::shade::Local::of(&scene.geometry, &hit).expect("local");
    let mut n = hit.normal;
    if n.dot(hit.geometric_normal) < 0.0 {
        n = -n;
    }
    let (ctx, side) = shade::context_for_tests(&scene, &hit, n, -back.dir, &local);
    assert_eq!(side, -1.0);
    assert!(close(ctx.n, [0.0, -1.0, 0.0]), "{:?}", ctx.n);
    // Without UVs: zero UVs and the onb tangent of N.
    let bare = {
        let p = [
            Vec3::new(-100.0, 0.0, -100.0),
            Vec3::new(100.0, 0.0, -100.0),
            Vec3::new(100.0, 0.0, 100.0),
        ];
        Mesh::new(&p, &[Vec3::new(0.0, -1.0, 0.0); 3], &[0, 1, 2], 0).expect("triangle")
    };
    let scene = scene_of(bare, matte(0.5), None, Transform::IDENTITY);
    let ray = Ray::new(Vec3::new(20.0, -500.0, 10.0), Vec3::new(0.0, 1.0, 0.0));
    let hit = scene.geometry.intersect(&ray).expect("hit");
    let local = crate::texture::shade::Local::of(&scene.geometry, &hit).expect("local");
    let (ctx, _) = shade::context_for_tests(&scene, &hit, hit.normal, -ray.dir, &local);
    assert_eq!(ctx.uv0, [0.0; 3]);
    assert_eq!(ctx.t, interp::onb_tangent(ctx.n));
}

#[test]
fn a_programs_normal_bends_the_shading_normal_in_the_world() {
    // A program whose normal is (0.6, −0.8, 0) in the part's space: on the square seen from
    // the front, the shading normal is that, turned with the instance (90° about Z: (0.8, 0.6,
    // 0)), and the point and the geometric normal stay.
    let mut b = Builder::new();
    let n = b.vconst([0.6, -0.8, 0.0]);
    b.out(OUT_NORMAL, n, true);
    let program = b.build();
    for (transform, want, from) in [
        (
            Transform::IDENTITY,
            Vec3::new(0.6, -0.8, 0.0),
            Vec3::new(0.0, -500.0, 0.0),
        ),
        (
            Transform::from_rows([
                [0.0, -1.0, 0.0, 0.0],
                [1.0, 0.0, 0.0, 0.0],
                [0.0, 0.0, 1.0, 0.0],
            ]),
            Vec3::new(0.8, 0.6, 0.0),
            Vec3::new(500.0, 0.0, 0.0),
        ),
    ] {
        let scene = scene_of(square(100.0), matte(0.5), Some(program.clone()), transform);
        let prepared = Prepared::new(&scene);
        let ray = Ray::new(from, -from.normalize());
        let hit = scene.geometry.intersect(&ray).expect("hit");
        let mut shade = prepared.bevel.shading_point(&scene, &ray, &hit);
        let before = shade;
        let r = prepared.programs.apply(
            &scene,
            &prepared.bevel,
            &ray,
            &hit,
            &mut shade,
            &scene.materials[0],
            &Footprint::NONE,
        );
        assert!(r.is_some());
        assert!(
            (shade.normal - want).length() < 1.0e-5,
            "{:?}",
            shade.normal
        );
        assert_eq!(shade.point, before.point);
        assert_eq!(shade.geometric, before.geometric);
    }
}

#[test]
fn a_programs_opacity_cuts_out_for_the_camera_and_the_shadow_rays() {
    // Black, opaque where u > 0.5 (the right half), cut out on the left: the camera sees white
    // through the left and black on the right; shadow rays pass the left half only.
    let mut b = Builder::new();
    let u = b.f(op::VX, UV0, NONE, NONE, NONE);
    let half = b.fconst(0.5);
    let opaque = b.f(op::FLT, half, u, NONE, NONE);
    b.out(OUT_OPACITY, opaque, false);
    b.out_const(OUT_BASE_COLOR, &[0.0, 0.0, 0.0]);
    b.out_const(OUT_ROUGHNESS, &[1.0]);
    b.out_const(OUT_IOR, &[1.0]);
    let scene = scene_of(
        square(100.0),
        matte(0.0),
        Some(b.build()),
        Transform::IDENTITY,
    );
    let film = render(&scene, 4);
    assert!(
        (pixel(&film, 3, 8).g - 1.0).abs() < 1.0e-4,
        "{:?}",
        pixel(&film, 3, 8)
    );
    assert!(pixel(&film, 12, 8).g < 1.0e-4, "{:?}", pixel(&film, 12, 8));
    let prepared = Prepared::new(&scene);
    let tracer = crate::integrator::BvhTracer {
        geometry: &scene.geometry,
        isa: Isa::detect(),
    };
    let through = |x: f32| {
        let ray = Ray::new(Vec3::new(x, 50.0, 0.0), Vec3::new(0.0, -1.0, 0.0));
        prepared.shadow_for_tests(&scene, &tracer, &ray).is_some()
    };
    assert!(through(-50.0), "the cut half lets the shadow ray pass");
    assert!(!through(50.0), "the opaque half blocks it");
    // Without the program the square is opaque and black.
    let mut plain = scene.clone();
    plain.programs.clear();
    assert!(pixel(&render(&plain, 4), 3, 8).g < 1.0e-4);
}

#[test]
fn emission_adds_to_a_surface_and_an_emitter_whose_program_varies_is_no_light() {
    // A black matte surface whose program emits red at strength 2: the camera sees 2 in red.
    let mut b = Builder::new();
    b.out_const(OUT_EMISSION, &[1.0, 0.0, 0.0]);
    b.out_const(OUT_EMISSION_STRENGTH, &[2.0]);
    b.out_const(OUT_BASE_COLOR, &[0.0, 0.0, 0.0]);
    let mut scene = scene_of(
        square(100.0),
        matte(0.0),
        Some(b.build()),
        Transform::IDENTITY,
    );
    scene.environment.horizon = 0.0;
    let p = pixel(&render(&scene, 4), 8, 8);
    assert!((p.r - 2.0).abs() < 1.0e-4 && p.g < 1.0e-4, "{p:?}");
    // An emitter with a constant program emission is a light (its file's radiance); with a
    // checker of two colours it is not (found by the rays that hit it), and it shows both.
    let emitter = Material {
        kind: MATERIAL_EMISSIVE,
        emission: Rgb::WHITE,
        emission_power: 1.0,
        flags: MATERIAL_FLAG_LIGHT,
        ..Material::default()
    };
    let mut constant = Builder::new();
    constant.out_const(OUT_EMISSION, &[1.0, 1.0, 1.0]);
    let lit = scene_of(
        square(100.0),
        emitter.clone(),
        Some(constant.build()),
        Transform::IDENTITY,
    );
    assert!(Prepared::new(&lit).lights().is_mesh_light(0));
    let mut b = Builder::new();
    let two = b.fconst(2.0);
    let chk = b.f(op::CHECK, UV0, two, NONE, NONE);
    let red = b.vconst([1.0, 0.0, 0.0]);
    let blue = b.vconst([0.0, 0.0, 1.0]);
    let c = b.v(op::VLERP, red, blue, chk, NONE);
    b.out(OUT_EMISSION, c, true);
    b.out_const(OUT_EMISSION_STRENGTH, &[3.0]);
    let varied = scene_of(square(100.0), emitter, Some(b.build()), Transform::IDENTITY);
    assert!(!Prepared::new(&varied).lights().is_mesh_light(0));
    assert!(shade::emission_varies(&varied, 0));
    let film = render(&varied, 1);
    // Bottom left quarter red (u, v < 0.5: cell 0), bottom right blue.
    let (bl, br) = (pixel(&film, 3, 12), pixel(&film, 12, 12));
    assert!((bl.r - 3.0).abs() < 1.0e-4 && bl.b < 1.0e-4, "{bl:?}");
    assert!((br.b - 3.0).abs() < 1.0e-4 && br.r < 1.0e-4, "{br:?}");
}

/// A cube of `half` mm with sharp edges and outward normals per face, centred at the origin.
fn cube(half: f32) -> Mesh {
    crate::example::split_box(Vec3::splat(-half), Vec3::splat(half), &[0, 1, 2, 3, 4, 5])
}

#[test]
fn the_bevel_weight_scales_the_materials_radius() {
    // A cube with a 12 mm bevel seen from a corner: a program with the material's own values and
    // a bevel weight of 0 draws the sharp cube, of 1 the bevelled one, bit for bit; a weight
    // computed at each point (a constant clamped: 1) draws the bevelled one too, and a constant
    // of 0.5 something in between.
    let base = Material {
        base_color: Rgb::splat(0.6),
        roughness: 0.3,
        bevel_mm: 12.0,
        ..Material::default()
    };
    let same = |weight: Option<f32>, computed: bool| -> Program {
        let mut b = Builder::new();
        b.out_const(OUT_BASE_COLOR, &[0.6, 0.6, 0.6]);
        b.out_const(OUT_ROUGHNESS, &[0.3]);
        b.out_const(OUT_COAT_ROUGHNESS, &[0.0]);
        match (weight, computed) {
            (Some(w), false) => b.out_const(OUT_BEVEL, &[w]),
            (Some(w), true) => {
                let x = b.fconst(w * 3.0);
                let c = b.f(op::FCLAMP, x, NONE, NONE, NONE);
                b.out(OUT_BEVEL, c, false);
            }
            (None, _) => {}
        }
        b.build()
    };
    let at = |m: Material, p: Option<Program>| -> Film {
        let mut s = scene_of(cube(40.0), m, p, Transform::IDENTITY);
        s.camera = Camera {
            position: Vec3::new(300.0, -400.0, 300.0),
            target: Vec3::ZERO,
            up: Vec3::new(0.0, 0.0, 1.0),
            focal_mm: 80.0,
            ..Camera::default()
        };
        s.render.width = 24;
        s.render.height = 24;
        render(&s, 2)
    };
    let sharp = at(
        Material {
            bevel_mm: 0.0,
            ..base.clone()
        },
        None,
    );
    let rounded = at(base.clone(), None);
    assert_ne!(sharp, rounded);
    assert_eq!(at(base.clone(), Some(same(Some(0.0), false))), sharp);
    assert_eq!(at(base.clone(), Some(same(Some(1.0), false))), rounded);
    assert_eq!(at(base.clone(), Some(same(None, false))), rounded);
    assert_eq!(at(base.clone(), Some(same(Some(1.0), true))), rounded);
    let halfway = at(base.clone(), Some(same(Some(0.5), false)));
    assert!(halfway != sharp && halfway != rounded);
}

#[test]
fn the_curvature_is_read_at_the_sharp_edges() {
    // A cube: its convexity is near 1 next to an edge and 0 in the middle of a face; its
    // concavity 0. The inside of a fold (two squares meeting at a right angle, seen from the
    // inside): concave next to the fold.
    let scene = scene_of(cube(40.0), matte(0.5), None, Transform::IDENTITY);
    let bevel = BevelSetup::new(&scene);
    let at = |scene: &Scene, from: Vec3, dir: Vec3, r: f32| {
        let ray = Ray::new(from, dir);
        let hit = scene.geometry.intersect(&ray).expect("hit");
        bevel.curvature(scene, &hit, r)
    };
    let (edge, cavity) = at(
        &scene,
        Vec3::new(39.5, -500.0, 0.0),
        Vec3::new(0.0, 1.0, 0.0),
        4.0,
    );
    assert!(edge > 0.95 && cavity == 0.0, "{edge} {cavity}");
    let (edge, _) = at(
        &scene,
        Vec3::new(37.0, -500.0, 0.0),
        Vec3::new(0.0, 1.0, 0.0),
        4.0,
    );
    assert!(edge > 0.0 && edge < 0.6, "{edge}");
    assert_eq!(
        at(
            &scene,
            Vec3::new(0.0, -500.0, 0.0),
            Vec3::new(0.0, 1.0, 0.0),
            4.0
        ),
        (0.0, 0.0)
    );
    // The fold: the floor z = 0 (x 0..50) and the wall x = 0 (z 0..50), both facing the inside.
    let fold = {
        let p = [
            Vec3::new(0.0, -50.0, 0.0),
            Vec3::new(50.0, -50.0, 0.0),
            Vec3::new(50.0, 50.0, 0.0),
            Vec3::new(0.0, 50.0, 0.0),
            Vec3::new(0.0, -50.0, 50.0),
            Vec3::new(0.0, 50.0, 50.0),
        ];
        Mesh::new(&p, &[], &[0, 1, 2, 0, 2, 3, 0, 3, 5, 0, 5, 4], 0).expect("fold")
    };
    let scene = scene_of(fold, matte(0.5), None, Transform::IDENTITY);
    let bevel = BevelSetup::new(&scene);
    let ray = Ray::new(Vec3::new(1.0, 0.0, 300.0), Vec3::new(0.0, 0.0, -1.0));
    let hit = scene.geometry.intersect(&ray).expect("hit");
    let (edge, cavity) = bevel.curvature(&scene, &hit, 4.0);
    assert!(cavity > 0.5 && edge == 0.0, "{edge} {cavity}");
}

/// A host with a footprint (part space) and no curvature.
struct Wide(LodFootprint);

impl Host for Wide {
    fn footprint(&self) -> Option<&LodFootprint> {
        Some(&self.0)
    }
    fn edge(&mut self, _radius: f32) -> f32 {
        0.0
    }
    fn cavity(&mut self, _radius: f32) -> f32 {
        0.0
    }
}

#[test]
fn image_reads_are_filtered_over_the_footprint_and_a_bump_reads_one_level() {
    // A 64 × 64 checker of 1-texel cells (sRGB black and white), read through a MAP of the UV
    // projection: with a footprint of many texels the read is the mean (the last levels), on
    // level 0 a cell. A read whose coordinates are computed otherwise is on level 0. Two reads
    // through the same mapping, the second at a step along T (a bump's), take the same level.
    let px: Vec<u8> = (0..64u32)
        .flat_map(|y| (0..64u32).flat_map(move |x| [if (x + y) % 2 == 0 { 0u8 } else { 255 }; 3]))
        .collect();
    let image = Arc::new(TextureImage::new(64, 64, 3, COLOR_SRGB, px).expect("image"));
    let mut b = Builder::new();
    let entry = b.image(Some(0), true, 0);
    let m = b.map(0.0, 2.0, 100.0, 0.0, [1.0, 1.0], [0.0, 0.0]);
    let (filtered, _) = b.tex(entry, m);
    let step = b.fconst(0.01);
    let t = b.v(op::VSCALE, super::build::T, step, NONE, NONE);
    let p2 = b.v(op::VADD, P, t, NONE, NONE);
    let duv = b.v(op::VSCALE, 7, step, NONE, NONE);
    let uv2 = b.v(op::VADD, UV0, duv, NONE, NONE);
    let k = b.konst(&[0.0, 2.0, 100.0, 1.0, 0.0, 1.0, 1.0, 0.0, 0.0]);
    let m2 = b.v(op::MAP, p2, super::build::N, uv2, k);
    let (stepped, _) = b.tex(entry, m2);
    let one = b.fconst(1.0);
    let computed = b.v(op::VSCALE, UV0, one, NONE, NONE);
    let (raw, _) = b.tex(entry, computed);
    b.out(OUT_BASE_COLOR, filtered, true);
    b.out(OUT_EMISSION, stepped, true);
    b.out(OUT_NORMAL, raw, true);
    // The map's constants equal its first's (as the compiler shares them): make them one entry.
    let mut program = b.build();
    let first_k = program
        .code
        .iter()
        .find(|i| i.op == op::MAP)
        .expect("map")
        .k;
    for i in program.code.iter_mut().filter(|i| i.op == op::MAP) {
        i.k = first_k;
    }
    let runner = Runner::new(program, vec![Some(image)]);
    let ctx = Context {
        p: [0.0; 3],
        n: [0.0, -1.0, 0.0],
        // The centre of texel (32, 32) (black).
        uv0: [32.5 / 64.0, 32.5 / 64.0, 0.0],
        uv1: [0.5, 0.5, 0.0],
        i: [0.0, -1.0, 0.0],
        t: [1.0, 0.0, 0.0],
        b: [0.0, 0.0, 1.0],
        duv_t: [0.01, 0.0, 0.0],
        duv_b: [0.0, 0.01, 0.0],
    };
    let wide = LodFootprint {
        dx: [4.0, 0.0, 0.0],
        dy: [0.0, 0.0, 4.0],
        duv: [[[0.5, 0.0], [0.0, 0.5]]; 2],
    };
    let mut out = Outputs::default();
    runner.run(&ctx, &mut Wide(wide), &mut out);
    let (f, s, r) = (
        out.vec(OUT_BASE_COLOR),
        out.vec(OUT_EMISSION),
        out.vec(OUT_NORMAL),
    );
    assert!((f[0] - 0.5).abs() < 0.05, "filtered {f:?}");
    assert!(
        (s[0] - f[0]).abs() < 1.0e-3,
        "the bump's step on the same level: {s:?} {f:?}"
    );
    assert!(
        r[0] < 0.05 || r[0] > 0.95,
        "computed coordinates on level 0: {r:?}"
    );
    // Without a footprint, every read is level 0.
    runner.run(&ctx, &mut interp::NoHost, &mut out);
    let f0 = out.vec(OUT_BASE_COLOR);
    assert!(f0[0] < 0.05 || f0[0] > 0.95, "{f0:?}");
}

// ---------------------------------------------------------------------------- the RSB

fn section_tags(bytes: &[u8]) -> Vec<[u8; 4]> {
    let mut out = Vec::new();
    let mut pos = 8;
    while pos + 8 <= bytes.len() {
        out.push([bytes[pos], bytes[pos + 1], bytes[pos + 2], bytes[pos + 3]]);
        let len = u32::from_le_bytes([
            bytes[pos + 4],
            bytes[pos + 5],
            bytes[pos + 6],
            bytes[pos + 7],
        ]) as usize;
        pos += 8 + len;
    }
    out
}

/// `bytes` with every section of `tag` replaced by `f` (dropped by `None`).
fn edit(bytes: &[u8], tag: [u8; 4], mut f: impl FnMut(&[u8]) -> Option<Vec<u8>>) -> Vec<u8> {
    let mut out = bytes[..8].to_vec();
    let mut pos = 8;
    while pos + 8 <= bytes.len() {
        let t = [bytes[pos], bytes[pos + 1], bytes[pos + 2], bytes[pos + 3]];
        let len = u32::from_le_bytes([
            bytes[pos + 4],
            bytes[pos + 5],
            bytes[pos + 6],
            bytes[pos + 7],
        ]) as usize;
        let payload = &bytes[pos + 8..pos + 8 + len];
        let kept = if t == tag {
            f(payload)
        } else {
            Some(payload.to_vec())
        };
        if let Some(p) = kept {
            out.extend_from_slice(&t);
            out.extend_from_slice(&(p.len() as u32).to_le_bytes());
            out.extend_from_slice(&p);
        }
        pos += 8 + len;
    }
    out
}

#[test]
fn programs_travel_in_prog_and_files_without_them_read_and_write_as_before() {
    let scene = crate::example::m3b_scene();
    let bytes = scene.to_rsb();
    let tags = section_tags(&bytes);
    // One PROG per material, last in the file.
    let first = tags.iter().position(|t| t == b"PROG").expect("PROG");
    assert!(tags[first..].iter().all(|t| t == b"PROG"));
    assert_eq!(tags.len() - first, scene.materials.len());
    assert_eq!(Scene::from_rsb(&bytes).as_ref(), Ok(&scene));
    // A reader of before M3b skips PROG: the same scene without its programs.
    let old = edit(&bytes, *b"PROG", |_| None);
    let without = Scene::from_rsb(&old).expect("valid");
    assert!(without.programs.is_empty());
    let mut expected = scene.clone();
    expected.programs.clear();
    // The meshes kept their UVs in the file: the flag says so.
    expected.textured = without.textured;
    assert_eq!(without, expected);
    // A scene without programs writes no PROG (and the M2b scene its bytes of before).
    let m2b = crate::example::m2b_scene().to_rsb();
    assert!(!section_tags(&m2b).contains(b"PROG"));
    // A program of another version is a newer file's: skipped.
    let newer = edit(&bytes, *b"PROG", |p| {
        let mut p = p.to_vec();
        p[8] = 2;
        Some(p)
    });
    let s = Scene::from_rsb(&newer).expect("valid");
    assert!(s.programs.iter().all(Option::is_none));
    // A material that is not there, a bad program, a program that is not a material's, an image
    // that is not in IMGS or not of its colour space: errors.
    let invalid = |bytes: &[u8]| {
        matches!(
            Scene::from_rsb(bytes),
            Err(RsbError::Invalid { tag, .. }) if tag == *b"PROG"
        )
    };
    let mut first_only = true;
    let past = edit(&bytes, *b"PROG", |p| {
        let mut p = p.to_vec();
        if first_only {
            p[0..4].copy_from_slice(&99u32.to_le_bytes());
            first_only = false;
        }
        Some(p)
    });
    assert!(invalid(&past));
    let unknown = edit(&bytes, *b"PROG", |p| {
        let mut p = p.to_vec();
        let code = 4 + 40;
        p[code..code + 4].copy_from_slice(&777u32.to_le_bytes());
        Some(p)
    });
    assert!(invalid(&unknown));
    let mut fourteen = scene.clone();
    let mut p = Program::clone(fourteen.programs[0].as_ref().expect("floor"));
    p.outputs.pop();
    fourteen.programs[0] = Some(Arc::new(p));
    assert!(invalid(&fourteen.to_rsb()));
    let mut no_image = scene.clone();
    no_image.images.truncate(2);
    assert!(invalid(&no_image.to_rsb()));
    let mut wrong_space = scene.clone();
    let mut bottle = Program::clone(wrong_space.programs[3].as_ref().expect("bottle"));
    bottle.images[0].srgb = false;
    wrong_space.programs[3] = Some(Arc::new(bottle));
    assert!(invalid(&wrong_space.to_rsb()));
    // Updates: without MESH and IMGS the images stay and the programs read them; with MESH and
    // without IMGS a program's image is not there: an error, the scene unchanged.
    let mut loaded = Scene::from_rsb(&bytes).expect("valid");
    let update = edit(&edit(&bytes, *b"MESH", |_| None), *b"IMGS", |_| None);
    loaded.update_from_rsb(&update).expect("update");
    assert_eq!(loaded.programs, scene.programs);
    assert_eq!(loaded.images, scene.images);
    let no_images = edit(&bytes, *b"IMGS", |_| None);
    assert!(loaded.update_from_rsb(&no_images).is_err());
    assert_eq!(loaded.programs, scene.programs);
}

#[test]
fn a_material_with_a_program_draws_no_pattern_and_programs_change_nothing_else() {
    // A wood pattern and a program for the same material: the program draws.
    let mut scene = scene_of(square(100.0), matte(0.5), None, Transform::IDENTITY);
    scene.patterns = crate::example::e6_patterns_scene().patterns;
    for p in &mut scene.patterns {
        p.material = 0;
    }
    assert!(!crate::pattern::PatternSetup::new(&scene).is_empty());
    scene.programs = vec![Some(Arc::new(Builder::new().build()))];
    assert!(crate::pattern::PatternSetup::new(&scene).is_empty());
    // A list of no programs is no program: the same picture as none.
    let mut a = scene_of(square(100.0), matte(0.3), None, Transform::IDENTITY);
    a.programs = vec![None];
    let mut b = a.clone();
    b.programs.clear();
    assert_eq!(render(&a, 2), render(&b, 2));
    // A linear image of the program's table read as sRGB is refused, an sRGB one accepted.
    let px = vec![0u8; 4 * 3];
    let mut s = scene_of(square(100.0), matte(0.3), None, Transform::IDENTITY);
    s.images = vec![Arc::new(
        TextureImage::new(2, 2, 3, COLOR_LINEAR, px).expect("image"),
    )];
    let mut prog = Builder::new();
    let e = prog.image(Some(0), true, 0);
    let (c, _) = prog.tex(e, UV0);
    prog.out(OUT_BASE_COLOR, c, true);
    s.programs = vec![Some(Arc::new(prog.build()))];
    assert!(Scene::from_rsb(&s.to_rsb()).is_err());
}
