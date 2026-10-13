// Shapes shared by the mesh importers and the STL sniffing. The geometry
// helpers they use (a growable float buffer, a hash table keyed by 32-bit
// words, and `buildMesh`, which turns a triangle soup into an indexed mesh
// with welded vertices, smoothing-angle normals and hard edges) live in
// core/meshes.ts, so the smoothing operation of the scene can use them too,
// and are re-exported here. Readers leave the geometry in the axes and units
// of the file: the import options (core/import-options.ts) turn it into the
// model's Z up and millimetres.

import type { ImportMessage } from '../core/import-options';
import type { MeshData } from '../core/meshes';

export type { ImportMessage, ImportMessageCode } from '../core/import-options';
export { buildMesh, FloatBuffer, KeyTable, SMOOTH_ANGLE_DEG, WELD_TOLERANCE, type BuildOptions, type BuiltMesh, type RawMesh } from '../core/meshes';

// --- Messages and parsed shapes --------------------------------------------------

/** A run of triangles whose material differs from the part's initial one. */
export interface MaterialRange {
  start: number;
  count: number;
  /** Material name, or null for none (the Default material). */
  material: string | null;
}

/** One part as a reader hands it over: geometry in the axes and units of the file. */
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
