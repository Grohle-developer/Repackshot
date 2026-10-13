// Catalogue data ported from EZPackshot (https://github.com/Grohle/EZPackshot, GPL-3.0) by its author for Repackshot (PolyForm Noncommercial 1.0.0); values are data, the implementation is new.

// Pure photometric and geometric helpers for the lighting rig and for the
// animation easing. No state, no DOM, no three.js: everything here is plain
// numbers in, plain numbers out, so it is cheap to test and to reuse in a
// worker.

import { CAMERA_AZIMUTH_DEG, SPEC_DEFAULTS } from '../data/light-setups';
import type { EasingKind, LightType, RGB } from '../data/types';

/** The part of a LightSpec that decides its colour. */
export interface ColorSpec {
  color?: RGB;
  colorFromPreset?: boolean;
  kelvin?: number;
}

/** The part of a LightSpec that decides how much irradiance it contributes. */
export interface IrradianceSpec {
  type?: LightType;
  energy?: number;
  share?: number;
  dist?: number;
}

/**
 * Colour temperature to linear RGB, normalised so the largest channel is 1.
 *
 * An approximation of a blackbody emitter, clamped to 1000..12000 K. It is
 * normalised on purpose: changing the tone of a light must not change its
 * exposure; the brightness comes from the power, not from the colour.
 */
export function kelvinToRgb(kelvin: number): RGB {
  // A NaN would poison every channel; treat it like the lower clamp.
  const clamped = Number.isNaN(kelvin) ? 1000 : Math.max(1000, Math.min(kelvin, 12000));
  const t = clamped / 100;

  const r = t <= 66 ? 255 : 329.698727446 * Math.pow(t - 60, -0.1332047592);

  const g =
    t <= 66
      ? 99.4708025861 * Math.log(t) - 161.1195681661
      : 288.1221695283 * Math.pow(t - 60, -0.0755148492);

  let b: number;
  if (t >= 66) b = 255;
  else if (t <= 19) b = 0;
  else b = 138.5177312231 * Math.log(t - 10) - 305.0447927307;

  const cr = Math.max(0, Math.min(r, 255));
  const cg = Math.max(0, Math.min(g, 255));
  const cb = Math.max(0, Math.min(b, 255));
  const largest = Math.max(cr, cg, cb) || 1;
  return [cr / largest, cg / largest, cb / largest];
}

/**
 * The colour of a light: an explicit `color` wins over everything; then
 * `colorFromPreset` (the mark old setups left, which inherited the colour of
 * the active product preset) takes `inherited` when there is one; otherwise
 * the colour comes from `kelvin`, or from the default temperature.
 */
export function specColor(spec: ColorSpec, inherited?: RGB): RGB {
  if (spec.color !== undefined) return spec.color;
  if (spec.colorFromPreset && inherited !== undefined) return inherited;
  return kelvinToRgb(spec.kelvin ?? SPEC_DEFAULTS.kelvin);
}

/**
 * Irradiance a light contributes, in W/m2 (or, for a recipe light, in the
 * unit of its `share`).
 *
 * An area light spreads with distance: energy / (4 pi d^2). A sun is already
 * an irradiance and does not depend on where the object is placed. The
 * energy is `energy` when present, otherwise `share`.
 *
 * This is the measure the recipes are normalised with (`rig.ts`), the same
 * one EZ Packshot's `setup_rig` uses, so it only fixes the ratios between
 * lights and setups. It is not what the renderers deliver: they follow
 * Blender Cycles' area light, pi times brighter on axis (`photometry.ts`).
 */
export function specIrradiance(spec: IrradianceSpec): number {
  const energy = spec.energy ?? spec.share ?? 0;
  if ((spec.type ?? SPEC_DEFAULTS.type) === 'SUN') return energy;
  const dist = (spec.dist ?? 1) || 1;
  return energy / (4 * Math.PI * dist * dist);
}

/**
 * Spherical to Cartesian, Z up. Azimuth 0 points at -Y (the default camera
 * looks along +Y), azimuth 90 at +X; elevation is above the XY plane.
 * Returns [d cos(el) sin(az), -d cos(el) cos(az), d sin(el)].
 */
export function polar(azDeg: number, elDeg: number, dist: number): [number, number, number] {
  const az = (azDeg * Math.PI) / 180;
  const el = (elDeg * Math.PI) / 180;
  return [
    dist * Math.cos(el) * Math.sin(az),
    dist * Math.cos(el) * -Math.cos(az),
    dist * Math.sin(el),
  ];
}

/** Camera-relative azimuth of a recipe light to world azimuth, degrees, not wrapped. */
export function toWorldAzimuth(azRel: number): number {
  return azRel + CAMERA_AZIMUTH_DEG;
}

/**
 * Analytic easing curve. Always returns a value in 0..1, even for invalid
 * input: a zero duration cannot spread a NaN through the whole animation.
 */
export function ease(t: number, mode: EasingKind): number {
  if (Number.isNaN(t)) return 0;
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  switch (mode) {
    case 'LINEAR':
      return t;
    case 'EASE':
      return t * t * (3 - 2 * t);
    case 'EASE_IN':
      return t * t;
    case 'EASE_OUT':
      return 1 - (1 - t) * (1 - t);
    case 'EASE_STRONG':
      return t * t * t * (t * (6 * t - 15) + 10);
    default:
      return t;
  }
}
