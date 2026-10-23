#!/usr/bin/env node
// Browser checks of phase S7 (liquids) in the built app, with the local Chromium and swiftshader.
//
//   npm run engine:build && npm run build && node tools/s7-check.mjs [--url http://localhost:4217] [--shots docs/ui]
//       [--only pour,note,chrome,sheet]
//
// Without --url it serves dist/ with `vite preview` on port 4217 and stops it at the end.
//
//   pour     the example bottle: a right click on its Cap in the scene tree ▸ Convert to liquid ▸ Honey; one undo step
//            ("Undo: Convert Cap to Honey"), the cap hidden and "Cap (Honey)" in the tree, selected, its Liquid section
//            in the inspector with the estimate from its volume. ▶ Start in the physics bar; paused at 1 s, the bar
//            counts the particles the engine filled it with, the section says what was recorded, and the Fast viewport
//            draws the liquid's surface where it flowed (the pixels around the bottle's top change), without a shader
//            error; the screenshot liquid-pour.png.
//   note     with an engine whose features are patched without bit 14 (tools/wasm-features.mjs, as an engine of S3e
//            reports them) the Liquid section says the liquid meets its glass as against air, in English and in
//            Spanish; with the real rt.wasm, no such note.
//   chrome   the Liquid section is achromatic in both themes.
//   sheet    out/liquid-sheet.html (rt --liquid-sheet out), as a page: the screenshot liquid-sheet.png.
//
// Results: out/s7-check.json.

import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { withFeatures } from './wasm-features.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4217;
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

/** A page of the app; `featureMask` makes the engine report fewer features, as an older engine would. */
async function open(browser, query, { featureMask = null } = {}) {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
  if (featureMask !== null) {
    await context.route(/\/engine\/rt(-simd)?\.wasm/, async (route) => {
      const name = /rt-simd\.wasm/.test(route.request().url()) ? 'rt-simd.wasm' : 'rt.wasm';
      const { wasm } = withFeatures(readFileSync(join(ROOT, 'dist', 'engine', name)), featureMask);
      await route.fulfill({ status: 200, contentType: 'application/wasm', body: Buffer.from(wasm) });
    });
  }
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
const SECTION = 'section.section[data-section="liquid"]';
const undoTip = (page) => page.locator('.hdr button[aria-label="Undo"], .hdr button[aria-label="Deshacer"]').first().getAttribute('data-tip');

/** Polls `test` (an async predicate) until it holds or `ms` passes; whether it held. */
async function until(test, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await test()) return true;
    await new Promise((r) => setTimeout(r, 150));
  }
  return test();
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

/** The pixels of the viewport canvas as an RGB array (from a screenshot), and its width. */
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
    return { width: img.width, px: Array.from(g.getImageData(0, 0, c.width, c.height).data) };
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

/** The scene tree's row of `name`. */
const row = (page, name) => page.locator('.tree-row', { has: page.locator('.tree-name', { hasText: new RegExp(`^${name.replace(/[()]/g, '\\$&')}$`) }) }).first();

/** Right click on `name` in the tree ▸ Convert to liquid ▸ `liquid`. */
async function convert(page, name, liquid, menu = 'Convert to liquid') {
  const r = row(page, name);
  await r.scrollIntoViewIfNeeded();
  await r.click();
  await settle(page);
  await r.click({ button: 'right' });
  await settle(page, 150);
  await page.locator('.floating .menu-item', { hasText: new RegExp(`^${menu}`) }).hover();
  await settle(page, 200);
  await page.locator('.menu-sub .menu-item', { hasText: new RegExp(`^${liquid}$`) }).click();
  await settle(page, 400);
}

/** What the physics bar says. */
const bar = (page) =>
  page.evaluate(() => {
    const q = (k) => document.querySelector(`[data-field="${k}"]`)?.textContent ?? '';
    return { state: q('phys.state'), time: q('phys.time'), liquid: q('phys.liquid') };
  });

/** A text of the Liquid section (its `data-field`), or null. */
const field = (page, k) => page.evaluate((k) => document.querySelector(`[data-section="liquid"] [data-field="${k}"]`)?.textContent ?? null, k);

/** The note of an older engine in the Liquid section: shown (its text) or null. */
const note = (page) =>
  page.evaluate(() => {
    const el = document.querySelector('[data-liquid="old-engine"]');
    return el && el.getBoundingClientRect().height > 0 ? el.textContent : null;
  });

const needEngine = (name) => {
  if (existsSync(join(ROOT, 'dist', 'engine', 'rt.wasm'))) return false;
  results[name] = { ok: false, failures: ['dist/engine/rt.wasm is missing (npm run engine:build, then npm run build)'] };
  console.log(`${name}: FAILED (no rt.wasm)`);
  return true;
};

async function pourCheck(browser) {
  const f = [];
  const log = {};
  if (needEngine('pour')) return;
  const { page, context, errors } = await open(browser, 'example=1&theme=dark&lang=en&mode=fast&tour=0');
  log.ready = await engineReady(page);
  ok(log.ready, 'the engine did not get ready', f);
  await page.mouse.move(10, 500);
  await settle(page, 600);
  const before = await viewportPixels(page);
  await convert(page, 'Cap', 'Honey');
  log.undo = await undoTip(page);
  ok(/Convert Cap to Honey/.test(log.undo ?? ''), `the undo step: ${log.undo}`, f);
  log.row = await row(page, 'Cap (Honey)').count();
  ok(log.row === 1, 'no "Cap (Honey)" in the tree', f);
  log.section = await page.locator(SECTION).count();
  ok(log.section === 1, 'no Liquid section in the inspector', f);
  log.estimate = await field(page, 'liquid.count');
  ok(/About [0-9,]+ particles at [0-9.]+ mm \(from the volume, [0-9.]+ ml\)/.test(log.estimate ?? ''), `the estimate: ${log.estimate}`, f);
  log.motion = await field(page, 'liquid.motion');
  ok(/Viscosity: 10,000(\.0)? mm²\/s/.test(log.motion ?? ''), `the motion: ${log.motion}`, f);
  // The bar is open (Convert opens it). Pause from inside the page at 1 s simulated: a click from outside comes late.
  await page.evaluate(() => {
    new MutationObserver(() => {
      const q = (k) => document.querySelector(`[data-field="${k}"]`)?.textContent ?? '';
      const time = Number((q('phys.time').match(/[0-9.]+/) ?? ['0'])[0]);
      if (!window.__paused && q('phys.state') === 'Running' && time >= 1) {
        window.__paused = [time, q('phys.liquid')];
        document.querySelector('.phys [data-action="phys.pause"]').click();
      }
    }).observe(document.querySelector('.phys'), { subtree: true, childList: true, characterData: true });
  });
  await page.click('.phys [data-action="phys.start"]');
  const start = Date.now();
  for (;;) {
    const now = await bar(page);
    if (now.state === 'Paused') break;
    if (Date.now() - start > 900000) throw new Error(`the run did not pause in 900 s: ${JSON.stringify(now)}`);
    console.log(`  ${Math.round((Date.now() - start) / 1000)} s: ${now.state} · ${now.time} · ${now.liquid}`);
    await page.waitForTimeout(15000);
  }
  log.paused = await page.evaluate(() => window.__paused);
  log.bar = await bar(page);
  ok(/^Liquid: [0-9,]+ particles$/.test(log.bar.liquid), `the bar does not count the particles: ${log.bar.liquid}`, f);
  log.recorded = await field(page, 'liquid.count');
  ok(/^Recorded: [0-9,]+ frames of [0-9,]+ particles$/.test(log.recorded ?? ''), `the section after the run: ${log.recorded}`, f);
  await page.mouse.move(10, 500);
  await settle(page, 1500);
  const after = await viewportPixels(page);
  log.changed = changed(before.px, after.px);
  ok(log.changed > 500, `the viewport does not show the liquid where it flowed: ${log.changed} pixels changed`, f);
  await page.screenshot({ path: join(SHOTS, 'liquid-pour.png') });
  log.shot = 'liquid-pour.png';
  ok(errors.length === 0, `errors in the page: ${errors.join(' | ')}`, f);
  await context.close();
  results.pour = { ok: f.length === 0, failures: f, ...log };
  console.log(`pour: ${f.length === 0 ? 'OK' : `FAILED\n  - ${f.join('\n  - ')}`} (${JSON.stringify(log.paused)}, ${log.changed} px)`);
}

async function noteCheck(browser) {
  const f = [];
  const log = {};
  if (needEngine('note')) return;
  for (const [name, mask, lang, re] of [
    ['current', null, 'en', null],
    ['olderEn', ~16384, 'en', /against air/],
    ['olderEs', ~16384, 'es', /aire/],
  ]) {
    const { page, context, errors } = await open(browser, `example=1&theme=dark&lang=${lang}&mode=fast&tour=0`, { featureMask: mask });
    log[`${name}Ready`] = await engineReady(page);
    ok(log[`${name}Ready`], `${name}: the engine did not get ready`, f);
    await convert(page, lang === 'es' ? 'Tapón' : 'Cap', lang === 'es' ? 'Agua' : 'Water', lang === 'es' ? 'Convertir en líquido' : 'Convert to liquid');
    await settle(page, 800);
    if (re === null) {
      await settle(page, 1500);
      log[name] = await note(page);
      ok(log[name] === null, `${name}: a note where there should be none: ${log[name]}`, f);
    } else {
      const shown = await until(async () => (await note(page)) !== null, 60000);
      log[name] = await note(page);
      ok(shown && re.test(log[name] ?? ''), `${name}: no note for an engine without bit 14: ${log[name]}`, f);
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
    const { page, context } = await open(browser, `example=1&theme=${theme}&lang=en&mode=fast&tour=0`, { featureMask: ~16384 });
    await engineReady(page);
    await convert(page, 'Cap', 'Water');
    await until(async () => (await note(page)) !== null, 60000);
    const bad = await chromatic(page, SECTION);
    log[theme] = bad;
    ok(bad.length === 0, `${theme}: colour in the Liquid section: ${bad.join(', ')}`, f);
    await context.close();
  }
  results.chrome = { ok: f.length === 0, failures: f, ...log };
  console.log(`chrome: ${f.length === 0 ? 'OK' : `FAILED\n  - ${f.join('\n  - ')}`}`);
}

async function sheetCheck(browser) {
  const f = [];
  const log = {};
  const sheet = join(OUT, 'liquid-sheet.html');
  if (!existsSync(sheet)) {
    results.sheet = { ok: false, failures: ['out/liquid-sheet.html is missing (./engine/target/release/rt --liquid-sheet out)'] };
    console.log('sheet: FAILED (no sheet)');
    return;
  }
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1, colorScheme: 'dark' });
  const page = await context.newPage();
  await page.goto(pathToFileURL(sheet).href);
  await page.waitForLoadState('load');
  log.images = await page.locator('figure img').count();
  ok(log.images >= 10, `the sheet has ${log.images} images`, f);
  log.broken = await page.evaluate(() => [...document.images].filter((i) => !i.complete || i.naturalWidth === 0).map((i) => i.src));
  ok(log.broken.length === 0, `images that do not load: ${log.broken.join(', ')}`, f);
  await page.screenshot({ path: join(SHOTS, 'liquid-sheet.png'), fullPage: true });
  log.shot = 'liquid-sheet.png';
  await context.close();
  results.sheet = { ok: f.length === 0, failures: f, ...log };
  console.log(`sheet: ${f.length === 0 ? 'OK' : `FAILED\n  - ${f.join('\n  - ')}`}`);
}

let server = null;
let browser = null;
try {
  const only = opt('only', 'pour,note,chrome,sheet').split(',');
  const app = only.some((o) => o !== 'sheet');
  if (app && !existsSync(join(ROOT, 'dist', 'index.html'))) fail('dist/ is missing: npm run build first');
  if (app && !BASE_URL) {
    stopServer(PORT);
    server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: 'ignore', detached: true });
    BASE_URL = `http://localhost:${PORT}`;
  }
  if (app) await waitFor(BASE_URL);
  const { chromium } = await import('playwright-core');
  browser = await chromium.launch({ executablePath: findChromium(), headless: true, args: ['--no-sandbox', '--disable-gpu', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  if (only.includes('pour')) await pourCheck(browser);
  if (only.includes('note')) await noteCheck(browser);
  if (only.includes('chrome')) await chromeCheck(browser);
  if (only.includes('sheet')) await sheetCheck(browser);
  writeFileSync(join(OUT, 's7-check.json'), JSON.stringify(results, null, 2));
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
