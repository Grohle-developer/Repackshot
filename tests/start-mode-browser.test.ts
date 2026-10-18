// The viewport starts in Fast (owner's report of 2026-10-17: "as soon as you open the app it starts rendering, which
// makes no sense when there is not even a model"). Before, the factory setting started in "the last one", and the last mode of a fresh
// install was Full: the engine rendered an empty scene at once. In a browser (headless Chromium, the app through Vite),
// with a stored document that remembers Full and carries the old setting set to Full, the app opens in Fast, in both
// languages. Skipped without Chromium (REPACKSHOT_CHROMIUM, /opt/pw-browsers).

import { existsSync, readdirSync } from 'node:fs';
import { chromium, type Browser } from 'playwright-core';
import { createServer, type ViteDevServer } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

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

describe.skipIf(!executablePath)('the viewport starts in Fast (browser)', () => {
  let server: ViteDevServer;
  let browser: Browser;
  let url = '';

  beforeAll(async () => {
    server = await createServer({ configFile: false, logLevel: 'error', server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false } });
    await server.listen();
    const base = server.resolvedUrls?.local[0];
    if (!base) throw new Error('the test server has no address');
    url = base;
    browser = await chromium.launch({ executablePath: executablePath!, headless: true, args: ['--no-sandbox'] });
  }, 120000);

  afterAll(async () => {
    await browser?.close();
    await server?.close();
  });

  for (const lang of ['en', 'es'] as const) {
    it(`${lang}: a stored Full (remembered, and the old setting) still opens in Fast, with no model`, async () => {
      const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
      // The settings document of a user whose last session ended in Full, with the setting of earlier versions on Full.
      await context.addInitScript(() => {
        const doc = { schema: 1, settings: { 'viewport.startMode': 'FULL' }, layout: { viewportMode: 'FULL' } };
        try {
          localStorage.setItem('repackshot.settings', JSON.stringify(doc));
        } catch {
          // No storage: nothing to seed.
        }
      });
      const page = await context.newPage();
      await page.goto(`${url}?lang=${lang}&tour=0`, { waitUntil: 'load', timeout: 60000 });
      await page.waitForSelector('#app[data-ready="1"]', { timeout: 120000 });
      await page.waitForTimeout(500);
      // The mode asked for, not the one drawn: without rt.wasm the viewport draws Fast whatever is asked.
      expect(await page.getAttribute('#app', 'data-viewport-mode'), `${lang}: the mode the app starts in`).toBe('fast');
      const pressed = await page.$$eval('.hdr-mode .seg:not(.hdr-denoise) button[aria-pressed="true"]', (els) => els.map((e) => (e.textContent ?? '').trim()));
      expect(pressed, `${lang}: the pressed mode button`).toEqual([lang === 'en' ? 'Fast' : 'Rápido']);
      await context.close();
    }, 180000);
  }
});
