import { describe, expect, it } from 'vitest';
import { boundsOf, measuredSizeMm } from '../src/core/scene';
import { createInitialState, reduce } from '../src/core/store';
import { detectFormat, importFile } from '../src/io/import';
import { buildMesh } from '../src/io/mesh-common';
import cubeTwoGroups from './fixtures/cube-two-groups.obj?raw';
import tetrahedronAscii from './fixtures/tetrahedron.stl?raw';
import { binaryStl, encode, meshOf, partsOf, roof } from './io-helpers';

/** A GLB with one triangle named "Tri": enough to take the glTF path of importFile. */
function glb(): Uint8Array {
  const pos = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const json = JSON.stringify({
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: 'Tri' }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] }],
    bufferViews: [{ buffer: 0, byteLength: 36 }],
    buffers: [{ byteLength: 36 }],
  });
  const j = new TextEncoder().encode(json + ' '.repeat((4 - (json.length % 4)) % 4));
  const total = 12 + 8 + j.length + 8 + 36;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true);
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  dv.setUint32(12, j.length, true);
  dv.setUint32(16, 0x4e4f534a, true);
  out.set(j, 20);
  const o = 20 + j.length;
  dv.setUint32(o, 36, true);
  dv.setUint32(o + 4, 0x004e4942, true);
  out.set(new Uint8Array(pos.buffer), o + 8);
  return out;
}

describe('detectFormat', () => {
  const tetra = binaryStl([[0, 0, 0, 1, 0, 0, 0, 1, 0]]);

  it('uses the extension, case aside', () => {
    expect(detectFormat('a.obj', encode('v 0 0 0'))).toBe('OBJ');
    expect(detectFormat('A.OBJ', encode('anything'))).toBe('OBJ');
    expect(detectFormat('a.stl', tetra)).toBe('STL');
    expect(detectFormat('a.gltf', encode('{}'))).toBe('GLTF');
    expect(detectFormat('a.glb', glb())).toBe('GLTF');
  });

  it('trusts the glTF magic number over a wrong extension', () => {
    expect(detectFormat('renamed.dat', glb())).toBe('GLTF');
    expect(detectFormat('renamed.obj', glb())).toBe('GLTF');
  });

  it('sniffs the header when the extension says nothing', () => {
    expect(detectFormat('part.dat', tetra)).toBe('STL');
    expect(detectFormat('part.txt', encode(tetrahedronAscii))).toBe('STL');
    expect(detectFormat('part', encode(cubeTwoGroups))).toBe('OBJ');
    expect(detectFormat('part.json', encode('{ "asset": { "version": "2.0" } }'))).toBe('GLTF');
    expect(detectFormat('part.bin', encode('nothing to see here'))).toBeNull();
    expect(detectFormat('part.step', encode('ISO-10303-21;'))).toBeNull();
  });

  it('rejects a file it cannot place with a reason', async () => {
    await expect(importFile({ name: 'x.bin', bytes: encode('nothing') })).rejects.toThrow('unknown file format');
  });
});

describe('importFile', () => {
  it('reads a File as it reads bytes', async () => {
    const fromFile = await importFile(new File([cubeTwoGroups], 'cube.obj'));
    const fromBytes = await importFile({ name: 'cube.obj', bytes: encode(cubeTwoGroups) });
    expect(partsOf(fromFile).map((p) => p.mesh!.vertices)).toEqual(partsOf(fromBytes).map((p) => p.mesh!.vertices));
    // ArrayBuffer and a view with an offset work too.
    const buf = encode(cubeTwoGroups);
    const padded = new Uint8Array(buf.length + 7);
    padded.set(buf, 7);
    const viewed = await importFile({ name: 'cube.obj', bytes: padded.subarray(7) });
    expect(partsOf(viewed).map((p) => p.name)).toEqual(['Caps', 'Body']);
    const whole = await importFile({ name: 'cube.obj', bytes: buf.buffer.slice(0) as ArrayBuffer });
    expect(partsOf(whole).map((p) => p.name)).toEqual(['Caps', 'Body']);
  });

  it('sends glTF through the same entry point', async () => {
    const r = await importFile({ name: 'tri.glb', bytes: glb() });
    expect(r.format).toBe('GLTF');
    expect(partsOf(r).map((p) => p.name)).toEqual(['Tri']);
    expect(r.nodes[r.roots[0]].source).toEqual({ kind: 'FILE', name: 'tri.glb', format: 'GLTF' });
    expect(r.warnings).toEqual([]);
    expect(r.notes).toEqual([]);
  });

  it('gives sharp edges as index pairs inside the mesh, for every format', async () => {
    const results = [
      await importFile({ name: 'cube.obj', bytes: encode(cubeTwoGroups) }),
      await importFile({ name: 't.stl', bytes: encode(tetrahedronAscii) }),
      await importFile({ name: 'r.stl', bytes: binaryStl(roof(60)) }),
    ];
    for (const r of results) {
      for (const p of partsOf(r)) {
        const m = meshOf(p);
        expect(m.sharpEdges).toBeInstanceOf(Uint32Array);
        expect(m.sharpEdges!.length % 2).toBe(0);
        for (const i of m.sharpEdges!) expect(i).toBeLessThan(p.mesh!.vertices);
        for (let e = 0; e < m.sharpEdges!.length; e += 2) expect(m.sharpEdges![e]).not.toBe(m.sharpEdges![e + 1]);
      }
    }
  });

  it('registers distinct meshes for every import, so importing twice does not overwrite', async () => {
    const a = await importFile({ name: 'cube.obj', bytes: encode(cubeTwoGroups) });
    const b = await importFile({ name: 'cube.obj', bytes: encode(cubeTwoGroups) });
    const ids = [...partsOf(a), ...partsOf(b)].map((p) => p.mesh!.id);
    expect(new Set(ids).size).toBe(4);
  });
});

describe('what the interface does with an import', () => {
  it('adds the model, detects the part size, rests it on the floor and keeps the materials', async () => {
    const r = await importFile({ name: 'cube.obj', bytes: encode(cubeTwoGroups) });
    let s = reduce(createInitialState(), { type: 'scene/addModel', payload: { nodes: r.nodes, roots: r.roots, materials: r.materials }, replace: true });
    expect(s.scene.partSizeMm).toBe(20);
    expect(measuredSizeMm(s)).toBeCloseTo(20, 4);
    expect(Object.values(s.materials).map((m) => m.name ?? 'Default').sort()).toEqual(['Default', 'Steel']);
    s = reduce(s, { type: 'scene/restOnFloor', ids: [s.scene.roots[0]] });
    const b = boundsOf(s, s.scene.roots);
    expect(b.min[2]).toBeCloseTo(0, 6);
    expect(b.max[2]).toBeCloseTo(20, 4);
    // The parts keep their own pivots at their bounds' centres.
    const parts = Object.values(s.scene.nodes).filter((n) => n.kind === 'PART');
    expect(parts).toHaveLength(2);
    expect(parts.every((p) => p.material && s.materials[p.material])).toBe(true);
  });
});

describe('buildMesh', () => {
  const tri = (a: number[], b: number[], c: number[]) => [...a, ...b, ...c];

  it('uses the stored facet normal only when the smoothed normal cancels out', () => {
    // Two coincident triangles facing opposite ways, smoothed together (180 degrees): the sum is zero.
    const positions = Float32Array.from([...tri([0, 0, 0], [1, 0, 0], [0, 1, 0]), ...tri([0, 0, 0], [0, 1, 0], [1, 0, 0])]);
    const withStored = buildMesh({ positions: positions.slice(), facetNormals: Float32Array.from([1, 0, 0, 0, 0, -1]) }, { smoothDeg: 180 })!;
    expect(withStored.data.positions.length / 3).toBe(3);
    for (let i = 0; i < 9; i += 3) expect(Array.from(withStored.data.normals.subarray(i, i + 3))).toEqual([1, 0, 0]);
    // Without a stored one, the first face's computed normal.
    const computed = buildMesh({ positions: positions.slice() }, { smoothDeg: 180 })!;
    for (let i = 0; i < 9; i += 3) expect(Array.from(computed.data.normals.subarray(i, i + 3))).toEqual([0, 0, 1]);
    // And a stored normal does not override a healthy computed one.
    const healthy = buildMesh({ positions: positions.slice(0, 9), facetNormals: Float32Array.from([1, 0, 0]) })!;
    expect(Array.from(healthy.data.normals.subarray(0, 3))).toEqual([0, 0, 1]);
  });

  it('makes an edge shared by three faces hard and splits the vertices along it', () => {
    // Three fins on the edge from (0,0,0) to (1,0,0), 120 degrees apart.
    const fin = (deg: number) => {
      const a = (deg * Math.PI) / 180;
      return tri([0, 0, 0], [1, 0, 0], [0.5, Math.cos(a), Math.sin(a)]);
    };
    const built = buildMesh({ positions: Float32Array.from([...fin(0), ...fin(120), ...fin(240)]) })!;
    expect(built.data.indices.length / 3).toBe(3);
    expect(built.data.positions.length / 3).toBe(9);
    expect(built.data.sharpEdges!.length / 2).toBe(1);
  });

  it('splits a vertex along a uv seam without making the edge hard', () => {
    // A flat quad of two triangles whose shared diagonal has different uvs on each side.
    const positions = Float32Array.from([...tri([0, 0, 0], [1, 0, 0], [1, 1, 0]), ...tri([0, 0, 0], [1, 1, 0], [0, 1, 0])]);
    const uvs = Float32Array.from([0, 0, 1, 0, 1, 1, 0.5, 0.5, 0.8, 0.8, 0, 1]);
    const built = buildMesh({ positions, uvs })!;
    expect(built.data.positions.length / 3).toBe(6);
    expect(built.data.sharpEdges!.length).toBe(0);
    expect(built.data.uvs!.length).toBe(12);
  });

  it('drops triangles with a missing coordinate and returns null when nothing is left', () => {
    const mixed = buildMesh({ positions: Float32Array.from([...tri([0, 0, 0], [1, 0, 0], [0, 1, 0]), ...tri([NaN, 0, 0], [1, 0, 0], [0, 1, 0])]) })!;
    expect(mixed.dropped).toBe(1);
    expect(Array.from(mixed.source)).toEqual([0]);
    expect(buildMesh({ positions: Float32Array.from(tri([0, 0, 0], [1, 1, 1], [2, 2, 2])) })).toBeNull();
    expect(buildMesh({ positions: new Float32Array(0) })).toBeNull();
  });

  it('is exact and fast enough for a mesh of 100 000 triangles', () => {
    const n = 224; // 224 x 224 x 2 = 100 352 triangles of a flat grid
    const tris: number[] = [];
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) tris.push(...tri([x, y, 0], [x + 1, y, 0], [x + 1, y + 1, 0]), ...tri([x, y, 0], [x + 1, y + 1, 0], [x, y + 1, 0]));
    const t0 = performance.now();
    const built = buildMesh({ positions: Float32Array.from(tris) })!;
    const ms = performance.now() - t0;
    expect(built.data.positions.length / 3).toBe((n + 1) * (n + 1));
    expect(built.data.indices.length / 3).toBe(2 * n * n);
    expect(built.data.sharpEdges!.length).toBe(0);
    expect(ms).toBeLessThan(10_000);
  });
});
