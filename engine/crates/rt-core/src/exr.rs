//! OpenEXR scanline images: a reader for the uncompressed, RLE, ZIPS and ZIP compressions, and
//! an uncompressed writer, written from the public file layout ("The OpenEXR File Layout",
//! openexr.com, Industrial Light & Magic; "Technical Introduction to OpenEXR", F. Kainz,
//! R. Bogart, P. Stanczyk, 2004–2013).
//!
//! A file is the magic `76 2f 31 01`, a version word (2, with flag bits for tiles, long names,
//! deep data and multiple parts), a header of attributes (`name\0 type\0 u32 size value`, ended
//! by an empty name), an offset table with one `u64` per chunk, and the chunks (`i32 y`,
//! `i32 size`, data). A chunk of an uncompressed file holds one scanline; a scanline holds every
//! channel in turn (channels are sorted by name), each `width` samples of 16-bit half floats,
//! 32-bit floats or 32-bit unsigned integers, little-endian.
//!
//! * **RLE** (1) and **ZIPS** (2): one scanline per chunk; **ZIP** (3): sixteen. The data is
//!   run-length coded (a signed count byte: negative, `-n` literal bytes follow; otherwise the next
//!   byte repeats `n + 1` times) or zlib-compressed ([`crate::inflate`]), then a byte predictor is
//!   undone (each byte is the previous one plus the stored difference minus 128) and the two
//!   halves of the buffer are interleaved back (bytes 0, 2, 4... were stored first, then 1, 3,
//!   5...). A chunk whose stored size is not smaller than its raw size is stored uncompressed.
//! * PIZ, PXR24, B44, B44A and the DWA compressions, tiled, deep and multi-part files are refused
//!   with an error that names them.
//!
//! The image is the data window. Colour comes from the channels `R`, `G`, `B` (or one layer's
//! `<layer>.R` ...), or a luminance channel `Y` as grey; other channels are skipped. Half floats
//! are converted by their bits, so the result is the same on every platform.

use crate::inflate::{zlib_decompress, InflateError};
use std::fmt;

/// The four magic bytes of an OpenEXR file.
pub const MAGIC: [u8; 4] = [0x76, 0x2f, 0x31, 0x01];

/// Why an `.exr` file could not be read.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ExrError {
    /// The file does not start with the OpenEXR magic number.
    NotExr,
    /// The file is valid but uses something this reader does not do (named).
    Unsupported(&'static str),
    /// The header or a chunk is malformed (what was wrong).
    Corrupt(&'static str),
    /// The image is larger than the caller allows.
    TooLarge,
    /// A compressed chunk failed to decompress.
    Inflate(InflateError),
}

impl fmt::Display for ExrError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ExrError::NotExr => f.write_str("not an OpenEXR file"),
            ExrError::Unsupported(what) => write!(f, "OpenEXR {what} is not supported"),
            ExrError::Corrupt(what) => write!(f, "OpenEXR file is corrupt: {what}"),
            ExrError::TooLarge => f.write_str("OpenEXR image is too large"),
            ExrError::Inflate(e) => write!(f, "OpenEXR chunk: {e}"),
        }
    }
}

impl std::error::Error for ExrError {}

/// A decoded image: linear RGB, rows top to bottom (increasing y of the data window).
#[derive(Clone, Debug, PartialEq)]
pub struct ExrImage {
    /// Width of the data window.
    pub width: u32,
    /// Height of the data window.
    pub height: u32,
    /// `3 * width * height` floats.
    pub rgb: Vec<f32>,
}

/// Sample type of a channel.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PixelType {
    /// 0: 32-bit unsigned integer.
    Uint,
    /// 1: 16-bit half float.
    Half,
    /// 2: 32-bit float.
    Float,
}

impl PixelType {
    fn bytes(self) -> usize {
        match self {
            PixelType::Half => 2,
            _ => 4,
        }
    }
}

/// `compression` attribute values.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Compression {
    /// 0: none.
    None,
    /// 1: run-length.
    Rle,
    /// 2: zlib, one scanline per chunk.
    Zips,
    /// 3: zlib, sixteen scanlines per chunk.
    Zip,
}

impl Compression {
    fn lines(self) -> usize {
        match self {
            Compression::Zip => 16,
            _ => 1,
        }
    }
}

#[derive(Clone, Debug)]
struct Channel {
    name: String,
    kind: PixelType,
}

/// The float of a half's bits (IEEE 754 binary16).
pub fn half_to_f32(h: u16) -> f32 {
    let sign = u32::from(h >> 15) << 31;
    let exp = u32::from((h >> 10) & 0x1f);
    let man = u32::from(h & 0x3ff);
    let bits = if exp == 0 {
        if man == 0 {
            sign
        } else {
            // Subnormal: normalise.
            let mut e = 127 - 15 + 1;
            let mut m = man;
            while m & 0x400 == 0 {
                m <<= 1;
                e -= 1;
            }
            sign | (e << 23) | ((m & 0x3ff) << 13)
        }
    } else if exp == 31 {
        sign | 0x7f80_0000 | (man << 13)
    } else {
        sign | ((exp + 127 - 15) << 23) | (man << 13)
    };
    f32::from_bits(bits)
}

/// The half nearest to `v` (ties to even; overflow to infinity, NaN kept).
pub fn f32_to_half(v: f32) -> u16 {
    let bits = v.to_bits();
    let sign = ((bits >> 16) & 0x8000) as u16;
    let exp = ((bits >> 23) & 0xff) as i32;
    let man = bits & 0x7f_ffff;
    if exp == 255 {
        return sign | 0x7c00 | if man != 0 { 0x200 } else { 0 };
    }
    let e = exp - 127 + 15;
    if e >= 31 {
        return sign | 0x7c00;
    }
    if e <= 0 {
        if e < -10 {
            return sign;
        }
        let m = man | 0x80_0000;
        let shift = (14 - e) as u32;
        let half = m >> shift;
        let rest = m & ((1 << shift) - 1);
        let mid = 1 << (shift - 1);
        let round = rest > mid || (rest == mid && half & 1 == 1);
        return sign | (half + u32::from(round)) as u16;
    }
    let half = ((e as u32) << 10) | (man >> 13);
    let rest = man & 0x1fff;
    let round = rest > 0x1000 || (rest == 0x1000 && half & 1 == 1);
    sign | (half + u32::from(round)) as u16
}

/// Little-endian cursor over the file.
struct Cursor<'a> {
    bytes: &'a [u8],
    pos: usize,
}

impl<'a> Cursor<'a> {
    fn take(&mut self, n: usize) -> Result<&'a [u8], ExrError> {
        let s = self
            .bytes
            .get(self.pos..self.pos.checked_add(n).ok_or(ExrError::Corrupt("size"))?)
            .ok_or(ExrError::Corrupt("file ends early"))?;
        self.pos += n;
        Ok(s)
    }

    fn u32(&mut self) -> Result<u32, ExrError> {
        let b = self.take(4)?;
        Ok(u32::from_le_bytes([b[0], b[1], b[2], b[3]]))
    }

    fn i32(&mut self) -> Result<i32, ExrError> {
        Ok(self.u32()? as i32)
    }

    fn u64(&mut self) -> Result<u64, ExrError> {
        let b = self.take(8)?;
        Ok(u64::from_le_bytes([
            b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7],
        ]))
    }

    fn string(&mut self) -> Result<&'a [u8], ExrError> {
        let rest = &self.bytes[self.pos.min(self.bytes.len())..];
        let end = rest
            .iter()
            .position(|&b| b == 0)
            .ok_or(ExrError::Corrupt("unterminated name"))?;
        self.pos += end + 1;
        Ok(&rest[..end])
    }
}

fn parse_channels(value: &[u8]) -> Result<Vec<Channel>, ExrError> {
    let mut c = Cursor {
        bytes: value,
        pos: 0,
    };
    let mut out = Vec::new();
    loop {
        let name = c.string()?;
        if name.is_empty() {
            break;
        }
        let kind = match c.i32()? {
            0 => PixelType::Uint,
            1 => PixelType::Half,
            2 => PixelType::Float,
            _ => return Err(ExrError::Corrupt("channel type")),
        };
        c.take(4)?; // pLinear and reserved bytes
        let (xs, ys) = (c.i32()?, c.i32()?);
        if xs != 1 || ys != 1 {
            return Err(ExrError::Unsupported("subsampled channels"));
        }
        let name = String::from_utf8_lossy(name).into_owned();
        out.push(Channel { name, kind });
    }
    if out.is_empty() {
        return Err(ExrError::Corrupt("no channels"));
    }
    Ok(out)
}

/// Indices of the channels to read as red, green and blue.
fn colour_channels(channels: &[Channel]) -> Result<[usize; 3], ExrError> {
    let find = |want: &str| -> Option<usize> {
        if let Some(i) = channels.iter().position(|c| c.name == want) {
            return Some(i);
        }
        let suffix = format!(".{want}");
        let matches: Vec<usize> = channels
            .iter()
            .enumerate()
            .filter(|(_, c)| c.name.ends_with(&suffix))
            .map(|(i, _)| i)
            .collect();
        (matches.len() == 1).then(|| matches[0])
    };
    match (find("R"), find("G"), find("B")) {
        (Some(r), Some(g), Some(b)) => Ok([r, g, b]),
        _ => find("Y").map(|y| [y; 3]).ok_or(ExrError::Unsupported(
            "images without R, G, B or Y channels",
        )),
    }
}

/// Undoes ZIP and RLE's predictor and byte interleaving.
fn unpredict(data: &mut [u8]) -> Vec<u8> {
    for i in 1..data.len() {
        data[i] = data[i - 1].wrapping_add(data[i]).wrapping_sub(128);
    }
    let half = data.len().div_ceil(2);
    let mut out = Vec::with_capacity(data.len());
    for i in 0..half {
        out.push(data[i]);
        if half + i < data.len() {
            out.push(data[half + i]);
        }
    }
    out
}

fn rle_decode(data: &[u8], expected: usize) -> Result<Vec<u8>, ExrError> {
    let mut out = Vec::with_capacity(expected);
    let mut i = 0;
    while i < data.len() {
        let count = data[i] as i8;
        i += 1;
        if count < 0 {
            let n = usize::from(count.unsigned_abs());
            let src = data
                .get(i..i + n)
                .ok_or(ExrError::Corrupt("RLE literal run"))?;
            out.extend_from_slice(src);
            i += n;
        } else {
            let value = *data.get(i).ok_or(ExrError::Corrupt("RLE run"))?;
            i += 1;
            out.extend(std::iter::repeat_n(value, count as usize + 1));
        }
        if out.len() > expected {
            return Err(ExrError::Corrupt("RLE data too long"));
        }
    }
    Ok(out)
}

/// Decodes an OpenEXR file whose image has at most `max_pixels` pixels.
pub fn decode(bytes: &[u8], max_pixels: u64) -> Result<ExrImage, ExrError> {
    if bytes.len() < 8 || bytes[..4] != MAGIC {
        return Err(ExrError::NotExr);
    }
    let version = u32::from_le_bytes([bytes[4], bytes[5], bytes[6], bytes[7]]);
    if version & 0xff != 2 {
        return Err(ExrError::Unsupported("file version"));
    }
    if version & 0x200 != 0 {
        return Err(ExrError::Unsupported("tiled image"));
    }
    if version & 0x800 != 0 {
        return Err(ExrError::Unsupported("deep data"));
    }
    if version & 0x1000 != 0 {
        return Err(ExrError::Unsupported("multi-part file"));
    }
    let mut c = Cursor { bytes, pos: 8 };
    let mut channels = None;
    let mut compression = None;
    let mut window = None;
    loop {
        let name = c.string()?;
        if name.is_empty() {
            break;
        }
        let _kind = c.string()?;
        let size = c.u32()? as usize;
        let value = c.take(size)?;
        match name {
            b"channels" => channels = Some(parse_channels(value)?),
            b"compression" => {
                compression = Some(match value.first() {
                    Some(0) => Compression::None,
                    Some(1) => Compression::Rle,
                    Some(2) => Compression::Zips,
                    Some(3) => Compression::Zip,
                    Some(4) => return Err(ExrError::Unsupported("PIZ compression")),
                    Some(5) => return Err(ExrError::Unsupported("PXR24 compression")),
                    Some(6) | Some(7) => return Err(ExrError::Unsupported("B44 compression")),
                    Some(8) | Some(9) => return Err(ExrError::Unsupported("DWA compression")),
                    _ => return Err(ExrError::Corrupt("compression")),
                })
            }
            b"dataWindow" => {
                if value.len() != 16 {
                    return Err(ExrError::Corrupt("dataWindow"));
                }
                let v = |k: usize| {
                    i32::from_le_bytes([value[k], value[k + 1], value[k + 2], value[k + 3]])
                };
                window = Some((v(0), v(4), v(8), v(12)));
            }
            _ => {}
        }
    }
    let channels = channels.ok_or(ExrError::Corrupt("no channels attribute"))?;
    let compression = compression.ok_or(ExrError::Corrupt("no compression attribute"))?;
    let (x0, y0, x1, y1) = window.ok_or(ExrError::Corrupt("no dataWindow attribute"))?;
    if x1 < x0 || y1 < y0 {
        return Err(ExrError::Corrupt("empty dataWindow"));
    }
    let width = (i64::from(x1) - i64::from(x0) + 1) as u64;
    let height = (i64::from(y1) - i64::from(y0) + 1) as u64;
    if width > u64::from(u32::MAX) || height > u64::from(u32::MAX) || width * height > max_pixels {
        return Err(ExrError::TooLarge);
    }
    let (w, h) = (width as usize, height as usize);
    let rgb_index = colour_channels(&channels)?;
    // Byte offset of each channel inside a scanline, and the scanline size.
    let mut offsets = Vec::with_capacity(channels.len());
    let mut line_bytes = 0usize;
    for ch in &channels {
        offsets.push(line_bytes);
        line_bytes += w * ch.kind.bytes();
    }
    let lines = compression.lines();
    let chunks = h.div_ceil(lines);
    let mut table = Vec::with_capacity(chunks);
    for _ in 0..chunks {
        table.push(c.u64()?);
    }

    let mut rgb = vec![0.0f32; 3 * w * h];
    let mut seen = vec![false; chunks];
    for &offset in &table {
        let mut chunk = Cursor {
            bytes,
            pos: usize::try_from(offset).map_err(|_| ExrError::Corrupt("chunk offset"))?,
        };
        let y = chunk.i32()?;
        let size = chunk.u32()? as usize;
        let data = chunk.take(size)?;
        let first = i64::from(y) - i64::from(y0);
        if first < 0 || first as usize >= h || !(first as usize).is_multiple_of(lines) {
            return Err(ExrError::Corrupt("chunk y"));
        }
        let first = first as usize;
        if std::mem::replace(&mut seen[first / lines], true) {
            return Err(ExrError::Corrupt("chunk appears twice"));
        }
        let count = lines.min(h - first);
        let raw_size = count * line_bytes;
        let raw: Vec<u8> = if size >= raw_size || compression == Compression::None {
            if size != raw_size {
                return Err(ExrError::Corrupt("chunk size"));
            }
            data.to_vec()
        } else {
            let mut packed = match compression {
                Compression::Rle => rle_decode(data, raw_size)?,
                _ => zlib_decompress(data, raw_size).map_err(ExrError::Inflate)?,
            };
            if packed.len() != raw_size {
                return Err(ExrError::Corrupt("chunk decompresses to the wrong size"));
            }
            unpredict(&mut packed)
        };
        for line in 0..count {
            let row = &raw[line * line_bytes..(line + 1) * line_bytes];
            let out = &mut rgb[(first + line) * 3 * w..(first + line + 1) * 3 * w];
            for (k, &ci) in rgb_index.iter().enumerate() {
                let start = offsets[ci];
                match channels[ci].kind {
                    PixelType::Half => {
                        for x in 0..w {
                            let b = &row[start + 2 * x..start + 2 * x + 2];
                            out[3 * x + k] = half_to_f32(u16::from_le_bytes([b[0], b[1]]));
                        }
                    }
                    PixelType::Float => {
                        for x in 0..w {
                            let b = &row[start + 4 * x..start + 4 * x + 4];
                            out[3 * x + k] = f32::from_le_bytes([b[0], b[1], b[2], b[3]]);
                        }
                    }
                    PixelType::Uint => {
                        for x in 0..w {
                            let b = &row[start + 4 * x..start + 4 * x + 4];
                            out[3 * x + k] = u32::from_le_bytes([b[0], b[1], b[2], b[3]]) as f32;
                        }
                    }
                }
            }
        }
    }
    Ok(ExrImage {
        width: w as u32,
        height: h as u32,
        rgb,
    })
}

/// Reads only the size of the data window: `(width, height)`.
pub fn dimensions(bytes: &[u8]) -> Result<(u32, u32), ExrError> {
    if bytes.len() < 8 || bytes[..4] != MAGIC {
        return Err(ExrError::NotExr);
    }
    let mut c = Cursor { bytes, pos: 8 };
    loop {
        let name = c.string()?;
        if name.is_empty() {
            return Err(ExrError::Corrupt("no dataWindow attribute"));
        }
        c.string()?;
        let size = c.u32()? as usize;
        let value = c.take(size)?;
        if name == b"dataWindow" && value.len() == 16 {
            let v = |k: usize| {
                i64::from(i32::from_le_bytes([
                    value[k],
                    value[k + 1],
                    value[k + 2],
                    value[k + 3],
                ]))
            };
            let (w, h) = (v(8) - v(0) + 1, v(12) - v(4) + 1);
            if w <= 0 || h <= 0 || w > i64::from(u32::MAX) || h > i64::from(u32::MAX) {
                return Err(ExrError::Corrupt("empty dataWindow"));
            }
            return Ok((w as u32, h as u32));
        }
    }
}

fn attribute(out: &mut Vec<u8>, name: &str, kind: &str, value: &[u8]) {
    out.extend_from_slice(name.as_bytes());
    out.push(0);
    out.extend_from_slice(kind.as_bytes());
    out.push(0);
    out.extend_from_slice(&(value.len() as u32).to_le_bytes());
    out.extend_from_slice(value);
}

/// Writes an uncompressed scanline OpenEXR file with channels `B`, `G`, `R` of `kind` (half or
/// float) from `3 * width * height` linear RGB floats, rows top to bottom.
pub fn encode(width: u32, height: u32, rgb: &[f32], kind: PixelType) -> Vec<u8> {
    let (w, h) = (width as usize, height as usize);
    assert_eq!(rgb.len(), 3 * w * h, "pixel buffer does not match the size");
    assert!(
        kind != PixelType::Uint,
        "colour is written as half or float"
    );
    let mut out = MAGIC.to_vec();
    out.extend_from_slice(&2u32.to_le_bytes());
    let mut chlist = Vec::new();
    for name in ["B", "G", "R"] {
        chlist.extend_from_slice(name.as_bytes());
        chlist.push(0);
        let t: i32 = if kind == PixelType::Half { 1 } else { 2 };
        chlist.extend_from_slice(&t.to_le_bytes());
        chlist.extend_from_slice(&[0, 0, 0, 0]);
        chlist.extend_from_slice(&1i32.to_le_bytes());
        chlist.extend_from_slice(&1i32.to_le_bytes());
    }
    chlist.push(0);
    attribute(&mut out, "channels", "chlist", &chlist);
    attribute(&mut out, "compression", "compression", &[0]);
    let mut window = Vec::new();
    for v in [0i32, 0, width as i32 - 1, height as i32 - 1] {
        window.extend_from_slice(&v.to_le_bytes());
    }
    attribute(&mut out, "dataWindow", "box2i", &window);
    attribute(&mut out, "displayWindow", "box2i", &window);
    attribute(&mut out, "lineOrder", "lineOrder", &[0]);
    attribute(&mut out, "pixelAspectRatio", "float", &1.0f32.to_le_bytes());
    attribute(&mut out, "screenWindowCenter", "v2f", &[0; 8]);
    attribute(
        &mut out,
        "screenWindowWidth",
        "float",
        &1.0f32.to_le_bytes(),
    );
    out.push(0);
    let line_bytes = 3 * w * kind.bytes();
    let table_start = out.len();
    let first_chunk = table_start + 8 * h;
    for y in 0..h {
        let offset = (first_chunk + y * (8 + line_bytes)) as u64;
        out.extend_from_slice(&offset.to_le_bytes());
    }
    for y in 0..h {
        out.extend_from_slice(&(y as i32).to_le_bytes());
        out.extend_from_slice(&(line_bytes as u32).to_le_bytes());
        for channel in [2usize, 1, 0] {
            for x in 0..w {
                let v = rgb[3 * (y * w + x) + channel];
                if kind == PixelType::Half {
                    out.extend_from_slice(&f32_to_half(v).to_le_bytes());
                } else {
                    out.extend_from_slice(&v.to_le_bytes());
                }
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The pattern of the fixtures written by `tools/exr-fixtures.mjs`, exact in half floats.
    fn pattern(x: usize, y: usize) -> [f32; 3] {
        [
            ((x * 3 + y) % 64) as f32 / 16.0,
            (y % 32) as f32 / 32.0,
            ((x ^ y) % 16) as f32 / 8.0,
        ]
    }

    fn check_pattern(img: &ExrImage) {
        for y in 0..img.height as usize {
            for x in 0..img.width as usize {
                let i = 3 * (y * img.width as usize + x);
                assert_eq!(img.rgb[i..i + 3], pattern(x, y), "pixel {x}, {y}");
            }
        }
    }

    #[test]
    fn halves_convert_both_ways() {
        assert_eq!(half_to_f32(0x3c00), 1.0);
        assert_eq!(half_to_f32(0xc000), -2.0);
        assert_eq!(half_to_f32(0x7bff), 65504.0);
        assert_eq!(half_to_f32(0x0001), 5.960_464_5e-8);
        assert_eq!(half_to_f32(0x7c00), f32::INFINITY);
        assert!(half_to_f32(0x7e00).is_nan());
        for h in 0..=u16::MAX {
            let f = half_to_f32(h);
            if f.is_nan() {
                assert!(half_to_f32(f32_to_half(f)).is_nan());
            } else {
                assert_eq!(f32_to_half(f), h, "{h:#06x}");
            }
        }
        // Rounding to nearest, ties to even.
        assert_eq!(f32_to_half(1.0 + 1.0 / 2048.0), 0x3c00);
        assert_eq!(f32_to_half(1.0 + 3.0 / 2048.0), 0x3c02);
        assert_eq!(f32_to_half(1.0e6), 0x7c00);
        assert_eq!(f32_to_half(1.0e-9), 0);
    }

    #[test]
    fn uncompressed_files_round_trip_through_the_writer() {
        let (w, h) = (13usize, 5usize);
        let mut rgb = Vec::new();
        for y in 0..h {
            for x in 0..w {
                rgb.extend_from_slice(&pattern(x, y));
            }
        }
        for kind in [PixelType::Half, PixelType::Float] {
            let file = encode(w as u32, h as u32, &rgb, kind);
            assert_eq!(dimensions(&file), Ok((w as u32, h as u32)));
            let img = decode(&file, 1000).expect("decode");
            check_pattern(&img);
            assert_eq!(decode(&file, 10), Err(ExrError::TooLarge));
            for cut in 8..file.len() {
                assert!(decode(&file[..cut], 1000).is_err(), "cut {cut}");
            }
        }
    }

    #[test]
    fn zip_zips_and_rle_fixtures_decode_to_their_pattern() {
        for (name, file) in [
            (
                "zip",
                &include_bytes!("../../../../tests/fixtures/exr-zip-half.exr")[..],
            ),
            (
                "zips",
                &include_bytes!("../../../../tests/fixtures/exr-zips-float.exr")[..],
            ),
            (
                "rle",
                &include_bytes!("../../../../tests/fixtures/exr-rle-half.exr")[..],
            ),
        ] {
            let img = decode(file, 1 << 20).unwrap_or_else(|e| panic!("{name}: {e}"));
            assert_eq!((img.width, img.height), (40, 37), "{name}");
            check_pattern(&img);
        }
    }

    #[test]
    fn unsupported_and_broken_files_say_why() {
        assert_eq!(decode(b"#?RADIANCE", 10), Err(ExrError::NotExr));
        let good = encode(4, 4, &[0.5; 48], PixelType::Half);
        let mut tiled = good.clone();
        tiled[5] |= 0x02;
        assert_eq!(
            decode(&tiled, 100),
            Err(ExrError::Unsupported("tiled image"))
        );
        let mut multi = good.clone();
        multi[5] |= 0x10;
        assert_eq!(
            decode(&multi, 100),
            Err(ExrError::Unsupported("multi-part file"))
        );
        // PIZ: the compression byte follows its attribute's size.
        let at = good
            .windows(12)
            .position(|w| w == b"compression\0")
            .expect("attribute");
        let value = at + 12 + b"compression\0".len() + 4;
        let mut piz = good.clone();
        piz[value] = 4;
        assert_eq!(
            decode(&piz, 100),
            Err(ExrError::Unsupported("PIZ compression"))
        );
        assert!(ExrError::Unsupported("PIZ compression")
            .to_string()
            .contains("PIZ"));
    }
}
