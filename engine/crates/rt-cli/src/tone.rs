//! `rt --tone-table`: reference values of the tone curves, for the TypeScript port.
//!
//! The browser accumulates the tiles the workers render and converts them to 8-bit pixels on its
//! own, with a TypeScript port of `rt_core::color` and `rt_core::fmath`. This prints what the
//! engine computes for a fixed set of inputs (every curve, the sRGB encoding, the exposure gain,
//! and the 8-bit pixels of `Film::to_srgb8_tonemapped`) as JSON, so the interface's tests can
//! compare the port against the engine itself (`tests/fixtures/tonemap.json`).

use rt_core::color::{exposure, srgb_encode, Rgb, Tonemap};
use rt_core::fmath;
use rt_core::image::Film;

/// Scene-linear inputs (after exposure): black, the sRGB linear segment, middle grey, highlights
/// far beyond white, saturated colours (AgX mixes channels), a negative channel.
pub const INPUTS: [[f32; 3]; 20] = [
    [0.0, 0.0, 0.0],
    [0.001, 0.002, 0.003_130_8],
    [0.003_2, 0.01, 0.05],
    [0.18, 0.18, 0.18],
    [0.12, 0.45, 0.85],
    [0.25, 0.25, 0.26],
    [0.5, 0.5, 0.5],
    [0.7, 0.7, 0.7],
    [1.0, 1.0, 1.0],
    [2.0, 2.0, 2.0],
    [4.0, 4.0, 4.0],
    [16.0, 16.0, 16.0],
    [100.0, 100.0, 100.0],
    [0.9, 0.2, 0.05],
    [0.05, 0.4, 0.95],
    [3.0, 0.5, 0.1],
    [12.0, 30.0, 6.0],
    [0.000_1, 0.005, 0.03],
    [8.0, 0.0, 0.0],
    [-0.5, 0.3, 2.0],
];

/// Exposures of the 8-bit table: whole and fractional stops (the latter go through `exp2`).
pub const EVS: [f32; 3] = [0.0, 1.37, -2.5];

/// Every curve, by its `RNDR.tonemap` value.
const CURVES: [Tonemap; 5] = [
    Tonemap::Linear,
    Tonemap::Aces,
    Tonemap::Filmic,
    Tonemap::Agx,
    Tonemap::Standard,
];

/// Inputs of the `fmath` table: 48 values spread over many decades, with fractional parts that
/// exercise every step of the reductions and series.
fn fmath_inputs() -> Vec<f32> {
    (0..48)
        .map(|i| {
            let t = i as f32 / 47.0;
            // From 2^-20 to 2^12, not on powers of two.
            fmath::exp2(-20.0 + 32.0 * t) * (1.0 + 0.37 * t)
        })
        .collect()
}

fn triple(c: [f32; 3]) -> String {
    format!("[{}, {}, {}]", c[0], c[1], c[2])
}

/// The table as JSON (numbers in Rust's shortest round-trip notation).
pub fn table_json() -> String {
    let inputs: Vec<String> = INPUTS.iter().map(|&c| triple(c)).collect();
    let curves: Vec<String> = CURVES
        .iter()
        .map(|&t| {
            let out: Vec<String> = INPUTS
                .iter()
                .map(|&[r, g, b]| {
                    let y = t.apply(Rgb::new(r, g, b));
                    triple([y.r, y.g, y.b])
                })
                .collect();
            format!("\"{}\": [{}]", t.to_u32(), out.join(", "))
        })
        .collect();
    let encode: Vec<String> = INPUTS
        .iter()
        .flatten()
        .map(|&x| format!("[{x}, {}]", srgb_encode(x)))
        .collect();
    let gains: Vec<String> = [0.0f32, 1.0, -1.0, 0.5, 1.37, -2.5, 3.9, -7.25]
        .iter()
        .map(|&ev| format!("[{ev}, {}]", exposure(ev)))
        .collect();
    let xs = fmath_inputs();
    let exp2: Vec<String> = xs
        .iter()
        .map(|&x| {
            let e = fmath::log2(x) * 0.731;
            format!("[{e}, {}]", fmath::exp2(e))
        })
        .collect();
    let log2: Vec<String> = xs
        .iter()
        .map(|&x| format!("[{x}, {}]", fmath::log2(x)))
        .collect();
    let powf: Vec<String> = xs
        .iter()
        .flat_map(|&x| {
            [1.0 / 2.4, 2.2, 0.5]
                .map(|y: f32| format!("[{x}, {y}, {}]", fmath::powf(x.min(1.0), y)))
        })
        .collect();
    // One film pixel per input, one sample each.
    let mut film = Film::new(INPUTS.len() as u32, 1);
    for (x, &[r, g, b]) in INPUTS.iter().enumerate() {
        film.splat(x as u32, 0, Rgb::new(r, g, b));
    }
    let mut bytes = Vec::new();
    for &t in &CURVES {
        for &ev in &EVS {
            let px: Vec<String> = film
                .to_srgb8_tonemapped(ev, t)
                .iter()
                .map(u8::to_string)
                .collect();
            bytes.push(format!(
                "{{\"tonemap\": {}, \"ev\": {ev}, \"bytes\": [{}]}}",
                t.to_u32(),
                px.join(", ")
            ));
        }
    }
    format!(
        "{{\n  \"inputs\": [{}],\n  \"curves\": {{{}}},\n  \"srgb_encode\": [{}],\n  \"exposure\": [{}],\n  \"fmath\": {{\"exp2\": [{}], \"log2\": [{}], \"powf\": [{}]}},\n  \"srgb8\": [{}]\n}}\n",
        inputs.join(", "),
        curves.join(", "),
        encode.join(", "),
        gains.join(", "),
        exp2.join(", "),
        log2.join(", "),
        powf.join(", "),
        bytes.join(", ")
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_table_holds_every_curve_and_input() {
        let json = table_json();
        for key in [
            "\"inputs\"",
            "\"curves\"",
            "\"srgb_encode\"",
            "\"exposure\"",
            "\"fmath\"",
            "\"srgb8\"",
        ] {
            assert!(json.contains(key), "{key} missing");
        }
        for t in 0..5 {
            assert!(json.contains(&format!("\"{t}\": [")));
        }
        // 5 curves x 3 exposures of 20 pixels.
        assert_eq!(json.matches("\"bytes\"").count(), 15);
        assert!(!json.contains("NaN") && !json.contains("inf"));
        // Balanced brackets: well-formed enough for JSON.parse on the other side.
        assert_eq!(json.matches('[').count(), json.matches(']').count());
        assert_eq!(json.matches('{').count(), json.matches('}').count());
    }
}
