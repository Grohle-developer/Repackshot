// Focus with a click in a real browser (phase F1, the owner's report 1.8: the click must focus exactly on the pixel
// clicked, in the exact view on screen). The page of tests/browser/focus-page.ts draws the slanted checker board of
// tests/browser/focus-scene.ts with the preview engine (headless Chromium, SwiftShader) and clicks the way the viewport
// does: the engine's chief ray of the pixel from the page's rt.wasm, cast at the preview's geometry through both faces,
// then the interface's focus action. Node applies the action and asks the engine (the real rt.wasm) what the clicked
// pixel of the Full view shows: the focus distance written for that view must be the engine's own focus for that
// surface point (its depth for the thin lens, the hinge rule with a tilt, a traced lens's best focus), through a
// traced lens's distortion, a saved camera looked through with its own frame, the timeline's pose and the backs of the
// tiles; and in the thin lens's final frame, rendered, the sharp band runs through the clicked pixel.
// Skipped without Chromium (REPACKSHOT_CHROMIUM, /opt/pw-browsers); the engine's checks need rt.wasm (npm run engine:build).

import { existsSync, readdirSync } from 'node:fs';
import { chromium, type Browser, type Page } from 'playwright-core';
import { createServer, type ViteDevServer } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { activeCamera, cameraFrameRect } from '../src/core/camera';
import { setFocusSolver } from '../src/core/focus';
import { passMask } from '../src/core/passes';
import { reduce, type Action, type ProjectState } from '../src/core/store';
import { viewedCamera, type ViewObject } from '../src/core/view-objects';
import { lensInfoRsb, projectScene, writeRsb, type SceneView } from '../src/io/rsb';
import { enginePick, focusSolverOf, hasFocusExports } from '../src/render/focus-pick';
import { hasLensInfoExport, readLensInfo } from '../src/render/lens-info';
import type { FocusPickRun } from './browser/focus-page';
import { focusScene, lookCameraId, type FocusCase } from './browser/focus-scene';
import { depthAt, renderFocus, sharpness, sharpPeak } from './focus-measure';
import { loadRt, renderWithPasses, RT_WASM } from './wasm-engine';

function findChromium(): string | null {
  const fromEnv = process.env.REPACKSHOT_CHROMIUM;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  if (existsSync(`${base}/chromium`)) return `${base}/chromium`;
  try {
    const entries = readdirSync(base)
      .filter((n) => /^chromium-\d+$/.test(n))
      .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
    for (const e of entries) if (existsSync(`${base}/${e}/chrome-linux/chrome`)) return `${base}/${e}/chrome-linux/chrome`;
  } catch {
    // No browsers installed.
  }
  return null;
}

const executablePath = findChromium();
const V = { w: 480, h: 300 };
const ORBIT = { target: { kind: 'CAMERA' as const }, move: 'ORBIT' as const, shot: null, start: 0, duration: 2, amount: 12, easing: 'LINEAR' as const };
const CASES: FocusCase[] = [
  { name: 'thin', view: V },
  { name: 'tilt', view: V, optics: { tiltDeg: 6, tiltAxisDeg: 0 } },
  { name: 'traced distortion', view: V, traced: { key: 'double_gauss_fast', distortion: 1 } },
  { name: 'look through 9:16', view: V, lookThrough: { azimuth: 6, elevation: 4, distance: 640, aspectKey: '9:16' } },
  { name: 'timeline', view: V, clips: [ORBIT], playhead: 1 },
  { name: 'backs of the tiles', view: V, azimuth: 180 },
];
/** Clicks in the frame of the camera seen: the centre and two far corners. */
const SPOTS = [
  [0.5, 0.5],
  [0.12, 0.14],
  [0.86, 0.85],
] as const;

/** The camera looked through as the Full view's patch over the active one. */
function lookPatch(s: ProjectState, look: ViewObject | null): SceneView['cameraPatch'] {
  if (!look) return undefined;
  const { id: _id, ...rest } = s.camera.cameras[look.id];
  return rest;
}

describe.skipIf(!executablePath)('focus with a click lands on the pixel clicked, in a browser', { timeout: 900000 }, () => {
  let server: ViteDevServer;
  let browser: Browser;
  let url = '';

  beforeAll(async () => {
    if (RT_WASM) {
      const rt = await loadRt();
      if (hasFocusExports(rt)) setFocusSolver(focusSolverOf(rt, (cam) => lensInfoRsb(cam, cam.aspect.w, cam.aspect.h)));
    }
    server = await createServer({ configFile: false, logLevel: 'error', server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false } });
    await server.listen();
    const base = server.resolvedUrls?.local[0];
    if (!base) throw new Error('the test server has no address');
    url = `${base}tests/browser/focus.html`;
    browser = await chromium.launch({ executablePath: executablePath!, headless: true, args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  }, 180000);

  afterAll(async () => {
    setFocusSolver(null);
    await browser?.close();
    await server?.close();
  });

  async function pick(c: FocusCase, clicks: { x: number; y: number }[], opts: { noEngine?: boolean } = {}): Promise<FocusPickRun> {
    const page: Page = await browser.newPage({ viewport: { width: 800, height: 600 }, deviceScaleFactor: 1 });
    try {
      await page.goto(url);
      await page.waitForFunction(() => window.focusPickReady === true, null, { timeout: 120000 });
      let info: string | null = null;
      const s = focusScene(c);
      const cam = activeCamera(s);
      if (cam.optics?.traced && RT_WASM) {
        const rt = await loadRt();
        const li = hasLensInfoExport(rt) ? readLensInfo(rt, lensInfoRsb(cam, cam.aspect.w, cam.aspect.h)) : null;
        if (li) info = JSON.stringify({ traced: true, ...li, section: null });
      }
      return (await page.evaluate(([cc, cl, inf, o]) => window.runFocusPick!(cc as FocusCase, cl as { x: number; y: number }[], inf as string | null, o as { noEngine?: boolean }), [c, clicks, info, opts] as const)) as FocusPickRun;
    } finally {
      await page.close();
    }
  }

  const clicksOf = (s: ProjectState, c: FocusCase, look: ViewObject | null) => {
    const fr = cameraFrameRect(viewedCamera(s, look), c.view.w, c.view.h);
    return SPOTS.map(([fx, fy]) => ({ x: fr.x + fx * fr.width, y: fr.y + fy * fr.height }));
  };

  for (const c of CASES) {
    it.skipIf(!RT_WASM)(`${c.name}: the Full view is in focus at the pixel clicked`, async () => {
      const rt = await loadRt();
      if (!hasFocusExports(rt)) throw new Error('rt.wasm has no focus pick: npm run engine:build');
      const s0 = focusScene(c);
      const look: ViewObject | null = c.lookThrough ? { kind: 'CAMERA', id: lookCameraId(s0)! } : null;
      const clicks = clicksOf(s0, c, look);
      const run = await pick(c, clicks);
      expect(run.engineRay).toBe(true);
      for (let i = 0; i < clicks.length; i++) {
        const { x, y } = clicks[i];
        const action = run.clicks[i].action;
        expect(action, `${c.name}: click ${i} picked nothing`).not.toBeNull();
        const s = reduce(s0, action as Action);
        const cameraPatch = lookPatch(s, look);
        const view: SceneView = { width: c.view.w, height: c.view.h, maxSamples: 1, maxSeconds: 0, viewport: { viewW: c.view.w, viewH: c.view.h }, ...(cameraPatch ? { cameraPatch } : {}) };
        const { scene } = projectScene(s, view);
        const shown = enginePick(rt, writeRsb(scene, { meshes: true }), x / c.view.w, y / c.view.h);
        expect(shown?.hit, `${c.name}: the engine sees nothing at click ${i}`).toBeTruthy();
        const want = shown!.hit!.focusDist!;
        // The engine's own focus for the surface the pixel shows (exact for the thin lens and the tilt; a traced
        // lens's solve within a few hundredths of a millimetre).
        const tol = c.traced ? 0.05 : 1e-3 * want;
        expect(Math.abs(scene.camera.focusDist - want), `${c.name}: click ${i}`).toBeLessThan(tol);
      }
    });
  }

  it.skipIf(!RT_WASM)('the thin lens: the depth pass at the clicked pixel is the focus', async () => {
    const rt = await loadRt();
    const c: FocusCase = { name: 'thin', view: V };
    const s0 = focusScene(c);
    const clicks = clicksOf(s0, c, null);
    const run = await pick(c, clicks);
    for (let i = 0; i < clicks.length; i++) {
      const s = reduce(s0, run.clicks[i].action as Action);
      const view: SceneView = { width: c.view.w, height: c.view.h, maxSamples: 1, maxSeconds: 0, viewport: { viewW: c.view.w, viewH: c.view.h }, passes: ['depth'] };
      const { scene } = projectScene(s, view);
      const { passes } = renderWithPasses(rt, writeRsb(scene, { meshes: true }), c.view.w, c.view.h, 1, passMask(['depth']));
      const depth = depthAt({ width: c.view.w, height: c.view.h, rgb: new Float32Array(0), depth: passes.depth!, coc: new Float32Array(0), focusDist: 0 }, clicks[i].x, clicks[i].y);
      expect(Math.abs(scene.camera.focusDist - depth), `click ${i}`).toBeLessThan(0.02);
    }
  });

  it.skipIf(!RT_WASM)('a tilted lens: in the final frame, rendered, the sharp band runs through the clicked corner', async () => {
    // Before F1 the click set the corner's depth, and the tilted plane of focus crossed the board some 18 pixels of
    // this frame away from it.
    const c: FocusCase = { name: 'tilt', view: V, optics: { tiltDeg: 6, tiltAxisDeg: 0 }, render: { w: 240, h: 135 } };
    const s0 = focusScene(c);
    const click = clicksOf(s0, c, null)[1];
    const run = await pick(c, [click]);
    const s = reduce(s0, run.clicks[0].action as Action);
    const img = await renderFocus(s, { samples: 16 });
    const fr = cameraFrameRect(activeCamera(s), c.view.w, c.view.h);
    const fx = ((click.x - fr.x) / fr.width) * img.width;
    const fy = ((click.y - fr.y) / fr.height) * img.height;
    const peak = sharpPeak(img, sharpness(img, 1), fx, fy, 30, 4);
    expect(peak, 'no sharp band near the click').not.toBeNull();
    expect(Math.abs(peak!.offsetPx)).toBeLessThan(3);
  });

  it('without the engine’s ray the viewport’s own pick still focuses (an older rt.wasm, or none)', async () => {
    const c: FocusCase = { name: 'thin', view: V };
    const s0 = focusScene(c);
    const clicks = clicksOf(s0, c, null);
    const run = await pick(c, clicks, { noEngine: true });
    expect(run.engineRay).toBe(false);
    for (const k of run.clicks) {
      expect(k.action).not.toBeNull();
      const s = reduce(s0, k.action as Action);
      expect(activeCamera(s).focusMode).toBe('POINT');
      expect(Number.isFinite(activeCamera(s).focusDistance)).toBe(true);
    }
    // The backs of the tiles: the viewport draws front faces only, so its own pick finds nothing there.
    const back: FocusCase = { name: 'back', view: V, azimuth: 180 };
    const none = await pick(back, clicksOf(focusScene(back), back, null), { noEngine: true });
    expect(none.clicks.every((k) => k.action === null)).toBe(true);
  });
});
