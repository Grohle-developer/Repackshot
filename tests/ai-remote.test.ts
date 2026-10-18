// The AI model through an API (phase X7, AI-POST.md §8) on the page: the shared rules against the cases the launcher is
// checked against too (tests/fixtures/ai-remote-cases.json), the `fetch` backend against a **local fake HTTP server**
// (never the network) for the generic endpoint and each preset — success, a refused key, a time-out, a malformed
// answer, an oversize one, a rate limit, a redirect —, the web pipeline with the real guard (post.wasm) rejecting a
// result, the consent gate, the switch between local and API (the local service untouched), and the key kept out of
// projects, the library, the settings, the desktop's post and the console.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CASES from './fixtures/ai-remote-cases.json';
import type { AiPostRequest, AiPostResult, AiPostService, AiRuntimeStatus } from '../src/core/ai';
import type { AiModelPass } from '../src/core/ai-backend';
import { apiConnection, apiStatus, remoteRequest } from '../src/core/ai-api-settings';
import * as r from '../src/core/ai-remote';
import { defaultSettings, migrateDoc, withSetting, type Settings } from '../src/core/settings';
import { API_PRESETS, apiPreset } from '../src/data/ai-api-presets';
import { ApiBackend } from '../src/io/ai-api';
import { BrowserKeyStore, BROWSER_KEYS_ENTRY, type KeyValueStorage } from '../src/io/api-keys';
import { DesktopAiService } from '../src/io/ai-post';
import { decodePngRgb, encodePngRgb } from '../src/io/png-rgb';
import { base64ToBytes, bytesToBase64 } from '../src/io/base64';
import { ApiPipeline, apiService, routeAiService } from '../src/ai/api-service';
import { PostGuard } from '../src/ai/post-wasm';
import { apiErrorText, withApiConsent, withApiWords } from '../src/ui/ai-api';
import { serializeProject } from '../src/io/project';
import { exportLibrary } from '../src/io/library';
import { emptyLibrary } from '../src/core/library';
import { createInitialState } from '../src/core/store';
import * as fx from './ai-fixture';

/** Not a real key: what is stored and then looked for where it must never be. */
const KEY = 'test-key-0000-not-a-secret-7f3a';

// ------------------------------------------------------------------ the fake service

interface Seen {
  method: string;
  url: string;
  headers: IncomingMessage['headers'];
  body: Uint8Array;
}
type Handler = (req: Seen, res: ServerResponse) => void | Promise<void>;

const servers: { close(): void }[] = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.close();
});

async function fake(handler: Handler): Promise<{ url: (p?: string) => string; host: string; seen: Seen[] }> {
  const seen: Seen[] = [];
  const server = createServer((req, res) => {
    const chunks: Uint8Array[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const s = { method: req.method ?? '', url: req.url ?? '', headers: req.headers, body: concat(chunks) };
      seen.push(s);
      void handler(s, res);
    });
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const port = (server.address() as { port: number }).port;
  servers.push({ close: () => server.close() });
  return { url: (p = '/v1/img') => `http://127.0.0.1:${port}${p}`, host: `127.0.0.1:${port}`, seen };
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** Where `needle` first is in `hay`, or -1. */
function find(hay: Uint8Array, needle: readonly number[]): number {
  outer: for (let i = 0; i + needle.length <= hay.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

const utf8 = (b: Uint8Array) => new TextDecoder().decode(b);
const latin1 = (b: Uint8Array) => new TextDecoder('latin1').decode(b);
const bytes = (text: string) => [...text].map((c) => c.charCodeAt(0));

/** The PNG a request carries: a form's file part, or a JSON body's image (data URI or base64). */
function pngOf(body: Uint8Array): Uint8Array {
  const start = find(body, [0x89, 0x50, 0x4e, 0x47]);
  if (start >= 0) return body.slice(start, find(body, bytes('IEND')) + 8);
  const v = JSON.parse(utf8(body)) as { image?: string; input?: { image: string } };
  const s = v.image ?? v.input!.image;
  return base64ToBytes(s.includes('base64,') ? s.slice(s.indexOf('base64,') + 7) : s);
}

/** A JSON value with `b64` at a dotted path. */
function at(path: string, b64: string): unknown {
  return path
    .split('.')
    .reverse()
    .reduce<unknown>((v, k) => (/^\d+$/.test(k) ? [v] : { [k]: v }), b64);
}

const echo =
  (path: string): Handler =>
  (req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(at(path, bytesToBase64(pngOf(req.body)))));
  };

const invert =
  (path: string): Handler =>
  async (req, res) => {
    const img = await decodePngRgb(pngOf(req.body), 1 << 24);
    const png = await encodePngRgb(img.width, img.height, img.rgb.map((v) => 255 - v));
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(at(path, bytesToBase64(png))));
  };

const status =
  (code: number, body: string, headers: Record<string, string> = {}): Handler =>
  (_req, res) =>
    void res.writeHead(code, { 'Content-Type': 'application/json', ...headers }).end(body);

/** One model pass of a tile of `w × h`, a gradient. */
function pass(w = 96, h = 64): AiModelPass {
  const input = new Uint8Array(w * h * 3);
  for (let i = 0; i < input.length; i++) input[i] = (i * 7) % 251;
  return { tile: 1, tiles: 1, attempt: 0, strength: 0.24000000953674316, seed: 7, width: w, height: h, input, edges: new Uint8Array(w * h), depth: new Uint8Array(w * h).fill(200), prompt: 'a studio photograph', negative: 'changed shape' };
}

const generic = (url: string): r.ApiEndpoint => ({ ...apiPreset('GENERIC').endpoint, url });
const OPTIONS: r.ApiOptions = { sendPasses: false, timeoutSeconds: 30, attempts: 2 };
const noSleep = { sleep: async (_ms: number): Promise<void> => undefined };
const backend = (e: r.ApiEndpoint, o: Partial<r.ApiOptions> = {}, key: string | null = KEY, sleep: (ms: number) => Promise<void> = noSleep.sleep) => new ApiBackend(e, { ...OPTIONS, ...o }, key, { fetch: (u, i) => fetch(u, i), sleep });

async function failure(p: Promise<unknown>): Promise<r.ApiCallError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof r.ApiCallError) return e;
    throw e;
  }
  throw new Error('it did not fail');
}

// ------------------------------------------------------------------ the shared rules

describe('the rules both platforms follow (tests/fixtures/ai-remote-cases.json)', () => {
  it('give the same answers as the launcher', () => {
    for (const c of CASES.hosts) {
      expect(r.hostOf(c.url), c.url).toBe(c.host);
      if (c.host) expect(r.isLoopback(c.host)).toBe(c.loopback);
    }
    for (const f of CASES.fill) {
      const got = f.body === 'JSON' ? r.fillJson(f.template, f.values) : r.fillMultipart(f.template, f.values);
      expect(got).toEqual(f.expect);
    }
    for (const p of CASES.paths) expect(r.atPath(p.doc, p.path) ?? null).toEqual(p.expect);
    for (const b of CASES.base64) expect(r.base64Of(b.value)).toBe(b.expect);
    for (const s of CASES.status) {
      expect(r.statusError(s.status)).toBe(s.code);
      expect(s.code ? r.retryable(s.code as r.ApiErrorCode) : false).toBe(s.retryable);
    }
    for (const w of CASES.waits) expect(r.retryWait(w.next, w.retryAfter)).toBe(w.expect);
    for (const f of CASES.fits) expect(r.fitTile(f.tile[0], f.tile[1], { maxSide: f.maxSide, multipleOf: f.multipleOf, sizes: f.sizes as [number, number][] })).toEqual(f.expect);
    for (const k of CASES.keys) {
      expect(r.maskKey(k.key)).toBe(k.mask);
      expect(r.validKey(k.key)).toBe(k.valid);
    }
    for (const p of CASES.problems) expect(r.endpointProblems(p.endpoint as unknown as r.ApiEndpoint, p.options).map((x) => x.code)).toEqual(p.expect);
    for (const w of CASES.words) expect(r.serviceWords(w.body, w.key)).toBe(w.expect);
  });

  it('every preset is a complete endpoint, written from public documentation and marked untested', () => {
    expect(API_PRESETS.map((p) => p.key)).toEqual([...r.API_PROVIDERS]);
    for (const p of API_PRESETS.filter((x) => x.key !== 'GENERIC')) {
      expect(r.endpointProblems(p.endpoint, r.DEFAULT_API_OPTIONS), p.key).toEqual([]);
      expect(p.verified, p.key).toBe(false);
      expect(p.docs).toMatch(/^https:\/\//);
      expect(r.schemeOf(p.endpoint.url)).toBe('https');
    }
    // The generic endpoint starts empty: nothing is sent anywhere until the person writes a URL.
    expect(r.endpointProblems(apiPreset('GENERIC').endpoint, r.DEFAULT_API_OPTIONS).map((x) => x.code)).toEqual(['url']);
  });
});

// ------------------------------------------------------------------ the fetch backend

describe('the API backend against a local fake service', () => {
  it('generic JSON: the key in its header only, the numbers as numbers, the answer back at the tile size', async () => {
    const svc = await fake(echo('image'));
    const b = backend(generic(svc.url()));
    const out = await b.run(pass(), new AbortController().signal);
    expect([out.width, out.height]).toEqual([96, 64]);
    expect(out.rgb).toEqual(pass().input);
    expect(svc.seen).toHaveLength(1);
    const req = svc.seen[0];
    expect(req.method).toBe('POST');
    expect(req.headers.authorization).toBe(`Bearer ${KEY}`);
    expect(req.headers['content-type']).toBe('application/json');
    expect(utf8(req.body)).not.toContain(KEY);
    const body = JSON.parse(utf8(req.body)) as Record<string, unknown>;
    expect(body).toMatchObject({ prompt: 'a studio photograph', negative_prompt: 'changed shape', strength: 0.24, seed: 7, width: 96, height: 64 });
    expect(String(body.image)).toMatch(/^data:image\/png;base64,/);
    expect(b.runtime).toBe(`api:${svc.host}`);
  });

  it('Stability preset: a multipart form with mode, image, strength, seed and the negative prompt', async () => {
    const svc = await fake(echo('image'));
    const e = { ...apiPreset('STABILITY_SD3').endpoint, url: svc.url('/v2beta/stable-image/generate/sd3') };
    await backend(e).run(pass(), new AbortController().signal);
    const req = svc.seen[0];
    const boundary = /boundary=(.+)$/.exec(String(req.headers['content-type']))![1];
    const text = latin1(req.body);
    for (const [k, v] of [
      ['mode', 'image-to-image'],
      ['prompt', 'a studio photograph'],
      ['negative_prompt', 'changed shape'],
      ['strength', '0.24'],
      ['seed', '7'],
      ['model', 'sd3.5-large'],
      ['output_format', 'png'],
    ])
      expect(text, k).toContain(`name="${k}"\r\n\r\n${v}\r\n`);
    expect(text).toContain('name="image"; filename="image.png"\r\nContent-Type: image/png');
    expect(text.trimEnd().endsWith(`--${boundary}--`)).toBe(true);
    expect(req.headers.accept).toBe('application/json');
    // 96 × 64 is not a multiple of 64 on its short side: sent at 64 × 64 (and its answer scaled back).
    const sent = await decodePngRgb(pngOf(req.body), 1 << 24);
    expect([sent.width, sent.height]).toEqual([64, 64]);
  });

  it('OpenAI preset: the fixed size nearest the tile, the negative in the prompt, the answer at data.0.b64_json', async () => {
    const svc = await fake(echo('data.0.b64_json'));
    const e = { ...apiPreset('OPENAI_EDIT').endpoint, url: svc.url('/v1/images/edits') };
    const out = await backend(e).run(pass(), new AbortController().signal);
    expect([out.width, out.height]).toEqual([96, 64]);
    const text = latin1(svc.seen[0].body);
    expect(text).toContain('name="size"\r\n\r\n1536x1024\r\n');
    expect(text).toContain('name="prompt"\r\n\r\na studio photograph Avoid: changed shape\r\n');
    expect(text).toContain('name="model"\r\n\r\ngpt-image-1\r\n');
    expect(text).not.toContain('name="strength"');
    const sent = await decodePngRgb(pngOf(svc.seen[0].body), 1 << 24);
    expect([sent.width, sent.height]).toEqual([1536, 1024]);
  });

  it('a refused key fails at once, with the status and the service words, and never the key', async () => {
    const svc = await fake(status(401, JSON.stringify({ message: `invalid key ${KEY}` })));
    const err = await failure(backend(generic(svc.url()), { attempts: 5 }).run(pass(), new AbortController().signal));
    expect([err.code, err.attempts, err.status]).toEqual(['api-auth', 1, 401]);
    expect(err.detail).toBe('invalid key ••••7f3a');
    expect(`${err.message} ${err.detail} ${apiErrorText(err)}`).not.toContain(KEY);
    expect(svc.seen).toHaveLength(1);
  });

  it('a rate limit or a server failure tries again, waiting what it is told, and never past the tries', async () => {
    const svc = await fake(status(429, '{"message":"slow down"}', { 'Retry-After': '3' }));
    const waits: number[] = [];
    const sleep = async (ms: number): Promise<void> => void waits.push(ms);
    const err = await failure(backend(generic(svc.url()), { attempts: 3 }, KEY, sleep).run(pass(), new AbortController().signal));
    expect([err.code, err.attempts]).toEqual(['api-rate-limit', 3]);
    expect(svc.seen).toHaveLength(3);
    expect(waits).toEqual([3000, 3000]);
    expect(apiErrorText(err)).toBe('The service is limiting requests (HTTP 429). Gave up after 3 tries. The service said: “slow down”');
    // A Retry-After longer than MAX_RETRY_WAIT is not waited for.
    const slow = await fake(status(429, '{}', { 'Retry-After': '3600' }));
    const one = await failure(backend(generic(slow.url()), { attempts: 5 }, KEY, sleep).run(pass(), new AbortController().signal));
    expect([one.code, one.attempts, slow.seen.length]).toEqual(['api-rate-limit', 1, 1]);
    // A 503, then an answer.
    let n = 0;
    const flaky = await fake((req, res) => (n++ === 0 ? status(503, 'busy')(req, res) : echo('image')(req, res)));
    const out = await backend(generic(flaky.url()), {}, KEY, sleep).run(pass(), new AbortController().signal);
    expect(out.width).toBe(96);
    expect(flaky.seen).toHaveLength(2);
  });

  it('a service that does not answer times out, and a stop is a stop', async () => {
    const svc = await fake(() => undefined);
    const t0 = Date.now();
    const err = await failure(backend(generic(svc.url()), { timeoutSeconds: 1, attempts: 1 }).run(pass(), new AbortController().signal));
    expect(err.code).toBe('api-timeout');
    expect(Date.now() - t0).toBeLessThan(5000);
    const stop = new AbortController();
    const run = backend(generic(svc.url())).run(pass(), stop.signal);
    setTimeout(() => stop.abort(), 50);
    await expect(run).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('answers that are not a PNG, or far too large, are refused without retrying', async () => {
    const huge = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0x23, 0x28, 0, 0, 0x23, 0x28, 8, 2, 0, 0, 0]);
    const cases: [Handler, r.ApiResponseKind, r.ApiErrorCode, string][] = [
      [(_q, s) => void s.writeHead(200, { 'Content-Type': 'text/plain' }).end('hello'), 'JSON', 'api-format', 'json'],
      [status(200, '{"other":1}'), 'JSON', 'api-format', 'path'],
      [status(200, '{"image":"%%%"}'), 'JSON', 'api-format', 'path'],
      [(_q, s) => void s.writeHead(200, { 'Content-Type': 'image/jpeg' }).end(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0])), 'IMAGE', 'api-format', 'JPEG'],
      [(_q, s) => void s.writeHead(200, { 'Content-Type': 'image/png' }).end(huge), 'IMAGE', 'api-oversize', '9000x9000'],
      [(_q, s) => void s.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': String(80 << 20) }).write(new Uint8Array(16)), 'IMAGE', 'api-oversize', ''],
    ];
    for (const [h, response, code, detail] of cases) {
      const svc = await fake(h);
      const err = await failure(backend({ ...generic(svc.url()), response }, { attempts: 3 }).run(pass(), new AbortController().signal));
      expect([err.code, err.attempts], code).toEqual([code, 1]);
      if (detail) expect(err.detail).toBe(detail);
      expect(svc.seen).toHaveLength(1);
    }
  });

  it('a redirect is never followed: nothing reaches the other address', async () => {
    const other = await fake(echo('image'));
    const svc = await fake((_q, s) => void s.writeHead(302, { Location: other.url() }).end());
    const err = await failure(backend(generic(svc.url())).run(pass(), new AbortController().signal));
    expect(err.code).toBe('api-redirect');
    expect(other.seen).toHaveLength(0);
  });

  it('the passes go only when sending them is on', async () => {
    const svc = await fake(echo('image'));
    const e = { ...generic(svc.url()), template: '{"image":"{{image_data_uri}}","depth":"{{depth_data_uri}}"}' };
    expect(r.endpointProblems(e, OPTIONS).map((p) => p.code)).toEqual(['passes']);
    await backend(e, { sendPasses: true }).run(pass(), new AbortController().signal);
    const depth = await decodePngRgb(base64ToBytes(String((JSON.parse(utf8(svc.seen[0].body)) as { depth: string }).depth).slice(22)), 1 << 24);
    expect(depth.rgb[0]).toBe(200);
  });
});

// ------------------------------------------------------------------ the web pipeline with the real guard

const WASM = ['public/engine/post.wasm', 'engine/target/wasm32-unknown-unknown/release/rt_post_wasm.wasm'].find((p) => existsSync(p)) ?? null;
if (!WASM && process.env.REPACK_REQUIRE_POST_WASM) throw new Error('post.wasm is required: npm run engine:build');

describe.skipIf(!WASM)('the web pipeline: the guard of post.wasm on every API result', () => {
  const guard = () => PostGuard.fromBytes(readFileSync(WASM!));
  const request = (url: string, intervention = 100, tolerances?: AiPostRequest['tolerances']) => {
    const world = fx.scene();
    const remote = { endpoint: generic(url), options: OPTIONS, consentedHost: r.hostOf(url)!, provider: 'GENERIC' as const };
    return { world, req: { source: { kind: 'INLINE' as const, image: world.image, passes: world.passes }, settings: { ...fx.FULL, intervention }, prompt: 'p', negative: 'n', modelKey: 'API_GENERIC', materials: [...fx.MATERIALS], ...(tolerances ? { tolerances } : {}), remote } };
  };

  it('an image the service returns unchanged passes, with the same report as a local model', async () => {
    const svc = await fake(echo('image'));
    const pipeline = new ApiPipeline({ guard, backend: async (rm) => backend(rm.endpoint) });
    const { req } = request(svc.url());
    const result = await pipeline.post(req, () => undefined, new AbortController().signal);
    expect(result.report.verdict).toBe('ACCEPTED');
    expect(result.report.runtime).toBe(`api:${svc.host}`);
    expect(result.report.modelKey).toBe('API_GENERIC');
    expect(svc.seen).toHaveLength(2);
  }, 180_000);

  it('a result the guard rejects delivers the engine image unchanged, after the attempts and no more', async () => {
    const svc = await fake(invert('image'));
    const pipeline = new ApiPipeline({ guard, backend: async (rm) => backend(rm.endpoint) });
    // Strict tolerances (Settings ▸ Advanced): no attempt of an inverted image passes.
    const { req, world } = request(svc.url(), 100, { deltaEMean: 0.5, deltaEP95: 0.5, edgesPx: 0 });
    const result: AiPostResult = await pipeline.post(req, () => undefined, new AbortController().signal);
    expect(result.report.verdict).toBe('REJECTED');
    expect(result.image.rgba).toEqual(world.image.rgba);
    // Two tiles, four attempts.
    expect(svc.seen).toHaveLength(8);
  }, 180_000);

  it('intervention 0 never calls the service', async () => {
    const svc = await fake(echo('image'));
    const pipeline = new ApiPipeline({ guard, backend: async (rm) => backend(rm.endpoint) });
    const { req, world } = request(svc.url(), 0);
    const result = await pipeline.post(req, () => undefined, new AbortController().signal);
    expect(svc.seen).toHaveLength(0);
    expect(result.image.rgba).toEqual(world.image.rgba);
  }, 180_000);
});

// ------------------------------------------------------------------ consent, the switch, the status

const apiSettings = (url: string, extra: Partial<Settings> = {}): Settings => {
  let s = withSetting(defaultSettings(), 'ai.source', 'API');
  s = withSetting(s, 'ai.apiEndpoint', generic(url));
  for (const [k, v] of Object.entries(extra)) s = withSetting(s, k as keyof Settings, v as never);
  return s;
};

const request0: AiPostRequest = { source: { kind: 'RENDER', renderId: '3' }, settings: { ...fx.FULL }, prompt: 'p', negative: 'n', modelKey: 'ZIMAGE_Q4' };

function recorder(): AiPostService & { got: AiPostRequest[] } {
  const got: AiPostRequest[] = [];
  return {
    got,
    status: async (): Promise<AiRuntimeStatus> => ({ available: true, backend: 'CPU', device: 'cpu', supports: [], activeModel: 'ZIMAGE_Q4' }),
    post: async (q) => {
      got.push(q);
      return { image: { width: 1, height: 1, rgba: new Float32Array(4) }, report: {} as AiPostResult['report'] };
    },
  };
}

describe('consent before the first send to a host', () => {
  it('nothing is sent to a host the person has not allowed; allowed, it goes; revoked, it stops', async () => {
    const svc = recorder();
    let s = apiSettings('https://api.example.com/v1');
    const gated = withApiConsent(svc, () => s);
    const err = await failure(gated.post(request0, () => undefined, new AbortController().signal));
    expect(err.code).toBe('api-consent');
    expect(svc.got).toHaveLength(0);
    s = withSetting(s, 'ai.apiConsent', ['api.example.com']);
    await gated.post(request0, () => undefined, new AbortController().signal);
    expect(svc.got).toHaveLength(1);
    // Another host is another question.
    s = withSetting(s, 'ai.apiEndpoint', generic('https://other.example.com/v1'));
    expect((await failure(gated.post(request0, () => undefined, new AbortController().signal))).code).toBe('api-consent');
    s = withSetting(withSetting(s, 'ai.apiEndpoint', generic('https://api.example.com/v1')), 'ai.apiConsent', []);
    expect((await failure(gated.post(request0, () => undefined, new AbortController().signal))).code).toBe('api-consent');
    expect(svc.got).toHaveLength(1);
    // With the model on this computer, no question at all.
    const local = withApiConsent(svc, () => defaultSettings());
    await local.post(request0, () => undefined, new AbortController().signal);
    expect(svc.got).toHaveLength(2);
  });

  it('is remembered per host in the settings, which keep only hosts', () => {
    const doc = migrateDoc({ schema: 2, settings: { 'ai.apiConsent': ['api.example.com', 'API.example.com', 'https://x.y/', 'a.b:8443', 'api.example.com'] } });
    expect(doc.settings['ai.apiConsent']).toEqual(['api.example.com', 'a.b:8443']);
  });
});

describe('local or API, chosen per installation', () => {
  it('with the model on this computer the local service gets the very request, and the API is never asked', async () => {
    const local = recorder();
    const api = { status: vi.fn(), post: vi.fn() };
    const routed = routeAiService(local, api as unknown as AiPostService, () => false);
    await routed.post(request0, () => undefined, new AbortController().signal);
    expect(local.got[0]).toBe(request0);
    expect(await routed.status()).toMatchObject({ backend: 'CPU' });
    expect(api.post).not.toHaveBeenCalled();
    expect(api.status).not.toHaveBeenCalled();
  });

  it('through an API: the status says what is missing, and the post carries the endpoint but never the key', async () => {
    const run = vi.fn(async (q: AiPostRequest) => ({ image: { width: 1, height: 1, rgba: new Float32Array(4) }, report: { modelKey: (q as r.AiRemotePostRequest).remote!.provider } as AiPostResult['report'] }));
    let s = withSetting(defaultSettings(), 'ai.source', 'API');
    const keys = new Set<string>();
    const svc = apiService({ settings: () => s, hasKey: async (h) => keys.has(h), run });
    expect(await svc.status()).toMatchObject({ available: false, reason: 'API_NOT_SET', backend: 'API' });
    s = withSetting(s, 'ai.apiEndpoint', generic('https://api.example.com/v1'));
    expect(await svc.status()).toMatchObject({ available: false, reason: 'NO_API_KEY', device: 'api.example.com', activeModel: 'API_GENERIC' });
    expect((await failure(svc.post(request0, () => undefined, new AbortController().signal))).code).toBe('api-no-key');
    keys.add('api.example.com');
    expect(await svc.status()).toMatchObject({ available: true, backend: 'API' });
    await svc.post(request0, () => undefined, new AbortController().signal);
    const sent = run.mock.calls[0][0] as r.AiRemotePostRequest;
    expect(sent.remote).toEqual(remoteRequest(apiConnection(s)));
    expect(JSON.stringify(sent)).not.toContain(KEY);
    // A preset needs no endpoint of the person's.
    s = withSetting(s, 'ai.apiProvider', 'STABILITY_SD3');
    expect(apiStatus(apiConnection(s), true)).toMatchObject({ available: true, device: 'api.stability.ai', activeModel: 'API_STABILITY_SD3' });
  });

  it('the desktop post carries the endpoint as the launcher reads it, and nothing else; without it, the same post as before', async () => {
    const bodies: string[] = [];
    const native = {
      request: async (path: string, init?: RequestInit) => {
        if (path === '/api/ai/post') {
          bodies.push(String(init?.body));
          return new Response(JSON.stringify({ error: 'api-no-key', message: 'no key' }), { status: 409 });
        }
        return new Response('{}', { status: 404 });
      },
    };
    const desktop = new DesktopAiService(native, () => ({ cpu: false, force: null, model: 'ZIMAGE_Q4' }));
    const local = await failure(desktop.post(request0, () => undefined, new AbortController().signal));
    expect(local).toBeInstanceOf(r.ApiCallError);
    const before = JSON.parse(bodies[0]) as Record<string, unknown>;
    expect(Object.keys(before)).toEqual(['source', 'settings', 'prompt', 'negative', 'modelKey']);
    const s = withSetting(apiSettings('https://api.example.com/v1'), 'ai.apiConsent', ['api.example.com']);
    const remote = remoteRequest(apiConnection(s))!;
    await failure(desktop.post({ ...request0, remote } as r.AiRemotePostRequest, () => undefined, new AbortController().signal));
    const after = JSON.parse(bodies[1]) as { remote: Record<string, unknown> };
    expect(Object.keys(after)).toEqual(['source', 'settings', 'prompt', 'negative', 'modelKey', 'remote']);
    expect(Object.keys(after.remote)).toEqual(['endpoint', 'options', 'consentedHost', 'provider']);
    expect(after.remote.consentedHost).toBe('api.example.com');
    expect(bodies[1]).not.toContain(KEY);
  });

  it('a failure reads in the interface language, with the tries', async () => {
    const svc: AiPostService = { status: async () => ({ available: true, backend: 'API', device: 'x', supports: [], activeModel: 'API_GENERIC' }), post: async () => Promise.reject(new r.ApiCallError('api-timeout', 'no answer within 30 s', 2)) };
    const err = await failure(withApiWords(svc).post(request0, () => undefined, new AbortController().signal));
    expect(err.message).toBe('The service did not answer in time. Gave up after 2 tries.');
  });
});

// ------------------------------------------------------------------ the key stays on this computer

function memoryStorage(): KeyValueStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
}

describe('the API key', () => {
  it('lives only in its own entry of this browser, masked when listed, one per host', async () => {
    const storage = memoryStorage();
    const keys = new BrowserKeyStore(storage);
    await keys.save('api.example.com', KEY);
    expect(await keys.list()).toEqual([{ host: 'api.example.com', masked: '••••7f3a' }]);
    expect(keys.key('api.example.com')).toBe(KEY);
    expect(keys.key('other.example.com')).toBeNull();
    expect([...storage.data.keys()]).toEqual([BROWSER_KEYS_ENTRY]);
    await expect(keys.save('a.b', ' spaced')).rejects.toThrow();
    await keys.forget('api.example.com');
    expect(storage.data.size).toBe(0);
  });

  it('never appears in a saved project, an exported library, the settings document or the console', async () => {
    const storage = memoryStorage();
    await new BrowserKeyStore(storage).save('api.example.com', KEY);
    const settings = withSetting(apiSettings('https://api.example.com/v1'), 'ai.apiConsent', ['api.example.com']);
    const logs: string[] = [];
    const spies = (['log', 'warn', 'error', 'info', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation((...a: unknown[]) => void logs.push(a.map(String).join(' '))));
    try {
      const svc = await fake(status(401, JSON.stringify({ error: `bad ${KEY}` })));
      const e = await failure(backend(generic(svc.url()), {}, KEY).run(pass(), new AbortController().signal));
      console.warn(e.message, e.detail, apiErrorText(e));
    } finally {
      spies.forEach((s) => s.mockRestore());
    }
    const project = await serializeProject(createInitialState()).text();
    const library = exportLibrary(emptyLibrary());
    const doc = JSON.stringify(migrateDoc({ schema: 2, settings }));
    for (const [what, text] of [
      ['project', project],
      ['library', library],
      ['settings', doc],
      ['console', logs.join('\n')],
    ])
      expect(text, what).not.toContain(KEY);
    expect(logs.join('\n')).toContain('••••7f3a');
  });
});
