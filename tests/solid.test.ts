// Which meshes are closed solids (phase Q1, core/solid.ts): the rule the engine applies (rt-core `geometry::solid`) and
// the preview's cap follows, on hand-made meshes and on the example bottle's parts.

import { describe, expect, it } from 'vitest';
import { buildExample } from '../src/core/example';
import { getMesh } from '../src/core/meshes';
import type { MeshData } from '../src/core/meshes';
import { analyse, isClosedSolid, solidOrientation } from '../src/core/solid';

/** A box from `lo` to `hi` in 24 vertices (split per face), outward and counter-clockwise: the engine's `faceted_box`. */
function box(lo: number | number[], hi: number | number[]): { positions: number[]; indices: number[] } {
  const L = typeof lo === 'number' ? [lo, lo, lo] : lo;
  const H = typeof hi === 'number' ? [hi, hi, hi] : hi;
  const c = (x: number, y: number, z: number) => [x ? H[0] : L[0], y ? H[1] : L[1], z ? H[2] : L[2]];
  const faces = [
    [c(0, 0, 0), c(0, 1, 0), c(1, 1, 0), c(1, 0, 0)],
    [c(0, 0, 1), c(1, 0, 1), c(1, 1, 1), c(0, 1, 1)],
    [c(0, 0, 0), c(1, 0, 0), c(1, 0, 1), c(0, 0, 1)],
    [c(0, 1, 0), c(0, 1, 1), c(1, 1, 1), c(1, 1, 0)],
    [c(0, 0, 0), c(0, 0, 1), c(0, 1, 1), c(0, 1, 0)],
    [c(1, 0, 0), c(1, 1, 0), c(1, 1, 1), c(1, 0, 1)],
  ];
  const positions: number[] = [];
  const indices: number[] = [];
  for (const quad of faces) {
    const base = positions.length / 3;
    for (const p of quad) positions.push(...p);
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return { positions, indices };
}

describe('closed solids', () => {
  it('a box in split vertices is closed; without a triangle, or with one flipped, or inside out, it is not a solid', () => {
    const { positions, indices } = box(-1, 1);
    expect(analyse(positions, indices)).toBe(true);
    expect(analyse(positions, indices.slice(0, -3))).toBe(false);
    const flipped = [...indices];
    [flipped[1], flipped[2]] = [flipped[2], flipped[1]];
    expect(analyse(positions, flipped)).toBe(false);
    const inside = indices.flatMap((_, i) => (i % 3 === 0 ? [indices[i], indices[i + 2], indices[i + 1]] : []));
    expect(analyse(positions, inside)).toBe(false);
  });

  it('a face shared by two boxes (an edge of four triangles), a lone triangle and nothing are not solids', () => {
    const a = box(-1, 1);
    const join = (b: { positions: number[]; indices: number[] }) => analyse([...a.positions, ...b.positions], [...a.indices, ...b.indices.map((i) => i + a.positions.length / 3)]);
    // Touching along a whole face makes four triangles of each edge of it: not a solid.
    expect(join(box([1, -1, -1], [3, 1, 1]))).toBe(false);
    // Two boxes that meet at one corner only, or not at all, are each a solid.
    expect(join(box(1, 3))).toBe(true);
    expect(join(box(5, 6))).toBe(true);
    expect(analyse([0, 0, 0, 1, 0, 0, 0, 1, 0], [0, 1, 2])).toBe(false);
    expect(analyse([], [])).toBe(false);
  });

  it('welds a seam that differs by rounding, as a lathe closes', () => {
    // A box whose last vertex of each corner is displaced by far less than the tolerance of 10⁻⁵ of its size.
    const { positions, indices } = box(-50, 50);
    const nudged = positions.map((v, i) => v + (i % 5 === 0 ? 1e-6 : 0));
    expect(analyse(nudged, indices)).toBe(true);
    // A gap larger than that opens it.
    const gapped = positions.map((v, i) => v + (i === 0 ? 0.05 : 0));
    expect(analyse(gapped, indices)).toBe(false);
  });

  it('says which parts of the example bottle are solids: the body, the collar and the cap; not the base cup or the label', () => {
    const payload = buildExample();
    const closed = Object.fromEntries(['base', 'body', 'label', 'collar', 'cap'].map((k) => [k, isClosedSolid(getMesh(payload.nodes[k].mesh!.id)!)]));
    expect(closed).toEqual({ base: false, body: true, label: false, collar: true, cap: true });
    // The answer is cached with the mesh.
    const body = getMesh(payload.nodes.body.mesh!.id)!;
    expect(isClosedSolid(body)).toBe(isClosedSolid(body));
  });
});

describe('which way a closed surface faces (K1, the interior Doctor)', () => {
  const mesh = (positions: number[], indices: number[]): MeshData => ({ positions: new Float32Array(positions), normals: new Float32Array(positions.length), indices: new Uint32Array(indices) });
  const turned = (indices: number[]): number[] => indices.flatMap((_, i) => (i % 3 === 0 ? [indices[i], indices[i + 2], indices[i + 1]] : []));

  it('a box wound counter-clockwise from outside faces OUTWARD, the same box wound the other way INWARD (a room)', () => {
    const { positions, indices } = box(-1, 1);
    expect(solidOrientation(mesh(positions, indices))).toBe('OUTWARD');
    expect(solidOrientation(mesh(positions, turned(indices)))).toBe('INWARD');
  });

  it('anything that is not a closed manifold, or has no volume, is OPEN: a sheet, a box with a face missing, one triangle flipped, nothing', () => {
    const { positions, indices } = box(-1, 1);
    expect(solidOrientation(mesh(positions, indices.slice(0, -3)))).toBe('OPEN');
    const flipped = [...indices];
    [flipped[1], flipped[2]] = [flipped[2], flipped[1]];
    expect(solidOrientation(mesh(positions, flipped))).toBe('OPEN');
    expect(solidOrientation(mesh([0, 0, 0, 1, 0, 0, 0, 1, 0], [0, 1, 2]))).toBe('OPEN');
    expect(solidOrientation(mesh([], []))).toBe('OPEN');
    // A closed surface that encloses nothing: a box squashed flat.
    const flat = box([-1, -1, 0], [1, 1, 0]);
    expect(solidOrientation(mesh(flat.positions, flat.indices))).toBe('OPEN');
  });

  it('agrees with the rule of the section view: OUTWARD is exactly what a section caps, and it is cached per mesh', () => {
    const { positions, indices } = box(-3, 5);
    const out = mesh(positions, indices);
    const inn = mesh(positions, turned(indices));
    expect(isClosedSolid(out)).toBe(solidOrientation(out) === 'OUTWARD');
    expect(isClosedSolid(inn)).toBe(solidOrientation(inn) === 'OUTWARD');
    expect(isClosedSolid(inn)).toBe(false);
    expect(solidOrientation(out)).toBe(solidOrientation(out));
    // The example bottle's body is a solid that faces out.
    const body = getMesh('example:body') ?? Object.values(buildExample().nodes).map((n) => (n.mesh ? getMesh(n.mesh.id) : undefined)).find((m) => m && isClosedSolid(m));
    expect(solidOrientation(body!)).toBe('OUTWARD');
  });
});
