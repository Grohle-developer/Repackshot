// The model manager (UI.md §2.9 ▸ Models, AI-POST.md §2.2 and §5): downloads
// from the pinned URLs of the catalogue with HTTP `Range`, in chunks of a few
// MB written at their offset into the model store (io/model-store.ts), with
// progress, speed and time left from the bytes actually received, pause,
// resume (also after the page was closed: from the bytes already stored),
// cancel, verification of every file's sha256 before a model is Ready, and
// imports of the user's own models.
//
// Files are scheduled by sha256, not by model: a file two models share is
// downloaded once, and both models count it. At most `concurrency` files
// transfer at a time. What the user asked to download (and whether paused)
// and the licences accepted are kept in `persist` (localStorage in the app),
// so the downloads pick up where they were at the next start; what the
// installer of the desktop app chose (`pending-models.json`) starts at the
// first one.

import type { AiModelsCatalogue } from '../core/ai-deps';
import {
  allModels,
  blobsToDelete,
  emptySnapshot,
  etaSeconds,
  findModel,
  isAcceptedFile,
  isPickleFile,
  MANIFEST_NAME,
  presentBytes,
  SpeedMeter,
  validateManifest,
  type BlobInfo,
  type DownloadPhase,
  type ImportedModel,
  type ImportOutcome,
  type ModelsService,
  type ModelsSnapshot,
  type ModelView,
} from '../core/models';
import type { ModelStore } from './model-store';

export type FetchLike = (url: string, init: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<Response>;

/** What the manager remembers between sessions. */
export interface DownloadMemory {
  /** Models the user asked for, in order, and whether they are paused. */
  intents: [string, 'ACTIVE' | 'PAUSED'][];
  accepted: string[];
}

export interface ManagerOptions {
  store: ModelStore | null;
  /** Why there is no store, when `store` is null. */
  storeError?: string;
  catalogue: AiModelsCatalogue;
  fetch: FetchLike;
  /** Seconds (a monotonic clock). */
  now?: () => number;
  /** Bytes written per store call. */
  chunkBytes?: number;
  /** Files transferring at the same time. */
  concurrency?: number;
  persist?: { load(): DownloadMemory | null; save(m: DownloadMemory): void };
  /** Retries of a file after a network failure, with these waits (ms), before the model pauses with the error. */
  retryDelays?: readonly number[];
  /** How often progress is reported while bytes arrive (ms). */
  emitEveryMs?: number;
  /** Asks the browser to keep the store (navigator.storage.persist) at the first download. */
  requestPersistence?: () => Promise<boolean>;
}

interface Transfer {
  sha: string;
  controller: AbortController;
  meter: SpeedMeter;
  verifying: boolean;
  /** Bytes of the file stored so far (written): where a download resumes. */
  stored: number;
  /** Bytes received so far, stored or still in the chunk being filled: the progress shown. */
  received: number;
}

const isAbort = (e: unknown) => e instanceof DOMException ? e.name === 'AbortError' : (e as { name?: string } | null)?.name === 'AbortError';

/** `bytes a-b/total` → a, or null. */
function rangeStart(header: string | null): number | null {
  const m = header ? /^bytes\s+(\d+)-\d+\/(\d+|\*)$/i.exec(header.trim()) : null;
  return m ? Number(m[1]) : null;
}

export class DownloadManager implements ModelsService {
  private snap: ModelsSnapshot;
  private readonly listeners = new Set<(s: ModelsSnapshot) => void>();
  private readonly intents = new Map<string, 'ACTIVE' | 'PAUSED'>();
  private readonly accepted = new Set<string>();
  private readonly transfers = new Map<string, Transfer>();
  private readonly errors = new Map<string, string>();
  private readonly failures = new Map<string, number>();
  private readonly retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly now: () => number;
  private readonly chunkBytes: number;
  private readonly concurrency: number;
  private readonly retryDelays: readonly number[];
  private readonly emitEveryMs: number;
  private lastEmit = 0;
  private emitTimer: ReturnType<typeof setTimeout> | null = null;
  private persistAsked = false;
  private started = false;
  private importBusy = false;

  constructor(private readonly opts: ManagerOptions) {
    this.snap = { ...emptySnapshot(opts.catalogue), kind: opts.store?.kind ?? 'none', location: opts.store?.location ?? null, error: opts.store ? null : (opts.storeError ?? 'none') };
    this.now = opts.now ?? (() => performance.now() / 1000);
    this.chunkBytes = opts.chunkBytes ?? 4 * 1024 * 1024;
    this.concurrency = Math.max(1, opts.concurrency ?? 2);
    this.retryDelays = opts.retryDelays ?? [2000, 5000, 15000];
    this.emitEveryMs = opts.emitEveryMs ?? 200;
    const mem = opts.persist?.load();
    if (mem) {
      for (const [k, v] of mem.intents) if (typeof k === 'string' && (v === 'ACTIVE' || v === 'PAUSED')) this.intents.set(k, v);
      for (const k of mem.accepted) if (typeof k === 'string') this.accepted.add(k);
    }
    this.snap.accepted = [...this.accepted];
  }

  // ------------------------------------------------------------------ reading

  snapshot(): ModelsSnapshot {
    return this.snap;
  }

  subscribe(fn: (s: ModelsSnapshot) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Reads the store, takes the installer's choice, and resumes what was being downloaded. */
  async start(): Promise<void> {
    const store = this.opts.store;
    if (!store) {
      this.emit(true);
      return;
    }
    try {
      await store.probe();
    } catch (err) {
      this.snap = { ...this.snap, ready: false, kind: 'none', error: err instanceof Error ? err.message : String(err) };
      this.emit(true);
      return;
    }
    await this.refresh();
    try {
      const pending = await store.pending();
      if (pending && pending.keys.length > 0) {
        // The installer showed each licence and the person chose these: they start now.
        for (const key of pending.keys) {
          const m = findModel(this.snap, key);
          if (!m || !m.available || this.snap.installed.includes(key)) continue;
          this.accepted.add(key);
          if (!this.intents.has(key)) this.intents.set(key, 'ACTIVE');
        }
        await store.consumePending();
        this.save();
      }
    } catch {
      // Not fatal: the choice stays where the installer left it for the next start.
    }
    this.started = true;
    this.schedule();
    this.emit(true);
  }

  async refresh(): Promise<void> {
    const store = this.opts.store;
    if (!store) return;
    const [blobs, installed, imported] = await Promise.all([store.blobs(), store.installed(), store.imported()]);
    const map: Record<string, BlobInfo> = {};
    for (const b of blobs) map[b.sha256] = b;
    this.snap = { ...this.snap, ready: true, error: null, blobs: map, installed, imported };
    // Asked-for models that are installed now are done.
    for (const key of [...this.intents.keys()]) if (installed.includes(key)) this.intents.delete(key);
    this.recompute();
    this.emit(true);
  }

  // ------------------------------------------------------------------ actions

  acceptLicence(key: string): void {
    if (this.accepted.has(key)) return;
    this.accepted.add(key);
    this.save();
    this.recompute();
    this.emit(true);
  }

  async download(key: string): Promise<'started' | 'needsLicence' | 'unavailable' | 'noStore'> {
    const store = this.opts.store;
    if (!store || !this.snap.ready) return 'noStore';
    const m = findModel(this.snap, key);
    if (!m || !m.available || m.source !== 'catalogue') return 'unavailable';
    if (!this.accepted.has(key)) return 'needsLicence';
    // A damaged file of this model is deleted first, then downloaded again.
    for (const f of m.files) {
      if (this.snap.blobs[f.sha256]?.damaged) {
        await store.deleteBlob(f.sha256);
        this.setBlob({ sha256: f.sha256, state: 'missing', contiguous: 0, total: f.bytes, damaged: false });
      }
    }
    this.errors.delete(key);
    this.intents.delete(key);
    this.intents.set(key, 'ACTIVE');
    this.save();
    if (!this.persistAsked && this.opts.requestPersistence) {
      this.persistAsked = true;
      void this.opts.requestPersistence().catch(() => false);
    }
    this.started = true;
    this.schedule();
    this.emit(true);
    return 'started';
  }

  pause(key: string): void {
    if (!this.intents.has(key)) return;
    this.intents.set(key, 'PAUSED');
    this.save();
    for (const sha of this.shasOf(key)) if (!this.wantedBy(sha, key)) this.stopTransfer(sha);
    this.recompute();
    this.emit(true);
  }

  resume(key: string): void {
    if (!this.intents.has(key)) return;
    this.errors.delete(key);
    for (const sha of this.shasOf(key)) this.failures.delete(sha);
    this.intents.set(key, 'ACTIVE');
    this.save();
    this.schedule();
    this.emit(true);
  }

  async cancel(key: string): Promise<void> {
    this.intents.delete(key);
    this.errors.delete(key);
    this.save();
    const store = this.opts.store;
    const models = allModels(this.snap);
    const others = [...this.intents.keys()];
    // What only this model needed: no installed model and no other download uses it.
    const drop = blobsToDelete(models, this.snap.installed, key, others);
    for (const sha of this.shasOf(key)) if (!this.wantedBy(sha, key)) this.stopTransfer(sha);
    if (store) for (const sha of drop) await store.deleteBlob(sha).catch(() => undefined);
    await this.refresh();
  }

  async remove(key: string): Promise<void> {
    const store = this.opts.store;
    if (!store) return;
    const models = allModels(this.snap);
    const keep = [...this.intents.keys()].filter((k) => k !== key);
    const drop = blobsToDelete(models, this.snap.installed, key, keep);
    this.intents.delete(key);
    this.save();
    await store.uninstall(key, drop, keep);
    await this.refresh();
  }

  // ------------------------------------------------------------------ imports

  async importFiles(files: readonly File[], manifestRaw: unknown | null): Promise<ImportOutcome> {
    const store = this.opts.store;
    if (!store || !this.snap.ready) return { kind: 'failed', reason: 'store' };
    if (this.importBusy) return { kind: 'failed', reason: 'busy' };
    const nameOf = (f: File) => (f as File & { webkitRelativePath?: string }).webkitRelativePath?.split('/').slice(1).join('/') || f.name;
    const pickles = files.filter((f) => isPickleFile(f.name));
    if (pickles.length > 0) return { kind: 'rejected', problems: pickles.map((f) => ({ field: 'files' as const, code: 'pickle' as const, file: f.name })) };
    const manifestFile = files.find((f) => f.name === MANIFEST_NAME);
    const payload = files.filter((f) => f !== manifestFile);
    const unsupported = payload.filter((f) => !isAcceptedFile(f.name));
    if (unsupported.length > 0) return { kind: 'rejected', problems: unsupported.map((f) => ({ field: 'files' as const, code: 'unsupported' as const, file: f.name })) };
    let raw = manifestRaw;
    if (raw === null && manifestFile) {
      try {
        raw = JSON.parse(await manifestFile.text());
      } catch {
        return { kind: 'rejected', problems: [{ field: 'format', code: 'notManifest' }] };
      }
    }
    if (raw === null) return { kind: 'needsManifest', files: payload.map((f) => ({ name: nameOf(f), bytes: f.size })) };
    const taken = allModels(this.snap).map((m) => m.key);
    const checked = validateManifest(raw, { selected: payload.map(nameOf), taken });
    if (!checked.ok) return { kind: 'rejected', problems: checked.problems };
    const model = checked.model;
    this.importBusy = true;
    try {
      const done: ImportedModel['files'] = [];
      for (const entry of model.files) {
        const file = payload.find((f) => nameOf(f) === entry.name)!;
        if (file.size !== entry.bytes) return { kind: 'failed', reason: 'size', file: entry.name };
        let sha = entry.sha256;
        if (!sha) {
          this.setImporting({ name: entry.name, phase: 'HASHING', done: 0, total: file.size });
          sha = await store.hash(file, (n) => this.setImporting({ name: entry.name, phase: 'HASHING', done: n, total: file.size }));
        }
        const have = await store.status(sha);
        if (have.state !== 'complete') {
          if (have.damaged) await store.deleteBlob(sha);
          for (let at = 0; at < file.size; at += this.chunkBytes) {
            const bytes = new Uint8Array(await file.slice(at, at + this.chunkBytes).arrayBuffer());
            await store.write(sha, at, bytes, file.size);
            this.setImporting({ name: entry.name, phase: 'COPYING', done: Math.min(file.size, at + bytes.length), total: file.size });
          }
          const r = await store.finish(sha, file.size);
          if (!r.ok) {
            await store.deleteBlob(sha).catch(() => undefined);
            return { kind: 'failed', reason: 'mismatch', file: entry.name };
          }
        }
        done.push({ ...entry, sha256: sha });
      }
      const final: ImportedModel = { ...model, files: done };
      await store.putImported(final);
      await store.install(final.key, done.map((f) => f.sha256));
      return { kind: 'done', key: final.key };
    } catch (err) {
      return { kind: 'failed', reason: 'store', message: err instanceof Error ? err.message : String(err) };
    } finally {
      this.importBusy = false;
      this.setImporting(null);
      await this.refresh();
    }
  }

  // ------------------------------------------------------------------ scheduling

  private shasOf(key: string): string[] {
    const m = findModel(this.snap, key);
    return m ? [...new Set(m.files.map((f) => f.sha256))] : [];
  }

  /** Another active model than `except` needs this file. */
  private wantedBy(sha: string, except: string): boolean {
    for (const [k, v] of this.intents) if (k !== except && v === 'ACTIVE' && this.shasOf(k).includes(sha)) return true;
    return false;
  }

  /** The files to fetch, in the order the models were asked for. */
  private wanted(): { sha: string; url: string; bytes: number }[] {
    const out: { sha: string; url: string; bytes: number }[] = [];
    const seen = new Set<string>();
    for (const [key, intent] of this.intents) {
      if (intent !== 'ACTIVE') continue;
      const m = findModel(this.snap, key);
      if (!m) continue;
      for (const f of m.files) {
        if (seen.has(f.sha256) || !f.url) continue;
        seen.add(f.sha256);
        const b = this.snap.blobs[f.sha256];
        if (b?.state === 'complete' || b?.damaged) continue;
        if ((this.failures.get(f.sha256) ?? 0) > this.retryDelays.length || this.retryTimers.has(f.sha256)) continue;
        out.push({ sha: f.sha256, url: f.url, bytes: f.bytes });
      }
    }
    return out;
  }

  private schedule(): void {
    if (!this.opts.store || !this.started) return;
    for (const w of this.wanted()) {
      if (this.transfers.has(w.sha)) continue;
      if (this.transfers.size >= this.concurrency) break;
      void this.transfer(w.sha, w.url, w.bytes);
    }
    void this.installFinished();
    this.recompute();
  }

  /** Models asked for whose every file is complete become installed. */
  private async installFinished(): Promise<void> {
    const store = this.opts.store;
    if (!store) return;
    for (const [key] of [...this.intents]) {
      const m = findModel(this.snap, key);
      if (!m || this.snap.installed.includes(key)) continue;
      if (!m.files.every((f) => this.snap.blobs[f.sha256]?.state === 'complete')) continue;
      try {
        await store.install(key, m.files.map((f) => f.sha256));
        this.intents.delete(key);
        this.save();
        this.snap = { ...this.snap, installed: [...this.snap.installed.filter((k) => k !== key), key] };
        this.recompute();
        this.emit(true);
      } catch (err) {
        this.errors.set(key, err instanceof Error ? err.message : String(err));
      }
    }
  }

  private stopTransfer(sha: string): void {
    const t = this.transfers.get(sha);
    if (!t || t.verifying) return;
    t.controller.abort();
  }

  private async transfer(sha: string, url: string, bytes: number): Promise<void> {
    const store = this.opts.store!;
    const t: Transfer = { sha, controller: new AbortController(), meter: new SpeedMeter(), verifying: false, stored: 0, received: 0 };
    this.transfers.set(sha, t);
    this.recompute();
    this.emit(true);
    try {
      let status = await store.status(sha);
      if (status.state === 'complete') {
        this.setBlob(status);
        return;
      }
      let offset = status.total === bytes ? status.contiguous : 0;
      t.stored = offset;
      t.received = offset;
      if (offset < bytes) {
        const res = await this.opts.fetch(url, { headers: offset > 0 ? { Range: `bytes=${offset}-` } : {}, signal: t.controller.signal });
        if (res.status === 206) {
          if (rangeStart(res.headers.get('content-range')) !== offset) throw new Error(`range: asked from ${offset}, got ${res.headers.get('content-range')}`);
        } else if (res.status === 200) {
          // The server sent the whole file: write it from the start.
          offset = 0;
          t.stored = 0;
          t.received = 0;
        } else if (res.status === 416 && offset === bytes) {
          // Nothing left to send.
        } else throw new Error(`HTTP ${res.status}`);
        if (res.status !== 416) {
          if (!res.body) throw new Error('no body');
          const reader = res.body.getReader();
          const buf = new Uint8Array(Math.min(this.chunkBytes, bytes));
          let fill = 0;
          let pos = offset;
          const flush = async () => {
            if (fill === 0) return;
            if (pos + fill > bytes) throw new Error('longer than its size');
            status = await store.write(sha, pos, buf.slice(0, fill), bytes);
            pos += fill;
            t.stored = pos;
            fill = 0;
            this.setBlob(status);
          };
          for (;;) {
            const r = await reader.read();
            if (r.done) break;
            const chunk = r.value;
            t.meter.add(this.now(), chunk.length);
            let i = 0;
            while (i < chunk.length) {
              const take = Math.min(buf.length - fill, chunk.length - i);
              buf.set(chunk.subarray(i, i + take), fill);
              fill += take;
              i += take;
              if (fill === buf.length) await flush();
            }
            t.received = pos + fill;
            this.recompute();
            this.emit(false);
          }
          await flush();
          if (pos !== bytes) throw new Error(`short: ${pos} of ${bytes} bytes`);
        }
      }
      // Every byte is there: verify.
      t.verifying = true;
      this.recompute();
      this.emit(true);
      const r = await store.finish(sha, bytes);
      if (r.ok) {
        this.failures.delete(sha);
        this.setBlob({ sha256: sha, state: 'complete', contiguous: bytes, total: bytes, damaged: false });
      } else if (r.reason === 'mismatch') {
        this.setBlob({ sha256: sha, state: 'partial', contiguous: bytes, total: bytes, damaged: true, actual: r.actual });
        for (const key of this.modelsUsing(sha)) {
          this.errors.set(key, 'damaged');
          if (this.intents.get(key) === 'ACTIVE') this.intents.set(key, 'PAUSED');
        }
        this.save();
      } else {
        this.setBlob(await store.status(sha));
      }
    } catch (err) {
      if (t.controller.signal.aborted || isAbort(err)) {
        await store.release(sha).catch(() => undefined);
      } else {
        const n = (this.failures.get(sha) ?? 0) + 1;
        this.failures.set(sha, n);
        const message = err instanceof Error ? err.message : String(err);
        const delay = this.retryDelays[n - 1];
        if (delay !== undefined) {
          this.retryTimers.set(
            sha,
            setTimeout(() => {
              this.retryTimers.delete(sha);
              this.schedule();
              this.emit(true);
            }, delay),
          );
        } else {
          for (const key of this.modelsUsing(sha)) {
            this.errors.set(key, message);
            if (this.intents.get(key) === 'ACTIVE') this.intents.set(key, 'PAUSED');
          }
          this.save();
        }
        try {
          this.setBlob(await store.status(sha));
        } catch {
          // The store will be read again on refresh.
        }
      }
    } finally {
      this.transfers.delete(sha);
      this.schedule();
      this.emit(true);
    }
  }

  private modelsUsing(sha: string): string[] {
    return allModels(this.snap)
      .filter((m) => m.files.some((f) => f.sha256 === sha))
      .map((m) => m.key);
  }

  // ------------------------------------------------------------------ the snapshot

  private setBlob(b: BlobInfo): void {
    this.snap = { ...this.snap, blobs: { ...this.snap.blobs, [b.sha256]: b } };
    this.recompute();
  }

  private setImporting(v: ModelsSnapshot['importing']): void {
    this.snap = { ...this.snap, importing: v };
    this.emit(v === null);
  }

  /** The downloads part of the snapshot, from the intents, the transfers and the store. */
  private recompute(): void {
    const downloads: ModelsSnapshot['downloads'] = {};
    const now = this.now();
    for (const [key, intent] of this.intents) {
      const m: ModelView | undefined = findModel(this.snap, key);
      if (!m || this.snap.installed.includes(key)) continue;
      let speed: number | null = null;
      let downloading = false;
      let verifying = false;
      for (const sha of new Set(m.files.map((f) => f.sha256))) {
        const t = this.transfers.get(sha);
        if (!t) continue;
        if (t.verifying) verifying = true;
        else {
          downloading = true;
          const r = t.meter.rate(now);
          if (r !== null) speed = (speed ?? 0) + r;
        }
      }
      const done = Math.min(m.totalBytes, presentBytes(m, this.liveBlobs()));
      const error = this.errors.get(key);
      let phase: DownloadPhase;
      if (intent === 'PAUSED') phase = 'PAUSED';
      else if (downloading) phase = 'DOWNLOADING';
      else if (verifying) phase = 'VERIFYING';
      else if (error) phase = 'ERROR';
      else phase = 'QUEUED';
      downloads[key] = { key, phase, done, total: m.totalBytes, bytesPerSecond: phase === 'DOWNLOADING' ? speed : null, etaSeconds: phase === 'DOWNLOADING' ? etaSeconds(m.totalBytes - done, speed) : null, ...(error ? { error } : {}) };
    }
    this.snap = { ...this.snap, downloads, accepted: [...this.accepted] };
  }

  /** The store's blobs with the bytes transfers have written since. */
  private liveBlobs(): Record<string, BlobInfo> {
    if (this.transfers.size === 0) return this.snap.blobs;
    const out = { ...this.snap.blobs };
    for (const t of this.transfers.values()) {
      const b = out[t.sha];
      if (!b || b.state !== 'complete') out[t.sha] = { sha256: t.sha, state: 'partial', contiguous: t.verifying ? t.stored : t.received, total: b?.total ?? null, damaged: false };
    }
    return out;
  }

  private emit(force: boolean): void {
    const ms = Date.now();
    if (!force && ms - this.lastEmit < this.emitEveryMs) {
      if (!this.emitTimer) this.emitTimer = setTimeout(() => ((this.emitTimer = null), this.emit(true)), this.emitEveryMs);
      return;
    }
    if (this.emitTimer) {
      clearTimeout(this.emitTimer);
      this.emitTimer = null;
    }
    this.lastEmit = ms;
    for (const fn of [...this.listeners]) fn(this.snap);
  }

  private save(): void {
    this.opts.persist?.save({ intents: [...this.intents], accepted: [...this.accepted] });
  }

  /** Stops every transfer and timer (tests; the page closing does it by itself). */
  dispose(): void {
    for (const t of this.transfers.values()) t.controller.abort();
    for (const timer of this.retryTimers.values()) clearTimeout(timer);
    if (this.emitTimer) clearTimeout(this.emitTimer);
  }
}
