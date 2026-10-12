// Catalogue data ported from EZPackshot (https://github.com/Grohle/EZPackshot, GPL-3.0) by its author for Repackshot (MIT); values are data, the implementation is new.

// Default wear of a library material (upstream `wear_defaults`): the family
// table, then substrate colours derived from the material's own colour, then
// the patina colour of its category, then the adjustments of the preset.

import { materialPreset } from '../data/materials';
import {
  WEAR_CATEGORY_DEFAULTS,
  WEAR_PAINTED,
  WEAR_PATINA_BY_CATEGORY,
  WEAR_PRESET_OVERRIDES,
  WEAR_PROP_DEFAULTS,
} from '../data/wear';
import type { RGBA, WearPatch, WearProps } from '../data/types';

/** Moves a colour towards white by `t` (0 keeps it, 1 is white). Alpha is 1. */
export function lighten(color: readonly number[], t: number): RGBA {
  const c = [...color.slice(0, 3), 1.0];
  while (c.length < 4) c.push(1.0);
  return [c[0] + (1 - c[0]) * t, c[1] + (1 - c[1]) * t, c[2] + (1 - c[2]) * t, 1];
}

/** Moves a colour towards black by `t` (0 keeps it, 1 is black). Alpha is 1. */
export function darken(color: readonly number[], t: number): RGBA {
  const c = color.slice(0, 3);
  while (c.length < 3) c.push(0.0);
  return [c[0] * (1 - t), c[1] * (1 - t), c[2] * (1 - t), 1];
}

function withPatch(base: WearProps, patch: WearPatch): WearProps {
  return { ...base, ...patch };
}

/** Colour used for the bare metal under chipped paint. */
const BARE_METAL: RGBA = [0.6, 0.6, 0.62, 1];

/**
 * The wear a library material comes out with. Starts from the table of its
 * category, derives the edge substrate from the material's own colour (lighter
 * and smoother metal, bare metal under paint, lighter wood or plastic), sets
 * the patina colour of the category and finishes with the preset's own
 * adjustments. `refSize` is the size of the part in metres. Emitters get a
 * master amount of 0. Returns null for an unknown preset.
 */
export function wearDefaults(presetKey: string, refSize?: number): WearProps | null {
  const preset = materialPreset(presetKey);
  if (preset === undefined) return null;
  const { category, family, params } = preset;

  let out = withPatch(WEAR_PROP_DEFAULTS, WEAR_CATEGORY_DEFAULTS[category]);
  if (refSize) out = { ...out, refSize: Math.max(refSize, 1e-3) };
  if (family === 'EMISSIVE') return { ...out, amount: 0 };

  const base = params.baseColor ?? params.woodColor1 ?? params.threadColor1 ?? [0.8, 0.8, 0.8, 1];
  const metallic = params.metallic ?? 0;

  if (WEAR_PAINTED.has(presetKey)) {
    // Paint chips off at the edge and bare metal shows.
    out = {
      ...out,
      edgeColor: BARE_METAL,
      edgeMetal: 1,
      edgeRough: 0.3,
      scratchColor: BARE_METAL,
    };
  } else if (category === 'METAL' || metallic > 0.5) {
    // Worn metal at the edge is the same metal, polished by rubbing: lighter
    // and smoother. The groove of a scratch is freshly exposed metal too:
    // lighter still.
    out = {
      ...out,
      edgeColor: lighten(base, 0.3),
      edgeMetal: 1,
      edgeRough: 0.18,
      scratchColor: lighten(base, 0.45),
    };
  } else if (family === 'WOOD') {
    out = {
      ...out,
      edgeColor: lighten(base, 0.35),
      edgeMetal: 0,
      edgeRough: 0.55,
      scratchColor: lighten(base, 0.3),
    };
  } else {
    // In plastic, leather or ceramic a scratch is a darker line: the broken
    // surface stops reflecting like the rest.
    out = {
      ...out,
      edgeColor: lighten(base, 0.35),
      edgeMetal: 0,
      edgeRough: 0.5,
      scratchColor: darken(base, 0.45),
    };
  }

  out = { ...out, patinaColor: WEAR_PATINA_BY_CATEGORY[category] };
  return withPatch(out, WEAR_PRESET_OVERRIDES[presetKey] ?? {});
}
