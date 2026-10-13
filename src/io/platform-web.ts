// The web platform (io/platform.ts): the page keeps its own state in the browser. Settings, the
// library, small remembered things and the material spheres in localStorage; the results history
// and folder handles in IndexedDB (memory when the browser keeps nothing); AI models in the
// origin's private file system through the model worker; the computer as WebGPU and the browser
// report it. Every access is wrapped: a private window or blocked storage starts the same.

import { detectWebHardware } from './hardware';
import { LIBRARY_STORAGE_KEY, loadLibrary, saveLibrary } from './library';
import { browserKeyValue, loadSettingsDoc, saveSettingsDoc, type KeyValue } from './prefs';
import type { Platform, StorageService, ThumbCache } from './platform';
import { openResultsStore } from './results';

/** localStorage with what the thumbnail cache needs to count and clear its entries. */
export type BrowserStorage = KeyValue & { readonly length: number; key(index: number): string | null };

/** The browser's storage and APIs (globals by default; tests pass doubles). */
export interface BrowserApis {
  localStorage?: () => BrowserStorage | null;
  indexedDB?: () => IDBFactory | undefined;
  /** `navigator.storage` (estimate, persisted, persist, getDirectory). */
  storageManager?: () => Partial<StorageManager> | undefined;
  /** Calls `fn` with the key of every change another tab makes to localStorage. */
  onStorage?: (fn: (key: string | null) => void) => void;
}

/** The globals, read only when asked for (the desktop never asks after its one migration). */
export function browserApis(over: BrowserApis = {}): Required<BrowserApis> {
  return {
    localStorage: over.localStorage ?? (() => browserKeyValue() as BrowserStorage | null),
    indexedDB: over.indexedDB ?? (() => (typeof indexedDB === 'undefined' ? undefined : indexedDB)),
    storageManager: over.storageManager ?? (() => (typeof navigator === 'undefined' ? undefined : navigator.storage)),
    onStorage:
      over.onStorage ??
      ((fn) => {
        if (typeof window !== 'undefined') window.addEventListener('storage', (e) => fn(e.key));
      }),
  };
}

export const THUMB_PREFIX = 'repackshot.thumb.';
const THUMB_KEY = `${THUMB_PREFIX}v2.`;

/** The material spheres in localStorage (`repackshot.thumb.v2.<key>`). */
export function localThumbCache(ls: () => BrowserStorage | null): ThumbCache & { bytes(): number; clear(): number } {
  const bytes = () => {
    try {
      const s = ls();
      if (!s) return 0;
      let n = 0;
      for (let i = 0; i < s.length; i++) {
        const k = s.key(i);
        if (k?.startsWith(THUMB_PREFIX)) n += (k.length + (s.getItem(k)?.length ?? 0)) * 2;
      }
      return n;
    } catch {
      return 0;
    }
  };
  return {
    get(key) {
      try {
        return ls()?.getItem(THUMB_KEY + key) ?? null;
      } catch {
        return null;
      }
    },
    set(key, url) {
      try {
        ls()?.setItem(THUMB_KEY + key, url);
      } catch {
        // Full or blocked storage: the sphere is just rendered again next time.
      }
    },
    bytes,
    // Every version of the cache; the bytes freed.
    clear() {
      const before = bytes();
      try {
        const s = ls();
        if (!s) return 0;
        const keys: string[] = [];
        for (let i = 0; i < s.length; i++) {
          const k = s.key(i);
          if (k?.startsWith(THUMB_PREFIX)) keys.push(k);
        }
        for (const k of keys) s.removeItem(k);
      } catch {
        return 0;
      }
      return before - bytes();
    },
  };
}

/** A key-value store in memory (a browser that keeps nothing). */
export function memoryKeyValue(): KeyValue {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
}

export function webPlatform(over: BrowserApis = {}): Platform {
  const apis = browserApis(over);
  const kv = apis.localStorage();
  const memory = kv ?? memoryKeyValue();
  const thumbs = localThumbCache(apis.localStorage);
  const sm = () => {
    try {
      return apis.storageManager();
    } catch {
      return undefined;
    }
  };
  const storage: StorageService = {
    kind: 'browser',
    async estimate() {
      try {
        const e = await sm()?.estimate?.();
        return e && typeof e.usage === 'number' && typeof e.quota === 'number' ? { usage: e.usage, quota: e.quota } : null;
      } catch {
        return null;
      }
    },
    async persisted() {
      try {
        const m = sm();
        return typeof m?.persisted === 'function' ? await m.persisted() : null;
      } catch {
        return null;
      }
    },
    async persist() {
      try {
        const m = sm();
        return typeof m?.persist === 'function' ? await m.persist() : null;
      } catch {
        return null;
      }
    },
    async libraryBytes() {
      try {
        return (kv?.getItem(LIBRARY_STORAGE_KEY)?.length ?? 0) * 2;
      } catch {
        return 0;
      }
    },
    cacheBytes: async () => thumbs.bytes(),
    clearCache: async () => thumbs.clear(),
    usage: async () => null,
  };
  const hasOpfs = typeof sm()?.getDirectory === 'function';
  return {
    kind: 'web',
    native: null,
    settings: {
      initial: loadSettingsDoc(kv),
      save: (doc) => void saveSettingsDoc(doc, kv),
    },
    memory,
    library: {
      initial: loadLibrary(kv),
      save: (lib) => saveLibrary(lib, kv),
      reload: () => loadLibrary(kv),
    },
    openResults: (limits) => openResultsStore(limits),
    modelStore: async (local) => (hasOpfs ? local : null),
    pendingModels: async () => null,
    requestPersistence: async () => (await storage.persist()) ?? false,
    hardware: () => detectWebHardware(),
    storage,
    thumbs,
    onLibraryChange: (fn) => apis.onStorage((key) => key === LIBRARY_STORAGE_KEY && fn()),
    // localStorage throws at once: a failed save is seen where it happens (library.ts says `failed`).
    onWriteError: () => undefined,
    flush: () => undefined,
  };
}
