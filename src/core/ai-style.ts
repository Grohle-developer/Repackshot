// The styles' own grades (X6, AI-POST.md §3.2 step 4): the mirror of engine/crates/rt-post/src/style.rs for the
// synthetic service and the interface. Before X6 a style was only words for the model; now each one is also a colour
// grade the guard applies itself, deterministic and the same for any model: a tint of the shadows, a tint of the
// highlights and a contrast between them, as a scene log gain per channel that follows the low band of the luminance
// (a smooth gain, so edges, texture and focus are kept). tests/ai-style.test.ts reads the Rust table and checks that
// the two are the same. Provisional values (◆, ROADMAP X6).

import type { AiStyle } from './ai';

/** One style's grade at amount 1: scene log gain per channel. */
export interface StyleGrade {
  shadow: readonly [number, number, number];
  highlight: readonly [number, number, number];
  contrast: number;
}

/** The grades of the styles (`GRADES` of rt-post's style.rs, in the order of AI_STYLES). */
export const STYLE_GRADES: Readonly<Record<AiStyle, StyleGrade>> = {
  NATURAL: { shadow: [0.06, 0.05, 0.04], highlight: [-0.07, -0.07, -0.07], contrast: 0 },
  CATALOGUE: { shadow: [0.12, 0.12, 0.13], highlight: [0.03, 0.03, 0.04], contrast: -0.04 },
  EDITORIAL: { shadow: [-0.05, -0.03, 0.01], highlight: [0.03, 0.02, -0.01], contrast: 0.08 },
  WARM: { shadow: [0.08, 0.02, -0.08], highlight: [0.12, 0.04, -0.1], contrast: 0 },
  COOL: { shadow: [-0.07, 0, 0.09], highlight: [-0.09, 0, 0.12], contrast: 0 },
  CINEMATIC: { shadow: [-0.08, 0.02, 0.08], highlight: [0.1, 0.03, -0.08], contrast: 0.1 },
};

/** What a band control does at 100 to the model's change in its band (`BAND_GAIN_AT_100` of rt-post): 50 is as made. */
export const BAND_GAIN_AT_100 = 2;
/** Where the shadows end and the highlights begin, in the low band's display value (`luminance^(1/2.2)`). */
export const SHADOW_END = 0.2;
export const HIGHLIGHT_START = 0.8;

/** The share of the highlight tint at a low-band display luminance (display-linear), 0..1. */
export function highlightShare(lum: number): number {
  const v = Math.pow(Math.max(0, lum), 1 / 2.2);
  const t = Math.max(0, Math.min(1, (v - SHADOW_END) / (HIGHLIGHT_START - SHADOW_END)));
  return t * t * (3 - 2 * t);
}

/** The grade's scene log gain at a low-band luminance `lum`, at `amount`. */
export function styleGainAt(g: StyleGrade, lum: number, amount: number): [number, number, number] {
  const t = highlightShare(lum);
  const c = g.contrast * (2 * t - 1);
  return [0, 1, 2].map((k) => amount * (g.shadow[k] * (1 - t) + g.highlight[k] * t + c) + 0) as [number, number, number];
}

/** The amount of a style's grade: twice Style strength over 100, times the Intervention's fraction (and a retry's). */
export function styleAmount(styleStrength: number, scale: number): number {
  return (BAND_GAIN_AT_100 * Math.max(0, Math.min(100, styleStrength))) / 100 * scale;
}
