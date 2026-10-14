#!/usr/bin/env node
// Browser checks of phase U12 (TIFF and RAW (DNG) output), with the local Chromium and swiftshader.
//
//   npm run engine:build && npm run build && node tools/render-format-check.mjs [--url http://localhost:4183]
//        [--shots docs/ui]
//
// Without --url it serves dist/ with `vite preview --port 4183 --strictPort` and stops it at the end
// (by the pids `lsof -t -i :4183` reports, never `pkill -f`).
//
//   (a) the Format selector offers PNG, JPEG, EXR, TIFF and RAW (DNG); TIFF shows its bit depth (8, 16, 32-bit
//       float) and a line of help and allows a transparent background; RAW (DNG) says "32-bit float", has no bit
//       choice and no transparency;
//   (b) a 32-bit TIFF render downloads a `.tif` that reads back as the specification says (size, 32-bit floats,
//       SampleFormat 3, the DPI chosen as resolution), and the results viewer shows the image of that render
//       (the picture kept beside the file: a browser cannot decode a TIFF), the same pixels as a PNG of it;
//   (c) 8-bit and 16-bit TIFFs carry the pixels of the PNG of the same render; with a transparent background they
//       are RGBA with unassociated alpha and the background is transparent;
//   (d) a DNG downloads as `.dng`: LinearRaw, three 32-bit floats, DNGVersion 1.4, the same linear light as the
//       32-bit TIFF, and the viewer shows it too;
//   (e) the page raised no error. The summary line of the window says what is written (in (a)).
//
// Screenshot (English): render-format-tiff.png. Results: out/render-format-check.json.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4183;
const STUDIO = 'example=1&preset=JEWELLERY&setup=REMBRANDT&theme=dark&lang=en&mode=fast';
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
let failed = 0;
const check = (key, ok, detail) => {
  results[key] = { ok: Boolean(ok), ...detail };
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${key} ${JSON.stringify(detail)}`);
};

// ------------------------------------------------------------------ files

/** An 8-bit RGB or RGBA PNG (any filter, as Chromium writes them): RGBA bytes. */
function decodePng(buf) {
  const chunks = [];
  for (let o = 8; o < buf.length; ) {
    const len = buf.readUInt32BE(o);
    chunks.push({ type: buf.toString('latin1', o + 4, o + 8), data: buf.subarray(o + 8, o + 8 + len) });
    o += 12 + len;
  }
  const ihdr = chunks.find((c) => c.type === 'IHDR').data;
  const w = ihdr.readUInt32BE(0);
  const h = ihdr.readUInt32BE(4);
  if (ihdr[8] !== 8) fail('PNG: only 8-bit images');
  const ch = { 2: 3, 6: 4 }[ihdr[9]] ?? fail(`PNG colour type ${ihdr[9]}`);
  const raw = inflateSync(Buffer.concat(chunks.filter((c) => c.type === 'IDAT').map((c) => c.data)));
  const stride = w * ch;
  const out = new Uint8Array(w * h * 4);
  let prev = new Uint8Array(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = new Uint8Array(stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? cur[i - ch] : 0;
      const b = prev[i];
      const c = i >= ch ? prev[i - ch] : 0;
      let p = 0;
      if (f === 1) p = a;
      else if (f === 2) p = b;
      else if (f === 3) p = (a + b) >> 1;
      else if (f === 4) {
        const pa = Math.abs(b - c);
        const pb = Math.abs(a - c);
        const pc = Math.abs(a + b - 2 * c);
        p = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[i] = (line[i] + p) & 255;
    }
    for (let x = 0; x < w; x++) for (let k = 0; k < 4; k++) out[(y * w + x) * 4 + k] = k < ch ? cur[x * ch + k] : 255;
    prev = cur;
  }
  return { width: w, height: h, data: out };
}

const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 10: 8 };

/** A TIFF as the specification lays it out: the value bytes of every tag in file order, the strips joined. */
function readTiff(buf) {
  if (buf.toString('latin1', 0, 2) !== 'II' || buf.readUInt16LE(2) !== 42) fail('not a little-endian TIFF');
  const ifd = buf.readUInt32LE(4);
  const n = buf.readUInt16LE(ifd);
  const tags = new Map();
  let last = 0;
  for (let i = 0; i < n; i++) {
    const e = ifd + 2 + 12 * i;
    const tag = buf.readUInt16LE(e);
    const type = buf.readUInt16LE(e + 2);
    const count = buf.readUInt32LE(e + 4);
    const len = TYPE_SIZE[type] * count;
    const at = len <= 4 ? e + 8 : buf.readUInt32LE(e + 8);
    if (tag <= last) fail(`tags out of order at ${tag}`);
    if (len > 4 && at % 2) fail(`tag ${tag} at an odd offset`);
    last = tag;
    tags.set(tag, { type, count, bytes: buf.subarray(at, at + len) });
  }
  const longs = (tag) => Array.from({ length: tags.get(tag).count }, (_, i) => tags.get(tag).bytes.readUInt32LE(i * 4));
  const shorts = (tag) => Array.from({ length: tags.get(tag).count }, (_, i) => tags.get(tag).bytes.readUInt16LE(i * 2));
  const strips = longs(273);
  const counts = longs(279);
  const pixels = Buffer.concat(strips.map((o, i) => buf.subarray(o, o + counts[i])));
  if (strips.at(-1) + counts.at(-1) !== buf.length) fail('bytes after the last strip');
  return { tags, longs, shorts, pixels, width: longs(256)[0], height: longs(257)[0] };
}

const floatsOf = (b) => new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
const wordsOf = (b) => new Uint16Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));

// ------------------------------------------------------------------ browser helpers

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

async function open(browser, query) {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && !m.location().url.startsWith('https://api.github.com/') && errors.push(m.text()));
  await page.goto(`${BASE_URL}/?${query}`);
  await page.waitForSelector('#app[data-ready="1"]', { timeout: 90000 });
  // The engine is ready when Full can be chosen.
  await page.waitForFunction(() => !document.querySelectorAll('.hdr .seg button')[1]?.disabled, null, { timeout: 60000 });
  return { page, context, errors };
}

async function setNumber(page, selector, value) {
  const el = page.locator(selector).first();
  await el.dblclick();
  const input = el.locator('input');
  await input.fill(String(value));
  await input.press('Enter');
}

async function download(page, action, timeout = 240000) {
  const [d] = await Promise.all([page.waitForEvent('download', { timeout }), action()]);
  return { name: d.suggestedFilename(), bytes: readFileSync(await d.path()) };
}

const sizeSel = '.rw [data-section="rw.size"]';
const seg = (page, text) => page.locator('.rw .seg button:visible', { hasText: text });

/** Renders with the window as it is and returns the downloaded file once the results viewer has the image. */
async function render(page) {
  const file = await download(page, () => page.locator('.rw-foot .btn-primary').click());
  await page.waitForSelector('.rv[data-ready="1"]', { timeout: 60000 });
  return file;
}

/** The pixels of the image the results viewer shows (the first layer of its divider). */
const viewerPixels = (page) =>
  page.evaluate(() => {
    const c = document.querySelector('.rv .split-img');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height);
    return { width: c.width, height: c.height, data: Array.from(d.data) };
  });

// ------------------------------------------------------------------ main

let BASE_URL = opt('url', null);
let server = null;
let browser = null;
try {
  if (!existsSync(join(ROOT, 'public', 'engine', 'rt.wasm'))) fail('public/engine/rt.wasm is missing: npm run engine:build first');
  if (!existsSync(join(ROOT, 'dist', 'index.html'))) fail('dist/ is missing: npm run build first');
  if (!BASE_URL) {
    stopServer();
    server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: 'ignore', detached: true });
    BASE_URL = `http://localhost:${PORT}`;
  }
  await waitFor(BASE_URL);
  const { chromium } = await import(join(ROOT, 'node_modules', 'playwright-core', 'index.mjs'));
  browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true, args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });

  const { page, errors } = await open(browser, STUDIO);
  await page.locator('canvas[aria-label="viewport"]').focus();
  await page.keyboard.press('Control+Enter');
  await page.waitForSelector('.rw');
  await page.locator('.rw-name').fill('fmt_{n}');
  await page.locator('.rw-name').press('Enter');
  await setNumber(page, `${sizeSel} .num[aria-label="Width"]`, 192);
  await setNumber(page, `${sizeSel} .num[aria-label="Resolution"]`, 150);
  await setNumber(page, '.rw .num[aria-label="Samples"]', 4);

  // (a) The selector and what each format shows.
  const formats = await page.locator('.rw [aria-label="Format"] button').allTextContents();
  const visible = async (text) => (await seg(page, text).count()) > 0;
  // PNG offers 8 and 16 bits, not the float.
  const pngBits = [await visible('8-bit'), await visible('16-bit'), await visible('32-bit float')];
  await seg(page, 'TIFF').click();
  const note = await page.locator('.rw .note', { hasText: 'TIFF:' }).textContent();
  const tiffBits = [await visible('8-bit'), await visible('16-bit'), await visible('32-bit float')];
  const transparentOn = await page.locator('.rw button[aria-label="Transparent background"]').isEnabled();
  await seg(page, '32-bit float').click();
  // The screenshot of the window with TIFF and 32 bits chosen (Output folded back in only if it does not fit).
  await page.mouse.move(10, 990);
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(SHOTS, 'render-format-tiff.png') });
  const summaryTiff = await page.locator('.rw-summary').textContent();
  await seg(page, 'RAW (DNG)').click();
  const dngNote = await page.locator('.rw .note', { hasText: 'Linear floating-point DNG' }).textContent();
  const dngBits = { choose8: await visible('8-bit'), choose16: await visible('16-bit'), fixed: await page.locator('.rw .aux', { hasText: '32-bit float' }).first().isVisible() };
  const dngTransparent = await page.locator('.rw button[aria-label="Transparent background"]').isDisabled();
  const dngWhy = await page.locator('.rw .note', { hasText: 'raw has no transparency' }).count();
  const summaryDng = await page.locator('.rw-summary').textContent();
  const extDng = await page.locator('.rw-preview').textContent();
  check(
    'a_selector',
    JSON.stringify(formats) === JSON.stringify(['PNG', 'JPEG', 'EXR', 'TIFF', 'RAW (DNG)']) &&
      pngBits.join() === 'true,true,false' &&
      tiffBits.every(Boolean) &&
      transparentOn &&
      note.includes('uncompressed') &&
      dngNote.includes('camera raw') &&
      dngBits.fixed &&
      !dngBits.choose8 &&
      !dngBits.choose16 &&
      dngTransparent &&
      dngWhy === 1 &&
      summaryTiff.includes('TIFF 32-bit float') &&
      summaryDng.includes('DNG') &&
      extDng.trim().endsWith('.dng'),
    { formats, pngBits, tiffBits, note, dngNote, dngBits, dngTransparent, summaryTiff, summaryDng, extDng },
  );

  // The same render in PNG (the reference: 8 bits, then the pixels of every other file are compared with it).
  await seg(page, 'PNG').first().click();
  const pngFile = await render(page);
  const png = decodePng(pngFile.bytes);
  const pngViewer = await viewerPixels(page);
  await page.keyboard.press('Escape');

  // (b) TIFF, 32-bit float.
  await page.keyboard.press('Control+Enter');
  await page.waitForSelector('.rw');
  await seg(page, 'TIFF').click();
  await seg(page, '32-bit float').click();
  const tiff32 = await render(page);
  const t32 = readTiff(tiff32.bytes);
  const f32 = floatsOf(t32.pixels);
  const viewer32 = await viewerPixels(page);
  const res32 = t32.tags.get(282).bytes;
  let viewerDiffers = 0;
  for (let i = 0; i < png.data.length; i++) if (viewer32.data[i] !== png.data[i]) viewerDiffers++;
  const lit = f32.some((v) => v > 0.05);
  const beyondOne = f32.some((v) => v > 1);
  check(
    'b_tiff32_and_viewer',
    tiff32.name.endsWith('.tif') &&
      t32.width === png.width &&
      t32.height === png.height &&
      t32.shorts(258).join() === '32,32,32' &&
      t32.shorts(339).join() === '3,3,3' &&
      t32.shorts(262)[0] === 2 &&
      res32.readUInt32LE(0) === 150 &&
      res32.readUInt32LE(4) === 1 &&
      f32.length === png.width * png.height * 3 &&
      f32.every(Number.isFinite) &&
      lit &&
      viewer32.width === png.width &&
      viewer32.height === png.height &&
      viewerDiffers === 0,
    { file: tiff32.name, size: `${t32.width}x${t32.height}`, bytes: tiff32.bytes.length, dpi: res32.readUInt32LE(0), lit, beyondOne, viewerBytesDiffering: viewerDiffers, viewerSize: `${viewer32.width}x${viewer32.height}`, tags: [...t32.tags.keys()] },
  );
  await page.keyboard.press('Escape');

  // (c) TIFF, 8 and 16 bits, with the pixels of the PNG; then 8 bits with a transparent background.
  await page.keyboard.press('Control+Enter');
  await page.waitForSelector('.rw');
  await seg(page, 'TIFF').click();
  await seg(page, '8-bit').click();
  const tiff8 = await render(page);
  const t8 = readTiff(tiff8.bytes);
  let diff8 = 0;
  for (let i = 0; i < png.width * png.height; i++) for (let c = 0; c < 3; c++) if (t8.pixels[i * 3 + c] !== png.data[i * 4 + c]) diff8++;
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+Enter');
  await page.waitForSelector('.rw');
  await seg(page, '16-bit').click();
  const tiff16 = await render(page);
  const t16 = readTiff(tiff16.bytes);
  const w16 = wordsOf(t16.pixels);
  let off16 = 0;
  for (let i = 0; i < png.width * png.height; i++) for (let c = 0; c < 3; c++) if (Math.abs(w16[i * 3 + c] / 257 - png.data[i * 4 + c]) > 1) off16++;
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+Enter');
  await page.waitForSelector('.rw');
  await seg(page, '8-bit').click();
  await page.locator('.rw button[aria-label="Transparent background"]').click();
  const tiffA = await render(page);
  const tA = readTiff(tiffA.bytes);
  const alpha = Array.from({ length: tA.width * tA.height }, (_, i) => tA.pixels[i * 4 + 3]);
  const transparentPx = alpha.filter((a) => a === 0).length;
  const opaquePx = alpha.filter((a) => a === 255).length;
  check(
    'c_tiff8_tiff16_alpha',
    t8.shorts(258).join() === '8,8,8' &&
      diff8 === 0 &&
      t16.shorts(258).join() === '16,16,16' &&
      off16 === 0 &&
      tA.shorts(258).join() === '8,8,8,8' &&
      tA.shorts(338).join() === '2' &&
      transparentPx > 0 &&
      opaquePx > 0 &&
      tiffA.name.endsWith('.tif'),
    { bytes8DifferingFromPng: diff8, words16FartherThanOneFromPng: off16, alphaChannels: tA.shorts(258).length, extraSamples: tA.shorts(338), transparentPixels: transparentPx, opaquePixels: opaquePx },
  );
  await page.keyboard.press('Escape');

  // (d) DNG: the same linear light as the 32-bit TIFF, and the viewer shows it.
  await page.keyboard.press('Control+Enter');
  await page.waitForSelector('.rw');
  await seg(page, 'RAW (DNG)').click();
  const dngFile = await render(page);
  const d = readTiff(dngFile.bytes);
  const dngFloats = floatsOf(d.pixels);
  let dngDiffers = 0;
  for (let i = 0; i < f32.length; i++) if (dngFloats[i] !== f32[i]) dngDiffers++;
  const dngViewer = await viewerPixels(page);
  let dngViewerDiffers = 0;
  for (let i = 0; i < png.data.length; i++) if (dngViewer.data[i] !== png.data[i]) dngViewerDiffers++;
  const matrix = Array.from({ length: 9 }, (_, i) => d.tags.get(50721).bytes.readInt32LE(i * 8) / d.tags.get(50721).bytes.readInt32LE(i * 8 + 4));
  check(
    'd_dng_and_viewer',
    dngFile.name.endsWith('.dng') &&
      d.shorts(262)[0] === 34892 &&
      d.shorts(258).join() === '32,32,32' &&
      [...d.tags.get(50706).bytes].join() === '1,4,0,0' &&
      d.tags.get(50708).bytes.toString('latin1') === 'Repackshot\0' &&
      d.shorts(50778)[0] === 21 &&
      !d.tags.has(338) &&
      dngDiffers === 0 &&
      dngViewerDiffers === 0,
    { file: dngFile.name, bytes: dngFile.bytes.length, floatsDifferingFromTiff32: dngDiffers, viewerBytesDiffering: dngViewerDiffers, matrix: matrix.map((v) => Number(v.toFixed(5))) },
  );

  // (e) The page raised nothing.
  results.errors = errors;
  check('e_no_page_errors', errors.length === 0, { errors });
  writeFileSync(join(OUT, 'render-format-check.json'), JSON.stringify(results, null, 2));
} finally {
  if (browser) await browser.close();
  if (server) stopServer();
}
if (failed > 0) {
  console.error(`${failed} check(s) failed`);
  process.exit(1);
}
