#!/usr/bin/env node
// Browser checks of phase X4 (the interface of the AI post-processing), with the local Chromium and swiftshader and
// the synthetic service (?ai=synthetic: no model, deterministic).
//
//   npm run engine:build && npm run build && node tools/ai-post-check.mjs [--url http://localhost:4192] [--shots docs/ui]
//
// Without --url it serves dist/ with `vite preview --port 4192 --strictPort` and stops it at the end (by the pids
// `lsof -t -i :4192` reports, never `pkill -f`).
//
//   (a) a build without the pipeline: the switch is disabled and says "coming soon", with the reason;
//   (b) with the synthetic service: the section is folded and off, the switch turns it on, the model line, the six
//       controls with their sentence, the style list, the six locked protection chips without a switch, Another
//       variation, the preview with its divider, the report line, the measured time and the note about Fast mode;
//   (c) the preview is not recomputed while a slider is dragged: no "Updating" appears until the release, then once;
//   (d) a drag is one undo step, the preview follows the undo, and the same settings give the same picture;
//   (e) Another variation changes the picture and its undo brings the first one back;
//   (f) the option "Use the full engine for the preview" draws the path tracer's picture;
//   (g) a job with AI saves the engine's PNG and the AI's, the results viewer opens Render against AI under the divider
//       with the report line, and the queue and the history show both thumbnails;
//   (h) the whole section and the viewer are achromatic in both themes (every computed colour has r = g = b, but the
//       pictures), and the Spanish interface has no English left in them;
//   (j) the viewer's header holds at 1600, 1280 and 960 px wide, in English and in Spanish: the guard's report is
//       one line of its own across the header (an ellipsis where it does not fit, the whole text in its tooltip),
//       the title is not cut short nor squeezed by the toolbar (which wraps under it instead), and no text or button
//       overlaps another or leaves the header (X3c); with several variants (X4b) the strip of their thumbnails is a line
//       of its own between the header and the picture, its thumbnails side by side inside it;
//   (k) X4b: the job's own prompt, a field with its note and counter (typing, a pause, more typing and leaving it is one
//       undo entry, and the undo empties it), the number of variants next to Another variation with the seeds it takes
//       (changing it makes no new preview), a job with four variants saves four AI files after one render, the viewer's
//       strip chooses the one the divider compares (and its report), Save this variant and Save all, and the queue and
//       the history show the count;
//   (l) X4b: Settings ▸ AI post-processing ▸ System prompt, the default text, an edit kept on leaving the field and
//       Restore default.
//
// Screenshots: ai-section-dark.png, ai-section-light.png, ai-results-viewer.png, ai-results-light.png, ai-queue.png,
// ai-section-prompt.png, ai-results-variants.png, settings-ai-prompt.png.
// Results: out/ai-post-check.json.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4192;
const STUDIO = 'example=1&preset=JEWELLERY&setup=REMBRANDT&lang=en&mode=fast';
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
const check = (key, ok, detail) => {
  results[key] = { ok: Boolean(ok), ...detail };
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${key} ${JSON.stringify(detail)}`);
};

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

let BASE_URL = opt('url', null);

async function open(browser, query) {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  // The check for a newer version at startup asks api.github.com; while the repository is private that is a 404 the browser logs itself.
  page.on('console', (m) => m.type() === 'error' && !m.location().url.startsWith('https://api.github.com/') && errors.push(m.text()));
  await page.goto(`${BASE_URL}/?${query}`);
  await page.waitForSelector('#app[data-ready="1"]', { timeout: 90000 });
  // The engine is ready when Full can be chosen.
  await page.waitForFunction(() => !document.querySelectorAll('.hdr .seg button')[1]?.disabled, null, { timeout: 60000 });
  return { page, context, errors };
}

const section = '.rw [data-section="rw.ai"]';

async function openWindow(page) {
  await page.locator('.render-btn').click();
  await page.waitForSelector('.rw');
}

async function expandAi(page) {
  if ((await page.locator(`${section}[data-collapsed]`).count()) > 0) await page.locator(`${section} .section-head`).click();
}

/** Scrolls the window's body so the section's content starts at its top. */
async function scrollToAi(page) {
  await page.locator('.rw-body').evaluate((el) => {
    const s = el.querySelector('[data-section="rw.ai"]');
    el.scrollTo(0, s.offsetTop - 2);
  });
  await page.waitForTimeout(250);
}

/** A screenshot of the window with only this section in it, as tall as it is (the window itself scrolls). */
async function shootSection(page, file) {
  const style = await page.addStyleTag({ content: '.rw{height:auto!important;max-height:none!important}.rw-body{overflow:visible!important}.rw-body>.section:not([data-section="rw.ai"]){display:none!important}.rw-ai-preview{position:static!important}' });
  await page.waitForTimeout(400);
  await page.locator('.rw').screenshot({ path: file });
  await style.evaluate((el) => el.remove());
  await page.waitForTimeout(200);
}

/** Records the texts the preview's status line takes (every change, even within one task). */
async function watchState(page) {
  await page.evaluate(() => {
    const el = document.querySelector('.rw-ai-state');
    window.__stateLog = [];
    window.__stateObserver?.disconnect();
    window.__stateObserver = new MutationObserver((records) => {
      for (const r of records) for (const n of r.addedNodes) window.__stateLog.push(n.textContent);
    });
    window.__stateObserver.observe(el, { childList: true, characterData: true, subtree: true });
  });
}
const stateLog = (page) => page.evaluate(() => window.__stateLog);

/** The data of the "after" picture of the preview, to tell one result from another. */
const afterPicture = (page) => page.evaluate(() => document.querySelector('.rw-ai-frame .split-b')?.toDataURL() ?? null);
const beforePicture = (page) => page.evaluate(() => document.querySelector('.rw-ai-frame .split-a')?.toDataURL() ?? null);

async function waitReady(page, ms = 60000) {
  await page.waitForFunction(() => /\d+ × \d+ px/.test(document.querySelector('.rw-ai-state')?.textContent ?? ''), null, { timeout: ms });
}

/** Colours of every element under a selector that are not grey: [selector, property, value]. */
async function chromatic(page, root) {
  return page.evaluate((sel) => {
    const out = [];
    const parse = (v) => {
      const m = /rgba?\(([^)]+)\)/.exec(v);
      if (!m) return null;
      const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
      return p;
    };
    const host = document.querySelector(sel);
    if (!host) return ['missing'];
    for (const el of [host, ...host.querySelectorAll('*')]) {
      // The pictures are content: the divider's canvases and the thumbnails are not chrome.
      if (el.tagName === 'CANVAS' || el.tagName === 'IMG' || el.closest('.split-img')) continue;
      const cs = getComputedStyle(el);
      for (const prop of ['color', 'backgroundColor', 'borderTopColor', 'borderLeftColor', 'outlineColor', 'fill', 'stroke']) {
        const p = parse(cs[prop]);
        if (!p || p.length < 3) continue;
        if (p.length > 3 && p[3] === 0) continue;
        if (Math.abs(p[0] - p[1]) > 0.5 || Math.abs(p[1] - p[2]) > 0.5) out.push([el.className || el.tagName, prop, cs[prop]]);
      }
    }
    return out;
  }, root);
}

/** What is wrong with the results viewer's header as it is drawn (empty when it holds). */
async function viewerHeadProblems(page) {
  return page.evaluate(() => {
    const out = [];
    const head = document.querySelector('.rv-head');
    if (!head) return [{ missing: '.rv-head' }];
    const shown = (el) => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility === 'visible' && getComputedStyle(el).display !== 'none';
    const textRects = (el) => {
      const rs = [];
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (!n.textContent.trim() || !shown(n.parentElement)) continue;
        const range = document.createRange();
        range.selectNodeContents(n);
        for (const r of range.getClientRects()) if (r.width > 0.5 && r.height > 0.5) rs.push(r);
      }
      return rs;
    };
    const r4 = (r) => [r.left, r.top, r.width, r.height].map((v) => Math.round(v));
    const meet = (a, b) => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
    // Every piece of the header: the title, the data, the report, each button and the zoom read-out.
    const pieces = [];
    // A line that ends in an ellipsis draws only what is inside its box: its text is measured clipped to it.
    const clipped = (el) => {
      const b = el.getBoundingClientRect();
      if (getComputedStyle(el).overflowX !== 'hidden') return textRects(el);
      return textRects(el)
        .map((r) => ({ left: Math.max(r.left, b.left), right: Math.min(r.right, b.right), top: Math.max(r.top, b.top), bottom: Math.min(r.bottom, b.bottom) }))
        .filter((r) => r.right - r.left > 0.5 && r.bottom - r.top > 0.5)
        .map((r) => ({ ...r, width: r.right - r.left, height: r.bottom - r.top }));
    };
    for (const el of head.querySelectorAll('.rv-title, .rv-data, .rv-memory, .rv-report, .rv-zoom')) if (shown(el)) pieces.push({ name: el.className, rects: clipped(el) });
    for (const el of head.querySelectorAll('button')) if (shown(el)) pieces.push({ name: `button ${el.textContent.trim() || el.getAttribute('aria-label')}`, rects: [el.getBoundingClientRect()] });
    for (let i = 0; i < pieces.length; i++)
      for (let j = i + 1; j < pieces.length; j++)
        for (const a of pieces[i].rects) for (const b of pieces[j].rects) if (meet(a, b)) out.push({ overlap: [pieces[i].name, pieces[j].name], a: r4(a), b: r4(b) });
    const box = head.getBoundingClientRect();
    for (const p of pieces) for (const r of p.rects) if (r.right > box.right + 1 || r.left < box.left - 1) out.push({ overflow: p.name, r: r4(r), head: r4(box) });
    // X4b: the strip of variants, a line of its own under the header and over the picture; its thumbnails side by side.
    const strip = document.querySelector('.rv-strip');
    if (strip && shown(strip)) {
      const sb = strip.getBoundingClientRect();
      const fb = document.querySelector('.rv-frame').getBoundingClientRect();
      if (sb.top < box.bottom - 0.5) out.push({ strip: 'over the header', strip: r4(sb), head: r4(box) });
      if (fb.top < sb.bottom - 0.5) out.push({ strip: 'over the picture', strip: r4(sb), frame: r4(fb) });
      if (sb.right > box.right + 1 || sb.left < box.left - 1) out.push({ strip: 'wider than the viewer', strip: r4(sb) });
      const thumbs = [...strip.querySelectorAll('.rv-variant')].map((b) => b.getBoundingClientRect());
      for (let i = 0; i < thumbs.length; i++) {
        if (thumbs[i].top < sb.top - 0.5 || thumbs[i].bottom > sb.bottom + 0.5) out.push({ strip: 'a thumbnail leaves it', thumb: i + 1 });
        for (let j = i + 1; j < thumbs.length; j++) if (meet(thumbs[i], thumbs[j])) out.push({ strip: 'thumbnails overlap', thumbs: [i + 1, j + 1] });
      }
      const label = strip.querySelector('.rv-strip-label')?.getBoundingClientRect();
      if (label && thumbs[0] && meet(label, thumbs[0])) out.push({ strip: 'the label overlaps a thumbnail' });
    }
    // The report: one line of its own across the header, its whole text in the tooltip.
    const report = head.querySelector('.rv-report');
    if (report) {
      const tops = new Set(textRects(report).map((r) => Math.round(r.top)));
      if (tops.size !== 1) out.push({ report: 'not one line', lines: tops.size });
      const rb = report.getBoundingClientRect();
      const cs = getComputedStyle(head);
      const inner = box.width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      if (rb.width < inner - 2) out.push({ report: 'not across the header', reportWidth: Math.round(rb.width), headerWidth: Math.round(inner) });
      const full = [...report.children].map((c) => c.textContent.trim()).filter(Boolean).join(' · ');
      if (!(report.getAttribute('title') ?? '').startsWith(full)) out.push({ report: 'tooltip without the whole text', title: report.getAttribute('title'), full });
      for (const b of head.querySelectorAll('button')) if (shown(b) && b.getBoundingClientRect().top > rb.top) out.push({ report: 'not under the toolbar', button: b.textContent.trim() });
    }
    // The title: whole, and its block not squeezed by the toolbar.
    const title = head.querySelector('.rv-title');
    if (title && title.scrollWidth > title.clientWidth + 1) out.push({ title: 'cut short', shown: title.clientWidth, needs: title.scrollWidth });
    const info = head.querySelector('.rv-info');
    if (info && info.getBoundingClientRect().width < Math.min(240, box.width - 30)) out.push({ title: 'squeezed', infoWidth: Math.round(info.getBoundingClientRect().width) });
    return out;
  });
}

/** The viewer's header at the three widths of the Settings check (P3e), in the page's language. */
async function viewerHeadMatrix(page, lang) {
  const problems = [];
  let measured = 0;
  for (const width of [1600, 1280, 960]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.waitForTimeout(400);
    measured++;
    for (const p of await viewerHeadProblems(page)) problems.push({ lang, width, ...p });
  }
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.waitForTimeout(300);
  return { problems, measured };
}

let browser = null;
let server = null;
let headEn = { problems: [{ missing: 'the English viewer was not measured' }], measured: 0 };
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

  // ---------------------------------------------------------------- (a) a build without the pipeline
  {
    const { page, context, errors } = await open(browser, `${STUDIO}&theme=dark`);
    await openWindow(page);
    await expandAi(page);
    await scrollToAi(page);
    const sw = page.locator('.rw [data-ai-switch]');
    const disabled = await sw.isDisabled();
    const checked = await sw.getAttribute('aria-checked');
    const aux = (await page.locator(`${section} .rw-ai-line`).textContent())?.trim().toLowerCase();
    const why = (await page.locator(`${section} .rw-ai-note`).textContent())?.trim();
    const configuratorShown = await page.locator(`${section} .rw-ai-grid`).isVisible();
    const summary = await page.locator('.rw-summary').textContent();
    check('a_not_built', disabled && checked === 'false' && aux === 'coming soon' && /no AI pipeline yet/.test(why ?? '') && !configuratorShown && /AI off/i.test(summary ?? ''), { disabled, checked, aux, why, configuratorShown, summary });
    check('a_no_errors', errors.length === 0, { errors });
    await context.close();
  }

  // ---------------------------------------------------------------- (b)–(g) the synthetic service, dark
  {
    const { page, context, errors } = await open(browser, `${STUDIO}&theme=dark&ai=synthetic`);
    await openWindow(page);
    // (b) Folded and off by default; the switch turns it on.
    const foldedAtStart = (await page.locator(`${section}[data-collapsed]`).count()) === 1;
    await expandAi(page);
    await scrollToAi(page);
    const sw = page.locator('.rw [data-ai-switch]');
    const offAtStart = (await sw.getAttribute('aria-checked')) === 'false' && (await sw.isEnabled());
    const gridHiddenOff = !(await page.locator(`${section} .rw-ai-grid`).isVisible());
    await sw.click();
    await page.waitForSelector(`${section} .rw-ai-frame .split canvas`, { timeout: 60000 });
    await waitReady(page);
    const aux = (await page.locator(`${section} .rw-ai-line`).textContent())?.trim().toLowerCase();
    check('b_section_default', foldedAtStart && offAtStart && gridHiddenOff && (await sw.getAttribute('aria-checked')) === 'true' && aux === 'synthetic test service · no model', { foldedAtStart, offAtStart, gridHiddenOff, aux });

    const expected = ['intervention', 'light', 'bounce', 'wear', 'style', 'styleStrength'];
    const controls = (await page.locator(`${section} [data-ai]`).evaluateAll((els) => els.map((e) => ({ key: e.dataset.ai, name: e.querySelector('.rw-ai-ctl-name')?.textContent, sentence: e.querySelector('.note')?.textContent, value: e.querySelector('input[type=range]')?.value ?? e.querySelector('select')?.value })))).filter((c) => expected.includes(c.key));
    const styleOptions = await page.locator(`${section} [data-ai="style"] option`).allTextContents();
    check(
      'b_six_controls',
      JSON.stringify(controls.map((c) => c.key)) === JSON.stringify(expected) && controls.every((c) => c.name && c.sentence) && controls.find((c) => c.key === 'intervention').value === '30' && controls.find((c) => c.key === 'light').value === '50' && controls.find((c) => c.key === 'bounce').value === '40' && controls.find((c) => c.key === 'wear').value === '20' && controls.find((c) => c.key === 'style').value === 'NATURAL' && controls.find((c) => c.key === 'styleStrength').value === '30' && styleOptions.length === 6,
      { controls, styleOptions },
    );
    const chips = await page.locator(`${section} .rw-ai-prot [data-protection]`).allTextContents();
    const pressables = await page.locator(`${section} .rw-ai-prot button, ${section} .rw-ai-prot input, ${section} .rw-ai-prot [role=switch]`).count();
    const locks = await page.locator(`${section} .rw-ai-prot [data-protection] svg`).count();
    check('b_protections_locked', chips.map((c) => c.trim()).join('|') === 'Geometry|Materials|Resolution|Depth of field|Framing|Text and logos' && pressables === 0 && locks === 6, { chips, pressables, locks });
    const variation = await page.locator(`${section} button`, { hasText: 'Another variation' }).count();
    const report = (await page.locator(`${section} .rw-ai-report`).textContent())?.trim();
    const time = (await page.locator(`${section} .rw-ai-time`).textContent())?.trim();
    const note = (await page.locator(`${section} .rw-ai-preview .note`, { hasText: 'starts from Fast mode' }).textContent())?.trim();
    const fullOpt = await page.locator(`${section} .rw-ai-full`).textContent();
    const labels = await page.locator(`${section} .split-label`).allTextContents();
    check(
      'b_preview',
      variation === 1 && /^Checked: geometry ✓ · materials ✓ \(ΔE max \d+\.\d\) · resolution ✓ · focus ✓$/.test(report ?? '') && /^≈ \d+(\.\d)? s per change on this computer$/.test(time ?? '') && /Fast mode/.test(note ?? '') && /full engine for the preview/.test(fullOpt ?? '') && labels.join('|') === 'Before|After',
      { variation, report, time, note, fullOpt, labels },
    );
    // The size of the preview is the job's shape at 512 px.
    const sizeLine = (await page.locator(`${section} .rw-ai-state`).textContent())?.trim();
    check('b_preview_size', sizeLine === '512 × 288 px', { sizeLine });
    // Screenshot (dark): the section as it opens, with the defaults.
    await shootSection(page, join(SHOTS, 'ai-section-dark.png'));

    // (c) No preview while a slider is dragged; one when it is released.
    await watchState(page);
    const range = page.locator(`${section} [data-ai="light"] input[type=range]`);
    await scrollToAi(page);
    const box = await range.boundingBox();
    const y = box.y + box.height / 2;
    await page.mouse.move(box.x + box.width * 0.5, y);
    await page.mouse.down();
    for (let k = 1; k <= 8; k++) {
      await page.mouse.move(box.x + box.width * (0.5 + 0.05 * k), y, { steps: 3 });
      await page.waitForTimeout(120);
    }
    await page.waitForTimeout(700);
    const during = await stateLog(page);
    const valueWhileDragging = await range.inputValue();
    await page.mouse.up();
    await page.waitForFunction(() => window.__stateLog.some((t) => /Updating/.test(t)) && /\d+ × \d+ px/.test(document.querySelector('.rw-ai-state').textContent), null, { timeout: 60000 });
    const after = await stateLog(page);
    const updates = after.filter((t) => /Updating the preview/.test(t)).length;
    check('c_not_during_drag', during.length === 0 && Number(valueWhileDragging) > 50 && updates === 1, { duringDrag: during, valueWhileDragging, updatesAfterRelease: updates });

    // (d) The drag is one undo step; the preview follows the undo; the same settings give the same picture.
    const draggedValue = await range.inputValue();
    const pictureDragged = await afterPicture(page);
    // The window's backdrop lies over the header: undo is the keyboard's (the range keeps the focus after the drag).
    const undoTip = () => page.evaluate(() => document.querySelector('.hdr button[aria-label="Undo"]').getAttribute('data-tip'));
    const tipDragged = await undoTip();
    await watchState(page);
    await page.keyboard.press('Control+z');
    const valueAfterUndo = await range.inputValue();
    await page.waitForFunction(() => window.__stateLog.some((t) => /Updating/.test(t)) && /\d+ × \d+ px/.test(document.querySelector('.rw-ai-state').textContent), null, { timeout: 60000 });
    const pictureUndone = await afterPicture(page);
    await page.keyboard.press('Control+Shift+z');
    await page.waitForFunction((v) => document.querySelector('[data-ai="light"] input[type=range]').value === v, draggedValue);
    await page.waitForFunction(() => /\d+ × \d+ px/.test(document.querySelector('.rw-ai-state').textContent));
    await page.waitForTimeout(600);
    const pictureRedone = await afterPicture(page);
    check('d_one_undo_step', Number(draggedValue) > 50 && valueAfterUndo === '50' && /AI post-processing: Light/.test(tipDragged ?? '') && pictureUndone !== pictureDragged && pictureRedone === pictureDragged, { draggedValue, valueAfterUndo, tipDragged, undoneDiffers: pictureUndone !== pictureDragged, redoneSame: pictureRedone === pictureDragged });

    // (e) Another variation changes the picture, and its undo brings the first one back.
    const first = await afterPicture(page);
    await watchState(page);
    await page.locator(`${section} button`, { hasText: 'Another variation' }).click();
    await page.waitForFunction(() => window.__stateLog.some((t) => /Updating/.test(t)) && /\d+ × \d+ px/.test(document.querySelector('.rw-ai-state').textContent), null, { timeout: 60000 });
    await page.waitForTimeout(400);
    const varied = await afterPicture(page);
    const variedTip = await undoTip();
    await watchState(page);
    await page.keyboard.press('Control+z');
    await page.waitForFunction(() => window.__stateLog.some((t) => /Updating/.test(t)) && /\d+ × \d+ px/.test(document.querySelector('.rw-ai-state').textContent), null, { timeout: 60000 });
    await page.waitForTimeout(400);
    const back = await afterPicture(page);
    check('e_another_variation', varied !== first && back === first && /Another variation/.test(variedTip ?? ''), { changed: varied !== first, undoBringsItBack: back === first, variedTip });

    // The style list and Style strength change the picture too (and a style at 0 strength does not).
    const baseline = await afterPicture(page);
    await page.locator(`${section} [data-ai="style"] select`).selectOption('WARM');
    await page.waitForTimeout(1200);
    await waitReady(page);
    const warm = await afterPicture(page);
    check('e_style_changes_picture', warm !== baseline, { changed: warm !== baseline });
    await page.locator(`${section} [data-ai="style"] select`).selectOption('NATURAL');
    await page.waitForTimeout(1200);
    await waitReady(page);

    const darkColours = await chromatic(page, '.rw');
    check('h_achromatic_dark', darkColours.length === 0, { found: darkColours.slice(0, 6) });

    // (f) The full engine for the preview: the path tracer's picture, at the job's budget (a few samples here).
    await page.locator(`${section} [data-ai="light"] input[type=range]`).focus();
    await page.locator('.rw .num[aria-label="Samples"]').scrollIntoViewIfNeeded();
    await page.locator('.rw .num[aria-label="Samples"]').dblclick();
    await page.locator('.rw .num[aria-label="Samples"] input').fill('4');
    await page.locator('.rw .num[aria-label="Samples"] input').press('Enter');
    await scrollToAi(page);
    const fastBefore = await beforePicture(page);
    await watchState(page);
    await page.locator(`${section} .rw-ai-full .toggle`).click();
    await page.waitForFunction(() => window.__stateLog.some((t) => /Updating|Drawing/.test(t)), null, { timeout: 60000 });
    await page.waitForFunction(() => /\d+ × \d+ px/.test(document.querySelector('.rw-ai-state').textContent), null, { timeout: 180000 });
    await page.waitForTimeout(500);
    const fullBefore = await beforePicture(page);
    const noteHidden = !(await page.locator(`${section} .rw-ai-preview .note`, { hasText: 'starts from Fast mode' }).isVisible());
    check('f_full_engine_preview', fullBefore !== null && fullBefore !== fastBefore && noteHidden, { differsFromFast: fullBefore !== fastBefore, noteHidden });
    await page.locator(`${section} .rw-ai-full .toggle`).click();
    await page.waitForFunction(() => /\d+ × \d+ px/.test(document.querySelector('.rw-ai-state').textContent), null, { timeout: 60000 });

    // (g) A job with AI: two files, the viewer with the divider and the report, both thumbnails in the queue.
    // A look that shows: warm, with more light and a stronger hand.
    await scrollToAi(page);
    await page.locator(`${section} [data-ai="style"] select`).selectOption('WARM');
    for (const [key, value] of [['intervention', 80], ['light', 80], ['styleStrength', 70]]) {
      await page.locator(`${section} [data-ai="${key}"] .num`).dblclick();
      await page.locator(`${section} [data-ai="${key}"] .num input`).fill(String(value));
      await page.locator(`${section} [data-ai="${key}"] .num input`).press('Enter');
    }
    await page.waitForTimeout(800);
    await page.locator('.rw .seg button', { hasText: 'PNG' }).click();
    await page.locator('.rw .num[aria-label="Samples"]').dblclick();
    await page.locator('.rw .num[aria-label="Samples"] input').fill('16');
    await page.locator('.rw .num[aria-label="Samples"] input').press('Enter');
    const downloads = [];
    page.on('download', (d) => downloads.push(d.suggestedFilename()));
    await page.locator('.rw-foot .btn-primary').click();
    await page.waitForSelector('.rv[data-ready="1"]', { timeout: 240000 });
    await page.waitForTimeout(800);
    const names = [...downloads];
    const labelsViewer = await page.locator('.rv .split-label').allTextContents();
    const modes = await page.locator('.rv .split-modes button').allTextContents();
    const reportViewer = (await page.locator('.rv-report-checked').textContent())?.trim();
    const saveButtons = await page.locator('.rv-actions .btn').allTextContents();
    const canvases = await page.locator('.rv .split canvas').count();
    check(
      'g_viewer_render_vs_ai',
      names.length === 2 && /_0001\.png$/.test(names[0]) && /_0001_AI\.png$/.test(names[1]) && labelsViewer.join('|') === 'Render|AI' && modes.join('|') === 'Render only|AI only|Split' && /^Checked: geometry ✓ · materials ✓ \(ΔE max \d+\.\d\) · resolution ✓ · focus ✓$/.test(reportViewer ?? '') && saveButtons.some((t) => /Save AI image/.test(t)) && saveButtons.some((t) => /Save render again/.test(t)) && canvases === 2,
      { names, labelsViewer, modes, reportViewer, saveButtons, canvases },
    );
    // The divider drags (and moves with the keys), as U5's does.
    const frame = await page.locator('.rv .split').boundingBox();
    const handle = await page.locator('.rv .split-handle').boundingBox();
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(frame.x + frame.width * 0.4, handle.y + handle.height / 2, { steps: 6 });
    await page.mouse.up();
    const pos = await page.locator('.rv .split-handle').getAttribute('aria-valuenow');
    check('g_divider_drags', Math.abs(Number(pos) - 40) <= 2, { position: pos });
    // Save AI image saves the second file.
    const before = downloads.length;
    await page.locator('.rv-actions .btn[data-save="ai"]').click();
    await page.waitForTimeout(800);
    check('g_save_ai_image', downloads.length === before + 1 && /_AI\.png$/.test(downloads.at(-1)), { downloads: downloads.slice(before) });
    await page.waitForFunction(() => document.querySelectorAll('.toast').length === 0, null, { timeout: 15000 });
    await page.screenshot({ path: join(SHOTS, 'ai-results-viewer.png') });
    const viewerColours = await chromatic(page, '.rv');
    check('h_viewer_achromatic_dark', viewerColours.length === 0, { found: viewerColours.slice(0, 6) });
    headEn = await viewerHeadMatrix(page, 'en');
    await page.keyboard.press('Escape');

    // The queue and the history: both pictures.
    await page.locator('.drawer-btn[data-drawer="queue"]').click();
    await page.waitForSelector('.queue-row[data-status="DONE"]');
    const queuePics = await page.locator('.queue-row .queue-pics img').count();
    const historyPair = await page.locator('.history-item.history-pair img').count();
    check('g_queue_two_thumbnails', queuePics === 2 && historyPair === 2, { queuePics, historyPair });
    await page.waitForFunction(() => document.querySelectorAll('.toast').length === 0, null, { timeout: 15000 });
    await page.screenshot({ path: join(SHOTS, 'ai-queue.png'), clip: { x: 0, y: 560, width: 1600, height: 440 } });

    // (k) X4b: the job's own prompt and four variants.
    await page.locator('.drawer-btn[data-drawer="queue"]').click();
    await openWindow(page);
    await expandAi(page);
    await scrollToAi(page);
    const promptField = page.locator(`${section} [data-ai="userPrompt"] textarea`);
    const promptNote = (await page.locator(`${section} [data-ai="userPrompt"] > .note`).first().textContent())?.trim();
    const emptyAtStart = (await promptField.inputValue()) === '';
    const undoTipNow = () => page.evaluate(() => document.querySelector('.hdr button[aria-label="Undo"]').getAttribute('data-tip'));
    await watchState(page);
    await promptField.click();
    await promptField.pressSequentially('Late afternoon', { delay: 20 });
    // Typing stops: it is kept (and the preview follows); then more, then the field is left.
    await page.waitForTimeout(1200);
    await promptField.pressSequentially(' light, a calm mood', { delay: 20 });
    await page.waitForTimeout(1200);
    await page.locator(`${section} .rw-ai-ctl-name`, { hasText: 'Intervention' }).click();
    await page.waitForTimeout(300);
    const tipTyped = await undoTipNow();
    const counter = (await page.locator(`${section} .rw-ai-count`).textContent())?.trim();
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(300);
    const afterUndo = await promptField.inputValue();
    const tipAfterUndo = await undoTipNow();
    await page.keyboard.press('Control+Shift+z');
    await page.waitForTimeout(300);
    const afterRedo = await promptField.inputValue();
    check('k_prompt_one_undo_entry', emptyAtStart && /AI post-processing: Your prompt/.test(tipTyped ?? '') && afterUndo === '' && !/Your prompt/.test(tipAfterUndo ?? '') && afterRedo === 'Late afternoon light, a calm mood' && counter === '33 / 400' && /stay protected/.test(promptNote ?? ''), { emptyAtStart, tipTyped, tipAfterUndo, afterUndo, afterRedo, counter, promptNote });
    await waitReady(page);
    // Four variants: the line says which seeds; the preview is not made again for it.
    await watchState(page);
    const variantsNum = page.locator(`${section} [data-ai="variants"] .num`);
    await variantsNum.dblclick();
    await page.locator(`${section} [data-ai="variants"] .num input`).fill('4');
    await page.locator(`${section} [data-ai="variants"] .num input`).press('Enter');
    await page.waitForTimeout(1200);
    const variantsLine = (await page.locator(`${section} .rw-ai-variants-line`).textContent())?.trim();
    const noNewPreview = (await stateLog(page)).every((x) => !/Updating/.test(x));
    const variantsTip = await undoTipNow();
    check('k_variants_line', /^One render, then 4 AI images with the seeds (\d+) to (\d+); the preview shows the first · ≈ .+ of AI on this computer$/.test(variantsLine ?? '') && noNewPreview && /AI post-processing: Variants/.test(variantsTip ?? ''), { variantsLine, noNewPreview, variantsTip });
    await scrollToAi(page);
    await shootSection(page, join(SHOTS, 'ai-section-prompt.png'));
    const kDownloads = [];
    page.on('download', (d) => kDownloads.push(d.suggestedFilename()));
    await page.locator('.rw-foot .btn-primary').click();
    await page.waitForSelector('.rv[data-ready="1"]', { timeout: 300000 });
    await page.waitForTimeout(800);
    const kNames = [...kDownloads];
    const thumbs = await page.locator('.rv-strip .rv-variant').count();
    const checkedFirst = await page.locator('.rv-strip .rv-variant[aria-checked="true"]').getAttribute('data-variant');
    const bFirst = await page.evaluate(() => document.querySelector('.rv .split-b')?.toDataURL() ?? null);
    const labelFirst = (await page.locator('.rv .split-label-b').textContent())?.trim();
    await page.locator('.rv-strip .rv-variant[data-variant="3"]').click();
    await page.waitForTimeout(600);
    const bThird = await page.evaluate(() => document.querySelector('.rv .split-b')?.toDataURL() ?? null);
    const labelThird = (await page.locator('.rv .split-label-b').textContent())?.trim();
    const reportThird = (await page.locator('.rv-report-variant').textContent())?.trim();
    check(
      'k_four_variants_one_render',
      kNames.length === 5 && /_0002\.png$/.test(kNames[0]) && /_0002_AI\.png$/.test(kNames[1]) && /_0002_AI_2\.png$/.test(kNames[2]) && /_0002_AI_3\.png$/.test(kNames[3]) && /_0002_AI_4\.png$/.test(kNames[4]) && thumbs === 4 && checkedFirst === '1' && labelFirst === 'AI 1' && labelThird === 'AI 3' && bThird !== null && bThird !== bFirst && reportThird === 'Variant 3',
      { kNames, thumbs, checkedFirst, labelFirst, labelThird, reportThird, pictureChanged: bThird !== bFirst },
    );
    const kBefore = kDownloads.length;
    await page.locator('.rv-actions .btn[data-save="ai"]').click();
    await page.waitForTimeout(800);
    const savedThis = kDownloads.slice(kBefore);
    const saveLabels = await page.locator('.rv-actions .btn').allTextContents();
    await page.locator('.rv-actions .btn[data-save="all"]').click();
    await page.waitForTimeout(1500);
    const savedAll = kDownloads.slice(kBefore + savedThis.length);
    check('k_save_variant_and_all', savedThis.length === 1 && /_AI_3\.png$/.test(savedThis[0]) && savedAll.length === 4 && saveLabels.some((x) => /Save this variant/.test(x)) && saveLabels.some((x) => /Save all/.test(x)), { savedThis, savedAll, saveLabels });
    await page.waitForFunction(() => document.querySelectorAll('.toast').length === 0, null, { timeout: 15000 });
    await page.screenshot({ path: join(SHOTS, 'ai-results-variants.png') });
    const stripColours = await chromatic(page, '.rv');
    check('k_viewer_achromatic', stripColours.length === 0, { found: stripColours.slice(0, 6) });
    await page.keyboard.press('Escape');
    await page.locator('.drawer-btn[data-drawer="queue"]').click();
    await page.waitForSelector('.queue-row[data-status="DONE"] .variant-count');
    const queueCount = (await page.locator('.queue-row .variant-count').first().textContent())?.trim();
    const historyCount = (await page.locator('.history-item .variant-count').first().textContent())?.trim();
    const queueAi = await page.locator('.queue-row .aux', { hasText: 'AI × 4' }).count();
    check('k_queue_history_count', queueCount === '×4' && historyCount === '×4' && queueAi === 1, { queueCount, historyCount, queueAi });
    check('b_no_errors_dark', errors.length === 0, { errors });
    await context.close();
  }

  // ---------------------------------------------------------------- (l) Settings ▸ AI post-processing ▸ System prompt
  {
    const { page, context, errors } = await open(browser, `${STUDIO}&theme=dark&ai=synthetic&settings=ai.systemPrompt`);
    await page.waitForSelector('.sw [data-row="ai.systemPrompt"] textarea', { timeout: 20000 });
    const row = page.locator('.sw [data-row="ai.systemPrompt"]');
    await row.scrollIntoViewIfNeeded();
    const field = row.locator('textarea');
    const text0 = await field.inputValue();
    const restoreDisabled0 = await row.locator('[data-sp="restore"]').isDisabled();
    const aux = (await row.locator('.sw-aux').textContent())?.trim();
    await page.waitForTimeout(300);
    await page.locator('.sw').screenshot({ path: join(SHOTS, 'settings-ai-prompt.png') });
    await field.fill('Clean studio product photograph, soft and even light.');
    await page.locator('.sw-title').click();
    await page.waitForTimeout(300);
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('repackshot.settings') ?? '{}').settings?.['ai.systemPrompt'] ?? null);
    const restoreEnabled = await row.locator('[data-sp="restore"]').isEnabled();
    await row.locator('[data-sp="restore"]').click();
    await page.waitForTimeout(300);
    const restored = await field.inputValue();
    const sectionColours = await chromatic(page, '.sw [data-row="ai.systemPrompt"]');
    check(
      'l_system_prompt',
      text0.startsWith('Photorealistic product photograph. Keep the image exactly as rendered') && restoreDisabled0 && /protections do not depend on them/.test(aux ?? '') && stored === 'Clean studio product photograph, soft and even light.' && restoreEnabled && restored === text0 && sectionColours.length === 0,
      { start: text0.slice(0, 40), restoreDisabled0, aux, stored, restoreEnabled, restoredIsDefault: restored === text0, colours: sectionColours.slice(0, 4) },
    );
    check('l_no_errors', errors.length === 0, { errors });
    await context.close();
  }

  // ---------------------------------------------------------------- the same in light, and a limited result
  {
    const { page, context, errors } = await open(browser, `${STUDIO}&theme=light&ai=synthetic`);
    await openWindow(page);
    await expandAi(page);
    await page.locator('.rw [data-ai-switch]').click();
    await page.waitForSelector(`${section} .rw-ai-frame .split canvas`, { timeout: 60000 });
    await waitReady(page);
    await shootSection(page, join(SHOTS, 'ai-section-light.png'));
    const lightColours = await chromatic(page, '.rw');
    check('h_achromatic_light', lightColours.length === 0, { found: lightColours.slice(0, 6) });
    // Everything asked for at once: the guard may have to step in; the viewer says how far.
    for (const [key, value] of [['intervention', 100], ['light', 100], ['bounce', 100], ['styleStrength', 100]]) {
      await page.locator(`${section} [data-ai="${key}"] .num`).dblclick();
      await page.locator(`${section} [data-ai="${key}"] .num input`).fill(String(value));
      await page.locator(`${section} [data-ai="${key}"] .num input`).press('Enter');
    }
    await page.locator(`${section} [data-ai="style"] select`).selectOption('CINEMATIC');
    await page.waitForTimeout(1500);
    await waitReady(page);
    const reportPreview = (await page.locator(`${section} .rw-ai-report`).textContent())?.trim();
    const notePreview = (await page.locator(`${section} .rw-ai-report-note`).textContent())?.trim();
    check('i_strong_settings_report', /^Checked: /.test(reportPreview ?? ''), { reportPreview, notePreview });
    await page.locator('.rw .num[aria-label="Samples"]').scrollIntoViewIfNeeded();
    await page.locator('.rw .num[aria-label="Samples"]').dblclick();
    await page.locator('.rw .num[aria-label="Samples"] input').fill('8');
    await page.locator('.rw .num[aria-label="Samples"] input').press('Enter');
    await page.locator('.rw-foot .btn-primary').click();
    await page.waitForSelector('.rv[data-ready="1"]', { timeout: 240000 });
    await page.waitForTimeout(800);
    const reportLight = (await page.locator('.rv-report').textContent())?.trim();
    await page.waitForFunction(() => document.querySelectorAll('.toast').length === 0, null, { timeout: 15000 });
    await page.screenshot({ path: join(SHOTS, 'ai-results-light.png') });
    const viewerLight = await chromatic(page, '.rv');
    check('h_viewer_achromatic_light', viewerLight.length === 0, { found: viewerLight.slice(0, 6), reportLight });
    check('b_no_errors_light', errors.length === 0, { errors });
    await context.close();
  }

  // ---------------------------------------------------------------- Spanish
  {
    const { page, context, errors } = await open(browser, `${STUDIO.replace('lang=en', 'lang=es')}&theme=dark&ai=synthetic`);
    await openWindow(page);
    await expandAi(page);
    await page.locator('.rw [data-ai-switch]').click();
    await page.waitForSelector(`${section} .rw-ai-frame .split canvas`, { timeout: 60000 });
    await waitReady(page);
    const text = (await page.locator(section).innerText()).replace(/\s+/g, ' ');
    const spanish = ['Intervención', 'Luz', 'Rebotes', 'Desgaste y microdetalle', 'Estilo', 'Fuerza del estilo', 'Protegido', 'Geometría', 'Texto y logotipos', 'Otra variación', 'Vista previa', 'Comprobado: geometría ✓', 'Usar el motor completo para la vista previa'];
    const missing = spanish.filter((w) => !text.includes(w));
    const english = ['Intervention', 'Another variation', 'Protected', 'Checked:', 'Preview', 'per change'].filter((w) => text.includes(w));
    check('h_spanish', missing.length === 0 && english.length === 0, { missing, english });
    // A job with AI in Spanish, for the viewer's header (its words are longer), with three variants (X4b: the strip).
    await page.locator(`${section} [data-ai="variants"] .num`).scrollIntoViewIfNeeded();
    await page.locator(`${section} [data-ai="variants"] .num`).dblclick();
    await page.locator(`${section} [data-ai="variants"] .num input`).fill('3');
    await page.locator(`${section} [data-ai="variants"] .num input`).press('Enter');
    const spanishX4b = ['Prompt propio', 'Describe la luz o el ambiente', 'Variantes', 'Un render y después 3 imágenes de IA'];
    const textX4b = (await page.locator(section).innerText()).replace(/\s+/g, ' ');
    check('k_spanish', spanishX4b.every((w) => textX4b.includes(w)) && !/Your prompt|Variants/.test(textX4b), { missing: spanishX4b.filter((w) => !textX4b.includes(w)) });
    await page.locator('.rw .num[aria-label="Muestras"]').scrollIntoViewIfNeeded();
    await page.locator('.rw .num[aria-label="Muestras"]').dblclick();
    await page.locator('.rw .num[aria-label="Muestras"] input').fill('8');
    await page.locator('.rw .num[aria-label="Muestras"] input').press('Enter');
    await page.locator('.rw-foot .btn-primary').click();
    await page.waitForSelector('.rv[data-ready="1"]', { timeout: 240000 });
    await page.waitForTimeout(800);
    const stripEs = await page.locator('.rv-strip .rv-variant').count();
    check('j_strip_present', stripEs === 3, { stripEs });
    const headEs = await viewerHeadMatrix(page, 'es');
    const head = [...headEn.problems, ...headEs.problems];
    check('j_viewer_head_holds', head.length === 0 && headEn.measured + headEs.measured === 6, { measured: headEn.measured + headEs.measured, problems: head.slice(0, 12), count: head.length });
    check('h_no_errors_es', errors.length === 0, { errors });
    await context.close();
  }

  writeFileSync(join(OUT, 'ai-post-check.json'), JSON.stringify(results, null, 2));
  const bad = Object.entries(results).filter(([, v]) => !v.ok);
  if (bad.length > 0) fail(`failed: ${bad.map(([k]) => k).join(', ')}`);
  console.log(`all ${Object.keys(results).length} checks passed`);
} catch (err) {
  console.error(err);
  writeFileSync(join(OUT, 'ai-post-check.json'), JSON.stringify(results, null, 2));
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => undefined);
  if (server) stopServer();
}
