//! A from-scratch PNG writer.
//!
//! The image data is stored with zlib *stored* (uncompressed) deflate blocks: trivially correct,
//! no dependency, and large enough to be useful for previews and tests. Compression can replace
//! [`zlib_stored`] later without touching the rest.

/// The eight byte PNG file signature.
pub const SIGNATURE: [u8; 8] = [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];

/// Largest payload of one stored deflate block.
const MAX_STORED_BLOCK: usize = 65_535;

/// CRC-32 lookup table (IEEE 802.3 polynomial, reflected), built at compile time.
const CRC_TABLE: [u32; 256] = {
    let mut table = [0u32; 256];
    let mut n = 0;
    while n < 256 {
        let mut c = n as u32;
        let mut k = 0;
        while k < 8 {
            c = if c & 1 != 0 {
                0xEDB8_8320 ^ (c >> 1)
            } else {
                c >> 1
            };
            k += 1;
        }
        table[n] = c;
        n += 1;
    }
    table
};

/// Continues a CRC-32 computation. Start with `0xFFFF_FFFF`; finish by inverting the result.
fn crc32_update(mut crc: u32, data: &[u8]) -> u32 {
    for &byte in data {
        crc = CRC_TABLE[((crc ^ byte as u32) & 0xFF) as usize] ^ (crc >> 8);
    }
    crc
}

/// CRC-32 of `data`, as used by PNG chunks.
pub fn crc32(data: &[u8]) -> u32 {
    !crc32_update(0xFFFF_FFFF, data)
}

/// Adler-32 checksum of `data`, as used by the zlib trailer.
pub fn adler32(data: &[u8]) -> u32 {
    const MOD: u32 = 65_521;
    // 5552 is the largest block for which the sums cannot overflow a u32 before the modulo.
    const BLOCK: usize = 5_552;
    let (mut a, mut b) = (1u32, 0u32);
    for block in data.chunks(BLOCK) {
        for &byte in block {
            a += byte as u32;
            b += a;
        }
        a %= MOD;
        b %= MOD;
    }
    (b << 16) | a
}

/// Wraps `raw` in a zlib stream made of stored deflate blocks.
pub fn zlib_stored(raw: &[u8]) -> Vec<u8> {
    let blocks = raw.len().div_ceil(MAX_STORED_BLOCK).max(1);
    let mut out = Vec::with_capacity(2 + raw.len() + blocks * 5 + 4);
    // CMF = 0x78 (deflate, 32 KiB window), FLG = 0x01 (no dictionary, fastest; makes the
    // header a multiple of 31).
    out.extend_from_slice(&[0x78, 0x01]);
    if raw.is_empty() {
        out.extend_from_slice(&[0x01, 0x00, 0x00, 0xFF, 0xFF]);
    }
    let mut chunks = raw.chunks(MAX_STORED_BLOCK).peekable();
    while let Some(chunk) = chunks.next() {
        let last = chunks.peek().is_none();
        let len = chunk.len() as u16;
        out.push(u8::from(last)); // BFINAL, BTYPE = 00 (stored)
        out.extend_from_slice(&len.to_le_bytes());
        out.extend_from_slice(&(!len).to_le_bytes());
        out.extend_from_slice(chunk);
    }
    out.extend_from_slice(&adler32(raw).to_be_bytes());
    out
}

/// Appends one PNG chunk: length, type, data, CRC over type and data.
fn push_chunk(out: &mut Vec<u8>, kind: &[u8; 4], data: &[u8]) {
    out.extend_from_slice(&(data.len() as u32).to_be_bytes());
    out.extend_from_slice(kind);
    out.extend_from_slice(data);
    let crc = !crc32_update(crc32_update(0xFFFF_FFFF, kind), data);
    out.extend_from_slice(&crc.to_be_bytes());
}

/// Encodes an 8-bit RGB image (`width * height * 3` bytes, row major from the top) as a PNG.
///
/// # Panics
///
/// Panics if `width` or `height` is zero or if `rgb8.len() != width * height * 3`. Callers
/// validate user supplied sizes first (the RSB reader rejects zero and oversized dimensions).
pub fn encode(width: u32, height: u32, rgb8: &[u8]) -> Vec<u8> {
    assert!(width > 0 && height > 0, "PNG dimensions must be non-zero");
    let row = width as usize * 3;
    assert_eq!(
        rgb8.len(),
        row * height as usize,
        "pixel buffer does not match the dimensions"
    );

    // Each scanline is prefixed with its filter type; 0 = None.
    let mut raw = Vec::with_capacity((row + 1) * height as usize);
    for scanline in rgb8.chunks_exact(row) {
        raw.push(0);
        raw.extend_from_slice(scanline);
    }

    let mut ihdr = Vec::with_capacity(13);
    ihdr.extend_from_slice(&width.to_be_bytes());
    ihdr.extend_from_slice(&height.to_be_bytes());
    // Bit depth 8, colour type 2 (truecolour), deflate, adaptive filtering, no interlace.
    ihdr.extend_from_slice(&[8, 2, 0, 0, 0]);

    let idat = zlib_stored(&raw);
    let mut out = Vec::with_capacity(8 + 25 + idat.len() + 12 + 12);
    out.extend_from_slice(&SIGNATURE);
    push_chunk(&mut out, b"IHDR", &ihdr);
    push_chunk(&mut out, b"IDAT", &idat);
    push_chunk(&mut out, b"IEND", &[]);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// One decoded chunk.
    struct Chunk {
        kind: [u8; 4],
        data: Vec<u8>,
    }

    /// Splits a PNG into chunks, validating the signature, lengths and CRCs.
    fn parse_chunks(png: &[u8]) -> Vec<Chunk> {
        assert_eq!(&png[..8], &SIGNATURE);
        let mut pos = 8;
        let mut chunks = Vec::new();
        while pos < png.len() {
            let len = u32::from_be_bytes(png[pos..pos + 4].try_into().unwrap()) as usize;
            let kind: [u8; 4] = png[pos + 4..pos + 8].try_into().unwrap();
            let data = png[pos + 8..pos + 8 + len].to_vec();
            let stored = u32::from_be_bytes(png[pos + 8 + len..pos + 12 + len].try_into().unwrap());
            let mut crc_input = kind.to_vec();
            crc_input.extend_from_slice(&data);
            assert_eq!(stored, crc32(&crc_input), "bad CRC in {:?}", kind);
            chunks.push(Chunk { kind, data });
            pos += 12 + len;
        }
        assert_eq!(pos, png.len(), "trailing bytes after the last chunk");
        chunks
    }

    /// Inflates a zlib stream made of stored blocks and checks its framing and Adler-32.
    fn inflate_stored(z: &[u8]) -> Vec<u8> {
        assert_eq!(z[0], 0x78);
        assert_eq!(
            ((z[0] as u32) << 8 | z[1] as u32) % 31,
            0,
            "zlib header check bits"
        );
        let mut pos = 2;
        let mut raw = Vec::new();
        loop {
            let header = z[pos];
            assert_eq!(header & 0b110, 0, "only stored blocks expected");
            let len = u16::from_le_bytes([z[pos + 1], z[pos + 2]]);
            let nlen = u16::from_le_bytes([z[pos + 3], z[pos + 4]]);
            assert_eq!(len, !nlen, "LEN/NLEN mismatch");
            raw.extend_from_slice(&z[pos + 5..pos + 5 + len as usize]);
            pos += 5 + len as usize;
            if header & 1 == 1 {
                break;
            }
        }
        let adler = u32::from_be_bytes(z[pos..pos + 4].try_into().unwrap());
        assert_eq!(pos + 4, z.len());
        assert_eq!(adler, adler32(&raw), "Adler-32 trailer");
        raw
    }

    #[test]
    fn checksum_known_vectors() {
        assert_eq!(crc32(b"123456789"), 0xCBF4_3926);
        assert_eq!(crc32(b""), 0);
        assert_eq!(adler32(b"Wikipedia"), 0x11E6_0398);
        assert_eq!(adler32(b""), 1);
        // A run long enough to exercise the deferred modulo.
        let long = vec![0xFFu8; 100_000];
        let (mut a, mut b) = (1u64, 0u64);
        for &x in &long {
            a = (a + x as u64) % 65_521;
            b = (b + a) % 65_521;
        }
        assert_eq!(adler32(&long), ((b << 16) | a) as u32);
    }

    #[test]
    fn one_by_one_white_has_a_fixed_length() {
        let png = encode(1, 1, &[255, 255, 255]);
        // signature 8 + IHDR 25 + IDAT (12 + zlib 2 + block 5 + scanline 4 + adler 4) + IEND 12.
        assert_eq!(png.len(), 72);
        let chunks = parse_chunks(&png);
        let names: Vec<&[u8; 4]> = chunks.iter().map(|c| &c.kind).collect();
        assert_eq!(names, [b"IHDR", b"IDAT", b"IEND"]);
        assert_eq!(chunks[0].data, [0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]);
        assert!(chunks[2].data.is_empty());
        assert_eq!(inflate_stored(&chunks[1].data), [0, 255, 255, 255]);
    }

    #[test]
    fn scanlines_round_trip_through_the_chunks() {
        let (w, h) = (5u32, 4u32);
        let pixels: Vec<u8> = (0..w * h * 3).map(|i| (i * 7 % 256) as u8).collect();
        let png = encode(w, h, &pixels);
        let chunks = parse_chunks(&png);
        let ihdr = &chunks[0].data;
        assert_eq!(u32::from_be_bytes(ihdr[0..4].try_into().unwrap()), w);
        assert_eq!(u32::from_be_bytes(ihdr[4..8].try_into().unwrap()), h);
        let raw = inflate_stored(&chunks[1].data);
        assert_eq!(raw.len(), (w as usize * 3 + 1) * h as usize);
        for (y, line) in raw.chunks(w as usize * 3 + 1).enumerate() {
            assert_eq!(line[0], 0, "filter type");
            assert_eq!(
                &line[1..],
                &pixels[y * w as usize * 3..(y + 1) * w as usize * 3]
            );
        }
    }

    #[test]
    fn large_images_are_split_into_blocks_of_at_most_65535_bytes() {
        let (w, h) = (200u32, 200u32); // 200 * 601 = 120_200 raw bytes -> two blocks
        let pixels = vec![9u8; (w * h * 3) as usize];
        let png = encode(w, h, &pixels);
        let chunks = parse_chunks(&png);
        let z = &chunks[1].data;
        // First block header: not final, length 65535.
        assert_eq!(z[2], 0);
        assert_eq!(u16::from_le_bytes([z[3], z[4]]), 65_535);
        assert_eq!(inflate_stored(z).len(), 120_200);
    }

    #[test]
    fn empty_stream_is_a_valid_zlib_stream() {
        let z = zlib_stored(&[]);
        assert!(inflate_stored(&z).is_empty());
    }

    #[test]
    #[should_panic(expected = "does not match")]
    fn mismatched_buffer_panics_loudly() {
        let _ = encode(2, 2, &[0; 5]);
    }
}
