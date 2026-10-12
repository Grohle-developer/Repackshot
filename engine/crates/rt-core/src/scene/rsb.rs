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
//! Section payloads (`[3]` means three consecutive values; sizes are the minimum payload length):
//!
//! ```text
//! CAMR  60 B  f32 position[3] target[3] up[3]; f32 focal_mm sensor_mm fstop focus_dist;
//!             u32 ortho_flag; f32 ortho_width
//! MESH  var.  u32 vertex_count index_count; f32 positions[3n] normals[3n]; u32 indices[m];
//!             u32 material_id                      (n = vertex_count, m = index_count)
//! MATL  56 B  u32 kind; f32 base_color[3] metallic roughness ior transmission coat
//!             coat_roughness emission[3] emission_power
//! LGHT  76 B  u32 kind (0 rect, 1 disk, 2 sun); f32 position[3] direction[3] up[3] size_x size_y
//!             color[3] power spread_deg angle_deg; u32 flags (1 glossy, 2 camera)
//! ENVR  40 B  u32 kind (0 studio, 1 flat); f32 floor horizon zenith strength rotation_deg
//!             background_color[3]; u32 background_mode
//! RNDR  28 B  u32 width height max_samples seed; f32 max_seconds exposure_ev; u32 tonemap
//! ```
//!
//! `CAMR`, `ENVR` and `RNDR` may appear at most once (a missing one means "defaults");
//! `MESH`, `MATL` and `LGHT` repeat. A mesh refers to a material by its position among the `MATL`
//! sections, wherever they are in the file. All floats must be finite.

use super::{
    Camera, EnvKind, Environment, Light, LightKind, Material, Mesh, RenderSettings, Scene,
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
    Ok(Mesh {
        positions,
        normals,
        indices,
        material_id: r.u32()?,
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
    };
    let range = 1..=RenderSettings::MAX_DIMENSION;
    if !range.contains(&settings.width) || !range.contains(&settings.height) {
        return Err(r.invalid("width and height must be between 1 and 16384"));
    }
    if settings.max_seconds < 0.0 {
        return Err(r.invalid("max_seconds must not be negative"));
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

impl Scene {
    /// Parses an RSB file. See the [module documentation](self) for the format.
    pub fn from_rsb(bytes: &[u8]) -> Result<Scene, RsbError> {
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
        let mut render = None;
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
                TAG_RNDR => set_once(&mut render, tag, parse_render(&mut r)?)?,
                TAG_MESH => scene.meshes.push(parse_mesh(&mut r)?),
                TAG_MATL => scene.materials.push(parse_material(&mut r)?),
                TAG_LGHT => scene.lights.push(parse_light(&mut r)?),
                _ => {} // Unknown section: skipped for forward compatibility.
            }
        }

        if scene
            .meshes
            .iter()
            .any(|m| m.material_id as usize >= scene.materials.len())
        {
            return Err(RsbError::Invalid {
                tag: TAG_MESH,
                reason: "material_id does not refer to a MATL section",
            });
        }
        scene.camera = camera.unwrap_or_default();
        scene.environment = environment.unwrap_or_default();
        scene.render = render.unwrap_or_default();
        Ok(scene)
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
            });
        }
        for mesh in &self.meshes {
            w.section(TAG_MESH, |w| {
                w.u32(mesh.positions.len() as u32);
                w.u32(mesh.indices.len() as u32);
                for &p in &mesh.positions {
                    w.vec3(p);
                }
                for &n in &mesh.normals {
                    w.vec3(n);
                }
                for &i in &mesh.indices {
                    w.u32(i);
                }
                w.u32(mesh.material_id);
            });
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
        w.section(TAG_ENVR, |w| {
            let e = &self.environment;
            w.u32(e.kind.to_u32());
            for v in [e.floor, e.horizon, e.zenith, e.strength, e.rotation_deg] {
                w.f32(v);
            }
            w.rgb(e.background_color);
            w.u32(e.background_mode);
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
                },
            ],
            meshes: vec![
                Mesh {
                    positions: vec![
                        Vec3::new(0.0, 0.0, 0.0),
                        Vec3::new(1.0, 0.0, 0.0),
                        Vec3::new(0.0, 1.0, 0.0),
                        Vec3::new(1.0, 1.0, 0.0),
                    ],
                    normals: vec![Vec3::new(0.0, 0.0, 1.0); 4],
                    indices: vec![0, 1, 2, 2, 1, 3],
                    material_id: 1,
                },
                Mesh {
                    positions: vec![Vec3::new(5.0, 5.0, 5.0); 3],
                    normals: vec![Vec3::ZERO; 3],
                    indices: vec![0, 1, 2],
                    material_id: 0,
                },
            ],
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
            },
            render: RenderSettings {
                width: 1920,
                height: 1080,
                max_samples: 256,
                seed: 77,
                max_seconds: 12.5,
                exposure_ev: -0.5,
                tonemap: 1,
            },
        }
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
                *b"ENVR", *b"RNDR"
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
        assert_eq!(size(b"MATL"), Some(14 * 4));
        assert_eq!(size(b"LGHT"), Some(19 * 4));
        assert_eq!(size(b"ENVR"), Some(10 * 4));
        assert_eq!(size(b"RNDR"), Some(7 * 4));
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
