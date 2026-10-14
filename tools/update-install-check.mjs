#!/usr/bin/env node
// Browser check of phase P5, updating from inside the application, against the real desktop launcher
// (engine/crates/rt-app) with the local Chromium and swiftshader.
//
//   npm run build && (cd engine && cargo build --release -p rt-app) && node tools/update-install-check.mjs
//        [--shots docs/ui] [--bin engine/target/release/repackshot] [--wine-exe <repackshot.exe>] [--only linux|windows]
//
// GitHub is stood in by a local HTTP server. The page's own request for the latest release is answered by the
// check (Playwright routes api.github.com); the launcher downloads with the system's `curl`, so a `curl` that
// sits first in the launcher's PATH sends `https://github.com/…` to the local server and changes nothing else:
// the launcher is the real binary, its whitelist (only the feed's `releases/download/`) and its SHA-256 check run
// as they do in a release. The "new version" is a package made like the release's (packaging/lib/archive.mjs):
// the launcher itself, a copy of dist/ with a marker file, portable.txt.
//
// Linux portable, end to end, in a copy under out/update-check/linux/ (the folder is the "application folder"):
//   (a) the startup notice offers Install and restart (not Download), and Settings ▸ Updates has it too, with
//       Release notes; no word of a browser;
//   (b) a package whose sum does not match: the row says so, with Try again; nothing in the folder changed;
//   (c) with unsaved changes the question has Save · Save as… · Quit without saving, and Cancel; Esc dismisses it
//       and nothing is asked of the launcher; Try again with the right sum asks again;
//   (d) Quit without saving: the download shows "Downloading… NN% · X of Y MB" with a bar (the server stalls halfway,
//       so it can be looked at: the screenshot), the status-bar line follows it with Settings closed, and the row
//       is still there when Settings is opened again; Cancel the update goes back to the offer and the launcher is idle;
//   (e) installing for real: Verifying…, Installing…; the launcher stops by itself (no window to close) and the new
//       version starts on the same port with --after-update: the marker file is served from the new app/, the .old
//       files and the update folder are gone, data/ and portable.txt are as they were, the page says it was updated.
// Windows (installed copy), up to the installer: the same launcher built for Windows, run under Wine (which cannot
// run NSIS: the installer is a stand-in that writes the arguments it got), asks for the setup package, checks it and,
// when the launcher has stopped, starts it with /S /LAUNCH. Skipped, and said, when there is no Wine or no
// repackshot.exe (engine/target/x86_64-pc-windows-gnu/{release,debug}/ or --wine-exe).
//
// Screenshot (English, dark): docs/ui/update-install.png. Results: out/update-install-check.json.

import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collect, targz } from '../packaging/lib/archive.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const SHOTS = resolve(ROOT, opt('shots', 'docs/ui'));
const only = opt('only', '');
const BIN = resolve(ROOT, opt('bin', 'engine/target/release/repackshot'));
const OUT = join(ROOT, 'out');
const DIR = join(OUT, 'update-check');
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (b) => createHash('sha256').update(b).digest('hex');
const VERSION = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
const NEW = '0.2.0';
const NAME = `Repackshot-${NEW}`;
const MARKER = 'update-marker.txt';
const MARKER_TEXT = 'this file is only in the new version\n';
const FEED = 'https://github.com/Grohle-developer/Repackshot/releases/download/v0.2.0';
const API = 'https://api.github.com/repos/Grohle-developer/Repackshot/releases/latest';

if (!existsSync(BIN)) fail(`${BIN} is missing: (cd engine && cargo build --release -p rt-app)`);
if (!existsSync(join(ROOT, 'dist', 'index.html'))) fail('dist/ is missing: npm run build first');
const CURL = ['/usr/bin/curl', '/bin/curl'].find(existsSync) ?? fail('no curl on this computer');

// ------------------------------------------------------------------ the stand-in for GitHub

/**
 * Serves the release files under the path GitHub's downloads have. `hold` stalls the package halfway until it is
 * released, so that the row can be looked at; `requests` records what the launcher asked for.
 */
function startGithub() {
  const files = new Map();
  const state = { requests: [], hold: null, delay: 0 };
  const server = http.createServer(async (req, res) => {
    state.requests.push(`${req.method} ${req.url}`);
    const body = files.get(req.url);
    if (!body) {
      res.writeHead(404, { 'Content-Length': 0 });
      return res.end();
    }
    const m = /^bytes=(\d+)-$/.exec(req.headers.range ?? '');
    const start = m ? Number(m[1]) : 0;
    res.writeHead(m ? 206 : 200, { 'Content-Length': body.length - start, ...(m ? { 'Content-Range': `bytes ${start}-${body.length - 1}/${body.length}` } : {}) });
    const hold = state.hold;
    for (let at = start; at < body.length; at += 65536) {
      if (hold && at >= hold.at && req.url.endsWith('.tar.gz') && !hold.released) await hold.gate;
      if (state.delay) await sleep(state.delay);
      if (!res.write(body.subarray(at, Math.min(at + 65536, body.length)))) await new Promise((r) => res.once('drain', r));
      if (res.destroyed) return;
    }
    res.end();
  });
  return new Promise((resolveServer) => server.listen(0, '127.0.0.1', () => resolveServer({ server, files, state, port: server.address().port })));
}

/** A hold that stalls the package after `at` bytes until `release()`. */
function makeHold(at) {
  const hold = { at, released: false, release: () => undefined, gate: null };
  hold.gate = new Promise((r) => (hold.release = () => ((hold.released = true), r())));
  return hold;
}

/** `curl` for the launcher: the same curl, with github.com's downloads sent to the local server over http. */
function writeCurlShim(dir, port) {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, 'curl');
  writeFileSync(
    path,
    `#!/bin/sh
# Stands in for curl in the launcher's PATH: https://github.com/… is the local server; the rest is curl's.
n=$#
i=0
while [ "$i" -lt "$n" ]; do
  a="$1"
  shift
  case "$a" in
    https://github.com/*) a="http://127.0.0.1:${port}/\${a#https://github.com/}" ;;
    =https) a="=http" ;;
  esac
  set -- "$@" "$a"
  i=$((i + 1))
done
exec "${CURL}" "$@"
`,
  );
  chmodSync(path, 0o755);
}

// ------------------------------------------------------------------ the packages and the folders

const mtime = new Date(1767225600 * 1000);

/** The "new version" for Linux: the launcher itself, a copy of dist/ with the marker, portable.txt. */
function linuxPackage() {
  const stage = join(DIR, 'package', NAME);
  rmSync(join(DIR, 'package'), { recursive: true, force: true });
  mkdirSync(stage, { recursive: true });
  copyFileSync(BIN, join(stage, 'repackshot'));
  chmodSync(join(stage, 'repackshot'), 0o755);
  writeFileSync(join(stage, 'portable.txt'), 'Portable mode (the package’s own: the one in the folder stays).\n');
  writeFileSync(join(stage, 'LICENSE'), 'licence of the new version\n');
  cpSync(join(ROOT, 'dist'), join(stage, 'app'), { recursive: true });
  writeFileSync(join(stage, 'app', MARKER), MARKER_TEXT);
  return targz(collect(stage, NAME, (rel) => (rel === `${NAME}/repackshot` ? 0o755 : 0o644)), mtime);
}

/** The application folder of "version 0.1.x": a portable folder with data in it. */
function appFolder(name) {
  const dir = join(DIR, name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, 'data'), { recursive: true });
  copyFileSync(BIN, join(dir, 'repackshot'));
  chmodSync(join(dir, 'repackshot'), 0o755);
  writeFileSync(join(dir, 'portable.txt'), 'mine\n');
  writeFileSync(join(dir, 'LICENSE'), 'licence of the old version\n');
  writeFileSync(join(dir, 'data', 'sentinel.txt'), 'the person’s data\n');
  cpSync(join(ROOT, 'dist'), join(dir, 'app'), { recursive: true });
  return dir;
}

/** Every file of a folder with its size, except the data and the logs the launcher writes (what an update must not change). */
function listing(dir, skip = ['data']) {
  const out = [];
  const walk = (d, rel) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (!rel && skip.includes(e.name)) continue;
      if (e.isDirectory()) walk(join(d, e.name), r);
      else out.push(`${r}:${readFileSync(join(d, e.name)).length}`);
    }
  };
  walk(dir, '');
  return out.sort();
}

// ------------------------------------------------------------------ the launcher

/**
 * Starts the launcher of `dir` with the curl shim first in its PATH.
 * `urls` fills with every URL it prints: after an update, the new version prints its own on the same pipe.
 */
function startLauncher(dir, shimDir, { port }) {
  const urls = [];
  let text = '';
  const env = { ...process.env, PATH: `${shimDir}:${process.env.PATH}` };
  const argv = ['--serve-only', '--port', String(port)];
  const child = spawn(join(dir, 'repackshot'), argv, { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const exits = [];
  child.on('exit', (code, signal) => exits.push({ code, signal }));
  const read = (chunk) => {
    text += chunk.toString();
    for (const m of text.matchAll(/http:\/\/127\.0\.0\.1:\d+\/#token=[0-9a-f]{32}/g)) if (!urls.includes(m[0])) urls.push(m[0]);
  };
  child.stdout.on('data', read);
  child.stderr.on('data', read);
  const waitUrl = async (n, ms = 60000) => {
    const t0 = Date.now();
    while (urls.length < n) {
      if (Date.now() - t0 > ms) fail(`the launcher printed no URL number ${n}: ${text.slice(-1500)}`);
      await sleep(100);
    }
    return urls[n - 1];
  };
  return { child, urls, exits, waitUrl, log: () => text, dir };
}

/** Stops whatever is listening on `port` (the successor of an update is not our child). */
function stopPort(port) {
  const run = spawnSync('lsof', ['-t', '-i', `:${port}`]);
  for (const pid of run.stdout.toString().split(/\s+/).filter(Boolean)) {
    try {
      process.kill(Number(pid), 'SIGTERM');
    } catch {
      // Already gone.
    }
  }
}

const origin = (url) => url.replace(/\/#.*$/, '');
const tokenOf = (url) => /token=([0-9a-f]{32})/.exec(url)[1];
const api = async (url, path, init = {}) => {
  const res = await fetch(origin(url) + path, { ...init, headers: { 'X-Repackshot-Token': tokenOf(url), ...(init.headers ?? {}) } });
  return { status: res.status, body: await res.text() };
};
const apiJson = async (url, path) => JSON.parse((await api(url, path)).body);

// ------------------------------------------------------------------ the page

function findChromium() {
  for (const p of ['/opt/pw-browsers/chromium', ...[1194, 1200, 1217].map((v) => `/opt/pw-browsers/chromium-${v}/chrome-linux/chrome`)]) if (existsSync(p) && p !== '/opt/pw-browsers/chromium') return p;
  return '/opt/pw-browsers/chromium';
}
const chromium = (await import(join(ROOT, 'node_modules', 'playwright-core', 'index.mjs'))).chromium;
const browser = await chromium.launch({ executablePath: findChromium(), headless: true, args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });

const settle = (page, ms = 80) => page.evaluate((wait) => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, wait)))), ms);
const visible = (page, sel) => page.evaluate((s) => [...document.querySelectorAll(s)].some((e) => e.getClientRects().length > 0 && !e.hidden), sel);
const text = (page, sel) => page.evaluate((s) => [...document.querySelectorAll(s)].filter((e) => e.getClientRects().length > 0).map((e) => e.textContent.replace(/\s+/g, ' ').trim()).join(' | '), sel);
const buttons = (page, sel) => page.locator(`${sel} button`).allTextContents().then((l) => l.map((x) => x.trim()));

/** The release feed the page asks, as GitHub would answer, with the assets of the five files. */
function releaseJson(sizes) {
  const asset = (name) => ({ name, size: sizes[name] ?? 1000, browser_download_url: `${FEED}/${name}` });
  return {
    tag_name: `v${NEW}`,
    html_url: `https://github.com/Grohle-developer/Repackshot/releases/tag/v${NEW}`,
    published_at: '2026-10-14T09:30:00Z',
    assets: [`${NAME}-windows-x64-setup.exe`, `${NAME}-windows-x64-portable.zip`, `${NAME}-linux-x64-portable.tar.gz`, 'SHA256SUMS.txt'].map(asset),
  };
}

async function openPage(url, release, query, { ready = true, size = { width: 1600, height: 1000 } } = {}) {
  const context = await browser.newContext({ viewport: size, deviceScaleFactor: 1 });
  await context.route((u) => !['127.0.0.1', 'localhost'].includes(u.hostname), (route) => {
    if (route.request().url() === API) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(release) });
    return route.abort('failed');
  });
  // Every toast the page shows, kept as it appears (a toast lasts four seconds, and a slow page can miss it).
  await context.addInitScript(() => {
    window.__toasts = [];
    new MutationObserver(() => {
      for (const el of document.querySelectorAll('.toast')) if (el.textContent && !window.__toasts.includes(el.textContent)) window.__toasts.push(el.textContent);
    }).observe(document, { childList: true, subtree: true, characterData: true });
  });
  const page = await context.newPage();
  const errors = [];
  const calls = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && !m.text().startsWith('Failed to load resource') && errors.push(m.text()));
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (u.pathname.startsWith('/api/update') && r.method() !== 'GET') calls.push(`${r.method()} ${u.pathname}${r.postData() ? ` ${r.postData()}` : ''}`);
  });
  await page.goto(url.replace('/#', `/?${query}#`));
  if (ready) await page.waitForSelector('#app[data-ready="1"]', { timeout: 90000 });
  return { page, context, errors, calls };
}

const rowText = (page) => text(page, '.sw [data-row="updates.check"] .sw-update-out');

/** The project becomes unsaved: the name is edited in the header. */
async function makeDirty(page, name) {
  await page.locator('.project-name').click();
  await page.locator('.project-name input').fill(name);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('.project-name .dirty')?.style.display !== 'none');
}

// ------------------------------------------------------------------ Linux portable, end to end

async function linux(github, shimDir) {
  const pkg = linuxPackage();
  const pkgName = `${NAME}-linux-x64-portable.tar.gz`;
  const goodSums = `${sha(pkg)}  ${pkgName}\n${'e'.repeat(64)}  ${NAME}-windows-x64-portable.zip\n`;
  const badSums = `${sha(Buffer.from('another file'))}  ${pkgName}\n`;
  const path = (file) => `/Grohle-developer/Repackshot/releases/download/v${NEW}/${file}`;
  github.files.set(path(pkgName), pkg);
  github.files.set(path('SHA256SUMS.txt'), Buffer.from(badSums));
  const release = releaseJson({ [pkgName]: pkg.length, 'SHA256SUMS.txt': goodSums.length });

  const dir = appFolder('linux');
  const before = listing(dir);
  const port = 4300;
  const launcher = startLauncher(dir, shimDir, { port });
  const url = await launcher.waitUrl(1);
  const info = await apiJson(url, '/api/info');
  check('launcher_is_portable_and_knows_updates', info.portable === true && info.updateApi === 1 && info.afterUpdate === false && info.version === VERSION, { portable: info.portable, updateApi: info.updateApi, afterUpdate: info.afterUpdate, version: info.version });
  const idle = await apiJson(url, '/api/update');
  check('launcher_starts_idle_and_portable', idle.state === 'IDLE' && idle.mode === 'portable', idle);

  let { page, context, errors, calls } = await openPage(url, release, 'lang=en&theme=dark&mode=fast&example=1&tour=0');
  // A portable's first start opens the model chooser: out of the way.
  await page.waitForSelector('.sw .sw-chooser', { state: 'visible', timeout: 30000 });
  await page.keyboard.press('Escape');
  await settle(page, 200);
  await page.reload();
  await page.waitForSelector('#app[data-ready="1"]', { timeout: 90000 });

  // (a) the startup notice and the row
  await page.waitForSelector('.update-notice:not([hidden])', { timeout: 30000 });
  await settle(page, 200);
  const notice = await text(page, '.update-notice');
  const noticeButtons = await buttons(page, '.update-notice');
  check('notice_offers_install_and_restart', /Repackshot 0\.2\.0 is available/.test(notice) && noticeButtons.join('|') === 'Install and restart|Release notes|Later', { notice, noticeButtons });
  await makeDirty(page, 'Update check');
  const openUpdates = async () => {
    await page.keyboard.press('Control+,');
    await page.waitForSelector('[data-settings-window]', { timeout: 30000 });
    await page.locator('.sw-option[data-section="updates"]').click();
    await page.waitForSelector('.sw [data-row="updates.check"]', { timeout: 30000 });
  };
  await openUpdates();
  await page.locator('.sw [data-row="updates.check"] .sw-update-check').click();
  await page.waitForSelector('.sw-update-actions', { timeout: 30000 });
  const offer = await rowText(page);
  const offerButtons = await buttons(page, '.sw [data-row="updates.check"] .sw-update-actions');
  const sectionText = await text(page, '.sw-content');
  check('row_offers_install_and_restart', /Repackshot 0\.2\.0 is available/.test(offer) && offerButtons.join('|') === 'Install and restart|Release notes' && !/Download/.test(offer + offerButtons.join()), { offer, offerButtons });
  check('desktop_row_never_says_browser', !/browser/i.test(sectionText) && !/web version/i.test(sectionText), { sectionText: sectionText.slice(0, 300) });

  // (c) the question, in the row: three buttons and Cancel; Esc dismisses it
  const asked = calls.length;
  await page.locator('.sw .sw-update-install').click();
  await page.waitForSelector('.sw .sw-update-confirm .confirm', { timeout: 10000 });
  const question = await text(page, '.sw .sw-update-confirm .confirm-msg');
  const questionButtons = await buttons(page, '.sw .sw-update-confirm .confirm-actions');
  check('question_is_in_the_row_with_save_save_as_quit_and_cancel', question === 'Save changes to “Update check” before updating?' && questionButtons.join('|') === 'Save|Save as…|Quit without saving|Cancel', { question, questionButtons });
  await page.keyboard.press('Escape');
  await settle(page, 300);
  const afterEsc = { confirms: await page.locator('.confirm').count(), settings: await visible(page, '[data-settings-window]'), calls: calls.slice(asked), state: (await apiJson(url, '/api/update')).state };
  check('esc_dismisses_the_question_and_asks_nothing', afterEsc.confirms === 0 && afterEsc.settings && afterEsc.calls.length === 0 && afterEsc.state === 'IDLE', afterEsc);

  // (b) a sum that does not match
  await page.locator('.sw .sw-update-install').click();
  await page.waitForSelector('.sw .sw-update-confirm .confirm');
  await page.locator('.sw .sw-update-confirm .confirm button', { hasText: 'Quit without saving' }).click();
  await page.waitForSelector('.sw-update-failure', { timeout: 60000 }).catch(async (err) => {
    fail(`no failure in the row: ${err.message.split('\n')[0]}; row: ${await rowText(page)}; calls: ${JSON.stringify(calls)}; github: ${JSON.stringify(github.state.requests)}; errors: ${JSON.stringify(errors)}`);
  });
  const failure = await rowText(page);
  const failureButtons = await buttons(page, '.sw [data-row="updates.check"] .sw-update-actions');
  const failureCode = await page.getAttribute('.sw-update-failure', 'data-error');
  const afterBad = await apiJson(url, '/api/update');
  check('bad_sum_is_told_with_try_again', /The update failed: the downloaded file does not match its checksum, so it was not installed/.test(failure) && failureButtons[0] === 'Try again' && failureCode === 'checksum', { failure, failureButtons, failureCode });
  check('bad_sum_changes_nothing', JSON.stringify(listing(dir)) === JSON.stringify(before) && afterBad.state === 'FAILED' && afterBad.error === 'checksum' && !existsSync(join(dir, 'repackshot.old')) && !existsSync(join(dir, 'update.json')), { state: afterBad.state, error: afterBad.error });
  // The line in the status bar tells it too, with Settings closed.
  await page.keyboard.press('Escape');
  await settle(page, 200);
  const failedNotice = await text(page, '.update-notice');
  check('status_bar_follows_the_failure', /The update failed/.test(failedNotice) && /Try again/.test(failedNotice), { failedNotice });

  // (d) the right sum now: Try again from the status bar asks above the button; the download, halfway
  github.files.set(path('SHA256SUMS.txt'), Buffer.from(goodSums));
  const sent = calls.length;
  await page.locator('.update-notice .update-retry').click();
  await page.waitForSelector('.floating .confirm', { timeout: 10000 });
  const floatQuestion = await text(page, '.floating .confirm .confirm-msg');
  await page.keyboard.press('Escape');
  await settle(page, 300);
  check('status_bar_question_opens_above_its_button_and_esc_dismisses_it', floatQuestion === 'Save changes to “Update check” before updating?' && (await page.locator('.confirm').count()) === 0 && calls.length === sent, { floatQuestion });
  github.state.hold = makeHold(Math.floor(pkg.length * 0.45));
  await page.locator('.update-notice .update-retry').click();
  await page.waitForSelector('.floating .confirm');
  await page.locator('.floating .confirm button', { hasText: 'Quit without saving' }).click();
  await page.waitForFunction(() => Number(/(\d+)%/.exec(document.querySelector('.update-notice[data-version]')?.textContent ?? '')?.[1] ?? 0) >= 30, null, { timeout: 60000 }).catch(async (err) => {
    fail(`no progress: ${err.message.split('\n')[0]}; notice: ${await text(page, '.update-notice')}; api: ${JSON.stringify(await apiJson(url, '/api/update'))}; calls: ${JSON.stringify(calls)}; github: ${JSON.stringify(github.state.requests)}; errors: ${JSON.stringify(errors)}`);
  });
  const request = calls.at(-1);
  check('install_request_is_the_feeds_linux_package', request === `POST /api/update/install ${JSON.stringify({ tag: NEW, assetUrl: `${FEED}/${pkgName}`, sumsUrl: `${FEED}/SHA256SUMS.txt`, size: pkg.length })}`, { request });
  const during = await apiJson(url, '/api/update');
  check('launcher_is_downloading', during.state === 'DOWNLOADING' && during.total === pkg.length && during.received > 0 && during.received < pkg.length, during);
  // Settings was closed all the time: the line in the status bar follows the download; Settings opened now shows the row.
  const barLine = await text(page, '.update-notice');
  check('status_bar_shows_the_progress_with_settings_closed', /^Downloading… \d+% · [\d.]+ of [\d.]+ MB/.test(barLine) && !(await visible(page, '[data-settings-window]')), { barLine });
  await openUpdates();
  await page.waitForFunction(() => /Downloading… \d+% · /.test(document.querySelector('.sw-update-out')?.textContent ?? ''), null, { timeout: 30000 });
  await settle(page, 400);
  const progress = await rowText(page);
  const progressBar = await page.evaluate(() => ({ now: document.querySelector('.sw-update-bar')?.getAttribute('aria-valuenow'), width: document.querySelector('.sw-update-fill')?.style.width }));
  check('row_shows_downloading_with_percent_and_megabytes', /Downloading… \d+% · [\d.]+ of [\d.]+ MB/.test(progress) && progressBar.now !== null && progressBar.width === `${progressBar.now}%`, { progress, progressBar });
  // Closing Settings and opening it again does not stop it, and the launcher is still at it.
  await page.keyboard.press('Escape');
  await settle(page, 300);
  const still = await apiJson(url, '/api/update');
  await openUpdates();
  check('closing_settings_does_not_stop_the_download', still.state === 'DOWNLOADING' && /Downloading…/.test(await rowText(page)), { state: still.state });
  await page.mouse.move(5, 995);
  await page.screenshot({ path: join(SHOTS, 'update-install.png') });
  results.screenshot = { ok: true, path: 'docs/ui/update-install.png' };

  // Cancel the update: back to the offer, the launcher idle, nothing left in the cache
  await page.locator('.sw .sw-update-cancel').click();
  await page.waitForSelector('.sw .sw-update-install', { timeout: 30000 });
  github.state.hold.release();
  const cancelled = await apiJson(url, '/api/update');
  await sleep(300);
  check('cancel_goes_back_to_the_offer', cancelled.state === 'IDLE' && !existsSync(join(dir, 'data', 'cache', 'update')) && JSON.stringify(listing(dir)) === JSON.stringify(before) && calls.at(-1) === 'POST /api/update/cancel', { state: cancelled.state, last: calls.at(-1) });

  // (e) for real
  github.state.hold = null;
  await page.locator('.sw .sw-update-install').click();
  await page.waitForSelector('.sw .sw-update-confirm .confirm');
  await page.locator('.sw .sw-update-confirm .confirm button', { hasText: 'Quit without saving' }).click();
  // The launcher has no window to close here, so it stops itself once the files are in place and the new version starts.
  const secondUrl = await launcher.waitUrl(2, 90000);
  const t0 = Date.now();
  while (launcher.exits.length === 0 && Date.now() - t0 < 30000) await sleep(100);
  check('old_launcher_stopped_by_itself', launcher.exits.length === 1 && launcher.exits[0].code === 0, { exits: launcher.exits });
  check('new_version_listens_on_the_same_port', origin(secondUrl) === origin(url) && tokenOf(secondUrl) !== tokenOf(url), { first: origin(url), second: origin(secondUrl) });
  await context.close();
  await sleep(2500);

  const newInfo = await apiJson(secondUrl, '/api/info');
  check('new_launcher_knows_it_was_started_by_an_update', newInfo.afterUpdate === true && newInfo.portable === true, { afterUpdate: newInfo.afterUpdate, portable: newInfo.portable });
  const marker = await fetch(`${origin(secondUrl)}/${MARKER}`);
  check('marker_is_served_from_the_new_app', marker.status === 200 && (await marker.text()) === MARKER_TEXT, { status: marker.status });
  const names = readdirSync(dir).sort();
  check('old_files_and_update_folder_are_gone', !names.some((n) => /\.old|^update/.test(n)) && !existsSync(join(dir, 'app.old')), { names });
  check('data_and_portable_mark_are_untouched', readFileSync(join(dir, 'data', 'sentinel.txt'), 'utf8') === 'the person’s data\n' && readFileSync(join(dir, 'portable.txt'), 'utf8') === 'mine\n', {});
  check('new_files_are_in_place', readFileSync(join(dir, 'LICENSE'), 'utf8') === 'licence of the new version\n' && existsSync(join(dir, 'app', MARKER)), {});
  const log = readFileSync(join(dir, 'data', 'logs', 'repackshot.log'), 'utf8');
  check('log_tells_the_update_and_the_clean_up', /update 0\.2\.0: ready, waiting for the window to close/.test(log) && /started by an update/.test(log) && /update: removed .*repackshot\.old/.test(log) && /the new version started/.test(log), { tail: log.split('\n').slice(-12) });

  // The new version in a window: it says it was updated, and the interface is the new app/.
  const second = await openPage(secondUrl, release, 'lang=en&theme=dark&mode=fast&example=1&tour=0', { ready: false });
  await second.page.waitForFunction(() => window.__toasts.length > 0, null, { timeout: 60000 });
  const toasts = await second.page.evaluate(() => window.__toasts);
  check('page_says_it_was_updated', toasts.includes(`Repackshot was updated to version ${VERSION}`), { toasts });
  await second.page.waitForSelector('#app[data-ready="1"]', { timeout: 90000 });
  check('no_page_errors_linux', errors.length === 0 && second.errors.length === 0, { errors, second: second.errors });
  await second.context.close();
  stopPort(port);
  launcher.child.kill('SIGTERM');
}

// ------------------------------------------------------------------ Windows, installed, up to the installer

/** A Windows program that writes its arguments next to itself (what the installer stand-in is), built with rustc. */
function buildWindowsTool(name, source, outDir) {
  mkdirSync(outDir, { recursive: true });
  const src = join(outDir, `${name}.rs`);
  writeFileSync(src, source);
  const exe = join(outDir, `${name}.exe`);
  const run = spawnSync('rustc', ['--edition', '2021', '-O', '--target', 'x86_64-pc-windows-gnu', '-o', exe, src], { encoding: 'utf8' });
  if (run.status !== 0) fail(`rustc ${name}: ${run.stderr}`);
  return exe;
}

async function windows(github, wineExe) {
  const setupName = `${NAME}-windows-x64-setup.exe`;
  const path = (file) => `/Grohle-developer/Repackshot/releases/download/v${NEW}/${file}`;
  const dir = join(DIR, 'windows');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  copyFileSync(wineExe, join(dir, 'repackshot.exe'));
  cpSync(join(ROOT, 'dist'), join(dir, 'app'), { recursive: true });
  // Installed: no portable.txt, the installer's uninstaller beside the program; the data folder is %LOCALAPPDATA%\Repackshot,
  // in the throwaway Wine prefix below.
  writeFileSync(join(dir, 'uninstall.exe'), 'the installer’s uninstaller\n');
  // A throwaway prefix, where Wine's System32 gets the stand-in for curl.exe (Wine has none; the launcher looks there first).
  const prefix = join(DIR, 'wine-prefix');
  const env = { ...process.env, WINEPREFIX: prefix, WINEDEBUG: '-all', LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' };
  spawnSync('wineboot', ['-i'], { env, stdio: 'ignore' });
  const tools = join(DIR, 'windows-tools');
  const curl = buildWindowsTool(
    'curl',
    `use std::io::{Read, Write};
use std::net::TcpStream;
fn main() {
    let a: Vec<String> = std::env::args().skip(1).collect();
    let url = a.iter().position(|x| x == "--url").map(|i| a[i + 1].clone()).unwrap_or_default();
    let rest = url.strip_prefix("https://github.com/").unwrap_or("");
    let mut s = TcpStream::connect(("127.0.0.1", ${github.port})).expect("connect");
    write!(s, "GET /{rest} HTTP/1.0\\r\\nHost: 127.0.0.1\\r\\n\\r\\n").unwrap();
    let mut all = Vec::new();
    s.read_to_end(&mut all).unwrap();
    let at = all.windows(4).position(|w| w == b"\\r\\n\\r\\n").map(|i| i + 4).unwrap_or(0);
    let head = String::from_utf8_lossy(&all[..at]).to_string();
    if !head.starts_with("HTTP/1.0 200") && !head.starts_with("HTTP/1.1 200") {
        eprintln!("curl: (22) The requested URL returned error: {}", head.lines().next().unwrap_or(""));
        std::process::exit(22);
    }
    std::io::stdout().write_all(&all[at..]).unwrap();
}
`,
    tools,
  );
  mkdirSync(join(prefix, 'drive_c', 'windows', 'system32'), { recursive: true });
  copyFileSync(curl, join(prefix, 'drive_c', 'windows', 'system32', 'curl.exe'));
  // The stand-in for the installer: the arguments it got, in a file beside it.
  const setupTool = buildWindowsTool(
    'setup',
    `fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let exe = std::env::current_exe().unwrap();
    std::fs::write(exe.with_file_name("installer-ran.txt"), args.join(" ")).unwrap();
}
`,
    tools,
  );
  const setup = readFileSync(setupTool);
  github.files.set(path(setupName), setup);
  github.files.set(path('SHA256SUMS.txt'), Buffer.from(`${sha(setup)}  ${setupName}\n`));
  const release = releaseJson({ [setupName]: setup.length, 'SHA256SUMS.txt': 100 });
  const port = 4301;
  const argv = [join(dir, 'repackshot.exe'), '--serve-only', '--port', String(port)];
  const child = spawn('wine', argv, { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const exits = [];
  child.on('exit', (code, signal) => exits.push({ code, signal }));
  let out = '';
  child.stdout.on('data', (d) => (out += d));
  child.stderr.on('data', (d) => (out += d));
  const t1 = Date.now();
  while (!/http:\/\/127\.0\.0\.1:\d+\/#token=[0-9a-f]{32}/.test(out)) {
    if (Date.now() - t1 > 120000) fail(`the Windows launcher printed no URL: ${out.slice(-800)}`);
    await sleep(200);
  }
  const url = /http:\/\/127\.0\.0\.1:\d+\/#token=[0-9a-f]{32}/.exec(out)[0];
  const status = await apiJson(url, '/api/update');
  const info = await apiJson(url, '/api/info');
  check('windows_launcher_is_an_installed_copy', status.mode === 'installer' && info.os === 'windows' && info.portable === false && info.updateApi === 1, { mode: status.mode, os: info.os, portable: info.portable });
  const { page, context, errors, calls } = await openPage(url, release, 'lang=en&theme=dark&mode=fast&example=1&tour=0&settings=updates');
  await page.waitForSelector('.sw [data-row="updates.check"]', { timeout: 60000 });
  await page.waitForSelector('.sw .sw-update-actions', { timeout: 30000 });
  await page.locator('.sw .sw-update-install').click();
  // The example project is unsaved: the question comes in the row.
  await page.waitForSelector('.sw .sw-update-confirm .confirm', { timeout: 10000 });
  await page.locator('.sw .sw-update-confirm .confirm button', { hasText: 'Quit without saving' }).click();
  const t0 = Date.now();
  while (exits.length === 0 && Date.now() - t0 < 120000) await sleep(200);
  const request = calls.find((c) => c.startsWith('POST /api/update/install'));
  check('windows_request_is_the_setup_package', request === `POST /api/update/install ${JSON.stringify({ tag: NEW, assetUrl: `${FEED}/${setupName}`, sumsUrl: `${FEED}/SHA256SUMS.txt`, size: setup.length })}`, { request });
  const data = join(prefix, 'drive_c', info.dataDir.replace(/^[A-Za-z]:\\/, '').replaceAll('\\', '/'));
  const ran = join(data, 'cache', 'update', 'installer-ran.txt');
  const tw = Date.now();
  while (!existsSync(ran) && Date.now() - tw < 20000) await sleep(200);
  const given = existsSync(ran) ? readFileSync(ran, 'utf8') : null;
  check('windows_installer_started_silently_with_launch', exits.length === 1 && exits[0].code === 0 && given === '/S /LAUNCH', { exits, given, data });
  check('windows_program_untouched_until_the_installer_runs', existsSync(join(dir, 'repackshot.exe')) && readdirSync(dir).every((n) => !/\.old/.test(n)), {});
  check('no_page_errors_windows', errors.length === 0, { errors });
  await context.close();
  child.kill('SIGTERM');
  spawnSync('wineserver', ['-k'], { env });
}

// ------------------------------------------------------------------ run

let github;
try {
  rmSync(DIR, { recursive: true, force: true });
  mkdirSync(DIR, { recursive: true });
  github = await startGithub();
  const shimDir = join(DIR, 'shim');
  writeCurlShim(shimDir, github.port);
  if (only !== 'windows') await linux(github, shimDir);

  const wineExe = [opt('wine-exe', ''), join(ROOT, 'engine', 'target', 'x86_64-pc-windows-gnu', 'release', 'repackshot.exe'), join(ROOT, 'engine', 'target', 'x86_64-pc-windows-gnu', 'debug', 'repackshot.exe')].find((p) => p && existsSync(p));
  const hasWine = spawnSync('wine', ['--version']).status === 0;
  if (only === 'linux') console.log('(only the Linux part)');
  else if (wineExe && hasWine) await windows(github, wineExe);
  else {
    results.windows_installer_path = { ok: true, skipped: true, why: wineExe ? 'no wine' : 'no repackshot.exe for x86_64-pc-windows-gnu' };
    console.log(`skip windows_installer_path ${JSON.stringify(results.windows_installer_path)}`);
  }
} catch (err) {
  check('check_ran_to_the_end', false, { error: String(err?.stack ?? err) });
} finally {
  await browser.close();
  github?.server.close();
  stopPort(4300);
  stopPort(4301);
  writeFileSync(join(OUT, 'update-install-check.json'), JSON.stringify(results, null, 2));
}
const bad = Object.entries(results).filter(([, v]) => !v.ok);
console.log(`\n${Object.keys(results).length - bad.length}/${Object.keys(results).length} checks passed`);
process.exit(bad.length ? 1 : 0);
