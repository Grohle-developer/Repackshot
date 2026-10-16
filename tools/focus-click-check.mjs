#!/usr/bin/env node
// Browser check of "Focus with a click" (user report 1.8: the click picked the right point, and the same click took the
// focus back to the orbit distance), with the local Chromium and swiftshader.
//
//   npm run build && node tools/focus-click-check.mjs [--url http://host:port]
//
// Without --url it serves dist/ with `vite preview` on port 4202 and stops it at the end. The page is the example in
// the Fast view (the click is real: the pointer goes down and up on the example's bottle).
//
//   (a) with Focus with a click on, a click on the bottle moves the Focus distance field once, to the clicked
//       distance, and it stays there (it used to go 688 -> 660 -> 688);
//   (b) the last entry of the undo history is "Focus with a click", not "Orbit";
//   (c) a plain click on the bottle (selecting it) leaves a typed focus distance where it is;
//   (d) zooming with the wheel after a picked focus leaves the focus where it was;
//   (e) on a camera whose focus sat at the orbit distance, the same zoom takes the focus along.
//
// Results: out/focus-click-check.json.

import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4202;
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const BASE = opt('url', null);
const OUT = join(ROOT, 'out');
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

const settle = (page, ms = 400) => page.waitForTimeout(ms);
const FIELD = '[data-section="camera"] [role="spinbutton"][aria-label="Focus distance"]';
const num = (v) => (v === null || v === undefined ? NaN : Number(v));

/** Opens the example; records every value the Focus distance field takes from now on in window.__focusLog. */
async function open(browser, base) {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !m.text().startsWith('Failed to load resource') && errors.push(m.text()));
  await page.goto(`${base}/?example=1&theme=dark&lang=en&mode=fast`);
  await page.waitForSelector('#app[data-ready="1"]', { timeout: 90000 });
  await settle(page, 1500);
  await page.keyboard.press('Escape');
  await settle(page, 300);
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    window.__focusLog = [el?.getAttribute('aria-valuenow')];
    new MutationObserver(() => window.__focusLog.push(el.getAttribute('aria-valuenow'))).observe(el, { attributes: true, attributeFilter: ['aria-valuenow'] });
  }, FIELD);
  const canvas = await page.locator('canvas[aria-label="viewport"], .vp-canvas-host canvas:not(.vp-backdrop)').first().boundingBox();
  return { context, page, canvas, errors };
}

const readField = (page) => page.locator(FIELD).getAttribute('aria-valuenow').then(num);
const focusLog = (page) => page.evaluate(() => window.__focusLog.map(Number));
const undoTips = (page) => page.evaluate(() => [...document.querySelectorAll('[data-tip]')].map((e) => e.getAttribute('data-tip') || '').filter((t) => /^Undo/.test(t)).slice(0, 3));
/** A click as the user makes it: the pointer goes down and up on the same pixel. */
async function click(page, x, y) {
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.up();
  await settle(page, 800);
}
/** A wheel gesture on the canvas centre, then time for the gesture to end. */
async function zoom(page, canvas, delta) {
  await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
  await page.mouse.wheel(0, delta);
  await settle(page, 900);
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

  // (a), (b), (c), (d): focus picked with a click.
  {
    const { context, page, canvas, errors } = await open(browser, base);
    const initial = await readField(page);
    const btn = page.locator('[data-section="camera"] button[aria-label="Focus with a click"]').first();
    await btn.scrollIntoViewIfNeeded();
    await btn.click();
    await settle(page, 300);
    check('pick_mode_on', (await btn.getAttribute('aria-pressed')) === 'true', { pressed: await btn.getAttribute('aria-pressed') });
    // The example's bottle sits in the middle of the frame: a point a little below and left of the centre.
    const x = canvas.x + canvas.width / 2 - 10;
    const y = canvas.y + canvas.height / 2 + 40;
    await click(page, x, y);
    const log = await focusLog(page);
    const picked = await readField(page);
    const changes = log.filter((v, i) => i === 0 || v !== log[i - 1]);
    check('focus_moved_once_and_stays', changes.length === 2 && changes[0] === initial && Math.abs(picked - initial) > 1 && picked === changes[1], { initial, picked, values: changes });
    const tips = await undoTips(page);
    check('undo_is_the_focus_click', tips.length > 0 && /Focus with a click/.test(tips[0]) && !/Orbit/.test(tips[0]), { tips });

    // (d) the wheel after the pick: the orbit distance changes, the picked focus does not.
    await zoom(page, canvas, -400);
    const afterZoom = await readField(page);
    check('zoom_keeps_picked_focus', afterZoom === picked, { picked, afterZoom });

    // (c) a typed focus distance, then a plain click on the bottle (it selects the part).
    await page.keyboard.press('Escape');
    await page.locator(FIELD).focus();
    for (let i = 0; i < 5; i++) await page.keyboard.press('Control+ArrowDown');
    await settle(page, 300);
    const typed = await readField(page);
    await click(page, x, y);
    await page.keyboard.press('Escape');
    await settle(page, 500);
    const afterClick = await readField(page);
    check('typed_focus_survives_a_click', Number.isFinite(typed) && typed !== picked && afterClick === typed, { typed, afterClick });
    check('no_page_errors_pick', errors.length === 0, { errors });
    await context.close();
  }

  // (e) a camera whose focus sits at the orbit distance: zooming takes the focus along.
  {
    const { context, page, canvas, errors } = await open(browser, base);
    const before = await readField(page);
    await zoom(page, canvas, -400);
    const after = await readField(page);
    check('zoom_moves_following_focus', Number.isFinite(after) && Math.abs(after - before) > 1, { before, after });
    check('no_page_errors_follow', errors.length === 0, { errors });
    await context.close();
  }
} finally {
  await browser?.close();
  if (server) {
    try {
      process.kill(-server.pid, 'SIGTERM');
    } catch {
      // gone
    }
    stopServer();
  }
  writeFileSync(join(OUT, 'focus-click-check.json'), JSON.stringify(results, null, 2));
}
const failed = Object.entries(results).filter(([, r]) => !r.ok);
if (failed.length) {
  console.error(`${failed.length} check(s) failed: ${failed.map(([k]) => k).join(', ')}`);
  process.exit(1);
}
console.log('all good');
