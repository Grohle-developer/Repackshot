// The AI model through an API, from the page (phase X7, AI-POST.md §8): the `AiModelBackend` that calls a remote
// image-to-image endpoint with `fetch`. It is the web's way; on the desktop the launcher calls the API itself
// (rt-app/src/ai/remote.rs, the same rules) so that the key never comes back to the page.
//
// One call: the tile fitted to the service's size (core/ai-remote.ts `fitTile`), PNG, the template filled, the key in
// its header and nowhere else; the answer read up to MAX_RESPONSE_BYTES, its image found, checked as a PNG of a sane
// size, decoded and brought back to the tile's size. A timeout, a rate limit, a network or a server failure tries
// again, at most `attempts` tries in all, waiting what the service asks (at most MAX_RETRY_WAIT) or 1, 2, 4 s; anything
// else fails at once. Never a redirect (it could take the render to another host than the one agreed).

import type { AiModelBackend, AiModelPass, AiTileImage } from '../core/ai-backend';
import {
  answerSizeOk,
  apiRuntime,
  ApiCallError,
  atPath,
  base64Of,
  fillJson,
  fillMultipart,
  fitTile,
  fromCanvas,
  hostOf,
  MAX_RESPONSE_BYTES,
  MAX_RESULT_PIXEL_RATIO,
  multipartBoundary,
  parseTemplate,
  pictureKind,
  retryable,
  retryWait,
  serviceWords,
  statusError,
  toCanvas,
  type ApiEndpoint,
  type ApiErrorCode,
  type ApiOptions,
  type ApiValues,
  type MultipartPart,
  type TileFit,
} from '../core/ai-remote';
import { base64ToBytes, bytesToBase64 } from './base64';
import { decodePngRgb, encodePngGrey, encodePngRgb, pngSize } from './png-rgb';

export interface ApiBackendDeps {
  fetch: typeof fetch;
  /** Waits, unless stopped first (then it throws the AbortError). */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

const abortError = (): DOMException => new DOMException('aborted', 'AbortError');

function defaultSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(abortError());
    const id = setTimeout(() => {
      signal.removeEventListener('abort', stop);
      resolve();
    }, ms);
    const stop = () => {
      clearTimeout(id);
      reject(abortError());
    };
    signal.addEventListener('abort', stop, { once: true });
  });
}

/** One request as it goes out (built once a pass; the tests read it too). */
export interface ApiHttpRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: Uint8Array;
}

const enc = new TextEncoder();

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** The bytes of a multipart form (RFC 7578): the parts in order, files as `image/png`. */
export function multipartBytes(parts: readonly MultipartPart[], files: Record<string, Uint8Array>, boundary: string): Uint8Array {
  const out: Uint8Array[] = [];
  for (const p of parts) {
    const name = p.name.replace(/["\r\n]/g, '_');
    if (p.kind === 'file') {
      out.push(enc.encode(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"; filename="${p.what}.png"\r\nContent-Type: image/png\r\n\r\n`), files[p.what] ?? new Uint8Array(0), enc.encode('\r\n'));
    } else out.push(enc.encode(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${p.value}\r\n`));
  }
  out.push(enc.encode(`--${boundary}--\r\n`));
  return concat(out);
}

/** The request of one pass (no key yet when `key` is null). */
export function buildRequest(e: ApiEndpoint, key: string | null, values: ApiValues, files: Record<string, Uint8Array>, seed: number): ApiHttpRequest {
  const template = parseTemplate(e.template);
  if (!template) throw new ApiCallError('api-config', 'the template is not a JSON object');
  const headers: Record<string, string> = { ...e.headers };
  if (e.authHeader && key) headers[e.authHeader] = `${e.authPrefix}${key}`;
  let body: Uint8Array;
  if (e.body === 'JSON') {
    headers['Content-Type'] = 'application/json';
    body = enc.encode(JSON.stringify(fillJson(template, values)));
  } else {
    let boundary = multipartBoundary(seed);
    const parts = fillMultipart(template, values);
    // A boundary that a part's bytes contain would cut it: another one, until none does.
    const texts = parts.map((p) => (p.kind === 'text' ? p.value : '')).join('\n');
    for (let n = 1; texts.includes(boundary); n++) boundary = multipartBoundary(seed + n);
    headers['Content-Type'] = `multipart/form-data; boundary=${boundary}`;
    body = multipartBytes(parts, files, boundary);
  }
  return { url: e.url, method: e.method, headers, body };
}

/** Reads a response body up to `limit` bytes; past it, the read is stopped and null returned. */
async function readCapped(res: Response, limit: number): Promise<Uint8Array | null> {
  const declared = Number(res.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > limit) {
    await res.body?.cancel().catch(() => undefined);
    return null;
  }
  if (!res.body) return new Uint8Array(await res.arrayBuffer());
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.length;
    if (n > limit) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    parts.push(value);
  }
  return concat(parts);
}

/** The image an answer holds, as PNG bytes; throws `api-format` for anything else. */
export function imageOfAnswer(e: ApiEndpoint, body: Uint8Array, contentType: string | null): Uint8Array {
  let bytes: Uint8Array;
  if (e.response === 'IMAGE') bytes = body;
  else {
    let doc: unknown;
    try {
      doc = JSON.parse(new TextDecoder().decode(body));
    } catch {
      throw new ApiCallError('api-format', `the answer is not JSON${contentType ? ` (${contentType})` : ''}`, 1, null, 'json');
    }
    const value = atPath(doc, e.responsePath);
    const b64 = typeof value === 'string' ? base64Of(value) : null;
    if (b64 === null) throw new ApiCallError('api-format', `no image at '${e.responsePath}' in the answer`, 1, null, 'path');
    try {
      bytes = base64ToBytes(b64.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(b64.length / 4) * 4, '='));
    } catch {
      throw new ApiCallError('api-format', `the value at '${e.responsePath}' is not base64`, 1, null, 'base64');
    }
  }
  const kind = pictureKind(bytes);
  if (kind !== 'PNG') throw new ApiCallError('api-format', `the image is ${kind === 'OTHER' ? 'not a picture' : kind}, not PNG`, 1, null, kind);
  return bytes;
}

/** What one try ended with. */
type Try = { ok: true; image: AiTileImage } | { ok: false; error: ApiCallError; retryAfter: string | null };

export class ApiBackend implements AiModelBackend {
  readonly kind = 'API' as const;
  readonly runtime: string;
  /** Calls made (tries included), for the tests and the log. */
  calls = 0;

  constructor(
    private readonly endpoint: ApiEndpoint,
    private readonly options: ApiOptions,
    private readonly key: string | null,
    private readonly deps: ApiBackendDeps,
  ) {
    this.runtime = apiRuntime(hostOf(endpoint.url) ?? '');
  }

  async run(pass: AiModelPass, signal: AbortSignal): Promise<AiTileImage> {
    const e = this.endpoint;
    const fit = fitTile(pass.width, pass.height, e);
    const tile = { width: pass.width, height: pass.height, rgb: pass.input };
    const image = await encodePngRgb(fit.width, fit.height, toCanvas(tile, fit));
    const files: Record<string, Uint8Array> = { image };
    const values: ApiValues = { prompt: pass.prompt, negative: pass.negative, strength: pass.strength, seed: pass.seed, width: fit.width, height: fit.height, image: bytesToBase64(image) };
    if (this.options.sendPasses) {
      for (const [k, plane] of [
        ['depth', pass.depth],
        ['edges', pass.edges],
      ] as const) {
        files[k] = await encodePngGrey(fit.width, fit.height, toCanvas({ width: pass.width, height: pass.height, rgb: plane }, fit, 1));
        values[k] = bytesToBase64(files[k]);
      }
    }
    const request = buildRequest(e, this.key, values, files, pass.seed + pass.tile);
    const sleep = this.deps.sleep ?? defaultSleep;
    const tries = Math.max(1, this.options.attempts);
    for (let n = 1; ; n++) {
      const r = await this.once(request, fit, pass, signal);
      if (r.ok) return r.image;
      const err = r.error;
      const wait = n < tries && retryable(err.code) ? retryWait(n + 1, r.retryAfter) : null;
      if (wait === null) throw new ApiCallError(err.code, err.message, n, err.status, err.detail);
      await sleep(wait * 1000, signal);
    }
  }

  private async once(request: ApiHttpRequest, fit: TileFit, pass: AiModelPass, signal: AbortSignal): Promise<Try> {
    const fail = (code: ApiErrorCode, message: string, status: number | null = null, detail = '', retryAfter: string | null = null): Try => ({ ok: false, error: new ApiCallError(code, message, 1, status, detail), retryAfter });
    signal.throwIfAborted();
    this.calls++;
    const timeout = AbortSignal.timeout(this.options.timeoutSeconds * 1000);
    const both = AbortSignal.any([signal, timeout]);
    let res: Response;
    try {
      res = await this.deps.fetch(request.url, { method: request.method, headers: request.headers, body: request.body as Uint8Array<ArrayBuffer>, redirect: 'manual', signal: both, credentials: 'omit', referrerPolicy: 'no-referrer' });
    } catch (err) {
      if (signal.aborted) throw abortError();
      if (timeout.aborted) return fail('api-timeout', `no answer within ${this.options.timeoutSeconds} s`);
      return fail('api-network', err instanceof Error ? err.message : String(err));
    }
    try {
      if (res.type === 'opaqueredirect') return fail('api-redirect', 'the service sent the request elsewhere', 0);
      const body = await readCapped(res, MAX_RESPONSE_BYTES);
      if (body === null) return fail('api-oversize', `the answer is larger than ${MAX_RESPONSE_BYTES} bytes`, res.status);
      const code = statusError(res.status);
      if (code) return fail(code, `HTTP ${res.status}`, res.status, serviceWords(new TextDecoder().decode(body.subarray(0, 4096)), this.key), res.headers.get('retry-after'));
      let png: Uint8Array;
      try {
        png = imageOfAnswer(this.endpoint, body, res.headers.get('content-type'));
      } catch (err) {
        if (err instanceof ApiCallError) return fail(err.code, err.message, res.status, err.detail);
        throw err;
      }
      const size = pngSize(png);
      if (!size || !answerSizeOk(size.width, size.height, fit)) return fail('api-oversize', `an image of ${size?.width}×${size?.height} for ${fit.width}×${fit.height} sent`, res.status, size ? `${size.width}x${size.height}` : '');
      let decoded;
      try {
        decoded = await decodePngRgb(png, MAX_RESULT_PIXEL_RATIO * fit.width * fit.height);
      } catch (err) {
        return fail('api-format', err instanceof Error ? err.message : String(err), res.status, 'png');
      }
      return { ok: true, image: fromCanvas(decoded, fit, pass.width, pass.height) };
    } catch (err) {
      if (signal.aborted) throw abortError();
      if (timeout.aborted) return fail('api-timeout', `no answer within ${this.options.timeoutSeconds} s`);
      return fail('api-network', err instanceof Error ? err.message : String(err));
    }
  }
}
