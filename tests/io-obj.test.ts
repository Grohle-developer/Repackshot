import { describe, expect, it } from 'vitest';
import { reduce, createInitialState } from '../src/core/store';
import { runDoctor, fixDoctor } from '../src/core/doctor';
import { boundsOf, measuredSizeMm } from '../src/core/scene';
import type { ImportOptions } from '../src/core/import-options';
import cubeTwoGroups from './fixtures/cube-two-groups.obj?raw';
import { distinctPositions, encode, meshOf, normalLengthError, partsOf, readWithDefaults, roof, sharpEdgeSegments } from './io-helpers';

const read = (name: string, text: string, overrides: Partial<ImportOptions> = {}) => readWithDefaults({ name, bytes: encode(text) }, overrides);

/** The same cube without group or material statements: one part. */
const singlePartCube = cubeTwoGroups.replace(/^(g|usemtl) .*$/gm, '');

/** An OBJ from triangles of 9 numbers; every corner gets its own `v` line. */
function objOf(triangles: number[][]): string {
  const lines: string[] = [];
  triangles.forEach((t, i) => {
    for (let k = 0; k < 3; k++) lines.push(`v ${t[3 * k]} ${t[3 * k + 1]} ${t[3 * k + 2]}`);
    lines.push(`f ${3 * i + 1} ${3 * i + 2} ${3 * i + 3}`);
  });
  return lines.join('\n');
}

describe('OBJ: a cube with two groups and one material', () => {
  it('gives two parts with exact vertex, triangle, sharp-edge and material counts', async () => {
    const r = await read('cube-two-groups.obj', cubeTwoGroups);
    expect(r.format).toBe('OBJ');
    const model = r.nodes[r.roots[0]];
    expect(model.kind).toBe('MODEL');
    expect(model.name).toBe('cube-two-groups');
    expect(model.source).toEqual({ kind: 'FILE', name: 'cube-two-groups.obj', format: 'OBJ' });

    const parts = partsOf(r);
    expect(parts.map((p) => p.name)).toEqual(['Caps', 'Body']);
    expect(parts.every((p) => p.kind === 'PART' && p.smooth === true && p.parent === model.id)).toBe(true);

    // Caps: two separate quads, 4 vertices and 2 triangles each; their edges are open, not hard.
    const [caps, body] = parts;
    expect(caps.mesh).toMatchObject({ vertices: 8, triangles: 4 });
    expect(meshOf(caps).sharpEdges!.length).toBe(0);
    // Body: four quads around a tube. The four vertical edges are hard, so every quad keeps its own 4 vertices.
    expect(body.mesh).toMatchObject({ vertices: 16, triangles: 8 });
    expect(meshOf(body).sharpEdges!.length / 2).toBe(4);
    for (const p of parts) expect(normalLengthError(meshOf(p))).toBeLessThan(1e-6);

    // Materials: Steel (SIMPLE, grey) for the Body, the neutral Default for the Caps.
    expect(Object.keys(r.materials).sort()).toEqual(['tm1', 'tm_default']);
    expect(body.material).toBe('tm1');
    expect(r.materials.tm1).toMatchObject({ name: 'Steel', family: 'SIMPLE' });
    expect(r.materials.tm1.params.baseColor).toEqual([0.8, 0.8, 0.8, 1]);
    expect(caps.material).toBe('tm_default');
    expect(r.materials.tm_default.role).toBe('DEFAULT');
    expect(caps.faceMaterials).toBeUndefined();
    expect(body.faceMaterials).toBeUndefined();

    // The .mtl is not read; the importer says so. Nothing was dropped.
    expect(r.notes).toEqual([{ code: 'mtlIgnored', params: { files: 'cube.mtl' } }]);
    expect(r.warnings).toEqual([]);
  });

  it('welds the cube to 8 positions: one part, 24 vertices, 12 triangles and the 12 edges as hard edges', async () => {
    const r = await read('cube.obj', singlePartCube);
    const [cube] = partsOf(r);
    expect(partsOf(r)).toHaveLength(1);
    expect(cube.name).toBe('cube');
    expect(cube.mesh).toMatchObject({ vertices: 24, triangles: 12 });
    const mesh = meshOf(cube);
    expect(distinctPositions(mesh)).toBe(8);
    expect(mesh.sharpEdges!.length / 2).toBe(12);
    // Every hard edge is a real edge of the cube (20 long), none is a face diagonal.
    for (const s of sharpEdgeSegments(mesh)) expect(Math.hypot(s[0] - s[3], s[1] - s[4], s[2] - s[5])).toBeCloseTo(20, 4);
    // Normals are unit and axis-aligned: smoothing never crosses a 90 degree edge.
    expect(normalLengthError(mesh)).toBeLessThan(1e-6);
    for (let i = 0; i < mesh.normals.length; i += 3) expect(Math.max(...[0, 1, 2].map((k) => Math.abs(mesh.normals[i + k])))).toBeCloseTo(1, 6);
    // Outward: each vertex lies on a face of the cube and its normal is that face's, pointing away from the centre.
    for (let i = 0; i < mesh.positions.length; i += 3) {
      const k = [0, 1, 2].reduce((best, j) => (Math.abs(mesh.normals[i + j]) > Math.abs(mesh.normals[i + best]) ? j : best), 0);
      expect(Math.abs(mesh.positions[i + k])).toBeCloseTo(10, 4);
      expect(Math.sign(mesh.normals[i + k])).toBe(Math.sign(mesh.positions[i + k]));
    }
  });

  it('reads CRLF and LF alike', async () => {
    const lf = await read('cube.obj', cubeTwoGroups);
    const crlf = await read('cube.obj', cubeTwoGroups.replace(/\n/g, '\r\n'));
    expect(partsOf(crlf).map((p) => p.name)).toEqual(['Caps', 'Body']);
    expect(crlf.materials.tm1.name).toBe('Steel');
    expect(crlf.notes).toEqual([{ code: 'mtlIgnored', params: { files: 'cube.mtl' } }]);
    for (let i = 0; i < 2; i++) {
      const a = meshOf(partsOf(lf)[i]);
      const b = meshOf(partsOf(crlf)[i]);
      expect(Array.from(b.positions)).toEqual(Array.from(a.positions));
      expect(Array.from(b.indices)).toEqual(Array.from(a.indices));
      expect(Array.from(b.sharpEdges!)).toEqual(Array.from(a.sharpEdges!));
    }
  });
});

describe('OBJ: axes and part pivots', () => {
  it('converts Y up to Z up and re-centres each part on its bounds', async () => {
    // A box 20 wide (x), 40 tall (y, up in the file) and 10 deep (z).
    const text = `v 0 0 0\nv 20 0 0\nv 20 40 0\nv 0 40 0\nv 0 0 10\nv 20 0 10\nv 20 40 10\nv 0 40 10\n` + `f 1 4 3 2\nf 5 6 7 8\nf 1 2 6 5\nf 3 4 8 7\nf 1 5 8 4\nf 2 3 7 6\n`;
    const r = await read('box.obj', text);
    const [box] = partsOf(r);
    // Model axes: x stays, file z becomes -y, file y becomes z.
    expect(box.mesh!.bounds.min).toEqual([-10, -5, -20]);
    expect(box.mesh!.bounds.max).toEqual([10, 5, 20]);
    expect(box.transform.position).toEqual([10, -5, 20]);
    // Rotating does not flip the faces: the top face (+y in the file) points up (+z) in the model.
    const mesh = meshOf(box);
    const up = Array.from({ length: mesh.positions.length / 3 }, (_, i) => i).filter((i) => mesh.normals[3 * i + 2] > 0.99);
    expect(up).toHaveLength(4);
    for (const i of up) expect(mesh.positions[3 * i + 2]).toBeCloseTo(20, 6);
  });
});

describe('OBJ: faces', () => {
  it('fan-triangulates quads and n-gons; negative indices give the same mesh as positive ones', async () => {
    // A pentagon (3 triangles) and two quads (2 each) in one part: 7 triangles.
    const pool = (x: number) => `v ${x} 0 0\nv ${x + 10} 0 0\nv ${x + 10} 10 0\nv ${x + 5} 15 0\nv ${x} 10 0\n`;
    const positive = pool(0) + 'f 1 2 3 4 5\n' + pool(20) + 'f 6 7 8 10\n' + pool(40) + 'f 11 12 13 15\n';
    // Negative indices count back from the vertices defined so far (-1 is the last one).
    const negative = pool(0) + 'f -5 -4 -3 -2 -1\n' + pool(20) + 'f -5 -4 -3 -1\n' + pool(40) + 'f -5 -4 -3 -1\n';
    const a = await read('faces.obj', positive);
    const b = await read('faces.obj', negative);
    const [pa] = partsOf(a);
    const [pb] = partsOf(b);
    expect(pa.mesh!.triangles).toBe(7);
    expect(pb.mesh!.triangles).toBe(7);
    expect(Array.from(meshOf(pb).positions)).toEqual(Array.from(meshOf(pa).positions));
    expect(Array.from(meshOf(pb).indices)).toEqual(Array.from(meshOf(pa).indices));
    // The pentagon is one flat face: 5 vertices, no hard edge inside it.
    expect(a.warnings).toEqual([]);
  });

  it('reads v//vn and v/vt/vn, with negative indices, keeping the file normals and uvs', async () => {
    const text = [
      'v 0 0 0', 'v 10 0 0', 'v 10 10 0', 'v 0 10 0',
      'vt 0.1 0.1', 'vt 0.9 0.1', 'vt 0.9 0.9', 'vt 0.1 0.9',
      'vn 0 0 1',
      'f 1//1 2//1 3//1 4//1',
      'f -4/-4/-1 -3/-3/-1 -2/-2/-1 -1/-1/-1',
    ].join('\n');
    const r = await read('quad.obj', text);
    const [quad] = partsOf(r);
    const mesh = meshOf(quad);
    // Two coincident quads: the first has no uvs, the second has them, so corners differ in uv: 4 + 4 vertices.
    expect(quad.mesh).toMatchObject({ vertices: 8, triangles: 4 });
    expect(mesh.uvs).toHaveLength(16);
    expect(Array.from(mesh.uvs!.subarray(8, 16)).map((x) => Number(x.toFixed(2)))).toEqual([0.1, 0.1, 0.9, 0.1, 0.9, 0.9, 0.1, 0.9]);
    expect(Array.from(mesh.indices)).toEqual([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
    // File normal (0, 0, 1) in a Y-up file is (0, -1, 0) in the model.
    for (let i = 0; i < 8; i++) expect(Array.from(mesh.normals.subarray(3 * i, 3 * i + 3))).toEqual([0, -1, 0]);
    expect(r.warnings).toEqual([]);
  });

  it('recomputes the normals of a part that has them on only some faces, and says so', async () => {
    const text = 'v 0 0 0\nv 10 0 0\nv 10 10 0\nv 0 10 0\nvn 0 0 1\nf 1//1 2//1 3//1\nf 1 3 4\n';
    const r = await read('half.obj', text);
    expect(r.warnings).toEqual([{ code: 'partialNormals', params: { part: 'half' } }]);
    const mesh = meshOf(partsOf(r)[0]);
    expect(normalLengthError(mesh)).toBeLessThan(1e-6);
    // Computed from the geometry, the two coplanar triangles share vertices.
    expect(mesh.positions.length / 3).toBe(4);
  });

  it('skips malformed faces and out-of-range indices, and reports how many', async () => {
    const text = 'v 0 0 0\nv 10 0 0\nv 10 10 0\nf 1 2 3\nf 1 2\nf 1 2 9\nf 0 1 2\nf a b c\n';
    const r = await read('bad.obj', text);
    expect(partsOf(r)[0].mesh!.triangles).toBe(1);
    expect(r.warnings).toEqual([{ code: 'badFace', params: { count: 4 } }]);
  });

  it('joins a statement continued with a backslash', async () => {
    const r = await read('cont.obj', 'v 0 0 0\nv 10 0 0\nv 10 10 0\nf 1 2 \\\n3\n');
    expect(partsOf(r)[0].mesh!.triangles).toBe(1);
  });

  it('drops a degenerate triangle and reports it in the warnings', async () => {
    // A quad (2 triangles), a triangle on a line, and one with a repeated vertex.
    const text = 'v 0 0 0\nv 10 0 0\nv 10 10 0\nv 0 10 0\nv 5 0 0\nf 1 2 3 4\nf 1 5 2\nf 1 1 3\n';
    const r = await read('slivers.obj', text);
    expect(partsOf(r)[0].mesh!.triangles).toBe(2);
    expect(r.warnings).toEqual([{ code: 'degenerate', params: { part: 'slivers', count: 2 } }]);
    expect(normalLengthError(meshOf(partsOf(r)[0]))).toBeLessThan(1e-6);
  });

  it('fails with a readable reason when no face survives', async () => {
    await expect(read('empty.obj', 'v 0 0 0\nv 1 0 0\nv 2 0 0\nf 1 2 3\n')).rejects.toThrow('no faces found');
    await expect(read('nothing.obj', '# nothing here\n')).rejects.toThrow('no faces found');
  });
});

describe('OBJ: parts and materials', () => {
  const square = 'v 0 0 0\nv 10 0 0\nv 10 10 0\nv 0 10 0\n';

  it('shares one material instance among the parts that name it', async () => {
    const text = `${square}o A\nusemtl Steel\nf 1 2 3 4\no B\nusemtl Gold\nf 1 2 3 4\no C\nusemtl Steel\nf 1 2 3 4\n`;
    const r = await read('three.obj', text);
    const parts = partsOf(r);
    expect(parts.map((p) => p.name)).toEqual(['A', 'B', 'C']);
    expect(Object.values(r.materials).map((m) => m.name)).toEqual(['Steel', 'Gold']);
    expect(parts[0].material).toBe(parts[2].material);
    expect(parts[1].material).not.toBe(parts[0].material);
    expect(Object.values(r.materials).every((m) => m.family === 'SIMPLE')).toBe(true);
  });

  it('keeps a second material of one group as a range of triangles', async () => {
    const text = `${square}g Panel\nusemtl Steel\nf 1 2 3 4\nf 1 2 3 4\nusemtl Gold\nf 1 2 3 4\n`;
    const r = await read('ranges.obj', text);
    const [panel] = partsOf(r);
    expect(panel.mesh!.triangles).toBe(6);
    expect(r.materials[panel.material!].name).toBe('Steel');
    expect(panel.faceMaterials).toHaveLength(1);
    expect(panel.faceMaterials![0]).toMatchObject({ start: 4, count: 2 });
    expect(r.materials[panel.faceMaterials![0].material].name).toBe('Gold');
  });

  it('merges a group that comes back, ignores empty ones and names a file without groups after the file', async () => {
    const text = `${square}g A\nf 1 2 3 4\ng Empty\ng B\nf 1 2 3 4\ng A\nf 1 2 3 4\n`;
    const r = await read('groups.obj', text);
    const parts = partsOf(r);
    expect(parts.map((p) => p.name)).toEqual(['A', 'B']);
    expect(parts[0].mesh!.triangles).toBe(4);
    const plain = await read('my part.v2.obj', `${square}f 1 2 3 4\n`);
    expect(partsOf(plain)[0].name).toBe('my part.v2');
  });
});

describe('OBJ: smoothing angle and hard edges', () => {
  it('shares vertex normals across a fold under 30 degrees and splits it above', async () => {
    const smooth = await read('roof.obj', objOf(roof(29)));
    const [s] = partsOf(smooth);
    // 6 welded vertices (a ridge of 2 and 4 outer ones), all shared; no hard edge.
    expect(s.mesh).toMatchObject({ vertices: 6, triangles: 4 });
    expect(meshOf(s).sharpEdges!.length).toBe(0);
    expect(normalLengthError(meshOf(s))).toBeLessThan(1e-6);

    const hard = await read('roof.obj', objOf(roof(31)));
    const [h] = partsOf(hard);
    // The ridge splits the vertices: 4 on each panel; one hard edge, the 10 long ridge.
    expect(h.mesh).toMatchObject({ vertices: 8, triangles: 4 });
    expect(meshOf(h).sharpEdges!.length / 2).toBe(1);
    const [seg] = sharpEdgeSegments(meshOf(h));
    expect(Math.hypot(seg[0] - seg[3], seg[1] - seg[4], seg[2] - seg[5])).toBeCloseTo(10, 4);
    expect(normalLengthError(meshOf(h))).toBeLessThan(1e-6);
  });

  it('gives the shared ridge vertices the average of the two panel normals', async () => {
    const m = meshOf(partsOf(await read('roof.obj', objOf(roof(20))))[0]);
    const face = (t: number): number[] => {
      const p = [0, 1, 2].map((j) => Array.from(m.positions.subarray(3 * m.indices[t + j], 3 * m.indices[t + j] + 3)));
      const u = [p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]];
      const v = [p[2][0] - p[0][0], p[2][1] - p[0][1], p[2][2] - p[0][2]];
      const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const l = Math.hypot(n[0], n[1], n[2]);
      return n.map((x) => x / l);
    };
    const a = face(0);
    const b = face(6);
    const sum = [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
    const l = Math.hypot(sum[0], sum[1], sum[2]);
    const mid = sum.map((x) => x / l);
    const near = (n: number[], i: number) => Math.hypot(n[0] - m.normals[i], n[1] - m.normals[i + 1], n[2] - m.normals[i + 2]) < 1e-5;
    let ridge = 0;
    for (let i = 0; i < m.normals.length; i += 3) {
      if (near(mid, i)) ridge++;
      else expect(near(a, i) || near(b, i)).toBe(true);
    }
    expect(ridge).toBe(2);
    // The two panels really are 20 degrees apart, so the bisector is 10 degrees from each.
    expect((Math.acos(a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) * 180) / Math.PI).toBeCloseTo(20, 3);
  });
});

describe('OBJ: size and units', () => {
  const cubeOf = (side: number) => cubeTwoGroups.replace(/^v (.*)$/gm, (_m, xyz: string) => `v ${xyz.split(/\s+/).filter(Boolean).map((x) => Number(x) * (side / 20)).join(' ')}`);

  it('takes a file under a millimetre as metres: the sheet starts on m and the model comes out 20 mm', async () => {
    const r = await read('metres.obj', cubeOf(0.02));
    expect(r.detected).toMatchObject({ units: null, upAxis: 'Y', upAxisDeclared: false });
    expect(r.detected.size).toBeCloseTo(0.02, 6);
    expect(r.options.units).toBe('m');
    expect(partsOf(r)[0].mesh!.bounds.max[0]).toBeCloseTo(10, 4);
    expect(r.notes.filter((n) => n.code === 'scaleSmall' || n.code === 'scaleLarge')).toEqual([]);
    expect(r.nodes[r.roots[0]].source!.unitHint).toBeUndefined();
  });

  it('keeps a file in metres as it is when millimetres are chosen and notes it; the Doctor then offers x1000', async () => {
    const r = await read('metres.obj', cubeOf(0.02), { units: 'mm' });
    expect(r.notes).toContainEqual({ code: 'scaleSmall', params: { size: 0.02, factor: 1000 } });
    expect(r.nodes[r.roots[0]].source!.unitHint).toBe(1000);
    expect(partsOf(r)[0].mesh!.bounds.max[0]).toBeCloseTo(0.01, 6);

    let s = reduce(createInitialState(), { type: 'scene/addModel', payload: r, replace: true });
    expect(measuredSizeMm(s)).toBeCloseTo(0.02, 6);
    const scale = runDoctor(s).find((x) => x.key === 'scale')!;
    expect(scale.status).toBe('WARN');
    expect(scale.detail).toMatchObject({ reason: 'preset', actual: 0.02, factor: 1000 });
    s = fixDoctor(s, 'scale');
    expect(measuredSizeMm(s)).toBeCloseTo(20, 4);
    expect(runDoctor(s).find((x) => x.key === 'scale')!.status).toBe('OK');
    expect(boundsOf(s, s.scene.roots).max[0] - boundsOf(s, s.scene.roots).min[0]).toBeCloseTo(20, 4);
  });

  it('notes a file in micrometres and leaves a plausible size alone', async () => {
    const big = await read('um.obj', cubeOf(30000));
    expect(big.options.units).toBe('mm');
    expect(big.notes).toContainEqual({ code: 'scaleLarge', params: { size: 30000, factor: 0.001 } });
    expect(big.nodes[big.roots[0]].source!.unitHint).toBe(0.001);
    const s = reduce(createInitialState(), { type: 'scene/addModel', payload: big, replace: true });
    const scale = runDoctor(s).find((x) => x.key === 'scale')!;
    expect(scale.detail).toMatchObject({ factor: 0.001 });
    expect(measuredSizeMm(fixDoctor(s, 'scale'))).toBeCloseTo(30, 4);

    for (const side of [1, 20, 10000]) {
      const ok = await read('ok.obj', cubeOf(side));
      expect(ok.notes.filter((n) => n.code === 'scaleSmall' || n.code === 'scaleLarge')).toEqual([]);
      expect(ok.nodes[ok.roots[0]].source!.unitHint).toBeUndefined();
    }
    // The edges of the heuristic: 0.99 is metres (the sheet picks m, so no note), 10001 is flagged.
    expect((await read('edge.obj', cubeOf(0.99))).options.units).toBe('m');
    expect((await read('edge.obj', cubeOf(1))).options.units).toBe('mm');
    expect((await read('edge.obj', cubeOf(0.99), { units: 'mm' })).notes.some((n) => n.code === 'scaleSmall')).toBe(true);
    const edge2 = await read('edge.obj', cubeOf(10001));
    expect(edge2.notes.some((n) => n.code === 'scaleLarge')).toBe(true);
  });
});
