// The window of a lens's elements (phase O2b, the triage's 1.4), in a real browser (headless Chromium): the real
// Camera ▸ Lens section on a page with the real styles (tests/browser/lens-peek-page.ts), a lens-information port that
// counts its questions, and the pointer and keyboard of the browser. Resting the pointer on a character chip or on an entry
// of the open lens list opens the window next to it with that lens's drawing, name, source and numbers; the lens
// asked once stays asked; it says so while it waits and when there is no engine; it closes on leave, Escape and
// choosing, never takes the focus or the pointer, opens from the keyboard focus, and stays inside the viewport.
// Skipped where there is no Chromium.

import { existsSync, readdirSync } from 'node:fs';
import { chromium, type Browser, type Page } from 'playwright-core';
import { createServer, type ViteDevServer } from 'vite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PEEK_DELAY_MS } from '../src/ui/lens-peek';

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
const WINDOW = '[data-lens-peek]';
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe.skipIf(!executablePath)('the window of a lens’s elements, in a browser', { timeout: 120000 }, () => {
  let server: ViteDevServer;
  let browser: Browser;
  let page: Page;
  let url = '';
  const errors: string[] = [];

  beforeAll(async () => {
    server = await createServer({ configFile: false, logLevel: 'error', server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false } });
    await server.listen();
    const base = server.resolvedUrls?.local[0];
    if (!base) throw new Error('the test server has no address');
    url = `${base}tests/browser/lens-peek.html`;
    browser = await chromium.launch({ executablePath: executablePath!, headless: true, args: ['--no-sandbox'] });
  }, 120000);

  afterAll(async () => {
    await browser?.close();
    await server?.close();
  });

  beforeEach(async () => {
    errors.length = 0;
    await page?.close();
    page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(url);
    await page.waitForSelector('html[data-ready="1"]', { timeout: 120000 });
  }, 180000);

  const shown = () => page.locator(WINDOW);
  const cards = () => page.$$eval(`${WINDOW} [data-lens-key]`, (els) => els.map((e) => ({ key: e.getAttribute('data-lens-key'), state: e.getAttribute('data-state'), text: e.textContent ?? '', svg: e.querySelector('svg') !== null, paths: e.querySelectorAll('svg path').length, numbers: Object.fromEntries([...e.querySelectorAll('dd')].map((d) => [d.getAttribute('data-value'), d.textContent])), name: e.querySelector('[data-peek="name"]')?.textContent ?? '', source: e.querySelector('[data-peek="source"]')?.textContent ?? '', note: e.querySelector('[data-peek="note"]')?.textContent ?? null })));
  /** Every question the engine was asked: the section’s own for the lens on the camera first, then the window’s. */
  const asked = () => page.evaluate(() => window.peekTest!.asked());
  const OWN = 'double_gauss_normal@50';
  const mode = (m: 'ok' | 'hold' | 'none' | 'refuse' | 'nolink') => page.evaluate((x) => window.peekTest!.setMode(x), m);
  const openList = async () => {
    await page.locator('[data-lens-select]').click();
    await page.waitForSelector('.menu-item[data-value]');
  };
  const entry = (key: string) => page.locator(`.menu-item[data-value="${key}"]`);
  /** Moves the pointer off everything and waits long enough for any window to have closed. */
  const away = async () => {
    await page.mouse.move(40, 400);
    await wait(60);
  };
  const box = async (sel: string) => (await page.locator(sel).first().boundingBox())!;

  it('opens next to a lens of the open list after a rest, with that lens’s drawing, name, source and the engine’s numbers', async () => {
    await openList();
    const t0 = Date.now();
    await entry('symmetric_5').hover();
    // Not at once: the delay keeps a pointer that crosses the list from flashing windows.
    await wait(PEEK_DELAY_MS / 3);
    expect(await shown().count()).toBe(0);
    await shown().waitFor({ timeout: 3000 });
    expect(Date.now() - t0).toBeGreaterThanOrEqual(PEEK_DELAY_MS - 40);
    await page.waitForSelector(`${WINDOW} [data-state="ready"]`);
    const [c] = await cards();
    expect(await cards()).toHaveLength(1);
    expect(c.key).toBe('symmetric_5');
    expect(c.name).toBe('Five-element symmetric');
    expect(c.svg).toBe(true);
    expect(c.paths).toBeGreaterThanOrEqual(1);
    expect(c.source).toMatch(/checked|doubt|second reading|own design/);
    // The numbers are the port's for that lens: the catalogue's fourth entry (elements 3 + 3, groups 2 + 3).
    expect(c.numbers).toMatchObject({ 'camera.lensInfoFocal': '50 mm', 'camera.lensInfoStop': 'f/5.6 · T6.16', 'camera.lensInfoElements': '6 · 5' });
    // Next to the list, at the side of the inspector's column, level with the entry, inside the viewport.
    const w = await box(WINDOW);
    const menu = await box('.menu');
    expect(w.x + w.width).toBeLessThanOrEqual(menu.x);
    expect(Math.abs(w.y - ((await entry('symmetric_5').boundingBox())!.y - 6))).toBeLessThan(40);
    expect(w.x).toBeGreaterThanOrEqual(0);
    expect(w.y).toBeGreaterThanOrEqual(0);
    expect(w.y + w.height).toBeLessThanOrEqual(900);
    // It is asked of the engine for that lens, on the camera as it is.
    expect(await asked()).toEqual([OWN, 'symmetric_5@50']);
    expect(errors).toEqual([]);
  });

  it('follows the pointer from entry to entry, and asks the engine once for each lens', async () => {
    await openList();
    await entry('symmetric_5').hover();
    await page.waitForSelector(`${WINDOW} [data-lens-key="symmetric_5"][data-state="ready"]`);
    await entry('achromat_doublet').hover();
    // Its own window after its own rest: never the previous lens’s beside the new entry.
    expect(await shown().count()).toBe(0);
    await page.waitForSelector(`${WINDOW} [data-lens-key="achromat_doublet"][data-state="ready"]`);
    expect((await cards()).map((c) => c.key)).toEqual(['achromat_doublet']);
    await entry('symmetric_5').hover();
    await page.waitForSelector(`${WINDOW} [data-lens-key="symmetric_5"][data-state="ready"]`);
    await entry('achromat_doublet').hover();
    await page.waitForSelector(`${WINDOW} [data-lens-key="achromat_doublet"][data-state="ready"]`);
    expect(await asked()).toEqual([OWN, 'symmetric_5@50', 'achromat_doublet@50']);
    // The lens on the camera is shown from what the section below the list asked: one question for both.
    await entry('double_gauss_normal').hover();
    await page.waitForSelector(`${WINDOW} [data-lens-key="double_gauss_normal"][data-state="ready"]`);
    expect(await asked()).toEqual([OWN, 'symmetric_5@50', 'achromat_doublet@50']);
  });

  it('asks again only when what the numbers depend on has changed', async () => {
    await openList();
    await entry('symmetric_5').hover();
    await page.waitForSelector(`${WINDOW} [data-state="ready"]`);
    await away();
    await page.evaluate(() => window.peekTest!.setFocal(85));
    // The camera changed under the open list; the list is drawn again.
    await page.keyboard.press('Escape');
    await openList();
    await entry('symmetric_5').hover();
    await page.waitForSelector(`${WINDOW} [data-state="ready"]`);
    expect(await asked()).toEqual([OWN, 'symmetric_5@50', 'double_gauss_normal@85', 'symmetric_5@85']);
    expect((await cards())[0].numbers['camera.lensInfoFocal']).toBe('85 mm');
  });

  it('opens from a character chip with the lenses of that character, each with its own engine numbers', async () => {
    await page.locator('[data-character="wide"]').hover();
    await shown().waitFor({ timeout: 3000 });
    await page.waitForFunction(() => document.querySelectorAll('[data-lens-peek] [data-state="ready"]').length === 2);
    const list = await cards();
    expect(list.map((c) => c.key)).toEqual(['inverted_telephoto_wide', 'fisheye_180']);
    expect(list.map((c) => c.name)).toEqual(['Inverted-telephoto wide-angle', 'Fisheye 180°']);
    expect(list[0].numbers['camera.lensInfoElements']).not.toBe(list[1].numbers['camera.lensInfoElements']);
    expect(list.every((c) => c.svg && c.source !== '')).toBe(true);
    expect(await page.locator(`${WINDOW} [data-peek="heading"]`).textContent()).toBe('Wide');
    // Beside the inspector's column, not over it.
    const w = await box(WINDOW);
    const col = (await page.evaluate(() => document.querySelector('[data-lens-traced]')!.getBoundingClientRect().left))!;
    expect(w.x + w.width).toBeLessThanOrEqual(col);
    expect((await asked()).sort()).toEqual([OWN, 'fisheye_180@50', 'inverted_telephoto_wide@50'].sort());
    // Once asked, a second visit asks nothing.
    await away();
    expect(await shown().count()).toBe(0);
    await page.locator('[data-character="wide"]').hover();
    await page.waitForFunction(() => document.querySelectorAll('[data-lens-peek] [data-state="ready"]').length === 2);
    expect(await asked()).toHaveLength(3);
    // A character with one lens has a window like a lens’s, without the heading.
    await away();
    await page.locator('[data-character="swirl"]').hover();
    await page.waitForSelector(`${WINDOW} [data-lens-key="petzval_portrait"][data-state="ready"]`);
    expect(await page.locator(`${WINDOW} [data-peek="heading"]`).count()).toBe(0);
  });

  it('says it is asking while the engine has not answered, and draws when it has', async () => {
    await mode('hold');
    await openList();
    await entry('symmetric_5').hover();
    await page.waitForSelector(`${WINDOW} [data-state="loading"]`);
    const [c] = await cards();
    expect(c.note).toBe('Asking the engine…');
    expect(c.name).toBe('Five-element symmetric');
    expect(c.source).not.toBe('');
    expect(c.svg).toBe(false);
    expect(c.numbers).toEqual({});
    await page.evaluate(() => window.peekTest!.release());
    await page.waitForSelector(`${WINDOW} [data-state="ready"]`);
    expect((await cards())[0].svg).toBe(true);
    // An answer that arrives after the window closed is not drawn anywhere.
    await mode('hold');
    await entry('achromat_doublet').hover();
    await page.waitForSelector(`${WINDOW} [data-lens-key="achromat_doublet"][data-state="loading"]`);
    await away();
    await page.evaluate(() => window.peekTest!.release());
    await wait(80);
    expect(await shown().count()).toBe(0);
  });

  it('says the engine is not loaded, with the name and the source and no numbers, when there is none', async () => {
    for (const m of ['nolink', 'none'] as const) {
      await page.reload();
      await page.waitForSelector('html[data-ready="1"]');
      await mode(m);
      await page.locator('[data-character="wide"]').hover();
      await page.waitForSelector(`${WINDOW} [data-state="none"]`);
      await page.waitForFunction(() => document.querySelectorAll('[data-lens-peek] [data-state="none"]').length === 2);
      const list = await cards();
      expect(list.map((c) => c.key), m).toEqual(['inverted_telephoto_wide', 'fisheye_180']);
      for (const c of list) {
        expect(c.note, m).toBe('The engine is not loaded: no section or numbers for this lens');
        expect(c.name, m).not.toBe('');
        expect(c.source, m).not.toBe('');
        expect(c.svg, m).toBe(false);
        expect(c.numbers, m).toEqual({});
        expect(c.text, m).not.toMatch(/\d+ mm|f\/\d/);
      }
    }
  });

  it('says when the engine forms no image with the lens', async () => {
    await mode('refuse');
    await openList();
    await entry('symmetric_5').hover();
    await page.waitForSelector(`${WINDOW} [data-state="refused"]`);
    expect((await cards())[0].note).toBe('The engine forms no image with this lens and these settings');
  });

  it('closes when the pointer leaves, and not before', async () => {
    await page.locator('[data-character="swirl"]').hover();
    await shown().waitFor({ timeout: 3000 });
    await page.mouse.move(40, 400);
    await shown().waitFor({ state: 'detached', timeout: 1000 });
    // Crossing the chips opens nothing, and asks nothing.
    await page.reload();
    await page.waitForSelector('html[data-ready="1"]');
    for (const c of ['clinical', 'soft', 'swirl', 'vintage']) {
      await page.locator(`[data-character="${c}"]`).hover();
      await wait(PEEK_DELAY_MS / 4);
    }
    await page.mouse.move(40, 400);
    await wait(PEEK_DELAY_MS + 150);
    expect(await shown().count()).toBe(0);
    expect(await asked()).toEqual([OWN]);
  });

  it('closes on Escape and stays closed until the pointer comes back, without closing anything else', async () => {
    await page.locator('[data-character="swirl"]').hover();
    await shown().waitFor({ timeout: 3000 });
    await page.keyboard.press('Escape');
    expect(await shown().count()).toBe(0);
    await wait(PEEK_DELAY_MS + 150);
    expect(await shown().count()).toBe(0);
    await away();
    await page.locator('[data-character="swirl"]').hover();
    await shown().waitFor({ timeout: 3000 });
    // With the list open, Escape closes the window and the list, and the focus is back on the control.
    await away();
    await openList();
    await entry('symmetric_5').hover();
    await shown().waitFor({ timeout: 3000 });
    await page.keyboard.press('Escape');
    expect(await shown().count()).toBe(0);
    expect(await page.locator('.menu').count()).toBe(0);
    expect(await page.evaluate(() => document.activeElement?.hasAttribute('data-lens-select'))).toBe(true);
  });

  it('closes when the lens is chosen, and the lens is put on the camera', async () => {
    await openList();
    await entry('symmetric_5').hover();
    await shown().waitFor({ timeout: 3000 });
    await entry('symmetric_5').click();
    expect(await shown().count()).toBe(0);
    expect(await page.locator('.menu').count()).toBe(0);
    expect(await page.evaluate(() => window.peekTest!.lens())).toBe('symmetric_5');
    await wait(PEEK_DELAY_MS + 150);
    expect(await shown().count()).toBe(0);
    // A chip pressed filters the list: its window has no more to say.
    await page.locator('[data-character="soft"]').hover();
    await shown().waitFor({ timeout: 3000 });
    await page.locator('[data-character="soft"]').click();
    expect(await shown().count()).toBe(0);
    await wait(PEEK_DELAY_MS + 150);
    expect(await shown().count()).toBe(0);
  });

  it('opens from the keyboard focus, on a chip and on the entries of the list, and chooses with Enter', async () => {
    await page.locator('[data-character="clinical"]').focus();
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => document.activeElement?.getAttribute('data-character'))).toBe('soft');
    await shown().waitFor({ timeout: 3000 });
    await page.waitForFunction(() => document.querySelectorAll('[data-lens-peek] [data-state="ready"]').length === 2);
    expect((await cards()).map((c) => c.key)).toEqual(['double_gauss_fast', 'soft_focus_variable']);
    // Moving the focus away closes it.
    await page.keyboard.press('Tab');
    await shown().waitFor({ state: 'detached', timeout: 1000 });
    // The list: Down opens it with the lens on the camera under the focus, and its window follows the focus.
    await page.locator('[data-lens-select]').focus();
    await page.keyboard.press('ArrowDown');
    await page.waitForSelector('.menu-item[data-value]');
    expect(await page.evaluate(() => document.activeElement?.getAttribute('data-value'))).toBe('double_gauss_normal');
    await page.waitForSelector(`${WINDOW} [data-lens-key="double_gauss_normal"][data-state="ready"]`);
    await page.keyboard.press('ArrowDown');
    expect(await shown().count()).toBe(0);
    await page.waitForSelector(`${WINDOW} [data-lens-key="achromat_doublet"][data-state="ready"]`);
    // The window took no focus and did not stand in the way of the list.
    expect(await page.evaluate(() => document.activeElement?.getAttribute('data-value'))).toBe('achromat_doublet');
    expect(await page.evaluate(() => getComputedStyle(document.querySelector('[data-lens-peek]')!).pointerEvents)).toBe('none');
    await page.keyboard.press('Enter');
    expect(await shown().count()).toBe(0);
    expect(await page.evaluate(() => window.peekTest!.lens())).toBe('achromat_doublet');
  });

  it('never takes the pointer from what is under it: a click through the window reaches the list', async () => {
    await openList();
    await entry('symmetric_5').hover();
    await shown().waitFor({ timeout: 3000 });
    const w = await box(WINDOW);
    const under = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('[data-lens-peek]') !== null, [w.x + w.width / 2, w.y + w.height / 2] as const);
    expect(under).toBe(false);
  });

  it('stays inside a small viewport, with fewer columns where there is no room', async () => {
    for (const [width, height] of [[700, 420], [420, 300], [360, 640]] as const) {
      await page.setViewportSize({ width, height });
      await away();
      await page.locator('[data-character="clinical"]').hover();
      await shown().waitFor({ timeout: 3000 });
      await page.waitForFunction(() => document.querySelectorAll('[data-lens-peek] [data-state="ready"]').length === 4);
      const w = await box(WINDOW);
      const label = `${width}x${height}`;
      expect(w.x, label).toBeGreaterThanOrEqual(0);
      expect(w.y, label).toBeGreaterThanOrEqual(0);
      expect(w.x + w.width, label).toBeLessThanOrEqual(width + 0.5);
      expect(w.y + w.height, label).toBeLessThanOrEqual(height + 0.5);
      await page.mouse.move(2, height - 2);
      await shown().waitFor({ state: 'detached', timeout: 1000 });
    }
  });

  it('has the same wording in Spanish', async () => {
    await page.goto(`${url}?lang=es`);
    await page.waitForSelector('html[data-ready="1"]');
    await mode('hold');
    await page.locator('[data-character="swirl"]').hover();
    await page.waitForSelector(`${WINDOW} [data-state="loading"]`);
    const [c] = await cards();
    expect(c.name).toBe('Petzval de retrato');
    expect(c.note).toBe('Preguntando al motor…');
    expect(await page.locator(WINDOW).getAttribute('aria-label')).toBe('Elementos de la lente');
    await page.evaluate(() => window.peekTest!.release());
    await page.waitForSelector(`${WINDOW} [data-state="ready"]`);
    expect(Object.keys((await cards())[0].numbers)).toHaveLength(4);
    expect(await page.locator(`${WINDOW} dt`).allTextContents()).toEqual(['Focal', 'Diafragma', 'Elementos · grupos', 'Longitud']);
  });
});
