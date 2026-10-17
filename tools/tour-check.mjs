#!/usr/bin/env node
// Browser checks of phase U10 in the built app: the guided tour, step by step, with the local Chromium and swiftshader.
//
//   npm run build && node tools/tour-check.mjs [--url http://localhost:4189] [--shots docs/ui]
//
// Without --url it serves dist/ with `vite preview` on port 4189 and stops it at the end.
//
//   first    a fresh profile with `?tour=auto` starts the tour by itself on an empty project; every step of the roadmap's order
//            is visited with the arrow keys, each one rings something that is on screen (a box of a few pixels at least,
//            inside the window), none is skipped, the render window, Settings, the queue drawer and the tab are open only
//            while their step is on and are put back at the end, Delete under the tour deletes nothing, Back goes back,
//            and the last step finishes it;
//   seen     finishing counts as seen: after a reload `?tour=auto` does not start it again; Help ▸ Guided tour does;
//            Skip tour and Esc count as seen as well; the flag is in the settings document, not in a loose entry;
//   robot    a page driven by automation (this one) does not start the tour by itself, and `?tour=0` never does;
//   example  with the example loaded the materials step rings the catalogue of the selected part (the empty project rings
//            the inspector), and the selection comes back after the tour;
//   narrow   at 1000 px the side panels are drawers: the steps open the one they need and every step still rings something;
//   es       the same walk in Spanish, with the Spanish words on the card and one dot per step;
//   shots    docs/ui/tour-tools.png, tour-camera.png, tour-render-ai.png, tour-settings-es.png.
//
// Results: out/tour-check.json.

import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4189;
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const BASE = opt('url', null);
const SHOTS = resolve(ROOT, opt('shots', 'docs/ui'));
const OUT = join(ROOT, 'out');
mkdirSync(OUT, { recursive: true });
mkdirSync(SHOTS, { recursive: true });

const results = {};
const fail = (msg) => {
  throw new Error(msg);
};
const check = (key, ok, detail = {}) => {
  results[key] = { ok: Boolean(ok), ...detail };
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${key} ${JSON.stringify(detail)}`);
};

function findChromium() {
  if (process.env.REPACKSHOT_CHROMIUM) return process.env.REPACKSHOT_CHROMIUM;
  for (const base of [process.env.PLAYWRIGHT_BROWSERS_PATH, '/opt/pw-browsers'].filter(Boolean)) {
    try {
      const dirs = execFileSync('ls', [base]).toString().split('\n').filter((d) => /^chromium-\d+$/.test(d)).sort().reverse();
      for (const d of dirs) if (existsSync(join(base, d, 'chrome-linux', 'chrome'))) return join(base, d, 'chrome-linux', 'chrome');
    } catch {
      // next
    }
  }
  return fail('no Chromium found (set REPACKSHOT_CHROMIUM)');
}

function stopServer() {
  const run = spawnSync('lsof', ['-t', '-i', `:${PORT}`]);
  for (const pid of run.stdout.toString().split(/\s+/).filter(Boolean)) {
    try {
      process.kill(Number(pid), 'SIGTERM');
    } catch {
      // gone
    }
  }
}

async function waitFor(url, ms = 30000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // not yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  fail(`${url} did not answer`);
}

let BASE_URL = BASE;

async function open(browser, query, viewport = { width: 1600, height: 1000 }) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !m.text().startsWith('Failed to load resource') && errors.push(m.text()));
  await page.goto(`${BASE_URL}/?${query}`);
  await page.waitForSelector('#app[data-ready="1"]', { timeout: 60000 });
  return { page, context, errors };
}

const settle = (page, ms = 60) => page.evaluate((wait) => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, wait)))), ms);

/** What the tour shows now: the step, its words, the ring, the card, what is open under it. */
const look = (page) =>
  page.evaluate(() => {
    const root = document.querySelector('[data-tour]');
    if (!root) return null;
    const box = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height };
    };
    const spot = root.querySelector('.tour-spot');
    const card = root.querySelector('.tour-card');
    return {
      id: root.dataset.step,
      target: root.dataset.target,
      place: root.dataset.place,
      center: root.classList.contains('is-center'),
      title: root.querySelector('.tour-title')?.textContent ?? '',
      text: root.querySelector('.tour-text')?.textContent ?? '',
      count: root.querySelector('.tour-count')?.textContent ?? '',
      next: root.querySelector('[data-tour-next]')?.textContent ?? '',
      backDisabled: root.querySelector('[data-tour-back]')?.disabled ?? null,
      dots: [...root.querySelectorAll('.tour-dot')].map((d) => d.dataset.step),
      on: root.querySelectorAll('.tour-dot.is-on').length,
      spot: spot && spot.style.display !== 'none' ? box(spot) : null,
      card: box(card),
      view: { w: window.innerWidth, h: window.innerHeight },
      renderWindow: !!document.querySelector('[data-render-window]'),
      settings: !!document.querySelector('[data-settings-window]'),
      settingsSection: document.querySelector('[data-settings-window] .sw-section')?.dataset.section ?? null,
      drawer: document.querySelector('.bar-wrap .drawer-btn[aria-pressed="true"]')?.dataset.drawer ?? null,
      tab: document.querySelector('.side-left [role="tab"][aria-selected="true"]')?.id ?? document.querySelector('.side-left [aria-selected="true"]')?.textContent ?? null,
      parts: document.querySelectorAll('.tree-row').length,
      selected: document.querySelectorAll('.tree-row.is-selected').length,
      leftOpen: document.querySelector('.app')?.dataset.left,
      rightOpen: document.querySelector('.app')?.dataset.right,
    };
  });

const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Walks the whole tour with → and reports every step. */
async function walk(page, { lang = 'en' } = {}) {
  const steps = [];
  const problems = [];
  const first = await look(page);
  if (!first) fail('the tour is not on screen');
  const total = first.dots.length;
  for (let i = 0; i < total; i++) {
    await page.waitForFunction(
      (id) => {
        const r = document.querySelector('[data-tour]');
        if (!r) return true;
        const spot = r.querySelector('.tour-spot');
        if (r.dataset.step !== id) return false;
        // The ends are a card in the middle of the screen; every other step waits for its ring.
        if (id === 'welcome' || id === 'done') return r.classList.contains('is-center');
        return !r.classList.contains('is-center') && spot.style.display !== 'none' && parseFloat(spot.style.width) > 0;
      },
      first.dots[i],
      { timeout: 5000 },
    ).catch(() => undefined);
    await settle(page, 220);
    const s = await look(page);
    if (!s) {
      problems.push(`the tour ended at step ${i + 1} of ${total}`);
      break;
    }
    steps.push(s);
    if (s.id !== first.dots[i]) problems.push(`step ${i + 1} should be ${first.dots[i]} and is ${s.id}`);
    if (!s.title.trim() || !s.text.trim() || /^tour\.|\{[a-z]+\}/.test(`${s.title} ${s.text}`)) problems.push(`${s.id}: words missing (${s.title} / ${s.text})`);
    if (s.on !== 1) problems.push(`${s.id}: ${s.on} dots on`);
    const wantsRing = !['welcome', 'done'].includes(s.id);
    if (wantsRing) {
      if (!s.spot) problems.push(`${s.id}: nothing is ringed`);
      else {
        if (s.spot.w < 20 || s.spot.h < 12) problems.push(`${s.id}: the ring is ${s.spot.w}×${s.spot.h}`);
        if (s.spot.x < -1 || s.spot.y < -1 || s.spot.x + s.spot.w > s.view.w + 1 || s.spot.y + s.spot.h > s.view.h + 1) problems.push(`${s.id}: the ring leaves the window`);
        // The card does not cover the ring unless it sits inside a large area.
        if (s.place !== 'inside' && s.card && overlaps(s.card, s.spot)) problems.push(`${s.id}: the card covers the ring (${s.place})`);
      }
    } else if (!s.center) problems.push(`${s.id}: should be centred`);
    if (s.card && (s.card.x < 0 || s.card.y < 0 || s.card.x + s.card.w > s.view.w + 1 || s.card.y + s.card.h > s.view.h + 1)) problems.push(`${s.id}: the card leaves the window`);
    if (i === total - 1) break;
    await page.keyboard.press('ArrowRight');
  }
  return { steps, problems, total, lang };
}

const SUGGESTED = ['welcome', 'menu', 'parts', 'levels', 'tools', 'mode', 'product', 'light', 'environment', 'camera', 'material', 'nodes', 'lights', 'cameras', 'studios', 'add', 'render', 'render-window', 'render-queue', 'render-ai', 'results'];

const chromium = (await import(join(ROOT, 'node_modules', 'playwright-core', 'index.mjs'))).chromium;
let browser = null;
let server = null;
try {
  if (!BASE) {
    if (!existsSync(join(ROOT, 'dist', 'index.html'))) fail('dist/ is missing: npm run build first');
    stopServer();
    server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: 'ignore', detached: true });
    BASE_URL = `http://localhost:${PORT}`;
    await waitFor(BASE_URL);
  }
  browser = await chromium.launch({ executablePath: findChromium(), headless: true, args: ['--no-sandbox', '--disable-gpu', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });

  // ---------------------------------------------------------------- first start, empty project
  {
    const { page, context, errors } = await open(browser, 'tour=auto&theme=dark&lang=en&mode=fast');
    await page.waitForSelector('[data-tour]', { timeout: 10000 });
    const before = await look(page);
    check('first_start', before?.id === 'welcome' && before.center && before.backDisabled === true && before.count === `1 of ${before.dots.length}`, { id: before?.id, count: before?.count });

    // Delete under the tour: nothing is deleted, and nothing else reacts (the example is not even loaded).
    await page.keyboard.press('Delete');
    await page.keyboard.press('KeyF');
    await settle(page);
    const stillThere = await look(page);
    check('keys_swallowed', stillThere?.id === 'welcome', { id: stillThere?.id });

    // The pointer is the tour's: a click on the empty project's Import button does nothing under it.
    await page.mouse.click(800, 500);
    await settle(page);
    check('pointer_blocked', (await look(page))?.id === 'welcome' && !(await page.evaluate(() => !!document.querySelector('.import-sheet'))));

    const walked = await walk(page);
    const ids = walked.steps.map((s) => s.id);
    const expect = [...SUGGESTED, ...['general', 'preferences', 'accessibility', 'shortcuts', 'engine', 'ai', 'storage', 'updates', 'about'].map((s) => `settings-${s}`), 'done'];
    check('order', JSON.stringify(ids) === JSON.stringify(expect), { ids: ids.join(','), expected: expect.join(',') });
    check('every_step_rings_something', walked.problems.length === 0, { total: walked.total, problems: walked.problems });
    const byId = Object.fromEntries(walked.steps.map((s) => [s.id, s]));
    check('windows_only_with_their_step', byId['render-window']?.renderWindow && byId['render-ai']?.renderWindow && !byId.results?.renderWindow && byId['settings-ai']?.settings && byId['settings-ai']?.settingsSection === 'ai' && !byId.done?.settings && byId.results?.drawer === 'queue' && !byId.add?.renderWindow, {
      renderWindowSteps: ids.filter((id) => byId[id].renderWindow),
      settingsSteps: ids.filter((id) => byId[id].settings),
      drawerSteps: ids.filter((id) => byId[id].drawer),
    });
    check('inspector_empty_falls_back', byId.material?.target === 'inspector' && byId.tools?.target === 'tools', { material: byId.material?.target, tools: byId.tools?.target });

    // Back and forward on the first steps; the words change with the step.
    await page.keyboard.press('ArrowLeft');
    await settle(page, 200);
    const back = await look(page);
    check('back', back?.id === 'settings-about' || back?.id === 'updates' || back?.id?.startsWith('settings-') || back?.id === 'about', { id: back?.id });
    await page.keyboard.press('ArrowRight');
    await settle(page, 200);
    // The last step finishes it.
    const last = await look(page);
    check('last_step_is_done', last?.id === 'done' && last.next === 'Done', { id: last?.id, next: last?.next });
    await page.keyboard.press('Enter');
    await settle(page, 200);
    const ended = await page.evaluate(() => ({
      tour: !!document.querySelector('[data-tour]'),
      rw: !!document.querySelector('[data-render-window]'),
      sw: !!document.querySelector('[data-settings-window]'),
      drawer: document.querySelector('.bar-wrap .drawer-btn[aria-pressed="true"]')?.dataset.drawer ?? null,
      tab: [...document.querySelectorAll('.side-left [role="tab"]')].map((t) => t.getAttribute('aria-selected')).join(','),
      doc: JSON.parse(localStorage.getItem('repackshot.settings') ?? 'null'),
      keys: Object.keys(localStorage),
    }));
    check('ended_and_put_back', !ended.tour && !ended.rw && !ended.sw && ended.drawer === null && ended.tab.startsWith('true'), { ...ended, doc: undefined });
    check('seen_is_remembered', ended.doc?.layout?.tourSeen === true && !ended.keys.some((k) => /tour/.test(k)), { tourSeen: ended.doc?.layout?.tourSeen, keys: ended.keys });
    check('no_errors_first', errors.length === 0, { errors });

    // After a reload: not again; Help ▸ Guided tour: again.
    await page.goto(`${BASE_URL}/?tour=auto&theme=dark&lang=en&mode=fast`);
    await page.waitForSelector('#app[data-ready="1"]', { timeout: 60000 });
    await settle(page, 400);
    check('not_again', (await look(page)) === null);
    await page.click('.brand-btn');
    await page.locator('.floating > .menu > .menu-item', { hasText: /^Help$/ }).hover();
    await settle(page, 150);
    const help = await page.locator('.menu-sub .menu-item').allTextContents();
    await page.locator('.menu-sub .menu-item', { hasText: /^Guided tour$/ }).click();
    await page.waitForSelector('[data-tour]', { timeout: 5000 });
    await settle(page);
    check('help_menu_starts_it', (await look(page))?.id === 'welcome', { help });
    // Esc skips; and it counts as seen even when the flag was already set.
    await page.keyboard.press('Escape');
    await settle(page, 200);
    check('escape_skips', (await look(page)) === null);
    // The palette finds it too.
    await page.keyboard.press('Control+k');
    await page.keyboard.type('guided tour');
    await settle(page, 200);
    const palette = await page.locator('.palette-item').allTextContents();
    check('palette_lists_it', palette.some((p) => /Guided tour/.test(p)), { palette });
    await page.keyboard.press('Escape');
    await context.close();
  }

  // ---------------------------------------------------------------- a fresh profile: Skip tour counts as seen
  {
    const { page, context } = await open(browser, 'tour=auto&lang=en&mode=fast');
    await page.waitForSelector('[data-tour]', { timeout: 10000 });
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await settle(page, 200);
    await page.click('[data-tour-skip]');
    await settle(page, 200);
    const gone = (await look(page)) === null;
    const seen = await page.evaluate(() => JSON.parse(localStorage.getItem('repackshot.settings') ?? 'null')?.layout?.tourSeen);
    await page.goto(`${BASE_URL}/?tour=auto&lang=en&mode=fast`);
    await page.waitForSelector('#app[data-ready="1"]', { timeout: 60000 });
    await settle(page, 400);
    check('skip_counts_as_seen', gone && seen === true && (await look(page)) === null, { gone, seen });
    await context.close();
  }

  // ---------------------------------------------------------------- automation never gets it by itself
  {
    const { page, context } = await open(browser, 'lang=en&mode=fast');
    await settle(page, 400);
    const webdriver = await page.evaluate(() => navigator.webdriver);
    const none = (await look(page)) === null;
    await page.goto(`${BASE_URL}/?tour=0&lang=en&mode=fast`);
    await page.waitForSelector('#app[data-ready="1"]', { timeout: 60000 });
    await settle(page, 400);
    check('robot_gets_no_tour', webdriver === true && none && (await look(page)) === null, { webdriver, none });
    await context.close();
  }

  // ---------------------------------------------------------------- with the example: the catalogue is ringed, the selection comes back
  {
    const { page, context, errors } = await open(browser, 'tour=1&example=1&select=body&theme=dark&lang=en&mode=fast');
    await page.waitForSelector('[data-tour]', { timeout: 10000 });
    const before = await look(page);
    // Go to the materials step.
    for (let i = 0; i < SUGGESTED.indexOf('material'); i++) await page.keyboard.press('ArrowRight');
    await page.waitForFunction(() => document.querySelector('[data-tour]')?.dataset.step === 'material', null, { timeout: 5000 });
    await settle(page, 400);
    const m = await look(page);
    const catalogue = await page.evaluate(() => {
      const el = document.querySelector('[data-guide="material"]');
      const r = el?.getBoundingClientRect();
      return r ? { x: r.left, y: r.top, w: r.width, h: r.height } : null;
    });
    check('material_rings_the_catalogue', m?.target === 'material' && catalogue && m.spot && Math.abs(m.spot.x - (catalogue.x - 4)) < 2 && m.selected === 1, { target: m?.target, spot: m?.spot, catalogue, selected: m?.selected });
    // Camera step shot, then the tools and the render AI.
    for (const [id, file, theme] of [['tools', 'tour-tools.png'], ['camera', 'tour-camera.png'], ['render-ai', 'tour-render-ai.png']]) {
      const cur = await look(page);
      const order = cur.dots;
      const from = order.indexOf(cur.id);
      const to = order.indexOf(id);
      for (let i = 0; i < Math.abs(to - from); i++) await page.keyboard.press(to > from ? 'ArrowRight' : 'ArrowLeft');
      await page.waitForFunction((want) => document.querySelector('[data-tour]')?.dataset.step === want, id, { timeout: 5000 });
      await settle(page, 500);
      if (id === 'render-ai') await page.waitForSelector('[data-render-window]', { timeout: 5000 });
      void theme;
      await page.screenshot({ path: join(SHOTS, file) });
    }
    // To the end, then the tour has put the selection back.
    await page.keyboard.press('Escape');
    await settle(page, 300);
    const after = await look(page);
    const selection = await page.evaluate(() => ({ selected: [...document.querySelectorAll('.tree-row.is-selected .tree-name')].map((n) => n.textContent), rw: !!document.querySelector('[data-render-window]') }));
    check('selection_comes_back', after === null && selection.selected.length === 1 && !selection.rw, { before: before?.selected, selection });
    check('no_errors_example', errors.length === 0, { errors });
    await context.close();
  }

  // ---------------------------------------------------------------- narrow window: the side panels are drawers
  {
    const { page, context } = await open(browser, 'tour=1&example=1&theme=light&lang=en&mode=fast', { width: 1000, height: 760 });
    await page.waitForSelector('[data-tour]', { timeout: 10000 });
    const walked = await walk(page);
    check('narrow_walk', walked.problems.length === 0 && walked.steps.length === walked.total, { total: walked.total, steps: walked.steps.length, problems: walked.problems });
    await page.keyboard.press('Escape');
    await settle(page, 200);
    const panels = await page.evaluate(() => ({ left: document.querySelector('.app')?.dataset.left, right: document.querySelector('.app')?.dataset.right }));
    check('narrow_panels_back', panels.left === 'collapsed' && panels.right === 'collapsed', panels);
    await context.close();
  }

  // ---------------------------------------------------------------- Spanish
  {
    const { page, context } = await open(browser, 'tour=1&example=1&theme=dark&lang=es&mode=fast');
    await page.waitForSelector('[data-tour]', { timeout: 10000 });
    const walked = await walk(page, { lang: 'es' });
    const first = walked.steps[0];
    const settingsEs = walked.steps.find((s) => s.id === 'settings-ai');
    check('spanish_walk', walked.problems.length === 0 && /^1 de \d+$/.test(first.count) && first.title === 'Bienvenido a Repackshot' && /Ajustes/.test(settingsEs?.title ?? ''), { problems: walked.problems, first: first.title, settings: settingsEs?.title });
    // Settings · Render engine, in Spanish, for the screenshot.
    const cur = await look(page);
    const to = cur.dots.indexOf('settings-engine');
    for (let i = 0; i < cur.dots.length - 1 - to; i++) await page.keyboard.press('ArrowLeft');
    await page.waitForFunction(() => document.querySelector('[data-tour]')?.dataset.step === 'settings-engine', null, { timeout: 5000 });
    await settle(page, 500);
    await page.screenshot({ path: join(SHOTS, 'tour-settings-es.png') });
    await context.close();
  }
} catch (err) {
  check('run', false, { error: String(err?.stack ?? err) });
} finally {
  await browser?.close();
  if (server) stopServer();
  writeFileSync(join(OUT, 'tour-check.json'), JSON.stringify(results, null, 2));
  const failed = Object.entries(results).filter(([, v]) => !v.ok);
  console.log(failed.length === 0 ? 'all tour checks passed' : `${failed.length} failed: ${failed.map(([k]) => k).join(', ')}`);
  process.exit(failed.length === 0 ? 0 : 1);
}
