//! Image textures and labels of the shading (M2b): the images of the RSB `IMGS` section with
//! their mipmaps ([`image`]), the projections that place them on a part ([`mapping`]) and what a
//! material's six slots and its labels make of a surface point ([`shade`]).
//!
//! The contract is the one the page writes (`src/io/rsb.ts`, ARCHITECTURE §5.2 *Textures in the
//! RSB*) and the Fast preview draws (`src/core/textures.ts`, whose functions are the reference the
//! tests pin, and `src/render/texture-shader.ts`), so that a texture lands where Fast draws it:
//!
//! * **Space.** The projections work in the part's own space: the mesh's coordinates (mm, Z up),
//!   whatever the instance's transform, so a texture moves, turns and scales with its part.
//!   Texture coordinates have **v up**; a texel is read at column `u · width` and row
//!   `(1 − v) · height` of the image's rows from the top.
//! * **Projections** ([`mapping::Mapping`]): UV (the mesh's set `uv_set`), box (the three axes
//!   blended by `|n|⁴` of the interpolated normal, never mirrored seen from outside), planar,
//!   cylindrical and spherical (one turn per repeat, the image's centre at the front, −T of the
//!   axis's cross-section); then `uv = R(rotation)·(c ⊙ repeat) + offset`, plus ½ for the
//!   projections. `size_mm` is what one repeat spans across; its height follows the image.
//! * **Values** ([`shade`]): the colour multiplies the base colour (an emitter's emission
//!   instead), roughness and metal multiply theirs, alpha multiplies the opacity (or cuts out
//!   below `cutoff`), emission adds `tint × image × strength` in radiance; a normal slot bends
//!   the shading normal in tangent space (the frame of the coordinates' surface gradients, as
//!   Fast's derivative frame does) or, as a height map, bumps it; labels lie over all that, in
//!   order, by their alpha, with their own finish.
//! * **Filtering** ([`image::TextureImage::sample`]): bilinear on the level that the ray's
//!   footprint asks for and trilinear between two (L. Williams, "Pyramidal Parametrics",
//!   SIGGRAPH 1983); the footprint of a camera ray comes from its ray differentials (H. Igehy,
//!   "Tracing Ray Differentials", SIGGRAPH 1999), that of a later ray from the width of the
//!   path's cone ([`shade::Footprint`]).
//!
//! Everything is `f32` with [`crate::fmath`]: the same bits on every platform and thread count.

pub mod image;
pub mod mapping;
pub mod shade;

pub use image::TextureImage;
pub use shade::{Footprint, TextureSetup, Textured};

use crate::color::Rgb;
use crate::math::Vec3;

/// Version of the `MATL` texture block this engine reads (its first word). A block of another
/// version is skipped, as a newer file's.
pub const TEXTURE_BLOCK_VERSION: u32 = 1;
/// Where the texture block of a `MATL` starts (after E9's fields).
pub const TEXTURE_BLOCK_OFFSET: usize = 100;
/// Number of slots of a texture block.
pub const SLOTS: usize = 6;
/// Slot 0: the colour (sRGB; multiplies the base colour, or tints an emitter).
pub const SLOT_COLOR: usize = 0;
/// Slot 1: the roughness (data; multiplies it).
pub const SLOT_ROUGHNESS: usize = 1;
/// Slot 2: the metal (data; multiplies it).
pub const SLOT_METAL: usize = 2;
/// Slot 3: the normal map, or a height map (data).
pub const SLOT_NORMAL: usize = 3;
/// Slot 4: the alpha (data; multiplies the opacity, or cuts out).
pub const SLOT_ALPHA: usize = 4;
/// Slot 5: the emission (sRGB; adds radiance).
pub const SLOT_EMISSION: usize = 5;

/// Slot `projection` 0: the mesh's UV coordinates.
pub const PROJECTION_UV: u32 = 0;
/// Slot `projection` 1: box (three planar projections blended by the normal).
pub const PROJECTION_BOX: u32 = 1;
/// Slot `projection` 2: planar, along `axis`.
pub const PROJECTION_PLANAR: u32 = 2;
/// Slot `projection` 3: cylindrical, about `axis`.
pub const PROJECTION_CYLINDRICAL: u32 = 3;
/// Slot `projection` 4: spherical, poles along `axis`.
pub const PROJECTION_SPHERICAL: u32 = 4;

/// Slot `axis` 0: X.
pub const AXIS_X: u32 = 0;
/// Slot `axis` 1: Y.
pub const AXIS_Y: u32 = 1;
/// Slot `axis` 2: Z.
pub const AXIS_Z: u32 = 2;

/// Slot `wrap` 0: repeat the image.
pub const WRAP_REPEAT: u32 = 0;
/// Slot `wrap` 1: hold its edge pixels.
pub const WRAP_CLAMP: u32 = 1;
/// Slot `wrap` 2: repeat it mirrored.
pub const WRAP_MIRROR: u32 = 2;

/// Slot `channel` 0 to 3: R, G, B, A; 4: the Rec. 709 luminance of the decoded colour.
pub const CHANNEL_LUMINANCE: u32 = 4;

/// Slot `flags` bit 0: `1 − value` (roughness, metal, alpha, a height map).
pub const SLOT_FLAG_INVERT: u32 = 1;
/// Slot `flags` bit 1: the alpha is a hard cut-out at `cutoff`.
pub const SLOT_FLAG_CUTOUT: u32 = 2;
/// Slot `flags` bit 2: the normal slot holds a height map (white `strength` mm high).
pub const SLOT_FLAG_HEIGHT: u32 = 4;

/// Height of a label's paper edge at relief 1, mm (the bump of its alpha; Fast's
/// `LABEL_RELIEF_MM`).
pub const LABEL_RELIEF_MM: f32 = 0.15;

/// How one slot of a material reads its image: the image and the mapping it uses (the slot's own
/// or the material's, resolved by the writer). See the RSB documentation for the layout.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct TextureSlot {
    /// Index into the scene's images (`IMGS`); `None` (−1 in the file): no image.
    pub image: Option<u32>,
    /// [`PROJECTION_UV`] … [`PROJECTION_SPHERICAL`].
    pub projection: u32,
    /// [`AXIS_X`], [`AXIS_Y`] or [`AXIS_Z`]: what a planar projection looks along, a cylinder's
    /// axis, the poles of a sphere.
    pub axis: u32,
    /// UV: the mesh's first (0) or second (1) set.
    pub uv_set: u32,
    /// Every projection but UV: millimetres one repeat spans across (its height follows the
    /// image's proportions; cylindrical: the circumference it is drawn for).
    pub size_mm: f32,
    /// Counter-clockwise in the image's plane, v up, degrees.
    pub rotation_deg: f32,
    /// Added after the turn, in repeats.
    pub offset: [f32; 2],
    /// Repeats per unit (UV) or per `size_mm`, along u and v.
    pub repeat: [f32; 2],
    /// [`WRAP_REPEAT`], [`WRAP_CLAMP`] or [`WRAP_MIRROR`].
    pub wrap: u32,
    /// The channel a scalar slot reads: 0 R, 1 G, 2 B, 3 A, [`CHANNEL_LUMINANCE`].
    pub channel: u32,
    /// `SLOT_FLAG_*` bits.
    pub flags: u32,
    /// Normal: how much the map bends the normal (or the height of white, mm); emission: the
    /// radiance multiplier.
    pub strength: f32,
    /// Alpha with [`SLOT_FLAG_CUTOUT`]: the threshold.
    pub cutoff: f32,
}

impl Default for TextureSlot {
    /// An empty slot, as the writer fills one (`noTextureSlot` in `src/io/rsb.ts`).
    fn default() -> TextureSlot {
        TextureSlot {
            image: None,
            projection: PROJECTION_UV,
            axis: AXIS_Z,
            uv_set: 0,
            size_mm: 100.0,
            rotation_deg: 0.0,
            offset: [0.0, 0.0],
            repeat: [1.0, 1.0],
            wrap: WRAP_REPEAT,
            channel: 0,
            flags: 0,
            strength: 1.0,
            cutoff: 0.5,
        }
    }
}

/// A label: an image with alpha laid on the part by a planar projection from where it was
/// placed, with its own finish where it covers.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Label {
    /// Index into the scene's images (an sRGB entry); `None`: no image (it covers nothing).
    pub image: Option<u32>,
    /// Its centre, in the part's own space (mm).
    pub origin: Vec3,
    /// The image's right, unit, with its turn applied.
    pub u: Vec3,
    /// The image's up, unit.
    pub v: Vec3,
    /// The normal of its plane, unit: it covers surfaces whose normal has a positive component
    /// along it.
    pub normal: Vec3,
    /// Its size in mm.
    pub width_mm: f32,
    /// Its height in mm.
    pub height_mm: f32,
    /// How far in front of and behind its plane it reaches, mm.
    pub depth_mm: f32,
    /// Its finish where it covers: roughness,
    pub roughness: f32,
    /// clear coat,
    pub coat: f32,
    /// and how much the paper's edge stands out (0 to 1, of [`LABEL_RELIEF_MM`]).
    pub relief: f32,
}

/// The texture block of a material (`MATL` from byte [`TEXTURE_BLOCK_OFFSET`]).
#[derive(Clone, Debug, Default, PartialEq)]
pub struct MaterialTextures {
    /// Colour, roughness, metal, normal, alpha and emission ([`SLOT_COLOR`] …).
    pub slots: [TextureSlot; SLOTS],
    /// The linear colour the emission image is multiplied by.
    pub emission_tint: Rgb,
    /// In order: each one over the ones before it.
    pub labels: Vec<Label>,
}

impl MaterialTextures {
    /// True when no slot has an image and no label has one: the block changes nothing.
    pub fn is_empty(&self) -> bool {
        self.slots.iter().all(|s| s.image.is_none())
            && self.labels.iter().all(|l| l.image.is_none())
    }

    /// The highest image index the block refers to, if any.
    pub fn max_image(&self) -> Option<u32> {
        let slots = self.slots.iter().filter_map(|s| s.image);
        let labels = self.labels.iter().filter_map(|l| l.image);
        slots.chain(labels).max()
    }

    /// True when the alpha slot has an image: the opacity varies over the surface (shadow rays
    /// must look at it).
    pub fn has_alpha(&self) -> bool {
        self.slots[SLOT_ALPHA].image.is_some()
    }

    /// True when the emitted radiance of an emitter of this material varies over its surface
    /// (its colour slot, its emission slot or a label covers it): it cannot be sampled as a light
    /// by its flux.
    pub fn changes_emission(&self) -> bool {
        self.slots[SLOT_COLOR].image.is_some()
            || self.slots[SLOT_EMISSION].image.is_some()
            || self.labels.iter().any(|l| l.image.is_some())
    }
}

#[cfg(test)]
mod tests;
