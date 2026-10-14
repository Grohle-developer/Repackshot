// Phase U12, TIFF and DNG output. The encoders of src/io/image.ts against (1) a minimal reader written here from
// the specification (header, directory, offsets, values), (2) the golden files in tests/fixtures/tiff/, which the
// engine's encoders write byte for byte too (engine/crates/rt-cli/tests/tiff_golden.rs): the browser and the
// engine produce the same files; (3) the DNG 1.4 tags and the colour matrix, and the way the files travel through the
// render settings and the results history.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { bitDepthsOf, defaultRenderSettings, formatExtension, migrateRender, needsDisplayCopy, needsLinearSums, patchSettings, supportsAlpha, WRITABLE_FORMATS } from '../src/core/render';
import { evictionPlan, type ResultMeta } from '../src/core/results';
import { DNG_COLOR_MATRIX, DNG_MATRIX_DENOMINATOR, encodeDng, encodeTiff } from '../src/io/image';
import { launcherResultsStore, memoryResultsStore, type LauncherResultsApi } from '../src/io/results';
import { previewOf } from '../src/ui/panels/results-viewer';
import { straightLinear, straightLinearRgba, linearRgba, exactWords16 } from '../src/render/tiles';

// ------------------------------------------------------------------ the 4×4 image of the golden files

const P = 16;
/** Sample `c` of pixel `p`, RGBA: the same formulas as the engine's test (tiff_golden.rs). */
const bytes = () => Uint8Array.from({ length: P * 4 }, (_, i) => (Math.floor(i / 4) * 17 + (i % 4) * 5) & 255);
const words = () => Uint16Array.from({ length: P * 4 }, (_, i) => (Math.floor(i / 4) * 4099 + (i % 4) * 1021) & 0xffff);
/** Dyadic fractions: exact in f32. */
const floats = () => Float32Array.from({ length: P * 4 }, (_, i) => (Math.floor(i / 4) * 7 + (i % 4) * 13) / 64);

type Variant = { name: string; bits: 8 | 16 | 32; alpha: boolean; dpi: number };
const VARIANTS: Variant[] = [
  { name: 'rgb8.tif', bits: 8, alpha: false, dpi: 72 },
  { name: 'rgba8.tif', bits: 8, alpha: true, dpi: 72 },
  { name: 'rgb16.tif', bits: 16, alpha: false, dpi: 72 },
  { name: 'rgba16-300dpi.tif', bits: 16, alpha: true, dpi: 300 },
  { name: 'rgb32.tif', bits: 32, alpha: false, dpi: 72 },
  { name: 'rgba32.tif', bits: 32, alpha: true, dpi: 72 },
];
const dataOf = (bits: 8 | 16 | 32) => (bits === 8 ? bytes() : bits === 16 ? words() : floats());
const tiffOf = (v: Variant) => encodeTiff({ width: 4, height: 4, data: dataOf(v.bits) }, { bits: v.bits, alpha: v.alpha, dpi: v.dpi });
const golden = (name: string) => new Uint8Array(readFileSync(`tests/fixtures/tiff/${name}`));
/** The index of the first byte that differs, or -1 (both the same length). */
const firstDifference = (a: Uint8Array, b: Uint8Array): number => a.findIndex((v, i) => v !== b[i]);

// ------------------------------------------------------------------ a reader, from the specification

interface Field {
  type: number;
  count: number;
  bytes: Uint8Array;
}
interface Parsed {
  tags: number[];
  fields: Map<number, Field>;
  pixels: Uint8Array;
  /** The directory's value/offset slots, to check what sits inside an entry. */
  get(tag: number): Field;
  longs(tag: number): number[];
  shorts(tag: number): number[];
  fractions(tag: number): [number, number][];
}

const SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 10: 8 };

function parse(file: Uint8Array): Parsed {
  const dv = new DataView(file.buffer, file.byteOffset, file.byteLength);
  expect([...file.subarray(0, 4)], 'little-endian header').toEqual([0x49, 0x49, 42, 0]);
  const ifd = dv.getUint32(4, true);
  expect(ifd).toBe(8);
  const n = dv.getUint16(ifd, true);
  const tags: number[] = [];
  const fields = new Map<number, Field>();
  const spans: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const e = ifd + 2 + 12 * i;
    const tag = dv.getUint16(e, true);
    const type = dv.getUint16(e + 2, true);
    const count = dv.getUint32(e + 4, true);
    const len = SIZE[type] * count;
    let value: Uint8Array;
    if (len <= 4) {
      value = file.slice(e + 8, e + 8 + len);
      // The slot is zero-padded after the value.
      expect([...file.subarray(e + 8 + len, e + 12)].every((b) => b === 0), `tag ${tag}: padding`).toBe(true);
    } else {
      const at = dv.getUint32(e + 8, true);
      expect(at % 2, `tag ${tag}: even offset`).toBe(0);
      spans.push([at, at + len]);
      value = file.slice(at, at + len);
    }
    expect(fields.has(tag), `tag ${tag} twice`).toBe(false);
    tags.push(tag);
    fields.set(tag, { type, count, bytes: value });
  }
  expect(tags, 'tags sorted').toEqual([...tags].sort((a, b) => a - b));
  expect(dv.getUint32(ifd + 2 + 12 * n, true), 'one directory').toBe(0);
  let end = ifd + 2 + 12 * n + 4;
  for (const [from, to] of spans) {
    expect(from, 'out-of-line values packed in entry order').toBe(end);
    end = to + (to & 1);
  }
  const view = (f: Field) => new DataView(f.bytes.buffer, f.bytes.byteOffset, f.bytes.byteLength);
  const longsOf = (f: Field) => Array.from({ length: f.count }, (_, i) => view(f).getUint32(i * 4, true));
  const strips = longsOf(fields.get(273)!);
  const counts = longsOf(fields.get(279)!);
  const parts: Uint8Array[] = [];
  let expected = end;
  strips.forEach((off, i) => {
    expect(off, 'strips follow one another').toBe(expected);
    parts.push(file.subarray(off, off + counts[i]));
    expected = off + counts[i];
  });
  expect(expected, 'no bytes after the last strip').toBe(file.length);
  const pixels = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of parts) {
    pixels.set(p, o);
    o += p.length;
  }
  const get = (tag: number) => {
    const f = fields.get(tag);
    if (!f) throw new Error(`tag ${tag} is missing`);
    return f;
  };
  return {
    tags,
    fields,
    pixels,
    get,
    longs: (tag) => longsOf(get(tag)),
    shorts: (tag) => Array.from({ length: get(tag).count }, (_, i) => view(get(tag)).getUint16(i * 2, true)),
    fractions: (tag) => {
      const f = get(tag);
      const signed = f.type === 10;
      return Array.from({ length: f.count }, (_, i) => [signed ? view(f).getInt32(i * 8, true) : view(f).getUint32(i * 8, true), signed ? view(f).getInt32(i * 8 + 4, true) : view(f).getUint32(i * 8 + 4, true)] as [number, number]);
    },
  };
}

const text = (f: Field) => {
  expect(f.type).toBe(2);
  expect(f.bytes.at(-1), 'ASCII ends in NUL').toBe(0);
  return String.fromCharCode(...f.bytes.subarray(0, -1));
};

// ------------------------------------------------------------------ TIFF

describe('encodeTiff reads back as the specification says', () => {
  for (const v of VARIANTS) {
    it(`${v.name}: tags, offsets and every sample`, () => {
      const t = parse(tiffOf(v));
      const channels = v.alpha ? 4 : 3;
      expect(t.longs(256)).toEqual([4]);
      expect(t.longs(257)).toEqual([4]);
      expect(t.shorts(258)).toEqual(new Array(channels).fill(v.bits));
      expect(t.shorts(259), 'uncompressed').toEqual([1]);
      expect(t.shorts(262), 'RGB').toEqual([2]);
      expect(t.shorts(277)).toEqual([channels]);
      expect(t.shorts(284), 'chunky').toEqual([1]);
      expect(t.fractions(282)).toEqual([[v.dpi, 1]]);
      expect(t.fractions(283)).toEqual([[v.dpi, 1]]);
      expect(t.shorts(296), 'inches').toEqual([2]);
      // Alpha is the one extra sample, unassociated; floats say so.
      expect(t.fields.has(338)).toBe(v.alpha);
      if (v.alpha) expect(t.shorts(338)).toEqual([2]);
      expect(t.fields.has(339)).toBe(v.bits === 32);
      if (v.bits === 32) expect(t.shorts(339)).toEqual(new Array(channels).fill(3));
      // No colour profile, no DNG tags in a plain TIFF.
      expect(t.fields.has(34675)).toBe(false);
      expect(t.tags.every((tag) => tag < 50000)).toBe(true);

      // The samples, in order, little-endian.
      const src = dataOf(v.bits);
      const pv = new DataView(t.pixels.buffer, t.pixels.byteOffset, t.pixels.byteLength);
      const size = v.bits / 8;
      expect(t.pixels.length).toBe(P * channels * size);
      for (let p = 0; p < P; p++) {
        for (let c = 0; c < channels; c++) {
          const at = (p * channels + c) * size;
          const got = v.bits === 8 ? t.pixels[at] : v.bits === 16 ? pv.getUint16(at, true) : pv.getFloat32(at, true);
          expect(got, `pixel ${p} sample ${c}`).toBe(src[p * 4 + c]);
        }
      }
    });
  }

  it('one strip of four rows holds a 4×4 image, and the directory points at it', () => {
    const t = parse(tiffOf(VARIANTS[0]));
    expect(t.longs(278)).toEqual([4]);
    expect(t.longs(279)).toEqual([48]);
  });

  it('strips are about 8 KiB; the last one may be short', () => {
    // 100 × 3 bytes = 300 a row: 27 rows fit in 8192; 70 rows make 3 strips.
    const px = new Uint8Array(100 * 70 * 4).fill(7);
    const t = parse(encodeTiff({ width: 100, height: 70, data: px }, { bits: 8, alpha: false }));
    expect(t.longs(278)).toEqual([27]);
    expect(t.longs(279)).toEqual([8100, 8100, 4800]);
    expect(t.longs(273)).toHaveLength(3);
    expect(t.pixels).toHaveLength(100 * 70 * 3);
    // A row longer than the target still gets one row a strip.
    const wide = parse(encodeTiff({ width: 3000, height: 2, data: new Float32Array(3000 * 2 * 4) }, { bits: 32, alpha: false }));
    expect(wide.longs(278)).toEqual([1]);
    expect(wide.longs(273)).toHaveLength(2);
  });

  it('the resolution is 72 dpi unless the render says otherwise, and never below 1', () => {
    const resolution = (dpi?: number) => parse(encodeTiff({ width: 4, height: 4, data: bytes() }, { bits: 8, alpha: false, ...(dpi === undefined ? {} : { dpi }) })).fractions(282);
    expect(resolution()).toEqual([[72, 1]]);
    expect(resolution(300)).toEqual([[300, 1]]);
    expect(resolution(299.6)).toEqual([[300, 1]]);
    expect(resolution(0)).toEqual([[1, 1]]);
  });

  it('keeps highlights beyond 1, negatives and the float bits in the 32-bit file', () => {
    const data = floats();
    data.set([123.5, -0.25, 1e-40, 65504], 0);
    const t = parse(encodeTiff({ width: 4, height: 4, data }, { bits: 32, alpha: true }));
    const dv = new DataView(t.pixels.buffer, t.pixels.byteOffset, t.pixels.byteLength);
    expect([0, 1, 2, 3].map((i) => dv.getFloat32(i * 4, true))).toEqual([123.5, -0.25, Math.fround(1e-40), 65504]);
  });

  it('refuses what it cannot write truthfully', () => {
    const ok = { width: 4, height: 4 };
    expect(() => encodeTiff({ ...ok, data: words() }, { bits: 8, alpha: false })).toThrow(/8-bit/);
    expect(() => encodeTiff({ ...ok, data: bytes() }, { bits: 16, alpha: false })).toThrow(/16-bit/);
    expect(() => encodeTiff({ ...ok, data: bytes() }, { bits: 32, alpha: false })).toThrow(/32-bit/);
    expect(() => encodeTiff({ width: 4, height: 4, data: new Uint8Array(10) }, { bits: 8, alpha: false })).toThrow(/does not match/);
    expect(() => encodeTiff({ width: 0, height: 4, data: new Uint8Array(0) }, { bits: 8, alpha: false })).toThrow(/positive/);
  });
});

describe('the files are the engine’s, byte for byte', () => {
  for (const v of VARIANTS) {
    it(`${v.name} is what rt_core::tiff writes`, () => {
      const mine = tiffOf(v);
      const theirs = golden(v.name);
      expect(mine.length, 'length').toBe(theirs.length);
      expect(firstDifference(mine, theirs), 'first differing byte (REPACK_WRITE_GOLDEN=1 cargo test -p rt-cli --test tiff_golden rewrites the golden files)').toBe(-1);
    });
  }

  it('strips.tif, an image of two strips, is what rt_core::tiff writes (the offsets of every strip)', () => {
    const px = new Uint8Array(50 * 60 * 4);
    for (let y = 0; y < 60; y++) for (let x = 0; x < 50; x++) for (let c = 0; c < 3; c++) px[(y * 50 + x) * 4 + c] = (x * 5 + y * 3 + c * 7) & 255;
    const mine = encodeTiff({ width: 50, height: 60, data: px }, { bits: 8, alpha: false });
    const t = parse(mine);
    expect(t.longs(278)).toEqual([54]);
    expect(t.longs(279)).toEqual([8100, 900]);
    const theirs = golden('strips.tif');
    expect(mine.length, 'length').toBe(theirs.length);
    expect(firstDifference(mine, theirs), 'first differing byte').toBe(-1);
  });

  it('linear.dng is what rt_core::dng writes', () => {
    const mine = encodeDng({ width: 4, height: 4, data: floats() });
    const theirs = golden('linear.dng');
    expect(mine.length, 'length').toBe(theirs.length);
    expect(firstDifference(mine, theirs), 'first differing byte').toBe(-1);
  });
});

// ------------------------------------------------------------------ DNG

describe('encodeDng', () => {
  const dng = () => parse(encodeDng({ width: 4, height: 4, data: floats() }));

  it('is a LinearRaw TIFF of three 32-bit float samples, without alpha', () => {
    const t = dng();
    expect(t.longs(254), 'NewSubFileType: the main image').toEqual([0]);
    expect(t.longs(256)).toEqual([4]);
    expect(t.longs(257)).toEqual([4]);
    expect(t.shorts(258)).toEqual([32, 32, 32]);
    expect(t.shorts(259)).toEqual([1]);
    expect(t.shorts(262), 'LinearRaw').toEqual([34892]);
    expect(t.shorts(277)).toEqual([3]);
    expect(t.shorts(284)).toEqual([1]);
    expect(t.shorts(339), 'IEEE float').toEqual([3, 3, 3]);
    expect(t.fields.has(338), 'a raw has no alpha').toBe(false);
    // The pixels are the first three samples of every RGBA pixel.
    const dv = new DataView(t.pixels.buffer, t.pixels.byteOffset, t.pixels.byteLength);
    const src = floats();
    expect(t.pixels.length).toBe(P * 3 * 4);
    for (let p = 0; p < P; p++) for (let c = 0; c < 3; c++) expect(dv.getFloat32((p * 3 + c) * 4, true)).toBe(src[p * 4 + c]);
  });

  it('has the tags DNG 1.4 asks for of a colour raw, with the right types', () => {
    const t = dng();
    expect([...t.get(50706).bytes], 'DNGVersion').toEqual([1, 4, 0, 0]);
    expect(t.get(50706).type).toBe(1);
    expect([...t.get(50707).bytes], 'DNGBackwardVersion').toEqual([1, 4, 0, 0]);
    expect(text(t.get(50708)), 'UniqueCameraModel').toBe('Repackshot');
    expect(text(t.get(271)), 'Make').toBe('Repackshot');
    expect(text(t.get(272)), 'Model').toBe('Repackshot');
    expect(t.shorts(50778), 'CalibrationIlluminant1: D65').toEqual([21]);
    expect(t.get(50721).type, 'ColorMatrix1: SRATIONAL').toBe(10);
    expect(t.get(50721).count).toBe(9);
    expect(t.fractions(50728), 'AsShotNeutral').toEqual([[1, 1], [1, 1], [1, 1]]);
    expect(t.get(50728).type, 'RATIONAL').toBe(5);
    expect(t.fractions(50730), 'BaselineExposure').toEqual([[0, 1]]);
    expect(t.get(50730).type, 'SRATIONAL').toBe(10);
    expect(t.longs(50717), 'WhiteLevel: the white of the render, 1.0').toEqual([1]);
    // The DNG tags come after the TIFF ones.
    expect(t.tags.at(-1)).toBe(50778);
  });

  it('ColorMatrix1 is the inverse of sRGB to XYZ: the product is the identity to 1e-6', () => {
    // sRGB to XYZ from the primaries and the D65 white point, derived here (f64) and not read from the encoder.
    const xyz = (x: number, y: number) => [x / y, 1, (1 - x - y) / y];
    const prim = [xyz(0.64, 0.33), xyz(0.3, 0.6), xyz(0.15, 0.06)];
    const white = xyz(0.3127, 0.329);
    const cols = [0, 1, 2].map((r) => [prim[0][r], prim[1][r], prim[2][r]]);
    const det = (m: number[][]) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
    const d = det(cols);
    const scale = [0, 1, 2].map((k) => det(cols.map((row, r) => row.map((v, c) => (c === k ? white[r] : v)))) / d);
    const rgbToXyz = cols.map((row) => row.map((v, c) => v * scale[c]));

    const t = dng();
    const m = t.fractions(50721).map(([n, den]) => n / den);
    expect(DNG_COLOR_MATRIX.map((n) => n / DNG_MATRIX_DENOMINATOR)).toEqual(m);
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        const product = [0, 1, 2].reduce((acc, k) => acc + m[r * 3 + k] * rgbToXyz[k][c], 0);
        expect(Math.abs(product - (r === c ? 1 : 0)), `(${r},${c})`).toBeLessThan(1e-6);
      }
    }
    // The D65 white (XYZ) is equal channels in the camera space, which is what AsShotNeutral 1 1 1 says.
    for (let r = 0; r < 3; r++) expect(Math.abs([0, 1, 2].reduce((acc, k) => acc + m[r * 3 + k] * white[k], 0) - 1)).toBeLessThan(1e-6);
  });

  it('keeps the whole latitude of the render: nothing is clipped to the white level', () => {
    const data = floats();
    data.set([5000, -0.5], 0);
    const t = parse(encodeDng({ width: 4, height: 4, data }));
    const dv = new DataView(t.pixels.buffer, t.pixels.byteOffset, t.pixels.byteLength);
    expect([dv.getFloat32(0, true), dv.getFloat32(4, true)]).toEqual([5000, -0.5]);
  });
});

// ------------------------------------------------------------------ the render settings

describe('the render window’s settings for TIFF and DNG', () => {
  const set = (patch: Parameters<typeof patchSettings>[1], from = defaultRenderSettings()) => patchSettings(from, patch);

  it('offers the formats, their extensions and who has alpha', () => {
    expect([...WRITABLE_FORMATS].sort()).toEqual(['DNG', 'EXR', 'JPEG', 'PNG', 'TIFF']);
    expect([formatExtension('PNG'), formatExtension('JPEG'), formatExtension('EXR'), formatExtension('TIFF'), formatExtension('DNG')]).toEqual(['png', 'jpg', 'exr', 'tif', 'dng']);
    expect(['PNG', 'JPEG', 'EXR', 'TIFF', 'DNG'].map((f) => supportsAlpha(f as 'PNG'))).toEqual([true, false, true, true, false]);
  });

  it('a DNG has no alpha: transparency is switched off', () => {
    const s = set({ format: 'DNG', transparent: true });
    expect(s.format).toBe('DNG');
    expect(s.transparent).toBe(false);
    // Typed again once it is a DNG: still off. A TIFF keeps it.
    expect(set({ transparent: true }, s).transparent).toBe(false);
    expect(set({ format: 'TIFF', transparent: true }).transparent).toBe(true);
  });

  it('32 bits belong to the TIFF alone; PNG has 8 and 16, TIFF 8, 16 and 32', () => {
    expect(set({ format: 'PNG', bitDepth: 32 }).bitDepth).toBe(8);
    expect(set({ format: 'PNG', bitDepth: 16 }).bitDepth).toBe(16);
    expect(set({ format: 'TIFF', bitDepth: 32 }).bitDepth).toBe(32);
    expect(set({ format: 'TIFF', bitDepth: 16 }).bitDepth).toBe(16);
    expect(set({ format: 'TIFF', bitDepth: 8 }).bitDepth).toBe(8);
    for (const format of ['JPEG', 'EXR', 'DNG'] as const) {
      expect(set({ format, bitDepth: 32 }).bitDepth, format).toBe(8);
      expect(set({ format, bitDepth: 16 }).bitDepth, format).toBe(8);
    }
    expect(bitDepthsOf('PNG')).toEqual([8, 16]);
    expect(bitDepthsOf('TIFF')).toEqual([8, 16, 32]);
    expect(bitDepthsOf('DNG')).toEqual([8]);
  });

  it('leaving the TIFF takes a 32-bit setting with it, and going back finds the default', () => {
    let s = set({ format: 'TIFF', bitDepth: 32 });
    s = set({ format: 'PNG' }, s);
    expect(s.bitDepth).toBe(8);
    expect(set({ format: 'TIFF' }, s).bitDepth).toBe(8);
  });

  it('an unknown format falls back to PNG; the known ones load', () => {
    expect(set({ format: 'BMP' as 'PNG' }).format).toBe('PNG');
    for (const f of ['TIFF', 'DNG'] as const) expect(set({ format: f }).format).toBe(f);
  });

  it('a saved project loads: TIFF and DNG come back as they were, an older one as before, a format of the future as PNG', () => {
    const pick = (raw: unknown) => {
      const r = migrateRender(raw);
      return [r.format, r.bitDepth, r.transparent];
    };
    expect(pick({ format: 'TIFF', bitDepth: 32, transparent: true })).toEqual(['TIFF', 32, true]);
    expect(pick({ format: 'TIFF', bitDepth: 16 })).toEqual(['TIFF', 16, false]);
    expect(pick({ format: 'DNG', bitDepth: 32, transparent: true })).toEqual(['DNG', 8, false]);
    // Before U12: PNG at 16 bits, EXR, and settings with no bit depth at all.
    expect(pick({ format: 'PNG', bitDepth: 16, transparent: true })).toEqual(['PNG', 16, true]);
    expect(pick({ format: 'EXR', transparent: true })).toEqual(['EXR', 8, true]);
    expect(pick({ format: 'JPEG' })).toEqual(['JPEG', 8, false]);
    // A format this version does not know, and 32 bits where there are none.
    expect(pick({ format: 'BMP', bitDepth: 32 })).toEqual(['PNG', 8, false]);
    expect(pick({ format: 'PNG', bitDepth: 32 })).toEqual(['PNG', 8, false]);
    // The jobs of the queue load the same way.
    const job = migrateRender({ queue: [{ id: 'j1', settings: { format: 'TIFF', bitDepth: 32, transparent: true } }] }).queue[0].settings;
    expect([job.format, job.bitDepth, job.transparent]).toEqual(['TIFF', 32, true]);
  });

  it('says which files are written from the linear sums and which a browser cannot show', () => {
    expect(needsLinearSums('EXR', 8)).toBe(true);
    expect(needsLinearSums('DNG', 8)).toBe(true);
    expect(needsLinearSums('TIFF', 32)).toBe(true);
    expect(needsLinearSums('TIFF', 16)).toBe(true);
    expect(needsLinearSums('TIFF', 8)).toBe(false);
    expect(needsLinearSums('PNG', 16)).toBe(true);
    expect(needsLinearSums('PNG', 8)).toBe(false);
    expect(needsLinearSums('JPEG', 8)).toBe(false);
    expect((['PNG', 'JPEG', 'EXR', 'TIFF', 'DNG'] as const).filter(needsDisplayCopy)).toEqual(['EXR', 'TIFF', 'DNG']);
  });
});

// ------------------------------------------------------------------ the linear data

describe('the linear light of a TIFF and a DNG', () => {
  // Two pixels summed over 2 samples: opaque, and a quarter covered.
  const sum = new Float32Array([2, 4, 6, 2, 0.5, 0.25, 0.125, 0.5]);

  it('is straight alpha: the colour is divided by its coverage, where EXR keeps it premultiplied', () => {
    const straight = straightLinearRgba(sum, 2, 1);
    expect([...straight.subarray(0, 4)]).toEqual([2, 4, 6, 1]);
    // Mean (0.25, 0.125, 0.0625) with a coverage of 0.25: a straight colour of (1, 0.5, 0.25), times the exposure
    // gain (+1 stop: 2); the alpha is not exposed.
    expect([...straight.subarray(4, 8)]).toEqual([2, 1, 0.5, 0.25]);
    // EXR premultiplies: the colour stays as it was summed (times the same gain).
    expect([...linearRgba(sum, 2, 1).subarray(4, 8)]).toEqual([0.5, 0.25, 0.125, 0.25]);
    // A pixel with no coverage has no colour; exposure scales the colour and never the alpha.
    const edge = straightLinearRgba(new Float32Array([4, 4, 4, 0]), 1, 1);
    expect([...edge]).toEqual([0, 0, 0, 0]);
    expect(straightLinearRgba(new Float32Array([1, 2, 3, 1]), 1, 2)[3]).toBe(1);
    expect([...straightLinearRgba(new Float32Array([1, 2, 3, 1]), 1, 2).subarray(0, 3)]).toEqual([4, 8, 12]);
  });

  it('for opaque pixels is the EXR’s data, bit for bit', () => {
    const opaque = new Float32Array([3, 5, 7, 3, 0.2, 0.4, 0.6, 3]);
    expect([...straightLinearRgba(opaque, 3, 0.5)]).toEqual([...linearRgba(opaque, 3, 0.5)]);
  });

  it('a straight-alpha image only gets the exposure', () => {
    expect([...straightLinear(new Float32Array([0.5, 1, 2, 0.5]), 1)]).toEqual([1, 2, 4, 0.5]);
    expect(straightLinear(new Float32Array([1, 1, 1, 1]), 0)[3]).toBe(1);
  });

  it('the 16-bit words of the TIFF are the 16-bit PNG’s', () => {
    const w = exactWords16(sum, 2, 0, 0);
    expect(w).toHaveLength(8);
    expect(w[3]).toBe(65535);
  });
});

// ------------------------------------------------------------------ the results history

const meta = (id: string, format: ResultMeta['format'], bitDepth: ResultMeta['bitDepth'], name: string): ResultMeta => ({
  id,
  jobId: 'j1',
  name,
  createdAt: 1,
  width: 4,
  height: 4,
  dpi: 72,
  samples: 1,
  seconds: 0,
  cameraId: null,
  camera: 'Camera 1',
  format,
  bitDepth,
  savedTo: { kind: 'DOWNLOADS' },
  thumb: '',
  bytes: 0,
});

describe('the results viewer’s image of a TIFF and a DNG', () => {
  const png = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' });

  it('the history keeps the file as written and its 8-bit picture beside it, which is what the viewer decodes', async () => {
    const store = memoryResultsStore();
    const tiff = new Blob([encodeTiff({ width: 4, height: 4, data: floats() }, { bits: 32, alpha: false }) as Uint8Array<ArrayBuffer>], { type: 'image/tiff' });
    await store.add(meta('t', 'TIFF', 32, 'Shot.tif'), tiff, png);
    const got = await store.get('t');
    expect(got?.file.type).toBe('image/tiff');
    expect(got?.file.size).toBe(tiff.size);
    // The viewer decodes `previewOf`: the picture, not the TIFF a browser cannot decode.
    expect(previewOf(got!)).toBe(png);
    expect(previewOf(got!).type).toBe('image/png');
    // A result without a picture (a PNG, a JPEG) is shown from its own file.
    expect(previewOf({ file: tiff, display: null })).toBe(tiff);
  });

  it('the desktop history fetches the picture for TIFF and DNG, as it does for EXR, and for no other format', async () => {
    const asked: string[] = [];
    const api: LauncherResultsApi = {
      results: async () => [meta('t', 'TIFF', 32, 'a.tif'), meta('d', 'DNG', 8, 'b.dng'), meta('e', 'EXR', 8, 'c.exr'), meta('p', 'PNG', 16, 'd.png')],
      putResult: async () => undefined,
      resultFile: async (id, part) => {
        asked.push(`${id}${part === true ? ':display' : ''}`);
        return part === true ? png : new Blob(['x'], { type: 'application/octet-stream' });
      },
      deleteResult: async () => undefined,
      clearResults: async () => undefined,
    };
    const store = launcherResultsStore(api);
    const pictures: Record<string, boolean> = {};
    for (const id of ['t', 'd', 'e', 'p']) pictures[id] = (await store.get(id))?.display === png;
    expect(pictures).toEqual({ t: true, d: true, e: true, p: false });
    expect(asked.filter((a) => a.endsWith(':display')).sort()).toEqual(['d:display', 'e:display', 't:display']);
  });

  it('a TIFF or a DNG result is evicted like any other', () => {
    const list = [meta('a', 'TIFF', 32, 'a.tif'), meta('b', 'DNG', 8, 'b.dng')].map((m, i) => ({ ...m, createdAt: i, bytes: 100 }));
    expect(evictionPlan(list, { count: 1, bytes: 1000 })).toEqual(['a']);
  });
});
