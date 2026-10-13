// The split-compare component's pure parts (phase U5, UI.md §2.8): divider clamping, arrow keys,
// pointer position, fit and zoom about a point.

import { describe, expect, it } from 'vitest';
import { clampSplit, fitView, SPLIT_STEP, SPLIT_STEP_BIG, splitAt, stepSplit, zoomAt } from '../src/ui/components/split-compare';
import { formatHms, parseHms } from '../src/ui/components/controls';

describe('split divider', () => {
  it('stays inside the frame', () => {
    expect(clampSplit(-0.2)).toBe(0);
    expect(clampSplit(1.7)).toBe(1);
    expect(clampSplit(0.4)).toBe(0.4);
    expect(clampSplit(Number.NaN)).toBe(0.5);
  });

  it('moves with ← → by 1 %, with ⇧ by 10 %, and stops at the edges', () => {
    expect([SPLIT_STEP, SPLIT_STEP_BIG]).toEqual([0.01, 0.1]);
    expect(stepSplit(0.5, 'ArrowRight', false)).toBe(0.51);
    expect(stepSplit(0.5, 'ArrowLeft', false)).toBe(0.49);
    expect(stepSplit(0.5, 'ArrowRight', true)).toBe(0.6);
    expect(stepSplit(0.05, 'ArrowLeft', true)).toBe(0);
    expect(stepSplit(0.995, 'ArrowRight', false)).toBe(1);
    expect(stepSplit(0.3, 'Home', false)).toBe(0);
    expect(stepSplit(0.3, 'End', false)).toBe(1);
    expect(stepSplit(0.3, 'a', false)).toBe(0.3);
    // Steps never accumulate floating point dust.
    let p = 0;
    for (let i = 0; i < 37; i++) p = stepSplit(p, 'ArrowRight', false);
    expect(p).toBe(0.37);
  });

  it('follows the pointer, clamped', () => {
    expect(splitAt(150, 100, 200)).toBe(0.25);
    expect(splitAt(50, 100, 200)).toBe(0);
    expect(splitAt(400, 100, 200)).toBe(1);
    expect(splitAt(10, 0, 0)).toBe(0.5);
  });
});

describe('zoom and fit', () => {
  it('fits an image centred, never past 100 %', () => {
    expect(fitView(1920, 1080, 960, 1080)).toEqual({ scale: 0.5, x: 0, y: 270 });
    expect(fitView(100, 50, 400, 400)).toEqual({ scale: 1, x: 150, y: 175 });
  });

  it('zooms about a point that stays put, within limits', () => {
    const v = zoomAt({ scale: 1, x: 0, y: 0 }, 2, 100, 50);
    expect(v).toEqual({ scale: 2, x: -100, y: -50 });
    // The image point under (100, 50) is the same before and after.
    expect((100 - v.x) / v.scale).toBe(100);
    expect(zoomAt({ scale: 30, x: 0, y: 0 }, 4, 0, 0).scale).toBe(32);
    expect(zoomAt({ scale: 0.03, x: 0, y: 0 }, 0.1, 0, 0).scale).toBe(0.02);
  });
});

describe('the time field', () => {
  it('reads hh:mm:ss, mm:ss and seconds; writes hh:mm:ss', () => {
    expect(parseHms('00:02:00')).toBe(120);
    expect(parseHms('1:30')).toBe(90);
    expect(parseHms('90')).toBe(90);
    expect(parseHms('1:00:05')).toBe(3605);
    expect(parseHms('')).toBeNull();
    expect(parseHms('a:b')).toBeNull();
    expect(parseHms('1:2:3:4')).toBeNull();
    expect(formatHms(3605)).toBe('01:00:05');
    expect(formatHms(59.6)).toBe('00:01:00');
  });
});
