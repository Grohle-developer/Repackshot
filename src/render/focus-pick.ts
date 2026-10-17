// Focus with a click through the engine (phase F1): the page's own rt.wasm reads a scene with only the camera of the
// view in it (io/rsb.ts `focusPickRsb`: the Full view's camera, frame and pose) and gives the chief ray of a point of
// that image (`rt_scene_pick`: the ray every sample of that point is centred on, through the camera's real projection,
// a traced lens's distortion included), which the viewport casts at its own geometry; and the focus distance that puts
// a world point in focus through a camera (`rt_scene_focus_at`: a traced lens's solved from its real rays). An older
// rt.wasm without them, or none, leaves the viewport's own pick and the paraxial distance (core/focus.ts).

import type { CameraState } from '../core/camera';
import type { Vec3 } from '../core/math';

/** The exports of rt.wasm this needs. */
export interface RtFocusExports {
  memory: WebAssembly.Memory;
  rt_alloc(len: number): number;
  rt_free(ptr: number, len: number): void;
  rt_scene_load(ptr: number, len: number): number;
  rt_scene_free(handle: number): number;
  rt_scene_pick(handle: number, u: number, v: number, out: number): number;
  rt_scene_focus_at(handle: number, x: number, y: number, z: number): number;
}

/** True when this build of the module picks for focus with a click (feature detection: an older rt.wasm has not). */
export function hasFocusExports(rt: object): rt is RtFocusExports {
  const e = rt as Partial<RtFocusExports>;
  return typeof e.rt_scene_pick === 'function' && typeof e.rt_scene_focus_at === 'function' && typeof e.rt_scene_load === 'function';
}

/** Floats of a pick (rt-core `focus::PICK_FLOATS`). */
export const PICK_FLOATS = 14;

/** What the engine answers for a point of the image. */
export interface EnginePick {
  /** The chief ray, world space (unit direction). */
  origin: Vec3;
  dir: Vec3;
  /** The part it meets in the scene the engine was given (none for a scene of only a camera). */
  hit: { instance: number; t: number; point: Vec3; depth: number; focusDist: number | null } | null;
}

/** Runs `fn` with the scene `rsb` loaded; null when the module refuses it. */
function withScene<T>(rt: RtFocusExports, rsb: Uint8Array, fn: (handle: number) => T): T | null {
  const ptr = rt.rt_alloc(rsb.length);
  new Uint8Array(rt.memory.buffer, ptr, rsb.length).set(rsb);
  const handle = rt.rt_scene_load(ptr, rsb.length);
  rt.rt_free(ptr, rsb.length);
  if (handle === 0) return null;
  try {
    return fn(handle);
  } finally {
    rt.rt_scene_free(handle);
  }
}

/** The pick of image point (u, v) (0..1 over the image, v down) of the scene `rsb`; null when the module refuses it. */
export function enginePick(rt: RtFocusExports, rsb: Uint8Array, u: number, v: number): EnginePick | null {
  return withScene(rt, rsb, (handle) => {
    const out = rt.rt_alloc(PICK_FLOATS * 4);
    try {
      if (rt.rt_scene_pick(handle, u, v, out) !== 0) return null;
      const f = new Float32Array(rt.memory.buffer.slice(out, out + PICK_FLOATS * 4));
      const vec = (i: number): Vec3 => [f[i], f[i + 1], f[i + 2]];
      if (![0, 1, 2, 3, 4, 5].every((i) => Number.isFinite(f[i]))) return null;
      return {
        origin: vec(0),
        dir: vec(3),
        hit: f[6] === 1 ? { instance: f[11], t: f[7], point: vec(8), depth: f[12], focusDist: Number.isFinite(f[13]) ? f[13] : null } : null,
      };
    } finally {
      rt.rt_free(out, PICK_FLOATS * 4);
    }
  });
}

/** The focus distance that puts `point` in focus through the camera of the scene `rsb`; null when none does. */
export function engineFocusAt(rt: RtFocusExports, rsb: Uint8Array, point: Vec3): number | null {
  const d = withScene(rt, rsb, (handle) => rt.rt_scene_focus_at(handle, point[0], point[1], point[2]));
  return d !== null && Number.isFinite(d) && d > 0 ? d : null;
}

/**
 * The engine's focus solver for core/focus.ts (`setFocusSolver`): the focus distance of a world point through a
 * camera's lens, for the scene `rsbOf` writes of that camera (main.ts: the camera of the output frame, io/rsb.ts
 * `lensInfoRsb`), the last 64 answers kept (the same camera and point ask once).
 */
export function focusSolverOf(rt: RtFocusExports, rsbOf: (cam: CameraState) => Uint8Array): (cam: CameraState, point: Vec3) => number | null {
  const solved = new Map<string, number | null>();
  return (cam, point) => {
    const rsb = rsbOf(cam);
    let key = '';
    for (const b of rsb) key += b.toString(16).padStart(2, '0');
    key += `|${point[0]},${point[1]},${point[2]}`;
    if (solved.has(key)) return solved.get(key)!;
    const d = engineFocusAt(rt, rsb, point);
    if (solved.size >= 64) solved.delete(solved.keys().next().value!);
    solved.set(key, d);
    return d;
  };
}

/**
 * The surface the point (u, v) of a view shows once it is in focus. A traced lens breathes (its field of view changes
 * with its focus: the gaps move), so what a pixel shows moves a little as the focus moves to it, and the point the
 * first pick met would be sharp a few pixels from the click at a large output size. The pick is repeated through the
 * camera focused on what the last one met (`focusedOn`, the state with the focus action applied) until it holds still
 * (a micrometre; each round shrinks the move by the breathing, a few hundredths): the pixel clicked shows the point and
 * the point is in focus. A camera whose chief rays do not depend on its focus (a thin lens, a tilt) meets the same point
 * again and stops at the second pick. `rsbOf` writes the view's camera-only scene of a state (io/rsb.ts
 * `focusPickRsb`), `cast` meets the view's geometry along a ray; null when the first ray meets nothing.
 */
export function settledFocusPick<S, H extends { point: Vec3 }>(
  rt: RtFocusExports,
  state: S,
  u: number,
  v: number,
  rsbOf: (s: S) => Uint8Array,
  cast: (origin: Vec3, dir: Vec3) => H | null,
  focusedOn: ((s: S, hit: H) => S | null) | null,
  tries = 4,
): H | null {
  let s = state;
  let last: H | null = null;
  for (let i = 0; i < tries; i++) {
    const ray = enginePick(rt, rsbOf(s), u, v);
    const hit = ray ? cast(ray.origin, ray.dir) : null;
    if (!hit) return last;
    if (last && Math.hypot(hit.point[0] - last.point[0], hit.point[1] - last.point[1], hit.point[2] - last.point[2]) < SETTLED_MM) return hit;
    last = hit;
    const next = focusedOn ? focusedOn(state, hit) : null;
    if (!next) return hit;
    s = next;
  }
  return last;
}

/** How still the point a settled pick meets has to hold, mm. */
const SETTLED_MM = 1e-3;
