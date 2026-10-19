#!/usr/bin/env node
// Browser check of phase U16 in the built app (the physics of each part in one place), with the local Chromium and
// swiftshader, in Fast mode, on the example bottle.
//
//   npm run build && node tools/u16-check.mjs [--url http://localhost:4196] [--shots docs/ui]
//
// Without --url it serves dist/ with `vite preview` on port 4196 and stops it at the end. It needs no rt.wasm (the
// inspector and the drawer's line do not run the simulator).
//
//   inspector  the Body selected: under the material's name the pointer *Physics: Static · gets wet as …*; the Physics
//              section in two groups, Motion (the role, its line, friction and bounciness for a static part; density,
//              the mass and Drop once Dynamic) and Weather (Gets wet, Gets dust and snow, Surface with its family named,
//              the size its drops run at); with a Rain whose On the parts is off, the note and its button *Edit Rain*;
//              the pointer opens a folded Physics section;
//   effect     the note's button: the scene's inspector on the rain, its On the parts right after its Shape, focused,
//              its help naming Physics ▸ Weather;
//   drawer     On the parts on, the Body Dynamic and the Cap kept dry: the drawer's line *Start simulates: 1 dynamic part
//              · rain on N parts (1 stays dry)*.
//
// Screenshots (docs/ui): physics-inspector.png (the inspector from the Material card to the Physics section with both
// groups, on the Body), physics-drawer-summary.png (the physics drawer with its line). Results: out/u16-check.json.

import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4196;

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

const fail = (msg) => {
  throw new Error(msg);
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
  for (const pid of (run.stdout ?? '').toString().split(/\s+/).filter(Boolean)) {
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

const settle = (page, ms = 80) => page.evaluate((wait) => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, wait)))), ms);
const ok = (cond, text, failures) => {
  if (!cond) failures.push(text);
  return cond;
};

async function pickRow(page, name) {
  await page.locator('.tree-row', { has: page.locator('.tree-name', { hasText: new RegExp(`^${name}$`) }) }).first().click();
  await settle(page);
}

/** What the Physics section shows. */
const physicsView = (page) =>
  page.evaluate(() => {
    const sec = document.querySelector('.side-right [data-section="physics"]');
    const shown = (el) => !!el && el.offsetParent !== null;
    const q = (sel) => sec?.querySelector(sel) ?? null;
    const surface = q('[data-field="phys.surface"]');
    const note = q('[data-field="phys.noWeather"]');
    return {
      collapsed: sec?.hasAttribute('data-collapsed') ?? null,
      groups: [...(sec?.querySelectorAll('[data-phys-group]') ?? [])].map((g) => g.getAttribute('data-phys-group')),
      roleLine: q('[data-field="phys.roleLine"]')?.textContent ?? null,
      density: shown(q('[data-field="phys.density"]')),
      friction: shown(q('[data-field="phys.friction"]')),
      bounciness: shown(q('[data-field="phys.bounciness"]')),
      drop: shown(q('[data-action="phys.drop"]')),
      wet: q('[data-field="phys.getsWet"]')?.getAttribute('aria-checked') ?? null,
      dust: q('[data-field="phys.getsDust"]')?.getAttribute('aria-checked') ?? null,
      surface: surface?.value ?? null,
      autoText: surface?.querySelector('option[value="AUTO"]')?.textContent ?? null,
      runSize: q('[data-field="phys.runSize"]')?.textContent ?? null,
      note: shown(note) ? note.querySelector('p')?.textContent ?? null : null,
      noteButton: shown(note) ? note.querySelector('button')?.textContent ?? null : null,
      pointer: document.querySelector('.side-right [data-action="phys.pointer"]')?.textContent ?? null,
    };
  });

/** Folds or unfolds an inspector section. */
async function fold(page, id, collapsed) {
  const sec = page.locator(`.side-right [data-section="${id}"]`);
  if ((await sec.count()) === 0) return;
  const is = await sec.evaluate((el) => el.hasAttribute('data-collapsed'));
  if (is !== collapsed) {
    await sec.locator('.section-head').first().click();
    await settle(page);
  }
}

async function main() {
  const { chromium } = await import('playwright-core');
  let server = null;
  if (!BASE_URL) {
    if (!existsSync(join(ROOT, 'dist', 'index.html'))) fail('dist/ is missing: npm run build');
    stopServer();
    server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: 'ignore' });
    BASE_URL = `http://localhost:${PORT}`;
    await waitFor(BASE_URL);
  }
  const browser = await chromium.launch({ executablePath: findChromium(), args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const f = [];
  const log = {};
  try {
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && !m.text().startsWith('Failed to load resource') && errors.push(m.text()));
    await page.goto(`${BASE_URL}/?theme=dark&mode=fast&tour=0&lang=en&example=1`);
    await page.waitForSelector('#app[data-ready="1"]', { timeout: 90000 });
    await settle(page, 500);

    // A rain, with its On the parts off: the note of Weather names it.
    await page.click('[data-ambient="add"]');
    await settle(page);
    await page.click('[data-ambient="gallery"] [data-preset="RAIN"]');
    await settle(page, 300);

    // inspector: the Body.
    await pickRow(page, 'Body');
    let v = await physicsView(page);
    log.static = v;
    ok(JSON.stringify(v.groups) === '["motion","weather"]', `the groups: ${JSON.stringify(v.groups)}`, f);
    ok(v.roleLine === 'Stays where it is: things fall onto it and the weather settles on it', `the static line: ${v.roleLine}`, f);
    ok(!v.density && v.friction && v.bounciness && !v.drop, `the static fields: ${JSON.stringify(v)}`, f);
    ok(v.wet === 'true' && v.dust === 'true' && v.surface === 'AUTO' && /^From the material \(.+\)$/.test(v.autoText ?? ''), `the weather at its defaults: ${JSON.stringify(v)}`, f);
    ok(/^Drops start to run at about [\d.]+ mm across on a vertical face$/.test(v.runSize ?? ''), `the run size: ${v.runSize}`, f);
    ok(v.note === 'Nothing in the scene leaves rain, dust or snow on the parts: switch “On the parts” on in an effect' && v.noteButton === 'Edit Rain', `the note: ${v.note} · ${v.noteButton}`, f);
    ok(/^Physics: Static · gets wet as .+$/.test(v.pointer ?? ''), `the pointer: ${v.pointer}`, f);
    // The pointer opens a folded Physics section.
    await fold(page, 'physics', true);
    await page.click('.side-right [data-action="phys.pointer"]');
    await settle(page, 200);
    ok((await physicsView(page)).collapsed === false, 'the pointer did not open the Physics section', f);
    // Dynamic: density, the mass and Drop come in; back to Static.
    await page.locator('[data-field="phys.role"] button', { hasText: /^Dynamic$/ }).click();
    await settle(page);
    v = await physicsView(page);
    log.dynamic = v;
    ok(v.roleLine === 'Falls and collides with the rest' && v.density && v.friction && v.bounciness && v.drop, `the dynamic fields: ${JSON.stringify(v)}`, f);
    await page.keyboard.press('Control+z');
    await settle(page);

    // The capture: the Material card with its pointer, then Physics (Textures, Wear and Part folded), in a window tall
    // enough for both.
    await page.setViewportSize({ width: 1600, height: 1600 });
    await settle(page, 300);
    await fold(page, 'material', false);
    for (const id of ['textures', 'wear', 'part']) await fold(page, id, true);
    await fold(page, 'physics', false);
    await page.mouse.move(10, 500);
    await page.evaluate(() => document.querySelector('.side-right .side-scroll')?.scrollTo(0, 0));
    await settle(page, 300);
    const col = await page.locator('.side-right').boundingBox();
    const top = await page.locator('.side-right [data-section="material"]').boundingBox();
    const bottom = await page.locator('.side-right [data-section="physics"]').boundingBox();
    ok(!!col && !!top && !!bottom && bottom.y + bottom.height <= col.y + col.height + 1, 'the Physics section does not fit the column for the capture', f);
    if (col && top && bottom) {
      const y = Math.max(col.y, top.y - 4);
      await page.screenshot({ path: join(SHOTS, 'physics-inspector.png'), clip: { x: col.x, y, width: col.width, height: Math.min(col.y + col.height, bottom.y + bottom.height + 6) - y } });
    }

    await page.setViewportSize({ width: 1600, height: 1000 });
    await settle(page, 300);

    // effect: the note's button.
    await page.click('[data-action="phys.toEffect"]');
    await settle(page, 300);
    const fx = await page.evaluate(() => {
      const row = document.querySelector('[data-ambient="editor"] [data-knob="ambient.wetParts"]');
      const knobs = [...(document.querySelector('[data-ambient="knobs"]')?.children ?? [])].map((c) => c.getAttribute('data-knob') ?? c.getAttribute('data-ambient') ?? '');
      return { focused: !!row && row.contains(document.activeElement), tip: row?.getAttribute('data-tip') ?? '', knobs };
    });
    log.effect = fx;
    ok(fx.focused, 'the note’s button did not bring the rain’s On the parts into focus', f);
    ok(fx.knobs.indexOf('ambient.wetParts') === fx.knobs.indexOf('ambient.shape') + 1, `On the parts is not right after Shape: ${fx.knobs.join(', ')}`, f);
    ok(fx.tip.endsWith('Each part chooses in Physics ▸ Weather'), `its help: ${fx.tip}`, f);

    // drawer: On the parts on, the Body Dynamic, the Cap kept dry.
    await page.click('[data-knob="ambient.wetParts"] button.toggle');
    await settle(page);
    await pickRow(page, 'Body');
    ok((await physicsView(page)).note === null, 'the note stays with On the parts on', f);
    await page.locator('[data-field="phys.role"] button', { hasText: /^Dynamic$/ }).click();
    await settle(page);
    await pickRow(page, 'Cap');
    await page.click('[data-field="phys.getsWet"]');
    await settle(page);
    await page.click('.drawer-btn[data-drawer="physics"]');
    await settle(page, 300);
    const plan = await page.evaluate(() => document.querySelector('[data-field="phys.plan"]')?.textContent ?? null);
    log.plan = plan;
    ok(/^Start simulates: 1 dynamic part · rain on \d+ parts \(1 stays dry\)$/.test(plan ?? ''), `the drawer's line: ${plan}`, f);
    await page.mouse.move(10, 500);
    await settle(page, 300);
    const bar = await page.locator('.bar-wrap').boundingBox();
    if (bar) await page.screenshot({ path: join(SHOTS, 'physics-drawer-summary.png'), clip: { x: 0, y: bar.y - 8, width: 1600, height: 1000 - bar.y + 8 } });
    else f.push('no bottom bar to capture');

    log.errors = errors;
    ok(errors.length === 0, `page errors: ${errors.join(' | ')}`, f);
    await context.close();
  } finally {
    await browser.close();
    if (server) {
      server.kill('SIGTERM');
      stopServer();
    }
  }
  writeFileSync(join(OUT, 'u16-check.json'), JSON.stringify({ ok: f.length === 0, failures: f, ...log }, null, 2));
  if (f.length > 0) {
    console.error(`u16-check: ${f.length} failure(s)`);
    for (const x of f) console.error(`  - ${x}`);
    process.exit(1);
  }
  console.log('u16-check: all checks passed');
  console.log(log.plan);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
