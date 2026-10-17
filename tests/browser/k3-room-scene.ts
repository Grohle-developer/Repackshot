// The test room of K3's browser check (tools/k3-check.mjs opens it as tests/fixtures/k3-room.repack.json): a room of
// boxes before the ROOM node of K2, as rt-core's parity room (`example::k3_room`): a floor and a ceiling slab over an
// inside of 4 × 3 m and 2.6 m high, four walls, the front one around a window of 1.6 × 1.2 m on a 0.8 m sill with a pane of
// thin window glass, a sofa, a side table and a ball; the scene type Interior (sun and sky by the window), the camera
// 1.5 m up in a corner looking down 10° at the sofa, a 24 mm lens.

import { instanceFromPreset } from '../../src/core/materials';
import { registerMesh } from '../../src/core/meshes';
import type { NodeId, SceneNode } from '../../src/core/scene';
import { createInitialState, reduce, type ProjectState } from '../../src/core/store';
import { boxMesh } from './pass-scene';

/** The parts: name, centre, size (mm), material key. */
const PARTS: [string, [number, number, number], [number, number, number], string][] = [
  ['Floor', [0, 0, -50], [4200, 3200, 100], 'floor'],
  ['Ceiling', [0, 0, 2650], [4200, 3200, 100], 'plaster'],
  ['Back wall', [0, 1550, 1300], [4200, 100, 2600], 'plaster'],
  ['Left wall', [-2050, 0, 1300], [100, 3000, 2600], 'plaster'],
  ['Right wall', [2050, 0, 1300], [100, 3000, 2600], 'plaster'],
  ['Front wall left', [-1400, -1550, 1300], [1200, 100, 2600], 'plaster'],
  ['Front wall right', [1400, -1550, 1300], [1200, 100, 2600], 'plaster'],
  ['Under the window', [0, -1550, 400], [1600, 100, 800], 'plaster'],
  ['Over the window', [0, -1550, 2300], [1600, 100, 600], 'plaster'],
  ['Window pane', [0, -1550, 1400], [1600, 6, 1200], 'pane'],
  ['Sofa', [0, 1000, 350], [1800, 800, 700], 'fabric'],
  ['Side table', [1300, 900, 275], [600, 600, 550], 'lacquer'],
  ['Ball', [-400, -300, 250], [500, 500, 500], 'metal'],
];

export function k3RoomState(): ProjectState {
  const materials: ProjectState['materials'] = {};
  const add = (key: string, preset: string, params: Record<string, unknown>) => {
    const inst = instanceFromPreset(key, preset, 4000)!;
    inst.params = { ...inst.params, ...params };
    materials[key] = inst;
  };
  add('plaster', 'ABS_MATTE', { baseColor: [0.85, 0.84, 0.82, 1] });
  add('floor', 'ABS_MATTE', { baseColor: [0.5, 0.34, 0.2, 1] });
  add('pane', 'GLASS_CLEAR', { walls: 'THIN' });
  add('fabric', 'ABS_MATTE', { baseColor: [0.25, 0.34, 0.5, 1] });
  add('lacquer', 'ABS_MATTE', { baseColor: [0.12, 0.11, 0.1, 1] });
  add('metal', 'ABS_MATTE', { baseColor: [0.9, 0.7, 0.4, 1] });
  const nodes: Record<NodeId, SceneNode> = {};
  nodes.room = { id: 'room', name: 'Test room', kind: 'MODEL', parent: null, children: PARTS.map((_, i) => `p${i}`), transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, visible: true, locked: false };
  PARTS.forEach(([name, position, size, material], i) => {
    nodes[`p${i}`] = {
      id: `p${i}`,
      name,
      kind: 'PART',
      parent: 'room',
      children: [],
      transform: { position, rotation: [0, 0, 0], scale: [1, 1, 1] },
      visible: true,
      locked: false,
      mesh: registerMesh(`k3room:${i}`, boxMesh(size[0], size[1], size[2])),
      material,
      smooth: false,
    };
  });
  let s = reduce(createInitialState(), { type: 'scene/addModel', payload: { nodes, roots: ['room'], materials }, replace: true });
  s = reduce(s, { type: 'scene/setPartSize', mm: 4000 });
  s = reduce(s, { type: 'scene/setType', sceneType: 'INTERIOR' });
  s = reduce(s, {
    type: 'camera/set',
    id: s.camera.active,
    patch: { azimuth: 38, elevation: 10, distance: 2400, target: [0, 900, 1500 - 2400 * Math.sin((10 * Math.PI) / 180)], focusDistance: 2400, focalMm: 24, lens: 'WIDE', fstop: 0, clipStart: 10, clipEnd: 200000, straightVerticals: false },
  });
  return { ...s, studio: { ...s.studio, floor: false } };
}
