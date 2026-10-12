import { describe, expect, it } from 'vitest';
import { fixDoctor, runDoctor } from '../src/core/doctor';
import { measuredSizeMm } from '../src/core/scene';
import { createInitialState, reduce } from '../src/core/store';
import { importFile } from '../src/io/import';
import tetrahedronAscii from './fixtures/tetrahedron.stl?raw';
import { binaryStl, distinctPositions, encode, meshOf, normalLengthError, partsOf, roof, sharpEdgeSegments } from './io-helpers';

/** The tetrahedron of the ASCII fixture, facet by facet: 10 mm legs on the three axes. */
const TETRA: number[][] = [
  [0, 0, 0, 0, 10, 0, 10, 0, 0],
  [0, 0, 0, 0, 0, 10, 0, 10, 0],
  [0, 0, 0, 10, 0, 0, 0, 0, 10],
  [10, 0, 0, 0, 10, 0, 0, 0, 10],
];

const readAscii = (name: string, text: string) => importFile({ name, bytes: encode(text) });
const readBinary = (name: string, triangles: number[][], header?: string) => importFile({ name, bytes: binaryStl(triangles, header) });

describe('STL: the same tetrahedron as binary and ASCII', () => {
  it('welds to 4 positions, 4 triangles, 12 vertices (split along hard edges) and 6 hard edges', async () => {
    // The binary header starts with "solid" and even says "facet", as some exporters write it: the size check must win.
    const binary = await readBinary('tetra.stl', TETRA, 'solid facet export by a CAD program (not text)');
    const ascii = await readAscii('tetra.stl', tetrahedronAscii);
    for (const r of [binary, ascii]) {
      expect(r.format).toBe('STL');
      expect(r.notes).toEqual([]);
      expect(r.warnings).toEqual([]);
      const parts = partsOf(r);
      expect(parts).toHaveLength(1);
      expect(parts[0].name).toBe('tetra');
      expect(parts[0].mesh).toMatchObject({ vertices: 12, triangles: 4 });
      const mesh = meshOf(parts[0]);
      expect(distinctPositions(mesh)).toBe(4);
      expect(mesh.sharpEdges!.length / 2).toBe(6);
      // The six hard edges are the six different edges of the tetrahedron.
      const edges = new Set(sharpEdgeSegments(mesh).map((s) => [s.slice(0, 3).join(), s.slice(3).join()].sort().join('|')));
      expect(edges.size).toBe(6);
      expect(normalLengthError(mesh)).toBeLessThan(1e-6);
      // Every face keeps its own normal: 3 vertices per triangle all equal, and 4 different normals in all.
      const normals = new Set<string>();
      for (let t = 0; t < 12; t += 3) {
        const n = [0, 1, 2].map((k) => Array.from(mesh.normals.subarray(3 * mesh.indices[t + k], 3 * mesh.indices[t + k] + 3)).map((x) => x.toFixed(4)).join());
        expect(new Set(n).size).toBe(1);
        normals.add(n[0]);
      }
      expect(normals.size).toBe(4);
      expect(normals.has([0, 0, -1].map((x) => x.toFixed(4)).join())).toBe(true);
      expect(normals.has([1, 1, 1].map((x) => (x / Math.sqrt(3)).toFixed(4)).join())).toBe(true);
    }
    // Identical after welding, whichever encoding the file used.
    const a = meshOf(partsOf(binary)[0]);
    const b = meshOf(partsOf(ascii)[0]);
    expect(Array.from(b.positions)).toEqual(Array.from(a.positions));
    expect(Array.from(b.normals)).toEqual(Array.from(a.normals));
    expect(Array.from(b.indices)).toEqual(Array.from(a.indices));
    expect(Array.from(b.sharpEdges!)).toEqual(Array.from(a.sharpEdges!));
  });

  it('keeps STL axes (Z up) and re-centres the part on its bounds', async () => {
    const r = await readBinary('tetra.stl', TETRA);
    const [p] = partsOf(r);
    expect(p.transform.position).toEqual([5, 5, 5]);
    expect(p.mesh!.bounds.min).toEqual([-5, -5, -5]);
    expect(p.mesh!.bounds.max).toEqual([5, 5, 5]);
    expect(Object.keys(r.materials)).toEqual(['tm_default']);
    expect(p.material).toBe('tm_default');
  });

  it('computes normals from the geometry: wrong or empty facet normals in the file change nothing', async () => {
    const good = binaryStl(TETRA);
    const bad = good.slice();
    const dv = new DataView(bad.buffer);
    // Zero the normal of the first facet and flip the second.
    for (let k = 0; k < 3; k++) dv.setFloat32(84 + 4 * k, 0, true);
    for (let k = 0; k < 3; k++) dv.setFloat32(84 + 50 + 4 * k, -dv.getFloat32(84 + 50 + 4 * k, true), true);
    const a = meshOf(partsOf(await importFile({ name: 'a.stl', bytes: good }))[0]);
    const b = meshOf(partsOf(await importFile({ name: 'a.stl', bytes: bad }))[0]);
    expect(Array.from(b.normals)).toEqual(Array.from(a.normals));
  });

  it('reads an ASCII file with CRLF line ends the same as LF', async () => {
    const lf = await readAscii('tetra.stl', tetrahedronAscii);
    const crlf = await readAscii('tetra.stl', tetrahedronAscii.replace(/\n/g, '\r\n'));
    expect(Array.from(meshOf(partsOf(crlf)[0]).positions)).toEqual(Array.from(meshOf(partsOf(lf)[0]).positions));
    expect(partsOf(crlf)[0].mesh!.triangles).toBe(4);
  });
});

describe('STL: detection', () => {
  it('takes a file as binary only when its size is exactly 84 + 50 n', async () => {
    const bytes = binaryStl(TETRA);
    // One byte more: not binary any more, and it does not read as ASCII either.
    const longer = new Uint8Array(bytes.length + 1);
    longer.set(bytes);
    await expect(importFile({ name: 'x.stl', bytes: longer })).rejects.toThrow('not a binary or ASCII STL');
    await expect(importFile({ name: 'x.stl', bytes: bytes.subarray(0, bytes.length - 1) })).rejects.toThrow('not a binary or ASCII STL');
  });

  it('accepts ASCII only when it starts with solid and has a facet', async () => {
    await expect(readAscii('x.stl', 'solid empty\nendsolid empty\n')).rejects.toThrow('not a binary or ASCII STL');
    await expect(readAscii('x.stl', 'hello facet normal 0 0 1')).rejects.toThrow('not a binary or ASCII STL');
    await expect(readAscii('x.stl', 'solid x\nfacet normal 0 0 1\nouter loop\nendloop\nendfacet\nendsolid\n')).rejects.toThrow('no facets found');
  });

  it('reads a binary file that declares zero facets as an error with a reason', async () => {
    await expect(readBinary('x.stl', [])).rejects.toThrow('no facets found');
  });
});

describe('STL: parts', () => {
  const solid = (name: string, dx: number) =>
    `solid ${name}\n` +
    TETRA.map((t) => `facet normal 0 0 1\nouter loop\n${[0, 1, 2].map((k) => `vertex ${t[3 * k] + dx} ${t[3 * k + 1]} ${t[3 * k + 2]}`).join('\n')}\nendloop\nendfacet\n`).join('') +
    `endsolid ${name}\n`;

  it('gives one part per solid block of an ASCII file, named after the solid', async () => {
    const r = await readAscii('pair.stl', solid('left', 0) + solid('right', 30));
    const parts = partsOf(r);
    expect(parts.map((p) => p.name)).toEqual(['left', 'right']);
    expect(parts.map((p) => p.mesh!.triangles)).toEqual([4, 4]);
    expect(parts[1].transform.position).toEqual([35, 5, 5]);
    const unnamed = await readAscii('pair.stl', solid('', 0) + solid('', 30));
    expect(partsOf(unnamed).map((p) => p.name)).toEqual(['pair 1', 'pair 2']);
  });

  it('names a single solid after the file', async () => {
    const r = await readAscii('bottle cap.STL', solid('whatever', 0));
    expect(partsOf(r).map((p) => p.name)).toEqual(['bottle cap']);
  });
});

describe('STL: welding and normals', () => {
  // Two triangles that make a 100 x 100 square in the XY plane, sharing a diagonal.
  const square = (nudge: number): number[][] => [
    [0, 0, 0, 100, 0, 0, 100, 100, 0],
    [0 + nudge, 0, 0, 100 + nudge, 100, 0, 0, 100, 0],
  ];

  it('welds positions that differ by less than 1e-5 of the mesh size, and only those', async () => {
    // The shared corners differ by 5e-4 (5e-6 of the size): welded, so the square has 4 vertices.
    const near = await readBinary('sq.stl', square(5e-4));
    expect(partsOf(near)[0].mesh).toMatchObject({ vertices: 4, triangles: 2 });
    expect(meshOf(partsOf(near)[0]).sharpEdges!.length).toBe(0);
    // By 5e-3 (5e-5 of the size) they are different vertices: nothing is shared.
    const far = await readBinary('sq.stl', square(5e-3));
    expect(partsOf(far)[0].mesh).toMatchObject({ vertices: 6, triangles: 2 });
    // Exactly equal bits weld, of course.
    const same = await readBinary('sq.stl', square(0));
    expect(partsOf(same)[0].mesh).toMatchObject({ vertices: 4, triangles: 2 });
  });

  it('welds across the cell boundaries of the tolerance grid', async () => {
    // Every column edge sits on a wall of the 2e-3 grid; its copy is 5e-4 away on one side or the other,
    // so the partners fall in neighbouring cells. They must weld all the same.
    const tris: number[][] = [];
    for (let i = 0; i < 40; i++) {
      const x = i * 2.5;
      const nudge = i % 2 ? 5e-4 : -5e-4;
      tris.push([x, 0, 0, x + 2.5, 0, 0, x, 50, 0]);
      tris.push([x + 2.5 + nudge, 0, 0, x + 2.5, 50, 0, x, 50, 0]);
    }
    const r = await readBinary('strip.stl', tris);
    // 41 columns of 2 vertices (top and bottom).
    expect(partsOf(r)[0].mesh).toMatchObject({ vertices: 82, triangles: 80 });
  });

  it('shares vertex normals across a 20 degree fold and splits a 40 degree one', async () => {
    const smooth = await readBinary('roof.stl', roof(20));
    expect(partsOf(smooth)[0].mesh).toMatchObject({ vertices: 6, triangles: 4 });
    expect(meshOf(partsOf(smooth)[0]).sharpEdges!.length).toBe(0);
    const hard = await readBinary('roof.stl', roof(40));
    expect(partsOf(hard)[0].mesh).toMatchObject({ vertices: 8, triangles: 4 });
    expect(meshOf(partsOf(hard)[0]).sharpEdges!.length / 2).toBe(1);
    for (const r of [smooth, hard]) expect(normalLengthError(meshOf(partsOf(r)[0]))).toBeLessThan(1e-6);
  });

  it('drops a degenerate facet and reports it', async () => {
    const withSliver = [...TETRA, [0, 0, 0, 5, 5, 5, 10, 10, 10], [1, 1, 1, 1, 1, 1, 2, 3, 4]];
    const r = await readBinary('sliver.stl', withSliver);
    expect(partsOf(r)[0].mesh!.triangles).toBe(4);
    expect(r.warnings).toEqual([{ code: 'degenerate', params: { part: 'sliver', count: 2 } }]);
    const ascii = await readAscii(
      'sliver.stl',
      tetrahedronAscii.replace('endsolid tetrahedron', 'facet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 5 5 5\nvertex 10 10 10\nendloop\nendfacet\nendsolid tetrahedron'),
    );
    expect(partsOf(ascii)[0].mesh!.triangles).toBe(4);
    expect(ascii.warnings).toEqual([{ code: 'degenerate', params: { part: 'sliver', count: 1 } }]);
  });

  it('drops an ASCII facet that lost a vertex without shifting the ones after it', async () => {
    const broken = tetrahedronAscii.replace('      vertex 0 10 0\n    endloop\n  endfacet\n  facet normal 0 -1 0', '    endloop\n  endfacet\n  facet normal 0 -1 0');
    expect(broken).not.toBe(tetrahedronAscii);
    const r = await readAscii('broken.stl', broken);
    expect(partsOf(r)[0].mesh!.triangles).toBe(3);
    expect(r.warnings).toEqual([{ code: 'badFace', params: { count: 1 } }]);
  });
});

describe('STL: size and units', () => {
  it('a 0.03 tall part in a jewellery studio is in metres: the note, then the Doctor fix x1000', async () => {
    const small = TETRA.map((t) => t.map((x) => x * 0.003));
    const r = await readBinary('ring.stl', small);
    expect(r.notes).toEqual([{ code: 'scaleSmall', params: { size: 0.03, factor: 1000 } }]);
    expect(r.nodes[r.roots[0]].source).toEqual({ kind: 'FILE', name: 'ring.stl', format: 'STL', unitHint: 1000 });
    // The geometry is not touched.
    expect(partsOf(r)[0].mesh!.bounds.max[0]).toBeCloseTo(0.015, 6);

    let s = reduce(createInitialState(), { type: 'scene/addModel', payload: r, replace: true });
    s = reduce(s, { type: 'studio/setPreset', key: 'JEWELLERY' });
    expect(measuredSizeMm(s)).toBeCloseTo(0.03, 6);
    const scale = runDoctor(s).find((x) => x.key === 'scale')!;
    expect(scale.status).toBe('WARN');
    expect(scale.detail).toMatchObject({ reason: 'preset', actual: 0.03, expected: 30, factor: 1000 });
    s = fixDoctor(s, 'scale');
    expect(measuredSizeMm(s)).toBeCloseTo(30, 4);
    expect(runDoctor(s).find((x) => x.key === 'scale')!.status).toBe('OK');
  });

  it('a part of plausible size gets no note', async () => {
    expect((await readBinary('ok.stl', TETRA)).notes).toEqual([]);
  });
});
