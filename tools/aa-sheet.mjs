#!/usr/bin/env node
// The sheet of phase E11: the edge of the example bottle, cropped and enlarged 4× (nearest pixel), rendered by the
// engine with each of the six choices of Settings ▸ Render engine ▸ Edge smoothing ▸ Full mode and render, and the
// time each took (the times go in the PR, never in the interface: CLAUDE.md rule 10).
//
//   node tools/aa-sheet.mjs [--samples 64] [--threads 4] [--crop 420,215,100,75] [--out out/aa-sheet.html]
//
// The scene is the example bottle as the page sends it to the engine (tests/antialias.test.ts writes it with
// REPACK_AA_SHEET=out/aa/bottle.rsb: projectScene + writeRsb, 960 × 540); `rt` renders it with --pixel-filter and
// --edge-samples. Everything is written under out/ (not in git).

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const SAMPLES = Number(opt('samples', '64'));
const THREADS = Number(opt('threads', '4'));
const [CX, CY, CW, CH] = opt('crop', '420,215,100,75').split(',').map(Number);
const OUT = resolve(ROOT, opt('out', 'out/aa-sheet.html'));
const DIR = join(ROOT, 'out', 'aa');
mkdirSync(DIR, { recursive: true });

const SETTINGS = [
  { key: 'NONE', en: 'None', es: 'Ninguno', filter: 'none', edges: 1 },
  { key: 'STANDARD', en: 'Standard', es: 'Estándar', filter: 'standard', edges: 1 },
  { key: 'SOFT', en: 'Soft', es: 'Suave', filter: 'soft', edges: 1 },
  { key: 'FINE', en: 'Fine', es: 'Fino', filter: 'fine', edges: 1 },
  { key: 'FINE_EDGES2', en: 'Fine + edges ×2', es: 'Fino + bordes ×2', filter: 'fine', edges: 2 },
  { key: 'FINE_EDGES4', en: 'Fine + edges ×4', es: 'Fino + bordes ×4', filter: 'fine', edges: 4 },
];

// The scene.
const scene = join(DIR, 'bottle.rsb');
const made = spawnSync('npx', ['vitest', 'run', 'tests/antialias.test.ts', '-t', 'writes the example bottle'], { cwd: ROOT, env: { ...process.env, REPACK_AA_SHEET: scene }, stdio: 'inherit' });
if (made.status !== 0) throw new Error('could not write the scene');

// The renders.
execFileSync('cargo', ['build', '--release', '-q', '-p', 'rt-cli', '--manifest-path', join(ROOT, 'engine', 'Cargo.toml')], { stdio: 'inherit' });
const rt = join(ROOT, 'engine', 'target', 'release', 'rt');
const CPU_TIME = 'import resource, subprocess, sys\nr = subprocess.run(sys.argv[1:], capture_output=True, text=True)\nsys.stdout.write(r.stdout)\nu = resource.getrusage(resource.RUSAGE_CHILDREN)\nprint(f"cpu {u.ru_utime + u.ru_stime:.3f}")\nsys.exit(r.returncode)';
const rows = [];
for (const s of SETTINGS) {
  const png = join(DIR, `${s.key.toLowerCase()}.png`);
  // The CPU time of the render too (user + system, from getrusage of the child): on a loaded machine the clock says
  // more of the others than of the setting.
  const out = execFileSync('python3', ['-c', CPU_TIME, rt, scene, '-o', png, '--samples', String(SAMPLES), '--threads', String(THREADS), '--pixel-filter', s.filter, '--edge-samples', String(s.edges)]).toString();
  const m = /rendered (\d+) spp, (\d+) rays in ([\d.]+) s/.exec(out);
  const cpu = /^cpu ([\d.]+)$/m.exec(out);
  if (!m || !cpu) throw new Error(`rt said: ${out}`);
  rows.push({ ...s, png, samples: Number(m[1]), rays: Number(m[2]), seconds: Number(m[3]), cpu: Number(cpu[1]) });
  console.log(`${s.en.padEnd(18)} ${m[3]} s (CPU ${cpu[1]} s), ${(Number(m[2]) / 1e6).toFixed(1)} M rays`);
}
const standard = rows.find((r) => r.key === 'STANDARD');
const b64 = (p) => readFileSync(p).toString('base64');
const W = 960;
const H = 540;
const Z = 4;
const crop = (r) => `<div class="crop" style="width:${CW * Z}px;height:${CH * Z}px;background-image:url(data:image/png;base64,${b64(r.png)});background-size:${W * Z}px ${H * Z}px;background-position:-${CX * Z}px -${CY * Z}px"></div>`;
const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Suavizado de bordes · E11</title>
<style>
  :root { color-scheme: light dark; --bg: #f4f4f4; --ink: #111; --line: #ccc; --soft: #666; }
  @media (prefers-color-scheme: dark) { :root { --bg: #161616; --ink: #eee; --line: #333; --soft: #999; } }
  body { margin: 0; padding: 24px 16px; background: var(--bg); color: var(--ink); font: 14px/1.45 system-ui, sans-serif; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  p { margin: 4px 0 12px; color: var(--soft); max-width: 70ch; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(${CW * Z}px, 100%), 1fr)); gap: 20px; }
  figure { margin: 0; }
  .crop { max-width: 100%; image-rendering: pixelated; border: 1px solid var(--line); background-repeat: no-repeat; }
  figcaption { margin-top: 6px; }
  figcaption b { display: block; }
  .t { font-variant-numeric: tabular-nums; color: var(--soft); }
  .whole { position: relative; width: ${W / 2}px; max-width: 100%; margin: 8px 0 20px; }
  .whole img { width: 100%; display: block; border: 1px solid var(--line); }
  .whole i { position: absolute; left: ${(100 * CX) / W}%; top: ${(100 * CY) / H}%; width: ${(100 * CW) / W}%; height: ${(100 * CH) / H}%; outline: 2px solid #fff; mix-blend-mode: difference; }
  table { border-collapse: collapse; margin: 16px 0; font-variant-numeric: tabular-nums; }
  td, th { border-bottom: 1px solid var(--line); padding: 4px 12px 4px 0; text-align: left; }
</style>
</head>
<body>
<h1>Suavizado de bordes del motor (E11)</h1>
<p>El canto del frasco de ejemplo (recorte de ${CW} × ${CH} px de una imagen de ${W} × ${H}, ampliado ${Z}× sin interpolar), renderizado por <code>rt</code> con cada ajuste de <em>Ajustes ▸ Motor de renderizado ▸ Suavizado de bordes ▸ Completo y render</em>, de menos a más coste, ${SAMPLES} muestras por píxel y ${THREADS} hilos. Los tiempos son de esta máquina con la carga que tenía (otros procesos a la vez): el de reloj dice tanto de ellos como del ajuste; el de CPU (usuario + sistema del proceso) y, sobre todo, los rayos lanzados son la medida del coste. Van en el PR, nunca en la interfaz.</p>
<div class="whole"><img alt="" src="data:image/png;base64,${b64(standard.png)}"><i></i></div>
<div class="grid">
${rows.map((r, i) => `<figure>${crop(r)}<figcaption><b>${i + 1}. ${r.es}</b><span class="t">${r.seconds.toFixed(1)} s de reloj · ${r.cpu.toFixed(1)} s de CPU (${(r.cpu / standard.cpu).toFixed(2)} × Estándar) · ${(r.rays / 1e6).toFixed(1)} M rayos (${(r.rays / standard.rays).toFixed(3)} ×)</span></figcaption></figure>`).join('\n')}
</div>
<table>
<tr><th>Ajuste</th><th>pixel_filter</th><th>edge_supersample</th><th>Reloj</th><th>CPU</th><th>CPU frente a Estándar</th><th>Rayos</th><th>Rayos frente a Estándar</th></tr>
${rows.map((r) => `<tr><td>${r.es}</td><td>${r.filter}</td><td>${r.edges}</td><td>${r.seconds.toFixed(1)} s</td><td>${r.cpu.toFixed(1)} s</td><td>${(r.cpu / standard.cpu).toFixed(2)} ×</td><td>${(r.rays / 1e6).toFixed(2)} M</td><td>${(r.rays / standard.rays).toFixed(4)} ×</td></tr>`).join('\n')}
</table>
</body>
</html>
`;
writeFileSync(OUT, html);
writeFileSync(join(DIR, 'times.json'), JSON.stringify(rows.map(({ png, ...r }) => r), null, 2));
console.log(`wrote ${OUT}`);
