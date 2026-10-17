#!/usr/bin/env node
// Browser checks of phase L4 in the built app (own lights; lights and cameras in the viewport; Look through), with
// the local Chromium and swiftshader, in Fast and in Full mode.
//
//   npm run build && node tools/lights-check.mjs [--url http://localhost:4277] [--shots docs/ui] [--only fast,full]
//
// Without --url it serves dist/ with `vite preview` on port 4277 and stops it at the end. Full mode needs
// dist/engine/rt.wasm (`npm run engine:build` before the build); without it that part is skipped and says so.
//
//   adding     the Lights tab's Add light lists area (rectangle, disc, sphere), point, spot, sun and IES… (L5, a
//              profile file: tools/ies-check.mjs); a spot is added in front of and above the part, selected, and one undo takes it away; Aim at ▸
//              A part… aims it at the part clicked; the header's Add ▸ has the lights too;
//   glyphs     Lights and cameras (left of Pan) draws the glyphs while the Lights or Cameras tab is open or one is
//              selected; a click on the spot's glyph selects it; a saved camera is selected by its glyph; off, or on
//              the Parts tab with nothing selected, a click there selects nothing;
//   gizmo      with Move the spot's gizmo has arrows and rings but no scale cubes; a drag of the Z arrow raises it
//              (its Z coordinate in the inspector), is one undo entry ("Move light Spot") and undo puts it back; a
//              saved camera moves with its gizmo the same way and the active camera does not move;
//   look       Ctrl ⇧ L looks through the spot (the banner says so), an orbit drag moves the spot (its azimuth
//              changes), is one undo entry and leaves the active camera; Esc comes back; a locked saved camera looked
//              through does not move with an orbit;
//   full       the same spot aimed at the cap, rendered converged in Full mode.
//
// Screenshots (docs/ui): lights-add-menu.png, lights-spot-aimed.png, lights-spot-full.png (Full, converged; the
// canvas only), lights-glyphs-gizmo.png, lights-look-through.png. Results: out/lights-check.json.

import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4277;

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const SHOTS = resolve(ROOT, opt('shots', 'docs/ui'));
const ONLY = opt('only', 'fast,full').split(',');
const OUT = join(ROOT, 'out');
mkdirSync(OUT, { recursive: true });
mkdirSync(SHOTS, { recursive: true });

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

const settle = (page, ms = 80) => page.evaluate((wait) => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, wait)))), ms);
const ok = (cond, text, failures) => {
  if (!cond) failures.push(text);
  return cond;
};

/** What the page shows: the selected object and where it is, the undo tooltip, the light's fields, Look through. */
const state = (page) =>
  page.evaluate(() => {
    const vp = document.querySelector('main.vp');
    const num = (el) => (el ? Number(el.getAttribute('aria-valuenow')) : null);
    const pos = [...document.querySelectorAll('[data-field="light-position"] .num')].map(num);
    const azEl = document.querySelector('[data-field="light"] [role="spinbutton"][aria-label="Azimuth"]');
    return {
      object: vp?.dataset.object ?? '',
      at: (vp?.dataset.objectAt ?? '').split(',').filter(Boolean).map(Number),
      look: vp?.dataset.lookThrough ?? '',
      banner: document.querySelector('.ov-look')?.style.display === 'none' ? '' : (document.querySelector('.ov-look')?.textContent ?? ''),
      undo: document.querySelector('.hdr button[aria-label="Undo"]')?.getAttribute('data-tip') ?? null,
      crumb: document.querySelector('.crumbs')?.textContent ?? '',
      lights: [...document.querySelectorAll('.light-row .list-main > div:first-child')].map((n) => n.textContent),
      position: pos,
      azimuth: num(azEl),
      aim: document.querySelector('[data-field="aim"]')?.textContent ?? '',
      tool: document.querySelector('.ov-tl [data-tool][aria-pressed="true"]')?.getAttribute('data-tool') ?? null,
      glyphs: document.querySelector('.ov-tl [data-glyphs]')?.getAttribute('aria-pressed') ?? null,
      camera: document.querySelector('.ov-tr .ov-text-btn span')?.textContent ?? '',
    };
  });

const canvas = (page) => page.locator('canvas[aria-label="viewport"]');

/** A point of the canvas in page coordinates. */
async function onCanvas(page, p) {
  const b = await canvas(page).boundingBox();
  return { x: b.x + p.x, y: b.y + p.y };
}

async function clickAt(page, p, mods = []) {
  for (const k of mods) await page.keyboard.down(k);
  await page.mouse.click(p.x, p.y);
  for (const k of mods) await page.keyboard.up(k);
  await settle(page, 120);
}

async function handleAt(page, p) {
  await page.mouse.move(p.x, p.y);
  await settle(page, 30);
  return page.evaluate(() => {
    const vp = document.querySelector('main.vp');
    return vp?.getAttribute('data-gizmo') === 'hover' ? vp.getAttribute('data-gizmo-handle') : null;
  });
}

/** Points where each handle is, found by looking around `centre` on rings (the gizmo is about 92 px long). */
async function findHandles(page, centre, want) {
  const found = {};
  for (const r of [70, 80, 60, 86, 50, 40, 100, 120]) {
    for (let a = 0; a < 360; a += 6) {
      const p = { x: centre.x + r * Math.cos((a * Math.PI) / 180), y: centre.y - r * Math.sin((a * Math.PI) / 180) };
      const h = await handleAt(page, p);
      if (h && !found[h]) found[h] = p;
    }
    if (want.every((k) => found[k])) break;
  }
  return found;
}

async function dragFrom(page, a, b, keys = []) {
  for (const k of keys) await page.keyboard.down(k);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(a.x + ((b.x - a.x) * i) / 12, a.y + ((b.y - a.y) * i) / 12);
  await page.mouse.up();
  for (const k of keys) await page.keyboard.up(k);
  await settle(page, 200);
}

async function undo(page) {
  await page.keyboard.press('Control+z');
  await settle(page, 150);
}

async function lightsTab(page) {
  await page.locator('.side-left [role="tab"]', { hasText: 'Lights' }).click();
  await settle(page);
}

/** The Lights tab's Add light ▸ <name>; `shot` takes the open menu first. */
async function addLight(page, name, shot = null) {
  await lightsTab(page);
  await page.click('[data-add="light"]');
  await settle(page, 150);
  const entries = await page.locator('.floating .menu-item').allTextContents();
  if (shot) await page.screenshot({ path: shot });
  await page.locator('.floating .menu-item', { hasText: new RegExp(`^${name}`) }).first().click();
  await settle(page, 300);
  return entries;
}

/** Activates a camera from the top right menu (the selection stays). */
async function activateFromMenu(page, name) {
  await page.locator('.ov-tr .ov-text-btn').first().click();
  await settle(page);
  await page.locator('.floating .menu-item', { hasText: new RegExp(`^${name}$`) }).click();
  await settle(page, 200);
}

/** A point of the example bottle's label, under the middle of the frame. */
async function labelPoint(page) {
  const b = await canvas(page).boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height * 0.6 };
}

async function waitFull(page) {
  await page.waitForFunction(() => document.querySelector('.ov-bl')?.dataset.mode === 'full', null, { timeout: 90000 });
}

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

/** Types a value into a number field (double click, type, Enter). */
async function typeInto(page, locator, value) {
  await locator.dblclick();
  await settle(page);
  await page.keyboard.press('Control+a');
  await page.keyboard.type(String(value));
  await page.keyboard.press('Enter');
  await settle(page, 150);
}

/**
 * A spot aimed at the label: Add light ▸ Spot, Aim at ▸ A part…, a click on the label; a narrow cone with a soft
 * edge, brighter, and the setup's lights off for the picture (`alone`), so the pool of light on the label shows.
 */
async function aimedSpot(page, f, shotMenu = null, alone = false) {
  const entries = await addLight(page, 'Spot', shotMenu);
  const s = await state(page);
  ok(s.crumb.endsWith('Spot') && s.object.startsWith('LIGHT:'), `the new spot is selected: ${s.crumb} ${s.object}`, f);
  await page.click('[data-action="light.aim"]');
  await settle(page);
  await page.locator('.floating .menu-item', { hasText: /^A part…$/ }).click();
  await settle(page);
  await clickAt(page, await labelPoint(page));
  if (alone) {
    const light = page.locator('[data-field="light"]');
    await typeInto(page, light.locator('[role="spinbutton"][aria-label="Cone angle"]'), 9);
    await typeInto(page, light.locator('[role="spinbutton"][aria-label="Soft edge"]'), 35);
    await typeInto(page, light.locator('[role="spinbutton"][aria-label="Power"]'), 160);
    for (const name of ['Key', 'Fill', 'Rim']) {
      await page.locator('.light-row', { hasText: new RegExp(`^${name}`) }).locator('.toggle').click();
      await settle(page);
    }
  }
  return entries;
}

// ------------------------------------------------------------------ the checks

async function fast(browser) {
  const { page, context, errors } = await open(browser, 'example=1&theme=dark&mode=fast');
  const f = [];
  const log = {};

  // Add light ▸ with its seven entries; a spot in front of and above the part; aimed at the cap.
  const entries = await aimedSpot(page, f, join(SHOTS, 'lights-add-menu.png'), true);
  const KINDS = ['Area · rectangle', 'Area · disc', 'Area · sphere', 'Point', 'Spot', 'Sun', 'IES…'];
  ok(KINDS.every((k, i) => entries[i]?.startsWith(k)) && !/coming soon/.test(entries[6] ?? ''), `Add light ▸ lists: ${entries.join(' | ')}`, f);
  let s = await state(page);
  log.added = s;
  ok(s.lights.at(-1)?.startsWith('Spot'), `the Lights tab lists the spot: ${s.lights}`, f);
  ok(/Aims at a point/.test(s.aim), `the spot aims at the label: ${s.aim}`, f);
  // The picture: Lights and cameras off, so only the selected spot's glyph is drawn.
  await page.click('.ov-tl [data-glyphs]');
  await page.mouse.move(10, 500);
  await settle(page, 300);
  await page.screenshot({ path: join(SHOTS, 'lights-spot-aimed.png') });
  await page.click('.ov-tl [data-glyphs]');
  await settle(page);

  // Undo, one entry at a time: the three lights back on, the power, the soft edge, the cone, the aim, the spot.
  await page.keyboard.press('Escape');
  for (let i = 0; i < 7; i++) await undo(page);
  s = await state(page);
  ok(s.undo === 'Undo: Add light Spot', `seven undos back to the new spot: ${s.undo}`, f);
  await lightsTab(page);
  await page.locator('.light-row', { hasText: /^Spot/ }).locator('.list-main').click();
  await settle(page);
  ok(/product’s centre/.test((await state(page)).aim), `the aim undone: ${(await state(page)).aim}`, f);
  await undo(page);
  s = await state(page);
  ok(!s.lights.some((n) => n.startsWith('Spot')), `undo the spot: ${s.lights}`, f);
  for (let i = 0; i < 8; i++) await page.keyboard.press('Control+Shift+z');
  await settle(page, 200);
  // The rig back on for the rest (the redo put them off again).
  for (const name of ['Key', 'Fill', 'Rim']) {
    await page.locator('.light-row', { hasText: new RegExp(`^${name}`) }).locator('.toggle').click();
    await settle(page);
  }

  // A saved camera: New from current view (it becomes the active one) and an orbit takes it away; Camera 1 active
  // again (the top right menu) leaves Camera 2 where it went, drawn as a frustum.
  await page.locator('.side-left [role="tab"]', { hasText: 'Cameras' }).click();
  await settle(page);
  await page.locator('.side-foot button', { hasText: 'New from current view' }).click();
  await settle(page);
  const b = await canvas(page).boundingBox();
  // Camera 2 looks from behind (Views ▸ Back): from Camera 1 it shows beyond the bottle.
  await page.locator('.ov-tl button[aria-label="Views"]').click();
  await settle(page);
  await page.locator('.floating .menu-item', { hasText: /^Back$/ }).click();
  await settle(page, 200);
  await activateFromMenu(page, 'Camera 1');
  for (let i = 0; i < 7; i++) {
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.wheel(0, 300);
    await settle(page, 60);
  }
  await settle(page, 300);

  // The glyphs: the spot is picked by a click on it; a click away deselects.
  await lightsTab(page);
  await page.locator('.light-row', { hasText: /^Spot/ }).locator('.list-main').click();
  await settle(page, 200);
  s = await state(page);
  const spotId = s.object;
  const visible = (at) => at.length === 2 && at[0] > 0 && at[1] > 0 && at[0] < b.width && at[1] < b.height;
  const spotAt = visible(s.at) ? await onCanvas(page, { x: s.at[0], y: s.at[1] }) : null;
  ok(spotAt !== null, `the spot is on screen: ${s.at}`, f);
  await page.keyboard.press('Escape');
  await settle(page);
  ok((await state(page)).object === '', 'Esc deselects the spot', f);
  if (spotAt) {
    await clickAt(page, spotAt);
    s = await state(page);
    ok(s.object === spotId && s.crumb.endsWith('Spot'), `a click on the spot's glyph selects it: ${s.object} ${s.crumb}`, f);
    // Lights and cameras off: only the selected one is drawn and picked; deselected, the click picks nothing there.
    await page.click('.ov-tl [data-glyphs]');
    await settle(page);
    ok((await state(page)).glyphs === 'false', 'Lights and cameras turns off', f);
    await page.keyboard.press('Escape');
    await settle(page);
    await clickAt(page, spotAt);
    ok(!(await state(page)).object.startsWith('LIGHT'), 'with Lights and cameras off a click there does not pick the spot', f);
    await page.click('.ov-tl [data-glyphs]');
    await settle(page);
    await clickAt(page, spotAt);
    ok((await state(page)).object === spotId, 'on again, the click picks it', f);
    // On the Parts tab with nothing selected the glyphs stay out of the picture: the click does not pick it.
    await page.keyboard.press('Escape');
    await page.locator('.side-left [role="tab"]', { hasText: 'Parts' }).click();
    await settle(page);
    await clickAt(page, spotAt);
    ok(!(await state(page)).object.startsWith('LIGHT'), 'on the Parts tab a click there does not pick the spot', f);
    await lightsTab(page);
    await clickAt(page, spotAt);
    ok((await state(page)).object === spotId, 'on the Lights tab it does', f);
  }

  // The gizmo on the spot: arrows and rings, no scale cubes; a drag of Z raises it, one undo entry.
  await page.keyboard.press('m');
  await settle(page, 200);
  s = await state(page);
  log.beforeGizmo = s;
  if (!visible(s.at)) {
    f.push(`the spot is not on screen for its gizmo: ${JSON.stringify(s)}`);
    await context.close();
    return { failures: f, log };
  }
  const centre = await onCanvas(page, { x: s.at[0], y: s.at[1] });
  const handles = await findHandles(page, centre, ['tz', 'rz']);
  log.handles = Object.keys(handles);
  ok(handles.tz && !['sx', 'sy', 'sz', 'su'].some((k) => handles[k]), `the spot's gizmo: ${Object.keys(handles)}`, f);
  await page.mouse.move(10, 500);
  await settle(page, 150);
  await page.screenshot({ path: join(SHOTS, 'lights-glyphs-gizmo.png') });
  if (handles.tz) {
    const z0 = (await state(page)).position[2];
    await dragFrom(page, handles.tz, { x: handles.tz.x + (handles.tz.x - centre.x) * 0.6, y: handles.tz.y + (handles.tz.y - centre.y) * 0.6 });
    s = await state(page);
    log.raised = [z0, s.position[2]];
    ok(s.position[2] > z0 + 5, `a drag of Z raises the spot: ${z0} → ${s.position[2]}`, f);
    ok(s.undo === 'Undo: Move light Spot', `one undo entry for the drag: ${s.undo}`, f);
    await undo(page);
    ok(Math.abs((await state(page)).position[2] - z0) < 0.01, 'undo puts the spot back', f);
  }

  // A saved camera: selected (its row activates it; Camera 1 active again from the top right menu keeps it
  // selected), picked again by its glyph, moved by its gizmo; the active camera does not move.
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await settle(page);
  await page.locator('.side-left [role="tab"]', { hasText: 'Cameras' }).click();
  await settle(page);
  await page.locator('.list-row', { hasText: 'Camera 2' }).click();
  await settle(page);
  await activateFromMenu(page, 'Camera 1');
  s = await state(page);
  const camId = s.object;
  ok(camId.startsWith('CAMERA:') && s.camera === 'Camera 1', `Camera 2 selected, Camera 1 active: ${s.object} ${s.camera}`, f);
  const camAt = visible(s.at) ? await onCanvas(page, { x: s.at[0], y: s.at[1] }) : null;
  ok(camAt !== null, `Camera 2 is on screen: ${s.at}`, f);
  if (camAt) {
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await settle(page);
    await clickAt(page, camAt);
    s = await state(page);
    ok(s.object === camId, `a click on the camera's glyph selects it: ${s.object}`, f);
    await page.keyboard.press('m');
    await settle(page, 200);
    const ch = await findHandles(page, camAt, ['tx']);
    log.cameraHandles = Object.keys(ch);
    ok(ch.tx && !ch.sx, `the camera's gizmo: ${Object.keys(ch)}`, f);
    if (ch.tx) {
      const before = (await state(page)).at;
      await dragFrom(page, ch.tx, { x: ch.tx.x + (ch.tx.x - camAt.x) * 0.8, y: ch.tx.y + (ch.tx.y - camAt.y) * 0.8 });
      s = await state(page);
      ok(s.undo === 'Undo: Move camera Camera 2', `one undo entry for the camera's drag: ${s.undo}`, f);
      ok(s.camera === 'Camera 1' && (s.at[0] !== before[0] || s.at[1] !== before[1]), `Camera 2 moved, Camera 1 is still the active one: ${before} → ${s.at}`, f);
      await undo(page);
    }
  }
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await settle(page);

  // Look through the spot: Ctrl ⇧ L, the banner; an orbit moves the spot (its azimuth), one undo entry; Esc back.
  await lightsTab(page);
  await page.locator('.light-row', { hasText: /^Spot/ }).locator('.list-main').click();
  await settle(page, 150);
  const az0 = (await state(page)).azimuth;
  const undo0 = (await state(page)).undo;
  await page.keyboard.press('v');
  await canvas(page).focus();
  await page.keyboard.press('Control+Shift+l');
  await settle(page, 300);
  s = await state(page);
  ok(s.look === spotId && /Looking through Spot/.test(s.banner), `Ctrl ⇧ L looks through the spot: ${s.look} ${s.banner}`, f);
  await page.mouse.move(10, 500);
  await settle(page, 200);
  await page.screenshot({ path: join(SHOTS, 'lights-look-through.png') });
  await dragFrom(page, { x: b.x + b.width * 0.5, y: b.y + b.height * 0.75 }, { x: b.x + b.width * 0.62, y: b.y + b.height * 0.75 });
  await settle(page, 300);
  s = await state(page);
  log.lookOrbit = [az0, s.azimuth, s.undo];
  ok(Math.abs(s.azimuth - az0) > 2, `an orbit while looking through moves the spot: azimuth ${az0} → ${s.azimuth}`, f);
  ok(s.undo === 'Undo: Move Spot from its view', `one undo entry for the orbit: ${s.undo}`, f);
  ok(s.camera === 'Camera 1', `the active camera stays: ${s.camera}`, f);
  await page.keyboard.press('Escape');
  await settle(page, 300);
  s = await state(page);
  ok(s.look === '' && s.banner === '', `Esc comes back to the active camera: ${s.look}`, f);
  await undo(page);
  s = await state(page);
  ok(Math.abs(s.azimuth - az0) < 0.01 && s.undo === undo0, `one undo takes the orbit back: ${s.azimuth} ${s.undo}`, f);

  // A locked saved camera looked through: the banner says so and an orbit does not move it.
  await page.locator('.side-left [role="tab"]', { hasText: 'Cameras' }).click();
  await settle(page);
  await page.locator('.list-row', { hasText: 'Camera 2' }).click();
  await settle(page);
  await page.locator('.ov-tl button[aria-label="Lock camera"]').click();
  await settle(page);
  await activateFromMenu(page, 'Camera 1');
  const undoLocked = (await state(page)).undo;
  await canvas(page).focus();
  await page.keyboard.press('Control+Shift+l');
  await settle(page, 300);
  s = await state(page);
  ok(s.look.startsWith('CAMERA:') && /locked/.test(s.banner), `looking through the locked Camera 2: ${s.look} ${s.banner}`, f);
  await dragFrom(page, { x: b.x + b.width * 0.5, y: b.y + b.height * 0.75 }, { x: b.x + b.width * 0.65, y: b.y + b.height * 0.7 });
  ok((await state(page)).undo === undoLocked, `an orbit does not move a locked camera: ${(await state(page)).undo}`, f);
  await page.keyboard.press('Escape');
  await settle(page, 200);
  ok((await state(page)).look === '', 'Esc comes back', f);
  ok(errors.length === 0, `page errors: ${errors.join(' | ')}`, f);
  await context.close();
  return { failures: f, log };
}

async function full(browser) {
  if (!existsSync(join(ROOT, 'dist', 'engine', 'rt.wasm'))) return { skipped: 'dist/engine/rt.wasm is missing (npm run engine:build, then npm run build)' };
  const { page, context, errors } = await open(browser, 'example=1&theme=dark&mode=full');
  const f = [];
  await waitFull(page);
  await aimedSpot(page, f, null, true);
  const s = await state(page);
  ok(/Aims at a point/.test(s.aim), `Full: the spot aims at the label: ${s.aim}`, f);
  await page.click('.ov-tl [data-glyphs]');
  await page.mouse.move(10, 500);
  await waitSamples(page, 64);
  const b = await canvas(page).boundingBox();
  await page.screenshot({ path: join(SHOTS, 'lights-spot-full.png'), clip: b });
  ok(errors.length === 0, `page errors: ${errors.join(' | ')}`, f);
  await context.close();
  return { failures: f };
}

let server = null;
const results = {};
try {
  if (!BASE_URL) {
    server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: 'ignore' });
    BASE_URL = `http://localhost:${PORT}`;
    await waitFor(BASE_URL);
  }
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch({ executablePath: findChromium(), args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  try {
    if (ONLY.includes('fast')) results.fast = await fast(browser);
    if (ONLY.includes('full')) results.full = await full(browser);
  } finally {
    await browser.close();
  }
} finally {
  server?.kill('SIGTERM');
  spawnSync('true');
}
writeFileSync(join(OUT, 'lights-check.json'), JSON.stringify(results, null, 2));
const failures = Object.entries(results).flatMap(([k, r]) => (r.failures ?? []).map((x) => `${k}: ${x}`));
for (const [k, r] of Object.entries(results)) if (r.skipped) console.log(`${k}: skipped — ${r.skipped}`);
if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('lights-check: all good', JSON.stringify(results.fast?.log ?? {}));
