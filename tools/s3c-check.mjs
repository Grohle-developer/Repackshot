#!/usr/bin/env node
// Browser checks of phase S3c (rain and dust on the parts, and the warning of an engine that would draw a glass fed by
// the scene clean) in the built app, with the local Chromium and swiftshader.
//
//   npm run engine:build && npm run build && node tools/s3c-check.mjs [--url http://localhost:4199] [--shots docs/ui]
//       [--only warning,chrome]
//
// Without --url it serves dist/ with `vite preview` on port 4199 and stops it at the end.
//
//   warning  the example with Rain and the front glass fed by the scene: with the real rt.wasm (bit 7) the inspector
//            has no warning; with one whose features are patched without bit 7 (tools/wasm-features.mjs, as an older
//            engine reports them) it says the render will show the glass clean, in English and in Spanish; set by hand
//            the warning goes.
//   chrome   the rows S3c adds are achromatic in both themes.
//
// Results: out/s3c-check.json.

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


/** Opens the example with Rain and its front glass on, fed by the scene. */
async function rainyGlass(page) {
  await page.locator(SECTION).scrollIntoViewIfNeeded();
  await addFromGallery(page, 'RAIN');
  await openFilters(page);
  await page.locator(`${GLASS} [role="switch"]`).click();
  await settle(page, 300);
  await page.locator(`${GLASS} [data-glass="source"] button[aria-label="${await sourceLabel(page)}"]`).click();
  await settle(page, 300);
}

/** The From the scene button's label in the page's language. */
const sourceLabel = (page) => page.evaluate(() => (document.documentElement.lang === 'es' ? 'De la escena' : 'From the scene'));

/** The old-engine note: shown (its text) or null. */
const oldEngineNote = (page) =>
  page.evaluate(() => {
    const el = document.querySelector('[data-glass="old-engine"]');
    return el && el.getBoundingClientRect().height > 0 ? el.textContent : null;
  });

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

async function warningCheck(browser) {
  const f = [];
  const log = {};
  if (!existsSync(join(ROOT, 'dist', 'engine', 'rt.wasm'))) {
    results.warning = { ok: false, failures: ['dist/engine/rt.wasm is missing (npm run engine:build, then npm run build)'] };
    console.log('warning: FAILED (no rt.wasm)');
    return;
  }
  // The engine of this build reads the glass drop by drop: no warning.
  {
    const { page, context, errors } = await open(browser, 'example=1&theme=dark&lang=en&mode=fast&tour=0');
    await rainyGlass(page);
    log.engineReady = await engineReady(page);
    ok(log.engineReady, 'the engine did not get ready', f);
    await settle(page, 600);
    log.current = await oldEngineNote(page);
    ok(log.current === null, `the engine of this build is warned about: ${log.current}`, f);
    ok(errors.length === 0, `errors in the page: ${errors.join(' | ')}`, f);
    await context.close();
  }
  // One without bit 7, in both languages.
  for (const lang of ['en', 'es']) {
    const { page, context, errors } = await open(browser, `example=1&theme=dark&lang=${lang}&mode=fast&tour=0`, { featureMask: ~128 });
    await rainyGlass(page);
    log[`${lang}Ready`] = await engineReady(page);
    const shown = await until(async () => (await oldEngineNote(page)) !== null, 60000);
    log[lang] = await oldEngineNote(page);
    ok(shown && (lang === 'en' ? /show this glass clean/ : /enseñará este cristal limpio/).test(log[lang] ?? ''), `${lang}: no warning for an engine without bit 7: ${log[lang]}`, f);
    if (lang === 'en') {
      await page.locator(GLASS).scrollIntoViewIfNeeded();
      await page.mouse.move(5, 500);
      await settle(page, 300);
      // By hand: an engine of S3 draws that one, no warning.
      await page.locator(`${GLASS} [data-glass="source"] button[aria-label="By hand"]`).click();
      await settle(page, 400);
      log.manual = await oldEngineNote(page);
      ok(log.manual === null, `a glass set by hand is warned about: ${log.manual}`, f);
    }
    ok(errors.length === 0, `${lang}: errors in the page: ${errors.join(' | ')}`, f);
    await context.close();
  }
  results.warning = { ok: f.length === 0, failures: f, ...log };
  console.log(`warning: ${f.length === 0 ? 'OK' : `FAILED\n  - ${f.join('\n  - ')}`}`);
}

async function chromeCheck(browser) {
  const f = [];
  const log = {};
  for (const theme of ['dark', 'light']) {
    const { page, context, errors } = await open(browser, `example=1&theme=${theme}&lang=en&mode=fast&tour=0`, { featureMask: ~128 });
    await rainyGlass(page);
    await until(async () => (await oldEngineNote(page)) !== null, 60000);
    const bad = await chromatic(page, GLASS);
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
  const only = opt('only', 'warning,chrome').split(',');
  if (only.includes('warning')) await warningCheck(browser);
  if (only.includes('chrome')) await chromeCheck(browser);
  writeFileSync(join(OUT, 's3c-check.json'), JSON.stringify(results, null, 2));
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
