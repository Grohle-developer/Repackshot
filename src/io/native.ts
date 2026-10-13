// The desktop launcher (engine/crates/rt-app, ARCHITECTURE §5.5), seen from
// the page: detection, and a client for its API (info, hardware, the model
// store by blob, the installer's pending choice, folders, heartbeat).
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
  pid: number;
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
