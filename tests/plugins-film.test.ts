// The film simulation plugin (phase P6) end to end, where an aintfilm checkout is at hand (AINTFILM, or
// /home/user/aintfilm): tools/plugins/build-film.mjs assembles the bundle from it, the bundle is packed and installed
// like any plugin, and its worker renders through the real engine module: the recipes with their public names only,
// the 8-bit and the linear-planes entries, the controls reaching the engine (the format, the grain, the seed), and
// the same request giving the same pixels. Skipped where there is no checkout (CI): the module and the presets are
// closed and are not in this repository. The logo (decision 7) is tested without one: DotGrid's ink rule over a grid,
// and a picture of dots read back dot by dot.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { deflateSync, inflateSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { defaultControls, filterPresets, parseManifest, THUMB_SIZE, type PluginManifest } from '../src/core/plugins';
import { PluginHost, type PluginSession } from '../src/plugins/host';
import { memoryPluginStore } from '../src/plugins/store';
import { newKeyBytes, packRpk, toBase64 } from '../src/plugins/rpk';
import { readBrandLists, scanText } from '../tools/plugins/brand-scan.mjs';
import { decodePngLuminance, dotGridInks, dotGridSvg, readDotPicture, readGrid, twoInk } from '../tools/plugins/dot-grid.mjs';
import { ModuleWorkerShim } from './module-worker-shim';

const CHECKOUT = process.env.AINTFILM ?? '/home/user/aintfilm';
const HERE = existsSync(join(CHECKOUT, 'public', 'engine', 'itsnotfilm-engine.wasm')) && existsSync(join(CHECKOUT, 'scripts', 'brand-hashes.json'));

/** Every file of a folder, relative names (the bundle has one level of sub-folders under presets/). */
function folderFiles(dir: string): { name: string; bytes: Uint8Array }[] {
  const out = spawnSync('find', [dir, '-type', 'f'], { encoding: 'utf8' }).stdout.split('\n').filter(Boolean).sort();
  return out.map((p) => ({ name: p.slice(dir.length + 1), bytes: new Uint8Array(readFileSync(p)) }));
}

/** A small test picture: a gradient with a bright corner (light above one in the linear one). */
function picture(w: number, h: number): { rgba: Uint8ClampedArray; planes: Float32Array } {
  const rgba = new Uint8ClampedArray(w * h * 4);
  const planes = new Float32Array(3 * w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const v = x / (w - 1);
      rgba.set([Math.round(255 * v), Math.round(255 * (y / (h - 1))), 128, 255], 4 * i);
      planes[i] = v * v * (x > w - 8 && y < 8 ? 4 : 1);
      planes[w * h + i] = (y / (h - 1)) ** 2;
      planes[2 * w * h + i] = 0.2;
    }
  return { rgba, planes };
}

/** The fills of an SVG's rects, in order. */
const fills = (svg: string) => [...svg.matchAll(/<rect [^>]*fill="(#[0-9A-F]{6})"/g)].map((m) => m[1]);

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(b: Uint8Array): number {
  let c = 0xffffffff;
  for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** A grey PNG of `lum` (8 bits), its rows filtered with each of the five filters in turn (as encoders do). */
function greyPng(width: number, height: number, lum: Uint8Array): Uint8Array {
  const raw = new Uint8Array((width + 1) * height);
  for (let y = 0; y < height; y++) {
    const f = y % 5;
    raw[y * (width + 1)] = f;
    for (let x = 0; x < width; x++) {
      const v = lum[y * width + x];
      const a = x > 0 ? lum[y * width + x - 1] : 0;
      const b = y > 0 ? lum[(y - 1) * width + x] : 0;
      const c = x > 0 && y > 0 ? lum[(y - 1) * width + x - 1] : 0;
      const p = a + b - c;
      const pred = f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : Math.abs(p - a) <= Math.abs(p - b) && Math.abs(p - a) <= Math.abs(p - c) ? a : Math.abs(p - b) <= Math.abs(p - c) ? b : c;
      raw[y * (width + 1) + 1 + x] = (v - pred) & 255;
    }
  }
  const chunk = (tag: string, body: Uint8Array) => {
    const out = new Uint8Array(12 + body.length);
    const v = new DataView(out.buffer);
    v.setUint32(0, body.length);
    for (let i = 0; i < 4; i++) out[4 + i] = tag.charCodeAt(i);
    out.set(body, 8);
    v.setUint32(8 + body.length, crc32(out.subarray(4, 8 + body.length)));
    return out;
  };
  const ihdr = new Uint8Array(13);
  new DataView(ihdr.buffer).setUint32(0, width);
  new DataView(ihdr.buffer).setUint32(4, height);
  ihdr[8] = 8;
  const parts = [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', new Uint8Array(deflateSync(raw))), chunk('IEND', new Uint8Array(0))];
  const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    all.set(p, at);
    at += p.length;
  }
  return all;
}

describe('the logo, a dot grid (decision 7)', () => {
  it('DotGrid\'s rule: a grid with a space is a two-ink grid, its `.` dots in the dimmer ink; one with none has holes there', () => {
    const two = ['#.# ', ' .# '];
    const one = ['#.#.', '.##.'];
    expect([twoInk(two), twoInk(one)]).toEqual([true, false]);
    expect(dotGridInks(two)).toEqual({ '#': '#FFFFFF', '.': '#4A4A4A' });
    expect(fills(dotGridSvg(two))).toEqual(['#FFFFFF', '#4A4A4A', '#FFFFFF', '#4A4A4A', '#FFFFFF']);
    expect(fills(dotGridSvg(one))).toEqual(['#FFFFFF', '#FFFFFF', '#FFFFFF', '#FFFFFF']);
    // One rect a dot, centred in its square cell, its corners rounded to a circle.
    expect(dotGridSvg(['# '])).toContain('viewBox="0 0 2 1"');
    expect(dotGridSvg(['# '])).toContain('<rect x="0.08" y="0.08" width="0.84" height="0.84" rx="0.42" ry="0.42" fill="#FFFFFF"/>');
    // Read as text from a source: the rows between the brackets, all of one length, or nothing.
    expect(readGrid('const A = 1;\nexport const LOGO = [\n  "## ",\n  " .#",\n] as const;', 'LOGO')).toEqual(['## ', ' .#']);
    expect(readGrid('export const LOGO = ["##", "#"] as const;', 'LOGO')).toBeNull();
    expect(readGrid('export const OTHER = ["##"];', 'LOGO')).toBeNull();
  });

  it('a picture of dots is read back dot by dot: the grid, each dot\'s grey, the dot\'s width, every PNG filter', () => {
    const rows = ['  ##   ', '#####12', '#####3 ', ' #  #  '];
    const level: Record<string, number> = { '#': 255, '1': 128, '2': 191, '3': 224 };
    const pitch = 20;
    const r = 8.5;
    const w = rows[0].length * pitch + 30;
    const h = rows.length * pitch + 30;
    // A ground of dark noise (below what reads as ink), so that every filter's every branch is taken.
    const noise = (i: number) => {
      let x = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b);
      x ^= x >>> 13;
      x = Math.imul(x, 0xc2b2ae35);
      return ((x ^ (x >>> 16)) >>> 0) % 31;
    };
    const lum = new Uint8Array(w * h).map((_v, i) => noise(i));
    rows.forEach((row, y) =>
      [...row].forEach((ch, x) => {
        if (ch === ' ') return;
        const cx = 15 + x * pitch + pitch / 2;
        const cy = 15 + y * pitch + pitch / 2;
        for (let py = Math.floor(cy - r); py <= cy + r; py++) for (let px = Math.floor(cx - r); px <= cx + r; px++) if ((px + 0.5 - cx) ** 2 + (py + 0.5 - cy) ** 2 <= r * r) lum[py * w + px] = level[ch];
      }),
    );
    const bytes = greyPng(w, h, lum);
    const back = decodePngLuminance(bytes, (d) => new Uint8Array(inflateSync(d)));
    expect(back.lum).toEqual(lum);
    const g = readDotPicture(back);
    expect(g.rows).toEqual(rows);
    expect(g.inks).toEqual({ '1': '#808080', '2': '#BFBFBF', '3': '#E0E0E0', '#': '#FFFFFF' });
    expect(g.pitch).toBeCloseTo(pitch, 5);
    expect(g.dot).toBeCloseTo(17 / 20, 1);
    expect(fills(dotGridSvg(g.rows, { inks: g.inks, dot: g.dot }))).toEqual(['#FFFFFF', '#FFFFFF', ...Array(5).fill('#FFFFFF'), '#808080', '#BFBFBF', ...Array(5).fill('#FFFFFF'), '#E0E0E0', '#FFFFFF', '#FFFFFF']);
    expect(() => decodePngLuminance(new Uint8Array([1, 2, 3]), inflateSync)).toThrow(/not a PNG/);
  });
});

describe.skipIf(!HERE)('the film plugin, built from the aintfilm checkout', { timeout: 60_000 }, () => {
  let session: PluginSession;
  let manifest: PluginManifest;
  let files: { name: string; bytes: Uint8Array }[] = [];
  const W = 96;
  const H = 64;

  beforeAll(async () => {
    const out = mkdtempSync(join(tmpdir(), 'film-'));
    const built = spawnSync(process.execPath, ['tools/plugins/build-film.mjs', '--aintfilm', CHECKOUT, '--out', out], { encoding: 'utf8' });
    expect(built.status, built.stderr).toBe(0);
    files = folderFiles(out);
    const parsed = parseManifest(JSON.parse(new TextDecoder().decode(files.find((f) => f.name === 'manifest.json')!.bytes)));
    if (!parsed.ok) throw new Error(parsed.problems.join(', '));
    manifest = parsed.manifest;
    const key = newKeyBytes();
    const bytes = await packRpk({ id: manifest.id, version: manifest.version, abi: 1 }, files, key);
    const host = new PluginHost({ store: memoryPluginStore(), registry: [], fetch: () => Promise.reject(new Error('offline')), spawn: (url) => new ModuleWorkerShim(url), createObjectURL: (b) => URL.createObjectURL(b), revokeObjectURL: (u) => URL.revokeObjectURL(u), now: () => 0 });
    expect(await host.installFile(new Blob([bytes.slice().buffer as ArrayBuffer]), toBase64(key))).toMatchObject({ kind: 'DONE', id: 'aintfilm-film' });
    session = await host.session('aintfilm-film');
  }, 120_000);
  afterAll(() => session?.close());

  it('its logo is drawn from the checkout\'s LOGO grid by DotGrid\'s rule, or from the owner\'s picture with --logo', async () => {
    const rows = readGrid(readFileSync(join(CHECKOUT, 'src', 'data', 'marks.ts'), 'utf8'), 'LOGO')!;
    const logo = new TextDecoder().decode(files.find((f) => f.name === 'logo.svg')!.bytes);
    const want = rows.flatMap((row) => [...row].filter((c) => c === '#' || (c === '.' && twoInk(rows))).map((c) => (c === '#' ? '#FFFFFF' : '#4A4A4A')));
    expect(fills(logo)).toEqual(want);
    expect(logo).toContain(`viewBox="0 0 ${rows[0].length} ${rows.length}"`);
    // A picture of the logo: its grid wins.
    const lum = new Uint8Array(60 * 40);
    for (const [cx, cy, v] of [[10, 10, 255], [30, 10, 128], [10, 30, 255]] as const) for (let y = cy - 7; y <= cy + 7; y++) for (let x = cx - 7; x <= cx + 7; x++) if ((x - cx) ** 2 + (y - cy) ** 2 <= 49) lum[y * 60 + x] = v;
    const dir = mkdtempSync(join(tmpdir(), 'film-logo-'));
    writeFileSync(join(dir, 'logo.png'), greyPng(60, 40, lum));
    const built = spawnSync(process.execPath, ['tools/plugins/build-film.mjs', '--aintfilm', CHECKOUT, '--logo', join(dir, 'logo.png'), '--out', join(dir, 'out')], { encoding: 'utf8' });
    expect(built.status, built.stderr).toBe(0);
    const drawn = readFileSync(join(dir, 'out', 'logo.svg'), 'utf8');
    expect(drawn).toContain('viewBox="0 0 2 2"');
    expect(fills(drawn)).toEqual(['#FFFFFF', '#808080', '#FFFFFF']);
  }, 120_000);

  it('carries the recipe cards\' base picture, which goes through the engine at the cards\' size', async () => {
    expect(manifest.base).toBe('thumb-base.png');
    expect(files.some((f) => f.name === 'thumb-base.png')).toBe(true);
    expect(manifest.files).not.toContain('thumb-base.png');
    const px = new Uint8ClampedArray(4 * THUMB_SIZE.width * THUMB_SIZE.height).fill(90);
    for (const recipe of ['cn-01', 'bw-01']) {
      const r = await session.render({ width: THUMB_SIZE.width, height: THUMB_SIZE.height, pixels: { kind: 'rgba8', data: new Uint8ClampedArray(px) }, recipe, controls: defaultControls(manifest) });
      expect(r.rgba8).toHaveLength(px.length);
    }
  });

  it('declares the controls of the recipe editor, and its module imports nothing', () => {
    expect(manifest.wasm).toEqual({ file: 'module.wasm', noImports: true });
    const keys = manifest.controls.map((c) => c.key);
    for (const k of ['format', 'exposure', 'grainAmount', 'grainSize', 'halationAmount', 'halationRadius', 'diffusion', 'diffusionGrade', 'output', 'seed', 'lens', 'renderer']) expect(keys).toContain(k);
    expect(manifest.name).toEqual({ en: 'aintfilm · film simulation', es: 'aintfilm · simulación de película' });
  });

  it('offers its recipes by its categories, with public names only', async () => {
    const p = await session.presets();
    expect(p.presets.length).toBeGreaterThan(100);
    expect(p.categories.map((c) => c.id)).toEqual(['films-cn', 'films-sl', 'films-ci', 'films-bw', 'colour', 'grain', 'diffusion', 'lens']);
    expect(p.presets.find((r) => r.id === 'cn-01')).toMatchObject({ name: { en: 'CN-01', es: 'CN-01' }, category: 'films-cn' });
    // No maker's or product's name (aintfilm's D112), by its own list of hashes.
    const lists = readBrandLists(join(CHECKOUT, 'scripts', 'brand-hashes.json'));
    expect(scanText(JSON.stringify(p, null, 1), lists)).toEqual([]);
    expect(scanText(JSON.stringify(manifest, null, 1), lists)).toEqual([]);
  });

  it('offers the film search\'s filters (TYPE, ISO in its bands) and the recipes\' groups, each recipe tagged (P6b)', async () => {
    const p = await session.presets();
    expect(p.filters.map((f) => [f.id, f.options.map((o) => o.value)])).toEqual([
      ['type', ['colour', 'bw', 'slide', 'cine']],
      ['iso', ['slow', 'medium', 'fast']],
      ['group', ['films', 'colour', 'grain', 'diffusion', 'lens']],
    ]);
    const n = (f: Record<string, string>) => filterPresets(p.presets, f).count;
    expect([n({ group: 'films' }), n({ group: 'colour' }), n({ group: 'grain' }), n({ group: 'diffusion' }), n({ group: 'lens' })]).toEqual([51, 51, 8, 13, 4]);
    // Every film and every film's colour has a TYPE and an ISO band; the bands and the types each split the 102.
    expect(['slow', 'medium', 'fast'].map((b) => n({ iso: b })).reduce((a, b) => a + b, 0)).toBe(102);
    expect(['colour', 'bw', 'slide', 'cine'].map((v) => n({ type: v })).reduce((a, b) => a + b, 0)).toBe(102);
    // The bands are the app's: cut at 100 and 400, by the box speed each film's card shows.
    for (const r of p.presets.filter((x) => x.tags?.iso)) {
      const iso = Number(/ISO (\d+)/.exec(r.aux?.en ?? '')?.[1]);
      expect(r.tags!.iso, r.id).toBe(iso <= 100 ? 'slow' : iso <= 400 ? 'medium' : 'fast');
    }
    // The categories already say a film's class: TYPE agrees with them.
    const cls: Record<string, string> = { 'films-cn': 'colour', 'films-sl': 'slide', 'films-ci': 'cine', 'films-bw': 'bw' };
    for (const r of p.presets.filter((x) => cls[x.category])) expect(r.tags?.type, r.id).toBe(cls[r.category]);
    // They combine; a grain has no ISO.
    expect(n({ type: 'bw', group: 'films' })).toBe(p.presets.filter((x) => x.category === 'films-bw').length);
    expect(filterPresets(p.presets, { iso: 'fast' }).shown.some((x) => x.id.startsWith('grain'))).toBe(false);
    // No maker's or product's name in the filters' words either.
    expect(scanText(JSON.stringify(p.filters, null, 1), readBrandLists(join(CHECKOUT, 'scripts', 'brand-hashes.json')))).toEqual([]);
  });

  it('renders 8-bit pixels and linear planes through the engine, deterministically', async () => {
    const pic = picture(W, H);
    const controls = defaultControls(manifest);
    const a = await session.render({ width: W, height: H, pixels: { kind: 'rgba8', data: new Uint8ClampedArray(pic.rgba) }, recipe: 'cn-01', controls });
    const b = await session.render({ width: W, height: H, pixels: { kind: 'rgba8', data: new Uint8ClampedArray(pic.rgba) }, recipe: 'cn-01', controls });
    expect(a.rgba8).toEqual(b.rgba8);
    expect(a.rgba8).not.toEqual(pic.rgba);
    expect(a.info.items.map((i) => i.key)).toEqual(expect.arrayContaining(['umPerPx', 'grain', 'stages', 'engine']));
    const lin = await session.render({ width: W, height: H, pixels: { kind: 'linear-f32-planes', data: new Float32Array(pic.planes) }, recipe: 'cn-01', controls });
    expect(lin.rgba8).toHaveLength(W * H * 4);
    expect(lin.rgba8).not.toEqual(a.rgba8);
    // Every pixel comes back opaque.
    for (let i = 3; i < lin.rgba8.length; i += 4) expect(lin.rgba8[i]).toBe(255);
  });

  it('the controls reach the engine: the format sizes the grain, the seed moves it, Grain off takes it away', async () => {
    const pic = picture(W, H);
    const base = defaultControls(manifest);
    const run = (patch: Record<string, unknown>) => session.render({ width: W, height: H, pixels: { kind: 'rgba8', data: new Uint8ClampedArray(pic.rgba) }, recipe: 'bw-01', controls: { ...base, ...patch } as typeof base });
    const um = (r: Awaited<ReturnType<typeof run>>) => r.info.items.find((i) => i.key === 'umPerPx')?.value as number;
    const small = await run({ format: '0' });
    const large = await run({ format: '7' });
    expect(um(large)).toBeGreaterThan(um(small));
    // The seed draws the grain (and the dither of the 8-bit writing: two code values peak to peak).
    const maxDiff = (x: Uint8ClampedArray, y: Uint8ClampedArray) => x.reduce((m, v, i) => Math.max(m, Math.abs(v - y[i])), 0);
    const seedA = await run({ seed: 1, grainAmount: 3, grainSize: 3 });
    const seedB = await run({ seed: 2, grainAmount: 3, grainSize: 3 });
    expect(maxDiff(seedA.rgba8, seedB.rgba8)).toBeGreaterThan(4);
    const noGrainA = await run({ grain: false, seed: 1 });
    const noGrainB = await run({ grain: false, seed: 2 });
    expect(maxDiff(noGrainA.rgba8, noGrainB.rgba8)).toBeLessThanOrEqual(2);
  });
});
