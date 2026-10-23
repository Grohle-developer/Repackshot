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
//        [--bottle-shot docs/ui/rain-bottle.png] [--reuse]
//
// With --reuse, what <out>/ already holds (the scenes, the table, the PNGs) is not made again.
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
const REUSE = args.includes('--reuse');
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
if (!(REUSE && existsSync(join(OUT, 'shots.json')))) run('npx', ['vitest', 'run', 'tests/water-dump.test.ts'], { REPACKSHOT_WATER_DIR: OUT, REPACKSHOT_WATER_SPP: SAMPLES });
const manifest = JSON.parse(readFileSync(join(OUT, 'shots.json'), 'utf8'));
if (!(REUSE && existsSync(join(OUT, 'table.json')))) console.log(run(RT, ['--water-table', join(OUT, 'water.txt'), '-o', join(OUT, 'table.json')]).trim().split('\n').pop());
const table = JSON.parse(readFileSync(join(OUT, 'table.json'), 'utf8'));
for (const shot of manifest.shots) {
  if (REUSE && existsSync(join(OUT, `${shot.file}.png`))) continue;
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
// The drops on each part of the bottle at each instant (from the recorded frames).
const partNames = manifest.shots[0].parts.map((p) => p.part);
const partRows = times
  .map((t) => {
    const shot = manifest.shots.find((s) => s.place === 'whole' && s.t === t);
    return `<tr><td>${t} s</td>${shot.parts.map((p) => `<td>${p.drops}</td><td>${mm(p.medianMm)}</td><td>${mm(p.largestMm)}</td>`).join('')}</tr>`;
  })
  .join('');
// Water's numbers (rt_phys::wet): γ = 72 mN/m, ρ g = 9.81e-6 N/mm³, μ = 1 mPa·s; the capillary length √(γ/ρg).
const GAMMA = 0.072;
const CAP_LEN_MM = Math.sqrt(7.2e-5 / 9.81e-6);
const LAMBDA = 12;
const PEARL_DEG = 10;
const MAX_SLIDE_MM_S = 250;
const rad = (d) => (d * Math.PI) / 180;
const families = [...new Map(table.rows.map((r) => [r.family, r])).values()];
const pearlRows = families
  .map((r) => {
    const ca = Math.max(0, rad(r.recedingDeg) ** 3 - rad(PEARL_DEG) ** 3) / (9 * LAMBDA);
    const speed = (ca * GAMMA) / 1e-3;
    const mean = rad(0.5 * (r.advancingDeg + r.recedingDeg));
    const puddle = 2 * CAP_LEN_MM * Math.sin(mean / 2);
    return `<tr><td>${esc(r.family)}</td><td>${r.advancingDeg}/${r.recedingDeg}</td><td>${ca.toExponential(2)}</td><td>${(speed * 1000).toFixed(0)}</td><td>${speed * 1000 < MAX_SLIDE_MM_S ? 'yes' : 'no'}</td><td>${puddle.toFixed(2)}</td><td>${((1 - Math.cos(mean)) / Math.sin(mean)).toFixed(2)}</td></tr>`;
  })
  .join('');
const literature = `<h2>Against the literature</h2>
<ul>
<li><b>The hold</b> is Furmidge's balance, <i>ρ g V sin α = k γ w (cos θ<sub>R</sub> − cos θ<sub>A</sub>)</i>, with <i>k</i> = 1 and the width <i>w</i> = 2<i>a</i> of the round cap of the drop's volume (Furmidge, J. Colloid Sci. 17, 1962). <i>k</i> = 1 is that of a drop whose front half is at θ<sub>A</sub> and whose rear half at θ<sub>R</sub>; assumed distributions of the angle around the contact line give <i>k</i> = 2/π (Extrand and Gent, J. Colloid Interface Sci. 138, 1990), 24/π³ = 0.77 (ElSherbini and Jacobi, J. Colloid Interface Sci. 299, 2006) and π/4 (Carré and Shanahan), as de la Madrid et al. (arXiv:1902.06721, 2019) list them. Measured: <i>k</i> between 0.5 and 1.5, 0.88 ± 0.2 on average over 23 liquid and surface pairs, 0.63 for water on a silicon wafer (Li et al., “Kinetic drop friction”, Nat. Commun. 14, 4571, 2023, Table 1); 0.97 ± 0.04 for water on PMMA (de la Madrid et al., arXiv:2306.08689, 2023). With <i>k</i> = 0.88 the critical contact diameters of the table would be 6 % smaller and the volumes 17 % (<i>a<sub>c</sub></i> ∝ √<i>k</i>).</li>
<li><b>A measured force.</b> de la Madrid et al. (2023, Table 1) measured 183 ± 4 µN holding a water drop on PMMA (θ<sub>A</sub> 69.9°, θ<sub>R</sub> 47.2°, width at the onset 7.79 mm); <i>γ w</i> (cos θ<sub>R</sub> − cos θ<sub>A</sub>) gives 188 µN, 3 % more.</li>
<li><b>The tilt.</b> ElSherbini and Jacobi (2006) find “the Bond number of a critical drop […] constant for a given surface and liquid”: the model's critical contact radius goes as 1/√sin α, so <i>V</i><sup>2/3</sup> sin α is the same at every tilt of the table.</li>
<li><b>The speed.</b> Li et al. (2023) fit the friction of sliding drops as <i>F</i><sub>0</sub> + β <i>w η U</i>, β from 20 to 200 (water: 56 to 216) up to 0.7 m/s; the model's drag <i>C μ a U</i> with <i>C</i> = 300 (rt_phys::wet <code>SLIDE_DRAG</code>) is β = 150.</li>
<li><b>The beads.</b> Running drops round, then corner, then cusp and shed “smaller drops (pearls)” as their capillary number grows (Podgorski, Flesselles and Limat, Phys. Rev. Lett. 87, 036102, 2001, abstract). On rigid surfaces the trailing contact angle just before pearling is about 10° (Le Grand, Daerr and Limat, J. Fluid Mech. 541, 2005, as Oléron et al. report it, arXiv:2304.04925, 2023: “the trailing edge contact angle decreases almost to zero at the pearling transition threshold”); the corner appears at a receding angle of about 23° (Le Grand et al., as Kumar and Puthenveettil report it, arXiv:1006.1506, 2010); pearling without excitation sets in near Ca ≈ 0.007 (Peters, Snoeijer, Daerr and Limat, Phys. Rev. Lett. 103, 2009, as Liang and Tietze report it, Sci. Rep. 7, 14164, 2017). Li et al. (2023) saw water drops shed “tiny satellite droplets” past ≈ 0.7 m/s. Liang and Tietze saw at most two pearls (once three) leave a water drop over a 200 mm plate of coated glass that Lamb waves helped it down.</li>
<li><b>Puddles.</b> A drop wider than the capillary length (${CAP_LEN_MM.toFixed(2)} mm for water) flattens into a puddle <i>2 √(γ/ρg) sin(θ/2)</i> tall (de Gennes, Brochard-Wyart and Quéré, <i>Capillarity and Wetting Phenomena</i>, 2004; Tavares et al., arXiv:2402.10185, 2024, eq. 59): the model draws every drop as a spherical cap, so a large drop on a level face (the cap's top) is drawn taller than a puddle of its volume.</li>
</ul>
<table><tr><th>Family</th><th>θ<sub>A</sub>/θ<sub>R</sub></th><th>Ca at which its rear angle falls to ${PEARL_DEG}°</th><th>Speed, mm/s</th><th>Reachable (≤ ${MAX_SLIDE_MM_S} mm/s)?</th><th>Puddle height, mm</th><th>Cap height over its contact radius</th></tr>${pearlRows}</table>`;
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
<h3>The drops on each part</h3>
<table><tr><th></th>${partNames.map((n) => `<th colspan="3">${esc(n)}</th>`).join('')}</tr><tr><th>Time</th>${partNames.map(() => '<th>Drops</th><th>Median ⌀</th><th>Largest ⌀</th>').join('')}</tr>${partRows}</table>
<h2>The water table</h2>
<p>One plate of each family, 100 mm square, at each tilt, under the same rain falling onto it square-on for ${table.seconds} s (so every tilt takes the same water). Diameters in mm, median / 90th percentile (the count of drops that started to slide in brackets). <b>Outline</b>: the area-equivalent diameter of the outline the renderer draws over the physical contact diameter, least–most over every drop at every frame, by state.</p>
<table><tr><th>Family</th><th>θ<sub>A</sub>/θ<sub>R</sub></th><th>Tilt</th><th>Critical contact ⌀ (model)</th><th>Contact ⌀ at depinning</th><th>Sphere ⌀ at depinning</th><th>Runner contact ⌀</th><th>Outline, pinned</th><th>sliding</th><th>merging</th><th>hanging</th><th>Pearls</th></tr>${rows}</table>
${literature}
</main>`;
writeFileSync(HTML, html);
console.log(`wrote ${HTML}`);

if (BOTTLE_SHOT) {
  const shot = manifest.shots.find((s) => s.place === 'body' && s.t === 10);
  const page = join(OUT, 'bottle-shot.html');
  writeFileSync(
    page,
    `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:#000}figure{margin:0}.img{position:relative;line-height:0}.bar{position:absolute;left:14px;bottom:16px;height:4px;background:#fff;box-shadow:0 0 0 1px #000}.barlabel{position:absolute;left:14px;bottom:24px;font:12px/1 system-ui,sans-serif;color:#fff;text-shadow:0 0 2px #000}</style>${figure(shot, `${shot.file}.png`).replace(/<figcaption>.*<\/figcaption>/, '')}`,
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
