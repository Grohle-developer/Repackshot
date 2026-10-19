// Phase U16 in the real interface (headless Chromium, the app itself through Vite), the parts of ROADMAP U16 that live
// in the DOM: the part inspector's Physics section in two groups, Motion (the role, its line, the fields of each role)
// and Weather (Gets wet, Gets dust and snow, Surface and the size its drops run at), a multi-selection's mixed values as
// indeterminate and one undo step for all its parts, the note when no effect falls on the parts and its button, the
// pointer of the Material section, the effect's On the parts right after its Shape with its new help, and the physics
// drawer's line of what Start simulates.
//
// Each check names in a comment the mutation it was checked to fail on (rule 3). Skipped without Chromium
// (REPACKSHOT_CHROMIUM, /opt/pw-browsers).

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

/** What the Physics section of the inspector shows. */
function physicsView(page: Page) {
  return page.evaluate(() => {
    const sec = document.querySelector('.side-right [data-section="physics"]');
    const shown = (el: Element | null | undefined) => !!el && (el as HTMLElement).offsetParent !== null;
    const q = (sel: string) => sec?.querySelector(sel) ?? null;
    const groups = [...(sec?.querySelectorAll('[data-phys-group]') ?? [])].map((g) => g.getAttribute('data-phys-group'));
    const surface = q('[data-field="phys.surface"]') as HTMLSelectElement | null;
    const note = q('[data-field="phys.noWeather"]');
    return {
      collapsed: sec?.hasAttribute('data-collapsed') ?? null,
      groups,
      roleLine: q('[data-field="phys.roleLine"]')?.textContent ?? null,
      density: shown(q('[data-field="phys.density"]')),
      friction: shown(q('[data-field="phys.friction"]')),
      bounciness: shown(q('[data-field="phys.bounciness"]')),
      drop: shown(q('[data-action="phys.drop"]')),
      wet: q('[data-field="phys.getsWet"]')?.getAttribute('aria-checked') ?? null,
      dust: q('[data-field="phys.getsDust"]')?.getAttribute('aria-checked') ?? null,
      surface: surface?.value ?? null,
      surfaceText: surface ? surface.options[surface.selectedIndex]?.textContent ?? null : null,
      autoText: surface?.querySelector('option[value="AUTO"]')?.textContent ?? null,
      options: surface ? [...surface.options].filter((o) => !o.hidden).map((o) => o.value) : [],
      runSize: q('[data-field="phys.runSize"]')?.textContent ?? null,
      note: shown(note) ? note!.querySelector('p')?.textContent ?? null : null,
      noteButton: shown(note) ? note!.querySelector('button')?.textContent ?? null : null,
      pointer: document.querySelector('.side-right [data-action="phys.pointer"]')?.textContent ?? null,
      undo: document.querySelector('.hdr button[aria-label="Undo"]')?.getAttribute('data-tip') ?? null,
    };
  });
}

describe.skipIf(!executablePath)('U16: the physics of each part in one place, in a browser', { timeout: 600000 }, () => {
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

  async function open(query: string): Promise<Page> {
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
    const page = await context.newPage();
    await page.goto(`${url}?lang=en&example=1&tour=0&mode=fast&${query}`, { waitUntil: 'load', timeout: 60000 });
    await page.waitForSelector('#app[data-ready="1"]', { timeout: 120000 });
    await page.waitForTimeout(400);
    return page;
  }

  const settle = (page: Page, ms = 80) => page.evaluate((wait) => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, wait)))), ms);

  async function selectRows(page: Page, names: string[]): Promise<void> {
    for (const [i, name] of names.entries()) {
      const row = page.locator('.tree-row', { has: page.locator('.tree-name', { hasText: new RegExp(`^${name}$`) }) }).first();
      if (i > 0) await page.keyboard.down('Control');
      await row.click();
      if (i > 0) await page.keyboard.up('Control');
      await settle(page);
    }
  }

  it('the four roles fit in the inspector, in English and in Spanish (none is clipped)', async () => {
    // Mutation checked: the role back beside its label (field without `wide`) clips the last role in both languages.
    for (const lang of ['en', 'es']) {
      const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
      const page = await context.newPage();
      await page.goto(`${url}?lang=${lang}&example=1&tour=0&mode=fast&select=body`, { waitUntil: 'load', timeout: 60000 });
      await page.waitForSelector('#app[data-ready="1"]', { timeout: 120000 });
      await settle(page, 300);
      const clipped = await page.evaluate(() => {
        const seg = document.querySelector('.side-right [data-field="phys.role"]') as HTMLElement | null;
        if (!seg) return ['no role control'];
        // The control may run past its own row: what counts is the section the person sees.
        const section = seg.closest('[data-section="physics"]') as HTMLElement | null;
        const box = (section ?? seg).getBoundingClientRect();
        return [...seg.querySelectorAll('button')]
          .filter((b) => {
            const r = b.getBoundingClientRect();
            return r.right > box.right + 0.5 || r.left < box.left - 0.5 || b.scrollWidth > b.clientWidth + 0.5;
          })
          .map((b) => b.textContent ?? '');
      });
      expect(clipped, lang).toEqual([]);
      await context.close();
    }
  });

  it('Motion and Weather on a part; each role shows its fields; the switches, the surface and the note', async () => {
    const page = await open('select=body');
    let v = await physicsView(page);
    // Mutation checked: the Weather group left out of physicsSection fails the groups.
    expect(v.groups).toEqual(['motion', 'weather']);
    // Static: friction and bounciness (S2 uses a static part's), not density or Drop. Mutation checked: the fields
    // shown for every role fails `density`.
    expect(v.roleLine).toBe('Stays where it is: things fall onto it and the weather settles on it');
    expect([v.density, v.friction, v.bounciness, v.drop]).toEqual([false, true, true, false]);
    // Weather, at its defaults: on, on, the material's family named.
    expect([v.wet, v.dust, v.surface]).toEqual(['true', 'true', 'AUTO']);
    expect(v.autoText).toMatch(/^From the material \((Metal|Paint)\)$/);
    expect(v.options).toEqual(['AUTO', 'GLASS', 'PLASTIC', 'METAL', 'PAPER', 'PAINT', 'WOOD', 'FABRIC', 'WATER_REPELLENT']);
    expect(v.runSize).toMatch(/^Drops start to run at about [\d.]+ mm across on a vertical face$/);
    expect(v.note).toContain('Nothing in the scene leaves rain, dust or snow on the parts');
    expect(v.noteButton).toBe('Open Ambient');
    expect(v.pointer).toMatch(/^Physics: Static · gets wet as (Metal|Paint)$/);

    // Dynamic: the density, the mass and Drop come in.
    await page.locator('[data-field="phys.role"] button', { hasText: /^Dynamic$/ }).click();
    await settle(page);
    v = await physicsView(page);
    expect(v.roleLine).toBe('Falls and collides with the rest');
    expect([v.density, v.friction, v.bounciness, v.drop]).toEqual([true, true, true, true]);

    // Gets wet off: one step, named; the line says it keeps dry, the pointer too.
    await page.click('[data-field="phys.getsWet"]');
    await settle(page);
    v = await physicsView(page);
    expect(v.wet).toBe('false');
    expect(v.undo).toBe('Undo: Weather of Body');
    expect(v.runSize).toBe('It keeps dry: no drop stays on it, and it still shelters what is below it');
    expect(v.pointer).toBe('Physics: Dynamic · keeps dry');
    await page.click('[data-field="phys.getsWet"]');
    await settle(page);
    // Surface: Water-repellent, its own size.
    await page.selectOption('[data-field="phys.surface"]', 'WATER_REPELLENT');
    await settle(page);
    v = await physicsView(page);
    expect([v.surface, v.surfaceText]).toEqual(['WATER_REPELLENT', 'Water-repellent']);
    expect(v.runSize).toBe('Drops start to run at about 1.9 mm across on a vertical face');
    expect(v.pointer).toBe('Physics: Dynamic · gets wet as Water-repellent');
    await page.context().close();
  });

  it('a multi-selection and a model show mixed values as indeterminate, and one click sets every part in one step', async () => {
    const page = await open('select=cap');
    await page.click('[data-field="phys.getsWet"]');
    await page.selectOption('[data-field="phys.surface"]', 'GLASS');
    await settle(page);
    await selectRows(page, ['Cap', 'Body']);
    let v = await physicsView(page);
    // Mutation checked: the switch showing the first part's value (aria-checked false) instead of mixed fails.
    expect([v.wet, v.dust, v.surface, v.surfaceText]).toEqual(['mixed', 'true', 'MIXED', 'Mixed']);
    expect(v.options).not.toContain('MIXED');
    expect(v.pointer).toBe('Physics: Static · some keep dry');
    // A click on mixed turns all on, in one undo step for both parts; undo brings the mix back.
    await page.click('[data-field="phys.getsWet"]');
    await settle(page);
    v = await physicsView(page);
    expect(v.wet).toBe('true');
    expect(v.undo).toMatch(/^Undo: Weather of /);
    await page.keyboard.press('Control+z');
    await settle(page);
    expect((await physicsView(page)).wet).toBe('mixed');
    // The model: every part under it.
    await page.goto(`${url}?lang=en&example=1&tour=0&mode=fast&select=model`);
    await page.waitForSelector('#app[data-ready="1"]', { timeout: 120000 });
    await settle(page, 300);
    v = await physicsView(page);
    expect([v.wet, v.surface, v.autoText]).toEqual(['true', 'AUTO', 'From each part’s material']);
    await page.click('[data-field="phys.getsDust"]');
    await settle(page);
    v = await physicsView(page);
    expect(v.dust).toBe('false');
    expect(v.undo).toMatch(/^Undo: Weather of /);
    // One step: a single undo puts every part back.
    await page.keyboard.press('Control+z');
    await settle(page);
    expect((await physicsView(page)).dust).toBe('true');
    await page.context().close();
  });

  it('the Material pointer opens Physics; the note’s button shows the effect; On the parts follows Shape; the drawer says what Start simulates', async () => {
    const page = await open('select=body');
    // Fold Physics, then the pointer opens it again and brings it into view. Mutation checked: a pointer that only
    // scrolls (does not open a folded section) fails `collapsed`.
    await page.click('.side-right [data-section="physics"] .section-head');
    await settle(page);
    expect((await physicsView(page)).collapsed).toBe(true);
    await page.click('.side-right [data-action="phys.pointer"]');
    await settle(page, 200);
    expect((await physicsView(page)).collapsed).toBe(false);
    const inView = await page.evaluate(() => {
      const head = document.querySelector('.side-right [data-section="physics"] .section-head')!.getBoundingClientRect();
      const box = document.querySelector('.side-right .side-scroll')!.getBoundingClientRect();
      return head.top >= box.top - 1 && head.top < box.bottom;
    });
    expect(inView).toBe(true);

    // Rising bubbles (which leave nothing on the parts) and a rain (Scene ▸ Ambient ▸ Add), the bubbles the effect being
    // edited and Ambient folded; back to the body: the note's button names the rain.
    await page.keyboard.press('Escape');
    await page.evaluate(() => document.querySelector<HTMLElement>('.side-right .crumb')?.click());
    await settle(page);
    for (const preset of ['BUBBLES', 'RAIN']) {
      await page.click('[data-ambient="add"]');
      await settle(page);
      await page.click(`[data-ambient="gallery"] [data-preset="${preset}"]`);
      await settle(page, 200);
    }
    await page.locator('[data-ambient="list"] [data-effect] .ellipsis', { hasText: /^Rising bubbles$/ }).first().click();
    await settle(page);
    expect(await page.evaluate(() => document.querySelector('[data-ambient="editor"] [data-knob="ambient.wetParts"]'))).toBeNull();
    await page.click('.side-right [data-section="ambient"] .section-head');
    await settle(page);
    await selectRows(page, ['Body']);
    let v = await physicsView(page);
    expect(v.note).toBe('Nothing in the scene leaves rain, dust or snow on the parts: switch “On the parts” on in an effect');
    expect(v.noteButton).toBe('Edit Rain');
    // The button: the scene's inspector, Ambient unfolded, the rain's editor, its On the parts in view and focused.
    // Mutations checked: a button that does not select the effect (the Ambient section only, the bubbles still
    // edited) fails the focus on its switch, and so does one that leaves a folded Ambient folded.
    await page.click('[data-action="phys.toEffect"]');
    await settle(page, 250);
    const fx = await page.evaluate(() => {
      const row = document.querySelector('[data-ambient="editor"] [data-knob="ambient.wetParts"]');
      const knobs = [...(document.querySelector('[data-ambient="knobs"]')?.children ?? [])].map((c) => c.getAttribute('data-knob') ?? c.getAttribute('data-ambient') ?? '');
      return { focused: !!row && row.contains(document.activeElement), tip: row?.getAttribute('data-tip') ?? '', knobs, crumbs: document.querySelector('.side-right .crumbs')?.textContent ?? '' };
    });
    expect(fx.focused).toBe(true);
    expect(fx.tip).toContain('Each part chooses in Physics ▸ Weather');
    // Right after the Shape (and its mix, when it has one), before Energy and long before the Seed. Mutation checked:
    // the row back after the seed fails the order.
    const at = (k: string) => fx.knobs.indexOf(k);
    expect(at('ambient.wetParts')).toBe(at('ambient.shape') + 1);
    expect(at('ambient.wetParts')).toBeLessThan(at('ambient.energy'));
    expect(at('ambient.wetParts')).toBeLessThan(at('ambient.seed'));
    // On, then the body: no note.
    await page.click('[data-knob="ambient.wetParts"] button.toggle');
    await settle(page);
    await selectRows(page, ['Body']);
    v = await physicsView(page);
    expect(v.note).toBeNull();
    // The body Dynamic and dry, the cap dry too: the drawer's line. Mutation checked: the line counting a dry part
    // among the rain's fails it.
    await page.locator('[data-field="phys.role"] button', { hasText: /^Dynamic$/ }).click();
    await page.click('[data-field="phys.getsWet"]');
    await settle(page);
    await page.click('.drawer-btn[data-drawer="physics"]');
    await settle(page, 200);
    const plan = await page.evaluate(() => document.querySelector('[data-field="phys.plan"]')?.textContent ?? null);
    // The bottle's five parts and the set's pieces under the rain, the body among them but dry.
    const m = /^Start simulates: 1 dynamic part · rain on (\d+) parts \(1 stays dry\)$/.exec(plan ?? '');
    expect(m, plan ?? '').not.toBeNull();
    // Undo twice (Gets wet, the role): the body is static and wet again.
    await page.keyboard.press('Control+z');
    await page.keyboard.press('Control+z');
    await settle(page);
    expect(await page.evaluate(() => document.querySelector('[data-field="phys.plan"]')?.textContent ?? null)).toBe(`Start simulates: rain on ${Number(m![1]) + 1} parts`);
    // And with the rain off the parts, nothing to simulate.
    await page.keyboard.press('Control+z');
    await settle(page);
    expect(await page.evaluate(() => document.querySelector('[data-field="phys.plan"]')?.textContent ?? null)).toBe('Nothing to simulate: make a part Dynamic, or switch “On the parts” on in an effect');
    await page.context().close();
  });
});
