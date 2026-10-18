// The page of the M3b region comparison (tests/programs-full-browser.test.ts): the Fast preview draws the scenes of
// programs-scene.ts, its graphs baked by the graph workers as in the app (render/graph-worker.ts), and gives back
// its colour pixels and its part ids. Each scene gets a preview and workers of its own. M3d: a key
// `WOOD_SPHERE:<kind>[:<preset>[:FADED]]` draws the wood sphere of `woodSphereScene` instead, and `workers` false draws without
// graph workers (what a family's wood looked like in Fast before M3d: tests/wood-fast-browser.test.ts).

import { projectScene } from '../../src/io/rsb';
import { GraphWorkers } from '../../src/render/graph-client';
import { PreviewEngine } from '../../src/render/preview';
import { graphScene, woodSphereScene } from './programs-scene';

declare global {
  interface Window {
    runGraph?: (key: string, width: number, height: number, workers?: boolean) => Promise<{ rgba: number[]; part: number[]; tries: number }>;
    graphsReady?: boolean;
  }
}

window.runGraph = async (key, width, height, withWorkers = true) => {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  document.body.appendChild(canvas);
  const workers = new GraphWorkers(() => new Worker(new URL('../../src/render/graph-worker.ts', import.meta.url), { type: 'module' }), 2);
  const engine = new PreviewEngine();
  if (withWorkers) engine.setGraphWorkers(workers);
  engine.mount(canvas);
  try {
    const [, sphere, preset, tint] = key.startsWith('WOOD_SPHERE:') ? key.split(':') : [];
    const state = sphere ? woodSphereScene(sphere as Parameters<typeof woodSphereScene>[0], width, height, preset, tint === 'FADED') : graphScene(key, width, height);
    engine.sync(state, null);
    engine.resize(width, height, 1);
    const ids = projectScene(state, { width, height, maxSamples: 1, maxSeconds: 0 }).ids;
    // The bakes come in two passes and the label decodes asynchronously: frames until no bake is under way and two
    // frames in a row agree, or a minute.
    const settle = async () => {
      let last: Uint8ClampedArray | null = null;
      for (let tries = 1; tries <= 600; tries++) {
        await new Promise((r) => setTimeout(r, 100));
        if ((canvas.dataset.graphBakes ?? '0') !== '0') continue;
        const frame = engine.aiFrame({ width, height, ids, colour: true, passes: ['partId'] });
        const rgba = frame.rgba!;
        if (last && tries > 5 && last.every((v, i) => v === rgba[i])) return { rgba: Array.from(rgba), part: Array.from(frame.passes.partId!), tries };
        last = Uint8ClampedArray.from(rgba);
      }
      return { rgba: Array.from(last ?? []), part: [], tries: -1 };
    };
    const first = await settle();
    if (tint !== 'FADED' || first.tries < 0) return first;
    // M3d: the playhead moves on once the bakes are in (the fade sets the material again; no new bake comes after).
    engine.sync({ ...state, animation: { ...state.animation, playhead: state.animation.playhead + 0.5 } }, state);
    return await settle();
  } finally {
    engine.dispose();
    workers.dispose();
    canvas.remove();
  }
};
window.graphsReady = true;
