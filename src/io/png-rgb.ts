// PNG for the AI's API calls (phase X7): 8-bit RGB in and out, with no canvas, so the same code runs in a page, a
// worker and the Node tests. Encoding goes through io/image.ts's writer; decoding is the PNG specification's
// non-interlaced images (every colour type, 1–16 bits; 16 bits keep their high byte; alpha is dropped: the guard keeps
// the engine's), inflated with the platform's DecompressionStream. An interlaced or damaged file is refused.

import { encodePng } from './image';

export interface PngRgb {
  width: number;
  height: number;
  rgb: Uint8Array;
}

/** A PNG of 8-bit RGB. */
export async function encodePngRgb(width: number, height: number, rgb: Uint8Array): Promise<Uint8Array> {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0, j = 0; i < width * height; i++, j += 3) {
    data[i * 4] = rgb[j];
    data[i * 4 + 1] = rgb[j + 1];
    data[i * 4 + 2] = rgb[j + 2];
    data[i * 4 + 3] = 255;
  }
  return encodePng({ width, height, data });
}

/** A one-channel image (the depth and edge passes) as a grey PNG, written as RGB. */
export async function encodePngGrey(width: number, height: number, grey: Uint8Array): Promise<Uint8Array> {
  const rgb = new Uint8Array(width * height * 3);
  for (let i = 0; i < width * height; i++) rgb[i * 3] = rgb[i * 3 + 1] = rgb[i * 3 + 2] = grey[i];
  return encodePngRgb(width, height, rgb);
}

export class PngError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PngError';
  }
}

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** The size a PNG says it is, from its header alone (null when it is not a PNG). */
export function pngSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24 || !SIGNATURE.every((b, i) => bytes[i] === b)) return null;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]) !== 'IHDR') return null;
  return { width: v.getUint32(16), height: v.getUint32(20) };
}

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  try {
    const stream = new Blob([data as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream('deflate'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    throw new PngError('the image data does not inflate');
  }
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** Decodes a PNG to 8-bit RGB. `maxPixels` bounds what is decoded (checked before inflating). */
export async function decodePngRgb(bytes: Uint8Array, maxPixels: number): Promise<PngRgb> {
  const size = pngSize(bytes);
  if (!size) throw new PngError('not a PNG');
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 8;
  let depth = 0;
  let type = 0;
  let palette: Uint8Array | null = null;
  const idat: Uint8Array[] = [];
  let interlace = 0;
  while (at + 8 <= bytes.length) {
    const len = v.getUint32(at);
    const kind = String.fromCharCode(bytes[at + 4], bytes[at + 5], bytes[at + 6], bytes[at + 7]);
    const start = at + 8;
    if (start + len + 4 > bytes.length) throw new PngError('the file ends inside a chunk');
    const data = bytes.subarray(start, start + len);
    if (kind === 'IHDR') {
      depth = data[8];
      type = data[9];
      interlace = data[12];
    } else if (kind === 'PLTE') palette = data;
    else if (kind === 'IDAT') idat.push(data);
    else if (kind === 'IEND') break;
    at = start + len + 4;
  }
  const { width, height } = size;
  if (width === 0 || height === 0 || width * height > maxPixels) throw new PngError(`a PNG of ${width}×${height} is too large`);
  if (interlace !== 0) throw new PngError('interlaced PNG is not read');
  const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[type];
  if (!channels || ![1, 2, 4, 8, 16].includes(depth) || (type === 3 && !palette) || (depth < 8 && type !== 0 && type !== 3) || (depth === 16 && type === 3)) throw new PngError('unsupported PNG kind');
  const total = idat.reduce((n, d) => n + d.length, 0);
  const joined = new Uint8Array(total);
  let o = 0;
  for (const d of idat) {
    joined.set(d, o);
    o += d.length;
  }
  const raw = await inflate(joined);
  const bitsPerPixel = channels * depth;
  const stride = Math.ceil((width * bitsPerPixel) / 8);
  const bpp = Math.max(1, bitsPerPixel >> 3);
  if (raw.length < (stride + 1) * height) throw new PngError('the image data is short');
  const cur = new Uint8Array(stride);
  const prev = new Uint8Array(stride);
  const rgb = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    if (f > 4) throw new PngError('bad filter');
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      const x = line[i];
      cur[i] = (f === 0 ? x : f === 1 ? x + a : f === 2 ? x + b : f === 3 ? x + ((a + b) >> 1) : x + paeth(a, b, c)) & 0xff;
    }
    for (let x = 0; x < width; x++) {
      const sample = (ch: number): number => {
        if (depth === 8) return cur[x * channels + ch];
        if (depth === 16) return cur[(x * channels + ch) * 2];
        const bit = x * depth;
        const s = (cur[bit >> 3] >> (8 - depth - (bit & 7))) & ((1 << depth) - 1);
        return type === 3 ? s : Math.round((s * 255) / ((1 << depth) - 1));
      };
      const out = (y * width + x) * 3;
      if (type === 3) {
        const i = sample(0) * 3;
        rgb[out] = palette![i] ?? 0;
        rgb[out + 1] = palette![i + 1] ?? 0;
        rgb[out + 2] = palette![i + 2] ?? 0;
      } else if (channels <= 2) rgb[out] = rgb[out + 1] = rgb[out + 2] = sample(0);
      else {
        rgb[out] = sample(0);
        rgb[out + 1] = sample(1);
        rgb[out + 2] = sample(2);
      }
    }
    prev.set(cur);
  }
  return { width, height, rgb };
}
