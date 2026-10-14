// The rigs the 71 light setups that came before L6 resolve to (every setup but PRESET), as tests/fixtures/old-setup-
// rigs.json keeps them: written from the code as it was before L6 (commit a6bd4d1). L6 adds the sets and redesigns the
// product types' own rigs (studios.ts), and these setups must keep resolving to the same lights. A setup's rig against
// a product type is its recipe's shape (hashed here, with each energy as a fraction of the product type's level to
// nine significant digits) scaled to that type's level (its total irradiance, kept per type).

import { STUDIO_PRESETS } from '../src/data/studios';
import type { ResolvedLight } from '../src/data/types';
import { sha256Hex } from '../src/core/sha256';

/** One light as text: every field, its energy divided by `level` to nine significant digits. */
export function lightText(l: ResolvedLight, level: number): string {
  const n = (v: number) => String(Number(v.toPrecision(12)));
  return [
    l.role, l.type, l.shape, n(l.size), n(l.sizeY), n(l.azimuthWorld), n(l.elevation), n(l.dist),
    (l.energy / level).toPrecision(9), l.color.map(n).join(','), l.glossy, l.camera, n(l.spread), n(l.angle),
  ].join('|');
}

/** The hash of a rig, its energies relative to `level`. */
export function rigHash(rig: readonly ResolvedLight[], level: number): string {
  return sha256Hex(new TextEncoder().encode(rig.map((l) => lightText(l, level)).join(';')));
}

/** Keys of the product types, in catalogue order. */
export const PRESET_KEYS: readonly string[] = STUDIO_PRESETS.map((p) => p.key);
