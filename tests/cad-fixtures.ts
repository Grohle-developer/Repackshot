// Shared by the tests of CAD faces: a box as a CAD reader gives it (six faces, 24 vertices) and a scene with it.

import { instanceFromPreset } from '../src/core/materials';
import { registerMesh, type MeshData, type TriangleRange } from '../src/core/meshes';
import type { ModelPayload, NodeId, SceneNode } from '../src/core/scene';
import { createInitialState, reduce, type ProjectState } from '../src/core/store';

/** A unit box made of six faces with their own four vertices each (as a CAD reader gives it): 24 vertices, 12 triangles. */
export function cadBox(extraDegenerateInFace = -1): { data: MeshData; faces: TriangleRange[] } {
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
export function sceneWith(box: ReturnType<typeof cadBox>): { state: ProjectState; part: NodeId } {
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
