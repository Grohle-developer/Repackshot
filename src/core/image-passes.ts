// The passes of the image state (SPEC §3.6, K3): what is done to the image after the render, in a fixed order, from
// `state.image`. Today two of them are real, the exposure and the curve; the others (glow, sharpen, colour, vignette)
// are stored and come later (`image.postSoon`). Neither pass restarts a render: the engines convert their sums with
// them (render/tonemap.ts) as they show or save an image.
//
//   exposure  manual: `exposureEv` stops. Automatic (K3, INTERIORS.md §3.4): metered from the image itself, plus
//             `exposureEv` as the compensation (one dial, *Brightness (EV)*). The meter reads the linear sums of the
//             accumulation, so the same image gives the same exposure on every machine: the luminance of each pixel,
//             its log2 by the engine's own f32 function (core/f32math.ts), sorted, the darkest and brightest shares
//             left out (black corners, the windows and the lamps), the mean of the rest put at middle grey, clamped
//             and rounded to a hundredth of a stop. A preset sets the exposure by hand from a photographic EV.
//   curve     the view transform (Standard, Filmic, AgX): `RNDR.tonemap`.
//
// Pure: no DOM, no engine. The numbers are a proposal pending the decision (data/interior-camera.ts).

import {
  AUTO_EV_LIMIT,
  AUTO_EV_STEP,
  AUTO_MIDDLE_GREY,
  AUTO_TRIM_HIGH,
  AUTO_TRIM_LOW,
  EV100_AT_ZERO,
  EXPOSURE_PRESETS,
} from '../data/interior-camera';
import { f, log2 } from './f32math';
import type { ImageState } from './store';

/** The order of the passes of the image state (SPEC §3.6) and which of them are applied today. */
export const IMAGE_PASSES = ['exposure', 'bloom', 'sharpen', 'color', 'vignette', 'curve'] as const;
export type ImagePass = (typeof IMAGE_PASSES)[number];
export const APPLIED_PASSES: ReadonlySet<ImagePass> = new Set<ImagePass>(['exposure', 'curve']);

/** True when the exposure is metered from the image (K3; absent: by hand, every project of before). */
export function autoExposure(img: Pick<ImageState, 'exposureMode'>): boolean {
  return img.exposureMode === 'AUTO';
}

/** What a meter reads: the RSB sums of an accumulation (the same shape as render/frame-scan.ts `ScanSource`). */
export interface MeterSource {
  width: number;
  height: number;
  /** RGBA sums of every pixel's samples. */
  sum: Float32Array;
  /** Samples the pixel `p` has. */
  samplesAt(p: number): number;
}

/** The floor of the luminance the meter takes the log of: the black of an empty corner counts as 2^-20. */
const METER_FLOOR = f(2 ** -20);
const LUMA_R = f(0.2126);
const LUMA_G = f(0.7152);
const LUMA_B = f(0.0722);

/**
 * The automatic exposure of an image, in stops: the exposure that puts the trimmed mean of its log2 luminance at middle
 * grey (see above). Null when no pixel has a sample yet. Deterministic: f32 luminance and log, an ordered sort, a sum in
 * order.
 */
export function meterExposure(src: MeterSource): number | null {
  const n = src.width * src.height;
  const logs = new Float32Array(n);
  let k = 0;
  for (let p = 0; p < n; p++) {
    const count = src.samplesAt(p);
    if (!(count > 0)) continue;
    const inv = f(1 / count);
    const r = Math.max(0, f(src.sum[p * 4] * inv));
    const g = Math.max(0, f(src.sum[p * 4 + 1] * inv));
    const b = Math.max(0, f(src.sum[p * 4 + 2] * inv));
    let l = f(f(f(LUMA_R * r) + f(LUMA_G * g)) + f(LUMA_B * b));
    if (!Number.isFinite(l) || l < METER_FLOOR) l = METER_FLOOR;
    logs[k++] = log2(l);
  }
  if (k === 0) return null;
  const sorted = logs.subarray(0, k).sort();
  const lo = Math.floor(k * AUTO_TRIM_LOW);
  const hi = Math.max(lo + 1, k - Math.floor(k * AUTO_TRIM_HIGH));
  let sum = 0;
  for (let i = lo; i < hi; i++) sum += sorted[i];
  const mean = sum / (hi - lo);
  const ev = log2(f(AUTO_MIDDLE_GREY)) - mean;
  const clamped = Math.max(-AUTO_EV_LIMIT, Math.min(AUTO_EV_LIMIT, ev));
  const steps = Math.round(1 / AUTO_EV_STEP);
  return Math.round(clamped * steps) / steps;
}

/**
 * The exposure the image is converted with: by hand, `exposureEv`; automatic, the metered exposure plus `exposureEv`
 * (the compensation), or the compensation alone while nothing has been metered yet.
 */
export function effectiveExposure(img: Pick<ImageState, 'exposureEv' | 'exposureMode'>, metered: number | null): number {
  return autoExposure(img) ? img.exposureEv + (metered ?? 0) : img.exposureEv;
}

/** The exposure (stops) of a brightness preset: its photographic EV100 against the engine's exposure 0 (◆ proposal). */
export function presetExposure(key: string): number | null {
  const p = EXPOSURE_PRESETS.find((e) => e.key === key);
  return p ? Math.round((EV100_AT_ZERO - p.ev100) * 100) / 100 : null;
}

/**
 * The meter of a progressive image: metered again only when the image has doubled its samples since the last reading
 * (and the first time it is complete), so the exposure settles instead of flickering. A new image keeps the last reading
 * until it has its own.
 */
export class ExposureMeter {
  private source: object | null = null;
  private samples = 0;
  private value: number | null = null;

  /** The reading for `source`, which has `samples` in its least sampled pixel; `make` meters it when it is due. */
  read(source: object, samples: number, make: () => number | null): number | null {
    if (samples < 1) return this.value;
    if (source === this.source && samples < this.samples * 2) return this.value;
    const v = make();
    if (v !== null) {
      this.source = source;
      this.samples = samples;
      this.value = v;
    }
    return this.value;
  }

  /** The last reading, whatever image it came from (null: none yet). */
  get last(): number | null {
    return this.value;
  }

  clear(): void {
    this.source = null;
    this.samples = 0;
    this.value = null;
  }
}
