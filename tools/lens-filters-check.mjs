#!/usr/bin/env node
// Browser check of the lens's effect filters (phase O3a) in the built app, with the local Chromium and swiftshader.
//
//   npm run build && node tools/lens-filters-check.mjs [--shots docs/ui] [--url http://host:port]
//
// Without --url it serves dist/ with `vite preview` on port 4192 and stops it at the end.
//
//   empty      Camera ▸ Filters starts with no filters and Add filter;
//   add        Add filter puts a Black diffusion with its sentence and grades, one undo entry ("Camera: Add filter");
//   fast       the Fast preview changes with the filter (its approximation) and the meter says so;
//   star       a second filter turned into a Star shows its points and angle, 8 points is one undo entry;
//   max        three filters at most: Add filter is disabled and says so;
//   remove     removing one leaves two, and one undo brings it back;
//   reset      Plain disc keeps the filters.
//
// Screenshot (English, dark): lens-filters.png (the Filters subsection with two filters). Results:
// out/lens-filters-check.json, and out/lens-filters-viewport.png (the Fast viewport with those two filters).

import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4192;
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

const settle = (page, ms = 250) => page.evaluate((wait) => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, wait)))), ms);

/** What the Filters subsection shows. */
const read = (page) =>
  page.evaluate(() => {
    const sub = document.querySelector('[data-optics="cameraFilters"]');
    const rows = [...(sub?.querySelectorAll('[data-filter]') ?? [])];
    const add = sub?.querySelector('[data-action="filters.add"]');
    return {
      rows: rows.map((r) => r.getAttribute('data-filter')),
      help: rows.map((r) => r.querySelector('[data-filter-help]')?.textContent ?? ''),
      grades: rows.map((r) => [...r.querySelectorAll('[aria-label="Grade"] button')].map((b) => b.textContent)),
      points: rows.map((r) => [...r.querySelectorAll('[aria-label="Points"] button')].filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.textContent)[0] ?? null),
      angle: rows.map((r) => !!r.querySelector('[aria-label="Angle"]')),
      text: sub?.textContent ?? '',
      addDisabled: add ? add.disabled : null,
      undo: document.querySelector('.hdr button[aria-label="Undo"]')?.getAttribute('data-tip') ?? null,
      meter: document.querySelector('footer.status')?.textContent ?? '',
    };
  });

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
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !m.text().startsWith('Failed to load resource') && errors.push(m.text()));
  await page.goto(`${base}/?example=1&theme=dark&lang=en&mode=fast`);
  await page.waitForSelector('#app[data-ready="1"]', { timeout: 60000 });
  await settle(page, 800);
  await page.keyboard.press('Escape');
  const head = page.locator('[data-section="camera"] [data-action="cameraFilters"]');
  await head.scrollIntoViewIfNeeded();
  if ((await head.getAttribute('aria-expanded')) !== 'true') await head.click();
  await settle(page, 400);
  const r0 = await read(page);
  check('empty', r0.rows.length === 0 && /No filters/.test(r0.text) && r0.addDisabled === false, r0);

  const canvas = page.locator('canvas[aria-label="viewport"]').first();
  const before = await canvas.screenshot();
  const add = page.locator('[data-optics="cameraFilters"] [data-action="filters.add"]');
  await add.click();
  await settle(page, 800);
  const r1 = await read(page);
  check('add', r1.rows.join() === 'DIFFUSION_BLACK' && /contrast/.test(r1.help[0]) && r1.grades[0].join(' ') === '1/8 1/4 1/2 1 2' && r1.undo?.includes('Add filter'), r1);
  const after = await canvas.screenshot();
  check('fast', Buffer.compare(before, after) !== 0 && /Filters: approximation/.test(r1.meter), { meter: r1.meter });

  await add.click();
  await settle(page, 400);
  const second = page.locator('[data-optics="cameraFilters"] [data-filter]').nth(1).locator('select').first();
  await second.selectOption('STAR');
  await settle(page, 400);
  await page.locator('[data-optics="cameraFilters"] [data-filter="STAR"] [aria-label="Points"] button', { hasText: '8' }).click();
  await settle(page, 600);
  const r2 = await read(page);
  check('star', r2.rows.join() === 'DIFFUSION_BLACK,STAR' && r2.points[1] === '8' && r2.angle[1] === true && r2.undo?.includes('Points'), r2);
  // What the Fast viewport draws with the two filters (out/, for looking at: the approximation, not the render).
  await canvas.screenshot({ path: join(OUT, 'lens-filters-viewport.png') });
  const box = await page.locator('[data-optics="cameraFilters"]').first().boundingBox();
  if (box) await page.screenshot({ path: join(SHOTS, 'lens-filters.png'), clip: { x: box.x - 8, y: box.y - 4, width: box.width + 16, height: Math.min(box.height + 8, 800) } });

  await add.click();
  await settle(page, 400);
  const r3 = await read(page);
  check('max', r3.rows.length === 3 && r3.addDisabled === true && /Three filters at most/.test(r3.text), r3);

  await page.locator('[data-optics="cameraFilters"] [data-filter]').nth(2).locator('[data-action="filters.remove"]').click();
  await settle(page, 400);
  const r4 = await read(page);
  await page.keyboard.press('Control+z');
  await settle(page, 400);
  const r5 = await read(page);
  check('remove', r4.rows.length === 2 && r4.undo?.includes('Remove filter') && r5.rows.length === 3, { r4: r4.rows, r5: r5.rows });

  await page.locator('[data-section="camera"] [data-action="optics.reset"]').click();
  await settle(page, 400);
  const r6 = await read(page);
  check('reset', r6.rows.length === 3, { rows: r6.rows });
  check('no_errors', errors.length === 0, { errors });
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
  writeFileSync(join(OUT, 'lens-filters-check.json'), JSON.stringify(results, null, 2));
  const bad = Object.values(results).filter((r) => !r.ok).length;
  console.log(bad ? `${bad} checks failed` : 'all checks passed');
  process.exitCode = bad ? 1 : 0;
}
