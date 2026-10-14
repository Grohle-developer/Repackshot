// Where installed plugins are kept (ROADMAP P6 decisions 1 and 2): IndexedDB, in the browser and in the desktop's
// WebView2 alike. One database, three object stores: `packages`, the `.rpk` exactly as it was downloaded or chosen
// (encrypted: it is never written in clear), and `keys`, its activation key, apart. Both are written in one
// transaction, so a package is never kept without its key nor a key without its package. `thumbs` (version 2,
// decision 8) keeps the pictures of the recipe cards, made once per plugin version and recipe: what the plugin
// gave for its base picture, a PNG (no code, nothing of the package in clear); removing a plugin removes them.
// Without IndexedDB (a private window, blocked site data) the plugins live in memory for the session and
// `persistent` says so.

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
  /** The package, its key and its recipe cards' pictures. */
  remove(id: string): Promise<void>;
  /** A recipe card's picture (`thumbKey`), or null. */
  thumb(key: string): Promise<Blob | null>;
  putThumb(key: string, plugin: string, blob: Blob): Promise<void>;
}

const info = (p: StoredPlugin): StoredPluginInfo => ({ id: p.id, version: p.version, sha256: p.sha256, source: p.source, installedAt: p.installedAt, size: p.bytes.byteLength });

export function memoryPluginStore(): PluginStore {
  const packages = new Map<string, StoredPlugin>();
  const keys = new Map<string, string>();
  const thumbs = new Map<string, { plugin: string; blob: Blob }>();
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
      for (const [k, v] of thumbs) if (v.plugin === id) thumbs.delete(k);
    },
    thumb: async (key) => thumbs.get(key)?.blob ?? null,
    async putThumb(key, plugin, blob) {
      thumbs.set(key, { plugin, blob });
    },
  };
}

const DB_NAME = 'repackshot-plugins';
const DB_VERSION = 2;

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
      if (!db.objectStoreNames.contains('thumbs')) db.createObjectStore('thumbs', { keyPath: 'key' }).createIndex('plugin', 'plugin');
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
      const tx = db.transaction(['packages', 'keys', 'thumbs'], 'readwrite');
      tx.objectStore('packages').delete(id);
      tx.objectStore('keys').delete(id);
      const thumbs = tx.objectStore('thumbs');
      for (const key of await request(thumbs.index('plugin').getAllKeys(id))) thumbs.delete(key);
      await done(tx);
    },
    async thumb(key) {
      const tx = db.transaction('thumbs', 'readonly');
      return ((await request(tx.objectStore('thumbs').get(key))) as { blob?: Blob } | undefined)?.blob ?? null;
    },
    async putThumb(key, plugin, blob) {
      const tx = db.transaction('thumbs', 'readwrite');
      tx.objectStore('thumbs').put({ key, plugin, blob });
      await done(tx);
    },
  };
}
