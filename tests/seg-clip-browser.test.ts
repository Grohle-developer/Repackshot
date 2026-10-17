// A segmented button with an icon and a label (Settings ▸ Render defaults ▸ Folder when done, the render window's
// destination) keeps both on one line: the icon is a block, and the label used to drop under it, cut by the 26 px of
// the button. In a browser (headless Chromium, the app through Vite), no button of a segmented control clips its
// content, in both languages. N2: the render window's footer summary of a 2 x 2 batch (images, passes, ZIP) is shown
// whole, wrapping onto a second line when it must, and no text of the window is clipped. Skipped without Chromium (REPACKSHOT_CHROMIUM, /opt/pw-browsers).

import { existsSync, readdirSync } from 'node:fs';
import { chromium, type Browser } from 'playwright-core';
import { createServer, type ViteDevServer } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { stringIn } from '../src/ui/strings';

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
  // N2: the footer summary of a batch ("... 4 images · 3 passes · ZIP · AI off") came out cut ("... 3 P…").
  for (const lang of ['en', 'es'] as const) {
    for (const width of [1280, 1600]) {
      it(`${lang} at ${width} px: the render window's summary of a 2 × 2 batch is whole, and nothing in the window is clipped`, async () => {
        const context = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: 'reduce' });
        const page = await context.newPage();
        await page.goto(`${url}?lang=${lang}&example=1&tour=0&mode=fast`, { waitUntil: 'load', timeout: 60000 });
        await page.waitForSelector('#app[data-ready="1"]', { timeout: 120000 });
        const palette = async (text: string) => {
          await page.keyboard.press('Control+k');
          await page.waitForSelector('.palette-input');
          await page.keyboard.type(text);
          await page.waitForTimeout(150);
          await page.keyboard.press('Enter');
          await page.waitForTimeout(400);
        };
        await page.locator('canvas[aria-label="viewport"]').focus();
        await palette(stringIn(lang, 'action.saveStudio'));
        await palette(stringIn(lang, 'action.saveStudio'));
        await palette(stringIn(lang, 'action.newCamera'));
        await page.keyboard.press('Control+Enter');
        await page.waitForSelector('.rw');
        await page.locator(`.rw select[aria-label="${stringIn(lang, 'rw.camera')}"]`).selectOption('ALL');
        await page.locator(`.rw select[aria-label="${stringIn(lang, 'rw.studio')}"]`).selectOption('ALL');
        for (const pass of ['alpha', 'depth', 'partId']) await page.locator(`.rw .chip[data-pass="${pass}"]`).click();
        await page.locator(`.rw button[aria-label="${stringIn(lang, 'rw.zipToggle')}"]`).click();
        await page.waitForTimeout(400);
        const seen = await page.evaluate(() => {
          const sum = document.querySelector<HTMLElement>('.rw-summary')!;
          const clipped: string[] = [];
          for (const el of document.querySelectorAll<HTMLElement>('.rw *')) {
            if (el.getClientRects().length === 0) continue;
            const cs = getComputedStyle(el);
            const hides = [cs.overflowX, cs.overflowY].some((o) => o === 'hidden' || o === 'clip');
            if (!hides || !(el.textContent ?? '').trim()) continue;
            if (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1) clipped.push(`${el.className || el.tagName} "${(el.textContent ?? '').trim().slice(0, 40)}": ${el.clientWidth}x${el.clientHeight} < ${el.scrollWidth}x${el.scrollHeight}`);
          }
          const win = document.querySelector<HTMLElement>('.rw')!.getBoundingClientRect();
          const actions = document.querySelector<HTMLElement>('.rw-foot-actions')!.getBoundingClientRect();
          return { text: sum.textContent ?? '', clipped, ellipsis: getComputedStyle(sum).textOverflow, actionsInside: actions.bottom <= win.bottom + 1 && actions.right <= win.right + 1 };
        });
        await context.close();
        expect(seen.text, 'the summary names the batch, the passes and the ZIP').toMatch(/4 (images|imágenes)/);
        expect(seen.text).toMatch(/3 (passes|pases)/);
        expect(seen.text).toContain('ZIP');
        expect(seen.clipped, 'text cut by its box').toEqual([]);
        expect(seen.actionsInside, 'the buttons stay inside the window').toBe(true);
      }, 180000);
    }
  }
});
