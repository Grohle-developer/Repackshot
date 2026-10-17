// Phase M3b, the region comparison: a node material renders in Full where and as Fast draws it. The Fast preview
// (three.js in headless Chromium, SwiftShader, its graph baked by the graph workers) and the engine (the real
// rt.wasm, through the page's own writer with the programs on) render the ten example graphs of M3a on parts where
// Fast's maps are the graph itself (tests/browser/programs-scene.ts: a plate whose front face is the part's plane
// y = 0, a cylinder about its axis for the label), from the same camera, in a flat white world, and the test
// compares, over the part's pixels (the part-id passes of both):
//
//   position  each picture's pixels classed dark, light (the lower and upper third of its own luminances) or
//             between, and away from the borders of those regions the share of pixels where the two agree; and the
//             correlation of the two luminances. A control renders the engine with the pattern moved (the part's
//             own coordinates shifted or turned under the same surface, or its UVs by half a band): the agreement
//             must collapse.
//   tone      the mean colour of the part in each picture (display values, the app's tone curve), and their gap; the
//             same for the plate in a plain material (no graph): the two renderers' own difference.
//
// Lighting and shading differ between the two (Fast's lights are three.js's, the engine's are traced): that is not
// compared. By tone only, their pattern measures reported: the brushed metal (its pattern is in its roughness and its
// bump, under the studio's lights), the dusty glass (Fast has no transmission map: its transmission is the graph's
// mean, and the dust is mostly a change of transmission). The metallic paint is compared by the correlation of its
// pattern and by its tone, not by the agreement of settled pixels (its flakes are too fine to leave many). Until C1
// its tone came out inverted (correlation −0.91, a gap of 106): M3a's NORMAL_MAP took a blue below 0.5 as it was, the
// flakes' noise colour put half of the normals into the surface, the engine bent them to the edge of the viewer's side
// (dark) and three.js lit them from the world (light). Since C1 the node keeps every normal outside and the example
// holds the blue at 1: the same pattern in the same tone. Skipped without Chromium (REPACKSHOT_CHROMIUM,
// /opt/pw-browsers) or without rt.wasm.

import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { chromium, type Browser, type Page } from 'playwright-core';
import { createServer, type ViteDevServer } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { registerLabelImage } from '../src/core/material-examples';
import { projectScene, tonemapFor, writeRsb } from '../src/io/rsb';
import { exactBytes } from '../src/render/tiles';
import { GRAPH_KEYS, graphScene, PLAIN } from './browser/programs-scene';
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
const SAMPLES = 32;

/** The graphs compared by the place of their pattern and by their tone. */
const PATTERNED = ['PLASTIC_LABEL', 'MARBLE', 'LEATHER', 'WOOD_TWO_NOISES', 'CHECKS', 'GLAZED_CERAMIC', 'STRIPES'];
/** Compared by the correlation of their pattern and by their tone (too fine for the settled pixels: see above). */
const PLACED = ['METALLIC_FLAKES'];

interface Picture {
  /** Display values, RGBA 8-bit. */
  rgba: ArrayLike<number>;
  /** Part id per pixel (0 background). */
  part: ArrayLike<number>;
}

const lum = (p: Picture, i: number) => 0.2126 * p.rgba[4 * i] + 0.7152 * p.rgba[4 * i + 1] + 0.0722 * p.rgba[4 * i + 2];

/** The part's pixels in both pictures, two pixels in from its silhouette. */
function maskOf(a: Picture, b: Picture): Uint8Array {
  const m = new Uint8Array(W * H);
  for (let y = 2; y < H - 2; y++) {
    for (let x = 2; x < W - 2; x++) {
      let ok = true;
      for (let dy = -2; dy <= 2 && ok; dy++) for (let dx = -2; dx <= 2 && ok; dx++) ok = a.part[(y + dy) * W + x + dx] === 1 && b.part[(y + dy) * W + x + dx] === 1;
      if (ok) m[y * W + x] = 1;
    }
  }
  return m;
}

/** The luminance blurred over 3 × 3 (the engine's noise and a pixel's offset between the two). */
function blurred(p: Picture): Float64Array {
  const out = new Float64Array(W * H);
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      let s = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += lum(p, (y + dy) * W + x + dx);
      out[y * W + x] = s / 9;
    }
  }
  return out;
}

/** 1 dark, 3 light, 2 between: by the picture's own thirds of its luminances over the mask. */
function classes(v: Float64Array, mask: Uint8Array): Uint8Array {
  const vals: number[] = [];
  for (let i = 0; i < W * H; i++) if (mask[i]) vals.push(v[i]);
  vals.sort((a, b) => a - b);
  const lo = vals[Math.floor(vals.length / 3)];
  const hi = vals[Math.floor((2 * vals.length) / 3)];
  const out = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) if (mask[i]) out[i] = v[i] <= lo ? 1 : v[i] >= hi ? 3 : 2;
  return out;
}

/** Of the pixels dark or light in both and settled (their 3 × 3 is one class) in both, how many agree. */
function agreement(a: Uint8Array, b: Uint8Array): { share: number; count: number } {
  const settled = (c: Uint8Array, i: number) => {
    const k = c[i];
    if (k !== 1 && k !== 3) return false;
    const x = i % W;
    const y = (i - x) / W;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (c[(y + dy) * W + x + dx] !== k) return false;
    return true;
  };
  let count = 0;
  let same = 0;
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      if (!settled(a, i) || !settled(b, i)) continue;
      count++;
      if (a[i] === b[i]) same++;
    }
  }
  return { share: count ? same / count : 0, count };
}

/** Pearson's correlation of two value maps over the mask. */
function correlation(a: Float64Array, b: Float64Array, mask: Uint8Array): number {
  let n = 0;
  let sa = 0;
  let sb = 0;
  for (let i = 0; i < W * H; i++) {
    if (!mask[i]) continue;
    n++;
    sa += a[i];
    sb += b[i];
  }
  const ma = sa / n;
  const mb = sb / n;
  let cab = 0;
  let caa = 0;
  let cbb = 0;
  for (let i = 0; i < W * H; i++) {
    if (!mask[i]) continue;
    cab += (a[i] - ma) * (b[i] - mb);
    caa += (a[i] - ma) ** 2;
    cbb += (b[i] - mb) ** 2;
  }
  return caa > 0 && cbb > 0 ? cab / Math.sqrt(caa * cbb) : 0;
}

/** The mean display colour over the mask, 0..255. */
function meanColour(p: Picture, mask: Uint8Array): [number, number, number] {
  const s = [0, 0, 0];
  let n = 0;
  for (let i = 0; i < W * H; i++) {
    if (!mask[i]) continue;
    n++;
    for (let c = 0; c < 3; c++) s[c] += p.rgba[4 * i + c];
  }
  return [s[0] / n, s[1] / n, s[2] / n];
}

/** `rgba` as out/m3b-regions-<name>.ppm, for the eye. */
function dump(name: string, rgba: ArrayLike<number>): void {
  mkdirSync('out', { recursive: true });
  const head = new TextEncoder().encode(`P6\n${W} ${H}\n255\n`);
  const body = new Uint8Array(W * H * 3);
  for (let i = 0; i < W * H; i++) body.set([rgba[4 * i], rgba[4 * i + 1], rgba[4 * i + 2]], 3 * i);
  const file = new Uint8Array(head.length + body.length);
  file.set(head);
  file.set(body, head.length);
  writeFileSync(`out/m3b-regions-${name}.ppm`, file);
}

const run = executablePath && RT_WASM ? describe : describe.skip;

run('a node material renders in Full where and as Fast draws it (M3b, regions)', () => {
  let server: ViteDevServer;
  let browser: Browser;
  let page: Page;
  const results: Record<string, unknown> = { width: W, height: H, samples: SAMPLES };

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
    registerLabelImage();
  }, 300000);

  afterAll(async () => {
    await browser?.close();
    await server?.close();
    mkdirSync('out', { recursive: true });
    writeFileSync('out/m3b-regions.json', `${JSON.stringify(results, null, 2)}\n`);
  });

  /** The engine's picture of graph `key` (the control: the pattern moved). */
  async function full(key: string, control: boolean): Promise<Picture> {
    const state = graphScene(key, W, H, control);
    const rsb = writeRsb(projectScene(state, { width: W, height: H, maxSamples: SAMPLES, maxSeconds: 0, textures: true, programs: true }).scene);
    const rt = await loadRt();
    const { image, passes } = renderWithPasses(rt, rsb, W, H, SAMPLES, 8);
    const rgba = exactBytes(image.sum, SAMPLES, state.image.exposureEv, tonemapFor(state.image.viewTransform));
    return { rgba, part: passes.partId! };
  }

  /** The two pictures of `key` and the engine's control, and the measures of the comparison. */
  async function compare(key: string) {
    const got = (await page.evaluate(([k, w, h]) => window.runGraph!(k, w, h), [key, W, H] as const)) as { rgba: number[]; part: number[]; tries: number };
    expect(got.tries, `${key}: the preview baked and drew the graph`).toBeGreaterThan(0);
    const fast: Picture = { rgba: got.rgba, part: got.part };
    const engine = await full(key, false);
    dump(`${key}-fast`, fast.rgba);
    dump(`${key}-full`, engine.rgba);
    const mask = maskOf(fast, engine);
    const pixels = mask.reduce((a, b) => a + b, 0);
    const tf = meanColour(fast, mask);
    const te = meanColour(engine, mask);
    const gap = Math.max(...tf.map((v, c) => Math.abs(v - te[c])));
    const tone = { pixels, fast: tf.map(Math.round), full: te.map(Math.round), gap: Math.round(gap) };
    if (key === PLAIN) return { ...tone, share: 0, count: 0, control: 0, corr: 0, corrControl: 0 };
    const moved = await full(key, true);
    dump(`${key}-control`, moved.rgba);
    const bf = blurred(fast);
    const be = blurred(engine);
    const bm = blurred(moved);
    const cf = classes(bf, mask);
    const { share, count } = agreement(cf, classes(be, mask));
    const control = agreement(cf, classes(bm, mask));
    return { ...tone, share, count, control: control.share, corr: correlation(bf, be, mask), corrControl: correlation(bf, bm, mask) };
  }

  it('the plain material (the baseline): the two renderers\' own difference of tone', async () => {
    const r = await compare(PLAIN);
    results[PLAIN] = r;
    console.log(PLAIN, JSON.stringify(r));
    expect(r.pixels, 'the part fills the frame').toBeGreaterThan(3000);
    expect(r.gap, 'tone').toBeLessThan(40);
  }, 600000);

  for (const key of GRAPH_KEYS) {
    it(`${key}: the pattern falls where Fast draws it, in its tone`, async () => {
      const r = await compare(key);
      results[key] = r;
      console.log(key, JSON.stringify(r));
      expect(r.pixels, `${key}: the part fills the frame`).toBeGreaterThan(3000);
      // The tone: the mean colour of the part within 40 of 255 on every channel (lights and tone curves differ).
      expect(r.gap, `${key}: tone`).toBeLessThan(40);
      if (PLACED.includes(key)) {
        // The pattern in place and in the same tone (C1: not inverted), and none with the control.
        expect(r.corr, `${key}: correlation`).toBeGreaterThan(0.75);
        expect(Math.abs(r.corrControl), `${key}: the control`).toBeLessThan(0.3);
        return;
      }
      if (PATTERNED.includes(key)) {
        expect(r.count, `${key}: settled pixels`).toBeGreaterThan(500);
        expect(r.share, `${key}: agreement`).toBeGreaterThan(0.85);
        expect(r.corr, `${key}: correlation`).toBeGreaterThan(0.75);
        expect(r.control, `${key}: the control`).toBeLessThan(r.share - 0.2);
      }
    }, 600000);
  }
});
