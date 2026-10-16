// The Fast viewport's picture of a traced lens (phase O2, decision 4 of the lead): the engine's tables of distortion
// and relative illumination against image height (rt-core `LensInfo`) as the table the viewport reads (`LensProfile`):
// an approximation of what the engine traces, said in the help.
//
// The map from the picture on the screen to the undistorted one is here once, in two languages side by side: the
// screen pass (render/lens-filter-pass.ts PRESENT), the outline of the selection and the overlays draw through
// `PROFILE_GLSL`, and every hit test (render/preview.ts: the pick, the gizmo, the glyphs, the selection by box) goes
// through `profileSource` and `profileShown`, which take the same steps with the same numbers (`profileUniforms`), so
// a click lands on what is drawn under the cursor.

import * as THREE from 'three';
import type { EngineLensInfo } from '../core/traced-lens';

/** Entries of a lens profile's table (image height from 0 to its last). */
export const PROFILE_SIZE = 64;

/**
 * O2: what the Fast viewport draws of a traced lens: for each image height, how much nearer the axis the undistorted
 * picture holds what shows there (distortion and breathing) and the relative illumination, from the engine's tables.
 */
export interface LensProfile {
  /** PROFILE_SIZE pairs (scale, illumination) at heights 0 … hMaxMm. */
  table: Float32Array;
  hMaxMm: number;
  /** Pixels of the drawing buffer per millimetre of image height. */
  pxPerMm: number;
  /** Where the optical axis is in the picture, in texture coordinates. */
  axis: [number, number];
}

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

/** The numbers the map takes from a profile on a drawing buffer of `bufW` × `bufH` pixels (the shaders' uniforms). */
export interface ProfileUniforms {
  hMax: number;
  pxPerMm: number;
  axis: [number, number];
  bufSize: [number, number];
}

export function profileUniforms(p: LensProfile, bufW: number, bufH: number): ProfileUniforms {
  return { hMax: Math.max(1e-6, p.hMaxMm), pxPerMm: Math.max(1e-6, p.pxPerMm), axis: [p.axis[0], p.axis[1]], bufSize: [Math.max(1, bufW), Math.max(1, bufH)] };
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/**
 * The map (`PROFILE_GLSL` takes the same steps): the point of the undistorted picture that the screen shows at `u`,
 * `v` (texture coordinates of the drawing buffer, y up), held inside the picture as the texture's edge holds it, and
 * the light there. The table is read between its entries, linearly. Without a profile (the thin lens), the point
 * itself in full light.
 */
export function profileSource(p: LensProfile | null, bufW: number, bufH: number, u: number, v: number): [number, number, number] {
  if (!p) return [u, v, 1];
  const k = profileUniforms(p, bufW, bufH);
  const px = (u - k.axis[0]) * k.bufSize[0];
  const py = (v - k.axis[1]) * k.bufSize[1];
  const h = Math.hypot(px, py) / k.pxPerMm;
  const x = clamp01(h / k.hMax) * (PROFILE_SIZE - 1);
  const i = Math.min(Math.floor(x), PROFILE_SIZE - 2);
  const f = x - i;
  const scale = p.table[i * 2] * (1 - f) + p.table[i * 2 + 2] * f;
  const light = p.table[i * 2 + 1] * (1 - f) + p.table[i * 2 + 3] * f;
  return [clamp01(k.axis[0] + (px * scale) / k.bufSize[0]), clamp01(k.axis[1] + (py * scale) / k.bufSize[1]), light];
}

/**
 * The other way: where the screen shows the point `u`, `v` of the undistorted picture (texture coordinates), found on
 * the line from the axis through it by bisection of `profileSource` (the radius it shows grows with the radius on the
 * screen). Without a profile, the point itself.
 */
export function profileShown(p: LensProfile | null, bufW: number, bufH: number, u: number, v: number): [number, number] {
  if (!p) return [u, v];
  const k = profileUniforms(p, bufW, bufH);
  const sx = (u - k.axis[0]) * k.bufSize[0];
  const sy = (v - k.axis[1]) * k.bufSize[1];
  const rs = Math.hypot(sx, sy);
  if (rs === 0) return [u, v];
  // The radius the screen shows at radius r along the line, unclamped (the clamp only holds the edge of the picture).
  const shows = (r: number): number => {
    const x = clamp01(r / k.pxPerMm / k.hMax) * (PROFILE_SIZE - 1);
    const i = Math.min(Math.floor(x), PROFILE_SIZE - 2);
    const f = x - i;
    return r * (p.table[i * 2] * (1 - f) + p.table[i * 2 + 2] * f);
  };
  let lo = 0;
  let hi = rs;
  for (let n = 0; n < 60 && shows(hi) < rs; n++) hi *= 2;
  for (let n = 0; n < 60; n++) {
    const mid = (lo + hi) / 2;
    if (shows(mid) < rs) lo = mid;
    else hi = mid;
  }
  const t = (lo + hi) / 2 / rs;
  return [k.axis[0] + (sx * t) / k.bufSize[0], k.axis[1] + (sy * t) / k.bufSize[1]];
}

/** A canvas: its size in CSS pixels and its drawing buffer's in pixels. */
export interface ProfileView {
  width: number;
  height: number;
  bufW: number;
  bufH: number;
}

/** The point (CSS pixels, y down) of the undistorted picture that the screen shows at `x`, `y`: where a hit test casts. */
export function sourceOfShown(p: LensProfile | null, view: ProfileView, x: number, y: number): [number, number] {
  if (!p || view.width <= 0 || view.height <= 0) return [x, y];
  const [u, v] = profileSource(p, view.bufW, view.bufH, x / view.width, 1 - y / view.height);
  return [u * view.width, (1 - v) * view.height];
}

/** Where the screen shows (CSS pixels, y down) the point `x`, `y` of the undistorted picture. */
export function shownOfSource(p: LensProfile | null, view: ProfileView, x: number, y: number): [number, number] {
  if (!p || view.width <= 0 || view.height <= 0) return [x, y];
  const [u, v] = profileShown(p, view.bufW, view.bufH, x / view.width, 1 - y / view.height);
  return [u * view.width, (1 - v) * view.height];
}

/**
 * `profileSource` for the shaders: `vec3 lensProfileSource(vec2 uv)` (the undistorted picture's point and the light),
 * with the uniforms of `ProfileUniformSet`. The table is read at its texels' centres (it is not filtered) and mixed.
 */
export const PROFILE_GLSL = /* glsl */ `
uniform sampler2D lpTable;
uniform float lpOn;
uniform float lpHMax;
uniform float lpPxPerMm;
uniform vec2 lpAxis;
uniform vec2 lpBufSize;
vec3 lensProfileSource(vec2 uv) {
  if (lpOn < 0.5) return vec3(uv, 1.0);
  vec2 px = (uv - lpAxis) * lpBufSize;
  float h = length(px) / lpPxPerMm;
  float x = clamp(h / lpHMax, 0.0, 1.0) * ${PROFILE_SIZE - 1}.0;
  float i = min(floor(x), ${PROFILE_SIZE - 2}.0);
  float f = x - i;
  vec2 a = texture2D(lpTable, vec2((i + 0.5) / ${PROFILE_SIZE}.0, 0.5)).rg;
  vec2 b = texture2D(lpTable, vec2((i + 1.5) / ${PROFILE_SIZE}.0, 0.5)).rg;
  vec2 p = a * (1.0 - f) + b * f;
  return vec3(clamp(lpAxis + (px * p.x) / lpBufSize, 0.0, 1.0), p.y);
}
`;

/** The uniforms of `PROFILE_GLSL` and the table's texture, shared by the materials that draw through a profile. */
export class ProfileUniformSet {
  private readonly texture = new THREE.DataTexture(new Float32Array(PROFILE_SIZE * 4), PROFILE_SIZE, 1, THREE.RGBAFormat, THREE.FloatType);
  readonly uniforms: Record<string, THREE.IUniform> = {
    lpTable: { value: this.texture },
    lpOn: { value: 0 },
    lpHMax: { value: 1 },
    lpPxPerMm: { value: 1 },
    lpAxis: { value: new THREE.Vector2(0.5, 0.5) },
    lpBufSize: { value: new THREE.Vector2(1, 1) },
  };

  /** Draws through `profile` on a drawing buffer of `bufW` × `bufH` (null: straight). */
  set(profile: LensProfile | null, bufW: number, bufH: number): void {
    const u = this.uniforms;
    u.lpOn.value = profile ? 1 : 0;
    if (!profile) return;
    const data = this.texture.image.data as Float32Array;
    for (let i = 0; i < PROFILE_SIZE; i++) {
      data[i * 4] = profile.table[i * 2];
      data[i * 4 + 1] = profile.table[i * 2 + 1];
    }
    this.texture.needsUpdate = true;
    const k = profileUniforms(profile, bufW, bufH);
    u.lpHMax.value = k.hMax;
    u.lpPxPerMm.value = k.pxPerMm;
    (u.lpAxis.value as THREE.Vector2).set(k.axis[0], k.axis[1]);
    (u.lpBufSize.value as THREE.Vector2).set(k.bufSize[0], k.bufSize[1]);
  }

  dispose(): void {
    this.texture.dispose();
  }
}
