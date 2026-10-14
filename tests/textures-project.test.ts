// Phase M2a: texture images travel in the project file as their own bytes, under the ids that name them, and come
// back the same; the meshes keep their second UV set; files written before M2a open with their textures read.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { getImage, retainImages } from '../src/core/images';
import { createInitialState, reduce } from '../src/core/store';
import { defaultTextures, textureImages } from '../src/core/textures';
import { base64ToBytes } from '../src/io/base64';
import { glbToMesh, meshToGlb } from '../src/io/glb';
import { loadProject, placeImages, readProjectFile, serializeProject } from '../src/io/project';
import { colourImage } from '../tools/texture-fixtures.mjs';
import { texturedProject } from './texture-helpers';

const imagesBlock = (text: string): { id: string; name: string; file: string }[] => JSON.parse(text).images ?? [];

describe('texture images in the project file', () => {
  it('are written once each, as their files, under their content ids', async () => {
    const s = await texturedProject();
    const text = await serializeProject(s).text();
    const block = imagesBlock(text);
    const used = [...textureImages(s).keys()];
    expect(block.map((e) => e.id).sort()).toEqual(used.sort());
    expect(used).toHaveLength(4);
    for (const e of block) expect(base64ToBytes(e.file)).toEqual(getImage(e.id)!.bytes);
    expect(base64ToBytes(block.find((e) => e.name === 'colour.png')!.file)).toEqual(colourImage());
  });

  it('come back with the same bytes and ids in another session, and save again to the same file', async () => {
    const s = await texturedProject();
    const text = await serializeProject(s).text();
    const before = new Map([...textureImages(s).keys()].map((id) => [id, getImage(id)!.bytes.slice()]));
    // Another session: nothing of these images in the registry.
    retainImages([]);
    expect(getImage([...before.keys()][0])).toBeUndefined();
    const opened = await readProjectFile(new Blob([text]));
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(opened.warnings).toEqual([]);
    for (const [id, bytes] of before) expect(getImage(id)!.bytes).toEqual(bytes);
    const mat = Object.keys(opened.state.materials)[0];
    expect(opened.state.materials[mat].textures).toEqual(s.materials[mat].textures);
    expect(await serializeProject(opened.state).text()).toBe(text);
  });

  it('a missing image leaves its slots and labels and is counted with the missing images', async () => {
    const s = await texturedProject();
    const body = JSON.parse(await serializeProject(s).text());
    const colour = body.images.find((e: { name: string }) => e.name === 'colour.png');
    body.images = body.images.filter((e: { name: string }) => e !== colour);
    retainImages([]);
    const opened = await readProjectFile(new Blob([JSON.stringify(body)]));
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(opened.warnings).toEqual([{ code: 'MISSING_IMAGES', count: 1 }]);
    const t = Object.values(opened.state.materials)[0].textures;
    expect(t.color).toBeNull();
    expect(t.alpha).toBeNull(); // the alpha came from the colour image
    expect(t.labels).toEqual([]);
    expect(t.normal).not.toBeNull();
  });

  it('files written before M2a open with the textures of the new shape', () => {
    for (const name of ['project-v1.json', 'project-v2.json']) {
      const loaded = loadProject(readFileSync(`tests/fixtures/${name}`, 'utf8'));
      for (const m of Object.values(loaded.state.materials)) {
        expect(m.textures.labels, name).toEqual([]);
        expect(m.textures.color).toBeNull();
        expect(Object.keys(m.textures.mapping).sort()).toEqual(Object.keys(defaultTextures().mapping).sort());
      }
    }
  });

  it('a project without textures has no texture entries, as before', async () => {
    const s = reduce(createInitialState(), { type: 'meta/rename', name: 'x' });
    expect(imagesBlock(await serializeProject(s).text())).toEqual([]);
    const { state } = await placeImages(s, []);
    expect(state).toBe(s);
  });
});

describe('the second UV set in the embedded meshes', () => {
  it('travels as TEXCOORD_1 and comes back bit for bit; a mesh without it writes what it always did', () => {
    const base = { positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]), indices: new Uint32Array([0, 1, 2]), uvs: new Float32Array([0, 0, 1, 0, 0, 1]) };
    const plain = meshToGlb('m', base);
    const two = meshToGlb('m', { ...base, uvs2: new Float32Array([0.5, 0.5, 1, 0.5, 0.5, 1]) });
    expect(glbToMesh(plain).mesh.uvs2).toBeUndefined();
    expect(glbToMesh(two).mesh.uvs2).toEqual(new Float32Array([0.5, 0.5, 1, 0.5, 0.5, 1]));
    expect(new TextDecoder().decode(plain)).not.toContain('TEXCOORD_1');
  });
});
