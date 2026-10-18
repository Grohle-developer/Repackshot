#!/usr/bin/env node
// Browser checks of phase S3b (the Shape among the visible knobs of an ambient effect, the front glass drawn by the Fast
// viewport, and the front glass fed by the scene's rain through the physics bar) in the built app, with the local
// Chromium and swiftshader.
//
//   npm run engine:build && npm run build && node tools/s3b-check.mjs [--url http://localhost:4198] [--shots docs/ui]
//       [--only shape,fast,rain,chrome]
//
// Without --url it serves dist/ with `vite preview` on port 4198 and stops it at the end.
//
//   shape   (decision S3 ◆5) on the example bottle, Water drops added: the Shape list is one of the visible knobs (after
//           the size) with Advanced folded; Mix (one undo entry "Shape") shows its weights there too. Screenshot
//           ambient-shape.png.
//   fast    (decision S3 ◆9) in Fast mode, Camera ▸ Lens ▸ Filters ▸ Front glass on, drops of 8 mm on a pane 150 mm in
//           front of the lens at f/16: the Fast viewport's pixels change and the meter says it is an approximation of
//           the engine's drops (their number, rule 10); From the scene, with nothing recorded, the glass is dry again.
//           Screenshot lens-glass-fast.png.
//   rain    Rain with a 6 m/s wind blowing at the camera (35 mm at f/11), the front glass fed by the scene: ▶ Start in the physics bar runs
//           the glass alone, the bar counts the drops the engine reports, the inspector says what the recording holds,
//           the Fast viewport draws it; Pause, then Stop; ↺ Reset takes the recording away and Undo brings it back.
//           Screenshot physics-rain.png (paused, a few seconds in).
//   chrome  the rows S3b adds (the glass's source and its notes, the bar's glass count) are achromatic in both themes.
//
// Results: out/s3b-check.json.

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

/**
 * A page of the app. The File System Access pickers are taken away so that Save project downloads and Open project
 * asks with the file input, which the checks can answer. `blockEngine` refuses every request for rt.wasm.
 */
async function open(browser, query, { blockEngine = false } = {}) {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1, acceptDownloads: true });
  await context.addInitScript(() => {
    for (const n of ['showSaveFilePicker', 'showOpenFilePicker']) Object.defineProperty(window, n, { value: undefined, configurable: true });
  });
  if (blockEngine) await context.route(/\/engine\/rt(-simd)?\.wasm/, (route) => route.abort());
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    const text = m.text();
    if ((m.type() === 'error' && !text.startsWith('Failed to load resource')) || /Shader Error|WebGLProgram/.test(text)) errors.push(text);
  });
  await page.goto(`${BASE_URL}/?${query}`);
  await page.waitForSelector('#app[data-ready="1"]', { timeout: 60000 });
  return { page, context, errors: blockEngine ? errors.filter((e) => !/rt(-simd)?\.wasm|engine/i.test(e)) : errors };
}

const settle = (page, ms = 60) => page.evaluate((wait) => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, wait)))), ms);
const ok = (cond, text, failures) => {
  if (!cond) failures.push(text);
  return cond;
};
const SECTION = 'section.section[data-section="ambient"]';
const GLASS = '[data-guide="camera-glass"]';
const undoTip = (page) => page.locator('.hdr button[aria-label="Undo"]').getAttribute('data-tip');
const effectRows = (page) => page.locator('[data-ambient="list"] [data-effect]').count();
const meter = (page) => page.evaluate(() => {
  const el = document.querySelector('[data-meter="particles"]');
  return el && el.style.display !== 'none' ? el.textContent : null;
});

/** The pixels of the viewport canvas as an RGB array (from a screenshot). */
async function viewportPixels(page) {
  const box = await page.locator('canvas[aria-label="viewport"]').boundingBox();
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

/** Adds the effect of this card through the gallery. */
async function addFromGallery(page, preset) {
  await page.locator(`${SECTION} [data-ambient="add"]`).click();
  await page.waitForSelector('[data-ambient="gallery"]');
  await page.locator(`[data-ambient="gallery"] [data-preset="${preset}"]`).click();
  await page.waitForSelector('[data-ambient="editor"]');
  await settle(page, 200);
}

/** Polls `test` (an async predicate) until it holds or `ms` passes; whether it held. A loaded machine paints late. */
async function until(test, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await test()) return true;
    await new Promise((r) => setTimeout(r, 150));
  }
  return test();
}

/** What the Shape list shows. */
const shapeChosen = (page) =>
  page.evaluate(() => {
    const sel = document.querySelector('[data-ambient="editor"] select[aria-label="Shape"]');
    return sel ? (sel.selectedOptions[0]?.textContent ?? null) : null;
  });
const chooseShape = (page, value) => page.locator('[data-ambient="editor"] select[aria-label="Shape"]').selectOption(value);

/** Opens Camera ▸ Lens ▸ Filters. */
async function openFilters(page) {
  const head = page.locator('[data-section="camera"] [data-action="cameraFilters"]');
  await head.scrollIntoViewIfNeeded();
  if ((await head.getAttribute('aria-expanded')) !== 'true') await head.click();
  await settle(page, 400);
}

/** Types `value` into a spin button, as a person would (Enter, select all, the digits, Enter). */
async function typeIn(page, locator, value) {
  await locator.scrollIntoViewIfNeeded();
  await locator.focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Control+a');
  await page.keyboard.type(String(value));
  await page.keyboard.press('Enter');
  await settle(page, 300);
}

/** The engine part of the meter (what the Fast viewport says it draws). */
const engineMeter = (page) => page.evaluate(() => [...document.querySelectorAll('.status span')].map((s) => s.textContent).find((x) => /Fast/.test(x ?? '')) ?? null);

/** Waits for the meter to match `re`. */
async function meterSays(page, re, ms = 30000) {
  let text = null;
  const end = Date.now() + ms;
  while (Date.now() < end) {
    text = await engineMeter(page);
    if (text && re.test(text)) return text;
    await page.waitForTimeout(250);
  }
  return text;
}

async function shapeCheck(browser) {
  const f = [];
  const log = {};
  const { page, context, errors } = await open(browser, 'example=1&theme=dark&lang=en&mode=fast&tour=0');
  await page.locator(SECTION).scrollIntoViewIfNeeded();
  await addFromGallery(page, 'WATER_DROPS');
  const where = () =>
    page.evaluate(() => {
      const sel = document.querySelector('[data-ambient="editor"] select[aria-label="Shape"]');
      const adv = document.querySelector('section.section[data-section="ambient-advanced"]');
      const knobs = document.querySelector('[data-ambient="knobs"]');
      const order = knobs ? [...knobs.querySelectorAll(':scope > [data-knob]')].map((r) => r.getAttribute('data-knob')) : [];
      return {
        inKnobs: !!sel && !!knobs?.contains(sel),
        inAdvanced: !!sel && !!adv?.contains(sel),
        advancedFolded: adv?.hasAttribute('data-collapsed') ?? null,
        visible: !!sel && sel.getBoundingClientRect().height > 0,
        chosen: sel?.selectedOptions[0]?.textContent ?? null,
        order,
        mixInKnobs: !!knobs?.querySelector('[data-ambient="mix"]'),
      };
    });
  log.drop = await where();
  ok(log.drop.inKnobs && !log.drop.inAdvanced && log.drop.advancedFolded === true && log.drop.visible, `the Shape is not a visible knob outside Advanced: ${JSON.stringify(log.drop)}`, f);
  ok(log.drop.chosen === 'Drop', `the shape of Water drops is not Drop: ${log.drop.chosen}`, f);
  ok(log.drop.order.indexOf('ambient.shape') === log.drop.order.indexOf('ambient.size') + 1, `the Shape is not right after the size: ${log.drop.order.join(', ')}`, f);
  await chooseShape(page, 'MIX');
  await settle(page, 400);
  log.undoMix = await undoTip(page);
  ok(/Shape/.test(log.undoMix ?? ''), `choosing Mix is not one entry "Shape": ${log.undoMix}`, f);
  log.mix = await where();
  ok(log.mix.mixInKnobs && log.mix.chosen === 'Mix' && log.mix.advancedFolded === true, `the mix's weights are not among the knobs: ${JSON.stringify(log.mix)}`, f);
  await page.locator('[data-ambient="knobs"]').scrollIntoViewIfNeeded();
  await page.mouse.move(5, 500);
  await settle(page, 400);
  await page.screenshot({ path: join(SHOTS, 'ambient-shape.png') });
  ok(errors.length === 0, `errors in the page: ${errors.join(' | ')}`, f);
  await context.close();
  results.shape = { ok: f.length === 0, failures: f, ...log };
  console.log(`shape: ${f.length === 0 ? 'OK' : `FAILED\n  - ${f.join('\n  - ')}`}`);
}

async function fastCheck(browser) {
  const f = [];
  const log = {};
  if (!existsSync(join(ROOT, 'dist', 'engine', 'rt.wasm'))) {
    results.fast = { ok: false, failures: ['dist/engine/rt.wasm is missing (npm run engine:build, then npm run build)'] };
    console.log('fast: FAILED (no rt.wasm)');
    return;
  }
  const { page, context, errors } = await open(browser, 'example=1&theme=dark&lang=en&mode=fast&tour=0');
  await openFilters(page);
  await page.mouse.move(5, 500);
  await settle(page, 800);
  const before = await viewportPixels(page);
  log.meterBefore = await engineMeter(page);
  ok(!/Front glass/.test(log.meterBefore ?? ''), `the meter speaks of a glass that is off: ${log.meterBefore}`, f);
  await page.locator(`${GLASS} [role="switch"]`).click();
  await settle(page, 300);
  await typeIn(page, page.locator(`${GLASS} [role="spinbutton"][aria-label="Drop size"]`), 8);
  await typeIn(page, page.locator('[data-section="camera"] [role="spinbutton"][aria-label="Aperture"]').first(), 16);
  await typeIn(page, page.locator(`${GLASS} [role="spinbutton"][aria-label="Distance"]`), 150);
  await page.mouse.move(5, 500);
  log.meter = await meterSays(page, /Front glass: approximation of the engine’s [\d,]+ drops/);
  ok(/Front glass: approximation of the engine’s [1-9][\d,]* drops/.test(log.meter ?? ''), `the meter does not say the glass is an approximation of the engine's drops: ${log.meter}`, f);
  await settle(page, 800);
  const after = await viewportPixels(page);
  log.pixelsChanged = changed(before, after);
  ok(log.pixelsChanged > 2000, `the Fast viewport did not draw the glass: ${log.pixelsChanged} pixels changed`, f);
  await page.locator(GLASS).scrollIntoViewIfNeeded();
  await page.mouse.move(5, 500);
  await settle(page, 400);
  await page.screenshot({ path: join(SHOTS, 'lens-glass-fast.png') });
  // From the scene, nothing recorded: a dry pane (the knobs of drops and dust go, the scene's note comes).
  await page.locator(`${GLASS} [data-glass="source"] button[aria-label="From the scene"]`).click();
  await settle(page, 400);
  log.undoSource = await undoTip(page);
  ok(/Drops and dust/.test(log.undoSource ?? ''), `the source is not one entry: ${log.undoSource}`, f);
  log.sceneRows = await page.evaluate(() => ({
    manual: document.querySelector('[data-glass="manual"]')?.getBoundingClientRect().height ?? -1,
    scene: document.querySelector('[data-glass="scene"]')?.getBoundingClientRect().height ?? -1,
    recorded: document.querySelector('[data-glass="recorded"]')?.textContent ?? null,
  }));
  ok(log.sceneRows.manual === 0 && log.sceneRows.scene > 0 && /Nothing recorded/.test(log.sceneRows.recorded ?? ''), `From the scene: ${JSON.stringify(log.sceneRows)}`, f);
  await page.mouse.move(5, 500);
  log.meterDry = await meterSays(page, /Front glass: approximation of the engine’s 0 drops/);
  await settle(page, 800);
  log.pixelsDry = changed(before, await viewportPixels(page));
  ok(log.pixelsDry < log.pixelsChanged / 4, `a dry pane still draws: ${log.pixelsDry} pixels changed`, f);
  ok(errors.length === 0, `errors in the page: ${errors.join(' | ')}`, f);
  await context.close();
  results.fast = { ok: f.length === 0, failures: f, ...log };
  console.log(`fast: ${f.length === 0 ? 'OK' : `FAILED\n  - ${f.join('\n  - ')}`}`);
}

/** What the physics bar says. */
const bar = (page) =>
  page.evaluate(() => {
    const q = (k) => document.querySelector(`[data-field="${k}"]`)?.textContent ?? '';
    return { state: q('phys.state'), time: q('phys.time'), glass: q('phys.glass') };
  });

async function rainCheck(browser) {
  const f = [];
  const log = {};
  const { page, context, errors } = await open(browser, 'example=1&theme=dark&lang=en&mode=fast&tour=0');
  await page.locator(SECTION).scrollIntoViewIfNeeded();
  await addFromGallery(page, 'RAIN');
  // A wind of 6 m/s blowing at the camera (the example's camera is at world azimuth −35°: −125° from +X, so the wind
  // blows towards 235°): the rain reaches a lens that looks a little down.
  await typeIn(page, page.locator('[data-knob="ambient.wind"] [role="spinbutton"]'), 6);
  await typeIn(page, page.locator('[data-knob="ambient.windDir"] [role="spinbutton"]'), 235);
  // A wide lens closed down (35 mm at f/11), where drops on the front glass read as discs rather than a veil.
  await typeIn(page, page.locator('[data-section="camera"] [role="spinbutton"][aria-label="Focal length"]').first(), 35);
  await typeIn(page, page.locator('[data-section="camera"] [role="spinbutton"][aria-label="Aperture"]').first(), 11);
  await openFilters(page);
  await page.locator(`${GLASS} [role="switch"]`).click();
  await settle(page, 300);
  await page.locator(`${GLASS} [data-glass="source"] button[aria-label="From the scene"]`).click();
  await settle(page, 300);
  log.fed = await page.locator('[data-glass="fed"]').textContent();
  ok(/Fed by: Rain/.test(log.fed ?? ''), `the panel does not say the rain feeds the glass: ${log.fed}`, f);
  await page.click('.drawer-btn[data-drawer="physics"]');
  await settle(page, 300);
  await page.evaluate(() => {
    // Pause from inside the page once four seconds are simulated with drops on the glass: a click from outside comes
    // late on a busy main thread.
    new MutationObserver(() => {
      const q = (k) => document.querySelector(`[data-field="${k}"]`)?.textContent ?? '';
      const time = Number((q('phys.time').match(/[0-9.]+/) ?? ['0'])[0]);
      const drops = Number((q('phys.glass').match(/([0-9,]+) drops/)?.[1] ?? '0').replace(/,/g, ''));
      if (!window.__rainPaused && q('phys.state') === 'Running' && time >= 4 && drops > 0) {
        window.__rainPaused = [time, drops];
        document.querySelector('[data-action="phys.pause"]').click();
      }
    }).observe(document.querySelector('.phys'), { subtree: true, childList: true, characterData: true });
  });
  await page.click('[data-action="phys.start"]');
  await page.waitForFunction(() => document.querySelector('[data-field="phys.state"]')?.textContent === 'Paused', null, { timeout: 120000 });
  log.paused = await bar(page);
  ok(/Glass: [1-9][\d,]* drops/.test(log.paused.glass), `the bar does not count the drops on the glass: ${JSON.stringify(log.paused)}`, f);
  await page.locator(GLASS).scrollIntoViewIfNeeded();
  await page.mouse.move(5, 500);
  log.recorded = await page.locator('[data-glass="recorded"]').textContent();
  ok(/Recorded: [\d,]+ frames, [1-9][\d,]* drops/.test(log.recorded ?? ''), `the inspector does not say what the recording holds: ${log.recorded}`, f);
  log.meter = await meterSays(page, /Front glass: approximation of the engine’s [1-9][\d,]* drops/);
  ok(/Front glass: approximation of the engine’s [1-9]/.test(log.meter ?? ''), `the Fast viewport does not draw the recorded glass: ${log.meter}`, f);
  await settle(page, 800);
  await page.screenshot({ path: join(SHOTS, 'physics-rain.png') });
  await page.click('[data-action="phys.stop"]');
  await page.waitForFunction(() => document.querySelector('[data-field="phys.state"]')?.textContent?.startsWith('Stopped'), null, { timeout: 60000 });
  log.undoRun = await undoTip(page);
  ok(/Simulate/.test(log.undoRun ?? ''), `the run is not one undo entry: ${log.undoRun}`, f);
  await page.click('[data-action="phys.reset"]');
  await settle(page, 400);
  log.afterReset = await page.locator('[data-glass="recorded"]').textContent();
  ok(/Nothing recorded/.test(log.afterReset ?? ''), `Reset did not take the recording away: ${log.afterReset}`, f);
  await page.locator('canvas[aria-label="viewport"]').focus();
  await page.keyboard.press('Control+z');
  await settle(page, 400);
  log.afterUndo = await page.locator('[data-glass="recorded"]').textContent();
  ok(/Recorded:/.test(log.afterUndo ?? ''), `Undo did not bring the recording back: ${log.afterUndo}`, f);
  ok(errors.length === 0, `errors in the page: ${errors.join(' | ')}`, f);
  await context.close();
  results.rain = { ok: f.length === 0, failures: f, ...log };
  console.log(`rain: ${f.length === 0 ? 'OK' : `FAILED\n  - ${f.join('\n  - ')}`}`);
}

async function chromeCheck(browser) {
  const f = [];
  const log = {};
  for (const theme of ['dark', 'light']) {
    const { page, context, errors } = await open(browser, `example=1&theme=${theme}&lang=en&mode=fast&tour=0`);
    await openFilters(page);
    await page.locator(`${GLASS} [role="switch"]`).click();
    await settle(page, 300);
    await page.locator(`${GLASS} [data-glass="source"] button[aria-label="From the scene"]`).click();
    await settle(page, 300);
    await page.click('.drawer-btn[data-drawer="physics"]');
    await settle(page, 300);
    const bad = [...(await chromatic(page, GLASS)), ...(await chromatic(page, '.phys'))];
    log[theme] = bad;
    ok(bad.length === 0, `${theme}: colours in the chrome: ${bad.join(' | ')}`, f);
    ok(errors.length === 0, `${theme}: errors in the page: ${errors.join(' | ')}`, f);
    await context.close();
  }
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
  const only = opt('only', 'shape,fast,rain,chrome').split(',');
  if (only.includes('shape')) await shapeCheck(browser);
  if (only.includes('fast')) await fastCheck(browser);
  if (only.includes('rain')) await rainCheck(browser);
  if (only.includes('chrome')) await chromeCheck(browser);
  writeFileSync(join(OUT, 's3b-check.json'), JSON.stringify(results, null, 2));
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
