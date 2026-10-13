//! A PNG reader (ISO/IEC 15948, the W3C PNG specification), written from the specification: every
//! colour type and bit depth, the five filters, Adam7 interlacing, `PLTE` and `tRNS`, chunk CRCs
//! and the zlib Adler-32 checked. The output is always 8-bit RGBA, rows from the top: 16-bit
//! samples keep their high byte and samples of 1, 2 or 4 bits are scaled to 0..255.
//!
//! The images the page sends to `/api/ai/run` and the images the inference runtime answers with
//! are PNG; rt-core's writer (`rt_core::png::encode`) makes the other direction.

use super::inflate::{zlib_decompress, InflateError};
use std::fmt;

/// An 8-bit RGBA image.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Image {
    /// Pixels a row.
    pub width: u32,
    /// Rows.
    pub height: u32,
    /// `width * height * 4` bytes, straight alpha.
    pub rgba: Vec<u8>,
}

/// Why a file cannot be read as a PNG.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum PngError {
    /// Not a PNG signature.
    NotPng,
    /// The file ends inside a chunk, or before `IEND`.
    Truncated,
    /// A chunk whose CRC does not match.
    BadCrc([u8; 4]),
    /// A header or chunk that breaks the specification.
    Invalid(String),
    /// More pixels than the caller allows.
    TooLarge,
    /// The image data does not inflate.
    Data(InflateError),
}

impl fmt::Display for PngError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            PngError::NotPng => f.write_str("not a PNG image"),
            PngError::Truncated => f.write_str("the PNG image is cut short"),
            PngError::BadCrc(k) => write!(
                f,
                "PNG chunk {} has a wrong CRC",
                String::from_utf8_lossy(k)
            ),
            PngError::Invalid(m) => write!(f, "invalid PNG image: {m}"),
            PngError::TooLarge => f.write_str("the PNG image is larger than allowed"),
            PngError::Data(e) => write!(f, "PNG image data: {e}"),
        }
    }
}

impl std::error::Error for PngError {}

/// The header of a PNG.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Header {
    /// Pixels a row.
    pub width: u32,
    /// Rows.
    pub height: u32,
    /// Bits a sample: 1, 2, 4, 8 or 16.
    pub bit_depth: u8,
    /// 0 grey, 2 RGB, 3 palette, 4 grey and alpha, 6 RGBA.
    pub colour_type: u8,
    /// Adam7.
    pub interlaced: bool,
}

impl Header {
    fn channels(&self) -> usize {
        match self.colour_type {
            0 | 3 => 1,
            4 => 2,
            2 => 3,
            _ => 4,
        }
    }

    /// Bytes of one unfiltered row of `width` pixels.
    fn row_bytes(&self, width: usize) -> usize {
        (width * self.channels() * usize::from(self.bit_depth)).div_ceil(8)
    }

    /// The distance, in bytes, to the corresponding byte of the previous pixel (at least 1).
    fn filter_step(&self) -> usize {
        (self.channels() * usize::from(self.bit_depth)).div_ceil(8)
    }
}

const SIGNATURE: [u8; 8] = [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];

/// The Adam7 passes: first column, first row, column step, row step.
const ADAM7: [(usize, usize, usize, usize); 7] = [
    (0, 0, 8, 8),
    (4, 0, 8, 8),
    (0, 4, 4, 8),
    (2, 0, 4, 4),
    (0, 2, 2, 4),
    (1, 0, 2, 2),
    (0, 1, 1, 2),
];

fn be32(b: &[u8]) -> u32 {
    u32::from_be_bytes([b[0], b[1], b[2], b[3]])
}

fn parse_header(data: &[u8]) -> Result<Header, PngError> {
    if data.len() < 8 || data[..8] != SIGNATURE {
        return Err(PngError::NotPng);
    }
    let ihdr = data.get(8..33).ok_or(PngError::Truncated)?;
    if be32(ihdr) != 13 || &ihdr[4..8] != b"IHDR" {
        return Err(PngError::Invalid("IHDR is not the first chunk".into()));
    }
    let h = Header {
        width: be32(&ihdr[8..]),
        height: be32(&ihdr[12..]),
        bit_depth: ihdr[16],
        colour_type: ihdr[17],
        interlaced: ihdr[20] == 1,
    };
    let depth_ok = match h.colour_type {
        0 => matches!(h.bit_depth, 1 | 2 | 4 | 8 | 16),
        3 => matches!(h.bit_depth, 1 | 2 | 4 | 8),
        2 | 4 | 6 => matches!(h.bit_depth, 8 | 16),
        _ => false,
    };
    if !depth_ok {
        return Err(PngError::Invalid(format!(
            "colour type {} with {} bits",
            h.colour_type, h.bit_depth
        )));
    }
    if ihdr[18] != 0 || ihdr[19] != 0 || ihdr[20] > 1 {
        return Err(PngError::Invalid(
            "unknown compression, filter or interlace method".into(),
        ));
    }
    if h.width == 0 || h.height == 0 || h.width > (1 << 24) || h.height > (1 << 24) {
        return Err(PngError::Invalid("zero or huge dimensions".into()));
    }
    Ok(h)
}

/// The header alone (the size of an image without decoding it).
pub fn header(data: &[u8]) -> Result<Header, PngError> {
    parse_header(data)
}

fn paeth(a: u8, b: u8, c: u8) -> u8 {
    let p = i16::from(a) + i16::from(b) - i16::from(c);
    let (pa, pb, pc) = (
        (p - i16::from(a)).abs(),
        (p - i16::from(b)).abs(),
        (p - i16::from(c)).abs(),
    );
    if pa <= pb && pa <= pc {
        a
    } else if pb <= pc {
        b
    } else {
        c
    }
}

/// Reverses the filters of `rows` rows of `row_bytes` (each after its filter type byte), in
/// place; returns the unfiltered rows without their filter bytes.
fn unfilter(data: &[u8], rows: usize, row_bytes: usize, step: usize) -> Result<Vec<u8>, PngError> {
    let mut out = vec![0u8; rows * row_bytes];
    for y in 0..rows {
        let line = &data[y * (row_bytes + 1)..(y + 1) * (row_bytes + 1)];
        let (kind, src) = (line[0], &line[1..]);
        let (done, rest) = out.split_at_mut(y * row_bytes);
        let prev: &[u8] = if y == 0 {
            &[]
        } else {
            &done[(y - 1) * row_bytes..]
        };
        let cur = &mut rest[..row_bytes];
        let up = |i: usize| if prev.is_empty() { 0 } else { prev[i] };
        for i in 0..row_bytes {
            let left = if i >= step { cur[i - step] } else { 0 };
            let upper_left = if i >= step { up(i - step) } else { 0 };
            cur[i] = match kind {
                0 => src[i],
                1 => src[i].wrapping_add(left),
                2 => src[i].wrapping_add(up(i)),
                3 => src[i].wrapping_add(((u16::from(left) + u16::from(up(i))) / 2) as u8),
                4 => src[i].wrapping_add(paeth(left, up(i), upper_left)),
                k => return Err(PngError::Invalid(format!("filter type {k}"))),
            };
        }
    }
    Ok(out)
}

struct Palette {
    rgb: Vec<[u8; 3]>,
    alpha: Vec<u8>,
}

/// One sample of a row: bits `[bit, bit + depth)` counted from the most significant end.
fn sample(row: &[u8], index: usize, depth: u8) -> u16 {
    match depth {
        16 => u16::from_be_bytes([row[index * 2], row[index * 2 + 1]]),
        8 => u16::from(row[index]),
        d => {
            let bit = index * usize::from(d);
            let byte = row[bit / 8];
            let shift = 8 - usize::from(d) - bit % 8;
            u16::from((byte >> shift) & ((1u8 << d) - 1))
        }
    }
}

/// Scales a sample to 8 bits.
fn to8(v: u16, depth: u8) -> u8 {
    match depth {
        16 => (v >> 8) as u8,
        8 => v as u8,
        4 => (v * 17) as u8,
        2 => (v * 85) as u8,
        _ => (v * 255) as u8,
    }
}

/// Decodes a PNG with at most `max_pixels` pixels into 8-bit RGBA.
pub fn decode(data: &[u8], max_pixels: u64) -> Result<Image, PngError> {
    let h = parse_header(data)?;
    if u64::from(h.width) * u64::from(h.height) > max_pixels {
        return Err(PngError::TooLarge);
    }
    let mut idat = Vec::new();
    let mut palette: Option<Palette> = None;
    let mut key: Option<[u16; 3]> = None;
    let mut trns: Option<Vec<u8>> = None;
    let mut pos = 8;
    let mut ended = false;
    while pos < data.len() {
        let head = data.get(pos..pos + 8).ok_or(PngError::Truncated)?;
        let len = be32(head) as usize;
        if len > 0x7fff_ffff {
            return Err(PngError::Invalid("chunk length".into()));
        }
        let kind = [head[4], head[5], head[6], head[7]];
        let body = data
            .get(pos + 8..pos + 8 + len)
            .ok_or(PngError::Truncated)?;
        let crc = data
            .get(pos + 8 + len..pos + 12 + len)
            .ok_or(PngError::Truncated)?;
        if rt_core::png::crc32(&data[pos + 4..pos + 8 + len]) != be32(crc) {
            return Err(PngError::BadCrc(kind));
        }
        match &kind {
            b"IDAT" => idat.extend_from_slice(body),
            b"PLTE" => {
                if !len.is_multiple_of(3) || len == 0 || len > 768 {
                    return Err(PngError::Invalid("PLTE length".into()));
                }
                palette = Some(Palette {
                    rgb: body.chunks_exact(3).map(|c| [c[0], c[1], c[2]]).collect(),
                    alpha: Vec::new(),
                });
            }
            b"tRNS" => trns = Some(body.to_vec()),
            b"IEND" => {
                ended = true;
                break;
            }
            _ => {
                // An unknown critical chunk (upper-case first letter) cannot be skipped.
                if kind[0].is_ascii_uppercase() && &kind != b"IHDR" {
                    return Err(PngError::Invalid(format!(
                        "unknown critical chunk {}",
                        String::from_utf8_lossy(&kind)
                    )));
                }
            }
        }
        pos += 12 + len;
    }
    if !ended {
        return Err(PngError::Truncated);
    }
    if let Some(t) = trns {
        match h.colour_type {
            3 => {
                let p = palette
                    .as_mut()
                    .ok_or_else(|| PngError::Invalid("tRNS before PLTE".into()))?;
                if t.len() > p.rgb.len() {
                    return Err(PngError::Invalid("tRNS longer than PLTE".into()));
                }
                p.alpha = t;
            }
            0 if t.len() == 2 => key = Some([u16::from_be_bytes([t[0], t[1]]), 0, 0]),
            2 if t.len() == 6 => {
                key = Some([
                    u16::from_be_bytes([t[0], t[1]]),
                    u16::from_be_bytes([t[2], t[3]]),
                    u16::from_be_bytes([t[4], t[5]]),
                ])
            }
            _ => return Err(PngError::Invalid("tRNS for this colour type".into())),
        }
    }
    if h.colour_type == 3 && palette.is_none() {
        return Err(PngError::Invalid("a palette image without PLTE".into()));
    }
    let (w, ht) = (h.width as usize, h.height as usize);
    let passes: Vec<(usize, usize, usize, usize)> = if h.interlaced {
        ADAM7.to_vec()
    } else {
        vec![(0, 0, 1, 1)]
    };
    // The exact size of the filtered data, pass by pass.
    let sizes: Vec<(usize, usize)> = passes
        .iter()
        .map(|&(x0, y0, dx, dy)| {
            let pw = if w > x0 { (w - x0).div_ceil(dx) } else { 0 };
            let ph = if ht > y0 { (ht - y0).div_ceil(dy) } else { 0 };
            (pw, ph)
        })
        .collect();
    let total: usize = sizes
        .iter()
        .filter(|(pw, ph)| *pw > 0 && *ph > 0)
        .map(|&(pw, ph)| ph * (h.row_bytes(pw) + 1))
        .sum();
    let raw = zlib_decompress(&idat, total).map_err(|e| match e {
        InflateError::TooLarge => PngError::Invalid("more image data than the size needs".into()),
        other => PngError::Data(other),
    })?;
    if raw.len() != total {
        return Err(PngError::Invalid(format!(
            "{} bytes of image data instead of {total}",
            raw.len()
        )));
    }
    let mut rgba = vec![0u8; w * ht * 4];
    let mut at = 0;
    for (&(x0, y0, dx, dy), &(pw, ph)) in passes.iter().zip(&sizes) {
        if pw == 0 || ph == 0 {
            continue;
        }
        let rb = h.row_bytes(pw);
        let rows = unfilter(&raw[at..at + ph * (rb + 1)], ph, rb, h.filter_step())?;
        at += ph * (rb + 1);
        for j in 0..ph {
            let row = &rows[j * rb..(j + 1) * rb];
            for i in 0..pw {
                let px = pixel(row, i, &h, palette.as_ref(), key)?;
                let (x, y) = (x0 + i * dx, y0 + j * dy);
                rgba[(y * w + x) * 4..(y * w + x) * 4 + 4].copy_from_slice(&px);
            }
        }
    }
    Ok(Image {
        width: h.width,
        height: h.height,
        rgba,
    })
}

fn pixel(
    row: &[u8],
    i: usize,
    h: &Header,
    palette: Option<&Palette>,
    key: Option<[u16; 3]>,
) -> Result<[u8; 4], PngError> {
    let d = h.bit_depth;
    Ok(match h.colour_type {
        0 => {
            let v = sample(row, i, d);
            let g = to8(v, d);
            let a = if key.is_some_and(|k| k[0] == v) {
                0
            } else {
                255
            };
            [g, g, g, a]
        }
        2 => {
            let s = [
                sample(row, i * 3, d),
                sample(row, i * 3 + 1, d),
                sample(row, i * 3 + 2, d),
            ];
            let a = if key == Some(s) { 0 } else { 255 };
            [to8(s[0], d), to8(s[1], d), to8(s[2], d), a]
        }
        3 => {
            let p = palette.ok_or_else(|| PngError::Invalid("no PLTE".into()))?;
            let idx = usize::from(sample(row, i, d));
            let c = p
                .rgb
                .get(idx)
                .ok_or_else(|| PngError::Invalid("palette index out of range".into()))?;
            [c[0], c[1], c[2], p.alpha.get(idx).copied().unwrap_or(255)]
        }
        4 => {
            let g = to8(sample(row, i * 2, d), d);
            [g, g, g, to8(sample(row, i * 2 + 1, d), d)]
        }
        _ => [
            to8(sample(row, i * 4, d), d),
            to8(sample(row, i * 4 + 1, d), d),
            to8(sample(row, i * 4 + 2, d), d),
            to8(sample(row, i * 4 + 3, d), d),
        ],
    })
}

/// The RGB bytes of an RGBA image whose alpha is ignored (rt-core's writer takes RGB).
pub fn rgb_of(img: &Image) -> Vec<u8> {
    img.rgba
        .chunks_exact(4)
        .flat_map(|p| [p[0], p[1], p[2]])
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sha256::{hex, Sha256};

    fn fixture(name: &str) -> Vec<u8> {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures/png")
            .join(name);
        std::fs::read(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()))
    }

    /// Made with ImageMagick (`convert`, an independent encoder with adaptive filters and real
    /// deflate); the expected pixels are PIL's `convert('RGBA')` of the same files.
    const FIXTURES: [(&str, &str); 7] = [
        (
            "rgb8.png",
            "871af449bf9f178c522d7f1d9044b08f9b00fea873b8c609329d717c770095a6",
        ),
        (
            "rgba8.png",
            "6a14309cd875257bc7df9ae5d0ce8e67ec1696f6c7afe7614294d0a0b52cb84a",
        ),
        (
            "gray8.png",
            "e79e2b84afa34cae5e30bad2643d3f9f69651a2902d725088ea70ccb4adc4a2e",
        ),
        (
            "gray1.png",
            "0ca995365b120c89a3dbf0f3def90f25c768c1f6af5556f57d15ef2fda197ebe",
        ),
        (
            "palette8.png",
            "9bd357df7071804a3a61d772e32b8819e9cde54f5b84039b96d306cf0b3b6458",
        ),
        (
            "rgb16.png",
            "e9c5b80f323cac6faaaacca9e51db074f1ccdaf6c2e945ebba05b64259f96cc3",
        ),
        // Adam7: the same pixels as rgb8.png.
        (
            "interlaced.png",
            "871af449bf9f178c522d7f1d9044b08f9b00fea873b8c609329d717c770095a6",
        ),
    ];

    #[test]
    fn independent_encoders_every_type_filter_depth_and_adam7() {
        for (name, expect) in FIXTURES {
            let img = decode(&fixture(name), 1 << 20).unwrap_or_else(|e| panic!("{name}: {e}"));
            assert_eq!((img.width, img.height), (37, 23), "{name}");
            assert_eq!(hex(&Sha256::digest(&img.rgba)), expect, "{name}");
        }
        let h = header(&fixture("interlaced.png")).unwrap();
        assert!(h.interlaced && h.colour_type == 2 && h.bit_depth == 8);
    }

    #[test]
    fn rt_core_writes_what_this_reads() {
        let (w, ht) = (19u32, 7u32);
        let rgb: Vec<u8> = (0..w * ht * 3).map(|i| (i * 37 % 251) as u8).collect();
        let img = decode(&rt_core::png::encode(w, ht, &rgb), 1 << 20).unwrap();
        assert_eq!((img.width, img.height), (w, ht));
        assert_eq!(rgb_of(&img), rgb);
        assert!(img.rgba.chunks_exact(4).all(|p| p[3] == 255));
    }

    #[test]
    fn broken_files_are_refused() {
        let good = fixture("rgb8.png");
        assert_eq!(decode(b"GIF89a", 100), Err(PngError::NotPng));
        assert_eq!(decode(&good, 100), Err(PngError::TooLarge));
        // A flipped byte in the IDAT data: the chunk CRC catches it.
        let idat = good.windows(4).position(|w| w == b"IDAT").unwrap();
        let mut bad = good.clone();
        bad[idat + 10] ^= 1;
        assert_eq!(decode(&bad, 1 << 20), Err(PngError::BadCrc(*b"IDAT")));
        // Cut before IEND, or anywhere.
        for cut in [good.len() - 12, good.len() / 2, 40, 9] {
            assert!(decode(&good[..cut], 1 << 20).is_err(), "cut at {cut}");
        }
        // An unknown critical chunk, and a header with a bad depth.
        let mut odd = good[..33].to_vec();
        let mut chunk = vec![0, 0, 0, 0];
        chunk.extend_from_slice(b"XYZW");
        chunk.extend_from_slice(&rt_core::png::crc32(b"XYZW").to_be_bytes());
        odd.extend_from_slice(&chunk);
        odd.extend_from_slice(&good[33..]);
        assert!(matches!(decode(&odd, 1 << 20), Err(PngError::Invalid(_))));
        let mut depth = good.clone();
        depth[24] = 3;
        assert!(matches!(header(&depth), Err(PngError::Invalid(_))));
    }

    #[test]
    fn filters_by_hand() {
        // One row per filter type over 5 RGB pixels, filtered here with the definitions of the
        // specification (§9.2), then stored and read back.
        let (w, rows) = (5usize, 5usize);
        let pixels: Vec<u8> = (0..w * rows * 3).map(|i| (i * 53 + i / 7) as u8).collect();
        let rb = w * 3;
        let mut raw = Vec::new();
        for (y, kind) in (0..rows).zip(0u8..5) {
            raw.push(kind);
            for i in 0..rb {
                let x = pixels[y * rb + i];
                let a = if i >= 3 { pixels[y * rb + i - 3] } else { 0 };
                let b = if y > 0 { pixels[(y - 1) * rb + i] } else { 0 };
                let c = if y > 0 && i >= 3 {
                    pixels[(y - 1) * rb + i - 3]
                } else {
                    0
                };
                raw.push(match kind {
                    0 => x,
                    1 => x.wrapping_sub(a),
                    2 => x.wrapping_sub(b),
                    3 => x.wrapping_sub(((u16::from(a) + u16::from(b)) / 2) as u8),
                    _ => x.wrapping_sub(paeth(a, b, c)),
                });
            }
        }
        let mut png = SIGNATURE.to_vec();
        let mut chunk = |kind: &[u8; 4], body: &[u8]| {
            png.extend_from_slice(&(body.len() as u32).to_be_bytes());
            let mut c = kind.to_vec();
            c.extend_from_slice(body);
            png.extend_from_slice(&c);
            png.extend_from_slice(&rt_core::png::crc32(&c).to_be_bytes());
        };
        let mut ihdr = (w as u32).to_be_bytes().to_vec();
        ihdr.extend_from_slice(&(rows as u32).to_be_bytes());
        ihdr.extend_from_slice(&[8, 2, 0, 0, 0]);
        chunk(b"IHDR", &ihdr);
        chunk(b"IDAT", &rt_core::png::zlib_stored(&raw));
        chunk(b"IEND", &[]);
        let img = decode(&png, 100).unwrap();
        assert_eq!(rgb_of(&img), pixels);
    }
}
