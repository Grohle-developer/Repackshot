// USD: a hand-written .usda (two meshes under one Xform, one UsdPreviewSurface
// material, centimetres, Y up), the same layer inside a .usdz (a stored zip), and
// text layers with features three's USDLoader does not read.

import { describe, expect, it } from 'vitest';
import { describePayload } from '../src/core/import-options';
import { detectFormat, importFile } from '../src/io/import';
import { usdHeader, usdUnsupported } from '../src/io/usd';
import twoParts from './fixtures/two-parts.usda?raw';
import { colorOf, encode, meshOf, readWithDefaults } from './io-helpers';
import { zipStored } from './zip';

const close = (got: readonly number[], want: readonly number[], digits = 4) => want.forEach((w, i) => expect(got[i], `[${i}]`).toBeCloseTo(w, digits));
const srgb = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const read = (text = twoParts, name = 'two-parts.usda') => importFile({ name, bytes: encode(text) });
const header = (extra: string) => twoParts.replace(/metersPerUnit = [^\n]*\n/, '').replace(/upAxis = [^\n]*\n/, '').replace('(\n', `(\n${extra}`);

describe('USD: the text layer as it comes', () => {
  it('keeps the prim hierarchy: parts, groups, triangles, vertices, materials', async () => {
    const r = await read();
    expect(r.format).toBe('USD');
    // Both meshes use the same material: one instance, however many the loader makes.
    expect(describePayload(r)).toEqual({ parts: 2, groups: 1, triangles: 24, materials: 1 });
    const model = r.nodes[r.roots[0]];
    expect(model).toMatchObject({ kind: 'MODEL', name: 'two-parts', source: { kind: 'FILE', name: 'two-parts.usda', format: 'USD' } });
    const [bottle] = model.children.map((c) => r.nodes[c]);
    expect([bottle.kind, bottle.name]).toEqual(['GROUP', 'Bottle']);
    const parts = bottle.children.map((c) => r.nodes[c]);
    expect(parts.map((p) => p.name)).toEqual(['Body', 'Cap']);
    // The layer has no normals: the loader's smooth ones are ignored and the cube keeps its 12 hard edges.
    for (const p of parts) {
      expect(p.mesh).toMatchObject({ vertices: 24, triangles: 12 });
      expect(meshOf(p).sharpEdges!.length / 2).toBe(12);
    }
    close(parts[0].transform.position, [0, 3, 0]);
    close(parts[1].transform.position, [0, 6.5, 0]);
  });

  it('turns UsdPreviewSurface into a SIMPLE instance: colour, roughness, metal', async () => {
    const r = await read();
    const [m] = Object.values(r.materials);
    expect(m).toMatchObject({ family: 'SIMPLE', name: 'Material' });
    close(colorOf(m), [srgb(0.8), srgb(0.2), srgb(0.1), 1], 3);
    expect(m.params.roughness).toBeCloseTo(0.4, 6);
    expect(m.params.metallic).toBe(0);
  });

  it('says what it detected: centimetres and Y up, from the stage metadata', async () => {
    const r = await read();
    expect(r.detected).toEqual({ units: 'cm', upAxis: 'Y', upAxisDeclared: true, size: 7, hasLayers: false, hiddenParts: 0 });
    const d = await readWithDefaults({ name: 'two-parts.usda', bytes: encode(twoParts) });
    expect(d.options).toMatchObject({ units: 'cm', upAxis: 'Y' });
    const [body] = Object.values(d.nodes).filter((n) => n.kind === 'PART');
    close(body.mesh!.bounds.max, [20, 20, 30], 3);
    close(body.transform.position, [0, 0, 30], 3);
  });
});

describe('USD: the same layer in a package', () => {
  it('reads a .usdz like the .usda: same parts, triangles, materials and detected values', async () => {
    const plain = await read();
    const zipped = await importFile({ name: 'two-parts.usdz', bytes: zipStored([['two-parts.usda', twoParts]]) });
    expect(describePayload(zipped)).toEqual(describePayload(plain));
    expect(zipped.detected).toEqual(plain.detected);
    expect(zipped.nodes[zipped.roots[0]].source).toEqual({ kind: 'FILE', name: 'two-parts.usdz', format: 'USD' });
    // A package keeps its own references: no note about external ones.
    expect(zipped.notes).toEqual([]);
  });

  it('is found by its extension, by #usda, by the crate magic, and by the layer inside a zip', () => {
    for (const ext of ['usd', 'usda', 'usdc', 'usdz']) expect(detectFormat(`a.${ext}`, new Uint8Array(0))).toBe('USD');
    expect(detectFormat('a.dat', encode(twoParts))).toBe('USD');
    expect(detectFormat('a.dat', encode('PXR-USDC\u0000\u0000\u0000\u0000'))).toBe('USD');
    expect(detectFormat('a.dat', zipStored([['two-parts.usda', twoParts]]))).toBe('USD');
  });
});

describe('USD: metadata', () => {
  it('reads metersPerUnit and upAxis from the stage metadata', () => {
    expect(usdHeader(twoParts)).toEqual({ metersPerUnit: 0.01, upAxis: 'Y' });
    expect(usdHeader('#usda 1.0\n(\n    upAxis = "Z"\n)\n')).toEqual({ metersPerUnit: null, upAxis: 'Z' });
    expect(usdHeader('#usda 1.0\n')).toEqual({ metersPerUnit: null, upAxis: null });
  });

  it('maps metersPerUnit: 0.001 mm, 0.01 cm, 1 m, 0.0254 inch; none is undeclared, other is said', async () => {
    const units = async (mpu: string) => (await read(header(`    metersPerUnit = ${mpu}\n`))).detected;
    expect((await units('0.001')).units).toBe('mm');
    expect((await units('0.01')).units).toBe('cm');
    expect((await units('1')).units).toBe('m');
    expect((await units('0.0254')).units).toBe('in');
    const none = await read(header(''));
    expect(none.detected).toMatchObject({ units: null, upAxis: 'Y', upAxisDeclared: false });
    const feet = await read(header('    metersPerUnit = 0.3048\n'));
    expect(feet.detected).toMatchObject({ units: null, unsupportedUnit: '0.3048 m' });
    expect(feet.notes).toEqual([{ code: 'unitsUnsupported', params: { unit: '0.3048 m' } }]);
  });

  it('a Z-up stage keeps its numbers: the loader turned the root, the reader takes it back', async () => {
    const y = await read();
    const z = await read(header('    metersPerUnit = 0.01\n    upAxis = "Z"\n'));
    expect(z.detected).toMatchObject({ upAxis: 'Z', upAxisDeclared: true });
    const cap = (r: typeof y) => Object.values(r.nodes).find((n) => n.kind === 'PART' && n.name === 'Cap')!;
    close(cap(z).transform.position, cap(y).transform.position);
    close(cap(z).mesh!.bounds.max, cap(y).mesh!.bounds.max);
  });
});

describe('USD: what three does not read', () => {
  const withPrims = (prims: string) => twoParts.replace('def Scope "Looks"', `${prims}\n    def Scope "Looks"`);

  it('finds the unsupported prim types in a text layer', () => {
    expect(usdUnsupported(twoParts, false)).toEqual([]);
    const text = withPrims('    def NurbsPatch "Patch"\n    {\n    }\n    def BasisCurves "Hair"\n    {\n    }\n    def NurbsPatch "Again"\n    {\n    }');
    expect(usdUnsupported(text, false)).toEqual(['NurbsPatch', 'BasisCurves']);
    // References to other files cannot be followed from a single dropped file, but a package has them inside.
    const ref = withPrims('    def Xform "Wheel" (\n        references = @./wheel.usd@\n    )\n    {\n    }');
    expect(usdUnsupported(ref, false)).toEqual(['external references']);
    expect(usdUnsupported(ref, true)).toEqual([]);
  });

  it('adds a note listing them, and still reads the rest', async () => {
    const r = await read(withPrims('    def Points "Dust"\n    {\n    }\n    def PointInstancer "Rain"\n    {\n    }'));
    expect(describePayload(r).parts).toBe(2);
    expect(r.notes).toEqual([{ code: 'usdUnsupported', params: { features: 'Points, PointInstancer' } }]);
  });

  it('says what is missing when nothing can be read', async () => {
    const only = '#usda 1.0\n(\n    metersPerUnit = 1\n)\ndef Xform "Root"\n{\n    def NurbsPatch "Patch"\n    {\n    }\n}\n';
    await expect(read(only)).rejects.toThrow(/no meshes.*NurbsPatch/);
    await expect(read('#usda 1.0\n')).rejects.toThrow('no meshes');
  });
});
