// The desktop launcher (engine/crates/rt-app, ARCHITECTURE §5.5), seen from
// the page: detection, and a client for its API (info, hardware, the model
// store by blob, the installer's pending choice, folders, heartbeat, and the
// system's dialogs with the files chosen in them).
//
// The launcher opens the window at http://127.0.0.1:<port>/#token=<hex>. The
// token is taken from the fragment at once, kept in sessionStorage (a reload
// keeps working) and removed from the address bar; every /api/* call carries
// it in X-Repackshot-Token. In the web version there is no token and nothing
// here is used. The contract is engine/crates/rt-app/README.md.

export const TOKEN_KEY = 'repackshot.token';
const TOKEN_RE = /^[0-9a-f]{32}$/;

export interface LocationLike {
  hash: string;
  pathname: string;
  search: string;
}
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
export interface HistoryLike {
  replaceState(data: unknown, unused: string, url?: string): void;
}

/**
 * The launcher's token: from `#token=` (then kept in `storage` and removed from the address
 * bar), else from `storage`. Null in the web version.
 */
export function takeLaunchToken(loc: LocationLike, storage: StorageLike | null, history: HistoryLike | null): string | null {
  const m = /(?:^#|&)token=([0-9a-f]{32})(?:&|$)/.exec(loc.hash);
  if (m) {
    try {
      storage?.setItem(TOKEN_KEY, m[1]);
    } catch {
      // Storage refused: the token still works for this page.
    }
    try {
      history?.replaceState(null, '', loc.pathname + loc.search);
    } catch {
      // Not fatal: the fragment never reaches the server or a Referer anyway.
    }
    return m[1];
  }
  try {
    const saved = storage?.getItem(TOKEN_KEY) ?? null;
    return saved && TOKEN_RE.test(saved) ? saved : null;
  } catch {
    return null;
  }
}

export interface NativeInfo {
  app: 'repackshot';
  version: string;
  engineVersion: string;
  /** M2b: what the engine reads beyond the plain RSB (`rt_core::FEATURES`; bit 0, the textures); absent before. */
  features?: number;
  threads: number;
  /** The SIMD path the native engine renders with (`avx2`, `sse2`, `neon`, `scalar`). */
  isa: string;
  simd: string[];
  os: string;
  arch: string;
  dataDir: string;
  modelsDir: string;
  logsDir: string;
  resultsDir: string;
  portable: boolean;
  /** The browser drawing the window (`msedge`, `chromium`, `default`), or null. */
  browser: string | null;
  /** What draws the window and why (P3c): `{kind: webview2|browser|default|none, detail, reason}`; null with --serve-only. */
  window?: { kind: string; detail: string | null; reason: string | null } | null;
  pid: number;
  /** The dialogs and file API (files.rs), version 1; absent in a launcher without them. */
  filesApi?: number;
  /** The AI runtime API (ai/mod.rs, X3b), version 1; absent in a launcher without it. */
  aiApi?: number;
  /** The AI post-processing pipeline of rt-app/src/ai/post.rs (`/api/ai/post`, X3c): its version, when there is one. */
  aiPost?: number;
  /** X7: the launcher calls a remote API in place of the local runtime and keeps its keys (`/api/ai/apikeys`), version 1. */
  aiRemote?: number;
  /** Updating from inside the application (`/api/update/*`, rt-app/src/update/, P5): its version, when there is one. */
  updateApi?: number;
  /** This launcher was started by an update (`--after-update`): the page says so once. */
  afterUpdate?: boolean;
}

export interface NativeRecommendation {
  rowId: string | null;
  recommended: string | null;
  offered: string[];
  skipped: string[];
}

export interface NativeHardware {
  cpu: string;
  cores: number;
  threads: number;
  ramBytes: number | null;
  ramGiB: number | null;
  ramUsableBytes: number | null;
  gpus: { name: string; vendor: string; vramBytes: number | null; vramGiB: number | null }[];
  device: 'gpu' | 'cpu';
  gpuFound: boolean;
  /**
   * Whether any source of the graphics cards answered (`failed`: none could be asked, so an empty `gpus` is not
   * "no graphics card"). Absent from the launchers up to v0.1.2.
   */
  gpuDetection?: 'ok' | 'failed';
  /** What each source of the graphics cards said (DXGI, the registry, CIM, wmic; nvidia-smi, DRM). */
  gpuSources?: { source: string; ok: boolean; found: number; detail: string | null }[];
  detected: boolean;
  input: { device: 'gpu'; vramGiB: number } | { device: 'cpu'; ramGiB: number } | null;
  recommendation: NativeRecommendation | null;
}

export interface BlobStatus {
  sha256: string;
  state: 'missing' | 'partial' | 'complete';
  /** Bytes written from offset 0 without a gap: where a download resumes. */
  contiguous: number;
  written: number;
  bytes?: number;
  total?: number | null;
  ready?: boolean;
  damaged?: boolean;
  actual?: string | null;
  checking?: { done: number; total: number } | null;
}

export interface StoreFile {
  name: string;
  role: string;
  sha256: string;
  bytes: number;
  state: 'missing' | 'partial' | 'complete';
  written?: number;
  contiguous?: number;
  damaged?: boolean;
  checking?: boolean;
}

export interface StoreModel {
  key: string;
  source: 'catalogue' | 'imported';
  installed: boolean;
  state: 'missing' | 'partial' | 'complete';
  totalBytes: number;
  presentBytes: number;
  files: StoreFile[];
  manifest?: unknown;
}

export interface StoreList {
  dir: string;
  installed: string[];
  models: StoreModel[];
}

export interface PendingModels {
  device: 'gpu' | 'cpu';
  keys: string[];
  /**
   * The inference runtime the installer ticked beside the models (phase U10, `ai-runtimes.json` key). The launcher
   * starts downloading it itself at its first launch (`Ai::start_pending_runtime`); the page only knows it was there.
   */
  runtime?: string;
}

/** A path the person chose in one of the launcher's dialogs (engine/crates/rt-app/src/files.rs). */
export interface NativeGrant {
  id: string;
  /** The last part of the path. */
  name: string;
  /** The whole path, as the person reads it. */
  path: string;
  folder: boolean;
  read: boolean;
  write: boolean;
  /** Bytes of a file (null for a folder, or a file not written yet). */
  size: number | null;
}

/** A file type of a dialog: `extensions` without the dot (`png`, `repack`, `repack.json`); `*` is every file. */
export interface DialogFilter {
  name: string;
  extensions: string[];
}

export type DialogResult = { cancelled: true } | { cancelled: false; file: NativeGrant; files: NativeGrant[] };

export interface FolderDialogOptions {
  title: string;
  /** Where it starts: a grant id or a folder path (only a hint). */
  start?: string;
  /** The files under it can be listed and read (an import). */
  read?: boolean;
  /** New files can be created in it (default true). */
  write?: boolean;
  /** Windows' fallback folder dialog: the text of its file name box. */
  folderItem?: string;
}

export interface OpenDialogOptions {
  title: string;
  multiple?: boolean;
  filters?: DialogFilter[];
  start?: string;
  /** The chosen file can be written back (a project saved again). */
  writable?: boolean;
}

export interface SaveDialogOptions {
  title: string;
  defaultName: string;
  filters?: DialogFilter[];
  start?: string;
}

export type FinishResult =
  | { ok: true; bytes: number }
  | { ok: false; status: number; error: string; actual?: string; contiguous?: number };

/** An API error with its HTTP status and the launcher's error code. */
export class NativeError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

const SHA_RE = /^[0-9a-f]{64}$/;
const NAME_RE = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,127}$/;

function checkSha(sha: string): string {
  if (!SHA_RE.test(sha)) throw new Error(`not a sha256: ${sha}`);
  return sha;
}
function checkKey(key: string): string {
  if (!NAME_RE.test(key) || key.includes('..')) throw new Error(`not a model key: ${key}`);
  return key;
}

export class NativeClient {
  constructor(
    readonly token: string,
    readonly info: NativeInfo,
    private readonly fetchFn: FetchFn = (input, init) => fetch(input, init),
  ) {}

  /** A request to the launcher with the token. */
  request(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set('X-Repackshot-Token', this.token);
    return this.fetchFn(path, { ...init, headers, cache: 'no-store' });
  }

  private async json<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await this.request(path, init);
    const text = await res.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    if (!res.ok) {
      const e = (body ?? {}) as { error?: string; message?: string };
      throw new NativeError(res.status, e.error ?? 'http', e.message ?? `${res.status}`);
    }
    return body as T;
  }

  hardware(device?: 'gpu' | 'cpu', refresh = false): Promise<NativeHardware> {
    const q = new URLSearchParams();
    if (device) q.set('device', device);
    if (refresh) q.set('refresh', '1');
    const s = q.toString();
    return this.json(`/api/hardware${s ? `?${s}` : ''}`);
  }

  models(): Promise<StoreList> {
    return this.json('/api/models');
  }

  async blobStatus(sha: string): Promise<BlobStatus> {
    return this.json(`/api/models/blobs/${checkSha(sha)}/status`);
  }

  /** Writes a chunk of a blob at `offset` (chunks may come in any order). */
  async putChunk(sha: string, offset: number, chunk: BodyInit, total?: number): Promise<BlobStatus> {
    const q = new URLSearchParams({ offset: String(offset) });
    if (total !== undefined) q.set('total', String(total));
    return this.json(`/api/models/blobs/${checkSha(sha)}?${q}`, { method: 'PUT', body: chunk });
  }

  /** Checks a fully written blob against its name; a mismatch leaves it damaged (422). */
  async finishBlob(sha: string, bytes?: number): Promise<FinishResult> {
    const q = bytes !== undefined ? `?bytes=${bytes}` : '';
    const res = await this.request(`/api/models/blobs/${checkSha(sha)}/finish${q}`, { method: 'POST' });
    const body = (await res.json().catch(() => ({}))) as { bytes?: number; error?: string; actual?: string; contiguous?: number };
    if (res.ok) return { ok: true, bytes: body.bytes ?? 0 };
    return { ok: false, status: res.status, error: body.error ?? 'http', ...(body.actual ? { actual: body.actual } : {}), ...(body.contiguous !== undefined ? { contiguous: body.contiguous } : {}) };
  }

  /** A complete blob, whole or a byte range `[start, end]` (inclusive). */
  async readBlob(sha: string, range?: [number, number]): Promise<Response> {
    return this.request(`/api/models/blobs/${checkSha(sha)}`, range ? { headers: { Range: `bytes=${range[0]}-${range[1]}` } } : {});
  }

  async deleteBlob(sha: string): Promise<void> {
    await this.json(`/api/models/blobs/${checkSha(sha)}`, { method: 'DELETE' });
  }

  async importModel(key: string, manifest: unknown): Promise<void> {
    await this.json(`/api/models/imported/${checkKey(key)}`, { method: 'PUT', body: JSON.stringify(manifest) });
  }

  /** Marks a model installed (every blob of it must be complete). */
  async install(key: string): Promise<{ installed: string[] }> {
    return this.json('/api/models/installed', { method: 'POST', body: JSON.stringify({ key: checkKey(key) }) });
  }

  /** Uninstalls a model and deletes the blobs no installed model (nor one in `keep`) uses. */
  async remove(key: string, keep: string[] = []): Promise<{ deleted: string[] }> {
    const q = keep.length ? `?keep=${keep.map(checkKey).join(',')}` : '';
    return this.json(`/api/models/${checkKey(key)}${q}`, { method: 'DELETE' });
  }

  /** What the installer chose to download, or null. */
  pendingModels(): Promise<PendingModels | null> {
    return this.json('/api/pending-models');
  }

  async consumePendingModels(): Promise<void> {
    await this.json('/api/pending-models', { method: 'DELETE' });
  }

  async openFolder(target: 'data' | 'models' | 'logs' | 'results' | { path: string }): Promise<void> {
    await this.json('/api/open-folder', { method: 'POST', body: JSON.stringify(typeof target === 'string' ? { folder: target } : target) });
  }

  /** The launcher answers the dialogs and the file API (`/api/info` filesApi ≥ 1). */
  get hasFiles(): boolean {
    return (this.info.filesApi ?? 0) >= 1;
  }

  /** The system's folder dialog. Throws a NativeError (`no-dialog`, `dialog-open`) when none can be shown. */
  dialogFolder(opts: FolderDialogOptions): Promise<DialogResult> {
    return this.json('/api/dialog/folder', { method: 'POST', body: JSON.stringify(opts) });
  }

  /** The system's open dialog. */
  dialogOpen(opts: OpenDialogOptions): Promise<DialogResult> {
    return this.json('/api/dialog/open', { method: 'POST', body: JSON.stringify(opts) });
  }

  /** The system's save dialog (it asks before replacing a file). */
  dialogSave(opts: SaveDialogOptions): Promise<DialogResult> {
    return this.json('/api/dialog/save', { method: 'POST', body: JSON.stringify(opts) });
  }

  /** A new file in a chosen folder (or `downloads`): `name`, or `name (2)`… when taken; never an overwrite. */
  writeNew(dir: string, name: string, body: Blob): Promise<NativeGrant> {
    return this.json(`/api/files?${new URLSearchParams({ dir, name })}`, { method: 'PUT', body });
  }

  /** Writes a chosen file whole (a temporary file renamed over it). */
  writeFile(id: string, body: Blob): Promise<NativeGrant> {
    return this.json(`/api/files/${encodeURIComponent(id)}`, { method: 'PUT', body });
  }

  /** A chosen file's bytes, whole or a range `[start, end]` (inclusive). */
  readFile(id: string, range?: [number, number]): Promise<Response> {
    return this.request(`/api/files/${encodeURIComponent(id)}`, range ? { headers: { Range: `bytes=${range[0]}-${range[1]}` } } : {});
  }

  fileInfo(id: string): Promise<NativeGrant & { hashing: { done: number; total: number } | null }> {
    return this.json(`/api/files/${encodeURIComponent(id)}/info`);
  }

  /** The SHA-256 of a chosen file, computed by the launcher. */
  hashFile(id: string): Promise<{ sha256: string; bytes: number }> {
    return this.json(`/api/files/${encodeURIComponent(id)}/sha256`, { method: 'POST' });
  }

  /** The files under a folder chosen for reading, with their paths relative to it. */
  listFolder(id: string): Promise<{ files: { id: string; name: string; rel: string; size: number }[] }> {
    return this.json(`/api/files/${encodeURIComponent(id)}/list`);
  }

  /** Shows a chosen file (selected) or folder in the system's file manager. */
  async reveal(id: string): Promise<void> {
    await this.json(`/api/files/${encodeURIComponent(id)}/reveal`, { method: 'POST' });
  }

  /** The project file opened or saved last (the launcher remembers it), granted again; null when there is none. */
  lastProject(): Promise<NativeGrant | null> {
    return this.json('/api/projects/last');
  }

  async setLastProject(id: string): Promise<void> {
    await this.json('/api/projects/last', { method: 'PUT', body: JSON.stringify({ id }) });
  }

  /** `GET /api/update`: where an update from inside the application is (P5). The caller reads it with `parseInstallStatus`. */
  updateStatus(): Promise<unknown> {
    return this.json('/api/update');
  }

  /** `POST /api/update/install` (202): the launcher downloads, checks and installs; throws a NativeError when it refuses (400 `bad-url`, 409 `not-updatable`, `busy`). */
  updateInstall(req: { tag: string; assetUrl: string; sumsUrl: string; size?: number }): Promise<unknown> {
    return this.json('/api/update/install', { method: 'POST', body: JSON.stringify(req) });
  }

  /** `POST /api/update/cancel`: stops a download or a check, and clears a failure. */
  updateCancel(): Promise<unknown> {
    return this.json('/api/update/cancel', { method: 'POST' });
  }

  /** Opens an https:// address in the system's browser. */
  async openUrl(url: string): Promise<void> {
    await this.json('/api/open-url', { method: 'POST', body: JSON.stringify({ url }) });
  }

  /**
   * Keeps the launcher alive: it quits 20 s after the last beat (the window was closed). The
   * beats run in a small worker where there is one, whose timers are not throttled in a hidden
   * tab; else on this page's timers. Returns the function that stops them.
   */
  startHeartbeat(intervalMs = 5000): () => void {
    const url = new URL('/api/alive', globalThis.location?.href ?? 'http://127.0.0.1/').href;
    if (typeof Worker === 'function' && typeof Blob === 'function' && typeof URL.createObjectURL === 'function') {
      try {
        const src = `let t=0;onmessage=(e)=>{const d=e.data;clearInterval(t);const beat=()=>fetch(d.url,{method:'POST',headers:{'X-Repackshot-Token':d.token},cache:'no-store'}).catch(()=>{});beat();t=setInterval(beat,d.ms);};`;
        const blobUrl = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
        const w = new Worker(blobUrl);
        w.postMessage({ url, token: this.token, ms: intervalMs });
        return () => {
          w.terminate();
          URL.revokeObjectURL(blobUrl);
        };
      } catch {
        // Fall through to the page's own timers.
      }
    }
    const beat = () => void this.request('/api/alive', { method: 'POST' }).catch(() => undefined);
    beat();
    const id = setInterval(beat, intervalMs);
    return () => clearInterval(id);
  }
}

/**
 * The launcher, when the page runs in its window: the token from the URL or the session, and an
 * answer from `/api/info`. Null in the web version (no token) or when the launcher does not
 * answer. Call it early: it removes the token from the address bar synchronously.
 */
export function connectNative(
  opts: {
    location?: LocationLike;
    storage?: StorageLike | null;
    history?: HistoryLike | null;
    fetch?: FetchFn;
  } = {},
): Promise<NativeClient | null> {
  const g = globalThis as { location?: LocationLike; sessionStorage?: StorageLike; history?: HistoryLike };
  const loc = opts.location ?? g.location;
  if (!loc) return Promise.resolve(null);
  let storage: StorageLike | null = null;
  try {
    storage = opts.storage !== undefined ? opts.storage : (g.sessionStorage ?? null);
  } catch {
    storage = null;
  }
  const token = takeLaunchToken(loc, storage, opts.history !== undefined ? opts.history : (g.history ?? null));
  if (!token) return Promise.resolve(null);
  const fetchFn: FetchFn = opts.fetch ?? ((input, init) => fetch(input, init));
  return (async () => {
    try {
      const res = await fetchFn('/api/info', { headers: { 'X-Repackshot-Token': token }, cache: 'no-store' });
      if (!res.ok) return null;
      const info = (await res.json()) as NativeInfo;
      return info && info.app === 'repackshot' ? new NativeClient(token, info, fetchFn) : null;
    } catch {
      return null;
    }
  })();
}
