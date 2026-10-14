// What the header of a PNG or JPEG file says (phase M2a): its size and how many channels its pixels have, read
// from the first bytes without decoding anything. The texture images of a project are kept as the files they
// came in (core/images.ts); the import sheet and the inspector show their size from here, and the RSB writer of
// M2b (`IMGS`) says how many channels each image travels with. Written from the PNG specification (ISO/IEC 15948,
// IHDR and tRNS) and the JPEG one (ITU T.81, the SOFn markers).

/** The two formats a texture image is kept in. */
export type TextureFormat = 'PNG' | 'JPEG';

export interface ImageHeader {
  format: TextureFormat;
  width: number;
  height: number;
  /** 1 grey, 3 colour, 4 colour with alpha (a grey PNG with alpha, or one with a tRNS chunk, is 4). */
  channels: 1 | 3 | 4;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function u32be(b: Uint8Array, at: number): number {
  return ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0;
}

function chunkType(b: Uint8Array, at: number): string {
  return String.fromCharCode(b[at], b[at + 1], b[at + 2], b[at + 3]);
}

function pngHeader(b: Uint8Array): ImageHeader | null {
  if (b.length < 33 || chunkType(b, 12) !== 'IHDR') return null;
  const width = u32be(b, 16);
  const height = u32be(b, 20);
  const colorType = b[25];
  // A tRNS chunk before the image data makes a grey, colour or palette image transparent in places.
  let transparent = false;
  for (let at = 8; at + 8 <= b.length; ) {
    const len = u32be(b, at);
    const type = chunkType(b, at + 4);
    if (type === 'IDAT' || type === 'IEND') break;
    if (type === 'tRNS') transparent = true;
    at += 12 + len;
  }
  let channels: ImageHeader['channels'];
  if (colorType === 0) channels = transparent ? 4 : 1;
  else if (colorType === 2 || colorType === 3) channels = transparent ? 4 : 3;
  else if (colorType === 4 || colorType === 6) channels = 4;
  else return null;
  if (width === 0 || height === 0) return null;
  return { format: 'PNG', width, height, channels };
}

function jpegHeader(b: Uint8Array): ImageHeader | null {
  let at = 2;
  while (at + 4 <= b.length) {
    if (b[at] !== 0xff) return null;
    let marker = b[at + 1];
    // Fill bytes before a marker.
    while (marker === 0xff && at + 2 < b.length) {
      at++;
      marker = b[at + 1];
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      at += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null; // end of image or scan data before any frame header
    const len = (b[at + 2] << 8) | b[at + 3];
    // SOF0..SOF15 except DHT (C4), JPG (C8) and DAC (CC).
    const sof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (sof) {
      if (at + 10 > b.length) return null;
      const height = (b[at + 5] << 8) | b[at + 6];
      const width = (b[at + 7] << 8) | b[at + 8];
      const components = b[at + 9];
      if (width === 0 || height === 0) return null;
      // CMYK and YCCK come out of the browser's decoder as colour.
      return { format: 'JPEG', width, height, channels: components === 1 ? 1 : 3 };
    }
    at += 2 + len;
  }
  return null;
}

/** The header of a PNG or JPEG file, or null when the bytes are neither (or are cut before the header ends). */
export function readImageHeader(bytes: Uint8Array): ImageHeader | null {
  if (bytes.length >= 8 && PNG_SIGNATURE.every((v, i) => bytes[i] === v)) return pngHeader(bytes);
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) return jpegHeader(bytes);
  return null;
}

/** The MIME type of a texture format. */
export function textureMime(format: TextureFormat): string {
  return format === 'PNG' ? 'image/png' : 'image/jpeg';
}
