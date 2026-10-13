// Pixels and print size with their DPI (phase U5, UI.md §2.7): pixels rule.

import { describe, expect, it } from 'vitest';
import {
  clampDpi,
  dpiFromPixelsPerMetre,
  lockedSide,
  matchPrintPreset,
  pixelsFor,
  pixelsPerMetre,
  printLength,
  printPresetPixels,
  PRINT_PRESETS,
} from '../src/core/print-size';
import { patchSettings, defaultRenderSettings } from '../src/core/render';

describe('px = size × dpi, both ways', () => {
  it('a print size gives pixels at the DPI, rounded to the nearest pixel', () => {
    expect(pixelsFor(210, 'MM', 300)).toBe(2480); // 2480.31
    expect(pixelsFor(297, 'MM', 300)).toBe(3508); // 3507.87
    expect(pixelsFor(21, 'CM', 300)).toBe(2480);
    expect(pixelsFor(8.5, 'IN', 300)).toBe(2550);
    expect(pixelsFor(10, 'CM', 72)).toBe(283); // 283.46
    expect(pixelsFor(0.001, 'MM', 300)).toBe(1); // at least one pixel
  });

  it('pixels give a print size at the DPI; going back gives the same pixels', () => {
    expect(printLength(2550, 300, 'IN')).toBeCloseTo(8.5, 10);
    expect(printLength(2480, 300, 'MM')).toBeCloseTo(209.97, 2);
    expect(printLength(1920, 72, 'CM')).toBeCloseTo(67.73, 2);
    for (const px of [1, 17, 1080, 1920, 3508, 8192]) {
      for (const dpi of [72, 96, 150, 300, 600]) {
        for (const unit of ['MM', 'CM', 'IN'] as const) expect(pixelsFor(printLength(px, dpi, unit), unit, dpi)).toBe(px);
      }
    }
  });

  it('changing the DPI leaves the pixels and moves the print size', () => {
    let s = patchSettings(defaultRenderSettings(), { width: 2400, height: 1200 });
    expect(printLength(s.width, s.dpi, 'IN')).toBe(8);
    s = patchSettings(s, { dpi: 150 });
    expect([s.width, s.height, s.dpi]).toEqual([2400, 1200, 150]);
    expect(printLength(s.width, s.dpi, 'IN')).toBe(16);
  });

  it('typing a print width sets the pixels at the current DPI, and the lock moves the other side', () => {
    let s = patchSettings(defaultRenderSettings(), { width: 3000, height: 2000, dpi: 300 });
    s = patchSettings(s, { width: pixelsFor(5, 'IN', s.dpi) });
    expect([s.width, s.height]).toEqual([1500, 1000]);
    s = patchSettings(s, { aspectLock: false });
    s = patchSettings(s, { height: pixelsFor(10, 'CM', s.dpi) });
    expect([s.width, s.height]).toEqual([1500, 1181]);
  });

  it('the lock rounds to the nearest pixel from the locked ratio', () => {
    expect(lockedSide('width', 1000, 16 / 9)).toBe(563);
    expect(lockedSide('height', 563, 16 / 9)).toBe(1001);
    expect(lockedSide('width', 7, 0)).toBe(7);
  });

  it('the DPI is clamped and stored as a whole number; pHYs uses pixels per metre', () => {
    expect(clampDpi(299.6)).toBe(300);
    expect(clampDpi(0)).toBe(1);
    expect(clampDpi(1e9)).toBe(9600);
    expect(clampDpi(Number.NaN)).toBe(300);
    expect(pixelsPerMetre(300)).toBe(11811);
    expect(pixelsPerMetre(72)).toBe(2835);
    for (const dpi of [1, 72, 96, 150, 300, 600, 1200, 2400]) expect(dpiFromPixelsPerMetre(pixelsPerMetre(dpi))).toBe(dpi);
  });

  it('print presets: A4, A3, Letter and 10 × 15 cm at 300 DPI, in either orientation', () => {
    expect(PRINT_PRESETS.map((p) => p.key)).toEqual(['A4', 'A3', 'LETTER', 'PHOTO_10X15']);
    const px = (key: string, landscape: boolean) => printPresetPixels(PRINT_PRESETS.find((p) => p.key === key)!, landscape);
    expect(px('A4', false)).toEqual({ width: 2480, height: 3508, dpi: 300 });
    expect(px('A4', true)).toEqual({ width: 3508, height: 2480, dpi: 300 });
    expect(px('A3', false)).toEqual({ width: 3508, height: 4961, dpi: 300 });
    expect(px('LETTER', false)).toEqual({ width: 2550, height: 3300, dpi: 300 });
    expect(px('PHOTO_10X15', true)).toEqual({ width: 1772, height: 1181, dpi: 300 });
    expect(matchPrintPreset(2480, 3508, 300)?.key).toBe('A4');
    expect(matchPrintPreset(3508, 2480, 300)?.key).toBe('A4');
    expect(matchPrintPreset(2480, 3508, 150)).toBeUndefined();
  });
});
