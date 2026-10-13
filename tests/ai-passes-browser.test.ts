// The passes of the Fast-mode preview against the engine's rules (phase X4, AI-POST.md §7.4), in a real browser:
// the preview engine draws a scene with known geometry through three.js in headless Chromium (SwiftShader), and the
// same scene is ray cast on the CPU with the engine's camera and the instance and material order of `projectScene`
// (tests/browser/reference-passes.ts). The ids must be the engine's, the depth the distance along the view axis,
// the normals the world-space (Z up) shading normals, the albedo the material's colour, and nothing may be blended
// at an edge. Skipped where there is no Chromium (REPACKSHOT_CHROMIUM, /opt/pw-browsers).
//
// Phase X2: the same planes against the engine's own passes (the real rt.wasm in Node, tests/wasm-engine.ts),
// on the ids and the depth. X3c: the studio floor too, FLOOR_ID in both ids (AI-POST.md §7.4, the lead's
// correction after X4): the three.js passes cast the engine's centre rays at the floor plane, and the floor's
// pixels must agree like any other.

import { existsSync, readdirSync } from 'node:fs';
import { chromium, type Browser } from 'playwright-core';
import { createServer, type ViteDevServer } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cocPass, lensOf } from '../src/core/lens-coc';
import { FLOOR_ID, PASS_KEYS, passMask } from '../src/core/passes';
import { projectScene, writeRsb } from '../src/io/rsb';
import { passScene } from './browser/pass-scene';
import { referencePasses } from './browser/reference-passes';
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
const W = 192;
const H = 108;

interface PageResult {
  passes: Record<string, number[] | number>;
  colourBytes: number;
  ids: { node: string; material: string | null; materialId: number }[];
  again: boolean;
}

describe.skipIf(!executablePath)('the three.js passes against the engine’s scene', () => {
  let server: ViteDevServer;
  let browser: Browser;
  let result: PageResult;

  beforeAll(async () => {
    server = await createServer({ configFile: false, logLevel: 'error', server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false } });
    await server.listen();
    const url = server.resolvedUrls?.local[0];
    if (!url) throw new Error('the test server has no address');
    browser = await chromium.launch({ executablePath: executablePath!, headless: true, args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`${url}tests/browser/passes.html`);
    await page.waitForFunction(() => window.passesReady === true, null, { timeout: 120000 });
    result = (await page.evaluate(([w, h]) => window.runPasses!(w, h), [W, H] as const)) as PageResult;
    expect(errors).toEqual([]);
  }, 300000);

  afterAll(async () => {
    await browser?.close();
    await server?.close();
  });

  const state = passScene(W, H);
  const ref = referencePasses(state, W, H);
  const get = (k: string) => result.passes[k] as number[];
  /** Pixels at or next to a discontinuity of the reference (another instance, another face, a depth jump): where a rasteriser and a ray may differ. */
  const nearEdge = (() => {
    const mask = new Uint8Array(W * H);
    const differs = (a: number, b: number) => {
      if (ref.partId![a] !== ref.partId![b]) return true;
      const n = ref.normal!;
      return n[a * 3] * n[b * 3] + n[a * 3 + 1] * n[b * 3 + 1] + n[a * 3 + 2] * n[b * 3 + 2] < 0.99 || Math.abs(ref.depth![a] - ref.depth![b]) > 8;
    };
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            const yy = y + dy;
            if (xx >= 0 && yy >= 0 && xx < W && yy < H && differs(y * W + x, yy * W + xx)) mask[y * W + x] = 1;
          }
        }
      }
    }
    return mask;
  })();

  it('draws the whole frame and the passes, and a second frame gives the same planes', () => {
    expect(result.colourBytes).toBe(W * H * 4);
    expect(get('partId')).toHaveLength(W * H);
    expect(result.again).toBe(true);
  });

  it('the ids are the engine’s: RSB instance index + 1 and material index + 1, and no pixel is blended', () => {
    const { instances } = projectScene(state, { width: W, height: H, maxSamples: 1, maxSeconds: 0 }).ids;
    // Four parts in the project, one hidden; the second has two materials on its faces; the last shares the first's material.
    expect(instances.map((i) => state.scene.nodes[i.node].name)).toEqual(['turned', 'faces', 'faces', 'twin']);
    expect(instances.map((i) => i.materialId)).toEqual([1, 2, 3, 1]);
    const part = get('partId');
    const material = get('materialId');
    // Only whole ids ever appear (a blended edge would show as a number between two ids); the floor is FLOOR_ID.
    expect([...new Set(part)].every((v) => v === FLOOR_ID || (Number.isInteger(v) && v >= 0 && v <= instances.length))).toBe(true);
    expect([...new Set(material)].every((v) => v === FLOOR_ID || (Number.isInteger(v) && v >= 0 && v <= 3))).toBe(true);
    let wrong = 0;
    let inner = 0;
    for (let i = 0; i < W * H; i++) {
      if (part[i] !== ref.partId![i] || material[i] !== ref.materialId![i]) {
        wrong++;
        if (!nearEdge[i]) inner++;
      }
    }
    expect(inner).toBe(0);
    // Edge pixels may fall either side of a triangle edge, but only a few of them do.
    expect(wrong).toBeLessThan(W * H * 0.01);
    // Every part is seen, the hidden one is not, the floor is there (from this camera it fills the frame up to
    // the top: the horizon is out of view, so there is background only where the reference has some).
    for (const id of [1, 2, 3, 4]) expect(part.includes(id), `instance ${id}`).toBe(true);
    expect(part.includes(0)).toBe(Array.from(ref.partId!).includes(0));
    expect(part.filter((v) => v === FLOOR_ID).length).toBeGreaterThan(1000);
    // Each instance carries the material of its group; the floor's material id is FLOOR_ID too.
    const byInstance = new Map<number, number>();
    for (let i = 0; i < W * H; i++) if (part[i] > 0) byInstance.set(part[i], material[i]);
    expect(byInstance.get(FLOOR_ID)).toBe(FLOOR_ID);
    instances.forEach((inst, k) => expect(byInstance.get(k + 1)).toBe(inst.materialId));
  });

  it('the depth is the distance along the view axis in scene units, +∞ on the background', () => {
    const depth = get('depth');
    let checked = 0;
    for (let i = 0; i < W * H; i++) {
      if (nearEdge[i]) continue;
      const r = ref.depth![i];
      if (!Number.isFinite(r)) {
        expect(depth[i] === null || depth[i] === Infinity || !Number.isFinite(depth[i])).toBe(true);
        continue;
      }
      expect(Math.abs(depth[i] - r)).toBeLessThan(1e-3 * r + 1e-3);
      checked++;
    }
    expect(checked).toBeGreaterThan(1000);
  });

  it('the normals are unit vectors in the world, Z up', () => {
    const normal = get('normal');

    let checked = 0;
    const seen = new Set<string>();
    for (let i = 0; i < W * H; i++) {
      if (nearEdge[i] || !ref.partId![i]) continue;
      const g: [number, number, number] = [normal[i * 3], normal[i * 3 + 1], normal[i * 3 + 2]];
      const r: [number, number, number] = [ref.normal![i * 3], ref.normal![i * 3 + 1], ref.normal![i * 3 + 2]];
      expect(Math.hypot(...g)).toBeCloseTo(1, 4);
      expect(g[0] * r[0] + g[1] * r[1] + g[2] * r[2]).toBeGreaterThan(0.9999);
      seen.add(r.map((v) => v.toFixed(2)).join(','));
      checked++;
    }
    expect(checked).toBeGreaterThan(1000);
    // The tops of the boxes face +Z (Z up), not +Y (three.js's up).
    expect(seen.has('0.00,0.00,1.00')).toBe(true);
  });

  it('the albedo is the material’s base colour on objects and 0 on the background', () => {
    const albedo = get('albedo');
    for (let i = 0; i < W * H; i++) {
      if (nearEdge[i]) continue;
      for (let c = 0; c < 3; c++) expect(Math.abs(albedo[i * 3 + c] - ref.albedo![i * 3 + c])).toBeLessThan(1e-4);
    }
  });

  it.skipIf(!RT_WASM)('agrees with the engine’s passes on the ids and the depth, the studio floor included', async () => {
    const { scene } = projectScene(state, { width: W, height: H, maxSamples: 1, maxSeconds: 0, passes: [...PASS_KEYS] });
    const engine = renderWithPasses(await loadRt(), writeRsb(scene), W, H, 1, passMask([...PASS_KEYS])).passes;
    const part = get('partId');
    const material = get('materialId');
    const depth = get('depth').map((d) => (d === null ? Infinity : d));
    const normal = get('normal');
    let compared = 0;
    let floor = 0;
    let wrong = 0;
    for (let i = 0; i < W * H; i++) {
      if (part[i] !== engine.partId![i] || material[i] !== engine.materialId![i]) {
        wrong++;
        expect(nearEdge[i], `pixel ${i}: three.js ${part[i]}, engine ${engine.partId![i]}`).toBe(1);
        continue;
      }
      if (nearEdge[i]) continue;
      const e = engine.depth![i];
      if (Number.isFinite(e)) expect(Math.abs(depth[i] - e)).toBeLessThan(1e-3 * e + 1e-3);
      else expect(depth[i]).toBe(Infinity);
      if (engine.partId![i] === FLOOR_ID) {
        // The floor: both ids, its normal turned to the camera (above it: +Z).
        expect(engine.materialId![i]).toBe(FLOOR_ID);
        expect([normal[i * 3], normal[i * 3 + 1], normal[i * 3 + 2]]).toEqual([0, 0, 1]);
        expect([engine.normal![i * 3], engine.normal![i * 3 + 1], engine.normal![i * 3 + 2]]).toEqual([0, 0, 1]);
        floor++;
      }
      compared++;
    }
    expect(compared).toBeGreaterThan(5000);
    expect(floor).toBeGreaterThan(1000);
    expect(wrong).toBeLessThan(W * H * 0.01);
  }, 120000);

  it('the circle of confusion follows the thin lens from the depth, 0 at the focus distance', () => {
    const coc = get('coc');
    const lens = lensOf(state.camera.cameras[state.camera.active]);
    expect(lens.fstop).toBe(2.8);
    const expected = cocPass(lens, new Float32Array(get('depth').map((d) => (d === null ? Infinity : d))), W, H);
    let some = 0;
    for (let i = 0; i < W * H; i++) {
      expect(coc[i]).toBeCloseTo(expected[i], 4);
      if (coc[i] > 0.5) some++;
    }
    expect(some).toBeGreaterThan(100);
  });
});
