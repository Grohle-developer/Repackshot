#!/usr/bin/env node
// The sheet of the traced lenses (phase O2), for the lead's verdict (rule 11): `rt --lens-sheet` renders, for each of
// the 16 lenses of src/data/lenses.json (the anamorphic adapter in front of the double Gauss), the perfume bottle wide
// open and at f/8, points of light far behind the focus wide open and through the thin lens at the same f-number, and
// a chart of small lights in focus at the lens's own field; with the thin lens of the bottle at f/2 and f/8 and of a
// 50 mm chart, at 400 × 300 and 96 spp, into out/lens-sheet/; `rt --lens-cost` measures the traced camera
// (out/lens-sheet/cost.json). This writes out/lens-sheet.html: per lens its names, source and the engine's numbers,
// its cross-section and its distortion and relative-illumination curves as the engine computed them
// (src/ui/components/lens-section.ts, the inspector's drawing), the images, close-ups of a light at the centre and at the
// corner of the frame next to the thin lens's, and the costs.
//
//   node tools/lens-sheet.mjs [--samples N] [--reuse]      --reuse: only write the page again
//
// It builds `rt` (cargo build --release -p rt-cli in engine/).

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lensSectionSvg, profileChartSvg } from '../src/ui/components/lens-section.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const DIR = join(ROOT, 'out/lens-sheet');

if (!args.includes('--reuse')) {
  execFileSync('cargo', ['build', '--release', '-p', 'rt-cli', '--quiet'], { cwd: join(ROOT, 'engine'), stdio: 'inherit' });
  const rt = join(ROOT, 'engine/target/release', process.platform === 'win32' ? 'rt.exe' : 'rt');
  execFileSync(rt, ['--lens-sheet', DIR, '--samples', String(opt('samples', 96))], { stdio: 'inherit' });
  execFileSync(rt, ['--lens-cost', DIR], { stdio: 'inherit' });
}
if (!existsSync(join(DIR, 'index.json'))) throw new Error('no out/lens-sheet/index.json: render it first');
const index = JSON.parse(readFileSync(join(DIR, 'index.json'), 'utf8'));
const cost = existsSync(join(DIR, 'cost.json')) ? JSON.parse(readFileSync(join(DIR, 'cost.json'), 'utf8')) : null;
const catalogue = JSON.parse(readFileSync(join(ROOT, 'src/data/lenses.json'), 'utf8')).lenses;
const { width: W, height: H } = index;

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const num = (x, d = 1) => (Number.isFinite(x) ? x.toFixed(d).replace('.', ',').replace('-', '−') : '—');
const cell = (key) => index.cells.find((c) => c.key === key);
const CHARACTER = { clinical: 'clínica', soft: 'suave', swirl: 'remolino', vintage: 'vintage', anamorphic: 'anamórfica', macro: 'macro', wide: 'gran angular', tele: 'tele' };
const STATUS = { verified: 'verificada', caveat: 'con reserva', experimental: 'experimental', 'own-design': 'diseño propio' };

const figure = (c, caption) =>
  c
    ? `<figure><img src="lens-sheet/${c.file}" width="${W}" height="${H}" alt="${esc(c.key)}"><figcaption><b>${caption}</b> <span class="k">f/${num(c.fstop, 2)} · ${num(c.focalMm, 1)} mm · ${c.samples} spp · ${num(c.seconds, 1)} s · ${num(c.rays / 1e6, 1)} M rayos</span></figcaption></figure>`
    : '';

// The points scene's lights (rt-cli lens_sheet.rs bokeh_points): fractions of the half frame; a close-up of the
// light nearest the centre and of the top-right corner's, 2.5 times.
const LIGHT_CENTRE = [0, 0.24];
const LIGHT_CORNER = [0.8, 0.72];
const CROP = 64;
const ZOOM = 2.5;
function crop(c, at, label) {
  if (!c) return '';
  const x = (0.5 + at[0] / 2) * W - CROP / 2;
  const y = (0.5 - at[1] / 2) * H - CROP / 2;
  const s = CROP * ZOOM;
  return `<div class="crop"><div style="width:${s}px;height:${s}px;background:#000 url(lens-sheet/${c.file}) no-repeat;background-size:${W * ZOOM}px ${H * ZOOM}px;background-position:${-x * ZOOM}px ${-y * ZOOM}px;image-rendering:pixelated"></div><span class="k">${label}</span></div>`;
}

function numbers(info) {
  if (!info?.traced) return '';
  const rows = [
    ['Focal (paraxial, infinito)', `${num(info.eflMm, 2)} mm`],
    ['Focal al foco · escala de imagen', `${num(info.eflFocusedMm, 2)} · ${num(info.imageScaleMm, 2)} mm`],
    ['Tiraje (infinito)', `${num(info.bflMm, 2)} mm`],
    ['f/ en uso · más abierto', `f/${num(info.fNumber, 2)} · f/${num(info.fNumberMin, 2)}`],
    ['T-stop', `T${num(info.tStop, 2)}`],
    ['Transmisión R G B', info.transmittance.map((t) => num(100 * t, 1)).join(' · ') + ' %'],
    ['Elementos · grupos', `${info.elements} · ${info.groups}`],
    ['Longitud', `${num(info.lengthMm, 1)} mm`],
    ['Pupila de entrada (posición · diámetro)', `${num(info.entrancePupilMm[0], 1)} · ${num(info.entrancePupilMm[1], 1)} mm`],
  ];
  if (info.squeeze && Math.abs(info.squeeze - 1) > 1e-4) rows.push(['Compresión anamórfica al foco', `${num(info.squeeze, 3)}×`]);
  return `<table class="kv">${rows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('')}</table>`;
}

function curves(info) {
  if (!info?.traced) return '';
  const d = info.distortion;
  const ri = info.relativeIllumination;
  const dMax = Math.max(1, ...d.map((p) => Math.abs(p[1])));
  const lastD = d[d.length - 1];
  const lastRi = ri[ri.length - 1];
  const ev = lastRi && lastRi[1] > 0 ? Math.log2(lastRi[1]) : -Infinity;
  const dSvg = profileChartSvg(d, { width: 200, height: 70, min: -dMax, max: dMax, zero: 0, title: 'Distorsión' });
  const riSvg = profileChartSvg(ri, { width: 200, height: 70, min: 0, max: 1, zero: 1, title: 'Iluminación relativa' });
  return `<div class="curves"><div>${dSvg}<span class="k">Distorsión, ±${num(dMax, 1)} %: ${lastD ? `${num(lastD[1], 1)} % a ${num(lastD[0], 1)} mm` : 'sin rayo principal'}</span></div><div>${riSvg}<span class="k">Iluminación relativa: ${lastRi ? `${num(100 * lastRi[1], 0)} % a ${num(lastRi[0], 1)} mm (${Number.isFinite(ev) ? `${num(ev, 1)} EV` : 'negro'})` : '—'}</span></div></div>`;
}

const costOf = (key) => cost?.lenses.find((l) => l.lens === key);

const sections = catalogue.map((l) => {
  const name = l.key.replace(/_/g, '-');
  const open = cell(`${name}--bottle--open`);
  const f8 = cell(`${name}--bottle--f8`);
  const points = cell(`${name}--points--open`);
  const thin = cell(`${name}--points--thin`);
  const chart = cell(`${name}--chart--open`);
  // The engine's section as core/traced-lens.ts parseLensInfo reads it.
  const raw = chart?.info?.section;
  const section = raw && { ...raw, surfaces: raw.surfaces.map((a) => ({ z: a[0], kind: a[1], curvature: a[2], semiAperture: a[3], index: a[4], conic: a[5], aspheric: a.slice(6, 10) })) };
  const svg = section
    ? lensSectionSvg(section, { width: 360, height: 150, sensorHalfMm: 0.5 * Math.hypot(36, 27) * (chart.focalMm / chart.info.eflMm), title: `Corte de ${l.name.es}` })
    : '';
  const c = costOf(l.key);
  const costLine = c && cost ? `Muestra de cámara: ${num(c.cameraMicros, 2)} µs (${c.surfaces} superficies) frente a ${num(cost.thinMicros, 2)} µs de la lente fina.` : '';
  const src = `${esc(l.source.doc)}${l.source.year ? ` (${l.source.year})` : ''} · ${STATUS[l.status] ?? l.status}`;
  return `<section><h2>${esc(l.name.es)} <span class="k">${l.key} · ${CHARACTER[l.character] ?? l.character}</span></h2>
<p>${src}. ${l.notes.map(esc).join(' ')}</p>
<div class="meta"><div class="section">${svg}<span class="k">El corte, como lo traza el motor en el gráfico (${num(chart?.focalMm ?? 0, 1)} mm, enfocado a 3 m, abierto)</span></div>${numbers(open?.info)}${curves(chart?.info)}</div>
<p class="k">Números del frasco (85 mm) a la izquierda; curvas del gráfico, a su propio campo. ${costLine}</p>
<div class="grid">${figure(open, 'Frasco, abierto')}${figure(f8, 'Frasco, f/8')}${figure(chart, `Gráfico a su campo (${num(chart?.focalMm ?? 0, 1)} mm)`)}</div>
<div class="grid">${figure(points, 'Puntos de luz, abierto')}${figure(thin, 'Los mismos, lente fina al mismo f/')}<div class="crops">${crop(points, LIGHT_CENTRE, 'centro, trazada')}${crop(thin, LIGHT_CENTRE, 'centro, fina')}${crop(points, LIGHT_CORNER, 'esquina, trazada')}${crop(thin, LIGHT_CORNER, 'esquina, fina')}</div></div>
</section>`;
});

function costTable() {
  if (!cost) return '<p>Sin <code>cost.json</code>: <code>rt --lens-cost out/lens-sheet</code>.</p>';
  const name = { example: 'El ejemplo de O2', bottle: 'El frasco de la hoja' };
  const lines = cost.rows.map(
    (r) =>
      `<tr><td>${name[r.scene] ?? r.scene}, ${r.width} × ${r.height}, ${r.samples} spp</td><td>${r.camera === 'thin' ? 'Lente fina' : 'Doble Gauss trazada'}</td><td>${num(r.renderSeconds, 1)} s</td><td>${num(r.cameraSeconds, 2)} s</td><td><b>${num(100 * r.share, 1)} %</b></td><td>${num(r.cameraMicros, 3)} µs</td><td>${r.unbatchedMicros !== undefined ? `${num(r.unbatchedMicros, 3)} µs` : '—'}</td><td>${num(r.sampleMicros, 2)} µs</td><td>${num(r.rays / 1e6, 2)} M</td></tr>`,
  );
  const pair = (scene) => [cost.rows.find((r) => r.scene === scene && r.camera !== 'thin'), cost.rows.find((r) => r.scene === scene && r.camera === 'thin')];
  const extra = (scene) => {
    const [t, f] = pair(scene);
    return t && f ? num((100 * (t.cameraMicros - f.cameraMicros) * (t.cameraSeconds / t.cameraMicros)) / t.renderSeconds, 1) : '—';
  };
  return `<p>El criterio de la fase pide que la cámara trazada cueste como mucho el 25 % del render del ejemplo con la doble Gauss a 1024 muestras. Medido con <code>rt --lens-cost</code> en un hilo, la más rápida de ${cost.runs ?? 1} vueltas de cada medida: el render entero y, aparte, las muestras de cámara solas (lo que la baldosa hace antes de trazar el rayo en la escena: la banda, el punto de la pupila, el trazado por las superficies y el peso), en lotes de ocho como las traza la baldosa y una a una como antes de los lotes; también en el frasco de vidrio de la hoja. En esta máquina, cargada por otros procesos, los segundos son orientativos; la proporción es lo que cuenta. Antes de los lotes (la primera entrega) la cámara trazada era el 29,1 % del render del ejemplo (0,71 µs por muestra de cámara, 7,7 s).</p>
<table><thead><tr><th>Escena</th><th>Cámara</th><th>Render</th><th>Muestras de cámara</th><th>Parte del render</th><th>Por muestra de cámara</th><th>Una a una (sin lotes)</th><th>Por muestra</th><th>Rayos</th></tr></thead><tbody>
${lines.join('\n')}
</tbody></table>
<p>Lo que la lente trazada añade sobre la muestra de la lente fina: el ${extra('example')} % del render del ejemplo y el ${extra('bottle')} % del del frasco.</p>
<p>Por lente, la muestra de cámara en la escena de puntos (96 × 72, 64 muestras): ${cost.lenses.map((l) => `${esc(l.lens)} ${num(l.cameraMicros, 2)} µs (${l.surfaces})`).join(' · ')}; lente fina ${num(cost.thinMicros, 2)} µs.</p>`;
}

const thinRow = `<div class="grid">${figure(cell('thin--bottle--f2'), 'Lente fina, f/2')}${figure(cell('thin--bottle--f8'), 'Lente fina, f/8')}${figure(cell('thin--chart--f8'), 'Lente fina, gráfico a 50 mm')}</div>`;

const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>Lens sheet</title>
<style>
body{background:#111;color:#ddd;font:13px/1.4 system-ui,sans-serif;margin:24px}
h1{font-size:18px;font-weight:600;margin:0 0 4px}
h2{font-size:15px;font-weight:600;margin:32px 0 2px}
p{margin:0 0 10px;color:#999;max-width:1100px}
.grid{display:flex;flex-wrap:wrap;gap:16px;align-items:flex-start;margin-bottom:10px}
figure{margin:0}
img{display:block;background:#000}
figcaption{padding:6px 0;max-width:${W}px}
b{color:#fff}
.k{color:#777;font-weight:400;font-size:12px}
.meta{display:flex;flex-wrap:wrap;gap:24px;align-items:flex-start;margin:6px 0 8px;color:#ccc}
.section,.curves>div{display:flex;flex-direction:column;gap:4px;max-width:360px}
.curves{display:flex;flex-direction:column;gap:8px}
.crops{display:grid;grid-template-columns:repeat(2,${CROP * ZOOM}px);gap:8px}
.crop{display:flex;flex-direction:column;gap:2px}
table{border-collapse:collapse;margin:4px 0 12px}
th,td{padding:3px 12px 3px 0;text-align:left;border-bottom:1px solid #333;font-variant-numeric:tabular-nums}
th{color:#999;font-weight:500}
table.kv td:first-child{color:#999}
svg{color:#ccc}
</style></head><body>
<h1>Lentes trazadas (O2)</h1>
<p>Las 16 lentes de <code>src/data/lenses.json</code> trazadas por <code>rt</code> superficie a superficie (el adaptador anamórfico, delante de la doble Gauss normal), ${W} × ${H} y ${index.cells[0]?.samples ?? '?'} muestras. Por lente: el frasco de perfume de la hoja de filtros (85 mm, sin filtros) abierto y a f/8 (el catadióptrico solo tiene f/6,3); la escena de puntos de luz (un 85 mm enfocado a 600 mm, discos de 60 mm a 6 m en una rejilla de 5 × 4 sobre el cuadro) abierta, y la misma con la lente fina al mismo f/, con los primeros planos de la luz más cercana al centro y de la de la esquina; y un gráfico de luces pequeñas enfocadas a 3 m en una rejilla rectilínea que llena el cuadro de una lente sin distorsión (13 × 9), al campo de cada lente (el que da su fuente; si no da ninguno, 50 mm, y 135 mm las tele; el ojo de pez a 18 mm, la esquina dentro de su círculo de imagen), abierto: la distorsión curva sus filas, el viñeteo oscurece sus esquinas. Todo lo que se ve sale del trazado (distorsión, viñeteo, ojo de gato, burbuja o cremoso por la esférica, coma, curvatura de campo, la aberración cromática por bandas, la respiración); ningún mando artístico está movido. Los números, el corte y las curvas son los que da el motor (<code>LensInfo</code>), los mismos que enseña el inspector. Para el veredicto (regla 11): el aspecto de cada lente, qué tipos de bokeh dan (ojo de gato, burbuja, cremoso, remolino) y si las prescripciones y los diafragmas supuestos (<code>stopBasis</code>) se quedan.</p>
<h2>Lente fina, de referencia</h2>
${thinRow}
<h2>Coste de la cámara trazada</h2>
${costTable()}
${sections.join('\n')}
</body></html>
`;
writeFileSync(join(ROOT, 'out/lens-sheet.html'), html);
console.log(`wrote out/lens-sheet.html (${index.cells.length} images)`);
