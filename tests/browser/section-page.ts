// The page of the Q1 region comparison (tests/section-full-browser.test.ts): the Fast preview draws the cut bottle of
// section-scene.ts and gives back its colour pixels.

import { projectScene } from '../../src/io/rsb';
import { PreviewEngine } from '../../src/render/preview';
import { sectionScene } from './section-scene';

declare global {
  interface Window {
    runSection?: (width: number, height: number, cap: boolean) => Promise<{ rgba: number[]; tries: number }>;
    sectionReady?: boolean;
  }
}

const engine = new PreviewEngine();
engine.mount(document.getElementById('c') as HTMLCanvasElement);

window.runSection = async (width, height, cap) => {
  const state = sectionScene(width, height, { cap });
  engine.sync(state, null);
  engine.resize(width, height, 1);
  const ids = projectScene(state, { width, height, maxSamples: 1, maxSeconds: 0 }).ids;
  // Frames until two in a row agree (the shader programs are compiled by then), or a few seconds.
  let last: Uint8Array | null = null;
  for (let tries = 1; tries <= 40; tries++) {
    const rgba = engine.aiFrame({ width, height, ids, colour: true }).rgba!;
    if (last && last.every((v, i) => v === rgba[i])) return { rgba: Array.from(rgba), tries };
    last = Uint8Array.from(rgba);
    await new Promise((r) => setTimeout(r, 100));
  }
  return { rgba: Array.from(last ?? []), tries: -1 };
};
window.sectionReady = true;
