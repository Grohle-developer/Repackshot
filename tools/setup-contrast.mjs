#!/usr/bin/env node
// Image check of the light power (not part of `npm run qa`): do the light setups change the picture?
//
//   node tools/setup-contrast.mjs [--out out/setup-contrast] [--preset JEWELLERY]
//        [--setups REMBRANDT,NEON_NOIR,KEY_ONLY] [--size 480x270] [--samples 64] [--label after]
//        [--dome-scale 1]
//
// 1. builds the native engine if `engine/target/release/rt` is missing;
// 2. writes one RSB per setup through tests/setup-rsb-dump.test.ts (skipped by `npm test` unless
//    REPACKSHOT_SETUP_RSB_DIR is set, which this tool does);
// 3. renders each with `rt <file> -o <png> --samples N`;
// 4. reports, for the first setup against every other one, the share of pixels whose RGB differs by
//    more than 12/255 in any channel, plus the mean RGB of each image (8 bits). The part fills
//    only a small part of the frame, so the same two numbers are also given over the part alone
//    (the pixels that differ from the background, the top-left pixel, by more than 4/255 in
//    either image). Writes <out>/setup-contrast.json (<out>/setup-contrast-<label>.json with
//    --label).
//
// Before/after of a photometry change: run it once on each side with a different --label.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const OUT = resolve(ROOT, opt('out', 'out/setup-contrast'));
const PRESET = opt('preset', 'JEWELLERY');
const SETUPS = opt('setups', 'REMBRANDT,NEON_NOIR,KEY_ONLY').split(',').map((s) => s.trim()).filter(Boolean);
const SIZE = opt('size', '480x270');
const SAMPLES = Number(opt('samples', '64'));
const LABEL = opt('label', '');
const DOME_SCALE = opt('dome-scale', '1');
const THRESHOLD = 12;
const RT = join(ROOT, 'engine', 'target', 'release', 'rt');

function run(cmd, cmdArgs, env = {}, cwd = ROOT) {
  const r = spawnSync(cmd, cmdArgs, { cwd, stdio: 'inherit', env: { ...process.env, ...env } });
  if (r.error) throw r.error;
  if (r.status !== 0) {
    console.error(`${cmd} ${cmdArgs.join(' ')} exited with ${r.status}`);
    process.exit(r.status ?? 1);
  }
}

/** Decodes the 8-bit RGB / RGBA PNGs `rt` writes (filter 0 only, which is all its encoder emits). */
function decodePng(buf) {
  let width = 0;
  let height = 0;
  let channels = 0;
  const idat = [];
  for (let o = 8; o < buf.length; ) {
    const len = buf.readUInt32BE(o);
    const type = buf.toString('latin1', o + 4, o + 8);
    const data = buf.subarray(o + 8, o + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (data[8] !== 8 || (data[9] !== 2 && data[9] !== 6)) throw new Error('only 8-bit RGB or RGBA PNGs');
      channels = data[9] === 6 ? 4 : 3;
    } else if (type === 'IDAT') idat.push(data);
    o += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const px = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    const row = y * (width * channels + 1);
    if (raw[row] !== 0) throw new Error(`PNG filter ${raw[row]} not supported`);
    for (let x = 0; x < width; x++) {
      for (let c = 0; c < 3; c++) px[(y * width + x) * 3 + c] = raw[row + 1 + x * channels + c];
    }
  }
  return { width, height, px };
}

const PART_THRESHOLD = 4;

/** True for the pixels of `a` that differ from its background (top-left pixel) by more than PART_THRESHOLD. */
function partMask(a) {
  const n = a.px.length / 3;
  const mask = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 3; c++) if (Math.abs(a.px[i * 3 + c] - a.px[c]) > PART_THRESHOLD) mask[i] = 1;
  }
  return mask;
}

/** Mean RGB over the pixels of `mask` (all of them when it is null), and how many there are. */
function meanRgb({ px }, mask = null) {
  const sum = [0, 0, 0];
  let n = 0;
  for (let i = 0; i < px.length / 3; i++) {
    if (mask && !mask[i]) continue;
    n++;
    for (let c = 0; c < 3; c++) sum[c] += px[i * 3 + c];
  }
  return sum.map((v) => v / Math.max(1, n));
}

/** Share of the pixels of `mask` (all of them when null) whose RGB differs by more than THRESHOLD in any channel. */
function share(a, b, mask = null) {
  if (a.width !== b.width || a.height !== b.height) throw new Error('image sizes differ');
  let n = 0;
  let total = 0;
  for (let i = 0; i < a.px.length / 3; i++) {
    if (mask && !mask[i]) continue;
    total++;
    for (let c = 0; c < 3; c++) {
      if (Math.abs(a.px[i * 3 + c] - b.px[i * 3 + c]) > THRESHOLD) {
        n++;
        break;
      }
    }
  }
  return n / Math.max(1, total);
}

/** Pixels that are in the part of either image. */
function unionMask(a, b) {
  const ma = partMask(a);
  const mb = partMask(b);
  return ma.map((v, i) => v | mb[i]);
}

mkdirSync(OUT, { recursive: true });
if (!existsSync(RT)) run('cargo', ['build', '--release', '-p', 'rt-cli'], {}, join(ROOT, 'engine'));

run('npx', ['vitest', 'run', 'tests/setup-rsb-dump.test.ts'], {
  REPACKSHOT_SETUP_RSB_DIR: OUT,
  REPACKSHOT_SETUP_PRESET: PRESET,
  REPACKSHOT_SETUP_KEYS: SETUPS.join(','),
  REPACKSHOT_SETUP_SIZE: SIZE,
  REPACKSHOT_SETUP_SPP: String(SAMPLES),
  REPACKSHOT_SETUP_DOME_SCALE: DOME_SCALE,
});

const images = {};
for (const key of SETUPS) {
  const base = `${PRESET}-${key}${LABEL ? `-${LABEL}` : ''}`;
  const rsb = join(OUT, `${PRESET}-${key}.rsb`);
  const png = join(OUT, `${base}.png`);
  run(RT, [rsb, '-o', png, '--samples', String(SAMPLES)]);
  images[key] = decodePng(readFileSync(png));
}

const result = { preset: PRESET, size: SIZE, samples: SAMPLES, domeScale: Number(DOME_SCALE), threshold: THRESHOLD, mean: {}, partMean: {}, differsFrom: {}, partDiffersFrom: {}, partPixels: {} };
const first = SETUPS[0];
const fmt = (v) => Number(v.toFixed(2));
for (const key of SETUPS) result.mean[key] = meanRgb(images[key]).map(fmt);
for (const key of SETUPS) {
  const mask = unionMask(images[first], images[key]);
  result.partMean[key] = meanRgb(images[key], mask).map(fmt);
}
for (const key of SETUPS.slice(1)) {
  const pair = `${first} vs ${key}`;
  const mask = unionMask(images[first], images[key]);
  result.differsFrom[pair] = fmt(share(images[first], images[key]) * 100);
  result.partDiffersFrom[pair] = fmt(share(images[first], images[key], mask) * 100);
  result.partPixels[pair] = mask.reduce((n, v) => n + v, 0);
}

console.log(`\n${PRESET} at ${SIZE}, ${SAMPLES} spp, dome x${DOME_SCALE}${LABEL ? ` (${LABEL})` : ''}`);
for (const key of SETUPS) console.log(`  mean RGB, whole frame, ${key.padEnd(10)} ${result.mean[key].map((v) => v.toFixed(1)).join('  ')}`);
for (const key of SETUPS) console.log(`  mean RGB, part only,   ${key.padEnd(10)} ${result.partMean[key].map((v) => v.toFixed(1)).join('  ')}   (part pixels as seen against ${first})`);
for (const pair of Object.keys(result.differsFrom)) {
  console.log(`  pixels differing by more than ${THRESHOLD}/255, ${pair}: ${result.differsFrom[pair].toFixed(2)} % of the frame, ${result.partDiffersFrom[pair].toFixed(2)} % of the part (${result.partPixels[pair]} px)`);
}
writeFileSync(join(OUT, LABEL ? `setup-contrast-${LABEL}.json` : 'setup-contrast.json'), JSON.stringify(result, null, 2));
