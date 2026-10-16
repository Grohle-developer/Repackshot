// A scene for the pick through a traced lens's profile (phase O2, tests/lens-pick-browser.test.ts): a wall of matte
// plates across the whole frame, square to the camera (thin, so that each shows one face), in three colours so that two
// neighbours never share one, on a black background without a floor; the camera has a traced lens (or the thin lens)
// and a 24 mm focal length.

import { cameraBasis } from '../../src/core/camera';
import { instanceFromPreset } from '../../src/core/materials';
import { registerMesh } from '../../src/core/meshes';
import { OPTICS_NEUTRAL } from '../../src/core/optics';
import type { NodeId, SceneNode } from '../../src/core/scene';
import { createInitialState, reduce, type ProjectState } from '../../src/core/store';
import { newTracedLens } from '../../src/core/traced-lens';
import { boxMesh } from './pass-scene';

/** The colours, by class: what the test reads back from the canvas. */
export const PICK_COLOURS = { R: [0.8, 0.04, 0.03], G: [0.04, 0.6, 0.06], B: [0.04, 0.08, 0.8] } as const;
export type PickClass = keyof typeof PICK_COLOURS;

/** The boxes: their ids and their colours' classes. */
export function pickBoxes(): { id: NodeId; cls: PickClass }[] {
  const out: { id: NodeId; cls: PickClass }[] = [];
  for (let j = 0; j < 5; j++) for (let i = 0; i < 7; i++) out.push({ id: `b${i}${j}`, cls: (['R', 'G', 'B'] as const)[(i + 2 * j) % 3] });
  return out;
}

/** The scene at `width` × `height`, its camera through lens `traced` (a catalogue key; null: the thin lens). */
export function lensPickScene(width: number, height: number, traced: string | null): ProjectState {
  const materials: ProjectState['materials'] = {};
  for (const [cls, rgb] of Object.entries(PICK_COLOURS)) {
    const inst = instanceFromPreset(`m${cls}`, 'ABS_MATTE', 100)!;
    inst.params = { ...inst.params, baseColor: [rgb[0], rgb[1], rgb[2], 1] };
    materials[`m${cls}`] = inst;
  }
  // The wall: 7 × 5 plates of 50 mm, 4 mm thick along the view, 80 mm apart, in the plane through the target square
  // to the view (the view of azimuth 0 and elevation 0 runs along an axis of the model).
  const { forward, right, up } = cameraBasis(0, 0);
  const size = forward.map((f) => (Math.abs(f) > 0.5 ? 4 : 50)) as [number, number, number];
  const nodes: Record<NodeId, SceneNode> = {};
  const boxes = pickBoxes();
  nodes.model = { id: 'model', name: 'model', kind: 'MODEL', parent: null, children: boxes.map((b) => b.id), transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, visible: true, locked: false };
  boxes.forEach((b, k) => {
    const a = ((k % 7) - 3) * 80;
    const c = (Math.floor(k / 7) - 2) * 80;
    const position: [number, number, number] = [right[0] * a + up[0] * c, right[1] * a + up[1] * c, right[2] * a + up[2] * c];
    nodes[b.id] = {
      id: b.id,
      name: b.id,
      kind: 'PART',
      parent: 'model',
      children: [],
      transform: { position, rotation: [0, 0, 0], scale: [1, 1, 1] },
      visible: true,
      locked: false,
      mesh: registerMesh(`o2pick:${b.id}`, boxMesh(size[0], size[1], size[2])),
      material: `m${b.cls}`,
      smooth: false,
    };
  });
  let s = reduce(createInitialState(), { type: 'scene/addModel', payload: { nodes, roots: ['model'], materials }, replace: true });
  s = reduce(s, { type: 'render/set', patch: { width, height } });
  s = reduce(s, {
    type: 'camera/set',
    id: s.camera.active,
    patch: { azimuth: 0, elevation: 0, distance: 360, target: [0, 0, 0], focalMm: 24, fstop: 0, focusDistance: 360, optics: traced ? { ...OPTICS_NEUTRAL, traced: newTracedLens(traced) } : { ...OPTICS_NEUTRAL } },
  });
  return { ...s, studio: { ...s.studio, floor: false }, environment: { ...s.environment, background: 'COLOR', color: [0, 0, 0, 1] } };
}
