// N1, with H1's accessibility pass: the animation drawer in a browser (headless Chromium, the app itself through
// Vite). The presets are buttons inside the items of a list; the tree of what is animated has a name, holds the
// focus and says which row is active (`aria-activedescendant`, ↑ ↓ move it); the ruler, inside the tree, is for the
// pointer and hidden from assistive technology, with no label of its own; a fade drawn over a cut leaves the name of
// the shot after it readable. Skipped without Chromium.

import { existsSync, readdirSync } from 'node:fs';
import { chromium, type Browser, type Page } from 'playwright-core';
import { createServer, type ViteDevServer } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

function findChromium(): string | null {
  const fromEnv = process.env.REPACKSHOT_CHROMIUM;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
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

describe.skipIf(!executablePath)('the animation drawer, for assistive technology', { timeout: 300000 }, () => {
  let server: ViteDevServer;
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    server = await createServer({ configFile: false, logLevel: 'error', server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false } });
    await server.listen();
    const base = server.resolvedUrls?.local[0];
    if (!base) throw new Error('the test server has no address');
    browser = await chromium.launch({ executablePath: executablePath!, headless: true, args: ['--no-sandbox'] });
    page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
    await page.goto(`${base}?lang=en&example=1&tour=0&mode=fast&drawer=animation`, { waitUntil: 'load', timeout: 60000 });
    await page.waitForSelector('#app[data-ready="1"]', { timeout: 120000 });
    await page.waitForSelector('.anim-preset');
  }, 180000);

  afterAll(async () => {
    await browser?.close();
    await server?.close();
  });

  it('the presets are buttons, each inside an item of a named list', async () => {
    const presets = await page.locator('.anim-preset').evaluateAll((els) =>
      els.map((b) => ({ tag: b.tagName, role: b.getAttribute('role'), item: b.parentElement?.getAttribute('role') ?? null, list: b.parentElement?.parentElement?.getAttribute('role') ?? null, name: b.parentElement?.parentElement?.getAttribute('aria-label') ?? null })),
    );
    expect(presets).toHaveLength(16);
    for (const p of presets) expect(p).toEqual({ tag: 'BUTTON', role: null, item: 'listitem', list: 'list', name: 'Presets' });
  });

  it('the tree has a name and the focus; the row it says is active follows the selection and ↑ ↓', async () => {
    await page.locator('.anim-preset[data-preset="HERO"]').click();
    await page.waitForSelector('.atr-clip');
    const tree = page.locator('.anim-rows');
    const attrs = await tree.evaluate((el) => ({ role: el.getAttribute('role'), name: el.getAttribute('aria-label'), tabindex: el.getAttribute('tabindex'), multi: el.getAttribute('aria-multiselectable') }));
    expect(attrs.role).toBe('tree');
    expect(attrs.name).toMatch(/^What is animated · /);
    expect(attrs.tabindex).toBe('0');
    expect(attrs.multi).toBe('true');
    // Every row of the tree is an item with an id the tree can point at, and says whether it is selected.
    const rows = await page.locator('.anim-rows [role="treeitem"]').evaluateAll((els) => els.map((e) => ({ id: e.id, selected: e.getAttribute('aria-selected') })));
    expect(rows.length).toBeGreaterThan(4);
    for (const r of rows) {
      expect(r.id).not.toBe('');
      expect(['true', 'false']).toContain(r.selected);
    }
    await page.locator('.atr-clip').first().click();
    const first = await page.locator('.atr-clip').first().getAttribute('id');
    expect(await tree.getAttribute('aria-activedescendant')).toBe(first);
    expect(await page.evaluate(() => document.activeElement?.classList.contains('anim-rows'))).toBe(true);
    await page.keyboard.press('ArrowDown');
    const second = await page.locator('.atr-clip').nth(1).getAttribute('id');
    expect(await tree.getAttribute('aria-activedescendant')).toBe(second);
    expect(await page.locator(`#${second}`).getAttribute('aria-selected')).toBe('true');
    await page.keyboard.press('ArrowUp');
    expect(await tree.getAttribute('aria-activedescendant')).toBe(first);
  });

  it('the ruler is for the pointer: hidden from assistive technology, with no label of its own', async () => {
    const ruler = await page.locator('.tl-ruler').evaluate((el) => ({ hidden: el.getAttribute('aria-hidden'), label: el.getAttribute('aria-label'), role: el.getAttribute('role'), tip: el.getAttribute('data-tip') }));
    expect(ruler).toEqual({ hidden: 'true', label: null, role: null, tip: 'Ruler: click or drag to move the playhead' });
  });

  it('a fade across a cut leaves the name of the shot after it readable', async () => {
    // The HERO preset has three shots; a fade to black into the second, from its properties.
    await page.locator('.tl-seg[data-shot="1"] .tl-seg-text').click();
    await page.locator('.anim-props .seg button', { hasText: 'Fade to black' }).click();
    await page.waitForSelector('.tl-fade[data-fade="BLACK"]');
    const boxes = await page.evaluate(() => {
      const box = (sel: string) => {
        const r = document.querySelector(sel)!.getBoundingClientRect();
        return { left: r.left, right: r.right };
      };
      return { fade: box('.tl-fade[data-fade="BLACK"]'), text: box('.tl-seg[data-shot="1"] .tl-seg-text'), seg: box('.tl-seg[data-shot="1"]') };
    });
    // The marker straddles the cut; the label of the shot starts after it, still inside its segment.
    expect(boxes.fade.left).toBeLessThan(boxes.seg.left);
    expect(boxes.fade.right).toBeGreaterThan(boxes.seg.left);
    expect(boxes.text.left).toBeGreaterThanOrEqual(boxes.fade.right - 0.5);
    expect(boxes.text.left).toBeLessThan(boxes.seg.right);
  });
});
