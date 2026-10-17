// The focal length's switch (phase C2; ROADMAP "Decisiones de criterio" 1.7, SPEC §3.5 "Focal"): *Keep the size of
// what is in focus*, one per camera (`CameraState.keepFocusSize`, absent: off).
//
// - Off (the default, as on a real camera): changing the focal length leaves the camera where it is; the framing changes.
// - On: the camera dollies along its view axis so that the plane in focus keeps its size in the image. The image of a
//   point at depth z is f / z times its size, so the plane at distance D keeps it when D goes to D·f′/f. The camera moves
//   by D − D·f′/f towards it; the perspective changes, the size of what is in focus does not.
//
// Where the plane in focus is comes from F1's resolution (core/focus.ts): the typed distance in Distance; in Point and
// Object the distance that puts the followed point in focus at rest, by the engine's rule (`focusDistanceFor`: its
// depth along the axis; with a tilt, where the hinge-rule plane through it crosses the axis; with straight verticals,
// measured along the camera's own axis, which is the axis it moves along, so the level camera that is rendered keeps
// the plane's size and place too). The orbit target stays where it is while the camera stays in front of it; a camera
// that would come nearer to it than a tenth of the orbit distance scaled by the same ratio pushes it along the axis.
// Nothing moves for a locked camera, nor for the orthographic projection and the panoramas, whose framing the focal
// length does not set (the inspector says so). `camera/focal` and K3's interior lenses go through here; the lens
// presets (`camera/lens`) frame the product as they always did.

import { cameraBasis, isPanoramic, type CameraId, type CameraState } from './camera';
import { focusDistanceFor, focusModeOf, focusTarget } from './focus';
import { reduceInteriorCamera, type InteriorCameraAction } from './interior-camera';
import { add, scale } from './math';
import type { ActionBase, ProjectState } from './store';

/** C2: set a camera's focal length the way its switch says (one undo entry; a drag of the field is one gesture). */
export type FocalAction = { type: 'camera/focal'; id: CameraId; focalMm: number } & ActionBase;

/** What changing the focal length of a camera does now (the inspector's note says it). */
export type FocalBehaviour =
  /** Off: the camera stays, the framing changes. */
  | 'FRAMING'
  /** On: the camera dollies, the plane in focus keeps its size. */
  | 'DOLLY'
  /** On, but the camera is locked: it stays, the framing changes. */
  | 'LOCKED'
  /** Orthographic: the width frames, not the focal length; nothing to keep. */
  | 'ORTHOGRAPHIC'
  /** A panorama: its field frames, not the focal length; nothing to keep. */
  | 'PANORAMA';

/**
 * The smallest orbit distance a dolly leaves, as a fraction of the orbit distance scaled by the focal ratio: nearer than
 * that the target is pushed along the axis instead.
 */
export const MIN_ORBIT_FRACTION = 0.1;

/** Whether a camera's switch is on (absent on every camera of before C2: off). */
export function keepsFocusSize(cam: Pick<CameraState, 'keepFocusSize'>): boolean {
  return cam.keepFocusSize === true;
}

/** What a focal change does to this camera now. */
export function focalBehaviour(cam: Pick<CameraState, 'keepFocusSize' | 'locked' | 'projection'>): FocalBehaviour {
  if (cam.projection === 'ORTHOGRAPHIC') return 'ORTHOGRAPHIC';
  if (isPanoramic(cam.projection)) return 'PANORAMA';
  if (!keepsFocusSize(cam)) return 'FRAMING';
  return cam.locked ? 'LOCKED' : 'DOLLY';
}

/**
 * How far the plane in focus is from the camera at rest (mm, along its own axis): the typed distance in Distance; in
 * Point and Object the distance F1 resolves for the followed point (paraxial, as the store keeps it), the kept distance
 * when the point is gone. Null when there is none to keep.
 */
export function focusedPlaneDistance(state: ProjectState, cam: CameraState): number | null {
  const own = Number.isFinite(cam.focusDistance) && cam.focusDistance > 0 ? cam.focusDistance : null;
  if (focusModeOf(cam) === 'DISTANCE') return own;
  const point = focusTarget(state, cam, null);
  const d = point ? focusDistanceFor(cam, point) : null;
  return d !== null && d > 0 && Number.isFinite(d) ? d : own;
}

/**
 * The camera `after` (the camera `before` with its new focal length, and whatever else came with it) moved along its
 * view axis when `before`'s switch is on, so the plane in focus keeps its size: the orbit distance and the focus
 * distance less D − D·f′/f, the far clipping plane where it was in the world, the target pushed along the axis only
 * when the camera would come too near it (`MIN_ORBIT_FRACTION`). `after` itself when nothing moves.
 */
export function dollyForFocal(state: ProjectState, before: CameraState, after: CameraState): CameraState {
  if (focalBehaviour(before) !== 'DOLLY') return after;
  const f0 = Math.max(1, before.focalMm);
  const f1 = Math.max(1, after.focalMm);
  if (f0 === f1 || !Number.isFinite(f1)) return after;
  const plane = focusedPlaneDistance(state, before);
  if (plane === null || !(before.distance > 0)) return after;
  const ratio = f1 / f0;
  const toward = plane - plane * ratio;
  let distance = before.distance - toward;
  let target = before.target;
  const floor = MIN_ORBIT_FRACTION * before.distance * ratio;
  if (distance < floor) {
    // The camera would reach (or pass) its target: the target goes ahead of it along the axis.
    const { forward } = cameraBasis(before.azimuth, before.elevation);
    target = add(before.target, scale(forward, floor - distance));
    distance = floor;
  }
  if (!Number.isFinite(distance) || !target.every(Number.isFinite)) return after;
  return {
    ...after,
    distance,
    target: [target[0], target[1], target[2]],
    focusDistance: before.focusDistance > 0 ? Math.max(1e-3, before.focusDistance - toward) : after.focusDistance,
    clipEnd: toward < 0 ? before.clipEnd - toward : after.clipEnd,
  };
}

/** A camera with a new focal length, dollied when its switch is on (the manual focal: no lens preset any more). */
export function withFocal(state: ProjectState, cam: CameraState, focalMm: number): CameraState {
  if (!Number.isFinite(focalMm) || focalMm <= 0 || focalMm === cam.focalMm) return cam;
  return dollyForFocal(state, cam, { ...cam, focalMm, lens: null });
}

/** `camera/focal`, and K3's interior lenses, which change the focal length too (store.ts routes both here). */
export function reduceFocal(state: ProjectState, action: FocalAction | Extract<InteriorCameraAction, { type: 'camera/interiorLens' }>): ProjectState {
  const cam = state.camera.cameras[action.id];
  if (!cam) return state;
  if (action.type === 'camera/interiorLens') {
    const next = reduceInteriorCamera(state, action);
    const lensed = next.camera.cameras[action.id];
    if (next === state || !lensed) return next;
    const moved = dollyForFocal(state, cam, lensed);
    return moved === lensed ? next : { ...next, camera: { ...next.camera, cameras: { ...next.camera.cameras, [cam.id]: moved } } };
  }
  const next = withFocal(state, cam, action.focalMm);
  return next === cam ? state : { ...state, camera: { ...state.camera, cameras: { ...state.camera.cameras, [cam.id]: next } } };
}
