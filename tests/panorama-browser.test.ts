// The preview's panoramas (phase K3): in a real browser (headless Chromium, SwiftShader) the preview engine draws a cube
// room of six glowing walls through an equirectangular panorama and a fisheye from six cube faces; at the pixel where the
// page's map (core/panorama.ts) puts each world axis the canvas shows that wall's colour, the same map the engine's
// panorama is checked against with the real rt.wasm (tests/interior-camera.test.ts), and a click there picks that wall.
// Skipped where there is no Chromium.

import { existsSync, readdirSync } from 'node:fs';
import { chromium, type Browser } from 'playwright-core';
import { createServer, type ViteDevServer } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PanoramaResult } from './browser/panorama-page';

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

describe.skipIf(!executablePath)('the preview’s panoramas, in a browser', () => {
  let server: ViteDevServer;
  let browser: Browser;
  let result: PanoramaResult;

  beforeAll(async () => {
    server = await createServer({ configFile: false, logLevel: 'error', server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false } });
    await server.listen();
    const url = server.resolvedUrls?.local[0];
    if (!url) throw new Error('the test server has no address');
    browser = await chromium.launch({ executablePath: executablePath!, headless: true, args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`${url}tests/browser/panorama.html`);
    await page.waitForFunction(() => window.panoramaReady === true, null, { timeout: 120000 });
    result = (await page.evaluate(([w, h]) => window.runPanorama!(w, h), [320, 200] as const)) as PanoramaResult;
    expect(errors).toEqual([]);
  }, 300000);

  afterAll(async () => {
    await browser?.close();
    await server?.close();
  });

  it('shows in six directions of its equirectangular panorama the wall the map says, and picks it', () => {
    for (const r of result.runs.equirectangular) {
      expect(r.got, `${r.key} at ${r.x},${r.y}`).toBe(r.want);
      expect(r.picked, r.key).toBe(`w${r.key}`);
    }
  });

  it('and in five of its fisheye', () => {
    for (const r of result.runs.fisheye) {
      expect(r.got, `${r.key} at ${r.x},${r.y}`).toBe(r.want);
      expect(r.picked, r.key).toBe(`w${r.key}`);
    }
  });

  it('does not draw nor pick a wall hidden to the camera, and still draws the others', () => {
    const [hiddenWall, other] = result.runs.hidden;
    expect(hiddenWall.got, 'the hidden +X wall').toBe('');
    expect(hiddenWall.picked).toBeNull();
    expect(other.got).toBe(other.want);
    expect(other.picked).toBe('w-X');
  });

  it('beyond half a turn from the fisheye’s axis shows black and picks nothing, as the engine does', () => {
    expect(result.fisheyeCorner.inside).toBe(false);
    expect(result.fisheyeCorner.got).toBe('');
    expect(result.fisheyeCorner.picked).toBeNull();
  });
});
