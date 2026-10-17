// Phase L5: the page's reader of IES profiles (src/core/ies.ts). It is a port of the engine's (rt_core::ies): the same
// files are accepted and refused for the same reasons with the same messages, and the intensity, the flux and the name
// agree with what the engine makes of them (tests/fixtures/ies/conformance.json, which the engine's tests write and check).
// Also the two hand-written profiles at 0, 30 and 60 degrees, the symmetries, the polar plot, the half-intensity cone of
// the Fast preview, and the text a project keeps.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  IES_MAX_BYTES,
  iesBytesOf,
  iesEfficiency,
  iesHalfAngle,
  iesIntensity,
  iesIntensityDir,
  iesIsRound,
  iesPolar,
  iesSpot,
  iesTextOf,
  parseIes,
  readIes,
  type IesErrorCode,
  type IesProfile,
} from '../src/core/ies';
import { iesPlotPath, IES_PLOT } from '../src/ui/components/ies-plot';

const read = (name: string): string => iesTextOf(new Uint8Array(readFileSync(`tests/fixtures/ies/${name}`)));
const DOWNLIGHT = read('downlight-symmetric.ies');
const WALL_WASHER = read('wall-washer.ies');

function profile(text: string): IesProfile {
  const r = parseIes(text);
  if (!r.ok) throw new Error(r.error.message);
  return r.profile;
}

/** A unit direction in the luminaire's frame at vertical angle `gamma` and horizontal angle `phi`. */
function direction(gamma: number, phi: number): [number, number, number] {
  const g = (gamma * Math.PI) / 180;
  const p = (phi * Math.PI) / 180;
  return [Math.sin(g) * Math.sin(p), Math.sin(g) * Math.cos(p), Math.cos(g)];
}

describe('IES reader: agreement with the engine', () => {
  const fixture = JSON.parse(readFileSync('tests/fixtures/ies/conformance.json', 'utf8')) as {
    directions: [number, number][];
    cases: {
      name: string;
      text: string;
      error: IesErrorCode | null;
      params?: Record<string, number | string>;
      message?: string;
      profileName?: string;
      symmetry?: string;
      peak?: number;
      flux?: number;
      samples?: number[];
    }[];
  };

  it('has the cases of both outcomes', () => {
    expect(fixture.cases.length).toBeGreaterThan(60);
    expect(fixture.cases.filter((c) => c.error === null).length).toBeGreaterThan(15);
    const codes = new Set(fixture.cases.map((c) => c.error).filter(Boolean));
    expect(codes.size).toBeGreaterThanOrEqual(15);
  });

  for (const c of (JSON.parse(readFileSync('tests/fixtures/ies/conformance.json', 'utf8')) as { cases: { name: string }[] }).cases) {
    it(`reads "${c.name}" as the engine does`, () => {
      const want = fixture.cases.find((x) => x.name === c.name)!;
      const got = parseIes(want.text);
      if (want.error !== null) {
        expect(got.ok, `the engine refuses it (${want.error}) and the page does not`).toBe(false);
        if (got.ok) return;
        expect(got.error.code).toBe(want.error);
        expect(got.error.params).toEqual(want.params);
        expect(got.error.message).toBe(want.message);
        return;
      }
      expect(got.ok, got.ok ? '' : got.error.message).toBe(true);
      if (!got.ok) return;
      const p = got.profile;
      expect(p.name).toBe(want.profileName);
      expect(p.symmetry).toBe(want.symmetry);
      expect(p.peak).toBe(Math.fround(want.peak!));
      // The engine adds in f32, the page in doubles: a few parts in a million.
      expect(Math.abs(p.flux / want.flux! - 1)).toBeLessThan(2e-5);
      fixture.directions.forEach(([gamma, phi], i) => {
        const a = iesIntensity(p, gamma, phi);
        expect(Math.abs(a - want.samples![i]), `${gamma}, ${phi}`).toBeLessThanOrEqual(1e-4 * p.peak);
      });
    });
  }
});

describe('IES reader: the two hand-written profiles', () => {
  it('the downlight sends 1000, 750 and 250 cd at 0, 30 and 60 degrees, and 0 above the horizon', () => {
    const p = profile(DOWNLIGHT);
    expect(p.name).toBe('Test downlight, 1000 cd cos^2, rotationally symmetric');
    expect(p.symmetry).toBe('ROTATIONAL');
    expect(p.peak).toBe(1000);
    for (const [gamma, candela] of [
      [0, 1000],
      [30, 750],
      [60, 250],
      [90, 0],
    ]) {
      expect(iesIntensity(p, gamma, 0)).toBeCloseTo(candela, 6);
      expect(iesIntensity(p, gamma, 211)).toBeCloseTo(candela, 6);
      expect(iesIntensityDir(p, direction(gamma, 77))).toBeCloseTo(candela, 3);
    }
    // Linear between nodes: 35 degrees is halfway from 750 to 587; the smooth cos² would say 671.1.
    expect(iesIntensity(p, 35, 0)).toBeCloseTo(668.5, 6);
    for (const gamma of [90.001, 95, 135, 180, -1, Number.NaN]) expect(iesIntensity(p, gamma, 0)).toBe(0);
  });

  it('the wall washer follows its table, each horizontal angle its own, φ any angle', () => {
    const p = profile(WALL_WASHER);
    expect(p.symmetry).toBe('FULL');
    expect(p.peak).toBe(900);
    expect([0, 90, 180, 270, 360].map((phi) => iesIntensity(p, 60, phi))).toEqual([560, 430, 330, 380, 560]);
    expect(iesIntensity(p, 30, 0)).toBeCloseTo(800, 6);
    expect(iesIntensity(p, 30, 45)).toBeCloseTo(765, 6);
    expect(iesIntensity(p, 30, 405)).toBeCloseTo(765, 6);
    expect(iesIntensity(p, 30, -45)).toBeCloseTo(0.5 * (800 + 0.5 * (800 + 600)), 6);
  });

  it('the horizontal angle runs from +y towards +x, as the engine has it', () => {
    const p = profile(WALL_WASHER);
    const at = (phi: number) => iesIntensityDir(p, direction(60, phi));
    expect([0, 90, 180, 270].map(at).map((x) => Math.round(x * 1000) / 1000)).toEqual([560, 430, 330, 380]);
    expect(iesIntensityDir(p, [0, 0, 1])).toBeCloseTo(900, 6);
  });

  it('the files are the very text the page keeps and the RSB carries, character for character', () => {
    for (const [name, text] of [
      ['downlight-symmetric.ies', DOWNLIGHT],
      ['wall-washer.ies', WALL_WASHER],
    ]) {
      const bytes = new Uint8Array(readFileSync(`tests/fixtures/ies/${name}`));
      expect(text.length).toBe(bytes.length);
      expect(Array.from(iesBytesOf(text))).toEqual(Array.from(bytes));
    }
    // Every byte value survives, the Latin-1 ones included.
    const all = new Uint8Array(256).map((_, i) => i);
    expect(Array.from(iesBytesOf(iesTextOf(all)))).toEqual(Array.from(all));
    expect(iesTextOf(new Uint8Array(40_000)).length).toBe(40_000);
  });
});

describe('IES reader: flux and efficiency', () => {
  const text = (v: number[], h: number[], f: (g: number, p: number) => number): string =>
    `IESNA:LM-63-2002\n[LUMINAIRE] generated\nTILT=NONE\n1 1000 1 ${v.length} ${h.length} 1 2 0 0 0\n1 1 10\n${v.join(' ')}\n${h.join(' ')}\n${h.map((p) => v.map((g) => f(g, p)).join(' ')).join('\n')}\n`;
  const range = (from: number, to: number, step: number): number[] => Array.from({ length: Math.round((to - from) / step) + 1 }, (_, i) => from + i * step);

  it('an isotropic profile has the flux of a sphere and an efficiency of 1', () => {
    const p = profile(text(range(0, 180, 10), [0], () => 100));
    expect(p.flux).toBeCloseTo(4 * Math.PI * 100, 6);
    expect(iesEfficiency(p)).toBeCloseTo(1, 12);
    const irregular = profile(text([0, 3, 17, 40, 41, 90, 120, 179, 180], [0, 100, 250, 360], () => 100));
    expect(irregular.flux).toBeCloseTo(4 * Math.PI * 100, 6);
    const half = profile(text(range(0, 90, 15), [0], () => 100));
    expect(iesEfficiency(half)).toBeCloseTo(0.5, 12);
  });

  it('a cosine-squared lamp has 2π/3 of its peak, as finely as the table is', () => {
    const exact = (2 * Math.PI * 1000) / 3;
    const fine = profile(text(range(0, 90, 1), [0], (g) => 1000 * Math.cos((g * Math.PI) / 180) ** 2));
    expect(Math.abs(fine.flux / exact - 1)).toBeLessThan(1e-4);
    const coarse = profile(DOWNLIGHT);
    expect(Math.abs(coarse.flux / exact - 1)).toBeLessThan(6e-3);
  });

  it('is the integral of the interpolant the lookup evaluates', () => {
    const p = profile(WALL_WASHER);
    let sum = 0;
    for (let g = 0.5; g < 180; g += 1) for (let f = 1; f < 360; f += 2) sum += iesIntensity(p, g, f) * Math.sin((g * Math.PI) / 180) * (Math.PI / 180) * ((2 * Math.PI) / 180);
    expect(Math.abs(p.flux / sum - 1)).toBeLessThan(1.5e-3);
  });
});

describe('IES reader: refusals', () => {
  const code = (text: string): IesErrorCode | 'ok' => {
    const r = parseIes(text);
    return r.ok ? 'ok' : r.error.code;
  };

  it('a file too large is refused before it is read', () => {
    expect(code(' '.repeat(IES_MAX_BYTES + 1))).toBe('TooLarge');
    expect(code(DOWNLIGHT + ' '.repeat(IES_MAX_BYTES - DOWNLIGHT.length))).toBe('ok');
  });

  it('says what is wrong in a sentence with the numbers of the file', () => {
    const cut = parseIes(DOWNLIGHT.replace('1000 970 883 750 587 413 250 117 30 0', '1000 970 883 750 587'));
    expect(cut.ok).toBe(false);
    if (!cut.ok) {
      expect(cut.error.message).toContain('34');
      expect(cut.error.message).toContain('29');
      expect(cut.error.params).toEqual({ expected: 34, found: 29 });
    }
    const tilt = parseIes(DOWNLIGHT.replace('TILT=NONE', 'TILT=INCLUDE'));
    expect(!tilt.ok && tilt.error.message).toContain('TILT=INCLUDE');
    const b = parseIes(DOWNLIGHT.replace('1 2094 1 10 1 1 2', '1 2094 1 10 1 2 2'));
    expect(!b.ok && b.error.message).toContain('type B');
    expect(!b.ok && b.error.params).toEqual({ type: 'B' });
  });

  it('keeps the page and the engine from disagreeing on what is a number', () => {
    for (const bad of ['nan', 'inf', '1e999', '1e39', 'ten', '0x10', '1e', '.', '', ' ']) {
      const text = DOWNLIGHT.replace('1000 970 883', `1000 ${bad} 883`);
      // An empty value is no value at all: the table is one short.
      expect(code(text), bad).toBe(bad.trim() === '' ? 'Truncated' : 'NotANumber');
    }
    // What is a number: signs, exponents, a bare point.
    expect(code(DOWNLIGHT.replace('1000 970', '1.0E+03 +9.7e2'))).toBe('ok');
    expect(code(DOWNLIGHT.replace('1000 970', '1000. .97e3'))).toBe('ok');
  });

  it('never throws, on any prefix of a file or on bytes that are not text', () => {
    for (const text of [DOWNLIGHT, WALL_WASHER]) for (let n = 0; n < text.length; n += 3) parseIes(text.slice(0, n));
    let noise = '';
    for (let i = 0; i < 4000; i++) noise += String.fromCharCode(Math.imul(i, 2654435761) >>> 13 & 255);
    expect(typeof parseIes(noise).ok).toBe('boolean');
  });

  it('remembers the profile of a text it has read, and the refusal of one it has not', () => {
    expect(readIes(DOWNLIGHT)).toBe(readIes(DOWNLIGHT));
    const bad = 'TILT=INCLUDE';
    expect(readIes(bad)).toBe(readIes(bad));
    expect(readIes(bad).ok).toBe(false);
  });
});

describe('IES profile: what the interface draws from it', () => {
  it('the half-intensity angle of the cosine-squared downlight is 45 degrees, and 180 for a lamp bright all round', () => {
    expect(iesHalfAngle(profile(DOWNLIGHT))).toBeCloseTo(45, 6);
    const bulb = profile(`TILT=NONE\n1 1000 1 3 1 1 2 0 0 0\n1 1 10\n0 90 180\n0\n100 100 100\n`);
    expect(iesHalfAngle(bulb)).toBe(180);
    // The beam of the asymmetric file is read along its brightest plane: 900 on every plane's axis, half at 60-ish degrees.
    const washer = iesHalfAngle(profile(WALL_WASHER));
    expect(washer).toBeGreaterThan(55);
    expect(washer).toBeLessThan(75);
  });

  it('the spot light that stands for it is a half of the peak at its half-intensity angle', () => {
    // The smoothstep of the spot (three.js, the engine) runs in cos from its inner to its outer edge: at the half-intensity
    // angle it must be one half, whatever the beam, until the outer edge reaches the 90 degrees a spot can draw.
    const smooth = (cone: number, blend: number, at: number): number => {
      const half = (cone / 2) * (Math.PI / 180);
      const inner = half * (1 - blend);
      const t = (Math.cos((at * Math.PI) / 180) - Math.cos(half)) / (Math.cos(inner) - Math.cos(half));
      const c = Math.min(1, Math.max(0, t));
      return c * c * (3 - 2 * c);
    };
    const taper = (beta: number): IesProfile => {
      // A beam that is half at `beta` degrees: 1000 cos^n with n chosen so (cos beta)^n = 1/2, on a 1 degree table.
      const n = Math.log(0.5) / Math.log(Math.cos((beta * Math.PI) / 180));
      const v = Array.from({ length: 91 }, (_, i) => i);
      return profile(`TILT=NONE\n1 1000 1 91 1 1 2 0 0 0\n1 1 10\n${v.join(' ')}\n0\n${v.map((g) => 1000 * Math.cos((g * Math.PI) / 180) ** n).join(' ')}\n`);
    };
    for (const beta of [8, 15, 30, 45, 60, 70]) {
      const p = taper(beta);
      expect(iesHalfAngle(p)).toBeCloseTo(beta, 1);
      const { cone, blend } = iesSpot(p);
      expect(cone).toBeLessThanOrEqual(180 + 1e-9);
      expect(cone / 2).toBeGreaterThan(iesHalfAngle(p));
      expect(blend).toBeGreaterThanOrEqual(0);
      expect(smooth(cone, blend, iesHalfAngle(p)), `beam ${beta}`).toBeCloseTo(0.5, 6);
    }
    // The downlight of the fixture: half at 45 degrees exactly.
    const { cone, blend } = iesSpot(profile(DOWNLIGHT));
    expect(smooth(cone, blend, 45)).toBeCloseTo(0.5, 6);
    expect(blend).toBeGreaterThan(0.3);
    // A lamp with no cone gets the widest the preview can draw: a hemisphere with a hard edge.
    const bulb = profile(`TILT=NONE\n1 1000 1 3 1 1 2 0 0 0\n1 1 10\n0 90 180\n0\n100 100 100\n`);
    expect(iesSpot(bulb)).toEqual({ cone: 180, blend: 0 });
  });

  it('the polar plot has the two planes of the table, the axis down, C0 and C90 on the right', () => {
    const p = profile(WALL_WASHER);
    const [c0, c90] = iesPolar(p, 2);
    expect([c0.plane, c90.plane]).toEqual(['C0', 'C90']);
    const at = (c: typeof c0, angle: number) => c.points.find(([a]) => a === angle)![1];
    expect(at(c0, 0)).toBe(1);
    // 60 degrees to the right of C0–C180 is C0 (560 of 900), to the left C180 (330); in the other plane C90 and C270.
    expect(at(c0, 60)).toBeCloseTo(560 / 900, 9);
    expect(at(c0, -60)).toBeCloseTo(330 / 900, 9);
    expect(at(c90, 60)).toBeCloseTo(430 / 900, 9);
    expect(at(c90, -60)).toBeCloseTo(380 / 900, 9);
    // The curve goes all the way round: -180 to 180.
    expect([c0.points[0][0], c0.points[c0.points.length - 1][0]]).toEqual([-180, 180]);
    expect(Math.max(...c0.points.map((x) => x[1]))).toBeLessThanOrEqual(1);
    // A profile that is round about its axis is the one curve twice.
    const round = profile(DOWNLIGHT);
    expect(iesIsRound(round)).toBe(true);
    expect(iesIsRound(p)).toBe(false);
    const [r0, r90] = iesPolar(round);
    expect(r0.points).toEqual(r90.points);
  });

  it('the plot draws the axis at the bottom and a bigger radius further out', () => {
    const { centre, radius } = IES_PLOT;
    const d = iesPlotPath([
      [0, 1],
      [90, 0.5],
      [180, 0.25],
    ]);
    const [a, b, c] = d.slice(1, -1).split('L').map((p) => p.split(' ').map(Number));
    expect(a).toEqual([centre, centre + radius]); // the axis, down (screen y grows downwards), the peak on the rim
    expect(b[0]).toBeCloseTo(centre + radius * 0.5, 1);
    expect(b[1]).toBeCloseTo(centre, 1);
    expect(c[0]).toBeCloseTo(centre, 1);
    expect(c[1]).toBeCloseTo(centre - radius * 0.25, 1);
  });
});
