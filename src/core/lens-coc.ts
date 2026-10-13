// The circle of confusion of the thin-lens camera (AI-POST.md §7.4, the `coc` pass): the diameter, in output
// pixels, of the disc a point at a given depth spreads into. It follows the engine's own camera
// (`rt_core::scene::Camera::generate_ray`): the sensor sits `focal` behind the lens, the aperture is
// `focal / fstop` wide, and every ray through the lens centre meets the focus plane `focusDist` along the
// axis. A point at depth `d` is spread, on the focus plane, over `aperture × |d − focusDist| / d`, and one
// output pixel covers `sensor / longSide × focusDist / focal` on that plane. Zero on the focus plane and
// for a pinhole (fstop 0), an orthographic camera or no focus distance, as the engine's `lens_radius`.

import { SENSOR_MM, type CameraState } from './camera';

export interface LensParams {
  focalMm: number;
  /** 0: a pinhole. */
  fstop: number;
  /** Distance to the focus plane along the axis, in scene units. */
  focusDist: number;
  /** Sensor size along the longer image side. */
  sensorMm: number;
  ortho: boolean;
}

/** The lens of a camera as io/rsb.ts `cameraToRsb` hands it to the engine (the output frame itself, no viewport). */
export function lensOf(cam: Pick<CameraState, 'focalMm' | 'fstop' | 'focusDistance' | 'projection'>, sensorMm: number = SENSOR_MM): LensParams {
  return { focalMm: Math.max(1, cam.focalMm), fstop: Math.max(0, cam.fstop), focusDist: Math.max(0, cam.focusDistance), sensorMm, ortho: cam.projection === 'ORTHOGRAPHIC' };
}

/** Whether the lens blurs anything at all (the engine's `lens_radius() > 0`). */
export function hasDepthOfField(lens: LensParams): boolean {
  return lens.fstop > 0 && lens.focusDist > 0 && !lens.ortho;
}

/** The circle of confusion of a point at `depth` along the axis, in pixels of an image whose longer side is `longSide` pixels. */
export function cocDiameter(lens: LensParams, depth: number, longSide: number): number {
  if (!hasDepthOfField(lens) || !(depth > 0) || !Number.isFinite(depth)) return 0;
  const aperture = lens.focalMm / lens.fstop;
  const onFocusPlane = (aperture * Math.abs(depth - lens.focusDist)) / depth;
  const pixelOnFocusPlane = (lens.sensorMm / Math.max(1, longSide)) * (lens.focusDist / lens.focalMm);
  return onFocusPlane / pixelOnFocusPlane;
}

/** The `coc` pass of a `depth` pass (+∞ for the background, which stays 0). */
export function cocPass(lens: LensParams, depth: Float32Array, width: number, height: number): Float32Array {
  const out = new Float32Array(depth.length);
  if (!hasDepthOfField(lens)) return out;
  const longSide = Math.max(width, height);
  for (let i = 0; i < depth.length; i++) out[i] = cocDiameter(lens, depth[i], longSide);
  return out;
}
