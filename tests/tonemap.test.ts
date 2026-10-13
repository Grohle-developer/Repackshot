// Tone curves (phase E4): the TypeScript port against the engine itself. The reference values
// are printed by `rt --tone-table` (tests/fixtures/tonemap.json, see its README).

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyCurve, DisplayCurve, exactPixel, exp2f, exposureGain, GUARD_ULPS, log2f, powf, srgbEncode, toneCurve, type ToneCurve } from '../src/render/tonemap';

const F32 = new Float32Array(1);
const U32 = new Uint32Array(F32.buffer);
const bits = (x: number) => ((F32[0] = x), U32[0]);
const fromBitsT = (b: number) => ((U32[0] = b >>> 0), F32[0]);

interface Table {
  inputs: number[][];
  curves: Record<string, number[][]>;
  srgb_encode: number[][];
  exposure: number[][];
  fmath: { exp2: number[][]; log2: number[][]; powf: number[][] };
  srgb8: { tonemap: number; ev: number; bytes: number[] }[];
}

const table = JSON.parse(readFileSync('tests/fixtures/tonemap.json', 'utf8')) as Table;
const f = Math.fround;
const NAMES = ['linear', 'ACES', 'filmic', 'AgX', 'standard'];

describe('tone curves equal the engine', () => {
  for (const [key, outputs] of Object.entries(table.curves)) {
    it(`${NAMES[Number(key)]}: 20 inputs within 1e-5 (and bit for bit)`, () => {
      expect(outputs).toHaveLength(20);
      table.inputs.forEach((input, i) => {
        const got = applyCurve(toneCurve(Number(key)), f(input[0]), f(input[1]), f(input[2]));
        for (let c = 0; c < 3; c++) {
          expect(Math.abs(got[c] - outputs[i][c]), `${NAMES[Number(key)]}(${input}) channel ${c}`).toBeLessThanOrEqual(1e-5);
          expect(got[c]).toBe(f(outputs[i][c]));
        }
      });
    });
  }

  it("the deterministic maths (fmath's exp2, log2, pow) bit for bit", () => {
    expect(table.fmath.exp2).toHaveLength(48);
    for (const [x, y] of table.fmath.exp2) expect(exp2f(f(x)), `exp2(${x})`).toBe(f(y));
    for (const [x, y] of table.fmath.log2) expect(log2f(f(x)), `log2(${x})`).toBe(f(y));
    for (const [x, y, z] of table.fmath.powf) expect(powf(Math.min(1, f(x)), f(y)), `pow(${x}, ${y})`).toBe(f(z));
  });

  it('sRGB encoding and the exposure gain', () => {
    for (const [x, y] of table.srgb_encode) expect(srgbEncode(f(x))).toBe(f(y));
    for (const [ev, gain] of table.exposure) expect(exposureGain(ev)).toBe(f(gain));
  });

  it('8-bit pixels equal Film::to_srgb8_tonemapped for every curve and exposure', () => {
    expect(table.srgb8).toHaveLength(15);
    for (const row of table.srgb8) {
      const out = new Uint8Array(60);
      const gain = exposureGain(row.ev);
      table.inputs.forEach((p, i) => exactPixel(f(p[0]), f(p[1]), f(p[2]), gain, toneCurve(row.tonemap), out, i * 3));
      expect([...out], `tonemap ${row.tonemap} at ${row.ev} EV`).toEqual(row.bytes);
    }
  });
});

describe('the viewport fast path', () => {
  /** Deterministic pseudo-random radiances over 2^-16 .. 2^8 (and a few exact zeros). */
  function* radiances(n: number): Generator<[number, number, number]> {
    let s = 12345;
    const next = () => {
      s = (Math.imul(s, 1103515245) + 12345) >>> 0;
      return s / 2 ** 32;
    };
    for (let i = 0; i < n; i++) {
      const grey = next() < 0.3;
      const v = () => (next() < 0.02 ? 0 : f(2 ** (-16 + 24 * next())));
      const a = v();
      yield grey ? [a, a, a] : [a, v(), v()];
    }
  }

  // The engine's curves are monotonic but its f32 maths is not, at the last bit: near a level
  // boundary filmic can go 222, 223, 222, 223 over consecutive floats. The fast path computes the
  // exact way within GUARD_ULPS of every threshold.
  for (const curve of [0, 1, 2, 4] as ToneCurve[]) {
    it(`${NAMES[curve]}: the fast path gives the exact bytes`, () => {
      for (const ev of [0, 1.37, -2.5]) {
        const fast = new DisplayCurve(ev, curve);
        const gain = exposureGain(ev);
        const a = new Uint8Array(3);
        const b = new Uint8Array(3);
        let off = 0;
        for (const [r, g, bl] of radiances(20000)) {
          exactPixel(r, g, bl, gain, curve, a, 0);
          fast.pixel(r, g, bl, b, 0);
          for (let c = 0; c < 3; c++) if (a[c] !== b[c]) off++;
        }
        expect(off, `${NAMES[curve]} at ${ev} EV`).toBe(0);
        // Just outside the guard band of every threshold, float by float: at most one level off.
        const t = fast.levels;
        const one = new Uint8Array(3);
        let worst = 0;
        for (let k = 0; k < 255; k++) {
          if (!Number.isFinite(t[k])) continue;
          const base = bits(t[k]);
          for (const side of [-1, 1]) {
            for (let d = GUARD_ULPS + 1; d <= GUARD_ULPS + 48; d++) {
              const v = fromBitsT(base + side * d);
              if (!(v > 0)) continue;
              fast.pixel(v, v, v, one, 0);
              worst = Math.max(worst, Math.abs(one[0] - fast.channelExact(v)));
            }
          }
        }
        expect(worst, `${NAMES[curve]} at ${ev} EV, beyond the guard`).toBeLessThanOrEqual(1);
      }
    });
  }

  it('the wiggles of the f32 curves fit in the guard band', () => {
    // How far from its threshold the exact byte still disagrees with "count of thresholds <= v".
    const widest = { 1: 0, 2: 0 } as Record<number, number>;
    for (const curve of [1, 2] as ToneCurve[]) {
      const fast = new DisplayCurve(0, curve);
      const t = fast.levels;
      for (let k = 0; k < 255; k++) {
        if (!Number.isFinite(t[k])) continue;
        const base = bits(t[k]);
        for (let d = -GUARD_ULPS - 64; d <= GUARD_ULPS + 64; d += 2) {
          const v = fromBitsT(base + d);
          if (!(v > 0)) continue;
          let level = 0;
          while (level < 255 && t[level] <= v) level++;
          if (level !== fast.channelExact(v)) widest[curve] = Math.max(widest[curve], Math.abs(d));
        }
      }
    }
    expect(widest[1]).toBeLessThanOrEqual(GUARD_ULPS);
    expect(widest[2]).toBeLessThanOrEqual(GUARD_ULPS);
  }, 30000);

  it('AgX: within one level of the exact path', () => {
    const fast = new DisplayCurve(0.5, 3);
    const gain = exposureGain(0.5);
    const a = new Uint8Array(3);
    const b = new Uint8Array(3);
    let off = 0;
    let worst = 0;
    for (const [r, g, bl] of radiances(20000)) {
      exactPixel(r, g, bl, gain, 3, a, 0);
      fast.pixel(r, g, bl, b, 0);
      for (let c = 0; c < 3; c++) {
        const d = Math.abs(a[c] - b[c]);
        worst = Math.max(worst, d);
        if (d) off++;
      }
    }
    expect(worst).toBeLessThanOrEqual(1);
    expect(off / 60000).toBeLessThan(0.02);
  });
});
