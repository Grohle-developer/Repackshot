#!/usr/bin/env node
// Browser check of the window of a lens's elements (phase O2b) in the built app, with the local Chromium and
// swiftshader. It needs the engine in dist/ (npm run engine:build before npm run build): the window's drawing and
// numbers are the engine's, asked of the page's own rt.wasm for the lens the pointer rests on.
//
//   npm run engine:build && npm run build && node tools/lens-hover-check.mjs [--shots docs/ui] [--url http://host:port]
//
// Without --url it serves dist/ with `vite preview` on port 4203 and stops it at the end.
//
//   chip        resting on the Wide chip opens a window beside the inspector with its two lenses (the inverted-
//               telephoto wide-angle and the fisheye), each with its cross-section, name, source and the engine's
//               numbers; leaving closes it;
//   list        resting on an entry of the open lens list opens the window beside the list with that lens, level with the
//               entry; a second lens shows its own numbers, and the two differ (the symmetric's five elements in three groups, the Gauss's six in four);
//   once        the same lens hovered again asks nothing of the engine (the page's questions are counted);
//   engine      the numbers on the window are the ones the engine reports for that lens: the same lens put on the camera
//               shows the same elements and groups in the section of the inspector;
//   escape      Escape closes the window, and choosing a lens closes it and puts the lens on the camera (one undo entry);
//   keyboard    the keyboard focus on a chip opens it, and the list's arrow keys move it from lens to lens;
//   inside      the window stays inside the viewport (a small one too);
//   nothing     the window takes no focus and no pointer.
//
// Screenshots (English): lens-hover.png (light) and lens-hover-dark.png (dark): the window beside the open lens list;
// lens-hover-chip.png: the window of a character's lenses.
// Results: out/lens-hover-check.json.

import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4203;
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const BASE = opt('url', null);
const SHOTS = resolve(ROOT, opt('shots', 'docs/ui'));
const OUT = join(ROOT, 'out');
mkdirSync(SHOTS, { recursive: true });
mkdirSync(OUT, { recursive: true });

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

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const settle = (page, ms = 250) => page.evaluate((w) => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, w)))), ms);

const WINDOW = '[data-lens-peek]';

/** The cards of the window, as the page shows them. */
const cards = (page) =>
  page.$$eval(`${WINDOW} [data-lens-key]`, (els) =>
    els.map((e) => ({
      key: e.getAttribute('data-lens-key'),
      state: e.getAttribute('data-state'),
      name: e.querySelector('[data-peek="name"]')?.textContent ?? '',
      source: e.querySelector('[data-peek="source"]')?.textContent ?? '',
      glass: e.querySelectorAll('svg path[fill-opacity]').length,
      numbers: Object.fromEntries([...e.querySelectorAll('dd')].map((d) => [d.getAttribute('data-value'), d.textContent])),
    })),
  );

/** Waits until the window shows `n` cards, all with the engine's answer. */
async function windowReady(page, n, timeout = 20000) {
  await page.waitForFunction((count) => document.querySelectorAll('[data-lens-peek] [data-state="ready"]').length === count, n, { timeout });
  return cards(page);
}

const shownCount = (page) => page.locator(WINDOW).count();
const rectOf = (page, sel) => page.evaluate((s) => {
  const r = document.querySelector(s)?.getBoundingClientRect();
  return r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null;
}, sel);

/** What the section of the inspector says of the lens on the camera. */
const sectionOf = (page) =>
  page.evaluate(() => {
    const sub = document.querySelector('[data-optics="cameraLens"]');
    return {
      elements: sub?.querySelector('[data-value="camera.lensInfoElements"]')?.textContent ?? null,
      focal: sub?.querySelector('[data-value="camera.lensInfoFocal"]')?.textContent ?? null,
      lens: sub?.querySelector('[data-lens-select]')?.getAttribute('data-value') ?? null,
    };
  });

/** How many scenes the page's own engine module has read for lens information (counted by wrapping its export). */
const engineLoads = (page) => page.evaluate(() => window.__lensLoads ?? 0);

async function openList(page, sub) {
  await sub.locator('[data-lens-select]').click();
  await page.waitForSelector('.menu-item[data-value]');
}

let server = null;
let browser = null;
try {
  const chromium = (await import(join(ROOT, 'node_modules', 'playwright-core', 'index.mjs'))).chromium;
  const base = BASE ?? `http://localhost:${PORT}`;
  if (!BASE) {
    if (!existsSync(join(ROOT, 'dist', 'index.html'))) fail('dist/ is missing: run npm run build first');
    stopServer();
    server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: 'ignore', detached: true });
    await waitFor(base);
  }
  browser = await chromium.launch({ executablePath: findChromium(), headless: true, args: ['--no-sandbox', '--disable-gpu', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });

  const open = async (theme, size = { width: 1600, height: 1100 }) => {
    const context = await browser.newContext({ viewport: size, deviceScaleFactor: 1 });
    const page = await context.newPage();
    // Counts the scenes the page's own engine module (the one that answers the lens questions) is given.
    await page.addInitScript(() => {
      const instantiate = WebAssembly.instantiate.bind(WebAssembly);
      WebAssembly.instantiate = async (...a) => {
        const r = await instantiate(...a);
        const inst = r.instance ?? r;
        const ex = inst.exports;
        if (!ex || typeof ex.rt_scene_lens_info_len !== 'function') return r;
        const wrapped = { ...ex, rt_scene_load: (...x) => ((window.__lensLoads = (window.__lensLoads ?? 0) + 1), ex.rt_scene_load(...x)) };
        return r.instance ? { module: r.module, instance: { exports: wrapped } } : { exports: wrapped };
      };
    });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && !m.text().startsWith('Failed to load resource') && errors.push(m.text()));
    await page.goto(`${base}/?example=1&theme=${theme}&lang=en&mode=fast`);
    await page.waitForSelector('#app[data-ready="1"]', { timeout: 60000 });
    await settle(page, 800);
    await page.keyboard.press('Escape');
    const head = page.locator('[data-section="camera"] [data-action="cameraLens"]');
    await head.scrollIntoViewIfNeeded();
    if ((await head.getAttribute('aria-expanded')) !== 'true') await head.click();
    await settle(page, 300);
    const sub = page.locator('[data-optics="cameraLens"]');
    // The traced double Gauss on the camera, and the engine's numbers for it in the section.
    await sub.locator('[aria-label="Lens model"] button', { hasText: 'Traced lens' }).click();
    await page.waitForSelector('[data-optics="cameraLens"] [data-value="camera.lensInfoElements"]', { timeout: 30000 });
    await sub.evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await settle(page, 300);
    return { context, page, sub, errors };
  };

  // --- light: the chip, the list, the engine --------------------------------------------------------------------
  {
    const { context, page, sub, errors } = await open('light');
    const own = await sectionOf(page);
    check('engine', own.lens === 'double_gauss_normal' && own.elements === '6 · 4', own);

    // The Wide chip.
    const t0 = Date.now();
    await sub.locator('[data-character="wide"]').hover();
    await wait(100);
    const early = await shownCount(page);
    await page.waitForSelector(WINDOW, { timeout: 5000 });
    const delay = Date.now() - t0;
    const chip = await windowReady(page, 2);
    const w = await rectOf(page, WINDOW);
    const col = await rectOf(page, '[data-lens-traced]');
    check(
      'chip',
      early === 0 && delay >= 250 && chip.map((c) => c.key).join() === 'inverted_telephoto_wide,fisheye_180' && chip.every((c) => c.glass >= 6 && c.name && c.source && /^f\//.test(c.numbers['camera.lensInfoStop'] ?? '')) && w.x + w.w <= col.x,
      { delay, earlyCount: early, cards: chip.map((c) => [c.key, c.name, c.glass, c.numbers['camera.lensInfoElements']]), window: w, column: col },
    );
    await settle(page, 200);
    const cw = await rectOf(page, WINDOW);
    const ch = await rectOf(page, '[data-character="wide"]');
    const cx0 = Math.max(0, cw.x - 24);
    const cx1 = Math.min(1600, col.x + col.w + 16);
    const cy0 = Math.max(0, Math.min(cw.y, ch.y) - 40);
    const cy1 = Math.min(1100, Math.max(cw.y + cw.h, ch.y + ch.h + 120) + 16);
    await page.screenshot({ path: join(SHOTS, 'lens-hover-chip.png'), clip: { x: cx0, y: cy0, width: cx1 - cx0, height: cy1 - cy0 } });
    await page.mouse.move(60, 600);
    await page.waitForSelector(WINDOW, { state: 'detached', timeout: 2000 });

    // The list.
    await openList(page, sub);
    const entryA = page.locator('.menu-item[data-value="symmetric_5"]');
    const entryB = page.locator('.menu-item[data-value="double_gauss_normal"]');
    await entryA.hover();
    const a = (await windowReady(page, 1))[0];
    const wa = await rectOf(page, WINDOW);
    const menu = await rectOf(page, '.menu');
    const ea = await entryA.boundingBox();
    await entryB.hover();
    await wait(80);
    const mid = await shownCount(page);
    const b = (await windowReady(page, 1))[0];
    check(
      'list',
      a.key === 'symmetric_5' && b.key === 'double_gauss_normal' && a.numbers['camera.lensInfoElements'] === '5 · 3' && b.numbers['camera.lensInfoElements'] === '6 · 4' && mid === 0 && wa.x + wa.w <= menu.x && Math.abs(wa.y - (ea.y - 6)) < 40 && wa.y >= 0 && wa.y + wa.h <= 1100,
      { a: [a.key, a.numbers], b: [b.key, b.numbers], midCount: mid, window: wa, menu, entryY: ea.y },
    );
    check('engine_numbers', b.numbers['camera.lensInfoElements'] === own.elements && (own.focal ?? '').startsWith(b.numbers['camera.lensInfoFocal']), { window: b.numbers, section: own });

    // The shot: the window beside the open list, with a lens that is not on the camera.
    await entryA.hover();
    await windowReady(page, 1);
    await settle(page, 200);
    const win = await rectOf(page, WINDOW);
    const lst = await rectOf(page, '.menu');
    const field = await rectOf(page, '[data-lens-select]');
    const x0 = Math.max(0, win.x - 24);
    const x1 = Math.min(1600, lst.x + lst.w + 24);
    const y0 = Math.max(0, Math.min(win.y, field.y - 120) - 16);
    const y1 = Math.min(1100, Math.max(win.y + win.h, lst.y + lst.h) + 16);
    await page.screenshot({ path: join(SHOTS, 'lens-hover.png'), clip: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } });

    // Once asked, asked once: the page's own module is asked for a lens the first time the pointer rests on it.
    const loads0 = await engineLoads(page);
    await page.keyboard.press('Escape');
    await page.mouse.move(60, 600);
    await sub.locator('[data-character="wide"]').hover();
    await windowReady(page, 2);
    await page.mouse.move(60, 600);
    await openList(page, sub);
    await entryA.hover();
    const again = (await windowReady(page, 1))[0];
    const loads1 = await engineLoads(page);
    check('once', loads1 === loads0 && again.key === 'symmetric_5', { loadsBefore: loads0, loadsAfter: loads1 });
    await page.keyboard.press('Escape');

    // Escape and choosing.
    await openList(page, sub);
    await entryA.hover();
    await page.waitForSelector(WINDOW);
    await page.keyboard.press('Escape');
    const afterEsc = { window: await shownCount(page), menu: await page.locator('.menu').count() };
    await openList(page, sub);
    await entryA.hover();
    await page.waitForSelector(WINDOW);
    await entryA.click();
    await settle(page, 600);
    const chosen = await sectionOf(page);
    const undo = await page.locator('.hdr button[aria-label="Undo"]').getAttribute('data-tip');
    check('escape', afterEsc.window === 0 && afterEsc.menu === 0 && (await shownCount(page)) === 0 && chosen.lens === 'symmetric_5' && chosen.elements === '5 · 3' && /Lens/.test(undo ?? ''), { afterEsc, chosen, undo });

    // The keyboard.
    await sub.locator('[data-character="clinical"]').focus();
    await page.keyboard.press('Tab');
    const focused = await page.evaluate(() => document.activeElement?.getAttribute('data-character'));
    await page.waitForSelector(WINDOW, { timeout: 5000 });
    const soft = await windowReady(page, 2);
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Escape');
    await sub.locator('[data-lens-select]').focus();
    await page.keyboard.press('ArrowDown');
    await page.waitForSelector('.menu-item[data-value]');
    const first = (await windowReady(page, 1))[0].key;
    await page.keyboard.press('ArrowDown');
    await page.waitForSelector(`${WINDOW} [data-lens-key]:not([data-lens-key="${first}"])`, { timeout: 5000 });
    const second = (await windowReady(page, 1))[0].key;
    const focusAfter = await page.evaluate(() => document.activeElement?.getAttribute('data-value'));
    check('keyboard', focused === 'soft' && soft.map((c) => c.key).join() === 'double_gauss_fast,soft_focus_variable' && first === 'symmetric_5' && second !== first && focusAfter === second, { focused, soft: soft.map((c) => c.key), first, second, focusAfter });
    await page.keyboard.press('Escape');

    // Nothing is taken: no focus, no pointer.
    await openList(page, sub);
    await page.locator('.menu-item[data-value="triplet"], .menu-item[data-value="split_rear_4"]').first().hover();
    await page.waitForSelector(WINDOW);
    const taken = await page.evaluate(() => {
      const w = document.querySelector('[data-lens-peek]');
      return { pointerEvents: getComputedStyle(w).pointerEvents, focusInside: w.contains(document.activeElement), tabbable: w.querySelectorAll('button, a, input, select, [tabindex]').length };
    });
    check('nothing', taken.pointerEvents === 'none' && !taken.focusInside && taken.tabbable === 0, taken);
    await page.keyboard.press('Escape');
    check('no_errors', errors.length === 0, { errors });
    await context.close();
  }

  // --- dark: the same window, for the shot ---------------------------------------------------------------------
  {
    const { context, page, sub, errors } = await open('dark');
    await openList(page, sub);
    await page.locator('.menu-item[data-value="symmetric_5"]').hover();
    await windowReady(page, 1);
    await settle(page, 200);
    const win = await rectOf(page, WINDOW);
    const lst = await rectOf(page, '.menu');
    const field = await rectOf(page, '[data-lens-select]');
    const x0 = Math.max(0, win.x - 24);
    const x1 = Math.min(1600, lst.x + lst.w + 24);
    const y0 = Math.max(0, Math.min(win.y, field.y - 120) - 16);
    const y1 = Math.min(1100, Math.max(win.y + win.h, lst.y + lst.h) + 16);
    await page.screenshot({ path: join(SHOTS, 'lens-hover-dark.png'), clip: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } });
    check('dark', true, { shot: 'lens-hover-dark.png' });
    check('dark_no_errors', errors.length === 0, { errors });
    await context.close();
  }

  // --- a short window: the window stays inside it ----------------------------------------------------------------
  {
    const { context, page, sub, errors } = await open('light', { width: 1280, height: 640 });
    const inside = [];
    for (const [w, h] of [[1280, 640], [1120, 420]]) {
      await page.setViewportSize({ width: w, height: h });
      await settle(page, 300);
      await page.mouse.move(2, h - 2);
      await sub.locator('[data-character="clinical"]').scrollIntoViewIfNeeded();
      await sub.locator('[data-character="clinical"]').hover();
      await page.waitForSelector(WINDOW, { timeout: 5000 });
      await windowReady(page, 4);
      const r = await rectOf(page, WINDOW);
      inside.push({ viewport: `${w}x${h}`, window: r, ok: r.x >= 0 && r.y >= 0 && r.x + r.w <= w + 0.5 && r.y + r.h <= h + 0.5 });
      await page.mouse.move(2, h - 2);
      await page.waitForSelector(WINDOW, { state: 'detached', timeout: 2000 });
    }
    check('inside', inside.every((i) => i.ok), { inside });
    check('small_no_errors', errors.length === 0, { errors });
    await context.close();
  }
} catch (err) {
  check('run', false, { error: String(err?.stack ?? err) });
} finally {
  await browser?.close();
  if (server) {
    try {
      process.kill(-server.pid, 'SIGTERM');
    } catch {
      // gone
    }
  }
  writeFileSync(join(OUT, 'lens-hover-check.json'), JSON.stringify(results, null, 2));
  const bad = Object.values(results).filter((r) => r && r.ok === false).length;
  console.log(bad ? `${bad} checks failed` : 'all checks passed');
  process.exitCode = bad ? 1 : 0;
}
