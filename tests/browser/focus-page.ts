// The page of the browser measurement and test of focus with a click (phase F1): the preview engine draws the slanted
// checker board of tests/browser/focus-scene.ts in a viewport of a case's size, and each click goes the way the
// viewport's goes (main.ts `focusPickAt`, viewport-overlays.ts `focusClick`): the engine's chief ray of the pixel from
// the page's rt.wasm (the camera of the view as the Full view renders it, io/rsb.ts `focusPickRsb`), cast at the
// preview's geometry through both faces (`PreviewEngine.pickAlong`), settled through the camera focused on what it
// meets (render/focus-pick.ts `settledFocusPick`), then the interface's focus action for the camera
// that is seen. Without rt.wasm (or one older than F1), the preview's own pick. Node applies the action to the same
// state and renders it with the engine.

import { playheadPose } from '../../src/core/animation';
import { setFocusSolver } from '../../src/core/focus';
import { reduce, type Action, type ProjectState } from '../../src/core/store';
import { parseLensInfo } from '../../src/core/traced-lens';
import { focusObjectAction, focusPickAction, lookThroughCamera, type ViewObject } from '../../src/core/view-objects';
import { resolvePick } from '../../src/core/scene';
import { focusPickRsb, lensInfoRsb } from '../../src/io/rsb';
import { focusSolverOf, hasFocusExports, settledFocusPick, type RtFocusExports } from '../../src/render/focus-pick';
import { PreviewEngine } from '../../src/render/preview';
import { focusScene, lookCameraId, type FocusCase } from './focus-scene';

export interface FocusPickRun {
  /** The engine gave the rays (rt.wasm with F1's exports). */
  engineRay: boolean;
  clicks: { x: number; y: number; hit: { node: string; point: [number, number, number] } | null; action: Action | null }[];
}

declare global {
  interface Window {
    runFocusPick?: (c: FocusCase, clicks: { x: number; y: number }[], lensInfo: string | null, opts?: { object?: boolean; noEngine?: boolean; unsettled?: boolean }) => FocusPickRun;
    focusPickReady?: boolean;
  }
}

const canvas = document.getElementById('c') as HTMLCanvasElement;
const engine = new PreviewEngine();
engine.mount(canvas);

let rt: RtFocusExports | null = null;

window.runFocusPick = (c, clicks, lensInfo, opts = {}) => {
  const state = focusScene(c);
  const look: ViewObject | null = c.lookThrough ? { kind: 'CAMERA', id: lookCameraId(state)! } : null;
  engine.resize(c.view.w, c.view.h, 1);
  engine.sync(state, null);
  engine.setGlyphs({ all: false, selected: null, lookThrough: look });
  engine.setLensInfo(state.camera.active, (lensInfo ? parseLensInfo(lensInfo) : null) ?? null);
  engine.invalidate();
  engine.frame();
  const pose = playheadPose(state);
  const useEngine = rt !== null && !opts.noEngine;
  const out: FocusPickRun = { engineRay: useEngine, clicks: [] };
  for (const { x, y } of clicks) {
    let hit = null;
    if (useEngine) {
      const rsbOf = (s: ProjectState) => {
        const through = look ? lookThroughCamera(s, look) : null;
        const cameraPatch = through ? (({ id: _id, ...rest }) => rest)(through) : undefined;
        return focusPickRsb(s, { width: c.view.w, height: c.view.h, viewport: { viewW: c.view.w, viewH: c.view.h }, ...(cameraPatch ? { cameraPatch } : {}) });
      };
      // As main.ts `focusPickAt`: a point's pick settles through the camera focused on it (a traced lens breathes).
      const focusedOn = opts.object || opts.unsettled
        ? null
        : (s: ProjectState, h: { node: string; point: [number, number, number] }) => {
            const a = focusPickAction(s, look, h, { label: '' }, pose);
            return a ? reduce(s, a) : null;
          };
      hit = settledFocusPick(rt!, state, x / c.view.w, y / c.view.h, rsbOf, (o, d) => engine.pickAlong(o, d), focusedOn);
    } else hit = engine.pick(x, y);
    let action: Action | null = null;
    if (hit && opts.object) action = focusObjectAction(state, look, resolvePick(state, hit.node, state.selection.level), { label: 'Focus on' }, pose);
    else if (hit) action = focusPickAction(state, look, { node: hit.node, point: hit.point }, { label: 'Focus with a click' }, pose);
    out.clicks.push({ x, y, hit: hit ? { node: hit.node, point: hit.point } : null, action });
  }
  engine.setGlyphs({ all: false, selected: null, lookThrough: null });
  return out;
};

// The page's rt.wasm (Vite serves public/ at the root), as main.ts loads it: the rays, and a traced lens's solved focus.
void (async () => {
  try {
    const res = await fetch('/engine/rt.wasm');
    if (res.ok) {
      const { instance } = await WebAssembly.instantiate(await res.arrayBuffer(), {});
      if (hasFocusExports(instance.exports)) {
        rt = instance.exports;
        setFocusSolver(focusSolverOf(rt, (cam) => lensInfoRsb(cam, cam.aspect.w, cam.aspect.h)));
      }
    }
  } catch {
    // No engine: the preview's pick.
  }
  window.focusPickReady = true;
})();
