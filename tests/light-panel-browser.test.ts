// Phase L7, the Light section in a browser (headless Chromium, the page of the app itself through Vite), in English and
// Spanish, at 1600×1000 and 1280×800: the Sets and Lights groups with their filters, every thumbnail of one size, the
// size button of the section's header changing it (and the size kept after a reload), the question about the lights
// there are (none over the product type's own lights, untouched: C1), and nothing in the section cut off or out of its column. Skipped without Chromium (REPACKSHOT_CHROMIUM,
// /opt/pw-browsers).

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
const VIEWPORTS = [
  { width: 1600, height: 1000 },
  { width: 1280, height: 800 },
];
const WORDS: Record<Lang, { sets: string; lights: string; replace: string; hide: string; add: string }> = {
  en: { sets: 'Sets', lights: 'Lights', replace: 'Replace', hide: 'Hide', add: 'Add' },
  es: { sets: 'Sets', lights: 'Luces', replace: 'Sustituir', hide: 'Ocultar', add: 'Añadir' },
};

/** What the Light section shows: its thumbnails' picture sizes, and whatever is cut off or out of the section. */
const measure = (page: Page) =>
  page.evaluate(() => {
    const sec = document.querySelector('[data-section="light"]') as HTMLElement;
    const box = sec.getBoundingClientRect();
    const grid = sec.querySelector('.thumbs') as HTMLElement | null;
    const pictures = [...sec.querySelectorAll('.thumbs .thumb img, .thumbs .thumb .thumb-ph')].map((i) => {
      const r = i.getBoundingClientRect();
      return `${Math.round(r.width * 2) / 2}x${Math.round(r.height * 2) / 2}`;
    });
    const problems: string[] = [];
    for (const el of sec.querySelectorAll<HTMLElement>('*')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || el.closest('.tooltip')) continue;
      const name = `${el.tagName.toLowerCase()}.${el.className}${el.textContent ? ` "${el.textContent.trim().slice(0, 30)}"` : ''}`;
      if (r.left < box.left - 0.5 || r.right > box.right + 0.5) problems.push(`out of the column: ${name}`);
      if (el.tagName === 'IMG') continue;
      // Anything that hides what does not fit (a caption, a chip, a button, the question) must fit.
      const hides = (v: string) => v === 'hidden' || v === 'clip' || v === 'auto' || v === 'scroll';
      if ((hides(cs.overflowX) && el.scrollWidth > el.clientWidth + 1) || (hides(cs.overflowY) && el.scrollHeight > el.clientHeight + 1)) problems.push(`cut off: ${name}`);
      if (cs.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 1) problems.push(`ellipsis: ${name}`);
    }
    return {
      pictures,
      sizes: [...new Set(pictures)],
      columns: grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').length : 0,
      group: sec.querySelector('.seg button[aria-pressed="true"]')?.textContent ?? '',
      filters: [...sec.querySelectorAll('[data-light-filters] [data-filter]')].map((r) => r.getAttribute('data-filter')),
      count: sec.querySelector('[data-light-count]')?.textContent ?? '',
      size: sec.querySelector('[data-action="light.thumbSize"]')?.getAttribute('data-size') ?? '',
      sizeLabel: sec.querySelector('[data-action="light.thumbSize"]')?.getAttribute('aria-label') ?? '',
      question: [...sec.querySelectorAll('[data-light-question] .confirm-actions .btn')].map((b) => b.textContent),
      remember: !!sec.querySelector('[data-light-question] .confirm-remember input'),
      problems,
    };
  });

describe.skipIf(!executablePath)('the Light section, in a browser', { timeout: 900000 }, () => {
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

  async function open(lang: Lang, viewport: { width: number; height: number }) {
    const context = await browser.newContext({ viewport, reducedMotion: 'reduce', deviceScaleFactor: 1 });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const go = async () => {
      await page.goto(`${url}?lang=${lang}&example=1&tour=0&mode=fast`, { waitUntil: 'load', timeout: 60000 });
      await page.waitForSelector('#app[data-ready="1"]', { timeout: 120000 });
      await page.waitForSelector('[data-section="light"] .thumbs .thumb', { timeout: 60000 });
      await page.waitForTimeout(300);
    };
    await go();
    return { context, page, errors, reload: go };
  }

  for (const lang of ['en', 'es'] as Lang[]) {
    for (const vp of VIEWPORTS) {
      it(
        `${lang}, ${vp.width}×${vp.height}: Sets and Lights with their filters, one thumbnail size, the size button, the question`,
        async () => {
          const w = WORDS[lang];
          const { context, page, errors, reload } = await open(lang, vp);
          try {
            const sec = page.locator('[data-section="light"]');
            const thumbSize = sec.locator('[data-action="light.thumbSize"]');
            // Sets, at the medium size (the size every setup had).
            let m = await measure(page);
            expect(m.group).toBe(w.sets);
            expect(m.filters).toEqual(['type', 'hero']);
            expect(m.size).toBe('M');
            expect(m.columns).toBe(3);
            expect(m.pictures).toHaveLength(17);
            expect(m.sizes, JSON.stringify(m.sizes)).toHaveLength(1);
            expect(m.problems, m.problems.join('\n')).toEqual([]);
            const medium = m.sizes[0];

            // A filter of each row: they combine; one that leaves nothing says so.
            await sec.locator('[data-filter="hero"] .chip[data-value="BOTTLE"]').click();
            await sec.locator('[data-filter="type"] .chip[data-value="PERFUME"]').click();
            m = await measure(page);
            // Strip and black edge, and the type's own rig (Standard's) kept in view, marked outside the filters.
            expect(m.pictures).toHaveLength(2);
            expect(await sec.locator('.thumb.is-outside').count()).toBe(1);
            await sec.locator('[data-filter="type"] .chip[data-value="FURNITURE_OUT"]').click();
            m = await measure(page);
            expect(m.count).toBe(lang === 'en' ? 'No set matches these filters.' : 'Ningún set cumple estos filtros.');
            await sec.locator('[data-filter="type"] .chip[data-value=""]').click();
            await sec.locator('[data-filter="hero"] .chip[data-value=""]').click();

            // Lights: its style row, every thumbnail the size of the Sets'.
            await sec.locator('.seg button', { hasText: w.lights }).click();
            m = await measure(page);
            expect(m.group).toBe(w.lights);
            expect(m.filters).toEqual(['style']);
            expect(m.pictures).toHaveLength(78);
            expect(m.sizes).toEqual([medium]);
            expect(m.problems, m.problems.join('\n')).toEqual([]);
            await sec.locator('[data-filter="style"] .chip[data-value="INTERIOR"]').click();
            m = await measure(page);
            expect(m.pictures).toHaveLength(7);

            // The size button: large, then small, then medium again; one size at each, nothing cut off.
            await sec.locator('[data-filter="style"] .chip[data-value=""]').click();
            const seen: Record<string, string> = {};
            for (const [want, cols] of [['L', 2], ['S', 4], ['M', 3]] as const) {
              await thumbSize.click();
              for (const g of [w.sets, w.lights]) {
                await sec.locator('.seg button', { hasText: g }).click();
                m = await measure(page);
                expect(m.size).toBe(want);
                expect(m.columns).toBe(cols);
                expect(m.sizes, `${want} ${g}: ${JSON.stringify(m.sizes)}`).toHaveLength(1);
                expect(m.problems, `${want} ${g}:\n${m.problems.join('\n')}`).toEqual([]);
                seen[`${want}${g}`] = m.sizes[0];
              }
              expect(seen[`${want}${w.sets}`]).toBe(seen[`${want}${w.lights}`]);
            }
            const width = (s: string) => Number(s.split('x')[0]);
            expect(width(seen[`L${w.sets}`])).toBeGreaterThan(width(seen[`M${w.sets}`]));
            expect(width(seen[`S${w.sets}`])).toBeLessThan(width(seen[`M${w.sets}`]));
            expect(m.sizeLabel).toMatch(lang === 'en' ? /^Thumbnail size: medium/ : /^Tamaño de las miniaturas: medianas/);

            // The size and the group are kept for this viewer.
            await thumbSize.click();
            await reload();
            m = await measure(page);
            expect(m.size).toBe('L');
            expect(m.group).toBe(w.lights);
            await thumbSize.click();
            await thumbSize.click();

            // C1: over the product type's own lights, untouched (the example as it opens), a setup replaces them
            // without asking.
            await sec.locator('[data-filter="style"] .chip[data-value="TRADITIONAL"]').click();
            await sec.locator('.thumbs .thumb').nth(1).click();
            m = await measure(page);
            expect(m.question).toEqual([]);
            // Over the lights there are now, a setup asks: Replace, Hide, Add (and Cancel), Remember my choice.
            await sec.locator('.thumbs .thumb').nth(2).click();
            m = await measure(page);
            expect(m.question.slice(0, 3)).toEqual([w.replace, w.hide, w.add]);
            expect(m.remember).toBe(true);
            expect(m.problems, m.problems.join('\n')).toEqual([]);
            await sec.locator('[data-light-question] .btn', { hasText: w.add }).click();
            m = await measure(page);
            expect(m.question).toEqual([]);
            expect(errors).toEqual([]);
          } finally {
            await context.close();
          }
        },
        240000,
      );
    }
  }
});
