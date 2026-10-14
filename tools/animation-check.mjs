#!/usr/bin/env node
// Browser check of the animation timeline and the exploded views (phase N6), with the local Chromium and swiftshader.
//
//   npm run build && node tools/animation-check.mjs [--shots docs/ui] [--url http://host:port] [--sheet out/explode-sheet.html]
//
// Without --url it serves dist/ with `vite preview` on port 4192 and stops it at the end.
//
//   (a) the drawer has its three zones: the tree of what is animated, the ruler and the lanes, the properties;
//   (b) "+ Animate…" with the model selected opens the wizard with it as the target (the model as a node: the set's
//       backdrop and floor are roots of the scene too); an explode added there is selected,
//       its row and its bar appear, and the properties' header says "… · Spherical exploded view · … · 0–3 s";
//   (c) the viewport outlines its target and draws its track (the drawer's machine-readable copy of the hint);
//   (d) selecting the cap in the scene marks the explode's row (what moves it);
//   (e) a bar dragged by a hair less than a second lands on the whole second (the magnet), and one undo puts it back;
//   (f) its end stretched to a hair before 4 s lands on 4 s;
//   (g) the keys in the drawer: End, Home, → one frame, Ctrl D duplicates, Delete removes;
//   (h) a clip's context menu has Duplicate, Reverse, Split at the playhead, Pin the selection…, Delete;
//   (i) the part menu's "Pin in the exploded view" makes the cap an exception (the properties list it);
//   (j) every explode type moves the parts (four frames of each, Fast preview captures), and the strips are composed.
//
// Screenshots (English, dark): animation-timeline.png (tree + bars + properties, an explode selected and its track in the
// viewport), explode-types.png (a strip of four frames per type). The sheet for the visual verdict (larger strips and
// a few variants): out/explode-sheet.html. Results: out/animation-check.json.

import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4192;
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const BASE = opt('url', null);
const SHOTS = resolve(ROOT, opt('shots', 'docs/ui'));
const OUT = join(ROOT, 'out');
const SHEET = resolve(ROOT, opt('sheet', 'out/explode-sheet.html'));
mkdirSync(SHOTS, { recursive: true });
mkdirSync(OUT, { recursive: true });

const results = {};
const fail = (msg) => {
  throw new Error(msg);
};
const check = (key, ok, detail = {}) => {
  results[key] = { ok: Boolean(ok), ...detail };
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${key} ${JSON.stringify(detail)}`);
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

/** Two frames and a pause: the interface has drawn what the last action changed. */
const settle = (page, ms = 250) => page.evaluate((wait) => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, wait)))), ms);

let server = null;
let browser = null;
try {
  const chromium = (await import(join(ROOT, 'node_modules', 'playwright-core', 'index.mjs'))).chromium;
  const base = BASE ?? `http://localhost:${PORT}`;
  if (!BASE) {
    if (!existsSync(join(ROOT, 'dist', 'index.html'))) fail('dist/ is missing: run npm run build first');
    stopServer();
    server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: 'ignore', detached: true });
    await waitFor(base);
  }
  browser = await chromium.launch({ executablePath: findChromium(), headless: true, args: ['--no-sandbox', '--disable-gpu', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !m.text().startsWith('Failed to load resource') && errors.push(m.text()));
  await page.goto(`${base}/?example=1&theme=dark&lang=en&mode=fast&drawer=animation`);
  await page.waitForSelector('#app[data-ready="1"]', { timeout: 60000 });
  await settle(page, 800);

  const sceneRow = (name) => page.locator('.side-left .tree-row', { hasText: name }).first();
  const pxPerS = async () => Number(await page.locator('.anim-rows').getAttribute('data-px-per-s'));
  const ruler = async () => (await page.locator('.tl-ruler').boundingBox()) ?? fail('no ruler');
  /** The playhead to time t: a click on the ruler. */
  const seekTo = async (t) => {
    const r = await ruler();
    await page.mouse.click(r.x + t * (await pxPerS()) + 0.5, r.y + 8);
    await settle(page, 150);
  };
  const playhead = async () => Number(await page.locator('.tl-playhead').getAttribute('data-t'));
  const header = async () => (await page.locator('.anim-props-head').first().textContent())?.trim() ?? '';

  // (a) the three zones.
  const zones = await page.evaluate(() => ({
    tree: document.querySelectorAll('.anim-rows .atr').length,
    ruler: document.querySelectorAll('.anim-rows .tl-ruler').length,
    lanes: document.querySelectorAll('.anim-rows .tl-lane').length,
    props: document.querySelectorAll('.anim .anim-props').length,
    camera: document.querySelector('.atr[data-target="CAMERA"]')?.textContent ?? '',
  }));
  check('three_zones', zones.tree >= 1 && zones.ruler === 1 && zones.lanes >= 1 && zones.props === 1 && zones.camera.includes('Camera'), zones);

  // (b) "+ Animate…" with the model selected.
  await sceneRow('Example bottle').click();
  await settle(page);
  const animateLabel = (await page.locator('[data-anim-animate]').textContent())?.trim();
  await page.locator('[data-anim-animate]').click();
  await settle(page);
  const wizardTarget = await page.locator('.wizard .seg button[aria-pressed="true"]').first().textContent();
  const wizardNode = await page.evaluate(() => {
    const sel = document.querySelector('.wizard select[aria-label="Target"]');
    return sel ? sel.options[sel.selectedIndex]?.textContent : null;
  });
  await page.locator('.wizard select[aria-label="How?"]').selectOption('EXPLODE');
  await settle(page);
  await page.locator('[data-wizard-add]').click();
  await settle(page, 400);
  const bars = await page.locator('.tl-lane.is-clip .tl-bar').count();
  const row = (await page.locator('.atr-clip').first().textContent())?.trim();
  const head = await header();
  check('animate_wizard', animateLabel === 'Animate Example bottle…' && wizardTarget?.trim() === 'A part or group' && wizardNode === 'Example bottle' && bars === 1 && row?.startsWith('comes apart from its centre') && head.includes('Spherical exploded view') && head.endsWith('0–3 s'), { animateLabel, wizardTarget, wizardNode, bars, row, head });

  // (c) the viewport: the target outlined and the track drawn.
  const hint = (await page.locator('.anim').getAttribute('data-hint')) ?? '';
  const [outlined, segments, dots] = hint.split(':').map(Number);
  check('viewport_hint', outlined === 5 && segments >= 5 * 3 && dots === 5, { hint });

  // (d) the cap selected in the scene marks the explode's row.
  await sceneRow('Cap').click();
  await settle(page);
  const related = await page.locator('.atr-clip.is-related').count();
  check('scene_marks_rows', related === 1, { related });

  // (e) a bar dragged by about a second lands on 1 s; one undo puts it back.
  const bar = page.locator('.tl-lane.is-clip .tl-bar').first();
  let box = (await bar.boundingBox()) ?? fail('no bar');
  const px = await pxPerS();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(box.x + box.width / 2 + (px * 0.99 * i) / 8, box.y + box.height / 2);
  await page.mouse.up();
  await settle(page);
  const moved = Number(await bar.getAttribute('data-start'));
  await page.keyboard.press('Control+z');
  await settle(page);
  const back = Number(await page.locator('.tl-lane.is-clip .tl-bar').first().getAttribute('data-start'));
  check('drag_snaps_and_undoes', moved === 1 && back === 0, { moved, back });

  // (f) its end stretched near 4 s lands on 4 s.
  box = (await page.locator('.tl-lane.is-clip .tl-bar').first().boundingBox()) ?? fail('no bar');
  await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2);
  await page.mouse.down();
  const r0 = await ruler();
  for (let i = 1; i <= 6; i++) await page.mouse.move(box.x + box.width - 2 + ((r0.x + 3.99 * px - (box.x + box.width - 2)) * i) / 6, box.y + box.height / 2);
  await page.mouse.up();
  await settle(page);
  const end = Number(await page.locator('.tl-lane.is-clip .tl-bar').first().getAttribute('data-end'));
  await page.keyboard.press('Control+z');
  await settle(page);
  check('stretch_snaps', end === 4, { end });

  // (g) the keys, with the focus in the drawer.
  await page.locator('.atr-clip').first().click();
  await settle(page);
  await page.keyboard.press('End');
  await settle(page);
  const atEnd = await playhead();
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowRight');
  await settle(page);
  const oneFrame = await playhead();
  await page.keyboard.press('Control+d');
  await settle(page);
  const afterDup = await page.locator('.tl-lane.is-clip .tl-bar').count();
  await page.keyboard.press('Delete');
  await settle(page);
  const afterDel = await page.locator('.tl-lane.is-clip .tl-bar').count();
  check('keys', atEnd === 3 && Math.abs(oneFrame - 1 / 24) < 1e-9 && afterDup === 2 && afterDel === 1, { atEnd, oneFrame, afterDup, afterDel });

  // (h) a clip's context menu.
  await page.locator('.atr-clip').first().click({ button: 'right' });
  await settle(page);
  const menu = await page.evaluate(() => [...document.querySelectorAll('.menu .menu-item')].map((b) => b.querySelector('span:not(.check):not(.menu-right)')?.textContent ?? ''));
  await page.keyboard.press('Escape');
  check('clip_menu', ['Duplicate', 'Reverse', 'Split at the playhead', 'Pin the selection in this exploded view', 'Delete'].every((x) => menu.includes(x)), { menu });

  // (i) the part menu pins the cap in the exploded view.
  await sceneRow('Cap').click({ button: 'right' });
  await settle(page);
  const pinItem = page.locator('.menu .menu-item', { hasText: 'Pin in the exploded view' });
  const pinShown = await pinItem.count();
  if (pinShown) await pinItem.first().click();
  await settle(page);
  await page.locator('.atr-clip').first().click();
  await settle(page);
  const chips = await page.evaluate(() => [...document.querySelectorAll('.anim-pin')].map((c) => c.textContent?.trim()));
  check('pin_from_part_menu', pinShown === 1 && chips.length === 1 && chips[0] === 'Cap', { chips });
  // Free it again for the strips.
  await page.locator('.anim-pin button').first().click();
  await settle(page);

  // The timeline screenshot: a camera orbit too, the explode selected at 1.2 s with its track in the viewport.
  await page.locator('[data-anim-animate]').click();
  await settle(page);
  await page.locator('.wizard .seg button', { hasText: 'Camera' }).first().click();
  await settle(page);
  await page.locator('[data-wizard-add]').click();
  await settle(page);
  await page.locator('.atr-clip').filter({ hasText: 'comes apart' }).first().click();
  await settle(page);
  // A stack along Z, the classic exploded view of a bottle.
  await page.locator('.anim-props .seg button', { hasText: 'Linear' }).click();
  await settle(page);
  await page.locator('.anim-props .seg button', { hasText: 'Stack' }).click();
  await settle(page);
  await setDistance(page, 0.6);
  await seekTo(1.2);
  // The pointer off the ruler (its tooltip) and the properties from their top.
  await page.mouse.move(60, 900);
  await page.evaluate(() => {
    const p = document.querySelector('.anim-props');
    if (p) p.scrollTop = 0;
  });
  await settle(page, 600);
  await page.screenshot({ path: join(SHOTS, 'animation-timeline.png') });

  // (j) every explode type: four frames, from the viewport.
  // The set's backdrop and floor and the studio floor hide parts that go below the floor: off for the strips, and the
  // camera a little farther so the parts that leave stay in the picture.
  await page.locator('.atr-clip').filter({ hasText: 'orbits' }).first().click();
  await settle(page);
  await page.keyboard.press('Delete');
  await settle(page);
  for (const name of ['Backdrop', 'Set floor']) {
    const r = sceneRow(name);
    if (await r.count()) {
      await r.hover();
      await r.locator('.tree-actions button').first().click();
    }
  }
  await settle(page);
  const vp = (await page.locator('.vp canvas').first().boundingBox()) ?? fail('no viewport');
  await page.mouse.move(vp.x + vp.width / 2, vp.y + vp.height / 2);
  for (let i = 0; i < 4; i++) await page.mouse.wheel(0, 240);
  await settle(page, 400);
  await page.locator('.atr-clip').filter({ hasText: /stacks|comes apart|separates|opens/ }).first().click();
  await settle(page);

  const TYPES = [
    { key: 'linear-separate', label: 'Linear · separate (Z)', set: ['Linear', 'Separate', 'Z'], levels: 'Parts' },
    { key: 'linear-stack', label: 'Linear · stack (Z)', set: ['Linear', 'Stack', 'Z'], levels: 'Parts' },
    { key: 'radial', label: 'Radial (axis Z)', set: ['Radial', 'Z'], levels: 'Parts' },
    { key: 'spherical', label: 'Spherical', set: ['Spherical'], levels: 'Parts' },
    { key: 'levels', label: 'By levels (all, spherical, by depth)', set: ['Spherical'], levels: 'All', order: 'BY_DEPTH' },
  ];
  const EXTRA = [
    { key: 'radial-x', label: 'Radial (axis X)', set: ['Radial', 'X'], levels: 'Parts' },
    { key: 'spherical-even', label: 'Spherical · even spacing', set: ['Spherical', 'Even'], levels: 'Parts' },
    { key: 'levels-one', label: 'One level (the closure as a block)', set: ['Spherical', 'By distance'], levels: 'One level' },
    { key: 'stack-free', label: 'Linear · stack, orientation free', set: ['Linear', 'Stack', 'Z'], levels: 'Parts', keep: false },
  ];
  const frames = [0, 1, 2, 3];
  const strips = {};
  const moves = {};
  for (const ty of [...TYPES, ...EXTRA]) {
    for (const label of ty.set) await clickSeg(page, label);
    await clickSeg(page, ty.levels);
    await page.locator('.anim-props select[aria-label="Order"]').selectOption(ty.order ?? 'AT_ONCE');
    await setToggle(page, 'Keep the orientation', ty.keep ?? true);
    await settle(page);
    const head = await header();
    // The explode alone: the clip deselected (no outline, no track) and the viewport's overlays hidden.
    const lane = (await page.locator('.tl-lane.is-clip').first().boundingBox()) ?? fail('no lane');
    await page.mouse.click(lane.x + lane.width - 6, lane.y + lane.height / 2);
    await page.evaluate(() => document.querySelectorAll('.vp .ov').forEach((e) => (e.style.visibility = 'hidden')));
    const shots = [];
    for (const t of frames) {
      await seekTo(t);
      await page.mouse.move(60, 900);
      await settle(page, 500);
      const buf = await page.screenshot({ clip: { x: vp.x + vp.width * 0.28, y: vp.y + vp.height * 0.02, width: vp.width * 0.44, height: vp.height * 0.94 } });
      shots.push(buf.toString('base64'));
    }
    await page.evaluate(() => document.querySelectorAll('.vp .ov').forEach((e) => (e.style.visibility = '')));
    await page.locator('.atr-clip').first().click();
    await settle(page);
    strips[ty.key] = { label: ty.label, header: head, shots };
    moves[ty.key] = shots[0] !== shots[3];
  }
  check('explode_types_move', TYPES.every((ty) => moves[ty.key]), { moves });

  // The strips, composed by the browser itself: docs/ui/explode-types.png and the sheet.
  const stripHtml = (keys, w) =>
    keys
      .map((k) => {
        const s = strips[k];
        return `<section><h2>${s.label}</h2><p>${s.header}</p><div class="row">${s.shots.map((b, i) => `<figure><img src="data:image/png;base64,${b}" width="${w}"><figcaption>t = ${frames[i]} s</figcaption></figure>`).join('')}</div></section>`;
      })
      .join('\n');
  const css = (w) => `body{margin:0;padding:16px;background:#111;color:#ddd;font:13px Inter,system-ui,sans-serif}h1{font-size:16px;margin:0 0 4px}h2{font-size:13px;margin:12px 0 2px}p{margin:0 0 6px;color:#999;font-size:12px}.row{display:flex;gap:6px}figure{margin:0}figcaption{color:#888;font-size:11px;text-align:center}img{display:block;width:${w}px;border:1px solid #333}`;
  const strip = await context.newPage();
  await strip.setViewportSize({ width: 4 * 186 + 3 * 6 + 32, height: 400 });
  await strip.setContent(`<!doctype html><html><head><style>${css(186)}</style></head><body><h1>Exploded views of the example bottle · Fast preview</h1>${stripHtml(TYPES.map((t) => t.key), 186)}</body></html>`);
  await strip.waitForTimeout(300);
  await strip.screenshot({ path: join(SHOTS, 'explode-types.png'), fullPage: true });
  await strip.close();
  const sheet = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Exploded views · N6 sheet</title><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css(300)}.note{max-width:1260px;color:#bbb;line-height:1.45}</style></head><body>
<h1>Exploded views of the example bottle (phase N6) · for the lead's verdict</h1>
<p class="note">Four frames (t = 0, 1, 2, 3 s) of one 3 s explode on the whole model, 0.6 × size, smoothness 50 %, captured from the Fast preview (swiftshader) with the set's backdrop and floor hidden. The defaults of a new explode are Spherical, Parts, By distance, Of the whole, At once; choose the look. The radial explode about Z moves only the label: every other part of the bottle sits on the axis. Variants after the five types: radial about X, spherical with even spacing (the explode of before N6), one level, and a stack with the orientation free.</p>
${stripHtml([...TYPES, ...EXTRA].map((t) => t.key), 300)}
</body></html>
`;
  mkdirSync(dirname(SHEET), { recursive: true });
  writeFileSync(SHEET, sheet);
  console.log(`sheet: ${SHEET}`);

  check('no_errors', errors.length === 0, { errors });
} finally {
  writeFileSync(join(OUT, 'animation-check.json'), JSON.stringify(results, null, 2) + '\n');
  await browser?.close();
  if (server) {
    try {
      process.kill(-server.pid);
    } catch {
      stopServer();
    }
  }
}

const failed = Object.entries(results).filter(([, r]) => !r.ok);
if (failed.length) {
  console.error(`${failed.length} check(s) failed: ${failed.map(([k]) => k).join(', ')}`);
  process.exit(1);
}

/** A button of a segmented control in the properties, by its text (exactly). */
async function clickSeg(page, text) {
  const b = page.locator('.anim-props .seg button').filter({ hasText: new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) });
  if ((await b.count()) === 0) return;
  if ((await b.first().getAttribute('aria-pressed')) !== 'true') await b.first().click();
  await settle(page);
}

async function setToggle(page, label, on) {
  const t = page.locator(`.anim-props .toggle[aria-label="${label}"]`);
  if ((await t.count()) === 0) return;
  if (((await t.first().getAttribute('aria-checked')) === 'true') !== on) await t.first().click();
  await settle(page);
}

/** The explode's distance field: double click, type, Enter. */
async function setDistance(page, v) {
  const f = page.locator('.anim-props [role="spinbutton"][aria-label="Distance"]').first();
  await f.dblclick();
  await page.keyboard.press('Control+a');
  await page.keyboard.type(String(v));
  await page.keyboard.press('Enter');
  await settle(page);
}

void readFileSync;
