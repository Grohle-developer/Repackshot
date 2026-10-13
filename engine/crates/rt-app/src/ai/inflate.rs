//! Inflate: the decoder of DEFLATE (RFC 1951) and of its zlib wrapper (RFC 1950), written from the
//! RFCs. The runtime archives (zip, method 8) and PNG images (zlib) need it.
//!
//! The whole compressed input is in memory and the output grows in a `Vec`, which is also the
//! 32 KiB window the back-references read from. Huffman codes are decoded with a lookup table of
//! [`FAST_BITS`] bits and, for longer codes, canonically one bit at a time (RFC 1951 §3.2.2).
//! Every limit is checked: the output never grows past the caller's `limit`, a back-reference
//! never reaches before the start, over-subscribed code lengths and codes that are not assigned
//! are errors, and a stream that ends early says so.

use std::fmt;

/// Bits looked up at once when decoding a Huffman code.
const FAST_BITS: u32 = 10;
/// Longest Huffman code of DEFLATE.
const MAX_BITS: usize = 15;

/// Base lengths of the length symbols 257..285 (RFC 1951 §3.2.5).
const LEN_BASE: [u16; 29] = [
    3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131,
    163, 195, 227, 258,
];
/// Extra bits of the length symbols.
const LEN_EXTRA: [u8; 29] = [
    0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0,
];
/// Base distances of the distance symbols 0..29.
const DIST_BASE: [u16; 30] = [
    1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537,
    2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577,
];
/// Extra bits of the distance symbols.
const DIST_EXTRA: [u8; 30] = [
    0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13,
    13,
];
/// The order in which the code length code lengths come (RFC 1951 §3.2.7).
const CL_ORDER: [usize; 19] = [
    16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15,
];

/// Why a stream cannot be inflated.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum InflateError {
    /// The input ended before the last block did.
    Truncated,
    /// Block type 3, which RFC 1951 reserves.
    BadBlockType,
    /// A stored block whose `NLEN` is not the complement of `LEN`.
    StoredLength,
    /// Code lengths that do not make a prefix code (over-subscribed, or no end-of-block code).
    BadCodeLengths,
    /// A code that is not assigned, or symbol 286, 287, 30 or 31.
    BadSymbol,
    /// A back-reference before the start of the output.
    BadDistance,
    /// The output would grow past the caller's limit.
    TooLarge,
    /// A zlib header that is not deflate, or that asks for a preset dictionary.
    BadHeader,
    /// The zlib Adler-32 trailer does not match the data.
    Checksum,
}

impl fmt::Display for InflateError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            InflateError::Truncated => "the compressed data ends early",
            InflateError::BadBlockType => "a deflate block of the reserved type 3",
            InflateError::StoredLength => "a stored block whose length check fails",
            InflateError::BadCodeLengths => "Huffman code lengths that are not a prefix code",
            InflateError::BadSymbol => "a Huffman code that is not assigned",
            InflateError::BadDistance => "a back-reference before the start of the data",
            InflateError::TooLarge => "the data inflates past its limit",
            InflateError::BadHeader => "not a zlib deflate stream without a dictionary",
            InflateError::Checksum => "the Adler-32 checksum does not match",
        })
    }
}

impl std::error::Error for InflateError {}

/// Reads bits least significant first, as DEFLATE packs them.
struct Bits<'a> {
    data: &'a [u8],
    /// Next byte to load into `buf`.
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

    fn refill(&mut self) {
        while self.count <= 56 && self.pos < self.data.len() {
            self.buf |= u64::from(self.data[self.pos]) << self.count;
            self.pos += 1;
            self.count += 8;
        }
    }

    /// `n` (at most 32) bits as a number.
    fn bits(&mut self, n: u32) -> Result<u32, InflateError> {
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

    /// Drops the bits up to the next byte boundary and gives the whole bytes still buffered back
    /// to the input, so a stored block can be copied straight from it.
    fn align(&mut self) {
        let drop = self.count % 8;
        self.buf >>= drop;
        self.count -= drop;
        self.pos -= (self.count / 8) as usize;
        self.buf = 0;
        self.count = 0;
    }

    /// Bytes of the input used so far (after [`Bits::align`], exactly).
    fn consumed(&self) -> usize {
        self.pos - (self.count / 8) as usize
    }
}

/// A canonical Huffman code (RFC 1951 §3.2.2).
struct Huffman {
    /// `(length << 9) | symbol` for codes of at most [`FAST_BITS`] bits, indexed by the next
    /// bits of the stream; 0 where a longer code (or none) starts.
    fast: Vec<u16>,
    /// Codes of each length.
    counts: [u16; MAX_BITS + 1],
    /// Symbols ordered by code length, then by value.
    symbols: Vec<u16>,
}

impl Huffman {
    /// Builds the code from one length per symbol (0: the symbol is not used). Incomplete codes
    /// are accepted (a single distance code is one); a code that is not assigned fails when it
    /// is met.
    fn new(lengths: &[u8]) -> Result<Huffman, InflateError> {
        let mut counts = [0u16; MAX_BITS + 1];
        for &l in lengths {
            if usize::from(l) > MAX_BITS {
                return Err(InflateError::BadCodeLengths);
            }
            counts[usize::from(l)] += 1;
        }
        counts[0] = 0;
        let mut left: i32 = 1;
        for &count in &counts[1..] {
            left = (left << 1) - i32::from(count);
            if left < 0 {
                return Err(InflateError::BadCodeLengths);
            }
        }
        let mut offsets = [0u16; MAX_BITS + 2];
        for len in 1..=MAX_BITS {
            offsets[len + 1] = offsets[len] + counts[len];
        }
        let mut symbols = vec![0u16; usize::from(offsets[MAX_BITS + 1])];
        let mut next = offsets;
        for (sym, &l) in lengths.iter().enumerate() {
            if l > 0 {
                symbols[usize::from(next[usize::from(l)])] = sym as u16;
                next[usize::from(l)] += 1;
            }
        }
        // The first code of each length, then each symbol's code, reversed for the bit order.
        let mut fast = vec![0u16; 1 << FAST_BITS];
        let mut code = 0u32;
        let mut first = [0u32; MAX_BITS + 1];
        for len in 1..=MAX_BITS {
            code = (code + u32::from(counts[len - 1])) << 1;
            first[len] = code;
        }
        let mut next_code = first;
        for (sym, &l) in lengths.iter().enumerate() {
            let len = u32::from(l);
            if len == 0 {
                continue;
            }
            let c = next_code[l as usize];
            next_code[l as usize] += 1;
            if len <= FAST_BITS {
                let rev = c.reverse_bits() >> (32 - len);
                let entry = ((len as u16) << 9) | sym as u16;
                let mut i = rev;
                while i < (1 << FAST_BITS) {
                    fast[i as usize] = entry;
                    i += 1 << len;
                }
            }
        }
        Ok(Huffman {
            fast,
            counts,
            symbols,
        })
    }

    fn decode(&self, bits: &mut Bits<'_>) -> Result<u16, InflateError> {
        if bits.count < MAX_BITS as u32 {
            bits.refill();
        }
        let entry = self.fast[(bits.buf & ((1 << FAST_BITS) - 1)) as usize];
        if entry != 0 {
            let len = u32::from(entry >> 9);
            if len > bits.count {
                return Err(InflateError::Truncated);
            }
            bits.buf >>= len;
            bits.count -= len;
            return Ok(entry & 0x1ff);
        }
        // A longer code: canonical decoding, one bit at a time.
        let (mut code, mut first, mut index) = (0i32, 0i32, 0i32);
        for len in 1..=MAX_BITS {
            code |= bits.bits(1)? as i32;
            let count = i32::from(self.counts[len]);
            if code - count < first {
                return Ok(self.symbols[(index + code - first) as usize]);
            }
            index += count;
            first = (first + count) << 1;
            code <<= 1;
        }
        Err(InflateError::BadSymbol)
    }
}

fn fixed_tables() -> (Huffman, Huffman) {
    let mut lit = [0u8; 288];
    for (i, l) in lit.iter_mut().enumerate() {
        *l = match i {
            0..=143 => 8,
            144..=255 => 9,
            256..=279 => 7,
            _ => 8,
        };
    }
    // The lengths of RFC 1951 §3.2.6: a complete code of 288 and one of 32 symbols (286, 287, 30
    // and 31 decode, and are then refused).
    let lit = Huffman::new(&lit).expect("the fixed literal/length code");
    let dist = Huffman::new(&[5u8; 32]).expect("the fixed distance code");
    (lit, dist)
}

fn dynamic_tables(bits: &mut Bits<'_>) -> Result<(Huffman, Huffman), InflateError> {
    let hlit = bits.bits(5)? as usize + 257;
    let hdist = bits.bits(5)? as usize + 1;
    let hclen = bits.bits(4)? as usize + 4;
    if hlit > 286 || hdist > 30 {
        return Err(InflateError::BadCodeLengths);
    }
    let mut cl = [0u8; 19];
    for &i in &CL_ORDER[..hclen] {
        cl[i] = bits.bits(3)? as u8;
    }
    let cl = Huffman::new(&cl)?;
    let mut lengths = vec![0u8; hlit + hdist];
    let mut i = 0;
    while i < lengths.len() {
        let sym = cl.decode(bits)?;
        let (value, repeat) = match sym {
            0..=15 => (sym as u8, 1),
            16 => {
                let prev = *lengths[..i].last().ok_or(InflateError::BadCodeLengths)?;
                (prev, 3 + bits.bits(2)? as usize)
            }
            17 => (0, 3 + bits.bits(3)? as usize),
            18 => (0, 11 + bits.bits(7)? as usize),
            _ => return Err(InflateError::BadSymbol),
        };
        if i + repeat > lengths.len() {
            return Err(InflateError::BadCodeLengths);
        }
        lengths[i..i + repeat].fill(value);
        i += repeat;
    }
    if lengths[256] == 0 {
        return Err(InflateError::BadCodeLengths);
    }
    Ok((
        Huffman::new(&lengths[..hlit])?,
        Huffman::new(&lengths[hlit..])?,
    ))
}

fn codes(
    bits: &mut Bits<'_>,
    out: &mut Vec<u8>,
    limit: usize,
    lit: &Huffman,
    dist: &Huffman,
) -> Result<(), InflateError> {
    loop {
        let sym = lit.decode(bits)?;
        match sym {
            0..=255 => {
                if out.len() >= limit {
                    return Err(InflateError::TooLarge);
                }
                out.push(sym as u8);
            }
            256 => return Ok(()),
            257..=285 => {
                let i = usize::from(sym - 257);
                let len = usize::from(LEN_BASE[i]) + bits.bits(u32::from(LEN_EXTRA[i]))? as usize;
                let d = usize::from(dist.decode(bits)?);
                if d >= 30 {
                    return Err(InflateError::BadSymbol);
                }
                let distance =
                    usize::from(DIST_BASE[d]) + bits.bits(u32::from(DIST_EXTRA[d]))? as usize;
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
                    // Overlapping: each byte may be one this copy just wrote.
                    for k in 0..len {
                        let b = out[start + k];
                        out.push(b);
                    }
                }
            }
            _ => return Err(InflateError::BadSymbol),
        }
    }
}

/// Inflates a raw DEFLATE stream onto `out` (at most `limit` bytes in `out` in all). Returns the
/// bytes of `input` the stream used: what follows the last block is the caller's.
pub fn inflate_into(input: &[u8], out: &mut Vec<u8>, limit: usize) -> Result<usize, InflateError> {
    let mut bits = Bits::new(input);
    let mut fixed: Option<(Huffman, Huffman)> = None;
    loop {
        let last = bits.bits(1)? == 1;
        match bits.bits(2)? {
            0 => {
                bits.align();
                let at = bits.pos;
                let head = input.get(at..at + 4).ok_or(InflateError::Truncated)?;
                let len = usize::from(u16::from_le_bytes([head[0], head[1]]));
                let nlen = u16::from_le_bytes([head[2], head[3]]);
                if nlen != !(len as u16) {
                    return Err(InflateError::StoredLength);
                }
                let data = input
                    .get(at + 4..at + 4 + len)
                    .ok_or(InflateError::Truncated)?;
                if out.len() + len > limit {
                    return Err(InflateError::TooLarge);
                }
                out.extend_from_slice(data);
                bits.pos = at + 4 + len;
            }
            1 => {
                let (lit, dist) = fixed.get_or_insert_with(fixed_tables);
                codes(&mut bits, out, limit, lit, dist)?;
            }
            2 => {
                let (lit, dist) = dynamic_tables(&mut bits)?;
                codes(&mut bits, out, limit, &lit, &dist)?;
            }
            _ => return Err(InflateError::BadBlockType),
        }
        if last {
            bits.align();
            return Ok(bits.consumed());
        }
    }
}

/// Inflates a raw DEFLATE stream into a new buffer of at most `limit` bytes.
pub fn inflate(input: &[u8], limit: usize) -> Result<Vec<u8>, InflateError> {
    let mut out = Vec::new();
    inflate_into(input, &mut out, limit)?;
    Ok(out)
}

/// Inflates a zlib stream (RFC 1950: header, DEFLATE, Adler-32) into at most `limit` bytes.
pub fn zlib_decompress(input: &[u8], limit: usize) -> Result<Vec<u8>, InflateError> {
    let (&cmf, &flg) = match input {
        [a, b, ..] => (a, b),
        _ => return Err(InflateError::Truncated),
    };
    if cmf & 0x0f != 8 || cmf >> 4 > 7 || (u16::from(cmf) << 8 | u16::from(flg)) % 31 != 0 {
        return Err(InflateError::BadHeader);
    }
    if flg & 0x20 != 0 {
        return Err(InflateError::BadHeader);
    }
    let mut out = Vec::new();
    let used = inflate_into(&input[2..], &mut out, limit)?;
    let trailer = input
        .get(2 + used..2 + used + 4)
        .ok_or(InflateError::Truncated)?;
    let expected = u32::from_be_bytes([trailer[0], trailer[1], trailer[2], trailer[3]]);
    if rt_core::png::adler32(&out) != expected {
        return Err(InflateError::Checksum);
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn unhex(s: &str) -> Vec<u8> {
        (0..s.len())
            .step_by(2)
            .map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap())
            .collect()
    }

    /// The text the zlib vectors below compress (made with the system zlib, level 9).
    fn text() -> Vec<u8> {
        let mut t = b"The quick brown fox jumps over the lazy dog. ".repeat(3);
        t.extend_from_slice(
            b"Repackshot inflates what zlib deflates: stored, fixed and dynamic blocks.",
        );
        t
    }

    const DYNAMIC: &str = "b58ceb0dc2300c0657f906401d8031501770628798a671495cfa989e4accc0dfbbd38d59f05e354e08cdb68a643b5eebbc74d8471afcd285ce036ccf01e3dfe2872c14a79ecda1351572e9d83239cea2012c3f7447776bc23724dd854195c147a5592342b16b307c01";

    /// Writes bits least significant first, and Huffman codes most significant first, as
    /// RFC 1951 §3.1.1 says, to build blocks by hand.
    #[derive(Default)]
    struct Writer {
        out: Vec<u8>,
        acc: u32,
        n: u32,
    }

    impl Writer {
        fn bits(&mut self, value: u32, n: u32) {
            for i in 0..n {
                self.acc |= ((value >> i) & 1) << self.n;
                self.n += 1;
                if self.n == 8 {
                    self.out.push(self.acc as u8);
                    self.acc = 0;
                    self.n = 0;
                }
            }
        }
        fn code(&mut self, code: u32, len: u32) {
            for i in (0..len).rev() {
                self.bits((code >> i) & 1, 1);
            }
        }
        /// A literal or length symbol with the fixed code of §3.2.6.
        fn fixed(&mut self, sym: u32) {
            match sym {
                0..=143 => self.code(0x30 + sym, 8),
                144..=255 => self.code(0x190 + sym - 144, 9),
                256..=279 => self.code(sym - 256, 7),
                _ => self.code(0xc0 + sym - 280, 8),
            }
        }
        fn finish(mut self) -> Vec<u8> {
            if self.n > 0 {
                self.out.push(self.acc as u8);
            }
            self.out
        }
    }

    #[test]
    fn a_stored_block_by_hand() {
        // BFINAL=1, BTYPE=00, then LEN, NLEN and the bytes (RFC 1951 §3.2.4).
        let mut s = vec![0x01, 5, 0, !5u8, 0xff];
        s.extend_from_slice(b"hello");
        assert_eq!(inflate(&s, 100).unwrap(), b"hello");
        // An empty stored block, and a wrong NLEN.
        assert_eq!(inflate(&[0x01, 0, 0, 0xff, 0xff], 10).unwrap(), b"");
        assert_eq!(
            inflate(&[0x01, 5, 0, 0, 0, 1, 2, 3, 4, 5], 100),
            Err(InflateError::StoredLength)
        );
        assert_eq!(
            inflate(&[0x01, 5, 0, !5u8, 0xff, 1, 2], 100),
            Err(InflateError::Truncated)
        );
        // rt-core's PNG writer makes zlib streams of stored blocks: they come back whole.
        let raw: Vec<u8> = (0..200_000u32).map(|i| (i * 7 + i / 300) as u8).collect();
        assert_eq!(
            zlib_decompress(&rt_core::png::zlib_stored(&raw), 1 << 20).unwrap(),
            raw
        );
        assert_eq!(
            zlib_decompress(&rt_core::png::zlib_stored(&[]), 1).unwrap(),
            b""
        );
    }

    #[test]
    fn a_fixed_huffman_block_by_hand() {
        // "ab", then <length 4, distance 2> and <length 3, distance 1>: "ab" + "abab" + "bbb".
        let mut w = Writer::default();
        w.bits(1, 1); // BFINAL
        w.bits(1, 2); // BTYPE = 01
        w.fixed(u32::from(b'a'));
        w.fixed(u32::from(b'b'));
        w.fixed(258); // length 4
        w.code(1, 5); // distance code 1: distance 2
        w.fixed(257); // length 3
        w.code(0, 5); // distance 1
        w.fixed(u32::from(b'\xe9')); // a 9-bit literal
        w.fixed(285); // length 258, no extra bits
        w.code(0, 5);
        w.fixed(256);
        let data = w.finish();
        let mut expect = b"ababab".to_vec();
        expect.extend_from_slice(b"bbb\xe9");
        expect.extend(std::iter::repeat_n(0xe9, 258));
        assert_eq!(inflate(&data, 1000).unwrap(), expect);
        // And what zlib makes with Z_FIXED.
        let z = inflate(&unhex("4b4c4a4e8421858cd49c9c7c080900"), 100).unwrap();
        assert_eq!(z, b"abcabcabcabc hello hello");
    }

    #[test]
    fn a_dynamic_huffman_block_from_zlib() {
        let data = unhex(DYNAMIC);
        assert_eq!((data[0] >> 1) & 3, 2, "the vector is a dynamic block");
        assert_eq!(inflate(&data, 1000).unwrap(), text());
        // The zlib wrapper around the same block, with its Adler-32.
        let mut z = unhex("78da");
        z.extend_from_slice(&data);
        z.extend_from_slice(&unhex("c2f04b78"));
        assert_eq!(zlib_decompress(&z, 1000).unwrap(), text());
        let mut bad = z.clone();
        *bad.last_mut().unwrap() ^= 1;
        assert_eq!(zlib_decompress(&bad, 1000), Err(InflateError::Checksum));
        assert_eq!(
            zlib_decompress(&z[..z.len() - 2], 1000),
            Err(InflateError::Truncated)
        );
        // Cut anywhere, it fails; never a panic.
        for cut in 0..data.len() {
            assert!(inflate(&data[..cut], 1000).is_err(), "cut at {cut}");
        }
    }

    #[test]
    fn several_blocks_and_what_follows_the_stream() {
        // A stored block, then a fixed one, then bytes that are not the stream's.
        let mut w = Writer::default();
        w.bits(0, 1);
        w.bits(0, 2);
        let mut s = w.finish();
        s.extend_from_slice(&[3, 0, !3u8, 0xff]);
        s.extend_from_slice(b"xyz");
        let mut w = Writer::default();
        w.bits(1, 1);
        w.bits(1, 2);
        w.fixed(258); // length 4 from distance 3: "xyzx"
        w.code(2, 5);
        w.fixed(256);
        s.extend_from_slice(&w.finish());
        let used = s.len();
        s.extend_from_slice(b"TRAILER");
        let mut out = Vec::new();
        assert_eq!(inflate_into(&s, &mut out, 100).unwrap(), used);
        assert_eq!(out, b"xyzxyzx");
    }

    #[test]
    fn bad_streams_fail_cleanly() {
        // Block type 3.
        assert_eq!(inflate(&[0x07], 10), Err(InflateError::BadBlockType));
        // A distance before the start.
        let mut w = Writer::default();
        w.bits(1, 1);
        w.bits(1, 2);
        w.fixed(u32::from(b'a'));
        w.fixed(257);
        w.code(1, 5); // distance 2, but one byte exists
        w.fixed(256);
        assert_eq!(inflate(&w.finish(), 10), Err(InflateError::BadDistance));
        // Distance symbols 30 and 31 and literal/length 286 do not exist.
        for (sym, dist) in [(257u32, 30u32), (286, 0)] {
            let mut w = Writer::default();
            w.bits(1, 1);
            w.bits(1, 2);
            w.fixed(u32::from(b'a'));
            w.fixed(sym);
            w.code(dist, 5);
            w.fixed(256);
            assert_eq!(inflate(&w.finish(), 10), Err(InflateError::BadSymbol));
        }
        // The limit is enforced for literals, copies and stored blocks.
        assert_eq!(inflate(&unhex(DYNAMIC), 50), Err(InflateError::TooLarge));
        assert_eq!(
            inflate(&[0x01, 5, 0, !5u8, 0xff, 1, 2, 3, 4, 5], 4),
            Err(InflateError::TooLarge)
        );
        // Over-subscribed code lengths: three codes of one bit.
        assert!(matches!(
            Huffman::new(&[1, 1, 1]),
            Err(InflateError::BadCodeLengths)
        ));
        // A dynamic header whose literal code has no end-of-block symbol: every one of the
        // 257 literal/length codes gets 0 except 'a' (no code 256).
        let mut w = Writer::default();
        w.bits(1, 1);
        w.bits(2, 2);
        w.bits(0, 5); // HLIT = 257
        w.bits(0, 5); // HDIST = 1
        w.bits(15, 4); // HCLEN = 19
                       // Code length codes: lengths 1 for symbols 0 and 18... any prefix code will do: give
                       // symbol 18 (zeros) and symbol 1 one bit each.
        for &i in &CL_ORDER {
            w.bits(u32::from(i == 18 || i == 1), 3);
        }
        // Symbol 1 has code 0, symbol 18 code 1. 97 zeros, a 1 for 'a', 138 + 21 zeros...
        w.code(1, 1);
        w.bits(97 - 11, 7);
        w.code(0, 1);
        w.code(1, 1);
        w.bits(138 - 11, 7);
        w.code(1, 1);
        w.bits(22 - 11, 7); // up to 258 lengths in all (257 + 1)
        assert_eq!(inflate(&w.finish(), 10), Err(InflateError::BadCodeLengths));
        // zlib headers: not deflate, a dictionary, a bad check value.
        assert_eq!(
            zlib_decompress(&[0x79, 0x9c, 3, 0], 10),
            Err(InflateError::BadHeader)
        );
        assert_eq!(
            zlib_decompress(&[0x78, 0xbb, 3, 0], 10),
            Err(InflateError::BadHeader)
        );
        assert_eq!(
            zlib_decompress(&[0x78, 0x9d, 3, 0], 10),
            Err(InflateError::BadHeader)
        );
        assert_eq!(zlib_decompress(&[0x78], 10), Err(InflateError::Truncated));
    }
}
