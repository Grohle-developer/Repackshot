#!/usr/bin/env node
// Browser checks of phase E4 (the engine in the browser), with the local Chromium and swiftshader.
//
//   npm run engine:build && npm run build && node tools/viewport-check.mjs [--url http://localhost:4180]
//        [--shots docs/ui] [--samples 128]
//
// Without --url it serves dist/ with `vite preview` on port 4180 and stops it at the end (by the
// pids `lsof -t -i :4180` reports). It needs the native `rt` too and builds it
// (`cargo build --release -p rt-cli`).
//
//   (a) parity: the RSB the page exports, rendered by `rt` at 4 samples, and Render in the page at 4
//       samples (the pool of workers) give the same image hash;
//   (b) Full mode converges in the viewport and the meter shows real sample counts;
//   (c) orbiting in Full mode presents frames at reduced resolution (frames per second measured);
//   (d) Render in Fast mode gives the path tracer's image: sampling noise and a soft contact shadow
//       that the rasterised viewport does not have;
//   (e) the Fast · Full toggle, its shortcut, and Full disabled when /engine/rt.wasm is missing.
//
// Screenshots: viewport-full.png, viewport-fast.png, render-output.png. Results: out/viewport-check.json.

import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4180;
const STUDIO = 'example=1&preset=JEWELLERY&setup=REMBRANDT&theme=dark';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const BASE = opt('url', null);
const SHOTS = resolve(ROOT, opt('shots', 'docs/ui'));
const DOC_SAMPLES = Number(opt('samples', '128'));
const OUT = join(ROOT, 'out');
mkdirSync(OUT, { recursive: true });
mkdirSync(SHOTS, { recursive: true });

const results = {};
const fail = (msg) => {
  throw new Error(msg);
};

// ------------------------------------------------------------------ helpers

/** Decodes an 8-bit RGB or RGBA PNG (any filter): what Playwright and both renderers write. */
function decodePng(buf) {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let o = 8;
  let w = 0;
  let h = 0;
  let ch = 0;
  const idat = [];
  for (;;) {
    const len = v.getUint32(o);
    const type = buf.toString('latin1', o + 4, o + 8);
    if (type === 'IHDR') {
      w = v.getUint32(o + 8);
      h = v.getUint32(o + 12);
      if (buf[o + 16] !== 8) fail('PNG: only 8-bit images');
      ch = { 2: 3, 6: 4 }[buf[o + 17]] ?? fail(`PNG colour type ${buf[o + 17]}`);
    } else if (type === 'IDAT') idat.push(buf.subarray(o + 8, o + 8 + len));
    o += 12 + len;
    if (type === 'IEND') break;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  const out = new Uint8Array(w * h * 4);
  const cur = new Uint8Array(stride);
  const prev = new Uint8Array(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? cur[i - ch] : 0;
      const b = prev[i];
      const c = i >= ch ? prev[i - ch] : 0;
      let p = line[i];
      if (f === 1) p += a;
      else if (f === 2) p += b;
      else if (f === 3) p += (a + b) >> 1;
      else if (f === 4) {
        const pa = Math.abs(b - c);
        const pb = Math.abs(a - c);
        const pc = Math.abs(a + b - 2 * c);
        p += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[i] = p & 255;
    }
    for (let x = 0; x < w; x++) for (let k = 0; k < 4; k++) out[(y * w + x) * 4 + k] = k < ch ? cur[x * ch + k] : 255;
    prev.set(cur);
  }
  return { width: w, height: h, rgba: out };
}

/** FNV-1a over the RGB bytes. */
function rgbHash(img) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < img.rgba.length; i++) {
    if (i % 4 === 3) continue;
    hash = Math.imul(hash ^ img.rgba[i], 0x01000193) >>> 0;
  }
  return `0x${hash.toString(16).padStart(8, '0')}`;
}

const luma = (img, i) => 0.2126 * img.rgba[i] + 0.7152 * img.rgba[i + 1] + 0.0722 * img.rgba[i + 2];

/** Mean luma and the mean absolute Laplacian (a sampling-noise measure) over the pixels brighter than `floor`. */
function stats(img, rect = { x: 0, y: 0, w: img.width, h: img.height }, floor = -1) {
  let sum = 0;
  let n = 0;
  let lap = 0;
  let m = 0;
  for (let y = rect.y + 1; y < rect.y + rect.h - 1; y++) {
    for (let x = rect.x + 1; x < rect.x + rect.w - 1; x++) {
      const i = (y * img.width + x) * 4;
      const l = luma(img, i);
      sum += l;
      n++;
      if (l <= floor) continue;
      const nb = (luma(img, i - 4) + luma(img, i + 4) + luma(img, i - img.width * 4) + luma(img, i + img.width * 4)) / 4;
      lap += Math.abs(l - nb);
      m++;
    }
  }
  return { mean: sum / Math.max(1, n), noise: lap / Math.max(1, m), pixels: m };
}

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
  fail('no Chromium found (set REPACKSHOT_CHROMIUM)');
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

const meter = (page) => page.evaluate(() => ({ ...document.querySelector('.ov-bl')?.dataset, text: document.querySelector('.ov-bl')?.textContent }));

async function open(browser, query, { block = false } = {}) {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1, acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !m.text().startsWith('Failed to load resource') && errors.push(m.text()));
  if (block) await page.route('**/engine/*.wasm', (r) => r.fulfill({ status: 404, body: 'not found' }));
  await page.goto(`${BASE_URL}/?${query}`);
  await page.waitForSelector('#app[data-ready="1"]', { timeout: 30000 });
  return { page, context, errors };
}

/** Types a value into a number field (Enter starts editing, Enter commits). */
async function setNumber(page, label, value) {
  const field = page.locator(`[role="spinbutton"][aria-label="${label}"]`).first();
  await field.focus();
  await page.keyboard.press('Enter');
  await page.keyboard.type(String(value));
  await page.keyboard.press('Enter');
}

async function paletteRun(page, text) {
  await page.keyboard.press('Control+k');
  await page.keyboard.type(text);
  await page.waitForTimeout(200);
  await page.keyboard.press('Enter');
}

async function renderDownload(page, timeout = 600000) {
  const download = page.waitForEvent('download', { timeout });
  await page.locator('[data-guide="render"]').click();
  const d = await download;
  const path = join(OUT, d.suggestedFilename());
  await d.saveAs(path);
  return path;
}

async function waitSamples(page, n, timeout = 600000) {
  await page.waitForFunction((k) => Number(document.querySelector('.ov-bl')?.dataset.samples) >= k && document.querySelector('.ov-bl')?.dataset.mode === 'full', n, { timeout });
}

/** requestAnimationFrame callbacks per second in the page over `ms`. */
const rafRate = (page, ms) =>
  page.evaluate(
    (t) =>
      new Promise((resolve) => {
        let n = 0;
        const start = performance.now();
        const tick = () => {
          n++;
          if (performance.now() - start < t) requestAnimationFrame(tick);
          else resolve((n * 1000) / (performance.now() - start));
        };
        requestAnimationFrame(tick);
      }),
    ms,
  );

// ------------------------------------------------------------------ main

let BASE_URL = BASE;
let server = null;
let browser = null;
try {
  if (!existsSync(join(ROOT, 'public', 'engine', 'rt.wasm'))) fail('public/engine/rt.wasm is missing: npm run engine:build first');
  if (!existsSync(join(ROOT, 'dist', 'index.html'))) fail('dist/ is missing: npm run build first');
  const cargo = spawnSync('cargo', ['build', '--release', '-q', '--manifest-path', join(ROOT, 'engine', 'Cargo.toml'), '-p', 'rt-cli'], { stdio: 'inherit' });
  if (cargo.status !== 0) fail('cargo build of rt failed');
  const RT = join(ROOT, 'engine', 'target', 'release', 'rt');

  if (!BASE_URL) {
    stopServer();
    server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: 'ignore', detached: true });
    BASE_URL = `http://localhost:${PORT}`;
  }
  await waitFor(BASE_URL);
  const { chromium } = await import('playwright-core');
  browser = await chromium.launch({ executablePath: findChromium(), headless: true, args: ['--no-sandbox', '--disable-gpu', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });

  // (e) The toggle, its shortcut, the disabled state.
  {
    const { page, context, errors } = await open(browser, `${STUDIO}&mode=fast`);
    await page.waitForFunction(() => !document.querySelectorAll('.hdr .seg button')[1]?.disabled, null, { timeout: 30000 });
    const modeOf = async () => (await meter(page)).mode;
    const before = await modeOf();
    await page.locator('.hdr .seg button', { hasText: 'Full' }).click();
    await page.waitForTimeout(400);
    const afterClick = await modeOf();
    await page.locator('canvas[aria-label="viewport"]').focus();
    await page.keyboard.press('Control+Shift+R');
    await page.waitForTimeout(400);
    const afterShortcut = await modeOf();
    await page.keyboard.press('Control+Shift+R');
    await page.waitForTimeout(400);
    const afterShortcut2 = await modeOf();
    const remembered = await page.evaluate(() => localStorage.getItem('repackshot.ui.viewportMode'));
    await context.close();
    const blocked = await open(browser, `${STUDIO}&mode=full`, { block: true });
    await blocked.page.waitForFunction(() => document.querySelector('.mode-reason')?.textContent?.length > 0, null, { timeout: 30000 });
    const disabled = await blocked.page.evaluate(() => ({
      fullDisabled: document.querySelectorAll('.hdr .seg button')[1].disabled,
      reason: document.querySelector('.mode-reason').textContent,
      mode: document.querySelector('.ov-bl').dataset.mode,
      status: document.querySelector('.status').textContent,
    }));
    await blocked.page.keyboard.press('Control+Shift+R');
    await blocked.page.waitForTimeout(300);
    disabled.modeAfterShortcut = (await meter(blocked.page)).mode;
    const hdr = await blocked.page.locator('.hdr').boundingBox();
    await blocked.page.screenshot({ path: join(OUT, 'header-full-disabled.png'), clip: hdr });
    await blocked.context.close();
    results.e = { before, afterClick, afterShortcut, afterShortcut2, remembered, disabled, errors: [...errors, ...blocked.errors] };
    const ok = before === 'fast' && afterClick === 'full' && afterShortcut === 'fast' && afterShortcut2 === 'full' && remembered === '"FULL"' && disabled.fullDisabled && disabled.mode === 'fast' && disabled.modeAfterShortcut === 'fast' && /engine:build/.test(disabled.reason);
    results.e.ok = ok;
    console.log(`(e) toggle ${before} -> click ${afterClick} -> Ctrl+Shift+R ${afterShortcut} -> ${afterShortcut2}; without rt.wasm: Full disabled=${disabled.fullDisabled}, "${disabled.reason}" ${ok ? 'OK' : 'FAILED'}`);
  }

  // (b) and (c): Full mode converges; orbiting; screenshots of both modes.
  {
    const { page, context, errors } = await open(browser, `${STUDIO}&mode=full`);
    await waitSamples(page, 1, 60000);
    const t0 = Date.now();
    const first = await meter(page);
    await waitSamples(page, 16);
    const at16 = { ...(await meter(page)), wall: (Date.now() - t0) / 1000 };
    const stillRaf = await rafRate(page, 3000);
    const vp = await page.evaluate(() => {
      const r = document.querySelector('.vp-canvas-host').getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    });
    // (c) Orbit: a drag across the canvas for four seconds.
    const framesBefore = Number((await meter(page)).frames);
    const cx = vp.x + vp.width / 2;
    const cy = vp.y + vp.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    const scales = new Set();
    const dragStart = Date.now();
    let step = 0;
    const rafDuring = rafRate(page, 3500);
    while (Date.now() - dragStart < 4000) {
      step++;
      await page.mouse.move(cx + Math.sin(step / 12) * 220, cy + Math.cos(step / 15) * 60, { steps: 1 });
      if (step % 10 === 0) scales.add((await meter(page)).scale);
      await page.waitForTimeout(16);
    }
    const dragSeconds = (Date.now() - dragStart) / 1000;
    const gestureRaf = await rafDuring;
    const midDrag = await meter(page);
    const frameMs = Number(midDrag.frameMs);
    await page.mouse.up();
    const framesAfter = Number((await meter(page)).frames);
    const fps = (framesAfter - framesBefore) / dragSeconds;
    // Back to full resolution, converging again.
    await page.waitForFunction(() => document.querySelector('.ov-bl')?.dataset.scale === '1' && Number(document.querySelector('.ov-bl')?.dataset.samples) >= 1, null, { timeout: 60000 });
    const released = await meter(page);
    results.c = { fps, frames: framesAfter - framesBefore, dragSeconds, scalesSeen: [...scales], lastFrameMs: frameMs, meterDuringDrag: midDrag.text, released: released.text, gestureRaf, stillRaf };
    console.log(`(c) orbit: ${framesAfter - framesBefore} frames in ${dragSeconds.toFixed(1)} s = ${fps.toFixed(1)} fps at scale ${[...scales].join('/')} (last frame ${frameMs.toFixed(0)} ms, "${midDrag.text}"); page ${gestureRaf.toFixed(0)} rAF/s during the drag, ${stillRaf.toFixed(0)} while converging`);

    // Undo the orbit (one entry) so the screenshots show the studio's framing; converge.
    await page.keyboard.press('Control+z');
    const t1 = Date.now();
    await waitSamples(page, DOC_SAMPLES);
    const conv = await meter(page);
    const seconds = Number(conv.seconds);
    const px = Math.round(vp.width) * Math.round(vp.height);
    results.b = { first: first.text, at16, converged: conv.text, samples: Number(conv.samples), seconds, viewportPixels: px, samplesPerSecond: Number(conv.samples) / seconds, pathsPerSecond: (Number(conv.samples) * px) / seconds, wall: (Date.now() - t1) / 1000, errors };
    results.b.ok = Number(conv.samples) >= DOC_SAMPLES && /Full · \d+ samples · \d\d:\d\d/.test(conv.text) && errors.length === 0;
    console.log(`(b) converging: "${first.text}" ... "${conv.text}": ${(Number(conv.samples) / seconds).toFixed(2)} samples/s at ${Math.round(vp.width)} x ${Math.round(vp.height)} = ${((Number(conv.samples) * px) / seconds / 1e6).toFixed(2)} M paths/s ${results.b.ok ? 'OK' : 'FAILED'}`);
    await page.screenshot({ path: join(SHOTS, 'viewport-full.png') });
    const fullVp = decodePng(await page.screenshot({ clip: vp }));
    await page.locator('.hdr .seg button', { hasText: 'Fast' }).click();
    await page.waitForTimeout(800);
    await page.screenshot({ path: join(SHOTS, 'viewport-fast.png') });
    const fastVp = decodePng(await page.screenshot({ clip: vp }));
    // Mean brightness inside the output frame (the frame mask darkens the rest the same in both).
    const frame = await page.evaluate(() => {
      const r = document.querySelector('.frame-edge').getBoundingClientRect();
      const h = document.querySelector('.vp-canvas-host').getBoundingClientRect();
      return { x: Math.round(r.x - h.x), y: Math.round(r.y - h.y), w: Math.round(r.width), h: Math.round(r.height) };
    });
    const sf = stats(fullVp, frame);
    const sp = stats(fastVp, frame);
    results.brightness = { frame, fullMean: sf.mean, fastMean: sp.mean, ratio: sf.mean / sp.mean };
    console.log(`brightness in the output frame: Full ${sf.mean.toFixed(1)}, Fast ${sp.mean.toFixed(1)} (8-bit luma), ratio ${(sf.mean / sp.mean).toFixed(3)}`);
    await context.close();
  }

  // (a) and (d): Render in Fast mode at 4 samples, with the contact shadow on; parity with rt.
  {
    const { page, context, errors } = await open(browser, `${STUDIO}&mode=fast`);
    await page.waitForFunction(() => !document.querySelectorAll('.hdr .seg button')[1]?.disabled, null, { timeout: 30000 });
    await page.locator('button[role="switch"][aria-label="Contact shadow"]').click();
    await setNumber(page, 'samples', 4);
    await page.waitForTimeout(300);
    const rsbWait = page.waitForEvent('download', { timeout: 30000 });
    await paletteRun(page, 'Export engine scene');
    const rsbDownload = await rsbWait;
    const rsbPath = join(OUT, 'viewport-check.rsb');
    await rsbDownload.saveAs(rsbPath);
    // The rasterised output frame, as the viewport shows it in Fast mode.
    const frameBox = await page.evaluate(() => {
      const r = document.querySelector('.frame-edge').getBoundingClientRect();
      return { x: Math.round(r.x) + 1, y: Math.round(r.y) + 1, width: Math.round(r.width) - 2, height: Math.round(r.height) - 2 };
    });
    const fastFrame = decodePng(await page.screenshot({ clip: frameBox }));
    const t0 = Date.now();
    const pngPath = await renderDownload(page);
    const renderSeconds = (Date.now() - t0) / 1000;
    const nativePath = join(OUT, 'viewport-check-rt.png');
    const rt = spawnSync(RT, [rsbPath, '-o', nativePath, '--samples', '4'], { encoding: 'utf8' });
    if (rt.status !== 0) fail(`rt failed: ${rt.stderr}`);
    const page4 = decodePng(readFileSync(pngPath));
    const native4 = decodePng(readFileSync(nativePath));
    let differing = 0;
    for (let i = 0; i < page4.rgba.length; i++) if (i % 4 !== 3 && page4.rgba[i] !== native4.rgba[i]) differing++;
    results.a = { page: rgbHash(page4), native: rgbHash(native4), size: `${page4.width}x${page4.height}`, differingBytes: differing, renderSeconds, rt: rt.stdout.trim().split('\n').slice(-3) };
    results.a.ok = results.a.page === results.a.native && page4.width === native4.width;
    console.log(`(a) parity at 4 samples, ${page4.width} x ${page4.height}: pool ${results.a.page}, rt ${results.a.native} ${results.a.ok ? 'OK' : `FAILED (${differing} bytes differ)`}`);

    // (d) The downloaded image is the path tracer's: noise on the part, a soft shadow on the floor.
    const bg = page4.rgba.slice(0, 3);
    const bgLuma = luma(page4, 0);
    // The same patch of the part (the middle of the label and body) in both images.
    const patch = (img) => ({ x: Math.round(img.width * 0.46), y: Math.round(img.height * 0.42), w: Math.round(img.width * 0.08), h: Math.round(img.height * 0.2) });
    const sr = stats(page4, patch(page4));
    const sv = stats(fastFrame, patch(fastFrame));
    // The shadow: down the column under the centre of the part, past its base.
    let lowest = 255;
    let base = -1;
    const cx = page4.width >> 1;
    for (let y = page4.height - 1; y > page4.height / 2; y--) {
      const l = luma(page4, (y * page4.width + cx) * 4);
      if (l > bgLuma + 20) {
        base = y;
        break;
      }
    }
    const profile = [];
    for (let x = cx; x < page4.width; x += 4) {
      let s = 0;
      for (let y = base + 3; y < Math.min(page4.height, base + 9); y++) s += luma(page4, (y * page4.width + x) * 4);
      profile.push(s / 6);
      lowest = Math.min(lowest, s / 6);
    }
    // Width of the penumbra: from 10 % to 90 % of the way from the darkest to the background.
    const at = (k) => profile.findIndex((v) => v >= lowest + k * (bgLuma - lowest)) * 4;
    const penumbra = at(0.9) - at(0.1);
    results.d = { renderNoise: sr.noise, viewportNoise: sv.noise, background: [...bg], shadowDarkest: lowest, backgroundLuma: bgLuma, penumbraPx: penumbra, errors };
    results.d.ok = sr.noise > 3 * sv.noise && lowest < bgLuma - 3 && penumbra >= 8;
    console.log(`(d) Render in Fast mode: noise ${sr.noise.toFixed(2)} vs ${sv.noise.toFixed(2)} in the rasterised viewport; floor shadow ${lowest.toFixed(1)} under a background of ${bgLuma.toFixed(1)}, penumbra ${penumbra} px ${results.d.ok ? 'OK' : 'FAILED'}`);

    // The documentation's render: same studio, its own shadow setting, more samples.
    await page.locator('button[role="switch"][aria-label="Contact shadow"]').click();
    await setNumber(page, 'samples', DOC_SAMPLES);
    await page.waitForTimeout(300);
    const t1 = Date.now();
    const docPath = await renderDownload(page);
    results.renderOutput = { samples: DOC_SAMPLES, seconds: (Date.now() - t1) / 1000 };
    writeFileSync(join(SHOTS, 'render-output.png'), readFileSync(docPath));
    console.log(`render-output.png: ${DOC_SAMPLES} samples, 1920 x 1080, ${results.renderOutput.seconds.toFixed(1)} s`);
    await context.close();
  }
  writeFileSync(join(OUT, 'viewport-check.json'), JSON.stringify(results, null, 2));
  const all = ['a', 'b', 'd', 'e'].every((k) => results[k]?.ok);
  console.log(all ? 'all checks passed' : 'SOME CHECKS FAILED');
  process.exitCode = all ? 0 : 1;
} catch (err) {
  console.error(err?.stack ?? err);
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
  if (server) stopServer();
}
