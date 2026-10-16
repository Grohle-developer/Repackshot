// Phase M2b: the projections and the labels of core/textures.ts at sample points, as the shared fixture both
// sides read (tests/fixtures/texture-mapping.json). This test pins the fixture to what the TypeScript reference
// computes (f64); the engine's `rt_core::texture::mapping` must give the same coordinates in f32
// (engine/crates/rt-core/src/texture/tests.rs), so a texture lands in Full where Fast draws it.
//
// REPACK_WRITE_TEXTURE_FIXTURE=1 npx vitest run tests/texture-mapping.test.ts writes the fixture again.

import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { boxCoords, boxWeights, labelCoords, labelFrame, projectPoint, TEXTURE_AXES, type TextureLabel, type TextureMapping, type TextureProjection } from '../src/core/textures';
import { normalize } from '../src/core/math';
import { AXIS_CODES, PROJECTION_CODES } from '../src/io/rsb';

const PATH = 'tests/fixtures/texture-mapping.json';

/** The mappings tried: every projection and axis, plain and with a turn, repeats, an offset and another size. */
function mappings(): TextureMapping[] {
  const out: TextureMapping[] = [];
  for (const projection of ['UV', 'BOX', 'PLANAR', 'CYLINDRICAL', 'SPHERICAL'] as TextureProjection[]) {
    for (const axis of TEXTURE_AXES) {
      out.push({ projection, axis, uvSet: 0, sizeMm: 100, rotationDeg: 0, offset: [0, 0], repeat: [1, 1], wrap: 'REPEAT' });
      out.push({ projection, axis, uvSet: 0, sizeMm: 80, rotationDeg: 30, offset: [0.25, -0.1], repeat: [2, 0.5], wrap: 'REPEAT' });
      out.push({ projection, axis, uvSet: 0, sizeMm: 37.5, rotationDeg: -135, offset: [-1.5, 3], repeat: [-1, 3], wrap: 'REPEAT' });
    }
  }
  return out;
}

/** Points of a part (mm), none on a cylinder's back seam (where the turn wraps from ½ to −½). */
const POINTS: [number, number, number][] = [
  [10, -40, 25],
  [-33, -12, 7.5],
  [48, 21, -30],
  [5, -60, -2],
  [-20, 15, 44],
  [60, -5, 12],
];

/** Normals with every component non-zero (so a box projection keeps its three axes), and the uv a mesh gives there. */
const NORMALS: [number, number, number][] = [
  [0.2, -0.9, 0.3],
  [-0.7, -0.3, 0.5],
  [0.6, 0.5, -0.4],
  [0.1, -0.2, 0.95],
  [-0.4, 0.8, 0.2],
  [0.9, -0.1, 0.25],
].map((n) => normalize(n) as [number, number, number]);
const UVS: [number, number][] = [
  [0.1, 0.2],
  [0.75, -0.3],
  [1.6, 0.45],
  [-0.2, 2.1],
  [0.5, 0.5],
  [0.33, 0.9],
];
const ASPECTS = [1, 2, 0.75];

const MAPPING_COLUMNS = ['projection', 'axis', 'sizeMm', 'rotationDeg', 'offsetU', 'offsetV', 'repeatU', 'repeatV', 'aspect', 'px', 'py', 'pz', 'nx', 'ny', 'nz', 'uvU', 'uvV', 'u0', 'v0', 'w0', 'u1', 'v1', 'w1', 'u2', 'v2', 'w2'];

/** One case: the inputs, then the coordinates (a box: its three axes X, Y, Z; the others: one and two zero triples). */
function mappingCase(m: TextureMapping, aspect: number, p: [number, number, number], n: [number, number, number], uv: [number, number]): number[] {
  const inputs = [PROJECTION_CODES[m.projection], AXIS_CODES[m.axis], m.sizeMm, m.rotationDeg, m.offset[0], m.offset[1], m.repeat[0], m.repeat[1], aspect, ...p, ...n, ...uv];
  const got = projectPoint(m, p, n, aspect, uv);
  if (m.projection === 'BOX') {
    // Every normal here has three non-zero components: none of the axes is filtered out.
    expect(got).toHaveLength(3);
    const w = boxWeights(n);
    TEXTURE_AXES.forEach((axis, i) => {
      const [s, t] = boxCoords(axis, p, n);
      expect(Number.isFinite(s + t)).toBe(true);
      expect(got[i].weight).toBe(w[i]);
    });
    return [...inputs, ...got.flatMap((c) => [c.u, c.v, c.weight])];
  }
  expect(got).toHaveLength(1);
  return [...inputs, got[0].u, got[0].v, got[0].weight, 0, 0, 0, 0, 0, 0];
}

const LABEL_COLUMNS = ['ox', 'oy', 'oz', 'ux', 'uy', 'uz', 'vx', 'vy', 'vz', 'nx', 'ny', 'nz', 'width', 'height', 'depth', 'px', 'py', 'pz', 'sx', 'sy', 'sz', 'covered', 's', 't'];

/** Labels: placed on a few faces, turned, of other proportions and reaches. */
function labels(): { label: TextureLabel; aspect: number }[] {
  const base = (over: Partial<TextureLabel>): TextureLabel => ({
    id: 'lb',
    image: { id: 'tex:0', name: 'l.png', width: 64, height: 32 },
    origin: [0, -50, 10],
    normal: [0, -1, 0],
    uAxis: [1, 0, 0],
    widthMm: 30,
    rotationDeg: 0,
    depthMm: 0,
    roughness: 0.6,
    coat: 0,
    relief: 0.3,
    ...over,
  });
  return [
    { label: base({}), aspect: 2 },
    { label: base({ rotationDeg: 40, widthMm: 24 }), aspect: 1 },
    { label: base({ origin: [30, 0, 40], normal: [0, 0, 1], uAxis: [0, 1, 0], rotationDeg: -75, depthMm: 3 }), aspect: 0.5 },
    { label: base({ origin: [-20, 10, 5], normal: normalize([-1, 0.2, 0.1]) as [number, number, number], uAxis: normalize([0.2, 1, 0]) as [number, number, number], widthMm: 18 }), aspect: 1.5 },
  ];
}

function labelCases(): number[][] {
  const out: number[][] = [];
  for (const { label, aspect } of labels()) {
    const f = labelFrame(label, aspect);
    // Points around the label: inside, at its corners, outside it, behind its reach, on a surface facing away.
    const pts: { p: number[]; n: number[] }[] = [];
    for (const [a, b, c] of [
      [0, 0, 0],
      [0.3, -0.2, 0.5],
      [-0.49, 0.49, -0.2],
      [0.6, 0, 0],
      [0, -0.7, 0],
      [0.2, 0.1, 1.5],
    ]) {
      const p = [0, 1, 2].map((k) => f.origin[k] + f.u[k] * a * f.width + f.v[k] * b * f.height + f.normal[k] * c * f.depth);
      pts.push({ p, n: f.normal });
      pts.push({ p, n: [-f.normal[0], -f.normal[1], -f.normal[2]] });
    }
    for (const { p, n } of pts) {
      const st = labelCoords(f, p, n);
      out.push([...f.origin, ...f.u, ...f.v, ...f.normal, f.width, f.height, f.depth, ...p, ...n, st ? 1 : 0, st ? st[0] : 0, st ? st[1] : 0]);
    }
  }
  return out;
}

function fixture(): { about: string; columns: string[]; cases: number[][]; labelColumns: string[]; labelCases: number[][] } {
  const cases: number[][] = [];
  for (const m of mappings()) {
    for (const aspect of ASPECTS) {
      POINTS.forEach((p, i) => cases.push(mappingCase(m, aspect, p, NORMALS[i], UVS[i])));
    }
  }
  // `+ 0`: JSON has no −0.
  const plain = (rows: number[][]) => rows.map((r) => r.map((x) => x + 0));
  return {
    about:
      'The projections of src/core/textures.ts (projectPoint: projection and axis as the RSB codes, the mapping, the image aspect, a point, its unit normal and the uv the mesh gives there; then up to three (u, v, weight): a box its axes X, Y, Z, the others one) and its labels (labelFrame, then labelCoords: covered, s, t) at sample points, in f64. Pinned by tests/texture-mapping.test.ts; the engine (engine/crates/rt-core/src/texture/tests.rs) must give the same in f32.',
    columns: MAPPING_COLUMNS,
    cases: plain(cases),
    labelColumns: LABEL_COLUMNS,
    labelCases: plain(labelCases()),
  };
}

const json = (f: ReturnType<typeof fixture>): string =>
  `{\n  "about": ${JSON.stringify(f.about)},\n  "columns": ${JSON.stringify(f.columns)},\n  "cases": [\n${f.cases.map((c) => `    ${JSON.stringify(c)}`).join(',\n')}\n  ],\n  "labelColumns": ${JSON.stringify(f.labelColumns)},\n  "labelCases": [\n${f.labelCases.map((c) => `    ${JSON.stringify(c)}`).join(',\n')}\n  ]\n}\n`;

describe('the projections and labels on the shared fixture (M2b)', () => {
  const now = fixture();
  if (process.env.REPACK_WRITE_TEXTURE_FIXTURE) writeFileSync(PATH, json(now));
  const pinned = JSON.parse(readFileSync(PATH, 'utf8')) as ReturnType<typeof fixture>;

  it('has every projection, axis and kind of label case', () => {
    expect(pinned.columns).toEqual(MAPPING_COLUMNS);
    expect(pinned.labelColumns).toEqual(LABEL_COLUMNS);
    expect(new Set(pinned.cases.map((c) => `${c[0]}:${c[1]}`)).size).toBe(15);
    expect(pinned.cases.length).toBe(15 * 3 * ASPECTS.length * POINTS.length);
    const covered = pinned.labelCases.map((c) => c[21]);
    expect(covered.filter((c) => c === 1).length).toBeGreaterThan(4);
    expect(covered.filter((c) => c === 0).length).toBeGreaterThan(8);
  });

  it('is what core/textures.ts computes', () => {
    expect(pinned.cases).toEqual(now.cases);
    expect(pinned.labelCases).toEqual(now.labelCases);
  });
});
