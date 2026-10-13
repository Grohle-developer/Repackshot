// occt-import-js in Node, for the STEP and IGES tests: the package runs in Node
// as well as in a browser worker. `loadOcct` loads the real library from
// node_modules once; `readCad` reads a file the way the importer does (the unit
// plan from the file's text, the library, the same packing as the worker, the
// same conversion); `inProcessWorker` stands in for step-worker.ts so
// `importFile` can be tested end to end, with the real library and no thread.

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { TessellationParams } from '../src/core/import-options';
import type { ReadResult } from '../src/io/gltf';
import { occtToPayload } from '../src/io/occt-convert';
import { packOcctResult, type OcctModule, type WorkerReply, type WorkerRequest } from '../src/io/occt-protocol';
import { readPlan, type CadFormat, type CadWorker } from '../src/io/step';

const require = createRequire(import.meta.url);
let module: Promise<OcctModule> | null = null;

/** The library, loaded once from node_modules (what it prints is dropped). */
export function loadOcct(): Promise<OcctModule> {
  module ??= (require('occt-import-js') as (o: object) => Promise<OcctModule>)({ print: () => {}, printErr: () => {} });
  return module;
}

export const fixture = (name: string): Uint8Array => readFileSync(`tests/fixtures/${name}`);

/** A fixture read through the importer's own steps, synchronously after the library has loaded. */
export async function readCad(name: string, tessellation?: TessellationParams): Promise<ReadResult> {
  const occt = await loadOcct();
  const format: CadFormat = /\.(igs|iges)$/i.test(name) ? 'IGES' : 'STEP';
  const bytes = fixture(name);
  const plan = readPlan(format, bytes, tessellation);
  const raw = occt.ReadFile(format === 'STEP' ? 'step' : 'iges', bytes, plan.params);
  return occtToPayload(packOcctResult(raw).result, { fileName: name, format, units: plan.units, notes: plan.notes });
}

/** A worker that answers like step-worker.ts, with the real library, in this thread (after a macrotask, like a real one). */
export function inProcessWorker(log: WorkerRequest[] = []): CadWorker {
  const w: CadWorker & { terminated: boolean } = {
    onmessage: null,
    onerror: null,
    terminated: false,
    postMessage(message: unknown) {
      const req = message as WorkerRequest;
      log.push(req);
      const reply = (r: WorkerReply) => setTimeout(() => !w.terminated && w.onmessage?.({ data: r } as MessageEvent), 0);
      void loadOcct().then((occt) => {
        reply({ type: 'progress', id: req.id, stage: 'read' });
        const raw = occt.ReadFile(req.format, req.bytes, req.params);
        if (!raw.success) reply({ type: 'error', id: req.id, code: 'unreadable', detail: '' });
        else reply({ type: 'result', id: req.id, result: packOcctResult(raw).result });
      });
    },
    terminate() {
      w.terminated = true;
    },
  };
  return w;
}
