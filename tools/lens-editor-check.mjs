#!/usr/bin/env node
// Browser check of the lens editor (phase O2c) in the built app, with the local Chromium and swiftshader. It needs the
// engine in dist/ (npm run engine:build before npm run build): the editor's section and numbers are the engine's, asked
// of the page's own rt.wasm for the copy being edited.
//
//   npm run engine:build && npm run build && node tools/lens-editor-check.mjs [--shots docs/ui] [--url http://host:port]
//
// Without --url it serves dist/ with `vite preview` on port 4207 and stops it at the end.
//
//   open        Camera ▸ Lens ▸ Traced lens ▸ Edit elements… opens the editor on the double Gauss, with the engine's
//               section, its seven rows (six elements and the iris) and the design's focal length;
//   add         Add after the first element: eight rows, a shorter focal length of the design, one undo entry;
//   rotate      Turn 180° the front element: another focal length of the system and another back focus;
//   apply       Apply to the camera: the camera's lens is the edited one (Camera ▸ Lens says so, with its section),
//               the catalogue lens is untouched (choosing it again gives it back);
//   errors      no page errors.
//
// Screenshots (English, light): o2c-lens-editor.png, the editor open on the catalogue lens over the application;
// o2c-lens-modified.png, the copy with an element added and the front one turned round, checked by the engine and
// ready to apply.
// Results: out/lens-editor-check.json.

import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4207;
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

const settle = (page, ms = 250) => page.evaluate((w) => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, w)))), ms);

/** Waits for an answer of the engine newer than `after` for the lens in the editor. */
const engineSaid = (page, after = 0) =>
  page.waitForFunction(
    (n) => {
      const w = document.querySelector('[data-lens-editor]');
      const info = document.querySelector('[data-le-info]');
      return !!w && Number(w.dataset.checks ?? 0) > n && !!info?.querySelector('[data-value="designFocal"]') && !info.hasAttribute('data-stale');
    },
    after,
    { timeout: 60000 },
  );
const checks = (page) => page.evaluate(() => Number(document.querySelector('[data-lens-editor]')?.dataset.checks ?? 0));
const number = async (page, key) => Number(((await page.locator(`[data-le-info] [data-value="${key}"]`).textContent()) ?? '').replace(/[^0-9.,-]/g, ' ').trim().split(/\s+/)[0].replace(',', '.'));
const rows = (page) => page.locator('[data-le-list] tbody tr').count();
const glass = (page) => page.locator('[data-le-section] path[data-surface]').count();

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
  await page.goto(`${base}/?example=1&theme=light&lang=en&mode=fast`);
  await page.waitForSelector('#app[data-ready="1"]', { timeout: 60000 });
  await settle(page, 800);
  await page.keyboard.press('Escape');
  const head = page.locator('[data-section="camera"] [data-action="cameraLens"]');
  await head.scrollIntoViewIfNeeded();
  if ((await head.getAttribute('aria-expanded')) !== 'true') await head.click();
  await settle(page, 300);
  const sub = page.locator('[data-optics="cameraLens"]');
  await sub.locator('[aria-label="Lens model"] button', { hasText: 'Traced lens' }).click();
  await page.waitForSelector('[data-optics="cameraLens"] [data-value="camera.lensInfoElements"]', { timeout: 30000 });

  // --- open ------------------------------------------------------------------------------------------------------
  const edit = sub.locator('[data-action="lens.editElements"]');
  await edit.scrollIntoViewIfNeeded();
  await edit.click();
  await engineSaid(page);
  await settle(page, 400);
  const focal0 = await number(page, 'designFocal');
  const back0 = await number(page, 'back');
  check('open', (await rows(page)) === 7 && (await glass(page)) === 6 && focal0 > 95 && focal0 < 106, { rows: await rows(page), glass: await glass(page), focal0, back0 });
  await page.screenshot({ path: join(SHOTS, 'o2c-lens-editor.png') });

  // --- add --------------------------------------------------------------------------------------------------------
  await page.locator('[data-le-row="0"] .le-row-btn').click();
  let n = await checks(page);
  await page.locator('[data-le-add-after]').click();
  await engineSaid(page, n);
  const focal1 = await number(page, 'designFocal');
  check('add', (await rows(page)) === 8 && (await glass(page)) === 7 && focal1 < focal0 - 1, { rows: await rows(page), focal1 });

  // --- rotate -----------------------------------------------------------------------------------------------------
  const back1 = await number(page, 'back');
  await page.locator('[data-le-row="0"] .le-row-btn').click();
  n = await checks(page);
  await page.locator('[data-le-rotate]').click();
  await engineSaid(page, n);
  const focal2 = await number(page, 'designFocal');
  const back2 = await number(page, 'back');
  check('rotate', Math.abs(focal2 - focal1) > 0.05 && back2 !== back1, { focal2, back1, back2 });

  // --- apply ------------------------------------------------------------------------------------------------------
  await page.waitForSelector('[data-le-status][data-state="ready"]');
  await settle(page, 400);
  await page.screenshot({ path: join(SHOTS, 'o2c-lens-modified.png') });
  await page.locator('[data-le-apply]').click();
  await page.waitForSelector('[data-optics="cameraLens"] [data-lens-edited]:not([style*="display: none"])', { timeout: 10000 });
  await page.waitForSelector('[data-optics="cameraLens"] [data-value="camera.lensInfoElements"]', { timeout: 30000 });
  const edited = await sub.locator('[data-lens-edited]').textContent();
  const elements = await sub.locator('[data-value="camera.lensInfoElements"]').textContent();
  check('apply', /edited/i.test(edited ?? '') && elements === '7 · 5', { edited, elements });
  check('errors', errors.length === 0, { errors });
  await context.close();
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
  writeFileSync(join(OUT, 'lens-editor-check.json'), JSON.stringify(results, null, 2));
  const bad = Object.values(results).filter((r) => r && r.ok === false).length;
  console.log(bad ? `${bad} checks failed` : 'all checks passed');
  process.exitCode = bad ? 1 : 0;
}
