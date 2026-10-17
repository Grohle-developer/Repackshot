// The capture `docs/ui/m3b-graphs.png` (M3b; made again in C1, with the flakes facing out): the ten example graphs of
// M3a on nine boxes and a cylinder, rendered by the real rt.wasm under the default studio, with each material's mean
// (left, a writer without programs) and with its graph's program (right), side by side. Runs only when asked
// (REPACK_WRITE_CAPTURES=1) and with rt.wasm:
//
//   npm run engine:build && REPACK_WRITE_CAPTURES=1 npx vitest run tests/m3b-graphs-sheet.test.ts

import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { exampleGraph, registerLabelImage } from '../src/core/material-examples';
import { instanceFromPreset, type MaterialInstance } from '../src/core/materials';
import { registerMesh } from '../src/core/meshes';
import type { NodeId, SceneNode } from '../src/core/scene';
import { createInitialState, reduce, type ProjectState } from '../src/core/store';
import { MATERIAL_GRAPHS } from '../src/data/material-graphs';
import { encodePng } from '../src/io/image';
import { projectScene, tonemapFor, writeRsb } from '../src/io/rsb';
import { exactBytes } from '../src/render/tiles';
import { box, cylinder, moved } from './browser/programs-scene';
import { loadRt, renderWithPasses, RT_WASM } from './wasm-engine';

const W = 640;
const H = 480;
const SAMPLES = 128;
const GAP = 8;

/** The ten parts in two rows (the back row raised behind the front one), each with its example's graph. */
function sheetScene(): ProjectState {
  const nodes: Record<NodeId, SceneNode> = {};
  const materials: Record<string, MaterialInstance> = {};
  const children: string[] = [];
  // Back row, then front row (the glass at the back, so it hides nothing; the flakes in the middle of the front).
  const ORDER = ['GLASS_DIRT', 'CHECKS', 'MARBLE', 'GLAZED_CERAMIC', 'STRIPES', 'PLASTIC_LABEL', 'BRUSHED_SCRATCHED', 'METALLIC_FLAKES', 'LEATHER', 'WOOD_TWO_NOISES'];
  expect([...ORDER].sort()).toEqual(MATERIAL_GRAPHS.map((g) => g.key).sort());
  ORDER.map((key) => MATERIAL_GRAPHS.find((g) => g.key === key)!).forEach((def, i) => {
    const row = i < 5 ? 1 : 0;
    const col = i % 5;
    const id = `p${i}`;
    const round = def.key === 'PLASTIC_LABEL';
    const x = (col - 2) * 130;
    const y = row * 170;
    const mesh = registerMesh(`m3b-sheet:${def.key}`, round ? cylinder() : moved(box([-50, -50, 0], [50, 50, 100])));
    materials[`m${i}`] = instanceFromPreset(`m${i}`, 'WHITE_STUDIO', 300)!;
    nodes[id] = { id, name: def.key, kind: 'PART', parent: 'model', children: [], transform: { position: [x, y, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, visible: true, locked: false, mesh, material: `m${i}`, smooth: true };
    children.push(id);
  });
  nodes.model = { id: 'model', name: 'model', kind: 'MODEL', parent: null, children, transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, visible: true, locked: false };
  let s = reduce(createInitialState(), { type: 'scene/addModel', payload: { nodes, roots: ['model'], materials }, replace: true });
  for (const def of MATERIAL_GRAPHS) {
    const part = Object.values(s.scene.nodes).find((n) => n.kind === 'PART' && n.name === def.key)!;
    s = reduce(s, { type: 'graph/enable', material: part.material! });
    s = reduce(s, { type: 'graph/set', material: part.material!, graph: exampleGraph(def.key, def.labelImage ? registerLabelImage() : null)! });
  }
  s = reduce(s, { type: 'render/set', patch: { width: W, height: H } });
  s = reduce(s, { type: 'camera/set', id: s.camera.active, patch: { azimuth: 0, elevation: 16, distance: 980, target: [0, 85, 40], focalMm: 50, fstop: 0 } });
  return { ...s, environment: { ...s.environment, background: 'COLOR', color: [0.06, 0.06, 0.06, 1] } };
}

describe.skipIf(!process.env.REPACK_WRITE_CAPTURES || !RT_WASM)('the capture of the ten example graphs in Full (m3b-graphs.png)', () => {
  it('renders the means and the programs and writes them side by side', async () => {
    const state = sheetScene();
    const rt = await loadRt();
    const picture = (programs: boolean) => {
      const rsb = writeRsb(projectScene(state, { width: W, height: H, maxSamples: SAMPLES, maxSeconds: 0, textures: true, programs }).scene);
      const { image } = renderWithPasses(rt, rsb, W, H, SAMPLES, 0);
      return exactBytes(image.sum, SAMPLES, state.image.exposureEv, tonemapFor(state.image.viewTransform));
    };
    const [mean, program] = [picture(false), picture(true)];
    const width = 2 * W + GAP;
    const out = new Uint8Array(width * H * 4).fill(255);
    for (let y = 0; y < H; y++) {
      out.set(mean.subarray(y * W * 4, (y + 1) * W * 4), y * width * 4);
      out.set(program.subarray(y * W * 4, (y + 1) * W * 4), (y * width + W + GAP) * 4);
    }
    for (let i = 3; i < out.length; i += 4) out[i] = 255;
    writeFileSync('docs/ui/m3b-graphs.png', await encodePng({ width, height: H, data: out }));
    expect(mean).not.toEqual(program);
  }, 1_200_000);
});
