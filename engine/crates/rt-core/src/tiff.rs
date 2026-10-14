//! An uncompressed TIFF writer, written from the public specification ("TIFF Revision 6.0",
//! Adobe Systems Incorporated, 3 June 1992: §2 *TIFF Structure*, §6 *RGB Full Color Images*,
//! §8 *Baseline Field Reference Guide* and, for floating point samples, §19 *Data Sample
//! Format*). Nothing is taken from any other writer or reader.
//!
//! The file is little-endian (`II`, 42) with one image file directory:
//!
//! ```text
//! 0   header           "II", 42, offset of the directory (always 8)
//! 8   directory        u16 entry count, 12 bytes per entry (tag, type, count, value or
//!                      offset; values of 4 bytes or fewer sit inside the entry, left-justified),
//!                      u32 offset of the next directory (0)
//!     extra values     everything that does not fit inside an entry, in entry order, each one
//!                      starting at an even offset
//!     pixels           the strips, one after another
//! ```
//!
//! Entries are sorted by tag, as the specification requires. The image is RGB (photometric 2)
//! or RGBA with **unassociated** alpha (`ExtraSamples` 2), chunky (`PlanarConfiguration` 1),
//! uncompressed (`Compression` 1), in strips of about 8 KiB (the size §7 recommends), with the
//! resolution in dots per inch (`ResolutionUnit` 2) and no colour profile: 8 and 16 bit samples
//! are sRGB by convention, 32 bit samples are IEEE floats (`SampleFormat` 3) in linear light.
//! The directory is built by [`Entry`] and [`assemble`], which [`crate::dng`] shares: a DNG is a
//! TIFF with more tags.
//!
//! The same bytes are written by `encodeTiff` in `src/io/image.ts`; `tests/fixtures/tiff/` holds
//! the files both sides are compared with.

/// The samples of an image, interleaved (`R G B` or `R G B A` for every pixel, rows top to
/// bottom). 8 and 16 bit samples are display-encoded; floats are linear light.
#[derive(Clone, Copy, Debug)]
pub enum Samples<'a> {
    /// 8 bits per sample.
    U8(&'a [u8]),
    /// 16 bits per sample.
    U16(&'a [u16]),
    /// 32-bit IEEE floats.
    F32(&'a [f32]),
}

impl Samples<'_> {
    fn len(&self) -> usize {
        match self {
            Samples::U8(s) => s.len(),
            Samples::U16(s) => s.len(),
            Samples::F32(s) => s.len(),
        }
    }

    /// Bits per sample.
    fn bits(&self) -> u16 {
        match self {
            Samples::U8(_) => 8,
            Samples::U16(_) => 16,
            Samples::F32(_) => 32,
        }
    }
}

/// Field types (TIFF 6.0 §2): the codes of the `type` word of an entry.
pub(crate) mod kind {
    pub const BYTE: u16 = 1;
    pub const ASCII: u16 = 2;
    pub const SHORT: u16 = 3;
    pub const LONG: u16 = 4;
    pub const RATIONAL: u16 = 5;
    pub const SRATIONAL: u16 = 10;
}

/// Tag numbers (TIFF 6.0 §8; the DNG tags are in [`crate::dng`]).
pub(crate) mod tag {
    pub const NEW_SUBFILE_TYPE: u16 = 254;
    pub const IMAGE_WIDTH: u16 = 256;
    pub const IMAGE_LENGTH: u16 = 257;
    pub const BITS_PER_SAMPLE: u16 = 258;
    pub const COMPRESSION: u16 = 259;
    pub const PHOTOMETRIC: u16 = 262;
    pub const MAKE: u16 = 271;
    pub const MODEL: u16 = 272;
    pub const STRIP_OFFSETS: u16 = 273;
    pub const SAMPLES_PER_PIXEL: u16 = 277;
    pub const ROWS_PER_STRIP: u16 = 278;
    pub const STRIP_BYTE_COUNTS: u16 = 279;
    pub const X_RESOLUTION: u16 = 282;
    pub const Y_RESOLUTION: u16 = 283;
    pub const PLANAR_CONFIGURATION: u16 = 284;
    pub const RESOLUTION_UNIT: u16 = 296;
    pub const EXTRA_SAMPLES: u16 = 338;
    pub const SAMPLE_FORMAT: u16 = 339;
}

/// Bytes a strip aims at (§7: "about 8K bytes").
const STRIP_TARGET: usize = 8192;

/// One directory entry: its tag, field type, value count and the value already encoded
/// little-endian.
pub(crate) struct Entry {
    pub tag: u16,
    pub kind: u16,
    pub count: u32,
    pub data: Vec<u8>,
}

impl Entry {
    pub fn byte(tag: u16, values: &[u8]) -> Entry {
        Entry {
            tag,
            kind: kind::BYTE,
            count: values.len() as u32,
            data: values.to_vec(),
        }
    }

    /// An ASCII field: the text and its terminating NUL (the count includes it).
    pub fn ascii(tag: u16, text: &str) -> Entry {
        let mut data = text.as_bytes().to_vec();
        data.push(0);
        Entry {
            tag,
            kind: kind::ASCII,
            count: data.len() as u32,
            data,
        }
    }

    pub fn short(tag: u16, values: &[u16]) -> Entry {
        Entry {
            tag,
            kind: kind::SHORT,
            count: values.len() as u32,
            data: values.iter().flat_map(|v| v.to_le_bytes()).collect(),
        }
    }

    pub fn long(tag: u16, values: &[u32]) -> Entry {
        Entry {
            tag,
            kind: kind::LONG,
            count: values.len() as u32,
            data: values.iter().flat_map(|v| v.to_le_bytes()).collect(),
        }
    }

    /// Fractions `numerator / denominator`, two longs each.
    pub fn rational(tag: u16, values: &[(u32, u32)]) -> Entry {
        Entry {
            tag,
            kind: kind::RATIONAL,
            count: values.len() as u32,
            data: values
                .iter()
                .flat_map(|(n, d)| n.to_le_bytes().into_iter().chain(d.to_le_bytes()))
                .collect(),
        }
    }

    /// Signed fractions, two signed longs each.
    pub fn srational(tag: u16, values: &[(i32, i32)]) -> Entry {
        Entry {
            tag,
            kind: kind::SRATIONAL,
            count: values.len() as u32,
            data: values
                .iter()
                .flat_map(|(n, d)| n.to_le_bytes().into_iter().chain(d.to_le_bytes()))
                .collect(),
        }
    }
}

/// An image to write: its size and samples. `channels` is 3 (RGB) or 4 (RGBA).
pub(crate) struct Raster<'a> {
    pub width: u32,
    pub height: u32,
    pub channels: u32,
    pub samples: Samples<'a>,
}

impl<'a> Raster<'a> {
    /// # Panics
    ///
    /// If a side is zero, `channels` is not 3 or 4, or the buffer does not hold exactly
    /// `width * height * channels` samples. Callers validate sizes first.
    pub fn new(width: u32, height: u32, channels: u32, samples: Samples<'a>) -> Raster<'a> {
        assert!(width > 0 && height > 0, "TIFF dimensions must be non-zero");
        assert!(
            channels == 3 || channels == 4,
            "TIFF is written as RGB or RGBA"
        );
        assert_eq!(
            samples.len() as u64,
            u64::from(width) * u64::from(height) * u64::from(channels),
            "sample buffer does not match the dimensions"
        );
        Raster {
            width,
            height,
            channels,
            samples,
        }
    }

    fn row_bytes(&self) -> usize {
        self.width as usize * self.channels as usize * usize::from(self.samples.bits() / 8)
    }

    /// Rows in every strip but the last: as many as fit in [`STRIP_TARGET`], at least one.
    fn rows_per_strip(&self) -> u32 {
        ((STRIP_TARGET / self.row_bytes()).max(1) as u32).min(self.height)
    }

    fn strips(&self) -> u32 {
        self.height.div_ceil(self.rows_per_strip())
    }

    /// The pixels as the file stores them: little-endian samples, rows top to bottom.
    fn pixel_bytes(&self) -> Vec<u8> {
        match self.samples {
            Samples::U8(s) => s.to_vec(),
            Samples::U16(s) => s.iter().flat_map(|v| v.to_le_bytes()).collect(),
            Samples::F32(s) => s.iter().flat_map(|v| v.to_le_bytes()).collect(),
        }
    }

    /// The entries every image has (width, height, bits, compression, strips, samples per pixel,
    /// planar configuration) plus `ExtraSamples` for alpha and `SampleFormat` for floats. The
    /// strip offsets are placeholders: [`assemble`] fills them in.
    pub fn entries(&self) -> Vec<Entry> {
        let channels = self.channels as usize;
        let strips = self.strips() as usize;
        let mut entries = vec![
            Entry::long(tag::IMAGE_WIDTH, &[self.width]),
            Entry::long(tag::IMAGE_LENGTH, &[self.height]),
            Entry::short(tag::BITS_PER_SAMPLE, &vec![self.samples.bits(); channels]),
            Entry::short(tag::COMPRESSION, &[1]),
            Entry::long(tag::STRIP_OFFSETS, &vec![0; strips]),
            Entry::short(tag::SAMPLES_PER_PIXEL, &[self.channels as u16]),
            Entry::long(tag::ROWS_PER_STRIP, &[self.rows_per_strip()]),
            Entry::long(tag::STRIP_BYTE_COUNTS, &self.strip_byte_counts()),
            Entry::short(tag::PLANAR_CONFIGURATION, &[1]),
        ];
        if self.channels == 4 {
            // 2: unassociated alpha (the colour is not multiplied by it).
            entries.push(Entry::short(tag::EXTRA_SAMPLES, &[2]));
        }
        if matches!(self.samples, Samples::F32(_)) {
            // 3: IEEE floating point.
            entries.push(Entry::short(tag::SAMPLE_FORMAT, &vec![3; channels]));
        }
        entries
    }

    fn strip_byte_counts(&self) -> Vec<u32> {
        let rows = self.rows_per_strip();
        (0..self.strips())
            .map(|i| {
                let first = i * rows;
                (rows.min(self.height - first) as usize * self.row_bytes()) as u32
            })
            .collect()
    }
}

/// Writes the file: header, directory of `entries` (sorted by tag here), the values that do not
/// fit in an entry, and the pixels of `raster` in strips. `StripOffsets` is rewritten with the
/// real offsets.
///
/// # Panics
///
/// If the file would not fit the 32-bit offsets of classic TIFF (4 GiB), or `entries` lacks a
/// `StripOffsets` entry of the right size (the ones [`Raster::entries`] makes).
pub(crate) fn assemble(mut entries: Vec<Entry>, raster: &Raster<'_>) -> Vec<u8> {
    entries.sort_by_key(|e| e.tag);
    let pixels = raster.pixel_bytes();
    let directory = 2 + 12 * entries.len() + 4;
    let extra: usize = entries
        .iter()
        .filter(|e| e.data.len() > 4)
        .map(|e| e.data.len() + (e.data.len() & 1))
        .sum();
    let first_pixel = 8 + directory + extra;
    assert!(
        (first_pixel as u64 + pixels.len() as u64) <= u64::from(u32::MAX),
        "the image is too large for a TIFF"
    );

    // The strips are contiguous, so their offsets follow from the byte counts.
    let counts = raster.strip_byte_counts();
    let mut at = first_pixel as u32;
    let offsets: Vec<u32> = counts
        .iter()
        .map(|c| {
            let start = at;
            at += c;
            start
        })
        .collect();
    let strip_offsets = entries
        .iter_mut()
        .find(|e| e.tag == tag::STRIP_OFFSETS)
        .expect("a StripOffsets entry");
    assert_eq!(strip_offsets.count as usize, offsets.len());
    strip_offsets.data = offsets.iter().flat_map(|v| v.to_le_bytes()).collect();

    let mut out = Vec::with_capacity(first_pixel + pixels.len());
    out.extend_from_slice(&[b'I', b'I', 42, 0]);
    out.extend_from_slice(&8u32.to_le_bytes());
    out.extend_from_slice(&(entries.len() as u16).to_le_bytes());
    let mut next_extra = (8 + directory) as u32;
    for e in &entries {
        out.extend_from_slice(&e.tag.to_le_bytes());
        out.extend_from_slice(&e.kind.to_le_bytes());
        out.extend_from_slice(&e.count.to_le_bytes());
        if e.data.len() <= 4 {
            out.extend_from_slice(&e.data);
            out.resize(out.len() + 4 - e.data.len(), 0);
        } else {
            out.extend_from_slice(&next_extra.to_le_bytes());
            next_extra += (e.data.len() + (e.data.len() & 1)) as u32;
        }
    }
    out.extend_from_slice(&0u32.to_le_bytes());
    for e in entries.iter().filter(|e| e.data.len() > 4) {
        out.extend_from_slice(&e.data);
        if e.data.len() & 1 == 1 {
            out.push(0);
        }
    }
    debug_assert_eq!(out.len(), first_pixel);
    out.extend_from_slice(&pixels);
    out
}

/// Encodes an image as an uncompressed TIFF. `samples` holds `width * height * channels` values
/// (`channels` 3: RGB, 4: RGBA with unassociated alpha); `dpi` is written as the resolution in
/// both directions (zero is written as 1).
///
/// # Panics
///
/// If a side is zero, `channels` is not 3 or 4, the buffer does not match the dimensions, or the
/// file would not fit the 32-bit offsets of classic TIFF.
pub fn encode(width: u32, height: u32, channels: u32, samples: Samples<'_>, dpi: u32) -> Vec<u8> {
    let raster = Raster::new(width, height, channels, samples);
    let dpi = dpi.max(1);
    let mut entries = raster.entries();
    entries.push(Entry::short(tag::PHOTOMETRIC, &[2]));
    entries.push(Entry::rational(tag::X_RESOLUTION, &[(dpi, 1)]));
    entries.push(Entry::rational(tag::Y_RESOLUTION, &[(dpi, 1)]));
    // 2: inches.
    entries.push(Entry::short(tag::RESOLUTION_UNIT, &[2]));
    assemble(entries, &raster)
}

#[cfg(test)]
pub(crate) mod reader {
    //! A minimal reader for the tests: it follows the specification's layout (header, directory,
    //! offsets) and checks it, so a writer that only agrees with itself does not pass.

    use std::collections::BTreeMap;

    /// One directory entry as read.
    #[derive(Debug, Clone, PartialEq)]
    pub struct Field {
        pub kind: u16,
        pub count: u32,
        /// The value bytes (inline or at the offset).
        pub bytes: Vec<u8>,
    }

    impl Field {
        pub fn shorts(&self) -> Vec<u16> {
            assert_eq!(self.kind, 3);
            self.bytes
                .chunks_exact(2)
                .map(|c| u16::from_le_bytes([c[0], c[1]]))
                .collect()
        }

        pub fn longs(&self) -> Vec<u32> {
            assert_eq!(self.kind, 4);
            self.bytes
                .chunks_exact(4)
                .map(|c| u32::from_le_bytes([c[0], c[1], c[2], c[3]]))
                .collect()
        }

        pub fn rationals(&self) -> Vec<(u32, u32)> {
            assert_eq!(self.kind, 5);
            let l: Vec<u32> = self
                .bytes
                .chunks_exact(4)
                .map(|c| u32::from_le_bytes([c[0], c[1], c[2], c[3]]))
                .collect();
            l.chunks_exact(2).map(|p| (p[0], p[1])).collect()
        }

        pub fn srationals(&self) -> Vec<(i32, i32)> {
            assert_eq!(self.kind, 10);
            let l: Vec<i32> = self
                .bytes
                .chunks_exact(4)
                .map(|c| i32::from_le_bytes([c[0], c[1], c[2], c[3]]))
                .collect();
            l.chunks_exact(2).map(|p| (p[0], p[1])).collect()
        }

        pub fn text(&self) -> String {
            assert_eq!(self.kind, 2);
            assert_eq!(*self.bytes.last().unwrap(), 0, "ASCII ends in NUL");
            String::from_utf8(self.bytes[..self.bytes.len() - 1].to_vec()).unwrap()
        }
    }

    /// A parsed file: the tags in file order and the pixel bytes joined from the strips.
    pub struct Parsed {
        pub tags: Vec<u16>,
        pub fields: BTreeMap<u16, Field>,
        pub pixels: Vec<u8>,
    }

    impl Parsed {
        pub fn get(&self, tag: u16) -> &Field {
            self.fields
                .get(&tag)
                .unwrap_or_else(|| panic!("tag {tag} is missing"))
        }

        pub fn long(&self, tag: u16) -> u32 {
            self.get(tag).longs()[0]
        }

        pub fn short(&self, tag: u16) -> u16 {
            self.get(tag).shorts()[0]
        }
    }

    fn u16_at(b: &[u8], at: usize) -> u16 {
        u16::from_le_bytes([b[at], b[at + 1]])
    }

    fn u32_at(b: &[u8], at: usize) -> u32 {
        u32::from_le_bytes([b[at], b[at + 1], b[at + 2], b[at + 3]])
    }

    fn size_of(kind: u16) -> usize {
        match kind {
            1 | 2 | 6 | 7 => 1,
            3 | 8 => 2,
            4 | 9 | 11 => 4,
            5 | 10 | 12 => 8,
            other => panic!("unknown field type {other}"),
        }
    }

    pub fn parse(b: &[u8]) -> Parsed {
        assert_eq!(&b[..4], &[b'I', b'I', 42, 0], "little-endian TIFF header");
        let ifd = u32_at(b, 4) as usize;
        assert_eq!(ifd, 8);
        let n = u16_at(b, ifd) as usize;
        let mut tags = Vec::new();
        let mut fields = BTreeMap::new();
        let mut spans = Vec::new();
        for i in 0..n {
            let e = ifd + 2 + 12 * i;
            let (tag, kind, count) = (u16_at(b, e), u16_at(b, e + 2), u32_at(b, e + 4));
            let len = size_of(kind) * count as usize;
            let bytes = if len <= 4 {
                b[e + 8..e + 8 + len].to_vec()
            } else {
                let at = u32_at(b, e + 8) as usize;
                assert_eq!(at % 2, 0, "tag {tag}: the value starts at an even offset");
                spans.push((at, at + len));
                b[at..at + len].to_vec()
            };
            tags.push(tag);
            assert!(
                fields.insert(tag, Field { kind, count, bytes }).is_none(),
                "tag {tag} twice"
            );
        }
        assert!(
            tags.windows(2).all(|w| w[0] < w[1]),
            "tags sorted: {tags:?}"
        );
        assert_eq!(u32_at(b, ifd + 2 + 12 * n), 0, "a single directory");
        // The out-of-line values follow the directory without gaps, and then come the pixels.
        let mut end = ifd + 2 + 12 * n + 4;
        for (from, to) in &spans {
            assert_eq!(*from, end, "extra values are packed in entry order");
            end = to + (to & 1);
        }

        let strips = fields[&273].longs();
        let counts = fields[&279].longs();
        assert_eq!(strips.len(), counts.len());
        let mut pixels = Vec::new();
        let mut expected = end;
        for (offset, count) in strips.iter().zip(&counts) {
            assert_eq!(*offset as usize, expected, "strips follow one another");
            pixels.extend_from_slice(&b[*offset as usize..(*offset + count) as usize]);
            expected = (*offset + count) as usize;
        }
        assert_eq!(expected, b.len(), "no bytes after the last strip");
        Parsed {
            tags,
            fields,
            pixels,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::reader::parse;
    use super::*;

    /// The 4×4 test image of the golden files: sample `c` of pixel `p` (see the TypeScript twin
    /// in tests/tiff-dng.test.ts).
    fn u8_image(channels: usize) -> Vec<u8> {
        (0..16usize)
            .flat_map(|p| (0..channels).map(move |c| ((p * 17 + c * 5) & 255) as u8))
            .collect()
    }

    fn u16_image(channels: usize) -> Vec<u16> {
        (0..16usize)
            .flat_map(|p| (0..channels).map(move |c| ((p * 4099 + c * 1021) & 0xffff) as u16))
            .collect()
    }

    fn f32_image(channels: usize) -> Vec<f32> {
        (0..16usize)
            .flat_map(|p| (0..channels).map(move |c| (p * 7 + c * 13) as f32 / 64.0))
            .collect()
    }

    #[test]
    fn rgb8_round_trip() {
        let px = u8_image(3);
        let file = encode(4, 4, 3, Samples::U8(&px), 72);
        let t = parse(&file);
        assert_eq!(t.pixels, px);
        assert_eq!(t.long(tag::IMAGE_WIDTH), 4);
        assert_eq!(t.long(tag::IMAGE_LENGTH), 4);
        assert_eq!(t.get(tag::BITS_PER_SAMPLE).shorts(), [8, 8, 8]);
        assert_eq!(t.short(tag::COMPRESSION), 1);
        assert_eq!(t.short(tag::PHOTOMETRIC), 2);
        assert_eq!(t.short(tag::SAMPLES_PER_PIXEL), 3);
        assert_eq!(t.short(tag::PLANAR_CONFIGURATION), 1);
        assert_eq!(t.get(tag::X_RESOLUTION).rationals(), [(72, 1)]);
        assert_eq!(t.get(tag::Y_RESOLUTION).rationals(), [(72, 1)]);
        assert_eq!(t.short(tag::RESOLUTION_UNIT), 2);
        // No alpha, no sample format: the 8-bit baseline.
        assert!(!t.fields.contains_key(&tag::EXTRA_SAMPLES));
        assert!(!t.fields.contains_key(&tag::SAMPLE_FORMAT));
        // 12 bytes a row: 682 rows would fit a strip, so one strip holds the four rows.
        assert_eq!(t.long(tag::ROWS_PER_STRIP), 4);
        assert_eq!(t.get(tag::STRIP_BYTE_COUNTS).longs(), [48]);
    }

    #[test]
    fn rgba8_has_unassociated_alpha() {
        let px = u8_image(4);
        let t = parse(&encode(4, 4, 4, Samples::U8(&px), 72));
        assert_eq!(t.pixels, px);
        assert_eq!(t.get(tag::BITS_PER_SAMPLE).shorts(), [8, 8, 8, 8]);
        assert_eq!(t.short(tag::SAMPLES_PER_PIXEL), 4);
        // ExtraSamples: one extra sample, 2 = unassociated alpha.
        assert_eq!(t.get(tag::EXTRA_SAMPLES).shorts(), [2]);
    }

    #[test]
    fn sixteen_bit_samples_are_little_endian_words() {
        for channels in [3, 4] {
            let px = u16_image(channels);
            let t = parse(&encode(4, 4, channels as u32, Samples::U16(&px), 72));
            let words: Vec<u16> = t
                .pixels
                .chunks_exact(2)
                .map(|c| u16::from_le_bytes([c[0], c[1]]))
                .collect();
            assert_eq!(words, px);
            assert_eq!(t.get(tag::BITS_PER_SAMPLE).shorts(), vec![16; channels]);
            assert!(!t.fields.contains_key(&tag::SAMPLE_FORMAT));
        }
    }

    #[test]
    fn float_samples_say_so_and_keep_every_bit() {
        for channels in [3, 4] {
            let mut px = f32_image(channels);
            // Highlights beyond 1, a negative, a denormal and the infinities travel untouched.
            px[0] = 123.5;
            px[1] = -0.25;
            px[2] = f32::from_bits(1);
            px[3 % channels] = f32::INFINITY;
            let t = parse(&encode(4, 4, channels as u32, Samples::F32(&px), 300));
            let back: Vec<u32> = t
                .pixels
                .chunks_exact(4)
                .map(|c| u32::from_le_bytes([c[0], c[1], c[2], c[3]]))
                .collect();
            let want: Vec<u32> = px.iter().map(|v| v.to_bits()).collect();
            assert_eq!(back, want);
            assert_eq!(t.get(tag::BITS_PER_SAMPLE).shorts(), vec![32; channels]);
            assert_eq!(t.get(tag::SAMPLE_FORMAT).shorts(), vec![3; channels]);
            assert_eq!(t.get(tag::X_RESOLUTION).rationals(), [(300, 1)]);
        }
    }

    #[test]
    fn strips_are_about_eight_kilobytes_and_the_last_one_may_be_short() {
        // 100 × 3 × 1 byte = 300 bytes a row: 27 rows fit 8192 bytes; 70 rows make 3 strips.
        let px = vec![7u8; 100 * 70 * 3];
        let t = parse(&encode(100, 70, 3, Samples::U8(&px), 72));
        assert_eq!(t.long(tag::ROWS_PER_STRIP), 27);
        assert_eq!(t.get(tag::STRIP_BYTE_COUNTS).longs(), [8100, 8100, 4800]);
        assert_eq!(t.pixels.len(), px.len());
        // A row wider than a strip target still gets one row a strip.
        let wide = vec![1.5f32; 3000 * 2 * 3];
        let t = parse(&encode(3000, 2, 3, Samples::F32(&wide), 72));
        assert_eq!(t.long(tag::ROWS_PER_STRIP), 1);
        assert_eq!(t.get(tag::STRIP_OFFSETS).count, 2);
    }

    #[test]
    fn zero_dpi_is_written_as_one() {
        let px = u8_image(3);
        let t = parse(&encode(4, 4, 3, Samples::U8(&px), 0));
        assert_eq!(t.get(tag::X_RESOLUTION).rationals(), [(1, 1)]);
    }

    #[test]
    #[should_panic(expected = "does not match")]
    fn a_buffer_of_the_wrong_size_is_refused() {
        encode(4, 4, 3, Samples::U8(&[0; 10]), 72);
    }

    #[test]
    #[should_panic(expected = "non-zero")]
    fn an_empty_image_is_refused() {
        encode(0, 4, 3, Samples::U8(&[]), 72);
    }

    #[test]
    #[should_panic(expected = "RGB or RGBA")]
    fn only_rgb_and_rgba_are_written() {
        encode(2, 2, 1, Samples::U8(&[0; 4]), 72);
    }
}
