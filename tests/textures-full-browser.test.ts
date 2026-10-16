// Phase M2b, the region comparison: a texture lands in Full where Fast draws it. The Fast preview (three.js in
// headless Chromium, SwiftShader) and the engine (the real rt.wasm, through the page's own writer with the
// textures on) render the same scenes (tests/browser/textures-scene.ts) from the same camera, and the test
// compares where the texture's cells fall: every pixel is classed by its hue (the checker's red or blue cells, the
// label's green), and away from the cells' borders the two pictures must agree on almost every pixel. Lighting and
// shading differ between the two (that is not compared); the position of the texture may not. A control moves the
// engine's texture by one cell, and the agreement must collapse.
//
//   checker   a sphere with a checker by its UVs and a box turned 30° with the checker by a box projection.
//   label     the example bottle with a label on the front of its body (M2a's criterion, now in Full).
//
// Skipped without Chromium (REPACKSHOT_CHROMIUM, /opt/pw-browsers) or without rt.wasm (npm run engine:build).

import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { chromium, type Browser } from 'playwright-core';
import { createServer, type ViteDevServer } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { registerTextureImage } from '../src/core/texture-images';
import { projectScene, writeRsb } from '../src/io/rsb';
import { decodeTexturePixels } from '../src/io/texture-pixels';
import { png } from '../tools/texture-fixtures.mjs';
import { checkerScene, labelScene } from './browser/textures-scene';
import { fixtureDecoder } from './texture-helpers';
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
const W = 240;
const H = 160;
const SAMPLES = 24;

/** A checker of red and blue cells, 8 a side. */
const CHECKER = png(128, 128, 3, (x: number, y: number) => ((Math.floor(x / 16) + Math.floor(y / 16)) % 2 ? [40, 70, 225] : [225, 40, 35]));
/** A green card with a transparent margin. */
const LABEL = png(96, 64, 4, (x: number, y: number) => (x >= 6 && x < 90 && y >= 6 && y < 58 ? [30, 200, 40, 255] : [0, 0, 0, 0]));

type Klass = 0 | 1 | 2 | 3;
/** 1 red, 2 blue, 3 green, 0 anything else (floor, background, highlights, shadow). */
function klass(r: number, g: number, b: number): Klass {
  const hi = Math.max(r, g, b);
  if (hi < 0.06) return 0;
  if (r > 1.5 * g && r > 1.5 * b) return 1;
  if (b > 1.4 * r && b > 1.1 * g) return 2;
  if (g > 1.5 * r && g > 1.5 * b) return 3;
  return 0;
}

/** The classes of an 8-bit RGBA picture. */
function classesOf8(rgba: ArrayLike<number>): Uint8Array {
  const out = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) out[i] = klass(rgba[4 * i] / 255, rgba[4 * i + 1] / 255, rgba[4 * i + 2] / 255);
  return out;
}

/** The classes of the engine's linear sums of `samples` samples. */
function classesOfSums(sum: Float32Array, samples: number): Uint8Array {
  const out = new Uint8Array(W * H);
  // Linear to display (sRGB) so the thresholds read the same picture as the preview's.
  const enc = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(Math.max(0, v), 1 / 2.4) - 0.055);
  for (let i = 0; i < W * H; i++) out[i] = klass(enc(sum[4 * i] / samples), enc(sum[4 * i + 1] / samples), enc(sum[4 * i + 2] / samples));
  return out;
}

/** Pixels whose 3 × 3 neighbourhood is one class in `c` (away from the cells' borders). */
function settled(c: Uint8Array): Uint8Array {
  const out = new Uint8Array(W * H);
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const k = c[y * W + x];
      if (k === 0) continue;
      let same = true;
      for (let dy = -1; dy <= 1 && same; dy++) for (let dx = -1; dx <= 1 && same; dx++) same = c[(y + dy) * W + x + dx] === k;
      if (same) out[y * W + x] = 1;
    }
  }
  return out;
}

/** Of the pixels settled in both pictures and classed in both, how many agree; and how many there were. */
function agreement(fast: Uint8Array, full: Uint8Array): { share: number; count: number } {
  const a = settled(fast);
  const b = settled(full);
  let count = 0;
  let same = 0;
  for (let i = 0; i < W * H; i++) {
    if (!a[i] || !b[i]) continue;
    count++;
    if (fast[i] === full[i]) same++;
  }
  return { share: count ? same / count : 0, count };
}

/** A PPM of classes, for the eye (out/m2b-regions-*.ppm). */
function dump(name: string, c: Uint8Array): void {
  mkdirSync('out', { recursive: true });
  const colours = [
    [128, 128, 128],
    [230, 40, 40],
    [40, 80, 230],
    [40, 200, 60],
  ];
  const body = new Uint8Array(W * H * 3);
  for (let i = 0; i < W * H; i++) body.set(colours[c[i]], 3 * i);
  writePpm(name, body);
}

/** `body` (RGB rows) as out/m2b-regions-<name>.ppm. */
function writePpm(name: string, body: Uint8Array): void {
  const head = new TextEncoder().encode(`P6\n${W} ${H}\n255\n`);
  const file = new Uint8Array(head.length + body.length);
  file.set(head);
  file.set(body, head.length);
  writeFileSync(`out/m2b-regions-${name}.ppm`, file);
}

/** The preview's own picture, for the eye (out/m2b-regions-*.ppm). */
function dumpRgba(name: string, rgba: ArrayLike<number>): void {
  mkdirSync('out', { recursive: true });
  const body = new Uint8Array(W * H * 3);
  for (let i = 0; i < W * H; i++) body.set([rgba[4 * i], rgba[4 * i + 1], rgba[4 * i + 2]], 3 * i);
  writePpm(name, body);
}

const run = executablePath && RT_WASM ? describe : describe.skip;

run('a texture lands in Full where Fast draws it (M2b, regions)', () => {
  let server: ViteDevServer;
  let browser: Browser;
  const fast: Record<'checker' | 'label', Uint8Array> = { checker: new Uint8Array(0), label: new Uint8Array(0) };
  /** What was measured (out/m2b-regions.json). */
  const results: Record<string, unknown> = { width: W, height: H, samples: SAMPLES };

  beforeAll(async () => {
    server = await createServer({ configFile: false, logLevel: 'error', server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false } });
    await server.listen();
    const url = server.resolvedUrls?.local[0];
    if (!url) throw new Error('the test server has no address');
    browser = await chromium.launch({ executablePath: executablePath!, headless: true, args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`${url}tests/browser/textures.html`);
    await page.waitForFunction(() => window.texturesReady === true, null, { timeout: 120000 });
    for (const [scene, bytes] of [
      ['checker', CHECKER],
      ['label', LABEL],
    ] as const) {
      const got = (await page.evaluate(([s, b, w, h]) => window.runTextures!(s, b, w, h), [scene, Array.from(bytes), W, H] as const)) as { rgba: number[]; tries: number };
      dumpRgba(`${scene}-fast-raw`, got.rgba);
      expect(got.tries, `${scene}: the preview drew the texture`).toBeGreaterThan(0);
      fast[scene] = classesOf8(got.rgba);
    }
    expect(errors).toEqual([]);
  }, 300000);

  afterAll(async () => {
    await browser?.close();
    await server?.close();
    writeFileSync('out/m2b-regions.json', `${JSON.stringify(results, null, 2)}\n`);
  });

  async function full(state: ReturnType<typeof checkerScene>): Promise<Uint8Array> {
    await decodeTexturePixels(state, fixtureDecoder);
    const rsb = writeRsb(projectScene(state, { width: W, height: H, maxSamples: SAMPLES, maxSeconds: 0, textures: true }).scene);
    const rt = await loadRt();
    const { image } = renderWithPasses(rt, rsb, W, H, SAMPLES, 0);
    return classesOfSums(image.sum, SAMPLES);
  }

  it('the checker’s cells on the sphere (UVs) and on the turned box (box projection) fall where Fast draws them', async () => {
    const image = registerTextureImage('checker.png', CHECKER);
    const engine = await full(checkerScene(image, W, H));
    dump('checker-fast', fast.checker);
    dump('checker-full', engine);
    const { share, count } = agreement(fast.checker, engine);
    // Both cells are seen, in quantity, on both parts.
    for (const k of [1, 2]) {
      expect(fast.checker.filter((c) => c === k).length, `fast class ${k}`).toBeGreaterThan(400);
      expect(engine.filter((c) => c === k).length, `full class ${k}`).toBeGreaterThan(400);
    }
    // The control: the engine's image one cell over (an offset of 1/8 of a repeat) swaps every cell.
    const moved = await full(checkerScene(image, W, H, [0.125, 0]));
    const control = agreement(fast.checker, moved);
    results.checker = { share, count, control: control.share, controlCount: control.count };
    expect(count).toBeGreaterThan(1500);
    expect(share).toBeGreaterThan(0.97);
    expect(control.share).toBeLessThan(0.15);
  }, 300000);

  it('M2a’s label on the bottle renders in its place in Full', async () => {
    const image = registerTextureImage('label.png', LABEL);
    const engine = await full(labelScene(image, W, H));
    dump('label-fast', fast.label);
    dump('label-full', engine);
    const a = settled(fast.label.map((c) => (c === 3 ? 3 : 0)) as Uint8Array);
    const b = settled(engine.map((c) => (c === 3 ? 3 : 0)) as Uint8Array);
    let both = 0;
    let either = 0;
    for (let i = 0; i < W * H; i++) {
      if (a[i] && b[i]) both++;
      if (a[i] || b[i]) either++;
    }
    results.label = { iou: both / either, union: either };
    expect(either).toBeGreaterThan(300);
    // The label's area in the two pictures overlaps almost entirely (intersection over union).
    expect(both / either).toBeGreaterThan(0.9);
  }, 300000);
});
