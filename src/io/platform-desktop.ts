// The desktop platform (io/platform.ts): in the launcher's window the page is only the interface.
// Every byte it keeps is the launcher's (engine/crates/rt-app/src/appdata.rs), in the data folder:
//
//   repackshot.settings     → settings.json            (the settings document)
//   repackshot.library      → library/library.json     (the user's library)
//   repackshot.<name>       → state/<name>.json        (small things: the downloads to resume…)
//   results history         → results/<id>.<ext> + results/index.json
//   material spheres        → cache/thumbs/<key>.txt
//   AI models               → models/                  (io/model-store.ts, already the launcher's)
//   the computer            → GET /api/hardware        (never WebGPU)
//   space used              → GET /api/storage/usage
//
// Reads are answered at once from what was loaded at start (one request each for the settings,
// the library and the small documents); writes go through to the launcher in order, one at a
// time per document, the last value winning. The browser's storage (localStorage, IndexedDB,
// navigator.storage) is never used, except once: when the data folder has no migration mark, what
// an older version left in this origin's storage is copied over (what the launcher does not have
// already), and the mark is written. The browser's copy is left as it was.

import { sha256Hex } from '../core/sha256';
import { createDesktopDialogs, createDesktopFiles, createDesktopProjectFiles, hashNativeFile, NativeFile } from './desktop-files';
import { createFiles } from './files';
import { LEGACY_PREF_KEYS } from '../core/settings';
import { fromNativeHardware } from './hardware';
import { LIBRARY_STORAGE_KEY, loadLibrary, saveLibrary } from './library';
import { nativeModelStore } from './model-store';
import { createProjectFiles } from './project-file';
import type { NativeClient } from './native';
import { NativeStore, STORE_NAME_RE } from './native-store';
import type { Platform, StorageService, ThumbCache } from './platform';
import { browserApis, THUMB_PREFIX, type BrowserApis, type BrowserStorage } from './platform-web';
import { loadSettingsDoc, PREFIX, saveSettingsDoc, SETTINGS_STORAGE_KEY, type KeyValue } from './prefs';
import { launcherResultsStore, readBrowserResults } from './results';

/** The data folder's mark that the browser's storage was copied over (`state/migration.json`). */
export const MIGRATION_DOC = 'migration';

/** How long the start waits for each of the launcher's documents. */
export const BOOT_TIMEOUT_MS = 10000;

type WriteKind = 'settings' | 'library' | 'memory';

/** The part of the launcher's store the key-value facade uses. */
export type LauncherKvApi = Pick<NativeStore, 'putSettings' | 'deleteSettings' | 'putLibrary' | 'deleteLibrary' | 'putDoc' | 'deleteDoc'>;

/** The document a key goes to, or null when it is not a name the launcher keeps (kept in memory only). */
function docOf(key: string): { kind: 'settings' } | { kind: 'library' } | { kind: 'doc'; name: string } | null {
  if (key === SETTINGS_STORAGE_KEY) return { kind: 'settings' };
  if (key === LIBRARY_STORAGE_KEY) return { kind: 'library' };
  if (!key.startsWith(PREFIX)) return null;
  const name = key.slice(PREFIX.length);
  return STORE_NAME_RE.test(name) && !name.includes('..') ? { kind: 'doc', name } : null;
}

const isJson = (text: string): boolean => {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
};

/**
 * `KeyValue` over the launcher: `getItem` answers from the snapshot taken at start, `setItem` and `removeItem`
 * change it at once and write through (per key in order, the newest value winning, never two writes of one
 * key at the same time). A write that fails is reported once per failure through `onError`.
 */
export class LauncherKeyValue implements KeyValue {
  private readonly data: Map<string, string>;
  private readonly dirty = new Set<string>();
  private readonly running = new Map<string, Promise<void>>();
  /** Keys whose newest value the launcher has not confirmed yet (sent again by `flush`). */
  private readonly unconfirmed = new Set<string>();

  /**
   * `unread`: the documents the launcher could not be asked for at start (`settings`, `library`, `docs`). They are
   * never written in this session: a write from factory values would replace what the person has.
   */
  constructor(
    private readonly api: LauncherKvApi,
    initial: Iterable<[string, string]>,
    private readonly onError: (kind: WriteKind, key: string, err: unknown) => void = () => undefined,
    private readonly unread: ReadonlySet<'settings' | 'library' | 'docs'> = new Set(),
  ) {
    this.data = new Map(initial);
  }

  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.data.set(key, String(value));
    this.write(key);
  }

  removeItem(key: string): void {
    if (!this.data.has(key)) return;
    this.data.delete(key);
    this.write(key);
  }

  /** Every key held now. */
  keys(): string[] {
    return [...this.data.keys()];
  }

  /** Resolves when no write is under way. */
  async idle(): Promise<void> {
    while (this.running.size > 0) await Promise.all([...this.running.values()]);
  }

  /** Sends what is not confirmed yet so that it outlives the page (fetch `keepalive`, small bodies). */
  flush(): void {
    for (const key of this.unconfirmed) void this.send(key, true).catch(() => undefined);
  }

  private send(key: string, keepalive = false): Promise<void> {
    const doc = docOf(key);
    if (!doc) return Promise.resolve();
    const value = this.data.get(key);
    // A document is JSON; the few texts that are not (a damaged entry kept aside) go as a JSON string.
    const text = value === undefined ? null : isJson(value) ? value : JSON.stringify(value);
    switch (doc.kind) {
      case 'settings':
        return text === null ? this.api.deleteSettings() : this.api.putSettings(text, keepalive);
      case 'library':
        return text === null ? this.api.deleteLibrary() : this.api.putLibrary(text, keepalive);
      case 'doc':
        return text === null ? this.api.deleteDoc(doc.name) : this.api.putDoc(doc.name, text, keepalive);
    }
  }

  private write(key: string): void {
    const doc = docOf(key);
    if (!doc) {
      console.warn(`not kept by the launcher (not a store name): ${key}`);
      return;
    }
    if (this.unread.has(doc.kind === 'doc' ? 'docs' : doc.kind)) {
      this.onError(doc.kind === 'doc' ? 'memory' : doc.kind, key, new Error('not read at start: kept for this session only'));
      return;
    }
    this.dirty.add(key);
    this.unconfirmed.add(key);
    if (this.running.has(key)) return;
    const run = async () => {
      while (this.dirty.has(key)) {
        this.dirty.delete(key);
        try {
          await this.send(key);
          if (!this.dirty.has(key)) this.unconfirmed.delete(key);
        } catch (err) {
          const kind: WriteKind = doc.kind === 'doc' ? 'memory' : doc.kind;
          // A damaged copy kept aside is not worth a word to the person.
          if (!key.endsWith('.corrupt')) this.onError(kind, key, err);
          console.warn(`the launcher did not keep ${key}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      this.running.delete(key);
    };
    this.running.set(key, run());
  }
}

/** What the browser's storage of this origin holds that the launcher should have: one copy, then never again. */
export async function migrateFromBrowser(
  store: Pick<NativeStore, 'results' | 'putResult' | 'putDoc'>,
  kv: LauncherKeyValue,
  browser: Required<BrowserApis>,
  timeoutMs = 8000,
): Promise<{ copied: string[]; failed: string[] }> {
  const copied: string[] = [];
  const failed: string[] = [];
  let ls: BrowserStorage | null = null;
  try {
    ls = browser.localStorage();
  } catch {
    ls = null;
  }
  if (ls) {
    const local = ls;
    const read = (k: string): string | null => {
      try {
        return local.getItem(k);
      } catch {
        return null;
      }
    };
    // The settings: the document, or the loose preferences of before; read without writing to the browser.
    if (kv.getItem(SETTINGS_STORAGE_KEY) === null && (read(SETTINGS_STORAGE_KEY) !== null || LEGACY_PREF_KEYS.some((k) => read(PREFIX + k) !== null))) {
      const { doc } = loadSettingsDoc({ getItem: read, setItem: () => undefined, removeItem: () => undefined });
      saveSettingsDoc(doc, kv);
      copied.push(SETTINGS_STORAGE_KEY);
    }
    // Every other entry of ours the launcher does not have: the library, the downloads to resume…
    // (not the thumbnails: a cache; not the loose preferences: they went into the settings).
    const skip = new Set([SETTINGS_STORAGE_KEY, ...LEGACY_PREF_KEYS.map((k) => PREFIX + k)]);
    let keys: string[] = [];
    try {
      for (let i = 0; i < local.length; i++) {
        const k = local.key(i);
        if (k) keys.push(k);
      }
    } catch {
      keys = [];
    }
    for (const k of keys.sort()) {
      if (!k.startsWith(PREFIX) || k.startsWith(THUMB_PREFIX) || k.endsWith('.corrupt') || skip.has(k) || kv.getItem(k) !== null || !docOf(k)) continue;
      const v = read(k);
      if (v === null) continue;
      kv.setItem(k, v);
      copied.push(k);
    }
  }
  // The results history of IndexedDB, result by result (what the launcher has already is left).
  try {
    const old = await within(readBrowserResults(browser.indexedDB()), timeoutMs);
    if (old && old.length > 0) {
      const have = new Set((await store.results()).map((m) => (m as { id?: string }).id));
      for (const { meta, blobs } of old) {
        if (have.has(meta.id)) continue;
        try {
          await store.putResult(meta.id, meta, blobs.file, blobs.display, blobs.ai ?? null, blobs.aiMore ?? []);
          copied.push(`result:${meta.id}`);
        } catch (err) {
          failed.push(`result:${meta.id}`);
          console.warn(`result ${meta.id} not copied to the launcher: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }
  } catch (err) {
    failed.push('results');
    console.warn(`the browser's results history was not read: ${err instanceof Error ? err.message : String(err)}`);
  }
  await kv.idle();
  await store.putDoc(MIGRATION_DOC, JSON.stringify({ from: 'browser', at: Date.now(), copied, failed }));
  return { copied, failed };
}

function within<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    p.then(
      (v) => (clearTimeout(timer), resolve(v)),
      (e) => (clearTimeout(timer), reject(e)),
    );
  });
}

/** A thumbnail key as a name of the launcher's store: arbitrary text, hashed. */
export function thumbName(key: string): string {
  return `t${sha256Hex(new TextEncoder().encode(key)).slice(0, 40)}`;
}

export async function desktopPlatform(native: NativeClient, over: BrowserApis = {}): Promise<Platform> {
  const store = new NativeStore(native);
  const writeErrors = new Set<(what: WriteKind, err: unknown) => void>();
  // What the launcher keeps, loaded at once. A launcher that cannot answer leaves the page with its factory
  // values for this session (and its writes report the failure).
  // A document that could not be read is not written either (LauncherKeyValue's `unread`), and the migration waits
  // for a launch that answers.
  const unread = new Set<'settings' | 'library' | 'docs'>();
  const read = <T>(what: 'settings' | 'library' | 'docs', p: Promise<T>, none: T): Promise<T> =>
    within(p, BOOT_TIMEOUT_MS).catch((err: unknown) => {
      unread.add(what);
      console.warn(`the launcher did not give the ${what}: ${err instanceof Error ? err.message : String(err)}`);
      return none;
    });
  const [settings, library, docs] = await Promise.all([read('settings', store.settings(), null), read('library', store.library(), null), read('docs', store.docs(), {} as Record<string, unknown>)]);
  const initial: [string, string][] = [];
  if (settings !== null) initial.push([SETTINGS_STORAGE_KEY, settings]);
  if (library !== null) initial.push([LIBRARY_STORAGE_KEY, library]);
  for (const [name, value] of Object.entries(docs)) if (name !== MIGRATION_DOC) initial.push([PREFIX + name, JSON.stringify(value)]);
  const kv = new LauncherKeyValue(store, initial, (kind, _key, err) => writeErrors.forEach((fn) => fn(kind, err)), unread);

  // Once per data folder: what an older version left in the browser. The results upload in the background
  // (the history waits for them); everything else is in the snapshot before the interface reads it.
  let migration: Promise<unknown> = Promise.resolve();
  if (unread.size === 0 && !(MIGRATION_DOC in docs)) {
    migration = migrateFromBrowser(store, kv, browserApis(over)).catch((err: unknown) => console.warn(`migration from the browser's storage: ${err instanceof Error ? err.message : String(err)}`));
  }

  const usage = () => store.usage();
  const part = async (id: string) => (await usage().catch(() => null))?.folders.find((f) => f.id === id)?.bytes ?? 0;
  const storage: StorageService = {
    kind: 'folder',
    estimate: async () => null,
    persisted: async () => null,
    persist: async () => null,
    libraryBytes: () => part('library'),
    cacheBytes: () => part('thumbs'),
    clearCache: () => store.cacheClear(),
    usage: () => usage().catch(() => null),
  };
  const thumbs: ThumbCache = {
    get: (key) => store.cacheGet(thumbName(key)).catch(() => null),
    set: (key, url) => void store.cachePut(thumbName(key), url).catch(() => undefined),
  };
  return {
    kind: 'desktop',
    native,
    settings: {
      initial: loadSettingsDoc(kv),
      save: (doc, opts) => {
        saveSettingsDoc(doc, kv);
        if (opts?.final) kv.flush();
      },
    },
    memory: kv,
    library: {
      initial: loadLibrary(kv),
      save: (lib) => saveLibrary(lib, kv),
      reload: () => loadLibrary(kv),
    },
    async openResults(limits) {
      await migration;
      return launcherResultsStore(store, limits);
    },
    // A file chosen in the launcher's dialog stays there (tens of GB): the launcher hashes it.
    modelStore: async (local) => nativeModelStore(native, (blob, onProgress) => (blob instanceof NativeFile ? hashNativeFile(native, blob, onProgress) : local.hash(blob, onProgress))),
    // The launcher's dialogs and file API (P3b). A launcher without them (older than P3b) keeps the browser's
    // pickers, with handles for the session only: they cannot be written into the data folder.
    files: (o) =>
      native.hasFiles
        ? createDesktopFiles(native, { folderTitle: o.folderTitle, confirmTitle: o.confirmTitle, folderItem: o.folderItem, onDialogError: o.onDialogError, memory: kv })
        : createFiles(o.handles, o.download, globalThis as unknown as { showDirectoryPicker?: unknown; isSecureContext?: boolean }),
    projectFiles: (o) =>
      native.hasFiles
        ? createDesktopProjectFiles(native, { description: o.description, openTitle: o.openTitle, saveTitle: o.saveTitle, allFiles: o.allFiles, onDialogError: o.onDialogError })
        : createProjectFiles(globalThis as never, o.download, { description: o.description, remember: o.remember }),
    dialogs: (onDialogError) => (native.hasFiles ? createDesktopDialogs(native, onDialogError) : null),
    pendingModels: () => native.pendingModels().catch(() => null),
    requestPersistence: async () => true,
    hardware: async (again) => fromNativeHardware(await native.hardware(undefined, again === true)),
    storage,
    thumbs,
    // One window per page; another window of the same launcher keeps its own snapshot.
    onLibraryChange: () => undefined,
    onWriteError: (fn) => void writeErrors.add(fn),
    flush: () => kv.flush(),
  };
}
