// Shared fixtures of the M2a tests: a project with the textured GLB imported and a label, and a PNG decoder for
// the fixtures' own PNGs (filter 0 rows, written by tools/texture-fixtures.mjs), standing in for the browser's.

import { inflateSync } from 'node:zlib';
import { applyImportOptions, defaultImportOptions } from '../src/core/import-options';
import { createInitialState, createStore, type ProjectState } from '../src/core/store';
import { registerTextureImage } from '../src/core/texture-images';
import { newLabel } from '../src/core/textures';
import type { PixelDecoder } from '../src/io/hdri';
import { importFile } from '../src/io/import';
import { texturedGlb } from '../tools/texture-fixtures.mjs';

/** A project with the textured GLB imported as the Import button does it (its kept images registered), and a label. */
export async function texturedProject(): Promise<ProjectState> {
  const raw = await importFile({ name: 'box.glb', bytes: texturedGlb().glb });
  const applied = applyImportOptions(raw, defaultImportOptions(raw.detected, false));
  for (const t of applied.textures) if (!t.dropped && !t.unused && t.bytes) registerTextureImage(t.name, t.bytes, t.id);
  const store = createStore(createInitialState());
  store.dispatch({ type: 'scene/addModel', payload: { nodes: applied.nodes, roots: applied.roots, materials: applied.materials }, replace: true });
  const s = store.get();
  const mat = Object.keys(s.materials)[0];
  const image = s.materials[mat].textures.color!.image;
  store.dispatch({ type: 'texture/addLabel', material: mat, value: newLabel('lb1', image, { origin: [0, -50, 10], normal: [0, -1, 0], uAxis: [1, 0, 0] }, 30), label: 'label' });
  return store.get();
}

/** Decodes the fixtures' PNGs (8-bit, filter 0 on every row) to straight RGBA. */
export const fixtureDecoder: PixelDecoder = async (bytes) => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 8;
  let width = 0;
  let height = 0;
  let type = 0;
  const idat: Uint8Array[] = [];
  while (at < bytes.length) {
    const len = view.getUint32(at);
    const tag = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    const body = bytes.subarray(at + 8, at + 8 + len);
    if (tag === 'IHDR') {
      width = view.getUint32(at + 8);
      height = view.getUint32(at + 12);
      type = bytes[at + 17];
    } else if (tag === 'IDAT') idat.push(body);
    at += 12 + len;
  }
  const per = type === 0 ? 1 : type === 2 ? 3 : 4;
  const joined = new Uint8Array(idat.reduce((a, b) => a + b.length, 0));
  let o = 0;
  for (const b of idat) {
    joined.set(b, o);
    o += b.length;
  }
  const raw = inflateSync(joined);
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const row = y * (1 + width * per);
    if (raw[row] !== 0) throw new Error('the fixture decoder reads filter 0 only');
    for (let x = 0; x < width; x++) {
      const s = row + 1 + x * per;
      const d = 4 * (y * width + x);
      rgba[d] = raw[s];
      rgba[d + 1] = per === 1 ? raw[s] : raw[s + 1];
      rgba[d + 2] = per === 1 ? raw[s] : raw[s + 2];
      rgba[d + 3] = per === 4 ? raw[s + 3] : 255;
    }
  }
  return { width, height, rgba };
};
