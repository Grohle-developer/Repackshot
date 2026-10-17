// Measuring focus with a click on the engine's own image (phase F1): a project state is rendered by the real rt.wasm in
// Node (tests/wasm-engine.ts), with the exact depth and circle-of-confusion passes, and the image is searched for where
// it is locally sharpest. Used by the measurement (tests/focus-measure.test.ts, REPACK_FOCUS_MEASURE=1) and by the
// regression tests of F1.
//
// - `renderFocus` renders the final frame (no viewport) or the Full view's image (a viewport of view.w × view.h CSS
//   pixels, one image pixel per CSS pixel, as the Full view renders at a device pixel ratio of 1).
// - `sharpness` is the local energy of the luminance's Laplacian (the checker's edges), averaged over a small window.
// - `sharpPeak` follows the depth's gradient through a pixel (the depth pass, finite differences) and finds where the
//   sharpness peaks along that line, averaged across it: the distance from the pixel to the peak is how far the sharp
//   band is from it, in image pixels, signed (positive: deeper).

import { passMask } from '../src/core/passes';
import { projectScene, writeRsb, type SceneView } from '../src/io/rsb';
import type { ProjectState } from '../src/core/store';
import { loadRt, renderWithPasses, resolveRgb, type Rt } from './wasm-engine';

export interface FocusImage {
  width: number;
  height: number;
  /** Linear RGB, row-major from the top left. */
  rgb: Float32Array;
  depth: Float32Array;
  coc: Float32Array;
  /** The engine's camera of the image (what was written to the RSB). */
  focusDist: number;
}

let rt: Rt | null = null;
export async function engine(): Promise<Rt> {
  rt ??= await loadRt();
  return rt;
}

/**
 * Renders `state`: the final frame at the render size, or with `view` the Full view's image of a viewport of that size
 * (its pixels are the CSS pixels). `samples` per pixel, direct light only (the board is lit by the flat environment).
 */
export async function renderFocus(state: ProjectState, opts: { view?: { w: number; h: number }; samples?: number; scene?: Partial<SceneView> } = {}): Promise<FocusImage> {
  const r = await engine();
  const width = opts.view ? opts.view.w : state.render.width;
  const height = opts.view ? opts.view.h : state.render.height;
  const view: SceneView = {
    width,
    height,
    maxSamples: opts.samples ?? 32,
    maxSeconds: 0,
    maxDepth: 1,
    passes: ['depth', 'coc'],
    ...(opts.view ? { viewport: { viewW: opts.view.w, viewH: opts.view.h } } : {}),
    ...(opts.scene ?? {}),
  };
  const { scene } = projectScene(state, view);
  const rsb = writeRsb(scene, { meshes: true });
  const samples = opts.samples ?? 32;
  const { image, passes } = renderWithPasses(r, rsb, width, height, samples, passMask(['depth', 'coc']));
  return { width, height, rgb: resolveRgb(image, samples), depth: passes.depth!, coc: passes.coc!, focusDist: scene.camera.focusDist };
}

/** Luminance of linear RGB. */
function luma(rgb: Float32Array, i: number): number {
  return 0.2126 * rgb[i * 3] + 0.7152 * rgb[i * 3 + 1] + 0.0722 * rgb[i * 3 + 2];
}

/** The local energy of the Laplacian of the luminance, averaged over a (2r+1)² window; 0 at the border. */
export function sharpness(img: FocusImage, r = 2): Float32Array {
  const { width: w, height: h } = img;
  const lap = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const v = 4 * luma(img.rgb, i) - luma(img.rgb, i - 1) - luma(img.rgb, i + 1) - luma(img.rgb, i - w) - luma(img.rgb, i + w);
      lap[i] = v * v;
    }
  }
  const out = new Float32Array(w * h);
  for (let y = r + 1; y < h - r - 1; y++) {
    for (let x = r + 1; x < w - r - 1; x++) {
      let s = 0;
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) s += lap[(y + dy) * w + x + dx];
      out[y * w + x] = s / ((2 * r + 1) * (2 * r + 1));
    }
  }
  return out;
}

/** Bilinear read of a plane at (x, y) (pixel centres at integer + 0.5); NaN outside. */
function sample(plane: Float32Array, w: number, h: number, x: number, y: number): number {
  const fx = x - 0.5;
  const fy = y - 0.5;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  if (x0 < 0 || y0 < 0 || x0 + 1 >= w || y0 + 1 >= h) return NaN;
  const tx = fx - x0;
  const ty = fy - y0;
  const a = plane[y0 * w + x0];
  const b = plane[y0 * w + x0 + 1];
  const c = plane[(y0 + 1) * w + x0];
  const d = plane[(y0 + 1) * w + x0 + 1];
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
}

/** The depth pass at image point (x, y), image pixels (bilinear between pixel centres). */
export function depthAt(img: FocusImage, x: number, y: number): number {
  return sample(img.depth, img.width, img.height, x, y);
}

/** The circle of confusion at image point (x, y), pixels (the thin lens's, X2). */
export function cocAt(img: FocusImage, x: number, y: number): number {
  return sample(img.coc, img.width, img.height, x, y);
}

/**
 * Where the sharpness peaks along the depth's gradient through image point (x, y): the signed distance from the point
 * to the peak in image pixels (positive towards greater depth), the depth there, and the sharpness profile. Null when
 * the line leaves the board or the board is not sharp anywhere near.
 */
export function sharpPeak(img: FocusImage, sharp: Float32Array, x: number, y: number, reach = 60, across = 6): { offsetPx: number; depthMm: number; contrast: number } | null {
  const { width: w, height: h } = img;
  const d0 = depthAt(img, x, y);
  const gx = depthAt(img, x + 2, y) - depthAt(img, x - 2, y);
  const gy = depthAt(img, x, y + 2) - depthAt(img, x, y - 2);
  const g = Math.hypot(gx, gy);
  if (!Number.isFinite(d0) || !(g > 0)) return null;
  const ux = gx / g;
  const uy = gy / g;
  // Across the line: the band runs along the iso-depth direction, so the sharpness is averaged that way.
  const vx = -uy;
  const vy = ux;
  const prof: { t: number; s: number }[] = [];
  for (let t = -reach; t <= reach; t += 0.5) {
    let sum = 0;
    let n = 0;
    for (let k = -across; k <= across; k++) {
      const v = sample(sharp, w, h, x + ux * t + vx * k, y + uy * t + vy * k);
      if (Number.isFinite(v)) {
        sum += v;
        n++;
      }
    }
    if (n > across) prof.push({ t, s: sum / n });
  }
  if (prof.length < 10) return null;
  // Smoothed over ±3 px, then the peak and a parabola through it and its neighbours.
  const sm = prof.map((p, i) => {
    let s = 0;
    let n = 0;
    for (let j = Math.max(0, i - 6); j <= Math.min(prof.length - 1, i + 6); j++) {
      s += prof[j].s;
      n++;
    }
    return { t: p.t, s: s / n };
  });
  let best = 0;
  for (let i = 1; i < sm.length; i++) if (sm[i].s > sm[best].s) best = i;
  let t = sm[best].t;
  if (best > 0 && best < sm.length - 1) {
    const a = sm[best - 1].s;
    const b = sm[best].s;
    const c = sm[best + 1].s;
    const den = a - 2 * b + c;
    if (den < 0) t += (0.5 * 0.5 * (a - c)) / den;
  }
  const min = Math.min(...sm.map((p) => p.s));
  const contrast = min > 0 ? sm[best].s / min : Infinity;
  return { offsetPx: t, depthMm: depthAt(img, x + ux * t, y + uy * t), contrast };
}

/** An 8-bit sRGB RGBA copy of the image (for a look at it). */
export function toRgba8(img: FocusImage, exposure = 1): Uint8Array {
  const out = new Uint8Array(img.width * img.height * 4);
  for (let i = 0; i < img.width * img.height; i++) {
    for (let c = 0; c < 3; c++) {
      const v = Math.min(1, Math.max(0, img.rgb[i * 3 + c] * exposure));
      const s = v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
      out[i * 4 + c] = Math.round(s * 255);
    }
    out[i * 4 + 3] = 255;
  }
  return out;
}
