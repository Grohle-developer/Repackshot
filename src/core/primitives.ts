// Parametric primitives (phase U9): pure, deterministic generators of the shapes Add ▸ Primitive offers (the
// catalogue is src/data/primitives.json), their parameters, and the id of the mesh each one makes.
//
// Every shape is built in millimetres, Z up, centred on the centre of its bounding box, so it behaves like any
// other part (the Doctor's origin check, the CENTER pivot) and its bounds are exactly its measures: a 200 × 80 × 30
// box spans ±100, ±40, ±15. A shape is made of logical faces (the top, the side, the bevel...), each a run of
// consecutive triangles: they are the part's CAD faces (`SceneNode.faceRanges`, the Faces level of M1 and
// "Separate by CAD faces"), and every edge between two of them is a hard edge (`sharpEdges`), as the CAD readers
// mark them. Inside a face the vertices are shared and the normals are those of the surface (a sphere is smooth
// with any number of segments); across faces the vertices are split, and where two faces meet tangentially (a
// box's bevel, a capsule's caps, the sweep's curve) their normals agree, so the shading is smooth there and hard
// only where the surface turns.
//
// Normals point out of closed shapes (the box, cylinder, pedestal, sphere, cone, torus, capsule, tube and steps
// are watertight: every edge has two triangles) and up or towards the front for the open ones (plane, disc, the
// infinity sweep). Every triangle is wound counter-clockwise seen from the side its normals point to. UVs are in
// [0, 1], per face and without stretching: a face's longer extent spans the unit square (the round side of a
// cylinder wraps around in u once, its caps are projected from above); the infinity sweep is unrolled as one sheet
// from its front edge to the top of the wall.
//
// Angles that are multiples of 90 degrees use exact sines and cosines, and a value that is a measure is never
// recomputed from a difference (`h - b + b`), so faces that meet share their vertices bit for bit and the bounds
// are the measures. Nothing here depends on anything but the parameters: the same spec gives the same bytes.

import { PRIMITIVES, primitiveEntry, type PrimitiveKind, type PrimitiveParamSpec } from '../data/primitives';
import { getMesh, registerMesh, meshRef, weldIds, type MeshData, type MeshId, type MeshRef, type TriangleRange } from './meshes';
import type { Vec3 } from './math';

export type { PrimitiveKind };

/** The measures of a primitive: millimetres and whole counts, by parameter key (the catalogue's). */
export type PrimitiveParams = Record<string, number>;

/** What a parametric part keeps (`SceneNode.primitive`): its shape and its measures. The mesh is made from it. */
export interface PrimitiveSpec {
  kind: PrimitiveKind;
  params: PrimitiveParams;
}

/** A generated shape: the mesh, its logical faces as runs of triangles, and their names (for tests and tools). */
export interface PrimitiveGeometry {
  data: MeshData;
  faceRanges: TriangleRange[];
  faceNames: string[];
}

/** Longest length a measure may have, mm (a kilometre). */
export const PRIMITIVE_LENGTH_MAX = 1e6;
/** The size a scene without anything in it is taken to have, mm (a new project's part size). */
export const DEFAULT_SCENE_MM = 200;

// ---------------------------------------------------------------------------
// Parameters
// ---------------------------------------------------------------------------

/** Lengths are kept to a ten-thousandth of a millimetre (a drag of a field gives no float dust). */
const roundLength = (v: number): number => Math.round(v * 1e4) / 1e4;

function specsOf(kind: PrimitiveKind): readonly PrimitiveParamSpec[] {
  return primitiveEntry(kind)?.params ?? [];
}

function fallback(p: PrimitiveParamSpec, sceneMm: number): number {
  if (p.kind === 'COUNT') return p.default ?? p.min;
  return roundLength(Math.max(p.min, (p.scale ?? 0.25) * sceneMm));
}

/** The measures of a new primitive for a scene of size `sceneMm` (the catalogue's factors). */
export function defaultParams(kind: PrimitiveKind, sceneMm: number = DEFAULT_SCENE_MM): PrimitiveParams {
  const size = sceneMm > 0 && Number.isFinite(sceneMm) ? sceneMm : DEFAULT_SCENE_MM;
  const out: PrimitiveParams = {};
  for (const p of specsOf(kind)) out[p.key] = fallback(p, size);
  return normalizeParams(kind, out);
}

/**
 * Measures that make a valid shape: every parameter of the catalogue present, finite, within its range (lengths to
 * a ten-thousandth of a millimetre, counts whole), and the shape's own limits: a bevel no larger than half the
 * smallest side (box) or than the radius and the height (pedestal), a torus tube no thicker than its radius, a
 * capsule at least as tall as it is wide, a tube's hole smaller than the tube, a sweep's curve inside its floor and
 * its wall. A missing or broken value takes the default for a scene of the default size. Keys the catalogue does
 * not have are dropped.
 */
export function normalizeParams(kind: PrimitiveKind, params: Readonly<Record<string, unknown>>): PrimitiveParams {
  const out: PrimitiveParams = {};
  for (const p of specsOf(kind)) {
    const raw = params[p.key];
    let v = typeof raw === 'number' && Number.isFinite(raw) ? raw : fallback(p, DEFAULT_SCENE_MM);
    if (p.kind === 'COUNT') v = Math.round(v);
    else v = roundLength(v);
    v = Math.max(p.min, Math.min(p.max ?? (p.kind === 'COUNT' ? 1024 : PRIMITIVE_LENGTH_MAX), v));
    out[p.key] = v;
  }
  const clamp = (key: string, max: number) => {
    if (out[key] > max) out[key] = Math.max(0, roundLength(max));
  };
  switch (kind) {
    case 'BOX':
      clamp('bevel', Math.min(out.width, out.depth, out.height) / 2);
      break;
    case 'PEDESTAL':
      clamp('bevel', Math.min(out.radius, out.height));
      break;
    case 'TORUS':
      clamp('tube', out.radius);
      break;
    case 'CAPSULE':
      if (out.height < 2 * out.radius) out.height = roundLength(2 * out.radius);
      break;
    case 'TUBE':
      if (out.inner >= out.radius) out.inner = Math.max(0, roundLength(out.radius - Math.max(0.01, out.radius * 0.01)));
      break;
    case 'SWEEP':
      clamp('radius', Math.min(out.depth, out.height));
      break;
    default:
      break;
  }
  return out;
}

/** Two sets of measures are the same. */
export function sameParams(a: Readonly<PrimitiveParams>, b: Readonly<PrimitiveParams>): boolean {
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => a[k] === b[k]);
}

/** The size of the bounding box a spec makes, mm (X, Y, Z): what the measures promise. */
export function primitiveExtent(spec: PrimitiveSpec): Vec3 {
  const p = spec.params;
  switch (spec.kind) {
    case 'BOX':
    case 'STEPS':
    case 'SWEEP':
      return [p.width, p.depth, p.height];
    case 'PLANE':
      return [p.width, p.depth, 0];
    case 'DISC':
      return [2 * p.radius, 2 * p.radius, 0];
    case 'SPHERE':
      return [2 * p.radius, 2 * p.radius, 2 * p.radius];
    case 'TORUS':
      return [2 * (p.radius + p.tube), 2 * (p.radius + p.tube), 2 * p.tube];
    default:
      return [2 * p.radius, 2 * p.radius, p.height];
  }
}

// ---------------------------------------------------------------------------
// The mesh id
// ---------------------------------------------------------------------------

/** Every primitive mesh id starts with this. */
export const PRIMITIVE_ID_PREFIX = 'prim:';

/**
 * The id of the mesh a spec makes for a part: `prim:<owner>:<KIND>:<measures in catalogue order>`. It names the
 * content (the same measures are the same geometry, so an id is never registered with other data) and the owner,
 * the node that first had it: linked copies share the owner and so the mesh, an independent copy gets its own
 * owner, so editing, flipping or smoothing one never reaches the other.
 */
export function primitiveMeshId(owner: string, spec: PrimitiveSpec): MeshId {
  const values = specsOf(spec.kind).map((p) => String(spec.params[p.key]));
  return `${PRIMITIVE_ID_PREFIX}${owner}:${spec.kind}:${values.join(',')}`;
}

/** The owner of a primitive mesh id, or null when the id is not one (or was derived from one: `~flip`...). */
export function primitiveOwner(id: MeshId): string | null {
  const m = /^prim:([^:~]+):[A-Z]+:[^~]*$/.exec(id);
  return m ? m[1] : null;
}

/** Logical faces of the meshes made here, by id (the registry keeps the data; this keeps where the faces are). */
const madeFaces = new Map<MeshId, { ranges: TriangleRange[]; names: string[] }>();

/**
 * The mesh of a spec registered under `primitiveMeshId(owner, spec)` (made once: the id names the content), with
 * its logical faces.
 */
export function ensurePrimitiveMesh(owner: string, spec: PrimitiveSpec): { ref: MeshRef; faceRanges: TriangleRange[]; faceNames: string[] } {
  const id = primitiveMeshId(owner, spec);
  return ensurePrimitiveMeshAt(id, spec);
}

/** The mesh of a spec under a given id (a project's), made when the registry does not hold it yet. */
export function ensurePrimitiveMeshAt(id: MeshId, spec: PrimitiveSpec): { ref: MeshRef; faceRanges: TriangleRange[]; faceNames: string[] } {
  const hit = getMesh(id);
  const faces = madeFaces.get(id);
  if (hit && faces) return { ref: meshRef(id, hit), faceRanges: faces.ranges.map((r) => ({ ...r })), faceNames: [...faces.names] };
  const g = generatePrimitive(spec);
  madeFaces.set(id, { ranges: g.faceRanges, names: g.faceNames });
  const ref = registerMesh(id, g.data);
  return { ref, faceRanges: g.faceRanges.map((r) => ({ ...r })), faceNames: [...g.faceNames] };
}

/** Names of the logical faces of a spec, in mesh order (what `faceRanges` are). */
export function primitiveFaceNames(spec: PrimitiveSpec): string[] {
  return generatePrimitive(spec).faceNames;
}

// ---------------------------------------------------------------------------
// Building a mesh
// ---------------------------------------------------------------------------

const QUARTER: readonly (readonly [number, number])[] = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
];

/** cos and sin of `deg` degrees, exact at the multiples of 90. */
function cs(deg: number): [number, number] {
  const q = deg / 90;
  if (Number.isInteger(q)) {
    const e = QUARTER[((q % 4) + 4) % 4];
    return [e[0], e[1]];
  }
  const a = (deg * Math.PI) / 180;
  return [Math.cos(a), Math.sin(a)];
}

/**
 * cos and sin at `m + 1` steps of a quarter turn, symmetric: the cosine at step k is the sine at step m - k bit for
 * bit, so two patches that run the same quarter in opposite directions (a box's edge and its corner) meet exactly.
 */
function quarterSteps(m: number): [number, number][] {
  const out: [number, number][] = new Array(m + 1);
  for (let k = 0; k <= m; k++) {
    if (2 * k === m) out[k] = [Math.SQRT1_2, Math.SQRT1_2];
    else if (2 * k < m) out[k] = k === 0 ? [1, 0] : [Math.cos((Math.PI / 2) * (k / m)), Math.sin((Math.PI / 2) * (k / m))];
  }
  for (let k = 0; k <= m; k++) if (2 * k > m) out[k] = [out[m - k][1], out[m - k][0]];
  return out;
}

/** `centre + radius * k`, but exactly `rim` when k is 1 (no `h - b + b` drift at the end of a bevel). */
const along = (centre: number, radius: number, k: number, rim: number): number => (k === 1 ? rim : centre + radius * k);

class Builder {
  private readonly pos: number[] = [];
  private readonly nrm: number[] = [];
  private readonly tex: number[] = [];
  private readonly idx: number[] = [];
  private readonly triFace: number[] = [];
  private readonly names: string[] = [];
  private face = -1;
  /** Twice the area below which a triangle is a sliver (and dropped): 1e-10 of the size squared. */
  private readonly sliver: number;

  constructor(private readonly size: number) {
    this.sliver = Math.max(1e-10 * size * size, 1e-30);
  }

  begin(name: string): void {
    this.face = this.names.length;
    this.names.push(name);
  }

  /** A vertex: position, normal (normalised here), uv. */
  v(x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, w: number): number {
    const l = Math.hypot(nx, ny, nz) || 1;
    this.pos.push(x, y, z);
    // `+ 0` keeps zero components as +0, so equal normals have equal bits.
    this.nrm.push(nx / l + 0, ny / l + 0, nz / l + 0);
    // In [0, 1] by construction (each face divides by its own longer extent): not clamped, so a wrong mapping shows.
    this.tex.push(u + 0, w + 0);
    return this.pos.length / 3 - 1;
  }

  /** A triangle, wound so that it faces where its vertex normals point; slivers are dropped. */
  tri(a: number, b: number, c: number): void {
    const p = this.pos;
    const ux = p[3 * b] - p[3 * a];
    const uy = p[3 * b + 1] - p[3 * a + 1];
    const uz = p[3 * b + 2] - p[3 * a + 2];
    const wx = p[3 * c] - p[3 * a];
    const wy = p[3 * c + 1] - p[3 * a + 1];
    const wz = p[3 * c + 2] - p[3 * a + 2];
    const cx = uy * wz - uz * wy;
    const cy = uz * wx - ux * wz;
    const cz = ux * wy - uy * wx;
    if (Math.hypot(cx, cy, cz) <= this.sliver) return;
    const n = this.nrm;
    const sx = n[3 * a] + n[3 * b] + n[3 * c];
    const sy = n[3 * a + 1] + n[3 * b + 1] + n[3 * c + 1];
    const sz = n[3 * a + 2] + n[3 * b + 2] + n[3 * c + 2];
    if (cx * sx + cy * sy + cz * sz < 0) this.idx.push(a, c, b);
    else this.idx.push(a, b, c);
    this.triFace.push(this.face);
  }

  /** Two triangles a-b-c and a-c-d (a degenerate one, where two corners meet at a pole, is dropped). */
  quad(a: number, b: number, c: number, d: number): void {
    this.tri(a, b, c);
    this.tri(a, c, d);
  }

  /**
   * The mesh: vertices no triangle uses are dropped (keeping the order of the others), the faces become runs of
   * triangles (a face that ended up with none is left out), and every edge between two faces is a hard edge.
   */
  finish(): PrimitiveGeometry {
    const V = this.pos.length / 3;
    const used = new Int32Array(V).fill(-1);
    for (const i of this.idx) used[i] = 0;
    let count = 0;
    for (let i = 0; i < V; i++) if (used[i] === 0) used[i] = count++;
    const positions = new Float32Array(3 * count);
    const normals = new Float32Array(3 * count);
    const uvs = new Float32Array(2 * count);
    for (let i = 0; i < V; i++) {
      const r = used[i];
      if (r < 0) continue;
      for (let k = 0; k < 3; k++) {
        positions[3 * r + k] = this.pos[3 * i + k] + 0;
        normals[3 * r + k] = this.nrm[3 * i + k];
      }
      uvs[2 * r] = this.tex[2 * i];
      uvs[2 * r + 1] = this.tex[2 * i + 1];
    }
    const indices = new Uint32Array(this.idx.length);
    for (let i = 0; i < this.idx.length; i++) indices[i] = used[this.idx[i]];

    const faceRanges: TriangleRange[] = [];
    const faceNames: string[] = [];
    let last = -1;
    for (let t = 0; t < this.triFace.length; t++) {
      const f = this.triFace[t];
      if (f !== last) {
        faceRanges.push({ start: t, count: 1 });
        faceNames.push(this.names[f]);
        last = f;
      } else faceRanges[faceRanges.length - 1].count++;
    }

    // Hard edges: where triangles of two different faces meet (by position: faces do not share vertices).
    const weld = weldIds(positions, Math.max(this.size, 1e-9) * 1e-7);
    const W = Math.max(1, weld.count);
    const edges = new Map<number, { face: number; a: number; b: number; hard: boolean }>();
    const T = indices.length / 3;
    for (let t = 0; t < T; t++) {
      for (let j = 0; j < 3; j++) {
        const a = indices[3 * t + j];
        const b = indices[3 * t + ((j + 1) % 3)];
        const wa = weld.ids[a];
        const wb = weld.ids[b];
        const key = wa < wb ? wa * W + wb : wb * W + wa;
        const e = edges.get(key);
        if (!e) edges.set(key, { face: this.triFace[t], a, b, hard: false });
        else if (e.face !== this.triFace[t]) e.hard = true;
      }
    }
    const sharp: number[] = [];
    for (const e of edges.values()) if (e.hard) sharp.push(Math.min(e.a, e.b), Math.max(e.a, e.b));
    return { data: { positions, normals, indices, uvs, sharpEdges: Uint32Array.from(sharp) }, faceRanges, faceNames };
  }
}

/** A point of a revolution profile: radius, height, the normal in that plane (nr, nz), arc length from its start. */
interface ProfilePoint {
  r: number;
  z: number;
  nr: number;
  nz: number;
  t: number;
}

/** Profile points along a straight segment (normal constant), `steps` pieces. */
function segment(r0: number, z0: number, r1: number, z1: number, nr: number, nz: number, steps = 1): ProfilePoint[] {
  const len = Math.hypot(r1 - r0, z1 - z0);
  const out: ProfilePoint[] = [];
  for (let k = 0; k <= steps; k++) {
    const f = k / steps;
    out.push({ r: k === steps ? r1 : r0 + (r1 - r0) * f, z: k === steps ? z1 : z0 + (z1 - z0) * f, nr, nz, t: len * f });
  }
  return out;
}

/**
 * Profile points along an arc about (cr, cz) of radius `rad` from `deg0` to `deg1` degrees, `steps` pieces, the
 * normal pointing away from the centre. `rim` gives the exact values the arc reaches where it is vertical (`r`, at
 * cos 1) and horizontal (`up` at sin 1, `down` at sin -1), so it meets the faces next to it bit for bit and its
 * bounds are the measures.
 */
function arc(cr: number, cz: number, rad: number, deg0: number, deg1: number, steps: number, rim: { r?: number; up?: number; down?: number } = {}): ProfilePoint[] {
  const out: ProfilePoint[] = [];
  for (let k = 0; k <= steps; k++) {
    const deg = deg0 + ((deg1 - deg0) * k) / steps;
    const [c, s] = cs(deg);
    const r = c === 1 && rim.r !== undefined ? rim.r : cr + rad * c;
    const z = s === 1 && rim.up !== undefined ? rim.up : s === -1 && rim.down !== undefined ? rim.down : cz + rad * s;
    out.push({ r: Math.max(0, r), z, nr: c, nz: s, t: (rad * Math.abs(deg - deg0) * Math.PI) / 180 });
  }
  return out;
}

/**
 * A surface of revolution about Z: the profile turned through `n` segments. `WRAP` maps u around (once, at the
 * face's widest radius) and v along the profile; `PLANAR` projects from above (caps). A first or last profile
 * point on the axis is a pole: one vertex per segment, at the middle of it, so a cone's tip has the normal of the
 * facet it closes.
 */
function revolve(b: Builder, name: string, profile: readonly ProfilePoint[], n: number, mapping: 'WRAP' | 'PLANAR'): void {
  if (profile.length < 2) return;
  b.begin(name);
  const rMax = Math.max(1e-12, ...profile.map((p) => p.r));
  const length = profile[profile.length - 1].t;
  const L = Math.max(2 * Math.PI * rMax, length, 1e-12);
  const uv = (x: number, y: number, turn: number, t: number): [number, number] =>
    mapping === 'PLANAR' ? [0.5 + x / (2 * rMax), 0.5 + y / (2 * rMax)] : [(turn * 2 * Math.PI * rMax) / L, t / L];
  const rows: number[][] = [];
  profile.forEach((p, i) => {
    const pole = p.r === 0 && (i === 0 || i === profile.length - 1);
    const row: number[] = [];
    const count = pole ? n : n + 1;
    for (let j = 0; j < count; j++) {
      const turn = pole ? (j + 0.5) / n : j / n;
      const [c, s] = cs(360 * turn);
      const x = p.r * c;
      const y = p.r * s;
      const [u, w] = uv(x, y, turn, p.t);
      row.push(b.v(x, y, p.z, p.nr * c, p.nr * s, p.nz, u, w));
    }
    rows.push(row);
  });
  for (let i = 0; i + 1 < rows.length; i++) {
    const lo = rows[i];
    const hi = rows[i + 1];
    for (let j = 0; j < n; j++) {
      // A pole row has one vertex per segment; a ring has n + 1 (the seam is duplicated for the uvs).
      b.quad(lo[j], lo.length === n ? lo[j] : lo[j + 1], hi.length === n ? hi[j] : hi[j + 1], hi[j]);
    }
  }
}

// ---------------------------------------------------------------------------
// The shapes
// ---------------------------------------------------------------------------

function box(p: PrimitiveParams): PrimitiveGeometry {
  const h = [p.width / 2, p.depth / 2, p.height / 2];
  const bev = p.bevel;
  const a = h.map((v) => (bev > 0 ? v - bev : v));
  const B = new Builder(Math.max(p.width, p.depth, p.height));
  // The six flat faces: in-plane axes (u, v) and the direction u runs in, so a texture reads the right way round
  // from outside.
  const flats: [string, number, number, number, number, number, number][] = [
    ['top', 2, 1, 0, 1, 1, 1],
    ['bottom', 2, -1, 0, 1, 1, -1],
    ['front', 1, -1, 0, 2, 1, 1],
    ['back', 1, 1, 0, 2, -1, 1],
    ['right', 0, 1, 1, 2, 1, 1],
    ['left', 0, -1, 1, 2, -1, 1],
  ];
  for (const [name, axis, sign, ui, vi, su, sv] of flats) {
    B.begin(name);
    const L = Math.max(2 * h[ui], 2 * h[vi]);
    const corner = (cu: number, cv: number) => {
      const pt = [0, 0, 0];
      const n = [0, 0, 0];
      pt[axis] = sign * h[axis];
      pt[ui] = cu * a[ui];
      pt[vi] = cv * a[vi];
      n[axis] = sign;
      return B.v(pt[0], pt[1], pt[2], n[0], n[1], n[2], (su * pt[ui] + h[ui]) / L, (sv * pt[vi] + h[vi]) / L);
    };
    B.quad(corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1));
  }
  if (bev > 0) {
    B.begin('bevel');
    const m = Math.max(1, p.bevelSegments);
    const Q = quarterSteps(m);
    // The twelve edges: quarter cylinders along axis k, between the faces of axes i and j.
    for (let k = 0; k < 3; k++) {
      const i = (k + 1) % 3;
      const j = (k + 2) % 3;
      for (const si of [1, -1]) {
        for (const sj of [1, -1]) {
          const strip: [number, number][] = [];
          for (let q = 0; q <= m; q++) {
            const [c, s] = Q[q];
            const pair: number[] = [];
            for (const t of [-a[k], a[k]]) {
              const pt = [0, 0, 0];
              const n = [0, 0, 0];
              pt[k] = t;
              pt[i] = si * along(a[i], bev, c, h[i]);
              pt[j] = sj * along(a[j], bev, s, h[j]);
              n[i] = si * c;
              n[j] = sj * s;
              pair.push(B.v(pt[0], pt[1], pt[2], n[0], n[1], n[2], a[k] > 0 ? (t + a[k]) / (2 * a[k]) : 0, q / m));
            }
            strip.push([pair[0], pair[1]]);
          }
          for (let q = 0; q < m; q++) B.quad(strip[q][0], strip[q][1], strip[q + 1][1], strip[q + 1][0]);
        }
      }
    }
    // The eight corners: an eighth of a sphere each, azimuth and elevation in quarter steps.
    for (const sx of [1, -1]) {
      for (const sy of [1, -1]) {
        for (const sz of [1, -1]) {
          const grid: number[][] = [];
          for (let qa = 0; qa <= m; qa++) {
            const col: number[] = [];
            const [ca, sa] = Q[qa];
            for (let qb = 0; qb <= m; qb++) {
              const [cb, sb] = Q[qb];
              const n0 = cb * ca;
              const n1 = cb * sa;
              const n2 = sb;
              col.push(B.v(sx * along(a[0], bev, n0, h[0]), sy * along(a[1], bev, n1, h[1]), sz * along(a[2], bev, n2, h[2]), sx * n0, sy * n1, sz * n2, qa / m, qb / m));
            }
            grid.push(col);
          }
          for (let qa = 0; qa < m; qa++) for (let qb = 0; qb < m; qb++) B.quad(grid[qa][qb], grid[qa + 1][qb], grid[qa + 1][qb + 1], grid[qa][qb + 1]);
        }
      }
    }
  }
  return B.finish();
}

function plane(p: PrimitiveParams): PrimitiveGeometry {
  const hx = p.width / 2;
  const hy = p.depth / 2;
  const L = Math.max(p.width, p.depth);
  const B = new Builder(L);
  B.begin('top');
  const v = (x: number, y: number) => B.v(x, y, 0, 0, 0, 1, (x + hx) / L, (y + hy) / L);
  B.quad(v(-hx, -hy), v(hx, -hy), v(hx, hy), v(-hx, hy));
  return B.finish();
}

function disc(p: PrimitiveParams): PrimitiveGeometry {
  const B = new Builder(2 * p.radius);
  revolve(B, 'top', segment(0, 0, p.radius, 0, 0, 1), p.segments, 'PLANAR');
  return B.finish();
}

/** The flat cap of a solid of revolution, from the axis (or `r0`) out to `r1`, facing up (+1) or down (-1). */
function cap(B: Builder, name: string, r0: number, r1: number, z: number, up: 1 | -1, n: number): void {
  revolve(B, name, segment(r0, z, r1, z, 0, up), n, 'PLANAR');
}

function cylinder(p: PrimitiveParams): PrimitiveGeometry {
  const R = p.radius;
  const hz = p.height / 2;
  const B = new Builder(Math.max(2 * R, p.height));
  cap(B, 'top', 0, R, hz, 1, p.segments);
  revolve(B, 'side', segment(R, -hz, R, hz, 1, 0), p.segments, 'WRAP');
  cap(B, 'bottom', 0, R, -hz, -1, p.segments);
  return B.finish();
}

function pedestal(p: PrimitiveParams): PrimitiveGeometry {
  const R = p.radius;
  const hz = p.height / 2;
  const bev = p.bevel;
  const B = new Builder(Math.max(2 * R, p.height));
  if (bev > 0) {
    cap(B, 'top', 0, R - bev, hz, 1, p.segments);
    revolve(B, 'bevel', arc(R - bev, hz - bev, bev, 0, 90, Math.max(1, p.bevelSegments), { r: R, up: hz }), p.segments, 'WRAP');
    revolve(B, 'side', segment(R, -hz, R, hz - bev, 1, 0), p.segments, 'WRAP');
  } else {
    cap(B, 'top', 0, R, hz, 1, p.segments);
    revolve(B, 'side', segment(R, -hz, R, hz, 1, 0), p.segments, 'WRAP');
  }
  cap(B, 'bottom', 0, R, -hz, -1, p.segments);
  return B.finish();
}

function sphere(p: PrimitiveParams): PrimitiveGeometry {
  const R = p.radius;
  const B = new Builder(2 * R);
  const rings = Math.max(2, Math.round(p.segments / 2));
  revolve(B, 'surface', arc(0, 0, R, -90, 90, rings, { r: R, up: R, down: -R }), p.segments, 'WRAP');
  return B.finish();
}

function cone(p: PrimitiveParams): PrimitiveGeometry {
  const R = p.radius;
  const hz = p.height / 2;
  const B = new Builder(Math.max(2 * R, p.height));
  const l = Math.hypot(R, p.height) || 1;
  revolve(B, 'side', segment(R, -hz, 0, hz, p.height / l, R / l), p.segments, 'WRAP');
  cap(B, 'bottom', 0, R, -hz, -1, p.segments);
  return B.finish();
}

function torus(p: PrimitiveParams): PrimitiveGeometry {
  const R = p.radius;
  const r = p.tube;
  const B = new Builder(2 * (R + r));
  revolve(B, 'surface', arc(R, 0, r, -180, 180, Math.max(3, p.tubeSegments), { r: R + r, up: r, down: -r }), p.segments, 'WRAP');
  return B.finish();
}

function capsule(p: PrimitiveParams): PrimitiveGeometry {
  const R = p.radius;
  const hz = p.height / 2;
  const B = new Builder(Math.max(2 * R, p.height));
  const steps = Math.max(1, Math.round(p.segments / 4));
  const zc = hz - R;
  revolve(B, 'top', arc(0, zc, R, 0, 90, steps, { r: R, up: hz }), p.segments, 'WRAP');
  if (zc > 0) revolve(B, 'side', segment(R, -zc, R, zc, 1, 0), p.segments, 'WRAP');
  revolve(B, 'bottom', arc(0, -zc, R, -90, 0, steps, { r: R, down: -hz }), p.segments, 'WRAP');
  return B.finish();
}

function tube(p: PrimitiveParams): PrimitiveGeometry {
  const R = p.radius;
  const ri = p.inner;
  const hz = p.height / 2;
  const B = new Builder(Math.max(2 * R, p.height));
  revolve(B, 'outer', segment(R, -hz, R, hz, 1, 0), p.segments, 'WRAP');
  cap(B, 'top', ri, R, hz, 1, p.segments);
  revolve(B, 'inner', segment(ri, hz, ri, -hz, -1, 0), p.segments, 'WRAP');
  cap(B, 'bottom', ri, R, -hz, -1, p.segments);
  return B.finish();
}

/**
 * Steps rising towards the back (+Y, away from the camera): `steps` treads and risers, the two sides, the back and
 * the bottom. The sides are a grid of cells and the back and bottom are cut where the steps are, so every edge
 * meets an edge (no vertex lies in the middle of another face's edge: the solid is watertight).
 */
function stairs(p: PrimitiveParams): PrimitiveGeometry {
  const k = Math.max(1, p.steps);
  const hx = p.width / 2;
  const hy = p.depth / 2;
  const hz = p.height / 2;
  const ys = Array.from({ length: k + 1 }, (_, i) => (i === 0 ? -hy : i === k ? hy : -hy + (p.depth * i) / k));
  const zs = Array.from({ length: k + 1 }, (_, i) => (i === 0 ? -hz : i === k ? hz : -hz + (p.height * i) / k));
  const B = new Builder(Math.max(p.width, p.depth, p.height));
  const Lx = Math.max(p.width, p.height);
  const Lt = Math.max(p.width, p.depth);
  for (let i = 0; i < k; i++) {
    B.begin(`riser${i + 1}`);
    const r = (x: number, z: number) => B.v(x, ys[i], z, 0, -1, 0, (x + hx) / Lx, (z + hz) / Lx);
    B.quad(r(-hx, zs[i]), r(hx, zs[i]), r(hx, zs[i + 1]), r(-hx, zs[i + 1]));
    B.begin(`tread${i + 1}`);
    const tr = (x: number, y: number) => B.v(x, y, zs[i + 1], 0, 0, 1, (x + hx) / Lt, (y + hy) / Lt);
    B.quad(tr(-hx, ys[i]), tr(hx, ys[i]), tr(hx, ys[i + 1]), tr(-hx, ys[i + 1]));
  }
  const Ls = Math.max(p.depth, p.height);
  for (const [name, sx] of [['right', 1], ['left', -1]] as const) {
    B.begin(name);
    const grid = ys.map((y) => zs.map((z) => B.v(sx * hx, y, z, sx, 0, 0, (sx * y + hy) / Ls, (z + hz) / Ls)));
    // Column i (between ys[i] and ys[i+1]) is step i: rows 0..i.
    for (let i = 0; i < k; i++) for (let j = 0; j <= i; j++) B.quad(grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]);
  }
  B.begin('back');
  const back = zs.map((z) => [B.v(hx, hy, z, 0, 1, 0, 0, (z + hz) / Lx), B.v(-hx, hy, z, 0, 1, 0, p.width / Lx, (z + hz) / Lx)]);
  for (let j = 0; j < k; j++) B.quad(back[j][0], back[j][1], back[j + 1][1], back[j + 1][0]);
  B.begin('bottom');
  const bottom = ys.map((y) => [B.v(-hx, y, -hz, 0, 0, -1, 0, (hy - y) / Lt), B.v(hx, y, -hz, 0, 0, -1, p.width / Lt, (hy - y) / Lt)]);
  for (let i = 0; i < k; i++) B.quad(bottom[i][0], bottom[i][1], bottom[i + 1][1], bottom[i + 1][0]);
  return B.finish();
}

/**
 * The infinity sweep (a studio cyclorama): a floor that curves up into a wall at the back (+Y), one open sheet whose
 * normals face up and towards the front, unrolled in its uvs from the front edge to the top of the wall.
 */
function sweep(p: PrimitiveParams): PrimitiveGeometry {
  const hx = p.width / 2;
  const hy = p.depth / 2;
  const hz = p.height / 2;
  const R = p.radius;
  const B = new Builder(Math.max(p.width, p.depth, p.height));
  const yc = hy - R;
  const zc = -hz + R;
  const floorLen = p.depth - R;
  const curveLen = (Math.PI / 2) * R;
  const wallLen = p.height - R;
  const L = Math.max(p.width, floorLen + curveLen + wallLen);
  const row = (y: number, z: number, ny: number, nz: number, t: number): [number, number] => [B.v(-hx, y, z, 0, ny, nz, 0, t / L), B.v(hx, y, z, 0, ny, nz, p.width / L, t / L)];
  const strip = (pts: [number, number][]) => {
    for (let i = 0; i + 1 < pts.length; i++) B.quad(pts[i][0], pts[i][1], pts[i + 1][1], pts[i + 1][0]);
  };
  B.begin('floor');
  strip([row(-hy, -hz, 0, 1, 0), row(yc, -hz, 0, 1, floorLen)]);
  if (R > 0) {
    B.begin('curve');
    const m = Math.max(1, p.segments);
    const pts: [number, number][] = [];
    for (let k = 0; k <= m; k++) {
      const [c, s] = cs((90 * k) / m);
      const y = s === 1 ? hy : yc + R * s;
      const z = c === 1 ? -hz : zc - R * c;
      pts.push(row(y, z, -s, c, floorLen + curveLen * (k / m)));
    }
    strip(pts);
  }
  B.begin('wall');
  strip([row(hy, zc, -1, 0, floorLen + curveLen), row(hy, hz, -1, 0, floorLen + curveLen + wallLen)]);
  return B.finish();
}

const GENERATORS: Readonly<Record<PrimitiveKind, (p: PrimitiveParams) => PrimitiveGeometry>> = {
  BOX: box,
  PLANE: plane,
  DISC: disc,
  CYLINDER: cylinder,
  PEDESTAL: pedestal,
  SPHERE: sphere,
  CONE: cone,
  TORUS: torus,
  CAPSULE: capsule,
  TUBE: tube,
  STEPS: stairs,
  SWEEP: sweep,
};

/** The mesh of a spec (its measures normalised first). Pure: the same spec gives the same arrays. */
export function generatePrimitive(spec: PrimitiveSpec): PrimitiveGeometry {
  return GENERATORS[spec.kind](normalizeParams(spec.kind, spec.params));
}

/** The catalogue's shapes, for menus and tests. */
export const PRIMITIVE_CATALOGUE = PRIMITIVES;
