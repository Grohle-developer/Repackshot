// CAD faces on parts (phase I2, `SceneNode.faceRanges`): they stay true to the triangles through what can
// renumber them (re-smoothing drops degenerate triangles, separating by material slices the mesh), they follow
// copies, they are saved with the project, and the helpers behind them (remapping runs, welding by position).

import { describe, expect, it } from 'vitest';
import { applyImportOptions } from '../src/core/import-options';
import { instanceFromPreset } from '../src/core/materials';
import { registerMesh, remapTriangleRanges, weldIds, type MeshData, type TriangleRange } from '../src/core/meshes';
import type { ModelPayload, NodeId, SceneNode } from '../src/core/scene';
import { createInitialState, reduce, type ProjectState } from '../src/core/store';
import { serializeProject } from '../src/io/project';
import { apply } from './helpers';
import { makePayload, optionsFor } from './io-helpers';

/** A unit box made of six faces with their own four vertices each (as a CAD reader gives it): 24 vertices, 12 triangles. */
function cadBox(extraDegenerateInFace = -1): { data: MeshData; faces: TriangleRange[] } {
  const quads: number[][][] = [
    [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]],
    [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]],
    [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]],
    [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]],
    [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]],
    [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]],
  ];
  const positions: number[] = [];
  const indices: number[] = [];
  const faces: TriangleRange[] = [];
  quads.forEach((q, f) => {
    const o = positions.length / 3;
    const start = indices.length / 3;
    for (const c of q) positions.push(c[0] - 0.5, c[1] - 0.5, c[2] - 0.5);
    indices.push(o, o + 1, o + 2, o, o + 2, o + 3);
    // A sliver with two equal corners: re-smoothing drops it.
    if (f === extraDegenerateInFace) indices.push(o, o, o + 1);
    faces.push({ start, count: indices.length / 3 - start });
  });
  return { data: { positions: Float32Array.from(positions), normals: new Float32Array(positions.length).fill(0), indices: Uint32Array.from(indices) }, faces };
}

let counter = 0;
function sceneWith(box: ReturnType<typeof cadBox>): { state: ProjectState; part: NodeId } {
  const mat = instanceFromPreset('m1', 'GOLD', 100)!;
  const part: SceneNode = {
    id: 'p',
    name: 'Box',
    kind: 'PART',
    parent: 'model',
    children: [],
    transform: { position: [0, 0, 0.5], rotation: [0, 0, 0], scale: [1, 1, 1] },
    visible: true,
    locked: false,
    mesh: registerMesh(`test:cadbox:${++counter}`, box.data),
    material: 'm1',
    smooth: true,
    faceRanges: box.faces,
  };
  const model: SceneNode = { ...part, id: 'model', name: 'model', kind: 'MODEL', parent: null, children: ['p'], mesh: undefined, material: undefined, faceRanges: undefined };
  delete model.mesh;
  delete model.material;
  delete model.faceRanges;
  delete model.smooth;
  const payload: ModelPayload = { nodes: { model, p: part }, roots: ['model'], materials: { m1: mat } };
  const state = reduce(createInitialState(), { type: 'scene/addModel', payload, replace: true });
  const id = Object.values(state.scene.nodes).find((n) => n.kind === 'PART')!.id;
  return { state, part: id };
}

describe('remapping triangle ranges', () => {
  it('follows the triangles that survive, in their new numbers', () => {
    const ranges = [
      { start: 0, count: 3 },
      { start: 3, count: 2 },
      { start: 5, count: 4 },
    ];
    // Triangle 1 and the whole second range are gone.
    expect(remapTriangleRanges(ranges, [0, 2, 5, 6, 7, 8])).toEqual([
      { start: 0, count: 2 },
      { start: 2, count: 4 },
    ]);
    // A slice of the third range only.
    expect(remapTriangleRanges(ranges, [6, 7])).toEqual([{ start: 0, count: 2 }]);
    // Two ranges side by side stay two runs.
    expect(remapTriangleRanges(ranges, [2, 3])).toEqual([
      { start: 0, count: 1 },
      { start: 1, count: 1 },
    ]);
    // Triangles beyond every range belong to none.
    expect(remapTriangleRanges(ranges, [40, 0])).toEqual([{ start: 1, count: 1 }]);
  });
});

describe('welding by position', () => {
  it('gives one id to vertices closer than the tolerance, in order of first appearance', () => {
    const { ids, count } = weldIds([0, 0, 0, 1, 0, 0, 1e-7, 0, 0, 1, 1e-7, 0, 0, 1, 0], 1e-5);
    expect(Array.from(ids)).toEqual([0, 1, 0, 1, 2]);
    expect(count).toBe(3);
    // Exactly equal positions weld with no tolerance at all; different ones do not.
    expect(Array.from(weldIds([5, 5, 5, 5, 5, 5, 5, 5, 5.0001], 0).ids)).toEqual([0, 0, 1]);
    expect(weldIds([], 1).count).toBe(0);
    // Two vertices a hair apart on either side of a cell boundary (cells are twice the tolerance) still weld.
    expect(Array.from(weldIds([0, 0, 0, 1.999e-5, 0, 0, 2.001e-5, 0, 0], 1e-5).ids)).toEqual([0, 1, 1]);
  });
});

describe('CAD faces through the scene operations', () => {
  it('re-smoothing keeps each face on its triangles, also when a degenerate one is dropped', () => {
    const { state, part } = sceneWith(cadBox(2));
    expect(state.scene.nodes[part].faceRanges).toEqual([
      { start: 0, count: 2 },
      { start: 2, count: 2 },
      { start: 4, count: 3 },
      { start: 7, count: 2 },
      { start: 9, count: 2 },
      { start: 11, count: 2 },
    ]);
    const t = apply(state, { type: 'scene/setSmoothAngle', ids: [part], deg: 45 });
    const node = t.scene.nodes[part];
    expect(node.mesh!.triangles).toBe(12);
    expect(node.faceRanges).toEqual([0, 2, 4, 6, 8, 10].map((start) => ({ start, count: 2 })));
  });

  it('separating by material gives each piece its own faces, numbered in it', () => {
    const { state: s0, part } = sceneWith(cadBox());
    // The first face (two triangles) in chrome.
    const s = apply(s0, { type: 'material/assign', preset: 'CHROME', targets: [part], faces: { part, indices: [0, 1] }, mode: 'REPLACE' });
    const t = apply(s, { type: 'scene/separateByMaterial', ids: [part], names: {} });
    const pieces = Object.values(t.scene.nodes).filter((n) => n.kind === 'PART');
    expect(pieces.map((p) => p.mesh!.triangles).sort()).toEqual([10, 2]);
    const chrome = pieces.find((p) => p.mesh!.triangles === 2)!;
    const gold = pieces.find((p) => p.mesh!.triangles === 10)!;
    expect(chrome.faceRanges).toEqual([{ start: 0, count: 2 }]);
    expect(gold.faceRanges).toEqual([0, 2, 4, 6, 8].map((start) => ({ start, count: 2 })));
  });

  it('copies keep the faces, and the project file saves them', async () => {
    const { state, part } = sceneWith(cadBox());
    const t = apply(state, { type: 'scene/duplicate', ids: [part], linked: false });
    const copy = t.selection.ids[0];
    expect(t.scene.nodes[copy].faceRanges).toEqual(state.scene.nodes[part].faceRanges);
    const saved = JSON.parse(await serializeProject(t).text());
    expect(saved.state.scene.nodes[part].faceRanges).toHaveLength(6);
    expect(saved.state.scene.nodes[copy].faceRanges).toHaveLength(6);
  });
});

describe('CAD faces through the import options', () => {
  it('units, axis and flipped normals keep the triangle order, so the faces stay as they are', () => {
    const box = cadBox();
    const raw = makePayload([{ name: 'Box', size: [1, 1, 1], data: box.data }]);
    raw.nodes.p1.faceRanges = box.faces;
    const out = applyImportOptions(raw, optionsFor({ units: 'in', upAxis: 'Y', flipNormals: true }));
    const part = Object.values(out.nodes).find((n) => n.kind === 'PART')!;
    expect(part.faceRanges).toEqual(box.faces);
    // A copy, not the reader's array.
    expect(part.faceRanges).not.toBe(raw.nodes.p1.faceRanges);
  });

  it('separate by CAD face leaves a part alone when its ranges do not cover every triangle once', () => {
    const box = cadBox();
    const raw = makePayload([{ name: 'Box', size: [1, 1, 1], data: box.data }]);
    // A face missing at the start, a face missing at the end, two faces overlapping: the part stays whole.
    for (const ranges of [box.faces.slice(1), box.faces.slice(0, 5), [{ start: 0, count: 4 }, ...box.faces.slice(1)]]) {
      raw.nodes.p1.faceRanges = ranges;
      expect(Object.values(applyImportOptions(raw, optionsFor({ separate: 'face' })).nodes).filter((n) => n.kind === 'PART')).toHaveLength(1);
    }
    raw.nodes.p1.faceRanges = box.faces;
    expect(Object.values(applyImportOptions(raw, optionsFor({ separate: 'face' })).nodes).filter((n) => n.kind === 'PART')).toHaveLength(6);
  });
});
