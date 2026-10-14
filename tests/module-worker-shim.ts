// A module Worker for the plugin host's tests (phase P6): what `new Worker(blobUrl, { type: 'module' })` is in a
// page, in Node. The code behind the Blob URL is read back and run as an ES module in a worker thread (a `data:` URL),
// after a prelude that gives it `self`, `postMessage`, `onmessage` and `addEventListener('message')` the way a web
// worker has them. What runs is the plugin's own code; only the browser plumbing is replaced.

import { resolveObjectURL } from 'node:buffer';
import { Worker as ThreadWorker } from 'node:worker_threads';
import type { WorkerLike } from '../src/plugins/host';

const PRELUDE = `import { parentPort } from 'node:worker_threads';
const listeners = [];
globalThis.self = globalThis;
globalThis.postMessage = (message, transfer) => parentPort.postMessage(message, transfer);
globalThis.addEventListener = (type, fn) => { if (type === 'message') listeners.push(fn); };
parentPort.on('message', (data) => {
  const e = { data };
  if (typeof globalThis.onmessage === 'function') globalThis.onmessage(e);
  for (const fn of listeners) fn(e);
});
`;

export class ModuleWorkerShim implements WorkerLike {
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  /** Every message the host sent, and every one the plugin answered, for the tests to read. */
  readonly sent: unknown[] = [];
  readonly received: unknown[] = [];
  private thread: ThreadWorker | null = null;
  private queue: { message: unknown; transfer?: Transferable[] }[] = [];
  private closed = false;

  constructor(url: string) {
    const blob = resolveObjectURL(url);
    if (!blob) throw new Error(`module worker shim: no blob behind ${url}`);
    void blob.text().then((source) => {
      if (this.closed) return;
      this.thread = new ThreadWorker(new URL(`data:text/javascript,${encodeURIComponent(PRELUDE + source)}`));
      this.thread.on('message', (data) => {
        this.received.push(data);
        this.onmessage?.({ data });
      });
      this.thread.on('error', (err) => this.onerror?.(err));
      for (const q of this.queue) this.thread.postMessage(q.message, q.transfer as never);
      this.queue = [];
    });
  }

  postMessage(message: unknown, transfer?: Transferable[]): void {
    // A copy: the buffers of the message are transferred (and so detached here) when it is posted.
    this.sent.push(structuredClone(message));
    if (this.thread) this.thread.postMessage(message, transfer as never);
    else this.queue.push({ message, transfer });
  }

  terminate(): void {
    this.closed = true;
    void this.thread?.terminate();
  }
}
