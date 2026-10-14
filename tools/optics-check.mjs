#!/usr/bin/env node
// Browser check of the camera's optics (phase O1) in the built app, with the local Chromium and swiftshader.
//
//   npm run build && node tools/optics-check.mjs [--shots docs/ui] [--url http://host:port]
//
// Without --url it serves dist/ with `vite preview` on port 4191 and stops it at the end.
//
//   tiles      Camera ▸ Bokeh shows the 20 types: 16 with the engine's thumbnail, the 4 that need the traced lens or
//              wave optics disabled and saying so;
//   choose     a click on Soap bubble marks it, is one undo entry ("Camera: Bokeh type") and sets Advanced optics
//              (Profile: Bright ring);
//   knob       moving a knob by hand (Obstruction) unmarks the type and the note says Custom; one undo brings it back;
//   variant    Custom shape shows its variants; Heart puts the heart's thumbnail on the tile;
//   shift      a vertical shift moves the Fast preview's frame (the canvas changes) and no other camera field;
//   reset      Plain disc takes the optics away (no tile marked).
//
// Screenshots (English, dark): camera-bokeh.png (the Bokeh selector), camera-optics.png (Advanced optics).
// Results: out/optics-check.json.

import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4191;
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const BASE = opt('url', null);
const SHOTS = resolve(ROOT, opt('shots', 'docs/ui'));
const OUT = join(ROOT, 'out');
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

const settle = (page, ms = 250) => page.evaluate((wait) => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, wait)))), ms);

/** What the camera section shows. */
const read = (page) =>
  page.evaluate(() => {
    const sec = document.querySelector('[data-section="camera"]');
    const tiles = [...(sec?.querySelectorAll('[data-bokeh]') ?? [])];
    return {
      tiles: tiles.length,
      withImage: tiles.filter((t) => {
        const img = t.querySelector('img');
        return img && img.complete && img.naturalWidth > 0;
      }).length,
      disabled: tiles.filter((t) => t.disabled).map((t) => t.getAttribute('data-bokeh')),
      disabledTips: tiles.filter((t) => t.disabled).map((t) => t.getAttribute('data-tip') ?? ''),
      pressed: tiles.filter((t) => t.getAttribute('aria-pressed') === 'true').map((t) => t.getAttribute('data-bokeh')),
      note: sec?.querySelector('[data-bokeh-note]')?.textContent ?? null,
      variant: sec?.querySelector('[data-optics="cameraBokeh"] select')?.value ?? null,
      variantOptions: [...(sec?.querySelectorAll('[data-optics="cameraBokeh"] select option') ?? [])].map((o) => o.textContent),
      profile: [...(sec?.querySelectorAll('[data-optics="cameraOptics"] select') ?? [])].map((s) => s.selectedOptions[0]?.textContent)[0] ?? null,
      bubbleSrc: sec?.querySelector('[data-bokeh="custom_shape"] img')?.getAttribute('src') ?? null,
      focal: sec?.querySelector('[aria-label="Focal length"] .num-value')?.textContent ?? null,
      undo: document.querySelector('.hdr button[aria-label="Undo"]')?.getAttribute('data-tip') ?? null,
    };
  });

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
  const context = await browser.newContext({ viewport: { width: 1600, height: 1200 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !m.text().startsWith('Failed to load resource') && errors.push(m.text()));
  await page.goto(`${base}/?example=1&theme=dark&lang=en&mode=fast`);
  await page.waitForSelector('#app[data-ready="1"]', { timeout: 60000 });
  await settle(page, 800);
  await page.keyboard.press('Escape');
  await page.evaluate(() => document.querySelector('[data-section="camera"]')?.scrollIntoView({ block: 'start' }));
  await settle(page, 600);

  const r0 = await read(page);
  check('tiles', r0.tiles === 20 && r0.withImage === 16 && r0.disabled.length === 4 && r0.disabledTips.every((t) => /traced lens|wave optics/.test(t)), r0);

  await page.locator('[data-section="camera"] [data-bokeh="bubble"]').click();
  await settle(page);
  const optHead = page.locator('[data-section="camera"] [data-action="cameraOptics"]');
  if ((await optHead.getAttribute('aria-expanded')) !== 'true') await optHead.click();
  await settle(page);
  const r1 = await read(page);
  check('choose', r1.pressed.join() === 'bubble' && r1.undo?.includes('Bokeh type') && r1.profile === 'Bright ring', r1);
  const sec = await page.locator('[data-optics="cameraBokeh"]').first().boundingBox();
  if (sec) await page.screenshot({ path: join(SHOTS, 'camera-bokeh.png'), clip: { x: sec.x - 8, y: sec.y - 4, width: sec.width + 16, height: sec.height + 8 } });

  // A knob by hand: the Obstruction slider, one step with the keyboard.
  const obstruction = page.locator('[data-optics="cameraOptics"] input[type="range"][aria-label="Obstruction"]');
  await obstruction.focus();
  await page.keyboard.press('ArrowRight');
  await settle(page);
  const r2 = await read(page);
  // The whole subsection in the shot: scrolled to the top of the inspector, above its Render bar.
  await page.locator('[data-optics="cameraOptics"]').first().evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await settle(page, 300);
  const opt0 = await page.locator('[data-optics="cameraOptics"]').first().boundingBox();
  if (opt0) await page.screenshot({ path: join(SHOTS, 'camera-optics.png'), clip: { x: opt0.x - 8, y: opt0.y - 4, width: opt0.width + 16, height: Math.min(opt0.height + 8, 720) } });
  await page.keyboard.press('Control+z');
  await settle(page);
  const r3 = await read(page);
  check('knob', r2.pressed.length === 0 && /Custom/.test(r2.note ?? '') && r2.undo?.includes('Obstruction') && r3.pressed.join() === 'bubble', { r2, r3 });

  await page.locator('[data-section="camera"] [data-bokeh="custom_shape"]').click();
  await settle(page);
  const r4 = await read(page);
  await page.locator('[data-optics="cameraBokeh"] select').selectOption('heart');
  await settle(page, 400);
  const r5 = await read(page);
  check('variant', r4.variantOptions.length === 5 && r4.variant === 'star_5' && r5.variant === 'heart' && /custom-shape--heart\.png$/.test(r5.bubbleSrc ?? ''), { r4, r5 });

  // The shift moves the Fast preview's frame.
  const canvas = page.locator('canvas[aria-label="viewport"]').first();
  const before = await canvas.screenshot();
  const shiftY = page.locator('[data-optics="cameraOptics"] [aria-label="Vertical shift"]').first();
  await shiftY.dblclick();
  await page.keyboard.type('8');
  await page.keyboard.press('Enter');
  await settle(page, 600);
  const after = await canvas.screenshot();
  const r6 = await read(page);
  check('shift', Buffer.compare(before, after) !== 0 && r6.focal === r5.focal && r6.undo?.includes('Vertical shift'), { undo: r6.undo });

  await page.locator('[data-section="camera"] [data-action="optics.reset"]').click();
  await settle(page);
  const r7 = await read(page);
  check('reset', r7.pressed.length === 0 && r7.undo?.includes('Plain disc'), r7);
  check('no_errors', errors.length === 0, { errors });
} catch (err) {
  check('run', false, { error: String(err?.stack ?? err) });
} finally {
  await browser?.close();
  if (server) {
    try {
      process.kill(-server.pid, 'SIGTERM');
    } catch {
      // gone
    }
  }
  writeFileSync(join(OUT, 'optics-check.json'), JSON.stringify(results, null, 2));
  const bad = Object.values(results).filter((r) => !r.ok).length;
  console.log(bad ? `${bad} checks failed` : 'all checks passed');
  process.exitCode = bad ? 1 : 0;
}
