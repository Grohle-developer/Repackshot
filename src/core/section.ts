// The section view (phase Q1, SPEC §3.8): a cutting plane that removes one side of the model and caps the cut, to
// show how a product is made inside. It is one object of the project (`state.section`, `null` until the person
// makes one), set three ways (a click on a surface and an axis, two points, numbers), switched on and off, flipped,
// and animated as one more movement (the SECTION move of a clip moves the plane along its normal over the clip).
// Every change is an action of the store and can be undone (`section/*`); the plane is saved with the project.
//
// The plane is in world space (millimetres, Z up) as `point` and `normal`; the normal points to the side that is
// REMOVED. What stays is `normal · (p − point) <= offset`, where `offset` is what the animation adds (the SECTION
// clips, along the normal), zero at rest. The engine reads it as `SECT` (io/rsb.ts: `normal · p = distance`), the
// Fast preview as a clipping plane of three.js (render/preview.ts), the same plane in both.

import { cameraBasis, cameraPosition } from './camera';
import { add, boxCenter, cross, dot, isEmptyBox, length, normalize, scale, sub, type Vec3 } from './math';
import { getMesh } from './meshes';
import { allParts, effectiveVisible, partWorldBounds, productBounds, type NodeId } from './scene';
import { isClosedSolid } from './solid';
import type { Action, ActionBase, ProjectState } from './store';
import { viewedCamera, type ViewObject } from './view-objects';

/** The cutting plane of the project. */
export interface SectionPlane {
  /** Cut on: the model is shown cut. Off, the plane is kept (and can be turned on again) but nothing is cut. */
  enabled: boolean;
  /** A point of the plane, mm, world space (where the animation has not moved it). */
  point: Vec3;
  /** Unit normal, pointing to the side that is removed. */
  normal: Vec3;
  /** Cap the closed solids the plane cuts with their material; off, the cut shows their inside. */
  cap: boolean;
}

/** The directions a click on a surface can cut across: the three world axes or the normal of the surface. */
export type SectionAxis = 'X' | 'Y' | 'Z' | 'SURFACE';

export const SECTION_AXES: readonly SectionAxis[] = ['X', 'Y', 'Z', 'SURFACE'];

/** The plane as the engines take it: `normal · p = distance` (mm), what stays is `normal · p <= distance`. */
export interface ResolvedSection {
  normal: Vec3;
  distance: number;
  cap: boolean;
}

/** A point and a normal, what the ways of setting a plane give (the rest of the plane is the project's). */
export interface SectionFrame {
  point: Vec3;
  normal: Vec3;
}

function finite3(v: unknown): v is Vec3 {
  return Array.isArray(v) && v.length >= 3 && v.slice(0, 3).every((x) => typeof x === 'number' && Number.isFinite(x));
}

/** The unit vector of `v`, or null when it has no direction (zero, or not finite). */
export function unitOrNull(v: readonly number[]): Vec3 | null {
  if (!finite3(v)) return null;
  const l = length(v);
  return l > 1e-9 ? normalize(v) : null;
}

/** The opposite vector, without the negative zeros that `scale(v, -1)` would leave in the project. */
const opposite = (v: readonly number[]): Vec3 => [v[0] === 0 ? 0 : -v[0], v[1] === 0 ? 0 : -v[1], v[2] === 0 ? 0 : -v[2]];

const AXIS_VECTORS: Readonly<Record<'X' | 'Y' | 'Z', Vec3>> = { X: [1, 0, 0], Y: [0, 1, 0], Z: [0, 0, 1] };

/**
 * The plane of a click on a surface: through the clicked `point`, across `axis` (the plane's normal is that axis, or
 * the surface's own normal for SURFACE). The removed side is the one facing the viewer (`from`: where the camera is),
 * so the cut opens towards the person who made it; the surface's normal already faces them. Null for a surface
 * without a usable normal.
 */
export function sectionFromClick(point: readonly number[], axis: SectionAxis, surfaceNormal: readonly number[], from: readonly number[]): SectionFrame | null {
  if (!finite3(point) || !finite3(from)) return null;
  const n = axis === 'SURFACE' ? unitOrNull(surfaceNormal) : AXIS_VECTORS[axis];
  if (!n) return null;
  const toViewer = sub(from, point);
  // A plane seen exactly edge-on keeps the axis' own sign.
  const normal = dot(n, toViewer) < 0 ? opposite(n) : n;
  return { point: [point[0], point[1], point[2]], normal };
}

/**
 * The plane of two points: through both and containing the view direction `forward` (camera to scene), so it is the
 * line the person drew on the screen seen end-on. The side removed is the one to the LEFT of the line from the first
 * point to the second, as the viewer sees it (drawing from left to right removes what is above the line). Null when
 * the points are the same or the line they make is along the view direction (no plane is defined then).
 */
export function sectionFromTwoPoints(a: readonly number[], b: readonly number[], forward: readonly number[]): SectionFrame | null {
  if (!finite3(a) || !finite3(b) || !finite3(forward)) return null;
  const f = unitOrNull(forward);
  const d = sub(b, a);
  if (!f || length(d) < 1e-9) return null;
  // For the camera basis (forward, right, up), cross(right, forward) is up: the left of a line drawn to the right.
  const n = unitOrNull(cross(d, f));
  if (!n || length(cross(d, f)) < 1e-6 * length(d)) return null;
  return { point: [a[0], a[1], a[2]], normal: n };
}

/** The same plane the other way round: the removed side is the kept one. */
export function flippedSection(p: SectionPlane): SectionPlane {
  return { ...p, normal: opposite(p.normal) };
}

/** A plane made of a frame, switched on, capped. */
export function sectionOf(frame: SectionFrame, cap = true): SectionPlane {
  return { enabled: true, point: frame.point, normal: frame.normal, cap };
}

/**
 * The plane a first Section starts from when none was set: through the middle of the product, across the camera's
 * horizontal direction, so half of it (the half nearer the camera) goes and the cut faces the person. Without a
 * product, through the origin.
 */
export function defaultSection(state: ProjectState): SectionPlane {
  const box = productBounds(state, true);
  const centre: Vec3 = isEmptyBox(box) ? [0, 0, 0] : boxCenter(box);
  const cam = state.camera.cameras[state.camera.active];
  const toCamera = cam ? sub(cameraPosition(cam), centre) : ([0, -1, 0] as Vec3);
  const flat = unitOrNull([toCamera[0], toCamera[1], 0]) ?? ([0, -1, 0] as Vec3);
  return { enabled: true, point: centre, normal: flat, cap: true };
}

/**
 * The plane at an instant, as the engines take it: `offsetMm` is what the animation moved it along its normal (the
 * SECTION clips of the pose, mm; 0 at rest). Null without an enabled plane.
 */
export function resolveSection(p: SectionPlane | null | undefined, offsetMm = 0): ResolvedSection | null {
  if (!p || !p.enabled) return null;
  const n = unitOrNull(p.normal);
  if (!n || !finite3(p.point)) return null;
  const moved = add(p.point, scale(n, Number.isFinite(offsetMm) ? offsetMm : 0));
  return { normal: n, distance: dot(n, moved), cap: p.cap };
}

/** The plane of the project at an instant of the animation (its `Pose`, or at rest), as the engines take it. */
export function sectionAt(state: ProjectState, offsetMm = 0): ResolvedSection | null {
  return resolveSection(state.section, offsetMm);
}

// ------------------------------------------------------------------ what it cuts

/**
 * True when the section would cap this part: a closed solid (core/solid.ts) with a material that has an inside. The
 * engine and the Fast preview both cap exactly these. A part with a material per face is open to the engine (it sees
 * each face group as a sheet of its own), and a thin-walled glass has no inside.
 */
export function partIsCapped(state: ProjectState, id: NodeId): boolean {
  const node = state.scene.nodes[id];
  if (!node || node.kind !== 'PART' || !node.mesh) return false;
  if (node.faceMaterials?.length) return false;
  const inst = node.material ? state.materials[node.material] : undefined;
  if (inst && inst.family === 'GLASS' && inst.params.walls === 'THIN') return false;
  const data = getMesh(node.mesh.id);
  return !!data && isClosedSolid(data);
}

/** The visible parts a plane crosses (their box has both sides of it), in the scene's order. */
export function partsCutBy(state: ProjectState, p: Pick<SectionPlane, 'point' | 'normal'>): NodeId[] {
  const cache = new Map();
  const d = dot(p.normal, p.point);
  return allParts(state).filter((id) => {
    if (!effectiveVisible(state, id) || !state.scene.nodes[id].mesh) return false;
    const b = partWorldBounds(state, id, cache);
    if (isEmptyBox(b)) return false;
    // The corner of the box nearest to the removed side, and the farthest.
    let lo = 0;
    let hi = 0;
    for (let k = 0; k < 3; k++) {
      const a = p.normal[k] * b.min[k];
      const c = p.normal[k] * b.max[k];
      lo += Math.min(a, c);
      hi += Math.max(a, c);
    }
    return lo <= d && d <= hi;
  });
}

/** The parts the plane crosses that cannot be capped: the cut shows their inside. */
export function openPartsCut(state: ProjectState, p: Pick<SectionPlane, 'point' | 'normal'>): NodeId[] {
  return partsCutBy(state, p).filter((id) => !partIsCapped(state, id));
}

// ------------------------------------------------------------------ clicks

/**
 * What the viewport's next click makes of the plane (the pick mode of the Section inspector): across an axis through
 * the clicked point, or the first and then the second point of a line.
 */
export type SectionPick = { kind: 'axis'; axis: SectionAxis } | { kind: 'line'; first: Vec3 | null };

/**
 * What a click at `point` (with the surface's `normal`) does in a pick mode: the action that makes the plane and the
 * mode that goes on (null: done). The plane keeps the cap setting of the one it replaces. The first click of a line
 * only remembers its point; a second one that makes no plane (the same point, a line along the view) is refused and
 * the mode stays on the second point. The side removed is the one facing the camera that is seen (`lookThrough`, else
 * the active one).
 */
export function sectionClick(state: ProjectState, lookThrough: ViewObject | null | undefined, pick: SectionPick, point: readonly number[], normal: readonly number[]): { action: Action | null; next: SectionPick | null } {
  const cam = viewedCamera(state, lookThrough);
  const cap = state.section?.cap ?? true;
  if (pick.kind === 'axis') {
    const frame = sectionFromClick(point, pick.axis, normal, cameraPosition(cam));
    return frame ? { action: { type: 'section/set', plane: sectionOf(frame, cap) }, next: null } : { action: null, next: pick };
  }
  if (!pick.first) return { action: null, next: { kind: 'line', first: [point[0], point[1], point[2]] } };
  const frame = sectionFromTwoPoints(pick.first, point, cameraBasis(cam.azimuth, cam.elevation).forward);
  return frame ? { action: { type: 'section/set', plane: sectionOf(frame, cap) }, next: null } : { action: null, next: pick };
}

// ------------------------------------------------------------------ actions

/** What may be patched on the plane: the numbers of the inspector. */
export type SectionPatch = Partial<Pick<SectionPlane, 'enabled' | 'point' | 'normal' | 'cap'>>;

export type SectionAction =
  /** Makes the plane (the click, the two points, the first press of the switch): replaces any plane, switched on. */
  | ({ type: 'section/set'; plane: SectionPlane } & ActionBase)
  /** Changes some fields of the plane (the numeric point and normal, the cap); nothing when there is none. */
  | ({ type: 'section/patch'; patch: SectionPatch } & ActionBase)
  /** Switches the cut on or off. Without a plane, on makes the default one (`defaultSection`). */
  | ({ type: 'section/enable'; enabled: boolean } & ActionBase)
  /** Flips the side that goes. */
  | ({ type: 'section/flip' } & ActionBase)
  /** Takes the plane away altogether. */
  | ({ type: 'section/clear' } & ActionBase);

/** The plane as the interface may hold it: unit normal, finite numbers; null when it cannot be one. */
export function cleanSection(p: SectionPlane): SectionPlane | null {
  const normal = unitOrNull(p.normal);
  if (!normal || !finite3(p.point)) return null;
  return { enabled: p.enabled !== false, point: [p.point[0], p.point[1], p.point[2]], normal, cap: p.cap !== false };
}

function same(a: SectionPlane, b: SectionPlane): boolean {
  return a.enabled === b.enabled && a.cap === b.cap && a.point.every((v, i) => v === b.point[i]) && a.normal.every((v, i) => v === b.normal[i]);
}

export function reduceSection(state: ProjectState, action: SectionAction): ProjectState {
  const cur = state.section;
  const put = (next: SectionPlane | null): ProjectState => (next === cur || (next && cur && same(next, cur)) ? state : { ...state, section: next });
  switch (action.type) {
    case 'section/set': {
      const plane = cleanSection(action.plane);
      return plane ? put(plane) : state;
    }
    case 'section/patch': {
      if (!cur) return state;
      const merged = cleanSection({ ...cur, ...action.patch });
      return merged ? put(merged) : state;
    }
    case 'section/enable': {
      if (!cur) return action.enabled ? put(defaultSection(state)) : state;
      return put({ ...cur, enabled: action.enabled });
    }
    case 'section/flip':
      return cur ? put(flippedSection(cur)) : state;
    case 'section/clear':
      return put(null);
    default:
      return state;
  }
}

// ------------------------------------------------------------------ files

/** The section of a project file, checked: a plane that cannot be one is none (a project of before Q1 has none). */
export function normalizeSection(raw: unknown): SectionPlane | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (!finite3(o.point) || !finite3(o.normal)) return null;
  return cleanSection({ enabled: o.enabled !== false, point: [o.point[0], o.point[1], o.point[2]], normal: [o.normal[0], o.normal[1], o.normal[2]], cap: o.cap !== false });
}
