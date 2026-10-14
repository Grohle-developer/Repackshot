// What the interface sees of a material graph before the engine evaluates it (phase M3a): the small spheres of the
// editor's nodes, the textures the Fast preview draws, and the plain values the rest uses. Pure: the editor and
// the preview run it in workers (render/graph-worker.ts); tests run it directly.
//
//   - Node previews: the program (with a probe per node output) on a 64 × 64 sphere of 100 mm seen from the front,
//     each probe drawn as it is (a number grey, a colour in sRGB, a vector by the fraction of each coordinate, a
//     normal as 0.5 + n / 2) and the output node shaded by a small studio light of its own.
//   - Fast textures: the program evaluated into 512 × 512 maps of the colour, roughness, metal, opacity, normal and
//     emission it gives, on a surface chosen by where its coordinates come from (`planBake`): the UV square when it
//     reads only UVs; the projection's own surface (a plane, a box face, a cylinder, a sphere) when one projection
//     feeds all of it, drawn back through the same projection, so the preview is the program; otherwise a slice
//     through the part's front plane drawn as a box projection, which shows 3D noise as its slice. What a map cannot
//     hold is approximated and said (`BakePlan.notes`): Fresnel and facing at 60° from the normal, curvature as 0,
//     and the values without a slot (clear coat, transmission, IOR…) as their mean.
//   - Plain values (`flattenGraph`): the mean of each output over 64 points of a sphere, for what reads a material's
//     parameters (the engine until M3b, the thumbnails).

import type { MaterialFamily, MaterialParams } from '../data/types';
import { getImage } from './images';
import type { Box } from './math';
import { compileGraph, CTX, OUTPUT_KEYS, OUTPUT_TYPES, type CoordSource, type Program, type ValueRef } from './material-program';
import { ProgramRunner, type ImagePixels, type ShadingPoint } from './material-interp';
import { EMIT_RADIANCE_PER_WATT } from './photometry';
import type { MaterialGraph } from './material-graph';
import type { TextureMapping } from './textures';

// --- Shading points ---------------------------------------------------------------------------------

/** Side of a node's preview, pixels. */
export const NODE_PREVIEW_SIZE = 64;
/** Radius of the preview sphere, mm (a 100 mm sphere, as the material thumbnails). */
export const PREVIEW_RADIUS_MM = 50;
/** Side of a Fast texture, pixels. */
export const BAKE_SIZE = 512;
/** The angle between the view and the normal Fresnel and facing are evaluated at in the Fast textures. */
export const BAKE_VIEW_DEG = 60;

const norm3 = (x: number, y: number, z: number): [number, number, number] => {
  const l = Math.hypot(x, y, z);
  return l > 0 ? [x / l, y / l, z / l] : [0, 0, 1];
};
const cross3 = (a: readonly number[], b: readonly number[]): [number, number, number] => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/**
 * The point of a sphere of radius `r` seen from the front (the camera on −Y, looking along +Y, Z up) under pixel
 * (px, py) of a `size` square, or null outside the disc. Its UVs go around Z with u 0.5 in front (as the
 * cylindrical projection) and v up; T follows u and B = N × T.
 */
export function spherePoint(px: number, py: number, size: number, r = PREVIEW_RADIUS_MM): ShadingPoint | null {
  const x = ((px + 0.5) / size) * 2 - 1;
  const z = 1 - ((py + 0.5) / size) * 2;
  const r2 = x * x + z * z;
  if (r2 > 1) return null;
  const y = -Math.sqrt(1 - r2);
  const N: [number, number, number] = [x, y, z];
  const theta = Math.atan2(y, x);
  let u = (theta + Math.PI / 2) / (2 * Math.PI);
  u -= Math.floor(u + 0.5);
  const v = Math.asin(Math.max(-1, Math.min(1, z))) / Math.PI + 0.5;
  const ring = Math.max(1e-3, Math.hypot(x, y));
  const T: [number, number, number] = [-Math.sin(theta), Math.cos(theta), 0];
  const B = cross3(N, T);
  return {
    P: [x * r, y * r, z * r],
    N,
    UV0: [u + 0.5, v, 0],
    UV1: [u + 0.5, v, 0],
    I: [0, -1, 0],
    T,
    B,
    dUVdT: [1 / (2 * Math.PI * r * ring), 0, 0],
    dUVdB: [0, 1 / (Math.PI * r), 0],
  };
}

// --- Reading outputs --------------------------------------------------------------------------------

/** The output values of a material at a point: f32 scalars and vec3s by output key. */
export type OutputValues = Record<string, number | [number, number, number]>;

const tmp = new Float32Array(3);

function readOutput(run: ProgramRunner, ref: ValueRef, type: string): number | [number, number, number] {
  run.read(ref, tmp);
  return type === 'float' ? tmp[0] : [tmp[0], tmp[1], tmp[2]];
}

export function readOutputs(run: ProgramRunner, p: Program): OutputValues {
  const out: OutputValues = {};
  OUTPUT_KEYS.forEach((k, i) => (out[k] = readOutput(run, p.outputs[i], OUTPUT_TYPES[k])));
  return out;
}

// --- Node previews ----------------------------------------------------------------------------------

const toSrgbByte = (c: number): number => {
  const x = c <= 0 ? 0 : c >= 1 ? 1 : c;
  const s = x <= 0.0031308 ? x * 12.92 : 1.055 * x ** (1 / 2.4) - 0.055;
  return Math.round(s * 255);
};
const toByte = (c: number): number => Math.round((c <= 0 ? 0 : c >= 1 ? 1 : c) * 255);
const fract = (x: number): number => x - Math.floor(x);

/** The studio of the output node's sphere: a key light from the front left above, a dome bright above and dark below. */
const KEY = norm3(-0.55, -0.75, 0.65);
const VIEW: [number, number, number] = [0, -1, 0];

function dome(rz: number): number {
  const t = Math.max(0, Math.min(1, (rz + 0.3) / 1.0));
  return 0.06 + 0.94 * t * t * (3 - 2 * t);
}

/** A shaded colour (linear, about 0..1) of the material's outputs at a point of the sphere. */
export function shadeOutputs(o: OutputValues, geoN: readonly number[]): [number, number, number] {
  const base = o.baseColor as number[];
  const n = norm3(...((o.normal as number[]) ?? geoN) as [number, number, number]);
  const metal = Math.max(0, Math.min(1, o.metallic as number));
  const rough = Math.max(0.02, Math.min(1, o.roughness as number));
  const transmission = Math.max(0, Math.min(1, o.transmission as number));
  const coat = Math.max(0, Math.min(1, o.coat as number));
  const nl = Math.max(0, n[0] * KEY[0] + n[1] * KEY[1] + n[2] * KEY[2]);
  const nv = Math.max(0, n[0] * VIEW[0] + n[1] * VIEW[1] + n[2] * VIEW[2]);
  // Reflection of the view about the normal.
  const rz = 2 * nv * n[2] - VIEW[2];
  const env = dome(rz) * (1 - rough * 0.6) + 0.35 * rough * 0.6;
  const h = norm3(KEY[0] + VIEW[0], KEY[1] + VIEW[1], KEY[2] + VIEW[2]);
  const nh = Math.max(0, n[0] * h[0] + n[1] * h[1] + n[2] * h[2]);
  const shin = 2 / (rough * rough * rough * rough + 1e-3);
  const spec = ((shin + 2) / 8) * nh ** shin * nl;
  const out: [number, number, number] = [0, 0, 0];
  const emission = o.emission as number[];
  const strength = o.emissionStrength as number;
  for (let c = 0; c < 3; c++) {
    const f0 = 0.04 * (1 - metal) + base[c] * metal;
    const fres = f0 + (1 - f0) * (1 - nv) ** 5;
    const diffuse = base[c] * (1 - metal) * (1 - transmission * 0.85) * (0.14 + 0.86 * nl);
    const coatF = coat * (0.04 + 0.96 * (1 - nv) ** 5);
    out[c] = diffuse * (1 - coatF) + fres * (env + Math.min(4, spec)) + coatF * (dome(rz) + spec) + emission[c] * strength;
  }
  return out;
}

export interface NodePreviews {
  size: number;
  /** One RGBA image per probe of the program, in order. */
  probes: Uint8ClampedArray[];
  /** The output node's sphere, shaded. */
  material: Uint8ClampedArray;
}

/** The previews of a program compiled with probes: its probes and its material on the sphere. */
export function renderNodePreviews(p: Program, images: readonly (ImagePixels | null)[], size = NODE_PREVIEW_SIZE): NodePreviews {
  const run = new ProgramRunner(p, images);
  const probes = p.probes.map(() => new Uint8ClampedArray(size * size * 4));
  const material = new Uint8ClampedArray(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const pt = spherePoint(px, py, size);
      if (!pt) continue;
      // The disc's edge, smoothed over a pixel.
      const x = ((px + 0.5) / size) * 2 - 1;
      const z = 1 - ((py + 0.5) / size) * 2;
      const alpha = toByte((1 - Math.hypot(x, z)) * size * 0.5 + 0.5);
      run.setPoint(pt);
      run.run();
      const o = (py * size + px) * 4;
      p.probes.forEach((pr, i) => {
        const img = probes[i];
        run.read(pr.ref, tmp);
        if (pr.type === 'float') img[o] = img[o + 1] = img[o + 2] = toByte(tmp[0]);
        else if (pr.type === 'color') {
          img[o] = toSrgbByte(tmp[0]);
          img[o + 1] = toSrgbByte(tmp[1]);
          img[o + 2] = toSrgbByte(tmp[2]);
        } else if (pr.type === 'vector') {
          img[o] = toByte(fract(tmp[0]));
          img[o + 1] = toByte(fract(tmp[1]));
          img[o + 2] = toByte(fract(tmp[2]));
        } else {
          img[o] = toByte(0.5 + tmp[0] / 2);
          img[o + 1] = toByte(0.5 + tmp[1] / 2);
          img[o + 2] = toByte(0.5 + tmp[2] / 2);
        }
        img[o + 3] = alpha;
      });
      const outs = readOutputs(run, p);
      const c = shadeOutputs(outs, pt.N);
      // A soft roll-off of the highlights (the preview has no exposure of its own).
      for (let k = 0; k < 3; k++) material[o + k] = toSrgbByte(c[k] / (1 + 0.35 * c[k]));
      material[o + 3] = Math.round(alpha * Math.max(0.15, Math.min(1, outs.opacity as number)));
    }
  }
  return { size, probes, material };
}

// --- Fast textures ----------------------------------------------------------------------------------

export type BakeMode = 'UV' | 'PROJECTION' | 'TRIPLANAR';

/** What the Fast preview cannot show of a graph as it is, said in the inspector and the editor. */
export type BakeNote = 'TRIPLANAR' | 'BOX_BLEND' | 'UV_SETS' | 'FRESNEL' | 'CURVATURE' | 'MEANS';

/** Outputs that have a slot of their own in the preview (a map); the others are drawn with their mean. */
export const MAPPED_OUTPUTS: readonly string[] = ['baseColor', 'roughness', 'metallic', 'opacity', 'normal', 'emission', 'emissionStrength', 'bump'];

export interface BakePlan {
  mode: BakeMode;
  /** The mapping the preview draws the maps with (core/textures.ts, M2a's shader). */
  mapping: TextureMapping;
  /** What is approximated; `means` lists the outputs drawn with their mean. */
  notes: BakeNote[];
  /** Internal: the surface the maps are evaluated on. */
  surface: BakeSurface;
}

type BakeSurface =
  | { kind: 'UV'; mm: number }
  | { kind: 'PROJECTION'; source: Extract<CoordSource, { kind: 'PROJECTION' }>; u0: number; v0: number; d: number }
  | { kind: 'TRIPLANAR'; uc: number; vc: number; d: number };

const DEG = Math.PI / 180;

/** The coordinates (before turn and repeat) a projection gives over a box of the part, as ranges. */
function cRange(src: Extract<CoordSource, { kind: 'PROJECTION' }>, b: Box): [number, number, number, number] {
  const size = src.sizeMm;
  const ax = { X: 0, Y: 1, Z: 2 }[src.axis];
  switch (src.projection) {
    case 'PLANAR': {
      const [i, j] = src.axis === 'Z' ? [0, 1] : src.axis === 'Y' ? [0, 2] : [1, 2];
      return [b.min[i] / size, b.max[i] / size, b.min[j] / size, b.max[j] / size];
    }
    case 'BOX': {
      const m = Math.max(Math.abs(b.min[0]), Math.abs(b.max[0]), Math.abs(b.min[1]), Math.abs(b.max[1]));
      return [-m / size, m / size, Math.min(b.min[2], b.min[1]) / size, Math.max(b.max[2], b.max[1]) / size];
    }
    case 'CYLINDRICAL':
      return [-0.5, 0.5, b.min[ax] / size, b.max[ax] / size];
    case 'SPHERICAL':
      return [-0.5, 0.5, -0.5, 0.5];
  }
}

/** The uv of pre-transform coordinates (cu, cv) through a projection's turn, repeat and offset (+0.5). */
function forward(src: Extract<CoordSource, { kind: 'PROJECTION' }>, cu: number, cv: number): [number, number] {
  const a = src.rotationDeg * DEG;
  const x = cu * src.repeat[0];
  const y = cv * src.repeat[1];
  return [Math.cos(a) * x - Math.sin(a) * y + src.offset[0] + 0.5, Math.sin(a) * x + Math.cos(a) * y + src.offset[1] + 0.5];
}

/** Its inverse: the pre-transform coordinates of a uv. */
function backward(src: Extract<CoordSource, { kind: 'PROJECTION' }>, u: number, v: number): [number, number] {
  const a = src.rotationDeg * DEG;
  const x = u - 0.5 - src.offset[0];
  const y = v - 0.5 - src.offset[1];
  const rx = Math.cos(a) * x + Math.sin(a) * y;
  const ry = -Math.sin(a) * x + Math.cos(a) * y;
  const r0 = Math.abs(src.repeat[0]) < 1e-9 ? 1e-9 : src.repeat[0];
  const r1 = Math.abs(src.repeat[1]) < 1e-9 ? 1e-9 : src.repeat[1];
  return [rx / r0, ry / r1];
}

/** A point of a projection's own surface for pre-transform coordinates, with its outward normal. */
function surfacePoint(src: Extract<CoordSource, { kind: 'PROJECTION' }>, cu: number, cv: number): { P: [number, number, number]; N: [number, number, number] } {
  const size = src.sizeMm;
  // Section axes (S, T, A) of the axis into xyz.
  const place = (s: number, t: number, a: number): [number, number, number] => (src.axis === 'Z' ? [s, t, a] : src.axis === 'X' ? [a, s, t] : [t, a, s]);
  switch (src.projection) {
    case 'PLANAR':
      if (src.axis === 'Z') return { P: [cu * size, cv * size, 0], N: [0, 0, 1] };
      if (src.axis === 'Y') return { P: [cu * size, 0, cv * size], N: [0, -1, 0] };
      return { P: [0, cu * size, cv * size], N: [1, 0, 0] };
    case 'BOX':
      // The front face (−Y): (x, z).
      return { P: [cu * size, 0, cv * size], N: [0, -1, 0] };
    case 'CYLINDRICAL': {
      const theta = cu * 2 * Math.PI - Math.PI / 2;
      const r = size / (2 * Math.PI);
      return { P: place(r * Math.cos(theta), r * Math.sin(theta), cv * size), N: place(Math.cos(theta), Math.sin(theta), 0) };
    }
    case 'SPHERICAL': {
      const theta = cu * 2 * Math.PI - Math.PI / 2;
      const phi = cv * Math.PI;
      const n = place(Math.cos(phi) * Math.cos(theta), Math.cos(phi) * Math.sin(theta), Math.sin(phi));
      const r = PREVIEW_RADIUS_MM;
      return { P: [n[0] * r, n[1] * r, n[2] * r], N: n };
    }
  }
}

const sameSource = (a: CoordSource, b: CoordSource): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * How the Fast preview draws a program on parts within `bounds` (part space; null: a box of `partSizeMm` about the
 * origin): the surface its maps are evaluated on, the mapping they are drawn with, and what is approximated.
 */
export function planBake(p: Program, bounds: Box | null, partSizeMm: number): BakePlan {
  const size = partSizeMm > 0 ? partSizeMm : 100;
  const b: Box = bounds && Number.isFinite(bounds.min[0]) ? bounds : { min: [-size / 2, -size / 2, 0], max: [size / 2, size / 2, size] };
  const notes: BakeNote[] = [];
  if (p.uses.fresnel) notes.push('FRESNEL');
  if (p.uses.curvature) notes.push('CURVATURE');
  const coords = p.uses.coords;
  const uvSets = new Set(coords.filter((c) => c.kind === 'UV' || c.kind === 'UVMAP').map((c) => (c as { set: 0 | 1 }).set));
  const projections = coords.filter((c): c is Extract<CoordSource, { kind: 'PROJECTION' }> => c.kind === 'PROJECTION');
  const object = coords.some((c) => c.kind === 'OBJECT');
  const plain = (m: Partial<TextureMapping>): TextureMapping => ({ projection: 'UV', axis: 'Z', uvSet: 0, sizeMm: size, rotationDeg: 0, offset: [0, 0], repeat: [1, 1], wrap: 'REPEAT', ...m });
  // Only UVs (or nothing at all): the UV square.
  if (!object && projections.length === 0) {
    if (uvSets.size > 1) notes.push('UV_SETS');
    const set = uvSets.has(0) || uvSets.size === 0 ? 0 : 1;
    return { mode: 'UV', mapping: plain({ uvSet: set }), notes, surface: { kind: 'UV', mm: size } };
  }
  // One projection feeds everything: its own surface, drawn back through it.
  if (!object && uvSets.size === 0 && projections.every((x) => sameSource(x, projections[0]))) {
    const src = projections[0];
    const [cu0, cu1, cv0, cv1] = cRange(src, b);
    let u0 = Infinity;
    let u1 = -Infinity;
    let v0 = Infinity;
    let v1 = -Infinity;
    for (const [cu, cv] of [
      [cu0, cv0],
      [cu1, cv0],
      [cu0, cv1],
      [cu1, cv1],
    ]) {
      const [u, v] = forward(src, cu, cv);
      u0 = Math.min(u0, u);
      u1 = Math.max(u1, u);
      v0 = Math.min(v0, v);
      v1 = Math.max(v1, v);
    }
    const d = Math.max(u1 - u0, v1 - v0, 1e-6);
    const uc = (u0 + u1) / 2;
    const vc = (v0 + v1) / 2;
    const su = uc - d / 2;
    const sv = vc - d / 2;
    if (src.projection === 'BOX') notes.push('BOX_BLEND');
    const round = src.projection === 'CYLINDRICAL' || src.projection === 'SPHERICAL';
    return {
      mode: 'PROJECTION',
      mapping: {
        projection: src.projection,
        axis: src.axis,
        uvSet: 0,
        sizeMm: src.sizeMm,
        rotationDeg: src.rotationDeg,
        repeat: [src.repeat[0] / d, src.repeat[1] / d],
        offset: [(src.offset[0] + 0.5 - su) / d - 0.5, (src.offset[1] + 0.5 - sv) / d - 0.5],
        wrap: round ? 'REPEAT' : 'CLAMP',
      },
      notes,
      surface: { kind: 'PROJECTION', source: src, u0: su, v0: sv, d },
    };
  }
  // 3D coordinates or several projections: a slice through the front plane, drawn as a box projection.
  notes.push('TRIPLANAR');
  const m = Math.max(Math.abs(b.min[0]), Math.abs(b.max[0]), Math.abs(b.min[1]), Math.abs(b.max[1]), 1e-3);
  const d = Math.max(2 * m, b.max[2] - b.min[2], 1e-3);
  const vc = (b.min[2] + b.max[2]) / 2;
  return {
    mode: 'TRIPLANAR',
    mapping: plain({ projection: 'BOX', sizeMm: d, offset: [0, -vc / d] }),
    notes,
    surface: { kind: 'TRIPLANAR', uc: 0, vc, d },
  };
}

/** A shading point whose arrays are filled again for each texel (no allocation per texel). */
export function newShadingPoint(): ShadingPoint & { [K in keyof ShadingPoint]: number[] } {
  return { P: [0, 0, 0], N: [0, 0, 1], UV0: [0, 0, 0], UV1: [0, 0, 0], I: [0, 0, 1], T: [1, 0, 0], B: [0, 1, 0], dUVdT: [0, 0, 0], dUVdB: [0, 0, 0] };
}

const set3 = (a: number[], x: number, y: number, z: number): void => {
  a[0] = x;
  a[1] = y;
  a[2] = z;
};

/** Normalises `a` in place (to +Z when it has no length). */
function unit3(a: number[]): void {
  const l = Math.hypot(a[0], a[1], a[2]);
  if (l > 0) set3(a, a[0] / l, a[1] / l, a[2] / l);
  else set3(a, 0, 0, 1);
}

const scratchP = [0, 0, 0];
const scratchN = [0, 0, 0];
const scratchQ = [0, 0, 0];
const scratchR = [0, 0, 0];

/** `surfacePoint` into P and N (no allocation). */
function surfaceInto(src: Extract<CoordSource, { kind: 'PROJECTION' }>, cu: number, cv: number, P: number[], N: number[]): void {
  const sp = surfacePoint(src, cu, cv);
  set3(P, sp.P[0], sp.P[1], sp.P[2]);
  set3(N, sp.N[0], sp.N[1], sp.N[2]);
}

/**
 * The shading point of texel (s, t) (0..1, t up) of a plan's surface into `pt`, and the frame its normal map is
 * written in into `tu` and `tv` (along the map's u and v on the surface).
 */
export function fillBakePoint(plan: BakePlan, s: number, t: number, pt: ReturnType<typeof newShadingPoint>, tu: number[], tv: number[]): void {
  const view = BAKE_VIEW_DEG * DEG;
  const sf = plan.surface;
  if (sf.kind === 'UV' || sf.kind === 'TRIPLANAR') {
    const d = sf.kind === 'UV' ? sf.mm : sf.d;
    if (sf.kind === 'UV') set3(pt.P, (s - 0.5) * d, 0, t * d);
    else set3(pt.P, sf.uc + (s - 0.5) * d, 0, sf.vc + (t - 0.5) * d);
    set3(pt.N, 0, -1, 0);
    set3(pt.T, 1, 0, 0);
    set3(pt.dUVdT, 1 / d, 0, 0);
    set3(pt.dUVdB, 0, 1 / d, 0);
  } else {
    const src = sf.source;
    const at = (ss: number, tt: number, P: number[], N: number[]) => {
      const [cu, cv] = backward(src, sf.u0 + ss * sf.d, sf.v0 + tt * sf.d);
      surfaceInto(src, cu, cv, P, N);
    };
    at(s, t, pt.P, pt.N);
    const h = 1e-3;
    at(s + h, t, scratchP, scratchN);
    at(s - h, t, scratchQ, scratchN);
    set3(tu, scratchP[0] - scratchQ[0], scratchP[1] - scratchQ[1], scratchP[2] - scratchQ[2]);
    unit3(tu);
    at(s, t + h, scratchP, scratchN);
    at(s, t - h, scratchQ, scratchN);
    set3(tv, scratchP[0] - scratchQ[0], scratchP[1] - scratchQ[1], scratchP[2] - scratchQ[2]);
    unit3(tv);
    // T: along u, orthogonal to N.
    const N = pt.N;
    const k = tu[0] * N[0] + tu[1] * N[1] + tu[2] * N[2];
    set3(pt.T, tu[0] - k * N[0], tu[1] - k * N[1], tu[2] - k * N[2]);
    unit3(pt.T);
    set3(pt.dUVdT, 0, 0, 0);
    set3(pt.dUVdB, 0, 0, 0);
  }
  const N = pt.N;
  const T = pt.T;
  set3(scratchR, N[1] * T[2] - N[2] * T[1], N[2] * T[0] - N[0] * T[2], N[0] * T[1] - N[1] * T[0]);
  set3(pt.B, scratchR[0], scratchR[1], scratchR[2]);
  if (sf.kind !== 'PROJECTION') {
    set3(tu, T[0], T[1], T[2]);
    set3(tv, pt.B[0], pt.B[1], pt.B[2]);
  }
  set3(pt.UV0, s, t, 0);
  set3(pt.UV1, s, t, 0);
  set3(pt.I, N[0] * Math.cos(view) + T[0] * Math.sin(view), N[1] * Math.cos(view) + T[1] * Math.sin(view), N[2] * Math.cos(view) + T[2] * Math.sin(view));
  unit3(pt.I);
}

/** The shading point of texel (s, t) of a plan's surface (a new object: for tests and single points). */
export function bakePoint(plan: BakePlan, s: number, t: number): { pt: ShadingPoint; tu: readonly number[]; tv: readonly number[] } {
  const pt = newShadingPoint();
  const tu = [0, 0, 0];
  const tv = [0, 0, 0];
  fillBakePoint(plan, s, t, pt, tu, tv);
  return { pt, tu, tv };
}

/** The maps of a bake, RGBA8 rows from the top (row 0 is t = 1), and what each output is where no map shows it. */
export interface BakeResult {
  size: number;
  maps: Partial<Record<'color' | 'roughness' | 'metal' | 'alpha' | 'normal' | 'emission', Uint8ClampedArray>>;
  /** The emission map's scale (its brightest value): the slot's strength. */
  emissionScale: number;
  /** Each output's mean over the bake (its value when it does not vary). */
  values: OutputValues;
  /** The outputs that vary over the bake. */
  varying: string[];
}

/** Floats per texel of a band: every output (f32 one, vec3 three), in `OUTPUT_KEYS` order. */
export const BAKE_STRIDE = OUTPUT_KEYS.reduce((n, k) => n + (OUTPUT_TYPES[k] === 'float' ? 1 : 3), 0);
/** Where each output starts in a texel's floats. */
const OUTPUT_OFFSETS: readonly number[] = (() => {
  const out: number[] = [];
  let at = 0;
  for (const k of OUTPUT_KEYS) {
    out.push(at);
    at += OUTPUT_TYPES[k] === 'float' ? 1 : 3;
  }
  return out;
})();
const offsetOf = (k: string): number => OUTPUT_OFFSETS[OUTPUT_KEYS.indexOf(k)];

/** Rows `r0` to `r1` (exclusive, from the top) of a bake: the outputs of each texel and the frame of its normal map. */
export interface BakeBand {
  size: number;
  r0: number;
  r1: number;
  /** BAKE_STRIDE floats per texel. */
  floats: Float32Array;
  /** Nine floats per texel: the map's u and v directions on the surface and its normal. */
  frames: Float32Array;
}

/** Evaluates rows `r0` to `r1` of a bake of `size` × `size` texels (a worker may take a band each). */
export function bakeRows(p: Program, images: readonly (ImagePixels | null)[], plan: BakePlan, size: number, r0 = 0, r1 = size): BakeBand {
  const run = new ProgramRunner(p, images);
  const n = (r1 - r0) * size;
  const floats = new Float32Array(n * BAKE_STRIDE);
  const frames = new Float32Array(n * 9);
  const pt = newShadingPoint();
  const tu = [0, 0, 0];
  const tv = [0, 0, 0];
  const outs = p.outputs;
  for (let row = r0; row < r1; row++) {
    const t = 1 - (row + 0.5) / size;
    for (let col = 0; col < size; col++) {
      const i = (row - r0) * size + col;
      fillBakePoint(plan, (col + 0.5) / size, t, pt, tu, tv);
      run.setPoint(pt);
      run.run();
      for (let j = 0; j < outs.length; j++) run.read(outs[j], floats, i * BAKE_STRIDE + OUTPUT_OFFSETS[j]);
      const fo = i * 9;
      frames[fo] = tu[0];
      frames[fo + 1] = tu[1];
      frames[fo + 2] = tu[2];
      frames[fo + 3] = tv[0];
      frames[fo + 4] = tv[1];
      frames[fo + 5] = tv[2];
      frames[fo + 6] = pt.N[0];
      frames[fo + 7] = pt.N[1];
      frames[fo + 8] = pt.N[2];
    }
  }
  return { size, r0, r1, floats, frames };
}

/** The maps and values of a bake from its bands (in any order; together they cover every row). */
export function finishBake(p: Program, bands: readonly BakeBand[], size: number): BakeResult {
  const n = size * size;
  const total = BAKE_STRIDE;
  const sum = new Float64Array(total);
  const min = new Float64Array(total).fill(Infinity);
  const max = new Float64Array(total).fill(-Infinity);
  for (const b of bands) {
    const m = (b.r1 - b.r0) * size;
    for (let i = 0; i < m; i++) {
      for (let c = 0; c < total; c++) {
        const v = b.floats[i * total + c];
        const x = Number.isFinite(v) ? v : 0;
        sum[c] += x;
        if (x < min[c]) min[c] = x;
        if (x > max[c]) max[c] = x;
      }
    }
  }
  const keys = OUTPUT_KEYS;
  const values: OutputValues = {};
  const varying: string[] = [];
  // The normal is the surface's own when the graph gives it nothing (the context register N): no map then.
  const ownNormal = (k: string, j: number) => k === 'normal' && p.outputs[j].kind === 'V' && p.outputs[j].index === CTX.N;
  keys.forEach((k, j) => {
    const o = OUTPUT_OFFSETS[j];
    const w = OUTPUT_TYPES[k] === 'float' ? 1 : 3;
    values[k] = w === 1 ? sum[o] / n : [sum[o] / n, sum[o + 1] / n, sum[o + 2] / n];
    let v = false;
    for (let c = 0; c < w; c++) if (max[o + c] - min[o + c] > 1e-6) v = true;
    if (v && !ownNormal(k, j)) varying.push(k);
  });
  const maps: BakeResult['maps'] = {};
  const img = () => new Uint8ClampedArray(n * 4);
  const each = (fn: (b: BakeBand, i: number, at: number) => void) => {
    for (const b of bands) {
      const m = (b.r1 - b.r0) * size;
      for (let i = 0; i < m; i++) fn(b, i, (b.r0 * size + i) * 4);
    }
  };
  const scalarMap = (k: string): Uint8ClampedArray => {
    const out = img();
    const o = offsetOf(k);
    each((b, i, at) => {
      const v = toByte(b.floats[i * total + o]);
      out[at] = out[at + 1] = out[at + 2] = v;
      out[at + 3] = 255;
    });
    return out;
  };
  if (varying.includes('baseColor')) {
    const out = img();
    const o = offsetOf('baseColor');
    each((b, i, at) => {
      out[at] = toSrgbByte(b.floats[i * total + o]);
      out[at + 1] = toSrgbByte(b.floats[i * total + o + 1]);
      out[at + 2] = toSrgbByte(b.floats[i * total + o + 2]);
      out[at + 3] = 255;
    });
    maps.color = out;
  }
  if (varying.includes('roughness')) maps.roughness = scalarMap('roughness');
  if (varying.includes('metallic')) maps.metal = scalarMap('metallic');
  if (varying.includes('opacity')) maps.alpha = scalarMap('opacity');
  if (varying.includes('normal')) {
    const out = img();
    const o = offsetOf('normal');
    each((b, i, at) => {
      const x = b.floats[i * total + o];
      const y = b.floats[i * total + o + 1];
      const z = b.floats[i * total + o + 2];
      const fr = b.frames;
      const f0 = i * 9;
      out[at] = toByte(0.5 + (x * fr[f0] + y * fr[f0 + 1] + z * fr[f0 + 2]) / 2);
      out[at + 1] = toByte(0.5 + (x * fr[f0 + 3] + y * fr[f0 + 4] + z * fr[f0 + 5]) / 2);
      out[at + 2] = toByte(0.5 + (x * fr[f0 + 6] + y * fr[f0 + 7] + z * fr[f0 + 8]) / 2);
      out[at + 3] = 255;
    });
    maps.normal = out;
  }
  let emissionScale = 0;
  if (varying.includes('emission') || varying.includes('emissionStrength')) {
    const oe = offsetOf('emission');
    const os = offsetOf('emissionStrength');
    each((b, i) => {
      for (let c = 0; c < 3; c++) emissionScale = Math.max(emissionScale, b.floats[i * total + oe + c] * b.floats[i * total + os]);
    });
    if (emissionScale > 0) {
      const out = img();
      each((b, i, at) => {
        for (let c = 0; c < 3; c++) out[at + c] = toSrgbByte((b.floats[i * total + oe + c] * b.floats[i * total + os]) / emissionScale);
        out[at + 3] = 255;
      });
      maps.emission = out;
    }
  }
  return { size, maps, emissionScale, values, varying };
}

/** Evaluates a program over a plan's surface at `size` × `size` texels, in one go. */
export function bakeProgram(p: Program, images: readonly (ImagePixels | null)[], plan: BakePlan, size = BAKE_SIZE): BakeResult {
  return finishBake(p, [bakeRows(p, images, plan, size)], size);
}

/** The approximation notes of a plan with the outputs that vary but have no map (drawn with their mean). */
export function bakeNotes(plan: BakePlan, varying: readonly string[]): { notes: BakeNote[]; means: string[] } {
  const means = varying.filter((k) => !MAPPED_OUTPUTS.includes(k));
  return { notes: means.length > 0 ? [...plan.notes, 'MEANS'] : plan.notes, means };
}

// --- Plain values -------------------------------------------------------------------------------------

/** 64 points spread over the preview sphere (a Fibonacci lattice), facing the viewer along their normal. */
export function samplePoints(count = 64): ShadingPoint[] {
  const out: ShadingPoint[] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i++) {
    const z = 1 - (2 * (i + 0.5)) / count;
    const r = Math.sqrt(1 - z * z);
    const a = golden * i;
    const N: [number, number, number] = [Math.cos(a) * r, Math.sin(a) * r, z];
    const T: [number, number, number] = norm3(-Math.sin(a), Math.cos(a), 0);
    const R = PREVIEW_RADIUS_MM;
    const u = ((a / (2 * Math.PI)) % 1 + 1) % 1;
    out.push({ P: [N[0] * R, N[1] * R, N[2] * R], N, UV0: [u, (z + 1) / 2, 0], UV1: [u, (z + 1) / 2, 0], I: N, T, B: cross3(N, T), dUVdT: [1 / (2 * Math.PI * R), 0, 0], dUVdB: [0, 1 / (Math.PI * R), 0] });
  }
  return out;
}

/** The decoded pixels the registry has for a program's images (null where it has none yet). */
export function registryPixels(p: Program): (ImagePixels | null)[] {
  return p.images.map((im) => {
    const data = im.image ? getImage(im.image.id) : undefined;
    return data?.rgba8 ? { width: data.width, height: data.height, rgba: data.rgba8 } : null;
  });
}

/** The mean of each output over `samplePoints`. */
export function meanOutputs(p: Program, images: readonly (ImagePixels | null)[]): OutputValues {
  const run = new ProgramRunner(p, images);
  const pts = samplePoints();
  const acc: OutputValues = {};
  for (const pt of pts) {
    run.setPoint(pt);
    run.run();
    const o = readOutputs(run, p);
    for (const k of OUTPUT_KEYS) {
      const v = o[k];
      const a = acc[k];
      if (typeof v === 'number') acc[k] = ((a as number | undefined) ?? 0) + v / pts.length;
      else acc[k] = [((a as number[] | undefined)?.[0] ?? 0) + v[0] / pts.length, ((a as number[] | undefined)?.[1] ?? 0) + v[1] / pts.length, ((a as number[] | undefined)?.[2] ?? 0) + v[2] / pts.length];
    }
  }
  return acc;
}

/** A family and parameters that stand for output values (the engine's material before it evaluates graphs, M3b). */
export function paramsOfOutputs(o: OutputValues, absorptionMm: number, thinWalls: boolean): { family: MaterialFamily; params: MaterialParams } {
  const c = (k: string) => o[k] as number[];
  const n = (k: string) => o[k] as number;
  const emission = c('emission');
  const strength = n('emissionStrength');
  if (strength > 0 && Math.max(...emission) > 1e-6) {
    return { family: 'EMISSIVE', params: { emitKind: 'COLOR', emitColor: [emission[0], emission[1], emission[2], 1], emitPower: strength / EMIT_RADIANCE_PER_WATT } };
  }
  const base = c('baseColor');
  if (absorptionMm > 0 || thinWalls) {
    return { family: 'GLASS', params: { baseColor: [base[0], base[1], base[2], 1], roughness: n('roughness'), ior: n('ior'), transmission: n('transmission'), absorptionMm, walls: thinWalls ? 'THIN' : 'SOLID' } };
  }
  return {
    family: 'SIMPLE',
    params: {
      baseColor: [base[0], base[1], base[2], 1],
      metallic: n('metallic'),
      roughness: n('roughness'),
      coat: n('coat'),
      coatRoughness: n('coatRoughness'),
      ior: n('ior'),
      transmission: n('transmission'),
      opacity: n('opacity'),
      anisotropic: n('anisotropic'),
      subsurface: n('subsurface'),
    },
  };
}

const flatCache = new WeakMap<MaterialGraph, { family: MaterialFamily; params: MaterialParams }>();

/**
 * The family and parameters that stand for a graph where it cannot be evaluated: the mean of each output over the
 * sample points (images as far as the registry has decoded them). Cached per graph object; a graph that does not
 * compile stands for the default grey.
 */
export function flattenGraph(g: MaterialGraph): { family: MaterialFamily; params: MaterialParams } {
  const hit = flatCache.get(g);
  if (hit) return hit;
  const { program } = compileGraph(g);
  const out = program ? paramsOfOutputs(meanOutputs(program, registryPixels(program)), program.absorptionMm, program.thinWalls) : { family: 'SIMPLE' as const, params: { baseColor: [0.8, 0.8, 0.8, 1] as const } };
  flatCache.set(g, out);
  return out;
}
