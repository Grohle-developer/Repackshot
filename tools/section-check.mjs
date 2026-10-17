#!/usr/bin/env node
// Browser checks of phase Q1 (the section view in the Scene inspector) in the built app, with the local Chromium and
// swiftshader.
//
//   npm run engine:build && npm run build && node tools/section-check.mjs [--url http://localhost:4197] [--shots docs/ui]
//
// Without --url it serves dist/ with `vite preview` on port 4197 and stops it at the end (by the pids `lsof` reports).
//
//   flows     on the example bottle, the Scene inspector has the Section section after Ambient and before Camera,
//             folded, empty (a sentence says how to make a plane); the header switch makes the default plane (one undo
//             entry) and the viewport changes; Flip side changes the normal (one entry); Cap the cut off and on (one
//             entry each); a numeric point field (one entry); "Click on the model" arms the next click with the axis
//             chosen (a banner says so; Esc puts it down), the click makes the plane (one entry) with the normal on
//             that axis; "Two points" asks for two clicks and makes a plane that holds the view direction (one entry);
//             Undo takes every step back one at a time, Redo puts them again, Remove takes the plane away.
//   save      Save project writes the plane into the project file and Open project in a fresh page reads it back.
//   full      the Full engine draws the cut too (the pixels change when the plane goes on), with rt.wasm.
//   chrome    the Section section, its banner and its fields are achromatic (every computed colour has r = g = b), in
//             both themes, and the section is called Sección in Spanish.
//
// Screenshots (docs/ui): section-fast.png, section-full.png (the example bottle cut in half, the Section section open
// in the inspector). Results: out/section-check.json.

import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
const WORK = join(OUT, 'section-check');
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
const SECTION = 'section.section[data-section="section"]';
const canvas = (page) => page.locator('canvas[aria-label="viewport"]');
const undoTip = (page) => page.locator('.hdr button[aria-label="Undo"]').getAttribute('data-tip');
const switchOn = (page) => page.locator(`${SECTION} [data-section-switch]`).getAttribute('aria-checked');
const hasPlane = (page) => page.locator(`${SECTION} [data-section="plane"]`).count().then((n) => n === 1);

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

/** The numbers of a vector row of the plane editor ('point' or 'normal'), from the fields' aria-valuenow. */
const vec = (page, what) =>
  page.evaluate((what) => [...document.querySelectorAll(`section.section[data-section="section"] [data-section-field="${what}"] [role="spinbutton"]`)].map((e) => Number(e.getAttribute('aria-valuenow'))), what);
const len = (v) => Math.hypot(...v);
const near = (a, b, eps = 1e-3) => a.length === b.length && a.every((x, i) => Math.abs(x - b[i]) <= eps);

/** Opens the Section section if it is folded and brings it into view. */
async function openSection(page) {
  const sec = page.locator(SECTION);
  await sec.scrollIntoViewIfNeeded();
  if ((await sec.getAttribute('data-collapsed')) !== null) await sec.locator('.section-head').click();
  await settle(page, 100);
}

/** Types a number into a field of the plane editor (double click, type, Enter). */
async function typeInto(page, locator, value) {
  await locator.dblclick();
  await settle(page, 60);
  await page.keyboard.press('Control+a');
  await page.keyboard.type(String(value));
  await page.keyboard.press('Enter');
  await settle(page, 150);
}

/** Turns the plane to about 36 degrees from the view, so that the cap is seen as a tilted ellipse (the screenshots). */
async function tiltPlane(page) {
  const fields = page.locator(`${SECTION} [data-section-field="normal"] [role="spinbutton"]`);
  await typeInto(page, fields.nth(0), -0.97);
  await typeInto(page, fields.nth(1), -0.26);
  await page.keyboard.press('Escape');
  await settle(page, 300);
}

/** A point of the bottle's body under the viewport: fractions of the canvas box. */
async function at(page, fx, fy) {
  const b = await canvas(page).boundingBox();
  return { x: b.x + b.width * fx, y: b.y + b.height * fy };
}

async function flowsCheck(browser) {
  const f = [];
  const log = {};
  const { page, context, errors } = await open(browser, 'example=1&theme=dark&lang=en&mode=fast&tour=0');
  const order = await page.evaluate(() => [...document.querySelectorAll('section.section[data-section]')].map((s) => s.getAttribute('data-section')));
  log.sections = order;
  const idx = (k) => order.indexOf(k);
  ok(idx('section') > idx('ambient') && idx('section') > idx('environment') && idx('section') < idx('camera'), `the Section section is not after Ambient and before Camera: ${order.join(', ')}`, f);
  ok((await page.locator(SECTION).getAttribute('data-collapsed')) !== null, 'the Section section is not folded by default', f);
  await openSection(page);
  ok((await page.locator(`${SECTION} [data-section="empty"]`).count()) === 1, 'the section without a plane does not say how to make one', f);
  ok((await hasPlane(page)) === false, 'the plane editor shows before there is a plane', f);
  const before = await viewportPixels(page);

  // The switch: the default plane, one undo entry.
  await page.locator(`${SECTION} [data-section-switch]`).click();
  await settle(page, 400);
  ok(await until(() => hasPlane(page)), 'the switch did not make the plane', f);
  ok((await switchOn(page)) === 'true', 'the switch does not show on', f);
  const tipOn = await undoTip(page);
  log.undoOn = tipOn;
  ok(/Section on/.test(tipOn ?? ''), `the undo does not name the switch: ${tipOn}`, f);
  const n0 = await vec(page, 'normal');
  const p0 = await vec(page, 'point');
  log.defaultPlane = { point: p0, normal: n0 };
  ok(Math.abs(len(n0) - 1) < 1e-2, `the default normal is not a unit vector: ${n0}`, f);
  ok(Math.abs(n0[2]) < 1e-2, `the default plane is not vertical (its normal has a Z component): ${n0}`, f);
  await settle(page, 500);
  const afterOn = await viewportPixels(page);
  log.pixelsOn = changed(before, afterOn);
  ok(log.pixelsOn > 2000, `the preview did not change with the section on: ${log.pixelsOn} pixels`, f);

  // Flip side.
  await page.locator(`${SECTION} [data-section-action="flip"]`).click();
  await settle(page, 400);
  const n1 = await vec(page, 'normal');
  ok(near(n1, n0.map((x) => -x), 2e-3), `Flip side did not negate the normal: ${n0} → ${n1}`, f);
  ok(/Flip the section/.test((await undoTip(page)) ?? ''), `the undo does not name the flip: ${await undoTip(page)}`, f);
  const flipped = await viewportPixels(page);
  log.pixelsFlip = changed(afterOn, flipped);
  ok(log.pixelsFlip > 2000, `the preview did not change with the flip: ${log.pixelsFlip} pixels`, f);

  // Cap the cut, off and on.
  const cap = page.locator(`${SECTION} [data-section-field="cap"] [role="switch"]`);
  const capState = async () => cap.getAttribute('aria-checked');
  ok((await capState()) === 'true', `the cap is not on by default: ${await capState()}`, f);
  await cap.click();
  await settle(page, 300);
  ok((await capState()) === 'false', 'the cap switch did not go off', f);
  ok(/do not cap/.test((await undoTip(page)) ?? ''), `the undo does not name the uncap: ${await undoTip(page)}`, f);
  const uncapped = await viewportPixels(page);
  log.pixelsUncap = changed(flipped, uncapped);
  ok(log.pixelsUncap > 200, `the preview did not change with the cap off: ${log.pixelsUncap} pixels`, f);
  await cap.click();
  await settle(page, 300);
  ok((await capState()) === 'true' && /cap the cut/.test((await undoTip(page)) ?? ''), `the cap did not go on again: ${await capState()}, ${await undoTip(page)}`, f);

  // A numeric point field: one entry.
  const px = page.locator(`${SECTION} [data-section-field="point"] [role="spinbutton"]`).first();
  const x0 = Number(await px.getAttribute('aria-valuenow'));
  await px.focus();
  await page.keyboard.press('ArrowUp');
  await settle(page, 800);
  const x1 = Number(await px.getAttribute('aria-valuenow'));
  log.pointX = [x0, x1];
  ok(x1 > x0, `the point field did not move: ${x0} → ${x1}`, f);
  ok(/Section: point/.test((await undoTip(page)) ?? ''), `the undo does not name the point: ${await undoTip(page)}`, f);

  // A click on the model with an axis: the banner, Esc, then the click.
  await page.locator(`${SECTION} [data-section-action="click"]`).click();
  const banner = page.locator('.ov-pick:not(.ov-look):not(.ov-label-tool)');
  await settle(page, 200);
  ok(await banner.isVisible(), 'the pick banner does not show', f);
  ok(/click on the model to cut across Z/i.test((await banner.textContent()) ?? ''), `the banner does not name the axis Z: ${await banner.textContent()}`, f);
  await page.keyboard.press('Escape');
  await settle(page, 150);
  ok(!(await banner.isVisible()), 'Esc did not put the pick down', f);
  await page.locator(`${SECTION} .seg button[aria-label="X"]`).click();
  await page.locator(`${SECTION} [data-section-action="click"]`).click();
  await settle(page, 200);
  const bannerX = (await banner.textContent()) ?? '';
  ok(/across X/i.test(bannerX), `the banner does not follow the axis chosen (X): ${bannerX}`, f);
  const tipBefore = await undoTip(page);
  const body = await at(page, 0.5, 0.55);
  await page.mouse.click(body.x, body.y);
  await settle(page, 500);
  ok(!(await banner.isVisible()), 'the banner stays after the click', f);
  const nx = await vec(page, 'normal');
  log.clickX = { normal: nx, point: await vec(page, 'point') };
  ok(Math.abs(Math.abs(nx[0]) - 1) < 1e-2 && Math.abs(nx[1]) < 1e-2 && Math.abs(nx[2]) < 1e-2, `the click across X did not make a plane normal to X: ${nx}`, f);
  const tipSet = await undoTip(page);
  ok(/Set the section plane/.test(tipSet ?? '') && tipSet !== tipBefore, `the undo does not name the click: ${tipSet}`, f);

  // Two points: the plane holds the view direction.
  await page.locator(`${SECTION} [data-section-action="line"]`).click();
  await settle(page, 200);
  ok(/first point/i.test((await banner.textContent()) ?? ''), `the banner does not ask for the first point: ${await banner.textContent()}`, f);
  const a = await at(page, 0.5, 0.35);
  await page.mouse.click(a.x, a.y);
  await settle(page, 300);
  ok(/second point/i.test((await banner.textContent()) ?? ''), `the banner does not ask for the second point: ${await banner.textContent()}`, f);
  const tipFirst = await undoTip(page);
  ok(tipFirst === tipSet, `the first point alone changed the project: ${tipFirst}`, f);
  const b2 = await at(page, 0.5, 0.65);
  await page.mouse.click(b2.x, b2.y);
  await settle(page, 500);
  ok(!(await banner.isVisible()), 'the banner stays after the second point', f);
  const nl = await vec(page, 'normal');
  log.twoPoints = { normal: nl, point: await vec(page, 'point') };
  ok(Math.abs(len(nl) - 1) < 1e-2, `the two-point normal is not a unit vector: ${nl}`, f);
  ok(!near(nl, nx, 5e-2) && !near(nl, nx.map((x) => -x), 5e-2), `the two points left the plane as it was: ${nl}`, f);
  ok(/Set the section plane/.test((await undoTip(page)) ?? ''), `the undo does not name the two points: ${await undoTip(page)}`, f);

  // Undo one at a time, then Redo.
  await canvas(page).focus();
  await page.keyboard.press('Control+z');
  ok(await until(async () => near(await vec(page, 'normal'), nx, 5e-3)), 'Undo did not take the two points back', f);
  await page.keyboard.press('Control+z');
  ok(await until(async () => (await vec(page, 'normal')).length === 3 && !near(await vec(page, 'normal'), nx, 5e-3)), 'Undo did not take the click back', f);
  await page.keyboard.press('Control+Shift+z');
  ok(await until(async () => near(await vec(page, 'normal'), nx, 5e-3)), 'Redo did not put the click again', f);
  await page.keyboard.press('Control+Shift+z');
  ok(await until(async () => near(await vec(page, 'normal'), nl, 5e-3)), 'Redo did not put the two points again', f);

  // Remove takes the plane away; Undo gives it back.
  await page.locator(`${SECTION} [data-section-action="remove"]`).click();
  ok(await until(async () => (await page.locator(`${SECTION} [data-section="empty"]`).count()) === 1), 'Remove did not take the plane away', f);
  ok(/Remove the section plane/.test((await undoTip(page)) ?? ''), `the undo does not name the removal: ${await undoTip(page)}`, f);
  await canvas(page).focus();
  await page.keyboard.press('Control+z');
  ok(await until(() => hasPlane(page)), 'Undo did not give the plane back', f);

  ok(errors.length === 0, `errors in the page: ${errors.join(' | ')}`, f);
  await context.close();
  results.flows = { ok: f.length === 0, failures: f, ...log };
  console.log(`flows: ${f.length === 0 ? 'OK' : `FAILED\n  - ${f.join('\n  - ')}`}`);
}

async function saveCheck(browser) {
  const f = [];
  const log = {};
  const a = await open(browser, 'example=1&theme=dark&lang=en&mode=fast&tour=0');
  await openSection(a.page);
  await a.page.locator(`${SECTION} [data-section-switch]`).click();
  await a.page.waitForSelector(`${SECTION} [data-section="plane"]`);
  await a.page.locator(`${SECTION} [data-section-action="flip"]`).click();
  await settle(a.page, 300);
  const normal = await vec(a.page, 'normal');
  const point = await vec(a.page, 'point');
  const download = a.page.waitForEvent('download', { timeout: 30000 });
  await canvas(a.page).focus();
  await a.page.keyboard.press('Control+s');
  const file = join(WORK, (await download).suggestedFilename());
  await (await download).saveAs(file);
  const saved = JSON.parse(readFileSync(file, 'utf8'));
  const sec = saved.section ?? saved.state?.section ?? saved.project?.section;
  log.saved = sec;
  ok(!!sec && sec.enabled === true && Array.isArray(sec.point) && Array.isArray(sec.normal), `the project file does not hold the plane: ${JSON.stringify(sec)}`, f);
  ok(a.errors.length === 0, `errors in the page: ${a.errors.join(' | ')}`, f);
  await a.context.close();

  // A fresh page opens it.
  const b = await open(browser, 'theme=dark&lang=en&mode=fast&tour=0');
  const chooser = b.page.waitForEvent('filechooser', { timeout: 30000 });
  await canvas(b.page).focus();
  await b.page.keyboard.press('Control+o');
  const dont = b.page.getByRole('button', { name: /Don.t save/ });
  if (await dont.isVisible().catch(() => false)) await dont.click();
  await (await chooser).setFiles(file);
  await b.page.waitForSelector(`${SECTION} [data-section="plane"]`, { timeout: 60000, state: 'attached' });
  await openSection(b.page);
  const n2 = await vec(b.page, 'normal');
  const p2 = await vec(b.page, 'point');
  log.opened = { normal: n2, point: p2 };
  ok(near(n2, normal, 2e-3) && near(p2, point, 5e-2), `the opened project does not have the saved plane: ${n2} ${p2} (saved ${normal} ${point})`, f);
  ok((await switchOn(b.page)) === 'true', 'the opened project has the section off', f);
  ok(b.errors.length === 0, `errors in the page: ${b.errors.join(' | ')}`, f);
  await b.context.close();
  results.save = { ok: f.length === 0, failures: f, ...log };
  console.log(`save: ${f.length === 0 ? 'OK' : `FAILED\n  - ${f.join('\n  - ')}`}`);
}

/** Waits for the Full engine to have `n` samples of what is asked now. */
async function waitSamples(page, n, ms = 300000) {
  await page.waitForFunction(
    (want) => {
      const m = document.querySelector('.ov-bl');
      return m && m.dataset.mode === 'full' && Number(m.dataset.samples) >= want && m.dataset.shownKey === m.dataset.wantKey;
    },
    n,
    { timeout: ms, polling: 500 },
  );
}

async function fullCheck(browser) {
  const f = [];
  const log = {};
  if (!existsSync(join(ROOT, 'dist', 'engine', 'rt.wasm'))) {
    results.full = { ok: true, skipped: 'dist/engine/rt.wasm is missing (npm run engine:build, then npm run build)' };
    console.log('full: skipped (no rt.wasm)');
    return;
  }
  const { page, context, errors } = await open(browser, 'example=1&theme=dark&lang=en&mode=full&tour=0');
  await page.waitForFunction(() => document.querySelector('.ov-bl')?.dataset.mode === 'full', null, { timeout: 90000 });
  await waitSamples(page, 16);
  const before = await viewportPixels(page);
  await openSection(page);
  await page.locator(`${SECTION} [data-section-switch]`).click();
  await page.waitForSelector(`${SECTION} [data-section="plane"]`);
  await tiltPlane(page);
  await page.mouse.move(5, 500);
  await waitSamples(page, 64);
  const after = await viewportPixels(page);
  log.pixelsChanged = changed(before, after);
  ok(log.pixelsChanged > 2000, `the Full engine did not draw the cut: ${log.pixelsChanged} pixels changed`, f);
  await page.screenshot({ path: join(SHOTS, 'section-full.png') });
  ok(errors.length === 0, `errors in the page: ${errors.join(' | ')}`, f);
  await context.close();
  results.full = { ok: f.length === 0, failures: f, ...log };
  console.log(`full: ${f.length === 0 ? 'OK' : `FAILED\n  - ${f.join('\n  - ')}`}`);
}

async function shotCheck(browser) {
  const f = [];
  const { page, context, errors } = await open(browser, 'example=1&theme=dark&lang=en&mode=fast&tour=0');
  await openSection(page);
  await page.locator(`${SECTION} [data-section-switch]`).click();
  await page.waitForSelector(`${SECTION} [data-section="plane"]`);
  await tiltPlane(page);
  await page.mouse.move(5, 500);
  await settle(page, 1200);
  await page.screenshot({ path: join(SHOTS, 'section-fast.png') });
  ok(errors.length === 0, `errors in the page: ${errors.join(' | ')}`, f);
  await context.close();
  results.shot = { ok: f.length === 0, failures: f };
  console.log(`shot: ${f.length === 0 ? 'OK' : `FAILED\n  - ${f.join('\n  - ')}`}`);
}

async function chromeCheck(browser) {
  const f = [];
  const log = {};
  for (const theme of ['dark', 'light']) {
    const { page, context, errors } = await open(browser, `example=1&theme=${theme}&lang=es&mode=fast&tour=0`);
    await openSection(page);
    await page.locator(`${SECTION} [data-section-switch]`).click();
    await page.waitForSelector(`${SECTION} [data-section="plane"]`);
    // The banner is up while the check looks.
    await page.locator(`${SECTION} [data-section-action="line"]`).click();
    await settle(page, 200);
    const bad = await chromatic(page, `${SECTION}, .ov-pick:not(.ov-look):not(.ov-label-tool)`);
    log[theme] = bad;
    ok(bad.length === 0, `${theme}: chromatic colours in the section: ${bad.join(' | ')}`, f);
    const title = await page.locator(`${SECTION} > .section-head`).textContent();
    ok(/Sección/.test(title), `${theme}: the section is not called Sección in Spanish: ${title}`, f);
    const banner = (await page.locator('.ov-pick:not(.ov-look):not(.ov-label-tool)').textContent()) ?? '';
    ok(/primer punto/.test(banner), `${theme}: the banner is not in Spanish: ${banner}`, f);
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
  const only = opt('only', 'flows,save,shot,full,chrome').split(',');
  if (only.includes('flows')) await flowsCheck(browser);
  if (only.includes('save')) await saveCheck(browser);
  if (only.includes('shot')) await shotCheck(browser);
  if (only.includes('full')) await fullCheck(browser);
  if (only.includes('chrome')) await chromeCheck(browser);
  writeFileSync(join(OUT, 'section-check.json'), JSON.stringify(results, null, 2));
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
