// 3MF: a package written in the test (stored zip, minimal XML): two objects
// with base materials as two build items, the second moved by a build
// transform. Three's ThreeMFLoader needs a DOMParser, which Node lacks:
// tests/dom-shim.ts is a small XML DOM (the browser check runs the real one).

import { beforeAll, describe, expect, it } from 'vitest';
import { describePayload } from '../src/core/import-options';
import { detectFormat, importFile } from '../src/io/import';
import { threeMfUnit } from '../src/io/threemf';
import { installDomShim } from './dom-shim';
import { colorOf, meshOf, partsOf, readWithDefaults } from './io-helpers';
import { buildThreeMf } from './threemf-fixture';
import { zipStored } from './zip';

beforeAll(installDomShim);

const close = (got: readonly number[], want: readonly number[], digits = 4) => want.forEach((w, i) => expect(got[i], `[${i}]`).toBeCloseTo(w, digits));
const srgb = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const read = (unit: string | null = 'inch') => importFile({ name: 'two.3mf', bytes: buildThreeMf(unit) });

describe('3MF: the package as it comes', () => {
  it('gives one part for each build item, no groups: parts, groups, triangles, materials', async () => {
    const r = await read();
    expect(r.format).toBe('3MF');
    expect(describePayload(r)).toEqual({ parts: 2, groups: 0, triangles: 24, materials: 2 });
    const model = r.nodes[r.roots[0]];
    expect(model).toMatchObject({ kind: 'MODEL', name: 'two', source: { kind: 'FILE', name: 'two.3mf', format: '3MF' } });
    const parts = partsOf(r);
    expect(parts.map((p) => p.name)).toEqual(['Body', 'Cap']);
    // 12 triangles over 8 corners: welded, then split along the 12 hard edges.
    for (const p of parts) {
      expect(p.mesh).toMatchObject({ vertices: 24, triangles: 12 });
      expect(meshOf(p).sharpEdges!.length / 2).toBe(12);
    }
    expect(r.warnings).toEqual([]);
    expect(r.notes).toEqual([]);
  });

  it('keeps the build transform: the cap sits on top of the body', async () => {
    const [body, cap] = partsOf(await read());
    // In the units of the file (inches): body 1 x 1 x 2 from the origin, cap 0.5 x 0.5 x 0.25 at (0.25, 0.25, 2).
    close(body.mesh!.bounds.max, [0.5, 0.5, 1]);
    close(body.transform.position, [0.5, 0.5, 1]);
    close(cap.mesh!.bounds.max, [0.25, 0.25, 0.125]);
    close(cap.transform.position, [0.5, 0.5, 2.125]);
  });

  it('turns the base materials into SIMPLE instances with their display colour', async () => {
    const r = await read();
    const [steel, brass] = Object.values(r.materials);
    expect([steel.name, brass.name]).toEqual(['Steel', 'Brass']);
    expect(steel.family).toBe('SIMPLE');
    close(colorOf(steel), [srgb(0xcc / 255), srgb(0x33 / 255), srgb(0x20 / 255), 1], 3);
    close(colorOf(brass), [srgb(0xb5 / 255), srgb(0xa6 / 255), srgb(0x42 / 255), 1], 3);
    expect(steel.params.roughness).toBe(0.5);
    const [body, cap] = partsOf(r);
    expect([r.materials[body.material!].name, r.materials[cap.material!].name]).toEqual(['Steel', 'Brass']);
  });

  it('is Z up and says its unit: inches here', async () => {
    const r = await read();
    expect(r.detected).toEqual({ units: 'in', upAxis: 'Z', upAxisDeclared: true, size: 2.25, hasLayers: false, hiddenParts: 0 });
  });
});

describe('3MF: units', () => {
  it('maps the unit attribute: millimetre when absent, centimetre, metre, inch', async () => {
    expect((await read(null)).detected.units).toBe('mm');
    expect((await read('millimeter')).detected.units).toBe('mm');
    expect((await read('centimeter')).detected.units).toBe('cm');
    expect((await read('meter')).detected.units).toBe('m');
    expect((await read('inch')).detected.units).toBe('in');
  });

  it('says so for micron and foot, which the sheet does not offer', async () => {
    for (const unit of ['micron', 'foot']) {
      const r = await read(unit);
      expect(r.detected).toMatchObject({ units: null, unsupportedUnit: unit });
      expect(r.notes).toEqual([{ code: 'unitsUnsupported', params: { unit } }]);
    }
  });

  it('inches become millimetres: 25.4 x 25.4 x 50.8 for the body', async () => {
    const r = await readWithDefaults({ name: 'two.3mf', bytes: buildThreeMf('inch') });
    expect(r.options.units).toBe('in');
    const [body, cap] = partsOf(r);
    close(body.mesh!.bounds.max, [12.7, 12.7, 25.4], 3);
    close(body.transform.position, [12.7, 12.7, 25.4], 3);
    close(cap.transform.position, [12.7, 12.7, 2.125 * 25.4], 3);
    // The same file in millimetres is 25.4 times smaller.
    const mm = await readWithDefaults({ name: 'two.3mf', bytes: buildThreeMf('millimeter') });
    close(partsOf(mm)[0].mesh!.bounds.max, [0.5, 0.5, 1], 4);
  });

  it('reads the unit from the root model', () => {
    expect(threeMfUnit(buildThreeMf('micron').slice().buffer)).toBe('micron');
    expect(threeMfUnit(buildThreeMf(null).slice().buffer)).toBe('millimeter');
    expect(threeMfUnit(zipStored([['readme.txt', 'no model here']]).slice().buffer)).toBeNull();
  });
});

describe('3MF: detection and damage', () => {
  it('is found by extension and by the model inside the zip', () => {
    const pkg = buildThreeMf();
    expect(detectFormat('part.3MF', new Uint8Array(4))).toBe('3MF');
    expect(detectFormat('part.bin', pkg)).toBe('3MF');
    expect(detectFormat('part.bin', zipStored([['notes.txt', 'just a zip']]))).toBeNull();
  });

  it('says what is wrong with a file that is not a package', async () => {
    await expect(importFile({ name: 'x.3mf', bytes: zipStored([['readme.txt', 'no model']]) })).rejects.toThrow('not a 3MF package');
    await expect(importFile({ name: 'x.3mf', bytes: new TextEncoder().encode('not a zip') })).rejects.toThrow();
  });
});
