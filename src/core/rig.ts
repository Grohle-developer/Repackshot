// Catalogue data ported from EZPackshot (https://github.com/Grohle/EZPackshot, GPL-3.0) by its author for Repackshot (MIT); values are data, the implementation is new.

// Lighting normalisation. A light setup defines the SHAPE and TONE of the
// light; the product preset keeps defining the LEVEL. Changing setup changes
// the way the part is lit, not its exposure, because the total irradiance of
// the setup is scaled to the total irradiance of the product preset.

import { LIGHT_ROLES, SPEC_DEFAULTS, lightSetup } from '../data/light-setups';
import { studioPreset } from '../data/studios';
import type { LightRole, LightSpec, RGB, ResolvedLight } from '../data/types';
import { specColor, specIrradiance, toWorldAzimuth } from './light-math';

export type { ResolvedLight } from '../data/types';

/** Irradiance used when a preset is unknown or has no lights. */
const FALLBACK_IRRADIANCE = 1.6;

/** The lights of a product preset, as authored (camera-relative azimuth). */
export function presetLights(presetKey: string): readonly LightSpec[] {
  return studioPreset(presetKey)?.lights ?? [];
}

/** Total irradiance of the rig of a product preset: the sum over its lights. */
export function presetIrradiance(presetKey: string): number {
  if (studioPreset(presetKey) === undefined) return FALLBACK_IRRADIANCE;
  let total = 0;
  for (const spec of presetLights(presetKey)) total += specIrradiance(spec);
  return total || FALLBACK_IRRADIANCE;
}

/**
 * A recipe or preset light turned into a resolved light. This is where the
 * azimuth stops being camera-relative and becomes world azimuth: from here on
 * everything works in world space.
 */
export function specToRig(spec: LightSpec, energy: number, color: RGB): ResolvedLight {
  return {
    role: spec.role,
    type: spec.type ?? SPEC_DEFAULTS.type,
    shape: spec.shape ?? SPEC_DEFAULTS.shape,
    size: spec.size,
    sizeY: spec.sizeY ?? spec.size,
    azimuthWorld: toWorldAzimuth(spec.az),
    elevation: spec.el,
    dist: spec.dist,
    energy,
    color,
    glossy: spec.glossy ?? SPEC_DEFAULTS.glossy,
    camera: spec.camera ?? SPEC_DEFAULTS.camera,
    spread: spec.spread ?? SPEC_DEFAULTS.spread,
    angle: spec.angle ?? SPEC_DEFAULTS.angle,
  };
}

/** The rig of a product preset, in resolved form. Unknown preset gives []. */
export function studioRig(presetKey: string): ResolvedLight[] {
  return presetLights(presetKey).map((spec) => specToRig(spec, spec.energy ?? 0, specColor(spec)));
}

/**
 * Resolves a recipe against a product preset: energy is `share` scaled so the
 * total irradiance of the recipe equals the preset's. A recipe light marked
 * `colorFromPreset` takes the colour of the FIRST light of the preset's rig
 * (the same light upstream inherits from, which is the key in most presets).
 */
export function rigFromRecipe(presetKey: string, recipe: readonly LightSpec[]): ResolvedLight[] {
  const target = presetIrradiance(presetKey);
  let sum = 0;
  for (const spec of recipe) sum += specIrradiance(spec);
  const k = sum > 1e-9 ? target / sum : 1;

  const base = studioRig(presetKey);
  const inherited: RGB = base.length > 0 ? base[0].color : [1, 1, 1];

  return recipe.map((spec) => specToRig(spec, k * (spec.share ?? 0), specColor(spec, inherited)));
}

/**
 * A light recipe adjusted to the light level of the active product preset.
 * Changing setup changes the shape of the light, not the exposure: the total
 * irradiance is normalised to the preset's. `PRESET`, an unknown setup or one
 * without lights gives the preset's own rig.
 */
export function setupRig(presetKey: string, setupKey: string): ResolvedLight[] {
  const setup = lightSetup(setupKey);
  if (setupKey === 'PRESET' || setup === undefined || !setup.lights || setup.lights.length === 0) {
    return studioRig(presetKey);
  }
  return rigFromRecipe(presetKey, setup.lights);
}

/** Total irradiance of a resolved rig, in the same unit as presetIrradiance. */
export function rigIrradiance(rig: readonly ResolvedLight[]): number {
  let total = 0;
  for (const light of rig) {
    total += specIrradiance({ type: light.type, energy: light.energy, dist: light.dist });
  }
  return total;
}

/** The generic fallback rig (KEY, FILL, RIM), for when nothing else resolves. */
function fallbackRig(): ResolvedLight[] {
  const roles: readonly LightRole[] = ['KEY', 'FILL', 'RIM'];
  return roles.map((role) => ({ role, ...LIGHT_ROLES[role] }));
}

/**
 * The lighting in force right now: the chosen setup if there is one, the
 * product preset's own rig otherwise. It is the ONLY source light size, power
 * and position should come from; LIGHT_ROLES is just a generic fallback for a
 * role the rig does not cover.
 */
export function activeRig(presetKey: string, setupKey: string | 'PRESET'): ResolvedLight[] {
  const rig = setupRig(presetKey, setupKey);
  return rig.length > 0 ? rig : fallbackRig();
}

/**
 * Groups a rig by role, keeping order. A preset can carry two lights of the
 * same role with different sizes (jewellery has two fills) and the second
 * must not get the first one's recipe.
 */
export function rigByRole(rig: readonly ResolvedLight[]): Partial<Record<LightRole, ResolvedLight[]>> {
  const out: Partial<Record<LightRole, ResolvedLight[]>> = {};
  for (const light of rig) {
    (out[light.role] ??= []).push(light);
  }
  return out;
}

/**
 * The recipe for copy number `copy` (zero based) of a role. `fan` is non-zero
 * only when there are more lights of that role than recipes: the extras are
 * fanned out so they do not land on top of one another.
 */
export function rigSpec(
  byRole: Partial<Record<LightRole, readonly ResolvedLight[]>>,
  role: LightRole,
  copy: number,
): { light: Omit<ResolvedLight, 'role'>; fan: number } {
  const list = byRole[role];
  if (!list || list.length === 0) return { light: LIGHT_ROLES[role], fan: copy };
  if (copy < list.length) return { light: list[copy], fan: 0 };
  return { light: list[list.length - 1], fan: copy - list.length + 1 };
}
