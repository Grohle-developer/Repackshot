// PLY: an ASCII cube committed as a fixture, and the same cube written in the
// test as binary little and big endian, with normals, and without faces.

import { describe, expect, it } from 'vitest';
import { describePayload } from '../src/core/import-options';
import { detectFormat, importFile } from '../src/io/import';
import cubeAscii from './fixtures/cube.ply?raw';
import { encode, meshOf, partsOf, readWithDefaults } from './io-helpers';

const CORNERS = [
  [-10, -10, -10], [10, -10, -10], [10, 10, -10], [-10, 10, -10],
  [-10, -10, 10], [10, -10, 10], [10, 10, 10], [-10, 10, 10],
];
const QUADS = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]];

/** The cube as a binary PLY; with `normals` every vertex also carries the unit vector towards its corner. */
function binaryCube(little: boolean, normals = false): Uint8Array {
  const header =
    `ply\nformat binary_${little ? 'little' : 'big'}_endian 1.0\nelement vertex 8\nproperty float x\nproperty float y\nproperty float z\n` +
    (normals ? 'property float nx\nproperty float ny\nproperty float nz\n' : '') +
    `element face 6\nproperty list uchar int vertex_indices\nend_header\n`;
  const h = encode(header);
  const per = normals ? 6 : 3;
  const out = new Uint8Array(h.length + 8 * per * 4 + 6 * (1 + 16));
  out.set(h, 0);
  const dv = new DataView(out.buffer);
  let o = h.length;
  for (const c of CORNERS) {
    const l = Math.hypot(...c);
    for (const v of normals ? [...c, ...c.map((x) => x / l)] : c) {
      dv.setFloat32(o, v, little);
      o += 4;
    }
  }
  for (const q of QUADS) {
    dv.setUint8(o++, 4);
    for (const i of q) {
      dv.setInt32(o, i, little);
      o += 4;
    }
  }
  return out;
}

describe('PLY: the ASCII cube', () => {
  it('is one part: parts, groups, triangles, vertices, materials', async () => {
    const r = await importFile({ name: 'cube.ply', bytes: encode(cubeAscii) });
    expect(r.format).toBe('PLY');
    expect(describePayload(r)).toEqual({ parts: 1, groups: 0, triangles: 12, materials: 1 });
    const [cube] = partsOf(r);
    expect(cube.name).toBe('cube');
    expect(cube.mesh).toMatchObject({ vertices: 24, triangles: 12 });
    expect(meshOf(cube).sharpEdges!.length / 2).toBe(12);
    expect(cube.mesh!.bounds.max).toEqual([10, 10, 10]);
    expect(r.materials.tm_default.role).toBe('DEFAULT');
    expect(r.notes).toEqual([]);
  });

  it('has no units and no axis of its own: Z up by convention, the size decides the units', async () => {
    const r = await importFile({ name: 'cube.ply', bytes: encode(cubeAscii) });
    expect(r.detected).toEqual({ units: null, upAxis: 'Z', upAxisDeclared: false, size: 20, hasLayers: false, hiddenParts: 0 });
    const d = await readWithDefaults({ name: 'cube.ply', bytes: encode(cubeAscii) });
    expect(d.options).toMatchObject({ units: 'mm', upAxis: 'Z' });
    // A cube of 0.02 is metres.
    const tiny = await readWithDefaults({ name: 'tiny.ply', bytes: encode(cubeAscii.replace(/^(-?10) (-?10) (-?10)$/gm, (_m, a, b, c) => `${a / 1000} ${b / 1000} ${c / 1000}`)) });
    expect(tiny.options.units).toBe('m');
    expect(partsOf(tiny)[0].mesh!.bounds.max[0]).toBeCloseTo(10, 4);
  });

  it('is found by its extension and by its first line', () => {
    expect(detectFormat('cube.PLY', new Uint8Array(0))).toBe('PLY');
    expect(detectFormat('cube.dat', encode(cubeAscii))).toBe('PLY');
    expect(detectFormat('cube.dat', binaryCube(true))).toBe('PLY');
  });
});

describe('PLY: binary', () => {
  it.each([true, false])('little endian %s gives the same cube as the ASCII file', async (little) => {
    const ascii = await importFile({ name: 'cube.ply', bytes: encode(cubeAscii) });
    const bin = await importFile({ name: 'cube.ply', bytes: binaryCube(little) });
    expect(describePayload(bin)).toEqual(describePayload(ascii));
    expect(partsOf(bin)[0].mesh).toMatchObject({ vertices: 24, triangles: 12 });
    expect(Array.from(meshOf(partsOf(bin)[0]).positions)).toEqual(Array.from(meshOf(partsOf(ascii)[0]).positions));
  });

  it('keeps the normals a file carries instead of recomputing them', async () => {
    const r = await importFile({ name: 'smooth.ply', bytes: binaryCube(true, true) });
    // Normals towards the corners: one per corner, so the corners are not split.
    expect(partsOf(r)[0].mesh).toMatchObject({ vertices: 8, triangles: 12 });
    const m = meshOf(partsOf(r)[0]);
    for (let i = 0; i < m.normals.length; i += 3) expect(Math.abs(m.normals[i])).toBeCloseTo(1 / Math.sqrt(3), 5);
  });
});

describe('PLY: what it cannot use', () => {
  it('says so for a file without faces: a point cloud', async () => {
    const cloud = 'ply\nformat ascii 1.0\nelement vertex 3\nproperty float x\nproperty float y\nproperty float z\nend_header\n0 0 0\n1 0 0\n0 1 0\n';
    await expect(importFile({ name: 'cloud.ply', bytes: encode(cloud) })).rejects.toThrow('no faces found');
  });

  it('notes vertex colours, which are not used yet', async () => {
    const coloured = cubeAscii
      .replace('property float z\nelement face', 'property float z\nproperty uchar red\nproperty uchar green\nproperty uchar blue\nelement face')
      .replace(/^(-?10 -?10 -?10)$/gm, '$1 200 40 30');
    const r = await importFile({ name: 'scan.ply', bytes: encode(coloured) });
    expect(r.notes).toEqual([{ code: 'vertexColors', params: {} }]);
    expect(describePayload(r).parts).toBe(1);
  });
});
