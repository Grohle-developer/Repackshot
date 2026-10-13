#!/usr/bin/env node
// Browser checks of Settings ▸ Updates and the check at startup, with the local Chromium and swiftshader.
//
//   npm run build && node tools/updates-check.mjs [--shots docs/ui]
//
// It serves dist/ with `vite preview --port 4187 --strictPort` (stopped by the pid `lsof -t -i :4187` reports,
// never `pkill -f`). No request leaves the machine: every request to a host other than localhost is answered by
// the check itself (api.github.com's `releases/latest`, with the answers below) or aborted and reported.
//
//   (a) a newer release: the startup check asks the feed once, in the background, and a quiet notice appears in
//       the status bar (Download · Release notes · Later) with no window opened by itself; the Updates section
//       sits right above About and shows the release, its date, Download and Release notes; Download opens
//       the release page (the web has no package) and Release notes the same, with `noopener`; Later hides the
//       notice and it comes back after a reload (the next start);
//   (b) Check at startup off: a reload asks nothing and shows no notice, and the section still shows the last
//       known result and when it was; Check for updates shows "Checking…" and then the result, no notice;
//   (c) every failure reads honestly, in English and in Spanish: 404 (private repository), the rate limit,
//       no connection, an answer that is not JSON, a timeout is covered by the unit tests;
//   (d) 404 from the first start (today's situation): no notice, no error, the honest message in the section
//       and "Never" as the last check;
//   (e) the desktop application (the launcher faked at /api/info): Download opens the installer, the portable
//       zip or the tar.gz of the release for that computer.
//
// Screenshot (English, the newer-release case): settings-updates.png. Results: out/updates-check.json.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4187;
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const SHOTS = resolve(ROOT, opt('shots', 'docs/ui'));
const OUT = join(ROOT, 'out');
mkdirSync(OUT, { recursive: true });
mkdirSync(SHOTS, { recursive: true });
const BASE_URL = `http://localhost:${PORT}`;
const FEED_URL = 'https://api.github.com/repos/Grohle-developer/Repackshot/releases/latest';
const results = {};
const fail = (msg) => {
  throw new Error(msg);
};
const check = (key, ok, detail) => {
  results[key] = { ok: Boolean(ok), ...detail };
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${key} ${JSON.stringify(detail)}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------ the preview server

function stopPort(port) {
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
    await sleep(250);
  }
  fail(`${url} did not answer`);
}

async function preview() {
  stopPort(PORT);
  await sleep(500);
  spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: 'ignore', detached: true }).unref();
  await waitFor(BASE_URL);
}

// ------------------------------------------------------------------ the fake feed

const DL = 'https://github.com/Grohle-developer/Repackshot/releases/download/v0.2.0';
const RELEASE_PAGE = 'https://github.com/Grohle-developer/Repackshot/releases/tag/v0.2.0';
const asset = (name, size) => ({ id: size, name, size, content_type: 'application/octet-stream', state: 'uploaded', browser_download_url: `${DL}/${name}` });
const NEWER = {
  url: 'https://api.github.com/repos/Grohle-developer/Repackshot/releases/301',
  html_url: RELEASE_PAGE,
  id: 301,
  tag_name: 'v0.2.0',
  name: 'Repackshot 0.2.0',
  draft: false,
  prerelease: false,
  created_at: '2026-10-14T08:00:00Z',
  published_at: '2026-10-14T09:30:00Z',
  assets: [asset('Repackshot-0.2.0-windows-x64-setup.exe', 38_400_000), asset('Repackshot-0.2.0-windows-x64-portable.zip', 41_000_000), asset('Repackshot-0.2.0-linux-x64-portable.tar.gz', 39_000_000), asset('SHA256SUMS.txt', 300)],
  body: '## 0.2.0',
};
// What GitHub's CORS headers expose, so the page can read the rate-limit headers.
const CORS = { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'ETag, Link, Retry-After, X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset, X-RateLimit-Used, X-RateLimit-Resource' };
const json = (status, body, headers = {}) => ({ status, contentType: 'application/json; charset=utf-8', headers: { ...CORS, ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });

/** How the fake feed answers now; `calls` are the requests that reached it. */
function makeFeed(mode) {
  return {
    mode,
    delay: 0,
    calls: [],
    answer() {
      switch (this.mode) {
        case 'newer':
          return json(200, NEWER);
        case '404':
          return json(404, { message: 'Not Found', documentation_url: 'https://docs.github.com/rest/releases/releases#get-the-latest-release' });
        case 'limit':
          return json(403, { message: 'API rate limit exceeded for 203.0.113.9.' }, { 'x-ratelimit-limit': '60', 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1760000000' });
        case 'html':
          return { status: 200, contentType: 'text/html', headers: CORS, body: '<html><body>Maintenance</body></html>' };
        default:
          return null; // 'offline': the connection fails
      }
    },
  };
}

// ------------------------------------------------------------------ browser helpers

const external = [];
const OPENED = `window.__opened = []; window.open = (...a) => { window.__opened.push(a); return null; };`;

async function newPage(browser, feed, { launcher = null } = {}) {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
  await context.route(
    (url) => url.hostname !== 'localhost' && url.hostname !== '127.0.0.1',
    async (route) => {
      const req = route.request();
      if (req.url() !== FEED_URL) {
        external.push(req.url());
        await route.abort();
        return;
      }
      feed.calls.push({ method: req.method(), accept: req.headers().accept ?? null, at: Date.now() });
      if (feed.delay) await sleep(feed.delay);
      const a = feed.answer();
      if (a) await route.fulfill(a);
      else await route.abort('connectionrefused');
    },
  );
  if (launcher) {
    // The desktop launcher, faked: only /api/info answers, so the page believes it runs in its window.
    await context.route(`${BASE_URL}/api/**`, async (route) => {
      if (new URL(route.request().url()).pathname === '/api/info') {
        await route.fulfill(json(200, { app: 'repackshot', version: '0.1.0', engineVersion: '0.3.0', threads: 4, isa: 'avx2', simd: ['avx2'], dataDir: 'D:\\Repackshot\\data', modelsDir: 'D:\\m', logsDir: 'D:\\l', resultsDir: 'D:\\r', browser: 'msedge', pid: 1, ...launcher }));
      } else await route.fulfill(json(404, { error: 'not_found' }));
    });
  }
  const page = await context.newPage();
  await page.addInitScript(OPENED);
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  // The feed answering 404 or failing is logged by the browser itself ("Failed to load resource"): that one is expected.
  page.on('console', (m) => m.type() === 'error' && !m.location().url.startsWith('https://api.github.com/') && errors.push(m.text()));
  return { context, page, errors };
}

async function go(page, query = 'lang=en&theme=dark&mode=fast&example=1', hash = '') {
  await page.goto(`${BASE_URL}/?${query}${hash}`);
  await page.waitForSelector('#app[data-ready="1"]', { timeout: 90000 });
}

const noticeShown = (page, ms = 20000) => page.waitForSelector('.update-notice:not([hidden]) .update-text', { timeout: ms }).then(() => true, () => false);

async function openUpdates(page) {
  if (!(await page.locator('.sw').count())) {
    await page.locator('canvas[aria-label="viewport"]').focus();
    await page.keyboard.press('Control+Comma');
    await page.waitForSelector('.sw[role="dialog"]');
  }
  await page.locator('.sw .sw-option[data-section="updates"]').click();
  await page.waitForSelector('.sw [data-row="updates.check"]');
}

const norm = (s) => (s ?? '').replace(/\s+/g, ' ').trim();
const out = (page) => page.locator('.sw .sw-update-out');
const result = async (page) => ({ state: await out(page).getAttribute('data-state'), text: norm(await out(page).innerText()) });
const waitState = (page, state) => page.waitForFunction((s) => document.querySelector('.sw .sw-update-out')?.getAttribute('data-state') === s, state, { timeout: 15000 });
const opened = (page) => page.evaluate(() => window.__opened);

/** Presses Check for updates and waits until it is not checking any more. */
async function press(page) {
  await page.locator('.sw .sw-update-check').click();
  await page.waitForFunction(() => document.querySelector('.sw .sw-update-out')?.getAttribute('data-state') !== 'CHECKING', null, { timeout: 15000 });
}

// ------------------------------------------------------------------ main

let browser = null;
try {
  if (!existsSync(join(ROOT, 'dist', 'index.html'))) fail('dist/ is missing: npm run build first');
  await preview();
  const { chromium } = await import(join(ROOT, 'node_modules', 'playwright-core', 'index.mjs'));
  browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true, args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });

  // ---- (a) a newer release
  {
    const feed = makeFeed('newer');
    const { context, page, errors } = await newPage(browser, feed);
    await go(page);
    const shown = await noticeShown(page);
    const notice = norm(await page.locator('.update-notice').innerText());
    const buttons = await page.locator('.update-notice button').allInnerTexts();
    const windows = await page.locator('.sw, .rw, .floating, .palette').count();
    const overflow = await page.evaluate(() => {
      const s = document.querySelector('.status');
      return s.scrollWidth - s.clientWidth;
    });
    check('a_startup_notice', shown && notice.startsWith('Repackshot 0.2.0 is available') && buttons.join('|') === 'Download|Release notes|Later' && windows === 0 && overflow <= 0, { notice, buttons, windows, overflow });
    check('a_asked_once_like_github_wants', feed.calls.length === 1 && feed.calls[0].method === 'GET' && feed.calls[0].accept === 'application/vnd.github+json', { calls: feed.calls.length, accept: feed.calls[0]?.accept });

    await openUpdates(page);
    const options = (await page.locator('.sw .sw-option').allInnerTexts()).map(norm);
    const group = norm(await page.locator('.sw .sw-option[data-section="updates"]').evaluate((el) => el.closest('.sw-group')?.querySelector('.sw-group-title')?.textContent));
    const i = options.indexOf('Updates');
    check('a_section_above_about', i > 0 && options[i + 1] === 'About' && options[i - 1] === 'Storage' && group === 'System', { options, group });
    const current = norm(await page.locator('.sw [data-row="updates.current"]').innerText());
    const res = await result(page);
    const toggle = await page.locator('.sw [data-row="updates.atStartup"] [role="switch"]').getAttribute('aria-checked');
    const last = norm(await page.locator('.sw [data-row="updates.last"] .sw-value').innerText());
    const btns = (await page.locator('.sw .sw-update-actions button').allInnerTexts()).map(norm);
    check('a_section_shows_the_release', current.includes('Repackshot 0.1.0') && res.state === 'AVAILABLE' && res.text.includes('Repackshot 0.2.0 is available, published 14 Oct 2026') && btns.join('|') === 'Download|Release notes' && toggle === 'true' && last !== 'Never' && last.length > 6, { current, res, btns, toggle, last });
    check('a_no_coming_soon_row_left', (await page.locator('.sw .sw-badge', { hasText: 'coming soon' }).count()) === 0, {});
    await page.screenshot({ path: join(SHOTS, 'settings-updates.png') });

    await page.locator('.sw .sw-update-download').click();
    await page.locator('.sw .sw-update-notes').click();
    const links = await opened(page);
    check('a_links_open_the_release_page_noopener', links.length === 2 && links.every((a) => a[0] === RELEASE_PAGE && a[1] === '_blank' && a[2] === 'noopener'), { links });

    // Later: the notice goes; the next start announces again.
    await page.keyboard.press('Escape');
    await page.locator('.update-notice .update-later').click();
    const hidden = (await page.locator('.update-notice:not([hidden])').count()) === 0;
    await go(page);
    const again = await noticeShown(page);
    check('a_later_hides_until_next_start', hidden && again && feed.calls.length === 2, { hidden, again, calls: feed.calls.length });
    await page.locator('.update-notice .update-download').click();
    check('a_notice_download_opens_the_page', (await opened(page)).at(-1)?.[0] === RELEASE_PAGE, { opened: await opened(page) });

    // ---- (b) Check at startup off: nothing is asked; the last known result stays
    await openUpdates(page);
    await page.locator('.sw [data-row="updates.atStartup"] [role="switch"]').click();
    const off = await page.locator('.sw [data-row="updates.atStartup"] [role="switch"]').getAttribute('aria-checked');
    await sleep(400); // the settings are saved a moment after the change
    await go(page);
    await sleep(1500);
    const quiet = (await page.locator('.update-notice:not([hidden])').count()) === 0;
    await openUpdates(page);
    const known = await result(page);
    const lastKnown = norm(await page.locator('.sw [data-row="updates.last"] .sw-value').innerText());
    check('b_toggle_off_asks_nothing_and_remembers', off === 'false' && quiet && feed.calls.length === 2 && known.state === 'AVAILABLE' && known.text.includes('Repackshot 0.2.0 is available') && lastKnown !== 'Never', { off, quiet, calls: feed.calls.length, known, lastKnown });

    // Check for updates by hand: Checking…, then the result, and no notice.
    feed.delay = 700;
    await page.locator('.sw .sw-update-check').click();
    const busy = { label: norm(await page.locator('.sw .sw-update-check').innerText()), disabled: await page.locator('.sw .sw-update-check').isDisabled(), state: (await result(page)).state };
    await waitState(page, 'AVAILABLE');
    feed.delay = 0;
    check('b_manual_check', busy.label === 'Checking…' && busy.disabled && busy.state === 'CHECKING' && feed.calls.length === 3 && (await page.locator('.update-notice:not([hidden])').count()) === 0, { busy, calls: feed.calls.length });

    // The latest version: a release that is the one running.
    // ---- (c) the failures, each with its honest reason, the last known release still listed under it
    const failures = [
      ['404', 'Couldn’t check: No published releases found (the repository may be private or have no releases yet)'],
      ['limit', 'Couldn’t check: GitHub’s request limit was reached; try again later'],
      ['offline', 'Couldn’t check: No connection'],
      ['html', 'Couldn’t check: The release feed could not be read'],
    ];
    const seen = {};
    for (const [mode, text] of failures) {
      feed.mode = mode;
      await press(page);
      const r = await result(page);
      seen[mode] = r.state === 'FAILED' && r.text.startsWith(text) && r.text.includes('Repackshot 0.2.0 is available');
    }
    check('c_failures_read_honestly', Object.values(seen).every(Boolean), { seen });

    // In Spanish too: the same section, the same reasons.
    feed.mode = '404';
    await go(page, 'lang=es&theme=dark&mode=fast&example=1');
    await openUpdates(page);
    const optionsEs = (await page.locator('.sw .sw-option').allInnerTexts()).map(norm);
    await press(page);
    const es404 = await result(page);
    feed.mode = 'limit';
    await press(page);
    const esLimit = await result(page);
    feed.mode = 'offline';
    await press(page);
    const esOff = await result(page);
    await page.keyboard.press('Control+f');
    await page.keyboard.type('actualizaciones');
    const hits = (await page.locator('.sw .sw-hit .sw-hit-label').allInnerTexts()).map(norm);
    check(
      'c_spanish',
      optionsEs.includes('Actualizaciones') && optionsEs.indexOf('Actualizaciones') === optionsEs.indexOf('Acerca de') - 1 && es404.text.startsWith('No se pudo comprobar: No se encontró ninguna versión publicada (el repositorio puede ser privado o no tener versiones todavía)') && esLimit.text.startsWith('No se pudo comprobar: Se alcanzó el límite de peticiones de GitHub') && esOff.text.startsWith('No se pudo comprobar: Sin conexión') && hits[0] === 'Buscar actualizaciones',
      { optionsEs, es404: es404.text, esLimit: esLimit.text, esOff: esOff.text, hits },
    );

    // The search finds it in English by "updates" too.
    await go(page, 'lang=en&theme=dark&mode=fast&example=1');
    await page.locator('canvas[aria-label="viewport"]').focus();
    await page.keyboard.press('Control+Comma');
    await page.keyboard.press('Control+f');
    await page.keyboard.type('updates');
    const hitsEn = (await page.locator('.sw .sw-hit .sw-hit-label').allInnerTexts()).map(norm);
    check('c_search_in_english', hitsEn[0] === 'Check for updates' && hitsEn.includes('Check at startup'), { hitsEn });

    check('a_no_page_errors', errors.length === 0, { errors });
    await context.close();
  }

  // ---- (d) 404 from the first start: the repository is private today
  {
    const feed = makeFeed('404');
    const { context, page, errors } = await newPage(browser, feed);
    await go(page);
    await sleep(1500);
    const noNotice = (await page.locator('.update-notice:not([hidden])').count()) === 0 && (await page.locator('.toast').count()) === 0 && (await page.locator('.sw').count()) === 0;
    await openUpdates(page);
    const r = await result(page);
    const last = norm(await page.locator('.sw [data-row="updates.last"] .sw-value').innerText());
    const downloads = await page.locator('.sw .sw-update-download').count();
    check('d_404_reads_well', feed.calls.length === 1 && noNotice && r.state === 'FAILED' && r.text === 'Couldn’t check: No published releases found (the repository may be private or have no releases yet)' && last === 'Never' && downloads === 0 && errors.length === 0, { calls: feed.calls.length, noNotice, r, last, downloads, errors });
    await context.close();
  }

  // ---- (e) the desktop application: the package for that computer
  for (const [name, launcher, file] of [
    ['windows_installed', { os: 'windows', arch: 'x86_64', portable: false }, 'Repackshot-0.2.0-windows-x64-setup.exe'],
    ['windows_portable', { os: 'windows', arch: 'x86_64', portable: true }, 'Repackshot-0.2.0-windows-x64-portable.zip'],
    ['linux', { os: 'linux', arch: 'x86_64', portable: true }, 'Repackshot-0.2.0-linux-x64-portable.tar.gz'],
  ]) {
    const feed = makeFeed('newer');
    const { context, page } = await newPage(browser, feed, { launcher });
    await go(page, 'lang=en&theme=dark&mode=fast', `#token=${'ab'.repeat(16)}`);
    const shown = await noticeShown(page);
    await openUpdates(page);
    const options = (await page.locator('.sw .sw-option').allInnerTexts()).map(norm);
    const tip = await page.locator('.sw .sw-update-download').getAttribute('data-tip');
    await page.locator('.sw .sw-update-download').click();
    const links = await opened(page);
    const noticeDownload = await page.evaluate(() => document.querySelector('.update-notice .update-download') !== null);
    check(`e_desktop_${name}`, shown && noticeDownload && links.length === 1 && links[0][0] === `${DL}/${file}` && links[0][2] === 'noopener' && tip.includes(file) && options.indexOf('Updates') === options.indexOf('About') - 1 && options.indexOf('Desktop') === options.indexOf('Updates') - 1, { links, tip, options });
    await context.close();
  }

  check('z_nothing_left_the_machine', external.length === 0, { external });
} catch (err) {
  console.error(err?.stack ?? err);
  results.crashed = { ok: false, message: String(err?.message ?? err) };
} finally {
  await browser?.close();
  stopPort(PORT);
  writeFileSync(join(OUT, 'updates-check.json'), JSON.stringify(results, null, 2));
  const failed = Object.entries(results).filter(([, v]) => !v.ok);
  console.log(failed.length === 0 ? 'all updates checks passed' : `${failed.length} failed: ${failed.map(([k]) => k).join(', ')}`);
  process.exit(failed.length === 0 ? 0 : 1);
}
