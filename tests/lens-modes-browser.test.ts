// The two lens models in a real browser (phase O4; headless Chromium): the real optics of Camera in the inspector
// (tests/browser/lens-modes-page.ts) with the real styles. With the simple lens the Bokeh and the Advanced optics are
// there; with a traced lens they are not there at all, nothing can choose a bokeh (the old switch back to the simple
// lens, the bug the person met), and More options holds the traced lens's tilt and the shift; back to the simple lens,
// its bokeh and Advanced optics are as they were. The dial of the tilt's direction is one undo entry per drag, the plane
// shows while the pointer is on the tilt's rows, and no element of the column clips its content, in English and in
// Spanish. Skipped where there is no Chromium.

import { existsSync, readdirSync } from 'node:fs';
import { chromium, type Browser, type Page } from 'playwright-core';
import { createServer, type ViteDevServer } from 'vite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

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

describe.skipIf(!executablePath)('the simple and the traced lens in the inspector, in a browser', { timeout: 180000 }, () => {
  let server: ViteDevServer;
  let browser: Browser;
  let page: Page;
  let base = '';
  const errors: string[] = [];

  beforeAll(async () => {
    server = await createServer({ configFile: false, logLevel: 'error', server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false } });
    await server.listen();
    const local = server.resolvedUrls?.local[0];
    if (!local) throw new Error('the test server has no address');
    base = `${local}tests/browser/lens-modes.html`;
    browser = await chromium.launch({ executablePath: executablePath!, headless: true, args: ['--no-sandbox'] });
  }, 180000);

  afterAll(async () => {
    await browser?.close();
    await server?.close();
  });

  const open = async (lang: 'en' | 'es' = 'en') => {
    errors.length = 0;
    await page?.close();
    page = await browser.newPage({ viewport: { width: 1300, height: 900 }, reducedMotion: 'reduce', deviceScaleFactor: 1 });
    page.setDefaultTimeout(8000);
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`${base}?lang=${lang}`, { timeout: 120000 });
    await page.waitForSelector('html[data-ready="1"]', { timeout: 120000 });
  };

  beforeEach(async () => {
    await open('en');
  }, 180000);

  const model = () => page.evaluate(() => window.lensTest!.model());
  const visible = (sel: string) => page.locator(sel).first().isVisible();
  const modelButton = (text: string) => page.locator('[aria-label="Lens model"] button', { hasText: text });
  /** Opens every closed disclosure of the column (the sections and More options). */
  const openAll = async () => {
    for (;;) {
      const closed = page.locator('[data-column] .section-head[aria-expanded="false"]:visible');
      if ((await closed.count()) === 0) return;
      await closed.first().click();
    }
  };
  /** Elements of the column that stick out of it or cut their own content (visible ones only). */
  const clipped = () =>
    page.evaluate(() => {
      const col = document.querySelector<HTMLElement>('[data-column]')!;
      const cr = col.getBoundingClientRect();
      const left = cr.left + col.clientLeft + 12 - 1;
      const right = cr.left + col.clientLeft + col.clientWidth - 12 + 1;
      const bad: string[] = [];
      for (const el of col.querySelectorAll<HTMLElement>('*')) {
        if (!(el instanceof HTMLElement) || el.getClientRects().length === 0) continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        const name = `${el.tagName.toLowerCase()}.${el.className}[${(el.textContent ?? '').trim().slice(0, 40)}]`;
        if (r.right > right || r.left < left) bad.push(`outside: ${name} ${Math.round(r.left)}..${Math.round(r.right)}`);
        const st = getComputedStyle(el);
        if ((st.overflowX === 'hidden' || st.overflowX === 'clip' || st.textOverflow === 'ellipsis') && el.scrollWidth > el.clientWidth + 1) bad.push(`cut: ${name} ${el.scrollWidth} > ${el.clientWidth}`);
      }
      return bad;
    });

  it('shows the Bokeh and the Advanced optics with the simple lens, and not at all with a traced lens', async () => {
    expect(await model()).toBe('thin');
    expect(await modelButton('Simple lens').getAttribute('aria-pressed')).toBe('true');
    expect(await visible('[data-optics="cameraBokeh"]')).toBe(true);
    expect(await visible('[data-optics="cameraOptics"]')).toBe(true);
    expect(await visible('[data-lens-traced]')).toBe(false);
    await modelButton('Traced lens').click();
    expect(await model()).toBe('traced');
    expect(await page.locator('[data-optics="cameraBokeh"]').isHidden()).toBe(true);
    expect(await page.locator('[data-optics="cameraOptics"]').isHidden()).toBe(true);
    expect(await page.locator('[data-bokeh]:visible').count()).toBe(0);
    // More options: the traced lens's tilt and the shift, the rest of the iris, the artistic knobs.
    const more = page.locator('[data-action="cameraLensAdvanced"]');
    expect((await more.textContent())?.trim()).toBe('More options');
    await more.click();
    expect(await visible('[data-lens-more] [data-tilt-shift]')).toBe(true);
    expect(await visible('[data-lens-more] [data-tilt-dial]')).toBe(true);
    expect(await visible('[data-lens-more] [aria-label="Horizontal shift"]')).toBe(true);
    expect(await visible('[data-lens-more] [aria-label="Roundness"]')).toBe(true);
    expect(errors).toEqual([]);
  }, 120000);

  it('never takes a traced camera out of its lens by a bokeh, and gives back the simple lens’s settings', async () => {
    // A bokeh and Advanced optics knobs on the simple lens.
    await page.locator('[data-bokeh="bubble"]').click();
    await page.evaluate(() => window.lensTest!.set({ profileParam: 0.4, catsEye: 0.3, tiltDeg: 3, tiltAxisDeg: 20 }));
    const chosen = await page.evaluate(() => window.lensTest!.optics());
    expect(chosen.bokeh).toBe('bubble');
    await modelButton('Traced lens').click();
    // Every way a bokeh could reach the camera goes through the one command: it keeps the lens and says why.
    for (const key of ['cats_eye', 'bubble', 'coma_comet']) expect(await page.evaluate((k) => window.lensTest!.applyBokeh(k), key)).toBe(false);
    expect(await model()).toBe('traced');
    expect(await page.evaluate(() => window.lensTest!.toasts())).toContain('Bokeh is an option of the simple lens: this camera has a traced lens, which makes its own');
    await modelButton('Simple lens').click();
    const back = await page.evaluate(() => window.lensTest!.optics());
    expect({ ...back, traced: undefined }).toEqual({ ...chosen, traced: undefined });
    expect(await page.locator('[data-bokeh="bubble"]').getAttribute('aria-pressed')).toBe('true');
    // The traced lens's own bokeh types are not in the simple lens's grid at all (O4, decided): the rest are.
    for (const key of ['coma_comet', 'focus_breathing', 'variable_sa']) expect(await page.locator(`[data-bokeh="${key}"]`).count()).toBe(0);
    expect(await page.locator('[data-bokeh-grid] [data-bokeh]').count()).toBe(17);
    expect(errors).toEqual([]);
  }, 120000);

  it('turns the direction of the tilt with the dial, one undo entry per drag, and shows the plane meanwhile', async () => {
    await modelButton('Traced lens').click();
    await page.locator('[data-action="cameraLensAdvanced"]').click();
    const amount = page.locator('[data-lens-more] [data-tilt-amount] input[type="range"]');
    await amount.focus();
    for (let i = 0; i < 40; i++) await page.keyboard.press('ArrowRight');
    const tilted = await page.evaluate(() => window.lensTest!.tilt());
    expect(tilted.deg).toBeGreaterThan(0);
    const dial = page.locator('[data-lens-more] [data-tilt-dial]');
    await dial.scrollIntoViewIfNeeded();
    const box = (await dial.boundingBox())!;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await page.mouse.move(cx, cy - 15);
    expect((await page.evaluate(() => window.lensTest!.ui())).focusPlaneHover).toBe(true);
    const before = await page.evaluate(() => window.lensTest!.undos());
    await page.mouse.down();
    await page.mouse.move(cx - 15, cy, { steps: 6 });
    await page.mouse.move(cx, cy + 15, { steps: 6 });
    await page.mouse.up();
    expect(await page.evaluate(() => window.lensTest!.undos())).toBe(before + 1);
    // Dragged to the bottom: the plane runs away downwards (like the ceiling), the amount kept.
    const t = await page.evaluate(() => window.lensTest!.tilt());
    expect(Math.abs(t.deg)).toBeCloseTo(Math.abs(tilted.deg), 6);
    expect(await dial.getAttribute('aria-valuenow')).toBe('270');
    // A preset: one undo entry, and only the traced lens's tilt changed.
    await page.locator('[data-lens-more] [data-recede="0"]').click();
    expect(await page.evaluate(() => window.lensTest!.undos())).toBe(before + 2);
    expect(await dial.getAttribute('aria-valuenow')).toBe('0');
    const o = await page.evaluate(() => window.lensTest!.optics());
    expect([o.tiltDeg, o.tiltAxisDeg]).toEqual([0, 0]);
    // Off the rows and out of their focus: the plane goes.
    await page.mouse.click(20, 20);
    expect((await page.evaluate(() => window.lensTest!.ui())).focusPlaneHover).toBe(false);
    expect(errors).toEqual([]);
  }, 120000);

  for (const lang of ['en', 'es'] as const) {
    it(`clips nothing in either model, every section open (${lang})`, async () => {
      await open(lang);
      await openAll();
      expect(await clipped()).toEqual([]);
      await page.locator('[data-guide="camera-lens"] .seg button').nth(1).click();
      expect(await model()).toBe('traced');
      await openAll();
      expect(await clipped()).toEqual([]);
      expect(errors).toEqual([]);
    }, 150000);
  }
});
