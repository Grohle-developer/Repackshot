//! The renderer: tiles of pixels, one sample at a time.
//!
//! [`render_tile`] renders one sample of every pixel of a tile with the path tracer of
//! [`crate::integrator`]: a camera ray per pixel (box filter: the position inside the pixel is
//! uniform; a Gaussian or Blackman–Harris filter can replace it by weighting splats later), the
//! point on the lens of a thin-lens camera, then the path. The random numbers come from the
//! [`PixelSampler`] of (scene seed, pixel, sample index) only, so a tile can be rendered by any
//! thread, in any order, cut in any way, on any platform: the film is the same. Accumulating
//! samples `0..n` into a film in that order is progressive rendering; the hosts do it per tile.
//!
//! The exact passes of [`crate::passes`] are rendered next to the image, by rays of their own:
//! [`render_tile_exact`] once per tile (one ray through each pixel's centre, [`centre_ray`]) and
//! [`render_tile_albedo`] for every sample the image gets (the sample's own camera ray). Neither
//! touches the image's film or its random numbers.

use crate::caustics::PhotonMap;
use crate::color::Rgb;
use crate::image::Film;
use crate::integrator::{first_hit, radiance_with, BvhTracer, Prepared, Tracer};
use crate::math::Ray;
use crate::passes::{albedo_of, Exact, PassFilm, PASS_ALBEDO, PASS_EXACT};
use crate::sampler::{PixelSampler, DIM_CAMERA};
use crate::scene::Scene;
use crate::simd::Isa;

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

/// The camera ray of image-space pixel `(x, y)` for the samples of `sampler`: a uniform position
/// inside the pixel (box filter) and, for a thin lens, a point on the aperture.
pub fn camera_ray(scene: &Scene, sampler: &PixelSampler, x: u32, y: u32) -> Ray {
    camera_sample(scene, sampler, x, y).0
}

/// [`camera_ray`] and the position it passes through on the screen, `(u, v)` in `[0, 1]²` from
/// the top left (where a background image is looked up).
pub fn camera_sample(scene: &Scene, sampler: &PixelSampler, x: u32, y: u32) -> (Ray, (f32, f32)) {
    let (ray, screen, _) = camera_sample_weighted(scene, sampler, x, y);
    (ray, screen)
}

/// [`camera_sample`] and the colour weight of the light the ray brings back: white for the plain
/// thin lens, one channel (three times) for a chromatic band of a lens or black for a sample its
/// cat's eye blocks ([`crate::optics::Lens::sample`]).
pub fn camera_sample_weighted(
    scene: &Scene,
    sampler: &PixelSampler,
    x: u32,
    y: u32,
) -> (Ray, (f32, f32), Rgb) {
    let (width, height) = (scene.render.width.max(1), scene.render.height.max(1));
    let aspect = width as f32 / height as f32;
    let (du, dv) = sampler.get2(DIM_CAMERA);
    let u = (x as f32 + du) / width as f32;
    let v = (y as f32 + dv) / height as f32;
    let (ray, weight) = scene.camera.sample_ray(aspect, u, v, sampler);
    (ray, (u, v), weight)
}

/// Renders one sample of every pixel of `tile` into `film` and returns the number of rays cast
/// (camera, extension and shadow rays).
///
/// * The tile is clipped to the image (`scene.render.width x height`); `film` receives splats in
///   image space and silently ignores pixels outside of itself, so it may be the whole image or
///   just the tile (see [`Film::region`]).
/// * Every random number is drawn from the [`PixelSampler`] of (scene seed, pixel,
///   `sample_index`). Rendering the same samples in any tile order, with any tile size, on any
///   platform, gives identical films.
///
/// This prepares the scene's lights on every call; hosts that render many tiles of one scene
/// call [`render_tile_prepared`] with one [`Prepared`] instead.
pub fn render_tile(scene: &Scene, tile: TileRect, sample_index: u32, film: &mut Film) -> u64 {
    render_tile_with(scene, tile, sample_index, film, Isa::detect())
}

/// [`render_tile`] on an explicit SIMD path. Every path gives the same film, bit for bit.
pub fn render_tile_with(
    scene: &Scene,
    tile: TileRect,
    sample_index: u32,
    film: &mut Film,
    isa: Isa,
) -> u64 {
    let prepared = Prepared::new(scene);
    render_tile_prepared(scene, &prepared, tile, sample_index, film, isa)
}

/// [`render_tile`] with the scene already prepared (`prepared` must come from `scene`).
///
/// A scene with caustics ([`Prepared::has_caustics`]) renders them only through
/// [`render_tile_photons`], with the photon map of the sample; here it renders as the path
/// tracer alone would.
pub fn render_tile_prepared(
    scene: &Scene,
    prepared: &Prepared,
    tile: TileRect,
    sample_index: u32,
    film: &mut Film,
    isa: Isa,
) -> u64 {
    render_tile_photons(scene, prepared, None, tile, sample_index, film, isa)
}

/// [`render_tile_prepared`] with the photon map of `sample_index` (E5b-1, [`crate::caustics`]):
/// the caustics come from the map and the paths leave them out. `photons` must be the map of
/// this scene and this sample index ([`PhotonMap::trace`]); a map of another sample index is
/// ignored (the tile renders without caustics, as with `None`). Returns the rays cast, the map's
/// own not included.
pub fn render_tile_photons(
    scene: &Scene,
    prepared: &Prepared,
    photons: Option<&PhotonMap>,
    tile: TileRect,
    sample_index: u32,
    film: &mut Film,
    isa: Isa,
) -> u64 {
    let tracer = BvhTracer {
        geometry: &scene.geometry,
        isa,
    };
    let photons = photons.filter(|m| m.iteration() == sample_index && prepared.has_caustics());
    render_tile_traced(scene, prepared, tile, sample_index, film, &tracer, photons)
}

/// The body of the tile renderers, generic over how rays are traced.
fn render_tile_traced<T: Tracer>(
    scene: &Scene,
    prepared: &Prepared,
    tile: TileRect,
    sample_index: u32,
    film: &mut Film,
    tracer: &T,
    photons: Option<&PhotonMap>,
) -> u64 {
    let (width, height) = (scene.render.width, scene.render.height);
    let x_end = tile.x.saturating_add(tile.w).min(width);
    let y_end = tile.y.saturating_add(tile.h).min(height);
    let mut rays = 0u64;
    for y in tile.y..y_end {
        for x in tile.x..x_end {
            let sampler = PixelSampler::new(scene.render.seed, x, y, sample_index);
            let (ray, screen, weight) = camera_sample_weighted(scene, &sampler, x, y);
            let (c, alpha) = radiance_with(
                scene, prepared, tracer, &sampler, ray, screen, photons, &mut rays,
            );
            film.splat_alpha(x, y, c * weight, alpha);
        }
    }
    rays
}

/// The ray of the exact passes through image-space pixel `(x, y)`: through the centre of the
/// pixel, without jitter, and through the centre of the lens (AI-POST.md §7.4). For a thin lens it
/// is the pinhole ray of the same point, so it meets the focus plane where every sample of the
/// pixel's centre does.
pub fn centre_ray(scene: &Scene, x: u32, y: u32) -> Ray {
    let (width, height) = (scene.render.width.max(1), scene.render.height.max(1));
    let aspect = width as f32 / height as f32;
    let u = (x as f32 + 0.5) / width as f32;
    let v = (y as f32 + 0.5) / height as f32;
    scene.camera.generate_ray(aspect, u, v, (0.0, 0.0))
}

/// Writes the exact passes of `film` (normal, depth, the ids, the circle of confusion: those in
/// its mask) of every pixel of `tile`, clipped to the image, from [`centre_ray`]. They do not
/// depend on the sample, so a host renders them once per tile. Returns the rays cast (one per
/// pixel, none when the film holds no exact pass).
pub fn render_tile_exact(
    scene: &Scene,
    prepared: &Prepared,
    tile: TileRect,
    film: &mut PassFilm,
    isa: Isa,
) -> u64 {
    let tracer = BvhTracer {
        geometry: &scene.geometry,
        isa,
    };
    render_tile_exact_traced(scene, prepared, tile, film, &tracer)
}

fn render_tile_exact_traced<T: Tracer>(
    scene: &Scene,
    prepared: &Prepared,
    tile: TileRect,
    film: &mut PassFilm,
    tracer: &T,
) -> u64 {
    if film.mask & PASS_EXACT == 0 {
        return 0;
    }
    let x_end = tile.x.saturating_add(tile.w).min(scene.render.width);
    let y_end = tile.y.saturating_add(tile.h).min(scene.render.height);
    let mut rays = 0u64;
    for y in tile.y..y_end {
        for x in tile.x..x_end {
            let ray = centre_ray(scene, x, y);
            rays += 1;
            let exact = Exact::of(scene, &ray, first_hit(scene, prepared, tracer, &ray));
            film.set_exact(x, y, &exact);
        }
    }
    rays
}

/// Adds to `film` the albedo of sample `sample_index` of every pixel of `tile`, clipped to the
/// image: the base colour of what the sample's camera ray (the same position in the pixel and
/// point on the lens as the image's sample) meets first ([`albedo_of`]). Returns the rays cast
/// (one per pixel, none when the film has no albedo pass).
pub fn render_tile_albedo(
    scene: &Scene,
    prepared: &Prepared,
    tile: TileRect,
    sample_index: u32,
    film: &mut PassFilm,
    isa: Isa,
) -> u64 {
    if film.mask & PASS_ALBEDO == 0 {
        return 0;
    }
    let tracer = BvhTracer {
        geometry: &scene.geometry,
        isa,
    };
    let x_end = tile.x.saturating_add(tile.w).min(scene.render.width);
    let y_end = tile.y.saturating_add(tile.h).min(scene.render.height);
    let mut rays = 0u64;
    for y in tile.y..y_end {
        for x in tile.x..x_end {
            let sampler = PixelSampler::new(scene.render.seed, x, y, sample_index);
            let ray = camera_ray(scene, &sampler, x, y);
            rays += 1;
            film.add_albedo(
                x,
                y,
                albedo_of(scene, first_hit(scene, prepared, &tracer, &ray)),
            );
        }
    }
    rays
}

/// Every triangle of every instance tested against every ray, without the BVH: the reference
/// the accelerated renderer is checked against. Tests only.
#[cfg(test)]
pub(crate) struct BruteForce<'a>(pub &'a crate::geometry::Geometry);

#[cfg(test)]
impl Tracer for BruteForce<'_> {
    fn trace(&self, ray: &Ray) -> Option<crate::geometry::RayHit> {
        self.0.brute_force(ray).0
    }

    fn occluded(&self, ray: &Ray) -> bool {
        self.0.brute_force(ray).1
    }
}

/// [`render_tile`] through [`BruteForce`]. Tests only.
#[cfg(test)]
pub(crate) fn render_tile_brute_force(
    scene: &Scene,
    tile: TileRect,
    sample_index: u32,
    film: &mut Film,
) -> u64 {
    let prepared = Prepared::new(scene);
    render_tile_traced(
        scene,
        &prepared,
        tile,
        sample_index,
        film,
        &BruteForce(&scene.geometry),
        None,
    )
}

#[cfg(test)]
mod passes_tests;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::color::Rgb;
    use crate::fmath;
    use crate::math::Vec3;
    use crate::scene::{
        Camera, Environment, Geometry, Light, LightKind, Material, Mesh, RenderSettings,
        BACKGROUND_COLOR,
    };

    /// The triangle of `triangle_scene`, with or without its vertex normals.
    fn facing_triangle(normals: bool) -> Mesh {
        let n = [Vec3::new(0.0, -1.0, 0.0); 3];
        Mesh::new(
            &[
                Vec3::new(-10.0, 0.0, -10.0),
                Vec3::new(10.0, 0.0, -10.0),
                Vec3::new(0.0, 0.0, 10.0),
            ],
            if normals { &n } else { &[] },
            &[0, 1, 2],
            0,
        )
        .expect("valid")
    }

    /// A Lambertian material (an index-matched dielectric has no specular lobe).
    fn lambert(albedo: f32) -> Material {
        Material {
            base_color: Rgb::splat(albedo),
            ior: 1.0,
            ..Material::default()
        }
    }

    /// One big Lambertian triangle (albedo 0.8) facing the camera, which looks along +Y from
    /// y = -100 at the origin, lit by a delta sun shining along +Y with irradiance π, in a black
    /// world with a black background.
    fn triangle_scene() -> Scene {
        Scene {
            camera: Camera {
                position: Vec3::new(0.0, -100.0, 0.0),
                target: Vec3::ZERO,
                focal_mm: 50.0,
                sensor_mm: 36.0,
                ..Camera::default()
            },
            materials: vec![lambert(0.8)],
            geometry: Geometry::from_meshes(vec![facing_triangle(true)]),
            lights: vec![Light {
                kind: LightKind::Sun,
                direction: Vec3::new(0.0, 1.0, 0.0),
                power: fmath::PI,
                angle_deg: 0.0,
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
                ..RenderSettings::default()
            },
            ..Scene::default()
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
        assert!(rays >= 256, "at least one camera ray per pixel, got {rays}");
        let pixels = film.resolve();
        let at = |x: usize, y: usize| &pixels[(y * 16 + x) * 3..(y * 16 + x) * 3 + 3];

        // The centre pixel looks straight at the triangle, which faces the sun: radiance
        // albedo * E / π = 0.8 (the bounce leaves into a black world).
        for c in at(8, 8) {
            assert!((c - 0.8).abs() < 1.0e-5, "centre pixel {:?}", at(8, 8));
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
        let render = |scene: &Scene| {
            let mut film = Film::new(16, 16);
            render_tile(scene, whole(scene), 0, &mut film);
            film
        };
        // Without vertex normals the geometric normal shades, which is the same here.
        let mut scene = triangle_scene();
        let with_normals = render(&scene);
        scene.geometry = Geometry::from_meshes(vec![facing_triangle(false)]);
        assert_eq!(render(&scene), with_normals);
        // A missing material renders as the default one.
        scene.materials = vec![Material::default()];
        let explicit = render(&scene);
        scene.materials.clear();
        assert_eq!(render(&scene), explicit);
        assert!(explicit.resolve()[(8 * 16 + 8) * 3] > 0.0);
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
        assert!(rays >= 16);
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
        // The render path uses only IEEE add/mul/div/sqrt, the deterministic `fmath` functions
        // and integer maths, and every SIMD path gives the same bits, so the hashes are identical
        // on x86-64 (scalar, SSE2, AVX2), aarch64, riscv64 and wasm32 (with and without
        // simd128). The same tiles rendered by the wasm build under Node give the same hashes.
        //
        // E2 changed both values on purpose (watertight triangles, a second sphere instance).
        // E3 changed them again on purpose: the placeholder `n.l` shading became the path tracer
        // (Owen-scrambled Sobol samples, principled BSDF, area light with MIS, studio dome) and
        // the example's light power is now a flux in watts. The first tile is the centre of the
        // big sphere; the second one covers the small sphere.
        let scene = crate::example::scene();
        let tiles = [
            (
                TileRect {
                    x: 240,
                    y: 176,
                    w: 32,
                    h: 32,
                },
                PINNED_CENTRE,
            ),
            (
                TileRect {
                    x: 48,
                    y: 144,
                    w: 32,
                    h: 32,
                },
                PINNED_SMALL_SPHERE,
            ),
        ];
        for (tile, pinned) in tiles {
            for isa in Isa::available() {
                let mut film = Film::region(tile.x, tile.y, tile.w, tile.h);
                render_tile_with(&scene, tile, 3, &mut film, isa);
                let hash = fnv1a(&film.resolve());
                eprintln!("{tile:?} {}: {hash:#010x}", isa.name());
                assert_eq!(hash, pinned, "{tile:?} on {}", isa.name());
            }
        }
    }

    /// Pinned hash of the tile at the centre of the example (sample 3).
    const PINNED_CENTRE: u32 = 0x8023_c8cf;
    /// Pinned hash of the tile over the small sphere of the example (sample 3).
    const PINNED_SMALL_SPHERE: u32 = 0x8b22_0e08;

    /// Renders the whole example, 32-pixel tiles, samples `0..4`, and hashes the resolved film.
    pub(crate) fn example_4spp_hash() -> u32 {
        let scene = crate::example::scene();
        let prepared = Prepared::new(&scene);
        let (w, h) = (scene.render.width, scene.render.height);
        let mut film = Film::new(w, h);
        for tile in tile_grid(w, h, 32) {
            for sample in 0..4 {
                render_tile_prepared(&scene, &prepared, tile, sample, &mut film, Isa::detect());
            }
        }
        fnv1a(&film.resolve())
    }

    #[test]
    fn the_whole_example_at_four_samples_has_a_pinned_hash() {
        // The WebAssembly parity hash: `engine/tools/wasm-parity.mjs` renders the same image with
        // the real `rt_wasm.wasm` through `rt_render_tile` (samples 0..4 of every 32-pixel tile,
        // accumulated in that order in f32) and must print this value.
        let hash = example_4spp_hash();
        eprintln!("example at 4 spp: {hash:#010x}");
        assert_eq!(hash, PINNED_EXAMPLE_4SPP);
    }

    /// Pinned hash of the whole example image at 4 samples per pixel.
    pub(crate) const PINNED_EXAMPLE_4SPP: u32 = 0x8206_111f;

    /// Renders the whole E5 example (`sky` or HDRI), 32-pixel tiles, samples `0..4`, and hashes
    /// the resolved film.
    pub(crate) fn e5_4spp_hash(sky: bool, isa: Isa) -> u32 {
        scene_4spp_hash(&crate::example::e5_scene(sky), isa)
    }

    /// Renders all of `scene`, 32-pixel tiles, samples `0..4`, and hashes the resolved film.
    pub(crate) fn scene_4spp_hash(scene: &Scene, isa: Isa) -> u32 {
        let prepared = Prepared::new(scene);
        let (w, h) = (scene.render.width, scene.render.height);
        let mut film = Film::new(w, h);
        for tile in tile_grid(w, h, 32) {
            for sample in 0..4 {
                render_tile_prepared(scene, &prepared, tile, sample, &mut film, isa);
            }
        }
        fnv1a(&film.resolve())
    }

    #[test]
    fn the_e5_example_has_pinned_hashes_on_every_platform() {
        // E5 added clear glass with absorption, thin walls, cut-outs, anisotropy, HDRI and sky
        // environments and background images, all outside the original example (whose hashes
        // did not change). This scene goes through all of them, through the RGBE reader and an
        // RSB round trip; `tools/wasm-parity.mjs` checks the real module against the HDRI hash
        // (`rt --write-e5-example`).
        let scene = crate::example::e5_scene(false);
        assert_eq!(Scene::from_rsb(&scene.to_rsb()).as_ref(), Ok(&scene));
        for isa in Isa::available() {
            let (hdri, sky) = (e5_4spp_hash(false, isa), e5_4spp_hash(true, isa));
            eprintln!(
                "E5 example at 4 spp on {}: {hdri:#010x}, sky {sky:#010x}",
                isa.name()
            );
            assert_eq!(hdri, PINNED_E5_HDRI_4SPP, "HDRI on {}", isa.name());
            assert_eq!(sky, PINNED_E5_SKY_4SPP, "sky on {}", isa.name());
        }
    }

    /// Pinned hash of the E5 example (HDRI) at 4 samples per pixel.
    pub(crate) const PINNED_E5_HDRI_4SPP: u32 = 0x065d_16e0;
    /// Pinned hash of the E5 example (sky) at 4 samples per pixel.
    pub(crate) const PINNED_E5_SKY_4SPP: u32 = 0x1c24_c35c;

    #[test]
    fn the_e5c_physical_sky_has_a_pinned_hash_on_every_platform() {
        // E5c added the physical sky (the default model). The E5 sky scene above keeps the
        // classic model, so its hash did not move; this one is the same scene under the physical
        // sky at a low sun and a turbidity between two knots of the table, through an RSB round
        // trip; `tools/wasm-parity.mjs` checks the real module against it
        // (`rt --write-e5c-example`).
        let scene = crate::example::e5c_scene();
        assert_eq!(Scene::from_rsb(&scene.to_rsb()).as_ref(), Ok(&scene));
        for isa in Isa::available() {
            let hash = scene_4spp_hash(&scene, isa);
            eprintln!("E5c example at 4 spp on {}: {hash:#010x}", isa.name());
            assert_eq!(hash, PINNED_E5C_SKY_4SPP, "physical sky on {}", isa.name());
        }
    }

    /// Pinned hash of the E5c example (physical sky) at 4 samples per pixel.
    pub(crate) const PINNED_E5C_SKY_4SPP: u32 = 0x9f4a_f472;

    /// Renders all of `scene`, 32-pixel tiles, samples `0..4`, each with its photon map (traced
    /// once per sample, as every host does), and hashes the resolved film.
    pub(crate) fn caustic_4spp_hash(scene: &Scene, isa: Isa) -> u32 {
        let prepared = Prepared::new(scene);
        let (w, h) = (scene.render.width, scene.render.height);
        let mut film = Film::new(w, h);
        let maps: Vec<PhotonMap> = (0..4)
            .map(|sample| PhotonMap::trace(scene, &prepared, sample, isa))
            .collect();
        for tile in tile_grid(w, h, 32) {
            for sample in 0..4 {
                let map = Some(&maps[sample as usize]);
                render_tile_photons(scene, &prepared, map, tile, sample, &mut film, isa);
            }
        }
        fnv1a(&film.resolve())
    }

    #[test]
    fn the_e5b_caustics_have_a_pinned_hash_on_every_platform() {
        // E5b-1 added the photon map of the caustics. With photons the E5 scene's light reaches
        // the floor and the cut-out plane through the glass by the map, and the paths leave it
        // out; without photons nothing changed (the hashes above). Through an RSB round trip;
        // `tools/wasm-parity.mjs` checks the real module against it (`rt --write-e5b-example`).
        let scene = crate::example::e5b_scene();
        assert_eq!(Scene::from_rsb(&scene.to_rsb()).as_ref(), Ok(&scene));
        assert!(Prepared::new(&scene).has_caustics());
        for isa in Isa::available() {
            let hash = caustic_4spp_hash(&scene, isa);
            eprintln!("E5b example at 4 spp on {}: {hash:#010x}", isa.name());
            assert_eq!(hash, PINNED_E5B_CAUSTICS_4SPP, "caustics on {}", isa.name());
        }
        // Without its photon maps the scene renders as the E5 one did.
        assert_eq!(e5_4spp_hash(false, Isa::detect()), PINNED_E5_HDRI_4SPP);
        assert_eq!(scene_4spp_hash(&scene, Isa::detect()), PINNED_E5_HDRI_4SPP);
    }

    /// Pinned hash of the E5b-1 example (caustics) at 4 samples per pixel.
    pub(crate) const PINNED_E5B_CAUSTICS_4SPP: u32 = 0x5419_866e;

    #[test]
    fn the_o1_lens_has_a_pinned_hash_on_every_platform() {
        // O1 added the LENS section: an iris of curved blades, a bright ring, an obstruction, cat's
        // eye, an anamorphic squeeze, shift and tilt, chromatic bands, swirl and a pupil texture,
        // all on the example with bokeh lights behind it. The scenes without a lens kept every
        // hash above. Through an RSB round trip; `tools/wasm-parity.mjs` checks the real module
        // against it (`rt --write-o1-example`).
        let scene = crate::example::o1_scene();
        assert_eq!(Scene::from_rsb(&scene.to_rsb()).as_ref(), Ok(&scene));
        for isa in Isa::available() {
            let hash = scene_4spp_hash(&scene, isa);
            eprintln!("O1 example at 4 spp on {}: {hash:#010x}", isa.name());
            assert_eq!(hash, PINNED_O1_LENS_4SPP, "O1 lens on {}", isa.name());
        }
    }

    /// Pinned hash of the O1 example (the busy lens) at 4 samples per pixel.
    pub(crate) const PINNED_O1_LENS_4SPP: u32 = 0x1439_a1a8;

    #[test]
    fn the_bvh_renders_exactly_what_brute_force_renders() {
        // The whole path (camera, shadow and bounce rays) through brute force and through the
        // BVH gives the same film.
        let mut scene = crate::example::scene();
        scene.render.width = 64;
        scene.render.height = 48;
        scene.camera.fstop = 2.8; // thin lens: rays from many origins
        for sample in 0..2 {
            let tile = whole(&scene);
            let mut accelerated = Film::new(64, 48);
            render_tile(&scene, tile, sample, &mut accelerated);
            let mut reference = Film::new(64, 48);
            render_tile_brute_force(&scene, tile, sample, &mut reference);
            assert_eq!(accelerated, reference);
        }
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
    fn the_nearer_surface_wins() {
        let mut scene = triangle_scene();
        // A second, nearer triangle, black and without a specular lobe, covering the first.
        scene.materials.push(lambert(0.0));
        let nearer = Mesh::new(
            &[
                Vec3::new(-20.0, -50.0, -20.0),
                Vec3::new(20.0, -50.0, -20.0),
                Vec3::new(0.0, -50.0, 20.0),
            ],
            &[],
            &[0, 1, 2],
            1,
        )
        .expect("valid");
        scene.geometry = Geometry::from_meshes(vec![facing_triangle(true), nearer]);
        let mut film = Film::new(16, 16);
        render_tile(&scene, whole(&scene), 0, &mut film);
        assert_eq!(film.resolve()[(8 * 16 + 8) * 3], 0.0);
    }
}
