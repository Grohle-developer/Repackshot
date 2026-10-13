//! RSB: the Repackshot Scene Binary format, version 1.
//!
//! Everything is little-endian.
//!
//! ```text
//! file    = "RSB1" · u32 header_len · header_len extra header bytes · section*
//! section = [u8; 4] tag · u32 byte_len · payload (byte_len bytes)
//! ```
//!
//! `header_len` counts the bytes between the `header_len` field itself and the first section.
//! Version 1 writers emit 0 and readers skip whatever is there, so later versions can add header
//! fields. Tags are four ASCII bytes. **Unknown tags are skipped**, and a known section may carry
//! extra trailing bytes (newer writers append fields), so old readers keep working.
//!
//! Section payloads (`[3]` means three consecutive values; sizes are the minimum payload length;
//! fields after a `|` were appended later (E3, then `||` E5, `|||` X2, `||||` E5c) and are
//! optional: a shorter payload, as older writers wrote it, reads them as their defaults, and the
//! writer always writes them):
//!
//! ```text
//! CAMR  60 B  f32 position[3] target[3] up[3]; f32 focal_mm sensor_mm fstop focus_dist;
//!             u32 ortho_flag; f32 ortho_width
//! MESH  var.  u32 vertex_count index_count; f32 positions[3n] normals[3n]; u32 indices[m];
//!             u32 material_id                      (n = vertex_count, m = index_count)
//! MATL  56 B  u32 kind; f32 base_color[3] metallic roughness ior transmission coat
//!             coat_roughness emission[3] emission_power | u32 flags (default 0)       (60 B)
//!             || f32 opacity (1) anisotropy (0) absorption_mm (0)                     (72 B)
//! LGHT  76 B  u32 kind; f32 position[3] direction[3] up[3] size_x size_y color[3] power
//!             spread_deg angle_deg; u32 flags
//! ENVR  40 B  u32 kind; f32 floor horizon zenith strength rotation_deg background_color[3];
//!             u32 background_mode
//!             || u32 hdri_map (none) backplate_map (none) backplate_fit (0);
//!             f32 sky_turbidity (3) sun_azimuth_deg (0) sun_elevation_deg (45)
//!             backplate_rect[4] (0 0 1 1)                                          (80 B)
//!             |||| u32 sky_model (0 physical)                                      (84 B)
//! BMAP  16 B  u32 format width height byte_len; u8 data[byte_len]; zero padding to 4 (E5, new)
//! FLOR  20 B  u32 mode; f32 z; f32 color[3]                                        (E3, new)
//! RNDR  28 B  u32 width height max_samples seed; f32 max_seconds exposure_ev; u32 tonemap
//!             | u32 max_depth (default 8); f32 clamp_indirect (default 0)            (36 B)
//!             ||| u32 passes (default 0)                                            (40 B)
//! INST  60 B  u32 mesh_id; f32 transform[12] (rows of the 3x4 object-to-world matrix);
//!             u32 material_id; u32 flags (1 one-sided)
//! ```
//!
//! `CAMR`, `ENVR`, `FLOR` and `RNDR` may appear at most once (a missing one means "defaults");
//! `MESH`, `MATL`, `LGHT`, `INST` and `BMAP` repeat. A mesh refers to a material by its position
//! among the `MATL` sections, an instance to a mesh by its position among the `MESH` sections, the
//! environment to a bitmap by its position among the `BMAP` sections (`0xffffffff`: none),
//! wherever they are in the file. All floats must be finite.
//!
//! **Bitmaps** (E5). `BMAP.format` is 0 (8-bit sRGB RGB), 1 (8-bit sRGB RGBA, alpha ignored), 2
//! (little-endian linear `f32` RGB), 16 (a whole Radiance `.hdr` file) or 17 (a whole OpenEXR
//! file: scanline, uncompressed, RLE, ZIPS or ZIP); `width` and `height` are the size of the raw
//! formats and 0 (or the file's own size) for the files. Rows run top to bottom. See
//! [`crate::bitmap`]; a bitmap that cannot be decoded makes the file invalid.
//!
//! **Instances.** A file without `INST` sections draws every mesh once, untransformed, with the
//! mesh's own `material_id` (one implicit instance per mesh: what files written before `INST`
//! existed mean). A file with `INST` sections draws exactly the instances listed, in that order;
//! a mesh no instance refers to is not drawn. The writer emits `INST` only when the instances
//! differ from the implicit ones, so scenes without instancing keep their exact bytes.
//!
//! **Updates** (E4). [`Scene::update_from_rsb`] reads a file into an already loaded scene: a file
//! without `MESH` sections keeps the loaded meshes and their BVHs (its `INST` sections, or the
//! implicit instances, refer to them), so a host that changes the camera, the image size, the
//! instances, the materials or the lights sends everything but the geometry. In the same way a
//! file without `BMAP` sections keeps the loaded bitmaps (E5), which can be large.
//!
//! # Meaning of the values (fixed in E3)
//!
//! Units: millimetres for positions and sizes, degrees for angles. Radiance is in
//! W / (sr m^2) and is what the film stores (exposure 0 shows radiance 1 as white before the tone
//! curve); for photometric quantities a scene millimetre is 1e-3 m.
//!
//! * `CAMR.ortho_flag` non-zero: orthographic camera `ortho_width` wide (no depth of field);
//!   otherwise a thin lens of `focal_mm` on a sensor `sensor_mm` wide along the longer image
//!   side, aperture `focal_mm / fstop` (`fstop` 0: pinhole), focused at `focus_dist`. Box pixel
//!   filter.
//! * `MATL.kind`: **0 principled** (Lambert diffuse of `base_color * (1 - metallic) *
//!   (1 - transmission)`; GGX specular with height-correlated Smith masking, roughness² as the GGX
//!   width, Schlick Fresnel with `F0 = ((ior - 1) / (ior + 1))²` for the dielectric and
//!   `base_color` for the metal, blended by `metallic`; the `transmission` share of the
//!   dielectric is clear: GGX reflection and refraction with the exact dielectric Fresnel of
//!   `ior`, tinted by `base_color` (see [`crate::bsdf`]); `coat` adds a second GGX lobe of
//!   `coat_roughness`, ior 1.5, on top; `anisotropy` stretches the GGX lobes along a tangent
//!   around the instance's local Z axis), **1 glass** (kind 0 without metal), **2 emissive**
//!   (radiance `emission * emission_power`, no reflection). Unknown kinds render as 0.
//!   `MATL.flags` bit 0 (`1`): an emissive material is also sampled as an area light by
//!   next-event estimation; bit 1 (`2`) **thin wall**: the clear part has no inside, light goes
//!   straight through it (no refraction, the colour once) and so do shadow rays. `opacity` below
//!   one makes the surface a stochastic cut-out (emitters ignore it); `absorption_mm` above zero
//!   makes `base_color` the colour white light keeps after that many millimetres inside a solid
//!   (Beer–Lambert) instead of a surface tint.
//! * `LGHT.kind`: **0 rect** (`size_x` × `size_y`, its local Y axis along `up`), **1 disk**
//!   (diameter `size_x`), **2 sun** (a disc of angular diameter `angle_deg`, 0 for a delta
//!   direction), **3 point** and **4 spot** (reserved for L4: parsed, kept, not rendered). Rect
//!   and disk emit from the face `direction` points to, `power` watts of flux without falloff
//!   (radiance `color * power / (π · area in m²)`), with a `cos^n` falloff from the normal whose
//!   intensity halves at `spread_deg / 2` (180: none; on-axis radiance does not change with
//!   spread, like a grid on a softbox). The sun's `power` is the irradiance (W/m²) it gives a
//!   surface facing it; light travels along `direction`. Lights are transparent: they never
//!   occlude. `LGHT.flags`: bit 0 (`1`) **glossy**, the light is seen by BSDF-sampled rays and
//!   lights every lobe (multiple importance sampling with next-event estimation); without it,
//!   it lights only the diffuse lobe, by next-event estimation alone, and is invisible in
//!   reflections. Bit 1 (`2`) **camera**: visible to camera rays.
//! * `ENVR.kind`: **0 studio dome** (radiance ramps linearly with the z of the direction from
//!   `floor` at z = -1 through `horizon` at 0 to `zenith` at +1), **1 flat** (`horizon`
//!   everywhere), **2 sky** (daylight for `sky_turbidity` and the sun at `sun_azimuth_deg`
//!   from +X towards +Y and `sun_elevation_deg`, scaled to give a horizontal surface the
//!   irradiance of the dome with these values; the ground below the horizon is `floor`;
//!   `sky_model` **0** the physical sky, fitted to our own atmosphere simulation (also what a
//!   file without the field means, and any unknown value), **1** the classic Preetham sky; see
//!   [`crate::sky`]), **3 HDRI** (the equirectangular bitmap `hdri_map`, in the
//!   convention of [`crate::environment`]; the dome without it). Everything is scaled by
//!   `strength`; `rotation_deg` turns the HDRI about Z (counter-clockwise from above; no effect on
//!   the other kinds, the sky follows its sun). `background_mode`: **0** the environment is
//!   visible, **1** camera rays that escape see `background_color`, **2** transparent (they see
//!   black and the film's alpha is 0 there), **3** the background image `backplate_map`, seen by
//!   camera rays only, `backplate_fit` **0** cover the frame (cropped), **1** fit inside it (the
//!   rest is `background_color`), **2** stretched, the frame being `backplate_rect` of the image
//!   (a viewport renders more than the output frame); without the bitmap, mode 3 is mode 1. The
//!   environment lights the scene in every mode.
//! * `FLOR.mode`: **0** no floor, **1** an infinite Lambertian plane at height `z` of albedo
//!   `color`, **2** shadow catcher: the plane is invisible to everything except camera rays,
//!   where it shows the background darkened by the fraction of light the scene blocks (with a
//!   transparent background: black with that fraction as alpha).
//! * `RNDR.tonemap`: **0** linear (no curve, clipped), **1** ACES (Narkowicz fit), **2** filmic
//!   (log2 shaper and S-curve, Blender-like), **3** AgX, **4** standard (sRGB, clipped); unknown
//!   values mean ACES. `exposure_ev` multiplies by `2^ev` before the curve. `max_depth` is the
//!   most surface interactions per path (0: 8); `clamp_indirect` caps each channel of every
//!   indirect contribution (0: off). `max_seconds` is honoured by the host between sample
//!   passes. `passes` (X2) is the mask of the exact passes the host writes next to the image:
//!   bit `i` is [`crate::passes::PASS_KEYS`]`[i]` (albedo, normal, depth, partId, materialId,
//!   coc); 0, or a file written before X2, asks for none, and unknown bits are kept and ignored.
//!   Asking for passes never changes a pixel of the image.

use super::{
    Bitmap, Camera, EnvKind, Environment, Floor, FloorMode, Geometry, Instance, Light, LightKind,
    Material, Mesh, RenderSettings, Scene, SkyModel, Transform, NO_BITMAP,
};
use crate::color::Rgb;
use crate::math::Vec3;
use std::fmt;

/// The four magic bytes at the start of every RSB file.
pub const MAGIC: [u8; 4] = *b"RSB1";

/// Camera section tag.
pub const TAG_CAMR: [u8; 4] = *b"CAMR";
/// Mesh section tag.
pub const TAG_MESH: [u8; 4] = *b"MESH";
/// Material section tag.
pub const TAG_MATL: [u8; 4] = *b"MATL";
/// Light section tag.
pub const TAG_LGHT: [u8; 4] = *b"LGHT";
/// Environment section tag.
pub const TAG_ENVR: [u8; 4] = *b"ENVR";
/// Render settings section tag.
pub const TAG_RNDR: [u8; 4] = *b"RNDR";
/// Instance section tag.
pub const TAG_INST: [u8; 4] = *b"INST";
/// Floor section tag.
pub const TAG_FLOR: [u8; 4] = *b"FLOR";
/// Bitmap section tag.
pub const TAG_BMAP: [u8; 4] = *b"BMAP";

/// Why an RSB file could not be read.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum RsbError {
    /// The file does not start with `RSB1`.
    BadMagic,
    /// The file ends in the middle of the named structure.
    Truncated {
        /// What was being read.
        what: &'static str,
    },
    /// A section payload is shorter than its tag requires.
    SectionTooShort {
        /// Tag of the offending section.
        tag: [u8; 4],
    },
    /// A section that may appear only once appears again.
    DuplicateSection {
        /// Tag of the repeated section.
        tag: [u8; 4],
    },
    /// A section holds a value that is not allowed.
    Invalid {
        /// Tag of the offending section.
        tag: [u8; 4],
        /// What is wrong.
        reason: &'static str,
    },
}

/// Formats a tag as text, replacing non printable bytes.
fn tag_text(tag: &[u8; 4]) -> String {
    tag.iter()
        .map(|&b| if b.is_ascii_graphic() { b as char } else { '?' })
        .collect()
}

impl fmt::Display for RsbError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            RsbError::BadMagic => write!(f, "not an RSB file (missing RSB1 magic)"),
            RsbError::Truncated { what } => write!(f, "RSB file is truncated in {what}"),
            RsbError::SectionTooShort { tag } => {
                write!(
                    f,
                    "RSB section {} is shorter than its layout requires",
                    tag_text(tag)
                )
            }
            RsbError::DuplicateSection { tag } => {
                write!(f, "RSB section {} appears more than once", tag_text(tag))
            }
            RsbError::Invalid { tag, reason } => {
                write!(f, "RSB section {} is invalid: {reason}", tag_text(tag))
            }
        }
    }
}

impl std::error::Error for RsbError {}

/// Cursor over one section payload.
struct Reader<'a> {
    data: &'a [u8],
    pos: usize,
    tag: [u8; 4],
}

impl<'a> Reader<'a> {
    fn new(tag: [u8; 4], data: &'a [u8]) -> Reader<'a> {
        Reader { data, pos: 0, tag }
    }

    fn remaining(&self) -> usize {
        self.data.len() - self.pos
    }

    fn invalid(&self, reason: &'static str) -> RsbError {
        RsbError::Invalid {
            tag: self.tag,
            reason,
        }
    }

    fn word(&mut self) -> Result<[u8; 4], RsbError> {
        let bytes = self
            .data
            .get(self.pos..self.pos + 4)
            .ok_or(RsbError::SectionTooShort { tag: self.tag })?;
        self.pos += 4;
        Ok([bytes[0], bytes[1], bytes[2], bytes[3]])
    }

    fn u32(&mut self) -> Result<u32, RsbError> {
        Ok(u32::from_le_bytes(self.word()?))
    }

    fn f32(&mut self) -> Result<f32, RsbError> {
        let v = f32::from_le_bytes(self.word()?);
        if v.is_finite() {
            Ok(v)
        } else {
            Err(self.invalid("non-finite number"))
        }
    }

    fn vec3(&mut self) -> Result<Vec3, RsbError> {
        Ok(Vec3::new(self.f32()?, self.f32()?, self.f32()?))
    }

    fn rgb(&mut self) -> Result<Rgb, RsbError> {
        Ok(Rgb::new(self.f32()?, self.f32()?, self.f32()?))
    }

    /// An optional trailing `u32`: `default` when the payload ends here.
    fn opt_u32(&mut self, default: u32) -> Result<u32, RsbError> {
        if self.remaining() >= 4 {
            self.u32()
        } else {
            Ok(default)
        }
    }

    /// An optional trailing `f32`: `default` when the payload ends here.
    fn opt_f32(&mut self, default: f32) -> Result<f32, RsbError> {
        if self.remaining() >= 4 {
            self.f32()
        } else {
            Ok(default)
        }
    }
}

fn parse_camera(r: &mut Reader) -> Result<Camera, RsbError> {
    let camera = Camera {
        position: r.vec3()?,
        target: r.vec3()?,
        up: r.vec3()?,
        focal_mm: r.f32()?,
        sensor_mm: r.f32()?,
        fstop: r.f32()?,
        focus_dist: r.f32()?,
        ortho: r.u32()? != 0,
        ortho_width: r.f32()?,
    };
    if camera.focal_mm <= 0.0 || camera.sensor_mm <= 0.0 {
        return Err(r.invalid("focal_mm and sensor_mm must be positive"));
    }
    if camera.fstop < 0.0 || camera.focus_dist < 0.0 || camera.ortho_width < 0.0 {
        return Err(r.invalid("fstop, focus_dist and ortho_width must not be negative"));
    }
    Ok(camera)
}

fn parse_mesh(r: &mut Reader) -> Result<Mesh, RsbError> {
    let vertex_count = r.u32()?;
    let index_count = r.u32()?;
    // Check the declared sizes against the payload before allocating anything, so a hostile
    // header cannot request gigabytes.
    let words = u64::from(vertex_count) * 6 + u64::from(index_count) + 1;
    if words * 4 > r.remaining() as u64 {
        return Err(RsbError::SectionTooShort { tag: r.tag });
    }
    if index_count % 3 != 0 {
        return Err(r.invalid("index_count is not a multiple of 3"));
    }
    let n = vertex_count as usize;
    let mut positions = Vec::with_capacity(n);
    for _ in 0..n {
        positions.push(r.vec3()?);
    }
    let mut normals = Vec::with_capacity(n);
    for _ in 0..n {
        normals.push(r.vec3()?);
    }
    let mut indices = Vec::with_capacity(index_count as usize);
    for _ in 0..index_count {
        let index = r.u32()?;
        if index >= vertex_count {
            return Err(r.invalid("vertex index out of range"));
        }
        indices.push(index);
    }
    let material_id = r.u32()?;
    Mesh::new(&positions, &normals, &indices, material_id).map_err(|e| r.invalid(e.reason()))
}

fn parse_instance(r: &mut Reader) -> Result<Instance, RsbError> {
    let mesh = r.u32()?;
    let mut rows = [[0.0f32; 4]; 3];
    for row in &mut rows {
        for value in row.iter_mut() {
            *value = r.f32()?;
        }
    }
    Ok(Instance {
        mesh,
        transform: Transform::from_rows(rows),
        material_id: r.u32()?,
        flags: r.u32()?,
    })
}

fn parse_material(r: &mut Reader) -> Result<Material, RsbError> {
    Ok(Material {
        kind: r.u32()?,
        base_color: r.rgb()?,
        metallic: r.f32()?,
        roughness: r.f32()?,
        ior: r.f32()?,
        transmission: r.f32()?,
        coat: r.f32()?,
        coat_roughness: r.f32()?,
        emission: r.rgb()?,
        emission_power: r.f32()?,
        flags: r.opt_u32(0)?,
        opacity: r.opt_f32(1.0)?,
        anisotropy: r.opt_f32(0.0)?,
        absorption_mm: r.opt_f32(0.0)?,
    })
}

fn parse_light(r: &mut Reader) -> Result<Light, RsbError> {
    let kind = LightKind::from_u32(r.u32()?).ok_or_else(|| r.invalid("unknown light kind"))?;
    Ok(Light {
        kind,
        position: r.vec3()?,
        direction: r.vec3()?,
        up: r.vec3()?,
        size_x: r.f32()?,
        size_y: r.f32()?,
        color: r.rgb()?,
        power: r.f32()?,
        spread_deg: r.f32()?,
        angle_deg: r.f32()?,
        flags: r.u32()?,
    })
}

fn parse_environment(r: &mut Reader) -> Result<Environment, RsbError> {
    let kind = EnvKind::from_u32(r.u32()?).ok_or_else(|| r.invalid("unknown environment kind"))?;
    Ok(Environment {
        kind,
        floor: r.f32()?,
        horizon: r.f32()?,
        zenith: r.f32()?,
        strength: r.f32()?,
        rotation_deg: r.f32()?,
        background_color: r.rgb()?,
        background_mode: r.u32()?,
        hdri_map: r.opt_u32(NO_BITMAP)?,
        backplate_map: r.opt_u32(NO_BITMAP)?,
        backplate_fit: r.opt_u32(super::BACKPLATE_FILL)?,
        sky_turbidity: r.opt_f32(crate::sky::DEFAULT_TURBIDITY)?,
        sun_azimuth_deg: r.opt_f32(0.0)?,
        sun_elevation_deg: r.opt_f32(45.0)?,
        backplate_rect: [
            r.opt_f32(0.0)?,
            r.opt_f32(0.0)?,
            r.opt_f32(1.0)?,
            r.opt_f32(1.0)?,
        ],
        sky_model: SkyModel::from_u32(r.opt_u32(SkyModel::Physical.to_u32())?),
    })
}

fn parse_bitmap(r: &mut Reader) -> Result<Bitmap, RsbError> {
    let format = r.u32()?;
    let width = r.u32()?;
    let height = r.u32()?;
    let len = r.u32()? as usize;
    if len > r.remaining() {
        return Err(RsbError::SectionTooShort { tag: r.tag });
    }
    let data = r.data[r.pos..r.pos + len].to_vec();
    r.pos += len;
    Bitmap::decode(format, width, height, data).map_err(|e| r.invalid(e.reason()))
}

fn parse_floor(r: &mut Reader) -> Result<Floor, RsbError> {
    let mode = FloorMode::from_u32(r.u32()?).ok_or_else(|| r.invalid("unknown floor mode"))?;
    Ok(Floor {
        mode,
        z: r.f32()?,
        color: r.rgb()?,
    })
}

fn parse_render(r: &mut Reader) -> Result<RenderSettings, RsbError> {
    let settings = RenderSettings {
        width: r.u32()?,
        height: r.u32()?,
        max_samples: r.u32()?,
        seed: r.u32()?,
        max_seconds: r.f32()?,
        exposure_ev: r.f32()?,
        tonemap: r.u32()?,
        max_depth: r.opt_u32(RenderSettings::DEFAULT_MAX_DEPTH)?,
        clamp_indirect: r.opt_f32(0.0)?,
        passes: r.opt_u32(0)?,
    };
    let range = 1..=RenderSettings::MAX_DIMENSION;
    if !range.contains(&settings.width) || !range.contains(&settings.height) {
        return Err(r.invalid("width and height must be between 1 and 16384"));
    }
    if settings.max_seconds < 0.0 || settings.clamp_indirect < 0.0 {
        return Err(r.invalid("max_seconds and clamp_indirect must not be negative"));
    }
    Ok(settings)
}

/// Stores `value` in `slot`, failing if the section was already seen.
fn set_once<T>(slot: &mut Option<T>, tag: [u8; 4], value: T) -> Result<(), RsbError> {
    if slot.replace(value).is_some() {
        Err(RsbError::DuplicateSection { tag })
    } else {
        Ok(())
    }
}

/// What an update may keep of the loaded scene.
struct Kept<'a> {
    geometry: &'a mut Geometry,
    bitmaps: &'a mut Vec<Bitmap>,
}

/// Parses an RSB file. With `kept`, a file without `MESH` sections uses the meshes of `kept`
/// instead, and one without `BMAP` sections its bitmaps (moved out of it only once nothing can
/// fail any more, so `kept` is untouched on error).
fn read_scene(bytes: &[u8], kept: Option<Kept>) -> Result<Scene, RsbError> {
    if bytes.len() < 4 || bytes[..4] != MAGIC {
        return Err(RsbError::BadMagic);
    }
    let header_len = bytes
        .get(4..8)
        .map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]]))
        .ok_or(RsbError::Truncated { what: "header" })?;
    let mut pos = 8usize
        .checked_add(header_len as usize)
        .filter(|&p| p <= bytes.len())
        .ok_or(RsbError::Truncated { what: "header" })?;

    let mut camera = None;
    let mut environment = None;
    let mut floor = None;
    let mut render = None;
    let mut meshes = Vec::new();
    let mut instances = Vec::new();
    let mut bitmaps = Vec::new();
    let mut scene = Scene::default();

    while pos < bytes.len() {
        let head = bytes.get(pos..pos + 8).ok_or(RsbError::Truncated {
            what: "section header",
        })?;
        let tag = [head[0], head[1], head[2], head[3]];
        let len = u32::from_le_bytes([head[4], head[5], head[6], head[7]]) as usize;
        let payload = (pos + 8)
            .checked_add(len)
            .and_then(|end| bytes.get(pos + 8..end))
            .ok_or(RsbError::Truncated {
                what: "section payload",
            })?;
        pos += 8 + len;

        let mut r = Reader::new(tag, payload);
        match tag {
            TAG_CAMR => set_once(&mut camera, tag, parse_camera(&mut r)?)?,
            TAG_ENVR => set_once(&mut environment, tag, parse_environment(&mut r)?)?,
            TAG_FLOR => set_once(&mut floor, tag, parse_floor(&mut r)?)?,
            TAG_RNDR => set_once(&mut render, tag, parse_render(&mut r)?)?,
            TAG_MESH => meshes.push(parse_mesh(&mut r)?),
            TAG_INST => instances.push(parse_instance(&mut r)?),
            TAG_MATL => scene.materials.push(parse_material(&mut r)?),
            TAG_LGHT => scene.lights.push(parse_light(&mut r)?),
            TAG_BMAP => bitmaps.push(parse_bitmap(&mut r)?),
            _ => {} // Unknown section: skipped for forward compatibility.
        }
    }

    // The meshes the instances refer to: the file's own, or the kept ones when it has none; the
    // same for the bitmaps.
    let (kept_geometry, kept_bitmaps) = match kept {
        Some(k) => (Some(k.geometry), Some(k.bitmaps)),
        None => (None, None),
    };
    let reuse = if meshes.is_empty() {
        kept_geometry
    } else {
        None
    };
    let reuse_bitmaps = if bitmaps.is_empty() {
        kept_bitmaps
    } else {
        None
    };
    let bitmap_count = reuse_bitmaps.as_ref().map_or(bitmaps.len(), |b| b.len());
    let environment = environment.unwrap_or_default();
    for map in [environment.hdri_map, environment.backplate_map] {
        if map != NO_BITMAP && map as usize >= bitmap_count {
            return Err(RsbError::Invalid {
                tag: TAG_ENVR,
                reason: "bitmap index does not refer to a BMAP section",
            });
        }
    }
    let available: &[Mesh] = match &reuse {
        Some(geometry) => geometry.meshes(),
        None => &meshes,
    };
    let materials = scene.materials.len();
    if available
        .iter()
        .any(|m| m.material_id() as usize >= materials)
    {
        return Err(RsbError::Invalid {
            tag: TAG_MESH,
            reason: "material_id does not refer to a MATL section",
        });
    }
    if instances.is_empty() {
        instances = Geometry::implicit_instances(available);
    }
    let invalid_instance = |reason| RsbError::Invalid {
        tag: TAG_INST,
        reason,
    };
    if instances.iter().any(|i| i.mesh as usize >= available.len()) {
        return Err(invalid_instance("mesh_id does not refer to a MESH section"));
    }
    if instances
        .iter()
        .any(|i| i.material_id as usize >= materials)
    {
        return Err(invalid_instance(
            "material_id does not refer to a MATL section",
        ));
    }
    if instances.len() > crate::geometry::MAX_INSTANCES {
        return Err(invalid_instance("too many instances"));
    }
    // Nothing below can fail: only now are the kept meshes and bitmaps taken.
    if let Some(geometry) = reuse {
        meshes = std::mem::take(geometry).into_meshes();
    }
    if let Some(kept) = reuse_bitmaps {
        bitmaps = std::mem::take(kept);
    }
    scene.geometry =
        Geometry::new(meshes, instances).map_err(|_| invalid_instance("too many instances"))?;
    scene.bitmaps = bitmaps;
    scene.camera = camera.unwrap_or_default();
    scene.environment = environment;
    scene.floor = floor.unwrap_or_default();
    scene.render = render.unwrap_or_default();
    Ok(scene)
}

impl Scene {
    /// Parses an RSB file. See the [module documentation](self) for the format.
    pub fn from_rsb(bytes: &[u8]) -> Result<Scene, RsbError> {
        read_scene(bytes, None)
    }

    /// Replaces this scene with the RSB file `bytes`, like [`Scene::from_rsb`], except that a
    /// file **without `MESH` sections keeps the meshes of this scene** (and their BVHs, which are
    /// not built again): its `INST` sections, or the implicit instances of the kept meshes, refer
    /// to them. This is how a host changes the camera, the image size, the instances, the
    /// materials or the lights of a loaded scene without sending its geometry again. Likewise a
    /// file without `BMAP` sections keeps the bitmaps of this scene. A file with `MESH` sections
    /// replaces the geometry, one with `BMAP` sections the bitmaps, exactly like
    /// [`Scene::from_rsb`]. On error the scene is unchanged.
    pub fn update_from_rsb(&mut self, bytes: &[u8]) -> Result<(), RsbError> {
        let kept = Kept {
            geometry: &mut self.geometry,
            bitmaps: &mut self.bitmaps,
        };
        let scene = read_scene(bytes, Some(kept))?;
        *self = scene;
        Ok(())
    }

    /// Serialises the scene as an RSB file (the reference writer for the TypeScript side).
    pub fn to_rsb(&self) -> Vec<u8> {
        let mut w = Writer { buf: Vec::new() };
        w.buf.extend_from_slice(&MAGIC);
        w.u32(0); // header_len

        w.section(TAG_CAMR, |w| {
            let c = &self.camera;
            w.vec3(c.position);
            w.vec3(c.target);
            w.vec3(c.up);
            w.f32(c.focal_mm);
            w.f32(c.sensor_mm);
            w.f32(c.fstop);
            w.f32(c.focus_dist);
            w.u32(u32::from(c.ortho));
            w.f32(c.ortho_width);
        });
        for m in &self.materials {
            w.section(TAG_MATL, |w| {
                w.u32(m.kind);
                w.rgb(m.base_color);
                for v in [
                    m.metallic,
                    m.roughness,
                    m.ior,
                    m.transmission,
                    m.coat,
                    m.coat_roughness,
                ] {
                    w.f32(v);
                }
                w.rgb(m.emission);
                w.f32(m.emission_power);
                w.u32(m.flags);
                w.f32(m.opacity);
                w.f32(m.anisotropy);
                w.f32(m.absorption_mm);
            });
        }
        for mesh in self.geometry.meshes() {
            w.section(TAG_MESH, |w| {
                let n = mesh.vertex_count();
                w.u32(n as u32);
                w.u32(mesh.indices().len() as u32);
                for i in 0..n {
                    w.vec3(mesh.position(i).unwrap_or_default());
                }
                for i in 0..n {
                    w.vec3(mesh.normal(i).unwrap_or_default());
                }
                for &i in mesh.indices() {
                    w.u32(i);
                }
                w.u32(mesh.material_id());
            });
        }
        if !self.geometry.has_implicit_instances() {
            for instance in self.geometry.instances() {
                w.section(TAG_INST, |w| {
                    w.u32(instance.mesh);
                    for v in instance.transform.rows.iter().flatten() {
                        w.f32(*v);
                    }
                    w.u32(instance.material_id);
                    w.u32(instance.flags);
                });
            }
        }
        for l in &self.lights {
            w.section(TAG_LGHT, |w| {
                w.u32(l.kind.to_u32());
                w.vec3(l.position);
                w.vec3(l.direction);
                w.vec3(l.up);
                w.f32(l.size_x);
                w.f32(l.size_y);
                w.rgb(l.color);
                w.f32(l.power);
                w.f32(l.spread_deg);
                w.f32(l.angle_deg);
                w.u32(l.flags);
            });
        }
        for b in &self.bitmaps {
            w.section(TAG_BMAP, |w| {
                w.u32(b.format);
                w.u32(b.width);
                w.u32(b.height);
                w.u32(b.data.len() as u32);
                w.buf.extend_from_slice(&b.data);
                let pad = (4 - b.data.len() % 4) % 4;
                w.buf.extend(std::iter::repeat_n(0u8, pad));
            });
        }
        w.section(TAG_ENVR, |w| {
            let e = &self.environment;
            w.u32(e.kind.to_u32());
            for v in [e.floor, e.horizon, e.zenith, e.strength, e.rotation_deg] {
                w.f32(v);
            }
            w.rgb(e.background_color);
            w.u32(e.background_mode);
            w.u32(e.hdri_map);
            w.u32(e.backplate_map);
            w.u32(e.backplate_fit);
            w.f32(e.sky_turbidity);
            w.f32(e.sun_azimuth_deg);
            w.f32(e.sun_elevation_deg);
            for v in e.backplate_rect {
                w.f32(v);
            }
            w.u32(e.sky_model.to_u32());
        });
        w.section(TAG_FLOR, |w| {
            let f = &self.floor;
            w.u32(f.mode.to_u32());
            w.f32(f.z);
            w.rgb(f.color);
        });
        w.section(TAG_RNDR, |w| {
            let r = &self.render;
            w.u32(r.width);
            w.u32(r.height);
            w.u32(r.max_samples);
            w.u32(r.seed);
            w.f32(r.max_seconds);
            w.f32(r.exposure_ev);
            w.u32(r.tonemap);
            w.u32(r.max_depth);
            w.f32(r.clamp_indirect);
            w.u32(r.passes);
        });
        w.buf
    }
}

/// Little-endian byte sink.
struct Writer {
    buf: Vec<u8>,
}

impl Writer {
    fn u32(&mut self, v: u32) {
        self.buf.extend_from_slice(&v.to_le_bytes());
    }

    fn f32(&mut self, v: f32) {
        self.buf.extend_from_slice(&v.to_le_bytes());
    }

    fn vec3(&mut self, v: Vec3) {
        self.f32(v.x);
        self.f32(v.y);
        self.f32(v.z);
    }

    fn rgb(&mut self, c: Rgb) {
        self.f32(c.r);
        self.f32(c.g);
        self.f32(c.b);
    }

    /// Writes a section: tag, a length patched in after `body` ran, then the payload.
    fn section(&mut self, tag: [u8; 4], body: impl FnOnce(&mut Writer)) {
        self.buf.extend_from_slice(&tag);
        let len_at = self.buf.len();
        self.u32(0);
        let start = self.buf.len();
        body(self);
        let len = (self.buf.len() - start) as u32;
        self.buf[len_at..len_at + 4].copy_from_slice(&len.to_le_bytes());
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::scene::{LIGHT_FLAG_CAMERA, LIGHT_FLAG_GLOSSY};

    /// A scene that exercises every section with non-default values.
    fn full_scene() -> Scene {
        Scene {
            camera: Camera {
                position: Vec3::new(10.0, -200.0, 50.0),
                target: Vec3::new(1.0, 2.0, 3.0),
                up: Vec3::new(0.0, 0.0, 1.0),
                focal_mm: 85.0,
                sensor_mm: 36.0,
                fstop: 5.6,
                focus_dist: 212.5,
                ortho: true,
                ortho_width: 320.0,
            },
            materials: vec![
                Material::default(),
                Material {
                    kind: 2,
                    base_color: Rgb::new(0.9, 0.5, 0.1),
                    metallic: 1.0,
                    roughness: 0.2,
                    ior: 1.33,
                    transmission: 0.25,
                    coat: 0.5,
                    coat_roughness: 0.05,
                    emission: Rgb::new(1.0, 0.9, 0.8),
                    emission_power: 12.0,
                    flags: 1,
                    opacity: 0.75,
                    anisotropy: 0.4,
                    absorption_mm: 25.0,
                },
            ],
            geometry: Geometry::from_meshes(vec![
                Mesh::new(
                    &[
                        Vec3::new(0.0, 0.0, 0.0),
                        Vec3::new(1.0, 0.0, 0.0),
                        Vec3::new(0.0, 1.0, 0.0),
                        Vec3::new(1.0, 1.0, 0.0),
                    ],
                    &[Vec3::new(0.0, 0.0, 1.0); 4],
                    &[0, 1, 2, 2, 1, 3],
                    1,
                )
                .unwrap(),
                Mesh::new(
                    &[Vec3::new(5.0, 5.0, 5.0); 3],
                    &[Vec3::ZERO; 3],
                    &[0, 1, 2],
                    0,
                )
                .unwrap(),
            ]),
            lights: vec![
                Light::default(),
                Light {
                    kind: LightKind::Sun,
                    position: Vec3::new(1.0, 2.0, 3.0),
                    direction: Vec3::new(0.3, 0.2, -0.9),
                    up: Vec3::new(0.0, 1.0, 0.0),
                    size_x: 10.0,
                    size_y: 20.0,
                    color: Rgb::new(1.0, 0.95, 0.9),
                    power: 3.5,
                    spread_deg: 45.0,
                    angle_deg: 0.53,
                    flags: LIGHT_FLAG_GLOSSY | LIGHT_FLAG_CAMERA,
                },
                Light {
                    kind: LightKind::Disk,
                    flags: 0,
                    ..Light::default()
                },
                Light {
                    kind: LightKind::Spot,
                    spread_deg: 30.0,
                    ..Light::default()
                },
            ],
            environment: Environment {
                kind: EnvKind::Flat,
                floor: 0.2,
                horizon: 0.4,
                zenith: 0.8,
                strength: 1.5,
                rotation_deg: 90.0,
                background_color: Rgb::new(0.1, 0.2, 0.3),
                background_mode: 1,
                hdri_map: 1,
                backplate_map: 0,
                backplate_fit: crate::scene::BACKPLATE_FIT,
                sky_turbidity: 4.5,
                sky_model: SkyModel::Classic,
                sun_azimuth_deg: -30.0,
                sun_elevation_deg: 12.0,
                backplate_rect: [0.1, 0.05, 0.9, 0.95],
            },
            floor: Floor {
                mode: FloorMode::ShadowCatcher,
                z: -12.5,
                color: Rgb::new(0.4, 0.5, 0.6),
            },
            render: RenderSettings {
                width: 1920,
                height: 1080,
                max_samples: 256,
                seed: 77,
                max_seconds: 12.5,
                exposure_ev: -0.5,
                tonemap: 3,
                max_depth: 12,
                clamp_indirect: 10.0,
                passes: 0b10_1101,
            },
            bitmaps: test_bitmaps(),
        }
    }

    /// A raw sRGB plate (odd byte length: padded in the file) and a little Radiance HDR file.
    fn test_bitmaps() -> Vec<Bitmap> {
        let plate = Bitmap::decode(
            crate::bitmap::FORMAT_RGB8,
            3,
            1,
            vec![10, 20, 30, 40, 50, 60, 70, 80, 90],
        )
        .unwrap();
        let rgb: Vec<f32> = (0..3 * 8 * 2).map(|i| i as f32 * 0.25).collect();
        let file = crate::hdr::encode(8, 2, &rgb);
        let hdr = Bitmap::decode(crate::bitmap::FORMAT_HDR, 0, 0, file).unwrap();
        vec![plate, hdr]
    }

    /// Splits a serialised file into its sections `(tag, payload)`.
    fn sections(bytes: &[u8]) -> Vec<([u8; 4], Vec<u8>)> {
        let mut pos = 8;
        let mut out = Vec::new();
        while pos < bytes.len() {
            let tag = [bytes[pos], bytes[pos + 1], bytes[pos + 2], bytes[pos + 3]];
            let len = u32::from_le_bytes(bytes[pos + 4..pos + 8].try_into().unwrap()) as usize;
            out.push((tag, bytes[pos + 8..pos + 8 + len].to_vec()));
            pos += 8 + len;
        }
        out
    }

    fn unknown_section(tag: &[u8; 4], payload: &[u8]) -> Vec<u8> {
        let mut s = tag.to_vec();
        s.extend_from_slice(&(payload.len() as u32).to_le_bytes());
        s.extend_from_slice(payload);
        s
    }

    #[test]
    fn round_trips_every_section() {
        let scene = full_scene();
        let bytes = scene.to_rsb();
        assert_eq!(&bytes[..4], b"RSB1");
        assert_eq!(&bytes[4..8], &[0, 0, 0, 0]);
        let tags: Vec<[u8; 4]> = sections(&bytes).into_iter().map(|(t, _)| t).collect();
        assert_eq!(
            tags,
            [
                *b"CAMR", *b"MATL", *b"MATL", *b"MESH", *b"MESH", *b"LGHT", *b"LGHT", *b"LGHT",
                *b"LGHT", *b"BMAP", *b"BMAP", *b"ENVR", *b"FLOR", *b"RNDR"
            ]
        );
        assert_eq!(Scene::from_rsb(&bytes), Ok(scene));
    }

    #[test]
    fn section_payload_sizes_match_the_documented_layout() {
        let bytes = full_scene().to_rsb();
        let size = |wanted: &[u8; 4]| {
            sections(&bytes)
                .into_iter()
                .find(|(t, _)| t == wanted)
                .map(|(_, p)| p.len())
        };
        assert_eq!(size(b"CAMR"), Some(15 * 4));
        assert_eq!(size(b"MATL"), Some(18 * 4));
        assert_eq!(size(b"LGHT"), Some(19 * 4));
        assert_eq!(size(b"ENVR"), Some(21 * 4));
        // The first bitmap: 16 bytes of header and 9 of data, padded to 12.
        assert_eq!(size(b"BMAP"), Some(16 + 12));
        assert_eq!(size(b"FLOR"), Some(5 * 4));
        assert_eq!(size(b"RNDR"), Some(10 * 4));
        // First mesh: 4 vertices, 6 indices: 2 + 4 * 6 + 6 + 1 words.
        assert_eq!(sections(&bytes)[3].1.len(), (2 + 24 + 6 + 1) * 4);
    }

    #[test]
    fn unknown_sections_are_skipped_anywhere() {
        let scene = full_scene();
        let bytes = scene.to_rsb();
        let parts = sections(&bytes);
        // Rebuild the file with an unknown section before, between and after the known ones.
        let mut spliced = bytes[..8].to_vec();
        spliced.extend(unknown_section(b"XTRA", &[1, 2, 3]));
        for (i, (tag, payload)) in parts.iter().enumerate() {
            spliced.extend(unknown_section(tag, payload));
            if i == 3 {
                spliced.extend(unknown_section(b"\0\0\0\0", &[]));
            }
        }
        spliced.extend(unknown_section(b"FUTR", &[9; 100]));
        assert_eq!(Scene::from_rsb(&spliced), Ok(scene));
    }

    #[test]
    fn extra_header_bytes_and_trailing_section_bytes_are_ignored() {
        let scene = full_scene();
        let bytes = scene.to_rsb();
        let mut with_header = bytes[..4].to_vec();
        with_header.extend_from_slice(&6u32.to_le_bytes());
        with_header.extend_from_slice(&[7; 6]);
        with_header.extend_from_slice(&bytes[8..]);
        assert_eq!(Scene::from_rsb(&with_header), Ok(scene.clone()));

        // A newer writer appended a field to RNDR.
        let mut extended = bytes[..8].to_vec();
        for (tag, mut payload) in sections(&bytes) {
            if tag == TAG_RNDR {
                payload.extend_from_slice(&42u32.to_le_bytes());
            }
            extended.extend(unknown_section(&tag, &payload));
        }
        assert_eq!(Scene::from_rsb(&extended), Ok(scene));
    }

    #[test]
    fn sections_written_before_e3_read_with_defaults() {
        // MATL without flags (56 B) and RNDR without max_depth and clamp_indirect (28 B), as E1
        // and E2 wrote them; no FLOR section.
        let scene = full_scene();
        let bytes = scene.to_rsb();
        let mut old = bytes[..8].to_vec();
        for (tag, mut payload) in sections(&bytes) {
            match tag {
                TAG_MATL => payload.truncate(56),
                TAG_RNDR => payload.truncate(28),
                TAG_FLOR => continue,
                _ => {}
            }
            old.extend(unknown_section(&tag, &payload));
        }
        let read = Scene::from_rsb(&old).expect("old layout reads");
        assert!(read.materials.iter().all(|m| m.flags == 0));
        assert!(read
            .materials
            .iter()
            .all(|m| m.opacity == 1.0 && m.anisotropy == 0.0));
        assert_eq!(read.render.max_depth, RenderSettings::DEFAULT_MAX_DEPTH);
        assert_eq!(read.render.clamp_indirect, 0.0);
        assert_eq!(read.floor, Floor::default());
        assert_eq!(read.render.tonemap, scene.render.tonemap);
        assert_eq!(read.lights, scene.lights);
    }

    #[test]
    fn sections_written_before_e5_read_with_defaults() {
        // MATL of 60 B (no opacity, anisotropy, absorption), ENVR of 40 B, no BMAP.
        let scene = full_scene();
        let bytes = scene.to_rsb();
        let mut old = bytes[..8].to_vec();
        for (tag, mut payload) in sections(&bytes) {
            match tag {
                TAG_MATL => payload.truncate(60),
                TAG_ENVR => payload.truncate(40),
                TAG_BMAP => continue,
                _ => {}
            }
            old.extend(unknown_section(&tag, &payload));
        }
        let read = Scene::from_rsb(&old).expect("E4 layout reads");
        assert!(read.bitmaps.is_empty());
        let m = &read.materials[1];
        assert_eq!((m.opacity, m.anisotropy, m.absorption_mm), (1.0, 0.0, 0.0));
        assert_eq!(m.flags, 1);
        let e = &read.environment;
        assert_eq!(
            (e.hdri_map, e.backplate_map, e.backplate_fit),
            (NO_BITMAP, NO_BITMAP, 0)
        );
        assert_eq!(e.sky_turbidity, crate::sky::DEFAULT_TURBIDITY);
        assert_eq!((e.sun_azimuth_deg, e.sun_elevation_deg), (0.0, 45.0));
        assert_eq!(e.backplate_rect, [0.0, 0.0, 1.0, 1.0]);
        assert_eq!(e.background_mode, scene.environment.background_mode);
        assert_eq!(e.sky_model, SkyModel::Physical);
    }

    #[test]
    fn the_sky_model_is_physical_unless_the_file_says_classic() {
        // An E5 file (ENVR of 80 B) has no sky model: it reads as the default, the physical sky.
        let scene = full_scene();
        assert_eq!(scene.environment.sky_model, SkyModel::Classic);
        let bytes = scene.to_rsb();
        let with_envr = |edit: &dyn Fn(&mut Vec<u8>)| {
            let mut out = bytes[..8].to_vec();
            for (tag, mut payload) in sections(&bytes) {
                if tag == TAG_ENVR {
                    edit(&mut payload);
                }
                out.extend(unknown_section(&tag, &payload));
            }
            Scene::from_rsb(&out).expect("reads")
        };
        let e5 = with_envr(&|p| p.truncate(80));
        assert_eq!(e5.environment.sky_model, SkyModel::Physical);
        assert_eq!(
            Environment {
                sky_model: SkyModel::Classic,
                ..e5.environment.clone()
            },
            scene.environment
        );
        // The field itself: 1 is classic, 0 and unknown values the physical sky.
        for (value, model) in [
            (0u32, SkyModel::Physical),
            (1, SkyModel::Classic),
            (7, SkyModel::Physical),
        ] {
            let read = with_envr(&|p| p[80..84].copy_from_slice(&value.to_le_bytes()));
            assert_eq!(read.environment.sky_model, model, "{value}");
        }
        assert_eq!(Environment::default().sky_model, SkyModel::Physical);
    }

    #[test]
    fn a_render_section_written_before_x2_asks_for_no_passes() {
        // RNDR of 36 B (no pass mask), as E3 to E5 wrote it.
        let scene = full_scene();
        assert_ne!(scene.render.passes, 0);
        let bytes = scene.to_rsb();
        let mut old = bytes[..8].to_vec();
        for (tag, mut payload) in sections(&bytes) {
            if tag == TAG_RNDR {
                assert_eq!(payload.len(), 40);
                assert_eq!(payload[36..40], scene.render.passes.to_le_bytes());
                payload.truncate(36);
            }
            old.extend(unknown_section(&tag, &payload));
        }
        let read = Scene::from_rsb(&old).expect("E5 layout reads");
        assert_eq!(read.render.passes, 0);
        assert_eq!(read.render.clamp_indirect, scene.render.clamp_indirect);
        // Bits nobody knows yet are kept as they are (a newer writer's passes).
        let mut newer = scene.clone();
        newer.render.passes = 0xffff_ffff;
        assert_eq!(Scene::from_rsb(&newer.to_rsb()), Ok(newer));
    }

    #[test]
    fn bitmaps_must_decode_and_be_referred_to_correctly() {
        let good = full_scene().to_rsb();
        let rebuild = |edit: &dyn Fn(&[u8; 4], &mut Vec<u8>)| {
            let mut out = good[..8].to_vec();
            for (tag, mut payload) in sections(&good) {
                edit(&tag, &mut payload);
                out.extend(unknown_section(&tag, &payload));
            }
            out
        };
        // A raw plate whose size does not match its bytes.
        let bad_size = rebuild(&|tag, p| {
            if *tag == TAG_BMAP && p[0] == 0 {
                p[4..8].copy_from_slice(&7u32.to_le_bytes());
            }
        });
        assert!(matches!(
            Scene::from_rsb(&bad_size),
            Err(RsbError::Invalid { tag: TAG_BMAP, .. })
        ));
        // A byte length beyond the section.
        let long = rebuild(&|tag, p| {
            if *tag == TAG_BMAP && p[0] == 0 {
                p[12..16].copy_from_slice(&1000u32.to_le_bytes());
            }
        });
        assert_eq!(
            Scene::from_rsb(&long),
            Err(RsbError::SectionTooShort { tag: TAG_BMAP })
        );
        // A broken HDR file.
        let broken = rebuild(&|tag, p| {
            if *tag == TAG_BMAP && p[0] == 16 {
                p[16] = b'X';
            }
        });
        assert!(matches!(
            Scene::from_rsb(&broken),
            Err(RsbError::Invalid { tag: TAG_BMAP, .. })
        ));
        // The environment refers to a bitmap that is not there.
        let dangling = rebuild(&|tag, p| {
            if *tag == TAG_ENVR {
                p[40..44].copy_from_slice(&2u32.to_le_bytes());
            }
        });
        assert!(matches!(
            Scene::from_rsb(&dangling),
            Err(RsbError::Invalid { tag: TAG_ENVR, .. })
        ));
    }

    #[test]
    fn updates_without_bitmaps_keep_the_loaded_ones() {
        let mut scene = full_scene();
        let mut next = full_scene();
        next.environment.strength = 3.0;
        next.environment.rotation_deg = 45.0;
        let update: Vec<u8> = {
            let bytes = next.to_rsb();
            let mut out = bytes[..8].to_vec();
            for (tag, payload) in sections(&bytes) {
                if tag != TAG_BMAP && tag != TAG_MESH {
                    out.extend(unknown_section(&tag, &payload));
                }
            }
            out
        };
        assert!(Scene::from_rsb(&update).is_err(), "alone its maps dangle");
        scene.update_from_rsb(&update).expect("update");
        assert_eq!(scene, next);
        // New bitmaps replace the loaded ones, the meshes stay.
        let mut other = full_scene();
        other.bitmaps.swap(0, 1);
        other.environment.hdri_map = 0;
        other.environment.backplate_map = 1;
        let bytes = other.to_rsb();
        let mut no_mesh = bytes[..8].to_vec();
        for (tag, payload) in sections(&bytes) {
            if tag != TAG_MESH {
                no_mesh.extend(unknown_section(&tag, &payload));
            }
        }
        scene
            .update_from_rsb(&no_mesh)
            .expect("update with bitmaps");
        assert_eq!(scene, other);
    }

    #[test]
    fn reserved_kinds_round_trip_and_bad_floors_fail() {
        // Point and spot lights (L4), sky and HDRI environments (E5) are kept verbatim.
        let mut scene = full_scene();
        scene.lights.push(Light {
            kind: LightKind::Point,
            ..Light::default()
        });
        scene.environment.kind = EnvKind::Hdri;
        scene.environment.background_mode = 3;
        scene.materials[0].kind = 1;
        assert_eq!(Scene::from_rsb(&scene.to_rsb()), Ok(scene.clone()));
        scene.environment.kind = EnvKind::Sky;
        assert_eq!(Scene::from_rsb(&scene.to_rsb()), Ok(scene.clone()));

        let good = scene.to_rsb();
        let rebuild = |edit: &dyn Fn(&mut Vec<u8>)| {
            let mut out = good[..8].to_vec();
            for (tag, mut payload) in sections(&good) {
                if tag == TAG_FLOR {
                    edit(&mut payload);
                }
                out.extend(unknown_section(&tag, &payload));
            }
            out
        };
        assert!(matches!(
            Scene::from_rsb(&rebuild(&|p| p[0..4].copy_from_slice(&3u32.to_le_bytes()))),
            Err(RsbError::Invalid { tag: TAG_FLOR, .. })
        ));
        assert_eq!(
            Scene::from_rsb(&rebuild(&|p| p.truncate(12))),
            Err(RsbError::SectionTooShort { tag: TAG_FLOR })
        );
        let mut doubled = good.clone();
        let flor = sections(&good)
            .into_iter()
            .find(|(t, _)| *t == TAG_FLOR)
            .unwrap();
        doubled.extend(unknown_section(&flor.0, &flor.1));
        assert_eq!(
            Scene::from_rsb(&doubled),
            Err(RsbError::DuplicateSection { tag: TAG_FLOR })
        );
    }

    #[test]
    fn missing_singleton_sections_mean_defaults() {
        let bytes = Scene::default().to_rsb();
        let only_header = bytes[..8].to_vec();
        assert_eq!(Scene::from_rsb(&only_header), Ok(Scene::default()));
    }

    #[test]
    fn rejects_bad_magic_and_short_input() {
        assert_eq!(Scene::from_rsb(b""), Err(RsbError::BadMagic));
        assert_eq!(Scene::from_rsb(b"RSB2\0\0\0\0"), Err(RsbError::BadMagic));
        assert_eq!(
            Scene::from_rsb(b"RSB1"),
            Err(RsbError::Truncated { what: "header" })
        );
        // header_len points past the end of the file.
        assert_eq!(
            Scene::from_rsb(b"RSB1\x10\0\0\0abc"),
            Err(RsbError::Truncated { what: "header" })
        );
    }

    #[test]
    fn truncation_never_panics_and_cuts_inside_a_section_fail() {
        let bytes = full_scene().to_rsb();
        let boundaries: Vec<usize> = {
            let mut b = vec![8];
            for (_, p) in sections(&bytes) {
                b.push(b.last().unwrap() + 8 + p.len());
            }
            b
        };
        for cut in 0..bytes.len() {
            let result = Scene::from_rsb(&bytes[..cut]);
            if boundaries.contains(&cut) && cut >= 8 {
                // A clean cut between sections is a valid, smaller file, unless a mesh now
                // refers to a material that was cut away.
                continue;
            }
            assert!(result.is_err(), "cut at {cut} should fail");
        }
    }

    #[test]
    fn rejects_duplicate_singletons() {
        let bytes = full_scene().to_rsb();
        let camr = sections(&bytes)
            .into_iter()
            .find(|(t, _)| *t == TAG_CAMR)
            .unwrap();
        let mut doubled = bytes.clone();
        doubled.extend(unknown_section(&camr.0, &camr.1));
        assert_eq!(
            Scene::from_rsb(&doubled),
            Err(RsbError::DuplicateSection { tag: TAG_CAMR })
        );
    }

    #[test]
    fn rejects_short_payloads_and_bad_values() {
        let good = full_scene().to_rsb();
        let rebuild = |edit: &dyn Fn(&[u8; 4], &mut Vec<u8>)| {
            let mut out = good[..8].to_vec();
            for (tag, mut payload) in sections(&good) {
                edit(&tag, &mut payload);
                out.extend(unknown_section(&tag, &payload));
            }
            out
        };

        let short_camera = rebuild(&|tag, p| {
            if *tag == TAG_CAMR {
                p.truncate(20);
            }
        });
        assert_eq!(
            Scene::from_rsb(&short_camera),
            Err(RsbError::SectionTooShort { tag: TAG_CAMR })
        );

        let nan = rebuild(&|tag, p| {
            if *tag == TAG_MATL {
                p[4..8].copy_from_slice(&f32::NAN.to_le_bytes());
            }
        });
        assert!(matches!(
            Scene::from_rsb(&nan),
            Err(RsbError::Invalid { tag: TAG_MATL, .. })
        ));

        let negative_clamp = rebuild(&|tag, p| {
            if *tag == TAG_RNDR {
                p[32..36].copy_from_slice(&(-1.0f32).to_le_bytes());
            }
        });
        assert!(matches!(
            Scene::from_rsb(&negative_clamp),
            Err(RsbError::Invalid { tag: TAG_RNDR, .. })
        ));

        let zero_width = rebuild(&|tag, p| {
            if *tag == TAG_RNDR {
                p[0..4].copy_from_slice(&0u32.to_le_bytes());
            }
        });
        assert!(matches!(
            Scene::from_rsb(&zero_width),
            Err(RsbError::Invalid { tag: TAG_RNDR, .. })
        ));

        let huge = rebuild(&|tag, p| {
            if *tag == TAG_RNDR {
                p[4..8].copy_from_slice(&1_000_000u32.to_le_bytes());
            }
        });
        assert!(matches!(
            Scene::from_rsb(&huge),
            Err(RsbError::Invalid { tag: TAG_RNDR, .. })
        ));

        let bad_light = rebuild(&|tag, p| {
            if *tag == TAG_LGHT {
                p[0..4].copy_from_slice(&9u32.to_le_bytes());
            }
        });
        assert!(matches!(
            Scene::from_rsb(&bad_light),
            Err(RsbError::Invalid { tag: TAG_LGHT, .. })
        ));

        let bad_env = rebuild(&|tag, p| {
            if *tag == TAG_ENVR {
                p[0..4].copy_from_slice(&5u32.to_le_bytes());
            }
        });
        assert!(matches!(
            Scene::from_rsb(&bad_env),
            Err(RsbError::Invalid { tag: TAG_ENVR, .. })
        ));

        let bad_focal = rebuild(&|tag, p| {
            if *tag == TAG_CAMR {
                p[36..40].copy_from_slice(&0.0f32.to_le_bytes());
            }
        });
        assert!(matches!(
            Scene::from_rsb(&bad_focal),
            Err(RsbError::Invalid { tag: TAG_CAMR, .. })
        ));
    }

    #[test]
    fn rejects_inconsistent_meshes() {
        let mesh_bytes = |vertices: u32, indices: &[u32], material: u32| {
            let mut file = b"RSB1\0\0\0\0".to_vec();
            let mut p = Vec::new();
            p.extend_from_slice(&vertices.to_le_bytes());
            p.extend_from_slice(&(indices.len() as u32).to_le_bytes());
            p.extend(vec![0u8; vertices as usize * 24]);
            for i in indices {
                p.extend_from_slice(&i.to_le_bytes());
            }
            p.extend_from_slice(&material.to_le_bytes());
            file.extend(unknown_section(&TAG_MESH, &p));
            file.extend(unknown_section(&TAG_MATL, &Material::to_bytes_for_test()));
            file
        };
        assert!(Scene::from_rsb(&mesh_bytes(3, &[0, 1, 2], 0)).is_ok());
        // Index out of range.
        assert!(matches!(
            Scene::from_rsb(&mesh_bytes(3, &[0, 1, 3], 0)),
            Err(RsbError::Invalid { tag: TAG_MESH, .. })
        ));
        // Not a multiple of three.
        assert!(matches!(
            Scene::from_rsb(&mesh_bytes(3, &[0, 1], 0)),
            Err(RsbError::Invalid { tag: TAG_MESH, .. })
        ));
        // Unknown material.
        assert!(matches!(
            Scene::from_rsb(&mesh_bytes(3, &[0, 1, 2], 1)),
            Err(RsbError::Invalid { tag: TAG_MESH, .. })
        ));
    }

    /// `full_scene` with explicit instances: the first mesh twice, the second once.
    fn instanced_scene() -> Scene {
        let mut scene = full_scene();
        let meshes = scene.geometry.meshes().to_vec();
        let moved = Transform::from_rows([
            [0.0, -1.0, 0.0, 10.0],
            [2.0, 0.0, 0.0, -5.0],
            [0.0, 0.0, 0.5, 1.25],
        ]);
        let instances = vec![
            Instance::new(0, Transform::IDENTITY, 1),
            Instance {
                flags: crate::scene::INSTANCE_ONE_SIDED,
                ..Instance::new(0, moved, 0)
            },
            Instance::new(1, Transform::translation(Vec3::new(1.0, 2.0, 3.0)), 1),
        ];
        scene.geometry = Geometry::new(meshes, instances).unwrap();
        scene
    }

    #[test]
    fn instances_round_trip_and_implicit_ones_are_not_written() {
        let scene = instanced_scene();
        let bytes = scene.to_rsb();
        let inst: Vec<Vec<u8>> = sections(&bytes)
            .into_iter()
            .filter(|(t, _)| *t == TAG_INST)
            .map(|(_, p)| p)
            .collect();
        assert_eq!(inst.len(), 3);
        assert!(inst.iter().all(|p| p.len() == 15 * 4));
        assert_eq!(Scene::from_rsb(&bytes), Ok(scene));
        // Without explicit instances the file has no INST section and reads back the same.
        let plain = full_scene().to_rsb();
        assert!(sections(&plain).iter().all(|(t, _)| *t != TAG_INST));
        let read = Scene::from_rsb(&plain).unwrap();
        assert!(read.geometry.has_implicit_instances());
        assert_eq!(read.geometry.instances().len(), 2);
    }

    #[test]
    fn instances_must_refer_to_existing_meshes_and_materials() {
        let good = instanced_scene().to_rsb();
        let rebuild = |edit: &dyn Fn(&mut Vec<u8>)| {
            let mut out = good[..8].to_vec();
            for (tag, mut payload) in sections(&good) {
                if tag == TAG_INST {
                    edit(&mut payload);
                }
                out.extend(unknown_section(&tag, &payload));
            }
            out
        };
        let bad_mesh = rebuild(&|p| p[0..4].copy_from_slice(&7u32.to_le_bytes()));
        assert_eq!(
            Scene::from_rsb(&bad_mesh),
            Err(RsbError::Invalid {
                tag: TAG_INST,
                reason: "mesh_id does not refer to a MESH section"
            })
        );
        let bad_material = rebuild(&|p| p[52..56].copy_from_slice(&9u32.to_le_bytes()));
        assert!(matches!(
            Scene::from_rsb(&bad_material),
            Err(RsbError::Invalid { tag: TAG_INST, .. })
        ));
        let nan = rebuild(&|p| p[8..12].copy_from_slice(&f32::NAN.to_le_bytes()));
        assert!(matches!(
            Scene::from_rsb(&nan),
            Err(RsbError::Invalid { tag: TAG_INST, .. })
        ));
        let short = rebuild(&|p| p.truncate(40));
        assert_eq!(
            Scene::from_rsb(&short),
            Err(RsbError::SectionTooShort { tag: TAG_INST })
        );
    }

    /// `bytes` without its `MESH` sections.
    fn without_meshes(bytes: &[u8]) -> Vec<u8> {
        let mut out = bytes[..8].to_vec();
        for (tag, payload) in sections(bytes) {
            if tag != TAG_MESH {
                out.extend(unknown_section(&tag, &payload));
            }
        }
        out
    }

    #[test]
    fn updates_without_meshes_keep_the_loaded_meshes() {
        let mut scene = instanced_scene();
        // The next state: another camera and image size, one more material, other instances.
        let mut next = instanced_scene();
        next.camera.focal_mm = 35.0;
        next.render.width = 320;
        next.render.height = 180;
        next.materials.push(Material {
            roughness: 0.9,
            ..Material::default()
        });
        let instances = vec![
            Instance::new(1, Transform::translation(Vec3::new(0.0, 0.0, 7.0)), 2),
            Instance::new(0, Transform::IDENTITY, 0),
        ];
        next.geometry = Geometry::new(next.geometry.meshes().to_vec(), instances).unwrap();
        let update = without_meshes(&next.to_rsb());
        assert!(sections(&update).iter().all(|(t, _)| *t != TAG_MESH));
        assert!(Scene::from_rsb(&update).is_err(), "alone it lacks meshes");
        scene.update_from_rsb(&update).expect("update");
        assert_eq!(scene, next);

        // Without INST sections either: the implicit instances of the kept meshes.
        let plain = full_scene();
        scene
            .update_from_rsb(&without_meshes(&plain.to_rsb()))
            .expect("update");
        assert_eq!(scene, plain);
        assert!(scene.geometry.has_implicit_instances());

        // A file with meshes replaces everything, like from_rsb.
        let mut other = full_scene();
        other.geometry = Geometry::from_meshes(vec![Mesh::new(
            &[
                Vec3::ZERO,
                Vec3::new(1.0, 0.0, 0.0),
                Vec3::new(0.0, 1.0, 0.0),
            ],
            &[],
            &[0, 1, 2],
            0,
        )
        .unwrap()]);
        scene.update_from_rsb(&other.to_rsb()).expect("full update");
        assert_eq!(scene, other);
    }

    #[test]
    fn failed_updates_leave_the_scene_unchanged() {
        let mut scene = instanced_scene();
        let before = scene.clone();
        let good = without_meshes(&instanced_scene().to_rsb());
        let rebuild = |edit: &dyn Fn(&[u8; 4], &mut Vec<u8>)| {
            let mut out = good[..8].to_vec();
            for (tag, mut payload) in sections(&good) {
                edit(&tag, &mut payload);
                out.extend(unknown_section(&tag, &payload));
            }
            out
        };
        // An instance of a mesh the scene does not have.
        let bad_mesh = rebuild(&|tag, p| {
            if *tag == TAG_INST {
                p[0..4].copy_from_slice(&7u32.to_le_bytes());
            }
        });
        assert!(matches!(
            scene.update_from_rsb(&bad_mesh),
            Err(RsbError::Invalid { tag: TAG_INST, .. })
        ));
        assert_eq!(scene, before);
        // Fewer materials than the kept meshes refer to (the second mesh uses material 1).
        let mut one_material = good[..8].to_vec();
        let mut first = true;
        for (tag, payload) in sections(&good) {
            if tag == TAG_INST {
                continue;
            }
            if tag == TAG_MATL {
                if !first {
                    continue;
                }
                first = false;
            }
            one_material.extend(unknown_section(&tag, &payload));
        }
        assert!(matches!(
            scene.update_from_rsb(&one_material),
            Err(RsbError::Invalid { tag: TAG_MESH, .. })
        ));
        assert_eq!(scene, before);
        // Garbage.
        assert_eq!(scene.update_from_rsb(b"nope"), Err(RsbError::BadMagic));
        assert_eq!(scene, before);
    }

    #[test]
    fn lying_mesh_counts_fail_without_allocating() {
        let mut file = b"RSB1\0\0\0\0".to_vec();
        let mut p = Vec::new();
        p.extend_from_slice(&u32::MAX.to_le_bytes());
        p.extend_from_slice(&u32::MAX.to_le_bytes());
        file.extend(unknown_section(&TAG_MESH, &p));
        assert_eq!(
            Scene::from_rsb(&file),
            Err(RsbError::SectionTooShort { tag: TAG_MESH })
        );
    }

    #[test]
    fn errors_display_readable_messages() {
        assert_eq!(
            RsbError::BadMagic.to_string(),
            "not an RSB file (missing RSB1 magic)"
        );
        assert_eq!(
            RsbError::Truncated { what: "header" }.to_string(),
            "RSB file is truncated in header"
        );
        assert_eq!(
            RsbError::SectionTooShort { tag: *b"CAMR" }.to_string(),
            "RSB section CAMR is shorter than its layout requires"
        );
        assert_eq!(
            RsbError::DuplicateSection { tag: *b"RNDR" }.to_string(),
            "RSB section RNDR appears more than once"
        );
        assert_eq!(
            RsbError::Invalid {
                tag: *b"MESH",
                reason: "vertex index out of range"
            }
            .to_string(),
            "RSB section MESH is invalid: vertex index out of range"
        );
        assert_eq!(
            RsbError::Invalid {
                tag: [0, b'A', 7, b'B'],
                reason: "x"
            }
            .to_string(),
            "RSB section ?A?B is invalid: x"
        );
    }

    impl Material {
        /// Serialised default material payload, for tests that hand-build files.
        fn to_bytes_for_test() -> Vec<u8> {
            let scene = Scene {
                materials: vec![Material::default()],
                ..Scene::default()
            };
            sections(&scene.to_rsb())
                .into_iter()
                .find(|(t, _)| *t == TAG_MATL)
                .unwrap()
                .1
        }
    }
}
