// Geometry registry. Mesh data (typed arrays) is large and immutable, so it
// lives here, keyed by id, and the project state only keeps a small `MeshRef`
// (id, counts, local bounds). This keeps `ProjectState` plain JSON
// (ARCHITECTURE §4) while the preview and the importers share the buffers.
// Phase U2 embeds these buffers in `.repack.json` as GLB.

import { emptyBox, type Box } from './math';

export type MeshId = string;

/** Raw triangle mesh in the local space of its part, millimetres, Z up. */
export interface MeshData {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  uvs?: Float32Array;
  /**
   * Hard edges, as pairs of vertex indices (`[a0, b0, a1, b1, ...]`). An edge
   * is hard when the angle between its two faces exceeds the smoothing angle.
   * Each edge appears once; the other face of the edge has the same positions
   * but may use other vertex indices (the vertices are split along hard edges).
   * Importers that cannot tell leave it out.
   */
  sharpEdges?: Uint32Array;
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

/** Stores a mesh under `id` (replacing any previous one) and returns its ref. */
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
