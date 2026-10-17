#!/usr/bin/env node
// Browser checks of phase N2 (the queue, the passes and the batches), with the local Chromium and swiftshader and the real
// rt.wasm pool.
//
//   npm run engine:build && npm run build && node tools/batch-check.mjs [--url http://localhost:4184] [--shots docs/ui]
//
// Without --url it serves dist/ with `vite preview --port 4184 --strictPort` and stops it at the end (by the pids
// `lsof -t -i :4184` reports, never `pkill -f`).
//
//   (a) two studios are saved from the palette ("Save as studio") and a second camera is made; the render window
//       lists them (The scene as it is, Studio 1, Studio 2, All studios (2)), and with All cameras × All studios the
//       window says it is a batch of 4 images;
//   (b) Render with the ZIP on: ONE download, a `.zip` the system's `unzip` and our own reader both accept (CRC-32 of
//       every file), holding the 2 × 2 = 4 images named by the template {project}_{camera}_{studio} and, beside
//       each, the alpha, depth and part-id passes (EXR) and the part legend: 4 + 12 + 4 = 20 files; the 4 images are 4
//       different pictures (two studios, two cameras), and each EXR is read by the specification: the alpha is 0..1
//       with background, object and soft edges, the depth is +Infinity on the background, the ids are integers with
//       the legend naming them;
//   (c) the queue lists the four jobs done, with the studio beside the camera, the results history has four images;
//   (d) one image with the passes as 16-bit PNG, no ZIP: separate downloads (image, alpha, depth, normal) whose PNGs are
//       16-bit grey/RGB of the image's size, and whose alpha is the EXR's alpha (±1/65535) of the same render;
//   (e) cancelling: three jobs queued, the second stopped while it renders: it ends Cancelled and the third renders;
//   (f) the page raised no error.
//
// Screenshots (English): batch-window.png (the render window with the passes, the studio and the ZIP) and
// batch-queue.png (the queue drawer with the batch done). Results: out/batch-check.json.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32 as zlibCrc32, inflateSync } from 'node:zlib';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4184;
const START = 'example=1&preset=JEWELLERY&setup=REMBRANDT&theme=dark&lang=en&mode=fast';
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

// ------------------------------------------------------------------ readers (by the specifications, not by our writers)

/** CRC-32 (ISO 3309): node's, or by the table where node has none. */
const crc32 =
  zlibCrc32 ??
  ((buf) => {
    let c = 0xffffffff;
    for (const b of buf) {
      c ^= b;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    return (c ^ 0xffffffff) >>> 0;
  });

/** A ZIP of stored files: the central directory's entries, each with its CRC checked against the bytes. */
function readZip(buf) {
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end < 0) fail('no end-of-central-directory record');
  const count = buf.readUInt16LE(end + 10);
  let o = buf.readUInt32LE(end + 16);
  const files = new Map();
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(o) !== 0x02014b50) fail('bad central directory entry');
    const method = buf.readUInt16LE(o + 10);
    const crc = buf.readUInt32LE(o + 16);
    const size = buf.readUInt32LE(o + 24);
    const nameLen = buf.readUInt16LE(o + 28);
    const extraLen = buf.readUInt16LE(o + 30);
    const commentLen = buf.readUInt16LE(o + 32);
    const local = buf.readUInt32LE(o + 42);
    const name = buf.toString('utf8', o + 46, o + 46 + nameLen);
    if (method !== 0) fail(`${name}: method ${method} (stored expected)`);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + size);
    if (crc32(data) !== crc) fail(`${name}: CRC-32 differs`);
    files.set(name, data);
    o += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

/** An 8-bit RGB or RGBA PNG (any filter, as Chromium writes them or ours with filter 0): RGBA bytes. */
function decodePng8(buf) {
  const chunks = pngChunks(buf);
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

function pngChunks(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) fail('not a PNG');
  const chunks = [];
  for (let o = 8; o < buf.length; ) {
    const len = buf.readUInt32BE(o);
    if (crc32(buf.subarray(o + 4, o + 8 + len)) !== buf.readUInt32BE(o + 8 + len)) fail(`PNG chunk ${buf.toString('latin1', o + 4, o + 8)}: CRC differs`);
    chunks.push({ type: buf.toString('latin1', o + 4, o + 8), data: buf.subarray(o + 8, o + 8 + len) });
    o += 12 + len;
  }
  return chunks;
}

/** A 16-bit grey or RGB PNG with filter 0 (what we write): its words, and the notes. */
function decodePng16(buf) {
  const chunks = pngChunks(buf);
  const ihdr = chunks.find((c) => c.type === 'IHDR').data;
  const [width, height, depth, colour] = [ihdr.readUInt32BE(0), ihdr.readUInt32BE(4), ihdr[8], ihdr[9]];
  if (depth !== 16) fail(`PNG: ${depth}-bit, 16 expected`);
  const channels = colour === 0 ? 1 : colour === 2 ? 3 : fail(`PNG colour type ${colour}`);
  const raw = inflateSync(Buffer.concat(chunks.filter((c) => c.type === 'IDAT').map((c) => c.data)));
  const row = width * channels * 2;
  const words = new Uint16Array(width * height * channels);
  for (let y = 0; y < height; y++) {
    if (raw[y * (row + 1)] !== 0) fail('PNG16: a filter other than 0');
    for (let i = 0; i < width * channels; i++) words[y * width * channels + i] = raw.readUInt16BE(y * (row + 1) + 1 + i * 2);
  }
  const text = chunks.filter((c) => c.type === 'tEXt').map((c) => c.data.toString('latin1').split('\0'));
  return { width, height, channels, words, text, hasPhys: chunks.some((c) => c.type === 'pHYs') };
}

/** A single-part scan-line OpenEXR of uncompressed 32-bit float channels: the planes by channel name. */
function readExr(buf) {
  if (buf.readUInt32LE(0) !== 20000630 || buf.readUInt32LE(4) !== 2) fail('not a single-part scan-line EXR');
  let o = 8;
  const cstr = () => {
    const end = buf.indexOf(0, o);
    const s = buf.toString('latin1', o, end);
    o = end + 1;
    return s;
  };
  const attrs = {};
  for (;;) {
    const name = cstr();
    if (!name) break;
    cstr();
    const size = buf.readInt32LE(o);
    attrs[name] = buf.subarray(o + 4, o + 4 + size);
    o += 4 + size;
  }
  if (attrs.compression[0] !== 0) fail('EXR: compressed');
  const names = [];
  const cl = attrs.channels;
  for (let i = 0; cl[i] !== 0; ) {
    const end = cl.indexOf(0, i);
    names.push(cl.toString('latin1', i, end));
    if (cl.readInt32LE(end + 1) !== 2) fail('EXR: a channel that is not 32-bit float');
    i = end + 1 + 16;
  }
  if (names.join() !== [...names].sort().join()) fail('EXR: channels not in alphabetical order');
  const width = attrs.dataWindow.readInt32LE(8) + 1;
  const height = attrs.dataWindow.readInt32LE(12) + 1;
  const planes = Object.fromEntries(names.map((n) => [n, new Float32Array(width * height)]));
  for (let y = 0; y < height; y++) {
    const at = Number(buf.readBigUInt64LE(o + y * 8));
    if (buf.readInt32LE(at) !== y || buf.readInt32LE(at + 4) !== width * names.length * 4) fail(`EXR: line ${y}`);
    let p = at + 8;
    for (const n of names) for (let x = 0; x < width; x++, p += 4) planes[n][y * width + x] = buf.readFloatLE(p);
  }
  return { width, height, names, planes };
}

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

const palette = async (page, text) => {
  await page.keyboard.press('Control+k');
  await page.waitForSelector('.palette-input');
  await page.keyboard.type(text);
  await page.waitForTimeout(200);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(600);
};

async function setNumber(page, selector, value) {
  const el = page.locator(selector).first();
  await el.dblclick();
  const input = el.locator('input');
  await input.fill(String(value));
  await input.press('Enter');
}

const sizeSel = '.rw [data-section="rw.size"]';
const seg = (page, text) => page.locator('.rw .seg button:visible', { hasText: text });
const downloads = [];

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

  const { page, errors } = await open(browser, START);
  page.on('download', async (d) => downloads.push({ name: d.suggestedFilename(), bytes: readFileSync(await d.path()) }));
  const canvas = page.locator('canvas[aria-label="viewport"]');
  await canvas.focus();

  // (a) Two studios from the palette, a second camera looking from another side, and the window that lists them.
  await palette(page, 'save as studio');
  await palette(page, 'neon noir');
  await palette(page, 'save as studio');
  await palette(page, 'new camera from current view');
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 90, box.y + box.height / 2 - 30, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(600);
  await page.keyboard.press('Control+Enter');
  await page.waitForSelector('.rw');
  await page.locator('.rw-name').fill('{project}_{camera}_{studio}');
  await page.locator('.rw-name').press('Enter');
  await setNumber(page, `${sizeSel} .num[aria-label="Width"]`, 192);
  await setNumber(page, '.rw .num[aria-label="Samples"]', 8);
  await page.locator('.rw select[aria-label="Camera"]').selectOption('ALL');
  const studioOptions = await page.locator('.rw select[aria-label="Studio"] option').allTextContents();
  await page.locator('.rw select[aria-label="Studio"]').selectOption('ALL');
  await page.locator('.rw .chip[data-pass="alpha"]').click();
  await page.locator('.rw .chip[data-pass="depth"]').click();
  await page.locator('.rw .chip[data-pass="partId"]').click();
  await page.locator('.rw button[aria-label="Pack the files in one ZIP"]').click();
  await page.waitForTimeout(400);
  const batchNote = await page.locator('.rw [data-batch-note]').textContent();
  const passesNote = await page.locator('.rw [data-passes-note]').textContent();
  const summary = await page.locator('.rw-summary').textContent();
  const chipsOn = await page.locator('.rw .chip[aria-pressed="true"]').allTextContents();
  await page.locator('.rw [data-passes-note]').scrollIntoViewIfNeeded();
  await page.mouse.move(10, 990);
  await page.screenshot({ path: join(SHOTS, 'batch-window.png') });
  check(
    'a_window_lists_the_batch',
    JSON.stringify(studioOptions) === JSON.stringify(['The scene as it is', 'Studio 1', 'Studio 2', 'All studios (2)']) &&
      batchNote.includes('Batch of 4 images') &&
      batchNote.includes('cameras 2 × studios 2') &&
      chipsOn.join() === 'Alpha,Depth,Part ID' &&
      passesNote.includes('_alpha.exr') &&
      passesNote.includes('_partId.json') &&
      summary.includes('4 images') &&
      summary.includes('3 passes') &&
      summary.includes('ZIP'),
    { studioOptions, batchNote, passesNote, summary, chipsOn },
  );

  // (b) Render: one download, a ZIP of 4 images and their passes.
  await page.locator('.rw-foot .btn-primary').click();
  await page.waitForFunction(() => document.querySelectorAll('.queue-row[data-status="DONE"]').length >= 4 || document.querySelector('.rv[data-ready="1"]'), null, { timeout: 600000 }).catch(() => undefined);
  // The window closed; the queue is where the progress is.
  await page.keyboard.press('Escape');
  const t0 = Date.now();
  while (downloads.length === 0 && Date.now() - t0 < 600000) await page.waitForTimeout(500);
  await page.waitForTimeout(800);
  const zipFile = downloads.find((d) => d.name.endsWith('.zip'));
  const others = downloads.filter((d) => !d.name.endsWith('.zip')).map((d) => d.name);
  const zipPath = join(OUT, 'batch-check.zip');
  if (zipFile) writeFileSync(zipPath, zipFile.bytes);
  const unzipRun = zipFile ? spawnSync('unzip', ['-t', zipPath]) : null;
  const files = zipFile ? readZip(zipFile.bytes) : new Map();
  const names = [...files.keys()];
  const images = ['Camera 1', 'Camera 2'].flatMap((c) => ['Studio 1', 'Studio 2'].map((s) => `Untitled_${c}_${s}.png`));
  const expected = images.flatMap((n) => [n, n.replace('.png', '_alpha.exr'), n.replace('.png', '_depth.exr'), n.replace('.png', '_partId.exr'), n.replace('.png', '_partId.json')]);
  const pics = images.map((n) => (files.has(n) ? decodePng8(files.get(n)) : null));
  const differ = (a, b) => {
    let n = 0;
    for (let i = 0; i < a.data.length; i++) if (a.data[i] !== b.data[i]) n++;
    return n;
  };
  const studioDiff = pics[0] && pics[1] ? differ(pics[0], pics[1]) : 0;
  const cameraDiff = pics[0] && pics[2] ? differ(pics[0], pics[2]) : 0;
  check(
    'b_one_zip_of_the_batch',
    downloads.length === 1 &&
      Boolean(zipFile) &&
      /^Untitled_0001-0004\.zip$/.test(zipFile.name) &&
      unzipRun?.status === 0 &&
      JSON.stringify([...names].sort()) === JSON.stringify([...expected].sort()) &&
      names.length === 20 &&
      studioDiff > 100 &&
      cameraDiff > 100,
    { downloads: downloads.map((d) => d.name), zip: zipFile?.name, bytes: zipFile?.bytes.length, unzip: unzipRun?.stdout.toString().trim().split('\n').pop(), files: names.length, studioDiff, cameraDiff, others },
  );

  // (b2) Each pass read by the specification.
  const exrOf = (n) => readExr(files.get(n));
  const a0 = exrOf(images[0].replace('.png', '_alpha.exr'));
  const d0 = exrOf(images[0].replace('.png', '_depth.exr'));
  const p0 = exrOf(images[0].replace('.png', '_partId.exr'));
  const legend = JSON.parse(files.get(images[0].replace('.png', '_partId.json')).toString('utf8'));
  const alpha = a0.planes.A;
  const depth = d0.planes.Z;
  const ids = p0.planes.Y;
  const size = pics[0];
  const soft = Array.from(alpha).filter((v) => v > 0 && v < 1).length;
  const idSet = [...new Set(ids)].sort((x, y) => x - y);
  const legendIds = legend.parts.map((p) => p.id);
  check(
    'b2_passes_by_the_specification',
    a0.names.join() === 'A' &&
      d0.names.join() === 'Z' &&
      p0.names.join() === 'Y' &&
      a0.width === size.width &&
      a0.height === size.height &&
      Array.from(alpha).every((v) => v >= 0 && v <= 1) &&
      alpha.includes(0) &&
      alpha.includes(1) &&
      soft > 20 &&
      depth.includes(Infinity) &&
      Array.from(depth).some((v) => Number.isFinite(v) && v > 0) &&
      // Where the alpha is 1 there is a surface (a finite depth); where it is 0 there is no part.
      Array.from(alpha).every((a, i) => (a === 1 ? Number.isFinite(depth[i]) : true)) &&
      ids.every(Number.isInteger) &&
      idSet[0] === 0 &&
      idSet.filter((v) => v > 0 && v < 65535).every((v) => legendIds.includes(v)) &&
      legend.format === 'repackshot-part-ids' &&
      legend.floor === 65535 &&
      legend.parts.every((p) => typeof p.part === 'string' && p.part.length > 0),
    { size: `${a0.width}x${a0.height}`, soft, ids: idSet.slice(0, 8), legend: legend.parts.slice(0, 4) },
  );

  // (c) The queue and the history.
  await page.keyboard.press('Escape');
  if ((await page.locator('.queue').count()) === 0) await page.locator('.drawer-btn[data-drawer="queue"]').click();
  await page.waitForSelector('.queue-row');
  await page.waitForTimeout(500);
  const rows = await page.locator('.queue-row').evaluateAll((els) => els.map((e) => ({ status: e.dataset.status, text: e.textContent.replace(/\s+/g, ' ').trim() })));
  const history = await page.locator('.history-item').count();
  await page.screenshot({ path: join(SHOTS, 'batch-queue.png') });
  check(
    'c_queue_and_history',
    rows.length === 4 &&
      rows.every((r) => r.status === 'DONE') &&
      ['Camera 1 · Studio 1', 'Camera 1 · Studio 2', 'Camera 2 · Studio 1', 'Camera 2 · Studio 2'].every((s, i) => rows[i].text.includes(s)) &&
      rows.every((r) => r.text.includes('+3 passes') && r.text.includes('ZIP')) &&
      history === 4,
    { rows: rows.map((r) => r.text.slice(0, 90)), history },
  );
  // Clear what is done, so the next ones are alone.
  await page.locator('.queue-head .btn', { hasText: 'Clear finished' }).click();

  // (d) One image, the passes as 16-bit PNG, no ZIP: separate downloads (alpha and depth stay on, normals on, part ids off).
  downloads.length = 0;
  await page.keyboard.press('Control+Enter');
  await page.waitForSelector('.rw');
  await page.locator('.rw select[aria-label="Camera"]').selectOption('ACTIVE');
  await page.locator('.rw select[aria-label="Studio"]').selectOption('CURRENT');
  await page.locator('.rw button[aria-label="Pack the files in one ZIP"]').click();
  await page.locator('.rw .chip[data-pass="normal"]').click();
  await page.locator('.rw .chip[data-pass="partId"]').click();
  await seg(page, 'PNG 16-bit').click();
  await page.locator('.rw-name').fill('pass_{n}');
  await page.locator('.rw-name').press('Enter');
  const summary16 = await page.locator('.rw-summary').textContent();
  await page.locator('.rw-foot .btn-primary').click();
  const t1 = Date.now();
  while (downloads.length < 4 && Date.now() - t1 < 600000) await page.waitForTimeout(500);
  await page.waitForTimeout(500);
  const byName = new Map(downloads.map((d) => [d.name, d.bytes]));
  const stem = downloads.find((d) => /^pass_\d+\.png$/.test(d.name))?.name.replace('.png', '');
  const alpha16 = stem && byName.has(`${stem}_alpha.png`) ? decodePng16(byName.get(`${stem}_alpha.png`)) : null;
  const depth16 = stem && byName.has(`${stem}_depth.png`) ? decodePng16(byName.get(`${stem}_depth.png`)) : null;
  const normal16 = stem && byName.has(`${stem}_normal.png`) ? decodePng16(byName.get(`${stem}_normal.png`)) : null;
  const img8 = stem ? decodePng8(byName.get(`${stem}.png`)) : null;
  const depthText = depth16?.text.find((t) => t[0] === 'Depth range')?.[1] ?? '';
  const range = /near=([\d.e+-]+) far=([\d.e+-]+)/.exec(depthText);
  let alphaFull = 0;
  let consistent = true;
  if (alpha16 && depth16) {
    for (let i = 0; i < alpha16.words.length; i++) {
      if (alpha16.words[i] === 65535) alphaFull++;
      // Covered means a surface: never the depth map's 0 (background).
      if (alpha16.words[i] === 65535 && depth16.words[i] === 0) consistent = false;
    }
  }
  const normalOk = normal16 ? new Set(normal16.words).size > 50 : false;
  check(
    'd_passes_as_png16_without_zip',
    downloads.length === 4 &&
      !downloads.some((d) => d.name.endsWith('.zip')) &&
      [`${stem}.png`, `${stem}_alpha.png`, `${stem}_depth.png`, `${stem}_normal.png`].every((n) => byName.has(n)) &&
      Boolean(alpha16 && depth16 && normal16 && img8) &&
      alpha16.channels === 1 &&
      depth16.channels === 1 &&
      normal16.channels === 3 &&
      [alpha16, depth16, normal16].every((p) => p.width === img8.width && p.height === img8.height && p.hasPhys) &&
      alphaFull > 100 &&
      alpha16.words.includes(0) &&
      new Set(alpha16.words).size > 3 &&
      consistent &&
      Boolean(range) &&
      Number(range[1]) > 0 &&
      Number(range[2]) > Number(range[1]) &&
      depth16.words.includes(0) &&
      depth16.words.includes(65535) &&
      normalOk &&
      summary16.includes('3 passes') &&
      !summary16.includes('ZIP'),
    { files: downloads.map((d) => d.name), size: img8 && `${img8.width}x${img8.height}`, alphaFull, depthRange: range?.slice(1, 3), distinctAlphaWords: alpha16 && new Set(alpha16.words).size, summary16 },
  );
  await page.keyboard.press('Escape');

  // (e) Cancelling the second of three leaves the third.
  downloads.length = 0;
  await page.locator('.queue-head .btn', { hasText: 'Clear finished' }).click().catch(() => undefined);
  await page.keyboard.press('Control+Enter');
  await page.waitForSelector('.rw');
  await page.locator('.rw .chip[aria-pressed="true"]').evaluateAll((els) => els.forEach((e) => e.click()));
  await setNumber(page, '.rw .num[aria-label="Samples"]', 64);
  await page.locator('.rw-name').fill('cancel_{n}');
  await page.locator('.rw-name').press('Enter');
  for (let i = 0; i < 3; i++) await page.locator('.rw-foot .btn', { hasText: 'Add to queue' }).click();
  await page.keyboard.press('Escape');
  if ((await page.locator('.queue').count()) === 0) await page.locator('.drawer-btn[data-drawer="queue"]').click();
  await page.waitForSelector('.queue-row');
  await page.locator('.queue-head .btn-primary').click();
  await page.waitForFunction(() => document.querySelectorAll('.queue-row')[0]?.dataset.status === 'DONE' && document.querySelectorAll('.queue-row')[1]?.dataset.status === 'RUNNING', null, { timeout: 300000 });
  await page.locator('.queue-row').nth(1).locator('button[aria-label="Stop this job"]').click();
  await page.waitForFunction(() => document.querySelectorAll('.queue-row')[2]?.dataset.status === 'DONE', null, { timeout: 300000 });
  const finalRows = await page.locator('.queue-row').evaluateAll((els) => els.map((e) => e.dataset.status));
  check('e_cancel_the_second_leaves_the_third', finalRows.join() === 'DONE,CANCELLED,DONE' && downloads.map((d) => d.name).join() === 'cancel_0005.png,cancel_0007.png', { finalRows, downloads: downloads.map((d) => d.name) });

  // (f) The page raised nothing.
  results.errors = errors;
  check('f_no_page_errors', errors.length === 0, { errors });
  writeFileSync(join(OUT, 'batch-check.json'), JSON.stringify(results, null, 2));
} finally {
  if (browser) await browser.close();
  if (server) stopServer();
}
if (failed > 0) {
  console.error(`${failed} check(s) failed`);
  process.exit(1);
}
