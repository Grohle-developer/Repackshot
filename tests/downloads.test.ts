// The model manager of phase U6 (io/downloads.ts) against a fake server with HTTP Range, on the
// content-addressed store of io/blob-store.ts in memory (the same code the OPFS worker runs): a
// download cut halfway resumes from the last stored byte (in the same session and after a
// "reload"), a wrong sha256 leaves the file Damaged, a file shared by two models is downloaded once
// and survives deleting one of them, a server that ignores Range starts the file over, licences are
// asked for before the first download, the installer's choice starts at the first start, and
// imports refuse pickle files and check their manifest.

import { describe, expect, it } from 'vitest';
import type { AiModelEntry, AiModelsCatalogue } from '../src/core/ai-deps';
import { allModels, findModel, modelState, type ModelsSnapshot } from '../src/core/models';
import { sha256Hex } from '../src/core/sha256';
import { createBlobStore, memoryFs } from '../src/io/blob-store';
import { DownloadManager, type DownloadMemory, type FetchLike } from '../src/io/downloads';
import { localModelStore, type ModelStore } from '../src/io/model-store';

function bytes(n: number, seed: number): Uint8Array {
  const out = new Uint8Array(n);
  let x = seed * 2654435761 + 1;
  for (let i = 0; i < n; i++) {
    x = (x * 1103515245 + 12345) >>> 0;
    out[i] = x >>> 24;
  }
  return out;
}

interface Served {
  data: Uint8Array;
  /** Cut the response after this many bytes of body (once), as a dropped connection does. */
  cutAfter?: number;
  /** Answer 200 with the whole file whatever the Range. */
  ignoreRange?: boolean;
}

/**
 * A server: files by URL, with Range, a log of every request, and bodies in small pieces. `onPiece` runs before
 * each piece is sent (a fake clock, or a pause so the test can act mid-transfer).
 */
function server(files: Record<string, Served>, piece = 1000, onPiece?: () => Promise<void> | void) {
  const log: { url: string; range: string | null }[] = [];
  const fetch: FetchLike = async (url, init) => {
    const range = init.headers?.Range ?? null;
    log.push({ url, range });
    const f = files[url];
    if (!f) return new Response('no', { status: 404 });
    let start = 0;
    let status = 200;
    const headers: Record<string, string> = {};
    if (range && !f.ignoreRange) {
      start = Number(/^bytes=(\d+)-$/.exec(range)![1]);
      if (start >= f.data.length) return new Response(null, { status: 416 });
      status = 206;
      headers['Content-Range'] = `bytes ${start}-${f.data.length - 1}/${f.data.length}`;
    }
    const body = f.data.subarray(start);
    const cut = f.cutAfter;
    f.cutAfter = undefined;
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      async pull(ctrl) {
        await onPiece?.();
        if (init.signal?.aborted) {
          ctrl.error(new DOMException('aborted', 'AbortError'));
          return;
        }
        if (cut !== undefined && sent >= cut) {
          ctrl.error(new TypeError('network error'));
          return;
        }
        if (sent >= body.length) {
          ctrl.close();
          return;
        }
        const n = Math.min(piece, body.length - sent, cut !== undefined ? cut - sent : Infinity);
        ctrl.enqueue(body.slice(sent, sent + n));
        sent += n;
      },
    });
    return new Response(stream, { status, headers });
  };
  return { fetch, log };
}

function file(name: string, url: string, data: Uint8Array, role: AiModelEntry['files'][number]['role'] = 'transformer', sha?: string) {
  return { role, name, url, bytes: data.length, sha256: sha ?? sha256Hex(data) };
}

function model(key: string, files: AiModelEntry['files'], extra: Partial<AiModelEntry> = {}): AiModelEntry {
  return {
    key,
    label: { en: key, es: key },
    summary: { en: '', es: '' },
    family: 'z-image',
    role: 'img2img',
    quantization: 'Q4_0',
    runtimes: ['desktop', 'web'],
    default: false,
    available: true,
    licence: { spdx: 'Apache-2.0', url: 'https://example.org/licence', commercialUse: true, useRestrictions: false },
    files,
    totalBytes: files.reduce((a, f) => a + f.bytes, 0),
    requirements: { minVramGiB: null, minRamGiB: null },
    ...extra,
  };
}

const catalogue = (models: AiModelEntry[]): AiModelsCatalogue => ({ schema: 1, models, recommendation: [] });

function memoryPersist() {
  let mem: DownloadMemory | null = null;
  return { load: () => mem, save: (m: DownloadMemory) => (mem = JSON.parse(JSON.stringify(m))), peek: () => mem };
}

const CHUNK = 4096;

function manager(cat: AiModelsCatalogue, fetch: FetchLike, store: ModelStore, persist = memoryPersist(), extra: Partial<ConstructorParameters<typeof DownloadManager>[0]> = {}) {
  let t = 0;
  return new DownloadManager({ store, catalogue: cat, fetch, chunkBytes: CHUNK, concurrency: 2, persist, retryDelays: [1], emitEveryMs: 0, now: () => (t += 0.25), ...extra });
}

async function until(check: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 2000 && !check(); i++) await new Promise((r) => setTimeout(r, 1));
  expect(check(), what).toBe(true);
}

const stateOf = (snap: ModelsSnapshot, key: string, active = '') => modelState(findModel(snap, key)!, snap, active).kind;

describe('downloading a model', () => {
  it('fetches every file, verifies it and only then marks the model Ready', async () => {
    const a = bytes(10_000, 1);
    const b = bytes(5_000, 2);
    const srv = server({ 'https://h/a': { data: a }, 'https://h/b': { data: b } });
    const store = localModelStore();
    const m = manager(catalogue([model('M', [file('a.gguf', 'https://h/a', a), file('b.safetensors', 'https://h/b', b, 'vae')])]), srv.fetch, store);
    await m.start();
    expect(await m.download('M')).toBe('needsLicence');
    m.acceptLicence('M');
    expect(await m.download('M')).toBe('started');
    await until(() => m.snapshot().installed.includes('M'), 'installed');
    const snap = m.snapshot();
    expect(stateOf(snap, 'M')).toBe('READY');
    expect(stateOf(snap, 'M', 'M')).toBe('IN_USE');
    expect(snap.blobs[sha256Hex(a)].state).toBe('complete');
    expect(await store.installed()).toEqual(['M']);
    m.dispose();
  });

  it('a cut connection resumes from the last stored byte, with Range', async () => {
    const a = bytes(20_000, 3);
    // Cut after 2.5 chunks: two chunks are stored, the half chunk is not.
    const srv = server({ 'https://h/a': { data: a, cutAfter: CHUNK * 2 + CHUNK / 2 } });
    const m = manager(catalogue([model('M', [file('a.gguf', 'https://h/a', a)])]), srv.fetch, localModelStore());
    await m.start();
    m.acceptLicence('M');
    await m.download('M');
    await until(() => m.snapshot().installed.includes('M'), 'installed after the retry');
    expect(srv.log.map((r) => r.range)).toEqual([null, `bytes=${CHUNK * 2}-`]);
    m.dispose();
  });

  it('after a reload the download picks up where the stored bytes end', async () => {
    const a = bytes(30_000, 4);
    const files = { 'https://h/a': { data: a, cutAfter: CHUNK * 3 + 100 } };
    const srv = server(files);
    const fs = memoryFs();
    const persist = memoryPersist();
    const cat = catalogue([model('M', [file('a.gguf', 'https://h/a', a)])]);
    // No retries: the first session ends with the download paused by the failure, like a closed page.
    const first = manager(cat, srv.fetch, localModelStore(createBlobStore(fs)), persist, { retryDelays: [] });
    await first.start();
    first.acceptLicence('M');
    await first.download('M');
    await until(() => first.snapshot().downloads.M?.phase === 'PAUSED', 'paused by the failure');
    first.dispose();
    expect(persist.peek()!.intents).toEqual([['M', 'PAUSED']]);
    // A new page: a new store object on the same files, a new manager with what was remembered.
    const second = manager(cat, srv.fetch, localModelStore(createBlobStore(fs)), persist);
    await second.start();
    const snap = second.snapshot();
    expect(snap.downloads.M.done).toBe(CHUNK * 3);
    expect(stateOf(snap, 'M')).toBe('PAUSED');
    second.resume('M');
    await until(() => second.snapshot().installed.includes('M'), 'installed in the second session');
    expect(srv.log.map((r) => r.range)).toEqual([null, `bytes=${CHUNK * 3}-`]);
    second.dispose();
  });

  it('a file whose sha256 is another one is Damaged, never Ready, and downloads again from 0', async () => {
    const a = bytes(9_000, 5);
    const srv = server({ 'https://h/a': { data: a } });
    const wrong = sha256Hex(bytes(9_000, 6));
    const store = localModelStore();
    const m = manager(catalogue([model('M', [file('a.gguf', 'https://h/a', a, 'transformer', wrong)])]), srv.fetch, store);
    await m.start();
    m.acceptLicence('M');
    await m.download('M');
    await until(() => stateOf(m.snapshot(), 'M') === 'DAMAGED', 'damaged');
    expect(m.snapshot().installed).toEqual([]);
    expect(m.snapshot().blobs[wrong]).toMatchObject({ damaged: true, actual: sha256Hex(a) });
    // Download again: the damaged part is deleted and the file starts over (no Range).
    await m.download('M');
    await until(() => srv.log.length === 2 && stateOf(m.snapshot(), 'M') === 'DAMAGED', 'damaged again');
    expect(srv.log[1].range).toBeNull();
    m.dispose();
  });

  it('a file two models share is downloaded once and survives deleting one of them', async () => {
    const enc = bytes(12_000, 7);
    const t1 = bytes(6_000, 8);
    const t2 = bytes(7_000, 9);
    const srv = server({ 'https://h/enc': { data: enc }, 'https://h/t1': { data: t1 }, 'https://h/t2': { data: t2 } });
    const store = localModelStore();
    const cat = catalogue([
      model('A', [file('t1.gguf', 'https://h/t1', t1), file('enc.gguf', 'https://h/enc', enc, 'text-encoder')]),
      model('B', [file('t2.gguf', 'https://h/t2', t2), file('enc.gguf', 'https://h/enc', enc, 'text-encoder')]),
    ]);
    const m = manager(cat, srv.fetch, store);
    await m.start();
    m.acceptLicence('A');
    m.acceptLicence('B');
    await m.download('A');
    await m.download('B');
    await until(() => m.snapshot().installed.length === 2, 'both installed');
    expect(srv.log.filter((r) => r.url === 'https://h/enc')).toHaveLength(1);
    await m.remove('A');
    let blobs = await store.blobs();
    expect(blobs.map((b) => b.sha256).sort()).toEqual([sha256Hex(enc), sha256Hex(t2)].sort());
    expect(m.snapshot().installed).toEqual(['B']);
    await m.remove('B');
    blobs = await store.blobs();
    expect(blobs).toEqual([]);
    m.dispose();
  });

  it('a server that ignores Range sends the whole file again, and it is written from the start', async () => {
    const a = bytes(16_000, 10);
    const srv = server({ 'https://h/a': { data: a, cutAfter: CHUNK + 10, ignoreRange: true } });
    const m = manager(catalogue([model('M', [file('a.gguf', 'https://h/a', a)])]), srv.fetch, localModelStore());
    await m.start();
    m.acceptLicence('M');
    await m.download('M');
    await until(() => m.snapshot().installed.includes('M'), 'installed');
    expect(srv.log.map((r) => r.range)).toEqual([null, `bytes=${CHUNK}-`]);
    m.dispose();
  });

  it('pause keeps what arrived, resume continues from it, cancel deletes it', async () => {
    const a = bytes(200_000, 11);
    const srv = server({ 'https://h/a': { data: a } }, 500, () => new Promise((r) => setTimeout(r, 1)));
    const store = localModelStore();
    const m = manager(catalogue([model('M', [file('a.gguf', 'https://h/a', a)])]), srv.fetch, store);
    await m.start();
    m.acceptLicence('M');
    await m.download('M');
    await until(() => (m.snapshot().downloads.M?.done ?? 0) >= CHUNK * 2, 'some bytes stored');
    m.pause('M');
    await until(() => m.snapshot().downloads.M.phase === 'PAUSED' && srv.log.length === 1, 'paused');
    await new Promise((r) => setTimeout(r, 10));
    const kept = (await store.status(sha256Hex(a))).contiguous;
    expect(kept).toBeGreaterThanOrEqual(CHUNK);
    expect(kept % CHUNK).toBe(0);
    m.resume('M');
    await until(() => srv.log.length === 2, 'resumed');
    expect(srv.log[1].range).toBe(`bytes=${kept}-`);
    m.pause('M');
    await until(() => m.snapshot().downloads.M.phase === 'PAUSED', 'paused again');
    await m.cancel('M');
    expect(await store.blobs()).toEqual([]);
    expect(m.snapshot().downloads.M).toBeUndefined();
    m.dispose();
  });

  it('measures speed and time left only from bytes that arrived', async () => {
    const a = bytes(300_000, 12);
    let t = 0;
    // 1000 bytes every 10 ms of the fake clock: 100 kB/s.
    const srv = server({ 'https://h/a': { data: a } }, 1000, () => void (t += 0.01));
    const m = manager(catalogue([model('M', [file('a.gguf', 'https://h/a', a)])]), srv.fetch, localModelStore(), memoryPersist(), { now: () => t });
    await m.start();
    m.acceptLicence('M');
    const seen: { speed: number | null; eta: number | null; done: number }[] = [];
    m.subscribe((s) => {
      const d = s.downloads.M;
      if (d?.phase === 'DOWNLOADING') seen.push({ speed: d.bytesPerSecond, eta: d.etaSeconds, done: d.done });
    });
    await m.download('M');
    await until(() => m.snapshot().installed.includes('M'), 'installed');
    // Nothing is said before 1.5 s of transfer was measured; afterwards it is about 100 kB/s.
    expect(seen[0].speed).toBeNull();
    expect(seen[0].eta).toBeNull();
    const measured = seen.filter((x) => x.speed !== null);
    expect(measured.length).toBeGreaterThan(0);
    for (const x of measured) {
      expect(x.speed!).toBeGreaterThan(90_000);
      expect(x.speed!).toBeLessThan(110_000);
      expect(x.eta!).toBeCloseTo((a.length - x.done) / x.speed!, 6);
    }
    m.dispose();
  });

  it('what the installer chose starts at the first start, its licence accepted there', async () => {
    const a = bytes(5_000, 13);
    const srv = server({ 'https://h/a': { data: a } });
    const base = localModelStore();
    let pending: { device: 'gpu' | 'cpu'; keys: string[] } | null = { device: 'gpu', keys: ['M', 'UNKNOWN'] };
    const store: ModelStore = { ...base, pending: async () => pending, consumePending: async () => void (pending = null) };
    const m = manager(catalogue([model('M', [file('a.gguf', 'https://h/a', a)])]), srv.fetch, store);
    await m.start();
    await until(() => m.snapshot().installed.includes('M'), 'installed');
    expect(m.snapshot().accepted).toContain('M');
    expect(pending).toBeNull();
    m.dispose();
  });

  it('a model that is not available yet cannot be downloaded', async () => {
    const a = bytes(100, 14);
    const m = manager(catalogue([model('W', [file('a.onnx', 'https://h/a', a)], { available: false })]), server({}).fetch, localModelStore());
    await m.start();
    m.acceptLicence('W');
    expect(await m.download('W')).toBe('unavailable');
    expect(stateOf(m.snapshot(), 'W')).toBe('UNAVAILABLE');
  });
});

describe('importing a model', () => {
  const f = (name: string, data: Uint8Array) => new File([data as Uint8Array<ArrayBuffer>], name);
  const manifest = (files: { name: string; bytes: number; sha256?: string }[], licence = { spdx: 'Apache-2.0', url: 'https://example.org/l', commercialUse: true }) => ({
    format: 'repackshot-model',
    name: 'My model',
    family: 'sdxl',
    role: 'img2img',
    quantization: 'fp16',
    licence,
    files: files.map((x) => ({ role: 'transformer', ...x })),
    source: 'https://example.org/my-model',
  });

  it('refuses pickle formats before reading anything', async () => {
    const m = manager(catalogue([]), server({}).fetch, localModelStore());
    await m.start();
    for (const name of ['model.ckpt', 'model.pt', 'pytorch_model.bin']) {
      const r = await m.importFiles([f(name, bytes(10, 1))], null);
      expect(r).toEqual({ kind: 'rejected', problems: [{ field: 'files', code: 'pickle', file: name }] });
    }
  });

  it('asks for a manifest when there is none, then copies, hashes and installs the files', async () => {
    const data = bytes(10_000, 15);
    const store = localModelStore();
    const m = manager(catalogue([]), server({}).fetch, store);
    await m.start();
    const files = [f('unet.safetensors', data)];
    expect(await m.importFiles(files, null)).toEqual({ kind: 'needsManifest', files: [{ name: 'unet.safetensors', bytes: 10_000 }] });
    const r = await m.importFiles(files, manifest([{ name: 'unet.safetensors', bytes: 10_000 }]));
    expect(r).toEqual({ kind: 'done', key: 'user-my-model' });
    const snap = m.snapshot();
    expect(snap.installed).toEqual(['user-my-model']);
    expect(snap.imported[0].files[0].sha256).toBe(sha256Hex(data));
    expect(stateOf(snap, 'user-my-model')).toBe('READY');
  });

  it('reads model.repackshot.json from the files, and a wrong sha256 in it fails the import', async () => {
    const data = bytes(3_000, 16);
    const m = manager(catalogue([]), server({}).fetch, localModelStore());
    await m.start();
    const bad = manifest([{ name: 'x.gguf', bytes: 3_000, sha256: sha256Hex(bytes(3_000, 17)) }]);
    const r = await m.importFiles([f('x.gguf', data), f('model.repackshot.json', new TextEncoder().encode(JSON.stringify(bad)))], null);
    expect(r).toEqual({ kind: 'failed', reason: 'mismatch', file: 'x.gguf' });
    expect(m.snapshot().installed).toEqual([]);
    expect(m.snapshot().blobs).toEqual({});
  });

  it('an unknown licence imports, marked not for commercial use', async () => {
    const data = bytes(1_000, 18);
    const m = manager(catalogue([]), server({}).fetch, localModelStore());
    await m.start();
    const r = await m.importFiles([f('x.gguf', data)], manifest([{ name: 'x.gguf', bytes: 1_000 }], { spdx: 'LicenseRef-Mine', url: 'https://example.org/l', commercialUse: true }));
    expect(r.kind).toBe('done');
    const view = allModels(m.snapshot()).find((x) => x.key === 'user-my-model')!;
    expect(view.commercial).toBe(false);
  });
});
