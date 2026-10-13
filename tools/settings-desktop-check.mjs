#!/usr/bin/env node
// Browser checks of phase U6 on the desktop: the Settings window and the model manager in the desktop
// launcher's window (engine/crates/rt-app), with the local Chromium and swiftshader.
//
//   npm run build && (cd engine && cargo build --release -p rt-app) && node tools/settings-desktop-check.mjs [--shots docs/ui]
//
// It copies the launcher to out/desktop-check/ with a portable.txt next to it (a portable folder: data in
// out/desktop-check/data), starts it with `--serve-only --app-dir dist --port 4191`, and opens the URL it prints
// (with the token). The launcher is stopped through its pid at the end.
//
//   (n) the portable folder's first start opens Settings at AI ▸ Models as the chooser, once (not after a reload);
//   (o) Desktop and Storage show the launcher's folders; Open folder asks the launcher (POST /api/open-folder);
//   (p) Render engine: the native engine runs (its version, threads and SIMD path), Full mode in the viewport
//       renders natively and stops at 16 samples, and Measure performance measures it;
//   (q) Engine ▸ WebAssembly switches to the wasm pool, Automatic back to the native engine;
//   (r) Hardware: what the launcher detected (processor, memory) and the recommendation of the table;
//   (s) a model imported from files (with model.repackshot.json) is copied into the launcher's store by sha256,
//       verified there, installed, Ready; Delete removes its blob from the data folder.
//
// Screenshot (English): settings-desktop.png. Results: out/settings-desktop-check.json.

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4191;
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const SHOTS = resolve(ROOT, opt('shots', 'docs/ui'));
const OUT = join(ROOT, 'out');
const DIR = join(OUT, 'desktop-check');
const DATA = join(DIR, 'data');
const results = {};
const fail = (msg) => {
  throw new Error(msg);
};
const check = (key, ok, detail) => {
  results[key] = { ok: Boolean(ok), ...detail };
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${key} ${JSON.stringify(detail)}`);
};
const rowSel = (id) => `.sw [data-row="${id}"]`;

/** Deterministic bytes. */
function bytes(n, seed) {
  const out = Buffer.alloc(n);
  let x = seed >>> 0;
  for (let i = 0; i < n; i++) {
    x = (Math.imul(x, 1103515245) + 12345) >>> 0;
    out[i] = x >>> 24;
  }
  return out;
}
const sha = (b) => createHash('sha256').update(b).digest('hex');

/** The launcher in a portable folder of its own; resolves with the URL it prints. */
function startLauncher() {
  const bin = join(ROOT, 'engine', 'target', 'release', 'repackshot');
  if (!existsSync(bin)) fail('engine/target/release/repackshot is missing: (cd engine && cargo build --release -p rt-app)');
  if (!existsSync(join(ROOT, 'dist', 'index.html'))) fail('dist/ is missing: npm run build first');
  rmSync(DIR, { recursive: true, force: true });
  mkdirSync(DIR, { recursive: true });
  const exe = join(DIR, 'repackshot');
  copyFileSync(bin, exe);
  chmodSync(exe, 0o755);
  writeFileSync(join(DIR, 'portable.txt'), '');
  const child = spawn(exe, ['--serve-only', '--app-dir', join(ROOT, 'dist'), '--port', String(PORT)], { cwd: DIR, stdio: ['ignore', 'pipe', 'pipe'] });
  return new Promise((resolveUrl, reject) => {
    let text = '';
    const timer = setTimeout(() => reject(new Error(`the launcher printed no URL: ${text}`)), 20000);
    const read = (chunk) => {
      text += chunk.toString();
      const m = /http:\/\/127\.0\.0\.1:\d+\/#token=[0-9a-f]{32}/.exec(text);
      if (m) {
        clearTimeout(timer);
        resolveUrl({ url: m[0], child, log: () => text });
      }
    };
    child.stdout.on('data', read);
    child.stderr.on('data', read);
    child.on('exit', (code) => reject(new Error(`the launcher exited (${code}): ${text}`)));
  });
}

async function setNumber(page, selector, value) {
  const el = page.locator(selector).first();
  await el.dblclick();
  const input = el.locator('input');
  await input.fill(String(value));
  await input.press('Enter');
}

let browser = null;
let launcher = null;
try {
  launcher = await startLauncher();
  const { chromium } = await import(join(ROOT, 'node_modules', 'playwright-core', 'index.mjs'));
  browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true, args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  // A failed request is checked by its URL below (the console only says "Failed to load resource").
  page.on('console', (m) => m.type() === 'error' && !m.text().startsWith('Failed to load resource') && errors.push(m.text()));
  const api = [];
  const refused = [];
  page.on('response', (r) => {
    const u = new URL(r.url());
    if (!u.pathname.startsWith('/api/')) return;
    const line = `${r.request().method()} ${u.pathname}${u.search} ${r.status()}`;
    if (r.status() >= 400) refused.push(line.replace(/[0-9a-f]{64}/, '<sha>'));
    if (u.pathname !== '/api/alive' && !u.pathname.startsWith('/api/render')) api.push(line);
  });
  // The launcher's window opens at `/#token=…`; the page takes the token and removes it from the address bar.
  // The example: an empty project does not render natively yet (the launcher takes an RSB without MESH
  // sections for an update and answers 409 need-meshes; see the U6 report).
  await page.goto(`${launcher.url.replace('/#', '/?lang=en&theme=dark&example=1#')}`);
  await page.waitForSelector('#app[data-ready="1"]', { timeout: 90000 });

  // (n) The chooser of the portable's first start.
  await page.waitForSelector('.sw .sw-chooser', { state: 'visible', timeout: 20000 });
  const chooserSection = await page.locator('.sw .sw-section').getAttribute('data-section');
  const tokenGone = !(await page.evaluate(() => location.hash.includes('token')));
  const where = await page.locator('.sw [data-part="ai.models"] .note').first().innerText().catch(() => '');
  const whereAll = (await page.locator('.sw [data-part="ai.models"]').innerText()).replace(/\s+/g, ' ');
  await page.mouse.move(5, 995);
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(SHOTS, 'settings-desktop.png') });
  await page.locator('.sw .sw-chooser button', { hasText: 'Done' }).click().catch(() => undefined);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  await page.reload();
  await page.waitForSelector('#app[data-ready="1"]', { timeout: 90000 });
  await page.waitForTimeout(1500);
  const chooserAgain = (await page.locator('.sw').count()) > 0;
  check('n_first_start_chooser', chooserSection === 'ai' && !chooserAgain && tokenGone && whereAll.includes(join(DATA, 'models')), { chooserSection, chooserAgain, tokenGone, where, models: whereAll.slice(0, 200) });

  // (o) Desktop and Storage: the launcher's folders.
  await page.locator('canvas[aria-label="viewport"]').focus();
  await page.keyboard.press('Control+Comma');
  await page.locator('.sw .sw-option[data-section="desktop"]').click();
  const desktop = (await page.locator('.sw .sw-section').innerText()).replace(/\s+/g, ' ');
  await page.locator(`${rowSel('desktop.logs')} button`).click();
  await page.waitForTimeout(800);
  const opened = api.filter((a) => a.startsWith('POST /api/open-folder'));
  await page.locator('.sw .sw-option[data-section="storage"]').click();
  const storage = (await page.locator(rowSel('storage.folder')).innerText()).replace(/\s+/g, ' ');
  check('o_folders', desktop.includes(DATA) && desktop.includes(join(DATA, 'logs')) && storage.includes(DATA) && opened.length === 1, { desktop: desktop.slice(0, 400), storage, opened });

  // (p) The native engine.
  await page.locator('.sw .sw-option[data-section="engine"]').click();
  await page.waitForFunction(() => /Native/.test(document.querySelector('.sw [data-row="engine.info"]')?.textContent ?? ''), null, { timeout: 20000 });
  const info = (await page.locator(rowSel('engine.info')).innerText()).replace(/\s+/g, ' ');
  const threadsAux = (await page.locator(rowSel('engine.threads')).innerText()).replace(/\s+/g, ' ');
  await page.locator('.sw .sw-measure').click();
  await page.waitForSelector('.sw .sw-measure-out[data-state="DONE"]', { timeout: 60000 });
  const rate = Number(await page.locator('.sw .sw-measure-out').getAttribute('data-rate'));
  const detail = await page.locator('.sw .sw-measure-detail').innerText();
  await page.locator(`${rowSel('engine.viewportLimit')} button`, { hasText: 'At N samples' }).click();
  await setNumber(page, `${rowSel('engine.viewportSamples')} [role="spinbutton"]`, 16);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.locator('.hdr .seg button', { hasText: 'Full' }).click();
  await page.waitForFunction(() => Number(document.querySelector('.ov-bl')?.dataset.samples) >= 16, null, { timeout: 60000 });
  await page.waitForTimeout(2500);
  const samples = Number(await page.locator('.ov-bl').getAttribute('data-samples'));
  const meter = (await page.locator('.ov-bl').innerText()).replace(/\s+/g, ' ');
  check('p_native_engine', /Native/.test(info) && /threads/.test(threadsAux) && rate > 0 && /Native/.test(detail) && samples === 16 && /Native/i.test(meter), { info, threadsAux, rate, detail, samples, meter });

  // (q) WebAssembly, then Automatic again.
  await page.locator('canvas[aria-label="viewport"]').focus();
  await page.keyboard.press('Control+Comma');
  await page.locator('.sw .sw-option[data-section="engine"]').click();
  await page.locator(`${rowSel('engine.backend')} select`).selectOption('WASM');
  await page.waitForFunction(() => /WebAssembly/.test(document.querySelector('.sw [data-row="engine.info"]')?.textContent ?? ''), null, { timeout: 30000 });
  const wasmInfo = (await page.locator(rowSel('engine.info')).innerText()).replace(/\s+/g, ' ');
  await page.locator(`${rowSel('engine.backend')} select`).selectOption('AUTO');
  await page.waitForFunction(() => /Native/.test(document.querySelector('.sw [data-row="engine.info"]')?.textContent ?? ''), null, { timeout: 30000 });
  const backInfo = (await page.locator(rowSel('engine.info')).innerText()).replace(/\s+/g, ' ');
  check('q_backend_switch', /workers/.test(wasmInfo) && /Native/.test(backInfo), { wasmInfo, backInfo });

  // (r) Hardware, as the launcher detected it.
  await page.locator('.sw .sw-option[data-section="ai"]').click();
  await page.waitForSelector('.sw [data-rec]', { timeout: 30000 });
  const hw = (await page.locator('.sw [data-part="ai.hardware"]').innerText()).replace(/\s+/g, ' ');
  const rec = await page.locator('.sw [data-rec]').getAttribute('data-rec');
  const launcherHw = await page.evaluate(async () => {
    const token = sessionStorage.getItem('repackshot.token');
    const r = await fetch('/api/hardware', { headers: { 'X-Repackshot-Token': token } });
    return r.json();
  });
  const launcherRec = launcherHw.recommendation?.recommended ?? null;
  const sameRec = rec === (launcherRec ?? (launcherHw.recommendation ? 'NONE' : 'FAILED'));
  check('r_hardware', /Processor/.test(hw) && hw.includes(launcherHw.cpu) && sameRec, { rec, launcherRec, launcherRow: launcherHw.recommendation?.rowId ?? null, hw: hw.slice(0, 500) });

  // (s) Import a model into the launcher's store, then delete it.
  const model = bytes(3 * 1024 * 1024 + 123, 11);
  const modelSha = sha(model);
  const manifest = {
    format: 'repackshot-model',
    schema: 1,
    key: 'DESK_TEST',
    name: 'Desktop import test',
    family: 'sd15',
    role: 'img2img',
    quantization: 'fp16',
    licence: { spdx: 'Apache-2.0', url: 'https://www.apache.org/licenses/LICENSE-2.0', commercialUse: true },
    files: [{ name: 'desk-test.gguf', role: 'transformer', bytes: model.length, sha256: modelSha }],
    source: 'tools/settings-desktop-check.mjs',
  };
  const chooser = page.waitForEvent('filechooser');
  await page.locator(`${rowSel('ai.import')} button`, { hasText: 'Import model…' }).click();
  await (await chooser).setFiles([
    { name: 'desk-test.gguf', mimeType: 'application/octet-stream', buffer: model },
    { name: 'model.repackshot.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(manifest)) },
  ]);
  const row = '.sw [data-model="DESK_TEST"]';
  await page.waitForFunction((sel) => ['READY', 'IN_USE'].includes(document.querySelector(sel)?.dataset.state ?? ''), row, { timeout: 60000 });
  const blobPath = join(DATA, 'models', 'blobs', modelSha);
  const stored = existsSync(blobPath) && sha(readFileSync(blobPath)) === modelSha;
  const installed = JSON.parse(readFileSync(join(DATA, 'models', 'installed.json'), 'utf8')).installed;
  const manifestKept = existsSync(join(DATA, 'models', 'imported', 'DESK_TEST.json'));
  await page.locator(`${row} button`, { hasText: 'Delete' }).click();
  await page.locator(`${row} .confirm button`, { hasText: 'Delete' }).click();
  await page.waitForFunction((sel) => !document.querySelector(sel), row, { timeout: 10000 });
  const blobGone = !existsSync(blobPath);
  const modelCalls = api.filter((a) => a.includes('/api/models')).map((a) => a.replace(/[0-9a-f]{64}/, '<sha>'));
  check('s_import_delete', stored && installed.includes('DESK_TEST') && manifestKept && blobGone, { stored, installed, manifestKept, blobGone, calls: [...new Set(modelCalls)] });
  // Open folder fails in a system without a file manager (this container): the launcher answers 500 and the
  // interface says so. Nothing else may fail.
  const unexpected = refused.filter((r) => !r.startsWith('POST /api/open-folder '));
  check('errors', errors.length === 0 && unexpected.length === 0, { errors, refused });
} catch (err) {
  check('run', false, { error: String(err?.stack ?? err), launcher: launcher?.log().slice(-2000) });
} finally {
  await browser?.close();
  launcher?.child.kill('SIGTERM');
  writeFileSync(join(OUT, 'settings-desktop-check.json'), JSON.stringify(results, null, 2));
  const failed = Object.entries(results).filter(([, v]) => !v.ok);
  console.log(failed.length === 0 ? 'all desktop settings checks passed' : `${failed.length} failed: ${failed.map(([k]) => k).join(', ')}`);
  process.exit(failed.length === 0 ? 0 : 1);
}
