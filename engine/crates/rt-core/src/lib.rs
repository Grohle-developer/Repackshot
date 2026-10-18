//! `rt-core`: the Repackshot render engine.
//!
//! A CPU path tracer written from scratch with zero external dependencies. This crate holds
//! everything that is independent of the host: vector maths and deterministic elementary
//! functions (`fmath`), the random number generator and the Owen-scrambled Sobol sampler,
//! colour handling and tone curves, the film, the PNG, TIFF and DNG writers, the RSB scene format, SIMD,
//! geometry (meshes, instances, BVHs, ray queries), the BSDF, lights (with the IES photometric
//! profiles of `ies`) and environment (the studio dome, the daylight sky, HDRI images), the image readers (`inflate`, `hdr`, `exr`, `bitmap`),
//! the camera optics beyond the thin lens (`optics`), the edge bevel (`bevel`) and the procedural
//! patterns (`pattern`) of the shading, the material programs of node materials (`program`), the
//! path tracer (`integrator`), the photon map of the
//! caustics (`caustics`), the tile renderer, its pixel filters and edge samples
//! (`pixel_filter`), the exact passes written next to the image for the AI post-processing
//! (`passes`) and the chief ray and focus of a pixel for focus with a click (`focus`).
//!
//! It deliberately avoids every OS API (`std::fs`, `std::net`, `std::time`, `std::thread`) so
//! that it compiles unchanged to `wasm32-unknown-unknown` and to any native target. Threading,
//! timing and file access live in the host crates (`rt-cli`, `rt-wasm`).
//!
//! Scene units are millimetres, angles in the RSB format are degrees, and the world is Z-up.

#![deny(unsafe_code)]
#![deny(missing_docs)]

pub mod adaptive;
pub mod bevel;
pub mod bitmap;
pub mod bsdf;
pub mod caustics;
pub mod color;
pub mod dng;
pub mod environment;
pub mod example;
pub mod exr;
pub mod fmath;
pub mod focus;
pub mod geometry;
pub mod hdr;
pub mod ies;
pub mod image;
pub mod inflate;
pub mod integrator;
pub mod light;
pub mod math;
pub mod optics;
pub mod passes;
pub mod pattern;
pub mod pixel_filter;
pub mod png;
pub mod program;
pub mod render;
pub mod rng;
pub mod sampler;
pub mod scene;
#[allow(unsafe_code)]
pub mod simd;
pub mod sky;
pub mod sky_table;
pub mod texture;
pub mod tiff;
pub mod warp;
pub mod weather;

/// Parses a decimal component of the crate version at compile time.
const fn version_part(text: &str) -> u32 {
    let bytes = text.as_bytes();
    let mut value = 0u32;
    let mut i = 0;
    while i < bytes.len() {
        value = value * 10 + (bytes[i] - b'0') as u32;
        i += 1;
    }
    value
}

/// [`FEATURES`] bit 0 (M2b): the engine reads the texture data of the RSB (`IMGS`, the `MATL`
/// texture block, the meshes' UV sets), so a host may send it.
pub const FEATURE_TEXTURES: u32 = 1;

/// [`FEATURES`] bit 1 (M3b): the engine runs the material programs of the RSB (`PROG`,
/// [`program`]), so a host may send a node material as its program instead of the mean of its
/// outputs. Programs read their images from `IMGS` and the meshes' UV sets: an engine with this
/// bit has [`FEATURE_TEXTURES`] too.
pub const FEATURE_PROGRAMS: u32 = 2;

/// [`FEATURES`] bit 2 (Q1): the engine cuts the model by the `SECT` section of the RSB (the section
/// view, [`geometry::SectionPlane`]); an engine without it draws the whole model.
pub const FEATURE_SECTION: u32 = 4;

/// [`FEATURES`] bit 3 (L5): the engine renders the IES lights of the RSB (`LGHT` kind 5 and the
/// `IESP` sections, [`ies`]); an engine without it refuses a file that has one, so the page writes
/// an IES light as the spot light that approximates it (the Fast preview's) for such an engine.
pub const FEATURE_IES: u32 = 8;

/// [`FEATURES`] bit 4 (K3): the engine reads the interior cameras of the RSB: the projection and
/// the exterior factor at the end of `CAMR` (the equirectangular panorama and the fisheye,
/// [`scene::Projection`]) and the instances hidden to the camera (`INST.flags` bit 2,
/// [`geometry::INSTANCE_NO_CAMERA`]). An engine without it renders the standard camera of `CAMR` and
/// shows every instance, so the page writes none of them for such an engine.
pub const FEATURE_CAMERAS: u32 = 16;
/// Bit 5 of [`FEATURES`] (M3c): the engine runs the pattern instructions of a material program
/// (`WOOD*` and `CLOTH*`, [`program::op`]): E6's wood and cloth as nodes of a graph. An engine
/// without it refuses a program with them (an unknown opcode makes the RSB invalid), so the page
/// writes such a material as the mean of its outputs for it, as for an engine without programs.
pub const FEATURE_PATTERN_NODES: u32 = 32;
/// Bit 6 of [`FEATURES`] (S3): the engine draws drops: the drop shape, the mixes of shapes and the
/// shape variation of the ambient effects (the S3 fields of `FXAM`, [`rt_sim::params`]) and the
/// front glass (`GLAS`, [`optics::glass`]). An engine without it reads a drop as a sphere, ignores
/// a mix (every particle is the effect's shape) and skips `GLAS`, so the page writes an effect of
/// drops or of a mix for it as the shape the most particles have, and no front glass.
pub const FEATURE_DROPS: u32 = 64;
/// Bit 7 of [`FEATURES`] (S3b): the engine reads a front glass whose drops and motes are listed one
/// by one (the tail of `GLAS`, [`optics::glass::GlassLayout`]: what the simulation of the scene's
/// rain and dust left on the pane). An engine without it stops reading `GLAS` at its 48 bytes and
/// draws the pane's coverage, which the page writes as 0: a clean pane, so the page writes no front
/// glass fed by the scene for it.
pub const FEATURE_GLASS_LAYOUT: u32 = 128;
/// Bit 8 of [`FEATURES`] (S3c): the engine draws the rain, dust and snow on the parts (`WETP`,
/// [`weather`]: what the simulation of the scene's effects left on each instance, the wet film, the
/// dust and the snow over its material and its drops as caps of water). An engine without it skips
/// the section and draws the parts dry and clean, so the page writes none for it.
pub const FEATURE_WET_PARTS: u32 = 256;
/// Bit 9 of [`FEATURES`] (S3d): the engine draws the drops in the air (`WETF`,
/// [`weather::FallingDrop`]: the drips and the drops splashes throw, as the simulation of the
/// scene's rain has them in the frame), and names a drop on a part or in the air as its part in
/// the part and material passes. An engine without it skips the section (the drops in the air are
/// not drawn), so the page writes none for it.
pub const FEATURE_WET_FLIGHT: u32 = 512;
/// Bit 10 of [`FEATURES`] (S3f): the engine draws the drops on the parts with their shapes (the
/// shape tail of `WETP`, [`weather::DropShape`]: a sliding drop elongated along its motion with a
/// thinner tail, a pinned one bulging downhill, two that merge with a neck between them, one that
/// hangs stretched along gravity and pinching off). An engine without it ignores the tail and draws
/// round caps, so the page writes none for it.
pub const FEATURE_WET_SHAPES: u32 = 1024;

/// What this engine reads beyond the RSB every engine reads: a bit set of `FEATURE_*` values. The
/// hosts report it (`rt_features` of `rt.wasm`, `features` of the launcher's `/api/info`) and the
/// page writes only what the engine says it reads.
pub const FEATURES: u32 = FEATURE_TEXTURES
    | FEATURE_PROGRAMS
    | FEATURE_SECTION
    | FEATURE_IES
    | FEATURE_CAMERAS
    | FEATURE_PATTERN_NODES
    | FEATURE_DROPS
    | FEATURE_GLASS_LAYOUT
    | FEATURE_WET_PARTS
    | FEATURE_WET_FLIGHT
    | FEATURE_WET_SHAPES;

/// Engine version packed as `major << 16 | minor << 8 | patch`.
pub const VERSION: u32 = (version_part(env!("CARGO_PKG_VERSION_MAJOR")) << 16)
    | (version_part(env!("CARGO_PKG_VERSION_MINOR")) << 8)
    | version_part(env!("CARGO_PKG_VERSION_PATCH"));

#[cfg(test)]
mod tests {
    use super::VERSION;

    #[test]
    fn version_is_packed_from_cargo_metadata() {
        let expected = env!("CARGO_PKG_VERSION")
            .split('.')
            .map(|part| part.parse::<u32>().expect("numeric version part"))
            .fold(0, |acc, part| (acc << 8) | part);
        assert_eq!(VERSION, expected);
    }
}
