#!/usr/bin/env node
// Browser checks of phase U7 (dragging a material onto a part) and M1 (whole CAD faces), with the local Chromium
// and swiftshader, in the built app.
//
//   npm run build && node tools/material-drag-check.mjs [--url http://localhost:4186] [--shots docs/ui]
//        [--only fast,mine,pen,full]
//
// Without --url it serves dist/ with `vite preview` on port 4186 and stops it at the end (by the pids
// `lsof -t -i :4186` reports). Full mode needs public/engine/rt.wasm (`npm run engine:build`); without it the
// Full checks are skipped and say so.
//
//   (a) Fast mode: a catalogue thumbnail dragged over the viewport shows the ghost and names the part under the
//       pointer (the same outline and label as hovering it); released over a part it assigns "Assign Gold to
//       Body" as one undo entry, which one Ctrl Z takes back;
//   (b) Esc cancels (and does not deselect), dropping outside the parts or outside the viewport does nothing,
//       and a click on a thumbnail still assigns;
//   (c) the tree: the row lights up, a part row takes it, a group row gives it to every part under it (after the
//       inline question when they differ), one entry;
//   (d) Alt gives a copy ("Assign a copy of Gold to Body"), the sphere of the material of the selection is a
//       source too (it links), and a material of Mine is a source;
//   (e) the Faces level: the drop names the face it lands on, the click selects a whole face, Ctrl takes it out and
//       Shift adds one triangle;
//   (f) a pen drags like a mouse, a finger does not start a drag (a tap still assigns);
//   (g) the same in Full mode (the path tracer under the overlay).
//
// Screenshots: material-drag.png (mid-drag over the viewport), material-drag-tree.png (over a group row),
// material-drag-faces.png; Full mode's go to out/ (they are large).
// Results: out/material-drag-check.json.

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
const ONLY = opt('only', 'fast,mine,pen,full').split(',');
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

// ------------------------------------------------------------------ the page

let BASE_URL = BASE;

async function open(browser, query) {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !m.text().startsWith('Failed to load resource') && errors.push(m.text()));
  await page.goto(`${BASE_URL}/?${query}`);
  await page.waitForSelector('#app[data-ready="1"]', { timeout: 60000 });
  return { page, context, errors };
}

const STUDIO = 'example=1&theme=dark&select=body&catalog=1';
const frame = (page) => new Promise((r) => setTimeout(r, 140)).then(() => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))));

/** What the page shows of the project: the undo tooltip, the materials of the rows, the drag state. */
const state = (page) =>
  page.evaluate(() => {
    const row = (name) => [...document.querySelectorAll('.tree-row')].find((r) => r.querySelector('.tree-name')?.textContent === name);
    const mats = {};
    for (const r of document.querySelectorAll('.tree-row')) mats[r.querySelector('.tree-name')?.textContent] = r.querySelector('.tree-mat')?.textContent ?? null;
    const label = document.querySelector('.hover-label');
    return {
      undo: document.querySelector('.hdr button[aria-label="Undo"]')?.getAttribute('data-tip') ?? null,
      mats,
      ghost: !!document.querySelector('.drag-ghost'),
      ghostCopy: document.querySelector('.drag-ghost')?.classList.contains('is-copy') ?? false,
      dragging: document.body.classList.contains('is-material-drag'),
      drop: document.body.dataset.drop ?? null,
      label: label && label.style.display !== 'none' ? label.textContent : null,
      dropRow: [...document.querySelectorAll('.tree-row.is-drop')].map((r) => r.querySelector('.tree-name')?.textContent),
      selected: [...document.querySelectorAll('.tree-row.is-selected')].map((r) => r.querySelector('.tree-name')?.textContent),
      confirm: document.querySelector('.tree-confirm .confirm-msg')?.textContent ?? null,
      row: (n) => !!row(n),
    };
  });

const filterMaterials = async (page, text) => {
  const input = page.locator('.catalog input[type="search"]');
  await input.fill(text);
  await frame(page);
};

const thumb = (page, name) => page.locator('.catalog .thumb', { has: page.locator('.thumb-caption', { hasText: new RegExp(`^${name}$`) }) }).first();

const centre = async (loc) => {
  const b = await loc.boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};

/** Presses on a thumbnail and moves a little: the drag has started. */
async function pickUp(page, loc) {
  const p = await centre(loc);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move(p.x - 40, p.y + 6, { steps: 6 });
  await frame(page);
  return p;
}

/** Two frames and a moment: the hover label and the outline are drawn once per frame. */
const settle = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 30)))));

const known = new WeakMap();

/**
 * A point of the canvas where the label of the viewport names `name`, found by moving over it while dragging
 * (nearest to the middle first) and remembered, because the camera does not move. Leaves the pointer there.
 */
async function findPart(page, name, opts = {}) {
  const cache = known.get(page) ?? known.set(page, {}).get(page);
  const box = await page.locator('canvas[aria-label="viewport"]').boundingBox();
  const far = (p) => !opts.farFrom || Math.hypot(p.x - opts.farFrom.x, p.y - opts.farFrom.y) > 40;
  if (cache[name] && far(cache[name])) {
    await page.mouse.move(cache[name].x, cache[name].y, { steps: 3 });
    await settle(page);
    return cache[name];
  }
  const grid = [];
  for (let fy = 0.2; fy <= 0.85; fy += 0.04) for (let fx = 0.32; fx <= 0.68; fx += 0.04) grid.push([fx, fy]);
  grid.sort((a, b) => Math.hypot(a[0] - 0.5, a[1] - 0.55) - Math.hypot(b[0] - 0.5, b[1] - 0.55));
  for (const [fx, fy] of grid) {
    const x = box.x + box.width * fx;
    const y = box.y + box.height * fy;
    await page.mouse.move(x, y, { steps: 2 });
    await settle(page);
    const label = (await state(page)).label;
    if (label) cache[label] = cache[label] ?? { x, y };
    if (label === name && far({ x, y })) return { x, y };
  }
  return fail(`no point of the viewport shows ${name}`);
}

const ok = (cond, text, failures) => {
  if (!cond) failures.push(text);
  return cond;
};

// ------------------------------------------------------------------ the checks

async function viewportChecks(browser, mode, name) {
  const { page, context, errors } = await open(browser, `${STUDIO}&mode=${mode}`);
  const f = [];
  const log = {};
  if (mode === 'full') await page.waitForFunction(() => document.querySelector('.ov-bl')?.dataset.mode === 'full', null, { timeout: 60000 });
  const mode0 = (await page.evaluate(() => document.querySelector('.ov-bl')?.dataset.mode)) ?? '';
  ok(mode0 === mode, `the viewport is in ${mode0}, not ${mode}`, f);
  await filterMaterials(page, 'gold');

  // (a) over the viewport: ghost, label, state of the drop; released over the body.
  const gold = thumb(page, 'Gold');
  await pickUp(page, gold);
  let s = await state(page);
  ok(s.ghost && s.dragging, 'no ghost or no dragging class once the pointer moved', f);
  // Outside every part (the empty corner of the viewport) nothing would be assigned.
  const box = await page.locator('canvas[aria-label="viewport"]').boundingBox();
  await page.mouse.move(box.x + 30, box.y + box.height - 30, { steps: 4 });
  await frame(page);
  s = await state(page);
  ok(s.drop === 'no' && s.label === null, `over empty space: drop=${s.drop}, label=${s.label}`, f);
  const body = await findPart(page, 'Body');
  s = await state(page);
  ok(s.drop === 'yes' && s.label === 'Body', `over the body: drop=${s.drop}, label=${s.label}`, f);
  log.hoverOverBody = { drop: s.drop, label: s.label };
  await page.screenshot({ path: mode === 'fast' ? join(SHOTS, 'material-drag.png') : join(OUT, 'material-drag-full.png') });
  await page.mouse.move(body.x, body.y);
  await page.mouse.up();
  await frame(page);
  s = await state(page);
  ok(!s.ghost && !s.dragging && s.drop === null, 'the ghost or the drag state stayed after the drop', f);
  ok(s.undo === 'Undo: Assign Gold to Body', `undo says "${s.undo}"`, f);
  ok(s.mats.Body === 'Gold', `Body carries ${s.mats.Body}`, f);
  log.afterDrop = { undo: s.undo, body: s.mats.Body };
  // Ctrl Z takes it back in one step.
  await page.locator('canvas[aria-label="viewport"]').focus();
  await page.keyboard.press('Control+z');
  await frame(page);
  s = await state(page);
  ok(s.mats.Body === 'Metallic paint' && s.undo === 'Undo: Load example part', `after Ctrl Z: ${s.mats.Body}, "${s.undo}"`, f);

  // (b) Esc cancels, and does not deselect; outside the viewport nothing happens; a click still assigns.
  await pickUp(page, gold);
  await findPart(page, 'Body');
  await page.keyboard.press('Escape');
  await frame(page);
  s = await state(page);
  ok(!s.ghost && !s.dragging, 'Esc did not end the drag', f);
  await page.mouse.up();
  await frame(page);
  s = await state(page);
  ok(s.mats.Body === 'Metallic paint' && s.undo === 'Undo: Load example part', `Esc then release changed the project: ${s.mats.Body}`, f);
  ok(s.selected.includes('Body'), `Esc deselected (${s.selected})`, f);
  await pickUp(page, gold);
  await page.mouse.move(800, 960, { steps: 5 });
  await page.mouse.up();
  await frame(page);
  s = await state(page);
  ok(s.mats.Body === 'Metallic paint' && s.undo === 'Undo: Load example part', 'a release over the bar below changed the project', f);
  // A drag that ends back on its own thumbnail is not a click: the click the release makes is swallowed.
  const home = await pickUp(page, gold);
  await page.mouse.move(home.x, home.y, { steps: 6 });
  await page.mouse.up();
  await frame(page);
  s = await state(page);
  ok(s.mats.Body === 'Metallic paint' && s.undo === 'Undo: Load example part', `a drag that ended on its thumbnail assigned: ${s.mats.Body}, "${s.undo}"`, f);
  // A press that never moves is a click: it assigns to the selection (the body).
  await gold.click();
  await frame(page);
  s = await state(page);
  ok(s.mats.Body === 'Gold' && s.undo === 'Undo: Assign Gold to Body', `a click on the thumbnail: ${s.mats.Body}, "${s.undo}"`, f);
  await page.keyboard.press('Control+z');
  await frame(page);

  // (d) Alt gives a copy; the sphere of the material is a source; a material of Mine is a source.
  await pickUp(page, gold);
  await findPart(page, 'Body');
  await page.keyboard.down('Alt');
  await frame(page);
  s = await state(page);
  ok(s.ghostCopy, 'Alt did not mark the ghost as a copy', f);
  await page.mouse.up();
  await page.keyboard.up('Alt');
  await frame(page);
  s = await state(page);
  ok(s.undo === 'Undo: Assign a copy of Gold to Body' && s.mats.Body === 'Gold', `Alt drop: "${s.undo}", ${s.mats.Body}`, f);
  await page.keyboard.press('Control+z');
  await frame(page);
  // The sphere of the selection (the cap, gold) dragged onto the label's row: it links.
  await page.locator('.tree-row', { has: page.locator('.tree-name', { hasText: /^Cap$/ }) }).click();
  await frame(page);
  const sphere = page.locator('.mat-card [data-drag-source]');
  ok((await sphere.count()) === 1, 'the sphere of the material is not a drag source', f);
  await pickUp(page, sphere);
  const labelRow = page.locator('.tree-row', { has: page.locator('.tree-name', { hasText: /^Label$/ }) });
  const lr = await centre(labelRow);
  await page.mouse.move(lr.x, lr.y, { steps: 8 });
  await frame(page);
  s = await state(page);
  ok(s.dropRow.join() === 'Label' && s.drop === 'yes', `over the Label row: ${s.dropRow}, drop=${s.drop}`, f);
  await page.mouse.up();
  await frame(page);
  s = await state(page);
  ok(s.mats.Label === 'Gold' && s.undo === 'Undo: Assign Gold to Label', `the sphere dropped on a row: ${s.mats.Label}, "${s.undo}"`, f);
  log.sphere = { label: s.mats.Label, undo: s.undo };
  await page.keyboard.press('Control+z');
  await frame(page);

  // (c) the tree: a part row, and a group row (after the question).
  await page.locator('.tree-row', { has: page.locator('.tree-name', { hasText: /^Body$/ }) }).click();
  await filterMaterials(page, 'rubber');
  const rubber = thumb(page, 'Rubber');
  await pickUp(page, rubber);
  const baseRow = page.locator('.tree-row', { has: page.locator('.tree-name', { hasText: /^Base$/ }) });
  const br = await centre(baseRow);
  await page.mouse.move(br.x, br.y, { steps: 8 });
  await frame(page);
  s = await state(page);
  ok(s.dropRow.join() === 'Base' && s.drop === 'yes', `over the Base row: ${s.dropRow}, drop=${s.drop}`, f);
  await page.mouse.up();
  await frame(page);
  s = await state(page);
  ok(s.undo === 'Undo: Assign Rubber to Base' && s.mats.Base === 'Rubber' && s.dropRow.length === 0, `part row drop: "${s.undo}", ${s.mats.Base}, rows lit ${s.dropRow}`, f);
  await pickUp(page, rubber);
  const closureRow = page.locator('.tree-row', { has: page.locator('.tree-name', { hasText: /^Closure$/ }) });
  const cr = await centre(closureRow);
  await page.mouse.move(cr.x, cr.y, { steps: 8 });
  await frame(page);
  s = await state(page);
  ok(s.dropRow.join() === 'Closure', `over the Closure row: ${s.dropRow}`, f);
  if (mode === 'fast') await page.screenshot({ path: join(SHOTS, 'material-drag-tree.png') });
  await page.mouse.up();
  await frame(page);
  s = await state(page);
  ok(s.confirm !== null && /Closure contains 2 materials/.test(s.confirm), `no question for a group with two materials: ${s.confirm}`, f);
  ok(s.mats.Collar === 'Polished chrome' && s.mats.Cap === 'Gold', 'the group was assigned before the question was answered', f);
  await page.locator('.tree-confirm .btn-primary').click();
  await frame(page);
  s = await state(page);
  ok(s.mats.Collar === 'Rubber' && s.mats.Cap === 'Rubber' && s.undo === 'Undo: Assign Rubber to Closure', `group drop: ${s.mats.Collar}, ${s.mats.Cap}, "${s.undo}"`, f);
  log.group = { collar: s.mats.Collar, cap: s.mats.Cap, undo: s.undo };
  // One Ctrl Z takes back the group drop (the part row's is the entry under it), a second that one.
  await page.locator('canvas[aria-label="viewport"]').focus();
  await page.keyboard.press('Control+z');
  await frame(page);
  s = await state(page);
  ok(s.undo === 'Undo: Assign Rubber to Base' && s.mats.Cap === 'Gold' && s.mats.Collar === 'Polished chrome', `one Ctrl Z after the group drop: "${s.undo}", ${s.mats.Cap}, ${s.mats.Collar}`, f);
  await page.keyboard.press('Control+z');
  await frame(page);
  s = await state(page);
  ok(s.undo === 'Undo: Load example part' && s.mats.Base === 'Gloss ABS', `a second Ctrl Z: "${s.undo}", ${s.mats.Base}`, f);

  // (e) the Faces level. (A click on a tree row selects at the level of the row, so the level is chosen after the
  // part; and the catalogue is the inspector of selected faces, so a face is clicked first.)
  await page.locator('.tree-row', { has: page.locator('.tree-name', { hasText: /^Body$/ }) }).click();
  await frame(page);
  await page.locator('.seg button', { hasText: /^Faces$/ }).first().click();
  await frame(page);
  const faceAt = await findPart(page, 'Body');
  const crumb = () => page.evaluate(() => document.querySelector('.insp, .side-right, aside:last-of-type')?.textContent?.match(/\d+ faces? of Body/)?.[0] ?? null);
  await page.mouse.click(faceAt.x, faceAt.y);
  await frame(page);
  const whole = await crumb();
  // Ctrl takes the whole face out again; then Shift adds the triangle alone.
  await page.keyboard.down('Control');
  await page.mouse.click(faceAt.x, faceAt.y);
  await page.keyboard.up('Control');
  await frame(page);
  const out = await crumb();
  await page.keyboard.down('Shift');
  await page.mouse.click(faceAt.x, faceAt.y);
  await page.keyboard.up('Shift');
  await frame(page);
  const loose = await crumb();
  await page.mouse.click(faceAt.x, faceAt.y);
  await frame(page);
  log.faceClick = { whole, out, loose };
  ok(whole !== null && Number(/\d+/.exec(whole)?.[0]) > 1, `a click at Faces took ${whole}`, f);
  ok(out === null || /^0 faces of Body$/.test(out), `Ctrl+click on the selected face left ${out}`, f);
  ok(loose === '1 face of Body', `Shift+click took ${loose}`, f);
  // A material dragged onto another face of the body lands on the whole face under the pointer.
  await filterMaterials(page, 'gold');
  await pickUp(page, thumb(page, 'Gold'));
  const other = await findPart(page, 'Body', { farFrom: faceAt });
  s = await state(page);
  ok(s.drop === 'yes' && s.label === 'Body', `at Faces over the body: drop=${s.drop}, label=${s.label}`, f);
  if (mode === 'fast') await page.screenshot({ path: join(SHOTS, 'material-drag-faces.png') });
  await page.mouse.up();
  await frame(page);
  s = await state(page);
  ok(s.undo === 'Undo: Assign Gold to 1 face of Body', `Faces drop: "${s.undo}"`, f);
  ok(s.mats.Body === '2 materials', `Body after a drop on a face: ${s.mats.Body}`, f);
  log.faces = { undo: s.undo, body: s.mats.Body, other };
  await page.locator('canvas[aria-label="viewport"]').focus();
  await page.keyboard.press('Control+z');
  await frame(page);
  s = await state(page);
  ok(s.mats.Body === 'Metallic paint', `after undoing the face drop: ${s.mats.Body}`, f);

  ok(errors.length === 0, `errors in the page: ${errors.join(' | ')}`, f);
  await context.close();
  results[name] = { ok: f.length === 0, failures: f, ...log };
  console.log(`${name}: ${f.length === 0 ? 'OK' : `FAILED\n  - ${f.join('\n  - ')}`}`);
}

/** A pen drags like a mouse (synthetic pointer events: Playwright's mouse is always a mouse); a finger does not. */
async function penAndTouch(browser) {
  const { page, context, errors } = await open(browser, `${STUDIO}&mode=fast`);
  const f = [];
  await filterMaterials(page, 'gold');
  const gold = thumb(page, 'Gold');
  const from = await centre(gold);
  // Where the label says Body, found with the mouse first.
  await pickUp(page, gold);
  const body = await findPart(page, 'Body');
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await frame(page);
  const run = (pointerType) =>
    page.evaluate(
      async ({ from, body, pointerType }) => {
        const ev = (type, x, y, extra = {}) => new PointerEvent(type, { pointerId: 7, pointerType, isPrimary: true, clientX: x, clientY: y, button: 0, buttons: type === 'pointerup' ? 0 : 1, bubbles: true, cancelable: true, ...extra });
        const el = [...document.querySelectorAll('.catalog .thumb')].find((t) => t.textContent.trim() === 'Gold');
        const wait = () => new Promise((r) => setTimeout(() => requestAnimationFrame(() => requestAnimationFrame(r)), 120));
        el.dispatchEvent(ev('pointerdown', from.x, from.y));
        for (let i = 1; i <= 8; i++) {
          window.dispatchEvent(ev('pointermove', from.x + ((body.x - from.x) * i) / 8, from.y + ((body.y - from.y) * i) / 8));
          await wait();
        }
        const mid = { ghost: !!document.querySelector('.drag-ghost'), drop: document.body.dataset.drop ?? null };
        window.dispatchEvent(ev('pointerup', body.x, body.y));
        await wait();
        return mid;
      },
      { from, body, pointerType },
    );
  const pen = await run('pen');
  let s = await state(page);
  ok(pen.ghost && pen.drop === 'yes', `pen: ghost=${pen.ghost}, drop=${pen.drop}`, f);
  ok(s.undo === 'Undo: Assign Gold to Body' && s.mats.Body === 'Gold', `pen drop: "${s.undo}", ${s.mats.Body}`, f);
  await page.keyboard.press('Control+z');
  await frame(page);
  const touch = await run('touch');
  s = await state(page);
  ok(!touch.ghost && s.mats.Body === 'Metallic paint', `touch: ghost=${touch.ghost}, body=${s.mats.Body}`, f);
  ok(errors.length === 0, `errors in the page: ${errors.join(' | ')}`, f);
  await context.close();
  results.penAndTouch = { ok: f.length === 0, failures: f, pen, touch };
  console.log(`pen and touch: ${f.length === 0 ? 'OK' : `FAILED\n  - ${f.join('\n  - ')}`}`);
}

/** A material of Mine is a drag source. */
async function mine(browser) {
  const { page, context, errors } = await open(browser, STUDIO);
  const f = [];
  // Save the cap's material to the library, then drag that card onto the body.
  await page.locator('.tree-row', { has: page.locator('.tree-name', { hasText: /^Cap$/ }) }).click();
  await frame(page);
  await page.getByRole('button', { name: 'Save material as…' }).click();
  await page.locator('.name-prompt input').fill('My gold');
  await page.keyboard.press('Enter');
  await frame(page);
  await page.locator('.tree-row', { has: page.locator('.tree-name', { hasText: /^Body$/ }) }).click();
  await frame(page);
  await page.locator('.catalog .chip', { hasText: /^Mine$/ }).click();
  await frame(page);
  const card = page.locator('.catalog .mine-card .thumb', { has: page.locator('.thumb-caption', { hasText: 'My gold' }) }).first();
  ok((await card.count()) === 1, 'the saved material is not in Mine', f);
  await pickUp(page, card);
  const body = await findPart(page, 'Body');
  await page.mouse.move(body.x, body.y);
  await page.mouse.up();
  await frame(page);
  const s = await state(page);
  ok(s.undo === 'Undo: Assign My gold to Body' && s.mats.Body === 'My gold', `Mine drop: "${s.undo}", ${s.mats.Body}`, f);
  ok(errors.length === 0, `errors in the page: ${errors.join(' | ')}`, f);
  await context.close();
  results.mine = { ok: f.length === 0, failures: f, undo: s.undo, body: s.mats.Body };
  console.log(`Mine: ${f.length === 0 ? 'OK' : `FAILED\n  - ${f.join('\n  - ')}`}`);
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
  if (ONLY.includes('fast')) await viewportChecks(browser, 'fast', 'fast');
  if (ONLY.includes('mine')) await mine(browser);
  if (ONLY.includes('pen')) await penAndTouch(browser);
  if (!ONLY.includes('full')) {
    // Not asked for.
  } else if (existsSync(join(ROOT, 'dist', 'engine', 'rt.wasm'))) await viewportChecks(browser, 'full', 'full');
  else {
    results.full = { ok: true, skipped: 'dist/engine/rt.wasm is missing (npm run engine:build)' };
    console.log('full: skipped, no rt.wasm');
  }
  writeFileSync(join(OUT, 'material-drag-check.json'), JSON.stringify(results, null, 2));
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
