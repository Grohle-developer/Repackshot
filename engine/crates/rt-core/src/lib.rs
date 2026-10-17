//! `rt-core`: the Repackshot render engine.
//!
//! A CPU path tracer written from scratch with zero external dependencies. This crate holds
//! everything that is independent of the host: vector maths and deterministic elementary
//! functions (`fmath`), the random number generator and the Owen-scrambled Sobol sampler,
//! colour handling and tone curves, the film, the PNG, TIFF and DNG writers, the RSB scene format, SIMD,
//! geometry (meshes, instances, BVHs, ray queries), the BSDF, lights and environment (the studio
//! dome, the daylight sky, HDRI images), the image readers (`inflate`, `hdr`, `exr`, `bitmap`),
//! the camera optics beyond the thin lens (`optics`), the edge bevel (`bevel`) and the procedural
//! patterns (`pattern`) of the shading, the material programs of node materials (`program`), the
//! path tracer (`integrator`), the photon map of the
//! caustics (`caustics`), the tile renderer, its pixel filters and edge samples
//! (`pixel_filter`) and the exact passes written next to the image for the AI post-processing
//! (`passes`).
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
pub mod geometry;
pub mod hdr;
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

/// What this engine reads beyond the RSB every engine reads: a bit set of `FEATURE_*` values. The
/// hosts report it (`rt_features` of `rt.wasm`, `features` of the launcher's `/api/info`) and the
/// page writes only what the engine says it reads.
pub const FEATURES: u32 = FEATURE_TEXTURES | FEATURE_PROGRAMS | FEATURE_SECTION;

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
