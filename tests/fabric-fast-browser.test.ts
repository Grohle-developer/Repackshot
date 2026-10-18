// Phase M3e (M3d ◆2, option b): a fabric of the family, in Simple mode, is baked in the Fast preview through the
// Fabric node (the graph Simple → Nodes makes of it, as M3d bakes a wood) only when one thread spans at least 2.5 texels
// of the 512² bake on its parts (core/material-preview.ts fastFamilyGraph); a finer one stays as Fast drew it before,
// its mean colour and its fuzz, without moiré. The baked one keeps its fuzz on top (three.js's sheen,
// render/preview.ts applyBake). On the 100 mm sphere of tests/browser/programs-scene.ts: the knit (4 stitches a cm,
// 12.8 texels a thread) shows its weave, the cotton (40 threads a cm, 1.28 texels) is the same pixels as without the
// graph workers (what Fast drew of every fabric before M3e), and the knit without its fuzz is another picture. Three.js
// in headless Chromium (SwiftShader), the bakes by the graph workers as in the app (tests/browser/programs-page.ts).
// Skipped without Chromium (REPACKSHOT_CHROMIUM, /opt/pw-browsers); it does not need rt.wasm.
//
// With REPACK_WRITE_CAPTURES=1 and rt.wasm it also makes the capture docs/ui/m3e-fabric-fast.png: the knit, the canvas
// and the cotton of the family on the sphere (rows), in Fast before M3e, in Fast now and in Full (columns):
//
//   npm run engine:build && REPACK_WRITE_CAPTURES=1 npx vitest run tests/fabric-fast-browser.test.ts

import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { chromium, type Browser, type Page } from 'playwright-core';
import { createServer, type ViteDevServer } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fabricThreadTexels, FABRIC_MIN_THREAD_TEXELS } from '../src/core/material-preview';
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

/** The mean gap between each part pixel and the mean of its 7 × 7 neighbourhood (all part): a weave gives a lot. */
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

/** The mean luminance over the part. */
function meanLum(p: Picture): number {
  let n = 0;
  let s = 0;
  for (let i = 0; i < W * H; i++) {
    if (p.part[i] !== 1) continue;
    n++;
    s += lum(p, i);
  }
  return n ? s / n : 0;
}

const texelsOn = (preset: string) => {
  const s = woodSphereScene('FAMILY', W, H, preset);
  const inst = Object.values(s.materials).find((m) => m.family === 'FABRIC')!;
  return fabricThreadTexels(s, inst);
};

const run = executablePath ? describe : describe.skip;

run('a fabric of the family is baked in Fast when its threads read, with its fuzz (M3e)', () => {
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

  it('KNIT (12.8 texels a thread): its weave, baked; COTTON (1.28): as Fast drew it before', async () => {
    expect(texelsOn('KNIT')).toBeGreaterThanOrEqual(FABRIC_MIN_THREAD_TEXELS);
    expect(texelsOn('COTTON')).toBeLessThan(FABRIC_MIN_THREAD_TEXELS);
    const knit = await draw('FAMILY', 'KNIT');
    const knitBefore = await draw('FAMILY', 'KNIT', false);
    const cotton = await draw('FAMILY', 'COTTON');
    const cottonBefore = await draw('FAMILY', 'COTTON', false);
    const out = {
      knitTexels: texelsOn('KNIT'),
      cottonTexels: texelsOn('COTTON'),
      knitDetail: fineDetail(knit).detail,
      knitDetailBefore: fineDetail(knitBefore).detail,
      knitDiffering: differing(knit, knitBefore),
      cottonDiffering: differing(cotton, cottonBefore),
      cottonDetail: fineDetail(cotton).detail,
    };
    console.log('M3E_FABRIC', JSON.stringify(out));
    expect(fineDetail(knit).pixels, 'the sphere fills the frame').toBeGreaterThan(3000);
    // The knit's stitches (its mean colour would leave the detail of the control).
    expect(out.knitDetail, 'the weave').toBeGreaterThan(3 * out.knitDetailBefore);
    expect(out.knitDetail, 'the weave').toBeGreaterThan(1);
    expect(out.knitDiffering, 'another picture than before').toBeGreaterThan(1000);
    // Below the threshold, exactly what Fast drew before M3e.
    expect(out.cottonDiffering, 'the cotton as before').toBe(0);
  }, 600000);

  it('KNIT baked keeps its fuzz on top (the sheen of Simple mode)', async () => {
    const knit = await draw('FAMILY', 'KNIT');
    const bare = await draw('FAMILY', 'KNIT:NOFUZZ');
    const out = { differing: differing(knit, bare), lum: meanLum(knit), lumWithoutFuzz: meanLum(bare), detail: fineDetail(bare).detail };
    console.log('M3E_FUZZ', JSON.stringify(out));
    // Still baked without its fuzz (the weave), and the fuzz lifts it.
    expect(out.detail, 'baked').toBeGreaterThan(1);
    expect(out.differing, 'the fuzz shows').toBeGreaterThan(1000);
    expect(out.lum - out.lumWithoutFuzz, 'the fuzz lifts it').toBeGreaterThan(1);
  }, 600000);

  it.skipIf(!process.env.REPACK_WRITE_CAPTURES || !RT_WASM)('the capture: fabrics of the family in Fast before and after M3e, and in Full (m3e-fabric-fast.png)', async () => {
    const TW = 320;
    const TH = 240;
    const SAMPLES = 128;
    const BG = 236;
    const presets = ['KNIT', 'CANVAS', 'COTTON'];
    const sheet = new Uint8Array(3 * TW * presets.length * TH * 4).fill(255);
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
    for (const [row, preset] of presets.entries()) {
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
    writeFileSync('docs/ui/m3e-fabric-fast.png', await encodePng({ width: 3 * TW, height: presets.length * TH, data: sheet }));
    expect(sheet.length).toBe(3 * TW * presets.length * TH * 4);
  }, 1_200_000);
});
