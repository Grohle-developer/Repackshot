// Cloth (phase S9, SPEC §3.1 "Physics", ROADMAP S9): what becomes cloth, what the simulator is given for it (a CLT1 spec,
// engine/crates/rt-phys `cloth`), and the recorded shape of each cloth part per frame (the cache, a PHYSICS clip of the
// part). Pure functions over ProjectState; the store's actions are core/physics.ts's.
//
// **What is cloth.** A node whose Physics role is CLOTH: a part, or a group or model (each of its parts is a cloth of its
// own). The cloth is the part's mesh, or the face picked at the Faces level (`ClothProps.triangles`, the triangles of the
// part's mesh): then the rest of the part stays where it is, and the vertices the face shares with it hold the cloth. A
// closed shell (a solid: every edge between two triangles) can keep its volume (Pressure: a cushion, a soft container).
//
// **The simulated sheet.** A cloth needs vertices to fold at; a face or a plane has few. Its triangles are split in four,
// each edge at its midpoint, `levels` times: as many as bring its longest edge under the resolution (automatic: the
// cloth's longest side over AUTO_DIVISIONS), and no more than keep it within MAX_CLOTH_TRIANGLES. The split keeps the
// winding, puts each triangle's children together where the triangle was (so the part's face materials still apply) and
// the texture coordinates halfway, so a cloth renders like its part. `clothMesh` makes it, the same for a mesh, a face
// and a number of levels every time (the recording names those three).
//
// **The fabric** (data/fabrics.ts): a preset by fabric type and weight; Weight (g/m²) and Stiffness (a factor on its
// stretch and bending) on top, Thickness (the distance at which it collides). Anchors hold vertices where they are: along
// the top edge (the open edge's vertices within a hair of its highest point) or inside a box (a share of the cloth's
// bounds on each axis).
//
// **What it meets.** Itself, the floor, every other visible part that does not move (as triangles), and the dynamic
// bodies of the same run (S2's world, stepped with it in the engine: they push the cloth, it does not push them). The
// wind is the ambient effects' (S4a): their wind summed, with gusts from the turbulence of the windiest.
//
// **The recording** (the cache): each cloth part's PHYSICS clip holds its vertices per frame, in the part's own space
// (the node does not move: the cloth moves inside it), little-endian f32 in base64, so the state stays plain JSON; the
// Fast viewer and the engine's scene (io/rsb.ts) draw the part with the frame the playhead shows (`posedCloth`).

import { AUTO_DIVISIONS, CLOTH_DEFAULTS, CLOTH_LIMITS, DRAPE_MATERIAL, DRAPE_SHEET, fabricPreset, GUST_PER_CHAOS, MAX_CLOTH_TRIANGLES, type ClothAnchor, type FabricKey } from '../data/fabrics';
import { FLOOR_SURFACE } from '../data/physics';
import type { Pose } from './animation';
import { boxMaxDim, clamp, isEmptyBox, mat4Invert, transformPoint, type Mat4, type Vec3 } from './math';
import { getMesh, hashIndices, type MeshData, type MeshId } from './meshes';
import { boundsOf, effectiveVisible, partsUnder, topMost, treeOrder, worldMatrix, type FaceRange, type NodeId, type SceneNode } from './scene';
import type { ProjectState } from './store';
import { isLocked } from './transform';

/** The cloth part of a node's Physics section (all optional: absent is the default). */
export interface ClothProps {
  /** data/fabrics.ts key; absent: DEFAULT_FABRIC. */
  fabric?: FabricKey;
  /** g/m²; absent: the preset's. */
  weightGsm?: number;
  /** A factor on the preset's stretch and bending stiffness; absent: 1. */
  stiffness?: number;
  /** The distance at which it collides, mm; absent: the preset's. */
  thicknessMm?: number;
  /** How it is held; absent: NONE. */
  anchor?: ClothAnchor;
  /** BOX: the box, as shares (0..1) of the cloth's bounds on each axis; absent: CLOTH_DEFAULTS.box. */
  box?: { min: Vec3; max: Vec3 };
  /** A closed shell holds this times its rest volume (0: none); absent: CLOTH_DEFAULTS.pressure. */
  pressure?: number;
  /** It collides with itself; absent: true. */
  selfCollision?: boolean;
  /** Its triangles keep their area; absent: false. */
  keepArea?: boolean;
  /** Target edge of the simulated sheet, mm (absent or 0: automatic). */
  resolutionMm?: number;
  /** The face that is cloth: triangles of the part's mesh, ascending (absent: the whole part). */
  triangles?: number[];
}

/** What the simulator is given for one cloth part (the engine's units: kg/m², N/m, N·m, 1/s, mm). */
export interface ClothParamsResolved {
  massPerArea: number;
  stretch: number;
  bend: number;
  damping: number;
  thickness: number;
  friction: number;
  area: number;
  pressure: number;
  selfCollision: boolean;
}

/** `rt_phys::cloth::FLAG_SELF_COLLISION`. */
export const FLAG_SELF_COLLISION = 1;
/** CLT1 version (rt_phys::cloth::VERSION). */
export const CLT1_VERSION = 1;

// ---------------------------------------------------------------------------
// Which parts are cloth, with what
// ---------------------------------------------------------------------------

function isClothRole(node: SceneNode | undefined): boolean {
  return node?.physics?.role === 'CLOTH';
}

/** The cloth props a part takes: its own, or those of the nearest CLOTH node above it. */
export function clothPropsOf(state: ProjectState, part: NodeId): ClothProps {
  for (let cur: NodeId | null = part; cur; cur = state.scene.nodes[cur]?.parent ?? null) {
    const node = state.scene.nodes[cur];
    if (isClothRole(node)) return node!.physics!.cloth ?? {};
  }
  return {};
}

/** The parts that are cloth: under a node whose role is CLOTH, visible, with a mesh, not locked; in tree order. */
export function clothParts(state: ProjectState): NodeId[] {
  const roots = topMost(
    state,
    treeOrder(state).filter((id) => isClothRole(state.scene.nodes[id])),
  );
  return partsUnder(state, roots).filter((p) => effectiveVisible(state, p) && !!state.scene.nodes[p]?.mesh && !isLocked(state, p));
}

/** The fabric of some props, with Weight, Stiffness and Thickness on top. */
export function clothParams(props: ClothProps): ClothParamsResolved {
  const f = fabricPreset(props.fabric);
  const finite = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  const weight = clamp(finite(props.weightGsm, f.weightGsm), CLOTH_LIMITS.weight.min, CLOTH_LIMITS.weight.max);
  const k = clamp(finite(props.stiffness, CLOTH_DEFAULTS.stiffness), CLOTH_LIMITS.stiffness.min, CLOTH_LIMITS.stiffness.max);
  return {
    massPerArea: weight / 1000,
    stretch: f.stretch * k,
    bend: f.bend * k,
    damping: f.damping,
    thickness: clamp(finite(props.thicknessMm, f.thicknessMm), CLOTH_LIMITS.thickness.min, CLOTH_LIMITS.thickness.max),
    friction: f.friction,
    area: props.keepArea === true ? f.stretch * k : 0,
    pressure: clamp(finite(props.pressure, CLOTH_DEFAULTS.pressure), CLOTH_LIMITS.pressure.min, CLOTH_LIMITS.pressure.max),
    selfCollision: props.selfCollision !== false,
  };
}

// ---------------------------------------------------------------------------
// The simulated sheet
// ---------------------------------------------------------------------------

/** The sheet a cloth is simulated as: its mesh's (or face's) triangles split `levels` times. */
export interface ClothMesh {
  /** Vertices (the part's own space), x y z each. */
  positions: Float32Array;
  /** Texture coordinates, when the mesh has them. */
  uvs?: Float32Array;
  /** Its triangles, each source triangle's children together, in the order of the source triangles. */
  indices: Uint32Array;
  /** The source triangles (ascending) and how many triangles each became (4^levels). */
  source: Uint32Array;
  levels: number;
  /** Vertices the cloth shares with the rest of its part (a face's rim): they hold it. */
  held: Uint8Array;
  /** For each vertex, the first vertex at exactly its position (the simulator welds them: they move as one). */
  weld: Uint32Array;
  /** Every edge has two triangles: a closed shell (Pressure applies). */
  closed: boolean;
}

const clothMeshes = new WeakMap<MeshData, Map<string, ClothMesh>>();

function posKey(p: ArrayLike<number>, i: number): string {
  return `${p[3 * i] + 0},${p[3 * i + 1] + 0},${p[3 * i + 2] + 0}`;
}

/** The source triangles of a cloth: its face's (in range, ascending, without repeats), or all of the mesh's. */
export function clothSource(data: MeshData, triangles: readonly number[] | undefined): number[] {
  const n = data.indices.length / 3;
  if (!triangles || triangles.length === 0) return Array.from({ length: n }, (_, i) => i);
  return [...new Set(triangles.filter((t) => Number.isInteger(t) && t >= 0 && t < n))].sort((a, b) => a - b);
}

/** The simulated sheet of a mesh's triangles (all of them, or a face's), split `levels` times; cached per mesh. */
export function clothMesh(data: MeshData, triangles: readonly number[] | undefined, levels: number): ClothMesh {
  const source = clothSource(data, triangles);
  const key = `${levels}|${triangles && triangles.length > 0 ? hashIndices(source) : 'all'}`;
  let cache = clothMeshes.get(data);
  if (!cache) {
    cache = new Map();
    clothMeshes.set(data, cache);
  }
  const hit = cache.get(key);
  if (hit) return hit;
  const made = buildClothMesh(data, source, Math.max(0, Math.floor(levels)));
  cache.set(key, made);
  return made;
}

function buildClothMesh(data: MeshData, source: number[], levels: number): ClothMesh {
  const P = data.positions;
  const UV = data.uvs;
  const isSource = new Uint8Array(data.indices.length / 3);
  for (const t of source) isSource[t] = 1;
  // The rim the cloth shares with the rest of the part, by position: its vertices and edges.
  const restVerts = new Set<string>();
  const restEdges = new Set<string>();
  for (let t = 0; t < isSource.length; t++) {
    if (isSource[t]) continue;
    const k = [0, 1, 2].map((c) => posKey(P, data.indices[3 * t + c]));
    for (const v of k) restVerts.add(v);
    for (let c = 0; c < 3; c++) restEdges.add(edgeKey(k[c], k[(c + 1) % 3]));
  }
  // The vertices the cloth uses, in ascending order of the mesh's.
  const used = new Map<number, number>();
  const usedList: number[] = [];
  for (const t of source) for (let c = 0; c < 3; c++) used.set(data.indices[3 * t + c], 0);
  for (const v of [...used.keys()].sort((a, b) => a - b)) {
    used.set(v, usedList.length);
    usedList.push(v);
  }
  const pos: number[] = [];
  const uv: number[] = [];
  const held: number[] = [];
  const keys: string[] = [];
  for (const v of usedList) {
    pos.push(P[3 * v], P[3 * v + 1], P[3 * v + 2]);
    if (UV) uv.push(UV[2 * v], UV[2 * v + 1]);
    const k = posKey(P, v);
    keys.push(k);
    held.push(restVerts.has(k) ? 1 : 0);
  }
  let tris: number[] = [];
  for (const t of source) for (let c = 0; c < 3; c++) tris.push(used.get(data.indices[3 * t + c])!);
  // Edges of the rim (both ends on it and the edge itself on it), by vertex index pair.
  const rim = new Set<string>();
  for (let i = 0; i < tris.length; i += 3) {
    for (let c = 0; c < 3; c++) {
      const a = tris[i + c];
      const b = tris[i + ((c + 1) % 3)];
      if (restEdges.has(edgeKey(keys[a], keys[b]))) rim.add(pairKey(a, b));
    }
  }
  const f32 = (v: number) => Math.fround(v);
  for (let level = 0; level < levels; level++) {
    const mid = new Map<string, number>();
    const midpoint = (a: number, b: number): number => {
      const k = pairKey(a, b);
      const hit = mid.get(k);
      if (hit !== undefined) return hit;
      const m = pos.length / 3;
      for (let c = 0; c < 3; c++) pos.push(f32((f32(pos[3 * a + c]) + f32(pos[3 * b + c])) * 0.5));
      if (UV) for (let c = 0; c < 2; c++) uv.push((uv[2 * a + c] + uv[2 * b + c]) * 0.5);
      const onRim = rim.has(k);
      held.push(onRim ? 1 : 0);
      if (onRim) {
        rim.add(pairKey(a, m));
        rim.add(pairKey(m, b));
      }
      mid.set(k, m);
      return m;
    };
    const next: number[] = [];
    for (let i = 0; i < tris.length; i += 3) {
      const [a, b, c] = [tris[i], tris[i + 1], tris[i + 2]];
      const ab = midpoint(a, b);
      const bc = midpoint(b, c);
      const ca = midpoint(c, a);
      next.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca);
    }
    tris = next;
  }
  const positions = Float32Array.from(pos);
  // The welding the simulator does (exact positions), and whether the sheet is closed.
  const first = new Map<string, number>();
  const weld = new Uint32Array(positions.length / 3);
  for (let v = 0; v < weld.length; v++) {
    const k = posKey(positions, v);
    const at = first.get(k);
    weld[v] = at ?? v;
    if (at === undefined) first.set(k, v);
  }
  const edgeCount = new Map<string, number>();
  for (let i = 0; i < tris.length; i += 3) {
    for (let c = 0; c < 3; c++) {
      const k = pairKey(weld[tris[i + c]], weld[tris[i + ((c + 1) % 3)]]);
      edgeCount.set(k, (edgeCount.get(k) ?? 0) + 1);
    }
  }
  const closed = edgeCount.size > 0 && [...edgeCount.values()].every((n) => n === 2);
  return {
    positions,
    ...(UV ? { uvs: Float32Array.from(uv) } : {}),
    indices: Uint32Array.from(tris),
    source: Uint32Array.from(source),
    levels,
    held: Uint8Array.from(held),
    weld,
    closed,
  };
}

function pairKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

function edgeKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** The world matrix's largest scale (how much longer an edge is in the world than in the part's space). */
function maxScale(m: Mat4): number {
  return Math.max(Math.hypot(m[0], m[1], m[2]), Math.hypot(m[4], m[5], m[6]), Math.hypot(m[8], m[9], m[10])) || 1;
}

/**
 * How many times a cloth's triangles are split: enough for its longest edge (in the world) to be at most the resolution
 * (automatic: the longest side of its bounds over AUTO_DIVISIONS), as long as the triangles stay within
 * MAX_CLOTH_TRIANGLES.
 */
export function clothLevels(data: MeshData, triangles: readonly number[] | undefined, world: Mat4, resolutionMm: number | undefined): number {
  const source = clothSource(data, triangles);
  if (source.length === 0) return 0;
  const s = maxScale(world);
  let longest = 0;
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  const P = data.positions;
  for (const t of source) {
    for (let c = 0; c < 3; c++) {
      const a = data.indices[3 * t + c];
      const b = data.indices[3 * t + ((c + 1) % 3)];
      longest = Math.max(longest, Math.hypot(P[3 * a] - P[3 * b], P[3 * a + 1] - P[3 * b + 1], P[3 * a + 2] - P[3 * b + 2]));
      for (let k = 0; k < 3; k++) {
        lo[k] = Math.min(lo[k], P[3 * a + k]);
        hi[k] = Math.max(hi[k], P[3 * a + k]);
      }
    }
  }
  const side = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) * s;
  const res = resolutionMm && resolutionMm > 0 ? resolutionMm : side / AUTO_DIVISIONS;
  let levels = 0;
  while (longest * s > res * (1 + 1e-6) && source.length * 4 ** (levels + 1) <= MAX_CLOTH_TRIANGLES) {
    levels++;
    longest /= 2;
  }
  return levels;
}

/** Whether a part's cloth is a closed shell (where Pressure applies), at the levels it would be simulated with. */
export function clothIsClosed(state: ProjectState, part: NodeId): boolean {
  const node = state.scene.nodes[part];
  const data = node?.mesh ? getMesh(node.mesh.id) : undefined;
  if (!data) return false;
  const props = clothPropsOf(state, part);
  return clothMesh(data, props.triangles, 0).closed;
}

// ---------------------------------------------------------------------------
// The spec (CLT1)
// ---------------------------------------------------------------------------

/** One cloth part as the simulator is given it. */
export interface ClothPieceSpec {
  part: NodeId;
  mesh: MeshId;
  triangles?: number[];
  levels: number;
  /** The part's world matrix at the start and its inverse (the frames go back to its own space with it). */
  world: Mat4;
  worldInv: Mat4;
  /** The sheet's vertices in the world, x y z each. */
  positions: Float32Array;
  indices: Uint32Array;
  pinned: Uint8Array;
  params: ClothParamsResolved;
}

/** Everything the cloth simulator is given. */
export interface ClothRunSpec {
  pieces: ClothPieceSpec[];
  /** The static triangles (world), one mesh per part. */
  statics: { positions: Float32Array; indices: Uint32Array }[];
  floor: { z: number; friction: number } | null;
  wind: { velocity: Vec3; gust: number; scale: number; speed: number; seed: number };
}

/** The wind on a cloth (S4a): the switched-on effects' wind summed (mm/s), gusts from the windiest's turbulence. */
export function clothWind(state: ProjectState): ClothRunSpec['wind'] {
  const on = state.effects.filter((e) => e.enabled);
  const v: Vec3 = [0, 0, 0];
  let windiest: (typeof on)[number] | null = null;
  let best = 0;
  for (const e of on) {
    for (let k = 0; k < 3; k++) v[k] += (Number.isFinite(e.wind[k]) ? e.wind[k] : 0) * 1000;
    const speed = Math.hypot(e.wind[0], e.wind[1], e.wind[2]);
    if (speed > best) {
      best = speed;
      windiest = e;
    }
  }
  if (!windiest) return { velocity: v, gust: 0, scale: 0, speed: 0, seed: 0 };
  return {
    velocity: v,
    gust: Math.max(0, windiest.chaos) * GUST_PER_CHAOS,
    scale: Math.max(0, windiest.turbulenceScaleMm),
    speed: Math.max(0, windiest.turbulenceSpeed) * 1000,
    seed: windiest.seed >>> 0,
  };
}

/** Which vertices of a sheet (world positions) the anchor holds. */
export function anchoredVertices(positions: Float32Array, indices: Uint32Array, weld: Uint32Array, props: ClothProps): Uint8Array {
  const n = positions.length / 3;
  const out = new Uint8Array(n);
  const anchor = props.anchor ?? 'NONE';
  if (anchor === 'NONE' || n === 0) return out;
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let v = 0; v < n; v++) {
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], positions[3 * v + k]);
      hi[k] = Math.max(hi[k], positions[3 * v + k]);
    }
  }
  if (anchor === 'TOP_EDGE') {
    // The open edge (an edge of one triangle), within a hair of the highest point.
    const count = new Map<string, number>();
    for (let i = 0; i < indices.length; i += 3) {
      for (let c = 0; c < 3; c++) {
        const k = pairKey(weld[indices[i + c]], weld[indices[i + ((c + 1) % 3)]]);
        count.set(k, (count.get(k) ?? 0) + 1);
      }
    }
    const open = new Set<number>();
    for (const [k, c] of count) {
      if (c !== 1) continue;
      const [a, b] = k.split(':').map(Number);
      open.add(a);
      open.add(b);
    }
    const tol = Math.max(0.5, 0.01 * Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]));
    for (let v = 0; v < n; v++) if (open.has(weld[v]) && positions[3 * v + 2] >= hi[2] - tol) out[v] = 1;
    return out;
  }
  const box = props.box ?? CLOTH_DEFAULTS.box;
  for (let v = 0; v < n; v++) {
    let inside = true;
    for (let k = 0; k < 3 && inside; k++) {
      const extent = hi[k] - lo[k];
      const t = extent > 1e-6 ? (positions[3 * v + k] - lo[k]) / extent : 0.5;
      const a = Math.min(box.min[k], box.max[k]);
      const b = Math.max(box.min[k], box.max[k]);
      inside = t >= a - 1e-6 && t <= b + 1e-6;
    }
    if (inside) out[v] = 1;
  }
  return out;
}

/**
 * What the cloth simulator is given: the cloth parts (`parts`; by default every one, `clothParts`), the static world
 * (every other visible part that does not move, `moving`; the rest of a part whose face is the cloth), the floor and the
 * wind. Null without a cloth part that has triangles.
 */
export function clothSpec(state: ProjectState, moving: ReadonlySet<NodeId> = new Set(), parts: readonly NodeId[] = clothParts(state), meshes: (id: MeshId) => MeshData | undefined = getMesh): ClothRunSpec | null {
  const cache = new Map<NodeId, Mat4>();
  const pieces: ClothPieceSpec[] = [];
  const cloth = new Set(parts);
  const statics: ClothRunSpec['statics'] = [];
  for (const part of parts) {
    const node = state.scene.nodes[part];
    const data = node?.mesh ? meshes(node.mesh.id) : undefined;
    if (!node?.mesh || !data || data.indices.length === 0) continue;
    const props = clothPropsOf(state, part);
    const world = worldMatrix(state, part, cache);
    const levels = clothLevels(data, props.triangles, world, props.resolutionMm);
    const sheet = clothMesh(data, props.triangles, levels);
    if (sheet.indices.length === 0) continue;
    const positions = new Float32Array(sheet.positions.length);
    for (let v = 0; v < positions.length / 3; v++) {
      const p = transformPoint(world, [sheet.positions[3 * v], sheet.positions[3 * v + 1], sheet.positions[3 * v + 2]]);
      positions.set(p, 3 * v);
    }
    const pinned = anchoredVertices(positions, sheet.indices, sheet.weld, props);
    for (let v = 0; v < pinned.length; v++) if (sheet.held[v]) pinned[v] = 1;
    const triangles = props.triangles && props.triangles.length > 0 ? [...sheet.source] : undefined;
    pieces.push({ part, mesh: node.mesh.id, ...(triangles ? { triangles } : {}), levels, world, worldInv: mat4Invert(world), positions, indices: sheet.indices, pinned, params: clothParams(props) });
    // The rest of a part whose face is the cloth is static.
    if (triangles) {
      const isCloth = new Set(triangles);
      const rest: number[] = [];
      for (let t = 0; t < data.indices.length / 3; t++) if (!isCloth.has(t)) rest.push(data.indices[3 * t], data.indices[3 * t + 1], data.indices[3 * t + 2]);
      if (rest.length > 0) statics.push(worldTriangles(data, rest, world));
    }
  }
  if (pieces.length === 0) return null;
  for (const p of partsUnder(state, state.scene.roots)) {
    if (cloth.has(p) || moving.has(p) || !effectiveVisible(state, p)) continue;
    const node = state.scene.nodes[p];
    const data = node?.mesh ? meshes(node.mesh.id) : undefined;
    if (!data || data.indices.length === 0) continue;
    statics.push(worldTriangles(data, data.indices, worldMatrix(state, p, cache)));
  }
  return { pieces, statics, floor: { z: 0, friction: FLOOR_SURFACE.friction }, wind: clothWind(state) };
}

function worldTriangles(data: MeshData, indices: ArrayLike<number>, world: Mat4): { positions: Float32Array; indices: Uint32Array } {
  const used = new Map<number, number>();
  const out: number[] = [];
  const pos: number[] = [];
  for (let i = 0; i < indices.length; i++) {
    const v = indices[i];
    let at = used.get(v);
    if (at === undefined) {
      at = pos.length / 3;
      used.set(v, at);
      pos.push(...transformPoint(world, [data.positions[3 * v], data.positions[3 * v + 1], data.positions[3 * v + 2]]));
    }
    out.push(at);
  }
  return { positions: Float32Array.from(pos), indices: Uint32Array.from(out) };
}

/** The CLT1 bytes of a spec (rt_phys::cloth `ClothSpec::parse` reads them). */
export function cltBytes(spec: ClothRunSpec): Uint8Array {
  let size = 8 + 4;
  for (const p of spec.pieces) size += 8 + p.positions.length * 4 + p.indices.length * 4 + Math.ceil(p.positions.length / 3 / 32) * 4 + 36;
  size += 4;
  for (const s of spec.statics) size += 8 + s.positions.length * 4 + s.indices.length * 4;
  size += 12 + 28;
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  let at = 0;
  const u32 = (v: number) => {
    view.setUint32(at, v >>> 0, true);
    at += 4;
  };
  const f32 = (v: number) => {
    view.setFloat32(at, Number.isFinite(v) ? v : 0, true);
    at += 4;
  };
  const mesh = (positions: Float32Array, indices: Uint32Array) => {
    u32(positions.length / 3);
    u32(indices.length);
    for (let i = 0; i < positions.length; i++) f32(positions[i]);
    for (let i = 0; i < indices.length; i++) u32(indices[i]);
  };
  out.set([0x43, 0x4c, 0x54, 0x31], 0); // "CLT1"
  at = 4;
  u32(CLT1_VERSION);
  u32(spec.pieces.length);
  for (const p of spec.pieces) {
    mesh(p.positions, p.indices);
    const n = p.positions.length / 3;
    for (let w = 0; w < Math.ceil(n / 32); w++) {
      let bits = 0;
      for (let b = 0; b < 32; b++) if (p.pinned[w * 32 + b]) bits |= 1 << b;
      u32(bits);
    }
    const q = p.params;
    for (const v of [q.massPerArea, q.stretch, q.bend, q.damping, q.thickness, q.friction, q.area, q.pressure]) f32(v);
    u32(q.selfCollision ? FLAG_SELF_COLLISION : 0);
  }
  u32(spec.statics.length);
  for (const s of spec.statics) mesh(s.positions, s.indices);
  u32(spec.floor ? 1 : 0);
  f32(spec.floor?.z ?? 0);
  f32(spec.floor?.friction ?? 0);
  for (const v of [...spec.wind.velocity, spec.wind.gust, spec.wind.scale, spec.wind.speed]) f32(v);
  u32(spec.wind.seed);
  return out;
}

// ---------------------------------------------------------------------------
// The recording (the cache)
// ---------------------------------------------------------------------------

/** A cloth part's recorded shape: `frames` frames at `fps` of its sheet's vertices, in the part's own space. */
export interface ClothTrack {
  fps: number;
  frames: number;
  /** The sheet it was recorded on: the part's mesh, its face (absent: the whole mesh) and the splits. */
  mesh: MeshId;
  triangles?: number[];
  levels: number;
  vertices: number;
  /** vertices × (x, y, z) per frame, little-endian f32, base64. */
  data: string;
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(text: string): Uint8Array {
  const bin = atob(text);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const decoded = new WeakMap<ClothTrack, Float32Array | null>();

/** The floats of a track (decoded once per track object); null when it is damaged. */
export function clothFloats(track: ClothTrack): Float32Array | null {
  if (decoded.has(track)) return decoded.get(track)!;
  let out: Float32Array | null = null;
  try {
    const bytes = fromBase64(track.data);
    if (track.frames >= 1 && track.vertices >= 1 && bytes.length === track.frames * track.vertices * 12) {
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const f = new Float32Array(bytes.length / 4);
      let ok = true;
      for (let i = 0; i < f.length; i++) {
        f[i] = view.getFloat32(4 * i, true);
        if (!Number.isFinite(f[i])) ok = false;
      }
      out = ok ? f : null;
    }
  } catch {
    out = null;
  }
  decoded.set(track, out);
  return out;
}

/** A well-formed track. */
export function isClothTrack(x: unknown): x is ClothTrack {
  const t = x as Partial<ClothTrack> | null;
  return (
    !!t &&
    typeof t === 'object' &&
    typeof t.fps === 'number' &&
    t.fps > 0 &&
    Number.isInteger(t.frames) &&
    Number.isInteger(t.vertices) &&
    Number.isInteger(t.levels) &&
    (t.levels ?? -1) >= 0 &&
    typeof t.mesh === 'string' &&
    typeof t.data === 'string' &&
    (t.triangles === undefined || (Array.isArray(t.triangles) && t.triangles.every((v) => Number.isInteger(v) && v >= 0))) &&
    clothFloats(t as ClothTrack) !== null
  );
}

/** The frame of a track at clip phase `u` (0..1 of its length): the nearest one. */
export function clothFrameIndex(track: Pick<ClothTrack, 'frames'>, u: number): number {
  return Math.round(clamp(u, 0, 1) * Math.max(0, track.frames - 1));
}

/** The vertices of frame `k` of a track (a view; null when the track is damaged). */
export function clothFrame(track: ClothTrack, k: number): Float32Array | null {
  const f = clothFloats(track);
  if (!f) return null;
  const i = clamp(Math.round(k), 0, track.frames - 1);
  return f.subarray(i * track.vertices * 3, (i + 1) * track.vertices * 3);
}

/**
 * A track that grows a frame at a time from the simulator's world positions of one piece, which it brings back into
 * the part's own space. Base64 of bytes cut at a multiple of three is the base64 of the parts, so only the bytes after
 * the last such cut are encoded again; each `track()` is a new object whose floats are known.
 */
export class ClothTrackWriter {
  private floats: Float32Array;
  private count = 0;
  private bytes = new Uint8Array(0);
  private encoded = '';
  private done = 0;

  constructor(
    readonly fps: number,
    readonly piece: Pick<ClothPieceSpec, 'mesh' | 'triangles' | 'levels' | 'worldInv'> & { vertices: number },
  ) {
    this.floats = new Float32Array(Math.max(1, piece.vertices * 3 * 16));
  }

  get frames(): number {
    return this.count;
  }

  /** Appends a frame: `world` holds this piece's vertices (x y z each, world mm) from `offset` (in vertices). */
  push(world: ArrayLike<number>, offset = 0): void {
    const n = this.piece.vertices * 3;
    if ((this.count + 1) * n > this.floats.length) {
      const grown = new Float32Array(Math.max((this.count + 1) * n, this.floats.length * 2));
      grown.set(this.floats);
      this.floats = grown;
    }
    const m = this.piece.worldInv;
    const at = this.count * n;
    for (let v = 0; v < this.piece.vertices; v++) {
      const o = 3 * (offset + v);
      const p = transformPoint(m, [world[o], world[o + 1], world[o + 2]]);
      this.floats[at + 3 * v] = p[0];
      this.floats[at + 3 * v + 1] = p[1];
      this.floats[at + 3 * v + 2] = p[2];
    }
    this.count++;
  }

  /** The track so far. */
  track(): ClothTrack {
    const n = this.count * this.piece.vertices * 12;
    if (this.bytes.length < n) {
      const grown = new Uint8Array(Math.max(n, this.bytes.length * 2));
      grown.set(this.bytes.subarray(0, this.done));
      this.bytes = grown;
    }
    const view = new DataView(this.bytes.buffer);
    for (let i = (this.done / 4) | 0; i < this.count * this.piece.vertices * 3; i++) view.setFloat32(i * 4, this.floats[i], true);
    const cut = n - (n % 3);
    if (cut > this.done) {
      this.encoded += toBase64(this.bytes.subarray(this.done, cut));
      this.done = cut;
    }
    const tail = n > this.done ? toBase64(this.bytes.subarray(this.done, n)) : '';
    const track: ClothTrack = {
      fps: this.fps,
      frames: this.count,
      mesh: this.piece.mesh,
      ...(this.piece.triangles ? { triangles: [...this.piece.triangles] } : {}),
      levels: this.piece.levels,
      vertices: this.piece.vertices,
      data: this.encoded + tail,
    };
    decoded.set(track, this.floats.slice(0, this.count * this.piece.vertices * 3));
    return track;
  }
}

// ---------------------------------------------------------------------------
// The part as the pose shows it
// ---------------------------------------------------------------------------

/** A cloth part drawn with a recorded frame: its node as the renderers take it (mesh id, face materials) and its mesh. */
export interface PosedCloth {
  node: SceneNode;
  data: MeshData;
}

const posedCache = new WeakMap<ClothTrack, { frame: number; node: SceneNode; posed: PosedCloth }>();

/**
 * The cloth part `id` as the pose shows it: the part's mesh with its cloth (all of it, or its face) replaced by the
 * recorded frame's sheet, its normals made again from the frame (smooth across the welded seams) and its face
 * materials moved onto the triangles they became. Null when the pose shows no frame of it, or when the mesh is no
 * longer the one recorded (the part is drawn as it is).
 */
export function posedCloth(state: ProjectState, id: NodeId, pose: Pose | null): PosedCloth | null {
  const cp = pose?.cloth?.[id];
  const node = state.scene.nodes[id];
  if (!cp || !node?.mesh) return null;
  const clip = state.animation.clips.find((c) => c.id === cp.clip);
  const track = clip?.cloth;
  if (!track || track.mesh !== node.mesh.id) return null;
  const hit = posedCache.get(track);
  if (hit && hit.frame === cp.frame && hit.node === node) return hit.posed;
  const data = getMesh(node.mesh.id);
  if (!data) return null;
  const sheet = clothMesh(data, track.triangles, track.levels);
  const frame = clothFrame(track, cp.frame);
  if (!frame || sheet.positions.length !== track.vertices * 3) return null;
  const posed = buildPosed(node, data, sheet, frame, `${node.mesh.id}#cloth:${clip!.id}:${cp.frame}`);
  posedCache.set(track, { frame: cp.frame, node, posed });
  return posed;
}

function buildPosed(node: SceneNode, data: MeshData, sheet: ClothMesh, frame: Float32Array, id: string): PosedCloth {
  const baseV = data.positions.length / 3;
  const T = data.indices.length / 3;
  const children = 4 ** sheet.levels;
  const isCloth = new Uint8Array(T);
  for (const t of sheet.source) isCloth[t] = 1;
  const sheetV = sheet.positions.length / 3;
  const positions = new Float32Array((baseV + sheetV) * 3);
  positions.set(data.positions);
  positions.set(frame, baseV * 3);
  const normals = new Float32Array(positions.length);
  normals.set(data.normals.subarray(0, baseV * 3));
  // The sheet's normals from the frame, area-weighted, shared by the vertices the simulator welds.
  const acc = new Float32Array(sheetV * 3);
  for (let i = 0; i < sheet.indices.length; i += 3) {
    const [a, b, c] = [sheet.indices[i], sheet.indices[i + 1], sheet.indices[i + 2]];
    const ux = frame[3 * b] - frame[3 * a];
    const uy = frame[3 * b + 1] - frame[3 * a + 1];
    const uz = frame[3 * b + 2] - frame[3 * a + 2];
    const vx = frame[3 * c] - frame[3 * a];
    const vy = frame[3 * c + 1] - frame[3 * a + 1];
    const vz = frame[3 * c + 2] - frame[3 * a + 2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    for (const v of [a, b, c]) {
      const w = sheet.weld[v];
      acc[3 * w] += nx;
      acc[3 * w + 1] += ny;
      acc[3 * w + 2] += nz;
    }
  }
  for (let v = 0; v < sheetV; v++) {
    const w = sheet.weld[v];
    const l = Math.hypot(acc[3 * w], acc[3 * w + 1], acc[3 * w + 2]) || 1;
    normals[3 * (baseV + v)] = acc[3 * w] / l;
    normals[3 * (baseV + v) + 1] = acc[3 * w + 1] / l;
    normals[3 * (baseV + v) + 2] = acc[3 * w + 2] / l;
  }
  // The triangles in the part's order, each cloth triangle replaced by its children.
  const indices = new Uint32Array((T - sheet.source.length + sheet.source.length * children) * 3);
  const start = new Uint32Array(T + 1);
  let at = 0;
  let k = 0;
  for (let t = 0; t < T; t++) {
    start[t] = at / 3;
    if (isCloth[t]) {
      for (let c = 0; c < children * 3; c++) indices[at++] = baseV + sheet.indices[k * children * 3 + c];
      k++;
    } else {
      indices[at++] = data.indices[3 * t];
      indices[at++] = data.indices[3 * t + 1];
      indices[at++] = data.indices[3 * t + 2];
    }
  }
  start[T] = at / 3;
  let uvs: Float32Array | undefined;
  if (data.uvs && sheet.uvs) {
    uvs = new Float32Array((baseV + sheetV) * 2);
    uvs.set(data.uvs.subarray(0, baseV * 2));
    uvs.set(sheet.uvs, baseV * 2);
  }
  const remap = (ranges: readonly FaceRange[] | undefined): FaceRange[] | undefined =>
    ranges?.map((r) => {
      const a = start[clamp(r.start, 0, T)];
      const b = start[clamp(r.start + r.count, 0, T)];
      return { ...r, start: a, count: b - a };
    });
  const triangles = indices.length / 3;
  const posedNode: SceneNode = {
    ...node,
    mesh: { ...node.mesh!, id, vertices: baseV + sheetV, triangles },
    ...(node.faceMaterials ? { faceMaterials: remap(node.faceMaterials) } : {}),
  };
  delete posedNode.faceRanges;
  return { node: posedNode, data: { positions, normals, indices, ...(uvs ? { uvs } : {}) } };
}

// ---------------------------------------------------------------------------
// Drape over the part
// ---------------------------------------------------------------------------

/**
 * Drape over the part: the sheet of cloth laid over the selection (a PLANE primitive facing up): DRAPE_SHEET.size times
 * the longer side of its footprint, square, centred over it, DRAPE_SHEET.lift of its size above its top; of the
 * catalogue's DRAPE_MATERIAL. Null when the selection has nothing visible.
 */
export function drapePlacement(state: ProjectState, ids: readonly NodeId[]): { params: { width: number; depth: number }; position: Vec3; material: string } | null {
  const b = boundsOf(state, ids, true);
  if (isEmptyBox(b)) return null;
  const side = Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1]) * DRAPE_SHEET.size;
  if (!(side > 0)) return null;
  const size = Math.round(side * 10) / 10;
  const lift = boxMaxDim(b) * DRAPE_SHEET.lift;
  return {
    params: { width: size, depth: size },
    position: [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, b.max[2] + lift],
    material: DRAPE_MATERIAL,
  };
}
