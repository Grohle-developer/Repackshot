// The daylight sky of the environment kind SKY, for the preview: the same models, scale and layout as the
// engine's (engine/crates/rt-core/src/sky.rs and environment.rs `sky_image`), so the Fast viewport shows the
// sky Full renders.
//
// * PHYSICAL (E5c, the default): the functional form of L. Hošek and A. Wilkie, "An Analytic Model for Full
//   Spectral Sky-Dome Radiance", ACM TOG 31(4), 2012, with our own coefficients (core/sky-table.ts, fitted by
//   engine/crates/rt-sky to our own atmosphere simulation): per channel F(θ, γ) · L_M with
//   F = (1 + A e^(B / (cos θ + 0.01))) (C + D e^(E γ) + F cos² γ + G χ(H, γ) + I √cos θ), every coefficient a
//   quintic Bézier over (elevation / 90°)^(1/3), the radiances blended linearly between integer turbidities and
//   ground albedos 0 and 1 (albedo GROUND_ALBEDO). Computed in the engine's own f32 arithmetic (core/f32math.ts
//   emulates rt-core's fmath bit for bit), because the first factor cancels near the zenith (A ≈ -1) and double
//   precision would differ from the engine's f32 by more than 1e-6 there: tests/sky-physical.test.ts checks the
//   tabulated image against tests/fixtures/sky-physical.json, written by the engine.
// * CLASSIC (E5): A. J. Preetham, P. Shirley and B. Smits, "A Practical Analytic Model for Daylight",
//   SIGGRAPH 1999 (Perez distribution, coefficients of Appendix A.2).
//
// Both are scaled so that a horizontal surface gets the irradiance of the studio dome with the same values,
// over a neutral ground of `floor · strength` below the horizon. Equirectangular in the engine's convention
// (rt-core environment.rs, which is three.js's layout): column u = ½ + atan2(-y, x) / 2π, row v = acos(z) / π
// from the top (tests/environment-e5.test.ts pins the classic one to the engine, pixel for pixel).

import * as fm from './f32math';
import { add, div, f, mul, sub } from './f32math';
import { SKY_COEFFICIENTS, SKY_RADIANCE } from './sky-table';

/** Columns and rows of the tabulated sky (as the engine's SKY_WIDTH, SKY_HEIGHT). */
export const SKY_WIDTH = 256;
export const SKY_HEIGHT = 128;
/** Ground albedo of the physical sky (the engine's GROUND_ALBEDO). */
export const GROUND_ALBEDO = 0.2;

/** The sky's daylight model (EnvironmentState.skyModel; RSB ENVR.sky_model 0 and 1). */
export type SkyModel = 'PHYSICAL' | 'CLASSIC';

const PARAMS = 9;
const CONTROL = 6;

/** The six quintic Bernstein polynomials at x, in f32 as the engine's `bernstein`. */
function bernstein(x: number): number[] {
  const y = sub(1, x);
  const x2 = mul(x, x);
  const y2 = mul(y, y);
  const x3 = mul(x2, x);
  const y3 = mul(y2, y);
  return [mul(y3, y2), mul(mul(mul(5, x), y2), y2), mul(mul(10, x2), y3), mul(mul(10, x3), y2), mul(mul(mul(5, x2), x2), y), mul(x3, x2)];
}

/** `e^x` with the argument kept in [-80, 80], in f32 (the engine's sky.rs `exp`). */
const exp32 = (x: number) => fm.exp(Math.max(-80, Math.min(80, x)));

/**
 * The physical sky for a sun at azimuth / elevation in degrees (azimuth from +X towards +Y, Z up), a turbidity
 * (1 to 10) and a ground albedo (0 to 1), unscaled: the engine's PhysicalSky, in its f32 arithmetic (core/f32math.ts),
 * so the values are the engine's to the last bit. Directions are taken as f32 vectors.
 */
export function physicalSky(azimuthDeg: number, elevationDeg: number, turbidity: number, albedo = GROUND_ALBEDO): (dir: readonly number[]) => [number, number, number] {
  const t = Number.isFinite(turbidity) ? Math.min(10, Math.max(1, f(turbidity))) : 3;
  const el = Number.isFinite(elevationDeg) ? Math.min(90, Math.max(0, f(elevationDeg))) : 45;
  const az = Number.isFinite(azimuthDeg) ? f(azimuthDeg) : 0;
  const a = Number.isFinite(albedo) ? Math.min(1, Math.max(0, f(albedo))) : f(GROUND_ALBEDO);
  const [se, ce] = fm.sinCos(mul(el, fm.DEG_TO_RAD));
  const [sa, ca] = fm.sinCos(mul(az, fm.DEG_TO_RAD));
  const sun: fm.V3 = [mul(ce, ca), mul(ce, sa), se];
  const b = bernstein(fm.powf(div(el, 90), div(1, 3)));
  const tt = sub(t, 1);
  const i = Math.min(8, Math.floor(tt));
  const frac = sub(tt, i);
  const knots: { weight: number; coefficients: number[][]; radiance: number[] }[] = [];
  for (const [ti, wt] of [[i, sub(1, frac)], [i + 1, frac]]) {
    for (const [ai, wa] of [[0, sub(1, a)], [1, a]]) {
      const weight = mul(wt, wa);
      if (weight <= 0) continue;
      const coefficients = [0, 1, 2].map(() => new Array<number>(PARAMS).fill(0));
      const radiance = [0, 0, 0];
      for (let c = 0; c < 3; c++) {
        const base = (ti * 2 + ai) * 3 + c;
        for (let k = 0; k < CONTROL; k++) {
          for (let j = 0; j < PARAMS; j++) coefficients[c][j] = add(coefficients[c][j], mul(b[k], SKY_COEFFICIENTS[(base * CONTROL + k) * PARAMS + j]));
          radiance[c] = add(radiance[c], mul(b[k], SKY_RADIANCE[base * CONTROL + k]));
        }
      }
      knots.push({ weight, coefficients, radiance });
    }
  }
  return (dIn) => {
    const d: fm.V3 = [f(dIn[0]), f(dIn[1]), f(dIn[2])];
    if (d[2] <= 0) return [0, 0, 0];
    const ct = d[2];
    const dot = fm.dot(d, sun);
    const cg = Math.max(-1, Math.min(1, dot));
    const gamma = fm.atan2(fm.length(fm.cross(d, sun)), dot);
    const chord = fm.minus(d, sun);
    const chord2 = fm.dot(chord, chord);
    const cg2 = mul(cg, cg);
    const horizon = div(1, add(ct, f(0.01)));
    const sq = fm.sqrt(ct);
    const out: [number, number, number] = [0, 0, 0];
    for (const k of knots) {
      for (let c = 0; c < 3; c++) {
        const [A, B, C, D, E, F, G, H, I] = k.coefficients[c];
        const oneMinusH = sub(1, H);
        const den = add(mul(oneMinusH, oneMinusH), mul(H, chord2));
        const chi = div(add(1, cg2), mul(den, fm.sqrt(den)));
        const first = add(1, mul(A, exp32(mul(B, horizon))));
        const second = add(add(add(add(C, mul(D, exp32(mul(E, gamma)))), mul(F, cg2)), mul(G, chi)), mul(I, sq));
        out[c] = add(out[c], mul(mul(k.weight, mul(first, second)), k.radiance[c]));
      }
    }
    return [Math.max(0, out[0]), Math.max(0, out[1]), Math.max(0, out[2])];
  };
}

/** The engine's `uv_to_direction` (environment.rs) of the centre of texel (x, y) of a `w x h` panorama, in f32, and sin θ. */
function texelDirection32(x: number, y: number, w: number, h: number): [fm.V3, number] {
  const u = div(add(x, 0.5), w);
  const v = div(add(y, 0.5), h);
  const [st, ct] = fm.sinCos(mul(fm.PI, v));
  const [sp, cp] = fm.sinCos(mul(fm.TAU, sub(u, 0.5)));
  return [[mul(st, cp), f(-mul(st, sp)), ct], st];
}

/** Neumaier's compensated `sum += x` in f32 (environment.rs `add_compensated`): [sum, compensation]. */
function addCompensated(acc: [number, number], x: number): void {
  const t = add(acc[0], x);
  if (Math.abs(acc[0]) >= Math.abs(x)) acc[1] = add(acc[1], add(sub(acc[0], t), x));
  else acc[1] = add(acc[1], add(sub(x, t), acc[0]));
  acc[0] = t;
}

/** The physical sky tabulated and scaled exactly as the engine's `sky_image` does it (f32, compensated sums). */
function physicalSkyImage(p: SkyParams): Float32Array {
  const sky = physicalSky(p.sunAzimuthDeg, p.sunElevationDeg, p.turbidity);
  const w = SKY_WIDTH;
  const h = SKY_HEIGHT;
  const rgb = new Float32Array(3 * w * h);
  const cell = mul(div(fm.PI, h), div(fm.TAU, w));
  const total: [number, number] = [0, 0];
  for (let y = 0; y < h / 2; y++) {
    const row: [number, number] = [0, 0];
    for (let x = 0; x < w; x++) {
      const [d, st] = texelDirection32(x, y, w, h);
      const c = sky(d);
      rgb.set(c, 3 * (y * w + x));
      const lum = add(add(mul(f(0.2126), c[0]), mul(f(0.7152), c[1])), mul(f(0.0722), c[2]));
      addCompensated(row, mul(mul(lum, d[2]), st));
    }
    addCompensated(total, mul(add(row[0], row[1]), cell));
  }
  const irradiance = add(total[0], total[1]);
  const strength = Math.max(0, f(p.strength));
  const target = mul(mul(strength, fm.TAU), add(div(Math.max(0, f(p.horizon)), 6), div(Math.max(0, f(p.zenith)), 3)));
  const scale = irradiance > 0 ? div(target, irradiance) : 0;
  const ground = Math.max(0, mul(f(p.floor), strength));
  for (let i = 0; i < rgb.length; i++) rgb[i] = Math.floor(i / (3 * w)) < h / 2 ? mul(rgb[i], scale) : ground;
  return rgb;
}

const PEREZ: readonly (readonly [number, number])[][] = [
  [[0.1787, -1.463], [-0.3554, 0.4275], [-0.0227, 5.3251], [0.1206, -2.5771], [-0.067, 0.3703]],
  [[-0.0193, -0.2592], [-0.0665, 0.0008], [-0.0004, 0.2125], [-0.0641, -0.8989], [-0.0033, 0.0452]],
  [[-0.0167, -0.2608], [-0.095, 0.0092], [-0.0079, 0.2102], [-0.0441, -1.6537], [-0.0109, 0.0529]],
];
const ZENITH_X = [
  [0.00166, -0.00375, 0.00209, 0],
  [-0.02903, 0.06377, -0.03202, 0.00394],
  [0.11693, -0.21196, 0.06052, 0.25886],
];
const ZENITH_Y = [
  [0.00275, -0.0061, 0.00317, 0],
  [-0.04214, 0.0897, -0.04153, 0.00516],
  [0.15346, -0.26756, 0.0667, 0.26688],
];

const clampExp = (x: number) => Math.exp(Math.max(-80, Math.min(80, x)));

function perez(c: readonly number[], cosTheta: number, gamma: number, cosGamma: number): number {
  return (1 + c[0] * clampExp(c[1] / cosTheta)) * (1 + c[2] * clampExp(c[3] * gamma) + c[4] * cosGamma * cosGamma);
}

/** CIE xyY to linear Rec. 709 RGB, negatives clamped. */
export function xyyToRgb(x: number, y: number, lum: number): [number, number, number] {
  const X = (x / y) * lum;
  const Z = ((1 - x - y) / y) * lum;
  return [
    Math.max(0, 3.2404542 * X - 1.5371385 * lum - 0.4985314 * Z),
    Math.max(0, -0.969266 * X + 1.8760108 * lum + 0.041556 * Z),
    Math.max(0, 0.0556434 * X - 0.2040259 * lum + 1.0572252 * Z),
  ];
}

/** The sky for a sun at azimuth / elevation in degrees (azimuth from +X towards +Y, Z up) and a turbidity, unscaled. */
export function preetham(azimuthDeg: number, elevationDeg: number, turbidity: number): (dir: readonly number[]) => [number, number, number] {
  const t = Number.isFinite(turbidity) ? Math.min(10, Math.max(1.7, turbidity)) : 3;
  const el = Number.isFinite(elevationDeg) ? Math.min(90, Math.max(1, elevationDeg)) : 45;
  const az = Number.isFinite(azimuthDeg) ? azimuthDeg : 0;
  const rad = Math.PI / 180;
  const sun = [Math.cos(el * rad) * Math.cos(az * rad), Math.cos(el * rad) * Math.sin(az * rad), Math.sin(el * rad)];
  const thetaS = (90 - el) * rad;
  const coef = PEREZ.map((row) => row.map(([a, b]) => a * t + b));
  const chi = (4 / 9 - t / 120) * (Math.PI - 2 * thetaS);
  const yz = (4.0453 * t - 4.971) * Math.tan(chi) - 0.2155 * t + 2.4192;
  const th = [thetaS ** 3, thetaS ** 2, thetaS, 1];
  const poly = (m: number[][]) => [t * t, t, 1].reduce((s, tt, i) => s + tt * m[i].reduce((r, c, j) => r + c * th[j], 0), 0);
  const zenith = [Math.max(1e-3, yz), poly(ZENITH_X), poly(ZENITH_Y)];
  const ratio = zenith.map((z, q) => z / perez(coef[q], 1, thetaS, Math.cos(thetaS)));
  return (d) => {
    if (d[2] <= 0) return [0, 0, 0];
    const cg = Math.max(-1, Math.min(1, d[0] * sun[0] + d[1] * sun[1] + d[2] * sun[2]));
    const g = Math.acos(cg);
    const ct = Math.max(1e-3, d[2]);
    const v = ratio.map((r, q) => r * perez(coef[q], ct, g, cg));
    return xyyToRgb(v[1], Math.max(1e-4, v[2]), Math.max(0, v[0]));
  };
}

/** The direction of the centre of pixel (x, y) of a `w x h` panorama in the engine's convention. */
export function panoramaDirection(x: number, y: number, w: number, h: number): [number, number, number] {
  const u = (x + 0.5) / w;
  const v = (y + 0.5) / h;
  const st = Math.sin(Math.PI * v);
  const phi = 2 * Math.PI * (u - 0.5);
  return [st * Math.cos(phi), -st * Math.sin(phi), Math.cos(Math.PI * v)];
}

export interface SkyParams {
  /** The daylight model; PHYSICAL when absent. */
  model?: SkyModel;
  sunAzimuthDeg: number;
  sunElevationDeg: number;
  turbidity: number;
  /** The dome's values the sky is scaled to (DOME_FLOOR, DOME_HORIZON, DOME_ZENITH) and the strength. */
  floor: number;
  horizon: number;
  zenith: number;
  strength: number;
}

/** The sky as the engine tabulates it: SKY_WIDTH x SKY_HEIGHT linear RGB, rows from the top. */
export function skyImage(p: SkyParams): Float32Array {
  if (p.model !== 'CLASSIC') return physicalSkyImage(p);
  const sky = preetham(p.sunAzimuthDeg, p.sunElevationDeg, p.turbidity);
  const w = SKY_WIDTH;
  const h = SKY_HEIGHT;
  const rgb = new Float32Array(3 * w * h);
  const cell = (Math.PI / h) * ((2 * Math.PI) / w);
  let irradiance = 0;
  for (let y = 0; y < h / 2; y++) {
    for (let x = 0; x < w; x++) {
      const d = panoramaDirection(x, y, w, h);
      const c = sky(d);
      rgb.set(c, 3 * (y * w + x));
      const st = Math.sin(Math.PI * ((y + 0.5) / h));
      irradiance += (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) * d[2] * st * cell;
    }
  }
  const strength = Math.max(0, p.strength);
  const target = strength * 2 * Math.PI * (Math.max(0, p.horizon) / 6 + Math.max(0, p.zenith) / 3);
  const scale = irradiance > 0 ? target / irradiance : 0;
  const ground = Math.max(0, p.floor * strength);
  for (let i = 0; i < rgb.length; i++) rgb[i] = Math.floor(i / (3 * w)) < h / 2 ? rgb[i] * scale : ground;
  return rgb;
}
