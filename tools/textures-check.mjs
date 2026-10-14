#!/usr/bin/env node
// Browser checks of phase M2a (image textures and labels in Fast mode) in the built app, with the local Chromium and
// swiftshader.
//
//   npm run build && node tools/textures-check.mjs [--url http://localhost:4194] [--shots docs/ui]
//
// Without --url it serves dist/ with `vite preview` on port 4194 and stops it at the end (by the pids `lsof` reports).
// The fixtures are made by tools/texture-fixtures.mjs (no binary images in the repository).
//
//   glb        a GLB with the four maps of the M2a criterion (colour with alpha cut-out, metallic-roughness, normal,
//              emission; occlusion reported) imports through Import model…: the sheet's Textures section says 4 images
//              kept and the occlusion map left out, the material's inspector shows the slots, and the Fast preview
//              draws them (the four colour quadrants of the image are on screen, the emission ring glows, no shader
//              error in the console). A reference picture of the same file with three.js' own glTF loader and
//              MeshStandardMaterial (the viewer most glTF tools are built on) is taken with the same camera, for the
//              eye: docs/ui/textures-reference.png next to docs/ui/textures-fast.png.
//   box        a Box primitive with a checker image in Colour and Box projection shows the checker square on its three
//              visible faces (the cells of each face are as wide as they are tall on screen, within the perspective),
//              and Undo takes the projection back.
//   label      on the example bottle, Add label… with an image, a press on the body and a drag lays a label there: one
//              undo entry, the inspector lists it, the pixels under the press turn to the label's dark card, and Move
//              label slides it.
//   chrome     the Textures section and the sheet are achromatic (every computed colour of their elements has r = g = b,
//              but the image previews), in both themes.
//
// Screenshots (docs/ui): textures-fast.png, textures-reference.png, textures-inspector.png, box-projection.png,
// label-placed.png. Results: out/textures-check.json.

import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkerImage, labelImage, texturedDae, texturedGlb } from './texture-fixtures.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4194;
const REF_PORT = 4195;
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const SHOTS = resolve(ROOT, opt('shots', 'docs/ui'));
const OUT = join(ROOT, 'out');
const FIX = join(OUT, 'texture-fixtures');
mkdirSync(OUT, { recursive: true });
mkdirSync(SHOTS, { recursive: true });
mkdirSync(FIX, { recursive: true });
const results = {};
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

function stopServer(port) {
  const run = spawnSync('lsof', ['-t', '-i', `:${port}`]);
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

let BASE_URL = opt('url', null);

async function open(browser, query) {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    const text = m.text();
    if ((m.type() === 'error' && !text.startsWith('Failed to load resource')) || /Shader Error|WebGLProgram/.test(text)) errors.push(text);
  });
  await page.goto(`${BASE_URL}/?${query}`);
  await page.waitForSelector('#app[data-ready="1"]', { timeout: 60000 });
  return { page, context, errors };
}

const settle = (page, ms = 60) => page.evaluate((wait) => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, wait)))), ms);
const ok = (cond, text, failures) => {
  if (!cond) failures.push(text);
  return cond;
};
const canvasBox = (page) => page.locator('canvas[aria-label="viewport"]').boundingBox();

/** Pixels of a screenshot at points (page coordinates), as [r, g, b]. */
async function pixels(page, points) {
  const png = (await page.screenshot()).toString('base64');
  return page.evaluate(
    async ({ png, points }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${png}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const g = c.getContext('2d');
      g.drawImage(img, 0, 0);
      return points.map(([x, y]) => [...g.getImageData(Math.round(x), Math.round(y), 1, 1).data.slice(0, 3)]);
    },
    { png, points },
  );
}

/** Counts of the viewport's pixels by hue family inside a box (page coordinates): red, green, blue, warm (emission). */
async function hues(page, box) {
  const png = (await page.screenshot({ clip: box })).toString('base64');
  return page.evaluate(async (png) => {
    const img = new Image();
    img.src = `data:image/png;base64,${png}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    const out = { red: 0, green: 0, blue: 0, warm: 0, total: d.length / 4 };
    for (let i = 0; i < d.length; i += 4) {
      const [r, gg, b] = [d[i], d[i + 1], d[i + 2]];
      const max = Math.max(r, gg, b);
      const min = Math.min(r, gg, b);
      if (max - min < 40) continue;
      if (r === max && gg < r * 0.5 && b < r * 0.5) out.red++;
      else if (gg === max && r < gg * 0.75 && b < gg * 0.75) out.green++;
      else if (b === max && r < b * 0.75 && gg < b * 0.9) out.blue++;
      if (r === max && gg > r * 0.5 && gg < r * 0.9 && b < r * 0.5) out.warm++;
    }
    return out;
  }, png);
}

/** Every element under `selector` whose computed colours are not grey (images and canvases left out). */
const chromatic = (page, selector) =>
  page.evaluate((selector) => {
    const bad = [];
    const grey = (c) => {
      const m = /rgba?\(([^)]+)\)/.exec(c);
      if (!m) return true;
      const [r, g, b, a] = m[1].split(',').map((x) => Number(x.trim()));
      return a === 0 || (r === g && g === b);
    };
    for (const root of document.querySelectorAll(selector)) {
      for (const el of [root, ...root.querySelectorAll('*')]) {
        if (el.tagName === 'IMG' || el.tagName === 'CANVAS') continue;
        const s = getComputedStyle(el);
        for (const p of ['color', 'backgroundColor', 'borderTopColor', 'borderBottomColor', 'outlineColor']) if (!grey(s[p])) bad.push(`${el.className || el.tagName}: ${p} ${s[p]}`);
      }
    }
    return bad.slice(0, 10);
  }, selector);

/** Imports a file through Import model… (the browser's file input) and presses Import on the sheet. */
async function importFile(page, files, { screenshot } = {}) {
  const chooser = page.waitForEvent('filechooser', { timeout: 30000 });
  await page.getByRole('button', { name: /Import model/ }).first().click();
  await (await chooser).setFiles(files);
  await page.waitForSelector('[data-import-sheet]', { timeout: 60000 });
  await settle(page, 200);
  const sheet = await page.evaluate(() => ({
    kept: document.querySelector('[data-import-textures-kept]')?.getAttribute('data-import-textures-kept') ?? null,
    text: document.querySelector('[data-import-textures]')?.textContent ?? '',
  }));
  if (screenshot) await page.locator('[data-import-sheet]').screenshot({ path: screenshot });
  await page.getByRole('button', { name: /^Import$/ }).click();
  await page.waitForFunction(() => document.querySelectorAll('.tree-row').length > 0, null, { timeout: 60000 });
  await settle(page, 300);
  return sheet;
}

/** Selects the tree row with this name. */
async function pickRow(page, name) {
  await page.locator('.tree-row', { has: page.locator('.tree-name', { hasText: new RegExp(`^${name}$`) }) }).first().click();
  await settle(page, 150);
}

/** Waits until the viewport has drawn for a while (textures decode asynchronously). */
const rest = (page, ms = 800) => settle(page, ms);

/** A static server for the reference page: three.js from node_modules and the fixture. */
function referenceServer(glb) {
  const page = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#202020}canvas{display:block}</style>
<script type="importmap">{"imports":{"three":"/three/build/three.module.js","three/addons/":"/three/examples/jsm/"}}</script></head><body>
<script type="module">
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
const w = 900, h = 700;
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(w, h);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x202020);
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
const camera = new THREE.PerspectiveCamera(30, w / h, 0.01, 100);
camera.position.set(0.22, 0.17, 0.3);
camera.lookAt(0, 0, 0);
new GLTFLoader().load('/fixture.glb', (g) => {
  scene.add(g.scene);
  setTimeout(() => { renderer.render(scene, camera); document.body.dataset.ready = '1'; }, 500);
});
</script></body></html>`;
  const three = join(ROOT, 'node_modules', 'three');
  const server = createServer((req, res) => {
    const url = decodeURIComponent((req.url ?? '/').split('?')[0]);
    if (url === '/' || url === '/index.html') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(page);
    } else if (url === '/fixture.glb') {
      res.writeHead(200, { 'content-type': 'model/gltf-binary' });
      res.end(Buffer.from(glb));
    } else if (url.startsWith('/three/') && !url.includes('..')) {
      const file = join(three, url.slice('/three/'.length));
      if (!existsSync(file)) {
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(200, { 'content-type': file.endsWith('.js') ? 'text/javascript' : 'application/octet-stream' });
      res.end(readFileSync(file));
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  return new Promise((resolveServer) => server.listen(REF_PORT, () => resolveServer(server)));
}

async function glbCheck(browser) {
  const f = [];
  const log = {};
  const { glb } = texturedGlb();
  const file = join(FIX, 'textured-box.glb');
  writeFileSync(file, glb);
  const { page, context, errors } = await open(browser, 'theme=dark&lang=en&mode=fast');
  const sheet = await importFile(page, file, { screenshot: join(OUT, 'textures-sheet.png') });
  log.sheet = sheet;
  ok(sheet.kept === '4', `the sheet does not say 4 images kept: ${JSON.stringify(sheet)}`, f);
  ok(/occlusion/i.test(sheet.text), `the sheet does not report the occlusion map: ${sheet.text}`, f);
  // Select the part: the inspector's Textures section lists the six slots, five with an image (alpha from the colour's A).
  await pickRow(page, 'Box');
  const slots = await page.evaluate(() => [...document.querySelectorAll('[data-texture-slot]')].map((e) => `${e.getAttribute('data-texture-slot')}:${e.classList.contains('has-image') ? 1 : 0}`));
  log.slots = slots;
  ok(slots.join(',') === 'color:1,roughness:1,metal:1,normal:1,alpha:1,emission:1', `the slots are ${slots.join(',')}`, f);
  await page.locator('[data-section="textures"]').screenshot({ path: join(SHOTS, 'textures-inspector.png') }).catch(() => {});
  // Deselect so no outline sits over the picture, frame, and let the textures decode.
  await page.locator('canvas[aria-label="viewport"]').focus();
  await page.keyboard.press('Escape');
  await page.mouse.move(5, 500);
  await rest(page, 1500);
  const cb = await canvasBox(page);
  const box = { x: Math.round(cb.x + cb.width * 0.25), y: Math.round(cb.y + cb.height * 0.15), width: Math.round(cb.width * 0.5), height: Math.round(cb.height * 0.7) };
  await page.screenshot({ path: join(SHOTS, 'textures-fast.png'), clip: box });
  const h = await hues(page, box);
  log.hues = h;
  ok(h.red > 200 && h.green > 200 && h.blue > 200, `the colour quadrants are not all on screen: ${JSON.stringify(h)}`, f);
  ok(h.warm > 20, `the emission ring does not show: ${JSON.stringify(h)}`, f);
  ok(errors.length === 0, `errors in the page: ${errors.join(' | ')}`, f);
  await context.close();

  // The reference: three.js' own glTF path on the same file.
  const server = await referenceServer(glb);
  try {
    const ctx = await browser.newContext({ viewport: { width: 900, height: 700 } });
    const ref = await ctx.newPage();
    const refErrors = [];
    ref.on('pageerror', (e) => refErrors.push(e.message));
    await ref.goto(`http://localhost:${REF_PORT}/`);
    await ref.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 60000 });
    await ref.screenshot({ path: join(SHOTS, 'textures-reference.png') });
    log.referenceHues = await hues(ref, { x: 0, y: 0, width: 900, height: 700 });
    ok(refErrors.length === 0, `errors in the reference page: ${refErrors.join(' | ')}`, f);
    await ctx.close();
  } finally {
    server.close();
  }
  results.glb = { ok: f.length === 0, failures: f, ...log };
  console.log(`glb: ${f.length === 0 ? 'OK' : `FAILED\n  - ${f.join('\n  - ')}`}`);
}

/**
 * A Collada file with its image beside it, through three's loader in the browser (the path FBX, 3MF, USD and 3DM
 * share): chosen together, the image comes in as the material's colour, with the file's own bytes.
 */
async function daeCheck(browser) {
  const f = [];
  const log = {};
  const { dae, image } = texturedDae();
  const daeFile = join(FIX, 'quad.dae');
  const pngFile = join(FIX, 'tex.png');
  writeFileSync(daeFile, dae);
  writeFileSync(pngFile, image);
  const { page, context, errors } = await open(browser, 'theme=dark&lang=en&mode=fast');
  const sheet = await importFile(page, [daeFile, pngFile]);
  log.sheet = sheet;
  ok(sheet.kept === '1', `the sheet does not say 1 image kept: ${JSON.stringify(sheet)}`, f);
  await pickRow(page, 'Quad');
  const slots = await page.evaluate(() => [...document.querySelectorAll('[data-texture-slot].has-image')].map((e) => e.getAttribute('data-texture-slot')));
  log.slots = slots;
  ok(slots.join(',') === 'color', `the slots with an image are ${slots.join(',')}`, f);
  ok(errors.length === 0, `errors in the page: ${errors.join(' | ')}`, f);
  await context.close();
  results.dae = { ok: f.length === 0, failures: f, ...log };
  console.log(`dae: ${f.length === 0 ? 'OK' : `FAILED\n  - ${f.join('\n  - ')}`}`);
}

/** The Textures section, its labels and the import sheet are achromatic in both themes (the images are not chrome). */
async function chromeCheck(browser) {
  const f = [];
  const log = {};
  const file = join(FIX, 'textured-box.glb');
  writeFileSync(file, texturedGlb().glb);
  const label = join(FIX, 'label.png');
  writeFileSync(label, labelImage(96, 64));
  for (const theme of ['dark', 'light']) {
    const { page, context, errors } = await open(browser, `theme=${theme}&lang=es&mode=fast`);
    const chooser = page.waitForEvent('filechooser', { timeout: 30000 });
    await page.getByRole('button', { name: /Importar modelo/ }).first().click();
    await (await chooser).setFiles(file);
    await page.waitForSelector('[data-import-sheet]', { timeout: 60000 });
    await settle(page, 200);
    log[`${theme}Sheet`] = await chromatic(page, '[data-import-sheet]');
    ok(log[`${theme}Sheet`].length === 0, `${theme}: the sheet has colour: ${log[`${theme}Sheet`].join(' | ')}`, f);
    await page.getByRole('button', { name: /^Importar$/ }).click();
    await page.waitForFunction(() => document.querySelectorAll('.tree-row').length > 0, null, { timeout: 60000 });
    await pickRow(page, 'Box');
    // A label, so its row is in the section too (the tool starts; Esc leaves it).
    const lc = page.waitForEvent('filechooser', { timeout: 30000 });
    await page.locator('[data-label-add]').click();
    await (await lc).setFiles(label);
    await settle(page, 200);
    log[`${theme}Section`] = await chromatic(page, '[data-section="textures"], [data-label-tool]');
    ok(log[`${theme}Section`].length === 0, `${theme}: the Textures section has colour: ${log[`${theme}Section`].join(' | ')}`, f);
    // Spanish: the section speaks it (its title and its slots).
    const text = await page.locator('[data-section="textures"]').textContent();
    ok(/Texturas/.test(text) && /Rugosidad/.test(text) && /Etiquetas/.test(text), `${theme}: the section is not in Spanish: ${text.slice(0, 120)}`, f);
    if (theme === 'light') await page.locator('[data-section="textures"]').screenshot({ path: join(SHOTS, 'textures-inspector-light.png') }).catch(() => {});
    await page.keyboard.press('Escape');
    ok(errors.length === 0, `${theme}: errors in the page: ${errors.join(' | ')}`, f);
    await context.close();
  }
  results.chrome = { ok: f.length === 0, failures: f, ...log };
  console.log(`chrome: ${f.length === 0 ? 'OK' : `FAILED\n  - ${f.join('\n  - ')}`}`);
}

/** Header menu ▸ Add ▸ Primitive ▸ <name>. */
async function addPrimitive(page, name) {
  await page.click('[data-add="primitive"]');
  await settle(page);
  await page.locator('.floating .menu-item', { hasText: new RegExp(`^${name}$`) }).click();
  await settle(page, 300);
}

/** Loads an image file into a slot of the selected material through its Load… button. */
async function loadSlot(page, slot, file) {
  const chooser = page.waitForEvent('filechooser', { timeout: 30000 });
  await page.locator(`[data-texture-load="${slot}"]`).click();
  await (await chooser).setFiles(file);
  await page.waitForSelector(`[data-texture-slot="${slot}"].has-image`, { timeout: 30000 });
  await settle(page, 200);
}

async function boxCheck(browser) {
  const f = [];
  const log = {};
  const checker = join(FIX, 'checker.png');
  writeFileSync(checker, checkerImage(256, 4));
  const { page, context, errors } = await open(browser, 'theme=dark&lang=en&mode=fast');
  await addPrimitive(page, 'Box');
  await pickRow(page, 'Box');
  await loadSlot(page, 'color', checker);
  await page.locator('[data-texture-mapping] select').first().selectOption('BOX');
  await settle(page, 200);
  log.projection = await page.locator('[data-texture-mapping] select').first().inputValue();
  ok(log.projection === 'BOX', `the projection is ${log.projection}`, f);
  // Look at three faces: the Orbit tool (O), a drag up and to the side, then frame it (F) and back to Select.
  await page.locator('canvas[aria-label="viewport"]').focus();
  await page.keyboard.press('Escape');
  await page.keyboard.press('o');
  const cb = await canvasBox(page);
  await page.mouse.move(cb.x + cb.width * 0.5, cb.y + cb.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(cb.x + cb.width * 0.6, cb.y + cb.height * 0.56, { steps: 12 });
  await page.mouse.up();
  await page.keyboard.press('f');
  await page.keyboard.press('v');
  await page.mouse.move(5, 500);
  await rest(page, 1500);
  const shot = { x: Math.round(cb.x + cb.width * 0.2), y: Math.round(cb.y + cb.height * 0.1), width: Math.round(cb.width * 0.6), height: Math.round(cb.height * 0.8) };
  await page.screenshot({ path: join(SHOTS, 'box-projection.png'), clip: shot });
  ok(errors.length === 0, `errors in the page: ${errors.join(' | ')}`, f);
  await context.close();
  results.box = { ok: f.length === 0, failures: f, ...log };
  console.log(`box: ${f.length === 0 ? 'OK' : `FAILED\n  - ${f.join('\n  - ')}`}`);
}

async function labelCheck(browser) {
  const f = [];
  const log = {};
  const label = join(FIX, 'label.png');
  writeFileSync(label, labelImage(192, 128));
  const { page, context, errors } = await open(browser, 'example=1&theme=dark&lang=en&mode=fast');
  await pickRow(page, 'Body');
  const chooser = page.waitForEvent('filechooser', { timeout: 30000 });
  await page.locator('[data-label-add]').click();
  await (await chooser).setFiles(label);
  await page.waitForSelector('[data-label-tool]:not([style*="none"])', { timeout: 30000 });
  await page.locator('canvas[aria-label="viewport"]').focus();
  const cb = await canvasBox(page);
  const at = { x: cb.x + cb.width * 0.5, y: cb.y + cb.height * 0.52 };
  const before = await pixels(page, [[at.x, at.y]]);
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(at.x + cb.width * 0.06, at.y, { steps: 6 });
  await page.mouse.up();
  await page.mouse.move(5, 500);
  await rest(page, 1200);
  const after = await pixels(page, [[at.x, at.y]]);
  log.before = before[0];
  log.after = after[0];
  const rows = await page.evaluate(() => document.querySelectorAll('[data-label]').length);
  ok(rows === 1, `the inspector lists ${rows} labels`, f);
  // The label's centre is its red band: the bottle's dark blue there turns red.
  ok(after[0][0] - before[0][0] > 50 && after[0][0] > after[0][2] + 40, `the pixels under the press did not change to the label: ${JSON.stringify(log)}`, f);
  const undoTip = await page.locator('.hdr button[aria-label="Undo"]').getAttribute('data-tip');
  log.undo = undoTip;
  ok(/label/i.test(undoTip ?? ''), `the undo does not name the label: ${undoTip}`, f);
  const shot = { x: Math.round(cb.x + cb.width * 0.25), y: Math.round(cb.y + cb.height * 0.05), width: Math.round(cb.width * 0.5), height: Math.round(cb.height * 0.9) };
  await page.screenshot({ path: join(SHOTS, 'label-placed.png'), clip: shot });
  // Move label: a drag on the body slides it up; the pixel it left is the bottle's again, one undo entry.
  await page.locator('[data-label-move]').first().click();
  await settle(page, 150);
  const to = { x: at.x, y: at.y - cb.height * 0.08 };
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.press('Escape');
  await page.mouse.move(5, 500);
  await rest(page, 900);
  const moved = await pixels(page, [[at.x, at.y], [to.x, to.y]]);
  log.moved = moved;
  ok(Math.abs(moved[0][0] - before[0][0]) < 40 && moved[1][0] > moved[1][2] + 40, `Move label did not slide the label: ${JSON.stringify(moved)}`, f);
  const tipMove = await page.locator('.hdr button[aria-label="Undo"]').getAttribute('data-tip');
  ok(/Move label/.test(tipMove ?? ''), `the undo does not name the move: ${tipMove}`, f);
  // Undo the move, then the placing: one entry each; the label is gone.
  await page.locator('canvas[aria-label="viewport"]').focus();
  await page.keyboard.press('Control+z');
  await settle(page, 150);
  await page.keyboard.press('Control+z');
  await settle(page, 300);
  const left = await page.evaluate(() => document.querySelectorAll('[data-label]').length);
  ok(left === 0, `two undos left ${left} labels`, f);
  ok(errors.length === 0, `errors in the page: ${errors.join(' | ')}`, f);
  await context.close();
  results.label = { ok: f.length === 0, failures: f, ...log };
  console.log(`label: ${f.length === 0 ? 'OK' : `FAILED\n  - ${f.join('\n  - ')}`}`);
}

let server = null;
let browser = null;
try {
  if (!existsSync(join(ROOT, 'dist', 'index.html'))) fail('dist/ is missing: npm run build first');
  if (!BASE_URL) {
    stopServer(PORT);
    server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: 'ignore', detached: true });
    BASE_URL = `http://localhost:${PORT}`;
  }
  await waitFor(BASE_URL);
  const { chromium } = await import('playwright-core');
  browser = await chromium.launch({ executablePath: findChromium(), headless: true, args: ['--no-sandbox', '--disable-gpu', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const only = opt('only', 'glb,dae,box,label,chrome').split(',');
  if (only.includes('glb')) await glbCheck(browser);
  if (only.includes('dae')) await daeCheck(browser);
  if (only.includes('box')) await boxCheck(browser);
  if (only.includes('label')) await labelCheck(browser);
  if (only.includes('chrome')) await chromeCheck(browser);
  writeFileSync(join(OUT, 'textures-check.json'), JSON.stringify(results, null, 2));
  const all = Object.values(results).every((r) => r.ok);
  console.log(all ? 'all checks passed' : 'SOME CHECKS FAILED');
  process.exitCode = all ? 0 : 1;
} catch (err) {
  console.error(err?.stack ?? err);
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
  if (server) stopServer(PORT);
}
