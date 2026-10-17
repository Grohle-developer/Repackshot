// H1, accessibility of the real interface in a browser (headless Chromium, the page of the app itself through Vite):
//   - every button without visible text has an accessible name that is a string of src/ui/strings.ts, in both languages
//     (the panels of many states, and the menus and the palette opened by the keyboard);
//   - under prefers-reduced-motion nothing transitions or animates, and no element scrolls smoothly;
//   - the Tab order follows the layout (no positive tabindex, no backward jump inside a column);
//   - the command palette and the menus keep the focus while open and give it back to the button that opened them.
// Skipped without Chromium (REPACKSHOT_CHROMIUM, /opt/pw-browsers). Each state loads the app once: this file is heavy.

import { existsSync, readdirSync } from 'node:fs';
import { chromium, type Browser, type Page } from 'playwright-core';
import { createServer, type ViteDevServer } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { STRINGS } from '../src/ui/strings';

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
type Lang = 'en' | 'es';
const LANGS: Lang[] = ['en', 'es'];

/** The states of the interface the audit opens (the URL parameters of src/ui/url-params.ts, one state each). */
const STATES: { name: string; query: string; steps?: (page: Page) => Promise<void> }[] = [
  { name: 'the default screen', query: '' },
  { name: 'a part selected', query: 'select=cap' },
  { name: 'the material catalogue', query: 'select=cap&catalog=1' },
  { name: 'the animation drawer', query: 'drawer=animation&sequence=HERO&t=2' },
  { name: 'the physics drawer', query: 'drawer=physics' },
  { name: 'the queue drawer', query: 'drawer=queue' },
  { name: 'the render window, image', query: 'render=image' },
  { name: 'the render window, animation', query: 'render=animation' },
  { name: 'Settings', query: 'settings=' },
  { name: 'Settings, engine', query: 'settings=engine.threads' },
  { name: 'the guide', query: 'guide=1' },
  { name: 'the panels collapsed', query: 'panels=collapsed' },
  { name: 'the move tool', query: 'select=cap&tool=move' },
  { name: 'Full mode', query: 'mode=full' },
  {
    name: 'the command palette',
    query: '',
    steps: async (page) => {
      await page.focus('.brand-btn');
      await page.keyboard.press('Control+k');
      await page.waitForSelector('.palette-input');
    },
  },
  {
    name: 'the main menu',
    query: '',
    steps: async (page) => {
      await page.click('.brand-btn');
      await page.waitForSelector('[role=menu]');
    },
  },
  { name: 'the guided tour', query: 'tour=1' },
  {
    name: 'the Doctor',
    query: '',
    steps: async (page) => {
      await page.click('.doctor-btn');
      await page.waitForSelector('.doctor');
    },
  },
  {
    name: 'the material editor',
    query: 'select=cap',
    steps: async (page) => {
      await page.click('[data-material-nodes]');
      await page.waitForSelector('.me');
    },
  },
  {
    name: 'the add-light menu',
    query: 'select=cap',
    steps: async (page) => {
      // The add button lives on the Lights tab of the scene panel (Lights · Luces).
      await page.locator('[role=tab]', { hasText: /^(Lights|Luces)$/ }).first().click();
      await page.click('[data-add="light"]');
      await page.waitForSelector('[role=menu]');
    },
  },
];

/** Every template of strings.ts as a pattern: `{name}` matches any text. Exact strings match themselves. */
function patternsOf(lang: Lang): { exact: Set<string>; templates: RegExp[] } {
  const values = Object.values(STRINGS[lang]);
  const exact = new Set(values.filter((v) => !/\{\w+\}/.test(v)));
  const templates = values
    .filter((v) => /\{\w+\}/.test(v))
    .map((v) => new RegExp(`^${v.split(/\{\w+\}/).map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.+?')}$`));
  return { exact, templates };
}

/** Each visible button that has no text of its own, with the name it exposes (aria-label, or the text of aria-labelledby). */
async function unnamedTextless(page: Page): Promise<{ label: string | null; html: string }[]> {
  return page.evaluate(() => {
    const out: { label: string | null; html: string }[] = [];
    for (const b of document.querySelectorAll('button')) {
      const cs = getComputedStyle(b);
      const r = b.getBoundingClientRect();
      if (!(r.width > 0 && r.height > 0) || cs.visibility === 'hidden' || cs.display === 'none') continue;
      if (b.closest('[aria-hidden="true"]')) continue;
      if ((b.textContent ?? '').trim()) continue;
      const by = b.getAttribute('aria-labelledby');
      const named = by ? by.split(/\s+/).map((id) => document.getElementById(id)?.textContent?.trim() ?? '').join(' ').trim() : null;
      out.push({ label: b.getAttribute('aria-label')?.trim() || named || null, html: b.outerHTML.slice(0, 160) });
    }
    return out;
  });
}

/** The Tab order of the page: the focusable elements in DOM order, with their place on the screen. */
async function tabOrder(page: Page): Promise<{ name: string; x: number; y: number; tabIndex: number }[]> {
  return page.evaluate(() => {
    const sel = 'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],summary,[tabindex]';
    return [...document.querySelectorAll<HTMLElement>(sel)]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && !el.closest('[hidden],[inert]') && el.tabIndex >= 0;
      })
      .map((el) => {
        const r = el.getBoundingClientRect();
        return {
          name: (el.getAttribute('aria-label') || el.textContent || el.tagName).trim().slice(0, 30),
          x: Math.round(r.left),
          y: Math.round(r.top),
          tabIndex: el.tabIndex,
        };
      });
  });
}

const focusedInside = (page: Page, selector: string) => page.evaluate((sel) => document.activeElement?.closest(sel) !== null, selector);

describe.skipIf(!executablePath)('the interface is accessible, in a browser', { timeout: 900000 }, () => {
  let server: ViteDevServer;
  let browser: Browser;
  let url = '';
  const pages: Page[] = [];

  beforeAll(async () => {
    server = await createServer({ configFile: false, logLevel: 'error', server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false } });
    await server.listen();
    const base = server.resolvedUrls?.local[0];
    if (!base) throw new Error('the test server has no address');
    url = base;
    browser = await chromium.launch({ executablePath: executablePath!, headless: true, args: ['--no-sandbox'] });
  }, 120000);

  afterAll(async () => {
    for (const p of pages) await p.close().catch(() => undefined);
    await browser?.close();
    await server?.close();
  });

  async function open(query: string, lang: Lang, reducedMotion: 'reduce' | 'no-preference' = 'no-preference'): Promise<Page> {
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, reducedMotion });
    const page = await context.newPage();
    pages.push(page);
    // The guided tour starts by itself on a first start: the states that do not ask for it switch it off.
    const tour = query.includes('tour=') ? '' : '&tour=0';
    await page.goto(`${url}?lang=${lang}&example=1${tour}${query ? `&${query}` : ''}`, { waitUntil: 'load', timeout: 60000 });
    await page.waitForSelector('#app[data-ready="1"]', { timeout: 120000 });
    await page.waitForTimeout(800);
    return page;
  }

  describe('every button without text has a name from strings.ts, in both languages', () => {
    for (const lang of LANGS) {
      it(`${lang}: the panels, the drawers, the windows, the palette and the menu`, async () => {
        const { exact, templates } = patternsOf(lang);
        const problems: string[] = [];
        let checked = 0;
        for (const state of STATES) {
          const page = await open(state.query, lang);
          if (state.steps) await state.steps(page);
          await page.waitForTimeout(300);
          for (const b of await unnamedTextless(page)) {
            checked++;
            const label = b.label;
            const named = label !== null && (exact.has(label) || templates.some((re) => re.test(label)));
            if (!named) problems.push(`${state.name}: ${JSON.stringify(b.label)} ${b.html}`);
          }
          await page.context().close();
        }
        expect(checked, 'the audit saw buttons').toBeGreaterThan(100);
        expect(problems, `${lang}: buttons whose name is missing or not from strings.ts`).toEqual([]);
      }, 900000);
    }
  });

  it('under prefers-reduced-motion nothing transitions or animates, and nothing scrolls smoothly', async () => {
    const page = await open('', 'en', 'reduce');
    const moving = await page.evaluate(() => {
      const bad: string[] = [];
      for (const el of document.querySelectorAll('*')) {
        for (const pseudo of [null, '::before', '::after'] as const) {
          const s = getComputedStyle(el, pseudo);
          const transitions = s.transitionDuration.split(',').some((d) => parseFloat(d) > 0);
          const animations = s.animationName !== 'none' && s.animationDuration.split(',').some((d) => parseFloat(d) > 0);
          if (transitions || animations || s.scrollBehavior === 'smooth') bad.push(`${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]}${pseudo ?? ''}`);
        }
      }
      return bad;
    });
    expect(moving.slice(0, 10), 'elements that still move').toEqual([]);
    // The check is not empty: without the preference, the chrome does move (its hover and open transitions).
    const normal = await open('', 'en');
    const moves = await normal.evaluate(() => [...document.querySelectorAll('button')].filter((b) => parseFloat(getComputedStyle(b).transitionDuration) > 0).length);
    expect(moves).toBeGreaterThan(0);
  });

  it('the Tab order follows the layout: no positive tabindex, and no backward jump inside a column', async () => {
    for (const query of ['', 'select=cap', 'render=image']) {
      const page = await open(query, 'en');
      const order = await tabOrder(page);
      expect(order.length, `${query || 'default'}: focusable elements`).toBeGreaterThan(30);
      expect(order.filter((e) => e.tabIndex > 0), `${query || 'default'}: positive tabindex`).toEqual([]);
      const backward: string[] = [];
      for (let i = 1; i < order.length; i++) {
        const a = order[i - 1];
        const b = order[i];
        if (b.y < a.y - 40 && Math.abs(b.x - a.x) < 120) backward.push(`${a.name} (${a.x},${a.y}) -> ${b.name} (${b.x},${b.y})`);
      }
      expect(backward.slice(0, 5), `${query || 'default'}: the Tab order goes back up a column`).toEqual([]);
      await page.context().close();
    }
  });

  it('the command palette keeps the focus while it is open, and gives it back when it closes', async () => {
    const page = await open('', 'en');
    await page.focus('.brand-btn');
    await page.keyboard.press('Control+k');
    await page.waitForSelector('.palette-input');
    expect(await focusedInside(page, '.palette'), 'the search field has the focus when the palette opens').toBe(true);
    for (let i = 0; i < 6; i++) await page.keyboard.press('Tab');
    expect(await focusedInside(page, '.palette'), 'Tab does not take the focus out of the palette').toBe(true);
    await page.keyboard.press('Escape');
    await page.waitForSelector('.palette-input', { state: 'detached' });
    expect(await page.evaluate(() => document.activeElement?.classList.contains('brand-btn') ?? false), 'the button that opened it has the focus again').toBe(true);
    await page.context().close();
  });

  it('a window opened from the main menu gives the focus back to the menu button when it closes', async () => {
    const page = await open('', 'en');
    await page.focus('.brand-btn');
    await page.keyboard.press('Enter');
    await page.waitForSelector('[role=menu]');
    await page.locator('[role=menu] button', { hasText: 'Settings' }).first().click();
    await page.waitForSelector('.sw[role=dialog]');
    await page.keyboard.press('Escape');
    await page.waitForSelector('.sw', { state: 'detached' });
    expect(await page.evaluate(() => document.activeElement?.classList.contains('brand-btn') ?? false), 'the menu button has the focus again').toBe(true);
    await page.context().close();
  });

  it('an open menu keeps the focus inside, and Escape gives it back to the button that opened it', async () => {
    const page = await open('', 'en');
    await page.focus('.brand-btn');
    await page.keyboard.press('Enter');
    await page.waitForSelector('[role=menu]');
    for (let i = 0; i < 25; i++) await page.keyboard.press('Tab');
    expect(await focusedInside(page, '[role=menu]'), 'Tab does not take the focus out of the open menu').toBe(true);
    await page.keyboard.press('Escape');
    await page.waitForSelector('[role=menu]', { state: 'detached' });
    expect(await page.evaluate(() => document.activeElement?.classList.contains('brand-btn') ?? false)).toBe(true);
    await page.context().close();
  });

  it('an inline confirmation keeps the focus until it is answered, and gives it back to the control that asked', async () => {
    const context = await browser.newContext({ viewport: { width: 900, height: 600 } });
    const page = await context.newPage();
    pages.push(page);
    await page.goto(`${url}tests/browser/confirm.html`, { waitUntil: 'load', timeout: 60000 });
    await page.waitForFunction(() => window.confirmReady === true, undefined, { timeout: 120000 });
    await page.click('#opener');
    await page.waitForSelector('#host .confirm');
    expect(await focusedInside(page, '#host .confirm'), 'the first answer has the focus').toBe(true);
    for (let i = 0; i < 4; i++) await page.keyboard.press('Tab');
    expect(await focusedInside(page, '#host .confirm'), 'Tab does not take the focus out of the question').toBe(true);
    await page.keyboard.press('Escape');
    await page.waitForSelector('#host .confirm', { state: 'detached' });
    expect(await page.evaluate(() => document.activeElement?.id), 'the control that asked has the focus again').toBe('opener');
    await context.close();
  }, 120000);
});
