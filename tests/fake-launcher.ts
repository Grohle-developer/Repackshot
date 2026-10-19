// A double of the desktop launcher for the platform tests: `/api/info`, `/api/hardware`,
// `/api/pending-models`, `/api/models` and the page's store of phase P3e (`/api/store/*`,
// `/api/storage/usage`), in memory. As strict as engine/crates/rt-app/src/appdata.rs where it
// matters to the page: the token, the names (lower case, never a device name), JSON bodies,
// objects for the settings and the library, a result's file before its record. The real one is
// tested in Rust (engine/crates/rt-app/tests/appdata.rs) and with the browser
// (tools/desktop-platform-check.mjs).

import { NativeClient, type NativeInfo } from '../src/io/native';

export const FAKE_TOKEN = '00112233445566778899aabbccddeeff';

const NAME_RE = /^[a-z0-9_-](?:[a-z0-9._-]{0,94}[a-z0-9_-])?$/;
const DEVICE_RE = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/;
const validName = (n: string) => NAME_RE.test(n) && !n.includes('..') && !DEVICE_RE.test(n);
const RESULT_TYPES: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/x-exr': 'exr', 'image/webp': 'webp', 'image/tiff': 'tif' };

export interface FakeLauncher {
  client: NativeClient;
  /** Every request, `METHOD /path`. */
  calls: string[];
  settings: string | null;
  library: string | null;
  docs: Map<string, string>;
  /** `ai`: the single AI image of before X4b (`…/ai`); `variants`: X4b's, by number from 1 (`…/ai/<n>`). */
  results: Map<string, { meta: string; file?: Blob; display?: Blob; ai?: Blob; variants?: Map<number, Blob> }>;
  cache: Map<string, string>;
  /** Paths whose writes fail (500), or `METHOD /path` that fails, to test error reporting. */
  failing: Set<string>;
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const error = (status: number, code: string) => json(status, { error: code, message: code });

export function fakeLauncher(opts: { gpus?: { name: string; vendor: string; vramBytes: number | null; vramGiB: number | null }[] } = {}): FakeLauncher {
  const state: Omit<FakeLauncher, 'client'> = {
    calls: [],
    settings: null,
    library: null,
    docs: new Map(),
    results: new Map(),
    cache: new Map(),
    failing: new Set(),
  };
  const info: NativeInfo = {
    app: 'repackshot',
    version: '0.1.24',
    engineVersion: '0.3.0',
    threads: 4,
    isa: 'avx2',
    simd: ['avx2', 'sse2'],
    os: 'linux',
    arch: 'x86_64',
    dataDir: '/data',
    modelsDir: '/data/models',
    logsDir: '/data/logs',
    resultsDir: '/data/results',
    portable: false,
    browser: 'msedge',
    pid: 1,
    // The dialogs and file API of P3b, and the window report of P3c.
    filesApi: 1,
    window: { kind: 'browser', detail: 'msedge', reason: 'not-windows' },
  };
  const gpus = opts.gpus ?? [{ name: 'Test GPU', vendor: 'NVIDIA', vramBytes: 12 * 2 ** 30, vramGiB: 12 }];
  const handle = async (input: string, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(input, 'http://127.0.0.1:1');
    const method = (init.method ?? 'GET').toUpperCase();
    state.calls.push(`${method} ${url.pathname}`);
    if (new Headers(init.headers).get('X-Repackshot-Token') !== FAKE_TOKEN) return error(401, 'token');
    const parts = url.pathname.replace(/^\/api\//, '').split('/').map(decodeURIComponent);
    const text = async () => (init.body === undefined || init.body === null ? '' : typeof init.body === 'string' ? init.body : await new Response(init.body).text());
    const jsonBody = async (object: boolean): Promise<string | Response> => {
      const t = await text();
      let v: unknown;
      try {
        v = JSON.parse(t);
      } catch {
        return error(400, 'bad-json');
      }
      if (object && (v === null || typeof v !== 'object' || Array.isArray(v))) return error(400, 'bad-body');
      return t;
    };
    if ((method !== 'GET' && state.failing.has(url.pathname)) || state.failing.has(`${method} ${url.pathname}`)) return error(500, 'io');
    const key = `${method} ${parts.length === 5 && parts[3] === 'ai' ? `${parts.slice(0, 2).join('/')}/*/ai/*` : parts.length > 3 ? `${parts.slice(0, 2).join('/')}/*/${parts.slice(3).join('/')}` : parts.length === 3 ? `${parts.slice(0, 2).join('/')}/*` : parts.join('/')}`;
    const name = parts[2] ?? '';
    if (parts.length >= 3 && parts[0] === 'store' && !validName(name)) return error(400, 'bad-name');
    switch (key) {
      case 'GET info':
        return json(200, info);
      case 'GET hardware':
        return json(200, { cpu: 'Test CPU', cores: 4, threads: 8, ramBytes: 16 * 2 ** 30, ramGiB: 16, ramUsableBytes: null, gpus, device: 'gpu', gpuFound: gpus.length > 0, gpuDetection: 'ok', gpuSources: [{ source: 'dxgi', ok: true, found: gpus.length, detail: null }], detected: true, input: null, recommendation: null });
      case 'GET pending-models':
        return json(200, null);
      case 'POST dialog/folder': {
        // The person picks this folder in the system's dialog.
        const file = { id: 'd-renders', name: 'Renders', path: '/home/a/Renders', folder: true, read: false, write: true, size: null };
        return json(200, { cancelled: false, file, files: [file] });
      }
      case 'GET models':
        return json(200, { dir: '/data/models', installed: [], models: [] });
      case 'GET store/settings':
        return new Response(state.settings ?? 'null', { status: 200 });
      case 'PUT store/settings': {
        const b = await jsonBody(true);
        if (b instanceof Response) return b;
        state.settings = b;
        return new Response(null, { status: 204 });
      }
      case 'DELETE store/settings':
        state.settings = null;
        return new Response(null, { status: 204 });
      case 'GET store/docs':
        return json(200, Object.fromEntries([...state.docs].map(([k, v]) => [k, JSON.parse(v)])));
      case 'GET store/docs/*':
        return new Response(state.docs.get(name) ?? 'null', { status: 200 });
      case 'PUT store/docs/*': {
        const b = await jsonBody(false);
        if (b instanceof Response) return b;
        state.docs.set(name, b);
        return new Response(null, { status: 204 });
      }
      case 'DELETE store/docs/*':
        state.docs.delete(name);
        return new Response(null, { status: 204 });
      case 'GET store/library':
        return new Response(state.library ?? 'null', { status: 200 });
      case 'PUT store/library': {
        const b = await jsonBody(true);
        if (b instanceof Response) return b;
        state.library = b;
        return new Response(null, { status: 204 });
      }
      case 'DELETE store/library':
        state.library = null;
        return new Response(null, { status: 204 });
      case 'GET store/results':
        return json(200, { results: [...state.results.values()].filter((r) => r.file && r.meta).map((r) => JSON.parse(r.meta)) });
      case 'DELETE store/results':
        state.results.clear();
        return json(200, { deleted: 0 });
      case 'PUT store/results/*': {
        const type = url.searchParams.get('type') ?? '';
        if (!RESULT_TYPES[type]) return error(415, 'bad-type');
        const file = new Blob([await new Response(init.body ?? null).arrayBuffer()], { type });
        state.results.set(name, { ...(state.results.get(name) ?? { meta: '' }), file });
        return new Response(null, { status: 204 });
      }
      case 'PUT store/results/*/display': {
        const display = new Blob([await new Response(init.body ?? null).arrayBuffer()], { type: 'image/png' });
        const r = state.results.get(name);
        state.results.set(name, { ...(r ?? { meta: '' }), display });
        return new Response(null, { status: 204 });
      }
      case 'PUT store/results/*/ai': {
        const type = url.searchParams.get('type') ?? '';
        if (!RESULT_TYPES[type]) return error(415, 'bad-type');
        const ai = new Blob([await new Response(init.body ?? null).arrayBuffer()], { type });
        state.results.set(name, { ...(state.results.get(name) ?? { meta: '' }), ai });
        return new Response(null, { status: 204 });
      }
      case 'PUT store/results/*/ai/*': {
        // As the launcher: a variant is a number from 1 to 8, written plainly.
        const n = parts[4];
        if (!/^[1-8]$/.test(n)) return error(400, 'bad-variant');
        const type = url.searchParams.get('type') ?? '';
        if (!RESULT_TYPES[type]) return error(415, 'bad-type');
        const blob = new Blob([await new Response(init.body ?? null).arrayBuffer()], { type });
        const r = state.results.get(name) ?? { meta: '' };
        state.results.set(name, { ...r, variants: new Map([...(r.variants ?? []), [Number(n), blob]]) });
        return new Response(null, { status: 204 });
      }
      case 'GET store/results/*/ai/*': {
        const n = parts[4];
        if (!/^[1-8]$/.test(n)) return error(400, 'bad-variant');
        const r = state.results.get(name);
        // Variant 1 of a result of before X4b is its single AI image.
        const blob = r?.variants?.get(Number(n)) ?? (n === '1' ? r?.ai : undefined);
        if (!r?.meta || !blob) return error(404, 'not-found');
        return new Response(blob, { status: 200, headers: { 'Content-Type': blob.type } });
      }
      case 'PUT store/results/*/meta': {
        const r = state.results.get(name);
        if (!r?.file) return error(409, 'no-file');
        const b = await jsonBody(true);
        if (b instanceof Response) return b;
        if ((JSON.parse(b) as { id?: string }).id !== name) return error(400, 'id-mismatch');
        r.meta = b;
        return new Response(null, { status: 204 });
      }
      case 'GET store/results/*':
      case 'GET store/results/*/ai':
      case 'GET store/results/*/display': {
        const r = state.results.get(name);
        const blob = key.endsWith('display') ? r?.display : key.endsWith('/ai') ? (r?.variants?.get(1) ?? r?.ai) : r?.file;
        if (!r?.meta || !blob) return error(404, 'not-found');
        return new Response(blob, { status: 200, headers: { 'Content-Type': blob.type } });
      }
      case 'DELETE store/results/*':
        state.results.delete(name);
        return new Response(null, { status: 204 });
      case 'GET store/cache/*': {
        const v = state.cache.get(name);
        return v === undefined ? new Response(null, { status: 204 }) : new Response(v, { status: 200 });
      }
      case 'PUT store/cache/*':
        state.cache.set(name, await text());
        return new Response(null, { status: 204 });
      case 'DELETE store/cache': {
        const freed = [...state.cache.values()].reduce((a, v) => a + v.length, 0);
        state.cache.clear();
        return json(200, { freed });
      }
      case 'GET storage/usage': {
        const lib = state.library?.length ?? 0;
        const res = [...state.results.values()].reduce((a, r) => a + (r.file?.size ?? 0) + (r.display?.size ?? 0) + (r.ai?.size ?? 0) + [...(r.variants?.values() ?? [])].reduce((n, b) => n + b.size, 0), 0);
        const thumbs = [...state.cache.values()].reduce((a, v) => a + v.length, 0);
        const folders = [
          { id: 'models', path: '/data/models', bytes: 0, files: 0 },
          { id: 'results', path: '/data/results', bytes: res, files: state.results.size },
          { id: 'library', path: '/data/library', bytes: lib, files: lib ? 1 : 0 },
          { id: 'thumbs', path: '/data/cache/thumbs', bytes: thumbs, files: state.cache.size },
          { id: 'logs', path: '/data/logs', bytes: 10, files: 1 },
          { id: 'window', path: '/data/browser-profile', bytes: 100, files: 3 },
          { id: 'other', path: null, bytes: state.settings?.length ?? 0, files: 1 },
        ];
        return json(200, { dataDir: '/data', total: folders.reduce((a, f) => a + f.bytes, 0), files: 0, folders });
      }
      default:
        return error(404, 'not-found');
    }
  };
  const client = new NativeClient(FAKE_TOKEN, info, (input, init) => handle(input, init));
  return Object.assign(state, { client });
}
