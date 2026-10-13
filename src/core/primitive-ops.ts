// Primitives in the scene (phase U9): where a new one goes and how big it is, adding it (with the product lifted
// onto it when it is a base: one action, one undo step), editing its measures live (the mesh is regenerated and
// the part keeps its footing) and Convert to mesh. Pure functions over ProjectState; the geometry is
// core/primitives.ts. Every operation is an action of the store (prefix `scene/`), so it is undoable.
//
// Placement, with a studio eye (ROADMAP U9):
//   - With a product in the scene (any part that is not a primitive), the size of the scene is the product's
//     largest dimension. A Box or a Pedestal is born as a BASE: centred under the product, on the floor, its
//     footprint 1.4 times the product's (the box's sides, the pedestal's radius over the farthest point of the
//     product from its centre), and the product is lifted to sit on top. A Plane or a Disc lies FLOOR-flat under
//     the product; the infinity sweep (BACKDROP) goes under it with its wall behind (+Y, away from the camera).
//     Every other shape stands on the floor BESIDE what is there (to +X, a tenth of the product apart), at the
//     catalogue's proportions of the product.
//   - Without a product, the size of the scene is the declared part size (200 mm in a new project): the first
//     shape stands at the origin, the next ones beside it; a flat or a backdrop goes under what there is.
//   - The flat shapes and the sweep sit a hair (a thousandth of the scene) above the studio floor: their top is
//     where the floor is, and a surface on the shadow catcher would flicker between the two.
//   - The infinity sweep is fitted to the active camera (`fitSweep`): turned about Z to face it, its wall behind the
//     subject at 1.75 times the subject's depth and behind every light of the rig that stands behind the subject
//     (the lighting chosen keeps working), wide and tall enough that every ray through the output frame meets it
//     (with margin), its curve 0.3 of its height. Fit to camera (`scene/fitPrimitive`) does it again.

import { PRIMITIVE_MATERIAL, primitiveEntry, type PrimitiveKind, type PrimitiveRole } from '../data/primitives';
import type { ActionBase, ProjectState } from './store';
import { activeCamera, cameraBasis, cameraPosition, fieldOfView, frameActive, outputAspect, type CameraState } from './camera';
import { lightPosition } from './lighting';
import { nextId } from './ids';
import { instanceFromPreset, triangleMaterials, type MaterialId } from './materials';
import { add, boxCenter, boxMaxDim, boxSize, dot, emptyBox, isEmptyBox, round, scale, sub, transformDirection, unionBox, type Box, type Vec3 } from './math';
import { getMesh, type TriangleRange } from './meshes';
import { defaultParams, ensurePrimitiveMesh, ensurePrimitiveMeshAt, normalizeParams, primitiveExtent, primitiveOwner, sameParams, type PrimitiveParams, type PrimitiveSpec } from './primitives';
import {
  allParts,
  cleanSelection,
  effectiveVisible,
  hasProduct,
  localMatrix,
  measuredSizeMm,
  partWorldBounds,
  productBounds,
  productParts,
  translateWorld,
  worldMatrix,
  type FaceRange,
  type NodeId,
  type SceneNode,
} from './scene';
import { movableTargets, nextName } from './transform';

/** A base's footprint is this many times the product's (ROADMAP U9). */
export const BASE_FOOTPRINT = 1.4;
/** Height of a box base and of a pedestal, in sizes of the product. */
export const BASE_HEIGHT: Readonly<Record<'BOX' | 'PEDESTAL', number>> = { BOX: 0.15, PEDESTAL: 0.3 };
/** A base's bevel, as a fraction of its smallest measure. */
export const BASE_BEVEL = 0.03;
/** A plane under the product: this many times the longer side of the product's footprint. */
export const FLOOR_PLANE = 3;
/** Gap between a new shape and what stands beside it, in sizes of the scene. */
export const BESIDE_GAP = 0.1;
/** Height of a flat shape or a sweep over the studio floor, in sizes of the scene (at least 0.05 mm). */
export const FLOOR_LIFT = 1e-3;

export type PrimitiveAction =
  /** A new primitive part at the root; `lift` moves the product onto it (a base) in the same step. */
  | ({
      type: 'scene/addPrimitive';
      kind: PrimitiveKind;
      params: PrimitiveParams;
      /** World position of the centre of its bounds, mm. */
      position: Vec3;
      name: string;
      /** Rotation, degrees (the sweep turns to face the camera); default none. */
      rotation?: Vec3;
      /** Catalogue material (default: the neutral one of the catalogue). */
      material?: string;
      lift?: { ids: NodeId[]; delta: Vec3 };
    } & ActionBase)
  /**
   * Fit to camera: new measures and a new place for a primitive at once (the sweep fitted to the camera), one undo
   * step. Its linked copies take the measures; only this one moves (and loses any scale: the measures are the size).
   */
  | ({ type: 'scene/fitPrimitive'; id: NodeId; params: PrimitiveParams; position: Vec3; rotation: Vec3 } & ActionBase)
  /** New measures for a primitive (and its linked copies): the mesh is made again, the base of each stays put. */
  | ({ type: 'scene/setPrimitive'; id: NodeId; params: Partial<PrimitiveParams> } & ActionBase)
  /** Convert to mesh: the parts keep their geometry and stop being parametric. */
  | ({ type: 'scene/convertPrimitive'; ids: NodeId[] } & ActionBase);

/** Where and how big a new primitive is: the content of a `scene/addPrimitive` (without its name). */
export interface PrimitivePlacement {
  kind: PrimitiveKind;
  params: PrimitiveParams;
  position: Vec3;
  /** Rotation, degrees (the sweep faces the camera). */
  rotation?: Vec3;
  /** The role it took: BASE only when there was a product to put on it. */
  role: PrimitiveRole;
  lift?: { ids: NodeId[]; delta: Vec3 };
}

const roundMm = (v: number): number => Math.max(0.1, Math.round(v * 10) / 10);
const r6 = (v: number): number => round(v, 6);

/** The role of a primitive part (OBJECT for anything else). */
export function roleOf(node: SceneNode | undefined): PrimitiveRole {
  return (node?.primitive && primitiveEntry(node.primitive.kind)?.role) || 'OBJECT';
}

/** The farthest any vertex of the product is from a vertical axis through `c`, mm (its footprint as a circle). */
export function footprintRadius(state: ProjectState, parts: readonly NodeId[], c: readonly number[]): number {
  let best = 0;
  const cache = new Map<NodeId, number[]>();
  for (const id of parts) {
    const node = state.scene.nodes[id];
    const data = node?.mesh ? getMesh(node.mesh.id) : undefined;
    const m = worldMatrix(state, id, cache);
    if (!data) {
      const b = partWorldBounds(state, id);
      if (isEmptyBox(b)) continue;
      for (const x of [b.min[0], b.max[0]]) for (const y of [b.min[1], b.max[1]]) best = Math.max(best, Math.hypot(x - c[0], y - c[1]));
      continue;
    }
    const p = data.positions;
    for (let i = 0; i + 2 < p.length; i += 3) {
      const x = m[0] * p[i] + m[4] * p[i + 1] + m[8] * p[i + 2] + m[12];
      const y = m[1] * p[i] + m[5] * p[i + 1] + m[9] * p[i + 2] + m[13];
      const d = Math.hypot(x - c[0], y - c[1]);
      if (d > best) best = d;
    }
  }
  return best;
}

/** World bounds of what stands in the scene: the visible parts but the flats and the backdrops. */
function occupiedBounds(state: ProjectState): Box {
  let b = emptyBox();
  for (const p of allParts(state)) {
    if (!effectiveVisible(state, p)) continue;
    const role = roleOf(state.scene.nodes[p]);
    if (role === 'FLOOR' || role === 'BACKDROP') continue;
    b = unionBox(b, partWorldBounds(state, p));
  }
  return b;
}

/** The roots that hold the product (not primitives), that can move: what a new base lifts. */
function productRoots(state: ProjectState): NodeId[] {
  const product = new Set(productParts(state).filter((p) => !state.scene.nodes[p].primitive));
  const roots = state.scene.roots.filter((r) => {
    const stack = [r];
    while (stack.length) {
      const id = stack.pop()!;
      if (product.has(id)) return true;
      stack.push(...(state.scene.nodes[id]?.children ?? []));
    }
    return false;
  });
  return movableTargets(state, roots);
}

/**
 * Where a new primitive of `kind` goes in this scene and how big it is (see the header). Pure: the same scene gives
 * the same placement.
 */
export function placePrimitive(state: ProjectState, kind: PrimitiveKind): PrimitivePlacement {
  const catalogueRole = primitiveEntry(kind)?.role ?? 'OBJECT';
  const product = hasProduct(state, true);
  const pb = product ? productBounds(state, true) : emptyBox();
  const S = product && !isEmptyBox(pb) ? boxMaxDim(pb) : state.scene.partSizeMm > 0 ? state.scene.partSizeMm : 200;
  const lift = Math.max(0.05, FLOOR_LIFT * S);
  const occupied = occupiedBounds(state);
  const centre: Vec3 = product ? boxCenter(pb) : isEmptyBox(occupied) ? [0, 0, 0] : boxCenter(occupied);

  if (product && (kind === 'BOX' || kind === 'PEDESTAL')) {
    const size = boxSize(pb);
    const H = roundMm(BASE_HEIGHT[kind] * S);
    let params: PrimitiveParams;
    if (kind === 'BOX') {
      const w = roundMm(BASE_FOOTPRINT * size[0]);
      const d = roundMm(BASE_FOOTPRINT * size[1]);
      params = normalizeParams('BOX', { ...defaultParams('BOX', S), width: w, depth: d, height: H, bevel: roundMm(BASE_BEVEL * Math.min(w, d, H)) });
    } else {
      const R = roundMm(BASE_FOOTPRINT * footprintRadius(state, productParts(state, true), centre));
      params = normalizeParams('PEDESTAL', { ...defaultParams('PEDESTAL', S), radius: R, height: H, bevel: roundMm(BASE_BEVEL * Math.min(R, H)) });
    }
    const top = primitiveExtent({ kind, params })[2];
    const ids = productRoots(state);
    return {
      kind,
      params,
      position: [r6(centre[0]), r6(centre[1]), r6(top / 2)],
      role: 'BASE',
      ...(ids.length > 0 ? { lift: { ids, delta: [0, 0, r6(top - pb.min[2])] as Vec3 } } : {}),
    };
  }

  let params = defaultParams(kind, S);
  if (product && kind === 'PLANE') {
    const side = roundMm(FLOOR_PLANE * Math.max(boxSize(pb)[0], boxSize(pb)[1]));
    params = normalizeParams('PLANE', { width: side, depth: side });
  } else if (product && kind === 'DISC') {
    params = normalizeParams('DISC', { ...params, radius: roundMm(BASE_FOOTPRINT * footprintRadius(state, productParts(state, true), centre)) });
  }
  if (kind === 'SWEEP') {
    const fit = fitSweep(state);
    return { kind, params: fit.params, position: fit.position, rotation: fit.rotation, role: 'BACKDROP' };
  }
  const ext = primitiveExtent({ kind, params });
  const role: PrimitiveRole = catalogueRole === 'BASE' ? 'OBJECT' : catalogueRole;
  if (role === 'FLOOR' || role === 'BACKDROP') {
    return { kind, params, position: [r6(centre[0]), r6(centre[1]), r6(ext[2] / 2 + lift)], role };
  }
  if (isEmptyBox(occupied)) return { kind, params, position: [0, 0, r6(ext[2] / 2)], role };
  const x = occupied.max[0] + BESIDE_GAP * S + ext[0] / 2;
  return { kind, params, position: [r6(x), r6(centre[1]), r6(ext[2] / 2)], role };
}

// ---------------------------------------------------------------------------
// The infinity sweep, fitted to the camera
// ---------------------------------------------------------------------------

/** How the sweep is fitted (lead's decision for U9): distances and margins. */
export const SWEEP_FIT = {
  /** The wall stands this many subject depths behind the subject's centre. */
  wall: 1.75,
  /** Its width is at least this many times what the frame spans where it meets the sweep. */
  width: 1.3,
  /** Its top is this much above the highest point where the frame meets the wall. */
  height: 1.15,
  /** Curve radius, as a fraction of the height. */
  radius: 0.3,
  /** The floor reaches this fraction of its depth in front of where the frame meets it. */
  front: 0.15,
  /** A light behind the subject stays in front of the wall: the wall goes this many times its distance back (plus half its panel). */
  lights: 1.25,
} as const;

/**
 * How far behind the subject's centre (along `ey`, away from the camera) the wall has to stand so that every enabled
 * light of the rig that is behind the subject stays in front of it (lead's decision, U9: a photographer sets the paper
 * far enough back that the back and rim lights fit between the subject and the sweep). A sun is far away by nature:
 * it does not count. Zero when no light is behind.
 */
export function wallBehindLights(state: ProjectState, centre: Vec3, ey: Vec3): number {
  let need = 0;
  for (const l of state.studio.lights) {
    if (!l.enabled || l.type === 'SUN') continue;
    const behind = dot(sub(lightPosition(state, l), centre), ey);
    if (!(behind > 0)) continue;
    const square = l.shape === 'SQUARE' || l.shape === 'DISK';
    const half = (Math.max(l.size, square ? l.size : l.sizeY) * state.scene.partSizeMm) / 2;
    need = Math.max(need, SWEEP_FIT.lights * behind + half);
  }
  return need;
}

/** A ray: origin and direction (not unit), world mm. */
export interface FrameRay {
  origin: Vec3;
  dir: Vec3;
}

/**
 * Rays through the output frame of a camera: `n` along each edge, corners included, and the centre. Perspective
 * rays leave the camera through the frame (the field of view of `fieldOfView` for the aspect); orthographic ones
 * leave the frame itself along the view.
 */
export function frameRays(cam: CameraState, aspect: number, n = 9): FrameRay[] {
  const pos = cameraPosition(cam);
  const { forward, right, up } = cameraBasis(cam.azimuth, cam.elevation);
  const fov = fieldOfView(cam.focalMm, aspect);
  const tx = Math.tan(fov.h / 2);
  const ty = Math.tan(fov.v / 2);
  const pts: [number, number][] = [[0, 0]];
  for (let i = 0; i < n; i++) {
    const f = -1 + (2 * i) / (n - 1);
    pts.push([f, -1], [f, 1], [-1, f], [1, f]);
  }
  return pts.map(([sx, sy]) => {
    if (cam.projection === 'ORTHOGRAPHIC') {
      const w = cam.orthoWidth / 2;
      return { origin: add(add(pos, scale(right, sx * w)), scale(up, (sy * w) / aspect)), dir: forward };
    }
    return { origin: pos, dir: add(forward, add(scale(right, sx * tx), scale(up, sy * ty))) };
  });
}

export interface SweepFit {
  params: PrimitiveParams;
  position: Vec3;
  rotation: Vec3;
}

/**
 * The infinity sweep for a camera (the active one by default) and the output aspect: turned about Z to the camera's
 * azimuth so its wall faces it, centred across on the subject (the visible product, else what the camera looks at),
 * its wall SWEEP_FIT.wall subject depths behind the subject's centre, or behind the rig's lights that are behind the
 * subject (`wallBehindLights`), or further when its curve would reach under the subject, as wide as SWEEP_FIT.width times what the frame spans where it meets the sweep, its top SWEEP_FIT.height
 * above the highest point the frame reaches on the wall, its floor reaching in front of the lowest point the frame
 * meets, and a curve of SWEEP_FIT.radius of its height. Every ray of `frameRays` then meets it.
 */
export function fitSweep(state: ProjectState, cam: CameraState = activeCamera(state)): SweepFit {
  const aspect = outputAspect(state);
  const product = hasProduct(state, true);
  const pb = product ? productBounds(state, true) : emptyBox();
  const S = product && !isEmptyBox(pb) ? boxMaxDim(pb) : state.scene.partSizeMm > 0 ? state.scene.partSizeMm : 200;
  const lift = Math.max(0.05, FLOOR_LIFT * S);
  const theta = cam.azimuth;
  const a = (theta * Math.PI) / 180;
  const ex: Vec3 = [Math.cos(a), Math.sin(a), 0];
  const ey: Vec3 = [-Math.sin(a), Math.cos(a), 0];
  const centre: Vec3 = product && !isEmptyBox(pb) ? boxCenter(pb) : [cam.target[0], cam.target[1], 0];
  // The subject in the sweep's axes: its depth (along the view, across the floor) and its half width.
  let depth = 0.5 * S;
  let half = 0.25 * S;
  let top = S;
  if (product && !isEmptyBox(pb)) {
    let lo = Infinity;
    let hi = -Infinity;
    half = 0;
    for (let i = 0; i < 8; i++) {
      const c: Vec3 = [i & 1 ? pb.max[0] : pb.min[0], i & 2 ? pb.max[1] : pb.min[1], i & 4 ? pb.max[2] : pb.min[2]];
      const d = sub(c, centre);
      lo = Math.min(lo, dot(d, ey));
      hi = Math.max(hi, dot(d, ey));
      half = Math.max(half, Math.abs(dot(d, ex)));
    }
    depth = Math.max(hi - lo, 1e-3);
    top = pb.max[2];
  }
  const rays = frameRays(cam, aspect).map((r) => {
    const o = sub(r.origin, centre);
    return { o: [dot(o, ex), dot(o, ey), r.origin[2] - lift] as Vec3, d: [dot(r.dir, ex), dot(r.dir, ey), r.dir[2]] as Vec3 };
  });
  // Behind the subject at 1.75 depths, and behind the lights of the rig that stand behind it.
  let wall = Math.max(SWEEP_FIT.wall * depth, wallBehindLights(state, centre, ey));
  let H = 0;
  let R = 0;
  let maxX = half;
  let minY = -depth / 2;
  for (let iter = 0; iter < 6; iter++) {
    maxX = half;
    minY = -depth / 2;
    let maxZ = 0;
    for (const { o, d } of rays) {
      const tFloor = d[2] < 0 ? -o[2] / d[2] : Infinity;
      const tWall = d[1] > 0 ? (wall - o[1]) / d[1] : Infinity;
      if (tFloor < tWall && tFloor > 0) {
        maxX = Math.max(maxX, Math.abs(o[0] + d[0] * tFloor));
        minY = Math.min(minY, o[1] + d[1] * tFloor);
      } else if (Number.isFinite(tWall) && tWall > 0) {
        maxX = Math.max(maxX, Math.abs(o[0] + d[0] * tWall));
        maxZ = Math.max(maxZ, o[2] + d[2] * tWall);
      }
    }
    H = Math.max(SWEEP_FIT.height * maxZ, 1.25 * top, 0.5 * S);
    R = SWEEP_FIT.radius * H;
    // The curve must not reach under the subject: the wall goes back until it does not.
    const room = wall - depth / 2;
    if (R <= room * 0.95) break;
    wall = depth / 2 + R / 0.9;
  }
  const front = minY - SWEEP_FIT.front * (wall - minY);
  const params = normalizeParams('SWEEP', {
    width: Math.ceil(2 * SWEEP_FIT.width * maxX),
    depth: Math.ceil(wall - front),
    height: Math.ceil(H),
    radius: Math.round(R),
    segments: defaultParams('SWEEP').segments,
  });
  // The bounds' centre in the sweep's axes: across on the subject, along between the front and the wall.
  const along = wall - params.depth / 2;
  const at = add(centre, scale(ey, along));
  return { params, position: [r6(at[0]), r6(at[1]), r6(params.height / 2 + lift)], rotation: [0, 0, r6(theta)] };
}

// ---------------------------------------------------------------------------
// Reducers
// ---------------------------------------------------------------------------

/** The scene's unedited instance of a catalogue material, or a new one. */
function catalogueMaterial(state: ProjectState, preset: string): { state: ProjectState; id: MaterialId | null } {
  const existing = Object.values(state.materials).find((m) => m.preset === preset && !m.edited && m.role !== 'DEFAULT' && !m.library);
  if (existing) return { state, id: existing.id };
  const id = nextId('m', Object.keys(state.materials));
  const inst = instanceFromPreset(id, preset, state.scene.partSizeMm);
  if (!inst) return { state, id: null };
  return { state: { ...state, materials: { ...state.materials, [id]: inst } }, id };
}

function addPrimitive(state: ProjectState, action: Extract<PrimitiveAction, { type: 'scene/addPrimitive' }>): ProjectState {
  const entry = primitiveEntry(action.kind);
  if (!entry) return state;
  const wasEmpty = allParts(state).length === 0;
  const id = nextId('n', Object.keys(state.scene.nodes));
  const spec: PrimitiveSpec = { kind: action.kind, params: normalizeParams(action.kind, action.params) };
  const made = ensurePrimitiveMesh(id, spec);
  const mat = catalogueMaterial(state, action.material ?? PRIMITIVE_MATERIAL);
  let next = mat.state;
  const names = Object.values(next.scene.nodes).map((n) => n.name);
  const name = names.includes(action.name) ? nextName(action.name, names) : action.name;
  const rotation = (action.rotation ?? [0, 0, 0]).map(r6) as Vec3;
  const transform = { position: action.position.map(r6) as Vec3, rotation, scale: [1, 1, 1] as Vec3 };
  const node: SceneNode = {
    id,
    name,
    kind: 'PART',
    parent: null,
    children: [],
    transform,
    initial: { position: [...transform.position], rotation: [...rotation], scale: [1, 1, 1] },
    visible: true,
    locked: false,
    mesh: made.ref,
    material: mat.id,
    faceRanges: made.faceRanges,
    smooth: true,
    primitive: spec,
  };
  next = { ...next, scene: { ...next.scene, nodes: { ...next.scene.nodes, [id]: node }, roots: [...next.scene.roots, id] } };
  if (action.lift && action.lift.ids.length > 0) next = translateWorld(next, action.lift.ids, action.lift.delta);
  const level = next.selection.level === 'FACES' ? 'PART' : next.selection.level;
  next = { ...next, selection: { level, ids: [id] } };
  // The first thing in an empty scene is the product: its size is the part size, and the camera frames it.
  if (wasEmpty) {
    const size = measuredSizeMm(next);
    if (size > 0) next = { ...next, scene: { ...next.scene, partSizeMm: Math.round(size * 100) / 100 } };
    next = frameActive(next);
  }
  return cleanSelection(next);
}

/** The anchor that stays put when a primitive changes measures: the centre of the bottom of its bounds (local). */
function anchorOf(b: Box): Vec3 {
  return [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, b.min[2]];
}

/** The material that covers most of a run of triangles (null when most have none of their own). */
function majority(per: readonly (MaterialId | null)[], r: TriangleRange): MaterialId | null {
  const count = new Map<MaterialId | null, number>();
  for (let t = r.start; t < r.start + r.count && t < per.length; t++) count.set(per[t], (count.get(per[t]) ?? 0) + 1);
  let best: MaterialId | null = null;
  let n = -1;
  for (const [m, c] of count) if (c > n) [best, n] = [m, c];
  return best;
}

/** Face materials that follow the logical faces, by name, from one mesh of a primitive to the next. */
function remapFaceMaterials(node: SceneNode, from: { ranges: TriangleRange[]; names: string[] }, to: { ranges: TriangleRange[]; names: string[] }): FaceRange[] {
  const per = triangleMaterials({ ...node, material: null });
  const byName = new Map<string, MaterialId>();
  from.ranges.forEach((r, i) => {
    const m = majority(per, r);
    if (m) byName.set(from.names[i], m);
  });
  const out: FaceRange[] = [];
  to.ranges.forEach((r, i) => {
    const m = byName.get(to.names[i]);
    if (!m) return;
    const last = out[out.length - 1];
    if (last && last.material === m && last.start + last.count === r.start) last.count += r.count;
    else out.push({ start: r.start, count: r.count, material: m });
  });
  return out;
}

function setPrimitive(state: ProjectState, id: NodeId, patch: Partial<PrimitiveParams>): ProjectState {
  const node = state.scene.nodes[id];
  if (!node?.primitive || !node.mesh) return state;
  const kind = node.primitive.kind;
  const clean: Record<string, number> = {};
  for (const [k, v] of Object.entries(patch)) if (typeof v === 'number') clean[k] = v;
  const params = normalizeParams(kind, { ...node.primitive.params, ...clean });
  if (sameParams(params, node.primitive.params)) return state;
  const oldId = node.mesh.id;
  const spec: PrimitiveSpec = { kind, params };
  const before = ensurePrimitiveMeshAt(oldId, node.primitive);
  const made = ensurePrimitiveMesh(primitiveOwner(oldId) ?? id, spec);
  const from = { ranges: before.faceRanges, names: before.faceNames };
  const to = { ranges: made.faceRanges, names: made.faceNames };
  const shift = (() => {
    const a = anchorOf(node.mesh.bounds);
    const b = anchorOf(made.ref.bounds);
    return [a[0] - b[0], a[1] - b[1], a[2] - b[2]] as Vec3;
  })();
  const nodes = { ...state.scene.nodes };
  const changed: NodeId[] = [];
  for (const n of Object.values(state.scene.nodes)) {
    // Linked copies (they share the mesh) change together.
    if (n.kind !== 'PART' || n.mesh?.id !== oldId || !n.primitive) continue;
    const move = transformDirection(localMatrix(n), shift);
    const next: SceneNode = {
      ...n,
      mesh: made.ref,
      faceRanges: made.faceRanges.map((r) => ({ ...r })),
      primitive: { kind, params: { ...params } },
      transform: { ...n.transform, position: [r6(n.transform.position[0] + move[0]), r6(n.transform.position[1] + move[1]), r6(n.transform.position[2] + move[2])] },
    };
    if (n.faceMaterials?.length) {
      const faces = remapFaceMaterials(n, from, to);
      if (faces.length > 0) next.faceMaterials = faces;
      else delete next.faceMaterials;
    }
    nodes[n.id] = next;
    changed.push(n.id);
  }
  let out: ProjectState = { ...state, scene: { ...state.scene, nodes } };
  // Selected faces of a part that changed follow its logical faces too.
  const sel = state.selection.faces;
  if (sel && changed.includes(sel.part)) {
    const picked = new Set<string>();
    from.ranges.forEach((r, i) => {
      if (sel.indices.some((t) => t >= r.start && t < r.start + r.count)) picked.add(from.names[i]);
    });
    const indices: number[] = [];
    to.ranges.forEach((r, i) => {
      if (picked.has(to.names[i])) for (let t = r.start; t < r.start + r.count; t++) indices.push(t);
    });
    out = { ...out, selection: { ...state.selection, faces: { part: sel.part, indices } } };
  }
  return out;
}

function fitPrimitive(state: ProjectState, action: Extract<PrimitiveAction, { type: 'scene/fitPrimitive' }>): ProjectState {
  const node = state.scene.nodes[action.id];
  if (!node?.primitive) return state;
  const measured = setPrimitive(state, action.id, action.params);
  const n = measured.scene.nodes[action.id];
  const transform = { position: action.position.map(r6) as Vec3, rotation: action.rotation.map(r6) as Vec3, scale: [1, 1, 1] as Vec3 };
  const same = (['position', 'rotation', 'scale'] as const).every((k) => n.transform[k].every((v, i) => v === transform[k][i]));
  if (same) return measured;
  return { ...measured, scene: { ...measured.scene, nodes: { ...measured.scene.nodes, [action.id]: { ...n, transform } } } };
}

function convertPrimitive(state: ProjectState, ids: readonly NodeId[]): ProjectState {
  const meshes = new Set<string>();
  for (const id of ids) {
    const n = state.scene.nodes[id];
    if (!n) continue;
    const stack = [id];
    while (stack.length) {
      const cur = state.scene.nodes[stack.pop()!];
      if (!cur) continue;
      if (cur.primitive && cur.mesh) meshes.add(cur.mesh.id);
      stack.push(...cur.children);
    }
  }
  if (meshes.size === 0) return state;
  const nodes = { ...state.scene.nodes };
  for (const n of Object.values(state.scene.nodes)) {
    if (!n.primitive || !n.mesh || !meshes.has(n.mesh.id)) continue;
    const next = { ...n };
    delete next.primitive;
    nodes[n.id] = next;
  }
  return { ...state, scene: { ...state.scene, nodes } };
}

/** Reducer of the primitive actions; other actions return the state unchanged. */
export function reducePrimitive(state: ProjectState, action: PrimitiveAction): ProjectState {
  switch (action.type) {
    case 'scene/addPrimitive':
      return addPrimitive(state, action);
    case 'scene/setPrimitive':
      return setPrimitive(state, action.id, action.params);
    case 'scene/convertPrimitive':
      return convertPrimitive(state, action.ids);
    case 'scene/fitPrimitive':
      return fitPrimitive(state, action);
    default:
      return state;
  }
}

/** The primitive parts under some nodes (what the inspector's Primitive section and Convert to mesh act on). */
export function primitivesUnder(state: ProjectState, ids: readonly NodeId[]): NodeId[] {
  const out: NodeId[] = [];
  const seen = new Set<NodeId>();
  for (const id of ids) {
    const stack = [id];
    while (stack.length) {
      const cur = state.scene.nodes[stack.pop()!];
      if (!cur || seen.has(cur.id)) continue;
      seen.add(cur.id);
      if (cur.primitive) out.push(cur.id);
      stack.push(...cur.children);
    }
  }
  return out;
}
