//! A linear raw DNG writer, written from the public specification ("Adobe Digital Negative
//! (DNG) Specification", version 1.4.0.0, June 2012: the TIFF/EP-based layout, the tag
//! descriptions of chapter 4 and the floating point image data added in 1.4). Nothing is taken
//! from any other writer or reader.
//!
//! A DNG is a TIFF ([`crate::tiff`]) whose image is *raw*: here a **LinearRaw** image
//! (`PhotometricInterpretation` 34892) of three samples per pixel, 32-bit IEEE floats
//! (`SampleFormat` 3), uncompressed, in strips, with these DNG tags:
//!
//! * `DNGVersion` and `DNGBackwardVersion` 1.4.0.0 (floating point data needs 1.4);
//! * `UniqueCameraModel` "Repackshot", and `Make` and `Model` the same;
//! * `ColorMatrix1`: the 3×3 that takes CIE XYZ to the camera's native space, which here is
//!   linear sRGB primaries, so it is the inverse of the sRGB to XYZ matrix (D65 white), stored
//!   as signed rationals with denominator 10⁷; with `CalibrationIlluminant1` 21 (D65);
//! * `AsShotNeutral` 1 1 1 (the camera already sees white as equal channels) and
//!   `BaselineExposure` 0;
//! * `WhiteLevel` 1: the white of the render is 1.0, with `BlackLevel` at its default of 0. The
//!   data is not clipped to it: a floating point image can hold values above 1, and the render's
//!   highlights are kept for the developer to pull down. (The largest float would be no white
//!   level: a developer normalises by it and the whole image would come out black.)
//!
//! The values are the render's linear light with the exposure applied, no tone curve, like the
//! EXR. A raw developer opens the file as a camera raw with the whole latitude of the render.
//! The same bytes are written by `encodeDng` in `src/io/image.ts`.

use crate::tiff::{assemble, tag, Entry, Raster, Samples};

/// `DNGVersion` (50706).
const DNG_VERSION: u16 = 50706;
/// `DNGBackwardVersion` (50707).
const DNG_BACKWARD_VERSION: u16 = 50707;
/// `UniqueCameraModel` (50708).
const UNIQUE_CAMERA_MODEL: u16 = 50708;
/// `WhiteLevel` (50717).
const WHITE_LEVEL: u16 = 50717;
/// `ColorMatrix1` (50721).
const COLOR_MATRIX_1: u16 = 50721;
/// `AsShotNeutral` (50728).
const AS_SHOT_NEUTRAL: u16 = 50728;
/// `BaselineExposure` (50730).
const BASELINE_EXPOSURE: u16 = 50730;
/// `CalibrationIlluminant1` (50778).
const CALIBRATION_ILLUMINANT_1: u16 = 50778;

/// `PhotometricInterpretation` of a LinearRaw image.
pub const PHOTOMETRIC_LINEAR_RAW: u16 = 34892;
/// `CalibrationIlluminant1` for D65 daylight (the values are those of the Exif `LightSource`).
pub const ILLUMINANT_D65: u16 = 21;
/// The DNG version of the file (and the oldest reader that can open it): 1.4.0.0.
pub const VERSION: [u8; 4] = [1, 4, 0, 0];
/// The name of the camera in `UniqueCameraModel`, `Make` and `Model`.
pub const CAMERA: &str = "Repackshot";
/// Denominator of the entries of [`COLOR_MATRIX`].
pub const MATRIX_DENOMINATOR: i32 = 10_000_000;
/// `ColorMatrix1`: CIE XYZ (D65) to linear sRGB, row by row, numerators over
/// [`MATRIX_DENOMINATOR`]. It is the inverse of the sRGB to XYZ matrix of the primaries
/// (0.64, 0.33), (0.30, 0.60), (0.15, 0.06) and the white point (0.3127, 0.3290), computed in
/// exact arithmetic and rounded to seven decimals.
pub const COLOR_MATRIX: [i32; 9] = [
    32_409_699,
    -15_373_832,
    -4_986_108,
    -9_692_436,
    18_759_675,
    415_551,
    556_301,
    -2_039_770,
    10_569_715,
];

/// Encodes linear RGB (`3 * width * height` floats, rows top to bottom) as a DNG.
///
/// # Panics
///
/// If a side is zero, the buffer does not match the dimensions, or the file would not fit the
/// 32-bit offsets of classic TIFF.
pub fn encode(width: u32, height: u32, rgb: &[f32]) -> Vec<u8> {
    let raster = Raster::new(width, height, 3, Samples::F32(rgb));
    let mut entries = raster.entries();
    entries.push(Entry::long(tag::NEW_SUBFILE_TYPE, &[0]));
    entries.push(Entry::short(tag::PHOTOMETRIC, &[PHOTOMETRIC_LINEAR_RAW]));
    entries.push(Entry::ascii(tag::MAKE, CAMERA));
    entries.push(Entry::ascii(tag::MODEL, CAMERA));
    entries.push(Entry::byte(DNG_VERSION, &VERSION));
    entries.push(Entry::byte(DNG_BACKWARD_VERSION, &VERSION));
    entries.push(Entry::ascii(UNIQUE_CAMERA_MODEL, CAMERA));
    entries.push(Entry::long(WHITE_LEVEL, &[1]));
    let matrix: Vec<(i32, i32)> = COLOR_MATRIX
        .iter()
        .map(|&n| (n, MATRIX_DENOMINATOR))
        .collect();
    entries.push(Entry::srational(COLOR_MATRIX_1, &matrix));
    entries.push(Entry::rational(AS_SHOT_NEUTRAL, &[(1, 1), (1, 1), (1, 1)]));
    entries.push(Entry::srational(BASELINE_EXPOSURE, &[(0, 1)]));
    entries.push(Entry::short(CALIBRATION_ILLUMINANT_1, &[ILLUMINANT_D65]));
    assemble(entries, &raster)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tiff::reader::parse;

    fn image() -> Vec<f32> {
        (0..16usize)
            .flat_map(|p| (0..3usize).map(move |c| (p * 7 + c * 13) as f32 / 64.0))
            .collect()
    }

    /// The sRGB to XYZ matrix from the primaries and the white point, in f64 (the test's own
    /// derivation, independent of the constants in the writer).
    fn srgb_to_xyz() -> [[f64; 3]; 3] {
        let xyz = |x: f64, y: f64| [x / y, 1.0, (1.0 - x - y) / y];
        let primaries = [xyz(0.64, 0.33), xyz(0.30, 0.60), xyz(0.15, 0.06)];
        let white = xyz(0.3127, 0.3290);
        let m = |col: usize, row: usize| primaries[col][row];
        let det = |a: [[f64; 3]; 3]| {
            a[0][0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1])
                - a[0][1] * (a[1][0] * a[2][2] - a[1][2] * a[2][0])
                + a[0][2] * (a[1][0] * a[2][1] - a[1][1] * a[2][0])
        };
        let base = [
            [m(0, 0), m(1, 0), m(2, 0)],
            [m(0, 1), m(1, 1), m(2, 1)],
            [m(0, 2), m(1, 2), m(2, 2)],
        ];
        let d = det(base);
        let mut scale = [0.0f64; 3];
        for (k, s) in scale.iter_mut().enumerate() {
            let mut a = base;
            for (row, line) in a.iter_mut().enumerate() {
                line[k] = white[row];
            }
            *s = det(a) / d;
        }
        let mut out = [[0.0; 3]; 3];
        for (row, line) in out.iter_mut().enumerate() {
            for (col, v) in line.iter_mut().enumerate() {
                *v = base[row][col] * scale[col];
            }
        }
        out
    }

    #[test]
    fn it_is_a_linear_raw_tiff_of_floats() {
        let px = image();
        let t = parse(&encode(4, 4, &px));
        let words: Vec<u32> = t
            .pixels
            .chunks_exact(4)
            .map(|c| u32::from_le_bytes([c[0], c[1], c[2], c[3]]))
            .collect();
        assert_eq!(words, px.iter().map(|v| v.to_bits()).collect::<Vec<_>>());
        assert_eq!(t.long(tag::NEW_SUBFILE_TYPE), 0);
        assert_eq!(t.long(tag::IMAGE_WIDTH), 4);
        assert_eq!(t.long(tag::IMAGE_LENGTH), 4);
        assert_eq!(t.get(tag::BITS_PER_SAMPLE).shorts(), [32, 32, 32]);
        assert_eq!(t.get(tag::SAMPLE_FORMAT).shorts(), [3, 3, 3]);
        assert_eq!(t.short(tag::COMPRESSION), 1);
        assert_eq!(t.short(tag::PHOTOMETRIC), 34892);
        assert_eq!(t.short(tag::SAMPLES_PER_PIXEL), 3);
        assert_eq!(t.short(tag::PLANAR_CONFIGURATION), 1);
        // No alpha in a raw.
        assert!(!t.fields.contains_key(&tag::EXTRA_SAMPLES));
    }

    #[test]
    fn it_has_the_tags_dng_1_4_asks_for() {
        let t = parse(&encode(4, 4, &image()));
        assert_eq!(t.get(DNG_VERSION).bytes, [1, 4, 0, 0]);
        assert_eq!(t.get(DNG_VERSION).kind, 1);
        assert_eq!(t.get(DNG_BACKWARD_VERSION).bytes, [1, 4, 0, 0]);
        assert_eq!(t.get(UNIQUE_CAMERA_MODEL).text(), "Repackshot");
        assert_eq!(t.get(tag::MAKE).text(), "Repackshot");
        assert_eq!(t.get(tag::MODEL).text(), "Repackshot");
        assert_eq!(t.get(CALIBRATION_ILLUMINANT_1).shorts(), [21]);
        assert_eq!(t.get(AS_SHOT_NEUTRAL).rationals(), [(1, 1), (1, 1), (1, 1)]);
        assert_eq!(t.get(BASELINE_EXPOSURE).srationals(), [(0, 1)]);
        assert_eq!(t.get(WHITE_LEVEL).longs(), [1]);
        assert_eq!(t.get(COLOR_MATRIX_1).count, 9);
        // The tags are in ascending order, the DNG ones after the TIFF ones.
        let sorted = {
            let mut s = t.tags.clone();
            s.sort_unstable();
            s
        };
        assert_eq!(t.tags, sorted);
        assert_eq!(*t.tags.last().unwrap(), CALIBRATION_ILLUMINANT_1);
    }

    #[test]
    fn color_matrix_1_is_the_inverse_of_srgb_to_xyz() {
        let t = parse(&encode(4, 4, &image()));
        let m: Vec<f64> = t
            .get(COLOR_MATRIX_1)
            .srationals()
            .iter()
            .map(|&(n, d)| f64::from(n) / f64::from(d))
            .collect();
        let a = srgb_to_xyz();
        for row in 0..3 {
            for col in 0..3 {
                let product: f64 = a
                    .iter()
                    .enumerate()
                    .map(|(k, line)| m[row * 3 + k] * line[col])
                    .sum();
                let want = if row == col { 1.0 } else { 0.0 };
                assert!(
                    (product - want).abs() < 1e-6,
                    "({row},{col}): {product} against {want}"
                );
            }
        }
        // White maps to equal channels: XYZ of D65 gives (1, 1, 1) in the camera space.
        let white = [0.3127 / 0.3290, 1.0, (1.0 - 0.3127 - 0.3290) / 0.3290];
        for row in 0..3 {
            let v: f64 = (0..3).map(|k| m[row * 3 + k] * white[k]).sum();
            assert!((v - 1.0).abs() < 1e-6, "row {row}: {v}");
        }
    }

    #[test]
    fn it_keeps_values_beyond_the_white_level() {
        let mut px = image();
        px[0] = 5000.0;
        px[1] = -0.5;
        let t = parse(&encode(4, 4, &px));
        let first = f32::from_le_bytes([t.pixels[0], t.pixels[1], t.pixels[2], t.pixels[3]]);
        let second = f32::from_le_bytes([t.pixels[4], t.pixels[5], t.pixels[6], t.pixels[7]]);
        assert_eq!((first, second), (5000.0, -0.5));
    }
}
