// The results history in the browser (UI.md §2.8): every image a render job
// wrote, as blobs plus their data, in IndexedDB (one database, three object
// stores: `meta`, `blobs` and `handles`, the last one for the folders chosen
// with the File System Access API, so their permission is remembered). The
// history keeps at most 50 results or 500 MB (core/results.ts), evicting the
// oldest first.
//
// When the browser gives no storage (a private window, blocked site data),
// everything lives in memory for the session and `persistent()` says so; the
// application starts the same.

import { needsDisplayCopy } from '../core/render';
import { evictionPlan, HISTORY_LIMITS, sortResults, type HistoryLimits, type ResultMeta } from '../core/results';

export interface StoredBlobs {
  file: Blob;
  display: Blob | null;
  /** The image the AI post-processing made (AI-POST.md §4); absent when the result has none. The first variant (X4b). */
  ai?: Blob | null;
  /** Variants 2 and on (X4b), in order; null for one the guard rejected. Absent: one variant at most (every result of before). */
  aiMore?: (Blob | null)[];
}

/** Every AI image of a result, the first variant first (null for a variant without one). */
export function blobVariants(b: Pick<StoredBlobs, 'ai' | 'aiMore'>): (Blob | null)[] {
  return b.ai === undefined && !b.aiMore ? [] : [b.ai ?? null, ...(b.aiMore ?? [])];
}

/** The blobs of a result as they are kept: `ai` and `aiMore` only when there are any. */
function stored(file: Blob, display: Blob | null, ai?: Blob | null, aiMore?: readonly (Blob | null)[]): StoredBlobs {
  const more = aiMore && aiMore.length > 0 ? { aiMore: [...aiMore] } : {};
  return ai || aiMore?.length ? { file, display, ai: ai ?? null, ...more } : { file, display };
}

export interface ResultsStore {
  readonly persistent: boolean;
  list(): Promise<ResultMeta[]>;
  /** `ai`: the AI's image (its first variant); `aiMore`: variants 2 and on, null for one the guard rejected (X4b). */
  add(meta: ResultMeta, file: Blob, display: Blob | null, ai?: Blob | null, aiMore?: readonly (Blob | null)[]): Promise<string[]>;
  get(id: string): Promise<StoredBlobs | null>;
  remove(id: string): Promise<void>;
  clear(): Promise<void>;
  /** Folder handles (FileSystemDirectoryHandle), structured-cloned as they are. */
  putHandle(id: string, handle: unknown): Promise<void>;
  getHandle(id: string): Promise<unknown>;
  /** New limits (Settings ▸ Storage): what no longer fits is evicted now, oldest first; returns those ids. */
  setLimits(limits: HistoryLimits): Promise<string[]>;
}

const blobBytes = (file: Blob, display: Blob | null, ai?: Blob | null, aiMore?: readonly (Blob | null)[]): number =>
  file.size + (display?.size ?? 0) + (ai?.size ?? 0) + (aiMore ?? []).reduce((n, b) => n + (b?.size ?? 0), 0);

/** The history in memory only: same behaviour and limits, gone with the page. */
export function memoryResultsStore(initialLimits: HistoryLimits = HISTORY_LIMITS): ResultsStore {
  let limits = initialLimits;
  const metas = new Map<string, ResultMeta>();
  const blobs = new Map<string, StoredBlobs>();
  const handles = new Map<string, unknown>();
  return {
    persistent: false,
    list: async () => sortResults([...metas.values()]),
    async add(meta, file, display, ai, aiMore) {
      const m = { ...meta, bytes: blobBytes(file, display, ai, aiMore) };
      metas.set(m.id, m);
      blobs.set(m.id, stored(file, display, ai, aiMore));
      const evict = evictionPlan([...metas.values()], limits, m.id);
      for (const id of evict) {
        metas.delete(id);
        blobs.delete(id);
      }
      return evict;
    },
    get: async (id) => blobs.get(id) ?? null,
    async remove(id) {
      metas.delete(id);
      blobs.delete(id);
    },
    async clear() {
      metas.clear();
      blobs.clear();
    },
    async putHandle(id, handle) {
      handles.set(id, handle);
    },
    getHandle: async (id) => handles.get(id) ?? null,
    async setLimits(next) {
      limits = next;
      const evict = evictionPlan([...metas.values()], limits);
      for (const id of evict) {
        metas.delete(id);
        blobs.delete(id);
      }
      return evict;
    },
  };
}

const DB_NAME = 'repackshot';
const DB_VERSION = 1;

function request<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error('IndexedDB request failed'));
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
  });
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let r: IDBOpenDBRequest;
    try {
      r = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (err) {
      reject(err);
      return;
    }
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs');
      if (!db.objectStoreNames.contains('handles')) db.createObjectStore('handles');
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error('IndexedDB unavailable'));
    r.onblocked = () => reject(new Error('IndexedDB blocked'));
  });
}

function idbResultsStore(db: IDBDatabase, initialLimits: HistoryLimits): ResultsStore {
  let limits = initialLimits;
  const metas = async (): Promise<ResultMeta[]> => {
    const tx = db.transaction('meta', 'readonly');
    return request(tx.objectStore('meta').getAll() as IDBRequest<ResultMeta[]>);
  };
  const drop = async (ids: readonly string[]): Promise<void> => {
    if (ids.length === 0) return;
    const tx = db.transaction(['meta', 'blobs'], 'readwrite');
    for (const id of ids) {
      tx.objectStore('meta').delete(id);
      tx.objectStore('blobs').delete(id);
    }
    await done(tx);
  };
  return {
    persistent: true,
    list: async () => sortResults(await metas()),
    async add(meta, file, display, ai, aiMore) {
      const m = { ...meta, bytes: blobBytes(file, display, ai, aiMore) };
      const tx = db.transaction(['meta', 'blobs'], 'readwrite');
      tx.objectStore('meta').put(m);
      // The variants go in the same record as the first (X4b): one record of blobs per result, as before.
      tx.objectStore('blobs').put(stored(file, display, ai, aiMore), m.id);
      await done(tx);
      const evict = evictionPlan(await metas(), limits, m.id);
      await drop(evict);
      return evict;
    },
    async get(id) {
      const tx = db.transaction('blobs', 'readonly');
      const v = (await request(tx.objectStore('blobs').get(id))) as StoredBlobs | undefined;
      return v ?? null;
    },
    remove: (id) => drop([id]),
    async clear() {
      const tx = db.transaction(['meta', 'blobs'], 'readwrite');
      tx.objectStore('meta').clear();
      tx.objectStore('blobs').clear();
      await done(tx);
    },
    async putHandle(id, handle) {
      const tx = db.transaction('handles', 'readwrite');
      tx.objectStore('handles').put(handle, id);
      await done(tx);
    },
    async getHandle(id) {
      const tx = db.transaction('handles', 'readonly');
      return (await request(tx.objectStore('handles').get(id))) ?? null;
    },
    async setLimits(next) {
      limits = next;
      const evict = evictionPlan(await metas(), limits);
      await drop(evict);
      return evict;
    },
  };
}

/**
 * The history in IndexedDB when the browser allows it (checked with a real write: some private
 * windows open the database and then refuse every write), in memory otherwise.
 */
export async function openResultsStore(limits: HistoryLimits = HISTORY_LIMITS): Promise<ResultsStore> {
  try {
    if (typeof indexedDB === 'undefined') throw new Error('no IndexedDB');
    const db = await openDb();
    const store = idbResultsStore(db, limits);
    await store.putHandle('__probe__', 1);
    return store;
  } catch (err) {
    console.warn(`results history kept in memory: ${err instanceof Error ? err.message : String(err)}`);
    return memoryResultsStore(limits);
  }
}

// ------------------------------------------------------------------ the desktop launcher (phase P3e)

/** The parts of the launcher's store (io/native-store.ts) the history uses. */
export interface LauncherResultsApi {
  results(): Promise<unknown[]>;
  /** `aiMore`: variants 2 and on (X4b), null for one without an image. */
  putResult(id: string, meta: unknown, file: Blob, display: Blob | null, ai?: Blob | null, aiMore?: readonly (Blob | null)[]): Promise<void>;
  /** `variant`: which AI image, 1-based (X4b), for `part` 'ai'. */
  resultFile(id: string, part?: boolean | 'ai', variant?: number): Promise<Blob | null>;
  deleteResult(id: string): Promise<void>;
  clearResults(): Promise<void>;
}

/**
 * The history on the desktop: each result is a file in `<data>/results/` with an index, written by the launcher
 * (never IndexedDB). The limits are the same rule (core/results.ts), applied here and carried out by deleting
 * through the launcher. Folder handles of the browser cannot be kept by the launcher: they last the session.
 */
export function launcherResultsStore(api: LauncherResultsApi, initialLimits: HistoryLimits = HISTORY_LIMITS): ResultsStore {
  let limits = initialLimits;
  const handles = new Map<string, unknown>();
  const metas = async (): Promise<ResultMeta[]> => (await api.results()).filter((m): m is ResultMeta => !!m && typeof (m as ResultMeta).id === 'string');
  const drop = async (ids: readonly string[]) => {
    for (const id of ids) await api.deleteResult(id);
  };
  return {
    persistent: true,
    list: async () => sortResults(await metas()),
    async add(meta, file, display, ai, aiMore) {
      const m = { ...meta, bytes: blobBytes(file, display, ai, aiMore) };
      await api.putResult(m.id, m, file, display, ai, aiMore);
      const evict = evictionPlan(await metas(), limits, m.id);
      await drop(evict);
      return evict;
    },
    async get(id) {
      const m = (await metas()).find((x) => x.id === id);
      if (!m) return null;
      const file = await api.resultFile(id);
      if (!file) return null;
      // Only a file a page cannot show (EXR, TIFF, DNG) has a picture of it. An AI image is there when the guard let one
      // through: the first variant (a result of before X4b has that one only), then the others (X4b).
      const display = needsDisplayCopy(m.format) ? await api.resultFile(id, true) : null;
      const ai = m.ai && m.ai.bytes > 0 ? await api.resultFile(id, 'ai', 1) : null;
      const more: (Blob | null)[] = [];
      for (const [i, v] of (m.aiMore ?? []).entries()) more.push(v && v.bytes > 0 ? await api.resultFile(id, 'ai', i + 2) : null);
      return m.ai || more.length > 0 ? stored(file, display, ai, more) : { file, display };
    },
    remove: (id) => api.deleteResult(id),
    clear: () => api.clearResults(),
    async putHandle(id, handle) {
      handles.set(id, handle);
    },
    getHandle: async (id) => handles.get(id) ?? null,
    async setLimits(next) {
      limits = next;
      const evict = evictionPlan(await metas(), limits);
      await drop(evict);
      return evict;
    },
  };
}

/**
 * What an older version left in this origin's IndexedDB, for the desktop's one migration to the launcher
 * (io/platform-desktop.ts): every record with its blobs. Never creates the database: where the browser can say
 * which databases exist and `repackshot` is not one of them, nothing is opened. Null when there is nothing.
 */
export async function readBrowserResults(idb: IDBFactory | undefined = typeof indexedDB === 'undefined' ? undefined : indexedDB): Promise<{ meta: ResultMeta; blobs: StoredBlobs }[] | null> {
  if (!idb) return null;
  if (typeof idb.databases === 'function') {
    const known = await idb.databases().catch(() => null);
    if (known && !known.some((d) => d.name === DB_NAME)) return null;
  }
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const r = idb.open(DB_NAME);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error('IndexedDB unavailable'));
    r.onblocked = () => reject(new Error('IndexedDB blocked'));
    // A database that did not exist is not made here.
    r.onupgradeneeded = () => r.transaction?.abort();
  });
  try {
    if (!db.objectStoreNames.contains('meta') || !db.objectStoreNames.contains('blobs')) return null;
    const tx = db.transaction(['meta', 'blobs'], 'readonly');
    const list = (await request(tx.objectStore('meta').getAll() as IDBRequest<ResultMeta[]>)) ?? [];
    const out: { meta: ResultMeta; blobs: StoredBlobs }[] = [];
    for (const meta of list) {
      const blobs = (await request(db.transaction('blobs', 'readonly').objectStore('blobs').get(meta.id))) as StoredBlobs | undefined;
      if (blobs?.file) out.push({ meta, blobs });
    }
    return out;
  } finally {
    db.close();
  }
}
