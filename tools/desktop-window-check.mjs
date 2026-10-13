#!/usr/bin/env node
// Browser checks of phase P3b: a desktop window with nothing of the browser in it, and files through the launcher.
//
//   npm run build && (cd engine && cargo build --release -p rt-app) && node tools/desktop-window-check.mjs [--web]
//        [--shots out/desktop-window]
//
// Desktop (the default): the real launcher (engine/target/release/repackshot, not --serve-only) opens its window under
// Xvfb with the local Chromium; REPACKSHOT_BROWSER is a wrapper that logs the switches the launcher passes and adds a
// DevTools port, through which Playwright drives the window. A fake `zenity` on PATH answers the dialogs with the
// paths this check writes into `next` (no `next`: cancelled) and logs every call.
//
//   (a) the window gets the hardening switches and one --disable-features, and the profile its preferences
//       (translation, spelling, autofill and the mini menu off);
//   (b) the page is "notranslate", has its favicon (image/x-icon) and manifest (application/manifest+json), served by
//       the launcher;
//   (c) right click, a drag over the chrome, Ctrl P, Ctrl + / - / 0, Ctrl + wheel, F5, Ctrl R, Ctrl F, Ctrl U, Ctrl J,
//       Ctrl H, Ctrl D, F7, Alt ←, F12 and Ctrl ⇧ I do nothing of the browser's (the event's default is prevented, the
//       page is neither reloaded nor zoomed, nothing is selected), while text still selects in a field and the
//       application's shortcuts (Ctrl K, Ctrl ,) still work;
//   (d) the render window's Choose folder… asks the system's dialog (zenity --directory), shows the path, and Render
//       writes the PNG into that folder; the results viewer offers Open folder;
//   (e) Save asks once (zenity --save) and writes the .repack.json; Save again writes it without asking; Open reads it
//       back through the open dialog; Import model reads an OBJ through it; Export scene writes the .rsb;
//   (f) Ctrl W asks our own unsaved-changes question (never the browser's), Don't save closes the window and the
//       launcher ends.
//
// --web: the same page from `vite preview` in a headless Chromium (b, c): the guards do not get in the way of the web
// version (Ctrl W stays the browser's, links are links).
//
// Screenshots: window-render.png (the page) and window-x11.png (the X display). Results: out/desktop-window-check.json.

import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const WEB = args.includes('--web');
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const SHOTS = resolve(ROOT, opt('shots', join('out', 'desktop-window')));
const DIR = join(ROOT, 'out', 'desktop-window-check');
const FAKE = join(DIR, 'fakebin');
const PORT = WEB ? 4196 : 4195;
const CDP = 9335;
const DISPLAY = ':97';
const CHROME = '/opt/pw-browsers/chromium';
const results = {};
let failed = 0;
const fail = (msg) => {
  throw new Error(msg);
};
const check = (key, ok, detail) => {
  results[key] = { ok: Boolean(ok), ...detail };
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${key} ${JSON.stringify(detail)}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, timeout = 30000, what = 'condition') {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > timeout) fail(`timed out waiting for ${what}`);
    await sleep(150);
  }
}

// ------------------------------------------------------------------ the fake system

function setupFakes() {
  rmSync(DIR, { recursive: true, force: true });
  mkdirSync(FAKE, { recursive: true });
  // zenity: answers `next` (then forgets it), else "cancelled"; logs every call.
  writeFileSync(
    join(FAKE, 'zenity'),
    `#!/bin/sh\nd="$(dirname "$0")"\n{ echo "--- call"; for a in "$@"; do echo "$a"; done; } >> "$d/calls.log"\nif [ -f "$d/next" ]; then cat "$d/next"; rm -f "$d/next"; exit 0; fi\nexit 1\n`,
  );
  // The browser: what the launcher passed, then the real Chromium with a DevTools port for this check.
  writeFileSync(
    join(FAKE, 'browser'),
    `#!/bin/sh\nd="$(dirname "$0")"\nfor a in "$@"; do echo "$a"; done > "$d/browser-args.txt"\nexec ${CHROME} --no-sandbox --remote-debugging-port=${CDP} --use-gl=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist "$@"\n`,
  );
  // No file manager here: "shown" is a line in a log.
  writeFileSync(join(FAKE, 'xdg-open'), `#!/bin/sh\necho "$@" >> "$(dirname "$0")/xdg-open.log"\n`);
  for (const f of ['zenity', 'browser', 'xdg-open']) chmodSync(join(FAKE, f), 0o755);
}
const answer = (...paths) => writeFileSync(join(FAKE, 'next'), paths.map((p) => `${p}\n`).join(''));
const calls = () => (existsSync(join(FAKE, 'calls.log')) ? readFileSync(join(FAKE, 'calls.log'), 'utf8').split('--- call\n').filter(Boolean) : []);

// ------------------------------------------------------------------ the page's checks

/** Listens last on the window: what the browser would do with each event. */
async function installProbe(page) {
  await page.evaluate(() => {
    window.__probe = [];
    window.__marker = 'still here';
    // Capture on the window, after the guards' own listener: what they decided, before any field can stop the event.
    for (const type of ['keydown', 'contextmenu', 'wheel', 'selectstart']) window.addEventListener(type, (e) => window.__probe.push({ type, key: e.key ?? null, ctrl: !!e.ctrlKey, prevented: e.defaultPrevented }), true);
  });
}
const probe = (page) => page.evaluate(() => window.__probe.splice(0));

async function pageChecks(page, base) {
  // (b) The page as an application.
  const meta = await page.evaluate(async (base) => {
    const head = async (p) => {
      const r = await fetch(new URL(p, base), { cache: 'no-store' });
      return { status: r.status, type: r.headers.get('content-type') };
    };
    const icons = [...document.querySelectorAll('link[rel="icon"], link[rel="manifest"], link[rel="apple-touch-icon"]')].map((l) => l.getAttribute('href'));
    return {
      translate: document.documentElement.translate,
      notranslate: document.querySelector('meta[name="google"]')?.getAttribute('content'),
      title: document.title,
      themeColor: document.querySelector('meta[name="theme-color"]')?.getAttribute('content'),
      favicon: await head('/favicon.ico'),
      manifest: await head('/manifest.webmanifest'),
      icons: await Promise.all(icons.map(async (h) => ({ href: h, ...(await head(h)) }))),
      spellcheck: document.documentElement.getAttribute('spellcheck'),
      // Images and links not draggable out of the window; fields without autofill.
      draggable: document.querySelectorAll('img:not([draggable]), a:not([draggable])').length,
      autofill: document.querySelectorAll('input:not([autocomplete]), textarea:not([autocomplete])').length,
    };
  }, base);
  const iconsOk = meta.icons.length >= 4 && meta.icons.every((i) => i.status === 200);
  check('b_page_is_an_application', meta.translate === false && meta.notranslate === 'notranslate' && meta.title === 'Repackshot' && meta.favicon.status === 200 && /image\/(x-icon|vnd\.microsoft\.icon)/.test(meta.favicon.type ?? '') && meta.manifest.status === 200 && /manifest\+json|application\/json/.test(meta.manifest.type ?? '') && iconsOk && meta.spellcheck === 'false' && meta.draggable === 0 && meta.autofill === 0, meta);

  // (c) No browser behaviour.
  await installProbe(page);
  await page.locator('canvas[aria-label="viewport"]').focus();
  const zoomBefore = await page.evaluate(() => ({ dpr: window.devicePixelRatio, scale: window.visualViewport?.scale ?? 1, w: window.innerWidth }));
  const keys = ['Control+p', 'Control+Shift+p', 'Control+Equal', 'Control+Minus', 'Control+Digit0', 'F5', 'Control+r', 'Control+f', 'Control+u', 'Control+j', 'Control+h', 'Control+d', 'F7', 'Alt+ArrowLeft', 'F12', 'Control+Shift+I', 'Control+n', 'Control+t'];
  for (const k of keys) {
    await page.keyboard.press(k);
    await sleep(60);
  }
  await page.keyboard.down('Control');
  const vp = await page.locator('canvas[aria-label="viewport"]').boundingBox();
  await page.mouse.move(vp.x + vp.width / 2, vp.y + vp.height / 2);
  await page.mouse.wheel(0, -120);
  await page.keyboard.up('Control');
  await sleep(300);
  const hdr = await page.locator('.hdr').boundingBox();
  await page.mouse.click(hdr.x + hdr.width / 2, hdr.y + hdr.height / 2, { button: 'right' });
  await sleep(200);
  const events = await probe(page);
  const keyEvents = events.filter((e) => e.type === 'keydown' && e.key !== 'Control' && e.key !== 'Shift' && e.key !== 'Alt');
  const notPrevented = keyEvents.filter((e) => !e.prevented).map((e) => e.key);
  const wheel = events.filter((e) => e.type === 'wheel');
  const menu = events.filter((e) => e.type === 'contextmenu');
  const zoomAfter = await page.evaluate(() => ({ dpr: window.devicePixelRatio, scale: window.visualViewport?.scale ?? 1, w: window.innerWidth }));
  const marker = await page.evaluate(() => window.__marker);
  check('c_browser_keys_do_nothing', keyEvents.length === keys.length && notPrevented.length === 0 && marker === 'still here' && JSON.stringify(zoomBefore) === JSON.stringify(zoomAfter), { pressed: keys.length, seen: keyEvents.map((e) => (e.ctrl ? `Ctrl+${e.key}` : e.key)), notPrevented, reloaded: marker !== 'still here', zoomBefore, zoomAfter });
  check('c_wheel_zoom_and_context_menu', wheel.length > 0 && wheel.every((e) => !e.ctrl || e.prevented) && menu.length === 1 && menu[0].prevented, { wheel, menu });

  // Selection: none over the chrome, text still selects in a field.
  const label = await page.locator('.status').boundingBox();
  await page.mouse.move(label.x + 4, label.y + label.height / 2);
  await page.mouse.down();
  await page.mouse.move(label.x + label.width - 4, label.y + label.height / 2, { steps: 8 });
  await page.mouse.up();
  const selected = await page.evaluate(() => String(window.getSelection()));
  await page.keyboard.press('Control+k');
  await page.locator('.palette-input').fill('hello');
  await page.locator('.palette-input').press('Shift+Home');
  const inField = await page.evaluate(() => {
    const i = document.querySelector('.palette-input');
    const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    i.dispatchEvent(e);
    return { from: i.selectionStart, to: i.selectionEnd, menuAllowed: !e.defaultPrevented, autocomplete: i.getAttribute('autocomplete') };
  });
  const paletteOpen = await page.locator('.palette').isVisible();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+Comma');
  const settingsOpen = await page.locator('.sw').first().isVisible().catch(() => false);
  await page.keyboard.press('Control+Comma');
  await sleep(200);
  const settingsClosed = (await page.locator('.sw').count()) === 0;
  check('c_selection_and_app_shortcuts', selected === '' && inField.from === 0 && inField.to === 5 && inField.menuAllowed && inField.autocomplete === 'off' && paletteOpen && settingsOpen && settingsClosed, { selected, inField, paletteOpen, settingsOpen, settingsClosed });
}

// ------------------------------------------------------------------ main

async function waitHttp(url, timeout = 60000) {
  return until(async () => {
    try {
      return (await fetch(url)).status > 0;
    } catch {
      return false;
    }
  }, timeout, url);
}

let launcher = null;
let xvfb = null;
let server = null;
let browser = null;
const { chromium } = await import(join(ROOT, 'node_modules', 'playwright-core', 'index.mjs'));
try {
  if (!existsSync(join(ROOT, 'dist', 'index.html'))) fail('dist/ is missing: npm run build first');
  mkdirSync(SHOTS, { recursive: true });
  if (WEB) {
    server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: 'ignore', detached: true });
    const base = `http://localhost:${PORT}`;
    await waitHttp(base);
    browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
    const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`${base}/?example=1&theme=dark&lang=en&mode=fast`);
    await page.waitForSelector('#app[data-ready="1"]', { timeout: 90000 });
    await pageChecks(page, base);
    // The web version keeps the browser's Ctrl W (closing a tab is the person's), and its links are links.
    await probe(page);
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', code: 'KeyW', ctrlKey: true, cancelable: true, bubbles: true })));
    const web = (await probe(page)).filter((e) => e.key === 'w');
    check('web_keeps_the_browser_close', web.length > 0 && web.every((e) => !e.prevented), { web, errors });
  } else {
    const bin = join(ROOT, 'engine', 'target', 'release', 'repackshot');
    if (!existsSync(bin)) fail('engine/target/release/repackshot is missing: (cd engine && cargo build --release -p rt-app)');
    setupFakes();
    const exe = join(DIR, 'repackshot');
    copyFileSync(bin, exe);
    chmodSync(exe, 0o755);
    writeFileSync(join(DIR, 'portable.txt'), '');
    const OUT = join(DIR, 'renders');
    mkdirSync(OUT, { recursive: true });
    xvfb = spawn('Xvfb', [DISPLAY, '-screen', '0', '1700x1100x24', '-nolisten', 'tcp'], { stdio: 'ignore' });
    await sleep(800);
    const env = { ...process.env, DISPLAY, PATH: `${FAKE}:${process.env.PATH}`, REPACKSHOT_BROWSER: join(FAKE, 'browser'), HOME: DIR, XDG_CONFIG_HOME: join(DIR, 'config'), XDG_DOWNLOAD_DIR: join(DIR, 'Downloads') };
    let log = '';
    launcher = spawn(exe, ['--app-dir', join(ROOT, 'dist'), '--port', String(PORT)], { cwd: DIR, env, stdio: ['ignore', 'pipe', 'pipe'] });
    launcher.stdout.on('data', (d) => (log += d));
    launcher.stderr.on('data', (d) => (log += d));
    await waitHttp(`http://127.0.0.1:${CDP}/json/version`, 60000);
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP}`);
    const page = await until(() => browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().startsWith(`http://127.0.0.1:${PORT}/`)), 30000, 'the app window');
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.waitForSelector('#app[data-ready="1"]', { timeout: 90000 });

    // (a) What the launcher gave the window.
    const passed = readFileSync(join(FAKE, 'browser-args.txt'), 'utf8').trim().split('\n');
    const prefs = JSON.parse(readFileSync(join(DIR, 'data', 'browser-profile', 'Default', 'Preferences'), 'utf8'));
    const need = ['--no-first-run', '--no-default-browser-check', '--hide-crash-restore-bubble', '--disable-sync', '--disable-extensions', '--deny-permission-prompts', '--disable-pinch', '--overscroll-history-navigation=0', '--disable-component-update', '--password-store=basic', '--class=Repackshot'];
    const missing = need.filter((f) => !passed.includes(f));
    const features = passed.filter((a) => a.startsWith('--disable-features='));
    check('a_hardened_window', missing.length === 0 && features.length === 1 && features[0].includes('Translate') && features[0].includes('msWebOOUI') && prefs.translate?.enabled === false && prefs.browser?.enable_spellchecking === false && prefs.autofill?.profile_enabled === false && prefs.edge_quick_search?.show_mini_menu === false && prefs.credentials_enable_service === false, { missing, features, translate: prefs.translate?.enabled, spelling: prefs.browser?.enable_spellchecking, miniMenu: prefs.edge_quick_search?.show_mini_menu });

    // No browser bar over the page: an app window has no toolbar, so what the window has above the page is info bars.
    // The one this check causes itself (it runs Chromium as root, with --no-sandbox) is the only one allowed; the
    // "Google API keys are missing" bar of a keyless Chromium is gone (QUIET_ENV in browser.rs).
    const barHeight = await page.evaluate(() => window.outerHeight - window.innerHeight);
    check('a_no_browser_bars', barHeight < 80, { pixelsAbovePage: barHeight, note: 'one bar of ~52 px is the --no-sandbox warning of this harness' });

    // The example in Fast mode; location.replace keeps the window's single history entry (window.close needs it).
    await page.evaluate(() => location.replace('/?example=1&theme=dark&lang=en&mode=fast'));
    await page.waitForLoadState('load');
    await page.waitForSelector('#app[data-ready="1"]', { timeout: 90000 });
    await pageChecks(page, `http://127.0.0.1:${PORT}/`);

    // (d) Choose folder… and Render into it.
    await page.locator('canvas[aria-label="viewport"]').focus();
    await page.keyboard.press('Control+Enter');
    await page.waitForSelector('.rw');
    answer(OUT);
    const before = calls().length;
    await page.locator('.rw button', { hasText: 'Choose folder…' }).click();
    const realOut = realpathSync(OUT);
    await until(async () => (await page.locator('.rw-folder-name').textContent()) === realOut, 15000, 'the folder in the render window');
    const folderCall = calls()[before] ?? '';
    const note = await page.locator('.rw .note').allTextContents();
    const setNumber = async (selector, value) => {
      const el = page.locator(selector).first();
      await el.dblclick();
      await el.locator('input').fill(String(value));
      await el.locator('input').press('Enter');
    };
    await setNumber('.rw [data-section="rw.size"] .num[aria-label="Width"]', 96);
    await setNumber('.rw .num[aria-label="Samples"]', 4);
    await page.screenshot({ path: join(SHOTS, 'window-render.png') });
    spawnSync('import', ['-display', DISPLAY, '-window', 'root', join(SHOTS, 'window-x11.png')]);
    await page.locator('.rw-foot .btn-primary').click();
    const png = await until(() => readdirSync(OUT).find((n) => n.endsWith('.png')), 120000, 'the rendered PNG');
    const bytes = readFileSync(join(OUT, png));
    await page.waitForSelector('.rv', { timeout: 30000 });
    const openFolder = await page.locator('.rv button', { hasText: 'Open folder' }).count();
    if (openFolder) await page.locator('.rv button', { hasText: 'Open folder' }).click();
    await sleep(300);
    const shown = existsSync(join(FAKE, 'xdg-open.log')) ? readFileSync(join(FAKE, 'xdg-open.log'), 'utf8').trim() : '';
    check('d_render_into_a_chosen_folder', folderCall.includes('--directory') && bytes.subarray(1, 4).toString() === 'PNG' && openFolder === 1 && shown === realOut, { folderDialog: folderCall.split('\n').filter(Boolean), file: png, bytes: bytes.length, note, openFolder, shown });
    await page.keyboard.press('Escape');

    // (e) Projects, imports and exports through the dialogs.
    const proj = join(DIR, 'work', 'bottle.repack.json');
    mkdirSync(dirname(proj), { recursive: true });
    let n = calls().length;
    answer(proj);
    await page.keyboard.press('Control+s');
    await until(() => existsSync(proj), 30000, 'the saved project');
    const saveCall = calls()[n] ?? '';
    const saved = JSON.parse(readFileSync(proj, 'utf8'));
    const t1 = statSync(proj).mtimeMs;
    await sleep(1100);
    n = calls().length;
    await page.keyboard.press('Control+s');
    await until(() => statSync(proj).mtimeMs > t1, 30000, 'the project saved again');
    const askedAgain = calls().length > n;
    n = calls().length;
    answer(proj);
    await page.keyboard.press('Control+o');
    await until(async () => (await page.locator('.toast').allTextContents()).some((t) => t.includes('Opened')), 30000, 'the opened project');
    const openCall = calls()[n] ?? '';
    const obj = join(DIR, 'work', 'cube.obj');
    writeFileSync(obj, 'o cube\nv 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nf 1 2 3\nf 1 3 4\n');
    n = calls().length;
    answer(obj);
    await page.keyboard.press('Control+i');
    await page.waitForSelector('.import-sheet', { timeout: 30000 });
    const importCall = calls()[n] ?? '';
    await page.keyboard.press('Escape');
    const rsb = join(DIR, 'work', 'scene.rsb');
    n = calls().length;
    answer(rsb);
    await page.locator('canvas[aria-label="viewport"]').focus();
    await page.keyboard.press('Control+k');
    await page.keyboard.type('Export scene');
    await page.keyboard.press('Enter');
    await until(() => existsSync(rsb), 30000, 'the exported scene');
    const exportCall = calls()[n] ?? '';
    check('e_projects_imports_exports', saved.format && saveCall.includes('--save') && saveCall.includes('--filename=') && !askedAgain && openCall.includes('*.repack.json') && importCall.includes('*.obj') && readFileSync(rsb).subarray(0, 4).toString() === 'RSB1' && exportCall.includes('--save'), { format: saved.format, saveDialog: saveCall.split('\n').filter(Boolean).slice(0, 4), askedAgain, open: openCall.includes('*.repack.json'), importDialog: importCall.includes('*.obj'), rsb: existsSync(rsb) });

    // (f) Ctrl W with unsaved changes (a render setting of the project): our question, then the window closes and the
    // launcher ends.
    await page.locator('canvas[aria-label="viewport"]').focus();
    await page.keyboard.press('Control+Enter');
    await page.waitForSelector('.rw');
    await setNumber('.rw .num[aria-label="Samples"]', 5);
    await page.keyboard.press('Escape');
    await page.locator('canvas[aria-label="viewport"]').focus();
    await page.keyboard.press('Control+w');
    const question = page.locator('.floating', { hasText: 'before closing' });
    await question.waitFor({ timeout: 10000 });
    const text = await question.textContent();
    const t0 = Date.now();
    await question.locator('button', { hasText: 'Don’t save' }).click();
    const ended = await until(() => launcher.exitCode !== null, 30000, 'the launcher to end').catch(() => false);
    check('f_close_asks_our_question', !!text?.includes('before closing') && !!ended, { question: text, endedInMs: Date.now() - t0, errors });
    if (!ended) console.log(log);
  }
} catch (e) {
  failed++;
  console.error(`desktop-window-check: ${e.stack ?? e}`);
} finally {
  await browser?.close().catch(() => undefined);
  if (launcher && launcher.exitCode === null) launcher.kill();
  xvfb?.kill();
  if (server) {
    try {
      process.kill(-server.pid);
    } catch {
      // gone
    }
  }
  writeFileSync(join(ROOT, 'out', `desktop-window-check${WEB ? '-web' : ''}.json`), JSON.stringify(results, null, 2));
}
process.exit(failed ? 1 : 0);
