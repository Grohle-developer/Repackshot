//! Rain, dust and snow on the parts (phase S3c) as the renderer shades them: the RSB `WETP`
//! section, one per wet instance, which the page writes from the frame of a recorded simulation
//! (`rt_phys::wet_parts`) that the pose shows.
//!
//! **The samples.** Every triangle of the instance's mesh carries a grid of `R` steps per side
//! (its `resolution`, 1 to [`MAX_RESOLUTION`]): the samples `(i, j)`, `i + j ≤ R`, at the
//! barycentric weights `(1 − (i + j)/R, i/R, j/R)` of its corners, row `j` after row `j − 1`
//! ([`sample_index`]). Each holds three bytes: wet (0..255 for 0..1), the share under dust (0..255
//! for 0..1) and the depth of snow ([`SNOW_STEP_MM`] per step). A hit reads them linearly over the
//! small triangle of the grid it falls in, so neighbouring samples blend and the edges of a trail
//! are as soft as the grid.
//!
//! **The layers** ([`weathered`], a proposal for the lead's verdict: rule 11, ◆ in the roadmap's
//! S3c). Over the material as its patterns, program and textures leave it, from the bottom up:
//! **dust** mixes the surface towards a dry grey dust ([`DUST_ALBEDO`], rough, not metal, not clear),
//! darker where it is wet; **wet** is a film of water: a smooth clear coat over everything
//! ([`WET_COAT_ROUGHNESS`]), and a porous material (the instance's `porosity`, from the family of its
//! material) darker, its albedo raised to `1 + wet × porosity × WET_DARKEN` (Lekner and Dorf, "Why
//! some things are darker when wet", Applied Optics 27 (1988): the water in the pores lets less
//! light back out); **snow** covers it with a white, rough, diffuse layer as it gets deeper
//! (`1 − e^(−depth / SNOW_COVER_MM)`). Where all three are 0 the material is not touched: an
//! instance without water, dust or snow renders bit for bit as without the section.
//!
//! **The drops** are caps of water: each a part of the sphere of radius `a / sin θ` cut by the
//! tangent plane of its point on the surface, at the contact angle `θ` of the instance, its
//! contact circle of radius `a`. The reader meshes them all ([`cap_mesh`]: [`CAP_SEGMENTS`] around
//! by [`CAP_RINGS`] rings, the sphere's normals) in world space as one more mesh, with one more
//! instance and one more material (water, [`water`]) after the file's: the instance index of a drop
//! in the part and material passes is the file's instances' count (the particles of the ambient
//! effects come after it). The caps are crossed straight by shadow rays, as the small clear
//! particles of S4b are, so a drop does not cast a black disc on the surface under it.
//!
//! **S3d.** In the part and material passes a drop counts as the instance it lies on (its part),
//! not as the caps' instance ([`crate::scene::Scene::pass_instance`]). The drops **in the air** (a
//! drip falling, the drops a splash threw: the `WETF` section, [`FallingDrop`]) are spheres of
//! water in world space, meshed in the same mesh after the caps ([`SPHERE_SEGMENTS`] around by
//! [`SPHERE_RINGS`] bands), with the same water and the same straight shadows, and in the passes
//! each counts as the instance it left.

use crate::color::Rgb;
use crate::fmath;
use crate::geometry::{Hit, Mesh};
use crate::math::Vec3;
use crate::scene::{Material, Scene, MATERIAL_EMISSIVE, MATERIAL_GLASS};

/// The bytes of a `WETP` section's header.
pub const WETP_HEADER: usize = 24;
/// Most steps of a triangle's grid per side.
pub const MAX_RESOLUTION: u32 = 255;
/// Most drops of all the instances together.
pub const MAX_WET_DROPS: usize = 4096;
/// The depth of snow one step of its byte stands for, mm (255 steps: 5.1 mm).
pub const SNOW_STEP_MM: f32 = 0.02;
/// The depth of snow that covers 63 % of a surface, mm (◆).
pub const SNOW_COVER_MM: f32 = 0.5;
/// The roughness of the film of water on a wet surface (◆).
pub const WET_COAT_ROUGHNESS: f32 = 0.03;
/// How much darker a soaked porous albedo gets: its exponent grows by this at full wetness (◆).
pub const WET_DARKEN: f32 = 1.0;
/// The colour of dry dust, linear (◆: a light, warm grey).
pub const DUST_ALBEDO: Rgb = Rgb::new(0.42, 0.39, 0.35);
/// The roughness of a surface under dust (◆).
pub const DUST_ROUGHNESS: f32 = 0.9;
/// The albedo of snow (◆).
pub const SNOW_ALBEDO: f32 = 0.9;
/// The roughness of snow (◆).
pub const SNOW_ROUGHNESS: f32 = 0.85;
/// The index of refraction of water.
pub const WATER_IOR: f32 = 1.333;
/// Segments around a drop's cap.
pub const CAP_SEGMENTS: u32 = 16;
/// Rings of a drop's cap from its top to its contact circle.
pub const CAP_RINGS: u32 = 4;
/// Triangles of a drop's cap.
pub const CAP_TRIANGLES: u32 = CAP_SEGMENTS * (2 * CAP_RINGS - 1);
/// S3d: segments around a drop in the air (a sphere).
pub const SPHERE_SEGMENTS: u32 = 12;
/// S3d: bands of a drop in the air from pole to pole.
pub const SPHERE_RINGS: u32 = 6;
/// S3d: triangles of a drop in the air.
pub const SPHERE_TRIANGLES: u32 = 2 * SPHERE_SEGMENTS * (SPHERE_RINGS - 1);
/// S3d: the bytes of a `WETF` section's header (its count).
pub const WETF_HEADER: usize = 4;
/// S3d: the bytes of a drop in the air in a `WETF` section.
pub const WETF_DROP_BYTES: usize = 20;
/// S3d: most drops in the air of a scene.
pub const MAX_FALLING_DROPS: usize = 4096;
/// S3d: the instance of a drop in the air that left no instance of the file.
pub const NO_INSTANCE: u32 = u32::MAX;

/// The index of sample `(i, j)` of a triangle of resolution `r` among its samples (the order of
/// `rt_phys::wet_parts`).
pub fn sample_index(r: u32, i: u32, j: u32) -> u32 {
    j * (r + 1) - j * j.saturating_sub(1) / 2 + i
}

/// Samples of a triangle of resolution `r`.
pub fn samples_of(r: u32) -> u32 {
    (r + 1) * (r + 2) / 2
}

/// A drop of water on an instance: on its mesh's triangle `triangle`, at `position` (the instance's
/// object space), contact radius `radius` mm.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct WetDrop {
    /// Its triangle in the mesh.
    pub triangle: u32,
    /// Its centre on the surface, object space.
    pub position: Vec3,
    /// Its contact radius, mm.
    pub radius: f32,
}

/// S3d: a drop of water in the air (a drip, a splash's drop): a sphere at `position` (world space)
/// of `radius` mm, which left instance `instance` (or [`NO_INSTANCE`]).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct FallingDrop {
    /// The instance it left (its index among the `INST` sections), or [`NO_INSTANCE`].
    pub instance: u32,
    /// Its centre, world space.
    pub position: Vec3,
    /// Its radius, mm.
    pub radius: f32,
}

/// S3d: the drops in the air of a scene, the payload of its `WETF` section (at most one):
///
/// ```text
/// off  type  field
///   0  u32   drops
///   4        (u32 instance; f32 x y z radius)[drops]   (world space; radius 0..50 mm;
///                                                       instance 0xffffffff: none)
/// ```
///
/// Trailing bytes are ignored (a newer writer's).
pub fn decode_falling(p: &[u8]) -> Result<Vec<FallingDrop>, &'static str> {
    let word = |at: usize| -> Result<u32, &'static str> {
        p.get(at..at + 4)
            .map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]]))
            .ok_or("the section is cut short")
    };
    let n = word(0)? as usize;
    if n > MAX_FALLING_DROPS {
        return Err("too many drops in the air");
    }
    let mut out = Vec::with_capacity(n);
    for k in 0..n {
        let at = WETF_HEADER + WETF_DROP_BYTES * k;
        let f = |o: usize| word(at + o).map(f32::from_bits);
        let d = FallingDrop {
            instance: word(at)?,
            position: Vec3::new(f(4)?, f(8)?, f(12)?),
            radius: f(16)?,
        };
        if !d.position.is_finite() || !(d.radius > 0.0 && d.radius <= 50.0) {
            return Err("a drop in the air is out of its range");
        }
        out.push(d);
    }
    Ok(out)
}

/// S3d: the `WETF` payload of `drops`.
pub fn encode_falling(drops: &[FallingDrop]) -> Vec<u8> {
    let mut out = Vec::with_capacity(WETF_HEADER + WETF_DROP_BYTES * drops.len());
    out.extend_from_slice(&(drops.len() as u32).to_le_bytes());
    for d in drops {
        out.extend_from_slice(&d.instance.to_le_bytes());
        for v in [d.position.x, d.position.y, d.position.z, d.radius] {
            out.extend_from_slice(&v.to_bits().to_le_bytes());
        }
    }
    out
}

/// S3d: checks the drops in the air against the scene's instances: each names one of them (or
/// [`NO_INSTANCE`]), a finite point, a radius in 0..50 mm, at most [`MAX_FALLING_DROPS`].
pub fn check_falling(drops: &[FallingDrop], instances: usize) -> Result<(), &'static str> {
    if drops.len() > MAX_FALLING_DROPS {
        return Err("too many drops in the air");
    }
    for d in drops {
        if (d.instance != NO_INSTANCE && d.instance as usize >= instances)
            || !d.position.is_finite()
            || !(d.radius > 0.0 && d.radius <= 50.0)
        {
            return Err("a drop in the air is out of its range");
        }
    }
    Ok(())
}

/// What lies on a point of a surface: how wet it is, the share under dust and the share snow covers,
/// each 0..1.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Layers {
    /// Wet, 0..1.
    pub wet: f32,
    /// Under dust, 0..1.
    pub dust: f32,
    /// Covered by snow, 0..1 (from its depth).
    pub snow: f32,
}

impl Layers {
    /// Nothing on it.
    pub fn is_clear(&self) -> bool {
        self.wet <= 0.0 && self.dust <= 0.0 && self.snow <= 0.0
    }
}

/// The weather of one instance, the payload of a `WETP` section:
///
/// ```text
/// off  type  field
///   0  u32   instance        its index among the INST sections
///   4  u32   triangles       of the instance's mesh (they must agree)
///   8  u32   samples         the sum of (R + 1)(R + 2)/2 over the triangles
///  12  u32   drops
///  16  f32   cap_angle_deg   of its drops, 1..179
///  20  f32   porosity        how much a wet film darkens it, 0..1
///  24  u8    resolution[triangles] (1..255), zero padding to 4
///      u8    (wet dust snow)[samples], zero padding to 4
///      (u32 triangle; f32 x y z radius)[drops]   (object space; radius 0..50 mm)
/// ```
#[derive(Clone, Debug, PartialEq)]
pub struct PartWeather {
    /// Its index among the instances.
    pub instance: u32,
    /// The resolution of each triangle.
    pub resolution: Vec<u8>,
    /// Wet, dust and snow of each sample.
    pub values: Vec<[u8; 3]>,
    /// The contact angle its drops are capped at, degrees.
    pub cap_angle_deg: f32,
    /// How much its material darkens when wet, 0..1.
    pub porosity: f32,
    /// Its drops.
    pub drops: Vec<WetDrop>,
    /// The first sample of each triangle.
    first: Vec<u32>,
}

/// Bytes `n` rounded up to a multiple of 4.
fn padded(n: usize) -> usize {
    n.div_ceil(4) * 4
}

impl PartWeather {
    /// The weather of `instance`: its triangles' resolutions, their samples, its drops. Fails when
    /// the samples are not the resolutions', a resolution is out of 1..255, a value is not finite or
    /// out of its range.
    pub fn new(
        instance: u32,
        resolution: Vec<u8>,
        values: Vec<[u8; 3]>,
        cap_angle_deg: f32,
        porosity: f32,
        drops: Vec<WetDrop>,
    ) -> Result<PartWeather, &'static str> {
        let mut first = Vec::with_capacity(resolution.len());
        let mut total = 0u64;
        for &r in &resolution {
            if r == 0 || u32::from(r) > MAX_RESOLUTION {
                return Err("a triangle's resolution is out of 1..255");
            }
            first.push(total as u32);
            total += u64::from(samples_of(u32::from(r)));
        }
        if total != values.len() as u64 {
            return Err("the samples are not those of the triangles' resolutions");
        }
        if !(1.0..=179.0).contains(&cap_angle_deg) || !(0.0..=1.0).contains(&porosity) {
            return Err("the cap angle or the porosity is out of its range");
        }
        if drops.len() > MAX_WET_DROPS {
            return Err("too many drops");
        }
        for d in &drops {
            if d.triangle as usize >= resolution.len()
                || !d.position.is_finite()
                || !(d.radius > 0.0 && d.radius <= 50.0)
            {
                return Err("a drop is out of its range");
            }
        }
        Ok(PartWeather {
            instance,
            resolution,
            values,
            cap_angle_deg,
            porosity,
            drops,
            first,
        })
    }

    /// Reads a `WETP` payload (see the layout above). Trailing bytes are ignored (a newer writer's).
    pub fn decode(p: &[u8]) -> Result<PartWeather, &'static str> {
        let word = |at: usize| -> Result<u32, &'static str> {
            p.get(at..at + 4)
                .map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]]))
                .ok_or("the section is cut short")
        };
        let float = |at: usize| -> Result<f32, &'static str> {
            let v = f32::from_bits(word(at)?);
            if v.is_finite() {
                Ok(v)
            } else {
                Err("a value is not finite")
            }
        };
        let instance = word(0)?;
        let triangles = word(4)? as usize;
        let samples = word(8)? as usize;
        let drops = word(12)? as usize;
        let cap_angle_deg = float(16)?;
        let porosity = float(20)?;
        let res_end = WETP_HEADER
            .checked_add(padded(triangles))
            .ok_or("the section is cut short")?;
        let val_end = res_end
            .checked_add(padded(
                samples.checked_mul(3).ok_or("the section is cut short")?,
            ))
            .ok_or("the section is cut short")?;
        let end = val_end
            .checked_add(drops.checked_mul(20).ok_or("the section is cut short")?)
            .ok_or("the section is cut short")?;
        if p.len() < end {
            return Err("the section is cut short");
        }
        let resolution = p[WETP_HEADER..WETP_HEADER + triangles].to_vec();
        let values = p[res_end..res_end + 3 * samples]
            .chunks_exact(3)
            .map(|c| [c[0], c[1], c[2]])
            .collect();
        let mut list = Vec::with_capacity(drops);
        for k in 0..drops {
            let at = val_end + 20 * k;
            list.push(WetDrop {
                triangle: word(at)?,
                position: Vec3::new(float(at + 4)?, float(at + 8)?, float(at + 12)?),
                radius: float(at + 16)?,
            });
        }
        PartWeather::new(instance, resolution, values, cap_angle_deg, porosity, list)
    }

    /// The `WETP` payload.
    pub fn encode(&self) -> Vec<u8> {
        let mut out = Vec::new();
        for w in [
            self.instance,
            self.resolution.len() as u32,
            self.values.len() as u32,
            self.drops.len() as u32,
            self.cap_angle_deg.to_bits(),
            self.porosity.to_bits(),
        ] {
            out.extend_from_slice(&w.to_le_bytes());
        }
        out.extend_from_slice(&self.resolution);
        out.resize(WETP_HEADER + padded(self.resolution.len()), 0);
        for v in &self.values {
            out.extend_from_slice(v);
        }
        let len = out.len();
        out.resize(
            len + padded(3 * self.values.len()) - 3 * self.values.len(),
            0,
        );
        for d in &self.drops {
            out.extend_from_slice(&d.triangle.to_le_bytes());
            for v in [d.position.x, d.position.y, d.position.z, d.radius] {
                out.extend_from_slice(&v.to_bits().to_le_bytes());
            }
        }
        out
    }

    /// Triangles of its mesh.
    pub fn triangles(&self) -> usize {
        self.resolution.len()
    }

    /// True when nothing lies on it: no sample holds anything and there is no drop.
    pub fn is_clear(&self) -> bool {
        self.drops.is_empty() && self.values.iter().all(|v| *v == [0, 0, 0])
    }

    /// The layers at barycentric weights `bary` of triangle `triangle`: the samples of the small
    /// triangle of its grid the point falls in, blended linearly. `None` past its triangles.
    pub fn at(&self, triangle: u32, bary: [f32; 3]) -> Option<Layers> {
        let t = triangle as usize;
        let r = u32::from(*self.resolution.get(t)?);
        let first = self.first[t];
        let rf = r as f32;
        let x = (bary[1] * rf).clamp(0.0, rf);
        let y = (bary[2] * rf).clamp(0.0, rf);
        let mut i = (x.floor() as u32).min(r);
        let mut j = (y.floor() as u32).min(r);
        // On the far edge (x + y = R): the cell below it.
        while i + j + 1 > r {
            if i > 0 {
                i -= 1;
            } else {
                j -= 1;
            }
        }
        let (fx, fy) = (x - i as f32, y - j as f32);
        let get = |a: u32, b: u32| -> [f32; 3] {
            let v = self.values[(first + sample_index(r, a, b)) as usize];
            [f32::from(v[0]), f32::from(v[1]), f32::from(v[2])]
        };
        let mix = |p: [f32; 3], q: [f32; 3], s: [f32; 3], w: [f32; 3]| -> [f32; 3] {
            [
                p[0] * w[0] + q[0] * w[1] + s[0] * w[2],
                p[1] * w[0] + q[1] * w[1] + s[1] * w[2],
                p[2] * w[0] + q[2] * w[1] + s[2] * w[2],
            ]
        };
        let v = if fx + fy > 1.0 && i + j + 2 <= r {
            mix(
                get(i + 1, j + 1),
                get(i, j + 1),
                get(i + 1, j),
                [fx + fy - 1.0, 1.0 - fx, 1.0 - fy],
            )
        } else {
            let w0 = (1.0 - fx - fy).max(0.0);
            let sum = w0 + fx + fy;
            mix(
                get(i, j),
                get(i + 1, j),
                get(i, j + 1),
                [w0 / sum, fx / sum, fy / sum],
            )
        };
        let depth = v[2] * SNOW_STEP_MM;
        Some(Layers {
            wet: v[0] * (1.0 / 255.0),
            dust: v[1] * (1.0 / 255.0),
            snow: if depth > 0.0 {
                1.0 - fmath::exp(-depth / SNOW_COVER_MM)
            } else {
                0.0
            },
        })
    }
}

fn lerp(a: f32, b: f32, t: f32) -> f32 {
    a + (b - a) * t
}

/// `m` under the layers `l` of a surface whose wet film darkens it by `porosity` (see the
/// [module](self) documentation); `None` when nothing lies there or `m` is an emitter (it is shaded
/// as it is).
pub fn weathered(m: &Material, l: Layers, porosity: f32) -> Option<Material> {
    if l.is_clear() || m.kind == MATERIAL_EMISSIVE {
        return None;
    }
    let mut out = m.clone();
    let (wet, dust, snow) = (
        l.wet.clamp(0.0, 1.0),
        l.dust.clamp(0.0, 1.0),
        l.snow.clamp(0.0, 1.0),
    );
    // Dust: a dry grey layer, darker where it is wet (it is porous).
    if dust > 0.0 {
        let soaked = DUST_ALBEDO.map(|c| lerp(c, c * c, wet));
        out.base_color = Rgb::new(
            lerp(out.base_color.r, soaked.r, dust),
            lerp(out.base_color.g, soaked.g, dust),
            lerp(out.base_color.b, soaked.b, dust),
        );
        out.roughness = lerp(out.roughness, DUST_ROUGHNESS, dust);
        out.metallic *= 1.0 - dust;
        out.transmission *= 1.0 - dust;
        out.coat *= 1.0 - dust;
        out.anisotropy *= 1.0 - dust;
    }
    // The film of water: a smooth clear coat, and a porous albedo darker.
    if wet > 0.0 {
        let k = 1.0 + wet * porosity.clamp(0.0, 1.0) * WET_DARKEN;
        if k > 1.0 && out.metallic < 1.0 {
            let dark = out.base_color.map(|c| fmath::powf(c.clamp(0.0, 1.0), k));
            let m = out.metallic.clamp(0.0, 1.0);
            out.base_color = Rgb::new(
                lerp(dark.r, out.base_color.r, m),
                lerp(dark.g, out.base_color.g, m),
                lerp(dark.b, out.base_color.b, m),
            );
        }
        let coat = out.coat.max(wet);
        out.coat_roughness = if out.coat > 0.0 {
            out.coat_roughness
                .min(lerp(out.coat_roughness, WET_COAT_ROUGHNESS, wet))
        } else {
            WET_COAT_ROUGHNESS
        };
        out.coat = coat;
    }
    // Snow: white, rough, diffuse.
    if snow > 0.0 {
        out.base_color = out.base_color.map(|c| lerp(c, SNOW_ALBEDO, snow));
        out.roughness = lerp(out.roughness, SNOW_ROUGHNESS, snow);
        out.metallic *= 1.0 - snow;
        out.transmission *= 1.0 - snow;
        out.coat *= 1.0 - snow;
        out.anisotropy *= 1.0 - snow;
        if out.kind == MATERIAL_GLASS && out.transmission <= 0.0 {
            out.kind = crate::scene::MATERIAL_PRINCIPLED;
        }
    }
    Some(out)
}

/// The material of the drops: clear, smooth water.
pub fn water() -> Material {
    Material {
        kind: MATERIAL_GLASS,
        base_color: Rgb::WHITE,
        roughness: 0.0,
        ior: WATER_IOR,
        transmission: 1.0,
        ..Material::default()
    }
}

/// One drop's cap in world space: its centre on the surface, the surface's outward normal there
/// (unit), its contact radius and its contact angle.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Cap {
    /// Centre of the contact circle.
    pub centre: Vec3,
    /// Unit normal of the surface there.
    pub normal: Vec3,
    /// Contact radius, mm.
    pub radius: f32,
    /// Contact angle, degrees.
    pub angle_deg: f32,
}

/// The mesh of the caps (world space, the sphere's normals), `None` without any.
pub fn cap_mesh(caps: &[Cap]) -> Option<Mesh> {
    water_mesh(caps, &[])
}

/// S3d: the mesh of the caps and, after them, of the drops in the air (spheres: centre and
/// radius), world space: [`CAP_TRIANGLES`] triangles each cap, then [`SPHERE_TRIANGLES`] each
/// sphere; `None` without any.
pub fn water_mesh(caps: &[Cap], spheres: &[(Vec3, f32)]) -> Option<Mesh> {
    if caps.is_empty() && spheres.is_empty() {
        return None;
    }
    let per = 1 + CAP_RINGS * CAP_SEGMENTS;
    let per_sphere = 2 + (SPHERE_RINGS - 1) * SPHERE_SEGMENTS;
    let vertices = caps.len() * per as usize + spheres.len() * per_sphere as usize;
    let mut positions = Vec::with_capacity(vertices);
    let mut normals = Vec::with_capacity(vertices);
    let mut indices = Vec::new();
    let ring = |base: u32, r: u32, s: u32| base + 1 + (r - 1) * CAP_SEGMENTS + s % CAP_SEGMENTS;
    for c in caps {
        let n = c.normal;
        let helper = if n.z.abs() < 0.9 {
            Vec3::new(0.0, 0.0, 1.0)
        } else {
            Vec3::new(1.0, 0.0, 0.0)
        };
        let u = helper.cross(n).normalize();
        let v = n.cross(u);
        let theta = c.angle_deg.clamp(1.0, 179.0) * fmath::DEG_TO_RAD;
        let (st, ct) = fmath::sin_cos(theta);
        let big = c.radius / st;
        // The sphere's centre (below the plane for θ < 90°), lifted a hair off the surface.
        let lift = 1.0e-3 * c.radius;
        let centre = c.centre - n * (big * ct) + n * lift;
        let base = positions.len() as u32;
        positions.push(centre + n * big);
        normals.push(n);
        for r in 1..=CAP_RINGS {
            let phi = theta * r as f32 / CAP_RINGS as f32;
            let (sp, cp) = fmath::sin_cos(phi);
            for s in 0..CAP_SEGMENTS {
                let psi = std::f32::consts::TAU * s as f32 / CAP_SEGMENTS as f32;
                let (ss, cs) = fmath::sin_cos(psi);
                let dir = (u * cs + v * ss) * sp + n * cp;
                positions.push(centre + dir * big);
                normals.push(dir);
            }
        }
        for s in 0..CAP_SEGMENTS {
            indices.extend_from_slice(&[base, ring(base, 1, s), ring(base, 1, s + 1)]);
        }
        for r in 1..CAP_RINGS {
            for s in 0..CAP_SEGMENTS {
                let (a, b) = (ring(base, r, s), ring(base, r, s + 1));
                let (c2, d) = (ring(base, r + 1, s), ring(base, r + 1, s + 1));
                indices.extend_from_slice(&[a, c2, d, a, d, b]);
            }
        }
    }
    // S3d: the spheres, a pole at +Z, rings of latitude, a pole at −Z (wound outwards).
    let band =
        |base: u32, r: u32, s: u32| base + 1 + (r - 1) * SPHERE_SEGMENTS + s % SPHERE_SEGMENTS;
    for &(centre, radius) in spheres {
        let base = positions.len() as u32;
        let up = Vec3::new(0.0, 0.0, 1.0);
        positions.push(centre + up * radius);
        normals.push(up);
        for r in 1..SPHERE_RINGS {
            let phi = std::f32::consts::PI * r as f32 / SPHERE_RINGS as f32;
            let (sp, cp) = fmath::sin_cos(phi);
            for s in 0..SPHERE_SEGMENTS {
                let psi = std::f32::consts::TAU * s as f32 / SPHERE_SEGMENTS as f32;
                let (ss, cs) = fmath::sin_cos(psi);
                let dir = Vec3::new(sp * cs, sp * ss, cp);
                positions.push(centre + dir * radius);
                normals.push(dir);
            }
        }
        let bottom = positions.len() as u32;
        positions.push(centre - up * radius);
        normals.push(-up);
        for s in 0..SPHERE_SEGMENTS {
            indices.extend_from_slice(&[base, band(base, 1, s), band(base, 1, s + 1)]);
        }
        for r in 1..SPHERE_RINGS - 1 {
            for s in 0..SPHERE_SEGMENTS {
                let (a, b) = (band(base, r, s), band(base, r, s + 1));
                let (c2, d) = (band(base, r + 1, s), band(base, r + 1, s + 1));
                indices.extend_from_slice(&[a, c2, d, a, d, b]);
            }
        }
        let last = SPHERE_RINGS - 1;
        for s in 0..SPHERE_SEGMENTS {
            indices.extend_from_slice(&[bottom, band(base, last, s + 1), band(base, last, s)]);
        }
    }
    Mesh::new(&positions, &normals, &indices, 0).ok()
}

/// Checks the weather of a scene against its instances and meshes: each part names an instance
/// (once), its triangles are its mesh's, and the drops are at most [`MAX_WET_DROPS`].
pub fn check_parts(
    parts: &[PartWeather],
    instances: &[crate::geometry::Instance],
    meshes: &[Mesh],
) -> Result<(), &'static str> {
    let mut seen = vec![false; instances.len()];
    let mut drops = 0usize;
    for p in parts {
        let Some(inst) = instances.get(p.instance as usize) else {
            return Err("instance does not refer to an INST section");
        };
        if std::mem::replace(&mut seen[p.instance as usize], true) {
            return Err("an instance has two WETP sections");
        }
        let triangles = meshes
            .get(inst.mesh as usize)
            .map_or(0, Mesh::triangle_count);
        if triangles != p.triangles() {
            return Err("the triangles are not those of the instance's mesh");
        }
        drops += p.drops.len();
    }
    if drops > MAX_WET_DROPS {
        return Err("too many drops");
    }
    Ok(())
}

/// The caps of the drops of `parts` in world space, each with the instance it lies on: each at
/// its point and along its triangle's outward normal, carried by its instance's transform.
pub fn caps_of(
    parts: &[PartWeather],
    instances: &[crate::geometry::Instance],
    meshes: &[Mesh],
) -> Vec<(u32, Cap)> {
    let mut caps = Vec::new();
    for p in parts {
        let Some(inst) = instances.get(p.instance as usize) else {
            continue;
        };
        let (Some(mesh), Some(inverse)) =
            (meshes.get(inst.mesh as usize), inst.transform.inverse())
        else {
            continue;
        };
        let flip = if mesh.inside_out() { -1.0 } else { 1.0 };
        for d in &p.drops {
            let Some([a, b, c]) = mesh.triangle(d.triangle as usize) else {
                continue;
            };
            let n = (b - a).cross(c - a) * flip;
            let normal = inverse.transpose_vector(n).normalize();
            if normal.length_squared().is_nan() || normal.length_squared() <= 0.5 {
                continue;
            }
            caps.push((
                p.instance,
                Cap {
                    centre: inst.transform.point(d.position),
                    normal,
                    radius: d.radius,
                    angle_deg: p.cap_angle_deg,
                },
            ));
        }
    }
    caps
}

/// Which instances have weather, for the integrator.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct WeatherSetup {
    /// Per instance, its index among the scene's `wet_parts`.
    by_instance: Vec<Option<u32>>,
    /// The instance of the drops' caps.
    caps: Option<u32>,
}

impl WeatherSetup {
    /// The weather of `scene`'s instances.
    pub fn new(scene: &Scene) -> WeatherSetup {
        let n = scene.geometry.instances().len();
        let mut by_instance = vec![None; n];
        for (k, w) in scene.wet_parts.iter().enumerate() {
            if let Some(slot) = by_instance.get_mut(w.instance as usize) {
                *slot = Some(k as u32);
            }
        }
        WeatherSetup {
            by_instance,
            caps: scene.caps().map(|c| c.instance),
        }
    }

    /// True for the instance of the drops' caps.
    pub fn is_caps(&self, instance: u32) -> bool {
        self.caps == Some(instance)
    }

    /// The layers on a hit, and its instance's porosity; `None` where none lies (or no weather).
    pub fn layers(&self, scene: &Scene, hit: &Hit) -> Option<(Layers, f32)> {
        let k = (*self.by_instance.get(hit.instance as usize)?)?;
        let w = &scene.wet_parts[k as usize];
        let l = w.at(hit.triangle, hit.barycentrics)?;
        (!l.is_clear()).then_some((l, w.porosity))
    }

    /// `m` as the weather of `hit` leaves it, `None` where nothing lies there.
    pub fn at(&self, scene: &Scene, hit: &Hit, m: &Material) -> Option<Material> {
        let (l, porosity) = self.layers(scene, hit)?;
        weathered(m, l, porosity)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn weather(res: &[u8], fill: impl Fn(usize) -> [u8; 3]) -> PartWeather {
        let n: u32 = res.iter().map(|&r| samples_of(u32::from(r))).sum();
        PartWeather::new(
            3,
            res.to_vec(),
            (0..n as usize).map(fill).collect(),
            60.0,
            0.5,
            vec![WetDrop {
                triangle: res.len() as u32 - 1,
                position: Vec3::new(1.0, 2.0, 3.0),
                radius: 1.5,
            }],
        )
        .unwrap()
    }

    #[test]
    fn a_section_goes_and_comes_back_and_bad_ones_are_refused() {
        let w = weather(&[2, 3, 1], |k| [k as u8, 2 * k as u8, 3]);
        let bytes = w.encode();
        assert_eq!(bytes.len() % 4, 0);
        assert_eq!(PartWeather::decode(&bytes), Ok(w.clone()));
        assert!(PartWeather::decode(&bytes[..bytes.len() - 1]).is_err());
        let mut bad = bytes.clone();
        bad[24] = 0; // a resolution of 0
        assert!(PartWeather::decode(&bad).is_err());
        let mut bad = bytes.clone();
        bad[8] = 99; // samples that are not the resolutions'
        assert!(PartWeather::decode(&bad).is_err());
        assert!(PartWeather::new(0, vec![1], vec![[0; 3]; 3], 0.5, 0.0, vec![]).is_err());
        let far = WetDrop {
            triangle: 5,
            position: Vec3::ZERO,
            radius: 1.0,
        };
        assert!(PartWeather::new(0, vec![1], vec![[0; 3]; 3], 60.0, 0.0, vec![far]).is_err());
    }

    #[test]
    fn a_hit_blends_the_samples_of_its_cell() {
        // Resolution 2: samples (0,0) (1,0) (2,0) (0,1) (1,1) (0,2), wet = 0, 50, 100, 150, 200, 250.
        let w = weather(&[2], |k| [50 * k as u8, 0, 0]);
        let at = |b1: f32, b2: f32| w.at(0, [1.0 - b1 - b2, b1, b2]).unwrap().wet * 255.0;
        // The corners are the samples.
        assert!((at(0.0, 0.0) - 0.0).abs() < 1e-3);
        assert!((at(1.0, 0.0) - 100.0).abs() < 1e-3);
        assert!((at(0.0, 1.0) - 250.0).abs() < 1e-3);
        assert!((at(0.5, 0.5) - 200.0).abs() < 1e-3);
        // Inside the lower cell (0,0)(1,0)(0,1): linear.
        assert!((at(0.25, 0.0) - 25.0).abs() < 1e-3);
        assert!((at(0.0, 0.25) - 75.0).abs() < 1e-3);
        // Inside the upper cell of the first row: (1,1) (0,1) (1,0).
        assert!((at(0.4, 0.4) - (0.6 * 200.0 + 0.2 * 150.0 + 0.2 * 50.0)).abs() < 1e-2);
        assert!(w.at(5, [1.0, 0.0, 0.0]).is_none());
    }

    #[test]
    fn nothing_on_a_surface_leaves_its_material_as_it_is_and_the_layers_change_it() {
        let m = Material {
            base_color: Rgb::new(0.6, 0.3, 0.1),
            roughness: 0.4,
            ..Material::default()
        };
        assert_eq!(weathered(&m, Layers::default(), 1.0), None);
        let wet = weathered(
            &m,
            Layers {
                wet: 1.0,
                ..Layers::default()
            },
            1.0,
        )
        .unwrap();
        assert_eq!(wet.coat, 1.0);
        assert_eq!(wet.coat_roughness, WET_COAT_ROUGHNESS);
        // Soaked and porous: the albedo squared.
        assert!(
            (wet.base_color.r - 0.36).abs() < 1e-3,
            "{:?}",
            wet.base_color
        );
        // Not porous: only the film.
        let film = weathered(
            &m,
            Layers {
                wet: 1.0,
                ..Layers::default()
            },
            0.0,
        )
        .unwrap();
        assert_eq!(film.base_color, m.base_color);
        let dusty = weathered(
            &m,
            Layers {
                dust: 1.0,
                ..Layers::default()
            },
            0.0,
        )
        .unwrap();
        assert_eq!(dusty.base_color, DUST_ALBEDO);
        assert_eq!(dusty.roughness, DUST_ROUGHNESS);
        let snowy = weathered(
            &m,
            Layers {
                snow: 1.0,
                ..Layers::default()
            },
            0.0,
        )
        .unwrap();
        assert_eq!(snowy.base_color, Rgb::splat(SNOW_ALBEDO));
        // An emitter is shaded as it is.
        let lamp = Material {
            kind: MATERIAL_EMISSIVE,
            ..m
        };
        assert_eq!(
            weathered(
                &lamp,
                Layers {
                    wet: 1.0,
                    ..Layers::default()
                },
                1.0
            ),
            None
        );
    }

    #[test]
    fn a_cap_is_the_part_of_its_sphere_above_the_surface() {
        let c = Cap {
            centre: Vec3::new(10.0, 0.0, 5.0),
            normal: Vec3::new(0.0, 0.0, 1.0),
            radius: 2.0,
            angle_deg: 60.0,
        };
        let mesh = cap_mesh(&[c]).unwrap();
        assert_eq!(
            mesh.triangle_count() as u32,
            CAP_SEGMENTS * (2 * CAP_RINGS - 1)
        );
        let big = 2.0 / 60f32.to_radians().sin();
        let height = big * (1.0 - 60f32.to_radians().cos());
        let top = mesh.position(0).unwrap();
        assert!((top.z - 5.0 - height).abs() < 1e-2, "{top:?}");
        for i in 1..=CAP_SEGMENTS as usize {
            // The first ring after the top: inside the contact circle, above the surface.
            let p = mesh.position(i).unwrap();
            assert!(p.z > 5.0);
        }
        for i in (1 + (CAP_RINGS - 1) * CAP_SEGMENTS) as usize..mesh.vertex_count() {
            // The last ring is the contact circle.
            let p = mesh.position(i).unwrap();
            let r = ((p.x - 10.0).powi(2) + p.y.powi(2)).sqrt();
            assert!((r - 2.0).abs() < 1e-3 && (p.z - 5.0).abs() < 1e-2, "{p:?}");
        }
        assert!(cap_mesh(&[]).is_none());
    }

    /// A square plate of `half` mm at z = 0 facing up, two triangles.
    fn plate(half: f32) -> Mesh {
        let p = [
            Vec3::new(-half, -half, 0.0),
            Vec3::new(half, -half, 0.0),
            Vec3::new(half, half, 0.0),
            Vec3::new(-half, half, 0.0),
        ];
        Mesh::new(&p, &[], &[0, 1, 2, 0, 2, 3], 0).unwrap()
    }

    #[test]
    fn a_drop_is_meshed_on_its_part_and_lets_the_light_through() {
        use crate::geometry::{Geometry, Instance, Transform};
        use crate::integrator::{BvhTracer, Prepared};
        use crate::math::Ray;
        let mut scene = Scene {
            geometry: Geometry::new(
                vec![plate(50.0)],
                vec![Instance::new(
                    0,
                    Transform {
                        rows: [
                            [1.0, 0.0, 0.0, 0.0],
                            [0.0, 1.0, 0.0, 0.0],
                            [0.0, 0.0, 1.0, 30.0],
                        ],
                    },
                    0,
                )],
            )
            .unwrap(),
            materials: vec![Material::default()],
            ..Scene::default()
        };
        let drop = WetDrop {
            triangle: 0,
            position: Vec3::new(20.0, -20.0, 0.0),
            radius: 3.0,
        };
        let w = PartWeather::new(0, vec![1, 1], vec![[0; 3]; 6], 70.0, 0.0, vec![drop]).unwrap();
        scene.set_wet_parts(vec![w]).unwrap();
        let caps = scene.caps().unwrap();
        assert_eq!((caps.mesh, caps.instance, caps.material), (1, 1, 1));
        assert_eq!(scene.materials[1], water());
        assert_eq!(scene.file_instances().len(), 1);
        // The cap stands on the plate where the instance put it.
        let ray = Ray::new(Vec3::new(20.0, -20.0, 100.0), Vec3::new(0.0, 0.0, -1.0));
        let hit = scene.pick(&ray).unwrap();
        assert_eq!(hit.instance, 1);
        let height = 3.0 / 70f32.to_radians().sin() * (1.0 - 70f32.to_radians().cos());
        assert!(
            (hit.point.z - 30.0 - height).abs() < 0.05,
            "{:?}",
            hit.point
        );
        // A shadow ray from the plate under the drop goes out through its cap, keeping most of the
        // light (the Fresnel of water), as through a thin wall.
        let prepared = Prepared::new(&scene);
        let tracer = BvhTracer {
            geometry: &scene.geometry,
            isa: crate::simd::Isa::detect(),
        };
        let up = Ray::new(Vec3::new(20.0, -20.0, 30.01), Vec3::new(0.0, 0.0, 1.0));
        let keep = prepared
            .shadow_for_tests(&scene, &tracer, &up)
            .expect("not blocked");
        assert!(keep.g > 0.85 && keep.g < 1.0, "{keep:?}");
        // Taken away, nothing is left of it.
        scene.set_wet_parts(Vec::new()).unwrap();
        assert!(scene.caps().is_none());
        assert_eq!(scene.materials.len(), 1);
        assert_eq!(scene.pick(&ray).unwrap().instance, 0);
        // A part that is not there, or with other triangles, is refused and changes nothing.
        let bad = PartWeather::new(3, vec![1, 1], vec![[0; 3]; 6], 70.0, 0.0, vec![]).unwrap();
        assert!(scene.set_wet_parts(vec![bad]).is_err());
        let bad = PartWeather::new(0, vec![1], vec![[0; 3]; 3], 70.0, 0.0, vec![]).unwrap();
        assert!(scene.set_wet_parts(vec![bad]).is_err());
        assert!(scene.wet_parts.is_empty());
    }
    #[test]
    fn a_wetf_section_goes_and_comes_back_and_bad_ones_are_refused() {
        let drops = vec![
            FallingDrop {
                instance: 2,
                position: Vec3::new(1.0, -2.0, 30.0),
                radius: 0.7,
            },
            FallingDrop {
                instance: NO_INSTANCE,
                position: Vec3::new(0.0, 0.0, 5.0),
                radius: 2.0,
            },
        ];
        let bytes = encode_falling(&drops);
        assert_eq!(bytes.len(), WETF_HEADER + 2 * WETF_DROP_BYTES);
        assert_eq!(decode_falling(&bytes), Ok(drops.clone()));
        // A newer writer's tail is ignored.
        let mut longer = bytes.clone();
        longer.extend_from_slice(&[0; 8]);
        assert_eq!(decode_falling(&longer), Ok(drops.clone()));
        assert!(decode_falling(&bytes[..bytes.len() - 1]).is_err());
        let mut bad = bytes.clone();
        bad[20..24].copy_from_slice(&0.0f32.to_bits().to_le_bytes()); // a radius of 0
        assert!(decode_falling(&bad).is_err());
        assert!(check_falling(&drops, 3).is_ok());
        assert!(check_falling(&drops, 2).is_err(), "instance 2 is not there");
    }

    #[test]
    fn a_drop_in_the_air_is_a_sphere_after_the_caps_and_the_passes_name_their_parts() {
        use crate::geometry::{Geometry, Instance, Transform};
        use crate::integrator::{first_hit, BvhTracer, FirstHit, Prepared};
        use crate::math::Ray;
        // Two plates side by side: instance 0 at x < 0, instance 1 at x > 0, 30 mm up.
        let at = |x: f32| Transform {
            rows: [
                [1.0, 0.0, 0.0, x],
                [0.0, 1.0, 0.0, 0.0],
                [0.0, 0.0, 1.0, 30.0],
            ],
        };
        let mut scene = Scene {
            geometry: Geometry::new(
                vec![plate(40.0)],
                vec![
                    Instance::new(0, at(-50.0), 0),
                    Instance::new(0, at(50.0), 0),
                ],
            )
            .unwrap(),
            materials: vec![Material::default()],
            ..Scene::default()
        };
        // A drop on instance 1, and two in the air: one that left instance 0, one from nowhere.
        let on = WetDrop {
            triangle: 0,
            position: Vec3::new(20.0, -20.0, 0.0),
            radius: 3.0,
        };
        let w = PartWeather::new(1, vec![1, 1], vec![[0; 3]; 6], 70.0, 0.0, vec![on]).unwrap();
        scene.set_wet_parts(vec![w]).unwrap();
        scene
            .set_wet_falling(vec![
                FallingDrop {
                    instance: 0,
                    position: Vec3::new(-50.0, 0.0, 60.0),
                    radius: 2.0,
                },
                FallingDrop {
                    instance: NO_INSTANCE,
                    position: Vec3::new(0.0, 0.0, 60.0),
                    radius: 2.0,
                },
            ])
            .unwrap();
        let caps = scene.caps().unwrap();
        assert_eq!((caps.instance, caps.caps), (2, 1));
        let mesh = &scene.geometry.meshes()[caps.mesh as usize];
        assert_eq!(
            mesh.triangle_count() as u32,
            CAP_TRIANGLES + 2 * SPHERE_TRIANGLES
        );
        let prepared = Prepared::new(&scene);
        let tracer = BvhTracer {
            geometry: &scene.geometry,
            isa: crate::simd::Isa::detect(),
        };
        let down = |x: f32, y: f32| Ray::new(Vec3::new(x, y, 200.0), Vec3::new(0.0, 0.0, -1.0));
        let met = |ray: &Ray| match first_hit(&scene, &prepared, &tracer, ray) {
            FirstHit::Surface { instance, t, .. } => (instance, ray.origin.z - t),
            other => panic!("{other:?}"),
        };
        // The sphere in the air: its top at 62 mm, named as instance 0 (the part it left).
        let (inst, z) = met(&down(-50.0, 0.0));
        assert_eq!(inst, 0);
        assert!((z - 62.0).abs() < 0.05, "{z}");
        // The one from nowhere: the drops' own instance.
        assert_eq!(met(&down(0.0, 0.0)).0, caps.instance);
        // The cap on instance 1: named as instance 1, not as the caps'.
        let (inst, z) = met(&down(70.0, -20.0));
        assert_eq!(inst, 1);
        assert!(z > 30.5, "{z}");
        // The sphere is a sphere: a ray along X through its centre meets it at its radius.
        let side = Ray::new(Vec3::new(-150.0, 0.0, 60.0), Vec3::new(1.0, 0.0, 0.0));
        let hit = scene.pick(&side).unwrap();
        assert_eq!(hit.instance, caps.instance);
        assert!((hit.point.x + 52.0).abs() < 0.05, "{:?}", hit.point);
        // A shadow ray up from the plate under it goes through it, as through a cap.
        let up = Ray::new(Vec3::new(-50.0, 0.0, 30.01), Vec3::new(0.0, 0.0, 1.0));
        let keep = prepared
            .shadow_for_tests(&scene, &tracer, &up)
            .expect("not blocked");
        assert!(keep.g > 0.85, "{keep:?}");
        // Taken away, the cap stays and the spheres go.
        scene.set_wet_falling(Vec::new()).unwrap();
        let caps = scene.caps().unwrap();
        assert_eq!(
            scene.geometry.meshes()[caps.mesh as usize].triangle_count() as u32,
            CAP_TRIANGLES
        );
        assert_eq!(scene.cap_owners, vec![1]);
        // A drop in the air from an instance that is not there is refused and changes nothing.
        let bad = FallingDrop {
            instance: 7,
            position: Vec3::ZERO,
            radius: 1.0,
        };
        assert!(scene.set_wet_falling(vec![bad]).is_err());
        assert!(scene.wet_falling.is_empty());
    }
}
