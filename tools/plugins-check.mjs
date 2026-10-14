#!/usr/bin/env node
// Browser check of phase P6 (plugins), with the local Chromium and swiftshader.
//
//   npm run engine:build && npm run build && node tools/plugins-check.mjs [--film <film.rpk> --film-key <key file>] [--shots docs/ui]
//
// It builds a second copy with `vite build --mode plugin-test --outDir out/dist-plugin-test` (the only build that
// reads `?testPlugins=`, see src/main.ts) and serves it with `vite preview --port 4195 --strictPort`; a tiny Node
// server on port 4196 serves the packages with CORS: the invert test plugin (tests/fixtures/plugins/invert, packed
// here under a new key kept in memory) and, with --film, the film plugin's package built by
// tools/plugins/build-film.mjs, under the film's own registry entry pointed at this server. Servers are stopped by
// the pids `lsof -t -i :<port>` reports, never `pkill -f`.
//
//   (a) Settings ▸ Plugins lists the registry: each plugin with Install, the Closed licence badge, its project page
//       and the sentence that its code is closed and Repackshot's licence does not cover it;
//   (b) Install the test plugin from the local server: the activation key is asked for (no key address), a wrong
//       key is said, the right one installs it; its logo shows and its licence opens in full;
//   (c) Remove, then Install from file… with the .rpk and the typed key;
//   (d) with --film: the film plugin from the local server with its typed key;  → settings-plugins.png
//   (e) a render, then Render window ▸ Plugins: a block per plugin drawn from its manifest (logo, name, notice,
//       project page, badge); the invert preview with the plugin's numbers; a control changes it, undo brings it back;
//   (f) with --film: a recipe of the film plugin and its preview with the engine's numbers;  → render-plugins-film.png
//   (g) Apply: a new result in the results viewer with its provenance, saved as <name>_<plugin>.png;
//   (h) the Plugins section and Settings ▸ Plugins are achromatic (every computed colour has r = g = b, but the
//       pictures and the logos), and a reload keeps what is installed.
//
// Results: out/plugins-check.json.

import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { packFolder } from './plugin-pack.mjs';
import { encodeKeyText, newKeyBytes } from './plugin-rpk.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4195;
const FILES_PORT = 4196;
const BASE_URL = `http://localhost:${PORT}`;
const FILES_URL = `http://localhost:${FILES_PORT}`;
const args = process.argv.slice(2);
const opt = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const SHOTS = resolve(ROOT, opt('shots', 'docs/ui'));
const OUT = join(ROOT, 'out');
mkdirSync(OUT, { recursive: true });
mkdirSync(SHOTS, { recursive: true });
const results = {};
let failures = 0;
const fail = (msg) => {
  throw new Error(msg);
};
const check = (key, ok, detail = {}) => {
  results[key] = { ok: Boolean(ok), ...detail };
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${key} ${JSON.stringify(detail)}`);
};
const sha256 = (b) => createHash('sha256').update(b).digest('hex');

function stopPort(port) {
  const run = spawnSync('lsof', ['-t', '-i', `:${port}`]);
  for (const pid of run.stdout.toString().split(/\s+/).filter(Boolean)) {
    if (Number(pid) === process.pid) continue;
    try {
      process.kill(Number(pid), 'SIGTERM');
    } catch {
      // gone
    }
  }
}

async function waitFor(url, ms = 60000) {
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

// ------------------------------------------------------------------ the packages and their server

const invertKey = newKeyBytes();
const invert = (await packFolder(join(ROOT, 'tests', 'fixtures', 'plugins', 'invert'), invertKey)).bytes;
const INVERT_KEY = encodeKeyText(invertKey);
const filmPath = opt('film');
const filmKeyPath = opt('film-key');
const film = filmPath ? new Uint8Array(readFileSync(filmPath)) : null;
const FILM_KEY = filmKeyPath ? readFileSync(filmKeyPath, 'utf8').trim() : null;
if (film && !FILM_KEY) fail('--film needs --film-key');
const filmVersion = film ? JSON.parse(new TextDecoder().decode(film.subarray(8, 8 + new DataView(film.buffer, film.byteOffset).getUint32(4, true)))).version : null;
const served = { '/invert-1.0.0.rpk': invert, ...(film ? { [`/film-${filmVersion}.rpk`]: film } : {}) };
const fileServer = createServer((req, res) => {
  const cors = { 'Access-Control-Allow-Origin': '*' };
  const body = served[req.url ?? ''];
  if (!body) {
    res.writeHead(404, cors);
    res.end();
    return;
  }
  res.writeHead(200, { ...cors, 'Content-Type': 'application/octet-stream', 'Content-Length': String(body.length) });
  res.end(Buffer.from(body));
});

const registry = JSON.parse(readFileSync(join(ROOT, 'src', 'data', 'plugins.json'), 'utf8')).plugins;
const filmEntry = registry.find((e) => e.id === 'aintfilm-film');
const testEntries = [
  // The film plugin's own entry, with its package served here (the release asset is the same file).
  ...(film ? [{ ...filmEntry, version: filmVersion, url: `${FILES_URL}/film-${filmVersion}.rpk`, sha256: sha256(film), bytes: film.length }] : []),
  {
    id: 'test-invert',
    name: { en: 'Invert (test plugin)', es: 'Invertir (plugin de prueba)' },
    publisher: 'Repackshot tests',
    version: '1.0.0',
    summary: { en: 'Inverts the colours of a result: a fixture of the tests, served by the browser check.', es: 'Invierte los colores de un resultado: un fixture de los tests, servido por la comprobación de navegador.' },
    licence: { kind: 'closed', label: { en: 'Closed licence', es: 'Licencia cerrada' } },
    homepage: 'https://github.com/Grohle-developer/Repackshot',
    url: `${FILES_URL}/invert-1.0.0.rpk`,
    sha256: sha256(invert),
    bytes: invert.length,
    keyUrl: '',
    logo: 'logo.svg',
  },
];
const TEST_PARAM = encodeURIComponent(Buffer.from(JSON.stringify(testEntries)).toString('base64'));

async function preview(outDir) {
  stopPort(PORT);
  await new Promise((r) => setTimeout(r, 500));
  spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort', '--outDir', outDir], { cwd: ROOT, stdio: 'ignore', detached: true }).unref();
  await waitFor(BASE_URL);
}

async function chromatic(page, root) {
  return page.evaluate((sel) => {
    const out = [];
    const parse = (v) => {
      const m = /rgba?\(([^)]+)\)/.exec(v);
      return m ? m[1].split(/[\s,/]+/).filter(Boolean).map(Number) : null;
    };
    const host = document.querySelector(sel);
    if (!host) return ['missing'];
    for (const el of [host, ...host.querySelectorAll('*')]) {
      // The pictures and the plugins' logos are content, not chrome.
      if (el.tagName === 'CANVAS' || el.tagName === 'IMG' || el.closest('.split-img')) continue;
      const cs = getComputedStyle(el);
      for (const prop of ['color', 'backgroundColor', 'borderTopColor', 'borderLeftColor', 'outlineColor', 'fill', 'stroke']) {
        const p = parse(cs[prop]);
        if (!p || p.length < 3 || (p.length > 3 && p[3] === 0)) continue;
        if (Math.abs(p[0] - p[1]) > 0.5 || Math.abs(p[1] - p[2]) > 0.5) out.push([el.className || el.tagName, prop, cs[prop]]);
      }
    }
    return out;
  }, root);
}

const card = (id) => `.sw-pl[data-plugin="${id}"]`;
const block = (id) => `.rw-pl[data-plugin="${id}"]`;

async function openRenderWindow(page) {
  await page.locator('.render-btn').click();
  await page.waitForSelector('.rw');
  const sec = page.locator('.rw [data-section="rw.plugins"]');
  if ((await sec.getAttribute('data-collapsed')) !== null) await sec.locator('.section-head').click();
  await page.locator('.rw-body').evaluate((el) => {
    const s = el.querySelector('[data-section="rw.plugins"]');
    el.scrollTo(0, s.offsetTop - 2);
  });
}

async function setNumber(page, selector, value) {
  const field = page.locator(selector).first();
  await field.dblclick();
  await field.locator('input').fill(String(value));
  await field.locator('input').press('Enter');
}

// ------------------------------------------------------------------ main

let browser = null;
try {
  if (!existsSync(join(ROOT, 'public', 'engine', 'rt.wasm'))) fail('public/engine/rt.wasm is missing: npm run engine:build first');
  if (!existsSync(join(ROOT, 'public', 'vendor'))) fail('public/vendor is missing: npm run build first');
  const built = spawnSync('npx', ['vite', 'build', '--mode', 'plugin-test', '--outDir', 'out/dist-plugin-test', '--emptyOutDir'], { cwd: ROOT, encoding: 'utf8' });
  if (built.status !== 0) fail(`plugin-test build failed: ${built.stderr}`);
  stopPort(FILES_PORT);
  await new Promise((r) => fileServer.listen(FILES_PORT, r));
  await preview('out/dist-plugin-test');
  const { chromium } = await import(join(ROOT, 'node_modules', 'playwright-core', 'index.mjs'));
  browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true, args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && !m.location().url.startsWith('https://api.github.com/') && errors.push(m.text()));
  const downloads = [];
  page.on('download', (d) => downloads.push(d.suggestedFilename()));
  const query = `example=1&lang=en&mode=fast&theme=dark&testPlugins=${TEST_PARAM}`;
  await page.goto(`${BASE_URL}/?${query}&settings=plugins.list`);
  await page.waitForSelector('#app[data-ready="1"]', { timeout: 120000 });
  await page.waitForSelector(`${card('test-invert')}`, { timeout: 60000 });

  // (a) The list.
  {
    const ids = await page.locator('.sw-pl').evaluateAll((els) => els.map((e) => e.dataset.plugin));
    const t = await page.locator(card('test-invert')).innerText();
    const badge = await page.locator(`${card('test-invert')} .sw-pl-licence`).textContent();
    const sentence = await page.locator(`${card('test-invert')} .sw-pl-closed`).textContent();
    const link = await page.locator(`${card('test-invert')} .sw-pl-links a`).getAttribute('href');
    const install = await page.locator(`${card('test-invert')} .sw-pl-install`).count();
    const filmCard = await page.locator(card('aintfilm-film')).innerText();
    check('a_registry_list', ids.includes('aintfilm-film') && ids.includes('test-invert') && badge === 'Closed licence' && sentence === 'This plugin’s code is closed; Repackshot’s licence does not cover it.' && link?.startsWith('https://') && install === 1 && /aintfilm · film simulation/.test(filmCard) && /Not installed/.test(t), { ids, badge, sentence, link, install, text: t.slice(0, 300), film: filmCard.slice(0, 200) });
  }

  // (b) Install from the local server: the key is asked for; wrong, then right.
  {
    await page.locator(`${card('test-invert')} .sw-pl-install`).click();
    await page.waitForSelector(`${card('test-invert')} .sw-pl-key[data-reason="NONE"]`, { timeout: 30000 });
    const asked = await page.locator(`${card('test-invert')} .sw-pl-key`).innerText();
    await page.locator(`${card('test-invert')} .sw-pl-key-input`).fill(encodeKeyText(newKeyBytes()));
    await page.locator(`${card('test-invert')} .sw-pl-key button[type=submit]`).click();
    await page.waitForSelector(`${card('test-invert')} .sw-pl-key[data-reason="WRONG"]`, { timeout: 30000 });
    const wrong = await page.locator(`${card('test-invert')} .sw-pl-key`).innerText();
    await page.locator(`${card('test-invert')} .sw-pl-key-input`).fill(INVERT_KEY);
    await page.locator(`${card('test-invert')} .sw-pl-key button[type=submit]`).click();
    await page.waitForSelector(`${card('test-invert')}[data-state="INSTALLED"]`, { timeout: 30000 });
    const state = await page.locator(`${card('test-invert')} .sw-pl-state`).textContent();
    const logo = await page.locator(`${card('test-invert')} .sw-pl-logo img`).getAttribute('src');
    await page.locator(`${card('test-invert')} details[data-plugin-text="LICENCE.txt"] summary`).click();
    await page.waitForFunction((sel) => /fixture of Repackshot/.test(document.querySelector(sel)?.textContent ?? ''), `${card('test-invert')} details[data-plugin-text="LICENCE.txt"] pre`, { timeout: 10000 });
    check('b_install_with_typed_key', /activated with a key/.test(asked) && /does not open this plugin/.test(wrong) && /^Installed: version 1\.0\.0/.test(state ?? '') && /^data:image\/svg\+xml/.test(logo ?? ''), { state, logo: logo?.slice(0, 30) });
  }

  // (c) Remove, then Install from file with the typed key.
  {
    await page.locator(`${card('test-invert')} .sw-pl-remove`).click();
    await page.locator(`${card('test-invert')} .sw-pl-panel .btn-primary`).click();
    await page.waitForSelector(`${card('test-invert')}[data-state="NOT_INSTALLED"]`, { timeout: 30000 });
    const rpkPath = join(OUT, 'plugins-check-invert.rpk');
    writeFileSync(rpkPath, invert);
    await page.locator('.sw-pl-file-input').setInputFiles(rpkPath);
    await page.locator('.sw-pl-file-key').fill(INVERT_KEY);
    await page.locator('.sw-pl-file-install').click();
    await page.waitForSelector('.sw-pl-file-status[data-outcome="DONE"]', { timeout: 30000 });
    const status = await page.locator('.sw-pl-file-status').textContent();
    const fromFile = await page.locator(`${card('test-invert')} .sw-badge`, { hasText: 'From a file' }).count();
    check('c_install_from_file', /^Installed: Invert \(test plugin\) 1\.0\.0$/.test(status ?? '') && fromFile === 1, { status, fromFile });
  }

  // (d) The film plugin from the local server, with its typed key.
  if (film) {
    await page.locator(`${card('aintfilm-film')} .sw-pl-install`).click();
    await page.waitForSelector(`${card('aintfilm-film')} .sw-pl-key`, { timeout: 60000 });
    await page.locator(`${card('aintfilm-film')} .sw-pl-key-input`).fill(FILM_KEY);
    await page.locator(`${card('aintfilm-film')} .sw-pl-key button[type=submit]`).click();
    await page.waitForSelector(`${card('aintfilm-film')}[data-state="INSTALLED"]`, { timeout: 60000 });
    const state = await page.locator(`${card('aintfilm-film')} .sw-pl-state`).textContent();
    // The package served is the one the registry pins (the release asset): its size and SHA-256.
    check('d_registry_pins_this_package', filmEntry.sha256 === sha256(film) && filmEntry.bytes === film.length && filmEntry.version === filmVersion, { registry: { sha256: filmEntry.sha256, bytes: filmEntry.bytes }, served: { sha256: sha256(film), bytes: film.length } });
    check('d_film_installed', new RegExp(`^Installed: version ${filmVersion.replace(/\./g, '\\.')}`).test(state ?? ''), { state });
  } else check('d_film_installed', true, { skipped: 'no --film' });
  await page.locator('.sw-content').evaluate((el) => el.scrollTo(0, 0));
  await page.waitForTimeout(400);
  const settingsColours = await chromatic(page, '.sw');
  // The whole section in one picture: the window as tall as its content, the deep link's highlight gone.
  await page.setViewportSize({ width: 1600, height: 1500 });
  await page.evaluate(() => document.querySelectorAll('.is-flash').forEach((el) => el.classList.remove('is-flash')));
  const tall = await page.addStyleTag({ content: '.sw{height:auto!important;max-height:none!important;top:16px!important;transform:translateX(-50%)!important}.sw-content{overflow:visible!important}' });
  await page.waitForTimeout(400);
  await page.locator('.sw').screenshot({ path: join(SHOTS, 'settings-plugins.png') });
  await tall.evaluate((el) => el.remove());
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.keyboard.press('Escape');

  // (e) A render to work on, then the render window's Plugins section.
  await page.waitForFunction(() => !document.querySelectorAll('.hdr .seg button')[1]?.disabled, null, { timeout: 120000 });
  await page.locator('.render-btn').click();
  await page.waitForSelector('.rw');
  await setNumber(page, '.rw .num[aria-label="Width"]', 640);
  await setNumber(page, '.rw .num[aria-label="Samples"]', 16);
  await page.locator('.rw-foot .btn-primary').click();
  await page.waitForSelector('.rv[data-ready="1"]', { timeout: 300000 });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  await openRenderWindow(page);
  {
    const blocks = await page.locator('.rw-pl').evaluateAll((els) => els.map((e) => e.dataset.plugin));
    const head = await page.locator(`${block('test-invert')} .rw-pl-head`).textContent();
    const link = await page.locator(`${block('test-invert')} .rw-pl-notice a`).getAttribute('href');
    await page.waitForSelector(`${block('test-invert')} .rw-pl-frame[data-phase="DONE"]`, { timeout: 60000 });
    const meter = await page.locator(`${block('test-invert')} .rw-pl-meter`).textContent();
    const stateLine = await page.locator(`${block('test-invert')} .rw-pl-state`).textContent();
    const controls = await page.locator(`${block('test-invert')} [data-control]`).evaluateAll((els) => els.map((e) => e.dataset.control));
    check('e_blocks_from_manifest', blocks.includes('test-invert') && (!film || blocks.includes('aintfilm-film')) && /Invert \(test plugin\)/.test(head) && /Closed licence/.test(head) && link?.startsWith('https://') && controls.join(',') === 'amount,channel,mono', { blocks, controls });
    check('e_preview_with_plugin_numbers', /Pixels [\d,.]+ · Input rgba8 · Inverted 100 %/.test(meter ?? '') && /× \d+ · 8-bit picture · from /.test(stateLine ?? ''), { meter, stateLine });
    await setNumber(page, `${block('test-invert')} [data-control="amount"] .num`, 0.5);
    await page.waitForFunction((sel) => /Inverted 50 %/.test(document.querySelector(sel)?.textContent ?? ''), `${block('test-invert')} .rw-pl-meter`, { timeout: 30000 });
    await page.locator('.rw').focus();
    await page.keyboard.press('Control+z');
    await page.waitForFunction((sel) => /Inverted 100 %/.test(document.querySelector(sel)?.textContent ?? ''), `${block('test-invert')} .rw-pl-meter`, { timeout: 30000 });
    const value = await page.locator(`${block('test-invert')} [data-control="amount"] input[type=range]`).inputValue();
    check('e_control_and_undo', value === '1', { value });
  }

  // (f) The film plugin: a recipe and its preview with the engine's numbers.
  if (film) {
    await page.waitForFunction((sel) => !document.querySelector(sel)?.disabled, `${block('aintfilm-film')} .rw-pl-recipe`, { timeout: 60000 });
    const groups = await page.locator(`${block('aintfilm-film')} .rw-pl-recipe optgroup`).evaluateAll((els) => els.map((e) => `${e.label} (${e.children.length})`));
    await page.locator(`${block('aintfilm-film')} .rw-pl-recipe`).selectOption('cn-01');
    await page.waitForFunction((sel) => document.querySelector(sel)?.dataset.phase === 'WORKING', `${block('aintfilm-film')} .rw-pl-frame`, { timeout: 30000 }).catch(() => undefined);
    await page.waitForSelector(`${block('aintfilm-film')} .rw-pl-frame[data-phase="DONE"]`, { timeout: 120000 });
    const meter = await page.locator(`${block('aintfilm-film')} .rw-pl-meter`).textContent();
    const time = await page.locator(`${block('aintfilm-film')} .rw-pl-time`).textContent();
    const notice = await page.locator(`${block('aintfilm-film')} .rw-pl-notice`).textContent();
    check('f_film_recipe_preview', groups.length >= 6 && /Negative per pixel [\d.]+ µm/.test(meter ?? '') && /Engine wasm/.test(meter ?? '') && /^The plugin took/.test(time ?? '') && /A preview of aintfilm/.test(notice ?? ''), { groups, meter, time });
    // The section alone, the film's block alone, as tall as it is.
    const style = await page.addStyleTag({ content: `.rw{height:auto!important;max-height:none!important}.rw-body{overflow:visible!important}.rw-body>.section:not([data-section="rw.plugins"]){display:none!important}.rw-pl:not([data-plugin="aintfilm-film"]){display:none!important}.rw-pl-foot{display:none!important}.rw-ai-preview{position:static!important}` });
    await page.waitForTimeout(600);
    await page.locator('.rw').screenshot({ path: join(SHOTS, 'render-plugins-film.png') });
    await style.evaluate((el) => el.remove());
  } else check('f_film_recipe_preview', true, { skipped: 'no --film' });
  const sectionColours = await chromatic(page, '.rw [data-section="rw.plugins"]');

  // (g) Apply: a new result with its provenance.
  {
    const id = film ? 'aintfilm-film' : 'test-invert';
    const before = downloads.length;
    await page.locator(`${block(id)} .rw-pl-apply`).click();
    await page.waitForSelector('.rv[data-ready="1"] .rv-provenance', { timeout: 300000 });
    const prov = await page.locator('.rv-provenance').textContent();
    await page.waitForTimeout(500);
    const names = downloads.slice(before);
    const expectProv = film ? /^Made with aintfilm · film simulation [\d.]+, recipe CN-01, from .+\.png$/ : /^Made with Invert \(test plugin\) 1\.0\.0 from .+\.png$/;
    check('g_apply_provenance', expectProv.test(prov ?? '') && names.some((n) => n.endsWith(`_${id}.png`)), { prov, names });
    await page.keyboard.press('Escape');
  }

  // (h) Achromatic chrome, and a reload keeps what is installed.
  check('h_achromatic', settingsColours.length === 0 && sectionColours.length === 0, { settings: settingsColours.slice(0, 4), section: sectionColours.slice(0, 4) });
  await page.goto(`${BASE_URL}/?${query}&settings=plugins.list`);
  await page.waitForSelector('#app[data-ready="1"]', { timeout: 120000 });
  await page.waitForSelector(`${card('test-invert')}[data-state="INSTALLED"]`, { timeout: 60000 });
  const filmKept = film ? (await page.locator(`${card('aintfilm-film')}[data-state="INSTALLED"]`).count()) === 1 : true;
  check('h_reload_keeps_installed', filmKept, {});
  check('no_page_errors', errors.length === 0, { errors: errors.slice(0, 5) });
} catch (err) {
  check('run', false, { error: err instanceof Error ? err.message : String(err) });
} finally {
  await browser?.close();
  fileServer.close();
  stopPort(PORT);
  writeFileSync(join(OUT, 'plugins-check.json'), `${JSON.stringify(results, null, 2)}\n`);
  console.log(failures ? `plugins-check: ${failures} failed` : 'plugins-check: all passed');
  process.exit(failures ? 1 : 0);
}
