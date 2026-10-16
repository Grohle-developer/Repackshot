// Lights and cameras as objects of the viewport (phase L4 and its extension, "luces y cámaras en el visor, mirar a
// través"): where the move tool's gizmo sits on one and what a drag of it does, the view from one ("Look through")
// and what navigating that view does to it, and the achromatic glyphs the viewport draws for them (a panel's
// outline, a spot's cone, a point, a sun's arrow, a saved camera's frustum) with the click that picks one.
//
// Pure functions over ProjectState, in model space (Z up, mm). The preview draws the glyphs and the gizmo and
// measures the drags (render/preview.ts, render/gizmo.ts); the interface turns the drags and the navigation into the
// actions written here, one gesture token per drag, so a whole drag is one undo entry.

import { activeCamera, aspectRatio, cameraBasis, cameraPosition, clipPlanesFor, fieldOfView, focusDistanceTo, focusFollowsOrbit, orbitFromPosition, orbitPatch, outputAspect, outputFrameRect, sameView, type CameraState, type OrbitView } from './camera';
import { polar } from './light-math';
import { aimOffset, isSphereLike, levelUp, lightFrame, polarAboutPivot, SPOT_DEFAULTS, wrapDeg, type LightInstance } from './lighting';
import { add, boxRadius, cross, dot, isEmptyBox, length, normalize, rotateAbout, scale, sub, type Vec3 } from './math';
import { productBounds } from './scene';
import type { Action, ActionLabel, ProjectState } from './store';
import { snapDelta, type GizmoDelta, type GizmoFrame, type Space } from './transform';

/** A light of the rig or a camera of the project, as the viewport shows it. */
export interface ViewObject {
  kind: 'LIGHT' | 'CAMERA';
  id: string;
}

export const sameObject = (a: ViewObject | null | undefined, b: ViewObject | null | undefined): boolean => (a ?? null) === (b ?? null) || (!!a && !!b && a.kind === b.kind && a.id === b.id);

/** The light or camera an id names, if it does. */
export function objectOf(state: ProjectState, id: string): ViewObject | null {
  if (state.studio.lights.some((l) => l.id === id)) return { kind: 'LIGHT', id };
  if (state.camera.cameras[id]) return { kind: 'CAMERA', id };
  return null;
}

/** The light or camera that is selected (the selection holds one at most, SPEC §3.2), or null. */
export function selectedObject(state: ProjectState): ViewObject | null {
  for (const id of state.selection.ids) {
    const o = objectOf(state, id);
    if (o) return o;
  }
  return null;
}

function lightOf(state: ProjectState, id: string): LightInstance | undefined {
  return state.studio.lights.find((l) => l.id === id);
}

/** Where an object is, where it looks, and its own axes (right, up, back: X, Y, Z of a camera in three.js terms). */
export interface ObjectPose {
  position: Vec3;
  target: Vec3;
  right: Vec3;
  up: Vec3;
  /** Unit, from the position towards the target. */
  forward: Vec3;
}

export function objectPose(state: ProjectState, obj: ViewObject): ObjectPose | null {
  if (obj.kind === 'LIGHT') {
    const l = lightOf(state, obj.id);
    if (!l) return null;
    const f = lightFrame(state, l);
    return { position: f.position, target: f.target, right: f.right, up: f.up, forward: f.forward };
  }
  const cam = state.camera.cameras[obj.id];
  if (!cam) return null;
  const b = cameraBasis(cam.azimuth, cam.elevation);
  return { position: cameraPosition(cam), target: [cam.target[0], cam.target[1], cam.target[2]], right: b.right, up: b.up, forward: b.forward };
}

// ---------------------------------------------------------------------------
// The gizmo on a light or a camera
// ---------------------------------------------------------------------------

/**
 * Where the gizmo of the move tool sits on an object: at its position, with the world's axes (GLOBAL) or its own
 * (LOCAL: right, up and back from what it looks at), and the aim handle at what it looks at (a light's aim, a
 * camera's target). Null when it is gone or is a locked camera (Lock camera: nothing moves it).
 */
export function objectFrame(state: ProjectState, obj: ViewObject, space: Space): { frame: GizmoFrame; aim: { from: Vec3; target: Vec3 } } | null {
  if (obj.kind === 'CAMERA' && state.camera.cameras[obj.id]?.locked) return null;
  const p = objectPose(state, obj);
  if (!p) return null;
  const axes: [Vec3, Vec3, Vec3] = space === 'LOCAL' ? [p.right, p.up, scale(p.forward, -1)] : [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  return { frame: { origin: p.position, axes }, aim: { from: p.position, target: p.target } };
}

/** Signed roll (degrees) of an up vector about `forward` from the level one. */
export function rollOf(forward: Vec3, up: Vec3): number {
  const level = levelUp(forward);
  const u = normalize(sub(up, scale(forward, dot(up, forward))));
  if (length(u) === 0) return 0;
  const r = wrapDeg((Math.atan2(dot(forward, cross(level, u)), dot(level, u)) * 180) / Math.PI);
  return Math.abs(r) < 1e-9 ? 0 : r;
}

/** The world displacement of a move delta in a frame's axes. */
function moveVector(frame: GizmoFrame, amounts: Vec3): Vec3 {
  return add(add(scale(frame.axes[0], amounts[0]), scale(frame.axes[1], amounts[1])), scale(frame.axes[2], amounts[2]));
}

/**
 * The action a drag of the gizmo makes of an object, measured from `start` (the state when the drag began) and
 * snapped with Shift; null when it does nothing. A light: moving it keeps it aimed where it was (its aim, or the
 * rig's pivot: setup lights keep looking at the product), turning it turns where it aims and its roll about its
 * position, and the aim handle moves its aim. A camera: the same with its target (it cannot roll). Scaling is not
 * for them (the move tool's scale handles are hidden on an object).
 */
export function objectGizmoAction(start: ProjectState, obj: ViewObject, frame: GizmoFrame, delta0: GizmoDelta, snap: boolean, meta: { label?: ActionLabel; gesture?: string } = {}): Action | null {
  const delta = snap ? snapDelta(delta0) : delta0;
  const p = objectPose(start, obj);
  if (!p || delta.kind === 'scale') return null;
  let position = p.position;
  let target = p.target;
  let up = p.up;
  if (delta.kind === 'move') position = add(p.position, moveVector(frame, delta.amounts));
  else if (delta.kind === 'rotate') {
    const axis = frame.axes[delta.axis];
    target = add(p.position, rotateAbout(sub(p.target, p.position), axis, delta.deg));
    up = rotateAbout(p.up, axis, delta.deg);
  } else target = [delta.target[0], delta.target[1], delta.target[2]];
  if (length(sub(target, position)) < 1e-6) return null;
  if (obj.kind === 'LIGHT') {
    const l = lightOf(start, obj.id)!;
    let patch: Partial<LightInstance>;
    if (delta.kind === 'move') {
      const polarPos = polarAboutPivot(start, position);
      if (!polarPos) return null;
      patch = polarPos;
    } else {
      patch = { aim: aimOffset(start, target) };
      if (delta.kind === 'rotate') patch.roll = rollOf(normalize(sub(target, position)), up);
      else if (l.roll === undefined) delete patch.roll;
    }
    return { type: 'studio/setLight', id: obj.id, patch, ...meta };
  }
  const cam = start.camera.cameras[obj.id];
  if (!cam || cam.locked) return null;
  const o = orbitFromPosition(position, target);
  const patch: Partial<Omit<CameraState, 'id'>> = { azimuth: o.azimuth, elevation: o.elevation, distance: o.distance, target };
  // A focus that followed the target (orbiting sets it so) goes on following it.
  if (focusFollowsOrbit(cam)) patch.focusDistance = o.distance;
  if (sameView(cam, patch)) return null;
  return { type: 'camera/set', id: obj.id, patch, ...meta };
}

// ---------------------------------------------------------------------------
// Look through
// ---------------------------------------------------------------------------

/** The longest and shortest focal a look through a spot fits its cone with, mm on the 36 mm sensor. */
const SPOT_FOCAL = { min: 8, max: 600 } as const;

/**
 * The view from an object ("Look through", UI.md §2.3): a camera's own view, or for a light a camera at the light
 * looking at its aim, with the active camera's optics (a spot's focal fits its cone in the frame's shorter side, so
 * what the view shows is what the spot lights). Null when the object is gone or is the active camera (it is the
 * view already).
 */
export function lookThroughCamera(state: ProjectState, obj: ViewObject): CameraState | null {
  if (obj.kind === 'CAMERA') {
    if (obj.id === state.camera.active) return null;
    return state.camera.cameras[obj.id] ?? null;
  }
  const l = lightOf(state, obj.id);
  const base = activeCamera(state);
  if (!l || !base) return null;
  const f = lightFrame(state, l);
  const o = orbitFromPosition(f.position, f.target);
  if (o.distance <= 0) return null;
  const b = productBounds(state, true);
  const radius = isEmptyBox(b) ? state.scene.partSizeMm || 200 : boxRadius(b);
  let focalMm = base.focalMm;
  if (l.type === 'SPOT') {
    const aspect = outputAspect(state);
    const shortHalf = aspect >= 1 ? 18 / aspect : 18;
    const half = (Math.min(170, Math.max(1, l.spread)) * Math.PI) / 360;
    focalMm = Math.min(SPOT_FOCAL.max, Math.max(SPOT_FOCAL.min, shortHalf / Math.tan(half)));
  }
  return {
    ...base,
    id: obj.id,
    name: '',
    azimuth: o.azimuth,
    elevation: o.elevation,
    distance: o.distance,
    target: [f.target[0], f.target[1], f.target[2]],
    focalMm,
    fstop: 0,
    lens: null,
    projection: 'PERSPECTIVE',
    focusDistance: o.distance,
    locked: false,
    ...clipPlanesFor(o.distance, radius),
  };
}

/**
 * The camera whose view the viewport shows: the one looked through (a light's, or a saved camera's), else the active
 * one. Its aspect ratio is the frame the viewport draws (U13).
 */
export function viewedCamera(state: ProjectState, lookThrough: ViewObject | null | undefined): CameraState {
  return (lookThrough ? lookThroughCamera(state, lookThrough) : null) ?? activeCamera(state);
}

/**
 * Focus with a click: the focus plane of the camera that is seen goes through `point`, measured from that camera (the
 * one looked through, else the active one; the view of a light has no focus, so the active camera takes it). Null
 * when that camera is not in the project.
 */
export function focusPickAction(state: ProjectState, lookThrough: ViewObject | null | undefined, point: Vec3, meta: { label?: ActionLabel } = {}): Action | null {
  const seen = viewedCamera(state, lookThrough);
  const cam = state.camera.cameras[seen.id] ?? activeCamera(state);
  if (!cam) return null;
  return { type: 'camera/set', id: cam.id, patch: { focusDistance: focusDistanceTo(cam, point) }, ...meta };
}

/** A view of the viewport's navigation: where it orbits, how far and from where (preview.ts ViewChange). */
export type ViewPose = OrbitView;

/**
 * What navigating the view from an object does to it: Orbit, Pan and Zoom move that object. A light goes where the
 * view is and aims where it looks (keeping its roll); a camera takes the view. Null when nothing changes, the object
 * is gone, or it is a locked camera (Lock camera holds it).
 */
export function lookThroughAction(state: ProjectState, obj: ViewObject, view: ViewPose, meta: { label?: ActionLabel; gesture?: string } = {}): Action | null {
  if (obj.kind === 'CAMERA') {
    const cam = state.camera.cameras[obj.id];
    if (!cam || cam.locked) return null;
    const patch = orbitPatch(cam, view);
    return patch ? { type: 'camera/set', id: obj.id, patch, ...meta } : null;
  }
  const l = lightOf(state, obj.id);
  if (!l || !(view.distance > 0)) return null;
  const position = add(view.target, polar(view.azimuth, view.elevation, view.distance));
  const polarPos = polarAboutPivot(state, position);
  if (!polarPos) return null;
  const aim = aimOffset(state, view.target);
  const size = state.scene.partSizeMm || 1;
  const tol = 1e-9;
  const same = Math.abs(wrapDeg(polarPos.az - l.az)) < 1e-6 && Math.abs(polarPos.el - l.el) < 1e-6 && Math.abs(polarPos.dist - l.dist) * size < Math.max(1, l.dist * size) * 1e-6 && length(sub(aim, l.aim ?? [0, 0, 0])) * size < Math.max(1, l.dist * size) * 1e-6 + tol;
  if (same) return null;
  return { type: 'studio/setLight', id: obj.id, patch: { ...polarPos, aim }, ...meta };
}

// ---------------------------------------------------------------------------
// Glyphs
// ---------------------------------------------------------------------------

/** A glyph: line segments (pairs of points) and dots (drawn a few pixels wide whatever the distance), model space. */
export interface Glyph {
  obj: ViewObject;
  /** Flattened pairs: [a0, b0, a1, b1, ...]. */
  lines: Vec3[];
  dots: Vec3[];
}

/** How big the glyphs are, in part sizes, where they have no size of their own. */
export const GLYPH = {
  /** The tick from a panel's centre along where it shines. */
  tick: 0.3,
  /** A spot's cone is drawn this long (at most as far as its aim). */
  cone: 0.6,
  /** The star of a point light. */
  star: 0.06,
  /** A sun's arrow, its disc. */
  arrow: 0.7,
  disc: 0.1,
  /** A camera's frustum is drawn this deep. */
  frustum: 0.6,
  /** Segments of a circle. */
  segments: 32,
} as const;

function circle(out: Vec3[], centre: Vec3, a: Vec3, b: Vec3, ra: number, rb: number, n: number = GLYPH.segments): void {
  let prev = add(centre, scale(a, ra));
  for (let i = 1; i <= n; i++) {
    const t = (i / n) * 2 * Math.PI;
    const p = add(add(centre, scale(a, ra * Math.cos(t))), scale(b, rb * Math.sin(t)));
    out.push(prev, p);
    prev = p;
  }
}

function lightGlyph(state: ProjectState, l: LightInstance): Glyph {
  const size = state.scene.partSizeMm || 1;
  const f = lightFrame(state, l);
  const lines: Vec3[] = [];
  const dots: Vec3[] = [];
  const c = f.position;
  const throwTo = length(sub(f.target, c));
  if (l.type === 'SUN') {
    // An arrow from the sun towards what it lights, and its disc with rays.
    const len = Math.min(GLYPH.arrow * size, throwTo * 0.8);
    const tip = add(c, scale(f.forward, len));
    lines.push(c, tip);
    const head = len * 0.18;
    for (const s of [f.right, f.up]) {
      lines.push(tip, add(add(tip, scale(f.forward, -head)), scale(s, head * 0.5)));
      lines.push(tip, add(add(tip, scale(f.forward, -head)), scale(s, -head * 0.5)));
    }
    const r = GLYPH.disc * size;
    circle(lines, c, f.right, f.up, r, r, 16);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * 2 * Math.PI;
      const d = add(scale(f.right, Math.cos(a)), scale(f.up, Math.sin(a)));
      lines.push(add(c, scale(d, r * 1.4)), add(c, scale(d, r * 1.9)));
    }
    return { obj: { kind: 'LIGHT', id: l.id }, lines, dots };
  }
  if (l.type === 'SPOT') {
    const len = Math.max(1e-6, Math.min(GLYPH.cone * size, throwTo));
    const half = (Math.min(170, Math.max(1, l.spread)) * Math.PI) / 360;
    const r = len * Math.tan(half);
    const base = add(c, scale(f.forward, len));
    circle(lines, base, f.right, f.up, r, r);
    for (const d of [f.right, scale(f.right, -1), f.up, scale(f.up, -1)]) lines.push(c, add(base, scale(d, r)));
    // The inner cone, where the soft edge starts.
    const inner = half * (1 - Math.min(1, Math.max(0, l.blend ?? SPOT_DEFAULTS.blend)));
    if (inner > 0 && inner < half - 1e-3) circle(lines, base, f.right, f.up, len * Math.tan(inner), len * Math.tan(inner), 24);
    dots.push(c);
    return { obj: { kind: 'LIGHT', id: l.id }, lines, dots };
  }
  if (isSphereLike(l)) {
    // A point (with a small star), or a glowing sphere's outline in two planes.
    const r = (Math.max(0, l.size) * size) / 2;
    if (l.type === 'AREA' && r > 0) {
      circle(lines, c, f.right, f.up, r, r);
      circle(lines, c, f.right, f.forward, r, r);
    }
    const star = Math.max(r * 1.3, GLYPH.star * size);
    for (const d of [f.right, f.up, f.forward]) lines.push(add(c, scale(d, -star)), add(c, scale(d, star)));
    dots.push(c);
    return { obj: { kind: 'LIGHT', id: l.id }, lines, dots };
  }
  // A panel: its outline (a rectangle, or the ellipse of a disc), and a tick along where it shines.
  const w = (Math.max(1e-3, l.size) * size) / 2;
  const h = (Math.max(1e-3, l.shape === 'SQUARE' || l.shape === 'DISK' ? l.size : l.sizeY) * size) / 2;
  if (l.shape === 'DISK' || l.shape === 'ELLIPSE') circle(lines, c, f.right, f.up, w, h);
  else {
    const corner = (sx: number, sy: number) => add(add(c, scale(f.right, sx * w)), scale(f.up, sy * h));
    const k = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)];
    for (let i = 0; i < 4; i++) lines.push(k[i], k[(i + 1) % 4]);
  }
  lines.push(c, add(c, scale(f.forward, Math.min(GLYPH.tick * size, throwTo * 0.5))));
  return { obj: { kind: 'LIGHT', id: l.id }, lines, dots };
}

function cameraGlyph(state: ProjectState, cam: CameraState): Glyph {
  const size = state.scene.partSizeMm || 1;
  const b = cameraBasis(cam.azimuth, cam.elevation);
  const pos = cameraPosition(cam);
  const depth = Math.min(GLYPH.frustum * size, cam.distance * 0.5);
  // Each camera draws the frame of its own image ratio (U13).
  const aspect = aspectRatio(cam);
  let hw: number;
  let hh: number;
  let near: [number, number];
  if (cam.projection === 'ORTHOGRAPHIC') {
    hw = cam.orthoWidth / 2;
    hh = hw / aspect;
    near = [hw, hh];
  } else {
    const fov = fieldOfView(cam.focalMm, aspect);
    hw = depth * Math.tan(fov.h / 2);
    hh = depth * Math.tan(fov.v / 2);
    near = [0, 0];
  }
  const at = (d: number, x: number, y: number) => add(add(add(pos, scale(b.forward, d)), scale(b.right, x)), scale(b.up, y));
  const far = [at(depth, -hw, -hh), at(depth, hw, -hh), at(depth, hw, hh), at(depth, -hw, hh)];
  const close = [at(0, -near[0], -near[1]), at(0, near[0], -near[1]), at(0, near[0], near[1]), at(0, -near[0], near[1])];
  const lines: Vec3[] = [];
  for (let i = 0; i < 4; i++) {
    lines.push(far[i], far[(i + 1) % 4], close[i], far[i]);
    if (cam.projection === 'ORTHOGRAPHIC') lines.push(close[i], close[(i + 1) % 4]);
  }
  // A small triangle over the top edge says which way is up.
  const t = hw * 0.35;
  const top = at(depth, 0, hh + t);
  lines.push(at(depth, -t, hh), top, top, at(depth, t, hh));
  return { obj: { kind: 'CAMERA', id: cam.id }, lines, dots: [pos] };
}

/**
 * The glyphs of the viewport: every light of the rig (switched off too: it can be found and switched on) and every
 * saved camera but the active one (it is the view). `all` false draws only the selected object's (the Lights and
 * cameras button is off); the object being looked through has none (the view is from inside it).
 */
export function glyphsOf(state: ProjectState, opts: { all: boolean; selected?: ViewObject | null; lookThrough?: ViewObject | null }): Glyph[] {
  const out: Glyph[] = [];
  const want = (o: ViewObject) => !sameObject(o, opts.lookThrough) && (opts.all || sameObject(o, opts.selected));
  for (const l of state.studio.lights) if (want({ kind: 'LIGHT', id: l.id })) out.push(lightGlyph(state, l));
  for (const cam of Object.values(state.camera.cameras)) {
    if (cam.id === state.camera.active) continue;
    if (want({ kind: 'CAMERA', id: cam.id })) out.push(cameraGlyph(state, cam));
  }
  return out;
}

/** A point of the model on the screen, CSS pixels; null behind the viewer. */
export type Projector = (p: Vec3) => { x: number; y: number } | null;

/** Distance from (x, y) to the segment a-b, pixels. */
function segmentDistance(x: number, y: number, a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / len2)) : 0;
  return Math.hypot(x - (a.x + t * dx), y - (a.y + t * dy));
}

/** How near (CSS pixels) a click has to be to a glyph's line or dot to pick it. */
export const GLYPH_PICK_PX = 6;

/** The object whose glyph is nearest to a click, within `tol` pixels of one of its lines or dots; null when none is. */
export function pickGlyph(glyphs: readonly Glyph[], project: Projector, x: number, y: number, tol = GLYPH_PICK_PX): ViewObject | null {
  let best: { obj: ViewObject; d: number } | null = null;
  for (const g of glyphs) {
    let d = Infinity;
    for (const p of g.dots) {
      const s = project(p);
      if (s) d = Math.min(d, Math.max(0, Math.hypot(x - s.x, y - s.y) - 2));
    }
    for (let i = 0; i + 1 < g.lines.length; i += 2) {
      const a = project(g.lines[i]);
      const b = project(g.lines[i + 1]);
      if (a && b) d = Math.min(d, segmentDistance(x, y, a, b));
    }
    if (d <= tol && (!best || d < best.d)) best = { obj: g.obj, d };
  }
  return best?.obj ?? null;
}

/**
 * A camera's projection onto a viewport of `viewW x viewH` CSS pixels that draws the output frame inset as the
 * preview does (core/camera.ts outputFrameRect): what the screen shows of a model point. The preview has three.js
 * for it; this is the same mapping in plain numbers, for tests and for anything without a renderer.
 */
export function viewProjector(cam: CameraState, viewW: number, viewH: number, outW: number, outH: number): Projector {
  const frame = outputFrameRect(viewW, viewH, outW, outH);
  const aspect = outW > 0 && outH > 0 ? outW / outH : 16 / 9;
  const b = cameraBasis(cam.azimuth, cam.elevation);
  const pos = cameraPosition(cam);
  const cx = viewW / 2;
  const cy = viewH / 2;
  if (cam.projection === 'ORTHOGRAPHIC') {
    const k = frame.width / cam.orthoWidth;
    return (p) => {
      const d = sub(p, pos);
      return { x: cx + dot(d, b.right) * k, y: cy - dot(d, b.up) * k };
    };
  }
  const fov = fieldOfView(cam.focalMm, aspect);
  const f = frame.height / (2 * Math.tan(fov.v / 2));
  return (p) => {
    const d = sub(p, pos);
    const z = dot(d, b.forward);
    if (z <= 1e-9) return null;
    return { x: cx + (f * dot(d, b.right)) / z, y: cy - (f * dot(d, b.up)) / z };
  };
}
