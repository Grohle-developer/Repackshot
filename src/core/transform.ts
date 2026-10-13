// Transform core and the operations on parts of SPEC §3.1 ("Operaciones
// sobre piezas"), phase U3: compose / decompose of a node transform, local and
// global axes, the pivot, moves of the move tool (gizmo) with snapping, rest
// and centre, reset, camera target, duplicate (independent or linked), group,
// ungroup, move to group, linear and circular patterns of linked copies that
// regenerate when edited, flip normals, smoothing angle and separate by
// material or by CAD face. Pure functions over ProjectState; every operation is an action of
// the store (prefix `scene/`), so it is undoable.

import type { ActionBase, ProjectState } from './store';
import { activeCamera, cameraPosition, orbitFromPosition, type CameraState } from './camera';
import { nextId } from './ids';
import { cloneInstance, partMaterials, pruneMaterials, triangleMaterials, type MaterialId, type MaterialInstance } from './materials';
import {
  add,
  boxCenter,
  boxSize,
  cross,
  dot,
  isEmptyBox,
  length,
  mat4Compose,
  mat4Identity,
  mat4Invert,
  mat4Multiply,
  normalize,
  round,
  scale as scaleVec,
  sub,
  transformDirection,
  transformPoint,
  type Box,
  type Mat4,
  type Vec3,
} from './math';
import { canSeparateByFaces, facePieces, type FacePiece } from './faces';
import { ensureMesh, flipMesh, getMesh, hashIndices, remapTriangleRanges, resmoothMesh, sliceMesh, transformedMeshBounds, triangleSource, type MeshData, type MeshId, type MeshRef } from './meshes';
import { ensurePrimitiveMesh } from './primitives';
import {
  boundsOf,
  centerXY,
  cleanSelection,
  IDENTITY_TRANSFORM,
  partWorldBounds,
  partsUnder,
  restOnFloor,
  subtree,
  topMost,
  worldMatrix,
  type Axis,
  type FaceRange,
  type NodeId,
  type PatternSpec,
  type Pivot,
  type PivotMode,
  type SceneNode,
  type Space,
  type Transform,
} from './scene';

export type { Axis, PatternSpec, Pivot, PivotMode, Space };

/** Increments of the move tool with Shift (UI.md §2.3): 10 mm, 15 degrees, 0.1 of scale. */
export const SNAP = { moveMm: 10, rotateDeg: 15, scale: 0.1 } as const;

export const PIVOT_MODES: readonly PivotMode[] = ['CENTER', 'BASE', 'ORIGIN', 'CUSTOM'];

/** Most copies a pattern makes (the original included). */
export const PATTERN_MAX = 200;

// ---------------------------------------------------------------------------
// Compose and decompose
// ---------------------------------------------------------------------------

export function cloneTransform(t: Transform): Transform {
  return { position: [...t.position], rotation: [...t.rotation], scale: [...t.scale] };
}

export function sameTransform(a: Transform, b: Transform): boolean {
  for (let i = 0; i < 3; i++) {
    if (a.position[i] !== b.position[i] || a.rotation[i] !== b.rotation[i] || a.scale[i] !== b.scale[i]) return false;
  }
  return true;
}

/** The matrix of a transform: translation * rotation (XYZ, degrees) * scale. */
export function composeTransform(t: Transform): Mat4 {
  return mat4Compose(t.position, t.rotation, t.scale);
}

function wrapNear(angle: number, ref: number): number {
  return angle + 360 * Math.round((ref - angle) / 360);
}

/**
 * Euler angles equal to `e` (same rotation) that are closest to `prev`: the other solution of the XYZ
 * decomposition and whole turns are tried, so fields do not jump while a drag crosses 180 degrees.
 */
export function closestEuler(e: Vec3, prev: Vec3): Vec3 {
  const candidates: Vec3[] = [e, [e[0] + 180, 180 - e[1], e[2] + 180]];
  let best = e;
  let bestCost = Infinity;
  for (const c of candidates) {
    const w: Vec3 = [wrapNear(c[0], prev[0]), wrapNear(c[1], prev[1]), wrapNear(c[2], prev[2])];
    const cost = Math.abs(w[0] - prev[0]) + Math.abs(w[1] - prev[1]) + Math.abs(w[2] - prev[2]);
    if (cost < bestCost - 1e-9) {
      best = w;
      bestCost = cost;
    }
  }
  return best;
}

/**
 * Position, rotation (XYZ degrees, the three.js convention of `mat4Compose`) and scale of a matrix. Shear
 * (a non-uniform scale under a rotation) cannot be represented and is dropped. Values are rounded to a
 * millionth so that round trips stay clean; `prev` picks the Euler angles closest to a previous rotation.
 */
export function decomposeMatrix(m: Mat4, prev?: Transform): Transform {
  const cols: Vec3[] = [
    [m[0], m[1], m[2]],
    [m[4], m[5], m[6]],
    [m[8], m[9], m[10]],
  ];
  const sx0 = length(cols[0]);
  const sy = length(cols[1]);
  const sz = length(cols[2]);
  const det = dot(cols[0], cross(cols[1], cols[2]));
  const sx = det < 0 ? -sx0 : sx0;
  const position: Vec3 = [round(m[12], 6), round(m[13], 6), round(m[14], 6)];
  const scale: Vec3 = [round(sx, 9), round(sy, 9), round(sz, 9)];
  if (Math.abs(sx) < 1e-12 || sy < 1e-12 || sz < 1e-12) {
    return { position, rotation: prev ? [...prev.rotation] : [0, 0, 0], scale };
  }
  const r = [cols[0].map((v) => v / sx), cols[1].map((v) => v / sy), cols[2].map((v) => v / sz)];
  // r[c][k] is row k of column c. m13 = r[2][0], m23 = r[2][1], m33 = r[2][2], m12 = r[1][0], m11 = r[0][0].
  const m13 = Math.max(-1, Math.min(1, r[2][0]));
  const y = Math.asin(m13);
  let x: number;
  let z: number;
  if (Math.abs(m13) < 0.9999999) {
    x = Math.atan2(-r[2][1], r[2][2]);
    z = Math.atan2(-r[1][0], r[0][0]);
  } else {
    x = Math.atan2(r[1][2], r[1][1]);
    z = 0;
  }
  const k = 180 / Math.PI;
  let rot: Vec3 = [x * k, y * k, z * k];
  if (prev) rot = closestEuler(rot, prev.rotation);
  return { position, rotation: [round(rot[0], 6), round(rot[1], 6), round(rot[2], 6)], scale };
}

export function translationMatrix(d: readonly number[]): Mat4 {
  const m = mat4Identity();
  m[12] = d[0];
  m[13] = d[1];
  m[14] = d[2];
  return m;
}

/** Rotation of `deg` degrees about a unit axis through the origin (right hand). */
export function rotationMatrix(axis: readonly number[], deg: number): Mat4 {
  const [x, y, z] = normalize(axis);
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const t = 1 - c;
  const m = mat4Identity();
  m[0] = t * x * x + c;
  m[1] = t * x * y + s * z;
  m[2] = t * x * z - s * y;
  m[4] = t * x * y - s * z;
  m[5] = t * y * y + c;
  m[6] = t * y * z + s * x;
  m[8] = t * x * z + s * y;
  m[9] = t * y * z - s * x;
  m[10] = t * z * z + c;
  return m;
}

/** Scale by `factors` along three orthonormal `axes` (world vectors). */
export function axisScaleMatrix(axes: readonly Vec3[], factors: readonly number[]): Mat4 {
  // A * S * A^T, with A the matrix whose columns are the axes.
  const m = mat4Identity();
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      let v = 0;
      for (let k = 0; k < 3; k++) v += axes[k][r] * factors[k] * axes[k][c];
      m[c * 4 + r] = v;
    }
  }
  return m;
}

/** `m` applied about a point: T(p) * m * T(-p). */
export function aboutPoint(p: readonly number[], m: Mat4): Mat4 {
  return mat4Multiply(translationMatrix(p), mat4Multiply(m, translationMatrix([-p[0], -p[1], -p[2]])));
}

// ---------------------------------------------------------------------------
// Targets, pivot and axes
// ---------------------------------------------------------------------------

/** A node or one of its ancestors is locked: the move tool leaves it alone. */
export function isLocked(state: ProjectState, id: NodeId): boolean {
  for (let cur: NodeId | null = id; cur; cur = state.scene.nodes[cur]?.parent ?? null) {
    if (state.scene.nodes[cur]?.locked) return true;
  }
  return false;
}

/** The nodes an operation moves: the top-most of `ids` that exist and are not locked. */
export function movableTargets(state: ProjectState, ids: readonly NodeId[]): NodeId[] {
  return topMost(state, ids).filter((id) => !isLocked(state, id));
}

export function pivotModeOf(node: SceneNode | undefined): PivotMode {
  return node?.pivot?.mode ?? 'CENTER';
}

/**
 * The common pivot of a selection, in world space: the pivot mode of its first node applied to the whole
 * selection. CENTER is the centre of the bounds of all of it, BASE the centre of the bottom of those bounds,
 * ORIGIN the origin of the first node (for a model: the origin of the file), CUSTOM its picked point.
 * Without geometry (a light, an empty group) the origin of the first node.
 */
export function pivotPoint(state: ProjectState, ids: readonly NodeId[]): Vec3 {
  const targets = topMost(state, ids);
  const first = targets[0];
  if (!first) return [0, 0, 0];
  const node = state.scene.nodes[first];
  const w = worldMatrix(state, first);
  const mode = pivotModeOf(node);
  if (mode === 'ORIGIN') return transformPoint(w, [0, 0, 0]);
  if (mode === 'CUSTOM') return transformPoint(w, node.pivot?.point ?? [0, 0, 0]);
  const b = boundsOf(state, targets);
  if (isEmptyBox(b)) return transformPoint(w, [0, 0, 0]);
  const c = boxCenter(b);
  return mode === 'BASE' ? [c[0], c[1], b.min[2]] : c;
}

/** Where the gizmo sits and the three axes it moves along (unit world vectors). */
export interface GizmoFrame {
  origin: Vec3;
  axes: [Vec3, Vec3, Vec3];
}

const WORLD_AXES: [Vec3, Vec3, Vec3] = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];

/** Orthonormal, right-handed axes of a matrix (Gram-Schmidt on its columns); the world axes when degenerate. */
export function matrixAxes(m: Mat4): [Vec3, Vec3, Vec3] {
  const x = normalize([m[0], m[1], m[2]]);
  const y0: Vec3 = [m[4], m[5], m[6]];
  const y = normalize(sub(y0, scaleVec(x, dot(y0, x))));
  if (length(x) < 0.5 || length(y) < 0.5) return WORLD_AXES;
  return [x, y, cross(x, y)];
}

/** The gizmo of a selection: at its common pivot, with the world axes (GLOBAL) or those of its first node (LOCAL). */
export function selectionFrame(state: ProjectState, ids: readonly NodeId[], space: Space): GizmoFrame | null {
  const targets = topMost(state, ids);
  if (targets.length === 0) return null;
  const axes = space === 'LOCAL' ? matrixAxes(worldMatrix(state, targets[0])) : WORLD_AXES;
  return { origin: pivotPoint(state, targets), axes: [[...axes[0]], [...axes[1]], [...axes[2]]] };
}

/**
 * The size of a selection along three orthonormal axes (world vectors), mm: the extent of every vertex of its parts
 * projected on each axis (with the world axes, the size of its bounding box). What Scale… "to size" measures.
 */
export function selectionExtents(state: ProjectState, ids: readonly NodeId[], axes: readonly Vec3[]): Vec3 {
  // Rows of the change of basis: a world point p has coordinates (a0·p, a1·p, a2·p) in the axes.
  const toAxes: Mat4 = mat4Identity();
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) toAxes[c * 4 + r] = axes[r][c];
  const cache = new Map<NodeId, Mat4>();
  let box: Box | null = null;
  for (const p of partsUnder(state, topMost(state, ids))) {
    const node = state.scene.nodes[p];
    const data = node.mesh ? getMesh(node.mesh.id) : undefined;
    let b: Box;
    if (data) b = transformedMeshBounds(data, mat4Multiply(toAxes, worldMatrix(state, p, cache)));
    else {
      const w = partWorldBounds(state, p, cache);
      if (isEmptyBox(w)) continue;
      const corners: Vec3[] = [];
      for (const x of [w.min[0], w.max[0]]) for (const y of [w.min[1], w.max[1]]) for (const z of [w.min[2], w.max[2]]) corners.push(transformPoint(toAxes, [x, y, z]));
      b = { min: [Math.min(...corners.map((c) => c[0])), Math.min(...corners.map((c) => c[1])), Math.min(...corners.map((c) => c[2]))], max: [Math.max(...corners.map((c) => c[0])), Math.max(...corners.map((c) => c[1])), Math.max(...corners.map((c) => c[2]))] };
    }
    if (isEmptyBox(b)) continue;
    box = box ? { min: b.min.map((v, k) => Math.min(v, box!.min[k])) as Vec3, max: b.max.map((v, k) => Math.max(v, box!.max[k])) as Vec3 } : b;
  }
  return box ? boxSize(box) : [0, 0, 0];
}

/**
 * New local transforms of the movable targets after a world-space matrix `d` is applied on top of their
 * world matrices: W' = d * W, L' = P^-1 * W'.
 */
export function applyWorldMatrix(state: ProjectState, ids: readonly NodeId[], d: Mat4): Record<NodeId, Transform> {
  const out: Record<NodeId, Transform> = {};
  const cache = new Map<NodeId, Mat4>();
  for (const id of movableTargets(state, ids)) {
    const node = state.scene.nodes[id];
    const w = worldMatrix(state, id, cache);
    const parentInv = node.parent ? mat4Invert(worldMatrix(state, node.parent, cache)) : mat4Identity();
    out[id] = decomposeMatrix(mat4Multiply(parentInv, mat4Multiply(d, w)), node.transform);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Snapping and the drag of the move tool
// ---------------------------------------------------------------------------

/** Rounds to the nearest multiple of `step`. */
export function snapTo(v: number, step: number): number {
  return round(Math.round(v / step) * step, 6);
}

/** Rounds a scale factor to the nearest 0.1, never below 0.1. */
export function snapScale(f: number): number {
  return Math.max(SNAP.scale, snapTo(f, SNAP.scale));
}

/**
 * A handle of the gizmo: translate along an axis (tx, ty, tz) or in a plane (pxy, pyz, pzx), rotate about an
 * axis (rx, ry, rz), scale along an axis (sx, sy, sz) or uniformly (su), and the aim of a light.
 */
export type GizmoHandle = 'tx' | 'ty' | 'tz' | 'pxy' | 'pyz' | 'pzx' | 'rx' | 'ry' | 'rz' | 'sx' | 'sy' | 'sz' | 'su' | 'aim';

/** What a drag of the gizmo did so far, relative to its start (the engine measures it; the UI applies it). */
export type GizmoDelta =
  | { kind: 'move'; amounts: Vec3 }
  | { kind: 'rotate'; axis: Axis; deg: number }
  | { kind: 'scale'; factors: Vec3 }
  | { kind: 'aim'; target: Vec3 };

/** The delta rounded to the Shift increments. */
export function snapDelta(delta: GizmoDelta): GizmoDelta {
  switch (delta.kind) {
    case 'move':
      return { kind: 'move', amounts: delta.amounts.map((a) => snapTo(a, SNAP.moveMm)) as Vec3 };
    case 'rotate':
      return { ...delta, deg: snapTo(delta.deg, SNAP.rotateDeg) };
    case 'scale':
      return { kind: 'scale', factors: delta.factors.map((f) => (f === 1 ? 1 : snapScale(f))) as Vec3 };
    default:
      return delta;
  }
}

/** The world matrix a gizmo delta applies about a frame. */
export function deltaMatrix(frame: GizmoFrame, delta: GizmoDelta): Mat4 {
  const { origin, axes } = frame;
  switch (delta.kind) {
    case 'move': {
      const d = add(add(scaleVec(axes[0], delta.amounts[0]), scaleVec(axes[1], delta.amounts[1])), scaleVec(axes[2], delta.amounts[2]));
      return translationMatrix(d);
    }
    case 'rotate':
      return aboutPoint(origin, rotationMatrix(axes[delta.axis], delta.deg));
    case 'scale':
      return aboutPoint(origin, axisScaleMatrix(axes, delta.factors));
    default:
      return mat4Identity();
  }
}

/**
 * New transforms of a selection for a gizmo drag measured from `state` (the state when the drag began),
 * snapped when `snap` (Shift). Recomputed from the start on every pointer move, so nothing drifts.
 */
export function gizmoTransforms(state: ProjectState, ids: readonly NodeId[], frame: GizmoFrame, delta: GizmoDelta, snap: boolean): Record<NodeId, Transform> {
  const d = snap ? snapDelta(delta) : delta;
  return applyWorldMatrix(state, ids, deltaMatrix(frame, d));
}

// ---------------------------------------------------------------------------
// Camera target
// ---------------------------------------------------------------------------

/** "Set as camera target": the active camera stays where it is and turns to look at the centre of the selection. */
export function cameraLookAt(state: ProjectState, ids: readonly NodeId[]): Partial<CameraState> | null {
  const cam = activeCamera(state);
  if (!cam) return null;
  const b = boundsOf(state, ids);
  const target = isEmptyBox(b) ? pivotPoint(state, ids) : boxCenter(b);
  const pos = cameraPosition(cam);
  const o = orbitFromPosition(pos, target);
  if (o.distance <= 0) return null;
  return { target, azimuth: o.azimuth, elevation: o.elevation, distance: o.distance, focusDistance: o.distance };
}

// ---------------------------------------------------------------------------
// Patterns
// ---------------------------------------------------------------------------

/** What creating or editing a pattern takes; `center` defaults to the pivot of the originals. */
export type PatternParams = Omit<PatternSpec, 'sources' | 'center'> & { center?: Vec3 };

/** Angle between two copies of a circular pattern. */
export function patternStep(spec: Pick<PatternSpec, 'count' | 'angleDeg'>): number {
  if (spec.count <= 1) return 0;
  return Math.abs(Math.abs(spec.angleDeg) - 360) < 1e-9 || Math.abs(spec.angleDeg) > 360 ? spec.angleDeg / spec.count : spec.angleDeg / (spec.count - 1);
}

/** Matrix (in the group's space) that takes the originals to copy `i`. `first` is the local matrix of the first original. */
export function patternMatrix(spec: PatternSpec, i: number, first: Mat4): Mat4 {
  const own = matrixAxes(first);
  const dir = (v: readonly number[]): Vec3 => (spec.space === 'LOCAL' ? add(add(scaleVec(own[0], v[0]), scaleVec(own[1], v[1])), scaleVec(own[2], v[2])) : [v[0], v[1], v[2]]);
  if (spec.kind === 'LINEAR') return translationMatrix(scaleVec(dir(spec.offset), i));
  const e: Vec3 = [0, 0, 0];
  e[spec.axis] = 1;
  return aboutPoint(spec.center, rotationMatrix(dir(e), patternStep(spec) * i));
}

/** Default parameters for a new pattern of `ids`: three copies a little apart along X, or six around Z. */
export function defaultPatternParams(state: ProjectState, ids: readonly NodeId[], kind: PatternSpec['kind']): PatternParams {
  const size = boxSize(boundsOf(state, ids));
  const step = Math.max(1, Math.round((size[0] || state.scene.partSizeMm || 100) * 1.25));
  if (kind === 'LINEAR') return { kind, count: 3, offset: [step, 0, 0], space: 'GLOBAL', axis: 2, angleDeg: 360 };
  return { kind, count: 6, offset: [0, 0, 0], space: 'GLOBAL', axis: 2, angleDeg: 360 };
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export type TransformAction =
  /** Several local transforms at once (the gizmo, the inspector fields). */
  | ({ type: 'scene/setTransforms'; transforms: Record<NodeId, Transform> } & ActionBase)
  /** Moves by `delta` along the world axes (GLOBAL) or the first node's own (LOCAL), mm. */
  | ({ type: 'scene/move'; ids: NodeId[]; delta: Vec3; space: Space } & ActionBase)
  | ({ type: 'scene/rotate'; ids: NodeId[]; axis: Axis; deg: number; space: Space } & ActionBase)
  | ({ type: 'scene/scale'; ids: NodeId[]; factors: Vec3; space: Space } & ActionBase)
  | ({ type: 'scene/centerAndRest'; ids: NodeId[] } & ActionBase)
  | ({ type: 'scene/resetTransform'; ids: NodeId[] } & ActionBase)
  /**
   * Reset scale (phase U9, right click ▸ Scale…): each node takes back the scale it had when it entered the scene,
   * about its own pivot (which stays where it is); position and rotation are kept.
   */
  | ({ type: 'scene/resetScale'; ids: NodeId[] } & ActionBase)
  /** The current transforms become the ones Reset returns to (after the import sheet places a model). */
  | ({ type: 'scene/setInitial'; ids: NodeId[] } & ActionBase)
  /** `point` (world, mm) is needed for CUSTOM. */
  | ({ type: 'scene/setPivot'; ids: NodeId[]; mode: PivotMode; point?: Vec3 } & ActionBase)
  | ({ type: 'scene/duplicate'; ids: NodeId[]; linked: boolean } & ActionBase)
  | ({ type: 'scene/group'; ids: NodeId[]; name: string } & ActionBase)
  | ({ type: 'scene/ungroup'; ids: NodeId[] } & ActionBase)
  /** Move to group: `parent` null puts the nodes at the root. */
  | ({ type: 'scene/reparent'; ids: NodeId[]; parent: NodeId | null } & ActionBase)
  | ({ type: 'scene/pattern'; ids: NodeId[]; params: PatternParams; name: string } & ActionBase)
  | ({ type: 'scene/editPattern'; id: NodeId; patch: Partial<Omit<PatternSpec, 'sources'>> } & ActionBase)
  | ({ type: 'scene/flipNormals'; ids: NodeId[] } & ActionBase)
  | ({ type: 'scene/setSmoothAngle'; ids: NodeId[]; deg: number } & ActionBase)
  /** `names`: the name of each material, for the names of the new parts. */
  | ({ type: 'scene/separateByMaterial'; ids: NodeId[]; names?: Record<MaterialId, string> } & ActionBase)
  /** Each part with CAD faces under `ids` becomes one part per face (phase M1). */
  | ({ type: 'scene/separateByCadFaces'; ids: NodeId[] } & ActionBase)
  /** LIGHT: aims at a world point. */
  | ({ type: 'scene/aim'; id: NodeId; target: Vec3 } & ActionBase);

// ---------------------------------------------------------------------------
// A mutable copy of the scene for the structural operations
// ---------------------------------------------------------------------------

class Draft {
  nodes: Record<NodeId, SceneNode>;
  roots: NodeId[];
  materials: Record<MaterialId, MaterialInstance>;
  private readonly taken: string[];

  constructor(readonly base: ProjectState) {
    this.nodes = { ...base.scene.nodes };
    this.roots = [...base.scene.roots];
    this.materials = base.materials;
    this.taken = Object.keys(this.nodes);
  }

  newId(): NodeId {
    const id = nextId('n', this.taken);
    this.taken.push(id);
    return id;
  }

  patch(id: NodeId, patch: Partial<SceneNode>): void {
    this.nodes[id] = { ...this.nodes[id], ...patch };
  }

  children(parent: NodeId | null): NodeId[] {
    return parent ? this.nodes[parent].children : this.roots;
  }

  setChildren(parent: NodeId | null, list: NodeId[]): void {
    if (parent) this.patch(parent, { children: list });
    else this.roots = list;
  }

  /** Takes a node out of its parent's list; returns where it was. */
  detach(id: NodeId): number {
    const parent = this.nodes[id].parent;
    const list = this.children(parent);
    const i = list.indexOf(id);
    if (i >= 0) this.setChildren(parent, [...list.slice(0, i), ...list.slice(i + 1)]);
    return i;
  }

  insert(parent: NodeId | null, id: NodeId, index: number): void {
    const list = [...this.children(parent)];
    list.splice(index < 0 || index > list.length ? list.length : index, 0, id);
    this.setChildren(parent, list);
    this.patch(id, { parent });
  }

  world(id: NodeId | null): Mat4 {
    if (!id) return mat4Identity();
    const node = this.nodes[id];
    if (!node) return mat4Identity();
    const local = composeTransform(node.transform);
    return node.parent ? mat4Multiply(this.world(node.parent), local) : local;
  }

  /** Moves a node under another parent keeping where it is in the world (and where Reset takes it). */
  reparent(id: NodeId, parent: NodeId | null, index = -1): void {
    const node = this.nodes[id];
    const from = this.world(node.parent);
    const toInv = mat4Invert(this.world(parent));
    const move = (t: Transform) => decomposeMatrix(mat4Multiply(toInv, mat4Multiply(from, composeTransform(t))), t);
    const same = node.parent === parent;
    this.detach(id);
    this.patch(id, same ? {} : { transform: move(node.transform), initial: move(node.initial ?? IDENTITY_TRANSFORM) });
    this.insert(parent, id, index);
  }

  removeSubtree(id: NodeId): void {
    const doomed = this.subtree(id);
    this.detach(id);
    for (const n of doomed) delete this.nodes[n];
  }

  subtree(id: NodeId): NodeId[] {
    const out: NodeId[] = [];
    const walk = (n: NodeId) => {
      const node = this.nodes[n];
      if (!node) return;
      out.push(n);
      node.children.forEach(walk);
    };
    walk(id);
    return out;
  }

  /** Adds a copy of an instance; returns its id. */
  addMaterial(inst: MaterialInstance): MaterialId {
    const id = nextId('m', Object.keys(this.materials));
    this.materials = { ...this.materials, [id]: cloneInstance(inst, id) };
    return id;
  }

  /**
   * Copies the subtree of `id` under `parent`. Linked copies share meshes and materials; independent ones get
   * their own material instances (one per original instance) and their own mesh ids (same data until edited).
   */
  copy(id: NodeId, parent: NodeId | null, index: number, linked: boolean, root?: Partial<SceneNode>): NodeId {
    const matMap = new Map<MaterialId, MaterialId>();
    const mat = (m: MaterialId | null | undefined): MaterialId | null => {
      if (!m || linked) return m ?? null;
      const src = this.materials[m];
      if (!src) return m;
      let c = matMap.get(m);
      if (!c) matMap.set(m, (c = this.addMaterial(src)));
      return c;
    };
    const idMap = new Map<NodeId, NodeId>();
    for (const n of this.subtree(id)) idMap.set(n, this.newId());
    for (const [old, fresh] of idMap) {
      const src = this.nodes[old];
      const node: SceneNode = {
        ...src,
        id: fresh,
        parent: old === id ? parent : idMap.get(src.parent!)!,
        children: src.children.map((c) => idMap.get(c)!),
        transform: cloneTransform(src.transform),
        initial: cloneTransform(src.transform),
      };
      if (src.kind === 'PART') {
        node.material = mat(src.material);
        if (src.faceMaterials) node.faceMaterials = src.faceMaterials.map((f) => ({ ...f, material: mat(f.material) ?? f.material }));
        if (src.mesh && !linked) {
          // A primitive's own copy owns its own mesh (same measures, its own id): editing one never reaches the other.
          if (src.primitive) {
            const made = ensurePrimitiveMesh(fresh, src.primitive);
            node.mesh = made.ref;
            node.faceRanges = made.faceRanges;
            node.primitive = { kind: src.primitive.kind, params: { ...src.primitive.params } };
          } else node.mesh = aliasMesh(src.mesh, fresh);
        }
      }
      if (src.pattern) node.pattern = { ...src.pattern, sources: src.pattern.sources.map((s) => idMap.get(s) ?? s) };
      this.nodes[fresh] = old === id && root ? { ...node, ...root, initial: root.transform ? cloneTransform(root.transform) : node.initial } : node;
    }
    const fresh = idMap.get(id)!;
    const list = [...this.children(parent)];
    list.splice(index < 0 || index > list.length ? list.length : index, 0, fresh);
    this.setChildren(parent, list);
    return fresh;
  }

  state(selection?: NodeId[], level?: ProjectState['selection']['level']): ProjectState {
    let next: ProjectState = { ...this.base, scene: { ...this.base.scene, nodes: this.nodes, roots: this.roots }, materials: this.materials };
    if (selection) next = { ...next, selection: { level: level ?? next.selection.level, ids: selection } };
    return pruneMaterials(cleanSelection(next));
  }
}

/** Another id for the same geometry, so an independent copy can be edited (flipped, smoothed) on its own. */
function aliasMesh(ref: MeshRef, node: NodeId): MeshRef {
  const data = getMesh(ref.id);
  if (!data) return ref;
  return ensureMesh(`${baseMeshId(ref.id)}~dup:${node}`, () => ({ data })) ?? ref;
}

/** A name with the next number: "Cap" -> "Cap 2", "Cap 2" -> "Cap 3". */
export function nextName(name: string, taken: readonly string[]): string {
  const m = /^(.*?)(?: (\d+))?$/.exec(name)!;
  const stem = m[1] || name;
  let n = m[2] ? Number(m[2]) + 1 : 2;
  while (taken.includes(`${stem} ${n}`)) n++;
  return `${stem} ${n}`;
}

// ---------------------------------------------------------------------------
// Reducers
// ---------------------------------------------------------------------------

function setTransforms(state: ProjectState, transforms: Record<NodeId, Transform>): ProjectState {
  let nodes: Record<NodeId, SceneNode> | null = null;
  for (const [id, t] of Object.entries(transforms)) {
    const node = state.scene.nodes[id];
    if (!node || sameTransform(node.transform, t)) continue;
    nodes ??= { ...state.scene.nodes };
    nodes[id] = { ...node, transform: cloneTransform(t) };
  }
  return nodes ? { ...state, scene: { ...state.scene, nodes } } : state;
}

function moveBy(state: ProjectState, ids: readonly NodeId[], delta: GizmoDelta, space: Space): ProjectState {
  const frame = selectionFrame(state, movableTargets(state, ids), space);
  if (!frame) return state;
  return setTransforms(state, applyWorldMatrix(state, ids, deltaMatrix(frame, delta)));
}

function resetTransform(state: ProjectState, ids: readonly NodeId[]): ProjectState {
  const out: Record<NodeId, Transform> = {};
  for (const id of movableTargets(state, ids)) out[id] = cloneTransform(state.scene.nodes[id].initial ?? IDENTITY_TRANSFORM);
  return setTransforms(state, out);
}

function resetScale(state: ProjectState, ids: readonly NodeId[]): ProjectState {
  let next = state;
  for (const id of movableTargets(state, ids)) {
    const node = next.scene.nodes[id];
    const want = node.initial?.scale ?? IDENTITY_TRANSFORM.scale;
    if (node.transform.scale.every((v, i) => v === want[i])) continue;
    // Each node about its own pivot: the pivot is where it was before.
    const before = pivotPoint(next, [id]);
    const scaled: ProjectState = { ...next, scene: { ...next.scene, nodes: { ...next.scene.nodes, [id]: { ...node, transform: { ...node.transform, scale: [want[0], want[1], want[2]] } } } } };
    const after = pivotPoint(scaled, [id]);
    const delta = sub(before, after);
    const n2 = scaled.scene.nodes[id];
    const local = node.parent ? transformDirection(mat4Invert(worldMatrix(scaled, node.parent)), delta) : delta;
    next = { ...scaled, scene: { ...scaled.scene, nodes: { ...scaled.scene.nodes, [id]: { ...n2, transform: { ...n2.transform, position: [round(n2.transform.position[0] + local[0], 6), round(n2.transform.position[1] + local[1], 6), round(n2.transform.position[2] + local[2], 6)] } } } } };
  }
  return next;
}

function setInitial(state: ProjectState, ids: readonly NodeId[]): ProjectState {
  const nodes = { ...state.scene.nodes };
  let changed = false;
  for (const root of ids) {
    for (const id of subtree(state, root)) {
      const n = nodes[id];
      if (n.initial && sameTransform(n.initial, n.transform)) continue;
      nodes[id] = { ...n, initial: cloneTransform(n.transform) };
      changed = true;
    }
  }
  return changed ? { ...state, scene: { ...state.scene, nodes } } : state;
}

function setPivot(state: ProjectState, ids: readonly NodeId[], mode: PivotMode, point?: Vec3): ProjectState {
  const nodes = { ...state.scene.nodes };
  let changed = false;
  for (const id of ids) {
    const n = nodes[id];
    if (!n) continue;
    let pivot: Pivot;
    if (mode === 'CUSTOM') {
      if (point) pivot = { mode, point: transformPoint(mat4Invert(worldMatrix(state, id)), point).map((v) => round(v, 6)) as Vec3 };
      else if (n.pivot?.point) pivot = { mode, point: n.pivot.point };
      else continue;
    } else pivot = { mode };
    if (n.pivot?.mode === pivot.mode && (pivot.point === undefined || (n.pivot.point && n.pivot.point.every((v, i) => v === pivot.point![i])))) continue;
    nodes[id] = { ...n, pivot };
    changed = true;
  }
  return changed ? { ...state, scene: { ...state.scene, nodes } } : state;
}

function duplicate(state: ProjectState, ids: readonly NodeId[], linked: boolean): ProjectState {
  const targets = topMost(state, ids);
  if (targets.length === 0) return state;
  const d = new Draft(state);
  const names = Object.values(state.scene.nodes).map((n) => n.name);
  const made: NodeId[] = [];
  for (const id of targets) {
    const node = d.nodes[id];
    const at = d.children(node.parent).indexOf(id);
    const name = nextName(node.name, names);
    names.push(name);
    made.push(d.copy(id, node.parent, at + 1, linked, { name }));
  }
  return d.state(made);
}

/**
 * Puts `ids` into a new group (identity transform) under the parent of the first of them, where it was; nodes
 * from other parents keep their place in the world.
 */
function groupInto(d: Draft, ids: readonly NodeId[], name: string, extra: Partial<SceneNode> = {}): NodeId {
  const parent = d.nodes[ids[0]].parent;
  const at = d.children(parent).indexOf(ids[0]);
  const id = d.newId();
  d.nodes[id] = {
    id,
    name,
    kind: 'GROUP',
    parent,
    children: [],
    transform: cloneTransform(IDENTITY_TRANSFORM),
    initial: cloneTransform(IDENTITY_TRANSFORM),
    visible: true,
    locked: false,
    ...extra,
  };
  d.insert(parent, id, at);
  for (const n of ids) d.reparent(n, id);
  return id;
}

function group(state: ProjectState, ids: readonly NodeId[], name: string): ProjectState {
  const targets = movableTargets(state, ids);
  if (targets.length === 0) return state;
  const d = new Draft(state);
  const id = groupInto(d, targets, name);
  return d.state([id], 'GROUP');
}

function ungroup(state: ProjectState, ids: readonly NodeId[]): ProjectState {
  const groups = topMost(state, ids).filter((id) => state.scene.nodes[id].kind === 'GROUP');
  if (groups.length === 0) return state;
  const d = new Draft(state);
  const freed: NodeId[] = [];
  for (const g of groups) {
    const node = d.nodes[g];
    let at = d.children(node.parent).indexOf(g);
    for (const c of [...node.children]) {
      d.reparent(c, node.parent, ++at);
      freed.push(c);
    }
    d.removeSubtree(g);
  }
  return d.state(freed, 'PART');
}

/** Groups and models a selection can move into (not inside itself). */
export function groupTargets(state: ProjectState, ids: readonly NodeId[]): NodeId[] {
  const inside = new Set<NodeId>();
  for (const id of ids) for (const n of subtree(state, id)) inside.add(n);
  return Object.values(state.scene.nodes)
    .filter((n) => (n.kind === 'GROUP' || n.kind === 'MODEL') && !inside.has(n.id))
    .map((n) => n.id);
}

function reparent(state: ProjectState, ids: readonly NodeId[], parent: NodeId | null): ProjectState {
  if (parent && !groupTargets(state, ids).includes(parent)) return state;
  const targets = movableTargets(state, ids).filter((id) => state.scene.nodes[id].parent !== parent);
  if (targets.length === 0) return state;
  const d = new Draft(state);
  for (const id of targets) d.reparent(id, parent);
  return d.state();
}

/** Regenerates the copies of a pattern group from its originals and parameters. */
function regenerate(d: Draft, groupId: NodeId): void {
  const g = d.nodes[groupId];
  const spec = g.pattern;
  if (!spec) return;
  const sources = spec.sources.filter((s) => d.nodes[s]?.parent === groupId);
  for (const c of [...g.children]) if (!sources.includes(c)) d.removeSubtree(c);
  if (sources.length === 0) return;
  const first = composeTransform(d.nodes[sources[0]].transform);
  for (let i = 1; i < spec.count; i++) {
    const m = patternMatrix(spec, i, first);
    for (const s of sources) {
      const src = d.nodes[s];
      const transform = decomposeMatrix(mat4Multiply(m, composeTransform(src.transform)), src.transform);
      d.copy(s, groupId, -1, true, { transform, name: `${src.name} ${i + 1}` });
    }
  }
  d.patch(groupId, { pattern: { ...spec, sources } });
}

function clampSpec(spec: PatternSpec): PatternSpec {
  const count = Math.max(1, Math.min(PATTERN_MAX, Math.round(Number.isFinite(spec.count) ? spec.count : 1)));
  const axis = (spec.axis === 0 || spec.axis === 1 ? spec.axis : 2) as Axis;
  return { ...spec, count, axis };
}

function pattern(state: ProjectState, ids: readonly NodeId[], params: PatternParams, name: string): ProjectState {
  const targets = movableTargets(state, ids);
  if (targets.length === 0) return state;
  const d = new Draft(state);
  const parent = state.scene.nodes[targets[0]].parent;
  const centerWorld = params.center === undefined ? pivotPoint(state, targets) : null;
  const center = centerWorld ? transformPoint(mat4Invert(d.world(parent)), centerWorld).map((v) => round(v, 6)) as Vec3 : [...params.center!] as Vec3;
  const spec = clampSpec({ ...params, offset: [...params.offset], center, sources: [] });
  const id = groupInto(d, targets, name, { pattern: { ...spec, sources: [...targets] } });
  regenerate(d, id);
  return d.state([id], 'GROUP');
}

function editPattern(state: ProjectState, id: NodeId, patch: Partial<Omit<PatternSpec, 'sources'>>): ProjectState {
  const g = state.scene.nodes[id];
  if (!g?.pattern) return state;
  const spec = clampSpec({ ...g.pattern, ...patch });
  const same = (Object.keys(spec) as (keyof PatternSpec)[]).every((k) => JSON.stringify(spec[k]) === JSON.stringify(g.pattern![k]));
  if (same) return state;
  const d = new Draft(state);
  d.patch(id, { pattern: spec });
  regenerate(d, id);
  return d.state();
}

/** The id a mesh had before any operation of this module (`body~flip~s45` -> `body`). */
export function baseMeshId(id: MeshId): MeshId {
  const i = id.indexOf('~');
  return i < 0 ? id : id.slice(0, i);
}

/** Parts under `ids` plus every part that shares a mesh with one of them (linked copies change together). */
function linkedParts(state: ProjectState, ids: readonly NodeId[]): Map<MeshId, NodeId[]> {
  const meshes = new Set<MeshId>();
  for (const p of partsUnder(state, ids)) {
    const m = state.scene.nodes[p].mesh?.id;
    if (m) meshes.add(m);
  }
  const out = new Map<MeshId, NodeId[]>();
  for (const n of Object.values(state.scene.nodes)) {
    if (n.kind !== 'PART' || !n.mesh || !meshes.has(n.mesh.id)) continue;
    (out.get(n.mesh.id) ?? out.set(n.mesh.id, []).get(n.mesh.id)!).push(n.id);
  }
  return out;
}

function withMeshes(state: ProjectState, fn: (meshId: MeshId) => ((node: SceneNode) => SceneNode) | null, ids: readonly NodeId[]): ProjectState {
  const groups = linkedParts(state, ids);
  if (groups.size === 0) return state;
  const nodes = { ...state.scene.nodes };
  let changed = false;
  for (const [meshId, parts] of groups) {
    const f = fn(meshId);
    if (!f) continue;
    for (const p of parts) {
      let next = f(nodes[p]);
      // Other geometry than the measures make: no longer a parametric primitive (phase U9).
      if (next !== nodes[p] && next.primitive && next.mesh?.id !== nodes[p].mesh?.id) {
        next = { ...next };
        delete next.primitive;
      }
      if (next !== nodes[p]) {
        nodes[p] = next;
        changed = true;
      }
    }
  }
  return changed ? { ...state, scene: { ...state.scene, nodes } } : state;
}

function flipNormals(state: ProjectState, ids: readonly NodeId[]): ProjectState {
  return withMeshes(
    state,
    (meshId) => {
      const data = getMesh(meshId);
      if (!data) return null;
      const id = meshId.endsWith('~flip') ? meshId.slice(0, -5) : `${meshId}~flip`;
      const ref = ensureMesh(id, () => ({ data: flipMesh(data) }));
      return ref ? (n) => ({ ...n, mesh: ref }) : null;
    },
    ids,
  );
}

/** Face ranges of a part after its triangles were renumbered (`source[t]` = old triangle of new triangle t). */
function remapRanges(ranges: readonly FaceRange[], source: Uint32Array): FaceRange[] {
  const per = new Map<number, MaterialId>();
  for (const f of ranges) for (let t = f.start; t < f.start + f.count; t++) per.set(t, f.material);
  const out: FaceRange[] = [];
  for (let t = 0; t < source.length; t++) {
    const m = per.get(source[t]);
    if (!m) continue;
    const last = out[out.length - 1];
    if (last && last.material === m && last.start + last.count === t) last.count++;
    else out.push({ start: t, count: 1, material: m });
  }
  return out;
}

function setSmoothAngle(state: ProjectState, ids: readonly NodeId[], deg: number): ProjectState {
  const angle = Math.round(Math.max(0, Math.min(180, deg)) * 10) / 10;
  return withMeshes(
    state,
    (meshId) => {
      const data = getMesh(meshId);
      if (!data) return null;
      const stem = meshId.replace(/~s[0-9.]+$/, '');
      const id = `${stem}~s${angle}`;
      const ref = ensureMesh(id, () => resmoothMesh(data, angle));
      if (!ref) return null;
      const source = triangleSource(id);
      return (n) => {
        if (n.mesh?.id === ref.id && n.smoothAngle === angle && n.smooth !== false) return n;
        const next: SceneNode = { ...n, mesh: ref, smoothAngle: angle, smooth: true };
        // Only a mesh made from the stem renumbers triangles relative to it.
        if (n.faceMaterials?.length && source && meshId === stem) next.faceMaterials = remapRanges(n.faceMaterials, source);
        if (n.faceRanges?.length && source && meshId === stem) next.faceRanges = remapTriangleRanges(n.faceRanges, source);
        return next;
      };
    },
    ids,
  );
}

/**
 * Replaces a part by one part per piece, in its place in the tree: each piece is a slice of the mesh, centred on
 * its own bounds, with the transform of the part moved to that centre so the geometry stays where it was. The
 * pieces keep the part's visibility, lock, smoothing and (renumbered) CAD faces. Returns their ids.
 */
function replaceByPieces(d: Draft, node: SceneNode, data: MeshData, pieces: readonly FacePiece[]): NodeId[] {
  const at = d.detach(node.id);
  const local = composeTransform(node.transform);
  const made: NodeId[] = [];
  for (const piece of pieces) {
    const slice = sliceMesh(data, piece.tris);
    const ref = ensureMesh(`${node.mesh!.id}~tris${hashIndices(piece.tris)}`, () => ({ data: slice.mesh }));
    if (!ref) continue;
    const id = d.newId();
    const transform: Transform = { ...cloneTransform(node.transform), position: transformPoint(local, slice.centre).map((v) => round(v, 6)) as Vec3 };
    const part: SceneNode = {
      id,
      name: piece.name,
      kind: 'PART',
      parent: node.parent,
      children: [],
      transform,
      initial: cloneTransform(transform),
      visible: node.visible,
      locked: node.locked,
      mesh: ref,
      material: piece.material,
      smooth: node.smooth,
    };
    if (piece.faceMaterials.length > 0) part.faceMaterials = piece.faceMaterials;
    if (node.smoothAngle !== undefined) part.smoothAngle = node.smoothAngle;
    // The CAD faces (STEP, IGES) of the slice, numbered in it.
    if (node.faceRanges?.length) part.faceRanges = remapTriangleRanges(node.faceRanges, piece.tris);
    d.nodes[id] = part;
    made.push(id);
  }
  const list = [...d.children(node.parent)];
  list.splice(at, 0, ...made);
  d.setChildren(node.parent, list);
  delete d.nodes[node.id];
  return made;
}

function separateByMaterial(state: ProjectState, ids: readonly NodeId[], names: Record<MaterialId, string> = {}): ProjectState {
  const parts = partsUnder(state, ids).filter((p) => state.scene.nodes[p].faceMaterials?.length);
  if (parts.length === 0) return state;
  const d = new Draft(state);
  const selected = new Set(state.selection.ids);
  const nextSelection: NodeId[] = state.selection.ids.filter((id) => !parts.includes(id));
  for (const p of parts) {
    const node = d.nodes[p];
    const data = node.mesh ? getMesh(node.mesh.id) : undefined;
    if (!data || !node.mesh) continue;
    const groups = new Map<MaterialId | '', number[]>();
    triangleMaterials(node).forEach((m, t) => (groups.get(m ?? '') ?? groups.set(m ?? '', []).get(m ?? '')!).push(t));
    if (groups.size < 2) {
      // One material for every triangle: it becomes the material of the part.
      const only = [...groups.keys()][0];
      d.patch(p, { material: only === '' ? null : only, faceMaterials: undefined });
      delete d.nodes[p].faceMaterials;
      if (selected.has(p)) nextSelection.push(p);
      continue;
    }
    let i = 0;
    const pieces: FacePiece[] = [...groups].map(([mat, tris]) => {
      const label = mat === '' ? '' : (names[mat] ?? '');
      i++;
      return { tris, name: label ? `${node.name} (${label})` : `${node.name} ${i}`, material: mat === '' ? null : mat, faceMaterials: [] };
    });
    const made = replaceByPieces(d, node, data, pieces);
    if (selected.has(p)) nextSelection.push(...made);
  }
  return d.state(nextSelection, state.selection.level === 'FACES' ? 'PART' : state.selection.level);
}

/**
 * Each part that carries two or more CAD faces (STEP, IGES; `faceRanges`) becomes one part per face, named after
 * the part and numbered, with the colour the face had. Parts without CAD faces are left as they are.
 */
function separateByCadFaces(state: ProjectState, ids: readonly NodeId[]): ProjectState {
  const parts = partsUnder(state, ids).filter((p) => canSeparateByFaces(state.scene.nodes[p]));
  if (parts.length === 0) return state;
  const d = new Draft(state);
  const selected = new Set(state.selection.ids);
  const nextSelection: NodeId[] = state.selection.ids.filter((id) => !parts.includes(id));
  for (const p of parts) {
    const node = d.nodes[p];
    const data = node.mesh ? getMesh(node.mesh.id) : undefined;
    if (!data) continue;
    const made = replaceByPieces(d, node, data, facePieces(node));
    if (selected.has(p)) nextSelection.push(...made);
  }
  return d.state(nextSelection, state.selection.level === 'FACES' ? 'PART' : state.selection.level);
}

function aim(state: ProjectState, id: NodeId, target: Vec3): ProjectState {
  const node = state.scene.nodes[id];
  if (!node || node.kind !== 'LIGHT') return state;
  if (node.target && node.target.every((v, i) => v === target[i])) return state;
  return { ...state, scene: { ...state.scene, nodes: { ...state.scene.nodes, [id]: { ...node, target: [target[0], target[1], target[2]] } } } };
}

/** Reducer of the operations of this module; other actions return the state unchanged. */
export function reduceTransform(state: ProjectState, action: TransformAction): ProjectState {
  switch (action.type) {
    case 'scene/setTransforms':
      return setTransforms(state, action.transforms);
    case 'scene/move':
      return moveBy(state, action.ids, { kind: 'move', amounts: action.delta }, action.space);
    case 'scene/rotate':
      return moveBy(state, action.ids, { kind: 'rotate', axis: action.axis, deg: action.deg }, action.space);
    case 'scene/scale':
      return moveBy(state, action.ids, { kind: 'scale', factors: action.factors }, action.space);
    case 'scene/centerAndRest': {
      const targets = movableTargets(state, action.ids);
      return targets.length || action.ids.length === 0 ? restOnFloor(centerXY(state, targets), targets) : state;
    }
    case 'scene/resetTransform':
      return resetTransform(state, action.ids);
    case 'scene/resetScale':
      return resetScale(state, action.ids);
    case 'scene/setInitial':
      return setInitial(state, action.ids);
    case 'scene/setPivot':
      return setPivot(state, action.ids, action.mode, action.point);
    case 'scene/duplicate':
      return duplicate(state, action.ids, action.linked);
    case 'scene/group':
      return group(state, action.ids, action.name);
    case 'scene/ungroup':
      return ungroup(state, action.ids);
    case 'scene/reparent':
      return reparent(state, action.ids, action.parent);
    case 'scene/pattern':
      return pattern(state, action.ids, action.params, action.name);
    case 'scene/editPattern':
      return editPattern(state, action.id, action.patch);
    case 'scene/flipNormals':
      return flipNormals(state, action.ids);
    case 'scene/setSmoothAngle':
      return setSmoothAngle(state, action.ids, action.deg);
    case 'scene/separateByMaterial':
      return separateByMaterial(state, action.ids, action.names);
    case 'scene/separateByCadFaces':
      return separateByCadFaces(state, action.ids);
    case 'scene/aim':
      return aim(state, action.id, action.target);
    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Queries for the menus
// ---------------------------------------------------------------------------

/** The pattern group a node is, or is the original or a copy of. */
export function patternGroupOf(state: ProjectState, id: NodeId): NodeId | null {
  const node = state.scene.nodes[id];
  if (node?.pattern) return id;
  const parent = node?.parent ? state.scene.nodes[node.parent] : undefined;
  return parent?.pattern ? parent.id : null;
}

/** Parts whose material (whole or by faces) is `material`. */
export function partsWithMaterial(state: ProjectState, material: MaterialId): NodeId[] {
  return Object.values(state.scene.nodes)
    .filter((n) => n.kind === 'PART' && partMaterials(n).includes(material))
    .map((n) => n.id);
}

/** Some part of `ids` shares a material instance with a part outside them. */
export function sharesMaterial(state: ProjectState, ids: readonly NodeId[]): boolean {
  const mine = new Set(partsUnder(state, ids));
  for (const p of mine) {
    for (const m of partMaterials(state.scene.nodes[p])) if (partsWithMaterial(state, m).some((q) => q !== p)) return true;
  }
  return false;
}

/** Some part of `ids` carries CAD faces that "Separate by CAD faces" can cut (two or more). */
export function hasCadFaces(state: ProjectState, ids: readonly NodeId[]): boolean {
  return partsUnder(state, ids).some((p) => canSeparateByFaces(state.scene.nodes[p]));
}

/** Some part of `ids` carries face ranges that can be separated. */
export function hasFaceMaterials(state: ProjectState, ids: readonly NodeId[]): boolean {
  return partsUnder(state, ids).some((p) => (state.scene.nodes[p].faceMaterials?.length ?? 0) > 0);
}
