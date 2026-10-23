#!/usr/bin/env node
// Contact sheet of the cloth (phase S9; not part of `npm run qa`), for the eye that decides the values marked ◆ in the
// ROADMAP's S9 (each fabric's weight, stiffness, shear, bending, damping and thickness, the sheet Drape over the part
// lays): the example bottle with a sheet of each fabric preset dropped over it by Drape over the part, as the simulation
// left it, with what the simulator measured (vertices, simulated time, whether it settled, the mean curvature of the
// folds); the cap close up under silk; and each preset on Cusick's drape tester seen from above, with its drape
// coefficient and nodes.
//
//   npm run engine:build && node tools/cloth-sheet.mjs [--out out/cloth-sheet] [--size 480x360] [--samples 48]
//        [--seconds 5] [--threads 2]
//
// 1. builds the native engine if `engine/target/release/rt` is missing;
// 2. writes the RSB files through tests/cloth-dump.test.ts (skipped by `npm test` unless REPACKSHOT_CLOTH_DIR is set,
//    which this tool does): the simulation runs in the real rt.wasm, through the page's own code;
// 3. renders each with `rt <file> -o <png> --samples N --threads T`;
// 4. writes <out>.html (out/cloth-sheet.html) with the PNGs of <out>/ next to it, and <out>/sheet.json.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const OUT = resolve(ROOT, opt('out', 'out/cloth-sheet'));
const HTML = `${OUT}.html`;
const SIZE = opt('size', '480x360');
const SAMPLES = opt('samples', '48');
const SECONDS = opt('seconds', '5');
const THREADS = opt('threads', '2');
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
run('npx', ['vitest', 'run', 'tests/cloth-dump.test.ts'], { REPACKSHOT_CLOTH_DIR: OUT, REPACKSHOT_CLOTH_SIZE: SIZE, REPACKSHOT_CLOTH_SPP: SAMPLES, REPACKSHOT_CLOTH_SECONDS: SECONDS });
const manifest = JSON.parse(readFileSync(join(OUT, 'shots.json'), 'utf8'));

const shots = [];
for (const shot of manifest.shots) {
  const png = join(OUT, `${shot.file}.png`);
  const said = run(RT, [join(OUT, `${shot.file}.rsb`), '-o', png, '--samples', String(shot.samples), '--threads', THREADS]);
  const rendered = /rendered (\d+) spp, (\d+) rays in ([\d.]+) s/.exec(said);
  shots.push({ ...shot, png: `${shot.file}.png`, renderSeconds: rendered ? Number(rendered[3]) : null });
  const extra = shot.kind === 'cusick' ? `DC ${shot.dc.toFixed(3)}, ${shot.nodes} nodes` : `curvature ${shot.curvature.toFixed(4)} /mm`;
  console.log(`${shot.file}: ${shot.vertices} vertices, ${shot.simulated.toFixed(2)} s simulated${shot.settled ? ', settled' : ''}, ${extra}, render ${rendered?.[3] ?? '?'} s`);
}
writeFileSync(join(OUT, 'sheet.json'), JSON.stringify({ size: SIZE, samples: Number(SAMPLES), seconds: Number(SECONDS), threads: Number(THREADS), shots }, null, 2));

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const rel = (f) => `${relative(dirname(HTML), OUT)}/${f}`;
const W = manifest.width;
const H = manifest.height;
const caption = (s) => {
  if (s.kind === 'cusick') return `${esc(s.label)} · drape coefficient ${s.dc.toFixed(3)} · ${s.nodes} nodes · ${s.simulated.toFixed(2)} s simulated${s.settled ? ' (settled)' : ''} · simulation ${s.wallSeconds.toFixed(1)} s in rt.wasm`;
  if (s.kind === 'drape') return `${esc(s.label)} · ${s.vertices.toLocaleString('en-US')} vertices · ${s.simulated.toFixed(2)} s simulated${s.settled ? ' (settled)' : ' (still moving)'} · mean curvature ${s.curvature.toFixed(4)} /mm · lowest point ${s.lowestMm.toFixed(0)} mm · simulation ${s.wallSeconds.toFixed(1)} s in rt.wasm, render ${s.renderSeconds} s`;
  return `${esc(s.label)} · render ${s.renderSeconds} s`;
};
const cell = (s) => `<figure><img src="${rel(s.png)}" alt="${esc(s.label)}" width="${W}" height="${H}"><figcaption>${caption(s)}</figcaption></figure>`;

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Cloth sheet</title>
<style>
:root { color-scheme: light dark; --bg: #fafafa; --fg: #1a1a1a; --muted: #666; }
@media (prefers-color-scheme: dark) { :root { --bg: #161616; --fg: #e8e8e8; --muted: #9a9a9a; } }
body { margin: 16px; background: var(--bg); color: var(--fg); font: 13px/1.45 system-ui, sans-serif; }
h1 { font-size: 18px; }
h2 { font-size: 15px; margin-top: 28px; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(${Math.min(W, 360)}px, 1fr)); gap: 16px; }
figure { margin: 0; } figcaption { color: var(--muted); }
img { width: 100%; height: auto; }
p { max-width: 900px; }
</style></head><body>
<h1>Cloth over the example bottle (S9)</h1>
<p>Each photo is the native <code>rt</code>'s render (${esc(SIZE)}, ${esc(SAMPLES)} samples) of the example with a sheet laid over it by <em>Drape over the part</em> (a plane of ${esc(manifest.place.params.width)} mm, ${esc(manifest.place.position[2].toFixed(0))} mm up), one fabric preset each, at the last frame of its simulation (at most ${esc(SECONDS)} s; it stops sooner when it settles), recorded into the sheet's PHYSICS clip and drawn from it. The simulation runs in the real <code>rt.wasm</code> through the page's own code, as in the physics worker. The look of the fabric is its material (M5), the same plain cotton for all; what differs is how each drapes. Values marked ◆ are for the verdict: ROADMAP, S9.</p>
<div class="grid">${shots.filter((s) => s.kind === 'before' || s.kind === 'drape').map(cell).join('')}</div>
<h2>The cap under silk, close up</h2>
<p>Where the rim of the cap used to show through the cloth between its particles: the cloth's surface now keeps the sharp edges and corners of the parts at its thickness.</p>
<div class="grid">${shots.filter((s) => s.kind === 'cap').map(cell).join('')}</div>
<h2>Cusick's drape tester</h2>
<p>Each preset as a 300 mm disc held on a 180 mm one (BS 5058, ISO 9073-9), from straight above, as the engine's test drapes it (the same CLT1, run here in <code>rt.wasm</code>): the drape coefficient is the share of the ring outside the support that its shadow keeps, (A<sub>shadow</sub> − A<sub>support</sub>) / (A<sub>sample</sub> − A<sub>support</sub>); published for wovens, about 0.2 to 0.45 for silks and fine cottons, 0.5 to 0.7 for linen and denim, 0.8 to 0.95 for leathers.</p>
<div class="grid">${shots.filter((s) => s.kind === 'cusick').map(cell).join('')}</div>
</body></html>
`;
writeFileSync(HTML, html);
console.log(`wrote ${relative(ROOT, HTML)}`);
