// The pure parts of the path tracer in the browser (phase E4): tiles and
// their assignment to workers, the pass schedule, the generation counter
// that drops stale tiles, the accumulation and the choice of resolution
// during camera gestures. No DOM and no workers here, so tests run them in
// Node (tests/pathtracer.test.ts).
//
// Accumulation follows the native renderer exactly (engine/crates/rt-cli,
// `render_progressive`): every tile adds its samples in sample-index order,
// in f32 (a Float32Array rounds every sum), and a pixel's mean is the sum
// times the f32 reciprocal of the sample count, which is what
// `Film::resolve` computes. So the pool's image equals `rt`'s bit for bit.

import { applyCurve, exactPixel, exposureGain, srgbEncode, toneCurve, type DisplayCurve } from './tonemap';

/** Edge of the square tiles (rt-cli's TILE_SIZE). */
export const TILE = 32;
/** Most samples per tile in one pass (rt-cli's MAX_PASS_SAMPLES). */
export const MAX_PASS_SAMPLES = 16;
/** A camera gesture should present a frame this often, milliseconds. */
export const GESTURE_TARGET_MS = 50;

export interface Tile {
  /** Position in the grid (row by row). */
  index: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The image cut into tiles of `size`, row by row (rt_core::render::tile_grid). */
export function tileGrid(width: number, height: number, size = TILE): Tile[] {
  const s = Math.max(1, size);
  const tiles: Tile[] = [];
  for (let y = 0; y < height; y += s) {
    const h = Math.min(s, height - y);
    for (let x = 0; x < width; x += s) tiles.push({ index: tiles.length, x, y, w: Math.min(s, width - x), h });
  }
  return tiles;
}

/**
 * Tiles interleaved by worker index: tile i goes to worker i mod n. Every worker gets tiles from
 * every part of the image (a balanced load), and a tile always goes to the same worker, so its
 * samples come back in order.
 */
export function assignTiles(tiles: readonly Tile[], workers: number): Tile[][] {
  const n = Math.max(1, Math.floor(workers));
  const out: Tile[][] = Array.from({ length: n }, () => []);
  for (const t of tiles) out[t.index % n].push(t);
  return out;
}

/** Workers for this machine: hardwareConcurrency - 1, at least 1, at most 8. */
export function poolSize(hardwareConcurrency: number | undefined): number {
  const n = Number.isFinite(hardwareConcurrency) ? Math.floor(hardwareConcurrency as number) : 2;
  return Math.max(1, Math.min(8, n - 1));
}

/**
 * Passes of a progressive render: 1, 2, 4, 8, then 16 samples at a time (rt-cli), the last one
 * cut at `max` (0: no limit). `done` samples are already in; returns the next pass or null.
 */
export function nextPass(done: number, previous: number, max: number): { first: number; count: number } | null {
  const size = previous <= 0 ? 1 : Math.min(previous * 2, MAX_PASS_SAMPLES);
  const count = max > 0 ? Math.min(size, max - done) : size;
  return count > 0 ? { first: done, count } : null;
}

/**
 * Resolution divisor for the next frame of a camera gesture, ½ or ¼ of the viewport, from how
 * long the last frame took at `lastScale`: the cost goes with the pixels, so ½ costs (lastScale /
 * 2)² times the last frame; ½ when that fits in the target, ¼ otherwise. Without a measurement it
 * starts at ¼.
 */
export function chooseScale(lastMs: number | null, lastScale: number, targetMs = GESTURE_TARGET_MS): 2 | 4 {
  if (lastMs === null || !(lastMs >= 0) || !(lastScale > 0)) return 4;
  const half = lastMs * (lastScale / 2) ** 2;
  return half <= targetMs ? 2 : 4;
}

/** The size of an image of `width x height` at a resolution divisor. */
export function scaledSize(width: number, height: number, scale: number): { width: number; height: number } {
  const s = Math.max(1, scale);
  return { width: Math.max(1, Math.ceil(width / s)), height: Math.max(1, Math.ceil(height / s)) };
}

/**
 * Generations: every restart (the scene, the camera, the size changed) takes the next number, and
 * anything a worker sends for an older one is dropped.
 */
export class Generations {
  private value = 0;
  get current(): number {
    return this.value;
  }
  next(): number {
    return ++this.value;
  }
  accepts(generation: number): boolean {
    return generation === this.value;
  }
}

/** A tile's samples as a worker sends them. */
export interface TileResult {
  generation: number;
  index: number;
  /** Sample index of the first sample in `data`. */
  first: number;
  count: number;
  /** `count` consecutive samples of the tile, each `w * h * 4` floats, RGBA premultiplied. */
  data: Float32Array;
  /** With passes (Render, phase X2): the albedo of the same samples, each `w * h * 3` floats. */
  albedo?: Float32Array;
  /** With passes, once per tile (the job whose `first` is 0): its exact planes (render/pass-planes.ts). */
  exact?: Uint32Array;
}

/** Opaque coverage, give or take the rounding of `n * (1 / n)`. */
const OPAQUE = 1 - 1e-6;

/** The accumulated image of one generation. */
export class Accumulator {
  readonly width: number;
  readonly height: number;
  readonly tiles: readonly Tile[];
  /** Sum of radiance (premultiplied) and coverage per pixel, RGBA. */
  readonly sum: Float32Array;
  /** Samples summed into each tile. */
  readonly samples: Int32Array;
  private filled = 0;

  constructor(width: number, height: number, tiles?: readonly Tile[]) {
    this.width = width;
    this.height = height;
    this.tiles = tiles ?? tileGrid(width, height);
    this.sum = new Float32Array(width * height * 4);
    this.samples = new Int32Array(this.tiles.length);
  }

  /**
   * Adds a tile's samples. They must continue where the tile stopped (samples in index order,
   * like the native film); anything else is refused and false returned.
   */
  add(index: number, first: number, count: number, data: Float32Array): boolean {
    const t = this.tiles[index];
    if (!t || first !== this.samples[index] || count <= 0 || data.length < count * t.w * t.h * 4) return false;
    const stride = t.w * t.h * 4;
    const sum = this.sum;
    for (let s = 0; s < count; s++) {
      const base = s * stride;
      for (let y = 0; y < t.h; y++) {
        let o = ((t.y + y) * this.width + t.x) * 4;
        let i = base + y * t.w * 4;
        // A Float32Array store rounds the double sum to f32: f32 addition, as in Film::splat.
        for (let x = 0; x < t.w * 4; x++) sum[o++] += data[i++];
      }
    }
    if (this.samples[index] === 0) this.filled++;
    this.samples[index] += count;
    return true;
  }

  /** Every tile has at least one sample. */
  get complete(): boolean {
    return this.filled === this.tiles.length;
  }

  /** Samples every pixel has (the least over the tiles). */
  get minSamples(): number {
    let m = Infinity;
    for (let i = 0; i < this.samples.length; i++) m = Math.min(m, this.samples[i]);
    return Number.isFinite(m) ? m : 0;
  }

  /** Sum of the samples of every tile. */
  get totalSamples(): number {
    let n = 0;
    for (let i = 0; i < this.samples.length; i++) n += this.samples[i];
    return n;
  }

  /**
   * The mean of pixel `p` (Film::resolve: sum times the f32 reciprocal of the count), its colour
   * un-premultiplied for a pixel the background partly shows through. Writes RGBA into `out`.
   */
  meanAt(p: number, n: number, out: number[]): void {
    const inv = Math.fround(1 / n);
    const s = this.sum;
    const a = Math.fround(s[p * 4 + 3] * inv);
    let r = Math.fround(s[p * 4] * inv);
    let g = Math.fround(s[p * 4 + 1] * inv);
    let b = Math.fround(s[p * 4 + 2] * inv);
    if (a < OPAQUE) {
      if (a > 0) {
        r = Math.fround(r / a);
        g = Math.fround(g / a);
        b = Math.fround(b / a);
      } else r = g = b = 0;
    }
    out[0] = r;
    out[1] = g;
    out[2] = b;
    out[3] = a;
  }

  /** Converts one tile to 8-bit RGBA (straight alpha) with a display curve, into `out` (w * h * 4). */
  tileBytes(index: number, curve: DisplayCurve, out: Uint8ClampedArray): void {
    const t = this.tiles[index];
    const n = this.samples[index];
    const px = [0, 0, 0, 0];
    let o = 0;
    for (let y = 0; y < t.h; y++) {
      for (let x = 0; x < t.w; x++, o += 4) {
        if (n === 0) {
          out[o] = out[o + 1] = out[o + 2] = out[o + 3] = 0;
          continue;
        }
        this.meanAt((t.y + y) * this.width + t.x + x, n, px);
        curve.pixel(px[0], px[1], px[2], out, o);
        out[o + 3] = alphaByte(px[3]);
      }
    }
  }

  /** The whole image as 8-bit RGBA with a display curve (tiles without samples are transparent). */
  imageBytes(curve: DisplayCurve, out: Uint8ClampedArray = new Uint8ClampedArray(this.width * this.height * 4)): Uint8ClampedArray {
    const tile = new Uint8ClampedArray(TILE * TILE * 4);
    for (const t of this.tiles) {
      this.tileBytes(t.index, curve, tile);
      for (let y = 0; y < t.h; y++) out.set(tile.subarray(y * t.w * 4, (y + 1) * t.w * 4), ((t.y + y) * this.width + t.x) * 4);
    }
    return out;
  }
}

/** Coverage to an 8-bit alpha. */
export function alphaByte(a: number): number {
  return a >= OPAQUE ? 255 : a > 0 ? Math.round(a * 255) : 0;
}

/**
 * The exact 8-bit conversion of accumulated sums (Render): every pixel had `samples` samples; RGBA
 * sums in, straight RGBA bytes out, as `Film::to_srgb8_tonemapped` (for opaque pixels, bit for
 * bit). Workers run it on slices of the image in parallel.
 */
export function exactBytes(sum: Float32Array, samples: number, ev: number, tonemap: number, out: Uint8ClampedArray = new Uint8ClampedArray(sum.length)): Uint8ClampedArray {
  const gain = exposureGain(ev);
  const curve = toneCurve(tonemap);
  const inv = Math.fround(1 / Math.max(1, samples));
  const tmp = [0, 0, 0];
  const f = Math.fround;
  for (let i = 0; i < sum.length; i += 4) {
    const a = f(sum[i + 3] * inv);
    let r = f(sum[i] * inv);
    let g = f(sum[i + 1] * inv);
    let b = f(sum[i + 2] * inv);
    if (a < OPAQUE) {
      if (a > 0) {
        r = f(r / a);
        g = f(g / a);
        b = f(b / a);
      } else r = g = b = 0;
    }
    exactPixel(r, g, b, gain, curve, out, i, tmp);
    out[i + 3] = alphaByte(a);
  }
  return out;
}

/** `(srgb_encode(v) × 65535 + 0.5)` as a 16-bit word: the 8-bit rule of the engine, at 16 bits. */
export function toWord(display: number): number {
  const v = Math.fround(Math.fround(srgbEncode(display) * 65535) + 0.5);
  if (!(v > 0)) return 0;
  return v >= 65535 ? 65535 : Math.floor(v);
}

/** Coverage to a 16-bit alpha. */
export function alphaWord(a: number): number {
  return a >= OPAQUE ? 65535 : a > 0 ? Math.round(a * 65535) : 0;
}

/**
 * The 16-bit conversion of accumulated sums (a 16-bit PNG): the same exposure, curve and encoding
 * as `exactBytes`, quantised to 16 bits instead of 8. Straight RGBA words out.
 */
export function exactWords16(sum: Float32Array, samples: number, ev: number, tonemap: number, out: Uint16Array = new Uint16Array(sum.length)): Uint16Array {
  const gain = exposureGain(ev);
  const curve = toneCurve(tonemap);
  const inv = Math.fround(1 / Math.max(1, samples));
  const tmp = [0, 0, 0];
  const f = Math.fround;
  for (let i = 0; i < sum.length; i += 4) {
    const a = f(sum[i + 3] * inv);
    let r = f(sum[i] * inv);
    let g = f(sum[i + 1] * inv);
    let b = f(sum[i + 2] * inv);
    if (a < OPAQUE) {
      if (a > 0) {
        r = f(r / a);
        g = f(g / a);
        b = f(b / a);
      } else r = g = b = 0;
    }
    applyCurve(curve, f(r * gain), f(g * gain), f(b * gain), tmp);
    out[i] = toWord(tmp[0]);
    out[i + 1] = toWord(tmp[1]);
    out[i + 2] = toWord(tmp[2]);
    out[i + 3] = alphaWord(a);
  }
  return out;
}

/**
 * Scene-linear RGBA for an EXR: the mean of the samples times the exposure gain, no curve, no
 * encoding, alpha premultiplied (the convention of OpenEXR).
 */
export function linearRgba(sum: Float32Array, samples: number, ev: number, out: Float32Array = new Float32Array(sum.length)): Float32Array {
  const gain = Math.fround(exposureGain(ev));
  const inv = Math.fround(1 / Math.max(1, samples));
  const f = Math.fround;
  for (let i = 0; i < sum.length; i += 4) {
    out[i] = f(f(sum[i] * inv) * gain);
    out[i + 1] = f(f(sum[i + 1] * inv) * gain);
    out[i + 2] = f(f(sum[i + 2] * inv) * gain);
    const a = f(sum[i + 3] * inv);
    out[i + 3] = a >= OPAQUE ? 1 : a;
  }
  return out;
}

// ------------------------------------------------------------------ straight linear images (X3c)

/**
 * The exact conversions of a straight-alpha linear image: the render's average with its colour already divided by
 * its coverage (what the desktop launcher hands the AI and gets back from it, `linear_of` of
 * engine/crates/rt-app/src/ai/post.rs). Every pixel takes the same steps as in `exactBytes`, `exactWords16` and
 * `linearRgba` after their division, so an image nothing changed is the engine's own file: bit for bit at 8 and 16
 * bits, and in EXR for every opaque pixel (a partly transparent one is premultiplied again, within an f32 rounding).
 */
export function straightBytes(rgba: Float32Array, ev: number, tonemap: number, out: Uint8ClampedArray = new Uint8ClampedArray(rgba.length)): Uint8ClampedArray {
  const gain = exposureGain(ev);
  const curve = toneCurve(tonemap);
  const tmp = [0, 0, 0];
  for (let i = 0; i < rgba.length; i += 4) {
    exactPixel(rgba[i], rgba[i + 1], rgba[i + 2], gain, curve, out, i, tmp);
    out[i + 3] = alphaByte(rgba[i + 3]);
  }
  return out;
}

/** 16-bit PNG words of a straight-alpha linear image, as `exactWords16`. */
export function straightWords16(rgba: Float32Array, ev: number, tonemap: number, out: Uint16Array = new Uint16Array(rgba.length)): Uint16Array {
  const gain = exposureGain(ev);
  const curve = toneCurve(tonemap);
  const tmp = [0, 0, 0];
  const f = Math.fround;
  for (let i = 0; i < rgba.length; i += 4) {
    applyCurve(curve, f(rgba[i] * gain), f(rgba[i + 1] * gain), f(rgba[i + 2] * gain), tmp);
    out[i] = toWord(tmp[0]);
    out[i + 1] = toWord(tmp[1]);
    out[i + 2] = toWord(tmp[2]);
    out[i + 3] = alphaWord(rgba[i + 3]);
  }
  return out;
}

/** EXR data (premultiplied, with the exposure) of a straight-alpha linear image, as `linearRgba`. */
export function straightExr(rgba: Float32Array, ev: number, out: Float32Array = new Float32Array(rgba.length)): Float32Array {
  const gain = Math.fround(exposureGain(ev));
  const f = Math.fround;
  for (let i = 0; i < rgba.length; i += 4) {
    const a = rgba[i + 3];
    const opaque = a >= OPAQUE;
    for (let c = 0; c < 3; c++) out[i + c] = f((opaque ? rgba[i + c] : f(rgba[i + c] * a)) * gain);
    out[i + 3] = opaque ? 1 : a;
  }
  return out;
}

/** The straight-alpha linear image of accumulated sums, as the launcher's `linear_of` gives it (tests). */
export function straightOf(sum: Float32Array, samples: number, out: Float32Array = new Float32Array(sum.length)): Float32Array {
  const inv = Math.fround(1 / Math.max(1, samples));
  const f = Math.fround;
  for (let i = 0; i < sum.length; i += 4) {
    const a = f(sum[i + 3] * inv);
    let r = f(sum[i] * inv);
    let g = f(sum[i + 1] * inv);
    let b = f(sum[i + 2] * inv);
    if (a < OPAQUE) {
      if (a > 0) {
        r = f(r / a);
        g = f(g / a);
        b = f(b / a);
      } else r = g = b = 0;
    }
    out[i] = r;
    out[i + 1] = g;
    out[i + 2] = b;
    out[i + 3] = a >= OPAQUE ? 1 : a;
  }
  return out;
}
