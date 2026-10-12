//! The renderer.
//!
//! **Phase E1 placeholder.** [`render_tile`] is already a real ray caster (thin lens camera,
//! exact Moeller-Trumbore triangle intersection, deterministic per-pixel random streams) but it is
//! deliberately naive:
//!
//! * E2 replaces the brute-force loop over every triangle with a BVH.
//! * E3 replaces the `n.l` shading below with the path tracer (materials, lights, environment).
//!
//! The function signature, the tile/film contract and the determinism guarantees are the parts
//! that stay.

use crate::color::Rgb;
use crate::image::Film;
use crate::math::{Ray, Vec3};
use crate::rng::{mix64, Pcg32};
use crate::scene::Scene;

/// A rectangle of pixels in image space.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TileRect {
    /// Left column.
    pub x: u32,
    /// Top row.
    pub y: u32,
    /// Width in pixels.
    pub w: u32,
    /// Height in pixels.
    pub h: u32,
}

/// Splits a `width x height` image into tiles of at most `size x size` pixels, row by row.
/// A `size` of zero is treated as one.
pub fn tile_grid(width: u32, height: u32, size: u32) -> Vec<TileRect> {
    let size = size.max(1);
    let mut tiles = Vec::new();
    let mut y = 0;
    while y < height {
        let h = size.min(height - y);
        let mut x = 0;
        while x < width {
            let w = size.min(width - x);
            tiles.push(TileRect { x, y, w, h });
            x += w;
        }
        y += h;
    }
    tiles
}

/// Result of a ray / triangle test.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct TriangleHit {
    /// Ray parameter of the hit.
    pub t: f32,
    /// Barycentric weight of the second vertex.
    pub u: f32,
    /// Barycentric weight of the third vertex. The first vertex has weight `1 - u - v`.
    pub v: f32,
}

/// Moeller-Trumbore ray / triangle intersection. Triangles are two sided. Only hits with
/// `t` inside `[ray.t_min, ray.t_max]` count.
#[inline]
pub fn intersect_triangle(ray: &Ray, p0: Vec3, p1: Vec3, p2: Vec3) -> Option<TriangleHit> {
    let e1 = p1 - p0;
    let e2 = p2 - p0;
    let pvec = ray.dir.cross(e2);
    let det = e1.dot(pvec);
    if det.abs() < 1.0e-12 {
        return None; // Ray parallel to the triangle plane, or a degenerate triangle.
    }
    let inv = 1.0 / det;
    let tvec = ray.origin - p0;
    let u = tvec.dot(pvec) * inv;
    if !(0.0..=1.0).contains(&u) {
        return None;
    }
    let qvec = tvec.cross(e1);
    let v = ray.dir.dot(qvec) * inv;
    if v < 0.0 || u + v > 1.0 {
        return None;
    }
    let t = e2.dot(qvec) * inv;
    if t < ray.t_min || t > ray.t_max {
        return None;
    }
    Some(TriangleHit { t, u, v })
}

/// Random stream for one pixel and one sample. It depends only on the scene seed, the image
/// space pixel and the sample index, never on how the image is cut into tiles or on the order the
/// tiles are rendered, so every schedule and every platform produces the same film.
fn pixel_rng(seed: u32, x: u32, y: u32, sample_index: u32) -> Pcg32 {
    let pixel = (u64::from(y) << 32) | u64::from(x);
    let sample = (u64::from(seed) << 32) | u64::from(sample_index);
    let key = mix64(pixel ^ mix64(sample));
    Pcg32::seeded(key, mix64(key))
}

/// A point uniformly distributed in the unit disk, by rejection sampling. Unlike the polar or
/// concentric mappings it needs no `sin`/`cos`, so the result is bit-identical on every platform.
fn sample_unit_disk(rng: &mut Pcg32) -> (f32, f32) {
    for _ in 0..16 {
        let x = rng.next_f32() * 2.0 - 1.0;
        let y = rng.next_f32() * 2.0 - 1.0;
        if x * x + y * y <= 1.0 {
            return (x, y);
        }
    }
    (0.0, 0.0)
}

/// Brute-force closest hit over every triangle of every mesh: `(mesh, triangle, hit)`.
fn closest_hit(scene: &Scene, ray: &Ray) -> Option<(usize, usize, TriangleHit)> {
    let mut ray = *ray;
    let mut best = None;
    for (mi, mesh) in scene.meshes.iter().enumerate() {
        for (ti, tri) in mesh.indices.chunks_exact(3).enumerate() {
            let (Some(&p0), Some(&p1), Some(&p2)) = (
                mesh.positions.get(tri[0] as usize),
                mesh.positions.get(tri[1] as usize),
                mesh.positions.get(tri[2] as usize),
            ) else {
                continue;
            };
            if let Some(hit) = intersect_triangle(&ray, p0, p1, p2) {
                ray.t_max = hit.t;
                best = Some((mi, ti, hit));
            }
        }
    }
    best
}

/// Placeholder shading: albedo times (`n.l` of the first light plus a flat ambient taken from
/// the environment `horizon`). Misses are black. No shadows, no bounces: E3 replaces all of it.
fn shade(scene: &Scene, ray: &Ray) -> Rgb {
    let Some((mi, ti, hit)) = closest_hit(scene, ray) else {
        return Rgb::BLACK;
    };
    let mesh = &scene.meshes[mi];
    let tri = &mesh.indices[ti * 3..ti * 3 + 3];
    let corner = |k: usize| mesh.positions[tri[k] as usize];
    let geometric = (corner(1) - corner(0))
        .cross(corner(2) - corner(0))
        .normalize();

    // Smooth normal when the mesh provides usable ones, geometric normal otherwise.
    let w0 = 1.0 - hit.u - hit.v;
    let smooth = match (
        mesh.normals.get(tri[0] as usize),
        mesh.normals.get(tri[1] as usize),
    ) {
        (Some(&n0), Some(&n1)) => match mesh.normals.get(tri[2] as usize) {
            Some(&n2) => n0 * w0 + n1 * hit.u + n2 * hit.v,
            None => Vec3::ZERO,
        },
        _ => Vec3::ZERO,
    };
    let mut normal = if smooth.length_squared() > 1.0e-12 {
        smooth.normalize()
    } else {
        geometric
    };
    if normal.dot(ray.dir) > 0.0 {
        normal = -normal; // Two sided: face the viewer.
    }

    let albedo = scene
        .materials
        .get(mesh.material_id as usize)
        .map_or(Rgb::splat(0.8), |m| m.base_color);
    let ambient = Rgb::splat(scene.environment.horizon * scene.environment.strength);
    let direct = scene.lights.first().map_or(Rgb::BLACK, |light| {
        let to_light = -light.direction.normalize();
        light.color * normal.dot(to_light).max(0.0)
    });
    albedo * (direct + ambient)
}

/// Renders one sample of every pixel of `tile` into `film` and returns the number of rays cast.
///
/// * The tile is clipped to the image (`scene.render.width x height`); `film` receives splats in
///   image space and silently ignores pixels outside of itself, so it may be the whole image or
///   just the tile (see [`Film::region`]).
/// * Each pixel gets one jittered camera ray (and one lens sample for a thin lens camera) drawn
///   from a [`Pcg32`] stream determined only by (scene seed, pixel, `sample_index`). Rendering
///   the same samples in any tile order, with any tile size, on any platform, gives identical
///   films.
///
/// Phase E1: brute-force intersection and `n.l` shading; see the module documentation.
pub fn render_tile(scene: &Scene, tile: TileRect, sample_index: u32, film: &mut Film) -> u64 {
    let (width, height) = (scene.render.width, scene.render.height);
    let aspect = width as f32 / height as f32;
    let x_end = tile.x.saturating_add(tile.w).min(width);
    let y_end = tile.y.saturating_add(tile.h).min(height);
    let thin_lens = scene.camera.lens_radius() > 0.0;
    let mut rays = 0u64;

    for y in tile.y..y_end {
        for x in tile.x..x_end {
            let mut rng = pixel_rng(scene.render.seed, x, y, sample_index);
            let u = (x as f32 + rng.next_f32()) / width as f32;
            let v = (y as f32 + rng.next_f32()) / height as f32;
            let lens = if thin_lens {
                sample_unit_disk(&mut rng)
            } else {
                (0.0, 0.0)
            };
            let ray = scene.camera.generate_ray(aspect, u, v, lens);
            film.splat(x, y, shade(scene, &ray));
            rays += 1;
        }
    }
    rays
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::scene::{Camera, Environment, Light, LightKind, Material, Mesh, RenderSettings};

    /// One big triangle facing the camera, which looks along +Y from y = -100 at the origin.
    fn triangle_scene() -> Scene {
        Scene {
            camera: Camera {
                position: Vec3::new(0.0, -100.0, 0.0),
                target: Vec3::ZERO,
                focal_mm: 50.0,
                sensor_mm: 36.0,
                ..Camera::default()
            },
            materials: vec![Material::default()],
            meshes: vec![Mesh {
                positions: vec![
                    Vec3::new(-10.0, 0.0, -10.0),
                    Vec3::new(10.0, 0.0, -10.0),
                    Vec3::new(0.0, 0.0, 10.0),
                ],
                normals: vec![Vec3::new(0.0, -1.0, 0.0); 3],
                indices: vec![0, 1, 2],
                material_id: 0,
            }],
            lights: vec![Light {
                kind: LightKind::Sun,
                direction: Vec3::new(0.0, 1.0, 0.0),
                ..Light::default()
            }],
            environment: Environment::default(),
            render: RenderSettings {
                width: 16,
                height: 16,
                ..RenderSettings::default()
            },
        }
    }

    fn whole(scene: &Scene) -> TileRect {
        TileRect {
            x: 0,
            y: 0,
            w: scene.render.width,
            h: scene.render.height,
        }
    }

    #[test]
    fn a_triangle_facing_the_camera_lights_exactly_its_projection() {
        let scene = triangle_scene();
        let mut film = Film::new(16, 16);
        let rays = render_tile(&scene, whole(&scene), 0, &mut film);
        assert_eq!(rays, 256);
        let pixels = film.resolve();
        let at = |x: usize, y: usize| &pixels[(y * 16 + x) * 3..(y * 16 + x) * 3 + 3];

        // The centre pixel looks straight at the triangle: albedo 0.8 * (n.l 1 + ambient 0.3).
        for c in at(8, 8) {
            assert!(
                (c - 0.8 * 1.3).abs() < 1.0e-4,
                "centre pixel {:?}",
                at(8, 8)
            );
        }
        // The triangle spans +-10 mm at 100 mm, i.e. +-0.139 of the 36 mm / 50 mm frame:
        // pixels 5..=10 in each direction. Everything outside is exactly zero.
        let mut lit = 0;
        for y in 0..16 {
            for x in 0..16 {
                let value = at(x, y);
                if (5..=10).contains(&x) && (5..=10).contains(&y) {
                    lit += usize::from(value[0] > 0.0);
                } else {
                    assert_eq!(value, [0.0, 0.0, 0.0], "pixel ({x}, {y}) should be black");
                }
            }
        }
        assert!(lit >= 8, "only {lit} pixels lit");
        assert_eq!(at(0, 0), [0.0; 3]);
        assert_eq!(at(15, 15), [0.0; 3]);
    }

    #[test]
    fn shading_without_normals_or_materials_uses_defaults() {
        let mut scene = triangle_scene();
        scene.meshes[0].normals.clear();
        scene.materials.clear();
        scene.lights.clear();
        let mut film = Film::new(16, 16);
        render_tile(&scene, whole(&scene), 0, &mut film);
        // Grey 0.8 albedo, ambient only (0.3).
        let centre = film.resolve()[(8 * 16 + 8) * 3];
        assert!((centre - 0.8 * 0.3).abs() < 1.0e-5, "{centre}");
    }

    #[test]
    fn tiles_are_clipped_to_the_image() {
        let scene = triangle_scene();
        let mut film = Film::new(16, 16);
        let rays = render_tile(
            &scene,
            TileRect {
                x: 12,
                y: 12,
                w: 100,
                h: 100,
            },
            0,
            &mut film,
        );
        assert_eq!(rays, 16);
        assert_eq!(film.weight.iter().filter(|&&w| w > 0.0).count(), 16);
        assert_eq!(
            render_tile(
                &scene,
                TileRect {
                    x: 20,
                    y: 0,
                    w: 4,
                    h: 4
                },
                0,
                &mut film
            ),
            0
        );
    }

    #[test]
    fn tile_grid_covers_the_image_exactly_once() {
        let tiles = tile_grid(70, 50, 32);
        assert_eq!(tiles.len(), 3 * 2);
        let area: u32 = tiles.iter().map(|t| t.w * t.h).sum();
        assert_eq!(area, 70 * 50);
        assert_eq!(
            tiles[0],
            TileRect {
                x: 0,
                y: 0,
                w: 32,
                h: 32
            }
        );
        assert_eq!(
            tiles[2],
            TileRect {
                x: 64,
                y: 0,
                w: 6,
                h: 32
            }
        );
        assert_eq!(
            tiles[5],
            TileRect {
                x: 64,
                y: 32,
                w: 6,
                h: 18
            }
        );
        assert_eq!(tile_grid(3, 2, 0).len(), 6);
        assert!(tile_grid(0, 10, 8).is_empty());
    }

    /// Renders `samples` samples with the given tiles, in the given order.
    fn render_with(scene: &Scene, tiles: &[TileRect], samples: u32) -> Film {
        let mut film = Film::new(scene.render.width, scene.render.height);
        for &tile in tiles {
            for s in 0..samples {
                render_tile(scene, tile, s, &mut film);
            }
        }
        film
    }

    #[test]
    fn films_are_identical_for_any_tile_order_and_tile_size() {
        // The built-in example has a curved mesh, a floor and (below) a thin lens.
        let mut scene = crate::example::scene();
        scene.render.width = 40;
        scene.render.height = 30;
        scene.camera.fstop = 2.8;
        scene.camera.focus_dist = 650.0;

        let forward = tile_grid(40, 30, 8);
        let mut reversed = forward.clone();
        reversed.reverse();
        let mut shuffled = forward.clone();
        shuffled.sort_by_key(|t| (t.x * 7 + t.y * 13) % 11);

        let reference = render_with(&scene, &forward, 3);
        assert!(reference.weight.iter().all(|&w| w == 3.0));
        assert!(reference.rgb.iter().any(|&v| v > 0.0));
        assert_eq!(render_with(&scene, &reversed, 3), reference);
        assert_eq!(render_with(&scene, &shuffled, 3), reference);
        // A different tiling, including one tile for the whole image.
        assert_eq!(render_with(&scene, &tile_grid(40, 30, 13), 3), reference);
        assert_eq!(render_with(&scene, &[whole(&scene)], 3), reference);
    }

    #[test]
    fn a_region_film_matches_the_same_pixels_of_a_full_film() {
        let mut scene = crate::example::scene();
        scene.render.width = 32;
        scene.render.height = 24;
        let tile = TileRect {
            x: 8,
            y: 4,
            w: 8,
            h: 8,
        };
        let mut full = Film::new(32, 24);
        render_tile(&scene, tile, 5, &mut full);
        let mut region = Film::region(8, 4, 8, 8);
        render_tile(&scene, tile, 5, &mut region);
        let full_pixels = full.resolve();
        let region_pixels = region.resolve();
        for y in 0..8usize {
            for x in 0..8usize {
                let a = ((y + 4) * 32 + x + 8) * 3;
                let b = (y * 8 + x) * 3;
                assert_eq!(full_pixels[a..a + 3], region_pixels[b..b + 3]);
            }
        }
    }

    /// FNV-1a over the little-endian bytes of every float.
    fn fnv1a(values: &[f32]) -> u32 {
        values
            .iter()
            .flat_map(|v| v.to_le_bytes())
            .fold(0x811c_9dc5u32, |hash, byte| {
                (hash ^ u32::from(byte)).wrapping_mul(0x0100_0193)
            })
    }

    #[test]
    fn a_tile_of_the_example_has_a_pinned_hash_on_every_platform() {
        // The render path uses only IEEE add/mul/div/sqrt and integer maths, so the bits are
        // identical on x86-64, aarch64, riscv64 and wasm32. The same tile rendered by the wasm
        // build under Node gives the same hash.
        let scene = crate::example::scene();
        let tile = TileRect {
            x: 240,
            y: 176,
            w: 32,
            h: 32,
        };
        let mut film = Film::region(tile.x, tile.y, tile.w, tile.h);
        render_tile(&scene, tile, 3, &mut film);
        assert_eq!(fnv1a(&film.resolve()), 0x6b5a_9e50);
    }

    #[test]
    fn different_samples_and_seeds_jitter_differently() {
        let mut scene = crate::example::scene();
        scene.render.width = 24;
        scene.render.height = 16;
        let tile = whole(&scene);
        let render_one = |scene: &Scene, sample: u32| {
            let mut film = Film::new(24, 16);
            render_tile(scene, tile, sample, &mut film);
            film
        };
        let a = render_one(&scene, 0);
        assert_eq!(a, render_one(&scene, 0));
        assert_ne!(a, render_one(&scene, 1));
        scene.render.seed = 99;
        assert_ne!(a, render_one(&scene, 0));
    }

    #[test]
    fn triangle_intersection_hits_misses_and_respects_the_interval() {
        let (a, b, c) = (
            Vec3::ZERO,
            Vec3::new(1.0, 0.0, 0.0),
            Vec3::new(0.0, 1.0, 0.0),
        );
        let down = Ray::new(Vec3::new(0.25, 0.25, 2.0), Vec3::new(0.0, 0.0, -1.0));
        let hit = intersect_triangle(&down, a, b, c).expect("hit");
        assert!((hit.t - 2.0).abs() < 1.0e-6);
        assert!((hit.u - 0.25).abs() < 1.0e-6 && (hit.v - 0.25).abs() < 1.0e-6);
        // Two sided: the same triangle seen from below.
        let up = Ray::new(Vec3::new(0.25, 0.25, -2.0), Vec3::new(0.0, 0.0, 1.0));
        assert!(intersect_triangle(&up, a, b, c).is_some());
        // Outside of the triangle, parallel, and out of the interval.
        let outside = Ray::new(Vec3::new(0.9, 0.9, 2.0), Vec3::new(0.0, 0.0, -1.0));
        assert!(intersect_triangle(&outside, a, b, c).is_none());
        let parallel = Ray::new(Vec3::new(0.25, 0.25, 2.0), Vec3::new(1.0, 0.0, 0.0));
        assert!(intersect_triangle(&parallel, a, b, c).is_none());
        let mut short = down;
        short.t_max = 1.0;
        assert!(intersect_triangle(&short, a, b, c).is_none());
        let mut behind = down;
        behind.t_min = 3.0;
        assert!(intersect_triangle(&behind, a, b, c).is_none());
        // Degenerate triangle.
        assert!(intersect_triangle(&down, a, a, a).is_none());
    }

    #[test]
    fn the_nearer_surface_wins() {
        let mut scene = triangle_scene();
        // A second, nearer triangle with a different colour covering the first.
        scene.materials.push(Material {
            base_color: Rgb::new(0.0, 0.0, 0.0),
            ..Material::default()
        });
        scene.meshes.push(Mesh {
            positions: vec![
                Vec3::new(-20.0, -50.0, -20.0),
                Vec3::new(20.0, -50.0, -20.0),
                Vec3::new(0.0, -50.0, 20.0),
            ],
            normals: vec![],
            indices: vec![0, 1, 2],
            material_id: 1,
        });
        let mut film = Film::new(16, 16);
        render_tile(&scene, whole(&scene), 0, &mut film);
        assert_eq!(film.resolve()[(8 * 16 + 8) * 3], 0.0);
    }
}
