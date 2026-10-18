// How water sits on each family of material (phase S3b, ROADMAP S3 point 1): the advancing and the receding contact
// angle of water on its surface, degrees. A drop's cap takes their mean; the difference (the hysteresis) is what keeps
// a drop pinned against its weight until it is large enough to slide (Furmidge's balance, engine/crates/rt-phys
// `wet`). The keys are stable (rule 7: added, never renamed).
//
// S3c adds WOOD and FABRIC, how fast a porous family soaks a drop in (`soakMmPerS`) and how much a wet film darkens it
// (`porosity`, rt-core `weather`), and which family a part's material wets as (`wettabilityOf`, ◆): the parts take the
// table too now (engine/crates/rt-phys `wet_parts`).
//
// Every value is a typical one from the published ranges of each family, this phase's proposal for the lead's verdict
// (rule 11, ◆ in the ROADMAP's S3b). GLASS is the front glass of a camera: its mean, 60°, is the contact angle the
// front glass has drawn its drops with since S3 (data/front-glass.ts). In S3b only the front glass uses the table; the
// other families wait for the drops on the parts (S3c). `tests/s3b-wet.test.ts` checks that GLASS and DUST_REPOSE_DEG
// are the engine's parity values (rt_phys::example).

import type { Label } from './types';

export type WettabilityFamily = 'GLASS' | 'PLASTIC' | 'METAL' | 'PAPER' | 'PAINT' | 'WOOD' | 'FABRIC';

export interface Wettability {
  key: WettabilityFamily;
  label: Label;
  /** Contact angle of water advancing over the surface, degrees. */
  advancingDeg: number;
  /** Contact angle of water receding from it, degrees (at most the advancing one). */
  recedingDeg: number;
  /** S3c: how fast it soaks a drop in, mm³ per mm² of contact per second (0: never; ◆). */
  soakMmPerS: number;
  /** S3c: how much a wet film darkens it, 0..1 (the water in its pores; ◆). */
  porosity: number;
}

export const WETTABILITY: readonly Wettability[] = [
  // A lens or window glass, neither freshly cleaned nor coated against water.
  { key: 'GLASS', label: { en: 'Glass', es: 'Vidrio' }, advancingDeg: 70, recedingDeg: 50, soakMmPerS: 0, porosity: 0 },
  // Moulded polymers (ABS, polycarbonate, acrylic): more hydrophobic, a wider hysteresis.
  { key: 'PLASTIC', label: { en: 'Plastic', es: 'Plástico' }, advancingDeg: 90, recedingDeg: 65, soakMmPerS: 0, porosity: 0 },
  // Brushed or machined metal with its film of oxide and grease.
  { key: 'METAL', label: { en: 'Metal', es: 'Metal' }, advancingDeg: 80, recedingDeg: 50, soakMmPerS: 0, porosity: 0 },
  // Coated paper and board: drops pin hard (the receding angle is low) and soak in (S3c).
  { key: 'PAPER', label: { en: 'Paper', es: 'Papel' }, advancingDeg: 100, recedingDeg: 20, soakMmPerS: 0.05, porosity: 1 },
  // Gloss paint and lacquer.
  { key: 'PAINT', label: { en: 'Paint', es: 'Pintura' }, advancingDeg: 85, recedingDeg: 60, soakMmPerS: 0, porosity: 0 },
  // S3c: oiled or lightly finished wood: pins its drops, drinks them slowly and darkens.
  { key: 'WOOD', label: { en: 'Wood', es: 'Madera' }, advancingDeg: 85, recedingDeg: 40, soakMmPerS: 0.01, porosity: 0.6 },
  // S3c: woven cloth: a drop sits a moment and soaks in, the cloth darkens where it went.
  { key: 'FABRIC', label: { en: 'Fabric', es: 'Tela' }, advancingDeg: 110, recedingDeg: 40, soakMmPerS: 0.5, porosity: 1 },
];

export function wettability(key: WettabilityFamily): Wettability {
  return WETTABILITY.find((w) => w.key === key) ?? WETTABILITY[0];
}

/** The angle of repose of settled dust, degrees from the horizontal: steeper faces shed it (◆ a proposal). */
export const DUST_REPOSE_DEG = 35;

/** The family of the front glass of a camera. */
export const FRONT_GLASS_FAMILY: WettabilityFamily = 'GLASS';

/** S3c: the angle of repose of settled snow, degrees from the horizontal (◆ a proposal). */
export const SNOW_REPOSE_DEG = 50;

/**
 * S3c: the family a part wets as, from the category of its material (◆ a proposal): metal, plastic, glass, wood and
 * fabric their own; an emitter as glass (a lamp's cover); the others by their recipe: glass and fabric and wood as such,
 * a metallic one as metal, the rest as paint (ceramics, rubber, lacquers).
 */
export function wettabilityFamilyOf(m: { category: string; family: string; params?: { metallic?: number } } | null | undefined): WettabilityFamily {
  if (!m) return 'PAINT';
  switch (m.category) {
    case 'METAL':
      return 'METAL';
    case 'PLASTIC':
      return 'PLASTIC';
    case 'GLASS':
    case 'EMISSIVE':
      return 'GLASS';
    case 'WOOD':
      return 'WOOD';
    case 'FABRIC':
      return 'FABRIC';
    default:
      if (m.family === 'GLASS') return 'GLASS';
      if (m.family === 'FABRIC') return 'FABRIC';
      if (m.family === 'WOOD') return 'WOOD';
      return (m.params?.metallic ?? 0) >= 0.5 ? 'METAL' : 'PAINT';
  }
}
