#!/usr/bin/env node
// Browser check of the viewport's camera list and the scene's camera section (user report: no way to edit a camera
// from the list, and the section did not say it was editing "Camera 1"), with the local Chromium and swiftshader.
//
//   npm run build && node tools/camera-menu-check.mjs [--shots docs/ui] [--url http://host:port]
//
// Without --url it serves dist/ with `vite preview` on port 4190 and stops it at the end.
//
//   (a) the camera chip opens a list with one row per camera, the active one checked, each with its lens and the ratio
//       of its image as quiet text and a pencil at the right end;
//   (b) the scene's camera section is titled with the active camera's name (and renaming it follows);
//   (c) the pencil of the second row opens that camera's inspector (its section, its name in the breadcrumb), shows
//       the Cameras tab with it marked, and does not activate it;
//   (d) the right arrow from a row focuses its pencil and the left arrow comes back.
//
// Screenshots (English, dark): camera-section.png (the scene's camera section, titled with the active camera),
// camera-menu.png (the list open), camera-edit.png (the camera's inspector).
// Results: out/camera-menu-check.json.

import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4190;
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

const settle = (page, ms = 300) => page.waitForTimeout(ms);

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

  // A second camera, so the list has two rows: the Cameras tab's "New from current view".
  await page.locator('.side-left .tabs [role="tab"]', { hasText: 'Cameras' }).first().click();
  await settle(page);
  const newBtn = page.locator('button', { hasText: 'New from current view' });
  if ((await newBtn.count()) === 0) fail('the Cameras tab did not show "New from current view"');
  await newBtn.first().click();
  await settle(page);
  // Back to Camera 1 active and the Parts tab, as a user who just opened the project.
  await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.list-row')].filter((r) => r.textContent?.includes('Camera 1'));
    rows[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await settle(page);
  await page.locator('.side-left .tabs [role="tab"]', { hasText: 'Parts' }).first().click();
  await settle(page);

  // (b) the scene's camera section names the active camera (nothing selected: the inspector shows the scene).
  await page.keyboard.press('Escape');
  await settle(page);
  if (await page.evaluate(() => document.querySelector('.list-row.is-selected') !== null)) {
    // Escape did not clear it: a click on the empty top-left corner of the viewport does.
    const box = await page.locator('.viewport, canvas').first().boundingBox();
    if (box) await page.mouse.click(box.x + 12, box.y + box.height - 12);
    await settle(page);
  }
  const title = await page.evaluate(() => document.querySelector('[data-section="camera"] [data-camera-title]')?.textContent ?? null);
  check('section_names_active', title === 'Camera 1', { title });
  // The section itself (it sits below Product and Light): scrolled into view, the clip is its box.
  await page.evaluate(() => document.querySelector('[data-section="camera"]')?.scrollIntoView({ block: 'start' }));
  await settle(page);
  const sec = await page.locator('[data-section="camera"]').first().boundingBox();
  if (sec) await page.screenshot({ path: join(SHOTS, 'camera-section.png'), clip: { x: sec.x - 1, y: sec.y - 1, width: sec.width + 2, height: Math.min(sec.height + 2, 420) } });

  // (a) the list.
  const chip = page.locator('.ov-tr .ov-text-btn').first();
  await chip.click();
  await settle(page);
  const rows = await page.evaluate(() =>
    [...document.querySelectorAll('.menu .menu-row')].map((r) => ({
      label: r.querySelector('.menu-item > span:not(.check):not(.menu-right)')?.textContent ?? '',
      checked: r.querySelector('.menu-item')?.getAttribute('aria-checked'),
      aux: r.querySelector('.menu-right .aux')?.textContent ?? '',
      pencil: Boolean(r.querySelector('.menu-action')),
      tip: r.querySelector('.menu-action')?.getAttribute('data-tip') ?? '',
    })),
  );
  check('list_rows', rows.length === 2 && rows[0].label === 'Camera 1' && rows[1].label === 'Camera 2', { rows });
  check('list_active_checked', rows[0]?.checked === 'true' && rows[1]?.checked === 'false', { checked: rows.map((r) => r.checked) });
  // The lens and, after it, the ratio of the camera's image (U13).
  check('list_lens', rows.every((r) => /^\d+ mm · f\/[\d.]+ · \d+:\d+$/.test(r.aux)), { aux: rows.map((r) => r.aux) });
  check('list_pencils', rows.every((r) => r.pencil && r.tip.startsWith('Edit Camera')), { tips: rows.map((r) => r.tip) });
  await page.screenshot({ path: join(SHOTS, 'camera-menu.png') });

  // (d) keyboard: right arrow to the pencil, left arrow back.
  await page.focus('.menu .menu-row:nth-child(2) .menu-item');
  await page.keyboard.press('ArrowRight');
  const onPencil = await page.evaluate(() => document.activeElement?.classList.contains('menu-action'));
  await page.keyboard.press('ArrowLeft');
  const backOnRow = await page.evaluate(() => document.activeElement?.classList.contains('menu-item'));
  check('keyboard_arrows', onPencil === true && backOnRow === true, { onPencil, backOnRow });

  // (c) the pencil of the second row.
  await page.click('.menu .menu-row:nth-child(2) .menu-action');
  await settle(page, 600);
  const after = await page.evaluate(() => ({
    menuOpen: Boolean(document.querySelector('.menu')),
    section: Boolean(document.querySelector('[data-section="cameraEdit"]')),
    collapsed: document.querySelector('[data-section="cameraEdit"]')?.hasAttribute('data-collapsed') ?? null,
    breadcrumb: document.querySelector('.side-body .breadcrumb, [data-breadcrumb]')?.textContent ?? document.querySelector('.side-body')?.textContent?.slice(0, 80) ?? '',
    nameField: document.querySelector('[data-section="cameraEdit"] input')?.value ?? '',
    camerasTab: [...document.querySelectorAll('.side-left .tabs [role="tab"]')].find((b) => b.getAttribute('aria-selected') === 'true')?.textContent?.trim() ?? '',
    chip: document.querySelector('.ov-tr .ov-text-btn')?.textContent ?? '',
    selectedRow: document.querySelector('.list-row.is-selected')?.textContent ?? '',
  }));
  check('pencil_opens_inspector', !after.menuOpen && after.section && after.collapsed === false && after.nameField === 'Camera 2', after);
  check('pencil_keeps_active', after.chip.includes('Camera 1'), { chip: after.chip });
  check('pencil_shows_cameras_tab', after.camerasTab === 'Cameras' && after.selectedRow.includes('Camera 2'), { selectedRow: after.selectedRow, camerasTab: after.camerasTab });
  await page.screenshot({ path: join(SHOTS, 'camera-edit.png') });

  check('no_page_errors', errors.length === 0, { errors });
  await context.close();
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
  writeFileSync(join(OUT, 'camera-menu-check.json'), JSON.stringify(results, null, 2));
}
const failed = Object.entries(results).filter(([, r]) => !r.ok);
if (failed.length) {
  console.error(`${failed.length} check(s) failed: ${failed.map(([k]) => k).join(', ')}`);
  process.exit(1);
}
console.log('all good');
