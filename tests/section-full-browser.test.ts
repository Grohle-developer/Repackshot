// Phase Q1, the region comparison: the cut and its caps land in Full where Fast draws them. The Fast preview (three.js
// in headless Chromium, SwiftShader) and the engine (the real rt.wasm, through the page's own writer) render the same
// scene (tests/browser/section-scene.ts: the example bottle in five flat colours, cut in half through its axis by a
// plane across the camera) from the same camera, and the test compares where the cut and the caps fall: every pixel
// is classed by its hue (the body's red section, the cap's green, the collar's blue, the open base's yellow, the
// label's magenta), and away from the borders of the regions the two pictures must agree on almost every pixel.
// Lighting and shading differ between the two (that is not compared); where the cut is, may not. Two controls move the
// engine's plane (by 15 mm, past the core, and to the other side) and the agreement must collapse; without the caps,
// the cut is no longer one flat surface in either picture. A last comparison puts a floor under the bottle as a piece
// of a set (violet): the studio is not the model, so in both pictures the floor is whole under the cut bottle, and the
// same floor as a plain part (the control) is cut in both.
//
// Skipped without Chromium (REPACKSHOT_CHROMIUM, /opt/pw-browsers) or without rt.wasm (npm run engine:build).

import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { chromium, type Browser } from 'playwright-core';
import { createServer, type ViteDevServer } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { projectScene, writeRsb } from '../src/io/rsb';
import { sectionScene } from './browser/section-scene';
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
const W = 300;
const H = 220;
const SAMPLES = 32;

/** The classes: 1 the body's red, 2 the cap's green, 3 the collar's blue, 4 the base's yellow, 5 the label's magenta, 6 the core's cyan, 7 the floor's violet. */
type Klass = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
const NAMES = ['other', 'body', 'cap', 'collar', 'base', 'label', 'core', 'floor'];
const ALL = [1, 2, 3, 4, 5, 6] as const;

/** Class of a display colour (0..1): by hue, so that the shading of each picture does not matter. */
function klass(r: number, g: number, b: number): Klass {
  const hi = Math.max(r, g, b);
  const lo = Math.min(r, g, b);
  if (hi < 0.1 || (hi - lo) / hi < 0.2) return 0;
  let hue = 0;
  if (hi === r) hue = 60 * (((g - b) / (hi - lo) + 6) % 6);
  else if (hi === g) hue = 60 * ((b - r) / (hi - lo) + 2);
  else hue = 60 * ((r - g) / (hi - lo) + 4);
  if (hue < 20 || hue >= 345) return 1;
  if (hue >= 30 && hue < 75) return 4;
  if (hue >= 90 && hue < 160) return 2;
  if (hue >= 165 && hue < 205) return 6;
  if (hue >= 205 && hue < 250) return 3;
  if (hue >= 250 && hue < 288) return 7;
  if (hue >= 288 && hue < 335) return 5;
  return 0;
}

function classesOf8(rgba: ArrayLike<number>): Uint8Array {
  const out = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) out[i] = klass(rgba[4 * i] / 255, rgba[4 * i + 1] / 255, rgba[4 * i + 2] / 255);
  return out;
}

function classesOfSums(sum: Float32Array, samples: number): Uint8Array {
  const out = new Uint8Array(W * H);
  const enc = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(Math.max(0, v), 1 / 2.4) - 0.055);
  for (let i = 0; i < W * H; i++) out[i] = klass(enc(sum[4 * i] / samples), enc(sum[4 * i + 1] / samples), enc(sum[4 * i + 2] / samples));
  return out;
}

/** Pixels whose 3 × 3 neighbourhood is one class (away from the borders of the regions). */
function settled(c: Uint8Array): Uint8Array {
  const out = new Uint8Array(W * H);
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const k = c[y * W + x];
      let same = true;
      for (let dy = -1; dy <= 1 && same; dy++) for (let dx = -1; dx <= 1 && same; dx++) same = c[(y + dy) * W + x + dx] === k;
      if (same) out[y * W + x] = 1;
    }
  }
  return out;
}

/** Of the pixels settled in both pictures, how many are the same class; `only` limits to pixels of those classes in either. */
function agreement(fast: Uint8Array, full: Uint8Array, only: readonly number[] = ALL): { share: number; count: number } {
  const a = settled(fast);
  const b = settled(full);
  let count = 0;
  let same = 0;
  for (let i = 0; i < W * H; i++) {
    if (!a[i] || !b[i]) continue;
    if (!only.includes(fast[i]) && !only.includes(full[i])) continue;
    count++;
    if (fast[i] === full[i]) same++;
  }
  return { share: count ? same / count : 0, count };
}

/** Intersection over union of the pixels of some classes in the two pictures. */
function overlap(fast: Uint8Array, full: Uint8Array, classes: readonly number[]): { iou: number; union: number } {
  const a = settled(fast);
  const b = settled(full);
  let both = 0;
  let either = 0;
  for (let i = 0; i < W * H; i++) {
    const inA = a[i] && classes.includes(fast[i]);
    const inB = b[i] && classes.includes(full[i]);
    if (inA && inB) both++;
    if (inA || inB) either++;
  }
  return { iou: either ? both / either : 1, union: either };
}

const count = (c: Uint8Array, k: number): number => c.reduce((n, v) => n + (v === k ? 1 : 0), 0);

/** The display luminance of an 8-bit RGBA picture. */
function lumaOf8(rgba: ArrayLike<number>): Float32Array {
  const out = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) out[i] = (0.2126 * rgba[4 * i] + 0.7152 * rgba[4 * i + 1] + 0.0722 * rgba[4 * i + 2]) / 255;
  return out;
}

/** The display luminance of the engine's linear sums of `samples` samples. */
function lumaOfSums(sum: Float32Array, samples: number): Float32Array {
  const out = new Float32Array(W * H);
  const enc = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(Math.max(0, v), 1 / 2.4) - 0.055);
  for (let i = 0; i < W * H; i++) out[i] = enc((0.2126 * sum[4 * i] + 0.7152 * sum[4 * i + 1] + 0.0722 * sum[4 * i + 2]) / samples);
  return out;
}

/**
 * How much the luminance of the middle of the body's cut varies (standard deviation over the mean, over the pixels of the
 * body's class in a block of the picture that the cut fills): a cap is a flat surface facing the camera and is even; the
 * inside of the far wall that an open cut shows is curved, and is not.
 */
function unevenness(luma: Float32Array, c: Uint8Array): number {
  const v: number[] = [];
  for (let y = Math.floor(H * 0.5); y < Math.floor(H * 0.75); y++) {
    for (let x = Math.floor(W * 0.4); x < Math.floor(W * 0.6); x++) if (c[y * W + x] === 1) v.push(luma[y * W + x]);
  }
  const mean = v.reduce((a, b) => a + b, 0) / Math.max(1, v.length);
  return Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, v.length)) / Math.max(1e-6, mean);
}

function writePpm(name: string, body: Uint8Array): void {
  mkdirSync('out', { recursive: true });
  const head = new TextEncoder().encode(`P6\n${W} ${H}\n255\n`);
  const file = new Uint8Array(head.length + body.length);
  file.set(head);
  file.set(body, head.length);
  writeFileSync(`out/q1-regions-${name}.ppm`, file);
}

function dump(name: string, c: Uint8Array): void {
  const colours = [
    [128, 128, 128],
    [230, 40, 40],
    [40, 200, 60],
    [40, 80, 230],
    [230, 200, 40],
    [220, 40, 200],
    [40, 200, 210],
    [150, 60, 230],
  ];
  const body = new Uint8Array(W * H * 3);
  for (let i = 0; i < W * H; i++) body.set(colours[c[i]], 3 * i);
  writePpm(name, body);
}

function dumpRgba(name: string, rgba: ArrayLike<number>): void {
  const body = new Uint8Array(W * H * 3);
  for (let i = 0; i < W * H; i++) body.set([rgba[4 * i], rgba[4 * i + 1], rgba[4 * i + 2]], 3 * i);
  writePpm(name, body);
}

/** The engine's picture (the linear sums of `samples` samples) as a display picture, for the eye. */
function dumpSums(name: string, sum: Float32Array, samples: number): void {
  const enc = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(Math.max(0, v), 1 / 2.4) - 0.055);
  const body = new Uint8Array(W * H * 3);
  for (let i = 0; i < W * H; i++) for (let k = 0; k < 3; k++) body[3 * i + k] = Math.round(255 * Math.min(1, Math.max(0, enc(sum[4 * i + k] / samples))));
  writePpm(name, body);
}

const run = executablePath && RT_WASM ? describe : describe.skip;

run('the cut and its caps land in Full where Fast draws them (Q1, regions)', () => {
  let server: ViteDevServer;
  let browser: Browser;
  let fastCapped: Uint8Array = new Uint8Array(0);
  let fastOpen: Uint8Array = new Uint8Array(0);
  /** The luminance (display, 0..1) of what the preview drew, capped and open. */
  let fastCappedLuma: Float32Array = new Float32Array(0);
  let fastOpenLuma: Float32Array = new Float32Array(0);
  /** The preview's pictures with a floor under the bottle: a piece of a set (whole), and a plain part (cut). */
  let fastStudio: Uint8Array = new Uint8Array(0);
  let fastPlainFloor: Uint8Array = new Uint8Array(0);
  /** What was measured (out/q1-regions.json). */
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
    await page.goto(`${url}tests/browser/section.html`);
    await page.waitForFunction(() => window.sectionReady === true, null, { timeout: 120000 });
    for (const cap of [true, false]) {
      const got = (await page.evaluate(([w, h, c]) => window.runSection!(w, h, c), [W, H, cap] as const)) as { rgba: number[]; tries: number };
      dumpRgba(`fast-${cap ? 'capped' : 'open'}-raw`, got.rgba);
      expect(got.tries, 'the preview settled').toBeGreaterThan(0);
      if (cap) {
        fastCapped = classesOf8(got.rgba);
        fastCappedLuma = lumaOf8(got.rgba);
      } else {
        fastOpen = classesOf8(got.rgba);
        fastOpenLuma = lumaOf8(got.rgba);
      }
    }
    for (const studio of ['whole', 'cut'] as const) {
      const got = (await page.evaluate(([w, h, st]) => window.runSection!(w, h, true, st), [W, H, studio] as const)) as { rgba: number[]; tries: number };
      dumpRgba(`fast-floor-${studio}-raw`, got.rgba);
      expect(got.tries, 'the preview settled').toBeGreaterThan(0);
      if (studio === 'whole') fastStudio = classesOf8(got.rgba);
      else fastPlainFloor = classesOf8(got.rgba);
    }
    expect(errors).toEqual([]);
  }, 300000);

  afterAll(async () => {
    await browser?.close();
    await server?.close();
    mkdirSync('out', { recursive: true });
    writeFileSync('out/q1-regions.json', `${JSON.stringify(results, null, 2)}\n`);
  });

  /** The engine's picture of the scene, as classes (and its luminance, for what needs it). */
  async function fullBoth(opts: Parameters<typeof sectionScene>[2] = {}): Promise<{ classes: Uint8Array; luma: Float32Array; sum: Float32Array }> {
    const state = sectionScene(W, H, opts);
    const rsb = writeRsb(projectScene(state, { width: W, height: H, maxSamples: SAMPLES, maxSeconds: 0, textures: true }).scene);
    const rt = await loadRt();
    const { image } = renderWithPasses(rt, rsb, W, H, SAMPLES, 0);
    return { classes: classesOfSums(image.sum, SAMPLES), luma: lumaOfSums(image.sum, SAMPLES), sum: image.sum };
  }
  const full = async (opts: Parameters<typeof sectionScene>[2] = {}): Promise<Uint8Array> => (await fullBoth(opts)).classes;

  it('the sections of the body, the cap, the collar and the core fall where Fast draws them, and the open parts show their inside', async () => {
    const engine = await full();
    dump('fast-capped', fastCapped);
    dump('full-capped', engine);
    const caps = [1, 2, 3, 6];
    const { share, count: settledCount } = agreement(fastCapped, engine);
    const sections = overlap(fastCapped, engine, caps);
    const perClass = Object.fromEntries(ALL.map((k) => [NAMES[k], { fast: count(fastCapped, k), full: count(engine, k), iou: overlap(fastCapped, engine, [k]).iou }]));
    results.capped = { share, count: settledCount, sectionsIoU: sections.iou, sectionsUnion: sections.union, perClass };
    // The four solids' sections are there, in quantity, in both pictures (the collar's is a ring a few millimetres
    // wide: two small blocks).
    for (const k of caps) {
      const least = k === 3 ? 60 : 300;
      expect(count(fastCapped, k), `fast ${NAMES[k]}`).toBeGreaterThan(least);
      expect(count(engine, k), `full ${NAMES[k]}`).toBeGreaterThan(least);
    }
    // The cut is where the preview draws it: the sections' area overlaps almost entirely, the pixels both pictures
    // settle on agree, and so does each section on its own (the core's disc inside the body's, which only the surface
    // met first after the plane can tell).
    expect(sections.iou).toBeGreaterThan(0.93);
    expect(settledCount).toBeGreaterThan(5000);
    expect(share).toBeGreaterThan(0.95);
    for (const k of [1, 2, 6]) expect(overlap(fastCapped, engine, [k]).iou, NAMES[k]).toBeGreaterThan(0.85);
    // The label (an open band on the camera's side) is on the removed half: it is gone in both.
    expect(count(fastCapped, 5)).toBeLessThan(30);
    expect(count(engine, 5)).toBeLessThan(30);
  }, 300000);

  it('without caps the cut shows the inside of the solids, in both pictures: no longer one flat surface', async () => {
    const capped = await fullBoth();
    const open = await fullBoth({ cap: false });
    dump('fast-open', fastOpen);
    dump('full-open', open.classes);
    // A cap is a flat surface facing the camera: even. Without it the cut shows the curved inside of the far wall: not.
    const u = {
      fast: { capped: unevenness(fastCappedLuma, fastCapped), open: unevenness(fastOpenLuma, fastOpen) },
      full: { capped: unevenness(capped.luma, capped.classes), open: unevenness(open.luma, open.classes) },
    };
    results.uncapped = { unevenness: u, agreementOpen: agreement(fastOpen, open.classes).share };
    expect(u.fast.open).toBeGreaterThan(2 * u.fast.capped);
    expect(u.full.open).toBeGreaterThan(2 * u.full.capped);
    // And where the inside shows, by hue, is where the preview shows it.
    expect(agreement(fastOpen, open.classes).share).toBeGreaterThan(0.9);
  }, 300000);

  it('controls: the engine’s plane moved by 15 mm (past the core), or flipped, no longer agrees with Fast', async () => {
    const moved = await full({ offsetMm: 15 });
    const flipped = await full({ flip: true });
    const m = agreement(fastCapped, moved, [1, 2, 3, 6]);
    const f = agreement(fastCapped, flipped, [1, 2, 3, 6]);
    results.controls = { moved: m.share, flipped: f.share, movedCore: count(moved, 6), flippedCore: count(flipped, 6), fastCore: count(fastCapped, 6) };
    // Moved past the core's radius, the cut misses it: its disc is gone from the engine's picture, and Fast's is not.
    expect(count(moved, 6)).toBeLessThan(30);
    expect(count(fastCapped, 6)).toBeGreaterThan(300);
    expect(overlap(fastCapped, moved, [6]).iou).toBeLessThan(0.1);
    expect(m.share).toBeLessThan(0.9);
    // Flipped, the camera is on the kept side: the whole front shows, no cut at all.
    expect(count(flipped, 6)).toBeLessThan(30);
    expect(f.share).toBeLessThan(0.5);
  }, 300000);

  it('the move gizmo and the box selection take what the cut leaves and not a part it has taken away wholly', async () => {
    const page = await browser.newPage();
    const url = server.resolvedUrls!.local[0];
    await page.goto(`${url}tests/browser/section.html`);
    await page.waitForFunction(() => window.sectionReady === true, null, { timeout: 120000 });
    const got = await page.evaluate(([w, h]) => window.runGizmo!(w, h), [W, H] as const);
    results.gizmo = got;
    await page.close();
    // The label is a band on the camera's side: the plane takes all of it. The body and the cap are cut, not gone.
    expect(got.cut).toEqual({ label: false, body: true, cap: true });
    // Without the section every part has its gizmo.
    expect(got.whole).toEqual({ label: true, body: true, cap: true });
    // The box selection reaches the same parts.
    expect(got.boxCut).toEqual({ label: false, body: true, cap: true });
    expect(got.boxWhole).toEqual({ label: true, body: true, cap: true });
  }, 300000);

  it('the studio is whole under the cut bottle in both pictures, and the same floor as a plain part is cut in both', async () => {
    const wholeBoth = await fullBoth({ studio: 'whole' });
    const plainBoth = await fullBoth({ studio: 'cut' });
    dumpSums('full-floor-whole-raw', wholeBoth.sum, SAMPLES);
    dumpSums('full-floor-cut-raw', plainBoth.sum, SAMPLES);
    const whole = wholeBoth.classes;
    const plain = plainBoth.classes;
    dump('fast-floor-whole', fastStudio);
    dump('full-floor-whole', whole);
    dump('fast-floor-cut', fastPlainFloor);
    dump('full-floor-cut', plain);
    // The rows at the bottom of the frame are the floor near the camera, which the plane (it removes the camera's half)
    // would take if it cut the floor.
    const near = (c: Uint8Array): number => {
      let floor = 0;
      let all = 0;
      for (let y = Math.floor(H * 0.88); y < H; y++) {
        for (let x = 0; x < W; x++) {
          all++;
          if (c[y * W + x] === 7) floor++;
        }
      }
      return floor / all;
    };
    const caps = [1, 2, 3, 6];
    const cutOfModel = agreement(fastStudio, whole, caps);
    results.studio = {
      floorPixels: { fast: count(fastStudio, 7), full: count(whole, 7), fastCut: count(fastPlainFloor, 7), fullCut: count(plain, 7) },
      floorIoU: overlap(fastStudio, whole, [7]).iou,
      floorIoUCut: overlap(fastPlainFloor, plain, [7]).iou,
      nearFloorShare: { fast: near(fastStudio), full: near(whole), fastCut: near(fastPlainFloor), fullCut: near(plain) },
      cutOfModel: { share: cutOfModel.share, sectionsIoU: overlap(fastStudio, whole, caps).iou },
      againstTheControl: overlap(fastStudio, plain, [7]).iou,
    };
    // Whole: the floor fills the bottom of the frame in both, and the two agree on where it is.
    expect(near(fastStudio)).toBeGreaterThan(0.8);
    expect(near(whole)).toBeGreaterThan(0.8);
    expect(overlap(fastStudio, whole, [7]).iou).toBeGreaterThan(0.9);
    // The bottle is cut as before, floor or no floor.
    expect(overlap(fastStudio, whole, caps).iou).toBeGreaterThan(0.9);
    expect(cutOfModel.share).toBeGreaterThan(0.9);
    // The plain part is a part of the model: the plane takes its near half in both, and they agree on that too.
    expect(near(fastPlainFloor)).toBeLessThan(0.05);
    expect(near(plain)).toBeLessThan(0.05);
    expect(overlap(fastPlainFloor, plain, [7]).iou).toBeGreaterThan(0.85);
    // And the two floors are not the same picture (each picture against the other's control).
    expect(overlap(fastStudio, plain, [7]).iou).toBeLessThan(0.7);
    expect(overlap(fastPlainFloor, whole, [7]).iou).toBeLessThan(0.7);
  }, 300000);
});
