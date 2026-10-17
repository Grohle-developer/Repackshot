#!/usr/bin/env node
// Browser check of the step buttons of the number fields and of the fields turned into sliders (U15), with the local
// Chromium and swiftshader.
//
//   npm run build && node tools/number-fields-check.mjs [--shots docs/ui] [--url http://host:port]
//
// Without --url it serves dist/ with `vite preview` on port 4215 and stops it at the end.
//
//   (a) every number field on the default screen has its pair of step buttons, named Increase and Decrease, not
//       tab stops;
//   (b) a click on ▲ of Focal length is one step (85 → 86 mm) and one undo entry; holding ▼ steps it again and
//       again and is one more undo entry, which one undo takes back whole;
//   (c) an own light shows Azimuth, Elevation and Spread as sliders with their field, and Distance as a field;
//   (d) Settings ▸ Preferences shows Orbit speed, Zoom speed and Gizmo size as sliders; Interface size stays a field.
//
// Screenshots (English, dark, 1600 × 1000, reduced motion): u15-light-fields.png (an own light: fields and sliders
// with their step buttons), u15-part-triplets.png (the inspector column with the Part section's X, Y, Z triplets and
// their compact pair, the pointer on one ▲), u15-settings-sliders.png (Settings ▸ Preferences with the converted
// sliders). Results: out/number-fields-check.json.

import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4215;
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
  const errors = [];
  const open = async (query) => {
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && !m.text().startsWith('Failed to load resource') && errors.push(m.text()));
    await page.goto(`${base}/?example=1&theme=dark&lang=en&mode=fast&tour=0${query ? `&${query}` : ''}`);
    await page.waitForSelector('#app[data-ready="1"]', { timeout: 60000 });
    await settle(page, 800);
    return page;
  };
  const undoTip = (page) => page.evaluate(() => document.querySelector('.hdr button[aria-label="Undo"]')?.getAttribute('data-tip') ?? '');
  const valueOf = (page, label) => page.evaluate((l) => Number(document.querySelector(`[role="spinbutton"][aria-label="${l}"]`)?.getAttribute('aria-valuenow')), label);

  // (a) the pair on every field of the default screen.
  let page = await open('');
  const pairs = await page.evaluate(() =>
    [...document.querySelectorAll('.num')]
      .filter((n) => n.getClientRects().length > 0)
      .map((n) => [...n.querySelectorAll('.num-step')].map((b) => `${b.getAttribute('aria-label')}:${b.tabIndex}`).join(',')),
  );
  check('a_every_field_has_its_pair', pairs.length > 10 && pairs.every((p) => p === 'Increase:-1,Decrease:-1'), { fields: pairs.length, odd: pairs.filter((p) => p !== 'Increase:-1,Decrease:-1').slice(0, 3) });

  // (b) a click is one step and one undo entry; a hold is many steps and one more.
  await page.evaluate(() => document.querySelector('[data-section="camera"]')?.scrollIntoView({ block: 'start' }));
  await settle(page);
  const focal = '[data-section="camera"] [role="spinbutton"][aria-label="Focal length"]';
  const f0 = await valueOf(page, 'Focal length');
  await page.click(`${focal} .num-up`);
  await settle(page);
  const f1 = await valueOf(page, 'Focal length');
  const tip1 = await undoTip(page);
  const down = await page.locator(`${focal} .num-down`).boundingBox();
  await page.mouse.move(down.x + down.width / 2, down.y + down.height / 2);
  await page.mouse.down();
  // Held until it has repeated a few times (the software GL of the check redraws the viewport after every step, so
  // on a loaded machine the repeats can come slower than every 50 ms).
  for (let end = Date.now() + 20000; Date.now() < end && (await valueOf(page, 'Focal length')) > f1 - 5; ) await page.waitForTimeout(100);
  await page.mouse.up();
  await settle(page);
  const f2 = await valueOf(page, 'Focal length');
  await page.keyboard.press('Control+z');
  await settle(page);
  const f3 = await valueOf(page, 'Focal length');
  await page.keyboard.press('Control+z');
  await settle(page);
  const f4 = await valueOf(page, 'Focal length');
  check('b_click_is_one_step', f1 === f0 + 1 && /Focal length/.test(tip1), { f0, f1, tip1 });
  check('b_hold_is_one_undo_entry', f2 <= f1 - 5 && f3 === f1 && f4 === f0, { held: f2, afterOneUndo: f3, afterTwo: f4 });
  await page.context().close();

  // (c) an own light: the angles are sliders with their field.
  page = await open('select=cap');
  await page.locator('[role=tab]', { hasText: /^Lights$/ }).first().click();
  await page.click('[data-add="light"]');
  await page.waitForSelector('[role=menu]');
  await page.locator('[role=menu] button').nth(1).click();
  await page.waitForSelector('[data-field="light"]');
  await settle(page, 600);
  const light = await page.evaluate(() => {
    const root = document.querySelector('[data-field="light"]');
    const kind = (label) => {
      const n = root?.querySelector(`[role="spinbutton"][aria-label="${label}"]`);
      return n ? (n.closest('.slider')?.querySelector('input[type=range]') ? 'slider' : 'field') : null;
    };
    return { azimuth: kind('Azimuth'), elevation: kind('Elevation'), spread: kind('Spread'), distance: kind('Distance'), power: kind('Power') };
  });
  check('c_light_angles_are_sliders', light.azimuth === 'slider' && light.elevation === 'slider' && light.spread === 'slider' && light.distance === 'field' && light.power === 'field', light);
  await page.screenshot({ path: join(SHOTS, 'u15-light-fields.png') });
  await page.context().close();

  // The Part section's triplets, the pointer on ▲ of Position X.
  page = await open('select=cap');
  await page.evaluate(() => document.querySelector('[data-section="part"]')?.scrollIntoView({ block: 'start' }));
  await settle(page);
  const up = await page.locator('[data-section="part"] .field-row3 .num').first().locator('.num-up').boundingBox();
  await page.mouse.move(up.x + up.width / 2, up.y + up.height / 2);
  await settle(page);
  const column = await page.locator('.side-right').boundingBox();
  await page.screenshot({ path: join(SHOTS, 'u15-part-triplets.png'), clip: { x: column.x, y: column.y, width: column.width, height: Math.min(column.height, 740) } });
  await page.context().close();

  // (d) Settings ▸ Preferences.
  page = await open('settings=preferences');
  const prefs = await page.evaluate(() => {
    const kind = (row) => {
      const r = document.querySelector(`[data-row="${row}"]`);
      return r ? (r.querySelector('.slider input[type=range]') ? 'slider' : r.querySelector('[role="spinbutton"]') ? 'field' : 'other') : null;
    };
    return { orbit: kind('viewport.orbitSpeed'), zoom: kind('viewport.zoomSpeed'), gizmo: kind('viewport.gizmoSize') };
  });
  check('d_preferences_sliders', prefs.orbit === 'slider' && prefs.zoom === 'slider' && prefs.gizmo === 'slider', prefs);
  await page.screenshot({ path: join(SHOTS, 'u15-settings-sliders.png') });
  await page.click('.sw-option[data-section="accessibility"]');
  await settle(page);
  const ui = await page.evaluate(() => (document.querySelector('[data-row="a11y.uiScale"] .slider') ? 'slider' : document.querySelector('[data-row="a11y.uiScale"] [role="spinbutton"]') ? 'field' : null));
  check('d_interface_size_stays_a_field', ui === 'field', { ui });
  await page.context().close();

  check('no_page_errors', errors.length === 0, { errors: errors.slice(0, 5) });
} finally {
  writeFileSync(join(OUT, 'number-fields-check.json'), JSON.stringify(results, null, 2));
  await browser?.close();
  if (server) stopServer();
}
const failed = Object.entries(results).filter(([, r]) => !r.ok);
if (failed.length) {
  console.error(`${failed.length} check(s) failed: ${failed.map(([k]) => k).join(', ')}`);
  process.exit(1);
}
console.log('all checks passed');
