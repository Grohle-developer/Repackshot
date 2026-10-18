// How water sits on each family of material (phase S3b, ROADMAP S3 point 1): the advancing and the receding contact
// angle of water on its surface, degrees. A drop's cap takes their mean; the difference (the hysteresis) is what keeps
// a drop pinned against its weight until it is large enough to slide (Furmidge's balance, engine/crates/rt-phys
// `wet`). The keys are stable (rule 7: added, never renamed).
//
// Every value is a typical one from the published ranges of each family, this phase's proposal for the lead's verdict
// (rule 11, ◆ in the ROADMAP's S3b). GLASS is the front glass of a camera: its mean, 60°, is the contact angle the
// front glass has drawn its drops with since S3 (data/front-glass.ts). In S3b only the front glass uses the table; the
// other families wait for the drops on the parts (S3c). `tests/s3b-wet.test.ts` checks that GLASS and DUST_REPOSE_DEG
// are the engine's parity values (rt_phys::example).

import type { Label } from './types';

export type WettabilityFamily = 'GLASS' | 'PLASTIC' | 'METAL' | 'PAPER' | 'PAINT';

export interface Wettability {
  key: WettabilityFamily;
  label: Label;
  /** Contact angle of water advancing over the surface, degrees. */
  advancingDeg: number;
  /** Contact angle of water receding from it, degrees (at most the advancing one). */
  recedingDeg: number;
}

export const WETTABILITY: readonly Wettability[] = [
  // A lens or window glass, neither freshly cleaned nor coated against water.
  { key: 'GLASS', label: { en: 'Glass', es: 'Vidrio' }, advancingDeg: 70, recedingDeg: 50 },
  // Moulded polymers (ABS, polycarbonate, acrylic): more hydrophobic, a wider hysteresis.
  { key: 'PLASTIC', label: { en: 'Plastic', es: 'Plástico' }, advancingDeg: 90, recedingDeg: 65 },
  // Brushed or machined metal with its film of oxide and grease.
  { key: 'METAL', label: { en: 'Metal', es: 'Metal' }, advancingDeg: 80, recedingDeg: 50 },
  // Coated paper and board: drops pin hard (the receding angle is low) and soak in (S3c).
  { key: 'PAPER', label: { en: 'Paper', es: 'Papel' }, advancingDeg: 100, recedingDeg: 20 },
  // Gloss paint and lacquer.
  { key: 'PAINT', label: { en: 'Paint', es: 'Pintura' }, advancingDeg: 85, recedingDeg: 60 },
];

export function wettability(key: WettabilityFamily): Wettability {
  return WETTABILITY.find((w) => w.key === key) ?? WETTABILITY[0];
}

/** The angle of repose of settled dust, degrees from the horizontal: steeper faces shed it (◆ a proposal). */
export const DUST_REPOSE_DEG = 35;

/** The family of the front glass of a camera. */
export const FRONT_GLASS_FAMILY: WettabilityFamily = 'GLASS';
