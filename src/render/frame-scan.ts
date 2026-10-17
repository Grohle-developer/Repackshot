// What the Doctor reads of the Full viewport's accumulation (phase D1, core/doctor-engine.ts `FrameScan`): the
// fireflies (isolated, very bright samples) and the frame's brightness by the stop. Pure: it reads the sums the
// page already holds (`Accumulator.sum`, and `.lum2` when the denoise keeps the squared luminance), no engine and
// no DOM, and the same sums give the same scan in any browser.
//
// A firefly is a pixel that shows one bright sample, and is told by what no honest highlight has:
//   - it is bright: its mean luminance (linear, before the exposure) is at least FIREFLY_LEVEL, so the dark
//     noise of a young image is never one;
//   - it is isolated: it is at least FIREFLY_ISOLATION times the brightest of its eight neighbours, so a glint
//     or a lamp, which light the pixels around them too, are not;
//   - when the squared luminance is kept, one sample carries at least FIREFLY_SHARE of its light. The squared
//     luminance sum bounds that share from below: lum2 / (sum of luminance)² <= (largest sample / sum), so
//     a pixel that passes has a single sample worth at least that share of all its light, which no steady
//     highlight (whose share is about 1 / samples) can have.
// The numbers are the Doctor's proposal (ROADMAP D1, pending a decision on what counts as a firefly).

import { STOP_BINS, STOPS_FROM, type FrameScan } from '../core/doctor-engine';
import { meterExposure } from '../core/image-passes';
import type { ProjectState } from '../core/store';

/** Fewest samples of every pixel before the accumulation is read: a younger image is noise and reads like fireflies. */
export const SCAN_MIN_SAMPLES = 16;
/** A firefly's mean luminance is at least this (linear; 1 is display white before the exposure). */
export const FIREFLY_LEVEL = 1;
/** ... and at least this many times the brightest of its eight neighbours. */
export const FIREFLY_ISOLATION = 4;
/** ... and, when the squared luminance is kept, one sample carries at least this share of its light. */
export const FIREFLY_SHARE = 0.5;

const LUMA_R = 0.2126;
const LUMA_G = 0.7152;
const LUMA_B = 0.0722;

/** What a scan reads: the film's sums (`Accumulator` has all of this). */
export interface ScanSource {
  width: number;
  height: number;
  /** RGBA sums of every pixel's samples (premultiplied radiance and coverage). */
  sum: Float32Array;
  /** The sums of the squared luminance of the samples, or empty when they are not kept. */
  lum2: Float32Array;
  /** Samples the pixel `p` has. */
  samplesAt(p: number): number;
}

/** The bin of the stop histogram a linear value falls in. */
export function stopBin(v: number): number {
  if (!(v > 0)) return 0;
  const bin = Math.floor(Math.log2(v)) - STOPS_FROM;
  return bin < 0 ? 0 : bin >= STOP_BINS ? STOP_BINS - 1 : bin;
}

/**
 * Reads an accumulation. `basis` is the project it was rendered from (the Doctor trusts the scan only while the
 * project gives that image). `denoised`: the sums are the denoised image (the launcher hands out only that one
 * while its live denoise is on): the fireflies were filtered out of it and are not counted.
 */
export function scanFrame(src: ScanSource, basis: ProjectState, opts: { denoised?: boolean } = {}): FrameScan {
  const { width, height, sum } = src;
  const n = width * height;
  const lum = new Float32Array(n);
  const stops = new Array<number>(STOP_BINS).fill(0);
  let fewest = Infinity;
  for (let p = 0; p < n; p++) {
    const count = src.samplesAt(p);
    if (count < fewest) fewest = count;
    if (!(count > 0)) continue;
    const inv = 1 / count;
    const r = Math.max(0, sum[p * 4] * inv);
    const g = Math.max(0, sum[p * 4 + 1] * inv);
    const b = Math.max(0, sum[p * 4 + 2] * inv);
    const l = LUMA_R * r + LUMA_G * g + LUMA_B * b;
    lum[p] = Number.isFinite(l) ? l : 0;
    const m = Math.max(r, g, b);
    stops[stopBin(Number.isFinite(m) ? m : 0)]++;
  }
  let fireflies: FrameScan['fireflies'] = null;
  if (!opts.denoised) {
    const keeps = src.lum2.length === n;
    let pixels = 0;
    let peak = 0;
    for (let y = 0; y < height; y++) {
      const y0 = Math.max(0, y - 1);
      const y1 = Math.min(height - 1, y + 1);
      for (let x = 0; x < width; x++) {
        const p = y * width + x;
        const l = lum[p];
        if (l < FIREFLY_LEVEL) continue;
        let around = 0;
        const x0 = Math.max(0, x - 1);
        const x1 = Math.min(width - 1, x + 1);
        for (let ny = y0; ny <= y1; ny++) {
          for (let nx = x0; nx <= x1; nx++) if ((nx !== x || ny !== y) && lum[ny * width + nx] > around) around = lum[ny * width + nx];
        }
        if (l < FIREFLY_ISOLATION * around) continue;
        if (keeps) {
          // The luminance summed over the samples is l * count; the share of the largest sample is at least lum2 / that squared.
          const total = l * src.samplesAt(p);
          if (!(src.lum2[p] >= FIREFLY_SHARE * total * total)) continue;
        }
        pixels++;
        if (l > peak) peak = l;
      }
    }
    fireflies = { pixels, peak };
  }
  // K3: the automatic exposure of the same sums (core/image-passes.ts), for the checks that read the exposure.
  return { basis, width, height, samples: Number.isFinite(fewest) ? fewest : 0, fireflies, stops, metered: meterExposure(src) };
}

/**
 * The scan of one accumulation, made again only when its samples have doubled (a scan reads every pixel: the
 * viewport's frame, a few milliseconds), and never before `SCAN_MIN_SAMPLES`. A new accumulation is a new scan.
 */
export class ScanCache {
  private entry: { source: object; samples: number; tag: string; scan: FrameScan } | null = null;

  /**
   * The scan for `source` having `samples` in its least sampled pixel; `make` reads it when it is due. `tag` is
   * what else the scan depends on (whether the sums are the denoised ones): another tag, another scan.
   */
  get(source: object, samples: number, make: () => FrameScan, tag = ''): FrameScan | null {
    if (samples < SCAN_MIN_SAMPLES) return null;
    const e = this.entry;
    if (e && e.source === source && e.tag === tag && samples < e.samples * 2) return e.scan;
    const scan = make();
    this.entry = { source, samples, tag, scan };
    return scan;
  }

  clear(): void {
    this.entry = null;
  }
}
