// A scene with known geometry for the AI passes (phase X4): four boxes (one turned and stretched, one with two
// materials on its faces, one hidden, and a twin that shares the first one's material, so that a part id and a
// material id are never the same number) and a camera with depth of field. The browser page draws it with three.js;
// the test builds the same state in Node and ray-casts it with the engine's own camera rules.

import { instanceFromPreset } from '../../src/core/materials';
import { registerMesh, type MeshData } from '../../src/core/meshes';
import type { NodeId, SceneNode } from '../../src/core/scene';
import { createInitialState, reduce, type ProjectState } from '../../src/core/store';

/** A box centred on the origin, 24 vertices with flat normals, 12 outward counter-clockwise triangles (two per face: +X, -X, +Y, -Y, +Z, -Z). */
export function boxMesh(sx: number, sy: number, sz: number): MeshData {
  const h = [sx / 2, sy / 2, sz / 2];
  const faces: { n: [number, number, number]; u: [number, number, number]; v: [number, number, number] }[] = [
    { n: [1, 0, 0], u: [0, 1, 0], v: [0, 0, 1] },
    { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
    { n: [0, 1, 0], u: [0, 0, 1], v: [1, 0, 0] },
    { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
    { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
    { n: [0, 0, -1], u: [0, 1, 0], v: [1, 0, 0] },
  ];
  const positions = new Float32Array(24 * 3);
  const normals = new Float32Array(24 * 3);
  const indices = new Uint32Array(36);
  faces.forEach((f, i) => {
    const corners: [number, number][] = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ];
    corners.forEach(([a, b], k) => {
      for (let c = 0; c < 3; c++) {
        positions[(i * 4 + k) * 3 + c] = (f.n[c] + a * f.u[c] + b * f.v[c]) * h[c];
        normals[(i * 4 + k) * 3 + c] = f.n[c];
      }
    });
    indices.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
  });
  return { positions, normals, indices };
}

const node = (id: string, kind: SceneNode['kind'], parent: string | null, children: string[], position: [number, number, number], rotation: [number, number, number] = [0, 0, 0], scale: [number, number, number] = [1, 1, 1], visible = true): SceneNode => ({
  id,
  name: id,
  kind,
  parent,
  children,
  transform: { position, rotation, scale },
  visible,
  locked: false,
});

/** Ids of the parts, for the tests. */
export const PASS_SCENE_PARTS = { turned: 'turned', faces: 'faces', hidden: 'hidden', twin: 'twin' } as const;

export function passScene(width = 192, height = 108): ProjectState {
  const materials: ProjectState['materials'] = {};
  const colour = (id: string, preset: string, rgb: [number, number, number]) => {
    const inst = instanceFromPreset(id, preset, 100)!;
    inst.params = { ...inst.params, baseColor: [...rgb, 1] };
    materials[id] = inst;
  };
  colour('mRed', 'ABS_GLOSS', [0.8, 0.1, 0.05]);
  colour('mGreen', 'ABS_GLOSS', [0.1, 0.6, 0.2]);
  colour('mBlue', 'ABS_GLOSS', [0.1, 0.2, 0.7]);
  const nodes: Record<NodeId, SceneNode> = {
    model: node('model', 'MODEL', null, ['turned', 'faces', 'hidden', 'twin'], [0, 0, 0]),
    // A box turned 25° about Z and stretched along X.
    turned: { ...node('turned', 'PART', 'model', [], [-45, 0, 20], [0, 0, 25], [1.4, 1, 1]), mesh: registerMesh('x4:turned', boxMesh(50, 40, 40)), material: 'mRed', smooth: true },
    // Its +X and -X faces carry another material: two instances in the engine's scene.
    faces: { ...node('faces', 'PART', 'model', [], [35, 5, 25], [0, 0, -15]), mesh: registerMesh('x4:faces', boxMesh(40, 40, 50)), material: 'mGreen', faceMaterials: [{ start: 0, count: 4, material: 'mBlue' }], smooth: true },
    // A small box in front that carries the same material as the first: instance 4, material 1.
    twin: { ...node('twin', 'PART', 'model', [], [-5, -40, 10], [0, 0, 35]), mesh: registerMesh('x4:twin', boxMesh(22, 22, 20)), material: 'mRed', smooth: true },
    // Hidden: neither the engine nor the passes draw it.
    hidden: { ...node('hidden', 'PART', 'model', [], [0, -60, 15], [0, 0, 0], [1, 1, 1], false), mesh: registerMesh('x4:hidden', boxMesh(30, 30, 30)), material: 'mRed', smooth: true },
  };
  let s = reduce(createInitialState(), { type: 'scene/addModel', payload: { nodes, roots: ['model'], materials }, replace: true });
  s = reduce(s, { type: 'render/set', patch: { width, height } });
  s = reduce(s, {
    type: 'camera/set',
    id: s.camera.active,
    patch: { azimuth: -30, elevation: 28, distance: 420, target: [0, 0, 20], focalMm: 85, fstop: 2.8, focusDistance: 420 },
  });
  return s;
}
