// U15, the layout of the number fields and the sliders in the real interface (headless Chromium, the app itself
// through Vite), in English and Spanish, at 1600 × 1000 and 1280 × 800: in the main states (the default screen, a part
// selected, an own light selected, the material editor, the animation drawer and a clip's properties, the render
// window in Image (with JPEG and Advanced open) and in Animation, and Settings with every section clicked through),
// no number field and no slider clips its content (its height, its width, the value inside it), every field stays
// one line high, and its step buttons sit inside its frame, at its right end, clear of the value, the unit and the
// label, never cut by a column. Skipped without Chromium (REPACKSHOT_CHROMIUM, /opt/pw-browsers). Heavy: each state
// loads the app once per language and is measured at both sizes.

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
type Lang = 'en' | 'es';
const LANGS: Lang[] = ['en', 'es'];
const SIZES = [
  { width: 1600, height: 1000 },
  { width: 1280, height: 800 },
] as const;

/** Opens every collapsed section of the inspector (and of the render window), so their fields are measured too. */
const openSections = (page: Page) =>
  page.evaluate(() => {
    for (const b of document.querySelectorAll<HTMLElement>('.section-head[aria-expanded="false"]')) b.click();
  });

/** The states measured (the URL parameters of src/ui/url-params.ts, and the clicks a person would make). */
const STATES: { name: string; query: string; steps?: (page: Page) => Promise<void>; settings?: boolean }[] = [
  { name: 'the default screen', query: '' },
  { name: 'a part selected', query: 'select=cap' },
  {
    name: 'an own light selected',
    query: 'select=cap',
    steps: async (page) => {
      await page.locator('[role=tab]', { hasText: /^(Lights|Luces)$/ }).first().click();
      await page.click('[data-add="light"]');
      await page.waitForSelector('[role=menu]');
      await page.locator('[role=menu] button').first().click();
      await page.waitForSelector('[data-field="light"]', { timeout: 30000 });
    },
  },
  {
    name: 'the material editor',
    query: 'select=cap',
    steps: async (page) => {
      await page.click('[data-material-nodes]');
      await page.waitForSelector('.me', { timeout: 30000 });
    },
  },
  {
    name: "the animation drawer, a clip's properties",
    query: 'drawer=animation&sequence=HERO&t=2',
    steps: async (page) => {
      await page.waitForSelector('.atr-clip', { timeout: 30000 });
      await page.locator('.atr-clip').first().click();
      await page.waitForSelector('.anim-props [role="spinbutton"]', { timeout: 30000 });
    },
  },
  {
    name: 'the render window, image, JPEG',
    query: 'render=image',
    steps: async (page) => {
      await page.locator('.rw .seg button', { hasText: /^JPEG$/ }).click();
    },
  },
  { name: 'the render window, animation', query: 'render=animation' },
  { name: 'Settings, every section', query: 'settings=', settings: true },
];

interface Finding {
  kind: 'num' | 'slider';
  name: string;
  where: string;
  problems: string[];
}

/** Every visible number field and slider, with what is wrong with its box (nothing, for a good one). */
function measure(): Finding[] {
  const visible = (e: Element) => {
    const r = e.getBoundingClientRect();
    const cs = getComputedStyle(e);
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
  };
  const where = (e: Element) =>
    e.closest('[data-section]')?.getAttribute('data-section') ?? e.closest('[data-row]')?.getAttribute('data-row') ?? e.closest('[data-field]')?.getAttribute('data-field') ?? (e.closest('.rw, .sw, .me, .bar, .drawer') as HTMLElement | null)?.className.split(' ')[0] ?? '';
  /** The first ancestor that clips horizontally must hold the whole box (a column that cuts a field off). */
  const cutBy = (e: Element) => {
    const r = e.getBoundingClientRect();
    for (let a = e.parentElement; a && a !== document.body; a = a.parentElement) {
      if (getComputedStyle(a).overflowX === 'visible') continue;
      const ar = a.getBoundingClientRect();
      return r.left < ar.left - 1 || r.right > ar.right + 1 ? String(a.className).split(' ')[0] || a.tagName.toLowerCase() : null;
    }
    return null;
  };
  const out: Finding[] = [];
  for (const n of document.querySelectorAll<HTMLElement>('.num')) {
    if (!visible(n)) continue;
    const problems: string[] = [];
    const r = n.getBoundingClientRect();
    if (n.scrollHeight > n.clientHeight + 1) problems.push(`its content is taller than it (${n.scrollHeight} > ${n.clientHeight})`);
    if (n.scrollWidth > n.clientWidth + 1) problems.push(`its content is wider than it (${n.scrollWidth} > ${n.clientWidth})`);
    const value = n.querySelector<HTMLElement>('.num-value');
    if (value && value.scrollWidth > value.clientWidth + 1) problems.push(`the value is cut (${value.scrollWidth} > ${value.clientWidth}: "${value.textContent}")`);
    if (r.height > 28) problems.push(`more than one line high (${r.height})`);
    const steps = n.querySelector('.num-steps');
    const buttons = [...n.querySelectorAll('.num-step')].map((b) => b.getBoundingClientRect());
    if (!steps || buttons.length !== 2) problems.push('no step buttons');
    else {
      const s = steps.getBoundingClientRect();
      if (s.left < r.left - 0.5 || s.right > r.right + 0.5 || s.top < r.top - 0.5 || s.bottom > r.bottom + 0.5) problems.push('the step buttons are outside its frame');
      if (r.right - s.right > 2) problems.push('the step buttons are not at its right end');
      const content = [...n.querySelectorAll('.num-value, .num-unit, .num-label')].map((e) => e.getBoundingClientRect()).filter((b) => b.width > 0);
      const right = Math.max(...content.map((b) => b.right));
      if (s.left < right - 0.5) problems.push(`the step buttons overlap the value, the unit or the label (${s.left} < ${right})`);
      const [up, down] = buttons;
      if (!(up.height >= 8 && down.height >= 8 && up.width >= 8 && up.bottom <= down.top + 0.5)) problems.push('the step buttons are not a stacked pair');
    }
    const cut = cutBy(n);
    if (cut) problems.push(`cut off by .${cut}`);
    out.push({ kind: 'num', name: n.getAttribute('aria-label') ?? '', where: where(n), problems });
  }
  for (const sl of document.querySelectorAll<HTMLElement>('.slider')) {
    if (!visible(sl)) continue;
    const problems: string[] = [];
    if (sl.scrollHeight > sl.clientHeight + 1) problems.push(`its content is taller than it (${sl.scrollHeight} > ${sl.clientHeight})`);
    if (sl.scrollWidth > sl.clientWidth + 1) problems.push(`its content is wider than it (${sl.scrollWidth} > ${sl.clientWidth})`);
    const range = sl.querySelector('input[type=range]');
    const width = range ? range.getBoundingClientRect().width : 0;
    if (width < 48) problems.push(`the track is cramped (${width} px)`);
    const cut = cutBy(sl);
    if (cut) problems.push(`cut off by .${cut}`);
    out.push({ kind: 'slider', name: range?.getAttribute('aria-label') ?? '', where: where(sl), problems });
  }
  return out;
}

describe.skipIf(!executablePath)('number fields and sliders fit, with their step buttons, in a browser', { timeout: 1500000 }, () => {
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

  for (const lang of LANGS) {
    it(`${lang}: in every state, at 1600 × 1000 and 1280 × 800, nothing is clipped and the step buttons sit inside`, async () => {
      const problems: string[] = [];
      const seen = { num: 0, slider: 0, states: 0 };
      for (const state of STATES) {
        const context = await browser.newContext({ viewport: SIZES[0], reducedMotion: 'reduce' });
        const page = await context.newPage();
        try {
          await page.goto(`${url}?lang=${lang}&example=1&tour=0${state.query ? `&${state.query}` : ''}`, { waitUntil: 'load', timeout: 90000 });
          await page.waitForSelector('#app[data-ready="1"]', { timeout: 180000 });
          await page.waitForTimeout(600);
          if (state.steps) await state.steps(page);
          await openSections(page);
          await page.waitForTimeout(300);
          const sections = state.settings ? await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.sw-option[data-section]')].map((o) => o.dataset.section!)) : [null];
          if (state.settings) expect(sections.length, 'Settings has its sections').toBeGreaterThan(6);
          for (const size of SIZES) {
            await page.setViewportSize(size);
            await page.waitForTimeout(300);
            for (const section of sections) {
              if (section) {
                await page.click(`.sw-option[data-section="${section}"]`, { timeout: 30000 });
                await page.waitForTimeout(200);
              }
              const found = await page.evaluate(measure);
              seen.states++;
              for (const f of found) {
                seen[f.kind]++;
                for (const p of f.problems) problems.push(`${state.name}${section ? ` ▸ ${section}` : ''} at ${size.width} × ${size.height}: ${f.kind} "${f.name}" (${f.where}) ${p}`);
              }
            }
          }
        } finally {
          await context.close();
        }
      }
      // The check is not empty: it measured fields and sliders in every state.
      expect(seen.num, 'number fields measured').toBeGreaterThan(400);
      expect(seen.slider, 'sliders measured').toBeGreaterThan(100);
      expect([...new Set(problems)].slice(0, 30), `${lang}: number fields or sliders that clip, grow or misplace their step buttons`).toEqual([]);
    }, 1500000);
  }
});
