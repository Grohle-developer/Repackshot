#!/usr/bin/env node
// Browser checks of phase L5 in the built app (IES lights), with the local Chromium and swiftshader, in Fast and in Full mode.
//
//   npm run build && node tools/ies-check.mjs [--url http://localhost:4278] [--shots docs/ui] [--only fast,full]
//
// Without --url it serves dist/ with `vite preview` on port 4278 and stops it at the end. Full mode needs dist/engine/rt.wasm
// (`npm run engine:build` before the build); without it that part is skipped and says so.
//
//   adding     the Lights tab's Add light lists IES… as an entry that is no longer "coming soon"; it opens the file chooser;
//              a profile (tests/fixtures/ies/wall-washer.ies) becomes a light, selected, with the profile's name, its polar plot
//              (two curves for a profile that is not round, one for the downlight), the multiplier at × 1, and the note that
//              Fast draws it as a spot light; one undo takes it away;
//   refusal    a file that is not a profile the engine reads (TILT=INCLUDE) adds nothing and says why in a toast;
//   editing    the multiplier doubles the lumens and is one undo entry; Change… takes another file for the same light and keeps
//              its place and its level (the plot changes to one curve); the type goes to Point and back, the profile staying;
//   full       the same light, rendered in Full mode for a few samples with the engine reading the profile.
//
// Screenshots (docs/ui): ies-light.png (Fast: an IES light selected with its polar plot), ies-light-full.png (Full; the canvas
// only). Results: out/ies-check.json.

import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4278;

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

const WASHER = join(ROOT, 'tests/fixtures/ies/wall-washer.ies');
const DOWNLIGHT = join(ROOT, 'tests/fixtures/ies/downlight-symmetric.ies');
const BAD = join(OUT, 'tilt-include.ies');
writeFileSync(BAD, readFileSync(DOWNLIGHT, 'utf8').replace('TILT=NONE', 'TILT=INCLUDE'));

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
const canvas = (page) => page.locator('canvas[aria-label="viewport"]');

async function lightsTab(page) {
  await page.locator('.side-left [role="tab"]', { hasText: 'Lights' }).click();
  await settle(page);
}

/** Add light ▸ IES…, choosing `file` in the chooser it opens. Returns the menu's entries. */
async function addIes(page, file) {
  await lightsTab(page);
  await page.click('[data-add="light"]');
  await settle(page, 150);
  const entries = await page.locator('.floating .menu-item').allTextContents();
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.locator('.floating .menu-item', { hasText: /^IES…/ }).click()]);
  await chooser.setFiles(file);
  await settle(page, 400);
  return entries;
}

/** What the page shows of the selected light's profile. */
const iesState = (page) =>
  page.evaluate(() => {
    const block = document.querySelector('[data-field="ies"]');
    const shown = !!block && block.style.display !== 'none';
    const mult = document.querySelector('[data-field="light"] [role="spinbutton"][aria-label="Multiplier"]');
    return {
      shown,
      name: document.querySelector('[data-field="ies-name"]')?.textContent ?? '',
      curves: [...document.querySelectorAll('[data-ies-plot] .ies-plot-curve')].map((c) => c.getAttribute('data-plane')),
      legend: [...document.querySelectorAll('.ies-plot-key')].map((k) => k.textContent),
      info: document.querySelector('[data-field="ies-info"]')?.textContent ?? '',
      note: document.querySelector('[data-field="ies-approx"]')?.textContent ?? '',
      multiplier: mult ? Number(mult.getAttribute('aria-valuenow')) : null,
      multiplierRow: !!mult && mult.closest('.field')?.style.display !== 'none',
      powerRow: !!document.querySelector('[data-field="light"] [role="spinbutton"][aria-label="Power"]')?.closest('.field') && document.querySelector('[data-field="light"] [role="spinbutton"][aria-label="Power"]').closest('.field').style.display !== 'none',
      lumens: document.querySelector('[data-field="lumens"]')?.textContent ?? '',
      rows: [...document.querySelectorAll('.light-row .list-main > div:first-child')].map((n) => n.textContent),
      crumb: document.querySelector('.crumbs')?.textContent ?? '',
      undo: document.querySelector('.hdr button[aria-label="Undo"]')?.getAttribute('data-tip') ?? null,
      toast: [...document.querySelectorAll('.toast')].map((n) => n.textContent),
    };
  });

const lumensOf = (s) => Number(/≈ ([\d.,]+) lm/.exec(s.lumens)?.[1].replace(/,/g, '') ?? NaN);

async function undo(page) {
  await page.keyboard.press('Control+z');
  await settle(page, 150);
}

async function typeInto(page, locator, value) {
  await locator.dblclick();
  await settle(page);
  await page.keyboard.press('Control+a');
  await page.keyboard.type(String(value));
  await page.keyboard.press('Enter');
  await settle(page, 150);
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

async function fast(browser) {
  const { page, context, errors } = await open(browser, 'example=1&theme=dark&mode=fast');
  const f = [];
  const log = {};

  // Add light ▸ IES…: no longer coming soon; the file becomes a selected light with its name and its polar plot.
  await lightsTab(page);
  const before = (await iesState(page)).rows.length;
  const entries = await addIes(page, WASHER);
  ok(entries.length === 7 && entries[6].startsWith('IES…') && !/coming soon/.test(entries[6]), `Add light ▸ lists IES… as a live entry: ${entries.join(' | ')}`, f);
  let s = await iesState(page);
  log.added = s;
  ok(s.rows.length === before + 1 && s.rows.at(-1)?.startsWith('IES'), `the Lights tab lists the new light: ${s.rows}`, f);
  ok(s.shown && s.name === 'Test wall washer, asymmetric (all 360 degrees given)', `the profile's name is shown: ${s.name}`, f);
  ok(s.curves.join() === 'C0,C90', `the polar plot has the two planes: ${s.curves}`, f);
  ok(/Peak 900 cd/.test(s.info) && /beam \d+°/.test(s.info), `what the file says of itself: ${s.info}`, f);
  ok(/approximation/.test(s.note) && /Fast/.test(s.note), `the note says Fast approximates: ${s.note}`, f);
  ok(s.multiplierRow && s.multiplier === 1 && !s.powerRow, `the multiplier (× 1) stands for the power: ${s.multiplier}`, f);
  ok(s.undo === 'Undo: Add IES light Test wall washer, asymmetric (all 360 degrees given)', `one undo entry: ${s.undo}`, f);
  const lm0 = lumensOf(s);
  ok(lm0 > 0, `the lumens come from the file: ${s.lumens}`, f);
  // The picture: the light selected, its plot in the inspector.
  await page.mouse.move(10, 500);
  await settle(page, 300);
  await page.screenshot({ path: join(SHOTS, 'ies-light.png') });

  // The multiplier: × 2 doubles the lumens, one undo entry; undo.
  await typeInto(page, page.locator('[data-field="light"] [role="spinbutton"][aria-label="Multiplier"]'), 2);
  s = await iesState(page);
  ok(Math.abs(lumensOf(s) / lm0 - 2) < 0.01 && s.multiplier === 2, `× 2 doubles the lumens: ${lm0} → ${lumensOf(s)}`, f);
  ok(/^Undo: Edit light/.test(s.undo ?? ''), `an undo entry for the multiplier: ${s.undo}`, f);
  await undo(page);
  s = await iesState(page);
  ok(s.multiplier === 1 && Math.abs(lumensOf(s) - lm0) < 0.01, `undo puts it back: ${s.multiplier}`, f);

  // Change… takes another file for the same light: the downlight is round, so one curve; the level stays.
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('[data-action="light.iesChange"]')]);
  await chooser.setFiles(DOWNLIGHT);
  await settle(page, 400);
  s = await iesState(page);
  ok(s.name === 'Test downlight, 1000 cd cos^2, rotationally symmetric' && s.curves.join() === 'C0', `Change… brings the downlight: ${s.name} ${s.curves}`, f);
  ok(s.rows.length === before + 1 && s.multiplier === 1, `the same light, the same level: ${s.rows.length} ${s.multiplier}`, f);
  ok(/^Undo: Change the IES profile/.test(s.undo ?? ''), `one undo entry: ${s.undo}`, f);
  await undo(page);
  ok((await iesState(page)).name.startsWith('Test wall washer'), 'undo brings the wall washer back', f);

  // The type goes to Point and the profile is hidden; back to IES it is there again.
  await page.locator('[data-field="light"] [role="radio"], [data-field="light"] button', { hasText: /^Point$/ }).first().click();
  await settle(page, 200);
  ok(!(await iesState(page)).shown, 'as a point the profile is not shown', f);
  await page.locator('[data-field="light"] [role="radio"], [data-field="light"] button', { hasText: /^IES$/ }).first().click();
  await settle(page, 200);
  s = await iesState(page);
  ok(s.shown && s.name.startsWith('Test wall washer'), `back to IES the profile is there: ${s.name}`, f);

  // A file the engine would refuse: nothing is added and the toast says why.
  const n = s.rows.length;
  await addIes(page, BAD);
  s = await iesState(page);
  log.refused = s.toast;
  ok(s.rows.length === n, `a refused file adds no light: ${s.rows.length} against ${n}`, f);
  ok(s.toast.some((t) => /TILT=INCLUDE/.test(t) && /TILT=NONE/.test(t)), `the toast says why: ${s.toast}`, f);

  // One undo takes the whole light away.
  await undo(page);
  await undo(page);
  ok(errors.length === 0, `page errors: ${errors.join(' | ')}`, f);
  await context.close();
  return { failures: f, log };
}

async function full(browser) {
  if (!existsSync(join(ROOT, 'dist', 'engine', 'rt.wasm'))) return { skipped: 'dist/engine/rt.wasm is missing (npm run engine:build, then npm run build)' };
  const { page, context, errors } = await open(browser, 'example=1&theme=dark&mode=full');
  const f = [];
  await waitFull(page);
  await addIes(page, WASHER);
  // The setup's lights off, so the pool of the profile shows; the multiplier up for the picture.
  for (const name of ['Key', 'Fill', 'Rim']) {
    await page.locator('.light-row', { hasText: new RegExp(`^${name}`) }).locator('.toggle').click();
    await settle(page);
  }
  await typeInto(page, page.locator('[data-field="light"] [role="spinbutton"][aria-label="Multiplier"]'), 6);
  await page.click('.ov-tl [data-glyphs]');
  await page.mouse.move(10, 500);
  await waitSamples(page, 32);
  const b = await canvas(page).boundingBox();
  await page.screenshot({ path: join(SHOTS, 'ies-light-full.png'), clip: b });
  const s = await iesState(page);
  ok(s.shown && s.name.startsWith('Test wall washer'), `Full: the light keeps its profile: ${s.name}`, f);
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
}
writeFileSync(join(OUT, 'ies-check.json'), JSON.stringify(results, null, 2));
const failures = Object.entries(results).flatMap(([k, r]) => (r.failures ?? []).map((x) => `${k}: ${x}`));
for (const [k, r] of Object.entries(results)) if (r.skipped) console.log(`${k}: skipped — ${r.skipped}`);
if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('ies-check: all good', JSON.stringify(results.fast?.log ?? {}).slice(0, 600));
