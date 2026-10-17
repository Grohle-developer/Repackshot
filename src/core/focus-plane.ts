// The plane of sharp focus of a tilted lens (phase O4), on the project's side: the plane the engine focuses for a
// camera's tilt, the tilt that puts it through two (or three) points of the product, the direction a photographer
// reads a tilt by, and what the viewport draws of it.
//
// **The plane.** The simple lens's hinge rule (rt-core `optics::Lens::focus_normal`; H. M. Merklinger, *Focusing the
// View Camera*, 1993): through the focus point, `focusDistance` along the view from the camera, with the normal
// `f·forward + u·sin α·b`, where `b = forward × a` and `a` is the tilt axis in the sensor plane, `axisDeg` from the
// camera's right towards its up. Since O4 the engine turns a traced lens until its own plane is this one (the frame's
// centre refocused with real rays), so the same numbers mean the same plane with either lens; a traced lens's field
// curvature bends it away from the centre, as it bends the upright lens's.
//
// **Two points.** The planes through two points form a family about the line through them; the one asked for is the
// least tilted, whose normal is the camera's forward made perpendicular to that line. Two points at the same depth
// give no tilt at all, only the focus distance. **Three points** settle the plane. Either way the hinge rule is
// inverted exactly: the tilt's axis is the plane's lean turned a quarter about the view, `sin α = f |v| / (A u)` with
// `A` and `v` the normal's parts along and across the view and `u` where the plane crosses the view axis.
//
// **Direction.** A tilt about the horizontal axis lays the plane back towards the floor: the top of the frame is where
// it runs away. The interface names a tilt by that direction on the image (`recedeDeg`: 90 up, 0 right, 180 left, 270
// down) and an amount that is never negative; `tiltFromRecede` and `recedeOf` go between that and the stored
// `(tiltDeg, tiltAxisDeg)`, which a camera keeps as it always did.

import { activeCamera, cameraBasis, cameraPosition, type CameraId, type CameraState } from './camera';
import { renderedCamera, verticalsOf } from './interior-camera';
import { add, boxCenter, boxRadius, cross, dot, isEmptyBox, length, normalize, scale, sub, type Vec3 } from './math';
import { OPTICS_LIMITS, opticsOf, tiltOf } from './optics';
import { productBounds } from './scene';
import type { ProjectState } from './store';

const DEG = Math.PI / 180;

/** A plane: a point on it and its unit normal (pointing away from the camera). */
export interface Plane {
  point: Vec3;
  normal: Vec3;
}

/** The tilt axis `a` and `b = forward × a` of a camera, from its basis. */
function tiltFrame(cam: CameraState, axisDeg: number): { forward: Vec3; right: Vec3; up: Vec3; a: Vec3; b: Vec3 } {
  const { forward, right, up } = cameraBasis(cam.azimuth, cam.elevation);
  const a = add(scale(right, Math.cos(axisDeg * DEG)), scale(up, Math.sin(axisDeg * DEG)));
  return { forward, right, up, a, b: cross(forward, a) };
}

/**
 * The plane of sharp focus of `cam` for the tilt `tiltDeg` about the axis `axisDeg` (by default its lens's own). It is
 * the plane of the camera as rendered (K3 `renderedCamera`): with straight verticals the lens is level, and its tilt
 * and focus distance are the rendered camera's (the tilt is about the same axes, which a level camera keeps).
 */
export function focusPlaneOf(cam0: CameraState, tilt?: { deg: number; axisDeg: number }): Plane {
  const cam = renderedCamera(cam0);
  const t = tilt ?? tiltOf(opticsOf(cam));
  const { forward, b } = tiltFrame(cam, t.axisDeg);
  const u = cam.focusDistance;
  const n = normalize(add(scale(forward, cam.focalMm), scale(b, u * Math.sin(t.deg * DEG))));
  return { point: add(cameraPosition(cam), scale(forward, u)), normal: n };
}

/** The signed distance of `p` from a plane, millimetres (positive beyond it, away from the camera). */
export function planeDistance(plane: Plane, p: readonly number[]): number {
  return dot(plane.normal, sub(p, plane.point));
}

/** What a solve gives: the tilt, its axis and the focus distance that put the plane through the points. */
export interface TiltSolution {
  tiltDeg: number;
  axisDeg: number;
  focusDistance: number;
}

/** Why no tilt does it: the same point twice, points in line with the view (or with each other), behind the camera, or a plane steeper than the lens tilts (`neededDeg`). */
export type TiltRefusal = { reason: 'same' | 'line' | 'behind' } | { reason: 'steep'; neededDeg: number };

/** True for a solve that worked. */
export function isTiltSolution(r: TiltSolution | TiltRefusal): r is TiltSolution {
  return (r as TiltSolution).focusDistance !== undefined;
}

/**
 * The tilt and focus distance of `cam` whose plane of sharp focus passes through `points` (two: the least tilted such
 * plane; three: the plane through them), within the lens's limits (OPTICS_LIMITS.tiltDeg), or why there is none.
 * The axis comes out between −90° and 90° (the tilt's sign says which way); with no tilt it is `cam`'s own.
 */
export function solveTilt(cam0: CameraState, points: readonly (readonly number[])[]): TiltSolution | TiltRefusal {
  // Solved for the camera as rendered (straight verticals, K3); its focus distance is the stored one's times
  // cos(corrected tilt), so the stored one comes back over that cosine (as `focusDistanceFor` does).
  const cam = renderedCamera(cam0);
  const v0 = verticalsOf(cam0);
  const back = v0 ? 1 / Math.cos(v0.correctedDeg * DEG) : 1;
  const { forward, right, up } = cameraBasis(cam.azimuth, cam.elevation);
  const pos = cameraPosition(cam);
  const [p1, p2, p3] = points;
  if (!p1 || !p2) return { reason: 'same' };
  const l = sub(p2, p1);
  const span = length(l);
  if (span < 1e-6) return { reason: 'same' };
  let n: Vec3;
  if (p3) {
    n = cross(l, sub(p3, p1));
    if (length(n) < 1e-9 * span * span) return { reason: 'line' };
  } else {
    const lh = scale(l, 1 / span);
    n = sub(forward, scale(lh, dot(forward, lh)));
    if (length(n) < 1e-6) return { reason: 'line' };
  }
  n = normalize(n);
  if (dot(n, forward) < 0) n = scale(n, -1);
  const along = dot(n, forward);
  if (along < 1e-6) return { reason: 'steep', neededDeg: 90 };
  const u = dot(n, sub(p1, pos)) / along;
  if (!(u > 0)) return { reason: 'behind' };
  const v = sub(n, scale(forward, along));
  const lean = length(v);
  const own = tiltOf(opticsOf(cam));
  if (lean < 1e-9) return { tiltDeg: 0, axisDeg: own.axisDeg, focusDistance: u * back };
  const sin = (cam.focalMm * lean) / (along * u);
  const neededDeg = sin >= 1 ? 90 : Math.asin(sin) / DEG;
  if (neededDeg > OPTICS_LIMITS.tiltDeg.max + 1e-9) return { reason: 'steep', neededDeg };
  // b along the lean, a = b × forward (forward ⊥ a).
  const a = cross(scale(v, 1 / lean), forward);
  let axisDeg = Math.atan2(dot(a, up), dot(a, right)) / DEG;
  let tiltDeg = neededDeg;
  if (axisDeg > 90) {
    axisDeg -= 180;
    tiltDeg = -tiltDeg;
  } else if (axisDeg <= -90) {
    axisDeg += 180;
    tiltDeg = -tiltDeg;
  }
  return { tiltDeg, axisDeg, focusDistance: u * back };
}

/** An angle in [0, 360). */
function wrap360(deg: number): number {
  const d = deg % 360;
  return d < 0 ? d + 360 : d;
}

/** An angle in (−180, 180]. */
function wrap180(deg: number): number {
  const d = wrap360(deg);
  return d > 180 ? d - 360 : d;
}

/**
 * The direction on the image where the plane of a tilt runs away (degrees: 0 right, 90 up, 180 left, 270 down) and its
 * amount (never negative): a tilt about the horizontal axis (0°) lays the plane back towards the floor, so its far side
 * is the top of the frame (90°).
 */
export function recedeOf(tiltDeg: number, axisDeg: number): { amountDeg: number; recedeDeg: number } {
  return { amountDeg: Math.abs(tiltDeg), recedeDeg: wrap360(axisDeg + 90 + (tiltDeg < 0 ? 180 : 0)) };
}

/** The stored tilt of an amount and a direction the plane runs away to (`recedeOf`'s inverse, the amount positive). */
export function tiltFromRecede(amountDeg: number, recedeDeg: number): { tiltDeg: number; axisDeg: number } {
  return { tiltDeg: Math.max(0, amountDeg), axisDeg: wrap180(recedeDeg - 90) };
}

/** What the viewport draws of a camera's plane of sharp focus: a translucent quad, its outline and grid, the points on it. */
export interface FocusPlaneHint {
  /** The quad's corners, in order (model space, millimetres). */
  quad: [Vec3, Vec3, Vec3, Vec3];
  /** Segments (pairs of points): the outline and a grid on the plane. */
  lines: Vec3[];
  /** The focus point and the points picked so far. */
  dots: Vec3[];
}

/** Grid lines across each side of the drawn plane. */
const GRID = 6;

/**
 * The hint of camera `camId`'s plane (the active camera's by default) around the product: a square on the plane, twice
 * the product's radius and a little more on a side, centred where the product's centre falls on it, its sides along
 * the camera's right laid on the plane and across it. Null for a camera with no lens: orthographic, or a panorama (K3).
 * With straight verticals, the rendered camera's plane and frame (K3 `renderedCamera`).
 */
export function focusPlaneHint(state: ProjectState, camId?: CameraId | null, picked: readonly Vec3[] = []): FocusPlaneHint | null {
  const cam0 = (camId ? state.camera.cameras[camId] : undefined) ?? activeCamera(state);
  if (!cam0 || cam0.projection !== 'PERSPECTIVE') return null;
  const cam = renderedCamera(cam0);
  const t = tiltOf(opticsOf(cam));
  const plane = focusPlaneOf(cam0, t);
  const box = productBounds(state, true);
  const centre0 = isEmptyBox(box) ? plane.point : boxCenter(box);
  const r = isEmptyBox(box) ? 0.25 * cam.focusDistance : Math.max(1, boxRadius(box));
  const centre = sub(centre0, scale(plane.normal, planeDistance(plane, centre0)));
  const { right, up } = tiltFrame(cam, t.axisDeg);
  // The camera's right laid on the plane, and across it on the plane: the square reads as a sheet seen in perspective
  // (a trapezoid as the plane leans), never turned on its corner. A plane seen edge on along the right uses the up.
  const along = (w: Vec3) => sub(w, scale(plane.normal, dot(w, plane.normal)));
  const e1 = length(along(right)) > 1e-3 ? normalize(along(right)) : normalize(along(up));
  const e2 = normalize(cross(plane.normal, e1));
  const half = 1.25 * r;
  const at = (x: number, y: number) => add(centre, add(scale(e1, x * half), scale(e2, y * half)));
  const quad: [Vec3, Vec3, Vec3, Vec3] = [at(-1, -1), at(1, -1), at(1, 1), at(-1, 1)];
  const lines: Vec3[] = [];
  for (let i = 0; i <= GRID; i++) {
    const k = -1 + (2 * i) / GRID;
    lines.push(at(k, -1), at(k, 1), at(-1, k), at(1, k));
  }
  return { quad, lines, dots: [plane.point, ...picked] };
}
