// The passes of the image state (K3, core/image-passes.ts): the automatic exposure's meter, the compensation, the
// brightness presets and the meter of a progressive image.

import { describe, expect, it } from 'vitest';
import { AUTO_EV_LIMIT, EV100_AT_ZERO, EXPOSURE_PRESETS } from '../src/data/interior-camera';
import { APPLIED_PASSES, autoExposure, effectiveExposure, ExposureMeter, IMAGE_PASSES, meterExposure, presetExposure, type MeterSource } from '../src/core/image-passes';

/** An image of `lum` (one grey per pixel, linear), each pixel with `samples` samples summed. */
function image(lum: readonly number[], samples: number | ((p: number) => number) = 1, width = lum.length): MeterSource {
  const sum = new Float32Array(lum.length * 4);
  const at = typeof samples === 'number' ? () => samples : samples;
  lum.forEach((l, p) => {
    const n = at(p);
    sum.set([l * n, l * n, l * n, n], p * 4);
  });
  return { width, height: lum.length / width, sum, samplesAt: at };
}

const grey = (l: number, n = 100) => Array.from({ length: n }, () => l);

describe('the automatic exposure (the meter)', () => {
  it('puts a uniform image at middle grey, to a hundredth of a stop', () => {
    expect(meterExposure(image(grey(0.045)))).toBe(2);
    expect(meterExposure(image(grey(0.72)))).toBe(-2);
    expect(meterExposure(image(grey(0.18)))).toBe(0);
    // A hundredth of a stop, and a value a decimal prints as it is.
    const v = meterExposure(image(grey(0.1)))!;
    expect(v).toBe(0.85);
    expect(String(v)).toBe('0.85');
  });

  it('reads the mean of each pixel’s samples, not their sum', () => {
    expect(meterExposure(image(grey(0.045), 16))).toBe(2);
    expect(meterExposure(image(grey(0.045), (p) => 1 + (p % 7)))).toBe(2);
  });

  it('leaves out the darkest tenth and the brightest twentieth (black corners, windows, lamps)', () => {
    // 100 pixels: 10 black, 5 a thousand times too bright, the rest at 0.045 — the same reading as the rest alone.
    const lum = [...grey(0, 10), ...grey(45, 5), ...grey(0.045, 85)];
    expect(meterExposure(image(lum))).toBe(2);
    // One black pixel more than the tenth is metered (at the floor), and moves the reading.
    const darker = [...grey(0, 11), ...grey(45, 5), ...grey(0.045, 84)];
    expect(meterExposure(image(darker))!).toBeGreaterThan(2);
    // One bright pixel more than the twentieth, too.
    const brighter = [...grey(0, 10), ...grey(45, 6), ...grey(0.045, 84)];
    expect(meterExposure(image(brighter))!).toBeLessThan(2);
  });

  it('is the mean of the logs (a geometric mean), not the log of the mean', () => {
    // About half at 0.01 and half at 1 inside the trims: the mean of their logs, far from the log of their mean (0.5).
    const lum = [...grey(0.0001, 10), ...grey(0.01, 43), ...grey(1, 42), ...grey(100, 5)];
    const want = Math.log2(0.18) - (43 * Math.log2(0.01)) / 85;
    expect(meterExposure(image(lum))).toBeCloseTo(want, 2);
    expect(Math.abs(want - Math.log2(0.18 / ((43 * 0.01 + 42) / 85)))).toBeGreaterThan(2);
  });

  it('does not depend on the order of the pixels, and the same image gives the same bits', () => {
    const lum = Array.from({ length: 400 }, (_, i) => ((i * 7919) % 401) / 97);
    const a = meterExposure(image(lum, 1, 20));
    const b = meterExposure(image([...lum].reverse(), 1, 20));
    expect(a).not.toBeNull();
    expect(b).toBe(a);
  });

  it('is clamped to ±16 stops, says nothing for an image without samples, and skips pixels without any', () => {
    expect(meterExposure(image(grey(0)))).toBe(AUTO_EV_LIMIT);
    expect(meterExposure(image(grey(1e9)))).toBe(-AUTO_EV_LIMIT);
    expect(meterExposure(image(grey(0.045), 0))).toBeNull();
    expect(meterExposure(image([...grey(0.045, 50), ...grey(9, 50)], (p) => (p < 50 ? 4 : 0)))).toBe(2);
  });

  it('weighs the channels as luminance (Rec. 709)', () => {
    const one = (r: number, g: number, b: number): MeterSource => ({ width: 1, height: 1, sum: new Float32Array([r, g, b, 1]), samplesAt: () => 1 });
    expect(meterExposure(one(0.18 / 0.2126, 0, 0))).toBe(0);
    expect(meterExposure(one(0, 0.18 / 0.7152, 0))).toBe(0);
    expect(meterExposure(one(0, 0, 0.18 / 0.0722))).toBe(0);
  });
});

describe('the exposure the image is converted with', () => {
  it('by hand is exposureEv; automatic is the reading plus the compensation, or the compensation alone before one', () => {
    expect(autoExposure({})).toBe(false);
    expect(autoExposure({ exposureMode: 'AUTO' })).toBe(true);
    expect(effectiveExposure({ exposureEv: 1.5 }, 3)).toBe(1.5);
    expect(effectiveExposure({ exposureEv: 1.5, exposureMode: 'MANUAL' }, 3)).toBe(1.5);
    expect(effectiveExposure({ exposureEv: 0.5, exposureMode: 'AUTO' }, 3)).toBe(3.5);
    expect(effectiveExposure({ exposureEv: 0.5, exposureMode: 'AUTO' }, null)).toBe(0.5);
  });

  it('a brightness preset is its EV100 against the engine’s exposure 0, by hand', () => {
    expect(EXPOSURE_PRESETS.map((p) => [p.key, p.ev100])).toEqual([
      ['BRIGHT_DAY', 7],
      ['LAMP_EVENING', 5],
    ]);
    expect(EV100_AT_ZERO).toBeCloseTo(Math.log2(683 / 1.2), 12);
    expect(presetExposure('BRIGHT_DAY')).toBe(2.15);
    expect(presetExposure('LAMP_EVENING')).toBe(4.15);
    expect(presetExposure('NOPE')).toBeNull();
  });

  it('the passes of the image state keep their order, and two of them are applied', () => {
    expect(IMAGE_PASSES).toEqual(['exposure', 'bloom', 'sharpen', 'color', 'vignette', 'curve']);
    expect([...APPLIED_PASSES]).toEqual(['exposure', 'curve']);
  });
});

describe('the meter of a progressive image', () => {
  it('meters again only when the samples double, a new image at once, and keeps the last reading meanwhile', () => {
    const m = new ExposureMeter();
    let calls = 0;
    const make = (v: number | null) => () => {
      calls++;
      return v;
    };
    const a = {};
    expect(m.read(a, 0, make(1))).toBeNull();
    expect(calls).toBe(0);
    expect(m.read(a, 1, make(1))).toBe(1);
    expect(m.read(a, 1, make(2))).toBe(1);
    expect(m.read(a, 2, make(2))).toBe(2);
    expect(m.read(a, 3, make(3))).toBe(2);
    expect(m.read(a, 4, make(4))).toBe(4);
    expect(calls).toBe(3);
    // A new image is metered at once; one that reads nothing keeps the last reading.
    const b = {};
    expect(m.read(b, 1, make(null))).toBe(4);
    expect(m.read(b, 1, make(5))).toBe(5);
    expect(m.last).toBe(5);
    m.clear();
    expect(m.last).toBeNull();
  });
});
