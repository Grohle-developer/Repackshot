// PNG output of the path tracer's pixels (phase E4): the bytes written are the bytes rendered.

import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { adler32, crc32, encodeExr, encodePng, encodePng16, jpegDpi, physData, setJpegDpi, zlibStored } from '../src/io/image';
import { dpiFromPixelsPerMetre } from '../src/core/print-size';
import { exactBytes, exactWords16, linearRgba } from '../src/render/tiles';

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

/** Every chunk of a PNG with whether its CRC is right. */
function pngChunks(png: Uint8Array): { type: string; data: Uint8Array; crcOk: boolean }[] {
  const v = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const out: { type: string; data: Uint8Array; crcOk: boolean }[] = [];
  for (let o = 8; o < png.length; ) {
    const len = v.getUint32(o);
    const type = String.fromCharCode(...png.subarray(o + 4, o + 8));
    out.push({ type, data: png.subarray(o + 8, o + 8 + len), crcOk: v.getUint32(o + 8 + len) === crc32(png, o + 4, o + 8 + len) });
    o += 12 + len;
  }
  return out;
}

describe('the DPI written into the file', () => {
  it('PNG: a pHYs chunk before IDAT, pixels per metre in both axes, unit 1, with its CRC', async () => {
    const data = pattern(4, 3, () => 255);
    const png = await encodePng({ width: 4, height: 3, data }, { dpi: 300 });
    const chunks = pngChunks(png);
    expect(chunks.map((c) => c.type)).toEqual(['IHDR', 'pHYs', 'IDAT', 'IEND']);
    expect(chunks.every((c) => c.crcOk)).toBe(true);
    const phys = chunks[1].data;
    const dv = new DataView(phys.buffer, phys.byteOffset, phys.byteLength);
    expect([phys.length, dv.getUint32(0), dv.getUint32(4), phys[8]]).toEqual([9, 11811, 11811, 1]);
    expect(dpiFromPixelsPerMetre(dv.getUint32(0))).toBe(300);
    // The pixels are untouched by it.
    expect([...decode(png).rgba]).toEqual([...data]);
    // Without a DPI there is no pHYs (the reader assumes nothing).
    expect(pngChunks(await encodePng({ width: 4, height: 3, data })).map((c) => c.type)).toEqual(['IHDR', 'IDAT', 'IEND']);
    expect([...physData(72)]).toEqual([0, 0, 0x0b, 0x13, 0, 0, 0x0b, 0x13, 1]);
  });

  it('JPEG: the JFIF density in dots per inch, patched in place or inserted after SOI', () => {
    // SOI, APP0 JFIF 1.01 with units 0 and density 1:1 (what canvas encoders write), a fake segment, EOI.
    const jfif = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x03, 0x07, 0xff, 0xd9]);
    const patched = setJpegDpi(jfif, 300);
    expect(patched.length).toBe(jfif.length);
    expect([...patched.subarray(13, 18)]).toEqual([1, 0x01, 0x2c, 0x01, 0x2c]);
    expect([...patched.subarray(18)]).toEqual([...jfif.subarray(18)]);
    expect(jpegDpi(patched)).toBe(300);
    // An Exif-only file gets a JFIF segment first; everything after SOI follows unchanged.
    const exif = Uint8Array.from([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x04, 0x45, 0x78, 0xff, 0xd9]);
    const inserted = setJpegDpi(exif, 600);
    expect(inserted.length).toBe(exif.length + 18);
    expect(jpegDpi(inserted)).toBe(600);
    expect([...inserted.subarray(20)]).toEqual([...exif.subarray(2)]);
    expect(() => setJpegDpi(Uint8Array.from([1, 2, 3, 4]), 300)).toThrow();
  });
});

describe('16-bit PNG', () => {
  // Sums of 4 samples of a gradient, half of it translucent.
  const w = 7;
  const h = 3;
  const samples = 4;
  const sum = new Float32Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const a = i % 2 === 0 ? 1 : 0.5;
    sum.set([i * 0.05 * a * samples, (1 - i / 21) * a * samples, 0.3 * a * samples, a * samples], i * 4);
  }

  it('writes 16-bit samples (IHDR bit depth 16), big-endian, from the float sums', async () => {
    const words = exactWords16(sum, samples, 0, 2);
    const png = await encodePng16({ width: w, height: h, data: words }, { dpi: 150 });
    const chunks = pngChunks(png);
    expect(chunks.map((c) => c.type)).toEqual(['IHDR', 'pHYs', 'IDAT', 'IEND']);
    expect(chunks.every((c) => c.crcOk)).toBe(true);
    const ihdr = chunks[0].data;
    expect([ihdr[8], ihdr[9]]).toEqual([16, 6]); // 16 bits, RGBA
    const raw = inflateSync(chunks[2].data);
    const stride = w * 4 * 2 + 1;
    expect(raw.length).toBe(stride * h);
    for (let y = 0; y < h; y++) {
      expect(raw[y * stride]).toBe(0);
      for (let x = 0; x < w; x++) {
        for (let c = 0; c < 4; c++) {
          const o = y * stride + 1 + (x * 4 + c) * 2;
          expect((raw[o] << 8) | raw[o + 1]).toBe(words[(y * w + x) * 4 + c]);
        }
      }
    }
  });

  it('the 16-bit values are the 8-bit ones with more precision, not a rescaled 8-bit image', () => {
    const words = exactWords16(sum, samples, 0.5, 3);
    const bytes = exactBytes(sum, samples, 0.5, 3);
    let finer = false;
    for (let i = 0; i < words.length; i++) {
      expect(Math.abs(words[i] / 257 - bytes[i])).toBeLessThanOrEqual(0.5 + 1e-9);
      // Colour channels only: a 16-bit alpha of 0.5 is not a multiple of 257 anyway.
      if (i % 4 !== 3 && words[i] % 257 !== 0) finer = true;
    }
    expect(finer).toBe(true);
    // Opaque images are RGB.
    const opaque = new Float32Array([0.2, 0.4, 0.6, 1, 1, 1, 1, 1]);
    return encodePng16({ width: 2, height: 1, data: exactWords16(opaque, 1, 0, 0) }).then((png) => expect(pngChunks(png)[0].data[9]).toBe(2));
  });
});

describe('EXR', () => {
  /** Reads the header attributes and the pixels of the files encodeExr writes. */
  function readExr(bytes: Uint8Array): { attrs: Record<string, Uint8Array>; channels: string[]; pixels: Record<string, number[]> } {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(dv.getUint32(0, true)).toBe(20000630);
    expect(dv.getUint32(4, true)).toBe(2);
    let o = 8;
    const cstr = () => {
      let s = '';
      while (bytes[o] !== 0) s += String.fromCharCode(bytes[o++]);
      o++;
      return s;
    };
    const attrs: Record<string, Uint8Array> = {};
    for (;;) {
      const name = cstr();
      if (!name) break;
      cstr();
      const size = dv.getInt32(o, true);
      attrs[name] = bytes.subarray(o + 4, o + 4 + size);
      o += 4 + size;
    }
    const channels: string[] = [];
    const cl = attrs.channels;
    for (let i = 0; cl[i] !== 0; ) {
      let n = '';
      while (cl[i] !== 0) n += String.fromCharCode(cl[i++]);
      i++;
      expect(new DataView(cl.buffer, cl.byteOffset + i, 4).getInt32(0, true)).toBe(2);
      i += 16;
      channels.push(n);
    }
    const box = new DataView(attrs.dataWindow.buffer, attrs.dataWindow.byteOffset, 16);
    const width = box.getInt32(8, true) + 1;
    const height = box.getInt32(12, true) + 1;
    const pixels: Record<string, number[]> = Object.fromEntries(channels.map((c) => [c, []]));
    for (let y = 0; y < height; y++) {
      const at = Number(dv.getBigUint64(o + y * 8, true));
      expect(dv.getInt32(at, true)).toBe(y);
      expect(dv.getInt32(at + 4, true)).toBe(width * channels.length * 4);
      let p = at + 8;
      for (const c of channels) for (let x = 0; x < width; x++, p += 4) pixels[c].push(dv.getFloat32(p, true));
    }
    return { attrs, channels, pixels };
  }

  it('a minimal scan-line file: header, offsets, float channels in alphabetical order, linear values', () => {
    const sum = new Float32Array([2, 4, 6, 2, 1, 1, 1, 1, 0, 0, 0, 0, 8, 0.5, 0.25, 2]);
    const data = linearRgba(sum, 2, 1);
    expect([...data.subarray(0, 4)]).toEqual([2, 4, 6, 1]);
    const exr = readExr(encodeExr({ width: 2, height: 2, data }, { alpha: true }));
    expect(exr.channels).toEqual(['A', 'B', 'G', 'R']);
    expect(Object.keys(exr.attrs).sort()).toEqual(['channels', 'compression', 'dataWindow', 'displayWindow', 'lineOrder', 'pixelAspectRatio', 'screenWindowCenter', 'screenWindowWidth']);
    expect(exr.attrs.compression[0]).toBe(0);
    expect(exr.pixels.R).toEqual([2, 1, 0, 8]);
    expect(exr.pixels.G).toEqual([4, 1, 0, 0.5]);
    expect(exr.pixels.B).toEqual([6, 1, 0, 0.25]);
    expect(exr.pixels.A).toEqual([1, 0.5, 0, 1]);
    expect(readExr(encodeExr({ width: 2, height: 2, data }, { alpha: false })).channels).toEqual(['B', 'G', 'R']);
  });
});
