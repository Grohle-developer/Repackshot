#!/usr/bin/env node
// Browser check of phase L6 in the built app (the sets of the light catalogue), with the local Chromium and
// swiftshader, in Fast mode.
//
//   npm run build && node tools/sets-check.mjs [--url http://localhost:4291] [--shots docs/ui]
//
// Without --url it serves dist/ with `vite preview` on port 4291 and stops it at the end.
//
//   catalogue  the Light section's style chips start with All and Sets; Sets shows the 16 sets in two columns, square
//              and twice as tall as a setup's thumbnail of another style (three columns, 4:3); the tooltip of a set
//              says its reason;
//   apply      the example comes in dressed by the product type's set (In the set lists its pieces); choosing Long
//              strip and black edge is one undo step and lists its backdrop, floor and two cards; switching a card
//              off hides it (one undo step, "Hide Black card 1"); Use the set's camera is one undo step;
//   reset      Reset setup takes the pieces away (In the set is gone) and choosing the set again brings them back.
//
// Screenshot (docs/ui): sets-catalogue.png. Results: out/sets-check.json.

import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4291;
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const SHOTS = resolve(ROOT, opt('shots', 'docs/ui'));
const OUT = join(ROOT, 'out');
mkdirSync(OUT, { recursive: true });
mkdirSync(SHOTS, { recursive: true });

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

const settle = (page, ms = 120) => page.evaluate((wait) => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, wait)))), ms);
const ok = (cond, text, failures) => {
  if (!cond) failures.push(text);
  return cond;
};

/** What the Light section shows. */
const light = (page) =>
  page.evaluate(() => {
    const sec = document.querySelector('[data-section="light"]');
    const chips = [...(sec?.querySelectorAll('[role="tablist"] .chip') ?? [])].map((c) => c.textContent);
    const box = (el) => {
      const r = el?.getBoundingClientRect();
      return r ? { w: r.width, h: r.height } : null;
    };
    const sets = sec?.querySelector('.thumbs[data-sets]');
    const others = sec?.querySelector('.thumbs.cols-3');
    const setRows = [...(sec?.querySelectorAll('[data-set] .row .field-label') ?? [])].map((n) => n.textContent);
    return {
      chips,
      sets: sets ? sets.querySelectorAll('.thumb.large').length : 0,
      setColumns: sets ? getComputedStyle(sets).gridTemplateColumns.split(' ').length : 0,
      setImage: box(sets?.querySelector('.thumb img')),
      otherImage: box(others?.querySelector('.thumb img')),
      tips: [...(sets?.querySelectorAll('.thumb') ?? [])].map((t) => t.getAttribute('data-tip') ?? ''),
      inSet: sec?.querySelector('[data-set]')?.getAttribute('data-set') ?? '',
      setRows,
      camera: !!sec?.querySelector('[data-set] .btn'),
      undo: document.querySelector('.hdr button[aria-label="Undo"]')?.getAttribute('data-tip') ?? null,
    };
  });

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
  const browser = await chromium.launch({ executablePath: findChromium(), args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  try {
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && !m.text().startsWith('Failed to load resource') && errors.push(m.text()));
    await page.goto(`${BASE_URL}/?example=1&theme=dark&mode=fast`);
    await page.waitForSelector('#app[data-ready="1"]', { timeout: 60000 });
    await settle(page, 400);

    let s = await light(page);
    log.start = s;
    ok(s.chips[0] === 'All' && s.chips[1] === 'Sets', `the style chips start with All and Sets: ${s.chips.join(', ')}`, f);
    ok(s.inSet === 'GRADIENT_POOL' && s.setRows.length > 0, `the example comes in dressed by the Standard type's set: ${s.inSet} ${s.setRows.join(', ')}`, f);

    // Sets: 16, two columns, square, twice as tall as a thumbnail of another style.
    await page.locator('[data-section="light"] .chip', { hasText: /^Product$/ }).click();
    await settle(page, 200);
    const other = (await light(page)).otherImage;
    await page.locator('[data-section="light"] .chip', { hasText: /^Sets$/ }).click();
    await settle(page, 300);
    s = await light(page);
    log.sets = { count: s.sets, columns: s.setColumns, image: s.setImage, other };
    ok(s.sets === 16 && s.setColumns === 2, `Sets shows 16 large thumbnails in two columns: ${s.sets}, ${s.setColumns}`, f);
    ok(s.setImage && Math.abs(s.setImage.w - s.setImage.h) < 1.5, `a set's thumbnail is square: ${JSON.stringify(s.setImage)}`, f);
    ok(s.setImage && other && s.setImage.h >= 1.9 * other.h, `a set's thumbnail is twice as tall as another style's: ${JSON.stringify(s.setImage)} vs ${JSON.stringify(other)}`, f);
    ok(/black edge sets it apart from the background/.test(s.tips[0] ?? ''), `the tooltip says the set's reason: ${s.tips[0]}`, f);

    // Choose Long strip and black edge.
    await page.locator('[data-section="light"] .thumb.large', { hasText: 'Long strip and black edge' }).click();
    await settle(page, 400);
    s = await light(page);
    log.applied = s;
    ok(s.inSet === 'STRIP_EDGE', `the set is in force: ${s.inSet}`, f);
    ok(['Backdrop', 'Set floor', 'Black card 1', 'White card 2'].every((n) => s.setRows.includes(n)), `In the set lists its pieces: ${s.setRows.join(', ')}`, f);
    ok(s.undo === 'Undo: Light setup: Long strip and black edge', `one undo step: ${s.undo}`, f);
    ok(s.camera, 'Use the set’s camera is there', f);
    await page.screenshot({ path: join(SHOTS, 'sets-catalogue.png') });

    // A card off.
    await page.locator('[data-section="light"] [data-set] .row', { hasText: 'Black card 1' }).locator('[role="switch"]').click();
    await settle(page, 200);
    s = await light(page);
    ok(s.undo === 'Undo: Hide Black card 1', `switching a card off is one undo step: ${s.undo}`, f);
    // The set's camera.
    await page.locator('[data-section="light"] [data-set] .btn', { hasText: 'Use the set’s camera' }).click();
    await settle(page, 300);
    s = await light(page);
    ok(s.undo === 'Undo: Use the set’s camera', `Use the set’s camera is one undo step: ${s.undo}`, f);

    // Reset setup (Tune lights is where it lives) after an edit of a light, then the set again.
    await page.evaluate(() => document.querySelector('[data-section="light"] .section-head[aria-expanded="false"]')?.click());
    await settle(page, 200);
    const tune = page.locator('[data-section="light"] .section-head', { hasText: 'Tune lights' });
    if ((await tune.getAttribute('aria-expanded')) !== 'true') await tune.click();
    await settle(page, 200);
    const az = page.locator('[data-section="light"] .tune-light [role="spinbutton"]').nth(2);
    await az.focus();
    await page.keyboard.press('ArrowUp');
    await settle(page, 200);
    await page.locator('[data-section="light"] .btn', { hasText: /^Reset setup$/ }).click();
    await settle(page, 300);
    s = await light(page);
    ok(s.setRows.length === 0, `Reset setup takes the pieces away: ${s.setRows.join(', ')}`, f);
    await page.locator('[data-section="light"] .thumb.large', { hasText: 'Long strip and black edge' }).click();
    await settle(page, 300);
    s = await light(page);
    ok(s.setRows.length === 4, `choosing the set again brings them back: ${s.setRows.join(', ')}`, f);
    ok(errors.length === 0, `page errors: ${errors.join(' | ')}`, f);
    await context.close();
  } finally {
    await browser.close();
  }
} finally {
  server?.kill('SIGTERM');
  spawnSync('true');
}
writeFileSync(join(OUT, 'sets-check.json'), JSON.stringify({ failures: f, log }, null, 2));
if (f.length) {
  console.error(f.join('\n'));
  process.exit(1);
}
console.log('sets-check: all good');
