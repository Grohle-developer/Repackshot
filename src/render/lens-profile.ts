// The Fast viewport's picture of a traced lens (phase O2, decision 4 of the lead): the engine's tables of distortion
// and relative illumination against image height (rt-core `LensInfo`) as the table the viewport pass reads
// (render/lens-filter-pass.ts `LensProfile`): an approximation of what the engine traces, said in the help.

import type { EngineLensInfo } from '../core/traced-lens';
import { PROFILE_SIZE } from './lens-filter-pass';

/** `v` at `x` of a table of increasing `x` (linear, held at both ends); `at0` when the table is empty. */
function lerpTable(t: readonly (readonly [number, number])[], x: number, at0: number): number {
  if (t.length === 0) return at0;
  if (x <= t[0][0]) return t[0][1];
  for (let i = 1; i < t.length; i++) {
    if (x <= t[i][0]) {
      const [x0, y0] = t[i - 1];
      const [x1, y1] = t[i];
      return x1 > x0 ? y0 + ((y1 - y0) * (x - x0)) / (x1 - x0) : y1;
    }
  }
  return t[t.length - 1][1];
}

/**
 * The profile table of a traced lens for a camera of `focalMm`: at PROFILE_SIZE heights from the axis to the last
 * one the engine measured, how much nearer the axis the undistorted picture (a pinhole of `focalMm`) holds what shows
 * there, from the engine's image scale near the axis (the breathing: a lens focused close frames less) and its
 * distortion against that scale, and the relative illumination.
 */
export function lensProfileTable(info: EngineLensInfo, focalMm: number): { table: Float32Array; hMaxMm: number } {
  const distortion: [number, number][] = [[0, 0], ...info.distortion];
  const light: [number, number][] = info.relativeIllumination.length > 0 ? info.relativeIllumination : [[0, 1]];
  const hMaxMm = Math.max(1e-3, ...distortion.map((p) => p[0]), ...light.map((p) => p[0]));
  const breathing = info.imageScaleMm > 0 && focalMm > 0 ? focalMm / info.imageScaleMm : 1;
  const table = new Float32Array(PROFILE_SIZE * 2);
  for (let i = 0; i < PROFILE_SIZE; i++) {
    const h = (hMaxMm * i) / (PROFILE_SIZE - 1);
    const d = lerpTable(distortion, h, 0) / 100;
    table[i * 2] = breathing / Math.max(1e-3, 1 + d);
    table[i * 2 + 1] = Math.max(0, lerpTable(light, h, 1));
  }
  return { table, hMaxMm };
}
