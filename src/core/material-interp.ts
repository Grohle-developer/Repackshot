// The reference interpreter of material programs (phase M3a): what each instruction of core/material-program.ts does,
// in f32, step by step, in the order ARCHITECTURE §5.2 quater writes. The node previews of the editor and the Fast
// preview's textures run it (core/material-preview.ts); the engine's interpreter (M3b) gives the same bits for the
// same program and point (the cross test pins 1000 points per example graph).
//
// Registers are Float32Arrays, so every value stored is rounded to f32; intermediate results are rounded with
// `f` (Math.fround) where the engine rounds them, which is after every operation. min, max and clamp are written
// as comparisons (`b < a ? b : a`), never as Math.min: a NaN goes through them the same way in both
// implementations.

import { asin, atan2, FRAC_PI_2, f, PI, powf, sin, sqrt, TAU } from './f32math';
import { channelSeed, fbm } from './noise';
import { CTX, OP, WORDS, type Program, type ValueRef } from './material-program';
import { bump, IDENTITY_PLACEMENT, PATTERN_CLOTH, PATTERN_WOOD, recipeOf, sampleAt, type Placement, type Recipe, type Sampled, type V as V3f } from './patterns';

/**
 * M3c: where the patterns of a program lie (rt_core's `Host::placement`): the placement of the pattern instructions
 * with recipe constants at `k` and `PATN` kind `kind`, or null for the point's own space (`IDENTITY_PLACEMENT`).
 */
export type PlacementOf = (k: number, kind: number) => Placement | null;

/** The `PATN` kind a pattern opcode draws, 0 for any other. */
export function patternKind(op: number): number {
  if (op === OP.WOOD || op === OP.WOODR || op === OP.WOODH || op === OP.WOODN) return PATTERN_WOOD;
  if (op === OP.CLOTH || op === OP.CLOTHR || op === OP.CLOTHH || op === OP.CLOTHN) return PATTERN_CLOTH;
  return 0;
}

/** An image's pixels: straight 8-bit RGBA, rows from the top. */
export interface ImagePixels {
  width: number;
  height: number;
  rgba: Uint8Array | Uint8ClampedArray;
}

/** The shading point a program runs at (part space; the meaning of each is `CTX`'s). */
export interface ShadingPoint {
  P: readonly number[];
  N: readonly number[];
  UV0: readonly number[];
  UV1: readonly number[];
  I: readonly number[];
  T: readonly number[];
  B: readonly number[];
  dUVdT: readonly number[];
  dUVdB: readonly number[];
}

const LUM_R = f(0.2126);
const LUM_G = f(0.7152);
const LUM_B = f(0.0722);

/** sRGB (8-bit) to linear, per byte: c ≤ 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055)^2.4, with c = byte / 255, in f32 with fmath's powf. */
export const SRGB_TO_LINEAR: Float32Array = (() => {
  const t = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const c = f(i / 255);
    t[i] = c <= f(0.04045) ? f(c / f(12.92)) : powf(f(f(c + f(0.055)) / f(1.055)), f(2.4));
  }
  return t;
})();
/** byte / 255 in f32 (data channels and alpha). */
const BYTE_TO_UNIT: Float32Array = (() => {
  const t = new Float32Array(256);
  for (let i = 0; i < 256; i++) t[i] = f(i / 255);
  return t;
})();

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
const lerp = (a: number, b: number, t: number): number => f(a + f(t * f(b - a)));

/** smoothstep(e0, e1, x): a step at e0 when the edges are equal. */
export function smoothstep(e0: number, e1: number, x: number): number {
  if (!(e1 > e0) && !(e1 < e0)) return x < e0 ? 0 : 1;
  const t = clamp01(f(f(x - e0) / f(e1 - e0)));
  return f(f(t * t) * f(3 - f(2 * t)));
}

/** The power of the Maths node: x^y for x > 0; 0^y is 1 for y = 0 and 0 otherwise; a negative x only with an integer y. */
export function powOp(x: number, y: number): number {
  if (x > 0) return powf(x, y);
  if (x === 0) return y === 0 ? 1 : 0;
  if (x < 0 && y === Math.floor(y) && Math.abs(y) <= 16777216) {
    const r = powf(f(-x), y);
    return y % 2 !== 0 ? f(-r) : r;
  }
  return x !== x ? x : 0;
}

/** Polynomial smooth minimum with blend distance k (k ≤ 0: the minimum). */
export function smoothMin(x: number, y: number, k: number): number {
  const m = y < x ? y : x;
  if (!(k > 0)) return m;
  const h0 = f(k - Math.abs(f(x - y)));
  const h = f((h0 > 0 ? h0 : 0) / k);
  return f(m - f(f(f(h * h) * k) * 0.25));
}

/**
 * An orthonormal tangent for a unit normal without one (J. R. Frisvad's construction as revised by Duff et al.,
 * "Building an orthonormal basis, revisited", JCGT 2017): s = −1 when n.z < 0 (else 1), a = −1 / (s + n.z),
 * b = n.x·n.y·a, T = (1 + s·n.x²·a, s·b, −s·n.x).
 */
export function onbTangent(nx: number, ny: number, nz: number, out: Float32Array | number[], at = 0): void {
  const s = nz < 0 ? -1 : 1;
  const a = f(-1 / f(s + nz));
  const b = f(f(nx * ny) * a);
  out[at] = f(1 + f(f(f(s * nx) * nx) * a));
  out[at + 1] = f(s * b);
  out[at + 2] = f(-f(s * nx));
}

/** Scratch for the tangent frames of NMAP and BUMP. */
const FRAME = new Float32Array(6);

/** T orthogonalised against n (the onb tangent when they are parallel), then B = n × T, into FRAME. */
function frameAround(V: Float32Array, n: number): void {
  const nx = V[n];
  const ny = V[n + 1];
  const nz = V[n + 2];
  const t = CTX.T * 3;
  const k = f(f(f(V[t] * nx) + f(V[t + 1] * ny)) + f(V[t + 2] * nz));
  let tx = f(V[t] - f(k * nx));
  let ty = f(V[t + 1] - f(k * ny));
  let tz = f(V[t + 2] - f(k * nz));
  const l = sqrt(f(f(f(tx * tx) + f(ty * ty)) + f(tz * tz)));
  if (l > f(1e-6)) {
    tx = f(tx / l);
    ty = f(ty / l);
    tz = f(tz / l);
  } else {
    onbTangent(nx, ny, nz, FRAME, 0);
    tx = FRAME[0];
    ty = FRAME[1];
    tz = FRAME[2];
  }
  FRAME[0] = tx;
  FRAME[1] = ty;
  FRAME[2] = tz;
  // B = n × T.
  FRAME[3] = f(f(ny * tz) - f(nz * ty));
  FRAME[4] = f(f(nz * tx) - f(nx * tz));
  FRAME[5] = f(f(nx * ty) - f(ny * tx));
}

/** Writes normalize(x, y, z) at V[d], or V[fb] when its length is not above 0. */
function normalizeInto(V: Float32Array, d: number, x: number, y: number, z: number, fb: number): void {
  const l = sqrt(f(f(f(x * x) + f(y * y)) + f(z * z)));
  if (!(l > 0)) {
    V[d] = V[fb];
    V[d + 1] = V[fb + 1];
    V[d + 2] = V[fb + 2];
    return;
  }
  V[d] = f(x / l);
  V[d + 1] = f(y / l);
  V[d + 2] = f(z / l);
}

/** Turns about an axis, −0.5..0.5, 0 facing −T of the cross-section (core/textures.ts `turnsAbout`). */
function turns(s: number, t: number): number {
  const c = f(f(atan2(t, s) + FRAC_PI_2) / TAU);
  return f(c - Math.floor(f(c + 0.5)));
}

/** A texel index past the edge, brought back (0 repeat, 1 clamp, 2 mirror). */
function wrapIndex(i: number, n: number, wrap: number): number {
  if (wrap === 1) return i < 0 ? 0 : i >= n ? n - 1 : i;
  if (wrap === 2) {
    const m = ((i % (2 * n)) + 2 * n) % (2 * n);
    return m < n ? m : 2 * n - 1 - m;
  }
  return ((i % n) + n) % n;
}

/** A coordinate brought into one period before it is scaled to texels (0 repeat: [0, 1); 1 clamp: [0, 1]; 2 mirror: [0, 2)). */
function reduceCoord(u: number, wrap: number): number {
  if (!Number.isFinite(u)) return 0;
  if (wrap === 1) return clamp01(u);
  if (wrap === 2) return f(u - f(2 * Math.floor(f(u / 2))));
  return f(u - Math.floor(u));
}

export class ProgramRunner {
  /** The f32 registers. */
  readonly F: Float32Array;
  /** The vec3 registers, three floats each; the first `CTX_COUNT` are the shading point. */
  readonly V: Float32Array;
  private readonly code: Int32Array;
  private readonly C: Float32Array;
  private readonly pixels: (ImagePixels | null)[];
  private readonly srgb: boolean[];
  private readonly wrap: number[];
  /** M3c: per instruction, a pattern instruction's recipe (null: another opcode, or a recipe that draws nothing). */
  private readonly recipes: (Recipe | null)[];
  /** M3c: the last pattern sampled (its constants, kind, point and normal) and what it gave. */
  private last: { k: number; kind: number; key: number[]; s: Sampled } | null = null;

  /**
   * `images`: the pixels of each entry of the program's image table, in order (null or missing: not there).
   * `placement`: where the patterns lie (M3c; by default the point's own space).
   */
  constructor(
    readonly program: Program,
    images: readonly (ImagePixels | null | undefined)[] = [],
    private readonly placement: PlacementOf = () => null,
  ) {
    this.F = new Float32Array(Math.max(1, program.nF));
    this.V = new Float32Array(Math.max(9, program.nV) * 3);
    this.code = program.code;
    this.C = program.consts;
    this.pixels = program.images.map((im, i) => (im.image ? (images[i] ?? null) : null));
    this.srgb = program.images.map((im) => im.srgb);
    this.wrap = program.images.map((im) => im.wrap);
    this.recipes = [];
    for (let pc = 0; pc < program.code.length; pc += WORDS) {
      const kind = patternKind(program.code[pc]);
      this.recipes.push(kind ? recipeOf(kind, program.consts, program.code[pc + 5]) : null);
    }
  }

  /** M3c: the pattern of instruction `pc` at the point `a` with the normal `b` (V registers), sampled once per node. */
  private pattern(pc: number, a3: number, b3: number, k: number): Sampled | null {
    const recipe = this.recipes[pc / WORDS];
    if (!recipe) return null;
    const V = this.V;
    const kind = patternKind(this.code[pc]);
    const key = [V[a3], V[a3 + 1], V[a3 + 2], V[b3], V[b3 + 1], V[b3 + 2]];
    const last = this.last;
    if (last && last.k === k && last.kind === kind && last.key.every((x, i) => Object.is(x, key[i]))) return last.s;
    const p: V3f = [key[0], key[1], key[2]];
    const n: V3f = [key[3], key[4], key[5]];
    const s = sampleAt(recipe, this.placement(k, kind) ?? IDENTITY_PLACEMENT, p, n, n);
    this.last = { k, kind, key, s };
    return s;
  }

  /** Puts a shading point in the context registers. */
  setPoint(pt: ShadingPoint): void {
    const V = this.V;
    const vs = [pt.P, pt.N, pt.UV0, pt.UV1, pt.I, pt.T, pt.B, pt.dUVdT, pt.dUVdB];
    for (let r = 0; r < 9; r++) {
      const v = vs[r];
      V[r * 3] = v[0];
      V[r * 3 + 1] = v[1];
      V[r * 3 + 2] = v.length > 2 ? v[2] : 0;
    }
  }

  /** A value of the program after `run`: one number for an f32, three for a vec3, into `out` from `at`. */
  read(ref: ValueRef, out: Float32Array | number[], at = 0): void {
    switch (ref.kind) {
      case 'F':
        out[at] = this.F[ref.index];
        return;
      case 'FC':
        out[at] = this.C[ref.index];
        return;
      case 'V':
        out[at] = this.V[ref.index * 3];
        out[at + 1] = this.V[ref.index * 3 + 1];
        out[at + 2] = this.V[ref.index * 3 + 2];
        return;
      case 'VC':
        out[at] = this.C[ref.index];
        out[at + 1] = this.C[ref.index + 1];
        out[at + 2] = this.C[ref.index + 2];
        return;
    }
  }

  /** Bilinear read of image `k` at (u, v) (v up) into V[d] and F[fa] (alpha; −1: none). */
  private tex(k: number, u: number, v: number, d: number, fa: number): void {
    const V = this.V;
    const px = this.pixels[k];
    if (!px || px.width <= 0 || px.height <= 0) {
      V[d] = 1;
      V[d + 1] = 1;
      V[d + 2] = 1;
      if (fa >= 0) this.F[fa] = 0;
      return;
    }
    const w = px.width;
    const h = px.height;
    const wrap = this.wrap[k];
    const lut = this.srgb[k] ? SRGB_TO_LINEAR : BYTE_TO_UNIT;
    const ru = reduceCoord(u, wrap);
    const rv = reduceCoord(f(1 - v), wrap);
    const x = f(f(ru * w) - 0.5);
    const y = f(f(rv * h) - 0.5);
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = f(x - x0);
    const fy = f(y - y0);
    const i0 = wrapIndex(x0, w, wrap);
    const i1 = wrapIndex(x0 + 1, w, wrap);
    const j0 = wrapIndex(y0, h, wrap);
    const j1 = wrapIndex(y0 + 1, h, wrap);
    const rgba = px.rgba;
    const o00 = (j0 * w + i0) * 4;
    const o10 = (j0 * w + i1) * 4;
    const o01 = (j1 * w + i0) * 4;
    const o11 = (j1 * w + i1) * 4;
    for (let c = 0; c < 3; c++) {
      const top = lerp(lut[rgba[o00 + c]], lut[rgba[o10 + c]], fx);
      const bottom = lerp(lut[rgba[o01 + c]], lut[rgba[o11 + c]], fx);
      V[d + c] = lerp(top, bottom, fy);
    }
    if (fa >= 0) {
      const top = lerp(BYTE_TO_UNIT[rgba[o00 + 3]], BYTE_TO_UNIT[rgba[o10 + 3]], fx);
      const bottom = lerp(BYTE_TO_UNIT[rgba[o01 + 3]], BYTE_TO_UNIT[rgba[o11 + 3]], fx);
      this.F[fa] = lerp(top, bottom, fy);
    }
  }

  /** MAP: the coordinates of a projection (consts at k: projection, axis, size, cos, sin, repeat u, v, offset u, v). */
  private map(d: number, p: number, n: number, uv: number, k: number): void {
    const V = this.V;
    const C = this.C;
    const proj = C[k];
    const axis = C[k + 1];
    const size = C[k + 2];
    const cos = C[k + 3];
    const sinr = C[k + 4];
    const ru = C[k + 5];
    const rv = C[k + 6];
    const ou = C[k + 7];
    const ov = C[k + 8];
    const px = V[p];
    const py = V[p + 1];
    const pz = V[p + 2];
    let cu = 0;
    let cv = 0;
    let w = 0;
    let centre = 0.5;
    // The cross-section axes (S, T, A) of `axis`: Z (x, y, z), X (y, z, x), Y (z, x, y).
    const S = axis === 2 ? px : axis === 0 ? py : pz;
    const T = axis === 2 ? py : axis === 0 ? pz : px;
    const A = axis === 2 ? pz : axis === 0 ? px : py;
    switch (proj) {
      case 0: // UV
        cu = V[uv];
        cv = V[uv + 1];
        centre = 0;
        break;
      case 1: {
        // PLANAR: Z from above (x, y), Y from the front (x, z), X from +X (y, z).
        const s = axis === 2 ? px : axis === 1 ? px : py;
        const t = axis === 2 ? py : pz;
        cu = f(s / size);
        cv = f(t / size);
        break;
      }
      case 2: {
        // BOX: the face whose axis the normal is closest to, seen from outside, never mirrored.
        const ax = Math.abs(V[n]);
        const ay = Math.abs(V[n + 1]);
        const az = Math.abs(V[n + 2]);
        let s: number;
        let t: number;
        if (ax >= ay && ax >= az) {
          s = V[n] >= 0 ? py : f(-py);
          t = pz;
        } else if (ay >= az) {
          s = V[n + 1] <= 0 ? px : f(-px);
          t = pz;
        } else {
          s = V[n + 2] >= 0 ? px : f(-px);
          t = py;
        }
        cu = f(s / size);
        cv = f(t / size);
        break;
      }
      case 3: // CYLINDRICAL
        cu = turns(S, T);
        cv = f(A / size);
        break;
      case 4: {
        // SPHERICAL
        const r = sqrt(f(f(f(px * px) + f(py * py)) + f(pz * pz)));
        cu = turns(S, T);
        cv = r > 0 ? f(asin(f(A / r)) / PI) : 0;
        break;
      }
      default: // OBJECT
        cu = f(S / size);
        cv = f(T / size);
        w = f(A / size);
        centre = 0;
        break;
    }
    const x = f(cu * ru);
    const y = f(cv * rv);
    V[d] = f(f(f(f(cos * x) - f(sinr * y)) + ou) + centre);
    V[d + 1] = f(f(f(f(sinr * x) + f(cos * y)) + ov) + centre);
    V[d + 2] = w;
  }

  /** Runs the program at the point in the context registers. */
  run(): void {
    const code = this.code;
    const C = this.C;
    const F = this.F;
    const V = this.V;
    this.last = null;
    for (let pc = 0; pc < code.length; pc += WORDS) {
      const d = code[pc + 1];
      const a = code[pc + 2];
      const b = code[pc + 3];
      const c = code[pc + 4];
      const k = code[pc + 5];
      const d3 = d * 3;
      const a3 = a * 3;
      const b3 = b * 3;
      switch (code[pc]) {
        case OP.NOP:
          break;
        case OP.FCONST:
          F[d] = C[k];
          break;
        case OP.VCONST:
          V[d3] = C[k];
          V[d3 + 1] = C[k + 1];
          V[d3 + 2] = C[k + 2];
          break;
        case OP.FMOV:
          F[d] = F[a];
          break;
        case OP.VMOV:
          V[d3] = V[a3];
          V[d3 + 1] = V[a3 + 1];
          V[d3 + 2] = V[a3 + 2];
          break;
        case OP.F2V:
          V[d3] = V[d3 + 1] = V[d3 + 2] = F[a];
          break;
        case OP.VLUM:
          F[d] = f(f(f(V[a3] * LUM_R) + f(V[a3 + 1] * LUM_G)) + f(V[a3 + 2] * LUM_B));
          break;
        case OP.VAVG:
          F[d] = f(f(f(V[a3] + V[a3 + 1]) + V[a3 + 2]) / 3);
          break;
        case OP.VX:
          F[d] = V[a3];
          break;
        case OP.VY:
          F[d] = V[a3 + 1];
          break;
        case OP.VZ:
          F[d] = V[a3 + 2];
          break;
        case OP.VCOMB:
          V[d3] = F[a];
          V[d3 + 1] = F[b];
          V[d3 + 2] = F[c];
          break;
        case OP.FADD:
          F[d] = F[a] + F[b];
          break;
        case OP.FSUB:
          F[d] = F[a] - F[b];
          break;
        case OP.FMUL:
          F[d] = F[a] * F[b];
          break;
        case OP.FDIV:
          F[d] = F[b] === 0 ? 0 : F[a] / F[b];
          break;
        case OP.FPOW:
          F[d] = powOp(F[a], F[b]);
          break;
        case OP.FMIN:
          F[d] = F[b] < F[a] ? F[b] : F[a];
          break;
        case OP.FMAX:
          F[d] = F[b] > F[a] ? F[b] : F[a];
          break;
        case OP.FSMIN:
          F[d] = smoothMin(F[a], F[b], F[c]);
          break;
        case OP.FSMAX:
          F[d] = -smoothMin(-F[a], -F[b], F[c]);
          break;
        case OP.FABS:
          F[d] = Math.abs(F[a]);
          break;
        case OP.FSSTEP:
          F[d] = smoothstep(F[b], F[c], F[a]);
          break;
        case OP.FMADD:
          F[d] = f(F[a] * F[b]) + F[c];
          break;
        case OP.FLT:
          F[d] = F[a] < F[b] ? 1 : 0;
          break;
        case OP.FGT:
          F[d] = F[a] > F[b] ? 1 : 0;
          break;
        case OP.FFLOOR:
          F[d] = Math.floor(F[a]);
          break;
        case OP.FFRACT:
          F[d] = F[a] - Math.floor(F[a]);
          break;
        case OP.FSIN:
          F[d] = sin(F[a]);
          break;
        case OP.FCLAMP:
          F[d] = clamp01(F[a]);
          break;
        case OP.FLERP:
          F[d] = lerp(F[a], F[b], F[c]);
          break;
        case OP.FINV:
          F[d] = 1 - F[a];
          break;
        case OP.VADD:
          V[d3] = V[a3] + V[b3];
          V[d3 + 1] = V[a3 + 1] + V[b3 + 1];
          V[d3 + 2] = V[a3 + 2] + V[b3 + 2];
          break;
        case OP.VSUB:
          V[d3] = V[a3] - V[b3];
          V[d3 + 1] = V[a3 + 1] - V[b3 + 1];
          V[d3 + 2] = V[a3 + 2] - V[b3 + 2];
          break;
        case OP.VMUL:
          V[d3] = V[a3] * V[b3];
          V[d3 + 1] = V[a3 + 1] * V[b3 + 1];
          V[d3 + 2] = V[a3 + 2] * V[b3 + 2];
          break;
        case OP.VSCALE: {
          const s = F[b];
          V[d3] = V[a3] * s;
          V[d3 + 1] = V[a3 + 1] * s;
          V[d3 + 2] = V[a3 + 2] * s;
          break;
        }
        case OP.VLERP: {
          const t = F[c];
          V[d3] = lerp(V[a3], V[b3], t);
          V[d3 + 1] = lerp(V[a3 + 1], V[b3 + 1], t);
          V[d3 + 2] = lerp(V[a3 + 2], V[b3 + 2], t);
          break;
        }
        case OP.VCLAMP:
          V[d3] = clamp01(V[a3]);
          V[d3 + 1] = clamp01(V[a3 + 1]);
          V[d3 + 2] = clamp01(V[a3 + 2]);
          break;
        case OP.VNORM:
          normalizeInto(V, d3, V[a3], V[a3 + 1], V[a3 + 2], b3);
          break;
        case OP.VINV:
          V[d3] = 1 - V[a3];
          V[d3 + 1] = 1 - V[a3 + 1];
          V[d3 + 2] = 1 - V[a3 + 2];
          break;
        case OP.VDOT:
          F[d] = f(f(V[a3] * V[b3]) + f(V[a3 + 1] * V[b3 + 1])) + f(V[a3 + 2] * V[b3 + 2]);
          break;
        case OP.VLEN:
          F[d] = sqrt(f(f(f(V[a3] * V[a3]) + f(V[a3 + 1] * V[a3 + 1])) + f(V[a3 + 2] * V[a3 + 2])));
          break;
        case OP.BLEND:
          this.blend(k, d3, a3, b3, clamp01(F[c]));
          break;
        case OP.MAP:
          this.map(d3, a3, b3, c * 3, k);
          break;
        case OP.TEX:
          this.tex(k, V[a3], V[a3 + 1], d3, b);
          break;
        case OP.NOISE: {
          const s = F[b];
          F[d] = fbm(C[k] === 1 ? 'SIMPLEX' : 'PERLIN', f(V[a3] * s), f(V[a3 + 1] * s), f(V[a3 + 2] * s), C[k + 1], C[k + 2], C[k + 3], C[k + 4] >>> 0);
          break;
        }
        case OP.NOISEC: {
          const s = F[b];
          const kind = C[k] === 1 ? 'SIMPLEX' : 'PERLIN';
          const x = f(V[a3] * s);
          const y = f(V[a3 + 1] * s);
          const z = f(V[a3 + 2] * s);
          for (let ch = 0; ch < 3; ch++) V[d3 + ch] = fbm(kind, x, y, z, C[k + 1], C[k + 2], C[k + 3], channelSeed(C[k + 4] >>> 0, ch));
          break;
        }
        case OP.GRAD:
          F[d] = gradient(k, V[a3], V[a3 + 1], V[a3 + 2]);
          break;
        case OP.CHECK: {
          const s = F[b];
          const sum = f(f(Math.floor(f(V[a3] * s)) + Math.floor(f(V[a3 + 1] * s))) + Math.floor(f(V[a3 + 2] * s)));
          F[d] = f(sum - f(2 * Math.floor(f(sum * 0.5))));
          break;
        }
        case OP.STRIPE: {
          const axis = C[k];
          const q = f(V[a3 + (axis === 1 ? 1 : axis === 2 ? 2 : 0)] * F[b]);
          const t = f(q - Math.floor(q));
          const w = clamp01(F[c]);
          const half = f(w * 0.5);
          const away = Math.abs(f(t - half));
          const other = f(1 - away);
          const dist = other < away ? other : away;
          const narrow = f(1 - w) < w ? f(1 - w) : w;
          const e = f(f(clamp01(C[k + 1]) * 0.5) * narrow);
          F[d] = f(1 - smoothstep(f(half - e), f(half + e), dist));
          break;
        }
        case OP.RAMP:
          this.ramp(k, clamp01(F[a]), d3);
          break;
        case OP.FRESNEL:
          F[d] = fresnel(F[a], f(f(f(V[c * 3] * V[b3]) + f(V[c * 3 + 1] * V[b3 + 1])) + f(V[c * 3 + 2] * V[b3 + 2])));
          break;
        case OP.FACING: {
          const cosv = f(f(f(V[c * 3] * V[b3]) + f(V[c * 3 + 1] * V[b3 + 1])) + f(V[c * 3 + 2] * V[b3 + 2]));
          const fc = f(1 - clamp01(Math.abs(cosv)));
          const bl = F[a] < 0.001 ? f(0.001) : F[a] > 0.999 ? f(0.999) : F[a];
          F[d] = fc > 0 ? powf(fc, f(f(1 - bl) / bl)) : 0;
          break;
        }
        case OP.EDGE:
        case OP.CAVITY:
          // The engine measures the part's curvature (M3b); the reference has no geometry around the point.
          F[d] = 0;
          break;
        case OP.NMAP: {
          const s = F[b];
          const mx = f(f(2 * V[a3]) - 1);
          const my = f(f(2 * V[a3 + 1]) - 1);
          const mz = f(f(2 * V[a3 + 2]) - 1);
          const n = c * 3;
          // C1: no normal points into the surface (the engine's program/interp.rs does the same): in tangent space a blue
          // below 0.5 has its 2b − 1 mirrored, and in the part's space a result past the surface is mirrored across it.
          if (k === 1) {
            // In the part's space: towards the map's direction by the strength.
            normalizeInto(V, d3, mx, my, mz, n);
            const tx = V[d3];
            const ty = V[d3 + 1];
            const tz = V[d3 + 2];
            normalizeInto(V, d3, f(V[n] + f(s * f(tx - V[n]))), f(V[n + 1] + f(s * f(ty - V[n + 1]))), f(V[n + 2] + f(s * f(tz - V[n + 2]))), n);
            // C1: past the surface (a map against it, at a strength over 0.5), mirrored across its plane.
            const back = f(f(f(V[d3] * V[n]) + f(V[d3 + 1] * V[n + 1])) + f(V[d3 + 2] * V[n + 2]));
            if (back < 0) {
              const t2 = f(2 * back);
              normalizeInto(V, d3, f(V[d3] - f(t2 * V[n])), f(V[d3 + 1] - f(t2 * V[n + 1])), f(V[d3 + 2] - f(t2 * V[n + 2])), n);
            }
          } else {
            frameAround(V, n);
            const up = Math.abs(mz);
            const sx = f(mx * s);
            const sy = f(my * s);
            normalizeInto(
              V,
              d3,
              f(f(f(FRAME[0] * sx) + f(FRAME[3] * sy)) + f(V[n] * up)),
              f(f(f(FRAME[1] * sx) + f(FRAME[4] * sy)) + f(V[n + 1] * up)),
              f(f(f(FRAME[2] * sx) + f(FRAME[5] * sy)) + f(V[n + 2] * up)),
              n,
            );
          }
          break;
        }
        case OP.BUMP: {
          frameAround(V, a3);
          const dT = F[b];
          const dB = F[c];
          normalizeInto(
            V,
            d3,
            f(V[a3] - f(f(FRAME[0] * dT) + f(FRAME[3] * dB))),
            f(V[a3 + 1] - f(f(FRAME[1] * dT) + f(FRAME[4] * dB))),
            f(V[a3 + 2] - f(f(FRAME[2] * dT) + f(FRAME[5] * dB))),
            a3,
          );
          break;
        }
        case OP.WOOD:
        case OP.CLOTH: {
          const sp = this.pattern(pc, a3, b3, k);
          V[d3] = sp ? sp.baseColor[0] : 0;
          V[d3 + 1] = sp ? sp.baseColor[1] : 0;
          V[d3 + 2] = sp ? sp.baseColor[2] : 0;
          break;
        }
        case OP.WOODR:
        case OP.CLOTHR: {
          // The material's roughness times the pattern's, plus its own (a knot's end grain): rt_core's Tint::apply.
          const sp = this.pattern(pc, a3, b3, k);
          F[d] = sp ? f(f(F[c] * sp.roughness) + sp.roughnessAdd) : F[c];
          break;
        }
        case OP.WOODH:
        case OP.CLOTHH: {
          const sp = this.pattern(pc, a3, b3, k);
          F[d] = sp ? sp.height : 0;
          break;
        }
        case OP.WOODN:
        case OP.CLOTHN: {
          const sp = this.pattern(pc, a3, b3, k);
          const n: V3f = [V[b3], V[b3 + 1], V[b3 + 2]];
          const out = sp?.slope ? bump(n, sp.slope) : n;
          V[d3] = out[0];
          V[d3 + 1] = out[1];
          V[d3 + 2] = out[2];
          break;
        }
        default:
          throw new Error(`material program: unknown opcode ${code[pc]}`);
      }
    }
  }

  private blend(mode: number, d: number, a: number, b: number, t: number): void {
    const V = this.V;
    for (let i = 0; i < 3; i++) {
      const x = V[a + i];
      const y = V[b + i];
      let r: number;
      switch (mode) {
        case 1:
          r = f(x + y);
          break;
        case 2:
          r = f(x * y);
          break;
        case 3:
          r = f(x - y);
          break;
        case 4:
          r = f(1 - f(f(1 - x) * f(1 - y)));
          break;
        case 5:
          r = Math.abs(f(x - y));
          break;
        case 6:
          r = y > x ? y : x;
          break;
        case 7:
          r = y < x ? y : x;
          break;
        case 8:
          r = x < 0.5 ? f(f(2 * x) * y) : f(1 - f(f(2 * f(1 - x)) * f(1 - y)));
          break;
        default:
          r = y;
      }
      V[d + i] = lerp(x, r, t);
    }
  }

  /** RAMP: consts at k: count, interpolation (0 linear, 1 eased, 2 constant), then (position, r, g, b) per stop, sorted. */
  private ramp(k: number, x: number, d: number): void {
    const C = this.C;
    const V = this.V;
    const n = C[k];
    const interp = C[k + 1];
    const first = k + 2;
    // The stop to copy, or −1 to interpolate between stop `i` and the next.
    let copy = -1;
    let i = 0;
    if (n <= 1 || x <= C[first]) copy = 0;
    else if (x >= C[first + (n - 1) * 4]) copy = n - 1;
    else {
      while (i < n - 2 && !(x < C[first + (i + 1) * 4])) i++;
      if (interp === 2) copy = i;
    }
    if (copy >= 0) {
      const o = first + copy * 4;
      V[d] = C[o + 1];
      V[d + 1] = C[o + 2];
      V[d + 2] = C[o + 3];
      return;
    }
    const o0 = first + i * 4;
    const o1 = o0 + 4;
    let t = f(f(x - C[o0]) / f(C[o1] - C[o0]));
    if (interp === 1) t = f(f(t * t) * f(3 - f(2 * t)));
    V[d] = lerp(C[o0 + 1], C[o1 + 1], t);
    V[d + 1] = lerp(C[o0 + 2], C[o1 + 2], t);
    V[d + 2] = lerp(C[o0 + 3], C[o1 + 3], t);
  }
}

/** GRAD: 0 linear x, 1 quadratic max(x, 0)², 2 eased smoothstep(0, 1, x), 3 diagonal (x + y)/2, 4 spherical 1 − |p|, 5 radial atan2(y, x)/2π + 0.5; clamped to 0..1. */
export function gradient(kind: number, x: number, y: number, z: number): number {
  let g: number;
  switch (kind) {
    case 1:
      g = x > 0 ? f(x * x) : 0;
      break;
    case 2: {
      const t = clamp01(x);
      g = f(f(t * t) * f(3 - f(2 * t)));
      break;
    }
    case 3:
      g = f(f(x + y) * 0.5);
      break;
    case 4:
      g = f(1 - sqrt(f(f(f(x * x) + f(y * y)) + f(z * z))));
      break;
    case 5:
      g = f(f(atan2(y, x) / TAU) + 0.5);
      break;
    default:
      g = x;
  }
  return clamp01(g);
}

/**
 * The exact dielectric Fresnel reflectance, unpolarised, for relative index `ior` and the cosine between the view
 * and the normal: with c = |cos| (at most 1) and g = √(η² − 1 + c²), F = ½ · ((g − c)/(g + c))² ·
 * (1 + ((c(g + c) − 1)/(c(g − c) + 1))²); 0 for η ≤ 1.
 */
export function fresnel(ior: number, cosv: number): number {
  if (!(ior > 1)) return 0;
  const c = clamp01(Math.abs(cosv));
  const g = sqrt(f(f(f(ior * ior) - 1) + f(c * c)));
  const a = f(f(g - c) / f(g + c));
  const b = f(f(f(c * f(g + c)) - 1) / f(f(c * f(g - c)) + 1));
  return clamp01(f(f(f(0.5 * f(a * a))) * f(1 + f(b * b))));
}

/**
 * The points of the cross test between this interpreter and the engine's (M3b): `count` shading points from a
 * xorshift32 generator seeded with `seed` (x ^= x << 13; x ^= x >>> 17; x ^= x << 5; a float is (x >>> 8) / 2²⁴).
 * Per point, in this order: P = 200·r − 100 (mm) three times; N = normalize(2r − 1, three times; +Z when zero);
 * UV0 = (2r − 0.5, 2r − 0.5); UV1 likewise; I = normalize(2r − 1, three times; N when zero); T = `onbTangent(N)`,
 * B = N × T; dUV/dT = (0.02·r, 0.02·r); dUV/dB likewise. Every value rounded to f32 as it is made (normalised in
 * f32: each component divided by the f32 length).
 */
export function contractPoints(count: number, seed = 0x2545f491): ShadingPoint[] {
  let x = seed >>> 0 || 1;
  const r = (): number => {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    return (x >>> 8) / 16777216;
  };
  const unit = (a: number, b: number, c: number, fb: readonly number[]): number[] => {
    const l = sqrt(f(f(f(a * a) + f(b * b)) + f(c * c)));
    return l > 0 ? [f(a / l), f(b / l), f(c / l)] : [...fb];
  };
  const out: ShadingPoint[] = [];
  for (let i = 0; i < count; i++) {
    const P = [f(200 * r() - 100), f(200 * r() - 100), f(200 * r() - 100)];
    const N = unit(f(2 * r() - 1), f(2 * r() - 1), f(2 * r() - 1), [0, 0, 1]);
    const UV0 = [f(2 * r() - 0.5), f(2 * r() - 0.5), 0];
    const UV1 = [f(2 * r() - 0.5), f(2 * r() - 0.5), 0];
    const I = unit(f(2 * r() - 1), f(2 * r() - 1), f(2 * r() - 1), N);
    const T = [0, 0, 0];
    onbTangent(N[0], N[1], N[2], T);
    const B = [f(f(N[1] * T[2]) - f(N[2] * T[1])), f(f(N[2] * T[0]) - f(N[0] * T[2])), f(f(N[0] * T[1]) - f(N[1] * T[0]))];
    const dUVdT = [f(0.02 * r()), f(0.02 * r()), 0];
    const dUVdB = [f(0.02 * r()), f(0.02 * r()), 0];
    out.push({ P, N, UV0, UV1, I, T, B, dUVdT, dUVdB });
  }
  return out;
}

/** FNV-1a (32-bit) over the f32 bits of every output of a program at `points`, in output order then point order. */
export function outputsHash(run: ProgramRunner, points: readonly ShadingPoint[]): string {
  const buf = new Float32Array(3);
  const bits = new Uint32Array(buf.buffer);
  let h = 0x811c9dc5;
  const mix = (u: number) => {
    for (let k = 0; k < 4; k++) {
      h ^= (u >>> (k * 8)) & 0xff;
      h = Math.imul(h, 0x01000193);
    }
  };
  const types = run.program.outputs.map((o) => (o.kind === 'F' || o.kind === 'FC' ? 1 : 3));
  for (const pt of points) {
    run.setPoint(pt);
    run.run();
    run.program.outputs.forEach((o, j) => {
      run.read(o, buf);
      for (let c = 0; c < types[j]; c++) mix(bits[c]);
    });
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

