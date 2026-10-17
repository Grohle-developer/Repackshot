//! The renderer: tiles of pixels, one sample at a time.
//!
//! [`render_tile`] renders one sample of every pixel of a tile with the path tracer of
//! [`crate::integrator`]: a camera ray per pixel (where in or around the pixel it passes is the
//! scene's pixel filter, [`crate::pixel_filter`]; by default the box of the pixel, a uniform
//! position inside it), the point on the lens of a thin-lens camera, then the path. With edge
//! samples (E11, [`render_tile_edges`]) an edge pixel renders several samples per sample index
//! and splats their mean. The random numbers come from the
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
use crate::integrator::{first_hit, radiance_weighted, radiance_with, BvhTracer, Prepared, Tracer};
use crate::math::Ray;
use crate::passes::{albedo_of, coverage_of, Exact, PassFilm, PASS_EXACT, PASS_SAMPLED};
use crate::pixel_filter::{self, EdgeMask};
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

/// The camera ray of image-space pixel `(x, y)` for the samples of `sampler`: a position in or
/// around the pixel by the scene's pixel filter ([`pixel_filter::offset`]; the box: uniform
/// inside it) and, for a thin lens, a point on the aperture.
pub fn camera_ray(scene: &Scene, sampler: &PixelSampler, x: u32, y: u32) -> Ray {
    camera_sample(scene, sampler, x, y).0
}

/// [`camera_ray`] and the position it passes through on the screen, `(u, v)` in `[0, 1]²` from
/// the top left (where a background image is looked up; a filter wider than the pixel can pass
/// beyond the image's border, and the position is then the border's).
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
    let filter = scene.render.pixel_filter;
    let (du, dv) = (
        pixel_filter::offset(filter, du),
        pixel_filter::offset(filter, dv),
    );
    let u = (x as f32 + du) / width as f32;
    let v = (y as f32 + dv) / height as f32;
    let (ray, weight) = scene.camera.sample_ray(aspect, u, v, sampler);
    (ray, (u.clamp(0.0, 1.0), v.clamp(0.0, 1.0)), weight)
}

/// [`camera_sample_weighted`] and what the lens's effect filters did to the sample, when the
/// camera has filters (O3a, [`crate::optics::FilterPath`]); the same ray and weight.
pub fn camera_sample_filtered(
    scene: &Scene,
    sampler: &PixelSampler,
    x: u32,
    y: u32,
) -> (Ray, (f32, f32), Rgb, Option<crate::optics::FilterPath>) {
    let camera = &scene.camera;
    let Some(lens) = camera
        .lens
        .as_ref()
        .filter(|l| camera.through_lens() && !l.filters().is_empty())
    else {
        let (ray, screen, weight) = camera_sample_weighted(scene, sampler, x, y);
        return (ray, screen, weight, None);
    };
    // The sensor point as `camera_sample_weighted` draws it (E11's pixel filter included).
    let (width, height) = (scene.render.width.max(1), scene.render.height.max(1));
    let aspect = width as f32 / height as f32;
    let (du, dv) = sampler.get2(DIM_CAMERA);
    let filter = scene.render.pixel_filter;
    let (du, dv) = (
        pixel_filter::offset(filter, du),
        pixel_filter::offset(filter, dv),
    );
    let u = (x as f32 + du) / width as f32;
    let v = (y as f32 + dv) / height as f32;
    let (ray, weight, path) = lens.sample_filtered(camera, aspect, u, v, sampler);
    (ray, (u.clamp(0.0, 1.0), v.clamp(0.0, 1.0)), weight, path)
}

/// A camera sample: the ray, the screen position, the colour weight and what the lens's filters
/// did ([`camera_sample_filtered`]).
pub type CameraSample = (Ray, (f32, f32), Rgb, Option<crate::optics::FilterPath>);

/// True when the camera's samples are traced through a lens in batches ([`camera_samples`]).
pub fn camera_batches(scene: &Scene) -> bool {
    scene.camera.through_lens()
        && scene
            .camera
            .lens
            .as_ref()
            .is_some_and(|l| l.traced().is_some())
}

/// O2: [`camera_sample_filtered`] of the pixels `pixels` for sample `index`, into `out` (one per
/// pixel, in order): a traced lens traces them in batches, the same bits as one by one (the cost
/// rule of the roadmap).
pub fn camera_samples(
    scene: &Scene,
    pixels: &[(u32, u32)],
    index: u32,
    out: &mut Vec<CameraSample>,
) {
    out.clear();
    let camera = &scene.camera;
    let lens = camera.lens.as_ref().filter(|_| camera_batches(scene));
    let Some(lens) = lens else {
        for &(x, y) in pixels {
            let sampler = PixelSampler::new(scene.render.seed, x, y, index);
            out.push(camera_sample_filtered(scene, &sampler, x, y));
        }
        return;
    };
    // The sensor points as `camera_sample_filtered` draws them.
    let (width, height) = (scene.render.width.max(1), scene.render.height.max(1));
    let aspect = width as f32 / height as f32;
    let filter = scene.render.pixel_filter;
    let mut points = Vec::with_capacity(pixels.len());
    let mut samplers = Vec::with_capacity(pixels.len());
    for &(x, y) in pixels {
        let sampler = PixelSampler::new(scene.render.seed, x, y, index);
        let (du, dv) = sampler.get2(DIM_CAMERA);
        let (du, dv) = (
            pixel_filter::offset(filter, du),
            pixel_filter::offset(filter, dv),
        );
        points.push((
            (x as f32 + du) / width as f32,
            (y as f32 + dv) / height as f32,
        ));
        samplers.push(sampler);
    }
    let mut lensed = Vec::with_capacity(pixels.len());
    lens.sample_filtered_batch(camera, aspect, &points, &samplers, &mut lensed);
    for ((ray, weight, path), (u, v)) in lensed.into_iter().zip(points) {
        out.push((ray, (u.clamp(0.0, 1.0), v.clamp(0.0, 1.0)), weight, path));
    }
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
    render_tile_traced(
        scene,
        prepared,
        tile,
        sample_index,
        film,
        &tracer,
        photons,
        None,
    )
}

/// [`render_tile_photons`] with the edge samples of E11: the edge pixels of `edges` (made by
/// [`EdgeMask::of`] for this scene; its tile is the one rendered) render `k` samples, the sample
/// indices `sample_index · k … sample_index · k + k − 1` of their own sequence, and splat their
/// mean once; the other pixels render as [`render_tile_photons`] does. So every pixel still gets
/// one splat per sample index, and the image does not depend on threads or tiles. The photon map
/// of `sample_index` serves all of an edge pixel's samples.
pub fn render_tile_edges(
    scene: &Scene,
    prepared: &Prepared,
    photons: Option<&PhotonMap>,
    edges: &EdgeMask,
    sample_index: u32,
    film: &mut Film,
    isa: Isa,
) -> u64 {
    let tracer = BvhTracer {
        geometry: &scene.geometry,
        isa,
    };
    let photons = photons.filter(|m| m.iteration() == sample_index && prepared.has_caustics());
    render_tile_traced(
        scene,
        prepared,
        edges.tile(),
        sample_index,
        film,
        &tracer,
        photons,
        Some(edges),
    )
}

/// E10, adaptive sampling ([`crate::adaptive`]): [`render_tile_edges`] of the pixels of `rect`
/// only (a block of a round, inside the tile of `edges`), sample `sample_index` of each, with the
/// photon map `photons` whatever its iteration (in an adaptive round, the pass's map `j` serves
/// sample `j` of every block, so a map's iteration is not its blocks' sample index). The pixels
/// are those [`render_tile_edges`] gives for the same sample index and map.
#[allow(clippy::too_many_arguments)]
pub fn render_block(
    scene: &Scene,
    prepared: &Prepared,
    photons: Option<&PhotonMap>,
    edges: &EdgeMask,
    rect: TileRect,
    sample_index: u32,
    film: &mut Film,
    isa: Isa,
) -> u64 {
    let tracer = BvhTracer {
        geometry: &scene.geometry,
        isa,
    };
    let photons = photons.filter(|_| prepared.has_caustics());
    render_tile_traced(
        scene,
        prepared,
        rect,
        sample_index,
        film,
        &tracer,
        photons,
        Some(edges),
    )
}

/// The sample indices of sample `sample_index` of a pixel that takes `k` per index (E11): `k`
/// consecutive ones of its sequence (wrapping past `u32::MAX`, far beyond any host's samples).
#[inline]
fn sub_sample(sample_index: u32, k: u32, j: u32) -> u32 {
    sample_index.wrapping_mul(k).wrapping_add(j)
}

/// The body of the tile renderers, generic over how rays are traced.
#[allow(clippy::too_many_arguments)]
fn render_tile_traced<T: Tracer>(
    scene: &Scene,
    prepared: &Prepared,
    tile: TileRect,
    sample_index: u32,
    film: &mut Film,
    tracer: &T,
    photons: Option<&PhotonMap>,
    edges: Option<&EdgeMask>,
) -> u64 {
    let (width, height) = (scene.render.width, scene.render.height);
    let x_end = tile.x.saturating_add(tile.w).min(width);
    let y_end = tile.y.saturating_add(tile.h).min(height);
    let mut rays = 0u64;
    // O2: through a traced lens, the camera samples of a row's pixels that take one sample are
    // traced together first (the same bits as one by one).
    let batched = camera_batches(scene);
    let mut row_pixels: Vec<(u32, u32)> = Vec::new();
    let mut row_samples: Vec<CameraSample> = Vec::new();
    for y in tile.y..y_end {
        if batched {
            row_pixels.clear();
            row_pixels.extend(
                (tile.x..x_end)
                    .filter(|&x| edges.map_or(1, |e| e.factor_at(x, y)) <= 1)
                    .map(|x| (x, y)),
            );
            camera_samples(scene, &row_pixels, sample_index, &mut row_samples);
        }
        let mut next = row_samples.drain(..);
        for x in tile.x..x_end {
            // One camera sample of index `index`: its radiance times its weight, and its alpha.
            // O3a: with the lens's filters, their scattering and their connections to the lights
            // the camera sees, weighted against each other (multiple importance sampling).
            let shade = |index: u32, sample: CameraSample, rays: &mut u64| -> (Rgb, f32) {
                let sampler = PixelSampler::new(scene.render.seed, x, y, index);
                let (ray, screen, weight, path) = sample;
                match (&path, scene.camera.lens.as_ref()) {
                    (Some(path), Some(lens)) if lens.connects() => {
                        let lights = prepared.lights().camera_lights();
                        let weight_of = |i: usize| lens.crossed_weight(path, lights, i);
                        let (c, alpha) = radiance_weighted(
                            scene,
                            prepared,
                            tracer,
                            &sampler,
                            ray,
                            screen,
                            photons,
                            Some(&weight_of),
                            rays,
                        );
                        let mut sum = c * weight;
                        for i in 0..lens.filters().len() {
                            if let Some((to, light, w)) = lens.connection(path, lights, i) {
                                *rays += 1;
                                let t_geometry = tracer.trace(&to).map_or(f32::INFINITY, |h| h.t);
                                let t = t_geometry.min(prepared.floor_t(&to, true));
                                sum += prepared.lights().camera_light_radiance(light, &to, t) * w;
                            }
                        }
                        (sum, alpha)
                    }
                    _ => {
                        let (c, alpha) = radiance_with(
                            scene, prepared, tracer, &sampler, ray, screen, photons, rays,
                        );
                        (c * weight, alpha)
                    }
                }
            };
            let one = |index: u32, rays: &mut u64| -> (Rgb, f32) {
                let sampler = PixelSampler::new(scene.render.seed, x, y, index);
                shade(index, camera_sample_filtered(scene, &sampler, x, y), rays)
            };
            let k = edges.map_or(1, |e| e.factor_at(x, y));
            if k <= 1 {
                let (c, alpha) = match batched.then(|| next.next()).flatten() {
                    Some(sample) => shade(sample_index, sample, &mut rays),
                    None => one(sample_index, &mut rays),
                };
                film.splat_alpha(x, y, c, alpha);
                continue;
            }
            // An edge pixel: the mean of its k samples of this index, splatted once.
            let (mut sum, mut coverage) = (Rgb::BLACK, 0.0f32);
            for j in 0..k {
                let (c, alpha) = one(sub_sample(sample_index, k, j), &mut rays);
                sum += c;
                coverage += alpha;
            }
            let inv = 1.0 / k as f32;
            film.splat_alpha(x, y, sum * inv, coverage * inv);
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

/// Adds to `film` the albedo and the alpha of sample `sample_index` of every pixel of `tile`,
/// clipped to the image: the base colour ([`albedo_of`]) and the coverage ([`coverage_of`]) of
/// what the sample's camera ray (the same position in the pixel and point on the lens as the
/// image's sample) meets first. One ray serves both. Returns the rays cast (one per pixel, none
/// when the film has neither pass).
pub fn render_tile_albedo(
    scene: &Scene,
    prepared: &Prepared,
    tile: TileRect,
    sample_index: u32,
    film: &mut PassFilm,
    isa: Isa,
) -> u64 {
    render_tile_albedo_traced(scene, prepared, tile, sample_index, film, isa, None)
}

/// [`render_tile_albedo`] with the edge samples of E11, as [`render_tile_edges`] renders the
/// image: an edge pixel adds the mean albedo of its `k` samples of `sample_index`.
pub fn render_tile_albedo_edges(
    scene: &Scene,
    prepared: &Prepared,
    edges: &EdgeMask,
    sample_index: u32,
    film: &mut PassFilm,
    isa: Isa,
) -> u64 {
    render_tile_albedo_traced(
        scene,
        prepared,
        edges.tile(),
        sample_index,
        film,
        isa,
        Some(edges),
    )
}

fn render_tile_albedo_traced(
    scene: &Scene,
    prepared: &Prepared,
    tile: TileRect,
    sample_index: u32,
    film: &mut PassFilm,
    isa: Isa,
    edges: Option<&EdgeMask>,
) -> u64 {
    if film.mask & PASS_SAMPLED == 0 {
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
            let k = edges.map_or(1, |e| e.factor_at(x, y));
            if k <= 1 {
                let sampler = PixelSampler::new(scene.render.seed, x, y, sample_index);
                let ray = camera_ray(scene, &sampler, x, y);
                rays += 1;
                let hit = first_hit(scene, prepared, &tracer, &ray);
                film.add_albedo(x, y, albedo_of(scene, hit));
                film.add_alpha(x, y, coverage_of(hit));
                continue;
            }
            let mut sum = Rgb::BLACK;
            let mut covered = 0.0f32;
            for j in 0..k {
                let index = sub_sample(sample_index, k, j);
                let sampler = PixelSampler::new(scene.render.seed, x, y, index);
                let ray = camera_ray(scene, &sampler, x, y);
                rays += 1;
                let hit = first_hit(scene, prepared, &tracer, &ray);
                sum += albedo_of(scene, hit);
                covered += coverage_of(hit);
            }
            let inv = 1.0 / k as f32;
            film.add_albedo(x, y, sum * inv);
            film.add_alpha(x, y, covered * inv);
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
        self.0
            .brute_force(ray, crate::geometry::RayClass::Secondary)
            .0
    }

    fn occluded(&self, ray: &Ray) -> bool {
        self.0.brute_force(ray, crate::geometry::RayClass::Shadow).1
    }

    fn trace_camera(&self, ray: &Ray) -> Option<crate::geometry::RayHit> {
        self.0.brute_force(ray, crate::geometry::RayClass::Camera).0
    }

    fn trace_shadow(&self, ray: &Ray) -> Option<crate::geometry::RayHit> {
        self.0.brute_force(ray, crate::geometry::RayClass::Shadow).0
    }

    fn trace_rough(&self, ray: &Ray) -> Option<crate::geometry::RayHit> {
        self.0.brute_force(ray, crate::geometry::RayClass::Rough).0
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
        None,
    )
}

#[cfg(test)]
mod passes_tests;

#[cfg(test)]
mod ambient_tests;

#[cfg(test)]
mod section_tests;

#[cfg(test)]
mod k3_tests;

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
    const PINNED_CENTRE: u32 = 0xe251_5c9a;
    /// Pinned hash of the tile over the small sphere of the example (sample 3).
    const PINNED_SMALL_SPHERE: u32 = 0x7b62_574d;

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
    pub(crate) const PINNED_EXAMPLE_4SPP: u32 = 0x75ba_4cb4;

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
    pub(crate) const PINNED_E5_HDRI_4SPP: u32 = 0xfdf0_c2ac;
    /// Pinned hash of the E5 example (sky) at 4 samples per pixel.
    pub(crate) const PINNED_E5_SKY_4SPP: u32 = 0x47fa_4eb7;

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
    pub(crate) const PINNED_E5C_SKY_4SPP: u32 = 0xf6fb_c84f;

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

    #[test]
    fn the_e9_media_have_a_pinned_hash_on_every_platform() {
        // E9b added scattering media and E9c dispersion. Scenes without either draw exactly the
        // numbers they drew before (the hashes above); this one walks a medium behind a rough
        // boundary and leaves it by exit vertices that sample the lights, and sends paths through
        // a crystal sphere at the wavelength they choose there, through an RSB round trip;
        // `tools/wasm-parity.mjs` checks the real module against it (`rt --write-e9-example`).
        let scene = crate::example::e9_scene();
        assert_eq!(Scene::from_rsb(&scene.to_rsb()).as_ref(), Ok(&scene));
        for isa in Isa::available() {
            let hash = scene_4spp_hash(&scene, isa);
            eprintln!("E9 example at 4 spp on {}: {hash:#010x}", isa.name());
            assert_eq!(hash, PINNED_E9_MEDIA_4SPP, "media on {}", isa.name());
        }
    }

    /// Pinned hash of the E9 example (scattering media and, since E9c, a dispersive crystal) at
    /// 4 samples per pixel (E9b: `0xc6c9_036e`, without the crystal).
    pub(crate) const PINNED_E9_MEDIA_4SPP: u32 = 0x5b5e_a281;

    /// Pinned hash of the E5b-1 example (caustics) at 4 samples per pixel.
    pub(crate) const PINNED_E5B_CAUSTICS_4SPP: u32 = 0x7135_df4b;

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
    pub(crate) const PINNED_O1_LENS_4SPP: u32 = 0x087d_1276;

    /// Renders all of `scene` as a host does with edge samples (E11): 32-pixel tiles, an
    /// [`EdgeMask`] per tile, samples `0..4`, and hashes the resolved film.
    pub(crate) fn scene_4spp_edges_hash(scene: &Scene, tile_size: u32, isa: Isa) -> u32 {
        let prepared = Prepared::new(scene);
        let (w, h) = (scene.render.width, scene.render.height);
        let mut film = Film::new(w, h);
        for tile in tile_grid(w, h, tile_size) {
            let edges = EdgeMask::of(scene, &prepared, tile, isa);
            for sample in 0..4 {
                render_tile_edges(scene, &prepared, None, &edges, sample, &mut film, isa);
            }
        }
        fnv1a(&film.resolve())
    }

    #[test]
    fn the_e11_example_has_a_pinned_hash_on_every_platform_and_for_any_tile_cut() {
        // E11: the example with the Blackman–Harris filter and twice the samples on its edges.
        // `tools/wasm-parity.mjs` checks the real module against it (`rt --write-e11-example`);
        // with the standard filter and no edge samples the example keeps PINNED_EXAMPLE_4SPP.
        let scene = crate::example::e11_scene();
        assert_eq!(Scene::from_rsb(&scene.to_rsb()).as_ref(), Ok(&scene));
        for isa in Isa::available() {
            let hash = scene_4spp_edges_hash(&scene, 32, isa);
            eprintln!("E11 example at 4 spp on {}: {hash:#010x}", isa.name());
            assert_eq!(hash, PINNED_E11_EDGES_4SPP, "on {}", isa.name());
        }
        assert_eq!(
            scene_4spp_edges_hash(&scene, 23, Isa::detect()),
            PINNED_E11_EDGES_4SPP
        );
        let mut plain = scene.clone();
        plain.render.pixel_filter = crate::pixel_filter::FILTER_STANDARD;
        plain.render.edge_supersample = 1;
        assert_eq!(
            scene_4spp_edges_hash(&plain, 32, Isa::detect()),
            PINNED_EXAMPLE_4SPP
        );
    }

    /// Pinned hash of the E11 example (fine filter, edges ×2) at 4 samples per pixel.
    pub(crate) const PINNED_E11_EDGES_4SPP: u32 = 0xd017_02ce;

    #[test]
    fn the_o3a_filters_have_a_pinned_hash_on_every_platform() {
        // O3a added the effect filters at the end of LENS: black diffusion, a six-point star and
        // a streak on a six-blade iris, with the bokeh lights of O1. Every hash above (O1's too)
        // stayed. Through an RSB round trip; `tools/wasm-parity.mjs` checks the real module
        // against it (`rt --write-o3a-example`).
        let scene = crate::example::o3a_scene();
        assert_eq!(Scene::from_rsb(&scene.to_rsb()).as_ref(), Ok(&scene));
        for isa in Isa::available() {
            let hash = scene_4spp_hash(&scene, isa);
            eprintln!("O3a example at 4 spp on {}: {hash:#010x}", isa.name());
            assert_eq!(
                hash,
                PINNED_O3A_FILTERS_4SPP,
                "O3a filters on {}",
                isa.name()
            );
        }
    }

    /// Pinned hash of the O3a example (the filter stack) at 4 samples per pixel.
    pub(crate) const PINNED_O3A_FILTERS_4SPP: u32 = 0x21e4_3bb1;

    #[test]
    fn the_e6_bevel_scene_has_a_pinned_hash_on_every_platform() {
        // E6 added the edge bevel of the shading (crate::bevel). The scene is CAD-like parts with
        // sharp edges, all bevelled: a two-tone box sent as two meshes with one transform (an
        // edge found across meshes) under a non-uniform scale, a metal cylinder (a curved edge of
        // 48 segments, smooth side normals) and a plate thinner than twice its bevel. Through an
        // RSB round trip; `tools/wasm-parity.mjs` checks the real module against it
        // (`rt --write-e6-example`). The scenes without a bevel kept their hashes (above).
        let scene = crate::example::e6_scene();
        assert_eq!(Scene::from_rsb(&scene.to_rsb()).as_ref(), Ok(&scene));
        for isa in Isa::available() {
            let hash = scene_4spp_hash(&scene, isa);
            eprintln!("E6 example at 4 spp on {}: {hash:#010x}", isa.name());
            assert_eq!(hash, PINNED_E6_BEVEL_4SPP, "bevel on {}", isa.name());
        }
        // Without its bevel the same scene is another image.
        let mut sharp = scene.clone();
        for m in &mut sharp.materials {
            m.bevel_mm = 0.0;
        }
        assert_ne!(scene_4spp_hash(&sharp, Isa::detect()), PINNED_E6_BEVEL_4SPP);
    }

    /// Pinned hash of the E6 example (edge bevel) at 4 samples per pixel.
    pub(crate) const PINNED_E6_BEVEL_4SPP: u32 = 0xeaca_ae75;

    #[test]
    fn the_e6_pattern_scene_has_a_pinned_hash_on_every_platform() {
        // E6 added the procedural patterns of the shading (crate::pattern): the colour, the
        // roughness and the relief of wood. Through an RSB round trip; `tools/wasm-parity.mjs`
        // checks the real module against it (`rt --write-e6-patterns-example`).
        let scene = crate::example::e6_patterns_scene();
        assert_eq!(Scene::from_rsb(&scene.to_rsb()).as_ref(), Ok(&scene));
        for isa in Isa::available() {
            let hash = scene_4spp_hash(&scene, isa);
            eprintln!("E6 patterns at 4 spp on {}: {hash:#010x}", isa.name());
            assert_eq!(hash, PINNED_E6_PATTERNS_4SPP, "patterns on {}", isa.name());
        }
        let mut flat = scene.clone();
        flat.patterns.clear();
        assert_ne!(
            scene_4spp_hash(&flat, Isa::detect()),
            PINNED_E6_PATTERNS_4SPP
        );
    }

    /// Pinned hash of the E6 pattern example at 4 samples per pixel.
    pub(crate) const PINNED_E6_PATTERNS_4SPP: u32 = 0x5ed1_bf32;

    #[test]
    fn the_e6_cloth_scene_has_a_pinned_hash_on_every_platform() {
        // E6, third part: cloth (crate::pattern::cloth), its colour and its relief, on a box
        // projection. Through an RSB round trip; `tools/wasm-parity.mjs` checks the real module
        // against it (`rt --write-e6-cloth-example`).
        let scene = crate::example::e6_cloth_scene();
        assert_eq!(Scene::from_rsb(&scene.to_rsb()).as_ref(), Ok(&scene));
        for isa in Isa::available() {
            let hash = scene_4spp_hash(&scene, isa);
            eprintln!("E6 cloth at 4 spp on {}: {hash:#010x}", isa.name());
            assert_eq!(hash, PINNED_E6_CLOTH_4SPP, "cloth on {}", isa.name());
        }
        let mut flat = scene.clone();
        flat.patterns.clear();
        assert_ne!(scene_4spp_hash(&flat, Isa::detect()), PINNED_E6_CLOTH_4SPP);
    }

    /// Pinned hash of the E6 cloth example at 4 samples per pixel.
    pub(crate) const PINNED_E6_CLOTH_4SPP: u32 = 0x53e6_a855;

    #[test]
    fn the_m2b_textures_have_a_pinned_hash_on_every_platform() {
        // M2b added the image textures and labels of the shading (crate::texture): the IMGS
        // images and their mipmaps, every projection, normal and height maps, a cut-out, an
        // emission image, labels with their paper edge and a textured emitter. Through an RSB
        // round trip; `tools/wasm-parity.mjs` checks the real module against it
        // (`rt --write-m2b-example`). Every hash above stayed: scenes without textures draw the
        // same bits.
        let scene = crate::example::m2b_scene();
        assert_eq!(Scene::from_rsb(&scene.to_rsb()).as_ref(), Ok(&scene));
        for isa in Isa::available() {
            let hash = scene_4spp_hash(&scene, isa);
            eprintln!("M2b example at 4 spp on {}: {hash:#010x}", isa.name());
            assert_eq!(hash, PINNED_M2B_TEXTURES_4SPP, "textures on {}", isa.name());
        }
        // Without its textures the same scene is another image.
        let mut plain = scene.clone();
        plain.textures.clear();
        assert_ne!(
            scene_4spp_hash(&plain, Isa::detect()),
            PINNED_M2B_TEXTURES_4SPP
        );
    }

    /// Pinned hash of the M2b texture example at 4 samples per pixel.
    pub(crate) const PINNED_M2B_TEXTURES_4SPP: u32 = 0x5d94_b21c;

    #[test]
    fn the_m3b_programs_have_a_pinned_hash_on_every_platform() {
        // M3b runs the material programs of node materials (crate::program): marble from a 3D
        // noise, checks by a box projection worn at the edges by the curvature with a constant
        // bevel weight, leather bumped by three evaluations of a noise, a label read from an
        // image with alpha and a bevel weight computed from a noise, a card cut out by stripes
        // with a normal map of flakes, an emitter checked on its UVs and a thin glass pane dusted
        // by Fresnel. Through an RSB round trip; `tools/wasm-parity.mjs` checks the real module
        // against it (`rt --write-m3b-example`). Every hash above stayed: scenes without
        // programs draw the same bits.
        let scene = crate::example::m3b_scene();
        assert_eq!(Scene::from_rsb(&scene.to_rsb()).as_ref(), Ok(&scene));
        for isa in Isa::available() {
            let hash = scene_4spp_hash(&scene, isa);
            eprintln!("M3b example at 4 spp on {}: {hash:#010x}", isa.name());
            assert_eq!(hash, PINNED_M3B_PROGRAMS_4SPP, "programs on {}", isa.name());
        }
        // Without its programs the same scene is another image.
        let mut plain = scene.clone();
        plain.programs.clear();
        assert_ne!(
            scene_4spp_hash(&plain, Isa::detect()),
            PINNED_M3B_PROGRAMS_4SPP
        );
    }

    /// Pinned hash of the M3b example (material programs) at 4 samples per pixel. C1 moved it
    /// from `0x0d6e_20ba`: the card's flakes (program 4, a noise colour into `NMAP`) have about
    /// half their blues below 0.5, and those normals are now mirrored out of the surface.
    pub(crate) const PINNED_M3B_PROGRAMS_4SPP: u32 = 0x90b4_2b6b;

    #[test]
    fn the_o2_traced_lens_has_a_pinned_hash_on_every_platform() {
        // O2 traced the camera rays through the double Gauss of the catalogue (f/2.8, seven
        // rounded blades, the bokeh lights of O1): the prescription at the end of LENS, prepared
        // when the scene is read. Every hash above stays. Through an RSB round trip (the traced
        // preparation included); `tools/wasm-parity.mjs` checks the real module against it
        // (`rt --write-o2-example`).
        let scene = crate::example::o2_scene();
        assert_eq!(Scene::from_rsb(&scene.to_rsb()).as_ref(), Ok(&scene));
        for isa in Isa::available() {
            let hash = scene_4spp_hash(&scene, isa);
            eprintln!("O2 example at 4 spp on {}: {hash:#010x}", isa.name());
            assert_eq!(
                hash,
                PINNED_O2_TRACED_4SPP,
                "O2 traced lens on {}",
                isa.name()
            );
        }
    }

    /// Pinned hash of the O2 example (the traced double Gauss) at 4 samples per pixel.
    pub(crate) const PINNED_O2_TRACED_4SPP: u32 = 0x8f7d_0ef8;

    #[test]
    fn the_o4_tilted_and_shifted_traced_lens_has_a_pinned_hash_on_every_platform() {
        // O4 tilted the traced double Gauss against the sensor (the angle solved for the simple
        // lens's plane, the centre refocused with real rays, the bounds on a grid of sensor
        // positions) and shifted it. Through an RSB round trip (the preparation included);
        // `tools/wasm-parity.mjs` checks the real module against it (`rt --write-o4-example`).
        // Every hash above stays: a lens without a tilt never takes the new path.
        let scene = crate::example::o4_scene();
        assert_eq!(Scene::from_rsb(&scene.to_rsb()).as_ref(), Ok(&scene));
        for isa in Isa::available() {
            let hash = scene_4spp_hash(&scene, isa);
            eprintln!("O4 example at 4 spp on {}: {hash:#010x}", isa.name());
            assert_eq!(
                hash,
                PINNED_O4_TRACED_TILT_4SPP,
                "O4 tilted traced lens on {}",
                isa.name()
            );
        }
        // Upright, the same scene is another image.
        assert_ne!(
            scene_4spp_hash(&crate::example::o2_scene(), Isa::detect()),
            PINNED_O4_TRACED_TILT_4SPP
        );
    }

    /// Pinned hash of the O4 example (the traced double Gauss tilted and shifted) at 4 samples
    /// per pixel.
    pub(crate) const PINNED_O4_TRACED_TILT_4SPP: u32 = 0x0b2f_c327;

    #[test]
    fn the_l5_ies_scene_has_a_pinned_hash_on_every_platform() {
        // L5: the example lit by its panel at a fifth of its power and by two IES lights, a sphere
        // of the symmetric downlight profile (next-event estimation and MIS) and a warm point of
        // the wall washer turned about its axis; the profiles travel as text in the `IESP`
        // sections and are read again when the scene is. Through an RSB round trip;
        // `tools/wasm-parity.mjs` checks the real module against it (`rt --write-l5-example`).
        // Every hash above stayed: no scene before L5 has an IES light.
        let scene = crate::example::l5_scene();
        assert_eq!(Scene::from_rsb(&scene.to_rsb()).as_ref(), Ok(&scene));
        for isa in Isa::available() {
            let hash = scene_4spp_hash(&scene, isa);
            eprintln!("L5 example at 4 spp on {}: {hash:#010x}", isa.name());
            assert_eq!(hash, PINNED_L5_IES_4SPP, "IES lights on {}", isa.name());
        }
        // Without its profiles the same scene is another image (the lights vanish).
        let mut plain = scene.clone();
        plain.lights.truncate(1);
        assert_ne!(scene_4spp_hash(&plain, Isa::detect()), PINNED_L5_IES_4SPP);
    }

    /// Pinned hash of the L5 example (two IES lights) at 4 samples per pixel.
    pub(crate) const PINNED_L5_IES_4SPP: u32 = 0x920f_0be1;

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
