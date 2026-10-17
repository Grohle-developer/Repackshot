// The panoramic projections of K3 (INTERIORS.md §3.4): the equirectangular panorama and the equidistant fisheye, as the
// engine maps them (rt-core `Camera::panorama_dir`, `CAMR.projection` 1 and 2) and as the Fast preview draws them from
// six cube faces (render/preview.ts, with PANORAMA_GLSL, the same formulas). Pure: numbers in, numbers out.
//
// Equirectangular: the longitude (u − ½)·fovX from the view axis towards the right, the latitude (½ − v)·fovY towards
// up; the output frame spans 360° × 180°. Fisheye: the angle θ from the axis is fovX per unit of u from the centre, the
// same per pixel up the height (θ = √(x² + y²) for x = (u − ½)·fovX and y = (½ − v)·fovX / aspect), turned towards
// (x, y); beyond 180° from the axis nothing is seen. The fisheye's field is set across the frame's diagonal
// (`CameraState.fisheyeFovDeg`), so 180° is a full-frame fisheye; a wider one shows the image circle inside the frame.

import { FISHEYE_FOV_DEFAULT, FISHEYE_FOV_MAX, FISHEYE_FOV_MIN } from '../data/interior-camera';
import type { CameraState } from './camera';

/** `CAMR.projection` (rt-core `Projection`). */
export const PROJECTION_STANDARD = 0;
export const PROJECTION_EQUIRECTANGULAR = 1;
export const PROJECTION_FISHEYE = 2;

/** The RSB code of a camera's projection: 0 for perspective and orthographic (CAMR's `ortho_flag` tells them apart). */
export function projectionCode(p: CameraState['projection']): number {
  return p === 'EQUIRECTANGULAR' ? PROJECTION_EQUIRECTANGULAR : p === 'FISHEYE' ? PROJECTION_FISHEYE : PROJECTION_STANDARD;
}

/** The fisheye's field across the frame's diagonal, degrees, within its range. */
export function fisheyeFov(cam: Pick<CameraState, 'fisheyeFovDeg'>): number {
  const f = cam.fisheyeFovDeg;
  return typeof f === 'number' && Number.isFinite(f) ? Math.min(FISHEYE_FOV_MAX, Math.max(FISHEYE_FOV_MIN, f)) : FISHEYE_FOV_DEFAULT;
}

/**
 * The engine's fields of view (`CAMR.fov_x_deg`, `fov_y_deg`) for an image of `imageW × imageH` pixels in which the
 * output frame is `frameW × frameH` of them (the same for a render; a viewport image covers more than its frame).
 * Equirectangular: 360° across the frame's width and 180° down its height, the image in proportion. Fisheye: the
 * camera's field across the frame's diagonal, so many degrees per pixel times the image's width.
 */
export function panoramaFov(cam: Pick<CameraState, 'projection' | 'fisheyeFovDeg'>, frameW: number, frameH: number, imageW: number, imageH: number): { x: number; y: number } {
  const fw = Math.max(1e-6, frameW);
  const fh = Math.max(1e-6, frameH);
  if (cam.projection === 'FISHEYE') {
    const perPixel = fisheyeFov(cam) / Math.hypot(fw, fh);
    return { x: perPixel * imageW, y: perPixel * imageH };
  }
  return { x: (360 * imageW) / fw, y: (180 * imageH) / fh };
}

/**
 * The direction through the image point `(u, v)` (0..1 from the top left) in the camera's frame: `[forward, right, up]`
 * components, unit length; null where a fisheye sees nothing. `fovX` and `fovY` in degrees, `aspect` the image's.
 */
export function panoramaDirection(projection: 'EQUIRECTANGULAR' | 'FISHEYE', fovX: number, fovY: number, aspect: number, u: number, v: number): [number, number, number] | null {
  if (projection === 'EQUIRECTANGULAR') {
    const lon = (u - 0.5) * ((fovX * Math.PI) / 180);
    const lat = (0.5 - v) * ((fovY * Math.PI) / 180);
    return [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
  }
  const k = (fovX * Math.PI) / 180;
  const x = (u - 0.5) * k;
  const y = ((0.5 - v) * k) / Math.max(1e-6, aspect);
  const theta = Math.hypot(x, y);
  if (!(theta <= Math.PI)) return null;
  if (theta === 0) return [1, 0, 0];
  const s = Math.sin(theta) / theta;
  return [Math.cos(theta), x * s, y * s];
}

/**
 * Where a direction `[forward, right, up]` (unit) falls on the image: `(u, v)` from the top left; null where the
 * projection does not show it (a fisheye's field is narrower than that). The inverse of `panoramaDirection`, for the
 * tests and for placing things in a panorama. The longitude is taken in (−180°, 180°].
 */
export function panoramaPoint(projection: 'EQUIRECTANGULAR' | 'FISHEYE', fovX: number, fovY: number, aspect: number, d: readonly [number, number, number]): [number, number] | null {
  if (projection === 'EQUIRECTANGULAR') {
    const lon = Math.atan2(d[1], d[0]);
    const lat = Math.asin(Math.max(-1, Math.min(1, d[2])));
    return [0.5 + lon / ((fovX * Math.PI) / 180), 0.5 - lat / ((fovY * Math.PI) / 180)];
  }
  const theta = Math.acos(Math.max(-1, Math.min(1, d[0])));
  const k = (fovX * Math.PI) / 180;
  const across = Math.hypot(d[1], d[2]);
  const x = across > 0 ? (d[1] / across) * theta : 0;
  const y = across > 0 ? (d[2] / across) * theta : 0;
  const u = 0.5 + x / k;
  const v = 0.5 - (y * Math.max(1e-6, aspect)) / k;
  return u >= 0 && u <= 1 && v >= 0 && v <= 1 ? [u, v] : null;
}

/**
 * The same mapping in GLSL for the preview's pass (render/preview.ts): `panoramaDirection(kind, fov, aspect, uv)` with
 * kind 1 equirectangular and 2 fisheye, fov in radians, uv from the top left; a w of 0 is a direction not seen.
 */
export const PANORAMA_GLSL = /* glsl */ `
vec4 panoramaDirection(int kind, vec2 fov, float aspect, vec2 uv) {
  if (kind == 1) {
    float lon = (uv.x - 0.5) * fov.x;
    float lat = (0.5 - uv.y) * fov.y;
    return vec4(cos(lat) * cos(lon), cos(lat) * sin(lon), sin(lat), 1.0);
  }
  float x = (uv.x - 0.5) * fov.x;
  float y = (0.5 - uv.y) * fov.x / max(aspect, 1e-6);
  float theta = sqrt(x * x + y * y);
  if (theta > 3.14159265) return vec4(0.0);
  if (theta == 0.0) return vec4(1.0, 0.0, 0.0, 1.0);
  float s = sin(theta) / theta;
  return vec4(cos(theta), x * s, y * s, 1.0);
}
`;
