// Phase M3d (M3c ◆3): a wood of the family, in Simple mode, shows in the Fast preview what the same wood shows through
// the Wood node: the preview bakes it by the graph Simple → Nodes makes of it (core/material-graph.ts familyBakeGraph,
// render/graph-preview.ts), so the 100 mm sphere of tests/browser/programs-scene.ts in the catalogue's oak (and in the
// knotty pine: its knots come from the bake, not from E6's layer on top) draws byte for byte as the same sphere with
// the material converted to nodes. The control is the family without graph workers, which keeps what Fast drew of it
// before M3d (its mean colour, and its knots): no rings, so its pixels hardly vary within a few pixels. Three.js in
// headless Chromium (SwiftShader), the bakes by the graph workers as in the app (tests/browser/programs-page.ts).
// Skipped without Chromium (REPACKSHOT_CHROMIUM, /opt/pw-browsers); it does not need rt.wasm.
//
// With REPACK_WRITE_CAPTURES=1 and rt.wasm it also makes the capture docs/ui/m3d-wood-fast.png: the oak (above) and the
// knotty pine (below) of the family on the sphere, in Fast before M3d (without workers: the mean colour and the knots
// of E6's layer), in Fast now (the Wood node's bake) and in Full (the real rt.wasm through the page's writer):
//
//   npm run engine:build && REPACK_WRITE_CAPTURES=1 npx vitest run tests/wood-fast-browser.test.ts

import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { chromium, type Browser, type Page } from 'playwright-core';
import { createServer, type ViteDevServer } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { encodePng } from '../src/io/image';
import { projectScene, tonemapFor, writeRsb } from '../src/io/rsb';
import { exactBytes } from '../src/render/tiles';
import { woodSphereScene } from './browser/programs-scene';
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
const W = 200;
const H = 150;

interface Picture {
  rgba: number[];
  part: number[];
  tries: number;
}

const lum = (p: Picture, i: number) => 0.2126 * p.rgba[4 * i] + 0.7152 * p.rgba[4 * i + 1] + 0.0722 * p.rgba[4 * i + 2];

/**
 * How much the part's luminance varies within a few pixels: the mean gap between each pixel and the mean of its 7 × 7
 * neighbourhood, over the pixels whose neighbourhood is all part. A flat colour on the sphere (its shading is smooth
 * under the white world) gives about none; the oak's 3 mm rings, five pixels a ring here, give a lot.
 */
function fineDetail(p: Picture): { pixels: number; detail: number } {
  let n = 0;
  let sum = 0;
  for (let y = 3; y < H - 3; y++) {
    for (let x = 3; x < W - 3; x++) {
      let all = true;
      let s = 0;
      for (let dy = -3; dy <= 3 && all; dy++) {
        for (let dx = -3; dx <= 3; dx++) {
          const j = (y + dy) * W + x + dx;
          if (p.part[j] !== 1) {
            all = false;
            break;
          }
          s += lum(p, j);
        }
      }
      if (!all) continue;
      n++;
      sum += Math.abs(lum(p, y * W + x) - s / 49);
    }
  }
  return { pixels: n, detail: n ? sum / n : 0 };
}

function differing(a: Picture, b: Picture): number {
  let n = 0;
  for (let i = 0; i < a.rgba.length; i++) if (a.rgba[i] !== b.rgba[i]) n++;
  return n;
}

/** `rgba` as out/m3d-<name>.ppm, for the eye. */
function dump(name: string, rgba: ArrayLike<number>): void {
  mkdirSync('out', { recursive: true });
  const head = new TextEncoder().encode(`P6\n${W} ${H}\n255\n`);
  const body = new Uint8Array(W * H * 3);
  for (let i = 0; i < W * H; i++) body.set([rgba[4 * i], rgba[4 * i + 1], rgba[4 * i + 2]], 3 * i);
  const file = new Uint8Array(head.length + body.length);
  file.set(head);
  file.set(body, head.length);
  writeFileSync(`out/m3d-${name}.ppm`, file);
}

const run = executablePath ? describe : describe.skip;

run('a wood of the family draws in Fast as the Wood node does (M3d)', () => {
  let server: ViteDevServer;
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    server = await createServer({ configFile: false, logLevel: 'error', server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false } });
    await server.listen();
    const url = server.resolvedUrls?.local[0];
    if (!url) throw new Error('the test server has no address');
    browser = await chromium.launch({ executablePath: executablePath!, headless: true, args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
    page = await browser.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`${url}tests/browser/programs.html`);
    await page.waitForFunction(() => window.graphsReady === true, null, { timeout: 120000 });
    expect(errors).toEqual([]);
  }, 300000);

  afterAll(async () => {
    await browser?.close();
    await server?.close();
  });

  const draw = async (kind: string, preset: string, workers = true, w = W, h = H): Promise<Picture> => {
    const got = (await page.evaluate(([k, ww, hh, x]) => window.runGraph!(k, ww, hh, x), [`WOOD_SPHERE:${kind}:${preset}`, w, h, workers] as const)) as Picture;
    expect(got.tries, `${kind} ${preset}: the preview settled`).toBeGreaterThan(0);
    return got;
  };

  for (const preset of ['OAK', 'PINE']) {
    it(`${preset}: the family's sphere is the converted one's, byte for byte, with its rings`, async () => {
      const family = await draw('FAMILY', preset);
      const converted = await draw('CONVERTED', preset);
      const before = await draw('FAMILY', preset, false);
      dump(`${preset.toLowerCase()}-family`, family.rgba);
      dump(`${preset.toLowerCase()}-converted`, converted.rgba);
      dump(`${preset.toLowerCase()}-without-workers`, before.rgba);
      const f = fineDetail(family);
      const b = fineDetail(before);
      const out = { pixels: f.pixels, detail: f.detail, detailWithoutWorkers: b.detail, differing: differing(family, converted), differingWithoutWorkers: differing(before, converted) };
      console.log(`M3D_${preset}`, JSON.stringify(out));
      expect(f.pixels, 'the sphere fills the frame').toBeGreaterThan(3000);
      expect(out.differing, 'the family and the Wood node: the same pixels').toBe(0);
      // The rings (the family falling back to its mean colour would leave the detail of the control).
      expect(f.detail, 'rings').toBeGreaterThan(3 * b.detail);
      expect(f.detail, 'rings').toBeGreaterThan(2);
      expect(out.differingWithoutWorkers, 'the control is another picture').toBeGreaterThan(1000);
    }, 600000);
  }

  // A fade of the material on the timeline (N1) sets it again from its instance whenever the playhead moves: the
  // family's wood gets its bake back under the fade (render/preview.ts resetMaterial), not its mean colour.
  it('PINE under a fade of the timeline: its rings, faded', async () => {
    const faded = await draw('FAMILY', 'PINE:FADED');
    const plain = await draw('FAMILY', 'PINE');
    const before = await draw('FAMILY', 'PINE', false);
    const out = { detail: fineDetail(faded).detail, detailWithoutWorkers: fineDetail(before).detail, differing: differing(faded, plain) };
    console.log('M3D_FADED', JSON.stringify(out));
    expect(out.differing, 'the fade shows').toBeGreaterThan(1000);
    expect(out.detail, 'rings').toBeGreaterThan(2);
    expect(out.detail, 'rings').toBeGreaterThan(3 * out.detailWithoutWorkers);
  }, 600000);

  it.skipIf(!process.env.REPACK_WRITE_CAPTURES || !RT_WASM)('the capture: the family\'s wood in Fast before and after M3d, and in Full (m3d-wood-fast.png)', async () => {
    const TW = 320;
    const TH = 240;
    const SAMPLES = 128;
    const BG = 236;
    const sheet = new Uint8Array(3 * TW * 2 * TH * 4).fill(255);
    const put = (col: number, row: number, rgba: ArrayLike<number>, part: ArrayLike<number>) => {
      for (let y = 0; y < TH; y++) {
        for (let x = 0; x < TW; x++) {
          const i = y * TW + x;
          const o = ((row * TH + y) * 3 * TW + col * TW + x) * 4;
          for (let c = 0; c < 3; c++) sheet[o + c] = part[i] === 1 ? rgba[4 * i + c] : BG;
        }
      }
    };
    const rt = await loadRt();
    for (const [row, preset] of ['OAK', 'PINE'].entries()) {
      const before = await draw('FAMILY', preset, false, TW, TH);
      const now = await draw('FAMILY', preset, true, TW, TH);
      const state = woodSphereScene('FAMILY', TW, TH, preset);
      const rsb = writeRsb(projectScene(state, { width: TW, height: TH, maxSamples: SAMPLES, maxSeconds: 0, textures: true, programs: true }).scene);
      const { image, passes } = renderWithPasses(rt, rsb, TW, TH, SAMPLES, 8);
      const full = exactBytes(image.sum, SAMPLES, state.image.exposureEv, tonemapFor(state.image.viewTransform));
      put(0, row, before.rgba, before.part);
      put(1, row, now.rgba, now.part);
      put(2, row, full, passes.partId!);
    }
    writeFileSync('docs/ui/m3d-wood-fast.png', await encodePng({ width: 3 * TW, height: 2 * TH, data: sheet }));
    expect(sheet.length).toBe(3 * TW * 2 * TH * 4);
  }, 1_200_000);
});
