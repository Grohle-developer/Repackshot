// The colour a fabric averages to. Apart from materials.ts so the material graph (which materials.ts imports) can
// use it without a cycle.

import type { MaterialParams } from '../data/types';

/**
 * The share of a fabric's face its warp (`threadColor1`) covers, by weave, as rt_core::pattern::cloth measures it:
 * a warp-faced satin and 3/1 twill show mostly warp, the rest half and half.
 */
export const WEAVE_WARP_SHARE: Readonly<Record<string, number>> = { SATIN: 0.72, TWILL31: 0.685 };

/** The mean colour of a fabric's weave (linear RGB): what the Fast preview shows and what the engine averages to. */
export function fabricMeanColor(p: MaterialParams): [number, number, number] {
  const rgb = (v: unknown, f: readonly number[]) => (Array.isArray(v) && v.length >= 3 ? (v as number[]) : f);
  const a = rgb(p.threadColor1, [0.7, 0.7, 0.68]);
  const b = rgb(p.threadColor2, [0.6, 0.6, 0.58]);
  const w = WEAVE_WARP_SHARE[String(p.weave ?? 'PLAIN')] ?? 0.5;
  return [a[0] * w + b[0] * (1 - w), a[1] * w + b[1] * (1 - w), a[2] * w + b[2] * (1 - w)];
}
