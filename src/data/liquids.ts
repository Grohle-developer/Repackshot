// Liquids (phase S7): the presets of *Convert to liquid* and of the Liquid section, with stable keys (added, never
// renamed). Each is how the liquid moves, in the simulator's terms (engine/crates/rt-phys/src/liquid: its LIQ1 scene),
// and how it looks, in the vocabulary of the GLASS family of the materials (src/data/materials.ts): a liquid that is
// already a catalogue material (milk, orange juice) takes that material's recipe, the others carry their own.
//
// The values are ◆ for the verdict (ROADMAP S7, rule 11): density and viscosity are typical published figures at
// room temperature (honey and gel at the thick end of their range, so they read as thick); cohesion, surface tension
// and adhesion are the simulator's coefficients (times gravity), chosen to keep a pour coherent at product scale.
// engine/crates/rt-cli/src/liquid_sheet.rs repeats them for the contact sheet; tests/s7-liquids.test.ts checks
// that the two agree.

import type { Label } from './types';

/** The look of a liquid: GLASS-family parameters (src/core/materials.ts `FAMILY_PARAMS.GLASS`). */
export interface LiquidLook {
  baseColor: [number, number, number, number];
  roughness: number;
  ior: number;
  transmission: number;
  absorptionMm: number;
  scatterMm?: number;
  scatterColor?: [number, number, number, number];
  scatterG?: number;
}

export interface LiquidPreset {
  key: string;
  label: Label;
  /** kg/m³ (does not change how a liquid alone moves; it is the liquid's mass for what comes later). */
  density: number;
  /** Kinematic viscosity, mm²/s (centistokes): water 1. */
  viscosity: number;
  /** Cohesion, surface tension and adhesion to the walls, times gravity (the simulator's coefficients). */
  cohesion: number;
  surfaceTension: number;
  adhesion: number;
  /** A catalogue material whose recipe it looks like (its key in src/data/materials.ts), or null: `look`. */
  material: string | null;
  look: LiquidLook | null;
}

export const LIQUID_PRESETS: readonly LiquidPreset[] = [
  {
    key: 'WATER',
    label: { en: 'Water', es: 'Agua' },
    density: 998,
    viscosity: 1,
    cohesion: 0.1,
    surfaceTension: 0.02,
    adhesion: 0.05,
    material: null,
    look: { baseColor: [0.86, 0.95, 0.97, 1], roughness: 0, ior: 1.333, transmission: 1, absorptionMm: 2000 },
  },
  {
    key: 'OIL',
    label: { en: 'Oil', es: 'Aceite' },
    density: 910,
    viscosity: 80,
    cohesion: 0.08,
    surfaceTension: 0.015,
    adhesion: 0.1,
    material: null,
    look: { baseColor: [0.82, 0.72, 0.2, 1], roughness: 0, ior: 1.467, transmission: 1, absorptionMm: 40 },
  },
  {
    key: 'HONEY',
    label: { en: 'Honey', es: 'Miel' },
    density: 1420,
    viscosity: 10000,
    cohesion: 0.3,
    surfaceTension: 0.05,
    adhesion: 0.5,
    material: null,
    look: { baseColor: [0.85, 0.47, 0.08, 1], roughness: 0, ior: 1.49, transmission: 1, absorptionMm: 25 },
  },
  {
    key: 'MILK',
    label: { en: 'Milk', es: 'Leche' },
    density: 1030,
    viscosity: 2,
    cohesion: 0.1,
    surfaceTension: 0.02,
    adhesion: 0.05,
    material: 'MILK',
    look: null,
  },
  {
    key: 'GEL',
    label: { en: 'Gel', es: 'Gel' },
    density: 1010,
    viscosity: 20000,
    cohesion: 0.4,
    surfaceTension: 0.05,
    adhesion: 0.6,
    material: null,
    look: { baseColor: [0.74, 0.9, 1, 1], roughness: 0.02, ior: 1.35, transmission: 1, absorptionMm: 60 },
  },
  {
    key: 'SYRUP',
    label: { en: 'Syrup', es: 'Sirope' },
    density: 1330,
    viscosity: 1500,
    cohesion: 0.2,
    surfaceTension: 0.04,
    adhesion: 0.3,
    material: null,
    look: { baseColor: [0.62, 0.3, 0.06, 1], roughness: 0, ior: 1.45, transmission: 1, absorptionMm: 15 },
  },
  {
    key: 'JUICE_ORANGE',
    label: { en: 'Orange juice', es: 'Zumo de naranja' },
    density: 1045,
    viscosity: 2.5,
    cohesion: 0.1,
    surfaceTension: 0.02,
    adhesion: 0.05,
    material: 'JUICE_ORANGE',
    look: null,
  },
  {
    key: 'WINE',
    label: { en: 'Red wine', es: 'Vino tinto' },
    density: 990,
    viscosity: 1.2,
    cohesion: 0.1,
    surfaceTension: 0.02,
    adhesion: 0.05,
    material: null,
    look: { baseColor: [0.55, 0.04, 0.08, 1], roughness: 0, ior: 1.34, transmission: 1, absorptionMm: 6 },
  },
];

/** The preset *Convert to liquid* uses when none is chosen. */
export const DEFAULT_LIQUID = 'WATER';

export function liquidPreset(key: string): LiquidPreset | undefined {
  return LIQUID_PRESETS.find((p) => p.key === key);
}

/**
 * The particle spacing a part is filled at when it has none of its own: the cube root of its volume over this many
 * particles (◆), within the limits below (mm).
 */
export const LIQUID_TARGET_PARTICLES = 4000;
export const LIQUID_SPACING_LIMITS = { min: 1, max: 50 } as const;

/**
 * Nested dielectrics (◆): the priority a liquid's material gets, and the one every other clear material without a
 * priority of its own counts as in a scene with a liquid (higher wins where solids overlap: the glass holds the
 * liquid, and the liquid's surface that reaches into the glass's wall is glass there).
 */
export const LIQUID_PRIORITY = 1;
export const CONTAINER_PRIORITY = 2;

/** Longest a run with a liquid goes before it stops by itself: simulated seconds (liquids do not fall asleep). */
export const MAX_LIQUID_SECONDS = 20;
