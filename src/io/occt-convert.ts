// What occt-import-js returns for a STEP or IGES file (occt-protocol.ts), as
// the model a reader hands to the import sheet. Pure: no worker, no fetch; the
// worker in step-worker.ts and the tests in Node feed it the same packed result.
//
//   - The assembly tree becomes groups with their names: a node with children
//     is a GROUP, a node with one mesh is a PART, a node with several meshes a
//     GROUP of PARTs; the root is the MODEL named after the file. The library
//     bakes the placement of every instance into the vertices, so groups sit
//     at the origin and every part is re-centred on its own bounds (the node
//     position carries the offset), as in the other readers.
//   - Every CAD face stays a run of triangles (`SceneNode.faceRanges`). The
//     library triangulates face by face and gives each face its own vertices
//     and normals averaged inside the face: smooth inside, split at the border.
//     This keeps it that way (a vertex is never shared by two faces, even if a
//     future version of the library shared them) and computes the normals of a
//     face itself, inside the face only, when the library sends none.
//   - Sharp edges come from the topology: every edge between two CAD faces,
//     found by position (welded at 1e-5 of the size of the mesh), whatever the
//     angle. An edge a face meets twice (the seam of a cylinder) is not one.
//   - Colours (linear RGB from the library) become SIMPLE instances, one per
//     distinct colour, as I3 does for the colours of mesh formats; a face with
//     its own colour becomes a face-material range; a part without a colour
//     gets the neutral Default.

import { ImportError, payloadSize, type ImportMessage, type ImportUnit } from '../core/import-options';
import { defaultInstance, plainInstance, type MaterialId, type MaterialInstance } from '../core/materials';
import { AREA_EPSILON, KeyTable, registerMesh, WELD_TOLERANCE, weldIds, type MeshData, type TriangleRange } from '../core/meshes';
import type { FaceRange, NodeId, SceneNode } from '../core/scene';
import type { ReadResult } from './gltf';
import type { OcctMesh, OcctNode, OcctResult } from './occt-protocol';

export interface CadConvertOptions {
  fileName: string;
  /** Format name for the MODEL's source and the mesh ids. */
  format: 'STEP' | 'IGES';
  /** The unit the numbers of the result are in (what the reader asked the library for). */
  units: ImportUnit;
  /** Notes the reader already has (a unit the sheet does not offer, converted). */
  notes?: ImportMessage[];
}

/** The geometry of one mesh of the library, ready to register, with its faces. */
export interface CadMesh {
  data: MeshData;
  /** One run per CAD face that kept triangles, in the order of the file. */
  faces: TriangleRange[];
  /** For each run of `faces`, the face's own colour (linear RGB) or null. */
  faceColors: (readonly number[] | null)[];
  /** Faces the library left without triangles. */
  emptyFaces: number;
  /** Triangles dropped: degenerate, or pointing at vertices that do not exist. */
  dropped: number;
}

let importCounter = 0;

const finite3 = (a: ArrayLike<number>, i: number) => Number.isFinite(a[i]) && Number.isFinite(a[i + 1]) && Number.isFinite(a[i + 2]);

/**
 * One mesh of the library as a MeshData whose CAD faces own their vertices. Null when no triangle survives.
 * Positions are left where the library put them (the caller re-centres). Typed arrays throughout: a CAD file
 * tessellated finely is millions of triangles, and this runs on the main thread.
 */
export function cadMesh(mesh: OcctMesh): CadMesh | null {
  const P = mesh.attributes.position.array;
  const N = mesh.attributes.normal?.array;
  const I = mesh.index.array;
  const V = Math.floor(P.length / 3);
  const T = Math.floor(I.length / 3);
  const hasNormals = !!N && N.length === P.length;

  // The faces as the library numbers them, and whatever triangles no face claims as one more face.
  const claimed = new Uint8Array(T);
  const ranges: { first: number; last: number; color: readonly number[] | null }[] = [];
  let emptyFaces = 0;
  for (const f of mesh.brep_faces) {
    const first = Math.max(0, f.first);
    const last = Math.min(T - 1, f.last);
    if (last < first) {
      emptyFaces++;
      continue;
    }
    ranges.push({ first, last, color: f.color && f.color.length >= 3 ? f.color : null });
    claimed.fill(1, first, last + 1);
  }
  const loose: number[] = [];
  for (let t = 0; t < T; t++) if (!claimed[t]) loose.push(t);
  const faceTris: { tris: (i: number) => number; count: number; color: readonly number[] | null }[] = ranges.map((r) => ({ tris: (i: number) => r.first + i, count: r.last - r.first + 1, color: r.color }));
  if (loose.length > 0) faceTris.push({ tris: (i: number) => loose[i], count: loose.length, color: null });

  // A vertex two faces use has one normal for both: those faces get normals of their own (computed below).
  // Every face runs over its triangles in one go, so "seen last in another face" is "a new face uses it".
  const lastFace = new Int32Array(V).fill(-1);
  const shared = new Uint8Array(V);
  let copies = 0;
  faceTris.forEach((f, fi) => {
    for (let i = 0; i < f.count; i++) {
      const t = f.tris(i);
      for (let j = 0; j < 3; j++) {
        const v = I[3 * t + j];
        if (!(v < V) || lastFace[v] === fi) continue;
        if (lastFace[v] >= 0) shared[v] = 1;
        lastFace[v] = fi;
        copies++;
      }
    }
  });

  // Size of the mesh, for the area threshold and the welding tolerance.
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let v = 0; v < V; v++) {
    if (!finite3(P, 3 * v)) continue;
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], P[3 * v + k]);
      hi[k] = Math.max(hi[k], P[3 * v + k]);
    }
  }
  if (!Number.isFinite(lo[0])) return null;
  const size = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
  const areaMin = AREA_EPSILON * size * size;

  // Each (face, vertex) pair is one output vertex: `copies` of them at most.
  const positions = new Float32Array(3 * copies);
  const normals = new Float32Array(3 * copies);
  const srcOf = new Int32Array(copies);
  const indices = new Uint32Array(3 * T);
  const stamp = new Int32Array(V).fill(-1);
  const remap = new Int32Array(V);
  let nv = 0;
  let nt = 0;
  const faces: TriangleRange[] = [];
  const faceColors: (readonly number[] | null)[] = [];
  let dropped = 0;
  /** The output vertex of source vertex `src` in face `fi`, made the first time the face uses it. */
  const vertexOf = (src: number, fi: number): number => {
    if (stamp[src] !== fi) {
      stamp[src] = fi;
      remap[src] = nv;
      srcOf[nv] = src;
      positions[3 * nv] = P[3 * src];
      positions[3 * nv + 1] = P[3 * src + 1];
      positions[3 * nv + 2] = P[3 * src + 2];
      nv++;
    }
    return remap[src];
  };

  faceTris.forEach((f, fi) => {
    const start = nt;
    const firstVertex = nv;
    for (let i = 0; i < f.count; i++) {
      const t = f.tris(i);
      const a = I[3 * t];
      const b = I[3 * t + 1];
      const c = I[3 * t + 2];
      if (!(a < V && b < V && c < V) || a === b || b === c || a === c || !finite3(P, 3 * a) || !finite3(P, 3 * b) || !finite3(P, 3 * c)) {
        dropped++;
        continue;
      }
      const ux = P[3 * b] - P[3 * a];
      const uy = P[3 * b + 1] - P[3 * a + 1];
      const uz = P[3 * b + 2] - P[3 * a + 2];
      const vx = P[3 * c] - P[3 * a];
      const vy = P[3 * c + 1] - P[3 * a + 1];
      const vz = P[3 * c + 2] - P[3 * a + 2];
      if (!(Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) > areaMin)) {
        dropped++;
        continue;
      }
      indices[3 * nt] = vertexOf(a, fi);
      indices[3 * nt + 1] = vertexOf(b, fi);
      indices[3 * nt + 2] = vertexOf(c, fi);
      nt++;
    }
    const count = nt - start;
    if (count === 0) {
      emptyFaces++;
      return;
    }
    // Normals: the library's (averaged inside the face) when it sent them for every vertex, they are usable and
    // no other face shares the vertex.
    let usable = hasNormals;
    for (let r = firstVertex; usable && r < nv; r++) {
      const src = srcOf[r];
      const x = N![3 * src];
      const y = N![3 * src + 1];
      const z = N![3 * src + 2];
      const l = Math.hypot(x, y, z);
      if (shared[src] || !(l > 1e-12) || !Number.isFinite(l)) {
        usable = false;
        break;
      }
      normals[3 * r] = x / l + 0;
      normals[3 * r + 1] = y / l + 0;
      normals[3 * r + 2] = z / l + 0;
    }
    if (!usable) faceNormals(positions, normals, indices, start, count, firstVertex, nv);
    faces.push({ start, count });
    faceColors.push(f.color);
  });
  if (nt === 0) return null;

  const data: MeshData = { positions: positions.slice(0, 3 * nv), normals: normals.slice(0, 3 * nv), indices: indices.slice(0, 3 * nt) };
  data.sharpEdges = faceBorders(data, faces, WELD_TOLERANCE * size);
  return { data, faces, faceColors, emptyFaces, dropped };
}

/** Angle-weighted normals of the triangles `start .. start + count`, whose vertices are `firstVertex .. endVertex`. */
function faceNormals(positions: Float32Array, normals: Float32Array, indices: Uint32Array, start: number, count: number, firstVertex: number, endVertex: number): void {
  normals.fill(0, 3 * firstVertex, 3 * endVertex);
  const at = (v: number, k: number) => positions[3 * v + k];
  for (let t = start; t < start + count; t++) {
    const tri = [indices[3 * t], indices[3 * t + 1], indices[3 * t + 2]];
    const e = (i: number, j: number) => [at(tri[j], 0) - at(tri[i], 0), at(tri[j], 1) - at(tri[i], 1), at(tri[j], 2) - at(tri[i], 2)];
    const u = e(0, 1);
    const w = e(0, 2);
    const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    const len = Math.hypot(n[0], n[1], n[2]) || 1;
    for (let j = 0; j < 3; j++) {
      const p = e(j, (j + 1) % 3);
      const q = e(j, (j + 2) % 3);
      const angle = Math.atan2(Math.hypot(p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]), p[0] * q[0] + p[1] * q[1] + p[2] * q[2]);
      for (let k = 0; k < 3; k++) normals[3 * tri[j] + k] += (n[k] / len) * angle;
    }
  }
  for (let v = firstVertex; v < endVertex; v++) {
    const l = Math.hypot(normals[3 * v], normals[3 * v + 1], normals[3 * v + 2]);
    if (l > 0) for (let k = 0; k < 3; k++) normals[3 * v + k] = normals[3 * v + k] / l + 0;
    else normals[3 * v + 2] = 1;
  }
}

/** An Int32Array of at least `n` entries holding what `a` held (the rest `fill`). */
function grown(a: Int32Array<ArrayBuffer>, n: number, fill: number): Int32Array<ArrayBuffer> {
  if (n <= a.length) return a;
  const next = new Int32Array(Math.max(n, 2 * a.length)).fill(fill);
  next.set(a);
  return next;
}

/** Calls `fn` for every edge of the triangles of a face, with its vertices and its key by welded position. */
function forEdges(data: MeshData, f: TriangleRange, ids: Int32Array, table: KeyTable, fn: (key: number, a: number, b: number) => void): void {
  for (let t = f.start; t < f.start + f.count; t++) {
    for (let j = 0; j < 3; j++) {
      const a = data.indices[3 * t + j];
      const b = data.indices[3 * t + ((j + 1) % 3)];
      const wa = ids[a];
      const wb = ids[b];
      if (wa !== wb) fn(table.getOrAdd(Math.min(wa, wb), Math.max(wa, wb)), a, b);
    }
  }
}

/**
 * The edges between two CAD faces, as pairs of vertex indices of one of the faces (`MeshData.sharpEdges`).
 * Edges are matched by welded position, so the two faces' own copies of the vertices meet. Inside a face an
 * edge used once is on its border, twice is inside it (the seam of a cylinder is used twice too).
 */
function faceBorders(data: MeshData, faces: readonly TriangleRange[], tol: number): Uint32Array {
  const { ids } = weldIds(data.positions, tol);
  const T = data.indices.length / 3;
  const table = new KeyTable(2, Math.min(3 * T, 1 << 20));
  // Per edge key: the face that touched it last and how often it did; the first face that has it on its
  // border (the owner); whether another face has it on its border too.
  let lastFace = new Int32Array(Math.max(16, 2 * T)).fill(-1);
  let uses = new Int32Array(lastFace.length);
  let owner = new Int32Array(lastFace.length).fill(-1);
  let sharp = new Int32Array(lastFace.length);
  const touched: number[] = [];
  faces.forEach((f, fi) => {
    touched.length = 0;
    forEdges(data, f, ids, table, (key) => {
      if (key >= lastFace.length) {
        lastFace = grown(lastFace, key + 1, -1);
        uses = grown(uses, key + 1, 0);
        owner = grown(owner, key + 1, -1);
        sharp = grown(sharp, key + 1, 0);
      }
      if (lastFace[key] === fi) {
        uses[key]++;
        return;
      }
      lastFace[key] = fi;
      uses[key] = 1;
      touched.push(key);
    });
    for (const key of touched) {
      if (uses[key] !== 1) continue;
      if (owner[key] < 0) owner[key] = fi;
      else if (owner[key] !== fi) sharp[key] = 1;
    }
  });
  // The pairs, read from the owner's own triangles (lower vertex first), in the order of the keys.
  const slot = new Int32Array(table.count).fill(-1);
  let n = 0;
  for (let key = 0; key < table.count; key++) if (sharp[key]) slot[key] = n++;
  const pairs = new Uint32Array(2 * n);
  const done = new Uint8Array(n);
  faces.forEach((f, fi) => {
    forEdges(data, f, ids, table, (key, a, b) => {
      const i = slot[key];
      if (i < 0 || done[i] || owner[key] !== fi) return;
      done[i] = 1;
      pairs[2 * i] = Math.min(a, b);
      pairs[2 * i + 1] = Math.max(a, b);
    });
  });
  return pairs;
}

// --- Materials ------------------------------------------------------------------------------------

const toSrgb = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
const hex = (c: number) => Math.round(Math.min(1, Math.max(0, toSrgb(c))) * 255).toString(16).padStart(2, '0').toUpperCase();

/** The name of a colour instance: its sRGB value, as a colour picker writes it. */
export function colorName(rgb: readonly number[]): string {
  return `#${hex(rgb[0])}${hex(rgb[1])}${hex(rgb[2])}`;
}

// --- The tree ---------------------------------------------------------------------------------------

/**
 * The library's result for a file as the payload of a reader (in the units the library was asked for, Z up).
 * Throws ImportError 'unreadable' for a failed result and 'empty' for a file without anything to show.
 */
export function occtToPayload(result: OcctResult, o: CadConvertOptions): ReadResult {
  if (!result.success || !result.root || !result.meshes) throw new ImportError('unreadable');
  const run = ++importCounter;
  const nodes: Record<NodeId, SceneNode> = {};
  const materials: Record<MaterialId, MaterialInstance> = {};
  const warnings: ImportMessage[] = [];
  let emptyFaces = 0;
  let n = 0;
  const newId = (): NodeId => `t${++n}`;
  const base = (id: NodeId, name: string, kind: SceneNode['kind']): SceneNode => ({
    id,
    name,
    kind,
    parent: null,
    children: [],
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    visible: true,
    locked: false,
  });

  // One instance per distinct colour (to 1e-4), named after it; no colour is the neutral Default.
  const byColor = new Map<string, MaterialId>();
  const materialFor = (rgb: readonly number[] | null): MaterialId => {
    if (!rgb) {
      materials.tm_default ??= defaultInstance('tm_default', 100);
      return 'tm_default';
    }
    const c = [0, 1, 2].map((k) => Math.min(1, Math.max(0, Number.isFinite(rgb[k]) ? rgb[k] : 0)));
    const key = c.map((x) => Math.round(x * 1e4)).join(',');
    let id = byColor.get(key);
    if (!id) {
      id = `tm${byColor.size + 1}`;
      materials[id] = plainInstance(id, colorName(c), { baseColor: [c[0], c[1], c[2], 1], metallic: 0, roughness: 0.5 });
      byColor.set(key, id);
    }
    return id;
  };

  const link = (parent: SceneNode, kids: readonly NodeId[]): void => {
    for (const k of kids) {
      nodes[k].parent = parent.id;
      parent.children.push(k);
    }
  };

  const makePart = (meshIndex: number, name: string): NodeId | null => {
    const mesh = result.meshes![meshIndex];
    if (!mesh) return null;
    const built = cadMesh(mesh);
    const label = name || mesh.name || `Part ${n + 1}`;
    if (!built) {
      emptyFaces += mesh.brep_faces.length;
      return null;
    }
    emptyFaces += built.emptyFaces;
    if (built.dropped > 0) warnings.push({ code: 'degenerate', params: { part: label, count: built.dropped } });

    // The part's material: the colour of the solid, else the colour most of its triangles have.
    const own: readonly number[] | null = mesh.color && mesh.color.length >= 3 ? mesh.color : null;
    let partColor: readonly number[] | null = own;
    const colorOfFace = built.faceColors.map((c) => c ?? own);
    if (!partColor) {
      const weight = new Map<string, { rgb: readonly number[] | null; n: number }>();
      built.faces.forEach((f, i) => {
        const rgb = colorOfFace[i];
        const k = rgb ? rgb.join(',') : '';
        const w = weight.get(k) ?? weight.set(k, { rgb, n: 0 }).get(k)!;
        w.n += f.count;
      });
      let best = -1;
      for (const w of weight.values()) {
        if (w.n > best) {
          best = w.n;
          partColor = w.rgb;
        }
      }
    }
    const material = materialFor(partColor);
    const faceMaterials: FaceRange[] = [];
    built.faces.forEach((f, i) => {
      const m = materialFor(colorOfFace[i]);
      if (m === material) return;
      const last = faceMaterials[faceMaterials.length - 1];
      if (last && last.material === m && last.start + last.count === f.start) last.count += f.count;
      else faceMaterials.push({ start: f.start, count: f.count, material: m });
    });

    // Re-centre on the bounds: the node position carries the offset.
    const p = built.data.positions;
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < p.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        lo[k] = Math.min(lo[k], p[i + k]);
        hi[k] = Math.max(hi[k], p[i + k]);
      }
    }
    const c: [number, number, number] = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
    for (let i = 0; i < p.length; i += 3) {
      p[i] -= c[0];
      p[i + 1] -= c[1];
      p[i + 2] -= c[2];
    }
    const id = newId();
    const node: SceneNode = { ...base(id, label, 'PART'), mesh: registerMesh(`${o.format.toLowerCase()}:${run}:${id}`, built.data), material, smooth: true };
    if (faceMaterials.length > 0) node.faceMaterials = faceMaterials;
    node.faceRanges = built.faces;
    node.transform.position = c;
    nodes[id] = node;
    return id;
  };

  const groupOf = (name: string, kids: NodeId[]): NodeId => {
    const gid = newId();
    nodes[gid] = base(gid, name || `Group ${n}`, 'GROUP');
    link(nodes[gid], kids);
    return gid;
  };

  /** A node of the library's tree as the ids of what it becomes (nothing, a part, or a group). */
  const convert = (node: OcctNode, isRoot: boolean): NodeId[] => {
    const meshes = node.meshes ?? [];
    const children = node.children ?? [];
    if (children.length === 0 && meshes.length === 1 && !isRoot) {
      const part = makePart(meshes[0], node.name);
      return part === null ? [] : [part];
    }
    const kids: NodeId[] = [];
    meshes.forEach((m, i) => {
      const part = makePart(m, result.meshes![m]?.name || (node.name ? `${node.name} ${i + 1}` : ''));
      if (part !== null) kids.push(part);
    });
    for (const child of children) kids.push(...convert(child, false));
    if (isRoot || kids.length === 0) return kids;
    return [groupOf(node.name, kids)];
  };

  const rootKids = convert(result.root, true);
  if (rootKids.length === 0) throw new ImportError('empty');

  const modelId = newId();
  nodes[modelId] = { ...base(modelId, o.fileName.replace(/\.[^.]+$/, '') || o.fileName, 'MODEL'), source: { kind: 'FILE', name: o.fileName, format: o.format } };
  link(nodes[modelId], rootKids);

  const notes: ImportMessage[] = [...(o.notes ?? [])];
  if (emptyFaces > 0) notes.push({ code: 'cadEmptyFaces', params: { count: emptyFaces } });
  const payload = { nodes, roots: [modelId], materials };
  // STEP and IGES declare their units but not an up axis: Z is the convention of CAD (like STL and 3DM).
  const detected = { units: o.units, upAxis: 'Z' as const, upAxisDeclared: false, size: payloadSize(payload), hasLayers: false, hiddenParts: 0 };
  return { ...payload, detected, warnings, notes };
}
