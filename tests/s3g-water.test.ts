// S3g: water that reads as water, in the page. Fast draws a hanging drop as the engine does now (its contact line
// stays where it is, it thins above it and stretches along gravity by what keeps its volume: `hangStretch`, the twin of
// rt-core `weather::hang_stretch`); the record's key says the simulation it holds (format 5: a runner leaves its trail
// and no beads, and a drop's outline keeps its contact area), so a recording of before is simulated again.

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { PARTS_FORMAT_VERSION, wetPartsKey } from '../src/core/wet-parts';
import { capGeometry, hangStretch, localShape, SHAPED_CAP_RINGS, shapePointLocal } from '../src/render/weather-preview';
import { STRINGS } from '../src/ui/strings';

/** A drop hanging under a ceiling (gravity along the cap's outward normal), stretched and pinched. */
const HANGING = [0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0.9, 0.4];

describe('S3g: a hanging drop in Fast', () => {
  it('keeps its contact line where it is and its volume, and stretches along gravity', () => {
    const s = localShape(HANGING, new THREE.Quaternion(), new THREE.Vector3(0, 0, 1), 60);
    const g = capGeometry(60, SHAPED_CAP_RINGS);
    const pos = g.getAttribute('position');
    const index = g.getIndex()!;
    const points = Array.from({ length: pos.count }, (_, i) => [pos.getX(i), pos.getY(i), pos.getZ(i)]);
    const moved = points.map((p) => shapePointLocal(p, s));
    // The ring where the cap meets its surface (z = 0) does not move.
    let ring = 0;
    points.forEach((p, i) => {
      if (Math.abs(p[2]) < 1e-9) {
        ring++;
        for (let k = 0; k < 3; k++) expect(moved[i][k]).toBeCloseTo(p[k], 9);
      }
    });
    expect(ring).toBeGreaterThan(8);
    const volume = (p: number[][]) => {
      let sum = 0;
      for (let t = 0; t < index.count; t += 3) {
        const [a, b, c] = [p[index.getX(t)], p[index.getX(t + 1)], p[index.getX(t + 2)]];
        sum += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
      }
      return Math.abs(sum);
    };
    expect(volume(moved) / volume(points)).toBeCloseTo(1, 1);
    // Longer along gravity than the round cap is tall.
    const tall = (p: number[][]) => Math.max(...p.map((v) => v[2]));
    expect(tall(moved)).toBeGreaterThan(1.3 * tall(points));
    g.dispose();
  });

  it('its stretch along gravity is what keeps the volume of a paraboloid cap (the engine’s formula)', () => {
    for (const [sag, pinch] of [
      [0.6, 0],
      [0.9, 0.4],
      [2, 0.8],
    ]) {
      const [b, c, kt] = hangStretch(sag, pinch);
      expect(b).toBeCloseTo(1 / Math.sqrt(1 + sag) - 1, 12);
      let v = 0;
      const n = 20000;
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n;
        const w = (1 - 4 * c * t * (1 - t)) * (1 + b * t);
        v += (2 * (1 - t) * w * w) / n;
      }
      expect(v * kt).toBeCloseTo(1, 6);
    }
  });
});

describe('S3g: the record of a run', () => {
  it('format 5: a recording of before is simulated again', () => {
    expect(PARTS_FORMAT_VERSION).toBe(5);
    expect(wetPartsKey(new Uint8Array(8)).startsWith('wpt5:')).toBe(true);
  });

  it('the effect’s tip says what a runner leaves, in English and in Spanish', () => {
    const en = STRINGS.en['ambient.wetPartsTip.DROPS'];
    const es = STRINGS.es['ambient.wetPartsTip.DROPS'];
    expect(en).toContain('leave a wet streak');
    expect(es).toContain('dejan un rastro mojado');
    expect(en).not.toContain('rivulet');
  });
});
