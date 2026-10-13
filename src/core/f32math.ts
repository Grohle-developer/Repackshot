// The engine's deterministic f32 elementary functions (engine/crates/rt-core/src/fmath.rs), emulated bit for bit:
// every operation is rounded to f32 with Math.fround, which gives exactly IEEE single precision for + - * / and
// sqrt of f32 operands (double precision has more than twice the bits). The same algorithms in the same order
// (Cody–Waite reduction and truncated Taylor series), so the preview's physical sky (core/sky.ts) computes the
// very numbers the engine does. Only what the sky needs.

export const f = Math.fround;

export const PI = f(Math.PI);
export const TAU = f(2 * Math.PI);
export const FRAC_PI_2 = f(Math.PI / 2);
export const FRAC_PI_4 = f(Math.PI / 4);
export const DEG_TO_RAD = f(PI / 180);
const LN_2 = f(Math.LN2);
const LOG2_E = f(Math.LOG2E);
const SQRT_2 = f(Math.SQRT2);
const PIO2_1 = f(1.5703125);
const PIO2_2 = f(4.837513e-4);
const PIO2_3 = f(7.54979e-8);
const TWO_OVER_PI = f(2 / PI);

const add = (a: number, b: number) => f(a + b);
const sub = (a: number, b: number) => f(a - b);
const mul = (a: number, b: number) => f(a * b);
const div = (a: number, b: number) => f(a / b);
/** f32 square root (correctly rounded, as the hardware's). */
export const sqrt = (x: number) => f(Math.sqrt(x));

/** `1 / d` as an f32 constant (Rust folds `1.0 / d` in f32). */
const inv = (d: number) => div(1, f(d));

function sinPoly(r: number): number {
  const r2 = mul(r, r);
  let p = inv(362_880);
  p = sub(mul(p, r2), inv(5_040));
  p = add(mul(p, r2), inv(120));
  p = sub(mul(p, r2), inv(6));
  return add(r, mul(mul(r, r2), p));
}

function cosPoly(r: number): number {
  const r2 = mul(r, r);
  let p = f(-inv(3_628_800));
  p = add(mul(p, r2), inv(40_320));
  p = sub(mul(p, r2), inv(720));
  p = add(mul(p, r2), inv(24));
  p = sub(mul(p, r2), 0.5);
  return add(1, mul(r2, p));
}

/** fmath::sin_cos. */
export function sinCos(x: number): [number, number] {
  x = f(x);
  if (!Number.isFinite(x)) return [0, 1];
  const k = Math.floor(add(mul(x, TWO_OVER_PI), 0.5));
  const r = sub(sub(sub(x, mul(k, PIO2_1)), mul(k, PIO2_2)), mul(k, PIO2_3));
  const s = sinPoly(r);
  const c = cosPoly(r);
  // Rust's `(k as i64) & 3`, two's complement for negative k.
  switch (((k % 4) + 4) % 4) {
    case 0:
      return [s, c];
    case 1:
      return [c, f(-s)];
    case 2:
      return [f(-s), f(-c)];
    default:
      return [f(-c), s];
  }
}

/** fmath::exp2. */
export function exp2(x: number): number {
  x = f(x);
  if (Number.isNaN(x)) return x;
  if (x >= 128) return Infinity;
  if (x < -150) return 0;
  const k = Math.floor(add(x, 0.5));
  const t = mul(sub(x, k), LN_2);
  let p = inv(5_040);
  p = add(mul(p, t), inv(720));
  p = add(mul(p, t), inv(120));
  p = add(mul(p, t), inv(24));
  p = add(mul(p, t), inv(6));
  p = add(mul(p, t), 0.5);
  p = add(mul(p, t), 1);
  p = add(mul(p, t), 1);
  // Rust's integer division truncates towards zero.
  const k1 = Math.trunc(k / 2);
  return mul(mul(p, 2 ** k1), 2 ** (k - k1));
}

const bits = new DataView(new ArrayBuffer(4));
const toBits = (x: number) => {
  bits.setFloat32(0, x, true);
  return bits.getUint32(0, true);
};
const fromBits = (u: number) => {
  bits.setUint32(0, u >>> 0, true);
  return bits.getFloat32(0, true);
};

/** fmath::log2. */
export function log2(x: number): number {
  x = f(x);
  if (Number.isNaN(x)) return x;
  if (x <= 0) return -Infinity;
  if (x === Infinity) return x;
  let e = 0;
  if (x < 1.1754943508222875e-38) {
    x = mul(x, 8_388_608);
    e = -23;
  }
  const b = toBits(x);
  e += ((b >>> 23) & 0xff) - 127;
  let m = fromBits((b & 0x007fffff) | 0x3f800000);
  if (m > SQRT_2) {
    m = mul(m, 0.5);
    e += 1;
  }
  const s = div(sub(m, 1), add(m, 1));
  const s2 = mul(s, s);
  let p = inv(11);
  p = add(mul(p, s2), inv(9));
  p = add(mul(p, s2), inv(7));
  p = add(mul(p, s2), inv(5));
  p = add(mul(p, s2), inv(3));
  const lnM = mul(2, add(s, mul(mul(s, s2), p)));
  return add(f(e), mul(lnM, LOG2_E));
}

/** fmath::exp. */
export const exp = (x: number) => exp2(mul(x, LOG2_E));

/** fmath::powf for x >= 0. */
export function powf(x: number, y: number): number {
  x = f(x);
  y = f(y);
  if (y === 0) return 1;
  if (x <= 0) return y > 0 ? 0 : Infinity;
  if (x === 1) return 1;
  return exp2(mul(y, log2(x)));
}

function atanPoly(u: number): number {
  const u2 = mul(u, u);
  let p = inv(17);
  for (const d of [15, 13, 11, 9, 7, 5, 3]) p = add(mul(f(-p), u2), inv(d));
  return sub(u, mul(mul(u, u2), p));
}

/** fmath::atan. */
export function atan(x: number): number {
  x = f(x);
  if (Number.isNaN(x)) return x;
  const a = Math.abs(x);
  const flip = a > 1;
  const t = flip ? div(1, a) : a;
  let r = t > f(0.41421357) ? add(FRAC_PI_4, atanPoly(div(sub(t, 1), add(t, 1)))) : atanPoly(t);
  if (flip) r = sub(FRAC_PI_2, r);
  return x < 0 ? f(-r) : r;
}

/** fmath::atan2. */
export function atan2(y: number, x: number): number {
  y = f(y);
  x = f(x);
  if (Number.isNaN(x) || Number.isNaN(y)) return NaN;
  if (x === 0) return y > 0 ? FRAC_PI_2 : y < 0 ? f(-FRAC_PI_2) : 0;
  if (Math.abs(y) <= Math.abs(x)) {
    const r = atan(div(y, x));
    if (!(x < 0)) return r;
    return y < 0 ? sub(r, PI) : add(r, PI);
  }
  return y > 0 ? sub(FRAC_PI_2, atan(div(x, y))) : sub(f(-FRAC_PI_2), atan(div(x, y)));
}

/** f32 vector helpers in the engine's order of operations (rt-core math.rs). */
export type V3 = [number, number, number];
export const dot = (a: V3, b: V3) => add(add(mul(a[0], b[0]), mul(a[1], b[1])), mul(a[2], b[2]));
export const cross = (a: V3, b: V3): V3 => [sub(mul(a[1], b[2]), mul(a[2], b[1])), sub(mul(a[2], b[0]), mul(a[0], b[2])), sub(mul(a[0], b[1]), mul(a[1], b[0]))];
export const minus = (a: V3, b: V3): V3 => [sub(a[0], b[0]), sub(a[1], b[1]), sub(a[2], b[2])];
export const length = (a: V3) => sqrt(dot(a, a));
export { add, sub, mul, div };
