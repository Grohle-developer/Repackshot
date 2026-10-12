//! `rt-core`: the Repackshot render engine.
//!
//! A CPU path tracer written from scratch with zero external dependencies. This crate holds
//! everything that is independent of the host: vector maths, the random number generator,
//! colour handling, the film, the PNG writer, the RSB scene format, SIMD, geometry (meshes,
//! instances, BVHs, ray queries) and the renderer itself.
//!
//! It deliberately avoids every OS API (`std::fs`, `std::net`, `std::time`, `std::thread`) so
//! that it compiles unchanged to `wasm32-unknown-unknown` and to any native target. Threading,
//! timing and file access live in the host crates (`rt-cli`, `rt-wasm`).
//!
//! Scene units are millimetres, angles in the RSB format are degrees, and the world is Z-up.

#![deny(unsafe_code)]
#![deny(missing_docs)]

pub mod color;
pub mod example;
pub mod geometry;
pub mod image;
pub mod math;
pub mod png;
pub mod render;
pub mod rng;
pub mod scene;
#[allow(unsafe_code)]
pub mod simd;

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
