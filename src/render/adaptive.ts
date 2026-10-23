// Adaptive sampling on the page (phase E10): the port of rt_core::adaptive, bit for bit, for the
// pool's renders (the launcher runs the Rust one). After every round the image decides which 8 × 8
// blocks get the next one: each pixel's relative error of the mean, sqrt(Var / n) / (mean + ε),
// smoothed 3 × 3, the largest of its block; the blocks above the noise target (and under the
// sample cap) are the candidates, and those at or above the 50 % quantile of their errors go. A
// block that gets no round keeps its samples and its mean. Everything is f32 (Math.fround after
// every operation, in the engine's order), so the decisions are the engine's: the pool's image is
// rt's and the launcher's for the same RSB (tests/adaptive.test.ts checks the port against
// PINNED_E10_DECISIONS and the real rt.wasm against PINNED_E10_ADAPTIVE).
//
// The first round gives every pixel WARMUP samples with the plain tile renderer (sample index ==
// photon-map iteration, the exact passes and the albedo as before); later rounds render only the
// active blocks (`rt_render_block_rgba`), sample j of a pass of every block with photon map
// `iteration() + j`. Where a round is cut into passes changes no pixel.

import { exposureGain } from './tonemap';

const f = Math.fround;

/** `RNDR.adaptive` bit 0. */
export const ADAPTIVE_ON = 1;
/** Edge of the blocks. */
export const BLOCK = 8;
/** Samples of every pixel before the first decision. */
export const WARMUP = 16;
/** Samples of a round (the smallest). */
export const ROUND = 16;
/** Largest factor a round grows by when few blocks are active. */
export const MAX_ROUND_FACTOR = 16;
/** The floor of the mean, a fraction of display white before the exposure. */
export const EPSILON = f(0.01);
/** The error of an unmeasurable pixel. */
export const UNMEASURED = f(1.0e30);

const LUMA_R = f(0.2126);
const LUMA_G = f(0.7152);
const LUMA_B = f(0.0722);

/** What a decision found and chose (rt_core::adaptive::Decision). */
export interface Decision {
  /** Samples of the next round per active block (before the cap); 0: converged. */
  round: number;
  active: number;
  blocks: number;
  /** The 50 % quantile of the candidates' errors (0 without candidates). */
  threshold: number;
  /** The largest block error. */
  maxError: number;
  /** With a target: pixel-samples still needed to reach it (Infinity when unbounded); 0 without one. */
  remaining: number;
}

/** The floor ε of the mean for an exposure of `ev` stops. */
export function floorFor(ev: number): number {
  return f(EPSILON / f(exposureGain(ev)));
}

/** The relative error of the mean of one pixel (rt_core::adaptive::pixel_error). */
export function pixelError(r: number, g: number, b: number, lum2: number, n: number, floor: number): number {
  if (n < 2) return UNMEASURED;
  const inv = f(1 / n);
  const l = f(f(f(LUMA_R * f(r * inv)) + f(LUMA_G * f(g * inv))) + f(LUMA_B * f(b * inv)));
  const m2 = f(lum2 * inv);
  if (!(Number.isFinite(l) && Number.isFinite(m2))) return UNMEASURED;
  const d = f(m2 - f(l * l));
  const spread = d > 0 ? d : 0;
  const v = f(spread / f(n - 1));
  const mean = l > 0 ? l : 0;
  const e = f(f(Math.sqrt(v)) / f(mean + floor));
  return Number.isFinite(e) && e < UNMEASURED ? e : UNMEASURED;
}

/** Columns and rows of blocks of a `width × height` image. */
export function blockGrid(width: number, height: number): { cols: number; rows: number } {
  return { cols: Math.ceil(width / BLOCK), rows: Math.ceil(height / BLOCK) };
}

/**
 * The decision (rt_core::adaptive::decide): `counts` the samples of every block, `sums` `stride` floats per pixel
 * (red, green, blue first), `lum2` the squared-luminance sums, `floor` (floorFor), `target` (0: none), `cap` (0:
 * none). Writes the blocks of the next round into `active` (1 or 0).
 */
export function decide(
  width: number,
  height: number,
  counts: ArrayLike<number>,
  sums: ArrayLike<number>,
  stride: number,
  lum2: ArrayLike<number>,
  floor: number,
  target: number,
  cap: number,
  active: Uint8Array,
): Decision {
  const w = width;
  const h = height;
  const { cols, rows } = blockGrid(width, height);
  const blocks = cols * rows;
  const error = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const by = Math.floor(y / BLOCK) * cols;
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      const i = p * stride;
      error[p] = pixelError(sums[i], sums[i + 1], sums[i + 2], lum2[p], counts[by + Math.floor(x / BLOCK)], floor);
    }
  }
  const blockError = new Float32Array(blocks);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - 1);
    const y1 = Math.min(h, y + 2);
    const by = Math.floor(y / BLOCK) * cols;
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - 1);
      const x1 = Math.min(w, x + 2);
      let sum = 0;
      for (let ny = y0; ny < y1; ny++) for (let nx = x0; nx < x1; nx++) sum = f(sum + error[ny * w + nx]);
      const s = f(sum / ((y1 - y0) * (x1 - x0)));
      const b = by + Math.floor(x / BLOCK);
      if (s > blockError[b]) blockError[b] = s;
    }
  }
  const floorTarget = target > 0 ? target : 0;
  const candidate = (b: number) => blockError[b] > floorTarget && (cap === 0 || counts[b] < cap);
  let maxError = 0;
  for (let b = 0; b < blocks; b++) if (blockError[b] > maxError) maxError = blockError[b];
  let remaining = 0;
  let n = 0;
  for (let b = 0; b < blocks; b++) if (candidate(b)) n++;
  const errors = new Float32Array(n);
  n = 0;
  for (let b = 0; b < blocks; b++) {
    if (!candidate(b)) continue;
    errors[n++] = blockError[b];
    if (floorTarget > 0) {
      const ratio = f(blockError[b] / floorTarget);
      let need = f(counts[b] * f(f(ratio * ratio) - 1));
      if (cap > 0) {
        const room = cap - counts[b];
        if (need > room) need = room;
      }
      const bx = b % cols;
      const byy = Math.floor(b / cols);
      const bw = Math.min(w - bx * BLOCK, BLOCK);
      const bh = Math.min(h - byy * BLOCK, BLOCK);
      remaining = f(remaining + f(need * (bw * bh)));
    }
  }
  active.fill(0);
  if (errors.length === 0) return { round: 0, active: 0, blocks, threshold: 0, maxError, remaining };
  errors.sort();
  const threshold = errors[(errors.length - 1) >> 1];
  let count = 0;
  let least = Infinity;
  for (let b = 0; b < blocks; b++) {
    if (candidate(b) && blockError[b] >= threshold) {
      active[b] = 1;
      count++;
      least = Math.min(least, counts[b]);
    }
  }
  const factor = Math.max(1, Math.min(MAX_ROUND_FACTOR, Math.floor(blocks / (4 * count))));
  const round = Math.min(ROUND * factor, Math.max(least, ROUND));
  return { round, active: count, blocks, threshold, maxError, remaining };
}

/** The sum of `n` samples as a sum of `s` (rt_core::adaptive::rescale): itself when n == s, else (sum × (1/n)) × s. */
export function rescale(sum: number, n: number, s: number): number {
  if (n === s) return sum;
  if (n > 0) return f(f(sum * f(1 / n)) * s);
  return 0;
}

/** The samples of a pass in one block: its pixels (clipped to the image), sample indices `first .. first + count`. */
export interface BlockWork {
  block: number;
  x: number;
  y: number;
  w: number;
  h: number;
  first: number;
  count: number;
}

/** An adaptive render's state (rt_core::adaptive::Adaptive). */
export class AdaptiveState {
  readonly width: number;
  readonly height: number;
  readonly cols: number;
  readonly rows: number;
  /** Samples of every block at the start of the round. */
  readonly counts: Int32Array;
  /** The blocks of the round. */
  readonly active: Uint8Array;
  private round: number;
  private done = 0;
  private iter = 0;
  private readonly cap: number;
  private readonly target: number;
  private readonly floor: number;
  private lastDecision: Decision | null = null;

  /** A new render of `width × height` at an exposure of `ev`, with a noise `target` (a fraction; 0: none) and at most `cap` samples (0: none). */
  constructor(width: number, height: number, opts: { ev: number; target: number; cap: number }) {
    this.width = width;
    this.height = height;
    const { cols, rows } = blockGrid(width, height);
    this.cols = cols;
    this.rows = rows;
    this.counts = new Int32Array(cols * rows);
    this.active = new Uint8Array(cols * rows).fill(1);
    this.cap = Math.max(0, Math.round(opts.cap));
    this.round = this.cap > 0 ? Math.min(WARMUP, this.cap) : WARMUP;
    this.target = Math.max(0, f(opts.target));
    this.floor = floorFor(opts.ev);
  }

  /** The first round (every block, the plain tile renderer). */
  get warmingUp(): boolean {
    return this.lastDecision === null;
  }

  /** Samples of the round still to render (0: decide). */
  get left(): number {
    return this.round - this.done;
  }

  get converged(): boolean {
    return this.round === 0;
  }

  /** The photon-map iteration of the next sample of the round. */
  get iteration(): number {
    return this.iter + this.done;
  }

  get last(): Decision | null {
    return this.lastDecision;
  }

  get blocks(): number {
    return this.counts.length;
  }

  blockOf(x: number, y: number): number {
    return Math.floor(y / BLOCK) * this.cols + Math.floor(x / BLOCK);
  }

  /** Samples block `b` gets in the round. */
  quota(b: number): number {
    if (!this.active[b]) return 0;
    return this.cap > 0 ? Math.min(this.round, Math.max(0, this.cap - this.counts[b])) : this.round;
  }

  /** Samples block `b` has now. */
  samplesOf(b: number): number {
    return this.counts[b] + Math.min(this.quota(b), this.done);
  }

  /** The fewest and most samples of a pixel now. */
  minMax(): { min: number; max: number } {
    let min = Infinity;
    let max = 0;
    for (let b = 0; b < this.counts.length; b++) {
      const n = this.samplesOf(b);
      if (n < min) min = n;
      if (n > max) max = n;
    }
    return Number.isFinite(min) ? { min, max } : { min: 0, max: 0 };
  }

  /** Every block's samples now (the accumulator's counts after a pass of the round). */
  blockSamples(out: Int32Array = new Int32Array(this.counts.length)): Int32Array {
    for (let b = 0; b < this.counts.length; b++) out[b] = this.samplesOf(b);
    return out;
  }

  /** Every pixel's samples now, row by row (the denoiser's counts). */
  pixelCounts(): Float32Array {
    const out = new Float32Array(this.width * this.height);
    for (let y = 0, p = 0; y < this.height; y++) for (let x = 0; x < this.width; x++, p++) out[p] = this.samplesOf(this.blockOf(x, y));
    return out;
  }

  /** Pixel-samples a pass of `count` samples renders. */
  passCost(count: number): number {
    let total = 0;
    for (let b = 0; b < this.counts.length; b++) {
      const q = this.quota(b);
      if (q <= this.done) continue;
      const bx = b % this.cols;
      const by = Math.floor(b / this.cols);
      total += Math.min(q - this.done, count) * Math.min(this.width - bx * BLOCK, BLOCK) * Math.min(this.height - by * BLOCK, BLOCK);
    }
    return total;
  }

  /** The work of a pass of `count` samples: every active block with samples left in the round, in block order. */
  work(count: number): BlockWork[] {
    const out: BlockWork[] = [];
    if (count <= 0) return out;
    for (let b = 0; b < this.counts.length; b++) {
      const q = this.quota(b);
      if (q <= this.done) continue;
      const bx = (b % this.cols) * BLOCK;
      const by = Math.floor(b / this.cols) * BLOCK;
      out.push({ block: b, x: bx, y: by, w: Math.min(BLOCK, this.width - bx), h: Math.min(BLOCK, this.height - by), first: this.counts[b] + this.done, count: Math.min(q - this.done, count) });
    }
    return out;
  }

  /** A pass of `count` samples of the round was rendered. */
  advance(count: number): void {
    this.done = Math.min(this.done + count, this.round);
  }

  /** The round is over: the image (`sums`, `stride` floats per pixel, and `lum2`) decides the next. */
  decide(sums: ArrayLike<number>, stride: number, lum2: ArrayLike<number>): Decision {
    if (this.left !== 0) throw new Error('the round is not over');
    for (let b = 0; b < this.counts.length; b++) this.counts[b] += this.quota(b);
    this.iter += this.round;
    this.done = 0;
    const d = decide(this.width, this.height, this.counts, sums, stride, lum2, this.floor, this.target, this.cap, this.active);
    this.round = d.round;
    this.lastDecision = d;
    return d;
  }
}

/**
 * The RGBA sums of an accumulation whose pixels have their blocks' counts, each rescaled to `s` samples (the
 * launcher's frames of an adaptive image): what the display, the files and the denoiser read as sums of `s`.
 */
export function rescaledSums(sum: Float32Array, width: number, height: number, blockSamples: Int32Array, s: number, out = new Float32Array(sum.length)): Float32Array {
  const cols = Math.ceil(width / BLOCK);
  for (let y = 0, p = 0; y < height; y++) {
    const by = Math.floor(y / BLOCK) * cols;
    for (let x = 0; x < width; x++, p++) {
      const n = blockSamples[by + Math.floor(x / BLOCK)];
      for (let c = 0; c < 4; c++) out[p * 4 + c] = rescale(sum[p * 4 + c], n, s);
    }
  }
  return out;
}

/**
 * The RGBA sums of an accumulation whose tiles have their own counts, each rescaled to `s` samples: a render
 * stopped mid-pass (some tiles have the interrupted pass's samples, the rest do not) reads as sums of `s`, the
 * last completed pass's count — the same reading the launcher's frames give, which only publish whole passes.
 */
export function rescaledSumsTiles(sum: Float32Array, width: number, tiles: readonly { x: number; y: number; w: number; h: number; index: number }[], tileSamples: Int32Array, s: number, out = new Float32Array(sum.length)): Float32Array {
  for (const t of tiles) {
    const n = tileSamples[t.index];
    for (let y = 0; y < t.h; y++) {
      for (let x = 0; x < t.w; x++) {
        const p = (t.y + y) * width + (t.x + x);
        for (let c = 0; c < 4; c++) out[p * 4 + c] = rescale(sum[p * 4 + c], n, s);
      }
    }
  }
  return out;
}

/** The same for one value per pixel (the squared luminance). */
export function rescaledPlane(plane: Float32Array, width: number, height: number, blockSamples: Int32Array, s: number): Float32Array {
  const out = new Float32Array(plane.length);
  const cols = Math.ceil(width / BLOCK);
  for (let y = 0, p = 0; y < height; y++) {
    const by = Math.floor(y / BLOCK) * cols;
    for (let x = 0; x < width; x++, p++) out[p] = rescale(plane[p], blockSamples[by + Math.floor(x / BLOCK)], s);
  }
  return out;
}
