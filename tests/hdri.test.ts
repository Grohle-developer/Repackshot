// Environment images (phase E5): the interface's readers of Radiance HDR and OpenEXR files
// (src/io/hdri.ts) against the fixtures the engine's readers are tested with, against three.js's
// own loaders (an independent reader of both formats), and the loading into the image registry.

import { readFileSync } from 'node:fs';
import { FloatType } from 'three';
import { EXRLoader } from 'three/examples/jsm/loaders/EXRLoader.js';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { describe, expect, it } from 'vitest';
import { getImage, imageFormatOf, unregisterImage } from '../src/core/images';
import { decodeExr, decodeHdr, exrHeader, ImageFileError, loadBackplate, loadHdri, previewPixels } from '../src/io/hdri';

const fixture = (name: string) => new Uint8Array(readFileSync(`tests/fixtures/${name}`));
const buffer = (b: Uint8Array) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

/** The pattern of tools/exr-fixtures.mjs (and of rt-core's exr tests), exact in half floats. */
const pattern = (x: number, y: number) => [((x * 3 + y) % 64) / 16, (y % 32) / 32, ((x ^ y) % 16) / 8];

describe('OpenEXR reader', () => {
  for (const name of ['exr-zip-half.exr', 'exr-zips-float.exr', 'exr-rle-half.exr']) {
    it(`decodes ${name} to its pattern, like three.js's EXRLoader`, async () => {
      const bytes = fixture(name);
      const img = await decodeExr(bytes);
      expect([img.width, img.height]).toEqual([40, 37]);
      const loader = new EXRLoader();
      loader.setDataType(FloatType);
      const three = loader.parse(buffer(bytes)) as unknown as { width: number; height: number; data: Float32Array };
      expect([three.width, three.height]).toEqual([40, 37]);
      for (let y = 0; y < 37; y++) {
        for (let x = 0; x < 40; x++) {
          const i = 3 * (y * 40 + x);
          expect([img.rgb[i], img.rgb[i + 1], img.rgb[i + 2]]).toEqual(pattern(x, y));
          // three.js stores the rows bottom up, RGBA.
          const j = 4 * ((36 - y) * 40 + x);
          expect([three.data[j], three.data[j + 1], three.data[j + 2]]).toEqual(pattern(x, y));
        }
      }
    });
  }

  it('refuses what the engine cannot read, naming it', () => {
    const good = fixture('exr-zip-half.exr');
    const tiled = good.slice();
    tiled[5] |= 0x02;
    expect(() => exrHeader(tiled)).toThrow(/tiled/);
    const at = String.fromCharCode(...good).indexOf('compression\0compression\0') + 24 + 4;
    const piz = good.slice();
    piz[at] = 4;
    expect(() => exrHeader(piz)).toThrow(/PIZ/);
    try {
      exrHeader(piz);
    } catch (err) {
      expect((err as ImageFileError).code).toBe('UNSUPPORTED');
    }
    expect(() => exrHeader(new Uint8Array(20))).toThrow(ImageFileError);
  });
});

describe('Radiance HDR reader', () => {
  const studio = fixture('studio.hdr');

  it('decodes the studio HDRI the engine writes (`rt --write-studio-hdri`), like three.js', () => {
    const img = decodeHdr(studio);
    expect([img.width, img.height]).toEqual([1024, 512]);
    const three = new HDRLoader().setDataType(FloatType).parse(buffer(studio)) as unknown as { width: number; height: number; data: Float32Array };
    expect([three.width, three.height]).toEqual([1024, 512]);
    // three.js rounds RGBE to the middle of each mantissa step ((m + ½) · 2^(e - 136)), the engine and this
    // reader to its bottom (m · 2^(e - 136), the exact inverse of their writer): within half a step of 128.
    // Rows are top down in both.
    let worst = 0;
    for (let i = 0, j = 0; i < img.rgb.length; i += 3, j += 4) {
      for (let k = 0; k < 3; k++) {
        if (three.data[j + k] === 0) expect(img.rgb[i + k]).toBe(0);
        else worst = Math.max(worst, Math.abs(img.rgb[i + k] - three.data[j + k]) / three.data[j + k]);
      }
    }
    expect(worst).toBeLessThan(0.5 / 128 + 1e-6);
    // The key soft box: 40 degrees from +X towards +Y, 25 up (u = ½ - 40/360, v = 65/180).
    const x = Math.floor((0.5 - 40 / 360) * 1024);
    const y = Math.floor((65 / 180) * 512);
    expect(img.rgb[3 * (y * 1024 + x)]).toBeGreaterThan(10);
    // Straight down: the dark floor of the cyclorama.
    expect(img.rgb[3 * (511 * 1024)]).toBeLessThan(0.03);
  });

  it('reads flat and old run-length scanlines and bottom-up files, and fails cleanly when cut', () => {
    const text = '#?RGBE\nEXPOSURE=2\n\n+Y 2 +X 3\n';
    const bytes = new Uint8Array([...new TextEncoder().encode(text), 128, 128, 128, 129, 1, 1, 1, 2, 128, 0, 0, 129, 0, 128, 0, 129, 0, 0, 128, 129]);
    const img = decodeHdr(bytes);
    expect(Array.from(img.rgb.subarray(0, 9))).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    expect(Array.from(img.rgb.subarray(9))).toEqual(new Array(9).fill(1));
    for (const cut of [10, 40, 1000, studio.length - 1]) expect(() => decodeHdr(studio.subarray(0, cut))).toThrow(ImageFileError);
    expect(() => decodeHdr(new TextEncoder().encode('P6\n'))).toThrow(/Radiance/);
  });

  it('keeps a smaller copy for the preview, averaged in 2 x 2 boxes', () => {
    const img = { width: 5, height: 2, rgb: new Float32Array(30).map((_, i) => (i % 3 === 0 ? i : -1)) };
    const small = previewPixels(img, 3);
    expect([small.width, small.height]).toEqual([3, 1]);
    // Negative values count as zero; the odd last column is averaged with itself.
    expect(small.rgb[0]).toBeCloseTo((0 + 3 + 15 + 18) / 4, 6);
    expect(small.rgb[1]).toBe(0);
    expect(small.rgb[6]).toBeCloseTo((12 + 12 + 27 + 27) / 4, 6);
  });
});

describe('loading environment images', () => {
  it('an HDRI keeps its file for the engine and a preview copy', async () => {
    const ref = await loadHdri('studio.hdr', fixture('studio.hdr'), 'hdri:t1');
    expect(ref).toEqual({ id: 'hdri:t1', name: 'studio.hdr', width: 1024, height: 512 });
    const data = getImage('hdri:t1')!;
    expect(data.format).toBe('HDR');
    expect(data.bytes.length).toBe(fixture('studio.hdr').length);
    expect([data.previewWidth, data.previewHeight]).toEqual([1024, 512]);
    expect(data.linear!.length).toBe(3 * 1024 * 512);
    const exr = await loadHdri('pattern.EXR', fixture('exr-zip-half.exr'), 'hdri:t2');
    expect([exr.width, exr.height]).toEqual([40, 37]);
    await expect(loadHdri('photo.png', new Uint8Array(4))).rejects.toThrow(ImageFileError);
    await expect(loadHdri('broken.hdr', new TextEncoder().encode('#?RADIANCE\n'))).rejects.toThrow(ImageFileError);
    unregisterImage('hdri:t1');
    unregisterImage('hdri:t2');
  });

  it('a background image is decoded to RGBA by the decoder it is given', async () => {
    const decode = async () => ({ width: 2, height: 1, rgba: new Uint8Array([1, 2, 3, 255, 4, 5, 6, 255]) });
    const ref = await loadBackplate('plate.JPG', new Uint8Array([0xff, 0xd8]), decode, 'plate:t1');
    expect(ref).toEqual({ id: 'plate:t1', name: 'plate.JPG', width: 2, height: 1 });
    expect(Array.from(getImage('plate:t1')!.rgba8!)).toEqual([1, 2, 3, 255, 4, 5, 6, 255]);
    await expect(loadBackplate('x.hdr', new Uint8Array(1), decode)).rejects.toThrow(ImageFileError);
    await expect(loadBackplate('x.png', new Uint8Array(1), async () => Promise.reject(new Error('bad')))).rejects.toMatchObject({ code: 'DAMAGED' });
    unregisterImage('plate:t1');
    expect(imageFormatOf('a.exr')).toBe('EXR');
    expect(imageFormatOf('a.tiff')).toBeNull();
  });
});
