// Gobo patterns: the light-shaping masks projected by a studio light (STUDIO-TOOLS §3 and §6, phase A6).
//
//   node tools/assets/gobos.mjs            writes public/assets/gobo/*.png and index.json
//   node tools/assets/gobos.mjs --check    regenerates in memory and compares with what is on disk
//
// Every file is 1024 x 1024, 8-bit grey, drawn from a recipe (kind, parameters, seed) by pure code: the foliage
// and the dappled light are seeded value noise and fractal sums, never a photograph, never an image model (project
// rule: clean room). The index lists each file's recipe, seed and two hashes: `sha256` of the PNG as written and
// `pixelsSha256` of the raw pixels, the canonical one (see tools/assets/aperture-masks.mjs).
//
// Convention: the image covers [-1, 1]^2 with v up, the grey level is the light that passes (255 open, 0 blocked).
// The light projects it in its own space, so the pattern's size on the subject is the light's business.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { clamp01, coverage, cos, encodePng, fbm, hash2, PI, rng, sha256, sin, smoothstep, toByte } from './common.mjs';

export const GENERATOR = { name: 'gobos', version: 1 };
export const SIZE = 1024;
const PX = 2 / SIZE;

/** Every gobo of the set, in the order of the index. */
export function recipes() {
  return [
    { id: 'window_2x3', file: 'window-2x3.png', seed: 0, recipe: { kind: 'window', columns: 2, rows: 3, halfWidth: 0.62, halfHeight: 0.86, frame: 0.05, bar: 0.035 }, description: 'window with 2 x 3 panes' },
    { id: 'window_3x4', file: 'window-3x4.png', seed: 0, recipe: { kind: 'window', columns: 3, rows: 4, halfWidth: 0.7, halfHeight: 0.88, frame: 0.045, bar: 0.03 }, description: 'window with 3 x 4 panes' },
    { id: 'window_arched', file: 'window-arched.png', seed: 0, recipe: { kind: 'archedWindow', halfWidth: 0.55, bottom: -0.9, spring: 0.2, frame: 0.05, bar: 0.035, rows: 3 }, description: 'arched window with a fan of bars' },
    { id: 'blinds', file: 'blinds.png', seed: 0, recipe: { kind: 'blinds', slats: 16, closed: 0.58, angleDeg: 0, halfWidth: 0.9, halfHeight: 0.9 }, description: 'horizontal venetian blinds' },
    { id: 'blinds_angled', file: 'blinds-angled.png', seed: 0, recipe: { kind: 'blinds', slats: 12, closed: 0.5, angleDeg: 22, halfWidth: 0.9, halfHeight: 0.9 }, description: 'venetian blinds at 22 degrees' },
    { id: 'leaves', file: 'leaves.png', seed: 2001, recipe: { kind: 'leaves', count: 150, lengthMin: 0.2, lengthMax: 0.4, warp: 0.05, mottle: 0.25 }, description: 'foliage shadow, large leaves' },
    { id: 'leaves_dense', file: 'leaves-dense.png', seed: 2004, recipe: { kind: 'leaves', count: 270, lengthMin: 0.12, lengthMax: 0.26, warp: 0.04, mottle: 0.2 }, description: 'foliage shadow, small dense leaves' },
    { id: 'dappled', file: 'dappled.png', seed: 2002, recipe: { kind: 'dappled', scales: [4, 8, 15], fill: 0.66, soft: 0.55, warp: 0.22 }, description: 'dappled sunlight through a canopy' },
    { id: 'dots', file: 'dots.png', seed: 0, recipe: { kind: 'dots', columns: 14, radius: 0.3 }, description: 'grid of round holes' },
    { id: 'lines', file: 'lines.png', seed: 0, recipe: { kind: 'lines', count: 20, halfWidth: 0.2 }, description: 'thin vertical light lines' },
    { id: 'radial_burst', file: 'radial-burst.png', seed: 0, recipe: { kind: 'radial', rays: 28, soft: 0.12, hub: 0.07 }, description: 'burst of rays from the centre' },
    { id: 'breakup_soft', file: 'breakup-soft.png', seed: 2003, recipe: { kind: 'breakup', scale: 2.1, octaves: 4, low: 0.4, high: 0.6 }, description: 'soft irregular breakup of the light' },
  ];
}

const centre = (i) => (i + 0.5) / (SIZE / 2) - 1;

function paint(f) {
  const img = new Float64Array(SIZE * SIZE);
  for (let py = 0; py < SIZE; py++) {
    const y = -centre(py);
    for (let px = 0; px < SIZE; px++) img[py * SIZE + px] = f(centre(px), y);
  }
  return img;
}

const rad = (deg) => (deg * PI) / 180;

/** Signed distance of the nearest cell of a regular grid of rectangles (exact for grids: the axes are independent). */
function gridPaneSd(x, y, cols, rows, gw, gh, bar) {
  const pw = (2 * gw - (cols - 1) * bar) / cols;
  const ph = (2 * gh - (rows - 1) * bar) / rows;
  const ci = Math.min(cols - 1, Math.max(0, Math.round((x + gw - pw / 2) / (pw + bar))));
  const ri = Math.min(rows - 1, Math.max(0, Math.round((y + gh - ph / 2) / (ph + bar))));
  const lx = x - (-gw + pw / 2 + ci * (pw + bar));
  const ly = y - (-gh + ph / 2 + ri * (ph + bar));
  return Math.max(Math.abs(lx) - pw / 2, Math.abs(ly) - ph / 2);
}

function windowImage({ columns, rows, halfWidth, halfHeight, frame, bar }) {
  const gw = halfWidth - frame;
  const gh = halfHeight - frame;
  return paint((x, y) => coverage(gridPaneSd(x, y, columns, rows, gw, gh, bar), PX));
}

function archedWindowImage({ halfWidth, bottom, spring, frame, bar, rows }) {
  const gw = halfWidth - frame;
  const y0 = bottom + frame;
  const ys = spring;
  const c30 = Math.sqrt(3) / 2;
  const s30 = 0.5;
  const arcR = gw * 0.55;
  const hBars = [];
  for (let k = 1; k < rows; k++) hBars.push(y0 + ((ys - y0) * k) / rows);
  return paint((x, y) => {
    const dx = x;
    const dy = y - ys;
    const r = Math.sqrt(dx * dx + dy * dy);
    const region = y > ys ? r - gw : Math.max(Math.abs(x) - gw, y0 - y);
    // The bars: centre post, the spring line and the rail heights below it, a fan of two rays and one arc above it.
    let bars = Math.abs(x);
    bars = Math.min(bars, Math.abs(dy));
    for (const h of hBars) bars = Math.min(bars, Math.abs(y - h));
    if (y > ys) {
      const along1 = dx * s30 + dy * c30;
      const along2 = -dx * s30 + dy * c30;
      bars = Math.min(bars, along1 >= 0 ? Math.abs(dx * c30 - dy * s30) : r);
      bars = Math.min(bars, along2 >= 0 ? Math.abs(dx * c30 + dy * s30) : r);
      bars = Math.min(bars, Math.abs(r - arcR));
    }
    return coverage(Math.max(region, bar / 2 - bars), PX);
  });
}

function blindsImage({ slats, closed, angleDeg, halfWidth, halfHeight }) {
  const period = (2 * halfHeight) / slats;
  const gapHalf = (period * (1 - closed)) / 2;
  const ca = cos(rad(angleDeg));
  const sa = sin(rad(angleDeg));
  return paint((x, y) => {
    const s = -x * sa + y * ca;
    const f = s / period - 0.5;
    const gap = Math.abs(f - Math.round(f)) * period - gapHalf;
    const box = Math.max(Math.abs(x) - halfWidth, Math.abs(y) - halfHeight);
    return coverage(Math.max(gap, box), PX);
  });
}

function leavesImage(seed, { count, lengthMin, lengthMax, warp, mottle }) {
  const rand = rng(seed);
  // Domain warp, so that the edges of the leaves wander like real ones.
  const wx = new Float64Array(SIZE * SIZE);
  const wy = new Float64Array(SIZE * SIZE);
  for (let py = 0; py < SIZE; py++) {
    for (let px = 0; px < SIZE; px++) {
      const x = centre(px);
      const y = -centre(py);
      wx[py * SIZE + px] = (fbm(x * 3.1 + 5, y * 3.1, seed + 11, 3) - 0.5) * warp * 2;
      wy[py * SIZE + px] = (fbm(x * 3.1, y * 3.1 + 9, seed + 23, 3) - 0.5) * warp * 2;
    }
  }
  const t = new Float64Array(SIZE * SIZE).fill(1);
  for (let k = 0; k < count; k++) {
    const cx = (rand() * 2 - 1) * 1.12;
    const cy = (rand() * 2 - 1) * 1.12;
    const ang = rand() * PI;
    const ca = cos(ang);
    const sa = sin(ang);
    const L = lengthMin + rand() * (lengthMax - lengthMin);
    const W = L * (0.3 + rand() * 0.15);
    const alpha = 0.8 + rand() * 0.2;
    const reach = L / 2 + 0.07;
    const x0 = Math.max(0, Math.floor((cx - reach + 1) * (SIZE / 2)));
    const x1 = Math.min(SIZE - 1, Math.ceil((cx + reach + 1) * (SIZE / 2)));
    const y0 = Math.max(0, Math.floor((1 - (cy + reach)) * (SIZE / 2)));
    const y1 = Math.min(SIZE - 1, Math.ceil((1 - (cy - reach)) * (SIZE / 2)));
    for (let py = y0; py <= y1; py++) {
      for (let px = x0; px <= x1; px++) {
        const i = py * SIZE + px;
        const dx = centre(px) + wx[i] - cx;
        const dy = -centre(py) + wy[i] - cy;
        const u = dx * ca + dy * sa;
        const v = -dx * sa + dy * ca;
        const au = Math.abs(u);
        let sd;
        if (au <= L / 2) {
          const q = (2 * au) / L;
          const h = (W / 2) * (1 - q * q);
          const slope = (W / 2) * ((4 * q) / L);
          sd = (Math.abs(v) - h) / Math.sqrt(1 + slope * slope);
        } else {
          const e = au - L / 2;
          sd = Math.sqrt(e * e + v * v);
        }
        const cov = coverage(sd, PX * 1.3);
        if (cov <= 0) continue;
        // A thin lighter vein along the leaf.
        const vein = coverage(Math.abs(v) - 0.0035, PX * 1.3);
        t[i] *= 1 - alpha * cov * (1 - 0.45 * vein);
      }
    }
  }
  // A soft mottling of the whole field (the light through thinner and thicker foliage behind the leaves).
  const out = new Float64Array(SIZE * SIZE);
  for (let py = 0; py < SIZE; py++) {
    for (let px = 0; px < SIZE; px++) {
      const x = centre(px);
      const y = -centre(py);
      const m = 1 - mottle * smoothstep(0.45, 0.8, fbm(x * 2.2 + 3, y * 2.2, seed + 41, 4));
      out[py * SIZE + px] = t[py * SIZE + px] * m;
    }
  }
  return out;
}

function dappledImage(seed, { scales, fill, soft, warp }) {
  return paint((x, y) => {
    // Warp the sampling point a little so that the patches are not round, then take the union of soft discs, one
    // jittered disc per grid cell at a few scales: the big, medium and small gaps of a canopy.
    const wx = (fbm(x * 2.1 + 7, y * 2.1, seed + 5, 3) - 0.5) * warp;
    const wy = (fbm(x * 2.1, y * 2.1 + 3, seed + 9, 3) - 0.5) * warp;
    const px = x + wx;
    const py = y + wy;
    let dark = 1;
    scales.forEach((cells, level) => {
      const gx = px * cells;
      const gy = py * cells;
      const ix = Math.floor(gx);
      const iy = Math.floor(gy);
      for (let j = -1; j <= 1; j++) {
        for (let i = -1; i <= 1; i++) {
          const cx = ix + i;
          const cy = iy + j;
          const h = hash2(cx, cy, seed + 131 * level);
          if (h > fill) continue;
          const jx = cx + 0.15 + 0.7 * hash2(cx, cy, seed + 131 * level + 1);
          const jy = cy + 0.15 + 0.7 * hash2(cx, cy, seed + 131 * level + 2);
          const radius = 0.3 + 0.2 * hash2(cx, cy, seed + 131 * level + 3);
          const d = Math.sqrt((gx - jx) * (gx - jx) + (gy - jy) * (gy - jy));
          const strength = 0.75 + 0.25 * hash2(cx, cy, seed + 131 * level + 4);
          dark *= 1 - strength * (1 - smoothstep(radius * (1 - soft), radius, d));
        }
      }
    });
    return clamp01(1 - dark);
  });
}

function dotsImage({ columns, radius }) {
  const pitch = 2 / columns;
  return paint((x, y) => {
    const lx = x - (Math.floor((x + 1) / pitch) + 0.5) * pitch + 1;
    const ly = y - (Math.floor((y + 1) / pitch) + 0.5) * pitch + 1;
    return coverage(Math.sqrt(lx * lx + ly * ly) - radius * pitch, PX);
  });
}

function linesImage({ count, halfWidth }) {
  const period = 2 / count;
  return paint((x) => {
    const f = (x + 1) / period - 0.5;
    return coverage(Math.abs(f - Math.round(f)) * period - halfWidth * period, PX);
  });
}

function radialImage({ rays, soft, hub }) {
  return paint((x, y) => {
    const r = Math.sqrt(x * x + y * y);
    if (r < 1e-9) return 0;
    // sin(rays * theta) by multiplying the unit vector with itself: no atan2, no sin.
    const ux = x / r;
    const uy = y / r;
    let wr = 1;
    let wi = 0;
    for (let k = 0; k < rays; k++) {
      const nr = wr * ux - wi * uy;
      wi = wr * uy + wi * ux;
      wr = nr;
    }
    return smoothstep(-soft, soft, wi) * smoothstep(hub * 0.6, hub, r) * coverage(r - 1, PX);
  });
}

function breakupImage(seed, { scale, octaves, low, high }) {
  return paint((x, y) => smoothstep(low, high, fbm(x * scale + 2, y * scale + 5, seed, octaves)));
}

/** The float image (0..1) of one gobo. */
export function renderFloat(recipe, seed) {
  switch (recipe.kind) {
    case 'window':
      return windowImage(recipe);
    case 'archedWindow':
      return archedWindowImage(recipe);
    case 'blinds':
      return blindsImage(recipe);
    case 'leaves':
      return leavesImage(seed, recipe);
    case 'dappled':
      return dappledImage(seed, recipe);
    case 'dots':
      return dotsImage(recipe);
    case 'lines':
      return linesImage(recipe);
    case 'radial':
      return radialImage(recipe);
    case 'breakup':
      return breakupImage(seed, recipe);
    default:
      throw new Error(`unknown gobo kind ${recipe.kind}`);
  }
}

/** The 8-bit grey pixels of one gobo (row-major, top row first). */
export function renderGobo(recipe, seed) {
  const f = renderFloat(recipe, seed);
  const out = new Uint8Array(SIZE * SIZE);
  for (let i = 0; i < out.length; i++) out[i] = toByte(f[i]);
  return out;
}

/** Renders everything in memory: `{ index, files }`, `files` mapping a file name to its PNG bytes. Pure. */
export function buildAll(only) {
  const files = {};
  const gobos = [];
  for (const entry of recipes()) {
    if (only && !only.includes(entry.id)) continue;
    const pixels = renderGobo(entry.recipe, entry.seed);
    const png = encodePng(pixels, SIZE, SIZE);
    files[entry.file] = png;
    gobos.push({ ...entry, size: SIZE, bytes: png.length, sha256: sha256(png), pixelsSha256: sha256(pixels) });
  }
  const index = {
    generator: `tools/assets/${GENERATOR.name}.mjs`,
    version: GENERATOR.version,
    size: SIZE,
    bitDepth: 8,
    convention: 'Covers [-1, 1]^2, v up; grey = light that passes (255 open). sha256 is of the PNG file; pixelsSha256 of the raw 8-bit pixels (canonical).',
    gobos,
  };
  return { index, files };
}

const DEFAULT_OUT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'public', 'assets', 'gobo');

function main(argv) {
  const check = argv.includes('--check');
  const outArg = argv.indexOf('--out');
  const out = outArg >= 0 ? argv[outArg + 1] : DEFAULT_OUT;
  const { index, files } = buildAll();
  if (check) {
    const onDisk = JSON.parse(readFileSync(join(out, 'index.json'), 'utf8'));
    let bad = 0;
    for (const g of index.gobos) {
      const disk = onDisk.gobos.find((x) => x.id === g.id);
      if (!disk || disk.pixelsSha256 !== g.pixelsSha256) {
        console.error(`DIFFERENT ${g.id}`);
        bad++;
      }
    }
    console.log(bad === 0 ? `ok: ${index.gobos.length} gobos reproduce their pixel hashes` : `${bad} gobos differ`);
    process.exitCode = bad === 0 ? 0 : 1;
    return;
  }
  mkdirSync(out, { recursive: true });
  for (const [name, bytes] of Object.entries(files)) writeFileSync(join(out, name), bytes);
  writeFileSync(join(out, 'index.json'), JSON.stringify(index, null, 2) + '\n');
  const total = index.gobos.reduce((n, g) => n + g.bytes, 0);
  console.log(`wrote ${index.gobos.length} gobos to ${out} (${(total / 1024).toFixed(0)} KiB)`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main(process.argv.slice(2));

