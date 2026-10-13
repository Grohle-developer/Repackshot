// Environment images (phase E5): the readers of Radiance `.hdr` and OpenEXR files, for the
// preview and to check a file before it is used, and the loading of an HDRI or a background
// image into the image registry (core/images.ts).
//
// The engine has its own readers (engine/crates/rt-core/src/hdr.rs and exr.rs) and receives the
// file's bytes as they are (RSB `BMAP` formats 16 and 17); these TypeScript readers do the same
// subset, so a file the preview shows is one the engine renders: RGBE flat and run-length coded
// (`-Y h +X w` or `+Y h +X w`), and scanline OpenEXR without compression or with RLE, ZIPS or ZIP
// (zlib through the browser's DecompressionStream), half, float or uint channels R, G, B (or
// `layer.R`...) or Y. A background image is decoded by the browser (any format it reads) into
// 8-bit RGBA, which is what the engine gets (`BMAP` format 1).

import { getImage, imageFormatOf, nextImageId, PREVIEW_HDRI_WIDTH, registerImage, type ImageData, type ImageFormat, type ImageRef } from '../core/images';

/** A decoded HDR image: linear RGB floats, rows from the top. */
export interface HdrPixels {
  width: number;
  height: number;
  rgb: Float32Array;
}

/** Why an environment image could not be used; `code` is turned into a sentence by the interface. */
export class ImageFileError extends Error {
  constructor(
    readonly code: 'FORMAT' | 'DAMAGED' | 'UNSUPPORTED' | 'TOO_LARGE',
    message: string,
  ) {
    super(message);
    this.name = 'ImageFileError';
  }
}

/** Largest image accepted (the engine's limit, `bitmap::MAX_PIXELS`). */
export const MAX_PIXELS = 2 ** 28;

const damaged = (why: string) => new ImageFileError('DAMAGED', why);

// ------------------------------------------------------------------ Radiance RGBE

/** `2^e` from its bits, like the engine. */
function pow2(e: number): number {
  return 2 ** e;
}

function rgbe(r: number, g: number, b: number, e: number, out: Float32Array, at: number): void {
  if (e === 0) {
    out[at] = out[at + 1] = out[at + 2] = 0;
    return;
  }
  const f = pow2(e - 136);
  out[at] = r * f;
  out[at + 1] = g * f;
  out[at + 2] = b * f;
}

/** The size and orientation of a Radiance file, and where its pixels start. */
function hdrHeader(bytes: Uint8Array): { width: number; height: number; topDown: boolean; start: number } {
  const text = (a: number, b: number) => String.fromCharCode(...bytes.subarray(a, b));
  if (!(text(0, 10) === '#?RADIANCE' || text(0, 6) === '#?RGBE')) throw new ImageFileError('FORMAT', 'not a Radiance HDR file');
  let pos = 0;
  const line = (): string | null => {
    const end = bytes.indexOf(10, pos);
    if (end < 0) return null;
    const l = text(pos, end);
    pos = end + 1;
    return l;
  };
  line();
  for (;;) {
    const l = line();
    if (l === null) throw damaged('the header has no end');
    if (l === '') break;
    if (l.startsWith('FORMAT=') && l.slice(7).trim() !== '32-bit_rle_rgbe') throw new ImageFileError('UNSUPPORTED', 'HDR pixel format is not 32-bit_rle_rgbe');
  }
  const res = line();
  const m = res && /^([-+])Y\s+(\d+)\s+\+X\s+(\d+)\s*$/.exec(res);
  if (!m) throw new ImageFileError('UNSUPPORTED', 'HDR resolution line is missing or unsupported');
  const height = Number(m[2]);
  const width = Number(m[3]);
  if (!(width > 0 && height > 0)) throw damaged('empty image');
  if (width * height > MAX_PIXELS) throw new ImageFileError('TOO_LARGE', 'HDR image is too large');
  return { width, height, topDown: m[1] === '-', start: pos };
}

/** Decodes a Radiance `.hdr` file (the subset the engine reads). */
export function decodeHdr(bytes: Uint8Array): HdrPixels {
  const { width: w, height: h, topDown, start } = hdrHeader(bytes);
  let pos = start;
  const rgb = new Float32Array(3 * w * h);
  const row = new Uint8Array(4 * w);
  const need = (n: number) => {
    if (pos + n > bytes.length) throw damaged('the pixel data is cut short');
  };
  for (let y = 0; y < h; y++) {
    const rle = w >= 8 && w <= 0x7fff && pos + 4 <= bytes.length && bytes[pos] === 2 && bytes[pos + 1] === 2 && (bytes[pos + 2] & 0x80) === 0;
    if (rle) {
      if (((bytes[pos + 2] << 8) | bytes[pos + 3]) !== w) throw damaged('a scanline has the wrong width');
      pos += 4;
      for (let c = 0; c < 4; c++) {
        let x = 0;
        while (x < w) {
          need(1);
          const count = bytes[pos++];
          if (count > 128) {
            const n = count - 128;
            need(1);
            if (x + n > w) throw damaged('a run overflows its scanline');
            const v = bytes[pos++];
            for (let k = 0; k < n; k++) row[(x + k) * 4 + c] = v;
            x += n;
          } else {
            if (count === 0 || x + count > w) throw damaged('a run overflows its scanline');
            need(count);
            for (let k = 0; k < count; k++) row[(x + k) * 4 + c] = bytes[pos++];
            x += count;
          }
        }
      }
    } else {
      let x = 0;
      let shift = 0;
      while (x < w) {
        need(4);
        const [r, g, b, e] = [bytes[pos], bytes[pos + 1], bytes[pos + 2], bytes[pos + 3]];
        pos += 4;
        if (r === 1 && g === 1 && b === 1) {
          if (x === 0) throw damaged('a repeat marker starts a scanline');
          const n = e << shift;
          if (x + n > w) throw damaged('a run overflows its scanline');
          for (let k = 0; k < n; k++) row.copyWithin((x + k) * 4, (x - 1) * 4, x * 4);
          x += n;
          shift += 8;
        } else {
          row.set([r, g, b, e], x * 4);
          x++;
          shift = 0;
        }
      }
    }
    const dst = topDown ? y : h - 1 - y;
    for (let x = 0; x < w; x++) rgbe(row[x * 4], row[x * 4 + 1], row[x * 4 + 2], row[x * 4 + 3], rgb, 3 * (dst * w + x));
  }
  return { width: w, height: h, rgb };
}

// ------------------------------------------------------------------ OpenEXR

const EXR_MAGIC = [0x76, 0x2f, 0x31, 0x01];
const COMPRESSION_NAMES = ['none', 'RLE', 'ZIPS', 'ZIP', 'PIZ', 'PXR24', 'B44', 'B44A', 'DWAA', 'DWAB'];

interface ExrHeader {
  width: number;
  height: number;
  x0: number;
  y0: number;
  compression: number;
  channels: { name: string; type: number }[];
  /** Where the offset table starts. */
  tableAt: number;
}

/** The parts of an OpenEXR header the reader needs; throws for what the engine cannot read. */
export function exrHeader(bytes: Uint8Array): ExrHeader {
  if (bytes.length < 8 || EXR_MAGIC.some((b, i) => bytes[i] !== b)) throw new ImageFileError('FORMAT', 'not an OpenEXR file');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint32(4, true);
  if ((version & 0xff) !== 2) throw new ImageFileError('UNSUPPORTED', 'OpenEXR file version');
  if (version & 0x200) throw new ImageFileError('UNSUPPORTED', 'tiled OpenEXR images');
  if (version & 0x800) throw new ImageFileError('UNSUPPORTED', 'deep OpenEXR data');
  if (version & 0x1000) throw new ImageFileError('UNSUPPORTED', 'multi-part OpenEXR files');
  let pos = 8;
  const str = (): string => {
    const end = bytes.indexOf(0, pos);
    if (end < 0) throw damaged('a name has no end');
    const s = String.fromCharCode(...bytes.subarray(pos, end));
    pos = end + 1;
    return s;
  };
  let channels: { name: string; type: number }[] | null = null;
  let compression = -1;
  let window: number[] | null = null;
  for (;;) {
    const name = str();
    if (name === '') break;
    str();
    if (pos + 4 > bytes.length) throw damaged('the header is cut short');
    const size = view.getUint32(pos, true);
    pos += 4;
    if (pos + size > bytes.length) throw damaged('the header is cut short');
    const at = pos;
    if (name === 'channels') {
      channels = [];
      let p = at;
      while (p < at + size && bytes[p] !== 0) {
        const end = bytes.indexOf(0, p);
        const cname = String.fromCharCode(...bytes.subarray(p, end));
        p = end + 1;
        const type = view.getInt32(p, true);
        const xs = view.getInt32(p + 8, true);
        const ys = view.getInt32(p + 12, true);
        if (xs !== 1 || ys !== 1) throw new ImageFileError('UNSUPPORTED', 'subsampled OpenEXR channels');
        if (type < 0 || type > 2) throw damaged('a channel has an unknown type');
        channels.push({ name: cname, type });
        p += 16;
      }
    } else if (name === 'compression') {
      compression = bytes[at];
    } else if (name === 'dataWindow' && size === 16) {
      window = [view.getInt32(at, true), view.getInt32(at + 4, true), view.getInt32(at + 8, true), view.getInt32(at + 12, true)];
    }
    pos = at + size;
  }
  if (!channels || channels.length === 0) throw damaged('no channels');
  if (compression < 0 || compression > 9) throw damaged('no compression attribute');
  if (compression > 3) throw new ImageFileError('UNSUPPORTED', `${COMPRESSION_NAMES[compression]} compression`);
  if (!window || window[2] < window[0] || window[3] < window[1]) throw damaged('no data window');
  const width = window[2] - window[0] + 1;
  const height = window[3] - window[1] + 1;
  if (width * height > MAX_PIXELS) throw new ImageFileError('TOO_LARGE', 'OpenEXR image is too large');
  return { width, height, x0: window[0], y0: window[1], compression, channels, tableAt: pos };
}

/** Index of the channel read as `want` (R, G, B or Y), or -1. */
function channelIndex(channels: readonly { name: string }[], want: string): number {
  const exact = channels.findIndex((c) => c.name === want);
  if (exact >= 0) return exact;
  const layered = channels.map((c, i) => (c.name.endsWith(`.${want}`) ? i : -1)).filter((i) => i >= 0);
  return layered.length === 1 ? layered[0] : -1;
}

function halfToFloat(h: number): number {
  const sign = h & 0x8000 ? -1 : 1;
  const exp = (h >> 10) & 0x1f;
  const man = h & 0x3ff;
  if (exp === 0) return sign * man * 2 ** -24;
  if (exp === 31) return man ? NaN : sign * Infinity;
  return sign * (1 + man / 1024) * 2 ** (exp - 15);
}

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function unRle(data: Uint8Array, expected: number): Uint8Array {
  const out = new Uint8Array(expected);
  let o = 0;
  let i = 0;
  while (i < data.length) {
    const count = (data[i++] << 24) >> 24;
    if (count < 0) {
      const n = -count;
      if (o + n > expected || i + n > data.length) throw damaged('an RLE run is too long');
      out.set(data.subarray(i, i + n), o);
      o += n;
      i += n;
    } else {
      if (o + count + 1 > expected || i >= data.length) throw damaged('an RLE run is too long');
      out.fill(data[i++], o, o + count + 1);
      o += count + 1;
    }
  }
  if (o !== expected) throw damaged('a chunk decompresses to the wrong size');
  return out;
}

/** Undoes the predictor and the byte interleaving of the ZIP and RLE compressions. */
function unpredict(t: Uint8Array): Uint8Array {
  for (let i = 1; i < t.length; i++) t[i] = (t[i - 1] + t[i] - 128) & 0xff;
  const out = new Uint8Array(t.length);
  const half = (t.length + 1) >> 1;
  for (let i = 0, o = 0; i < half; i++) {
    out[o++] = t[i];
    if (half + i < t.length) out[o++] = t[half + i];
  }
  return out;
}

/** Decodes a scanline OpenEXR file (the subset the engine reads). */
export async function decodeExr(bytes: Uint8Array): Promise<HdrPixels> {
  const hd = exrHeader(bytes);
  const { width: w, height: h, channels } = hd;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let pick = ['R', 'G', 'B'].map((n) => channelIndex(channels, n));
  if (pick.some((i) => i < 0)) {
    const y = channelIndex(channels, 'Y');
    if (y < 0) throw new ImageFileError('UNSUPPORTED', 'OpenEXR images without R, G, B or Y channels');
    pick = [y, y, y];
  }
  const size = (t: number) => (t === 1 ? 2 : 4);
  const offsets: number[] = [];
  let lineBytes = 0;
  for (const c of channels) {
    offsets.push(lineBytes);
    lineBytes += w * size(c.type);
  }
  const lines = hd.compression === 3 ? 16 : 1;
  const chunks = Math.ceil(h / lines);
  if (hd.tableAt + 8 * chunks > bytes.length) throw damaged('the offset table is cut short');
  const rgb = new Float32Array(3 * w * h);
  for (let c = 0; c < chunks; c++) {
    const at = Number(view.getBigUint64(hd.tableAt + 8 * c, true));
    if (at + 8 > bytes.length) throw damaged('a chunk is outside the file');
    const first = view.getInt32(at, true) - hd.y0;
    const packed = view.getUint32(at + 4, true);
    if (first < 0 || first >= h || first % lines !== 0 || at + 8 + packed > bytes.length) throw damaged('a chunk is damaged');
    const count = Math.min(lines, h - first);
    const rawSize = count * lineBytes;
    const data = bytes.subarray(at + 8, at + 8 + packed);
    let raw: Uint8Array;
    if (packed >= rawSize || hd.compression === 0) {
      if (packed !== rawSize) throw damaged('a chunk has the wrong size');
      raw = data;
    } else {
      const unpacked = hd.compression === 1 ? unRle(data, rawSize) : await inflate(data);
      if (unpacked.length !== rawSize) throw damaged('a chunk decompresses to the wrong size');
      raw = unpredict(unpacked);
    }
    const rv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    for (let line = 0; line < count; line++) {
      const base = line * lineBytes;
      const out = 3 * (first + line) * w;
      for (let k = 0; k < 3; k++) {
        const ci = pick[k];
        const t = channels[ci].type;
        const start = base + offsets[ci];
        for (let x = 0; x < w; x++) {
          const v = t === 1 ? halfToFloat(rv.getUint16(start + 2 * x, true)) : t === 2 ? rv.getFloat32(start + 4 * x, true) : rv.getUint32(start + 4 * x, true);
          rgb[out + 3 * x + k] = v;
        }
      }
    }
  }
  return { width: w, height: h, rgb };
}

// ------------------------------------------------------------------ preview copy and loading

/** Averages a panorama down (2 x 2 boxes) until it is at most `maxWidth` wide; non-finite and negative values become zero. */
export function previewPixels(img: HdrPixels, maxWidth = PREVIEW_HDRI_WIDTH): HdrPixels {
  let { width: w, height: h } = img;
  let rgb = new Float32Array(img.rgb.length);
  for (let i = 0; i < rgb.length; i++) {
    const v = img.rgb[i];
    rgb[i] = Number.isFinite(v) && v > 0 ? v : 0;
  }
  while (w > maxWidth) {
    const nw = Math.ceil(w / 2);
    const nh = Math.ceil(h / 2);
    const next = new Float32Array(3 * nw * nh);
    for (let y = 0; y < nh; y++) {
      const ya = 2 * y;
      const yb = Math.min(2 * y + 1, h - 1);
      for (let x = 0; x < nw; x++) {
        const xa = 2 * x;
        const xb = Math.min(2 * x + 1, w - 1);
        for (let c = 0; c < 3; c++) {
          next[3 * (y * nw + x) + c] = 0.25 * (rgb[3 * (ya * w + xa) + c] + rgb[3 * (ya * w + xb) + c] + rgb[3 * (yb * w + xa) + c] + rgb[3 * (yb * w + xb) + c]);
        }
      }
    }
    rgb = next;
    w = nw;
    h = nh;
  }
  return { width: w, height: h, rgb };
}

/** Decodes an HDRI file of `format` (HDR or EXR). */
export async function decodeHdri(bytes: Uint8Array, format: ImageFormat): Promise<HdrPixels> {
  if (format === 'HDR') return decodeHdr(bytes);
  if (format === 'EXR') return decodeExr(bytes);
  throw new ImageFileError('FORMAT', 'an HDRI is a .hdr or .exr file');
}

/** Reads an HDRI (.hdr, .exr) into the registry: the file's bytes for the engine, a smaller linear copy for the preview. */
export async function loadHdri(name: string, bytes: Uint8Array, id = nextImageId('hdri')): Promise<ImageRef> {
  const format = imageFormatOf(name);
  if (format !== 'HDR' && format !== 'EXR') throw new ImageFileError('FORMAT', 'an HDRI is a .hdr or .exr file');
  const full = await decodeHdri(bytes, format);
  const preview = previewPixels(full);
  const data: ImageData = { format, bytes, width: full.width, height: full.height, linear: preview.rgb, previewWidth: preview.width, previewHeight: preview.height };
  return registerImage(id, name, data);
}

/** Decodes an image file with the browser into straight 8-bit RGBA. */
export type PixelDecoder = (bytes: Uint8Array, format: ImageFormat) => Promise<{ width: number; height: number; rgba: Uint8Array }>;

/** The browser's decoder: createImageBitmap, drawn into a canvas without colour conversion. */
export const browserDecoder: PixelDecoder = async (bytes, format) => {
  const type = format === 'PNG' ? 'image/png' : format === 'WEBP' ? 'image/webp' : 'image/jpeg';
  const bitmap = await createImageBitmap(new Blob([bytes as Uint8Array<ArrayBuffer>], { type }), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new ImageFileError('UNSUPPORTED', 'no 2D canvas');
  ctx.drawImage(bitmap, 0, 0);
  const img = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  bitmap.close();
  return { width: img.width, height: img.height, rgba: new Uint8Array(img.data.buffer, img.data.byteOffset, img.data.byteLength) };
};

/** Reads a background image (PNG, JPEG, WebP) into the registry, decoded to 8-bit RGBA. */
export async function loadBackplate(name: string, bytes: Uint8Array, decode: PixelDecoder = browserDecoder, id = nextImageId('plate')): Promise<ImageRef> {
  const format = imageFormatOf(name);
  if (format !== 'PNG' && format !== 'JPEG' && format !== 'WEBP') throw new ImageFileError('FORMAT', 'a background image is a .png, .jpg or .webp file');
  let px;
  try {
    px = await decode(bytes, format);
  } catch (err) {
    if (err instanceof ImageFileError) throw err;
    throw damaged(err instanceof Error ? err.message : String(err));
  }
  if (px.width * px.height > MAX_PIXELS) throw new ImageFileError('TOO_LARGE', 'the image is too large');
  return registerImage(id, name, { format, bytes, width: px.width, height: px.height, rgba8: px.rgba });
}

/** Re-reads an image of a project file into the registry under its id (HDRI or background image by its format). */
export async function restoreImage(ref: ImageRef, bytes: Uint8Array, decode: PixelDecoder = browserDecoder): Promise<void> {
  if (getImage(ref.id)) return;
  const format = imageFormatOf(ref.name);
  if (format === 'HDR' || format === 'EXR') await loadHdri(ref.name, bytes, ref.id);
  else await loadBackplate(ref.name, bytes, decode, ref.id);
}
