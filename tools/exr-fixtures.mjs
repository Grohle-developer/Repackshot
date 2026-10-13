// Writes the OpenEXR test fixtures of phase E5 (tests/fixtures/exr-*.exr): a 40 x 37 pattern,
// exact in half floats, as scanline files with ZIP (16 lines per chunk, half), ZIPS (one line
// per chunk, float, plus an alpha channel the readers skip) and RLE (half) compression. The
// layout follows the public OpenEXR file layout (openexr.com); compression uses Node's zlib.
// The engine's reader (engine/crates/rt-core/src/exr.rs) and the interface's (src/io/hdri.ts)
// decode them in their tests, and three.js's EXRLoader, an independent reader, checks them too.
//
//   node tools/exr-fixtures.mjs

import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const W = 40;
const H = 37;

/** The pattern: rt-core's tests and tests/hdri.test.ts expect exactly this. */
export function pattern(x, y) {
  return [((x * 3 + y) % 64) / 16, (y % 32) / 32, ((x ^ y) % 16) / 8];
}

function toHalf(v) {
  const f = new Float32Array([v]);
  const b = new Uint32Array(f.buffer)[0];
  const sign = (b >>> 16) & 0x8000;
  const exp = ((b >>> 23) & 0xff) - 127 + 15;
  const man = b & 0x7fffff;
  if (v === 0) return sign;
  if (exp <= 0 || exp >= 31 || man & 0x1fff) throw new Error(`${v} is not exact in half`);
  return sign | (exp << 10) | (man >>> 13);
}

const bytes = (...parts) => Buffer.concat(parts.map((p) => (Buffer.isBuffer(p) ? p : Buffer.from(p))));
const u32 = (v) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(v >>> 0);
  return b;
};
const i32 = (v) => {
  const b = Buffer.alloc(4);
  b.writeInt32LE(v);
  return b;
};
const u64 = (v) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(v));
  return b;
};
const f32 = (v) => {
  const b = Buffer.alloc(4);
  b.writeFloatLE(v);
  return b;
};
const cstr = (s) => Buffer.from(`${s}\0`, 'latin1');
const attribute = (name, type, value) => bytes(cstr(name), cstr(type), u32(value.length), value);

/** OpenEXR's reorder (interleave) and predictor, as its ZIP and RLE compressors apply them. */
function predict(raw) {
  const t = Buffer.alloc(raw.length);
  let a = 0;
  let b = (raw.length + 1) >> 1;
  for (let i = 0; i < raw.length; i++) {
    if (i % 2 === 0) t[a++] = raw[i];
    else t[b++] = raw[i];
  }
  let p = t[0];
  for (let i = 1; i < t.length; i++) {
    const d = (t[i] - p + 128 + 256) & 0xff;
    p = t[i];
    t[i] = d;
  }
  return t;
}

/** OpenEXR's run-length code: a count byte, negative for literals. */
function rle(data) {
  const out = [];
  let start = 0;
  while (start < data.length) {
    let end = start + 1;
    while (end < data.length && data[end] === data[start] && end - start < 128) end++;
    if (end - start >= 3) {
      out.push(end - start - 1, data[start]);
      start = end;
      continue;
    }
    end = start;
    while (end < data.length && end - start < 127) {
      if (end + 2 < data.length && data[end] === data[end + 1] && data[end] === data[end + 2]) break;
      end++;
    }
    out.push((256 - (end - start)) & 0xff);
    for (let k = start; k < end; k++) out.push(data[k]);
    start = end;
  }
  return Buffer.from(out);
}

function exr({ compression, lines, half, alpha }) {
  const names = alpha ? ['A', 'B', 'G', 'R'] : ['B', 'G', 'R'];
  const type = half ? 1 : 2;
  const chlist = bytes(...names.map((n) => bytes(cstr(n), i32(type), [0, 0, 0, 0], i32(1), i32(1))), [0]);
  const window = bytes(i32(0), i32(0), i32(W - 1), i32(H - 1));
  const header = bytes(
    attribute('channels', 'chlist', chlist),
    attribute('compression', 'compression', Buffer.from([compression])),
    attribute('dataWindow', 'box2i', window),
    attribute('displayWindow', 'box2i', window),
    attribute('lineOrder', 'lineOrder', Buffer.from([0])),
    attribute('pixelAspectRatio', 'float', f32(1)),
    attribute('screenWindowCenter', 'v2f', Buffer.alloc(8)),
    attribute('screenWindowWidth', 'float', f32(1)),
    [0],
  );
  const sample = (x, y, name) => (name === 'A' ? 1 : pattern(x, y)[{ R: 0, G: 1, B: 2 }[name]]);
  const chunks = [];
  for (let y0 = 0; y0 < H; y0 += lines) {
    const parts = [];
    for (let y = y0; y < Math.min(H, y0 + lines); y++) {
      for (const n of names) for (let x = 0; x < W; x++) parts.push(half ? Buffer.from(new Uint16Array([toHalf(sample(x, y, n))]).buffer) : f32(sample(x, y, n)));
    }
    const raw = bytes(...parts);
    const packed = compression === 1 ? rle(predict(raw)) : deflateSync(predict(raw), { level: 9 });
    const data = packed.length < raw.length ? packed : raw;
    chunks.push(bytes(i32(y0), u32(data.length), data));
  }
  const start = 8 + header.length + 8 * chunks.length;
  const table = [];
  let at = start;
  for (const c of chunks) {
    table.push(u64(at));
    at += c.length;
  }
  return bytes([0x76, 0x2f, 0x31, 0x01], u32(2), header, ...table, ...chunks);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = new URL('../tests/fixtures/', import.meta.url);
  writeFileSync(new URL('exr-zip-half.exr', dir), exr({ compression: 3, lines: 16, half: true, alpha: false }));
  writeFileSync(new URL('exr-zips-float.exr', dir), exr({ compression: 2, lines: 1, half: false, alpha: true }));
  writeFileSync(new URL('exr-rle-half.exr', dir), exr({ compression: 1, lines: 1, half: true, alpha: false }));
  console.log('wrote tests/fixtures/exr-{zip-half,zips-float,rle-half}.exr');
}
