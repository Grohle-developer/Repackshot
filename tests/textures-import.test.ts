// Phase M2a: importers bring their materials' maps, factors, UVs and normals (glTF from its JSON, OBJ with its
// MTL and images dropped with it), and the import options keep or drop them.

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { applyImportOptions, defaultImportOptions, textureSummary } from '../src/core/import-options';
import { getMesh } from '../src/core/meshes';
import { textureImageId } from '../src/core/texture-images';
import { defaultMapping, projectPoint, type TextureMapping } from '../src/core/textures';
import { gltfMapping, readGltfAssets, splitGltf } from '../src/io/gltf-materials';
import { importFile } from '../src/io/import';
import { parseMapStatement, parseMtl } from '../src/io/mtl';
import { colourImage, emissionImage, metalRoughImage, normalImage, texturedGlb, texturedObj } from '../tools/texture-fixtures.mjs';
import { encode, partsOf, readWithDefaults } from './io-helpers';

/** A GLB of a JSON and a binary chunk. */
function glbOf(json: unknown, bin: Uint8Array): Uint8Array {
  const text = new TextEncoder().encode(JSON.stringify(json));
  const jl = (text.length + 3) & ~3;
  const bl = (bin.length + 3) & ~3;
  const out = new Uint8Array(28 + jl + bl);
  const v = new DataView(out.buffer);
  v.setUint32(0, 0x46546c67, true);
  v.setUint32(4, 2, true);
  v.setUint32(8, out.length, true);
  v.setUint32(12, jl, true);
  v.setUint32(16, 0x4e4f534a, true);
  out.set(text, 20);
  out.fill(0x20, 20 + text.length, 20 + jl);
  v.setUint32(20 + jl, bl, true);
  v.setUint32(24 + jl, 0x004e4942, true);
  out.set(bin, 28 + jl);
  return out;
}

const close = (got: readonly number[], want: readonly number[], digits = 5) => want.forEach((w, i) => expect(got[i], `[${i}] of ${JSON.stringify(got)}`).toBeCloseTo(w, digits));

describe('a GLB with the four maps of the M2a criterion', () => {
  it('imports into one material with every slot, its factors and its images as the file has them', async () => {
    const r = await readWithDefaults({ name: 'box.glb', bytes: texturedGlb().glb });
    const [part] = partsOf(r);
    const m = r.materials[part.material!];
    expect(m.name).toBe('Textured');
    // Factors: glTF's own (metallicFactor 1, roughnessFactor 0.9), not three's reading of them.
    expect(m.params).toEqual({ baseColor: [1, 1, 1, 1], metallic: 1, roughness: 0.9 });
    const t = m.textures;
    const id = (bytes: Uint8Array) => textureImageId(bytes);
    expect(t.color?.image).toEqual({ id: id(colourImage()), name: 'colour.png', width: 64, height: 64 });
    expect(t.roughness).toMatchObject({ channel: 'G', image: { id: id(metalRoughImage()) } });
    expect(t.metal).toMatchObject({ channel: 'B', image: { id: id(metalRoughImage()) } });
    expect(t.normal).toMatchObject({ strength: 0.8, height: false, image: { id: id(normalImage()) } });
    // Emission: factor × texture × KHR_materials_emissive_strength.
    expect(t.emission).toMatchObject({ tint: [1, 0.5, 0.25], strength: 2, image: { id: id(emissionImage()) } });
    // alphaMode MASK with a colour image that has alpha: a cut-out at alphaCutoff, from its A.
    expect(t.alpha).toMatchObject({ channel: 'A', cutout: true, cutoff: 0.4, image: { id: id(colourImage()) } });
    expect(t.mapping).toEqual(defaultMapping());
    expect(t.color?.mapping).toBeNull();
    // The images travel as their bytes; the occlusion map has no slot and is reported.
    const sum = textureSummary(r.textures);
    expect(sum.kept).toBe(4);
    expect(sum.unused.map((u) => [u.name, u.unused])).toEqual([['occlusion.png', 'occlusion']]);
    const colour = r.textures.find((x) => x.name === 'colour.png')!;
    expect(colour.bytes).toEqual(colourImage());
    expect(r.notes).toContainEqual({ code: 'texturesKept', params: { count: 4, size: 0.1 } });
    expect(r.notes).toContainEqual({ code: 'textureUnused', params: { image: 'occlusion.png', kind: 'occlusion' } });
  });

  it('keeps the UVs turned to v up, the second set, and the file’s vertex normals', async () => {
    const r = await readWithDefaults({ name: 'box.glb', bytes: texturedGlb().glb });
    const mesh = getMesh(partsOf(r)[0].mesh!.id)!;
    expect(mesh.positions.length / 3).toBe(24);
    expect(mesh.uvs).toBeDefined();
    expect(mesh.uvs2).toBeDefined();
    // Every corner of a face: glTF's (0, 0) top-left is our (0, 1); the second set is half of the first.
    const uv = [...mesh.uvs!];
    const uv2 = [...mesh.uvs2!];
    for (let i = 0; i < uv.length; i += 2) {
      expect([0, 1]).toContain(uv[i]);
      expect([0, 1]).toContain(uv[i + 1]);
      expect(uv2[i]).toBeCloseTo(uv[i] / 2);
      expect(uv2[i + 1]).toBeCloseTo(1 - (1 - uv[i + 1]) / 2);
    }
    // The face normals of the file, turned to Z up (+Y of glTF is +Z of the model): six directions, four corners each.
    const dirs = new Map<string, number>();
    for (let i = 0; i < mesh.normals.length; i += 3) {
      const k = [mesh.normals[i], mesh.normals[i + 1], mesh.normals[i + 2]].map((x) => Math.round(x)).join(',');
      dirs.set(k, (dirs.get(k) ?? 0) + 1);
    }
    expect([...dirs.values()]).toEqual([4, 4, 4, 4, 4, 4]);
    expect(dirs.has('0,0,1')).toBe(true);
  });

  it('a texture transform becomes the slot’s mapping, read as three.js reads it', async () => {
    const transform = { offset: [0.1, 0.25], scale: [2, 2], rotation: 0.3 };
    const r = await readWithDefaults({ name: 'box.glb', bytes: texturedGlb({ transform }).glb });
    const t = r.materials[partsOf(r)[0].material!].textures;
    // The shared mapping is the plain one most maps have; the colour has its own.
    expect(t.mapping).toEqual(defaultMapping());
    const own = t.color!.mapping!;
    // three.js on the same transform (glTF's v down, flipY false): sample positions must agree, in our v up.
    const m3 = new THREE.Matrix3().setUvTransform(0.1, 0.25, 2, 2, 0.3, 0, 0);
    for (const [u, v] of [[0, 0], [1, 0], [0.3, 0.7], [1, 1]]) {
      const g = new THREE.Vector3(u, v, 1).applyMatrix3(m3);
      const [p] = projectPoint(own, [0, 0, 0], [0, 0, 1], 1, [u, 1 - v]);
      close([p.u, 1 - p.v], [g.x, g.y]);
    }
    expect(gltfMapping({ index: 0 }, null)).toEqual(defaultMapping());
    const clamped: TextureMapping = gltfMapping({ index: 0, texCoord: 1 }, { wrapS: 33071 });
    expect([clamped.uvSet, clamped.wrap]).toEqual([1, 'CLAMP']);
  });

  it('two glTF materials that differ only in their maps are two instances', async () => {
    // The fixture with a second box whose material is the first one with the emission image as its colour.
    const { json, bin } = splitGltf(texturedGlb().glb);
    const mats = json.materials as Record<string, unknown>[];
    const second = JSON.parse(JSON.stringify(mats[0]));
    second.pbrMetallicRoughness.baseColorTexture = { index: 3 };
    mats.push(second);
    (json.meshes as unknown[]).push({ primitives: [{ ...(json.meshes as { primitives: Record<string, unknown>[] }[])[0].primitives[0], material: 1 }] });
    (json.nodes as unknown[]).push({ mesh: 1, name: 'Other', translation: [0.3, 0, 0] });
    (json.scenes as { nodes: number[] }[])[0].nodes.push(1);
    const assets = await readGltfAssets(glbOf(json, bin!));
    expect(assets.materials).toHaveLength(2);
    const r = await readWithDefaults({ name: 'two.glb', bytes: glbOf(json, bin!) });
    const parts = partsOf(r);
    expect(parts.map((p) => p.name)).toEqual(['Box', 'Other']);
    expect(parts[0].material).not.toBe(parts[1].material);
    expect(r.materials[parts[1].material!].textures.color?.image.name).toBe('emission.png');
    expect(textureSummary(r.textures).kept).toBe(4);
    expect(r.textures.find((x) => x.name === 'emission.png')?.materials.sort()).toEqual([parts[0].material, parts[1].material].sort());
  });

  it('a material without factors has glTF’s defaults: white, metal 1, roughness 1, opaque', async () => {
    const json = { asset: { version: '2.0' }, materials: [{}, { alphaMode: 'BLEND', pbrMetallicRoughness: { baseColorFactor: [1, 0, 0, 0.5] } }, { alphaMode: 'OPAQUE', pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 0.5] } }] };
    const assets = await readGltfAssets(new TextEncoder().encode(JSON.stringify(json)));
    expect(assets.materials.map((m) => m.params)).toEqual([
      { baseColor: [1, 1, 1, 1], metallic: 1, roughness: 1 },
      { baseColor: [1, 0, 0, 1], metallic: 1, roughness: 1, opacity: 0.5 },
      // OPAQUE ignores the alpha of the factor (glTF §3.9.4).
      { baseColor: [1, 1, 1, 1], metallic: 1, roughness: 1 },
    ]);
  });

  it('an image that is not a PNG or JPEG is dropped and said, and its slot stays empty', async () => {
    const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
    const r = await readWithDefaults({ name: 'box.glb', bytes: texturedGlb({ colour: webp }).glb });
    const t = r.materials[partsOf(r)[0].material!].textures;
    expect(t.color).toBeNull();
    expect(t.alpha).toBeNull();
    expect(r.textures.find((x) => x.name === 'colour.png')?.dropped).toBe('format');
    expect(r.notes).toContainEqual({ code: 'textureDropped', params: { image: 'colour.png', reason: 'format' } });
  });

  it('the Default material policy brings no texture in', async () => {
    const raw = await importFile({ name: 'box.glb', bytes: texturedGlb().glb });
    const applied = applyImportOptions(raw, { ...defaultImportOptions(raw.detected, false), materials: 'default' });
    expect(applied.textures).toEqual([]);
    expect(Object.values(applied.materials).every((m) => m.textures.color === null)).toBe(true);
  });
});

describe('OBJ with its material library and images', () => {
  const files = () => {
    const { obj, mtl, images } = texturedObj();
    const companions = new Map<string, Blob>([['quad.mtl', new Blob([mtl])], ...Object.entries(images).map(([n, b]) => [n, new Blob([b as Uint8Array<ArrayBuffer>])] as [string, Blob])]);
    return { obj, companions, images };
  };

  it('reads the map statements, their options and file names with spaces', () => {
    expect(parseMapStatement('-s 2 2 1 -o 0.25 0 0 paint colour.png')).toEqual({ file: 'paint colour.png', repeat: [2, 2], offset: [0.25, 0], bumpMultiplier: 1, wrap: 'REPEAT', channel: null });
    expect(parseMapStatement('-bm 0.5 -clamp on -imfchan r bump.png')).toMatchObject({ file: 'bump.png', bumpMultiplier: 0.5, wrap: 'CLAMP', channel: 'R' });
    const [m] = parseMtl(texturedObj().mtl);
    expect(Object.keys(m.maps).sort()).toEqual(['alpha', 'color', 'normal', 'roughness']);
    expect(m.maps.roughness).toMatchObject({ file: 'gloss.png', invert: true });
    expect(m.maps.normal).toMatchObject({ height: true, bumpMultiplier: 0.5 });
    expect(m.unused.map((u) => u.keyword)).toEqual(['map_ka']);
  });

  it('gives the usemtl instance the library’s parameters and maps, the images as files', async () => {
    const { obj, companions, images } = files();
    const raw = await importFile({ name: 'quad.obj', bytes: encode(obj) }, { companions });
    const r = applyImportOptions(raw, defaultImportOptions(raw.detected, false));
    const m = Object.values(r.materials)[0];
    expect(m.name).toBe('Paint');
    // Kd as sRGB, roughness from Ns and Ks like the Phong readers.
    expect(m.params.baseColor![0]).toBeCloseTo(((0.5 + 0.055) / 1.055) ** 2.4, 6);
    expect(m.params.roughness).toBeCloseTo((2 / 202) ** 0.25, 6);
    const t = m.textures;
    expect(t.color?.image).toMatchObject({ name: 'paint colour.png', id: textureImageId(images['paint colour.png']) });
    // The colour's -s and -o: the mapping most maps share is the plain one, so the colour has its own.
    expect(t.mapping).toEqual(defaultMapping());
    expect(t.color?.mapping).toMatchObject({ projection: 'UV', repeat: [2, 2], offset: [0.25, 0] });
    expect(t.roughness).toMatchObject({ invert: true, channel: 'L' });
    expect(t.alpha).toMatchObject({ channel: 'R', cutout: false });
    expect(t.normal).toMatchObject({ height: true, strength: 0.5 });
    expect(raw.notes.some((n) => n.code === 'mtlIgnored')).toBe(false);
    expect(raw.notes).toContainEqual({ code: 'textureUnused', params: { image: 'ambient.png', kind: 'ambient' } });
    expect(textureSummary(r.textures).kept).toBe(4);
  });

  it('without the library it says so, as before; an image that was not chosen is missing', async () => {
    const { obj, companions } = files();
    const alone = await importFile({ name: 'quad.obj', bytes: encode(obj) });
    expect(alone.notes).toEqual([{ code: 'mtlIgnored', params: { files: 'quad.mtl' } }]);
    companions.delete('gloss.png');
    const raw = await importFile({ name: 'quad.obj', bytes: encode(obj) }, { companions });
    expect(raw.textures?.find((x) => x.name === 'gloss.png')?.dropped).toBe('missing');
    expect(Object.values(raw.materials)[0].textures.roughness).toBeNull();
    expect(raw.notes).toContainEqual({ code: 'textureDropped', params: { image: 'gloss.png', reason: 'missing' } });
  });
});
