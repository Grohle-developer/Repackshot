// Shared pieces of the asset generators (tools/assets/aperture-masks.mjs, tools/assets/gobos.mjs).
//
// Everything here is deterministic on purpose (STUDIO-TOOLS §0): a generated asset is a recipe plus a seed, and the
// same recipe gives the same pixels on any machine. So the pixel code uses only + - * / and sqrt (which IEEE 754
// fixes exactly) and the helpers below instead of Math.sin / Math.cos / Math.exp, whose last bits are left to the
// engine. Randomness is an integer hash, never Math.random. No dependency: node:zlib and node:crypto only.

import { createHash } from 'node:crypto';
import { deflateSync, inflateSync } from 'node:zlib';

// ---------------------------------------------------------------------------
// Maths
// ---------------------------------------------------------------------------

export const PI = 3.141592653589793;
export const TWO_PI = 6.283185307179586;
const HALF_PI = 1.5707963267948966;

/** sin(x) from a Taylor series after reducing to [-pi/2, pi/2]; error below 1e-11, identical everywhere. */
export function sin(x) {
  x = x - TWO_PI * Math.floor(x / TWO_PI + 0.5);
  if (x > HALF_PI) x = PI - x;
  else if (x < -HALF_PI) x = -PI - x;
  const x2 = x * x;
  return x * (1 + x2 * (-1 / 6 + x2 * (1 / 120 + x2 * (-1 / 5040 + x2 * (1 / 362880 + x2 * (-1 / 39916800 + x2 * (1 / 6227020800 + x2 * (-1 / 1307674368000))))))));
}

export const cos = (x) => sin(x + HALF_PI);

export const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

export function smoothstep(a, b, x) {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}

export const mix = (a, b, t) => a + (b - a) * t;

/** Pixel coverage of a shape from its signed distance (negative inside) at a pixel of size `px`. */
export const coverage = (sd, px) => clamp01(0.5 - sd / px);

// ---------------------------------------------------------------------------
// Random numbers: integer hashes only
// ---------------------------------------------------------------------------

/** mulberry32: a seeded generator of floats in [0, 1). */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A float in [0, 1) from two integer coordinates and a seed (a small avalanche hash). */
export function hash2(ix, iy, seed) {
  let h = (Math.imul(ix | 0, 0x27d4eb2d) ^ Math.imul(iy | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}

/** Smooth value noise in [0, 1). */
export function valueNoise(x, y, seed) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy, seed);
  const b = hash2(ix + 1, iy, seed);
  const c = hash2(ix, iy + 1, seed);
  const d = hash2(ix + 1, iy + 1, seed);
  return mix(mix(a, b, sx), mix(c, d, sx), sy);
}

/** Fractal sum of value noise, normalised to [0, 1). */
export function fbm(x, y, seed, octaves, lacunarity = 2, gain = 0.5) {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let f = 1;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise(x * f + o * 17.17, y * f - o * 9.31, seed + o * 101);
    norm += amp;
    amp *= gain;
    f *= lacunarity;
  }
  return sum / norm;
}

// ---------------------------------------------------------------------------
// Pixels and hashes
// ---------------------------------------------------------------------------

/** Float in [0, 1] to a byte. */
export const toByte = (v) => Math.round(255 * clamp01(v));

export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

// ---------------------------------------------------------------------------
// PNG: 8-bit grey, no interlace. node:zlib compresses; the bytes of the compressed stream can differ between
// builds of zlib, which is why the index also records the hash of the raw pixels (the canonical one).
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = new Uint8Array(12 + data.length);
  const v = new DataView(out.buffer);
  v.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  v.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

const SIGNATURE = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);

/** The PNG filter (0 None, 1 Sub, 2 Up, 3 Average, 4 Paeth) of one row. */
function filterRow(type, row, prev, out, offset) {
  const w = row.length;
  for (let x = 0; x < w; x++) {
    const a = x > 0 ? row[x - 1] : 0;
    const b = prev ? prev[x] : 0;
    const c = x > 0 && prev ? prev[x - 1] : 0;
    let p;
    switch (type) {
      case 1:
        p = a;
        break;
      case 2:
        p = b;
        break;
      case 3:
        p = (a + b) >> 1;
        break;
      case 4: {
        const pa = Math.abs(b - c);
        const pb = Math.abs(a - c);
        const pc = Math.abs(a + b - 2 * c);
        p = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        break;
      }
      default:
        p = 0;
    }
    out[offset + x] = (row[x] - p) & 0xff;
  }
}

/** Encodes 8-bit grey pixels (row-major, `width * height` bytes) as a PNG. */
export function encodePng(pixels, width, height) {
  if (pixels.length !== width * height) throw new Error('pixel count does not match the size');
  const raw = new Uint8Array((width + 1) * height);
  const trial = new Uint8Array(width);
  for (let y = 0; y < height; y++) {
    const row = pixels.subarray(y * width, (y + 1) * width);
    const prev = y > 0 ? pixels.subarray((y - 1) * width, y * width) : null;
    let best = 0;
    let bestCost = Infinity;
    for (let type = 0; type <= 4; type++) {
      filterRow(type, row, prev, trial, 0);
      // The usual heuristic: the filter whose output is closest to zero as signed bytes.
      let cost = 0;
      for (let x = 0; x < width; x++) cost += trial[x] < 128 ? trial[x] : 256 - trial[x];
      if (cost < bestCost) {
        bestCost = cost;
        best = type;
      }
    }
    raw[y * (width + 1)] = best;
    filterRow(best, row, prev, raw, y * (width + 1) + 1);
  }
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, width);
  v.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // colour type: grey
  const idat = deflateSync(raw, { level: 9, memLevel: 9 });
  const parts = [SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** Decodes the PNGs encodePng writes (and any 8-bit grey, non-interlaced PNG): `{ width, height, pixels, crcOk }`. */
export function decodePng(png) {
  const v = new DataView(png.buffer, png.byteOffset, png.byteLength);
  for (let i = 0; i < 8; i++) if (png[i] !== SIGNATURE[i]) throw new Error('not a PNG');
  let o = 8;
  let width = 0;
  let height = 0;
  let crcOk = true;
  const idat = [];
  for (;;) {
    const len = v.getUint32(o);
    const type = String.fromCharCode(png[o + 4], png[o + 5], png[o + 6], png[o + 7]);
    const data = png.subarray(o + 8, o + 8 + len);
    crcOk &&= v.getUint32(o + 8 + len) === crc32(png.subarray(o + 4, o + 8 + len));
    if (type === 'IHDR') {
      width = v.getUint32(o + 8);
      height = v.getUint32(o + 12);
      if (png[o + 16] !== 8 || png[o + 17] !== 0 || png[o + 20] !== 0) throw new Error('only 8-bit grey, non-interlaced PNG is supported');
    } else if (type === 'IDAT') idat.push(data);
    o += 12 + len;
    if (type === 'IEND') break;
  }
  const all = new Uint8Array(idat.reduce((n, d) => n + d.length, 0));
  idat.reduce((at, d) => (all.set(d, at), at + d.length), 0);
  const raw = inflateSync(all);
  const pixels = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const type = raw[y * (width + 1)];
    for (let x = 0; x < width; x++) {
      const a = x > 0 ? pixels[y * width + x - 1] : 0;
      const b = y > 0 ? pixels[(y - 1) * width + x] : 0;
      const c = x > 0 && y > 0 ? pixels[(y - 1) * width + x - 1] : 0;
      const f = raw[y * (width + 1) + 1 + x];
      let p = 0;
      if (type === 1) p = a;
      else if (type === 2) p = b;
      else if (type === 3) p = (a + b) >> 1;
      else if (type === 4) {
        const pa = Math.abs(b - c);
        const pb = Math.abs(a - c);
        const pc = Math.abs(a + b - 2 * c);
        p = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      pixels[y * width + x] = (f + p) & 0xff;
    }
  }
  return { width, height, pixels, crcOk };
}
