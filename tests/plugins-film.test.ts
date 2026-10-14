// The film simulation plugin (phase P6) end to end, where an aintfilm checkout is at hand (AINTFILM, or
// /home/user/aintfilm): tools/plugins/build-film.mjs assembles the bundle from it, the bundle is packed and installed
// like any plugin, and its worker renders through the real engine module: the recipes with their public names only,
// the 8-bit and the linear-planes entries, the controls reaching the engine (the format, the grain, the seed), and
// the same request giving the same pixels. Skipped where there is no checkout (CI): the module and the presets are
// closed and are not in this repository.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { defaultControls, parseManifest, type PluginManifest } from '../src/core/plugins';
import { PluginHost, type PluginSession } from '../src/plugins/host';
import { memoryPluginStore } from '../src/plugins/store';
import { newKeyBytes, packRpk, toBase64 } from '../src/plugins/rpk';
import { readBrandLists, scanText } from '../tools/plugins/brand-scan.mjs';
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

describe.skipIf(!HERE)('the film plugin, built from the aintfilm checkout', () => {
  let session: PluginSession;
  let manifest: PluginManifest;
  const W = 96;
  const H = 64;

  beforeAll(async () => {
    const out = mkdtempSync(join(tmpdir(), 'film-'));
    const built = spawnSync(process.execPath, ['tools/plugins/build-film.mjs', '--aintfilm', CHECKOUT, '--out', out], { encoding: 'utf8' });
    expect(built.status, built.stderr).toBe(0);
    const files = folderFiles(out);
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
