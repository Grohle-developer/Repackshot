#!/usr/bin/env node
// Browser checks of phase U5 (the render window, the queue and the results viewer), with the local
// Chromium and swiftshader.
//
//   npm run engine:build && npm run build && node tools/render-window-check.mjs [--url http://localhost:4182]
//        [--shots docs/ui]
//
// Without --url it serves dist/ with `vite preview --port 4182 --strictPort` and stops it at the end
// (by the pids `lsof -t -i :4182` reports, never `pkill -f`).
//
//   (a) the render window opens with Ctrl ⏎ and with Render…, Esc closes it and the settings stay;
//   (b) the window never appears in a viewport capture: Export viewport image with the window open
//       gives the same pixels as with it closed (the window is DOM over the canvas, never in it);
//   (c) Render with 16 samples downloads a PNG whose pHYs chunk carries the DPI chosen (150), at the
//       size chosen, and the results viewer opens on it;
//   (d) + Add to queue three times (⇧ ⏎ and the button) gives three waiting jobs and the toasts;
//   (e) a JPEG carries its JFIF density (72 DPI) after the canvas encoder;
//   (f) an animation job writes its frames as …_0001.png, …_0002.png, …;
//   (g) the results viewer compares two results and the divider drags (and moves with ← →).
//
// Screenshots (English): render-window-image.png, render-window-animation.png, queue-drawer.png,
// results-split.png. Results: out/render-window-check.json.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4182;
const STUDIO = 'example=1&preset=JEWELLERY&setup=REMBRANDT&theme=dark&lang=en&mode=fast';
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const SHOTS = resolve(ROOT, opt('shots', 'docs/ui'));
const OUT = join(ROOT, 'out');
mkdirSync(OUT, { recursive: true });
mkdirSync(SHOTS, { recursive: true });
const results = {};
const fail = (msg) => {
  throw new Error(msg);
};
const check = (key, ok, detail) => {
  results[key] = { ok: Boolean(ok), ...detail };
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${key} ${JSON.stringify(detail)}`);
};

// ------------------------------------------------------------------ files

function pngChunks(buf) {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const out = [];
  for (let o = 8; o < buf.length; ) {
    const len = v.getUint32(o);
    out.push({ type: buf.toString('latin1', o + 4, o + 8), data: buf.subarray(o + 8, o + 8 + len) });
    o += 12 + len;
  }
  return out;
}

/** Decodes an 8-bit RGB or RGBA PNG with any filter (what Chromium writes): RGBA bytes. */
function decodePng(buf) {
  const chunks = pngChunks(buf);
  const ihdr = chunks.find((c) => c.type === 'IHDR').data;
  const w = ihdr.readUInt32BE(0);
  const h = ihdr.readUInt32BE(4);
  if (ihdr[8] !== 8) fail('PNG: only 8-bit images');
  const ch = { 2: 3, 6: 4 }[ihdr[9]] ?? fail(`PNG colour type ${ihdr[9]}`);
  const raw = inflateSync(Buffer.concat(chunks.filter((c) => c.type === 'IDAT').map((c) => c.data)));
  const stride = w * ch;
  const out = new Uint8Array(w * h * 4);
  let prev = new Uint8Array(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = new Uint8Array(stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? cur[i - ch] : 0;
      const b = prev[i];
      const c = i >= ch ? prev[i - ch] : 0;
      let p = 0;
      if (f === 1) p = a;
      else if (f === 2) p = b;
      else if (f === 3) p = (a + b) >> 1;
      else if (f === 4) {
        const pa = Math.abs(b - c);
        const pb = Math.abs(a - c);
        const pc = Math.abs(a + b - 2 * c);
        p = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[i] = (line[i] + p) & 255;
    }
    for (let x = 0; x < w; x++) for (let k = 0; k < 4; k++) out[(y * w + x) * 4 + k] = k < ch ? cur[x * ch + k] : 255;
    prev = cur;
  }
  return { width: w, height: h, data: out };
}

function jfifDensity(buf) {
  if (buf[2] !== 0xff || buf[3] !== 0xe0 || buf.toString('latin1', 6, 10) !== 'JFIF') return null;
  return { units: buf[13], x: buf.readUInt16BE(14), y: buf.readUInt16BE(16) };
}

// ------------------------------------------------------------------ browser helpers

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
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // not yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  fail(`${url} did not answer`);
}

async function open(browser, query) {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  // The check for a newer version at startup asks api.github.com; while the repository is private that is a 404 the browser logs itself.
  page.on('console', (m) => m.type() === 'error' && !m.location().url.startsWith('https://api.github.com/') && errors.push(m.text()));
  await page.goto(`${BASE_URL}/?${query}`);
  await page.waitForSelector('#app[data-ready="1"]', { timeout: 90000 });
  // The engine is ready when Full can be chosen.
  await page.waitForFunction(() => !document.querySelectorAll('.hdr .seg button')[1]?.disabled, null, { timeout: 60000 });
  return { page, context, errors };
}

/** Types a value into a number field of the render window (double click edits it). */
async function setNumber(page, selector, value) {
  const el = page.locator(selector).first();
  await el.dblclick();
  const input = el.locator('input');
  await input.fill(String(value));
  await input.press('Enter');
}

async function download(page, action, timeout = 240000) {
  const [d] = await Promise.all([page.waitForEvent('download', { timeout }), action()]);
  const path = await d.path();
  return { name: d.suggestedFilename(), bytes: readFileSync(path) };
}

async function exportViewport(page) {
  return download(page, async () => {
    await page.keyboard.press('Control+k');
    await page.keyboard.type('Export viewport image');
    await page.keyboard.press('Enter');
  }, 30000);
}

const sizeSel = '.rw [data-section="rw.size"]';

// ------------------------------------------------------------------ main

let BASE_URL = opt('url', null);
let server = null;
let browser = null;
try {
  if (!existsSync(join(ROOT, 'public', 'engine', 'rt.wasm'))) fail('public/engine/rt.wasm is missing: npm run engine:build first');
  if (!existsSync(join(ROOT, 'dist', 'index.html'))) fail('dist/ is missing: npm run build first');
  if (!BASE_URL) {
    stopServer();
    server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: 'ignore', detached: true });
    BASE_URL = `http://localhost:${PORT}`;
  }
  await waitFor(BASE_URL);
  const { chromium } = await import(join(ROOT, 'node_modules', 'playwright-core', 'index.mjs'));
  browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true, args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });

  {
    const { page, errors } = await open(browser, `${STUDIO}&select=body`);

    // (a) Ctrl ⏎ and the button open it; Esc closes it; the settings stay.
    await page.locator('canvas[aria-label="viewport"]').focus();
    await page.keyboard.press('Control+Enter');
    const byShortcut = await page.locator('.rw').isVisible();
    await page.keyboard.press('Escape');
    const closedByEsc = (await page.locator('.rw').count()) === 0;
    await page.locator('.render-btn').click();
    const byButton = await page.locator('.rw').isVisible();
    await page.locator('.rw-name').fill('{project}_{camera}_check_{n}');
    await page.locator('.rw-name').press('Enter');
    await page.locator('.rw button[aria-label="Close"]').click();
    await page.keyboard.press('Control+Enter');
    const kept = await page.locator('.rw-name').inputValue();
    check('a_window_opens', byShortcut && closedByEsc && byButton && kept === '{project}_{camera}_check_{n}', { byShortcut, closedByEsc, byButton, kept });
    await page.keyboard.press('Escape');

    // (b) The viewport capture is the same with the window open.
    const closed = decodePng((await exportViewport(page)).bytes);
    await page.keyboard.press('Control+Enter');
    await page.waitForSelector('.rw');
    const shown = await page.locator('.rw').isVisible();
    const opened = decodePng((await exportViewport(page)).bytes);
    let diff = 0;
    for (let i = 0; i < closed.data.length; i++) if (closed.data[i] !== opened.data[i]) diff++;
    const sameSize = closed.width === opened.width && closed.height === opened.height;
    check('b_window_not_in_capture', shown && sameSize && diff === 0, { width: closed.width, height: closed.height, bytesDiffering: diff, windowShown: shown });

    // (c) Render at 16 samples, 640 × 360, 150 DPI: the PNG carries pHYs = 150 DPI.
    await page.locator('.rw-name').fill('{project}_{camera}_{n}');
    await page.locator('.rw-name').press('Enter');
    await setNumber(page, `${sizeSel} .num[aria-label="Width"]`, 640);
    await setNumber(page, `${sizeSel} .num[aria-label="Resolution"]`, 150);
    await setNumber(page, '.rw .num[aria-label="Samples"]', 16);
    const summary = await page.locator('.rw-summary').textContent();
    const png = await download(page, () => page.locator('.rw-foot .btn-primary').click());
    const chunks = pngChunks(png.bytes);
    const ihdr = chunks.find((c) => c.type === 'IHDR').data;
    const phys = chunks.find((c) => c.type === 'pHYs')?.data;
    const ppm = phys ? phys.readUInt32BE(0) : 0;
    const dpi = Math.round(ppm * 0.0254);
    await page.waitForSelector('.rv[data-ready="1"]', { timeout: 30000 });
    const viewerData = await page.locator('.rv-data').textContent();
    const closedWindow = (await page.locator('.rw').count()) === 0;
    check('c_render_png_dpi', dpi === 150 && phys?.[8] === 1 && ihdr.readUInt32BE(0) === 640 && ihdr.readUInt32BE(4) === 360 && closedWindow, {
      file: png.name,
      size: `${ihdr.readUInt32BE(0)}x${ihdr.readUInt32BE(4)}`,
      pHYs: { ppm, unit: phys?.[8], dpi },
      chunks: chunks.map((c) => c.type),
      summary,
      viewerData,
    });
    await page.keyboard.press('Escape');

    // (d) + Add to queue three times: ⇧ ⏎ twice and the button once.
    await page.keyboard.press('Control+Enter');
    await page.waitForSelector('.rw');
    await page.keyboard.press('Shift+Enter');
    await page.keyboard.press('Shift+Enter');
    await page.locator('.rw-foot .btn:not(.btn-primary)').click();
    const stillOpen = await page.locator('.rw').isVisible();
    const toasts = await page.locator('.toast').allTextContents();
    await page.keyboard.press('Escape');
    await page.locator('.drawer-btn[data-drawer="queue"]').click();
    const waiting = await page.locator('.queue-row[data-status="QUEUED"]').count();
    const badge = await page.locator('.drawer-btn[data-drawer="queue"] .badge').textContent();
    check('d_add_three', waiting === 3 && stillOpen && toasts.at(-1) === 'Added to queue · 3 jobs' && badge === '3', { waiting, badge, stillOpen, toasts });

    // (e) JPEG at 72 DPI: the JFIF density survives the canvas encoder.
    await page.locator('.queue-row[data-status="QUEUED"] button[aria-label="Remove"]').first().click();
    await page.keyboard.press('Control+Enter');
    await page.waitForSelector('.rw');
    await page.locator('.rw .seg button', { hasText: 'JPEG' }).click();
    await setNumber(page, `${sizeSel} .num[aria-label="Resolution"]`, 72);
    await setNumber(page, '.rw .num[aria-label="Samples"]', 4);
    const jpg = await download(page, () => page.keyboard.press('Enter'));
    const density = jfifDensity(jpg.bytes);
    check('e_jpeg_density', density?.units === 1 && density.x === 72 && density.y === 72, { file: jpg.name, density });
    await page.keyboard.press('Escape');

    // (f) An animation job: three frames, numbered.
    await page.keyboard.press('Control+Enter');
    await page.waitForSelector('.rw');
    await page.locator('.rw-titlebar .seg button', { hasText: 'Animation' }).click();
    await page.locator('.rw .seg button', { hasText: 'PNG' }).click();
    await page.locator('.rw-name').fill('frames-{camera}');
    await page.locator('.rw-name').press('Enter');
    await page.locator('.rw .seg button', { hasText: 'From–to' }).click();
    await setNumber(page, '.rw .num[aria-label="Range end"]', 3);
    await setNumber(page, '.rw [data-section="rw.anim"] .num[aria-label="Width"]', 160);
    const names = [];
    page.on('download', (d) => names.push(d.suggestedFilename()));
    await page.keyboard.press('Enter');
    const t0 = Date.now();
    while (names.length < 3 && Date.now() - t0 < 120000) await page.waitForTimeout(250);
    await page.waitForTimeout(500);
    check('f_frames', names.length === 3 && names.every((n, i) => n === `frames-Camera 1_000${i + 1}.png`), { names });
    await page.keyboard.press('Escape');
    // Back to an image for the rest.
    await page.keyboard.press('Control+Enter');
    await page.waitForSelector('.rw');
    await page.locator('.rw-titlebar .seg button', { hasText: 'Image' }).click();
    await page.keyboard.press('Escape');

    // (g) Two results compared with the divider: the same shot with two materials on the body, the divider
    // dragged to 40 %, then ← → and ⇧ →.
    await page.keyboard.press('Control+Enter');
    await page.waitForSelector('.rw');
    await page.locator('.rw-titlebar .seg button', { hasText: 'Image' }).click();
    await page.locator('.rw .seg button', { hasText: 'PNG' }).click();
    await page.locator('.rw-name').fill('{project}_{camera}_{n}');
    await page.locator('.rw-name').press('Enter');
    await page.locator(`${sizeSel} select`).first().selectOption('RES:HD');
    await setNumber(page, `${sizeSel} .num[aria-label="Width"]`, 1280);
    await setNumber(page, `${sizeSel} .num[aria-label="Resolution"]`, 300);
    await setNumber(page, '.rw .num[aria-label="Samples"]', 24);
    await page.keyboard.press('Enter');
    await page.waitForSelector('.rv[data-ready="1"]', { timeout: 240000 });
    const nameA = await page.locator('.rv-title').textContent();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Control+k');
    await page.keyboard.type('Copper');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    // Ctrl ⇧ ⏎: the same settings, at once.
    await page.keyboard.press('Control+Shift+Enter');
    await page.waitForFunction((a) => { const t = document.querySelector('.rv[data-ready="1"] .rv-title')?.textContent; return t && t !== a; }, nameA, { timeout: 240000 });
    await page.locator('.rv-actions button', { hasText: 'Compare with' }).click();
    await page.locator('.floating .menu-item').filter({ hasText: nameA }).first().click();
    await page.waitForSelector('.rv[data-ready="1"] .split-divider', { timeout: 30000 });
    const frame = await page.locator('.split').boundingBox();
    const handle = await page.locator('.split-handle').boundingBox();
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(frame.x + frame.width * 0.45, handle.y + handle.height / 2, { steps: 6 });
    await page.mouse.move(frame.x + frame.width * 0.4, handle.y + handle.height / 2, { steps: 6 });
    await page.mouse.up();
    const dragged = Number(await page.locator('.split-handle').getAttribute('aria-valuenow'));
    await page.locator('.split-handle').focus();
    await page.keyboard.press('ArrowRight');
    const right = Number(await page.locator('.split-handle').getAttribute('aria-valuenow'));
    await page.keyboard.press('Shift+ArrowLeft');
    const bigLeft = Number(await page.locator('.split-handle').getAttribute('aria-valuenow'));
    await page.keyboard.press('Shift+ArrowRight');
    // The two images are two different renders (the body's material changed between them).
    const imagesDiffer = await page.evaluate(() => {
      const [a, b] = [...document.querySelectorAll('.split-img')];
      const da = a.getContext('2d').getImageData(0, 0, a.width, a.height).data;
      const db = b.getContext('2d').getImageData(0, 0, b.width, b.height).data;
      let n = 0;
      for (let i = 0; i < da.length; i += 4) if (Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]) > 24) n++;
      return n / (da.length / 4);
    });
    check('g_split_divider', Math.abs(dragged - 40) <= 1 && right === dragged + 1 && bigLeft === dragged - 9 && imagesDiffer > 0.01, { dragged, right, bigLeft, pixelsDiffering: Number(imagesDiffer.toFixed(3)) });
    const labels = await page.locator('.split-label').allTextContents();
    // Closer in (= zooms about the centre), so the divider at 40 % cuts through the bottle.
    for (let i = 0; i < 4; i++) await page.keyboard.press('=');
    results.zoom = await page.locator('.rv-zoom').textContent();
    // The queue drawer (open since (d)) folds away and the toasts go, for the screenshot.
    await page.locator('.drawer-btn[data-drawer="queue"]').click();
    await page.mouse.move(10, 990);
    await page.waitForTimeout(4600);
    await page.screenshot({ path: join(SHOTS, 'results-split.png') });
    results.labels = labels;
    results.errors_main = errors;
  }

  // (h) No storage (a private window, blocked site data): the application starts, keeps results in memory and says so.
  {
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
    await context.addInitScript(() => {
      Object.defineProperty(window, 'indexedDB', { get: () => { throw new DOMException('denied', 'SecurityError'); } });
      Object.defineProperty(window, 'localStorage', { get: () => { throw new DOMException('denied', 'SecurityError'); } });
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`${BASE_URL}/?${STUDIO}`);
    await page.waitForSelector('#app[data-ready="1"]', { timeout: 90000 });
    await page.waitForFunction(() => !document.querySelectorAll('.hdr .seg button')[1]?.disabled, null, { timeout: 60000 });
    await page.locator('.drawer-btn[data-drawer="queue"]').click();
    const note = (await page.locator('.queue-memory').isVisible()) ? await page.locator('.queue-memory').textContent() : null;
    await page.keyboard.press('Control+Enter');
    await page.waitForSelector('.rw');
    await setNumber(page, `${sizeSel} .num[aria-label="Width"]`, 320);
    await setNumber(page, '.rw .num[aria-label="Samples"]', 2);
    const out = await download(page, () => page.keyboard.press('Enter'), 120000);
    await page.waitForSelector('.rv[data-ready="1"]', { timeout: 60000 });
    const kept = await page.locator('.history-item').count();
    check('h_no_storage', note !== null && kept === 1 && errors.length === 0 && out.name.endsWith('.png'), { note, kept, file: out.name, errors });
    await context.close();
  }

  // Screenshots of the window in Image and in Animation mode, and of the queue drawer.
  {
    // In Full mode for a few seconds first, so the estimate has a measurement of this machine.
    const { page } = await open(browser, STUDIO.replace('mode=fast', 'mode=full'));
    await page.waitForFunction(() => {
      const m = document.querySelector('.ov-bl');
      return m?.getAttribute('data-mode') === 'full' && Number(m.getAttribute('data-samples')) >= 2 && Number(m.getAttribute('data-seconds')) >= 3;
    }, null, { timeout: 120000 });
    await page.locator('canvas[aria-label="viewport"]').focus();
    await page.keyboard.press('Control+Enter');
    await page.waitForSelector('.rw');
    await page.waitForTimeout(400);
    results.estimate = await page.locator('.rw-estimate').first().textContent();
    await page.screenshot({ path: join(SHOTS, 'render-window-image.png') });
  }
  {
    const { page } = await open(browser, `${STUDIO}&sequence=HERO&render=animation`);
    await page.waitForSelector('.rw');
    // Output folded, so Animation and Quality show.
    await page.locator('.rw [data-section="rw.output"] > .section-head').click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(SHOTS, 'render-window-animation.png') });
  }
  {
    const { page } = await open(browser, `${STUDIO}&sequence=HERO`);
    // One finished job, one running and one waiting.
    await page.keyboard.press('Control+Enter');
    await page.waitForSelector('.rw');
    await setNumber(page, `${sizeSel} .num[aria-label="Width"]`, 480);
    await setNumber(page, '.rw .num[aria-label="Samples"]', 8);
    await download(page, () => page.keyboard.press('Enter'));
    await page.waitForSelector('.rv[data-ready="1"]', { timeout: 60000 });
    await page.keyboard.press('Escape');
    await page.keyboard.press('Control+Enter');
    await page.waitForSelector('.rw');
    await setNumber(page, `${sizeSel} .num[aria-label="Width"]`, 1920);
    await setNumber(page, '.rw .num[aria-label="Samples"]', 512);
    await page.keyboard.press('Shift+Enter');
    await page.locator('.rw-titlebar .seg button', { hasText: 'Animation' }).click();
    await page.locator('.rw-foot .btn:not(.btn-primary)').click();
    await page.keyboard.press('Escape');
    await page.locator('.drawer-btn[data-drawer="queue"]').click();
    await page.locator('.queue-head .btn-primary').click();
    await page.waitForSelector('.queue-row[data-status="RUNNING"]', { timeout: 30000 });
    await page.mouse.move(700, 880);
    await page.waitForTimeout(4600);
    await page.screenshot({ path: join(SHOTS, 'queue-drawer.png') });
    const rows = await page.locator('.queue-row').evaluateAll((els) => els.map((e) => e.getAttribute('data-status')));
    results.queueShot = rows;
    await page.locator('.queue-head .btn-primary').click(); // Pause
  }

  writeFileSync(join(OUT, 'render-window-check.json'), JSON.stringify(results, null, 2));
  const all = Object.entries(results).filter(([, v]) => v && typeof v === 'object' && 'ok' in v).every(([, v]) => v.ok);
  console.log(all ? 'all checks passed' : 'SOME CHECKS FAILED');
  process.exitCode = all ? 0 : 1;
} catch (err) {
  console.error(err?.stack ?? err);
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
  if (server) stopServer();
}
