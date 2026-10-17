// Phase M3b, the cross test of M3a's contract: the TypeScript reference interpreter (core/material-interp.ts) and the
// engine's (rt_core::program::interp) give the same bits. This side writes and pins the shared fixture
// (tests/fixtures/material-programs.json); engine/crates/rt-core/src/program/tests.rs runs every case of it and must
// give the same FNV-1a of every output at every point.
//
//   examples      the ten example graphs of M3a, compiled, at the 1000 points of `contractPoints` (the pins of
//                 tests/material-program.test.ts, EXAMPLE_PINS).
//   instructions  every instruction, alone, on operands made from the shading point (200 points each), in every
//                 mode, kind, projection, axis and wrap it has.
//   specials      the instructions on numbers, every f32 function on 0, −0, ±1, halves, integers, the tiny and the
//                 huge, ±∞ and NaN, in every pair (triples for the three-operand ones): one point.
//
// The programs are stored deflated (zlib) and in base64; the test compares what it inflates with what it builds, so
// the fixture holds no matter which zlib wrote it. REPACK_WRITE_PROGRAM_FIXTURE=1 npx vitest run
// tests/material-program-cross.test.ts writes it again.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { deflateSync, inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { MATERIAL_GRAPHS } from '../src/data/material-graphs';
import { DEG_TO_RAD, f, sinCos } from '../src/core/f32math';
import { graphOfExample, labelPixels, LABEL_HEIGHT, LABEL_WIDTH, registerLabelImage } from '../src/core/material-examples';
import { compileGraph, encodeProgram, NONE, OP, type OpCode, type Program, type ProgramImage, type ValueRef } from '../src/core/material-program';
import { contractPoints, ProgramRunner, type ImagePixels } from '../src/core/material-interp';
import { crossHash } from './program-hash';
import { fabricRecipe, recipeConsts, woodRecipe, type PatternRecipe } from '../src/core/pattern-recipe';
import { f32Knot, type Placement } from '../src/core/patterns';
import { meetsBox, placeKnots } from '../src/core/knots';
import { MATERIAL_PRESETS } from '../src/data/materials';

const PATH = 'tests/fixtures/material-programs.json';
const SEED = 0x2545f491;

/** The test image: 3 × 2 RGBA texels of assorted bytes, alpha included (rows from the top). */
const TEST_IMAGE: ImagePixels = {
  width: 3,
  height: 2,
  rgba: new Uint8Array([0, 10, 255, 255, 128, 64, 32, 200, 255, 255, 255, 0, 17, 230, 99, 128, 250, 3, 77, 1, 64, 128, 192, 255]),
};

/** A case of the fixture: a program, the images of its table (0 the label, 1 the test image, -1 none), the points. */
interface Case {
  name: string;
  program: Program;
  /** Per entry of the image table: which pixels (0 label, 1 test, -1 none). */
  sources: number[];
  points: number;
  seed: number;
  /** M3c: where the pattern instructions' patterns lie (the fixture's `placement`); absent: the point's own space. */
  placement?: Placement;
}

/** A program written by hand: registers are never reused (no destination is ever an operand of its own instruction). */
class Builder {
  private readonly code: number[] = [];
  readonly consts: number[] = [];
  private nF = 0;
  private nV = 9;
  readonly outputs: ValueRef[] = [];
  readonly images: ProgramImage[] = [];
  readonly sources: number[] = [];

  emit(op: OpCode, d: number, a = NONE, b = NONE, c = NONE, k = NONE): void {
    this.code.push(op, d, a, b, c, k);
  }
  f(): number {
    return this.nF++;
  }
  v(): number {
    return this.nV++;
  }
  const(...xs: number[]): number {
    const at = this.consts.length;
    for (const x of xs) this.consts.push(f(x));
    return at;
  }
  fconst(x: number): number {
    const d = this.f();
    this.emit(OP.FCONST, d, NONE, NONE, NONE, this.const(x));
    return d;
  }
  vconst(x: number, y: number, z: number): number {
    const d = this.v();
    this.emit(OP.VCONST, d, NONE, NONE, NONE, this.const(x, y, z));
    return d;
  }
  /** Component `axis` of V register `r`, times `s`, plus `o`. */
  comp(r: number, axis: 0 | 1 | 2, s = 1, o = 0): number {
    const x = this.f();
    this.emit(axis === 0 ? OP.VX : axis === 1 ? OP.VY : OP.VZ, x, r);
    if (s === 1 && o === 0) return x;
    const d = this.f();
    this.emit(OP.FMADD, d, x, this.fconst(s), this.fconst(o));
    return d;
  }
  /** V register `r` times `s`. */
  scaled(r: number, s: number): number {
    const d = this.v();
    this.emit(OP.VSCALE, d, r, this.fconst(s));
    return d;
  }
  /** `r · 0.5 + 0.5` per component (a unit vector as a colour). */
  colour(r: number): number {
    const h = this.scaled(r, 0.5);
    const d = this.v();
    this.emit(OP.VADD, d, h, this.vconst(0.5, 0.5, 0.5));
    return d;
  }
  op1(op: OpCode, out: 'F' | 'V', a: number, b = NONE, c = NONE, k = NONE): number {
    const d = out === 'F' ? this.f() : this.v();
    this.emit(op, d, a, b, c, k);
    return d;
  }
  out(kind: 'F' | 'V', r: number): void {
    this.outputs.push({ kind, index: r });
  }
  image(source: number, srgb: boolean, wrap: 0 | 1 | 2): number {
    this.images.push({ image: source >= 0 ? { id: `img:${source}`, name: `${source}.png`, width: 1, height: 1 } : null, srgb, wrap });
    this.sources.push(source);
    return this.images.length - 1;
  }
  build(): Program {
    return {
      version: 1,
      code: Int32Array.from(this.code),
      consts: Float32Array.from(this.consts),
      nF: Math.max(this.nF, 0),
      nV: this.nV,
      images: this.images,
      outputs: this.outputs,
      absorptionMm: 0,
      thinWalls: false,
      probes: [],
      uses: { coords: [], fresnel: false, curvature: false, bump: false },
    };
  }
}

// The shading point's registers.
const P = 0;
const N = 1;
const UV0 = 2;
const UV1 = 3;
const I = 4;
const T = 5;

/** Scalar operands from the shading point, over the ranges the instructions care about. */
function scalars(b: Builder): number[] {
  return [
    b.comp(P, 0, 0.05), // ±5
    b.comp(UV0, 1, 2, -1), // −2..2
    b.comp(N, 2), // −1..1
    b.comp(P, 1, 0.3), // ±30
    b.comp(UV1, 0), // −0.5..1.5
    b.comp(I, 0, 0.001), // ±0.001
  ];
}

const UNARY: OpCode[] = [OP.FMOV, OP.FABS, OP.FFLOOR, OP.FFRACT, OP.FSIN, OP.FCLAMP, OP.FINV];
const BINARY: OpCode[] = [OP.FADD, OP.FSUB, OP.FMUL, OP.FDIV, OP.FPOW, OP.FMIN, OP.FMAX, OP.FLT, OP.FGT];
const TERNARY: OpCode[] = [OP.FSMIN, OP.FSMAX, OP.FSSTEP, OP.FMADD, OP.FLERP];
const NAMES: Record<number, string> = Object.fromEntries(Object.entries(OP).map(([k, v]) => [v, k]));

function instructionCases(): Case[] {
  const cases: Case[] = [];
  let seed = 1;
  const add = (name: string, b: Builder, points = 200) => cases.push({ name, program: b.build(), sources: b.sources, points, seed: seed++ });

  // Scalar instructions on scalars of the point.
  for (const op of UNARY) {
    const b = new Builder();
    for (const a of scalars(b)) b.out('F', b.op1(op, 'F', a));
    add(NAMES[op], b);
  }
  for (const op of BINARY) {
    const b = new Builder();
    const s = scalars(b);
    for (const x of s) for (const y of s) b.out('F', b.op1(op, 'F', x, y));
    add(NAMES[op], b);
  }
  for (const op of TERNARY) {
    const b = new Builder();
    const s = scalars(b);
    for (const x of s) for (const y of s.slice(0, 3)) for (const z of s.slice(2)) b.out('F', b.op1(op, 'F', x, y, z));
    add(NAMES[op], b);
  }
  // Conversions and vector instructions.
  {
    const b = new Builder();
    const s = scalars(b);
    b.out('V', b.op1(OP.F2V, 'V', s[0]));
    b.out('V', b.op1(OP.VCOMB, 'V', s[0], s[1], s[3]));
    for (const r of [P, N, UV0, I]) {
      b.out('F', b.op1(OP.VLUM, 'F', r));
      b.out('F', b.op1(OP.VAVG, 'F', r));
      b.out('F', b.op1(OP.VX, 'F', r));
      b.out('F', b.op1(OP.VY, 'F', r));
      b.out('F', b.op1(OP.VZ, 'F', r));
      b.out('V', b.op1(OP.VMOV, 'V', r));
    }
    add('conversions', b);
  }
  {
    const b = new Builder();
    const vs = [b.scaled(P, 0.02), N, UV0, I, b.vconst(0, 0, 0), b.colour(N)];
    const s = scalars(b);
    for (const x of vs) {
      for (const y of vs) {
        for (const op of [OP.VADD, OP.VSUB, OP.VMUL] as OpCode[]) b.out('V', b.op1(op, 'V', x, y));
        b.out('V', b.op1(OP.VNORM, 'V', x, y));
        b.out('F', b.op1(OP.VDOT, 'F', x, y));
        b.out('V', b.op1(OP.VLERP, 'V', x, y, s[1]));
      }
      b.out('V', b.op1(OP.VSCALE, 'V', x, s[3]));
      b.out('V', b.op1(OP.VCLAMP, 'V', x));
      b.out('V', b.op1(OP.VINV, 'V', x));
      b.out('F', b.op1(OP.VLEN, 'F', x));
    }
    // A vector of length zero normalises to its fallback.
    const zero = b.op1(OP.VSUB, 'V', N, N);
    b.out('V', b.op1(OP.VNORM, 'V', zero, I));
    add('vectors', b);
  }
  for (let mode = 0; mode <= 9; mode++) {
    const b = new Builder();
    const x = b.colour(N);
    const y = b.colour(I);
    const big = b.scaled(UV0, 1.5);
    const fac = b.comp(UV0, 0, 1.2, -0.1);
    b.out('V', b.op1(OP.BLEND, 'V', x, y, fac, mode));
    b.out('V', b.op1(OP.BLEND, 'V', big, x, fac, mode));
    b.out('V', b.op1(OP.BLEND, 'V', y, big, b.comp(P, 2, 0.02), mode));
    add(`BLEND ${mode}`, b);
  }
  // Every projection on every axis, with a turn, repeats (one negative) and offsets.
  for (let proj = 0; proj <= 6; proj++) {
    for (let axis = 0; axis <= 3; axis++) {
      const b = new Builder();
      for (const [size, rot, ru, rv, ou, ov] of [
        [100, 0, 1, 1, 0, 0],
        [37.5, 30, 2, -0.5, 0.25, -1.1],
        [0.5, -135, 3.3, 1.7, 7, 0.4],
      ]) {
        const [sn, cs] = sinCos(f(f(rot) * DEG_TO_RAD));
        const k = b.const(proj, axis, size, cs, sn, ru, rv, ou, ov);
        b.out('V', b.op1(OP.MAP, 'V', P, N, UV0, k));
        b.out('V', b.op1(OP.MAP, 'V', b.scaled(P, 0.01), I, UV1, k));
      }
      add(`MAP ${proj} ${axis}`, b);
    }
  }
  // Image reads: every wrap, sRGB and data, at the UVs and far beyond them; a missing image.
  for (const [source, srgb, wrap] of [
    [1, false, 0],
    [1, true, 0],
    [1, false, 1],
    [1, true, 1],
    [1, false, 2],
    [1, true, 2],
    [-1, true, 0],
    [0, true, 1],
  ] as [number, boolean, 0 | 1 | 2][]) {
    const b = new Builder();
    const img = b.image(source, srgb, wrap);
    for (const coords of [UV0, b.scaled(P, 0.02), b.scaled(N, 1.3)]) {
      const alpha = b.f();
      const rgb = b.v();
      b.emit(OP.TEX, rgb, coords, alpha, NONE, img);
      b.out('V', rgb);
      b.out('F', alpha);
    }
    // Without its alpha.
    const rgb = b.v();
    b.emit(OP.TEX, rgb, UV1, NONE, NONE, img);
    b.out('V', rgb);
    add(`TEX ${source} ${srgb ? 'srgb' : 'linear'} ${wrap}`, b);
  }
  // Noise: both kinds, octaves (fractional, out of range), lacunarity, gain, seeds; its colour; far away.
  for (const [kind, octaves, lac, gain, nseed] of [
    [0, 1, 2, 0.5, 0],
    [1, 1, 2, 0.5, 0],
    [0, 4, 2, 0.5, 3],
    [1, 6, 2.1, 0.55, 7],
    [0, 8, 1.9, 0.7, 65535],
    [1, 3, 3, 0.3, 12345],
    [0, 2.5, 2, 0.6, 11],
    [1, 0, 2, 0.5, 1],
    [0, 12, 2, 0.5, 2],
    [2, 2, 2, 1, 4],
  ]) {
    const b = new Builder();
    const k = b.const(kind, octaves, lac, gain, nseed);
    for (const [r, s] of [
      [P, 0.05],
      [UV0, 3],
      [P, 1e7],
    ] as [number, number][]) {
      b.out('F', b.op1(OP.NOISE, 'F', r, b.fconst(s), NONE, k));
      b.out('V', b.op1(OP.NOISEC, 'V', r, b.fconst(s), NONE, k));
    }
    b.out('F', b.op1(OP.NOISE, 'F', P, b.comp(UV0, 0, 0.2), NONE, k));
    add(`NOISE ${kind} ${octaves} ${lac} ${gain} ${nseed}`, b);
  }
  for (let kind = 0; kind <= 7; kind++) {
    const b = new Builder();
    for (const r of [b.scaled(P, 0.01), b.scaled(P, 0.02), UV0, I]) b.out('F', b.op1(OP.GRAD, 'F', r, NONE, NONE, kind));
    add(`GRAD ${kind}`, b);
  }
  {
    const b = new Builder();
    for (const [r, s] of [
      [P, 0.05],
      [P, 1],
      [UV0, 8],
      [N, -2.5],
    ] as [number, number][])
      b.out('F', b.op1(OP.CHECK, 'F', r, b.fconst(s)));
    b.out('F', b.op1(OP.CHECK, 'F', P, b.comp(UV1, 0, 0.1)));
    add('CHECK', b);
  }
  for (let axis = 0; axis <= 3; axis++) {
    const b = new Builder();
    for (const softness of [0, 0.15, 0.6, 1.5, -1]) {
      const k = b.const(axis, softness);
      b.out('F', b.op1(OP.STRIPE, 'F', b.scaled(P, 0.01), b.fconst(3), b.comp(UV0, 0, 0.8, 0.1), k));
      b.out('F', b.op1(OP.STRIPE, 'F', UV0, b.fconst(10), b.fconst(0.5), k));
    }
    add(`STRIPE ${axis}`, b);
  }
  for (const interp of [0, 1, 2, 5]) {
    const b = new Builder();
    for (const stops of [
      [[0.5, 0.1, 0.2, 0.3]],
      [
        [0.2, 1, 0, 0],
        [0.8, 0, 0, 1],
      ],
      [
        [0, 0.1, 0.1, 0.11],
        [0.35, 0.5, 0.49, 0.48],
        [1, 0.88, 0.87, 0.85],
      ],
      [
        [0.05, 0.1, 0.2, 0.15],
        [0.5, 0.3, 0.46, 0.36],
        [0.5, 0.9, 0.1, 0.2],
        [1, 0.42, 0.56, 0.47],
      ],
    ]) {
      const k = b.const(stops.length, interp, ...stops.flat());
      b.out('V', b.op1(OP.RAMP, 'V', b.comp(UV0, 0, 1.2, -0.1), NONE, NONE, k));
      b.out('V', b.op1(OP.RAMP, 'V', b.comp(P, 0, 0.006, 0.5), NONE, NONE, k));
    }
    add(`RAMP ${interp}`, b);
  }
  {
    const b = new Builder();
    const iors = [b.comp(UV0, 0, 2, 0.5), b.fconst(1.5), b.fconst(1), b.fconst(0.7), b.comp(UV1, 1, 3, 0.4)];
    for (const ior of iors) {
      b.out('F', b.op1(OP.FRESNEL, 'F', ior, N, I));
      b.out('F', b.op1(OP.FRESNEL, 'F', ior, I, N));
    }
    for (const blend of [b.comp(UV0, 1), b.fconst(0.5), b.fconst(0.35), b.fconst(0), b.fconst(1), b.fconst(-3)]) {
      b.out('F', b.op1(OP.FACING, 'F', blend, N, I));
      b.out('F', b.op1(OP.FACING, 'F', blend, N, N));
    }
    add('FRESNEL FACING', b);
  }
  {
    const b = new Builder();
    b.out('F', b.op1(OP.EDGE, 'F', NONE, NONE, NONE, b.const(2)));
    b.out('F', b.op1(OP.CAVITY, 'F', NONE, NONE, NONE, b.const(0.5)));
    b.emit(OP.NOP, NONE);
    add('EDGE CAVITY NOP', b);
  }
  for (const space of [0, 1, 4]) {
    const b = new Builder();
    for (const n0 of [N, I, T]) {
      for (const strength of [b.fconst(1), b.fconst(0.35), b.comp(UV0, 0, 2)]) {
        b.out('V', b.op1(OP.NMAP, 'V', b.colour(I), strength, n0, space));
        b.out('V', b.op1(OP.NMAP, 'V', b.vconst(0.5, 0.5, 1), strength, n0, space));
      }
    }
    add(`NMAP ${space}`, b);
  }
  {
    const b = new Builder();
    for (const n0 of [N, I, T]) {
      for (const [dt, db] of [
        [b.comp(UV0, 0, 3), b.comp(UV0, 1, -2)],
        [b.fconst(0), b.fconst(0)],
        [b.fconst(1e30), b.fconst(-1e30)],
      ])
        b.out('V', b.op1(OP.BUMP, 'V', n0, dt, db));
    }
    add('BUMP', b);
  }
  return cases;
}

/** The parameters of a catalogue preset (data/materials.ts) by key. */
function presetParams(key: string): Record<string, unknown> {
  const p = MATERIAL_PRESETS.find((m) => m.key === key);
  if (!p) throw new Error(`no preset ${key}`);
  return p.params as Record<string, unknown>;
}

/**
 * M3c: a placement whose knots cover much of the points of `contractPoints` (P within ±100 mm): a wood frame of the
 * part's own axes with its pith 150 mm below along y, and twelve knots of 26 mm asked, placed in a box of ±100 mm about the
 * points by core/knots.ts (as the engine places them, in f64), rounded to f32, the wide ones with their crack.
 */
function knottyPlacement(): Placement {
  const centre: [number, number, number] = [0, 150, 0];
  const half: [number, number, number] = [100, 100, 100];
  const spec = { count: 12, diameterMm: 26, variation: 0.3, darkness: 0.7, seed: 5 };
  const knots = placeKnots(spec, centre, half, meetsBox(centre, half));
  const list = knots.map((k) => f32Knot(k));
  expect(list.length).toBeGreaterThanOrEqual(4);
  expect(list.some((k) => k.crack !== null)).toBe(true);
  return { origin: [0, -150, 0], axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], mm: 1, knots: { list, darkness: Math.fround(spec.darkness) } };
}

/** M3c: the pattern instructions on the points, each with its four outputs, for woods and cloths of the catalogue. */
function patternCases(): Case[] {
  const cases: Case[] = [];
  let seed = 400;
  const add = (name: string, b: Builder, placement?: Placement, points = 300) => cases.push({ name, program: b.build(), sources: [], points, seed: seed++, ...(placement ? { placement } : {}) });
  const four = (b: Builder, r: PatternRecipe, ops: readonly [OpCode, OpCode, OpCode, OpCode], scales: readonly number[]) => {
    const k = b.const(...recipeConsts(r));
    const rough = b.comp(UV0, 0, 0.5, 0.25);
    for (const s of scales) {
      const at = s === 1 ? P : b.scaled(P, s);
      for (const n of [N, I]) {
        b.out('V', b.op1(ops[0], 'V', at, n, NONE, k));
        b.out('F', b.op1(ops[1], 'F', at, n, rough, k));
        b.out('F', b.op1(ops[2], 'F', at, n, NONE, k));
        b.out('V', b.op1(ops[3], 'V', at, n, NONE, k));
      }
    }
  };
  const WOOD_OPS = [OP.WOOD, OP.WOODR, OP.WOODH, OP.WOODN] as const;
  const CLOTH_OPS = [OP.CLOTH, OP.CLOTHR, OP.CLOTHH, OP.CLOTHN] as const;
  // Every wood of the catalogue (rings, ring-porous and diffuse, strips, speckle, streaks), at the points and at a fifth.
  for (const key of ['OAK', 'PINE', 'WALNUT', 'MAPLE', 'EBONY', 'BAMBOO', 'MDF']) {
    const b = new Builder();
    four(b, woodRecipe(presetParams(key), 3), WOOD_OPS, [1, 0.2]);
    add(`WOOD ${key}`, b);
  }
  // A ring-porous oak with twelve big knots placed about the points: their end grain, bark, cracks, dish and flow.
  {
    const b = new Builder();
    four(b, woodRecipe({ ...presetParams('OAK'), knotCount: 12, knotSize: 26 }, 5), WOOD_OPS, [1]);
    add('WOOD knots', b, knottyPlacement(), 1000);
  }
  // Every weave (and the carbon twill without twist), at the points, at a twentieth and at a hundredth.
  for (const key of ['COTTON', 'TWILL', 'DENIM', 'SATIN', 'CANVAS', 'FELT', 'KNIT', 'CARBON']) {
    const b = new Builder();
    four(b, fabricRecipe(presetParams(key), 0), CLOTH_OPS, [1, 0.05, 0.01]);
    add(`CLOTH ${key}`, b);
  }
  // A recipe that draws nothing (its scale is not positive): black, the roughness read, height 0, the normal read.
  {
    const b = new Builder();
    const r = woodRecipe(presetParams('OAK'), 0);
    four(b, { ...r, scaleMm: 0 }, WOOD_OPS, [1]);
    four(b, { ...fabricRecipe(presetParams('COTTON'), 0), scaleMm: -1 }, CLOTH_OPS, [1]);
    add('PATTERN nothing', b, undefined, 50);
  }
  return cases;
}

/** The placement as the fixture holds it: f32 little-endian, base64 (origin, axes, mm, darkness, count, then per knot origin, axis, flow, across, middle, radius, crack or −1). */
function placementBytes(pl: Placement): Uint8Array {
  const xs: number[] = [...pl.origin, ...pl.axes.flat(), pl.mm, pl.knots.darkness, pl.knots.list.length];
  for (const k of pl.knots.list) xs.push(...k.origin, ...k.axis, ...k.flow, ...k.across, k.middle, k.radius, k.crack ?? -1);
  return new Uint8Array(Float32Array.from(xs).buffer);
}

/** The numbers every scalar function is tried on (computed: ±∞ and NaN cannot be constants). */
function specials(b: Builder): number[] {
  const finite = [0, -0, 1, -1, 0.5, -0.5, 2, -3, 7.25, 1e-7, 16777216, 16777217, 1e30, -1e30, 1e-40, 0.999, 0.001, 3.4e38, 1.5];
  const regs = finite.map((x) => b.fconst(x));
  const big = b.fconst(1e30);
  const inf = b.op1(OP.FMUL, 'F', big, big);
  const ninf = b.op1(OP.FMUL, 'F', big, b.fconst(-1e30));
  const nan = b.op1(OP.FSUB, 'F', inf, inf);
  return [...regs, inf, ninf, nan];
}

function specialCases(): Case[] {
  const cases: Case[] = [];
  const add = (name: string, b: Builder) => cases.push({ name, program: b.build(), sources: b.sources, points: 1, seed: 7 });
  for (const op of UNARY) {
    const b = new Builder();
    for (const x of specials(b)) b.out('F', b.op1(op, 'F', x));
    add(`${NAMES[op]} specials`, b);
  }
  for (const op of BINARY) {
    // 22 × 22 = 484 results: three programs of at most 256 registers each.
    for (let part = 0; part < 3; part++) {
      const b = new Builder();
      const s = specials(b);
      for (const x of s.slice(part * 8, part * 8 + 8)) for (const y of s) b.out('F', b.op1(op, 'F', x, y));
      add(`${NAMES[op]} specials ${part}`, b);
    }
  }
  // Ten of the numbers in every triple: 10 × 10 × 2 per program, five programs.
  const TEN = [0, 1, 2, 3, 4, 6, 12, 19, 20, 21];
  for (const op of TERNARY) {
    for (let part = 0; part < 5; part++) {
      const b = new Builder();
      const all = specials(b);
      const s = TEN.map((i) => all[i]);
      for (const x of s.slice(part * 2, part * 2 + 2)) for (const y of s) for (const z of s) b.out('F', b.op1(op, 'F', x, y, z));
      add(`${NAMES[op]} specials ${part}`, b);
    }
  }
  // Vectors of specials through the vector functions that branch on them.
  {
    const b = new Builder();
    const s = specials(b);
    const vs = [
      [s[0], s[1], s[0]],
      [s[19], s[2], s[0]],
      [s[21], s[2], s[3]],
      [s[9], s[9], s[9]],
      [s[14], s[0], s[1]],
      [s[12], s[13], s[2]],
    ].map(([x, y, z]) => b.op1(OP.VCOMB, 'V', x, y, z));
    for (const v of vs) {
      b.out('V', b.op1(OP.VNORM, 'V', v, N));
      b.out('F', b.op1(OP.VLEN, 'F', v));
      b.out('V', b.op1(OP.VCLAMP, 'V', v));
      b.out('F', b.op1(OP.GRAD, 'F', v, NONE, NONE, 4));
      b.out('F', b.op1(OP.GRAD, 'F', v, NONE, NONE, 5));
      b.out('F', b.op1(OP.FRESNEL, 'F', s[18], v, I));
      b.out('V', b.op1(OP.BUMP, 'V', N, s[2], s[3]));
      b.out('F', b.op1(OP.NOISE, 'F', v, s[2], NONE, b.const(1, 2, 2, 0.5, 0)));
      b.out('F', b.op1(OP.CHECK, 'F', v, s[2]));
    }
    add('vector specials', b);
  }
  return cases;
}

const b64 = (bytes: Uint8Array): string => {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
};
const unb64 = (s: string): Uint8Array => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** The runner of a case: its images, and its placement for the patterns (M3c). */
function runnerOf(c: Case): ProgramRunner {
  const pl = c.placement;
  return new ProgramRunner(c.program, pixelsOf(c), pl ? () => pl : undefined);
}

/** The pixels of the images a case reads. */
function pixelsOf(c: Case): (ImagePixels | null)[] {
  return c.sources.map((s) => (s === 0 ? { width: LABEL_WIDTH, height: LABEL_HEIGHT, rgba: labelPixels() } : s === 1 ? TEST_IMAGE : null));
}

/** FNV-1a over the bits of every coordinate of the points, in order (the engine's points must be these). */
function pointsHash(count: number, seed: number): string {
  const buf = new Float32Array(1);
  const bits = new Uint32Array(buf.buffer);
  let h = 0x811c9dc5;
  for (const pt of contractPoints(count, seed)) {
    for (const v of [pt.P, pt.N, pt.UV0, pt.UV1, pt.I, pt.T, pt.B, pt.dUVdT, pt.dUVdB]) {
      for (let c = 0; c < 3; c++) {
        buf[0] = c < v.length ? v[c] : 0;
        for (let k = 0; k < 4; k++) {
          h ^= (bits[0] >>> (k * 8)) & 0xff;
          h = Math.imul(h, 0x01000193);
        }
      }
    }
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function allCases(): Case[] {
  const label = registerLabelImage();
  const examples: Case[] = MATERIAL_GRAPHS.map((def) => {
    const program = compileGraph(graphOfExample(def, label)).program!;
    return { name: def.key, program, sources: program.images.map((im) => (im.image ? 0 : -1)), points: 1000, seed: SEED };
  });
  return [...examples, ...instructionCases(), ...specialCases(), ...patternCases()];
}

/** The fixture's text for `cases`: one case a line. */
function fixtureText(cases: Case[]): string {
  const lines = cases.map((c) => {
    const bytes = encodeProgram(c.program, (_ref, i) => (c.sources[i] >= 0 ? c.sources[i] : 0));
    const hash = crossHash(runnerOf(c), contractPoints(c.points, c.seed));
    const placement = c.placement ? `, "placement": "${b64(placementBytes(c.placement))}"` : '';
    return `    {"name": ${JSON.stringify(c.name)}, "points": ${c.points}, "seed": ${c.seed}, "hash": "${hash}", "program": "${b64(deflateSync(bytes))}"${placement}}`;
  });
  const label = b64(deflateSync(labelPixels()));
  const test = Array.from(TEST_IMAGE.rgba).join(', ');
  return [
    '{',
    '  "comment": "M3b: the cross test of the material programs (tests/material-program-cross.test.ts writes it; engine/crates/rt-core/src/program/tests.rs reads it). Each case: a program (zlib, base64; image index 0 is the label, 1 the test image), the points of contractPoints(points, seed) and the FNV-1a of every output there.",',
    `  "pointsHash1000": "${pointsHash(1000, SEED)}",`,
    `  "label": {"width": ${LABEL_WIDTH}, "height": ${LABEL_HEIGHT}, "rgba": "${label}"},`,
    `  "testImage": {"width": ${TEST_IMAGE.width}, "height": ${TEST_IMAGE.height}, "rgba": [${test}]},`,
    '  "cases": [',
    lines.join(',\n'),
    '  ]',
    '}',
    '',
  ].join('\n');
}

interface FixtureCase {
  name: string;
  points: number;
  seed: number;
  hash: string;
  program: string;
}

// M3c: the pattern cases evaluate E6's recipes in f32 at a few thousand points; on a loaded machine that passes the
// default 5 s.
describe('the cross test of the material programs (M3b)', () => {
  const cases = allCases();

  if (process.env.REPACK_WRITE_PROGRAM_FIXTURE) {
    writeFileSync(PATH, fixtureText(cases));
  }

  it('has a fixture of every case, with the programs this compiler and these builders make', () => {
    expect(existsSync(PATH), `${PATH}: REPACK_WRITE_PROGRAM_FIXTURE=1 npx vitest run tests/material-program-cross.test.ts`).toBe(true);
    const fixture = JSON.parse(readFileSync(PATH, 'utf8')) as { pointsHash1000: string; label: { rgba: string }; cases: FixtureCase[] };
    expect(fixture.cases.map((c) => c.name)).toEqual(cases.map((c) => c.name));
    expect(fixture.pointsHash1000).toBe(pointsHash(1000, SEED));
    expect(new Uint8Array(inflateSync(unb64(fixture.label.rgba)))).toEqual(labelPixels());
    for (const [i, c] of cases.entries()) {
      const fx = fixture.cases[i];
      const bytes = encodeProgram(c.program, (_ref, k) => (c.sources[k] >= 0 ? c.sources[k] : 0));
      expect(new Uint8Array(inflateSync(unb64(fx.program))), c.name).toEqual(bytes);
      expect([fx.points, fx.seed], c.name).toEqual([c.points, c.seed]);
    }
  }, 120_000);

  it('pins the reference interpreter’s values of every case (the engine must give the same)', () => {
    const fixture = JSON.parse(readFileSync(PATH, 'utf8')) as { cases: FixtureCase[] };
    const got: Record<string, string> = {};
    const want: Record<string, string> = {};
    for (const [i, c] of cases.entries()) {
      got[c.name] = crossHash(runnerOf(c), contractPoints(c.points, c.seed));
      want[c.name] = fixture.cases[i].hash;
    }
    expect(got).toEqual(want);
    // The examples' values are M3a's pins (tests/material-program.test.ts).
    expect(got.PLASTIC_LABEL).toBe('ca47a410');
    expect(got.STRIPES).toBe('9dd8d317');
  }, 120_000);

  it('covers every opcode of the contract', () => {
    const used = new Set<number>();
    for (const c of cases) for (let i = 0; i < c.program.code.length; i += 6) used.add(c.program.code[i]);
    expect([...Object.values(OP)].filter((op) => !used.has(op))).toEqual([]);
  });
});
