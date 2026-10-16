#!/usr/bin/env node
// Browser checks of phase U14 (the live view of a queue job), with the local Chromium and swiftshader, on the web
// (the wasm pool) or on the desktop (the launcher's native engine), and the cost of the live view on a render.
//
//   npm run engine:build && npm run build && node tools/queue-live-check.mjs [--shots docs/ui]
//   (cd engine && cargo build --release -p rt-app) && node tools/queue-live-check.mjs --desktop
//   node tools/queue-live-check.mjs [--desktop] --measure [--runs 8] [--width 960] [--samples 16]
//
// Web: it serves dist/ with `vite preview --port 4196 --strictPort` and stops it at the end (by the pids `lsof -t -i
// :4196` reports, never `pkill -f`). Desktop: it copies the release launcher to out/queue-live-desktop/ as a portable
// folder, starts it with `--serve-only --app-dir dist --port 4197` and opens the URL it prints (with the token).
//
//   (a) a click on the row of the job that renders opens the live view over the viewport: its picture, and new ones
//       as the engine adds samples (the samples it says go up);
//   (b) a click on a waiting row says the job has not started, and shows no picture;
//   (c) Esc closes the live view; on the desktop no more `fit=` frames are asked for after that;
//   (d) a click on a finished row opens the results viewer, as before;
//   (e) the job watched to its end becomes its result in the viewer.
//
// --measure: the same job (the example, Fast viewport, W × H at 16:9, S samples) rendered in `runs` pairs, one with
// the live view closed and one with it open (which goes first alternates), after a warm-up render; the render's own
// seconds of each (the engine's, `data-seconds` of the history) and the median of the pairs' ratios.
//
// Screenshots (English): queue-live.png and queue-live-dark.png (web), the queue drawer with a running job in the live
// view. Results: out/queue-live-check[-desktop].json, out/queue-live-measure[-desktop].json.

import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const DESKTOP = args.includes('--desktop');
const MEASURE = args.includes('--measure');
const PORT = DESKTOP ? 4197 : 4196;
const SHOTS = resolve(ROOT, opt('shots', 'docs/ui'));
const OUT = join(ROOT, 'out');
const SUFFIX = DESKTOP ? '-desktop' : '';
mkdirSync(OUT, { recursive: true });
mkdirSync(SHOTS, { recursive: true });
const STUDIO = 'example=1&preset=JEWELLERY&setup=REMBRANDT&lang=en&mode=fast';
const results = {};
let failed = 0;
const fail = (msg) => {
  throw new Error(msg);
};
const check = (key, ok, detail) => {
  results[key] = { ok: Boolean(ok), ...detail };
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${key} ${JSON.stringify(detail)}`);
};

// ------------------------------------------------------------------ servers

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

/** The launcher in a portable folder of its own; resolves with its child and the URL it prints. */
function startLauncher() {
  const bin = join(ROOT, 'engine', 'target', 'release', 'repackshot');
  if (!existsSync(bin)) fail('engine/target/release/repackshot is missing: (cd engine && cargo build --release -p rt-app)');
  const dir = join(OUT, 'queue-live-desktop');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const exe = join(dir, 'repackshot');
  copyFileSync(bin, exe);
  chmodSync(exe, 0o755);
  writeFileSync(join(dir, 'portable.txt'), '');
  const child = spawn(exe, ['--serve-only', '--app-dir', join(ROOT, 'dist'), '--port', String(PORT)], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
  return new Promise((resolveUrl, reject) => {
    let text = '';
    const timer = setTimeout(() => reject(new Error(`the launcher printed no URL: ${text}`)), 20000);
    const read = (chunk) => {
      text += chunk.toString();
      const m = /http:\/\/127\.0\.0\.1:\d+\/#token=[0-9a-f]{32}/.exec(text);
      if (m) {
        clearTimeout(timer);
        resolveUrl({ child, url: m[0] });
      }
    };
    child.stdout.on('data', read);
    child.stderr.on('data', read);
    child.on('exit', (code) => reject(new Error(`the launcher exited (${code}): ${text}`)));
  });
}

// ------------------------------------------------------------------ the page

let BASE = null;
let TOKEN_HASH = '';

async function open(browser, query) {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && !m.location().url.startsWith('https://api.github.com/') && errors.push(m.text()));
  const fits = [];
  page.on('request', (r) => r.url().includes('fit=') && fits.push(Date.now()));
  await page.goto(`${BASE}/?${query}${TOKEN_HASH}`);
  await page.waitForSelector('#app[data-ready="1"]', { timeout: 90000 });
  // The engine is ready when Full can be chosen.
  await page.waitForFunction(() => !document.querySelectorAll('.hdr .seg button')[1]?.disabled, null, { timeout: 90000 });
  // The desktop portable's first start opens Settings as the models' chooser (U6): it is closed first.
  if (DESKTOP) {
    await page.waitForSelector('.sw .sw-chooser', { state: 'visible', timeout: 20000 }).catch(() => undefined);
    await page.locator('.sw .sw-chooser button', { hasText: 'Done' }).click({ timeout: 5000 }).catch(() => undefined);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.sw'), null, { timeout: 20000 });
  }
  return { page, context, errors, fits };
}

/** Types a value into a number field of the render window (double click edits it). */
async function setNumber(page, selector, value) {
  const el = page.locator(selector).first();
  await el.dblclick();
  const input = el.locator('input');
  await input.fill(String(value));
  await input.press('Enter');
}

const sizeSel = '.rw [data-section="rw.size"]';

/** The render window with this size and these samples (finish by samples). */
async function windowWith(page, width, samples) {
  await page.locator('canvas[aria-label="viewport"]').focus();
  await page.keyboard.press('Control+Enter');
  await page.waitForSelector('.rw');
  await setNumber(page, `${sizeSel} .num[aria-label="Width"]`, width);
  await setNumber(page, '.rw .num[aria-label="Samples"]', samples);
}

async function openQueue(page) {
  if ((await page.locator('.queue').count()) === 0) await page.locator('.drawer-btn[data-drawer="queue"]').click();
  await page.waitForSelector('.queue');
}

const lvAttr = (page, name) => page.evaluate((n) => document.querySelector('.lv')?.getAttribute(`data-${n}`) ?? null, name);

// ------------------------------------------------------------------ the checks

async function checks(browser) {
  const { page, errors, fits } = await open(browser, `${STUDIO}&theme=light`);
  // A finished job first, for (d).
  await windowWith(page, 320, 4);
  await page.keyboard.press('Enter');
  await page.waitForSelector('.rv[data-ready="1"]', { timeout: 120000 });
  await page.keyboard.press('Escape');
  // One long enough to watch, and one that waits behind it.
  await windowWith(page, 1280, DESKTOP ? 1024 : 96);
  await page.keyboard.press('Shift+Enter');
  await setNumber(page, `${sizeSel} .num[aria-label="Width"]`, 640);
  await setNumber(page, '.rw .num[aria-label="Samples"]', 8);
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.press('Escape');
  await openQueue(page);
  await page.locator('.queue-head .btn-primary').click();
  await page.waitForSelector('.queue-row[data-status="RUNNING"]', { timeout: 30000 });

  // (a) The running row opens the live view; pictures come, with the engine's samples going up.
  await page.locator('.queue-row[data-status="RUNNING"]').click();
  await page.waitForSelector('.lv[data-kind="LIVE"]', { timeout: 60000 });
  const f0 = Number(await lvAttr(page, 'frames'));
  const s0 = Number(await lvAttr(page, 'samples'));
  await page.waitForFunction((f) => Number(document.querySelector('.lv')?.getAttribute('data-frames')) >= f + 2, f0, { timeout: 60000 });
  const f1 = Number(await lvAttr(page, 'frames'));
  const s1 = Number(await lvAttr(page, 'samples'));
  const selected = await page.locator('.queue-row.is-selected').getAttribute('data-status');
  const data = await page.locator('.lv-data').textContent();
  const canvas = await page.evaluate(() => {
    const c = document.querySelector('.lv-canvas');
    const g = c.getContext('2d');
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let lit = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 30) lit++;
    const r = c.getBoundingClientRect();
    return { width: c.width, height: c.height, shown: [Math.round(r.width), Math.round(r.height)], lit: lit / (d.length / 4) };
  });
  check('a_running_shows_live', f1 > f0 && s1 >= s0 && s1 > 0 && selected === 'RUNNING' && canvas.lit > 0.05 && canvas.shown[0] > canvas.width, { frames: [f0, f1], samples: [s0, s1], selected, data, canvas });

  // The screenshots: the queue drawer with the running job in the live view, light and then dark.
  if (!DESKTOP) {
    // The pointer over the empty part of the history (no tooltip), the toasts gone.
    await page.mouse.move(1450, 880);
    await page.waitForTimeout(4600);
    await page.screenshot({ path: join(SHOTS, 'queue-live.png') });
    await page.locator('.hdr button[aria-label="Switch theme"]').click();
    const fd = Number(await lvAttr(page, 'frames'));
    await page.waitForFunction((f) => Number(document.querySelector('.lv')?.getAttribute('data-frames')) >= f + 1, fd, { timeout: 60000 });
    await page.mouse.move(1450, 880);
    await page.waitForTimeout(1200);
    await page.screenshot({ path: join(SHOTS, 'queue-live-dark.png') });
  }

  // (b) The waiting row: a line, no picture.
  await page.locator('.queue-row[data-status="QUEUED"]').click();
  await page.waitForSelector('.lv[data-kind="WAITING"]');
  const line = await page.locator('.lv-line').textContent();
  const pictureShown = await page.locator('.lv-canvas').isVisible();
  check('b_waiting_line', line === 'This job has not started yet: its picture appears here as soon as it renders.' && !pictureShown, { line, pictureShown });

  // (c) Esc closes it; no more frames are asked for (desktop: the `fit=` requests stop).
  await page.locator('.queue-row[data-status="RUNNING"]').click();
  await page.waitForSelector('.lv[data-kind="LIVE"]', { timeout: 60000 });
  await page.waitForTimeout(1500);
  const fitsOpen = fits.length;
  await page.keyboard.press('Escape');
  const closed = (await page.locator('.lv').count()) === 0;
  const tClosed = Date.now();
  await page.waitForTimeout(3000);
  const after = fits.filter((t) => t > tClosed + 300).length;
  check('c_esc_closes_and_stops', closed && (!DESKTOP || (fitsOpen > 0 && after === 0)), { closed, fitRequestsWhileOpen: fitsOpen, fitRequestsAfterClose: after });

  // (d) The finished row: the results viewer.
  await page.locator('.queue-row[data-status="DONE"]').first().click();
  await page.waitForSelector('.rv[data-ready="1"]', { timeout: 30000 });
  const rv = await page.locator('.rv-title').textContent();
  check('d_finished_opens_viewer', rv.length > 0 && (await page.locator('.lv').count()) === 0, { title: rv });
  await page.keyboard.press('Escape');

  // (e) The running job, watched to its end, becomes its result in the viewer.
  await page.locator('.queue-row[data-status="RUNNING"]').click();
  await page.waitForSelector('.lv[data-kind="LIVE"]', { timeout: 60000 });
  const watchedName = await page.locator('.lv-title').textContent();
  await page.waitForSelector('.rv[data-ready="1"]', { timeout: 600000 });
  const resultName = await page.locator('.rv-title').textContent();
  check('e_watched_becomes_result', resultName === watchedName && (await page.locator('.lv').count()) === 0, { watchedName, resultName });
  results.errors = errors;
  if (errors.length) check('no_page_errors', false, { errors });
}

// ------------------------------------------------------------------ the cost

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

/**
 * CPU seconds used so far by the browser's processes (every thread: the page, its workers, the GPU process) and, on the
 * desktop, by the launcher; null where there is no /proc (not Linux).
 */
function cpuSeconds() {
  if (!existsSync('/proc/self/stat')) return null;
  const tick = 100;
  const pids = spawnSync('pgrep', ['-f', 'pw-browsers/chromium']).stdout.toString().split(/\s+/).filter(Boolean);
  if (launcherPid) pids.push(String(launcherPid));
  let browser = 0;
  let launcher = 0;
  for (const pid of pids) {
    try {
      const st = readFileSync(`/proc/${pid}/stat`, 'utf8');
      const f = st.slice(st.lastIndexOf(')') + 2).split(' ');
      const s = (Number(f[11]) + Number(f[12])) / tick;
      if (String(pid) === String(launcherPid)) launcher += s;
      else browser += s;
    } catch {
      // gone
    }
  }
  return { browser, launcher };
}

async function measure(browser) {
  const runs = Number(opt('runs', '8'));
  const width = Number(opt('width', '960'));
  const samples = Number(opt('samples', DESKTOP ? '256' : '16'));
  const { page, fits } = await open(browser, `${STUDIO}&theme=light`);
  await openQueue(page);
  // One render of the job, with the live view open on it or not: the engine's seconds, and the pictures it showed.
  const render = async (watched) => {
    const before = await page.locator('.history-item').count();
    await windowWith(page, width, samples);
    const fit0 = fits.length;
    const cpu0 = cpuSeconds();
    await page.keyboard.press('Enter');
    let frames = 0;
    if (watched) {
      await page.locator('.queue-row[data-status="RUNNING"]').click({ timeout: 30000 });
      await page.waitForSelector('.lv', { timeout: 30000 });
      // The last count of pictures before the view becomes the result.
      const poll = setInterval(() => void page.evaluate(() => Number(document.querySelector('.lv')?.getAttribute('data-frames') ?? 0)).then((n) => (frames = Math.max(frames, n))).catch(() => undefined), 200);
      try {
        await page.waitForFunction((n) => document.querySelectorAll('.history-item').length > n, before, { timeout: 1800000 });
      } finally {
        clearInterval(poll);
      }
    } else await page.waitForFunction((n) => document.querySelectorAll('.history-item').length > n, before, { timeout: 1800000 });
    const cpu1 = cpuSeconds();
    const s = Number(await page.locator('.history-item').first().getAttribute('data-seconds'));
    const n = Number(await page.locator('.history-item').first().getAttribute('data-samples'));
    await page.waitForSelector('.rv[data-ready="1"]', { timeout: 60000 });
    await page.keyboard.press('Escape');
    const cpu = cpu0 && cpu1 ? { browser: cpu1.browser - cpu0.browser, launcher: cpu1.launcher - cpu0.launcher } : null;
    console.log(`${watched ? 'open  ' : 'closed'} ${s.toFixed(3)} s (${n} samples${watched ? `, ${frames} pictures, ${fits.length - fit0} fit= requests` : ''})${cpu ? ` · CPU browser ${cpu.browser.toFixed(2)} s, launcher ${cpu.launcher.toFixed(2)} s` : ''}`);
    return { seconds: s, frames, fits: fits.length - fit0, cpu };
  };
  // A warm-up render (the engine's first scene load), not counted.
  await render(false);
  // Pairs, one closed and one open, in turn first: a change of the machine's load (it is shared) weighs on both alike;
  // the cost is the median of the pairs' ratios.
  const pairs = [];
  for (let i = 0; i < runs; i++) {
    // Even pairs: closed first; odd pairs: open first.
    const closedFirst = i % 2 === 0;
    const a = await render(!closedFirst);
    const b = await render(closedFirst);
    const closed = closedFirst ? a : b;
    const opened = closedFirst ? b : a;
    const total = (r) => (r.cpu ? r.cpu.browser + r.cpu.launcher : NaN);
    pairs.push({ closed: closed.seconds, open: opened.seconds, ratio: opened.seconds / closed.seconds, pictures: opened.frames, fits: opened.fits, cpuClosed: total(closed), cpuOpen: total(opened), cpuRatio: total(opened) / total(closed) });
  }
  const ratios = pairs.map((p) => p.ratio);
  const out = {
    engine: DESKTOP ? 'desktop launcher (native)' : 'web (wasm pool)',
    width,
    samples,
    pairs,
    medianClosed: median(pairs.map((p) => p.closed)),
    medianOpen: median(pairs.map((p) => p.open)),
    medianRatio: median(ratios),
    cost: median(ratios) - 1,
    ratioRange: [Math.min(...ratios), Math.max(...ratios)],
    medianCpuRatio: median(pairs.map((p) => p.cpuRatio)),
  };
  console.log(`median closed ${out.medianClosed.toFixed(3)} s · open ${out.medianOpen.toFixed(3)} s · median ratio ${out.medianRatio.toFixed(4)} (cost ${(out.cost * 100).toFixed(2)} %) · ratios ${ratios.map((r) => r.toFixed(3)).join(' ')} · CPU ratio ${out.medianCpuRatio.toFixed(4)}`);
  writeFileSync(join(OUT, `queue-live-measure${SUFFIX}.json`), JSON.stringify(out, null, 2));
}

// ------------------------------------------------------------------ main

let server = null;
let launcher = null;
let launcherPid = null;
let browser = null;
try {
  if (!existsSync(join(ROOT, 'dist', 'index.html'))) fail('dist/ is missing: npm run build first');
  if (DESKTOP) {
    const started = await startLauncher();
    launcher = started.child;
    launcherPid = launcher.pid;
    const u = new URL(started.url);
    BASE = `${u.origin}`;
    TOKEN_HASH = u.hash;
  } else {
    if (!existsSync(join(ROOT, 'public', 'engine', 'rt.wasm'))) fail('public/engine/rt.wasm is missing: npm run engine:build first');
    stopServer();
    server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: 'ignore', detached: true });
    BASE = `http://localhost:${PORT}`;
    await waitFor(BASE);
  }
  const { chromium } = await import(join(ROOT, 'node_modules', 'playwright-core', 'index.mjs'));
  browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true, args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  if (MEASURE) await measure(browser);
  else await checks(browser);
} catch (err) {
  failed++;
  console.error(err);
  results.error = String(err?.stack ?? err);
} finally {
  if (!MEASURE) writeFileSync(join(OUT, `queue-live-check${SUFFIX}.json`), JSON.stringify(results, null, 2));
  await browser?.close();
  if (server) {
    try {
      process.kill(-server.pid, 'SIGTERM');
    } catch {
      // gone
    }
    stopServer();
  }
  launcher?.kill('SIGTERM');
}
process.exit(failed ? 1 : 0);
