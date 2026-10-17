// The capture `docs/ui/m3b-wood.png` (M3b; made again in M3c): two boxes of 100 × 80 × 100 mm in the engine, rendered
// by the real rt.wasm under the default studio: on the left the Wood family's oak of the catalogue, on the right the
// wood example of the material graphs (M3c: the Wood node with the oak's values). Until M3c the example was two noises
// and a ramp and did not look like the family; now they are the same wood. Runs only when asked
// (REPACK_WRITE_CAPTURES=1) and with rt.wasm:
//
//   npm run engine:build && REPACK_WRITE_CAPTURES=1 npx vitest run tests/m3c-wood-sheet.test.ts

import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { exampleGraph } from '../src/core/material-examples';
import { instanceFromPreset, type MaterialInstance } from '../src/core/materials';
import { registerMesh } from '../src/core/meshes';
import type { NodeId, SceneNode } from '../src/core/scene';
import { createInitialState, reduce, type ProjectState } from '../src/core/store';
import { encodePng } from '../src/io/image';
import { projectScene, tonemapFor, writeRsb } from '../src/io/rsb';
import { exactBytes } from '../src/render/tiles';
import { box, moved } from './browser/programs-scene';
import { loadRt, renderWithPasses, RT_WASM } from './wasm-engine';

const W = 640;
const H = 320;
const SAMPLES = 128;

function sheetScene(): ProjectState {
  const nodes: Record<NodeId, SceneNode> = {};
  const materials: Record<string, MaterialInstance> = {};
  const children: string[] = [];
  for (const [i, x] of [-85, 85].entries()) {
    const id = `p${i}`;
    const mesh = registerMesh(`m3c-sheet:${i}`, moved(box([-50, -40, 0], [50, 40, 100])));
    materials[`m${i}`] = instanceFromPreset(`m${i}`, 'OAK', 300)!;
    nodes[id] = { id, name: i === 0 ? 'family' : 'graph', kind: 'PART', parent: 'model', children: [], transform: { position: [x, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, visible: true, locked: false, mesh, material: `m${i}`, smooth: false };
    children.push(id);
  }
  nodes.model = { id: 'model', name: 'model', kind: 'MODEL', parent: null, children, transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, visible: true, locked: false };
  let s = reduce(createInitialState(), { type: 'scene/addModel', payload: { nodes, roots: ['model'], materials }, replace: true });
  const graphPart = Object.values(s.scene.nodes).find((n) => n.kind === 'PART' && n.name === 'graph')!;
  s = reduce(s, { type: 'graph/enable', material: graphPart.material! });
  s = reduce(s, { type: 'graph/set', material: graphPart.material!, graph: exampleGraph('WOOD_TWO_NOISES', null)! });
  s = reduce(s, { type: 'render/set', patch: { width: W, height: H } });
  s = reduce(s, { type: 'camera/set', id: s.camera.active, patch: { azimuth: 28, elevation: 18, distance: 620, target: [0, 0, 48], focalMm: 50, fstop: 0 } });
  return { ...s, environment: { ...s.environment, background: 'COLOR', color: [0.06, 0.06, 0.06, 1] } };
}

describe.skipIf(!process.env.REPACK_WRITE_CAPTURES || !RT_WASM)('the capture of the two woods in Full (m3b-wood.png)', () => {
  it('renders the Wood family and the wood example graph side by side', async () => {
    const state = sheetScene();
    const rt = await loadRt();
    const rsb = writeRsb(projectScene(state, { width: W, height: H, maxSamples: SAMPLES, maxSeconds: 0, textures: true, programs: true }).scene);
    const { image } = renderWithPasses(rt, rsb, W, H, SAMPLES, 0);
    const px = exactBytes(image.sum, SAMPLES, state.image.exposureEv, tonemapFor(state.image.viewTransform));
    const out = Uint8Array.from(px);
    for (let i = 3; i < out.length; i += 4) out[i] = 255;
    writeFileSync('docs/ui/m3b-wood.png', await encodePng({ width: W, height: H, data: out }));
    expect(out.length).toBe(W * H * 4);
  }, 1_200_000);
});
