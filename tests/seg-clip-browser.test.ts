// A segmented button with an icon and a label (Settings ▸ Render defaults ▸ Folder when done, the render window's
// destination) keeps both on one line: the icon is a block, and the label used to drop under it, cut by the 26 px of
// the button. In a browser (headless Chromium, the app through Vite), no button of a segmented control clips its
// content, in both languages. Skipped without Chromium (REPACKSHOT_CHROMIUM, /opt/pw-browsers).

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

describe.skipIf(!executablePath)('segmented buttons do not clip their content (browser)', () => {
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
    it(`${lang}: Settings ▸ Render defaults and the render window`, async () => {
      const problems: string[] = [];
      for (const query of ['settings=render.destination', 'render=image']) {
        const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
        const page = await context.newPage();
        await page.goto(`${url}?lang=${lang}&example=1&tour=0&${query}`, { waitUntil: 'load', timeout: 60000 });
        await page.waitForSelector('#app[data-ready="1"]', { timeout: 120000 });
        await page.waitForTimeout(500);
        const seen = await page.evaluate(() =>
          [...document.querySelectorAll<HTMLElement>('.seg button')]
            .filter((b) => b.getClientRects().length > 0)
            .map((b) => ({ text: (b.textContent ?? '').trim(), icon: b.querySelector('.icon') !== null, client: b.clientHeight, scroll: b.scrollHeight })),
        );
        // The row of the bug is there, with its icons.
        if (query.startsWith('settings')) expect(seen.filter((b) => b.icon).length, `${lang}: the destination buttons`).toBeGreaterThanOrEqual(2);
        for (const b of seen) if (b.scroll > b.client + 1) problems.push(`${query} "${b.text}": ${b.client}px < ${b.scroll}px`);
        await context.close();
      }
      expect(problems, `${lang}: segmented buttons whose content is cut`).toEqual([]);
    }, 180000);
  }
});
