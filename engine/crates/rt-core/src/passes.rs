//! The exact per-pixel passes written next to the image (phase X2, AI-POST.md §3.1 and §7.4):
//! what the AI post-processing guard leans on (`rt-post`), and later the render passes of N2.
//! The contract is `src/core/passes.ts`: one plane per pass, `width × height`, rows from the top
//! left like the image, in the order of [`PASS_KEYS`] (bit `i` of `RNDR.passes` is pass `i`).
//!
//! | Pass | Type | Content | Background |
//! | --- | --- | --- | --- |
//! | `albedo` | 3 × f32 | Base colour of the material at the first hit (no specular bounce is followed: glass gives its tint), averaged over the pixel's samples like the image | 0 |
//! | `normal` | 3 × f32 | Unit shading normal at the first hit, world space (Z up), turned towards the camera (both sides of a triangle count) | 0 |
//! | `depth` | f32 | Distance along the camera's view axis, scene units | +∞ |
//! | `partId` | u32 | RSB instance index + 1 (what `Scene::pick` finds); the studio floor [`FLOOR_ID`]; a particle of an ambient effect (S4a) the number of instances + the effect's index + 1 | 0 |
//! | `materialId` | u32 | RSB material index + 1 of that instance (of that effect for a particle); the floor [`FLOOR_ID`] | 0 |
//! | `coc` | f32 | Circle-of-confusion diameter in output pixels, of the thin lens ([`coc_diameter`]) | 0 (also without depth of field) |
//!
//! `normal`, `depth`, the ids and `coc` come from **one ray through the centre of the pixel,
//! without jitter, through the centre of the lens** ([`crate::render::centre_ray`]): they are
//! exact and never blend the two sides of an edge. `albedo` follows the camera ray of every
//! sample of the image (the same jitter and lens point) and is summed in sample order in `f32`
//! and divided like [`crate::image::Film::resolve`], so every host gets the same bits.
//!
//! The background (0) is what the guard never changes: the environment, the background colour
//! or image, transparency, and the light panels the camera sees ([`crate::integrator::FirstHit`]).
//! The studio floor is not background: its contact shadows and bounced light are what the AI may
//! improve. Every surface stops the pass ray, cut-outs included, as `pick` does. An instance
//! whose material index is outside the scene's materials (it renders with the default material)
//! has `materialId` 0.
//!
//! Computing passes never touches the image: they come from rays of their own, after the image's
//! samples, through [`crate::render::render_tile_exact`] and
//! [`crate::render::render_tile_albedo`].

use crate::color::Rgb;
use crate::integrator::FirstHit;
use crate::math::{Ray, Vec3};
use crate::scene::{Camera, Material, Scene};

/// Bit of the albedo pass.
pub const PASS_ALBEDO: u32 = 1 << 0;
/// Bit of the normal pass.
pub const PASS_NORMAL: u32 = 1 << 1;
/// Bit of the depth pass.
pub const PASS_DEPTH: u32 = 1 << 2;
/// Bit of the part id pass.
pub const PASS_PART_ID: u32 = 1 << 3;
/// Bit of the material id pass.
pub const PASS_MATERIAL_ID: u32 = 1 << 4;
/// Bit of the circle of confusion pass.
pub const PASS_COC: u32 = 1 << 5;
/// Every pass this engine knows.
pub const PASS_ALL: u32 = (1 << PASS_KEYS.len()) - 1;
/// The passes of the centre ray (all but the albedo).
pub const PASS_EXACT: u32 = PASS_ALL & !PASS_ALBEDO;

/// The pass names, in the order of their bits (`PASS_KEYS` of `src/core/passes.ts`). Stable:
/// passes are added at the end.
pub const PASS_KEYS: [&str; 6] = ["albedo", "normal", "depth", "partId", "materialId", "coc"];

/// Words (an `f32` or a `u32`) per pixel of each pass, in the order of [`PASS_KEYS`].
pub const PASS_CHANNELS: [usize; 6] = [3, 3, 1, 1, 1, 1];

/// `partId` and `materialId` of the studio floor (the `FLOR` plane, not an instance).
pub const FLOOR_ID: u32 = u32::MAX;

/// The mask of a comma-separated list of pass names (`albedo,depth`; empty: none). `Err` names
/// the first name that is not a pass.
pub fn mask_of_keys(text: &str) -> Result<u32, String> {
    let mut mask = 0;
    for key in text.split(',').map(str::trim).filter(|k| !k.is_empty()) {
        match PASS_KEYS.iter().position(|&k| k == key) {
            Some(i) => mask |= 1 << i,
            None => return Err(key.to_string()),
        }
    }
    Ok(mask)
}

/// The names of the known passes of `mask`, in order.
pub fn keys_of_mask(mask: u32) -> Vec<&'static str> {
    PASS_KEYS
        .iter()
        .enumerate()
        .filter(|(i, _)| mask & (1 << i) != 0)
        .map(|(_, &k)| k)
        .collect()
}

/// Words per pixel of every known pass in `mask` together.
pub fn words_per_pixel(mask: u32) -> usize {
    PASS_CHANNELS
        .iter()
        .enumerate()
        .filter(|(i, _)| mask & (1 << i) != 0)
        .map(|(_, &c)| c)
        .sum()
}

/// The circle of confusion of a point at `depth` along the view axis, as a diameter in pixels
/// of an image whose longer side is `long_side` pixels (`cocDiameter` of `src/core/lens-coc.ts`).
///
/// It follows the camera of [`Camera::generate_ray`]: the sensor sits `focal_mm` behind the lens,
/// the aperture is `focal_mm / fstop` wide, and every ray through the lens centre meets the focus
/// plane `focus_dist` along the axis. A point at depth `d` is spread, on the focus plane, over
/// `aperture × |d − focus_dist| / d`, and one output pixel covers
/// `sensor_mm / long_side × focus_dist / focal_mm` of that plane. Zero on the focus plane, for a
/// pinhole, an orthographic camera or no focus distance ([`Camera::lens_radius`] 0), and for a
/// depth that is not positive and finite (the background).
///
/// It stays the circle of the plain thin lens whatever the camera's optics (O1, the `LENS`
/// section): a round, untilted aperture of `focal_mm / fstop`, without the iris shape, the
/// squeeze or the tilt of [`crate::optics`].
pub fn coc_diameter(camera: &Camera, depth: f32, long_side: u32) -> f32 {
    if camera.lens_radius() <= 0.0 || !(depth > 0.0 && depth.is_finite()) {
        return 0.0;
    }
    let aperture = camera.focal_mm / camera.fstop;
    let on_focus_plane = aperture * (depth - camera.focus_dist).abs() / depth;
    let pixel_on_focus_plane =
        camera.sensor_mm / long_side.max(1) as f32 * (camera.focus_dist / camera.focal_mm);
    on_focus_plane / pixel_on_focus_plane
}

/// The passes of the centre ray of one pixel (all but the albedo).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Exact {
    /// Unit shading normal facing the camera (0 on the background).
    pub normal: Vec3,
    /// Distance along the view axis (+∞ on the background).
    pub depth: f32,
    /// RSB instance index + 1, [`FLOOR_ID`] or 0.
    pub part_id: u32,
    /// RSB material index + 1, [`FLOOR_ID`] or 0.
    pub material_id: u32,
    /// Circle of confusion in pixels.
    pub coc: f32,
}

impl Exact {
    /// What a pixel that sees nothing holds.
    pub const BACKGROUND: Exact = Exact {
        normal: Vec3::ZERO,
        depth: f32::INFINITY,
        part_id: 0,
        material_id: 0,
        coc: 0.0,
    };

    /// The exact passes of what the centre ray `ray` of a pixel met.
    pub fn of(scene: &Scene, ray: &Ray, hit: FirstHit) -> Exact {
        let (t, normal, part_id, material_id) = match hit {
            FirstHit::Background => return Exact::BACKGROUND,
            FirstHit::Floor { t, normal } => (t, normal, FLOOR_ID, FLOOR_ID),
            FirstHit::Surface {
                instance,
                t,
                normal,
            } => {
                let material = scene
                    .geometry
                    .material_of(instance)
                    .filter(|&m| (m as usize) < scene.materials.len())
                    .map_or(0, |m| m + 1);
                (t, normal, instance + 1, material)
            }
        };
        let camera = &scene.camera;
        let forward = camera.basis().0;
        // Along the axis from the camera's plane: the lens centre for a perspective camera (the
        // ray starts there), the point on the image plane for an orthographic one.
        let depth = t * ray.dir.dot(forward) + (ray.origin - camera.position).dot(forward);
        let long_side = scene.render.width.max(scene.render.height);
        Exact {
            normal,
            depth,
            part_id,
            material_id,
            coc: coc_diameter(camera, depth, long_side),
        }
    }
}

/// The albedo of what a camera ray met: the base colour of the instance's material (the default
/// material for an index out of range, as the renderer does), the floor's colour, or black.
pub fn albedo_of(scene: &Scene, hit: FirstHit) -> Rgb {
    match hit {
        FirstHit::Background => Rgb::BLACK,
        FirstHit::Floor { .. } => scene.floor.color,
        FirstHit::Surface { instance, .. } => scene
            .geometry
            .material_of(instance)
            .and_then(|m| scene.materials.get(m as usize))
            .map_or(Material::default().base_color, |m| m.base_color),
    }
}

/// The passes of (a region of) the image as they are being rendered: the exact planes as they
/// are written, the albedo as sums with their sample counts, like [`crate::image::Film`].
/// Coordinates given to it are in image space; pixels outside the region are ignored. Planes not
/// in `mask` are empty.
#[derive(Clone, Debug, PartialEq)]
pub struct PassFilm {
    /// Width of the region in pixels.
    pub width: u32,
    /// Height of the region in pixels.
    pub height: u32,
    /// Image-space x of the region's left column.
    pub origin_x: u32,
    /// Image-space y of the region's top row.
    pub origin_y: u32,
    /// The passes it holds (known bits of the mask it was made with).
    pub mask: u32,
    /// Summed albedo, 3 per pixel.
    pub albedo: Vec<f32>,
    /// Samples summed into each pixel's albedo.
    pub albedo_weight: Vec<f32>,
    /// Normal, 3 per pixel.
    pub normal: Vec<f32>,
    /// Depth per pixel (+∞ until written).
    pub depth: Vec<f32>,
    /// Part id per pixel.
    pub part_id: Vec<u32>,
    /// Material id per pixel.
    pub material_id: Vec<u32>,
    /// Circle of confusion per pixel.
    pub coc: Vec<f32>,
}

/// `n` values of `v` when `on`, else none.
fn plane<T: Clone>(on: bool, n: usize, v: T) -> Vec<T> {
    if on {
        vec![v; n]
    } else {
        Vec::new()
    }
}

impl PassFilm {
    /// An empty film of the passes in `mask` over the whole `width × height` image.
    pub fn new(width: u32, height: u32, mask: u32) -> PassFilm {
        PassFilm::region(0, 0, width, height, mask)
    }

    /// An empty film of the passes in `mask` over `width × height` pixels whose top-left pixel
    /// is `(origin_x, origin_y)` in image space. Everything starts as background.
    pub fn region(origin_x: u32, origin_y: u32, width: u32, height: u32, mask: u32) -> PassFilm {
        let mask = mask & PASS_ALL;
        let n = width as usize * height as usize;
        let has = |bit: u32| mask & bit != 0;
        PassFilm {
            width,
            height,
            origin_x,
            origin_y,
            mask,
            albedo: plane(has(PASS_ALBEDO), n * 3, 0.0),
            albedo_weight: plane(has(PASS_ALBEDO), n, 0.0),
            normal: plane(has(PASS_NORMAL), n * 3, 0.0),
            depth: plane(has(PASS_DEPTH), n, f32::INFINITY),
            part_id: plane(has(PASS_PART_ID), n, 0),
            material_id: plane(has(PASS_MATERIAL_ID), n, 0),
            coc: plane(has(PASS_COC), n, 0.0),
        }
    }

    /// Index of the image-space pixel `(x, y)`, or `None` outside of the region.
    #[inline]
    fn index(&self, x: u32, y: u32) -> Option<usize> {
        let lx = x.checked_sub(self.origin_x)?;
        let ly = y.checked_sub(self.origin_y)?;
        (lx < self.width && ly < self.height)
            .then(|| ly as usize * self.width as usize + lx as usize)
    }

    /// Adds one sample's albedo `c` to pixel `(x, y)` (nothing without the albedo pass).
    #[inline]
    pub fn add_albedo(&mut self, x: u32, y: u32, c: Rgb) {
        if self.mask & PASS_ALBEDO == 0 {
            return;
        }
        if let Some(i) = self.index(x, y) {
            self.albedo[i * 3] += c.r;
            self.albedo[i * 3 + 1] += c.g;
            self.albedo[i * 3 + 2] += c.b;
            self.albedo_weight[i] += 1.0;
        }
    }

    /// Writes the exact passes of pixel `(x, y)` (those in the mask).
    #[inline]
    pub fn set_exact(&mut self, x: u32, y: u32, e: &Exact) {
        let Some(i) = self.index(x, y) else {
            return;
        };
        if self.mask & PASS_NORMAL != 0 {
            self.normal[i * 3..i * 3 + 3].copy_from_slice(&[e.normal.x, e.normal.y, e.normal.z]);
        }
        if self.mask & PASS_DEPTH != 0 {
            self.depth[i] = e.depth;
        }
        if self.mask & PASS_PART_ID != 0 {
            self.part_id[i] = e.part_id;
        }
        if self.mask & PASS_MATERIAL_ID != 0 {
            self.material_id[i] = e.material_id;
        }
        if self.mask & PASS_COC != 0 {
            self.coc[i] = e.coc;
        }
    }

    /// The finished passes of the region: the albedo divided by its sample count as
    /// [`crate::image::Film::resolve`] divides (the sum times the `f32` reciprocal; black for a
    /// pixel without samples), the exact planes as they are.
    pub fn resolve(&self) -> Passes {
        let mut albedo = vec![0.0; self.albedo.len()];
        for (i, &w) in self.albedo_weight.iter().enumerate() {
            if w > 0.0 {
                let inv = 1.0 / w;
                for c in 0..3 {
                    albedo[i * 3 + c] = self.albedo[i * 3 + c] * inv;
                }
            }
        }
        Passes {
            width: self.width,
            height: self.height,
            mask: self.mask,
            albedo,
            normal: self.normal.clone(),
            depth: self.depth.clone(),
            part_id: self.part_id.clone(),
            material_id: self.material_id.clone(),
            coc: self.coc.clone(),
        }
    }
}

/// The finished passes of an image (or a region of it): one plane per pass of `mask`, rows from
/// the top left, the others empty.
#[derive(Clone, Debug, PartialEq)]
pub struct Passes {
    /// Width in pixels.
    pub width: u32,
    /// Height in pixels.
    pub height: u32,
    /// The passes present (known bits only).
    pub mask: u32,
    /// Albedo, 3 per pixel.
    pub albedo: Vec<f32>,
    /// Normal, 3 per pixel.
    pub normal: Vec<f32>,
    /// Depth per pixel.
    pub depth: Vec<f32>,
    /// Part id per pixel.
    pub part_id: Vec<u32>,
    /// Material id per pixel.
    pub material_id: Vec<u32>,
    /// Circle of confusion per pixel.
    pub coc: Vec<f32>,
}

impl Passes {
    /// Background everywhere: the passes of `mask` over a `width × height` image.
    pub fn new(width: u32, height: u32, mask: u32) -> Passes {
        PassFilm::new(width, height, mask).resolve()
    }

    /// Copies the resolved `region`, whose top-left pixel is `(x, y)` of this image, into it
    /// (the pixels of the region outside the image are left out). Only the passes both hold.
    pub fn copy_region(&mut self, x: u32, y: u32, region: &Passes) {
        let (w, h) = (self.width as usize, self.height as usize);
        let rw = region.width as usize;
        let copy = |dst: &mut Vec<f32>, src: &[f32], channels: usize| {
            if dst.is_empty() || src.is_empty() {
                return;
            }
            for ly in 0..region.height as usize {
                let gy = y as usize + ly;
                if gy >= h {
                    break;
                }
                let gx = x as usize;
                if gx >= w {
                    break;
                }
                let n = rw.min(w - gx) * channels;
                let to = (gy * w + gx) * channels;
                let from = ly * rw * channels;
                dst[to..to + n].copy_from_slice(&src[from..from + n]);
            }
        };
        copy(&mut self.albedo, &region.albedo, 3);
        copy(&mut self.normal, &region.normal, 3);
        copy(&mut self.depth, &region.depth, 1);
        copy(&mut self.coc, &region.coc, 1);
        let copy_ids = |dst: &mut Vec<u32>, src: &[u32]| {
            if dst.is_empty() || src.is_empty() {
                return;
            }
            for ly in 0..region.height as usize {
                let (gy, gx) = (y as usize + ly, x as usize);
                if gy >= h || gx >= w {
                    break;
                }
                let n = rw.min(w - gx);
                dst[gy * w + gx..gy * w + gx + n].copy_from_slice(&src[ly * rw..ly * rw + n]);
            }
        };
        copy_ids(&mut self.part_id, &region.part_id);
        copy_ids(&mut self.material_id, &region.material_id);
    }

    /// The planes of `mask` (known bits) as 4-byte words, in the order of [`PASS_KEYS`].
    pub fn planes(&self) -> Vec<Plane<'_>> {
        let all = [
            Plane::F32(&self.albedo),
            Plane::F32(&self.normal),
            Plane::F32(&self.depth),
            Plane::U32(&self.part_id),
            Plane::U32(&self.material_id),
            Plane::F32(&self.coc),
        ];
        all.into_iter()
            .enumerate()
            .filter(|(i, _)| self.mask & (1 << i) != 0)
            .map(|(_, p)| p)
            .collect()
    }

    /// Bytes of every plane together.
    pub fn byte_len(&self) -> usize {
        self.width as usize * self.height as usize * words_per_pixel(self.mask) * 4
    }

    /// Appends every plane, little-endian, in the order of [`PASS_KEYS`].
    pub fn write_planes(&self, out: &mut Vec<u8>) {
        out.reserve(self.byte_len());
        for plane in self.planes() {
            plane.write(out);
        }
    }
}

/// One pass plane, borrowed.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Plane<'a> {
    /// Floats (albedo, normal, depth, coc).
    F32(&'a [f32]),
    /// Ids.
    U32(&'a [u32]),
}

impl Plane<'_> {
    /// Appends the plane's words, little-endian.
    pub fn write(&self, out: &mut Vec<u8>) {
        match self {
            Plane::F32(v) => v
                .iter()
                .for_each(|x| out.extend_from_slice(&x.to_le_bytes())),
            Plane::U32(v) => v
                .iter()
                .for_each(|x| out.extend_from_slice(&x.to_le_bytes())),
        }
    }

    /// FNV-1a over the little-endian bytes of the words (the hash the parity tests pin).
    pub fn fnv1a(&self) -> u32 {
        let mut hash = 0x811c_9dc5u32;
        let mut eat = |word: [u8; 4]| {
            for byte in word {
                hash = (hash ^ u32::from(byte)).wrapping_mul(0x0100_0193);
            }
        };
        match self {
            Plane::F32(v) => v.iter().for_each(|x| eat(x.to_le_bytes())),
            Plane::U32(v) => v.iter().for_each(|x| eat(x.to_le_bytes())),
        }
        hash
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn masks_follow_the_order_of_the_keys() {
        assert_eq!(PASS_ALL, 0b11_1111);
        assert_eq!(PASS_EXACT, 0b11_1110);
        assert_eq!(mask_of_keys(""), Ok(0));
        assert_eq!(mask_of_keys("albedo"), Ok(PASS_ALBEDO));
        assert_eq!(
            mask_of_keys("coc, partId,depth"),
            Ok(PASS_COC | PASS_PART_ID | PASS_DEPTH)
        );
        assert_eq!(
            mask_of_keys(&PASS_KEYS.join(",")),
            Ok(PASS_ALL),
            "every key"
        );
        assert_eq!(mask_of_keys("albedo,shadow"), Err("shadow".into()));
        assert_eq!(mask_of_keys("PartId"), Err("PartId".into()), "case matters");
        assert_eq!(
            keys_of_mask(PASS_NORMAL | PASS_COC | 1 << 9),
            ["normal", "coc"]
        );
        assert_eq!(words_per_pixel(PASS_ALL), 10);
        assert_eq!(words_per_pixel(PASS_ALBEDO | PASS_PART_ID), 4);
        assert_eq!(words_per_pixel(1 << 20), 0, "unknown bits hold nothing");
    }

    #[test]
    fn a_pass_film_starts_as_background_and_resolves_like_the_film() {
        let mut f = PassFilm::region(10, 20, 2, 2, PASS_ALL | 1 << 12);
        assert_eq!(f.mask, PASS_ALL, "unknown bits are dropped");
        let r = f.resolve();
        assert!(r.depth.iter().all(|d| *d == f32::INFINITY));
        assert!(r
            .albedo
            .iter()
            .chain(&r.normal)
            .chain(&r.coc)
            .all(|v| *v == 0.0));
        assert!(r.part_id.iter().chain(&r.material_id).all(|v| *v == 0));
        // Three samples of the albedo: the sum times the f32 reciprocal of three, as a film.
        for c in [0.1, 0.7, 0.3] {
            f.add_albedo(11, 21, Rgb::new(c, 2.0 * c, 0.5));
        }
        f.add_albedo(9, 20, Rgb::WHITE); // outside: ignored
        let sum = 0.1f32 + 0.7 + 0.3;
        assert_eq!(f.resolve().albedo[9], sum * (1.0 / 3.0));
        assert_eq!(f.albedo_weight, [0.0, 0.0, 0.0, 3.0]);
        f.set_exact(
            10,
            20,
            &Exact {
                normal: Vec3::new(0.0, 0.0, 1.0),
                depth: 12.5,
                part_id: 3,
                material_id: FLOOR_ID,
                coc: 1.5,
            },
        );
        let r = f.resolve();
        assert_eq!(
            (r.depth[0], r.part_id[0], r.material_id[0], r.coc[0]),
            (12.5, 3, FLOOR_ID, 1.5)
        );
        assert_eq!(r.normal[..3], [0.0, 0.0, 1.0]);
        // Only the planes asked for exist.
        let only = PassFilm::new(4, 4, PASS_DEPTH).resolve();
        assert_eq!(
            (only.depth.len(), only.albedo.len(), only.part_id.len()),
            (16, 0, 0)
        );
        assert_eq!(only.byte_len(), 64);
    }

    #[test]
    fn regions_assemble_into_the_image_and_planes_go_out_in_key_order() {
        let mut whole = Passes::new(3, 2, PASS_ALL);
        let mut tile = PassFilm::region(2, 0, 2, 2, PASS_ALL);
        let e = Exact {
            normal: Vec3::new(1.0, 0.0, 0.0),
            depth: 4.0,
            part_id: 7,
            material_id: 2,
            coc: 0.25,
        };
        tile.set_exact(2, 1, &e);
        tile.set_exact(3, 1, &e); // beyond the image's right edge
        tile.add_albedo(2, 1, Rgb::new(0.5, 0.25, 1.0));
        whole.copy_region(2, 0, &tile.resolve());
        assert_eq!(whole.part_id, [0, 0, 0, 0, 0, 7]);
        assert_eq!(whole.depth[5], 4.0);
        assert_eq!(whole.depth[2], f32::INFINITY);
        assert_eq!(whole.albedo[15..18], [0.5, 0.25, 1.0]);
        let mut bytes = Vec::new();
        whole.write_planes(&mut bytes);
        assert_eq!(bytes.len(), whole.byte_len());
        assert_eq!(bytes.len(), 6 * 10 * 4);
        // The part ids come after albedo (18 words), normal (18) and depth (6).
        let at = |w: usize| u32::from_le_bytes(bytes[w * 4..w * 4 + 4].try_into().unwrap());
        assert_eq!(at(18 + 18 + 6 + 5), 7);
        assert_eq!(f32::from_bits(at(18 + 18 + 5)), 4.0);
        assert_eq!(whole.planes().len(), 6);
        assert_ne!(whole.planes()[3].fnv1a(), Plane::U32(&[0; 6]).fnv1a());
    }

    #[test]
    fn the_circle_of_confusion_is_zero_in_focus_and_without_a_lens() {
        let camera = Camera {
            focal_mm: 50.0,
            sensor_mm: 36.0,
            fstop: 2.0,
            focus_dist: 1000.0,
            ..Camera::default()
        };
        assert_eq!(coc_diameter(&camera, 1000.0, 1920), 0.0);
        // A point twice as far: aperture 25 mm × 1/2 = 12.5 mm on the focus plane, where a pixel
        // covers 36 / 1920 × 1000 / 50 = 0.375 mm: 33.3 pixels.
        let c = coc_diameter(&camera, 2000.0, 1920);
        assert!((c - 12.5 / 0.375).abs() < 1.0e-3, "{c}");
        assert_eq!(coc_diameter(&camera, f32::INFINITY, 1920), 0.0);
        assert_eq!(coc_diameter(&camera, 0.0, 1920), 0.0);
        assert_eq!(coc_diameter(&camera, -5.0, 1920), 0.0);
        for pinhole in [
            Camera {
                fstop: 0.0,
                ..camera.clone()
            },
            Camera {
                focus_dist: 0.0,
                ..camera.clone()
            },
            Camera {
                ortho: true,
                ..camera.clone()
            },
        ] {
            assert_eq!(coc_diameter(&pinhole, 2000.0, 1920), 0.0);
        }
    }
}
