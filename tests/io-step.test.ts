// STEP and IGES (phase I2): small fixtures written by hand (tests/fixtures/README.md) read by the real
// occt-import-js in Node, through the steps the importer takes (the unit from the file's text, the
// library's parameters, the worker's packing, the conversion in occt-convert.ts): CAD faces, parts and
// groups with their names, colours as materials, units, tessellation quality, face ranges and the
// normals and sharp edges they imply.

import { beforeAll, describe, expect, it } from 'vitest';
import { applyImportOptions, defaultImportOptions, describePayload, ImportError, TESSELLATION_PRESETS, type ImportOptions } from '../src/core/import-options';
import { getMesh, type MeshData, type TriangleRange } from '../src/core/meshes';
import type { SceneNode } from '../src/core/scene';
import type { ReadResult } from '../src/io/gltf';
import { detectFormat } from '../src/io/import';
import { cadMesh, colorName, occtToPayload } from '../src/io/occt-convert';
import { packOcctResult, type OcctMesh } from '../src/io/occt-protocol';
import { igesGlobal, igesLengthUnit, occtParams, readPlan, stepLengthUnit } from '../src/io/step';
import { encode } from './io-helpers';
import { fixture, loadOcct, readCad } from './occt-node';

beforeAll(async () => {
  await loadOcct();
}, 60_000);

const parts = (r: Pick<ReadResult, 'nodes'>): SceneNode[] => Object.values(r.nodes).filter((n) => n.kind === 'PART');
const named = (r: Pick<ReadResult, 'nodes'>, name: string): SceneNode => Object.values(r.nodes).find((n) => n.name === name)!;
const meshOf = (n: SceneNode): MeshData => getMesh(n.mesh!.id)!;
const srgbToLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const close = (got: readonly number[], want: readonly number[], digits = 4) => want.forEach((w, i) => expect(got[i], `[${i}]`).toBeCloseTo(w, digits));

/** World bounds of a part (its node position plus its local mesh bounds). */
function worldBounds(n: SceneNode): { min: number[]; max: number[] } {
  return { min: n.mesh!.bounds.min.map((v, k) => v + n.transform.position[k]), max: n.mesh!.bounds.max.map((v, k) => v + n.transform.position[k]) };
}

/** Every triangle of the mesh is in exactly one range, and the ranges are consecutive. */
function expectCovers(ranges: readonly TriangleRange[], triangles: number): void {
  const seen = new Uint8Array(triangles);
  for (const r of ranges) {
    expect(r.count).toBeGreaterThan(0);
    for (let t = r.start; t < r.start + r.count; t++) {
      expect(t).toBeLessThan(triangles);
      seen[t]++;
    }
  }
  expect([...seen].every((s) => s === 1), 'each triangle in exactly one face').toBe(true);
}

/** The face each vertex belongs to (vertices are never shared by two faces). */
function faceOfVertex(mesh: MeshData, ranges: readonly TriangleRange[]): Int32Array {
  const owner = new Int32Array(mesh.positions.length / 3).fill(-1);
  ranges.forEach((r, f) => {
    for (let t = r.start; t < r.start + r.count; t++) {
      for (let j = 0; j < 3; j++) {
        const v = mesh.indices[3 * t + j];
        expect(owner[v] === -1 || owner[v] === f, `vertex ${v} is in faces ${owner[v]} and ${f}`).toBe(true);
        owner[v] = f;
      }
    }
  });
  return owner;
}

/** Pairs of vertices of different faces at the same position, with the dot product of their normals. */
function seams(mesh: MeshData, ranges: readonly TriangleRange[]): { a: number; b: number; dot: number }[] {
  const owner = faceOfVertex(mesh, ranges);
  const at = new Map<string, number[]>();
  const p = mesh.positions;
  for (let v = 0; v < p.length / 3; v++) {
    const key = `${p[3 * v].toFixed(4)},${p[3 * v + 1].toFixed(4)},${p[3 * v + 2].toFixed(4)}`;
    (at.get(key) ?? at.set(key, []).get(key)!).push(v);
  }
  const n = mesh.normals;
  const out: { a: number; b: number; dot: number }[] = [];
  for (const vs of at.values()) {
    for (let i = 0; i < vs.length; i++) {
      for (let j = i + 1; j < vs.length; j++) {
        const [a, b] = [vs[i], vs[j]];
        if (owner[a] === owner[b]) continue;
        out.push({ a, b, dot: n[3 * a] * n[3 * b] + n[3 * a + 1] * n[3 * b + 1] + n[3 * a + 2] * n[3 * b + 2] });
      }
    }
  }
  return out;
}

const withDefaults = (r: ReadResult, overrides: Partial<ImportOptions> = {}) => applyImportOptions(r, { ...defaultImportOptions(r.detected, false), ...overrides });

describe('STEP: a box with a name and a colour', () => {
  it('is one part named Box with its six CAD faces', async () => {
    const r = await readCad('box.step');
    expect(describePayload(r)).toEqual({ parts: 1, groups: 0, triangles: 12, materials: 1 });
    const model = r.nodes[r.roots[0]];
    expect(model).toMatchObject({ kind: 'MODEL', name: 'box', source: { kind: 'FILE', name: 'box.step', format: 'STEP' } });
    const box = r.nodes[model.children[0]];
    expect(box).toMatchObject({ kind: 'PART', name: 'Box' });
    expect(box.faceRanges).toHaveLength(6);
    expectCovers(box.faceRanges!, 12);
    expect(box.faceRanges!.map((f) => f.count)).toEqual([2, 2, 2, 2, 2, 2]);
    // 4 vertices per face: no face shares a vertex with another.
    expect(box.mesh).toMatchObject({ vertices: 24, triangles: 12 });
  });

  it('keeps the colour as a SIMPLE instance with the linear value of the sRGB colour in the file', async () => {
    const r = await readCad('box.step');
    const box = named(r, 'Box');
    const mat = r.materials[box.material!];
    expect(mat).toMatchObject({ family: 'SIMPLE', preset: null, name: '#CC3319' });
    close(mat.params.baseColor as readonly number[], [srgbToLinear(0.8), srgbToLinear(0.2), srgbToLinear(0.1), 1], 4);
    expect(mat.params).toMatchObject({ metallic: 0, roughness: 0.5 });
    expect(box.faceMaterials).toBeUndefined();
  });

  it('says what it detected: millimetres declared, Z up by convention, 40 mm', async () => {
    const r = await readCad('box.step');
    expect(r.detected).toEqual({ units: 'mm', upAxis: 'Z', upAxisDeclared: false, size: 40, hasLayers: false, hiddenParts: 0 });
    const box = named(r, 'Box');
    close(worldBounds(box).min, [0, 0, 0]);
    close(worldBounds(box).max, [40, 30, 20]);
    expect(r.warnings).toEqual([]);
    expect(r.notes).toEqual([]);
  });

  it('marks the twelve edges between faces as sharp, from the topology', async () => {
    const r = await readCad('box.step');
    const mesh = meshOf(named(r, 'Box'));
    expect(mesh.sharpEdges!.length / 2).toBe(12);
    // Each one joins two corners of the box.
    const p = mesh.positions;
    for (let i = 0; i < mesh.sharpEdges!.length; i += 2) {
      const [a, b] = [mesh.sharpEdges![i], mesh.sharpEdges![i + 1]];
      const len = Math.hypot(p[3 * a] - p[3 * b], p[3 * a + 1] - p[3 * b + 1], p[3 * a + 2] - p[3 * b + 2]);
      expect([40, 30, 20].some((d) => Math.abs(len - d) < 1e-4), `edge of length ${len}`).toBe(true);
    }
  });

  it('gives each face its own flat normal, so they are discontinuous at every corner', async () => {
    const r = await readCad('box.step');
    const box = named(r, 'Box');
    const mesh = meshOf(box);
    const pairs = seams(mesh, box.faceRanges!);
    // 8 corners, 3 faces each: 3 pairs per corner.
    expect(pairs).toHaveLength(24);
    for (const s of pairs) expect(s.dot).toBeCloseTo(0, 5);
  });
});

describe('STEP: a cylinder', () => {
  it('has three CAD faces (two caps and the wall), no colour, the neutral Default', async () => {
    const r = await readCad('cylinder.step');
    const cyl = named(r, 'Cylinder');
    expect(cyl.faceRanges).toHaveLength(3);
    expectCovers(cyl.faceRanges!, cyl.mesh!.triangles);
    expect(r.materials[cyl.material!].role).toBe('DEFAULT');
    expect(Object.keys(r.materials)).toEqual(['tm_default']);
    close(worldBounds(cyl).min, [-10, -10, 0], 2);
    close(worldBounds(cyl).max, [10, 10, 30], 2);
  });

  it('is smooth inside the wall and hard at its borders with the caps', async () => {
    const r = await readCad('cylinder.step');
    const cyl = named(r, 'Cylinder');
    const mesh = meshOf(cyl);
    const pairs = seams(mesh, cyl.faceRanges!);
    // Every vertex on the two circles exists once in the wall and once in its cap, with normals at right angles.
    expect(pairs.length).toBeGreaterThan(20);
    for (const s of pairs) expect(Math.abs(s.dot)).toBeLessThan(0.05);
    // Inside the wall the vertices are shared and the normals point away from the axis.
    const wall = cyl.faceRanges!.reduce((a, b) => (b.count > a.count ? b : a));
    const used = new Set<number>();
    for (let t = wall.start; t < wall.start + wall.count; t++) for (let j = 0; j < 3; j++) used.add(mesh.indices[3 * t + j]);
    expect(used.size).toBeLessThan(wall.count * 3 / 2);
    const c = cyl.transform.position;
    for (const v of used) {
      const radial = [mesh.positions[3 * v] + c[0], mesh.positions[3 * v + 1] + c[1]];
      const len = Math.hypot(radial[0], radial[1]);
      const dot = (mesh.normals[3 * v] * radial[0] + mesh.normals[3 * v + 1] * radial[1]) / len;
      expect(dot).toBeGreaterThan(0.95);
      expect(Math.abs(mesh.normals[3 * v + 2])).toBeLessThan(0.05);
    }
  });

  it('marks the two circles as sharp edges and not the seam of the wall', async () => {
    const r = await readCad('cylinder.step');
    const cyl = named(r, 'Cylinder');
    const mesh = meshOf(cyl);
    const z = cyl.transform.position[2];
    const e = mesh.sharpEdges!;
    expect(e.length).toBeGreaterThan(0);
    const key = (a: number, b: number) => [a, b].map((v) => `${mesh.positions[3 * v].toFixed(4)},${mesh.positions[3 * v + 1].toFixed(4)},${mesh.positions[3 * v + 2].toFixed(4)}`).sort().join('|');
    const sharp = new Set<string>();
    for (let i = 0; i < e.length; i += 2) {
      const [a, b] = [e[i], e[i + 1]];
      // A real segment with both ends on the same circle: z = 0 or z = 30.
      expect(Math.hypot(mesh.positions[3 * a] - mesh.positions[3 * b], mesh.positions[3 * a + 1] - mesh.positions[3 * b + 1])).toBeGreaterThan(1e-3);
      const za = mesh.positions[3 * a + 2] + z;
      const zb = mesh.positions[3 * b + 2] + z;
      expect(Math.abs(za - zb)).toBeLessThan(1e-4);
      expect([0, 30].some((h) => Math.abs(za - h) < 1e-4)).toBe(true);
      sharp.add(key(a, b));
    }
    // Exactly the borders of the two caps: every segment of both circles, once.
    const caps = cyl.faceRanges!.filter((f) => f !== cyl.faceRanges!.reduce((x, y) => (y.count > x.count ? y : x)));
    const borders = new Set<string>();
    for (const cap of caps) {
      const uses = new Map<string, number>();
      for (let t = cap.start; t < cap.start + cap.count; t++) for (let j = 0; j < 3; j++) {
        const k = key(mesh.indices[3 * t + j], mesh.indices[3 * t + ((j + 1) % 3)]);
        uses.set(k, (uses.get(k) ?? 0) + 1);
      }
      for (const [k, n] of uses) if (n === 1) borders.add(k);
    }
    expect(e.length / 2).toBe(sharp.size);
    expect([...sharp].sort()).toEqual([...borders].sort());
  });

  it('changes its triangles with the tessellation quality: Low < Medium < High', async () => {
    const count = async (t: keyof typeof TESSELLATION_PRESETS) => named(await readCad('cylinder.step', TESSELLATION_PRESETS[t]), 'Cylinder').mesh!.triangles;
    const [low, medium, high] = [await count('LOW'), await count('MEDIUM'), await count('HIGH')];
    expect(low).toBeLessThan(medium);
    expect(medium).toBeLessThan(high);
    // The faces stay three whatever the quality, and the angle field alone changes the count too.
    expect(named(await readCad('cylinder.step', TESSELLATION_PRESETS.HIGH), 'Cylinder').faceRanges).toHaveLength(3);
    const coarseAngle = named(await readCad('cylinder.step', { chordPercent: 5, angleDeg: 45 }), 'Cylinder').mesh!.triangles;
    const fineAngle = named(await readCad('cylinder.step', { chordPercent: 5, angleDeg: 5 }), 'Cylinder').mesh!.triangles;
    expect(coarseAngle).toBeLessThan(fineAngle);
  });
});

describe('STEP: an assembly of two named parts with two colours', () => {
  it('keeps the hierarchy as a named group with the two named parts', async () => {
    const r = await readCad('assembly.step');
    expect(describePayload(r)).toMatchObject({ parts: 2, groups: 1, materials: 2 });
    const model = r.nodes[r.roots[0]];
    expect(model.children.map((c) => [r.nodes[c].kind, r.nodes[c].name])).toEqual([['GROUP', 'Bottle']]);
    const bottle = named(r, 'Bottle');
    expect(bottle.children.map((c) => [r.nodes[c].kind, r.nodes[c].name])).toEqual([
      ['PART', 'Body'],
      ['PART', 'Cap'],
    ]);
    expect(named(r, 'Body').faceRanges).toHaveLength(6);
    expect(named(r, 'Cap').faceRanges).toHaveLength(3);
  });

  it('places the cap on the body, where the assembly puts it', async () => {
    const r = await readCad('assembly.step');
    close(worldBounds(named(r, 'Body')).min, [0, 0, 0]);
    close(worldBounds(named(r, 'Body')).max, [40, 40, 60]);
    close(worldBounds(named(r, 'Cap')).min, [8, 8, 60], 2);
    close(worldBounds(named(r, 'Cap')).max, [32, 32, 75], 2);
  });

  it('gives each colour its own instance', async () => {
    const r = await readCad('assembly.step');
    const body = r.materials[named(r, 'Body').material!];
    const cap = r.materials[named(r, 'Cap').material!];
    expect(body.id).not.toBe(cap.id);
    close(body.params.baseColor as readonly number[], [srgbToLinear(0.1), srgbToLinear(0.3), srgbToLinear(0.8)], 4);
    close(cap.params.baseColor as readonly number[], [srgbToLinear(0.9), srgbToLinear(0.1), srgbToLinear(0.1)], 4);
    // 0.1 and 0.9 of 255 fall half way between two bytes: the colour round trip (float32 in the library) picks the lower.
    expect([body.name, cap.name]).toEqual(['#194CCC', '#E51919']);
  });

  it('comes in standing, centred and in millimetres with the sheet defaults', async () => {
    const r = await readCad('assembly.step');
    const applied = withDefaults(r);
    expect(describePayload(applied)).toMatchObject({ parts: 2, groups: 1, materials: 2 });
    // The faces survive the options pipeline untouched (no unit or axis change: the same mesh).
    for (const n of Object.values(applied.nodes).filter((x) => x.kind === 'PART')) expect(n.faceRanges!.length).toBeGreaterThan(0);
  });
});

describe('STEP: units', () => {
  it('reads a file in inches in inches, and the sheet turns it into millimetres', async () => {
    const r = await readCad('box-inch.step');
    expect(r.detected.units).toBe('in');
    expect(r.detected.size).toBeCloseTo(2, 5);
    const box = named(r, 'Inch box');
    close(worldBounds(box).max, [2, 1.5, 1], 5);
    expect(r.materials[box.material!].role).toBe('DEFAULT');
    const applied = withDefaults(r);
    const placed = Object.values(applied.nodes).find((n) => n.kind === 'PART')!;
    close(placed.mesh!.bounds.max.map((v, k) => v - placed.mesh!.bounds.min[k]), [50.8, 38.1, 25.4], 3);
    // The faces are the same triangles after the scale.
    expect(placed.faceRanges).toEqual(box.faceRanges);
  });

  it('lets the sheet override the declared unit, as for every format', async () => {
    const r = await readCad('box-inch.step');
    const applied = withDefaults(r, { units: 'mm' });
    const placed = Object.values(applied.nodes).find((n) => n.kind === 'PART')!;
    close(placed.mesh!.bounds.max.map((v, k) => v - placed.mesh!.bounds.min[k]), [2, 1.5, 1], 4);
  });

  it('finds the length unit of a STEP file in its context, whatever form it takes', () => {
    expect(stepLengthUnit(fixture('box.step'))).toEqual({ unit: 'mm' });
    expect(stepLengthUnit(fixture('box-inch.step'))).toEqual({ unit: 'in' });
    const ctx = (unit: string) =>
      encode(`DATA;\n#5=${unit};\n#6=( NAMED_UNIT(*) PLANE_ANGLE_UNIT() SI_UNIT($,.RADIAN.) );\n#9=( GEOMETRIC_REPRESENTATION_CONTEXT(3) GLOBAL_UNIT_ASSIGNED_CONTEXT((#5,#6)) REPRESENTATION_CONTEXT('','') );\nENDSEC;`);
    expect(stepLengthUnit(ctx('( LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT($,.METRE.) )'))).toEqual({ unit: 'm' });
    expect(stepLengthUnit(ctx('(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT(.CENTI.,.METRE.))'))).toEqual({ unit: 'cm' });
    expect(stepLengthUnit(ctx("( CONVERSION_BASED_UNIT('FOOT',#7) LENGTH_UNIT() NAMED_UNIT(#8) )"))).toEqual({ unit: null, other: 'foot' });
    expect(stepLengthUnit(ctx('( LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MICRO.,.METRE.) )'))).toEqual({ unit: null, other: 'micrometre' });
    expect(stepLengthUnit(encode('DATA;\n#1=PRODUCT(\'x\',\'x\',\'\',(#2));\nENDSEC;'))).toEqual({ unit: null });
  });

  it('asks the library for the declared unit, or for millimetres with a note when the sheet does not offer it', () => {
    expect(readPlan('STEP', fixture('box-inch.step')).params.linearUnit).toBe('inch');
    expect(readPlan('STEP', fixture('box.step'))).toMatchObject({ units: 'mm', notes: [] });
    const foot = encode("#5=( CONVERSION_BASED_UNIT('FOOT',#7) LENGTH_UNIT() NAMED_UNIT(#8) );\n#9=( GLOBAL_UNIT_ASSIGNED_CONTEXT((#5)) );");
    expect(readPlan('STEP', foot)).toMatchObject({ units: 'mm', params: { linearUnit: 'millimeter' }, notes: [{ code: 'unitsConverted', params: { unit: 'foot' } }] });
  });
});

describe('the tessellation the sheet asks for', () => {
  it('becomes a chord relative to the model size and an angle in radians', () => {
    expect(occtParams('mm', { chordPercent: 0.05, angleDeg: 12 })).toEqual({ linearUnit: 'millimeter', linearDeflectionType: 'bounding_box_ratio', linearDeflection: 0.0005, angularDeflection: (12 * Math.PI) / 180 });
    expect(occtParams('in').linearUnit).toBe('inch');
    expect(occtParams('cm').linearUnit).toBe('centimeter');
    expect(occtParams('m').linearUnit).toBe('meter');
    // Medium is the default, and the presets get finer from Low to High.
    expect(occtParams('mm')).toEqual(occtParams('mm', TESSELLATION_PRESETS.MEDIUM));
    expect(TESSELLATION_PRESETS.LOW.chordPercent).toBeGreaterThan(TESSELLATION_PRESETS.MEDIUM.chordPercent);
    expect(TESSELLATION_PRESETS.MEDIUM.chordPercent).toBeGreaterThan(TESSELLATION_PRESETS.HIGH.chordPercent);
    expect(TESSELLATION_PRESETS.LOW.angleDeg).toBeGreaterThan(TESSELLATION_PRESETS.MEDIUM.angleDeg);
    expect(TESSELLATION_PRESETS.MEDIUM.angleDeg).toBeGreaterThan(TESSELLATION_PRESETS.HIGH.angleDeg);
  });
});

describe('IGES', () => {
  it('reads a single surface by the same path: one part with one CAD face, its name and its colour', async () => {
    const r = await readCad('quarter.igs');
    expect(describePayload(r)).toMatchObject({ parts: 1, groups: 0, materials: 1 });
    const shell = named(r, 'Quarter shell');
    expect(shell.kind).toBe('PART');
    expect(shell.faceRanges).toEqual([{ start: 0, count: shell.mesh!.triangles }]);
    // Colour number 2 is red.
    expect(r.materials[shell.material!].params.baseColor).toEqual([1, 0, 0, 1]);
    // A quarter of a cylinder of radius 10 and height 20 about z.
    close(worldBounds(shell).min, [0, 0, 0], 3);
    close(worldBounds(shell).max, [10, 10, 20], 3);
    // A single face has no edge with another face.
    expect(meshOf(shell).sharpEdges!.length).toBe(0);
    expect(r.detected.units).toBe('mm');
  });

  it('reads the unit of the global section: inches stay inches until the sheet scales them', async () => {
    expect(igesLengthUnit(fixture('quarter.igs'))).toEqual({ unit: 'mm' });
    expect(igesLengthUnit(fixture('quarter-inch.igs'))).toEqual({ unit: 'in' });
    expect(igesGlobal(fixture('quarter.igs')).slice(0, 4)).toEqual([',', ';', 'repackshot-tests', 'quarter.igs']);
    const r = await readCad('quarter-inch.igs');
    expect(r.detected.units).toBe('in');
    expect(r.detected.size).toBeCloseTo(20, 3);
    const placed = Object.values(withDefaults(r).nodes).find((n) => n.kind === 'PART')!;
    expect(placed.mesh!.bounds.max[2] - placed.mesh!.bounds.min[2]).toBeCloseTo(508, 2);
  });

  it('changes its triangles with the quality too', async () => {
    const tris = async (t: keyof typeof TESSELLATION_PRESETS) => named(await readCad('quarter.igs', TESSELLATION_PRESETS[t]), 'Quarter shell').mesh!.triangles;
    expect(await tris('LOW')).toBeLessThan(await tris('HIGH'));
  });
});

describe('format detection', () => {
  it('knows STEP and IGES by extension and by their first line', () => {
    expect(detectFormat('part.step', new Uint8Array())).toBe('STEP');
    expect(detectFormat('part.STP', new Uint8Array())).toBe('STEP');
    expect(detectFormat('part.iges', new Uint8Array())).toBe('IGES');
    expect(detectFormat('part.igs', new Uint8Array())).toBe('IGES');
    expect(detectFormat('download', fixture('box.step'))).toBe('STEP');
    expect(detectFormat('download', fixture('quarter.igs'))).toBe('IGES');
  });
});

describe('what cannot be read', () => {
  it('a damaged or empty file is an ImportError, not a crash', async () => {
    const occt = await loadOcct();
    for (const text of ['hello', 'ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n']) {
      const raw = packOcctResult(occt.ReadFile('step', encode(text), occtParams('mm'))).result;
      expect(() => occtToPayload(raw, { fileName: 'x.step', format: 'STEP', units: 'mm' })).toThrow(ImportError);
      try {
        occtToPayload(raw, { fileName: 'x.step', format: 'STEP', units: 'mm' });
      } catch (err) {
        expect((err as ImportError).code).toBe('unreadable');
      }
    }
  });

  it('a file without surfaces is "empty"', () => {
    expect(() => occtToPayload({ success: true, root: { name: '', meshes: [], children: [{ name: 'Nothing', meshes: [], children: [] }] }, meshes: [] }, { fileName: 'x.step', format: 'STEP', units: 'mm' })).toThrowError(
      expect.objectContaining({ code: 'empty' }),
    );
  });
});

// --- The conversion on its own (meshes built by hand, as the library returns them) ---------------------------

/** Two unit squares meeting at a right angle along x = 0..1, y = 0, z = 0, sharing their edge vertices. */
function foldedPair(withNormals: boolean): OcctMesh {
  // Face 0 in z = 0 (normal +z), face 1 in y = 0 (normal -y). Vertices 0 and 1 are on the shared edge and SHARED.
  const positions = [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 0, -1, 0, 0, -1];
  const normals = [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, -1, 0, 0, -1, 0];
  return {
    name: 'pair',
    color: [0.5, 0.5, 0.5],
    brep_faces: [
      { first: 0, last: 1, color: null },
      { first: 2, last: 3, color: [1, 0, 0] },
    ],
    attributes: { position: { array: positions }, ...(withNormals ? { normal: { array: normals } } : {}) },
    index: { array: [0, 1, 2, 0, 2, 3, 0, 4, 1, 0, 5, 4] },
  };
}

describe('the conversion, on meshes built by hand', () => {
  it('splits a vertex two faces share, so each face keeps its own normal', () => {
    for (const withNormals of [true, false]) {
      const built = cadMesh(foldedPair(withNormals))!;
      expect(built.faces).toEqual([
        { start: 0, count: 2 },
        { start: 2, count: 2 },
      ]);
      // Four vertices per face: the two shared ones were copied.
      expect(built.data.positions.length / 3).toBe(8);
      const n = built.data.normals;
      for (let v = 0; v < 4; v++) close([n[3 * v], n[3 * v + 1], n[3 * v + 2]], [0, 0, 1], 5);
      for (let v = 4; v < 8; v++) close([n[3 * v], n[3 * v + 1], n[3 * v + 2]], [0, -1, 0], 5);
      // The fold is the one edge between the faces.
      expect(built.data.sharpEdges!.length / 2).toBe(1);
    }
  });

  it('gives a face with its own colour a face-material range and names colours by their sRGB value', () => {
    const r = occtToPayload({ success: true, root: { name: '', meshes: [], children: [{ name: 'Pair', meshes: [0], children: [] }] }, meshes: [foldedPair(true)] }, { fileName: 'pair.step', format: 'STEP', units: 'mm' });
    const pair = named(r, 'Pair');
    expect(r.materials[pair.material!].name).toBe(colorName([0.5, 0.5, 0.5]));
    expect(pair.faceMaterials).toEqual([{ start: 2, count: 2, material: Object.values(r.materials).find((m) => m.name === '#FF0000')!.id }]);
    expect(colorName([0.5, 0.5, 0.5])).toBe('#BCBCBC');
  });

  it('drops degenerate triangles and faces the library left empty, and says so', () => {
    const m = foldedPair(true);
    m.brep_faces.push({ first: 4, last: 3, color: null });
    (m.index.array as number[]).push(1, 1, 2);
    m.brep_faces[1] = { first: 2, last: 4, color: [1, 0, 0] };
    const r = occtToPayload({ success: true, root: { name: '', meshes: [0], children: [] }, meshes: [m] }, { fileName: 'pair.step', format: 'STEP', units: 'mm' });
    const part = parts(r)[0];
    expect(part.mesh!.triangles).toBe(4);
    expect(part.faceRanges).toEqual([
      { start: 0, count: 2 },
      { start: 2, count: 2 },
    ]);
    expect(r.warnings).toEqual([{ code: 'degenerate', params: { part: 'pair', count: 1 } }]);
    expect(r.notes).toEqual([{ code: 'cadEmptyFaces', params: { count: 1 } }]);
  });

  it('makes a group of a node with several meshes, and of a node with children', () => {
    const r = occtToPayload(
      {
        success: true,
        root: { name: '', meshes: [], children: [{ name: 'Kit', meshes: [], children: [{ name: 'Two solids', meshes: [0, 1], children: [] }] }] },
        meshes: [foldedPair(true), { ...foldedPair(true), name: '' }],
      },
      { fileName: 'kit.step', format: 'STEP', units: 'mm' },
    );
    const kit = named(r, 'Kit');
    expect(kit.kind).toBe('GROUP');
    const two = r.nodes[kit.children[0]];
    expect([two.kind, two.name]).toEqual(['GROUP', 'Two solids']);
    expect(two.children.map((c) => r.nodes[c].name)).toEqual(['pair', 'Two solids 2']);
  });
});

describe('separate by CAD face', () => {
  it('makes one part per face, each with its own single face', async () => {
    const r = await readCad('box.step');
    const applied = withDefaults(r, { separate: 'face' });
    const ps = Object.values(applied.nodes).filter((n) => n.kind === 'PART');
    expect(ps).toHaveLength(6);
    expect(ps.map((p) => p.name)).toEqual(['Box 1', 'Box 2', 'Box 3', 'Box 4', 'Box 5', 'Box 6']);
    for (const p of ps) {
      expect(p.mesh!.triangles).toBe(2);
      expect(p.faceRanges).toEqual([{ start: 0, count: 2 }]);
      expect(p.material).toBe(named(r, 'Box').material);
    }
    // A part without CAD faces is left whole.
    expect(Object.values(withDefaults(r, { separate: 'material' }).nodes).filter((n) => n.kind === 'PART')).toHaveLength(1);
  });

  it('keeps the colour of a face that has its own', () => {
    const r = occtToPayload({ success: true, root: { name: '', meshes: [], children: [{ name: 'Pair', meshes: [0], children: [] }] }, meshes: [foldedPair(true)] }, { fileName: 'pair.step', format: 'STEP', units: 'mm' });
    const applied = withDefaults(r, { separate: 'face' });
    const ps = Object.values(applied.nodes).filter((n) => n.kind === 'PART');
    expect(ps.map((p) => applied.materials[p.material!].name)).toEqual(['#BCBCBC', '#FF0000']);
    expect(ps.every((p) => p.faceMaterials === undefined)).toBe(true);
  });

  it('separating by material keeps the faces of each piece, numbered in it', () => {
    const r = occtToPayload({ success: true, root: { name: '', meshes: [], children: [{ name: 'Pair', meshes: [0], children: [] }] }, meshes: [foldedPair(true)] }, { fileName: 'pair.step', format: 'STEP', units: 'mm' });
    const applied = withDefaults(r, { separate: 'material' });
    const ps = Object.values(applied.nodes).filter((n) => n.kind === 'PART');
    expect(ps).toHaveLength(2);
    for (const p of ps) expect(p.faceRanges).toEqual([{ start: 0, count: 2 }]);
  });
});
