//! Gradient noise, written here from Ken Perlin's public description ("Improving Noise",
//! SIGGRAPH 2002): a lattice of pseudo-random gradients chosen among the 12 directions to the
//! edges of a cube, blended with the quintic fade `6t⁵ − 15t⁴ + 10t³`. The permutation that picks
//! the gradients is our own (a Fisher–Yates shuffle of 0..255 driven by the engine's PCG with a
//! fixed seed), not the paper's table.
//!
//! Only IEEE `+ − ×`, `floor` and integer operations, in a fixed order: the same bits on every
//! platform. The noise is 0 at every lattice point, repeats every [`PERIOD`] units along each
//! axis, and has mean 0; its variance and range are pinned by the tests.

use crate::math::Vec3;
use crate::rng::Pcg32;
use std::sync::OnceLock;

/// The noise repeats every this many units along each axis.
pub const PERIOD: i32 = 256;

/// The seed of the permutation (fixed: changing it changes every pattern).
const SEED: u64 = 0x5245_5041_434b_4536; // "REPACKE6"

/// The permutation of 0..255, twice (so `perm[i + perm[j]]` never wraps).
fn permutation() -> &'static [u8; 512] {
    static TABLE: OnceLock<[u8; 512]> = OnceLock::new();
    TABLE.get_or_init(|| {
        let mut p = [0u8; 256];
        for (i, v) in p.iter_mut().enumerate() {
            *v = i as u8;
        }
        let mut rng = Pcg32::seeded(SEED, 6);
        for i in (1..256usize).rev() {
            // Unbiased pick in 0..=i by rejection.
            let n = i as u32 + 1;
            let limit = u32::MAX - u32::MAX % n;
            let j = loop {
                let x = rng.next_u32();
                if x < limit {
                    break (x % n) as usize;
                }
            };
            p.swap(i, j);
        }
        let mut t = [0u8; 512];
        for i in 0..512 {
            t[i] = p[i & 255];
        }
        t
    })
}

/// `6t⁵ − 15t⁴ + 10t³`.
#[inline]
fn fade(t: f32) -> f32 {
    t * t * t * (t * (t * 6.0 - 15.0) + 10.0)
}

#[inline]
fn lerp(t: f32, a: f32, b: f32) -> f32 {
    a + t * (b - a)
}

/// The dot product of the gradient picked by `hash` with `(x, y, z)`: the 12 edge directions of
/// a cube (four of them twice, so 16 entries are picked by 4 bits).
#[inline]
fn grad(hash: u8, x: f32, y: f32, z: f32) -> f32 {
    let h = hash & 15;
    let u = if h < 8 { x } else { y };
    let v = if h < 4 {
        y
    } else if h == 12 || h == 14 {
        x
    } else {
        z
    };
    (if h & 1 == 0 { u } else { -u }) + (if h & 2 == 0 { v } else { -v })
}

/// Lattice cell and position inside it along one axis.
#[inline]
fn cell(v: f32) -> (usize, f32) {
    let f = v.floor();
    (((f as i64).rem_euclid(PERIOD as i64)) as usize, v - f)
}

/// Gradient noise at `p`, in about `[-1, 1]`.
pub fn noise3(p: Vec3) -> f32 {
    if !p.is_finite() {
        return 0.0;
    }
    let perm = permutation();
    let (xi, x) = cell(p.x);
    let (yi, y) = cell(p.y);
    let (zi, z) = cell(p.z);
    let (u, v, w) = (fade(x), fade(y), fade(z));
    let a = perm[xi] as usize + yi;
    let (aa, ab) = (perm[a] as usize + zi, perm[a + 1] as usize + zi);
    let b = perm[xi + 1] as usize + yi;
    let (ba, bb) = (perm[b] as usize + zi, perm[b + 1] as usize + zi);
    lerp(
        w,
        lerp(
            v,
            lerp(u, grad(perm[aa], x, y, z), grad(perm[ba], x - 1.0, y, z)),
            lerp(
                u,
                grad(perm[ab], x, y - 1.0, z),
                grad(perm[bb], x - 1.0, y - 1.0, z),
            ),
        ),
        lerp(
            v,
            lerp(
                u,
                grad(perm[aa + 1], x, y, z - 1.0),
                grad(perm[ba + 1], x - 1.0, y, z - 1.0),
            ),
            lerp(
                u,
                grad(perm[ab + 1], x, y - 1.0, z - 1.0),
                grad(perm[bb + 1], x - 1.0, y - 1.0, z - 1.0),
            ),
        ),
    )
}

/// Fractal sum of `octaves` octaves of [`noise3`], each twice the frequency and half the
/// amplitude of the last, normalised by the sum of the amplitudes (so its range stays about
/// `[-1, 1]`). Each octave is shifted by a fixed offset so their lattices do not line up.
pub fn fbm(p: Vec3, octaves: u32) -> f32 {
    let mut sum = 0.0f32;
    let mut amplitude = 1.0f32;
    let mut total = 0.0f32;
    let mut q = p;
    for o in 0..octaves.max(1) {
        sum += amplitude * noise3(q + OCTAVE_SHIFT * o as f32);
        total += amplitude;
        amplitude *= 0.5;
        q *= 2.0;
    }
    sum / total
}

/// Offset between octaves (irrational-looking, so lattices of successive octaves never align).
const OCTAVE_SHIFT: Vec3 = Vec3::new(19.191, 7.453, 31.337);

/// A hash of an integer cell to `[0, 1)` (per-thread colour variation and the like).
pub fn hash01(a: i32, b: i32, c: u32) -> f32 {
    let mut x = (a as u32)
        .wrapping_mul(0x9e37_79b1)
        .wrapping_add((b as u32).wrapping_mul(0x85eb_ca77))
        .wrapping_add(c.wrapping_mul(0xc2b2_ae3d));
    x ^= x >> 16;
    x = x.wrapping_mul(0x7feb_352d);
    x ^= x >> 15;
    x = x.wrapping_mul(0x846c_a68b);
    x ^= x >> 16;
    (x >> 8) as f32 * (1.0 / 16_777_216.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_permutation_is_a_permutation() {
        let p = permutation();
        let mut seen = [false; 256];
        for &v in &p[..256] {
            assert!(!seen[v as usize]);
            seen[v as usize] = true;
        }
        assert_eq!(p[..256], p[256..]);
        // Not the identity, and stable: its first entries are pinned.
        assert_ne!(p[..8], [0, 1, 2, 3, 4, 5, 6, 7]);
        assert_eq!(p[..8], PINNED_FIRST);
    }

    /// The first eight entries of the permutation.
    const PINNED_FIRST: [u8; 8] = [249, 98, 122, 132, 33, 141, 79, 48];

    #[test]
    fn the_noise_vanishes_on_the_lattice_and_repeats_with_its_period() {
        for (x, y, z) in [(0, 0, 0), (3, -7, 12), (255, 1, -1), (-40, 90, 300)] {
            assert_eq!(noise3(Vec3::new(x as f32, y as f32, z as f32)), 0.0);
        }
        let mut rng = Pcg32::seeded(5, 5);
        for _ in 0..2000 {
            // Points on a 1/64 grid, so adding the period is exact in f32.
            let q = |r: &mut Pcg32| (r.next_u32() % 16384) as f32 / 64.0 - 128.0;
            let p = Vec3::new(q(&mut rng), q(&mut rng), q(&mut rng));
            let n = noise3(p);
            let period = PERIOD as f32;
            for shift in [
                Vec3::new(period, 0.0, 0.0),
                Vec3::new(0.0, -period, 0.0),
                Vec3::new(0.0, 0.0, 2.0 * period),
            ] {
                assert_eq!(noise3(p + shift), n, "{p:?}");
            }
        }
    }

    #[test]
    fn the_noise_statistics_are_pinned() {
        // 2^18 points of a jittered grid over 64³ lattice cells: mean, variance and range.
        let mut rng = Pcg32::seeded(9, 2);
        let (mut sum, mut sum2, mut lo, mut hi) = (0.0f64, 0.0f64, 0.0f32, 0.0f32);
        let n = 1 << 18;
        for _ in 0..n {
            let p = Vec3::new(
                rng.next_f32() * 64.0,
                rng.next_f32() * 64.0,
                rng.next_f32() * 64.0,
            );
            let v = noise3(p);
            sum += f64::from(v);
            sum2 += f64::from(v) * f64::from(v);
            lo = lo.min(v);
            hi = hi.max(v);
        }
        let mean = sum / n as f64;
        let variance = sum2 / n as f64 - mean * mean;
        eprintln!("noise: mean {mean}, variance {variance}, range [{lo}, {hi}]");
        assert!(mean.abs() < 0.003, "{mean}");
        assert!((variance - PINNED_VARIANCE).abs() < 0.004, "{variance}");
        assert!(
            lo > -1.1 && hi < 1.1 && lo < -0.75 && hi > 0.75,
            "[{lo}, {hi}]"
        );
        // The fractal sum keeps the mean and has less variance than one octave.
        let (mut s, mut s2) = (0.0f64, 0.0f64);
        for i in 0..65_536 {
            let p = Vec3::new(
                i as f32 * 0.173,
                (i % 97) as f32 * 0.61,
                (i % 13) as f32 * 1.37,
            );
            let v = f64::from(fbm(p, 4));
            s += v;
            s2 += v * v;
        }
        let (m, var) = (s / 65_536.0, s2 / 65_536.0 - (s / 65_536.0).powi(2));
        eprintln!("fbm(4): mean {m}, variance {var}");
        assert!(
            m.abs() < 0.01 && var < variance && var > 0.25 * variance,
            "{m} {var}"
        );
    }

    /// The variance of one octave, measured (the pinned statistics of the noise): 0.0730 over
    /// 2^18 points; mean -0.0012; range [-0.993, 0.941].
    const PINNED_VARIANCE: f64 = 0.073;

    #[test]
    fn hashes_are_uniform_and_deterministic() {
        let mut sum = 0.0f64;
        for i in 0..10_000 {
            let h = hash01(i, -i * 3, 7);
            assert!((0.0..1.0).contains(&h));
            sum += f64::from(h);
        }
        assert!((sum / 10_000.0 - 0.5).abs() < 0.01);
        assert_eq!(hash01(3, 4, 5), hash01(3, 4, 5));
        assert_ne!(hash01(3, 4, 5), hash01(4, 3, 5));
    }
}
