#!/usr/bin/env node
// Browser check of the focal length's switch (phase C2; ROADMAP "Decisiones de criterio" 1.7), with the local Chromium
// and swiftshader, on the built interface.
//
//   npm run build && node tools/focal-check.mjs [--url http://host:port] [--shots docs/ui]
//
// Without --url it serves dist/ with `vite preview` on port 4203 and stops it at the end. The page is the example in the
// Fast view, its camera focused at its target (Distance), so the Focus distance field reads the plane the switch keeps.
//
//   (a) the switch *Keep the size of what is in focus* sits under Focal length, off, and its aux line says so (Off: …);
//   (b) off, a press of the focal's up arrow changes the focal and leaves the focus distance (the camera stays);
//   (c) on (one undo entry, "Camera: Keep the size of what is in focus"), the line says On: …, a press of the arrow
//       moves the focus distance by the focal ratio (the camera dollies), one undo entry ("Camera: Focal length") that
//       one Ctrl+Z takes back whole;
//   (d) a drag of the focal field is one undo entry: one Ctrl+Z puts focal and distance back;
//   (e) Orthographic: the line says the focal length does not frame there; a locked camera: it stays;
//   (f) the palette's command switches it off, with a toast; in Spanish the line reads in Spanish;
//   (g) the switch and its line are achromatic, in the dark and the light theme.
//
// Results: out/focal-check.json. With --shots <dir> (docs/ui for the gallery) it also writes c2-focal-switch.png (the
// camera's block from Lens preset to Aperture, the switch on).

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
const SHOTS = opt('shots', null) ? resolve(ROOT, opt('shots', null)) : null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
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
const SEC = '[data-section="camera"]';
const num = (v) => (v === null || v === undefined ? NaN : Number(v));

async function open(browser, base, { lang = 'en', theme = 'dark' } = {}) {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !m.text().startsWith('Failed to load resource') && errors.push(m.text()));
  await page.goto(`${base}/?example=1&theme=${theme}&lang=${lang}&mode=fast&tour=0`);
  await page.waitForSelector('#app[data-ready="1"]', { timeout: 90000 });
  await settle(page, 1500);
  await page.keyboard.press('Escape');
  await settle(page, 300);
  return { context, page, errors };
}

const focalField = (page, label = 'Focal length') => page.locator(`${SEC} [role="spinbutton"][aria-label="${label}"]`).first();
const focusField = (page, label = 'Focus distance') => page.locator(`${SEC} [role="spinbutton"][aria-label="${label}"]`).first();
const readFocal = (page) => focalField(page).getAttribute('aria-valuenow').then(num);
const readFocus = (page) => focusField(page).getAttribute('aria-valuenow').then(num);
const switchEl = (page) => page.locator(`${SEC} [data-keep-focus-size]`).first();
const noteText = (page) => page.locator(`${SEC} [data-focal-note]`).first().textContent();
const undoTip = (page) => page.locator('.hdr-center button[data-tip]').first().getAttribute('data-tip');
async function pressUp(page) {
  const up = focalField(page).locator('.num-up');
  await up.scrollIntoViewIfNeeded();
  const box = await up.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.up();
  await settle(page, 400);
}
async function undo(page) {
  await page.mouse.move(5, 500);
  await page.locator('.hdr-center button').first().click();
  await settle(page, 400);
}
/** The colour of an element's text, background and border, as r = g = b greys or not. */
const greys = (page, sel) =>
  page.locator(sel).first().evaluate((el) => {
    const cs = getComputedStyle(el);
    const out = [];
    for (const v of [cs.color, cs.backgroundColor, cs.borderTopColor]) {
      const m = v.match(/\d+(\.\d+)?/g)?.map(Number) ?? [];
      out.push({ v, grey: m.length < 3 || (m[0] === m[1] && m[1] === m[2]) });
    }
    const knob = getComputedStyle(el, '::after');
    const k = knob.backgroundColor.match(/\d+(\.\d+)?/g)?.map(Number) ?? [];
    out.push({ v: `::after ${knob.backgroundColor}`, grey: k.length < 3 || (k[0] === k[1] && k[1] === k[2]) });
    return out;
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

  {
    const { context, page, errors } = await open(browser, base);
    // (a) the switch under the focal, off, and its line.
    const sw = switchEl(page);
    await sw.scrollIntoViewIfNeeded();
    const focalBox = await focalField(page).boundingBox();
    const swBox = await sw.boundingBox();
    check('switch_under_the_focal', swBox && focalBox && swBox.y > focalBox.y && swBox.y - focalBox.y < 60, { focalY: focalBox?.y, switchY: swBox?.y });
    check('off_by_default', (await sw.getAttribute('aria-checked')) === 'false' && /^Off:/.test((await noteText(page)) ?? ''), { note: await noteText(page) });

    // (b) off: the camera stays.
    const f0 = await readFocal(page);
    const d0 = await readFocus(page);
    await pressUp(page);
    check('off_the_camera_stays', (await readFocal(page)) === f0 + 1 && (await readFocus(page)) === d0, { f0, f: await readFocal(page), d0, d: await readFocus(page) });
    await undo(page);
    check('off_undo', (await readFocal(page)) === f0, { f: await readFocal(page) });

    // (c) on: one entry for the switch, then the arrow dollies.
    await sw.click();
    await settle(page);
    const tipOn = await undoTip(page);
    check('on_is_one_entry', (await sw.getAttribute('aria-checked')) === 'true' && /Keep the size of what is in focus/.test(tipOn ?? '') && /^On:/.test((await noteText(page)) ?? ''), { tip: tipOn, note: await noteText(page) });
    if (SHOTS) {
      // The camera's block from its header down to Aperture, the switch on and its line.
      const sec = await page.locator(SEC).first().boundingBox();
      const ap = await focalField(page, 'Aperture').boundingBox();
      await page.mouse.move(5, 500);
      await settle(page, 300);
      await page.screenshot({ path: join(SHOTS, 'c2-focal-switch.png'), clip: { x: sec.x, y: sec.y, width: sec.width, height: Math.round(ap.y + ap.height + 8 - sec.y) } });
    }
    await pressUp(page);
    const f1 = await readFocal(page);
    const d1 = await readFocus(page);
    const want = d0 * (f1 / f0);
    check('on_the_camera_dollies', f1 === f0 + 1 && Math.abs(d1 - want) / want < 0.002, { f0, f1, d0, d1, want: Math.round(want * 10) / 10 });
    check('focal_is_one_entry', /Focal length/.test((await undoTip(page)) ?? ''), { tip: await undoTip(page) });
    await undo(page);
    check('one_undo_takes_the_step_back', (await readFocal(page)) === f0 && Math.abs((await readFocus(page)) - d0) < 0.5 && (await sw.getAttribute('aria-checked')) === 'true', { f: await readFocal(page), d: await readFocus(page) });

    // (d) a drag of the field: one gesture, one entry.
    const fb = await focalField(page).boundingBox();
    await page.mouse.move(fb.x + 20, fb.y + fb.height / 2);
    await page.mouse.down();
    for (let k = 1; k <= 8; k++) await page.mouse.move(fb.x + 20 + k * 6, fb.y + fb.height / 2);
    await page.mouse.up();
    await settle(page, 400);
    const f2 = await readFocal(page);
    const d2 = await readFocus(page);
    check('drag_dollies', f2 > f0 + 5 && Math.abs(d2 - d0 * (f2 / f0)) / d2 < 0.002, { f2, d2 });
    await undo(page);
    check('drag_is_one_entry', (await readFocal(page)) === f0 && Math.abs((await readFocus(page)) - d0) < 0.5, { f: await readFocal(page), d: await readFocus(page) });

    // (e) orthographic: the line says it; then a locked camera stays.
    const proj = page.locator(`${SEC} select[aria-label="Projection"]`).first();
    await proj.selectOption('ORTHOGRAPHIC');
    await settle(page);
    check('ortho_says_nothing_to_keep', /orthographic/i.test((await noteText(page)) ?? ''), { note: await noteText(page) });
    await undo(page);
    await page.locator('[aria-label="Lock camera"]').first().click();
    await settle(page);
    check('locked_says_it_stays', /locked/i.test((await noteText(page)) ?? ''), { note: await noteText(page) });
    await pressUp(page);
    check('locked_the_camera_stays', (await readFocus(page)) === d0, { d: await readFocus(page) });
    await undo(page);
    await undo(page);

    // (f) the palette's command switches it off, with a toast.
    await page.keyboard.press('Control+k');
    await page.waitForSelector('.palette-input');
    await page.keyboard.type('keep the size of what is in focus');
    await settle(page, 300);
    await page.keyboard.press('Enter');
    await settle(page, 500);
    const toast = (await page.locator('.toast').allTextContents()).join(' | ');
    check('palette_switches_it', (await sw.getAttribute('aria-checked')) === 'false' && /changes the framing/.test(toast), { toast });
    check('achromatic_dark', [...(await greys(page, `${SEC} [data-keep-focus-size]`)), ...(await greys(page, `${SEC} [data-focal-note]`))].every((g) => g.grey), { styles: await greys(page, `${SEC} [data-keep-focus-size]`) });
    check('no_page_errors', errors.length === 0, { errors });
    await context.close();
  }
  {
    const { context, page, errors } = await open(browser, base, { lang: 'es', theme: 'light' });
    const sw = page.locator(`${SEC} [data-keep-focus-size]`).first();
    await sw.scrollIntoViewIfNeeded();
    check('spanish_name_and_line', (await sw.getAttribute('aria-label')) === 'Mantener el tamaño de lo enfocado' && /^Apagado:/.test((await noteText(page)) ?? ''), { note: await noteText(page) });
    await sw.click();
    await settle(page);
    check('spanish_on', /^Encendido:/.test((await noteText(page)) ?? ''), { note: await noteText(page) });
    check('achromatic_light', [...(await greys(page, `${SEC} [data-keep-focus-size]`)), ...(await greys(page, `${SEC} [data-focal-note]`))].every((g) => g.grey), { styles: await greys(page, `${SEC} [data-keep-focus-size]`) });
    check('no_page_errors_es', errors.length === 0, { errors });
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
  writeFileSync(join(OUT, 'focal-check.json'), JSON.stringify(results, null, 2));
}
const failed = Object.entries(results).filter(([, r]) => !r.ok);
if (failed.length) {
  console.error(`${failed.length} check(s) failed: ${failed.map(([k]) => k).join(', ')}`);
  process.exit(1);
}
console.log('all good');
