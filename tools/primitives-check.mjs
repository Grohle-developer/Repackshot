#!/usr/bin/env node
// Browser checks of phase U9 in the built app (primitives and the scale tool), with the local Chromium and
// swiftshader, in Fast and in Full mode.
//
//   npm run build && node tools/primitives-check.mjs [--url http://localhost:4188] [--shots docs/ui] [--only fast,full]
//
// Without --url it serves dist/ with `vite preview` on port 4188 and stops it at the end. Full mode needs
// dist/engine/rt.wasm (`npm run engine:build` before the build); without it that part is skipped and says so.
//
//   adding   the header's Add ▸ Primitive lists the twelve shapes under a heading; a Box goes under the example bottle
//            as a base, the bottle is lifted onto it and one undo takes both back; the Scene panel's +, the
//            viewport's menu on empty space and the command palette add shapes too; an infinity sweep fills the
//            camera's frame (its corners and the middle of its top edge are light in the screenshot, not the dark
//            dome), and after an orbit Fit to camera fills it again in one undo step;
//   editing  the inspector's Primitive section shows the measures; a drag of the Height field regenerates the mesh,
//            is one undo step and the undo tooltip names it; Convert to mesh removes the section (undone: back);
//   scaling  S turns on the Scale tool (pressed in the view bar, the tooltip says S): its gizmo has the scale cubes and
//            the dot and no arrow, ring or plane; a drag of a cube scales along its axis about the pivot (the
//            inspector shows it live), Shift snaps to tenths, the dot scales all three; each drag is one undo step;
//            Esc leaves the tool; right click ▸ Scale… on the viewport and on the tree opens our own panel: to size
//            (height in mm with the proportions locked), uniform, and Reset scale;
//   full     the same adding, editing and scaling in Full mode, and a converged render of a pedestal and a sweep that
//            fills the frame.
//
// Screenshots (docs/ui): primitives-add-menu.png, primitives-base-box.png, primitives-pedestal.png,
// primitives-pedestal-full.png (Full, converged), primitive-inspector.png, scale-tool.png, scale-panel.png.
// Results: out/primitives-check.json.

import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4188;

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const BASE = opt('url', null);
const SHOTS = resolve(ROOT, opt('shots', 'docs/ui'));
const ONLY = opt('only', 'fast,full').split(',');
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

const settle = (page, ms = 60) => page.evaluate((wait) => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, wait)))), ms);
const ok = (cond, text, failures) => {
  if (!cond) failures.push(text);
  return cond;
};
const near = (a, b, eps) => Math.abs(Number(a) - Number(b)) <= eps;

/** What the page shows: tree rows, the undo tooltip, the Primitive section's measures, the part's transform. */
const state = (page) =>
  page.evaluate(() => {
    const num = (el) => (el ? Number(el.getAttribute('aria-valuenow')) : null);
    const rows3 = [...document.querySelectorAll('[data-field="transform"] .field-row3')];
    const triple = (row) => (row ? [...row.querySelectorAll('.num')].map(num) : null);
    const prim = {};
    for (const r of document.querySelectorAll('[data-field="primitive"] [data-param]')) prim[r.getAttribute('data-param')] = num(r.querySelector('.num'));
    return {
      tree: [...document.querySelectorAll('.tree-row .tree-name')].map((n) => n.textContent),
      selected: [...document.querySelectorAll('.tree-row.is-selected .tree-name')].map((n) => n.textContent),
      undo: document.querySelector('.hdr button[aria-label="Undo"]')?.getAttribute('data-tip') ?? null,
      crumb: document.querySelector('.crumbs')?.textContent ?? '',
      primitive: document.querySelector('[data-field="primitive"]') ? prim : null,
      kind: document.querySelector('[data-field="primitive"]')?.getAttribute('data-kind') ?? null,
      position: triple(rows3[0]),
      scale: triple(rows3[2]),
      tool: document.querySelector('.ov-tl [data-tool][aria-pressed="true"]')?.getAttribute('data-tool') ?? null,
      size: document.querySelector('.ov-br .aux')?.textContent ?? '',
      meter: document.querySelector('.ov-bl')?.dataset.mode ?? '',
    };
  });

const canvasBox = (page) => page.locator('canvas[aria-label="viewport"]').boundingBox();

async function undo(page) {
  await page.keyboard.press('Control+z');
  await settle(page);
}

async function focusCanvas(page) {
  await page.locator('canvas[aria-label="viewport"]').focus();
}

/** Selects a row of the tree by its name. */
async function pickRow(page, name) {
  await page.locator('.tree-row', { has: page.locator('.tree-name', { hasText: new RegExp(`^${name}$`) }) }).first().click();
  await settle(page);
}

/** Header menu ▸ Add ▸ <name>. */
async function addFromHeader(page, name, shot = null) {
  await page.click('.brand-btn');
  await settle(page);
  await page.locator('.floating > .menu > .menu-item', { hasText: /^Add$/ }).hover();
  await settle(page, 150);
  if (shot) await page.screenshot({ path: shot });
  const entries = await page.locator('.menu-sub .menu-item').allTextContents();
  const heading = await page.locator('.menu-sub .menu-label').allTextContents();
  await page.locator('.menu-sub .menu-item', { hasText: new RegExp(`^${name}$`) }).click();
  await settle(page, 200);
  return { entries, heading };
}

/** Frames the bottle and the base under it, then deselects (no outline over the picture). */
async function frameShot(page, base) {
  await pickRow(page, 'Example bottle');
  await page.keyboard.down('Control');
  await page.locator('.tree-row', { has: page.locator('.tree-name', { hasText: new RegExp(`^${base}$`) }) }).first().click();
  await page.keyboard.up('Control');
  await focusCanvas(page);
  await page.keyboard.press('f');
  await settle(page, 400);
  await page.keyboard.press('Escape');
  await page.mouse.move(10, 500);
  await settle(page, 300);
}

/**
 * How light the output frame is near its corners and the middle of its top edge (0..1), read from a screenshot: the
 * frame is the largest 16:9 rectangle inside the canvas less 24 px a side (camera.ts `outputFrameRect`). A sweep that
 * fills the frame is light there; the dark studio dome is not.
 */
async function frameCornerLight(page) {
  const cb = await canvasBox(page);
  const availW = cb.width - 48;
  const availH = cb.height - 48;
  let w = availW;
  let h = w / (16 / 9);
  if (h > availH) {
    h = availH;
    w = h * (16 / 9);
  }
  const x0 = cb.x + (cb.width - w) / 2;
  const y0 = cb.y + (cb.height - h) / 2;
  const inset = 8;
  const points = [
    [x0 + inset, y0 + inset],
    [x0 + w - inset, y0 + inset],
    [x0 + inset, y0 + h - inset],
    [x0 + w - inset, y0 + h - inset],
    [x0 + w / 2, y0 + inset],
  ];
  const png = (await page.screenshot()).toString('base64');
  return page.evaluate(
    async ({ png, points }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${png}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const g = c.getContext('2d');
      g.drawImage(img, 0, 0);
      return points.map(([x, y]) => {
        const d = g.getImageData(Math.round(x), Math.round(y), 1, 1).data;
        return Math.round(((0.2126 * d[0] + 0.7152 * d[1] + 0.0722 * d[2]) / 255) * 1000) / 1000;
      });
    },
    { png, points },
  );
}

/** The Scene panel's + ▸ <name>. */
async function addFromPlus(page, name) {
  await page.click('[data-add="primitive"]');
  await settle(page);
  await page.locator('.floating .menu-item', { hasText: new RegExp(`^${name}$`) }).click();
  await settle(page, 200);
}

/** Scrubs a number field: a horizontal drag of `dx` pixels (one gesture). */
async function scrub(page, locator, dx, keys = []) {
  const b = await locator.boundingBox();
  const y = b.y + b.height / 2;
  const x = b.x + b.width / 2;
  for (const k of keys) await page.keyboard.down(k);
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(x + (dx * i) / 10, y);
  await page.mouse.up();
  for (const k of keys) await page.keyboard.up(k);
  await settle(page, 150);
}

/** Types a value into a number field (double click, type, Enter). */
async function typeInto(page, locator, value) {
  await locator.dblclick();
  await settle(page);
  await page.keyboard.press('Control+a');
  await page.keyboard.type(String(value));
  await page.keyboard.press('Enter');
  await settle(page, 120);
}

/** The gizmo handle under a point (the viewport says it while the pointer hovers it). */
async function handleAt(page, p) {
  await page.mouse.move(p.x, p.y);
  await settle(page, 30);
  return page.evaluate(() => {
    const vp = document.querySelector('main.vp');
    return vp?.getAttribute('data-gizmo') === 'hover' ? vp.getAttribute('data-gizmo-handle') : null;
  });
}

/** Points where each handle is, found by looking around `centre` on rings (the gizmo is about 92 px long). */
async function findHandles(page, centre) {
  const found = {};
  const c = await handleAt(page, centre);
  if (c) found[c] = centre;
  for (const r of [86, 80, 92, 70, 55, 40, 110, 120]) {
    for (let a = 0; a < 360; a += 5) {
      const p = { x: centre.x + r * Math.cos((a * Math.PI) / 180), y: centre.y - r * Math.sin((a * Math.PI) / 180) };
      const h = await handleAt(page, p);
      if (h && !found[h]) found[h] = p;
    }
    if (found.sx && found.sy && found.sz && found.su) break;
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
  await settle(page, 150);
}

async function waitFull(page) {
  await page.waitForFunction(() => document.querySelector('.ov-bl')?.dataset.mode === 'full', null, { timeout: 90000 });
}

/** Waits until the Full viewport has at least `n` samples of the current scene. */
async function waitSamples(page, n, ms = 240000) {
  await page.waitForFunction(
    (want) => {
      const m = document.querySelector('.ov-bl');
      return m && m.dataset.mode === 'full' && Number(m.dataset.samples) >= want && m.dataset.shownKey === m.dataset.wantKey;
    },
    n,
    { timeout: ms, polling: 500 },
  );
}

// ------------------------------------------------------------------ the checks

async function addingAndEditing(browser, mode, name) {
  const { page, context, errors } = await open(browser, `example=1&theme=dark&mode=${mode}`);
  const f = [];
  const log = {};
  if (mode === 'full') await waitFull(page);
  const shot = (file) => (mode === 'fast' ? join(SHOTS, file) : join(OUT, file.replace('.png', '-full.png')));

  // The header's menu: Add ▸ Primitive with the twelve shapes; a Box goes under the bottle as its base.
  await pickRow(page, 'Example bottle');
  let s = await state(page);
  const z0 = s.position[2];
  const before = s.tree.length;
  const menu = await addFromHeader(page, 'Box', shot('primitives-add-menu.png'));
  const SHAPES = ['Box', 'Plane', 'Disc', 'Cylinder', 'Pedestal', 'Sphere', 'Cone', 'Torus', 'Capsule', 'Tube', 'Steps', 'Infinity sweep'];
  ok(menu.heading.join() === 'Primitive' && menu.entries.join() === SHAPES.join(), `Add ▸: ${menu.heading} / ${menu.entries}`, f);
  s = await state(page);
  ok(s.tree.length === before + 1 && s.tree.includes('Box'), `Add ▸ Box did not add a Box: ${s.tree}`, f);
  ok(s.undo === 'Undo: Add Box under Example bottle', `the undo of Add Box: ${s.undo}`, f);
  ok(s.kind === 'BOX' && s.primitive && near(s.primitive.width, 88.5, 0.06) && near(s.primitive.height, 18.2, 0.06), `the Primitive section of the base: ${JSON.stringify(s.primitive)}`, f);
  log.base = s.primitive;
  // The bottle sits on top: its model is 18.2 mm up (it stood on the floor).
  await pickRow(page, 'Example bottle');
  s = await state(page);
  ok(s.position && near(s.position[2] - z0, 18.2, 0.01), `the bottle was not lifted onto the base: ${z0} → ${s.position}`, f);
  log.lift = [z0, s.position?.[2]];
  // One undo takes back both.
  await undo(page);
  s = await state(page);
  ok(!s.tree.includes('Box') && s.position && near(s.position[2], z0, 1e-6), `one undo did not take back the base and the lift: ${s.tree} ${s.position}`, f);
  await page.keyboard.press('Control+Shift+z');
  await settle(page);

  // The viewport's menu on empty space (the left edge of the canvas, beside the bottle), the palette and the Scene
  // panel's + add shapes too.
  const cb = await canvasBox(page);
  await page.mouse.click(cb.x + 30, cb.y + cb.height / 2, { button: 'right' });
  await settle(page);
  const emptyMenu = await page.locator('.floating .menu-item').allTextContents();
  ok(emptyMenu.some((t) => /^Add/.test(t)), `the viewport's menu on empty space has no Add: ${emptyMenu}`, f);
  await page.locator('.floating > .menu > .menu-item', { hasText: /^Add$/ }).hover();
  await settle(page, 150);
  await page.locator('.menu-sub .menu-item', { hasText: /^Torus$/ }).click();
  await settle(page, 200);
  s = await state(page);
  ok(s.tree.includes('Torus') && s.kind === 'TORUS', `the viewport's Add ▸ Torus: ${s.tree}`, f);
  await page.keyboard.press('Control+k');
  await settle(page);
  await page.keyboard.type('add cylinder');
  await settle(page, 150);
  await page.keyboard.press('Enter');
  await settle(page, 200);
  s = await state(page);
  ok(s.tree.includes('Cylinder'), `the palette's Add cylinder: ${s.tree}`, f);
  await addFromPlus(page, 'Infinity sweep');
  s = await state(page);
  ok(s.tree.includes('Infinity sweep') && s.kind === 'SWEEP', `+ ▸ Infinity sweep: ${s.tree} ${s.kind}`, f);
  if (mode === 'fast') {
    // The picture: the bottle on its base, the sweep behind (the torus and the cylinder out of the way).
    for (const n of ['Torus', 'Cylinder']) {
      await pickRow(page, n);
      await page.keyboard.press('h');
      await settle(page);
    }
    await frameShot(page, 'Box');
    await page.screenshot({ path: shot('primitives-base-box.png') });
    const light = await frameCornerLight(page);
    ok(light.every((v) => v > 0.45), `the sweep does not fill the frame (corner lightness ${light})`, f);
    log.frameLight = light;
  }

  // Editing the measures: a drag of the Height field is one undo step, and the bounds follow.
  await pickRow(page, 'Box');
  const heightField = page.locator('[data-field="primitive"] [data-param="height"] .num');
  const h0 = (await state(page)).primitive.height;
  await scrub(page, heightField, 30);
  s = await state(page);
  ok(s.primitive.height > h0 + 10, `the Height drag did not change it: ${h0} → ${s.primitive.height}`, f);
  ok(s.undo === 'Undo: Change Height of Box', `the undo of the drag: ${s.undo}`, f);
  log.height = [h0, s.primitive.height];
  await undo(page);
  s = await state(page);
  ok(near(s.primitive.height, h0, 1e-6), `one undo did not take the whole drag back: ${s.primitive.height}`, f);
  // Typed: the bevel.
  await typeInto(page, page.locator('[data-field="primitive"] [data-param="bevel"] .num'), 4);
  s = await state(page);
  ok(near(s.primitive.bevel, 4, 1e-6), `typing the bevel: ${s.primitive.bevel}`, f);
  await undo(page);
  // Convert to mesh: the section goes; undo brings it back.
  await page.click('[data-action="primitive.convert"]');
  await settle(page, 150);
  s = await state(page);
  ok(s.primitive === null && s.undo === 'Undo: Convert Box to a mesh', `Convert to mesh: ${JSON.stringify(s.primitive)} ${s.undo}`, f);
  await undo(page);
  s = await state(page);
  ok(s.primitive !== null, 'undoing Convert to mesh did not bring the Primitive section back', f);
  if (mode === 'fast') {
    // The inspector of a pedestal with a sweep behind (a fresh scene).
    await page.goto(`${BASE_URL}/?example=1&theme=dark&mode=fast`);
    await page.waitForSelector('#app[data-ready="1"]', { timeout: 60000 });
    await addFromHeader(page, 'Pedestal');
    await addFromHeader(page, 'Infinity sweep');
    await frameShot(page, 'Pedestal');
    await page.screenshot({ path: shot('primitives-pedestal.png') });
    const light = await frameCornerLight(page);
    ok(light.every((v) => v > 0.45), `the sweep does not fill the frame behind the pedestal (corner lightness ${light})`, f);
    await pickRow(page, 'Pedestal');
    await page.mouse.move(10, 500);
    await settle(page, 300);
    s = await state(page);
    ok(s.kind === 'PEDESTAL' && s.primitive && near(s.primitive.radius, 44.2, 0.2), `the pedestal under the bottle: ${JSON.stringify(s.primitive)}`, f);
    await page.screenshot({ path: shot('primitive-inspector.png') });
    // Orbit away and Fit to camera: one undo step, and the frame is filled again.
    await focusCanvas(page);
    const cb2 = await canvasBox(page);
    await page.mouse.move(cb2.x + cb2.width * 0.35, cb2.y + cb2.height * 0.5);
    await page.mouse.down();
    await page.mouse.move(cb2.x + cb2.width * 0.6, cb2.y + cb2.height * 0.5, { steps: 10 });
    await page.mouse.up();
    await settle(page, 300);
    await pickRow(page, 'Infinity sweep');
    await page.click('[data-action="primitive.fit"]');
    await settle(page, 300);
    s = await state(page);
    ok(s.undo === 'Undo: Fit Infinity sweep to the camera', `the undo of Fit to camera: ${s.undo}`, f);
    await focusCanvas(page);
    await page.keyboard.press('Escape');
    await page.mouse.move(10, 500);
    await settle(page, 300);
    const refit = await frameCornerLight(page);
    ok(refit.every((v) => v > 0.45), `Fit to camera after an orbit does not fill the frame (corner lightness ${refit})`, f);
    log.refitLight = refit;
  }
  ok(errors.length === 0, `errors in the page: ${errors.join(' | ')}`, f);
  await context.close();
  results[name] = { ok: f.length === 0, failures: f, ...log };
  console.log(`${name}: ${f.length === 0 ? 'OK' : `FAILED\n  - ${f.join('\n  - ')}`}`);
}

async function scaling(browser, mode, name) {
  // An empty scene: the box is the only thing (100 mm a side, at the origin), nothing stands in front of it.
  const { page, context, errors } = await open(browser, `theme=dark&mode=${mode}`);
  const f = [];
  const log = {};
  if (mode === 'full') await waitFull(page);
  const shot = (file) => (mode === 'fast' ? join(SHOTS, file) : join(OUT, file.replace('.png', '-full.png')));
  await addFromPlus(page, 'Box');
  // Frame the box: its pivot (the centre of its bounds) is then the middle of the canvas.
  await page.locator('.tree-row', { has: page.locator('.tree-name', { hasText: /^Box$/ }) }).dblclick();
  await settle(page, 300);
  await focusCanvas(page);
  await page.keyboard.press('s');
  await settle(page);
  let s = await state(page);
  ok(s.tool === 'scale', `S did not turn on the Scale tool: ${s.tool}`, f);
  const tip = await page.locator('.ov-tl [data-tool="scale"]').getAttribute('data-tip');
  const kbd = await page.locator('.ov-tl [data-tool="scale"]').getAttribute('data-kbd');
  ok(/^Scale · /.test(tip ?? '') && kbd === 'S', `the Scale tool's tooltip: "${tip}" ${kbd}`, f);
  // Pan comes right before it in the view bar.
  const order = await page.locator('.ov-tl [data-tool]').evaluateAll((els) => els.map((e) => e.getAttribute('data-tool')));
  ok(order.indexOf('scale') === order.indexOf('pan') + 1, `the Scale tool is not next to Pan: ${order}`, f);
  const cb = await canvasBox(page);
  const centre = { x: cb.x + cb.width / 2, y: cb.y + cb.height / 2 };
  const handles = await findHandles(page, centre);
  log.handles = Object.keys(handles).sort();
  ok(['su', 'sx', 'sy', 'sz'].every((h) => handles[h]), `the scale handles were not all found: ${log.handles}`, f);
  ok(Object.keys(handles).every((h) => h.startsWith('s')), `the Scale tool shows other handles: ${log.handles}`, f);
  if (handles.sx) {
    // Hover a cube (it lights up) for the picture.
    await handleAt(page, handles.sx);
    await page.screenshot({ path: shot('scale-tool.png') });
    // A drag of the X cube outwards: X grows, Y and Z do not; one undo step.
    const out = { x: handles.sx.x + (handles.sx.x - centre.x) * 0.6, y: handles.sx.y + (handles.sx.y - centre.y) * 0.6 };
    await dragFrom(page, handles.sx, out);
    s = await state(page);
    ok(s.scale && s.scale[0] > 1.2 && s.scale[1] === 1 && s.scale[2] === 1, `the X cube: scale ${s.scale}`, f);
    ok(s.undo === 'Undo: Scale Box', `the undo of the drag: ${s.undo}`, f);
    log.dragX = s.scale;
    await undo(page);
    s = await state(page);
    ok(s.scale && s.scale.every((v) => v === 1), `one undo did not take the drag back: ${s.scale}`, f);
    // With Shift: tenths.
    await dragFrom(page, handles.sx, out, ['Shift']);
    s = await state(page);
    ok(s.scale && Math.abs(s.scale[0] * 10 - Math.round(s.scale[0] * 10)) < 1e-6 && s.scale[0] > 1, `Shift did not snap to tenths: ${s.scale}`, f);
    await undo(page);
  }
  if (handles.su) {
    await dragFrom(page, handles.su, { x: handles.su.x + 60, y: handles.su.y });
    s = await state(page);
    ok(s.scale && s.scale[0] > 1.2 && s.scale[0] === s.scale[1] && s.scale[1] === s.scale[2], `the dot did not scale all three alike: ${s.scale}`, f);
    log.dragU = s.scale;
    await undo(page);
  }
  // Esc leaves the tool.
  await focusCanvas(page);
  await page.keyboard.press('Escape');
  await settle(page);
  s = await state(page);
  ok(s.tool === 'select', `Esc did not leave the Scale tool: ${s.tool}`, f);

  // Right click ▸ Scale… on the box in the viewport: to size, the height in mm with the proportions locked.
  await page.mouse.click(centre.x, centre.y, { button: 'right' });
  await settle(page);
  await page.locator('.floating .menu-item', { hasText: /^Scale…$/ }).click();
  await settle(page, 150);
  const panel = page.locator('[data-panel="scale"]');
  ok(await panel.isVisible(), 'Scale… did not open the panel', f);
  await panel.locator('.seg button', { hasText: /^To size$/ }).click();
  await settle(page);
  const pressed = await panel.locator('.seg button[aria-pressed="true"]').allTextContents();
  ok(pressed.join() === 'To size', `the panel's mode shows ${pressed}`, f);
  if (mode === 'fast') await page.screenshot({ path: shot('scale-panel.png') });
  await typeInto(page, panel.locator('[data-field="scale.size2"]'), 200);
  const w = await panel.locator('[data-field="scale.size0"]').getAttribute('aria-valuenow');
  ok(near(w, 200, 0.05), `the width did not follow the height with the proportions locked: ${w}`, f);
  await panel.locator('[data-action="scale.apply"]').click();
  await settle(page, 150);
  s = await state(page);
  ok(s.scale && s.scale.every((v) => near(v, 2, 1e-3)), `to size 200 mm high (twice): scale ${s.scale}`, f);
  ok(s.undo === 'Undo: Scale Box', `the undo of Scale…: ${s.undo}`, f);
  ok(!(await panel.isVisible().catch(() => false)), 'the panel stayed open after Apply', f);
  // On the tree: uniform 50 %, then Reset scale.
  await page.locator('.tree-row', { has: page.locator('.tree-name', { hasText: /^Box$/ }) }).click({ button: 'right' });
  await settle(page);
  await page.locator('.floating .menu-item', { hasText: /^Scale…$/ }).click();
  await settle(page, 150);
  await panel.locator('.seg button', { hasText: /^Uniform$/ }).click();
  await typeInto(page, panel.locator('[data-field="scale.uniform"]'), 50);
  await panel.locator('[data-action="scale.apply"]').click();
  await settle(page, 150);
  s = await state(page);
  ok(s.scale && s.scale.every((v) => near(v, 1, 1e-3)), `uniform 50 % of 200 %: scale ${s.scale}`, f);
  await page.locator('.tree-row', { has: page.locator('.tree-name', { hasText: /^Box$/ }) }).click({ button: 'right' });
  await settle(page);
  await page.locator('.floating .menu-item', { hasText: /^Scale…$/ }).click();
  await settle(page, 150);
  await panel.locator('.seg button', { hasText: /^Per axis$/ }).click();
  await typeInto(page, panel.locator('[data-field="scale.z"]'), 300);
  await panel.locator('[data-action="scale.apply"]').click();
  await settle(page, 150);
  s = await state(page);
  ok(s.scale && near(s.scale[2], 3, 1e-3) && near(s.scale[0], 1, 1e-3), `per axis Z 300 %: scale ${s.scale}`, f);
  await page.locator('.tree-row', { has: page.locator('.tree-name', { hasText: /^Box$/ }) }).click({ button: 'right' });
  await settle(page);
  await page.locator('.floating .menu-item', { hasText: /^Scale…$/ }).click();
  await settle(page, 150);
  await panel.locator('[data-action="scale.reset"]').click();
  await settle(page, 150);
  s = await state(page);
  ok(s.scale && s.scale.every((v) => v === 1) && s.undo === 'Undo: Reset the scale of Box', `Reset scale: ${s.scale} ${s.undo}`, f);
  // Esc closes the panel.
  await page.locator('.tree-row', { has: page.locator('.tree-name', { hasText: /^Box$/ }) }).click({ button: 'right' });
  await settle(page);
  await page.locator('.floating .menu-item', { hasText: /^Scale…$/ }).click();
  await settle(page, 150);
  await page.keyboard.press('Escape');
  await settle(page);
  ok(!(await panel.isVisible().catch(() => false)), 'Esc did not close the panel', f);
  ok(errors.length === 0, `errors in the page: ${errors.join(' | ')}`, f);
  await context.close();
  results[name] = { ok: f.length === 0, failures: f, ...log };
  console.log(`${name}: ${f.length === 0 ? 'OK' : `FAILED\n  - ${f.join('\n  - ')}`}`);
}

/** A converged Full render of the bottle on a pedestal with an infinity sweep behind. */
async function fullRender(browser) {
  const { page, context, errors } = await open(browser, 'example=1&theme=dark&mode=full');
  const f = [];
  await waitFull(page);
  await addFromHeader(page, 'Pedestal');
  await addFromHeader(page, 'Infinity sweep');
  // Nothing selected: no outline over the render.
  await frameShot(page, 'Pedestal');
  try {
    await waitSamples(page, 48);
  } catch {
    f.push('the Full viewport did not reach 48 samples');
  }
  const meter = await page.evaluate(() => ({ ...document.querySelector('.ov-bl').dataset }));
  await page.screenshot({ path: join(SHOTS, 'primitives-pedestal-full.png') });
  const light = await frameCornerLight(page);
  ok(light.every((v) => v > 0.3), `the sweep does not fill the Full frame (corner lightness ${light})`, f);
  ok(errors.length === 0, `errors in the page: ${errors.join(' | ')}`, f);
  await context.close();
  results.render = { ok: f.length === 0, failures: f, samples: Number(meter.samples), seconds: Number(meter.seconds) };
  console.log(`full render: ${f.length === 0 ? `OK (${meter.samples} samples, ${meter.seconds} s)` : `FAILED\n  - ${f.join('\n  - ')}`}`);
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
  if (ONLY.includes('fast')) {
    await addingAndEditing(browser, 'fast', 'adding and editing');
    await scaling(browser, 'fast', 'scaling');
  }
  if (ONLY.includes('full')) {
    if (existsSync(join(ROOT, 'dist', 'engine', 'rt.wasm'))) {
      await addingAndEditing(browser, 'full', 'full adding and editing');
      await scaling(browser, 'full', 'full scaling');
      await fullRender(browser);
    } else {
      results.full = { ok: true, skipped: 'dist/engine/rt.wasm is missing (npm run engine:build)' };
      console.log('full: skipped, no rt.wasm');
    }
  }
  writeFileSync(join(OUT, 'primitives-check.json'), JSON.stringify(results, null, 2));
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
