#!/usr/bin/env node
// Browser check of phase O4 (the simple and the traced lens, each with its own options) in the built app, with the
// local Chromium and swiftshader, and its captures. It needs the engine in dist/ (npm run engine:build before
// npm run build): the traced lens's numbers and the Full mode image are the engine's.
//
//   npm run engine:build && npm run build && node tools/o4-check.mjs [--shots docs/ui] [--url http://host:port]
//
// Without --url it serves dist/ with `vite preview` on port 4194 and stops it at the end.
//
//   simple      Camera ▸ Lens starts on Simple lens; the Bokeh and the Advanced optics are there, with the tilt's
//               dial, presets, Through two points… and the shift;
//   pick        Through two points… and two clicks on the product set the tilt and the focus distance (one undo
//               entry, "Tilt the focus plane through two points"), and the pick banner says what to click;
//   overlay     Show the plane draws it in the viewport (the viewport says so) and the drawing changes the image;
//   traced      Traced lens hides the Bokeh and the Advanced optics; its More options has the tilt and the shift;
//   tracedTilt  a preset tilts the traced lens (one undo entry), the engine says the angle the lens takes, and the
//               simple lens's tilt stays as it was;
//   back        Simple lens brings back its bokeh and its tilt.
//
// Screenshots (English, dark, reduced motion, device scale 1): o4-simple-optics.png (Advanced optics of the simple
// lens, tilted 7° so that the plane lies back like the floor), o4-traced-more.png (the traced lens's More options), o4-tilt-overlay.png (the viewport with the plane through
// two points, then tilted further). The traced tilt's render, docs/ui/o4-traced-tilt.png, is the composite of
// `rt --tilt-sheet` (rt-cli/src/tilt_sheet.rs). Results: out/o4-check.json.

import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4194;
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
const undoTip = (page) => page.evaluate(() => document.querySelector('.hdr button[aria-label="Undo"]')?.getAttribute('data-tip') ?? '');
const visible = (page, sel) => page.locator(sel).first().isVisible();
/** The pick banner's text (the one shown). */
const banner = (page) => page.evaluate(() => [...document.querySelectorAll('.ov-pick')].find((e) => e.style.display !== 'none' && !e.classList.contains('ov-look'))?.textContent ?? '');

/** Opens a disclosure of the camera's optics (by its data-action) when it is closed. */
async function openSection(page, action) {
  const head = page.locator(`[data-section="camera"] [data-action="${action}"]`).first();
  await head.scrollIntoViewIfNeeded();
  if ((await head.getAttribute('aria-expanded')) !== 'true') await head.click();
  await settle(page, 300);
}

/** A clip of the inspector around `sel`, from its top for at most `height` pixels. */
async function shotOf(page, sel, file, height = 900, from = null) {
  await page.mouse.move(5, 1095);
  const el = page.locator(sel).first();
  await (from ? page.locator(from).first() : el).evaluate((e) => e.scrollIntoView({ block: 'start' }));
  await settle(page, 400);
  const box = await el.boundingBox();
  const head = from ? await page.locator(from).first().boundingBox() : null;
  if (!box) return;
  const y0 = Math.max(0, (head ?? box).y - 8);
  await page.screenshot({ path: join(SHOTS, file), clip: { x: box.x - 8, y: y0, width: box.width + 16, height: Math.min(height, box.y + box.height + 8 - y0) } });
}

/** Where the product is on the viewport: points of the canvas a click picks (the hover label names a part there). */
async function productPoints(page) {
  const canvas = await page.locator('main.vp canvas').first().boundingBox();
  const points = [];
  for (let fy = 0.25; fy <= 0.8 && points.length < 12; fy += 0.05) {
    for (let fx = 0.3; fx <= 0.7; fx += 0.05) {
      const x = canvas.x + canvas.width * fx;
      const y = canvas.y + canvas.height * fy;
      await page.mouse.move(x, y);
      await settle(page, 60);
      const label = await page.evaluate(() => {
        const l = document.querySelector('.hover-label');
        return l && l.style.display !== 'none' ? l.textContent : '';
      });
      // The product's parts, not the studio's pieces.
      if (label && !/backdrop|floor|fondo|suelo/i.test(label)) points.push({ x, y, label });
    }
  }
  return points;
}

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
  const context = await browser.newContext({ viewport: { width: 1600, height: 1100 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !m.text().startsWith('Failed to load resource') && errors.push(m.text()));
  await page.goto(`${base}/?example=1&theme=dark&lang=en&mode=fast&tour=0`);
  await page.waitForSelector('#app[data-ready="1"]', { timeout: 60000 });
  await settle(page, 800);
  await page.keyboard.press('Escape');

  // --- simple ----------------------------------------------------------------------------------------------------
  await openSection(page, 'cameraLens');
  const modelText = await page.locator('[data-optics="cameraLens"] .seg button[aria-pressed="true"]').textContent();
  await openSection(page, 'cameraOptics');
  check('simple', modelText === 'Simple lens' && (await visible(page, '[data-optics="cameraBokeh"]')) && (await visible(page, '[data-optics="cameraOptics"] [data-tilt-dial]')) && (await visible(page, '[data-optics="cameraOptics"] [data-action="tilt.pick"]')) && (await visible(page, '[data-optics="cameraOptics"] [aria-label="Horizontal shift"]')), { modelText });

  // --- pick: the plane through two points --------------------------------------------------------------------------
  const pts = await productPoints(page);
  const top = pts[0];
  const bottom = pts[pts.length - 1];
  await page.locator('[data-optics="cameraOptics"] [data-action="tilt.pick"]').click();
  await settle(page, 200);
  const banner1 = await banner(page);
  await page.mouse.click(top.x, top.y);
  await settle(page, 200);
  const banner2 = await banner(page);
  await page.mouse.click(bottom.x, bottom.y);
  await settle(page, 400);
  const tipAfter = await undoTip(page);
  const recede = await page.locator('[data-optics="cameraOptics"] [data-tilt-dial]').getAttribute('aria-valuenow');
  const amount = await page.locator('[data-optics="cameraOptics"] [data-tilt-amount] [role="spinbutton"]').getAttribute('aria-valuenow');
  check('pick', pts.length >= 2 && /first point/.test(banner1 ?? '') && /second point/.test(banner2 ?? '') && /Tilt the focus plane through two points/.test(tipAfter) && Number(amount) > 0, { points: pts.length, top, bottom, banner1, banner2, undo: tipAfter, amount, recede });

  // --- overlay -----------------------------------------------------------------------------------------------------
  // A plane laid back towards the floor, 7° or so, reads best in the capture.
  await page.locator('[data-optics="cameraOptics"] [data-recede="90"]').click();
  const simpleAmount = page.locator('[data-optics="cameraOptics"] [data-tilt-amount] input[type="range"]');
  await simpleAmount.focus();
  for (let i = 0; i < 60; i++) await page.keyboard.press('ArrowRight');
  await settle(page, 300);
  const vp = page.locator('main.vp').first();
  const plain = await vp.screenshot();
  await page.locator('[data-optics="cameraOptics"] [data-tilt-show]').click();
  await page.mouse.move(10, 300);
  await settle(page, 600);
  const drawn = await vp.screenshot();
  const flag = await vp.getAttribute('data-focus-plane');
  check('overlay', flag === '1' && Buffer.compare(plain, drawn) !== 0, { flag });
  await page.screenshot({ path: join(SHOTS, 'o4-tilt-overlay.png'), clip: await vp.boundingBox() });
  await page.locator('[data-optics="cameraOptics"] [data-tilt-show]').click();
  // The simple lens's Advanced optics with that tilt: the plane runs up, like the floor.
  await shotOf(page, '[data-optics="cameraOptics"]', 'o4-simple-optics.png', 1000);
  const simpleTilt = {
    amount: await page.locator('[data-optics="cameraOptics"] [data-tilt-amount] [role="spinbutton"]').getAttribute('aria-valuenow'),
    recede: await page.locator('[data-optics="cameraOptics"] [data-tilt-dial]').getAttribute('aria-valuenow'),
  };

  // --- traced ------------------------------------------------------------------------------------------------------
  await page.locator('[data-optics="cameraLens"] .seg button', { hasText: 'Traced lens' }).click();
  await settle(page, 500);
  await page.locator('[data-action="cameraLensAdvanced"]').click();
  await settle(page, 300);
  check(
    'traced',
    (await page.locator('[data-optics="cameraBokeh"]').isHidden()) && (await page.locator('[data-optics="cameraOptics"]').isHidden()) && (await visible(page, '[data-lens-more] [data-tilt-dial]')) && (await visible(page, '[data-lens-more] [aria-label="Horizontal shift"]')),
    {},
  );
  await page.locator('[data-lens-more] [data-recede="90"]').click();
  await settle(page, 300);
  const amountField = page.locator('[data-lens-more] [data-tilt-amount] input[type="range"]');
  await amountField.focus();
  for (let i = 0; i < 40; i++) await page.keyboard.press('ArrowRight');
  await settle(page, 300);
  let tiltRow = '';
  for (let i = 0; i < 60 && !tiltRow; i++) {
    tiltRow = (await page.locator('[data-value="camera.lensInfoTilt"]').first().textContent().catch(() => '')) ?? '';
    if (!tiltRow) await settle(page, 200);
  }
  check('tracedTilt', /°/.test(tiltRow) && /Tilt/.test(await undoTip(page)), { tiltRow, undo: await undoTip(page) });
  await shotOf(page, '[data-lens-more]', 'o4-traced-more.png', 1000, '[data-action="cameraLensAdvanced"]');

  // --- back --------------------------------------------------------------------------------------------------------
  await page.locator('[data-optics="cameraLens"] .seg button', { hasText: 'Simple lens' }).click();
  await settle(page, 400);
  await openSection(page, 'cameraOptics');
  const backAmount = await page.locator('[data-optics="cameraOptics"] [data-tilt-amount] [role="spinbutton"]').getAttribute('aria-valuenow');
  const backRecede = await page.locator('[data-optics="cameraOptics"] [data-tilt-dial]').getAttribute('aria-valuenow');
  check('back', backAmount === simpleTilt.amount && backRecede === simpleTilt.recede && (await visible(page, '[data-optics="cameraBokeh"]')), { backAmount, backRecede, simpleTilt });
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
  writeFileSync(join(OUT, 'o4-check.json'), JSON.stringify(results, null, 2));
  const bad = Object.values(results).filter((r) => !r.ok).length;
  console.log(bad ? `${bad} checks failed` : 'all checks passed');
  process.exitCode = bad ? 1 : 0;
}
