// The pass files (phase N2): the numbers a pass becomes (core/pass-files.ts), the bytes of the files (io/passes.ts,
// io/image.ts encodePngWords and encodeExrPlanes), and their names. The PNGs are read back by node's zlib and the
// EXRs by three.js's EXRLoader (an independent reader), so a header, a checksum or a channel that is off shows.

import { inflateSync } from 'node:zlib';
import { EXRLoader } from 'three/examples/jsm/loaders/EXRLoader.js';
import { describe, expect, it } from 'vitest';
import {
  alphaWords,
  depthNote,
  depthRange,
  depthWords,
  idFloats,
  idValue,
  idWords,
  legendFileName,
  normalisePasses,
  normalWords,
  NO_PASSES,
  partLegend,
  passFileName,
  passFileNames,
  PASS_OUTPUT_KEYS,
  type PassesOutput,
} from '../src/core/pass-files';
import { FLOOR_ID, PASS_KEYS, type RenderPasses } from '../src/core/passes';
import { crc32, encodeExrPlanes, encodePngWords } from '../src/io/image';
import { encodePassFile, encodePassFiles } from '../src/io/passes';

describe('what the window offers and how it is kept', () => {
  it('offers the four passes of the brief, each an engine pass, in this order', () => {
    expect(PASS_OUTPUT_KEYS).toEqual(['alpha', 'depth', 'normal', 'partId']);
    for (const k of PASS_OUTPUT_KEYS) expect(PASS_KEYS as readonly string[]).toContain(k);
    expect(NO_PASSES).toEqual({ keys: [], format: 'EXR' });
  });

  it('normalises anything that looks like the settings: known keys once, in order, an unknown format falls back; the same object when nothing changes', () => {
    expect(normalisePasses(undefined)).toBe(NO_PASSES);
    expect(normalisePasses('x')).toBe(NO_PASSES);
    expect(normalisePasses({})).toBe(NO_PASSES);
    const a = normalisePasses({ keys: ['partId', 'alpha', 'alpha', 'shadow', 7], format: 'PNG16' });
    expect(a).toEqual({ keys: ['alpha', 'partId'], format: 'PNG16' });
    expect(normalisePasses(a, a)).toBe(a);
    expect(normalisePasses({ keys: ['alpha', 'partId'], format: 'PNG16' }, a)).toBe(a);
    expect(normalisePasses({ keys: ['depth'], format: 'TIFF' }, a)).toEqual({ keys: ['depth'], format: 'PNG16' });
    expect(normalisePasses({ format: 'EXR' }, a)).toEqual({ keys: ['alpha', 'partId'], format: 'EXR' });
    const base: PassesOutput = { keys: ['depth'], format: 'EXR' };
    expect(normalisePasses({ keys: ['depth'] }, base)).toBe(base);
  });
});

describe('file names', () => {
  it('puts the pass before the extension of the image and takes the format’s extension', () => {
    expect(passFileName('Bottle_Camera 1_Studio A_0001.png', 'depth', 'EXR')).toBe('Bottle_Camera 1_Studio A_0001_depth.exr');
    expect(passFileName('Bottle_0001.jpg', 'alpha', 'PNG16')).toBe('Bottle_0001_alpha.png');
    expect(passFileName('Bottle.v2_0001.tif', 'normal', 'EXR')).toBe('Bottle.v2_0001_normal.exr');
    expect(passFileName('Bottle', 'partId', 'PNG16')).toBe('Bottle_partId.png');
    expect(passFileName('.hidden', 'depth', 'EXR')).toBe('.hidden_depth.exr');
    expect(passFileName('dir.d/Bottle', 'depth', 'EXR')).toBe('dir.d/Bottle_depth.exr');
    expect(legendFileName('Bottle_0001.png')).toBe('Bottle_0001_partId.json');
  });

  it('lists the files of a render: the passes in order, then the legend when the part ids are among them', () => {
    expect(passFileNames('A_0001.png', { keys: [], format: 'EXR' })).toEqual([]);
    expect(passFileNames('A_0001.png', { keys: ['alpha', 'depth'], format: 'EXR' })).toEqual(['A_0001_alpha.exr', 'A_0001_depth.exr']);
    expect(passFileNames('A_0001.png', { keys: ['normal', 'partId'], format: 'PNG16' })).toEqual(['A_0001_normal.png', 'A_0001_partId.png', 'A_0001_partId.json']);
  });
});

describe('the numbers of a pass', () => {
  it('alpha: 0 transparent, 65535 covered, rounded, clamped', () => {
    expect([...alphaWords(Float32Array.from([0, 1, 0.5, 0.25, 1.5, -1]))]).toEqual([0, 65535, 32768, 16384, 65535, 0]);
  });

  it('depth: 0 the background, 1 the farthest surface, 65535 the nearest, linear between; one depth is all 65535', () => {
    const d = Float32Array.from([Infinity, 10, 20, 15, 30, NaN]);
    expect(depthRange(d)).toEqual({ near: 10, far: 30 });
    expect([...depthWords(d)]).toEqual([0, 65535, 32768, 49152, 1, 0]);
    expect([...depthWords(Float32Array.from([5, 5, Infinity]))]).toEqual([65535, 65535, 0]);
    expect(depthRange(Float32Array.from([Infinity, Infinity]))).toBeNull();
    expect([...depthWords(Float32Array.from([Infinity, Infinity]))]).toEqual([0, 0]);
    // The nearest never shares a word with the background, the farthest never either.
    const words = depthWords(Float32Array.from([1e-3, 1e6, Infinity]));
    expect(words[0]).toBe(65535);
    expect(words[1]).toBe(1);
    expect(words[2]).toBe(0);
    expect(depthNote({ near: 10, far: 30 })).toContain('near=10 far=30');
    expect(depthNote(null)).toContain('background');
  });

  it('normal: n * 0.5 + 0.5 per channel; the background (0 0 0) is the middle grey', () => {
    expect([...normalWords(Float32Array.from([1, 0, -1, 0, 0, 0, 0.5, -0.5, 2]))]).toEqual([65535, 32768, 0, 32768, 32768, 32768, 49151, 16384, 65535]);
  });

  it('part id: 0 the background, the floor 65535, the ids as they are up to 65534 (the rest clamped and counted)', () => {
    const { words, clamped } = idWords(Uint32Array.from([0, 1, 7, FLOOR_ID, 65534, 65535, 70000, 4_000_000]));
    expect([...words]).toEqual([0, 1, 7, 65535, 65534, 65534, 65534, 65534]);
    expect(clamped).toBe(3);
    expect([...idFloats(Uint32Array.from([0, 3, FLOOR_ID, 100000]))]).toEqual([0, 3, 65535, 65534]);
    expect([idValue(0), idValue(FLOOR_ID), idValue(65535)]).toEqual([0, 65535, 65534]);
  });

  it('the legend says who each id is, as JSON', () => {
    const json = JSON.parse(partLegend([{ id: 1, part: 'Cap', material: 'Plastic' }, { id: 2, part: 'Body', material: null }]));
    expect(json).toEqual({ format: 'repackshot-part-ids', version: 1, background: 0, floor: 65535, parts: [{ id: 1, part: 'Cap', material: 'Plastic' }, { id: 2, part: 'Body', material: null }] });
  });
});

/** Reads back the PNGs encodePngWords writes: 16-bit grey or RGB, filter 0. */
function readPng(png: Uint8Array) {
  const v = new DataView(png.buffer, png.byteOffset, png.byteLength);
  expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  let o = 8;
  const chunks: { type: string; data: Uint8Array }[] = [];
  let crcOk = true;
  for (;;) {
    const len = v.getUint32(o);
    const type = String.fromCharCode(...png.subarray(o + 4, o + 8));
    crcOk &&= v.getUint32(o + 8 + len) === crc32(png, o + 4, o + 8 + len);
    chunks.push({ type, data: png.subarray(o + 8, o + 8 + len) });
    o += 12 + len;
    if (type === 'IEND') break;
  }
  const ihdr = new DataView(chunks[0].data.buffer, chunks[0].data.byteOffset, 13);
  const [width, height, depth, colour] = [ihdr.getUint32(0), ihdr.getUint32(4), chunks[0].data[8], chunks[0].data[9]];
  const channels = colour === 0 ? 1 : 3;
  const idat = chunks.filter((c) => c.type === 'IDAT');
  const all = new Uint8Array(idat.reduce((n, c) => n + c.data.length, 0));
  idat.reduce((p, c) => (all.set(c.data, p), p + c.data.length), 0);
  const raw = inflateSync(all);
  const words = new Uint16Array(width * height * channels);
  const row = width * channels * 2;
  for (let y = 0; y < height; y++) {
    expect(raw[y * (row + 1)]).toBe(0);
    for (let i = 0; i < width * channels; i++) words[y * width * channels + i] = (raw[y * (row + 1) + 1 + i * 2] << 8) | raw[y * (row + 1) + 2 + i * 2];
  }
  const text = chunks.filter((c) => c.type === 'tEXt').map((c) => new TextDecoder('latin1').decode(c.data).split('\0') as [string, string]);
  return { width, height, depth, colour, channels, words, crcOk, chunks: chunks.map((c) => c.type), text, phys: chunks.find((c) => c.type === 'pHYs')?.data };
}

describe('encodePngWords', () => {
  it('writes 16-bit grey with the words exactly, a valid CRC on every chunk, the density and the notes in order', async () => {
    const words = Uint16Array.from([0, 1, 255, 256, 65535, 32768]);
    const png = readPng(await encodePngWords(3, 2, 1, words, { dpi: 300, text: [['Depth range', 'near=1 far=2'], ['Note', 'é']] }));
    expect([png.width, png.height, png.depth, png.colour, png.crcOk]).toEqual([3, 2, 16, 0, true]);
    expect([...png.words]).toEqual([...words]);
    expect(png.chunks).toEqual(['IHDR', 'pHYs', 'tEXt', 'tEXt', 'IDAT', 'IEND']);
    expect(png.text).toEqual([['Depth range', 'near=1 far=2'], ['Note', 'é']]);
    expect(new DataView(png.phys!.buffer, png.phys!.byteOffset, 9).getUint32(0)).toBe(11811);
  });

  it('writes 16-bit RGB, three words a pixel; no density chunk without a DPI', async () => {
    const words = Uint16Array.from({ length: 4 * 3 * 3 }, (_, i) => (i * 5471) & 0xffff);
    const png = readPng(await encodePngWords(4, 3, 3, words));
    expect([png.colour, png.depth, png.channels, png.crcOk, png.chunks]).toEqual([2, 16, 3, true, ['IHDR', 'IDAT', 'IEND']]);
    expect([...png.words]).toEqual([...words]);
  });

  it('refuses a plane of the wrong size', async () => {
    await expect(encodePngWords(3, 2, 1, new Uint16Array(5))).rejects.toThrow(/needs 6 words/);
  });
});

/** The EXR through three.js: RGBA floats, the first row at the bottom. */
function readExr(bytes: Uint8Array) {
  const loader = new EXRLoader();
  loader.type = 1015; // FloatType
  const out = loader.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  return { width: out.width as number, height: out.height as number, rgba: out.data as Float32Array };
}

describe('encodeExrPlanes', () => {
  it('is read back by an independent reader, channel by channel, rows in order', () => {
    const [w, h] = [3, 2];
    const r = Float32Array.from([1, 2, 3, 4, 5, 6]);
    const g = Float32Array.from([0.5, 0.5, 0.5, 0.25, 0.25, 0.25]);
    const b = Float32Array.from([0, 0, 0, 0, 0, 7]);
    const back = readExr(encodeExrPlanes(w, h, [{ name: 'B', data: b }, { name: 'R', data: r }, { name: 'G', data: g }]));
    expect([back.width, back.height]).toEqual([3, 2]);
    // Three flips the rows (the first row of the file is the top, the first of its array the bottom).
    const px = (x: number, y: number) => [0, 1, 2].map((c) => back.rgba[(((h - 1 - y) * w) + x) * 4 + c]);
    expect(px(0, 0)).toEqual([1, 0.5, 0]);
    expect(px(2, 0)).toEqual([3, 0.5, 0]);
    expect(px(0, 1)).toEqual([4, 0.25, 0]);
    expect(px(2, 1)).toEqual([6, 0.25, 7]);
  });

  it('sorts the channels, keeps +Infinity, and refuses a repeated channel, a wrong size and no channel', () => {
    const bytes = encodeExrPlanes(2, 1, [{ name: 'Z', data: Float32Array.from([Infinity, 12.5]) }]);
    // The channel list is in the header: "Z" once.
    expect(new TextDecoder('latin1').decode(bytes.subarray(0, 200))).toContain('channels\0chlist');
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(dv.getFloat32(bytes.length - 8, true)).toBe(Infinity);
    expect(dv.getFloat32(bytes.length - 4, true)).toBe(12.5);
    expect(() => encodeExrPlanes(2, 1, [{ name: 'Z', data: new Float32Array(2) }, { name: 'Z', data: new Float32Array(2) }])).toThrow(/twice/);
    expect(() => encodeExrPlanes(2, 1, [{ name: 'Z', data: new Float32Array(3) }])).toThrow(/not 2 × 1/);
    expect(() => encodeExrPlanes(2, 1, [])).toThrow(/at least one/);
  });
});

describe('the files of a render’s passes', () => {
  const [W, H] = [4, 2];
  const passes: RenderPasses = {
    width: W,
    height: H,
    alpha: Float32Array.from([0, 0.5, 1, 1, 1, 1, 0.25, 0]),
    depth: Float32Array.from([Infinity, 40, 30, 20, 10, 20, 30, Infinity]),
    normal: Float32Array.from({ length: W * H * 3 }, (_, i) => (i % 3 === 2 ? 1 : 0)),
    partId: Uint32Array.from([0, 1, 1, 2, 2, FLOOR_ID, FLOOR_ID, 0]),
  };
  const ctx = { imageName: 'Bottle_Camera 1_0001.png', dpi: 150 };

  it('PNG16: a grey file per scalar pass and an RGB one for the normals, named from the image', async () => {
    const out: PassesOutput = { keys: ['alpha', 'depth', 'normal', 'partId'], format: 'PNG16' };
    const files = await encodePassFiles(passes, out, { ...ctx, legend: [{ id: 1, part: 'Cap', material: 'Plastic' }, { id: 2, part: 'Body', material: 'Glass' }] });
    expect(files.map((f) => [f.key, f.name])).toEqual([
      ['alpha', 'Bottle_Camera 1_0001_alpha.png'],
      ['depth', 'Bottle_Camera 1_0001_depth.png'],
      ['normal', 'Bottle_Camera 1_0001_normal.png'],
      ['partId', 'Bottle_Camera 1_0001_partId.png'],
      ['legend', 'Bottle_Camera 1_0001_partId.json'],
    ]);
    const read = async (i: number) => readPng(new Uint8Array(await files[i].blob.arrayBuffer()));
    const alpha = await read(0);
    expect([alpha.colour, alpha.depth, alpha.crcOk, [...alpha.words]]).toEqual([0, 16, true, [0, 32768, 65535, 65535, 65535, 65535, 16384, 0]]);
    const depth = await read(1);
    expect([...depth.words]).toEqual([0, 1, 21846, 43690, 65535, 43690, 21846, 0]);
    expect(depth.text).toEqual([['Depth range', depthNote({ near: 10, far: 40 })]]);
    const normal = await read(2);
    expect([normal.colour, normal.channels, [...normal.words.subarray(0, 3)]]).toEqual([2, 3, [32768, 32768, 65535]]);
    const ids = await read(3);
    expect([...ids.words]).toEqual([0, 1, 1, 2, 2, 65535, 65535, 0]);
    expect(ids.phys).toBeDefined();
    expect(files[0].blob.type).toBe('image/png');
    expect(JSON.parse(await files[4].blob.text()).parts).toHaveLength(2);
  });

  it('EXR: alpha as A, depth as Z with +Infinity on the background, normals as R G B, ids as Y; no legend without parts to name', async () => {
    const out: PassesOutput = { keys: ['alpha', 'depth', 'normal', 'partId'], format: 'EXR' };
    const files = await encodePassFiles(passes, out, ctx);
    expect(files.map((f) => f.name)).toEqual(['Bottle_Camera 1_0001_alpha.exr', 'Bottle_Camera 1_0001_depth.exr', 'Bottle_Camera 1_0001_normal.exr', 'Bottle_Camera 1_0001_partId.exr']);
    expect(files[0].blob.type).toBe('image/x-exr');
    const bytes = async (i: number) => new Uint8Array(await files[i].blob.arrayBuffer());
    const head = (b: Uint8Array) => new TextDecoder('latin1').decode(b.subarray(0, 120));
    expect(head(await bytes(0))).toContain('A\0');
    expect(head(await bytes(1))).toContain('Z\0');
    expect(head(await bytes(2))).toMatch(/B\0[\s\S]*G\0[\s\S]*R\0/);
    expect(head(await bytes(3))).toContain('Y\0');
    // The depth plane keeps its +Infinity: the first row's first pixel (the first float after the line header).
    const d = await bytes(1);
    const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
    const firstLine = d.length - H * (8 + W * 4) + 8;
    expect(dv.getFloat32(firstLine, true)).toBe(Infinity);
    expect(dv.getFloat32(firstLine + 4, true)).toBe(40);
    const normal = readExr(await bytes(2));
    expect([normal.rgba[0], normal.rgba[1], normal.rgba[2]]).toEqual([0, 0, 1]);
    // Ids as floats with the floor at 65535.
    const idv = readExr(await bytes(3));
    expect([idv.rgba[((H - 1) * W + 0) * 4], idv.rgba[((H - 1) * W + 1) * 4]]).toEqual([0, 1]);
    expect(idv.rgba[(0 * W + 1) * 4]).toBe(65535);
  });

  it('says which pass is missing rather than writing an empty file', async () => {
    await expect(encodePassFile({ width: 2, height: 1 }, 'depth', 'EXR', ctx)).rejects.toThrow(/no depth pass/);
    await expect(encodePassFile({ width: 2, height: 1, alpha: new Float32Array(2) }, 'partId', 'PNG16', ctx)).rejects.toThrow(/no partId pass/);
  });
});
