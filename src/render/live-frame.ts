// U14: the picture of a render in progress for the queue's live view (core/live-frame.ts). The accumulated RGBA sums
// are scaled down by a whole factor with a box filter: each output pixel is the mean of the pixels of its k × k box
// that have samples, each pixel first divided by its own count (mid-pass, the pool's tiles have different counts;
// the launcher's frames have one count for the whole image), its colour still premultiplied by its coverage. Then it
// is converted for display with the render's exposure and curve through the viewport's fast DisplayCurve: a picture
// to watch, not the render's exact bytes (the file is converted exactly at the end, as before).

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
 * The picture of `src` scaled down by `k` (≥ 1, a whole number) and converted with `curve`: 8-bit straight RGBA,
 * `ceil(width / k) × ceil(height / k)`. Boxes with no sampled pixel are transparent.
 */
export function liveImage(src: LiveSums, k: number, curve: DisplayCurve): { width: number; height: number; rgba: Uint8ClampedArray } {
  const { sum, width, height } = src;
  const s = Math.max(1, Math.floor(k));
  const out = scaledSize(width, height, s);
  const rgba = new Uint8ClampedArray(out.width * out.height * 4);
  // 1 / samples by tile (or once): a pixel's mean is its sums times the reciprocal of its count, as Film::resolve.
  const tile = Math.max(1, src.tile ?? TILE);
  const perTile = typeof src.samples !== 'number';
  const cols = perTile ? Math.ceil(width / tile) : 1;
  const counts = perTile ? (src.samples as Int32Array) : Int32Array.of(src.samples as number);
  const inv = new Float32Array(counts.length);
  for (let i = 0; i < counts.length; i++) inv[i] = counts[i] > 0 ? Math.fround(1 / counts[i]) : 0;
  const colTile = new Int32Array(width);
  if (perTile) for (let x = 0; x < width; x++) colTile[x] = Math.floor(x / tile);
  for (let oy = 0; oy < out.height; oy++) {
    const y0 = oy * s;
    const y1 = Math.min(height, y0 + s);
    for (let ox = 0; ox < out.width; ox++) {
      const x0 = ox * s;
      const x1 = Math.min(width, x0 + s);
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (let y = y0; y < y1; y++) {
        const rowTile = perTile ? Math.floor(y / tile) * cols : 0;
        let p = (y * width + x0) * 4;
        for (let x = x0; x < x1; x++, p += 4) {
          const w = inv[rowTile + colTile[x]];
          if (w === 0) continue;
          r += sum[p] * w;
          g += sum[p + 1] * w;
          b += sum[p + 2] * w;
          a += sum[p + 3] * w;
          n++;
        }
      }
      const o = (oy * out.width + ox) * 4;
      if (n === 0) continue;
      r /= n;
      g /= n;
      b /= n;
      a /= n;
      // Straight colour for the curve where the background shows through (tiles.ts `meanAt`).
      if (a < OPAQUE) {
        if (a > 0) {
          r /= a;
          g /= a;
          b /= a;
        } else r = g = b = 0;
      }
      curve.pixel(r, g, b, rgba, o);
      rgba[o + 3] = alphaByte(a);
    }
  }
  return { width: out.width, height: out.height, rgba };
}

/**
 * The live view's picture of a render: `src` fitted in `box` (a whole factor; a launcher frame already scaled comes
 * in at its size and is fitted again only if it is still too big), with the engine's numbers.
 */
export function liveFrameOf(src: LiveSums, box: FrameBox, curve: DisplayCurve, numbers: { renderWidth: number; renderHeight: number; samples: number; seconds: number }): LiveFrame {
  const img = liveImage(src, fitFactor(src.width, src.height, box), curve);
  return { ...img, ...numbers };
}
