//! DEFLATE and zlib decompression (P. Deutsch, RFC 1951 "DEFLATE Compressed Data Format
//! Specification version 1.3", and P. Deutsch and J-L. Gailly, RFC 1950 "ZLIB Compressed Data
//! Format Specification version 3.3", 1996), written from the specification for the readers of
//! image files (OpenEXR's ZIP compression).
//!
//! Stored, fixed-Huffman and dynamic-Huffman blocks are decoded. Huffman codes are canonical
//! (RFC 1951 §3.2.2): every code of up to [`FAST_BITS`] bits is resolved by one lookup in a table
//! indexed by the next bits of the stream (which arrive least significant bit first, so the
//! table is indexed by the bit-reversed code); longer codes, and the end of the input, fall back
//! to walking the code lengths one bit at a time. The output never grows beyond the caller's
//! `limit`, so a hostile stream cannot ask for more memory than the caller expected.

use crate::png::adler32;
use std::fmt;

/// Why a stream could not be decompressed.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum InflateError {
    /// The input ended in the middle of a block.
    Truncated,
    /// The zlib header is not a deflate stream without a preset dictionary.
    BadHeader,
    /// A stored block's length does not match its complement.
    BadStoredLength,
    /// A block type of 3, a code that is not in the table, or a code length set that does not
    /// describe a prefix code.
    BadCode,
    /// A back reference reaches before the start of the output.
    BadDistance,
    /// The output would be larger than the limit.
    TooLarge,
    /// The Adler-32 checksum after the data does not match.
    BadChecksum,
}

impl fmt::Display for InflateError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let text = match self {
            InflateError::Truncated => "compressed data is truncated",
            InflateError::BadHeader => "not a zlib stream",
            InflateError::BadStoredLength => "stored block length is corrupt",
            InflateError::BadCode => "invalid Huffman code",
            InflateError::BadDistance => "back reference before the start of the data",
            InflateError::TooLarge => "decompressed data is larger than expected",
            InflateError::BadChecksum => "zlib checksum mismatch",
        };
        f.write_str(text)
    }
}

impl std::error::Error for InflateError {}

/// Codes of up to this many bits are decoded by a single table lookup.
pub const FAST_BITS: u32 = 10;
const MAX_BITS: usize = 15;

/// Base lengths of the length codes 257..=285, and their extra bits.
const LENGTH_BASE: [u16; 29] = [
    3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131,
    163, 195, 227, 258,
];
const LENGTH_EXTRA: [u8; 29] = [
    0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0,
];
/// Base distances of the distance codes 0..=29, and their extra bits.
const DIST_BASE: [u16; 30] = [
    1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537,
    2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577,
];
const DIST_EXTRA: [u8; 30] = [
    0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13,
    13,
];
/// Order in which the code length code lengths are stored (RFC 1951 §3.2.7).
const CLEN_ORDER: [usize; 19] = [
    16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15,
];

/// Least-significant-bit-first reader.
struct Bits<'a> {
    data: &'a [u8],
    pos: usize,
    buf: u64,
    count: u32,
}

impl<'a> Bits<'a> {
    fn new(data: &'a [u8]) -> Bits<'a> {
        Bits {
            data,
            pos: 0,
            buf: 0,
            count: 0,
        }
    }

    #[inline]
    fn refill(&mut self) {
        while self.count <= 56 && self.pos < self.data.len() {
            self.buf |= u64::from(self.data[self.pos]) << self.count;
            self.pos += 1;
            self.count += 8;
        }
    }

    /// `n` (at most 32) bits, the first one in the lowest position.
    #[inline]
    fn take(&mut self, n: u32) -> Result<u32, InflateError> {
        if n == 0 {
            return Ok(0);
        }
        if self.count < n {
            self.refill();
            if self.count < n {
                return Err(InflateError::Truncated);
            }
        }
        let v = (self.buf & ((1u64 << n) - 1)) as u32;
        self.buf >>= n;
        self.count -= n;
        Ok(v)
    }

    /// Drops the bits up to the next byte boundary.
    fn align(&mut self) {
        let drop = self.count % 8;
        self.buf >>= drop;
        self.count -= drop;
    }

    /// Bytes consumed so far, counting buffered whole bytes as unread.
    fn byte_position(&self) -> usize {
        self.pos - (self.count / 8) as usize
    }
}

/// A canonical prefix code.
struct Huffman {
    /// Number of codes of each length (index 0 unused).
    counts: [u16; MAX_BITS + 1],
    /// Symbols in order of (length, symbol).
    symbols: Vec<u16>,
    /// Fast table: `symbol << 4 | length`, 0 when the code is longer than [`FAST_BITS`].
    fast: Vec<u16>,
}

impl Huffman {
    /// Builds the code of `lengths` (0: the symbol is unused). Incomplete codes are allowed (a
    /// distance code with a single symbol is legal); over-subscribed ones are not.
    fn new(lengths: &[u8]) -> Result<Huffman, InflateError> {
        let mut counts = [0u16; MAX_BITS + 1];
        for &l in lengths {
            counts[l as usize] += 1;
        }
        counts[0] = 0;
        let mut left: i32 = 1;
        for &c in &counts[1..] {
            left = left * 2 - i32::from(c);
            if left < 0 {
                return Err(InflateError::BadCode);
            }
        }
        let mut offsets = [0u16; MAX_BITS + 2];
        for len in 1..=MAX_BITS {
            offsets[len + 1] = offsets[len] + counts[len];
        }
        let mut symbols = vec![0u16; usize::from(offsets[MAX_BITS + 1])];
        for (symbol, &l) in lengths.iter().enumerate() {
            if l != 0 {
                symbols[usize::from(offsets[l as usize])] = symbol as u16;
                offsets[l as usize] += 1;
            }
        }
        // Canonical codes, then the fast table by bit-reversed prefix.
        let mut fast = vec![0u16; 1 << FAST_BITS];
        let mut code = 0u32;
        let mut index = 0usize;
        for len in 1..=MAX_BITS as u32 {
            for _ in 0..counts[len as usize] {
                if len <= FAST_BITS {
                    let reversed = code.reverse_bits() >> (32 - len);
                    let entry = (symbols[index] << 4) | len as u16;
                    let mut slot = reversed as usize;
                    while slot < fast.len() {
                        fast[slot] = entry;
                        slot += 1 << len;
                    }
                }
                code += 1;
                index += 1;
            }
            code <<= 1;
        }
        Ok(Huffman {
            counts,
            symbols,
            fast,
        })
    }

    /// Decodes one symbol.
    #[inline]
    fn decode(&self, bits: &mut Bits) -> Result<u16, InflateError> {
        if bits.count < FAST_BITS {
            bits.refill();
        }
        if bits.count >= FAST_BITS {
            let entry = self.fast[(bits.buf & ((1 << FAST_BITS) - 1)) as usize];
            if entry != 0 {
                let len = u32::from(entry & 15);
                bits.buf >>= len;
                bits.count -= len;
                return Ok(entry >> 4);
            }
        }
        self.decode_slow(bits)
    }

    /// Bit-by-bit decoding over the counts (codes longer than the fast table, end of input).
    fn decode_slow(&self, bits: &mut Bits) -> Result<u16, InflateError> {
        let mut code: i32 = 0;
        let mut first: i32 = 0;
        let mut index: i32 = 0;
        for len in 1..=MAX_BITS {
            code |= bits.take(1)? as i32;
            let count = i32::from(self.counts[len]);
            if code - count < first {
                return Ok(self.symbols[(index + (code - first)) as usize]);
            }
            index += count;
            first += count;
            first <<= 1;
            code <<= 1;
        }
        Err(InflateError::BadCode)
    }
}

/// The fixed codes of block type 1.
fn fixed_codes() -> Result<(Huffman, Huffman), InflateError> {
    let mut lengths = [0u8; 288];
    for (i, l) in lengths.iter_mut().enumerate() {
        *l = match i {
            0..=143 => 8,
            144..=255 => 9,
            256..=279 => 7,
            _ => 8,
        };
    }
    Ok((Huffman::new(&lengths)?, Huffman::new(&[5u8; 30])?))
}

/// The codes of a dynamic block (type 2).
fn dynamic_codes(bits: &mut Bits) -> Result<(Huffman, Huffman), InflateError> {
    let hlit = bits.take(5)? as usize + 257;
    let hdist = bits.take(5)? as usize + 1;
    let hclen = bits.take(4)? as usize + 4;
    if hlit > 286 || hdist > 30 {
        return Err(InflateError::BadCode);
    }
    let mut clen = [0u8; 19];
    for &slot in CLEN_ORDER.iter().take(hclen) {
        clen[slot] = bits.take(3)? as u8;
    }
    let clen_code = Huffman::new(&clen)?;
    let mut lengths = [0u8; 286 + 30];
    let mut i = 0;
    while i < hlit + hdist {
        let symbol = clen_code.decode(bits)?;
        let (value, repeat) = match symbol {
            0..=15 => (symbol as u8, 1),
            16 => {
                if i == 0 {
                    return Err(InflateError::BadCode);
                }
                (lengths[i - 1], 3 + bits.take(2)? as usize)
            }
            17 => (0, 3 + bits.take(3)? as usize),
            18 => (0, 11 + bits.take(7)? as usize),
            _ => return Err(InflateError::BadCode),
        };
        if i + repeat > hlit + hdist {
            return Err(InflateError::BadCode);
        }
        lengths[i..i + repeat].fill(value);
        i += repeat;
    }
    if lengths[256] == 0 {
        return Err(InflateError::BadCode); // no end-of-block code
    }
    Ok((
        Huffman::new(&lengths[..hlit])?,
        Huffman::new(&lengths[hlit..hlit + hdist])?,
    ))
}

/// Decompresses a raw DEFLATE stream (no zlib header). Returns the data and the number of
/// input bytes the stream used.
pub fn inflate_raw(data: &[u8], limit: usize) -> Result<(Vec<u8>, usize), InflateError> {
    let mut bits = Bits::new(data);
    let mut out: Vec<u8> = Vec::new();
    loop {
        let last = bits.take(1)? == 1;
        match bits.take(2)? {
            0 => {
                bits.align();
                let len = bits.take(16)? as usize;
                let nlen = bits.take(16)? as usize;
                if len != !nlen & 0xffff {
                    return Err(InflateError::BadStoredLength);
                }
                if out.len() + len > limit {
                    return Err(InflateError::TooLarge);
                }
                // The bit buffer holds whole bytes now: take them from it first.
                for _ in 0..len {
                    out.push(bits.take(8)? as u8);
                }
            }
            kind @ (1 | 2) => {
                let (lit, dist) = if kind == 1 {
                    fixed_codes()?
                } else {
                    dynamic_codes(&mut bits)?
                };
                loop {
                    let symbol = lit.decode(&mut bits)?;
                    if symbol < 256 {
                        if out.len() >= limit {
                            return Err(InflateError::TooLarge);
                        }
                        out.push(symbol as u8);
                    } else if symbol == 256 {
                        break;
                    } else {
                        let s = usize::from(symbol - 257);
                        if s >= LENGTH_BASE.len() {
                            return Err(InflateError::BadCode);
                        }
                        let len = usize::from(LENGTH_BASE[s])
                            + bits.take(u32::from(LENGTH_EXTRA[s]))? as usize;
                        let d = usize::from(dist.decode(&mut bits)?);
                        if d >= DIST_BASE.len() {
                            return Err(InflateError::BadCode);
                        }
                        let distance = usize::from(DIST_BASE[d])
                            + bits.take(u32::from(DIST_EXTRA[d]))? as usize;
                        if distance > out.len() {
                            return Err(InflateError::BadDistance);
                        }
                        if out.len() + len > limit {
                            return Err(InflateError::TooLarge);
                        }
                        let start = out.len() - distance;
                        if distance >= len {
                            out.extend_from_within(start..start + len);
                        } else {
                            // Overlapping copy: byte by byte, the run repeats itself.
                            for k in 0..len {
                                let b = out[start + k];
                                out.push(b);
                            }
                        }
                    }
                }
            }
            _ => return Err(InflateError::BadCode),
        }
        if last {
            break;
        }
    }
    Ok((out, bits.byte_position()))
}

/// Decompresses a zlib stream (RFC 1950): header, DEFLATE data, Adler-32 of the output.
/// Fails when the output would exceed `limit` bytes.
pub fn zlib_decompress(data: &[u8], limit: usize) -> Result<Vec<u8>, InflateError> {
    if data.len() < 2 {
        return Err(InflateError::Truncated);
    }
    let (cmf, flg) = (data[0], data[1]);
    if cmf & 0x0f != 8 || cmf >> 4 > 7 || (u16::from(cmf) << 8 | u16::from(flg)) % 31 != 0 {
        return Err(InflateError::BadHeader);
    }
    if flg & 0x20 != 0 {
        return Err(InflateError::BadHeader); // preset dictionary
    }
    let (out, used) = inflate_raw(&data[2..], limit)?;
    let tail = data
        .get(2 + used..2 + used + 4)
        .ok_or(InflateError::Truncated)?;
    let stored = u32::from_be_bytes([tail[0], tail[1], tail[2], tail[3]]);
    if stored != adler32(&out) {
        return Err(InflateError::BadChecksum);
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::png::zlib_stored;

    #[test]
    fn stored_streams_round_trip_through_the_png_writer() {
        for len in [0usize, 1, 100, 65_535, 65_536, 200_000] {
            let raw: Vec<u8> = (0..len).map(|i| (i * 7 + i / 300) as u8).collect();
            let z = zlib_stored(&raw);
            assert_eq!(zlib_decompress(&z, len).expect("inflate"), raw, "{len}");
            if len > 0 {
                assert_eq!(zlib_decompress(&z, len - 1), Err(InflateError::TooLarge));
            }
        }
    }

    #[test]
    fn fixed_and_dynamic_blocks_decode_reference_streams() {
        // A fixed-Huffman stream written by CPython's zlib (short input).
        assert_eq!(
            (HELLO_Z[2] >> 1) & 3,
            1,
            "the vector is a fixed-Huffman block"
        );
        let fixed = zlib_decompress(&HELLO_Z, 1000);
        assert_eq!(
            fixed.as_deref(),
            Ok(&b"hello hello hello hello, deflate!"[..])
        );
        // Dynamic blocks: a longer text with repeats, compressed by CPython's zlib at level 9.
        let text = dynamic_text();
        assert_eq!(
            (DYNAMIC_Z[2] >> 1) & 3,
            2,
            "the vector is a dynamic-Huffman block"
        );
        let out = zlib_decompress(&DYNAMIC_Z, 1 << 20).expect("dynamic");
        assert_eq!(out, text);
        assert_eq!(
            zlib_decompress(&DYNAMIC_Z, text.len() - 1),
            Err(InflateError::TooLarge)
        );
        // Several blocks, flushes in between (empty stored blocks), 256 distinct bytes.
        let mut multi = text[..3000].to_vec();
        for _ in 0..4 {
            multi.extend(0..=255u8);
        }
        multi.extend_from_slice(&text[3000..]);
        assert_eq!(zlib_decompress(&MULTI_Z, 1 << 20).expect("multi"), multi);
    }

    #[test]
    fn broken_streams_fail_without_panicking() {
        let good = DYNAMIC_Z.to_vec();
        assert_eq!(
            zlib_decompress(&good[..1], 1 << 20),
            Err(InflateError::Truncated)
        );
        let mut bad_header = good.clone();
        bad_header[1] ^= 1;
        assert_eq!(
            zlib_decompress(&bad_header, 1 << 20),
            Err(InflateError::BadHeader)
        );
        let mut bad_sum = good.clone();
        let n = bad_sum.len();
        bad_sum[n - 1] ^= 0x55;
        assert_eq!(
            zlib_decompress(&bad_sum, 1 << 20),
            Err(InflateError::BadChecksum)
        );
        // Every truncation and every single-byte corruption either fails or decodes something;
        // none panics or overruns the limit.
        for cut in 0..good.len() {
            assert!(zlib_decompress(&good[..cut], 1 << 20).is_err(), "cut {cut}");
        }
        for i in 2..good.len() {
            for flip in [1u8, 0x80, 0xff] {
                let mut c = good.clone();
                c[i] ^= flip;
                if let Ok(out) = zlib_decompress(&c, 4096) {
                    assert!(out.len() <= 4096);
                }
            }
        }
        // Block type 3 is reserved.
        assert_eq!(
            inflate_raw(&[0b111], 10).map(|r| r.0),
            Err(InflateError::BadCode)
        );
        // A stored block whose length and complement disagree.
        assert_eq!(
            inflate_raw(&[1, 5, 0, 0, 0], 10).map(|r| r.0),
            Err(InflateError::BadStoredLength)
        );
    }

    /// The input of `DYNAMIC_Z`: lines of numbers and words. The vectors in
    /// `inflate_vectors.rs` were written by CPython's `zlib` (1.3) from the same text:
    /// `"".join("line %d: the quick brown fox %d jumps over %d lazy dogs\n" % (i, i*i % 97,
    /// (i*31) % 13) for i in range(150))`.
    fn dynamic_text() -> Vec<u8> {
        let mut s = String::new();
        for i in 0..150 {
            s.push_str(&format!(
                "line {i}: the quick brown fox {} jumps over {} lazy dogs\n",
                i * i % 97,
                (i * 31) % 13
            ));
        }
        s.into_bytes()
    }

    include!("inflate_vectors.rs");
}
