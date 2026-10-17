import { describe, it, expect } from 'vitest';
import {
  ease,
  kelvinToRgb,
  polar,
  specColor,
  specIrradiance,
  toWorldAzimuth,
} from '../src/core/light-math';
import { CAMERA_AZIMUTH_DEG } from '../src/data';
import type { EasingKind, RGB } from '../src/data';

const MODES: readonly EasingKind[] = ['LINEAR', 'EASE', 'EASE_IN', 'EASE_OUT', 'EASE_STRONG'];

function expectRgbClose(actual: RGB, expected: readonly number[]): void {
  expect(actual).toHaveLength(3);
  for (let i = 0; i < 3; i++) expect(actual[i]).toBeCloseTo(expected[i], 12);
}

describe('kelvinToRgb', () => {
  it('normalises so the largest channel is exactly 1', () => {
    for (const k of [1000, 1900, 2400, 3000, 4000, 5200, 5600, 6500, 9000, 12000]) {
      expect(Math.max(...kelvinToRgb(k)), `${k} K`).toBe(1);
    }
  });

  it('gives a near-white daylight at 5600 K', () => {
    const [r, g, b] = kelvinToRgb(5600);
    expect(Math.max(r, g, b)).toBe(1);
    expect(Math.min(r, g, b)).toBeGreaterThanOrEqual(0.85);
    // Pinned against the blackbody approximation.
    expectRgbClose([r, g, b], [1, 0.9383740988338822, 0.8834899105012184]);
  });

  it('is warm at low temperatures: red > green > blue', () => {
    const [r, g, b] = kelvinToRgb(2400);
    expect(r).toBeGreaterThan(g);
    expect(g).toBeGreaterThan(b);
    expectRgbClose([r, g, b], [1, 0.6078588117664293, 0.23729976915803278]);
  });

  it('is cool at high temperatures: blue > red', () => {
    const [r, g, b] = kelvinToRgb(9000);
    expect(b).toBeGreaterThan(r);
    expect(b).toBe(1);
    expectRgbClose([r, g, b], [0.8218972160571649, 0.8739607064832815, 1]);
  });

  it('keeps the other pinned values of the approximation', () => {
    expectRgbClose(kelvinToRgb(1000), [1, 0.2663545845364998, 0]);
    expectRgbClose(kelvinToRgb(3000), [1, 0.6949030005552019, 0.4310480202110507]);
    expectRgbClose(kelvinToRgb(5200), [1, 0.9094659440567877, 0.8340734229624407]);
    expectRgbClose(kelvinToRgb(6500), [1, 0.9965101328455601, 0.9805565033048651]);
  });

  it('clamps to 1000..12000 K and survives NaN', () => {
    expect(kelvinToRgb(1)).toEqual(kelvinToRgb(1000));
    expect(kelvinToRgb(-50)).toEqual(kelvinToRgb(1000));
    expect(kelvinToRgb(50000)).toEqual(kelvinToRgb(12000));
    expect(kelvinToRgb(Number.NaN)).toEqual(kelvinToRgb(1000));
    for (const c of kelvinToRgb(Number.NaN)) expect(Number.isFinite(c)).toBe(true);
  });

  it('never leaves 0..1', () => {
    for (let k = 500; k <= 15000; k += 250) {
      for (const c of kelvinToRgb(k)) {
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('specColor', () => {
  it('lets an explicit colour win over kelvin and inheritance', () => {
    const color: RGB = [0.1, 0.2, 0.3];
    expect(specColor({ color, kelvin: 2400, colorFromPreset: true }, [1, 1, 1])).toBe(color);
  });

  it('inherits the preset colour only when marked and available', () => {
    expect(specColor({ colorFromPreset: true }, [0.5, 0.6, 0.7])).toEqual([0.5, 0.6, 0.7]);
    expect(specColor({ colorFromPreset: true })).toEqual(kelvinToRgb(5600));
    expect(specColor({}, [0.5, 0.6, 0.7])).toEqual(kelvinToRgb(5600));
  });

  it('falls back to the kelvin of the spec, then to 5600 K', () => {
    expect(specColor({ kelvin: 2900 })).toEqual(kelvinToRgb(2900));
    expect(specColor({})).toEqual(kelvinToRgb(5600));
  });
});

describe('specIrradiance', () => {
  it('spreads an area light with the square of the distance', () => {
    expect(specIrradiance({ energy: 100, dist: 2, type: 'AREA' })).toBeCloseTo(100 / (16 * Math.PI), 12);
    expect(specIrradiance({ energy: 100, dist: 4 })).toBeCloseTo(100 / (64 * Math.PI), 12);
  });

  it('returns the energy of a sun, whatever its distance', () => {
    expect(specIrradiance({ energy: 7, dist: 5, type: 'SUN' })).toBe(7);
    expect(specIrradiance({ energy: 7, dist: 0.1, type: 'SUN' })).toBe(7);
  });

  it('reads share when there is no energy, and treats missing or zero distance as 1', () => {
    expect(specIrradiance({ share: 0.4, dist: 2 })).toBeCloseTo(0.4 / (16 * Math.PI), 12);
    expect(specIrradiance({ energy: 4 * Math.PI })).toBeCloseTo(1, 12);
    expect(specIrradiance({ energy: 4 * Math.PI, dist: 0 })).toBeCloseTo(1, 12);
    expect(specIrradiance({})).toBe(0);
    expect(specIrradiance({ share: 0.4, energy: 100, dist: 2 })).toBeCloseTo(100 / (16 * Math.PI), 12);
  });
});

describe('polar', () => {
  it('puts azimuth 0 on -Y, azimuth 90 on +X and elevation 90 on +Z', () => {
    const a = polar(0, 0, 1);
    expect(a[0]).toBeCloseTo(0, 12);
    expect(a[1]).toBeCloseTo(-1, 12);
    expect(a[2]).toBeCloseTo(0, 12);

    const b = polar(90, 0, 1);
    expect(b[0]).toBeCloseTo(1, 12);
    expect(b[1]).toBeCloseTo(0, 12);
    expect(b[2]).toBeCloseTo(0, 12);

    const c = polar(0, 90, 1);
    expect(c[0]).toBeCloseTo(0, 12);
    expect(c[1]).toBeCloseTo(0, 12);
    expect(c[2]).toBeCloseTo(1, 12);
  });

  it('scales with the distance and has that distance as its length', () => {
    const p = polar(-35, 22, 4.5);
    expect(Math.hypot(...p)).toBeCloseTo(4.5, 12);
    expect(p[0]).toBeLessThan(0); // camera-left
    expect(p[1]).toBeLessThan(0); // in front of the part, on the -Y side
    expect(p[2]).toBeCloseTo(4.5 * Math.sin((22 * Math.PI) / 180), 12);
  });

  it('puts azimuth 180 behind the part, on +Y', () => {
    const p = polar(180, 0, 2);
    expect(p[0]).toBeCloseTo(0, 12);
    expect(p[1]).toBeCloseTo(2, 12);
  });
});

describe('toWorldAzimuth', () => {
  it('adds the camera azimuth', () => {
    expect(CAMERA_AZIMUTH_DEG).toBe(-35);
    expect(toWorldAzimuth(0)).toBe(-35);
    expect(toWorldAzimuth(-5)).toBe(-40);
    expect(toWorldAzimuth(180)).toBe(145);
    // Not wrapped: -165 + -35 stays -200.
    expect(toWorldAzimuth(-165)).toBe(-200);
  });

  it('puts a camera-relative 0 on the camera itself', () => {
    const light = polar(toWorldAzimuth(0), 0, 1);
    const camera = polar(CAMERA_AZIMUTH_DEG, 0, 1);
    expect(light[0]).toBeCloseTo(camera[0], 12);
    expect(light[1]).toBeCloseTo(camera[1], 12);
  });
});

describe('ease', () => {
  it('returns 0 at 0 and 1 at 1 for every mode', () => {
    for (const mode of MODES) {
      expect(ease(0, mode), mode).toBe(0);
      expect(ease(1, mode), mode).toBe(1);
    }
  });

  it('clamps outside 0..1 and turns NaN into 0', () => {
    for (const mode of MODES) {
      expect(ease(-3, mode), mode).toBe(0);
      expect(ease(7, mode), mode).toBe(1);
      expect(ease(Number.NaN, mode), mode).toBe(0);
      expect(ease(Number.POSITIVE_INFINITY, mode), mode).toBe(1);
      expect(ease(Number.NEGATIVE_INFINITY, mode), mode).toBe(0);
    }
    expect(ease(Number.NaN, 'EASE')).toBe(0);
  });

  it('is symmetric at the midpoint for the smooth curves', () => {
    expect(ease(0.5, 'EASE')).toBe(0.5);
    expect(ease(0.5, 'LINEAR')).toBe(0.5);
    expect(ease(0.5, 'EASE_STRONG')).toBe(0.5);
  });

  it('matches the closed forms', () => {
    expect(ease(0.25, 'LINEAR')).toBe(0.25);
    expect(ease(0.25, 'EASE')).toBeCloseTo(0.15625, 12); // 3t^2 - 2t^3
    expect(ease(0.5, 'EASE_IN')).toBe(0.25); // t^2
    expect(ease(0.5, 'EASE_OUT')).toBe(0.75); // 1 - (1 - t)^2
    expect(ease(0.25, 'EASE_STRONG')).toBeCloseTo(0.103515625, 12); // 6t^5 - 15t^4 + 10t^3
  });

  it('is monotonic for every mode', () => {
    for (const mode of MODES) {
      let previous = 0;
      for (let i = 1; i <= 100; i++) {
        const v = ease(i / 100, mode);
        expect(v, `${mode} @ ${i / 100}`).toBeGreaterThanOrEqual(previous);
        previous = v;
      }
    }
  });

  it('falls back to linear for an unknown mode', () => {
    expect(ease(0.3, 'NOPE' as EasingKind)).toBe(0.3);
  });
});
