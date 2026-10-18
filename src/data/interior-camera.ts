// K3 (INTERIORS.md §3.4): the presets of the interior camera. The keys are stable: they are added, never renamed.
//
// Every number here is a proposal pending the lead's decision (ROADMAP K3, "What did not fit the plan"): the eye heights, the
// interior lenses and the brightness presets are the ones §3.4 names; the calibration of a photographic EV against the
// engine's radiance, the metering and the largest tilt the straight verticals correct are this phase's.

import type { Label } from './types';

/** A height the camera can be put at (mm above the floor, z = 0). */
export interface EyeHeightPreset {
  key: string;
  label: Label;
  heightMm: number;
}

/** §3.4: a person standing and a person seated. */
export const EYE_HEIGHT_PRESETS: readonly EyeHeightPreset[] = [
  { key: 'STANDING', label: { es: 'De pie', en: 'Standing' }, heightMm: 1500 },
  { key: 'SEATED', label: { es: 'Sentado', en: 'Seated' }, heightMm: 1100 },
];

/** A focal length of the interior lenses (§3.4: 24, 28 and 35 mm), and the lens preset it is, if one is. */
export interface InteriorLens {
  key: string;
  focalMm: number;
  /** The key of `LENS_PRESETS` with this focal length (its aperture comes with it), or null. */
  preset: string | null;
}

export const INTERIOR_LENSES: readonly InteriorLens[] = [
  { key: 'INT_24', focalMm: 24, preset: 'WIDE' },
  { key: 'INT_28', focalMm: 28, preset: null },
  { key: 'INT_35', focalMm: 35, preset: 'DOC' },
];

/** A brightness preset of the exposure: a photographic exposure value (EV at ISO 100) of the scene. */
export interface ExposurePreset {
  key: string;
  label: Label;
  ev100: number;
}

/** §3.4: a bright day and an evening of lamps. */
export const EXPOSURE_PRESETS: readonly ExposurePreset[] = [
  { key: 'BRIGHT_DAY', label: { es: 'Día luminoso', en: 'Bright day' }, ev100: 7 },
  { key: 'LAMP_EVENING', label: { es: 'Tarde de lámparas', en: 'Evening lamps' }, ev100: 5 },
];

/**
 * The EV100 whose exposure is the engine's exposure 0 (radiance 1 shown as white before the curve). From the
 * saturation-based exposure of a camera, the luminance that saturates it is 1.2 · 2^EV100 cd/m²; with 683 lm/W a
 * radiance of 1 W/(sr·m²) is 683 cd/m², so exposure 0 is EV100 = log2(683 / 1.2) ≈ 9.15, and a preset of EV100 `e`
 * is an exposure of `EV100_AT_ZERO − e` stops. The engine's lights are normalised to the product type, not to
 * photometric units, so this number does not make a recipe a real scene: it is the proposal, pending the decision.
 */
export const EV100_AT_ZERO = Math.log2(683 / 1.2);

/**
 * The automatic exposure's metering: the mean of log2 luminance over the frame, the darkest `AUTO_TRIM_LOW` and the
 * brightest `AUTO_TRIM_HIGH` of the pixels left out (black corners and the windows, the lamps), put at middle grey.
 */
export const AUTO_MIDDLE_GREY = 0.18;
export const AUTO_TRIM_LOW = 0.1;
export const AUTO_TRIM_HIGH = 0.05;
/** The metered exposure stays within this many stops of 0, and is rounded to this step (stops). */
export const AUTO_EV_LIMIT = 16;
export const AUTO_EV_STEP = 0.01;

/** The largest tilt (degrees) the straight verticals correct with the lens shift; beyond it the camera keeps the rest. */
export const VERTICALS_MAX_TILT_DEG = 30;

/** The exterior factor's range on the camera ray (1: the environment as it is). */
export const EXTERIOR_MIN = 0.05;
export const EXTERIOR_MAX = 1;

/** The fisheye's field of view across the frame's diagonal, degrees: the default and the range. */
export const FISHEYE_FOV_DEFAULT = 180;
export const FISHEYE_FOV_MIN = 60;
export const FISHEYE_FOV_MAX = 360;
