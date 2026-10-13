// Image output: encodes a rendered image as PNG (8 or 16 bits), JPEG or EXR.
//
// The path tracer hands over its tone-mapped 8-bit pixels (`encodePixels`):
// PNG is written here, byte for byte what the engine produced (a canvas would
// premultiply the alpha and round the colour of every translucent pixel),
// RGB when the image is opaque and RGBA otherwise. JPEG goes through a canvas.
// A 16-bit PNG and an EXR come from the engine's float sums (render/tiles.ts
// converts them; this file only writes bytes).
//
// The DPI of the render window is written into the file so a print shop
// reads the right print size: the PNG `pHYs` chunk (pixels per metre, unit 1)
// and the JPEG JFIF header (units 1: dots per inch). EXR has no standard
// density attribute.

import { pixelsPerMetre } from '../core/print-size';

export type ImageFormat = 'PNG' | 'JPEG';

/** What every encoder may write besides the pixels. */
export interface EncodeOptions {
  /** Dots per inch, written as the file's density. */
  dpi?: number;
}

/** 8-bit pixels, straight (not premultiplied) RGBA, row major from the top. */
export interface Pixels {
  width: number;
  height: number;
  data: Uint8ClampedArray | Uint8Array;
}

export async function encodeImage(bitmap: ImageBitmap, format: ImageFormat, quality = 0.92): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d')!;
  if (format === 'JPEG') {
    // JPEG has no alpha: compose over white, like a print.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.drawImage(bitmap, 0, 0);
  const type = format === 'JPEG' ? 'image/jpeg' : 'image/png';
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode'))), type, quality));
}

/** Encodes pixels: PNG exactly, JPEG over white through a canvas; both with the DPI written in. */
export async function encodePixels(px: Pixels, format: ImageFormat, quality = 0.92, opts: EncodeOptions = {}): Promise<Blob> {
  if (format === 'PNG') return new Blob([(await encodePng(px, opts)) as Uint8Array<ArrayBuffer>], { type: 'image/png' });
  const canvas = document.createElement('canvas');
  canvas.width = px.width;
  canvas.height = px.height;
  const ctx = canvas.getContext('2d')!;
  const rgba = new Uint8ClampedArray(px.data.length);
  // Over white, by hand (the alpha of JPEG pixels is dropped by the encoder otherwise).
  for (let i = 0; i < rgba.length; i += 4) {
    const a = px.data[i + 3] / 255;
    for (let c = 0; c < 3; c++) rgba[i + c] = Math.round(px.data[i + c] * a + 255 * (1 - a));
    rgba[i + 3] = 255;
  }
  ctx.putImageData(new ImageData(rgba, px.width, px.height), 0, 0);
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode'))), 'image/jpeg', quality));
  if (opts.dpi === undefined) return blob;
  const bytes = setJpegDpi(new Uint8Array(await blob.arrayBuffer()), opts.dpi);
  return new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'image/jpeg' });
}

// ------------------------------------------------------------------ PNG

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** CRC-32 of the PNG specification (ISO 3309). */
export function crc32(bytes: Uint8Array, start = 0, end = bytes.length): number {
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Adler-32 of RFC 1950 (the zlib checksum). */
export function adler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (let i = 0; i < bytes.length; ) {
    const end = Math.min(bytes.length, i + 5552);
    for (; i < end; i++) {
      a += bytes[i];
      b += a;
    }
    a %= 65521;
    b %= 65521;
  }
  return ((b << 16) | a) >>> 0;
}

/** zlib stream of stored (uncompressed) deflate blocks: always available, never smaller. */
export function zlibStored(data: Uint8Array): Uint8Array {
  const blocks = Math.max(1, Math.ceil(data.length / 65535));
  const out = new Uint8Array(2 + data.length + blocks * 5 + 4);
  out[0] = 0x78;
  out[1] = 0x01;
  let o = 2;
  for (let b = 0; b < blocks; b++) {
    const start = b * 65535;
    const len = Math.min(65535, data.length - start);
    out[o++] = b === blocks - 1 ? 1 : 0;
    out[o++] = len & 0xff;
    out[o++] = len >>> 8;
    out[o++] = ~len & 0xff;
    out[o++] = (~len >>> 8) & 0xff;
    out.set(data.subarray(start, start + len), o);
    o += len;
  }
  new DataView(out.buffer).setUint32(o, adler32(data));
  return out;
}

/** zlib (RFC 1950) of `data`: the browser's deflate when it has one, stored blocks otherwise. */
export async function zlib(data: Uint8Array): Promise<Uint8Array> {
  if (typeof CompressionStream === 'function') {
    try {
      const stream = new Blob([data as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new CompressionStream('deflate'));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    } catch {
      // Fall through to stored blocks.
    }
  }
  return zlibStored(data);
}

/** 16-bit pixels, straight RGBA words, row major from the top. */
export interface Pixels16 {
  width: number;
  height: number;
  data: Uint16Array;
}

/** The `pHYs` chunk's data: the same density across and down, in pixels per metre (unit 1). */
export function physData(dpi: number): Uint8Array {
  const d = new Uint8Array(9);
  const v = new DataView(d.buffer);
  const ppm = pixelsPerMetre(dpi);
  v.setUint32(0, ppm);
  v.setUint32(4, ppm);
  d[8] = 1;
  return d;
}

/** A PNG file from its chunks (IHDR first, IEND added), each with its length and CRC. */
function pngFile(chunks: [string, Uint8Array][]): Uint8Array {
  const all: [string, Uint8Array][] = [...chunks, ['IEND', new Uint8Array(0)]];
  const size = 8 + all.reduce((n, [, d]) => n + 12 + d.length, 0);
  const out = new Uint8Array(size);
  out.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const dv = new DataView(out.buffer);
  let o = 8;
  for (const [type, d] of all) {
    dv.setUint32(o, d.length);
    for (let i = 0; i < 4; i++) out[o + 4 + i] = type.charCodeAt(i);
    out.set(d, o + 8);
    dv.setUint32(o + 8 + d.length, crc32(out, o + 4, o + 8 + d.length));
    o += 12 + d.length;
  }
  return out;
}

function ihdr(width: number, height: number, depth: 8 | 16, opaque: boolean): Uint8Array {
  const d = new Uint8Array(13);
  const v = new DataView(d.buffer);
  v.setUint32(0, width);
  v.setUint32(4, height);
  d[8] = depth;
  d[9] = opaque ? 2 : 6; // colour type: RGB or RGBA
  return d;
}

/** A PNG of 8-bit pixels: RGB when every alpha is 255, RGBA otherwise; filter 0 on every row; `pHYs` with the DPI. */
export async function encodePng(px: Pixels, opts: EncodeOptions = {}): Promise<Uint8Array> {
  const { width, height, data } = px;
  let opaque = true;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] !== 255) {
      opaque = false;
      break;
    }
  }
  const channels = opaque ? 3 : 4;
  const row = width * channels;
  const raw = new Uint8Array((row + 1) * height);
  for (let y = 0; y < height; y++) {
    let o = y * (row + 1);
    raw[o++] = 0;
    if (opaque) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        raw[o++] = data[i];
        raw[o++] = data[i + 1];
        raw[o++] = data[i + 2];
      }
    } else raw.set(data.subarray(y * width * 4, (y + 1) * width * 4), o);
  }
  const chunks: [string, Uint8Array][] = [['IHDR', ihdr(width, height, 8, opaque)]];
  if (opts.dpi !== undefined) chunks.push(['pHYs', physData(opts.dpi)]);
  chunks.push(['IDAT', await zlib(raw)]);
  return pngFile(chunks);
}

/** A PNG of 16-bit pixels (bit depth 16, samples big-endian): RGB when opaque, RGBA otherwise; `pHYs` with the DPI. */
export async function encodePng16(px: Pixels16, opts: EncodeOptions = {}): Promise<Uint8Array> {
  const { width, height, data } = px;
  let opaque = true;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] !== 65535) {
      opaque = false;
      break;
    }
  }
  const channels = opaque ? 3 : 4;
  const row = width * channels * 2;
  const raw = new Uint8Array((row + 1) * height);
  for (let y = 0; y < height; y++) {
    let o = y * (row + 1);
    raw[o++] = 0;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      for (let c = 0; c < channels; c++) {
        const w = data[i + c];
        raw[o++] = w >>> 8;
        raw[o++] = w & 0xff;
      }
    }
  }
  const chunks: [string, Uint8Array][] = [['IHDR', ihdr(width, height, 16, opaque)]];
  if (opts.dpi !== undefined) chunks.push(['pHYs', physData(opts.dpi)]);
  chunks.push(['IDAT', await zlib(raw)]);
  return pngFile(chunks);
}

// ------------------------------------------------------------------ JPEG density

const JFIF_ID = [0x4a, 0x46, 0x49, 0x46, 0x00];

/**
 * A JPEG with its JFIF density set to `dpi` dots per inch (units 1): the APP0 JFIF segment right
 * after SOI is patched in place, or inserted when the file has none. Everything else is copied.
 */
export function setJpegDpi(jpeg: Uint8Array, dpi: number): Uint8Array {
  if (jpeg.length < 4 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) throw new Error('not a JPEG');
  const density = Math.max(1, Math.min(65535, Math.round(dpi)));
  const hasJfif = jpeg[2] === 0xff && jpeg[3] === 0xe0 && jpeg.length >= 18 && JFIF_ID.every((b, i) => jpeg[6 + i] === b);
  let out: Uint8Array;
  if (hasJfif) out = jpeg.slice();
  else {
    // SOI, then APP0: length 16, "JFIF\0", version 1.01, units, densities, no thumbnail.
    const app0 = [0xff, 0xe0, 0x00, 0x10, ...JFIF_ID, 0x01, 0x01, 0, 0, 0, 0, 0, 0, 0];
    out = new Uint8Array(jpeg.length + app0.length);
    out.set(jpeg.subarray(0, 2), 0);
    out.set(app0, 2);
    out.set(jpeg.subarray(2), 2 + app0.length);
  }
  out[13] = 1; // units: dots per inch
  out[14] = density >>> 8;
  out[15] = density & 0xff;
  out[16] = density >>> 8;
  out[17] = density & 0xff;
  return out;
}

/** The density a JPEG's JFIF header declares, or null (no JFIF, or units that are not per inch / cm). */
export function jpegDpi(jpeg: Uint8Array): number | null {
  if (!(jpeg[2] === 0xff && jpeg[3] === 0xe0 && JFIF_ID.every((b, i) => jpeg[6 + i] === b))) return null;
  const x = (jpeg[14] << 8) | jpeg[15];
  return jpeg[13] === 1 ? x : jpeg[13] === 2 ? Math.round(x * 2.54) : null;
}

// ------------------------------------------------------------------ EXR

/** Linear float pixels, RGBA (premultiplied), row major from the top. */
export interface FloatPixels {
  width: number;
  height: number;
  data: Float32Array;
}

/**
 * A minimal OpenEXR file: single part, scan lines, no compression, 32-bit float channels (A, B,
 * G, R, or B, G, R without alpha: channels go in alphabetical order), one line per block, the
 * required header attributes and the line offset table.
 */
export function encodeExr(px: FloatPixels, opts: { alpha: boolean }): Uint8Array {
  const { width, height, data } = px;
  const names = opts.alpha ? ['A', 'B', 'G', 'R'] : ['B', 'G', 'R'];
  const offsetOf: Record<string, number> = { R: 0, G: 1, B: 2, A: 3 };
  const enc = new TextEncoder();
  const parts: number[] = [];
  const push = (...b: number[]) => {
    for (const x of b) parts.push(x);
  };
  const i32 = (v: number) => push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff);
  const f32 = (v: number) => {
    const b = new Uint8Array(new Float32Array([v]).buffer);
    push(b[0], b[1], b[2], b[3]);
  };
  const cstr = (s: string) => push(...enc.encode(s), 0);
  const attr = (name: string, type: string, value: number[]) => {
    cstr(name);
    cstr(type);
    i32(value.length);
    push(...value);
  };
  const bytesOf = (fn: () => void): number[] => {
    const start = parts.length;
    fn();
    return parts.splice(start);
  };
  push(0x76, 0x2f, 0x31, 0x01); // magic
  i32(2); // version 2, single-part scan line
  const chlist = bytesOf(() => {
    for (const n of names) {
      cstr(n);
      i32(2); // FLOAT
      push(0, 0, 0, 0); // pLinear, reserved
      i32(1);
      i32(1);
    }
    push(0);
  });
  attr('channels', 'chlist', chlist);
  attr('compression', 'compression', [0]);
  const box = bytesOf(() => {
    i32(0);
    i32(0);
    i32(width - 1);
    i32(height - 1);
  });
  attr('dataWindow', 'box2i', box);
  attr('displayWindow', 'box2i', box);
  attr('lineOrder', 'lineOrder', [0]);
  attr('pixelAspectRatio', 'float', bytesOf(() => f32(1)));
  attr('screenWindowCenter', 'v2f', bytesOf(() => (f32(0), f32(0))));
  attr('screenWindowWidth', 'float', bytesOf(() => f32(1)));
  push(0); // end of header
  const header = Uint8Array.from(parts);
  const lineBytes = width * names.length * 4;
  const tableBytes = height * 8;
  const out = new Uint8Array(header.length + tableBytes + height * (8 + lineBytes));
  out.set(header, 0);
  const dv = new DataView(out.buffer);
  let o = header.length + tableBytes;
  for (let y = 0; y < height; y++) {
    dv.setBigUint64(header.length + y * 8, BigInt(o), true);
    dv.setInt32(o, y, true);
    dv.setInt32(o + 4, lineBytes, true);
    o += 8;
    for (const n of names) {
      const c = offsetOf[n];
      for (let x = 0; x < width; x++) {
        dv.setFloat32(o, data[(y * width + x) * 4 + c], true);
        o += 4;
      }
    }
  }
  return out;
}
