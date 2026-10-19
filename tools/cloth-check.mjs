#!/usr/bin/env node
// Browser check of phase S9 in the built app (cloth: Drape over the part, the Cloth role in the inspector, the physics bar
// and the recorded clip), with the local Chromium and swiftshader, in Fast mode.
//
//   npm run engine:build && npm run build && node tools/cloth-check.mjs [--url http://localhost:4191] [--shots docs/ui]
//
// Without --url it serves dist/ with `vite preview` on port 4191 and stops it at the end. The simulator needs
// dist/engine/rt.wasm; without it the check fails and says so.
//
//   drape    a box on the floor; right click on the tree ▸ Drape over the part: a sheet named Cloth appears over it with
//            the role Cloth, the bar opens and runs (the cloth's vertices as the simulator reports them) and stops by
//            itself when the cloth settles (or at its time); the sheet rests over the box (the viewport before and
//            after); one undo step (Undo: Drape cloth over Box); one Physics clip that "drapes as simulated";
//   inspector the sheet selected: the Physics section with Cloth pressed and the cloth's fields (fabric, weight,
//            stiffness, thickness, anchors, pressure for a closed shell only, self-collision, resolution);
//   sheet    when out/cloth-sheet/ holds the contact sheet's renders (node tools/cloth-sheet.mjs), four of them side by side,
//            the cap close up under silk, and four presets on Cusick's drape tester from above.
//
// Screenshots (docs/ui): cloth-drape.png (before and after, side by side), cloth-inspector.png (the Physics section of
// the sheet), cloth-bar.png (the bar while it runs), cloth-sheet.png (four fabrics of the contact sheet, by the engine),
// cloth-cap.png (the cap under silk, close up) and cloth-cusick.png (silk, linen, denim and thick leather on Cusick's
// tester, with their drape coefficients and nodes).
// Results: out/cloth-check.json.

import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4191;

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

async function pickRow(page, name) {
  const row = page.locator('.tree-row', { has: page.locator('.tree-name', { hasText: new RegExp(`^${name}$`) }) }).first();
  await row.click();
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

const physicsUi = (page) =>
  page.evaluate(() => ({
    state: document.querySelector('[data-field="phys.state"]')?.textContent ?? null,
    time: document.querySelector('[data-field="phys.time"]')?.textContent ?? '',
    cloth: document.querySelector('[data-field="phys.cloth"]')?.textContent ?? '',
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

    // A box on the floor, framed from a little above.
    await addFromHeader(page, 'Box');
    await page.locator('canvas[aria-label="viewport"]').focus();
    await page.keyboard.press('f');
    await settle(page, 300);
    await page.keyboard.press('Escape');
    await page.mouse.move(10, 500);
    await settle(page, 300);
    const before = await canvasShot(page);

    // drape: right click on the tree ▸ Drape over the part.
    const row = await pickRow(page, 'Box');
    await row.click({ button: 'right' });
    await settle(page, 150);
    const drape = page.locator('.floating .menu-item', { hasText: /^Drape over the part/ });
    ok((await drape.count()) === 1, 'the context menu has no Drape over the part', f);
    await page.evaluate(() => {
      window.__clothSeen = null;
      const read = () => {
        const cloth = document.querySelector('[data-field="phys.cloth"]')?.textContent ?? '';
        const state = document.querySelector('[data-field="phys.state"]')?.textContent ?? '';
        if (!window.__clothSeen && state === 'Running' && cloth) window.__clothSeen = { state, cloth, time: document.querySelector('[data-field="phys.time"]')?.textContent ?? '' };
      };
      new MutationObserver(read).observe(document.querySelector('#app'), { subtree: true, childList: true, characterData: true });
    });
    await drape.first().click();
    await page.waitForFunction(() => !!window.__clothSeen, null, { timeout: 120000 });
    log.running = await page.evaluate(() => window.__clothSeen);
    ok(/^Cloth: [\d,]+ vertices$/.test(log.running.cloth), `the bar while it runs: ${JSON.stringify(log.running)}`, f);
    await page.waitForTimeout(1500);
    await page.mouse.move(10, 500);
    const barBox = await page.locator('.bar-wrap').boundingBox();
    await page.screenshot({ path: join(SHOTS, 'cloth-bar.png'), clip: { x: 0, y: barBox.y - 8, width: 1600, height: 1000 - barBox.y + 8 } });
    await page.waitForFunction(() => /^(It stopped by itself|Stopped after)/.test(document.querySelector('[data-field="phys.state"]')?.textContent ?? ''), null, { timeout: 600000 });
    const p = await physicsUi(page);
    log.ended = p;
    ok(p.undo === 'Undo: Drape cloth over Box', `after it stopped: ${JSON.stringify(p)}`, f);
    await page.keyboard.press('Escape');
    await page.mouse.move(10, 500);
    await settle(page, 400);
    const after = await canvasShot(page);
    writeFileSync(join(SHOTS, 'cloth-drape.png'), await strip(browser, [before, after], ['Before: a box on the floor', 'After Drape over the part: the cloth at rest over it'], 640));

    // The clip: one Physics bar, "Cloth drapes as simulated".
    await page.click('.drawer-btn[data-drawer="animation"]');
    await settle(page, 400);
    const rows = (await page.locator('.atr-clip').allTextContents()).map((r) => r.trim());
    log.rows = rows;
    ok(rows.length === 1 && rows[0].includes('drapes as simulated'), `the timeline: ${JSON.stringify(rows)}`, f);

    // inspector: the sheet, its Physics section.
    await page.click('.drawer-btn[data-drawer="animation"]');
    await page.setViewportSize({ width: 1600, height: 1700 });
    await pickRow(page, 'Cloth');
    await settle(page, 300);
    // The whole section, its header included.
    const section = page.locator('[data-field="physics"]').first().locator('xpath=..');
    await section.evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await settle(page, 300);
    const fields = await page.evaluate(() => {
      const s = document.querySelector('[data-field="physics"]');
      const pressed = [...s.querySelectorAll('[data-field="phys.role"] button[aria-pressed="true"]')].map((b) => b.textContent);
      const shown = (k) => {
        const el = s.querySelector(`[data-field="${k}"]`);
        return !!el && el.offsetParent !== null;
      };
      return { pressed, fabric: shown('cloth.fabric'), weight: shown('cloth.weight'), thickness: shown('cloth.thickness'), anchor: shown('cloth.anchor'), density: shown('phys.density'), pressure: s.querySelector('[data-field="cloth.pressure"] input[type="range"]')?.disabled ?? null };
    });
    log.inspector = fields;
    ok(fields.pressed.join() === 'Cloth' && fields.fabric && fields.weight && fields.thickness && fields.anchor && !fields.density && fields.pressure === true, `the Physics section of the sheet: ${JSON.stringify(fields)}`, f);
    const sb = await section.boundingBox();
    await page.screenshot({ path: join(SHOTS, 'cloth-inspector.png'), clip: { x: sb.x - 8, y: Math.max(0, sb.y - 40), width: sb.width + 16, height: Math.min(1700 - Math.max(0, sb.y - 40), sb.height + 48) } });

    // sheet: four fabrics of the contact sheet, when it is there.
    const dir = join(OUT, 'cloth-sheet');
    const pick = ['silk', 'linen', 'denim', 'leather_thick'];
    if (pick.every((k) => existsSync(join(dir, `${k}.png`)))) {
      const sheet = JSON.parse(readFileSync(join(dir, 'sheet.json'), 'utf8'));
      const label = (k) => sheet.shots.find((s) => s.file === k)?.label ?? k;
      writeFileSync(join(SHOTS, 'cloth-sheet.png'), await strip(browser, pick.map((k) => readFileSync(join(dir, `${k}.png`))), pick.map(label), 360));
      log.sheet = pick;
      if (existsSync(join(dir, 'silk_cap.png'))) {
        writeFileSync(join(SHOTS, 'cloth-cap.png'), await strip(browser, [readFileSync(join(dir, 'silk_cap.png'))], [label('silk_cap')], 720));
        log.cap = 'silk_cap';
      }
      const tester = pick.map((k) => `cusick_${k}`);
      if (tester.every((k) => existsSync(join(dir, `${k}.png`)))) {
        const shot = (k) => sheet.shots.find((s) => s.file === k);
        const said = (k) => `${shot(k).label}: DC ${shot(k).dc.toFixed(2)}, ${shot(k).nodes} nodes`;
        writeFileSync(join(SHOTS, 'cloth-cusick.png'), await strip(browser, tester.map((k) => readFileSync(join(dir, `${k}.png`))), tester.map(said), 360));
        log.cusick = tester.map(said);
      }
    } else log.sheet = 'not there (node tools/cloth-sheet.mjs)';

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
  writeFileSync(join(OUT, 'cloth-check.json'), JSON.stringify({ ok: f.length === 0, failures: f, ...log }, null, 2));
  if (f.length > 0) {
    console.error(`cloth-check: ${f.length} failure(s)`);
    for (const x of f) console.error(`  - ${x}`);
    process.exit(1);
  }
  console.log('cloth-check: all checks passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
