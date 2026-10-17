// Which meshes are closed solids (phase Q1, the section view), as the engine decides it (rt-core `geometry::solid`):
// a section caps what it cuts only where the cut goes through the inside of a solid, and only a closed surface has an
// inside. After welding the vertices that share a position (a seam, split normals and UV islands do not open a mesh),
// every edge of every triangle that has an area must be shared by exactly two triangles that run along it in opposite
// directions; the volume the surface encloses (the divergence theorem, about the mesh's centre) must be positive, which
// is a winding counter-clockwise seen from outside. Anything else (a sheet, a cup without a lid, a model with holes,
// a non-manifold join, a flipped triangle, an inside-out solid) is not capped and shows its inside.
//
// The Fast preview draws the cap of exactly the meshes this says yes to, so the engine and the preview cap the same
// parts. Pure and cached per mesh: no three.js, no DOM.

import type { MeshData } from './meshes';

/** Vertices closer than this fraction of the mesh's largest extent, on every axis, are one (the engine's weld). */
export const WELD_TOLERANCE = 1e-5;
/** A volume under this fraction of the cube of the mesh's size is no volume. */
const MIN_VOLUME = 1e-9;

const cache = new WeakMap<MeshData, boolean>();
const orientations = new WeakMap<MeshData, Orientation>();

/** True when the mesh is a closed solid wound counter-clockwise seen from outside (the cached answer). */
export function isClosedSolid(data: MeshData): boolean {
  let known = cache.get(data);
  if (known === undefined) {
    known = analyse(data.positions, data.indices);
    cache.set(data, known);
  }
  return known;
}

/**
 * Which way a closed surface faces (K1, the interior Doctor's inverted normals): OUTWARD when it is a closed manifold wound
 * counter-clockwise seen from outside (what `isClosedSolid` accepts), INWARD when it is the same surface wound the other
 * way (a solid turned inside out, or a room whose walls face its inside), OPEN for anything that is not a closed manifold
 * (a sheet, a model with holes, a non-manifold join) and for a surface that encloses no volume. In the mesh's own space:
 * a part whose transform mirrors it (a negative determinant) faces the other way in the world. Cached per mesh.
 */
export type Orientation = 'OUTWARD' | 'INWARD' | 'OPEN';

export function solidOrientation(data: MeshData): Orientation {
  let known = orientations.get(data);
  if (known === undefined) {
    const r = analyseVolume(data.positions, data.indices);
    const min = r ? r.extent * r.extent * r.extent * MIN_VOLUME : 0;
    known = !r || !Number.isFinite(r.volume) ? 'OPEN' : r.volume > min ? 'OUTWARD' : r.volume < -min ? 'INWARD' : 'OPEN';
    orientations.set(data, known);
  }
  return known;
}

/** The uncached rule on plain arrays (the tests call it with the hand-made meshes of the engine's tests). */
export function analyse(positions: ArrayLike<number>, indices: ArrayLike<number>): boolean {
  const r = analyseVolume(positions, indices);
  return r !== null && Number.isFinite(r.volume) && r.volume > r.extent * r.extent * r.extent * MIN_VOLUME;
}

/**
 * The volume a surface encloses, signed (positive: wound counter-clockwise seen from outside), and the extent it was measured
 * against; null when the surface is not a closed manifold (every welded edge shared by exactly two triangles that run along
 * it in opposite directions).
 */
function analyseVolume(positions: ArrayLike<number>, indices: ArrayLike<number>): { volume: number; extent: number } | null {
  const n = Math.floor(positions.length / 3);
  const triangles = Math.floor(indices.length / 3);
  if (n === 0 || triangles === 0) return null;
  const weld = weldIds(positions, n);
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], positions[i * 3 + k]);
      hi[k] = Math.max(hi[k], positions[i * 3 + k]);
    }
  }
  const centre = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
  const extent = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
  // The directed edges of the triangles that count: smaller id, larger id, runs upwards (packed for sorting).
  const edges: number[] = [];
  const edgeKey = (a: number, b: number, up: boolean) => (a * n + b) * 2 + (up ? 1 : 0);
  let volume = 0;
  for (let t = 0; t < triangles; t++) {
    const ia = indices[t * 3];
    const ib = indices[t * 3 + 1];
    const ic = indices[t * 3 + 2];
    if (!(ia < n && ib < n && ic < n)) continue;
    const w = [weld[ia], weld[ib], weld[ic]];
    if (w[0] === w[1] || w[1] === w[2] || w[2] === w[0]) continue;
    const p = [ia, ib, ic].map((i) => [positions[i * 3] - centre[0], positions[i * 3 + 1] - centre[1], positions[i * 3 + 2] - centre[2]]);
    const e1 = [p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]];
    const e2 = [p[2][0] - p[0][0], p[2][1] - p[0][1], p[2][2] - p[0][2]];
    const cx = e1[1] * e2[2] - e1[2] * e2[1];
    const cy = e1[2] * e2[0] - e1[0] * e2[2];
    const cz = e1[0] * e2[1] - e1[1] * e2[0];
    if (cx * cx + cy * cy + cz * cz <= 0) continue;
    for (let k = 0; k < 3; k++) {
      const from = w[k];
      const to = w[(k + 1) % 3];
      edges.push(edgeKey(Math.min(from, to), Math.max(from, to), from < to));
    }
    // p0 · (p1 × p2) about the centre.
    const q1 = p[1];
    const q2 = p[2];
    volume += p[0][0] * (q1[1] * q2[2] - q1[2] * q2[1]) + p[0][1] * (q1[2] * q2[0] - q1[0] * q2[2]) + p[0][2] * (q1[0] * q2[1] - q1[1] * q2[0]);
  }
  if (edges.length === 0 || edges.length % 2 !== 0) return null;
  edges.sort((a, b) => a - b);
  // Sorted, a whole edge is (…, down), (…, up): the same two ids, the first run upwards-false, the second true.
  for (let i = 0; i < edges.length; i += 2) {
    if (Math.floor(edges[i] / 2) !== Math.floor(edges[i + 1] / 2) || edges[i] % 2 !== 0 || edges[i + 1] % 2 !== 1) return null;
  }
  return { volume: volume / 6, extent };
}

/** The weld id of every vertex: equal positions, then positions within the tolerance on every axis (transitively). */
function weldIds(positions: ArrayLike<number>, n: number): Uint32Array {
  const exact = new Map<string, number>();
  const unique: [number, number, number][] = [];
  const uniqueOf = new Uint32Array(n);
  const f32 = new Float32Array(3);
  const bits = new Uint32Array(f32.buffer);
  for (let i = 0; i < n; i++) {
    f32[0] = positions[i * 3];
    f32[1] = positions[i * 3 + 1];
    f32[2] = positions[i * 3 + 2];
    // -0 is read as 0.
    for (let k = 0; k < 3; k++) if (f32[k] === 0) bits[k] = 0;
    const key = `${bits[0]},${bits[1]},${bits[2]}`;
    let u = exact.get(key);
    if (u === undefined) {
      u = unique.length;
      exact.set(key, u);
      unique.push([positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]]);
    }
    uniqueOf[i] = u;
  }
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (const p of unique) {
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], p[k]);
      hi[k] = Math.max(hi[k], p[k]);
    }
  }
  const extent = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
  const tol = extent * WELD_TOLERANCE;
  const parent = Uint32Array.from(unique.keys());
  const root = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  if (tol > 0 && Number.isFinite(tol)) {
    const cell = 2 * tol;
    const cellOf = (p: readonly number[]): [number, number, number] => [Math.floor((p[0] - lo[0]) / cell), Math.floor((p[1] - lo[1]) / cell), Math.floor((p[2] - lo[2]) / cell)];
    const grid = new Map<string, number[]>();
    unique.forEach((p, i) => {
      const c = cellOf(p);
      const key = `${c[0]},${c[1]},${c[2]}`;
      const list = grid.get(key);
      if (list) list.push(i);
      else grid.set(key, [i]);
    });
    unique.forEach((p, i) => {
      const [cx, cy, cz] = cellOf(p);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dz = -1; dz <= 1; dz++) {
            for (const j of grid.get(`${cx + dx},${cy + dy},${cz + dz}`) ?? []) {
              if (j <= i) continue;
              const q = unique[j];
              if (Math.abs(p[0] - q[0]) <= tol && Math.abs(p[1] - q[1]) <= tol && Math.abs(p[2] - q[2]) <= tol) {
                const a = root(i);
                const b = root(j);
                parent[Math.max(a, b)] = Math.min(a, b);
              }
            }
          }
        }
      }
    });
  }
  const ids = new Uint32Array(n);
  for (let i = 0; i < n; i++) ids[i] = root(uniqueOf[i]);
  return ids;
}
