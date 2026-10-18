#!/usr/bin/env node
// Browser checks of phase X6 (the AI section's stored example and the preview of the person's own scene), with the
// local Chromium and the synthetic service (?ai=synthetic).
//
//   npm run engine:build && npm run build && node tools/ai-x6-check.mjs [--url http://localhost:4193] [--shots docs/ui]
//
//   (a) the section shows the stored example as it opens, says what it is ("Example: reference scene, Full engine,
//       test model; your render will differ") and at which values it was made, where they are not the person's, and
//       what the guard did in plain words; no model is called (the service's post count stays 0);
//   (b) a slider moved shows another example at once, still without calling a model, and every step of Light, every
//       style and Intervention 0 show their own picture;
//   (c) every control has its line on what it acts on, Intervention's with the strength it asks for;
//   (d) Preview my scene runs the pipeline once on the job's scene with the Full engine, shows "Your scene · Full
//       engine", its report and the guard's words; moving a control goes back to the example and the button says
//       "again";
//   (e) the section is achromatic in both themes (every computed colour of the chrome is grey) and the Spanish
//       interface has its words.
//
// Screenshots: ai-x6-example-dark.png, ai-x6-example-light.png, ai-x6-style.png, ai-x6-mine.png, ai-x6-example-es.png.
// Results: out/ai-x6-check.json.

import { spawn, spawnSync } from 'node:child_process';
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
const SHOTS = resolve(ROOT, opt('shots', 'docs/ui'));
mkdirSync(join(ROOT, 'out'), { recursive: true });
mkdirSync(SHOTS, { recursive: true });
const results = {};
const check = (key, ok, detail) => {
  results[key] = { ok: Boolean(ok), ...detail };
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${key} ${JSON.stringify(detail)}`);
};
const section = '.rw [data-section="rw.ai"]';

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
  throw new Error(`${url} did not answer`);
}

let BASE_URL = opt('url', null);

async function open(browser, query) {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && !m.location().url.startsWith('https://api.github.com/') && errors.push(m.text()));
  // Count the pipeline's calls: the synthetic service runs in the page, so its post is wrapped through fetch-free means: we
  // watch the progress line instead, and the network for the stored images.
  const fetched = [];
  page.on('request', (r) => r.url().includes('/ai-preview/') && fetched.push(r.url().replace(/.*\/ai-preview\//, '')));
  await page.goto(`${BASE_URL}/?${query}`);
  await page.waitForSelector('#app[data-ready="1"]', { timeout: 90000 });
  await page.waitForFunction(() => !document.querySelectorAll('.hdr .seg button')[1]?.disabled, null, { timeout: 60000 });
  return { page, context, errors, fetched };
}

async function openAi(page) {
  await page.locator('.render-btn').click();
  await page.waitForSelector('.rw');
  if ((await page.locator(`${section}[data-collapsed]`).count()) > 0) await page.locator(`${section} .section-head`).click();
  const sw = page.locator('.rw [data-ai-switch]');
  if ((await sw.getAttribute('aria-checked')) !== 'true') await sw.click();
  await page.waitForSelector(`${section} .rw-ai-frame .split canvas`, { timeout: 60000 });
  await page.locator('.rw-body').evaluate((el) => {
    const s = el.querySelector('[data-section="rw.ai"]');
    el.scrollTo(0, s.offsetTop - 2);
  });
  await page.waitForTimeout(300);
}

async function shootSection(page, file) {
  const style = await page.addStyleTag({ content: '.rw{height:auto!important;max-height:none!important}.rw-body{overflow:visible!important}.rw-body>.section:not([data-section="rw.ai"]){display:none!important}.rw-ai-preview{position:static!important}' });
  await page.waitForTimeout(400);
  await page.locator('.rw').screenshot({ path: file });
  await style.evaluate((el) => el.remove());
  await page.waitForTimeout(200);
}

const afterPicture = (page) => page.evaluate(() => document.querySelector('.rw-ai-frame .split-b')?.toDataURL() ?? null);
const exampleKey = (page) => page.evaluate(() => document.querySelector('.rw-ai-frame')?.dataset.example ?? '');
const text = async (page, sel) => ((await page.locator(`${section} ${sel}`).textContent()) ?? '').trim();
const guardLines = (page) => page.locator(`${section} .rw-ai-guard li`).allTextContents();

/** Sets a slider of the section to `value` through its number field (a typed value, one change). */
async function setControl(page, key, value) {
  await page.locator(`${section} [data-ai="${key}"] .num`).dblclick();
  await page.locator(`${section} [data-ai="${key}"] .num input`).fill(String(value));
  await page.locator(`${section} [data-ai="${key}"] .num input`).press('Enter');
  await page.waitForTimeout(150);
}

/** Waits until the example in the frame is `key` and its picture has been drawn. */
async function waitExample(page, key) {
  await page.waitForFunction((k) => document.querySelector('.rw-ai-frame')?.dataset.example === k && document.querySelector('.rw-ai-frame')?.dataset.drawn === k, key, { timeout: 20000 });
  await page.waitForTimeout(250);
}

async function chromatic(page, root) {
  return page.evaluate((sel) => {
    const out = [];
    const grey = (c) => {
      const m = /rgba?\(([^)]+)\)/.exec(c);
      if (!m) return true;
      const [r, g, b, a] = m[1].split(',').map((x) => Number(x.trim()));
      return a === 0 || (r === g && g === b);
    };
    for (const el of document.querySelectorAll(`${sel}, ${sel} *`)) {
      if (el.closest('.split, canvas, img')) continue;
      const cs = getComputedStyle(el);
      for (const prop of ['color', 'backgroundColor', 'borderTopColor', 'borderLeftColor', 'outlineColor']) if (!grey(cs[prop])) out.push([el.className, prop, cs[prop]]);
    }
    return out;
  }, root);
}

let server = null;
let browser = null;
try {
  if (!existsSync(join(ROOT, 'dist', 'index.html'))) throw new Error('dist/ is missing: npm run build first');
  if (!existsSync(join(ROOT, 'dist', 'ai-preview', 'index.json'))) throw new Error('dist/ai-preview is missing: node tools/ai-preview-sheet.mjs, then npm run build');
  if (!BASE_URL) {
    stopServer();
    server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: 'ignore', detached: true });
    BASE_URL = `http://localhost:${PORT}`;
  }
  await waitFor(BASE_URL);
  const { chromium } = await import(join(ROOT, 'node_modules', 'playwright-core', 'index.mjs'));
  browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true, args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const STUDIO = 'example=1&lang=en&mode=fast&ai=synthetic';

  {
    const { page, context, errors, fetched } = await open(browser, `${STUDIO}&theme=dark`);
    await openAi(page);
    await waitExample(page, 'i50-l50-b50-w25-NATURAL-s25-0');
    // (a) the example as the section opens.
    const source = await text(page, '.rw-ai-source');
    const values = await text(page, '.rw-ai-values');
    const guard = await guardLines(page);
    const state = await text(page, '.rw-ai-state');
    check('a_example_opens', source === 'Example: reference scene, Full engine, test model; your render will differ' && /^Made at Intervention 50 · Light 50 · Bounces 50 · Wear and micro-detail 25 · Natural photographic 25 — yours: Bounces 40, Wear and micro-detail 20, Style strength 30$/.test(values) && guard.length > 0 && state === '', { source, values, guard, state });
    check('a_no_model_called', !/Updating/.test(state) && fetched.includes('index.json') && fetched.some((f) => f.endsWith('.webp')), { fetched: fetched.slice(0, 4) });
    await shootSection(page, join(SHOTS, 'ai-x6-example-dark.png'));

    // (b) every step of Light, at once.
    const pictures = [];
    for (const v of [0, 25, 50, 75, 100]) {
      await setControl(page, 'light', v);
      await waitExample(page, `i50-l${v}-b50-w25-NATURAL-s25-0`);
      pictures.push(await afterPicture(page));
    }
    const stateAfter = await text(page, '.rw-ai-state');
    check('b_light_steps', new Set(pictures).size === 5 && stateAfter === '', { distinct: new Set(pictures).size, stateAfter });
    await setControl(page, 'light', 50);
    const styles = [];
    await setControl(page, 'styleStrength', 100);
    for (const s of ['NATURAL', 'CATALOGUE', 'EDITORIAL', 'WARM', 'COOL', 'CINEMATIC']) {
      await page.locator(`${section} [data-ai="style"] select`).selectOption(s);
      await waitExample(page, `i50-l50-b50-w25-${s}-s100-0`);
      styles.push(await afterPicture(page));
    }
    check('b_styles', new Set(styles).size === 6, { distinct: new Set(styles).size });
    await page.locator(`${section} [data-ai="style"] select`).selectOption('WARM');
    await waitExample(page, 'i50-l50-b50-w25-WARM-s100-0');
    await shootSection(page, join(SHOTS, 'ai-x6-style.png'));
    await setControl(page, 'intervention', 0);
    await waitExample(page, 'i0-l50-b50-w25-NATURAL-s25-0');
    const offValues = await text(page, '.rw-ai-values');
    check('b_intervention_zero', /^Made at Intervention 0$/.test(offValues), { offValues });
    await setControl(page, 'intervention', 50);

    // (c) what each control acts on.
    const hows = await page.locator(`${section} [data-how]`).evaluateAll((els) => els.map((e) => [e.dataset.how, e.textContent]));
    check('c_how_lines', hows.length === 6 && /strength of 0\.3\b/.test(hows.find((h) => h[0] === 'intervention')?.[1] ?? ''), { hows });

    // (d) the person's own scene, with the Full engine.
    await page.locator(`${section} [data-ai-run]`).click();
    await page.waitForFunction(() => /\d+ × \d+ px/.test(document.querySelector('.rw-ai-state')?.textContent ?? ''), null, { timeout: 300000 });
    const mine = await text(page, '.rw-ai-source');
    const report = await text(page, '.rw-ai-report');
    const mineGuard = await guardLines(page);
    check('d_mine', /^Your scene · Full engine · /.test(mine) && /^Checked: /.test(report) && mineGuard.length > 0, { mine, report, mineGuard });
    await shootSection(page, join(SHOTS, 'ai-x6-mine.png'));
    await setControl(page, 'bounce', 75);
    await page.waitForTimeout(300);
    const back = await text(page, '.rw-ai-source');
    const again = await text(page, '[data-ai-run]');
    check('d_back_to_example', /^Example:/.test(back) && /again/.test(again), { back, again });
    const dark = await chromatic(page, section);
    check('e_achromatic_dark', dark.length === 0, { found: dark.slice(0, 6) });
    check('no_errors_dark', errors.length === 0, { errors });
    await context.close();
  }
  {
    const { page, context, errors } = await open(browser, `${STUDIO}&theme=light`);
    await openAi(page);
    await waitExample(page, 'i50-l50-b50-w25-NATURAL-s25-0');
    await shootSection(page, join(SHOTS, 'ai-x6-example-light.png'));
    const light = await chromatic(page, section);
    check('e_achromatic_light', light.length === 0, { found: light.slice(0, 6) });
    check('no_errors_light', errors.length === 0, { errors });
    await context.close();
  }
  {
    const { page, context, errors } = await open(browser, 'example=1&lang=es&mode=fast&ai=synthetic&theme=dark');
    await openAi(page);
    await waitExample(page, 'i50-l50-b50-w25-NATURAL-s25-0');
    const source = await text(page, '.rw-ai-source');
    const values = await text(page, '.rw-ai-values');
    const run = await text(page, '[data-ai-run]');
    check('e_spanish', /^Ejemplo: escena de referencia, motor Completo, modelo de prueba/.test(source) && /^Hecho con Intervención 50/.test(values) && /Vista previa de mi escena/.test(run), { source, values, run });
    await shootSection(page, join(SHOTS, 'ai-x6-example-es.png'));
    check('no_errors_es', errors.length === 0, { errors });
    await context.close();
  }
} catch (e) {
  check('crashed', false, { error: String(e?.stack ?? e) });
} finally {
  await browser?.close();
  if (server) stopServer();
  writeFileSync(join(ROOT, 'out', 'ai-x6-check.json'), JSON.stringify(results, null, 2));
  const failed = Object.entries(results).filter(([, v]) => !v.ok);
  console.log(failed.length === 0 ? `all ${Object.keys(results).length} checks passed` : `${failed.length} failed: ${failed.map(([k]) => k).join(', ')}`);
  process.exit(failed.length === 0 ? 0 : 1);
}
