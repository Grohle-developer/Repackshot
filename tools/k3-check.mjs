#!/usr/bin/env node
// Browser checks of phase K3 (the interior camera) in the built app, with the local Chromium and swiftshader.
//
//   npm run engine:build && npm run build && node tools/k3-check.mjs [--url http://localhost:4198] [--shots docs/ui]
//       [--only verticals,plan,panorama,chrome] [--samples 24]
//
// Without --url it serves dist/ with `vite preview` on port 4198 and stops it at the end. Each check opens the test room
// (tests/fixtures/k3-room.repack.json: a room of boxes, the scene type Interior, a 24 mm camera 1.5 m up tilted 10°
// down at the sofa; tests/browser/k3-room-scene.ts builds it) with Open project.
//
//   verticals  Camera ▸ Straight verticals: the switch is one undo entry (Camera: Straight verticals), the note says the
//              shift for the tilt, the picture changes; the Full engine renders it (docs/ui/k3-verticals.png).
//   plan       Views ▸ Plan makes the camera orthographic from above; a click in the middle selects the ceiling; Part ▸
//              Visible to camera off is one undo entry (Hide Ceiling from the camera) and the picture shows the floor
//              plan; the Full engine renders the room under it lit (docs/ui/k3-plan.png); the automatic exposure says
//              what it metered (the Image section and the status bar).
//   panorama   Camera ▸ Projection ▸ Panorama 360° (2:1) puts the 2:1 frame; Fast draws it from six cube faces, the
//              status bar says so; the Full engine renders it (docs/ui/k3-panorama.png).
//   chrome     the new controls of the Camera and Image sections are achromatic in both themes, and Spanish names them.
//
// Results: out/k3-check.json.

import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4198;
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const SHOTS = resolve(ROOT, opt('shots', 'docs/ui'));
const OUT = join(ROOT, 'out');
const ROOM = join(ROOT, 'tests', 'fixtures', 'k3-room.repack.json');
const SAMPLES = Number(opt('samples', '24'));
mkdirSync(OUT, { recursive: true });
mkdirSync(SHOTS, { recursive: true });
const results = {};
const fail = (msg) => {
  throw new Error(msg);
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

function stopServer(port) {
  const run = spawnSync('lsof', ['-t', '-i', `:${port}`]);
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

let BASE_URL = opt('url', null);

/** A page of the app (the File System Access pickers are taken away so that Save downloads and Open asks with the input). */
async function open(browser, query) {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1, acceptDownloads: true });
  await context.addInitScript(() => {
    for (const n of ['showSaveFilePicker', 'showOpenFilePicker']) Object.defineProperty(window, n, { value: undefined, configurable: true });
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    const text = m.text();
    if ((m.type() === 'error' && !text.startsWith('Failed to load resource')) || /Shader Error|WebGLProgram/.test(text)) errors.push(text);
  });
  await page.goto(`${BASE_URL}/?${query}`);
  await page.waitForSelector('#app[data-ready="1"]', { timeout: 60000 });
  return { page, context, errors };
}

const settle = (page, ms = 60) => page.evaluate((wait) => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, wait)))), ms);
const ok = (cond, text, failures) => {
  if (!cond) failures.push(text);
  return cond;
};
const canvas = (page) => page.locator('canvas[aria-label="viewport"]');
const undoTip = (page) => page.locator('.hdr button[aria-label="Undo"]').getAttribute('data-tip');

/** Polls `test` (an async predicate) until it holds or `ms` passes; whether it held. A loaded machine paints late. */
async function until(test, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await test()) return true;
    await new Promise((r) => setTimeout(r, 150));
  }
  return test();
}

/** The pixels of the viewport canvas as an RGB array (from a screenshot). */
async function viewportPixels(page) {
  const box = await canvas(page).boundingBox();
  const png = (await page.screenshot({ clip: box })).toString('base64');
  return page.evaluate(async (png) => {
    const img = new Image();
    img.src = `data:image/png;base64,${png}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    return Array.from(g.getImageData(0, 0, c.width, c.height).data);
  }, png);
}
const changed = (a, b) => {
  let n = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i += 4) if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 24) n++;
  return n;
};

/** Every element under `selector` whose computed colours are not grey (images and canvases left out). */
const chromatic = (page, selector) =>
  page.evaluate((selector) => {
    const bad = [];
    const grey = (c) => {
      const m = /rgba?\(([^)]+)\)/.exec(c);
      if (!m) return true;
      const [r, g, b, a] = m[1].split(',').map((x) => Number(x.trim()));
      return a === 0 || (r === g && g === b);
    };
    for (const root of document.querySelectorAll(selector)) {
      for (const el of [root, ...root.querySelectorAll('*')]) {
        if (el.tagName === 'IMG' || el.tagName === 'CANVAS' || (el.tagName === 'INPUT' && el.type === 'color')) continue;
        const s = getComputedStyle(el);
        for (const p of ['color', 'backgroundColor', 'borderTopColor', 'borderBottomColor', 'outlineColor']) if (!grey(s[p])) bad.push(`${el.className || el.tagName}: ${p} ${s[p]}`);
      }
    }
    return bad.slice(0, 10);
  }, selector);


const CAMERA = 'section.section[data-section="camera"]';
const IMAGE = 'section.section[data-section="image"]';
const meterSamples = (page) => page.evaluate(() => Number(document.querySelector('.ov-bl')?.dataset.samples ?? 0));

/** Opens the test room in a page of the app (Open project, the file chooser). */
async function openRoom(browser, query) {
  const b = await open(browser, query);
  const chooser = b.page.waitForEvent('filechooser', { timeout: 30000 });
  await canvas(b.page).focus();
  await b.page.keyboard.press('Control+o');
  const dont = b.page.getByRole('button', { name: /Don.t save|No guardar/ });
  if (await dont.isVisible().catch(() => false)) await dont.click();
  await (await chooser).setFiles(ROOM);
  await b.page.waitForFunction(() => [...document.querySelectorAll('.tree-name')].some((e) => /Test room/.test(e.textContent ?? '')), null, { timeout: 60000 });
  await settle(b.page, 400);
  return b;
}

/** Opens a section of the inspector if it is folded and brings it into view. */
async function openSection(page, selector) {
  const sec = page.locator(selector);
  await sec.scrollIntoViewIfNeeded();
  if ((await sec.getAttribute('data-collapsed')) !== null) await sec.locator('.section-head').click();
  await settle(page, 100);
}

/** Switches the viewport to Full and waits for `n` samples of what is asked now (at most `ms`). */
async function full(page, n, ms = 900000) {
  if ((await page.evaluate(() => document.querySelector('.ov-bl')?.dataset.mode)) !== 'full') {
    await canvas(page).focus();
    await page.keyboard.press('Control+Shift+R');
  }
  await page.waitForFunction(() => document.querySelector('.ov-bl')?.dataset.mode === 'full', null, { timeout: 120000 });
  await page
    .waitForFunction(
      (want) => {
        const m = document.querySelector('.ov-bl');
        return m && Number(m.dataset.samples) >= want && m.dataset.shownKey === m.dataset.wantKey;
      },
      n,
      { timeout: ms, polling: 500 },
    )
    .catch(() => {});
  await settle(page, 300);
}

async function fast(page) {
  if ((await page.evaluate(() => document.querySelector('.ov-bl')?.dataset.mode)) === 'full') {
    await canvas(page).focus();
    await page.keyboard.press('Control+Shift+R');
  }
  await page.waitForFunction(() => document.querySelector('.ov-bl')?.dataset.mode !== 'full', null, { timeout: 60000 });
  await settle(page, 300);
}

const mean = (px) => {
  let s = 0;
  for (let i = 0; i < px.length; i += 4) s += px[i] + px[i + 1] + px[i + 2];
  return s / (px.length / 4) / 3;
};

async function verticalsCheck(browser) {
  const f = [];
  const log = {};
  const { page, context, errors } = await openRoom(browser, 'theme=dark&lang=en&mode=fast&tour=0');
  await openSection(page, CAMERA);
  const sw = page.locator(`${CAMERA} [role="switch"][aria-label="Straight verticals"]`);
  ok((await sw.count()) === 1, 'Camera has no Straight verticals switch', f);
  ok((await sw.getAttribute('aria-checked')) === 'false', 'the room opens with straight verticals on', f);
  const before = await viewportPixels(page);
  await sw.click();
  await settle(page, 500);
  ok((await sw.getAttribute('aria-checked')) === 'true', 'the switch did not go on', f);
  log.undo = await undoTip(page);
  ok(/Straight verticals/.test(log.undo ?? ''), `the undo does not name it: ${log.undo}`, f);
  log.note = await page.locator(`${CAMERA} [data-verticals]`).textContent();
  ok(/Shift .*mm for 10(\.0)?° of tilt/.test(log.note ?? ''), `the note does not give the shift for the tilt: ${log.note}`, f);
  const after = await viewportPixels(page);
  log.pixelsChanged = changed(before, after);
  ok(log.pixelsChanged > 2000, `the picture did not change: ${log.pixelsChanged}`, f);
  await page.screenshot({ path: join(SHOTS, 'k3-verticals-fast.png') });
  if (existsSync(join(ROOT, 'dist', 'engine', 'rt.wasm'))) {
    await full(page, SAMPLES);
    log.samples = await meterSamples(page);
    await page.screenshot({ path: join(SHOTS, 'k3-verticals.png') });
  } else log.full = 'skipped: no rt.wasm';
  ok(errors.length === 0, `errors in the page: ${errors.join(' | ')}`, f);
  await context.close();
  results.verticals = { ok: f.length === 0, failures: f, ...log };
  console.log(`verticals: ${f.length === 0 ? 'OK' : `FAILED\n  - ${f.join('\n  - ')}`}`);
}

async function planCheck(browser) {
  const f = [];
  const log = {};
  const { page, context, errors } = await openRoom(browser, 'theme=dark&lang=en&mode=fast&tour=0');
  await page.locator('button[aria-label="Views"]').first().click();
  await page.getByRole('menuitem', { name: 'Plan' }).click();
  await settle(page, 600);
  await openSection(page, CAMERA);
  log.projection = await page.locator(`${CAMERA} select[aria-label="Projection"]`).inputValue();
  ok(log.projection === 'ORTHOGRAPHIC', `the plan is not orthographic: ${log.projection}`, f);
  const roof = await viewportPixels(page);
  const box = await canvas(page).boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await settle(page, 500);
  log.selected = await page.locator('section.section[data-section="part"] [data-field="name"] input, section.section[data-section="part"] input[data-field="name"]').first().inputValue().catch(() => null);
  const sw = page.locator('section.section[data-section="part"] [role="switch"][aria-label="Visible to camera"]');
  ok((await sw.count()) === 1, 'the Part section has no Visible to camera switch', f);
  await sw.click();
  await settle(page, 600);
  log.undo = await undoTip(page);
  ok(/Hide Ceiling from the camera/.test(log.undo ?? ''), `the undo does not hide the ceiling: ${log.undo} (selected ${log.selected})`, f);
  const plan = await viewportPixels(page);
  log.pixelsChanged = changed(roof, plan);
  ok(log.pixelsChanged > 5000, `the plan did not show what is under the ceiling: ${log.pixelsChanged}`, f);
  await page.screenshot({ path: join(SHOTS, 'k3-plan-fast.png') });
  if (existsSync(join(ROOT, 'dist', 'engine', 'rt.wasm'))) {
    await full(page, SAMPLES);
    log.samples = await meterSamples(page);
    log.mean = mean(await viewportPixels(page));
    ok(log.mean > 12, `the room under the hidden ceiling is dark in Full: mean ${log.mean}`, f);
    await openSection(page, IMAGE);
    await page.waitForFunction(() => /EV/.test(document.querySelector('[data-metered]')?.textContent ?? ''), null, { timeout: 120000 }).catch(() => {});
    log.metered = await page.locator(`${IMAGE} [data-metered]`).textContent();
    ok(/Metered from the engine.s image: [+−-]?\d/.test(log.metered ?? ''), `the automatic exposure says no reading: ${log.metered}`, f);
    log.meter = await page.locator('[data-meter="exposure"]').textContent();
    ok(/Auto exposure [+−-]?\d/.test(log.meter ?? ''), `the status bar says no reading: ${log.meter}`, f);
    await openSection(page, CAMERA);
    await page.screenshot({ path: join(SHOTS, 'k3-plan.png') });
  } else log.full = 'skipped: no rt.wasm';
  ok(errors.length === 0, `errors in the page: ${errors.join(' | ')}`, f);
  await context.close();
  results.plan = { ok: f.length === 0, failures: f, ...log };
  console.log(`plan: ${f.length === 0 ? 'OK' : `FAILED\n  - ${f.join('\n  - ')}`}`);
}

async function panoramaCheck(browser) {
  const f = [];
  const log = {};
  const { page, context, errors } = await openRoom(browser, 'theme=dark&lang=en&mode=fast&tour=0');
  await openSection(page, CAMERA);
  const before = await viewportPixels(page);
  await page.locator(`${CAMERA} select[aria-label="Projection"]`).selectOption('EQUIRECTANGULAR');
  await settle(page, 1500);
  log.undo = await undoTip(page);
  ok(/Panorama/.test(log.undo ?? ''), `the undo does not name the panorama: ${log.undo}`, f);
  log.ratio = await page.locator('.ov-tr').textContent().catch(() => '');
  ok(/2:1/.test(log.ratio ?? ''), `the frame is not 2:1: ${log.ratio}`, f);
  const pano = await viewportPixels(page);
  log.pixelsChanged = changed(before, pano);
  ok(log.pixelsChanged > 5000, `the panorama is not drawn: ${log.pixelsChanged}`, f);
  log.status = await page.locator('footer.status').textContent();
  ok(/six cube faces/.test(log.status ?? ''), 'the status bar does not say the panorama is drawn from six faces', f);
  // The eye height presets: Seated puts the camera 1.1 m up.
  await page.locator(`${CAMERA} [data-eye="SEATED"]`).click();
  await settle(page, 600);
  log.eyeUndo = await undoTip(page);
  ok(/eye height Seated/.test(log.eyeUndo ?? ''), `the undo does not name the eye height: ${log.eyeUndo}`, f);
  await page.locator(`${CAMERA} [data-eye="STANDING"]`).click();
  await settle(page, 600);
  await page.screenshot({ path: join(SHOTS, 'k3-panorama-fast.png') });
  if (existsSync(join(ROOT, 'dist', 'engine', 'rt.wasm'))) {
    await full(page, SAMPLES);
    log.samples = await meterSamples(page);
    await page.screenshot({ path: join(SHOTS, 'k3-panorama.png') });
  } else log.full = 'skipped: no rt.wasm';
  ok(errors.length === 0, `errors in the page: ${errors.join(' | ')}`, f);
  await context.close();
  results.panorama = { ok: f.length === 0, failures: f, ...log };
  console.log(`panorama: ${f.length === 0 ? 'OK' : `FAILED\n  - ${f.join('\n  - ')}`}`);
}

async function chromeCheck(browser) {
  const f = [];
  const log = {};
  for (const theme of ['dark', 'light']) {
    const { page, context, errors } = await openRoom(browser, `theme=${theme}&lang=en&mode=fast&tour=0`);
    await openSection(page, CAMERA);
    await page.locator(`${CAMERA} [role="switch"][aria-label="Straight verticals"]`).click();
    await openSection(page, IMAGE);
    const bad = [...(await chromatic(page, `${CAMERA} [data-guide="interior-camera"]`)), ...(await chromatic(page, IMAGE))];
    log[theme] = bad;
    ok(bad.length === 0, `colour in the ${theme} chrome: ${bad.join('; ')}`, f);
    ok(errors.length === 0, `errors in the page: ${errors.join(' | ')}`, f);
    await context.close();
  }
  const { page, context } = await openRoom(browser, 'theme=dark&lang=es&mode=fast&tour=0');
  await openSection(page, CAMERA);
  log.es = await page.locator(`${CAMERA} [role="switch"][aria-label="Verticales rectas"]`).count();
  ok(log.es === 1, 'Spanish does not name Verticales rectas', f);
  log.esImage = await page.locator(`${IMAGE} [aria-label="Exterior (rayo de cámara)"]`).count();
  ok(log.esImage >= 1, 'Spanish does not name the exterior factor', f);
  await context.close();
  results.chrome = { ok: f.length === 0, failures: f, ...log };
  console.log(`chrome: ${f.length === 0 ? 'OK' : `FAILED\n  - ${f.join('\n  - ')}`}`);
}

let server = null;
let browser = null;
try {
  if (!existsSync(join(ROOT, 'dist', 'index.html'))) fail('dist/ is missing: npm run build first');
  if (!BASE_URL) {
    stopServer(PORT);
    server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: 'ignore', detached: true });
    BASE_URL = `http://localhost:${PORT}`;
  }
  await waitFor(BASE_URL);
  const { chromium } = await import('playwright-core');
  browser = await chromium.launch({ executablePath: findChromium(), headless: true, args: ['--no-sandbox', '--disable-gpu', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const only = opt('only', 'verticals,plan,panorama,chrome').split(',');
  if (only.includes('verticals')) await verticalsCheck(browser);
  if (only.includes('plan')) await planCheck(browser);
  if (only.includes('panorama')) await panoramaCheck(browser);
  if (only.includes('chrome')) await chromeCheck(browser);
  writeFileSync(join(OUT, 'k3-check.json'), JSON.stringify(results, null, 2));
  const all = Object.values(results).every((r) => r.ok);
  console.log(all ? 'all checks passed' : 'SOME CHECKS FAILED');
  process.exitCode = all ? 0 : 1;
} catch (err) {
  console.error(err?.stack ?? err);
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
  if (server) stopServer(PORT);
}
