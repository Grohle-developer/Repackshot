// The compiled form of a material graph (phase M3a): a linear program of f32 and vec3 registers, the contract with
// the engine (M3b), written instruction by instruction in ARCHITECTURE §5.2 quater. Pure: no DOM, no three.
//
// The compiler walks the graph back from the material output, compiles each (node, output) it needs once, converts
// between socket types where a link asks for it (core/material-graph.ts), gives every value a virtual register and
// then packs the registers (a value's register is free again after its last read). What is not connected to the
// output is not compiled, unless a preview asks for it (`probes`). An output input that is not connected is a
// constant of the program, not an instruction.
//
// The shading point reaches the program in nine vec3 registers the engine fills before running it (`CTX`): the
// position and the normal in the part's own space (mm, unit), the two UV sets, the direction to the viewer, a
// tangent frame and the derivatives of the first UV set along it. A bump evaluates its height three times: at the
// point and a small step (`BUMP_STEP_MM`) along each tangent, with the position and the UVs moved by the program
// itself.
//
// An instruction is six 32-bit words: `op d a b c k`. `d`, `a`, `b`, `c` are registers (f32 or vec3 as the
// opcode says) or `NONE`; `k` is an index into the constants (`consts`, f32), an index into the image table, or a
// small immediate, as the opcode says. Opcodes are stable: added, never renumbered.

import { MATH_TERNARY, MATH_UNARY, nodeSpec, OUTPUT_INPUTS, type SocketType } from '../data/material-nodes';
import { DEG_TO_RAD, f, sinCos } from './f32math';
import type { ImageRef } from './images';
import { inputSpecOf, linkInto, nodeById, outputNode, outputSpecOf, shownFor, type GraphNode, type GraphRampStop, type MaterialGraph, type Vec3 } from './material-graph';

// --- The contract ---------------------------------------------------------------------------------

export const PROGRAM_VERSION = 1;
/** 'RPGM' little-endian: the first word of an encoded program. */
export const PROGRAM_MAGIC = 0x4d475052;
/** Words per instruction. */
export const WORDS = 6;
/** An operand that is not there. */
export const NONE = -1;

/** The opcodes. Stable: a new one gets a new number. */
export const OP = {
  NOP: 0,
  FCONST: 1,
  VCONST: 2,
  FMOV: 3,
  VMOV: 4,
  F2V: 5,
  VLUM: 6,
  VAVG: 7,
  VX: 8,
  VY: 9,
  VZ: 10,
  VCOMB: 11,
  FADD: 20,
  FSUB: 21,
  FMUL: 22,
  FDIV: 23,
  FPOW: 24,
  FMIN: 25,
  FMAX: 26,
  FSMIN: 27,
  FSMAX: 28,
  FABS: 29,
  FSSTEP: 30,
  FMADD: 31,
  FLT: 32,
  FGT: 33,
  FFLOOR: 34,
  FFRACT: 35,
  FSIN: 36,
  FCLAMP: 37,
  FLERP: 38,
  FINV: 39,
  VADD: 50,
  VSUB: 51,
  VMUL: 52,
  VSCALE: 53,
  VLERP: 54,
  VCLAMP: 55,
  VNORM: 56,
  VINV: 57,
  VDOT: 58,
  VLEN: 59,
  BLEND: 70,
  MAP: 80,
  TEX: 90,
  NOISE: 100,
  NOISEC: 101,
  GRAD: 110,
  CHECK: 111,
  STRIPE: 112,
  RAMP: 113,
  FRESNEL: 120,
  FACING: 121,
  EDGE: 122,
  CAVITY: 123,
  NMAP: 124,
  BUMP: 125,
} as const;
export type OpCode = (typeof OP)[keyof typeof OP];

/** What each operand of an opcode is: an f32 register, a vec3 register, or nothing (`-`). Defs are written, uses read. */
type Slot = 'F' | 'V' | '-';
interface OpShape {
  name: string;
  d: Slot;
  a: Slot;
  b: Slot;
  c: Slot;
  /** `b` is a second destination (TEX writes its alpha there). */
  bDef?: boolean;
  /** What `k` is. */
  k: 'const' | 'image' | 'imm' | '-';
}

const shape = (name: string, d: Slot, a: Slot, b: Slot, c: Slot, k: OpShape['k'] = '-', bDef = false): OpShape => ({ name, d, a, b, c, k, bDef });

/** The operands of every opcode (the table of ARCHITECTURE §5.2 quater). */
export const OP_SHAPES: Readonly<Record<number, OpShape>> = {
  [OP.NOP]: shape('NOP', '-', '-', '-', '-'),
  [OP.FCONST]: shape('FCONST', 'F', '-', '-', '-', 'const'),
  [OP.VCONST]: shape('VCONST', 'V', '-', '-', '-', 'const'),
  [OP.FMOV]: shape('FMOV', 'F', 'F', '-', '-'),
  [OP.VMOV]: shape('VMOV', 'V', 'V', '-', '-'),
  [OP.F2V]: shape('F2V', 'V', 'F', '-', '-'),
  [OP.VLUM]: shape('VLUM', 'F', 'V', '-', '-'),
  [OP.VAVG]: shape('VAVG', 'F', 'V', '-', '-'),
  [OP.VX]: shape('VX', 'F', 'V', '-', '-'),
  [OP.VY]: shape('VY', 'F', 'V', '-', '-'),
  [OP.VZ]: shape('VZ', 'F', 'V', '-', '-'),
  [OP.VCOMB]: shape('VCOMB', 'V', 'F', 'F', 'F'),
  [OP.FADD]: shape('FADD', 'F', 'F', 'F', '-'),
  [OP.FSUB]: shape('FSUB', 'F', 'F', 'F', '-'),
  [OP.FMUL]: shape('FMUL', 'F', 'F', 'F', '-'),
  [OP.FDIV]: shape('FDIV', 'F', 'F', 'F', '-'),
  [OP.FPOW]: shape('FPOW', 'F', 'F', 'F', '-'),
  [OP.FMIN]: shape('FMIN', 'F', 'F', 'F', '-'),
  [OP.FMAX]: shape('FMAX', 'F', 'F', 'F', '-'),
  [OP.FSMIN]: shape('FSMIN', 'F', 'F', 'F', 'F'),
  [OP.FSMAX]: shape('FSMAX', 'F', 'F', 'F', 'F'),
  [OP.FABS]: shape('FABS', 'F', 'F', '-', '-'),
  [OP.FSSTEP]: shape('FSSTEP', 'F', 'F', 'F', 'F'),
  [OP.FMADD]: shape('FMADD', 'F', 'F', 'F', 'F'),
  [OP.FLT]: shape('FLT', 'F', 'F', 'F', '-'),
  [OP.FGT]: shape('FGT', 'F', 'F', 'F', '-'),
  [OP.FFLOOR]: shape('FFLOOR', 'F', 'F', '-', '-'),
  [OP.FFRACT]: shape('FFRACT', 'F', 'F', '-', '-'),
  [OP.FSIN]: shape('FSIN', 'F', 'F', '-', '-'),
  [OP.FCLAMP]: shape('FCLAMP', 'F', 'F', '-', '-'),
  [OP.FLERP]: shape('FLERP', 'F', 'F', 'F', 'F'),
  [OP.FINV]: shape('FINV', 'F', 'F', '-', '-'),
  [OP.VADD]: shape('VADD', 'V', 'V', 'V', '-'),
  [OP.VSUB]: shape('VSUB', 'V', 'V', 'V', '-'),
  [OP.VMUL]: shape('VMUL', 'V', 'V', 'V', '-'),
  [OP.VSCALE]: shape('VSCALE', 'V', 'V', 'F', '-'),
  [OP.VLERP]: shape('VLERP', 'V', 'V', 'V', 'F'),
  [OP.VCLAMP]: shape('VCLAMP', 'V', 'V', '-', '-'),
  [OP.VNORM]: shape('VNORM', 'V', 'V', 'V', '-'),
  [OP.VINV]: shape('VINV', 'V', 'V', '-', '-'),
  [OP.VDOT]: shape('VDOT', 'F', 'V', 'V', '-'),
  [OP.VLEN]: shape('VLEN', 'F', 'V', '-', '-'),
  [OP.BLEND]: shape('BLEND', 'V', 'V', 'V', 'F', 'imm'),
  [OP.MAP]: shape('MAP', 'V', 'V', 'V', 'V', 'const'),
  [OP.TEX]: shape('TEX', 'V', 'V', 'F', '-', 'image', true),
  [OP.NOISE]: shape('NOISE', 'F', 'V', 'F', '-', 'const'),
  [OP.NOISEC]: shape('NOISEC', 'V', 'V', 'F', '-', 'const'),
  [OP.GRAD]: shape('GRAD', 'F', 'V', '-', '-', 'imm'),
  [OP.CHECK]: shape('CHECK', 'F', 'V', 'F', '-'),
  [OP.STRIPE]: shape('STRIPE', 'F', 'V', 'F', 'F', 'const'),
  [OP.RAMP]: shape('RAMP', 'V', 'F', '-', '-', 'const'),
  [OP.FRESNEL]: shape('FRESNEL', 'F', 'F', 'V', 'V'),
  [OP.FACING]: shape('FACING', 'F', 'F', 'V', 'V'),
  [OP.EDGE]: shape('EDGE', 'F', '-', '-', '-', 'const'),
  [OP.CAVITY]: shape('CAVITY', 'F', '-', '-', '-', 'const'),
  [OP.NMAP]: shape('NMAP', 'V', 'V', 'F', 'V', 'imm'),
  [OP.BUMP]: shape('BUMP', 'V', 'V', 'F', 'F'),
};

/** The vec3 registers the engine fills before running a program (the shading point, part space). */
export const CTX = {
  /** Position, mm. */
  P: 0,
  /** Shading normal, unit, outward. */
  N: 1,
  /** First UV set (u, v, 0). */
  UV0: 2,
  /** Second UV set (u, v, 0); the first one when the mesh has only one. */
  UV1: 3,
  /** Unit direction from the point to the viewer (the ray's origin). */
  I: 4,
  /** Unit tangent: the direction of increasing u of UV0 orthogonalised against N, or `onb(N)` without UVs. */
  T: 5,
  /** N × T. */
  B: 6,
  /** (du/dT, dv/dT, 0) of UV0, per mm along T; zero without UVs. */
  DUV_T: 7,
  /** (du/dB, dv/dB, 0) of UV0, per mm along B. */
  DUV_B: 8,
} as const;
/** The first vec3 register a program allocates. */
export const CTX_COUNT = 9;

/** How far a bump looks along the tangents for its height's slope, mm. */
export const BUMP_STEP_MM = 0.01;
/** The part's own coordinates an unconnected procedural reads: millimetres times this (tenths of a metre). */
export const OBJECT_SCALE = 0.01;

/** The limits of a program: a graph that compiles past one of them is refused, with the reason. */
export const MAX_INSTRUCTIONS = 2048;
export const MAX_F_REGISTERS = 256;
export const MAX_V_REGISTERS = 256;
export const MAX_CONSTS = 8192;
export const MAX_IMAGES = 16;

/** Codes of the enumerations the program carries as numbers. */
export const PROJECTION_CODE: Readonly<Record<string, number>> = { UV: 0, PLANAR: 1, BOX: 2, CYLINDRICAL: 3, SPHERICAL: 4, OBJECT: 5 };
export const AXIS_CODE: Readonly<Record<string, number>> = { X: 0, Y: 1, Z: 2 };
export const BLEND_CODE: Readonly<Record<string, number>> = { MIX: 0, ADD: 1, MULTIPLY: 2, SUBTRACT: 3, SCREEN: 4, DIFFERENCE: 5, LIGHTEN: 6, DARKEN: 7, OVERLAY: 8 };
export const GRADIENT_CODE: Readonly<Record<string, number>> = { LINEAR: 0, QUADRATIC: 1, EASED: 2, DIAGONAL: 3, SPHERICAL: 4, RADIAL: 5 };
export const NOISE_CODE: Readonly<Record<string, number>> = { PERLIN: 0, SIMPLEX: 1 };
export const RAMP_CODE: Readonly<Record<string, number>> = { LINEAR: 0, EASE: 1, CONSTANT: 2 };
export const WRAP_CODE: Readonly<Record<string, number>> = { REPEAT: 0, CLAMP: 1, MIRROR: 2 };
export const SPACE_CODE: Readonly<Record<string, number>> = { TANGENT: 0, OBJECT: 1 };

/** An image the program reads: which file, read as colour (sRGB) or data, and past its edges. Null image: missing. */
export interface ProgramImage {
  image: ImageRef | null;
  srgb: boolean;
  wrap: 0 | 1 | 2;
}

/** Where a value of the program ends: a register (f32 or vec3) or a constant (index into `consts`, one or three). */
export interface ValueRef {
  kind: 'F' | 'V' | 'FC' | 'VC';
  index: number;
}

/** The keys of the program's outputs, in their order (the output node's inputs). */
export const OUTPUT_KEYS: readonly string[] = OUTPUT_INPUTS.map((s) => s.key);
export const OUTPUT_TYPES: Readonly<Record<string, SocketType>> = Object.fromEntries(OUTPUT_INPUTS.map((s) => [s.key, s.type]));

/** A node's output a preview asked for, and where its value is. */
export interface Probe {
  node: string;
  socket: string;
  type: SocketType;
  ref: ValueRef;
}

/** Where the coordinates of the graph's textures come from (what the Fast preview needs to know to bake it). */
export type CoordSource =
  | { kind: 'UV'; set: 0 | 1 }
  | { kind: 'OBJECT' }
  | { kind: 'PROJECTION'; projection: 'PLANAR' | 'BOX' | 'CYLINDRICAL' | 'SPHERICAL'; axis: 'X' | 'Y' | 'Z'; sizeMm: number; rotationDeg: number; offset: [number, number]; repeat: [number, number]; uvSet: 0 | 1 }
  | { kind: 'UVMAP'; set: 0 | 1 };

export interface Program {
  version: number;
  /** `WORDS` per instruction. */
  code: Int32Array;
  consts: Float32Array;
  /** Registers it uses: f32, and vec3 including the `CTX_COUNT` of the shading point. */
  nF: number;
  nV: number;
  images: ProgramImage[];
  /** One per `OUTPUT_KEYS`. */
  outputs: ValueRef[];
  /** The output node's parameters: the material's, not the point's. */
  absorptionMm: number;
  thinWalls: boolean;
  probes: Probe[];
  /** What the graph reads, for the Fast preview (core/material-preview.ts). */
  uses: { coords: CoordSource[]; fresnel: boolean; curvature: boolean; bump: boolean };
}

export type CompileErrorCode = 'NO_OUTPUT' | 'TOO_MANY_INSTRUCTIONS' | 'TOO_MANY_REGISTERS' | 'TOO_MANY_CONSTANTS' | 'TOO_MANY_IMAGES';
export interface CompileError {
  code: CompileErrorCode;
  /** The limit that was passed. */
  limit?: number;
}

export interface CompileResult {
  program: Program | null;
  error: CompileError | null;
}

export interface CompileOptions {
  /** Node outputs a preview wants, compiled even when the material output does not use them. */
  probes?: readonly { node: string; socket: string }[];
}

// --- Compiler -------------------------------------------------------------------------------------

/** A value while compiling: a virtual register of a file, or a constant. */
interface Val {
  t: 'F' | 'V';
  /** Virtual register (≥ 0), or a context register (a vec3 register below `CTX_COUNT`, `ctx` true). */
  r: number;
  ctx?: boolean;
}

/** The shading point a value is computed at: the point itself, or a step along a tangent (a bump's). */
interface Env {
  id: string;
  P: Val;
  N: Val;
  UV0: Val;
  UV1: Val;
  I: Val;
}

class Overflow extends Error {
  constructor(readonly error: CompileError) {
    super(error.code);
  }
}

const ctxVal = (r: number): Val => ({ t: 'V', r, ctx: true });

class Compiler {
  readonly words: number[] = [];
  readonly consts: number[] = [];
  readonly images: ProgramImage[] = [];
  private nextF = 0;
  private nextV = 0;
  private readonly memo = new Map<string, Val>();
  private readonly constMemo = new Map<string, number>();
  private readonly envs = new Map<string, Env>();
  readonly coords: CoordSource[] = [];
  fresnel = false;
  curvature = false;
  bump = false;

  constructor(readonly g: MaterialGraph) {}

  readonly base: Env = { id: '0', P: ctxVal(CTX.P), N: ctxVal(CTX.N), UV0: ctxVal(CTX.UV0), UV1: ctxVal(CTX.UV1), I: ctxVal(CTX.I) };

  private newF(): Val {
    return { t: 'F', r: this.nextF++ };
  }

  private newV(): Val {
    return { t: 'V', r: this.nextV++ };
  }

  private emit(op: OpCode, d: Val | null, a: Val | null = null, b: Val | null = null, c: Val | null = null, k = NONE): void {
    if (this.words.length / WORDS >= MAX_INSTRUCTIONS) throw new Overflow({ code: 'TOO_MANY_INSTRUCTIONS', limit: MAX_INSTRUCTIONS });
    // Virtual registers are encoded as (r + CTX_COUNT) for vec3 so the context keeps its numbers until packing; f32 as r.
    const enc = (v: Val | null): number => (v === null ? NONE : v.t === 'V' ? (v.ctx ? v.r : v.r + CTX_COUNT) : v.r);
    this.words.push(op, enc(d), enc(a), enc(b), enc(c), k);
  }

  /** Index of `values` in the constants (the same values share one entry). */
  constIndex(values: readonly number[]): number {
    const key = values.map((x) => f(x)).join(',');
    const hit = this.constMemo.get(key);
    if (hit !== undefined) return hit;
    if (this.consts.length + values.length > MAX_CONSTS) throw new Overflow({ code: 'TOO_MANY_CONSTANTS', limit: MAX_CONSTS });
    const at = this.consts.length;
    for (const x of values) this.consts.push(f(x));
    this.constMemo.set(key, at);
    return at;
  }

  fconst(x: number): Val {
    const key = `cf|${f(x)}`;
    const hit = this.memo.get(key);
    if (hit) return hit;
    const d = this.newF();
    this.emit(OP.FCONST, d, null, null, null, this.constIndex([x]));
    this.memo.set(key, d);
    return d;
  }

  private vconst(v: readonly number[]): Val {
    const key = `cv|${v.map((x) => f(x)).join(',')}`;
    const hit = this.memo.get(key);
    if (hit) return hit;
    const d = this.newV();
    this.emit(OP.VCONST, d, null, null, null, this.constIndex(v));
    this.memo.set(key, d);
    return d;
  }

  private op1(op: OpCode, out: 'F' | 'V', a: Val, b: Val | null = null, c: Val | null = null, k = NONE): Val {
    const d = out === 'F' ? this.newF() : this.newV();
    this.emit(op, d, a, b, c, k);
    return d;
  }

  /** `v` (of socket type `from`) as a value of type `to`. */
  private convert(v: Val, from: SocketType, to: SocketType): Val {
    if (from === to) return v;
    if (from === 'float') return this.op1(OP.F2V, 'V', v);
    if (to === 'float') return this.op1(from === 'color' ? OP.VLUM : OP.VAVG, 'F', v);
    // colour ↔ vector, normal → vector: the same three numbers.
    return v;
  }

  /** A step of `BUMP_STEP_MM` along T or B from `env`, with its UVs moved by the derivatives along that tangent. */
  private stepEnv(env: Env, along: 'T' | 'B'): Env {
    const id = `${env.id}${along}`;
    const hit = this.envs.get(id);
    if (hit) return hit;
    const step = this.fconst(BUMP_STEP_MM);
    const dir = this.op1(OP.VSCALE, 'V', ctxVal(along === 'T' ? CTX.T : CTX.B), step);
    const duv = this.op1(OP.VSCALE, 'V', ctxVal(along === 'T' ? CTX.DUV_T : CTX.DUV_B), step);
    const next: Env = {
      id,
      P: this.op1(OP.VADD, 'V', env.P, dir),
      N: env.N,
      UV0: this.op1(OP.VADD, 'V', env.UV0, duv),
      UV1: this.op1(OP.VADD, 'V', env.UV1, duv),
      I: env.I,
    };
    this.envs.set(id, next);
    return next;
  }

  private addCoord(c: CoordSource): void {
    const key = JSON.stringify(c);
    if (!this.coords.some((x) => JSON.stringify(x) === key)) this.coords.push(c);
  }

  /** The value an input of a node reads, as type `want`. */
  input(node: GraphNode, key: string, want: SocketType, env: Env): Val {
    const spec = inputSpecOf(node, key)!;
    const link = linkInto(this.g, node.id, key);
    if (link) {
      const from = nodeById(this.g, link.from);
      const out = from && outputSpecOf(from, link.output);
      if (from && out) return this.convert(this.output(from, link.output, env), out.type, want);
    }
    if (spec.implicit === 'NORMAL') return this.convert(env.N, 'normal', want);
    if (spec.implicit === 'UV0') {
      this.addCoord({ kind: 'UV', set: 0 });
      return this.convert(env.UV0, 'vector', want);
    }
    if (spec.implicit === 'OBJECT') {
      this.addCoord({ kind: 'OBJECT' });
      const key2 = `obj|${env.id}`;
      let v = this.memo.get(key2);
      if (!v) {
        v = this.op1(OP.VSCALE, 'V', env.P, this.fconst(OBJECT_SCALE));
        this.memo.set(key2, v);
      }
      return this.convert(v, 'vector', want);
    }
    const value = node.inputs[key];
    if (spec.type === 'float') return this.convert(this.fconst(typeof value === 'number' ? value : 0), 'float', want);
    return this.convert(this.vconst(Array.isArray(value) ? value : [0, 0, 0]), spec.type, want);
  }

  /** The value of a node's output at `env`, compiled once. */
  output(node: GraphNode, socket: string, env: Env): Val {
    const key = `${env.id}|${node.id}|${socket}`;
    const hit = this.memo.get(key);
    if (hit) return hit;
    const v = this.compileOutput(node, socket, env);
    this.memo.set(key, v);
    return v;
  }

  private compileOutput(n: GraphNode, socket: string, env: Env): Val {
    const p = n.params;
    const F = (k: string) => this.input(n, k, 'float', env);
    const C = (k: string) => this.input(n, k, 'color', env);
    const V = (k: string) => this.input(n, k, 'vector', env);
    switch (n.type) {
      case 'IMAGE': {
        // One read gives both outputs: compile the node once, at its colour.
        if (socket === 'alpha') {
          this.output(n, 'color', env);
          return this.memo.get(`${env.id}|${n.id}|alpha`)!;
        }
        const coords = V('vector');
        const image = (p.image as ImageRef | null) ?? null;
        const entry: ProgramImage = { image, srgb: p.colorSpace !== 'LINEAR', wrap: (WRAP_CODE[String(p.wrap)] ?? 0) as 0 | 1 | 2 };
        let index = this.images.findIndex((x) => x.srgb === entry.srgb && x.wrap === entry.wrap && (x.image?.id ?? null) === (image?.id ?? null));
        if (index < 0) {
          if (this.images.length >= MAX_IMAGES) throw new Overflow({ code: 'TOO_MANY_IMAGES', limit: MAX_IMAGES });
          index = this.images.push(entry) - 1;
        }
        const rgb = this.newV();
        const alpha = this.newF();
        this.emit(OP.TEX, rgb, coords, alpha, null, index);
        this.memo.set(`${env.id}|${n.id}|alpha`, alpha);
        return rgb;
      }
      case 'MAPPING': {
        const projection = String(p.projection);
        const axis = String(p.axis) as 'X' | 'Y' | 'Z';
        const uvSet = p.uvSet === '1' ? 1 : 0;
        const size = Number(p.sizeMm);
        const rot = Number(p.rotationDeg);
        const [s, c] = sinCos(f(f(rot) * DEG_TO_RAD));
        const ru = Number(p.repeatU);
        const rv = Number(p.repeatV);
        const ou = Number(p.offsetU);
        const ov = Number(p.offsetV);
        if (projection === 'UV') this.addCoord({ kind: 'UVMAP', set: uvSet });
        else if (projection === 'OBJECT') this.addCoord({ kind: 'OBJECT' });
        else this.addCoord({ kind: 'PROJECTION', projection: projection as 'PLANAR', axis, sizeMm: size, rotationDeg: rot, offset: [ou, ov], repeat: [ru, rv], uvSet });
        const k = this.constIndex([PROJECTION_CODE[projection] ?? 0, AXIS_CODE[axis] ?? 2, size, c, s, ru, rv, ou, ov]);
        return this.op1(OP.MAP, 'V', env.P, env.N, uvSet === 1 ? env.UV1 : env.UV0, k);
      }
      case 'NOISE': {
        const k = this.constIndex([NOISE_CODE[String(p.kind)] ?? 0, Number(p.octaves), Number(p.lacunarity), Number(p.gain), Number(p.seed)]);
        return this.op1(socket === 'color' ? OP.NOISEC : OP.NOISE, socket === 'color' ? 'V' : 'F', V('vector'), F('scale'), null, k);
      }
      case 'GRADIENT':
        return this.op1(OP.GRAD, 'F', V('vector'), null, null, GRADIENT_CODE[String(p.kind)] ?? 0);
      case 'CHECKER': {
        if (socket === 'value') return this.op1(OP.CHECK, 'F', V('vector'), F('scale'));
        const value = this.output(n, 'value', env);
        return this.op1(OP.VLERP, 'V', C('color1'), C('color2'), value);
      }
      case 'STRIPES': {
        if (socket === 'value') return this.op1(OP.STRIPE, 'F', V('vector'), F('scale'), F('width'), this.constIndex([AXIS_CODE[String(p.axis)] ?? 0, Number(p.softness)]));
        const value = this.output(n, 'value', env);
        return this.op1(OP.VLERP, 'V', C('color2'), C('color1'), value);
      }
      case 'RAMP': {
        const stops = [...(p.stops as GraphRampStop[])].map((s, i) => ({ s, i })).sort((a, b) => a.s.pos - b.s.pos || a.i - b.i).map((x) => x.s);
        const k = this.constIndex([stops.length, RAMP_CODE[String(p.interpolation)] ?? 0, ...stops.flatMap((s) => [s.pos, s.color[0], s.color[1], s.color[2]])]);
        return this.op1(OP.RAMP, 'V', F('fac'), null, null, k);
      }
      case 'MIX': {
        const v = this.op1(OP.BLEND, 'V', C('a'), C('b'), F('fac'), BLEND_CODE[String(p.blend)] ?? 0);
        return p.clamp === true ? this.op1(OP.VCLAMP, 'V', v) : v;
      }
      case 'MATH': {
        const op = String(p.op);
        const a = F('a');
        const b = MATH_UNARY.includes(op) ? null : F('b');
        const c = MATH_TERNARY.includes(op) ? F('c') : null;
        const code: Record<string, OpCode> = {
          ADD: OP.FADD,
          SUBTRACT: OP.FSUB,
          MULTIPLY: OP.FMUL,
          DIVIDE: OP.FDIV,
          MULTIPLY_ADD: OP.FMADD,
          POWER: OP.FPOW,
          MINIMUM: OP.FMIN,
          MAXIMUM: OP.FMAX,
          SMOOTH_MIN: OP.FSMIN,
          SMOOTH_MAX: OP.FSMAX,
          SMOOTHSTEP: OP.FSSTEP,
          ABSOLUTE: OP.FABS,
          LESS_THAN: OP.FLT,
          GREATER_THAN: OP.FGT,
          FLOOR: OP.FFLOOR,
          FRACTION: OP.FFRACT,
          SINE: OP.FSIN,
        };
        const v = this.op1(code[op] ?? OP.FMUL, 'F', a, b, c);
        return p.clamp === true ? this.op1(OP.FCLAMP, 'F', v) : v;
      }
      case 'FRESNEL':
        this.fresnel = true;
        if (socket === 'facing') return this.op1(OP.FACING, 'F', F('blend'), this.input(n, 'normal', 'normal', env), env.I);
        return this.op1(OP.FRESNEL, 'F', F('ior'), this.input(n, 'normal', 'normal', env), env.I);
      case 'CURVATURE': {
        this.curvature = true;
        const d = this.newF();
        this.emit(socket === 'cavities' ? OP.CAVITY : OP.EDGE, d, null, null, null, this.constIndex([Number(p.radiusMm)]));
        return d;
      }
      case 'VALUE':
        return this.fconst(Number(p.value));
      case 'COLOR':
        return this.vconst(p.color as Vec3);
      case 'SEPARATE_RGB':
        return this.op1(socket === 'r' ? OP.VX : socket === 'g' ? OP.VY : OP.VZ, 'F', C('color'));
      case 'COMBINE_RGB':
        return this.op1(OP.VCOMB, 'V', F('r'), F('g'), F('b'));
      case 'INVERT': {
        const c = C('color');
        return this.op1(OP.VLERP, 'V', c, this.op1(OP.VINV, 'V', c), F('fac'));
      }
      case 'NORMAL_MAP':
        return this.op1(OP.NMAP, 'V', C('color'), F('strength'), env.N, SPACE_CODE[String(p.space)] ?? 0);
      case 'BUMP': {
        const base = this.input(n, 'normal', 'normal', env);
        if (!linkInto(this.g, n.id, 'height')) return base;
        // The slope's scale: strength × distance (mm the height 1 stands for) / the step, negative when inverted.
        const sign = p.invert === true ? -1 : 1;
        const constant = !linkInto(this.g, n.id, 'strength') && !linkInto(this.g, n.id, 'distance');
        const scale = constant
          ? this.fconst((Number(n.inputs.strength) * Number(n.inputs.distance) * sign) / BUMP_STEP_MM)
          : this.op1(OP.FMUL, 'F', this.op1(OP.FMUL, 'F', F('strength'), F('distance')), this.fconst(sign / BUMP_STEP_MM));
        return this.bumped(base, (e) => this.input(n, 'height', 'float', e), env, scale);
      }
      default:
        return socket === 'color' || socket === 'normal' || socket === 'vector' ? this.vconst([0, 0, 0]) : this.fconst(0);
    }
  }

  /** `base` bent by the slope of the height `h` (evaluated at the point and a step along T and B), times `scale`. */
  bumped(base: Val, h: (e: Env) => Val, env: Env, scale: Val): Val {
    this.bump = true;
    const h0 = h(env);
    const hT = h(this.stepEnv(env, 'T'));
    const hB = h(this.stepEnv(env, 'B'));
    const dT = this.op1(OP.FMUL, 'F', this.op1(OP.FSUB, 'F', hT, h0), scale);
    const dB = this.op1(OP.FMUL, 'F', this.op1(OP.FSUB, 'F', hB, h0), scale);
    return this.op1(OP.BUMP, 'V', base, dT, dB);
  }

  /** The output node's input `key` as a reference: a constant when it is not connected. */
  outputRef(out: GraphNode, key: string, normal: Val | null): ValueRef | Val {
    const spec = inputSpecOf(out, key)!;
    if (key === 'normal') return normal!;
    if (linkInto(this.g, out.id, key)) return this.input(out, key, spec.type, this.base);
    const v = out.inputs[key];
    return spec.type === 'float' ? { kind: 'FC', index: this.constIndex([typeof v === 'number' ? v : 0]) } : { kind: 'VC', index: this.constIndex(Array.isArray(v) ? v : [0, 0, 0]) };
  }
}

const isVal = (x: ValueRef | Val): x is Val => 't' in x;

/**
 * Packs the virtual registers: each value gets the lowest free register of its file when it is written, and gives
 * it back after its last read. Values the outputs and probes name live to the end. Returns the register counts.
 */
function pack(words: number[], keep: Val[]): { nF: number; nV: number; map: (v: Val) => number } {
  const n = words.length / WORDS;
  // Virtual numbering in `words`: f32 as is, vec3 as r + CTX_COUNT (context registers below).
  const lastF = new Map<number, number>();
  const lastV = new Map<number, number>();
  for (let i = 0; i < n; i++) {
    const s = OP_SHAPES[words[i * WORDS]];
    for (const [slot, at] of [
      [s.a, 2],
      [s.b, 3],
      [s.c, 4],
    ] as const) {
      const r = words[i * WORDS + at];
      if (r === NONE || slot === '-' || (at === 3 && s.bDef)) continue;
      if (slot === 'F') lastF.set(r, i);
      else if (r >= CTX_COUNT) lastV.set(r, i);
    }
  }
  for (const v of keep) {
    if (v.t === 'F') lastF.set(v.r, Infinity);
    else if (!v.ctx) lastV.set(v.r + CTX_COUNT, Infinity);
  }
  const mapF = new Map<number, number>();
  const mapV = new Map<number, number>();
  const freeF: number[] = [];
  const freeV: number[] = [];
  let nF = 0;
  let nV = CTX_COUNT;
  const take = (free: number[], next: () => number): number => {
    if (free.length === 0) return next();
    let best = 0;
    for (let j = 1; j < free.length; j++) if (free[j] < free[best]) best = j;
    return free.splice(best, 1)[0];
  };
  for (let i = 0; i < n; i++) {
    const base = i * WORDS;
    const s = OP_SHAPES[words[base]];
    // Reads first (the registers they had), then the writes get registers, then the last reads give theirs back.
    const reads: [number, Slot][] = [];
    for (const [slot, at] of [
      [s.a, 2],
      [s.b, 3],
      [s.c, 4],
    ] as const) {
      const r = words[base + at];
      if (r === NONE || slot === '-' || (at === 3 && s.bDef)) continue;
      if (slot === 'F') words[base + at] = mapF.get(r)!;
      else words[base + at] = r < CTX_COUNT ? r : mapV.get(r)!;
      reads.push([r, slot]);
    }
    const defs: [number, Slot][] = [[1, s.d]];
    if (s.bDef) defs.push([3, s.b]);
    for (const [at, slot] of defs) {
      const r = words[base + at];
      if (r === NONE || slot === '-') continue;
      if (slot === 'F') {
        const reg = take(freeF, () => nF++);
        mapF.set(r, reg);
        words[base + at] = reg;
        if (!lastF.has(r)) freeF.push(reg);
      } else {
        const reg = take(freeV, () => nV++);
        mapV.set(r, reg);
        words[base + at] = reg;
        if (!lastV.has(r)) freeV.push(reg);
      }
    }
    for (const [r, slot] of reads) {
      if (slot === 'F' && lastF.get(r) === i) freeF.push(mapF.get(r)!);
      else if (slot === 'V' && r >= CTX_COUNT && lastV.get(r) === i) freeV.push(mapV.get(r)!);
    }
  }
  return { nF, nV, map: (v) => (v.t === 'F' ? mapF.get(v.r)! : v.ctx ? v.r : mapV.get(v.r + CTX_COUNT)!) };
}

/**
 * Compiles a graph. A graph that passes a limit gives no program and the reason; a missing output node too (a
 * normalised graph always has one).
 */
export function compileGraph(g: MaterialGraph, opts: CompileOptions = {}): CompileResult {
  const out = outputNode(g);
  if (!out) return { program: null, error: { code: 'NO_OUTPUT' } };
  const cc = new Compiler(g);
  try {
    // The normal first: a bump on the output (its `bump` height) bends whatever reaches `normal`.
    let normal: Val = linkInto(g, out.id, 'normal') ? cc.input(out, 'normal', 'normal', cc.base) : cc.base.N;
    if (linkInto(g, out.id, 'bump')) {
      const scale = 1 / BUMP_STEP_MM;
      normal = cc.bumped(normal, (e) => cc.input(out, 'bump', 'float', e), cc.base, cc.fconst(scale));
    }
    const refs = OUTPUT_KEYS.map((k) => cc.outputRef(out, k, normal));
    const probeVals: { node: string; socket: string; type: SocketType; v: Val }[] = [];
    for (const pr of opts.probes ?? []) {
      const node = nodeById(g, pr.node);
      const spec = node && outputSpecOf(node, pr.socket);
      if (!node || !spec) continue;
      probeVals.push({ node: pr.node, socket: pr.socket, type: spec.type, v: cc.output(node, pr.socket, cc.base) });
    }
    const keep = [...refs.filter(isVal), ...probeVals.map((p) => p.v)];
    const { nF, nV, map } = pack(cc.words, keep);
    if (nF > MAX_F_REGISTERS) return { program: null, error: { code: 'TOO_MANY_REGISTERS', limit: MAX_F_REGISTERS } };
    if (nV > MAX_V_REGISTERS) return { program: null, error: { code: 'TOO_MANY_REGISTERS', limit: MAX_V_REGISTERS } };
    const toRef = (x: ValueRef | Val): ValueRef => (isVal(x) ? { kind: x.t, index: map(x) } : x);
    const program: Program = {
      version: PROGRAM_VERSION,
      code: Int32Array.from(cc.words),
      consts: Float32Array.from(cc.consts),
      nF,
      nV,
      images: cc.images,
      outputs: refs.map(toRef),
      absorptionMm: Number(out.params.absorptionMm) || 0,
      thinWalls: out.params.thinWalls === true,
      probes: probeVals.map((p) => ({ node: p.node, socket: p.socket, type: p.type, ref: toRef(p.v) })),
      uses: { coords: cc.coords, fresnel: cc.fresnel, curvature: cc.curvature, bump: cc.bump },
    };
    return { program, error: null };
  } catch (err) {
    if (err instanceof Overflow) return { program: null, error: err.error };
    throw err;
  }
}

/** The number of instructions of a program. */
export const instructionCount = (p: Program): number => p.code.length / WORDS;

/** Whether an input of a node is read by the compiler (shown for its parameters). */
export function inputShown(node: GraphNode, key: string): boolean {
  const spec = nodeSpec(node.type)?.inputs.find((s) => s.key === key);
  return !!spec && shownFor(node, spec.when);
}

// --- Binary form ----------------------------------------------------------------------------------

const KIND_CODE: Readonly<Record<ValueRef['kind'], number>> = { FC: 0, F: 1, VC: 2, V: 3 };
const KIND_OF: readonly ValueRef['kind'][] = ['FC', 'F', 'VC', 'V'];

/**
 * The program as bytes, little-endian (ARCHITECTURE §5.2 quater): a header of ten u32 (magic, version, instruction
 * count, constant count, image count, f32 and vec3 register counts, output count, the absorption distance as f32,
 * flags: bit 0 thin walls), the instructions (six u32 each, `NONE` as 0xFFFFFFFF), the constants (f32), the image
 * table (three u32 each: the image's index in the scene's IMGS, 0xFFFFFFFF when missing; 1 when sRGB; the wrap
 * code) and the outputs (two u32 each: kind 0 f32 constant, 1 f32 register, 2 vec3 constant, 3 vec3 register; index).
 * `imageIndex` gives the scene's index of an image (by default the order of the program's table).
 */
export function encodeProgram(p: Program, imageIndex: (ref: ImageRef, i: number) => number = (_r, i) => i): Uint8Array {
  const n = instructionCount(p);
  const bytes = new Uint8Array(40 + n * WORDS * 4 + p.consts.length * 4 + p.images.length * 12 + p.outputs.length * 8);
  const dv = new DataView(bytes.buffer);
  let at = 0;
  const u32 = (x: number) => {
    dv.setUint32(at, x >>> 0, true);
    at += 4;
  };
  const f32 = (x: number) => {
    dv.setFloat32(at, x, true);
    at += 4;
  };
  u32(PROGRAM_MAGIC);
  u32(p.version);
  u32(n);
  u32(p.consts.length);
  u32(p.images.length);
  u32(p.nF);
  u32(p.nV);
  u32(p.outputs.length);
  f32(p.absorptionMm);
  u32(p.thinWalls ? 1 : 0);
  for (let i = 0; i < p.code.length; i++) u32(p.code[i]);
  for (let i = 0; i < p.consts.length; i++) f32(p.consts[i]);
  p.images.forEach((im, i) => {
    u32(im.image ? imageIndex(im.image, i) : 0xffffffff);
    u32(im.srgb ? 1 : 0);
    u32(im.wrap);
  });
  for (const o of p.outputs) {
    u32(KIND_CODE[o.kind]);
    u32(o.index);
  }
  return bytes;
}

/** Reads the bytes of `encodeProgram` back (the images as their indices; probes and uses are not in the bytes). */
export function decodeProgram(bytes: Uint8Array): { program: Omit<Program, 'images' | 'probes' | 'uses'>; images: { index: number; srgb: boolean; wrap: number }[] } {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 0;
  const u32 = () => {
    const v = dv.getUint32(at, true);
    at += 4;
    return v;
  };
  const f32 = () => {
    const v = dv.getFloat32(at, true);
    at += 4;
    return v;
  };
  if (u32() !== PROGRAM_MAGIC) throw new Error('not a material program');
  const version = u32();
  const n = u32();
  const nc = u32();
  const ni = u32();
  const nF = u32();
  const nV = u32();
  const no = u32();
  const absorptionMm = f32();
  const thinWalls = (u32() & 1) === 1;
  const code = new Int32Array(n * WORDS);
  for (let i = 0; i < code.length; i++) code[i] = u32() | 0;
  const consts = new Float32Array(nc);
  for (let i = 0; i < nc; i++) consts[i] = f32();
  const images: { index: number; srgb: boolean; wrap: number }[] = [];
  for (let i = 0; i < ni; i++) images.push({ index: u32(), srgb: u32() === 1, wrap: u32() });
  const outputs: ValueRef[] = [];
  for (let i = 0; i < no; i++) {
    const kind = KIND_OF[u32()];
    outputs.push({ kind, index: u32() });
  }
  return { program: { version, code, consts, nF, nV, outputs, absorptionMm, thinWalls }, images };
}

/** The program as text, one instruction a line (for the editor's details and the tests). */
export function disassemble(p: Pick<Program, 'code'>): string[] {
  const out: string[] = [];
  for (let i = 0; i < p.code.length; i += WORDS) {
    const s = OP_SHAPES[p.code[i]];
    const reg = (slot: Slot, r: number) => (r === NONE || slot === '-' ? '' : `${slot === 'F' ? 'f' : 'v'}${r}`);
    const parts = [reg(s.d, p.code[i + 1]), reg(s.a, p.code[i + 2]), reg(s.b, p.code[i + 3]), reg(s.c, p.code[i + 4])].filter(Boolean);
    if (s.k !== '-') parts.push(`${s.k === 'const' ? '#' : s.k === 'image' ? 'img' : ''}${p.code[i + 5]}`);
    out.push(`${s.name} ${parts.join(' ')}`.trim());
  }
  return out;
}
