// The plugin host (phase P6): the registry, the install (download, the registry's SHA-256 and size, the package's
// header, the activation key from `keyUrl` or typed), the store (the package kept encrypted, the key apart), the
// install from a file, the WebAssembly module's imports, and the worker ABI end to end with the invert test plugin.

import { describe, expect, it } from 'vitest';
import { PLUGIN_REGISTRY, registryEntryProblems, validEntries } from '../src/data/plugins';
import { PluginHost, type HostDeps } from '../src/plugins/host';
import { memoryPluginStore, type PluginStore } from '../src/plugins/store';
import { readRpk, toBase64, newKeyBytes } from '../src/plugins/rpk';
import { ModuleWorkerShim } from './module-worker-shim';
import { entryFor, packInvert, tableFetch, WASM_NO_IMPORTS, WASM_ONE_IMPORT } from './plugin-fixtures';
import type { PluginRegistryEntry } from '../src/data/plugins';

const URL_RPK = 'https://plugins.test/invert-1.0.0.rpk';
const URL_KEY = 'https://keys.test/invert';

function host(registry: PluginRegistryEntry[], table: Record<string, Uint8Array | string | number>, store: PluginStore = memoryPluginStore()) {
  const f = tableFetch(table);
  const workers: ModuleWorkerShim[] = [];
  const deps: HostDeps = {
    store,
    registry,
    fetch: f.fetch,
    spawn: (url) => {
      const w = new ModuleWorkerShim(url);
      workers.push(w);
      return w;
    },
    createObjectURL: (b) => URL.createObjectURL(b),
    revokeObjectURL: (u) => URL.revokeObjectURL(u),
    now: () => 1_700_000_000_000,
  };
  return { host: new PluginHost(deps), store, asked: f.asked, workers };
}

describe('the plugin registry (src/data/plugins.json)', () => {
  it('every entry is valid, ids are unique, and the licence is closed and said so', () => {
    expect(PLUGIN_REGISTRY.schema).toBe(1);
    for (const e of PLUGIN_REGISTRY.plugins) {
      expect(registryEntryProblems(e), e.id).toEqual([]);
      expect(e.licence.kind).toBe('closed');
      expect(e.licence.label).toEqual({ en: 'Closed licence', es: 'Licencia cerrada' });
    }
    expect(validEntries(PLUGIN_REGISTRY)).toHaveLength(PLUGIN_REGISTRY.plugins.length);
  });

  it('the film plugin: its public name, the release asset of v0.1.6, a real SHA-256 and size, and no key address yet', () => {
    const film = PLUGIN_REGISTRY.plugins.find((e) => e.id === 'aintfilm-film')!;
    expect(film.name).toEqual({ en: 'aintfilm · film simulation', es: 'aintfilm · simulación de película' });
    expect(film.url).toBe(`https://github.com/Grohle-developer/Repackshot/releases/download/v0.1.6/film-${film.version}.rpk`);
    expect(film.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(film.sha256).not.toBe('0'.repeat(64));
    expect(film.bytes).toBeGreaterThan(100_000);
    expect(film.keyUrl).toBe('');
    // The logo is a file of the package (closed): it is not in this repository.
    expect(film.logo).toBe('logo.svg');
  });

  it('refuses an entry with a bad hash, size, address or licence', () => {
    const ok = PLUGIN_REGISTRY.plugins[0];
    expect(registryEntryProblems({ ...ok, sha256: 'abc' })).toContain('sha256');
    expect(registryEntryProblems({ ...ok, bytes: 0 })).toContain('bytes');
    expect(registryEntryProblems({ ...ok, url: 'ftp://x' })).toContain('url');
    expect(registryEntryProblems({ ...ok, licence: { kind: 'open', label: ok.licence.label } })).toContain('licence');
    expect(registryEntryProblems({ ...ok, keyUrl: 'nope' })).toContain('keyUrl');
  });
});

describe('install from the registry', () => {
  it('download → SHA-256 → no key address: the key is asked for; a wrong key and a typo are said, the right one installs', async () => {
    const pkg = await packInvert();
    const { host: h, store } = host([entryFor(pkg.bytes)], { [URL_RPK]: pkg.bytes });
    await h.start();
    const first = await h.install('test-invert');
    expect(first).toEqual({ kind: 'NEEDS_KEY', id: 'test-invert', reason: 'NONE' });
    expect(h.snapshot().tasks['test-invert']).toEqual({ stage: 'NEEDS_KEY', reason: 'NONE' });
    expect(await h.provideKey('test-invert', 'not a key')).toEqual({ kind: 'NEEDS_KEY', id: 'test-invert', reason: 'BAD' });
    expect(await h.provideKey('test-invert', toBase64(newKeyBytes()))).toEqual({ kind: 'NEEDS_KEY', id: 'test-invert', reason: 'WRONG' });
    expect(await store.list()).toEqual([]);
    expect(await h.provideKey('test-invert', pkg.keyText)).toEqual({ kind: 'DONE', id: 'test-invert', version: '1.0.0' });
    // Kept encrypted, exactly as it arrived; the key apart.
    const kept = await store.get('test-invert');
    expect(new Uint8Array(kept!.bytes)).toEqual(pkg.bytes);
    expect(await store.key('test-invert')).toBe(pkg.keyText);
    const snap = h.snapshot();
    expect(snap.tasks).toEqual({});
    expect(snap.installed).toHaveLength(1);
    expect(snap.installed[0]).toMatchObject({ id: 'test-invert', version: '1.0.0', size: pkg.bytes.length, source: 'registry', problem: null });
    expect(snap.installed[0].manifest?.name.en).toBe('Invert (test plugin)');
    expect(snap.installed[0].logo).toMatch(/^data:image\/svg\+xml;base64,/);
  });

  it('a package whose SHA-256 is not the registry\'s is refused, and nothing is kept', async () => {
    const pkg = await packInvert();
    const other = await packInvert();
    const { host: h, store } = host([entryFor(pkg.bytes, { sha256: entryFor(other.bytes).sha256 })], { [URL_RPK]: pkg.bytes });
    const r = await h.install('test-invert');
    expect(r).toMatchObject({ kind: 'FAILED', fault: 'SHA256' });
    expect(await store.list()).toEqual([]);
    expect(h.snapshot().tasks['test-invert']).toMatchObject({ stage: 'FAILED', fault: 'SHA256' });
  });

  it('a download of another size, a server error and no network each fail with their reason', async () => {
    const pkg = await packInvert();
    expect(await host([entryFor(pkg.bytes, { bytes: pkg.bytes.length + 1 })], { [URL_RPK]: pkg.bytes }).host.install('test-invert')).toMatchObject({ fault: 'SIZE' });
    expect(await host([entryFor(pkg.bytes)], { [URL_RPK]: 404 }).host.install('test-invert')).toMatchObject({ fault: 'DOWNLOAD', detail: 'HTTP 404' });
    expect(await host([entryFor(pkg.bytes)], {}).host.install('test-invert')).toMatchObject({ fault: 'DOWNLOAD' });
  });

  it('a package that is not the plugin or the version the registry names is refused', async () => {
    const pkg = await packInvert({ manifest: { version: '2.0.0' } });
    const r = await host([entryFor(pkg.bytes)], { [URL_RPK]: pkg.bytes }).host.install('test-invert');
    expect(r).toMatchObject({ kind: 'FAILED', fault: 'MISMATCH' });
  });

  it('the key from the registry\'s keyUrl installs without asking; a keyUrl that fails asks the person', async () => {
    const pkg = await packInvert();
    const a = host([entryFor(pkg.bytes, { keyUrl: URL_KEY })], { [URL_RPK]: pkg.bytes, [URL_KEY]: `${pkg.keyText}\n` });
    expect(await a.host.install('test-invert')).toEqual({ kind: 'DONE', id: 'test-invert', version: '1.0.0' });
    expect(a.asked).toEqual([URL_RPK, URL_KEY]);
    const b = host([entryFor(pkg.bytes, { keyUrl: URL_KEY })], { [URL_RPK]: pkg.bytes, [URL_KEY]: 403 });
    expect(await b.host.install('test-invert')).toEqual({ kind: 'NEEDS_KEY', id: 'test-invert', reason: 'FAILED' });
    const c = host([entryFor(pkg.bytes, { keyUrl: URL_KEY })], { [URL_RPK]: pkg.bytes, [URL_KEY]: toBase64(newKeyBytes()) });
    expect(await c.host.install('test-invert')).toEqual({ kind: 'NEEDS_KEY', id: 'test-invert', reason: 'FAILED' });
  });

  it('an update keeps the key it has when it still opens the new version, and Remove takes both away', async () => {
    const key = newKeyBytes();
    const v1 = await packInvert({ key });
    const v2 = await packInvert({ key, manifest: { version: '1.1.0' } });
    const store = memoryPluginStore();
    const one = host([entryFor(v1.bytes)], { [URL_RPK]: v1.bytes }, store);
    await one.host.install('test-invert');
    await one.host.provideKey('test-invert', v1.keyText);
    const two = host([entryFor(v2.bytes, { version: '1.1.0' })], { [URL_RPK]: v2.bytes }, store);
    await two.host.start();
    expect(await two.host.install('test-invert')).toEqual({ kind: 'DONE', id: 'test-invert', version: '1.1.0' });
    expect(two.host.snapshot().installed[0].version).toBe('1.1.0');
    await two.host.remove('test-invert');
    expect(two.host.snapshot().installed).toEqual([]);
    expect(await store.key('test-invert')).toBeNull();
  });
});

describe('install from a file', () => {
  it('with its key it installs; a wrong key, a typo and a file that is not a plugin each say so', async () => {
    const pkg = await packInvert();
    const { host: h, store } = host([], {});
    const blob = new Blob([pkg.bytes.slice().buffer as ArrayBuffer]);
    expect(await h.installFile(blob, toBase64(newKeyBytes()))).toMatchObject({ kind: 'FAILED', fault: 'KEY' });
    expect(await h.installFile(blob, 'abc')).toMatchObject({ kind: 'FAILED', fault: 'BAD_KEY' });
    expect(await h.installFile(new Blob(['PK zip']), pkg.keyText)).toMatchObject({ kind: 'FAILED', fault: 'NOT_RPK' });
    expect(await store.list()).toEqual([]);
    expect(await h.installFile(blob, pkg.keyText)).toEqual({ kind: 'DONE', id: 'test-invert', version: '1.0.0' });
    expect(h.snapshot().installed[0]).toMatchObject({ id: 'test-invert', source: 'file' });
    expect(await h.text('test-invert', 'LICENCE.txt')).toContain('fixture of Repackshot');
  });

  it('a package whose manifest names a file it does not carry, or speaks another ABI, is refused', async () => {
    const missing = await packInvert({ manifest: { files: ['recipes.json', 'nowhere.json'] } });
    const { host: h } = host([], {});
    expect(await h.installFile(new Blob([missing.bytes.slice().buffer as ArrayBuffer]), missing.keyText)).toMatchObject({ fault: 'MANIFEST' });
    const abi2 = await packInvert({ manifest: { abi: 2 } });
    expect(await h.installFile(new Blob([abi2.bytes.slice().buffer as ArrayBuffer]), abi2.keyText)).toMatchObject({ fault: 'ABI' });
  });
});

describe('running a plugin: the worker ABI end to end (the invert test plugin, no WebAssembly)', () => {
  async function installed(opts: Parameters<typeof packInvert>[0] = {}) {
    const pkg = await packInvert(opts);
    const ctx = host([], {});
    expect(await ctx.host.installFile(new Blob([pkg.bytes.slice().buffer as ArrayBuffer]), pkg.keyText)).toMatchObject({ kind: 'DONE' });
    return ctx;
  }

  it('init transfers its files; info, presets and render answer; rgba8 and linear planes both come back inverted', async () => {
    const { host: h, workers } = await installed();
    const s = await h.session('test-invert');
    try {
      const init = workers[0].sent[0] as { type: string; files: Record<string, ArrayBuffer>; wasm: unknown; manifest: { id: string } };
      expect(init.type).toBe('init');
      expect(Object.keys(init.files)).toEqual(['recipes.json']);
      expect(init.wasm).toBeNull();
      expect(init.manifest.id).toBe('test-invert');
      expect(await s.info()).toEqual({ name: { en: 'Invert (test plugin)', es: 'Invertir (plugin de prueba)' }, version: '1.0.0', engine: 'JavaScript' });
      const presets = await s.presets();
      expect(presets.categories).toEqual([{ id: 'basic', label: { en: 'Basic', es: 'Básicas' } }]);
      expect(presets.presets.map((p) => p.id)).toEqual(['full', 'half']);
      const px = new Uint8ClampedArray([0, 10, 200, 255, 255, 128, 0, 255]);
      const out = await s.render({ width: 2, height: 1, pixels: { kind: 'rgba8', data: px }, recipe: 'full', controls: { amount: 1, channel: 'all', mono: false } });
      expect([...out.rgba8]).toEqual([255, 245, 55, 255, 0, 127, 255, 255]);
      expect(out.info.items.find((i) => i.key === 'input')?.value).toBe('rgba8');
      // Linear planes: red plane, green, blue; 0.2158605 is display 128 (sRGB).
      const planes = new Float32Array([1, 0, 0.2158605, 0.2158605, 0, 1]);
      const lin = await s.render({ width: 2, height: 1, pixels: { kind: 'linear-f32-planes', data: planes }, recipe: 'half', controls: { amount: 1, channel: 'r', mono: false } });
      expect([...lin.rgba8]).toEqual([128, 128, 0, 255, 128, 128, 255, 255]);
      expect(lin.info.items.find((i) => i.key === 'amount')).toEqual({ key: 'amount', label: { en: 'Inverted', es: 'Invertido' }, value: 50, unit: '%' });
    } finally {
      s.close();
    }
  });

  it('a render cancelled before it starts is dropped by the plugin, and the next one answers', async () => {
    const { host: h, workers } = await installed();
    const s = await h.session('test-invert');
    try {
      const ac = new AbortController();
      const px = () => ({ kind: 'rgba8' as const, data: new Uint8ClampedArray(4 * 64 * 64).fill(10) });
      const first = s.render({ width: 64, height: 64, pixels: px(), recipe: null, controls: { amount: 1 } }, ac.signal);
      ac.abort();
      await expect(first).rejects.toMatchObject({ name: 'AbortError' });
      const second = await s.render({ width: 64, height: 64, pixels: px(), recipe: null, controls: { amount: 1 } });
      expect(second.rgba8[0]).toBe(245);
      // The host said cancel, and the plugin dropped the render before starting it (it answered `cancelled`, not `render`).
      const cancel = workers[0].sent.find((m) => (m as { type: string }).type === 'cancel') as { id: number };
      expect(cancel).toBeDefined();
      expect(workers[0].received).toContainEqual({ type: 'cancelled', id: cancel.id });
      expect(workers[0].received.filter((m) => (m as { type: string }).type === 'render')).toHaveLength(1);
    } finally {
      s.close();
    }
  });

  it('a module that imports something is refused when the manifest says it imports nothing; one that imports nothing starts', async () => {
    const bad = await installed({ manifest: { wasm: { file: 'module.wasm', noImports: true } }, files: [{ name: 'module.wasm', bytes: WASM_ONE_IMPORT }] });
    await expect(bad.host.session('test-invert')).rejects.toMatchObject({ fault: 'IMPORTS' });
    expect(bad.workers).toHaveLength(0);
    const good = await installed({ manifest: { wasm: { file: 'module.wasm', noImports: true } }, files: [{ name: 'module.wasm', bytes: WASM_NO_IMPORTS }] });
    const s = await good.host.session('test-invert');
    const init = good.workers[0].sent[0] as { wasm: ArrayBuffer };
    expect(new Uint8Array(init.wasm)).toEqual(WASM_NO_IMPORTS);
    s.close();
  });

  it('the package stays encrypted in the store: the code and the files are never written in clear', async () => {
    const { store } = await installed();
    const kept = await store.get('test-invert');
    const text = new TextDecoder('latin1').decode(new Uint8Array(kept!.bytes));
    expect(text.startsWith('RPK1')).toBe(true);
    expect(text).not.toContain('self.addEventListener');
    expect(text).not.toContain('Full inversion');
    expect(readRpk(new Uint8Array(kept!.bytes)).header.id).toBe('test-invert');
  });
});
