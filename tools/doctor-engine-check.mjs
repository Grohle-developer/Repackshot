#!/usr/bin/env node
// Browser check of the Doctor's engine checks (phase D1), with the local Chromium, swiftshader and the real rt.wasm.
//
//   npm run engine:build && npm run build && node tools/doctor-engine-check.mjs [--shots docs/ui] [--url http://host:port]
//
// Without --url it serves dist/ with `vite preview` on port 4194 and stops it at the end.
//
//   (a) the Full viewport accumulates and the Doctor lists the engine checks (Engine, SIMD, Denoising, View transform, Fireflies,
//       Output format, Time budget) as the real engine reports them: workers and SIMD OK, the fireflies read from the real
//       accumulation once it has samples (a verdict, never "measuring" for ever), a time budget by samples is fine;
//   (b) Settings ▸ Render engine ▸ SIMD Off restarts the engine and the Doctor warns that the scalar build runs, with a
//       Settings button (not a Fix) that opens the Settings window at that row, and nothing was changed by the Doctor;
//   (c) Render settings ▸ Advanced ▸ Denoise ▸ Viewport and Finish by Time at 5 s: the Doctor warns about the denoise (the
//       Render would come out noisy) and, once the speed is measured, about the time budget, both with a Fix; the shot
//       docs/ui/doctor-engine.png shows the popover with those and the SIMD one;
//   (d) Fix all clears the two the project can change in one undo step and leaves the SIMD one with its explanation; one undo
//       gives both back.
//
// Results: out/doctor-engine-check.json.

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

const settle = (page, ms = 300) => page.waitForTimeout(ms);

/** Polls `fn` in the page until it returns something truthy, or null after `ms`. */
async function until(page, fn, ms = 60000, step = 100) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await page.waitForTimeout(step);
  }
  return null;
}

/** What the viewport's meter says. */
const meter = (page) =>
  page.evaluate(() => {
    const d = document.querySelector('.ov-bl')?.dataset ?? {};
    return { mode: d.mode ?? '', samples: Number(d.samples ?? 0), scale: Number(d.scale ?? 1) };
  });

/** The rows of the Doctor popover (open it first). */
const doctorRows = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('.doctor .doctor-row')].map((r) => {
      const button = r.querySelector('button');
      return {
        title: r.querySelector('.doctor-title')?.textContent ?? '',
        warn: r.classList.contains('is-warn'),
        note: r.querySelector('.note')?.textContent ?? '',
        button: button?.textContent ?? null,
        aux: button ? null : (r.querySelector('.aux')?.textContent ?? null),
      };
    }),
  );
const row = (rows, title) => rows.find((r) => r.title === title);

async function openDoctor(page) {
  if (await page.locator('.doctor').count()) return;
  await page.locator('button.doctor-btn').first().click();
  await page.waitForSelector('.doctor', { timeout: 5000 });
  await settle(page, 200);
}
async function closeDoctor(page) {
  if (!(await page.locator('.doctor').count())) return;
  await page.keyboard.press('Escape');
  await settle(page, 200);
}

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

let BASE_URL = BASE;
let server = null;
let browser = null;
try {
  if (!existsSync(join(ROOT, 'dist', 'index.html'))) fail('dist/ is missing: npm run build first');
  if (!existsSync(join(ROOT, 'dist', 'engine', 'rt.wasm'))) fail('dist/engine/rt.wasm is missing: npm run engine:build, then npm run build');
  if (!BASE_URL) {
    stopServer();
    server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: 'ignore', detached: true });
    BASE_URL = `http://localhost:${PORT}`;
  }
  await waitFor(BASE_URL);
  const { chromium } = await import('playwright-core');
  browser = await chromium.launch({ executablePath: findChromium(), headless: true, args: ['--no-sandbox', '--disable-gpu', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });

  // ------------------------------------------------------------------ (a) the engine as it is
  {
    const { page, context, errors } = await open(browser, 'example=1&theme=dark&lang=en&mode=full&tour=0');
    const m = await until(page, async () => ((await meter(page)).samples >= 40 ? await meter(page) : null), 180000, 250);
    check('a_full_viewport_accumulates', m !== null, { meter: m });
    await openDoctor(page);
    // The fireflies are read from the accumulation once it has a few samples; give the tick (1 s) time to hand them in.
    const waiting = /Measuring|Needs the|still loading/i;
    const read = await until(page, async () => {
      const r = await doctorRows(page);
      return waiting.test(row(r, 'Fireflies')?.note ?? '') ? null : r;
    }, 30000, 250);
    const rows = read ?? (await doctorRows(page));
    for (const title of ['Engine', 'SIMD', 'Denoising', 'View transform', 'Fireflies', 'Output format', 'Time budget']) check(`a_lists_${title.replace(/ /g, '_').toLowerCase()}`, row(rows, title) !== undefined);
    const text = (title) => row(rows, title)?.note ?? '';
    check('a_engine_ok', row(rows, 'Engine')?.warn === false && row(rows, 'Engine')?.aux === 'OK', { engine: row(rows, 'Engine') });
    check('a_simd_ok', row(rows, 'SIMD')?.warn === false && row(rows, 'SIMD')?.aux === 'OK', { simd: row(rows, 'SIMD') });
    check('a_denoise_ok', row(rows, 'Denoising')?.warn === false, { denoise: row(rows, 'Denoising') });
    check('a_budget_ok_by_samples', row(rows, 'Time budget')?.warn === false, { budget: row(rows, 'Time budget') });
    // Fireflies and the view transform of the example are the scene's to say; what matters is that they are read from the real accumulation.
    const fireflies = row(rows, 'Fireflies');
    check('a_fireflies_read_from_the_real_accumulation', fireflies !== undefined && !waiting.test(text('Fireflies')), { fireflies });
    check('a_engine_rows_are_not_in_the_old_words', !rows.some((r) => /Cycles|Blender|Persistent|Light tree/i.test(r.note) && r.title !== 'Light tree' && r.title !== 'Persistent data'), {});
    await closeDoctor(page);
    check('a_no_errors', errors.length === 0, { errors });
    await context.close();
  }

  // ------------------------------------------------------------------ (b) SIMD Off, in Settings
  {
    const { page, context, errors } = await open(browser, 'example=1&theme=dark&lang=en&mode=full&tour=0&settings=engine.simd');
    await page.waitForSelector('[data-settings-window]', { timeout: 10000 });
    const simdRow = page.locator('[data-settings-window] [data-row="engine.simd"]');
    await simdRow.locator('button', { hasText: /^Off$/ }).first().click();
    await settle(page, 300);
    await page.keyboard.press('Escape');
    await settle(page, 300);
    // The engine restarts with the scalar build and the Doctor says so.
    const m = await until(page, async () => ((await meter(page)).samples >= 4 ? await meter(page) : null), 180000, 250);
    check('b_engine_restarted_scalar', m !== null, { meter: m });
    const before = await page.evaluate(() => document.querySelector('[data-mode]')?.getAttribute('data-mode') ?? '');
    await openDoctor(page);
    const simd = await until(page, async () => (row(await doctorRows(page), 'SIMD')?.warn ? row(await doctorRows(page), 'SIMD') : null), 30000, 250);
    check('b_simd_warns', simd !== null && /SIMD is Off in Settings/.test(simd.note), { simd, before });
    check('b_simd_has_a_settings_button_and_no_fix', simd?.button === 'Settings', { simd });
    // The button opens Settings at that row; the Doctor did not change any setting.
    await page.locator('.doctor-row', { has: page.locator('.doctor-title', { hasText: /^SIMD$/ }) }).locator('button').click();
    await page.waitForSelector('[data-settings-window]', { timeout: 10000 });
    const focus = await page.evaluate(() => document.querySelector('[data-settings-window] [data-row="engine.simd"]')?.getBoundingClientRect().height ?? 0);
    const off = await page.evaluate(() => [...document.querySelectorAll('[data-settings-window] [data-row="engine.simd"] button')].find((b) => b.getAttribute('aria-pressed') === 'true')?.textContent ?? '');
    check('b_opens_settings_at_the_row', focus > 0 && off === 'Off', { height: focus, pressed: off });
    // (c) and (d) go on in this page: SIMD stays Off, so its warning is in the popover for the shot.
    await page.keyboard.press('Escape');
    await settle(page, 300);

    // ---------------------------------------------------------------- (c) denoise in the viewport only, a time budget of 5 s
    await page.locator('canvas[aria-label="viewport"]').focus();
    await page.keyboard.press('Control+Enter');
    await page.waitForSelector('.rw[role="dialog"]', { timeout: 10000 });
    const adv = page.locator('.rw [data-section="rw.advanced"]');
    if ((await adv.getAttribute('data-collapsed')) !== null) await adv.locator('.section-head').click();
    await settle(page, 300);
    await page.locator('.rw [role="group"][aria-label="Denoise"] button, .rw [aria-label="Denoise"] button', { hasText: /^Viewport$/ }).first().click();
    await page.locator('.rw [aria-label="Finish by"] button', { hasText: /^Time$/ }).first().click();
    await settle(page, 300);
    // The time budget is a number field (U15): typed after a double click, as a time or plain seconds.
    await page.locator('.rw [role="spinbutton"][aria-label="Time"]').first().dblclick();
    await page.keyboard.press('Control+A');
    await page.keyboard.type('5');
    await page.keyboard.press('Enter');
    await settle(page, 300);
    await page.keyboard.press('Escape');
    await settle(page, 300);
    await page.locator('canvas[aria-label="viewport"]').focus();
    await openDoctor(page);
    // The speed is measured by the meter once the viewport has run a couple of seconds.
    const rows = await until(page, async () => {
      const r = await doctorRows(page);
      return row(r, 'Denoising')?.warn && row(r, 'Time budget')?.warn ? r : null;
    }, 60000, 250);
    const all = rows ?? (await doctorRows(page));
    const denoise = row(all, 'Denoising');
    const budget = row(all, 'Time budget');
    check('c_denoise_warns_with_a_fix', denoise?.warn === true && denoise.button === 'Fix' && /off for the Render/.test(denoise.note), { denoise });
    check('c_budget_warns_with_a_fix_and_the_measured_speed', budget?.warn === true && budget.button === 'Fix' && /A budget of 5 s reaches only \d+ of the 64 samples of a Draft/.test(budget.note), { budget });
    const count = await page.evaluate(() => document.querySelector('button.doctor-btn')?.textContent ?? '');
    const warned = all.filter((r) => r.warn).length;
    check('c_status_bar_counts_the_warnings', warned >= 3 && count.includes(`${warned} warnings`), { count, warned });
    await page.screenshot({ path: join(SHOTS, 'doctor-engine.png') });

    // ---------------------------------------------------------------- (d) Fix all
    const undoTip = () => page.evaluate(() => document.querySelector('.hdr-center .icon-btn')?.getAttribute('data-tip') ?? '');
    const undoBefore = await undoTip();
    await page.locator('.doctor button', { hasText: /^Fix all$/ }).click();
    await settle(page, 600);
    const after = await doctorRows(page);
    check('d_fix_all_clears_the_project_ones', row(after, 'Denoising')?.warn === false && row(after, 'Time budget')?.warn === false, { denoise: row(after, 'Denoising'), budget: row(after, 'Time budget') });
    check('d_simd_stays_with_its_explanation', row(after, 'SIMD')?.warn === true && row(after, 'SIMD')?.button === 'Settings', { simd: row(after, 'SIMD') });
    const undoAfter = await undoTip();
    check('d_one_undo_step', /Doctor: fix all/.test(undoAfter), { undoBefore, undoAfter });
    await closeDoctor(page);
    await page.locator('canvas[aria-label="viewport"]').focus();
    await page.keyboard.press('Control+z');
    await settle(page, 400);
    await openDoctor(page);
    const back = await doctorRows(page);
    check('d_undo_gives_both_back', row(back, 'Denoising')?.warn === true && row(back, 'Time budget')?.warn === true, { denoise: row(back, 'Denoising')?.warn, budget: row(back, 'Time budget')?.warn });
    check('b_c_d_no_errors', errors.length === 0, { errors });
    await context.close();
  }

  writeFileSync(join(OUT, 'doctor-engine-check.json'), JSON.stringify(results, null, 2));
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
