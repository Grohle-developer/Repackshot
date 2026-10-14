#!/usr/bin/env node
// Browser checks of phase U11 (live denoise of the Full viewport) in the built app, with the local Chromium and
// swiftshader: the pool of Web Workers with the real rt.wasm.
//
//   npm run engine:build && npm run build && node tools/denoise-live-check.mjs [--url http://localhost:4198]
//        [--shots docs/ui] [--seconds 24]
//
// Without --url it serves dist/ with `vite preview` on port 4198 and stops it at the end. It needs
// dist/engine/rt.wasm (`npm run engine:build` before `npm run build`).
//
//   (toggle)  the top bar has Denoise to the right of Fast · Full, in the same area (the guided tour's), pressed as the
//             project says (Advanced ▸ Denoise is Both by default) and with its tooltip; it is the meter's switch too:
//             D turns both, the next frame shows the noisy accumulation (the meter says so) and the image does not
//             start over; D again turns it on and a denoised image follows without a new view; Undo and Redo turn it
//             as the store has it; in Fast mode it is disabled, its tooltip says "Applies to Full mode" and D does
//             nothing; in Spanish it reads "Reducir ruido";
//   (cadence) in Full with Denoise on, through the meter's frames (data-clean-images, data-clean-at, data-denoise-ms,
//             data-accumulated): a new denoised image at least every max(2 × the last denoise, 0.5 s), each of the
//             newest pass when its denoise began (at the meter's 250 ms granularity), while the samples keep growing.
//             Where one sample of the whole view takes longer than that (a loaded machine, swiftshader), nothing newer
//             exists to denoise: then the image must come one denoise after its pass (the lane never waits with
//             something to do), and the check says how many gaps were bounded by the passes;
//   (shot)    docs/ui/denoise-live.png: the top bar with Denoise on and the Full viewport denoised.
//
// Results: out/denoise-live-check.json.

import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4198;
const STUDIO = 'example=1&preset=JEWELLERY&setup=REMBRANDT&theme=dark';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const BASE = opt('url', null);
const SHOTS = resolve(ROOT, opt('shots', 'docs/ui'));
const SECONDS = Number(opt('seconds', '24'));
const OUT = join(ROOT, 'out');
mkdirSync(OUT, { recursive: true });
mkdirSync(SHOTS, { recursive: true });

const results = {};
const fail = (msg) => {
  throw new Error(msg);
};
const ok = (cond, msg, failures) => {
  if (!cond) failures.push(msg);
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

let BASE_URL = BASE;

async function open(browser, query) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !m.text().startsWith('Failed to load resource') && errors.push(m.text()));
  await page.goto(`${BASE_URL}/?${query}`);
  await page.waitForSelector('#app[data-ready="1"]', { timeout: 60000 });
  return { page, context, errors };
}

/** What the top bar and the meter say now. */
const look = (page) =>
  page.evaluate(() => {
    const area = document.querySelector('[data-guide="viewport-mode"]');
    const seg = area?.querySelector('.hdr-denoise');
    const btn = seg?.querySelector('button');
    const meter = document.querySelector('.ov-bl');
    const d = meter?.dataset ?? {};
    const modeButtons = [...(area?.querySelectorAll('.seg:not(.hdr-denoise) button') ?? [])].map((b) => ({ text: b.textContent, pressed: b.getAttribute('aria-pressed') }));
    const box = (el) => {
      const r = el?.getBoundingClientRect();
      return r ? { x: r.left, y: r.top, w: r.width, h: r.height } : null;
    };
    return {
      inArea: !!btn,
      label: btn?.textContent ?? '',
      pressed: btn?.getAttribute('aria-pressed') ?? null,
      disabled: btn?.disabled ?? null,
      tip: seg?.getAttribute('data-tip') ?? '',
      kbd: seg?.getAttribute('data-kbd') ?? '',
      modes: modeButtons,
      modeBox: box(area?.querySelector('.seg:not(.hdr-denoise)')),
      toggleBox: box(seg),
      meterButton: document.querySelector('.ov-denoise')?.getAttribute('aria-pressed') ?? null,
      mode: d.mode,
      denoised: d.denoised,
      samples: Number(d.samples ?? 0),
      passes: Number(d.passes ?? 0),
      scale: Number(d.scale ?? 1),
      cleanImages: Number(d.cleanImages ?? 0),
      cleanAt: Number(d.cleanAt || 0),
      denoiseMs: Number(d.denoiseMs || 0),
      accumulated: Number(d.accumulated || 0),
      shownKey: d.shownKey ?? '',
      wantKey: d.wantKey ?? '',
      undo: document.querySelector('.hdr-center .icon-btn')?.getAttribute('data-tip') ?? '',
      now: performance.now(),
    };
  });

const until = async (page, cond, ms = 60000, every = 100) => {
  const end = Date.now() + ms;
  for (;;) {
    const s = await look(page);
    if (cond(s)) return s;
    if (Date.now() > end) return null;
    await page.waitForTimeout(every);
  }
};

// ------------------------------------------------------------------ the checks

async function checks(browser) {
  const { page, context, errors } = await open(browser, `${STUDIO}&mode=full`);
  const f = [];
  const log = {};
  await page.waitForFunction(() => document.querySelector('.ov-bl')?.dataset.mode === 'full', null, { timeout: 60000 });
  // (toggle) Where it is and what it says.
  let s = await look(page);
  ok(s.inArea, 'Denoise is not in the area of Fast · Full', f);
  ok(s.label === 'Denoise', `the label is "${s.label}"`, f);
  ok(s.pressed === 'true' && s.disabled === false, `Denoise is not on by default in Full (pressed ${s.pressed}, disabled ${s.disabled})`, f);
  ok(s.meterButton === 'true', `the meter's switch does not agree (${s.meterButton})`, f);
  ok(/Denoise the Full viewport/.test(s.tip), `tooltip: ${s.tip}`, f);
  ok(s.kbd === 'D', `shortcut in the tooltip: ${s.kbd}`, f);
  ok(s.modeBox && s.toggleBox && s.toggleBox.x >= s.modeBox.x + s.modeBox.w - 1 && Math.abs(s.toggleBox.y - s.modeBox.y) < 4, `Denoise is not to the right of Fast · Full: ${JSON.stringify([s.modeBox, s.toggleBox])}`, f);
  log.toggle = { label: s.label, tip: s.tip, kbd: s.kbd };

  // (cadence) Denoised images while the samples grow.
  const first = await until(page, (x) => x.cleanImages >= 1 && x.scale === 1, 120000);
  ok(first !== null, 'no denoised image came in two minutes', f);
  const timeline = [];
  const t0 = Date.now();
  while (Date.now() - t0 < SECONDS * 1000) {
    timeline.push(await look(page));
    await page.waitForTimeout(60);
  }
  const cleans = [];
  for (const x of timeline) if (x.cleanAt && (cleans.length === 0 || x.cleanAt !== cleans[cleans.length - 1].at)) cleans.push({ at: x.cleanAt, images: x.cleanImages, samples: x.samples, ms: x.denoiseMs, seenAt: x.now });
  // When the accumulation first had `n` samples (the meter's clock).
  const passAt = (n) => timeline.find((x) => x.accumulated >= n)?.now ?? Infinity;
  const gaps = [];
  let boundByPasses = 0;
  for (let i = 1; i < cleans.length; i++) {
    const a = cleans[i - 1];
    const b = cleans[i];
    // Two images inside one meter refresh: their gap is no larger than the refresh.
    const gap = (b.at - a.at) / Math.max(1, b.images - a.images);
    const promised = Math.max(2 * b.ms, 500);
    // Its pass came after the image before was shown, and more than a denoise later: nothing newer was there to denoise.
    const passCame = passAt(b.samples);
    const late = passCame - a.at > b.ms;
    const right = b.at - b.ms <= passCame + 250 + 120;
    gaps.push({ gap: Math.round(gap), promised: Math.round(promised), denoiseMs: b.ms, samples: b.samples, ...(late ? { passLate: Math.round(passCame - a.at) } : {}) });
    if (gap <= promised + 120) continue;
    if (late && right) boundByPasses++;
    else ok(false, `a denoised image ${Math.round(gap)} ms after the last (promised ${Math.round(promised)} ms; its pass came ${Math.round(passCame - a.at)} ms after it)`, f);
  }
  ok(cleans.length >= 4, `only ${cleans.length} denoised images in ${SECONDS} s`, f);
  // Each image is of the newest pass when its denoise began: no newer pass had been seen by then (the meter refreshes
  // every 250 ms, so the pass seen at that moment may be one older).
  for (const c of cleans) {
    const began = c.at - c.ms;
    const seen = timeline.filter((x) => x.now <= began - 250 && x.accumulated > 0);
    const newestThen = seen.length ? seen[seen.length - 1].accumulated : 0;
    ok(c.samples >= newestThen, `an image of ${c.samples} samples began when ${newestThen} were already there`, f);
  }
  const last = timeline[timeline.length - 1];
  ok(last.accumulated > (first?.accumulated ?? 0), `the samples did not grow while denoising (${first?.accumulated} → ${last.accumulated})`, f);
  ok(last.denoised === '1', 'the image on screen is not the denoised one', f);
  log.cadence = { images: cleans.length, boundByPasses, gaps, denoiseMs: last.denoiseMs, accumulated: [first?.accumulated, last.accumulated], seconds: SECONDS, view: await page.evaluate(() => { const c = document.querySelector('.vp canvas, canvas'); return c ? `${c.width}x${c.height}` : ''; }) };

  // (shot) The top bar with Denoise on and the view denoised.
  await page.mouse.move(5, 895);
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(SHOTS, 'denoise-live.png') });
  log.shot = 'denoise-live.png';

  // (toggle) D: off; the next frame is the noisy accumulation, the same view goes on.
  const key = last.shownKey;
  await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
  await page.keyboard.press('d');
  s = await until(page, (x) => x.pressed === 'false' && x.meterButton === 'false', 5000, 30);
  ok(s !== null, `D did not turn both switches off: ${JSON.stringify(await look(page).then((x) => ({ pressed: x.pressed, meter: x.meterButton })))}`, f);
  s = await until(page, (x) => x.denoised === '0', 3000, 30);
  ok(s !== null, 'the noisy accumulation did not come back at once', f);
  ok(s && s.shownKey === key && s.wantKey === key && s.scale === 1, `the view started over (${s?.shownKey} vs ${key}, scale ${s?.scale})`, f);
  ok(s && /Stop denoising the viewport/.test(s.undo), `undo says: ${s?.undo}`, f);
  // D again: a denoised image of what has accumulated, without a new view.
  const images = s?.cleanImages ?? 0;
  await page.keyboard.press('d');
  s = await until(page, (x) => x.pressed === 'true' && x.denoised === '1' && x.cleanImages > images, 60000, 50);
  ok(s !== null, 'D on did not bring a denoised image', f);
  ok(s && s.shownKey === key, 'the view started over when it was turned on', f);
  // Undo: off again (the project's state).
  const undoTip = (await look(page)).undo;
  ok(/Denoise the viewport/.test(undoTip), `undo says: ${undoTip}`, f);
  await page.keyboard.press('Control+z');
  s = await until(page, (x) => x.pressed === 'false' && x.meterButton === 'false', 5000, 30);
  ok(s !== null, `undo did not turn it off (${undoTip})`, f);
  await page.keyboard.press('Control+Shift+z');
  s = await until(page, (x) => x.pressed === 'true', 5000, 30);
  ok(s !== null, 'redo did not turn it on', f);
  // Fast: disabled, and why.
  await page.keyboard.press('Control+Shift+r');
  s = await until(page, (x) => x.mode === 'fast', 10000, 50);
  ok(s !== null && s.disabled === true && s.tip === 'Applies to Full mode', `in Fast: disabled ${s?.disabled}, tip "${s?.tip}"`, f);
  await page.keyboard.press('d');
  await page.waitForTimeout(200);
  s = await look(page);
  ok(s.pressed === 'true', 'D turned it in Fast mode', f);
  await page.keyboard.press('Control+Shift+r');
  s = await until(page, (x) => x.mode === 'full', 10000, 50);
  ok(s !== null && s.disabled === false, 'back in Full it is not enabled', f);
  ok(errors.length === 0, `errors in the page: ${errors.join(' | ')}`, f);
  await context.close();
  // Spanish: the label.
  const es = await open(browser, `${STUDIO}&mode=full&lang=es`);
  const label = await es.page.evaluate(() => document.querySelector('.hdr-denoise button')?.textContent ?? '');
  ok(label === 'Reducir ruido', `Spanish label: ${label}`, f);
  await es.context.close();
  results.live = { ok: f.length === 0, failures: f, ...log };
  console.log(`live denoise: ${f.length === 0 ? 'OK' : `FAILED\n  - ${f.join('\n  - ')}`}`);
  console.log(JSON.stringify(log.cadence));
}

// ------------------------------------------------------------------ main

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
  writeFileSync(join(OUT, 'denoise-live-check.json'), JSON.stringify(results, null, 2));
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
