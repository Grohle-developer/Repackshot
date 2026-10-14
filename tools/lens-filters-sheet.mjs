#!/usr/bin/env node
// The sheet of the lens's effect filters (phase O3a), for the lead's verdict (rule 11): `rt --filter-sheet` renders
// the perfume bottle (a small spot behind it in the frame, another just above the frame) through every filter at the
// grades 1/4, 1 and 2, the two stacks of the brief and no filter, at 512 × 384 and 128 spp, into
// out/lens-filters-sheet/; this writes out/lens-filters-sheet.html with the names and the sentence of each type
// (src/data/lens-filters.ts) and the render times.
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
</style></head><body>
<h1>Filtros de efecto en la lente (O3a)</h1>
<p>El frasco de perfume de <code>rt-cli</code> (<code>filter_sheet.rs</code>) con un foco pequeño detrás, dentro del encuadre (a contraluz), y otro justo encima del encuadre, fuera de él; ${index.width} × ${index.height}, ${none.samples} muestras, renderizado por <code>rt</code>. Cada tipo a los grados 1/4, 1 y 2 junto a la misma imagen sin filtro, y las dos pilas del encargo. Los grados → <i>s</i> (0,03 / 0,06 / 0,12 / 0,22 / 0,38) y los anchos (σ₁ 0,25°, σ₂ 2,5°) son la propuesta del encargo, y los demás números (reparto de lóbulos, transmisión de la difusión negra 0,7, tintes, longitud y grosor de las rayas, celdas del brillo) son propuestas mías: todo queda para el veredicto (regla 11).</p>
${rows.join('\n')}
<h2>Pilas</h2><div class="grid">${figure(none)}${stacks.map(figure).join('')}</div>
<h2>Con y sin las conexiones a las luces</h2>
<p>A la izquierda, como renderiza el motor: la dispersión en la pupila y la conexión de cada muestra de cámara a una luz que la cámara ve, a través de la PSF del filtro, pesadas una contra otra (MIS, heurística del balance, lóbulo a lóbulo). A la derecha, la dispersión sola, a las mismas muestras: la misma imagen en promedio, con el ruido de los rayos dispersos que rara vez dan con una luz pequeña.</p>
${alone.map((c) => `<div class="grid">${figure(pair(c))}${figure(c).replace('</b>', ' · sin conexiones</b>')}</div>`).join('\n')}
</body></html>
`;
writeFileSync(join(ROOT, 'out/lens-filters-sheet.html'), html);
console.log(`wrote out/lens-filters-sheet.html (${index.cells.length} images)`);
