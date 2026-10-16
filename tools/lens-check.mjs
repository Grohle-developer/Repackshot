#!/usr/bin/env node
// Browser check of the camera's Lens (phase O2) in the built app, with the local Chromium and swiftshader. It needs
// the engine in dist/ (npm run engine:build before npm run build): the numbers and the section are the engine's.
//
//   npm run engine:build && npm run build && node tools/lens-check.mjs [--shots docs/ui] [--url http://host:port]
//
// Without --url it serves dist/ with `vite preview` on port 4193 and stops it at the end.
//
//   thin        Camera ▸ Lens starts on the thin lens, says what it is, and hides the traced lens's rows;
//   traced      Traced lens puts the double Gauss on (one undo entry, "Camera: Lens model"), its character chip and
//               its source;
//   info        the engine's numbers (focal length, back focus, f-number and T-stop, elements and groups...), the
//               distortion and falloff curves and the cross-section (an SVG with the glass) show;
//   character   the Swirl chip lists the Petzval; choosing it from the lens list (the interface's own menu) is one undo
//               entry ("Camera: Lens") and the numbers follow (its four elements);
//   adapter     the anamorphic adapter shows the lens behind it and the engine's squeeze;
//   soft        the soft-focus lens shows its variable gap, and moving it is one undo entry;
//   advanced    Advanced shows the artistic knobs under NOT PHYSICAL, and one moved is one undo entry;
//   thinOnly    with a traced lens, Advanced optics turns the thin lens's tilt, profile, cat's eye and squeeze off;
//   bokeh       the bokeh types of the traced lens are offered with their thumbnails, and Coma comet puts its lens on;
//   meter       the Fast meter says the traced lens is approximated;
//   save        Save lens as… asks for a name and keeps the lens in Mine;
//   back        Thin lens takes the camera back.
//
// Screenshots (English, dark): lens-editor.png (the editor: model, character, lens, source, its own rows) and
// lens-section.png (what the engine computes: the numbers, the curves and the cross-section). Results:
// out/lens-check.json.

import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4193;
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

/** What the Lens subsection shows. */
const read = (page) =>
  page.evaluate(() => {
    const sub = document.querySelector('[data-optics="cameraLens"]');
    const box = sub?.querySelector('[data-lens-traced]');
    const pressed = (sel) => [...(sub?.querySelectorAll(sel) ?? [])].filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.textContent);
    const values = Object.fromEntries([...(sub?.querySelectorAll('[data-value]') ?? [])].map((e) => [e.getAttribute('data-value'), e.textContent]));
    const svg = sub?.querySelector('[data-lens-section-svg] svg');
    const select = sub?.querySelector('[data-lens-select]');
    return {
      model: pressed('[aria-label="Lens model"] button'),
      tracedShown: !!box && box.style.display !== 'none',
      chips: pressed('[data-lens-characters] .chip'),
      lens: select?.getAttribute('data-value') ?? null,
      source: sub?.querySelector('[data-lens-source]')?.textContent ?? '',
      values,
      infoState: sub?.querySelector('[data-lens-info-state]')?.getAttribute('data-lens-info-state') ?? null,
      sectionPaths: svg ? svg.querySelectorAll('path').length : 0,
      charts: sub?.querySelectorAll('[data-lens-chart] svg').length ?? 0,
      master: !!sub?.querySelector('[aria-label="Lens behind"]'),
      text: sub?.textContent ?? '',
      undo: document.querySelector('.hdr button[aria-label="Undo"]')?.getAttribute('data-tip') ?? null,
      meter: document.querySelector('footer.status')?.textContent ?? '',
    };
  });

/** Waits until the engine's numbers are there (or it said it has none). */
async function waitInfo(page) {
  for (let i = 0; i < 80; i++) {
    const r = await read(page);
    if (r.values['camera.lensInfoFocal'] || r.infoState) return r;
    await settle(page, 150);
  }
  return read(page);
}

/** Opens the lens list (the interface's own menu, O2b), returns the keys it offers, and chooses `pick` (or closes it with Escape). */
async function lensList(page, sub, pick) {
  await sub.locator('[data-lens-select]').click();
  await page.waitForSelector('.menu-item[data-value]');
  const options = await page.$$eval('.menu-item[data-value]', (els) => els.map((e) => e.getAttribute('data-value')));
  if (pick) await page.locator(`.menu-item[data-value="${pick}"]`).click();
  else await page.keyboard.press('Escape');
  return options;
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
  const context = await browser.newContext({ viewport: { width: 1600, height: 1100 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !m.text().startsWith('Failed to load resource') && errors.push(m.text()));
  await page.goto(`${base}/?example=1&theme=dark&lang=en&mode=fast`);
  await page.waitForSelector('#app[data-ready="1"]', { timeout: 60000 });
  await settle(page, 800);
  await page.keyboard.press('Escape');
  const sub = page.locator('[data-optics="cameraLens"]');
  const head = page.locator('[data-section="camera"] [data-action="cameraLens"]');
  await head.scrollIntoViewIfNeeded();
  if ((await head.getAttribute('aria-expanded')) !== 'true') await head.click();
  await settle(page, 400);

  const r0 = await read(page);
  check('thin', r0.model.join() === 'Thin lens' && !r0.tracedShown && /ideal lens/.test(r0.text), { model: r0.model, tracedShown: r0.tracedShown });

  await sub.locator('[aria-label="Lens model"] button', { hasText: 'Traced lens' }).click();
  await settle(page, 400);
  const r1 = await read(page);
  check('traced', r1.model.join() === 'Traced lens' && r1.tracedShown && r1.lens === 'double_gauss_normal' && r1.chips.join() === 'Clinical' && /Modern Lens Design|1992|checked/.test(r1.source) && r1.undo?.includes('Lens model'), { lens: r1.lens, chips: r1.chips, source: r1.source, undo: r1.undo });

  const r2 = await waitInfo(page);
  const focal = r2.values['camera.lensInfoFocal'] ?? '';
  check('info', /mm/.test(focal) && /f\/[0-9.]+ · T[0-9.]+/.test(r2.values['camera.lensInfoStop'] ?? '') && r2.values['camera.lensInfoElements'] === '6 · 4' && r2.sectionPaths >= 6 && r2.charts === 2 && !r2.infoState, { values: r2.values, sectionPaths: r2.sectionPaths, charts: r2.charts, infoState: r2.infoState });
  await sub.locator('[data-lens-info]').evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await settle(page, 300);
  const editor = await sub.boundingBox();
  if (editor) {
    const infoTop = await sub.locator('[data-lens-section-svg]').boundingBox();
    const infoEnd = await sub.locator('[data-lens-info]').boundingBox();
    if (infoTop && infoEnd) await page.screenshot({ path: join(SHOTS, 'lens-section.png'), clip: { x: editor.x - 8, y: infoTop.y - 28, width: editor.width + 16, height: infoEnd.y + infoEnd.height - infoTop.y + 36 } });
  }

  await sub.locator('[data-character="swirl"]').click();
  await settle(page, 300);
  const opts = await lensList(page, sub, 'petzval_portrait');
  await settle(page, 400);
  const r3 = await waitInfo(page);
  check('character', opts.includes('petzval_portrait') && r3.lens === 'petzval_portrait' && r3.undo?.includes('Lens') && r3.values['camera.lensInfoElements'] === '4 · 3', { opts, lens: r3.lens, undo: r3.undo, elements: r3.values['camera.lensInfoElements'] });

  await sub.locator('[data-character="anamorphic"]').click();
  await settle(page, 300);
  await lensList(page, sub, 'anamorphic_adapter_2x');
  await settle(page, 400);
  const r4 = await waitInfo(page);
  check('adapter', r4.master && /×/.test(r4.values['camera.lensInfoSqueeze'] ?? ''), { master: r4.master, squeeze: r4.values['camera.lensInfoSqueeze'] });

  await sub.locator('[data-character="soft"]').click();
  await settle(page, 300);
  await lensList(page, sub, 'soft_focus_variable');
  await settle(page, 600);
  const gap = sub.locator('[data-lens-own] input[type="range"]').first();
  const hasGap = (await gap.count()) === 1;
  if (hasGap) {
    await gap.focus();
    await page.keyboard.press('ArrowRight');
    await settle(page, 400);
  }
  const r5 = await waitInfo(page);
  check('soft', hasGap && r5.undo?.includes('Lens'), { hasGap, undo: r5.undo });
  await sub.evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await settle(page, 300);
  const top = await sub.boundingBox();
  const ownEnd = await sub.locator('[data-lens-range]').boundingBox();
  if (top && ownEnd) await page.screenshot({ path: join(SHOTS, 'lens-editor.png'), clip: { x: top.x - 8, y: top.y - 32, width: top.width + 16, height: ownEnd.y + ownEnd.height - top.y + 44 } });

  await sub.locator('[data-action="cameraLensAdvanced"]').click();
  await settle(page, 300);
  const dist = sub.locator('[aria-label="Distortion"][type="range"]');
  await dist.focus();
  await page.keyboard.press('ArrowLeft');
  await settle(page, 400);
  const r6 = await read(page);
  check('advanced', /not physical/i.test(r6.text) && r6.undo?.includes('Distortion'), { undo: r6.undo });

  const optHead = page.locator('[data-section="camera"] [data-action="cameraOptics"]');
  if ((await optHead.getAttribute('aria-expanded')) !== 'true') await optHead.click();
  await settle(page, 300);
  const thinOnly = await page.evaluate(() => {
    const adv = document.querySelector('[data-optics="cameraOptics"]');
    const tilt = adv?.querySelector('[aria-label="Tilt"]');
    const profile = adv?.querySelector('select[aria-label="Profile"]');
    const note = adv?.querySelector('[data-thin-only]');
    return { tilt: tilt ? tilt.closest('[data-disabled]') !== null || tilt.disabled === true : null, profile: profile?.disabled ?? null, note: note ? note.style.display !== 'none' : null };
  });
  check('thinOnly', thinOnly.tilt === true && thinOnly.profile === true && thinOnly.note === true, thinOnly);

  const coma = page.locator('[data-bokeh="coma_comet"]');
  const comaState = await coma.evaluate((el) => ({ disabled: el.disabled, img: el.querySelector('img')?.getAttribute('src') ?? null }));
  await coma.click();
  await settle(page, 500);
  const r7 = await read(page);
  check('bokeh', !comaState.disabled && /coma-comet\.png$/.test(comaState.img ?? '') && r7.lens === 'double_gauss_fast', { coma: comaState, lens: r7.lens });

  check('meter', /Traced lens: distortion and falloff approximated/.test(r7.meter), { meter: r7.meter });

  await sub.locator('[data-action="lens.saveAs"]').click();
  await settle(page, 200);
  const nameInput = sub.locator('.name-prompt input');
  await nameInput.fill('My fast lens');
  await nameInput.press('Enter');
  await settle(page, 300);
  await sub.locator('[data-character="MINE"]').click();
  await settle(page, 300);
  const mine = await sub.locator('[data-lens-list]').textContent();
  check('save', /My fast lens/.test(mine ?? ''), { mine });

  await sub.locator('[aria-label="Lens model"] button', { hasText: 'Thin lens' }).click();
  await settle(page, 400);
  const r8 = await read(page);
  check('back', r8.model.join() === 'Thin lens' && !r8.tracedShown && r8.undo?.includes('Lens model'), { model: r8.model, undo: r8.undo });
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
  writeFileSync(join(OUT, 'lens-check.json'), JSON.stringify(results, null, 2));
  const bad = Object.values(results).filter((r) => !r.ok).length;
  console.log(bad ? `${bad} checks failed` : 'all checks passed');
  process.exitCode = bad ? 1 : 0;
}
