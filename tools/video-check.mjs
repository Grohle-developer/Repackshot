#!/usr/bin/env node
// Browser check of phase N1 (animation and video), with the local Chromium and swiftshader and the real WebCodecs.
//
//   npm run engine:build && npm run build && node tools/video-check.mjs [--shots docs/ui]
//
// It serves dist/ with `vite preview` (port 4194) for the application, and the sources with the Vite dev server
// (port 4195) for one check that imports the video module itself; both are stopped at the end (by the pids
// `lsof -t -i :port` reports). ffprobe, when this machine has it, reads every file the browser wrote.
//
//   (a) the codecs this Chromium encodes (VideoEncoder.isConfigSupported) and what the render window offers: the
//       ones it cannot encode are there, disabled, saying so;
//   (b) a 2 s video at 12 fps through the application's own writer (src/io/video.ts) and the real encoder: 24 frames
//       drawn on a canvas, VP9 and VP8 in WebM (and H.264 in MP4 where it is encoded); ffprobe reads 24 frames and 2 s;
//   (c) the timeline: the Hero preset (the camera track and the model), a material's colour added with the wizard's
//       three steps (step 2 is the grid of kinds), a fade to black on a change of shot from the shot's properties
//       (its marker drawn on the camera track), the material's row under its target… and a custom curve whose handle
//       is dragged (one undo puts it back);
//   (d) the application's whole path: Render in Animation mode as WebM VP9, 48 frames (2 s at 24 fps) of the engine,
//       one .webm downloaded, read back by ffprobe; the Doctor says nothing of a video this system encodes, and warns
//       of MP4, which it does not;
//   (e) the viewport darkens with the fade at the cut.
//
// Screenshots (English, dark): animation-n1-wizard.png (the timeline with three tracks and the wizard at step 1),
// animation-n1-cards.png (step 2, the grid of kinds), animation-n1-curve.png (the custom curve and a shot's fade),
// render-window-video.png (Animation mode with video). Results: out/video-check.json; the videos in out/.

import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PREVIEW_PORT = 4194;
const DEV_PORT = 4195;
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const SHOTS = resolve(ROOT, opt('shots', 'docs/ui'));
const OUT = join(ROOT, 'out');
mkdirSync(SHOTS, { recursive: true });
mkdirSync(OUT, { recursive: true });

const results = {};
const fail = (msg) => {
  throw new Error(msg);
};
const check = (key, ok, detail = {}) => {
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

function stopServer(port) {
  const run = spawnSync('lsof', ['-t', '-i', `:${port}`]);
  for (const pid of (run.stdout ?? '').toString().split(/\s+/).filter(Boolean)) {
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
      if ((await fetch(url)).ok) return;
    } catch {
      // not yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  fail(`${url} did not answer`);
}

const settle = (page, ms = 250) => page.evaluate((wait) => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, wait)))), ms);

const FFPROBE = spawnSync('ffprobe', ['-version']).status === 0;
/** What ffprobe reads of a video file: its codec, frames, duration and size (null without ffprobe). */
function probe(file) {
  if (!FFPROBE) return null;
  const r = spawnSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,nb_read_frames,width,height:format=duration', '-of', 'json', file]);
  if (r.status !== 0) return { error: r.stderr.toString() };
  const j = JSON.parse(r.stdout.toString());
  return { codec: j.streams[0]?.codec_name, frames: Number(j.streams[0]?.nb_read_frames), duration: Number(j.format?.duration), width: j.streams[0]?.width, height: j.streams[0]?.height };
}

async function setNumber(page, selector, value) {
  const el = page.locator(selector).first();
  await el.dblclick();
  const input = el.locator('input');
  await input.fill(String(value));
  await input.press('Enter');
}

let preview = null;
let dev = null;
let browser = null;
try {
  if (!existsSync(join(ROOT, 'dist', 'index.html'))) fail('dist/ is missing: run npm run build first');
  if (!existsSync(join(ROOT, 'public', 'engine', 'rt.wasm'))) fail('public/engine/rt.wasm is missing: npm run engine:build first');
  const chromium = (await import(join(ROOT, 'node_modules', 'playwright-core', 'index.mjs'))).chromium;
  stopServer(PREVIEW_PORT);
  stopServer(DEV_PORT);
  preview = spawn('npx', ['vite', 'preview', '--port', String(PREVIEW_PORT), '--strictPort'], { cwd: ROOT, stdio: 'ignore', detached: true });
  dev = spawn('npx', ['vite', '--port', String(DEV_PORT), '--strictPort'], { cwd: ROOT, stdio: 'ignore', detached: true });
  await waitFor(`http://localhost:${PREVIEW_PORT}`);
  await waitFor(`http://localhost:${DEV_PORT}`);
  browser = await chromium.launch({ executablePath: findChromium(), headless: true, args: ['--no-sandbox', '--disable-gpu', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });

  // ------------------------------------------------------------------ (a) and (b): the encoder itself, at 12 fps
  {
    const page = await browser.newPage();
    // Any page of the dev server's origin (a secure context, as WebCodecs needs) can import the sources.
    await page.goto(`http://localhost:${DEV_PORT}/icon.svg`);
    const codecs = await page.evaluate(async () => {
      const out = { webcodecs: typeof VideoEncoder === 'function' };
      for (const c of ['vp09.00.10.08', 'vp8', 'avc1.42E01E', 'avc1.42E028', 'av01.0.04M.08']) {
        try {
          out[c] = (await VideoEncoder.isConfigSupported({ codec: c, width: 320, height: 180, bitrate: 1e6, framerate: 12, ...(c.startsWith('avc1') ? { avc: { format: 'avc' } } : {}) })).supported === true;
        } catch {
          out[c] = false;
        }
      }
      return out;
    });
    check('a_codecs', codecs.webcodecs && codecs['vp09.00.10.08'] && codecs.vp8, codecs);
    const made = await page.evaluate(async () => {
      const m = await import('/src/io/video.ts');
      const env = m.browserVideoEnv();
      const support = await m.probeVideo(env, 320, 180, 12);
      const runs = [];
      const choices = [
        ['WEBM', support.WEBM],
        ['WEBM', { track: 'VP8', codec: 'vp8' }],
        ['MP4', support.MP4],
      ];
      for (const [container, choice] of choices) {
        if (!choice) {
          runs.push({ container, track: null });
          continue;
        }
        const w = m.createVideoWriter(env, { container, choice, width: 320, height: 180, fps: 12 });
        const canvas = new OffscreenCanvas(320, 180);
        const g = canvas.getContext('2d');
        for (let i = 0; i < 24; i++) {
          g.fillStyle = `rgb(${(i * 10) % 255}, ${255 - ((i * 10) % 255)}, 128)`;
          g.fillRect(0, 0, 320, 180);
          g.fillStyle = '#fff';
          g.fillRect(10 + i * 12, 70, 20, 40);
          await w.add(await canvas.convertToBlob({ type: 'image/png' }), i);
        }
        const blob = await w.finish();
        const bytes = new Uint8Array(await blob.arrayBuffer());
        let bin = '';
        for (let k = 0; k < bytes.length; k += 0x8000) bin += String.fromCharCode(...bytes.subarray(k, k + 0x8000));
        runs.push({ container, track: choice.track, type: blob.type, size: bytes.length, b64: btoa(bin) });
      }
      return { support, runs };
    });
    for (const run of made.runs) {
      const key = `b_${run.container.toLowerCase()}_${(run.track ?? 'none').toLowerCase()}`;
      if (!run.track) {
        check(key, true, { written: false, why: `this Chromium does not encode ${run.container}` });
        continue;
      }
      const file = join(OUT, `video-check-12fps-${run.track.toLowerCase()}.${run.container === 'MP4' ? 'mp4' : 'webm'}`);
      writeFileSync(file, Buffer.from(run.b64, 'base64'));
      const p = probe(file);
      const want = { VP9: 'vp9', VP8: 'vp8', H264: 'h264' }[run.track];
      check(key, run.size > 0 && (!p || (p.codec === want && p.frames === 24 && Math.abs(p.duration - 2) < 1e-6 && p.width === 320 && p.height === 180)), { file: file.slice(ROOT.length + 1), bytes: run.size, ffprobe: p });
    }
    await page.close();
  }

  // ------------------------------------------------------------------ (c) to (e): the application
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !m.text().startsWith('Failed to load resource') && errors.push(m.text()));
  await page.goto(`http://localhost:${PREVIEW_PORT}/?example=1&theme=dark&lang=en&mode=fast&drawer=animation`);
  await page.waitForSelector('#app[data-ready="1"]', { timeout: 90000 });
  await settle(page, 800);

  // (c) The Hero preset: the camera track and the model.
  await page.locator('.anim-preset[data-preset="HERO"]').click();
  await settle(page);
  // A material's colour through the wizard: step 1 the target, step 2 the grid of kinds, step 3 the numbers.
  await page.locator('[data-anim-animate]').click();
  await settle(page);
  const step1 = await page.locator('.wizard').getAttribute('data-wizard');
  await page.locator('.wizard .seg button', { hasText: 'A material' }).click();
  await settle(page);
  await page.locator('[data-wizard-next]').click();
  await settle(page);
  const step2 = await page.locator('.wizard').getAttribute('data-wizard');
  const cards = await page.locator('.wizard .anim-card').evaluateAll((els) => els.map((e) => e.dataset.move));
  await page.screenshot({ path: join(SHOTS, 'animation-n1-cards.png') });
  await page.locator('.wizard .anim-card[data-move="MATERIAL_COLOR"]').click();
  await page.locator('[data-wizard-next]').click();
  await settle(page);
  const step3 = await page.locator('.wizard').getAttribute('data-wizard');
  await page.locator('[data-wizard-add]').click();
  await settle(page, 400);
  const targets = await page.locator('.atr-target').evaluateAll((els) => els.map((e) => e.getAttribute('data-target')));
  check('c_wizard_steps', step1 === '1' && step2 === '2' && step3 === '3' && cards.join(',') === 'MATERIAL_COLOR,FADE' && targets.length === 3, { step1, step2, step3, cards, targets });

  // A fade to black on the change into shot 2, from the shot's properties.
  await page.locator('.tl-seg[data-shot="1"] .tl-seg-text').click();
  await settle(page);
  const shotHead = (await page.locator('[data-shot-header]').textContent())?.trim();
  await page.locator('.anim-props .seg button', { hasText: 'Fade to black' }).click();
  await settle(page);
  const marker = await page.locator('.tl-fade[data-fade="BLACK"]').count();
  check('c_shot_fade', shotHead?.startsWith('Shot 2') && marker === 1, { shotHead, marker });
  // The material's animation under its target... in the timeline's tree; the model's under it in the scene's.
  const sceneRows = await page.locator('.side-left .tree-anim').count();
  check('c_scene_tree_clips', sceneRows >= 1, { sceneRows });

  // A custom curve: the material clip's easing to Custom, a handle dragged, one undo puts it back.
  await page.locator('.atr-clip', { hasText: 'changes colour' }).first().click();
  await settle(page);
  await page.locator('.anim-props select[aria-label="Easing"]').selectOption('CUSTOM');
  await settle(page);
  const editor = page.locator('[data-curve-editor] svg');
  const handle = editor.locator('[data-handle="1"]');
  // The properties scroll: the editor into view before the pointer goes to its handle.
  await editor.scrollIntoViewIfNeeded();
  await settle(page);
  const hb = (await handle.boundingBox()) ?? fail('no handle');
  const fields = async () => page.locator('.anim-props [data-curve-handle] .num').evaluateAll((els) => els.map((e) => e.textContent?.trim()));
  const before = await fields();
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) await page.mouse.move(hb.x + hb.width / 2 + i * 4, hb.y + hb.height / 2 - i * 6);
  await page.mouse.up();
  await settle(page);
  const dragged = await fields();
  await page.screenshot({ path: join(SHOTS, 'animation-n1-curve.png') });
  await page.locator('.anim-rows').focus();
  await page.keyboard.press('Control+z');
  await settle(page);
  const undone = await fields();
  check('c_curve_drag_one_undo', JSON.stringify(dragged) !== JSON.stringify(before) && JSON.stringify(undone) === JSON.stringify(before), { before, dragged, undone });

  // The screenshot of the criterion: the timeline with three tracks and the wizard at step 1 (the cap selected).
  await page.locator('.side-left .tree-row', { hasText: 'Cap' }).first().click();
  await settle(page);
  await page.locator('[data-anim-animate]').click();
  await settle(page, 400);
  const wizardStep = await page.locator('.wizard').getAttribute('data-wizard');
  await page.screenshot({ path: join(SHOTS, 'animation-n1-wizard.png') });
  check('c_screenshot_wizard', wizardStep === '1' && targets.length === 3, { wizardStep, tracks: targets.length });
  await page.locator('.wizard button', { hasText: 'Cancel' }).click();

  // (e) The viewport at the cut (4 s): the fade is full black there.
  await page.locator('.tl-ruler').click({ position: { x: 4 * Number(await page.locator('.anim-rows').getAttribute('data-px-per-s')) + 0.5, y: 8 } });
  await settle(page, 300);
  const fadeAmount = await page.locator('.vp-fade').evaluate((e) => ({ shown: e.style.display !== 'none', amount: Number(e.dataset.amount ?? 0) }));
  check('e_viewport_fade', fadeAmount.shown && fadeAmount.amount > 0.9, fadeAmount);

  // (d) Render the animation as a WebM VP9: 48 frames (2 s at 24 fps) of the engine (--no-render skips it).
  if (args.includes('--no-render')) throw new Error('SKIP');
  await page.locator('.anim-head button', { hasText: 'Render animation…' }).click();
  await page.waitForSelector('.rw');
  await page.waitForFunction(() => {
    const b = [...document.querySelectorAll('.rw .seg button')].find((x) => x.textContent === 'Video');
    return b && !b.disabled;
  }, null, { timeout: 30000 });
  await page.locator('.rw .seg button', { hasText: 'Video' }).click();
  await settle(page);
  const mp4 = await page.locator('.rw .seg button', { hasText: 'MP4 H.264' }).evaluate((b) => ({ disabled: b.disabled, tip: b.getAttribute('title') ?? b.getAttribute('data-tip') }));
  await page.locator('.rw .seg button', { hasText: /^WebM VP/ }).click();
  await page.locator('.rw .seg button', { hasText: 'From–to' }).click();
  await setNumber(page, '.rw .num[aria-label="Range start"]', 1);
  await setNumber(page, '.rw .num[aria-label="Range end"]', 48);
  await setNumber(page, '.rw [data-section="rw.anim"] .num[aria-label="Width"]', 160);
  await setNumber(page, '.rw .num[aria-label="Samples"]', 2);
  await settle(page);
  const note = (await page.locator('[data-video-note]').textContent())?.trim();
  await page.screenshot({ path: join(SHOTS, 'render-window-video.png') });
  const t0 = Date.now();
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 600000 }), page.keyboard.press('Enter')]);
  const name = download.suggestedFilename();
  const file = join(OUT, 'video-check-app.webm');
  writeFileSync(file, readFileSync(await download.path()));
  const p = probe(file);
  const seconds = (Date.now() - t0) / 1000;
  check('d_app_webm', name.endsWith('.webm') && (!p || (p.frames === 48 && Math.abs(p.duration - 2) < 1e-6 && p.width === 160 && (p.codec === 'vp9' || p.codec === 'vp8'))), { name, bytes: readFileSync(file).length, ffprobe: p, seconds: Math.round(seconds), mp4, note });
  // The Doctor: nothing to say of a WebM this system encodes (the window offers no MP4 here: the unit tests warn of
  // a project that asks for it).
  await page.locator('button.doctor-btn').first().click();
  await page.waitForSelector('.doctor', { timeout: 5000 });
  const output = await page.evaluate(() => {
    const row = [...document.querySelectorAll('.doctor .doctor-row')].find((r) => r.querySelector('.doctor-title')?.textContent === 'Output format');
    return row ? { warn: row.classList.contains('is-warn'), text: row.querySelector('.note')?.textContent ?? '' } : null;
  });
  check('d_doctor_output_ok', output !== null && output.warn === false, { output });
  await page.keyboard.press('Escape');
  check('no_errors', errors.length === 0, { errors });
} catch (err) {
  if (err?.message !== 'SKIP') {
    console.error(err);
    results.error = String(err?.stack ?? err);
    process.exitCode = 1;
  }
} finally {
  writeFileSync(join(OUT, 'video-check.json'), JSON.stringify(results, null, 2));
  await browser?.close();
  for (const s of [preview, dev]) {
    try {
      if (s) process.kill(-s.pid, 'SIGTERM');
    } catch {
      // gone
    }
  }
  stopServer(PREVIEW_PORT);
  stopServer(DEV_PORT);
  const failed = Object.entries(results).filter(([, v]) => v && typeof v === 'object' && v.ok === false);
  if (failed.length > 0) {
    console.error(`${failed.length} check(s) failed: ${failed.map(([k]) => k).join(', ')}`);
    process.exitCode = 1;
  }
}
