// The synthetic AI service (phase X4): an `AiPostService` with no model, for tests, screenshots and for
// the interface to be built against until the real pipeline (X3c) is connected. It is deterministic: the same
// request gives the same pixels. What it does is deliberately mild and shaped like the real thing:
//
//   - Light lifts the shadows and rolls the highlights off, Bounces warm the low frequencies, Style tints
//     the picture, Wear adds nothing (a synthetic service has no micro-detail to invent), and the seed
//     only wobbles the gain a little, so "Another variation" shows something.
//   - Every change is a smooth gain on the engine image (original × gain, the shading-transfer rule of
//     AI-POST.md §3.2), so edges, textures and the depth-of-field blur are kept by construction.
//   - A control at 0 leaves its aspect alone, and with every aspect at 0 (or Intervention 0) the image
//     comes back bit for bit.
//   - The studio floor (FLOOR_ID in both ids, X3c) is a surface like a material: it is relit and has its own
//     colour check, named "Floor"; only the background (0) never changes. The request's material table names
//     the others.
//   - The guard's report is measured on what it did (size, pixels outside the objects, edge displacement,
//     high-band SSIM, per-tile sharpness, ΔE₀₀ per material) and the retry rule of §7.2 applies: a result
//     that fails its limits is tried again at RETRY_FACTOR of the strength, up to MAX_ATTEMPTS, and when none
//     passes the engine image is delivered unchanged and the verdict is REJECTED.

import { MAX_ATTEMPTS, RETRY_FACTOR, type AiPipelineSettings, type AiPostProgress, type AiPostRequest, type AiPostResult, type AiPostService, type AiRuntimeStatus, type AiStyle, type GuardCheck, type GuardMaterialCheck, type GuardReport, type LinearImage } from '../core/ai';
import { luminance } from '../core/ai-image';
import { FLOOR_ID, type RenderPasses } from '../core/passes';
import { AI_MODELS } from '../data/ai-models';
import { deltaE2000, linearRgbToLab } from './color';

/** `GuardReport.modelKey` of this service. */
export const SYNTHETIC_MODEL_KEY = 'SYNTHETIC';
/** `GuardReport.runtime` of this service. */
export const SYNTHETIC_RUNTIME = 'synthetic';

/** The limits the synthetic guard checks against: the factory values of Settings ▸ AI post-processing ▸ Advanced. */
export interface SyntheticLimits {
  /** Mean ΔE₀₀ per material region. */
  deltaEMean: number;
  /** 95th percentile ΔE₀₀ per material region. */
  deltaEP95: number;
  /** Edge displacement at id discontinuities, pixels. */
  edgePx: number;
  /** SSIM of the high band, a floor. */
  detail: number;
  /** Per-tile sharpness deviation, |ln(after / before)|. */
  focus: number;
}

export const SYNTHETIC_LIMITS: Readonly<SyntheticLimits> = { deltaEMean: 2, deltaEP95: 3, edgePx: 2, detail: 0.9, focus: 0.25 };

export interface SyntheticOptions {
  limits?: Partial<SyntheticLimits>;
  /** A clock in milliseconds (default `performance.now`), for the report's seconds. */
  now?: () => number;
  /** Waits this long (milliseconds) before answering, so a screenshot can catch the "Updating…" state. */
  delayMs?: number;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const sq = (v: number): number => v * v;
const f = Math.fround;

// ------------------------------------------------------------------ the change

/** How much of each aspect applies, 0..1, after Intervention (and a retry's reduction) has scaled it. */
export interface Weights {
  light: number;
  bounce: number;
  style: number;
}

/** Wear has no weight: the synthetic service adds no micro-detail. */
export function weightsOf(s: AiPipelineSettings, scale = 1): Weights {
  const pct = (v: number) => Math.max(0, Math.min(100, v)) / 100;
  const e = pct(s.intervention) * scale;
  return {
    light: pct(s.light) * e,
    bounce: pct(s.bounce) * e,
    style: s.style === 'NATURAL' ? 0 : pct(s.styleStrength) * e,
  };
}

/** Warm light bounced between surfaces: more red, a little more green, less blue, strongest in the shadows. */
const BOUNCE_WARMTH: readonly [number, number, number] = [0.12, 0.04, -0.08];

/** A style's tint of the shadows and of the highlights, per channel, at full strength. */
const STYLE_TINT: Readonly<Record<AiStyle, { shadow: readonly [number, number, number]; light: readonly [number, number, number] }>> = {
  NATURAL: { shadow: [0, 0, 0], light: [0, 0, 0] },
  CATALOGUE: { shadow: [0.02, 0.02, 0.02], light: [0.04, 0.04, 0.04] },
  EDITORIAL: { shadow: [-0.04, -0.03, -0.02], light: [0.03, 0.02, 0] },
  WARM: { shadow: [0.06, 0.02, -0.05], light: [0.08, 0.02, -0.07] },
  COOL: { shadow: [-0.05, 0, 0.07], light: [-0.06, 0, 0.08] },
  CINEMATIC: { shadow: [-0.06, 0.02, 0.06], light: [0.08, 0.01, -0.06] },
};

/** Separable box blur twice over (a soft bell), edges clamped: the low-frequency luminance the gains follow. */
export function softLuminance(img: LinearImage, radius: number): Float32Array {
  const { width: w, height: h, rgba } = img;
  const cur = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) cur[i] = luminance(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]);
  const tmp = new Float32Array(w * h);
  const pass = (src: Float32Array, dst: Float32Array, horizontal: boolean): void => {
    const len = horizontal ? w : h;
    const lines = horizontal ? h : w;
    const r = Math.max(1, Math.min(radius, len - 1));
    const at = (line: number, k: number): number => src[horizontal ? line * w + k : k * w + line];
    for (let line = 0; line < lines; line++) {
      let acc = 0;
      for (let k = -r; k <= r; k++) acc += at(line, Math.max(0, Math.min(len - 1, k)));
      for (let k = 0; k < len; k++) {
        dst[horizontal ? line * w + k : k * w + line] = acc / (2 * r + 1);
        acc += at(line, Math.min(len - 1, k + r + 1)) - at(line, Math.max(0, k - r));
      }
    }
  };
  for (let n = 0; n < 2; n++) {
    pass(cur, tmp, true);
    pass(tmp, cur, false);
  }
  return cur;
}

/** The blur radius for an image: about 3 % of the long side, at least 3 pixels. */
function blurRadius(w: number, h: number): number {
  return Math.max(3, Math.round(Math.max(w, h) * 0.03));
}

function hash2(ix: number, iy: number, seed: number): number {
  let x = Math.imul(ix | 0, 374761393) ^ Math.imul(iy | 0, 668265263) ^ Math.imul(seed | 0, 2246822519);
  x = Math.imul(x ^ (x >>> 13), 1274126177);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

/** Smooth value noise in -1..1 over a coarse grid, a function of the seed. */
function wobble(x: number, y: number, w: number, h: number, seed: number): number {
  const cell = Math.max(8, Math.max(w, h) / 4);
  const gx = x / cell;
  const gy = y / cell;
  const ix = Math.floor(gx);
  const iy = Math.floor(gy);
  const fx = gx - ix;
  const fy = gy - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const top = hash2(ix, iy, seed) + (hash2(ix + 1, iy, seed) - hash2(ix, iy, seed)) * sx;
  const bottom = hash2(ix, iy + 1, seed) + (hash2(ix + 1, iy + 1, seed) - hash2(ix, iy + 1, seed)) * sx;
  return (top + (bottom - top) * sy) * 2 - 1;
}

/**
 * The synthetic change: `input × gain`, a smooth gain per channel from the aspects' weights. With no weight
 * the pixels are copied untouched. Pixels the passes call background (`partId` 0) are left as they are when
 * the passes say so. The same input, weights and seed always give the same output.
 */
export function applySynthetic(input: LinearImage, passes: RenderPasses | null, w: Weights, style: AiStyle, seed: number): LinearImage {
  const out: LinearImage = { width: input.width, height: input.height, rgba: new Float32Array(input.rgba) };
  const any = Math.max(w.light, w.bounce, w.style);
  if (!(any > 0)) return out;
  const { width, height, rgba } = input;
  const lum = softLuminance(input, blurRadius(width, height));
  const mask = passes?.partId && passes.partId.length === width * height ? passes.partId : null;
  const tint = STYLE_TINT[style] ?? STYLE_TINT.NATURAL;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      if (mask && mask[p] === 0) continue;
      const l = lum[p];
      // Light: lifts the shadows (up to +50 %) and rolls the highlights off (down to -12 %).
      const light = 1 + w.light * (0.5 * sq(1 - clamp01(l / 0.45)) - 0.12 * sq(clamp01((l - 0.6) / 0.4)));
      const shade = 1 - clamp01(l / 0.6);
      const mood = clamp01(l / 0.8);
      const wob = 1 + 0.03 * any * wobble(x, y, width, height, seed);
      for (let c = 0; c < 3; c++) {
        const bounce = 1 + w.bounce * shade * BOUNCE_WARMTH[c];
        const styled = 1 + w.style * ((1 - mood) * tint.shadow[c] + mood * tint.light[c]);
        const gain = f(light * bounce * styled * wob);
        out.rgba[p * 4 + c] = f(rgba[p * 4 + c] * gain);
      }
    }
  }
  return out;
}

// ------------------------------------------------------------------ the measures

const TILE = 32;

function lumaOf(img: LinearImage): Float32Array {
  const y = new Float32Array(img.width * img.height);
  for (let i = 0; i < y.length; i++) y[i] = luminance(img.rgba[i * 4], img.rgba[i * 4 + 1], img.rgba[i * 4 + 2]);
  return y;
}

/** Pixels that changed where the passes say there is no object. */
export function pixelsOutside(before: LinearImage, after: LinearImage, passes: RenderPasses | null): number {
  const mask = passes?.partId;
  if (!mask || mask.length !== before.width * before.height) return 0;
  let n = 0;
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] !== 0) continue;
    for (let c = 0; c < 4; c++) if (!Object.is(before.rgba[i * 4 + c], after.rgba[i * 4 + c])) n++;
  }
  return n;
}

/**
 * Worst displacement, in pixels, of the luminance profile around an id discontinuity, before against after.
 * The steps of luminance within two pixels of the discontinuity are matched against the picture after, shifted
 * by -3..3 pixels along the normal of the edge; the shift that fits best is how far the edge went (the smallest
 * on a tie). A discontinuity with no real step in the picture before says nothing about where an edge went and
 * is left out. Without an id pass there are no edges to check and the answer is 0.
 */
export function edgeDisplacement(yBefore: Float32Array, yAfter: Float32Array, width: number, height: number, passes: RenderPasses | null): number {
  const ids = passes?.partId;
  if (!ids || ids.length !== width * height) return 0;
  let worst = 0;
  const FAINT = 0.01;
  const REACH = 2;
  const SHIFT = 3;
  /** The steps of luminance at offsets -n..n from the discontinuity along (dx, dy); 0 outside the picture. */
  const steps = (y: Float32Array, x0: number, y0: number, dx: number, dy: number, n: number): number[] => {
    const out: number[] = [];
    for (let k = -n; k <= n; k++) {
      const x = x0 + k * dx;
      const yy = y0 + k * dy;
      out.push(x < 0 || yy < 0 || x + dx >= width || yy + dy >= height ? 0 : Math.abs(y[(yy + dy) * width + x + dx] - y[yy * width + x]));
    }
    return out;
  };
  const compare = (x: number, y: number, dx: number, dy: number) => {
    const before = steps(yBefore, x, y, dx, dy, REACH);
    if (Math.max(...before) < FAINT) return;
    const after = steps(yAfter, x, y, dx, dy, REACH + SHIFT);
    let bestShift = 0;
    let bestCost = Infinity;
    for (const shift of [0, -1, 1, -2, 2, -3, 3]) {
      let cost = 0;
      for (let k = 0; k < before.length; k++) cost += Math.abs(before[k] - after[k + SHIFT + shift]);
      if (cost < bestCost - 1e-12) {
        bestCost = cost;
        bestShift = shift;
      }
    }
    worst = Math.max(worst, Math.abs(bestShift));
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const id = ids[y * width + x];
      if (x + 1 < width && ids[y * width + x + 1] !== id) compare(x, y, 1, 0);
      if (y + 1 < height && ids[(y + 1) * width + x] !== id) compare(x, y, 0, 1);
    }
  }
  return worst;
}

/** SSIM of the high band (luminance minus its soft blur), computed over the whole image. */
export function highBandSsim(before: LinearImage, after: LinearImage): number {
  const radius = blurRadius(before.width, before.height);
  const band = (img: LinearImage): Float32Array => {
    const low = softLuminance(img, radius);
    const y = lumaOf(img);
    for (let i = 0; i < y.length; i++) y[i] -= low[i];
    return y;
  };
  const a = band(before);
  const b = band(after);
  const n = a.length;
  let ma = 0;
  let mb = 0;
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < n; i++) {
    ma += a[i];
    mb += b[i];
    lo = Math.min(lo, a[i]);
    hi = Math.max(hi, a[i]);
  }
  ma /= n;
  mb /= n;
  let va = 0;
  let vb = 0;
  let cov = 0;
  for (let i = 0; i < n; i++) {
    va += sq(a[i] - ma);
    vb += sq(b[i] - mb);
    cov += (a[i] - ma) * (b[i] - mb);
  }
  va /= n;
  vb /= n;
  cov /= n;
  const range = Math.max(1e-3, hi - lo);
  const c1 = sq(0.01 * range);
  const c2 = sq(0.03 * range);
  return ((2 * ma * mb + c1) * (2 * cov + c2)) / ((ma * ma + mb * mb + c1) * (va + vb + c2));
}

/** Mean absolute Laplacian over the mean luminance of a tile: sharpness that does not follow a plain brightness change. */
function tileSharpness(y: Float32Array, width: number, height: number, tx: number, ty: number): number | null {
  const x0 = tx * TILE;
  const y0 = ty * TILE;
  const x1 = Math.min(width, x0 + TILE);
  const y1 = Math.min(height, y0 + TILE);
  let lap = 0;
  let mean = 0;
  let n = 0;
  for (let yy = Math.max(1, y0); yy < Math.min(height - 1, y1); yy++) {
    for (let xx = Math.max(1, x0); xx < Math.min(width - 1, x1); xx++) {
      const c = y[yy * width + xx];
      lap += Math.abs(4 * c - y[yy * width + xx - 1] - y[yy * width + xx + 1] - y[(yy - 1) * width + xx] - y[(yy + 1) * width + xx]);
      mean += c;
      n++;
    }
  }
  if (n < 4) return null;
  return lap / n / (mean / n + 1e-4);
}

/** Worst |ln(sharpness after / before)| over the tiles that have some sharpness to keep. */
export function sharpnessDeviation(yBefore: Float32Array, yAfter: Float32Array, width: number, height: number): number {
  let worst = 0;
  for (let ty = 0; ty * TILE < height; ty++) {
    for (let tx = 0; tx * TILE < width; tx++) {
      const a = tileSharpness(yBefore, width, height, tx, ty);
      const b = tileSharpness(yAfter, width, height, tx, ty);
      if (a === null || b === null || a < 1e-4) continue;
      worst = Math.max(worst, Math.abs(Math.log(Math.max(b, 1e-9) / a)));
    }
  }
  return worst;
}

/** The name of a material region in the report: the request's table, "Floor" for the studio floor, else its number. */
export function regionName(id: number, materials?: readonly { materialId: number; name: string }[]): string {
  const named = materials?.find((m) => m.materialId === id);
  if (named) return named.name;
  return id === FLOOR_ID ? 'Floor' : `Material ${id}`;
}

/** ΔE₀₀ per material region (pixels of the same `materialId`, the floor's included), mean and 95th percentile over a regular sample of at most 65 536 pixels each. */
export function materialDeltas(before: LinearImage, after: LinearImage, passes: RenderPasses | null, limits: SyntheticLimits, materials?: readonly { materialId: number; name: string }[]): GuardMaterialCheck[] {
  const ids = passes?.materialId;
  if (!ids || ids.length !== before.width * before.height) return [];
  const regions = new Map<number, number[]>();
  for (let i = 0; i < ids.length; i++) {
    if (ids[i] === 0) continue;
    let list = regions.get(ids[i]);
    if (!list) regions.set(ids[i], (list = []));
    list.push(i);
  }
  const out: GuardMaterialCheck[] = [];
  const labA = [0, 0, 0];
  const labB = [0, 0, 0];
  for (const id of [...regions.keys()].sort((x, y) => x - y)) {
    const pixels = regions.get(id)!;
    const step = Math.max(1, Math.ceil(pixels.length / 65536));
    const des: number[] = [];
    for (let k = 0; k < pixels.length; k += step) {
      const p = pixels[k] * 4;
      linearRgbToLab(before.rgba[p], before.rgba[p + 1], before.rgba[p + 2], labA);
      linearRgbToLab(after.rgba[p], after.rgba[p + 1], after.rgba[p + 2], labB);
      des.push(deltaE2000(labA[0], labA[1], labA[2], labB[0], labB[1], labB[2]));
    }
    des.sort((x, y) => x - y);
    const mean = des.reduce((s, v) => s + v, 0) / des.length;
    const p95 = des[Math.min(des.length - 1, Math.floor(0.95 * (des.length - 1)))];
    out.push({ materialId: id, name: regionName(id, materials), deltaEMean: mean, deltaEP95: p95, limit: limits.deltaEMean, ok: mean <= limits.deltaEMean && p95 <= limits.deltaEP95 });
  }
  return out;
}

interface Measured {
  size: GuardCheck;
  outside: GuardCheck;
  edges: GuardCheck;
  detail: GuardCheck;
  focus: GuardCheck;
  materials: GuardMaterialCheck[];
  ok: boolean;
}

function measure(before: LinearImage, after: LinearImage, passes: RenderPasses | null, limits: SyntheticLimits, names?: readonly { materialId: number; name: string }[]): Measured {
  const sameSize = before.width === after.width && before.height === after.height;
  const size: GuardCheck = { ok: sameSize, value: sameSize ? 1 : 0, limit: 1 };
  const outsideN = pixelsOutside(before, after, passes);
  const outside: GuardCheck = { ok: outsideN === 0, value: outsideN, limit: 0 };
  const yBefore = lumaOf(before);
  const yAfter = lumaOf(after);
  const edgeN = edgeDisplacement(yBefore, yAfter, before.width, before.height, passes);
  const edges: GuardCheck = { ok: edgeN <= limits.edgePx, value: edgeN, limit: limits.edgePx };
  const ssim = highBandSsim(before, after);
  const detail: GuardCheck = { ok: ssim >= limits.detail, value: ssim, limit: limits.detail };
  const dev = sharpnessDeviation(yBefore, yAfter, before.width, before.height);
  const focus: GuardCheck = { ok: dev <= limits.focus, value: dev, limit: limits.focus };
  const materials = materialDeltas(before, after, passes, limits, names);
  return { size, outside, edges, detail, focus, materials, ok: size.ok && outside.ok && edges.ok && detail.ok && focus.ok && materials.every((m) => m.ok) };
}

function whyNot(m: Measured): string {
  const bad: string[] = [];
  if (!m.size.ok) bad.push('size');
  if (!m.outside.ok) bad.push(`${m.outside.value} pixels changed outside the objects`);
  if (!m.edges.ok) bad.push(`edges moved ${m.edges.value} px (limit ${m.edges.limit})`);
  if (!m.detail.ok) bad.push(`high-band SSIM ${m.detail.value.toFixed(3)} (floor ${m.detail.limit})`);
  if (!m.focus.ok) bad.push(`sharpness changed by ${m.focus.value.toFixed(2)} (limit ${m.focus.limit})`);
  for (const mat of m.materials) if (!mat.ok) bad.push(`${mat.name} ΔE00 mean ${mat.deltaEMean.toFixed(2)} / p95 ${mat.deltaEP95.toFixed(2)}`);
  return bad.join('; ');
}

// ------------------------------------------------------------------ the service

const aborted = (): DOMException => new DOMException('aborted', 'AbortError');

/** The synthetic service. Its `status()` is always `available`, backend `SYNTHETIC`, and it needs no model. */
export function createSyntheticService(opts: SyntheticOptions = {}): AiPostService {
  const limits: SyntheticLimits = { ...SYNTHETIC_LIMITS, ...opts.limits };
  const now = opts.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  return {
    async status(): Promise<AiRuntimeStatus> {
      return { available: true, backend: 'SYNTHETIC', device: 'Synthetic', supports: AI_MODELS.models.map((m) => m.key), activeModel: SYNTHETIC_MODEL_KEY };
    },

    async post(request: AiPostRequest, onProgress: (p: AiPostProgress) => void, signal: AbortSignal): Promise<AiPostResult> {
      const t0 = now();
      const check = () => {
        if (signal.aborted) throw aborted();
      };
      // The bar is split by attempts (`at` is where in the attempt, 0..1); a retry says why the last one was sent back.
      const report = (stage: AiPostProgress['stage'], fraction: number, attempt: number, reason?: string) =>
        onProgress({ stage, tile: 1, tiles: 1, attempt, maxAttempts: MAX_ATTEMPTS, ...(reason ? { reason } : {}), fraction });
      const at = (attempt: number, within: number) => (attempt - 1 + within) / MAX_ATTEMPTS;
      if (request.source.kind !== 'INLINE') throw new Error('the synthetic service takes INLINE sources only');
      const { image, passes } = request.source;
      const s = request.settings;
      check();
      report('CONDITIONING', at(1, 0.1), 1);
      if (opts.delayMs && opts.delayMs > 0) await new Promise<void>((resolve) => setTimeout(resolve, opts.delayMs));
      check();

      const base = { modelKey: SYNTHETIC_MODEL_KEY, runtime: SYNTHETIC_RUNTIME, seed: s.seed };
      const copy = (): LinearImage => ({ width: image.width, height: image.height, rgba: new Float32Array(image.rgba) });
      const asked = weightsOf(s);
      // Nothing asked: the very same pixels, without a pass over them.
      if (!(Math.max(asked.light, asked.bounce, asked.style) > 0)) {
        const m = measure(image, image, passes, limits, request.materials);
        report('GUARD', 1, 1);
        return { image: copy(), report: { verdict: 'ACCEPTED', usedFraction: 1, attempts: 1, size: m.size, outside: m.outside, edges: m.edges, detail: m.detail, focus: m.focus, materials: m.materials, ...base, seconds: Math.max(0, (now() - t0) / 1000) } };
      }

      let scale = 1;
      let last: Measured | null = null;
      let sentBack: string | undefined;
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        report(attempt === 1 ? 'INFERENCE' : 'RETRY', at(attempt, 0.3), attempt, sentBack);
        const out = applySynthetic(image, passes, weightsOf(s, scale), s.style, s.seed);
        check();
        report('GUARD', at(attempt, 0.9), attempt, sentBack);
        const m = measure(image, out, passes, limits, request.materials);
        last = m;
        if (m.ok) {
          const verdict = attempt === 1 ? 'ACCEPTED' : 'LIMITED';
          const rep: GuardReport = { verdict, usedFraction: scale, attempts: attempt, size: m.size, outside: m.outside, edges: m.edges, detail: m.detail, focus: m.focus, materials: m.materials, ...base, seconds: Math.max(0, (now() - t0) / 1000) };
          if (verdict === 'LIMITED') rep.reason = `limited to ${Math.round(scale * 100)} % of the asked strength after ${attempt - 1} retries`;
          return { image: out, report: rep };
        }
        sentBack = whyNot(m);
        scale = f(scale * RETRY_FACTOR);
      }
      // No attempt passed: the engine image, unchanged, with the reason.
      const m = last!;
      return {
        image: copy(),
        report: { verdict: 'REJECTED', usedFraction: 0, attempts: MAX_ATTEMPTS, size: m.size, outside: m.outside, edges: m.edges, detail: m.detail, focus: m.focus, materials: m.materials, reason: whyNot(m), ...base, seconds: Math.max(0, (now() - t0) / 1000) },
      };
    },
  };
}
