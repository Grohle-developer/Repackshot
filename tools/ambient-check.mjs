#!/usr/bin/env node
// Browser checks of phase S4a (ambient particles in the Scene tab) in the built app, with the local Chromium and
// swiftshader.
//
//   npm run engine:build && npm run build && node tools/ambient-check.mjs [--url http://localhost:4196] [--shots docs/ui]
//
// Without --url it serves dist/ with `vite preview` on port 4196 and stops it at the end (by the pids `lsof` reports).
//
//   section   on the example bottle, the Scene inspector has the Ambient section after Environment and before Camera,
//             empty; Add opens the gallery of cards (the nine presets, S3's drops among them, and the three volumes of S5 greyed and
//             disabled as coming soon); a card adds the effect (one undo entry that names it), the list shows it with
//             its particles, the editor shows the preset, the eight knobs and Advanced folded; the Fast preview draws
//             the particles rt.wasm evaluates (the viewport's pixels change, the meter says how many); Preset changes
//             it (one entry); a knob with the keyboard (one entry); Undo takes the knob, the preset and the effect back
//             one at a time, and Redo puts them again.
//   save      Save project writes the effect into the project file (the browser's download), and Open project in a
//             fresh page reads it back: the same effect, preset, seed and amount.
//   cap       Settings ▸ Render engine ▸ Particles per effect below what the effect asks makes the Doctor warn and the
//             list say what the engine evaluates; Automatic again, and the warning goes.
//   boxes     without rt.wasm (its requests refused) the preview draws the region box only, and the meter says so.
//   chrome    the Ambient section and its gallery are achromatic (every computed colour of their elements has
//             r = g = b), in both themes.
//
// Screenshots (docs/ui): ambient-section.png, ambient-gallery.png. Results: out/ambient-check.json.

import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4196;
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const SHOTS = resolve(ROOT, opt('shots', 'docs/ui'));
const OUT = join(ROOT, 'out');
const WORK = join(OUT, 'ambient-check');
mkdirSync(OUT, { recursive: true });
mkdirSync(SHOTS, { recursive: true });
mkdirSync(WORK, { recursive: true });
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

async function sectionCheck(browser) {
  const f = [];
  const log = {};
  const { page, context, errors } = await open(browser, 'example=1&theme=dark&lang=en&mode=fast&tour=0');
  const order = await page.evaluate(() => [...document.querySelectorAll('section.section[data-section]')].map((s) => s.getAttribute('data-section')));
  log.sections = order;
  const at = (k) => order.indexOf(k);
  ok(at('ambient') > at('environment') && at('ambient') > at('light') && at('ambient') < at('camera'), `the Ambient section is not after Light and Environment and before Camera: ${order.join(', ')}`, f);
  await page.locator(SECTION).scrollIntoViewIfNeeded();
  ok((await page.locator(`${SECTION} [data-ambient="empty"]`).count()) === 1, 'the empty section does not say so', f);
  const before = await viewportPixels(page);

  // The gallery: eight cards and three greyed.
  await page.locator(`${SECTION} [data-ambient="add"]`).click();
  await page.waitForSelector('[data-ambient="gallery"]');
  await settle(page, 150);
  const cards = await page.evaluate(() => [...document.querySelectorAll('[data-ambient="gallery"] [data-preset]')].map((c) => ({ key: c.getAttribute('data-preset'), disabled: c.disabled, text: c.textContent })));
  log.cards = cards.map((c) => `${c.key}${c.disabled ? ' (soon)' : ''}`);
  // S3 adds the Water drops card: nine presets and the three volumes of S5.
  ok(cards.length === 12 && cards.filter((c) => !c.disabled).length === 9, `the gallery has ${cards.length} cards, ${cards.filter((c) => !c.disabled).length} enabled`, f);
  ok(cards.filter((c) => c.disabled).every((c) => /coming soon/i.test(c.text) && ['HAZE', 'LIGHT_SHAFTS', 'GROUND_FOG'].includes(c.key)), 'the S5 cards are not the greyed ones that say coming soon', f);
  await page.locator(SECTION).screenshot({ path: join(SHOTS, 'ambient-gallery.png') });

  // A card adds the effect.
  await page.locator('[data-ambient="gallery"] [data-preset="DUST_MOTES"]').click();
  await page.waitForSelector('[data-ambient="editor"]');
  await settle(page, 200);
  ok((await page.locator('[data-ambient="gallery"]').count()) === 0, 'the gallery stays open after adding', f);
  ok((await effectRows(page)) === 1, 'the list does not show the effect', f);
  const tipAdd = await undoTip(page);
  log.undoAdd = tipAdd;
  ok(/Add Dust motes/.test(tipAdd ?? ''), `the undo does not name the effect: ${tipAdd}`, f);
  const knobs = await page.locator('[data-ambient="knobs"] [data-knob]').count();
  ok(knobs === 9, `the editor shows ${knobs} knobs (eight and the seed)`, f);
  const advanced = await page.locator('section.section[data-section="ambient-advanced"]').getAttribute('data-collapsed');
  ok(advanced !== null, 'Advanced is not folded', f);
  const rowText = await page.locator('[data-ambient="list"] [data-effect]').first().textContent();
  ok(/Dust motes/.test(rowText) && /\d+ particles/.test(rowText), `the list row does not say the effect and its particles: ${rowText}`, f);

  // The preview draws the particles the engine evaluated; the meter says how many.
  log.meterDust = await waitForMeter(page, /^Particles [\d,]+ of [\d,]+$/);
  ok(/^Particles [\d,]+ of [\d,]+$/.test(log.meterDust ?? ''), `the meter does not count the particles: ${log.meterDust}`, f);

  // Preset: one entry.
  await page.locator('[data-ambient="editor"] select[aria-label="Effect"]').selectOption('RAIN');
  await settle(page, 250);
  const tipPreset = await undoTip(page);
  log.undoPreset = tipPreset;
  ok(/Dust motes: effect Rain/.test(tipPreset ?? ''), `the undo does not name the preset change: ${tipPreset}`, f);
  ok((await page.locator('[data-ambient="editor"] select[aria-label="Effect"]').inputValue()) === 'RAIN', 'the preset did not change', f);
  ok(/Rain/.test(await page.locator('[data-ambient="list"] [data-effect]').first().textContent()), 'the list does not show the new preset', f);

  // A knob with the keyboard: one entry.
  const size = page.locator('[data-ambient="knobs"] [data-knob="ambient.size"] [role="spinbutton"]');
  const sizeBefore = await size.getAttribute('aria-valuenow');
  await size.focus();
  // One press: two presses are one entry only within the field's 700 ms, which a loaded machine does not keep.
  await page.keyboard.press('ArrowUp');
  await settle(page, 700);
  const sizeAfter = await size.getAttribute('aria-valuenow');
  const tipKnob = await undoTip(page);
  log.size = [sizeBefore, sizeAfter];
  log.undoKnob = tipKnob;
  ok(Number(sizeAfter) > Number(sizeBefore) && /Rain: Size/.test(tipKnob ?? ''), `the size knob did not change in one entry: ${sizeBefore} → ${sizeAfter}, ${tipKnob}`, f);

  // Undo one at a time, then Redo.
  await page.locator('canvas[aria-label="viewport"]').focus();
  const presetIs = async (key) => (await page.locator('[data-ambient="editor"] select[aria-label="Effect"]').inputValue().catch(() => null)) === key;
  await page.keyboard.press('Control+z');
  ok(await until(async () => (await size.getAttribute('aria-valuenow').catch(() => null)) === sizeBefore && (await presetIs('RAIN'))), 'Undo did not take the knob back', f);
  await page.keyboard.press('Control+z');
  ok(await until(() => presetIs('DUST_MOTES')), 'Undo did not take the preset back', f);
  await page.keyboard.press('Control+z');
  ok(await until(async () => (await effectRows(page)) === 0 && (await page.locator(`${SECTION} [data-ambient="empty"]`).count()) === 1), 'Undo did not take the effect away', f);
  ok(await until(async () => (await meter(page)) === null), `the meter still counts particles without effects: ${await meter(page)}`, f);
  await page.keyboard.press('Control+Shift+z');
  ok(await until(async () => (await effectRows(page)) === 1 && (await presetIs('DUST_MOTES'))), 'Redo did not put the effect again', f);
  await page.keyboard.press('Control+Shift+z');
  ok(await until(() => presetIs('RAIN')), 'Redo did not put the preset again', f);
  await page.keyboard.press('Control+z');
  ok(await until(() => presetIs('DUST_MOTES')), 'Undo after Redo did not take the preset back', f);
  await page.keyboard.press('Control+z');
  ok(await until(async () => (await effectRows(page)) === 0), 'Undo after Redo did not take the effect away', f);

  // The screenshot: snow, the particles in the preview next to the section.
  await addFromGallery(page, 'SNOW');
  log.meterSnow = await waitForMeter(page, /^Particles [\d,]+ of [\d,]+$/);
  await settle(page, 600);
  const after = await viewportPixels(page);
  log.pixelsChanged = changed(before, after);
  ok(log.pixelsChanged > 200, `the preview did not draw the snow: ${log.pixelsChanged} pixels changed`, f);
  await page.locator(SECTION).scrollIntoViewIfNeeded();
  await page.mouse.move(5, 500);
  await settle(page, 300);
  await page.screenshot({ path: join(SHOTS, 'ambient-section.png') });
  ok(errors.length === 0, `errors in the page: ${errors.join(' | ')}`, f);
  await context.close();
  results.section = { ok: f.length === 0, failures: f, ...log };
  console.log(`section: ${f.length === 0 ? 'OK' : `FAILED\n  - ${f.join('\n  - ')}`}`);
}

async function saveCheck(browser) {
  const f = [];
  const log = {};
  const a = await open(browser, 'example=1&theme=dark&lang=en&mode=fast&tour=0');
  await a.page.locator(SECTION).scrollIntoViewIfNeeded();
  await addFromGallery(a.page, 'CONFETTI');
  const seed = await a.page.locator('[data-ambient="knobs"] [data-knob="ambient.seed"] [role="spinbutton"]').getAttribute('aria-valuenow');
  const amount = await a.page.locator('[data-ambient="knobs"] [data-knob="ambient.amount"] [role="spinbutton"]').getAttribute('aria-valuenow');
  const download = a.page.waitForEvent('download', { timeout: 30000 });
  await a.page.locator('canvas[aria-label="viewport"]').focus();
  await a.page.keyboard.press('Control+s');
  const file = join(WORK, (await download).suggestedFilename());
  await (await download).saveAs(file);
  const saved = JSON.parse(readFileSync(file, 'utf8'));
  const fx = saved.effects ?? saved.state?.effects ?? saved.project?.effects;
  log.file = file;
  log.saved = fx?.map((e) => ({ id: e.id, preset: e.preset, seed: e.seed, density: e.density }));
  ok(Array.isArray(fx) && fx.length === 1 && fx[0].preset === 'CONFETTI', `the project file does not hold the effect: ${JSON.stringify(log.saved)}`, f);
  ok(a.errors.length === 0, `errors in the page: ${a.errors.join(' | ')}`, f);
  await a.context.close();

  // A fresh page opens it.
  const b = await open(browser, 'theme=dark&lang=en&mode=fast&tour=0');
  const chooser = b.page.waitForEvent('filechooser', { timeout: 30000 });
  await b.page.locator('canvas[aria-label="viewport"]').focus();
  await b.page.keyboard.press('Control+o');
  // An unsaved project asks first.
  const dont = b.page.getByRole('button', { name: /Don.t save/ });
  if (await dont.isVisible().catch(() => false)) await dont.click();
  await (await chooser).setFiles(file);
  await b.page.waitForSelector(`${SECTION} [data-ambient="list"] [data-effect]`, { timeout: 60000 });
  await settle(b.page, 300);
  await b.page.locator(SECTION).scrollIntoViewIfNeeded();
  const preset = await b.page.locator('[data-ambient="editor"] select[aria-label="Effect"]').inputValue();
  const seed2 = await b.page.locator('[data-ambient="knobs"] [data-knob="ambient.seed"] [role="spinbutton"]').getAttribute('aria-valuenow');
  const amount2 = await b.page.locator('[data-ambient="knobs"] [data-knob="ambient.amount"] [role="spinbutton"]').getAttribute('aria-valuenow');
  log.opened = { preset, seed: seed2, amount: amount2 };
  ok(preset === 'CONFETTI' && seed2 === seed && amount2 === amount, `the opened project does not have the saved effect: ${JSON.stringify(log.opened)} (saved seed ${seed}, amount ${amount})`, f);
  ok(b.errors.length === 0, `errors in the page: ${b.errors.join(' | ')}`, f);
  await b.context.close();
  results.save = { ok: f.length === 0, failures: f, ...log };
  console.log(`save: ${f.length === 0 ? 'OK' : `FAILED\n  - ${f.join('\n  - ')}`}`);
}

async function doctorWarnings(page) {
  await page.locator('.doctor-btn[aria-haspopup="dialog"]').click();
  await page.waitForSelector('.doctor');
  await settle(page, 150);
  const rows = await page.evaluate(() => [...document.querySelectorAll('.doctor .doctor-row.is-warn')].map((r) => r.textContent));
  await page.keyboard.press('Escape');
  await settle(page, 100);
  return rows;
}

async function capCheck(browser) {
  const f = [];
  const log = {};
  // The project lives in the browser between reloads (the autosave), so the cap can be set through the deep link.
  const { page, context, errors } = await open(browser, 'example=1&theme=dark&lang=en&mode=fast&tour=0');
  await page.locator(SECTION).scrollIntoViewIfNeeded();
  await addFromGallery(page, 'DUST_MOTES');
  const asked = Number((await page.locator('[data-ambient="list"] [data-effect]').first().textContent()).match(/([\d,]+) particles/)?.[1].replace(/,/g, ''));
  log.asked = asked;
  const none = await doctorWarnings(page);
  log.warningsAuto = none;
  ok(!none.some((r) => /particles/.test(r)), `the Doctor warns with the automatic cap: ${none.join(' | ')}`, f);
  // Below what it asks: the cap is set in Settings ▸ Render engine on the page, then the Doctor warns.
  const low = Math.max(100, Math.floor(asked / 200) * 100);
  log.cap = low;
  await page.locator('canvas[aria-label="viewport"]').focus();
  await page.keyboard.press('Control+Comma');
  await page.waitForSelector('.sw .sw-section');
  await page.locator('.sw .sw-option[data-section="engine"]').click();
  await page.waitForSelector('.sw [data-row="engine.particleCap"]');
  const field = page.locator('.sw [data-row="engine.particleCap"] [role="spinbutton"]');
  await field.focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Control+a');
  await page.keyboard.type(String(low));
  await page.keyboard.press('Enter');
  await settle(page, 200);
  log.fieldLow = await field.textContent();
  await page.locator('.sw [data-row="engine.particleCap"]').screenshot({ path: join(WORK, 'cap-row.png') });
  for (let i = 0; i < 3 && (await page.locator('.sw').count()) > 0; i++) {
    await page.keyboard.press('Escape');
    await settle(page, 150);
  }
  await settle(page, 300);
  const warned = await doctorWarnings(page);
  log.warningsLow = warned;
  ok(warned.some((r) => /Dust motes asks for [\d,]+ particles; its cap is [\d,]+/.test(r)), `the Doctor does not warn about the cap: ${warned.join(' | ')}`, f);
  const line = await page.locator('[data-ambient="list"] [data-effect]').first().textContent();
  log.lineLow = line;
  ok(new RegExp(`the engine evaluates ${low.toLocaleString('en-US')}`).test(line), `the list does not say what the engine evaluates: ${line}`, f);
  // Automatic again: no warning.
  await page.locator('canvas[aria-label="viewport"]').focus();
  await page.keyboard.press('Control+Comma');
  await page.waitForSelector('.sw [data-row="engine.particleCap"]');
  await field.focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Control+a');
  await page.keyboard.type('0');
  await page.keyboard.press('Enter');
  await settle(page, 200);
  log.fieldAuto = await field.textContent();
  for (let i = 0; i < 3 && (await page.locator('.sw').count()) > 0; i++) {
    await page.keyboard.press('Escape');
    await settle(page, 150);
  }
  const back = await doctorWarnings(page);
  log.warningsBack = back;
  ok(/Automatic/i.test(log.fieldAuto ?? '') && !back.some((r) => /particles/.test(r)), `the automatic cap did not take the warning away: ${log.fieldAuto}, ${back.join(' | ')}`, f);
  ok(errors.length === 0, `errors in the page: ${errors.join(' | ')}`, f);
  await context.close();
  results.cap = { ok: f.length === 0, failures: f, ...log };
  console.log(`cap: ${f.length === 0 ? 'OK' : `FAILED\n  - ${f.join('\n  - ')}`}`);
}

async function boxesCheck(browser) {
  const f = [];
  const log = {};
  const { page, context, errors } = await open(browser, 'example=1&theme=dark&lang=en&mode=fast&tour=0', { blockEngine: true });
  await page.locator(SECTION).scrollIntoViewIfNeeded();
  const before = await viewportPixels(page);
  await addFromGallery(page, 'SNOW');
  log.meter = await waitForMeter(page, /regions only/);
  ok(/regions only/.test(log.meter ?? ''), `the meter does not say the preview draws the regions only: ${log.meter}`, f);
  await settle(page, 400);
  log.pixelsChanged = changed(before, await viewportPixels(page));
  ok(log.pixelsChanged > 50, `the preview did not draw the region box: ${log.pixelsChanged} pixels changed`, f);
  ok(errors.length === 0, `errors in the page: ${errors.join(' | ')}`, f);
  await context.close();
  results.boxes = { ok: f.length === 0, failures: f, ...log };
  console.log(`boxes: ${f.length === 0 ? 'OK' : `FAILED\n  - ${f.join('\n  - ')}`}`);
}

async function chromeCheck(browser) {
  const f = [];
  const log = {};
  for (const theme of ['dark', 'light']) {
    const { page, context, errors } = await open(browser, `example=1&theme=${theme}&lang=es&mode=fast&tour=0`);
    await page.locator(SECTION).scrollIntoViewIfNeeded();
    await addFromGallery(page, 'CONFETTI');
    // The Advanced section open, and the gallery too.
    await page.locator('section.section[data-section="ambient-advanced"] .section-head').click();
    await page.locator(`${SECTION} [data-ambient="add"]`).click();
    await page.waitForSelector('[data-ambient="gallery"]');
    await settle(page, 200);
    const bad = await chromatic(page, SECTION);
    log[theme] = bad;
    ok(bad.length === 0, `${theme}: chromatic colours in the section: ${bad.join(' | ')}`, f);
    const title = await page.locator(`${SECTION} > .section-head`).textContent();
    ok(/Ambiente/.test(title), `${theme}: the section is not called Ambiente in Spanish: ${title}`, f);
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
  const only = opt('only', 'section,save,cap,boxes,chrome').split(',');
  if (only.includes('section')) await sectionCheck(browser);
  if (only.includes('save')) await saveCheck(browser);
  if (only.includes('cap')) await capCheck(browser);
  if (only.includes('boxes')) await boxesCheck(browser);
  if (only.includes('chrome')) await chromeCheck(browser);
  writeFileSync(join(OUT, 'ambient-check.json'), JSON.stringify(results, null, 2));
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
