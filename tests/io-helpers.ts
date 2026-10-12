// Helpers for the importer tests: read the parts of an ImportResult back as data.

import { getMesh, type MeshData } from '../src/core/meshes';
import type { SceneNode } from '../src/core/scene';
import type { ImportResult } from '../src/io/import';

export const encode = (text: string): Uint8Array => new TextEncoder().encode(text);

/** The PART nodes of the single model of a result, in file order. */
export function partsOf(result: ImportResult): SceneNode[] {
  const model = result.nodes[result.roots[0]];
  return model.children.map((id) => result.nodes[id]);
}

export function meshOf(node: SceneNode): MeshData {
  return getMesh(node.mesh!.id)!;
}

/** Number of different positions in a mesh (to a thousandth of a unit). */
export function distinctPositions(mesh: MeshData): number {
  const seen = new Set<string>();
  for (let i = 0; i < mesh.positions.length; i += 3) seen.add(`${mesh.positions[i].toFixed(3)},${mesh.positions[i + 1].toFixed(3)},${mesh.positions[i + 2].toFixed(3)}`);
  return seen.size;
}

/** Largest deviation from 1 of the length of any normal. */
export function normalLengthError(mesh: MeshData): number {
  let worst = 0;
  for (let i = 0; i < mesh.normals.length; i += 3) worst = Math.max(worst, Math.abs(Math.hypot(mesh.normals[i], mesh.normals[i + 1], mesh.normals[i + 2]) - 1));
  return worst;
}

/** The sharp edges as [ax, ay, az, bx, by, bz] position pairs, so they can be compared by geometry. */
export function sharpEdgeSegments(mesh: MeshData): number[][] {
  const out: number[][] = [];
  const e = mesh.sharpEdges!;
  const p = mesh.positions;
  for (let i = 0; i < e.length; i += 2) out.push([...p.subarray(3 * e[i], 3 * e[i] + 3), ...p.subarray(3 * e[i + 1], 3 * e[i + 1] + 3)]);
  return out;
}

/** A binary STL from triangles given as 9 numbers each (the facet normal is computed). */
export function binaryStl(triangles: number[][], header = 'binary stl written by the tests'): Uint8Array {
  const out = new Uint8Array(84 + 50 * triangles.length);
  out.set(encode(header).subarray(0, 80), 0);
  const dv = new DataView(out.buffer);
  dv.setUint32(80, triangles.length, true);
  triangles.forEach((t, i) => {
    const o = 84 + 50 * i;
    const u = [t[3] - t[0], t[4] - t[1], t[5] - t[2]];
    const v = [t[6] - t[0], t[7] - t[1], t[8] - t[2]];
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const l = Math.hypot(n[0], n[1], n[2]) || 1;
    n.forEach((x, k) => dv.setFloat32(o + 4 * k, x / l, true));
    t.forEach((x, k) => dv.setFloat32(o + 12 + 4 * k, x, true));
  });
  return out;
}

/** Two rectangular panels meeting along a ridge, `foldDeg` apart in normal direction. Z-up STL axes. */
export function roof(foldDeg: number): number[][] {
  const slope = (foldDeg / 2) * (Math.PI / 180);
  const dx = 10 * Math.cos(slope);
  const dz = -10 * Math.sin(slope);
  // Ridge along x at y = 0; the panels fall away to -y and +y.
  const r1 = [0, 0, 0];
  const r2 = [10, 0, 0];
  const a1 = [0, -dx, dz];
  const a2 = [10, -dx, dz];
  const b1 = [0, dx, dz];
  const b2 = [10, dx, dz];
  return [
    [...r1, ...a1, ...a2],
    [...r1, ...a2, ...r2],
    [...r1, ...r2, ...b2],
    [...r1, ...b2, ...b1],
  ];
}
