#!/usr/bin/env node
// Browser checks of phase X7 (the AI model through an API, AI-POST.md §8) in the web build, with the local Chromium
// and swiftshader, against a **local fake image-to-image service** on 127.0.0.1 (never the network): it answers every
// request with the image it was sent and counts what it got.
//
//   npm run engine:build && npm run build && node tools/ai-api-check.mjs [--url http://localhost:4194] [--shots docs/ui]
//
//   (a) Settings ▸ AI post-processing ▸ Model by API: Run the model · Through an API, the generic endpoint's form with
//       the URL of the fake, a problem line until it is complete, then "Renders go to <host>"; the key saved shows
//       masked, the field forgets it, the browser's warning is there, and the key is in its own local storage entry and
//       nowhere in the settings document; the presets show their summary and the "not tried against the live service"
//       note; the block is achromatic;
//   (b) the render window: the AI line says "Through an API · … · <host>"; turning the switch on asks first, in place
//       (no window), and nothing reaches the service before the answer; Not now leaves it off and sends nothing;
//       Allow and send turns it on, the preview goes through the service with the key in its header only, and the
//       guard's report is shown as for a local model;
//   (c) Settings lists the allowed host; Revoke takes it away, and the render window asks again and sends nothing;
//   (d) the Spanish interface has the section's words in Spanish.
//
// Screenshots: settings-ai-api.png, settings-ai-api-preset.png, ai-api-consent.png, ai-api-section.png.
// Results: out/ai-api-check.json.

import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4194;
const STUDIO = 'example=1&preset=JEWELLERY&setup=REMBRANDT&mode=fast';
/** Not a real key: what is stored and then looked for. */
const KEY = 'test-key-0000-not-a-secret-7f3a';
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

// ------------------------------------------------------------------ the fake service

const seen = [];
function startFake() {
  const server = createServer((req, res) => {
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type, accept', 'Access-Control-Allow-Methods': 'POST, PUT, OPTIONS' };
    if (req.method === 'OPTIONS') return void res.writeHead(204, cors).end();
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString();
      seen.push({ auth: req.headers.authorization ?? null, body });
      let image = '';
      try {
        const v = JSON.parse(body);
        image = String(v.image ?? '').replace(/^data:image\/png;base64,/, '');
      } catch {
        // not JSON
      }
      res.writeHead(200, { ...cors, 'Content-Type': 'application/json' }).end(JSON.stringify({ image }));
    });
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok({ server, port: server.address().port })));
}

let BASE_URL = opt('url', null);

async function open(browser, query) {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && !m.location().url.startsWith('https://api.github.com/') && errors.push(m.text()));
  await page.goto(`${BASE_URL}/?${query}`);
  await page.waitForSelector('#app[data-ready="1"]', { timeout: 90000 });
  return { page, context, errors };
}

const section = '.rw [data-section="rw.ai"]';

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

/** The window with only the API block shown, as tall as it is. */
async function shootApiBlock(page, file) {
  const style = await page.addStyleTag({
    content: '.sw{height:auto!important;max-height:none!important;top:0!important;transform:translateX(-50%)!important}.sw-content,.sw-main{overflow:visible!important;max-height:none!important}.sw-section>.sw-block:not([data-block="api"]),.sw-section>.sw-advanced,.sw-ai-top{display:none!important}',
  });
  await page.waitForTimeout(300);
  await page.locator('.sw').screenshot({ path: file });
  await style.evaluate((el) => el.remove());
}

async function shootSection(page, file) {
  const style = await page.addStyleTag({ content: '.rw{height:auto!important;max-height:none!important}.rw-body{overflow:visible!important}.rw-body>.section:not([data-section="rw.ai"]){display:none!important}.rw-ai-preview{position:static!important}' });
  await page.waitForTimeout(400);
  await page.locator('.rw').screenshot({ path: file });
  await style.evaluate((el) => el.remove());
}

async function openRenderAi(page) {
  await page.locator('.render-btn').click();
  await page.waitForSelector('.rw');
  if ((await page.locator(`${section}[data-collapsed]`).count()) > 0) await page.locator(`${section} .section-head`).click();
  await page.locator('.rw-body').evaluate((el) => {
    const s = el.querySelector('[data-section="rw.ai"]');
    el.scrollTo(0, s.offsetTop - 2);
  });
  await page.waitForTimeout(300);
}

let browser = null;
let server = null;
let fakeServer = null;
try {
  if (!existsSync(join(ROOT, 'public', 'engine', 'post.wasm'))) fail('public/engine/post.wasm is missing: npm run engine:build first');
  if (!existsSync(join(ROOT, 'dist', 'index.html'))) fail('dist/ is missing: npm run build first');
  if (!BASE_URL) {
    stopServer();
    server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: 'ignore', detached: true });
    BASE_URL = `http://localhost:${PORT}`;
  }
  await waitFor(BASE_URL);
  const fake = await startFake();
  fakeServer = fake.server;
  const HOST = `127.0.0.1:${fake.port}`;
  const URL_ = `http://${HOST}/v1/img`;
  const { chromium } = await import(join(ROOT, 'node_modules', 'playwright-core', 'index.mjs'));
  browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true, args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });

  const { page, context, errors } = await open(browser, `${STUDIO}&lang=en&theme=dark&settings=ai.source`);
  // ---------------------------------------------------------------- (a) Settings ▸ Model by API
  {
    await page.waitForSelector('.sw [data-row="ai.source"]', { timeout: 20000 });
    await page.locator('.sw [data-row="ai.source"] button', { hasText: 'Through an API' }).click();
    await page.waitForTimeout(200);
    const problem0 = (await page.locator('.sw [data-api-problem]').first().textContent())?.trim();
    const urlField = page.locator('.sw [data-api-form] input[aria-label="URL"]');
    await urlField.fill(URL_);
    await urlField.press('Enter');
    await page.waitForSelector('.sw [data-api-ready]', { timeout: 5000 });
    const ready = (await page.locator('.sw [data-api-ready]').textContent())?.trim();
    const keyState0 = (await page.locator('.sw [data-api-key-state]').textContent())?.trim();
    await page.locator('.sw [data-api-key-input]').fill(KEY);
    await page.locator('.sw [data-api-key-save]').click();
    await page.waitForFunction(() => /••••/.test(document.querySelector('.sw [data-api-key-state]')?.textContent ?? ''), null, { timeout: 5000 });
    const keyState = (await page.locator('.sw [data-api-key-state]').textContent())?.trim();
    const fieldAfter = await page.locator('.sw [data-api-key-input]').inputValue();
    const where = (await page.locator('.sw [data-api-key-where]').textContent())?.trim();
    const storage = await page.evaluate(() => ({ keys: localStorage.getItem('repackshot.ai.apiKeys'), settings: localStorage.getItem('repackshot.settings') }));
    const domHasKey = await page.evaluate((k) => document.documentElement.outerHTML.includes(k), KEY);
    check(
      'a_settings_api',
      /Write a URL|not a web address/.test(problem0 ?? '') && ready === `Renders go to ${HOST}` && keyState0 === `No key stored for ${HOST}` && keyState === `Stored for ${HOST}: ••••7f3a` && fieldAfter === '' && /anyone who uses this browser profile/.test(where ?? '') && (storage.keys ?? '').includes(KEY) && !(storage.settings ?? '').includes(KEY) && !domHasKey,
      { problem0, ready, keyState0, keyState, fieldAfter, where, keyInOwnEntry: (storage.keys ?? '').includes(KEY), keyInSettings: (storage.settings ?? '').includes(KEY), domHasKey },
    );
    const colours = await chromatic(page, '.sw [data-block="api"]');
    check('a_achromatic', colours.length === 0, { found: colours.slice(0, 6) });
    await shootApiBlock(page, join(SHOTS, 'settings-ai-api.png'));
    // A preset: its summary and the note that it was never tried against the live service.
    await page.locator('.sw [data-row="ai.apiProvider"] select').selectOption('STABILITY_SD3');
    await page.waitForSelector('.sw [data-api-summary]');
    const summary = (await page.locator('.sw [data-api-summary]').textContent())?.trim();
    const untested = (await page.locator('.sw [data-api-untested]').textContent())?.trim();
    await shootApiBlock(page, join(SHOTS, 'settings-ai-api-preset.png'));
    check('a_preset', /^POST https:\/\/api\.stability\.ai\/v2beta\/stable-image\/generate\/sd3 · Multipart form · image$/.test(summary ?? '') && /not tried against the live service/.test(untested ?? ''), { summary, untested });
    await page.locator('.sw [data-row="ai.apiProvider"] select').selectOption('GENERIC');
    await page.waitForSelector('.sw [data-api-ready]');
    check('a_no_request_yet', seen.length === 0, { requests: seen.length });
    await page.keyboard.press('Escape');
    await page.waitForSelector('.sw', { state: 'detached' });
  }

  // ---------------------------------------------------------------- (b) the render window asks first
  {
    await openRenderAi(page);
    const sw = page.locator('.rw [data-ai-switch]');
    const line = (await page.locator(`${section} .rw-ai-line`).textContent())?.trim();
    await sw.click();
    await page.waitForSelector(`${section} [data-ai-consent] .confirm`, { timeout: 5000 });
    const question = (await page.locator(`${section} [data-ai-consent] .confirm-msg`).textContent())?.trim();
    const modal = await page.locator('[aria-modal="true"]').count();
    await page.waitForTimeout(1500);
    const before = seen.length;
    await shootSection(page, join(SHOTS, 'ai-api-consent.png'));
    await page.locator(`${section} [data-ai-consent] button`, { hasText: 'Not now' }).click();
    await page.waitForTimeout(1500);
    const offAfterNo = (await sw.getAttribute('aria-checked')) === 'false';
    const afterNo = seen.length;
    check(
      'b_consent_asked_in_place',
      line === `Through an API · Generic HTTP image-to-image · ${HOST}` && new RegExp(`^Send renders to ${HOST.replace(/\./g, '\\.')}\\? While the AI is on`).test(question ?? '') && modal === 0 && before === 0 && offAfterNo && afterNo === 0,
      { line, question, modal, before, offAfterNo, afterNo },
    );
    await sw.click();
    await page.waitForSelector(`${section} [data-ai-consent] .confirm`);
    await page.locator(`${section} [data-ai-consent] button`, { hasText: 'Allow and send' }).click();
    await page.waitForFunction(() => /\d+ × \d+ px/.test(document.querySelector('.rw-ai-state')?.textContent ?? ''), null, { timeout: 180000 });
    await page.waitForTimeout(500);
    const on = (await sw.getAttribute('aria-checked')) === 'true';
    const report = (await page.locator(`${section} .rw-ai-report`).textContent())?.trim();
    const auths = [...new Set(seen.map((s) => s.auth))];
    const keyInBodies = seen.some((s) => s.body.includes(KEY));
    check('b_allowed_sends_through_the_guard', on && seen.length > 0 && auths.length === 1 && auths[0] === `Bearer ${KEY}` && !keyInBodies && /^Checked: geometry ✓/.test(report ?? ''), { on, requests: seen.length, auths, keyInBodies, report });
    const colours = await chromatic(page, section);
    check('b_achromatic', colours.length === 0, { found: colours.slice(0, 6) });
    await shootSection(page, join(SHOTS, 'ai-api-section.png'));
  }

  // ---------------------------------------------------------------- (c) revoked: asked again, nothing sent
  {
    await page.goto(`${BASE_URL}/?${STUDIO}&lang=en&theme=dark&settings=ai.apiConsent`);
    await page.waitForSelector('#app[data-ready="1"]', { timeout: 90000 });
    await page.waitForSelector(`.sw [data-row="ai.apiConsent"] [data-host="${HOST}"]`, { timeout: 20000 });
    const listed = await page.locator(`.sw [data-row="ai.apiConsent"] [data-host="${HOST}"]`).count();
    await page.locator(`.sw [data-revoke="${HOST}"]`).click();
    await page.waitForTimeout(200);
    const gone = await page.locator(`.sw [data-host="${HOST}"]`).count();
    await page.keyboard.press('Escape');
    await page.waitForSelector('.sw', { state: 'detached' });
    const n = seen.length;
    await openRenderAi(page);
    // A new page: the job's switch is off; turning it on asks again, as before the first time.
    await page.locator('.rw [data-ai-switch]').click();
    await page.waitForSelector(`${section} [data-ai-consent] .confirm`, { timeout: 10000 });
    await page.waitForTimeout(2000);
    check('c_revoke', listed === 1 && gone === 0 && seen.length === n, { listed, gone, sentAfterRevoke: seen.length - n });
  }
  check('no_errors', errors.length === 0, { errors });
  await context.close();

  // ---------------------------------------------------------------- (d) Spanish
  {
    const { page, context, errors } = await open(browser, `${STUDIO}&lang=es&theme=light&settings=ai.source`);
    await page.waitForSelector('.sw [data-row="ai.source"]', { timeout: 20000 });
    // textContent: the block's title is drawn in capitals, the words are the same.
    const text = (await page.locator('.sw [data-block="api"]').textContent()).replace(/\s+/g, ' ');
    const words = ['Modelo por API', 'Ejecutar el modelo', 'En este equipo', 'Por API', 'Clave de API', 'Servidores permitidos', 'Intentos por llamada'];
    const missing = words.filter((w) => !text.includes(w));
    const english = ['Model by API', 'Run the model', 'API key', 'Allowed hosts'].filter((w) => text.includes(w));
    check('d_spanish', missing.length === 0 && english.length === 0, { missing, english });
    check('d_no_errors', errors.length === 0, { errors });
    await context.close();
  }

  writeFileSync(join(OUT, 'ai-api-check.json'), JSON.stringify(results, null, 2));
  const bad = Object.entries(results).filter(([, v]) => !v.ok);
  if (bad.length > 0) fail(`failed: ${bad.map(([k]) => k).join(', ')}`);
  console.log(`all ${Object.keys(results).length} checks passed`);
} catch (err) {
  console.error(err);
  writeFileSync(join(OUT, 'ai-api-check.json'), JSON.stringify(results, null, 2));
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => undefined);
  fakeServer?.close();
  if (server) stopServer();
}
