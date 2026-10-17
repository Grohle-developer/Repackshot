#!/usr/bin/env node
// The before/after sheet of focus with a click (phase F1): the final frames the measurement rendered
// (tests/focus-measure.test.ts, the native `rt`, linear float TIFF) for a click before F1 and after it, side by side,
// with a ring round the clicked pixel. Before: the sharp band of the slanted checker runs away from the ring; after:
// through it.
//
//   REPACK_FOCUS_MEASURE=1 REPACK_FOCUS_TAG=after npx vitest run tests/focus-measure.test.ts   # (and the before run)
//   node tools/focus-sheet.mjs out/docs-f1-sheet.png <before.tif> <after.tif> <x> <y> [<before.tif> <after.tif> <x> <y> ...]
//
// Each row is one click (x, y in the frame's pixels). Writes an 8-bit sRGB PNG.

import { readFileSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const [out, ...rest] = process.argv.slice(2);
if (!out || rest.length === 0 || rest.length % 4 !== 0) {
  console.error('usage: node tools/focus-sheet.mjs <out.png> (<before.tif> <after.tif> <x> <y>)+');
  process.exit(2);
}

/** The linear RGB of an uncompressed little-endian float TIFF (`rt --format tiff --bits 32`). */
function readTiff(path) {
  const b = readFileSync(path);
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const ifd = v.getUint32(4, true);
  const n = v.getUint16(ifd, true);
  const tags = new Map();
  for (let i = 0; i < n; i++) {
    const e = ifd + 2 + i * 12;
    const type = v.getUint16(e + 2, true);
    const count = v.getUint32(e + 4, true);
    const size = type === 3 ? 2 : 4;
    const at = count * size <= 4 ? e + 8 : v.getUint32(e + 8, true);
    const vals = [];
    for (let k = 0; k < count; k++) vals.push(type === 3 ? v.getUint16(at + k * 2, true) : v.getUint32(at + k * 4, true));
    tags.set(v.getUint16(e, true), vals);
  }
  const width = tags.get(256)[0];
  const height = tags.get(257)[0];
  const rgb = new Float32Array(width * height * 3);
  let o = 0;
  tags.get(273).forEach((off, s) => {
    for (let k = 0; k < tags.get(279)[s]; k += 4) rgb[o++] = v.getFloat32(off + k, true);
  });
  return { width, height, rgb };
}

const srgb = (x) => {
  const c = Math.min(1, Math.max(0, x));
  return Math.round((c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055) * 255);
};

const rows = [];
for (let i = 0; i < rest.length; i += 4) rows.push({ before: readTiff(rest[i]), after: readTiff(rest[i + 1]), x: Number(rest[i + 2]), y: Number(rest[i + 3]) });
const gap = 8;
const w = rows[0].before.width;
const h = rows[0].before.height;
const W = 2 * w + gap;
const H = rows.length * h + (rows.length - 1) * gap;
const px = new Uint8Array(W * H * 3).fill(128);
const put = (x, y, v) => {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  px.set(v, (y * W + x) * 3);
};
rows.forEach((r, j) => {
  [r.before, r.after].forEach((img, i) => {
    const ox = i * (w + gap);
    const oy = j * (h + gap);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const k = (y * w + x) * 3;
        put(ox + x, oy + y, [srgb(img.rgb[k]), srgb(img.rgb[k + 1]), srgb(img.rgb[k + 2])]);
      }
    }
    // A ring round the clicked pixel: black, then white inside it.
    for (const [rad, ink] of [[7.5, [0, 0, 0]], [6.5, [255, 255, 255]], [5.5, [0, 0, 0]]]) {
      for (let a = 0; a < 360; a += 2) {
        const t = (a * Math.PI) / 180;
        put(Math.round(ox + r.x + rad * Math.cos(t)), Math.round(oy + r.y + rad * Math.sin(t)), ink);
      }
    }
  });
});

// PNG: RGB, filter 0 on every row.
const raw = Buffer.alloc((W * 3 + 1) * H);
for (let y = 0; y < H; y++) {
  raw[y * (W * 3 + 1)] = 0;
  Buffer.from(px.buffer, y * W * 3, W * 3).copy(raw, y * (W * 3 + 1) + 1);
}
const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8;
ihdr[9] = 2;
writeFileSync(out, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
console.log(`${out}: ${W} × ${H}`);
