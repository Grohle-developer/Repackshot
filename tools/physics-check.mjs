#!/usr/bin/env node
// Browser check of phase S2 in the built app (rigid bodies: Drop, the physics bar, the recorded clip), with the
// local Chromium and swiftshader, in Fast mode.
//
//   npm run engine:build && npm run build && node tools/physics-check.mjs [--url http://localhost:4189] [--shots docs/ui]
//
// Without --url it serves dist/ with `vite preview` on port 4189 and stops it at the end. The simulator needs
// dist/engine/rt.wasm; without it the check fails and says so.
//
//   default  the physics bar opens from the bottom bar, stopped, with nothing simulated yet;
//   drop     three primitives (a box tilted, a ball and a cylinder lying on its side) in the air; right click on the
//            tree ▸ Drop: the bar opens, runs (the time and the bodies awake as the simulator reports them, Pause
//            freezes it and Resume goes on) and stops by itself when everything sleeps; the three rest on the floor
//            (their lowest points at z = 0 within 1 mm, read from the inspector's transform and the primitives'
//            measures); the animation has one Physics clip per part; one undo step (Undo: Drop 3 parts);
//   strip    the clip played back at six instants, the parts falling in the viewport;
//   reset    ↺ Reset takes the clips away and puts the parts back in the air; one undo brings the drop back.
//
// Screenshots (docs/ui): physics-bar.png (the bar paused in the middle of the fall), physics-drop.png (before and after, side by side),
// physics-drop-strip.png (six frames of the recorded clip). Results: out/physics-check.json.

import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4189;

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const SHOTS = resolve(ROOT, opt('shots', 'docs/ui'));
const OUT = join(ROOT, 'out');
mkdirSync(OUT, { recursive: true });
mkdirSync(SHOTS, { recursive: true });
let BASE_URL = opt('url', null);

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

const settle = (page, ms = 60) => page.evaluate((wait) => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, wait)))), ms);
const ok = (cond, text, failures) => {
  if (!cond) failures.push(text);
  return cond;
};

async function pickRow(page, name, add = false) {
  const row = page.locator('.tree-row', { has: page.locator('.tree-name', { hasText: new RegExp(`^${name}$`) }) }).first();
  if (add) await page.keyboard.down('Control');
  await row.click();
  if (add) await page.keyboard.up('Control');
  await settle(page);
  return row;
}

async function addFromHeader(page, name) {
  await page.click('.brand-btn');
  await settle(page);
  await page.locator('.floating > .menu > .menu-item', { hasText: /^Add$/ }).hover();
  await settle(page, 150);
  await page.locator('.menu-sub .menu-item', { hasText: new RegExp(`^${name}$`) }).click();
  await settle(page, 200);
}

async function typeInto(page, locator, value) {
  await locator.dblclick();
  await settle(page);
  await page.keyboard.press('Control+a');
  await page.keyboard.type(String(value));
  await page.keyboard.press('Enter');
  await settle(page, 120);
}

/** Position and rotation of the selected node, as the inspector shows them. */
const transform = (page) =>
  page.evaluate(() => {
    const rows = [...document.querySelectorAll('[data-field="transform"] .field-row3')];
    const triple = (row) => (row ? [...row.querySelectorAll('.num')].map((n) => Number(n.getAttribute('aria-valuenow'))) : null);
    return { position: triple(rows[0]), rotation: triple(rows[1]) };
  });

/** The selected part's lowest point, from its position, rotation and the primitive's measures. */
async function lowest(page, kind) {
  const t = await transform(page);
  const p = await page.evaluate(() => {
    const out = {};
    for (const r of document.querySelectorAll('[data-field="primitive"] [data-param]')) out[r.getAttribute('data-param')] = Number(r.querySelector('.num').getAttribute('aria-valuenow'));
    return out;
  });
  const [rx, ry, rz] = t.rotation.map((d) => (d * Math.PI) / 180);
  // Rows of R = Rx Ry Rz (the scene's XYZ convention); the lowest z is centre z minus the support along -Z.
  const c = Math.cos;
  const s = Math.sin;
  const r20 = s(rx) * s(rz) - c(rx) * s(ry) * c(rz);
  const r21 = s(rx) * c(rz) + c(rx) * s(ry) * s(rz);
  const r22 = c(rx) * c(ry);
  let support;
  if (kind === 'SPHERE') support = p.radius;
  else if (kind === 'BOX') support = (Math.abs(r20) * p.width + Math.abs(r21) * p.depth + Math.abs(r22) * p.height) / 2;
  else support = p.radius * Math.hypot(r20, r21) + (Math.abs(r22) * p.height) / 2; // a cylinder, axis Z
  return { z: t.position[2] - support, t };
}

const physicsUi = (page) =>
  page.evaluate(() => ({
    state: document.querySelector('[data-field="phys.state"]')?.textContent ?? null,
    time: document.querySelector('[data-field="phys.time"]')?.textContent ?? '',
    awake: document.querySelector('[data-field="phys.awake"]')?.textContent ?? '',
    start: document.querySelector('[data-action="phys.start"]')?.disabled ?? null,
    pause: document.querySelector('[data-action="phys.pause"]')?.textContent ?? null,
    stop: document.querySelector('[data-action="phys.stop"]')?.disabled ?? null,
    reset: document.querySelector('[data-action="phys.reset"]')?.disabled ?? null,
    undo: document.querySelector('.hdr button[aria-label="Undo"]')?.getAttribute('data-tip') ?? null,
  }));

async function canvasShot(page) {
  const box = await page.locator('canvas[aria-label="viewport"]').boundingBox();
  return page.screenshot({ clip: box });
}

/** Lays images side by side (with captions) in a blank page and returns its screenshot. */
async function strip(browser, images, captions, width) {
  const context = await browser.newContext({ viewport: { width: 400, height: 300 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const cells = images.map((png, i) => `<figure><img src="data:image/png;base64,${png.toString('base64')}" style="width:${width}px"><figcaption>${captions[i]}</figcaption></figure>`).join('');
  await page.setContent(`<!doctype html><html><body style="margin:0;background:#111;color:#ccc;font:13px system-ui,sans-serif"><div id="s" style="display:inline-flex;gap:8px;padding:8px">${cells}</div><style>figure{margin:0}figcaption{padding:4px 0 0;text-align:center}</style></body></html>`);
  await page.waitForFunction(() => [...document.images].every((i) => i.complete));
  const png = await page.locator('#s').screenshot();
  await context.close();
  return png;
}

async function main() {
  const { chromium } = await import('playwright-core');
  let server = null;
  if (!BASE_URL) {
    if (!existsSync(join(ROOT, 'dist', 'index.html'))) fail('dist/ is missing: npm run build');
    if (!existsSync(join(ROOT, 'dist', 'engine', 'rt.wasm'))) fail('dist/engine/rt.wasm is missing: npm run engine:build && npm run build');
    stopServer();
    server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: 'ignore' });
    BASE_URL = `http://localhost:${PORT}`;
    await waitFor(BASE_URL);
  }
  const browser = await chromium.launch({ executablePath: findChromium(), args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const f = [];
  const log = {};
  try {
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && !m.text().startsWith('Failed to load resource') && errors.push(m.text()));
    await page.goto(`${BASE_URL}/?theme=dark&mode=fast&tour=0`);
    await page.waitForSelector('#app[data-ready="1"]', { timeout: 90000 });

    // default: the bar opens stopped, nothing simulated yet.
    await page.click('.drawer-btn[data-drawer="physics"]');
    await settle(page, 150);
    let p = await physicsUi(page);
    log.default = p;
    ok(p.state === 'Stopped' && p.time === '' && p.awake === '' && p.stop === true && p.reset === true, `the bar at first: ${JSON.stringify(p)}`, f);

    // Three primitives in the air.
    const parts = [
      { name: 'Box', kind: 'BOX', z: 160, rot: [25, 10, 0] },
      { name: 'Sphere', kind: 'SPHERE', z: 260, rot: [0, 0, 0] },
      { name: 'Cylinder', kind: 'CYLINDER', z: 150, rot: [80, 0, 15] },
    ];
    for (const part of parts) {
      await addFromHeader(page, part.name);
      const rows = page.locator('[data-field="transform"] .field-row3');
      await typeInto(page, rows.nth(0).locator('.num').nth(2), part.z);
      for (let k = 0; k < 3; k++) if (part.rot[k]) await typeInto(page, rows.nth(1).locator('.num').nth(k), part.rot[k]);
    }
    // Frame them all, then nothing selected (no outline over the picture).
    await pickRow(page, 'Box');
    await pickRow(page, 'Sphere', true);
    await pickRow(page, 'Cylinder', true);
    await page.locator('canvas[aria-label="viewport"]').focus();
    await page.keyboard.press('f');
    await settle(page, 400);
    for (const part of parts) {
      await pickRow(page, part.name);
      part.before = await lowest(page, part.kind);
    }
    log.before = parts.map((x) => ({ name: x.name, lowest: x.before.z }));
    await page.keyboard.press('Escape');
    await page.mouse.move(10, 500);
    await settle(page, 400);
    const before = await canvasShot(page);

    // drop: right click on the tree ▸ Drop, the three selected.
    await pickRow(page, 'Box');
    await pickRow(page, 'Sphere', true);
    const row = await pickRow(page, 'Cylinder', true);
    await row.click({ button: 'right' });
    await settle(page, 150);
    const drop = page.locator('.floating .menu-item', { hasText: /^Drop/ });
    ok((await drop.count()) === 1, 'the context menu has no Drop', f);
    // A trace of what the bar says, kept in out/physics-check.json.
    await page.evaluate(() => {
      const trace = (window.__physTrace = []);
      const read = () => {
        const q = (k) => document.querySelector(`[data-field="${k}"]`)?.textContent ?? '';
        const line = [Math.round(performance.now()), q('phys.state'), q('phys.time'), q('phys.awake')];
        const last = trace[trace.length - 1];
        if (!last || last.slice(1).join('|') !== line.slice(1).join('|')) trace.push(line);
        // Pause from inside the page as soon as 0.1 s is simulated: a click from outside comes too late on a busy
        // main thread (three primitives sleep within a second of simulated time).
        const time = Number((line[2].match(/[0-9.]+/) ?? ['0'])[0]);
        if (!window.__physPaused && line[1] === 'Running' && time >= 0.1) {
          window.__physPaused = line;
          document.querySelector('[data-action="phys.pause"]').click();
        }
      };
      new MutationObserver(read).observe(document.querySelector('.phys'), { subtree: true, childList: true, characterData: true });
    });
    await drop.first().click();
    await page.waitForFunction(() => document.querySelector('[data-field="phys.state"]')?.textContent === 'Paused', null, { timeout: 60000 });
    p = await page.evaluate(() => window.__physPaused);
    log.running = p;
    ok(/of 3 awake/.test(p[3]), `the bar while it runs: ${JSON.stringify(p)}`, f);
    await settle(page, 300);
    const frozen = await physicsUi(page);
    await page.waitForTimeout(600);
    const still = await physicsUi(page);
    log.paused = still;
    ok(still.state === 'Paused' && still.time === frozen.time && still.pause === 'Resume' && still.stop === false, `Pause: ${JSON.stringify(frozen)} then ${JSON.stringify(still)}`, f);
    await page.mouse.move(10, 500);
    const barBox = await page.locator('.bar-wrap').boundingBox();
    await page.screenshot({ path: join(SHOTS, 'physics-bar.png'), clip: { x: 0, y: barBox.y - 8, width: 1600, height: 1000 - barBox.y + 8 } });
    await page.click('[data-action="phys.pause"]');
    await page.waitForFunction(() => document.querySelector('[data-field="phys.state"]')?.textContent?.startsWith('It stopped by itself'), null, { timeout: 120000 });
    p = await physicsUi(page);
    log.settled = p;
    log.trace = await page.evaluate(() => window.__physTrace);
    ok(p.undo === 'Undo: Drop 3 parts' && p.reset === false && /0 of 3 awake/.test(p.awake), `after it stopped: ${JSON.stringify(p)}`, f);
    for (const part of parts) {
      await pickRow(page, part.name);
      part.after = await lowest(page, part.kind);
      ok(Math.abs(part.after.z) < 1, `${part.name} rests with its lowest point at ${part.after.z.toFixed(3)} mm`, f);
    }
    log.after = parts.map((x) => ({ name: x.name, lowest: x.after.z, position: x.after.t.position, rotation: x.after.t.rotation }));
    await page.keyboard.press('Escape');
    await page.mouse.move(10, 500);
    await settle(page, 400);
    const after = await canvasShot(page);
    writeFileSync(join(SHOTS, 'physics-drop.png'), await strip(browser, [before, after], ['Before: in the air', 'After Drop: at rest on the floor'], 640));

    // The clips: one Physics bar per part in the animation's timeline.
    await page.click('.drawer-btn[data-drawer="animation"]');
    await settle(page, 300);
    const blocks = await page.locator('.tl-block').allTextContents();
    log.blocks = blocks;
    ok(blocks.length === 3 && blocks.every((b) => b.startsWith('Physics')), `the timeline: ${blocks}`, f);
    const total = await page.evaluate(() => Number((document.querySelector('.anim-head .tabular')?.textContent ?? '').split('/')[1]?.replace(/[^0-9.]/g, '')));
    log.duration = total;
    ok(total > 0.3 && total < 30, `the clip lasts ${total} s`, f);

    // strip: six instants of the recorded clip, through the ruler: five through the fall (the clip's last half second
    // is the bodies going still before they sleep) and its last frame. The captions are the playhead the timeline shows.
    const frames = [];
    const captions = [];
    const fall = Math.max(0.2, total - 0.5);
    for (let k = 0; k < 6; k++) {
      const at = k < 5 ? (fall * k) / 4 : total;
      await page.evaluate((t) => {
        const tl = document.querySelector('.timeline');
        const ruler = tl.querySelector('.tl-shots');
        const w = Math.max(100, tl.clientWidth - 84 - 8);
        const px = w / Math.max(t.total, 1);
        const r = ruler.getBoundingClientRect();
        const zoom = r.width / ruler.offsetWidth || 1;
        const x = r.left + Math.min(t.at * px, w - 1) * zoom;
        ruler.dispatchEvent(new PointerEvent('pointerdown', { clientX: x, clientY: r.top + 4, bubbles: true }));
      }, { at, total });
      await page.mouse.move(10, 500);
      await settle(page, 300);
      frames.push(await canvasShot(page));
      const shown = await page.evaluate(() => (document.querySelector('.anim-head .tabular')?.textContent ?? '').split('/')[0].trim());
      captions.push(shown || `${at.toFixed(2)} s`);
    }
    writeFileSync(join(SHOTS, 'physics-drop-strip.png'), await strip(browser, frames, captions, 300));

    // reset: the clips go, the parts are back in the air; undo brings the drop back.
    await page.click('.drawer-btn[data-drawer="physics"]');
    await settle(page, 200);
    await page.click('[data-action="phys.reset"]');
    await settle(page, 300);
    p = await physicsUi(page);
    log.reset = p;
    ok(p.undo === 'Undo: Reset the simulation', `after Reset: ${p.undo}`, f);
    for (const part of parts) {
      await pickRow(page, part.name);
      const z = (await lowest(page, part.kind)).z;
      ok(Math.abs(z - part.before.z) < 0.01, `Reset put ${part.name} at ${z}, not ${part.before.z}`, f);
    }
    await page.keyboard.press('Control+z');
    await settle(page, 300);
    await pickRow(page, 'Box');
    const back = (await lowest(page, 'BOX')).z;
    ok(Math.abs(back - parts[0].after.z) < 0.01, `undo of Reset: the box at ${back}`, f);
    await page.click('.drawer-btn[data-drawer="animation"]');
    await settle(page, 200);
    ok((await page.locator('.tl-block').count()) === 3, 'undo of Reset did not bring the clips back', f);
    log.errors = errors;
    ok(errors.length === 0, `page errors: ${errors.join(' | ')}`, f);
    await context.close();
  } finally {
    await browser.close();
    if (server) {
      server.kill('SIGTERM');
      stopServer();
    }
  }
  writeFileSync(join(OUT, 'physics-check.json'), JSON.stringify({ ok: f.length === 0, failures: f, ...log }, null, 2));
  if (f.length > 0) {
    console.error(`physics-check: ${f.length} failure(s)`);
    for (const x of f) console.error(`  - ${x}`);
    process.exit(1);
  }
  console.log('physics-check: all checks passed');
  console.log(JSON.stringify(log.after));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
