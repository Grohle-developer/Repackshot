//! The sample generator: Owen-scrambled Sobol points, one independently scrambled sequence per
//! pixel.
//!
//! # Sequence
//!
//! The Sobol sequence (I. M. Sobol', "On the distribution of points in a cube and the
//! approximate evaluation of integrals", *USSR Comput. Math. Math. Phys.* 7, 1967) in base 2,
//! with the primitive polynomials and initial direction numbers of S. Joe and F. Y. Kuo,
//! "Constructing Sobol sequences with better two-dimensional projections", *SIAM J. Sci.
//! Comput.* 30 (2008) 2635–2654, file `new-joe-kuo-6.21201` (search criterion D(6)). Only the
//! first 64 dimensions are included (the first is the van der Corput sequence, the other 63 are
//! the first 63 rows of the file); the generator matrices are expanded from them at compile time
//! with the recurrence of Bratley and Fox (ACM TOMS Algorithm 659, 1988). A point is the XOR of
//! the matrix columns selected by the bits of its index, so any sample index can be generated
//! directly, in any order.
//!
//! # Scrambling
//!
//! Every dimension of every pixel gets its own nested uniform (Owen) scramble (A. B. Owen,
//! "Randomly permuted (t,m,s)-nets and (t,s)-sequences", 1995), computed with the hash-based
//! construction of B. Burley, "Practical Hash-based Owen Scrambling", *JCGT* 9(4), 2020: reverse
//! the bits, apply a Laine–Karras style hash whose output bit `i` depends only on input bits
//! `<= i`, reverse back. Scrambling keeps the net properties (the first `2^k` points of each pixel
//! still stratify every elementary interval the Sobol points stratified) and decorrelates the
//! pixels. The scramble seeds come from (scene seed, pixel x, pixel y, dimension) only; the
//! sample index is the position in the sequence. Nothing depends on threads, tiles or order.
//!
//! Dimensions at or beyond [`SOBOL_DIMENSIONS`] (paths deeper than about ten bounces) fall back
//! to independent hashed random numbers, which is what quasi-Monte Carlo is worth that deep.
//!
//! # Licence of the direction numbers
//!
//! The direction numbers below are reproduced from the file `new-joe-kuo-6.21201` published at
//! <https://web.maths.unsw.edu.au/~fkuo/sobol/> under this licence:
//!
//! ```text
//! Copyright (c) 2008, Frances Y. Kuo and Stephen Joe
//! All rights reserved.
//!
//! Redistribution and use in source and binary forms, with or without
//! modification, are permitted provided that the following conditions are met:
//!
//!     * Redistributions of source code must retain the above copyright
//!       notice, this list of conditions and the following disclaimer.
//!
//!     * Redistributions in binary form must reproduce the above copyright
//!       notice, this list of conditions and the following disclaimer in the
//!       documentation and/or other materials provided with the distribution.
//!
//!     * Neither the names of the copyright holders nor the names of the
//!       University of New South Wales and the University of Waikato
//!       and its contributors may be used to endorse or promote products derived
//!       from this software without specific prior written permission.
//!
//! THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS ``AS IS'' AND ANY
//! EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
//! WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
//! DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDERS BE LIABLE FOR ANY
//! DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
//! (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
//! LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
//! ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
//! (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
//! SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
//! ```
//!
//! # Dimension layout
//!
//! The renderer asks for *logical* dimensions (see [`DIM_CAMERA`], [`DIM_LENS`] and
//! [`bounce_dim`]): two for the position in the pixel, two for the lens, then six per path vertex
//! (light selection, a point on the light, the BSDF direction, Russian roulette). [`LAYOUT`] maps
//! them to Sobol dimensions. Adjacent Sobol dimensions are not always good partners (some
//! adjacent pairs of the table are only (6, 10, 2)-nets at 1024 points), so the 2-D slots use the
//! pairs found by a greedy search over all pairs of the 64 dimensions, best first: smallest worst
//! t-value at 2^6, 2^8, 2^10 and 2^12 points. Every 2-D slot of the layout is a (t, m, 2)-net with
//! t <= 2 for m = 6, 8, 10 (a test checks it); the one-dimensional slots take the dimensions left
//! over (every single dimension is a (0, 1)-sequence). Logical dimensions from 64 on (vertices
//! after the tenth) are independent hashed random numbers.

use crate::rng::mix64;

/// Number of Sobol dimensions in the table (and of logical dimensions mapped onto them).
pub const SOBOL_DIMENSIONS: u32 = 64;

/// Sobol dimension of each logical dimension: `[camera x, camera y, lens u, lens v]`, then per
/// vertex `[light select, light u, light v, bsdf u, bsdf v, roulette]` for ten vertices. A
/// permutation of `0..64`; see the module documentation for how the pairs were chosen.
pub const LAYOUT: [u8; SOBOL_DIMENSIONS as usize] = [
    0, 1, 11, 50, // camera, lens
    19, 2, 15, 10, 13, 20, // vertex 0
    21, 5, 27, 3, 59, 25, // vertex 1
    26, 6, 57, 18, 47, 28, // vertex 2
    31, 24, 44, 22, 58, 34, // vertex 3
    37, 49, 52, 4, 9, 39, // vertex 4
    41, 7, 12, 16, 29, 42, // vertex 5
    45, 8, 38, 14, 46, 48, // vertex 6
    51, 33, 36, 32, 56, 53, // vertex 7
    54, 35, 63, 43, 62, 55, // vertex 8
    60, 23, 30, 17, 40, 61, // vertex 9
];

/// First of the two dimensions of the position inside the pixel.
pub const DIM_CAMERA: u32 = 0;
/// First of the two dimensions of the point on the lens.
pub const DIM_LENS: u32 = 2;
/// First dimension used by the path vertices.
pub const DIM_FIRST_BOUNCE: u32 = 4;
/// Dimensions consumed per path vertex.
pub const DIMS_PER_BOUNCE: u32 = 6;
/// Offset, inside a vertex's dimensions, of the light selection (1 dimension).
pub const OFFSET_LIGHT_SELECT: u32 = 0;
/// Offset of the point on the light (2 dimensions).
pub const OFFSET_LIGHT: u32 = 1;
/// Offset of the BSDF sample (2 dimensions; the lobe choice reuses the first one).
pub const OFFSET_BSDF: u32 = 3;
/// Offset of the Russian roulette decision (1 dimension).
pub const OFFSET_ROULETTE: u32 = 5;

/// First dimension of path vertex `bounce` (0 is the surface the camera ray hits).
#[inline]
pub const fn bounce_dim(bounce: u32) -> u32 {
    DIM_FIRST_BOUNCE + bounce * DIMS_PER_BOUNCE
}

/// First logical dimension of the cut-out decisions (E5): far beyond the Sobol table, so they
/// are independent hashed random numbers that never share a dimension with a path vertex.
pub const DIM_CUTOUT: u32 = 1 << 20;

/// The dimension deciding whether the ray of vertex `bounce` passes through the `crossing`-th
/// cut-out (opacity below one) it meets.
#[inline]
pub const fn cutout_dim(bounce: u32, crossing: u32) -> u32 {
    let c = if crossing < 63 { crossing } else { 63 };
    DIM_CUTOUT + bounce * 64 + c
}

/// The logical dimension of the chromatic band of a lens camera sample (O1, [`crate::optics`]):
/// beyond the Sobol table and the cut-outs, so a scene without a `LENS` section draws exactly the
/// numbers it drew before. It is used through [`PixelSampler::stratum`], not as a number.
pub const DIM_LENS_BAND: u32 = 3 << 20;

/// First logical dimension of the effect filters of a lens (O3a, [`crate::optics::filters`]):
/// four per filter of the stack (the choice, two for the angle, one for the lobe), beyond the
/// Sobol table, so a lens without filters draws exactly the numbers it drew before.
pub const DIM_LENS_FILTER: u32 = 4 << 20;

/// First logical dimension of the filters' connections to the lights (O3a): six per filter of
/// the stack (the light, four for the deflection and the lobe, one spare), beyond the Sobol table.
pub const DIM_LENS_FILTER_LIGHT: u32 = 5 << 20;

/// Degree `s`, coefficients `a` and initial direction numbers `m_1..m_s` of dimensions 2 to 64
/// (Joe and Kuo, `new-joe-kuo-6.21201`, rows `d = 2..=64`). Unused `m` entries are zero.
const JOE_KUO: [(u32, u32, [u32; 9]); 63] = [
    (1, 0, [1, 0, 0, 0, 0, 0, 0, 0, 0]),
    (2, 1, [1, 3, 0, 0, 0, 0, 0, 0, 0]),
    (3, 1, [1, 3, 1, 0, 0, 0, 0, 0, 0]),
    (3, 2, [1, 1, 1, 0, 0, 0, 0, 0, 0]),
    (4, 1, [1, 1, 3, 3, 0, 0, 0, 0, 0]),
    (4, 4, [1, 3, 5, 13, 0, 0, 0, 0, 0]),
    (5, 2, [1, 1, 5, 5, 17, 0, 0, 0, 0]),
    (5, 4, [1, 1, 5, 5, 5, 0, 0, 0, 0]),
    (5, 7, [1, 1, 7, 11, 19, 0, 0, 0, 0]),
    (5, 11, [1, 1, 5, 1, 1, 0, 0, 0, 0]),
    (5, 13, [1, 1, 1, 3, 11, 0, 0, 0, 0]),
    (5, 14, [1, 3, 5, 5, 31, 0, 0, 0, 0]),
    (6, 1, [1, 3, 3, 9, 7, 49, 0, 0, 0]),
    (6, 13, [1, 1, 1, 15, 21, 21, 0, 0, 0]),
    (6, 16, [1, 3, 1, 13, 27, 49, 0, 0, 0]),
    (6, 19, [1, 1, 1, 15, 7, 5, 0, 0, 0]),
    (6, 22, [1, 3, 1, 15, 13, 25, 0, 0, 0]),
    (6, 25, [1, 1, 5, 5, 19, 61, 0, 0, 0]),
    (7, 1, [1, 3, 7, 11, 23, 15, 103, 0, 0]),
    (7, 4, [1, 3, 7, 13, 13, 15, 69, 0, 0]),
    (7, 7, [1, 1, 3, 13, 7, 35, 63, 0, 0]),
    (7, 8, [1, 3, 5, 9, 1, 25, 53, 0, 0]),
    (7, 14, [1, 3, 1, 13, 9, 35, 107, 0, 0]),
    (7, 19, [1, 3, 1, 5, 27, 61, 31, 0, 0]),
    (7, 21, [1, 1, 5, 11, 19, 41, 61, 0, 0]),
    (7, 28, [1, 3, 5, 3, 3, 13, 69, 0, 0]),
    (7, 31, [1, 1, 7, 13, 1, 19, 1, 0, 0]),
    (7, 32, [1, 3, 7, 5, 13, 19, 59, 0, 0]),
    (7, 37, [1, 1, 3, 9, 25, 29, 41, 0, 0]),
    (7, 41, [1, 3, 5, 13, 23, 1, 55, 0, 0]),
    (7, 42, [1, 3, 7, 3, 13, 59, 17, 0, 0]),
    (7, 50, [1, 3, 1, 3, 5, 53, 69, 0, 0]),
    (7, 55, [1, 1, 5, 5, 23, 33, 13, 0, 0]),
    (7, 56, [1, 1, 7, 7, 1, 61, 123, 0, 0]),
    (7, 59, [1, 1, 7, 9, 13, 61, 49, 0, 0]),
    (7, 62, [1, 3, 3, 5, 3, 55, 33, 0, 0]),
    (8, 14, [1, 3, 1, 15, 31, 13, 49, 245, 0]),
    (8, 21, [1, 3, 5, 15, 31, 59, 63, 97, 0]),
    (8, 22, [1, 3, 1, 11, 11, 11, 77, 249, 0]),
    (8, 38, [1, 3, 1, 11, 27, 43, 71, 9, 0]),
    (8, 47, [1, 1, 7, 15, 21, 11, 81, 45, 0]),
    (8, 49, [1, 3, 7, 3, 25, 31, 65, 79, 0]),
    (8, 50, [1, 3, 1, 1, 19, 11, 3, 205, 0]),
    (8, 52, [1, 1, 5, 9, 19, 21, 29, 157, 0]),
    (8, 56, [1, 3, 7, 11, 1, 33, 89, 185, 0]),
    (8, 67, [1, 3, 3, 3, 15, 9, 79, 71, 0]),
    (8, 70, [1, 3, 7, 11, 15, 39, 119, 27, 0]),
    (8, 84, [1, 1, 3, 1, 11, 31, 97, 225, 0]),
    (8, 97, [1, 1, 1, 3, 23, 43, 57, 177, 0]),
    (8, 103, [1, 3, 7, 7, 17, 17, 37, 71, 0]),
    (8, 115, [1, 3, 1, 5, 27, 63, 123, 213, 0]),
    (8, 122, [1, 1, 3, 5, 11, 43, 53, 133, 0]),
    (9, 8, [1, 3, 5, 5, 29, 17, 47, 173, 479]),
    (9, 13, [1, 3, 3, 11, 3, 1, 109, 9, 69]),
    (9, 16, [1, 1, 1, 5, 17, 39, 23, 5, 343]),
    (9, 22, [1, 3, 1, 5, 25, 15, 31, 103, 499]),
    (9, 25, [1, 1, 1, 11, 11, 17, 63, 105, 183]),
    (9, 44, [1, 1, 5, 11, 9, 29, 97, 231, 363]),
    (9, 47, [1, 1, 5, 15, 19, 45, 41, 7, 383]),
    (9, 52, [1, 3, 7, 7, 31, 19, 83, 137, 221]),
    (9, 55, [1, 1, 1, 3, 23, 15, 111, 223, 83]),
    (9, 59, [1, 1, 5, 13, 31, 15, 55, 25, 161]),
    (9, 62, [1, 1, 3, 13, 25, 47, 39, 87, 257]),
];

/// The 32 direction numbers (generator matrix columns, most significant bit first) of every
/// dimension: `MATRICES[d][k]` is XORed into a point whose index has bit `k` set.
const MATRICES: [[u32; 32]; SOBOL_DIMENSIONS as usize] = build_matrices();

const fn build_matrices() -> [[u32; 32]; SOBOL_DIMENSIONS as usize] {
    let mut out = [[0u32; 32]; SOBOL_DIMENSIONS as usize];
    // Dimension 0: van der Corput, the bit-reversed index.
    let mut k = 0;
    while k < 32 {
        out[0][k] = 1u32 << (31 - k);
        k += 1;
    }
    let mut d = 1;
    while d < SOBOL_DIMENSIONS as usize {
        let (s, a, m) = JOE_KUO[d - 1];
        let s = s as usize;
        let v = &mut out[d];
        let mut i = 0;
        while i < 32 {
            if i < s {
                v[i] = m[i] << (31 - i);
            } else {
                // V_i = V_{i-s} xor (V_{i-s} >> s) xor sum_{k=1}^{s-1} a_k V_{i-k}, where a_k is
                // bit (s - 1 - k) of `a`.
                let mut value = v[i - s] ^ (v[i - s] >> s);
                let mut k = 1;
                while k < s {
                    if (a >> (s - 1 - k)) & 1 == 1 {
                        value ^= v[i - k];
                    }
                    k += 1;
                }
                v[i] = value;
            }
            i += 1;
        }
        d += 1;
    }
    out
}

/// The unscrambled Sobol point `index` in dimension `dim` (< [`SOBOL_DIMENSIONS`]), as a 32-bit
/// fixed-point fraction.
#[inline]
pub fn sobol(dim: u32, index: u32) -> u32 {
    let columns = &MATRICES[(dim % SOBOL_DIMENSIONS) as usize];
    let mut bits = index;
    let mut x = 0u32;
    while bits != 0 {
        let k = bits.trailing_zeros();
        x ^= columns[k as usize];
        bits &= bits - 1;
    }
    x
}

/// Nested uniform (Owen) scramble of a 32-bit fraction, by the hash of Burley (2020): every
/// output bit depends only on the input bits above it, so each dyadic interval is permuted as a
/// whole. The multipliers are the ones published in that paper.
#[inline]
pub fn owen_scramble(x: u32, seed: u32) -> u32 {
    let mut v = x.reverse_bits();
    v = v.wrapping_add(seed);
    v ^= v.wrapping_mul(0x6c50_b47c);
    v ^= v.wrapping_mul(0xb82f_1e52);
    v ^= v.wrapping_mul(0xc7af_e638);
    v ^= v.wrapping_mul(0x8d22_f6e6);
    v.reverse_bits()
}

/// A 32-bit fraction to a float in `[0, 1)` (24 bits, so 1 is never reached).
#[inline]
pub fn to_unit(x: u32) -> f32 {
    (x >> 8) as f32 * (1.0 / 16_777_216.0)
}

/// Samples of one pixel for one sample index.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PixelSampler {
    /// Hash of (scene seed, pixel x, pixel y).
    key: u64,
    /// Position in the sequence.
    index: u32,
}

impl PixelSampler {
    /// The sampler of pixel `(x, y)` (image space) for sample `index`, in the scene seeded by
    /// `seed`.
    pub fn new(seed: u32, x: u32, y: u32, index: u32) -> PixelSampler {
        let pixel = (u64::from(y) << 32) | u64::from(x);
        let key = mix64(pixel ^ mix64(u64::from(seed) ^ 0x5851_f42d_4c95_7f2d));
        PixelSampler { key, index }
    }

    /// Scramble seed of dimension `dim` for this pixel.
    #[inline]
    fn dim_seed(&self, dim: u32) -> u64 {
        mix64(self.key ^ u64::from(dim + 1).wrapping_mul(0x9e37_79b9_7f4a_7c15))
    }

    /// One value in `[0, 1)` of logical dimension `dim` (see [`LAYOUT`]).
    #[inline]
    pub fn get1(&self, dim: u32) -> f32 {
        let seed = self.dim_seed(dim);
        if let Some(&sobol_dim) = LAYOUT.get(dim as usize) {
            let x = sobol(u32::from(sobol_dim), self.index);
            to_unit(owen_scramble(x, (seed >> 32) as u32))
        } else {
            // Beyond the table: independent random numbers per (pixel, sample, dimension).
            to_unit((mix64(seed ^ u64::from(self.index)) >> 32) as u32)
        }
    }

    /// Two values in `[0, 1)`: logical dimensions `dim` and `dim + 1`.
    #[inline]
    pub fn get2(&self, dim: u32) -> (f32, f32) {
        (self.get1(dim), self.get1(dim + 1))
    }

    /// The stratum of this sample among `n` (at least one): `(index + offset) mod n`, where the
    /// offset is hashed from the pixel and `dim` only. Every `n` consecutive samples of a pixel take
    /// each stratum exactly once, and neighbouring pixels start at different ones (O1: the
    /// chromatic band of a lens, [`DIM_LENS_BAND`]).
    #[inline]
    pub fn stratum(&self, dim: u32, n: u32) -> u32 {
        self.strata(dim, n).0
    }

    /// [`PixelSampler::stratum`] and the sampler of the sample's group: the `n` samples of a group
    /// (one per stratum) share the index `(index + offset) / n`, so each stratum walks the
    /// sequence's own points in order (a stratified sequence per stratum) and the strata of a group
    /// see the same numbers in the dimensions asked through it (the chromatic bands of a lens share
    /// one point of the pupil: their colours are correlated, not speckled).
    #[inline]
    pub fn strata(&self, dim: u32, n: u32) -> (u32, PixelSampler) {
        let n = u64::from(n.max(1));
        let offset = (self.dim_seed(dim) >> 32) % n;
        let at = u64::from(self.index) + offset;
        let group = PixelSampler {
            key: self.key,
            index: (at / n) as u32,
        };
        ((at % n) as u32, group)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rng::Pcg32;

    #[test]
    fn the_first_points_match_the_published_sequence() {
        // The first ten points in three dimensions printed on the Joe-Kuo page.
        let expected = [
            [0.0, 0.0, 0.0],
            [0.5, 0.5, 0.5],
            [0.75, 0.25, 0.25],
            [0.25, 0.75, 0.75],
            [0.375, 0.375, 0.625],
            [0.875, 0.875, 0.125],
            [0.625, 0.125, 0.875],
            [0.125, 0.625, 0.375],
            [0.1875, 0.3125, 0.9375],
            [0.6875, 0.8125, 0.4375],
        ];
        // The page lists the points in Gray-code order: point i is index i ^ (i >> 1).
        for (i, point) in expected.iter().enumerate() {
            let index = (i ^ (i >> 1)) as u32;
            for (dim, &want) in point.iter().enumerate() {
                let got = sobol(dim as u32, index) as f64 / 4_294_967_296.0;
                assert_eq!(got, want, "point {i}, dimension {dim}");
            }
        }
    }

    #[test]
    fn every_dimension_is_a_0_1_sequence() {
        // Each 1-D projection of the first 2^k points has exactly one point per 1/2^k interval.
        for dim in 0..SOBOL_DIMENSIONS {
            for k in [4u32, 8, 10] {
                let n = 1u32 << k;
                let mut seen = vec![false; n as usize];
                for i in 0..n {
                    let cell = (sobol(dim, i) >> (32 - k)) as usize;
                    assert!(!seen[cell], "dimension {dim}, 2^{k} points");
                    seen[cell] = true;
                }
            }
        }
    }

    #[test]
    fn the_polynomials_are_primitive() {
        // A dimension of degree s repeats its direction-number recurrence with period 2^s - 1
        // only if its polynomial is primitive: check that x has that multiplicative order.
        for &(s, a, _) in &JOE_KUO {
            // Polynomial x^s + a_1 x^(s-1) + ... + a_(s-1) x + 1 as a bit mask.
            let poly = (1u32 << s) | (a << 1) | 1;
            let order = (1u32 << s) - 1;
            let mut p = 1u32;
            for i in 1..=order {
                // p = p * x mod poly
                p <<= 1;
                if p & (1 << s) != 0 {
                    p ^= poly;
                }
                if p == 1 {
                    assert_eq!(i, order, "degree {s}, a = {a}: x has order {i}");
                }
            }
            assert_eq!(p, 1);
        }
    }

    /// The t-value of the 2^m-point net formed by two dimensions (their first 2^m points,
    /// given as 32-bit fractions): the smallest t such that every elementary interval of area
    /// 2^(t-m) holds exactly 2^t points.
    fn t_value(xs: &[u32], ys: &[u32], m: u32, count: &mut Vec<u32>) -> u32 {
        'outer: for t in 0..m {
            let q = m - t; // the intervals have 2^q cells
            for a in 0..=q {
                let b = q - a;
                count.clear();
                count.resize(1 << q, 0);
                for (&x, &y) in xs.iter().zip(ys) {
                    let cx = if a == 0 { 0 } else { x >> (32 - a) };
                    let cy = if b == 0 { 0 } else { y >> (32 - b) };
                    count[((cx << b) | cy) as usize] += 1;
                }
                if count.iter().any(|&c| c != 1 << t) {
                    continue 'outer;
                }
            }
            return t;
        }
        m
    }

    #[test]
    fn two_dimensional_projections_have_the_published_quality() {
        // Joe and Kuo publish, for their D(6) numbers and m = 10, the (one-based) dimension at
        // which each t-value of the 2-D projections first occurs: t = 0, 1, 2, 3, 4, 5, 6 at
        // dimensions 2, 3, 4, 5, 9, 16, 32, and t = 7 not before dimension 76. A wrong entry in
        // the table changes this.
        let m = 10;
        let points: Vec<Vec<u32>> = (0..SOBOL_DIMENSIONS)
            .map(|d| (0..1u32 << m).map(|i| sobol(d, i)).collect())
            .collect();
        let mut count = Vec::new();
        let mut first = vec![0u32; m as usize + 1];
        for d in 1..SOBOL_DIMENSIONS as usize {
            for i in 0..d {
                let t = t_value(&points[i], &points[d], m, &mut count) as usize;
                if first[t] == 0 {
                    first[t] = d as u32 + 1;
                }
            }
        }
        assert_eq!(first[..7], [2, 3, 4, 5, 9, 16, 32]);
        assert!(first[7..].iter().all(|&d| d == 0), "{first:?}");
    }

    #[test]
    fn the_layout_is_a_permutation_with_good_pairs() {
        let mut seen = [false; SOBOL_DIMENSIONS as usize];
        for &d in &LAYOUT {
            assert!(!seen[d as usize], "dimension {d} used twice");
            seen[d as usize] = true;
        }
        let mut pairs = vec![DIM_CAMERA, DIM_LENS];
        for bounce in 0..10 {
            pairs.push(bounce_dim(bounce) + OFFSET_LIGHT);
            pairs.push(bounce_dim(bounce) + OFFSET_BSDF);
        }
        assert_eq!(bounce_dim(10), SOBOL_DIMENSIONS);
        let mut count = Vec::new();
        for m in [6, 8, 10] {
            for &logical in &pairs {
                let points = |l: u32| -> Vec<u32> {
                    (0..1u32 << m)
                        .map(|i| sobol(u32::from(LAYOUT[l as usize]), i))
                        .collect()
                };
                let t = t_value(&points(logical), &points(logical + 1), m, &mut count);
                assert!(t <= 2, "logical {logical}, m = {m}: t = {t}");
            }
        }
    }

    /// L2-star discrepancy of a 2-D point set (Warnock's formula).
    fn l2_star(points: &[(f64, f64)]) -> f64 {
        let n = points.len() as f64;
        let mut single = 0.0;
        for &(x, y) in points {
            single += (1.0 - x * x) * (1.0 - y * y) / 4.0;
        }
        let mut pairs = 0.0;
        for &(x1, y1) in points {
            for &(x2, y2) in points {
                pairs += (1.0 - x1.max(x2)) * (1.0 - y1.max(y2));
            }
        }
        (1.0 / 9.0 - 2.0 / n * single + pairs / (n * n))
            .max(0.0)
            .sqrt()
    }

    #[test]
    fn scrambled_pairs_beat_random_points() {
        let n = 1024;
        let mut rng = Pcg32::seeded(5, 9);
        let random: Vec<(f64, f64)> = (0..n)
            .map(|_| (rng.next_f32() as f64, rng.next_f32() as f64))
            .collect();
        let random_d = l2_star(&random);
        // Every pair of dimensions the renderer uses together, for the ten vertices in the table.
        let mut pairs = vec![DIM_CAMERA, DIM_LENS];
        for bounce in 0..10 {
            pairs.push(bounce_dim(bounce) + OFFSET_LIGHT);
            pairs.push(bounce_dim(bounce) + OFFSET_BSDF);
        }
        for pixel in [(0u32, 0u32), (311, 97), (5, 1000)] {
            for &dim in &pairs {
                let points: Vec<(f64, f64)> = (0..n)
                    .map(|i| {
                        let (u, v) = PixelSampler::new(3, pixel.0, pixel.1, i).get2(dim);
                        (u as f64, v as f64)
                    })
                    .collect();
                let d = l2_star(&points);
                assert!(
                    d < 0.25 * random_d,
                    "dims {dim},{} of pixel {pixel:?}: {d} vs random {random_d}",
                    dim + 1
                );
            }
        }
    }

    #[test]
    fn pixels_and_dimensions_get_different_scrambles() {
        let a = PixelSampler::new(1, 10, 20, 0);
        let b = PixelSampler::new(1, 11, 20, 0);
        let c = PixelSampler::new(1, 10, 21, 0);
        let d = PixelSampler::new(2, 10, 20, 0);
        for dim in [0, 1, 5, 40, 63, 64, 100] {
            let values = [a.get1(dim), b.get1(dim), c.get1(dim), d.get1(dim)];
            for i in 0..4 {
                for j in i + 1..4 {
                    assert_ne!(values[i], values[j], "dimension {dim}");
                }
            }
        }
        assert_ne!(a.get1(0), a.get1(1));
        // Same inputs, same numbers.
        assert_eq!(
            PixelSampler::new(1, 10, 20, 7),
            PixelSampler::new(1, 10, 20, 7)
        );
        assert_eq!(
            PixelSampler::new(1, 10, 20, 7).get2(9),
            PixelSampler::new(1, 10, 20, 7).get2(9)
        );
    }

    #[test]
    fn scrambling_keeps_the_stratification_of_each_pixel() {
        // The first 256 samples of a pixel fall one per 1/256 interval in every dimension, also
        // beyond the table's first dimensions, as long as the dimension is in the table.
        let mut seen = vec![false; 256];
        for dim in [0, 7, 33, 63] {
            seen.iter_mut().for_each(|s| *s = false);
            for i in 0..256 {
                let v = PixelSampler::new(9, 4, 5, i).get1(dim);
                let cell = (v * 256.0) as usize;
                assert!(!seen[cell], "dimension {dim}");
                seen[cell] = true;
            }
        }
        // Values are in [0, 1).
        for i in 0..1000 {
            let s = PixelSampler::new(0, i, i * 7, i);
            for dim in [0, 3, 64, 200] {
                assert!((0.0..1.0).contains(&s.get1(dim)));
            }
        }
    }

    #[test]
    fn owen_scramble_is_a_nested_permutation() {
        // Inputs sharing their top k bits map to outputs sharing their top k bits.
        for seed in [0u32, 1, 0xdead_beef] {
            for k in [1u32, 4, 9] {
                let mut map = std::collections::BTreeMap::new();
                for x in (0..4096u32).map(|i| i.wrapping_mul(0x9e37_79b9)) {
                    let top_in = x >> (32 - k);
                    let top_out = owen_scramble(x, seed) >> (32 - k);
                    assert_eq!(*map.entry(top_in).or_insert(top_out), top_out);
                }
            }
        }
    }
}
