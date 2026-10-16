#!/usr/bin/env node
// The sheet of the lens's effect filters (phase O3a), for the lead's verdict (rule 11): `rt --filter-sheet` renders
// the perfume bottle (a small spot behind it in the frame, another just above the frame) through every filter at the
// grades 1/4, 1 and 2, the two stacks of the brief and no filter, at 512 × 384 and 128 spp, into
// out/lens-filters-sheet/; `rt --filter-noise` measures the noise each filter adds with and without its connections to
// the lights (out/lens-filters-sheet/noise.json); this writes out/lens-filters-sheet.html with the names and the
// sentence of each type (src/data/lens-filters.ts), the render times and the table of the noise.
//
//   node tools/lens-filters-sheet.mjs [--samples N] [--reuse]      --reuse: only write the page again
//
// It builds `rt` (cargo build --release -p rt-cli in engine/).

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const DIR = join(ROOT, 'out/lens-filters-sheet');

/** The types of src/data/lens-filters.ts: kind, key, names and sentences (read from the source, no build step). */
function filterTypes() {
  const src = readFileSync(join(ROOT, 'src/data/lens-filters.ts'), 'utf8');
  const out = new Map();
  const re = /key: '([A-Z_]+)',\s*kind: (\d+),\s*name: \{ es: '([^']+)', en: '([^']+)' \},\s*help: \{\s*es: '([^']+)',\s*en: '([^']+)',/g;
  for (const m of src.matchAll(re)) out.set(Number(m[2]), { key: m[1], es: m[3], en: m[4], helpEs: m[5] });
  if (out.size !== 8) throw new Error(`read ${out.size} filter types from src/data/lens-filters.ts`);
  return out;
}

if (!args.includes('--reuse')) {
  execFileSync('cargo', ['build', '--release', '-p', 'rt-cli', '--quiet'], { cwd: join(ROOT, 'engine'), stdio: 'inherit' });
  const rt = join(ROOT, 'engine/target/release', process.platform === 'win32' ? 'rt.exe' : 'rt');
  execFileSync(rt, ['--filter-sheet', DIR, '--samples', String(opt('samples', 128))], { stdio: 'inherit' });
  execFileSync(rt, ['--filter-noise', DIR], { stdio: 'inherit' });
}
if (!existsSync(join(DIR, 'index.json'))) throw new Error('no out/lens-filters-sheet/index.json: render it first');
const index = JSON.parse(readFileSync(join(DIR, 'index.json'), 'utf8'));
const types = filterTypes();
const grade = (g) => ({ 0.125: '1/8', 0.25: '1/4', 0.5: '1/2', 1: '1', 2: '2' })[g] ?? String(g);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const caption = (c) =>
  c.stack.length === 0 ? 'Sin filtro' : c.stack.map((f) => `${esc(types.get(f.kind).es)} ${grade(f.grade)}`).join(' + ');
const figure = (c) =>
  `<figure><img src="lens-filters-sheet/${c.file}" alt="${esc(c.key)}"><figcaption><b>${caption(c)}</b> <span class="k">${esc(c.key)} · ${c.samples} spp · ${c.seconds.toFixed(0)} s</span></figcaption></figure>`;
const none = index.cells.find((c) => c.stack.length === 0);
const rows = [...types.values()].map((t, i) => {
  const cells = index.cells.filter((c) => c.connect && c.stack.length === 1 && c.stack[0].kind === i + 1);
  return `<h2>${esc(t.es)} <span class="k">${t.key}</span></h2><p>${esc(t.helpEs)}</p><div class="grid">${figure(none)}${cells.map(figure).join('')}</div>`;
});
const stacks = index.cells.filter((c) => c.stack.length > 1);
const alone = index.cells.filter((c) => !c.connect);
const pair = (c) => index.cells.find((x) => x.connect && x.stack.length === 1 && x.stack[0].kind === c.stack[0].kind && x.stack[0].grade === c.stack[0].grade);
// The noise table (rt --filter-noise): per filter, the variance of a pixel between the seeds without and with the
// connections, the part the filter adds (over the image without filter), the means and the times.
const noise = existsSync(join(DIR, 'noise.json')) ? JSON.parse(readFileSync(join(DIR, 'noise.json'), 'utf8')) : null;
const kindOf = (key) => [...types.entries()].find(([, t]) => key.startsWith(`${t.key.toLowerCase().replace(/_/g, '-')}--`))?.[0];
const num = (x, d) => x.toFixed(d).replace('.', ',');
const pct = (x) => {
  const v = Math.round(x * 10) / 10;
  return `${v > 0 ? '+' : v < 0 ? '−' : ''}${num(Math.abs(v), 1)} %`;
};
function noiseTable() {
  if (!noise) return '<p>Sin <code>noise.json</code>: <code>rt --filter-noise out/lens-filters-sheet</code>.</p>';
  const row = (key, connect) => noise.rows.find((r) => r.key === key && r.connect === connect);
  const base = row('none', true).variance;
  const keys = [...new Set(noise.rows.map((r) => r.key))].filter((k) => k !== 'none');
  const lines = keys.map((key) => {
    const [a, b] = [row(key, false), row(key, true)];
    const kind = kindOf(key);
    const name = `${esc(types.get(kind).es)} ${esc(key.split('--')[1].replace('-', '/'))}`;
    const added = (r) => Math.max(r.variance - base, 0);
    return `<tr><td>${name}</td><td>${num(a.variance, 2)}</td><td>${num(b.variance, 2)}</td><td>${num(added(a), 2)} → ${num(added(b), 2)}</td><td>${num(added(a) / Math.max(added(b), 1e-9), 1)} ×</td><td>${num(a.mean, 4)} / ${num(b.mean, 4)} (${pct((100 * (b.mean - a.mean)) / a.mean)})</td><td>${num(a.rays / 1e6, 2)} / ${num(b.rays / 1e6, 2)} M (${pct((100 * (b.rays - a.rays)) / a.rays)})</td><td>${num(a.seconds, 1)} / ${num(b.seconds, 1)} s</td></tr>`;
  });
  return `<p>El mismo frasco a ${noise.width} × ${noise.height} y ${noise.samples} muestras, ${noise.runs} semillas por filtro; varianza de cada canal de cada píxel entre las semillas (valores recortados a ${noise.clamp}, para que una chispa no decida), media sobre la imagen. Sin filtro: ${num(base, 2)}. Primero las fuentes pequeñas a través de los núcleos dispersos (estrella, rayas, brillo). Medido con <code>rt --filter-noise</code>. El coste, por los rayos trazados (los de sombra de las conexiones incluidos); los segundos, en esta máquina cargada por otros procesos, solo orientativos (sin filtro, el mismo trabajo dos veces, ya difieren).</p>
<table><thead><tr><th>Filtro</th><th>Sin conexiones</th><th>Con conexiones</th><th>Lo que añade el filtro</th><th>Menos ruido</th><th>Media (sin / con)</th><th>Rayos (sin / con)</th><th>Segundos</th></tr></thead><tbody>
${lines.join('\n')}
</tbody></table>`;
}
const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>Lens filters sheet</title>
<style>
body{background:#111;color:#ddd;font:13px/1.4 system-ui,sans-serif;margin:24px}
h1{font-size:18px;font-weight:600;margin:0 0 4px}
h2{font-size:15px;font-weight:600;margin:28px 0 2px}
p{margin:0 0 12px;color:#999;max-width:960px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(512px,1fr));gap:16px}
figure{margin:0}
img{display:block;width:512px;height:384px;background:#000}
figcaption{padding:6px 0;max-width:512px}
b{color:#fff}
.k{color:#777;font-weight:400}
table{border-collapse:collapse;margin:8px 0 12px}
th,td{padding:4px 12px 4px 0;text-align:left;border-bottom:1px solid #333;font-variant-numeric:tabular-nums}
th{color:#999;font-weight:500}
</style></head><body>
<h1>Filtros de efecto en la lente (O3a)</h1>
<p>El frasco de perfume de <code>rt-cli</code> (<code>filter_sheet.rs</code>) con un foco pequeño detrás, dentro del encuadre (a contraluz), y otro justo encima del encuadre, fuera de él; ${index.width} × ${index.height}, ${none.samples} muestras, renderizado por <code>rt</code>. Cada tipo a los grados 1/4, 1 y 2 junto a la misma imagen sin filtro, y las dos pilas del encargo. Los grados → <i>s</i> de las difusiones (0,03 / 0,06 / 0,12 / 0,22 / 0,38) y los anchos (σ₁ 0,25°, σ₂ 2,5°) son la propuesta del encargo, y los demás números (reparto de lóbulos, transmisión de la difusión negra 0,7, tintes, largos y grosor de las rayas, la nube del brillo) son propuestas mías: todo queda para el veredicto (regla 11). Segunda hoja, tras el veredicto de la primera: el tinte de la dorada, la red y las rayas solo en el halo y las rayas (y más suave), la estrella con el largo que dice el grado (un cuarto del medio cuadro a 1/4, el 60 % a 1, todo a 2) y el mismo brillo junto a la luz, la red con una cruz corta y tenue sobre su suavizado, el brillo como una nube de destellos finos (no la corona de las 36 celdas de la pupila) y <i>s</i> propias de la estrella y las rayas; las difusiones blanca y negra y el suavizado son los mismos bits que en la primera.</p>
${rows.join('\n')}
<h2>Pilas</h2><div class="grid">${figure(none)}${stacks.map(figure).join('')}</div>
<h2>Con y sin las conexiones a las luces</h2>
<p>A la izquierda, como renderiza el motor: la dispersión en la pupila y la conexión de cada muestra de cámara a una luz que la cámara ve, a través de la PSF del filtro, pesadas una contra otra (MIS, heurística del balance, lóbulo a lóbulo). A la derecha, la dispersión sola, a las mismas muestras: la misma imagen en promedio, con el ruido de los rayos dispersos que rara vez dan con una luz pequeña.</p>
${alone.map((c) => `<div class="grid">${figure(pair(c))}${figure(c).replace('</b>', ' · sin conexiones</b>')}</div>`).join('\n')}
<h2>Ruido medido, con y sin las conexiones</h2>
${noiseTable()}
</body></html>
`;
writeFileSync(join(ROOT, 'out/lens-filters-sheet.html'), html);
console.log(`wrote out/lens-filters-sheet.html (${index.cells.length} images)`);
