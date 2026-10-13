import { describe, expect, it } from 'vitest';
import { EXAMPLE_HEIGHT_MM, buildExample, lathe } from '../src/core/example';
import { getMesh } from '../src/core/meshes';
import { boxSize, isEmptyBox } from '../src/core/math';
import { allParts, boundsOf, measuredSizeMm, sceneBounds } from '../src/core/scene';
import { exampleState, keyIds } from './helpers';
import exampleSource from '../src/core/example.ts?raw';

describe('example part', () => {
  const payload = buildExample();
  const nodes = Object.values(payload.nodes);

  it('is one model with one group and five parts', () => {
    expect(payload.roots).toEqual(['model']);
    expect(nodes.filter((n) => n.kind === 'MODEL')).toHaveLength(1);
    expect(nodes.filter((n) => n.kind === 'GROUP')).toHaveLength(1);
    expect(nodes.filter((n) => n.kind === 'PART')).toHaveLength(5);
    expect(payload.nodes.closure.children).toEqual(['collar', 'cap']);
    expect(payload.nodes.model.children).toEqual(['base', 'body', 'label', 'closure']);
  });

  it('gives every part a mesh and a catalogue material', () => {
    for (const n of nodes.filter((x) => x.kind === 'PART')) {
      expect(n.mesh?.triangles).toBeGreaterThan(100);
      expect(n.material).toBeTruthy();
      expect(payload.materials[n.material!].preset).toBeTruthy();
      const mesh = getMesh(n.mesh!.id)!;
      expect(mesh.positions.length / 3).toBe(n.mesh!.vertices);
      expect(mesh.indices.length / 3).toBe(n.mesh!.triangles);
      expect(Math.max(...mesh.indices)).toBeLessThan(n.mesh!.vertices);
    }
  });

  it('has unit normals', () => {
    const mesh = getMesh('example:body')!;
    for (let i = 0; i < mesh.normals.length; i += 3) {
      expect(Math.hypot(mesh.normals[i], mesh.normals[i + 1], mesh.normals[i + 2])).toBeCloseTo(1, 5);
    }
  });

  it('rests on the floor, centred, about 121 mm tall', () => {
    const state = exampleState();
    const b = sceneBounds(state);
    expect(isEmptyBox(b)).toBe(false);
    expect(b.min[2]).toBeCloseTo(0, 6);
    expect(b.max[2]).toBeCloseTo(EXAMPLE_HEIGHT_MM, 6);
    expect((b.min[0] + b.max[0]) / 2).toBeCloseTo(0, 1);
    expect((b.min[1] + b.max[1]) / 2).toBeCloseTo(0, 1);
    expect(measuredSizeMm(state)).toBeCloseTo(121, 6);
    expect(state.scene.partSizeMm).toBeCloseTo(121, 2);
    expect(boxSize(boundsOf(state, [keyIds(state).cap]))[2]).toBeCloseTo(24, 6);
    expect(allParts(state)).toHaveLength(5);
  });

  it('builds front faces counter-clockwise (outward normals)', () => {
    // A cylinder wall: the geometric normal of the first triangle must point outward.
    const m = lathe([{ r: 10, z: 0 }, { r: 10, z: 10 }], 16);
    const [a, b, c] = [m.indices[0], m.indices[1], m.indices[2]];
    const p = (i: number) => [m.positions[i * 3], m.positions[i * 3 + 1], m.positions[i * 3 + 2]];
    const [pa, pb, pc] = [p(a), p(b), p(c)];
    const u = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]];
    const v = [pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]];
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const centre = [(pa[0] + pb[0] + pc[0]) / 3, (pa[1] + pb[1] + pc[1]) / 3];
    expect(n[0] * centre[0] + n[1] * centre[1]).toBeGreaterThan(0);
  });

  it('does not import three.js', () => {
    expect(exampleSource).not.toMatch(/from ['"]three/);
  });
});
