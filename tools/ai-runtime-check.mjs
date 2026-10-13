#!/usr/bin/env node
// Browser checks of phase U10 on the desktop: the warnings about the AI inference runtime, the portable's first-start
// chooser and the guided tour with its state in the data folder, in the desktop launcher's window
// (engine/crates/rt-app) with the local Chromium and swiftshader.
//
//   npm run build && (cd engine && cargo build -p rt-app) && node tools/ai-runtime-check.mjs [--shots docs/ui] [--bin engine/target/release/repackshot]
//
// It copies the launcher into a portable folder of its own (out/runtime-check/<n>/, data in its data/), starts it with
// `--serve-only --app-dir dist`, opens the URL it prints and drives the page. The launcher is stopped through its pid.
// A real download needs the network, which the checks do not: what is asserted of Install is the request the page sends
// and what the notice says once the launcher answers; the launcher side (a download that completes, the installer's
// choice started at the first launch) is tested over sockets in engine/crates/rt-app/tests/ai.rs.
//
//   first    a portable's first start opens the model chooser, which offers the runtime beside the models, ticked; with the
//            box ticked, starting a model's download also asks the launcher for the runtime (POST /api/ai/runtimes/<key>/
//            download); with the box unticked, it does not; the tour waits for the chooser to close and then starts, and
//            finishing it writes `tourSeen` into settings.json of the data folder, never into the browser's storage;
//   none     with no model installed nothing is said of the runtime: no notice, no marker, no note in the status bar;
//   warned   with a model installed and no runtime: the AI section of the render window says it, with Install and the size,
//            and its folded title carries a marker; Settings ▸ AI post-processing says it at the top; the status bar has
//            one quiet note at the start (once: Later hides it and a reload of the page is a new session, so it is back);
//            Install sends the launcher's download request and the notice then says what the launcher answered;
//   vc       (the launcher's answer for an installed build that does not start without Microsoft's Visual C++ runtime, put
//            in by the check, as a Linux computer cannot have it) the notice says so, with the button that opens Microsoft's
//            page through the launcher and Check again, which asks the launcher to probe;
//   fine     an installed runtime that starts says nothing.
//
// Screenshots (docs/ui, English): ai-runtime-warning-render.png, ai-runtime-warning-settings.png, ai-runtime-chooser.png,
// ai-runtime-note.png. Results: out/ai-runtime-check.json.

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const SHOTS = resolve(ROOT, opt('shots', 'docs/ui'));
const BIN = resolve(ROOT, opt('bin', 'engine/target/debug/repackshot'));
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

const sha = (b) => createHash('sha256').update(b).digest('hex');
function bytes(n, seed) {
  const out = Buffer.alloc(n);
  let x = seed >>> 0;
  for (let i = 0; i < n; i++) {
    x = (Math.imul(x, 1103515245) + 12345) >>> 0;
    out[i] = x >>> 24;
  }
  return out;
}

let runN = 0;
/** The launcher in a portable folder of its own; resolves with its URL, its data folder and how to stop it. */
function startLauncher() {
  if (!existsSync(BIN)) fail(`${BIN} is missing: (cd engine && cargo build -p rt-app)`);
  if (!existsSync(join(ROOT, 'dist', 'index.html'))) fail('dist/ is missing: npm run build first');
  const dir = join(OUT, 'runtime-check', String(++runN));
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const exe = join(dir, 'repackshot');
  copyFileSync(BIN, exe);
  chmodSync(exe, 0o755);
  writeFileSync(join(dir, 'portable.txt'), '');
  const port = 4200 + runN;
  const child = spawn(exe, ['--serve-only', '--app-dir', join(ROOT, 'dist'), '--port', String(port)], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
  return new Promise((resolveUrl, reject) => {
    let text = '';
    const timer = setTimeout(() => reject(new Error(`the launcher printed no URL: ${text}`)), 20000);
    const read = (chunk) => {
      text += chunk.toString();
      const m = /http:\/\/127\.0\.0\.1:\d+\/#token=[0-9a-f]{32}/.exec(text);
      if (m) {
        clearTimeout(timer);
        resolveUrl({ url: m[0], data: join(dir, 'data'), stop: () => child.kill('SIGTERM'), log: () => text });
      }
    };
    child.stdout.on('data', read);
    child.stderr.on('data', read);
    child.on('exit', (code) => reject(new Error(`the launcher exited (${code}): ${text}`)));
  });
}

function findChromium() {
  for (const p of ['/opt/pw-browsers/chromium', ...[1194, 1200, 1217].map((v) => `/opt/pw-browsers/chromium-${v}/chrome-linux/chrome`)]) if (existsSync(p) && p !== '/opt/pw-browsers/chromium') return p;
  return '/opt/pw-browsers/chromium';
}

const chromium = (await import(join(ROOT, 'node_modules', 'playwright-core', 'index.mjs'))).chromium;
const browser = await chromium.launch({ executablePath: findChromium(), headless: true, args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const launchers = [];

/** A page in a launcher: records the API calls, and lets a test answer some of them. */
async function openPage(launcher, query) {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
  // The checks never reach the network: a model or a runtime that starts downloading fails at once and quietly.
  await context.route((url) => !['127.0.0.1', 'localhost'].includes(url.hostname), (route) => route.abort('failed'));
  const page = await context.newPage();
  const errors = [];
  const calls = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && !m.text().startsWith('Failed to load resource') && errors.push(m.text()));
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (u.pathname.startsWith('/api/') && u.pathname !== '/api/alive' && !u.pathname.startsWith('/api/render')) calls.push(`${r.method()} ${u.pathname}${r.postData() ? ` ${r.postData().slice(0, 200)}` : ''}`);
  });
  await page.goto(launcher.url.replace('/#', `/?${query}#`));
  await page.waitForSelector('#app[data-ready="1"]', { timeout: 90000 });
  return { page, context, errors, calls };
}

/** Folds or unfolds the AI section of the render window (its state is remembered, so it is set, not toggled). */
async function aiSection(page, open) {
  const section = page.locator('[data-render-window] [data-guide="section-rw.ai"]');
  const folded = (await section.getAttribute('data-collapsed')) !== null;
  if (folded === open) await section.locator('.section-head').click();
  await page.waitForFunction((want) => (document.querySelector('[data-render-window] [data-guide="section-rw.ai"]')?.getAttribute('data-collapsed') === null) === want, open);
}

/** The status of the runtime: `/api/ai/runtime`, with or without its query (not `/api/ai/runtimes/<key>`). */
const STATUS = /\/api\/ai\/runtime(\?.*)?$/;

const settle = (page, ms = 80) => page.evaluate((wait) => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, wait)))), ms);
const visible = (page, sel) => page.evaluate((s) => [...document.querySelectorAll(s)].some((e) => e.getClientRects().length > 0 && !e.hidden), sel);
const text = (page, sel) => page.evaluate((s) => [...document.querySelectorAll(s)].filter((e) => e.getClientRects().length > 0).map((e) => e.textContent.replace(/\s+/g, ' ').trim()).join(' | '), sel);

/**
 * A small model in the launcher's store, written through its own API with the token (what the page does for an import;
 * the dialogs of the desktop window are the system's and a check has none): the blob, its check, the manifest, the
 * installed mark.
 */
async function seedModel(launcher) {
  const token = /token=([0-9a-f]{32})/.exec(launcher.url)[1];
  const base = launcher.url.replace(/\/#.*$/, '');
  const call = async (method, path, body, type = 'application/json') => {
    const res = await fetch(`${base}${path}`, { method, headers: { 'X-Repackshot-Token': token, 'Content-Type': type }, body });
    if (!res.ok) fail(`${method} ${path}: ${res.status} ${await res.text()}`);
    return res;
  };
  const data = bytes(1024 * 1024 + 7, 3);
  const digest = sha(data);
  await call('PUT', `/api/models/blobs/${digest}?offset=0&total=${data.length}`, data, 'application/octet-stream');
  await call('POST', `/api/models/blobs/${digest}/finish?bytes=${data.length}`);
  await call(
    'PUT',
    '/api/models/imported/RT_CHECK',
    JSON.stringify({
      format: 'repackshot-model',
      schema: 1,
      key: 'RT_CHECK',
      name: 'Runtime check model',
      family: 'sd15',
      role: 'img2img',
      quantization: 'fp16',
      licence: { spdx: 'Apache-2.0', url: 'https://www.apache.org/licenses/LICENSE-2.0', commercialUse: true },
      files: [{ name: 'check.gguf', role: 'transformer', bytes: data.length, sha256: digest }],
      capabilities: { strength: true, referenceEdit: false, control: [] },
      source: 'tools/ai-runtime-check.mjs',
    }),
  );
  await call('POST', '/api/models/installed', JSON.stringify({ key: 'RT_CHECK' }));
}

try {
  // ---------------------------------------------------------------- the first start of a portable, with the box ticked
  {
    const launcher = await startLauncher();
    launchers.push(launcher);
    const { page, context, errors, calls } = await openPage(launcher, 'lang=en&theme=dark&mode=fast&example=1&tour=auto');
    await page.waitForSelector('.sw .sw-chooser', { state: 'visible', timeout: 30000 });
    await page.waitForSelector('.sw [data-chooser-runtime] input, .sw [data-chooser-runtime] button', { timeout: 30000 });
    await settle(page, 300);
    const row = await text(page, '.sw [data-chooser-runtime]');
    const ticked = await page.evaluate(() => document.querySelector('.sw [data-chooser-runtime] [role="switch"]')?.getAttribute('aria-checked'));
    await page.mouse.move(5, 995);
    await page.screenshot({ path: join(SHOTS, 'ai-runtime-chooser.png') });
    // The tour is waiting: the chooser is up.
    const tourDuring = await visible(page, '[data-tour]');
    // Start a model's download from the list: the licence first, then the runtime goes with it.
    const firstRow = page.locator('.sw [data-model]:not([data-state="UNAVAILABLE"]) button', { hasText: 'Download' }).first();
    await firstRow.click();
    const accept = page.locator('.sw .sw-licence-panel button.btn-primary').first();
    if (await accept.count()) await accept.click();
    await page.waitForFunction(() => true);
    await settle(page, 1200);
    const asked = calls.filter((c) => /^POST \/api\/ai\/runtimes\/[A-Z0-9_]+\/download/.test(c));
    check('chooser_offers_the_runtime', /Also download the inference runtime \((CPU|Vulkan) · [\d.]+ MB\)/.test(row) && ticked === 'true', { row, ticked });
    check('chooser_ticked_downloads_the_runtime_with_the_first_model', asked.length >= 1, { asked, calls: calls.filter((c) => c.includes('/api/ai/')).slice(0, 12) });
    check('tour_waits_for_the_chooser', tourDuring === false, { tourDuring });
    // Done, close Settings: the tour comes.
    await page.locator('.sw .sw-chooser button', { hasText: 'Done' }).click();
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !!document.querySelector('[data-tour]'), null, { timeout: 30000 });
    check('tour_starts_after_the_chooser', await visible(page, '[data-tour]'));
    await page.keyboard.press('Escape');
    await settle(page, 600);
    const disk = JSON.parse(readFileSync(join(launcher.data, 'settings.json'), 'utf8'));
    const storage = await page.evaluate(() => ({ local: Object.keys(localStorage), session: Object.keys(sessionStorage).filter((k) => k !== 'repackshot.token') }));
    check('tour_seen_is_in_the_data_folder', disk?.layout?.tourSeen === true && storage.local.length === 0 && storage.session.length === 0, { tourSeen: disk?.layout?.tourSeen, storage });
    check('no_errors_chooser', errors.length === 0, { errors });
    await context.close();
    launcher.stop();
  }

  // ---------------------------------------------------------------- the same, with the box unticked
  {
    const launcher = await startLauncher();
    launchers.push(launcher);
    const { page, context, calls } = await openPage(launcher, 'lang=en&theme=dark&mode=fast&example=1&tour=0');
    await page.waitForSelector('.sw .sw-chooser', { state: 'visible', timeout: 30000 });
    await page.waitForSelector('.sw [data-chooser-runtime] button', { timeout: 30000 });
    await page.locator('.sw [data-chooser-runtime] button').first().click();
    await settle(page, 200);
    const unticked = await page.evaluate(() => document.querySelector('.sw [data-chooser-runtime] button')?.getAttribute('aria-checked'));
    await page.locator('.sw [data-model]:not([data-state="UNAVAILABLE"]) button', { hasText: 'Download' }).first().click();
    const accept = page.locator('.sw .sw-licence-panel button.btn-primary').first();
    if (await accept.count()) await accept.click();
    await settle(page, 1200);
    const asked = calls.filter((c) => /^POST \/api\/ai\/runtimes\/[A-Z0-9_]+\/download/.test(c));
    check('chooser_unticked_downloads_no_runtime', unticked === 'false' && asked.length === 0, { unticked, asked });
    await context.close();
    launcher.stop();
  }

  // ---------------------------------------------------------------- no model: nothing is said; a model and no runtime: it is
  {
    const launcher = await startLauncher();
    launchers.push(launcher);
    // The chooser is over for this data folder once it has been shown (and the tour is not wanted).
    let s = await openPage(launcher, 'lang=en&theme=dark&mode=fast&example=1&tour=0');
    await s.page.waitForSelector('.sw .sw-chooser', { state: 'visible', timeout: 30000 });
    await s.page.keyboard.press('Escape');
    await settle(s.page, 200);
    await s.page.reload();
    await s.page.waitForSelector('#app[data-ready="1"]', { timeout: 90000 });
    await settle(s.page, 1500);

    // none
    await s.page.keyboard.press('Control+Enter');
    await s.page.waitForSelector('[data-render-window]');
    await aiSection(s.page, true);
    await settle(s.page, 800);
    const noneNotice = await visible(s.page, '[data-runtime-notice]');
    const noneBadge = await visible(s.page, '[data-runtime-badge]');
    const noneNote = await visible(s.page, '[data-runtime-note]');
    check('no_model_says_nothing_of_the_runtime', !noneNotice && !noneBadge && !noneNote, { noneNotice, noneBadge, noneNote, aiLine: await text(s.page, '.rw-ai .rw-ai-note') });
    await aiSection(s.page, false);
    await s.page.keyboard.press('Escape');
    await seedModel(launcher);

    // A new session of the page: the launcher keeps the model, and the start checks the runtime.
    await s.page.reload();
    await s.page.waitForSelector('#app[data-ready="1"]', { timeout: 90000 });
    await s.page.waitForSelector('[data-runtime-note]:not([hidden])', { timeout: 30000 });
    await settle(s.page, 300);
    const note = await text(s.page, '[data-runtime-note]');
    await s.page.locator('.status').screenshot({ path: join(SHOTS, 'ai-runtime-note.png') });
    check('status_bar_note_at_start', /AI: the inference runtime is not installed/.test(note) && /Install/.test(note) && /Later/.test(note), { note });
    const kinds = await s.page.evaluate(() => document.querySelector('[data-runtime-note]')?.dataset.kind);
    await s.page.locator('[data-runtime-note] .update-later').click();
    await settle(s.page, 200);
    check('note_later_hides_it', !(await visible(s.page, '[data-runtime-note]')) && kinds === 'MISSING', { kinds });

    // The render window's AI section.
    await s.page.keyboard.press('Control+Enter');
    await s.page.waitForSelector('[data-render-window]');
    await settle(s.page, 600);
    const badgeFolded = await visible(s.page, '[data-render-window] [data-runtime-badge]');
    const badgeText = await text(s.page, '[data-render-window] [data-runtime-badge]');
    await aiSection(s.page, true);
    await s.page.waitForSelector('[data-runtime-notice="render"]:not([hidden])', { timeout: 10000 });
    await settle(s.page, 400);
    const render = await text(s.page, '[data-runtime-notice="render"]');
    const buttons = await s.page.locator('[data-runtime-notice="render"] button').allTextContents();
    await s.page.locator('[data-render-window] [data-guide="section-rw.ai"]').scrollIntoViewIfNeeded();
    await s.page.screenshot({ path: join(SHOTS, 'ai-runtime-warning-render.png') });
    check('render_window_warns', badgeFolded && /Needs the runtime/.test(badgeText) && /The inference runtime is not installed/.test(render) && buttons.some((b) => /^Install · [\d.]+ MB$/.test(b.trim())) && buttons.some((b) => /Settings/.test(b)), { badgeFolded, badgeText, render, buttons });

    // The switch opens Settings at the Runtime row; Settings says it too, at the top of the section, with the same button.
    await s.page.locator('[data-render-window] [data-ai-switch]').click();
    await s.page.waitForSelector('[data-settings-window]');
    await settle(s.page, 600);
    const row = await s.page.evaluate(() => document.querySelector('[data-settings-window] .is-flash')?.getAttribute('data-row') ?? document.querySelector('[data-settings-window] [data-runtime]') !== null);
    check('the_switch_opens_the_runtime_row', row === 'ai.runtime' || row === true, { row });
    await s.page.locator('.sw .sw-content').evaluate((e) => (e.scrollTop = 0));
    await settle(s.page, 500);
    const settings = await text(s.page, '[data-runtime-notice="settings"]');
    const settingsButtons = await s.page.locator('[data-runtime-notice="settings"] button').allTextContents();
    await s.page.screenshot({ path: join(SHOTS, 'ai-runtime-warning-settings.png') });
    check('settings_warns_at_the_top', /The inference runtime is not installed/.test(settings) && settingsButtons.some((b) => /^Install · [\d.]+ MB$/.test(b.trim())) && !settingsButtons.some((b) => /^Settings/.test(b.trim())), { settings, settingsButtons });
    await s.page.keyboard.press('Escape');
    await settle(s.page, 200);

    // Install: the request goes to the launcher, which downloads it (or says why not): the notice says what it answered.
    await s.page.locator('[data-guide="render"]').click();
    await s.page.waitForSelector('[data-render-window]');
    await aiSection(s.page, true);
    await s.page.waitForSelector('[data-runtime-notice="render"]:not([hidden])', { timeout: 10000 });
    const before = s.calls.length;
    await s.page.locator('[data-runtime-notice="render"] button', { hasText: /^Install/ }).click();
    await s.page.waitForFunction(() => /refused|failed|Downloading|Paused|Checking|Unpacking/.test(document.querySelector('[data-runtime-notice="render"]')?.textContent ?? ''), null, { timeout: 30000 }).catch(() => undefined);
    await settle(s.page, 800);
    const sent = s.calls.slice(before).filter((c) => /^POST \/api\/ai\/runtimes\/[A-Z0-9_]+\/download/.test(c));
    const after = await text(s.page, '[data-runtime-notice="render"]');
    check('install_asks_the_launcher', sent.length === 1 && /failed|Downloading|being installed/.test(after), { sent, after });
    await s.page.keyboard.press('Escape');
    await settle(s.page, 200);

    // vc: the launcher's answer, as a Windows computer without Microsoft's Visual C++ runtime would give it.
    await s.page.route(STATUS, async (route) => {
      const res = await route.fetch();
      const body = await res.json();
      if (body.runtime) {
        body.runtime.state = 'installed';
        body.runtime.done = body.runtime.total;
        body.runtime.error = null;
        body.runtime.version = null;
        body.runtime.probeError = 'the program did not start: a DLL is missing';
        body.runtime.vcRuntime = 'missing';
        body.runtime.vcRuntimeUrl = 'https://learn.microsoft.com/cpp/windows/latest-supported-vc-redist';
      }
      await route.fulfill({ response: res, json: body });
    });
    await s.page.route('**/api/open-url', (route) => route.fulfill({ status: 204 }));
    await s.page.route('**/api/ai/runtimes/*/probe', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
    await s.page.locator('[data-guide="render"]').click();
    await s.page.waitForSelector('[data-render-window]', { timeout: 5000 });
    await aiSection(s.page, true);
    await s.page.waitForSelector('[data-runtime-notice="render"][data-kind="VC_RUNTIME"]', { timeout: 15000 });
    const vc = await text(s.page, '[data-runtime-notice="render"]');
    const vcButtons = await s.page.locator('[data-runtime-notice="render"] button').allTextContents();
    const mark = s.calls.length;
    await s.page.locator('[data-runtime-notice="render"] [data-vc-runtime]').click();
    await settle(s.page, 400);
    await s.page.locator('[data-runtime-notice="render"] button', { hasText: 'Check again' }).click();
    await settle(s.page, 600);
    const vcCalls = s.calls.slice(mark);
    check(
      'vc_runtime_missing',
      /Microsoft Visual C\+\+ is missing/.test(vc) &&
        vcButtons.some((b) => /Install Microsoft Visual C\+\+ runtime/.test(b)) &&
        vcCalls.some((c) => c.startsWith('POST /api/open-url') && c.includes('learn.microsoft.com')) &&
        vcCalls.some((c) => /^POST \/api\/ai\/runtimes\/[A-Z0-9_]+\/probe/.test(c)),
      { vc, vcButtons, vcCalls },
    );
    await s.page.screenshot({ path: join(SHOTS, 'ai-runtime-warning-vc.png') });

    // fine: an installed runtime that starts says nothing.
    await s.page.unroute(STATUS);
    await s.page.route(STATUS, async (route) => {
      const res = await route.fetch();
      const body = await res.json();
      if (body.runtime) {
        body.runtime.state = 'installed';
        body.runtime.done = body.runtime.total;
        body.runtime.error = null;
        body.runtime.probeError = null;
        body.runtime.vcRuntime = null;
        body.runtime.version = 'stable-diffusion.cpp version test';
      }
      await route.fulfill({ response: res, json: body });
    });
    await s.page.waitForFunction(() => !document.querySelector('[data-runtime-notice="render"]:not([hidden])'), null, { timeout: 15000 });
    check('a_runtime_that_starts_says_nothing', !(await visible(s.page, '[data-runtime-notice]')) && !(await visible(s.page, '[data-runtime-badge]')), {});
    check('no_errors_warned', s.errors.length === 0, { errors: s.errors });
    await s.context.close();
    launcher.stop();
  }
} catch (err) {
  check('run', false, { error: String(err?.stack ?? err), logs: launchers.map((l) => l.log().slice(-600)) });
} finally {
  await browser.close();
  for (const l of launchers) l.stop();
  writeFileSync(join(OUT, 'ai-runtime-check.json'), JSON.stringify(results, null, 2));
  const failed = Object.entries(results).filter(([, v]) => !v.ok);
  console.log(failed.length === 0 ? 'all runtime checks passed' : `${failed.length} failed: ${failed.map(([k]) => k).join(', ')}`);
  process.exit(failed.length === 0 ? 0 : 1);
}
