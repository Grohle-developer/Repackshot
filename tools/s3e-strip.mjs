#!/usr/bin/env node
// The sheets of phase S3e (the studio floor, moving parts, the set's fine samples and the dust's motes; not part of
// `npm run qa`): the S3e scenes of the engine (rt_phys::example::s3e_strip), rendered by the native engine and laid side
// by side with their captions, for the eye that decides the values marked ◆ in the ROADMAP's S3e:
//
//   docs/ui/rain-moving.png  the drop scene's box under rain as it falls and after it lands (it gets wet where it is);
//   docs/ui/rain-floor.png   the bottle, the ledge that drips and the plate whose drops run down its side edge, over the
//                            studio floor (a shadow catcher) at 1, 3 and 5 s, and close on the dry patch under the ledge
//                            with the drips that fell on it;
//   docs/ui/dust-motes.png   the bottle on a large card of the set under a dust cloud at 30 and 120 s with the motes,
//                            and the edge of its dust shadow on the card at 120 s without and with the fine samples.
//
//   node tools/s3e-strip.mjs [--size 320x240] [--samples 96] [--threads 2]
//
// 1. builds the native engine if `engine/target/release/rt` is missing;
// 2. `rt --write-s3e-strip out/s3e-strip` writes one RSB file per frame;
// 3. renders each with `rt <file> -o <png> --size … --samples … --threads …`;
// 4. lays each sheet out in out/s3e-strip/<sheet>.html and takes its screenshot with the local Chromium (playwright-core).

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const SIZE = opt('size', '320x240');
const SAMPLES = opt('samples', '96');
const THREADS = opt('threads', '2');
const DIR = join(ROOT, 'out', 's3e-strip');
const RT = join(ROOT, 'engine', 'target', 'release', 'rt');

/** Each sheet: its file and its frames (the strip's names) with their captions. */
const SHEETS = [
  {
    out: 'docs/ui/rain-moving.png',
    frames: [
      ['moving-0', '0 s'],
      ['moving-36', '0.15 s'],
      ['moving-60', '0.25 s'],
      ['moving-84', '0.35 s'],
      ['moving-120', '0.5 s'],
      ['moving-480', '2 s'],
    ],
  },
  {
    out: 'docs/ui/rain-floor.png',
    frames: [
      ['floor-1', '1 s'],
      ['floor-3', '3 s'],
      ['floor-5', '5 s'],
      ['floor-close', '5 s, under the ledge'],
    ],
  },
  {
    out: 'docs/ui/dust-motes.png',
    frames: [
      ['dust-30', '30 s'],
      ['dust-120', '120 s'],
      ['edge-coarse', '120 s, the edge, coarse'],
      ['edge-fine', '120 s, the edge, fine'],
    ],
  },
];

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
if (!existsSync(RT)) run('cargo', ['build', '--release', '-p', 'rt-cli'], join(ROOT, 'engine'));
run(RT, ['--write-s3e-strip', DIR]);
const [w, h] = SIZE.split('x').map(Number);
const label = 22;
const { chromium } = await import('playwright-core');
const browser = await chromium.launch({ executablePath: findChromium(), headless: true, args: ['--no-sandbox', '--disable-gpu'] });
try {
  for (const sheet of SHEETS) {
    for (const [name] of sheet.frames) {
      const said = run(RT, [join(DIR, `s3e-${name}.rsb`), '-o', join(DIR, `s3e-${name}.png`), '--size', SIZE, '--samples', SAMPLES, '--threads', THREADS]);
      console.log(`${name}: ${said.trim().split('\n').pop()}`);
    }
    const html = `<!doctype html><meta charset="utf-8"><style>
html,body{margin:0;background:#111;color:#ddd;font:14px/1 system-ui,sans-serif}
.strip{display:flex;gap:4px;padding:4px}
figure{margin:0}figcaption{height:${label}px;line-height:${label}px;text-align:center}
img{display:block;width:${w}px;height:${h}px}
</style><div class="strip">${sheet.frames.map(([name, caption]) => `<figure><img src="s3e-${name}.png"><figcaption>${caption}</figcaption></figure>`).join('')}</div>`;
    const page = join(DIR, `${sheet.out.split('/').pop().replace('.png', '')}.html`);
    writeFileSync(page, html);
    const width = sheet.frames.length * (w + 4) + 4;
    const height = h + label + 8;
    const out = resolve(ROOT, sheet.out);
    mkdirSync(dirname(out), { recursive: true });
    const view = await browser.newPage({ viewport: { width, height } });
    await view.goto(pathToFileURL(page).href);
    await view.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth > 0));
    await view.screenshot({ path: out, clip: { x: 0, y: 0, width, height } });
    await view.close();
    console.log(`wrote ${out} (${sheet.frames.length} frames, ${width}×${height})`);
  }
} finally {
  await browser.close();
}
