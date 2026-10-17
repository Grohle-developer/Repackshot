// The custom time curve of a clip (phase N1, SPEC §3.7): a cubic Bézier from (0, 0) to (1, 1) with two handles,
// (x1, y1) and (x2, y2), the way a timing curve is drawn in animation tools and in CSS (`cubic-bezier`). The phase x
// of the clip is the curve's horizontal axis and the progress its vertical one: y at the point whose x is the phase.
// The handles' x stay in 0..1 so the curve never goes back in time; their y may leave 0..1 a little (an overshoot).
// Pure and deterministic: the same handles give the same numbers everywhere.

/** The two handles of a custom curve: x1, y1, x2, y2. */
export type CurveHandles = readonly [number, number, number, number];

/** The handles a new custom curve starts with: a smooth start and stop (the classic ease-in-out). */
export const DEFAULT_CURVE: CurveHandles = [0.42, 0, 0.58, 1];

/** How far a handle's y may go past 0 and 1 (an overshoot, or a pull-back before it starts). */
export const CURVE_Y_MIN = -0.25;
export const CURVE_Y_MAX = 1.25;

const finite = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** Handles from anything (a saved clip, a field being typed): x within 0..1, y within the overshoot range. */
export function normaliseCurve(raw: unknown): CurveHandles {
  const a = Array.isArray(raw) ? raw : [];
  return [
    clamp(finite(a[0], DEFAULT_CURVE[0]), 0, 1),
    clamp(finite(a[1], DEFAULT_CURVE[1]), CURVE_Y_MIN, CURVE_Y_MAX),
    clamp(finite(a[2], DEFAULT_CURVE[2]), 0, 1),
    clamp(finite(a[3], DEFAULT_CURVE[3]), CURVE_Y_MIN, CURVE_Y_MAX),
  ];
}

/** One coordinate of the Bézier at parameter s, with control values a (first handle) and b (second). */
function bez(s: number, a: number, b: number): number {
  const u = 1 - s;
  return 3 * u * u * s * a + 3 * u * s * s * b + s * s * s;
}

/** Its derivative in s. */
function bezSlope(s: number, a: number, b: number): number {
  const u = 1 - s;
  return 3 * u * u * a + 6 * u * s * (b - a) + 3 * s * s * (1 - b);
}

/**
 * The progress of a custom curve at phase x (0..1): the y of the curve's point whose x is the phase. 0 before, 1
 * after. The parameter is found by Newton's method from x, and by bisection where the slope is too flat for it
 * (x of the curve is monotonic: its handles' x are within 0..1), to 1e-9 in x.
 */
export function bezierEase(x: number, handles: CurveHandles): number {
  if (!(x > 0)) return 0;
  if (x >= 1) return 1;
  const [x1, y1, x2, y2] = normaliseCurve(handles);
  // Newton's method from the phase itself (where a curve with its handles on the diagonal is exact).
  let s = x;
  for (let i = 0; i < 8; i++) {
    const err = bez(s, x1, x2) - x;
    if (Math.abs(err) < 1e-12) return bez(s, y1, y2);
    const d = bezSlope(s, x1, x2);
    if (Math.abs(d) < 1e-6) break;
    s -= err / d;
    if (s < 0 || s > 1) break;
  }
  // Where the curve's x is flat (a handle at the far end) Newton's steps are unsafe: bisection, to the last bit.
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 64 && hi - lo > 1e-15; i++) {
    const mid = (lo + hi) / 2;
    if (bez(mid, x1, x2) < x) lo = mid;
    else hi = mid;
  }
  return bez((lo + hi) / 2, y1, y2);
}
