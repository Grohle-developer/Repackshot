//! `rt-core`: the Repackshot render engine.
//!
//! A CPU path tracer written from scratch with zero external dependencies. This crate holds
//! everything that is independent of the host: vector maths and deterministic elementary
//! functions (`fmath`), the random number generator and the Owen-scrambled Sobol sampler,
//! colour handling and tone curves, the film, the PNG writer, the RSB scene format, SIMD,
//! geometry (meshes, instances, BVHs, ray queries), the BSDF, lights and environment (the studio
//! dome, the daylight sky, HDRI images), the image readers (`inflate`, `hdr`, `exr`, `bitmap`),
//! the path tracer (`integrator`), the photon map of the caustics (`caustics`), the tile renderer,
//! its pixel filters and edge samples (`pixel_filter`) and the exact passes written next to the
//! image for the AI post-processing (`passes`).
//!
//! It deliberately avoids every OS API (`std::fs`, `std::net`, `std::time`, `std::thread`) so
//! that it compiles unchanged to `wasm32-unknown-unknown` and to any native target. Threading,
//! timing and file access live in the host crates (`rt-cli`, `rt-wasm`).
//!
//! Scene units are millimetres, angles in the RSB format are degrees, and the world is Z-up.

#![deny(unsafe_code)]
#![deny(missing_docs)]

pub mod bitmap;
pub mod bsdf;
pub mod caustics;
pub mod color;
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
pub mod passes;
pub mod pixel_filter;
pub mod png;
pub mod render;
pub mod rng;
pub mod sampler;
pub mod scene;
#[allow(unsafe_code)]
pub mod simd;
pub mod sky;
pub mod sky_table;
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
