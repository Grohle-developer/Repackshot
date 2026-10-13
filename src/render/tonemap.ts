// Exposure, tone curves and sRGB encoding, exactly as the engine does them
// (engine/crates/rt-core/src/color.rs, `Film::to_srgb8_tonemapped` in
// image.rs), so pixels the browser converts equal the pixels `rt` writes.
//
// The engine evaluates its curves with its own deterministic maths (fmath.rs:
// exp2, log2 and pow from + - * / and sqrt, in a fixed order, in f32). This is
// a port operation for operation: every intermediate goes through
// Math.fround, which rounds a double to the nearest f32. For + - * / of two
// f32 values that is the correctly rounded f32 result (a double has more than
// 2 x 24 + 2 bits), so the bits are the engine's. tests/tonemap.test.ts
// compares against values printed by `rt --tone-table`.
//
// `exact*` is for the final image (Render). The viewport converts many more
// pixels per second, so `DisplayCurve` precomputes, for an exposure and a
// curve, the 255 thresholds of the 8-bit output (a curve composed with the
// encoding is monotonic): a pixel is then a binary search per channel. AgX
// mixes channels, so its log-space S-curve comes from a table there.

const f = Math.fround;

const F32 = new Float32Array(1);
const U32 = new Uint32Array(F32.buffer);
function bitsOf(x: number): number {
  F32[0] = x;
  return U32[0];
}
function fromBits(b: number): number {
  U32[0] = b >>> 0;
  return F32[0];
}

// std::f32::consts, as f32.
const LN_2 = f(Math.LN2);
const LOG2_E = f(Math.LOG2E);
const SQRT_2 = f(Math.SQRT2);
const MIN_POSITIVE = 1.1754943508222875e-38;

/** f32::clamp: NaN stays NaN. */
function clampF(x: number, lo: number, hi: number): number {
  let v = x;
  if (v < lo) v = lo;
  if (v > hi) v = hi;
  return v;
}

/** f32::max(x, y) with a non-NaN `y`: NaN gives `y`. */
function maxF(x: number, y: number): number {
  return x > y || Number.isNaN(y) ? x : Number.isNaN(x) ? y : Math.max(x, y);
}

/** 2^n for an integer n in [-126, 127], from its bits. */
function pow2i(n: number): number {
  return fromBits(((n + 127) << 23) >>> 0);
}

const E1 = f(1 / 5040);
const E2 = f(1 / 720);
const E3 = f(1 / 120);
const E4 = f(1 / 24);
const E5 = f(1 / 6);

/** fmath::exp2. */
export function exp2f(x: number): number {
  if (Number.isNaN(x)) return x;
  if (x >= 128) return Infinity;
  if (x < -150) return 0;
  const k = Math.floor(f(x + 0.5));
  const t = f(f(x - k) * LN_2);
  let p = E1;
  p = f(f(p * t) + E2);
  p = f(f(p * t) + E3);
  p = f(f(p * t) + E4);
  p = f(f(p * t) + E5);
  p = f(f(p * t) + 0.5);
  p = f(f(p * t) + 1);
  p = f(f(p * t) + 1);
  const ki = k | 0;
  const k1 = Math.trunc(ki / 2);
  return f(f(p * pow2i(k1)) * pow2i(ki - k1));
}

const L1 = f(1 / 11);
const L2 = f(1 / 9);
const L3 = f(1 / 7);
const L4 = f(1 / 5);
const L5 = f(1 / 3);

/** fmath::log2. */
export function log2f(x0: number): number {
  let x = x0;
  if (Number.isNaN(x)) return x;
  if (x <= 0) return -Infinity;
  if (x === Infinity) return x;
  let e = 0;
  if (x < MIN_POSITIVE) {
    x = f(x * 8388608);
    e = -23;
  }
  const bits = bitsOf(x);
  e += ((bits >>> 23) & 0xff) - 127;
  let m = fromBits((bits & 0x007fffff) | 0x3f800000);
  if (m > SQRT_2) {
    m = f(m * 0.5);
    e += 1;
  }
  const s = f(f(m - 1) / f(m + 1));
  const s2 = f(s * s);
  let p = L1;
  p = f(f(p * s2) + L2);
  p = f(f(p * s2) + L3);
  p = f(f(p * s2) + L4);
  p = f(f(p * s2) + L5);
  const lnm = f(2 * f(s + f(f(s * s2) * p)));
  return f(e + f(lnm * LOG2_E));
}

/** fmath::powf (x >= 0). */
export function powf(x: number, y: number): number {
  if (y === 0) return 1;
  if (x <= 0) return y > 0 ? 0 : Infinity;
  if (x === 1) return 1;
  return exp2f(f(y * log2f(x)));
}

/** color::exposure: 2^ev. */
export function exposureGain(ev: number): number {
  return exp2f(f(ev));
}

const SRGB_CUT = f(0.0031308);
const SRGB_LIN = f(12.92);
const SRGB_A = f(1.055);
const SRGB_B = f(0.055);
const INV_2_4 = f(1 / f(2.4));

/** color::srgb_encode. */
export function srgbEncode(linear: number): number {
  const l = clampF(linear, 0, 1);
  if (l <= SRGB_CUT) return f(l * SRGB_LIN);
  return f(f(SRGB_A * powf(l, INV_2_4)) - SRGB_B);
}

const A1 = f(2.51);
const A2 = f(0.03);
const A3 = f(2.43);
const A4 = f(0.59);
const A5 = f(0.14);

/** color::aces_tonemap, one channel. */
export function aces(x0: number): number {
  const x = maxF(x0, 0);
  const num = f(x * f(f(A1 * x) + A2));
  const den = f(f(x * f(f(A3 * x) + A4)) + A5);
  return clampF(f(num / den), 0, 1);
}

export const SHAPER_MIN_EV = f(-12.473931);
export const SHAPER_MAX_EV = f(4.026069);
const SHAPER_RANGE = f(SHAPER_MAX_EV - SHAPER_MIN_EV);
const SHAPER_FLOOR = f(1e-10);

function logShaper(x: number): number {
  const ev = log2f(maxF(x, SHAPER_FLOOR));
  return clampF(f(f(ev - SHAPER_MIN_EV) / SHAPER_RANGE), 0, 1);
}

const B1 = f(15.5);
const B2 = f(40.14);
const B3 = f(31.96);
const B4 = f(6.868);
const B5 = f(0.4298);
const B6 = f(0.1191);
const B7 = f(0.00232);

/** color::base_contrast. */
export function baseContrast(x: number): number {
  const x2 = f(x * x);
  const x4 = f(x2 * x2);
  const a = f(f(B1 * x4) * x2);
  const b = f(f(B2 * x4) * x);
  const c = f(B3 * x4);
  const d = f(f(B4 * x2) * x);
  const e = f(B5 * x2);
  const g = f(B6 * x);
  return f(f(f(f(f(f(a - b) + c) - d) + e) + g) - B7);
}

const DECODE_GAMMA = f(2.2);

function displayDecode(y: number): number {
  return powf(clampF(y, 0, 1), DECODE_GAMMA);
}

/** color::filmic_tonemap, one channel. */
export function filmic(v: number): number {
  return displayDecode(baseContrast(logShaper(v)));
}

type M3 = readonly (readonly number[])[];

const AGX_INSET: M3 = [
  [f(0.84247906), f(0.0784336), f(0.079223745)],
  [f(0.042328242), f(0.8784686), f(0.07916613)],
  [f(0.042375655), f(0.0784336), f(0.879143)],
];

/** color::invert3, in f32 like Rust's const evaluation. */
function invert3(m: M3): M3 {
  const c00 = f(f(m[1][1] * m[2][2]) - f(m[1][2] * m[2][1]));
  const c01 = f(f(m[1][2] * m[2][0]) - f(m[1][0] * m[2][2]));
  const c02 = f(f(m[1][0] * m[2][1]) - f(m[1][1] * m[2][0]));
  const det = f(f(f(m[0][0] * c00) + f(m[0][1] * c01)) + f(m[0][2] * c02));
  const inv = f(1 / det);
  return [
    [f(c00 * inv), f(f(f(m[0][2] * m[2][1]) - f(m[0][1] * m[2][2])) * inv), f(f(f(m[0][1] * m[1][2]) - f(m[0][2] * m[1][1])) * inv)],
    [f(c01 * inv), f(f(f(m[0][0] * m[2][2]) - f(m[0][2] * m[2][0])) * inv), f(f(f(m[0][2] * m[1][0]) - f(m[0][0] * m[1][2])) * inv)],
    [f(c02 * inv), f(f(f(m[0][1] * m[2][0]) - f(m[0][0] * m[2][1])) * inv), f(f(f(m[0][0] * m[1][1]) - f(m[0][1] * m[1][0])) * inv)],
  ];
}

const AGX_OUTSET = invert3(AGX_INSET);

function mul3(m: M3, r: number, g: number, b: number, out: number[]): void {
  out[0] = f(f(f(m[0][0] * r) + f(m[0][1] * g)) + f(m[0][2] * b));
  out[1] = f(f(f(m[1][0] * r) + f(m[1][1] * g)) + f(m[1][2] * b));
  out[2] = f(f(f(m[2][0] * r) + f(m[2][1] * g)) + f(m[2][2] * b));
}

/** color::agx_tonemap (writes into `out`). */
export function agx(r: number, g: number, b: number, out: number[] = [0, 0, 0]): number[] {
  const inset = [0, 0, 0];
  mul3(AGX_INSET, maxF(r, 0), maxF(g, 0), maxF(b, 0), inset);
  const c0 = baseContrast(logShaper(inset[0]));
  const c1 = baseContrast(logShaper(inset[1]));
  const c2 = baseContrast(logShaper(inset[2]));
  mul3(AGX_OUTSET, c0, c1, c2, out);
  out[0] = displayDecode(out[0]);
  out[1] = displayDecode(out[1]);
  out[2] = displayDecode(out[2]);
  return out;
}

/** `RNDR.tonemap` values (color::Tonemap). */
export type ToneCurve = 0 | 1 | 2 | 3 | 4;

/** Tonemap::from_u32: unknown values mean ACES. */
export function toneCurve(value: number): ToneCurve {
  return value === 0 || value === 2 || value === 3 || value === 4 ? value : 1;
}

/** Tonemap::apply on one pixel (display-linear result, written into `out`). */
export function applyCurve(curve: ToneCurve, r: number, g: number, b: number, out: number[] = [0, 0, 0]): number[] {
  switch (curve) {
    case 0:
      out[0] = r;
      out[1] = g;
      out[2] = b;
      return out;
    case 1:
      out[0] = aces(r);
      out[1] = aces(g);
      out[2] = aces(b);
      return out;
    case 2:
      out[0] = filmic(r);
      out[1] = filmic(g);
      out[2] = filmic(b);
      return out;
    case 3:
      return agx(r, g, b, out);
    default:
      out[0] = clampF(r, 0, 1);
      out[1] = clampF(g, 0, 1);
      out[2] = clampF(b, 0, 1);
      return out;
  }
}

/** `(srgb_encode(v) * 255.0 + 0.5) as u8`. */
export function toByte(display: number): number {
  const v = f(f(srgbEncode(display) * 255) + 0.5);
  if (!(v > 0)) return 0;
  return v >= 255 ? 255 : Math.floor(v);
}

/**
 * Film::to_srgb8_tonemapped for one resolved pixel (linear radiance `r g b`, already f32): the
 * exposure gain, the curve, the encoding. Writes three bytes at `out[at]`.
 */
export function exactPixel(r: number, g: number, b: number, gain: number, curve: ToneCurve, out: Uint8Array | Uint8ClampedArray, at: number, tmp: number[] = [0, 0, 0]): void {
  applyCurve(curve, f(r * gain), f(g * gain), f(b * gain), tmp);
  out[at] = toByte(tmp[0]);
  out[at + 1] = toByte(tmp[1]);
  out[at + 2] = toByte(tmp[2]);
}

// ------------------------------------------------------------------ fast path for the viewport

/**
 * Largest input the thresholds look at. Above about 1e19 the engine's ACES overflows f32 into NaN
 * (a black pixel); a radiance that size is no image, and anything above this goes the exact way.
 */
const SEARCH_TOP = f(1e18);
const SEARCH_TOP_BITS = bitsOf(SEARCH_TOP);
/** Buckets of the bucket table: the top 18 bits of a non-negative f32 (exponent and 9 mantissa bits). */
const BUCKET_SHIFT = 14;
const BUCKETS = (SEARCH_TOP_BITS >>> BUCKET_SHIFT) + 1;
/**
 * Inputs this many ulps or fewer from a threshold take the exact path. The engine's f32 maths
 * wiggles by a few ulps of the output; where a curve is flat that is a wider range of inputs: up
 * to about 1600 ulps in filmic's highlights, 0 in ACES (measured in tests/tonemap.test.ts). The
 * band keeps the fast path cheap (a few per cent of the channels go the exact way), so a
 * wider wiggle can still leave a viewport pixel one level off; Render converts exactly.
 */
export const GUARD_ULPS = 2048;

/** The 255 sorted thresholds of an f32 -> byte map: t[k - 1] is a least v >= 0 giving >= k. */
function thresholds(byteOf: (v: number) => number): Float32Array {
  const t = new Float32Array(255);
  for (let k = 1; k <= 255; k++) {
    // Bisection over the bit patterns of the non-negative f32 (ordered like integers).
    let lo = 0;
    let hi = SEARCH_TOP_BITS;
    if (byteOf(fromBits(hi)) < k) {
      t[k - 1] = Infinity;
      continue;
    }
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (byteOf(fromBits(mid)) >= k) hi = mid;
      else lo = mid + 1;
    }
    t[k - 1] = Math.max(fromBits(lo), k > 1 ? t[k - 2] : 0);
  }
  return t;
}

const AGX_LUT_SIZE = 4096;

/** One channel's map from an f32 to a byte: thresholds, a bucket table, the exact function. */
class ByteMap {
  private readonly t: Float32Array;
  private readonly tb = new Uint32Array(255);
  private readonly lut = new Uint8Array(BUCKETS);
  private readonly zero: number;

  constructor(private readonly exact: (v: number) => number) {
    this.t = thresholds(exact);
    for (let k = 0; k < 255; k++) this.tb[k] = Number.isFinite(this.t[k]) ? bitsOf(this.t[k]) : 0xffffffff;
    // Byte at the start of each bucket: the thresholds at or below it.
    let k = 0;
    for (let i = 0; i < BUCKETS; i++) {
      const start = fromBits(i << BUCKET_SHIFT);
      while (k < 255 && this.t[k] <= start) k++;
      this.lut[i] = k;
    }
    this.zero = exact(0);
  }

  byte(v: number): number {
    if (!(v > 0)) return v === 0 || v < 0 ? this.zero : this.exact(v);
    F32[0] = v;
    const bits = U32[0];
    if (bits >= SEARCH_TOP_BITS) return this.exact(v);
    let b = this.lut[bits >>> BUCKET_SHIFT];
    while (b < 255 && bits >= this.tb[b]) b++;
    if ((b > 0 && bits - this.tb[b - 1] <= GUARD_ULPS) || (b < 255 && this.tb[b] - bits <= GUARD_ULPS)) return this.exact(v);
    return b;
  }
}

/**
 * Fast conversion for the viewport at one exposure and curve. For the per-channel curves (linear,
 * ACES, filmic, standard) a channel is a table lookup; within `GUARD_ULPS` of a level boundary it
 * is computed the exact way, so it equals the exact byte but where the f32 curve wiggles wider
 * than that (then by one level). AgX mixes channels; its log-space S-curve comes
 * from a 4096-entry table over the shaper's range, so it can differ from the exact path by one
 * level now and then (Render converts with `exactPixel`).
 */
export class DisplayCurve {
  readonly ev: number;
  readonly curve: ToneCurve;
  private readonly gain: number;
  private readonly map: ByteMap;
  private readonly lut: Float32Array | null = null;

  constructor(ev: number, curve: number) {
    this.ev = ev;
    this.curve = toneCurve(curve);
    this.gain = exposureGain(ev);
    const gain = this.gain;
    const tmp = [0, 0, 0];
    if (this.curve === 3) {
      // Thresholds on the outset value z: byte(srgb(decode(z))).
      this.map = new ByteMap((z) => toByte(displayDecode(f(z))));
      const lut = new Float32Array(AGX_LUT_SIZE + 1);
      for (let i = 0; i <= AGX_LUT_SIZE; i++) lut[i] = baseContrast(f(i / AGX_LUT_SIZE));
      this.lut = lut;
    } else {
      const c = this.curve;
      this.map = new ByteMap((v) => {
        const x = f(v * gain);
        applyCurve(c, x, x, x, tmp);
        return toByte(tmp[0]);
      });
    }
  }

  /** The AgX S-curve of one inset channel, from the table. */
  private agxCurve(v: number): number {
    const x = ((Math.log2(Math.max(v, 1e-10)) - SHAPER_MIN_EV) / (SHAPER_MAX_EV - SHAPER_MIN_EV)) * AGX_LUT_SIZE;
    const lut = this.lut!;
    if (!(x > 0)) return lut[0];
    if (x >= AGX_LUT_SIZE) return lut[AGX_LUT_SIZE];
    const i = Math.floor(x);
    const w = x - i;
    return lut[i] * (1 - w) + lut[i + 1] * w;
  }

  /** Converts one pixel of linear radiance (straight, not premultiplied) to bytes at `out[at]`. */
  pixel(r: number, g: number, b: number, out: Uint8Array | Uint8ClampedArray, at: number): void {
    const map = this.map;
    if (this.curve !== 3) {
      out[at] = map.byte(f(r));
      out[at + 1] = map.byte(f(g));
      out[at + 2] = map.byte(f(b));
      return;
    }
    const k = this.gain;
    const R = Math.max(0, r * k);
    const G = Math.max(0, g * k);
    const B = Math.max(0, b * k);
    const m = AGX_INSET;
    const c0 = this.agxCurve(m[0][0] * R + m[0][1] * G + m[0][2] * B);
    const c1 = this.agxCurve(m[1][0] * R + m[1][1] * G + m[1][2] * B);
    const c2 = this.agxCurve(m[2][0] * R + m[2][1] * G + m[2][2] * B);
    const o = AGX_OUTSET;
    out[at] = map.byte(f(o[0][0] * c0 + o[0][1] * c1 + o[0][2] * c2));
    out[at + 1] = map.byte(f(o[1][0] * c0 + o[1][1] * c1 + o[1][2] * c2));
    out[at + 2] = map.byte(f(o[2][0] * c0 + o[2][1] * c1 + o[2][2] * c2));
  }

  /** The exact byte of one channel of a per-channel curve (tests). */
  channelExact(v: number): number {
    return toByte(applyCurve(this.curve, f(v * this.gain), 0, 0)[0]);
  }

  /** The thresholds (tests). */
  get levels(): Float32Array {
    return thresholds((v) => this.channelExact(v));
  }
}
