// The pixels a plugin is given and gives back (ROADMAP P6, abi.ts): a finished result at the preview's width or at
// its own size, as linear planes (from an EXR's float light, no 8-bit round trip) or as 8-bit RGBA (a PNG's or a
// JPEG's display bytes), and the source's alpha put back on what the plugin answers. Pure.

import { byteToLinear, linearToByte } from './ai-image';
import type { ResultMeta } from './results';

/** The box of source pixels output pixel `i` of `n` covers along a side of `size`. */
function span(i: number, n: number, size: number): [number, number] {
  const a = Math.floor((i * size) / n);
  return [a, Math.max(a + 1, Math.floor(((i + 1) * size) / n))];
}

/** 8-bit straight RGBA scaled down to W × H by averaging in linear light (alpha averaged as it is). */
export function downscaleRgba8(src: ArrayLike<number>, w: number, h: number, W: number, H: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(W * H * 4);
  if (W === w && H === h) {
    for (let i = 0; i < out.length; i++) out[i] = src[i];
    return out;
  }
  for (let Y = 0; Y < H; Y++) {
    const [y0, y1] = span(Y, H, h);
    for (let X = 0; X < W; X++) {
      const [x0, x1] = span(X, W, w);
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = 4 * (y * w + x);
          r += byteToLinear(src[i]);
          g += byteToLinear(src[i + 1]);
          b += byteToLinear(src[i + 2]);
          a += src[i + 3];
        }
      }
      const k = (x1 - x0) * (y1 - y0);
      const o = 4 * (Y * W + X);
      out[o] = linearToByte(r / k);
      out[o + 1] = linearToByte(g / k);
      out[o + 2] = linearToByte(b / k);
      out[o + 3] = Math.round(a / k);
    }
  }
  return out;
}

/** Interleaved linear RGB (an EXR's three channels) as the plugin's planes (red, green, blue), scaled to W × H. */
export function linearPlanes(rgb: ArrayLike<number>, w: number, h: number, W: number, H: number): Float32Array {
  const n = W * H;
  const out = new Float32Array(3 * n);
  for (let Y = 0; Y < H; Y++) {
    const [y0, y1] = W === w && H === h ? [Y, Y + 1] : span(Y, H, h);
    for (let X = 0; X < W; X++) {
      const [x0, x1] = W === w && H === h ? [X, X + 1] : span(X, W, w);
      let r = 0;
      let g = 0;
      let b = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = 3 * (y * w + x);
          r += rgb[i];
          g += rgb[i + 1];
          b += rgb[i + 2];
        }
      }
      const k = (x1 - x0) * (y1 - y0);
      const o = Y * W + X;
      out[o] = r / k;
      out[n + o] = g / k;
      out[2 * n + o] = b / k;
    }
  }
  return out;
}

/** An EXR's premultiplied light made straight with the alpha of its display image (8 bits). */
export function unpremultiply(rgb: Float32Array, alpha: ArrayLike<number> | null): Float32Array {
  if (!alpha) return rgb;
  const out = new Float32Array(rgb.length);
  for (let i = 0, n = rgb.length / 3; i < n; i++) {
    const a = alpha[4 * i + 3] / 255;
    const k = a > 0 && a < 1 ? 1 / a : 1;
    out[3 * i] = rgb[3 * i] * k;
    out[3 * i + 1] = rgb[3 * i + 1] * k;
    out[3 * i + 2] = rgb[3 * i + 2] * k;
  }
  return out;
}

/** Whether an RGBA image has a pixel that is not opaque. */
export function hasAlpha(rgba: ArrayLike<number>): boolean {
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i] !== 255) return true;
  return false;
}

/** The plugin's answer with the source's alpha back on it (a plugin's pixels are colour; the cut-out stays the render's). */
export function withAlpha(rgba8: Uint8ClampedArray, source: ArrayLike<number>): Uint8ClampedArray {
  if (!hasAlpha(source)) return rgba8;
  const out = new Uint8ClampedArray(rgba8);
  for (let i = 3; i < out.length; i += 4) out[i] = source[i];
  return out;
}

/**
 * The result a plugin works on: the one open in the results viewer, else the newest; a result a plugin made gives
 * the one it was made from while that is still in the history (a plugin over its own picture would stack).
 */
export function pluginSource(results: readonly Pick<ResultMeta, 'id' | 'provenance'>[], viewing: string | null): string | null {
  const pick = (viewing ? results.find((r) => r.id === viewing) : undefined) ?? results[0];
  if (!pick) return null;
  const from = pick.provenance?.from;
  return from && results.some((r) => r.id === from) ? from : pick.id;
}
