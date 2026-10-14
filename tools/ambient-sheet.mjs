#!/usr/bin/env node
// Contact sheet of the ambient effects (phase S4a; not part of `npm run qa`): the eight presets on the example bottle
// under two lights, rain with three streak lengths and the dust cloud with two softnesses, for the eye that decides
// the presets' values; and the cost of 200 000 dust motes against no effect on the same bottle.
//
//   node tools/ambient-sheet.mjs [--out out/ambient-sheet] [--size 512x288] [--samples 128] [--threads 2]
//        [--cost-samples 16] [--only DUST_MOTES-side,cost-none,...]
//
// 1. builds the native engine if `engine/target/release/rt` is missing;
// 2. writes the RSB files through tests/ambient-rsb-dump.test.ts (skipped by `npm test` unless
//    REPACKSHOT_AMBIENT_RSB_DIR is set, which this tool does);
// 3. renders each with `rt <file> -o <png> --samples N --threads T` and keeps what `rt` says (the particles, the time
//    to evaluate them and build their BVHs, the render time);
// 4. writes <out>.html (out/ambient-sheet.html) with the PNGs of <out>/ next to it, and <out>/sheet.json.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const OUT = resolve(ROOT, opt('out', 'out/ambient-sheet'));
const HTML = `${OUT}.html`;
const SIZE = opt('size', '512x288');
const SAMPLES = opt('samples', '128');
const COST_SAMPLES = opt('cost-samples', '16');
const THREADS = opt('threads', '2');
const ONLY = opt('only', '').split(',').filter(Boolean);
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

mkdirSync(OUT, { recursive: true });
if (!existsSync(RT)) run('cargo', ['build', '--release', '-p', 'rt-cli'], {}, join(ROOT, 'engine'));

run('npx', ['vitest', 'run', 'tests/ambient-rsb-dump.test.ts'], {
  REPACKSHOT_AMBIENT_RSB_DIR: OUT,
  REPACKSHOT_AMBIENT_SIZE: SIZE,
  REPACKSHOT_AMBIENT_SPP: SAMPLES,
  REPACKSHOT_AMBIENT_COST_SPP: COST_SAMPLES,
});
const manifest = JSON.parse(readFileSync(join(OUT, 'shots.json'), 'utf8'));
const previous = existsSync(join(OUT, 'sheet.json')) ? JSON.parse(readFileSync(join(OUT, 'sheet.json'), 'utf8')) : { shots: [] };

const shots = [];
for (const shot of manifest.shots) {
  const old = previous.shots.find((s) => s.file === shot.file);
  if (ONLY.length > 0 && !ONLY.includes(shot.file)) {
    if (old) shots.push(old);
    continue;
  }
  const png = join(OUT, `${shot.file}.png`);
  const t0 = Date.now();
  const said = run(RT, [join(OUT, `${shot.file}.rsb`), '-o', png, '--samples', String(shot.samples), '--threads', THREADS]);
  const wall = (Date.now() - t0) / 1000;
  const rendered = /rendered (\d+) spp, (\d+) rays in ([\d.]+) s/.exec(said);
  const ambient = /ambient: (\d+) particles in (\d+) effects, evaluated with their BVHs in ([\d.]+) s/.exec(said);
  const entry = {
    ...shot,
    png: basename(png),
    wall,
    renderSeconds: rendered ? Number(rendered[3]) : null,
    rays: rendered ? Number(rendered[2]) : null,
    engineParticles: ambient ? Number(ambient[1]) : 0,
    evalSeconds: ambient ? Number(ambient[3]) : null,
  };
  shots.push(entry);
  console.log(`${shot.file}: ${entry.engineParticles} particles, eval ${entry.evalSeconds ?? '-'} s, render ${entry.renderSeconds} s`);
}

const by = (file) => shots.find((s) => s.file === file);
const none = by('cost-none');
const dust = by('cost-dust200k');
const cost =
  none && dust
    ? {
        samples: Number(COST_SAMPLES),
        threads: Number(THREADS),
        noneSeconds: none.renderSeconds,
        dustSeconds: dust.renderSeconds,
        dustEvalSeconds: dust.evalSeconds,
        ratio: dust.renderSeconds / none.renderSeconds,
        ratioWithEval: (dust.renderSeconds + dust.evalSeconds) / none.renderSeconds,
      }
    : null;
writeFileSync(join(OUT, 'sheet.json'), JSON.stringify({ size: SIZE, samples: Number(SAMPLES), threads: Number(THREADS), lights: manifest.lights, cost, shots }, null, 2));

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const rel = (f) => `${relative(dirname(HTML), OUT)}/${f}`;
const cell = (s) =>
  s
    ? `<figure><img src="${rel(s.png)}" alt="${esc(s.label)}" width="${manifest.width}" height="${manifest.height}"><figcaption>${esc(s.label)} · ${s.engineParticles.toLocaleString('en-US')} particles · ${s.renderSeconds} s</figcaption></figure>`
    : '<figure></figure>';
const presets = [...new Set(manifest.shots.filter((s) => s.row.startsWith('preset-')).map((s) => s.file.replace(/-(side|back)$/, '')))];
const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Ambient contact sheet</title>
<style>
  :root { color-scheme: dark; --bg: #111; --fg: #ddd; --mute: #888; --line: #333; }
  body { margin: 0; padding: 24px 16px; background: var(--bg); color: var(--fg); font: 13px/1.45 system-ui, sans-serif; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  h2 { font-size: 14px; margin: 28px 0 8px; border-top: 1px solid var(--line); padding-top: 12px; }
  p, td, th { color: var(--mute); }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(${Math.min(manifest.width, 360)}px, 1fr)); gap: 12px; }
  .pair { display: grid; grid-template-columns: 160px 1fr 1fr; gap: 12px; align-items: start; margin-bottom: 12px; }
  .pair > div { color: var(--fg); padding-top: 4px; }
  figure { margin: 0; }
  img { display: block; width: 100%; height: auto; background: #000; }
  figcaption { color: var(--mute); font-size: 12px; margin-top: 4px; }
  table { border-collapse: collapse; } td, th { padding: 4px 12px 4px 0; text-align: left; }
  @media (max-width: 700px) { .pair { grid-template-columns: 1fr; } }
</style>
</head>
<body>
<h1>Ambient effects · contact sheet</h1>
<p>The example bottle in a dark flat studio (FLAT environment, 0.012), Key only as the one light. ${esc(manifest.width)}×${esc(manifest.height)}, ${esc(SAMPLES)} spp, native <code>rt</code> with ${esc(THREADS)} threads. The preset values are the accepted ones (ROADMAP S4a verdict).</p>
<p>Lights: <b>side</b> — ${esc(manifest.lights.side)}; <b>back</b> — ${esc(manifest.lights.back)}.</p>
<h2>The eight presets under the two lights</h2>
<div class="pair"><div></div><div>Side key</div><div>Spot backlight</div></div>
${presets.map((p) => `<div class="pair"><div>${esc(by(`${p}-side`)?.label ?? p)}</div>${cell(by(`${p}-side`))}${cell(by(`${p}-back`))}</div>`).join('\n')}
<h2>Rain: three streak lengths (spot backlight)</h2>
<div class="grid">${shots.filter((s) => s.row === 'rain-streak').map(cell).join('')}</div>
<h2>Dust cloud: two softnesses (side key)</h2>
<div class="grid">${shots.filter((s) => s.row === 'cloud-softness').map(cell).join('')}</div>
<h2>Cost</h2>
${
  cost
    ? `<table><tr><th>Scene</th><th>Render (${cost.samples} spp, ${cost.threads} threads)</th><th>Particles: evaluation and BVH</th></tr>
<tr><td>No effect</td><td>${cost.noneSeconds} s</td><td>–</td></tr>
<tr><td>200 000 dust motes</td><td>${cost.dustSeconds} s</td><td>${cost.dustEvalSeconds} s</td></tr>
<tr><td>Ratio</td><td>${cost.ratio.toFixed(2)}×</td><td>${cost.ratioWithEval.toFixed(2)}× with the evaluation</td></tr></table>`
    : '<p>Not measured in this run.</p>'
}
</body>
</html>
`;
writeFileSync(HTML, html);
console.log(`wrote ${HTML}`);
if (cost) console.log(`cost: none ${cost.noneSeconds} s, 200k dust ${cost.dustSeconds} s (+${cost.dustEvalSeconds} s eval): ${cost.ratio.toFixed(2)}x`);
