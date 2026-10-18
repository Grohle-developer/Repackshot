#!/usr/bin/env node
// The stored example of the AI section's preview (phase X6; not part of `npm run qa`): the reference scene (the example
// bottle as the app opens it) rendered by the Full engine, and its AI results at every step of every control through the
// real guard with the test model, stored in public/ai-preview/ for the render window to show without calling a model.
//
//   npm run engine:build && node tools/ai-preview-sheet.mjs [--size 512x288] [--samples 256] [--threads 4] [--quality 0.95]
//        [--closer 0.7] [--lower 40] [--encode-only]   (the camera at 0.7 of its distance, its target 40 mm lower)
//
// 1. builds the native engine if `engine/target/release/rt` is missing;
// 2. writes the scene and the guard's job through tests/ai-preview-dump.test.ts (stage `scene`; skipped by `npm test`);
// 3. renders it with `rt scene.rsb -o engine.png --ai-inputs inputs --samples N` (the Full engine, its linear image and
//    the guard's passes);
// 4. runs every example of the grid (src/core/ai-preview-sheet.ts) through post.wasm with the test model (stage `sheet`);
// 5. encodes each as WebP with the local Chromium (canvas.toBlob) into public/ai-preview/ with index.json, and writes a
//    contact sheet to out/ai-preview-sheet.html.
//
// The work files go to out/ai-preview-sheet/. Deterministic: the same engine, guard and test model give the same images.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const SIZE = opt('size', '512x288');
const SAMPLES = opt('samples', '256');
const THREADS = opt('threads', '4');
const CLOSER = opt("closer", "0.7");
const LOWER = opt("lower", "40");
const QUALITY = Number(opt('quality', '0.95'));
const WORK = join(ROOT, 'out', 'ai-preview-sheet');
const DEST = join(ROOT, 'public', 'ai-preview');
const RT = join(ROOT, 'engine', 'target', 'release', 'rt');

function run(cmd, cmdArgs, env = {}, cwd = ROOT) {
  const r = spawnSync(cmd, cmdArgs, { cwd, encoding: 'utf8', env: { ...process.env, ...env }, maxBuffer: 1 << 26 });
  if (r.error) throw r.error;
  if (r.status !== 0) {
    console.error(r.stdout, r.stderr);
    console.error(`${cmd} ${cmdArgs.join(' ')} exited with ${r.status}`);
    process.exit(r.status ?? 1);
  }
  return r.stdout;
}

mkdirSync(WORK, { recursive: true });
if (!existsSync(join(ROOT, 'public', 'engine', 'post.wasm'))) {
  console.error('public/engine/post.wasm is missing: npm run engine:build first');
  process.exit(1);
}
// --encode-only: the work files of a previous run, encoded again (another --quality).
const encodeOnly = args.includes('--encode-only');
let rendered = null;
if (!encodeOnly) {
  if (!existsSync(RT)) run('cargo', ['build', '--release', '-p', 'rt-cli'], {}, join(ROOT, 'engine'));
  const env = { REPACKSHOT_AI_PREVIEW_DIR: WORK, REPACKSHOT_AI_PREVIEW_SIZE: SIZE, REPACKSHOT_AI_PREVIEW_SPP: SAMPLES, REPACKSHOT_AI_PREVIEW_CLOSER: CLOSER, REPACKSHOT_AI_PREVIEW_LOWER: LOWER };
  run('npx', ['vitest', 'run', 'tests/ai-preview-dump.test.ts'], { ...env, REPACKSHOT_AI_PREVIEW_STAGE: 'scene' });
  const said = run(RT, [join(WORK, 'scene.rsb'), '-o', join(WORK, 'engine.png'), '--ai-inputs', join(WORK, 'inputs'), '--samples', SAMPLES, '--threads', THREADS]);
  rendered = /rendered (\d+) spp, (\d+) rays in ([\d.]+) s/.exec(said);
  console.log(`Full engine: ${rendered ? `${rendered[1]} spp in ${rendered[3]} s` : said.trim()}`);
  const t0 = Date.now();
  run('npx', ['vitest', 'run', 'tests/ai-preview-dump.test.ts'], { ...env, REPACKSHOT_AI_PREVIEW_STAGE: 'sheet' });
  console.log(`guard + test model: ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}
const sheet = JSON.parse(readFileSync(join(WORK, 'sheet.json'), 'utf8'));
console.log(`${sheet.entries.length} examples`);

// WebP with the local Chromium.
const { chromium } = await import(join(ROOT, 'node_modules', 'playwright-core', 'index.mjs'));
const browser = await chromium.launch({ executablePath: process.env.REPACKSHOT_CHROMIUM ?? '/opt/pw-browsers/chromium', headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
const encode = async (file) => {
  const rgba = readFileSync(join(WORK, file));
  const b64 = await page.evaluate(
    async ({ data, w, h, q }) => {
      const bytes = Uint8ClampedArray.from(atob(data), (c) => c.charCodeAt(0));
      const c = new OffscreenCanvas(w, h);
      c.getContext('2d').putImageData(new ImageData(bytes, w, h), 0, 0);
      const blob = await c.convertToBlob({ type: 'image/webp', quality: q });
      const buf = new Uint8Array(await blob.arrayBuffer());
      let s = '';
      for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      return btoa(s);
    },
    { data: rgba.toString('base64'), w: sheet.width, h: sheet.height, q: QUALITY },
  );
  return Buffer.from(b64, 'base64');
};
rmSync(DEST, { recursive: true, force: true });
mkdirSync(DEST, { recursive: true });
let bytes = 0;
const write = (name, buf) => {
  writeFileSync(join(DEST, name), buf);
  bytes += buf.length;
};
write('before.webp', await encode('before.rgba'));
const entries = [];
for (const e of sheet.entries) {
  const file = `${e.key}.webp`;
  write(file, await encode(`${e.key}.rgba`));
  entries.push({ key: e.key, settings: e.settings, file, report: e.report });
}
await browser.close();
const index = { version: 1, width: sheet.width, height: sheet.height, before: 'before.webp', scene: { name: 'example', samples: sheet.samples, engine: 'FULL' }, model: 'TEST_MODEL', entries, bytes };
writeFileSync(join(DEST, 'index.json'), JSON.stringify(index));
const total = readdirSync(DEST).reduce((n, f) => n + statSync(join(DEST, f)).size, 0);
console.log(`public/ai-preview/: ${entries.length + 1} images, ${(total / 1024 / 1024).toFixed(2)} MB with index.json`);

// The contact sheet: each control's row at Intervention 50, every style at 100, and Intervention's row.
const by = new Map(entries.map((e) => [e.key, e]));
const key = (s) => `i${s.intervention}-l${s.light}-b${s.bounce}-w${s.wear}-${s.style}-s${s.styleStrength}-${s.seed}`;
const base = entries.find((e) => e.settings.intervention === 50 && e.settings.seed === 0 && e.settings.style === 'NATURAL').settings;
const cell = (s, label) => {
  const e = by.get(key(s));
  return e ? `<figure><img src="../public/ai-preview/${e.file}" width="256" alt=""><figcaption>${label} · ${e.report.verdict}${e.report.usedFraction < 1 ? ` ${Math.round(e.report.usedFraction * 100)} %` : ''}</figcaption></figure>` : '';
};
const steps = [0, 25, 50, 75, 100];
const rows = [
  ['Intervention', steps.map((v) => (v === 0 ? `<figure><img src="../public/ai-preview/before.webp" width="256" alt=""><figcaption>0 · the engine</figcaption></figure>` : cell({ ...base, intervention: v }, v)))],
  ...['light', 'bounce', 'wear'].map((k) => [k, steps.map((v) => cell({ ...base, [k]: v }, v))]),
  ['styleStrength (Natural)', steps.map((v) => cell({ ...base, styleStrength: v }, v))],
  ['styles at 100', ['NATURAL', 'CATALOGUE', 'EDITORIAL', 'WARM', 'COOL', 'CINEMATIC'].map((s) => cell({ ...base, style: s, styleStrength: 100 }, s))],
  ['seeds', [0, 1, 2, 3].map((seed) => cell({ ...base, seed }, `seed ${seed}`))],
];
writeFileSync(
  join(ROOT, 'out', 'ai-preview-sheet.html'),
  `<!doctype html><meta charset="utf-8"><title>AI preview sheet</title><style>body{font:13px system-ui;background:#222;color:#ddd}figure{display:inline-block;margin:4px}h2{font-size:14px}</style><h1>AI preview sheet (X6)</h1><p>Example bottle, Full engine ${rendered?.[1] ?? SAMPLES} spp, ${sheet.width} × ${sheet.height}, test model, the others at the stored defaults (Intervention 50, Light 50, Bounces 50, Wear 25, Natural 25).</p>${rows.map(([name, cells]) => `<h2>${name}</h2>${cells.join('')}`).join('')}`,
);
console.log('out/ai-preview-sheet.html');
