#!/usr/bin/env node
// Browser checks of phase U6 (the Settings window and the model manager), with the local Chromium and
// swiftshader.
//
//   npm run engine:build && npm run build && node tools/settings-check.mjs [--shots docs/ui]
//
// It serves dist/ with `vite preview --port 4185 --strictPort`; for the model download it builds a second
// copy with `vite build --mode model-test --outDir out/dist-model-test` (the only build that reads
// `?testModels=`, see src/main.ts) and serves that one on the same port. A tiny Node server on port 4186
// serves the test model with HTTP Range and CORS, throttled to about 0.8 MB/s. Servers are stopped by the pids
// `lsof -t -i :<port>` reports, never `pkill -f`.
//
//   (a) Ctrl , opens the window and Esc closes it; the menu's Settings… opens it too;
//   (b) the search finds a setting by a Spanish word, shows its path, and Enter goes to it;
//   (c) the section list moves with the arrows, Ctrl F goes to the search;
//   (d) high contrast, interface size and theme change the interface at once and survive a reload, and the
//       window reopens at the section last open;
//   (e) at 150 % nothing overflows in the header, the side panels, the render bar or the status bar;
//   (f) Reset (inline) and Reset this section return the factory values;
//   (g) Measure performance shows a real number (samples per second of a 10 s render of the example);
//   (h) Threads 2 restarts the pool with 2 workers;
//   (i) Full mode stops at 16 samples with "At N samples";
//   (j) Middle button orbits: the left button no longer orbits, the middle one does;
//   (k) deep links: Manage models… in the render window, and the meter's link when the engine is missing;
//   (l) a model downloads from the local server with real progress, survives a reload mid-way (the next
//       request asks for the bytes from where the stored ones end) and ends Ready (its sha256 verified); a
//       file with a wrong sha256 ends Damaged; Use and Delete work;
//   (m) the Hardware part says what was detected and the recommendation.
//
// Screenshots (English): settings-general.png, settings-accessibility.png, settings-engine.png,
// settings-ai-models.png. Results: out/settings-check.json.

import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4185;
const MODEL_PORT = 4186;
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const SHOTS = resolve(ROOT, opt('shots', 'docs/ui'));
const OUT = join(ROOT, 'out');
mkdirSync(OUT, { recursive: true });
mkdirSync(SHOTS, { recursive: true });
const BASE_URL = `http://localhost:${PORT}`;
const results = {};
const fail = (msg) => {
  throw new Error(msg);
};
const check = (key, ok, detail) => {
  results[key] = { ok: Boolean(ok), ...detail };
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${key} ${JSON.stringify(detail)}`);
};

// ------------------------------------------------------------------ servers

function stopPort(port) {
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
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // not yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  fail(`${url} did not answer`);
}

async function preview(outDir) {
  stopPort(PORT);
  await new Promise((r) => setTimeout(r, 500));
  const argv = ['vite', 'preview', '--port', String(PORT), '--strictPort', ...(outDir ? ['--outDir', outDir] : [])];
  spawn('npx', argv, { cwd: ROOT, stdio: 'ignore', detached: true }).unref();
  await waitFor(BASE_URL);
}

/** Deterministic bytes. */
function bytes(n, seed) {
  const out = Buffer.alloc(n);
  let x = seed >>> 0;
  for (let i = 0; i < n; i++) {
    x = (Math.imul(x, 1103515245) + 12345) >>> 0;
    out[i] = x >>> 24;
  }
  return out;
}

const MODEL = bytes(12 * 1024 * 1024, 7);
const SMALL = bytes(300 * 1024, 9);
const requests = [];
const modelServer = createServer((req, res) => {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Range', 'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges' };
  if (req.method === 'OPTIONS') {
    res.writeHead(204, cors);
    res.end();
    return;
  }
  const file = req.url === '/test-model.gguf' ? MODEL : req.url === '/bad-model.gguf' ? SMALL : null;
  requests.push({ url: req.url, range: req.headers.range ?? null, at: Date.now() });
  if (!file) {
    res.writeHead(404, cors);
    res.end();
    return;
  }
  let start = 0;
  let status = 200;
  const headers = { ...cors, 'Accept-Ranges': 'bytes', 'Content-Type': 'application/octet-stream' };
  const m = /^bytes=(\d+)-$/.exec(req.headers.range ?? '');
  if (m) {
    start = Number(m[1]);
    if (start >= file.length) {
      res.writeHead(416, { ...headers, 'Content-Range': `bytes */${file.length}` });
      res.end();
      return;
    }
    status = 206;
    headers['Content-Range'] = `bytes ${start}-${file.length - 1}/${file.length}`;
  }
  headers['Content-Length'] = String(file.length - start);
  res.writeHead(status, headers);
  // About 0.8 MB/s: 64 KiB every 80 ms.
  let at = start;
  const timer = setInterval(() => {
    if (res.destroyed) {
      clearInterval(timer);
      return;
    }
    const end = Math.min(file.length, at + 64 * 1024);
    res.write(file.subarray(at, end));
    at = end;
    if (at >= file.length) {
      clearInterval(timer);
      res.end();
    }
  }, 80);
  req.on('close', () => clearInterval(timer));
});

const sha = (b) => createHash('sha256').update(b).digest('hex');
const TEST_MODELS = [
  {
    key: 'TEST_LOCAL',
    label: { en: 'Local test model (test build only)', es: 'Modelo de prueba local (solo versión de prueba)' },
    summary: { en: 'Served by tools/settings-check.mjs', es: 'Lo sirve tools/settings-check.mjs' },
    family: 'z-image',
    role: 'img2img',
    quantization: 'Q4_0',
    runtimes: ['web', 'desktop'],
    default: false,
    available: true,
    licence: { spdx: 'Apache-2.0', url: `http://localhost:${MODEL_PORT}/LICENSE`, commercialUse: true, useRestrictions: false },
    files: [{ role: 'transformer', name: 'test-model.gguf', url: `http://localhost:${MODEL_PORT}/test-model.gguf`, bytes: MODEL.length, sha256: sha(MODEL) }],
    totalBytes: MODEL.length,
    requirements: { minVramGiB: null, minRamGiB: null },
  },
  {
    key: 'TEST_BAD',
    label: { en: 'Test model with a wrong sha256', es: 'Modelo de prueba con un sha256 erróneo' },
    summary: { en: 'Must end Damaged', es: 'Tiene que acabar Dañado' },
    family: 'sd15',
    role: 'img2img',
    quantization: 'fp16',
    runtimes: ['web', 'desktop'],
    default: false,
    available: true,
    licence: { spdx: 'Apache-2.0', url: `http://localhost:${MODEL_PORT}/LICENSE`, commercialUse: true, useRestrictions: false },
    files: [{ role: 'transformer', name: 'bad-model.gguf', url: `http://localhost:${MODEL_PORT}/bad-model.gguf`, bytes: SMALL.length, sha256: sha(Buffer.from('not these bytes')) }],
    totalBytes: SMALL.length,
    requirements: { minVramGiB: null, minRamGiB: null },
  },
];
const TEST_PARAM = encodeURIComponent(Buffer.from(JSON.stringify(TEST_MODELS)).toString('base64'));

// ------------------------------------------------------------------ browser helpers

async function newPage(browser) {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  return { context, page, errors };
}

async function go(page, query) {
  await page.goto(`${BASE_URL}/?${query}`);
  await page.waitForSelector('#app[data-ready="1"]', { timeout: 90000 });
}

const engineReady = (page) => page.waitForFunction(() => !document.querySelectorAll('.hdr .seg button')[1]?.disabled, null, { timeout: 60000 });

/** Types a value into a number field (double click edits it). */
async function setNumber(page, selector, value) {
  const el = page.locator(selector).first();
  await el.dblclick();
  const input = el.locator('input');
  await input.fill(String(value));
  await input.press('Enter');
}

const rowSel = (id) => `.sw [data-row="${id}"]`;
const rootAttr = (page, name) => page.evaluate((n) => document.documentElement.getAttribute(n), name);
const rootVar = (page, name) => page.evaluate((n) => document.documentElement.style.getPropertyValue(n).trim(), name);

// ------------------------------------------------------------------ main

let browser = null;
try {
  if (!existsSync(join(ROOT, 'public', 'engine', 'rt.wasm'))) fail('public/engine/rt.wasm is missing: npm run engine:build first');
  if (!existsSync(join(ROOT, 'dist', 'index.html'))) fail('dist/ is missing: npm run build first');
  stopPort(MODEL_PORT);
  await new Promise((r) => modelServer.listen(MODEL_PORT, r));
  await preview(null);
  const { chromium } = await import(join(ROOT, 'node_modules', 'playwright-core', 'index.mjs'));
  browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true, args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });

  {
    const { page, errors } = await newPage(browser);
    await go(page, 'example=1&lang=en&mode=fast');
    await engineReady(page);

    // (a) Ctrl , opens it, Esc closes it, the menu's Settings… too.
    await page.locator('canvas[aria-label="viewport"]').focus();
    await page.keyboard.press('Control+Comma');
    const byShortcut = await page.locator('.sw[role="dialog"]').isVisible();
    const modal = await page.locator('.sw').getAttribute('aria-modal');
    await page.keyboard.press('Escape');
    const closed = (await page.locator('.sw').count()) === 0;
    await page.locator('.hdr button[aria-haspopup="menu"]').click();
    await page.locator('.menu-item', { hasText: 'Settings…' }).click();
    const byMenu = await page.locator('.sw').isVisible();
    const startSection = await page.locator('.sw .sw-option[aria-selected="true"]').textContent();
    check('a_opens_and_closes', byShortcut && closed && byMenu && modal === 'true', { byShortcut, closed, byMenu, modal, startSection });

    // (b) The search finds Threads by a Spanish word and goes to it.
    await page.keyboard.press('Control+f');
    const searchFocused = await page.evaluate(() => document.activeElement?.classList.contains('sw-search'));
    await page.keyboard.type('hilos');
    const firstHit = (await page.locator('.sw .sw-hit').first().innerText()).replace(/\s+/g, ' ');
    const hits = await page.locator('.sw .sw-hit').count();
    await page.keyboard.press('Enter');
    await page.waitForSelector(`${rowSel('engine.threads')}.is-flash`, { timeout: 5000 });
    const section = await page.locator('.sw .sw-section').getAttribute('data-section');
    check('b_search', searchFocused && firstHit.includes('Render engine ▸ Threads') && section === 'engine', { searchFocused, hits, firstHit, section });
    await page.locator('.sw-search').fill('');

    // (c) Arrows move through the sections (the selection follows the focus).
    await page.locator('.sw .sw-option[aria-selected="true"]').focus();
    await page.keyboard.press('ArrowUp');
    const afterUp = await page.locator('.sw .sw-section').getAttribute('data-section');
    await page.keyboard.press('Home');
    const afterHome = await page.locator('.sw .sw-section').getAttribute('data-section');
    await page.keyboard.press('ArrowDown');
    const afterDown = await page.locator('.sw .sw-section').getAttribute('data-section');
    const focusOnOption = await page.evaluate(() => document.activeElement?.getAttribute('role') === 'option');
    check('c_keyboard', afterUp === 'shortcuts' && afterHome === 'general' && afterDown === 'preferences' && focusOnOption, { afterUp, afterHome, afterDown, focusOnOption });

    // (d) Settings change the interface at once and survive a reload.
    await page.locator('.sw .sw-option[data-section="general"]').click();
    await page.locator(`${rowSel('general.theme')} button`, { hasText: 'Light' }).click();
    const themeNow = await rootAttr(page, 'data-theme');
    await page.locator('.sw .sw-option[data-section="accessibility"]').click();
    await page.locator(`${rowSel('a11y.highContrast')} .toggle`).click();
    const contrastNow = await rootAttr(page, 'data-contrast');
    await setNumber(page, `${rowSel('a11y.uiScale')} [role="spinbutton"]`, 150);
    const zoomNow = await rootVar(page, '--ui-zoom');
    const headerH = await page.evaluate(() => document.querySelector('.hdr').getBoundingClientRect().height);
    const dot = await page.locator(`${rowSel('a11y.uiScale')}`).getAttribute('data-changed');
    await page.mouse.move(5, 995);
    await page.screenshot({ path: join(SHOTS, 'settings-accessibility.png') });
    // (e) Nothing overflows at 150 %.
    const overflow = await page.evaluate(() => {
      const out = {};
      for (const sel of ['.hdr', '.side-left .side-body', '.side-right .side-body', '.bar', '.status', '.sw-nav', '.sw-content']) {
        const el = document.querySelector(sel);
        if (!el) continue;
        out[sel] = { scroll: el.scrollWidth, client: el.clientWidth };
      }
      const r = document.querySelector('.sw').getBoundingClientRect();
      out.window = { left: r.left, top: r.top, right: r.right, bottom: r.bottom, w: innerWidth, h: innerHeight };
      return out;
    });
    const overflowing = Object.entries(overflow).filter(([k, v]) => k !== 'window' && v.scroll > v.client + 1).map(([k]) => k);
    const w = overflow.window;
    const inside = w.left >= 0 && w.top >= 0 && w.right <= w.w && w.bottom <= w.h;
    check('e_no_overflow_at_150', overflowing.length === 0 && inside, { overflowing, window: w });
    await page.waitForTimeout(400);
    await page.reload();
    await page.waitForSelector('#app[data-ready="1"]', { timeout: 90000 });
    const kept = { theme: await rootAttr(page, 'data-theme'), contrast: await rootAttr(page, 'data-contrast'), zoom: await rootVar(page, '--ui-zoom') };
    await page.locator('canvas[aria-label="viewport"]').focus();
    await page.keyboard.press('Control+Comma');
    const reopened = await page.locator('.sw .sw-section').getAttribute('data-section');
    check(
      'd_applies_and_persists',
      themeNow === 'light' && contrastNow === 'high' && zoomNow === '1.5' && Math.abs(headerH - 66) < 1 && dot === '1' && kept.theme === 'light' && kept.contrast === 'high' && kept.zoom === '1.5' && reopened === 'accessibility',
      { themeNow, contrastNow, zoomNow, headerH, dot, kept, reopened },
    );

    // (f) Reset (inline) and Reset this section.
    await page.locator(rowSel('a11y.uiScale')).hover();
    await page.locator(`${rowSel('a11y.uiScale')} .sw-reset`).click();
    const zoomReset = await rootVar(page, '--ui-zoom');
    const dotReset = await page.locator(rowSel('a11y.uiScale')).getAttribute('data-changed');
    await page.locator('.sw .sw-reset-section').click();
    const contrastReset = await rootAttr(page, 'data-contrast');
    const status = await page.locator('.sw .sw-section-foot [role="status"]').innerText();
    await page.locator('.sw .sw-option[data-section="general"]').click();
    await page.locator('.sw .sw-reset-section').click();
    const themeReset = await page.evaluate(() => document.documentElement.dataset.theme);
    check('f_reset', zoomReset === '1' && dotReset === '0' && contrastReset === 'normal' && /1 settings? back/.test(status), { zoomReset, dotReset, contrastReset, status, themeReset });
    await page.locator(`${rowSel('general.theme')} button`, { hasText: 'Dark' }).click();

    // (g) Measure performance: a real 10 s render of the example.
    await engineReady(page);
    await page.locator('.sw .sw-option[data-section="engine"]').click();
    await page.locator('.sw .sw-measure').click();
    await page.waitForSelector('.sw .sw-measure-out[data-state="RUNNING"]', { timeout: 5000 });
    await page.waitForSelector('.sw .sw-measure-out[data-state="DONE"]', { timeout: 60000 });
    const rate = Number(await page.locator('.sw .sw-measure-out').getAttribute('data-rate'));
    const rateText = await page.locator('.sw .sw-measure-rate').innerText();
    const detail = await page.locator('.sw .sw-measure-detail').innerText();
    await page.locator(rowSel('engine.measure')).scrollIntoViewIfNeeded();
    await page.mouse.move(5, 995);
    await page.screenshot({ path: join(SHOTS, 'settings-engine.png') });
    check('g_measure', rate > 0 && /samples per second/.test(rateText) && /640 × 360/.test(detail), { rate, rateText, detail });

    // (h) Threads 2: the pool starts again with two workers.
    await setNumber(page, `${rowSel('engine.threads')} [role="spinbutton"]`, 2);
    await page.waitForFunction(() => /2 workers/.test(document.querySelector('.sw [data-row="engine.info"]')?.textContent ?? ''), null, { timeout: 30000 });
    const info = (await page.locator(rowSel('engine.info')).innerText()).replace(/\s+/g, ' ');
    check('h_threads', /2 workers/.test(info), { info });

    // (i) Full mode stops at 16 samples.
    await page.locator(`${rowSel('engine.viewportLimit')} button`, { hasText: 'At N samples' }).click();
    await setNumber(page, `${rowSel('engine.viewportSamples')} [role="spinbutton"]`, 16);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await engineReady(page);
    await page.locator('.hdr .seg button', { hasText: 'Full' }).click();
    await page.waitForFunction(() => Number(document.querySelector('.ov-bl')?.dataset.samples) >= 16, null, { timeout: 60000 });
    await page.waitForTimeout(2500);
    const samples = Number(await page.locator('.ov-bl').getAttribute('data-samples'));
    check('i_viewport_limit', samples === 16, { samples });
    await page.locator('.hdr .seg button', { hasText: 'Fast' }).click();

    // (j) Middle button orbits.
    await page.locator('canvas[aria-label="viewport"]').focus();
    await page.keyboard.press('Control+Comma');
    await page.locator('.sw .sw-option[data-section="preferences"]').click();
    await page.locator(`${rowSel('viewport.mouse')} select`).selectOption('MIDDLE');
    await page.keyboard.press('Escape');
    const undoTip = () => page.locator('.hdr button[aria-label="Undo"]').getAttribute('data-tip');
    const before = await undoTip();
    const box = await page.locator('canvas[aria-label="viewport"]').boundingBox();
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down({ button: 'left' });
    await page.mouse.move(cx + 120, cy + 30, { steps: 8 });
    await page.mouse.up({ button: 'left' });
    await page.waitForTimeout(700);
    const afterLeft = await undoTip();
    await page.mouse.move(cx, cy);
    await page.mouse.down({ button: 'middle' });
    await page.mouse.move(cx + 120, cy + 30, { steps: 8 });
    await page.mouse.up({ button: 'middle' });
    await page.waitForTimeout(700);
    const afterMiddle = await undoTip();
    check('j_middle_orbits', afterLeft === before && afterMiddle !== before && /camera/i.test(afterMiddle ?? ''), { before, afterLeft, afterMiddle });

    // (k) Manage models… in the render window goes to AI ▸ Models.
    await page.locator('.render-btn').click();
    await page.locator('.rw [data-section="rw.ai"] .section-head').click();
    await page.locator('.rw [data-settings-link="ai.models"]').click();
    await page.waitForSelector('.sw [data-part="ai.models"].is-flash', { timeout: 5000 });
    const renderWindowGone = (await page.locator('.rw').count()) === 0;
    const aiSection = await page.locator('.sw .sw-section').getAttribute('data-section');
    // (m) The Hardware part, as detected here.
    const hw = (await page.locator('.sw [data-part="ai.hardware"]').innerText()).replace(/\s+/g, ' ');
    const rec = await page.locator('.sw [data-rec]').getAttribute('data-rec');
    check('m_hardware', /Logical cores/.test(hw) && /WebGPU/.test(hw) && rec !== null, { rec, hw: hw.slice(0, 400) });
    check('k_manage_models_link', renderWindowGone && aiSection === 'ai', { renderWindowGone, aiSection });
    check('errors_page1', errors.length === 0, { errors });
  }

  // The General section as it opens, for the screenshot (dark, English).
  {
    const { page, context } = await newPage(browser);
    await go(page, 'example=1&lang=en&theme=dark&mode=fast&settings=general');
    await page.mouse.move(5, 995);
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(SHOTS, 'settings-general.png') });
    await context.close();
  }

  // (k) The meter's link when the engine is missing.
  {
    const { page, context } = await newPage(browser);
    await context.route('**/engine/*.wasm', (route) => route.fulfill({ status: 404, body: '' }));
    await go(page, 'example=1&lang=en&mode=full');
    await page.waitForSelector('.ov-bl .ov-engine-link', { state: 'visible', timeout: 30000 });
    await page.locator('.ov-bl .ov-engine-link').click();
    const section = await page.locator('.sw .sw-section').getAttribute('data-section');
    const measureDisabled = await page.locator('.sw .sw-measure').isDisabled();
    const noEngine = await page.locator('.sw .sw-measure-rate').innerText();
    check('k_meter_link', section === 'engine' && measureDisabled && /Needs the engine/.test(noEngine), { section, measureDisabled, noEngine });
    await context.close();
  }

  // (l) Model downloads from the local server (the model-test build).
  {
    const r = spawnSync('npx', ['vite', 'build', '--mode', 'model-test', '--outDir', 'out/dist-model-test', '--emptyOutDir'], { cwd: ROOT, encoding: 'utf8' });
    if (r.status !== 0) fail(`model-test build failed: ${r.stderr}`);
    await preview('out/dist-model-test');
    const { page, errors } = await newPage(browser);
    const query = `example=1&theme=dark&lang=en&mode=fast&settings=ai.models&testModels=${TEST_PARAM}`;
    await go(page, query);
    const row = '.sw [data-model="TEST_LOCAL"]';
    await page.waitForSelector(row, { timeout: 20000 });
    await page.locator(`${row} button`, { hasText: 'Download' }).click();
    await page.waitForSelector(`${row} .sw-licence-panel`, { timeout: 5000 });
    const licenceShown = await page.locator(`${row} .sw-licence-panel`).innerText();
    await page.locator(`${row} button`, { hasText: 'Accept and download' }).click();
    await page.waitForFunction((sel) => Number(document.querySelector(sel)?.dataset.done ?? 0) > 2 * 1024 * 1024, row, { timeout: 30000 });
    const stateMid = await page.locator(`${row} .sw-model-state`).innerText();
    // The list with the model downloading at the bottom of the window (the catalogue's models above it).
    await page.evaluate((sel) => {
      const c = document.querySelector('.sw-content');
      const m = document.querySelector(sel);
      if (c && m) c.scrollTop += m.getBoundingClientRect().bottom - c.getBoundingClientRect().bottom + 16;
    }, row);
    await page.mouse.move(5, 995);
    await page.screenshot({ path: join(SHOTS, 'settings-ai-models.png') });
    // Reload once more than one chunk (4 MiB) is stored.
    await page.waitForFunction((sel) => Number(document.querySelector(sel)?.dataset.done ?? 0) > 5 * 1024 * 1024, row, { timeout: 30000 });
    const doneBefore = Number(await page.locator(row).getAttribute('data-done'));
    const firstRequests = requests.filter((q) => q.url === '/test-model.gguf').length;
    await page.reload();
    await page.waitForSelector('#app[data-ready="1"]', { timeout: 90000 });
    await page.waitForSelector(row, { timeout: 20000 });
    await page.waitForFunction((sel) => ['READY', 'IN_USE'].includes(document.querySelector(sel)?.dataset.state ?? ''), row, { timeout: 60000 });
    const modelRequests = requests.filter((q) => q.url === '/test-model.gguf');
    const resumed = modelRequests.slice(firstRequests);
    const resumedFrom = resumed[0]?.range ? Number(/bytes=(\d+)-/.exec(resumed[0].range)[1]) : 0;
    const stateEnd = await page.locator(`${row} .sw-model-state`).innerText();
    check('l_download_resume_ready', /Downloading \d+ %/.test(stateMid) && resumedFrom > 0 && resumedFrom % (4 * 1024 * 1024) === 0 && resumedFrom <= doneBefore && /Ready|In use/.test(stateEnd) && /Apache-2.0/.test(licenceShown), {
      stateMid,
      doneBefore,
      requests: modelRequests.map((q) => q.range),
      resumedFrom,
      stateEnd,
    });
    // Use, then Delete: the model in use falls back (to none here: no recommendation is installed).
    await page.locator(`${row} button`, { hasText: 'Use' }).click();
    const inUse = await page.locator(row).getAttribute('data-state');
    const activeName = await page.locator('.sw [data-row="ai.active"]').getAttribute('data-active');
    await page.locator(`${row} button`, { hasText: 'Delete' }).click();
    await page.locator(`${row} .confirm button`, { hasText: 'Delete' }).click();
    await page.waitForFunction((sel) => document.querySelector(sel)?.dataset.state === 'NOT_DOWNLOADED', row, { timeout: 10000 });
    const activeAfter = await page.locator('.sw [data-row="ai.active"]').getAttribute('data-active');
    check('l_use_delete', inUse === 'IN_USE' && activeName === 'TEST_LOCAL' && activeAfter === '', { inUse, activeName, activeAfter });
    // A wrong sha256: Damaged, never Ready.
    const bad = '.sw [data-model="TEST_BAD"]';
    await page.locator(`${bad} button`, { hasText: 'Download' }).click();
    await page.locator(`${bad} button`, { hasText: 'Accept and download' }).click();
    await page.waitForFunction((sel) => document.querySelector(sel)?.dataset.state === 'DAMAGED', bad, { timeout: 30000 });
    const damagedText = await page.locator(`${bad} .sw-model-state`).innerText();
    check('l_damaged', /Damaged/.test(damagedText), { damagedText });
    check('errors_models', errors.length === 0, { errors });
  }
} catch (err) {
  check('run', false, { error: String(err?.stack ?? err) });
} finally {
  await browser?.close();
  stopPort(PORT);
  modelServer.close();
  writeFileSync(join(OUT, 'settings-check.json'), JSON.stringify(results, null, 2));
  const failed = Object.entries(results).filter(([, v]) => !v.ok);
  console.log(failed.length === 0 ? 'all settings checks passed' : `${failed.length} failed: ${failed.map(([k]) => k).join(', ')}`);
  process.exit(failed.length === 0 ? 0 : 1);
}
