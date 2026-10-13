// Phase E5c on the interface side: the physical sky of the preview (core/sky.ts) against the engine's
// (tests/fixtures/sky-physical.json, written by `rt-sky fixture` from rt-core's `sky_image`, which a test of
// rt-sky keeps current), the table it reads (core/sky-table.ts, the same f32 values and hash as rt-core's
// sky_table.rs), the Model choice in the state, the project file, the studio library and the RSB.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { sha256Hex } from '../src/core/sha256';
import { panoramaDirection, physicalSky, preetham, SKY_HEIGHT, SKY_WIDTH, skyImage } from '../src/core/sky';
import { SKY_COEFFICIENTS, SKY_RADIANCE, SKY_TABLE_SHA256 } from '../src/core/sky-table';
import { createInitialState } from '../src/core/store';
import { loadProject, serializeProject } from '../src/io/project';
import { projectScene, SKY_MODEL_CLASSIC, SKY_MODEL_PHYSICAL, writeRsb } from '../src/io/rsb';
import { apply, exampleState } from './helpers';
import { readRsb } from './rsb-reader';

interface FixtureSky {
  azimuth: number;
  elevation: number;
  turbidity: number;
  floor: number;
  horizon: number;
  zenith: number;
  strength: number;
  scale: number;
  pixels: [number, number, number, number, number][];
}
const fixture = JSON.parse(readFileSync('tests/fixtures/sky-physical.json', 'utf8')) as { table_sha256: string; width: number; height: number; skies: FixtureSky[] };
const lum = (c: readonly number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const dir = (azDeg: number, elDeg: number) => {
  const r = Math.PI / 180;
  return [Math.cos(elDeg * r) * Math.cos(azDeg * r), Math.cos(elDeg * r) * Math.sin(azDeg * r), Math.sin(elDeg * r)];
};

describe('the physical sky of the preview', () => {
  it('reads the engine’s table: the same values and hash as rt-core’s sky_table.rs', () => {
    expect(SKY_COEFFICIENTS.length).toBe(10 * 2 * 3 * 6 * 9);
    expect(SKY_RADIANCE.length).toBe(10 * 2 * 3 * 6);
    const bytes = new Uint8Array(4 * (SKY_COEFFICIENTS.length + SKY_RADIANCE.length));
    const view = new DataView(bytes.buffer);
    [...SKY_COEFFICIENTS, ...SKY_RADIANCE].forEach((v, i) => view.setFloat32(4 * i, v, true));
    expect(sha256Hex(bytes)).toBe(SKY_TABLE_SHA256);
    const rust = readFileSync('engine/crates/rt-core/src/sky_table.rs', 'utf8');
    expect(rust).toContain(`pub const SHA256: &str = "${SKY_TABLE_SHA256}";`);
    expect(fixture.table_sha256).toBe(SKY_TABLE_SHA256);
  });

  it('is the engine’s, bit for bit (rt-core environment.rs `sky_image` in f32; core/f32math.ts emulates its arithmetic)', () => {
    expect([fixture.width, fixture.height]).toEqual([SKY_WIDTH, SKY_HEIGHT]);
    let checked = 0;
    for (const s of fixture.skies) {
      const rgb = skyImage({ model: 'PHYSICAL', sunAzimuthDeg: s.azimuth, sunElevationDeg: s.elevation, turbidity: s.turbidity, floor: s.floor, horizon: s.horizon, zenith: s.zenith, strength: s.strength });
      for (const [x, y, ...c] of s.pixels) {
        const i = 3 * (y * SKY_WIDTH + x);
        // The fixture prints each f32 as its shortest decimal: read back as f32, it is that value exactly.
        for (let k = 0; k < 3; k++) {
          expect(rgb[i + k], `sky ${s.azimuth}/${s.elevation}/${s.turbidity}, pixel ${x}, ${y}, channel ${k}`).toBe(Math.fround(c[k]));
          checked++;
        }
      }
    }
    expect(checked).toBe(6 * (22 * 16 + 2) * 3);
  });

  it('is blue at the zenith, brightest around the sun, whiter when hazy, and its turbidity and albedo are linear between knots', () => {
    const sky = physicalSky(0, 20, 3);
    const zenith = sky([0, 0, 1]);
    const away = sky(dir(180, 5));
    expect(zenith[2]).toBeGreaterThan(zenith[0] * 1.3);
    expect(lum(sky(dir(0, 23)))).toBeGreaterThan(3 * lum(zenith));
    expect(zenith[2] / zenith[0]).toBeGreaterThan(away[2] / away[0]);
    expect(sky(dir(10, -3))).toEqual([0, 0, 0]);
    const hazy = physicalSky(0, 20, 8)([0, 0, 1]);
    expect(hazy[2] / hazy[0]).toBeLessThan(zenith[2] / zenith[0]);
    // A quarter of the way between two turbidities (and two albedos) is the weighted mean of their radiances.
    for (const d of [[0, 0, 1], dir(40, 30), dir(170, 2)]) {
      const mid = physicalSky(30, 12, 4.25, 0.2)(d);
      const a = physicalSky(30, 12, 4, 0.2)(d);
      const b = physicalSky(30, 12, 5, 0.2)(d);
      // (f32 arithmetic, as the engine's: equal to a few units in the last place.)
      for (let k = 0; k < 3; k++) expect(Math.abs(mid[k] / (0.75 * a[k] + 0.25 * b[k]) - 1)).toBeLessThan(1e-6);
      const white = physicalSky(30, 12, 4, 1)(d);
      const black = physicalSky(30, 12, 4, 0)(d);
      for (let k = 0; k < 3; k++) expect(Math.abs(a[k] / (0.8 * black[k] + 0.2 * white[k]) - 1)).toBeLessThan(1e-6);
    }
  });

  it('the classic sky is still there and differs from the physical one', () => {
    const p = { sunAzimuthDeg: -40, sunElevationDeg: 35, turbidity: 3, floor: 0.12, horizon: 0.45, zenith: 0.85, strength: 1 };
    const physical = skyImage({ ...p, model: 'PHYSICAL' });
    const classic = skyImage({ ...p, model: 'CLASSIC' });
    expect(skyImage(p)).toEqual(physical); // the default
    const c = preetham(-40, 35, 3)(panoramaDirection(0, 0, SKY_WIDTH, SKY_HEIGHT));
    expect(classic[0] / classic[2]).toBeCloseTo(c[0] / c[2], 6);
    let differ = 0;
    for (let i = 0; i < physical.length; i++) if (Math.abs(physical[i] / classic[i] - 1) > 0.02) differ++;
    expect(differ).toBeGreaterThan(physical.length / 4);
  });
});

describe('the sky model in the project', () => {
  it('is PHYSICAL for a new project, and for a project saved before it existed', async () => {
    expect(createInitialState().environment.skyModel).toBe('PHYSICAL');
    const body = JSON.parse(await serializeProject(createInitialState()).text());
    delete body.state.environment.skyModel;
    expect(loadProject(JSON.stringify(body)).state.environment.skyModel).toBe('PHYSICAL');
    body.state.environment.skyModel = 'CLASSIC';
    expect(loadProject(JSON.stringify(body)).state.environment.skyModel).toBe('CLASSIC');
    body.state.environment.skyModel = 'HOSEK';
    expect(() => loadProject(JSON.stringify(body))).toThrow(/skyModel/);
  });

  it('is undoable, and goes to the engine as ENVR.sky_model (0 physical, 1 classic) after the E5 fields', () => {
    const s = apply(exampleState(), { type: 'studio/setSetup', key: 'SUN' });
    expect(s.environment.kind).toBe('SKY');
    const view = { width: 64, height: 48, maxSamples: 1, maxSeconds: 0 };
    const physical = readRsb(writeRsb(projectScene(s, view).scene)).environment!;
    expect(physical.skyModel).toBe(SKY_MODEL_PHYSICAL);
    const c = apply(s, { type: 'env/set', patch: { skyModel: 'CLASSIC' } });
    const classic = readRsb(writeRsb(projectScene(c, view).scene)).environment!;
    expect(classic.skyModel).toBe(SKY_MODEL_CLASSIC);
    expect({ ...classic, skyModel: SKY_MODEL_PHYSICAL }).toEqual(physical);
    // The physical sky takes turbidity down to 1; the classic one clamps itself at 1.7.
    const clean = apply(s, { type: 'env/set', patch: { skyTurbidity: 1 } });
    expect(projectScene(clean, view).scene.environment.skyTurbidity).toBe(1);
  });
});
