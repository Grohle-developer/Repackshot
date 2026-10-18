// Gradient noise of the material graphs (phase M3a): the definition the engine (M3b) implements bit for bit, in f32,
// with ARCHITECTURE §5.2 quater ("The noise") as the written contract. Two bases and a sum over octaves:
//
//   - Perlin's improved gradient noise (K. Perlin, "Improving noise", SIGGRAPH 2002): the lattice's integer corners,
//     a gradient per corner from one of twelve cube-edge directions, the quintic fade 6t⁵ − 15t⁴ + 10t³ and
//     trilinear interpolation. The permutation table of the paper is replaced by an integer hash of the corner
//     (below), so there is no table to copy and the seed is free.
//   - Simplex noise in three dimensions (K. Perlin, 2001; written from S. Gustavson, "Simplex noise demystified",
//     2005): the skewed lattice's four corners, a radial kernel (0.6 − r²)⁴ and the same gradients, scaled by 32.
//
// The corner hash is the spatial hash of Teschner et al. ("Optimized spatial hashing for collision detection of
// deformable objects", 2003: the products of the coordinates with three large primes, xor-ed), with the seed through
// Knuth's multiplicative constant, then the `lowbias32` finaliser published by C. Wellons (public domain).
//
// Every floating-point step is rounded to f32 (`f` = Math.fround), in the order written: the engine does the same
// operations in the same order and gets the same bits on every machine. Integer steps are 32-bit (Math.imul and
// the unsigned shifts are Rust's wrapping_mul and >> on u32).

import { f } from './f32math';

/** The noise of a point farther than this from the origin on any axis is 0 (the raw noise; 0.5 after the sum). */
export const NOISE_LIMIT = 1e9;

const F3 = f(1 / 3);
const G3 = f(1 / 6);
const G3x2 = f(2 * G3);
const G3x3 = f(3 * G3);
const SIMPLEX_R2 = f(0.6);
const SIMPLEX_SCALE = 32;

/** The 32-bit hash of a lattice corner and a seed (u32). */
export function hash3(ix: number, iy: number, iz: number, seed: number): number {
  let h = Math.imul(ix, 73856093) ^ Math.imul(iy, 19349663) ^ Math.imul(iz, 83492791) ^ Math.imul(seed, 0x9e3779b1 | 0);
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b | 0);
  h ^= h >>> 16;
  return h >>> 0;
}

/** The dot product of the corner's gradient (one of twelve cube-edge directions, by the low four bits) with (x, y, z). */
export function grad(h: number, x: number, y: number, z: number): number {
  const g = h & 15;
  const u = g < 8 ? x : y;
  const v = g < 4 ? y : g === 12 || g === 14 ? x : z;
  return f(((g & 1) === 0 ? u : -u) + ((g & 2) === 0 ? v : -v));
}

/** 6t⁵ − 15t⁴ + 10t³, as ((t·t)·t)·((t·((t·6) − 15)) + 10). */
export function fade(t: number): number {
  return f(f(f(t * t) * t) * f(f(t * f(f(t * 6) - 15)) + 10));
}

/** a + t·(b − a). */
export function lerp(t: number, a: number, b: number): number {
  return f(a + f(t * f(b - a)));
}

const outside = (x: number, y: number, z: number): boolean => !(Math.abs(x) <= NOISE_LIMIT && Math.abs(y) <= NOISE_LIMIT && Math.abs(z) <= NOISE_LIMIT);

/** Improved Perlin noise at (x, y, z) (f32), about −1..1. */
export function perlin3(x: number, y: number, z: number, seed: number): number {
  x = f(x);
  y = f(y);
  z = f(z);
  if (outside(x, y, z)) return 0;
  const fx = Math.floor(x);
  const fy = Math.floor(y);
  const fz = Math.floor(z);
  const ix = fx | 0;
  const iy = fy | 0;
  const iz = fz | 0;
  const x0 = f(x - fx);
  const y0 = f(y - fy);
  const z0 = f(z - fz);
  const x1 = f(x0 - 1);
  const y1 = f(y0 - 1);
  const z1 = f(z0 - 1);
  const u = fade(x0);
  const v = fade(y0);
  const w = fade(z0);
  const jx = (ix + 1) | 0;
  const jy = (iy + 1) | 0;
  const jz = (iz + 1) | 0;
  const g000 = grad(hash3(ix, iy, iz, seed), x0, y0, z0);
  const g100 = grad(hash3(jx, iy, iz, seed), x1, y0, z0);
  const g010 = grad(hash3(ix, jy, iz, seed), x0, y1, z0);
  const g110 = grad(hash3(jx, jy, iz, seed), x1, y1, z0);
  const g001 = grad(hash3(ix, iy, jz, seed), x0, y0, z1);
  const g101 = grad(hash3(jx, iy, jz, seed), x1, y0, z1);
  const g011 = grad(hash3(ix, jy, jz, seed), x0, y1, z1);
  const g111 = grad(hash3(jx, jy, jz, seed), x1, y1, z1);
  const a = lerp(u, g000, g100);
  const b = lerp(u, g010, g110);
  const c = lerp(u, g001, g101);
  const d = lerp(u, g011, g111);
  return lerp(w, lerp(v, a, b), lerp(v, c, d));
}

/** One corner of a simplex: (0.6 − r²)⁴ · gradient, 0 outside the kernel. */
function corner(h: number, x: number, y: number, z: number): number {
  const t = f(f(f(SIMPLEX_R2 - f(x * x)) - f(y * y)) - f(z * z));
  if (t < 0) return 0;
  const t2 = f(t * t);
  return f(f(t2 * t2) * grad(h, x, y, z));
}

/** Simplex noise at (x, y, z) (f32), about −1..1. */
export function simplex3(x: number, y: number, z: number, seed: number): number {
  x = f(x);
  y = f(y);
  z = f(z);
  if (outside(x, y, z)) return 0;
  const s = f(f(f(x + y) + z) * F3);
  const fi = Math.floor(f(x + s));
  const fj = Math.floor(f(y + s));
  const fk = Math.floor(f(z + s));
  const t = f(f(f(fi + fj) + fk) * G3);
  const x0 = f(x - f(fi - t));
  const y0 = f(y - f(fj - t));
  const z0 = f(z - f(fk - t));
  // The simplex the point is in, by the order of its offsets: the corners (i1, j1, k1) and (i2, j2, k2).
  let i1 = 0;
  let j1 = 0;
  let k1 = 0;
  let i2 = 0;
  let j2 = 0;
  let k2 = 0;
  if (x0 >= y0) {
    if (y0 >= z0) {
      i1 = 1;
      i2 = 1;
      j2 = 1;
    } else if (x0 >= z0) {
      i1 = 1;
      i2 = 1;
      k2 = 1;
    } else {
      k1 = 1;
      i2 = 1;
      k2 = 1;
    }
  } else if (y0 < z0) {
    k1 = 1;
    j2 = 1;
    k2 = 1;
  } else if (x0 < z0) {
    j1 = 1;
    j2 = 1;
    k2 = 1;
  } else {
    j1 = 1;
    i2 = 1;
    j2 = 1;
  }
  const x1 = f(f(x0 - i1) + G3);
  const y1 = f(f(y0 - j1) + G3);
  const z1 = f(f(z0 - k1) + G3);
  const x2 = f(f(x0 - i2) + G3x2);
  const y2 = f(f(y0 - j2) + G3x2);
  const z2 = f(f(z0 - k2) + G3x2);
  const x3 = f(f(x0 - 1) + G3x3);
  const y3 = f(f(y0 - 1) + G3x3);
  const z3 = f(f(z0 - 1) + G3x3);
  const i = fi | 0;
  const j = fj | 0;
  const k = fk | 0;
  const n0 = corner(hash3(i, j, k, seed), x0, y0, z0);
  const n1 = corner(hash3((i + i1) | 0, (j + j1) | 0, (k + k1) | 0, seed), x1, y1, z1);
  const n2 = corner(hash3((i + i2) | 0, (j + j2) | 0, (k + k2) | 0, seed), x2, y2, z2);
  const n3 = corner(hash3((i + 1) | 0, (j + 1) | 0, (k + 1) | 0, seed), x3, y3, z3);
  return f(SIMPLEX_SCALE * f(f(f(n0 + n1) + n2) + n3));
}

export type NoiseKind = 'PERLIN' | 'SIMPLEX';

/**
 * The sum over octaves: octave o (from 0) is the base noise at (x, y, z) · lacunarityᵒ with seed `seed + o` and
 * weight gainᵒ; the sum divided by the sum of the weights, then 0.5 + 0.5 · that. About 0..1, 0.5 on average.
 */
export function fbm(kind: NoiseKind, x: number, y: number, z: number, octaves: number, lacunarity: number, gain: number, seed: number): number {
  const base = kind === 'SIMPLEX' ? simplex3 : perlin3;
  const n = Math.max(1, Math.min(8, Math.round(octaves)));
  x = f(x);
  y = f(y);
  z = f(z);
  lacunarity = f(lacunarity);
  gain = f(gain);
  let sum = 0;
  let norm = 0;
  let amp = 1;
  let freq = 1;
  for (let o = 0; o < n; o++) {
    const v = base(f(x * freq), f(y * freq), f(z * freq), (seed + o) >>> 0);
    sum = f(sum + f(amp * v));
    norm = f(norm + amp);
    amp = f(amp * gain);
    freq = f(freq * lacunarity);
  }
  return f(0.5 + f(0.5 * f(sum / norm)));
}

/** The seed of channel `c` (0 red, 1 green, 2 blue) of the colour output of a noise. */
export function channelSeed(seed: number, c: number): number {
  return (seed + Math.imul(7919, c + 1)) >>> 0;
}
