// U14: the picture of a render in progress for the queue's live view (core/live-frame.ts). The accumulated RGBA sums
// are scaled down by a whole factor with a box filter: each pixel of the picture is the mean of the pixels of its
// k × k box that have samples (of a 2 × 2 grid of the box when k > 2, so its cost does not grow with the render),
// each pixel first divided by its own count (mid-pass, the pool's tiles have different counts; the launcher's frames
// have one count for the whole image), its colour still premultiplied by its coverage. Then it is converted for
// display with the render's exposure and curve through the viewport's fast DisplayCurve: a picture to watch, not the
// render's exact bytes (the file is converted exactly at the end, as before).
//
// The pool's picture is kept between two (`LivePicture`): only the boxes over tiles whose samples changed since the
// last picture are done again, so a picture costs about what came back since the one before.

import type { FrameBox, LiveFrame } from '../core/live-frame';
import { fitFactor } from '../core/live-frame';
import { alphaByte, scaledSize, TILE } from './tiles';
import type { DisplayCurve } from './tonemap';

/** Opaque coverage, give or take the rounding of `n * (1 / n)` (tiles.ts). */
const OPAQUE = 1 - 1e-6;

/** Where the sums come from and how many samples each pixel has in them. */
export interface LiveSums {
  /** RGBA sums of the image, premultiplied radiance and coverage. */
  sum: Float32Array;
  width: number;
  height: number;
  /**
   * Samples in each pixel's sums: one count for the whole image (a launcher frame), or one per tile of `tile` pixels,
   * row by row (the pool's accumulator: `Accumulator.samples`). A pixel with no samples has no picture yet.
   */
  samples: number | Int32Array;
  /** Edge of the tiles `samples` counts by (TILE). */
  tile?: number;
}

/**
 * The pixels of each box of `s` along a side of `n` pixels that the picture reads: all of them in boxes of 1 or 2,
 * else two, at a quarter and three quarters of the box (of the shorter box at the edge), so a picture costs about four
 * reads a pixel whatever the render's size.
 */
function picks(n: number, s: number): Int32Array[] {
  const out: Int32Array[] = [];
  for (let lo = 0; lo < n; lo += s) {
    const m = Math.min(n, lo + s) - lo;
    if (s <= 2) out.push(Int32Array.from({ length: m }, (_, i) => lo + i));
    else {
      const a = lo + Math.floor(m / 4);
      const c = lo + Math.floor((3 * m) / 4);
      out.push(c !== a ? Int32Array.of(a, c) : Int32Array.of(a));
    }
  }
  return out;
}

/**
 * A picture of a `renderWidth × renderHeight` render scaled down by `k`, kept from one update to the next:
 * `ceil(renderWidth / k) × ceil(renderHeight / k)` 8-bit straight RGBA pixels. With samples per tile, an update does
 * again only the boxes over the tiles whose count changed since the update before (a tile's sums change only with its
 * samples); with one count for the whole image, all of them. Boxes with no sampled pixel are transparent.
 */
export class LivePicture {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8ClampedArray;
  private readonly xs: Int32Array[];
  private readonly ys: Int32Array[];
  private readonly tileX: Int32Array;
  private readonly tileY: Int32Array;
  private readonly cols: number;
  /** The samples of each tile at the last update (null: none yet). */
  private seen: Int32Array | null = null;
  private readonly dirty: Uint8Array;

  constructor(
    readonly renderWidth: number,
    readonly renderHeight: number,
    readonly k: number,
    readonly tile = TILE,
  ) {
    const s = Math.max(1, Math.floor(k));
    const out = scaledSize(renderWidth, renderHeight, s);
    this.width = out.width;
    this.height = out.height;
    this.rgba = new Uint8ClampedArray(out.width * out.height * 4);
    this.dirty = new Uint8Array(out.width * out.height);
    this.xs = picks(renderWidth, s);
    this.ys = picks(renderHeight, s);
    const t = Math.max(1, tile);
    const cols = Math.ceil(renderWidth / t);
    this.cols = cols;
    this.tileX = Int32Array.from({ length: renderWidth }, (_, x) => Math.floor(x / t));
    this.tileY = Int32Array.from({ length: renderHeight }, (_, y) => Math.floor(y / t) * cols);
  }

  /** Brings the picture up to `sum` with `samples` (one count, or one per tile); returns how many boxes it did. */
  update(sum: Float32Array, samples: number | Int32Array, curve: DisplayCurve): number {
    const s = Math.max(1, Math.floor(this.k));
    const ow = this.width;
    const dirty = this.dirty;
    let inv: Float64Array;
    let tileX = this.tileX;
    let tileY = this.tileY;
    if (typeof samples === 'number') {
      // One count: every box, every pixel with the same weight.
      inv = Float64Array.of(samples > 0 ? Math.fround(1 / samples) : 0);
      tileX = new Int32Array(this.renderWidth);
      tileY = new Int32Array(this.renderHeight);
      dirty.fill(1);
    } else {
      inv = new Float64Array(samples.length);
      for (let i = 0; i < samples.length; i++) inv[i] = samples[i] > 0 ? Math.fround(1 / samples[i]) : 0;
      // The boxes over every tile whose count changed (all of them the first time).
      const seen = this.seen ?? new Int32Array(samples.length).fill(-1);
      this.seen = seen;
      const t = Math.max(1, this.tile);
      for (let i = 0; i < samples.length; i++) {
        if (seen[i] === samples[i]) continue;
        seen[i] = samples[i];
        const tx = (i % this.cols) * t;
        const ty = Math.floor(i / this.cols) * t;
        const x1 = Math.min(this.renderWidth, tx + t) - 1;
        const y1 = Math.min(this.renderHeight, ty + t) - 1;
        if (tx > x1 || ty > y1) continue;
        for (let oy = Math.floor(ty / s); oy <= Math.floor(y1 / s); oy++) for (let ox = Math.floor(tx / s); ox <= Math.floor(x1 / s); ox++) dirty[oy * ow + ox] = 1;
      }
    }
    const rgba = this.rgba;
    const width = this.renderWidth;
    let done = 0;
    for (let oy = 0; oy < this.height; oy++) {
      const ys = this.ys[oy];
      for (let ox = 0; ox < ow; ox++) {
        const b = oy * ow + ox;
        if (!dirty[b]) continue;
        dirty[b] = 0;
        done++;
        const xs = this.xs[ox];
        let r = 0;
        let g = 0;
        let bl = 0;
        let a = 0;
        let n = 0;
        for (let iy = 0; iy < ys.length; iy++) {
          const y = ys[iy];
          const row = y * width;
          const ty = tileY[y];
          for (let ix = 0; ix < xs.length; ix++) {
            const x = xs[ix];
            const w = inv[ty + tileX[x]];
            if (w === 0) continue;
            const p = (row + x) * 4;
            r += sum[p] * w;
            g += sum[p + 1] * w;
            bl += sum[p + 2] * w;
            a += sum[p + 3] * w;
            n++;
          }
        }
        const o = b * 4;
        if (n === 0) {
          rgba[o] = rgba[o + 1] = rgba[o + 2] = rgba[o + 3] = 0;
          continue;
        }
        r /= n;
        g /= n;
        bl /= n;
        a /= n;
        // Straight colour for the curve where the background shows through (tiles.ts `meanAt`).
        if (a < OPAQUE) {
          if (a > 0) {
            r /= a;
            g /= a;
            bl /= a;
          } else r = g = bl = 0;
        }
        curve.pixel(r, g, bl, rgba, o);
        rgba[o + 3] = alphaByte(a);
      }
    }
    return done;
  }
}

/**
 * The picture of `src` scaled down by `k` (≥ 1, a whole number) and converted with `curve`: 8-bit straight RGBA,
 * `ceil(width / k) × ceil(height / k)`, each pixel the mean of its box (of a 2 × 2 grid of it, in boxes larger than 2).
 */
export function liveImage(src: LiveSums, k: number, curve: DisplayCurve): { width: number; height: number; rgba: Uint8ClampedArray } {
  const pic = new LivePicture(src.width, src.height, k, src.tile ?? TILE);
  pic.update(src.sum, src.samples, curve);
  return { width: pic.width, height: pic.height, rgba: pic.rgba };
}

/**
 * The live view's picture of a render: `src` fitted in `box` (a whole factor; a launcher frame already scaled comes
 * in at its size and is fitted again only if it is still too big), with the engine's numbers.
 */
export function liveFrameOf(src: LiveSums, box: FrameBox, curve: DisplayCurve, numbers: { renderWidth: number; renderHeight: number; samples: number; seconds: number }): LiveFrame {
  const img = liveImage(src, fitFactor(src.width, src.height, box), curve);
  return { ...img, ...numbers };
}
