//! The simulator's random numbers: xoshiro256** (D. Blackman and S. Vigna, "Scrambled Linear
//! Pseudorandom Number Generators", ACM TOMS 47(4), 2021), seeded through SplitMix64 (G. Steele,
//! D. Lea and C. Flood, "Fast Splittable Pseudorandom Number Generators", OOPSLA 2014). Every
//! work item (a direction of a configuration) gets its own stream from `(seed, item...)`, so the
//! result does not depend on which thread runs it or in which order.

/// One step of SplitMix64.
#[inline]
fn splitmix64(state: &mut u64) -> u64 {
    *state = state.wrapping_add(0x9e37_79b9_7f4a_7c15);
    let mut z = *state;
    z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
    z ^ (z >> 31)
}

/// A xoshiro256** generator.
#[derive(Clone, Debug)]
pub struct Rng {
    s: [u64; 4],
}

impl Rng {
    /// The stream of `keys` (the recipe's seed followed by the work item's indices).
    pub fn new(keys: &[u64]) -> Rng {
        let mut state = 0x5eed_0f5c_a77e_2ed5u64;
        for &k in keys {
            state ^= k;
            state = splitmix64(&mut state);
        }
        let mut s = [0u64; 4];
        for v in &mut s {
            *v = splitmix64(&mut state);
        }
        if s == [0; 4] {
            s[0] = 1;
        }
        Rng { s }
    }

    /// The next 64 random bits.
    #[inline]
    pub fn next_u64(&mut self) -> u64 {
        let result = self.s[1].wrapping_mul(5).rotate_left(7).wrapping_mul(9);
        let t = self.s[1] << 17;
        self.s[2] ^= self.s[0];
        self.s[3] ^= self.s[1];
        self.s[1] ^= self.s[2];
        self.s[0] ^= self.s[3];
        self.s[2] ^= t;
        self.s[3] = self.s[3].rotate_left(45);
        result
    }

    /// A uniform number in `[0, 1)` with 53 random bits.
    #[inline]
    pub fn next_f64(&mut self) -> f64 {
        (self.next_u64() >> 11) as f64 * (1.0 / 9_007_199_254_740_992.0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn streams_are_reproducible_and_distinct() {
        let a: Vec<u64> = (0..4).map(|_| Rng::new(&[1, 2, 3]).next_u64()).collect();
        assert!(a.windows(2).all(|w| w[0] == w[1]));
        let mut x = Rng::new(&[1, 2, 3]);
        let mut y = Rng::new(&[1, 2, 4]);
        assert_ne!(x.next_u64(), y.next_u64());
        let mut r = Rng::new(&[7]);
        let n = 100_000;
        let mean: f64 = (0..n).map(|_| r.next_f64()).sum::<f64>() / n as f64;
        assert!((mean - 0.5).abs() < 0.005, "{mean}");
    }
}
