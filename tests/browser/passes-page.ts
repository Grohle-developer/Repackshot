// The page the browser test of the AI passes loads (tests/ai-passes-browser.test.ts): the preview engine draws the
// known scene, and the passes it gives come back as plain arrays.

import { projectScene } from '../../src/io/rsb';
import { PreviewEngine } from '../../src/render/preview';
import type { RenderPasses } from '../../src/core/passes';
import { passScene } from './pass-scene';

type Plain = Record<string, number[] | number>;

declare global {
  interface Window {
    runPasses?: (width: number, height: number) => { passes: Plain; colourBytes: number; ids: { node: string; material: string | null; materialId: number }[]; again: boolean };
    passesReady?: boolean;
  }
}

const plain = (p: RenderPasses): Plain => {
  const out: Plain = { width: p.width, height: p.height };
  for (const k of ['albedo', 'normal', 'depth', 'partId', 'materialId', 'coc'] as const) if (p[k]) out[k] = Array.from(p[k]!);
  return out;
};

const engine = new PreviewEngine();
engine.mount(document.getElementById('c') as HTMLCanvasElement);

window.runPasses = (width, height) => {
  const state = passScene(width, height);
  engine.sync(state, null);
  engine.resize(width, height, 1);
  const ids = projectScene(state, { width, height, maxSamples: 1, maxSeconds: 0 }).ids;
  const first = engine.aiFrame({ width, height, ids, colour: true });
  // A second frame without the colour: the same passes (nothing is left behind in the renderer).
  const second = engine.aiFrame({ width, height, ids, colour: false });
  const same = (['partId', 'materialId', 'depth', 'normal', 'albedo', 'coc'] as const).every((k) => {
    const a = first.passes[k] as ArrayLike<number> | undefined;
    const b = second.passes[k] as ArrayLike<number> | undefined;
    return !!a && !!b && a.length === b.length && Array.prototype.every.call(a, (v: number, i: number) => Object.is(v, b[i]));
  });
  return { passes: plain(first.passes), colourBytes: first.rgba?.length ?? 0, ids: ids.instances, again: same };
};
window.passesReady = true;
