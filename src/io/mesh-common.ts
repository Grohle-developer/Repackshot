// Geometry shared by the mesh importers (OBJ, STL): the Y-up to Z-up axis
// change, a growable float buffer, a hash table keyed by 32-bit words, and
// `buildMesh`, which turns a triangle soup into an indexed mesh with welded
// vertices, smoothing-angle normals and hard edges.
//
// Rules (ROADMAP I1): positions are welded first on their exact float bits
// and then within 1e-5 of the mesh size; two faces share a vertex normal only
// when the angle between them is at most the smoothing angle (30 degrees by
// default), so vertices are split along hard edges; an edge is hard when that
// angle is exceeded. Boundary edges have no second face and are not hard.

import type { MeshData } from '../core/meshes';

/** Faces closer than this (degrees) share smooth normals; edges beyond it are hard. */
export const SMOOTH_ANGLE_DEG = 30;
/** Positions closer than this fraction of the mesh size are the same vertex. */
export const WELD_TOLERANCE = 1e-5;
/** Triangles whose doubled area is below this fraction of size squared are dropped. */
const AREA_EPSILON = 1e-10;

/** Y-up (OBJ, glTF) to the model's Z-up. A rotation, so winding is preserved. */
export function yUpToZUp(x: number, y: number, z: number): [number, number, number] {
  return [x, -z, y];
}

// --- Messages and parsed shapes --------------------------------------------------

/**
 * Something the interface tells the person after an import. `code` selects the
 * string `import.msg.<code>`; `params` fill its placeholders.
 */
export type ImportMessageCode = 'degenerate' | 'badFace' | 'partialNormals' | 'scaleSmall' | 'scaleLarge' | 'mtlIgnored';
export interface ImportMessage {
  code: ImportMessageCode;
  params: Record<string, string | number>;
}

/** A run of triangles whose material differs from the part's initial one. */
export interface MaterialRange {
  start: number;
  count: number;
  /** Material name, or null for none (the Default material). */
  material: string | null;
}

/** One part as a reader hands it over: geometry in model axes, file units. */
export interface ParsedPart {
  name: string;
  mesh: MeshData;
  /** Initial material name (OBJ `usemtl`), or null. */
  material: string | null;
  ranges: MaterialRange[];
}

export interface ParsedModel {
  parts: ParsedPart[];
  /** Data that was repaired or dropped. */
  warnings: ImportMessage[];
  /** Informational. */
  notes: ImportMessage[];
}

// --- STL detection (here so import.ts can sniff without loading the STL reader) ---------------

export const HEADER_BYTES = 80;
export const FACET_BYTES = 50;

/** True when the byte length is exactly that of a binary STL with the facet count it declares. */
export function isBinaryStl(bytes: Uint8Array): boolean {
  if (bytes.byteLength < HEADER_BYTES + 4) return false;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return HEADER_BYTES + 4 + FACET_BYTES * dv.getUint32(HEADER_BYTES, true) === bytes.byteLength;
}

/** True for ASCII STL text: starts with `solid` and contains `facet`. */
export function looksLikeAsciiStl(bytes: Uint8Array): boolean {
  // The head is enough to see `solid`; `facet` follows within the first few lines.
  const head = new TextDecoder('utf-8').decode(bytes.subarray(0, Math.min(bytes.byteLength, 4096))).trimStart();
  return head.startsWith('solid') && head.includes('facet');
}

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
 * Maps keys of up to six unsigned 32-bit words to consecutive ids (0, 1, 2...
 * in insertion order). Open addressing; no allocation per lookup.
 */
export class KeyTable {
  private keys: Uint32Array;
  private slots: Int32Array;
  private mask: number;
  private readonly scratch = new Uint32Array(6);
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
  getOrAdd(a: number, b = 0, c = 0, d = 0, e = 0, f = 0): number {
    const s = this.scratch;
    s[0] = a;
    s[1] = b;
    s[2] = c;
    s[3] = d;
    s[4] = e;
    s[5] = f;
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

/** A triangle soup: three corners per triangle, nothing shared. Model axes. */
export interface RawMesh {
  /** 9 floats per triangle. Modified in place (negative zero is normalised). */
  positions: Float32Array;
  /** 9 floats per triangle, when the file carries normals for every corner. */
  normals?: Float32Array | null;
  /** 6 floats per triangle. */
  uvs?: Float32Array | null;
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
  const rvTable = new KeyTable((hasNormals ? 4 : 2) + (hasUvs ? 2 : 0), Math.min(3 * K, 1 << 20));
  const rvOf = new Uint32Array(3 * K);
  const rvCorner: number[] = [];
  for (let k = 0; k < K; k++) {
    for (let j = 0; j < 3; j++) {
      const c = 3 * k + j;
      const sc = 3 * kept[k] + j;
      let id: number;
      const before = rvTable.count;
      if (hasNormals) {
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
  for (let v = 0; v < R; v++) {
    const c = rvCorner[v];
    const w = tri[c];
    positions.set([wpos[3 * w], wpos[3 * w + 1], wpos[3 * w + 2]], 3 * v);
    if (uvs) {
      const sc = 3 * kept[Math.floor(c / 3)] + (c % 3);
      uvs[2 * v] = raw.uvs![2 * sc];
      uvs[2 * v + 1] = raw.uvs![2 * sc + 1];
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

  return { data: { positions, normals, indices: rvOf, uvs, sharpEdges }, dropped, source };
}

/** Largest dimension of a flat xyz position array (0 when empty). */
export function largestDimension(arrays: readonly ArrayLike<number>[]): number {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const a of arrays) {
    for (let i = 0; i + 2 < a.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        const v = a[i + k];
        if (v < min[k]) min[k] = v;
        if (v > max[k]) max[k] = v;
      }
    }
  }
  if (!Number.isFinite(min[0])) return 0;
  return Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
}
