// The recipe of E6's patterns from a material's parameters (phase M3c): what io/rsb.ts writes in a wood's or a
// fabric's `PATN` and what a Wood or Fabric node of a material graph compiles to (core/material-program.ts, the 25
// constants of its WOOD* and CLOTH* instructions), from the same keys in the same units: the family's parameters
// (`ringDensity` rings per 100 mm times `woodScale`, `threadCount` threads per cm, sizes in millimetres). One function
// for both, so a Wood node with a material's values draws what the material draws.

/** `PATN.kind` 1: wood (rt_core::pattern::wood). */
export const PATTERN_WOOD = 1;
/** `PATN.kind` 2: cloth (rt_core::pattern::cloth). */
export const PATTERN_CLOTH = 2;
/** `PATN.variant` of a wood: its figure (`woodFigure`; unknown: rings). */
export const WOOD_FIGURES: Readonly<Record<string, number>> = { RINGS: 0, STRIPS: 1, SPECKLE: 2, STREAKED: 3 };
/** `PATN.variant` of a cloth: its `weave` (unknown: plain). */
export const WEAVES: Readonly<Record<string, number>> = { PLAIN: 0, TWILL: 1, SATIN: 2, CANVAS: 3, KNIT: 4, FELT: 5, TWILL31: 6 };
/** Number of `PATN.params`. */
export const PATN_PARAMS = 16;
/** Rings per 100 mm of wood: `ringDensity` counts them over this length (E6, physical). */
export const WOOD_RING_SPAN_MM = 100;
/** Anisotropy of a wood's roughness along its grain (none for the grainless figures). */
export const WOOD_ANISOTROPY = 0.3;
/** Most knots of a piece of wood (rt_core::pattern::knots::MAX_KNOTS). */
export const MAX_KNOTS = 12;
/** Millimetres per cm: a fabric's `threadCount` counts threads per cm (E6, physical). */
export const CLOTH_SPAN_MM = 10;
/** Anisotropy of a woven or knitted cloth's roughness across the thread on top (felt has none). */
export const CLOTH_ANISOTROPY = 0.5;

/** A pattern's recipe as `PATN` holds it (its material aside). */
export interface PatternRecipe {
  kind: number;
  colorA: [number, number, number];
  colorB: [number, number, number];
  scaleMm: number;
  params: number[];
  variant: number;
  seed: number;
}

type Params = Readonly<Record<string, unknown>>;

const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const rgbOf = (v: unknown, d: readonly number[]): [number, number, number] =>
  Array.isArray(v) && v.length >= 3 && v.slice(0, 3).every((x) => typeof x === 'number' && Number.isFinite(x)) ? [v[0], v[1], v[2]] : [d[0], d[1], d[2]];
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
/** A seed as the engine reads it: a whole number, 0 or more. */
export const seedOf = (v: unknown): number => Math.max(0, Math.round(num(v, 0))) >>> 0;

/**
 * A wood's recipe from its parameters (the family's keys): its two colours, `ringDensity` rings per 100 mm (the ring
 * spacing `100 / ringDensity` mm times `woodScale`, whatever the part's size), contrast, variation, noises, pores and
 * figure; fibres at full strength and the roughness stretched along the grain; its knots (only woods with rings have
 * them: `knotCount` 0 elsewhere). Fallbacks are FAMILY_PARAMS' and, for the recipe-only fields, those of a
 * diffuse-porous wood.
 */
export function woodRecipe(p: Params, seed: number): PatternRecipe {
  const figure = WOOD_FIGURES[String(p.woodFigure ?? 'RINGS')] ?? 0;
  const scale = Math.min(10, Math.max(0.1, num(p.woodScale, 1)));
  return {
    kind: PATTERN_WOOD,
    colorA: rgbOf(p.woodColor1, [0.56, 0.38, 0.21]),
    colorB: rgbOf(p.woodColor2, [0.3, 0.18, 0.09]),
    scaleMm: (WOOD_RING_SPAN_MM / Math.max(1, num(p.ringDensity, 33))) * scale,
    params: [
      clamp01(num(p.ringVariation, 0.4)),
      clamp01(num(p.ringNoise, 0.3)),
      clamp01(num(p.axialNoise, 0.2)),
      clamp01(num(p.colorNoise, 0.2)),
      clamp01(num(p.ringContrast, 0.3)),
      Math.max(0, num(p.poreSize, 0.2)),
      clamp01(num(p.poreDepth, 0.3)),
      clamp01(num(p.poreBand, 0)),
      1,
      figure === WOOD_FIGURES.SPECKLE ? 0 : WOOD_ANISOTROPY,
      figure === WOOD_FIGURES.RINGS ? Math.min(MAX_KNOTS, Math.max(0, Math.round(num(p.knotCount, 0)))) : 0,
      Math.max(0, num(p.knotSize, 15)),
      clamp01(num(p.knotSizeVar, 0.3)),
      clamp01(num(p.knotDarkness, 0.6)),
      0,
      0,
    ],
    variant: figure,
    seed: seedOf(seed),
  };
}

/**
 * A fabric's recipe from its parameters: warp and weft colours, `threadCount` threads per cm (the thread spacing
 * `10 / threadCount` mm whatever the part's size), its relief, its yarn's twist (none on carbon tows and mesh) and its
 * weave; the fuzz is not drawn.
 */
export function fabricRecipe(p: Params, seed: number): PatternRecipe {
  const params = new Array<number>(PATN_PARAMS).fill(0);
  params[0] = clamp01(num(p.weaveDepth, 0.35));
  params[1] = clamp01(num(p.yarnTwist, 1));
  return {
    kind: PATTERN_CLOTH,
    colorA: rgbOf(p.threadColor1, [0.7, 0.7, 0.68]),
    colorB: rgbOf(p.threadColor2, [0.6, 0.6, 0.58]),
    scaleMm: CLOTH_SPAN_MM / Math.min(200, Math.max(2, num(p.threadCount, 40))),
    params,
    variant: WEAVES[String(p.weave ?? 'PLAIN')] ?? 0,
    seed: seedOf(seed),
  };
}

/** The 25 constants of a pattern instruction (rt_core::program::PATTERN_CONSTS): the PATN layout. */
export function recipeConsts(r: PatternRecipe): number[] {
  return [...r.colorA, ...r.colorB, r.scaleMm, ...r.params, r.variant, r.seed];
}

/** True when the recipe has a relief to bend the normal by (wood: pores, bamboo's nodes or knots asked; cloth: a relief). */
export function recipeHasRelief(r: PatternRecipe): boolean {
  if (r.kind === PATTERN_CLOTH) return r.params[0] > 0;
  return (r.params[5] > 0 && r.params[6] > 0) || r.variant === WOOD_FIGURES.STRIPS || r.params[10] > 0;
}

/** The anisotropy a recipe stretches the roughness by (a wood along its grain, a cloth across its threads). */
export function recipeAnisotropy(r: PatternRecipe): number {
  if (r.kind === PATTERN_CLOTH) return r.variant === WEAVES.FELT ? 0 : CLOTH_ANISOTROPY;
  return r.params[9];
}
