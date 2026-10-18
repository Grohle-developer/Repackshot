// Phase M3d (M3c ◆3): a wood of the family, in Simple mode, shows in the Fast preview what the same wood shows through
// the Wood node: the preview bakes it by the graph Simple → Nodes makes of it (core/material-graph.ts familyBakeGraph,
// render/graph-preview.ts), so the 100 mm sphere of tests/browser/programs-scene.ts in the catalogue's oak (and in the
// knotty pine) draws byte for byte as the same sphere with the material converted to nodes. The control is the family without graph workers, which keeps what Fast drew of it
// before M3d (its mean colour, and its knots): no rings, so its pixels hardly vary within a few pixels. Three.js in
// headless Chromium (SwiftShader), the bakes by the graph workers as in the app (tests/browser/programs-page.ts).
// Skipped without Chromium (REPACKSHOT_CHROMIUM, /opt/pw-browsers); it does not need rt.wasm.
//
// M3e (M3d ◆1, option b): the bake leaves the knots out and E6's layer draws them on top, part by part, where the
// engine puts them (core/knots.ts partKnots: the part's box and its mesh as the surface). On the pine's sphere the
// knots Fast darkens are measured against that list: the pixels where the sphere is darker than the same sphere with
// no knots asked, against the pixels the knots of the list cover (projected through the scene's camera); their
// overlap and the centroid of each knot. Before M3e the knots were the bake's (placed on the parts' box with the box
// as the surface) and fell elsewhere on a round part.
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
import { activeCamera, cameraBasis, cameraPosition, fieldOfView } from '../src/core/camera';
import { partKnots } from '../src/core/knots';
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

/** M3e: the pixels of a W × H picture of the pine's sphere that the knots of `partKnots` cover, and which knot each is. */
function expectedKnots(preset: string): { knot: Int16Array; sphere: Uint8Array; count: number } {
  const state = woodSphereScene('FAMILY', W, H, preset);
  const part = Object.values(state.scene.nodes).find((n) => n.kind === 'PART' && n.name === 'part')!;
  const pk = partKnots(state, part.id, part.material!)!;
  // The preview's camera for a picture of W × H (render/preview.ts placeCamera, without the view's inset).
  const cam = activeCamera(state);
  const eye = cameraPosition(cam);
  const basis = cameraBasis(cam.azimuth, cam.elevation);
  const f = H / (2 * Math.tan(fieldOfView(cam.focalMm, W / H).v / 2));
  const dot = (a: readonly number[], b: readonly number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const project = (p: readonly number[]) => {
    const d = [p[0] - eye[0], p[1] - eye[1], p[2] - eye[2]];
    const z = dot(d, basis.forward);
    return z > 0 ? { x: W / 2 + (f * dot(d, basis.right)) / z, y: H / 2 - (f * dot(d, basis.up)) / z } : null;
  };
  const votes = new Float32Array(W * H * (pk.knots.length + 1));
  const hits = new Float32Array(W * H);
  const sphere = new Uint8Array(W * H);
  const R = 50;
  const C = [0, 0, 50];
  const steps = 900;
  const axes = pk.frame.axes;
  for (let i = 0; i < steps; i++) {
    const phi = (Math.PI * (i + 0.5)) / steps;
    for (let j = 0; j < 2 * steps; j++) {
      const th = (Math.PI * (j + 0.5)) / steps;
      const n = [Math.sin(phi) * Math.cos(th), Math.sin(phi) * Math.sin(th), Math.cos(phi)];
      const p = [C[0] + R * n[0], C[1] + R * n[1], C[2] + R * n[2]];
      // Only the side the camera sees.
      if (n[0] * (eye[0] - p[0]) + n[1] * (eye[1] - p[1]) + n[2] * (eye[2] - p[2]) <= 0) continue;
      const s = project(p);
      if (!s) continue;
      const x = Math.floor(s.x);
      const y = Math.floor(s.y);
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const px = y * W + x;
      hits[px]++;
      // As render/knots.ts: in the wood frame (mm), inside a knot when ahead of its origin and within its radius there.
      const d = [p[0] - pk.frame.origin[0], p[1] - pk.frame.origin[1], p[2] - pk.frame.origin[2]];
      const q = axes.map((a) => (a[0] * d[0] + a[1] * d[1] + a[2] * d[2]) * pk.frame.mm);
      let inside = 0;
      pk.knots.forEach((k, ki) => {
        if (inside) return;
        const rel = [q[0] - k.origin[0], q[1] - k.origin[1], q[2] - k.origin[2]];
        const sAx = rel[0] * k.axis[0] + rel[1] * k.axis[1] + rel[2] * k.axis[2];
        if (sAx <= 0) return;
        const a = rel[0] * k.across[0] + rel[1] * k.across[1] + rel[2] * k.across[2];
        const b = rel[0] * k.flow[0] + rel[1] * k.flow[1] + rel[2] * k.flow[2];
        if (Math.hypot(a, b) < k.radius * (0.5 + (0.5 * sAx) / k.middle)) inside = ki + 1;
      });
      votes[px * (pk.knots.length + 1) + inside]++;
    }
  }
  const knot = new Int16Array(W * H).fill(-1);
  for (let px = 0; px < W * H; px++) {
    if (hits[px] === 0) continue;
    sphere[px] = 1;
    let best = 0;
    for (let k = 1; k <= pk.knots.length; k++) if (votes[px * (pk.knots.length + 1) + k] > votes[px * (pk.knots.length + 1) + best]) best = k;
    if (best > 0 && votes[px * (pk.knots.length + 1) + best] >= hits[px] / 2) knot[px] = best - 1;
  }
  return { knot, sphere, count: pk.knots.length };
}

/**
 * M3e: the sphere's pixels darker than the same sphere with no knots asked by more than 6 of 255 (what Fast darkens as
 * knots: about 20 under the white world, which lifts everything; elsewhere the two are the same pixels).
 */
function measuredKnots(knotty: Picture, knotless: Picture): Uint8Array {
  const out = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) if (knotty.part[i] === 1 && knotless.part[i] === 1 && lum(knotty, i) < lum(knotless, i) - 6) out[i] = 1;
  return out;
}

/** The centroids of the 4-connected blobs of `mask` with at least `least` pixels. */
function blobs(mask: ArrayLike<number>, least: number): { x: number; y: number; n: number }[] {
  const seen = new Uint8Array(W * H);
  const out: { x: number; y: number; n: number }[] = [];
  for (let i = 0; i < W * H; i++) {
    if (!mask[i] || seen[i]) continue;
    const stack = [i];
    seen[i] = 1;
    let n = 0;
    let sx = 0;
    let sy = 0;
    while (stack.length) {
      const j = stack.pop()!;
      n++;
      sx += j % W;
      sy += Math.floor(j / W);
      const x = j % W;
      for (const k of [x > 0 ? j - 1 : -1, x < W - 1 ? j + 1 : -1, j - W, j + W]) {
        if (k < 0 || k >= W * H || !mask[k] || seen[k]) continue;
        seen[k] = 1;
        stack.push(k);
      }
    }
    if (n >= least) out.push({ x: sx / n, y: sy / n, n });
  }
  return out;
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

  // M3e: the knots Fast darkens on the pine's sphere are the ones the engine places (core/knots.ts partKnots), where
  // it places them: the family's and the converted Wood node's alike (the test above: the same pixels).
  it('PINE: the knots in Fast fall where Full puts them (M3e)', async () => {
    const want = expectedKnots('PINE');
    const knotty = await draw('FAMILY', 'PINE');
    const knotless = await draw('FAMILY', 'PINE:KNOTLESS');
    const converted = await draw('CONVERTED', 'PINE');
    // Away from the outline (two pixels in, by the part pass): there the faceted mesh and the round sphere part ways.
    const inner = (i: number) => {
      const x = i % W;
      const y = Math.floor(i / W);
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (knotty.part[(y + dy) * W + x + dx] !== 1) return false;
      return true;
    };
    const got = measuredKnots(knotty, knotless).map((v, i) => (v && inner(i) ? 1 : 0));
    want.knot.forEach((k, i) => {
      if (k >= 0 && !inner(i)) want.knot[i] = -1;
    });
    dump('pine-knotless', knotless.rgba);
    let sphereBoth = 0;
    let sphereEither = 0;
    let both = 0;
    let either = 0;
    for (let i = 0; i < W * H; i++) {
      const a = want.sphere[i] === 1;
      const b = knotty.part[i] === 1;
      if (a && b) sphereBoth++;
      if (a || b) sphereEither++;
      const e = want.knot[i] >= 0;
      if (e && got[i]) both++;
      if (e || got[i]) either++;
    }
    const expectedBlobs = blobs(Array.from(want.knot, (k) => (k >= 0 ? 1 : 0)), 6);
    const measuredBlobs = blobs(got, 6);
    const gaps = expectedBlobs.map((e) => Math.min(...measuredBlobs.map((m) => Math.hypot(m.x - e.x, m.y - e.y)), Infinity));
    const out = {
      sphereOverlap: sphereBoth / sphereEither,
      knots: want.count,
      expectedPixels: Array.from(want.knot).filter((k) => k >= 0).length,
      measuredPixels: got.reduce((a, b) => a + b, 0),
      overlap: either ? both / either : 0,
      expected: expectedBlobs.map((b) => [+b.x.toFixed(1), +b.y.toFixed(1), b.n]),
      measured: measuredBlobs.map((b) => [+b.x.toFixed(1), +b.y.toFixed(1), b.n]),
      gaps: gaps.map((g) => +g.toFixed(2)),
      differingConverted: differing(knotty, converted),
    };
    console.log('M3E_KNOTS', JSON.stringify(out));
    // The projection is the preview's (the sphere's outline where the part pass has it).
    expect(out.sphereOverlap, 'the sphere where the part is').toBeGreaterThan(0.97);
    expect(expectedBlobs.length, 'the engine puts knots on the side the camera sees').toBeGreaterThanOrEqual(2);
    expect(out.overlap, 'the knots Fast darkens are the engine’s').toBeGreaterThan(0.7);
    expect(measuredBlobs.length, 'as many knots').toBe(expectedBlobs.length);
    expect(Math.max(...gaps), 'each knot’s centre within a pixel and a half').toBeLessThan(1.5);
    expect(out.differingConverted, 'the Wood node: the same knots').toBe(0);
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
