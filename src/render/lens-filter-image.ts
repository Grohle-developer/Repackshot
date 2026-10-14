// The effect filters of a lens in image space (phase O3a, decision 5): `(1 − s)·I + s·a·(I ⊗ K_T)` with the PSF `K`
// of rt-core `optics::filters` projected to pixels by the focal length, its tint `T` on the wide parts only (the
// diffusion's tail and the lines; the narrow core and the glimmer's sparkles stay neutral). It is an approximation of what the engine
// does in ray space (the engine sees what is outside the frame, a light behind the camera included; this sees the
// picture only): the Fast viewport draws it with WebGL (render/lens-filter-pass.ts, the same kernels), and this is
// the plain-arithmetic version, the reference those passes are tested against and what the preview's stills use.
//
//   - The narrow Gaussian is drawn at full size; the diffusions' wide Cauchy tail is a sum of four Gaussians (fitted
//     to its energy within 1 %, TAIL_FIT) blurred at a reduced size and scaled back up; the glimmer's cloud of fine
//     sparkles is the Gaussian it is drawn from (its expectation: the sparkles themselves are the engine's).
//   - The lines of the star, the streak and the net are taps along each line, to the grade's length, with the
//     weight of the 1/r falloff that tapers to the end between them.
//   - Directions: the engine turns a camera ray by +δ (right, up), so the light it brings back shows at −δ in the
//     picture: right is +x, up is −y (rows run from the top).

import { FILTER_PSF, filterS, lensFilterType, lineLengthDeg } from '../data/lens-filters';
import type { LensFilter } from '../core/optics';

/** A linear RGB picture, rows from the top. */
export interface LinearImage {
  width: number;
  height: number;
  rgb: Float32Array;
}

/** The 2-D Cauchy tail as Gaussians: widths in tail widths, and their shares (they sum to 1). */
export const TAIL_FIT: readonly { sigma: number; share: number }[] = [
  { sigma: 0.6, share: 0.3148 },
  { sigma: 1.5, share: 0.4186 },
  { sigma: 3.5, share: 0.197 },
  { sigma: 6.0, share: 0.0696 },
];

/** Taps along each line of a star, a streak or a net. */
export const LINE_TAPS = 48;

const LUMA = [0.2126, 0.7152, 0.0722];
const DEG = Math.PI / 180;

type Rgb = [number, number, number];

/** One filter's kernel in pixels: what the CPU and the GPU paths draw. */
export interface FilterKernel {
  /** Scattered fraction. */
  s: number;
  /** Gaussian parts: width in pixels, share of the scattered light and its colour weight (a, times the tint on the tail). */
  gaussians: { sigmaPx: number; share: number; weight: Rgb }[];
  /** Line parts: unit directions in the picture where a light's lines show (x right, y down), the taps (distance in pixels and weight), their share and colour weight (a·T). */
  lines: { dirs: [number, number][]; taps: { r: number; w: number }[]; share: number; weight: Rgb } | null;
}

/**
 * The kernel of filter `f` for a picture of `pxPerRadian` pixels per unit of tangent (the focal length over the
 * pixel pitch); null when it scatters nothing.
 */
export function filterKernel(f: LensFilter, pxPerRadian: number): FilterKernel | null {
  const type = lensFilterType(f.type);
  if (!type) return null;
  const s = filterS(type.key, f.grade);
  if (s <= 0) return null;
  const P = FILTER_PSF;
  const tint = type.tint ? (f.tint && f.tint.some((v) => v > 0) ? f.tint : type.tint) : [1, 1, 1];
  const lum = LUMA[0] * tint[0] + LUMA[1] * tint[1] + LUMA[2] * tint[2];
  const a = type.key === 'DIFFUSION_BLACK' ? P.blackTransmission : 1;
  const tinted: Rgb = [(a * tint[0]) / lum, (a * tint[1]) / lum, (a * tint[2]) / lum];
  const neutral: Rgb = [a, a, a];
  // The engine's deflections are tangents of a few degrees, written in radians (rt-core `deg`).
  const px = (deg: number) => deg * DEG * pxPerRadian;
  const core = px(P.sigmaCoreDeg);
  const tail = px(P.sigmaTailDeg);
  const kernel: FilterKernel = { s, gaussians: [], lines: null };
  const diffusion = type.key === 'DIFFUSION_WHITE' || type.key === 'DIFFUSION_BLACK' || type.key === 'DIFFUSION_GOLD';
  if (diffusion) {
    kernel.gaussians.push({ sigmaPx: core, share: P.coreShare, weight: neutral });
    for (const g of TAIL_FIT) kernel.gaussians.push({ sigmaPx: g.sigma * tail, share: (1 - P.coreShare) * g.share, weight: tinted });
  } else if (type.key === 'SOFT') {
    kernel.gaussians.push({ sigmaPx: core, share: 1, weight: neutral });
  } else if (type.key === 'GLIMMER') {
    const radial = 1 - P.glimmerShare;
    kernel.gaussians.push({ sigmaPx: core, share: radial * (1 - P.glimmerHaloShare), weight: neutral });
    kernel.gaussians.push({ sigmaPx: px(P.glimmerCloudDeg), share: radial * P.glimmerHaloShare, weight: neutral });
    // The sparkles: a 2-D Gaussian of the cloud's width, and the sparkle's own box (a variance of spread²/3 per axis).
    const cloud = Math.sqrt(px(P.glimmerCloudDeg) ** 2 + px(P.glimmerSigmaDeg) ** 2 / 3);
    kernel.gaussians.push({ sigmaPx: cloud, share: P.glimmerShare, weight: neutral });
  }
  if (type.key === 'STAR' || type.key === 'STREAK' || type.key === 'NET') {
    const n = type.key === 'STREAK' ? 2 : type.key === 'NET' ? 4 : f.points === 4 || f.points === 8 ? f.points : 6;
    const dirs: [number, number][] = [];
    for (let k = 0; k < n; k++) {
      const t = f.angleDeg * DEG + (2 * Math.PI * k) / n;
      dirs.push([-Math.cos(t), Math.sin(t)]);
    }
    const start = P.lineStartDeg * DEG;
    const end = lineLengthDeg(type.key, f.grade) * DEG;
    // The density (1 − r/end)/start below start and (1 − r/end)/r above it: its integral is ln(end/start) + start/(2 end).
    const total = Math.log(end / start) + start / (2 * end);
    const taps: { r: number; w: number }[] = [];
    // The first tap holds the flat part [0, start]; the others are log-spaced.
    taps.push({ r: 0.5 * start * pxPerRadian, w: (1 - start / (2 * end)) / total });
    for (let i = 0; i < LINE_TAPS; i++) {
      const r0 = start * Math.pow(end / start, i / LINE_TAPS);
      const r1 = start * Math.pow(end / start, (i + 1) / LINE_TAPS);
      taps.push({ r: Math.sqrt(r0 * r1) * pxPerRadian, w: (Math.log(r1 / r0) - (r1 - r0) / end) / total });
    }
    const share = type.key === 'NET' ? P.netAxisShare : 1;
    kernel.lines = { dirs, taps, share, weight: tinted };
    if (type.key === 'NET') kernel.gaussians.push({ sigmaPx: core, share: 1 - P.netAxisShare, weight: neutral });
  }
  return kernel;
}

/** Clamped bilinear sample of channel-interleaved `src`. */
function sample(src: Float32Array, w: number, h: number, x: number, y: number, out: number[], scale: number): void {
  const fx = Math.min(w - 1, Math.max(0, x));
  const fy = Math.min(h - 1, Math.max(0, y));
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(w - 1, x0 + 1);
  const y1 = Math.min(h - 1, y0 + 1);
  const tx = fx - x0;
  const ty = fy - y0;
  for (let c = 0; c < 3; c++) {
    const a = src[(y0 * w + x0) * 3 + c] * (1 - tx) + src[(y0 * w + x1) * 3 + c] * tx;
    const b = src[(y1 * w + x0) * 3 + c] * (1 - tx) + src[(y1 * w + x1) * 3 + c] * tx;
    out[c] += (a * (1 - ty) + b * ty) * scale;
  }
}

/** A separable Gaussian blur of width `sigma` pixels (clamped edges). */
function gaussianBlur(src: Float32Array, w: number, h: number, sigma: number): Float32Array {
  if (sigma < 0.3) return src.slice();
  const radius = Math.ceil(3 * sigma);
  const weights: number[] = [];
  let sum = 0;
  for (let i = -radius; i <= radius; i++) {
    const v = Math.exp(-(i * i) / (2 * sigma * sigma));
    weights.push(v);
    sum += v;
  }
  for (let i = 0; i < weights.length; i++) weights[i] /= sum;
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let i = -radius; i <= radius; i++) {
        const xx = Math.min(w - 1, Math.max(0, x + i));
        const k = weights[i + radius];
        const o = (y * w + xx) * 3;
        r += src[o] * k;
        g += src[o + 1] * k;
        b += src[o + 2] * k;
      }
      const o = (y * w + x) * 3;
      tmp[o] = r;
      tmp[o + 1] = g;
      tmp[o + 2] = b;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let i = -radius; i <= radius; i++) {
        const yy = Math.min(h - 1, Math.max(0, y + i));
        const k = weights[i + radius];
        const o = (yy * w + x) * 3;
        r += tmp[o] * k;
        g += tmp[o + 1] * k;
        b += tmp[o + 2] * k;
      }
      const o = (y * w + x) * 3;
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = b;
    }
  }
  return out;
}

/** The picture `factor` times smaller (box average; the last row and column take what is left). */
function shrink(src: Float32Array, w: number, h: number, factor: number): { rgb: Float32Array; w: number; h: number } {
  const sw = Math.max(1, Math.ceil(w / factor));
  const sh = Math.max(1, Math.ceil(h / factor));
  const out = new Float32Array(sw * sh * 3);
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      let n = 0;
      const acc = [0, 0, 0];
      for (let j = y * factor; j < Math.min(h, (y + 1) * factor); j++) {
        for (let i = x * factor; i < Math.min(w, (x + 1) * factor); i++) {
          const o = (j * w + i) * 3;
          acc[0] += src[o];
          acc[1] += src[o + 1];
          acc[2] += src[o + 2];
          n++;
        }
      }
      const o = (y * sw + x) * 3;
      out[o] = acc[0] / n;
      out[o + 1] = acc[1] / n;
      out[o + 2] = acc[2] / n;
    }
  }
  return { rgb: out, w: sw, h: sh };
}

/** `I ⊗ G(sigma)`: at full size up to 8 px, at a reduced size above (the tail). */
function blurAnySize(src: Float32Array, w: number, h: number, sigma: number): Float32Array {
  if (sigma <= 8) return gaussianBlur(src, w, h, sigma);
  const factor = 2 ** Math.floor(Math.log2(sigma / 4));
  const small = shrink(src, w, h, factor);
  // A box of `factor` already blurred by about factor/√12; the Gaussian adds the rest.
  const rest = Math.sqrt(Math.max(0, sigma * sigma - (factor * factor) / 12)) / factor;
  const blurred = gaussianBlur(small.rgb, small.w, small.h, rest);
  const out = new Float32Array(src.length);
  const acc = [0, 0, 0];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      acc[0] = acc[1] = acc[2] = 0;
      sample(blurred, small.w, small.h, (x + 0.5) / factor - 0.5, (y + 0.5) / factor - 0.5, acc, 1);
      const o = (y * w + x) * 3;
      out[o] = acc[0];
      out[o + 1] = acc[1];
      out[o + 2] = acc[2];
    }
  }
  return out;
}

/** `I ⊗ K` of one kernel with its colour weights (the scattered light, before s). */
export function convolve(img: LinearImage, k: FilterKernel): Float32Array {
  const { width: w, height: h, rgb } = img;
  const out = new Float32Array(rgb.length);
  for (const g of k.gaussians) {
    const b = blurAnySize(rgb, w, h, g.sigmaPx);
    for (let i = 0; i < out.length; i++) out[i] += b[i] * g.share * g.weight[i % 3];
  }
  const acc = [0, 0, 0];
  if (k.lines) {
    const per = k.lines.share / k.lines.dirs.length;
    const lw = k.lines.weight;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        acc[0] = acc[1] = acc[2] = 0;
        for (const [dx, dy] of k.lines.dirs) {
          for (const t of k.lines.taps) sample(rgb, w, h, x - dx * t.r, y - dy * t.r, acc, t.w * per);
        }
        const o = (y * w + x) * 3;
        out[o] += acc[0] * lw[0];
        out[o + 1] += acc[1] * lw[1];
        out[o + 2] += acc[2] * lw[2];
      }
    }
  }
  return out;
}

/** The filters of a camera applied to a linear picture in order, as the engine stacks them. */
export function applyLensFilters(img: LinearImage, filters: readonly LensFilter[], pxPerRadian: number): LinearImage {
  let cur = img;
  for (const f of filters) {
    const k = filterKernel(f, pxPerRadian);
    if (!k) continue;
    const scattered = convolve(cur, k);
    const out = new Float32Array(cur.rgb.length);
    for (let i = 0; i < out.length; i += 3) {
      for (let c = 0; c < 3; c++) out[i + c] = (1 - k.s) * cur.rgb[i + c] + k.s * scattered[i + c];
    }
    cur = { width: cur.width, height: cur.height, rgb: out };
  }
  return cur;
}

/** Pixels per unit of tangent of a picture `width` pixels wide on a camera of `focalMm` and a frame `frameWidthMm` wide. */
export function pixelsPerRadian(width: number, focalMm: number, frameWidthMm: number): number {
  return (focalMm / frameWidthMm) * width;
}
