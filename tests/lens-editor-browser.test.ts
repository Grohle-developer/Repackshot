// The lens editor in a real browser (phase O2c; headless Chromium): the real window (tests/browser/lens-editor-page.ts)
// on the double Gauss, with the real styles and the page's own rt.wasm answering. Adding an element and turning one
// round change the design's focal length and back focus the engine reports, the section is drawn again (one more
// element, the chosen one stronger), each is one undo entry, an invalid lens says why and cannot be applied, a valid
// one is applied to the camera, and nothing in the window clips its content, in English and in Spanish. Skipped where
// there is no Chromium or no rt.wasm (npm run engine:build).

import { existsSync, readdirSync } from 'node:fs';
import { chromium, type Browser, type Page } from 'playwright-core';
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
const engine = existsSync('public/engine/rt.wasm');

describe.skipIf(!executablePath || !engine)('the lens editor in a browser, with the real engine', { timeout: 240000 }, () => {
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
    base = `${local}tests/browser/lens-editor.html`;
    browser = await chromium.launch({ executablePath: executablePath!, headless: true, args: ['--no-sandbox'] });
  }, 180000);

  afterAll(async () => {
    await browser?.close();
    await server?.close();
  });

  const open = async (lang: 'en' | 'es' = 'en', viewport = { width: 1280, height: 860 }) => {
    errors.length = 0;
    await page?.close();
    page = await browser.newPage({ viewport, reducedMotion: 'reduce', deviceScaleFactor: 1 });
    page.setDefaultTimeout(15000);
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`${base}?lang=${lang}`, { timeout: 120000 });
    await page.waitForSelector('html[data-ready="1"]', { timeout: 120000 });
    await engineSaid();
  };

  /** Waits until the engine has answered for the lens in the editor (its numbers are not stale). */
  const engineSaid = async (after = 0) => {
    await page.waitForFunction(
      (n) => {
        const w = document.querySelector<HTMLElement>('[data-lens-editor]');
        const info = document.querySelector('[data-le-info]');
        return !!w && Number(w.dataset.checks ?? 0) > n && !!info?.querySelector('[data-value="designFocal"]') && !info.hasAttribute('data-stale');
      },
      after,
      { timeout: 30000 },
    );
  };
  const checks = () => page.evaluate(() => Number(document.querySelector<HTMLElement>('[data-lens-editor]')!.dataset.checks ?? 0));
  const value = (key: string) => page.locator(`[data-le-info] [data-value="${key}"]`).textContent();
  const mm = async (key: string) => Number(((await value(key)) ?? '').replace(/[^0-9.,-]/g, ' ').trim().split(/\s+/)[0].replace(',', '.'));
  const section = () =>
    page.evaluate(() => {
      const host = document.querySelector('[data-le-section]')!;
      return { svg: host.innerHTML, glass: host.querySelectorAll('path[data-surface]').length, selected: host.querySelectorAll('path[data-selected]').length, labels: host.querySelectorAll('text[data-label]').length };
    });
  const rows = () => page.locator('[data-le-list] tbody tr').count();
  const undos = () => page.evaluate(() => window.lensEditorTest!.undos());
  /** Elements of the window that stick out of it or cut their own content (visible ones only). */
  const clipped = () =>
    page.evaluate(() => {
      const win = document.querySelector<HTMLElement>('[data-lens-editor]')!;
      const wr = win.getBoundingClientRect();
      const bad: string[] = [];
      if (wr.left < 0 || wr.top < 0 || wr.right > innerWidth || wr.bottom > innerHeight) bad.push(`window outside the page: ${JSON.stringify(wr)}`);
      for (const el of win.querySelectorAll<HTMLElement>('*')) {
        if (!(el instanceof HTMLElement) || el.getClientRects().length === 0) continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        // Inside a scrolling part (the list, the side), what is out of its view is scrolled to, not cut.
        const scroller = el.parentElement?.closest<HTMLElement>('.le-list, .le-side, .le-main');
        const box = scroller ? scroller.getBoundingClientRect() : wr;
        const name = `${el.tagName.toLowerCase()}.${el.className}[${(el.textContent ?? '').trim().slice(0, 40)}]`;
        if (!scroller && (r.right > box.right + 1 || r.left < box.left - 1)) bad.push(`outside: ${name} ${Math.round(r.left)}..${Math.round(r.right)}`);
        const st = getComputedStyle(el);
        if ((st.overflowX === 'hidden' || st.overflowX === 'clip' || st.textOverflow === 'ellipsis') && el.scrollWidth > el.clientWidth + 1) bad.push(`cut: ${name} ${el.scrollWidth} > ${el.clientWidth}`);
      }
      // The title bar and the foot never scroll: everything in them is in view.
      for (const part of win.querySelectorAll<HTMLElement>('.le-titlebar, .le-foot, .le-tools')) if (part.scrollWidth > part.clientWidth + 1) bad.push(`cut: ${part.className} ${part.scrollWidth} > ${part.clientWidth}`);
      return bad;
    });

  it('adds an element and turns one round: the focal length changes, the section is drawn again, one undo entry each', async () => {
    await open('en');
    const focal0 = await mm('designFocal');
    const s0 = await section();
    expect(await rows()).toBe(7);
    expect(s0.glass).toBe(6);
    expect(s0.labels).toBe(6);
    expect(focal0).toBeGreaterThan(95);
    const undo0 = await undos();
    // Add after the first element: a new element, the design's focal length shorter.
    await page.locator('[data-le-row="0"] .le-row-btn').click();
    let n = await checks();
    await page.locator('[data-le-add-after]').click();
    await engineSaid(n);
    expect(await rows()).toBe(8);
    const focal1 = await mm('designFocal');
    expect(focal1).toBeLessThan(focal0 - 1);
    const s1 = await section();
    expect([s1.glass, s1.labels, s1.selected]).toEqual([7, 7, 1]);
    expect(s1.svg).not.toBe(s0.svg);
    expect(await page.locator('[data-le-row="1"]').evaluate((e) => e.classList.contains('is-selected'))).toBe(true);
    expect(await undos()).toBe(undo0 + 1);
    // Turn the front element round: another focal length of the system and another back focus.
    const back1 = await mm('back');
    await page.locator('[data-le-row="0"] .le-row-btn').click();
    n = await checks();
    await page.locator('[data-le-rotate]').click();
    await engineSaid(n);
    const focal2 = await mm('designFocal');
    expect(Math.abs(focal2 - focal1)).toBeGreaterThan(0.05);
    expect(await mm('back')).not.toBe(back1);
    const s2 = await section();
    expect(s2.svg).not.toBe(s1.svg);
    expect(await undos()).toBe(undo0 + 2);
    const draft = await page.evaluate(() => window.lensEditorTest!.draft());
    expect(draft?.edited?.surfaces.length).toBe(13);
    // The camera's lens is still the catalogue's until it is applied.
    expect(await page.evaluate(() => window.lensEditorTest!.lens()?.edited)).toBeUndefined();
    expect(await clipped()).toEqual([]);
    // Undo, twice: the copy as it was, then no copy; the list follows.
    n = await checks();
    await page.evaluate(() => window.lensEditorTest!.undo());
    await engineSaid(n);
    expect(await mm('designFocal')).toBeCloseTo(focal1, 1);
    await page.evaluate(() => window.lensEditorTest!.undo());
    await page.waitForFunction(() => document.querySelectorAll('[data-le-list] tbody tr').length === 7);
    expect(await page.evaluate(() => window.lensEditorTest!.draft())).toBeNull();
    expect(errors).toEqual([]);
  }, 180000);

  it('says why an invalid lens cannot be applied, lets it be edited, and applies a valid one', async () => {
    await open('en');
    const apply = page.locator('[data-le-apply]');
    expect(await apply.isDisabled()).toBe(true);
    // A negative gap after the first element, typed.
    const gap = page.locator('[data-le-row="0"] td').nth(5).locator('.num');
    await gap.dblclick();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('-2');
    await page.keyboard.press('Enter');
    await page.waitForSelector('[data-le-status][data-state="invalid"] [data-problem="gap"]');
    expect(await page.locator('[data-problem="gap"]').textContent()).toContain('Element 1');
    expect(await apply.isDisabled()).toBe(true);
    expect(await page.locator('[data-le-section]').getAttribute('data-stale')).not.toBeNull();
    // Edited again to a valid gap: the engine checks it and it can be applied.
    let n = await checks();
    await gap.dblclick();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('1.5');
    await page.keyboard.press('Enter');
    await engineSaid(n);
    await page.waitForSelector('[data-le-status][data-state="ready"]');
    expect(await apply.isDisabled()).toBe(false);
    // A lens with no real image: the engine's reason, and it can still be edited.
    await page.locator('[data-le-row="0"] .le-row-btn').click();
    n = await checks();
    const front = page.locator('[data-le-row="0"] td').nth(0).locator('.num');
    await front.dblclick();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('-30');
    await page.keyboard.press('Enter');
    await page.waitForFunction((k) => Number(document.querySelector<HTMLElement>('[data-lens-editor]')!.dataset.checks ?? 0) > k, n);
    // The front element now spreads the light more than the rest gathers it: no real image, and the engine says so.
    expect(await page.locator('[data-le-status]').getAttribute('data-state')).toBe('refused');
    expect(await page.locator('[data-le-status] [data-problem="noImage"]').count()).toBe(1);
    expect(await apply.isDisabled()).toBe(true);
    // Undo the radius, apply: the camera has the edited lens, the copy is gone.
    n = await checks();
    await page.evaluate(() => window.lensEditorTest!.undo());
    await engineSaid(n);
    await page.waitForSelector('[data-le-status][data-state="ready"]');
    await apply.click();
    await page.waitForFunction(() => !!window.lensEditorTest!.lens()?.edited && window.lensEditorTest!.draft() === null);
    expect(await page.evaluate(() => window.lensEditorTest!.lens()?.edited?.surfaces[1].d)).toBe(1.5);
    expect(errors).toEqual([]);
  }, 180000);

  it('fits in Spanish and in a smaller window, nothing clipped', async () => {
    await open('es', { width: 1100, height: 720 });
    expect(await page.locator('[data-le-apply]').textContent()).toBe('Aplicar a la cámara');
    await page.locator('[data-le-row="3"] .le-row-btn').click();
    const n = await checks();
    await page.locator('[data-le-add-before]').click();
    await engineSaid(n);
    expect(await clipped()).toEqual([]);
    expect(errors).toEqual([]);
  }, 180000);
});
