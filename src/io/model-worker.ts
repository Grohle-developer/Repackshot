// The model worker: the browser's model store (io/blob-store.ts on OPFS,
// io/opfs-fs.ts) and SHA-256 of files the user imports, off the main thread.
// Each chunk of a download is transferred here, written at its offset with a
// sync access handle and hashed as it is written, so verifying a 6 GB file at
// the end is reading 32 bytes of state, not 6 GB. Requests carry an id; the
// reply carries it back, with progress messages in between for long work.

import { createBlobStore, StoreError, type LocalBlobStore } from './blob-store';
import { opfsFs } from './opfs-fs';
import { Sha256 } from '../core/sha256';
import type { ModelWorkerReply, ModelWorkerRequest } from './model-protocol';

interface WorkerScope {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  onmessage: ((e: MessageEvent<ModelWorkerRequest>) => void) | null;
}
const scope = self as unknown as WorkerScope;
const post = (m: ModelWorkerReply) => scope.postMessage(m);

let store: Promise<LocalBlobStore> | null = null;
const getStore = () => (store ??= opfsFs().then(createBlobStore));

/** The hash of a file or blob, read as a stream (any size), with progress. */
async function hashBlob(id: number, blob: Blob): Promise<string> {
  const h = new Sha256();
  const reader = blob.stream().getReader();
  let done = 0;
  let last = 0;
  for (;;) {
    const r = await reader.read();
    if (r.done) break;
    h.update(r.value);
    done += r.value.length;
    if (done - last >= 16 * 1024 * 1024) {
      last = done;
      post({ id, progress: done });
    }
  }
  return h.digest();
}

// Requests run one after another: the store's files must not see two writes interleaved.
let chain: Promise<unknown> = Promise.resolve();

scope.onmessage = (e) => {
  const msg = e.data;
  const run = async (): Promise<unknown> => {
    if (msg.op === 'hash') return hashBlob(msg.id, msg.blob);
    const s = await getStore();
    switch (msg.op) {
      case 'probe':
        return true;
      case 'status':
        return s.status(msg.sha);
      case 'blobs':
        return s.blobs();
      case 'write':
        return s.write(msg.sha, msg.offset, new Uint8Array(msg.bytes), msg.total);
      case 'finish':
        return s.finish(msg.sha, msg.total, (done) => post({ id: msg.id, progress: done }));
      case 'deleteBlob':
        return s.deleteBlob(msg.sha);
      case 'release':
        return s.release(msg.sha);
      case 'installed':
        return s.installed();
      case 'install':
        return s.install(msg.key, msg.shas);
      case 'uninstall':
        return s.uninstall(msg.key, msg.shas);
      case 'imported':
        return s.imported();
      case 'putImported':
        return s.putImported(msg.model);
      case 'usage':
        return s.usage();
    }
  };
  // Hashing an imported file does not wait for (nor hold up) the store.
  const job = msg.op === 'hash' ? run() : (chain = chain.then(run, run));
  job.then(
    (value) => post({ id: msg.id, ok: true, value }),
    (err: unknown) => post({ id: msg.id, ok: false, code: err instanceof StoreError ? err.code : err instanceof Error && err.message === 'opfs' ? 'opfs' : 'error', message: err instanceof Error ? err.message : String(err) }),
  );
};
