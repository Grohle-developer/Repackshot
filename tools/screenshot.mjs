#!/usr/bin/env node
// Headless screenshot tool for Repackshot.
//
// Usage:
//   node tools/screenshot.mjs [outPath] [--width 1600] [--height 1000]
//                             [--url http://localhost:4173] [--wait 2000]
//
// Without --url it serves the production build (dist/) through
// `vite preview` on port 4173, so run `npm run build` first.

import { spawn } from 'node:child_process';
import { existsSync, readdirSync, mkdirSync, accessSync, statSync, constants } from 'node:fs';
import { dirname, delimiter, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PREVIEW_PORT = 4173;
const CHROMIUM_ARGS = [
  '--no-sandbox',
  '--disable-gpu',
  '--use-gl=swiftshader',
  '--enable-unsafe-swiftshader',
];

class UserError extends Error {}

function parseArgs(argv) {
  const opts = { out: 'out/screenshot.png', width: 1600, height: 1000, url: null, wait: 2000 };
  const intFlag = (name, value) => {
    const n = Number.parseInt(value, 10);
    if (!Number.isFinite(n) || n < 0) throw new UserError(`--${name} expects a non-negative integer, got "${value}"`);
    return n;
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') {
      console.log(
        'Usage: node tools/screenshot.mjs [outPath] [--width 1600] [--height 1000] [--url http://localhost:4173] [--wait 2000]',
      );
      process.exit(0);
    }
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      const name = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
      if (!['width', 'height', 'url', 'wait'].includes(name)) throw new UserError(`Unknown option: ${arg}`);
      let value;
      if (eq !== -1) value = arg.slice(eq + 1);
      else if (i + 1 < argv.length) value = argv[++i];
      if (value === undefined || value === '') throw new UserError(`Option --${name} needs a value`);
      if (name === 'url') opts.url = value;
      else opts[name] = intFlag(name, value);
    } else {
      opts.out = arg;
    }
  }
  if (opts.width < 1 || opts.height < 1) throw new UserError('--width and --height must be at least 1');
  return opts;
}

function isExecutable(file) {
  try {
    accessSync(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function findOnPath(name) {
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, name);
    if (existsSync(candidate) && isExecutable(candidate)) return candidate;
  }
  return null;
}

function findChromium() {
  const fromEnv = process.env.REPACKSHOT_CHROMIUM;
  if (fromEnv) {
    if (!existsSync(fromEnv)) throw new UserError(`REPACKSHOT_CHROMIUM points to a missing file: ${fromEnv}`);
    return fromEnv;
  }
  const bases = [...new Set([process.env.PLAYWRIGHT_BROWSERS_PATH, '/opt/pw-browsers'].filter(Boolean))];
  for (const base of bases) {
    const direct = join(base, 'chromium');
    if (isFile(direct)) return direct;
    let entries = [];
    try {
      entries = readdirSync(base).filter((n) => /^chromium-\d+$/.test(n));
    } catch {
      // Directory missing or unreadable: try the next base.
    }
    // Highest revision first.
    entries.sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
    for (const entry of entries) {
      const candidate = join(base, entry, 'chrome-linux', 'chrome');
      if (existsSync(candidate)) return candidate;
    }
  }
  for (const name of ['chromium', 'chromium-browser', 'google-chrome']) {
    const found = findOnPath(name);
    if (found) return found;
  }
  throw new UserError(
    'No Chromium found. Set REPACKSHOT_CHROMIUM to a Chromium/Chrome executable, ' +
      'or install chromium/chromium-browser/google-chrome on PATH.',
  );
}

function isFile(path) {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

async function waitForServer(url, child, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child && child.exitCode !== null) {
      throw new UserError(
        `vite preview exited early (code ${child.exitCode}). Is port ${PREVIEW_PORT} already in use? ` +
          'Pass --url to use a server that is already running.',
      );
    }
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (res.status < 500) return;
    } catch {
      // Not up yet.
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new UserError(`Timed out waiting for ${url} to answer.`);
}

function startPreview() {
  if (!existsSync(join(ROOT, 'dist', 'index.html'))) {
    throw new UserError('dist/ not found. Run `npm run build` first, or pass --url of a running server.');
  }
  // Detached so the whole process group (npx -> node -> vite) can be killed at once.
  const child = spawn('npx', ['vite', 'preview', '--port', String(PREVIEW_PORT), '--strictPort'], {
    cwd: ROOT,
    stdio: ['ignore', 'ignore', 'inherit'],
    detached: true,
  });
  child.on('error', (err) => console.error(`Failed to start vite preview: ${err.message}`));
  return child;
}

function stopPreview(child) {
  if (!child || child.exitCode !== null) return;
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    try {
      child.kill('SIGTERM');
    } catch {
      // Already gone.
    }
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const outPath = resolve(process.cwd(), opts.out);
  const executablePath = findChromium();

  let preview = null;
  let browser = null;
  const cleanup = () => stopPreview(preview);
  process.on('exit', cleanup);
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => {
      cleanup();
      process.exit(130);
    });
  }

  try {
    let url = opts.url;
    if (!url) {
      preview = startPreview();
      url = `http://localhost:${PREVIEW_PORT}`;
      await waitForServer(url, preview);
    }

    let chromium;
    try {
      ({ chromium } = await import('playwright-core'));
    } catch {
      throw new UserError('Cannot load playwright-core. Run `npm install` first.');
    }

    browser = await chromium.launch({ executablePath, headless: true, args: CHROMIUM_ARGS });
    const context = await browser.newContext({
      viewport: { width: opts.width, height: opts.height },
      deviceScaleFactor: 1,
      // The chrome's 120 ms transitions would otherwise be caught half way (a segmented button with its old
      // background and its new text colour); with reduced motion the page draws every state at once.
      reducedMotion: 'reduce',
    });
    const page = await context.newPage();
    page.on('pageerror', (err) => console.error(`[page error] ${err.message}`));
    page.on('console', (msg) => {
      // Failed loads are reported with their URL by the response handler below.
      if (msg.type() === 'error' && !msg.text().startsWith('Failed to load resource')) {
        console.error(`[console error] ${msg.text()}`);
      }
    });
    page.on('response', (res) => {
      // Browsers always probe /favicon.ico; a 404 there is expected and not worth reporting.
      if (res.status() >= 400 && !res.url().endsWith('/favicon.ico')) {
        console.error(`[http ${res.status()}] ${res.url()}`);
      }
    });

    await page.goto(url, { waitUntil: 'load', timeout: 30000 });
    try {
      await page.waitForSelector('#app[data-ready="1"]', { timeout: opts.wait });
    } catch {
      console.error(`Warning: #app[data-ready="1"] did not appear within ${opts.wait} ms; capturing anyway.`);
    }

    mkdirSync(dirname(outPath), { recursive: true });
    await page.screenshot({ path: outPath });
    console.log(outPath);
  } finally {
    if (browser) await browser.close().catch(() => {});
    cleanup();
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err instanceof UserError ? `Error: ${err.message}` : `Error: ${err?.stack ?? err}`);
    process.exit(1);
  },
);
