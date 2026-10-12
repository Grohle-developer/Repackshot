// The options pipeline of the import sheet (phase I3): units, up axis, flip
// normals, grouping, material policy, separation and hidden parts, applied to
// payloads written by hand so every number can be checked.

import { describe, expect, it } from 'vitest';
import {
  applyImportOptions,
  defaultImportOptions,
  describePayload,
  LARGE_MODEL_MM,
  payloadSize,
  releaseImport,
  SMALL_MODEL_MM,
  unitFromMillimetres,
  UNIT_TO_MM,
  type ImportUnit,
} from '../src/core/import-options';
import { getMesh, hasMesh } from '../src/core/meshes';
import { boundsOf, partsUnder, treeOrder } from '../src/core/scene';
import { createInitialState, reduce } from '../src/core/store';
import { makePayload, meshOf, optionsFor, partsOf } from './io-helpers';

const close = (got: readonly number[], want: readonly number[], digits = 4) => want.forEach((w, i) => expect(got[i], `[${i}]`).toBeCloseTo(w, digits));

/** The vertices of a mesh whose normal is `n`. */
function verticesWithNormal(mesh: ReturnType<typeof meshOf>, n: [number, number, number]): number[] {
  const out: number[] = [];
  for (let i = 0; i < mesh.normals.length; i += 3) {
    if (Math.abs(mesh.normals[i] - n[0]) + Math.abs(mesh.normals[i + 1] - n[1]) + Math.abs(mesh.normals[i + 2] - n[2]) < 1e-6) out.push(i / 3);
  }
  return out;
}

describe('units', () => {
  const table: [ImportUnit, number][] = [
    ['mm', 1],
    ['cm', 10],
    ['m', 1000],
    ['in', 25.4],
  ];

  it('the table is millimetres per unit: inch x 25.4, cm x 10, m x 1000', () => {
    for (const [u, k] of table) expect(UNIT_TO_MM[u]).toBe(k);
  });

  it.each(table)('%s: geometry, pivots and the whole size scale by %s', (unit, k) => {
    const raw = makePayload([{ name: 'Body', size: [10, 20, 30], at: [1, 2, 3] }]);
    const out = applyImportOptions(raw, optionsFor({ units: unit }));
    const [body] = partsOf(out);
    close(body.mesh!.bounds.min, [-5 * k, -10 * k, -15 * k], 3);
    close(body.mesh!.bounds.max, [5 * k, 10 * k, 15 * k], 3);
    close(body.transform.position, [1 * k, 2 * k, 3 * k], 3);
    expect(payloadSize(out)).toBeCloseTo(30 * k, 3);
    // Normals are directions: they do not scale.
    const m = meshOf(body);
    for (let i = 0; i < m.normals.length; i += 3) expect(Math.hypot(m.normals[i], m.normals[i + 1], m.normals[i + 2])).toBeCloseTo(1, 6);
  });

  it('millimetres in Z up change nothing: the mesh is shared, not copied', () => {
    const raw = makePayload([{ name: 'Body', size: [10, 20, 30] }]);
    const out = applyImportOptions(raw, optionsFor());
    expect(partsOf(out)[0].mesh!.id).toBe(raw.nodes.p1.mesh!.id);
    // Anything that does change the mesh makes a new one and leaves the input alone.
    const scaled = applyImportOptions(raw, optionsFor({ units: 'cm' }));
    expect(partsOf(scaled)[0].mesh!.id).not.toBe(raw.nodes.p1.mesh!.id);
    close(raw.nodes.p1.mesh!.bounds.max, [5, 10, 15]);
    expect(Array.from(getMesh(raw.nodes.p1.mesh!.id)!.positions.subarray(0, 3))).toEqual([5, -10, -15]);
  });

  it('maps a declared millimetres-per-unit back to a unit, or to none', () => {
    expect(unitFromMillimetres(10)).toBe('cm');
    expect(unitFromMillimetres(25.4)).toBe('in');
    expect(unitFromMillimetres(1000.0000001)).toBe('m');
    expect(unitFromMillimetres(304.8)).toBeNull(); // feet
    expect(unitFromMillimetres(0.001)).toBeNull(); // microns
  });
});

describe('up axis', () => {
  it('Y up moves +Y to +Z (and +Z to -Y): extents, pivot and normals', () => {
    // 10 wide (x), 20 deep (y), 30 tall (z) in the file; the file's y is up.
    const raw = makePayload([{ name: 'Body', size: [10, 20, 30], at: [1, 2, 3] }], { upAxis: 'Y' });
    const out = applyImportOptions(raw, optionsFor({ upAxis: 'Y' }));
    const [body] = partsOf(out);
    // New z is the old y (20 tall); new y is minus the old z (30 deep).
    close(body.mesh!.bounds.min, [-5, -15, -10]);
    close(body.mesh!.bounds.max, [5, 15, 10]);
    close(body.transform.position, [1, -3, 2]);
    const before = getMesh(raw.nodes.p1.mesh!.id)!;
    const after = meshOf(body);
    // The face that pointed up in the file (+Y) points up now (+Z), vertex for vertex.
    const upFace = verticesWithNormal(before, [0, 1, 0]);
    expect(upFace).toHaveLength(4);
    for (const v of upFace) {
      close(Array.from(after.normals.subarray(3 * v, 3 * v + 3)), [0, 0, 1], 6);
      expect(after.positions[3 * v + 2]).toBeCloseTo(10, 5);
    }
    // The file's +Z face points at -Y now.
    for (const v of verticesWithNormal(before, [0, 0, 1])) close(Array.from(after.normals.subarray(3 * v, 3 * v + 3)), [0, -1, 0], 6);
    // A rotation keeps the winding: the triangles are the same, index for index.
    expect(Array.from(after.indices)).toEqual(Array.from(before.indices));
  });

  it('Z up leaves the axes alone', () => {
    const raw = makePayload([{ name: 'Body', size: [10, 20, 30], at: [1, 2, 3] }]);
    const out = applyImportOptions(raw, optionsFor());
    close(partsOf(out)[0].mesh!.bounds.max, [5, 10, 15]);
    close(partsOf(out)[0].transform.position, [1, 2, 3]);
  });

  it('units and axes compose: a file in inches, Y up', () => {
    const raw = makePayload([{ name: 'Body', size: [1, 2, 3], at: [0, 1, 0] }]);
    const out = applyImportOptions(raw, optionsFor({ units: 'in', upAxis: 'Y' }));
    const [body] = partsOf(out);
    close(body.mesh!.bounds.max, [0.5 * 25.4, 1.5 * 25.4, 1 * 25.4], 3);
    close(body.transform.position, [0, -0, 25.4], 3);
    // Standing on the floor afterwards (the store action the sheet dispatches).
    let s = reduce(createInitialState(), { type: 'scene/addModel', payload: out, replace: true });
    s = reduce(s, { type: 'scene/restOnFloor', ids: [s.scene.roots[0]] });
    const b = boundsOf(s, s.scene.roots);
    expect(b.min[2]).toBeCloseTo(0, 6);
    expect(b.max[2]).toBeCloseTo(2 * 25.4, 3); // the file's y extent (2) is the height now
  });
});

describe('flip normals', () => {
  it('negates the normals and reverses the winding, and twice is the identity', () => {
    const raw = makePayload([{ name: 'Body', size: [10, 20, 30] }]);
    const flipped = applyImportOptions(raw, optionsFor({ flipNormals: true }));
    const before = getMesh(raw.nodes.p1.mesh!.id)!;
    const after = meshOf(partsOf(flipped)[0]);
    for (let i = 0; i < before.normals.length; i++) expect(after.normals[i]).toBeCloseTo(-before.normals[i], 6);
    for (let t = 0; t < before.indices.length; t += 3) {
      expect([after.indices[t], after.indices[t + 1], after.indices[t + 2]]).toEqual([before.indices[t], before.indices[t + 2], before.indices[t + 1]]);
    }
    // The winding now agrees with the flipped normals: the geometric normal of each triangle is the stored one.
    const p = after.positions;
    const n = after.normals;
    for (let t = 0; t < after.indices.length; t += 3) {
      const [a, b, c] = [after.indices[t], after.indices[t + 1], after.indices[t + 2]];
      const u = [p[3 * b] - p[3 * a], p[3 * b + 1] - p[3 * a + 1], p[3 * b + 2] - p[3 * a + 2]];
      const v = [p[3 * c] - p[3 * a], p[3 * c + 1] - p[3 * a + 1], p[3 * c + 2] - p[3 * a + 2]];
      const g = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      expect(g[0] * n[3 * a] + g[1] * n[3 * a + 1] + g[2] * n[3 * a + 2]).toBeGreaterThan(0);
    }
    // Hard edges are pairs of vertex indices: untouched.
    const twice = applyImportOptions({ ...flipped, detected: raw.detected }, optionsFor({ flipNormals: true }));
    expect(Array.from(meshOf(partsOf(twice)[0]).indices)).toEqual(Array.from(before.indices));
  });
});

describe('group by', () => {
  const four = () =>
    makePayload(
      [
        { name: 'Wall', size: [10, 10, 10], material: 'Steel', group: 'Shell', layer: 'Frame' },
        { name: 'Lid', size: [10, 10, 10], material: 'Brass', group: 'Shell', layer: 'Trim' },
        { name: 'Bolt', size: [2, 2, 2], material: 'Steel', layer: 'Frame' },
        { name: 'Pad', size: [4, 4, 4], layer: 'Trim' },
      ],
      { hasLayers: true },
    );

  it('object keeps the hierarchy of the file', () => {
    const out = applyImportOptions(four(), optionsFor());
    expect(describePayload(out)).toEqual({ parts: 4, groups: 1, triangles: 48, materials: 3 });
    expect(out.nodes[out.roots[0]].children).toHaveLength(3); // Shell, Bolt, Pad
  });

  it('material gives one group per material, in order of first use: 3 groups for 3 materials', () => {
    const out = applyImportOptions(four(), optionsFor({ groupBy: 'material' }));
    const model = out.nodes[out.roots[0]];
    const groups = model.children.map((c) => out.nodes[c]);
    expect(groups.map((g) => [g.kind, g.name, g.children.length])).toEqual([
      ['GROUP', 'Steel', 2],
      ['GROUP', 'Brass', 1],
      ['GROUP', 'Default', 1],
    ]);
    expect(groups.flatMap((g) => g.children.map((c) => out.nodes[c].name))).toEqual(['Wall', 'Bolt', 'Lid', 'Pad']);
    // The old group is gone, parents follow.
    expect(describePayload(out).groups).toBe(3);
    for (const g of groups) for (const c of g.children) expect(out.nodes[c].parent).toBe(g.id);
    expect(Object.values(out.nodes).filter((n) => n.name === 'Shell')).toEqual([]);
  });

  it('layer gives one group per layer', () => {
    const out = applyImportOptions(four(), optionsFor({ groupBy: 'layer' }));
    const groups = out.nodes[out.roots[0]].children.map((c) => out.nodes[c]);
    expect(groups.map((g) => [g.name, g.children.map((c) => out.nodes[c].name)])).toEqual([
      ['Frame', ['Wall', 'Bolt']],
      ['Trim', ['Lid', 'Pad']],
    ]);
  });

  it('layer on a file without layers changes nothing', () => {
    const raw = makePayload([{ name: 'A', size: [1, 1, 1], group: 'G' }]);
    const out = applyImportOptions(raw, optionsFor({ groupBy: 'layer' }));
    expect(describePayload(out).groups).toBe(1);
  });

  it('the grouped model is a valid tree for the store: every part is reached once', () => {
    const out = applyImportOptions(four(), optionsFor({ groupBy: 'material' }));
    const s = reduce(createInitialState(), { type: 'scene/addModel', payload: out, replace: true });
    expect(partsUnder(s, s.scene.roots)).toHaveLength(4);
    expect(treeOrder(s)).toHaveLength(1 + 3 + 4);
  });
});

describe('separate by material', () => {
  /** A body of steel with its +x face (triangles 0 and 1) in brass. */
  const body = () => makePayload([{ name: 'Body', size: [10, 20, 30], at: [100, 0, 0], material: 'Steel', ranges: [[0, 2, 'Brass']] }]);

  it('splits a part with face materials into one part per material', () => {
    const raw = body();
    const out = applyImportOptions(raw, optionsFor({ separate: 'material' }));
    const parts = partsOf(out);
    // In order of first appearance: the first triangle is brass.
    expect(parts.map((p) => [p.name, p.mesh!.triangles, p.faceMaterials])).toEqual([
      ['Body (Brass)', 2, undefined],
      ['Body (Steel)', 10, undefined],
    ]);
    expect(parts.map((p) => out.materials[p.material!].name)).toEqual(['Brass', 'Steel']);
    expect(describePayload(out).triangles).toBe(12);
    // Each part is re-centred on its own bounds, the pivot carries the offset: the brass face is the +x face.
    const [brass, steel] = parts;
    close(brass.transform.position, [105, 0, 0]);
    close(brass.mesh!.bounds.min, [0, -10, -15]);
    close(brass.mesh!.bounds.max, [0, 10, 15]);
    expect(brass.mesh).toMatchObject({ vertices: 4, triangles: 2 });
    close(steel.transform.position, [100, 0, 0]);
    expect(steel.mesh!.triangles).toBe(10);
    // Together they still fill the original box: x 95..105, y -10..10, z -15..15.
    const s = reduce(createInitialState(), { type: 'scene/addModel', payload: out, replace: true });
    const b = boundsOf(s, s.scene.roots);
    close(b.min, [95, -10, -15]);
    close(b.max, [105, 10, 15]);
  });

  it('leaves a part with one material alone, and does nothing when off', () => {
    const one = makePayload([{ name: 'Body', size: [10, 10, 10], material: 'Steel' }]);
    expect(partsOf(applyImportOptions(one, optionsFor({ separate: 'material' }))).map((p) => p.name)).toEqual(['Body']);
    expect(partsOf(applyImportOptions(body(), optionsFor())).map((p) => p.name)).toEqual(['Body']);
    // By CAD face needs STEP topology (phase I2): it changes nothing yet.
    expect(partsOf(applyImportOptions(body(), optionsFor({ separate: 'face' }))).map((p) => p.name)).toEqual(['Body']);
  });

  it('puts the parts where the original was, scaled and turned like the rest', () => {
    const out = applyImportOptions(body(), optionsFor({ separate: 'material', units: 'cm', upAxis: 'Y' }));
    const brass = partsOf(out)[0];
    // File (105, 0, 0) cm, Y up: x stays, z -> -y, y -> z; the box is 20 deep (y) and 30 tall (z) in the file.
    close(brass.transform.position, [1050, -0, 0], 3);
    close(brass.mesh!.bounds.max, [0, 150, 100], 3);
  });

  it('keeps the layer of the part for each piece', () => {
    const raw = makePayload([{ name: 'Body', size: [10, 20, 30], material: 'Steel', ranges: [[0, 2, 'Brass']], layer: 'Frame' }], { hasLayers: true });
    const out = applyImportOptions(raw, optionsFor({ separate: 'material', groupBy: 'layer' }));
    const groups = out.nodes[out.roots[0]].children.map((c) => out.nodes[c]);
    expect(groups.map((g) => [g.name, g.children.length])).toEqual([['Frame', 2]]);
  });

  it('then grouping by material gives one group each', () => {
    const out = applyImportOptions(body(), optionsFor({ separate: 'material', groupBy: 'material' }));
    expect(out.nodes[out.roots[0]].children.map((c) => out.nodes[c].name)).toEqual(['Brass', 'Steel']);
  });
});

describe('materials', () => {
  it('keep leaves the file materials and drops the ones nothing uses', () => {
    const raw = makePayload([
      { name: 'A', size: [1, 1, 1], material: 'Steel' },
      { name: 'B', size: [1, 1, 1], material: 'Brass', visible: false },
    ]);
    const out = applyImportOptions(raw, optionsFor());
    expect(Object.values(out.materials).map((m) => m.name)).toEqual(['Steel']);
    const all = applyImportOptions(raw, optionsFor({ importHidden: true }));
    expect(Object.values(all.materials).map((m) => m.name)).toEqual(['Steel', 'Brass']);
  });

  it('default puts the neutral Default on every part and clears the face materials', () => {
    const raw = makePayload([{ name: 'A', size: [1, 1, 1], material: 'Steel', ranges: [[0, 4, 'Brass']] }]);
    const out = applyImportOptions(raw, optionsFor({ materials: 'default' }));
    expect(Object.keys(out.materials)).toEqual(['tm_default']);
    expect(out.materials.tm_default.role).toBe('DEFAULT');
    const [a] = partsOf(out);
    expect(a.material).toBe('tm_default');
    expect(a.faceMaterials).toBeUndefined();
    expect(out.textures).toEqual([]);
  });

  it('keeps the textures of the materials that stay', () => {
    const raw = makePayload([{ name: 'A', size: [1, 1, 1], material: 'Steel' }]);
    raw.textures = [{ name: 'a.png', slot: 'color', material: 'tm1', mime: 'image/png', blob: new Blob(['x']) }];
    expect(applyImportOptions(raw, optionsFor()).textures).toHaveLength(1);
    expect(applyImportOptions(raw, optionsFor({ materials: 'default' })).textures).toHaveLength(0);
  });
});

describe('hidden parts', () => {
  const hidden = () =>
    makePayload([
      { name: 'Shown', size: [1, 1, 1] },
      { name: 'Guide', size: [1, 1, 1], visible: false, group: 'Construction' },
      { name: 'Detail', size: [1, 1, 1], group: 'Shell' },
    ]);

  it('drops hidden parts, and the groups they leave empty, unless asked to keep them', () => {
    const out = applyImportOptions(hidden(), optionsFor());
    expect(partsOf(out).map((p) => p.name)).toEqual(['Shown', 'Shell']);
    expect(describePayload(out)).toMatchObject({ parts: 2, groups: 1 });
    expect(Object.values(out.nodes).map((n) => n.name).sort()).toEqual(['Detail', 'Shell', 'Shown', 'model']);
  });

  it('keeps them hidden when asked to import hidden layers', () => {
    const out = applyImportOptions(hidden(), optionsFor({ importHidden: true }));
    const guide = Object.values(out.nodes).find((n) => n.name === 'Guide')!;
    expect(guide.visible).toBe(false);
    expect(describePayload(out)).toMatchObject({ parts: 3, groups: 2 });
  });

  it('a hidden group hides the parts under it', () => {
    const raw = hidden();
    raw.nodes.g2 = { ...raw.nodes.g2, visible: false };
    const out = applyImportOptions(raw, optionsFor());
    expect(Object.values(out.nodes).some((n) => n.name === 'Detail')).toBe(false);
  });

  it('a file whose parts are all hidden comes out with no model at all', () => {
    const out = applyImportOptions(makePayload([{ name: 'Guide', size: [1, 1, 1], visible: false }]), optionsFor());
    expect(out.roots).toEqual([]);
    expect(Object.keys(out.nodes)).toEqual([]);
  });
});

describe('defaults and notes', () => {
  const detected = (over: object = {}) => ({ units: null, upAxis: 'Z' as const, upAxisDeclared: false, size: 100, hasLayers: false, hiddenParts: 0, ...over });

  it('start from what the file says, everything else on', () => {
    expect(defaultImportOptions(detected({ units: 'in', upAxis: 'Y' }), false)).toEqual({
      units: 'in',
      upAxis: 'Y',
      center: true,
      restOnFloor: true,
      frameCamera: true,
      mode: 'replace',
      groupBy: 'object',
      materials: 'keep',
      separate: 'none',
      tessellation: 'MEDIUM',
      importHidden: false,
      flipNormals: false,
    });
  });

  it('a file without units is millimetres, or metres when it measures under a millimetre', () => {
    expect(defaultImportOptions(detected({ size: 100 }), false).units).toBe('mm');
    expect(defaultImportOptions(detected({ size: SMALL_MODEL_MM }), false).units).toBe('mm');
    expect(defaultImportOptions(detected({ size: 0.9 }), false).units).toBe('m');
    expect(defaultImportOptions(detected({ size: 20_000 }), false).units).toBe('mm');
    // Declared units win over the guess.
    expect(defaultImportOptions(detected({ size: 0.9, units: 'cm' }), false).units).toBe('cm');
  });

  it('adds to a scene that has parts and replaces an empty one', () => {
    expect(defaultImportOptions(detected(), true).mode).toBe('add');
    expect(defaultImportOptions(detected(), false).mode).toBe('replace');
  });

  it('notes a size under a millimetre or over ten metres on the final model, and leaves the Doctor its hint', () => {
    const tiny = makePayload([{ name: 'A', size: [0.02, 0.02, 0.02] }]);
    const small = applyImportOptions(tiny, optionsFor());
    expect(small.notes).toEqual([{ code: 'scaleSmall', params: { size: 0.02, factor: 1000 } }]);
    expect(small.nodes.m.source!.unitHint).toBe(1000);
    const fixed = applyImportOptions(tiny, optionsFor({ units: 'm' }));
    expect(fixed.notes).toEqual([]);
    expect(fixed.nodes.m.source!.unitHint).toBeUndefined();

    const huge = applyImportOptions(makePayload([{ name: 'A', size: [LARGE_MODEL_MM + 1, 1, 1] }]), optionsFor());
    expect(huge.notes).toEqual([{ code: 'scaleLarge', params: { size: 10000, factor: 0.001 } }]);
    expect(huge.nodes.m.source!.unitHint).toBe(0.001);
    // 20 mm is plenty, inches or not.
    expect(applyImportOptions(makePayload([{ name: 'A', size: [20, 1, 1] }]), optionsFor()).notes).toEqual([]);
  });
});

describe('payload bookkeeping', () => {
  it('does not change its input', () => {
    const raw = makePayload([{ name: 'A', size: [1, 2, 3], at: [1, 1, 1], material: 'Steel', group: 'G' }]);
    const copy = JSON.stringify(raw);
    applyImportOptions(raw, optionsFor({ units: 'in', upAxis: 'Y', flipNormals: true, groupBy: 'material', materials: 'default' }));
    expect(JSON.stringify(raw)).toBe(copy);
  });

  it('releases the meshes of the input that the result does not use', () => {
    const raw = makePayload([
      { name: 'A', size: [1, 1, 1] },
      { name: 'B', size: [1, 1, 1] },
    ]);
    const out = applyImportOptions(raw, optionsFor({ units: 'cm' }));
    const rawIds = Object.values(raw.nodes).filter((n) => n.mesh).map((n) => n.mesh!.id);
    expect(rawIds.every(hasMesh)).toBe(true);
    releaseImport(raw, out);
    expect(rawIds.some(hasMesh)).toBe(false);
    for (const p of partsOf(out)) expect(hasMesh(p.mesh!.id)).toBe(true);
    // Shared meshes survive.
    const same = makePayload([{ name: 'A', size: [1, 1, 1] }]);
    const kept = applyImportOptions(same, optionsFor());
    releaseImport(same, kept);
    expect(hasMesh(same.nodes.p1.mesh!.id)).toBe(true);
    // A cancelled import releases everything.
    releaseImport(same);
    expect(hasMesh(same.nodes.p1.mesh!.id)).toBe(false);
  });

  it('counts parts, groups, triangles and materials', () => {
    const raw = makePayload([
      { name: 'A', size: [1, 1, 1], material: 'Steel', group: 'G' },
      { name: 'B', size: [1, 1, 1], material: 'Brass' },
    ]);
    expect(describePayload(raw)).toEqual({ parts: 2, groups: 1, triangles: 24, materials: 2 });
  });
});
