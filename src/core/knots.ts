// E6: where a wood's knots are, as rt_core places them (pattern.rs `wood_frame` and `meets_surface`,
// pattern/knots.rs `Knots::place`, pattern/noise.rs `hash01`), in f64: the same knots in the same places (to a few
// thousandths of a millimetre). The Fast preview darkens them (render/knots.ts) and the inspector says when fewer
// fit than were asked.
import { mat4Invert, type Mat4 } from './math';
import { triangleMaterials, type MaterialId, type MaterialInstance } from './materials';
import { getMesh } from './meshes';
import { worldMatrix, type NodeId } from './scene';
import type { ProjectState } from './store';

type V3 = [number, number, number];

/** Most knots of a piece (rt_core MAX_KNOTS). */
export const MAX_KNOTS = 12;
const TRIES = 32;
/** Times a knot is drawn again because its axis meets the surface too obliquely. */
const REDRAWS = 8;
/** The least sine of the angle between a knot's axis and the surface where it crosses it (45°). */
export const MIN_INCIDENCE = Math.fround(Math.SQRT1_2);
const SALT = 0x4b4e4f54; // "KNOT"
const GAP_MM = 1;
/** Farthest the pith runs from a part's centre across its thickness, mm. */
const MAX_PITH_MM = 250;
/** The pith's offset aside over its offset below. */
const ASIDE = 0.35 / 0.8;
const DEG = Math.PI / 180;

/** rt_core::pattern::noise::hash01: an integer hash to [0, 1). */
export function hash01(a: number, b: number, c: number): number {
  let x = (Math.imul(a, 0x9e3779b1) + Math.imul(b, 0x85ebca77) + Math.imul(c >>> 0, 0xc2b2ae3d)) >>> 0;
  x = (x ^ (x >>> 16)) >>> 0;
  x = Math.imul(x, 0x7feb352d) >>> 0;
  x = (x ^ (x >>> 15)) >>> 0;
  x = Math.imul(x, 0x846ca68b) >>> 0;
  x = (x ^ (x >>> 16)) >>> 0;
  return (x >>> 8) / 16777216;
}

const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const len = (a: V3) => Math.sqrt(dot(a, a));
const norm = (a: V3): V3 => mul(a, 1 / len(a));
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const AXES: V3[] = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];

/** A wood's frame in a mesh's space: the pith's point and the axes (across, across, along the pith). */
export interface WoodFrame {
  origin: V3;
  axes: [V3, V3, V3];
  /** Millimetres per unit of mesh space. */
  mm: number;
}

/** rt_core `wood_frame`: from the mesh's box (`min`, `size`) in mesh units of `mm` millimetres. */
export function woodFrame(min: V3, size: V3, mm: number): WoodFrame {
  const s = size;
  const long = s[0] >= s[1] && s[0] >= s[2] ? 0 : s[1] >= s[2] ? 1 : 2;
  const o1 = (long + 1) % 3;
  const o2 = (long + 2) % 3;
  const [short, side] = s[o1] < s[o2] ? [o1, o2] : [o2, o1];
  const length = Math.max(s[long], 1e-6);
  const offset = Math.max(Math.min(0.8 * length, MAX_PITH_MM / Math.max(mm, 1e-6)), 0.75 * s[short]);
  const centre = add(min, mul(size, 0.5));
  const origin = sub(sub(centre, mul(AXES[short], offset)), mul(AXES[side], ASIDE * offset));
  return { origin, axes: [AXES[side], AXES[short], AXES[long]], mm };
}

/** What a material asks of its knots (rt_core KnotSpec). */
export interface KnotSpec {
  count: number;
  diameterMm: number;
  variation: number;
  darkness: number;
  seed: number;
}

/** One knot, in the wood frame (mm). */
export interface Knot {
  origin: V3;
  axis: V3;
  flow: V3;
  across: V3;
  middle: number;
  radius: number;
}

/** The knot spec of a material instance, or null when it has none (as io/rsb.ts patternToRsb writes it). */
export function knotSpecOf(inst: MaterialInstance | null | undefined): KnotSpec | null {
  if (!inst || inst.family !== 'WOOD') return null;
  const p = inst.params;
  if (String(p.woodFigure ?? 'RINGS') !== 'RINGS') return null;
  const n = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  const count = Math.min(MAX_KNOTS, Math.max(0, Math.round(n(p.knotCount, 0))));
  const diameterMm = Math.max(0, n(p.knotSize, 15));
  if (count === 0 || diameterMm <= 0) return null;
  return {
    count,
    diameterMm,
    variation: Math.min(1, Math.max(0, n(p.knotSizeVar, 0.3))),
    darkness: Math.min(1, Math.max(0, n(p.knotDarkness, 0.6))),
    seed: Math.max(0, Math.round(n(inst.wear?.seed, 0))) >>> 0,
  };
}

/** Where the line `o + t d` enters and leaves the box `centre ± half`. */
function clip(o: V3, d: V3, centre: V3, half: V3): [number, number] | null {
  let t0 = -Infinity;
  let t1 = Infinity;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-12) {
      if (Math.abs(o[i] - centre[i]) > half[i]) return null;
      continue;
    }
    const a = (centre[i] - half[i] - o[i]) / d[i];
    const b = (centre[i] + half[i] - o[i]) / d[i];
    t0 = Math.max(t0, Math.min(a, b));
    t1 = Math.min(t1, Math.max(a, b));
  }
  return t0 <= t1 ? [t0, t1] : null;
}

/** Smallest distance between the segments p0 p1 and q0 q1. */
function segmentGap(p0: V3, p1: V3, q0: V3, q1: V3): number {
  const d1 = sub(p1, p0);
  const d2 = sub(q1, q0);
  const r = sub(p0, q0);
  const a = dot(d1, d1);
  const e = dot(d2, d2);
  const f = dot(d2, r);
  const c = dot(d1, r);
  const b = dot(d1, d2);
  const denom = a * e - b * b;
  let s = denom > 1e-9 ? Math.min(1, Math.max(0, (b * f - c * e) / denom)) : 0;
  let t = e > 1e-12 ? (b * s + f) / e : 0;
  if (t < 0) {
    t = 0;
    s = a > 1e-12 ? Math.min(1, Math.max(0, -c / a)) : 0;
  } else if (t > 1) {
    t = 1;
    s = a > 1e-12 ? Math.min(1, Math.max(0, (b - c) / a)) : 0;
  }
  return len(sub(add(p0, mul(d1, s)), add(q0, mul(d2, t))));
}

/** Whether a candidate's axis, inside the box between `t0` and `t1`, crosses the surface at MIN_INCIDENCE or more. */
export type Meets = (k: Knot, t0: number, t1: number) => boolean;

/** rt_core `meets_box`: for a piece that is its box, the faces the axis enters and leaves by. */
export function meetsBox(centre: V3, half: V3): Meets {
  return (k, t0, t1) =>
    [t0, t1].every((t) => {
      const d = sub(add(k.origin, mul(k.axis, t)), centre);
      const r = [Math.abs(d[0]) / half[0], Math.abs(d[1]) / half[1], Math.abs(d[2]) / half[2]];
      const face = r[0] >= r[1] && r[0] >= r[2] ? k.axis[0] : r[1] >= r[2] ? k.axis[1] : k.axis[2];
      return Math.abs(face) >= MIN_INCIDENCE;
    });
}

/** rt_core `Knots::place`: the knots of a piece whose box in the wood frame is `centre ± half` (mm). */
export function placeKnots(spec: KnotSpec, centre: V3, half: V3, meets: Meets): Knot[] {
  const count = Math.min(spec.count, MAX_KNOTS);
  const out: Knot[] = [];
  const inside: [V3, V3, number][] = [];
  if (count === 0 || !(spec.diameterMm > 0)) return out;
  const salt = (spec.seed ^ SALT) >>> 0;
  for (let k = 0; k < count; k++) {
    let grazing = 0;
    for (let attempt = 0; attempt < TRIES; attempt++) {
      const id = k * TRIES + attempt;
      const h = (channel: number) => hash01(id, channel, salt);
      const d = spec.diameterMm * (1 + Math.min(1, Math.max(0, spec.variation)) * (2 * h(0) - 1));
      const r = 0.5 * d;
      const p: V3 = [
        centre[0] + (2 * h(2) - 1) * Math.max(half[0] - r, 0),
        centre[1] + (2 * h(3) - 1) * half[1],
        centre[2] + (2 * h(1) - 1) * Math.max(half[2] - r, 0),
      ];
      const radial: V3 = [p[0], p[1], 0];
      const outward = len(radial);
      if (outward <= 1e-3) continue;
      const tilt = (15 + 20 * h(4)) * DEG;
      const up = h(5) < 0.5 ? -1 : 1;
      const axis = add(mul(radial, Math.cos(tilt) / outward), [0, 0, up * Math.sin(tilt)]);
      const middle = outward / Math.cos(tilt);
      const origin = sub(p, mul(axis, middle));
      const flow = norm(sub([0, 0, 1], mul(axis, axis[2])));
      const across = cross(axis, flow);
      const span = clip(origin, axis, centre, half);
      if (!span) continue;
      const a = add(origin, mul(axis, span[0]));
      const b = add(origin, mul(axis, span[1]));
      const widest = r * (0.5 + (0.5 * Math.max(span[0], span[1])) / middle);
      if (!inside.every(([c, e, w]) => segmentGap(a, b, c, e) >= widest + w + GAP_MM)) continue;
      const knot = { origin, axis, flow, across, middle, radius: r };
      if (!meets(knot, span[0], span[1])) {
        grazing++;
        if (grazing > REDRAWS) break;
        continue;
      }
      out.push(knot);
      inside.push([a, b, widest]);
      break;
    }
  }
  return out;
}

/**
 * rt_core `meets_surface`: whether the segment `a b` (mesh space, through the part's box) crosses the triangles
 * `tris` of `positions`, and every time at MIN_INCIDENCE or more against the triangle's plane in the world (`m` is
 * the mesh-to-world matrix). Followed a little beyond both ends (2 % and 0.01 mm), as the engine does.
 */
export function meetsSurface(positions: ArrayLike<number>, indices: ArrayLike<number>, tris: readonly number[], m: Mat4, a: V3, b: V3): boolean {
  const lin = (v: V3): V3 => [m[0] * v[0] + m[4] * v[1] + m[8] * v[2], m[1] * v[0] + m[5] * v[1] + m[9] * v[2], m[2] * v[0] + m[6] * v[1] + m[10] * v[2]];
  const inv = mat4Invert(m);
  // Normals go to the world by the inverse transpose.
  const normal = (n: V3): V3 => [inv[0] * n[0] + inv[1] * n[1] + inv[2] * n[2], inv[4] * n[0] + inv[5] * n[1] + inv[6] * n[2], inv[8] * n[0] + inv[9] * n[1] + inv[10] * n[2]];
  const d = sub(b, a);
  const dw = lin(d);
  const lw = len(dw);
  if (!(lw > 0)) return false;
  const reach = (0.02 * lw + 0.01) / lw;
  const p = (i: number): V3 => [positions[3 * i], positions[3 * i + 1], positions[3 * i + 2]];
  let crossed = false;
  for (const t of tris) {
    const p0 = p(indices[3 * t]);
    const e1 = sub(p(indices[3 * t + 1]), p0);
    const e2 = sub(p(indices[3 * t + 2]), p0);
    const h = cross(d, e2);
    const det = dot(e1, h);
    if (Math.abs(det) < 1e-12) continue;
    const s = sub(a, p0);
    const u = dot(s, h) / det;
    if (u < 0 || u > 1) continue;
    const q = cross(s, e1);
    const v = dot(d, q) / det;
    if (v < 0 || u + v > 1) continue;
    const at = dot(e2, q) / det;
    if (at < -reach || at > 1 + reach) continue;
    const n = normal(cross(e1, e2));
    if (Math.abs(dot(n, dw)) / (len(n) * lw) < MIN_INCIDENCE) return false;
    crossed = true;
  }
  return crossed;
}

/** The knots of one part with one wood material, as the engine places them, and how many were asked. */
export interface PartKnots {
  frame: WoodFrame;
  knots: Knot[];
  asked: number;
  darkness: number;
}

const partCache = new Map<string, PartKnots | null>();

/**
 * The knots of `material` on part `node` (null when it has none): in the box of the part's triangles of that material
 * (the mesh the engine gets), at the part's scale, kept only where they meet its surface squarely. Cached by mesh,
 * material values and transform.
 */
export function partKnots(state: ProjectState, node: NodeId, material: MaterialId): PartKnots | null {
  const n = state.scene.nodes[node];
  const inst = state.materials[material];
  const spec = knotSpecOf(inst);
  if (!n?.mesh || !spec) return null;
  const data = getMesh(n.mesh.id);
  if (!data) return null;
  const m = worldMatrix(state, node);
  const key = JSON.stringify([n.mesh.id, n.faceMaterials ?? null, n.material, material, spec, m]);
  const hit = partCache.get(key);
  if (hit !== undefined) return hit;
  const per = triangleMaterials(n);
  const tris: number[] = [];
  for (let t = 0; t < per.length; t++) if (per[t] === material) tris.push(t);
  let out: PartKnots | null = null;
  if (tris.length > 0) {
    const min: V3 = [Infinity, Infinity, Infinity];
    const max: V3 = [-Infinity, -Infinity, -Infinity];
    for (const t of tris)
      for (let c = 0; c < 3; c++) {
        const i = data.indices[3 * t + c];
        for (let j = 0; j < 3; j++) {
          min[j] = Math.min(min[j], data.positions[3 * i + j]);
          max[j] = Math.max(max[j], data.positions[3 * i + j]);
        }
      }
    const det = m[0] * (m[5] * m[10] - m[9] * m[6]) - m[4] * (m[1] * m[10] - m[9] * m[2]) + m[8] * (m[1] * m[6] - m[5] * m[2]);
    const mm = Math.cbrt(Math.abs(det)) || 1;
    const size = sub(max, min);
    const frame = woodFrame(min, size, mm);
    const inFrame = (v: V3): V3 => [dot(v, frame.axes[0]), dot(v, frame.axes[1]), dot(v, frame.axes[2])];
    const centre = mul(inFrame(sub(add(min, mul(size, 0.5)), frame.origin)), mm);
    const half = inFrame(mul(size, 0.5)).map((v) => Math.abs(v) * mm) as V3;
    const toMesh = (q: V3): V3 => add(frame.origin, mul(add(add(mul(frame.axes[0], q[0]), mul(frame.axes[1], q[1])), mul(frame.axes[2], q[2])), 1 / mm));
    const knots = placeKnots(spec, centre, half, (k, t0, t1) =>
      meetsSurface(data.positions, data.indices, tris, m, toMesh(add(k.origin, mul(k.axis, t0))), toMesh(add(k.origin, mul(k.axis, t1)))),
    );
    out = { frame, knots, asked: spec.count, darkness: spec.darkness };
  }
  if (partCache.size > 256) partCache.clear();
  partCache.set(key, out);
  return out;
}
