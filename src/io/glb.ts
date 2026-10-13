// A mesh as a binary glTF (GLB 2.0), for the meshes embedded in .repack.json (ARCHITECTURE §8).
//
// One mesh per file: a scene with one node, the node's mesh with one triangle primitive, and one buffer holding
// POSITION (float32 x3), NORMAL (float32 x3), TEXCOORD_0 (float32 x2, when the mesh has UVs) and the indices
// (uint32), all little endian and tightly packed. The numbers are the registry's own bytes, so a mesh comes back
// bit for bit. The node carries the rotation and scale that stand a Z-up millimetre mesh up in a Y-up metre
// viewer, so a decoded GLB looks right in any other tool; the reader ignores them (the numbers are the mesh).
//
// This is the writer and reader of the subset above, not a general glTF importer (that is `gltf.ts`, which
// leans on three.js and converts axes and units). Hard edges (`sharpEdges`) and the triangle map are not part of
// glTF; the project file keeps them next to the GLB.

import type { MeshData } from '../core/meshes';

const MAGIC = 0x46546c67; // 'glTF'
const CHUNK_JSON = 0x4e4f534a; // 'JSON'
const CHUNK_BIN = 0x004e4942; // 'BIN\0'
const FLOAT = 5126;
const UINT = 5125;
const ARRAY_BUFFER = 34962;
const ELEMENT_ARRAY_BUFFER = 34963;

/** The host stores multi-byte numbers little endian, like the format: typed arrays can be copied as bytes. */
const LITTLE_ENDIAN = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;

/** The part of a mesh a GLB carries. */
export type GlbMesh = Pick<MeshData, 'positions' | 'normals' | 'indices' | 'uvs'>;

const pad4 = (n: number): number => (n + 3) & ~3;

/** Writes a typed array's numbers little endian at `offset`. */
function putFloats(view: DataView, offset: number, a: Float32Array): void {
  if (LITTLE_ENDIAN) new Uint8Array(view.buffer, view.byteOffset + offset, a.byteLength).set(new Uint8Array(a.buffer, a.byteOffset, a.byteLength));
  else for (let i = 0; i < a.length; i++) view.setFloat32(offset + 4 * i, a[i], true);
}
function putUints(view: DataView, offset: number, a: Uint32Array): void {
  if (LITTLE_ENDIAN) new Uint8Array(view.buffer, view.byteOffset + offset, a.byteLength).set(new Uint8Array(a.buffer, a.byteOffset, a.byteLength));
  else for (let i = 0; i < a.length; i++) view.setUint32(offset + 4 * i, a[i], true);
}

/** Unsigned 32-bit numbers as little-endian bytes (the project file keeps hard edges and the triangle map so). */
export function packUint32(a: Uint32Array): Uint8Array {
  if (LITTLE_ENDIAN) return new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  const out = new Uint8Array(a.byteLength);
  const view = new DataView(out.buffer);
  for (let i = 0; i < a.length; i++) view.setUint32(4 * i, a[i], true);
  return out;
}

/** The numbers of little-endian bytes; the length must be a multiple of 4. */
export function unpackUint32(bytes: Uint8Array): Uint32Array {
  if (bytes.length % 4 !== 0) throw new Error('not a list of 32-bit numbers');
  const out = new Uint32Array(bytes.length / 4);
  if (LITTLE_ENDIAN) new Uint8Array(out.buffer).set(bytes);
  else {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let i = 0; i < out.length; i++) out[i] = view.getUint32(4 * i, true);
  }
  return out;
}

/** `name` is the mesh's id; it goes into the node and mesh names so a decoded file says what it is. */
export function meshToGlb(name: string, mesh: GlbMesh): Uint8Array {
  const { positions, normals, indices, uvs } = mesh;
  const streams: { key: string; type: 'VEC3' | 'VEC2' | 'SCALAR'; data: Float32Array | Uint32Array; component: number; target: number }[] = [
    { key: 'POSITION', type: 'VEC3', data: positions, component: FLOAT, target: ARRAY_BUFFER },
    { key: 'NORMAL', type: 'VEC3', data: normals, component: FLOAT, target: ARRAY_BUFFER },
  ];
  if (uvs) streams.push({ key: 'TEXCOORD_0', type: 'VEC2', data: uvs, component: FLOAT, target: ARRAY_BUFFER });
  streams.push({ key: 'indices', type: 'SCALAR', data: indices, component: UINT, target: ELEMENT_ARRAY_BUFFER });

  const per = (type: string) => (type === 'VEC3' ? 3 : type === 'VEC2' ? 2 : 1);
  let binLength = 0;
  const bufferViews = streams.map((s) => {
    const view = { buffer: 0, byteOffset: binLength, byteLength: s.data.byteLength, target: s.target };
    binLength += s.data.byteLength; // every stream is 4-byte numbers: the next one stays aligned
    return view;
  });
  const accessors = streams.map((s, i) => {
    const a: Record<string, unknown> = { bufferView: i, componentType: s.component, count: s.data.length / per(s.type), type: s.type };
    if (s.key === 'POSITION' && positions.length >= 3) {
      // glTF wants the bounds of the positions.
      const min = [Infinity, Infinity, Infinity];
      const max = [-Infinity, -Infinity, -Infinity];
      for (let v = 0; v + 2 < positions.length; v += 3) {
        for (let k = 0; k < 3; k++) {
          const x = positions[v + k];
          if (x < min[k]) min[k] = x;
          if (x > max[k]) max[k] = x;
        }
      }
      a.min = min;
      a.max = max;
    }
    return a;
  });
  const attributes: Record<string, number> = {};
  streams.forEach((s, i) => s.key !== 'indices' && (attributes[s.key] = i));
  const half = Math.SQRT1_2;
  const json = {
    asset: { version: '2.0', generator: 'Repackshot', extras: { up: 'Z', unit: 'mm' } },
    scene: 0,
    scenes: [{ nodes: [0] }],
    // Z-up millimetres to Y-up metres, for other viewers.
    nodes: [{ name, mesh: 0, rotation: [-half, 0, 0, half], scale: [0.001, 0.001, 0.001] }],
    meshes: [{ name, primitives: [{ attributes, indices: streams.length - 1, mode: 4 }] }],
    accessors,
    bufferViews,
    buffers: [{ byteLength: binLength }],
  };
  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonLength = pad4(jsonBytes.length);
  const total = 12 + 8 + jsonLength + 8 + binLength;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, MAGIC, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, CHUNK_JSON, true);
  out.set(jsonBytes, 20);
  out.fill(0x20, 20 + jsonBytes.length, 20 + jsonLength); // JSON is padded with spaces
  const binStart = 20 + jsonLength + 8;
  view.setUint32(binStart - 8, binLength, true);
  view.setUint32(binStart - 4, CHUNK_BIN, true);
  streams.forEach((s, i) => {
    const at = binStart + bufferViews[i].byteOffset;
    if (s.data instanceof Float32Array) putFloats(view, at, s.data);
    else putUints(view, at, s.data);
  });
  return out;
}

// --- Reading -----------------------------------------------------------------------------------------------

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const int = (v: unknown): number | undefined => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : undefined);

/** Reads a GLB written by `meshToGlb`. Throws with a short reason when it is not one, or is damaged. */
export function glbToMesh(bytes: Uint8Array): { name: string; mesh: GlbMesh } {
  if (bytes.length < 20) throw new Error('too short for a GLB');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== MAGIC) throw new Error('not a GLB (bad magic)');
  if (view.getUint32(4, true) !== 2) throw new Error(`GLB version ${view.getUint32(4, true)} is not supported`);
  const total = view.getUint32(8, true);
  if (total > bytes.length) throw new Error('the GLB is cut short');
  let json: unknown;
  let bin: { start: number; length: number } | null = null;
  for (let at = 12; at + 8 <= total; ) {
    const length = view.getUint32(at, true);
    const type = view.getUint32(at + 4, true);
    const start = at + 8;
    if (start + length > total) throw new Error('a GLB chunk runs past the end');
    if (type === CHUNK_JSON && json === undefined) {
      try {
        json = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(start, start + length)));
      } catch {
        throw new Error('the GLB JSON is damaged');
      }
    } else if (type === CHUNK_BIN && bin === null) bin = { start, length };
    at = start + pad4(length);
  }
  if (!isObject(json)) throw new Error('the GLB has no JSON chunk');
  const mesh0 = Array.isArray(json.meshes) ? json.meshes[0] : undefined;
  const prim = isObject(mesh0) && Array.isArray(mesh0.primitives) ? mesh0.primitives[0] : undefined;
  if (!isObject(mesh0) || !isObject(prim) || !isObject(prim.attributes)) throw new Error('the GLB has no triangle mesh');
  if (prim.mode !== undefined && prim.mode !== 4) throw new Error('the GLB mesh is not made of triangles');
  const accessors = json.accessors;
  const views = json.bufferViews;
  if (!Array.isArray(accessors) || !Array.isArray(views)) throw new Error('the GLB has no accessors');
  if (!bin) throw new Error('the GLB has no binary chunk');
  const binary = bin;
  const attributes = prim.attributes;

  /** The numbers of accessor `index`, copied into an array of their own. */
  const read = <T extends Float32Array | Uint32Array>(index: unknown, label: string, component: number, type: string, width: number, make: (n: number) => T): T => {
    const a: unknown = accessors[int(index) ?? -1];
    if (!isObject(a)) throw new Error(`${label}: the accessor is missing`);
    if (a.componentType !== component || a.type !== type) throw new Error(`${label}: unsupported type`);
    if (a.sparse !== undefined) throw new Error(`${label}: sparse accessors are not supported`);
    const bv: unknown = views[int(a.bufferView) ?? -1];
    if (!isObject(bv) || (bv.buffer ?? 0) !== 0) throw new Error(`${label}: no buffer view`);
    if (bv.byteStride !== undefined && bv.byteStride !== width * 4) throw new Error(`${label}: interleaved buffers are not supported`);
    const count = int(a.count);
    const viewStart = int(bv.byteOffset ?? 0);
    const viewLength = int(bv.byteLength);
    const offset = int(a.byteOffset ?? 0);
    if (count === undefined || viewStart === undefined || viewLength === undefined || offset === undefined) throw new Error(`${label}: bad sizes`);
    const size = count * width * 4;
    if (viewStart + viewLength > binary.length || offset + size > viewLength) throw new Error(`${label}: runs past the buffer`);
    const out = make(count * width);
    const src = binary.start + viewStart + offset;
    if (LITTLE_ENDIAN) new Uint8Array(out.buffer).set(bytes.subarray(src, src + size));
    else if (out instanceof Float32Array) for (let i = 0; i < out.length; i++) out[i] = view.getFloat32(src + 4 * i, true);
    else for (let i = 0; i < out.length; i++) out[i] = view.getUint32(src + 4 * i, true);
    return out;
  };

  const positions = read(attributes.POSITION, 'POSITION', FLOAT, 'VEC3', 3, (n) => new Float32Array(n));
  const normals = read(attributes.NORMAL, 'NORMAL', FLOAT, 'VEC3', 3, (n) => new Float32Array(n));
  const uvs = attributes.TEXCOORD_0 === undefined ? undefined : read(attributes.TEXCOORD_0, 'TEXCOORD_0', FLOAT, 'VEC2', 2, (n) => new Float32Array(n));
  const indices = read(prim.indices, 'indices', UINT, 'SCALAR', 1, (n) => new Uint32Array(n));
  return { name: typeof mesh0.name === 'string' ? mesh0.name : '', mesh: { positions, normals, indices, uvs } };
}
