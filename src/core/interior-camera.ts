// The interior camera (K3, INTERIORS.md §3.4): straight verticals by the lens shift, the eye height, the interior
// lenses. Pure functions over CameraState and ProjectState; the actions are `camera/eyeHeight` and `camera/interiorLens`,
// normal undoable steps (`camera/set` carries the rest: the projection, the fisheye's field, the straight verticals).
//
// Straight verticals. A camera tilted to look down at its target sees vertical lines converge. The camera that is
// rendered instead is level (the same position, the same azimuth) and its lens is shifted down on the sensor by
// f·tan(tilt), so the target is where it was in the frame and every vertical line stays vertical: the perspective
// control of a shift lens (what "estimate the vertical shift" does). The orbit camera the person moves is not touched:
// `renderedCamera` is what both the engine (io/rsb.ts) and the Fast preview (render/preview.ts) draw. A tilt beyond
// VERTICALS_MAX_TILT_DEG is corrected up to that much; the camera keeps the rest as its own tilt, so the picture never
// jumps. An orthographic camera's verticals are parallel anyway, a fisheye's are curves by nature: both are left alone;
// an equirectangular one is rendered level (its verticals are vertical lines only then).

import { EXTERIOR_MAX, EXTERIOR_MIN, EYE_HEIGHT_PRESETS, INTERIOR_LENSES, VERTICALS_MAX_TILT_DEG } from '../data/interior-camera';
import { lensPreset } from '../data/lenses';
import { cameraPosition, focusDistanceTo, focusFollowsOrbit, orbitFromPosition, type CameraId, type CameraState } from './camera';
import { add, clamp, type Vec3 } from './math';
import { polar } from './light-math';
import { OPTICS_NEUTRAL } from './optics';
import type { ActionBase, ProjectState } from './store';

export type InteriorCameraAction =
  | ({ type: 'camera/eyeHeight'; id: CameraId; heightMm: number } & ActionBase)
  | ({ type: 'camera/interiorLens'; id: CameraId; key: string } & ActionBase);

/** The steepest elevation the camera's basis takes (core/camera.ts `cameraBasis`). */
const MAX_ELEVATION = 89.9;

const rad = (deg: number): number => (deg * Math.PI) / 180;

/**
 * What the straight verticals do to a camera: the tilt the rendered camera keeps (degrees, positive looking down) and the
 * lens shift that moves its frame on the sensor (mm, positive up). Null when they do nothing: off, a projection they do
 * not apply to, or a level camera.
 */
export function verticalsOf(cam: Pick<CameraState, 'projection' | 'straightVerticals' | 'elevation' | 'focalMm'>): { keepDeg: number; correctedDeg: number; shiftYMm: number } | null {
  if (!cam.straightVerticals) return null;
  const el = clamp(cam.elevation, -MAX_ELEVATION, MAX_ELEVATION);
  if (el === 0) return null;
  if (cam.projection === 'EQUIRECTANGULAR') return { keepDeg: 0, correctedDeg: el, shiftYMm: 0 };
  if (cam.projection !== 'PERSPECTIVE') return null;
  const corrected = clamp(el, -VERTICALS_MAX_TILT_DEG, VERTICALS_MAX_TILT_DEG);
  return { keepDeg: el - corrected, correctedDeg: corrected, shiftYMm: -Math.max(1, cam.focalMm) * Math.tan(rad(corrected)) };
}

/**
 * The camera as it is rendered: itself, or with straight verticals the level camera at the same position looking the
 * same way (`verticalsOf`), its distance and focus measured along its own axis and the shift added to its optics' own.
 * Its target is on its axis, at the horizontal distance of the camera's target (over the cosine of what it keeps).
 */
export function renderedCamera(cam: CameraState): CameraState {
  const v = verticalsOf(cam);
  if (!v) return cam;
  const el = clamp(cam.elevation, -MAX_ELEVATION, MAX_ELEVATION);
  const position = cameraPosition(cam);
  const horizontal = cam.distance * Math.cos(rad(el));
  const distance = horizontal / Math.cos(rad(v.keepDeg));
  const target: Vec3 = add(position, polar(cam.azimuth, v.keepDeg, -distance));
  const out: CameraState = { ...cam, elevation: v.keepDeg, distance, target, focusDistance: cam.focusDistance * Math.cos(rad(v.correctedDeg)) };
  if (v.shiftYMm !== 0) {
    const o = cam.optics ?? OPTICS_NEUTRAL;
    out.optics = { ...o, shiftYMm: o.shiftYMm + v.shiftYMm };
  }
  return out;
}

/**
 * Focus with a click (core/view-objects.ts): the focus distance that puts `point` in focus. With straight verticals the
 * focus plane is square to the rendered camera's axis, whose focus distance is the camera's times cos(corrected tilt).
 */
export function focusDistanceFor(cam: CameraState, point: Vec3): number {
  const v = verticalsOf(cam);
  if (!v) return focusDistanceTo(cam, point);
  return Math.max(1, focusDistanceTo(renderedCamera(cam), point) / Math.cos(rad(v.correctedDeg)));
}

/** The exterior factor of a project (`environment.exterior`, absent: 1), within its range. */
export function exteriorOf(raw: number | undefined): number {
  return typeof raw === 'number' && Number.isFinite(raw) ? Math.min(EXTERIOR_MAX, Math.max(EXTERIOR_MIN, raw)) : 1;
}

/** Height of the camera above the floor (z = 0), mm. */
export function eyeHeightOf(cam: Pick<CameraState, 'azimuth' | 'elevation' | 'distance' | 'target'>): number {
  return cameraPosition(cam)[2];
}

/**
 * The camera moved straight up or down to `heightMm` above the floor, looking at the same target ("the camera moves at
 * a height, not around the piece"): its azimuth stays, its elevation and distance follow; the focus goes with the orbit
 * distance only if it was there. A camera above or below its target by exactly that height keeps its distance.
 */
export function atHeight(cam: CameraState, heightMm: number): CameraState {
  if (!Number.isFinite(heightMm)) return cam;
  const p = cameraPosition(cam);
  const moved: Vec3 = [p[0], p[1], heightMm];
  const orbit = orbitFromPosition(moved, cam.target);
  if (!(orbit.distance > 0)) return cam;
  // Straight above or below the target the azimuth is the camera's own.
  const flat = Math.hypot(moved[0] - cam.target[0], moved[1] - cam.target[1]) < 1e-9;
  const next: CameraState = { ...cam, elevation: orbit.elevation, distance: orbit.distance, azimuth: flat ? cam.azimuth : orbit.azimuth };
  if (focusFollowsOrbit(cam)) next.focusDistance = orbit.distance;
  return next;
}

export { EYE_HEIGHT_PRESETS, INTERIOR_LENSES };

export function reduceInteriorCamera(state: ProjectState, action: InteriorCameraAction): ProjectState {
  const cam = state.camera.cameras[action.id];
  if (!cam || cam.locked) return state;
  let next: CameraState;
  if (action.type === 'camera/eyeHeight') {
    next = atHeight(cam, action.heightMm);
  } else {
    const lens = INTERIOR_LENSES.find((l) => l.key === action.key);
    if (!lens) return state;
    const preset = lens.preset ? lensPreset(lens.preset) : undefined;
    next = { ...cam, focalMm: lens.focalMm, lens: preset ? preset.key : null, ...(preset ? { fstop: preset.fstop } : {}) };
  }
  if (next === cam) return state;
  return { ...state, camera: { ...state.camera, cameras: { ...state.camera.cameras, [cam.id]: next } } };
}
