// Geometry registry. Mesh data (typed arrays) is large and immutable, so it
// lives here, keyed by id, and the project state only keeps a small `MeshRef`
// (id, counts, local bounds). This keeps `ProjectState` plain JSON
// (ARCHITECTURE §4) while the preview and the importers share the buffers.
// Phase U2 embeds these buffers in `.repack` as GLB.

import { emptyBox, type Box, type Mat4 } from './math';

export type MeshId = string;

/** Raw triangle mesh in the local space of its part, millimetres, Z up. */
export interface MeshData {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  uvs?: Float32Array;
  /** A second set of texture coordinates (glTF TEXCOORD_1, FBX's second UV channel), kept for the slots that name it (M2a). */
  uvs2?: Float32Array;
  /**
   * Hard edges, as pairs of vertex indices (`[a0, b0, a1, b1, ...]`). An edge
   * is hard when the angle between its two faces exceeds the smoothing angle.
   * Each edge appears once; the other face of the edge has the same positions
   * but may use other vertex indices (the vertices are split along hard edges).
   * Importers that cannot tell leave it out. The CAD readers (STEP, IGES) mark
   * every edge between two CAD faces instead, whatever the angle: the topology
   * of the file says where the faces meet.
   */
  sharpEdges?: Uint32Array;
}

/** A run of consecutive triangles of a mesh: `count` triangles from triangle `start`. */
export interface TriangleRange {
  start: number;
  count: number;
}

/** What the state keeps about a mesh: enough for bounds, counts and the Doctor. */
export interface MeshRef {
  id: MeshId;
  vertices: number;
  triangles: number;
  /** Local-space bounds, millimetres. */
  bounds: Box;
}

const registry = new Map<MeshId, MeshData>();

/** Bounds of a flat xyz position array. */
export function positionsBounds(positions: ArrayLike<number>): Box {
  if (positions.length < 3) return emptyBox();
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = positions[i + k];
      if (v < min[k]) min[k] = v;
      if (v > max[k]) max[k] = v;
    }
  }
  return { min, max };
}

/**
 * Stores a mesh under `id` (replacing any previous one) and returns its ref. An id names one geometry for as
 * long as it is registered: the preview and the render workers cache by id, so never register different data
 * under an id that a state may still refer to.
 */
export function registerMesh(id: MeshId, data: MeshData): MeshRef {
  registry.set(id, data);
  return meshRef(id, data);
}

export function meshRef(id: MeshId, data: MeshData): MeshRef {
  return {
    id,
    vertices: data.positions.length / 3,
    triangles: data.indices.length / 3,
    bounds: positionsBounds(data.positions),
  };
}

/** Forgets a mesh (an import that was cancelled, or the raw meshes an import replaced). */
export function unregisterMesh(id: MeshId): void {
  registry.delete(id);
}

export function getMesh(id: MeshId): MeshData | undefined {
  return registry.get(id);
}

export function hasMesh(id: MeshId): boolean {
  return registry.has(id);
}

// --- Slices --------------------------------------------------------------------------------

/**
 * Triangle ranges after the triangles of their mesh were picked or renumbered: `source[t]` is the old triangle
 * of new triangle `t` (a slice lists the kept triangles, a re-smoothed mesh the survivors). Each range keeps the
 * new triangles that came from it, as runs; a range none of whose triangles survive is dropped. While `source`
 * keeps the old order (slices and re-smoothing do), every range stays one run.
 */
export function remapTriangleRanges(ranges: readonly TriangleRange[], source: ArrayLike<number>): TriangleRange[] {
  let end = 0;
  for (const r of ranges) end = Math.max(end, r.start + r.count);
  const owner = new Int32Array(end).fill(-1);
  ranges.forEach((r, i) => owner.fill(i, r.start, r.start + r.count));
  const out: TriangleRange[] = [];
  let lastOwner = -1;
  for (let t = 0; t < source.length; t++) {
    const s = source[t];
    const o = s < end ? owner[s] : -1;
    if (o < 0) {
      lastOwner = -1;
      continue;
    }
    const last = out[out.length - 1];
    if (o === lastOwner && last && last.start + last.count === t) last.count++;
    else out.push({ start: t, count: 1 });
    lastOwner = o;
  }
  return out;
}

/**
 * The triangles `tris` of a mesh as a mesh of their own, re-centred on its bounds. Vertices are renumbered in
 * order of first use; a hard edge is kept when a kept triangle has both of its vertices.
 */
export function sliceMesh(src: MeshData, tris: readonly number[]): { mesh: MeshData; centre: [number, number, number] } {
  const remap = new Map<number, number>();
  const order: number[] = [];
  const indices = new Uint32Array(tris.length * 3);
  for (let t = 0; t < tris.length; t++) {
    for (let j = 0; j < 3; j++) {
      const v = src.indices[3 * tris[t] + j];
      let r = remap.get(v);
      if (r === undefined) {
        r = order.length;
        remap.set(v, r);
        order.push(v);
      }
      indices[3 * t + j] = r;
    }
  }
  const positions = new Float32Array(order.length * 3);
  const normals = new Float32Array(order.length * 3);
  const uvs = src.uvs ? new Float32Array(order.length * 2) : undefined;
  const uvs2 = src.uvs2 ? new Float32Array(order.length * 2) : undefined;
  order.forEach((v, r) => {
    positions.set(src.positions.subarray(3 * v, 3 * v + 3), 3 * r);
    normals.set(src.normals.subarray(3 * v, 3 * v + 3), 3 * r);
    if (uvs && src.uvs) uvs.set(src.uvs.subarray(2 * v, 2 * v + 2), 2 * r);
    if (uvs2 && src.uvs2) uvs2.set(src.uvs2.subarray(2 * v, 2 * v + 2), 2 * r);
  });
  const b = positionsBounds(positions);
  const centre: [number, number, number] = [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
  for (let i = 0; i < positions.length; i += 3) {
    positions[i] -= centre[0];
    positions[i + 1] -= centre[1];
    positions[i + 2] -= centre[2];
  }
  let sharp: Uint32Array | undefined;
  if (src.sharpEdges && src.sharpEdges.length > 0) {
    const edges = new Set<number>();
    const key = (a: number, c: number) => (a < c ? a * order.length + c : c * order.length + a);
    for (let t = 0; t < tris.length; t++) {
      for (let j = 0; j < 3; j++) edges.add(key(indices[3 * t + j], indices[3 * t + ((j + 1) % 3)]));
    }
    const keep: number[] = [];
    for (let e = 0; e < src.sharpEdges.length; e += 2) {
      const a = remap.get(src.sharpEdges[e]);
      const c = remap.get(src.sharpEdges[e + 1]);
      if (a !== undefined && c !== undefined && edges.has(key(a, c))) keep.push(Math.min(a, c), Math.max(a, c));
    }
    sharp = Uint32Array.from(keep);
  }
  return { mesh: { positions, normals, indices, uvs, ...(uvs2 ? { uvs2 } : {}), sharpEdges: sharp }, centre };
}

// --- Building a mesh from a triangle soup (moved from io/mesh-common.ts) -----------------
//
// Rules (ROADMAP I1): positions are welded first on their exact float bits
// and then within 1e-5 of the mesh size; two faces share a vertex normal only
// when the angle between them is at most the smoothing angle (30 degrees by
// default), so vertices are split along hard edges; an edge is hard when that
// angle is exceeded. Boundary edges have no second face and are not hard.

/** Faces closer than this (degrees) share smooth normals; edges beyond it are hard. */
export const SMOOTH_ANGLE_DEG = 30;
/** Positions closer than this fraction of the mesh size are the same vertex. */
export const WELD_TOLERANCE = 1e-5;
/** Triangles whose doubled area is below this fraction of size squared are dropped. */
export const AREA_EPSILON = 1e-10;

// --- Growable buffers ----------------------------------------------------------------

/** A Float32Array that grows by doubling. */
export class FloatBuffer {
  private data: Float32Array;
  length = 0;
  constructor(capacity = 256) {
    this.data = new Float32Array(Math.max(16, capacity));
  }
  private reserve(extra: number): void {
    const need = this.length + extra;
    if (need <= this.data.length) return;
    let cap = this.data.length;
    while (cap < need) cap *= 2;
    const next = new Float32Array(cap);
    next.set(this.data.subarray(0, this.length));
    this.data = next;
  }
  push3(a: number, b: number, c: number): void {
    this.reserve(3);
    const d = this.data;
    const n = this.length;
    d[n] = a;
    d[n + 1] = b;
    d[n + 2] = c;
    this.length = n + 3;
  }
  push2(a: number, b: number): void {
    this.reserve(2);
    this.data[this.length] = a;
    this.data[this.length + 1] = b;
    this.length += 2;
  }
  at(i: number): number {
    return this.data[i];
  }
  /** Drops everything after the first `length` floats. */
  truncate(length: number): void {
    this.length = Math.min(this.length, Math.max(0, length));
  }
  /** A copy trimmed to the used length. */
  toArray(): Float32Array {
    return this.data.slice(0, this.length);
  }
}

// --- Hash table of 32-bit word keys ------------------------------------------------------

/**
 * Maps keys of up to eight unsigned 32-bit words to consecutive ids (0, 1, 2...
 * in insertion order). Open addressing; no allocation per lookup.
 */
export class KeyTable {
  private keys: Uint32Array;
  private slots: Int32Array;
  private mask: number;
  private readonly scratch = new Uint32Array(8);
  count = 0;

  constructor(
    private readonly width: number,
    expected = 1024,
  ) {
    let size = 16;
    while (size < expected * 2) size *= 2;
    this.slots = new Int32Array(size);
    this.mask = size - 1;
    this.keys = new Uint32Array(Math.max(16, expected) * width);
  }

  private hash(): number {
    const s = this.scratch;
    let h = 0x811c9dc5;
    for (let i = 0; i < this.width; i++) h = Math.imul(h ^ s[i], 0x01000193);
    h ^= h >>> 15;
    h = Math.imul(h, 0x2c1b3c6d);
    h ^= h >>> 12;
    return h;
  }

  private grow(): void {
    const size = this.slots.length * 2;
    const slots = new Int32Array(size);
    const mask = size - 1;
    const w = this.width;
    const s = this.scratch;
    for (let id = 0; id < this.count; id++) {
      for (let i = 0; i < w; i++) s[i] = this.keys[id * w + i];
      let slot = this.hash() & mask;
      while (slots[slot] !== 0) slot = (slot + 1) & mask;
      slots[slot] = id + 1;
    }
    this.slots = slots;
    this.mask = mask;
  }

  /** The id of the key, adding it when it is new (`count` grows by one). */
  getOrAdd(a: number, b = 0, c = 0, d = 0, e = 0, f = 0, g = 0, k = 0): number {
    const s = this.scratch;
    s[0] = a;
    s[1] = b;
    s[2] = c;
    s[3] = d;
    s[4] = e;
    s[5] = f;
    s[6] = g;
    s[7] = k;
    const w = this.width;
    let slot = this.hash() & this.mask;
    for (;;) {
      const entry = this.slots[slot];
      if (entry === 0) break;
      const base = (entry - 1) * w;
      let same = true;
      for (let i = 0; i < w; i++) {
        if (this.keys[base + i] !== s[i]) {
          same = false;
          break;
        }
      }
      if (same) return entry - 1;
      slot = (slot + 1) & this.mask;
    }
    const id = this.count++;
    if ((id + 1) * w > this.keys.length) {
      const next = new Uint32Array(this.keys.length * 2);
      next.set(this.keys);
      this.keys = next;
    }
    for (let i = 0; i < w; i++) this.keys[id * w + i] = s[i];
    this.slots[slot] = id + 1;
    if (this.count * 2 > this.slots.length) this.grow();
    return id;
  }
}

// --- Building a mesh ---------------------------------------------------------------------

/** A triangle soup: three corners per triangle, nothing shared. Axes of the file. */
export interface RawMesh {
  /** 9 floats per triangle. Modified in place (negative zero is normalised). */
  positions: Float32Array;
  /** 9 floats per triangle, when the file carries normals for every corner. */
  normals?: Float32Array | null;
  /** 6 floats per triangle. */
  uvs?: Float32Array | null;
  /** The second set, 6 floats per triangle (only with `uvs`). */
  uvs2?: Float32Array | null;
  /** 3 floats per triangle: the normal a file stores for the facet (STL). Fallback only. */
  facetNormals?: Float32Array | null;
}

export interface BuildOptions {
  /** Smoothing angle in degrees (default 30). */
  smoothDeg?: number;
}

export interface BuiltMesh {
  data: MeshData;
  /** Triangles dropped (zero area, collapsed by welding, or not finite). */
  dropped: number;
  /** For each triangle of `data`, its index in the input soup. */
  source: Uint32Array;
}

/** Welds positions: exact float bits first, then within `tol`. Returns welded ids per corner. */
function weldPositions(raw: RawMesh, finite: Uint8Array, min: [number, number, number], tol: number): { cornerPos: Int32Array; positions: Float32Array; count: number } {
  const pos = raw.positions;
  const T = finite.length;
  for (let i = 0; i < pos.length; i++) if (pos[i] === 0) pos[i] = 0;
  const bits = new Uint32Array(pos.buffer, pos.byteOffset, pos.length);

  // Stage 1: exact bits.
  const exact = new KeyTable(3, Math.min(pos.length / 3, 1 << 20));
  const exactOf = new Int32Array(T * 3).fill(-1);
  const unique = new FloatBuffer(1024);
  for (let t = 0; t < T; t++) {
    if (!finite[t]) continue;
    for (let j = 0; j < 3; j++) {
      const c = 3 * t + j;
      const before = exact.count;
      const id = exact.getOrAdd(bits[3 * c], bits[3 * c + 1], bits[3 * c + 2]);
      if (exact.count !== before) unique.push3(pos[3 * c], pos[3 * c + 1], pos[3 * c + 2]);
      exactOf[c] = id;
    }
  }
  const U = exact.count;
  const up = unique.toArray();

  // Stage 2: merge unique positions closer than `tol`, scanning the cells around each.
  const rep = new Int32Array(U);
  for (let u = 0; u < U; u++) rep[u] = u;
  if (tol > 0 && U > 1) {
    const cell = 2 * tol;
    const inv = 1 / cell;
    const head = new Map<number, number>();
    const next = new Int32Array(U).fill(-1);
    const cellKey = (ix: number, iy: number, iz: number) => ((ix + 1) * 65536 + (iy + 1)) * 65536 + (iz + 1);
    const tol2 = tol * tol;
    for (let u = 0; u < U; u++) {
      const x = up[3 * u];
      const y = up[3 * u + 1];
      const z = up[3 * u + 2];
      const fx = (x - min[0]) * inv;
      const fy = (y - min[1]) * inv;
      const fz = (z - min[2]) * inv;
      const ix = Math.floor(fx);
      const iy = Math.floor(fy);
      const iz = Math.floor(fz);
      // A match is within tol = half a cell: only the nearer neighbour on each axis can hold one.
      const dx = fx - ix < 0.5 ? -1 : 1;
      const dy = fy - iy < 0.5 ? -1 : 1;
      const dz = fz - iz < 0.5 ? -1 : 1;
      let found = -1;
      search: for (let a = 0; a < 2; a++) {
        for (let b = 0; b < 2; b++) {
          for (let c = 0; c < 2; c++) {
            let r = head.get(cellKey(ix + (a ? dx : 0), iy + (b ? dy : 0), iz + (c ? dz : 0))) ?? -1;
            while (r >= 0) {
              const ex = up[3 * r] - x;
              const ey = up[3 * r + 1] - y;
              const ez = up[3 * r + 2] - z;
              if (ex * ex + ey * ey + ez * ez <= tol2) {
                found = r;
                break search;
              }
              r = next[r];
            }
          }
        }
      }
      if (found >= 0) {
        rep[u] = found;
      } else {
        const k = cellKey(ix, iy, iz);
        next[u] = head.get(k) ?? -1;
        head.set(k, u);
      }
    }
  }
  const rank = new Int32Array(U).fill(-1);
  let W = 0;
  const wid = new Int32Array(U);
  const welded = new FloatBuffer(U * 3);
  for (let u = 0; u < U; u++) {
    const r = rep[u];
    if (rank[r] < 0) {
      rank[r] = W++;
      welded.push3(up[3 * r], up[3 * r + 1], up[3 * r + 2]);
    }
    wid[u] = rank[r];
  }
  const cornerPos = new Int32Array(T * 3).fill(-1);
  for (let c = 0; c < cornerPos.length; c++) if (exactOf[c] >= 0) cornerPos[c] = wid[exactOf[c]];
  return { cornerPos, positions: welded.toArray(), count: W };
}

/**
 * Builds an indexed mesh from a triangle soup. Returns null when no triangle
 * survives. See the header of this file for the rules.
 */
export function buildMesh(raw: RawMesh, options: BuildOptions = {}): BuiltMesh | null {
  const smoothDeg = options.smoothDeg ?? SMOOTH_ANGLE_DEG;
  const cosThreshold = Math.cos((smoothDeg * Math.PI) / 180) - 1e-9;
  const T = Math.floor(raw.positions.length / 9);

  // Finite triangles and the bounds of the mesh.
  const finite = new Uint8Array(T);
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  let anyFinite = false;
  for (let t = 0; t < T; t++) {
    let ok = true;
    for (let i = 0; i < 9; i++) if (!Number.isFinite(raw.positions[9 * t + i])) ok = false;
    if (!ok) continue;
    finite[t] = 1;
    anyFinite = true;
    for (let i = 0; i < 9; i++) {
      const v = raw.positions[9 * t + i];
      const k = i % 3;
      if (v < min[k]) min[k] = v;
      if (v > max[k]) max[k] = v;
    }
  }
  if (!anyFinite) return null;
  const size = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]);

  const { cornerPos, positions: wpos } = weldPositions(raw, finite, min, WELD_TOLERANCE * size);

  // Keep the triangles that still span an area; remember their face normals and corner angles.
  const keptBuf = new Uint32Array(T);
  const fnBuf = new Float64Array(3 * T);
  const angBuf = new Float64Array(3 * T);
  let K = 0;
  const areaMin = AREA_EPSILON * size * size;
  for (let t = 0; t < T; t++) {
    if (!finite[t]) continue;
    const a = cornerPos[3 * t];
    const b = cornerPos[3 * t + 1];
    const c = cornerPos[3 * t + 2];
    if (a === b || b === c || a === c) continue;
    const ax = wpos[3 * a];
    const ay = wpos[3 * a + 1];
    const az = wpos[3 * a + 2];
    const abx = wpos[3 * b] - ax;
    const aby = wpos[3 * b + 1] - ay;
    const abz = wpos[3 * b + 2] - az;
    const acx = wpos[3 * c] - ax;
    const acy = wpos[3 * c + 1] - ay;
    const acz = wpos[3 * c + 2] - az;
    const cx = aby * acz - abz * acy;
    const cy = abz * acx - abx * acz;
    const cz = abx * acy - aby * acx;
    const len = Math.hypot(cx, cy, cz);
    if (!(len > areaMin)) continue;
    keptBuf[K] = t;
    fnBuf[3 * K] = cx / len;
    fnBuf[3 * K + 1] = cy / len;
    fnBuf[3 * K + 2] = cz / len;
    // Interior angles: every pair of edges of a triangle has the same cross product length, `len`.
    const bcx = acx - abx;
    const bcy = acy - aby;
    const bcz = acz - abz;
    angBuf[3 * K] = Math.atan2(len, abx * acx + aby * acy + abz * acz);
    angBuf[3 * K + 1] = Math.atan2(len, -(abx * bcx + aby * bcy + abz * bcz));
    angBuf[3 * K + 2] = Math.atan2(len, acx * bcx + acy * bcy + acz * bcz);
    K++;
  }
  const dropped = T - K;
  if (K === 0) return null;
  const kept = keptBuf.subarray(0, K);
  const source = kept.slice();
  const fn = fnBuf.subarray(0, 3 * K);
  const ang = angBuf.subarray(0, 3 * K);
  const tri = new Int32Array(3 * K);
  for (let k = 0; k < K; k++) for (let j = 0; j < 3; j++) tri[3 * k + j] = cornerPos[3 * kept[k] + j];

  // Edges: which faces meet along each pair of welded vertices.
  const edgeTable = new KeyTable(2, Math.min(3 * K, 1 << 20));
  const ea = new Int32Array(3 * K);
  const eb = new Int32Array(3 * K);
  const ef0 = new Int32Array(3 * K);
  const ef1 = new Int32Array(3 * K);
  const ecount = new Int32Array(3 * K);
  const extra = new Map<number, number[]>();
  for (let k = 0; k < K; k++) {
    for (let j = 0; j < 3; j++) {
      const a = tri[3 * k + j];
      const b = tri[3 * k + ((j + 1) % 3)];
      const lo = a < b ? a : b;
      const hi = a < b ? b : a;
      const before = edgeTable.count;
      const e = edgeTable.getOrAdd(lo, hi);
      if (edgeTable.count !== before) {
        ea[e] = lo;
        eb[e] = hi;
        ef0[e] = k;
        ef1[e] = -1;
        ecount[e] = 1;
      } else {
        ecount[e]++;
        if (ef1[e] < 0) ef1[e] = k;
        else (extra.get(e) ?? extra.set(e, []).get(e)!).push(k);
      }
    }
  }
  const E = edgeTable.count;

  // Hard edges, and the union of corners across smooth ones.
  const dot = (p: number, q: number) => fn[3 * p] * fn[3 * q] + fn[3 * p + 1] * fn[3 * q + 1] + fn[3 * p + 2] * fn[3 * q + 2];
  const hard = new Uint8Array(E);
  const parent = new Int32Array(3 * K);
  for (let i = 0; i < parent.length; i++) parent[i] = i;
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const cornerOf = (k: number, v: number) => (tri[3 * k] === v ? 3 * k : tri[3 * k + 1] === v ? 3 * k + 1 : 3 * k + 2);
  for (let e = 0; e < E; e++) {
    const n = ecount[e];
    if (n < 2) continue;
    if (n === 2) {
      if (dot(ef0[e], ef1[e]) < cosThreshold) {
        hard[e] = 1;
        continue;
      }
      for (const v of [ea[e], eb[e]]) {
        const p = find(cornerOf(ef0[e], v));
        const q = find(cornerOf(ef1[e], v));
        if (p !== q) parent[Math.max(p, q)] = Math.min(p, q);
      }
    } else {
      // Non-manifold: hard when any two of its faces differ by more than the angle.
      const faces = [ef0[e], ef1[e], ...(extra.get(e) ?? [])];
      for (let i = 0; i < faces.length && !hard[e]; i++) for (let j = i + 1; j < faces.length; j++) if (dot(faces[i], faces[j]) < cosThreshold) hard[e] = 1;
    }
  }

  // Render vertices: one per (welded position, smoothing group), or per distinct file normal.
  const hasNormals = !!raw.normals;
  const hasUvs = !!raw.uvs;
  const hasUvs2 = hasUvs && !!raw.uvs2;
  const cornerNormal = new Float32Array(hasNormals ? 9 * K : 0);
  if (hasNormals) {
    for (let k = 0; k < K; k++) {
      for (let j = 0; j < 3; j++) {
        const s = 9 * kept[k] + 3 * j;
        let x = raw.normals![s];
        let y = raw.normals![s + 1];
        let z = raw.normals![s + 2];
        const l = Math.hypot(x, y, z);
        if (l > 1e-12 && Number.isFinite(l)) {
          x /= l;
          y /= l;
          z /= l;
        } else {
          x = fn[3 * k];
          y = fn[3 * k + 1];
          z = fn[3 * k + 2];
        }
        // `+ 0` turns negative zero into zero so equal normals have equal bits.
        cornerNormal.set([x + 0, y + 0, z + 0], 9 * k + 3 * j);
      }
    }
  }
  const nbits = new Uint32Array(cornerNormal.buffer);
  const uvBits = hasUvs ? new Uint32Array(raw.uvs!.buffer, raw.uvs!.byteOffset, raw.uvs!.length) : null;
  if (hasUvs) for (let i = 0; i < raw.uvs!.length; i++) if (raw.uvs![i] === 0) raw.uvs![i] = 0;
  if (hasUvs2) for (let i = 0; i < raw.uvs2!.length; i++) if (raw.uvs2![i] === 0) raw.uvs2![i] = 0;
  // With a second set, a render vertex is one corner's whole tuple: the first set and the second are hashed together.
  const uv2Bits = hasUvs2 ? new Uint32Array(raw.uvs2!.buffer, raw.uvs2!.byteOffset, raw.uvs2!.length) : null;
  const rvTable = new KeyTable((hasNormals ? 4 : 2) + (hasUvs ? 2 : 0) + (hasUvs2 ? 2 : 0), Math.min(3 * K, 1 << 20));
  const rvOf = new Uint32Array(3 * K);
  const rvCorner: number[] = [];
  for (let k = 0; k < K; k++) {
    for (let j = 0; j < 3; j++) {
      const c = 3 * k + j;
      const sc = 3 * kept[k] + j;
      let id: number;
      const before = rvTable.count;
      if (uv2Bits) {
        const n0 = hasNormals ? nbits[3 * c] : find(c);
        id = hasNormals
          ? rvTable.getOrAdd(tri[c], n0, nbits[3 * c + 1], nbits[3 * c + 2], uvBits![2 * sc], uvBits![2 * sc + 1], uv2Bits[2 * sc], uv2Bits[2 * sc + 1])
          : rvTable.getOrAdd(tri[c], n0, uvBits![2 * sc], uvBits![2 * sc + 1], uv2Bits[2 * sc], uv2Bits[2 * sc + 1]);
      } else if (hasNormals) {
        const u0 = uvBits ? uvBits[2 * sc] : 0;
        const u1 = uvBits ? uvBits[2 * sc + 1] : 0;
        id = hasUvs
          ? rvTable.getOrAdd(tri[c], nbits[3 * c], nbits[3 * c + 1], nbits[3 * c + 2], u0, u1)
          : rvTable.getOrAdd(tri[c], nbits[3 * c], nbits[3 * c + 1], nbits[3 * c + 2]);
      } else {
        id = hasUvs ? rvTable.getOrAdd(tri[c], find(c), uvBits![2 * sc], uvBits![2 * sc + 1]) : rvTable.getOrAdd(tri[c], find(c));
      }
      if (rvTable.count !== before) rvCorner.push(c);
      rvOf[c] = id;
    }
  }
  const R = rvTable.count;

  const positions = new Float32Array(3 * R);
  const normals = new Float32Array(3 * R);
  const uvs = hasUvs ? new Float32Array(2 * R) : undefined;
  const uvs2 = hasUvs2 ? new Float32Array(2 * R) : undefined;
  for (let v = 0; v < R; v++) {
    const c = rvCorner[v];
    const w = tri[c];
    positions.set([wpos[3 * w], wpos[3 * w + 1], wpos[3 * w + 2]], 3 * v);
    if (uvs) {
      const sc = 3 * kept[Math.floor(c / 3)] + (c % 3);
      uvs[2 * v] = raw.uvs![2 * sc];
      uvs[2 * v + 1] = raw.uvs![2 * sc + 1];
      if (uvs2) {
        uvs2[2 * v] = raw.uvs2![2 * sc];
        uvs2[2 * v + 1] = raw.uvs2![2 * sc + 1];
      }
    }
  }
  if (hasNormals) {
    for (let v = 0; v < R; v++) {
      const c = rvCorner[v];
      normals.set(cornerNormal.subarray(3 * c, 3 * c + 3), 3 * v);
    }
  } else {
    // Angle-weighted sum of the face normals of each smoothing group.
    const acc = new Float64Array(3 * R);
    const weight = new Float64Array(R);
    for (let c = 0; c < 3 * K; c++) {
      const k = Math.floor(c / 3);
      const v = rvOf[c];
      acc[3 * v] += fn[3 * k] * ang[c];
      acc[3 * v + 1] += fn[3 * k + 1] * ang[c];
      acc[3 * v + 2] += fn[3 * k + 2] * ang[c];
      weight[v] += ang[c];
    }
    for (let v = 0; v < R; v++) {
      const l = Math.hypot(acc[3 * v], acc[3 * v + 1], acc[3 * v + 2]);
      if (l > 1e-6 * weight[v] && l > 0) {
        normals.set([acc[3 * v] / l, acc[3 * v + 1] / l, acc[3 * v + 2] / l], 3 * v);
        continue;
      }
      // The faces of the group cancel out: use the facet normal of the first face.
      const k = Math.floor(rvCorner[v] / 3);
      const stored = raw.facetNormals;
      const s = 3 * kept[k];
      const sl = stored ? Math.hypot(stored[s], stored[s + 1], stored[s + 2]) : 0;
      if (stored && sl > 1e-12 && Number.isFinite(sl)) normals.set([stored[s] / sl, stored[s + 1] / sl, stored[s + 2] / sl], 3 * v);
      else normals.set([fn[3 * k], fn[3 * k + 1], fn[3 * k + 2]], 3 * v);
    }
  }

  let hardCount = 0;
  for (let e = 0; e < E; e++) hardCount += hard[e];
  const sharpEdges = new Uint32Array(2 * hardCount);
  let o = 0;
  for (let e = 0; e < E; e++) {
    if (!hard[e]) continue;
    const a = rvOf[cornerOf(ef0[e], ea[e])];
    const b = rvOf[cornerOf(ef0[e], eb[e])];
    sharpEdges[o++] = Math.min(a, b);
    sharpEdges[o++] = Math.max(a, b);
  }

  return { data: { positions, normals, indices: rvOf, uvs, ...(uvs2 ? { uvs2 } : {}), sharpEdges }, dropped, source };
}

// --- Welding by position -------------------------------------------------------------------------

/**
 * The same id for vertices closer than `tol` (ids 0, 1, 2... in order of first appearance), as `buildMesh`
 * welds a soup: what is adjacent by position, whatever the vertex indices say. `count` is the number of ids.
 */
export function weldIds(positions: ArrayLike<number>, tol: number): { ids: Int32Array; count: number } {
  const V = Math.floor(positions.length / 3);
  const ids = new Int32Array(V);
  if (V === 0) return { ids, count: 0 };
  const min = [Infinity, Infinity, Infinity];
  for (let v = 0; v < V; v++) for (let k = 0; k < 3; k++) min[k] = Math.min(min[k], positions[3 * v + k]);
  // A match is within tol = half a cell: only the nearer neighbour on each axis can hold one.
  const cell = tol > 0 ? 2 * tol : 1;
  const inv = 1 / cell;
  const tol2 = tol * tol;
  // Cells that hold a representative, by open addressing on their integer coordinates (at most V of them).
  let size = 16;
  while (size < 2 * V) size *= 2;
  const mask = size - 1;
  const cellX = new Int32Array(size);
  const cellY = new Int32Array(size);
  const cellZ = new Int32Array(size);
  const head = new Int32Array(size).fill(-1);
  const next = new Int32Array(V).fill(-1);
  /** The slot of a cell; with `insert`, a new one when it has none (else -1). */
  const slot = (ix: number, iy: number, iz: number, insert: boolean): number => {
    let h = (Math.imul(ix, 73856093) ^ Math.imul(iy, 19349663) ^ Math.imul(iz, 83492791)) & mask;
    while (head[h] >= 0) {
      if (cellX[h] === ix && cellY[h] === iy && cellZ[h] === iz) return h;
      h = (h + 1) & mask;
    }
    if (!insert) return -1;
    cellX[h] = ix;
    cellY[h] = iy;
    cellZ[h] = iz;
    return h;
  };
  let count = 0;
  for (let v = 0; v < V; v++) {
    const x = positions[3 * v];
    const y = positions[3 * v + 1];
    const z = positions[3 * v + 2];
    const fx = (x - min[0]) * inv;
    const fy = (y - min[1]) * inv;
    const fz = (z - min[2]) * inv;
    // `| 0` keeps the coordinates integers; two far cells that alias still compare their true distances.
    const ix = Math.floor(fx) | 0;
    const iy = Math.floor(fy) | 0;
    const iz = Math.floor(fz) | 0;
    const dx = fx - Math.floor(fx) < 0.5 ? -1 : 1;
    const dy = fy - Math.floor(fy) < 0.5 ? -1 : 1;
    const dz = fz - Math.floor(fz) < 0.5 ? -1 : 1;
    let found = -1;
    search: for (let a = 0; a < 2; a++) {
      for (let b = 0; b < 2; b++) {
        for (let c = 0; c < 2; c++) {
          const h = slot(ix + (a ? dx : 0), iy + (b ? dy : 0), iz + (c ? dz : 0), false);
          let r = h < 0 ? -1 : head[h];
          while (r >= 0) {
            const ex = positions[3 * r] - x;
            const ey = positions[3 * r + 1] - y;
            const ez = positions[3 * r + 2] - z;
            if (ex * ex + ey * ey + ez * ez <= tol2) {
              found = r;
              break search;
            }
            r = next[r];
          }
        }
      }
    }
    if (found >= 0) {
      ids[v] = ids[found];
    } else {
      ids[v] = count++;
      const h = slot(ix, iy, iz, true);
      next[v] = head[h];
      head[h] = v;
    }
  }
  return { ids, count };
}

// --- Geometry operations of the scene (phase U3) --------------------------------------------------

/** The same mesh with every triangle wound the other way and every normal reversed. Shares positions and uvs. */
export function flipMesh(src: MeshData): MeshData {
  const normals = new Float32Array(src.normals.length);
  // `+ 0` keeps zero components as +0, so a mesh flipped twice has the bits it started with.
  for (let i = 0; i < normals.length; i++) normals[i] = -src.normals[i] + 0;
  const indices = new Uint32Array(src.indices);
  for (let i = 0; i + 2 < indices.length; i += 3) {
    const t = indices[i + 1];
    indices[i + 1] = indices[i + 2];
    indices[i + 2] = t;
  }
  return { positions: src.positions, normals, indices, uvs: src.uvs, ...(src.uvs2 ? { uvs2: src.uvs2 } : {}), sharpEdges: src.sharpEdges };
}

/**
 * Normals recomputed for a smoothing angle: the mesh goes back to a triangle soup (positions and uvs per
 * corner, without its normals) and through `buildMesh`, so welding, smoothing groups and hard edges follow the
 * same rules as an import. `source[t]` is the input triangle of output triangle `t` (degenerate triangles are
 * dropped). Null when no triangle survives.
 */
export function resmoothMesh(src: MeshData, smoothDeg: number): { data: MeshData; source: Uint32Array } | null {
  const T = Math.floor(src.indices.length / 3);
  const positions = new Float32Array(T * 9);
  const uvs = src.uvs ? new Float32Array(T * 6) : null;
  const uvs2 = src.uvs && src.uvs2 ? new Float32Array(T * 6) : null;
  for (let t = 0; t < T; t++) {
    for (let j = 0; j < 3; j++) {
      const v = src.indices[3 * t + j];
      positions.set(src.positions.subarray(3 * v, 3 * v + 3), 9 * t + 3 * j);
      if (uvs && src.uvs) uvs.set(src.uvs.subarray(2 * v, 2 * v + 2), 6 * t + 2 * j);
      if (uvs2 && src.uvs2) uvs2.set(src.uvs2.subarray(2 * v, 2 * v + 2), 6 * t + 2 * j);
    }
  }
  const built = buildMesh({ positions, uvs, uvs2 }, { smoothDeg });
  return built ? { data: built.data, source: built.source } : null;
}

/** Output triangle -> input triangle of meshes made by `resmoothMesh` (when some triangles were dropped). */
const triangleSources = new Map<MeshId, Uint32Array>();

/**
 * The ref of the mesh registered under `id`, making and registering it first when there is none. Derived ids
 * name their content (`body~flip`, `body~s45`), so a mesh made once is reused, also after an undo.
 */
export function ensureMesh(id: MeshId, make: () => { data: MeshData; source?: Uint32Array } | null): MeshRef | null {
  const hit = registry.get(id);
  if (hit) return meshRef(id, hit);
  const made = make();
  if (!made) return null;
  if (made.source?.some((s, i) => s !== i)) triangleSources.set(id, made.source);
  return registerMesh(id, made.data);
}

/** Input triangle of each triangle of a derived mesh, or null when they are the same triangles in the same order. */
export function triangleSource(id: MeshId): Uint32Array | null {
  return triangleSources.get(id) ?? null;
}

/** Gives a mesh its triangle map back (a project file keeps it, `triangleSource`). A map of the identity is not kept. */
export function setTriangleSource(id: MeshId, source: Uint32Array | null): void {
  if (source && source.some((s, i) => s !== i)) triangleSources.set(id, source);
  else triangleSources.delete(id);
}

/** Ids of every registered mesh. */
export function meshIds(): MeshId[] {
  return [...registry.keys()];
}

/**
 * Forgets every mesh that is not in `keep` (and the triangle maps with them). Opening or starting a project
 * replaces the state and clears the history, so the meshes of the old one are unreachable.
 */
export function retainMeshes(keep: ReadonlySet<MeshId>): void {
  for (const id of [...registry.keys()]) {
    if (keep.has(id)) continue;
    registry.delete(id);
    triangleSources.delete(id);
  }
}

/** A short, stable hash of a list of indices (FNV-1a, 32 bits) for naming derived meshes. */
export function hashIndices(list: ArrayLike<number>): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < list.length; i++) {
    const v = list[i];
    for (let k = 0; k < 4; k++) h = Math.imul(h ^ ((v >>> (8 * k)) & 255), 0x01000193);
  }
  return `${(h >>> 0).toString(36)}x${list.length}`;
}

const boundsCache = new WeakMap<MeshData, Map<string, Box>>();

/** Exact bounds of the vertices of a mesh under a matrix (the box of a rotated box is larger). Cached per matrix. */
export function transformedMeshBounds(data: MeshData, m: Mat4): Box {
  let byMatrix = boundsCache.get(data);
  if (!byMatrix) boundsCache.set(data, (byMatrix = new Map()));
  const key = m.map((v) => v.toPrecision(10)).join(',');
  const hit = byMatrix.get(key);
  if (hit) return hit;
  const p = data.positions;
  if (p.length < 3) return emptyBox();
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i + 2 < p.length; i += 3) {
    const x = p[i];
    const y = p[i + 1];
    const z = p[i + 2];
    for (let k = 0; k < 3; k++) {
      const v = m[k] * x + m[4 + k] * y + m[8 + k] * z + m[12 + k];
      if (v < min[k]) min[k] = v;
      if (v > max[k]) max[k] = v;
    }
  }
  const box = { min, max };
  if (byMatrix.size > 64) byMatrix.clear();
  byMatrix.set(key, box);
  return box;
}
