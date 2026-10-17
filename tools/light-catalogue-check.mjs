#!/usr/bin/env node
// Browser check and captures of phase L7 (the light catalogue in Sets and Lights) in the built app, with the local
// Chromium and swiftshader, in Fast mode, reduced motion and deviceScaleFactor 1 (tools/screenshot.mjs).
//
//   npm run build && node tools/light-catalogue-check.mjs [--url http://localhost:4292] [--shots docs/ui]
//
// Without --url it serves dist/ with `vite preview` on port 4292 and stops it at the end.
//
//   sets       the Light section opens on Sets: its product type and subject filters, a product type chosen;
//   lights     Lights: the style filter, a style chosen; every thumbnail of both groups one size;
//   question   a setup over the lights there are asks Replace, Hide or Add, with Remember my choice; Hide is one
//              undo step named after it and leaves the lights there were switched off in the Lights list;
//   sizes      the size button of the section's header goes small, large and medium.
//
// Captures (docs/ui, only with --shots): light-sets.png, light-lights.png, light-question.png (Spanish),
// light-thumb-sizes.png (small and large side by side). Results: out/light-catalogue-check.json.

import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4292;
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const SHOTS = args.includes('--shots') ? resolve(ROOT, opt('shots', 'docs/ui')) : null;
const OUT = join(ROOT, 'out');
mkdirSync(OUT, { recursive: true });
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

function findChromium() {
  if (process.env.REPACKSHOT_CHROMIUM) return process.env.REPACKSHOT_CHROMIUM;
  for (const base of [process.env.PLAYWRIGHT_BROWSERS_PATH, '/opt/pw-browsers'].filter(Boolean)) {
    if (existsSync(join(base, 'chromium', 'chrome-linux', 'chrome'))) return join(base, 'chromium', 'chrome-linux', 'chrome');
    try {
      const dirs = execFileSync('ls', [base]).toString().split('\n').filter((d) => /^chromium-\d+$/.test(d)).sort().reverse();
      for (const d of dirs) if (existsSync(join(base, d, 'chrome-linux', 'chrome'))) return join(base, d, 'chrome-linux', 'chrome');
    } catch {
      // next
    }
  }
  throw new Error('no Chromium found (set REPACKSHOT_CHROMIUM)');
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
  throw new Error(`${url} did not answer`);
}

const settle = (page, ms = 150) => page.evaluate((wait) => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, wait)))), ms);
const ok = (cond, text, failures) => {
  if (!cond) failures.push(text);
  return cond;
};

/** What the Light section shows. */
const light = (page) =>
  page.evaluate(() => {
    const sec = document.querySelector('[data-section="light"]');
    const pics = [...sec.querySelectorAll('.thumbs .thumb img')].map((i) => `${Math.round(i.getBoundingClientRect().width)}x${Math.round(i.getBoundingClientRect().height)}`);
    return {
      group: sec.querySelector('.seg button[aria-pressed="true"]')?.textContent ?? '',
      filters: [...sec.querySelectorAll('[data-light-filters] [data-filter]')].map((r) => r.getAttribute('data-filter')),
      count: sec.querySelector('[data-light-count]')?.textContent ?? '',
      thumbs: pics.length,
      sizes: [...new Set(pics)],
      size: sec.querySelector('[data-action="light.thumbSize"]')?.getAttribute('data-size') ?? '',
      question: [...sec.querySelectorAll('[data-light-question] .confirm-actions .btn')].map((b) => b.textContent),
      undo: document.querySelector('.hdr button[aria-label="Undo"], .hdr button[aria-label="Deshacer"]')?.getAttribute('data-tip') ?? null,
    };
  });

/** The inspector column from the Light section's header down, as a capture. */
async function shotOfLight(page, file, height = 760) {
  if (!SHOTS) return;
  const sec = page.locator('[data-section="light"]');
  await sec.evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await page.mouse.move(5, 5);
  await settle(page, 250);
  const box = await sec.boundingBox();
  const col = await page.locator('aside').last().boundingBox();
  await page.screenshot({ path: join(SHOTS, file), clip: { x: col.x, y: Math.max(0, box.y - 4), width: col.width, height: Math.min(height, 1000 - Math.max(0, box.y - 4)) } });
}

let BASE_URL = opt('url', null);
let server = null;
const f = [];
const log = {};
try {
  if (!BASE_URL) {
    server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: 'ignore' });
    BASE_URL = `http://localhost:${PORT}`;
    await waitFor(BASE_URL);
  }
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch({ executablePath: findChromium(), args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  try {
    for (const lang of ['en', 'es']) {
      const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(`${BASE_URL}/?example=1&theme=light&mode=fast&tour=0&lang=${lang}`);
      await page.waitForSelector('#app[data-ready="1"]', { timeout: 60000 });
      await page.waitForSelector('[data-section="light"] .thumbs .thumb img', { timeout: 60000 });
      await settle(page, 600);
      const sec = page.locator('[data-section="light"]');
      const L = log[lang] = {};

      // Sets with a product type chosen.
      let s = await light(page);
      ok(s.group === 'Sets' && JSON.stringify(s.filters) === '["type","hero"]', `${lang}: opens on Sets with product type and subject: ${s.group} ${s.filters}`, f);
      ok(s.thumbs === 17 && s.sizes.length === 1, `${lang}: 17 sets of one size: ${s.thumbs} ${s.sizes}`, f);
      const medium = s.sizes[0];
      await sec.locator('[data-filter="hero"] .chip[data-value="BOTTLE"]').click();
      await settle(page);
      L.bottles = s = await light(page);
      ok(s.thumbs === 8, `${lang}: Bottle leaves the seven bottle sets and the type's own rig, kept: ${s.thumbs}`, f);
      if (lang === 'en') await shotOfLight(page, 'light-sets.png', 820);
      await sec.locator('[data-filter="hero"] .chip[data-value=""]').click();

      // Lights with a style chosen.
      await sec.locator('.seg button').nth(1).click();
      await sec.locator('[data-filter="style"] .chip[data-value="CINEMATIC"]').click();
      await settle(page, 300);
      L.cinematic = s = await light(page);
      ok(s.filters.join() === 'style' && s.thumbs === 11 && s.sizes.length === 1 && s.sizes[0] === medium, `${lang}: Cinematic, 11 of the size of the sets: ${s.thumbs} ${s.sizes} vs ${medium}`, f);
      if (lang === 'en') await shotOfLight(page, 'light-lights.png', 700);

      // The question, then Hide.
      await sec.locator('.thumbs .thumb').nth(3).click();
      await settle(page, 300);
      L.question = s = await light(page);
      ok(s.question.length === 4, `${lang}: Replace, Hide, Add and Cancel: ${s.question.join(', ')}`, f);
      if (lang === 'es') await shotOfLight(page, 'light-question.png', 640);
      await sec.locator('[data-light-question] .btn').nth(1).click();
      await settle(page, 300);
      s = await light(page);
      ok(/hide the lights there were|ocultar los focos que había/.test(s.undo ?? ''), `${lang}: Hide is one undo step named after it: ${s.undo}`, f);

      // The sizes: small, large, medium again (each one size for every thumbnail).
      const sizes = {};
      for (const want of ['L', 'S', 'M']) {
        await sec.locator('[data-action="light.thumbSize"]').click();
        await settle(page, 200);
        s = await light(page);
        sizes[want] = s.sizes;
        ok(s.size === want && s.sizes.length === 1, `${lang}: size ${want}: ${s.size} ${s.sizes}`, f);
        if (lang === 'en' && SHOTS && want !== 'M') await shotOfLight(page, `light-thumb-${want}.tmp.png`, 560);
      }
      L.sizes = sizes;
      ok(errors.length === 0, `${lang}: page errors: ${errors.join(' | ')}`, f);
      await context.close();
    }
    // The two sizes side by side, as one capture.
    if (SHOTS) {
      const page = await browser.newPage({ viewport: { width: 700, height: 600 }, deviceScaleFactor: 1 });
      const url = (n) => `data:image/png;base64,${readFileSync(join(SHOTS, `light-thumb-${n}.tmp.png`)).toString('base64')}`;
      await page.setContent(`<body style="margin:0;background:#fff;display:flex;gap:8px"><img src="${url('S')}"><img src="${url('L')}"></body>`);
      await page.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth > 0));
      const w = await page.evaluate(() => [...document.images].reduce((a, i) => a + i.naturalWidth, 0) + 8);
      const h = await page.evaluate(() => Math.max(...[...document.images].map((i) => i.naturalHeight)));
      await page.screenshot({ path: join(SHOTS, 'light-thumb-sizes.png'), clip: { x: 0, y: 0, width: w, height: h } });
      await page.close();
      for (const n of ['S', 'L']) rmSync(join(SHOTS, `light-thumb-${n}.tmp.png`), { force: true });
    }
  } finally {
    await browser.close();
  }
} finally {
  server?.kill('SIGTERM');
}
writeFileSync(join(OUT, 'light-catalogue-check.json'), JSON.stringify({ failures: f, log }, null, 2));
if (f.length) {
  console.error(f.join('\n'));
  process.exit(1);
}
console.log('light-catalogue-check: all good');
