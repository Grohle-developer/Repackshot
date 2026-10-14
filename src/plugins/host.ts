// The plugin host (ROADMAP P6 decision 2, ARCHITECTURE.md §9): installs plugins from the registry or from a file,
// keeps them (store.ts: the package encrypted, the key apart), and runs them.
//
// Install from the registry: download → the size and SHA-256 the registry pins → the package's header (its id and
// version must be the registry's, its ciphertext's SHA-256 its header's) → the activation key from the entry's
// `keyUrl`, or asked of the person (NEEDS_KEY; `provideKey` goes on) → the package opened in memory with it and its
// manifest checked → kept. Install from a file: the same from the header on, with the key typed.
//
// Run: the package is decrypted in memory, its manifest checked again, its WebAssembly module compiled and, when the
// manifest says `wasm.noImports`, refused if `WebAssembly.Module.imports()` is not empty; `plugin.js` becomes a Blob
// URL started as a module Worker, and the `init` message transfers the module's bytes and the files the manifest
// lists. A plugin never sees the DOM or the store: requests and answers are the messages of abi.ts.

import { parseManifest, PLUGIN_ABI, type InstalledPlugin, type InstallOutcome, type PluginFault, type PluginManifest, type PluginsSnapshot, type PluginTask } from '../core/plugins';
import type { PluginRegistryEntry } from '../data/plugins';
import { cleanInfo, cleanPresets, type HostMessage, type PluginInfo, type PluginMessage, type PluginPresets, type RenderAnswer, type RenderRequest } from './abi';
import { parseKey, RpkError, sha256Hex, toBase64, unpackRpk, verifyRpk, type RpkHeader } from './rpk';
import type { PluginStore, StoredPlugin } from './store';

/** What a Worker is to the host (a real one in the page, a shim in the tests). */
export interface WorkerLike {
  onmessage: ((e: { data: unknown }) => void) | null;
  onerror: ((e: unknown) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
  terminate(): void;
}

export interface HostDeps {
  store: PluginStore | Promise<PluginStore>;
  registry: readonly PluginRegistryEntry[];
  fetch(url: string, init?: RequestInit): Promise<Response>;
  /** Starts the module worker of a Blob URL: `new Worker(url, { type: 'module' })` in the page. */
  spawn(url: string): WorkerLike;
  createObjectURL(blob: Blob): string;
  revokeObjectURL(url: string): void;
  now(): number;
  subtle?: SubtleCrypto;
  /** Milliseconds a plugin has to answer `init` with `ready`. */
  startTimeoutMs?: number;
}

export class PluginError extends Error {
  readonly fault: PluginFault;
  constructor(fault: PluginFault, message: string) {
    super(message);
    this.name = 'PluginError';
    this.fault = fault;
  }
}

/** A package opened in memory: its header, its manifest and its files. */
export interface OpenedPlugin {
  header: RpkHeader;
  manifest: PluginManifest;
  files: Map<string, Uint8Array>;
}

const RPK_FAULT: Record<string, PluginFault> = { NOT_RPK: 'NOT_RPK', HEADER: 'DAMAGED', DAMAGED: 'DAMAGED', KEY: 'KEY', BAD_KEY: 'BAD_KEY', CONTAINER: 'DAMAGED' };

function faultOf(err: unknown): PluginError {
  if (err instanceof PluginError) return err;
  if (err instanceof RpkError) return new PluginError(RPK_FAULT[err.code] ?? 'DAMAGED', err.message);
  return new PluginError('STORE', err instanceof Error ? err.message : String(err));
}

/** Opens a package with its key and checks its manifest against its header and its files. */
export async function openPackage(bytes: Uint8Array, key: Uint8Array, subtle?: SubtleCrypto): Promise<OpenedPlugin> {
  const { header, files: list } = await unpackRpk(bytes, key, subtle ? { subtle } : {});
  const files = new Map(list.map((f) => [f.name, f.bytes] as const));
  const raw = files.get('manifest.json');
  if (!raw) throw new PluginError('MANIFEST', 'the package has no manifest.json');
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    throw new PluginError('MANIFEST', 'manifest.json is not JSON');
  }
  if (typeof json === 'object' && json !== null && (json as { abi?: unknown }).abi !== PLUGIN_ABI) throw new PluginError('ABI', `the plugin speaks ABI ${String((json as { abi?: unknown }).abi)}; this Repackshot speaks ${PLUGIN_ABI}`);
  const parsed = parseManifest(json);
  if (!parsed.ok) throw new PluginError('MANIFEST', `manifest.json: ${parsed.problems.join(', ')}`);
  const m = parsed.manifest;
  if (m.id !== header.id || m.version !== header.version || m.abi !== header.abi) throw new PluginError('MISMATCH', `the manifest (${m.id} ${m.version}) is not the package's header (${header.id} ${header.version})`);
  const needed = [m.entry, m.logo, ...(m.wasm ? [m.wasm.file] : []), ...(m.licence.file ? [m.licence.file] : []), ...(m.notices ? [m.notices] : []), ...(m.base ? [m.base] : []), ...m.files];
  const missing = needed.filter((n) => !files.has(n));
  if (missing.length) throw new PluginError('MANIFEST', `the package lacks ${missing.join(', ')}`);
  return { header, manifest: m, files };
}

/** An SVG of a package as a `data:` URL (an <img> never runs what an SVG holds). */
function svgDataUrl(bytes: Uint8Array | undefined): string | null {
  if (!bytes || bytes.length > 512 * 1024) return null;
  return `data:image/svg+xml;base64,${toBase64(bytes)}`;
}

const abortError = () => new DOMException('aborted', 'AbortError');

/** A running plugin: its worker, and the requests in flight. */
export class PluginSession {
  readonly manifest: PluginManifest;
  private readonly worker: WorkerLike;
  private seq = 0;
  private readonly pending = new Map<number, { type: string; resolve(v: unknown): void; reject(e: unknown): void }>();
  private dead: Error | null = null;
  private readonly onClose: () => void;

  constructor(manifest: PluginManifest, worker: WorkerLike, onClose: () => void) {
    this.manifest = manifest;
    this.worker = worker;
    this.onClose = onClose;
    worker.onmessage = (e) => this.receive(e.data as PluginMessage);
    worker.onerror = (e) => this.fail(new PluginError('START', `the plugin stopped: ${String((e as { message?: string })?.message ?? e)}`));
  }

  get alive(): boolean {
    return this.dead === null;
  }

  private receive(msg: PluginMessage): void {
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'error' && msg.id === null) {
      this.fail(new PluginError('START', `the plugin failed: ${msg.message}`));
      return;
    }
    if (!('id' in msg) || typeof msg.id !== 'number') return;
    const p = this.pending.get(msg.id);
    if (!p) return; // cancelled, or answered already: dropped
    this.pending.delete(msg.id);
    if (msg.type === 'error') p.reject(new Error(msg.message));
    else if (msg.type === 'cancelled') p.reject(abortError());
    else if (msg.type !== p.type) p.reject(new Error(`the plugin answered ${msg.type} to ${p.type}`));
    else p.resolve(msg);
  }

  private fail(err: Error): void {
    if (this.dead) return;
    this.dead = err;
    for (const p of this.pending.values()) p.reject(err);
    this.pending.clear();
    this.worker.terminate();
    this.onClose();
  }

  private ask<T>(type: 'info' | 'presets' | 'render', body: Record<string, unknown>, transfer: Transferable[] = [], signal?: AbortSignal): Promise<T> {
    if (this.dead) return Promise.reject(this.dead);
    if (signal?.aborted) return Promise.reject(abortError());
    const id = ++this.seq;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { type, resolve: resolve as (v: unknown) => void, reject });
      signal?.addEventListener(
        'abort',
        () => {
          if (!this.pending.has(id)) return;
          this.pending.delete(id);
          // The plugin drops it if it has not started it; an answer that still comes is dropped here.
          if (!this.dead) this.worker.postMessage({ type: 'cancel', id } satisfies HostMessage);
          reject(abortError());
        },
        { once: true },
      );
      this.worker.postMessage({ type, id, ...body } as HostMessage, transfer);
    });
  }

  async info(): Promise<PluginInfo> {
    const m = await this.ask<{ info: PluginInfo }>('info', {});
    return m.info;
  }

  async presets(): Promise<PluginPresets> {
    return cleanPresets(await this.ask<unknown>('presets', {}));
  }

  /** Renders `req` (its pixel buffer is transferred: the caller gives it up). */
  async render(req: RenderRequest, signal?: AbortSignal): Promise<RenderAnswer> {
    const n = req.width * req.height;
    const want = req.pixels.kind === 'rgba8' ? 4 * n : 3 * n;
    if (!(n > 0) || req.pixels.data.length !== want) throw new Error(`${req.pixels.data.length} values are not ${req.width}×${req.height} pixels of ${req.pixels.kind}`);
    const m = await this.ask<RenderAnswer>('render', { width: req.width, height: req.height, pixels: req.pixels, recipe: req.recipe, controls: req.controls }, [req.pixels.data.buffer as ArrayBuffer], signal);
    const rgba8 = m.rgba8 instanceof Uint8ClampedArray ? m.rgba8 : m.rgba8 && ArrayBuffer.isView(m.rgba8) ? new Uint8ClampedArray((m.rgba8 as Uint8Array).buffer) : null;
    if (m.width !== req.width || m.height !== req.height || !rgba8 || rgba8.length !== 4 * n) throw new Error(`the plugin answered ${m.width}×${m.height} for ${req.width}×${req.height}`);
    return { width: m.width, height: m.height, rgba8, info: cleanInfo(m.info) };
  }

  close(): void {
    this.fail(new Error('closed'));
  }
}

type Pending = { bytes: Uint8Array; sha256: string; header: RpkHeader; source: 'registry' | 'file' };

/** The host: installs, keeps, opens and runs plugins; its state is a snapshot the interface subscribes to. */
export class PluginHost {
  private readonly deps: HostDeps;
  private readonly storeReady: Promise<PluginStore>;
  private snap: PluginsSnapshot = { ready: false, persistent: false, installed: [], tasks: {} };
  private readonly listeners = new Set<(s: PluginsSnapshot) => void>();
  private readonly pending = new Map<string, Pending>();
  private readonly sessions = new Map<string, Promise<PluginSession>>();
  /** What each installed package showed when opened (its manifest and logo), by id and SHA-256. */
  private readonly opened = new Map<string, { sha256: string; manifest: PluginManifest | null; logo: string | null; problem: PluginFault | null }>();

  constructor(deps: HostDeps) {
    this.deps = deps;
    this.storeReady = Promise.resolve(deps.store);
  }

  /** Reads what is installed (call once at start). */
  async start(): Promise<void> {
    await this.refresh();
  }

  snapshot(): PluginsSnapshot {
    return this.snap;
  }

  subscribe(fn: (s: PluginsSnapshot) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(patch: Partial<PluginsSnapshot>): void {
    this.snap = { ...this.snap, ...patch };
    for (const fn of this.listeners) fn(this.snap);
  }

  private task(id: string, t: PluginTask | null): void {
    const tasks = { ...this.snap.tasks };
    if (t) tasks[id] = t;
    else delete tasks[id];
    this.emit({ tasks });
  }

  private async refresh(): Promise<void> {
    const store = await this.storeReady;
    const list = await store.list();
    const installed: InstalledPlugin[] = [];
    for (const p of list) {
      let o = this.opened.get(p.id);
      if (!o || o.sha256 !== p.sha256) {
        try {
          const opened = await this.openStored(p.id);
          o = { sha256: p.sha256, manifest: opened.manifest, logo: svgDataUrl(opened.files.get(opened.manifest.logo)), problem: null };
        } catch (err) {
          o = { sha256: p.sha256, manifest: null, logo: null, problem: faultOf(err).fault };
        }
        this.opened.set(p.id, o);
      }
      installed.push({ id: p.id, version: p.version, size: p.size, sha256: p.sha256, source: p.source, installedAt: p.installedAt, manifest: o.manifest, logo: o.logo, problem: o.problem });
    }
    this.emit({ ready: true, persistent: store.persistent, installed });
  }

  private async openStored(id: string): Promise<OpenedPlugin> {
    const store = await this.storeReady;
    const [p, key] = await Promise.all([store.get(id), store.key(id)]);
    if (!p || !key) throw new PluginError('STORE', `${id} is not installed`);
    return openPackage(new Uint8Array(p.bytes), parseKey(key), this.deps.subtle);
  }

  private entry(id: string): PluginRegistryEntry | undefined {
    return this.deps.registry.find((e) => e.id === id);
  }

  /** Install (or update) a plugin of the registry. */
  async install(id: string): Promise<InstallOutcome> {
    const entry = this.entry(id);
    if (!entry) return { kind: 'FAILED', fault: 'MISMATCH', detail: `${id} is not in the registry` };
    if (this.snap.tasks[id] && this.snap.tasks[id].stage !== 'FAILED' && this.snap.tasks[id].stage !== 'NEEDS_KEY') return { kind: 'FAILED', fault: 'DOWNLOAD', detail: 'already installing' };
    this.pending.delete(id);
    try {
      this.task(id, { stage: 'DOWNLOADING', done: 0, total: entry.bytes });
      const bytes = await this.download(entry);
      this.task(id, { stage: 'VERIFYING' });
      if (bytes.length !== entry.bytes) throw new PluginError('SIZE', `${bytes.length} bytes arrived; the registry pins ${entry.bytes}`);
      const sha256 = await sha256Hex(bytes, this.deps.subtle);
      if (sha256 !== entry.sha256) throw new PluginError('SHA256', `the package's SHA-256 is ${sha256}; the registry pins ${entry.sha256}`);
      const header = await verifyRpk(bytes, this.deps.subtle);
      if (header.id !== entry.id || header.version !== entry.version) throw new PluginError('MISMATCH', `the package is ${header.id} ${header.version}; the registry names ${entry.id} ${entry.version}`);
      this.pending.set(id, { bytes, sha256, header, source: 'registry' });
      // An update first tries the key it already has; then the registry's key address; then the person.
      const kept = await (await this.storeReady).key(id).catch(() => null);
      if (kept && (await this.tryKey(id, kept))) return { kind: 'DONE', id, version: header.version };
      if (entry.keyUrl) {
        const fetched = await this.fetchKey(entry.keyUrl);
        if (fetched && (await this.tryKey(id, fetched))) return { kind: 'DONE', id, version: header.version };
        this.task(id, { stage: 'NEEDS_KEY', reason: 'FAILED' });
        return { kind: 'NEEDS_KEY', id, reason: 'FAILED' };
      }
      this.task(id, { stage: 'NEEDS_KEY', reason: 'NONE' });
      return { kind: 'NEEDS_KEY', id, reason: 'NONE' };
    } catch (err) {
      return this.failed(id, err);
    }
  }

  private failed(id: string, err: unknown): InstallOutcome {
    const e = faultOf(err);
    this.pending.delete(id);
    this.task(id, { stage: 'FAILED', fault: e.fault, detail: e.message });
    return { kind: 'FAILED', fault: e.fault, detail: e.message };
  }

  private async download(entry: PluginRegistryEntry): Promise<Uint8Array> {
    let res: Response;
    try {
      res = await this.deps.fetch(entry.url, { cache: 'no-store' });
    } catch (err) {
      throw new PluginError('DOWNLOAD', err instanceof Error ? err.message : String(err));
    }
    if (!res.ok) throw new PluginError('DOWNLOAD', `HTTP ${res.status}`);
    const reader = res.body?.getReader();
    if (!reader) return new Uint8Array(await res.arrayBuffer());
    const parts: Uint8Array[] = [];
    let done = 0;
    for (;;) {
      const r = await reader.read();
      if (r.done) break;
      parts.push(r.value);
      done += r.value.length;
      if (done > entry.bytes * 2 + 1024) throw new PluginError('SIZE', `more than ${entry.bytes} bytes are arriving`);
      this.task(entry.id, { stage: 'DOWNLOADING', done, total: entry.bytes });
    }
    const out = new Uint8Array(done);
    let at = 0;
    for (const p of parts) {
      out.set(p, at);
      at += p.length;
    }
    return out;
  }

  private async fetchKey(url: string): Promise<string | null> {
    try {
      const res = await this.deps.fetch(url, { cache: 'no-store' });
      return res.ok ? (await res.text()).trim() : null;
    } catch {
      return null;
    }
  }

  /** Opens the pending package with `keyText`; on success it is kept and the install is done. */
  private async tryKey(id: string, keyText: string): Promise<boolean> {
    const p = this.pending.get(id);
    if (!p) return false;
    let key: Uint8Array;
    try {
      key = parseKey(keyText);
    } catch {
      return false;
    }
    let opened: OpenedPlugin;
    try {
      opened = await openPackage(p.bytes, key, this.deps.subtle);
    } catch (err) {
      if (err instanceof RpkError && err.code === 'KEY') return false;
      throw err;
    }
    await this.keep(p, opened, keyText.trim());
    return true;
  }

  private async keep(p: Pending, opened: OpenedPlugin, keyText: string): Promise<void> {
    const id = opened.header.id;
    this.task(id, { stage: 'INSTALLING' });
    const stored: StoredPlugin = { id, version: opened.header.version, bytes: p.bytes.slice().buffer, sha256: p.sha256, source: p.source, installedAt: this.deps.now() };
    try {
      await (await this.storeReady).put(stored, keyText);
    } catch (err) {
      throw new PluginError('STORE', err instanceof Error ? err.message : String(err));
    }
    this.pending.delete(id);
    await this.closeSession(id);
    this.opened.set(id, { sha256: p.sha256, manifest: opened.manifest, logo: svgDataUrl(opened.files.get(opened.manifest.logo)), problem: null });
    this.task(id, null);
    await this.refresh();
  }

  /** The activation key the person typed for an install waiting for one. */
  async provideKey(id: string, keyText: string): Promise<InstallOutcome> {
    const p = this.pending.get(id);
    if (!p) return { kind: 'FAILED', fault: 'KEY', detail: 'nothing is waiting for a key' };
    try {
      parseKey(keyText);
    } catch {
      this.task(id, { stage: 'NEEDS_KEY', reason: 'BAD' });
      return { kind: 'NEEDS_KEY', id, reason: 'BAD' };
    }
    try {
      if (await this.tryKey(id, keyText)) return { kind: 'DONE', id, version: p.header.version };
    } catch (err) {
      return this.failed(id, err);
    }
    this.task(id, { stage: 'NEEDS_KEY', reason: 'WRONG' });
    return { kind: 'NEEDS_KEY', id, reason: 'WRONG' };
  }

  /** Gives up an install waiting for a key (or a failed one's message). */
  cancelInstall(id: string): void {
    this.pending.delete(id);
    this.task(id, null);
  }

  /** Install from a `.rpk` the person chose, with the key they typed. */
  async installFile(file: Blob, keyText: string): Promise<InstallOutcome> {
    const task = 'file';
    try {
      this.task(task, { stage: 'VERIFYING' });
      const bytes = new Uint8Array(await file.arrayBuffer());
      const header = await verifyRpk(bytes, this.deps.subtle);
      let key: Uint8Array;
      try {
        key = parseKey(keyText);
      } catch {
        throw new PluginError('BAD_KEY', 'an activation key is 32 bytes of base64');
      }
      const opened = await openPackage(bytes, key, this.deps.subtle);
      const p: Pending = { bytes, sha256: await sha256Hex(bytes, this.deps.subtle), header, source: 'file' };
      this.task(task, null);
      await this.keep(p, opened, keyText.trim());
      return { kind: 'DONE', id: header.id, version: header.version };
    } catch (err) {
      const e = faultOf(err);
      this.task(task, { stage: 'FAILED', fault: e.fault, detail: e.message });
      return { kind: 'FAILED', fault: e.fault, detail: e.message };
    }
  }

  async remove(id: string): Promise<void> {
    await this.closeSession(id);
    await (await this.storeReady).remove(id);
    this.opened.delete(id);
    await this.refresh();
  }

  /** A text file of an installed plugin (its licence, its notices), decrypted in memory. */
  async text(id: string, file: string): Promise<string | null> {
    const bytes = await this.file(id, file);
    return bytes ? new TextDecoder().decode(bytes) : null;
  }

  /** A file of an installed plugin (its base picture), decrypted in memory; null when it has none or does not open. */
  async file(id: string, file: string): Promise<Uint8Array | null> {
    try {
      return (await this.openStored(id)).files.get(file) ?? null;
    } catch {
      return null;
    }
  }

  /** The running plugin, started on first use and kept until it is removed, updated or stops. */
  session(id: string): Promise<PluginSession> {
    const live = this.sessions.get(id);
    if (live) return live;
    const started = this.startSession(id);
    this.sessions.set(id, started);
    started.catch(() => this.sessions.delete(id));
    return started;
  }

  private async closeSession(id: string): Promise<void> {
    const s = this.sessions.get(id);
    this.sessions.delete(id);
    if (s) (await s.catch(() => null))?.close();
  }

  private async startSession(id: string): Promise<PluginSession> {
    const opened = await this.openStored(id).catch((err) => {
      throw faultOf(err);
    });
    const m = opened.manifest;
    let wasm: ArrayBuffer | null = null;
    if (m.wasm) {
      const bytes = opened.files.get(m.wasm.file)!;
      let module: WebAssembly.Module;
      try {
        module = await WebAssembly.compile(bytes.slice().buffer);
      } catch (err) {
        throw new PluginError('START', `its WebAssembly module does not compile: ${err instanceof Error ? err.message : String(err)}`);
      }
      const imports = WebAssembly.Module.imports(module);
      if (m.wasm.noImports && imports.length > 0) throw new PluginError('IMPORTS', `its module imports ${imports.map((i) => `${i.module}.${i.name}`).join(', ')}, and its manifest says it imports nothing`);
      wasm = bytes.slice().buffer;
    }
    const files: Record<string, ArrayBuffer> = {};
    for (const name of m.files) files[name] = opened.files.get(name)!.slice().buffer;
    const url = this.deps.createObjectURL(new Blob([opened.files.get(m.entry)!.slice().buffer], { type: 'text/javascript' }));
    let worker: WorkerLike;
    try {
      worker = this.deps.spawn(url);
    } catch (err) {
      this.deps.revokeObjectURL(url);
      throw new PluginError('START', err instanceof Error ? err.message : String(err));
    }
    const session = await new Promise<PluginSession>((resolve, reject) => {
      const timer = setTimeout(() => {
        worker.terminate();
        reject(new PluginError('START', 'the plugin did not answer'));
      }, this.deps.startTimeoutMs ?? 20000);
      worker.onerror = (e) => {
        clearTimeout(timer);
        worker.terminate();
        reject(new PluginError('START', `the plugin did not start: ${String((e as { message?: string })?.message ?? e)}`));
      };
      worker.onmessage = (e) => {
        const msg = e.data as PluginMessage;
        if (msg?.type === 'ready' && msg.abi === PLUGIN_ABI) {
          clearTimeout(timer);
          resolve(new PluginSession(m, worker, () => this.sessions.delete(id)));
        } else if (msg?.type === 'error') {
          clearTimeout(timer);
          worker.terminate();
          reject(new PluginError('START', `the plugin did not start: ${msg.message}`));
        } else if (msg?.type === 'ready') {
          clearTimeout(timer);
          worker.terminate();
          reject(new PluginError('ABI', `the plugin speaks ABI ${String(msg.abi)}`));
        }
      };
      const init: HostMessage = { type: 'init', abi: 1, manifest: m, files, wasm };
      worker.postMessage(init, [...Object.values(files), ...(wasm ? [wasm] : [])]);
    }).finally(() => this.deps.revokeObjectURL(url));
    return session;
  }

  /** Stops a running plugin (Apply cancelled: its worker may be in the middle of a render); the next use starts it again. */
  async stop(id: string): Promise<void> {
    await this.closeSession(id);
  }

  /** Every running plugin stopped (the page goes). */
  dispose(): void {
    for (const id of [...this.sessions.keys()]) void this.closeSession(id);
  }
}
