#!/usr/bin/env node
// Browser check of phase K1 in the built app (the scene type, the Interior style of the light catalogue and the interior
// Doctor), with the local Chromium and swiftshader, in Fast mode.
//
//   npm run build && node tools/scene-type-check.mjs [--url http://localhost:4293] [--shots docs/ui]
//
// Without --url it serves dist/ with `vite preview` on port 4293 and stops it at the end.
//
//   control    the Product section has Scene type (Product, Interior, Catalogue) over Product type, Product pressed;
//   no control the inspector has the same controls (the same labels, switches and buttons) whatever the type: the type
//              changes values and removes nothing;
//   interior   choosing Interior is one undo step ("Scene type: Interior"), brings the Light section to the Interior style
//              with its seven recipes and their thumbnails, turns the contact shadow off and the view transform to AgX; the
//              Doctor lists its seven interior checks, which Product does not;
//   recipe     choosing Midday window is one undo step and sets the strength of the environment of the recipe;
//   back       choosing Product again puts the contact shadow and the view transform back, takes the Light section back to
//              All and the interior checks out of the Doctor; Catalogue leaves the contact shadow on and the view Standard.
//
// Screenshot (docs/ui): scene-type-interior.png (Interior in force with the Midday window recipe, the Product and Light sections).
// Results: out/scene-type-check.json.

import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4293;
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

/** What the inspector holds, as the person sees it: its section titles, field labels, switches, buttons and number fields. */
const controls = (page) =>
  page.evaluate(() => {
    const root = document.querySelector('[data-section="product"]')?.parentElement ?? document.body;
    const texts = (sel) => [...root.querySelectorAll(sel)].map((n) => (n.getAttribute('aria-label') || n.textContent || '').trim()).filter(Boolean);
    return {
      sections: texts('.section-head'),
      labels: texts('.field-label'),
      switches: root.querySelectorAll('[role="switch"]').length,
      buttons: texts('button.btn'),
      numbers: root.querySelectorAll('[role="spinbutton"], input[type="number"]').length,
    };
  });

/** The Product section's scene type, the Light section's style and recipes, and the state the type wrote. */
const state = (page) =>
  page.evaluate(() => {
    const product = document.querySelector('[data-section="product"]');
    const light = document.querySelector('[data-section="light"]');
    const seg = [...(product?.querySelectorAll('[data-guide="scene-type"] .seg button') ?? [])];
    const guides = [...(product?.querySelectorAll('[data-guide]') ?? [])].map((n) => n.getAttribute('data-guide'));
    // L7: the Lights group's style row.
    const chips = [...(light?.querySelectorAll('[data-filter="style"] .chip') ?? [])];
    const switches = [...(product?.querySelectorAll('.field') ?? [])].map((f) => [f.querySelector('.field-label')?.textContent ?? '', f.querySelector('[role="switch"]')?.getAttribute('aria-checked') ?? null]);
    const image = document.querySelector('[data-section="image"]');
    const vt = [...(image?.querySelectorAll('.seg button') ?? [])].find((b) => b.getAttribute('aria-pressed') === 'true')?.textContent ?? '';
    return {
      types: seg.map((b) => b.textContent),
      pressedType: seg.find((b) => b.getAttribute('aria-pressed') === 'true')?.textContent ?? '',
      tips: seg.map((b) => b.getAttribute('data-tip') ?? ''),
      order: guides,
      pressedStyle: chips.find((c) => c.getAttribute('aria-pressed') === 'true')?.textContent ?? '',
      styles: chips.map((c) => c.textContent),
      thumbs: [...(light?.querySelectorAll('.thumbs .thumb') ?? [])].map((t) => (t.textContent ?? '').trim()),
      shadow: switches.find(([l]) => l === 'Contact shadow')?.[1] ?? null,
      viewTransform: vt,
      undo: document.querySelector('.hdr button[aria-label="Undo"], .hdr button[aria-label="Deshacer"]')?.getAttribute('data-tip') ?? null,
      doctor: document.querySelector('.doctor-btn')?.textContent ?? '',
    };
  });

/** The right edge of the Scene type control against the one of the Product type next to it (it must not stick out of the column). */
const fit = (page) =>
  page.evaluate(() => {
    const seg = document.querySelector('[data-guide="scene-type"] .seg')?.getBoundingClientRect();
    const sel = document.querySelector('[data-guide="product-type"] select')?.getBoundingClientRect();
    const section = document.querySelector('[data-section="product"]')?.getBoundingClientRect();
    return seg && sel && section ? { seg: Math.round(seg.right), select: Math.round(sel.right), section: Math.round(section.right), width: Math.round(seg.width) } : null;
  });

/** The rows of the Doctor's popover (opened if it is not): title and whether it warns. */
const doctorRows = async (page) => {
  if (!(await page.locator('.doctor').count())) {
    await page.locator('.doctor-btn').first().click();
    await settle(page, 200);
  }
  return page.evaluate(() => [...document.querySelectorAll('.doctor .doctor-row')].map((r) => ({ title: r.querySelector('.doctor-title')?.textContent ?? '', warn: r.classList.contains('is-warn'), text: r.querySelector('.note')?.textContent ?? '' })));
};
const closeDoctor = async (page) => {
  if (await page.locator('.doctor').count()) {
    await page.keyboard.press('Escape');
    await settle(page, 150);
    if (await page.locator('.doctor').count()) {
      await page.locator('.doctor-btn').first().click();
      await settle(page, 150);
    }
  }
};

/** What the second list has that the first has not, and the other way round (for the message of a failure). */
const diff = (a, b) => {
  const out = [];
  for (const k of Object.keys(a)) {
    if (JSON.stringify(a[k]) === JSON.stringify(b[k])) continue;
    if (Array.isArray(a[k])) out.push(`${k}: -[${a[k].filter((x) => !b[k].includes(x))}] +[${b[k].filter((x) => !a[k].includes(x))}]`);
    else out.push(`${k}: ${a[k]} -> ${b[k]}`);
  }
  return out.join('; ');
};

const INTERIOR_ROWS = ['Scale and units', 'Opening for the sun and sky', 'Window glass', 'Lens too wide', 'Eye height', 'Near clipping', 'Wall normals'];
const RECIPES = ['Morning window', 'Midday window', 'Afternoon window', 'Overcast', 'Night lamps', 'Blue hour', 'White studio room'];

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
    const context = await browser.newContext({ viewport: { width: 1600, height: 1300 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && !m.text().startsWith('Failed to load resource') && errors.push(m.text()));
    await page.goto(`${BASE_URL}/?example=1&theme=dark&mode=fast&tour=0`);
    await page.waitForSelector('#app[data-ready="1"]', { timeout: 60000 });
    await settle(page, 400);

    // The control: three types over the product type, Product in force.
    let s = await state(page);
    log.start = s;
    ok(JSON.stringify(s.types) === JSON.stringify(['Product', 'Interior', 'Catalogue']), `Scene type offers Product, Interior and Catalogue: ${s.types.join(', ')}`, f);
    ok(s.pressedType === 'Product', `Product is in force: ${s.pressedType}`, f);
    ok(s.order.indexOf('scene-type') >= 0 && s.order.indexOf('scene-type') < s.order.indexOf('product-type'), `Scene type is over Product type: ${s.order.join(', ')}`, f);
    ok(s.tips.every((t) => t.length > 20), `each type says what it is for in its tooltip: ${s.tips.length}`, f);
    const box = await fit(page);
    log.fit = box;
    ok(box !== null && box.seg <= box.select + 1, `the control does not stick out of the column: ${JSON.stringify(box)}`, f);
    const product = await controls(page);
    const startRows = await doctorRows(page);
    await closeDoctor(page);
    ok(!startRows.some((r) => INTERIOR_ROWS.includes(r.title)), `the Doctor of a product has none of the interior checks: ${startRows.map((r) => r.title).join(', ')}`, f);

    // Interior.
    await page.locator('[data-guide="scene-type"] .seg button', { hasText: /^Interior$/ }).click();
    await settle(page, 600);
    s = await state(page);
    log.interior = s;
    ok(s.pressedType === 'Interior', `Interior is in force: ${s.pressedType}`, f);
    ok(s.undo === 'Undo: Scene type: Interior', `one undo step: ${s.undo}`, f);
    ok(s.pressedStyle === 'Interior', `the Light section shows the Interior style: ${s.pressedStyle}`, f);
    ok(s.styles.at(-2) === 'Interior' && s.styles.at(-1) === 'Mine', `Interior is the last style, before Mine: ${s.styles.join(', ')}`, f);
    ok(JSON.stringify(s.thumbs) === JSON.stringify(RECIPES), `the seven recipes: ${s.thumbs.join(', ')}`, f);
    ok(s.shadow === 'false', `Interior has no contact shadow of its own: ${s.shadow}`, f);
    ok(s.viewTransform === 'AgX', `Interior views through AgX: ${s.viewTransform}`, f);
    const interior = await controls(page);
    ok(JSON.stringify(interior) === JSON.stringify(product), `no control appears or disappears with Interior: ${diff(product, interior)}`, f);
    const broken = await page.evaluate(() => [...document.querySelectorAll('[data-section="light"] .thumb img')].filter((i) => !(i.complete && i.naturalWidth > 0)).map((i) => i.getAttribute('src')));
    ok(broken.length === 0, `every thumbnail loads: ${broken.join(', ')}`, f);

    // The Doctor of an interior.
    const rows = await doctorRows(page);
    log.doctor = rows;
    for (const t of INTERIOR_ROWS) ok(rows.some((r) => r.title === t), `the Doctor lists ${t}: ${rows.map((r) => r.title).join(', ')}`, f);
    ok(rows.filter((r) => INTERIOR_ROWS.includes(r.title)).every((r) => r.text.length > 10), 'each interior row says what it checks or what it found', f);
    await closeDoctor(page);

    // A recipe.
    await page.locator('[data-section="light"] .thumb', { hasText: 'Midday window' }).click();
    await settle(page, 300);
    // L7: over the lights there are it asks what happens to them; Replace is what it always did.
    await page.locator('[data-light-question] .btn', { hasText: /^Replace$/ }).click();
    await settle(page, 500);
    s = await state(page);
    ok(s.undo === 'Undo: Light setup: Midday window (replace the lights)', `a recipe is one undo step: ${s.undo}`, f);
    const strength = await page.evaluate(() => {
      const row = [...document.querySelectorAll('[data-section="environment"] .field')].find((x) => x.querySelector('.field-label')?.textContent === 'Intensity');
      return row?.querySelector('[role="spinbutton"]')?.getAttribute('aria-valuenow') ?? null;
    });
    ok(strength !== null && Math.abs(Number(strength) - 0.15) < 1e-6, `the recipe sets the strength of the environment: ${strength}`, f);
    ok((await state(page)).shadow === 'false', 'a recipe leaves the contact shadow as the type had it', f);
    // The capture of the docs: Interior in force, with a recipe of its style (the pointer away, so no tooltip covers the thumbnails).
    await page.mouse.move(760, 200);
    await settle(page, 400);
    await page.screenshot({ path: join(SHOTS, 'scene-type-interior.png') });
    // Undo takes the recipe away and leaves the type.
    await page.keyboard.press('Control+z');
    await settle(page, 400);
    s = await state(page);
    ok(s.pressedType === 'Interior' && s.undo === 'Undo: Scene type: Interior', `undo takes the recipe away and leaves the type: ${s.pressedType}, ${s.undo}`, f);

    // Catalogue.
    await page.locator('[data-guide="scene-type"] .seg button', { hasText: /^Catalogue$/ }).click();
    await settle(page, 500);
    s = await state(page);
    log.catalogue = s;
    ok(s.pressedType === 'Catalogue', `Catalogue is in force: ${s.pressedType}`, f);
    ok(s.shadow === 'true', `Catalogue has a contact shadow: ${s.shadow}`, f);
    ok(s.viewTransform === 'Standard', `Catalogue views through Standard: ${s.viewTransform}`, f);
    ok(s.pressedStyle === 'All', `leaving Interior takes the Light section back to All: ${s.pressedStyle}`, f);
    const catalogue = await controls(page);
    ok(JSON.stringify(catalogue) === JSON.stringify(product), `no control appears or disappears with Catalogue: ${diff(product, catalogue)}`, f);
    ok(!(await doctorRows(page)).some((r) => INTERIOR_ROWS.includes(r.title)), 'the interior checks are gone from the Doctor of a catalogue', f);
    await closeDoctor(page);

    // Back to Product: the project as it was.
    await page.locator('[data-guide="scene-type"] .seg button', { hasText: /^Product$/ }).click();
    await settle(page, 500);
    s = await state(page);
    log.back = s;
    ok(s.pressedType === 'Product', `Product is in force again: ${s.pressedType}`, f);
    ok(s.shadow === log.start.shadow, `the contact shadow is as it was: ${s.shadow} / ${log.start.shadow}`, f);
    ok(s.viewTransform === log.start.viewTransform, `the view transform is as it was: ${s.viewTransform} / ${log.start.viewTransform}`, f);
    const again = await controls(page);
    ok(JSON.stringify(again) === JSON.stringify(product), `the inspector is as it was: ${diff(product, again)}`, f);

    // Undo walks back through the steps.
    await page.keyboard.press('Control+z');
    await settle(page, 300);
    ok((await state(page)).pressedType === 'Catalogue', `undo brings Catalogue back: ${(await state(page)).pressedType}`, f);
    ok(errors.length === 0, `page errors: ${errors.join(' | ')}`, f);
    await context.close();

    // The same in Spanish: the labels fit the column too, and the strings are there.
    const es = await browser.newContext({ viewport: { width: 1600, height: 1300 }, deviceScaleFactor: 1 });
    const pes = await es.newPage();
    await pes.goto(`${BASE_URL}/?example=1&theme=light&mode=fast&tour=0&lang=es`);
    await pes.waitForSelector('#app[data-ready="1"]', { timeout: 60000 });
    await settle(pes, 400);
    const esState = await state(pes);
    log.es = esState;
    ok(JSON.stringify(esState.types) === JSON.stringify(['Producto', 'Interior', 'Catálogo']), `Tipo de escena offers Producto, Interior and Catálogo: ${esState.types.join(', ')}`, f);
    const esBox = await fit(pes);
    ok(esBox !== null && esBox.seg <= esBox.select + 1, `in Spanish the control does not stick out of the column either: ${JSON.stringify(esBox)}`, f);
    await pes.locator('[data-guide="scene-type"] .seg button', { hasText: /^Interior$/ }).click();
    await settle(pes, 500);
    const esInterior = await state(pes);
    ok(esInterior.pressedStyle === 'Interior' && esInterior.thumbs.length === 7, `in Spanish: the Interior style with its seven recipes: ${esInterior.thumbs.join(', ')}`, f);
    ok(esInterior.undo === 'Deshacer: Tipo de escena: Interior', `in Spanish: one undo step: ${esInterior.undo}`, f);
    await es.close();
  } finally {
    await browser.close();
  }
} finally {
  server?.kill('SIGTERM');
  spawnSync('true');
}
writeFileSync(join(OUT, 'scene-type-check.json'), JSON.stringify({ failures: f, log }, null, 2));
if (f.length) {
  console.error(f.join('\n'));
  process.exit(1);
}
console.log('scene-type-check: all good');
