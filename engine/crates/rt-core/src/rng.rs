//! Deterministic random numbers: PCG-XSH-RR 64/32 (O'Neill, "PCG: A Family of Simple Fast
//! Space-Efficient Statistically Good Algorithms for Random Number Generation", 2014).
//!
//! Only integer arithmetic is involved, so the sequence is identical on every platform.

/// Multiplier of the 64-bit LCG underlying PCG32.
const MULTIPLIER: u64 = 6_364_136_223_846_793_005;

/// The PCG32 (XSH-RR) generator: 64 bits of state, 32 bits of output per call.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Pcg32 {
    state: u64,
    inc: u64,
}

impl Pcg32 {
    /// Creates a generator for the sequence selected by `stream`, starting at `seed`.
    ///
    /// This is the reference `pcg32_srandom_r(initstate = seed, initseq = stream)`.
    pub fn seeded(seed: u64, stream: u64) -> Pcg32 {
        let mut rng = Pcg32 {
            state: 0,
            inc: (stream << 1) | 1,
        };
        rng.next_u32();
        rng.state = rng.state.wrapping_add(seed);
        rng.next_u32();
        rng
    }

    /// Next uniformly distributed 32-bit value.
    #[inline]
    pub fn next_u32(&mut self) -> u32 {
        let old = self.state;
        self.state = old.wrapping_mul(MULTIPLIER).wrapping_add(self.inc);
        let xorshifted = (((old >> 18) ^ old) >> 27) as u32;
        let rot = (old >> 59) as u32;
        xorshifted.rotate_right(rot)
    }

    /// Next uniformly distributed float in `[0, 1)` with 24 bits of resolution.
    #[inline]
    pub fn next_f32(&mut self) -> f32 {
        (self.next_u32() >> 8) as f32 * (1.0 / 16_777_216.0)
    }
}

/// A 64-bit mixing function (the SplitMix64 finaliser). Turns structured keys such as pixel
/// coordinates into well scattered seeds.
#[inline]
pub fn mix64(mut z: u64) -> u64 {
    z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    z ^ (z >> 31)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_the_reference_implementation() {
        // Output of the official `pcg32-demo` (seed 42, stream 54). Pinned so that every
        // platform and every future refactor agrees: determinism is a feature.
        let mut rng = Pcg32::seeded(42, 54);
        let got: Vec<u32> = (0..6).map(|_| rng.next_u32()).collect();
        assert_eq!(
            got,
            [
                0xa15c_02b7,
                0x7b47_f409,
                0xba1d_3330,
                0x83d2_f293,
                0xbfa4_784b,
                0xcbed_606e
            ]
        );
    }

    #[test]
    fn same_seed_same_sequence_different_stream_differs() {
        let mut a = Pcg32::seeded(7, 1);
        let mut b = Pcg32::seeded(7, 1);
        let mut c = Pcg32::seeded(7, 2);
        let sa: Vec<u32> = (0..8).map(|_| a.next_u32()).collect();
        let sb: Vec<u32> = (0..8).map(|_| b.next_u32()).collect();
        let sc: Vec<u32> = (0..8).map(|_| c.next_u32()).collect();
        assert_eq!(sa, sb);
        assert_ne!(sa, sc);
    }

    #[test]
    fn floats_are_in_the_half_open_unit_interval() {
        let mut rng = Pcg32::seeded(1, 1);
        let mut sum = 0.0f64;
        for _ in 0..10_000 {
            let f = rng.next_f32();
            assert!((0.0..1.0).contains(&f));
            sum += f as f64;
        }
        let mean = sum / 10_000.0;
        assert!((mean - 0.5).abs() < 0.02, "mean {mean}");
    }

    #[test]
    fn mix64_is_a_stable_scrambler() {
        // First SplitMix64 output for state 0 is mix64(0 + golden gamma).
        assert_eq!(mix64(0x9E37_79B9_7F4A_7C15), 0xE220_A839_7B1D_CDAF);
        assert_ne!(mix64(1), mix64(2));
    }
}
