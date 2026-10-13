// Phase P3e: the platform seam. In the desktop launcher's window every service and every byte of state is the
// launcher's: the seam picks it when the launcher answers, and then never touches the browser's storage
// (localStorage, IndexedDB, navigator.storage), except for one migration of what an older version left there,
// which happens once per data folder. In the browser it is the web platform, as before.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultSettings, migrateDoc } from '../src/core/settings';
import { emptyLibrary } from '../src/core/library';
import type { ResultMeta } from '../src/core/results';
import { choosePlatform } from '../src/io/platform';
import { LauncherKeyValue, MIGRATION_DOC, thumbName } from '../src/io/platform-desktop';
import type { BrowserStorage } from '../src/io/platform-web';
import { exportLibrary } from '../src/io/library';
import { launcherResultsStore } from '../src/io/results';
import { fakeLauncher, type FakeLauncher } from './fake-launcher';

/** localStorage as a Map, recording every access. */
function spyStorage(initial: Record<string, string> = {}, touched: string[] = []): BrowserStorage & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  const note = (what: string) => touched.push(`localStorage.${what}`);
  return {
    data,
    get length() {
      note('length');
      return data.size;
    },
    key: (i) => (note('key'), [...data.keys()][i] ?? null),
    getItem: (k) => (note(`getItem(${k})`), data.get(k) ?? null),
    setItem: (k, v) => (note(`setItem(${k})`), void data.set(k, v)),
    removeItem: (k) => (note(`removeItem(${k})`), void data.delete(k)),
  };
}

/** The part of IndexedDB io/results.ts reads, with records, recording every access. */
function spyIdb(records: { meta: ResultMeta; blobs: { file: Blob; display: Blob | null } }[], touched: string[] = []): IDBFactory {
  const req = <T>(result: T) => {
    const r: { result?: T; onsuccess?: () => void } = {};
    queueMicrotask(() => {
      r.result = result;
      r.onsuccess?.();
    });
    return r;
  };
  const db = {
    objectStoreNames: { contains: (n: string) => n === 'meta' || n === 'blobs' },
    transaction: () => ({
      objectStore: (name: string) => ({
        getAll: () => req(name === 'meta' ? records.map((r) => r.meta) : []),
        get: (id: string) => req(records.find((r) => r.meta.id === id)?.blobs),
      }),
    }),
    close: () => undefined,
  };
  return {
    databases: async () => (touched.push('indexedDB.databases'), [{ name: 'repackshot', version: 1 }]),
    open: () => {
      touched.push('indexedDB.open');
      return req(db);
    },
  } as unknown as IDBFactory;
}

const meta = (id: string, createdAt: number, bytes = 4): ResultMeta => ({
  id,
  jobId: 'j1',
  name: `${id}.png`,
  createdAt,
  width: 4,
  height: 2,
  dpi: 72,
  samples: 16,
  seconds: 1,
  cameraId: null,
  camera: 'Camera',
  format: 'PNG',
  bitDepth: 8,
  savedTo: { kind: 'DOWNLOADS' },
  thumb: '',
  bytes,
});

const settled = () => new Promise((r) => setTimeout(r, 0));

describe('the platform seam picks the launcher when it answers', () => {
  const touched: string[] = [];
  const g = globalThis as Record<string, unknown>;
  let saved: Record<string, PropertyDescriptor | undefined> = {};

  beforeEach(() => {
    touched.length = 0;
    saved = { window: Object.getOwnPropertyDescriptor(g, 'window'), indexedDB: Object.getOwnPropertyDescriptor(g, 'indexedDB'), navigator: Object.getOwnPropertyDescriptor(g, 'navigator') };
    // The browser's storage, as globals the default getters would reach: every access is noted.
    const ls = spyStorage({ 'repackshot.settings': JSON.stringify({ schema: 3, settings: { 'general.lang': 'es' } }) }, touched);
    Object.defineProperty(g, 'window', {
      configurable: true,
      value: {
        get localStorage() {
          touched.push('window.localStorage');
          return ls;
        },
        addEventListener: () => touched.push('window.addEventListener'),
      },
    });
    // The browser's pickers: the desktop never reaches for them (P3b's dialogs go through the launcher).
    for (const picker of ['showDirectoryPicker', 'showSaveFilePicker', 'showOpenFilePicker']) {
      saved[picker] = Object.getOwnPropertyDescriptor(g, picker);
      Object.defineProperty(g, picker, {
        configurable: true,
        get() {
          touched.push(picker);
          return async () => ({});
        },
      });
    }
    Object.defineProperty(g, 'indexedDB', {
      configurable: true,
      get() {
        touched.push('indexedDB');
        return spyIdb([], touched);
      },
    });
    Object.defineProperty(g, 'navigator', {
      configurable: true,
      value: {
        get storage() {
          touched.push('navigator.storage');
          return { persist: async () => true, persisted: async () => true, estimate: async () => ({ usage: 1, quota: 2 }), getDirectory: async () => ({}) };
        },
        hardwareConcurrency: 4,
      },
    });
  });

  afterEach(() => {
    for (const [k, d] of Object.entries(saved)) {
      if (d) Object.defineProperty(g, k, d);
      else delete g[k];
    }
  });

  it('with the migration done, nothing of the browser is touched, whatever is used', async () => {
    const l = fakeLauncher();
    l.docs.set(MIGRATION_DOC, JSON.stringify({ from: 'browser' }));
    l.settings = JSON.stringify({ schema: 3, settings: { 'general.lang': 'en', 'general.theme': 'light' }, layout: {} });
    const p = await choosePlatform({ native: l.client });
    expect(p.kind).toBe('desktop');
    expect(p.native).toBe(l.client);
    // The launcher's settings, not the browser's (which say Spanish).
    expect(p.settings.initial.doc.settings['general.lang']).toBe('en');
    expect(p.settings.initial.doc.settings['general.theme']).toBe('light');
    // Every service, used.
    p.settings.save({ ...p.settings.initial.doc, settings: { ...p.settings.initial.doc.settings, 'general.lang': 'es' } }, { final: true });
    p.memory.setItem('repackshot.models.downloads', JSON.stringify({ keys: ['A'] }));
    expect(p.library.save(emptyLibrary())).toBe('ok');
    const results = await p.openResults({ count: 50, bytes: 1e9 });
    await results.add(meta('r1', 1), new Blob(['png!'], { type: 'image/png' }), null);
    expect((await results.list()).map((m) => m.id)).toEqual(['r1']);
    expect(await (await results.get('r1'))!.file.text()).toBe('png!');
    const hw = await p.hardware(true);
    expect(hw.where).toBe('desktop');
    expect(hw.gpus).toEqual([{ name: 'Test GPU', vramGiB: 12 }]);
    expect(await p.requestPersistence()).toBe(true);
    expect(p.storage.kind).toBe('folder');
    expect(await p.storage.persisted()).toBeNull();
    expect(await p.storage.persist()).toBeNull();
    expect(await p.storage.estimate()).toBeNull();
    expect((await p.storage.usage())?.dataDir).toBe('/data');
    p.thumbs.set('preset:gold', 'data:image/png;base64,AA');
    await settled();
    expect(await p.thumbs.get('preset:gold')).toBe('data:image/png;base64,AA');
    expect(await p.storage.clearCache()).toBeGreaterThan(0);
    expect(await p.modelStore({ hash: async () => '0'.repeat(64) } as never)).not.toBeNull();
    // Outputs, projects, imports and exports: the launcher's dialogs and paths (P3b), never the browser's pickers.
    const fileOpts = { handles: { putHandle: async () => undefined, getHandle: async () => null }, download: () => touched.push('download'), folderTitle: () => 'Folder', confirmTitle: () => 'Again', folderItem: () => 'Item', onDialogError: () => undefined };
    const files = p.files(fileOpts);
    expect((files as { desktop?: boolean }).desktop).toBe(true);
    expect(await files.chooseFolder()).toEqual({ id: 'd-renders', name: '/home/a/Renders' });
    const projects = p.projectFiles({ ...fileOpts, description: () => 'Project', openTitle: () => 'Open', saveTitle: () => 'Save', allFiles: () => 'All', remember: { put: async () => undefined, get: async () => null } });
    expect(projects.canSaveInPlace).toBe(true);
    expect(p.dialogs(() => undefined)).not.toBeNull();
    p.onLibraryChange(() => undefined);
    p.flush();
    await settled();
    await settled();
    expect(touched).toEqual([]);
    // …and everything went to the launcher.
    expect(JSON.parse(l.settings!).settings['general.lang']).toBe('es');
    expect(JSON.parse(l.docs.get('models.downloads')!)).toEqual({ keys: ['A'] });
    expect(JSON.parse(l.library!).format).toBe('repackshot-library');
    expect([...l.cache.keys()]).toEqual([]);
    // The folder chosen is remembered by the launcher (state/desktop.folders.json), for the next launch's confirmation.
    expect(JSON.parse(l.docs.get('desktop.folders')!)).toEqual({ 'd-renders': '/home/a/Renders' });
  });

  it('without the launcher it is the web platform, on the browser storage', async () => {
    const p = await choosePlatform({ native: null });
    expect(p.kind).toBe('web');
    expect(p.native).toBeNull();
    expect(p.dialogs(() => undefined)).toBeNull();
    expect(p.files({ handles: { putHandle: async () => undefined, getHandle: async () => null }, download: () => undefined, folderTitle: () => '', confirmTitle: () => '', folderItem: () => '', onDialogError: () => undefined }).canChooseFolder).toBe(true);
    expect(touched).toContain('showDirectoryPicker');
    expect(p.settings.initial.doc.settings['general.lang']).toBe('es');
    expect(p.storage.kind).toBe('browser');
    expect(touched).toContain('window.localStorage');
  });
});

describe('the migration from the browser happens once', () => {
  it('copies the settings, the library, the small things and the results history, then never reads them again', async () => {
    const l: FakeLauncher = fakeLauncher();
    const touched: string[] = [];
    const library = exportLibrary(emptyLibrary());
    const ls = spyStorage(
      {
        // The loose preferences of an old version (no document yet), the library, the downloads to resume, a
        // thumbnail (a cache: not copied) and an entry of another phase.
        'repackshot.lang': '"es"',
        'repackshot.ui.leftWidth': '300',
        'repackshot.library': library,
        'repackshot.models.downloads': JSON.stringify({ keys: ['ZIMAGE_Q4'] }),
        'repackshot.desktop.folders': JSON.stringify({ f1: '/home/a/Renders' }),
        'repackshot.thumb.v2.preset:gold': 'data:x',
        'other.app': 'x',
      },
      touched,
    );
    const idb = spyIdb([{ meta: meta('r1', 10), blobs: { file: new Blob(['one'], { type: 'image/png' }), display: null } }, { meta: { ...meta('r2', 20), format: 'EXR' }, blobs: { file: new Blob(['exr'], { type: 'image/x-exr' }), display: new Blob(['pic'], { type: 'image/png' }) } }], touched);
    const browser = { localStorage: () => ls, indexedDB: () => idb, storageManager: () => (touched.push('navigator.storage'), undefined), onStorage: () => touched.push('onStorage') };

    const first = await choosePlatform({ native: l.client, browser });
    // What the interface reads at once is already the migrated state.
    expect(first.settings.initial.doc.settings['general.lang']).toBe('es');
    expect(first.settings.initial.doc.layout.leftWidth).toBe(300);
    expect(first.library.initial.status).toBe('ok');
    expect(first.memory.getItem('repackshot.models.downloads')).toBe(JSON.stringify({ keys: ['ZIMAGE_Q4'] }));
    // The history waits for the results to be copied.
    const results = await first.openResults({ count: 50, bytes: 1e9 });
    expect((await results.list()).map((m) => m.id)).toEqual(['r2', 'r1']);
    expect(await (await results.get('r2'))!.display!.text()).toBe('pic');
    expect(await (await results.get('r2'))!.file.text()).toBe('exr');
    await settled();
    expect(JSON.parse(l.settings!).settings['general.lang']).toBe('es');
    expect(l.library).toBe(library);
    expect(l.docs.get('models.downloads')).toBe(JSON.stringify({ keys: ['ZIMAGE_Q4'] }));
    expect(l.docs.get('desktop.folders')).toBe(JSON.stringify({ f1: '/home/a/Renders' }));
    expect([...l.docs.keys()].some((k) => k.includes('thumb') || k.includes('lang') || k.includes('ui.'))).toBe(false);
    const mark = JSON.parse(l.docs.get(MIGRATION_DOC)!) as { copied: string[]; failed: string[] };
    expect(mark.failed).toEqual([]);
    expect(mark.copied).toEqual(expect.arrayContaining(['repackshot.settings', 'repackshot.library', 'result:r1', 'result:r2']));
    // The browser's copy is left as it was (an older version still finds its own).
    expect(ls.data.get('repackshot.lang')).toBe('"es"');
    expect(touched.some((x) => x.startsWith('localStorage.setItem') || x.startsWith('localStorage.removeItem'))).toBe(false);

    // The next launch: the mark is there, the browser is not looked at, and the launcher's state wins even
    // over a browser that has something else now.
    touched.length = 0;
    ls.data.set('repackshot.settings', JSON.stringify({ schema: 3, settings: { 'general.lang': 'en' }, layout: {} }));
    const second = await choosePlatform({ native: l.client, browser });
    expect(second.settings.initial.doc.settings['general.lang']).toBe('es');
    expect((await (await second.openResults({ count: 50, bytes: 1e9 })).list()).length).toBe(2);
    await second.hardware();
    expect(touched).toEqual([]);
  });

  it('an empty origin (what users of v0.1.x have: each launch had another port) only leaves the mark', async () => {
    const l = fakeLauncher();
    const touched: string[] = [];
    const p = await choosePlatform({ native: l.client, browser: { localStorage: () => spyStorage({}, touched), indexedDB: () => spyIdb([], touched) } });
    expect(p.settings.initial.doc.settings).toEqual(defaultSettings());
    expect(p.library.initial.status).toBe('empty');
    expect(await (await p.openResults({ count: 50, bytes: 1e9 })).list()).toEqual([]);
    expect(JSON.parse(l.docs.get(MIGRATION_DOC)!)).toMatchObject({ from: 'browser', copied: [], failed: [] });
    expect(l.settings).toBeNull();
    expect(l.library).toBeNull();
    // No storage at all (blocked, or none in this browser) is the same.
    const l2 = fakeLauncher();
    const p2 = await choosePlatform({
      native: l2.client,
      browser: {
        localStorage: () => {
          throw new Error('blocked');
        },
        indexedDB: () => undefined,
      },
    });
    await p2.openResults({ count: 50, bytes: 1e9 });
    expect(JSON.parse(l2.docs.get(MIGRATION_DOC)!)).toMatchObject({ copied: [], failed: [] });
  });

  it('what the launcher has already is never overwritten by the browser', async () => {
    const l = fakeLauncher();
    l.settings = JSON.stringify({ ...migrateDoc(null), settings: { ...defaultSettings(), 'general.theme': 'light' } });
    l.library = exportLibrary(emptyLibrary());
    const ls = spyStorage({ 'repackshot.settings': JSON.stringify({ schema: 3, settings: { 'general.theme': 'dark' }, layout: {} }), 'repackshot.library': '{"format":"repackshot-library","schema":1,"items":[]}' });
    const p = await choosePlatform({ native: l.client, browser: { localStorage: () => ls, indexedDB: () => undefined } });
    expect(p.settings.initial.doc.settings['general.theme']).toBe('light');
    await (await p.openResults({ count: 1, bytes: 1 })).list();
    expect(JSON.parse(l.settings).settings['general.theme']).toBe('light');
    expect(l.docs.has(MIGRATION_DOC)).toBe(true);
  });
});

describe('writes through the launcher', () => {
  it('go in order per key, the newest value winning, one at a time', async () => {
    const sent: string[] = [];
    let inFlight = 0;
    let most = 0;
    const slow = async (text: string) => {
      inFlight++;
      most = Math.max(most, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      sent.push(text);
      inFlight--;
    };
    const kv = new LauncherKeyValue({ putSettings: slow, deleteSettings: async () => undefined, putLibrary: slow, deleteLibrary: async () => undefined, putDoc: async (_n, t) => slow(t), deleteDoc: async () => undefined }, []);
    for (let i = 1; i <= 5; i++) kv.setItem('repackshot.settings', `{"v":${i}}`);
    expect(kv.getItem('repackshot.settings')).toBe('{"v":5}');
    await kv.idle();
    expect(most).toBe(1);
    // The first went at once; the four that came while it was on the way are one write of the last.
    expect(sent).toEqual(['{"v":1}', '{"v":5}']);
  });

  it('a refused write is reported, with what it was', async () => {
    const l = fakeLauncher();
    l.docs.set(MIGRATION_DOC, '{}');
    l.failing.add('/api/store/library');
    const p = await choosePlatform({ native: l.client });
    const errors: string[] = [];
    p.onWriteError((what) => errors.push(what));
    p.library.save(emptyLibrary());
    await settled();
    await settled();
    expect(errors).toEqual(['library']);
  });

  it('a document the launcher did not give at start is never overwritten from factory values', async () => {
    const l = fakeLauncher();
    l.docs.set(MIGRATION_DOC, '{}');
    l.settings = JSON.stringify({ schema: 3, settings: { 'general.lang': 'es' }, layout: {} });
    l.failing.add('GET /api/store/settings');
    const p = await choosePlatform({ native: l.client });
    const errors: string[] = [];
    p.onWriteError((what) => errors.push(what));
    expect(p.settings.initial.doc.settings['general.lang']).toBe('en');
    p.settings.save(p.settings.initial.doc);
    p.memory.setItem('repackshot.models.downloads', '{}');
    await settled();
    expect(JSON.parse(l.settings!).settings['general.lang']).toBe('es');
    expect(errors).toEqual(['settings']);
    // What was read is written as usual.
    expect(l.docs.get('models.downloads')).toBe('{}');
  });

  it('thumbnail keys become names the launcher keeps', () => {
    expect(thumbName('preset:gold')).toMatch(/^t[0-9a-f]{40}$/);
    expect(thumbName('preset:gold')).toBe(thumbName('preset:gold'));
    expect(thumbName('preset:gold')).not.toBe(thumbName('preset:silver'));
  });
});

describe('the results history on the desktop', () => {
  it('keeps its limits by deleting through the launcher, oldest first', async () => {
    const l = fakeLauncher();
    const store = launcherResultsStore(new (await import('../src/io/native-store')).NativeStore(l.client), { count: 2, bytes: 1e9 });
    for (const [id, at] of [
      ['r1', 1],
      ['r2', 2],
    ] as const)
      await store.add(meta(id, at), new Blob(['x'], { type: 'image/png' }), null);
    expect(await store.add(meta('r3', 3), new Blob(['x'], { type: 'image/png' }), null)).toEqual(['r1']);
    expect([...l.results.keys()].sort()).toEqual(['r2', 'r3']);
    expect(await store.setLimits!({ count: 1, bytes: 1e9 })).toEqual(['r2']);
    expect((await store.list()).map((m) => m.id)).toEqual(['r3']);
    expect(await store.get('r9')).toBeNull();
    await store.clear();
    expect(await store.list()).toEqual([]);
    expect(vi.isMockFunction(store.add)).toBe(false);
  });
});
