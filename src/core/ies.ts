// IES photometric profiles (phase L5): the page's reader of the IES LM-63 text format, the intensity it describes, its
// flux, and what the interface draws from it (the half-intensity cone of the Fast preview's spot light, the polar plot).
//
// This is a port of the engine's reader (`rt_core::ies`, engine/crates/rt-core/src/ies.rs), whose documentation is the
// reference for the format: type C photometry, `TILT=NONE`, vertical angles 0-90, 0-180 or 90-180, horizontal angles one,
// 0-90, 0-180, 90-270 or 0-360; type A and B, `TILT=INCLUDE` and `TILT=<file>` are refused, each with its own message. The
// two readers accept and refuse the same files: `tests/fixtures/ies/conformance.json` (written by the engine's tests) lists
// files with what the engine made of them, and `tests/ies.test.ts` requires this one to agree. The page needs its own reader
// for what the engine's cannot give it before an engine is loaded: the name and the plot shown on the light, the refusal at
// the moment a file is chosen, the lumens, and the spot light of the Fast preview. Doubles here, `f32` there: values agree
// to a few parts in a million.
//
// A file is kept as the text it came in, one character per byte (`latin1`), so the project and the RSB carry the very file.

import type { Vec3 } from './math';

/** The most a file may weigh, in bytes (rt_core::ies::MAX_BYTES). */
export const IES_MAX_BYTES = 2 * 1024 * 1024;
/** The most angles of either kind a file may declare (rt_core::ies::MAX_ANGLES). */
export const IES_MAX_ANGLES = 4096;

/** How the horizontal angles cover the circle (rt_core::ies::Symmetry). */
export type IesSymmetry = 'ROTATIONAL' | 'QUADRANT' | 'BILATERAL_0' | 'BILATERAL_90' | 'FULL';

/** Why a file is not a profile (the variants of rt_core::ies::IesError; `code` is the variant's name). */
export type IesErrorCode =
  | 'TooLarge'
  | 'MissingTilt'
  | 'TiltIncluded'
  | 'TiltFile'
  | 'NotANumber'
  | 'ShortHeader'
  | 'BadCount'
  | 'TooManyAngles'
  | 'UnsupportedType'
  | 'BadType'
  | 'BadMultiplier'
  | 'Truncated'
  | 'TooManyValues'
  | 'BadVerticalAngles'
  | 'BadHorizontalAngles'
  | 'NegativeCandela'
  | 'NoLight';

/** A refusal, with what the interface needs to say it in a sentence. */
export interface IesError {
  code: IesErrorCode;
  /** English, as the engine says it (details in numbers included). */
  message: string;
  /** The numbers of the sentence: the value that is not a number (position), the type, the expected and found counts. */
  params: Record<string, number | string>;
}

/** A photometric profile: the candela in every direction (rt_core::ies::IesProfile). */
export interface IesProfile {
  /** The luminaire's description, else its catalogue number, else the test report's; may be empty. */
  name: string;
  symmetry: IesSymmetry;
  /** Degrees, strictly increasing. */
  vertical: readonly number[];
  /** Degrees, strictly increasing (one entry when rotationally symmetric). */
  horizontal: readonly number[];
  /** `horizontal.length` rows of `vertical.length` values, the file's candela multiplier applied. */
  candela: readonly number[];
  /** The largest candela (positive). */
  peak: number;
  /** The intensity integrated over the sphere, in candela steradians (lumens for a file in candela). */
  flux: number;
}

export type IesParse = { ok: true; profile: IesProfile } | { ok: false; error: IesError };

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;
const ANGLE_EPS = 1e-3;
const HEADER_NUMBERS = 13;

const MESSAGES: Record<IesErrorCode, string> = {
  TooLarge: 'the IES file is too large',
  MissingTilt: 'the IES file has no TILT= line',
  TiltIncluded: 'TILT=INCLUDE is not supported: export the profile with TILT=NONE',
  TiltFile: 'a TILT file is not supported: the profile needs TILT=NONE',
  NotANumber: 'the IES table holds a value that is not a number',
  ShortHeader: 'the IES file ends inside the thirteen numbers of its header',
  BadCount: 'the IES angle counts must be whole numbers of at least one',
  TooManyAngles: 'the IES file declares too many angles',
  UnsupportedType: 'only photometric type C is supported, not type A or B',
  BadType: 'the IES photometric type is not 1, 2 or 3',
  BadMultiplier: 'the IES candela multiplier must be positive',
  Truncated: 'the IES file has fewer values than its counts declare',
  TooManyValues: 'the IES file has more values than its counts declare',
  BadVerticalAngles: 'the IES vertical angles must increase and run 0-90, 0-180 or 90-180',
  BadHorizontalAngles: 'the IES horizontal angles must increase and be one angle, 0-90, 0-180, 90-270 or 0-360',
  NegativeCandela: 'the IES table has a negative candela value',
  NoLight: 'the IES table is all zeros: it gives no light',
};

function refusal(code: IesErrorCode, params: Record<string, number | string> = {}): IesParse {
  let message = MESSAGES[code];
  if (code === 'NotANumber') message += ` (value ${params.at})`;
  else if (code === 'UnsupportedType') message += ` (the file says type ${params.type})`;
  else if (code === 'Truncated' || code === 'TooManyValues') message += ` (they call for ${params.expected} numbers after TILT=NONE and the file has ${params.found})`;
  return { ok: false, error: { code, message, params } };
}

/** `x` as a whole number, when it is one (rt_core::ies::whole). */
function whole(x: number): number | null {
  return x >= 0 && x <= 1e9 && Math.floor(x) === x ? x : null;
}

const same = (a: number, b: number): boolean => Math.abs(a - b) < ANGLE_EPS;
const increasing = (a: readonly number[]): boolean => a.every((v, i) => i === 0 || a[i - 1] < v);

/** A number as the engine's `str::parse::<f32>` reads it: a decimal with a sign, a point and an exponent; finite in f32. */
const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

function readNumbers(text: string): number[] | number {
  const out: number[] = [];
  for (const token of text.split(/[ \t\n\r\f,]+/)) {
    if (token === '') continue;
    const v = NUMBER.test(token) ? Math.fround(Number(token)) : NaN;
    if (!Number.isFinite(v)) return out.length + 1;
    out.push(v);
  }
  return out;
}

/** Splits the header from the table: keywords (a `[MORE]` line joined to the one before) and where the numbers start. */
function readHeader(text: string): { keywords: [string, string][]; at: number } | IesParse {
  const keywords: [string, string][] = [];
  let pos = 0;
  while (pos < text.length) {
    let end = pos;
    while (end < text.length && text[end] !== '\n' && text[end] !== '\r') end++;
    const line = text.slice(pos, end).trim();
    pos = end;
    if (pos < text.length) pos += text[pos] === '\r' && text[pos + 1] === '\n' ? 2 : 1;
    if (line.length >= 5 && line.slice(0, 5).toUpperCase() === 'TILT=') {
      const value = line.slice(5).trim().toUpperCase();
      if (value === 'NONE') return { keywords, at: pos };
      return refusal(value === 'INCLUDE' ? 'TiltIncluded' : 'TiltFile');
    }
    if (line.startsWith('[')) {
      const close = line.indexOf(']');
      if (close > 0) {
        const key = line.slice(1, close).trim().toUpperCase();
        const value = line.slice(close + 1).trim();
        if (key === 'MORE') {
          const last = keywords[keywords.length - 1];
          if (last) last[1] = last[1] && value ? `${last[1]} ${value}` : last[1] + value;
        } else keywords.push([key, value]);
      }
    }
  }
  return refusal('MissingTilt');
}

function nameOf(keywords: readonly [string, string][]): string {
  for (const wanted of ['LUMINAIRE', 'LUMCAT', 'TEST']) {
    const hit = keywords.find(([k, v]) => k === wanted && v !== '');
    if (hit) return Array.from(hit[1]).slice(0, 80).join('');
  }
  return '';
}

/** The cell of the increasing `angles` that holds `x` (inside their range); the last cell for the top angle. */
function cell(angles: readonly number[], x: number): number {
  let lo = 0;
  let hi = angles.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (angles[mid] <= x) lo = mid + 1;
    else hi = mid;
  }
  return Math.min(Math.max(lo - 1, 0), angles.length - 2);
}

/** `sin x - x cos x`, which is `x³/3` for small `x` and cancels badly there. */
function sinMinusXCos(x: number): number {
  if (x < 0.05) {
    const x2 = x * x;
    return x * x2 * (1 / 3 - x2 * (1 / 30 - x2 * (1 / 840)));
  }
  return Math.sin(x) - x * Math.cos(x);
}

const COPIES: Record<IesSymmetry, number> = { ROTATIONAL: 1, FULL: 1, BILATERAL_0: 2, BILATERAL_90: 2, QUADRANT: 4 };

/** The integral of `sin γ` times the intensity along one row of the table, in closed form cell by cell. */
function rowIntegral(vertical: readonly number[], candela: readonly number[], row: number): number {
  const n = vertical.length;
  let sum = 0;
  for (let i = 0; i < n - 1; i++) {
    const g0 = vertical[i] * DEG;
    const g1 = vertical[i + 1] * DEG;
    const a = candela[row * n + i];
    const b = candela[row * n + i + 1];
    const half = 0.5 * (g1 - g0);
    const mid = 0.5 * (g0 + g1);
    sum += 0.5 * (a + b) * 2 * Math.sin(mid) * Math.sin(half) + ((b - a) / (g1 - g0)) * Math.cos(mid) * 2 * sinMinusXCos(half);
  }
  return sum;
}

function integrate(symmetry: IesSymmetry, vertical: readonly number[], horizontal: readonly number[], candela: readonly number[]): number {
  if (horizontal.length === 1) return 2 * Math.PI * rowIntegral(vertical, candela, 0);
  const columns = horizontal.map((_, j) => rowIntegral(vertical, candela, j));
  let sum = 0;
  for (let j = 0; j < horizontal.length - 1; j++) sum += (horizontal[j + 1] - horizontal[j]) * DEG * 0.5 * (columns[j] + columns[j + 1]);
  return sum * COPIES[symmetry];
}

/** Reads an IES file (one character per byte). Refuses what the engine refuses, for the same reasons. */
export function parseIes(text: string): IesParse {
  if (text.length > IES_MAX_BYTES) return refusal('TooLarge');
  const header = readHeader(text);
  if (!('keywords' in header)) return header;
  const numbers = readNumbers(text.slice(header.at));
  if (typeof numbers === 'number') return refusal('NotANumber', { at: numbers });
  if (numbers.length < HEADER_NUMBERS) return refusal('ShortHeader');
  const multiplier = numbers[2];
  const nv = whole(numbers[3]);
  const nh = whole(numbers[4]);
  if (nv === null || nv < 1 || nh === null || nh < 1) return refusal('BadCount');
  if (nv > IES_MAX_ANGLES || nh > IES_MAX_ANGLES) return refusal('TooManyAngles');
  const type = whole(numbers[5]);
  if (type === 2 || type === 3) return refusal('UnsupportedType', { type: type === 2 ? 'B' : 'A' });
  if (type !== 1) return refusal('BadType');
  if (multiplier <= 0) return refusal('BadMultiplier');
  const expected = HEADER_NUMBERS + nv + nh + nv * nh;
  if (numbers.length < expected) return refusal('Truncated', { expected, found: numbers.length });
  if (numbers.length > expected) return refusal('TooManyValues', { expected, found: numbers.length });
  const vertical = numbers.slice(HEADER_NUMBERS, HEADER_NUMBERS + nv);
  const horizontal = numbers.slice(HEADER_NUMBERS + nv, HEADER_NUMBERS + nv + nh);
  const table = numbers.slice(HEADER_NUMBERS + nv + nh);
  const last = vertical[nv - 1];
  const verticalOk = nv >= 2 && increasing(vertical) && ((same(vertical[0], 0) && (same(last, 90) || same(last, 180))) || (same(vertical[0], 90) && same(last, 180)));
  if (!verticalOk) return refusal('BadVerticalAngles');
  let symmetry: IesSymmetry;
  if (nh === 1) {
    if (!(horizontal[0] >= 0 && horizontal[0] <= 360)) return refusal('BadHorizontalAngles');
    symmetry = 'ROTATIONAL';
  } else {
    if (!increasing(horizontal)) return refusal('BadHorizontalAngles');
    const first = horizontal[0];
    const end = horizontal[nh - 1];
    if (same(first, 0) && same(end, 90)) symmetry = 'QUADRANT';
    else if (same(first, 0) && same(end, 180)) symmetry = 'BILATERAL_0';
    else if (same(first, 90) && same(end, 270)) symmetry = 'BILATERAL_90';
    else if (same(first, 0) && same(end, 360)) symmetry = 'FULL';
    else return refusal('BadHorizontalAngles');
  }
  if (table.some((c) => c < 0)) return refusal('NegativeCandela');
  const candela = table.map((c) => Math.fround(c * multiplier));
  const peak = candela.reduce((p, c) => Math.max(p, c), 0);
  if (!(peak > 0 && Number.isFinite(peak))) return refusal('NoLight');
  return { ok: true, profile: { name: nameOf(header.keywords), symmetry, vertical, horizontal, candela, peak, flux: integrate(symmetry, vertical, horizontal, candela) } };
}

/** `phi` (any degrees) reduced into the range of the table by the symmetry. */
function fold(symmetry: IesSymmetry, phi: number): number {
  const p = phi - 360 * Math.floor(phi / 360);
  switch (symmetry) {
    case 'ROTATIONAL':
    case 'FULL':
      return p;
    case 'BILATERAL_0':
      return p > 180 ? 360 - p : p;
    case 'QUADRANT': {
      const q = p > 180 ? 360 - p : p;
      return q > 90 ? 180 - q : q;
    }
    case 'BILATERAL_90': {
      if (p >= 90 && p <= 270) return p;
      const q = 180 - p;
      return q < 0 ? q + 360 : q;
    }
  }
}

/** The intensity in candela towards vertical angle `gamma` and horizontal angle `phi` (degrees), bilinear; 0 outside the table's vertical range. */
export function iesIntensity(p: IesProfile, gamma: number, phi: number): number {
  const v = p.vertical;
  const n = v.length;
  if (!(gamma >= v[0] && gamma <= v[n - 1])) return 0;
  const i = cell(v, gamma);
  const t = (gamma - v[i]) / (v[i + 1] - v[i]);
  const along = (row: number): number => {
    const a = p.candela[row * n + i];
    const b = p.candela[row * n + i + 1];
    return a + (b - a) * t;
  };
  if (p.horizontal.length === 1) return along(0);
  const f = fold(p.symmetry, phi);
  const j = cell(p.horizontal, f);
  const s = (f - p.horizontal[j]) / (p.horizontal[j + 1] - p.horizontal[j]);
  const a = along(j);
  const b = along(j + 1);
  return a + (b - a) * s;
}

/**
 * The intensity towards the unit direction `local` in the luminaire's own frame: `+z` its axis, `φ = 0` along `+y`, `φ`
 * growing from `+y` towards `+x` (counter-clockwise looking along the axis from behind the light).
 */
export function iesIntensityDir(p: IesProfile, local: Vec3): number {
  const gamma = Math.atan2(Math.hypot(local[0], local[1]), local[2]) * RAD;
  const phi = p.horizontal.length === 1 ? 0 : Math.atan2(local[0], local[1]) * RAD;
  return iesIntensity(p, gamma, phi);
}

/** The share of the sphere's worth of the peak intensity the profile sends out: `flux / (4π peak)`, in (0, 1]. */
export function iesEfficiency(p: IesProfile): number {
  return p.flux / (4 * Math.PI * p.peak);
}

/**
 * The angle from the axis at which the intensity first falls to half of the peak, along the brightest plane of the table,
 * in degrees (the beam's half angle, as photometric reports give it): what the Fast preview's spot light takes for its cone.
 * 180 when the profile never falls to half (a lamp that is bright in every direction).
 */
export function iesHalfAngle(p: IesProfile): number {
  const hit = halfAngles.get(p);
  if (hit !== undefined) return hit;
  const angle = findHalfAngle(p);
  halfAngles.set(p, angle);
  return angle;
}

const halfAngles = new WeakMap<IesProfile, number>();

function findHalfAngle(p: IesProfile): number {
  // The plane through the axis whose brightest value is the peak's, preferring the one that is brightest on the axis side.
  let best = 0;
  let bestScore = -1;
  const n = p.vertical.length;
  for (let j = 0; j < p.horizontal.length; j++) {
    let score = 0;
    for (let i = 0; i < n; i++) score = Math.max(score, p.candela[j * n + i]);
    if (score > bestScore + 1e-12) {
      best = j;
      bestScore = score;
    }
  }
  const phi = p.horizontal[best];
  const steps = 720;
  const top = p.vertical[n - 1];
  const half = 0.5 * p.peak;
  let prevAngle = p.vertical[0];
  let prev = iesIntensity(p, prevAngle, phi);
  // The peak may not be on the axis (a batwing): the cone starts from where it is reached.
  let seenPeak = prev >= half;
  for (let k = 1; k <= steps; k++) {
    const angle = p.vertical[0] + ((top - p.vertical[0]) * k) / steps;
    const v = iesIntensity(p, angle, phi);
    if (seenPeak && v < half && prev >= half) return prevAngle + ((prev - half) / (prev - v)) * (angle - prevAngle);
    if (v >= half) seenPeak = true;
    prevAngle = angle;
    prev = v;
  }
  return seenPeak ? Math.min(180, top) : 180;
}

/**
 * The spot light that stands for the profile where the engine's own lookup is not at hand (the Fast preview; the RSB written
 * for an engine that has no IES lights): the axis intensity (the light's own), and a cone whose smoothstep edge is exactly
 * half the peak at the profile's half-intensity angle `β`. The smoothstep of a spot (three.js, the engine) runs in the cosine
 * of the angle from 1 at its inner edge to 0 at its outer edge, so it is a half where `cos β` is halfway between the two
 * cosines: the inner edge is taken at `0.4 β` and the outer one where that holds (`2 cos β − cos 0.4β`), at most 90° (what a
 * three.js spot can draw; past it the inner edge is the one that moves). `cone` is the full angle of the outer edge, `blend`
 * the soft edge as a fraction of its half angle (core/lighting.ts `SPOT_DEFAULTS`; the engine's `LGHT.angle_deg` is `blend ×
 * cone / 2`). A lamp that never falls to half (a bare bulb) is the widest cone there is, a hard-edged hemisphere.
 */
export function iesSpot(p: IesProfile): { cone: number; blend: number } {
  const beta = Math.min(90, Math.max(1, iesHalfAngle(p))) * DEG;
  const cosOuter = 2 * Math.cos(beta) - Math.cos(0.4 * beta);
  let outer: number;
  let inner: number;
  if (cosOuter >= 0) {
    outer = Math.acos(Math.min(1, cosOuter));
    inner = 0.4 * beta;
  } else {
    outer = Math.PI / 2;
    inner = Math.acos(Math.min(1, Math.max(-1, 2 * Math.cos(beta))));
  }
  return { cone: 2 * outer * RAD, blend: outer > 0 ? Math.max(0, 1 - inner / outer) : 0 };
}

/** One closed curve of a polar plot: normalised radius (0 to 1) at each angle, 0° at the bottom, going round. */
export interface IesPolarCurve {
  /** C0–C180 or C90–C270, as the planes of a luminaire's polar diagram. */
  plane: 'C0' | 'C90';
  /** `[angle in degrees from the nadir, counter-clockwise looking at the plane with C0 or C90 on the right; radius 0..1]`. */
  points: [number, number][];
}

/**
 * The polar diagram of the profile: the C0–C180 plane and the C90–C270 plane, intensity over the peak against the angle from
 * the axis (0° at the bottom, C0 or C90 to the right, C180 or C270 to the left), 2° apart. Drawn from the table the engine reads.
 */
export function iesPolar(p: IesProfile, stepDeg = 2): IesPolarCurve[] {
  const planes: [IesPolarCurve['plane'], number][] = [
    ['C0', 0],
    ['C90', 90],
  ];
  return planes.map(([plane, phi]) => {
    const points: [number, number][] = [];
    for (let a = -180; a <= 180 + 1e-9; a += stepDeg) {
      // Right of the axis (a > 0) is `phi`, left of it `phi + 180`.
      const gamma = Math.abs(a);
      const f = a >= 0 ? phi : phi + 180;
      points.push([a, Math.min(1, iesIntensity(p, gamma, f) / p.peak)]);
    }
    return { plane, points };
  });
}

/** True when the two planes of the polar diagram are the same curve (a profile that is round about its axis). */
export function iesIsRound(p: IesProfile): boolean {
  return p.horizontal.length === 1;
}

/** A file's bytes as the text a project keeps (one character per byte). */
export function iesTextOf(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 8192) out += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return out;
}

/** The bytes of a kept text (the RSB's `IESP` payload). */
export function iesBytesOf(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff;
  return out;
}

const parsed = new Map<string, IesParse>();

/** `parseIes` remembered for the last few texts (the preview and the inspector read the same profile many times). */
export function readIes(text: string): IesParse {
  const hit = parsed.get(text);
  if (hit) {
    parsed.delete(text);
    parsed.set(text, hit);
    return hit;
  }
  const fresh = parseIes(text);
  parsed.set(text, fresh);
  if (parsed.size > 16) parsed.delete(parsed.keys().next().value as string);
  return fresh;
}

/** The profile of a text kept in a light, or null when it cannot be read. */
export function iesProfileOf(text: string): IesProfile | null {
  const r = readIes(text);
  return r.ok ? r.profile : null;
}
