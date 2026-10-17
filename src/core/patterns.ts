// E6's procedural wood and cloth in f32 (phase M3c): rt_core::pattern (pattern.rs, pattern/noise.rs, pattern/wood.rs,
// pattern/knots.rs `flow`, pattern/cloth.rs) written again operation by operation, so that the reference interpreter of
// the material programs (core/material-interp.ts) gives the engine's bits for the pattern nodes (WOOD and FABRIC, the
// WOOD* and CLOTH* instructions of ARCHITECTURE §5.2 quater). The cross test (tests/material-program-cross.test.ts,
// tests/fixtures/material-patterns.json, rt-core program/tests.rs) pins both sides to the same bits.
//
// Every floating-point step is rounded to f32 (`f` = Math.fround) in the order Rust writes it (left to right, never
// fused); `min`/`max` follow Rust's f32::min/max (a NaN loses); casts to integers saturate as Rust's `as` does; the
// integer steps are 32-bit (Math.imul is wrapping_mul). Pure: no DOM, no three. The engine places a pattern on each
// part (its frame from the mesh's box, its knots); here a `Placement` is given (the Fast preview's from the parts'
// box, core/material-preview.ts), or the point's own space (`IDENTITY_PLACEMENT`).

import { f, sinCos, sqrt } from './f32math';

export type V = [number, number, number];

// --- f32 helpers ----------------------------------------------------------------------------------

const add = (a: number, b: number) => f(a + b);
const sub = (a: number, b: number) => f(a - b);
const mul = (a: number, b: number) => f(a * b);
const div = (a: number, b: number) => f(a / b);
/** Rust f32::min: the other value when one is NaN. */
const fmin = (a: number, b: number) => (a !== a ? b : b !== b ? a : b < a ? b : a);
/** Rust f32::max. */
const fmax = (a: number, b: number) => (a !== a ? b : b !== b ? a : b > a ? b : a);
/** Rust f32::clamp: the comparisons (a NaN goes through). */
const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);
/** Rust `x as i32` for a float: NaN 0, saturating, towards zero. */
function toI32(x: number): number {
  if (x !== x) return 0;
  if (x >= 2147483647) return 2147483647;
  if (x <= -2147483648) return -2147483648;
  return Math.trunc(x) | 0;
}
/** `i32.rem_euclid(m)` for m > 0. */
const remEuclid = (a: number, m: number) => ((a % m) + m) % m;

const vadd = (a: V, b: V): V => [add(a[0], b[0]), add(a[1], b[1]), add(a[2], b[2])];
const vsub = (a: V, b: V): V => [sub(a[0], b[0]), sub(a[1], b[1]), sub(a[2], b[2])];
const vscale = (a: V, s: number): V => [mul(a[0], s), mul(a[1], s), mul(a[2], s)];
const vdot = (a: V, b: V) => add(add(mul(a[0], b[0]), mul(a[1], b[1])), mul(a[2], b[2]));
const vcross = (a: V, b: V): V => [sub(mul(a[1], b[2]), mul(a[2], b[1])), sub(mul(a[2], b[0]), mul(a[0], b[2])), sub(mul(a[0], b[1]), mul(a[1], b[0]))];
const finite3 = (a: V) => Number.isFinite(a[0]) && Number.isFinite(a[1]) && Number.isFinite(a[2]);
/** Vec3::normalize: unchanged when the length is not a positive finite number. */
function vnormalize(a: V): V {
  const len = sqrt(vdot(a, a));
  return len > 0 && Number.isFinite(len) ? [div(a[0], len), div(a[1], len), div(a[2], len)] : a;
}
const LUM: V = [f(0.2126), f(0.7152), f(0.0722)];
const lum = (c: V) => add(add(mul(LUM[0], c[0]), mul(LUM[1], c[1])), mul(LUM[2], c[2]));
const k32 = (x: number) => f(x);

const AXES: [V, V, V] = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];

// --- Noise (pattern/noise.rs) ----------------------------------------------------------------------

/** The permutation of 0..255, twice: a Fisher–Yates shuffle driven by the engine's PCG32 seeded with "REPACKE6", stream 6. */
const PERM: Uint8Array = (() => {
  const M64 = (1n << 64n) - 1n;
  const MULT = 6364136223846793005n;
  let state = 0n;
  const inc = ((6n << 1n) | 1n) & M64;
  const next = (): number => {
    const old = state;
    state = (old * MULT + inc) & M64;
    const xorshifted = Number((((old >> 18n) ^ old) >> 27n) & 0xffffffffn) >>> 0;
    const rot = Number(old >> 59n);
    return ((xorshifted >>> rot) | (xorshifted << ((32 - rot) & 31))) >>> 0;
  };
  next();
  state = (state + 0x52455041434b4536n) & M64;
  next();
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i >= 1; i--) {
    const n = i + 1;
    const limit = 0xffffffff - (0xffffffff % n);
    let x = next();
    while (!(x < limit)) x = next();
    const j = x % n;
    const t = p[i];
    p[i] = p[j];
    p[j] = t;
  }
  const t = new Uint8Array(512);
  for (let i = 0; i < 512; i++) t[i] = p[i & 255];
  return t;
})();

/** The first eight entries of the permutation (pinned in rt-core's noise tests). */
export const PERM_FIRST: readonly number[] = Array.from(PERM.subarray(0, 8));

const fade = (t: number) => mul(mul(mul(t, t), t), add(mul(t, sub(mul(t, 6), 15)), 10));
const lerpN = (t: number, a: number, b: number) => add(a, mul(t, sub(b, a)));

function grad(hash: number, x: number, y: number, z: number): number {
  const h = hash & 15;
  const u = h < 8 ? x : y;
  const v = h < 4 ? y : h === 12 || h === 14 ? x : z;
  return add((h & 1) === 0 ? u : -u, (h & 2) === 0 ? v : -v);
}

/** Lattice cell (Rust: `(floor as i64).rem_euclid(256)`, saturating) and the position inside it. */
function cell(v: number): [number, number] {
  const fl = Math.floor(v);
  let i: number;
  if (fl >= 9223372036854775807) i = 255;
  else if (fl <= -9223372036854775808) i = 0;
  else i = remEuclid(fl % 256, 256);
  return [i, sub(v, fl)];
}

/** Gradient noise at `p`, about [−1, 1] (rt_core::pattern::noise::noise3). */
export function noise3(p: V): number {
  if (!finite3(p)) return 0;
  const P = PERM;
  const [xi, x] = cell(p[0]);
  const [yi, y] = cell(p[1]);
  const [zi, z] = cell(p[2]);
  const u = fade(x);
  const v = fade(y);
  const w = fade(z);
  const a = P[xi] + yi;
  const aa = P[a] + zi;
  const ab = P[a + 1] + zi;
  const b = P[xi + 1] + yi;
  const ba = P[b] + zi;
  const bb = P[b + 1] + zi;
  const x1 = sub(x, 1);
  const y1 = sub(y, 1);
  const z1 = sub(z, 1);
  return lerpN(
    w,
    lerpN(v, lerpN(u, grad(P[aa], x, y, z), grad(P[ba], x1, y, z)), lerpN(u, grad(P[ab], x, y1, z), grad(P[bb], x1, y1, z))),
    lerpN(v, lerpN(u, grad(P[aa + 1], x, y, z1), grad(P[ba + 1], x1, y, z1)), lerpN(u, grad(P[ab + 1], x, y1, z1), grad(P[bb + 1], x1, y1, z1))),
  );
}

const OCTAVE_SHIFT: V = [k32(19.191), k32(7.453), k32(31.337)];

/** The fractal sum of `octaves` octaves of `noise3`, normalised by the amplitudes (rt_core::pattern::noise::fbm). */
export function fbm(p: V, octaves: number): number {
  let sum = 0;
  let amplitude = 1;
  let total = 0;
  let q = p;
  const n = Math.max(1, octaves);
  for (let o = 0; o < n; o++) {
    sum = add(sum, mul(amplitude, noise3(vadd(q, vscale(OCTAVE_SHIFT, f(o))))));
    total = add(total, amplitude);
    amplitude = mul(amplitude, 0.5);
    q = vscale(q, 2);
  }
  return div(sum, total);
}

/** An integer cell to [0, 1) (rt_core::pattern::noise::hash01): `a`, `b` as i32, `c` as u32. */
export function hash01(a: number, b: number, c: number): number {
  let x = (Math.imul(a | 0, 0x9e3779b1 | 0) + Math.imul(b | 0, 0x85ebca77 | 0) + Math.imul(c >>> 0, 0xc2b2ae3d | 0)) >>> 0;
  x = (x ^ (x >>> 16)) >>> 0;
  x = Math.imul(x, 0x7feb352d) >>> 0;
  x = (x ^ (x >>> 15)) >>> 0;
  x = Math.imul(x, 0x846ca68b | 0) >>> 0;
  x = (x ^ (x >>> 16)) >>> 0;
  return f((x >>> 8) * (1 / 16777216));
}

// --- Knots (pattern/knots.rs: what a placed knot does to a point) ---------------------------------

/** One knot in the wood frame (mm), as rt_core::pattern::knots::Knot. */
export interface PatternKnot {
  origin: V;
  axis: V;
  flow: V;
  across: V;
  middle: number;
  radius: number;
  /** The angle of its crack, or null. */
  crack: number | null;
}

export const KNOT_FADE: readonly [number, number] = [1.5, 3];
const KNOT_BULGE = k32(0.35);
const BARK_MM = k32(0.5);
const DISH_MM = k32(0.05);
const CRACK_HALF_MM = k32(0.15);

const radiusAt = (k: PatternKnot, s: number) => mul(k.radius, add(0.5, div(mul(0.5, s), k.middle)));

type Flow = { kind: 'around'; point: V; bulge: number } | { kind: 'in'; knot: number; a: number; b: number; rho: number; radius: number };

function knotFlow(knots: readonly PatternKnot[], q: V): Flow {
  let point = q;
  let bulge = 0;
  for (let i = 0; i < knots.length; i++) {
    const k = knots[i];
    const rel = vsub(q, k.origin);
    const s = vdot(rel, k.axis);
    if (s <= 0) continue;
    const a = vdot(rel, k.across);
    const b = vdot(rel, k.flow);
    const rho2 = add(mul(a, a), mul(b, b));
    const r = radiusAt(k, s);
    if (rho2 < mul(r, r)) return { kind: 'in', knot: i, a, b, rho: sqrt(rho2), radius: r };
    const reach = mul(KNOT_FADE[1], r);
    if (rho2 >= mul(reach, reach)) continue;
    const rho = sqrt(rho2);
    const fadeK = sub(1, smoothstep(mul(KNOT_FADE[0], r), reach, rho));
    const k2 = div(mul(r, r), rho2);
    point = vadd(point, vscale(k.across, mul(mul(-a, k2), fadeK)));
    bulge = add(bulge, mul(mul(mul(KNOT_BULGE, r), k2), fadeK));
  }
  return { kind: 'around', point, bulge };
}

// --- Wood (pattern/wood.rs) -----------------------------------------------------------------------

const MEAN_DARK = k32(0.4);
const PORE_DEPTH = k32(0.15);
const PORE_STRETCH = 10;
const WANDER_MM = 25;
const FIBRE_MM: readonly [number, number] = [k32(0.3), 30];
const BUNDLE_CELL_MM: readonly [number, number] = [k32(0.816), 4];
const BUNDLE_HALF_MM: readonly [number, number] = [k32(0.2), 1.5];
const NODE_MM: readonly [number, number] = [150, 30];
const NODE_HEIGHT_MM = k32(0.02);

/** smoothstep of pattern/wood.rs (no guard for equal edges). */
export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp(div(sub(x, e0), sub(e1, e0)), 0, 1);
  return mul(mul(t, t), sub(3, mul(2, t)));
}

function ringProfile(fr: number): number {
  const rise = clamp(div(sub(fr, k32(0.225)), k32(0.7)), 0, 1);
  return mul(rise, sub(1, smoothstep(k32(0.95), 1, fr)));
}

export type WoodFigure = 0 | 1 | 2 | 3;

export interface Wood {
  light: V;
  dark: V;
  ringMm: number;
  ringVariation: number;
  ringNoise: number;
  axialNoise: number;
  colorNoise: number;
  contrast: number;
  poreMm: number;
  poreDepth: number;
  poreBand: number;
  fibre: number;
  figure: WoodFigure;
}

interface WoodSample {
  color: V;
  dark: number;
  height: number;
  roughAdd: number;
  ring: number | null;
}

const ONE_MINUS_MEAN_DARK = f(1 - MEAN_DARK);

function woodColors(w: Wood): [V, V] {
  const mean = vadd(vscale(w.light, ONE_MINUS_MEAN_DARK), vscale(w.dark, MEAN_DARK));
  const la = lum(w.light);
  const lb = lum(w.dark);
  const lm = lum(mean);
  const c = w.contrast;
  const den = sub(Math.abs(sub(la, lb)), mul(mul(c, sub(add(la, lb), mul(2, lm))), la >= lb ? 1 : -1));
  if (c <= 0 || Math.abs(sub(la, lb)) <= 0 || den <= 0) return [w.light, w.dark];
  const k = fmin(div(mul(mul(2, lm), c), den), 1.5);
  const pull = (v: V): V => vadd(vscale(mean, sub(1, k)), vscale(v, k)).map((x) => clamp(x, 0, 1)) as V;
  return [pull(w.light), pull(w.dark)];
}

const SLOW_SHIFT: V = [k32(41.3), k32(17.9), k32(5.1)];
const ALONG_SHIFT: V = [k32(3.7), k32(91.1), k32(12.5)];

function ringPhase(w: Wood, q: V, bulge: number): number {
  const s = fmax(w.ringMm, k32(1e-3));
  const slow: V = [div(q[0], WANDER_MM), div(q[1], WANDER_MM), div(q[2], 4 * WANDER_MM)];
  const push = mul(mul(1.5, s), w.ringNoise);
  const x = add(q[0], mul(push, fbm(slow, 2)));
  const y = add(q[1], mul(push, fbm(vadd(slow, SLOW_SHIFT), 2)));
  let rho = sqrt(add(mul(x, x), mul(y, y)));
  const along: V = [div(q[0], 2 * WANDER_MM), div(q[1], 2 * WANDER_MM), div(q[2], 150)];
  rho = add(rho, mul(mul(w.axialNoise, s), fbm(vadd(along, ALONG_SHIFT), 2)));
  if (bulge !== 0) rho = sub(rho, bulge);
  const phase = div(rho, s);
  return add(phase, mul(mul(k32(0.6), w.ringVariation), noise3([mul(phase, k32(0.37)), k32(7.31), k32(2.9)])));
}

function woodFigure(w: Wood, q: V, bulge: number): [number, number | null] {
  switch (w.figure) {
    case 1: {
      const s = fmax(w.ringMm, k32(1e-3));
      const strip = toI32(Math.floor(div(q[0], s)));
      const k = hash01(strip, toI32(Math.floor(div(q[1], mul(8, s)))), 41);
      const qs = div(q[0], s);
      const edge = sub(qs, Math.floor(qs));
      const seam = sub(1, smoothstep(0, k32(0.04), fmin(edge, sub(1, edge))));
      return [fmin(add(add(k32(0.24), mul(k32(0.3), k)), mul(k32(0.35), seam)), 1), null];
    }
    case 2: {
      const n = noise3(vadd(vscale(q, f(1 / k32(0.15))), [17, 17, 17]));
      const m = noise3(vadd(vscale(q, f(1 / k32(0.6))), [3, 3, 3]));
      return [clamp(add(add(MEAN_DARK, mul(k32(1.1), n)), mul(k32(0.6), m)), 0, 1), null];
    }
    default: {
      const phase = ringPhase(w, q, bulge);
      const fr = sub(phase, Math.floor(phase));
      let dark = ringProfile(fr);
      if (w.figure === 3) {
        const streak = noise3(vadd([div(q[0], 2), div(q[1], 2), div(q[2], 40)], [5.5, 5.5, 5.5]));
        const s = smoothstep(k32(0.05), k32(0.35), streak);
        dark = add(add(k32(0.1), mul(k32(0.4), dark)), mul(k32(0.9), s));
        dark = clamp(dark, 0, 1);
      }
      return [dark, fr];
    }
  }
}

function bamboo(w: Wood, q: V): [number, number] {
  const s = fmax(w.ringMm, k32(1e-3));
  const strip = toI32(Math.floor(div(q[0], s)));
  const [cellMm, len] = BUNDLE_CELL_MM;
  const [half, long] = BUNDLE_HALF_MM;
  const ci = toI32(Math.floor(div(q[0], cellMm)));
  const cj = toI32(Math.floor(div(q[1], cellMm)));
  const kk = toI32(Math.floor(div(q[2], len)));
  let e = Infinity;
  for (let i = ci - 1; i <= ci + 1; i++) {
    for (let j = cj - 1; j <= cj + 1; j++) {
      const id = (Math.imul(i, 7919) + Math.imul(j, 104729)) | 0;
      const at = (c: number) => hash01(id, kk, 60 + c);
      const d = vsub(q, [mul(add(f(i), at(0)), cellMm), mul(add(f(j), at(1)), cellMm), add(add(mul(f(kk), len), long), mul(sub(len, mul(2, long)), at(2)))]);
      const dx = div(d[0], half);
      const dy = div(d[1], half);
      const dz = div(d[2], long);
      e = fmin(e, add(add(mul(dx, dx), mul(dy, dy)), mul(dz, dz)));
    }
  }
  const fleck = sub(1, smoothstep(0.5, 1, e));
  const [step, wiggle] = NODE_MM;
  const shift = mul(step, hash01(strip, 0, 51));
  const n = toI32(Math.floor(div(sub(q[2], shift), step)));
  const centreOf = (m: number) => add(add(shift, mul(f(m), step)), mul(wiggle, sub(mul(2, hash01(strip, m, 52)), 1)));
  const gap = fmin(Math.abs(sub(q[2], centreOf(n))), Math.abs(sub(q[2], centreOf(n + 1))));
  const node = sub(1, smoothstep(k32(0.8), k32(1.2), gap));
  const factor = mul(sub(1, mul(k32(0.1), fleck)), sub(1, mul(k32(0.15), node)));
  return [factor, mul(NODE_HEIGHT_MM, sub(1, smoothstep(0, 1.5, gap)))];
}

const PORE_SHIFT: V = [k32(13.1), k32(5.7), k32(77.7)];

function pores(w: Wood, q: V, ring: number | null): number {
  if (w.poreMm <= 0 || w.poreDepth <= 0) return 0;
  const wd = w.poreMm;
  const p: V = [div(q[0], wd), div(q[1], wd), div(q[2], mul(wd, PORE_STRETCH))];
  const n = noise3(vadd(p, PORE_SHIFT));
  let band: number;
  let banded: number;
  if (ring !== null) {
    band = mul(smoothstep(0, k32(0.04), ring), sub(1, smoothstep(k32(0.12), k32(0.24), ring)));
    banded = w.poreBand;
  } else {
    band = 1;
    banded = 0;
  }
  const lo = sub(0.25, mul(k32(0.2), banded));
  return mul(smoothstep(lo, add(lo, k32(0.2)), n), sub(1, mul(banded, sub(1, band))));
}

const poreDepthMm = (w: Wood) => mul(mul(PORE_DEPTH, w.poreDepth), w.poreMm);

const SLOW_COLOR_SHIFT: V = [57, 57, 57];
const slowNoise = (q: V) => fbm(vadd([div(q[0], 60), div(q[1], 60), div(q[2], 180)], SLOW_COLOR_SHIFT), 3);

function woodKnot(w: Wood, q: V, knots: PatternKnots, at: Extract<Flow, { kind: 'in' }>): WoodSample {
  const [light, darkColor] = woodColors(w);
  const fine = fmax(div(w.ringMm, 3), k32(1e-3));
  const phase = add(div(at.rho, fine), mul(k32(0.3), noise3(vadd(vscale(q, f(1 / 3)), [29, 29, 29]))));
  const dark = ringProfile(sub(phase, Math.floor(phase)));
  let color = vadd(vscale(light, sub(1, dark)), vscale(darkColor, dark));
  color = vscale(color, mul(sub(1, mul(k32(0.35), knots.darkness)), add(1, mul(mul(0.5, w.colorNoise), slowNoise(q)))));
  const edge = sub(at.radius, at.rho);
  const pocket = sub(1, smoothstep(sub(BARK_MM, k32(0.1)), BARK_MM, edge));
  color = vscale(color, sub(1, mul(0.5, pocket)));
  const crack = knots.list[at.knot].crack;
  if (crack !== null) {
    const [sn, cs] = sinCos(crack);
    const along = add(mul(at.a, cs), mul(at.b, sn));
    const off = Math.abs(sub(mul(at.b, cs), mul(at.a, sn)));
    if (along > 0) {
      const c = sub(1, smoothstep(sub(CRACK_HALF_MM, k32(0.05)), CRACK_HALF_MM, off));
      color = vscale(color, sub(1, mul(k32(0.2), c)));
    }
  }
  const t = div(at.rho, at.radius);
  return { color: color.map((c) => clamp(c, 0, 1)) as V, dark, height: mul(-DISH_MM, sub(1, mul(t, t))), roughAdd: k32(0.1), ring: null };
}

function woodSample(w: Wood, q0: V, knots: PatternKnots): WoodSample {
  const fl = knotFlow(knots.list, q0);
  if (fl.kind === 'in') return woodKnot(w, q0, knots, fl);
  const q = fl.point;
  const [light, darkColor] = woodColors(w);
  const [dark, ring] = woodFigure(w, q, fl.bulge);
  let color = vadd(vscale(light, sub(1, dark)), vscale(darkColor, dark));
  const fibre = noise3([div(q[0], FIBRE_MM[0]), div(q[1], FIBRE_MM[0]), div(q[2], FIBRE_MM[1])]);
  const k = add(add(1, mul(mul(k32(0.12), w.fibre), fibre)), mul(mul(0.5, w.colorNoise), slowNoise(q)));
  color = vscale(color, fmax(k, 0));
  const pore = pores(w, q, ring);
  if (pore > 0) color = vscale(color, sub(1, mul(mul(k32(0.6), fmin(w.poreDepth, 1)), pore)));
  let height = mul(-poreDepthMm(w), pore);
  if (w.figure === 1) {
    const [factor, node] = bamboo(w, q);
    color = vscale(color, factor);
    height = add(height, node);
  }
  const banded = w.poreMm > 0 && w.poreDepth > 0 && w.poreBand > 0;
  return { color: color.map((c) => clamp(c, 0, 1)) as V, dark, height, roughAdd: 0, ring: banded ? ring : null };
}

const woodHasRelief = (w: Wood, knots: PatternKnots) => (w.poreMm > 0 && w.poreDepth > 0) || w.figure === 1 || knots.list.length > 0;

function woodHeight(w: Wood, q0: V, ring: number | null, knots: PatternKnots): number {
  const fl = knotFlow(knots.list, q0);
  if (fl.kind === 'in') {
    const t = div(fl.rho, fl.radius);
    return mul(-DISH_MM, sub(1, mul(t, t)));
  }
  let h = mul(-poreDepthMm(w), pores(w, fl.point, ring));
  if (w.figure === 1) h = add(h, bamboo(w, fl.point)[1]);
  return h;
}

// --- Cloth (pattern/cloth.rs) ---------------------------------------------------------------------

/** The weave codes of `PATN.variant` (0 plain, 1 twill 2/2, 2 satin, 3 canvas, 4 knit, 5 felt, 6 twill 3/1). */
export type Weave = 0 | 1 | 2 | 3 | 4 | 5 | 6;

const MEAN_SHADE: readonly number[] = [0.892, 0.902, 0.907, 0.9, 0.881, 0.861, 0.907].map(k32);
const THREAD = k32(0.86);
const TWIST_PER_PITCH = 2;
const TWIST_DEPTH = k32(0.12);
const KNIT_LEAN: readonly [number, number] = [k32(0.258819), k32(0.965926)];
const KNIT_LEG: readonly [number, number, number] = [k32(0.19), k32(0.62), k32(0.24)];
const TWIST_ACROSS = f(TWIST_PER_PITCH * k32(1.4));
const INV_095 = f(1 / k32(0.95));

export interface Cloth {
  warp: V;
  weft: V;
  pitchMm: number;
  relief: number;
  twist: number;
  weave: Weave;
}

function warpUp(weave: Weave, i: number, j: number): boolean {
  switch (weave) {
    case 1:
      return remEuclid((i + j) | 0, 4) < 2;
    case 6:
      return remEuclid((i + j) | 0, 4) < 3;
    case 2:
      return remEuclid((j - Math.imul(2, i)) | 0, 5) !== 0;
    case 3:
      return remEuclid((Math.floor(i / 2) + Math.floor(j / 2)) | 0, 2) === 0;
    default:
      return remEuclid((i + j) | 0, 2) === 0;
  }
}

function twistOf(s: number, c: number, depth: number): number {
  const t = add(mul(s, TWIST_PER_PITCH), mul(c, TWIST_ACROSS));
  const tri = Math.abs(sub(mul(2, sub(t, Math.floor(t))), 1));
  return sub(1, mul(depth, sub(1, smoothstep(0, 1, tri))));
}

function roundThread(c: number, w: number): number {
  const t = div(mul(2, c), w);
  return Math.abs(t) >= 1 ? 0 : sqrt(sub(1, mul(t, t)));
}

interface ClothSample {
  color: V;
  roughness: number;
  height: number;
  alongV: boolean;
}

function clothSample(c: Cloth, u: number, v: number): ClothSample {
  const p = fmax(c.pitchMm, k32(1e-3));
  const x = div(u, p);
  const y = div(v, p);
  let z: number;
  let warp: number;
  let i: number;
  let j: number;
  if (c.weave === 5) {
    const n = fbm([x, y, 0.5], 4);
    z = add(0.5, mul(0.5, n));
    warp = smoothstep(k32(-0.3), k32(0.3), fbm([mul(x, k32(0.37)), mul(y, k32(0.37)), 9.5], 2));
    i = toI32(Math.floor(x));
    j = toI32(Math.floor(y));
  } else if (c.weave === 4) {
    const i0 = toI32(Math.floor(x));
    const j0 = toI32(Math.floor(y));
    const fx = sub(x, Math.floor(x));
    const fy = sub(y, Math.floor(y));
    const [sin, cos] = KNIT_LEAN;
    z = 0;
    let at: [number, number] = [i0, j0];
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        const lx = sub(fx, di);
        const ly = sub(fy, dj);
        for (const side of [-1, 1]) {
          const dx = sub(lx, add(0.5, mul(side, KNIT_LEG[0])));
          const dy = sub(ly, 0.5);
          const along = div(add(mul(mul(dx, side), sin), mul(dy, cos)), KNIT_LEG[1]);
          const across = div(sub(mul(dx, cos), mul(mul(dy, side), sin)), KNIT_LEG[2]);
          const e = add(mul(along, along), mul(across, across));
          if (e < 1) {
            const h = sqrt(sub(1, e));
            if (h > z) {
              z = h;
              at = [(i0 + di) | 0, (j0 + dj) | 0];
            }
          }
        }
      }
    }
    warp = hash01(at[0], at[1], 11);
    i = at[0];
    j = at[1];
  } else {
    const weave = c.weave;
    const state = (a: number, b: number) => (warpUp(weave, a, b) ? 1 : 0);
    i = toI32(Math.floor(x));
    j = toI32(Math.floor(y));
    const cx = sub(sub(x, Math.floor(x)), 0.5);
    const cy = sub(sub(y, Math.floor(y)), 0.5);
    const ym = sub(y, 0.5);
    const ky = toI32(Math.floor(ym));
    const ty = sub(ym, Math.floor(ym));
    const liftWarp = add(state(i, ky), mul(sub(state(i, (ky + 1) | 0), state(i, ky)), smoothstep(0, 1, ty)));
    const xm = sub(x, 0.5);
    const kx = toI32(Math.floor(xm));
    const tx = sub(xm, Math.floor(xm));
    const s0 = sub(1, state(kx, j));
    const s1 = sub(1, state((kx + 1) | 0, j));
    const liftWeft = add(s0, mul(sub(s1, s0), smoothstep(0, 1, tx)));
    const depth = mul(TWIST_DEPTH, c.twist);
    const zw = mul(mul(add(k32(0.35), mul(k32(0.65), liftWarp)), roundThread(cx, THREAD)), twistOf(y, cx, depth));
    const zf = mul(mul(add(k32(0.35), mul(k32(0.65), liftWeft)), roundThread(cy, THREAD)), twistOf(x, cy, depth));
    if (zw >= zf) {
      z = zw;
      warp = 1;
    } else {
      z = zf;
      warp = 0;
    }
  }
  const [thread, salt] = warp > 0.5 ? [i, 1] : [j, 2];
  const h = hash01(thread, salt, c.weave);
  const base = vadd(vscale(c.warp, warp), vscale(c.weft, sub(1, warp)));
  const shade = div(add(k32(0.7), mul(mul(k32(0.3), clamp(z, 0, 1)), INV_095)), MEAN_SHADE[c.weave]);
  const color = vscale(base, mul(shade, add(k32(0.94), mul(k32(0.12), h))));
  return {
    color: color.map((x2) => clamp(x2, 0, 1)) as V,
    roughness: add(k32(0.9), mul(k32(0.2), hash01(thread, salt + 7, 3))),
    height: mul(mul(mul(z, c.relief), 0.5), p),
    alongV: warp > 0.5 || c.weave === 4,
  };
}

const clothHeight = (c: Cloth, u: number, v: number) => clothSample(c, u, v).height;

// --- Recipes, placements and samples (pattern.rs) -------------------------------------------------

/** `PATN.kind` of a wood and of a cloth. */
export const PATTERN_WOOD = 1;
export const PATTERN_CLOTH = 2;
/** Constants of a pattern instruction's recipe: the PATN layout (two colours, scale, 16 parameters, variant, seed). */
export const PATTERN_CONSTS = 25;
/** Most knots of a piece (rt_core::pattern::knots::MAX_KNOTS). */
export const PATTERN_MAX_KNOTS = 12;

export interface KnotAsk {
  count: number;
  diameterMm: number;
  variation: number;
  darkness: number;
  seed: number;
}

export type Recipe = { kind: 'WOOD'; wood: Wood; anisotropy: number; knots: KnotAsk } | { kind: 'CLOTH'; cloth: Cloth };

/** The knots placed on a part: the list and their darkness (rt_core::pattern::knots::Knots). */
export interface PatternKnots {
  list: readonly PatternKnot[];
  darkness: number;
}

/** Where a pattern lies (rt_core::pattern::Placement): the frame's origin and axes in part space, mm per unit, knots. */
export interface Placement {
  origin: V;
  axes: [V, V, V];
  mm: number;
  knots: PatternKnots;
}

/** The point's own space, in millimetres, without knots (a part-less host's: the cross test's, a node's sphere). */
export const IDENTITY_PLACEMENT: Placement = { origin: [0, 0, 0], axes: AXES, mm: 1, knots: { list: [], darkness: 0 } };

/** `x >>> 0` of an f32 constant (rt_core `seed_of`: ToUint32). */
const u32Of = (x: number) => (Number.isFinite(x) ? x >>> 0 : 0);

/** The recipe of pattern constants `c` from `k` (`kind` PATTERN_WOOD or PATTERN_CLOTH), null when it draws nothing (Pattern::recipe). */
export function recipeOf(kind: number, c: ArrayLike<number>, k: number): Recipe | null {
  const scale = c[k + 6];
  if (!(scale > 0 && Number.isFinite(scale))) return null;
  const v: number[] = [];
  for (let i = 0; i < 16; i++) {
    const x = c[k + 7 + i];
    v.push(Number.isFinite(x) ? fmax(x, 0) : 0);
  }
  const variant = u32Of(c[k + 23]);
  const seed = u32Of(c[k + 24]);
  const colorA: V = [c[k], c[k + 1], c[k + 2]];
  const colorB: V = [c[k + 3], c[k + 4], c[k + 5]];
  if (kind === PATTERN_WOOD) {
    const figure = (variant === 1 || variant === 2 || variant === 3 ? variant : 0) as WoodFigure;
    return {
      kind: 'WOOD',
      wood: { light: colorA, dark: colorB, ringMm: scale, ringVariation: v[0], ringNoise: v[1], axialNoise: v[2], colorNoise: v[3], contrast: v[4], poreMm: v[5], poreDepth: v[6], poreBand: fmin(v[7], 1), fibre: v[8], figure },
      anisotropy: fmin(v[9], 1),
      knots: {
        count: variant === 0 ? Math.round(fmin(Math.round(v[10]), PATTERN_MAX_KNOTS)) : 0,
        diameterMm: v[11],
        variation: fmin(v[12], 1),
        darkness: fmin(v[13], 1),
        seed,
      },
    };
  }
  if (kind === PATTERN_CLOTH) {
    const weave = (variant <= 6 ? variant : 0) as Weave;
    return { kind: 'CLOTH', cloth: { warp: colorA, weft: colorB, pitchMm: scale, relief: fmin(v[0], 1), twist: clamp(v[1], 0, 1), weave } };
  }
  return null;
}

/** What a pattern makes of a material at a point (rt_core::pattern::Sampled). */
export interface Sampled {
  baseColor: V;
  /** The multiplier of the roughness, and what is added after it. */
  roughness: number;
  roughnessAdd: number;
  anisotropy: number;
  /** Part space; null: none. */
  tangent: V | null;
  /** The relief's slope (part space), null without relief. */
  slope: V | null;
  height: number;
}

/** Frame::from_normal of rt_core (Duff et al. 2017): its x and y. */
function frameFromNormal(n: V): [V, V] {
  const sign = n[2] < 0 || Object.is(n[2], -0) ? -1 : 1;
  const a = div(-1, add(sign, n[2]));
  const b = mul(mul(n[0], n[1]), a);
  return [
    [add(1, mul(mul(mul(sign, n[0]), n[0]), a)), mul(sign, b), -mul(sign, n[0])],
    [b, add(sign, mul(mul(n[1], n[1]), a)), -n[1]],
  ];
}

function framePoint(at: Placement, p: V): V {
  const d = vsub(p, at.origin);
  return vscale([vdot(d, at.axes[0]), vdot(d, at.axes[1]), vdot(d, at.axes[2])], at.mm);
}

function projectionWeights(n: V): V {
  const w = [Math.abs(n[0]), Math.abs(n[1]), Math.abs(n[2])].map((v) => {
    const v2 = mul(v, v);
    const v4 = mul(v2, v2);
    return mul(v4, v4);
  }) as V;
  const total = add(add(w[0], w[1]), w[2]);
  return total > 0 ? (w.map((v) => div(v, total)) as V) : [0, 0, 1];
}

const PLANE_AXES: readonly [number, number][] = [
  [1, 2],
  [0, 2],
  [0, 1],
];
const WOOD_STEP_MM = k32(0.02);
const CLOTH_STEP = k32(0.05);
export const CLOTH_ANISOTROPY = 0.5;
const MIN_WEIGHT = k32(0.02);
const INV_WOOD_STEP = f(1 / WOOD_STEP_MM);

/** The pattern of `recipe` placed by `at` at `p` (part space), `ns` the shading normal, `smooth` the projection's (sample_at). */
export function sampleAt(recipe: Recipe, at: Placement, p: V, ns: V, smooth: V): Sampled {
  if (recipe.kind === 'WOOD') {
    const w = recipe.wood;
    const q = framePoint(at, p);
    const s = woodSample(w, q, at.knots);
    const rough = mul(add(1, mul(k32(0.08), sub(MEAN_DARK, s.dark))), sub(1, mul(s.height, 4)));
    const base = { baseColor: s.color, roughness: rough, roughnessAdd: s.roughAdd, anisotropy: recipe.anisotropy, tangent: recipe.anisotropy > 0 ? at.axes[2] : null };
    if (!woodHasRelief(w, at.knots)) return { ...base, slope: null, height: s.height };
    const [fx, fy] = frameFromNormal(ns);
    const step = div(WOOD_STEP_MM, at.mm);
    const h0 = s.height;
    const h1 = woodHeight(w, framePoint(at, vadd(p, vscale(fx, step))), s.ring, at.knots);
    const h2 = woodHeight(w, framePoint(at, vadd(p, vscale(fy, step))), s.ring, at.knots);
    const g = vadd(vscale(fx, mul(sub(h1, h0), INV_WOOD_STEP)), vscale(fy, mul(sub(h2, h0), INV_WOOD_STEP)));
    return { ...base, slope: g, height: h0 };
  }
  const c = recipe.cloth;
  const weights = projectionWeights(smooth);
  let color: V = [0, 0, 0];
  let rough = 0;
  let grad: V = [0, 0, 0];
  let total = 0;
  let height = 0;
  const d = vscale(vsub(p, at.origin), at.mm);
  const step = mul(CLOTH_STEP, c.pitchMm);
  let tangent: V | null = null;
  let heaviest = 0;
  for (let k = 0; k < 3; k++) {
    const w = weights[k];
    if (w < MIN_WEIGHT) continue;
    const [a, b] = PLANE_AXES[k];
    const u = d[a];
    const v = d[b];
    const s = clothSample(c, u, v);
    if (w > heaviest) {
      heaviest = w;
      tangent = s.alongV ? AXES[a] : AXES[b];
    }
    color = vadd(color, vscale(s.color, w));
    rough = add(rough, mul(s.roughness, w));
    height = add(height, mul(s.height, w));
    total = add(total, w);
    if (c.relief > 0) {
      const du = div(sub(clothHeight(c, add(u, step), v), s.height), step);
      const dv = div(sub(clothHeight(c, u, add(v, step)), s.height), step);
      grad = vadd(grad, vscale(vadd(vscale(AXES[a], du), vscale(AXES[b], dv)), w));
    }
  }
  const k = total > 0 ? div(1, total) : 1;
  const threads = c.weave !== 5;
  return {
    baseColor: vscale(color, k),
    roughness: mul(rough, k),
    roughnessAdd: 0,
    anisotropy: threads ? CLOTH_ANISOTROPY : 0,
    tangent: threads ? tangent : null,
    slope: c.relief > 0 ? vscale(grad, k) : null,
    height: mul(height, k),
  };
}

/** The shading normal `ns` tilted by the relief's slope `g` (rt_core::pattern::bump). */
export function bump(ns: V, g: V): V {
  const tangent = vsub(g, vscale(ns, vdot(ns, g)));
  return vnormalize(vsub(ns, tangent));
}

// --- Placements without a mesh --------------------------------------------------------------------

const MAX_PITH_MM = 250;
const ASIDE = f(k32(0.35) / k32(0.8));

/** rt_core `wood_frame` in f32: from a box (`min`, `size`) in part units of `mm` millimetres. */
export function woodPlacementFrame(min: V, size: V, mm: number): { origin: V; axes: [V, V, V] } {
  const s = size;
  const long = s[0] >= s[1] && s[0] >= s[2] ? 0 : s[1] >= s[2] ? 1 : 2;
  const o1 = (long + 1) % 3;
  const o2 = (long + 2) % 3;
  const [short, side] = s[o1] < s[o2] ? [o1, o2] : [o2, o1];
  const length = fmax(s[long], k32(1e-6));
  const offset = fmax(fmin(mul(k32(0.8), length), div(MAX_PITH_MM, fmax(mm, k32(1e-6)))), mul(0.75, s[short]));
  const centre = vadd(min, vscale(size, 0.5));
  const pith = vsub(vsub(centre, vscale(AXES[short], offset)), vscale(AXES[side], mul(ASIDE, offset)));
  return { origin: pith, axes: [AXES[side], AXES[short], AXES[long]] };
}

/** A knot rounded to f32 (from core/knots.ts, which places them in f64). */
export function f32Knot(k: { origin: readonly number[]; axis: readonly number[]; flow: readonly number[]; across: readonly number[]; middle: number; radius: number; crack?: number | null }): PatternKnot {
  const v3 = (a: readonly number[]): V => [f(a[0]), f(a[1]), f(a[2])];
  return { origin: v3(k.origin), axis: v3(k.axis), flow: v3(k.flow), across: v3(k.across), middle: f(k.middle), radius: f(k.radius), crack: k.crack === undefined || k.crack === null ? null : f(k.crack) };
}

/** For tests: the cross product as rt_core writes it. */
export const crossF32 = vcross;
