// The page of the Q1 region comparison (tests/section-full-browser.test.ts): the Fast preview draws the cut bottle of
// section-scene.ts and gives back its colour pixels.

import { reduce } from '../../src/core/store';
import { projectScene } from '../../src/io/rsb';
import { PreviewEngine } from '../../src/render/preview';
import { sectionScene } from './section-scene';

declare global {
  interface Window {
    runSection?: (width: number, height: number, cap: boolean, studio?: 'whole' | 'cut') => Promise<{ rgba: number[]; tries: number }>;
    runGizmo?: (width: number, height: number) => { cut: Record<string, boolean>; whole: Record<string, boolean>; boxCut: Record<string, boolean>; boxWhole: Record<string, boolean> };
    sectionReady?: boolean;
  }
}

const engine = new PreviewEngine();
engine.mount(document.getElementById('c') as HTMLCanvasElement);

window.runSection = async (width, height, cap, studio) => {
  const state = sectionScene(width, height, { cap, studio });
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

/**
 * Whether the move gizmo shows for each part, and whether the box selection can reach it, with the section cutting (the
 * label on the camera's side is wholly removed) and without it.
 */
window.runGizmo = (width, height) => {
  const cutting = sectionScene(width, height, {});
  engine.sync(cutting, null);
  engine.resize(width, height, 1);
  const gizmo = (engine as unknown as { gizmo: { visible: boolean } }).gizmo;
  const shows = (ids: string[]): boolean => {
    engine.setGizmo(null);
    engine.setGizmo({ ids, space: 'GLOBAL' });
    return gizmo.visible;
  };
  const parts = ['label', 'body', 'cap'];
  const idOf = (name: string): string => Object.values(cutting.scene.nodes).find((n) => n.name === name)!.id;
  const cut = Object.fromEntries(parts.map((name) => [name, shows([idOf(name)])]));
  const reachable = () => Object.fromEntries(parts.map((name) => [name, engine.projection()!.mvp(idOf(name)) !== null]));
  const boxCut = reachable();
  const whole = reduce(cutting, { type: 'section/clear' });
  engine.sync(whole, cutting);
  const uncut = Object.fromEntries(parts.map((name) => [name, shows([idOf(name)])]));
  return { cut, whole: uncut, boxCut, boxWhole: reachable() };
};
window.sectionReady = true;
