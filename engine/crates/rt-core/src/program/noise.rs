//! The gradient noise of the material programs (M3a's contract, ARCHITECTURE §5.2 quater "El
//! ruido"; the reference is `src/core/noise.ts`), bit for bit:
//!
//! * **Perlin's improved noise** (K. Perlin, "Improving noise", SIGGRAPH 2002): the lattice's
//!   integer corners, a gradient per corner from one of twelve cube-edge directions, the quintic
//!   fade `6t⁵ − 15t⁴ + 10t³` and trilinear interpolation.
//! * **Simplex noise** in three dimensions (written from S. Gustavson, "Simplex noise
//!   demystified", 2005): the skewed lattice's four corners, a radial kernel `(0.6 − r²)⁴` and the
//!   same gradients, scaled by 32.
//!
//! The gradient of a corner is picked by a hash of the corner and the seed instead of the
//! paper's permutation table: the products of the coordinates with the primes of Teschner et
//! al. ("Optimized spatial hashing for collision detection of deformable objects", 2003), xor-ed,
//! the seed through Knuth's multiplicative constant, then C. Wellons's `lowbias32` finaliser.
//! This is not the noise of [`crate::pattern::noise`] (E6, a permutation of its own): a program's
//! noise is the one the page's previews draw.
//!
//! Every step is `f32` in the written order (the reference rounds with `Math.fround` where this
//! rounds by its type); integers are 32-bit and wrap.

/// The noise of a point farther than this from the origin on any axis is 0.
pub const NOISE_LIMIT: f32 = 1.0e9;

const F3: f32 = 1.0 / 3.0;
const G3: f32 = 1.0 / 6.0;
const G3X2: f32 = 2.0 * G3;
const G3X3: f32 = 3.0 * G3;
const SIMPLEX_R2: f32 = 0.6;
const SIMPLEX_SCALE: f32 = 32.0;

/// The 32-bit hash of a lattice corner and a seed.
#[inline]
pub fn hash3(ix: i32, iy: i32, iz: i32, seed: u32) -> u32 {
    let mut h = (ix as u32).wrapping_mul(73_856_093)
        ^ (iy as u32).wrapping_mul(19_349_663)
        ^ (iz as u32).wrapping_mul(83_492_791)
        ^ seed.wrapping_mul(0x9e37_79b1);
    h ^= h >> 16;
    h = h.wrapping_mul(0x7feb_352d);
    h ^= h >> 15;
    h = h.wrapping_mul(0x846c_a68b);
    h ^= h >> 16;
    h
}

/// The dot product of the corner's gradient (one of twelve cube-edge directions, by the low four
/// bits of `h`) with `(x, y, z)`.
#[inline]
pub fn grad(h: u32, x: f32, y: f32, z: f32) -> f32 {
    let g = h & 15;
    let u = if g < 8 { x } else { y };
    let v = if g < 4 {
        y
    } else if g == 12 || g == 14 {
        x
    } else {
        z
    };
    (if g & 1 == 0 { u } else { -u }) + (if g & 2 == 0 { v } else { -v })
}

/// `((t·t)·t)·((t·((t·6) − 15)) + 10)`.
#[inline]
fn fade(t: f32) -> f32 {
    ((t * t) * t) * ((t * ((t * 6.0) - 15.0)) + 10.0)
}

/// `a + t·(b − a)`.
#[inline]
fn lerp(t: f32, a: f32, b: f32) -> f32 {
    a + t * (b - a)
}

#[inline]
fn outside(x: f32, y: f32, z: f32) -> bool {
    !(x.abs() <= NOISE_LIMIT && y.abs() <= NOISE_LIMIT && z.abs() <= NOISE_LIMIT)
}

/// Improved Perlin noise at `(x, y, z)`, about −1..1.
pub fn perlin3(x: f32, y: f32, z: f32, seed: u32) -> f32 {
    if outside(x, y, z) {
        return 0.0;
    }
    let (fx, fy, fz) = (x.floor(), y.floor(), z.floor());
    let (ix, iy, iz) = (fx as i32, fy as i32, fz as i32);
    let (x0, y0, z0) = (x - fx, y - fy, z - fz);
    let (x1, y1, z1) = (x0 - 1.0, y0 - 1.0, z0 - 1.0);
    let (u, v, w) = (fade(x0), fade(y0), fade(z0));
    let (jx, jy, jz) = (ix.wrapping_add(1), iy.wrapping_add(1), iz.wrapping_add(1));
    let g000 = grad(hash3(ix, iy, iz, seed), x0, y0, z0);
    let g100 = grad(hash3(jx, iy, iz, seed), x1, y0, z0);
    let g010 = grad(hash3(ix, jy, iz, seed), x0, y1, z0);
    let g110 = grad(hash3(jx, jy, iz, seed), x1, y1, z0);
    let g001 = grad(hash3(ix, iy, jz, seed), x0, y0, z1);
    let g101 = grad(hash3(jx, iy, jz, seed), x1, y0, z1);
    let g011 = grad(hash3(ix, jy, jz, seed), x0, y1, z1);
    let g111 = grad(hash3(jx, jy, jz, seed), x1, y1, z1);
    let a = lerp(u, g000, g100);
    let b = lerp(u, g010, g110);
    let c = lerp(u, g001, g101);
    let d = lerp(u, g011, g111);
    lerp(w, lerp(v, a, b), lerp(v, c, d))
}

/// One corner of a simplex: `(0.6 − r²)⁴ · gradient`, 0 outside the kernel.
#[inline]
fn corner(h: u32, x: f32, y: f32, z: f32) -> f32 {
    let t = ((SIMPLEX_R2 - x * x) - y * y) - z * z;
    if t < 0.0 {
        return 0.0;
    }
    let t2 = t * t;
    (t2 * t2) * grad(h, x, y, z)
}

/// Simplex noise at `(x, y, z)`, about −1..1.
pub fn simplex3(x: f32, y: f32, z: f32, seed: u32) -> f32 {
    if outside(x, y, z) {
        return 0.0;
    }
    let s = ((x + y) + z) * F3;
    let fi = (x + s).floor();
    let fj = (y + s).floor();
    let fk = (z + s).floor();
    let t = ((fi + fj) + fk) * G3;
    let x0 = x - (fi - t);
    let y0 = y - (fj - t);
    let z0 = z - (fk - t);
    // The simplex the point is in, by the order of its offsets.
    let ((i1, j1, k1), (i2, j2, k2)) = if x0 >= y0 {
        if y0 >= z0 {
            ((1, 0, 0), (1, 1, 0))
        } else if x0 >= z0 {
            ((1, 0, 0), (1, 0, 1))
        } else {
            ((0, 0, 1), (1, 0, 1))
        }
    } else if y0 < z0 {
        ((0, 0, 1), (0, 1, 1))
    } else if x0 < z0 {
        ((0, 1, 0), (0, 1, 1))
    } else {
        ((0, 1, 0), (1, 1, 0))
    };
    let x1 = (x0 - i1 as f32) + G3;
    let y1 = (y0 - j1 as f32) + G3;
    let z1 = (z0 - k1 as f32) + G3;
    let x2 = (x0 - i2 as f32) + G3X2;
    let y2 = (y0 - j2 as f32) + G3X2;
    let z2 = (z0 - k2 as f32) + G3X2;
    let x3 = (x0 - 1.0) + G3X3;
    let y3 = (y0 - 1.0) + G3X3;
    let z3 = (z0 - 1.0) + G3X3;
    let (i, j, k) = (fi as i32, fj as i32, fk as i32);
    let n0 = corner(hash3(i, j, k, seed), x0, y0, z0);
    let n1 = corner(
        hash3(
            i.wrapping_add(i1),
            j.wrapping_add(j1),
            k.wrapping_add(k1),
            seed,
        ),
        x1,
        y1,
        z1,
    );
    let n2 = corner(
        hash3(
            i.wrapping_add(i2),
            j.wrapping_add(j2),
            k.wrapping_add(k2),
            seed,
        ),
        x2,
        y2,
        z2,
    );
    let n3 = corner(
        hash3(
            i.wrapping_add(1),
            j.wrapping_add(1),
            k.wrapping_add(1),
            seed,
        ),
        x3,
        y3,
        z3,
    );
    SIMPLEX_SCALE * (((n0 + n1) + n2) + n3)
}

/// The number of octaves of an `octaves` constant: JavaScript's `Math.round`, clamped to 1..8;
/// NaN stays NaN in the reference (no octave at all: the sum is 0 / 0), `None` here.
#[inline]
fn octave_count(octaves: f32) -> Option<u32> {
    if octaves.is_nan() {
        return None;
    }
    // Math.round of an f32 is ⌊x + ½⌋ (exact in f64).
    let r = (f64::from(octaves) + 0.5).floor();
    Some(r.clamp(1.0, 8.0) as u32)
}

/// The seed of a constant: JavaScript's `>>> 0` (ToUint32: truncated, modulo 2³²; not finite: 0).
#[inline]
pub fn seed_of(c: f32) -> u32 {
    if !c.is_finite() {
        return 0;
    }
    f64::from(c).trunc().rem_euclid(4_294_967_296.0) as u32
}

/// The sum over octaves of the base noise `simplex` (or Perlin): octave `o` (from 0) at the point
/// times `lacunarity^o` with the seed `seed + o` and weight `gain^o`; the sum over the sum of the
/// weights, then `0.5 + 0.5·that`. About 0..1, 0.5 on average.
#[allow(clippy::too_many_arguments)]
pub fn fbm(
    simplex: bool,
    x: f32,
    y: f32,
    z: f32,
    octaves: f32,
    lacunarity: f32,
    gain: f32,
    seed: u32,
) -> f32 {
    let Some(n) = octave_count(octaves) else {
        return f32::NAN;
    };
    let (mut sum, mut norm, mut amp, mut freq) = (0.0f32, 0.0f32, 1.0f32, 1.0f32);
    for o in 0..n {
        let s = seed.wrapping_add(o);
        let v = if simplex {
            simplex3(x * freq, y * freq, z * freq, s)
        } else {
            perlin3(x * freq, y * freq, z * freq, s)
        };
        sum += amp * v;
        norm += amp;
        amp *= gain;
        freq *= lacunarity;
    }
    0.5 + 0.5 * (sum / norm)
}

/// The seed of channel `c` (0 red, 1 green, 2 blue) of a noise's colour output.
#[inline]
pub fn channel_seed(seed: u32, c: u32) -> u32 {
    seed.wrapping_add(7919u32.wrapping_mul(c + 1))
}
