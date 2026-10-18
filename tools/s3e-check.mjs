#!/usr/bin/env node
// Browser checks of phase S3e (the studio floor, moving parts and the dust's motes) in the built app, with the local
// Chromium and swiftshader.
//
//   npm run engine:build && npm run build && node tools/s3e-check.mjs [--url http://localhost:4199] [--shots docs/ui]
//       [--only floor,note,chrome]
//
// Without --url it serves dist/ with `vite preview` on port 4199 and stops it at the end.
//
//   floor    the example bottle under Rain switched On the parts with a wind and the studio floor on: ▶ Start in the
//            physics bar; paused at 3 s, the Fast viewport draws the wet floor around the bottle (pixels of the floor
//            change against the dry frame), without a shader error; the screenshot physics-rain-floor.png.
//   note     with an engine whose features are patched without bits 11 and 13 (tools/wasm-features.mjs, as an engine of
//            S3f reports them) the effect's editor says the floor will show dry (Rain) and the dust will show without its
//            grains (Dust cloud), in English and in Spanish; with the real rt.wasm, no such note.
//   chrome   the notes S3e adds are achromatic in both themes.
//
// Results: out/s3e-check.json.

import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withFeatures } from './wasm-features.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4199;
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
async function open(browser, query, { blockEngine = false, featureMask = null } = {}) {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1, acceptDownloads: true });
  // S3c: an engine that reports fewer features (tools/wasm-features.mjs), as an older engine would.
  if (featureMask !== null) {
    await context.route(/\/engine\/rt(-simd)?\.wasm/, async (route) => {
      const name = /rt-simd\.wasm/.test(route.request().url()) ? 'rt-simd.wasm' : 'rt.wasm';
      const { wasm } = withFeatures(readFileSync(join(ROOT, 'dist', 'engine', name)), featureMask);
      await route.fulfill({ status: 200, contentType: 'application/wasm', body: Buffer.from(wasm) });
    });
  }
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


/** The engine is ready: the header's Full button can be chosen. */
const engineReady = (page) =>
  until(
    () =>
      page.evaluate(() => {
        const group = document.querySelector('.hdr [role="group"][aria-label="Viewport"], .hdr [role="group"][aria-label="Visor"]');
        const full = group?.querySelectorAll('button')[1];
        return !!full && !full.disabled;
      }),
    60000,
  );


/** What the physics bar says. */
const bar = (page) =>
  page.evaluate(() => {
    const q = (k) => document.querySelector(`[data-field="${k}"]`)?.textContent ?? '';
    return { state: q('phys.state'), time: q('phys.time'), parts: q('phys.parts') };
  });

const needEngine = (name) => {
  if (existsSync(join(ROOT, 'dist', 'engine', 'rt.wasm'))) return false;
  results[name] = { ok: false, failures: ['dist/engine/rt.wasm is missing (npm run engine:build, then npm run build)'] };
  console.log(`${name}: FAILED (no rt.wasm)`);
  return true;
};

/** Starts the physics bar with `preset` switched On the parts (and a wind), pausing from inside the page once `when` holds. */
async function startOnParts(page, preset, wind, when) {
  await page.locator(SECTION).scrollIntoViewIfNeeded();
  await addFromGallery(page, preset);
  if (wind) await typeIn(page, page.locator('[data-knob="ambient.wind"] [role="spinbutton"]'), wind);
  await page.locator('[data-knob="ambient.wetParts"] [role="switch"]').click();
  await settle(page, 300);
  await page.click('.drawer-btn[data-drawer="physics"]');
  await settle(page, 300);
  await page.evaluate((when) => {
    const test = new Function('time', 'parts', `return ${when};`);
    new MutationObserver(() => {
      const q = (k) => document.querySelector(`[data-field="${k}"]`)?.textContent ?? '';
      const time = Number((q('phys.time').match(/[0-9.]+/) ?? ['0'])[0]);
      if (!window.__paused && q('phys.state') === 'Running' && test(time, q('phys.parts'))) {
        window.__paused = [time, q('phys.parts')];
        document.querySelector('[data-action="phys.pause"]').click();
      }
    }).observe(document.querySelector('.phys'), { subtree: true, childList: true, characterData: true });
  }, when);
  await page.click('[data-action="phys.start"]');
  await page.waitForFunction(() => document.querySelector('[data-field="phys.state"]')?.textContent === 'Paused', null, { timeout: 240000 });
}

/** A note of S3e in the effect's editor: shown (its text) or null. */
const note = (page, which) =>
  page.evaluate((which) => {
    const el = document.querySelector(`[data-ambient="${which}"]`);
    return el && el.getBoundingClientRect().height > 0 ? el.textContent : null;
  }, which);

async function floorCheck(browser) {
  const f = [];
  const log = {};
  if (needEngine('floor')) return;
  const { page, context, errors } = await open(browser, 'example=1&theme=dark&lang=en&mode=fast&tour=0');
  log.ready = await engineReady(page);
  ok(log.ready, 'the engine did not get ready', f);
  await settle(page, 800);
  const before = await viewportPixels(page);
  await startOnParts(page, 'RAIN', 3, 'time >= 3');
  await settle(page, 1500);
  log.paused = await page.evaluate(() => window.__paused);
  log.bar = await bar(page);
  ok(/Parts:/.test(log.bar.parts), `the bar does not count the parts: ${log.bar.parts}`, f);
  const after = await viewportPixels(page);
  log.changed = changed(before, after);
  ok(log.changed > 5000, `the wet floor and the drops change too few pixels: ${log.changed}`, f);
  await page.screenshot({ path: join(SHOTS, 'physics-rain-floor.png') });
  log.shot = 'physics-rain-floor.png';
  ok(errors.length === 0, `errors in the page: ${errors.join(' | ')}`, f);
  await context.close();
  results.floor = { ok: f.length === 0, failures: f, ...log };
  console.log(`floor: ${f.length === 0 ? 'OK' : `FAILED\n  - ${f.join('\n  - ')}`}`);
}

async function noteCheck(browser) {
  const f = [];
  const log = {};
  if (needEngine('note')) return;
  for (const [name, mask, lang, preset, which, re] of [
    ['currentRain', null, 'en', 'RAIN', 'wet-floor-old-engine', null],
    ['currentDust', null, 'en', 'DUST_CLOUD', 'wet-motes-old-engine', null],
    ['floorEn', ~(2048 | 8192), 'en', 'RAIN', 'wet-floor-old-engine', /floor will show dry/],
    ['floorEs', ~(2048 | 8192), 'es', 'RAIN', 'wet-floor-old-engine', /suelo se verá seco/],
    ['motesEn', ~(2048 | 8192), 'en', 'DUST_CLOUD', 'wet-motes-old-engine', /without its grains/],
    ['motesEs', ~(2048 | 8192), 'es', 'DUST_CLOUD', 'wet-motes-old-engine', /sin sus granos/],
  ]) {
    const { page, context, errors } = await open(browser, `example=1&theme=dark&lang=${lang}&mode=fast&tour=0`, { featureMask: mask });
    await page.locator(SECTION).scrollIntoViewIfNeeded();
    await addFromGallery(page, preset);
    log[`${name}Ready`] = await engineReady(page);
    ok(log[`${name}Ready`], `${name}: the engine did not get ready`, f);
    ok((await note(page, which)) === null, `${name}: a note before the effect falls on the parts`, f);
    await page.locator('[data-knob="ambient.wetParts"] [role="switch"]').click();
    await settle(page, 600);
    if (re === null) {
      await settle(page, 1500);
      log[name] = await note(page, which);
      ok(log[name] === null, `${name}: a note where there should be none: ${log[name]}`, f);
    } else {
      const shown = await until(async () => (await note(page, which)) !== null, 60000);
      log[name] = await note(page, which);
      ok(shown && re.test(log[name] ?? ''), `${name}: no note for an engine without the bit: ${log[name]}`, f);
    }
    ok(errors.length === 0, `${name}: errors in the page: ${errors.join(' | ')}`, f);
    await context.close();
  }
  results.note = { ok: f.length === 0, failures: f, ...log };
  console.log(`note: ${f.length === 0 ? 'OK' : `FAILED\n  - ${f.join('\n  - ')}`}`);
}

async function chromeCheck(browser) {
  const f = [];
  const log = {};
  if (needEngine('chrome')) return;
  for (const theme of ['dark', 'light']) {
    const { page, context } = await open(browser, `example=1&theme=${theme}&lang=en&mode=fast&tour=0`, { featureMask: ~(2048 | 8192) });
    await page.locator(SECTION).scrollIntoViewIfNeeded();
    await addFromGallery(page, 'DUST_CLOUD');
    await engineReady(page);
    await page.locator('[data-knob="ambient.wetParts"] [role="switch"]').click();
    await until(async () => (await note(page, 'wet-motes-old-engine')) !== null, 60000);
    const bad = await chromatic(page, '[data-ambient="wet-motes-old-engine"]');
    log[theme] = bad;
    ok(bad.length === 0, `${theme}: colour in the note: ${bad.join(', ')}`, f);
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
  const only = opt('only', 'floor,note,chrome').split(',');
  if (only.includes('floor')) await floorCheck(browser);
  if (only.includes('note')) await noteCheck(browser);
  if (only.includes('chrome')) await chromeCheck(browser);
  writeFileSync(join(OUT, 's3e-check.json'), JSON.stringify(results, null, 2));
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
