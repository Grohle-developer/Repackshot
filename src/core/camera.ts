// Cameras: optics, framing, standard views and saved cameras (SPEC §3.5).
// Units: millimetres for distances, degrees for angles, a 36 mm sensor.

import { CAMERA_AZIMUTH_DEG, CAMERA_ELEVATION_DEG } from '../data/light-setups';
import { lensPreset } from '../data/lenses';
import { aspectNearPixels, DEFAULT_ASPECT, normaliseAspect, type CameraAspect } from './aspect';
import type { CameraOptics } from './optics';
import type { TracedLens } from './traced-lens';
import { polar } from './light-math';
import type { ActionBase, ProjectState } from './store';
import { nextId } from './ids';
import { add, boxCenter, boxRadius, clamp, cross, dot, isEmptyBox, normalize, sub, type Box, type Vec3 } from './math';
import { boundsOf, isSetPiece, sceneBounds, type NodeId } from './scene';

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
  /**
   * PERSPECTIVE and ORTHOGRAPHIC; K3 adds the panoramas (core/panorama.ts): EQUIRECTANGULAR, the whole sphere around the
   * camera on a 2:1 image, and FISHEYE, an equidistant fisheye of `fisheyeFovDeg` across the frame's diagonal.
   */
  projection: CameraProjection;
  /** Width of the orthographic view, millimetres. */
  orthoWidth: number;
  clipStart: number;
  clipEnd: number;
  locked: boolean;
  /** LENS_PRESETS key last chosen, or null after a manual focal change. */
  lens: string | null;
  /**
   * The optics beyond the plain thin lens (O1: the bokeh, tilt and shift; core/optics.ts). Absent on cameras made
   * before O1 and on new ones: the plain thin lens, which the engine renders exactly as it always did.
   */
  optics?: CameraOptics;
  /**
   * The ratio of the image this camera takes (U13): a preset of data/aspects.ts or a custom `w : h`. The
   * viewport's frame and the render window's size follow the active camera's.
   */
  aspect: CameraAspect;
  /**
   * F1: how the focus is set (core/focus.ts). DISTANCE (absent on cameras made before F1, which read as it): the
   * typed `focusDistance`. POINT: a point picked with a click, `focusPoint`, which stays in focus whatever the camera
   * or its part does. OBJECT: a part, group or model, `focusObject`, followed the same way. In POINT and OBJECT the
   * focus distance is worked out from the camera and the point wherever it is needed (core/focus.ts
   * `resolvedFocusDistance`), and `focusDistance` keeps the last one it came to at rest, which the camera falls back
   * to when the point's part or the object is gone.
   */
  focusMode?: FocusMode;
  /** F1, POINT: the picked point, anchored to the part it hit (in that part's own coordinates). */
  focusPoint?: FocusPoint | null;
  /** F1, OBJECT: the part, group or model the focus follows. */
  focusObject?: NodeId | null;
  /** K3, FISHEYE: the field of view across the diagonal of the frame, degrees (absent: 180). */
  fisheyeFovDeg?: number;
  /**
   * K3, straight verticals (core/interior-camera.ts): a perspective camera renders level, with the lens shift that keeps
   * its target where it was in the frame, so vertical lines stay parallel; an equirectangular one renders level.
   * Absent: off (every camera of before K3).
   */
  straightVerticals?: boolean;
  /**
   * O2c: the lens editor's copy of this camera's traced lens while its elements are being edited (core/lens-edit.ts,
   * always with `edited`): every edit goes here, one undo entry each, and the camera's own lens changes only when the
   * person applies one the engine has checked. Absent: no edit in progress (every camera of before O2c).
   */
  lensDraft?: TracedLens;
  /**
   * C2, *Keep the size of what is in focus* (core/focal.ts): on, a change of the focal length moves the camera along its
   * view axis so that the plane in focus keeps its size in the image; off (absent: every camera of before C2), the camera
   * stays where it is and the framing changes, as on a real camera.
   */
  keepFocusSize?: boolean;
}

/** F1: how a camera's focus is set (CameraState.focusMode). */
export type FocusMode = 'DISTANCE' | 'POINT' | 'OBJECT';

/** F1: the modes, in the order the inspector shows them. */
export const FOCUS_MODES: readonly FocusMode[] = ['DISTANCE', 'POINT', 'OBJECT'];

/** F1: a focus point anchored to a part: the part and the point in its own coordinates (mm). */
export interface FocusPoint {
  node: NodeId;
  point: Vec3;
}

/** The projections of a camera, in the order of the control. */
export const CAMERA_PROJECTIONS = ['PERSPECTIVE', 'ORTHOGRAPHIC', 'EQUIRECTANGULAR', 'FISHEYE'] as const;
export type CameraProjection = (typeof CAMERA_PROJECTIONS)[number];

/** K3: true for the panoramic projections, which the preview draws from six cube faces and the engine as a pinhole. */
export function isPanoramic(p: CameraProjection): boolean {
  return p === 'EQUIRECTANGULAR' || p === 'FISHEYE';
}

/** Width of the reference sensor, millimetres (applies to the longer image side). */
export const SENSOR_MM = 36;

/** Margin of the reference framing: the part fills 1 / 1.1 of the frame. */
export const FRAME_MARGIN = 1.1;

export type ViewKey = 'THREE_QUARTER' | 'FRONT' | 'SIDE' | 'TOP' | 'BACK' | 'ELEVATION' | 'PLAN';

/**
 * Standard views: world azimuth and elevation. K3 adds the architect's two (INTERIORS.md §3.4), orthographic: the
 * elevation, level from the front, and the plan, from straight above (89.9°, the steepest the camera's basis takes).
 */
export const VIEWS: Readonly<Record<ViewKey, { azimuth: number; elevation: number; ortho?: true }>> = {
  THREE_QUARTER: { azimuth: CAMERA_AZIMUTH_DEG, elevation: CAMERA_ELEVATION_DEG },
  FRONT: { azimuth: 0, elevation: 4 },
  SIDE: { azimuth: 90, elevation: 4 },
  TOP: { azimuth: 0, elevation: 89 },
  BACK: { azimuth: 180, elevation: 8 },
  ELEVATION: { azimuth: 0, elevation: 0, ortho: true },
  PLAN: { azimuth: 0, elevation: 89.9, ortho: true },
};

export const VIEW_KEYS: readonly ViewKey[] = ['THREE_QUARTER', 'FRONT', 'SIDE', 'TOP', 'BACK', 'ELEVATION', 'PLAN'];

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
    aspect: { ...DEFAULT_ASPECT },
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

/** Near plane as a fraction of the camera distance when framing (phase I3). */
export const CLIP_NEAR_RATIO = 0.001;
/** The near plane never goes below this (mm). */
export const CLIP_NEAR_MIN_MM = 0.001;

/**
 * Clip planes for a camera `distance` away from a model of bounding-sphere `radius`: the near plane is
 * 0.001 x distance, never closer than a micron and never beyond half the way to the model's nearest
 * point; the far plane reaches 200 radii past the target (the floor is 60 sizes wide) and at least the
 * Doctor's default. A model imported at the wrong scale is still inside them.
 */
export function clipPlanesFor(distance: number, radius: number): { clipStart: number; clipEnd: number } {
  const reach = Math.max(distance - radius, 0);
  const clipStart = Math.min(Math.max(distance * CLIP_NEAR_RATIO, CLIP_NEAR_MIN_MM), Math.max(reach * 0.5, CLIP_NEAR_MIN_MM));
  const clipEnd = Math.max(distance + radius * 200, clipEndFor(radius * 2));
  return { clipStart, clipEnd };
}

/**
 * Frames a box without changing the orientation (SPEC §3.5 "Encuadrar"): the
 * target goes to the centre of the box and the distance (or the orthographic
 * width) is the smallest that keeps the eight corners inside the frame. The clip planes follow the
 * framed distance (`clipPlanesFor`), so the camera sees the model whatever its scale.
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
    ...clipPlanesFor(distance, radius),
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

/** The ratio width / height of the image a camera takes (16:9 for a camera that has none). */
export function aspectRatio(cam: { aspect?: Pick<CameraAspect, 'w' | 'h'> }): number {
  const a = cam.aspect;
  return a && a.w > 0 && a.h > 0 ? a.w / a.h : 16 / 9;
}

/** Aspect of the output image of the active camera (width / height): the ratio the viewport frames. */
export function outputAspect(state: ProjectState): number {
  return aspectRatio(activeCamera(state));
}

/**
 * Where the image of a camera sits inside a viewport of `viewW x viewH`: `outputFrameRect` with the camera's own
 * ratio, so the frame follows the camera whose view is on screen.
 */
export function cameraFrameRect(cam: CameraState, viewW: number, viewH: number, marginPx?: number): { x: number; y: number; width: number; height: number } {
  return outputFrameRect(viewW, viewH, cam.aspect?.w ?? 16, cam.aspect?.h ?? 9, marginPx);
}

/**
 * Cameras saved before U13 have no aspect: each takes the ratio of the render size the project saved (the one
 * size every camera shared), rounded to a preset within 0.5 %, else a custom ratio with those pixels. A camera
 * that has one keeps it (read through `normaliseAspect`). The saved size is not touched: an image's size
 * follows the active camera from the next change on, and opening a project never changes what it renders.
 */
export function withCameraAspects(state: ProjectState): ProjectState {
  const saved = aspectNearPixels(state.render.width, state.render.height);
  let changed = false;
  let legacy = false;
  const cameras: Record<CameraId, CameraState> = {};
  for (const [id, cam] of Object.entries(state.camera.cameras)) {
    const raw = (cam as { aspect?: unknown }).aspect;
    const aspect = raw === undefined ? saved : normaliseAspect(raw, saved);
    if (raw === undefined) legacy = true;
    const same = raw !== undefined && aspect.preset === (raw as CameraAspect).preset && aspect.w === (raw as CameraAspect).w && aspect.h === (raw as CameraAspect).h;
    cameras[id] = same ? cam : { ...cam, aspect };
    if (!same) changed = true;
  }
  if (!changed) return state;
  const next: ProjectState = { ...state, camera: { ...state.camera, cameras } };
  return legacy && next.render.mode !== 'ANIMATION' ? { ...next, render: { ...next.render, aspect: aspectRatio(activeCamera(next)) } } : next;
}

/**
 * True when a patch leaves the camera where it is, within float noise (a millionth of the distance, a
 * microdegree): a click on the viewport ends an orbit gesture that did not move, and must not leave an undo entry.
 */
export function sameView(cam: CameraState, patch: Partial<Omit<CameraState, 'id'>>): boolean {
  const tol = Math.max(cam.distance, 1) * 1e-6;
  for (const [k, v] of Object.entries(patch) as [keyof CameraState, unknown][]) {
    const cur = cam[k];
    if (typeof v === 'number' && typeof cur === 'number') {
      const eps = k === 'azimuth' || k === 'elevation' ? 1e-6 : k === 'distance' || k === 'focusDistance' || k === 'orthoWidth' ? tol : 0;
      // Azimuths a whole turn apart are the same view.
      const d = k === 'azimuth' ? Math.abs(((((v - cur) % 360) + 540) % 360) - 180) : Math.abs(v - cur);
      if (d > eps) return false;
    } else if (Array.isArray(v) && Array.isArray(cur)) {
      if (v.length !== cur.length || v.some((x, i) => Math.abs(x - (cur as number[])[i]) > tol)) return false;
    } else if (v !== cur) return false;
  }
  return true;
}

/**
 * True when the focus plane still sits at the orbit distance, as a fresh or orbited camera has it. A focus that was
 * picked or typed is somewhere else, and orbiting must not drag it back to the target.
 */
export function focusFollowsOrbit(cam: Pick<CameraState, 'focusDistance' | 'distance' | 'focusMode'>): boolean {
  // F1: a focus on a point or an object follows that (core/focus.ts), not the orbit.
  if (cam.focusMode === 'POINT' || cam.focusMode === 'OBJECT') return false;
  return Math.abs(cam.focusDistance - cam.distance) <= Math.max(cam.distance, 1) * 1e-6;
}

/** Where the viewport's navigation has put its view (preview.ts ViewChange). */
export interface OrbitView {
  azimuth: number;
  elevation: number;
  distance: number;
  target: Vec3;
  /** Width of the orthographic view, millimetres; absent for a perspective view. */
  orthoWidth?: number;
}

/**
 * What the camera takes from the view the navigation ended on: null when the view is the camera's own (a click that
 * did not move it, which OrbitControls still reports as the end of a gesture), else the patch to apply. The focus
 * plane goes along with the orbit distance only if it was there before; a focus picked with a click or typed in the
 * field stays where it is.
 */
export function orbitPatch(cam: CameraState, view: OrbitView): Partial<Omit<CameraState, 'id'>> | null {
  const patch: Partial<Omit<CameraState, 'id'>> = { azimuth: view.azimuth, elevation: view.elevation, distance: view.distance, target: [view.target[0], view.target[1], view.target[2]] };
  if (view.orthoWidth) patch.orthoWidth = view.orthoWidth;
  if (sameView(cam, patch)) return null;
  if (focusFollowsOrbit(cam)) patch.focusDistance = view.distance;
  return patch;
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

/** Frames the active camera on some nodes (or on the whole visible scene, but the decoration of a set: L6). */
export function frameActive(state: ProjectState, ids?: readonly NodeId[]): ProjectState {
  const cam = activeCamera(state);
  if (!cam) return state;
  const own = state.scene.roots.filter((r) => !isSetPiece(state.scene.nodes[r]));
  const box = ids && ids.length > 0 ? boundsOf(state, ids) : own.length === state.scene.roots.length ? sceneBounds(state, true) : boundsOf(state, own, true);
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
      if (patch.aspect !== undefined) patch.aspect = normaliseAspect(patch.aspect, cam.aspect);
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
      return frameActive(setCamera(state, { ...cam, azimuth: v.azimuth, elevation: v.elevation, ...(v.ortho ? { projection: 'ORTHOGRAPHIC' as const } : {}) }));
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
