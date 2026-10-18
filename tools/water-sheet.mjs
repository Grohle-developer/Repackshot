#!/usr/bin/env node
// The water sheet of phase S3g (not part of `npm run qa`): what the drops on the parts look like and measure, for the
// eye and for the values marked ◆ in the ROADMAP's S3g. The example bottle under the default Rain with On the parts at
// 2, 5, 10 and 20 s, rendered by the native engine, whole and close on four places (the vertical body, the shoulder, the
// paper label, the top of the cap), each close-up with a millimetre scale bar; and the water table: for each wettability
// family and tilt (90°, 60°, 45°, 30°, 15°), the model's critical contact diameter, the contact diameter of the drops
// when they start to slide in a run (median and 90th percentile) and their equivalent sphere, the size of the runners,
// the outline the renderer draws against the physical contact area by state, and the pearls; beside it, what the
// published measurements say.
//
//   npm run engine:build && node tools/water-sheet.mjs [--out out/water-sheet] [--samples 64] [--threads 2]
//        [--bottle-shot docs/ui/rain-bottle.png]
//
// 1. builds the native engine if `engine/target/release/rt` is missing;
// 2. writes the RSB files, the shots and the table's input through tests/water-dump.test.ts (skipped by `npm test`
//    unless REPACKSHOT_WATER_DIR is set, which this tool does): the simulation runs in the real rt.wasm, through the
//    page's own code;
// 3. `rt --water-table <out>/water.txt -o <out>/table.json` runs the water table natively;
// 4. renders each shot with `rt <file> -o <png> --samples N --threads T`;
// 5. writes <out>.html (out/water-sheet.html) with the PNGs of <out>/ next to it; with --bottle-shot, the close-up of
//    the body at 10 s with its scale bar as that PNG (the local Chromium, playwright-core).

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const OUT = resolve(ROOT, opt('out', 'out/water-sheet'));
const HTML = `${OUT}.html`;
const SAMPLES = opt('samples', '64');
const THREADS = opt('threads', '2');
const BOTTLE_SHOT = opt('bottle-shot', null);
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

mkdirSync(OUT, { recursive: true });
if (!existsSync(RT)) run('cargo', ['build', '--release', '-p', 'rt-cli'], {}, join(ROOT, 'engine'));
run('npx', ['vitest', 'run', 'tests/water-dump.test.ts'], { REPACKSHOT_WATER_DIR: OUT, REPACKSHOT_WATER_SPP: SAMPLES });
const manifest = JSON.parse(readFileSync(join(OUT, 'shots.json'), 'utf8'));
console.log(run(RT, ['--water-table', join(OUT, 'water.txt'), '-o', join(OUT, 'table.json')]).trim().split('\n').pop());
const table = JSON.parse(readFileSync(join(OUT, 'table.json'), 'utf8'));
for (const shot of manifest.shots) {
  const said = run(RT, [join(OUT, `${shot.file}.rsb`), '-o', join(OUT, `${shot.file}.png`), '--samples', String(shot.samples), '--threads', THREADS]);
  console.log(`${shot.file}: ${said.trim().split('\n').pop()}`);
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const rel = (f) => `${relative(dirname(HTML), OUT)}/${f}`;
const mm = (v, d = 2) => (v ? v.toFixed(d) : '–');
/** A shot with its scale bar: 5 mm at its surface (close-ups). */
function figure(shot, src) {
  const bar = shot.mmPerPx ? 5 / shot.mmPerPx : 0;
  const scale = bar
    ? `<div class="bar" style="width:${bar.toFixed(1)}px"></div><div class="barlabel">5 mm</div>`
    : '';
  return `<figure id="${shot.file}"><div class="img"><img src="${src}" width="${shot.width}" height="${shot.height}" alt="${esc(shot.label)}, ${shot.t} s">${scale}</div><figcaption>${esc(shot.label)}, ${shot.t} s · ${shot.drops} drops on the parts</figcaption></figure>`;
}
const places = ['whole', 'body', 'shoulder', 'label', 'cap'];
const times = [...new Set(manifest.shots.map((s) => s.t))];
const grid = places
  .map((p) => {
    const row = times.map((t) => manifest.shots.find((s) => s.place === p && s.t === t)).filter(Boolean);
    return `<h3>${esc(row[0].label)}</h3><div class="row">${row.map((s) => figure(s, rel(`${s.file}.png`))).join('')}</div>`;
  })
  .join('');
const q = (x, d = 2) => (x.count ? `${mm(x.median, d)} / ${mm(x.p90, d)}` : '–');
const range = (x) => (x.count ? `${x.min.toFixed(2)}–${x.max.toFixed(2)}` : '–');
const rows = table.rows
  .map(
    (r) => `<tr><td>${esc(r.family)}</td><td>${r.advancingDeg}/${r.recedingDeg}</td><td>${r.tiltDeg}°</td><td>${mm(2 * r.criticalRadiusMm)}</td><td>${q(r.depinContactMm)} <small>(${r.depinContactMm.count})</small></td><td>${q(r.depinSphereMm)}</td><td>${q(r.runnerContactMm)}</td>${['pinned', 'sliding', 'merging', 'hanging'].map((k) => `<td>${range(r.outline[k])}</td>`).join('')}<td>${r.pearls}</td></tr>`,
  )
  .join('');
const rain = table.rain;
const html = `<!doctype html><meta charset="utf-8"><title>Water sheet</title><style>
html,body{margin:0;background:#141414;color:#ddd;font:14px/1.45 system-ui,sans-serif}
main{padding:16px;max-width:2900px}
h1,h2,h3{font-weight:600}h3{margin:18px 0 6px}
.row{display:flex;gap:8px;flex-wrap:wrap}
figure{margin:0}figcaption{font-size:12px;color:#aaa;padding:4px 0}
.img{position:relative;line-height:0}
.bar{position:absolute;left:14px;bottom:16px;height:4px;background:#fff;box-shadow:0 0 0 1px #000}
.barlabel{position:absolute;left:14px;bottom:24px;font:12px/1 system-ui,sans-serif;color:#fff;text-shadow:0 0 2px #000}
table{border-collapse:collapse;font-size:12px}td,th{border:1px solid #333;padding:3px 6px;text-align:right}th{background:#222}td:first-child{text-align:left}
p,li{max-width:1100px}
</style><main>
<h1>Water sheet</h1>
<p>The example bottle under the default Rain (${(rain.density * 1e9).toFixed(0)} drops per m³ of ${rain.sizeMm} mm ± ${(100 * rain.sizeVar).toFixed(0)} %, ${(rain.speed / 1000).toFixed(2)} m/s) with <i>On the parts</i>, simulated by the engine and rendered by the native engine (${manifest.shots[0].samples} samples per pixel). The close-ups are square-on to their surface and ${(manifest.shots.find((s) => s.mmPerPx).mmPerPx * manifest.width).toFixed(0)} mm across; the bar is 5 mm at the surface.</p>
${grid}
<h2>The water table</h2>
<p>One plate of each family, 100 mm square, at each tilt, under the same rain falling onto it square-on for ${table.seconds} s (so every tilt takes the same water). Diameters in mm, median / 90th percentile (the count of drops that started to slide in brackets). <b>Outline</b>: the area-equivalent diameter of the outline the renderer draws over the physical contact diameter, least–most over every drop at every frame, by state.</p>
<table><tr><th>Family</th><th>θ<sub>A</sub>/θ<sub>R</sub></th><th>Tilt</th><th>Critical contact ⌀ (model)</th><th>Contact ⌀ at depinning</th><th>Sphere ⌀ at depinning</th><th>Runner contact ⌀</th><th>Outline, pinned</th><th>sliding</th><th>merging</th><th>hanging</th><th>Pearls</th></tr>${rows}</table>
</main>`;
writeFileSync(HTML, html);
console.log(`wrote ${HTML}`);

if (BOTTLE_SHOT) {
  const shot = manifest.shots.find((s) => s.place === 'body' && s.t === 10);
  const page = join(OUT, 'bottle-shot.html');
  writeFileSync(
    page,
    `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:#000}.img{position:relative;line-height:0}.bar{position:absolute;left:14px;bottom:16px;height:4px;background:#fff;box-shadow:0 0 0 1px #000}.barlabel{position:absolute;left:14px;bottom:24px;font:12px/1 system-ui,sans-serif;color:#fff;text-shadow:0 0 2px #000}</style>${figure(shot, `${shot.file}.png`).replace(/<figcaption>.*<\/figcaption>/, '')}`,
  );
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch({ executablePath: findChromium(), headless: true, args: ['--no-sandbox', '--disable-gpu'] });
  try {
    const view = await browser.newPage({ viewport: { width: shot.width, height: shot.height } });
    await view.goto(pathToFileURL(page).href);
    await view.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth > 0));
    const out = resolve(ROOT, BOTTLE_SHOT);
    mkdirSync(dirname(out), { recursive: true });
    await view.screenshot({ path: out, clip: { x: 0, y: 0, width: shot.width, height: shot.height } });
    console.log(`wrote ${out}`);
  } finally {
    await browser.close();
  }
}
