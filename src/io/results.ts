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

import { evictionPlan, HISTORY_LIMITS, sortResults, type HistoryLimits, type ResultMeta } from '../core/results';

export interface StoredBlobs {
  file: Blob;
  display: Blob | null;
  /** The image the AI post-processing made (AI-POST.md §4); absent when the result has none. */
  ai?: Blob | null;
}

export interface ResultsStore {
  readonly persistent: boolean;
  list(): Promise<ResultMeta[]>;
  add(meta: ResultMeta, file: Blob, display: Blob | null, ai?: Blob | null): Promise<string[]>;
  get(id: string): Promise<StoredBlobs | null>;
  remove(id: string): Promise<void>;
  clear(): Promise<void>;
  /** Folder handles (FileSystemDirectoryHandle), structured-cloned as they are. */
  putHandle(id: string, handle: unknown): Promise<void>;
  getHandle(id: string): Promise<unknown>;
  /** New limits (Settings ▸ Storage): what no longer fits is evicted now, oldest first; returns those ids. */
  setLimits(limits: HistoryLimits): Promise<string[]>;
}

const blobBytes = (file: Blob, display: Blob | null, ai?: Blob | null): number => file.size + (display?.size ?? 0) + (ai?.size ?? 0);

/** The history in memory only: same behaviour and limits, gone with the page. */
export function memoryResultsStore(initialLimits: HistoryLimits = HISTORY_LIMITS): ResultsStore {
  let limits = initialLimits;
  const metas = new Map<string, ResultMeta>();
  const blobs = new Map<string, StoredBlobs>();
  const handles = new Map<string, unknown>();
  return {
    persistent: false,
    list: async () => sortResults([...metas.values()]),
    async add(meta, file, display, ai) {
      const m = { ...meta, bytes: blobBytes(file, display, ai) };
      metas.set(m.id, m);
      blobs.set(m.id, ai ? { file, display, ai } : { file, display });
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
    async add(meta, file, display, ai) {
      const m = { ...meta, bytes: blobBytes(file, display, ai) };
      const tx = db.transaction(['meta', 'blobs'], 'readwrite');
      tx.objectStore('meta').put(m);
      tx.objectStore('blobs').put((ai ? { file, display, ai } : { file, display }) satisfies StoredBlobs, m.id);
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
