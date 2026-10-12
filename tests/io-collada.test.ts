// Collada: a hand-written .dae (two nodes in a group, one Phong material,
// inches, Z up). Three's ColladaLoader needs a DOMParser: see tests/dom-shim.ts.

import { beforeAll, describe, expect, it } from 'vitest';
import { describePayload } from '../src/core/import-options';
import { colladaAsset } from '../src/io/collada';
import { detectFormat, importFile } from '../src/io/import';
import { installDomShim } from './dom-shim';
import twoParts from './fixtures/two-parts.dae?raw';
import { colorOf, encode, meshOf, partsOf, readWithDefaults } from './io-helpers';

beforeAll(installDomShim);

const close = (got: readonly number[], want: readonly number[], digits = 4) => want.forEach((w, i) => expect(got[i], `[${i}]`).toBeCloseTo(w, digits));
const read = (text = twoParts) => importFile({ name: 'two-parts.dae', bytes: encode(text) });
const withUnit = (meter: string | null) => twoParts.replace(/<unit [^>]*\/>/, meter === null ? '' : `<unit name="u" meter="${meter}"/>`);

describe('DAE: the document as it comes', () => {
  it('keeps the node hierarchy: parts, groups, triangles, vertices, materials', async () => {
    const r = await read();
    expect(r.format).toBe('DAE');
    expect(describePayload(r)).toEqual({ parts: 2, groups: 1, triangles: 24, materials: 1 });
    const model = r.nodes[r.roots[0]];
    expect(model).toMatchObject({ kind: 'MODEL', name: 'two-parts', source: { kind: 'FILE', name: 'two-parts.dae', format: 'DAE' } });
    const [assembly] = model.children.map((c) => r.nodes[c]);
    expect([assembly.kind, assembly.name]).toEqual(['GROUP', 'Assembly']);
    const parts = assembly.children.map((c) => r.nodes[c]);
    expect(parts.map((p) => [p.kind, p.name])).toEqual([
      ['PART', 'Body'],
      ['PART', 'Cap'],
    ]);
    for (const p of parts) {
      expect(p.mesh).toMatchObject({ vertices: 24, triangles: 12 });
      expect(meshOf(p).sharpEdges!.length / 2).toBe(12);
    }
  });

  it('turns the Phong effect into a SIMPLE instance named after the material', async () => {
    const r = await read();
    const [steel] = Object.values(r.materials);
    expect(steel).toMatchObject({ name: 'Steel', family: 'SIMPLE' });
    close(colorOf(steel), [0.6038, 0.0331, 0.01, 1], 3);
    expect(steel.params.roughness).toBeCloseTo((2 / 52) ** 0.25, 6);
    expect(steel.params.metallic).toBe(0);
    const parts = Object.values(r.nodes).filter((n) => n.kind === 'PART');
    expect(parts.every((p) => p.material === 'tm1')).toBe(true);
  });

  it('keeps the numbers of the file: the loader scaled the scene and turned Z up, the reader takes both back', async () => {
    const r = await read();
    const [body, cap] = Object.values(r.nodes).filter((n) => n.kind === 'PART');
    // Inches, Z up: the body is 1 x 1 x 2, the cap 0.5 x 0.5 x 0.25 on top of it.
    close(body.mesh!.bounds.max, [0.5, 0.5, 1]);
    close(body.transform.position, [0, 0, 1]);
    close(cap.mesh!.bounds.max, [0.25, 0.25, 0.125]);
    close(cap.transform.position, [0, 0, 2.125]);
    expect(r.detected).toEqual({ units: 'in', upAxis: 'Z', upAxisDeclared: true, size: 2.25, hasLayers: false, hiddenParts: 0 });
  });

  it('with the detected defaults it is 25.4 mm wide and 57.15 mm tall', async () => {
    const r = await readWithDefaults({ name: 'two-parts.dae', bytes: encode(twoParts) });
    expect(r.options).toMatchObject({ units: 'in', upAxis: 'Z' });
    const [body, cap] = Object.values(r.nodes).filter((n) => n.kind === 'PART');
    close(body.mesh!.bounds.max, [12.7, 12.7, 25.4], 3);
    close(cap.transform.position, [0, 0, 2.125 * 25.4], 3);
    expect(partsOf(r)).toHaveLength(1); // the model holds the Assembly group
  });
});

describe('DAE: asset', () => {
  it('reads the unit and the up axis from the asset element', () => {
    expect(colladaAsset(twoParts)).toEqual({ meter: 0.0254, upAxis: 'Z_UP', upAxisDeclared: true });
    expect(colladaAsset('<COLLADA><asset></asset></COLLADA>')).toEqual({ meter: null, upAxis: 'Y_UP', upAxisDeclared: false });
    expect(colladaAsset('<COLLADA><asset><unit meter="0.01"/><up_axis>X_UP</up_axis></asset></COLLADA>')).toEqual({ meter: 0.01, upAxis: 'X_UP', upAxisDeclared: true });
    // Things named like the asset that are not in it do not count.
    expect(colladaAsset('<COLLADA><asset></asset><library><unit meter="5"/></library></COLLADA>').meter).toBeNull();
  });

  it('maps the unit: metre 0.001 mm, 0.01 cm, 1 m, 0.0254 inch; anything else is said', async () => {
    expect((await read(withUnit('0.001'))).detected.units).toBe('mm');
    expect((await read(withUnit('0.01'))).detected.units).toBe('cm');
    expect((await read(withUnit('1'))).detected.units).toBe('m');
    expect((await read(withUnit('0.0254'))).detected.units).toBe('in');
    expect((await read(withUnit(null))).detected.units).toBeNull();
    const feet = await read(withUnit('0.3048'));
    expect(feet.detected).toMatchObject({ units: null, unsupportedUnit: '0.3048 m' });
    expect(feet.notes).toEqual([{ code: 'unitsUnsupported', params: { unit: '0.3048 m' } }]);
  });

  it('Y_UP, or no up axis, is Y; Z_UP is Z, in either case with the numbers as written', async () => {
    const y = await read(twoParts.replace('Z_UP', 'Y_UP'));
    expect(y.detected).toMatchObject({ upAxis: 'Y', upAxisDeclared: true });
    const none = await read(twoParts.replace(/<up_axis>.*<\/up_axis>/, ''));
    expect(none.detected).toMatchObject({ upAxis: 'Y', upAxisDeclared: false });
    const z = await read();
    const part = (r: typeof z) => Object.values(r.nodes).find((n) => n.kind === 'PART' && n.name === 'Cap')!;
    close(part(y).transform.position, part(z).transform.position);
    const x = await read(twoParts.replace('Z_UP', 'X_UP'));
    expect(x.detected.upAxis).toBe('Y');
    expect(x.notes).toEqual([{ code: 'axisUnsupported', params: { axis: 'X' } }]);
  });
});

describe('DAE: detection and damage', () => {
  it('is found by extension and by the COLLADA element', () => {
    expect(detectFormat('part.DAE', new Uint8Array(0))).toBe('DAE');
    expect(detectFormat('part.xml', encode(twoParts))).toBe('DAE');
  });

  it('says what is wrong', async () => {
    await expect(importFile({ name: 'x.dae', bytes: encode('') })).rejects.toThrow();
    await expect(importFile({ name: 'x.dae', bytes: encode('<COLLADA version="1.4.1"><asset/></COLLADA>') })).rejects.toThrow();
  });
});
