// FBX: the hand-written ASCII fixture (two groups, a box in each, one Phong
// material, centimetres, Y up), the same scene as a binary file at both
// record widths, and the GlobalSettings scan.

import { describe, expect, it } from 'vitest';
import { describePayload } from '../src/core/import-options';
import { boundsOf } from '../src/core/scene';
import { createInitialState, reduce } from '../src/core/store';
import { detectFormat, importFile } from '../src/io/import';
import { fbxDetected, scanFbxGlobals } from '../src/io/fbx';
import { asciiToBinaryFbx } from './fbx-binary';
import twoParts from './fixtures/two-parts.fbx?raw';
import { colorOf, encode, meshOf, partsOf, readWithDefaults } from './io-helpers';

const close = (got: readonly number[], want: readonly number[], digits = 4) => want.forEach((w, i) => expect(got[i], `[${i}]`).toBeCloseTo(w, digits));
const buffer = (bytes: Uint8Array): ArrayBuffer => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
/** The fixture with another value for a GlobalSettings property. */
const withGlobal = (name: string, value: number) => twoParts.replace(new RegExp(`(P: "${name}", "[^"]*", "[^"]*", "",)[-0-9.]+`), `$1${value}`);

describe('FBX: the ASCII fixture as the file has it', () => {
  it('reads two groups with a box each: parts, groups, triangles, vertices, materials', async () => {
    const r = await importFile({ name: 'two-parts.fbx', bytes: encode(twoParts) });
    expect(r.format).toBe('FBX');
    expect(describePayload(r)).toEqual({ parts: 2, groups: 2, triangles: 24, materials: 1 });
    const model = r.nodes[r.roots[0]];
    expect(model).toMatchObject({ kind: 'MODEL', name: 'two-parts', source: { kind: 'FILE', name: 'two-parts.fbx', format: 'FBX' } });
    expect(model.children.map((c) => [r.nodes[c].kind, r.nodes[c].name])).toEqual([
      ['GROUP', 'Assembly'],
      ['GROUP', 'Fittings'],
    ]);
    const parts = Object.values(r.nodes).filter((n) => n.kind === 'PART');
    expect(parts.map((p) => [p.name, r.nodes[p.parent!].name])).toEqual([
      ['Body', 'Assembly'],
      ['Cap', 'Fittings'],
    ]);
    // The cubes have no normals in the file: welded to 8 positions, split along the 12 hard edges into 24 vertices.
    for (const p of parts) {
      expect(p.mesh).toMatchObject({ vertices: 24, triangles: 12 });
      expect(meshOf(p).sharpEdges!.length / 2).toBe(12);
      expect(p.smooth).toBe(true);
    }
    // File units: centimetres, Y up. The body is 4 wide, 6 tall, 4 deep; the cap sits on top.
    close(parts[0].mesh!.bounds.min, [-2, -3, -2]);
    close(parts[0].mesh!.bounds.max, [2, 3, 2]);
    close(parts[0].transform.position, [0, 3, 0]);
    close(parts[1].transform.position, [0, 6.5, 0]);
    expect(r.notes).toEqual([]);
    expect(r.warnings).toEqual([]);
  });

  it('turns the Phong material into a SIMPLE instance: colour, roughness from the shininess, no metal', async () => {
    const r = await importFile({ name: 'two-parts.fbx', bytes: encode(twoParts) });
    const [steel] = Object.values(r.materials);
    expect(steel).toMatchObject({ name: 'Steel', family: 'SIMPLE', preset: null });
    // Diffuse (0.8, 0.2, 0.1) in sRGB is these in linear light.
    close(colorOf(steel), [0.6038, 0.0331, 0.0100, 1], 3);
    expect(steel.params.metallic).toBe(0);
    // Shininess 50 with a grey specular: (2 / 52) ^ 1/4.
    expect(steel.params.roughness).toBeCloseTo((2 / 52) ** 0.25, 6);
    const parts = Object.values(r.nodes).filter((n) => n.kind === 'PART');
    expect(parts.map((p) => r.materials[p.material!].name)).toEqual(['Steel', 'Steel']);
    expect(parts.every((p) => p.faceMaterials === undefined)).toBe(true);
  });

  it('says what it detected: centimetres, Y up, both declared', async () => {
    const r = await importFile({ name: 'two-parts.fbx', bytes: encode(twoParts) });
    expect(r.detected).toEqual({ units: 'cm', upAxis: 'Y', upAxisDeclared: true, size: 7, hasLayers: false, hiddenParts: 0 });
  });

  it('with the detected defaults it is 70 mm tall, standing along +Z', async () => {
    const r = await readWithDefaults({ name: 'two-parts.fbx', bytes: encode(twoParts) });
    expect(r.options).toMatchObject({ units: 'cm', upAxis: 'Y' });
    const parts = Object.values(r.nodes).filter((n) => n.kind === 'PART');
    // Body 4 x 6 x 4 cm: 40 wide, 40 deep, 60 tall; file y up becomes z up.
    close(parts[0].mesh!.bounds.max, [20, 20, 30], 3);
    close(parts[0].transform.position, [0, 0, 30], 3);
    close(parts[1].transform.position, [0, 0, 65], 3);
    const s = reduce(createInitialState(), { type: 'scene/addModel', payload: r, replace: true });
    const b = boundsOf(s, s.scene.roots);
    close(b.min, [-20, -20, 0], 3);
    close(b.max, [20, 20, 70], 3);
    expect(s.scene.partSizeMm).toBeCloseTo(70, 3);
  });
});

describe('FBX: the same scene as a binary file', () => {
  it.each([7400, 7500])('version %i gives the same parts, triangles, bounds and detected values', async (version) => {
    const ascii = await importFile({ name: 'two-parts.fbx', bytes: encode(twoParts) });
    const binary = await importFile({ name: 'two-parts.fbx', bytes: asciiToBinaryFbx(twoParts, version) });
    expect(describePayload(binary)).toEqual(describePayload(ascii));
    expect(binary.detected).toEqual(ascii.detected);
    const names = (r: typeof ascii) => Object.values(r.nodes).map((n) => `${n.kind}:${n.name}`);
    expect(names(binary)).toEqual(names(ascii));
    const a = Object.values(ascii.nodes).filter((n) => n.kind === 'PART');
    const b = Object.values(binary.nodes).filter((n) => n.kind === 'PART');
    for (let i = 0; i < 2; i++) {
      expect(b[i].mesh).toMatchObject({ vertices: a[i].mesh!.vertices, triangles: a[i].mesh!.triangles });
      close(b[i].mesh!.bounds.max, a[i].mesh!.bounds.max);
      close(b[i].transform.position, a[i].transform.position);
    }
    expect(Object.values(binary.materials).map((m) => m.name)).toEqual(['Steel']);
  });

  it('is found by its magic number whatever the extension, and ASCII by its first line', () => {
    expect(detectFormat('scene.dat', asciiToBinaryFbx(twoParts))).toBe('FBX');
    expect(detectFormat('scene.dat', encode(twoParts))).toBe('FBX');
    expect(detectFormat('scene.FBX', encode('anything'))).toBe('FBX');
  });
});

describe('FBX: GlobalSettings', () => {
  it('scans UpAxis and UnitScaleFactor from ASCII and from both binary widths', () => {
    for (const bytes of [encode(twoParts), asciiToBinaryFbx(twoParts, 7400), asciiToBinaryFbx(twoParts, 7500)]) {
      expect(scanFbxGlobals(buffer(bytes))).toEqual({ upAxis: 1, unitScaleFactor: 1 });
    }
    const z = withGlobal('UpAxis', 2).replace(/(P: "UnitScaleFactor", "double", "Number", "",)1/, '$12.54');
    for (const bytes of [encode(z), asciiToBinaryFbx(z, 7400), asciiToBinaryFbx(z, 7500)]) {
      expect(scanFbxGlobals(buffer(bytes))).toEqual({ upAxis: 2, unitScaleFactor: 2.54 });
    }
  });

  it('knows nothing about a file without settings', () => {
    const bare = twoParts.replace(/GlobalSettings:\s*{[\s\S]*?\n}\n/, '');
    expect(bare).not.toBe(twoParts);
    expect(scanFbxGlobals(buffer(encode(bare)))).toEqual({ upAxis: null, unitScaleFactor: null });
    expect(fbxDetected({ upAxis: null, unitScaleFactor: null }).detected).toEqual({ units: null, upAxis: 'Y', upAxisDeclared: false });
  });

  it('maps the unit scale factor to a unit: 1 cm, 100 m, 0.1 mm, 2.54 inch; anything else is said', () => {
    const units = (f: number) => fbxDetected({ upAxis: 1, unitScaleFactor: f });
    expect(units(1).detected.units).toBe('cm');
    expect(units(100).detected.units).toBe('m');
    expect(units(0.1).detected.units).toBe('mm');
    expect(units(2.54).detected.units).toBe('in');
    const feet = units(30.48);
    expect(feet.detected).toMatchObject({ units: null, unsupportedUnit: '30.48 cm' });
    expect(feet.notes).toEqual([{ code: 'unitsUnsupported', params: { unit: '30.48 cm' } }]);
  });

  it('X up is not offered: Y with a note', () => {
    const x = fbxDetected({ upAxis: 0, unitScaleFactor: 1 });
    expect(x.detected.upAxis).toBe('Y');
    expect(x.notes).toEqual([{ code: 'axisUnsupported', params: { axis: 'X' } }]);
  });

  it('a Z-up file keeps its numbers: the loader turned the scene, the reader takes the turn back', async () => {
    const y = await importFile({ name: 'y.fbx', bytes: encode(twoParts) });
    for (const bytes of [encode(withGlobal('UpAxis', 2)), asciiToBinaryFbx(withGlobal('UpAxis', 2))]) {
      const z = await importFile({ name: 'z.fbx', bytes });
      expect(z.detected).toMatchObject({ upAxis: 'Z', upAxisDeclared: true });
      const zp = Object.values(z.nodes).filter((n) => n.kind === 'PART');
      const yp = Object.values(y.nodes).filter((n) => n.kind === 'PART');
      for (let i = 0; i < 2; i++) {
        close(zp[i].mesh!.bounds.max, yp[i].mesh!.bounds.max);
        close(zp[i].transform.position, yp[i].transform.position);
      }
    }
    // Chosen as Z up in the sheet, a Z-up file stands where it was drawn.
    const z = await readWithDefaults({ name: 'z.fbx', bytes: encode(withGlobal('UpAxis', 2)) });
    expect(z.options.upAxis).toBe('Z');
    close(partsOf(z).length ? Object.values(z.nodes).filter((n) => n.kind === 'PART')[0].transform.position : [], [0, 30, 0], 3);
  });

  it('each unit gives its size: the same boxes are 70 mm in centimetres, 7 in tenths of millimetres', async () => {
    const size = async (factor: number) => {
      const r = await readWithDefaults({ name: 'u.fbx', bytes: encode(withGlobal('UnitScaleFactor', factor)) });
      const s = reduce(createInitialState(), { type: 'scene/addModel', payload: r, replace: true });
      return s.scene.partSizeMm;
    };
    expect(await size(1)).toBeCloseTo(70, 3);
    expect(await size(0.1)).toBeCloseTo(7, 4);
    expect(await size(100)).toBeCloseTo(7000, 2);
    expect(await size(2.54)).toBeCloseTo(177.8, 3);
  });
});

describe('FBX: damaged files', () => {
  it('say what is wrong', async () => {
    await expect(importFile({ name: 'x.fbx', bytes: encode('; FBX 7.4.0 project file\nFBXHeaderExtension: {\n}\n') })).rejects.toThrow(/version|Cannot find/i);
    await expect(importFile({ name: 'x.fbx', bytes: encode('hello') })).rejects.toThrow();
    // A scene with a group and no geometry.
    const empty = twoParts.slice(0, twoParts.indexOf('Definitions:')) + 'Objects:  {\n\tModel: 1000, "Model::Assembly", "Null" {\n\t\tVersion: 232\n\t}\n}\nConnections:  {\n\tC: "OO",1000,0\n}\n';
    await expect(importFile({ name: 'x.fbx', bytes: encode(empty) })).rejects.toThrow('no meshes');
  });
});
