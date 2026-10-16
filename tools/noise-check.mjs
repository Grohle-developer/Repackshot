#!/usr/bin/env node
// Browser checks of phase E10 (adaptive sampling and Finish by Noise), with the local Chromium and swiftshader.
//
//   npm run engine:build && npm run build && node tools/noise-check.mjs [--url http://localhost:4187] [--shots docs/ui]
//
// Without --url it serves dist/ with `vite preview --port 4187 --strictPort` and stops it at the end
// (by the pids `lsof -t -i :4187` reports, never `pkill -f`).
//
//   (window) Render ▸ Quality ▸ Finish by has Samples · Time · Noise; Noise shows its field at 1.0 % with its
//            note, keeps the Samples field as the cap, hides Time, and the estimate says where its time comes from;
//   (full)   in Full mode, with the view following the output's samples, the meter says "Adaptive · min–max samples"
//            with the engine's numbers (min < max once the image has been decided), and the window's estimate then
//            comes from the view's last pass;
//   (es)     the same in Spanish.
//
// Screenshots (English): render-window-noise.png (the window at Quality, Noise chosen), meter-adaptive.png (the
// meter in Full mode). Results: out/noise-check.json.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4187;
const STUDIO = 'example=1&preset=JEWELLERY&setup=REMBRANDT&theme=dark&mode=fast';
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const SHOTS = resolve(ROOT, opt('shots', 'docs/ui'));
const OUT = join(ROOT, 'out');
mkdirSync(OUT, { recursive: true });
mkdirSync(SHOTS, { recursive: true });
const results = {};
const fail = (msg) => {
  throw new Error(msg);
};
const check = (key, ok, detail) => {
  results[key] = { ok: Boolean(ok), ...detail };
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${key} ${JSON.stringify(detail)}`);
};

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
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // not yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  fail(`${url} did not answer`);
}

async function open(browser, lang) {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  // The check for a newer version at startup asks api.github.com; while the repository is private that is a 404 the browser logs itself.
  page.on('console', (m) => m.type() === 'error' && !m.location().url.startsWith('https://api.github.com/') && errors.push(m.text()));
  await page.goto(`${BASE_URL}/?${STUDIO}&lang=${lang}`);
  await page.waitForSelector('#app[data-ready="1"]', { timeout: 90000 });
  return { page, context, errors };
}

const quality = '.rw [data-section="rw.quality"]';

/** What the Quality section shows. */
const qualityState = (page) =>
  page.evaluate((sel) => {
    const sec = document.querySelector(sel);
    const finish = sec?.querySelector('.seg[aria-label]');
    const visible = (label) => {
      const el = sec?.querySelector(`.num[aria-label="${label}"]`);
      return Boolean(el && el.offsetParent !== null);
    };
    return {
      finishBy: [...(finish?.querySelectorAll('button') ?? [])].map((b) => ({ text: b.textContent, pressed: b.getAttribute('aria-pressed') })),
      noise: sec?.querySelector('.num[aria-label="Noise"], .num[aria-label="Ruido"]')?.textContent ?? null,
      noiseShown: visible('Noise') || visible('Ruido'),
      samplesShown: visible('Samples') || visible('Muestras'),
      notes: [...(sec?.querySelectorAll('.note') ?? [])].filter((n) => n.offsetParent !== null).map((n) => n.textContent),
      estimate: sec?.querySelector('.rw-estimate')?.textContent ?? '',
    };
  }, quality);

const meter = (page) =>
  page.evaluate(() => {
    const m = document.querySelector('.ov-bl');
    return { mode: m?.dataset.mode, samples: Number(m?.dataset.samples ?? 0), adaptive: m?.dataset.adaptive ?? '', extras: m?.querySelector('[data-meter-extras]')?.textContent ?? '' };
  });

async function openWindow(page) {
  await page.locator('canvas[aria-label="viewport"]').focus();
  await page.keyboard.press('Control+Enter');
  await page.waitForSelector('.rw');
  const head = page.locator(`${quality} > .section-head`);
  if ((await head.count()) && (await head.getAttribute('aria-expanded')) === 'false') await head.click();
  await page.locator(quality).scrollIntoViewIfNeeded();
}

let BASE_URL = opt('url', null);
let server = null;
let browser = null;
try {
  if (!existsSync(join(ROOT, 'public', 'engine', 'rt.wasm'))) fail('public/engine/rt.wasm is missing: npm run engine:build first');
  if (!existsSync(join(ROOT, 'dist', 'index.html'))) fail('dist/ is missing: npm run build first');
  if (!BASE_URL) {
    stopServer();
    server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: 'ignore', detached: true });
    BASE_URL = `http://localhost:${PORT}`;
  }
  await waitFor(BASE_URL);
  const { chromium } = await import(join(ROOT, 'node_modules', 'playwright-core', 'index.mjs'));
  browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true, args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });

  for (const lang of ['en', 'es']) {
    const { page, context, errors } = await open(browser, lang);
    const NOISE = lang === 'en' ? 'Noise' : 'Ruido';

    // (window) Finish by Noise.
    await openWindow(page);
    const before = await qualityState(page);
    await page.locator(`${quality} .seg button`, { hasText: NOISE }).first().click();
    await page.waitForTimeout(300);
    const chosen = await qualityState(page);
    const labels = chosen.finishBy.map((b) => b.text);
    const wantLabels = lang === 'en' ? ['Samples', 'Time', 'Noise'] : ['Muestras', 'Tiempo', 'Ruido'];
    const pressed = chosen.finishBy.find((b) => b.pressed === 'true')?.text;
    const field = lang === 'en' ? '1.0 %' : '1,0 %';
    const note = lang === 'en' ? 'Every pixel ends' : 'Cada píxel termina';
    const noneEstimate = lang === 'en' ? 'The time comes from the passes' : 'El tiempo sale de las pasadas';
    check(`window_${lang}`, JSON.stringify(labels) === JSON.stringify(wantLabels) && pressed === NOISE && chosen.noise?.includes(field) && chosen.noiseShown && !before.noiseShown && chosen.samplesShown && chosen.notes.some((n) => n.startsWith(note)) && chosen.estimate.startsWith(noneEstimate), {
      labels,
      pressed,
      noise: chosen.noise,
      noiseShownBefore: before.noiseShown,
      samplesShown: chosen.samplesShown,
      notes: chosen.notes,
      estimate: chosen.estimate,
    });
    if (lang === 'en') {
      const box = await page.locator(quality).boundingBox();
      const rw = await page.locator('.rw').boundingBox();
      if (box && rw) await page.screenshot({ path: join(SHOTS, 'render-window-noise.png'), clip: { x: rw.x, y: Math.max(rw.y, box.y - 8), width: rw.width, height: Math.min(box.height + 16, 1000 - Math.max(rw.y, box.y - 8)) } });
    }
    await page.keyboard.press('Escape');

    // (full) The meter in Full mode, the view following the output's samples (the factory limit).
    await page.waitForFunction(() => !document.querySelectorAll('[data-guide="viewport-mode"] .seg:not(.hdr-denoise) button')[1]?.disabled, null, { timeout: 120000 });
    await page.locator('[data-guide="viewport-mode"] .seg:not(.hdr-denoise) button').nth(1).click();
    await page.waitForFunction(
      () => {
        const m = document.querySelector('.ov-bl');
        const [lo, hi] = (m?.dataset.adaptive ?? '').split('-').map(Number);
        return m?.dataset.mode === 'full' && lo >= 16 && hi > lo;
      },
      null,
      { timeout: 600000 },
    );
    const m = await meter(page);
    const [lo, hi] = m.adaptive.split('-').map(Number);
    const word = lang === 'en' ? `Adaptive · ${lo}–${hi} samples` : `Adaptativo · ${lo}–${hi} muestras`;
    check(`meter_${lang}`, m.extras.includes(word) && lo === 16 && hi > lo, { meter: m, want: word });
    if (lang === 'en') {
      const box = await page.locator('.ov-bl').boundingBox();
      if (box) await page.screenshot({ path: join(SHOTS, 'meter-adaptive.png'), clip: { x: Math.max(0, box.x - 8), y: Math.max(0, box.y - 8), width: Math.min(560, box.width + 16), height: box.height + 16 } });
    }
    // The window's estimate now comes from the view's last pass.
    await openWindow(page);
    await page.waitForFunction(
      (want) => document.querySelector('.rw [data-section="rw.quality"] .rw-estimate')?.textContent?.includes(want),
      lang === 'en' ? 'from the last pass of the Full view' : 'según la última pasada del visor Completo',
      { timeout: 120000 },
    );
    const after = await qualityState(page);
    check(`estimate_${lang}`, after.estimate.startsWith('≈'), { estimate: after.estimate });
    await page.keyboard.press('Escape');
    check(`errors_${lang}`, errors.length === 0, { errors });
    await context.close();
  }
} catch (e) {
  check('run', false, { error: String(e?.stack ?? e) });
} finally {
  writeFileSync(join(OUT, 'noise-check.json'), JSON.stringify(results, null, 2));
  if (browser) await browser.close();
  if (server) stopServer();
}
const failed = Object.entries(results).filter(([, r]) => !r.ok);
console.log(failed.length ? `${failed.length} failed: ${failed.map(([k]) => k).join(', ')}` : 'all ok');
process.exit(failed.length ? 1 : 0);
