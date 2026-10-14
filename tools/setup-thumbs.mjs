#!/usr/bin/env node
// The light-setup thumbnails (L6): every setup of the catalogue, the 16 sets and the 72 before them, rendered by our
// own engine on the object it is meant for (`LightSetup.hero`; the setups before L6 on the hero of their style:
// tests/set-heroes.ts), the scene built with the application's own code (the rig, the set's decoration, core/rig.ts →
// io/rsb.ts, in Node through vitest), rendered with the native `rt` at 256 × 256, 96 samples, denoised, seed 1.
//
//   node tools/setup-thumbs.mjs [--keys STRIP_EDGE,REMBRANDT]
//
// Writes public/thumbs/setups/thumb_<key>.png (the PNG `rt` writes, as it is) and setup_<key>.png (64 × 64, the box
// average of it), and public/thumbs/setups/manifest.json: per setup the sha-256 of its RSB and of its thumb_ PNG
// (tests/sets.test.ts checks that the code still builds the same scenes and that the PNGs are those). Deterministic:
// the same code and the same engine give the same bytes, with any number of threads.
//
// `rt`: REPACK_RT, else engine/target/release/rt, else /home/user/bin/rt.

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync, inflateSync } from 'node:zlib';
import { dumpScenes, findRt, render } from './rt-batch.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const KEYS = opt('keys', '');
const WORK = join(ROOT, 'out', 'setup-thumbs');
const PUBLIC = join(ROOT, 'public', 'thumbs', 'setups');
const MANIFEST = join(PUBLIC, 'manifest.json');
const SMALL = 64;

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** Decodes an 8-bit RGB or RGBA PNG (any filter) to RGBA. */
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
  const stride = width * channels;
  const out = Buffer.alloc(width * height * 4);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? line[x - channels] : 0;
      const b = prev[x];
      const c = x >= channels ? prev[x - channels] : 0;
      const p = a + b - c;
      const pr = Math.abs(p - a) <= Math.abs(p - b) && Math.abs(p - a) <= Math.abs(p - c) ? a : Math.abs(p - b) <= Math.abs(p - c) ? b : c;
      line[x] = (line[x] + [0, a, b, (a + b) >> 1, pr][f]) & 255;
    }
    for (let x = 0; x < width; x++) {
      for (let k = 0; k < 3; k++) out[(y * width + x) * 4 + k] = line[x * channels + k];
      out[(y * width + x) * 4 + 3] = channels === 4 ? line[x * 4 + 3] : 255;
    }
    prev = line;
  }
  return { width, height, rgba: out };
}

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}
/** An 8-bit RGBA PNG, filter 0, zlib level 9: the same pixels give the same bytes. */
function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

/** The box average of an image down to `size` × `size` (its sides a multiple of it). */
function shrink(img, size) {
  const k = img.width / size;
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++)
      for (let c = 0; c < 4; c++) {
        let sum = 0;
        for (let j = 0; j < k; j++) for (let i = 0; i < k; i++) sum += img.rgba[((y * k + j) * img.width + (x * k + i)) * 4 + c];
        out[(y * size + x) * 4 + c] = Math.round(sum / (k * k));
      }
  return out;
}

const rt = findRt(ROOT);
mkdirSync(WORK, { recursive: true });
mkdirSync(PUBLIC, { recursive: true });
const plan = dumpScenes(ROOT, WORK, 'THUMBS', KEYS ? { REPACKSHOT_THUMBS_KEYS: KEYS } : {});
const manifest = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, 'utf8')) : { scenes: {} };
let total = 0;
for (const s of plan.scenes) {
  const key = s.setup.toLowerCase();
  const png = join(WORK, `${key}.png`);
  const seconds = render(rt, join(WORK, s.file), png);
  total += seconds;
  const bytes = readFileSync(png);
  writeFileSync(join(PUBLIC, `thumb_${key}.png`), bytes);
  const img = decodePng(bytes);
  writeFileSync(join(PUBLIC, `setup_${key}.png`), encodePng(SMALL, SMALL, shrink(img, SMALL)));
  manifest.scenes[s.setup] = { hero: s.hero, rsb: s.sha256, png: sha(bytes) };
  console.log(`${s.setup.padEnd(18)} ${s.hero.padEnd(8)} ${seconds.toFixed(1)} s`);
}
const sorted = Object.fromEntries(Object.keys(manifest.scenes).sort().map((k) => [k, manifest.scenes[k]]));
writeFileSync(MANIFEST, JSON.stringify({ size: `${plan.width}x${plan.height}`, spp: plan.spp, seed: plan.seed, denoise: true, scenes: sorted }, null, 1) + '\n');
console.log(`${plan.scenes.length} thumbnails in ${total.toFixed(0)} s of rendering; wrote ${MANIFEST}`);
