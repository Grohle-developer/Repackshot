// Cameras: optics, framing, standard views and saved cameras (SPEC §3.5).
// Units: millimetres for distances, degrees for angles, a 36 mm sensor.

import { CAMERA_AZIMUTH_DEG, CAMERA_ELEVATION_DEG } from '../data/light-setups';
import { lensPreset } from '../data/lenses';
import { polar } from './light-math';
import type { ActionBase, ProjectState } from './store';
import { nextId } from './ids';
import { add, boxCenter, boxRadius, clamp, cross, dot, isEmptyBox, normalize, sub, type Box, type Vec3 } from './math';
import { boundsOf, sceneBounds, type NodeId } from './scene';

export type CameraId = string;

/** A camera of the project (SPEC §3.5). It orbits `target` at azimuth/elevation/distance. */
export interface CameraState {
  id: CameraId;
  /** User name; '' shows a numbered default. */
  name: string;
  /** World azimuth, degrees (same convention as `polar`). */
  azimuth: number;
  /** Degrees above the horizon. */
  elevation: number;
  /** Millimetres from the target. */
  distance: number;
  target: Vec3;
  focalMm: number;
  fstop: number;
  /** Millimetres from the camera. */
  focusDistance: number;
  projection: 'PERSPECTIVE' | 'ORTHOGRAPHIC';
  /** Width of the orthographic view, millimetres. */
  orthoWidth: number;
  clipStart: number;
  clipEnd: number;
  locked: boolean;
  /** LENS_PRESETS key last chosen, or null after a manual focal change. */
  lens: string | null;
}

/** Width of the reference sensor, millimetres (applies to the longer image side). */
export const SENSOR_MM = 36;

/** Margin of the reference framing: the part fills 1 / 1.1 of the frame. */
export const FRAME_MARGIN = 1.1;

export type ViewKey = 'THREE_QUARTER' | 'FRONT' | 'SIDE' | 'TOP' | 'BACK';

/** Standard views: world azimuth and elevation. */
export const VIEWS: Readonly<Record<ViewKey, { azimuth: number; elevation: number }>> = {
  THREE_QUARTER: { azimuth: CAMERA_AZIMUTH_DEG, elevation: CAMERA_ELEVATION_DEG },
  FRONT: { azimuth: 0, elevation: 4 },
  SIDE: { azimuth: 90, elevation: 4 },
  TOP: { azimuth: 0, elevation: 89 },
  BACK: { azimuth: 180, elevation: 8 },
};

export const VIEW_KEYS: readonly ViewKey[] = ['THREE_QUARTER', 'FRONT', 'SIDE', 'TOP', 'BACK'];

/** Reference camera for a part of `partSizeMm` (three-quarter view, 85 mm). */
export function makeCamera(id: CameraId, name: string, partSizeMm: number): CameraState {
  const size = partSizeMm > 0 ? partSizeMm : 200;
  const focal = 85;
  return {
    id,
    name,
    azimuth: CAMERA_AZIMUTH_DEG,
    elevation: CAMERA_ELEVATION_DEG,
    distance: fitDistance(size * 0.6, focal, 16 / 9),
    target: [0, 0, size / 2],
    focalMm: focal,
    fstop: 5.6,
    focusDistance: fitDistance(size * 0.6, focal, 16 / 9),
    projection: 'PERSPECTIVE',
    orthoWidth: size * 1.6,
    clipStart: clipStartFor(size),
    clipEnd: clipEndFor(size),
    locked: false,
    lens: null,
  };
}

/** Doctor clip fix values: start = min(0.5 % of the part, 10 mm); end = max(5000 parts, 100 m). */
export function clipStartFor(partSizeMm: number): number {
  return Math.min(partSizeMm * 0.005, 10);
}
export function clipEndFor(partSizeMm: number): number {
  return Math.max(partSizeMm * 5000, 100000);
}

/** Camera position in world space. */
export function cameraPosition(cam: Pick<CameraState, 'azimuth' | 'elevation' | 'distance' | 'target'>): Vec3 {
  return add(cam.target, polar(cam.azimuth, cam.elevation, cam.distance));
}

/** Orthonormal camera basis: forward (camera to target), right, up. */
export function cameraBasis(azimuth: number, elevation: number): { forward: Vec3; right: Vec3; up: Vec3 } {
  const el = clamp(elevation, -89.9, 89.9);
  const forward = normalize(polar(azimuth, el, -1));
  const right = normalize(cross(forward, [0, 0, 1]));
  const up = cross(right, forward);
  return { forward, right, up };
}

/**
 * Field of view for a focal length on the 36 mm sensor, fitted to the longer
 * side of an image of `aspect` (width / height). Radians.
 */
export function fieldOfView(focalMm: number, aspect: number): { h: number; v: number } {
  const half = SENSOR_MM / 2;
  const f = Math.max(focalMm, 1);
  if (aspect >= 1) {
    return { h: 2 * Math.atan(half / f), v: 2 * Math.atan(half / aspect / f) };
  }
  return { h: 2 * Math.atan((half * aspect) / f), v: 2 * Math.atan(half / f) };
}

/** Distance at which a sphere of `radius` fits with the reference margin. */
export function fitDistance(radius: number, focalMm: number, aspect: number, margin = FRAME_MARGIN): number {
  const fov = fieldOfView(focalMm, aspect);
  const half = Math.min(fov.h, fov.v) / 2;
  return (radius * margin) / Math.sin(half);
}

/**
 * Frames a box without changing the orientation (SPEC §3.5 "Encuadrar"): the
 * target goes to the centre of the box and the distance (or the orthographic
 * width) is the smallest that keeps the eight corners inside the frame.
 */
export function frameBox(cam: CameraState, box: Box, aspect: number, margin = FRAME_MARGIN): CameraState {
  if (isEmptyBox(box)) return cam;
  const center = boxCenter(box);
  const { forward, right, up } = cameraBasis(cam.azimuth, cam.elevation);
  const fov = fieldOfView(cam.focalMm, aspect);
  const th = Math.tan(fov.h / 2) / margin;
  const tv = Math.tan(fov.v / 2) / margin;
  let distance = 0;
  let halfW = 0;
  let halfH = 0;
  for (let i = 0; i < 8; i++) {
    const corner: Vec3 = [i & 1 ? box.max[0] : box.min[0], i & 2 ? box.max[1] : box.min[1], i & 4 ? box.max[2] : box.min[2]];
    const p = sub(corner, center);
    const x = Math.abs(dot(p, right));
    const y = Math.abs(dot(p, up));
    const z = dot(p, forward);
    distance = Math.max(distance, x / th - z, y / tv - z);
    halfW = Math.max(halfW, x);
    halfH = Math.max(halfH, y);
  }
  const radius = boxRadius(box);
  distance = Math.max(distance, radius * 1.05);
  const orthoWidth = Math.max(halfW * 2, halfH * 2 * aspect) * margin;
  return {
    ...cam,
    target: center,
    distance,
    focusDistance: distance,
    orthoWidth,
  };
}

/** Azimuth, elevation and distance of a position orbiting `target`. */
export function orbitFromPosition(position: Vec3, target: Vec3): { azimuth: number; elevation: number; distance: number } {
  const d = sub(position, target);
  const distance = Math.hypot(d[0], d[1], d[2]);
  if (distance < 1e-9) return { azimuth: 0, elevation: 0, distance: 0 };
  const elevation = (Math.asin(clamp(d[2] / distance, -1, 1)) * 180) / Math.PI;
  const azimuth = (Math.atan2(d[0], -d[1]) * 180) / Math.PI;
  return { azimuth, elevation, distance };
}

/**
 * Where the output image sits inside the viewport: the largest rectangle with
 * the output aspect that fits the viewport minus `marginPx` on each side.
 * The preview draws exactly this frame, so the viewport is the render.
 */
export function outputFrameRect(
  viewW: number,
  viewH: number,
  outW: number,
  outH: number,
  marginPx = 24,
): { x: number; y: number; width: number; height: number } {
  const availW = Math.max(1, viewW - marginPx * 2);
  const availH = Math.max(1, viewH - marginPx * 2);
  const aspect = outW > 0 && outH > 0 ? outW / outH : 16 / 9;
  let width = availW;
  let height = width / aspect;
  if (height > availH) {
    height = availH;
    width = height * aspect;
  }
  return { x: (viewW - width) / 2, y: (viewH - height) / 2, width, height };
}

/** The active camera. */
export function activeCamera(state: ProjectState): CameraState {
  return state.camera.cameras[state.camera.active] ?? Object.values(state.camera.cameras)[0];
}

/** Aspect of the output image (width / height). */
export function outputAspect(state: ProjectState): number {
  const { width, height } = state.render;
  return width > 0 && height > 0 ? width / height : 16 / 9;
}

export type CameraAction =
  | ({ type: 'camera/set'; id: CameraId; patch: Partial<Omit<CameraState, 'id'>> } & ActionBase)
  | ({ type: 'camera/activate'; id: CameraId } & ActionBase)
  | ({ type: 'camera/add'; name: string; from?: CameraId } & ActionBase)
  | ({ type: 'camera/delete'; id: CameraId } & ActionBase)
  | ({ type: 'camera/frame'; ids?: NodeId[] } & ActionBase)
  | ({ type: 'camera/view'; view: ViewKey } & ActionBase)
  | ({ type: 'camera/lens'; key: string } & ActionBase);

function setCamera(state: ProjectState, cam: CameraState): ProjectState {
  return { ...state, camera: { ...state.camera, cameras: { ...state.camera.cameras, [cam.id]: cam } } };
}

/** Frames the active camera on some nodes (or on the whole visible scene). */
export function frameActive(state: ProjectState, ids?: readonly NodeId[]): ProjectState {
  const cam = activeCamera(state);
  if (!cam) return state;
  const box = ids && ids.length > 0 ? boundsOf(state, ids) : sceneBounds(state, true);
  if (isEmptyBox(box)) return state;
  return setCamera(state, frameBox(cam, box, outputAspect(state)));
}

export function reduceCamera(state: ProjectState, action: CameraAction): ProjectState {
  switch (action.type) {
    case 'camera/set': {
      const cam = state.camera.cameras[action.id];
      if (!cam) return state;
      const patch = { ...action.patch };
      if (patch.focalMm !== undefined && patch.lens === undefined && patch.focalMm !== cam.focalMm) patch.lens = null;
      const next = { ...cam, ...patch };
      return setCamera(state, next);
    }
    case 'camera/activate':
      if (!state.camera.cameras[action.id] || state.camera.active === action.id) return state;
      return { ...state, camera: { ...state.camera, active: action.id } };
    case 'camera/add': {
      const src = state.camera.cameras[action.from ?? state.camera.active] ?? activeCamera(state);
      const id = nextId('cam', Object.keys(state.camera.cameras));
      const cam: CameraState = { ...src, id, name: action.name, locked: false };
      return { ...state, camera: { active: id, cameras: { ...state.camera.cameras, [id]: cam } } };
    }
    case 'camera/delete': {
      const ids = Object.keys(state.camera.cameras);
      if (ids.length <= 1 || !state.camera.cameras[action.id]) return state;
      const cameras = { ...state.camera.cameras };
      delete cameras[action.id];
      const active = state.camera.active === action.id ? Object.keys(cameras)[0] : state.camera.active;
      return { ...state, camera: { active, cameras } };
    }
    case 'camera/frame':
      return frameActive(state, action.ids);
    case 'camera/view': {
      const cam = activeCamera(state);
      const v = VIEWS[action.view];
      if (!cam || !v) return state;
      return frameActive(setCamera(state, { ...cam, azimuth: v.azimuth, elevation: v.elevation }));
    }
    case 'camera/lens': {
      const cam = activeCamera(state);
      const lens = lensPreset(action.key);
      if (!cam || !lens) return state;
      return frameActive(setCamera(state, { ...cam, focalMm: lens.focalMm, fstop: lens.fstop, lens: lens.key }));
    }
    default:
      return state;
  }
}
