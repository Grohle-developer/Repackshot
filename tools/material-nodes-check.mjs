#!/usr/bin/env node
// Browser checks of phase M3a (the material editor by nodes and its Fast preview) in the built app, with the local
// Chromium and swiftshader.
//
//   npm run build && node tools/material-nodes-check.mjs [--url http://localhost:4237] [--shots docs/ui] [--only edit,marble,chrome]
//
// Without --url it serves dist/ with `vite preview` on port 4237 and stops it at the end (by the pids `lsof` reports).
//
//   edit     on the example bottle, the body's Nodes… opens the material editor on its minimal graph (the output node
//            alone); Add node with a search adds a Noise; a drag from its colour to the output's normal is refused and
//            says why; a drag from its colour to the base colour connects them (one undo entry that names it); the
//            Fast preview of the body changes once the bake is in (pixels of the body before and after); Ctrl Z takes
//            the link back and the body is as it was; Delete removes the node, Ctrl D duplicates one.
//   marble   Examples ▸ Marble lays the ten-node graph, the node previews arrive, the bakes finish, and the editor and
//            the bottle in Fast are captured: docs/ui/material-nodes.png and docs/ui/material-nodes-preview.png.
//   chrome   the editor's chrome is achromatic in both themes (every computed colour of its elements has r = g = b,
//            but the previews, the colour swatches and the ramp's bar, which are content).
//
// Results: out/material-nodes-check.json.

import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4237;
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
  await page.waitForSelector('#app[data-ready="1"]', { timeout: 120000 });
  return { page, context, errors };
}

const settle = (page, ms = 60) => page.evaluate((wait) => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, wait)))), ms);
const ok = (cond, text, failures) => {
  if (!cond) failures.push(text);
  return cond;
};
const canvasBox = (page) => page.locator('canvas[aria-label="viewport"]').boundingBox();

/** The mean colour of a box of the screen (page coordinates). */
async function meanColour(page, box) {
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
    const s = [0, 0, 0];
    for (let i = 0; i < d.length; i += 4) for (let k = 0; k < 3; k++) s[k] += d[i + k];
    const n = d.length / 4;
    return s.map((x) => Math.round(x / n));
  }, png);
}

/** Every element under `selector` whose computed colours are not grey (images, canvases, swatches and the ramp's bar left out). */
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
        if (el.tagName === 'IMG' || el.tagName === 'CANVAS' || el.classList.contains('ge-swatch') || el.tagName === 'INPUT' && el.type === 'color') continue;
        const s = getComputedStyle(el);
        for (const p of ['color', 'backgroundColor', 'borderTopColor', 'borderBottomColor', 'outlineColor']) if (!grey(s[p])) bad.push(`${el.className || el.tagName}: ${p} ${s[p]}`);
      }
    }
    return bad.slice(0, 10);
  }, selector);

/** Waits until the viewport has no bake under way (the Fast preview's graph maps are in). */
async function bakesDone(page, ms = 240000) {
  await page.waitForFunction(() => (document.querySelector('canvas[aria-label="viewport"]')?.dataset.graphBakes ?? '0') === '0', null, { timeout: ms });
  await settle(page, 600);
}

async function pickRow(page, name) {
  await page.locator('.tree-row', { has: page.locator('.tree-name', { hasText: new RegExp(`^${name}$`) }) }).first().click();
  await settle(page, 200);
}

/** Opens the editor on the body of the example bottle. */
async function openEditor(page) {
  await pickRow(page, 'Body');
  await page.locator('[data-material-nodes]').click();
  await page.waitForSelector('[data-material-editor] .ge-node', { timeout: 30000 });
  await settle(page, 300);
}

/** A socket's centre (page coordinates). */
async function socketAt(page, node, dir, socket) {
  const b = await page.locator(`.ge-sock[data-node="${node}"][data-sock="${dir}"][data-socket="${socket}"]`).boundingBox();
  if (!b) fail(`no socket ${node}.${socket} (${dir})`);
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

async function dragFromTo(page, a, b) {
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 6 });
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await page.mouse.up();
  await settle(page, 150);
}

const undoTip = (page) => page.locator('.hdr button[aria-label="Undo"]').getAttribute('data-tip');
const graphLinks = (page) => page.evaluate(() => [...document.querySelectorAll('.ge-links path[data-link]')].map((p) => p.getAttribute('data-link')));
const nodeIds = (page) => page.evaluate(() => [...document.querySelectorAll('.ge-node')].map((n) => `${n.getAttribute('data-node')}:${n.getAttribute('data-type')}`));

/** A box on the bottle's body, in the viewport (page coordinates). */
async function bodyBox(page) {
  const cb = await canvasBox(page);
  return { x: Math.round(cb.x + cb.width * 0.44), y: Math.round(cb.y + cb.height * 0.47), width: Math.round(cb.width * 0.12), height: Math.round(cb.height * 0.2) };
}

async function editCheck(browser) {
  const f = [];
  const log = {};
  const { page, context, errors } = await open(browser, 'example=1&theme=dark&lang=en&mode=fast');
  await settle(page, 800);
  const box = await bodyBox(page);
  log.before = await meanColour(page, box);
  await openEditor(page);
  const first = await nodeIds(page);
  log.first = first;
  ok(first.length === 1 && /:OUTPUT$/.test(first[0]), `the editor did not open on the minimal graph: ${first}`, f);
  const out = first[0].split(':')[0];
  ok(/Edit .* with nodes/.test((await undoTip(page)) ?? ''), `the conversion is not one undo entry: ${await undoTip(page)}`, f);
  // Add node with a search.
  await page.locator('[data-ge-addnode]').click();
  await page.waitForSelector('[data-ge-add] input', { timeout: 10000 });
  await page.keyboard.type('noise');
  await page.keyboard.press('Enter');
  await settle(page, 300);
  const added = (await nodeIds(page)).find((x) => x.endsWith(':NOISE'));
  ok(!!added, 'Add node ▸ noise did not add a Noise', f);
  const noise = added?.split(':')[0] ?? 'n2';
  ok(/Add Noise/.test((await undoTip(page)) ?? ''), `adding is not one undo entry: ${await undoTip(page)}`, f);
  // A colour into a normal: refused, said.
  await dragFromTo(page, await socketAt(page, noise, 'out', 'color'), await socketAt(page, out, 'in', 'normal'));
  ok((await graphLinks(page)).length === 0, 'a colour into the normal was connected', f);
  const toast = await page.locator('.toast').last().textContent().catch(() => '');
  log.refusal = toast;
  ok(/cannot go into a normal/.test(toast ?? ''), `the refusal did not say why: ${toast}`, f);
  // Its colour into the base colour.
  await dragFromTo(page, await socketAt(page, noise, 'out', 'color'), await socketAt(page, out, 'in', 'baseColor'));
  log.links = await graphLinks(page);
  ok(log.links.length === 1 && log.links[0] === `${noise}.color>${out}.baseColor`, `the link is not there: ${log.links}`, f);
  ok(/Connect Noise to Material output · Base colour/.test((await undoTip(page)) ?? ''), `the undo does not name the link: ${await undoTip(page)}`, f);
  // The node previews arrive (a worker draws them).
  await page.waitForFunction(() => Number(document.querySelector('[data-material-editor]')?.dataset.previews ?? 0) > 0, null, { timeout: 60000 }).catch(() => f.push('no node previews arrived'));
  // The Fast preview changes once the bake is in (the editor out of the way).
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await bakesDone(page);
  log.connected = await meanColour(page, box);
  const moved = Math.max(...log.connected.map((c, i) => Math.abs(c - log.before[i])));
  ok(moved > 12, `the body did not change in Fast: ${JSON.stringify(log.before)} → ${JSON.stringify(log.connected)}`, f);
  // Undo takes the link back: the body is grey again.
  await page.locator('canvas[aria-label="viewport"]').focus();
  await page.keyboard.press('Control+z');
  await bakesDone(page);
  log.undone = await meanColour(page, box);
  const back = Math.max(...log.undone.map((c, i) => Math.abs(c - log.before[i])));
  ok(back <= 6, `undo did not bring the body back: ${JSON.stringify(log.before)} → ${JSON.stringify(log.undone)}`, f);
  // Keys of the editor: Ctrl D duplicates the selected node, Delete removes it.
  await openEditor(page);
  await page.locator(`.ge-node[data-node="${noise}"] .ge-head`).click();
  await page.keyboard.press('Control+d');
  await settle(page, 200);
  const dup = (await nodeIds(page)).filter((x) => x.endsWith(':NOISE')).length;
  ok(dup === 2, `Ctrl D did not duplicate the noise: ${dup}`, f);
  await page.keyboard.press('Delete');
  await settle(page, 200);
  const left = (await nodeIds(page)).filter((x) => x.endsWith(':NOISE')).length;
  ok(left === 1, `Delete did not remove the copy: ${left}`, f);
  ok(errors.length === 0, `errors in the page: ${errors.join(' | ')}`, f);
  await context.close();
  results.edit = { ok: f.length === 0, failures: f, ...log };
  console.log(`edit: ${f.length === 0 ? 'OK' : `FAILED\n  - ${f.join('\n  - ')}`}`);
}

async function marbleCheck(browser) {
  const f = [];
  const log = {};
  const { page, context, errors } = await open(browser, 'example=1&theme=dark&lang=en&mode=fast');
  await settle(page, 800);
  const box = await bodyBox(page);
  log.before = await meanColour(page, box);
  await openEditor(page);
  await page.locator('[data-ge-examples]').click();
  await page.locator('.menu-item', { hasText: /^Marble/ }).click();
  await settle(page, 400);
  const nodes = await nodeIds(page);
  log.nodes = nodes.length;
  ok(nodes.length === 10, `Marble laid ${nodes.length} nodes`, f);
  ok(/Example Marble on/.test((await undoTip(page)) ?? ''), `the example is not one undo entry: ${await undoTip(page)}`, f);
  const status = await page.locator('[data-ge-status]').textContent();
  log.status = status;
  ok(/10 nodes · 10 links · program of \d+ instructions/i.test(status ?? ''), `the status line: ${status}`, f);
  const fast = await page.locator('[data-ge-fast]').textContent();
  ok(/slice through the part’s front/.test(fast ?? ''), `the Fast note does not say how it draws a 3D noise: ${fast}`, f);
  await page.waitForFunction(() => Number(document.querySelector('[data-material-editor]')?.dataset.previews ?? 0) > 0, null, { timeout: 60000 }).catch(() => f.push('no node previews arrived'));
  await bakesDone(page);
  await settle(page, 600);
  await page.locator('.me').screenshot({ path: join(SHOTS, 'material-nodes.png') });
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await settle(page, 600);
  log.after = await meanColour(page, box);
  // Marble is lighter than the metallic paint it replaced.
  ok(log.after[0] > log.before[0] + 20, `the bottle did not turn to marble in Fast: ${JSON.stringify(log.before)} → ${JSON.stringify(log.after)}`, f);
  const cb = await canvasBox(page);
  await page.screenshot({ path: join(SHOTS, 'material-nodes-preview.png'), clip: { x: Math.round(cb.x + cb.width * 0.2), y: Math.round(cb.y + cb.height * 0.04), width: Math.round(cb.width * 0.6), height: Math.round(cb.height * 0.92) } });
  ok(errors.length === 0, `errors in the page: ${errors.join(' | ')}`, f);
  await context.close();
  results.marble = { ok: f.length === 0, failures: f, ...log };
  console.log(`marble: ${f.length === 0 ? 'OK' : `FAILED\n  - ${f.join('\n  - ')}`}`);
}

async function chromeCheck(browser) {
  const f = [];
  const log = {};
  for (const theme of ['dark', 'light']) {
    const { page, context, errors } = await open(browser, `example=1&theme=${theme}&lang=es&mode=fast`);
    await openEditor(page);
    await page.locator('[data-ge-examples]').click();
    await page.locator('.menu-item').nth(4).click();
    await settle(page, 400);
    await page.locator('.ge-node').nth(3).locator('.ge-head').click();
    await settle(page, 300);
    const bad = await chromatic(page, '.me');
    log[theme] = bad;
    ok(bad.length === 0, `${theme}: chromatic chrome in the editor: ${bad.join('; ')}`, f);
    const title = await page.locator('.me-title-text').textContent();
    ok(title === 'Editor de material', `${theme}: the title is not in Spanish: ${title}`, f);
    ok(errors.length === 0, `${theme}: errors in the page: ${errors.join(' | ')}`, f);
    await context.close();
  }
  results.chrome = { ok: f.length === 0, failures: f, ...log };
  console.log(`chrome: ${f.length === 0 ? 'OK' : `FAILED\n  - ${f.join('\n  - ')}`}`);
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
  const only = opt('only', 'edit,marble,chrome').split(',');
  if (only.includes('edit')) await editCheck(browser);
  if (only.includes('marble')) await marbleCheck(browser);
  if (only.includes('chrome')) await chromeCheck(browser);
  writeFileSync(join(OUT, 'material-nodes-check.json'), JSON.stringify(results, null, 2));
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
