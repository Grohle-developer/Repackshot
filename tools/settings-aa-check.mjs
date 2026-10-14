#!/usr/bin/env node
// Browser checks of phase E11 (Settings ▸ Render engine ▸ Edge smoothing) in the built app, with the local Chromium
// and swiftshader: the pool of Web Workers with the real rt.wasm, and the three.js preview.
//
//   npm run engine:build && npm run build && node tools/settings-aa-check.mjs [--url http://localhost:4199]
//        [--shots docs/ui]
//
// Without --url it serves dist/ with `vite preview` on port 4199 and stops it at the end.
//
//   (lists)  the block has the two lists in their order, cheapest first: Fast mode None · MSAA 2× · MSAA 4× · MSAA 8×
//            (4× pressed) and Full mode and render None, Standard, Soft, Fine (checked: the factory value), Fine + edges ×2, ×4, each
//            with its line of help and no cost in numbers; Fast mode's line says what the device draws (its maximum,
//            what is drawn now);
//   (fast)   MSAA 8× draws what the device can (at most its maximum, said in the line and by the meter), None draws
//            without multisampling and the preview's edges change; back to 4×;
//   (full)   Full mode with the factory value (Fine) says no filter; Standard says "Filter · Standard"; Fine + edges ×2
//            starts the view over and the meter says "Filter · Fine + edges ×2"; the
//            choice is kept after a reload (a setting of the application, not of the project) and reads in Spanish;
//   (shot)   docs/ui/settings-aa.png: the window at Edge smoothing, Fine + edges ×2 chosen; docs/ui/meter-filter.png: the
//            meter in Full mode saying "Filter · Standard".
//
// Results: out/settings-aa-check.json.

import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4199;
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const SHOTS = resolve(ROOT, opt('shots', 'docs/ui'));
const OUT = join(ROOT, 'out');
mkdirSync(OUT, { recursive: true });
mkdirSync(SHOTS, { recursive: true });
let BASE_URL = opt('url', null);

const results = {};
const fail = (msg) => {
  throw new Error(msg);
};
const check = (key, ok, detail) => {
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

const rowSel = (id) => `.sw [data-row="${id}"]`;

async function openSettings(page) {
  await page.locator('canvas[aria-label="viewport"]').focus();
  await page.keyboard.press('Control+Comma');
  await page.waitForSelector('.sw[role="dialog"]');
  await page.locator('.sw .sw-option[data-section="engine"]').click();
  await page.locator(rowSel('engine.fastAa')).scrollIntoViewIfNeeded();
}

async function closeSettings(page) {
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('.sw'));
}

/** What the block shows. */
const block = (page) =>
  page.evaluate(() => {
    const fast = document.querySelector('.sw [data-row="engine.fastAa"]');
    const filter = document.querySelector('.sw [data-row="engine.pixelFilter"]');
    return {
      title: fast?.closest('[data-block]')?.querySelector('.sw-block-title')?.textContent ?? fast?.closest('.sw-block')?.querySelector('h4, .sw-block-title')?.textContent ?? null,
      fast: [...(fast?.querySelectorAll('.seg button') ?? [])].map((b) => ({ text: b.textContent, pressed: b.getAttribute('aria-pressed') })),
      fastAux: fast?.querySelector('.sw-aux')?.textContent ?? '',
      filters: [...(filter?.querySelectorAll('.sw-aa-option') ?? [])].map((b) => ({ value: b.dataset.value, name: b.querySelector('.sw-aa-name')?.textContent, help: b.querySelector('.note')?.textContent, checked: b.getAttribute('aria-checked') })),
      filterAux: filter?.querySelector('.sw-aux')?.textContent ?? '',
    };
  });

const meter = (page) =>
  page.evaluate(() => {
    const m = document.querySelector('.ov-bl');
    return { mode: m?.dataset.mode, msaa: m?.dataset.msaa, filter: m?.dataset.pixelFilter, edges: m?.dataset.edgeSamples, samples: Number(m?.dataset.samples ?? 0), extras: m?.querySelector('[data-meter-extras]')?.textContent ?? '' };
  });

/** The viewport as PNG bytes. */
const viewportShot = async (page) => {
  await page.mouse.move(2, 2);
  await page.waitForTimeout(600);
  return page.locator('canvas[aria-label="viewport"]').screenshot();
};

/** How two screenshots of the viewport differ: the mean absolute difference (0–255), the share of equal pixels. */
const compare = (page, a, b) =>
  page.evaluate(
    async ([x, y]) => {
      const load = async (b64) => {
        const img = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
        const c = new OffscreenCanvas(img.width, img.height);
        const g = c.getContext('2d');
        g.drawImage(img, 0, 0);
        return g.getImageData(0, 0, img.width, img.height).data;
      };
      const [p, q] = await Promise.all([load(x), load(y)]);
      let sum = 0;
      let equal = 0;
      let changed = 0;
      for (let i = 0; i < p.length; i += 4) {
        const d = Math.abs(p[i] - q[i]) + Math.abs(p[i + 1] - q[i + 1]) + Math.abs(p[i + 2] - q[i + 2]);
        sum += d / 3;
        if (d === 0) equal++;
        else changed++;
      }
      const n = p.length / 4;
      return { mean: +(sum / n).toFixed(3), equal: +(equal / n).toFixed(4), changed };
    },
    [Buffer.from(a).toString('base64'), Buffer.from(b).toString('base64')],
  );

async function checks(browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !m.text().startsWith('Failed to load resource') && !m.location().url.startsWith('https://api.github.com/') && errors.push(m.text()));
  await page.goto(`${BASE_URL}/?example=1&lang=en&mode=fast&theme=dark`);
  await page.waitForSelector('#app[data-ready="1"]', { timeout: 90000 });

  // (lists)
  await openSettings(page);
  const b = await block(page);
  const fastOrder = b.fast.map((x) => x.text);
  const filterOrder = b.filters.map((x) => x.value);
  const max = Number(/up to (\d+)×/.exec(b.fastAux)?.[1] ?? NaN);
  check(
    'lists_in_order',
    JSON.stringify(fastOrder) === JSON.stringify(['None', 'MSAA 2×', 'MSAA 4×', 'MSAA 8×']) &&
      b.fast.find((x) => x.text === 'MSAA 4×')?.pressed === 'true' &&
      JSON.stringify(filterOrder) === JSON.stringify(['NONE', 'STANDARD', 'SOFT', 'FINE', 'FINE_EDGES2', 'FINE_EDGES4']) &&
      b.filters.find((x) => x.value === 'FINE')?.checked === 'true' &&
      b.filters.every((x) => x.help && !/%|\d+\s?ms/.test(x.help)) &&
      Number.isFinite(max) &&
      /drawing now: \d+×/.test(b.fastAux),
    { fastOrder, filterOrder, names: b.filters.map((x) => x.name), fastAux: b.fastAux, filterAux: b.filterAux, max },
  );

  // (fast) MSAA 8×: what the device can.
  await page.locator(`${rowSel('engine.fastAa')} .seg button`, { hasText: 'MSAA 8×' }).click();
  await page.waitForTimeout(300);
  const at8 = (await block(page)).fastAux;
  await closeSettings(page);
  const m8 = await meter(page);
  const want8 = Math.min(8, max);
  await openSettings(page);
  await page.locator(`${rowSel('engine.fastAa')} .seg button`, { hasText: 'None' }).click();
  await closeSettings(page);
  const none = await viewportShot(page);
  const m0 = await meter(page);
  await openSettings(page);
  await page.locator(`${rowSel('engine.fastAa')} .seg button`, { hasText: 'MSAA 2×' }).click();
  await closeSettings(page);
  const two = await viewportShot(page);
  const m2 = await meter(page);
  await openSettings(page);
  await page.locator(`${rowSel('engine.fastAa')} .seg button`, { hasText: 'MSAA 4×' }).click();
  await closeSettings(page);
  const four = await viewportShot(page);
  const m4 = await meter(page);
  // Only the edges change: the colours, the tone curve and the background are those of the canvas (a target drawn
  // as the screen is), so the mean difference is small and most pixels are equal.
  const none4 = await compare(page, none, four);
  const two4 = await compare(page, two, four);
  check(
    'fast_msaa',
    m8.msaa === String(want8) &&
      at8.includes(`drawing now: ${want8}×`) &&
      m0.msaa === '0' &&
      /No multisampling/.test(m0.extras) &&
      m2.msaa === String(Math.min(2, max)) &&
      m4.msaa === '4' &&
      none4.changed > 0 &&
      none4.mean < 1.5 &&
      none4.equal > 0.9 &&
      two4.mean < 1.5 &&
      two4.equal > 0.9,
    { at8, m8, m0, m2, m4, none4, two4 },
  );

  // (full) Fine + edges ×2 in Full mode.
  await page.waitForFunction(() => !document.querySelectorAll('[data-guide="viewport-mode"] .seg:not(.hdr-denoise) button')[1]?.disabled, null, { timeout: 90000 });
  await page.locator('[data-guide="viewport-mode"] .seg:not(.hdr-denoise) button').nth(1).click();
  await page.waitForFunction(() => document.querySelector('.ov-bl')?.dataset.mode === 'full' && Number(document.querySelector('.ov-bl')?.dataset.samples ?? 0) >= 1, null, { timeout: 90000 });
  const factory = await meter(page);
  await openSettings(page);
  await page.locator(`${rowSel('engine.pixelFilter')} .sw-aa-option[data-value="STANDARD"]`).click();
  await closeSettings(page);
  await page.waitForFunction(() => document.querySelector('.ov-bl')?.dataset.pixelFilter === '0' && Number(document.querySelector('.ov-bl')?.dataset.samples ?? 0) >= 1, null, { timeout: 90000 });
  const standard = await meter(page);
  // The meter saying it (a crop of the viewport's corner).
  const box = await page.locator('.ov-bl').boundingBox();
  if (box) await page.screenshot({ path: join(SHOTS, 'meter-filter.png'), clip: { x: Math.max(0, box.x - 8), y: Math.max(0, box.y - 8), width: Math.min(560, box.width + 16), height: box.height + 16 } });
  await openSettings(page);
  await page.locator(`${rowSel('engine.pixelFilter')} .sw-aa-option[data-value="FINE_EDGES2"]`).click();
  await page.waitForTimeout(300);
  const chosen = await block(page);
  await page.evaluate(() => document.querySelector('.sw [data-block="antialias"]')?.scrollIntoView({ block: 'start' }));
  await page.mouse.move(5, 895);
  await page.waitForTimeout(200);
  await page.screenshot({ path: join(SHOTS, 'settings-aa.png') });
  await closeSettings(page);
  await page.waitForFunction(() => document.querySelector('.ov-bl')?.dataset.edgeSamples === '2' && Number(document.querySelector('.ov-bl')?.dataset.samples ?? 0) >= 1, null, { timeout: 90000 });
  const fine = await meter(page);
  check(
    'full_filter',
    factory.filter === '3' && factory.edges === '1' && !/Filter/.test(factory.extras) && standard.filter === '0' && /Filter · Standard/.test(standard.extras) && chosen.filters.find((x) => x.value === 'FINE_EDGES2')?.checked === 'true' && fine.filter === '3' && fine.edges === '2' && /Filter · Fine \+ edges ×2/.test(fine.extras),
    { factory, standard, fine, filterAux: chosen.filterAux },
  );

  // Kept after a reload, and in Spanish.
  await page.goto(`${BASE_URL}/?example=1&lang=es&mode=fast&theme=dark`);
  await page.waitForSelector('#app[data-ready="1"]', { timeout: 90000 });
  await openSettings(page);
  const es = await block(page);
  check(
    'kept_and_spanish',
    es.filters.find((x) => x.value === 'FINE_EDGES2')?.checked === 'true' && es.filters.map((x) => x.name).join('|') === 'Ninguno|Estándar|Suave|Fino|Fino + bordes ×2|Fino + bordes ×4' && es.fast[0]?.text === 'Ninguno' && /Este dispositivo llega a/.test(es.fastAux),
    { names: es.filters.map((x) => x.name), fast: es.fast.map((x) => x.text), fastAux: es.fastAux, title: es.title },
  );
  // Back to the factory values for the next run.
  await page.locator(`${rowSel('engine.pixelFilter')} .sw-aa-option[data-value="FINE"]`).click();
  await closeSettings(page);
  check('no_page_errors', errors.length === 0, { errors: errors.slice(0, 5) });
  await context.close();
}

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
  await checks(browser);
  writeFileSync(join(OUT, 'settings-aa-check.json'), JSON.stringify(results, null, 2));
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
