// The fabrics a cloth is made of (phase S9, ROADMAP S9): presets by fabric type and weight per area, with what the
// simulator needs of each (engine/crates/rt-phys `cloth`): its mass per area, its membrane stiffness against stretching,
// its bending rigidity, the damping of its motion, the distance at which it collides (Thickness) and its friction. The
// keys are stable (rule 7: added, never renamed). How the fabric looks is its material (M5), not this table.
//
// The values are this phase's proposals for the lead's verdict (rule 11, ◆ in the ROADMAP's S9): the weights are the
// usual ones of each fabric; the stiffness and bending are of the order of the published measurements of fabrics
// (Kawabata's KES-F: bending rigidity from a few thousandths of a gf·cm²/cm for a light silk to tens for a leather, 1 gf·cm²/cm being
// 9.8·10⁻⁵ N·m), chosen so that the drape of each reads as that fabric on the contact sheet (out/cloth-sheet.html); the
// collision thickness is at least a millimetre, so the cloth never draws into the surface it rests on.
//
// SILK and LEATHER_THICK are also the fabrics of the engine's tests (rt_phys::example `SILK`, `LEATHER_THICK`): the
// fixture tests/fixtures/cloth-fabrics.json carries the engine's values, and tests/cloth.test.ts checks they agree.

import type { Label } from './types';

export type FabricKey =
  | 'SILK'
  | 'COTTON_FINE'
  | 'POPLIN'
  | 'LINEN'
  | 'WOOL'
  | 'DENIM'
  | 'CANVAS'
  | 'FELT'
  | 'LEATHER_THIN'
  | 'LEATHER_THICK'
  | 'NEOPRENE';

export interface FabricPreset {
  key: FabricKey;
  label: Label;
  /** Weight, grams per square metre (the usual way a fabric is sold). */
  weightGsm: number;
  /** Membrane stiffness against stretching, N/m (force per metre of width for a strain of 1). */
  stretch: number;
  /** Bending rigidity, N·m. */
  bend: number;
  /** Damping of its motion, 1/s. */
  damping: number;
  /** Distance at which it collides, mm. */
  thicknessMm: number;
  /** Coulomb friction against what it touches. */
  friction: number;
}

export const FABRIC_PRESETS: readonly FabricPreset[] = [
  { key: 'SILK', label: { en: 'Silk', es: 'Seda' }, weightGsm: 60, stretch: 2000, bend: 3e-7, damping: 0.6, thicknessMm: 1, friction: 0.3 },
  { key: 'COTTON_FINE', label: { en: 'Fine cotton', es: 'Algodón fino' }, weightGsm: 120, stretch: 3000, bend: 5e-6, damping: 0.8, thicknessMm: 1, friction: 0.5 },
  { key: 'POPLIN', label: { en: 'Poplin', es: 'Popelina' }, weightGsm: 150, stretch: 4000, bend: 8e-6, damping: 0.8, thicknessMm: 1, friction: 0.5 },
  { key: 'LINEN', label: { en: 'Linen', es: 'Lino' }, weightGsm: 200, stretch: 5000, bend: 2e-5, damping: 1, thicknessMm: 1, friction: 0.55 },
  { key: 'WOOL', label: { en: 'Wool', es: 'Lana' }, weightGsm: 300, stretch: 2500, bend: 3e-5, damping: 1.2, thicknessMm: 1.5, friction: 0.6 },
  { key: 'DENIM', label: { en: 'Denim', es: 'Vaquero' }, weightGsm: 400, stretch: 8000, bend: 1e-4, damping: 1.2, thicknessMm: 1.5, friction: 0.6 },
  { key: 'CANVAS', label: { en: 'Canvas', es: 'Lona' }, weightGsm: 600, stretch: 12000, bend: 3e-4, damping: 1.5, thicknessMm: 1.5, friction: 0.6 },
  { key: 'FELT', label: { en: 'Felt', es: 'Fieltro' }, weightGsm: 800, stretch: 3000, bend: 5e-4, damping: 2, thicknessMm: 3, friction: 0.7 },
  { key: 'LEATHER_THIN', label: { en: 'Thin leather', es: 'Cuero fino' }, weightGsm: 900, stretch: 10000, bend: 5e-4, damping: 1.5, thicknessMm: 2, friction: 0.6 },
  { key: 'LEATHER_THICK', label: { en: 'Thick leather', es: 'Cuero grueso' }, weightGsm: 1200, stretch: 20000, bend: 2e-3, damping: 2, thicknessMm: 3, friction: 0.6 },
  { key: 'NEOPRENE', label: { en: 'Neoprene', es: 'Neopreno' }, weightGsm: 1500, stretch: 1500, bend: 1.5e-3, damping: 2.5, thicknessMm: 3, friction: 0.8 },
];

/** The fabric a new cloth starts with. */
export const DEFAULT_FABRIC: FabricKey = 'COTTON_FINE';

/** The preset of a key (the default one for an unknown key: a project of a later version). */
export function fabricPreset(key: string | undefined): FabricPreset {
  return FABRIC_PRESETS.find((f) => f.key === key) ?? FABRIC_PRESETS.find((f) => f.key === DEFAULT_FABRIC)!;
}

/** Limits of the inspector's cloth fields. */
export const CLOTH_LIMITS = {
  /** g/m². */
  weight: { min: 10, max: 5000 },
  /** A factor on the preset's stretch and bending stiffness. */
  stiffness: { min: 0.1, max: 10 },
  /** mm. */
  thickness: { min: 0.1, max: 50 },
  /** A closed shell holds this times its rest volume (0: no pressure). */
  pressure: { min: 0, max: 3 },
  /** Target edge of the simulated sheet, mm (0: automatic). */
  resolution: { min: 0, max: 200 },
} as const;

/** What a cloth has until the inspector sets its own. */
export const CLOTH_DEFAULTS = {
  stiffness: 1,
  /** A closed shell keeps its volume: a cushion, a soft container. */
  pressure: 1,
  selfCollision: true,
  keepArea: false,
  /** The share of the cloth's height the Box anchor holds by default: the top tenth. */
  box: { min: [0, 0, 0.9] as [number, number, number], max: [1, 1, 1] as [number, number, number] },
} as const;

/**
 * How finely a cloth is simulated: its triangles are split in four (each edge at its midpoint) until the longest edge is
 * at most the resolution, or until one more split would pass `MAX_CLOTH_TRIANGLES`. Automatic resolution: the cloth's
 * longest side over `AUTO_DIVISIONS`.
 */
export const MAX_CLOTH_TRIANGLES = 9000;
export const AUTO_DIVISIONS = 64;

/** How a cloth is held: nowhere, by the vertices along its top edge, or by those in a box. */
export const CLOTH_ANCHORS = ['NONE', 'TOP_EDGE', 'BOX'] as const;
export type ClothAnchor = (typeof CLOTH_ANCHORS)[number];

/**
 * The wind on a cloth (S4a): the ambient effects' wind, summed over those switched on, with gusts from the turbulence of the
 * windiest: its Chaos times this share of the wind's speed (◆).
 */
export const GUST_PER_CHAOS = 0.5;

/** Drape over the part: a sheet this many times the footprint of the selection, this far above its top (share of its size). */
export const DRAPE_SHEET = { size: 1.6, lift: 0.08 } as const;
