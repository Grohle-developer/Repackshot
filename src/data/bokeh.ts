// The 20 bokeh types of docs/research/optics.md §1, as selectable combinations of parameters (STUDIO-TOOLS §1, §6).
//
// Each type is either a set of parameters of the enhanced thin lens (mode 1: aperture shape, pupil density,
// obstruction, cat's eye, squeeze, chromatic aberration, swirl, rings, texture), or a lens of the traced mode
// (mode 2, `requires: 'traced'`), or it needs wave optics (`requires: 'wave'`, coming soon). Where a type has a
// physical equivalent among the 16 starting lenses, `lens` names it. Keys are stable: they are added, never renamed.
// The values below are starting points for the engine's phases O1 and O2, to be tuned there with captures (the
// visual criterion is Fable's, rule 11); the names of the parameters are the contract.
//
// Data lives in bokeh.json. `thin` there holds only what differs from BOKEH_NEUTRAL; this module merges them.

import raw from './bokeh.json';
import type { Label } from './types';

/** Radial weight of the pupil. `profileParam` is the strength, 0..1: see PUPIL_PROFILES. */
export type PupilProfile = 'uniform' | 'centreBright' | 'ringBright' | 'apodized';

/** What each profile means, with ρ the radius in the pupil, 0 at the centre and 1 at the edge. */
export const PUPIL_PROFILES: readonly { key: PupilProfile; label: Label; weight: string }[] = [
  { key: 'uniform', label: { es: 'Uniforme', en: 'Uniform' }, weight: '1' },
  { key: 'centreBright', label: { es: 'Centro brillante', en: 'Bright centre' }, weight: '1 - k ρ²' },
  { key: 'ringBright', label: { es: 'Anillo brillante', en: 'Bright ring' }, weight: '(1 - k) + k ρ²' },
  { key: 'apodized', label: { es: 'Apodizada', en: 'Apodized' }, weight: 'Gaussian of ρ with a standard deviation of k' },
];

/** Parameters of the enhanced thin-lens mode that make a bokeh. */
export interface BokehThin {
  /** Iris blades, 3 to 18; 0 is a circle. */
  blades: number;
  /** 1 a circle, 0 straight blades (research §1 #2: the inradius over the radius of the blade arc). */
  roundness: number;
  rotationDeg: number;
  /** Id of an aperture mask (public/assets/aperture/index.json) that replaces the shape of the stop. */
  mask: string | null;
  profile: PupilProfile;
  /** k of the profile, 0..1. */
  profileParam: number;
  /** Central obstruction as a fraction of the aperture diameter (mirror lens). */
  obstruction: number;
  /** 0..1: how much the rims clip the pupil toward the frame edge. */
  catsEye: number;
  /** Anamorphic squeeze: the pupil is this many times taller than wide (1 none, 2 a 2x adapter). */
  squeeze: number;
  /** 0..1: strength of the horizontal highlight streaks of an anamorphic lens (drawn by the flare pass, phase O4). */
  streaks: number;
  /** 0..1: artistic chromatic aberration on top of the physical one (0 off). */
  caAmount: number;
  /** 0..1: artistic swirl, a rotation and stretch of the pupil that grows with the field radius. */
  swirl: number;
  /** 0..1: amplitude of the ring modulation that `texture` supplies. */
  onionAmplitude: number;
  /** Id of an aperture mask used as a pupil transmission texture (dust, scratches, mesh, rings). */
  texture: string | null;
}

/** A thin-lens bokeh with nothing special: a round, even disc. */
export const BOKEH_NEUTRAL: Readonly<BokehThin> = {
  blades: 0,
  roundness: 1,
  rotationDeg: 0,
  mask: null,
  profile: 'uniform',
  profileParam: 0,
  obstruction: 0,
  catsEye: 0,
  squeeze: 1,
  streaks: 0,
  caAmount: 0,
  swirl: 0,
  onionAmplitude: 0,
  texture: null,
};

/** A choice inside a type (the blade kind of a polygon, the star of a custom shape...). */
export interface BokehVariant {
  key: string;
  name: Label;
  /** What the variant changes in the type's parameters. */
  thin: Partial<BokehThin>;
}

export interface BokehType {
  key: string;
  /** The row of the taxonomy of research §1 (1 to 20). */
  n: number;
  name: Label;
  /** One line. */
  description: Label;
  /** Null: the thin-lens parameters alone make it. 'traced': needs a traced lens (`lens`). 'wave': needs wave optics. */
  requires: 'traced' | 'wave' | null;
  /** The starting lens (key of lenses.json) that shows this bokeh physically, where there is one. */
  lens: string | null;
  /** Parameters in the thin-lens mode, merged with BOKEH_NEUTRAL; null when the type has no thin-lens equivalent. */
  thin: BokehThin | null;
  variants: BokehVariant[];
}

interface RawType extends Omit<BokehType, 'thin'> {
  thin: Partial<BokehThin> | null;
}

const loadTypes = (): BokehType[] =>
  (raw.types as unknown as RawType[]).map((t) => ({
    ...t,
    thin: t.thin === null ? null : { ...BOKEH_NEUTRAL, ...t.thin },
  }));

/** The 20 types in the order of the research. */
export const BOKEH_TYPES: readonly BokehType[] = /* @__PURE__ */ loadTypes();

export function bokehType(key: string): BokehType | undefined {
  return BOKEH_TYPES.find((t) => t.key === key);
}

/** The thin-lens parameters of a type with one of its variants applied; null when the type has none. */
export function bokehParams(type: BokehType, variant?: string): BokehThin | null {
  if (!type.thin) return null;
  const v = variant === undefined ? undefined : type.variants.find((x) => x.key === variant);
  return v ? { ...type.thin, ...v.thin } : type.thin;
}
