// The catalogue of ambient effects (phase S4a, ROADMAP S0 and S4a): particles of the air that need no cache,
// evaluated by the engine's own simulator (engine/crates/rt-sim) from the parameters below. The keys are stable
// (rule 7: added, never renamed); `code` is the `kind` the RSB `FXAM` section carries.
//
// PROPOSAL: every value of `values` and of `material` is a starting point proposed by the implementation, not a
// decision. The lead sets the final ones from the contact sheet `out/ambient-sheet.html` (rule 11). The three S5
// effects (volumes: haze, light shafts, ground fog) are listed, greyed and marked "coming soon": they have no
// values yet.

import type { Label, RGB } from './types';

export type EffectKind =
  | 'DUST_MOTES'
  | 'POLLEN'
  | 'RAIN'
  | 'SNOW'
  | 'DUST_CLOUD'
  | 'ASH'
  | 'BUBBLES'
  | 'CONFETTI'
  | 'HAZE'
  | 'LIGHT_SHAFTS'
  | 'GROUND_FOG';

export type EffectShape = 'SPHERE' | 'DISC' | 'CAPSULE';

/**
 * The engine's material of an effect (the RSB `MATL` fields it uses): `GLASS` is a clear dielectric (`ior`,
 * `transmission`), `SURFACE` the principled surface; `thin` makes the clear part a thin wall.
 */
export interface EffectMaterial {
  kind: 'SURFACE' | 'GLASS';
  baseColor: RGB;
  roughness: number;
  ior: number;
  transmission: number;
  /** Absorption distance of the clear part, mm (0: none). */
  absorptionMm: number;
  thin: boolean;
}

/** The parameters of an effect that a preset sets (core/effects.ts `AmbientEffect` holds them, and more). */
export interface EffectValues {
  /** Particles per cubic metre of the region (or of the cloud). */
  density: number;
  /** Mean diameter, mm, and its relative variation. */
  sizeMm: number;
  sizeVar: number;
  shape: EffectShape;
  /** Speed a particle is born with, m/s, in a random direction (it relaxes to its fall). */
  energy: number;
  /** Turbulence strength as a share of its scale (the Chaos knob), the scale in mm and the speed of change in m/s. */
  chaos: number;
  turbulenceScaleMm: number;
  turbulenceSpeed: number;
  /** Wind: speed in m/s and the direction it blows towards, degrees (0: +X, 90: +Y). */
  windSpeed: number;
  windDirDeg: number;
  /** Terminal fall speed at 1 g, m/s, its relative variation, and gravity as a multiple of g (negative rises). */
  fallSpeed: number;
  fallVar: number;
  gravity: number;
  /** Turns per second of a disc. */
  spin: number;
  /** Capsule length as the distance travelled in this many seconds. */
  streak: number;
  /** Cloud envelope (0: the region box is filled): radius as a multiple of the part size, and its softness 0..1. */
  cloudRadius: number;
  cloudSoftness: number;
  /** Per-particle tint variation 0..1, and the tints a particle picks from (empty: the material's colour). */
  tintVar: number;
  palette: readonly RGB[];
  /** Seen by camera rays, in reflections, casting shadows. */
  camera: boolean;
  reflections: boolean;
  shadows: boolean;
}

export interface EffectPreset {
  key: EffectKind;
  /** The `FXAM.kind` code. */
  code: number;
  label: Label;
  /** One line of what it is for. */
  intent: Label;
  /** S5: listed, not available yet (a volume, after E9b). */
  soon?: boolean;
  /** PROPOSAL (see the file's head). Absent on the S5 effects. */
  values?: EffectValues;
  material?: EffectMaterial;
}

const surface = (baseColor: RGB, roughness: number, extra: Partial<EffectMaterial> = {}): EffectMaterial => ({
  kind: 'SURFACE',
  baseColor,
  roughness,
  ior: 1.5,
  transmission: 0,
  absorptionMm: 0,
  thin: false,
  ...extra,
});

const BASE: Omit<EffectValues, 'density' | 'sizeMm' | 'shape'> = {
  sizeVar: 0.4,
  energy: 0,
  chaos: 0.2,
  turbulenceScaleMm: 120,
  turbulenceSpeed: 0.02,
  windSpeed: 0,
  windDirDeg: 0,
  fallSpeed: 0.3,
  fallVar: 0.4,
  gravity: 1,
  spin: 0,
  streak: 0,
  cloudRadius: 0,
  cloudSoftness: 0.5,
  tintVar: 0.2,
  palette: [],
  camera: true,
  reflections: true,
  shadows: true,
};

// PROPOSAL: the values below (see the file's head). The densities are photographic, not physical: the region is the
// product's box with its margin (or the cloud's sphere), a few litres around the product, and the camera sees no
// more than that; on the example bottle (12.7 l of region, a 1.6 l cloud) they give about 1 900 dust motes, 500
// grains of pollen, 250 drops of rain, 150 snowflakes, 4 900 grains of dust in the cloud, 190 flakes of ash,
// 130 bubbles and 60 pieces of confetti.
export const EFFECT_PRESETS: readonly EffectPreset[] = [
  {
    key: 'DUST_MOTES',
    code: 1,
    label: { en: 'Dust motes', es: 'Motas de polvo' },
    intent: { en: 'Specks floating in the air; a light behind the product makes them glow in its beam.', es: 'Motas que flotan en el aire; un foco detrás del producto las hace brillar en su haz.' },
    values: { ...BASE, density: 150_000, sizeMm: 0.2, sizeVar: 0.6, shape: 'SPHERE', energy: 0.02, chaos: 0.3, turbulenceScaleMm: 80, windSpeed: 0.02, gravity: 0.05, tintVar: 0.3, shadows: false },
    material: surface([0.8, 0.78, 0.74], 0.35),
  },
  {
    key: 'POLLEN',
    code: 2,
    label: { en: 'Pollen', es: 'Polen' },
    intent: { en: 'Yellowish grains drifting slowly, for spring and garden scenes.', es: 'Granos amarillentos que derivan despacio, para escenas de primavera y jardín.' },
    values: { ...BASE, density: 40_000, sizeMm: 0.3, sizeVar: 0.4, shape: 'SPHERE', energy: 0.03, chaos: 0.4, windSpeed: 0.05, windDirDeg: 20, fallSpeed: 0.2, gravity: 0.1, tintVar: 0.3, shadows: false },
    material: surface([0.85, 0.66, 0.22], 0.6),
  },
  {
    key: 'RAIN',
    code: 3,
    label: { en: 'Rain', es: 'Lluvia' },
    intent: { en: 'Falling drops as short streaks of water, slanted by the wind.', es: 'Gotas que caen como estelas cortas de agua, inclinadas por el viento.' },
    values: { ...BASE, density: 20_000, sizeMm: 1.2, sizeVar: 0.4, shape: 'CAPSULE', chaos: 0.05, turbulenceScaleMm: 300, windSpeed: 1, fallSpeed: 6.5, fallVar: 0.2, streak: 0.012, tintVar: 0, shadows: false },
    material: { kind: 'GLASS', baseColor: [1, 1, 1], roughness: 0, ior: 1.33, transmission: 1, absorptionMm: 0, thin: false },
  },
  {
    key: 'SNOW',
    code: 4,
    label: { en: 'Snow', es: 'Nieve' },
    intent: { en: 'Slow, tumbling flakes for winter and outdoor gear.', es: 'Copos lentos que giran, para invierno y material de exterior.' },
    values: { ...BASE, density: 12_000, sizeMm: 4, sizeVar: 0.5, shape: 'DISC', chaos: 0.3, turbulenceScaleMm: 200, turbulenceSpeed: 0.05, windSpeed: 0.4, windDirDeg: 30, fallSpeed: 1, fallVar: 0.3, spin: 0.5, tintVar: 0.1 },
    material: surface([0.92, 0.93, 0.95], 0.55, { transmission: 0.3, thin: true }),
  },
  {
    key: 'DUST_CLOUD',
    code: 5,
    label: { en: 'Dust cloud', es: 'Polvareda' },
    intent: { en: 'A cloud of dust around the base, as if the product had just landed.', es: 'Una nube de polvo alrededor de la base, como si el producto acabara de aterrizar.' },
    values: { ...BASE, density: 3_000_000, sizeMm: 0.3, sizeVar: 0.6, shape: 'SPHERE', energy: 0.3, chaos: 0.8, turbulenceScaleMm: 60, turbulenceSpeed: 0.05, windSpeed: 0.2, fallSpeed: 0.1, gravity: 0.2, cloudRadius: 0.6, cloudSoftness: 0.6, tintVar: 0.3, shadows: false },
    material: surface([0.55, 0.46, 0.36], 0.8),
  },
  {
    key: 'ASH',
    code: 6,
    label: { en: 'Ash', es: 'Ceniza' },
    intent: { en: 'Dark flakes drifting down, for dramatic and industrial moods.', es: 'Copos oscuros que bajan a la deriva, para ambientes dramáticos e industriales.' },
    values: { ...BASE, density: 15_000, sizeMm: 1.5, sizeVar: 0.6, shape: 'DISC', chaos: 0.5, turbulenceScaleMm: 150, turbulenceSpeed: 0.05, windSpeed: 0.3, windDirDeg: 200, fallSpeed: 0.4, spin: 0.8, tintVar: 0.4, shadows: false },
    material: surface([0.09, 0.085, 0.08], 0.85),
  },
  {
    key: 'BUBBLES',
    code: 7,
    label: { en: 'Rising bubbles', es: 'Burbujas que suben' },
    intent: { en: 'Clear bubbles rising around the product, for drinks and cosmetics.', es: 'Burbujas transparentes que suben alrededor del producto, para bebidas y cosmética.' },
    values: { ...BASE, density: 10_000, sizeMm: 2.5, sizeVar: 0.6, shape: 'SPHERE', energy: 0.05, chaos: 0.3, turbulenceScaleMm: 100, fallSpeed: 0.25, fallVar: 0.4, gravity: -1, tintVar: 0, shadows: false },
    material: { kind: 'GLASS', baseColor: [1, 1, 1], roughness: 0, ior: 1.33, transmission: 1, absorptionMm: 0, thin: true },
  },
  {
    key: 'CONFETTI',
    code: 8,
    label: { en: 'Falling confetti', es: 'Confeti que cae' },
    intent: { en: 'Paper flakes in a few colours, tumbling down for launches and celebrations.', es: 'Papelitos de unos pocos colores que caen girando, para lanzamientos y celebraciones.' },
    values: {
      ...BASE,
      density: 5_000,
      sizeMm: 8,
      sizeVar: 0.3,
      shape: 'DISC',
      chaos: 0.4,
      turbulenceScaleMm: 200,
      turbulenceSpeed: 0.1,
      windSpeed: 0.3,
      windDirDeg: 330,
      fallSpeed: 0.8,
      fallVar: 0.4,
      spin: 1.5,
      tintVar: 0.15,
      palette: [
        [0.85, 0.12, 0.15],
        [0.95, 0.7, 0.1],
        [0.1, 0.35, 0.85],
        [0.15, 0.65, 0.3],
      ],
    },
    material: surface([0.9, 0.9, 0.9], 0.5),
  },
  {
    key: 'HAZE',
    code: 9,
    label: { en: 'Haze', es: 'Calima' },
    intent: { en: 'Air that glows where the light crosses it (a volume: phase S5).', es: 'Aire que brilla donde lo cruza la luz (un volumen: fase S5).' },
    soon: true,
  },
  {
    key: 'LIGHT_SHAFTS',
    code: 10,
    label: { en: 'Light shafts', es: 'Haces de luz' },
    intent: { en: 'Visible beams of light through the air (a volume: phase S5).', es: 'Haces de luz visibles en el aire (un volumen: fase S5).' },
    soon: true,
  },
  {
    key: 'GROUND_FOG',
    code: 11,
    label: { en: 'Ground fog', es: 'Niebla baja' },
    intent: { en: 'A low, soft layer of fog over the floor (a volume: phase S5).', es: 'Una capa baja y suave de niebla sobre el suelo (un volumen: fase S5).' },
    soon: true,
  },
];

/** The presets that can be added now (the S5 ones are listed as coming soon). */
export const AVAILABLE_EFFECTS: readonly EffectPreset[] = EFFECT_PRESETS.filter((p) => !p.soon);

export function effectPreset(key: string): EffectPreset | undefined {
  return EFFECT_PRESETS.find((p) => p.key === key);
}

export function isEffectKind(key: unknown): key is EffectKind {
  return typeof key === 'string' && EFFECT_PRESETS.some((p) => p.key === key);
}
