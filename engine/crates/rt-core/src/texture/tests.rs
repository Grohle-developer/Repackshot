//! Tests of the image textures and labels (M2b): the mipmaps and the reads, the projections and
//! the labels against `src/core/textures.ts` on the shared fixture, the level of detail, the
//! tangent frame of a normal map, the cut-out and the opacity, the labels' layering, and whole
//! renders.

use super::image::{TextureImage, COLOR_LINEAR, COLOR_SRGB};
use super::mapping::{box_weights, LabelFrame, Mapping, UvAt};
use super::shade::{CameraCone, Footprint, TextureSetup, FOOTPRINT_SCALE};
use super::*;
use crate::bevel::ShadingPoint;
use crate::color::Rgb;
use crate::geometry::{Geometry, Instance, Mesh, Transform};
use crate::image::Film;
use crate::integrator::Prepared;
use crate::math::{Ray, Vec3};
use crate::render::{render_tile_prepared, TileRect};
use crate::scene::{
    Camera, EnvKind, Environment, Material, RenderSettings, Scene, BACKGROUND_COLOR,
    BACKGROUND_ENVIRONMENT, MATERIAL_EMISSIVE, MATERIAL_FLAG_LIGHT,
};
use crate::simd::Isa;
use std::sync::Arc;

// ---------------------------------------------------------------------------- helpers

/// The rows of numbers of the fixture's array `key`: `"key": [[...], ...]`.
fn fixture_rows(text: &str, key: &str) -> Vec<Vec<f64>> {
    let start = text
        .find(&format!("\"{key}\""))
        .unwrap_or_else(|| panic!("no {key}"));
    let body = &text[start..];
    let open = body.find('[').expect("[");
    let mut rows = Vec::new();
    let mut depth = 0;
    let mut row = Vec::new();
    let mut number = String::new();
    for ch in body[open..].chars() {
        match ch {
            '[' => depth += 1,
            ']' | ',' if depth == 2 => {
                if !number.trim().is_empty() {
                    row.push(number.trim().parse::<f64>().expect("a number"));
                }
                number.clear();
                if ch == ']' {
                    depth -= 1;
                    rows.push(std::mem::take(&mut row));
                }
            }
            ']' => {
                depth -= 1;
                if depth == 0 {
                    break;
                }
            }
            _ if depth == 2 => number.push(ch),
            _ => {}
        }
    }
    rows
}

const FIXTURE: &str = include_str!("../../../../../tests/fixtures/texture-mapping.json");

fn close(got: f32, want: f64, what: &str) {
    let tol = 2.0e-5 * want.abs().max(1.0);
    assert!(
        (f64::from(got) - want).abs() <= tol,
        "{what}: engine {got}, reference {want}"
    );
}

/// An image of `w × h` RGBA texels from a function of the texel (rows from the top).
fn rgba_image(w: u32, h: u32, space: u32, f: impl Fn(u32, u32) -> [u8; 4]) -> TextureImage {
    let mut data = Vec::with_capacity((w * h * 4) as usize);
    for y in 0..h {
        for x in 0..w {
            data.extend_from_slice(&f(x, y));
        }
    }
    TextureImage::new(w, h, 4, space, data).expect("valid image")
}

/// A slot reading image `image` with `projection`, of `size_mm`.
fn slot(image: u32, projection: u32, size_mm: f32) -> TextureSlot {
    TextureSlot {
        image: Some(image),
        projection,
        size_mm,
        ..TextureSlot::default()
    }
}

/// A square in the plane y = 0 facing −Y (towards a camera at −Y), `half` mm on each side of
/// the origin, with vertex normals −Y and UVs (u along +X, v along +Z, 0 to 1 over the square).
fn square(half: f32) -> Mesh {
    let p = [
        Vec3::new(-half, 0.0, -half),
        Vec3::new(half, 0.0, -half),
        Vec3::new(half, 0.0, half),
        Vec3::new(-half, 0.0, half),
    ];
    let n = [Vec3::new(0.0, -1.0, 0.0); 4];
    // Counter-clockwise seen from −Y.
    let indices = [0, 1, 2, 0, 2, 3];
    Mesh::new(&p, &n, &indices, 0)
        .expect("square")
        .with_uvs(vec![vec![[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]]])
        .expect("uvs")
}

/// Orthographic camera looking along +Y at the origin, `width` wide.
fn ortho_front(width: f32) -> Camera {
    Camera {
        position: Vec3::new(0.0, -1000.0, 0.0),
        target: Vec3::ZERO,
        up: Vec3::new(0.0, 0.0, 1.0),
        ortho: true,
        ortho_width: width,
        ..Camera::default()
    }
}

/// A scene: `mesh` with `material` and `textures`, `images`, seen by `camera` at `w × h`, in a
/// uniform world of radiance 1 (white), no floor.
fn scene_of(
    mesh: Mesh,
    material: Material,
    textures: MaterialTextures,
    images: Vec<TextureImage>,
    camera: Camera,
    (w, h): (u32, u32),
) -> Scene {
    Scene {
        camera,
        materials: vec![material],
        geometry: Geometry::from_meshes(vec![mesh]),
        environment: Environment {
            kind: EnvKind::Flat,
            horizon: 1.0,
            strength: 1.0,
            background_mode: BACKGROUND_ENVIRONMENT,
            ..Environment::default()
        },
        render: RenderSettings {
            width: w,
            height: h,
            tonemap: 0,
            ..RenderSettings::default()
        },
        images: images.into_iter().map(Arc::new).collect(),
        textures: vec![Some(textures)],
        ..Scene::default()
    }
}

/// The hit of the ray from `origin` along `dir` and its plain shading point.
fn hit_of(scene: &Scene, origin: Vec3, dir: Vec3) -> (Ray, crate::geometry::Hit, ShadingPoint) {
    let ray = Ray::new(origin, dir);
    let hit = scene.geometry.intersect(&ray).expect("a hit");
    let shade = ShadingPoint {
        point: hit.point,
        normal: hit.normal,
        geometric: hit.geometric_normal,
    };
    (ray, hit, shade)
}

/// Renders samples `0..spp` of the whole image.
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

// ---------------------------------------------------------------------------- the image

#[test]
fn mipmaps_halve_to_one_texel_averaging_in_linear() {
    // sRGB: a 4 × 2 image of black and white columns; level 1 (2 × 1) is their linear mean,
    // stored as the nearest sRGB byte (188), not the byte mean (128); level 2 is 1 × 1.
    let img = rgba_image(4, 2, COLOR_SRGB, |x, _| {
        let v = if x % 2 == 0 { 0 } else { 255 };
        [v, v, v, 255]
    });
    assert_eq!(img.level_count(), 3);
    assert_eq!(img.level_size(1), Some((2, 1)));
    assert_eq!(img.level_size(2), Some((1, 1)));
    assert_eq!(img.level_size(3), None);
    let mid = img.texel(1, 0, 0);
    assert!((mid[0] - 0.5).abs() < 0.003, "{mid:?}");
    assert_eq!(mid[3], 1.0);
    // Linear data keep the byte mean.
    let data = rgba_image(4, 2, COLOR_LINEAR, |x, _| {
        let v = if x % 2 == 0 { 0 } else { 255 };
        [v, v, v, v]
    });
    let m = data.texel(1, 1, 0);
    assert!((m[0] - 128.0 / 255.0).abs() < 1.0e-6 && (m[3] - 128.0 / 255.0).abs() < 1.0e-6);
    // An odd side: 5 × 1 grey ramp to 2 × 1, each texel 2.5 source texels (the middle one halved
    // between them).
    let ramp = TextureImage::new(5, 1, 1, COLOR_LINEAR, vec![0, 50, 100, 150, 200]).expect("ramp");
    assert_eq!(ramp.level_size(1), Some((2, 1)));
    let left = ramp.texel(1, 0, 0)[0] * 255.0;
    let right = ramp.texel(1, 1, 0)[0] * 255.0;
    // (0 + 50 + 0.5·100) / 2.5 = 40 and (0.5·100 + 150 + 200) / 2.5 = 160.
    assert!(
        (left - 40.0).abs() <= 0.5 && (right - 160.0).abs() <= 0.5,
        "{left} {right}"
    );
    assert_eq!(ramp.level_count(), 3);
    // Bad images are refused.
    assert!(TextureImage::new(2, 2, 2, COLOR_LINEAR, vec![0; 8]).is_err());
    assert!(TextureImage::new(2, 2, 3, COLOR_LINEAR, vec![0; 11]).is_err());
    assert!(TextureImage::new(0, 2, 1, COLOR_LINEAR, vec![]).is_err());
    assert!(TextureImage::new(1, 1, 1, 2, vec![0]).is_err());
}

#[test]
fn reads_follow_the_tex_contract_v_up_and_the_wraps() {
    // 2 × 2: top row red, green; bottom row blue, white (rows from the top).
    let img = rgba_image(2, 2, COLOR_LINEAR, |x, y| match (x, y) {
        (0, 0) => [255, 0, 0, 255],
        (1, 0) => [0, 255, 0, 255],
        (0, 1) => [0, 0, 255, 255],
        _ => [255, 255, 255, 255],
    });
    // Texel centres: v up, so the top row is v = 0.75.
    assert_eq!(
        img.bilinear(0, 0.25, 0.75, WRAP_REPEAT),
        [1.0, 0.0, 0.0, 1.0]
    );
    assert_eq!(
        img.bilinear(0, 0.75, 0.75, WRAP_REPEAT),
        [0.0, 1.0, 0.0, 1.0]
    );
    assert_eq!(
        img.bilinear(0, 0.25, 0.25, WRAP_REPEAT),
        [0.0, 0.0, 1.0, 1.0]
    );
    // The middle is the mean of the four.
    let c = img.bilinear(0, 0.5, 0.5, WRAP_REPEAT);
    assert!((c[0] - 0.5).abs() < 1.0e-6 && (c[1] - 0.5).abs() < 1.0e-6);
    // At u = 0 on the top row: repeat blends the last column in, clamp and mirror do not.
    let r = img.bilinear(0, 0.0, 0.75, WRAP_REPEAT);
    assert!(
        (r[0] - 0.5).abs() < 1.0e-6 && (r[1] - 0.5).abs() < 1.0e-6,
        "{r:?}"
    );
    assert_eq!(img.bilinear(0, 0.0, 0.75, WRAP_CLAMP), [1.0, 0.0, 0.0, 1.0]);
    assert_eq!(
        img.bilinear(0, 0.0, 0.75, WRAP_MIRROR),
        [1.0, 0.0, 0.0, 1.0]
    );
    // Past the edge: repeat starts again, clamp holds it, mirror turns back.
    assert_eq!(
        img.bilinear(0, 1.25, 0.75, WRAP_REPEAT),
        [1.0, 0.0, 0.0, 1.0]
    );
    assert_eq!(
        img.bilinear(0, 1.25, 0.75, WRAP_CLAMP),
        [0.0, 1.0, 0.0, 1.0]
    );
    assert_eq!(
        img.bilinear(0, 1.25, 0.75, WRAP_MIRROR),
        [0.0, 1.0, 0.0, 1.0]
    );
    assert_eq!(
        img.bilinear(0, 1.75, 0.75, WRAP_MIRROR),
        [1.0, 0.0, 0.0, 1.0]
    );
    // Not finite: the coordinate 0.
    assert_eq!(
        img.bilinear(0, f32::NAN, 0.75, WRAP_CLAMP),
        img.bilinear(0, 0.0, 0.75, WRAP_CLAMP)
    );
    // sRGB decodes each texel before blending: mid grey 188 is about 0.5 linear.
    let grey = TextureImage::new(1, 1, 3, COLOR_SRGB, vec![188, 188, 188]).expect("grey");
    let g = grey.bilinear(0, 0.3, 0.6, WRAP_REPEAT);
    assert!((g[0] - 0.5).abs() < 0.003 && g[3] == 1.0, "{g:?}");
    // One channel: grey in r, g and b.
    let one = TextureImage::new(1, 1, 1, COLOR_LINEAR, vec![51]).expect("one");
    assert_eq!(one.texel(0, 0, 0), [0.2, 0.2, 0.2, 1.0]);
    assert_eq!(TextureImage::channel_of([0.2, 0.4, 0.6, 0.8], 3), 0.8);
    let lum = TextureImage::channel_of([0.2, 0.4, 0.6, 0.8], CHANNEL_LUMINANCE);
    assert!((lum - (0.2 * 0.2126 + 0.4 * 0.7152 + 0.6 * 0.0722)).abs() < 1.0e-6);
}

#[test]
fn the_level_of_detail_is_the_footprint_in_texels_and_blends_two_levels() {
    let img = rgba_image(256, 128, COLOR_LINEAR, |x, y| {
        let v = if (x + y) % 2 == 0 { 0 } else { 255 };
        [v, v, v, 255]
    });
    assert_eq!(img.level_count(), 9);
    // One texel across or less: level 0.
    assert_eq!(img.lod((1.0 / 256.0, 0.0), (0.0, 1.0 / 128.0)), 0.0);
    assert_eq!(img.lod((0.1 / 256.0, 0.0), (0.0, 0.0)), 0.0);
    // Four texels along the longer axis (in v: 4 / 128): level 2.
    let l = img.lod((1.0 / 256.0, 0.0), (0.0, 4.0 / 128.0));
    assert!((l - 2.0).abs() < 1.0e-5, "{l}");
    // Diagonal: |(3, 4)| = 5 texels.
    let l = img.lod((3.0 / 256.0, 4.0 / 128.0), (0.0, 0.0));
    assert!((l - 5.0f32.log2()).abs() < 1.0e-4, "{l}");
    // Infinite: the last level; NaN: level 0.
    assert_eq!(img.lod((f32::INFINITY, 0.0), (0.0, 0.0)), 8.0);
    assert_eq!(img.lod((f32::NAN, 0.0), (0.0, 0.0)), 0.0);
    // A checker of single texels averages to grey from level 1 on; level 0 keeps it.
    let fine = img.sample(0.5 / 256.0, 1.0 - 0.5 / 128.0, 0.0, WRAP_REPEAT);
    assert!(fine[0] < 0.01, "{fine:?}");
    let coarse = img.sample(0.5 / 256.0, 1.0 - 0.5 / 128.0, 1.0, WRAP_REPEAT);
    assert!((coarse[0] - 128.0 / 255.0).abs() < 0.01, "{coarse:?}");
    // Halfway between levels 0 and 1: half of each.
    let half = img.sample(0.5 / 256.0, 1.0 - 0.5 / 128.0, 0.5, WRAP_REPEAT);
    assert!(
        (half[0] - 0.5 * (fine[0] + coarse[0])).abs() < 1.0e-5,
        "{half:?}"
    );
}

#[test]
fn the_camera_footprint_picks_the_level_a_pixel_covers() {
    // A square of 200 mm filling a 64-pixel-wide orthographic view: a 1024-texel image is
    // 1024 / 64 = 16 texels per pixel, and the footprint is FOOTPRINT_SCALE of a pixel: level
    // log2(16 · ¼) = 2.
    let img = rgba_image(1024, 1024, COLOR_LINEAR, |_, _| [128, 128, 128, 255]);
    let scene = scene_of(
        square(100.0),
        Material::default(),
        MaterialTextures {
            slots: [
                slot(0, PROJECTION_UV, 100.0),
                TextureSlot::default(),
                TextureSlot::default(),
                TextureSlot::default(),
                TextureSlot::default(),
                TextureSlot::default(),
            ],
            ..MaterialTextures::default()
        },
        vec![img],
        ortho_front(200.0),
        (64, 64),
    );
    let cone = CameraCone::new(&scene);
    let (ray, hit, _) = hit_of(
        &scene,
        Vec3::new(10.0, -1000.0, 5.0),
        Vec3::new(0.0, 1.0, 0.0),
    );
    let f = cone.footprint(ray.dir, hit.t, hit.geometric_normal);
    assert!((f.dx.length() - FOOTPRINT_SCALE * 200.0 / 64.0).abs() < 1.0e-4);
    let mapping = Mapping::new(&scene.textures[0].as_ref().unwrap().slots[0], 1.0);
    let uv = UvAt {
        uv: [[0.55, 0.525], [0.0, 0.0]],
        grad: [
            [
                Vec3::new(1.0 / 200.0, 0.0, 0.0),
                Vec3::new(0.0, 0.0, 1.0 / 200.0),
            ],
            [Vec3::ZERO; 2],
        ],
    };
    let c = mapping
        .project(hit.point, Vec3::new(0.0, -1.0, 0.0), &uv)
        .coords[0];
    let lod = scene.images[0].lod(
        (c.du.dot(f.dx), c.dv.dot(f.dx)),
        (c.du.dot(f.dy), c.dv.dot(f.dy)),
    );
    assert!((lod - 2.0).abs() < 1.0e-3, "{lod}");
    // A perspective camera: the footprint grows with the distance and leans with the surface.
    let mut far = scene.clone();
    far.camera = Camera {
        position: Vec3::new(0.0, -1000.0, 0.0),
        target: Vec3::ZERO,
        ..Camera::default()
    };
    let cone = CameraCone::new(&far);
    let dir = Vec3::new(0.0, 1.0, 0.0);
    let near = cone.footprint(dir, 500.0, Vec3::new(0.0, -1.0, 0.0));
    let twice = cone.footprint(dir, 1000.0, Vec3::new(0.0, -1.0, 0.0));
    assert!((twice.dx.length() / near.dx.length() - 2.0).abs() < 1.0e-4);
    // 36 mm over 64 pixels at 50 mm, at 1000 mm, a quarter of it.
    let expected = FOOTPRINT_SCALE * 1000.0 * (36.0 / 64.0) / 50.0;
    assert!((twice.dx.length() - expected).abs() < 1.0e-3 * expected);
    let tilted = cone.footprint(dir, 1000.0, Vec3::new(0.0, -0.5, 0.866_025_4));
    assert!((tilted.dy.length() / twice.dy.length() - 2.0).abs() < 1.0e-3);
    // The path's cone: its width across, stretched by 1/|cos| along the lean.
    let c = Footprint::cone(dir, 2.0, Vec3::new(0.0, -0.5, 0.866_025_4));
    assert!((c.dx.length() - 4.0).abs() < 1.0e-4 && (c.dy.length() - 2.0).abs() < 1.0e-5);
    assert_eq!(Footprint::cone(dir, 0.0, dir), Footprint::NONE);
}

// ---------------------------------------------------------------------------- the projections

#[test]
fn the_projections_match_core_textures_at_the_fixture_points() {
    let cases = fixture_rows(FIXTURE, "cases");
    assert!(cases.len() >= 270, "{} cases", cases.len());
    for row in &cases {
        let f = |i: usize| row[i] as f32;
        let s = TextureSlot {
            image: Some(0),
            projection: row[0] as u32,
            axis: row[1] as u32,
            size_mm: f(2),
            rotation_deg: f(3),
            offset: [f(4), f(5)],
            repeat: [f(6), f(7)],
            ..TextureSlot::default()
        };
        let m = Mapping::new(&s, f(8));
        let p = Vec3::new(f(9), f(10), f(11));
        let n = Vec3::new(f(12), f(13), f(14));
        let uv = UvAt {
            uv: [[f(15), f(16)], [0.0, 0.0]],
            grad: [[Vec3::ZERO; 2]; 2],
        };
        let got = m.project(p, n, &uv);
        let want = if s.projection == PROJECTION_BOX { 3 } else { 1 };
        assert_eq!(got.count, want, "{row:?}");
        for (k, c) in got.used().iter().enumerate() {
            let what = format!("case {row:?}, coordinate {k}");
            close(c.u, row[17 + 3 * k], &what);
            close(c.v, row[18 + 3 * k], &what);
            close(c.weight, row[19 + 3 * k], &what);
        }
    }
}

#[test]
fn the_labels_match_core_textures_at_the_fixture_points() {
    let cases = fixture_rows(FIXTURE, "labelCases");
    assert!(cases.len() >= 40, "{} cases", cases.len());
    for row in &cases {
        let f = |i: usize| row[i] as f32;
        let v3 = |i: usize| Vec3::new(f(i), f(i + 1), f(i + 2));
        let label = Label {
            image: Some(0),
            origin: v3(0),
            u: v3(3),
            v: v3(6),
            normal: v3(9),
            width_mm: f(12),
            height_mm: f(13),
            depth_mm: f(14),
            roughness: 0.6,
            coat: 0.0,
            relief: 0.3,
        };
        let frame = LabelFrame::new(&label);
        let (p, n) = (v3(15), v3(18));
        let (s, t) = frame.coords(p);
        let covered = frame.covers(p, n, s, t);
        assert_eq!(covered, row[21] == 1.0, "{row:?}");
        if covered {
            close(s, row[22], "s");
            close(t, row[23], "t");
        }
    }
}

#[test]
fn the_gradients_are_those_of_the_coordinates() {
    // Finite differences of every projection's coordinates along two tangents agree with the
    // gradients it gives (the frame of a normal map and the level of detail use them).
    let p = Vec3::new(23.0, -41.0, 17.0);
    let n = Vec3::new(0.3, -0.9, 0.31).normalize();
    let frame = crate::math::Frame::from_normal(n);
    for projection in [
        PROJECTION_BOX,
        PROJECTION_PLANAR,
        PROJECTION_CYLINDRICAL,
        PROJECTION_SPHERICAL,
    ] {
        for axis in [AXIS_X, AXIS_Y, AXIS_Z] {
            let s = TextureSlot {
                image: Some(0),
                projection,
                axis,
                size_mm: 60.0,
                rotation_deg: 25.0,
                repeat: [1.5, 0.75],
                ..TextureSlot::default()
            };
            let m = Mapping::new(&s, 1.25);
            let at = m.project(p, n, &UvAt::default());
            for t in [frame.x, frame.y] {
                let h = 1.0e-2;
                let ahead = m.project(p + t * h, n, &UvAt::default());
                let behind = m.project(p - t * h, n, &UvAt::default());
                for k in 0..at.count {
                    let du = (ahead.coords[k].u - behind.coords[k].u) / (2.0 * h);
                    let dv = (ahead.coords[k].v - behind.coords[k].v) / (2.0 * h);
                    let c = at.coords[k];
                    assert!(
                        (du - c.du.dot(t)).abs() < 2.0e-3 && (dv - c.dv.dot(t)).abs() < 2.0e-3,
                        "projection {projection} axis {axis}: {du} {dv} vs {} {}",
                        c.du.dot(t),
                        c.dv.dot(t)
                    );
                }
            }
        }
    }
    // Box weights: |n|⁴, a face square to an axis takes it alone.
    assert_eq!(box_weights(Vec3::new(0.0, 0.0, -1.0)), [0.0, 0.0, 1.0]);
    let w = box_weights(Vec3::new(1.0, 1.0, 0.0).normalize());
    assert!((w[0] - 0.5).abs() < 1.0e-6 && (w[1] - 0.5).abs() < 1.0e-6 && w[2] == 0.0);
}

// ---------------------------------------------------------------------------- shading

/// A 1 × 1 image of one RGBA texel (linear data).
fn texel(c: [u8; 4]) -> TextureImage {
    TextureImage::new(1, 1, 4, COLOR_LINEAR, c.to_vec()).expect("texel")
}

fn textures_with(slots: &[(usize, TextureSlot)]) -> MaterialTextures {
    let mut t = MaterialTextures::default();
    for &(k, s) in slots {
        t.slots[k] = s;
    }
    t
}

#[test]
fn a_normal_map_bends_the_normal_in_the_frame_of_the_coordinates() {
    // A texel that tilts the normal along +u (m = (sin 30°, 0, cos 30°)): with UVs, u runs along
    // +X on the square, so the normal leans to +X; with the UVs turned (u along +Z), to +Z; a
    // planar projection along Y gives the same frame as the first; strength 0 keeps it.
    let m = [
        ((0.5f32 * 0.5 + 0.5) * 255.0).round() as u8,
        128,
        ((0.866_025_4f32 * 0.5 + 0.5) * 255.0).round() as u8,
        255,
    ];
    let normal_scene = |s: TextureSlot, mesh: Mesh| {
        scene_of(
            mesh,
            Material::default(),
            textures_with(&[(SLOT_NORMAL, s)]),
            vec![texel(m)],
            ortho_front(200.0),
            (8, 8),
        )
    };
    let bent = |scene: &Scene| {
        let setup = TextureSetup::new(scene);
        let (ray, hit, mut shade) = hit_of(
            scene,
            Vec3::new(3.0, -1000.0, 4.0),
            Vec3::new(0.0, 1.0, 0.0),
        );
        let base = scene.materials[0].clone();
        setup
            .apply(scene, &ray, &hit, &mut shade, &base, &Footprint::NONE)
            .expect("textured");
        shade.normal
    };
    let n = bent(&normal_scene(slot(0, PROJECTION_UV, 100.0), square(100.0)));
    assert!(n.x > 0.45 && n.y < -0.8 && n.z.abs() < 0.02, "{n:?}");
    // UVs turned a quarter: u grows along +Z.
    let turned = square(100.0)
        .with_uvs(vec![vec![[0.0, 1.0], [0.0, 0.0], [1.0, 0.0], [1.0, 1.0]]])
        .expect("uvs");
    let n2 = bent(&normal_scene(slot(0, PROJECTION_UV, 100.0), turned));
    assert!(n2.z > 0.45 && n2.x.abs() < 0.02, "{n2:?}");
    // Planar along Y: (x, z) is (u, v).
    let planar = TextureSlot {
        axis: AXIS_Y,
        ..slot(0, PROJECTION_PLANAR, 100.0)
    };
    let n3 = bent(&normal_scene(planar, square(100.0)));
    assert!((n3 - n).length() < 1.0e-3, "{n3:?} vs {n:?}");
    // A box projection on a face square to Y: its Y axis, (x, z) seen from the front.
    let n4 = bent(&normal_scene(slot(0, PROJECTION_BOX, 100.0), square(100.0)));
    assert!((n4 - n).length() < 1.0e-3, "{n4:?} vs {n:?}");
    let flat = TextureSlot {
        strength: 0.0,
        ..slot(0, PROJECTION_UV, 100.0)
    };
    let n5 = bent(&normal_scene(flat, square(100.0)));
    assert!((n5 - Vec3::new(0.0, -1.0, 0.0)).length() < 1.0e-5, "{n5:?}");
}

#[test]
fn a_height_map_bumps_the_normal_up_its_slope() {
    // A ramp rising along u (to the right): the normal leans back against the slope (−X).
    let ramp = rgba_image(64, 1, COLOR_LINEAR, |x, _| {
        let v = (x * 4) as u8;
        [v, v, v, 255]
    });
    let s = TextureSlot {
        flags: SLOT_FLAG_HEIGHT,
        strength: 20.0,
        wrap: WRAP_CLAMP,
        ..slot(0, PROJECTION_UV, 100.0)
    };
    let scene = scene_of(
        square(100.0),
        Material::default(),
        textures_with(&[(SLOT_NORMAL, s)]),
        vec![ramp],
        ortho_front(200.0),
        (8, 8),
    );
    let setup = TextureSetup::new(&scene);
    let (ray, hit, mut shade) = hit_of(
        &scene,
        Vec3::new(3.0, -1000.0, 4.0),
        Vec3::new(0.0, 1.0, 0.0),
    );
    let base = scene.materials[0].clone();
    setup
        .apply(&scene, &ray, &hit, &mut shade, &base, &Footprint::NONE)
        .expect("textured");
    // Slope: 20 mm × 252/255 over 200 mm, about 0.099: tan of the lean.
    let n = shade.normal;
    assert!(n.x < -0.08 && n.x > -0.12 && n.z.abs() < 1.0e-3, "{n:?}");
}

#[test]
fn colour_roughness_metal_alpha_and_emission_multiply_and_add() {
    let base = Material {
        base_color: Rgb::new(0.5, 0.8, 1.0),
        roughness: 0.6,
        metallic: 0.5,
        opacity: 0.9,
        ..Material::default()
    };
    // Linear texels: colour (0.4, 0.6, 0.2), roughness in G (0.5), metal in B inverted (1 − 0.8),
    // alpha 0.6 coverage, emission (1, 0.5, 0) × 2 × tint (1, 1, 0.5).
    let colour = TextureImage::new(1, 1, 3, COLOR_LINEAR, vec![102, 153, 51]).expect("c");
    let rm = TextureImage::new(1, 1, 3, COLOR_LINEAR, vec![0, 128, 204]).expect("rm");
    let alpha = TextureImage::new(1, 1, 4, COLOR_LINEAR, vec![0, 0, 0, 153]).expect("a");
    let glow = TextureImage::new(1, 1, 3, COLOR_LINEAR, vec![255, 128, 0]).expect("e");
    let mut t = textures_with(&[
        (SLOT_COLOR, slot(0, PROJECTION_UV, 100.0)),
        (
            SLOT_ROUGHNESS,
            TextureSlot {
                channel: 1,
                ..slot(1, PROJECTION_UV, 100.0)
            },
        ),
        (
            SLOT_METAL,
            TextureSlot {
                channel: 2,
                flags: SLOT_FLAG_INVERT,
                ..slot(1, PROJECTION_UV, 100.0)
            },
        ),
        (
            SLOT_ALPHA,
            TextureSlot {
                channel: 3,
                ..slot(2, PROJECTION_UV, 100.0)
            },
        ),
        (
            SLOT_EMISSION,
            TextureSlot {
                strength: 2.0,
                ..slot(3, PROJECTION_UV, 100.0)
            },
        ),
    ]);
    t.emission_tint = Rgb::new(1.0, 1.0, 0.5);
    let scene = scene_of(
        square(100.0),
        base.clone(),
        t,
        vec![colour, rm, alpha, glow],
        ortho_front(200.0),
        (8, 8),
    );
    let setup = TextureSetup::new(&scene);
    let (ray, hit, mut shade) = hit_of(
        &scene,
        Vec3::new(3.0, -1000.0, 4.0),
        Vec3::new(0.0, 1.0, 0.0),
    );
    let out = setup
        .apply(&scene, &ray, &hit, &mut shade, &base, &Footprint::NONE)
        .expect("textured");
    let m = &out.material;
    let near = |a: f32, b: f32| (a - b).abs() < 1.0e-5;
    assert!(near(m.base_color.r, 0.5 * 0.4) && near(m.base_color.g, 0.8 * 0.6));
    assert!(near(m.base_color.b, 1.0 * 0.2));
    assert!(near(m.roughness, 0.6 * 128.0 / 255.0), "{}", m.roughness);
    assert!(
        near(m.metallic, 0.5 * (1.0 - 204.0 / 255.0)),
        "{}",
        m.metallic
    );
    assert!(near(m.opacity, 0.9 * 0.6), "{}", m.opacity);
    assert!(near(out.emission.r, 2.0) && near(out.emission.g, 128.0 / 255.0 * 2.0));
    assert!(near(out.emission.b, 0.0));
    // The shading normal is not touched without a normal slot or labels.
    assert_eq!(shade.normal, hit.normal);
    // An emitter: the colour tints its radiance instead, the emission image adds to it.
    let mut lamp = scene.clone();
    lamp.materials[0] = Material {
        kind: MATERIAL_EMISSIVE,
        emission: Rgb::new(1.0, 1.0, 1.0),
        emission_power: 3.0,
        ..Material::default()
    };
    let setup = TextureSetup::new(&lamp);
    let out = setup
        .apply(
            &lamp,
            &ray,
            &hit,
            &mut shade,
            &lamp.materials[0],
            &Footprint::NONE,
        )
        .expect("textured");
    assert!(near(out.emission.r, 3.0 * 0.4 + 2.0), "{:?}", out.emission);
    assert!(near(out.emission.b, 3.0 * 0.2), "{:?}", out.emission);
    // And it is not sampled as a light by its flux any more.
    lamp.materials[0].flags = MATERIAL_FLAG_LIGHT;
    assert!(shade::emission_varies(&lamp, 0));
    let prepared = Prepared::new(&lamp);
    assert!(!prepared.lights().is_mesh_light(0));
    let mut plain = lamp.clone();
    plain.textures.clear();
    assert!(Prepared::new(&plain).lights().is_mesh_light(0));
}

#[test]
fn an_alpha_cut_out_and_a_coverage_let_the_view_and_the_shadows_through() {
    // A square in front of a white world, black, its left half cut out by an alpha image
    // (alpha 0 on the left, 255 on the right; a cut-out at 0.5): the camera sees white through
    // the left and black on the right. As a coverage of 0.25 everywhere, a quarter of black.
    let black = Material {
        base_color: Rgb::BLACK,
        roughness: 1.0,
        ior: 1.0,
        ..Material::default()
    };
    let halves = rgba_image(2, 1, COLOR_LINEAR, |x, _| {
        [0, 0, 0, if x == 0 { 0 } else { 255 }]
    });
    let cut = TextureSlot {
        channel: 3,
        flags: SLOT_FLAG_CUTOUT,
        cutoff: 0.5,
        wrap: WRAP_CLAMP,
        ..slot(0, PROJECTION_UV, 100.0)
    };
    let scene = scene_of(
        square(100.0),
        black.clone(),
        textures_with(&[(SLOT_ALPHA, cut)]),
        vec![halves],
        ortho_front(200.0),
        (16, 16),
    );
    let film = render(&scene, 4);
    let left = pixel(&film, 3, 8);
    let right = pixel(&film, 12, 8);
    assert!((left.g - 1.0).abs() < 1.0e-4, "left {left:?}");
    assert!(right.g < 1.0e-4, "right {right:?}");
    // Without the texture, the whole square is black.
    let mut plain = scene.clone();
    plain.textures.clear();
    assert!(pixel(&render(&plain, 4), 3, 8).g < 1.0e-4);
    // A coverage of a quarter: three quarters of the samples pass.
    let quarter = rgba_image(1, 1, COLOR_LINEAR, |_, _| [0, 0, 0, 64]);
    let cover = TextureSlot {
        channel: 3,
        ..slot(0, PROJECTION_UV, 100.0)
    };
    let mut c = scene.clone();
    c.images = vec![Arc::new(quarter)];
    c.textures = vec![Some(textures_with(&[(SLOT_ALPHA, cover)]))];
    let film = render(&c, 256);
    let mean: f32 = (4..12).map(|x| pixel(&film, x, 8).g).sum::<f32>() / 8.0;
    assert!((mean - (1.0 - 64.0 / 255.0)).abs() < 0.04, "{mean}");
    // Shadow rays look at the opacity too: from behind the cut half, a shadow ray to the camera
    // side reaches the world; through the opaque half, it does not.
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
}

#[test]
fn labels_lie_over_the_surface_in_order_with_their_own_finish() {
    // Two labels on the square, the second over the first where they overlap: red paper (alpha
    // 1) then a half-transparent blue one, both matte with some coat, on a smooth metal.
    let red = rgba_image(1, 1, COLOR_SRGB, |_, _| [255, 0, 0, 255]);
    let blue = rgba_image(1, 1, COLOR_SRGB, |_, _| [0, 0, 255, 128]);
    let label = |image: u32, x: f32, roughness: f32, coat: f32| Label {
        image: Some(image),
        origin: Vec3::new(x, 0.0, 0.0),
        u: Vec3::new(1.0, 0.0, 0.0),
        v: Vec3::new(0.0, 0.0, 1.0),
        normal: Vec3::new(0.0, -1.0, 0.0),
        width_mm: 60.0,
        height_mm: 60.0,
        depth_mm: 5.0,
        roughness,
        coat,
        relief: 0.0,
    };
    let t = MaterialTextures {
        labels: vec![label(0, -20.0, 0.8, 0.0), label(1, 20.0, 0.4, 1.0)],
        ..MaterialTextures::default()
    };
    let metal = Material {
        base_color: Rgb::new(0.9, 0.9, 0.9),
        metallic: 1.0,
        roughness: 0.1,
        transmission: 0.0,
        ..Material::default()
    };
    let scene = scene_of(
        square(100.0),
        metal.clone(),
        t,
        vec![red, blue],
        ortho_front(200.0),
        (8, 8),
    );
    let setup = TextureSetup::new(&scene);
    let at = |x: f32| {
        let (ray, hit, mut shade) =
            hit_of(&scene, Vec3::new(x, -1000.0, 0.0), Vec3::new(0.0, 1.0, 0.0));
        setup
            .apply(&scene, &ray, &hit, &mut shade, &metal, &Footprint::NONE)
            .expect("textured")
            .material
    };
    let near = |a: f32, b: f32| (a - b).abs() < 1.0e-4;
    // Only the red one: paper, not metal.
    let a = at(-40.0);
    assert!(
        near(a.base_color.r, 1.0) && near(a.base_color.b, 0.0),
        "{a:?}"
    );
    assert!(near(a.metallic, 0.0) && near(a.roughness, 0.8) && near(a.coat, 0.0));
    // Both: blue over red by half.
    let b = at(0.0);
    let half = 128.0 / 255.0;
    assert!(
        near(b.base_color.r, 1.0 - half) && near(b.base_color.b, half),
        "{b:?}"
    );
    assert!(near(b.roughness, 0.8 + half * (0.4 - 0.8)) && near(b.coat, half));
    // Only the blue one: half over the metal.
    let c = at(40.0);
    assert!(near(c.metallic, 1.0 - half), "{c:?}");
    assert!(near(c.roughness, 0.1 * (1.0 - half) + 0.4 * half));
    assert!(near(c.base_color.r, 0.9 + half * (0.0 - 0.9)));
    // Beyond both: the metal as it was.
    assert_eq!(at(80.0), metal);
    // A surface facing away from a label does not take it: the same label seen from behind.
    let mut back = scene.clone();
    for l in &mut back.textures[0].as_mut().unwrap().labels {
        l.normal = Vec3::new(0.0, 1.0, 0.0);
    }
    let setup = TextureSetup::new(&back);
    let (ray, hit, mut shade) = hit_of(
        &back,
        Vec3::new(-40.0, -1000.0, 0.0),
        Vec3::new(0.0, 1.0, 0.0),
    );
    let m = setup
        .apply(&back, &ray, &hit, &mut shade, &metal, &Footprint::NONE)
        .expect("textured")
        .material;
    assert_eq!(m, metal);
}

#[test]
fn a_label_s_paper_edge_bends_the_normal_only_at_its_border() {
    let paper = rgba_image(16, 16, COLOR_SRGB, |_, _| [240, 240, 240, 255]);
    let t = MaterialTextures {
        labels: vec![Label {
            image: Some(0),
            origin: Vec3::ZERO,
            u: Vec3::new(1.0, 0.0, 0.0),
            v: Vec3::new(0.0, 0.0, 1.0),
            normal: Vec3::new(0.0, -1.0, 0.0),
            width_mm: 40.0,
            height_mm: 40.0,
            depth_mm: 5.0,
            roughness: 0.6,
            coat: 0.0,
            relief: 1.0,
        }],
        ..MaterialTextures::default()
    };
    let scene = scene_of(
        square(100.0),
        Material::default(),
        t,
        vec![paper],
        ortho_front(200.0),
        (8, 8),
    );
    let setup = TextureSetup::new(&scene);
    let normal_at = |x: f32| {
        let (ray, hit, mut shade) =
            hit_of(&scene, Vec3::new(x, -1000.0, 1.0), Vec3::new(0.0, 1.0, 0.0));
        setup
            .apply(
                &scene,
                &ray,
                &hit,
                &mut shade,
                &scene.materials[0],
                &Footprint::NONE,
            )
            .expect("textured");
        shade.normal
    };
    let flat = Vec3::new(0.0, -1.0, 0.0);
    assert_eq!(normal_at(0.0), flat, "inside the label");
    assert_eq!(normal_at(50.0), flat, "far outside it");
    // Its right edge at x = 20: the paper drops away to the right, so the normal leans right:
    // 0.15 mm down over two texels of 2.5 mm, a slope of 0.03.
    let edge = normal_at(20.0);
    assert!(
        (edge.x - 0.03).abs() < 0.003 && edge.z.abs() < 1.0e-4,
        "{edge:?}"
    );
    // Its left edge leans left.
    assert!(normal_at(-20.0).x < -0.02);
}

// ---------------------------------------------------------------------------- the scene

/// A textured scene for the RSB tests: two images, a slot of every kind and two labels.
fn textured_scene() -> Scene {
    let mut scene = crate::example::scene();
    scene.images = vec![
        Arc::new(rgba_image(4, 2, COLOR_SRGB, |x, y| {
            [(x * 60) as u8, (y * 90) as u8, 7, 200]
        })),
        Arc::new(
            TextureImage::new(3, 3, 1, COLOR_LINEAR, (0..9).map(|i| i * 20).collect())
                .expect("grey"),
        ),
    ];
    let mut t = MaterialTextures {
        emission_tint: Rgb::new(1.0, 0.5, 0.25),
        ..MaterialTextures::default()
    };
    t.slots[SLOT_COLOR] = TextureSlot {
        rotation_deg: 15.0,
        offset: [0.1, -0.2],
        repeat: [2.0, 3.0],
        ..slot(0, PROJECTION_BOX, 80.0)
    };
    t.slots[SLOT_ROUGHNESS] = TextureSlot {
        channel: CHANNEL_LUMINANCE,
        flags: SLOT_FLAG_INVERT,
        axis: AXIS_X,
        ..slot(1, PROJECTION_CYLINDRICAL, 300.0)
    };
    t.slots[SLOT_NORMAL] = TextureSlot {
        flags: SLOT_FLAG_HEIGHT,
        strength: 0.5,
        wrap: WRAP_MIRROR,
        ..slot(1, PROJECTION_SPHERICAL, 50.0)
    };
    t.slots[SLOT_ALPHA] = TextureSlot {
        flags: SLOT_FLAG_CUTOUT,
        cutoff: 0.3,
        channel: 3,
        ..slot(0, PROJECTION_UV, 100.0)
    };
    t.labels = vec![Label {
        image: Some(0),
        origin: Vec3::new(0.0, -100.0, 100.0),
        u: Vec3::new(1.0, 0.0, 0.0),
        v: Vec3::new(0.0, 0.0, 1.0),
        normal: Vec3::new(0.0, -1.0, 0.0),
        width_mm: 60.0,
        height_mm: 30.0,
        depth_mm: 30.0,
        roughness: 0.5,
        coat: 0.2,
        relief: 0.3,
    }];
    scene.textures = vec![Some(t), None, Some(MaterialTextures::default())];
    let meshes: Vec<Mesh> = scene
        .geometry
        .meshes()
        .iter()
        .map(|m| {
            let uv: Vec<[f32; 2]> = (0..m.vertex_count())
                .map(|i| {
                    let p = m.position(i).unwrap_or_default();
                    [p.x * 0.01, p.z * 0.01]
                })
                .collect();
            m.clone().with_uvs(vec![uv]).expect("uvs")
        })
        .collect();
    scene.geometry = Geometry::new(meshes, scene.geometry.instances().to_vec()).expect("geometry");
    scene
}

#[test]
fn a_textured_scene_round_trips_through_rsb() {
    let scene = textured_scene();
    let bytes = scene.to_rsb();
    let back = Scene::from_rsb(&bytes).expect("valid");
    assert_eq!(back, scene);
    assert!(!back.textured, "implied by the blocks");
    assert_eq!(back.images[1].level_count(), 2);
    assert_eq!(back.to_rsb(), bytes);
    // The sections: IMGS after the lights, before ENVR (the page's order); MATL with its block.
    let tags = section_tags(&bytes);
    let imgs = tags.iter().position(|t| t.0 == *b"IMGS").expect("IMGS");
    assert_eq!(tags[imgs + 1].0, *b"ENVR");
    let matl: Vec<usize> = tags
        .iter()
        .filter(|t| t.0 == *b"MATL")
        .map(|t| t.1)
        .collect();
    assert_eq!(
        matl,
        vec![100 + 4 * (1 + 90 + 3 + 1 + 19), 100, 100 + 4 * 95]
    );
}

/// Tags and payload sizes of an RSB file.
fn section_tags(bytes: &[u8]) -> Vec<([u8; 4], usize)> {
    let mut out = Vec::new();
    let mut pos = 8;
    while pos + 8 <= bytes.len() {
        let tag = [bytes[pos], bytes[pos + 1], bytes[pos + 2], bytes[pos + 3]];
        let len = u32::from_le_bytes([
            bytes[pos + 4],
            bytes[pos + 5],
            bytes[pos + 6],
            bytes[pos + 7],
        ]) as usize;
        out.push((tag, len));
        pos += 8 + len;
    }
    out
}

/// `bytes` with the payload of every section of `tag` replaced by `f` (or dropped by `None`).
fn edit_sections(
    bytes: &[u8],
    tag: [u8; 4],
    mut f: impl FnMut(&[u8]) -> Option<Vec<u8>>,
) -> Vec<u8> {
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
fn old_files_without_texture_data_read_as_before_and_bad_blocks_are_refused() {
    use crate::scene::RsbError;
    let scene = textured_scene();
    let bytes = scene.to_rsb();
    // A reader of before M2b sees the same scene without the texture data: drop it.
    let old = edit_sections(&bytes, *b"MATL", |p| Some(p[..100].to_vec()));
    let old = edit_sections(&old, *b"IMGS", |_| None);
    let old = edit_sections(&old, *b"MESH", |p| {
        let n = u32::from_le_bytes([p[0], p[1], p[2], p[3]]) as usize;
        let m = u32::from_le_bytes([p[4], p[5], p[6], p[7]]) as usize;
        Some(p[..4 * (2 + 6 * n + m + 1)].to_vec())
    });
    let plain = Scene::from_rsb(&old).expect("valid");
    assert!(plain.images.is_empty() && plain.textures.is_empty() && !plain.textured);
    assert_eq!(plain.to_rsb(), old);
    let mut expected = crate::example::scene();
    expected.render = plain.render.clone();
    assert_eq!(plain.materials, expected.materials);
    assert!(plain.geometry.meshes().iter().all(|m| m.uv_sets() == 0));
    // A block of another version is a newer file's: skipped.
    let newer = edit_sections(&bytes, *b"MATL", |p| {
        let mut p = p.to_vec();
        if p.len() > 100 {
            p[100] = 2;
        }
        Some(p)
    });
    let s = Scene::from_rsb(&newer).expect("valid");
    assert_eq!(s.textures.iter().flatten().count(), 0);
    // An image index past IMGS, an unknown projection, a truncated block, bad image data: errors.
    let past = edit_sections(&bytes, *b"MATL", |p| {
        let mut p = p.to_vec();
        if p.len() > 104 {
            p[104..108].copy_from_slice(&7u32.to_le_bytes());
        }
        Some(p)
    });
    assert!(matches!(
        Scene::from_rsb(&past),
        Err(RsbError::Invalid { tag, .. }) if tag == *b"MATL"
    ));
    let unknown = edit_sections(&bytes, *b"MATL", |p| {
        let mut p = p.to_vec();
        if p.len() > 108 {
            p[108..112].copy_from_slice(&9u32.to_le_bytes());
        }
        Some(p)
    });
    assert!(Scene::from_rsb(&unknown).is_err());
    let short = edit_sections(&bytes, *b"MATL", |p| {
        Some(if p.len() > 100 {
            p[..p.len() - 4].to_vec()
        } else {
            p.to_vec()
        })
    });
    assert!(matches!(
        Scene::from_rsb(&short),
        Err(RsbError::SectionTooShort { .. })
    ));
    let bad = edit_sections(&bytes, *b"IMGS", |p| {
        let mut p = p.to_vec();
        p[12..16].copy_from_slice(&2u32.to_le_bytes()); // two channels
        Some(p)
    });
    assert!(matches!(
        Scene::from_rsb(&bad),
        Err(RsbError::Invalid { tag, .. }) if tag == *b"IMGS"
    ));
    let cut = edit_sections(&bytes, *b"IMGS", |p| Some(p[..30].to_vec()));
    assert!(Scene::from_rsb(&cut).is_err());
    // Two IMGS sections, a UV set too many: errors.
    let twice = {
        let imgs = section_tags(&bytes);
        assert!(imgs.iter().any(|t| t.0 == *b"IMGS"));
        edit_sections(&bytes, *b"ENVR", |p| Some(p.to_vec()))
    };
    let mut doubled = twice.clone();
    let payload = imgs_payload(&bytes);
    doubled.extend_from_slice(b"IMGS");
    doubled.extend_from_slice(&(payload.len() as u32).to_le_bytes());
    doubled.extend_from_slice(&payload);
    assert!(matches!(
        Scene::from_rsb(&doubled),
        Err(RsbError::DuplicateSection { .. })
    ));
    let three = edit_sections(&bytes, *b"MESH", |p| {
        let n = u32::from_le_bytes([p[0], p[1], p[2], p[3]]) as usize;
        let m = u32::from_le_bytes([p[4], p[5], p[6], p[7]]) as usize;
        let at = 4 * (2 + 6 * n + m + 1);
        let mut p = p.to_vec();
        p[at..at + 4].copy_from_slice(&3u32.to_le_bytes());
        Some(p)
    });
    assert!(Scene::from_rsb(&three).is_err());
}

/// The payload of the IMGS section of `bytes`.
fn imgs_payload(bytes: &[u8]) -> Vec<u8> {
    let mut found = Vec::new();
    edit_sections(bytes, *b"IMGS", |p| {
        found = p.to_vec();
        Some(p.to_vec())
    });
    found
}

#[test]
fn updates_keep_the_images_with_the_meshes() {
    let scene = textured_scene();
    let bytes = scene.to_rsb();
    let mut loaded = Scene::from_rsb(&bytes).expect("valid");
    // An update without MESH and IMGS (a material changed): the images stay.
    let update = edit_sections(&bytes, *b"MESH", |_| None);
    let update = edit_sections(&update, *b"IMGS", |_| None);
    loaded.update_from_rsb(&update).expect("update");
    assert_eq!(loaded.images, scene.images);
    assert_eq!(loaded.textures, scene.textures);
    // With meshes but without IMGS: no images, and slots that refer to one are an error.
    let no_images = edit_sections(&bytes, *b"IMGS", |_| None);
    assert!(loaded.update_from_rsb(&no_images).is_err());
    assert_eq!(loaded.images, scene.images, "unchanged on error");
    let mut untextured = scene.clone();
    untextured.textures = vec![None, None, Some(MaterialTextures::default())];
    untextured.images.clear();
    loaded
        .update_from_rsb(&untextured.to_rsb())
        .expect("update");
    assert!(loaded.images.is_empty());
}

#[test]
fn an_empty_texture_block_and_the_uv_sets_change_no_pixel() {
    // What the page sends for a scene without images once the engine reads textures: a block
    // with every slot empty for each material and the meshes' UV sets. The image is the one
    // without, bit for bit.
    let plain = crate::example::scene();
    let mut with = textured_scene();
    with.images.clear();
    with.textures = vec![Some(MaterialTextures::default()); 3];
    let mut a = plain.clone();
    a.render.width = 48;
    a.render.height = 36;
    let mut b = Scene::from_rsb(&with.to_rsb()).expect("valid");
    b.render.width = 48;
    b.render.height = 36;
    assert!(b.textures.iter().all(Option::is_some));
    assert!(b.geometry.meshes().iter().all(|m| m.uv_sets() == 1));
    assert_eq!(render(&a, 2).resolve(), render(&b, 2).resolve());
}

#[test]
fn texture_reads_are_the_same_bits_on_every_simd_path() {
    let scene = crate::example::m2b_scene();
    let mut s = scene.clone();
    s.render.width = 40;
    s.render.height = 30;
    let prepared = Prepared::new(&s);
    let films: Vec<Vec<f32>> = Isa::available()
        .into_iter()
        .map(|isa| {
            let mut film = Film::new(40, 30);
            render_tile_prepared(
                &s,
                &prepared,
                TileRect {
                    x: 0,
                    y: 0,
                    w: 40,
                    h: 30,
                },
                0,
                &mut film,
                isa,
            );
            film.resolve()
        })
        .collect();
    for f in &films[1..] {
        assert_eq!(f, &films[0]);
    }
    // And the scene has every kind of read in it.
    assert!(!TextureSetup::new(&s).is_empty());
    let _ = Transform::IDENTITY;
    let _ = Instance::new(0, Transform::IDENTITY, 0);
    let _ = BACKGROUND_COLOR;
}
