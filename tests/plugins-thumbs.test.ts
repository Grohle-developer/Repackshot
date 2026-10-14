// Phase P6, decision 8: the plugin's base picture and the recipe cards. With the invert test plugin (its manifest
// names `base.png`, 320×200) through the real host, the worker shim and the service: a preview with no result is the
// base picture through the plugin; the cards' pictures are the base, halved (THUMB_SIZE), through each recipe with
// the controls at their defaults, made one at a time and only while no preview is waiting, kept in the store by
// plugin version and recipe so that they are made once, and removed with the plugin. A render job's image goes
// through the plugin as blobs (decision 9's runImage).

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { defaultControls, parseManifest, THUMB_SIZE, thumbKey, type PluginControlValue } from '../src/core/plugins';
import { encodePng } from '../src/io/image';
import { PluginHost } from '../src/plugins/host';
import { NoResultError, PluginsService, type ResultBlobs } from '../src/plugins/service';
import { memoryPluginStore, type PluginStore } from '../src/plugins/store';
import { ModuleWorkerShim } from './module-worker-shim';
import { INVERT_DIR, packInvert } from './plugin-fixtures';
import { fixtureDecoder } from './texture-helpers';

const decode = async (blob: Blob) => {
  const img = await fixtureDecoder(new Uint8Array(await blob.arrayBuffer()), 'PNG');
  return { width: img.width, height: img.height, rgba: new Uint8ClampedArray(img.rgba) };
};
const png = async (img: { width: number; height: number; rgba: Uint8ClampedArray }) => new Blob([(await encodePng({ width: img.width, height: img.height, data: img.rgba })) as Uint8Array<ArrayBuffer>], { type: 'image/png' });
const BASE = new Uint8Array(readFileSync(`${INVERT_DIR}/base.png`));

async function setup(opts: { store?: PluginStore; pack?: Parameters<typeof packInvert>[0]; results?: Map<string, ResultBlobs> } = {}) {
  const store = opts.store ?? memoryPluginStore();
  const workers: ModuleWorkerShim[] = [];
  const host = new PluginHost({
    store,
    registry: [],
    fetch: () => Promise.reject(new Error('offline')),
    spawn: (url) => {
      const w = new ModuleWorkerShim(url);
      workers.push(w);
      return w;
    },
    createObjectURL: (b) => URL.createObjectURL(b),
    revokeObjectURL: (u) => URL.revokeObjectURL(u),
    now: () => 0,
  });
  await host.start();
  const pkg = await packInvert(opts.pack);
  expect(await host.installFile(new Blob([pkg.bytes.slice().buffer as ArrayBuffer]), pkg.keyText)).toMatchObject({ kind: 'DONE' });
  const results = opts.results ?? new Map<string, ResultBlobs>();
  const svc = new PluginsService({ host, registry: [], result: async (id) => results.get(id) ?? null, decode, decodeExr: () => Promise.reject(new Error('no EXR here')), encodePng: png, store, now: () => performance.now() });
  return { svc, host, store, workers, pkg };
}

type Msg = { type: string; id?: number; recipe?: string | null; controls?: Record<string, PluginControlValue>; width?: number; height?: number };
const renders = (w: ModuleWorkerShim) => w.sent.filter((m) => (m as Msg).type === 'render') as Msg[];

describe('the base picture (decision 8)', { timeout: 30_000 }, () => {
  it('the manifest names it, a PNG of the package: one that is missing is refused, one that is not a PNG too', async () => {
    const m = JSON.parse(readFileSync(`${INVERT_DIR}/manifest.json`, 'utf8')) as Record<string, unknown>;
    const parsed = parseManifest(m);
    expect(parsed.ok && parsed.manifest.base).toBe('base.png');
    expect(parseManifest({ ...m, base: 'base.jpg' })).toMatchObject({ ok: false, problems: ['base'] });
    expect(parseManifest({ ...m, base: '../base.png' })).toMatchObject({ ok: false, problems: ['base'] });
    const { host } = await setup();
    // A package without the file its manifest names as the base does not open.
    const lacking = await packInvert({ files: [] , manifest: { base: 'other.png' } });
    expect(await host.installFile(new Blob([lacking.bytes.slice().buffer as ArrayBuffer]), lacking.keyText)).toMatchObject({ kind: 'FAILED', fault: 'MANIFEST' });
  });

  it('with no result the preview is the base picture through the plugin; Apply works on results only', async () => {
    const { svc, workers } = await setup();
    expect(svc.hasBase('test-invert')).toBe(true);
    const r = await svc.run({ plugin: 'test-invert', result: null, maxWidth: 480, recipe: 'full', controls: defaultControls(parseOk()) });
    const base = await decode(new Blob([BASE]));
    // Never enlarged: the base is 320×200, smaller than the preview's width.
    expect([r.width, r.height]).toEqual([320, 200]);
    expect(r.before).toEqual(base.rgba);
    expect(r.after[0]).toBe(255 - base.rgba[0]);
    expect(renders(workers[0])).toHaveLength(1);
    // Without a base picture (a manifest that names none), there is nothing to show.
    const none = await setup({ pack: { manifest: { base: undefined } } });
    expect(none.svc.hasBase('test-invert')).toBe(false);
    await expect(none.svc.run({ plugin: 'test-invert', result: null, maxWidth: 480, recipe: null, controls: {} })).rejects.toBeInstanceOf(NoResultError);
  });
});

function parseOk() {
  const parsed = parseManifest(JSON.parse(readFileSync(`${INVERT_DIR}/manifest.json`, 'utf8')));
  if (!parsed.ok) throw new Error(parsed.problems.join(', '));
  return parsed.manifest;
}

describe('the recipe cards (decision 8)', { timeout: 30_000 }, () => {
  it('one picture a recipe and one for no recipe: the base halved, through the recipe at the default controls', async () => {
    const { svc, workers } = await setup();
    const got: { recipe: string | null; png: Blob }[] = [];
    const out = await svc.thumbnails('test-invert', (recipe, p) => got.push({ recipe, png: p }));
    expect(out).toMatchObject({ cached: 0, made: 3 });
    expect(out.seconds).toHaveLength(3);
    expect(got.map((g) => g.recipe)).toEqual([null, 'full', 'half']);
    const sent = renders(workers[0]);
    expect(sent.map((m) => [m.recipe, m.width, m.height])).toEqual([
      [null, THUMB_SIZE.width, THUMB_SIZE.height],
      ['full', THUMB_SIZE.width, THUMB_SIZE.height],
      ['half', THUMB_SIZE.width, THUMB_SIZE.height],
    ]);
    for (const m of sent) expect(m.controls).toEqual(defaultControls(parseOk()));
    const full = await decode(got[1].png);
    expect([full.width, full.height]).toEqual([160, 100]);
    // The base's top-left 2×2 block, averaged, inverted.
    const base = await decode(new Blob([BASE]));
    const avg = (c: number) => (base.rgba[c] + base.rgba[4 + c] + base.rgba[4 * 320 + c] + base.rgba[4 * 321 + c]) / 4;
    expect(Math.abs(full.rgba[0] - (255 - avg(0)))).toBeLessThanOrEqual(1);
  });

  it('they are made once: kept by plugin version and recipe, a new version makes them again, Remove takes them away', async () => {
    const store = memoryPluginStore();
    const a = await setup({ store });
    await a.svc.thumbnails('test-invert', () => undefined);
    const before = renders(a.workers[0]).length;
    // The same plugin again (another session of the page, the same store): every picture is a kept one.
    const seen: (string | null)[] = [];
    const again = await a.svc.thumbnails('test-invert', (r) => seen.push(r));
    expect(again).toEqual({ cached: 3, made: 0, seconds: [] });
    expect(seen).toEqual([null, 'full', 'half']);
    expect(renders(a.workers[0])).toHaveLength(before);
    expect(await store.thumb(thumbKey('test-invert', '1.0.0', 'half'))).not.toBeNull();
    expect(await store.thumb(thumbKey('test-invert', '1.0.0', null))).not.toBeNull();
    // Version 1.0.1 has pictures of its own.
    const update = await packInvert({ manifest: { version: '1.0.1' } });
    expect(await a.host.installFile(new Blob([update.bytes.slice().buffer as ArrayBuffer]), update.keyText)).toMatchObject({ kind: 'DONE', version: '1.0.1' });
    expect(await a.svc.thumbnails('test-invert', () => undefined)).toMatchObject({ cached: 0, made: 3 });
    expect(await store.thumb(thumbKey('test-invert', '1.0.1', 'full'))).not.toBeNull();
    await a.host.remove('test-invert');
    for (const v of ['1.0.0', '1.0.1']) expect(await store.thumb(thumbKey('test-invert', v, 'full'))).toBeNull();
  });

  it('a preview a person waits for goes first: no picture is sent to the plugin while one is in flight', async () => {
    const { svc, workers } = await setup();
    await svc.presets('test-invert');
    const w = workers[0];
    let preview: Promise<unknown> | null = null;
    const done = svc.thumbnails('test-invert', (r) => {
      // As the first picture arrives, a preview is asked for: the next pictures wait for it.
      if (r === null) preview = svc.run({ plugin: 'test-invert', result: null, maxWidth: 480, recipe: 'half', controls: { amount: 0.25 } });
    });
    await done;
    await preview;
    const events = w.log.filter((e) => (e.message as Msg).type === 'render');
    const at = events.findIndex((e) => e.dir === 'sent' && (e.message as Msg).controls?.amount === 0.25);
    expect(at).toBeGreaterThan(0);
    const answered = events.findIndex((e, i) => i > at && e.dir === 'received' && (e.message as Msg).id === (events[at].message as Msg).id);
    expect(answered).toBeGreaterThan(at);
    expect(events.slice(at + 1, answered).filter((e) => e.dir === 'sent')).toEqual([]);
    expect(renders(w)).toHaveLength(4);
  });

  it('stopped, it keeps what it made; a plugin without a base picture has no cards to make', async () => {
    const { svc, store } = await setup();
    const ac = new AbortController();
    const p = svc.thumbnails('test-invert', (r) => r === 'full' && ac.abort(), ac.signal);
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
    expect(await store.thumb(thumbKey('test-invert', '1.0.0', 'full'))).not.toBeNull();
    expect(await store.thumb(thumbKey('test-invert', '1.0.0', 'half'))).toBeNull();
    const none = await setup({ pack: { manifest: { base: undefined } } });
    expect(await none.svc.thumbnails('test-invert', () => undefined)).toEqual({ cached: 0, made: 0, seconds: [] });
  });
});

describe('an image of a render job through the plugin (runImage)', { timeout: 30_000 }, () => {
  it('at its own size, from its blobs', async () => {
    const { svc } = await setup();
    const img = { width: 6, height: 4, rgba: new Uint8ClampedArray(6 * 4 * 4).fill(40) };
    for (let i = 3; i < img.rgba.length; i += 4) img.rgba[i] = 255;
    const r = await svc.runImage({ plugin: 'test-invert', file: await png(img), display: null, recipe: 'full', controls: { amount: 1 } });
    expect([r.width, r.height]).toEqual([6, 4]);
    expect(r.after[0]).toBe(215);
  });
});
