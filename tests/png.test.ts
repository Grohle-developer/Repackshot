// PNG output of the path tracer's pixels (phase E4): the bytes written are the bytes rendered.

import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { adler32, crc32, encodePng, zlibStored } from '../src/io/image';

/** Decodes the PNGs encodePng writes (8 bits, RGB or RGBA, filter 0). */
function decode(png: Uint8Array): { width: number; height: number; channels: number; rgba: Uint8Array; crcOk: boolean } {
  const v = new DataView(png.buffer, png.byteOffset, png.byteLength);
  expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  let o = 8;
  let width = 0;
  let height = 0;
  let channels = 0;
  let crcOk = true;
  const idat: Uint8Array[] = [];
  for (;;) {
    const len = v.getUint32(o);
    const type = String.fromCharCode(...png.subarray(o + 4, o + 8));
    const data = png.subarray(o + 8, o + 8 + len);
    crcOk &&= v.getUint32(o + 8 + len) === crc32(png, o + 4, o + 8 + len);
    if (type === 'IHDR') {
      width = v.getUint32(o + 8);
      height = v.getUint32(o + 12);
      expect(png[o + 16]).toBe(8);
      channels = png[o + 17] === 6 ? 4 : 3;
    } else if (type === 'IDAT') idat.push(data);
    o += 12 + len;
    if (type === 'IEND') break;
  }
  const all = new Uint8Array(idat.reduce((n, d) => n + d.length, 0));
  idat.reduce((o, d) => (all.set(d, o), o + d.length), 0);
  const raw = inflateSync(all);
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const row = y * (width * channels + 1);
    expect(raw[row]).toBe(0);
    for (let x = 0; x < width; x++) {
      for (let c = 0; c < 4; c++) rgba[(y * width + x) * 4 + c] = c < channels ? raw[row + 1 + x * channels + c] : 255;
    }
  }
  return { width, height, channels, rgba, crcOk };
}

function pattern(w: number, h: number, alpha: (i: number) => number): Uint8ClampedArray {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) px.set([(i * 37) & 255, (i * 11 + 5) & 255, (i * 3) & 255, alpha(i)], i * 4);
  return px;
}

describe('PNG of rendered pixels', () => {
  it('an opaque image is RGB with exactly the rendered bytes', async () => {
    const data = pattern(31, 7, () => 255);
    const d = decode(await encodePng({ width: 31, height: 7, data }));
    expect([d.width, d.height, d.channels, d.crcOk]).toEqual([31, 7, 3, true]);
    expect([...d.rgba]).toEqual([...data]);
  });

  it('a transparent one keeps its alpha and its straight colour (no canvas premultiplication)', async () => {
    const data = pattern(9, 5, (i) => (i * 29) & 255);
    const d = decode(await encodePng({ width: 9, height: 5, data }));
    expect(d.channels).toBe(4);
    expect([...d.rgba]).toEqual([...data]);
  });

  it('stored zlib blocks and checksums follow RFC 1950 and the PNG standard', () => {
    // Known values: CRC-32 of "IEND" and Adler-32 of "Wikipedia".
    expect(crc32(new TextEncoder().encode('IEND'))).toBe(0xae426082);
    expect(adler32(new TextEncoder().encode('Wikipedia'))).toBe(0x11e60398);
    const big = new Uint8Array(150000).map((_, i) => (i * 7) & 255);
    expect([...inflateSync(zlibStored(big))]).toEqual([...big]);
    expect([...inflateSync(zlibStored(new Uint8Array(0)))]).toEqual([]);
  });
});
