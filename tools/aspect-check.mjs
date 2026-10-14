#!/usr/bin/env node
// Browser check of the aspect ratio of the camera (U13), with the local Chromium and swiftshader.
//
//   npm run build && node tools/aspect-check.mjs [--shots docs/ui] [--url http://host:port]
//
// Without --url it serves dist/ with `vite preview` on port 4191 and stops it at the end.
//
//   (a) a new project is 16:9: the camera chip says `16:9 · 1920 × 1080` and the frame of the viewport is 16:9;
//   (b) the Aspect ratio row of the scene's camera section set to 4:3: the frame changes to 4:3, the chip says
//       `4:3 · 1920 × 1440`, its w : h fields show 4 and 3 (off), and the render window's height follows (1440)
//       with its quiet line naming the camera;
//   (c) a size preset with another ratio (Portrait) changes the camera's aspect and the window says so
//       (`Camera 1's aspect becomes 4:5`); one undo gives the 4:3 and its size back;
//   (d) with the lock open a size typed in the window leaves Custom on the camera with those pixels as w : h, and
//       the row's w : h fields are enabled;
//   (e) a second camera keeps its own ratio: New from current view copies it, the camera list says it, and
//       activating the other camera moves frame, chip and size;
//   (f) the Doctor lists the animation's aspect ratio check.
//
// Screenshots (English, dark): camera-aspect.png (the camera section with 4:3 and the changed frame),
// render-size-from-camera.png (the render window with the height that follows the camera and its line).
// Results: out/aspect-check.json.

import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4191;
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

  /** The size chip at the top right of the viewport: the camera's ratio and the size. */
  const chip = () => page.evaluate(() => [...document.querySelectorAll('.ov-tr .ov-text-btn')].at(-1)?.textContent?.trim() ?? '');
  /** The frame of the viewport: the ratio of the edge the mask draws around the image. */
  const frame = () =>
    page.evaluate(() => {
      const r = document.querySelector('.frame-mask .frame-edge')?.getBoundingClientRect();
      return r ? { width: r.width, height: r.height, ratio: r.width / r.height } : null;
    });
  const near = (a, b, tol = 0.01) => a !== null && Math.abs(a - b) <= tol;
  const row = '[data-section="camera"] [data-field="aspect"]';
  const readRow = () =>
    page.evaluate((sel) => {
      const root = document.querySelector(sel);
      const nums = [...(root?.querySelectorAll('[role="spinbutton"]') ?? [])];
      return {
        list: root?.querySelector('select')?.value ?? null,
        terms: nums.map((n) => Number(n.getAttribute('aria-valuenow'))),
        off: nums.map((n) => n.classList.contains('is-disabled')),
      };
    }, row);
  const rwState = () =>
    page.evaluate(() => {
      const win = document.querySelector('.rw');
      const num = (label) => {
        const n = [...(win?.querySelectorAll('[role="spinbutton"]') ?? [])].find((e) => e.getAttribute('aria-label') === label && e.getClientRects().length > 0);
        return n ? Number(n.getAttribute('aria-valuenow')) : null;
      };
      return { width: num('Width'), height: num('Height'), line: win?.querySelector('[data-aspect-line]')?.textContent ?? null, preset: [...(win?.querySelectorAll('select[aria-label="Preset"]') ?? [])].find((e) => e.getClientRects().length > 0)?.value ?? null };
    });
  /** Types a value into a number field of the render window: double click, type, Enter. */
  const typeInto = async (label, value) => {
    const f = page.locator(`.rw [role="spinbutton"][aria-label="${label}"]:visible`).first();
    await f.dblclick();
    await page.keyboard.press('Control+A');
    await page.keyboard.type(String(value));
    await page.keyboard.press('Enter');
    await settle(page, 250);
  };

  // (a) 16:9 at the start.
  const chip0 = await chip();
  const frame0 = await frame();
  check('a_chip_16_9', chip0 === '16:9 · 1920 × 1080', { chip: chip0 });
  check('a_frame_16_9', frame0 && near(frame0.ratio, 16 / 9), { frame: frame0 });

  // (b) 4:3 on the camera section.
  await page.keyboard.press('Escape');
  await settle(page);
  await page.evaluate(() => document.querySelector('[data-section="camera"]')?.scrollIntoView({ block: 'start' }));
  await settle(page);
  const row0 = await readRow();
  check('b_row_starts_16_9', row0.list === '16:9' && row0.terms[0] === 16 && row0.terms[1] === 9 && row0.off.every(Boolean), row0);
  await page.locator(`${row} select`).selectOption('4:3');
  await settle(page, 500);
  const chip1 = await chip();
  const frame1 = await frame();
  const row1 = await readRow();
  check('b_chip_4_3', chip1 === '4:3 · 1920 × 1440', { chip: chip1 });
  check('b_frame_4_3', frame1 && near(frame1.ratio, 4 / 3), { frame: frame1 });
  check('b_row_terms', row1.list === '4:3' && row1.terms[0] === 4 && row1.terms[1] === 3 && row1.off.every(Boolean), row1);
  await page.evaluate(() => document.querySelector('[data-section="camera"]')?.scrollIntoView({ block: 'start' }));
  await settle(page);
  await page.screenshot({ path: join(SHOTS, 'camera-aspect.png') });

  // The render window: the height follows the camera.
  await page.locator('.ov-tr .ov-text-btn').last().click();
  await page.waitForSelector('.rw', { timeout: 10000 });
  await settle(page, 500);
  const rw1 = await rwState();
  check('b_window_follows', rw1.width === 1920 && rw1.height === 1440 && /Camera 1's aspect ratio, 4:3/.test(rw1.line ?? ''), rw1);
  await page.screenshot({ path: join(SHOTS, 'render-size-from-camera.png') });

  // (c) a size preset with another ratio.
  await page.locator('.rw select[aria-label="Preset"]:visible').first().selectOption('RES:PORTRAIT');
  await settle(page, 400);
  const rw2 = await rwState();
  const chip2 = await chip();
  const frame2 = await frame();
  check('c_window_says', rw2.width === 1080 && rw2.height === 1350 && rw2.line === "Camera 1's aspect becomes 4:5", rw2);
  check('c_chip_frame_follow', chip2 === '4:5 · 1080 × 1350' && frame2 && near(frame2.ratio, 4 / 5), { chip: chip2, frame: frame2 });
  // One undo gives the camera and the size back (Esc first: the window takes focus).
  await page.keyboard.press('Control+z');
  await settle(page, 400);
  const rw3 = await rwState();
  const chip3 = await chip();
  check('c_undo_both', rw3.width === 1920 && rw3.height === 1440 && chip3 === '4:3 · 1920 × 1440', { rw: rw3, chip: chip3 });

  // (d) the lock open: a size typed is the camera's ratio.
  await page.locator('.rw button[aria-label="Unlock the proportions"]:visible').first().click();
  await settle(page, 200);
  const rwOpen = await rwState();
  check('d_line_free', /A size you type becomes Camera 1's aspect ratio/.test(rwOpen.line ?? ''), rwOpen);
  await typeInto('Width', 1000);
  await typeInto('Height', 700);
  const rw4 = await rwState();
  const chip4 = await chip();
  const frame4 = await frame();
  check('d_custom_on_camera', rw4.width === 1000 && rw4.height === 700 && chip4 === '1.43:1 · 1000 × 700' && frame4 && near(frame4.ratio, 1000 / 700), { rw: rw4, chip: chip4, frame: frame4 });
  // Back to the lock closed, and out of the window.
  await page.locator('.rw button[aria-label="Lock the proportions"]:visible').first().click();
  await page.keyboard.press('Escape');
  await settle(page, 300);
  await page.evaluate(() => document.querySelector('[data-section="camera"]')?.scrollIntoView({ block: 'start' }));
  await settle(page);
  const row4 = await readRow();
  check('d_row_custom_enabled', row4.list === 'CUSTOM' && row4.terms[0] === 1000 && row4.terms[1] === 700 && row4.off.every((x) => !x), row4);

  // The w : h of the row, typed: the window follows (Custom 3 : 2 gives 1500 high at 1000 wide).
  const wField = page.locator(`${row} [role="spinbutton"]`).nth(0);
  const hField = page.locator(`${row} [role="spinbutton"]`).nth(1);
  await wField.dblclick();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('3');
  await page.keyboard.press('Enter');
  await settle(page, 250);
  await hField.dblclick();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('2');
  await page.keyboard.press('Enter');
  await settle(page, 400);
  const chip5 = await chip();
  check('d_row_terms_typed', chip5 === '3:2 · 1000 × 667', { chip: chip5 });
  await page.locator(`${row} select`).selectOption('16:9');
  await settle(page, 300);

  // (e) a second camera keeps its own ratio.
  await page.locator(`${row} select`).selectOption('4:3');
  await settle(page, 300);
  await page.locator('.side-left .tabs [role="tab"]', { hasText: 'Cameras' }).first().click();
  await settle(page);
  await page.locator('button', { hasText: 'New from current view' }).first().click();
  await settle(page, 400);
  const chip6 = await chip();
  check('e_new_camera_copies', chip6 === '4:3 · 1000 × 750', { chip: chip6 });
  await page.keyboard.press('Escape');
  await page.evaluate(() => document.querySelector('[data-section="camera"]')?.scrollIntoView({ block: 'start' }));
  await page.locator(`${row} select`).selectOption('1:1');
  await settle(page, 400);
  const chip7 = await chip();
  await page.locator('.ov-tr .ov-text-btn').first().click();
  await settle(page);
  const rows = await page.evaluate(() => [...document.querySelectorAll('.menu .menu-row')].map((r) => ({ label: r.querySelector('.menu-item > span:not(.check):not(.menu-right)')?.textContent ?? '', aux: r.querySelector('.menu-right .aux')?.textContent ?? '' })));
  check('e_list_has_ratios', rows.length === 2 && /· 4:3$/.test(rows[0].aux) && /· 1:1$/.test(rows[1].aux), { rows });
  await page.click('.menu .menu-row:nth-child(1) .menu-item');
  await settle(page, 400);
  const chip8 = await chip();
  const frame8 = await frame();
  check('e_activate_moves_frame', chip7 === '1:1 · 1000 × 1000' && chip8 === '4:3 · 1000 × 750' && frame8 && near(frame8.ratio, 4 / 3), { second: chip7, first: chip8, frame: frame8 });

  // (f) the Doctor.
  await page.locator('button.doctor-btn').first().click();
  await settle(page, 300);
  const doctor = await page.evaluate(() => [...document.querySelectorAll('.doctor-row .doctor-title')].map((e) => e.textContent));
  check('f_doctor_lists_aspect', doctor.includes('Animation aspect ratio'), { doctor });

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
  writeFileSync(join(OUT, 'aspect-check.json'), JSON.stringify(results, null, 2));
}
const failed = Object.entries(results).filter(([, r]) => !r.ok);
if (failed.length) {
  console.error(`${failed.length} check(s) failed: ${failed.map(([k]) => k).join(', ')}`);
  process.exit(1);
}
console.log('all good');
