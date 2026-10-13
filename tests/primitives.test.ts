// Phase U9: the parametric primitives as pure generators (ROADMAP U9 criterion): closed where they should be,
// normals out, uvs in [0, 1], CAD faces that cover the mesh exactly, the same bytes for the same spec, and the
// bounds the measures promise, in millimetres.

import { describe, expect, it } from 'vitest';
import { PRIMITIVE_KINDS, PRIMITIVES, primitiveEntry, type PrimitiveKind } from '../src/data/primitives';
import { coveringRanges, cadFaceRegion } from '../src/core/faces';
import { positionsBounds, weldIds, type MeshData } from '../src/core/meshes';
import {
  defaultParams,
  generatePrimitive,
  normalizeParams,
  primitiveExtent,
  primitiveMeshId,
  primitiveOwner,
  type PrimitiveSpec,
} from '../src/core/primitives';

const OPEN: readonly PrimitiveKind[] = ['PLANE', 'DISC', 'SWEEP'];

function spec(kind: PrimitiveKind, patch: Record<string, number> = {}): PrimitiveSpec {
  return { kind, params: normalizeParams(kind, { ...defaultParams(kind, 200), ...patch }) };
}

function sameBytes(a: ArrayBufferView, b: ArrayBufferView): boolean {
  const x = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  const y = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
  return x.length === y.length && x.every((v, i) => v === y[i]);
}

/** How many triangles meet at each edge, the edges found by position (welded like faces.ts does). */
function edgeUse(data: MeshData): Map<number, number> {
  const b = positionsBounds(data.positions);
  const size = Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]);
  const weld = weldIds(data.positions, size * 1e-6);
  const W = weld.count;
  const use = new Map<number, number>();
  for (let t = 0; t < data.indices.length / 3; t++) {
    for (let j = 0; j < 3; j++) {
      const a = weld.ids[data.indices[3 * t + j]];
      const c = weld.ids[data.indices[3 * t + ((j + 1) % 3)]];
      const key = a < c ? a * W + c : c * W + a;
      use.set(key, (use.get(key) ?? 0) + 1);
    }
  }
  return use;
}

function triNormal(data: MeshData, t: number): [number, number, number] {
  const p = data.positions;
  const [a, b, c] = [data.indices[3 * t], data.indices[3 * t + 1], data.indices[3 * t + 2]];
  const u = [p[3 * b] - p[3 * a], p[3 * b + 1] - p[3 * a + 1], p[3 * b + 2] - p[3 * a + 2]];
  const w = [p[3 * c] - p[3 * a], p[3 * c + 1] - p[3 * a + 1], p[3 * c + 2] - p[3 * a + 2]];
  return [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
}

/** Signed volume (positive when the triangles face out of a closed surface). */
function volume(data: MeshData): number {
  const p = data.positions;
  let v = 0;
  for (let t = 0; t < data.indices.length / 3; t++) {
    const [a, b, c] = [data.indices[3 * t], data.indices[3 * t + 1], data.indices[3 * t + 2]];
    v += (p[3 * a] * (p[3 * b + 1] * p[3 * c + 2] - p[3 * b + 2] * p[3 * c + 1]) - p[3 * a + 1] * (p[3 * b] * p[3 * c + 2] - p[3 * b + 2] * p[3 * c]) + p[3 * a + 2] * (p[3 * b] * p[3 * c + 1] - p[3 * b + 1] * p[3 * c])) / 6;
  }
  return v;
}

describe('the catalogue of primitives', () => {
  it('has the twelve shapes of the roadmap, in order, with stable keys', () => {
    expect(PRIMITIVE_KINDS).toEqual(['BOX', 'PLANE', 'DISC', 'CYLINDER', 'PEDESTAL', 'SPHERE', 'CONE', 'TORUS', 'CAPSULE', 'TUBE', 'STEPS', 'SWEEP']);
    expect(primitiveEntry('BOX')?.role).toBe('BASE');
    expect(primitiveEntry('PEDESTAL')?.role).toBe('BASE');
    expect(primitiveEntry('SWEEP')?.role).toBe('BACKDROP');
    for (const p of PRIMITIVES) for (const q of p.params) expect(q.kind === 'COUNT' ? q.default : q.scale, `${p.key}.${q.key}`).toBeGreaterThan(0);
  });
});

describe.each(PRIMITIVE_KINDS)('%s', (kind) => {
  const s = spec(kind);
  const g = generatePrimitive(s);
  const d = g.data;
  const T = d.indices.length / 3;

  it('is the same bytes for the same spec (and a fresh copy every time)', () => {
    const again = generatePrimitive({ kind, params: { ...s.params } });
    expect(again.data.positions).not.toBe(d.positions);
    for (const key of ['positions', 'normals', 'indices', 'uvs', 'sharpEdges'] as const) expect(sameBytes(again.data[key]!, d[key]!), key).toBe(true);
    expect(again.faceRanges).toEqual(g.faceRanges);
  });

  it('has the bounds its measures promise, centred on the origin', () => {
    const b = positionsBounds(d.positions);
    const ext = primitiveExtent(s);
    for (let k = 0; k < 3; k++) {
      expect(b.max[k] - b.min[k], `axis ${k}`).toBeCloseTo(ext[k], 4);
      expect(b.max[k] + b.min[k], `centre ${k}`).toBeCloseTo(0, 4);
      expect(b.max[k], `exact ${k}`).toBe(Math.fround(ext[k] / 2));
    }
  });

  it('has uvs in [0, 1] and unit normals', () => {
    expect(d.uvs!.length).toBe((2 * d.positions.length) / 3);
    for (const u of d.uvs!) {
      expect(u).toBeGreaterThanOrEqual(0);
      expect(u).toBeLessThanOrEqual(1);
    }
    for (let i = 0; i < d.normals.length; i += 3) expect(Math.hypot(d.normals[i], d.normals[i + 1], d.normals[i + 2])).toBeCloseTo(1, 5);
  });

  it('has CAD faces that cover every triangle once, in order', () => {
    expect(coveringRanges(g.faceRanges, T)).not.toBeNull();
    expect(g.faceNames.length).toBe(g.faceRanges.length);
    expect(new Set(g.faceNames).size).toBe(g.faceNames.length);
    // A click at the Faces level takes a whole logical face (M1: the ranges win).
    const first = g.faceRanges[0];
    expect(cadFaceRegion(d, first.start + first.count - 1, { faceRanges: g.faceRanges })).toHaveLength(first.count);
  });

  it(OPEN.includes(kind) ? 'is an open sheet, every edge used once or twice' : 'is closed: every edge has two triangles', () => {
    const counts = [...edgeUse(d).values()];
    expect(counts.every((c) => c === 1 || c === 2)).toBe(true);
    if (OPEN.includes(kind)) expect(counts.some((c) => c === 1)).toBe(true);
    else expect(counts.every((c) => c === 2)).toBe(true);
  });

  it('winds every triangle towards its normals, out of the solid', () => {
    for (let t = 0; t < T; t++) {
      const n = triNormal(d, t);
      for (let j = 0; j < 3; j++) {
        const v = d.indices[3 * t + j];
        const dotN = n[0] * d.normals[3 * v] + n[1] * d.normals[3 * v + 1] + n[2] * d.normals[3 * v + 2];
        expect(dotN, `triangle ${t}`).toBeGreaterThan(0);
      }
    }
    if (!OPEN.includes(kind)) expect(volume(d)).toBeGreaterThan(0);
  });

  it('marks the edges between its faces as hard, and none inside a face', () => {
    const faceOf = new Int32Array(T);
    g.faceRanges.forEach((r, i) => faceOf.fill(i, r.start, r.start + r.count));
    const vertexFace = new Int32Array(d.positions.length / 3).fill(-1);
    for (let t = 0; t < T; t++) for (let j = 0; j < 3; j++) vertexFace[d.indices[3 * t + j]] = faceOf[t];
    if (g.faceRanges.length > 1) expect(d.sharpEdges!.length).toBeGreaterThan(0);
    else expect(d.sharpEdges!.length).toBe(0);
    // A hard edge is on the border of its face: some other face has vertices at its two ends.
    const key = (i: number) => `${d.positions[3 * i]},${d.positions[3 * i + 1]},${d.positions[3 * i + 2]}`;
    const facesAt = new Map<string, Set<number>>();
    for (let v = 0; v < vertexFace.length; v++) (facesAt.get(key(v)) ?? facesAt.set(key(v), new Set()).get(key(v))!).add(vertexFace[v]);
    for (let e = 0; e < d.sharpEdges!.length; e += 2) {
      expect(facesAt.get(key(d.sharpEdges![e]))!.size, `edge ${e / 2}`).toBeGreaterThan(1);
      expect(facesAt.get(key(d.sharpEdges![e + 1]))!.size, `edge ${e / 2}`).toBeGreaterThan(1);
    }
  });
});

describe('measures in millimetres', () => {
  it('a box is its width, depth and height, and its volume loses the bevel corners', () => {
    const s = spec('BOX', { width: 120, depth: 80, height: 30, bevel: 0 });
    const g = generatePrimitive(s);
    expect(g.faceNames).toEqual(['top', 'bottom', 'front', 'back', 'right', 'left']);
    expect(volume(g.data)).toBeCloseTo(120 * 80 * 30, 2);
    const b = generatePrimitive(spec('BOX', { width: 120, depth: 80, height: 30, bevel: 5, bevelSegments: 8 }));
    expect(b.faceNames).toEqual(['top', 'bottom', 'front', 'back', 'right', 'left', 'bevel']);
    // A rounded box: the inner box grown by a sphere of radius r (V = abc + 2r(ab+bc+ca) + πr²(a+b+c) + 4/3πr³).
    const [x, y, z, r] = [110, 70, 20, 5];
    const exact = x * y * z + 2 * r * (x * y + y * z + z * x) + Math.PI * r * r * (x + y + z) + (4 / 3) * Math.PI * r ** 3;
    expect(Math.abs(volume(b.data) - exact) / exact).toBeLessThan(0.002);
    const bounds = positionsBounds(b.data.positions);
    expect([bounds.max[0], bounds.max[1], bounds.max[2]]).toEqual([60, 40, 15]);
  });

  it('a cylinder holds πr²h, a sphere 4/3πr³, a cone a third of its cylinder, a torus 2π²Rr²', () => {
    const near = (v: number, want: number, tol = 0.01) => expect(Math.abs(v - want) / want).toBeLessThan(tol);
    near(volume(generatePrimitive(spec('CYLINDER', { radius: 50, height: 100 })).data), Math.PI * 2500 * 100);
    near(volume(generatePrimitive(spec('SPHERE', { radius: 50 })).data), (4 / 3) * Math.PI * 125000);
    near(volume(generatePrimitive(spec('CONE', { radius: 50, height: 90 })).data), (Math.PI * 2500 * 90) / 3);
    // 24 facets round the tube: an inscribed 24-gon holds (12 sin 15°) / π of the circle (1.1 % less).
    near(volume(generatePrimitive(spec('TORUS', { radius: 60, tube: 15 })).data), 2 * Math.PI * 60 * 225 * 12 * Math.sin(Math.PI / 12));
    near(volume(generatePrimitive(spec('TUBE', { radius: 50, inner: 40, height: 100 })).data), Math.PI * (2500 - 1600) * 100);
    near(volume(generatePrimitive(spec('CAPSULE', { radius: 20, height: 100 })).data), Math.PI * 400 * 60 + (4 / 3) * Math.PI * 8000);
    near(volume(generatePrimitive(spec('STEPS', { width: 300, depth: 300, height: 300, steps: 3 })).data), 300 * 100 * (100 + 200 + 300), 1e-6);
  });

  it('the tip of a cone has, in each facet, the normal of that facet (not of its edge)', () => {
    const d = generatePrimitive(spec('CONE', { radius: 50, height: 100, segments: 12 })).data;
    let tips = 0;
    for (let t = 0; t < d.indices.length / 3; t++) {
      const v = [0, 1, 2].map((j) => d.indices[3 * t + j]);
      const apex = v.find((i) => d.positions[3 * i + 2] === 50 && d.positions[3 * i] === 0 && d.positions[3 * i + 1] === 0);
      if (apex === undefined) continue;
      tips++;
      const cx = v.reduce((a, i) => a + d.positions[3 * i], 0) / 3;
      const cy = v.reduce((a, i) => a + d.positions[3 * i + 1], 0) / 3;
      expect(Math.atan2(d.normals[3 * apex + 1], d.normals[3 * apex])).toBeCloseTo(Math.atan2(cy, cx), 5);
    }
    expect(tips).toBe(12);
  });

  it('logical faces follow the measures: a capsule without a side, steps of any count, a sweep without its curve', () => {
    expect(generatePrimitive(spec('PEDESTAL', { bevel: 3 })).faceNames).toEqual(['top', 'bevel', 'side', 'bottom']);
    expect(generatePrimitive(spec('PEDESTAL', { bevel: 0 })).faceNames).toEqual(['top', 'side', 'bottom']);
    expect(generatePrimitive(spec('CAPSULE', { radius: 20, height: 40 })).faceNames).toEqual(['top', 'bottom']);
    expect(generatePrimitive(spec('STEPS', { steps: 5 })).faceNames).toHaveLength(2 * 5 + 4);
    expect(generatePrimitive(spec('SWEEP')).faceNames).toEqual(['floor', 'curve', 'wall']);
    expect(generatePrimitive(spec('SWEEP', { radius: 0 })).faceNames).toEqual(['floor', 'wall']);
  });

  it('keeps the measures within what makes a shape', () => {
    expect(normalizeParams('BOX', { width: 10, depth: 20, height: 4, bevel: 9 }).bevel).toBe(2);
    expect(normalizeParams('PEDESTAL', { radius: 10, height: 4, bevel: 9 }).bevel).toBe(4);
    expect(normalizeParams('CAPSULE', { radius: 10, height: 5 }).height).toBe(20);
    expect(normalizeParams('TUBE', { radius: 10, inner: 12 }).inner).toBeLessThan(10);
    expect(normalizeParams('TORUS', { radius: 10, tube: 30 }).tube).toBe(10);
    expect(normalizeParams('SWEEP', { width: 100, depth: 50, height: 80, radius: 70 }).radius).toBe(50);
    expect(normalizeParams('CYLINDER', { radius: -3, height: Number.NaN, segments: 7.6 })).toEqual({ radius: 0.01, height: 100, segments: 8 });
    expect(Object.keys(normalizeParams('SPHERE', { radius: 5, extra: 1 }))).toEqual(['radius', 'segments']);
  });
});

describe('the mesh id of a primitive', () => {
  it('names its owner and its content, so it never stands for two geometries', () => {
    const s = spec('CYLINDER', { radius: 25, height: 80 });
    const id = primitiveMeshId('n7', s);
    expect(id).toBe('prim:n7:CYLINDER:25,80,64');
    expect(primitiveOwner(id)).toBe('n7');
    expect(primitiveOwner(`${id}~flip`)).toBeNull();
    expect(primitiveOwner('stl:1:n3')).toBeNull();
    expect(primitiveMeshId('n7', spec('CYLINDER', { radius: 25, height: 81 }))).not.toBe(id);
  });
});
