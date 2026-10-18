#!/usr/bin/env node
// The strip of phase S3f (organic drops; not part of `npm run qa`): the organic parity scene of the engine
// (rt_phys::example::s3f_organic_scene_at) at the steps of `ORGANIC_STRIP_STEPS`, each frame aimed at the largest drop on
// the pane, rendered by the native engine and laid side by side with the time of each frame, for the eye that decides
// the values marked ◆ in the ROADMAP's S3f: a drop past its size slides down a pane through smaller pinned drops, gathers
// them (its path behind it is clean), grows and runs faster, stretched along its motion with a rounder head, its merges
// showing a neck for a moment, and leaves the beads of a rivulet once it is fast enough.
//
//   node tools/s3f-strip.mjs [--out docs/ui/rain-organic.png] [--size 320x240] [--samples 96] [--threads 2]
//
// 1. builds the native engine if `engine/target/release/rt` is missing;
// 2. `rt --write-s3f-strip out/s3f-strip` writes one RSB file per frame;
// 3. renders each with `rt <file> -o <png> --size … --samples … --threads …`;
// 4. lays them out in out/s3f-strip/strip.html and takes its screenshot with the local Chromium (playwright-core).

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const OUT = resolve(ROOT, opt('out', 'docs/ui/rain-organic.png'));
const SIZE = opt('size', '320x240');
const SAMPLES = opt('samples', '96');
const THREADS = opt('threads', '2');
const DIR = join(ROOT, 'out', 's3f-strip');
const RT = join(ROOT, 'engine', 'target', 'release', 'rt');
/** Steps per second of the simulation (rt-phys STEPS_PER_SECOND). */
const STEPS = 240;

function run(cmd, cmdArgs, cwd = ROOT) {
  const r = spawnSync(cmd, cmdArgs, { cwd, encoding: 'utf8', maxBuffer: 1 << 26 });
  if (r.error) throw r.error;
  if (r.status !== 0) {
    console.error(r.stdout, r.stderr);
    console.error(`${cmd} ${cmdArgs.join(' ')} exited with ${r.status}`);
    process.exit(r.status ?? 1);
  }
  return r.stdout;
}

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

mkdirSync(DIR, { recursive: true });
mkdirSync(dirname(OUT), { recursive: true });
if (!existsSync(RT)) run('cargo', ['build', '--release', '-p', 'rt-cli'], join(ROOT, 'engine'));
run(RT, ['--write-s3f-strip', DIR]);
const frames = readdirSync(DIR)
  .map((f) => /^s3f-strip-(\d+)\.rsb$/.exec(f))
  .filter(Boolean)
  .map((m) => Number(m[1]))
  .sort((a, b) => a - b);
for (const steps of frames) {
  const said = run(RT, [join(DIR, `s3f-strip-${steps}.rsb`), '-o', join(DIR, `s3f-strip-${steps}.png`), '--size', SIZE, '--samples', SAMPLES, '--threads', THREADS]);
  console.log(`${(steps / STEPS).toFixed(2)} s: ${said.trim().split('\n').pop()}`);
}
const [w, h] = SIZE.split('x').map(Number);
const label = 22;
const html = `<!doctype html><meta charset="utf-8"><style>
html,body{margin:0;background:#111;color:#ddd;font:14px/1 system-ui,sans-serif}
.strip{display:flex;gap:4px;padding:4px}
figure{margin:0}figcaption{height:${label}px;line-height:${label}px;text-align:center}
img{display:block;width:${w}px;height:${h}px}
</style><div class="strip">${frames.map((s) => `<figure><img src="s3f-strip-${s}.png"><figcaption>${(s / STEPS).toFixed(2)} s</figcaption></figure>`).join('')}</div>`;
const page = join(DIR, 'strip.html');
writeFileSync(page, html);
const width = frames.length * (w + 4) + 4;
const height = h + label + 8;
const { chromium } = await import('playwright-core');
const browser = await chromium.launch({ executablePath: findChromium(), headless: true, args: ['--no-sandbox', '--disable-gpu'] });
try {
  const pageView = await browser.newPage({ viewport: { width, height } });
  await pageView.goto(pathToFileURL(page).href);
  await pageView.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth > 0));
  await pageView.screenshot({ path: OUT, clip: { x: 0, y: 0, width, height } });
} finally {
  await browser.close();
}
console.log(`wrote ${OUT} (${frames.length} frames, ${width}×${height})`);
