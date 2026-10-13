// The STEP and IGES worker: a thin shell around occt-import-js (LGPL-2.1,
// OpenCascade compiled to wasm). The library is not part of the bundle: on the
// first request this fetches the unmodified `occt-import-js.js` and
// `occt-import-js.wasm` from the folder the request names
// (`public/vendor/occt-import-js/`, see tools/vendor.mjs), reporting the bytes
// of the download as they arrive, and keeps the module for the next files.
// Each request runs `ReadFile` and posts the result with its arrays packed
// (occt-protocol.ts); turning it into parts happens on the main thread
// (occt-convert.ts). The main thread terminates this worker on cancel, on a
// timeout and when it has been idle for a while (src/io/step.ts).
//
// This is a module worker, where importScripts() is not allowed, so the
// library's script is fetched and run as a CommonJS module: it hands its
// factory to `module.exports` (the last lines of the emscripten build).

import { packOcctResult, type OcctModule, type WorkerReply, type WorkerRequest } from './occt-protocol';

const post = (reply: WorkerReply, transfer: Transferable[] = []): void => (self as unknown as Worker).postMessage(reply, transfer);

/** What the library printed to stderr for the current request (its own reasons for a failure). */
let errors: string[] = [];
let loading: Promise<OcctModule> | null = null;

/** Fetches the wasm, posting progress at most every 100 ms. */
async function download(url: string, id: number): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`${url}: HTTP ${res.status}`);
  // A compressed response announces its compressed length: then the total is unknown.
  const declared = Number(res.headers.get('content-length')) || 0;
  const encoded = (res.headers.get('content-encoding') ?? 'identity') !== 'identity';
  const total = encoded ? 0 : declared;
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  let last = 0;
  const reader = res.body.getReader();
  post({ type: 'progress', id, stage: 'download', loaded: 0, total });
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    const now = Date.now();
    if (now - last > 100) {
      last = now;
      post({ type: 'progress', id, stage: 'download', loaded, total: total >= loaded ? total : 0 });
    }
  }
  post({ type: 'progress', id, stage: 'download', loaded, total: loaded });
  const bytes = new Uint8Array(loaded);
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.byteLength;
  }
  return bytes;
}

async function load(libraryUrl: string, id: number): Promise<OcctModule> {
  const script = await fetch(`${libraryUrl}occt-import-js.js`);
  if (!script.ok) throw new Error(`occt-import-js.js: HTTP ${script.status}`);
  const source = await script.text();
  const wasmBinary = await download(`${libraryUrl}occt-import-js.wasm`, id);
  post({ type: 'progress', id, stage: 'start' });
  const cjs: { exports: unknown } = { exports: {} };
  new Function('module', 'exports', source)(cjs, cjs.exports);
  const factory = cjs.exports as (overrides: Record<string, unknown>) => Promise<OcctModule>;
  if (typeof factory !== 'function') throw new Error('occt-import-js.js did not export its factory');
  return factory({
    wasmBinary,
    locateFile: (path: string) => `${libraryUrl}${path}`,
    print: () => {},
    printErr: (line: string) => {
      errors.push(String(line));
      if (errors.length > 20) errors.shift();
    },
  });
}

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const req = e.data;
  if (req?.type !== 'read') return;
  let occt: OcctModule;
  try {
    loading ??= load(req.libraryUrl, req.id);
    occt = await loading;
  } catch (err) {
    loading = null;
    post({ type: 'error', id: req.id, code: 'loadFailed', detail: err instanceof Error ? err.message : String(err) });
    return;
  }
  post({ type: 'progress', id: req.id, stage: 'read' });
  errors = [];
  let result;
  try {
    result = occt.ReadFile(req.format, req.bytes, req.params);
  } catch (err) {
    post({ type: 'error', id: req.id, code: 'crashed', detail: err instanceof Error ? err.message : String(err) });
    return;
  }
  if (!result?.success) {
    post({ type: 'error', id: req.id, code: 'unreadable', detail: errors.join('\n').trim() });
    return;
  }
  const { result: packed, transfer } = packOcctResult(result);
  post({ type: 'result', id: req.id, result: packed }, transfer);
};
