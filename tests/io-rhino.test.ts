// Rhino 3DM: a file written by the rhino3dm package in the test (four layers,
// three box meshes, a material, a sphere B-rep without render meshes), read by
// three's Rhino3dmLoader running the real rhino3dm wasm in a worker thread
// (tests/worker-shim.ts stands in for the browser's Worker and fetch).

import { beforeAll, describe, expect, it } from 'vitest';
import { applyImportOptions, defaultImportOptions, describePayload } from '../src/core/import-options';
import { boundsOf } from '../src/core/scene';
import { createInitialState, reduce } from '../src/core/store';
import { detectFormat, importFile } from '../src/io/import';
import { rhinoUnits, setRhinoLibraryPath } from '../src/io/rhino';
import { colorOf, encode, meshOf, readWithDefaults } from './io-helpers';
import { buildRhinoFile, type RhinoUnitName } from './rhino-fixture';
import { installWorkerShim, TEST_LIBRARY_URL } from './worker-shim';

const close = (got: readonly number[], want: readonly number[], digits = 4) => want.forEach((w, i) => expect(got[i], `[${i}]`).toBeCloseTo(w, digits));
const srgb = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

beforeAll(() => {
  installWorkerShim();
  setRhinoLibraryPath(TEST_LIBRARY_URL);
});

const read = async (options?: Parameters<typeof buildRhinoFile>[0]) => importFile({ name: 'bottle.3dm', bytes: await buildRhinoFile(options) });
const named = <T extends { name: string }>(nodes: Record<string, T>, name: string): T => Object.values(nodes).find((n) => n.name === name)!;

describe('3DM: the file as it comes', () => {
  it('reads layers as groups and meshes as parts: parts, groups, triangles, materials', async () => {
    const r = await read();
    expect(r.format).toBe('3DM');
    // Three meshes of 12 triangles on four layers; a material for Body, the neutral Default for the rest.
    expect(describePayload(r)).toEqual({ parts: 3, groups: 4, triangles: 36, materials: 2 });
    const model = r.nodes[r.roots[0]];
    expect(model).toMatchObject({ kind: 'MODEL', name: 'bottle', source: { kind: 'FILE', name: 'bottle.3dm', format: '3DM' } });
    // Assembly holds Body and Cap (a layer inside a layer is a group inside a group); Construction is on its own.
    expect(model.children.map((c) => r.nodes[c].name)).toEqual(['Assembly', 'Construction']);
    const assembly = named(r.nodes, 'Assembly');
    expect(assembly.children.map((c) => [r.nodes[c].kind, r.nodes[c].name, r.nodes[r.nodes[c].children[0]].kind, r.nodes[r.nodes[c].children[0]].name])).toEqual([
      ['GROUP', 'Body', 'PART', 'Body'],
      ['GROUP', 'Cap', 'PART', 'Cap'],
    ]);
    for (const n of ['Body', 'Cap', 'Guide']) {
      const part = Object.values(r.nodes).find((x) => x.kind === 'PART' && x.name === n)!;
      expect(part.mesh).toMatchObject({ vertices: 24, triangles: 12 });
      expect(meshOf(part).sharpEdges!.length / 2).toBe(12);
    }
  });

  it('keeps the layer of each part, with its full path', async () => {
    const r = await read();
    const layerOf = (name: string) => r.layers![Object.values(r.nodes).find((n) => n.kind === 'PART' && n.name === name)!.id];
    expect([layerOf('Body'), layerOf('Cap'), layerOf('Guide')]).toEqual(['Assembly::Body', 'Assembly::Cap', 'Construction']);
    expect(r.detected.hasLayers).toBe(true);
  });

  it('turns the Rhino material into a SIMPLE instance: sRGB colour to linear, half rough', async () => {
    const r = await read();
    const steel = Object.values(r.materials).find((m) => m.name === 'Steel')!;
    expect(steel).toMatchObject({ family: 'SIMPLE', preset: null });
    close(colorOf(steel), [srgb(200 / 255), srgb(40 / 255), srgb(30 / 255), 1], 4);
    expect(steel.params.roughness).toBe(0.5);
    expect(steel.params.metallic).toBe(0);
    const part = (name: string) => Object.values(r.nodes).find((n) => n.kind === 'PART' && n.name === name)!;
    expect(r.materials[part('Body').material!].name).toBe('Steel');
    // Cap and Guide have no material: the neutral Default.
    expect(part('Cap').material).toBe('tm_default');
    expect(r.materials.tm_default.role).toBe('DEFAULT');
  });

  it('says what it detected: millimetres, Z up, one hidden part, 105 mm wide with the guide', async () => {
    const r = await read();
    expect(r.detected).toEqual({ units: 'mm', upAxis: 'Z', upAxisDeclared: true, size: 105, hasLayers: true, hiddenParts: 1 });
  });

  it('warns about a B-rep saved without render meshes, once for each', async () => {
    const r = await read();
    expect(r.notes).toEqual([{ code: 'brepNoMesh', params: { count: 1 } }]);
    expect(describePayload(r).parts).toBe(3); // the sphere is not a part
    expect((await read({ noBrep: true })).notes).toEqual([]);
  });

  it('is found by its extension and by the header', async () => {
    const bytes = new Uint8Array(await buildRhinoFile());
    expect(detectFormat('bottle.3DM', encode('nothing'))).toBe('3DM');
    expect(detectFormat('bottle.bin', bytes)).toBe('3DM');
  });
});

describe('3DM: units', () => {
  const units = async (name: RhinoUnitName) => (await read({ units: name, noBrep: true })).detected;

  it('reads the unit system of the document: mm, cm, m, inches', async () => {
    expect(await units('Millimeters')).toMatchObject({ units: 'mm' });
    expect(await units('Centimeters')).toMatchObject({ units: 'cm' });
    expect(await units('Meters')).toMatchObject({ units: 'm' });
    expect(await units('Inches')).toMatchObject({ units: 'in' });
  });

  it('says so when the document is in a unit the sheet does not offer, and has none for no unit', async () => {
    const feet = await read({ units: 'Feet', noBrep: true });
    expect(feet.detected).toMatchObject({ units: null, unsupportedUnit: 'feet' });
    expect(feet.notes).toEqual([{ code: 'unitsUnsupported', params: { unit: 'feet' } }]);
    const none = await read({ units: 'None', noBrep: true });
    expect(none.detected.units).toBeNull();
    expect(none.notes).toEqual([]);
    expect(rhinoUnits({ modelUnitSystem: { name: 'UnitSystem_Microns' } })).toEqual({ units: null, unsupported: 'microns' });
    expect(rhinoUnits(undefined)).toEqual({ units: null });
  });

  it('a model in inches is 25.4 times bigger in millimetres', async () => {
    const mm = await readWithDefaults({ name: 'a.3dm', bytes: await buildRhinoFile({ units: 'Millimeters', noBrep: true }) });
    const inch = await readWithDefaults({ name: 'a.3dm', bytes: await buildRhinoFile({ units: 'Inches', noBrep: true }) });
    const sizeOf = (r: typeof mm) => {
      const s = reduce(createInitialState(), { type: 'scene/addModel', payload: r, replace: true });
      return s.scene.partSizeMm;
    };
    // Default: the hidden guide is out, so the model is 40 wide and 70 tall.
    expect(sizeOf(mm)).toBeCloseTo(70, 3);
    expect(sizeOf(inch)).toBeCloseTo(70 * 25.4, 2);
  });
});

describe('3DM: hidden objects', () => {
  it('an object hidden on a visible layer is a hidden part under a visible group', async () => {
    const r = await read({ hiddenObject: true, noBrep: true });
    const spare = Object.values(r.nodes).find((n) => n.name === 'Spare' && n.kind === 'PART')!;
    expect(spare.visible).toBe(false);
    expect(r.nodes[spare.parent!]).toMatchObject({ name: 'Cap', kind: 'GROUP', visible: true });
    // Two hidden parts now: the guide on its hidden layer and the spare.
    expect(r.detected.hiddenParts).toBe(2);
    const off = await readWithDefaults({ name: 'a.3dm', bytes: await buildRhinoFile({ hiddenObject: true, noBrep: true }) });
    expect(Object.values(off.nodes).some((n) => n.name === 'Spare')).toBe(false);
    const on = await readWithDefaults({ name: 'a.3dm', bytes: await buildRhinoFile({ hiddenObject: true, noBrep: true }) }, { importHidden: true });
    expect(Object.values(on.nodes).find((n) => n.name === 'Spare')!.visible).toBe(false);
    expect(Object.values(on.nodes).find((n) => n.name === 'Cap' && n.kind === 'PART')!.visible).toBe(true);
  });
});

describe('3DM: the sheet options', () => {
  it('drops the hidden layer by default and keeps it, hidden, when asked', async () => {
    const r = await readWithDefaults({ name: 'a.3dm', bytes: await buildRhinoFile({ noBrep: true }) });
    expect(describePayload(r)).toMatchObject({ parts: 2, groups: 3 });
    expect(named(r.nodes, 'Construction')).toBeUndefined();
    const all = await readWithDefaults({ name: 'a.3dm', bytes: await buildRhinoFile({ noBrep: true }) }, { importHidden: true });
    expect(describePayload(all)).toMatchObject({ parts: 3, groups: 4 });
    expect(named(all.nodes, 'Construction').visible).toBe(false);
    const s = reduce(createInitialState(), { type: 'scene/addModel', payload: all, replace: true });
    // The hidden guide does not count towards the visible bounds.
    expect(boundsOf(s, s.scene.roots, true).max[0]).toBeCloseTo(40, 3);
    expect(boundsOf(s, s.scene.roots, false).max[0]).toBeCloseTo(105, 3);
  });

  it('groups by layer with the full path, and by material', async () => {
    const raw = await importFile({ name: 'a.3dm', bytes: await buildRhinoFile({ noBrep: true }) });
    const base = defaultImportOptions(raw.detected, false);
    const layer = applyImportOptions(raw, { ...base, groupBy: 'layer', importHidden: true });
    expect(layer.nodes[layer.roots[0]].children.map((c) => [layer.nodes[c].name, layer.nodes[c].children.map((p) => layer.nodes[p].name)])).toEqual([
      ['Assembly::Body', ['Body']],
      ['Assembly::Cap', ['Cap']],
      ['Construction', ['Guide']],
    ]);
    const material = applyImportOptions(raw, { ...base, groupBy: 'material' });
    expect(material.nodes[material.roots[0]].children.map((c) => [material.nodes[c].name, material.nodes[c].children.length])).toEqual([
      ['Steel', 1],
      ['Default', 1],
    ]);
  });

  it('puts the model where it stands: millimetres and Z up change nothing, the pivots stay', async () => {
    const r = await readWithDefaults({ name: 'a.3dm', bytes: await buildRhinoFile({ noBrep: true }) });
    const part = (n: string) => Object.values(r.nodes).find((x) => x.kind === 'PART' && x.name === n)!;
    close(part('Body').transform.position, [20, 20, 30]);
    close(part('Cap').transform.position, [20, 20, 65]);
    close(part('Body').mesh!.bounds.max, [20, 20, 30]);
  });
});
