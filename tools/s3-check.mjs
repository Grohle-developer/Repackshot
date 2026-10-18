#!/usr/bin/env node
// Browser checks of phase S3 (the drop shape and the mixes of shapes of the ambient effects, the front glass of the
// camera) in the built app, with the local Chromium and swiftshader.
//
//   npm run engine:build && npm run build && node tools/s3-check.mjs [--url http://localhost:4197] [--shots docs/ui]
//       [--only drops,mix,glass,chrome]
//
// Without --url it serves dist/ with `vite preview` on port 4197 and stops it at the end (by the pids `lsof` reports).
//
//   drops   on the example bottle, Scene ▸ Ambient ▸ Add has the Water drops card (nine presets and the three volumes of
//           S5 coming soon); it adds the effect in one undo entry; Advanced shows the shape Drop chosen, the drop's
//           length and tip and the shape variation; the Fast preview draws the drops rt.wasm evaluates (the pixels
//           change, the meter counts them). Screenshot ambient-drops.png.
//   mix     Shape ▸ Mix (one undo entry) shows the four weights and the shares they give; a weight with the keyboard is
//           one entry; the preview draws the mix (rt_particles_shapes) and its pixels change; Undo goes back to the
//           drop, one entry at a time. Screenshot ambient-mix.png.
//   glass   in Full mode, Camera ▸ Lens ▸ Filters ▸ Front glass: off, without knobs; on (one undo entry "Front glass
//           on"), the knobs show; drops of 8 mm on a pane 150 mm in front of the lens at f/16 (one entry each) and the
//           engine's picture changes; Undo takes them back and the glass off. Screenshot lens-glass.png (the panel beside
//           the Full render through the glass).
//   chrome  the rows S3 adds (shape, mix, drop, front glass) are achromatic in both themes.
//
// Results: out/s3-check.json.

import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4197;
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

/** Waits until the preview has evaluated the particles (the meter says how many) or `ms` passes. */
async function waitForMeter(page, re, ms = 20000) {
  const end = Date.now() + ms;
  let text = null;
  while (Date.now() < end) {
    text = await meter(page);
    if (text && re.test(text)) return text;
    await page.waitForTimeout(200);
  }
  return text;
}


/** Opens Advanced of the effect being edited (folded at first). */
async function openAdvanced(page) {
  const adv = page.locator('section.section[data-section="ambient-advanced"]');
  if ((await adv.getAttribute('data-collapsed')) !== null) {
    await adv.locator('.section-head, header, [data-action]').first().click();
    await settle(page, 300);
  }
}

/** What the Shape list shows. */
const shapeChosen = (page) =>
  page.evaluate(() => {
    const sel = document.querySelector('[data-ambient="editor"] select[aria-label="Shape"]');
    return sel ? (sel.selectedOptions[0]?.textContent ?? null) : null;
  });
const chooseShape = (page, value) => page.locator('[data-ambient="editor"] select[aria-label="Shape"]').selectOption(value);

async function dropsCheck(browser) {
  const f = [];
  const log = {};
  const { page, context, errors } = await open(browser, 'example=1&theme=dark&lang=en&mode=fast&tour=0');
  await page.locator(SECTION).scrollIntoViewIfNeeded();
  const before = await viewportPixels(page);
  await page.locator(`${SECTION} [data-ambient="add"]`).click();
  await page.waitForSelector('[data-ambient="gallery"]');
  const cards = await page.evaluate(() => [...document.querySelectorAll('[data-ambient="gallery"] [data-preset]')].map((c) => ({ key: c.getAttribute('data-preset'), disabled: c.disabled })));
  log.cards = cards.map((c) => c.key);
  ok(cards.length === 12 && cards.filter((c) => !c.disabled).length === 9 && cards.some((c) => c.key === 'WATER_DROPS' && !c.disabled), `the gallery does not offer Water drops among nine: ${log.cards.join(', ')}`, f);
  await page.locator('[data-ambient="gallery"] [data-preset="WATER_DROPS"]').click();
  await page.waitForSelector('[data-ambient="editor"]');
  await settle(page, 300);
  log.undoAdd = await undoTip(page);
  ok(/Add Water drops/.test(log.undoAdd ?? ''), `the undo does not name the effect: ${log.undoAdd}`, f);
  await openAdvanced(page);
  log.shape = await shapeChosen(page);
  ok(log.shape === 'Drop', `the shape is not Drop: ${log.shape}`, f);
  const rows = await page.evaluate(() => ({
    drop: [...document.querySelectorAll('[data-ambient="drop"] [data-knob]')].map((r) => r.getAttribute('data-knob')),
    variation: !!document.querySelector('[data-knob="ambient.shapeVar"]'),
    mix: !!document.querySelector('[data-ambient="mix"]'),
  }));
  log.rows = rows;
  ok(rows.drop.join() === 'ambient.dropTail,ambient.dropTip' && rows.variation && !rows.mix, `the drop's rows are not there: ${JSON.stringify(rows)}`, f);
  log.meter = await waitForMeter(page, /^Particles [\d,]+ of [\d,]+$/);
  ok(/^Particles [\d,]+ of [\d,]+$/.test(log.meter ?? ''), `the meter does not count the drops: ${log.meter}`, f);
  await settle(page, 600);
  const after = await viewportPixels(page);
  log.pixelsChanged = changed(before, after);
  ok(log.pixelsChanged > 200, `the preview did not draw the drops: ${log.pixelsChanged} pixels changed`, f);
  await page.locator('[data-ambient="editor"] select[aria-label="Shape"]').scrollIntoViewIfNeeded();
  await page.mouse.move(5, 500);
  await settle(page, 300);
  await page.screenshot({ path: join(SHOTS, 'ambient-drops.png') });
  ok(errors.length === 0, `errors in the page: ${errors.join(' | ')}`, f);
  await context.close();
  results.drops = { ok: f.length === 0, failures: f, ...log };
  console.log(`drops: ${f.length === 0 ? 'OK' : `FAILED\n  - ${f.join('\n  - ')}`}`);
}

async function mixCheck(browser) {
  const f = [];
  const log = {};
  const { page, context, errors } = await open(browser, 'example=1&theme=dark&lang=en&mode=fast&tour=0');
  await page.locator(SECTION).scrollIntoViewIfNeeded();
  await addFromGallery(page, 'WATER_DROPS');
  await openAdvanced(page);
  await waitForMeter(page, /^Particles [\d,]+ of [\d,]+$/);
  await settle(page, 600);
  const drops = await viewportPixels(page);
  await chooseShape(page, 'MIX');
  await page.waitForSelector('[data-ambient="mix"]');
  await settle(page, 400);
  log.undoMix = await undoTip(page);
  ok(/Water drops: Shape/.test(log.undoMix ?? ''), `the undo does not name the shape: ${log.undoMix}`, f);
  log.shape = await shapeChosen(page);
  const weights = await page.evaluate(() => [...document.querySelectorAll('[data-ambient="mix"] [data-knob]')].map((r) => r.getAttribute('data-knob')));
  log.weights = weights;
  log.shares = await page.locator('[data-ambient="mix-shares"]').textContent();
  ok(log.shape === 'Mix' && weights.join() === 'ambient.mix.SPHERE,ambient.mix.DISC,ambient.mix.CAPSULE,ambient.mix.DROP', `the mix's weights are not there: ${log.shape} ${weights.join()}`, f);
  ok(/Point 20 % · Flake 20 % · Streak 20 % · Drop 40 %/.test(log.shares ?? ''), `the shares are not the default mix's: ${log.shares}`, f);
  // A weight with the keyboard: one entry, and the shares follow.
  const disc = page.locator('[data-ambient="mix"] [data-knob="ambient.mix.DISC"] [role="spinbutton"]');
  await disc.focus();
  await page.keyboard.press('ArrowUp');
  await settle(page, 700);
  log.undoWeight = await undoTip(page);
  ok(/Water drops: Flakes/.test(log.undoWeight ?? ''), `the weight is not one entry: ${log.undoWeight}`, f);
  await settle(page, 800);
  const mixed = await viewportPixels(page);
  log.pixelsChanged = changed(drops, mixed);
  ok(log.pixelsChanged > 100, `the preview did not draw the mix: ${log.pixelsChanged} pixels changed`, f);
  await page.locator('[data-ambient="mix"]').scrollIntoViewIfNeeded();
  await page.mouse.move(5, 500);
  await settle(page, 300);
  await page.screenshot({ path: join(SHOTS, 'ambient-mix.png') });
  // Undo: the weight, then the drop again.
  await page.locator('canvas[aria-label="viewport"]').focus();
  await page.keyboard.press('Control+z');
  await settle(page, 300);
  await page.keyboard.press('Control+z');
  ok(await until(async () => (await shapeChosen(page)) === 'Drop' && (await page.locator('[data-ambient="mix"]').count()) === 0), 'Undo did not bring the drop back', f);
  ok(errors.length === 0, `errors in the page: ${errors.join(' | ')}`, f);
  await context.close();
  results.mix = { ok: f.length === 0, failures: f, ...log };
  console.log(`mix: ${f.length === 0 ? 'OK' : `FAILED\n  - ${f.join('\n  - ')}`}`);
}

/** Waits for the Full engine to have `n` samples of what is asked now. */
async function waitSamples(page, n, ms = 400000) {
  await page.waitForFunction(
    (want) => {
      const m = document.querySelector('.ov-bl');
      return m && m.dataset.mode === 'full' && Number(m.dataset.samples) >= want && m.dataset.shownKey === m.dataset.wantKey;
    },
    n,
    { timeout: ms, polling: 500 },
  );
}

/** Opens Camera ▸ Lens ▸ Filters. */
async function openFilters(page) {
  const head = page.locator('[data-section="camera"] [data-action="cameraFilters"]');
  await head.scrollIntoViewIfNeeded();
  if ((await head.getAttribute('aria-expanded')) !== 'true') await head.click();
  await settle(page, 400);
}

async function glassCheck(browser) {
  const f = [];
  const log = {};
  if (!existsSync(join(ROOT, 'dist', 'engine', 'rt.wasm'))) {
    results.glass = { ok: true, skipped: 'dist/engine/rt.wasm is missing (npm run engine:build, then npm run build)' };
    console.log('glass: skipped (no rt.wasm)');
    return;
  }
  const { page, context, errors } = await open(browser, 'example=1&theme=dark&lang=en&mode=full&tour=0');
  await page.waitForFunction(() => document.querySelector('.ov-bl')?.dataset.mode === 'full', null, { timeout: 90000 });
  await openFilters(page);
  const sw = page.locator(`${GLASS} [role="switch"]`);
  log.offKnobs = await page.locator(`${GLASS} [data-glass="knobs"]`).isVisible();
  ok((await sw.getAttribute('aria-checked')) === 'false' && !log.offKnobs, 'the front glass is not off without its knobs at first', f);
  await page.mouse.move(5, 500);
  await waitSamples(page, 8);
  const before = await viewportPixels(page);
  await sw.click();
  await settle(page, 300);
  log.undoOn = await undoTip(page);
  ok(/Front glass on/.test(log.undoOn ?? ''), `the undo does not say the front glass: ${log.undoOn}`, f);
  ok(await page.locator(`${GLASS} [data-glass="knobs"]`).isVisible(), 'the knobs do not show', f);
  // Drops wider than the aperture's footprint on the pane (one entry): through the example's lens at f/5.6 the 2 mm
  // ones of the start only veil the picture, as on a real lens; wider ones are soft discs with the scene in them.
  const size = page.locator(`${GLASS} [role="spinbutton"][aria-label="Drop size"]`);
  await size.focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Control+a');
  await page.keyboard.type('8');
  await page.keyboard.press('Enter');
  await settle(page, 300);
  log.undoSize = await undoTip(page);
  ok(/Drop size/.test(log.undoSize ?? ''), `the drop size is not one entry: ${log.undoSize}`, f);
  // And farther from the lens (a wet window in front of the camera), through a smaller aperture (f/16), where the frame
  // crosses more of the pane than the aperture's footprint does: the drops are soft discs then.
  const fstop = page.locator('[data-section="camera"] [role="spinbutton"][aria-label="Aperture"]').first();
  await fstop.scrollIntoViewIfNeeded();
  await fstop.focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Control+a');
  await page.keyboard.type('16');
  await page.keyboard.press('Enter');
  await settle(page, 300);
  log.undoFstop = await undoTip(page);
  const distance = page.locator(`${GLASS} [role="spinbutton"][aria-label="Distance"]`);
  await distance.focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Control+a');
  await page.keyboard.type('150');
  await page.keyboard.press('Enter');
  await settle(page, 300);
  log.undoDistance = await undoTip(page);
  ok(/Distance/.test(log.undoDistance ?? ''), `the distance is not one entry: ${log.undoDistance}`, f);
  await page.mouse.move(5, 500);
  await waitSamples(page, 24);
  const after = await viewportPixels(page);
  log.pixelsChanged = changed(before, after);
  ok(log.pixelsChanged > 2000, `the Full engine did not draw the glass: ${log.pixelsChanged} pixels changed`, f);
  await page.locator(GLASS).scrollIntoViewIfNeeded();
  await page.mouse.move(5, 500);
  await settle(page, 300);
  await page.screenshot({ path: join(SHOTS, 'lens-glass.png') });
  // Undo four times: the distance, the aperture, the size, then the glass off.
  await page.locator('canvas[aria-label="viewport"]').focus();
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press('Control+z');
    await settle(page, 300);
  }
  ok(await until(async () => (await sw.getAttribute('aria-checked')) === 'false'), 'Undo did not take the glass off', f);
  ok(errors.length === 0, `errors in the page: ${errors.join(' | ')}`, f);
  await context.close();
  results.glass = { ok: f.length === 0, failures: f, ...log };
  console.log(`glass: ${f.length === 0 ? 'OK' : `FAILED\n  - ${f.join('\n  - ')}`}`);
}

async function chromeCheck(browser) {
  const f = [];
  const log = {};
  for (const theme of ['dark', 'light']) {
    const { page, context, errors } = await open(browser, `example=1&theme=${theme}&lang=en&mode=fast&tour=0`);
    await page.locator(SECTION).scrollIntoViewIfNeeded();
    await addFromGallery(page, 'WATER_DROPS');
    await openAdvanced(page);
    await chooseShape(page, 'MIX');
    await page.waitForSelector('[data-ambient="mix"]');
    await openFilters(page);
    await page.locator(`${GLASS} [role="switch"]`).click();
    await settle(page, 300);
    const bad = [
      ...(await chromatic(page, '[data-ambient="editor"] select[aria-label="Shape"]')),
      ...(await chromatic(page, '[data-ambient="mix"]')),
      ...(await chromatic(page, '[data-ambient="drop"]')),
      ...(await chromatic(page, GLASS)),
    ];
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
  const only = opt('only', 'drops,mix,glass,chrome').split(',');
  if (only.includes('drops')) await dropsCheck(browser);
  if (only.includes('mix')) await mixCheck(browser);
  if (only.includes('glass')) await glassCheck(browser);
  if (only.includes('chrome')) await chromeCheck(browser);
  writeFileSync(join(OUT, 's3-check.json'), JSON.stringify(results, null, 2));
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
