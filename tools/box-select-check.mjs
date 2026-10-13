#!/usr/bin/env node
// Browser checks of selection by box with the Select tool (UI.md §4.1) in the built app, with the local Chromium and
// swiftshader.
//
//   npm run build && node tools/box-select-check.mjs [--url http://localhost:4186] [--shots docs/ui]
//        [--only parts,schemes,faces,pen,full]
//
// Without --url it serves dist/ with `vite preview` on port 4186 and stops it at the end. Full mode needs
// public/engine/rt.wasm (`npm run engine:build`); without it that check is skipped and says so.
//
//   (parts)   with the default mouse scheme (the left button orbits) Ctrl + drag boxes: a window (left to right) takes
//             the parts entirely inside, crossing (right to left) the parts it touches, drawn solid and dashed; Ctrl +
//             Shift adds and Ctrl + Alt takes out; at Group and Model level the group and the model; a plain click
//             replaces, Shift + click adds, Ctrl + click toggles, Alt + click takes out, an empty click clears; Esc
//             cancels; a Ctrl drag of a few pixels is a click; a plain, a Shift and an Alt drag are still the
//             camera's and draw no box;
//   (schemes) where the left button is free (middle button orbits) a plain drag boxes and does not move the camera;
//             with "Alt + left button orbits" a plain drag boxes and Alt + drag orbits; in both Ctrl + drag replaces,
//             Ctrl + Shift adds and Ctrl + Alt takes out, as in the default scheme;
//   (faces)   a STEP box (six CAD faces): at the Faces level a crossing box takes the faces that show, X-ray the hidden
//             ones too, a window the faces entirely inside, whole faces each time;
//   (pen)     a pen boxes like a mouse (with Ctrl), and orbits without it; a finger does not start a box;
//   (full)    the same in Full mode.
//
// Screenshots: box-window.png, box-crossing.png (mid-drag), box-faces.png; Full mode's go to out/ (they are large).
// Results: out/box-select-check.json.

import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4186;

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const BASE = opt('url', null);
const SHOTS = resolve(ROOT, opt('shots', 'docs/ui'));
const ONLY = opt('only', 'parts,schemes,faces,pen,full').split(',');
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
      if ((await fetch(url)).ok) return;
    } catch {
      // not yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  fail(`${url} did not answer`);
}

let BASE_URL = BASE;

/** Opens the app; `scheme` writes the mouse scheme into the settings before it starts. */
async function open(browser, query, scheme = 'LEFT') {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
  if (scheme !== 'LEFT') {
    await context.addInitScript((value) => {
      try {
        window.localStorage.setItem('repackshot.settings', JSON.stringify({ schema: 1, settings: { 'viewport.mouse': value }, layout: {} }));
      } catch {
        // No storage: the check will say so.
      }
    }, scheme);
  }
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !m.text().startsWith('Failed to load resource') && errors.push(m.text()));
  await page.goto(`${BASE_URL}/?${query}`);
  await page.waitForSelector('#app[data-ready="1"]', { timeout: 60000 });
  return { page, context, errors };
}

const settle = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 60)))));

/** What the page shows: the selected rows of the tree, the breadcrumb, the box, the undo tooltip. */
const state = (page) =>
  page.evaluate(() => {
    const box = document.querySelector('.box-select');
    return {
      selected: [...document.querySelectorAll('.tree-row.is-selected .tree-name')].map((n) => n.textContent),
      crumb: document.querySelector('.crumbs')?.textContent ?? '',
      box: box && box.style.display !== 'none' ? { solid: box.classList.contains('is-window'), dashed: box.classList.contains('is-crossing'), w: box.getBoundingClientRect().width, h: box.getBoundingClientRect().height } : null,
      undo: document.querySelector('.hdr button[aria-label="Undo"]')?.getAttribute('data-tip') ?? null,
      level: document.querySelector('.side-left .seg button[aria-pressed="true"], .side-left .seg .is-on, .side-left .seg [aria-checked="true"]')?.textContent ?? null,
    };
  });

const ok = (cond, text, failures) => {
  if (!cond) failures.push(text);
  return cond;
};
const sorted = (a) => [...a].sort();

/** The canvas box, and a point of it from fractions of its size. */
async function canvasBox(page) {
  return page.locator('canvas[aria-label="viewport"]').boundingBox();
}

/** A drag from a to b with the modifiers held (the keys are pressed before the button and let go after it). */
async function drag(page, a, b, { keys = [], steps = 12, hold = false } = {}) {
  for (const k of keys) await page.keyboard.down(k);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps });
  if (!hold) {
    await page.mouse.up();
    for (const k of keys) await page.keyboard.up(k);
  }
  await settle(page);
}

async function release(page, keys) {
  await page.mouse.up();
  for (const k of keys) await page.keyboard.up(k);
  await settle(page);
}

const clickWith = async (page, p, keys = []) => {
  for (const k of keys) await page.keyboard.down(k);
  await page.mouse.click(p.x, p.y);
  for (const k of keys) await page.keyboard.up(k);
  await settle(page);
};

/** The label of the part under a point (the viewport's hover label). */
async function labelAt(page, p) {
  await page.mouse.move(p.x, p.y, { steps: 3 });
  await settle(page);
  return page.evaluate(() => {
    const l = document.querySelector('.hover-label');
    return l && l.style.display !== 'none' ? l.textContent : null;
  });
}

const STUDIO = 'example=1&theme=dark';

// ------------------------------------------------------------------ the checks

async function partChecks(browser, mode, name) {
  const { page, context, errors } = await open(browser, `${STUDIO}&mode=${mode}`);
  const f = [];
  const log = {};
  if (mode === 'full') await page.waitForFunction(() => document.querySelector('.ov-bl')?.dataset.mode === 'full', null, { timeout: 60000 });
  const cb = await canvasBox(page);
  const at = (fx, fy) => ({ x: cb.x + cb.width * fx, y: cb.y + cb.height * fy });
  // The bottle stands in the middle of the viewport: its box is about 210 x 420 px of a 1000 x 876 canvas.
  const whole = { a: at(0.3, 0.2), b: at(0.7, 0.85) };
  // Near the top of the cap, where nothing but the cap is (lower down the neck of the body is behind it).
  const capPoint = at(0.5, 0.3);
  const labelPoint = at(0.5, 0.6);
  ok((await labelAt(page, capPoint)) === 'Cap', `the point I take for the cap is not the cap`, f);
  ok((await labelAt(page, labelPoint)) === 'Label', `the point I take for the label is not the label`, f);
  await page.mouse.move(cb.x + 40, cb.y + cb.height - 40);

  // Window: Ctrl + drag from the upper left to the lower right of the bottle takes every part.
  await drag(page, whole.a, whole.b, { keys: ['Control'], hold: true });
  let s = await state(page);
  ok(s.box && s.box.solid && !s.box.dashed, `a drag to the right is not drawn solid: ${JSON.stringify(s.box)}`, f);
  await page.screenshot({ path: mode === 'fast' ? join(SHOTS, 'box-window.png') : join(OUT, 'box-window-full.png') });
  await release(page, ['Control']);
  s = await state(page);
  ok(sorted(s.selected).join() === sorted(['Base', 'Body', 'Label', 'Collar', 'Cap']).join(), `window around the bottle: ${s.selected}`, f);
  ok(s.box === null, 'the rectangle stayed after the drop', f);
  ok(s.undo === 'Undo: Load example part', `a box made an undo entry: ${s.undo}`, f);
  log.window = s.selected;

  // Plain click on empty space clears.
  await clickWith(page, at(0.1, 0.5));
  s = await state(page);
  ok(s.selected.length === 0, `a click on empty space left ${s.selected}`, f);

  // Crossing: right to left over a rectangle at the middle of the label takes the label and the body behind it.
  const c = labelPoint;
  await drag(page, { x: c.x + 50, y: c.y + 10 }, { x: c.x - 50, y: c.y - 10 }, { keys: ['Control'], hold: true, steps: 6 });
  s = await state(page);
  ok(s.box && s.box.dashed && !s.box.solid, `a drag to the left is not drawn dashed: ${JSON.stringify(s.box)}`, f);
  await page.screenshot({ path: mode === 'fast' ? join(SHOTS, 'box-crossing.png') : join(OUT, 'box-crossing-full.png') });
  await release(page, ['Control']);
  s = await state(page);
  ok(sorted(s.selected).join() === sorted(['Body', 'Label']).join(), `crossing at the label: ${s.selected}`, f);
  log.crossing = s.selected;

  // A Ctrl box replaced the five parts with two (above). Ctrl + Shift adds (the cap), Ctrl + Alt takes out (the body
  // and the label), Ctrl + a tiny drag is a click that toggles.
  await drag(page, { x: capPoint.x + 8, y: capPoint.y + 8 }, { x: capPoint.x - 8, y: capPoint.y - 8 }, { keys: ['Control', 'Shift'], steps: 5 });
  s = await state(page);
  ok(sorted(s.selected).join() === sorted(['Body', 'Label', 'Cap']).join(), `Ctrl + Shift + box over the cap: ${s.selected}`, f);
  await drag(page, { x: c.x + 40, y: c.y + 40 }, { x: c.x - 40, y: c.y - 40 }, { keys: ['Control', 'Alt'], steps: 6 });
  s = await state(page);
  ok(sorted(s.selected).join() === sorted(['Cap']).join(), `Ctrl + Alt + crossing over the label and the body: ${s.selected}`, f);
  await clickWith(page, at(0.1, 0.5));
  await drag(page, capPoint, { x: capPoint.x + 2, y: capPoint.y + 2 }, { keys: ['Control'], steps: 2 });
  s = await state(page);
  ok(s.selected.join() === 'Cap', `Ctrl + a drag of 2 px is a click on the cap: ${s.selected}`, f);

  // Esc cancels a box and leaves the selection alone.
  await drag(page, whole.a, whole.b, { keys: ['Control'], hold: true });
  s = await state(page);
  ok(s.box !== null, 'no rectangle while dragging', f);
  await page.keyboard.press('Escape');
  await settle(page);
  s = await state(page);
  ok(s.box === null, 'Esc left the rectangle', f);
  await release(page, ['Control']);
  s = await state(page);
  ok(s.selected.join() === 'Cap', `Esc then release changed the selection: ${s.selected}`, f);

  // A plain drag still orbits (the left button's camera); the box did not move it.
  const before = (await state(page)).undo;
  await drag(page, at(0.35, 0.5), at(0.55, 0.5), { steps: 10 });
  s = await state(page);
  ok(before === 'Undo: Load example part' && s.undo === 'Undo: Move the camera', `a plain drag did not orbit: "${before}" then "${s.undo}"`, f);
  ok(s.selected.join() === 'Cap', `an orbit changed the selection: ${s.selected}`, f);
  await page.keyboard.press('Control+z');
  await settle(page);
  // Shift + drag and Alt + drag are the camera's too, as they were: no rectangle, the selection stays, the view moves.
  for (const key of ['Shift', 'Alt']) {
    await drag(page, whole.a, whole.b, { keys: [key], hold: true, steps: 8 });
    s = await state(page);
    ok(s.box === null, `${key} + drag drew a box in the default scheme: ${JSON.stringify(s.box)}`, f);
    await release(page, [key]);
    s = await state(page);
    ok(s.selected.join() === 'Cap', `${key} + drag changed the selection: ${s.selected}`, f);
    ok(s.undo === 'Undo: Move the camera', `${key} + drag was not the camera's: ${s.undo}`, f);
    await page.keyboard.press('Control+z');
    await settle(page);
  }

  // Group level: a window around the bottle takes the groups and the parts that have none; Model level, the model.
  await page.locator('canvas[aria-label="viewport"]').focus();
  await page.keyboard.press('2');
  await settle(page);
  await clickWith(page, at(0.1, 0.5));
  await drag(page, whole.a, whole.b, { keys: ['Control'] });
  s = await state(page);
  ok(sorted(s.selected).join() === sorted(['Base', 'Body', 'Label', 'Closure']).join(), `window at Group: ${s.selected}`, f);
  await clickWith(page, at(0.1, 0.5));
  await drag(page, { x: capPoint.x + 6, y: capPoint.y + 6 }, { x: capPoint.x - 6, y: capPoint.y - 6 }, { keys: ['Control'], steps: 5 });
  s = await state(page);
  ok(s.selected.join() === 'Closure', `crossing the cap at Group: ${s.selected}`, f);
  await clickWith(page, at(0.1, 0.5));
  await page.keyboard.press('1');
  await settle(page);
  await drag(page, whole.a, whole.b, { keys: ['Control'] });
  s = await state(page);
  ok(s.selected.join() === 'Example bottle', `window at Model: ${s.selected}`, f);
  await clickWith(page, at(0.1, 0.5));
  await drag(page, whole.a, at(0.45, 0.4), { keys: ['Control'] });
  s = await state(page);
  ok(s.selected.length === 0, `a window that does not hold the whole model took ${s.selected}`, f);

  // Clicks, back at the Part level: Shift adds, Ctrl takes in and out, Alt takes out.
  await page.keyboard.press('3');
  await settle(page);
  await clickWith(page, capPoint);
  await clickWith(page, labelPoint, ['Shift']);
  s = await state(page);
  ok(sorted(s.selected).join() === sorted(['Cap', 'Label']).join(), `Shift + click adds: ${s.selected}`, f);
  await clickWith(page, labelPoint, ['Control']);
  s = await state(page);
  ok(s.selected.join() === 'Cap', `Ctrl + click on a selected part takes it out: ${s.selected}`, f);
  await clickWith(page, labelPoint, ['Control']);
  s = await state(page);
  ok(sorted(s.selected).join() === sorted(['Cap', 'Label']).join(), `Ctrl + click on a part that is not selected adds it: ${s.selected}`, f);
  await clickWith(page, capPoint, ['Alt']);
  s = await state(page);
  ok(s.selected.join() === 'Label', `Alt + click takes out: ${s.selected}`, f);

  // The Move tool boxes too, where no handle of its gizmo is under the pointer, with the same modifiers; a plain drag
  // there is still the camera's.
  await clickWith(page, at(0.1, 0.5));
  await page.locator('canvas[aria-label="viewport"]').focus();
  await page.keyboard.press('m');
  await settle(page);
  await drag(page, whole.a, whole.b, { keys: ['Control'] });
  s = await state(page);
  ok(sorted(s.selected).join() === sorted(['Base', 'Body', 'Label', 'Collar', 'Cap']).join(), `the Move tool: ${s.selected}`, f);
  ok(s.undo === 'Undo: Load example part', `the Move tool made an undo entry: ${s.undo}`, f);
  await page.keyboard.press('v');
  await settle(page);

  // Faces level, with other parts in front: the base reaches up behind the body and the label, where nobody sees it.
  // A crossing box there takes no face of the base; with X-ray it does.
  await clickWith(page, at(0.1, 0.5));
  await page.locator('.tree-row', { has: page.locator('.tree-name', { hasText: /^Base$/ }) }).click();
  await page.locator('canvas[aria-label="viewport"]').focus();
  await page.keyboard.press('4');
  await settle(page);
  const faceCount = async () => /(\d+) faces? of/.exec((await state(page)).crumb)?.[1] ?? '0';
  const behind = { a: { x: cb.x + cb.width * 0.52, y: cb.y + cb.height * 0.645 }, b: { x: cb.x + cb.width * 0.48, y: cb.y + cb.height * 0.635 } };
  await drag(page, behind.a, behind.b, { keys: ['Control'], steps: 5 });
  log.hiddenBase = await faceCount();
  ok(log.hiddenBase === '0', `a box over what the body hides took ${log.hiddenBase} triangles of the base`, f);
  await page.getByRole('button', { name: 'X-ray' }).click();
  await settle(page);
  await drag(page, behind.a, behind.b, { keys: ['Control'], steps: 5 });
  log.xrayBase = await faceCount();
  ok(Number(log.xrayBase) > 0, `X-ray over what the body hides took ${log.xrayBase} triangles of the base`, f);

  ok(errors.length === 0, `errors in the page: ${errors.join(' | ')}`, f);
  await context.close();
  results[name] = { ok: f.length === 0, failures: f, ...log };
  console.log(`${name}: ${f.length === 0 ? 'OK' : `FAILED\n  - ${f.join('\n  - ')}`}`);
}

async function schemeChecks(browser) {
  const f = [];
  const log = {};
  for (const scheme of ['MIDDLE', 'ALT_LEFT']) {
    const { page, context, errors } = await open(browser, `${STUDIO}&mode=fast`, scheme);
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('repackshot.settings') ?? 'null')?.settings?.['viewport.mouse']);
    ok(stored === scheme, `${scheme}: the scheme was not stored (${stored})`, f);
    const cb = await canvasBox(page);
    const at = (fx, fy) => ({ x: cb.x + cb.width * fx, y: cb.y + cb.height * fy });
    const whole = { a: at(0.3, 0.2), b: at(0.7, 0.85) };
    // A plain drag is a box here and leaves the camera alone.
    await drag(page, whole.a, whole.b);
    let s = await state(page);
    ok(sorted(s.selected).join() === sorted(['Base', 'Body', 'Label', 'Collar', 'Cap']).join(), `${scheme}: plain window: ${s.selected}`, f);
    ok(s.undo === 'Undo: Load example part', `${scheme}: a box moved the camera: ${s.undo}`, f);
    const c = at(0.5, 0.6);
    const capPoint = at(0.5, 0.3);
    await drag(page, { x: c.x - 12, y: c.y - 12 }, { x: c.x + 12, y: c.y + 12 }, { steps: 5 });
    s = await state(page);
    ok(s.selected.length === 0, `${scheme}: a small plain window that holds no part took ${s.selected}`, f);
    await drag(page, whole.a, whole.b);
    // The same keys as in the default scheme: Ctrl + drag replaces (the five parts become two), Ctrl + Shift adds the
    // cap, Ctrl + Alt takes out the label and the body.
    await drag(page, { x: c.x + 50, y: c.y + 10 }, { x: c.x - 50, y: c.y - 10 }, { keys: ['Control'], steps: 6 });
    s = await state(page);
    ok(sorted(s.selected).join() === sorted(['Body', 'Label']).join(), `${scheme}: Ctrl + crossing replaces: ${s.selected}`, f);
    await drag(page, { x: capPoint.x + 8, y: capPoint.y + 8 }, { x: capPoint.x - 8, y: capPoint.y - 8 }, { keys: ['Control', 'Shift'], steps: 5 });
    s = await state(page);
    ok(sorted(s.selected).join() === sorted(['Body', 'Label', 'Cap']).join(), `${scheme}: Ctrl + Shift adds: ${s.selected}`, f);
    await drag(page, { x: c.x + 40, y: c.y + 40 }, { x: c.x - 40, y: c.y - 40 }, { keys: ['Control', 'Alt'], steps: 6 });
    s = await state(page);
    ok(s.selected.join() === 'Cap', `${scheme}: Ctrl + Alt takes out: ${s.selected}`, f);
    // Without Ctrl, where the left button is free: Shift adds (here the label and the body); Alt takes out (only
    // where Alt does not orbit).
    await drag(page, { x: c.x + 50, y: c.y + 10 }, { x: c.x - 50, y: c.y - 10 }, { keys: ['Shift'], steps: 6 });
    s = await state(page);
    ok(sorted(s.selected).join() === sorted(['Body', 'Label', 'Cap']).join(), `${scheme}: Shift adds: ${s.selected}`, f);
    if (scheme === 'MIDDLE') {
      await drag(page, { x: c.x + 40, y: c.y + 40 }, { x: c.x - 40, y: c.y - 40 }, { keys: ['Alt'], steps: 6 });
      s = await state(page);
      ok(s.selected.join() === 'Cap', `${scheme}: Alt takes out: ${s.selected}`, f);
    }
    s = await state(page);
    ok(s.undo === 'Undo: Load example part', `${scheme}: a box moved the camera: ${s.undo}`, f);
    if (scheme === 'ALT_LEFT') {
      // Alt + drag orbits.
      await page.keyboard.down('Alt');
      await page.mouse.move(at(0.35, 0.5).x, at(0.35, 0.5).y);
      await page.mouse.down();
      await page.mouse.move(at(0.55, 0.5).x, at(0.55, 0.5).y, { steps: 10 });
      await page.mouse.up();
      await page.keyboard.up('Alt');
      await settle(page);
      s = await state(page);
      ok(s.undo === 'Undo: Move the camera', `ALT_LEFT: Alt + drag did not orbit: ${s.undo}`, f);
    } else {
      // The middle button orbits.
      const m = at(0.35, 0.5);
      await page.mouse.move(m.x, m.y);
      await page.mouse.down({ button: 'middle' });
      await page.mouse.move(at(0.55, 0.5).x, at(0.55, 0.5).y, { steps: 10 });
      await page.mouse.up({ button: 'middle' });
      await settle(page);
      s = await state(page);
      ok(s.undo === 'Undo: Move the camera', `MIDDLE: the middle button did not orbit: ${s.undo}`, f);
    }
    ok(errors.length === 0, `${scheme}: errors in the page: ${errors.join(' | ')}`, f);
    await context.close();
  }
  results.schemes = { ok: f.length === 0, failures: f, ...log };
  console.log(`schemes: ${f.length === 0 ? 'OK' : `FAILED\n  - ${f.join('\n  - ')}`}`);
}

/** Imports tests/fixtures/box.step (six CAD faces) from the empty state and returns when it is in the scene. */
async function importBox(page) {
  const chooser = page.waitForEvent('filechooser', { timeout: 30000 });
  await page.getByRole('button', { name: /Import model/ }).first().click();
  await (await chooser).setFiles(join(ROOT, 'tests', 'fixtures', 'box.step'));
  // The sheet opens at once and fills when the reader has read the file; Import brings it in.
  await page.waitForSelector('.import-sheet, [data-import-sheet]', { timeout: 60000 }).catch(() => {});
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => /^Import$/.test(b.textContent.trim()) && !b.disabled), null, { timeout: 120000 });
  await page.getByRole('button', { name: /^Import$/ }).click();
  await page.waitForFunction(() => document.querySelectorAll('.tree-row').length > 0, null, { timeout: 60000 });
  await settle(page);
}

async function faceChecks(browser, mode, name) {
  const { page, context, errors } = await open(browser, `theme=dark&mode=${mode}`);
  const f = [];
  const log = {};
  await importBox(page);
  if (mode === 'full') await page.waitForFunction(() => document.querySelector('.ov-bl')?.dataset.mode === 'full', null, { timeout: 60000 });
  const cb = await canvasBox(page);
  const at = (fx, fy) => ({ x: cb.x + cb.width * fx, y: cb.y + cb.height * fy });
  // Select the part (the box is a single part: the last row of the tree), then the Faces level.
  const toFaces = async () => {
    await page.locator('.tree-row').last().click();
    await settle(page);
    await page.locator('canvas[aria-label="viewport"]').focus();
    await page.keyboard.press('4');
    await settle(page);
  };
  await toFaces();
  const faces = async () => {
    const t = (await state(page)).crumb;
    const m = /(\d+) faces? of/.exec(t);
    return m ? Number(m[1]) : 0;
  };
  // (Away from the overlays at the corners: a press on one of them is not on the canvas.)
  const wide = { a: at(0.15, 0.12), b: at(0.85, 0.82) };
  // Crossing over everything (right to left): the faces that show; seen from above a cube shows three of its six.
  await drag(page, wide.b, wide.a, { keys: ['Control'], steps: 8 });
  const seen = await faces();
  log.crossingSeen = seen;
  ok(seen > 0 && seen < 12, `crossing took ${seen} triangles of a cube with 12: only the faces that show`, f);
  ok(seen % 2 === 0, `crossing took ${seen} triangles: a face is two, whole`, f);
  await page.screenshot({ path: mode === 'fast' ? join(SHOTS, 'box-faces.png') : join(OUT, 'box-faces-full.png') });
  // X-ray: the hidden faces too: all six, whole (12 triangles).
  await toFaces();
  await page.getByRole('button', { name: 'X-ray' }).click();
  await settle(page);
  await drag(page, wide.b, wide.a, { keys: ['Control'], steps: 8 });
  const all = await faces();
  log.crossingXray = all;
  ok(all === 12, `X-ray crossing took ${all} triangles, not all 12`, f);
  // Ctrl + Alt takes faces out: the same box, with X-ray, takes them all out again.
  await drag(page, wide.b, wide.a, { keys: ['Control', 'Alt'], steps: 8 });
  log.afterAlt = await faces();
  ok(log.afterAlt === 0, `Ctrl + Alt over everything left ${log.afterAlt} triangles`, f);
  // Window (X-ray off): it needs the whole face inside; a small window holds none, one around the cube the faces that show.
  await page.getByRole('button', { name: 'X-ray' }).click();
  await settle(page);
  await drag(page, at(0.45, 0.45), at(0.55, 0.55), { keys: ['Control'], steps: 5 });
  ok((await faces()) === 0, `a window that holds no face took ${await faces()}`, f);
  await drag(page, wide.a, wide.b, { keys: ['Control'], steps: 8 });
  const win = await faces();
  log.windowSeen = win;
  ok(win > 0 && win < 12, `a window around the cube took ${win} triangles: only the faces that show`, f);
  ok(errors.length === 0, `errors in the page: ${errors.join(' | ')}`, f);
  await context.close();
  results[name] = { ok: f.length === 0, failures: f, ...log };
  console.log(`${name}: ${f.length === 0 ? 'OK' : `FAILED\n  - ${f.join('\n  - ')}`}`);
}

/** A pen boxes like a mouse (synthetic pointer events); a finger does not start a box. */
async function penAndTouch(browser) {
  const { page, context, errors } = await open(browser, `${STUDIO}&mode=fast`);
  const f = [];
  const cb = await canvasBox(page);
  const at = (fx, fy) => ({ x: cb.x + cb.width * fx, y: cb.y + cb.height * fy });
  const run = (pointerType, a, b, ctrlKey = true) =>
    page.evaluate(
      async ({ pointerType, a, b, ctrlKey }) => {
        const canvas = document.querySelector('canvas[aria-label="viewport"]');
        const ev = (type, p, extra = {}) => new PointerEvent(type, { pointerId: 9, pointerType, isPrimary: true, clientX: p.x, clientY: p.y, button: 0, buttons: type === 'pointerup' ? 0 : 1, ctrlKey, bubbles: true, cancelable: true, ...extra });
        const wait = () => new Promise((r) => setTimeout(() => requestAnimationFrame(() => requestAnimationFrame(r)), 80));
        canvas.dispatchEvent(ev('pointerdown', a));
        for (let i = 1; i <= 8; i++) {
          window.dispatchEvent(ev('pointermove', { x: a.x + ((b.x - a.x) * i) / 8, y: a.y + ((b.y - a.y) * i) / 8 }));
          await wait();
        }
        const mid = !!document.querySelector('.box-select') && document.querySelector('.box-select').style.display !== 'none';
        window.dispatchEvent(ev('pointerup', b));
        await wait();
        return mid;
      },
      { pointerType, a, b, ctrlKey },
    );
  const pen = await run('pen', at(0.3, 0.2), at(0.7, 0.85));
  let s = await state(page);
  ok(pen && sorted(s.selected).join() === sorted(['Base', 'Body', 'Label', 'Collar', 'Cap']).join(), `pen: box=${pen}, selected ${s.selected}`, f);
  await clickWith(page, at(0.1, 0.5));
  // Without Ctrl the pen orbits, like the mouse: no box.
  const penPlain = await run('pen', at(0.3, 0.2), at(0.7, 0.85), false);
  s = await state(page);
  ok(!penPlain && s.selected.length === 0, `pen without Ctrl: box=${penPlain}, selected ${s.selected}`, f);
  const touch = await run('touch', at(0.3, 0.2), at(0.7, 0.85));
  s = await state(page);
  ok(!touch && s.selected.length === 0, `touch: box=${touch}, selected ${s.selected}`, f);
  // (A synthetic finger has no real pointer for the camera controls to capture: their complaint is not ours.)
  const own = errors.filter((e) => !/setPointerCapture/.test(e));
  ok(own.length === 0, `errors in the page: ${own.join(' | ')}`, f);
  await context.close();
  results.pen = { ok: f.length === 0, failures: f };
  console.log(`pen and touch: ${f.length === 0 ? 'OK' : `FAILED\n  - ${f.join('\n  - ')}`}`);
}

// ------------------------------------------------------------------ main

let server = null;
let browser = null;
try {
  if (!existsSync(join(ROOT, 'dist', 'index.html'))) fail('dist/ is missing: npm run build first');
  if (!BASE_URL) {
    stopServer();
    server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: 'ignore', detached: true });
    BASE_URL = `http://localhost:${PORT}`;
  }
  await waitFor(BASE_URL);
  const { chromium } = await import('playwright-core');
  browser = await chromium.launch({ executablePath: findChromium(), headless: true, args: ['--no-sandbox', '--disable-gpu', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  if (ONLY.includes('parts')) await partChecks(browser, 'fast', 'parts');
  if (ONLY.includes('schemes')) await schemeChecks(browser);
  if (ONLY.includes('faces')) await faceChecks(browser, 'fast', 'faces');
  if (ONLY.includes('pen')) await penAndTouch(browser);
  if (ONLY.includes('full')) {
    if (existsSync(join(ROOT, 'dist', 'engine', 'rt.wasm'))) {
      await partChecks(browser, 'full', 'full parts');
      await faceChecks(browser, 'full', 'full faces');
    } else {
      results.full = { ok: true, skipped: 'dist/engine/rt.wasm is missing (npm run engine:build)' };
      console.log('full: skipped, no rt.wasm');
    }
  }
  writeFileSync(join(OUT, 'box-select-check.json'), JSON.stringify(results, null, 2));
  const all = Object.values(results).every((r) => r.ok);
  console.log(all ? 'all checks passed' : 'SOME CHECKS FAILED');
  process.exitCode = all ? 0 : 1;
} catch (err) {
  console.error(err?.stack ?? err);
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
  if (server) stopServer();
}
