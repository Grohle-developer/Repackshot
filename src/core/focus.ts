// Focus by distance, by point and by object (phase F1, SPEC §3.5 "Enfoque"): what a camera focuses on and how far
// that is from it, wherever the camera and the scene are (the store at rest, the playhead's pose, a gesture's live view,
// every frame of an animation, a queued job).
//
// - DISTANCE: the typed `focusDistance`, as before F1.
// - POINT: a point picked with a click, kept in the coordinates of the part it hit (`focusPoint`), so it moves with the
//   part's transforms and animation; the focus distance is the one that puts that point in focus from the camera as it
//   is at that moment.
// - OBJECT: a part, a group or the model (`focusObject`); the point of it the focus follows is, for now, the centre of
//   its bounds (◆ Fable: `OBJECT_FOCUS_POINT`, with the other two candidates ready below).
//
// "In focus" is the engine's rule (rt-core `focus`): the thin lens focuses the plane square to the view axis at the
// focus distance, so a point's distance is its depth along the axis; a tilted lens (O1) focuses the plane of the hinge
// rule, and a point's distance is the one whose plane passes through it. A traced lens (O2) is focused paraxially, its
// object plane at the focus distance in front of the entrance pupil, but wide open its spherical aberration and field
// curvature put its sharpest image millimetres away from that plane: the engine solves that from the lens's own rays
// (`rt_scene_focus_at`), and main.ts hands that solver here (`setFocusSolver`). Without it (no rt.wasm) the paraxial
// distance is used.
//
// Pure functions over ProjectState. The RSB still carries a plain focus distance per frame: io/rsb.ts asks
// `resolvedFocusDistance` for the camera it writes.

import { clipProgress, evaluate, type Pose } from './animation';
import { cameraBasis, cameraPosition, type CameraId, type CameraState, type FocusMode, type FocusPoint } from './camera';
import { getMesh } from './meshes';
import { add, boxCenter, cross, dot, emptyBox, isEmptyBox, lerp, mat4Compose, mat4Invert, mat4Multiply, normalize, scale, sub, transformBox, transformPoint, unionBox, type Box, type Mat4, type Vec3 } from './math';
import { isNeutralOptics } from './optics';
import { localMatrix, partsUnder, productBounds, sceneBounds, type NodeId } from './scene';
import type { ProjectState } from './store';

export type { FocusMode, FocusPoint } from './camera';

/** The mode of a camera (a camera made before F1 has none: DISTANCE). */
export function focusModeOf(cam: Pick<CameraState, 'focusMode'>): FocusMode {
  return cam.focusMode === 'POINT' || cam.focusMode === 'OBJECT' ? cam.focusMode : 'DISTANCE';
}

// ---------------------------------------------------------------------------
// Where the point is
// ---------------------------------------------------------------------------

/**
 * The world matrix of a node at a pose: each node's animated local transform where the pose has one, its own otherwise,
 * through its parents (the matrix io/rsb.ts writes for the engine). Without a pose, the scene at rest.
 */
export function posedWorldMatrix(state: ProjectState, id: NodeId, pose: Pose | null | undefined, cache?: Map<NodeId, Mat4>): Mat4 | null {
  const hit = cache?.get(id);
  if (hit) return hit;
  const node = state.scene.nodes[id];
  if (!node) return null;
  const p = pose?.nodes[id];
  const local = p ? mat4Compose(p.position, p.rotation, p.scale) : localMatrix(node);
  const parent = node.parent && state.scene.nodes[node.parent] ? posedWorldMatrix(state, node.parent, pose, cache) : null;
  const m = parent ? mat4Multiply(parent, local) : local;
  cache?.set(id, m);
  return m;
}

/** A world point of a part at a pose in the part's own coordinates (what POINT keeps); null when the part is gone. */
export function anchorOf(state: ProjectState, node: NodeId, world: Vec3, pose?: Pose | null): FocusPoint | null {
  const m = posedWorldMatrix(state, node, pose);
  if (!m) return null;
  const local = transformPoint(mat4Invert(m), world);
  return local.every(Number.isFinite) ? { node, point: local } : null;
}

/**
 * Which point of an object the focus follows (◆ Fable decides; the default is the centre of its bounds):
 * - `BOUNDS_CENTRE`: the centre of the box round the object's parts, as they are at that moment;
 * - `NEAREST`: the object's vertex nearest the camera along the view axis (its front);
 * - `SILHOUETTE`: the surface the camera sees at the centre of the object's outline on the image (the box round its
 *   projected vertices), along the ray through it; the bounds' centre where that ray misses the object.
 */
export type ObjectFocusPoint = 'BOUNDS_CENTRE' | 'NEAREST' | 'SILHOUETTE';
export const OBJECT_FOCUS_POINTS: readonly ObjectFocusPoint[] = ['BOUNDS_CENTRE', 'NEAREST', 'SILHOUETTE'];
/** ◆ Fable: the point of an object the focus follows. */
export const OBJECT_FOCUS_POINT: ObjectFocusPoint = 'BOUNDS_CENTRE';

/** The world positions of a part's vertices at a pose (none without its mesh data). */
function* partVertices(state: ProjectState, part: NodeId, pose: Pose | null | undefined, cache: Map<NodeId, Mat4>): Generator<Vec3> {
  const node = state.scene.nodes[part];
  const data = node?.mesh ? getMesh(node.mesh.id) : undefined;
  const m = data ? posedWorldMatrix(state, part, pose, cache) : null;
  if (!data || !m) return;
  const p = data.positions;
  for (let i = 0; i + 2 < p.length; i += 3) yield transformPoint(m, [p[i], p[i + 1], p[i + 2]]);
}

/** The box round an object's parts at a pose (the mesh's box carried by the part's matrix). */
export function posedBounds(state: ProjectState, object: NodeId, pose?: Pose | null): Box {
  const cache = new Map<NodeId, Mat4>();
  let box = emptyBox();
  for (const part of partsUnder(state, [object])) {
    const node = state.scene.nodes[part];
    const m = node?.mesh ? posedWorldMatrix(state, part, pose, cache) : null;
    if (node?.mesh && m) box = unionBox(box, transformBox(m, node.mesh.bounds));
  }
  return box;
}

/** Möller–Trumbore: the distance along a ray (unit direction) to a triangle, or null. */
function rayTriangle(o: Vec3, d: Vec3, a: Vec3, b: Vec3, c: Vec3): number | null {
  const e1 = sub(b, a);
  const e2 = sub(c, a);
  const p = cross(d, e2);
  const det = dot(e1, p);
  if (Math.abs(det) < 1e-12) return null;
  const inv = 1 / det;
  const s = sub(o, a);
  const u = dot(s, p) * inv;
  if (u < 0 || u > 1) return null;
  const q = cross(s, e1);
  const v = dot(d, q) * inv;
  if (v < 0 || u + v > 1) return null;
  const t = dot(e2, q) * inv;
  return t > 1e-9 ? t : null;
}

/** The world point of an object the camera's focus follows, by `how` (see ObjectFocusPoint); null when it has no parts. */
export function objectFocusPoint(state: ProjectState, cam: CameraState, object: NodeId, pose?: Pose | null, how: ObjectFocusPoint = OBJECT_FOCUS_POINT): Vec3 | null {
  if (!state.scene.nodes[object]) return null;
  const box = posedBounds(state, object, pose);
  if (isEmptyBox(box)) return null;
  const centre = boxCenter(box);
  if (how === 'BOUNDS_CENTRE') return centre;
  const { forward, right, up } = cameraBasis(cam.azimuth, cam.elevation);
  const pos = cameraPosition(cam);
  const cache = new Map<NodeId, Mat4>();
  const parts = partsUnder(state, [object]);
  if (how === 'NEAREST') {
    let best: Vec3 | null = null;
    let depth = Infinity;
    for (const part of parts) {
      for (const v of partVertices(state, part, pose, cache)) {
        const z = dot(sub(v, pos), forward);
        if (z > 0 && z < depth) {
          depth = z;
          best = v;
        }
      }
    }
    return best ?? centre;
  }
  // SILHOUETTE: the centre of the outline's box on the image (pinhole, tangents of the view), then the ray through it.
  let lo: [number, number] = [Infinity, Infinity];
  let hi: [number, number] = [-Infinity, -Infinity];
  for (const part of parts) {
    for (const v of partVertices(state, part, pose, cache)) {
      const d = sub(v, pos);
      const z = dot(d, forward);
      if (z <= 0) continue;
      const x = dot(d, right) / z;
      const y = dot(d, up) / z;
      lo = [Math.min(lo[0], x), Math.min(lo[1], y)];
      hi = [Math.max(hi[0], x), Math.max(hi[1], y)];
    }
  }
  if (!(lo[0] <= hi[0])) return centre;
  const dir = normalize(add(add(forward, scale(right, (lo[0] + hi[0]) / 2)), scale(up, (lo[1] + hi[1]) / 2)));
  let nearest = Infinity;
  for (const part of parts) {
    const node = state.scene.nodes[part];
    const data = node?.mesh ? getMesh(node.mesh.id) : undefined;
    const m = data ? posedWorldMatrix(state, part, pose, cache) : null;
    if (!data || !m) continue;
    const p = data.positions;
    const at = (i: number): Vec3 => transformPoint(m, [p[i * 3], p[i * 3 + 1], p[i * 3 + 2]]);
    const idx = data.indices;
    for (let k = 0; k + 2 < idx.length; k += 3) {
      const t = rayTriangle(pos, dir, at(idx[k]), at(idx[k + 1]), at(idx[k + 2]));
      if (t !== null && t < nearest) nearest = t;
    }
  }
  return Number.isFinite(nearest) ? add(pos, scale(dir, nearest)) : centre;
}

/**
 * The world point a camera's focus follows at a pose: POINT, its anchor through its part's matrix; OBJECT, the object's
 * point (`objectFocusPoint`). Null in DISTANCE, or when the part or the object is gone.
 */
export function focusTarget(state: ProjectState, cam: CameraState, pose?: Pose | null): Vec3 | null {
  const mode = focusModeOf(cam);
  if (mode === 'POINT') {
    const a = cam.focusPoint;
    if (!a) return null;
    const m = posedWorldMatrix(state, a.node, pose);
    return m ? transformPoint(m, a.point) : null;
  }
  if (mode === 'OBJECT') return cam.focusObject ? objectFocusPoint(state, cam, cam.focusObject, pose) : null;
  return null;
}

// ---------------------------------------------------------------------------
// How far that is
// ---------------------------------------------------------------------------

/**
 * The focus distance that puts `point` in focus, by the engine's rule for the camera's lens (rt-core `focus`): its depth
 * along the view axis; with a tilt (O1's thin lens) the distance `u` whose hinge-rule plane passes through it,
 * `u (f − sin α (p · b)) = f z` with `b = forward × axis`. A traced lens: its paraxial focus, the depth (the engine's
 * exact one comes through `setFocusSolver`). Null for a point behind the camera or one a tilted plane never reaches.
 */
export function focusDistanceFor(cam: CameraState, point: Vec3): number | null {
  const { forward, right, up } = cameraBasis(cam.azimuth, cam.elevation);
  const d = sub(point, cameraPosition(cam));
  const depth = dot(d, forward);
  if (!(depth > 0) || !Number.isFinite(depth)) return null;
  const o = cam.optics;
  // The engine's LENS section is written only for optics that are not the plain thin lens; a traced lens has no tilt.
  if (cam.projection === 'ORTHOGRAPHIC' || !o || isNeutralOptics(o) || o.traced || !o.tiltDeg) return depth;
  const tilt = (Math.min(45, Math.max(-45, o.tiltDeg)) * Math.PI) / 180;
  const axis = (o.tiltAxisDeg * Math.PI) / 180;
  const a = add(scale(right, Math.cos(axis)), scale(up, Math.sin(axis)));
  const b = cross(forward, a);
  const f = Math.max(1, cam.focalMm);
  const below = f - Math.sin(tilt) * dot(d, b);
  const u = (f * depth) / below;
  return below > 0 && u > 0 && Number.isFinite(u) ? u : null;
}

/** The engine's exact focus distance of a camera for a world point (main.ts: rt.wasm's `rt_scene_focus_at`), or null. */
export type FocusSolver = (cam: CameraState, point: Vec3) => number | null;

let solver: FocusSolver | null = null;
/** How far the engine's answer was from the paraxial one, by lens: what a quick resolution (a gesture's frames) adds. */
const lastOffset = new Map<string, number>();

/** main.ts hands the engine's solver once rt.wasm has loaded (null: the paraxial distance only). */
export function setFocusSolver(s: FocusSolver | null): void {
  solver = s;
  lastOffset.clear();
}

/** The lens a traced offset belongs to: what changes the solve but the camera's placement. */
function lensKey(cam: CameraState): string {
  return JSON.stringify([cam.id, cam.optics?.traced, cam.optics?.blades, cam.optics?.swirl, cam.focalMm, cam.fstop]);
}

/**
 * The distance for `point` with the camera's lens: `focusDistanceFor`, and for a traced lens the engine's solve when
 * there is one (`fast`: the last offset the engine found for this lens instead, for the frames of a gesture).
 */
function lensFocus(cam: CameraState, point: Vec3, fast: boolean): number | null {
  const paraxial = focusDistanceFor(cam, point);
  if (paraxial === null || !cam.optics?.traced || cam.projection === 'ORTHOGRAPHIC' || !solver) return paraxial;
  const key = lensKey(cam);
  if (fast) return paraxial + (lastOffset.get(key) ?? 0);
  const exact = solver(cam, point);
  if (exact === null || !Number.isFinite(exact) || exact <= 0) return paraxial;
  lastOffset.set(key, exact - paraxial);
  if (lastOffset.size > 64) lastOffset.delete(lastOffset.keys().next().value!);
  return exact;
}

/**
 * N1's FOCUS clips on the camera at a pose (a rack focus): each takes the focus from `from` towards its distance, the
 * last one winning, as `evaluate` does from the camera's own distance. In POINT and OBJECT `from` is the followed one.
 */
function focusPull(state: ProjectState, camId: CameraId, pose: Pose | null | undefined, from: number): number {
  if (!pose || pose.camera?.camera !== camId) return from;
  let out = from;
  for (const c of state.animation.clips) {
    if (c.target.kind !== 'CAMERA' || c.move !== 'FOCUS' || (c.shot !== null && c.shot !== pose.shot)) continue;
    out = lerp(from, c.amount * 1000, clipProgress(c, pose.t));
  }
  return out;
}

/**
 * The focus distance of a camera (as it is at that moment: posed, or a gesture's view) at a pose: DISTANCE, its own
 * (the animation's FOCUS clips already in it); POINT and OBJECT, the distance that puts the followed point in focus, the
 * FOCUS clips pulling from there; the last distance when the point's part or the object is gone. Always a positive
 * finite number.
 */
export function resolvedFocusDistance(state: ProjectState, cam: CameraState, pose?: Pose | null, opts: { fast?: boolean } = {}): number {
  const own = Number.isFinite(cam.focusDistance) && cam.focusDistance > 0 ? cam.focusDistance : Math.max(1, cam.distance || 1);
  if (focusModeOf(cam) === 'DISTANCE') return own;
  const target = focusTarget(state, cam, pose);
  const d = target ? lensFocus(cam, target, opts.fast === true) : null;
  return focusPull(state, cam.id, pose, d !== null && d > 0 ? d : own);
}

/**
 * The hook for the timeline, the render window, the queue and batches: the focus distance camera `camId` renders with
 * at time `t` (seconds; null: the scene at rest), as `projectScene` writes it for a frame of that camera (its pose when
 * the animation moves it, the parts where the animation has them). Null when there is no such camera.
 */
export function focusDistanceAt(state: ProjectState, camId: CameraId, t: number | null, opts: { fast?: boolean } = {}): number | null {
  const base = state.camera.cameras[camId];
  if (!base) return null;
  const pose = t !== null && state.animation.clips.length > 0 ? evaluate(state, t) : null;
  const cam = pose?.camera?.camera === camId ? { ...base, ...pose.camera, id: camId } : base;
  return resolvedFocusDistance(state, cam, pose, opts);
}

/**
 * The range of the focus distance's slider (◆ Fable: the range and its logarithmic scale): from half the nearest to
 * twice the farthest depth of the product's box along the camera's view axis (its eight corners; the whole scene's
 * without a product), at least a decade wide, and always with `value` in it. Millimetres, never below 1.
 */
export function focusRange(state: ProjectState, cam: CameraState, value: number): { lo: number; hi: number } {
  let box = productBounds(state, true);
  if (isEmptyBox(box)) box = sceneBounds(state, true);
  const { forward } = cameraBasis(cam.azimuth, cam.elevation);
  const pos = cameraPosition(cam);
  let near = Infinity;
  let far = -Infinity;
  if (!isEmptyBox(box)) {
    for (let i = 0; i < 8; i++) {
      const c: Vec3 = [i & 1 ? box.max[0] : box.min[0], i & 2 ? box.max[1] : box.min[1], i & 4 ? box.max[2] : box.min[2]];
      const z = dot(sub(c, pos), forward);
      near = Math.min(near, z);
      far = Math.max(far, z);
    }
  }
  const d = Math.max(1, cam.distance || 1);
  if (!(near > 0)) near = d / 10;
  if (!(far > near)) far = d * 2;
  let lo = Math.max(1, near * 0.5);
  let hi = Math.max(far * 2, lo * 10);
  if (Number.isFinite(value) && value > 0) {
    lo = Math.max(1, Math.min(lo, value));
    hi = Math.max(hi, value);
  }
  return { lo, hi };
}

// ---------------------------------------------------------------------------
// The store's side
// ---------------------------------------------------------------------------

/**
 * Keeps what POINT and OBJECT derive in step (store.ts `reduce`, after every action that changes a camera or the scene):
 * each such camera's `focusDistance` is the distance it resolves to at rest (the paraxial one: the store does not ask
 * the engine), and a camera whose point's part or object is gone falls back to DISTANCE at its last distance (its anchor
 * dropped, so an id given to a new part later does not take the focus). The same state when nothing changes.
 */
export function syncFocus(state: ProjectState, prev: ProjectState | null): ProjectState {
  if (prev && state.camera === prev.camera && state.scene === prev.scene) return state;
  let cameras: Record<CameraId, CameraState> | null = null;
  for (const [id, cam] of Object.entries(state.camera.cameras)) {
    const mode = focusModeOf(cam);
    if (mode === 'DISTANCE') continue;
    let next: CameraState = cam;
    const target = mode === 'POINT' ? cam.focusPoint?.node : cam.focusObject;
    if (!target || !state.scene.nodes[target]) {
      next = { ...cam, focusMode: 'DISTANCE', focusPoint: null, focusObject: null };
    } else {
      const point = focusTarget(state, cam, null);
      const d = point ? focusDistanceFor(cam, point) : null;
      if (d !== null && Math.abs(d - cam.focusDistance) > Math.max(cam.focusDistance, 1) * 1e-9) next = { ...cam, focusDistance: d };
    }
    if (next !== cam) (cameras ??= { ...state.camera.cameras })[id] = next;
  }
  return cameras ? { ...state, camera: { ...state.camera, cameras } } : state;
}

/** A camera's focus fields as a project file or a library item has them, read for this version (unknown: DISTANCE). */
export function normaliseFocus(raw: { focusMode?: unknown; focusPoint?: unknown; focusObject?: unknown }): Pick<CameraState, 'focusMode' | 'focusPoint' | 'focusObject'> {
  const mode = raw.focusMode;
  const p = raw.focusPoint as { node?: unknown; point?: unknown } | null | undefined;
  const point: FocusPoint | null =
    p && typeof p === 'object' && typeof p.node === 'string' && Array.isArray(p.point) && p.point.length === 3 && p.point.every((v) => typeof v === 'number' && Number.isFinite(v))
      ? { node: p.node, point: [p.point[0], p.point[1], p.point[2]] as Vec3 }
      : null;
  const object = typeof raw.focusObject === 'string' ? raw.focusObject : null;
  if (mode === 'POINT' && point) return { focusMode: 'POINT', focusPoint: point, focusObject: null };
  if (mode === 'OBJECT' && object) return { focusMode: 'OBJECT', focusPoint: null, focusObject: object };
  return {};
}

/** The camera with its focus fields read by `normaliseFocus` (the fields left out when it is DISTANCE). */
export function withNormalFocus<T extends CameraState>(cam: T): T {
  const has = cam.focusMode !== undefined || cam.focusPoint !== undefined || cam.focusObject !== undefined;
  if (!has) return cam;
  const { focusMode: _m, focusPoint: _p, focusObject: _o, ...rest } = cam;
  return { ...rest, ...normaliseFocus(cam) } as T;
}
