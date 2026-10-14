// Where installed plugins are kept (ROADMAP P6 decisions 1 and 2): IndexedDB, in the browser and in the desktop's
// WebView2 alike. One database, two object stores: `packages`, the `.rpk` exactly as it was downloaded or chosen
// (encrypted: it is never written in clear), and `keys`, its activation key, apart. Both are written in one
// transaction, so a package is never kept without its key nor a key without its package. Without IndexedDB (a
// private window, blocked site data) the plugins live in memory for the session and `persistent` says so.

export interface StoredPlugin {
  id: string;
  version: string;
  /** The package, encrypted, as it arrived. */
  bytes: ArrayBuffer;
  /** Hex SHA-256 of the package file. */
  sha256: string;
  source: 'registry' | 'file';
  /** Milliseconds since 1970. */
  installedAt: number;
}

export type StoredPluginInfo = Omit<StoredPlugin, 'bytes'> & { size: number };

export interface PluginStore {
  readonly persistent: boolean;
  list(): Promise<StoredPluginInfo[]>;
  get(id: string): Promise<StoredPlugin | null>;
  key(id: string): Promise<string | null>;
  /** The package and its key, together. */
  put(plugin: StoredPlugin, key: string): Promise<void>;
  remove(id: string): Promise<void>;
}

const info = (p: StoredPlugin): StoredPluginInfo => ({ id: p.id, version: p.version, sha256: p.sha256, source: p.source, installedAt: p.installedAt, size: p.bytes.byteLength });

export function memoryPluginStore(): PluginStore {
  const packages = new Map<string, StoredPlugin>();
  const keys = new Map<string, string>();
  return {
    persistent: false,
    list: async () => [...packages.values()].map(info).sort((a, b) => (a.id < b.id ? -1 : 1)),
    get: async (id) => packages.get(id) ?? null,
    key: async (id) => keys.get(id) ?? null,
    async put(p, key) {
      packages.set(p.id, { ...p, bytes: p.bytes.slice(0) });
      keys.set(p.id, key);
    },
    async remove(id) {
      packages.delete(id);
      keys.delete(id);
    },
  };
}

const DB_NAME = 'repackshot-plugins';
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

function openDb(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let r: IDBOpenDBRequest;
    try {
      r = factory.open(DB_NAME, DB_VERSION);
    } catch (err) {
      reject(err);
      return;
    }
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('packages')) db.createObjectStore('packages', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('keys')) db.createObjectStore('keys', { keyPath: 'id' });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error('IndexedDB did not open'));
    r.onblocked = () => reject(new Error('IndexedDB is blocked'));
  });
}

/** The IndexedDB store, or the memory one when IndexedDB cannot be opened. */
export async function openPluginStore(factory: IDBFactory | undefined = globalThis.indexedDB): Promise<PluginStore> {
  if (!factory) return memoryPluginStore();
  let db: IDBDatabase;
  try {
    db = await openDb(factory);
  } catch {
    return memoryPluginStore();
  }
  return {
    persistent: true,
    async list() {
      const tx = db.transaction('packages', 'readonly');
      const all = (await request(tx.objectStore('packages').getAll())) as StoredPlugin[];
      return all.map(info).sort((a, b) => (a.id < b.id ? -1 : 1));
    },
    async get(id) {
      const tx = db.transaction('packages', 'readonly');
      return ((await request(tx.objectStore('packages').get(id))) as StoredPlugin | undefined) ?? null;
    },
    async key(id) {
      const tx = db.transaction('keys', 'readonly');
      return ((await request(tx.objectStore('keys').get(id))) as { id: string; key: string } | undefined)?.key ?? null;
    },
    async put(p, key) {
      const tx = db.transaction(['packages', 'keys'], 'readwrite');
      tx.objectStore('packages').put(p);
      tx.objectStore('keys').put({ id: p.id, key });
      await done(tx);
    },
    async remove(id) {
      const tx = db.transaction(['packages', 'keys'], 'readwrite');
      tx.objectStore('packages').delete(id);
      tx.objectStore('keys').delete(id);
      await done(tx);
    },
  };
}
