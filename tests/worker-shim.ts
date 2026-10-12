// What three's Rhino3dmLoader needs from a browser, in Node: a `Worker` class
// (backed by worker_threads) and a `fetch` that serves rhino3dm.js and
// rhino3dm.wasm from node_modules at the library path the test chose. The
// loader builds its worker from a blob URL: this reads the blob back and runs
// it in a thread, with `self`, `onmessage` and `postMessage` the way a web
// worker has them. The code that runs is the real loader and the real
// rhino3dm wasm; only the browser plumbing is replaced.

import { readFileSync } from 'node:fs';
import { resolveObjectURL } from 'node:buffer';
import { createRequire } from 'node:module';
import { Worker as ThreadWorker } from 'node:worker_threads';

const require = createRequire(import.meta.url);
const RHINO_DIR = require.resolve('rhino3dm/package.json').replace(/package\.json$/, '');

/** The base URL the tests give the loader as library path. */
export const TEST_LIBRARY_URL = 'http://repackshot.test/vendor/rhino3dm/';

// Runs before the loader's worker source, inside the thread.
const PRELUDE = `
const { parentPort } = require('node:worker_threads');
globalThis.self = globalThis;
globalThis.postMessage = (message, transfer) => parentPort.postMessage(message, transfer);
parentPort.on('message', (data) => { if (typeof globalThis.onmessage === 'function') globalThis.onmessage({ data }); });
`;

class ShimWorker {
  onmessage: ((e: { data: unknown }) => void) | null = null;
  private thread: ThreadWorker | null = null;
  private queue: { message: unknown; transfer?: Transferable[] }[] = [];
  private closed = false;

  constructor(url: string) {
    const blob = resolveObjectURL(url);
    if (!blob) throw new Error(`worker shim: no blob behind ${url}`);
    void blob.text().then((source) => {
      if (this.closed) return;
      this.thread = new ThreadWorker(PRELUDE + source, { eval: true });
      this.thread.on('message', (data) => this.onmessage?.({ data }));
      this.thread.on('error', (err) => {
        throw err;
      });
      for (const q of this.queue) this.thread.postMessage(q.message, q.transfer as never);
      this.queue = [];
    });
  }

  postMessage(message: unknown, transfer?: Transferable[]): void {
    if (this.thread) this.thread.postMessage(message, transfer as never);
    else this.queue.push({ message, transfer });
  }

  terminate(): void {
    this.closed = true;
    void this.thread?.terminate();
  }
}

/** Installs `Worker`, `ProgressEvent` and a `fetch` for the test library URL (idempotent). */
export function installWorkerShim(): void {
  const g = globalThis as unknown as { Worker?: unknown; ProgressEvent?: unknown; fetch: typeof fetch; __rhinoFetch?: boolean };
  if (!g.Worker) g.Worker = ShimWorker;
  // three's FileLoader reports progress with this browser event.
  if (!g.ProgressEvent) {
    g.ProgressEvent = class extends Event {
      constructor(type: string, init: Record<string, unknown> = {}) {
        super(type);
        Object.assign(this, init);
      }
    };
  }
  if (g.__rhinoFetch) return;
  g.__rhinoFetch = true;
  const real = g.fetch.bind(globalThis);
  g.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.startsWith(TEST_LIBRARY_URL)) {
      const file = url.slice(TEST_LIBRARY_URL.length);
      if (!/^rhino3dm\.(js|wasm)$/.test(file)) return new Response('not found', { status: 404 });
      return new Response(readFileSync(RHINO_DIR + file), { status: 200, headers: { 'content-type': file.endsWith('.wasm') ? 'application/wasm' : 'text/javascript' } });
    }
    return real(input, init);
  }) as typeof fetch;
}
