// The image aspect ratio of a camera (U13, SPEC §3.5): a preset of `data/aspects.ts` or a ratio of its own.
// Pure helpers over `{ preset, w, h }`; the reducers that use them are in `camera.ts` and `render.ts`.

import { ASPECT_PRESETS, aspectPreset, type AspectKey } from '../data/aspects';

/** A camera's output ratio: `w : h` is always the ratio; `preset` says whether it is one of the list's. */
export interface CameraAspect {
  preset: AspectKey;
  w: number;
  h: number;
}

/** 16:9, the ratio of a new camera (1920 × 1080 at the default width). */
export const DEFAULT_ASPECT: Readonly<CameraAspect> = Object.freeze({ preset: '16:9', w: 16, h: 9 });

/**
 * The most extreme ratios a camera takes: those of the most extreme sizes the render window allows (16 to 8192
 * pixels a side), 8192 × 16 and 16 × 8192, so every size that can be typed is a ratio a camera can hold.
 */
export const MAX_ASPECT_RATIO = 8192 / 16;
export const MIN_ASPECT_RATIO = 16 / 8192;
/** Largest term of a custom ratio. */
export const MAX_ASPECT_TERM = 9999;

/** The ratio width / height of an aspect. */
export function ratioOf(a: Pick<CameraAspect, 'w' | 'h'>): number {
  return a.w / a.h;
}

/** Whether two aspects are the same ratio (they may have different terms: 2:1 and 4:2). */
export function sameRatio(a: Pick<CameraAspect, 'w' | 'h'>, b: Pick<CameraAspect, 'w' | 'h'>): boolean {
  return Math.abs(ratioOf(a) / ratioOf(b) - 1) < 1e-9;
}

/** The preset's aspect. */
export function presetAspect(key: string): CameraAspect | undefined {
  const p = aspectPreset(key);
  return p ? { preset: p.key, w: p.w, h: p.h } : undefined;
}

const finitePositive = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;
const round4 = (v: number): number => Math.round(v * 1e4) / 1e4;

/** A custom aspect from two terms: positive, rounded to four decimals, the ratio kept within the limits. */
export function customAspect(w: number, h: number): CameraAspect | null {
  if (!finitePositive(w) || !finitePositive(h)) return null;
  let cw = Math.min(MAX_ASPECT_TERM, round4(w));
  let ch = Math.min(MAX_ASPECT_TERM, round4(h));
  if (!(cw > 0) || !(ch > 0)) return null;
  if (cw / ch > MAX_ASPECT_RATIO) cw = round4(ch * MAX_ASPECT_RATIO);
  else if (cw / ch < MIN_ASPECT_RATIO) ch = round4(cw / MIN_ASPECT_RATIO);
  return { preset: 'CUSTOM', w: cw, h: ch };
}

/**
 * An aspect from anything that looks like one (a hand-edited project, a library file): a known preset key gives
 * the preset's own terms, CUSTOM (or an unknown key) with usable terms gives a custom ratio, anything else
 * gives `fallback`. Pure and idempotent.
 */
export function normaliseAspect(raw: unknown, fallback: CameraAspect = DEFAULT_ASPECT): CameraAspect {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return fallback;
  const o = raw as Record<string, unknown>;
  const preset = typeof o.preset === 'string' ? presetAspect(o.preset) : undefined;
  if (preset) return preset;
  return customAspect(o.w as number, o.h as number) ?? fallback;
}

/** A custom aspect with the pixels of a size as its terms (1000 × 700 is 1000 : 700): the ratio is exact. */
export function customFromPixels(width: number, height: number): CameraAspect {
  return customAspect(Math.max(1, Math.round(width)), Math.max(1, Math.round(height))) ?? { ...DEFAULT_ASPECT };
}

/**
 * The aspect of a size saved by a project of before U13: the preset whose ratio is within `tolerance` (0.5 %) of
 * the size's, else a custom ratio with the saved pixels as its terms.
 */
export function aspectNearPixels(width: number, height: number, tolerance = 0.005): CameraAspect {
  if (!(width > 0) || !(height > 0)) return { ...DEFAULT_ASPECT };
  const ratio = width / height;
  for (const p of ASPECT_PRESETS) if (Math.abs(ratio / (p.w / p.h) - 1) <= tolerance) return { preset: p.key, w: p.w, h: p.h };
  return customFromPixels(width, height);
}

/** The ratio as short text for a line of the interface: `4:3`, or `2.39:1` when the terms are not small whole numbers. */
export function aspectText(a: Pick<CameraAspect, 'w' | 'h'>): string {
  const whole = Number.isInteger(a.w) && Number.isInteger(a.h) && a.w <= 99 && a.h <= 99;
  if (whole) return `${a.w}:${a.h}`;
  const r = ratioOf(a);
  const digits = r >= 10 ? 1 : 2;
  const value = Number(r.toFixed(digits));
  return r >= 1 ? `${value}:1` : `1:${Number((1 / r).toFixed(digits))}`;
}
