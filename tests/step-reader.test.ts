// The STEP and IGES reader's side of the worker (src/io/step.ts): the worker is made on the first CAD file
// only, a read ends one way or another (result, readable error, timeout, cancel) and never hangs, and a worker
// that timed out, crashed or was cancelled is terminated. Fake workers stand in for step-worker.ts; one of them
// runs the real library in this thread (tests/occt-node.ts), so `importFile` is checked end to end too.

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { describePayload, ImportError, TESSELLATION_PRESETS, type ImportProgress } from '../src/core/import-options';
import { importFile } from '../src/io/import';
import type { WorkerReply, WorkerRequest } from '../src/io/occt-protocol';
import { CAD_TIMEOUTS, cadWorkerAlive, readTimeoutMs, releaseCadWorker, runCadWorker, setCadWorkerFactory, type CadWorker } from '../src/io/step';
import { encode } from './io-helpers';
import { fixture, inProcessWorker, loadOcct } from './occt-node';

const DEFAULTS = { ...CAD_TIMEOUTS };

beforeAll(async () => {
  await loadOcct();
}, 60_000);

afterEach(() => {
  releaseCadWorker();
  Object.assign(CAD_TIMEOUTS, DEFAULTS);
  vi.useRealTimers();
});

/** A worker that records what it is sent and answers only when told to. */
class ScriptedWorker implements CadWorker {
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  sent: WorkerRequest[] = [];
  terminated = false;
  postMessage(message: unknown): void {
    this.sent.push(message as WorkerRequest);
  }
  terminate(): void {
    this.terminated = true;
  }
  reply(r: WorkerReply extends infer R ? (R extends WorkerReply ? Omit<R, 'id'> : never) : never): void {
    this.onmessage?.({ data: { ...r, id: this.sent[this.sent.length - 1].id } } as MessageEvent);
  }
}

function scripted(): { workers: ScriptedWorker[] } {
  const made = { workers: [] as ScriptedWorker[] };
  setCadWorkerFactory(() => {
    const w = new ScriptedWorker();
    made.workers.push(w);
    return w;
  });
  return made;
}

const PARAMS = { linearUnit: 'millimeter' as const, linearDeflectionType: 'bounding_box_ratio' as const, linearDeflection: 0.001, angularDeflection: 0.2 };
const codeOf = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
    return 'resolved';
  } catch (err) {
    expect(err).toBeInstanceOf(ImportError);
    return (err as ImportError).code;
  }
};

describe('the worker is made only for CAD files', () => {
  it('reading a mesh format makes no worker; the first STEP makes one', async () => {
    const log: WorkerRequest[] = [];
    let made = 0;
    setCadWorkerFactory(() => {
      made++;
      return inProcessWorker(log);
    });
    await importFile({ name: 'tetra.stl', bytes: fixture('tetrahedron.stl') });
    expect(made).toBe(0);
    expect(cadWorkerAlive()).toBe(false);
    const r = await importFile({ name: 'assembly.step', bytes: fixture('assembly.step') });
    expect(made).toBe(1);
    expect(r.format).toBe('STEP');
    expect(describePayload(r)).toMatchObject({ parts: 2, groups: 1, materials: 2 });
    // The request names the library's folder as an absolute URL, the format and the unit the file declares.
    expect(log[0]).toMatchObject({ type: 'read', format: 'step', params: { linearUnit: 'millimeter', linearDeflectionType: 'bounding_box_ratio' } });
    expect(log[0].libraryUrl).toMatch(/^https?:\/\/.*\/vendor\/occt-import-js\/$/);
    // A second file reuses the worker while it is warm.
    await importFile({ name: 'quarter.igs', bytes: fixture('quarter.igs') });
    expect(made).toBe(1);
    expect(log[1]).toMatchObject({ format: 'iges' });
  });

  it('passes the tessellation of the sheet and reports where the read is', async () => {
    const log: WorkerRequest[] = [];
    setCadWorkerFactory(() => inProcessWorker(log));
    const stages: ImportProgress['stage'][] = [];
    await importFile({ name: 'box-inch.step', bytes: fixture('box-inch.step') }, { tessellation: TESSELLATION_PRESETS.HIGH, onProgress: (p) => stages.push(p.stage) });
    expect(log[0].params).toEqual({ linearUnit: 'inch', linearDeflectionType: 'bounding_box_ratio', linearDeflection: 0.0001, angularDeflection: (5 * Math.PI) / 180 });
    expect(stages).toEqual(['read', 'convert']);
  });

  it('a file the library cannot read is a readable error, and the worker stays for the next one', async () => {
    const workers: CadWorker[] = [];
    setCadWorkerFactory(() => {
      const w = inProcessWorker();
      workers.push(w);
      return w;
    });
    expect(await codeOf(importFile({ name: 'broken.step', bytes: encode('ISO-10303-21;\nthis is not STEP') }))).toBe('unreadable');
    expect(cadWorkerAlive()).toBe(true);
    const r = await importFile({ name: 'box.step', bytes: fixture('box.step') });
    expect(r.nodes[r.roots[0]].name).toBe('box');
    expect(workers).toHaveLength(1);
  });
});

describe('a read never hangs', () => {
  it('times out when the library does not arrive, and terminates the worker', async () => {
    vi.useFakeTimers();
    const { workers } = scripted();
    const p = codeOf(runCadWorker('step', new Uint8Array(10), PARAMS));
    await vi.advanceTimersByTimeAsync(CAD_TIMEOUTS.stallMs - 1);
    expect(workers[0].terminated).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    expect(await p).toBe('timeout');
    expect(workers[0].terminated).toBe(true);
    expect(cadWorkerAlive()).toBe(false);
  });

  it('a download that keeps arriving is not a stall; a read gets the time its size allows', async () => {
    vi.useFakeTimers();
    const { workers } = scripted();
    const progress: ImportProgress[] = [];
    const bytes = new Uint8Array(2_000_000);
    const p = codeOf(runCadWorker('step', bytes, PARAMS, { onProgress: (x) => progress.push(x) }));
    const w = workers[0];
    for (let i = 1; i <= 4; i++) {
      await vi.advanceTimersByTimeAsync(CAD_TIMEOUTS.stallMs - 1000);
      w.reply({ type: 'progress', stage: 'download', loaded: i * 1e6, total: 7.6e6 });
    }
    w.reply({ type: 'progress', stage: 'start' });
    await vi.advanceTimersByTimeAsync(CAD_TIMEOUTS.startMs - 1000);
    w.reply({ type: 'progress', stage: 'read' });
    expect(readTimeoutMs(bytes.byteLength)).toBe(CAD_TIMEOUTS.readBaseMs + 2 * CAD_TIMEOUTS.readPerMbMs);
    await vi.advanceTimersByTimeAsync(readTimeoutMs(bytes.byteLength) - 1000);
    expect(w.terminated).toBe(false);
    await vi.advanceTimersByTimeAsync(2000);
    expect(await p).toBe('timeout');
    expect(w.terminated).toBe(true);
    expect(progress.map((x) => x.stage)).toEqual(['download', 'download', 'download', 'download', 'start', 'read']);
    expect(progress[3]).toEqual({ stage: 'download', loaded: 4e6, total: 7.6e6 });
  });

  it('the read timeout grows with the file and has a ceiling', () => {
    expect(readTimeoutMs(0)).toBe(CAD_TIMEOUTS.readBaseMs);
    expect(readTimeoutMs(1e6)).toBeGreaterThan(readTimeoutMs(0));
    expect(readTimeoutMs(1e10)).toBe(CAD_TIMEOUTS.readMaxMs);
  });

  it('cancel stops the read at once and terminates the worker', async () => {
    const { workers } = scripted();
    const ctl = new AbortController();
    const p = codeOf(runCadWorker('step', new Uint8Array(10), PARAMS, { signal: ctl.signal }));
    workers[0].reply({ type: 'progress', stage: 'read' });
    ctl.abort();
    expect(await p).toBe('aborted');
    expect(workers[0].terminated).toBe(true);
    // An aborted signal does not even start a worker.
    expect(await codeOf(runCadWorker('step', new Uint8Array(10), PARAMS, { signal: ctl.signal }))).toBe('aborted');
    expect(workers).toHaveLength(1);
  });

  it('a new read stops the one in flight (another quality was chosen)', async () => {
    const { workers } = scripted();
    const first = codeOf(runCadWorker('step', new Uint8Array(10), PARAMS));
    const second = runCadWorker('step', new Uint8Array(10), PARAMS);
    expect(await first).toBe('aborted');
    expect(workers[0].terminated).toBe(true);
    workers[1].reply({ type: 'result', result: { success: true, root: { name: '', meshes: [], children: [] }, meshes: [] } });
    expect((await second).success).toBe(true);
  });

  it('a crash or a worker that fails to load is an error and the worker goes', async () => {
    const { workers } = scripted();
    const crashed = codeOf(runCadWorker('step', new Uint8Array(10), PARAMS));
    workers[0].reply({ type: 'error', code: 'crashed', detail: 'RuntimeError: unreachable' });
    expect(await crashed).toBe('crashed');
    expect(workers[0].terminated).toBe(true);
    const missing = codeOf(runCadWorker('step', new Uint8Array(10), PARAMS));
    workers[1].onerror?.(new Event('error'));
    expect(await missing).toBe('loadFailed');
    expect(workers[1].terminated).toBe(true);
    const noLibrary = codeOf(runCadWorker('step', new Uint8Array(10), PARAMS));
    workers[2].reply({ type: 'error', code: 'loadFailed', detail: 'occt-import-js.js: HTTP 404' });
    expect(await noLibrary).toBe('loadFailed');
    expect(workers[2].terminated).toBe(true);
  });

  it('an idle worker is terminated after a while', async () => {
    vi.useFakeTimers();
    const { workers } = scripted();
    const p = runCadWorker('step', new Uint8Array(10), PARAMS);
    workers[0].reply({ type: 'result', result: { success: true } });
    await p;
    expect(cadWorkerAlive()).toBe(true);
    await vi.advanceTimersByTimeAsync(CAD_TIMEOUTS.idleMs + 1);
    expect(workers[0].terminated).toBe(true);
    expect(cadWorkerAlive()).toBe(false);
  });

  it('answers for another request are ignored', async () => {
    const { workers } = scripted();
    const p = runCadWorker('step', new Uint8Array(10), PARAMS);
    workers[0].onmessage?.({ data: { type: 'result', id: -1, result: { success: false } } } as MessageEvent);
    workers[0].reply({ type: 'result', result: { success: true } });
    expect((await p).success).toBe(true);
  });
});
