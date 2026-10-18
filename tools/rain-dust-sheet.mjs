#!/usr/bin/env node
// Contact sheet of the rain and dust on the front glass (phase S3b) and on the parts (S3c; not part of `npm run qa`), for the eye that decides
// the values marked ◆ in the ROADMAP's S3b (the wettability of glass, the sliding, the dust's angle of repose, how strong
// the effect reads): the example through a lens whose glass the scene's rain wets (0, 2, 5 and 15 s), and a lens looking
// up that the dust settles on (dust motes and a dust cloud's density, 0, 30 and 120 s), each photo beside a drawing of
// the pane as the simulation left it, and the photos without the glass. S3c: the example bottle and its set under rain on
// the parts (0, 2, 5 and 15 s: drops, trails, drips), dust on them (0, 30 and 120 s) and snow (0, 10 and 30 s).
//
//   npm run engine:build && node tools/rain-dust-sheet.mjs [--out out/rain-dust-sheet] [--size 512x288] [--samples 64]
//        [--threads 2]
//
// 1. builds the native engine if `engine/target/release/rt` is missing;
// 2. writes the RSB files and the panes through tests/rain-dust-dump.test.ts (skipped by `npm test` unless
//    REPACKSHOT_RAIN_DUST_DIR is set, which this tool does): the simulation runs in the real rt.wasm, through the page's
//    own code, and each shot is the scene at its instant with the recorded frame of the glass;
// 3. renders each with `rt <file> -o <png> --samples N --threads T`;
// 4. writes <out>.html (out/rain-dust-sheet.html) with the PNGs of <out>/ next to it, and <out>/sheet.json.

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
const OUT = resolve(ROOT, opt('out', 'out/rain-dust-sheet'));
const HTML = `${OUT}.html`;
const SIZE = opt('size', '512x288');
const SAMPLES = opt('samples', '64');
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
run('npx', ['vitest', 'run', 'tests/rain-dust-dump.test.ts'], { REPACKSHOT_RAIN_DUST_DIR: OUT, REPACKSHOT_RAIN_DUST_SIZE: SIZE, REPACKSHOT_RAIN_DUST_SPP: SAMPLES });
const manifest = JSON.parse(readFileSync(join(OUT, 'shots.json'), 'utf8'));

const shots = [];
for (const shot of manifest.shots) {
  const png = join(OUT, `${shot.file}.png`);
  const said = run(RT, [join(OUT, `${shot.file}.rsb`), '-o', png, '--samples', String(shot.samples), '--threads', THREADS]);
  const rendered = /rendered (\d+) spp, (\d+) rays in ([\d.]+) s/.exec(said);
  shots.push({ ...shot, png: `${shot.file}.png`, renderSeconds: rendered ? Number(rendered[3]) : null });
  console.log(`${shot.file}: ${shot.parts ? `${shot.parts.drops} drops on the parts` : `${shot.drops} drops`}, ${shot.motes} motes, render ${rendered?.[3] ?? '?'} s`);
}
writeFileSync(join(OUT, 'sheet.json'), JSON.stringify({ size: SIZE, samples: Number(SAMPLES), threads: Number(THREADS), shots }, null, 2));

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const rel = (f) => `${relative(dirname(HTML), OUT)}/${f}`;
const W = manifest.width;
const H = manifest.height;
const pct = (v) => `${(100 * v).toFixed(2)} %`;

/** The pane as the simulation left it: the square the render's rays cross, drops in blue-grey, motes in black. */
function paneSvg(file) {
  const p = JSON.parse(readFileSync(join(OUT, `${file}.json`), 'utf8'));
  const h = p.halfExtentMm;
  const size = H;
  const k = size / (2 * h);
  const x = (v) => ((v + h) * k).toFixed(2);
  const y = (v) => ((h - v) * k).toFixed(2);
  const circles = [];
  for (let i = 0; i + 2 < p.drops.length; i += 3) circles.push(`<circle cx="${x(p.drops[i])}" cy="${y(p.drops[i + 1])}" r="${(p.drops[i + 2] * k).toFixed(2)}" fill="#8fb4cc" fill-opacity="0.7" stroke="#3d5a6c" stroke-width="0.6"/>`);
  for (let i = 0; i + 2 < p.motes.length; i += 3) circles.push(`<circle cx="${x(p.motes[i])}" cy="${y(p.motes[i + 1])}" r="${Math.max(0.4, p.motes[i + 2] * k).toFixed(2)}" fill="#111"/>`);
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="the pane"><rect width="${size}" height="${size}" fill="#f2f2f2" stroke="#999"/>${circles.join('')}<text x="6" y="${size - 6}" font-size="11" fill="#555">${(2 * h).toFixed(1)} mm · ${p.distanceMm} mm in front of the lens · up ↑</text></svg>`;
}

const caption = (s) =>
  s.parts
    ? `${esc(s.label)} · ${s.parts.drops.toLocaleString('en-US')} drops on the parts · ${s.parts.drips.toLocaleString('en-US')} drips so far · samples wet ${pct(s.parts.wet)}, dusty ${pct(s.parts.dust)}, under snow ${pct(s.parts.snow)} · ${s.renderSeconds} s`
    : `${esc(s.label)} · ${s.drops.toLocaleString('en-US')} drops covering ${pct(s.dropCover)} · ${s.motes.toLocaleString('en-US')} motes covering ${pct(s.dustCover)} · ${s.renderSeconds} s`;
const cell = (s) =>
  `<figure><div class="pair"><img src="${rel(s.png)}" alt="${esc(s.label)}" width="${W}" height="${H}">${s.row === 'clean' || s.parts ? '' : paneSvg(s.file)}</div><figcaption>${caption(s)}</figcaption></figure>`;
const row = (key, title) => `<h2>${esc(title)}</h2><div class="row">${shots.filter((s) => s.row === key).map(cell).join('')}</div>`;

const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Rain and dust sheet</title>
<style>
:root { color-scheme: light dark; --bg: #fafafa; --fg: #1a1a1a; --muted: #666; }
@media (prefers-color-scheme: dark) { :root { --bg: #161616; --fg: #e8e8e8; --muted: #9a9a9a; } }
body { margin: 16px; background: var(--bg); color: var(--fg); font: 13px/1.45 system-ui, sans-serif; }
h1 { font-size: 18px; } h2 { font-size: 15px; margin-top: 28px; }
.row { display: flex; flex-direction: column; gap: 14px; }
.pair { display: flex; gap: 8px; flex-wrap: wrap; }
figure { margin: 0; } figcaption { color: var(--muted); max-width: ${W + H + 8}px; }
img { max-width: 100%; height: auto; }
p { max-width: 900px; }
</style></head><body>
<h1>Lluvia y polvo sobre el cristal frontal (S3b) y sobre las piezas (S3c)</h1>
<p>Cada foto es el render de <code>rt</code> (${esc(SIZE)}, ${esc(SAMPLES)} muestras) de la escena en ese instante con el fotograma grabado del cristal; a su lado, el cristal tal como lo dejó la simulación (el cuadrado que cruzan los rayos del render; gotas en gris azulado, motas en negro; arriba es el arriba de la cámara). La simulación corre en el <code>rt.wasm</code> real a través del código de la página, como en el <em>worker</em> de físicas. Valores ◆ por decidir: ROADMAP, S3b.</p>
${row('rain', 'Lluvia empujada hacia la lente por un viento de 6 m/s (la cámara mira un poco hacia abajo): 0, 2, 5 y 15 s')}
${row('dust', 'Motas de polvo, la lente mirando 60° hacia arriba (el cristal, 30° sobre la horizontal): 0, 30 y 120 s')}
${row('cloud', 'La densidad de una polvareda sin viento (el suyo sopla lejos de esta lente), la misma lente: 0, 30 y 120 s')}
${row('clean', 'Las mismas fotos sin cristal')}
<h2>Sobre las piezas (S3c)</h2>
<p>La botella de ejemplo sobre el set del tipo <em>Perfume</em>, encuadrada como la fila de la lluvia (28 mm, f/8), con el efecto <em>Sobre las piezas</em> y sus partículas ocultas a la cámara (para que se lean las piezas): cada foto es el render de <code>rt</code> de la escena en ese instante con las secciones <code>WETP</code> del fotograma grabado (la película de agua, el polvo, la nieve y las gotas como casquetes). Las piezas del set se mojan como película. Valores ◆ por decidir: ROADMAP, S3c.</p>
${row('bottle', 'La botella bajo la lluvia sin viento: 0, 2, 5 y 15 s (gotas, rastros, goteo)')}
${row('set', 'Polvo sobre la botella y el set (la densidad de una polvareda sin viento): 0, 30 y 120 s')}
${row('snow', 'Nieve sobre la botella y el set: 0, 10 y 30 s')}
</body></html>
`;
writeFileSync(HTML, html);
console.log(`wrote ${relative(ROOT, HTML)}`);
