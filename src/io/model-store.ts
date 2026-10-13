// One interface for where AI models are kept (U6, AI-POST.md §5), with three
// implementations: the browser's private file system through the model
// worker (OPFS), the desktop launcher's data folder through its API (P2,
// engine/crates/rt-app/README.md, client in io/native.ts), and memory (the
// tests, and a browser without OPFS for the session). The download manager
// (io/downloads.ts) only sees this.

import { validateManifest, type BlobInfo, type ImportedModel } from '../core/models';
import { Sha256 } from '../core/sha256';
import { createBlobStore, memoryFs, type FinishResult, type LocalBlobStore } from './blob-store';
import type { ModelWorkerReply, ModelWorkerRequest } from './model-protocol';
import type { BlobStatus, NativeClient, PendingModels } from './native';

export type { FinishResult };

export type { PendingModels };

export interface ModelStore {
  readonly kind: 'opfs' | 'native' | 'memory';
  /** The folder the models are in, when there is one to show (desktop). */
  readonly location: string | null;
  /** Rejects when the store cannot work here (a browser without OPFS). */
  probe(): Promise<void>;
  status(sha: string): Promise<BlobInfo>;
  blobs(): Promise<BlobInfo[]>;
  /** Writes in order: at the blob's contiguous bytes, or at 0 to start it over. */
  write(sha: string, offset: number, bytes: Uint8Array, total: number): Promise<BlobInfo>;
  /** Verifies a fully written blob: its sha256 must be its name; another one leaves it damaged. */
  finish(sha: string, total: number): Promise<FinishResult>;
  deleteBlob(sha: string): Promise<void>;
  /** Lets go of a partial blob (a paused download). */
  release(sha: string): Promise<void>;
  installed(): Promise<string[]>;
  /** Marks a model installed: every one of its blobs must be complete. */
  install(key: string, shas: readonly string[]): Promise<void>;
  /** Uninstalls a model and deletes `shas` (the blobs nothing else uses); `keep` are models being downloaded. */
  uninstall(key: string, shas: readonly string[], keep: readonly string[]): Promise<void>;
  imported(): Promise<ImportedModel[]>;
  putImported(model: ImportedModel): Promise<void>;
  /** What the desktop installer chose to download (`pending-models.json`), or null. */
  pending(): Promise<PendingModels | null>;
  consumePending(): Promise<void>;
  /** Bytes the store holds. */
  usage(): Promise<number>;
  /** SHA-256 of a file the user picked (imports), with progress. */
  hash(blob: Blob, onProgress?: (done: number) => void): Promise<string>;
}

/** SHA-256 of a blob on this thread (tests; the browser uses the worker). */
export async function hashOnThread(blob: Blob, onProgress?: (done: number) => void): Promise<string> {
  const h = new Sha256();
  const chunk = 4 * 1024 * 1024;
  for (let at = 0; at < blob.size; at += chunk) {
    h.update(new Uint8Array(await blob.slice(at, at + chunk).arrayBuffer()));
    onProgress?.(Math.min(blob.size, at + chunk));
  }
  return h.digest();
}

/** A store on this thread over a LocalBlobStore (memory by default). */
export function localModelStore(store: LocalBlobStore = createBlobStore(memoryFs()), kind: 'memory' | 'opfs' = 'memory'): ModelStore {
  return {
    kind,
    location: null,
    probe: async () => undefined,
    status: (sha) => store.status(sha),
    blobs: () => store.blobs(),
    write: (sha, offset, bytes, total) => store.write(sha, offset, bytes, total),
    finish: (sha, total) => store.finish(sha, total),
    deleteBlob: (sha) => store.deleteBlob(sha),
    release: (sha) => store.release(sha),
    installed: () => store.installed(),
    install: async (key, shas) => {
      await store.install(key, shas);
    },
    uninstall: async (key, shas) => {
      await store.uninstall(key, shas);
    },
    imported: () => store.imported(),
    putImported: (m) => store.putImported(m),
    pending: async () => null,
    consumePending: async () => undefined,
    usage: () => store.usage(),
    hash: hashOnThread,
  };
}

/** A failure the worker reported, with the store's code (`offset`, `damaged`, `opfs`...). */
export class ModelStoreError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** The browser's store: the model worker on OPFS. `spawn` makes the worker (main.ts, so Vite bundles it). */
export function workerModelStore(spawn: () => Worker): ModelStore {
  let worker: Worker | null = null;
  let seq = 0;
  const waiting = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; progress?: (n: number) => void }>();
  const get = (): Worker => {
    if (worker) return worker;
    const w = spawn();
    w.onmessage = (e: MessageEvent<ModelWorkerReply>) => {
      const m = e.data;
      const p = waiting.get(m.id);
      if (!p) return;
      if ('progress' in m) {
        p.progress?.(m.progress);
        return;
      }
      waiting.delete(m.id);
      if (m.ok) p.resolve(m.value);
      else p.reject(new ModelStoreError(m.code, m.message));
    };
    w.onerror = (e) => {
      for (const p of waiting.values()) p.reject(new ModelStoreError('worker', e.message || 'model worker failed'));
      waiting.clear();
    };
    worker = w;
    return w;
  };
  type Body = ModelWorkerRequest extends infer R ? (R extends { id: number } ? Omit<R, 'id'> : never) : never;
  const call = <T>(body: Body, transfer: Transferable[] = [], progress?: (n: number) => void): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const id = ++seq;
      waiting.set(id, { resolve: resolve as (v: unknown) => void, reject, progress });
      get().postMessage({ ...body, id } as ModelWorkerRequest, transfer);
    });
  return {
    kind: 'opfs',
    location: null,
    probe: () => call<boolean>({ op: 'probe' }).then(() => undefined),
    status: (sha) => call({ op: 'status', sha }),
    blobs: () => call({ op: 'blobs' }),
    write: (sha, offset, bytes, total) => {
      // The chunk is moved to the worker, not copied.
      const buf = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength ? (bytes.buffer as ArrayBuffer) : (bytes.slice().buffer as ArrayBuffer);
      return call({ op: 'write', sha, offset, total, bytes: buf }, [buf]);
    },
    finish: (sha, total) => call({ op: 'finish', sha, total }),
    deleteBlob: (sha) => call({ op: 'deleteBlob', sha }),
    release: (sha) => call({ op: 'release', sha }),
    installed: () => call({ op: 'installed' }),
    install: (key, shas) => call<string[]>({ op: 'install', key, shas: [...shas] }).then(() => undefined),
    uninstall: (key, shas) => call<string[]>({ op: 'uninstall', key, shas: [...shas] }).then(() => undefined),
    imported: () => call({ op: 'imported' }),
    putImported: (model) => call({ op: 'putImported', model }),
    pending: async () => null,
    consumePending: async () => undefined,
    usage: () => call({ op: 'usage' }),
    hash: (blob, onProgress) => call({ op: 'hash', blob }, [], onProgress),
  };
}

// ------------------------------------------------------------------ the desktop launcher

/** The parts of the launcher's client (io/native.ts) the model store uses (a test double implements just these). */
export type NativeModelsApi = Pick<NativeClient, 'models' | 'blobStatus' | 'putChunk' | 'finishBlob' | 'deleteBlob' | 'importModel' | 'install' | 'remove' | 'pendingModels' | 'consumePendingModels'> & {
  readonly info: Pick<NativeClient['info'], 'modelsDir'>;
};

const fromNative = (s: BlobStatus): BlobInfo => ({ sha256: s.sha256, state: s.state, contiguous: s.contiguous, total: s.total ?? null, damaged: s.damaged === true, actual: s.actual ?? null });

/**
 * The desktop's store: the launcher writes the chunks into its data folder, checks each blob with its own
 * SHA-256 and deletes only blobs no installed model uses. Imported files are hashed here first (`hash`).
 */
export function nativeModelStore(api: NativeModelsApi, hash: ModelStore['hash'] = hashOnThread): ModelStore {
  return {
    kind: 'native',
    location: api.info.modelsDir,
    probe: async () => {
      await api.models();
    },
    status: async (sha) => fromNative(await api.blobStatus(sha)),
    async blobs() {
      const list = await api.models();
      const out = new Map<string, BlobInfo>();
      for (const m of list.models)
        for (const f of m.files) {
          if (out.has(f.sha256)) continue;
          out.set(f.sha256, { sha256: f.sha256, state: f.state, contiguous: f.state === 'complete' ? f.bytes : (f.contiguous ?? 0), total: f.bytes, damaged: f.damaged === true });
        }
      return [...out.values()];
    },
    write: async (sha, offset, bytes, total) => fromNative(await api.putChunk(sha, offset, bytes as unknown as BodyInit, total)),
    async finish(sha, total) {
      const r = await api.finishBlob(sha, total);
      if (r.ok) return { ok: true };
      if (r.error === 'sha256-mismatch') return { ok: false, reason: 'mismatch', actual: r.actual ?? '' };
      return { ok: false, reason: 'incomplete', contiguous: r.contiguous ?? 0 };
    },
    deleteBlob: (sha) => api.deleteBlob(sha),
    release: async () => undefined,
    installed: async () => (await api.models()).installed,
    install: async (key) => {
      await api.install(key);
    },
    // The launcher works out which blobs nothing else uses (the same rule as core/models.ts).
    uninstall: async (key, _shas, keep) => {
      await api.remove(key, [...keep]);
    },
    imported: async () => {
      const out: ImportedModel[] = [];
      for (const m of (await api.models()).models) {
        if (m.source !== 'imported' || !m.manifest) continue;
        const r = validateManifest(m.manifest, { requireSha: true });
        if (r.ok) out.push(r.model);
      }
      return out;
    },
    putImported: (model) => api.importModel(model.key, model),
    pending: () => api.pendingModels(),
    consumePending: () => api.consumePendingModels(),
    async usage() {
      const blobs = await this.blobs();
      return blobs.reduce((a, b) => a + b.contiguous, 0);
    },
    hash,
  };
}
