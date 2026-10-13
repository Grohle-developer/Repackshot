// The circle of confusion of the `coc` pass on the cases both sides read (tests/fixtures/lens-coc.json, phase
// X2): src/core/lens-coc.ts gives the fixture's values exactly, and the engine's `rt_core::passes::coc_diameter`
// agrees within 1e-5 (engine/crates/rt-core/src/render/passes_tests.rs), so the Fast-mode preview's passes and
// the engine's blur the same way.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cocDiameter, type LensParams } from '../src/core/lens-coc';

const FIXTURE = JSON.parse(readFileSync('tests/fixtures/lens-coc.json', 'utf8')) as { columns: string[]; cases: number[][] };

describe('the circle of confusion on the shared fixture', () => {
  it('has the columns the engine reads, and enough cases', () => {
    expect(FIXTURE.columns).toEqual(['focalMm', 'fstop', 'focusDist', 'sensorMm', 'ortho', 'depth', 'longSide', 'coc']);
    expect(FIXTURE.cases.length).toBeGreaterThanOrEqual(10);
    // Zero and non-zero cases, in focus, out of focus on both sides, and every way to have no blur.
    expect(FIXTURE.cases.filter((c) => c[7] === 0).length).toBeGreaterThanOrEqual(5);
    expect(FIXTURE.cases.some((c) => c[5] < c[2] && c[7] > 0) && FIXTURE.cases.some((c) => c[5] > c[2] && c[7] > 0)).toBe(true);
  });

  it('is what lens-coc.ts computes', () => {
    for (const [focalMm, fstop, focusDist, sensorMm, ortho, depth, longSide, coc] of FIXTURE.cases) {
      const lens: LensParams = { focalMm, fstop, focusDist, sensorMm, ortho: ortho === 1 };
      expect(cocDiameter(lens, depth, longSide), JSON.stringify([focalMm, fstop, focusDist, depth, longSide])).toBe(coc);
    }
  });
});
