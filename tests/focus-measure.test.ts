// The measurement of focus with a click (phase F1, part 1): in a real browser the viewport's pick (the page of
// tests/browser/focus-page.ts: the engine's chief ray of the pixel from rt.wasm, cast at the preview's geometry, then the
// interface's focus action) clicks pixels of the slanted checker board (tests/browser/focus-scene.ts) at the centre,
// near the edges and near the corners of the frame, in every case that exists (the thin lens, O1's tilt and shift, O2's
// traced lenses with their artistic distortion and breathing, U13 frames of another ratio than the viewport's, a saved
// camera looked through with its own ratio, the timeline with a camera clip, an orbit, a zoom and a move of the part
// after the pick, the backs of the tiles). Node applies each action, with the engine's focus solver of main.ts, and
// asks the engine:
//
//   - the depth and circle-of-confusion passes (rt.wasm, the exact passes: the engine's chief ray through the pixel)
//     of the Full view's image (the viewport, one image pixel per CSS pixel) at the clicked pixel and of the final
//     frame at the pixel the click lands on: the focus distance written to the RSB minus the depth there, in mm;
//   - the engine's own focus for what that pixel shows (`rt_scene_pick` on the whole scene: the hinge rule of a tilt,
//     a traced lens's best focus), minus the focus written: in mm, 0 when the pixel is in focus;
//   - the final frame rendered (the native `rt`, the same rt-core) for some clicks, searched for where the checker is
//     sharpest along the depth's gradient through the clicked pixel: how far the sharp band is from it, in pixels.
//
// Heavy (a browser and some forty renders): it runs only with REPACK_FOCUS_MEASURE=1 and writes out/focus-measure-*.
// The numbers before F1 came from the same harness at 319614b, with the page picking as B1 left it (the preview's
// pinhole ray, the focus distance measured from the camera's stored pose, `focusDistanceTo`).

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium, type Browser, type Page } from 'playwright-core';
import { createServer, type ViteDevServer } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { activeCamera, cameraBasis, cameraFrameRect, cameraPosition, orbitPatch, type CameraState } from '../src/core/camera';
import { setFocusSolver } from '../src/core/focus';
import { passMask } from '../src/core/passes';
import { reduce, type Action, type ProjectState } from '../src/core/store';
import { viewedCamera, viewProjector, type ViewObject } from '../src/core/view-objects';
import { lensInfoRsb, projectScene, writeRsb, type SceneView } from '../src/io/rsb';
import { enginePick, focusSolverOf, hasFocusExports } from '../src/render/focus-pick';
import { hasLensInfoExport, readLensInfo } from '../src/render/lens-info';
import { PassAccumulator, Scratch, tileExact } from '../src/render/pass-planes';
import { tileGrid } from '../src/render/tiles';
import type { FocusPickRun } from './browser/focus-page';
import { focusScene, lookCameraId, type FocusCase } from './browser/focus-scene';
import { bandSharpness, cocAt, depthAt, engine, sharpPeak, type FocusImage } from './focus-measure';

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

const RT_CLI = ['engine/target/release/rt', process.env.REPACK_RT_CLI ?? ''].find((p) => p && existsSync(p)) ?? null;
const executablePath = findChromium();
const RUN = !!process.env.REPACK_FOCUS_MEASURE && !!executablePath && !!RT_CLI;
const SAMPLES = Number(process.env.REPACK_FOCUS_SAMPLES ?? 48);
const TAG = process.env.REPACK_FOCUS_TAG ?? 'after';

const V = { w: 640, h: 400 };
const ORBIT = { target: { kind: 'CAMERA' as const }, move: 'ORBIT' as const, shot: null, start: 0, duration: 2, amount: 12, easing: 'LINEAR' as const };
/** What happens after the pick, before the render. */
type After = 'orbit' | 'zoom' | 'move' | null;
const CASES: (FocusCase & { after?: After; sharp?: boolean })[] = [
  { name: 'thin', view: V, sharp: true },
  { name: 'tilt 6°', view: V, optics: { tiltDeg: 6, tiltAxisDeg: 0 }, sharp: true },
  { name: 'shift', view: V, optics: { shiftXMm: 5, shiftYMm: -3 } },
  { name: 'traced double Gauss f/1.4', view: V, traced: { key: 'double_gauss_fast' }, sharp: true },
  { name: 'traced Petzval', view: V, traced: { key: 'petzval_portrait' }, sharp: true },
  { name: 'traced internal focus', view: V, traced: { key: 'telephoto_internal_focus' } },
  { name: 'traced distortion +1', view: V, traced: { key: 'double_gauss_fast', distortion: 1 }, sharp: true },
  { name: 'traced distortion −1', view: V, traced: { key: 'double_gauss_fast', distortion: -1 } },
  { name: 'traced breathing +1', view: V, traced: { key: 'double_gauss_fast', breathing: 1 } },
  { name: 'frame 1:1', view: V, aspect: '1:1', render: { w: 360, h: 360 } },
  { name: 'frame 9:16', view: V, aspect: '9:16', render: { w: 270, h: 480 } },
  { name: 'look through', view: V, lookThrough: { azimuth: 6, elevation: 4, distance: 640 }, sharp: true },
  { name: 'look through 9:16', view: V, lookThrough: { azimuth: 6, elevation: 4, distance: 640, aspectKey: '9:16' }, render: { w: 480, h: 270 } },
  { name: 'timeline t=1 orbit', view: V, clips: [ORBIT], playhead: 1, sharp: true },
  { name: 'orbit after the pick', view: V, after: 'orbit', sharp: true },
  { name: 'zoom after the pick', view: V, after: 'zoom' },
  { name: 'part moved after the pick', view: V, after: 'move' },
  { name: 'backs of the tiles', view: V, azimuth: 180, sharp: true },
];
/** Where in the frame of the viewed camera the clicks go (fractions of its width and height). */
const SPOTS: { name: string; fx: number; fy: number }[] = [
  { name: 'centre', fx: 0.5, fy: 0.5 },
  { name: 'top', fx: 0.5, fy: 0.12 },
  { name: 'right', fx: 0.88, fy: 0.5 },
  { name: 'top left', fx: 0.12, fy: 0.12 },
  { name: 'top right', fx: 0.88, fy: 0.12 },
  { name: 'bottom left', fx: 0.12, fy: 0.88 },
  { name: 'bottom right', fx: 0.88, fy: 0.88 },
];
const SHARP_SPOTS = new Set(['centre', 'top left', 'bottom right']);

/** The RSB of a view (the whole scene) and the focus distance written to its camera. */
function sceneRsb(state: ProjectState, view: SceneView): { rsb: Uint8Array; focusDist: number } {
  const { scene } = projectScene(state, view);
  return { rsb: writeRsb(scene, { meshes: true }), focusDist: scene.camera.focusDist };
}

/** The exact passes of a view (depth and coc), one ray per pixel (rt.wasm), with the view's RSB. */
async function exactPasses(state: ProjectState, view: SceneView): Promise<FocusImage & { rsb: Uint8Array }> {
  const r = await engine();
  const { rsb, focusDist } = sceneRsb(state, { ...view, passes: ['depth', 'coc'] });
  const ptr = r.rt_alloc(rsb.length);
  new Uint8Array(r.memory.buffer, ptr, rsb.length).set(rsb);
  const handle = r.rt_scene_load(ptr, rsb.length);
  r.rt_free(ptr, rsb.length);
  if (handle === 0) throw new Error('rt_scene_load failed');
  const mask = passMask(['depth', 'coc']);
  const tiles = tileGrid(view.width, view.height);
  const acc = new PassAccumulator(view.width, view.height, mask, tiles);
  const scratch = new Scratch(r);
  try {
    for (const t of tiles) acc.setExact(t.index, tileExact(r, handle, t, mask, scratch));
  } finally {
    scratch.free();
    r.rt_scene_free(handle);
  }
  const p = acc.resolve();
  return { width: view.width, height: view.height, rgb: new Float32Array(0), depth: p.depth!, coc: p.coc!, focusDist, rsb };
}

/** The engine's own focus distance for what image point (x, y) of a scene shows (null: it shows nothing). */
async function engineFocusOfPixel(rsb: Uint8Array, width: number, height: number, x: number, y: number): Promise<number | null> {
  const r = await engine();
  if (!hasFocusExports(r)) return null;
  return enginePick(r, rsb, x / width, y / height)?.hit?.focusDist ?? null;
}

/** Reads the linear RGB of the uncompressed little-endian float TIFF `rt --format tiff --bits 32` writes. */
function readFloatTiff(bytes: Uint8Array): { width: number; height: number; rgb: Float32Array } {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes[0] !== 0x49 || bytes[1] !== 0x49) throw new Error('not a little-endian TIFF');
  const ifd = v.getUint32(4, true);
  const n = v.getUint16(ifd, true);
  const tags = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const e = ifd + 2 + i * 12;
    const tag = v.getUint16(e, true);
    const type = v.getUint16(e + 2, true);
    const count = v.getUint32(e + 4, true);
    const size = type === 3 ? 2 : 4;
    const at = count * size <= 4 ? e + 8 : v.getUint32(e + 8, true);
    const vals: number[] = [];
    for (let k = 0; k < count; k++) vals.push(type === 3 ? v.getUint16(at + k * 2, true) : v.getUint32(at + k * 4, true));
    tags.set(tag, vals);
  }
  const width = tags.get(256)![0];
  const height = tags.get(257)![0];
  const offsets = tags.get(273)!;
  const counts = tags.get(279)!;
  const rgb = new Float32Array(width * height * 3);
  let o = 0;
  for (let s = 0; s < offsets.length; s++) {
    for (let k = 0; k < counts[s]; k += 4) rgb[o++] = v.getFloat32(offsets[s] + k, true);
  }
  return { width, height, rgb };
}

/** The final frame rendered by the native engine (linear float TIFF), with its exact passes from rt.wasm. */
async function renderFinal(state: ProjectState, tag: string): Promise<FocusImage> {
  const width = state.render.width;
  const height = state.render.height;
  const view: SceneView = { width, height, maxSamples: SAMPLES, maxSeconds: 0, maxDepth: 1 };
  const { rsb } = sceneRsb(state, view);
  mkdirSync('out/focus-measure', { recursive: true });
  const rsbPath = `out/focus-measure/${tag}.rsb`;
  const tifPath = `out/focus-measure/${tag}.tif`;
  writeFileSync(rsbPath, rsb);
  const run = spawnSync(RT_CLI!, [rsbPath, '-o', tifPath, '--format', 'tiff', '--bits', '32', '--samples', String(SAMPLES)], { encoding: 'utf8' });
  if (run.status !== 0) throw new Error(`rt failed: ${run.stderr}`);
  const tif = readFloatTiff(new Uint8Array(readFileSync(tifPath)));
  const passes = await exactPasses(state, view);
  return { ...passes, rgb: tif.rgb };
}

interface ClickResult {
  spot: string;
  x: number;
  y: number;
  hit: boolean;
  /** The focus distance the final render's RSB carries. */
  focusMm: number;
  /** Full view: its RSB's focus minus the depth at the clicked pixel, and minus the engine's own focus for that pixel; the circle of confusion, px. */
  fullDepthMm: number;
  fullEngineMm: number | null;
  fullCocPx: number;
  /** Final frame: the same at the pixel the click lands on. */
  finalDepthMm: number;
  finalEngineMm: number | null;
  finalCocPx: number;
  /** Final frame rendered: the sharp band's distance from that pixel along the depth's gradient, px (null: not rendered). */
  sharpPx: number | null;
  /** After the pick (orbit, zoom, the part moved): how far off a focus left at the picked distance would be, mm. */
  staleMm?: number | null;
}

describe.skipIf(!RUN)(`focus with a click, measured (${TAG})`, { timeout: 7200000 }, () => {
  let server: ViteDevServer;
  let browser: Browser;
  let page: Page | undefined;
  let pageUrl = '';
  const results: { name: string; engineRay: boolean; clicks: ClickResult[] }[] = [];

  beforeAll(async () => {
    // The engine's focus solver, as main.ts gives it (a traced lens's best focus).
    const r = await engine();
    if (hasFocusExports(r)) setFocusSolver(focusSolverOf(r, (cam) => lensInfoRsb(cam, cam.aspect.w, cam.aspect.h)));
    server = await createServer({ configFile: false, logLevel: 'error', server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false } });
    await server.listen();
    const base = server.resolvedUrls?.local[0];
    if (!base) throw new Error('the test server has no address');
    browser = await chromium.launch({ executablePath: executablePath!, headless: true, args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
    pageUrl = `${base}tests/browser/focus.html`;
  }, 180000);

  /** A fresh page for each case (a long run of rebuilt boards wears SwiftShader out). */
  async function freshPage(): Promise<Page> {
    await page?.close().catch(() => undefined);
    page = await browser.newPage({ viewport: { width: 800, height: 600 }, deviceScaleFactor: 1 });
    page.on('pageerror', (e) => console.error(e.message));
    await page.goto(pageUrl);
    await page.waitForFunction(() => window.focusPickReady === true, null, { timeout: 120000 });
    return page;
  }

  afterAll(async () => {
    setFocusSolver(null);
    mkdirSync('out', { recursive: true });
    const file = `out/focus-measure-${TAG}`;
    writeFileSync(`${file}.json`, JSON.stringify(results, null, 2));
    const fmt = (v: number | null, d = 2) => (v === null || !Number.isFinite(v) ? '—' : v.toFixed(d));
    const lines = [
      `| case | spot | focus mm | Full: − depth mm | Full: − engine's focus mm | Full: CoC px | final: − depth mm | final: − engine's focus mm | final: CoC px | final: sharp band px | a focus left behind: mm |`,
      `|---|---|---|---|---|---|---|---|---|---|---|`,
    ];
    for (const r of results) {
      for (const c of r.clicks) {
        lines.push(`| ${r.name} | ${c.spot} | ${fmt(c.focusMm, 1)} | ${fmt(c.fullDepthMm)} | ${fmt(c.fullEngineMm)} | ${fmt(c.fullCocPx, 1)} | ${fmt(c.finalDepthMm)} | ${fmt(c.finalEngineMm)} | ${fmt(c.finalCocPx, 1)} | ${fmt(c.sharpPx, 1)} | ${fmt(c.staleMm ?? null)} |`);
      }
    }
    writeFileSync(`${file}.md`, lines.join('\n') + '\n');
    await page?.close().catch(() => undefined);
    await browser?.close();
    await server?.close();
  }, 120000);

  for (const c of CASES) {
    it(c.name, async () => {
      const state0 = focusScene(c);
      const look: ViewObject | null = c.lookThrough ? { kind: 'CAMERA', id: lookCameraId(state0)! } : null;
      const seen = viewedCamera(state0, look);
      const frame = cameraFrameRect(seen, c.view.w, c.view.h);
      const clicks = SPOTS.map((s) => ({ x: frame.x + s.fx * frame.width, y: frame.y + s.fy * frame.height }));
      // The engine's numbers of the active camera's traced lens, for the preview's profile.
      let info: string | null = null;
      const cam0 = activeCamera(state0);
      if (cam0.optics?.traced) {
        const r = await engine();
        if (hasLensInfoExport(r)) {
          const li = readLensInfo(r, lensInfoRsb(cam0, cam0.aspect.w, cam0.aspect.h));
          if (li) info = JSON.stringify({ traced: true, ...li, section: null });
        }
      }
      const p = await freshPage();
      const run = (await p.evaluate(([cc, cl, inf]) => window.runFocusPick!(cc as FocusCase, cl as { x: number; y: number }[], inf as string | null), [c, clicks, info] as const)) as FocusPickRun;
      const out: ClickResult[] = [];
      for (let i = 0; i < SPOTS.length; i++) {
        const spot = SPOTS[i];
        const click = run.clicks[i];
        let s = state0;
        if (click.action) s = reduce(s, click.action as Action);
        const camId = look ? look.id : s.camera.active;
        if (c.after === 'orbit' || c.after === 'zoom') {
          const cam = s.camera.cameras[camId] as CameraState;
          const v = c.after === 'orbit' ? { azimuth: cam.azimuth + 8, elevation: cam.elevation, distance: cam.distance, target: cam.target } : { azimuth: cam.azimuth, elevation: cam.elevation, distance: cam.distance * 0.85, target: cam.target };
          const patch = orbitPatch(cam, v);
          if (patch) s = reduce(s, { type: 'camera/set', id: camId, patch });
        } else if (c.after === 'move') {
          const board = s.scene.roots[0];
          const tr = s.scene.nodes[board].transform;
          s = reduce(s, { type: 'scene/setTransforms', transforms: { [board]: { ...tr, position: [tr.position[0], tr.position[1] + 15, tr.position[2]] } } });
        }
        // After the pick the camera or the part moved: the clicked point is where it went (the focus follows the point,
        // not the pixel). `staleMm` is what a focus left at the picked distance would be off by there.
        let at = { x: click.x, y: click.y };
        let staleMm: number | null = null;
        if (c.after && click.hit && click.action) {
          const moved: [number, number, number] = c.after === 'move' ? [click.hit.point[0], click.hit.point[1] + 15, click.hit.point[2]] : click.hit.point;
          const seenNow = viewedCamera(s, look);
          const q = viewProjector(seenNow, c.view.w, c.view.h, seenNow.aspect.w, seenNow.aspect.h)(moved);
          if (q) at = { x: q.x, y: q.y };
          const picked = viewedCamera(reduce(state0, click.action as Action), look).focusDistance;
          const b = cameraBasis(seenNow.azimuth, seenNow.elevation);
          const d = moved.map((v, k) => v - cameraPosition(seenNow)[k]);
          staleMm = picked - (d[0] * b.forward[0] + d[1] * b.forward[1] + d[2] * b.forward[2]);
        }
        // The Full view: what the viewport renders (the camera looked through, its frame, the pose).
        const cameraPatch = look ? (({ id: _id, ...rest }) => rest)(s.camera.cameras[look.id]) : undefined;
        const full = await exactPasses(s, { width: c.view.w, height: c.view.h, maxSamples: 1, maxSeconds: 0, viewport: { viewW: c.view.w, viewH: c.view.h }, ...(cameraPatch ? { cameraPatch } : {}) });
        // The final frame: the camera looked through is rendered as itself (a queue job for that camera).
        const finalState = look ? reduce(s, { type: 'camera/activate', id: look.id }) : s;
        const fr = cameraFrameRect(viewedCamera(s, look), c.view.w, c.view.h);
        const W = finalState.render.width;
        const H = finalState.render.height;
        const fx = ((at.x - fr.x) / fr.width) * W;
        const fy = ((at.y - fr.y) / fr.height) * H;
        const finalPasses = await exactPasses(finalState, { width: W, height: H, maxSamples: 1, maxSeconds: 0 });
        const fullEngine = await engineFocusOfPixel(full.rsb, c.view.w, c.view.h, at.x, at.y);
        const finalEngine = await engineFocusOfPixel(finalPasses.rsb, W, H, fx, fy);
        let sharpPx: number | null = null;
        if (c.sharp && SHARP_SPOTS.has(spot.name) && click.hit) {
          const img = await renderFinal(finalState, `${TAG}-${c.name.replace(/[^a-z0-9]+/gi, '_')}-${spot.name.replace(/ /g, '_')}`);
          const peak = sharpPeak(img, bandSharpness(img), fx, fy, 60, 14, { band: true });
          if (peak && peak.contrast > 2) sharpPx = peak.offsetPx;
        }
        out.push({
          spot: spot.name,
          x: at.x,
          y: at.y,
          staleMm,
          hit: !!click.hit,
          focusMm: finalPasses.focusDist,
          fullDepthMm: full.focusDist - depthAt(full, click.x, click.y),
          fullEngineMm: fullEngine === null ? null : full.focusDist - fullEngine,
          fullCocPx: cocAt(full, click.x, click.y),
          finalDepthMm: finalPasses.focusDist - depthAt(finalPasses, fx, fy),
          finalEngineMm: finalEngine === null ? null : finalPasses.focusDist - finalEngine,
          finalCocPx: cocAt(finalPasses, fx, fy),
          sharpPx,
        });
      }
      results.push({ name: c.name, engineRay: run.engineRay, clicks: out });
      expect(out.length).toBe(SPOTS.length);
    });
  }
});
