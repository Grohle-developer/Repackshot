// The pick through a traced lens's profile (phase O2, the triage's 1.8): the Fast viewport draws a traced lens's
// distortion as a screen pass (render/lens-profile.ts), and a click must land on what is drawn under the cursor. In a
// real browser (headless Chromium, SwiftShader) the preview engine draws a wall of boxes in three colours through the
// profile, the canvas is read back, and every pixel whose colour is sure is picked: the part found must be the one
// whose colour is drawn there, under a strong barrel and (with the real rt.wasm) the catalogue's fisheye; with the thin
// lens, or before the engine has told the numbers, the pick is the undistorted one. The outline of a selected box, the
// selection by box, the faces' id pass and the gizmo follow what is drawn too. Skipped where there is no Chromium.

import { existsSync, readdirSync } from 'node:fs';
import { chromium, type Browser } from 'playwright-core';
import { createServer, type ViteDevServer } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeCamera } from '../src/core/camera';
import { OPTICS_NEUTRAL } from '../src/core/optics';
import { newTracedLens } from '../src/core/traced-lens';
import { lensInfoRsb } from '../src/io/rsb';
import { hasLensInfoExport, readLensInfo } from '../src/render/lens-info';
import type { LensPickResult } from './browser/lens-pick-page';
import { loadRt, RT_WASM } from './wasm-engine';

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

/** A strong barrel at 24 mm on a 36 × 24 mm frame: −20 % at the corner, growing with the square of the height. */
const BARREL = JSON.stringify({
  traced: true,
  eflMm: 24,
  bflMm: 38,
  eflFocusedMm: 24,
  imageScaleMm: 24,
  fNumber: 2.8,
  fNumberMin: 2.8,
  tStop: 3,
  transmittance: [0.9, 0.9, 0.9],
  lengthMm: 60,
  entrancePupilMm: [20, 8],
  elements: 9,
  groups: 7,
  sensorMm: 43.27,
  squeeze: 1,
  distortion: [5.4, 10.8, 16.2, 21.6].map((h) => [h, -20 * (h / 21.6) ** 2]),
  relativeIllumination: [
    [0, 1],
    [21.6, 0.75],
  ],
});

describe.skipIf(!executablePath)('the pick through a traced lens’s profile, in a browser', () => {
  let server: ViteDevServer;
  let browser: Browser;
  let result: LensPickResult;

  beforeAll(async () => {
    const infos: Record<string, string> = { barrel: BARREL };
    // The catalogue's fisheye as the engine tells it at 24 mm, with the real rt.wasm.
    if (RT_WASM) {
      const rt = await loadRt();
      if (hasLensInfoExport(rt)) {
        const cam = { ...makeCamera('cam1', '', 360), optics: { ...OPTICS_NEUTRAL, traced: newTracedLens('fisheye_180') }, focalMm: 24, fstop: 0, focusDistance: 360 };
        const info = readLensInfo(rt, lensInfoRsb(cam, W, H));
        if (info) infos.fisheye = JSON.stringify({ traced: true, ...info, section: null });
      }
    }
    server = await createServer({ configFile: false, logLevel: 'error', server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false } });
    await server.listen();
    const url = server.resolvedUrls?.local[0];
    if (!url) throw new Error('the test server has no address');
    browser = await chromium.launch({ executablePath: executablePath!, headless: true, args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`${url}tests/browser/lens-pick.html`);
    await page.waitForFunction(() => window.lensPickReady === true, null, { timeout: 120000 });
    result = (await page.evaluate(([w, h, i]) => window.runLensPick!(w, h, i), [W, H, infos] as const)) as LensPickResult;
    expect(errors).toEqual([]);
  }, 300000);

  afterAll(async () => {
    await browser?.close();
    await server?.close();
  });

  /** Pixels whose sure class differs between two pictures. */
  const moved = (a: string, b: string) => [...a].filter((c, i) => c !== '?' && b[i] !== '?' && c !== b[i]).length;

  it('picks, at every pixel whose colour is sure, the part drawn there through the profile', () => {
    const names = Object.keys(result.profiles);
    expect(names).toContain('barrel');
    if (RT_WASM) expect(names).toContain('fisheye');
    for (const name of names) {
      const { run } = result.profiles[name];
      // The wall fills the frame: most pixels are sure, of the three colours and the black between the boxes.
      expect(run.checked, name).toBeGreaterThan(W * H * 0.4);
      for (const c of ['R', 'G', 'B', 'K']) expect(run.classes.includes(c), `${name} ${c}`).toBe(true);
      // The profile moves what is drawn: many sure pixels show another colour than the undistorted picture, and the
      // undistorted ray (the pick before this fix) would find that other colour at each of them.
      expect(moved(run.classes, result.noInfo.classes), name).toBeGreaterThan(W * H * 0.08);
      expect(run.wrong, `${name}: ${JSON.stringify(run.firstWrong)}`).toBe(0);
    }
  });

  it('is the undistorted pick with the thin lens, and before the engine has told the numbers', () => {
    // The thin lens is drawn as without a profile even with a traced lens's numbers at hand: the same picture.
    expect(moved(result.thin.classes, result.noInfo.classes)).toBe(0);
    for (const run of [result.thin, result.noInfo]) {
      expect(run.checked).toBeGreaterThan(W * H * 0.4);
      expect(run.wrong, JSON.stringify(run.firstWrong)).toBe(0);
    }
  });

  it('draws another camera’s view (Look through) without the active camera’s lens, and picks it straight', () => {
    const { run, moved } = result.lookThrough;
    expect(run.checked).toBeGreaterThan(W * H * 0.4);
    for (const c of ['R', 'G', 'B']) expect(run.classes.includes(c), c).toBe(true);
    expect(moved).toBe(0);
    expect(run.wrong, JSON.stringify(run.firstWrong)).toBe(0);
  });

  it('draws the outline of the selected part round it as the profile draws it', () => {
    for (const [name, p] of Object.entries(result.profiles)) {
      expect(p.outline.ink, name).toBeGreaterThan(40);
      // Nearly every pixel of the line is at the edge of the box as drawn (within two pixels).
      expect(p.outline.near / p.outline.ink, name).toBeGreaterThan(0.95);
    }
  });

  it('selects by box and finds the faces where the part is drawn, not where the undistorted picture has it', () => {
    for (const [name, p] of Object.entries(result.profiles)) {
      expect(p.box, name).toEqual({ mapped: true, unmapped: false });
      expect(p.faces.mapped, name).toBeGreaterThan(0);
      expect(p.faces.unmapped, name).toBe(0);
    }
  });

  it('draws the gizmo through the profile, and finds its handles where they are drawn', () => {
    // Without a profile nearly every pixel the gizmo changes hovers a handle (its antialiased rim may not); through the
    // profile as many: drawn straight while the hover went through the map, or the other way round, about one in four
    // would miss.
    expect(result.gizmo.drawn).toBeGreaterThan(1000);
    expect(result.gizmo.hits / result.gizmo.drawn).toBeGreaterThan(0.9);
    for (const [name, p] of Object.entries(result.profiles)) {
      expect(p.gizmo.drawn, name).toBeGreaterThan(1000);
      expect(p.gizmo.hits / p.gizmo.drawn, name).toBeGreaterThan(0.9);
    }
  });
});
