#!/usr/bin/env node
// Stress test of Full mode in the viewport and of the render queue (phase P3a), against the native engine
// of the launcher and against the wasm pool (no launcher):
//
//   npm run engine:build && npm run build && (cd engine && cargo build --release -p rt-app)
//   node tools/viewport-stress.mjs [--engine native|wasm|both] [--minutes 10] [--stall 20] [--seed 1]
//        [--threads N] [--width 1280 --height 800] [--phases determinism,queue,session] [--debug]
//        [--out out/viewport-stress]
//
// Phases, for each engine:
//   determinism  the same Render at 4 samples with the viewport live (Full, sharing the engine) and with no
//                viewport (Fast) gives the same file, byte for byte;
//   queue        the queue drawer: Start queue runs, the viewport shares the engine while it does, Pause stops
//                the job at once (the launcher has no final job left) and the button says Resume, Resume runs
//                again, Pause then Resume at once is not lost, and the button's label and state follow;
//   session      a long, fast session of the edits a person makes (material sliders dragged, presets and
//                light setups clicked, orbits, orbit-release-move-a-part bursts, parts moved, undo and redo,
//                Fast ↔ Full, the render window opened and closed, renders while the viewport runs, the window
//                frozen and thawed), logging every /api/render request and the meter.
//
// The session fails when the viewport stalls: in Full mode, with the page running, a meter that has not
// changed for --stall seconds while the image is not converged; or when, after a burst of gestures, the
// canvas does not show the scene of the project within 15 s (the meter's data-shown-key, the scene of the
// image drawn, must equal data-want-key, the scene the project builds now, and the canvas pixels must have
// changed). Every few minutes it also goes quiet and the image has to converge further. Watchdog restarts
// are counted and reported. Logs: <out>/<engine>.jsonl and <out>/summary.json; with --debug, at the first
// stall, the last scenes posted and the launcher's threads (gdb).

import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const ENGINES = opt('engine', 'both') === 'both' ? ['native', 'wasm'] : [opt('engine', 'native')];
const MINUTES = Number(opt('minutes', '10'));
const STALL_S = Number(opt('stall', '20'));
const PHASES = new Set(opt('phases', 'determinism,queue,session').split(','));
const OUT = resolve(ROOT, opt('out', 'out/viewport-stress'));
const DEBUG = args.includes('--debug');
const CURRENT_MS = 15000;
let seed = Number(opt('seed', '1')) >>> 0 || 1;
mkdirSync(OUT, { recursive: true });

/** A small deterministic generator, so a session can be replayed with the same seed. */
function rand() {
  seed ^= seed << 13;
  seed >>>= 0;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  seed >>>= 0;
  return seed / 4294967296;
}
const pick = (list) => list[Math.floor(rand() * list.length)];
const between = (a, b) => a + (b - a) * rand();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fail(msg) {
  throw new Error(msg);
}

// ------------------------------------------------------------------ servers

/** The launcher in a data folder of its own, serving dist/; resolves with its URL (token included). */
function startLauncher(port) {
  const bin = join(ROOT, 'engine', 'target', 'release', 'repackshot');
  if (!existsSync(bin)) fail('engine/target/release/repackshot is missing: (cd engine && cargo build --release -p rt-app)');
  const data = join(OUT, 'launcher-data');
  rmSync(data, { recursive: true, force: true });
  mkdirSync(data, { recursive: true });
  const threads = opt('threads', '0');
  // The launcher saves renders itself, to the system's Downloads folder: one of our own here.
  const downloads = join(OUT, 'downloads');
  rmSync(downloads, { recursive: true, force: true });
  mkdirSync(downloads, { recursive: true });
  const child = spawn(bin, ['--serve-only', '--app-dir', join(ROOT, 'dist'), '--port', String(port), '--data-dir', data, '--threads', threads], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, XDG_DOWNLOAD_DIR: downloads } });
  return new Promise((resolveUrl, reject) => {
    let text = '';
    const timer = setTimeout(() => reject(new Error(`the launcher printed no URL: ${text}`)), 20000);
    const read = (chunk) => {
      text += chunk.toString();
      const m = /http:\/\/127\.0\.0\.1:\d+\/#token=[0-9a-f]{32}/.exec(text);
      if (m) {
        clearTimeout(timer);
        resolveUrl({ url: m[0], pid: child.pid, downloads, log: () => text, logFile: join(data, 'logs', 'repackshot.log'), stop: () => child.kill('SIGTERM') });
      }
    };
    child.stdout.on('data', read);
    child.stderr.on('data', read);
    child.on('exit', (code) => reject(new Error(`the launcher exited (${code}): ${text}`)));
  });
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.txt': 'text/plain', '.woff2': 'font/woff2' };

/** dist/ over plain HTTP, as any static host serves it (no launcher: the page uses the wasm pool). */
function startStatic(port) {
  const base = join(ROOT, 'dist');
  const server = createServer((req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
    let file = join(base, path);
    if (!file.startsWith(base) || !existsSync(file) || statSync(file).isDirectory()) file = join(base, 'index.html');
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
    createReadStream(file).pipe(res);
  });
  return new Promise((r) => server.listen(port, '127.0.0.1', () => r({ url: `http://127.0.0.1:${port}/`, stop: () => server.close() })));
}

// ------------------------------------------------------------------ the page

/** The meter of the viewport, as data attributes and text (what the person sees). */
const readMeter = (page) =>
  page.evaluate(() => {
    const el = document.querySelector('.ov-bl');
    if (!el) return null;
    const bar = el.querySelector('.bar-meter > div');
    const note = el.querySelector('.note');
    return { ...el.dataset, title: el.firstElementChild?.textContent ?? '', line: el.children[1]?.textContent ?? '', bar: bar ? bar.style.width : '', note: note?.textContent ?? '' };
  });

/** FNV-1a of every 7th pixel of the path tracer's canvas (what Full mode shows). */
const canvasHash = (page) =>
  page.evaluate(() => {
    const c = [...document.querySelectorAll('canvas')].find((x) => x.getAttribute('aria-hidden') === 'true');
    if (!c || c.width === 0) return '';
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let h = 0x811c9dc5;
    for (let i = 0; i < d.length; i += 28) h = Math.imul(h ^ d[i] ^ (d[i + 1] << 8) ^ (d[i + 2] << 16), 0x01000193) >>> 0;
    return h.toString(16);
  });

/** The launcher's render state (diagnostics), with the page's token. */
const launcherState = (page) =>
  page.evaluate(async () => {
    const token = sessionStorage.getItem('repackshot.token');
    if (!token) return null;
    const r = await fetch('/api/render/state', { headers: { 'X-Repackshot-Token': token }, cache: 'no-store' });
    return r.ok ? r.json() : null;
  });

async function openPage(engine, chromium, server, log) {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true, args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const context = await browser.newContext({ viewport: { width: Number(opt('width', '1280')), height: Number(opt('height', '800')) }, deviceScaleFactor: 1, acceptDownloads: true });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  const errors = [];
  const watchdog = [];
  page.on('pageerror', (e) => {
    errors.push(String(e));
    log({ kind: 'pageerror', text: String(e) });
  });
  page.on('console', (m) => {
    const text = m.text();
    if (/watchdog|launcher state/i.test(text)) watchdog.push(text.slice(0, 2000));
    if (m.type() === 'error' || m.type() === 'warning' || /watchdog/i.test(text)) log({ kind: 'console', type: m.type(), text: text.slice(0, 4000) });
  });
  // Every request of the native engine, with how long it took.
  const started = new Map();
  const api = { requests: 0, statuses: {}, failed: 0, slowest: 0, alive: 0 };
  const bodies = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (u.pathname === '/api/alive') api.alive++;
    if (!u.pathname.startsWith('/api/render')) return;
    started.set(r, Date.now());
    api.requests++;
    log({ kind: 'req', method: r.method(), path: `${u.pathname}${u.search}` });
    if (DEBUG && r.method() === 'POST') {
      bodies.push({ path: `${u.pathname}${u.search}`, body: r.postDataBuffer() });
      if (bodies.length > 6) bodies.shift();
    }
  });
  page.on('response', (r) => {
    const u = new URL(r.url());
    if (!u.pathname.startsWith('/api/render')) return;
    const ms = Date.now() - (started.get(r.request()) ?? Date.now());
    api.statuses[r.status()] = (api.statuses[r.status()] ?? 0) + 1;
    api.slowest = Math.max(api.slowest, ms);
    log({ kind: 'res', method: r.request().method(), path: `${u.pathname}${u.search}`, status: r.status(), ms });
  });
  page.on('requestfailed', (r) => {
    const u = new URL(r.url());
    if (!u.pathname.startsWith('/api/render')) return;
    api.failed++;
    log({ kind: 'reqfailed', method: r.method(), path: `${u.pathname}${u.search}`, error: r.failure()?.errorText });
  });
  const url = engine === 'native' ? server.url.replace('/#', '/?lang=en&theme=dark&example=1&mode=full#') : `${server.url}?lang=en&theme=dark&example=1&mode=full`;
  await page.goto(url);
  await page.waitForSelector('#app[data-ready="1"]', { timeout: 120000 });
  await page.waitForFunction(() => document.querySelector('.ov-bl')?.dataset.mode === 'full', null, { timeout: 120000 });
  const line = (await readMeter(page))?.line ?? '';
  if (engine === 'native' && !/Native/i.test(line)) fail(`the launcher page is not on the native engine: ${line}`);
  if (engine === 'wasm' && /Native/i.test(line)) fail(`the static page is on the native engine: ${line}`);
  /** At the first stall (--debug): the scenes posted last and the launcher's threads (gdb). */
  const evidence = (name) => {
    if (!DEBUG) return;
    const dir = join(OUT, `${engine}-${name}`);
    mkdirSync(dir, { recursive: true });
    bodies.forEach((b, i) => b.body && writeFileSync(join(dir, `post-${i}.rsb`), b.body));
    writeFileSync(join(dir, 'posts.txt'), bodies.map((b, i) => `${i} ${b.path}`).join('\n'));
    if (server.pid) {
      const gdb = spawnSync('gdb', ['-p', String(server.pid), '-batch', '-ex', 'thread apply all bt'], { encoding: 'utf8', timeout: 60000 });
      writeFileSync(join(dir, 'threads.txt'), `${gdb.stdout}\n${gdb.stderr}`);
    }
    console.log(`  [${engine}] evidence in ${dir}`);
  };
  return { browser, context, page, cdp, errors, watchdog, api, line, evidence, downloads: server.downloads ?? null };
}

/**
 * The file a Render about to start will save: in the browser a download; on the desktop the launcher writes it
 * to its Downloads folder (a new file there, once its size stops changing).
 */
function renderedFile(p, timeout = 900000) {
  if (!p.downloads) {
    return p.page.waitForEvent('download', { timeout }).then(async (d) => {
      const path = join(OUT, `${Date.now()}-${d.suggestedFilename()}`);
      await d.saveAs(path);
      await d.delete().catch(() => undefined);
      return path;
    });
  }
  const before = new Set(readdirSync(p.downloads));
  return (async () => {
    const end = Date.now() + timeout;
    let last = new Map();
    while (Date.now() < end) {
      await sleep(250);
      for (const f of readdirSync(p.downloads)) {
        if (before.has(f) || f.startsWith('.')) continue;
        const size = statSync(join(p.downloads, f)).size;
        if (size > 0 && last.get(f) === size) return join(p.downloads, f);
        last.set(f, size);
      }
    }
    throw new Error(`no render was saved in ${timeout / 1000} s`);
  })();
}

/** A click where the element is (no waiting for animations: a person does not wait either). */
async function clickAt(page, loc) {
  await loc.scrollIntoViewIfNeeded({ timeout: 3000 });
  const b = await loc.boundingBox({ timeout: 3000 });
  if (!b) return false;
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  return true;
}

async function openRenderWindow(page) {
  if (await page.locator('[data-render-window]').count()) return;
  await page.locator('canvas[aria-label="viewport"]').focus();
  await page.keyboard.press('Control+Enter');
  await page.waitForSelector('[data-render-window]', { timeout: 10000 });
}

async function setSamples(page, n) {
  await openRenderWindow(page);
  const field = page.locator('[data-render-window] [role="spinbutton"][aria-label="Samples"]').first();
  await field.dblclick();
  await page.keyboard.press('Control+a');
  await page.keyboard.type(String(n));
  await page.keyboard.press('Enter');
}

async function setMode(page, mode) {
  await clickAt(page, page.locator('[data-guide="viewport-mode"] button', { hasText: mode }));
  await page.waitForFunction((m) => document.querySelector('.ov-bl')?.dataset.mode === m, mode === 'Full' ? 'full' : 'fast', { timeout: 30000 });
}

// ------------------------------------------------------------------ determinism

/** The same Render with the viewport live and without it: the same file. */
async function determinism(engine, p, log) {
  const { page } = p;
  const renderOnce = async () => {
    await setSamples(page, 4);
    const download = renderedFile(p);
    await clickAt(page, page.locator('[data-render-window] .rw-foot .btn-primary'));
    // While it runs in Full mode, the viewport says it shares the engine.
    const during = [];
    for (let i = 0; i < 6; i++) {
      await sleep(300);
      const m = await readMeter(page);
      during.push(m?.title ?? '');
    }
    const path = await download;
    return { hash: createHash('sha256').update(readFileSync(path)).digest('hex').slice(0, 16), during };
  };
  await setMode(page, 'Full');
  await sleep(1500);
  const live = await renderOnce();
  await setMode(page, 'Fast');
  await sleep(500);
  const alone = await renderOnce();
  await setMode(page, 'Full');
  const ok = live.hash === alone.hash;
  log({ kind: 'determinism', live, alone, ok });
  console.log(`[${engine}] determinism: with a live viewport ${live.hash}, without ${alone.hash} ${ok ? 'OK' : 'DIFFERENT'} · while rendering: ${[...new Set(live.during)].join(' | ')}`);
  return { ok, live: live.hash, alone: alone.hash, during: [...new Set(live.during)] };
}

// ------------------------------------------------------------------ the queue drawer

async function queuePhase(engine, p, log) {
  const { page } = p;
  const checks = [];
  const check = (name, ok, detail) => {
    checks.push({ name, ok, detail });
    log({ kind: 'queue-check', name, ok, detail });
    console.log(`  [${engine}] queue: ${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ` ${JSON.stringify(detail)}`}`);
  };
  const button = () =>
    page.evaluate(() => {
      const b = document.querySelector('[data-queue-state]');
      return b ? { state: b.getAttribute('data-queue-state'), text: b.textContent, disabled: b.disabled } : null;
    });
  const rows = () => page.evaluate(() => [...document.querySelectorAll('[data-job]')].map((r) => r.getAttribute('data-status')));
  const waitFor = async (fn, ms = 5000) => {
    const start = Date.now();
    let last;
    while (Date.now() - start < ms) {
      last = await fn();
      if (last.ok) return { ok: true, ms: Date.now() - start, last };
      await sleep(50);
    }
    return { ok: false, last };
  };
  const finalsRunning = async () => {
    if (engine !== 'native') return 0;
    const s = await launcherState(page);
    return (s?.engine?.jobs ?? []).filter((j) => j.kind === 'final' && !j.flags.some((f) => ['done', 'cancelled', 'failed'].includes(f))).length;
  };
  // Two long jobs, waiting.
  await setSamples(page, 5000);
  for (let i = 0; i < 2; i++) await clickAt(page, page.locator('[data-render-window] .rw-foot button', { hasText: 'Add to queue' }));
  await page.keyboard.press('Escape');
  await clickAt(page, page.locator('.drawer-btn[data-drawer="queue"]'));
  const found = await page.waitForSelector('[data-queue-state]', { timeout: 10000 }).then(
    () => true,
    () => false,
  );
  if (!found) {
    check('the drawer has its Start queue / Pause / Resume button', false, 'no data-queue-state (a build before P3a)');
    return { ok: false, checks };
  }
  // The renders of earlier phases leave the list.
  const clear = page.locator('.queue-head button', { hasText: 'Clear finished' });
  if (await clear.isEnabled()) await clickAt(page, clear);
  let b = await button();
  check('idle: Start queue, enabled', b?.state === 'START' && !b.disabled && /Start queue/.test(b.text), b);
  await clickAt(page, page.locator('[data-queue-state]'));
  let r = await waitFor(async () => {
    const [bt, st] = [await button(), await rows()];
    return { ok: bt?.state === 'PAUSE' && st[0] === 'RUNNING', bt, st };
  });
  check('Start queue: the first job runs and the button says Pause', r.ok, r.last);
  await sleep(2500);
  const meter = await readMeter(page);
  check('while it runs the viewport shares the engine and says so', /sharing with Render/.test(meter?.title ?? '') && meter?.share === 'shared', meter?.title);
  const finals = await finalsRunning();
  check('the launcher has the final job', engine !== 'native' || finals === 1, finals);
  // Pause: stops at once.
  const t0 = Date.now();
  await clickAt(page, page.locator('[data-queue-state]'));
  r = await waitFor(async () => {
    const [bt, st, f] = [await button(), await rows(), await finalsRunning()];
    return { ok: bt?.state === 'RESUME' && !bt.disabled && /Resume/.test(bt.text) && st.every((x) => x === 'QUEUED') && f === 0, bt, st, finals: f };
  });
  check('Pause: the job waits again, the engine is free, the button says Resume', r.ok, { ...r.last, ms: Date.now() - t0 });
  await sleep(1500);
  const m2 = await readMeter(page);
  check('paused: the viewport has the whole engine again', m2?.share === '' && !/sharing|paused while/.test(m2?.title ?? ''), m2?.title);
  // Resume.
  await clickAt(page, page.locator('[data-queue-state]'));
  r = await waitFor(async () => {
    const [bt, st] = [await button(), await rows()];
    return { ok: bt?.state === 'PAUSE' && st[0] === 'RUNNING', bt, st };
  });
  check('Resume: the paused job runs again', r.ok, r.last);
  await sleep(1000);
  // Pause and Resume at once: the Resume is not lost while the job winds down.
  await clickAt(page, page.locator('[data-queue-state]'));
  await clickAt(page, page.locator('[data-queue-state]'));
  r = await waitFor(async () => {
    const [bt, st] = [await button(), await rows()];
    return { ok: bt?.state === 'PAUSE' && st.includes('RUNNING'), bt, st };
  });
  await sleep(1500);
  const still = await rows();
  check('Pause then Resume at once: the queue goes on', r.ok && still.includes('RUNNING'), { ...r.last, after: still });
  // Pause, then remove the jobs: nothing to resume, Start queue disabled.
  await clickAt(page, page.locator('[data-queue-state]'));
  await waitFor(async () => ({ ok: (await rows()).every((x) => x === 'QUEUED') }));
  for (let i = 0; i < 2; i++) await clickAt(page, page.locator('[data-job] .queue-actions button[aria-label="Remove"]').first());
  b = await button();
  check('nothing waiting: Start queue, disabled', b?.state === 'START' && b.disabled, b);
  const left = await finalsRunning();
  check('the launcher has no final job left', left === 0, left);
  await clickAt(page, page.locator('.drawer-btn[data-drawer="queue"]'));
  return { ok: checks.every((c) => c.ok), checks };
}

// ------------------------------------------------------------------ the session

async function session(engine, p, log) {
  const { page, cdp } = p;
  const canvas = page.locator('canvas[aria-label="viewport"]');
  const box = await canvas.boundingBox();
  const parts = ['Base', 'Body', 'Label', 'Collar', 'Cap'];
  let frozenUntil = 0;
  let renders = 0;
  let renderBusy = null;
  const stale = [];
  let currentChecks = 0;

  const selectPart = async () => {
    const name = pick(parts);
    await clickAt(page, page.locator('.tree .tree-name', { hasText: new RegExp(`^${name}$`) }).first());
    return name;
  };
  const sceneInspector = async () => {
    await clickAt(page, page.locator('aside .crumb', { hasText: 'Scene' }).first());
  };
  /** Drags a range input from one place to another in steps (the slider's live preview). */
  const dragRange = async (loc) => {
    await loc.scrollIntoViewIfNeeded({ timeout: 3000 });
    const b = await loc.boundingBox();
    if (!b) return false;
    const y = b.y + b.height / 2;
    const x0 = b.x + 4 + rand() * (b.width - 8);
    const x1 = b.x + 4 + rand() * (b.width - 8);
    await page.mouse.move(x0, y);
    await page.mouse.down();
    const steps = 4 + Math.floor(rand() * 8);
    for (let k = 1; k <= steps; k++) await page.mouse.move(x0 + ((x1 - x0) * k) / steps, y);
    await page.mouse.up();
    return true;
  };
  const orbitDrag = async () => {
    const cx = box.x + box.width * between(0.15, 0.85);
    const cy = box.y + box.height * between(0.2, 0.8);
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    const steps = 5 + Math.floor(rand() * 10);
    const dx = between(-300, 300);
    const dy = between(-150, 150);
    for (let k = 1; k <= steps; k++) await page.mouse.move(cx + (dx * k) / steps, cy + (dy * k) / steps);
    await page.mouse.up();
    return `orbit ${Math.round(dx)},${Math.round(dy)}`;
  };
  const moveDrag = async () => {
    const part = await selectPart();
    const fields = page.locator('aside [data-field="transform"] [role="spinbutton"]');
    const n = await fields.count();
    if (n === 0) return 'no transform';
    const f = fields.nth(Math.floor(rand() * Math.min(3, n)));
    await f.scrollIntoViewIfNeeded({ timeout: 3000 });
    const b = await f.boundingBox();
    if (!b) return 'hidden';
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    const steps = 3 + Math.floor(rand() * 6);
    const dx = between(-80, 80);
    for (let k = 1; k <= steps; k++) await page.mouse.move(b.x + b.width / 2 + (dx * k) / steps, b.y + b.height / 2);
    await page.mouse.up();
    return `${part} moved ${Math.round(dx)}`;
  };
  /**
   * After the last release of a burst: within CURRENT_MS the canvas shows the project's scene as it is now
   * (shown key = want key) and its pixels changed from before the burst.
   */
  const current = async (label, before) => {
    if (Date.now() < frozenUntil) return;
    currentChecks++;
    const t0 = Date.now();
    let m = null;
    let hash = '';
    while (Date.now() - t0 < CURRENT_MS) {
      m = await readMeter(page);
      // Not in Full mode, or a build before P3a (no scene keys on the meter): nothing to compare.
      if (m?.mode !== 'full' || m.wantKey === undefined) return;
      hash = await canvasHash(page);
      if (m.shownKey && m.shownKey === m.wantKey && hash !== before) {
        log({ kind: 'current', label, ms: Date.now() - t0 });
        return;
      }
      await sleep(150);
    }
    stale.push({ label, meter: m, hashChanged: hash !== before });
    log({ kind: 'STALE', label, meter: m, hashChanged: hash !== before });
    console.log(`  [${engine}] STALE after ${label}: shown ${m?.shownKey} want ${m?.wantKey}, pixels ${hash !== before ? 'changed' : 'unchanged'} · ${m?.title}`);
    if (stale.length === 1) p.evidence('stale');
  };

  const actions = {
    async slider() {
      await selectPart();
      const ranges = page.locator('aside input[type="range"]:not([disabled])');
      const n = await ranges.count();
      if (n === 0) return 'no slider';
      const i = Math.floor(rand() * n);
      await dragRange(ranges.nth(i));
      return `range ${i}/${n}`;
    },
    async preset() {
      const part = await selectPart();
      if (rand() < 0.5) {
        const chips = page.locator('aside .chip, aside .seg button');
        const n = await chips.count();
        if (n === 0) return 'no preset';
        const i = Math.floor(rand() * n);
        await clickAt(page, chips.nth(i));
        return `${part} ← preset ${i}`;
      }
      await clickAt(page, page.locator('aside button', { hasText: 'Change…' }).first());
      const thumbs = page.locator('[data-guide="material"] .thumbs .thumb');
      await thumbs.first().waitFor({ timeout: 5000 });
      const n = await thumbs.count();
      const i = Math.floor(rand() * Math.min(n, 24));
      await clickAt(page, thumbs.nth(i));
      await page.keyboard.press('Escape');
      return `${part} ← material ${i}/${n}`;
    },
    async setup() {
      await sceneInspector();
      const thumbs = page.locator('aside [data-guide="setups"] .thumb');
      const n = await thumbs.count();
      if (n === 0) return 'no setup';
      const i = Math.floor(rand() * Math.min(n, 30));
      await clickAt(page, thumbs.nth(i));
      return `setup ${i}`;
    },
    orbit: orbitDrag,
    /** The user's pattern: orbit, release, move a part at once, release, again, fast; then the canvas must be current. */
    async orbitMove() {
      const before = await canvasHash(page);
      const n = 2 + Math.floor(rand() * 2);
      const done = [];
      for (let k = 0; k < n; k++) {
        done.push(await orbitDrag());
        done.push(await moveDrag());
      }
      await current(`orbit-move ×${n}${renderBusy ? ' (rendering)' : ''}`, before);
      return done.join(', ');
    },
    async wheel() {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      const n = 2 + Math.floor(rand() * 8);
      for (let k = 0; k < n; k++) {
        await page.mouse.wheel(0, pick([-120, 120]));
        await sleep(between(20, 80));
      }
      return `wheel ×${n}`;
    },
    move: moveDrag,
    async select() {
      if (rand() < 0.5) return `select ${await selectPart()}`;
      await page.mouse.click(box.x + box.width * between(0.3, 0.7), box.y + box.height * between(0.3, 0.7));
      return 'select in the viewport';
    },
    async undo() {
      const n = 1 + Math.floor(rand() * 4);
      await canvas.focus();
      for (let k = 0; k < n; k++) {
        await page.keyboard.press('Control+z');
        await sleep(between(30, 150));
      }
      const m = Math.floor(rand() * (n + 1));
      for (let k = 0; k < m; k++) {
        await page.keyboard.press('Control+Shift+z');
        await sleep(between(30, 150));
      }
      return `undo ×${n}, redo ×${m}`;
    },
    async toggle() {
      // Sometimes right after a drag, while its reduced-resolution frame is still in flight.
      if (rand() < 0.5) await orbitDrag();
      await clickAt(page, page.locator('[data-guide="viewport-mode"] button', { hasText: 'Fast' }));
      try {
        await sleep(between(0, 1500));
        await clickAt(page, page.locator('[data-guide="viewport-mode"] button', { hasText: 'Full' }));
      } finally {
        // Always back to Full (a click lost on a busy page must not leave the rest of the session in Fast).
        if ((await readMeter(page))?.mode !== 'full') await setMode(page, 'Full');
      }
      return 'Fast ↔ Full';
    },
    async renderWindow() {
      await openRenderWindow(page);
      await sleep(between(200, 1500));
      await page.keyboard.press('Escape');
      await page.waitForSelector('[data-render-window]', { state: 'detached', timeout: 10000 }).catch(() => undefined);
      return 'render window';
    },
    async render() {
      if (renderBusy) return 'a render is running';
      await setSamples(page, pick([4, 8, 16, 32]));
      const download = renderedFile(p);
      await clickAt(page, page.locator('[data-render-window] .rw-foot .btn-primary'));
      renders++;
      const started = Date.now();
      // A render can also end without a file: an undo that takes its job off the queue stops it (U5).
      let over = false;
      const stopped = (async () => {
        let seen = false;
        let idleSince = 0;
        while (!over) {
          await sleep(500);
          const m = await readMeter(page).catch(() => null);
          if (m?.rendering === '1') {
            seen = true;
            idleSince = 0;
          } else if (m?.rendering === '0' && (seen || Date.now() - started > 30000)) {
            idleSince ||= Date.now();
            // The engine is done; the page may still be encoding and saving the file.
            if (Date.now() - idleSince > 3000) {
              return Promise.race([
                download,
                sleep(60000).then(() => {
                  throw new Error('the render stopped without a file (its job left the queue)');
                }),
              ]);
            }
          }
        }
      })();
      renderBusy = Promise.race([download, stopped])
        .then(
          (file) => log({ kind: 'render-done', seconds: (Date.now() - started) / 1000, file }),
          (err) => log({ kind: 'render-failed', error: String(err) }),
        )
        .finally(() => {
          over = true;
          renderBusy = null;
        });
      return `render ${renders}`;
    },
    async freeze() {
      const ms = between(800, 4000);
      frozenUntil = Date.now() + ms + 1500;
      await cdp.send('Page.setWebLifecycleState', { state: 'frozen' });
      await sleep(ms);
      await cdp.send('Page.setWebLifecycleState', { state: 'active' });
      return `frozen ${Math.round(ms)} ms`;
    },
  };
  const weights = { slider: 6, preset: 4, setup: 4, orbit: 5, orbitMove: 4, wheel: 2, move: 3, select: 3, undo: 3, toggle: 2, renderWindow: 1, render: 2, freeze: 1 };
  const bag = Object.entries(weights).flatMap(([k, w]) => Array(w).fill(k));

  // The meter, every 250 ms; a stall is a Full meter that did not change while it should.
  const stalls = [];
  let lastKey = '';
  let lastChange = Date.now();
  let samplesMax = 0;
  let meterReads = 0;
  let stalledSince = 0;
  let stop = false;
  let sharedReads = 0;
  const watch = (async () => {
    while (!stop) {
      await sleep(250);
      if (Date.now() < frozenUntil) {
        lastChange = Date.now();
        continue;
      }
      let m = null;
      try {
        m = await readMeter(page);
      } catch {
        continue;
      }
      if (!m) continue;
      meterReads++;
      if (m.share === 'shared') sharedReads++;
      const key = [m.mode, m.samples, m.scale, m.frames, m.passes, m.title, m.issue].join('|');
      const now = Date.now();
      if (key !== lastKey) {
        if (stalledSince) log({ kind: 'recovered', afterSeconds: (now - stalledSince) / 1000 });
        stalledSince = 0;
        lastKey = key;
        lastChange = now;
        log({ kind: 'meter', ...m });
      }
      samplesMax = Math.max(samplesMax, Number(m.samples) || 0);
      const full = m.mode === 'full';
      // (Builds before P3a have no data-converged: their bar is full when converged.)
      const converged = m.converged === '1' || (m.converged === undefined && m.bar === '100%');
      if (full && !converged && now - lastChange > STALL_S * 1000 && !stalledSince) {
        stalledSince = lastChange;
        stalls.push({ at: new Date(lastChange).toISOString(), meter: m });
        log({ kind: 'STALL', seconds: (now - lastChange) / 1000, meter: m, launcher: engine === 'native' ? await launcherState(page).catch(() => null) : null });
        console.log(`  [${engine}] STALL: the meter has not changed for ${STALL_S} s: ${m.title} · ${m.line} · ${m.note}`);
        if (stalls.length === 1) p.evidence('stall');
      }
    }
  })();

  const t0 = Date.now();
  const end = t0 + MINUTES * 60 * 1000;
  let n = 0;
  let quietAt = t0 + 90 * 1000;
  const quiet = [];
  const counts = {};
  while (Date.now() < end) {
    // Now and then: nothing for a while, and the image must keep converging.
    if (Date.now() > quietAt && !renderBusy) {
      const before = await readMeter(page);
      await sleep(15000);
      const after = await readMeter(page);
      quiet.push({ before: before?.samples, after: after?.samples, title: after?.title });
      log({ kind: 'quiet', before, after });
      quietAt = Date.now() + between(60, 120) * 1000;
      continue;
    }
    const name = pick(bag);
    const at = Date.now();
    let what = '';
    try {
      what = await actions[name]();
    } catch (err) {
      what = `failed: ${String(err).split('\n')[0]}`;
      await page.mouse.up().catch(() => undefined);
      await page.keyboard.press('Escape').catch(() => undefined);
    }
    n++;
    counts[name] = (counts[name] ?? 0) + 1;
    log({ kind: 'action', n, name, what, ms: Date.now() - at });
    await sleep(between(50, 800));
  }
  // The end: quiet, and converging.
  if (renderBusy) await Promise.race([renderBusy, sleep(180000)]);
  const before = await readMeter(page);
  await sleep(20000);
  const after = await readMeter(page);
  quiet.push({ before: before?.samples, after: after?.samples, title: after?.title, final: true });
  stop = true;
  await watch;
  return { actions: n, counts, renders, stalls, stale, currentChecks, samplesMax, meterReads, sharedReads, quiet, endMeter: after };
}

async function runEngine(engine, chromium) {
  const logFile = join(OUT, `${engine}.jsonl`);
  writeFileSync(logFile, '');
  const t0 = Date.now();
  const log = (o) => appendFileSync(logFile, `${JSON.stringify({ t: (Date.now() - t0) / 1000, ...o })}\n`);
  const server = engine === 'native' ? await startLauncher(4391) : await startStatic(4392);
  const result = { engine };
  let p = null;
  try {
    p = await openPage(engine, chromium, server, log);
    result.line = p.line;
    console.log(`[${engine}] ${p.line}`);
    if (PHASES.has('determinism')) result.determinism = await determinism(engine, p, log);
    if (PHASES.has('queue')) result.queue = await queuePhase(engine, p, log);
    if (PHASES.has('session')) {
      console.log(`[${engine}] ${MINUTES} min session…`);
      result.session = await session(engine, p, log);
      await p.page.screenshot({ path: join(OUT, `${engine}-end.png`) }).catch((err) => log({ kind: 'screenshot-failed', error: String(err) }));
    }
    result.api = p.api;
    result.errors = p.errors;
    result.watchdog = p.watchdog.filter((l) => /watchdog/.test(l)).length;
    result.watchdogLines = p.watchdog.slice(0, 20);
    if (engine === 'native' && existsSync(server.logFile)) result.launcherLog = readFileSync(server.logFile, 'utf8').split('\n').filter((l) => /render state|failed|left behind/.test(l)).slice(0, 20);
    return result;
  } finally {
    if (p) await p.browser.close().catch(() => undefined);
    server.stop();
  }
}

const { chromium } = await import(join(ROOT, 'node_modules', 'playwright-core', 'index.mjs'));
if (!existsSync(join(ROOT, 'dist', 'index.html'))) fail('dist/ is missing: npm run build first');
if (!existsSync(join(ROOT, 'dist', 'engine', 'rt.wasm'))) fail('dist/engine/rt.wasm is missing: npm run engine:build && npm run build');
const summary = [];
let ok = true;
for (const engine of ENGINES) {
  const r = await runEngine(engine, chromium);
  summary.push(r);
  const s = r.session;
  const converging = !s || s.quiet.every((q) => Number(q.after) >= Number(q.before) && Number(q.after) > 0);
  const good = (!r.determinism || r.determinism.ok) && (!r.queue || r.queue.ok) && (!s || (s.stalls.length === 0 && s.stale.length === 0 && converging)) && r.errors.length === 0;
  ok &&= good;
  console.log(
    `[${engine}] ${good ? 'OK' : 'FAILED'}: ` +
      (r.determinism ? `determinism ${r.determinism.ok ? 'same file' : 'DIFFERENT'}; ` : '') +
      (r.queue ? `queue ${r.queue.checks.filter((c) => c.ok).length}/${r.queue.checks.length}; ` : '') +
      (s
        ? `${s.actions} actions, ${s.renders} renders, ${s.stalls.length} stalls, ${s.stale.length}/${s.currentChecks} stale displays, ` +
          `quiet periods ${s.quiet.map((q) => `${q.before}→${q.after}`).join(' ')}, end: ${s.endMeter?.title}; `
        : '') +
      `watchdog ${r.watchdog}; ${r.api.requests} /api/render requests ${JSON.stringify(r.api.statuses)} (${r.api.failed} failed, slowest ${r.api.slowest} ms), ` +
      `page errors ${r.errors.length}`,
  );
}
writeFileSync(join(OUT, 'summary.json'), JSON.stringify(summary, null, 2));
process.exit(ok ? 0 : 1);
