// Image output: encodes a rendered image as PNG or JPEG. EXR comes later.
//
// The path tracer hands over its tone-mapped 8-bit pixels (`encodePixels`):
// PNG is written here, byte for byte what the engine produced (a canvas would
// premultiply the alpha and round the colour of every translucent pixel),
// RGB when the image is opaque and RGBA otherwise. JPEG goes through a canvas.

export type ImageFormat = 'PNG' | 'JPEG';

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

/** Encodes pixels: PNG exactly, JPEG over white through a canvas. */
export async function encodePixels(px: Pixels, format: ImageFormat, quality = 0.92): Promise<Blob> {
  if (format === 'PNG') return new Blob([(await encodePng(px)) as Uint8Array<ArrayBuffer>], { type: 'image/png' });
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
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode'))), 'image/jpeg', quality));
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

/** A PNG of 8-bit pixels: RGB when every alpha is 255, RGBA otherwise; filter 0 on every row. */
export async function encodePng(px: Pixels): Promise<Uint8Array> {
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
  const idat = await zlib(raw);
  const chunks: [string, Uint8Array][] = [];
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, width);
  v.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = opaque ? 2 : 6; // colour type: RGB or RGBA
  chunks.push(['IHDR', ihdr], ['IDAT', idat], ['IEND', new Uint8Array(0)]);
  const size = 8 + chunks.reduce((n, [, d]) => n + 12 + d.length, 0);
  const out = new Uint8Array(size);
  out.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const dv = new DataView(out.buffer);
  let o = 8;
  for (const [type, d] of chunks) {
    dv.setUint32(o, d.length);
    for (let i = 0; i < 4; i++) out[o + 4 + i] = type.charCodeAt(i);
    out.set(d, o + 8);
    dv.setUint32(o + 8 + d.length, crc32(out, o + 4, o + 8 + d.length));
    o += 12 + d.length;
  }
  return out;
}
