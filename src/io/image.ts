// Image output: encodes a rendered image as PNG (8 or 16 bits), JPEG, EXR, TIFF (8, 16 or 32 bits) or DNG.
//
// The path tracer hands over its tone-mapped 8-bit pixels (`encodePixels`):
// PNG is written here, byte for byte what the engine produced (a canvas would
// premultiply the alpha and round the colour of every translucent pixel),
// RGB when the image is opaque and RGBA otherwise. JPEG goes through a canvas.
// A 16-bit PNG, a 16 or 32-bit TIFF, a DNG and an EXR come from the engine's float sums
// (render/tiles.ts converts them; this file only writes bytes). The TIFF and DNG encoders write
// the same bytes as `rt_core::tiff` and `rt_core::dng` (engine/crates/rt-core): the files in
// tests/fixtures/tiff/ are what tests/tiff-dng.test.ts and the engine's tests compare with.
//
// The DPI of the render window is written into the file so a print shop
// reads the right print size: the PNG `pHYs` chunk (pixels per metre, unit 1)
// and the JPEG JFIF header (units 1: dots per inch). EXR has no standard
// density attribute; a TIFF carries it as XResolution/YResolution (inches).

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

/** The `tEXt` chunk of a keyword (1 to 79 printable Latin-1 characters) and its text (Latin-1): the file says what it holds. */
export function textChunk(keyword: string, text: string): [string, Uint8Array] {
  const latin1 = (v: string) => Uint8Array.from(v, (c) => (c.charCodeAt(0) < 256 ? c.charCodeAt(0) : 63));
  const key = latin1(keyword.slice(0, 79));
  const value = latin1(text);
  const d = new Uint8Array(key.length + 1 + value.length);
  d.set(key, 0);
  d.set(value, key.length + 1);
  return ['tEXt', d];
}

/** What `encodePngWords` writes besides the words: the density and notes (`tEXt` keyword and text pairs, in order). */
export interface WordsOptions extends EncodeOptions {
  text?: readonly (readonly [string, string])[];
}

/**
 * A PNG of 16-bit words with no alpha (N2: the files of the passes): one channel (grey, colour type 0) or three
 * (RGB, type 2), samples big-endian, filter 0 on every row; `pHYs` with the DPI and a `tEXt` chunk for each note.
 * `words` has `width * height * channels` values, rows from the top.
 */
export async function encodePngWords(width: number, height: number, channels: 1 | 3, words: Uint16Array, opts: WordsOptions = {}): Promise<Uint8Array> {
  if (words.length !== width * height * channels) throw new Error(`a ${width} × ${height} PNG of ${channels} channel(s) needs ${width * height * channels} words, not ${words.length}`);
  const row = width * channels * 2;
  const raw = new Uint8Array((row + 1) * height);
  let o = 0;
  let i = 0;
  for (let y = 0; y < height; y++) {
    raw[o++] = 0;
    for (let x = 0; x < width * channels; x++, i++) {
      raw[o++] = words[i] >>> 8;
      raw[o++] = words[i] & 0xff;
    }
  }
  const head = new Uint8Array(13);
  const v = new DataView(head.buffer);
  v.setUint32(0, width);
  v.setUint32(4, height);
  head[8] = 16;
  head[9] = channels === 1 ? 0 : 2;
  const chunks: [string, Uint8Array][] = [['IHDR', head]];
  if (opts.dpi !== undefined) chunks.push(['pHYs', physData(opts.dpi)]);
  for (const [key, text] of opts.text ?? []) chunks.push(textChunk(key, text));
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

/** One channel of an EXR of planes: its name and `width * height` floats, rows from the top. */
export interface ExrPlane {
  name: string;
  data: Float32Array;
}

/**
 * An OpenEXR file of single-channel planes (N2: the passes): the same minimal file as `encodeExr` (single part, scan
 * lines, no compression, 32-bit float channels, one line per block, the required attributes, the line offset table),
 * with the channels you name instead of RGBA. EXR lists its channels in alphabetical order; they are sorted here, and
 * the names must be unique. Values are written as they are, `Infinity` included (the depth of the background).
 */
export function encodeExrPlanes(width: number, height: number, planes: readonly ExrPlane[]): Uint8Array {
  if (planes.length === 0) throw new Error('an EXR needs at least one channel');
  const sorted = [...planes].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i].data.length !== width * height) throw new Error(`the ${sorted[i].name} channel is not ${width} × ${height}`);
    if (i > 0 && sorted[i].name === sorted[i - 1].name) throw new Error(`the channel ${sorted[i].name} is twice`);
  }
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
    for (const p of sorted) {
      cstr(p.name);
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
  const lineBytes = width * sorted.length * 4;
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
    for (const p of sorted) {
      for (let x = 0; x < width; x++) {
        dv.setFloat32(o, p.data[y * width + x], true);
        o += 4;
      }
    }
  }
  return out;
}

// ------------------------------------------------------------------ TIFF and DNG

/**
 * Samples of an image to write as TIFF, interleaved RGBA, rows from the top: 8 bits (display
 * encoded, straight alpha), 16 bits (the same, as words) or 32-bit floats (linear light, straight
 * alpha).
 */
export interface TiffPixels {
  width: number;
  height: number;
  data: Uint8ClampedArray | Uint8Array | Uint16Array | Float32Array;
}

export interface TiffOptions {
  /** Bits per sample; `data` must be of the matching type (8: bytes, 16: words, 32: floats). */
  bits: 8 | 16 | 32;
  /** Write the alpha channel (unassociated, `ExtraSamples` 2); without it the file is RGB. */
  alpha: boolean;
  /** Dots per inch written as the resolution in both directions; 72 by default. */
  dpi?: number;
}

/** A directory entry: tag, field type, count and the value already encoded little-endian. */
interface TiffEntry {
  tag: number;
  type: number;
  count: number;
  data: Uint8Array;
}

const T_BYTE = 1;
const T_ASCII = 2;
const T_SHORT = 3;
const T_LONG = 4;
const T_RATIONAL = 5;
const T_SRATIONAL = 10;

/** The tag numbers of TIFF 6.0 §8 and the DNG 1.4 ones the DNG uses. */
const TAG = {
  newSubfileType: 254,
  imageWidth: 256,
  imageLength: 257,
  bitsPerSample: 258,
  compression: 259,
  photometric: 262,
  make: 271,
  model: 272,
  stripOffsets: 273,
  samplesPerPixel: 277,
  rowsPerStrip: 278,
  stripByteCounts: 279,
  xResolution: 282,
  yResolution: 283,
  planarConfiguration: 284,
  resolutionUnit: 296,
  extraSamples: 338,
  sampleFormat: 339,
  dngVersion: 50706,
  dngBackwardVersion: 50707,
  uniqueCameraModel: 50708,
  whiteLevel: 50717,
  colorMatrix1: 50721,
  asShotNeutral: 50728,
  baselineExposure: 50730,
  calibrationIlluminant1: 50778,
} as const;

/** Bytes a strip aims at (TIFF 6.0 §7: "about 8K bytes"). */
const STRIP_TARGET = 8192;

function entryOf(tag: number, type: number, values: readonly number[], size: 1 | 2 | 4, put: (dv: DataView, at: number, v: number) => void): TiffEntry {
  const data = new Uint8Array(values.length * size);
  const dv = new DataView(data.buffer);
  values.forEach((v, i) => put(dv, i * size, v));
  return { tag, type, count: values.length, data };
}

const tByte = (tag: number, v: readonly number[]) => entryOf(tag, T_BYTE, v, 1, (dv, o, x) => dv.setUint8(o, x));
const tShort = (tag: number, v: readonly number[]) => entryOf(tag, T_SHORT, v, 2, (dv, o, x) => dv.setUint16(o, x, true));
const tLong = (tag: number, v: readonly number[]) => entryOf(tag, T_LONG, v, 4, (dv, o, x) => dv.setUint32(o, x, true));

/** An ASCII field: the text (ASCII only) and its terminating NUL, which the count includes. */
function tAscii(tag: number, text: string): TiffEntry {
  const data = new Uint8Array(text.length + 1);
  for (let i = 0; i < text.length; i++) data[i] = text.charCodeAt(i);
  return { tag, type: T_ASCII, count: data.length, data };
}

/** Fractions as `[numerator, denominator]`, two longs each (signed or not). */
function tFractions(tag: number, type: number, v: readonly (readonly [number, number])[]): TiffEntry {
  const data = new Uint8Array(v.length * 8);
  const dv = new DataView(data.buffer);
  v.forEach(([n, d], i) => {
    if (type === T_SRATIONAL) {
      dv.setInt32(i * 8, n, true);
      dv.setInt32(i * 8 + 4, d, true);
    } else {
      dv.setUint32(i * 8, n, true);
      dv.setUint32(i * 8 + 4, d, true);
    }
  });
  return { tag, type, count: v.length, data };
}

/** The image as the file stores it: its size, channels, bits and the pixel bytes (little-endian, chunky). */
interface Raster {
  width: number;
  height: number;
  channels: 3 | 4;
  bits: 8 | 16 | 32;
  pixels: Uint8Array;
}

/** RGB or RGBA samples of `px` (RGBA in) as bytes in the file's order; alpha dropped unless `alpha`. */
function rasterOf(px: TiffPixels, bits: 8 | 16 | 32, alpha: boolean): Raster {
  const { width, height, data } = px;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) throw new Error('TIFF dimensions must be positive');
  if (data.length !== width * height * 4) throw new Error('the pixel buffer does not match the dimensions');
  const want = bits === 8 ? [Uint8Array, Uint8ClampedArray] : bits === 16 ? [Uint16Array] : [Float32Array];
  if (!want.some((c) => data instanceof c)) throw new Error(`${bits}-bit samples do not come in a ${data.constructor.name}`);
  const channels = alpha ? 4 : 3;
  const pixels = new Uint8Array(width * height * channels * (bits / 8));
  const dv = new DataView(pixels.buffer);
  let o = 0;
  for (let i = 0; i < data.length; i += 4) {
    for (let c = 0; c < channels; c++) {
      const v = data[i + c];
      if (bits === 8) pixels[o++] = v;
      else if (bits === 16) {
        dv.setUint16(o, v, true);
        o += 2;
      } else {
        dv.setFloat32(o, v, true);
        o += 4;
      }
    }
  }
  return { width, height, channels, bits, pixels };
}

const rowBytes = (r: Raster) => r.width * r.channels * (r.bits / 8);
const rowsPerStrip = (r: Raster) => Math.min(r.height, Math.max(1, Math.floor(STRIP_TARGET / rowBytes(r))));

/** Byte count of every strip: whole strips of `rowsPerStrip` rows, the last one the rest. */
function stripByteCounts(r: Raster): number[] {
  const rows = rowsPerStrip(r);
  const out: number[] = [];
  for (let first = 0; first < r.height; first += rows) out.push(Math.min(rows, r.height - first) * rowBytes(r));
  return out;
}

/** The entries every image has, plus ExtraSamples for alpha and SampleFormat for floats (StripOffsets is filled in later). */
function rasterEntries(r: Raster): TiffEntry[] {
  const counts = stripByteCounts(r);
  const entries = [
    tLong(TAG.imageWidth, [r.width]),
    tLong(TAG.imageLength, [r.height]),
    tShort(TAG.bitsPerSample, new Array(r.channels).fill(r.bits)),
    tShort(TAG.compression, [1]),
    tLong(TAG.stripOffsets, new Array(counts.length).fill(0)),
    tShort(TAG.samplesPerPixel, [r.channels]),
    tLong(TAG.rowsPerStrip, [rowsPerStrip(r)]),
    tLong(TAG.stripByteCounts, counts),
    tShort(TAG.planarConfiguration, [1]),
  ];
  // 2: unassociated alpha (the colour is not multiplied by it).
  if (r.channels === 4) entries.push(tShort(TAG.extraSamples, [2]));
  // 3: IEEE floating point.
  if (r.bits === 32) entries.push(tShort(TAG.sampleFormat, new Array(r.channels).fill(3)));
  return entries;
}

/**
 * The file: header, the directory (sorted by tag), the values that do not fit in an entry (each at
 * an even offset) and the pixels in strips; `StripOffsets` gets its real offsets. Layout in
 * engine/crates/rt-core/src/tiff.rs.
 */
function assembleTiff(list: TiffEntry[], r: Raster): Uint8Array {
  const entries = [...list].sort((a, b) => a.tag - b.tag);
  const directory = 2 + 12 * entries.length + 4;
  const external = entries.filter((e) => e.data.length > 4);
  const extra = external.reduce((n, e) => n + e.data.length + (e.data.length & 1), 0);
  const firstPixel = 8 + directory + extra;
  if (firstPixel + r.pixels.length > 0xffffffff) throw new Error('the image is too large for a TIFF');
  let at = firstPixel;
  const offsets = stripByteCounts(r).map((c) => {
    const start = at;
    at += c;
    return start;
  });
  const strips = entries.find((e) => e.tag === TAG.stripOffsets)!;
  if (strips.count !== offsets.length) throw new Error('StripOffsets does not match the strips');
  Object.assign(strips, tLong(TAG.stripOffsets, offsets));

  const out = new Uint8Array(firstPixel + r.pixels.length);
  const dv = new DataView(out.buffer);
  out.set([0x49, 0x49, 42, 0]);
  dv.setUint32(4, 8, true);
  dv.setUint16(8, entries.length, true);
  let next = 8 + directory;
  let o = 10;
  for (const e of entries) {
    dv.setUint16(o, e.tag, true);
    dv.setUint16(o + 2, e.type, true);
    dv.setUint32(o + 4, e.count, true);
    if (e.data.length <= 4) out.set(e.data, o + 8);
    else {
      dv.setUint32(o + 8, next, true);
      next += e.data.length + (e.data.length & 1);
    }
    o += 12;
  }
  // The next directory: none. Then the external values, in entry order.
  o += 4;
  for (const e of external) {
    out.set(e.data, o);
    o += e.data.length + (e.data.length & 1);
  }
  out.set(r.pixels, firstPixel);
  return out;
}

/**
 * An uncompressed TIFF 6.0 (baseline, little-endian), written from the public specification: RGB, or
 * RGBA with unassociated alpha, at 8, 16 or 32 bits per sample (32: IEEE floats, `SampleFormat` 3,
 * linear light), in strips of about 8 KiB, with the resolution in dots per inch and no colour
 * profile. The same bytes as `rt_core::tiff::encode`.
 */
export function encodeTiff(px: TiffPixels, opts: TiffOptions): Uint8Array {
  const raster = rasterOf(px, opts.bits, opts.alpha);
  const dpi = Math.max(1, Math.round(opts.dpi ?? 72));
  const entries = [
    ...rasterEntries(raster),
    tShort(TAG.photometric, [2]),
    tFractions(TAG.xResolution, T_RATIONAL, [[dpi, 1]]),
    tFractions(TAG.yResolution, T_RATIONAL, [[dpi, 1]]),
    // 2: inches.
    tShort(TAG.resolutionUnit, [2]),
  ];
  return assembleTiff(entries, raster);
}

/** `ColorMatrix1` of the DNG: CIE XYZ (D65) to linear sRGB, row by row, numerators over `DNG_MATRIX_DENOMINATOR`. */
export const DNG_COLOR_MATRIX: readonly number[] = [32409699, -15373832, -4986108, -9692436, 18759675, 415551, 556301, -2039770, 10569715];
export const DNG_MATRIX_DENOMINATOR = 10_000_000;
/** What `Make`, `Model` and `UniqueCameraModel` say. */
export const DNG_CAMERA = 'Repackshot';

/**
 * A linear raw DNG 1.4 (Adobe's specification): a TIFF with `PhotometricInterpretation` 34892
 * (LinearRaw), three 32-bit float samples (the alpha of `px` is dropped), the linear sRGB primaries
 * declared by `ColorMatrix1` (the inverse of sRGB to XYZ, D65) and the tags DNG 1.4 asks for. A raw
 * developer opens it as a camera raw with the whole latitude of the render. The same bytes as
 * `rt_core::dng::encode`.
 */
export function encodeDng(px: { width: number; height: number; data: Float32Array }): Uint8Array {
  const raster = rasterOf(px, 32, false);
  const entries = [
    ...rasterEntries(raster),
    tLong(TAG.newSubfileType, [0]),
    tShort(TAG.photometric, [34892]),
    tAscii(TAG.make, DNG_CAMERA),
    tAscii(TAG.model, DNG_CAMERA),
    tByte(TAG.dngVersion, [1, 4, 0, 0]),
    tByte(TAG.dngBackwardVersion, [1, 4, 0, 0]),
    tAscii(TAG.uniqueCameraModel, DNG_CAMERA),
    // The white of the render is 1.0 (BlackLevel stays 0); the data is not clipped to it.
    tLong(TAG.whiteLevel, [1]),
    tFractions(TAG.colorMatrix1, T_SRATIONAL, DNG_COLOR_MATRIX.map((n) => [n, DNG_MATRIX_DENOMINATOR] as const)),
    tFractions(TAG.asShotNeutral, T_RATIONAL, [[1, 1], [1, 1], [1, 1]]),
    tFractions(TAG.baselineExposure, T_SRATIONAL, [[0, 1]]),
    // 21: D65 daylight (the Exif LightSource code).
    tShort(TAG.calibrationIlluminant1, [21]),
  ];
  return assembleTiff(entries, raster);
}
