// Scene tree: nodes, hierarchy, four-level selection, bounds, rest on the
// floor and centring (SPEC §3.1, §3.2). Pure functions over ProjectState.

import type { ActionBase, ProjectState } from './store';
import type { MaterialId, MaterialInstance } from './materials';
import { getMesh, transformedMeshBounds, type MeshId, type MeshRef, type TriangleRange } from './meshes';
import type { PrimitiveSpec } from './primitives';
import type { PhysicsProps } from './physics';
import { nextId } from './ids';
import {
  add,
  boxCenter,
  boxMaxDim,
  emptyBox,
  isEmptyBox,
  mat4Compose,
  mat4Identity,
  mat4Invert,
  mat4Multiply,
  transformBox,
  transformDirection,
  unionBox,
  type Box,
  type Mat4,
  type Vec3,
} from './math';

/** Id of a node of the scene tree. Lights and cameras use their own ids. */
export type NodeId = string;

/** Kind of a scene node (SPEC §3.1). */
export type NodeKind = 'MODEL' | 'GROUP' | 'PART' | 'CAMERA' | 'LIGHT' | 'FLOOR';

/** The four mutually exclusive selection levels (SPEC §3.2). */
export type SelectionLevel = 'MODEL' | 'GROUP' | 'PART' | 'FACES';

export const SELECTION_LEVELS: readonly SelectionLevel[] = ['MODEL', 'GROUP', 'PART', 'FACES'];

/** Local transform: position in mm, rotation in degrees (XYZ), scale factors. */
export interface Transform {
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
}

/** A run of triangles of a part that carries its own material (level FACES). */
export interface FaceRange {
  start: number;
  count: number;
  material: MaterialId;
}

/** Where the move tool turns and scales a node (SPEC §3.1): its bounds centre, the base of its bounds, its origin, or a picked point. */
export type PivotMode = 'CENTER' | 'BASE' | 'ORIGIN' | 'CUSTOM';

export interface Pivot {
  mode: PivotMode;
  /** CUSTOM: the point, in the node's own (local) space, so it moves with the node. */
  point?: Vec3;
}

/** Axes of an operation: the world's (GLOBAL) or the node's own (LOCAL). */
export type Space = 'LOCAL' | 'GLOBAL';

/** Index of an axis: 0 = X, 1 = Y, 2 = Z. */
export type Axis = 0 | 1 | 2;

/** A pattern of linked copies (SPEC §3.1 "Patrón"), kept on its group so editing it regenerates the copies. */
export interface PatternSpec {
  kind: 'LINEAR' | 'CIRCULAR';
  /** Copies including the original (1 or more). */
  count: number;
  /** LINEAR: step from one copy to the next, mm. */
  offset: Vec3;
  /** Axes of `offset` and `axis`: the group's (GLOBAL) or those of the first original (LOCAL). */
  space: Space;
  /** CIRCULAR: the axis the copies turn about. */
  axis: Axis;
  /** CIRCULAR: a point of that axis, in the group's space, mm (the pivot of the originals when it was made). */
  center: Vec3;
  /** CIRCULAR: angle the copies span, degrees; 360 is a full turn (no copy lands on the original). */
  angleDeg: number;
  /** The original nodes (copy 0). Every other child of the group is generated. */
  sources: NodeId[];
}

/** Where a MODEL came from. */
export interface ModelSource {
  kind: 'EXAMPLE' | 'FILE';
  /** File name, or the example key. */
  name: string;
  format?: string;
  /**
   * Set by importers of unit-less formats (OBJ, STL) when the size looks like metres (1000) or
   * micrometres (0.001): the factor that would bring it to millimetres. The Doctor's scale check uses it.
   */
  unitHint?: 1000 | 0.001;
}

/** One node of the scene tree: model, group or part (SPEC §3.1). */
export interface SceneNode {
  id: NodeId;
  name: string;
  kind: NodeKind;
  parent: NodeId | null;
  children: NodeId[];
  transform: Transform;
  visible: boolean;
  locked: boolean;
  /** Stable role inside a generated model (the example parts: 'body', 'cap'...). */
  key?: string;
  /** PART: the geometry. */
  mesh?: MeshRef;
  /** PART: material instance of the whole part, or null. */
  material?: MaterialId | null;
  /** PART: triangle ranges with their own material (level FACES). */
  faceMaterials?: FaceRange[];
  /**
   * PART: the faces of the CAD model the mesh was tessellated from (STEP, IGES), one run of triangles per face
   * in mesh order; every triangle is in exactly one. Selecting a whole CAD face (M1) and "separate by CAD
   * face" use them; the rest of the program ignores them.
   */
  faceRanges?: TriangleRange[];
  /** PART: smooth shading (false draws flat facets). */
  smooth?: boolean;
  /** MODEL: origin of the import. */
  source?: ModelSource;
  /** Pivot of the move tool; absent means CENTER. */
  pivot?: Pivot;
  /** The transform the node had when it entered the scene: Reset transform returns to it (absent: identity). */
  initial?: Transform;
  /** GROUP made by Pattern: its parameters. */
  pattern?: PatternSpec;
  /** PART: smoothing angle its normals were last recomputed with, degrees. */
  smoothAngle?: number;
  /** LIGHT: the world point it aims at, mm. */
  target?: Vec3;
  /**
   * PART made by Add ▸ Primitive (phase U9): its shape and measures. The mesh is generated from it (core/primitives.ts)
   * and a project file keeps only this, not the mesh. It describes the mesh for as long as it is there: an operation
   * that changes the geometry otherwise (flip, smoothing angle, separate) drops it, like Convert to mesh.
   */
  primitive?: PrimitiveSpec;
  /**
   * The Physics section (phase S2, core/physics.ts): role (STATIC when absent), density, friction, bounciness and, on
   * a group or a model, whether it falls as parts. Absent: the defaults.
   */
  physics?: PhysicsProps;
  /**
   * PART that a set (L6) put in the scene: one of its cards (`index` in the set's `cards`), its backdrop (the sweep) or
   * its floor (a plane). Set decoration: not the product (part size, the rig pivot, framing), not the Doctor's
   * business, replaced when another set is applied and removed by Reset setup (core/sets.ts).
   */
  setPiece?: SetPiece;
}

/** What a part of a set's decoration is (L6). */
export interface SetPiece {
  kind: 'CARD' | 'BACKDROP' | 'FLOOR';
  /** CARD: its index in the set's `cards`; 0 otherwise. */
  index: number;
}

/** The node is a piece of a set's decoration (L6). */
export function isSetPiece(node: SceneNode | undefined): boolean {
  return node?.setPiece !== undefined;
}

/** Ids of the meshes the parts of a state refer to, in order of first use. */
export function meshIdsInUse(state: Pick<ProjectState, 'scene'>): Set<MeshId> {
  const ids = new Set<MeshId>();
  for (const n of Object.values(state.scene.nodes)) if (n.mesh) ids.add(n.mesh.id);
  return ids;
}

/** Current selection (SPEC §3.2). `ids` may also hold one light or camera id. */
export interface Selection {
  level: SelectionLevel;
  ids: NodeId[];
  faces?: { part: NodeId; indices: number[] };
}

/** A model ready to be added: ids are local to the payload and get remapped. */
export interface ModelPayload {
  nodes: Record<NodeId, SceneNode>;
  roots: NodeId[];
  materials: Record<MaterialId, MaterialInstance>;
}

export type SelectMode = 'set' | 'add' | 'toggle';
/** Faces also leave the selection as a block (Ctrl on a face that is already selected). */
export type FaceSelectMode = SelectMode | 'remove';

export type SceneAction =
  | ({ type: 'scene/addModel'; payload: ModelPayload; replace: boolean } & ActionBase)
  | ({ type: 'scene/select'; ids: NodeId[]; mode: SelectMode; level?: SelectionLevel } & ActionBase)
  | ({ type: 'scene/setLevel'; level: SelectionLevel } & ActionBase)
  | ({ type: 'scene/selectFaces'; part: NodeId; indices: number[]; mode: FaceSelectMode } & ActionBase)
  | ({ type: 'scene/setVisible'; ids: NodeId[]; visible: boolean } & ActionBase)
  | ({ type: 'scene/isolate'; ids: NodeId[] } & ActionBase)
  | ({ type: 'scene/showAll' } & ActionBase)
  | ({ type: 'scene/setLocked'; ids: NodeId[]; locked: boolean } & ActionBase)
  | ({ type: 'scene/rename'; id: NodeId; name: string } & ActionBase)
  | ({ type: 'scene/delete'; ids: NodeId[] } & ActionBase)
  | ({ type: 'scene/restOnFloor'; ids: NodeId[] } & ActionBase)
  | ({ type: 'scene/center'; ids: NodeId[] } & ActionBase)
  | ({ type: 'scene/setTransform'; id: NodeId; transform: Partial<Transform> } & ActionBase)
  | ({ type: 'scene/setSmooth'; ids: NodeId[]; smooth: boolean } & ActionBase)
  | ({ type: 'scene/setPartSize'; mm: number } & ActionBase)
  | ({ type: 'scene/clear' } & ActionBase);

export const IDENTITY_TRANSFORM: Transform = { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] };

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export function getNode(state: ProjectState, id: NodeId): SceneNode | undefined {
  return state.scene.nodes[id];
}

export function hasModel(state: ProjectState): boolean {
  return state.scene.roots.length > 0;
}

/** Ancestors of a node, nearest first. */
export function ancestors(state: ProjectState, id: NodeId): NodeId[] {
  const out: NodeId[] = [];
  let cur = state.scene.nodes[id]?.parent ?? null;
  while (cur) {
    out.push(cur);
    cur = state.scene.nodes[cur]?.parent ?? null;
  }
  return out;
}

/** The node and all its descendants, depth first. */
export function subtree(state: ProjectState, id: NodeId): NodeId[] {
  const out: NodeId[] = [];
  const walk = (n: NodeId): void => {
    const node = state.scene.nodes[n];
    if (!node) return;
    out.push(n);
    for (const c of node.children) walk(c);
  };
  walk(id);
  return out;
}

/** Every PART under the given nodes (a part counts as under itself), without repeats. */
export function partsUnder(state: ProjectState, ids: readonly NodeId[]): NodeId[] {
  const seen = new Set<NodeId>();
  const out: NodeId[] = [];
  for (const id of ids) {
    for (const n of subtree(state, id)) {
      if (state.scene.nodes[n]?.kind === 'PART' && !seen.has(n)) {
        seen.add(n);
        out.push(n);
      }
    }
  }
  return out;
}

/** All PART nodes in tree order. */
export function allParts(state: ProjectState): NodeId[] {
  return partsUnder(state, state.scene.roots);
}

/** Drops ids whose ancestor is also in the list, so a transform is not applied twice. */
export function topMost(state: ProjectState, ids: readonly NodeId[]): NodeId[] {
  const set = new Set(ids);
  return ids.filter((id) => state.scene.nodes[id] && !ancestors(state, id).some((a) => set.has(a)));
}

/** Visible in the scene: the node and all its ancestors are visible. */
export function effectiveVisible(state: ProjectState, id: NodeId): boolean {
  const node = state.scene.nodes[id];
  if (!node || !node.visible) return false;
  return ancestors(state, id).every((a) => state.scene.nodes[a]?.visible !== false);
}

/** Tree order of every node, depth first: what the tree panel draws. */
export function treeOrder(state: ProjectState): NodeId[] {
  const out: NodeId[] = [];
  for (const r of state.scene.roots) out.push(...subtree(state, r));
  return out;
}

/**
 * The node a click on `partId` selects at `level` (SPEC §3.2): MODEL is the
 * root; GROUP is the nearest group ancestor, or the part itself when it has
 * none; PART and FACES are the part.
 */
export function resolvePick(state: ProjectState, partId: NodeId, level: SelectionLevel): NodeId {
  if (level === 'PART' || level === 'FACES') return partId;
  const chain = [partId, ...ancestors(state, partId)];
  if (level === 'MODEL') {
    for (const id of chain) if (state.scene.nodes[id]?.kind === 'MODEL') return id;
    return chain[chain.length - 1];
  }
  for (const id of chain) if (state.scene.nodes[id]?.kind === 'GROUP') return id;
  return partId;
}

/** Selection level that matches a node kind (tree clicks select exactly the row). */
export function levelForKind(kind: NodeKind): SelectionLevel {
  return kind === 'MODEL' ? 'MODEL' : kind === 'GROUP' ? 'GROUP' : 'PART';
}

/** Selected scene nodes (lights and cameras filtered out). */
export function selectedNodes(state: ProjectState): NodeId[] {
  return state.selection.ids.filter((id) => state.scene.nodes[id] !== undefined);
}

/** Local matrix of a node. */
export function localMatrix(node: SceneNode): Mat4 {
  return mat4Compose(node.transform.position, node.transform.rotation, node.transform.scale);
}

/** World matrix of a node (parents applied). */
export function worldMatrix(state: ProjectState, id: NodeId, cache?: Map<NodeId, Mat4>): Mat4 {
  const hit = cache?.get(id);
  if (hit) return hit;
  const node = state.scene.nodes[id];
  if (!node) return mat4Identity();
  const local = localMatrix(node);
  const m = node.parent ? mat4Multiply(worldMatrix(state, node.parent, cache), local) : local;
  cache?.set(id, m);
  return m;
}

/** True when a matrix maps the axes onto the axes (no rotation, or quarter turns): the box of a box is then exact. */
export function isAxisAligned(m: Mat4): boolean {
  for (let c = 0; c < 3; c++) {
    const col = [m[4 * c], m[4 * c + 1], m[4 * c + 2]];
    const len = Math.max(Math.abs(col[0]), Math.abs(col[1]), Math.abs(col[2]));
    if (col.filter((v) => Math.abs(v) > len * 1e-9).length > 1) return false;
  }
  return true;
}

/**
 * World bounds of one part. Rotated parts use their vertices (the lowest point of a turned part is not a corner
 * of its turned box); without the mesh data, or without rotation, the box of the local box.
 */
export function partWorldBounds(state: ProjectState, id: NodeId, cache?: Map<NodeId, Mat4>): Box {
  const node = state.scene.nodes[id];
  if (!node || node.kind !== 'PART' || !node.mesh) return emptyBox();
  const m = worldMatrix(state, id, cache);
  if (!isAxisAligned(m)) {
    const data = getMesh(node.mesh.id);
    if (data) return transformedMeshBounds(data, m);
  }
  return transformBox(m, node.mesh.bounds);
}

/** World bounds of every part under the given nodes. `visibleOnly` skips hidden parts. */
export function boundsOf(state: ProjectState, ids: readonly NodeId[], visibleOnly = false): Box {
  const cache = new Map<NodeId, Mat4>();
  let b = emptyBox();
  for (const p of partsUnder(state, ids)) {
    if (visibleOnly && !effectiveVisible(state, p)) continue;
    b = unionBox(b, partWorldBounds(state, p, cache));
  }
  return b;
}

/** World bounds of the whole scene. */
export function sceneBounds(state: ProjectState, visibleOnly = false): Box {
  return boundsOf(state, state.scene.roots, visibleOnly);
}

/**
 * The parts that are the product: every part that is not a primitive (phase U9: a base, a backdrop, a pedestal is
 * the set, not the subject). A scene made only of primitives is its own product: then every part. The decoration of
 * a set (L6: cards, its backdrop, its floor) is never the product, not even then.
 */
export function productParts(state: ProjectState, visibleOnly = false): NodeId[] {
  const parts = allParts(state).filter((p) => !isSetPiece(state.scene.nodes[p]) && (!visibleOnly || effectiveVisible(state, p)));
  const product = parts.filter((p) => !state.scene.nodes[p].primitive);
  return product.length > 0 ? product : parts;
}

/** Some part of the scene is not a primitive: there is a product to stage. */
export function hasProduct(state: ProjectState, visibleOnly = false): boolean {
  return allParts(state).some((p) => !state.scene.nodes[p].primitive && !isSetPiece(state.scene.nodes[p]) && (!visibleOnly || effectiveVisible(state, p)));
}

/** The parts that are not a set's decoration (L6): what the Doctor looks at and what framing the scene frames. */
export function ownParts(state: ProjectState): NodeId[] {
  return allParts(state).filter((p) => !isSetPiece(state.scene.nodes[p]));
}

/**
 * World bounds of the product (`productParts`): what the rig is placed around, what Create studio frames and what the
 * part size measures, so an infinity sweep six times the product does not move the lights or change the scale.
 */
export function productBounds(state: ProjectState, visibleOnly = false): Box {
  const cache = new Map<NodeId, Mat4>();
  let b = emptyBox();
  for (const p of productParts(state, visibleOnly)) b = unionBox(b, partWorldBounds(state, p, cache));
  return b;
}

/** Measured size of the model: largest dimension of the bounds of the product, mm (0 when empty). */
export function measuredSizeMm(state: ProjectState): number {
  const b = productBounds(state);
  return isEmptyBox(b) ? 0 : boxMaxDim(b);
}

/** Total triangles of the visible parts. */
export function triangleCount(state: ProjectState): number {
  let n = 0;
  for (const p of allParts(state)) {
    if (effectiveVisible(state, p)) n += state.scene.nodes[p].mesh?.triangles ?? 0;
  }
  return n;
}

/**
 * Converts a displacement expressed in world space into the parent space of
 * `id`, so it can be added to the node's local position.
 */
export function worldToLocalDelta(state: ProjectState, id: NodeId, delta: Vec3, cache?: Map<NodeId, Mat4>): Vec3 {
  const parent = state.scene.nodes[id]?.parent;
  if (!parent) return delta;
  return transformDirection(mat4Invert(worldMatrix(state, parent, cache)), delta);
}

// ---------------------------------------------------------------------------
// Immutable helpers
// ---------------------------------------------------------------------------

function withNodes(state: ProjectState, nodes: Record<NodeId, SceneNode>): ProjectState {
  return { ...state, scene: { ...state.scene, nodes } };
}

function patchNodes(state: ProjectState, ids: readonly NodeId[], fn: (n: SceneNode) => SceneNode): ProjectState {
  let changed = false;
  const nodes = { ...state.scene.nodes };
  for (const id of ids) {
    const node = nodes[id];
    if (!node) continue;
    const next = fn(node);
    if (next !== node) {
      nodes[id] = next;
      changed = true;
    }
  }
  return changed ? withNodes(state, nodes) : state;
}

/** Translates nodes by a world-space vector. */
export function translateWorld(state: ProjectState, ids: readonly NodeId[], delta: Vec3): ProjectState {
  if (delta[0] === 0 && delta[1] === 0 && delta[2] === 0) return state;
  const cache = new Map<NodeId, Mat4>();
  const targets = topMost(state, ids);
  const locals = new Map(targets.map((id) => [id, worldToLocalDelta(state, id, delta, cache)]));
  return patchNodes(state, targets, (n) => ({
    ...n,
    transform: { ...n.transform, position: add(n.transform.position, locals.get(n.id) ?? [0, 0, 0]) },
  }));
}

/** Filters selection ids that no longer exist (nodes, lights or cameras). */
export function cleanSelection(state: ProjectState): ProjectState {
  const sel = state.selection;
  const valid = (id: NodeId): boolean =>
    state.scene.nodes[id] !== undefined ||
    state.studio.lights.some((l) => l.id === id) ||
    state.camera.cameras[id] !== undefined;
  const ids = sel.ids.filter(valid);
  const facesOk = sel.faces === undefined || state.scene.nodes[sel.faces.part] !== undefined;
  if (ids.length === sel.ids.length && facesOk) return state;
  const next: Selection = { level: sel.level, ids };
  if (sel.faces && facesOk) next.faces = sel.faces;
  return { ...state, selection: next };
}

/** Rest on the floor: the lowest point of ALL the meshes of the targets goes to z = 0. */
export function restOnFloor(state: ProjectState, ids: readonly NodeId[]): ProjectState {
  const targets = ids.length > 0 ? topMost(state, ids) : state.scene.roots;
  const b = boundsOf(state, targets);
  if (isEmptyBox(b)) return state;
  return translateWorld(state, targets, [0, 0, -b.min[2]]);
}

/** Centre: the centre of the bounds in XY goes to (0, 0). */
export function centerXY(state: ProjectState, ids: readonly NodeId[]): ProjectState {
  const targets = ids.length > 0 ? topMost(state, ids) : state.scene.roots;
  const b = boundsOf(state, targets);
  if (isEmptyBox(b)) return state;
  const c = boxCenter(b);
  return translateWorld(state, targets, [-c[0], -c[1], 0]);
}

/** Adds a model, remapping its node and material ids to fresh ones. */
export function addModel(state: ProjectState, payload: ModelPayload, replace: boolean): ProjectState {
  let nodes: Record<NodeId, SceneNode> = replace ? {} : { ...state.scene.nodes };
  let roots: NodeId[] = replace ? [] : [...state.scene.roots];
  const materials: Record<MaterialId, MaterialInstance> = replace ? {} : { ...state.materials };

  const matMap = new Map<MaterialId, MaterialId>();
  for (const [oldId, mat] of Object.entries(payload.materials)) {
    const id = nextId('m', Object.keys(materials));
    matMap.set(oldId, id);
    materials[id] = { ...mat, id };
  }
  const nodeMap = new Map<NodeId, NodeId>();
  const taken = Object.keys(nodes);
  for (const oldId of Object.keys(payload.nodes)) {
    const id = nextId('n', taken);
    taken.push(id);
    nodeMap.set(oldId, id);
  }
  const remapMat = (m: MaterialId | null | undefined): MaterialId | null => (m ? (matMap.get(m) ?? null) : null);
  for (const [oldId, node] of Object.entries(payload.nodes)) {
    const id = nodeMap.get(oldId)!;
    const next: SceneNode = {
      ...node,
      id,
      parent: node.parent ? (nodeMap.get(node.parent) ?? null) : null,
      children: node.children.map((c) => nodeMap.get(c)!).filter(Boolean),
      // Reset transform returns here (the import sheet refreshes it once the model is placed).
      initial: { position: [...node.transform.position], rotation: [...node.transform.rotation], scale: [...node.transform.scale] },
    };
    if (node.kind === 'PART') {
      next.material = remapMat(node.material);
      if (node.faceMaterials) {
        next.faceMaterials = node.faceMaterials
          .map((f) => ({ ...f, material: matMap.get(f.material) ?? '' }))
          .filter((f) => f.material !== '');
      }
    }
    nodes = { ...nodes, [id]: next };
  }
  roots = [...roots, ...payload.roots.map((r) => nodeMap.get(r)!).filter(Boolean)];
  let next: ProjectState = {
    ...state,
    scene: { ...state.scene, nodes, roots },
    materials,
  };
  if (replace) next = { ...next, selection: { level: state.selection.level, ids: [] } };
  // The part size is detected on import when this is the first (or only) model: the first product, also when the
  // scene held only primitives (a base or a backdrop set up before the product came in).
  if (replace || !hasProduct(state)) {
    const size = measuredSizeMm(next);
    if (size > 0) next = { ...next, scene: { ...next.scene, partSizeMm: Math.round(size * 100) / 100 } };
  }
  return cleanSelection(next);
}

function deleteNodes(state: ProjectState, ids: readonly NodeId[]): ProjectState {
  const doomed = new Set<NodeId>();
  for (const id of ids) for (const n of subtree(state, id)) doomed.add(n);
  if (doomed.size === 0) return state;
  const nodes: Record<NodeId, SceneNode> = {};
  for (const [id, node] of Object.entries(state.scene.nodes)) {
    if (doomed.has(id)) continue;
    nodes[id] = node.children.some((c) => doomed.has(c))
      ? { ...node, children: node.children.filter((c) => !doomed.has(c)) }
      : node;
  }
  const roots = state.scene.roots.filter((r) => !doomed.has(r));
  return cleanSelection({ ...state, scene: { ...state.scene, nodes, roots } });
}

function isolate(state: ProjectState, ids: readonly NodeId[]): ProjectState {
  const keep = new Set<NodeId>();
  for (const id of ids) {
    for (const n of subtree(state, id)) keep.add(n);
    for (const a of ancestors(state, id)) keep.add(a);
  }
  if (keep.size === 0) return state;
  return patchNodes(state, Object.keys(state.scene.nodes), (n) => {
    const visible = keep.has(n.id);
    return n.visible === visible ? n : { ...n, visible };
  });
}

/** Rescales every model uniformly about the world origin so its size becomes `mm`. */
function setPartSize(state: ProjectState, mm: number): ProjectState {
  if (!(mm > 0)) return state;
  const measured = measuredSizeMm(state);
  if (measured <= 0) return { ...state, scene: { ...state.scene, partSizeMm: mm } };
  const k = mm / measured;
  let next = patchNodes(state, state.scene.roots, (n) => ({
    ...n,
    transform: {
      ...n.transform,
      position: [n.transform.position[0] * k, n.transform.position[1] * k, n.transform.position[2] * k],
      scale: [n.transform.scale[0] * k, n.transform.scale[1] * k, n.transform.scale[2] * k],
    },
  }));
  // Cameras keep the same view of the rescaled part.
  const cameras = { ...next.camera.cameras };
  for (const [id, c] of Object.entries(cameras)) {
    cameras[id] = {
      ...c,
      distance: c.distance * k,
      target: [c.target[0] * k, c.target[1] * k, c.target[2] * k],
      orthoWidth: c.orthoWidth * k,
      focusDistance: c.focusDistance * k,
    };
  }
  next = { ...next, camera: { ...next.camera, cameras }, scene: { ...next.scene, partSizeMm: mm } };
  return next;
}

function applySelect(state: ProjectState, ids: readonly NodeId[], mode: SelectMode, level?: SelectionLevel): ProjectState {
  const cur = state.selection;
  let nextIds: NodeId[];
  if (mode === 'set') nextIds = [...ids];
  else if (mode === 'add') nextIds = [...cur.ids, ...ids.filter((id) => !cur.ids.includes(id))];
  else {
    nextIds = [...cur.ids];
    for (const id of ids) {
      const i = nextIds.indexOf(id);
      if (i >= 0) nextIds.splice(i, 1);
      else nextIds.push(id);
    }
  }
  // Lights and cameras are selected alone: the inspector edits one of them.
  const special = nextIds.find((id) => state.scene.nodes[id] === undefined);
  if (special !== undefined && nextIds.length > 1) nextIds = ids.includes(special) ? [special] : nextIds.filter((id) => state.scene.nodes[id]);
  const sel: Selection = { level: level ?? cur.level, ids: nextIds };
  if (sel.level === 'FACES' && cur.faces && nextIds.includes(cur.faces.part)) sel.faces = cur.faces;
  return { ...state, selection: sel };
}

function applySelectFaces(state: ProjectState, part: NodeId, indices: readonly number[], mode: FaceSelectMode): ProjectState {
  const cur = state.selection.faces && state.selection.faces.part === part ? state.selection.faces.indices : [];
  let next: number[];
  if (mode === 'set') next = [...indices];
  else if (mode === 'add') next = [...new Set([...cur, ...indices])];
  else if (mode === 'remove') {
    const gone = new Set(indices);
    next = cur.filter((i) => !gone.has(i));
  } else {
    const s = new Set(cur);
    for (const i of indices) {
      if (s.has(i)) s.delete(i);
      else s.add(i);
    }
    next = [...s];
  }
  next.sort((a, b) => a - b);
  return { ...state, selection: { level: 'FACES', ids: [part], faces: { part, indices: next } } };
}

export function reduceScene(state: ProjectState, action: SceneAction): ProjectState {
  switch (action.type) {
    case 'scene/addModel':
      return addModel(state, action.payload, action.replace);
    case 'scene/select':
      return applySelect(state, action.ids, action.mode, action.level);
    case 'scene/setLevel': {
      if (state.selection.level === action.level) return state;
      const sel: Selection = { level: action.level, ids: state.selection.ids };
      if (action.level === 'FACES' && state.selection.faces) sel.faces = state.selection.faces;
      return { ...state, selection: sel };
    }
    case 'scene/selectFaces':
      return applySelectFaces(state, action.part, action.indices, action.mode);
    case 'scene/setVisible': {
      const ids = action.ids.length > 0 ? action.ids : [];
      return patchNodes(state, ids, (n) => (n.visible === action.visible ? n : { ...n, visible: action.visible }));
    }
    case 'scene/isolate':
      return isolate(state, action.ids);
    case 'scene/showAll':
      return patchNodes(state, Object.keys(state.scene.nodes), (n) => (n.visible ? n : { ...n, visible: true }));
    case 'scene/setLocked':
      return patchNodes(state, action.ids, (n) => (n.locked === action.locked ? n : { ...n, locked: action.locked }));
    case 'scene/rename': {
      const name = action.name.trim();
      if (!name) return state;
      return patchNodes(state, [action.id], (n) => (n.name === name ? n : { ...n, name }));
    }
    case 'scene/delete':
      return deleteNodes(state, action.ids);
    case 'scene/restOnFloor':
      return restOnFloor(state, action.ids);
    case 'scene/center':
      return centerXY(state, action.ids);
    case 'scene/setTransform':
      return patchNodes(state, [action.id], (n) => ({ ...n, transform: { ...n.transform, ...action.transform } }));
    case 'scene/setSmooth':
      return patchNodes(state, partsUnder(state, action.ids), (n) =>
        n.smooth === action.smooth ? n : { ...n, smooth: action.smooth },
      );
    case 'scene/setPartSize':
      return setPartSize(state, action.mm);
    case 'scene/clear':
      return {
        ...state,
        scene: { ...state.scene, nodes: {}, roots: [] },
        materials: {},
        selection: { level: state.selection.level, ids: [] },
      };
    default:
      return state;
  }
}
