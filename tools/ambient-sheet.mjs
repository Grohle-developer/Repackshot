#!/usr/bin/env node
// Contact sheet of the ambient effects (phases S4a and S4b; not part of `npm run qa`): the eight presets on the example
// bottle under two lights, rain with three streak lengths and the dust cloud with two softnesses, for the eye that
// decides the presets' values; and the cost of each preset at its own count, and of 200 000 dust motes, against no
// effect on the same bottle, measured in alternating rounds (S4b).
//
//   node tools/ambient-sheet.mjs [--out out/ambient-sheet] [--size 512x288] [--samples 128] [--threads 2]
//        [--cost-samples 32] [--rounds 3] [--only DUST_MOTES-side,cost,...] [--rt-before <old rt>]
//
// 1. builds the native engine if `engine/target/release/rt` is missing;
// 2. writes the RSB files through tests/ambient-rsb-dump.test.ts (skipped by `npm test` unless
//    REPACKSHOT_AMBIENT_RSB_DIR is set, which this tool does);
// 3. renders each with `rt <file> -o <png> --samples N --threads T` and keeps what `rt` says (the particles, the time
//    to evaluate them and build their BVHs, the render time);
// 4. the cost: for every `cost-*` scene with an effect, `--rounds` pairs of renders, the scene without effect and then
//    the one with it, one after the other, so that the load of a shared machine weighs on both alike; the ratio of
//    each pair is the cost per sample (the same samples, the evaluation of the particles apart), and the sheet gives
//    their median (`--only cost` measures only this);
// 5. with `--rt-before`, renders the shots of the before/after rows with that binary too (the engine of before the
//    change, into <out>/before/), and puts each pair side by side with an enlarged crop;
// 6. writes <out>.html (out/ambient-sheet.html) with the PNGs of <out>/ next to it, and <out>/sheet.json.

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
const COST_SAMPLES = opt('cost-samples', '32');
const ROUNDS = Math.max(1, Number(opt('rounds', '3')));
const RT_BEFORE = opt('rt-before', '') ? resolve(ROOT, opt('rt-before', '')) : '';
/** The cost criterion (ROADMAP S4a criterion 5, at the presets' densities: S4b). */
const COST_LIMIT = 1.3;
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
const previous = existsSync(join(OUT, 'sheet.json')) ? JSON.parse(readFileSync(join(OUT, 'sheet.json'), 'utf8')) : { shots: [], cost: null };

/** Renders `<OUT>/<file>.rsb` to `png` with the engine `rt` and keeps what it says. */
function render(rt, file, png, samples) {
  const t0 = Date.now();
  const said = run(rt, [join(OUT, `${file}.rsb`), '-o', png, '--samples', String(samples), '--threads', THREADS]);
  const wall = (Date.now() - t0) / 1000;
  const rendered = /rendered (\d+) spp, (\d+) rays in ([\d.]+) s/.exec(said);
  const ambient = /ambient: (\d+) particles in (\d+) effects, evaluated with their BVHs in ([\d.]+) s/.exec(said);
  return {
    wall,
    renderSeconds: rendered ? Number(rendered[3]) : null,
    rays: rendered ? Number(rendered[2]) : null,
    engineParticles: ambient ? Number(ambient[1]) : 0,
    evalSeconds: ambient ? Number(ambient[3]) : null,
  };
}

/**
 * The before/after rows (S4b): each shot with the crop the sheet enlarges, as fractions of the frame (x, y, w, h). The
 * forward lobe (point 2) on the backlit dust, pollen and dust cloud, and the side-lit dust it must not spoil; the
 * drops without caustics (point 3) under the side key, where the speckle was, and under the backlight, which must not
 * change.
 */
const BEFORE_AFTER = [
  { file: 'DUST_MOTES-back', crop: [0.25, 0.0, 0.5, 0.5], note: 'forward lobe: the motes light up in the beam' },
  { file: 'POLLEN-back', crop: [0.25, 0.0, 0.5, 0.5], note: 'forward lobe' },
  { file: 'DUST_CLOUD-back', crop: [0.25, 0.5, 0.5, 0.5], note: 'forward lobe' },
  { file: 'DUST_MOTES-side', crop: [0.25, 0.0, 0.5, 0.5], note: 'forward lobe under the side key' },
  { file: 'RAIN-side', crop: [0.375, 0.3, 0.25, 0.5], note: 'drops without caustics: the speckle goes' },
  { file: 'RAIN-back', crop: [0.375, 0.0, 0.25, 0.5], note: 'drops without caustics: backlit rain must not change' },
];

const wanted = (file) => ONLY.length === 0 || ONLY.includes(file);
const shots = [];
for (const shot of manifest.shots) {
  if (shot.row === 'cost') continue;
  const old = previous.shots.find((s) => s.file === shot.file);
  if (!wanted(shot.file)) {
    if (old) shots.push(old);
    continue;
  }
  const png = join(OUT, `${shot.file}.png`);
  const entry = { ...shot, png: basename(png), ...render(RT, shot.file, png, shot.samples) };
  if (RT_BEFORE && BEFORE_AFTER.some((b) => b.file === shot.file)) {
    mkdirSync(join(OUT, 'before'), { recursive: true });
    const before = render(RT_BEFORE, shot.file, join(OUT, 'before', `${shot.file}.png`), shot.samples);
    entry.before = { png: `before/${shot.file}.png`, renderSeconds: before.renderSeconds, engineParticles: before.engineParticles };
  } else if (old?.before) {
    entry.before = old.before;
  }
  shots.push(entry);
  console.log(`${shot.file}: ${entry.engineParticles} particles, eval ${entry.evalSeconds ?? '-'} s, render ${entry.renderSeconds} s`);
}

const median = (xs) => {
  const v = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};

// The cost: every scene with an effect against the one without, in pairs rendered one after the other.
let cost = previous.cost ?? null;
if (ONLY.length === 0 || ONLY.includes('cost')) {
  const rows = [];
  for (const shot of manifest.shots.filter((s) => s.row === 'cost' && s.file !== 'cost-none')) {
    const rounds = [];
    for (let r = 0; r < ROUNDS; r++) {
      const none = render(RT, 'cost-none', join(OUT, 'cost-none.png'), shot.samples);
      const fx = render(RT, shot.file, join(OUT, `${shot.file}.png`), shot.samples);
      rounds.push({ none: none.renderSeconds, effect: fx.renderSeconds, ratio: fx.renderSeconds / none.renderSeconds, evalSeconds: fx.evalSeconds, particles: fx.engineParticles });
    }
    const row = {
      file: shot.file,
      label: shot.label,
      particles: rounds[0].particles,
      rounds,
      noneSeconds: median(rounds.map((x) => x.none)),
      effectSeconds: median(rounds.map((x) => x.effect)),
      evalSeconds: median(rounds.map((x) => x.evalSeconds)),
      ratio: median(rounds.map((x) => x.ratio)),
    };
    row.pass = row.ratio <= COST_LIMIT;
    rows.push(row);
    console.log(`${shot.file}: ${row.particles} particles, ${rounds.map((x) => x.ratio.toFixed(2)).join(' / ')} -> ${row.ratio.toFixed(2)}x`);
  }
  cost = { samples: Number(COST_SAMPLES), threads: Number(THREADS), rounds: ROUNDS, limit: COST_LIMIT, rows };
}
writeFileSync(
  join(OUT, 'sheet.json'),
  JSON.stringify({ size: SIZE, samples: Number(SAMPLES), threads: Number(THREADS), lights: manifest.lights, rtBefore: RT_BEFORE || previous.rtBefore || null, cost, shots }, null, 2),
);

const by = (file) => shots.find((s) => s.file === file);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const rel = (f) => `${relative(dirname(HTML), OUT)}/${f}`;
const W = manifest.width;
const H = manifest.height;
const cell = (s) =>
  s
    ? `<figure><img src="${rel(s.png)}" alt="${esc(s.label)}" width="${W}" height="${H}"><figcaption>${esc(s.label)} · ${s.engineParticles.toLocaleString('en-US')} particles · ${s.renderSeconds} s</figcaption></figure>`
    : '<figure></figure>';
/** An enlarged crop of `png` (fractions of the frame), drawn with CSS: twice the crop's size in pixels. */
const crop = (png, [fx, fy, fw, fh], caption) => {
  const k = 2;
  const [w, h] = [Math.round(fw * W * k), Math.round(fh * H * k)];
  return `<figure><div class="crop" style="width:${w}px;aspect-ratio:${w}/${h};background-image:url('${rel(png)}');background-size:${(100 / fw).toFixed(3)}% auto;background-position:${fw < 1 ? ((fx / (1 - fw)) * 100).toFixed(3) : 0}% ${fh < 1 ? ((fy / (1 - fh)) * 100).toFixed(3) : 0}%"></div><figcaption>${esc(caption)}</figcaption></figure>`;
};
const beforeAfter = BEFORE_AFTER.map((b) => {
  const s = by(b.file);
  if (!s?.before) return '';
  return `<div class="ba"><div><b>${esc(b.file)}</b><br>${esc(b.note)}</div>
<figure><img src="${rel(s.before.png)}" alt="before" width="${W}" height="${H}"><figcaption>Before (S4a engine) · ${s.before.renderSeconds} s</figcaption></figure>
<figure><img src="${rel(s.png)}" alt="after" width="${W}" height="${H}"><figcaption>After (S4b) · ${s.renderSeconds} s</figcaption></figure>
${crop(s.before.png, b.crop, 'Before, crop ×2')}${crop(s.png, b.crop, 'After, crop ×2')}</div>`;
}).join('\n');
const presets = [...new Set(manifest.shots.filter((s) => s.row.startsWith('preset-')).map((s) => s.file.replace(/-(side|back)$/, '')))];
const costTable = cost
  ? `<p>Render time per sample of the bottle with the side key, ${cost.samples} spp, ${cost.threads} threads, ${cost.rounds} rounds; each round renders the scene without effect and then the one with it, and its ratio is theirs; the table gives the medians. The evaluation of the particles and their BVHs (once per scene load, not per sample) is apart. Criterion: at most ${cost.limit}× at the presets' counts.</p>
<table><tr><th>Scene</th><th>Particles</th><th>Without effect</th><th>With it</th><th>Ratio per round</th><th>Ratio</th><th>Evaluation</th><th></th></tr>
${cost.rows
  .map(
    (r) =>
      `<tr><td>${esc(r.label)}</td><td>${r.particles.toLocaleString('en-US')}</td><td>${r.noneSeconds.toFixed(3)} s</td><td>${r.effectSeconds.toFixed(3)} s</td><td>${r.rounds.map((x) => x.ratio.toFixed(2)).join(' / ')}</td><td><b>${r.ratio.toFixed(2)}×</b></td><td>${r.evalSeconds === null ? '–' : `${r.evalSeconds} s`}</td><td>${r.file === 'cost-dust200k' ? '(the cap, not a preset)' : r.pass ? '≤ ' + cost.limit + '×' : 'over ' + cost.limit + '×'}</td></tr>`,
  )
  .join('\n')}</table>`
  : '<p>Not measured in this run.</p>';
const extraRows = [...new Set(manifest.shots.map((s) => s.row).filter((r) => !r.startsWith('preset-') && !['rain-streak', 'cloud-softness', 'cost'].includes(r)))];
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
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(${Math.min(W, 360)}px, 1fr)); gap: 12px; }
  .pair { display: grid; grid-template-columns: 160px 1fr 1fr; gap: 12px; align-items: start; margin-bottom: 12px; }
  .pair > div, .ba > div { color: var(--fg); padding-top: 4px; }
  .ba { display: grid; grid-template-columns: 160px repeat(2, minmax(0, 1fr)); gap: 12px; align-items: start; margin-bottom: 20px; }
  .ba > figure:nth-of-type(3) { grid-column: 2; }
  .crop { max-width: 100%; background-repeat: no-repeat; image-rendering: pixelated; background-color: #000; }
  figure { margin: 0; }
  img { display: block; width: 100%; height: auto; background: #000; }
  figcaption { color: var(--mute); font-size: 12px; margin-top: 4px; }
  table { border-collapse: collapse; } td, th { padding: 4px 12px 4px 0; text-align: left; }
  @media (max-width: 700px) { .pair, .ba { grid-template-columns: 1fr; } .ba > figure:nth-of-type(3) { grid-column: auto; } }
</style>
</head>
<body>
<h1>Ambient effects · contact sheet</h1>
<p>The example bottle in a dark flat studio (FLAT environment, 0.012), Key only as the one light. ${esc(W)}×${esc(H)}, ${esc(SAMPLES)} spp, native <code>rt</code> with ${esc(THREADS)} threads. The preset values are the accepted ones (ROADMAP S4a verdict).</p>
<p>Lights: <b>side</b> — ${esc(manifest.lights.side)}; <b>back</b> — ${esc(manifest.lights.back)}.</p>
${beforeAfter ? `<h2>Before and after (S4b)</h2>\n${beforeAfter}` : ''}
<h2>The eight presets under the two lights</h2>
<div class="pair"><div></div><div>Side key</div><div>Spot backlight</div></div>
${presets.map((p) => `<div class="pair"><div>${esc(by(`${p}-side`)?.label ?? p)}</div>${cell(by(`${p}-side`))}${cell(by(`${p}-back`))}</div>`).join('\n')}
${extraRows.map((row) => `<h2>${esc(manifest.rows?.[row] ?? row)}</h2>\n<div class="grid">${shots.filter((s) => s.row === row).map(cell).join('')}</div>`).join('\n')}
<h2>Rain: three streak lengths (spot backlight)</h2>
<div class="grid">${shots.filter((s) => s.row === 'rain-streak').map(cell).join('')}</div>
<h2>Dust cloud: two softnesses (side key)</h2>
<div class="grid">${shots.filter((s) => s.row === 'cloud-softness').map(cell).join('')}</div>
<h2>Cost</h2>
${costTable}
</body>
</html>
`;
writeFileSync(HTML, html);
console.log(`wrote ${HTML}`);
if (cost) for (const r of cost.rows) console.log(`cost ${r.file}: ${r.particles} particles, none ${r.noneSeconds} s, with ${r.effectSeconds} s: ${r.ratio.toFixed(2)}x`);
