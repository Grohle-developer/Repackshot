#!/usr/bin/env node
// Browser check of phase P3e (on the desktop the page is only the interface) against the real launcher
// (engine/crates/rt-app), with the local Chromium and swiftshader.
//
//   npm run engine:build && npm run build && (cd engine && cargo build --release -p rt-app) \
//     && node tools/desktop-platform-check.mjs [--shots docs/ui] [--quick]
//
// It copies the launcher into a portable folder with a long path, like the one of the Windows portable
// (`out/desktop-platform-check/Downloads/Repackshot-<v>-windows-x64-portable/Repackshot-<v>/`, data in
// `data/` next to it), with two graphics cards faked for the launcher's detection (REPACKSHOT_TEST_GPUS, for
// tests only), and starts it with `--serve-only --app-dir dist`. The second launch opens the window through a
// stand-in browser named `msedge` (REPACKSHOT_BROWSER: it only remembers the URL it was given), so the
// Desktop section names what draws the window. The launchers are stopped by their pid.
//
//   (a) the settings survive a restart from settings.json: the theme and the interface size changed in the
//       first launch are in <data>/settings.json, and in force in the second launch, opened in a new browser
//       profile (nothing kept by any browser); the second launch listens on the same port (the data folder's,
//       <data>/launcher.json), so the window's origin does not change;
//   (b) the window's browser storage holds nothing of the application: no repackshot.* in localStorage, no
//       IndexedDB database, nothing in the origin's private file system;
//   (c) a render result is a file in <data>/results/ with its index, and the history still lists it after
//       the restart;
//   (d) the GPU row lists the launcher's graphics cards (names and VRAM), and the AI section never says
//       "only in the desktop application";
//   (e) no section mentions a browser or an executable's name, in English and in Spanish; Persistent storage
//       is not there; Window drawn by says "Microsoft Edge app window";
//   (f) Storage shows the data folder as the launcher measured it, and Free up of the thumbnails deletes
//       through the launcher;
//   (h) outputs and projects go through the launcher's dialogs (P3b; a stand-in `zenity` answers): Choose
//       folder… asks POST /api/dialog/folder and the folder is remembered in <data>/state/desktop.folders.json,
//       Save project writes the file the save dialog named; the browser's pickers are never called;
//   (g) label, auxiliary text, value and control of every row never overlap, and nothing leaves its row or
//       makes the content scroll sideways, in every section at 1600, 1280 (UI.md's minimum) and 960 px wide
//       (half a screen), interface size 90, 100, 125 and 150 %, English and Spanish, dark, light and high
//       contrast (`--quick`: 1280 and 960, 100 and 150 %, dark).
//
// Screenshots (English, 1280 × 800): settings-desktop-paths.png, settings-storage-desktop.png,
// settings-ai-desktop.png. Results: out/desktop-platform-check.json.

import { spawn } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const QUICK = args.includes('--quick');
const SHOTS = resolve(ROOT, opt('shots', 'docs/ui'));
const OUT = join(ROOT, 'out');
const VERSION = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
const BASE = join(OUT, 'desktop-platform-check');
// A long folder, like a portable unpacked in the Downloads folder.
const DIR = join(BASE, 'Downloads', `Repackshot-${VERSION}-windows-x64-portable`, `Repackshot-${VERSION}`);
const DATA = join(DIR, 'data');
const GPUS = 'NVIDIA GeForce RTX 4070 Ti SUPER|NVIDIA|17171480576;Intel(R) UHD Graphics 770|Intel|134217728';
const results = {};
let failures = 0;
const fail = (msg) => {
  throw new Error(msg);
};
const check = (key, ok, detail) => {
  results[key] = { ok: Boolean(ok), ...detail };
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${key} ${JSON.stringify(detail).slice(0, 1500)}`);
};
const rowSel = (id) => `.sw [data-row="${id}"]`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The launcher; `stub`: open the window through the stand-in `msedge` instead of serving only. Resolves with the URL. */
/** A stand-in `zenity` for the launcher's dialogs (P3b): a folder dialog picks Renders, a save dialog a project file. */
const RENDERS = join(BASE, 'Renders');
const PROJECT = join(BASE, 'Shot.repack.json');
const DOWNLOADS = join(BASE, 'Downloads-out');
function fakeDialogs() {
  const dir = join(BASE, 'fake-dialogs');
  mkdirSync(dir, { recursive: true });
  mkdirSync(RENDERS, { recursive: true });
  writeFileSync(join(dir, 'zenity'), `#!/bin/sh\necho "$*" >> '${join(dir, 'calls.txt')}'\ncase " $* " in\n  *" --save "*) echo '${PROJECT}' ;;\n  *" --directory "*) echo '${RENDERS}' ;;\n  *) exit 1 ;;\nesac\n`);
  chmodSync(join(dir, 'zenity'), 0o755);
  return dir;
}

function startLauncher({ stub = false } = {}) {
  const exe = join(DIR, 'repackshot');
  // The launcher writes Downloads itself (P3b): here, into the check's folder.
  mkdirSync(DOWNLOADS, { recursive: true });
  const env = { ...process.env, REPACKSHOT_TEST_GPUS: GPUS, PATH: `${fakeDialogs()}:${process.env.PATH}`, XDG_DOWNLOAD_DIR: DOWNLOADS };
  const argsOut = join(BASE, 'browser-args.txt');
  let launchArgs = ['--serve-only', '--app-dir', join(ROOT, 'dist')];
  if (stub) {
    rmSync(argsOut, { force: true });
    const edge = join(BASE, 'stand-in', 'msedge');
    mkdirSync(dirname(edge), { recursive: true });
    writeFileSync(edge, `#!/bin/sh\necho $$ > '${argsOut}.pid'\nprintf '%s\\n' "$@" > '${argsOut}'\nexec sleep 86400\n`);
    chmodSync(edge, 0o755);
    env.REPACKSHOT_BROWSER = edge;
    launchArgs = ['--app-dir', join(ROOT, 'dist')];
  }
  const child = spawn(exe, launchArgs, { cwd: DIR, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let text = '';
  child.stdout.on('data', (c) => (text += c));
  child.stderr.on('data', (c) => (text += c));
  return new Promise((resolveUrl, reject) => {
    const started = Date.now();
    const poll = () => {
      const source = stub ? (existsSync(argsOut) ? readFileSync(argsOut, 'utf8') : '') : text;
      const m = /http:\/\/127\.0\.0\.1:\d+\/#token=[0-9a-f]{32}/.exec(source);
      if (m) return resolveUrl({ url: m[0], child, log: () => text });
      if (child.exitCode !== null) return reject(new Error(`the launcher exited (${child.exitCode}): ${text}`));
      if (Date.now() - started > 20000) return reject(new Error(`the launcher gave no URL: ${text}`));
      setTimeout(poll, 100);
    };
    poll();
  });
}

function stopLauncher(l) {
  if (!l) return;
  const pids = [l.child.exitCode === null ? l.child.pid : null];
  // The stand-in browser of the second launch outlives the launcher otherwise.
  const pidFile = join(BASE, 'browser-args.txt.pid');
  if (existsSync(pidFile)) pids.push(Number(readFileSync(pidFile, 'utf8').trim()) || null);
  for (const pid of pids.filter(Boolean)) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // Gone already.
    }
  }
}

/** A call to the launcher's API with the token of its URL. */
async function api(l, method, path, body) {
  const u = new URL(l.url);
  const token = /token=([0-9a-f]{32})/.exec(l.url)[1];
  const r = await fetch(`${u.origin}${path}`, { method, headers: { 'X-Repackshot-Token': token, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body });
  const t = await r.text();
  return { status: r.status, text: t, json: () => JSON.parse(t) };
}

/** What the page's own storage holds (the harness asks; the application never does on the desktop). */
async function browserStorage(page) {
  return page.evaluate(async () => {
    const ls = Object.keys(localStorage).filter((k) => k.startsWith('repackshot.'));
    const dbs = typeof indexedDB.databases === 'function' ? (await indexedDB.databases()).map((d) => d.name) : null;
    const opfs = [];
    try {
      const root = await navigator.storage.getDirectory();
      for await (const k of root.keys()) opfs.push(k);
    } catch (e) {
      opfs.push(`error: ${e}`);
    }
    return { localStorage: ls, indexedDB: dbs, opfs };
  });
}

async function openSettings(page, section) {
  if ((await page.locator('.sw').count()) === 0) {
    await page.locator('canvas[aria-label="viewport"]').focus();
    await page.keyboard.press('Control+Comma');
    await page.waitForSelector('.sw .sw-section');
  }
  if (section) {
    await page.locator(`.sw .sw-option[data-section="${section}"]`).click();
    await page.waitForSelector(`.sw .sw-section[data-section="${section}"]`);
  }
}

async function closeSettings(page) {
  for (let i = 0; i < 3 && (await page.locator('.sw').count()) > 0; i++) {
    await page.keyboard.press('Escape');
    await sleep(150);
  }
}

/** Every overlap and every overflow of the rows of the section on screen (empty when the layout holds). */
async function layoutProblems(page) {
  return page.evaluate(() => {
    const out = [];
    const shown = (el) => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility === 'visible';
    const textRects = (el) => {
      const rs = [];
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (!n.textContent.trim() || !shown(n.parentElement)) continue;
        const range = document.createRange();
        range.selectNodeContents(n);
        for (const r of range.getClientRects()) if (r.width > 0.5 && r.height > 0.5) rs.push(r);
      }
      return rs;
    };
    const boxes = (el) => {
      const rs = textRects(el);
      for (const c of el.querySelectorAll('button, input, select, .seg, .num, [role="spinbutton"], [role="switch"], code, .sw-bar')) if (shown(c)) rs.push(c.getBoundingClientRect());
      return rs;
    };
    const meet = (a, b) => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
    const r4 = (r) => [r.left, r.top, r.width, r.height].map((v) => Math.round(v));
    const checkGroups = (owner, id, groups) => {
      const box = owner.getBoundingClientRect();
      for (let i = 0; i < groups.length; i++)
        for (let j = i + 1; j < groups.length; j++)
          for (const a of groups[i].rects)
            for (const b of groups[j].rects) if (meet(a, b)) out.push({ id, overlap: [groups[i].name, groups[j].name], a: r4(a), b: r4(b) });
      for (const g of groups) for (const r of g.rects) if (r.right > box.right + 1 || r.left < box.left - 1) out.push({ id, overflow: g.name, r: r4(r), row: r4(box) });
    };
    const section = document.querySelector('.sw .sw-section');
    for (const row of section.querySelectorAll('.sw-row')) {
      if (!shown(row)) continue;
      const groups = [];
      for (const part of row.children) if (shown(part)) groups.push({ name: part.className || part.tagName, rects: boxes(part) });
      checkGroups(row, row.dataset.row, groups);
    }
    for (const row of section.querySelectorAll('.sw-usage-row, .sw-model')) {
      if (!shown(row)) continue;
      const groups = [...row.children].filter(shown).map((part) => ({ name: part.className || part.tagName, rects: boxes(part) }));
      checkGroups(row, row.dataset.usage ?? row.dataset.model ?? row.className, groups);
    }
    const content = document.querySelector('.sw .sw-content');
    if (content.scrollWidth > content.clientWidth + 1) out.push({ id: 'content', sideways: content.scrollWidth - content.clientWidth });
    return out;
  });
}

let browser = null;
let launcher = null;
try {
  const bin = join(ROOT, 'engine', 'target', 'release', 'repackshot');
  if (!existsSync(bin)) fail('engine/target/release/repackshot is missing: (cd engine && cargo build --release -p rt-app)');
  if (!existsSync(join(ROOT, 'dist', 'index.html'))) fail('dist/ is missing: npm run build first');
  rmSync(BASE, { recursive: true, force: true });
  mkdirSync(DIR, { recursive: true });
  copyFileSync(bin, join(DIR, 'repackshot'));
  chmodSync(join(DIR, 'repackshot'), 0o755);
  writeFileSync(join(DIR, 'portable.txt'), '');
  mkdirSync(SHOTS, { recursive: true });

  const { chromium } = await import(join(ROOT, 'node_modules', 'playwright-core', 'index.mjs'));
  browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true, args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const errors = [];
  const refused = [];
  const apiLog = [];
  /** A browser profile of its own (nothing of another launch's window). */
  const newPage = async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, acceptDownloads: true });
    // The browser's own pickers, spied: the desktop must never call them.
    await context.addInitScript(() => {
      for (const n of ['showDirectoryPicker', 'showSaveFilePicker', 'showOpenFilePicker']) {
        const orig = window[n];
        window[n] = (...a) => {
          window.__pickers = [...(window.__pickers ?? []), n];
          return orig?.apply(window, a);
        };
      }
    });
    const p = await context.newPage();
    // A question of the page (beforeunload) is answered yes: the check reloads it many times.
    p.on('dialog', (d) => void d.accept().catch(() => undefined));
    p.on('pageerror', (e) => errors.push(String(e)));
    p.on('console', (m) => m.type() === 'error' && !m.text().startsWith('Failed to load resource') && errors.push(m.text()));
    p.on('response', (r) => {
      const u = new URL(r.url());
      if (u.pathname.startsWith('/api/')) apiLog.push(`${r.request().method()} ${u.pathname} ${r.status()}`);
      if (u.pathname.startsWith('/api/') && r.status() >= 400) refused.push(`${r.request().method()} ${u.pathname} ${r.status()}`);
    });
    return { context, page: p };
  };
  let { context, page } = await newPage();
  const open = async (l) => {
    await page.goto(l.url.replace('/#', '/?example=1&select=body#'));
    await page.waitForSelector('#app[data-ready="1"]', { timeout: 90000 });
  };

  // ------------------------------------------------------------------ first launch
  launcher = await startLauncher();
  await open(launcher);
  // A portable folder's first start shows the model chooser once.
  if ((await page.locator('.sw .sw-chooser').count()) > 0) {
    await page.locator('.sw .sw-chooser button').first().click();
    await closeSettings(page);
  }

  // (a) Change the theme and the interface size through the window.
  await openSettings(page, 'general');
  await page.locator(`${rowSel('general.theme')} button`, { hasText: 'Light' }).click();
  await openSettings(page, 'accessibility');
  const scale = page.locator(`${rowSel('a11y.uiScale')} [role="spinbutton"]`).first();
  await scale.dblclick();
  await scale.locator('input').fill('125');
  await scale.locator('input').press('Enter');
  await sleep(600);
  await closeSettings(page);

  // (c) A render: its file goes to <data>/results/.
  await page.locator('canvas[aria-label="viewport"]').focus();
  await page.waitForFunction(() => !document.querySelectorAll('.hdr .seg button')[1]?.disabled, null, { timeout: 60000 });
  await page.keyboard.press('Control+Enter');
  await page.waitForSelector('.rw');
  const setNumber = async (selector, value) => {
    const el = page.locator(selector).first();
    await el.dblclick();
    await el.locator('input').fill(String(value));
    await el.locator('input').press('Enter');
  };
  await setNumber('.rw [data-section="rw.size"] .num[aria-label="Width"]', 320);
  await setNumber('.rw .num[aria-label="Samples"]', 4);
  // Downloads is written by the launcher (P3b): no browser download, the results viewer opens on it.
  await page.locator('.rw-foot .btn-primary').click();
  await page.waitForSelector('.rv[data-ready="1"]', { timeout: 120000 });
  const downloaded = readdirSync(DOWNLOADS);
  await page.keyboard.press('Escape');
  await sleep(500);
  const resultsDir = join(DATA, 'results');
  const files = existsSync(resultsDir) ? readdirSync(resultsDir) : [];
  const index = existsSync(join(resultsDir, 'index.json')) ? JSON.parse(readFileSync(join(resultsDir, 'index.json'), 'utf8')) : null;
  const first = index?.results?.[0] ?? null;
  const savedSettings = existsSync(join(DATA, 'settings.json')) ? JSON.parse(readFileSync(join(DATA, 'settings.json'), 'utf8')) : null;
  const storage1 = await browserStorage(page);

  // ------------------------------------------------------------------ second launch, in a new browser profile
  const port1 = new URL(launcher.url).port;
  const remembered = existsSync(join(DATA, 'launcher.json')) ? JSON.parse(readFileSync(join(DATA, 'launcher.json'), 'utf8')).port : null;
  await page.goto('about:blank');
  await context.close();
  stopLauncher(launcher);
  await sleep(500);
  ({ context, page } = await newPage());
  launcher = await startLauncher({ stub: true });
  const port2 = new URL(launcher.url).port;
  await open(launcher);
  const attrs = await page.evaluate(() => ({ theme: document.documentElement.dataset.theme, zoom: getComputedStyle(document.documentElement).getPropertyValue('--ui-zoom').trim() }));
  const listed = (await api(launcher, 'GET', '/api/store/results')).json().results.map((m) => m.id);
  const chooserAgain = (await page.locator('.sw .sw-chooser').count()) > 0;
  check('a_settings_survive_a_restart', port1 === port2 && String(remembered) === port1 && savedSettings?.settings?.['general.theme'] === 'light' && savedSettings?.settings?.['a11y.uiScale'] === 125 && attrs.theme === 'light' && attrs.zoom === '1.25' && !chooserAgain, {
    ports: [port1, port2],
    remembered,
    file: savedSettings ? { theme: savedSettings.settings['general.theme'], uiScale: savedSettings.settings['a11y.uiScale'], chooserShown: savedSettings.layout?.chooserShown } : null,
    inForce: attrs,
    chooserAgain,
  });
  const storage2 = await browserStorage(page);
  const clean = (s) => s.localStorage.length === 0 && (s.indexedDB === null || !s.indexedDB.includes('repackshot')) && s.opfs.length === 0;
  check('b_no_browser_storage', clean(storage1) && clean(storage2), { first: storage1, second: storage2 });
  check('c_result_in_the_data_folder', !!first && files.includes(first.file) && files.includes('index.json') && listed.includes(first.id) && downloaded.some((f) => f.endsWith('.png')), { files, index: first ? { id: first.id, file: first.file, type: first.type } : null, listedAfterRestart: listed, downloaded });

  // ------------------------------------------------------------------ the sections, in English then Spanish
  const writeSettings = async (patch) => {
    await page.goto('about:blank');
    await sleep(200);
    const doc = (await api(launcher, 'GET', '/api/store/settings')).json();
    // Fast mode: dozens of reloads would each leave a native viewport job behind (the launcher keeps at most 8).
    doc.settings = { ...doc.settings, 'viewport.startMode': 'FAST', ...patch };
    const put = await api(launcher, 'PUT', '/api/store/settings', JSON.stringify(doc));
    if (put.status !== 204) fail(`PUT settings: ${put.status} ${put.text}`);
    await open(launcher);
  };
  await writeSettings({ 'general.theme': 'dark', 'a11y.uiScale': 100, 'general.lang': 'en', 'ai.device': 'GPU' });
  await page.setViewportSize({ width: 1280, height: 800 });

  // (d) The GPU row, opened before anything was detected (the detection answers after the row is drawn).
  await openSettings(page, 'ai');
  await page.waitForFunction(() => Number(document.querySelector('.sw [data-row="ai.gpu"] .sw-gpu')?.dataset.gpus) > 0, null, { timeout: 30000 });
  const gpuOptions = await page.locator(`${rowSel('ai.gpu')} option`).allInnerTexts();
  const gpuEnabled = await page.locator(`${rowSel('ai.gpu')} select`).isEnabled();
  const aiText = await page.locator('.sw .sw-section').innerText();
  check('d_gpu_row_lists_the_launchers_gpus', gpuOptions.length === 2 && /RTX 4070 Ti SUPER · 16/.test(gpuOptions[0]) && /UHD Graphics 770/.test(gpuOptions[1]) && gpuEnabled && !/only in the desktop application/i.test(aiText), { gpuOptions, gpuEnabled });
  await page.mouse.move(5, 795);
  await sleep(300);
  await page.screenshot({ path: join(SHOTS, 'settings-ai-desktop.png') });

  // (e) No browser anywhere, in both languages.
  const sections = await page.locator('.sw .sw-option[data-section]').evaluateAll((els) => els.map((e) => e.dataset.section));
  const mentions = {};
  for (const lang of ['en', 'es']) {
    if (lang === 'es') {
      await writeSettings({ 'general.lang': 'es' });
    }
    for (const s of sections) {
      await openSettings(page, s);
      await sleep(s === 'storage' || s === 'ai' ? 900 : 150);
      const text = await page.locator('.sw .sw-section').innerText();
      const hits = text.match(/[^\n]*(browser|navegador|msedge|chromium-browser|google-chrome)[^\n]*/gi);
      if (hits) mentions[`${lang}:${s}`] = hits;
    }
    await closeSettings(page);
  }
  await openSettings(page, 'desktop');
  const windowRowEs = await page.locator(`${rowSel('desktop.browser')} .sw-value`).innerText();
  await closeSettings(page);
  await writeSettings({ 'general.lang': 'en' });
  await openSettings(page, 'storage');
  const persistRows = await page.locator(rowSel('storage.persist')).count();
  await openSettings(page, 'desktop');
  const windowRow = await page.locator(`${rowSel('desktop.browser')} .sw-value`).innerText();
  check('e_no_browser_wording', Object.keys(mentions).length === 0 && persistRows === 0 && windowRow === 'Microsoft Edge app window' && windowRowEs === 'Ventana de aplicación de Microsoft Edge', { mentions, persistRows, windowRow, windowRowEs, sections });
  await page.mouse.move(5, 795);
  await sleep(300);
  await page.screenshot({ path: join(SHOTS, 'settings-desktop-paths.png') });

  // (h) Outputs and projects: the launcher's dialogs, never the browser's pickers.
  await openSettings(page, 'preferences');
  apiLog.length = 0;
  await page.locator(`${rowSel('render.destination')} button`, { hasText: 'Choose folder' }).click();
  await page.waitForFunction((dir) => document.querySelector('.sw [data-row="render.destination"]')?.textContent?.includes(dir), RENDERS, { timeout: 20000 });
  await sleep(500);
  const folders = existsSync(join(DATA, 'state', 'desktop.folders.json')) ? JSON.parse(readFileSync(join(DATA, 'state', 'desktop.folders.json'), 'utf8')) : null;
  await closeSettings(page);
  await page.locator('canvas[aria-label="viewport"]').focus();
  await page.keyboard.press('Control+s');
  for (let i = 0; i < 40 && !existsSync(PROJECT); i++) await sleep(250);
  const project = existsSync(PROJECT) ? JSON.parse(readFileSync(PROJECT, 'utf8')) : null;
  const pickers = await page.evaluate(() => window.__pickers ?? []);
  const dialogCalls = apiLog.filter((a) => a.includes('/api/dialog/'));
  check('h_files_through_the_launcher', pickers.length === 0 && dialogCalls.some((a) => a.startsWith('POST /api/dialog/folder 200')) && dialogCalls.some((a) => a.startsWith('POST /api/dialog/save 200')) && folders && Object.values(folders).includes(RENDERS) && project?.format !== undefined, {
    pickers,
    dialogCalls,
    remembered: folders,
    projectWritten: !!project,
  });

  // (f) Storage: the data folder as the launcher measured it; Free up of the thumbnails goes through it.
  await openSettings(page, 'storage');
  await page.waitForSelector('.sw [data-usage="window"]', { timeout: 20000 });
  const usage = (await api(launcher, 'GET', '/api/storage/usage')).json();
  const shownTotal = await page.locator('.sw .sw-usage-total').innerText();
  const usageRows = await page.locator('.sw [data-usage]').evaluateAll((els) => els.map((e) => [e.dataset.usage, Number(e.dataset.bytes)]));
  const thumbsBefore = usage.folders.find((f) => f.id === 'thumbs').bytes;
  const results1 = usage.folders.find((f) => f.id === 'results').bytes;
  const shownResults = usageRows.find(([id]) => id === 'results')?.[1];
  await page.mouse.move(5, 795);
  await sleep(300);
  await page.screenshot({ path: join(SHOTS, 'settings-storage-desktop.png') });
  let thumbsAfter = thumbsBefore;
  if (thumbsBefore > 0) {
    await page.locator('.sw [data-usage="cache"] button').click();
    await page.locator('.sw .sw-confirm button.btn-primary').click();
    await sleep(800);
    thumbsAfter = (await api(launcher, 'GET', '/api/storage/usage')).json().folders.find((f) => f.id === 'thumbs').bytes;
  }
  check('f_storage_is_the_data_folder', /in the data folder/.test(shownTotal) && usageRows.length === 7 && shownResults === results1 && results1 > 0 && thumbsBefore > 0 && thumbsAfter === 0, { shownTotal, usageRows, thumbsBefore, thumbsAfter, dataDir: usage.dataDir });
  await closeSettings(page);

  // (g) No overlap, anywhere.
  const widths = QUICK ? [1280, 960] : [1600, 1280, 960];
  const scales = QUICK ? [100, 150] : [90, 100, 125, 150];
  const looks = QUICK ? [{ theme: 'dark', contrast: false }] : [
    { theme: 'dark', contrast: false },
    { theme: 'light', contrast: false },
    { theme: 'light', contrast: true },
  ];
  const langs = QUICK ? ['en'] : ['en', 'es'];
  const problems = [];
  let measured = 0;
  for (const lang of langs)
    for (const look of looks)
      for (const uiScale of scales) {
        await writeSettings({ 'general.lang': lang, 'general.theme': look.theme, 'a11y.highContrast': look.contrast, 'a11y.uiScale': uiScale });
        for (const width of widths) {
          await page.setViewportSize({ width, height: 800 });
          for (const s of sections) {
            await openSettings(page, s);
            await sleep(s === 'storage' || s === 'ai' || s === 'about' ? 500 : 60);
            const found = await layoutProblems(page);
            measured++;
            for (const p of found) problems.push({ lang, ...look, uiScale, width, section: s, ...p });
          }
          await closeSettings(page);
        }
      }
  check('g_no_overlap', problems.length === 0, { measured, problems: problems.slice(0, 20), count: problems.length });

  check('z_no_errors', errors.length === 0 && refused.length === 0, { errors: errors.slice(0, 10), refused: refused.slice(0, 10) });
  await context.close();
} catch (err) {
  failures++;
  results.error = String(err?.stack ?? err);
  console.error(err);
} finally {
  await browser?.close().catch(() => undefined);
  stopLauncher(launcher);
  writeFileSync(join(OUT, 'desktop-platform-check.json'), JSON.stringify(results, null, 2));
}
process.exit(failures === 0 ? 0 : 1);
