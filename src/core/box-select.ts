// Selection by box (UI.md §4.1): a rectangle dragged in the viewport with the Select tool. Left to right is a
// window (what lies entirely inside the rectangle), right to left is crossing (what touches it), at the selection
// level in force: models, groups and parts by their projected geometry, faces (the whole CAD face, or the surface
// that continues, see core/faces.ts) by what shows in the rectangle.
//
// Everything that decides which items a rectangle reaches is here, pure, in screen pixels: the viewport only says
// where the pointer went (`boxFromDrag`), hands over the matrices that project its parts (`Projection`) and, for
// faces, which triangles show through the rectangle (it draws them with an id for each; a drag without X-ray
// selects what is seen, not what is behind).
//
// The gesture itself (which button, which modifier) depends on the mouse scheme of the settings: where the left
// button orbits, a plain drag must stay an orbit, so the box is armed by Ctrl (Cmd) + drag (`boxArmed`); Shift and
// Alt then say whether it adds or takes out (`combineOf`).

import { cadFaceRegion, coveringRanges } from './faces';
import { getMesh, type MeshData, type TriangleRange } from './meshes';
import { effectiveVisible, partsUnder, resolvePick, type NodeId, type SelectionLevel } from './scene';
import type { ProjectState } from './store';

/** An axis-aligned rectangle of the screen, in CSS pixels of the viewport; `x0 <= x1` and `y0 <= y1`. */
export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** What touches the rectangle (crossing, dragged right to left) or lies entirely inside it (window, left to right). */
export type BoxMode = 'window' | 'crossing';

/** What the box does to the selection that was: replace it, add to it, take from it. */
export type BoxCombine = 'replace' | 'add' | 'remove';

/** A drag shorter than this (pixels) is a click. */
export const CLICK_PIXELS = 4;

export interface Mods {
  shift: boolean;
  ctrl: boolean;
  meta: boolean;
  alt: boolean;
}

/** The rectangle of a drag from `a` to `b`, and its mode: to the right is a window, to the left is crossing. */
export function boxFromDrag(ax: number, ay: number, bx: number, by: number): { rect: Rect; mode: BoxMode } {
  return { rect: { x0: Math.min(ax, bx), y0: Math.min(ay, by), x1: Math.max(ax, bx), y1: Math.max(ay, by) }, mode: bx >= ax ? 'window' : 'crossing' };
}

/** A press that moved this little is a click, not a box. */
export function isClick(dx: number, dy: number): boolean {
  return Math.hypot(dx, dy) <= CLICK_PIXELS;
}

/**
 * What a box does with the selection that was, from the modifiers held: Alt (Option) takes from it, Shift adds to
 * it, nothing replaces it. Ctrl (Cmd) changes nothing here: it is what arms the box (`boxArmed`), so Ctrl + drag
 * replaces, Ctrl + Shift + drag adds and Ctrl + Alt + drag takes out.
 */
export function combineOf(m: Mods): BoxCombine {
  if (m.alt) return 'remove';
  return m.shift ? 'add' : 'replace';
}

/**
 * What a click does with the selection that was, from its modifiers (the same for a part, a group, a model and a
 * face): nothing replaces it, Shift adds, Ctrl (Cmd) takes it in or out, Alt (Option) takes it out.
 */
export function clickModeOf(m: Mods): 'set' | 'add' | 'toggle' | 'remove' {
  if (m.alt) return 'remove';
  if (m.ctrl || m.meta) return 'toggle';
  return m.shift ? 'add' : 'set';
}

/** The mouse schemes of Settings ▸ Preferences ▸ Viewport and navigation (`viewport.mouse`). */
export type MouseScheme = 'LEFT' | 'ALT_LEFT' | 'MIDDLE';

/**
 * Whether a press of the left button with these modifiers starts a box with the Select tool, or is the camera's.
 *   - Ctrl (Cmd) + drag is a box in every scheme (Ctrl + Shift adds, Ctrl + Alt takes out, see `combineOf`).
 *   - Left button orbits (the default): without Ctrl a drag is the camera's, as it always was (a plain drag orbits,
 *     Shift + drag pans, Alt + drag is not taken away). Ctrl + left button is the pan of the orbit controls; with the
 *     Select tool it draws the box instead, and the right button, the wheel and the Pan tool remain.
 *   - Alt + left button orbits: a plain drag, or with Shift, is a box too; Alt alone is the orbit.
 *   - Middle button orbits: the left button is free: every press is a box.
 * The Select tool and the Move and Scale tools (where no handle is under the pointer) have boxes; Orbit, Pan and Zoom
 * own the left button.
 */
export function boxArmed(scheme: MouseScheme, tool: string, m: Mods): boolean {
  if (tool !== 'select' && tool !== 'move' && tool !== 'scale') return false;
  if (m.ctrl || m.meta) return true;
  if (scheme === 'MIDDLE') return true;
  return scheme === 'ALT_LEFT' && !m.alt;
}

/**
 * The modifiers a plain click (a press that never armed a box) means. Where Alt + left button orbits, Alt belongs
 * to the camera and is not "take out"; everywhere else Alt + click takes the item out of the selection.
 */
export function clickMods(scheme: MouseScheme, m: Mods): Mods {
  return scheme === 'ALT_LEFT' ? { ...m, alt: false } : m;
}

/** `current` after a box that reached `hit`: replaced, added to (no repeats), or with `hit` taken out. */
export function applyBox<T>(current: readonly T[], hit: readonly T[], combine: BoxCombine): T[] {
  if (combine === 'replace') return [...hit];
  if (combine === 'add') return [...current, ...hit.filter((x) => !current.includes(x))];
  return current.filter((x) => !hit.includes(x));
}

// --- Geometry on the screen -----------------------------------------------------------------

/** Every vertex of the polygon (x, y pairs) lies inside the rectangle (borders included). */
export function polygonInside(rect: Rect, poly: readonly number[]): boolean {
  for (let i = 0; i < poly.length; i += 2) {
    if (poly[i] < rect.x0 || poly[i] > rect.x1 || poly[i + 1] < rect.y0 || poly[i + 1] > rect.y1) return false;
  }
  return poly.length >= 6;
}

/** Whether two segments intersect (touching counts). */
function segmentsCross(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): boolean {
  const o = (px: number, py: number, qx: number, qy: number, rx: number, ry: number) => (qx - px) * (ry - py) - (qy - py) * (rx - px);
  const d1 = o(cx, cy, dx, dy, ax, ay);
  const d2 = o(cx, cy, dx, dy, bx, by);
  const d3 = o(ax, ay, bx, by, cx, cy);
  const d4 = o(ax, ay, bx, by, dx, dy);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  const on = (px: number, py: number, qx: number, qy: number, rx: number, ry: number) =>
    Math.min(px, qx) <= rx && rx <= Math.max(px, qx) && Math.min(py, qy) <= ry && ry <= Math.max(py, qy);
  return (d1 === 0 && on(cx, cy, dx, dy, ax, ay)) || (d2 === 0 && on(cx, cy, dx, dy, bx, by)) || (d3 === 0 && on(ax, ay, bx, by, cx, cy)) || (d4 === 0 && on(ax, ay, bx, by, dx, dy));
}

/** Whether a point is inside a convex polygon (either winding; the border counts). */
function pointInConvex(poly: readonly number[], x: number, y: number): boolean {
  let sign = 0;
  const n = poly.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const c = (poly[2 * j] - poly[2 * i]) * (y - poly[2 * i + 1]) - (poly[2 * j + 1] - poly[2 * i + 1]) * (x - poly[2 * i]);
    if (c !== 0) {
      if (sign !== 0 && (c > 0) !== (sign > 0)) return false;
      sign = c;
    }
  }
  return true;
}

/** Whether a convex polygon (x, y pairs: a triangle, or the few vertices of one clipped by the camera) touches the rectangle. */
export function polygonTouches(rect: Rect, poly: readonly number[]): boolean {
  const n = poly.length / 2;
  if (n < 3) return false;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = poly[2 * i];
    const y = poly[2 * i + 1];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  if (maxX < rect.x0 || minX > rect.x1 || maxY < rect.y0 || minY > rect.y1) return false;
  // A vertex inside the rectangle...
  for (let i = 0; i < n; i++) {
    const x = poly[2 * i];
    const y = poly[2 * i + 1];
    if (x >= rect.x0 && x <= rect.x1 && y >= rect.y0 && y <= rect.y1) return true;
  }
  // ...a corner of the rectangle inside the polygon (it swallows the rectangle)...
  const corners: [number, number][] = [
    [rect.x0, rect.y0],
    [rect.x1, rect.y0],
    [rect.x1, rect.y1],
    [rect.x0, rect.y1],
  ];
  for (const [x, y] of corners) if (pointInConvex(poly, x, y)) return true;
  // ...or an edge across an edge.
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    for (let k = 0; k < 4; k++) {
      const l = (k + 1) % 4;
      if (segmentsCross(poly[2 * i], poly[2 * i + 1], poly[2 * j], poly[2 * j + 1], corners[k][0], corners[k][1], corners[l][0], corners[l][1])) return true;
    }
  }
  return false;
}

// --- Projection -----------------------------------------------------------------------------

/** How a viewport projects its parts: its size, and the matrix from a part's own coordinates to clip space. */
export interface Projection {
  width: number;
  height: number;
  /** Column-major 4x4: clip = M * (x, y, z, 1) for the vertices of the part's mesh; null for a part it does not draw. */
  mvp(part: NodeId): ArrayLike<number> | null;
}

/** Clip coordinates (x, y, w) of every vertex of a mesh under a matrix: 3 numbers a vertex. */
export function clipVertices(positions: ArrayLike<number>, m: ArrayLike<number>): Float64Array {
  const V = Math.floor(positions.length / 3);
  const out = new Float64Array(3 * V);
  for (let v = 0; v < V; v++) {
    const x = positions[3 * v];
    const y = positions[3 * v + 1];
    const z = positions[3 * v + 2];
    out[3 * v] = m[0] * x + m[4] * y + m[8] * z + m[12];
    out[3 * v + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
    out[3 * v + 2] = m[3] * x + m[7] * y + m[11] * z + m[15];
  }
  return out;
}

/** Points nearer than this (clip w) are behind the camera. */
const NEAR_W = 1e-6;

/** Screen position of a clip-space point in front of the camera. */
function toScreen(cx: number, cy: number, cw: number, width: number, height: number): [number, number] {
  return [(cx / cw * 0.5 + 0.5) * width, (1 - (cy / cw * 0.5 + 0.5)) * height];
}

/** The corners (x, y pairs) of triangle (a, b, c) on the screen, cut where it passes behind the camera; empty when it is all behind. */
export function triangleOnScreen(clip: Float64Array, a: number, b: number, c: number, width: number, height: number): number[] {
  const pts = [a, b, c].map((v) => [clip[3 * v], clip[3 * v + 1], clip[3 * v + 2]]);
  if (pts.every((p) => p[2] > NEAR_W)) return pts.flatMap((p) => toScreen(p[0], p[1], p[2], width, height));
  if (pts.every((p) => p[2] <= NEAR_W)) return [];
  // Sutherland-Hodgman against the plane w = NEAR_W.
  const out: number[][] = [];
  for (let i = 0; i < 3; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % 3];
    const pin = p[2] > NEAR_W;
    const qin = q[2] > NEAR_W;
    if (pin) out.push(p);
    if (pin !== qin) {
      const t = (NEAR_W - p[2]) / (q[2] - p[2]);
      out.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1]), NEAR_W]);
    }
  }
  return out.flatMap((p) => toScreen(p[0], p[1], p[2], width, height));
}

/** Every vertex of the mesh is in front of the camera and inside the rectangle: the part lies in the window. */
function meshInside(data: MeshData, clip: Float64Array, rect: Rect, width: number, height: number): boolean {
  const V = clip.length / 3;
  if (V === 0 || data.indices.length === 0) return false;
  for (let v = 0; v < V; v++) {
    const w = clip[3 * v + 2];
    if (!(w > NEAR_W)) return false;
    const [x, y] = toScreen(clip[3 * v], clip[3 * v + 1], w, width, height);
    if (x < rect.x0 || x > rect.x1 || y < rect.y0 || y > rect.y1) return false;
  }
  return true;
}

/** Some triangle of the mesh touches the rectangle. A cheap test of the bounds of the vertices comes first. */
function meshTouches(data: MeshData, clip: Float64Array, rect: Rect, width: number, height: number): boolean {
  const V = clip.length / 3;
  let behind = false;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let v = 0; v < V; v++) {
    const w = clip[3 * v + 2];
    if (!(w > NEAR_W)) {
      behind = true;
      continue;
    }
    const [x, y] = toScreen(clip[3 * v], clip[3 * v + 1], w, width, height);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  // The bounds of what is in front are the bounds of the part when nothing is behind the camera.
  if (!behind && (maxX < rect.x0 || minX > rect.x1 || maxY < rect.y0 || minY > rect.y1)) return false;
  if (V === 0) return false;
  const T = Math.floor(data.indices.length / 3);
  for (let t = 0; t < T; t++) {
    const poly = triangleOnScreen(clip, data.indices[3 * t], data.indices[3 * t + 1], data.indices[3 * t + 2], width, height);
    if (poly.length >= 6 && polygonTouches(rect, poly)) return true;
  }
  return false;
}

/**
 * The nodes a box reaches at a selection level (Model, Group or Part; Faces is `facesInBox`). Parts that are hidden
 * do not count. Each part is taken to its node of the level (`resolvePick`: the model, its group, or the part
 * itself when it has no group). A window takes a node when all of its visible parts lie entirely inside the
 * rectangle; crossing takes it when any triangle of any of its parts touches the rectangle. Nothing is occluded:
 * a part behind another is selected too, as in any CAD.
 */
export function itemsInBox(state: ProjectState, rect: Rect, mode: BoxMode, level: SelectionLevel, projection: Projection): NodeId[] {
  const byItem = new Map<NodeId, NodeId[]>();
  for (const part of partsUnder(state, state.scene.roots)) {
    if (!effectiveVisible(state, part)) continue;
    const item = resolvePick(state, part, level === 'FACES' ? 'PART' : level);
    (byItem.get(item) ?? byItem.set(item, []).get(item)!).push(part);
  }
  const clipOf = new Map<NodeId, { data: MeshData; clip: Float64Array } | null>();
  const clipFor = (part: NodeId) => {
    if (clipOf.has(part)) return clipOf.get(part)!;
    const node = state.scene.nodes[part];
    const data = node?.mesh ? getMesh(node.mesh.id) : undefined;
    const m = projection.mvp(part);
    const entry = data && m ? { data, clip: clipVertices(data.positions, m) } : null;
    clipOf.set(part, entry);
    return entry;
  };
  const out: NodeId[] = [];
  for (const [item, parts] of byItem) {
    const hit = (part: NodeId) => {
      const e = clipFor(part);
      if (!e) return false;
      return mode === 'window' ? meshInside(e.data, e.clip, rect, projection.width, projection.height) : meshTouches(e.data, e.clip, rect, projection.width, projection.height);
    };
    // A node with a part that has no geometry to project (an empty mesh) cannot lie in a window.
    if (mode === 'window' ? parts.every(hit) : parts.some(hit)) out.push(item);
  }
  return out;
}

// --- Faces ------------------------------------------------------------------------------------

export interface FacesQuery {
  data: MeshData;
  /** The CAD faces of the part (STEP, IGES), when it has them. */
  faceRanges?: readonly TriangleRange[];
  /** The part's matrix (see `Projection.mvp`). */
  mvp: ArrayLike<number>;
  width: number;
  height: number;
  rect: Rect;
  mode: BoxMode;
  /**
   * The triangles that show through the rectangle (the ones an id pass of the viewport found in it), or null for
   * X-ray: hidden faces count too, and a triangle counts by where it is on the screen.
   */
  visible: ReadonlySet<number> | null;
  /** Live-edge angle for the faces found by continuity of the surface. */
  liveEdgeDeg?: number;
}

/**
 * The triangles of the faces a box reaches in one part, ascending. A face is a CAD face when the part has them
 * (`faceRanges`), otherwise the surface that continues from a triangle (`cadFaceRegion`), and it is taken whole.
 * Crossing takes a face when some triangle of it shows in the rectangle (or, in X-ray, touches it); a window takes
 * a face that lies entirely inside the rectangle and shows (or, in X-ray, any face that does).
 */
export function facesInBox(q: FacesQuery): number[] {
  const { data, rect, width, height } = q;
  const T = Math.floor(data.indices.length / 3);
  if (T === 0) return [];
  const clip = clipVertices(data.positions, q.mvp);
  const runs = coveringRanges(q.faceRanges ? [...q.faceRanges] : undefined, T);
  // The face of each triangle: a run of the CAD faces, or a region grown from it.
  let runOf: Int32Array | null = null;
  if (runs) {
    runOf = new Int32Array(T);
    runs.forEach((r, i) => runOf!.fill(i, r.start, r.start + r.count));
  }
  const faceOf = (t: number): number[] => (runs && runOf ? Array.from({ length: runs[runOf[t]].count }, (_, k) => runs[runOf![t]].start + k) : cadFaceRegion(data, t, { liveEdgeDeg: q.liveEdgeDeg }));
  const corners = (t: number) => [data.indices[3 * t], data.indices[3 * t + 1], data.indices[3 * t + 2]];
  const triangleTouches = (t: number) => {
    const [a, b, c] = corners(t);
    return polygonTouches(rect, triangleOnScreen(clip, a, b, c, width, height));
  };
  // Inside means all three corners in front of the camera and in the rectangle.
  const triangleInside = (t: number) => {
    const [a, b, c] = corners(t);
    if (!(clip[3 * a + 2] > NEAR_W && clip[3 * b + 2] > NEAR_W && clip[3 * c + 2] > NEAR_W)) return false;
    return polygonInside(rect, triangleOnScreen(clip, a, b, c, width, height));
  };
  // What each triangle has been decided: 0 not yet, 1 in a face that was taken, 2 in one that was not.
  const state = new Uint8Array(T);
  const out: number[] = [];
  const candidates: Iterable<number> = q.visible ?? (function* () {
    for (let t = 0; t < T; t++) if (q.mode === 'window' ? triangleInside(t) : triangleTouches(t)) yield t;
  })();
  for (const t of candidates) {
    if (t < 0 || t >= T || state[t] !== 0) continue;
    const face = faceOf(t);
    // A face is taken whole; a window needs the whole of it inside the rectangle.
    const take = q.mode === 'crossing' || face.every(triangleInside);
    for (const f of face) state[f] = take ? 1 : 2;
    if (state[t] === 0) state[t] = take ? 1 : 2;
    if (take) out.push(...face);
  }
  return out.sort((a, b) => a - b);
}
