// Whole CAD faces (phase M1): what one click at the Faces level selects, and the pieces "Separate by CAD faces"
// makes. A part read from STEP or IGES keeps its CAD faces as runs of triangles (`SceneNode.faceRanges`, phase
// I2) and those win. Every other mesh has no faces in it, only triangles, so a face is grown from the triangle
// that was hit across the edges where the surface continues (the algorithm of EZ Packshot's phase E2):
//
//   - Adjacency is by the position of the vertices (welded within 1e-5 of the size of the mesh), not by index:
//     the tessellators of STEP, OBJ and STL duplicate vertices along seams, and the triangles on both sides of
//     a seam touch without sharing an index.
//   - An edge is crossed when the dihedral angle between the two triangles is smaller than the live-edge angle
//     (30 degrees) AND smaller than 2.5 times the curvature of the face that was hit. The curvature is the
//     smallest dihedral that is not flat among the edges of the triangle that was hit; a flat face has none, so
//     it stops at the first fillet; the wall of a cylinder has a constant one, so it is taken whole and stops
//     at its caps. The angle is measured between the triangle being left and the one being entered, so a
//     curved face is followed facet by facet.
//   - An edge the mesh marks as hard (`MeshData.sharpEdges`) is never crossed.
//
// One change to EZ Packshot's version: its estimate of the curvature also counted the edges that are boundaries
// (marked, or sharper than the live-edge angle), so a triangle at the rim of a flat face, next to a wall,
// measured the curvature of the corner and the face leaked across a chamfer; here only edges that could be
// crossed count, and a flat face is flat all the way to its rim.
//
// What a click on a mesh cannot tell (it only sees the triangles around it): a triangle at the rim of a flat face
// whose only turning edge is a gentle blend (a fillet of a few degrees a step) looks like a facet of a curved
// face, and the face then follows the blend; the interior of the same flat face does not. The CAD faces of a STEP
// or IGES part (ranges) have no such doubt, which is why they win.

import type { MaterialId } from './materials';
import { triangleMaterials } from './materials';
import { weldIds, type MeshData, type TriangleRange } from './meshes';
import type { FaceRange, SceneNode } from './scene';

/** Below this angle (degrees) two triangles are coplanar. */
export const FACE_FLAT_DEG = 1;
/** Default live-edge angle (degrees): a sharper edge is the border of a face. */
export const LIVE_EDGE_DEG = 30;
/** How many times its own curvature a face may turn at an edge and still continue. */
export const CURVATURE_FACTOR = 2.5;
/** Positions closer than this fraction of the diagonal of the mesh are the same vertex. */
export const FACE_WELD = 1e-5;

const DEG = 180 / Math.PI;

/** What the growth needs about a mesh, built once per mesh and kept while the mesh is alive. */
interface Topology {
  triangles: number;
  /** Unit normal of each triangle (3 per triangle); `valid` says which have one (a sliver has none). */
  normals: Float64Array;
  valid: Uint8Array;
  /** The edge (index into the arrays below) of each side of each triangle: 3 per triangle. */
  triEdge: Int32Array;
  /** The triangles that meet along an edge: the first two, and the rest (a non-manifold edge has more). */
  first: Int32Array;
  second: Int32Array;
  extra: Map<number, number[]>;
  /** The mesh marks the edge as hard. */
  live: Uint8Array;
}

const topologies = new WeakMap<MeshData, Topology>();

function buildTopology(data: MeshData): Topology {
  const T = Math.floor(data.indices.length / 3);
  const V = Math.floor(data.positions.length / 3);
  // The size of the mesh: the diagonal of its box.
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let v = 0; v < V; v++) {
    for (let k = 0; k < 3; k++) {
      const x = data.positions[3 * v + k];
      if (x < min[k]) min[k] = x;
      if (x > max[k]) max[k] = x;
    }
  }
  const diagonal = V > 0 ? Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) : 0;
  const weld = weldIds(data.positions, Math.max(diagonal, 1e-9) * FACE_WELD);
  const W = Math.max(1, weld.count);

  const normals = new Float64Array(3 * T);
  const valid = new Uint8Array(T);
  const triEdge = new Int32Array(3 * T);
  const table = new Map<number, number>();
  const first: number[] = [];
  const second: number[] = [];
  const extra = new Map<number, number[]>();
  for (let t = 0; t < T; t++) {
    const ia = data.indices[3 * t];
    const ib = data.indices[3 * t + 1];
    const ic = data.indices[3 * t + 2];
    const ax = data.positions[3 * ia];
    const ay = data.positions[3 * ia + 1];
    const az = data.positions[3 * ia + 2];
    const ux = data.positions[3 * ib] - ax;
    const uy = data.positions[3 * ib + 1] - ay;
    const uz = data.positions[3 * ib + 2] - az;
    const wx = data.positions[3 * ic] - ax;
    const wy = data.positions[3 * ic + 1] - ay;
    const wz = data.positions[3 * ic + 2] - az;
    const nx = uy * wz - uz * wy;
    const ny = uz * wx - ux * wz;
    const nz = ux * wy - uy * wx;
    const len = Math.hypot(nx, ny, nz);
    // A sliver (no area) has no normal: it joins nothing and nothing joins it through an angle.
    if (len > 1e-12 && Number.isFinite(len)) {
      normals[3 * t] = nx / len;
      normals[3 * t + 1] = ny / len;
      normals[3 * t + 2] = nz / len;
      valid[t] = 1;
    }
    for (let j = 0; j < 3; j++) {
      const a = weld.ids[data.indices[3 * t + j]];
      const b = weld.ids[data.indices[3 * t + ((j + 1) % 3)]];
      const key = a < b ? a * W + b : b * W + a;
      let e = table.get(key);
      if (e === undefined) {
        e = first.length;
        table.set(key, e);
        first.push(t);
        second.push(-1);
      } else {
        if (second[e] < 0) second[e] = t;
        else (extra.get(e) ?? extra.set(e, []).get(e)!).push(t);
      }
      triEdge[3 * t + j] = e;
    }
  }

  // The edges the mesh marks as hard, found by position like everything else.
  const live = new Uint8Array(first.length);
  const sharp = data.sharpEdges;
  if (sharp && sharp.length > 0) {
    for (let s = 0; s + 1 < sharp.length; s += 2) {
      const a = weld.ids[sharp[s]];
      const b = weld.ids[sharp[s + 1]];
      if (a === undefined || b === undefined) continue;
      const e = table.get(a < b ? a * W + b : b * W + a);
      if (e !== undefined) live[e] = 1;
    }
  }
  return { triangles: T, normals, valid, triEdge, first: Int32Array.from(first), second: Int32Array.from(second), extra, live };
}

function topologyOf(data: MeshData): Topology {
  let topo = topologies.get(data);
  if (!topo) topologies.set(data, (topo = buildTopology(data)));
  return topo;
}

/** The triangles that share edge `e` with triangle `t`, other than `t`. */
function across(topo: Topology, e: number, t: number, visit: (other: number) => void): void {
  const a = topo.first[e];
  if (a !== t) visit(a);
  const b = topo.second[e];
  if (b >= 0 && b !== t) visit(b);
  const more = topo.extra.get(e);
  if (more) for (const o of more) if (o !== t) visit(o);
}

function cosBetween(topo: Topology, a: number, b: number): number {
  const n = topo.normals;
  return n[3 * a] * n[3 * b] + n[3 * a + 1] * n[3 * b + 1] + n[3 * a + 2] * n[3 * b + 2];
}

/** The angle between two triangles in degrees: 0 is coplanar, 180 a fold. Triangles without a normal count as 180. */
function dihedralDeg(topo: Topology, a: number, b: number): number {
  if (!topo.valid[a] || !topo.valid[b]) return 180;
  return Math.acos(Math.max(-1, Math.min(1, cosBetween(topo, a, b)))) * DEG;
}

/**
 * How much the face under triangle `tri` turns: the smallest dihedral, not flat, among its edges that could be
 * crossed. Zero for a flat face.
 */
function ownCurvature(topo: Topology, tri: number, liveDeg: number): number {
  let best = 0;
  for (let j = 0; j < 3; j++) {
    const e = topo.triEdge[3 * tri + j];
    if (topo.live[e]) continue;
    across(topo, e, tri, (o) => {
      const d = dihedralDeg(topo, tri, o);
      if (d > liveDeg || d <= FACE_FLAT_DEG) return;
      if (best === 0 || d < best) best = d;
    });
  }
  return best;
}

/** The limit, in degrees, below which an edge is crossed when the face that was hit turns `curvature` degrees. */
export function crossingLimitDeg(curvature: number, liveDeg: number = LIVE_EDGE_DEG): number {
  return Math.min(Math.max(liveDeg, 0), Math.max(FACE_FLAT_DEG, curvature * CURVATURE_FACTOR));
}

export interface FaceOptions {
  /** The CAD faces of the part (STEP, IGES): the run that holds the triangle is the face. */
  faceRanges?: readonly TriangleRange[];
  /** Edges sharper than this (degrees) are the border of a face. Default 30. */
  liveEdgeDeg?: number;
}

/** The run of `ranges` that holds triangle `tri`, when there is one inside a mesh of `triangles`. */
function rangeAt(ranges: readonly TriangleRange[], tri: number, triangles: number): TriangleRange | null {
  for (const r of ranges) if (tri >= r.start && tri < r.start + r.count && r.start + r.count <= triangles) return r;
  return null;
}

/**
 * The triangles of the whole face that triangle `tri` belongs to, ascending. With the CAD faces of the part it is
 * the run that holds the triangle; without them (or when none does) the face is grown by continuity of the
 * surface, see the header. An index outside the mesh gives nothing.
 */
export function cadFaceRegion(data: MeshData, tri: number, opts: FaceOptions = {}): number[] {
  const T = Math.floor(data.indices.length / 3);
  if (!Number.isInteger(tri) || tri < 0 || tri >= T) return [];
  const run = opts.faceRanges ? rangeAt(opts.faceRanges, tri, T) : null;
  if (run) return Array.from({ length: run.count }, (_, k) => run.start + k);
  return continuityRegion(data, tri, opts.liveEdgeDeg ?? LIVE_EDGE_DEG);
}

function continuityRegion(data: MeshData, tri: number, liveDeg: number): number[] {
  const topo = topologyOf(data);
  if (!topo.valid[tri]) return [tri];
  const limit = crossingLimitDeg(ownCurvature(topo, tri, liveDeg), liveDeg);
  const cosLimit = Math.cos((limit + 1e-6) / DEG);
  const seen = new Uint8Array(topo.triangles);
  seen[tri] = 1;
  const out: number[] = [tri];
  const stack: number[] = [tri];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    for (let j = 0; j < 3; j++) {
      const e = topo.triEdge[3 * cur + j];
      if (topo.live[e]) continue;
      across(topo, e, cur, (o) => {
        if (seen[o] || !topo.valid[o]) return;
        if (cosBetween(topo, cur, o) < cosLimit) return;
        seen[o] = 1;
        out.push(o);
        stack.push(o);
      });
    }
  }
  return out.sort((a, b) => a - b);
}

/** The faces of a part, for the places that only have the node (the selection, a drop). Empty without geometry. */
export function faceOfNode(node: SceneNode, data: MeshData | undefined, tri: number, opts: Omit<FaceOptions, 'faceRanges'> = {}): number[] {
  if (!data) return [tri];
  return cadFaceRegion(data, tri, { ...opts, faceRanges: node.faceRanges });
}

// --- Separate by CAD faces ------------------------------------------------------------------

/** A part of a part: its triangles (ascending), its name and its materials. */
export interface FacePiece {
  tris: number[];
  name: string;
  material: MaterialId | null;
  faceMaterials: FaceRange[];
}

/** The CAD faces when they cover every triangle once, in order (anything else would lose triangles), else null. */
export function coveringRanges(ranges: readonly TriangleRange[] | undefined, triangles: number): TriangleRange[] | null {
  if (!ranges || ranges.length === 0) return null;
  let next = 0;
  for (const r of ranges) {
    if (r.start !== next || r.count < 1) return null;
    next += r.count;
  }
  return next === triangles ? [...ranges] : null;
}

/**
 * One piece per CAD face of a part that carries them, named after the part and numbered; a CAD face has one
 * colour, but should it have more, the first is the piece's and the rest stay as its face materials. Nothing
 * for a part without CAD faces, or whose faces do not cover the mesh.
 */
export function facePieces(node: SceneNode): FacePiece[] {
  if (!node.mesh) return [];
  const faces = coveringRanges(node.faceRanges, node.mesh.triangles);
  if (!faces) return [];
  const per = triangleMaterials(node);
  return faces.map((f, i) => {
    const tris = Array.from({ length: f.count }, (_, k) => f.start + k);
    const material = per[tris[0]] ?? null;
    const faceMaterials: FaceRange[] = [];
    tris.forEach((t, k) => {
      const m = per[t];
      if (m === material || !m) return;
      const last = faceMaterials[faceMaterials.length - 1];
      if (last && last.material === m && last.start + last.count === k) last.count++;
      else faceMaterials.push({ start: k, count: 1, material: m });
    });
    return { tris, name: `${node.name} ${i + 1}`, material, faceMaterials };
  });
}

/** Some part carries CAD faces that "Separate by CAD faces" can cut (two or more). */
export function canSeparateByFaces(node: SceneNode): boolean {
  return node.kind === 'PART' && !!node.mesh && (coveringRanges(node.faceRanges, node.mesh.triangles)?.length ?? 0) >= 2;
}
