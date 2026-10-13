//! Radiance RGBE (`.hdr`) images: reader and writer, written from the format's description in
//! G. Ward, "Real Pixels", *Graphics Gems II* (1991), and the Radiance file format notes
//! (`#?RADIANCE` header, `FORMAT=32-bit_rle_rgbe`, a resolution line, then the pixels).
//!
//! A pixel is four bytes: three 8-bit mantissas sharing the exponent in the fourth byte, the
//! value of a channel being `m · 2^(e - 136)` (zero when `e` is 0). Scanlines are stored flat, in
//! the old run-length encoding (a pixel `1 1 1 n` repeats the previous one `n << shift` times),
//! or in the "new" encoding (a scanline of 8 to 32767 pixels starts with `2 2 hi lo` and holds its
//! four channels one after the other, each as runs: a count above 128 repeats the next byte
//! `count - 128` times, otherwise `count` literal bytes follow). The reader takes all three; the
//! writer writes the new encoding. The resolution line must be `-Y h +X w` (rows top to bottom,
//! the standard) or `+Y h +X w` (bottom to top, flipped on reading). `EXPOSURE` and `GAMMA` header
//! lines are ignored, as most readers do.
//!
//! Conversion uses only exact power-of-two scaling, so the same bytes give the same floats
//! everywhere, and writing what was read gives the same bytes back.

use std::fmt;

/// Why an `.hdr` file could not be read.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum HdrError {
    /// The file does not start with `#?RADIANCE` or `#?RGBE`.
    NotRadiance,
    /// The header names a pixel format other than `32-bit_rle_rgbe`.
    UnsupportedFormat,
    /// The resolution line is missing, malformed or an unsupported orientation.
    BadResolution,
    /// The image is larger than the caller allows.
    TooLarge,
    /// The pixel data ends early or a run overflows its scanline.
    Truncated,
}

impl fmt::Display for HdrError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let text = match self {
            HdrError::NotRadiance => "not a Radiance HDR file",
            HdrError::UnsupportedFormat => "HDR pixel format is not 32-bit_rle_rgbe",
            HdrError::BadResolution => "HDR resolution line is missing or unsupported",
            HdrError::TooLarge => "HDR image is too large",
            HdrError::Truncated => "HDR pixel data is truncated or corrupt",
        };
        f.write_str(text)
    }
}

impl std::error::Error for HdrError {}

/// A decoded image: `width * height` linear RGB triples, rows top to bottom.
#[derive(Clone, Debug, PartialEq)]
pub struct HdrImage {
    /// Width in pixels.
    pub width: u32,
    /// Height in pixels.
    pub height: u32,
    /// `3 * width * height` floats, row-major from the top.
    pub rgb: Vec<f32>,
}

/// `2^e` for `e` in `[-149, 127]`, from its bits (no maths library).
#[inline]
pub(crate) fn pow2(e: i32) -> f32 {
    if e >= -126 {
        f32::from_bits(((e + 127) as u32) << 23)
    } else if e >= -149 {
        f32::from_bits(1u32 << (e + 149))
    } else {
        0.0
    }
}

/// The three channels of an RGBE pixel.
#[inline]
pub fn rgbe_to_rgb(p: [u8; 4]) -> [f32; 3] {
    if p[3] == 0 {
        return [0.0; 3];
    }
    let f = pow2(i32::from(p[3]) - 136);
    [
        f32::from(p[0]) * f,
        f32::from(p[1]) * f,
        f32::from(p[2]) * f,
    ]
}

/// An RGB value as an RGBE pixel: the largest channel's binary exponent is shared and every
/// mantissa is truncated to 8 bits. Negative and non-finite values count as zero.
pub fn rgb_to_rgbe(c: [f32; 3]) -> [u8; 4] {
    let clean = c.map(|v| if v.is_finite() && v > 0.0 { v } else { 0.0 });
    let m = clean[0].max(clean[1]).max(clean[2]);
    if m < 1.0e-32 {
        return [0; 4];
    }
    // m = f · 2^e with f in [0.5, 1): e = exponent of m + 1.
    let bits = m.to_bits();
    let e = ((bits >> 23) & 0xff) as i32 - 126;
    let e = e.min(127);
    let scale = pow2(8 - e); // 256 / 2^e
    let q = |v: f32| ((v * scale) as u32).min(255) as u8;
    [q(clean[0]), q(clean[1]), q(clean[2]), (e + 128) as u8]
}

/// Reads one header line (without the newline), advancing `pos`.
fn line<'a>(bytes: &'a [u8], pos: &mut usize) -> Option<&'a [u8]> {
    let start = *pos;
    let end = bytes[start..].iter().position(|&b| b == b'\n')? + start;
    *pos = end + 1;
    Some(&bytes[start..end])
}

/// Parses `-Y h +X w` or `+Y h +X w`: `(width, height, top_down)`.
fn resolution(text: &[u8]) -> Option<(u32, u32, bool)> {
    let text = std::str::from_utf8(text).ok()?;
    let parts: Vec<&str> = text.split_whitespace().collect();
    if parts.len() != 4 || parts[2] != "+X" {
        return None;
    }
    let top_down = match parts[0] {
        "-Y" => true,
        "+Y" => false,
        _ => return None,
    };
    let h: u32 = parts[1].parse().ok()?;
    let w: u32 = parts[3].parse().ok()?;
    (w > 0 && h > 0).then_some((w, h, top_down))
}

/// Decodes the scanline at `pos` into `row` (`4 * width` bytes of RGBE).
fn scanline(bytes: &[u8], pos: &mut usize, row: &mut [u8], width: usize) -> Result<(), HdrError> {
    let get = |p: usize| bytes.get(p).copied().ok_or(HdrError::Truncated);
    let new_rle = (8..=0x7fff).contains(&width)
        && bytes.len() >= *pos + 4
        && bytes[*pos] == 2
        && bytes[*pos + 1] == 2
        && bytes[*pos + 2] & 0x80 == 0;
    if new_rle {
        let declared = (usize::from(bytes[*pos + 2]) << 8) | usize::from(bytes[*pos + 3]);
        if declared != width {
            return Err(HdrError::Truncated);
        }
        *pos += 4;
        for channel in 0..4 {
            let mut x = 0;
            while x < width {
                let count = usize::from(get(*pos)?);
                *pos += 1;
                if count > 128 {
                    let n = count - 128;
                    let value = get(*pos)?;
                    *pos += 1;
                    if x + n > width {
                        return Err(HdrError::Truncated);
                    }
                    for k in 0..n {
                        row[(x + k) * 4 + channel] = value;
                    }
                    x += n;
                } else {
                    if count == 0 || x + count > width {
                        return Err(HdrError::Truncated);
                    }
                    let src = bytes.get(*pos..*pos + count).ok_or(HdrError::Truncated)?;
                    for (k, &value) in src.iter().enumerate() {
                        row[(x + k) * 4 + channel] = value;
                    }
                    *pos += count;
                    x += count;
                }
            }
        }
        return Ok(());
    }
    // Flat pixels, possibly with old-style repeat markers.
    let mut x = 0;
    let mut shift = 0;
    while x < width {
        let p = bytes.get(*pos..*pos + 4).ok_or(HdrError::Truncated)?;
        *pos += 4;
        if p[0] == 1 && p[1] == 1 && p[2] == 1 {
            if x == 0 {
                return Err(HdrError::Truncated);
            }
            let n = (usize::from(p[3])) << shift;
            if x + n > width {
                return Err(HdrError::Truncated);
            }
            for k in 0..n {
                row.copy_within((x - 1) * 4..x * 4, (x + k) * 4);
            }
            x += n;
            shift += 8;
        } else {
            row[x * 4..x * 4 + 4].copy_from_slice(p);
            x += 1;
            shift = 0;
        }
    }
    Ok(())
}

/// Decodes a Radiance `.hdr` file whose image has at most `max_pixels` pixels.
pub fn decode(bytes: &[u8], max_pixels: u64) -> Result<HdrImage, HdrError> {
    if !(bytes.starts_with(b"#?RADIANCE") || bytes.starts_with(b"#?RGBE")) {
        return Err(HdrError::NotRadiance);
    }
    let mut pos = 0;
    line(bytes, &mut pos).ok_or(HdrError::NotRadiance)?;
    // Header lines up to an empty one.
    loop {
        let l = line(bytes, &mut pos).ok_or(HdrError::BadResolution)?;
        if l.is_empty() {
            break;
        }
        if let Some(format) = l.strip_prefix(b"FORMAT=") {
            if format.trim_ascii() != b"32-bit_rle_rgbe" {
                return Err(HdrError::UnsupportedFormat);
            }
        }
    }
    let res = line(bytes, &mut pos).ok_or(HdrError::BadResolution)?;
    let (width, height, top_down) = resolution(res).ok_or(HdrError::BadResolution)?;
    if u64::from(width) * u64::from(height) > max_pixels {
        return Err(HdrError::TooLarge);
    }
    let (w, h) = (width as usize, height as usize);
    let mut rgb = vec![0.0f32; 3 * w * h];
    let mut row = vec![0u8; 4 * w];
    for y in 0..h {
        scanline(bytes, &mut pos, &mut row, w)?;
        let dst = if top_down { y } else { h - 1 - y };
        let out = &mut rgb[dst * 3 * w..(dst + 1) * 3 * w];
        for x in 0..w {
            let c = rgbe_to_rgb([row[x * 4], row[x * 4 + 1], row[x * 4 + 2], row[x * 4 + 3]]);
            out[x * 3..x * 3 + 3].copy_from_slice(&c);
        }
    }
    Ok(HdrImage { width, height, rgb })
}

/// Reads only the size of a Radiance file: `(width, height)`.
pub fn dimensions(bytes: &[u8]) -> Result<(u32, u32), HdrError> {
    if !(bytes.starts_with(b"#?RADIANCE") || bytes.starts_with(b"#?RGBE")) {
        return Err(HdrError::NotRadiance);
    }
    let mut pos = 0;
    line(bytes, &mut pos).ok_or(HdrError::NotRadiance)?;
    loop {
        let l = line(bytes, &mut pos).ok_or(HdrError::BadResolution)?;
        if l.is_empty() {
            break;
        }
    }
    let res = line(bytes, &mut pos).ok_or(HdrError::BadResolution)?;
    resolution(res)
        .map(|(w, h, _)| (w, h))
        .ok_or(HdrError::BadResolution)
}

/// Appends one channel of a scanline in the new run-length encoding.
fn encode_channel(out: &mut Vec<u8>, data: &[u8]) {
    let n = data.len();
    let mut i = 0;
    while i < n {
        // Length of the run starting at i.
        let mut run = 1;
        while i + run < n && run < 127 && data[i + run] == data[i] {
            run += 1;
        }
        if run >= 4 {
            out.push(128 + run as u8);
            out.push(data[i]);
            i += run;
            continue;
        }
        // Literal bytes up to the next run of four or more (at most 128).
        let start = i;
        while i < n && i - start < 128 {
            let mut ahead = 1;
            while i + ahead < n && ahead < 4 && data[i + ahead] == data[i] {
                ahead += 1;
            }
            if ahead >= 4 {
                break;
            }
            i += 1;
        }
        out.push((i - start) as u8);
        out.extend_from_slice(&data[start..i]);
    }
}

/// Writes a Radiance `.hdr` file (`-Y h +X w`, new run-length encoding where the width allows
/// it) from `3 * width * height` linear RGB floats, rows top to bottom.
pub fn encode(width: u32, height: u32, rgb: &[f32]) -> Vec<u8> {
    let (w, h) = (width as usize, height as usize);
    assert_eq!(rgb.len(), 3 * w * h, "pixel buffer does not match the size");
    let mut out = Vec::new();
    out.extend_from_slice(b"#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n");
    out.extend_from_slice(format!("-Y {height} +X {width}\n").as_bytes());
    let rle = (8..=0x7fff).contains(&w);
    let mut channels = vec![0u8; 4 * w];
    for y in 0..h {
        let row = &rgb[y * 3 * w..(y + 1) * 3 * w];
        for x in 0..w {
            let p = rgb_to_rgbe([row[x * 3], row[x * 3 + 1], row[x * 3 + 2]]);
            if rle {
                for (c, &v) in p.iter().enumerate() {
                    channels[c * w + x] = v;
                }
            } else {
                out.extend_from_slice(&p);
            }
        }
        if rle {
            out.extend_from_slice(&[2, 2, (w >> 8) as u8, w as u8]);
            for c in 0..4 {
                encode_channel(&mut out, &channels[c * w..(c + 1) * w]);
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rng::Pcg32;

    fn image(w: u32, h: u32, seed: u64) -> Vec<f32> {
        let mut rng = Pcg32::seeded(seed, 9);
        (0..3 * w * h)
            .map(|i| {
                // Runs of equal pixels, wide dynamic range, some zeros.
                let base = (i / 30) as f32;
                match i % 7 {
                    0 => 0.0,
                    1 => 1.0e4 * rng.next_f32(),
                    _ => 0.001 * base + rng.next_f32() * 0.5,
                }
            })
            .collect()
    }

    #[test]
    fn rgbe_pixels_round_trip_exactly() {
        assert_eq!(rgbe_to_rgb([0, 0, 0, 0]), [0.0; 3]);
        assert_eq!(rgb_to_rgbe([0.0, -1.0, f32::NAN]), [0; 4]);
        // 1.0 = 128 · 2^(129 - 136).
        assert_eq!(rgb_to_rgbe([1.0, 0.5, 0.25]), [128, 64, 32, 129]);
        assert_eq!(rgbe_to_rgb([128, 64, 32, 129]), [1.0, 0.5, 0.25]);
        let mut rng = Pcg32::seeded(1, 2);
        for _ in 0..10_000 {
            let e = (rng.next_u32() % 200) as i32 - 100;
            let c = [rng.next_f32(), rng.next_f32(), rng.next_f32()].map(|v| v * pow2(e));
            let p = rgb_to_rgbe(c);
            // Decoding then encoding is the identity on pixels.
            assert_eq!(rgb_to_rgbe(rgbe_to_rgb(p)), p, "{c:?}");
            // And the error is below one part in 128 of the largest channel.
            let back = rgbe_to_rgb(p);
            let m = c[0].max(c[1]).max(c[2]);
            for k in 0..3 {
                assert!(
                    back[k] <= c[k] && c[k] - back[k] <= m / 128.0,
                    "{c:?} {back:?}"
                );
            }
        }
    }

    #[test]
    fn files_round_trip_through_the_writer() {
        for (w, h) in [(1u32, 1u32), (7, 3), (8, 2), (64, 32), (300, 5)] {
            let rgb = image(w, h, u64::from(w * h));
            let file = encode(w, h, &rgb);
            assert!(file.starts_with(b"#?RADIANCE\n"));
            let img = decode(&file, 1 << 24).expect("decode");
            assert_eq!((img.width, img.height), (w, h));
            assert_eq!(dimensions(&file), Ok((w, h)));
            // What was read is what the quantisation keeps.
            for (a, b) in img.rgb.chunks(3).zip(rgb.chunks(3)) {
                let want = rgbe_to_rgb(rgb_to_rgbe([b[0], b[1], b[2]]));
                assert_eq!(a, want);
            }
            // Writing it again gives the same bytes.
            assert_eq!(encode(w, h, &img.rgb), file);
            if w >= 64 {
                // Run-length encoding actually compresses a flat image.
                let flat = vec![0.5f32; (3 * w * h) as usize];
                assert!(encode(w, h, &flat).len() < (4 * w * h) as usize);
            }
        }
    }

    #[test]
    fn flat_and_old_rle_scanlines_and_bottom_up_files_read() {
        // 3 x 2, +Y (bottom row first), flat pixels with an old-style repeat marker.
        let mut file = b"#?RGBE\nGAMMA=1\nEXPOSURE=2\n\n+Y 2 +X 3\n".to_vec();
        // Bottom row: one pixel of 1.0 repeated twice more with the marker.
        file.extend_from_slice(&[128, 128, 128, 129, 1, 1, 1, 2]);
        // Top row: three different pixels.
        file.extend_from_slice(&[128, 0, 0, 129, 0, 128, 0, 129, 0, 0, 128, 129]);
        let img = decode(&file, 100).expect("decode");
        assert_eq!(img.rgb[..9], [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0]);
        assert_eq!(img.rgb[9..], [1.0; 9]);
    }

    #[test]
    fn bad_files_fail_cleanly() {
        assert_eq!(decode(b"P6\n", 10), Err(HdrError::NotRadiance));
        assert_eq!(
            decode(
                b"#?RADIANCE\nFORMAT=32-bit_rle_xyze\n\n-Y 1 +X 1\n\0\0\0\0",
                10
            ),
            Err(HdrError::UnsupportedFormat)
        );
        assert_eq!(
            decode(b"#?RADIANCE\n\n-X 1 +Y 1\n\0\0\0\0", 10),
            Err(HdrError::BadResolution)
        );
        assert_eq!(
            decode(b"#?RADIANCE\n\n-Y 100 +X 100\n", 10),
            Err(HdrError::TooLarge)
        );
        let file = encode(64, 4, &image(64, 4, 3));
        for cut in 0..file.len() {
            assert!(decode(&file[..cut], 1 << 20).is_err(), "cut {cut}");
        }
        // A run longer than the scanline.
        let mut bad = file.clone();
        let start = file.windows(4).position(|w| w == [2, 2, 0, 64]).unwrap();
        bad[start + 4] = 255;
        assert!(decode(&bad, 1 << 20).is_err());
    }
}
