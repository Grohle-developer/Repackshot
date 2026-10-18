// The AI model through an API (phase X7, AI-POST.md §8): what a remote image-to-image endpoint is, and the pure
// rules every implementation of it follows. The web's (src/ai/api-backend.ts, `fetch`) and the launcher's
// (engine/crates/rt-app/src/ai/remote.rs, the system's `curl`) both fill the same template, read the same response
// path, fit a tile to the same size and word the same failures; tests/fixtures/ai-remote-cases.json holds the cases
// both are checked against.
//
// Nothing here holds or sees the API key: it lives in the launcher's data folder (desktop) or the browser's local
// storage (web), never in a setting, a project, the library or a log (io/api-keys.ts). The endpoint itself is a
// setting of this computer (`ai.apiEndpoint`), like the model in use.
//
// The pipeline does not change for an API: the guard (rt-post) runs on every image an API returns, with the same
// protections and the same report, and a rejected result delivers the engine image unchanged.

import type { AiPostRequest } from './ai';

// The endpoint's shape lives with the presets' data (src/data/ai-api-presets.ts: data imports nothing); it is the
// contract of this module all the same.
export { API_BODIES, API_METHODS, API_PROVIDERS, API_RESPONSES, type ApiBody, type ApiEndpoint, type ApiMethod, type ApiProvider, type ApiResponseKind } from '../data/ai-api-presets';
import { API_METHODS, type ApiEndpoint, type ApiProvider } from '../data/ai-api-presets';

/** How the calls are made (Settings ▸ AI post-processing ▸ Model by API). ◆ The defaults are the lead's to confirm. */
export interface ApiOptions {
  /** Send the depth and edge passes too (only to a template that asks for them); off: only the image leaves. */
  sendPasses: boolean;
  /** Seconds a call may take before it is given up. */
  timeoutSeconds: number;
  /** Tries of one call, the first included: only a timeout, a rate limit, a network or a server failure tries again. */
  attempts: number;
}

/** The defaults (◆ AI-POST.md §8.6): the image only, two minutes, two tries. */
export const DEFAULT_API_OPTIONS: Readonly<ApiOptions> = { sendPasses: false, timeoutSeconds: 120, attempts: 2 };
export const API_TIMEOUT_RANGE = [10, 600] as const;
export const API_ATTEMPTS_RANGE = [1, 5] as const;
/** Largest answer read, in bytes: past it the call fails as oversize (never read to the end). */
export const MAX_RESPONSE_BYTES = 64 * 1024 * 1024;
/** Largest side of an image an answer may hold. */
export const MAX_RESULT_SIDE = 8192;
/** An answer may hold at most this many times the pixels sent. */
export const MAX_RESULT_PIXEL_RATIO = 4;
/** The longest a rate limit is waited for before the next try, in seconds (a longer Retry-After fails at once). */
export const MAX_RETRY_WAIT = 30;
/** Longest template text. */
export const MAX_TEMPLATE = 16384;
/** The most fixed sizes a service may list. */
export const MAX_SIZES = 16;

/** The words a template may use. `{{image}}` is the tile (a file part in a form, base64 in JSON). */
export const API_PLACEHOLDERS = [
  'image',
  'image_base64',
  'image_data_uri',
  'depth',
  'depth_base64',
  'depth_data_uri',
  'edges',
  'edges_base64',
  'edges_data_uri',
  'prompt',
  'negative',
  'strength',
  'seed',
  'width',
  'height',
  'size',
] as const;
export type ApiPlaceholder = (typeof API_PLACEHOLDERS)[number];
/** Placeholders that are numbers (in a JSON body, a string that is only one of them becomes a number). */
export const NUMERIC_PLACEHOLDERS: readonly ApiPlaceholder[] = ['strength', 'seed', 'width', 'height'];
/** Placeholders of the passes: only allowed with `sendPasses`. */
export const PASS_PLACEHOLDERS: readonly ApiPlaceholder[] = ['depth', 'depth_base64', 'depth_data_uri', 'edges', 'edges_base64', 'edges_data_uri'];
/** Placeholders that are a file part when they are a whole multipart value. */
export const FILE_PLACEHOLDERS = ['image', 'depth', 'edges'] as const;
export type ApiFile = (typeof FILE_PLACEHOLDERS)[number];

/** Headers the person may not set: the transport owns them, or they would carry the key outside its field. */
const RESERVED_HEADERS = ['host', 'content-length', 'content-type', 'transfer-encoding', 'connection', 'cookie', 'authorization', 'proxy-authorization', 'x-api-key', 'api-key'];
const HEADER_NAME = /^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,64}$/;
const PLACEHOLDER = /\{\{([a-z_]+)\}\}/g;

/** Why an endpoint cannot be used yet. The interface words each code (`set.ai.api.problem.<code>`). */
export type ApiProblemCode =
  | 'url'
  | 'insecure'
  | 'method'
  | 'header'
  | 'reservedHeader'
  | 'template'
  | 'placeholder'
  | 'passes'
  | 'noImage'
  | 'nested'
  | 'path'
  | 'size'
  | 'options';
export interface ApiProblem {
  code: ApiProblemCode;
  /** The header, placeholder or value at fault. */
  detail?: string;
}

/** The answer's failures (AI-POST.md §8.4). The interface words them (`ai.api.err.<code>`), never the service's raw text alone. */
export const API_ERRORS = [
  'api-auth',
  'api-rate-limit',
  'api-timeout',
  'api-network',
  'api-server',
  'api-refused',
  'api-too-large',
  'api-format',
  'api-oversize',
  'api-redirect',
  'api-no-key',
  'api-consent',
  'api-config',
] as const;
export type ApiErrorCode = (typeof API_ERRORS)[number];

/** What one failed call tells: its code, how many tries were made, the HTTP status and a short part of the service's own words. */
export class ApiCallError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
    readonly attempts = 1,
    readonly status: number | null = null,
    readonly detail = '',
  ) {
    super(message);
    this.name = 'ApiCallError';
  }
}

// ------------------------------------------------------------------ hosts

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);

/** Whether a host (as `hostOf` gives it, without the port) is this computer. */
export function isLoopback(host: string): boolean {
  const name = host.replace(/:\d+$/, '');
  return LOOPBACK.has(name) || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(name);
}

/**
 * The host the render goes to, as consent and the keys are remembered: lower case, with the port only when it is not
 * the scheme's own (`api.stability.ai`, `127.0.0.1:8123`). Null for anything that is not a plain http(s) URL: no user
 * or password in it, no fragment.
 */
export function hostOf(url: string): string | null {
  const m = /^(https?):\/\/([^/?#]*)([/?][^#]*)?$/i.exec(url.trim());
  if (!m) return null;
  const scheme = m[1].toLowerCase();
  const authority = m[2].toLowerCase();
  if (!authority || authority.includes('@')) return null;
  const hp = /^(\[[0-9a-f:.]+\]|[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*)(?::(\d{1,5}))?$/.exec(authority);
  if (!hp) return null;
  const port = hp[5];
  if (port !== undefined && (Number(port) < 1 || Number(port) > 65535)) return null;
  const def = scheme === 'https' ? '443' : '80';
  return port === undefined || String(Number(port)) === def ? hp[1] : `${hp[1]}:${Number(port)}`;
}

/** The URL's scheme, lower case. */
export function schemeOf(url: string): string {
  return (/^([a-z]+):/i.exec(url.trim())?.[1] ?? '').toLowerCase();
}

// ------------------------------------------------------------------ the template

/** Every placeholder a text uses, in order of first use. */
export function placeholdersIn(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(PLACEHOLDER)) if (!out.includes(m[1])) out.push(m[1]);
  return out;
}

/** The template as a JSON object, or null when it is not one. */
export function parseTemplate(text: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(text) as unknown;
    return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function walkStrings(v: unknown, f: (s: string) => void): void {
  if (typeof v === 'string') f(v);
  else if (Array.isArray(v)) v.forEach((x) => walkStrings(x, f));
  else if (typeof v === 'object' && v !== null) Object.values(v).forEach((x) => walkStrings(x, f));
}

/** What is wrong with an endpoint and its options, in the order the form shows the fields; empty when it can be used. */
export function endpointProblems(e: ApiEndpoint, o: ApiOptions): ApiProblem[] {
  const out: ApiProblem[] = [];
  const host = hostOf(e.url);
  if (!host) out.push({ code: 'url' });
  else if (schemeOf(e.url) !== 'https' && !isLoopback(host)) out.push({ code: 'insecure' });
  if (!(API_METHODS as readonly string[]).includes(e.method)) out.push({ code: 'method' });
  if (e.authHeader !== '' && !HEADER_NAME.test(e.authHeader)) out.push({ code: 'header', detail: e.authHeader });
  if (/[\r\n]/.test(e.authPrefix) || e.authPrefix.length > 64) out.push({ code: 'header', detail: e.authPrefix });
  for (const [name, value] of Object.entries(e.headers)) {
    if (!HEADER_NAME.test(name) || /[\r\n]/.test(value) || value.length > 1024) out.push({ code: 'header', detail: name });
    else if (RESERVED_HEADERS.includes(name.toLowerCase()) || (e.authHeader !== '' && name.toLowerCase() === e.authHeader.toLowerCase())) out.push({ code: 'reservedHeader', detail: name });
  }
  const template = e.template.length <= MAX_TEMPLATE ? parseTemplate(e.template) : null;
  if (!template) out.push({ code: 'template' });
  else {
    const used = new Set<string>();
    walkStrings(template, (s) => placeholdersIn(s).forEach((p) => used.add(p)));
    for (const p of used) {
      if (!(API_PLACEHOLDERS as readonly string[]).includes(p)) out.push({ code: 'placeholder', detail: p });
      else if (!o.sendPasses && PASS_PLACEHOLDERS.includes(p as ApiPlaceholder)) out.push({ code: 'passes', detail: p });
    }
    if (!['image', 'image_base64', 'image_data_uri'].some((p) => used.has(p))) out.push({ code: 'noImage' });
    if (e.body === 'MULTIPART') for (const [k, v] of Object.entries(template)) if (typeof v === 'object' && v !== null) out.push({ code: 'nested', detail: k });
  }
  if (e.response === 'JSON' && !/^[^.\s]+(\.[^.\s]+)*$/.test(e.responsePath)) out.push({ code: 'path' });
  const side = (n: number) => Number.isInteger(n) && n >= 64 && n <= 4096;
  if (!side(e.maxSide) || !Number.isInteger(e.multipleOf) || e.multipleOf < 1 || e.multipleOf > 256 || e.sizes.length > MAX_SIZES || e.sizes.some(([w, h]) => !side(w) || !side(h))) out.push({ code: 'size' });
  if (!Number.isInteger(o.timeoutSeconds) || o.timeoutSeconds < API_TIMEOUT_RANGE[0] || o.timeoutSeconds > API_TIMEOUT_RANGE[1] || !Number.isInteger(o.attempts) || o.attempts < API_ATTEMPTS_RANGE[0] || o.attempts > API_ATTEMPTS_RANGE[1]) out.push({ code: 'options' });
  return out;
}

/** The values of one call: what the model is asked, and the tile's images already as text (PNG in base64). */
export interface ApiValues {
  prompt: string;
  negative: string;
  /** The attempt's img2img strength, 0..1, rounded to 3 decimals. */
  strength: number;
  seed: number;
  /** The size sent. */
  width: number;
  height: number;
  /** PNG of each image, base64; the passes only when they are sent. */
  image: string;
  depth?: string;
  edges?: string;
}

/** The strength as the template writes it: three decimals at most (the same number on every platform). */
export function roundStrength(s: number): number {
  return Math.round(Math.max(0, Math.min(1, s)) * 1000) / 1000;
}

/** A placeholder's text. */
function textOf(name: string, v: ApiValues): string {
  const base = (b: string | undefined) => b ?? '';
  switch (name) {
    case 'image':
    case 'image_base64':
      return v.image;
    case 'image_data_uri':
      return `data:image/png;base64,${v.image}`;
    case 'depth':
    case 'depth_base64':
      return base(v.depth);
    case 'depth_data_uri':
      return `data:image/png;base64,${base(v.depth)}`;
    case 'edges':
    case 'edges_base64':
      return base(v.edges);
    case 'edges_data_uri':
      return `data:image/png;base64,${base(v.edges)}`;
    case 'prompt':
      return v.prompt;
    case 'negative':
      return v.negative;
    case 'strength':
      return String(roundStrength(v.strength));
    case 'seed':
      return String(v.seed >>> 0);
    case 'width':
      return String(v.width);
    case 'height':
      return String(v.height);
    case 'size':
      return `${v.width}x${v.height}`;
    default:
      return '';
  }
}

function numberOf(name: string, v: ApiValues): number {
  return name === 'strength' ? roundStrength(v.strength) : name === 'seed' ? v.seed >>> 0 : name === 'width' ? v.width : v.height;
}

/** One string of the template, filled. */
function fillString(s: string, v: ApiValues, json: boolean): unknown {
  const whole = /^\{\{([a-z_]+)\}\}$/.exec(s);
  if (json && whole && NUMERIC_PLACEHOLDERS.includes(whole[1] as ApiPlaceholder)) return numberOf(whole[1], v);
  return s.replace(PLACEHOLDER, (_m, name: string) => textOf(name, v));
}

function fillValue(x: unknown, v: ApiValues): unknown {
  if (typeof x === 'string') return fillString(x, v, true);
  if (Array.isArray(x)) return x.map((y) => fillValue(y, v));
  if (typeof x === 'object' && x !== null) return Object.fromEntries(Object.entries(x).map(([k, y]) => [k, fillValue(y, v)]));
  return x;
}

/** A JSON body: the template with every placeholder filled (the values are inserted as values, never as JSON text). */
export function fillJson(template: Record<string, unknown>, v: ApiValues): Record<string, unknown> {
  return fillValue(template, v) as Record<string, unknown>;
}

export type MultipartPart = { name: string; kind: 'text'; value: string } | { name: string; kind: 'file'; what: ApiFile };

/** A multipart body's parts, in the template's order: files where a value is exactly `{{image}}` (or a pass), text otherwise. */
export function fillMultipart(template: Record<string, unknown>, v: ApiValues): MultipartPart[] {
  return Object.entries(template).map(([name, x]): MultipartPart => {
    const whole = typeof x === 'string' ? /^\{\{([a-z_]+)\}\}$/.exec(x) : null;
    if (whole && (FILE_PLACEHOLDERS as readonly string[]).includes(whole[1])) return { name, kind: 'file', what: whole[1] as ApiFile };
    const text = typeof x === 'string' ? (fillString(x, v, false) as string) : String(x);
    return { name, kind: 'text', value: text };
  });
}

/** A boundary that none of the parts' bytes contain (it is chosen from their seed and checked). */
export function multipartBoundary(seed: number): string {
  return `----RepackshotBoundary${(seed >>> 0).toString(16).padStart(8, '0')}`;
}

// ------------------------------------------------------------------ the answer

/** The value at a dotted path of a JSON document (`data.0.b64_json`), or undefined. */
export function atPath(doc: unknown, path: string): unknown {
  let at: unknown = doc;
  for (const key of path.split('.')) {
    if (Array.isArray(at)) {
      if (!/^\d+$/.test(key)) return undefined;
      at = at[Number(key)];
    } else if (typeof at === 'object' && at !== null) at = Object.prototype.hasOwnProperty.call(at, key) ? (at as Record<string, unknown>)[key] : undefined;
    else return undefined;
  }
  return at;
}

/** The base64 text of an image value: a data URI's payload, or the value itself. Null when it is neither. */
export function base64Of(value: string): string | null {
  const s = value.trim();
  const uri = /^data:image\/[a-z0-9.+-]+(;[a-z0-9=.+-]+)*;base64,/i.exec(s);
  const body = (uri ? s.slice(uri[0].length) : s).replace(/\s+/g, '');
  return body.length > 0 && /^[A-Za-z0-9+/_-]+={0,2}$/.test(body) ? body : null;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** What kind of picture some bytes are, by their first bytes: PNG is the only one read. */
export function pictureKind(bytes: Uint8Array): 'PNG' | 'JPEG' | 'WEBP' | 'GIF' | 'OTHER' {
  if (PNG_SIGNATURE.every((b, i) => bytes[i] === b)) return 'PNG';
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'JPEG';
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[8] === 0x57 && bytes[9] === 0x45) return 'WEBP';
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'GIF';
  return 'OTHER';
}

/** The failure an HTTP status means (null: it succeeded). */
export function statusError(status: number): ApiErrorCode | null {
  if (status >= 200 && status < 300) return null;
  if (status >= 300 && status < 400) return 'api-redirect';
  if (status === 401 || status === 403) return 'api-auth';
  if (status === 408) return 'api-timeout';
  if (status === 413) return 'api-too-large';
  if (status === 429) return 'api-rate-limit';
  if (status >= 500) return 'api-server';
  return 'api-refused';
}

/** Whether trying the same call again can help. */
export function retryable(code: ApiErrorCode): boolean {
  return code === 'api-rate-limit' || code === 'api-timeout' || code === 'api-network' || code === 'api-server';
}

/**
 * Seconds to wait before try `next` (2, 3…): the service's Retry-After (seconds) when it gave one, else 1, 2, 4 s.
 * Null: the service asked for longer than `MAX_RETRY_WAIT`, so it is not tried again (no long silent waits).
 */
export function retryWait(next: number, retryAfter: string | null): number | null {
  const n = retryAfter !== null && /^\s*\d+\s*$/.test(retryAfter) ? Number(retryAfter) : null;
  if (n !== null) return n > MAX_RETRY_WAIT ? null : n;
  return Math.min(MAX_RETRY_WAIT, 2 ** Math.max(0, next - 2));
}

/** The service's own words of a failure, short: a JSON `message`/`error`/`errors`, else the start of the text; never the key. */
export function serviceWords(body: string, key: string | null): string {
  let text = body;
  try {
    const v = JSON.parse(body) as Record<string, unknown>;
    const pick = (x: unknown): string | null => (typeof x === 'string' ? x : Array.isArray(x) ? x.filter((y) => typeof y === 'string').join('; ') || null : typeof x === 'object' && x !== null ? pick((x as Record<string, unknown>).message) : null);
    text = pick(v.message) ?? pick(v.error) ?? pick(v.errors) ?? pick(v.detail) ?? body;
  } catch {
    // Not JSON: the text itself.
  }
  return scrub(text.replace(/\s+/g, ' ').trim().slice(0, 300), key);
}

/** A text with every occurrence of the key replaced by its mask (a service may echo it back). */
export function scrub(text: string, key: string | null): string {
  return key && key.length >= 4 ? text.split(key).join(maskKey(key)) : text;
}

/** The key as the interface shows it: four dots and, for a long key, its last four characters. */
export function maskKey(key: string): string {
  return key.length >= 12 ? `••••${key.slice(-4)}` : '••••';
}

/** A key that can travel in a header: 1..4096 printable ASCII characters, no spaces at its ends. */
export function validKey(key: string): boolean {
  return key.length > 0 && key.length <= 4096 && key === key.trim() && /^[\x20-\x7e]+$/.test(key);
}

// ------------------------------------------------------------------ the size sent

/** How a tile is sent: the canvas the service gets, and where the tile is in it (the rest is the tile's edge). */
export interface TileFit {
  width: number;
  height: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The size a tile of `tw × th` is sent at (AI-POST.md §8.5). With fixed sizes: the one nearest the tile's shape, the
 * tile scaled to fit inside it and centred. Without: the tile itself, scaled down to `maxSide` when it is longer,
 * both sides rounded down to `multipleOf` (at least one multiple). A tile that already fits is sent as it is.
 */
export function fitTile(tw: number, th: number, e: Pick<ApiEndpoint, 'maxSide' | 'multipleOf' | 'sizes'>): TileFit {
  if (e.sizes.length > 0) {
    const shape = Math.log(tw / th);
    let best = e.sizes[0];
    for (const s of e.sizes) if (Math.abs(Math.log(s[0] / s[1]) - shape) < Math.abs(Math.log(best[0] / best[1]) - shape) - 1e-9) best = s;
    const [cw, ch] = best;
    const k = Math.min(cw / tw, ch / th);
    const w = Math.max(1, Math.min(cw, Math.round(tw * k)));
    const h = Math.max(1, Math.min(ch, Math.round(th * k)));
    return { width: cw, height: ch, x: Math.floor((cw - w) / 2), y: Math.floor((ch - h) / 2), w, h };
  }
  const q = Math.max(1, e.multipleOf);
  const k = Math.min(1, e.maxSide / Math.max(tw, th));
  const down = (n: number) => Math.max(q, Math.floor((n * k) / q) * q);
  const width = k === 1 && tw % q === 0 ? tw : down(tw);
  const height = k === 1 && th % q === 0 ? th : down(th);
  return { width, height, x: 0, y: 0, w: width, h: height };
}

/** 8-bit RGB, 3 bytes a pixel, rows from the top. */
export interface Rgb8 {
  width: number;
  height: number;
  rgb: Uint8Array;
}

/** Bilinear resampling of 8-bit RGB with pixel centres aligned (the same image when the size does not change). */
export function resampleRgb(src: Rgb8, width: number, height: number): Rgb8 {
  if (src.width === width && src.height === height) return src;
  const out = new Uint8Array(width * height * 3);
  const sx = src.width / width;
  const sy = src.height / height;
  for (let y = 0; y < height; y++) {
    const fy = Math.max(0, Math.min(src.height - 1, (y + 0.5) * sy - 0.5));
    const y0 = Math.floor(fy);
    const y1 = Math.min(src.height - 1, y0 + 1);
    const wy = fy - y0;
    for (let x = 0; x < width; x++) {
      const fx = Math.max(0, Math.min(src.width - 1, (x + 0.5) * sx - 0.5));
      const x0 = Math.floor(fx);
      const x1 = Math.min(src.width - 1, x0 + 1);
      const wx = fx - x0;
      for (let c = 0; c < 3; c++) {
        const a = src.rgb[(y0 * src.width + x0) * 3 + c];
        const b = src.rgb[(y0 * src.width + x1) * 3 + c];
        const d = src.rgb[(y1 * src.width + x0) * 3 + c];
        const e = src.rgb[(y1 * src.width + x1) * 3 + c];
        out[(y * width + x) * 3 + c] = Math.round((a * (1 - wx) + b * wx) * (1 - wy) + (d * (1 - wx) + e * wx) * wy);
      }
    }
  }
  return { width, height, rgb: out };
}

/** The tile as the service gets it: scaled into the fit's rectangle, the canvas around it filled with its nearest edge. */
export function toCanvas(tile: Rgb8, fit: TileFit, channels: 1 | 3 = 3): Uint8Array {
  const inner = channels === 3 ? resampleRgb(tile, fit.w, fit.h) : resampleGrey(tile, fit.w, fit.h);
  if (fit.w === fit.width && fit.h === fit.height) return inner.rgb;
  const out = new Uint8Array(fit.width * fit.height * channels);
  for (let y = 0; y < fit.height; y++) {
    const iy = Math.max(0, Math.min(fit.h - 1, y - fit.y));
    for (let x = 0; x < fit.width; x++) {
      const ix = Math.max(0, Math.min(fit.w - 1, x - fit.x));
      for (let c = 0; c < channels; c++) out[(y * fit.width + x) * channels + c] = inner.rgb[(iy * fit.w + ix) * channels + c];
    }
  }
  return out;
}

/** One-channel images resampled like `resampleRgb` (the passes). */
function resampleGrey(src: Rgb8, width: number, height: number): Rgb8 {
  if (src.width === width && src.height === height) return src;
  const rgb = new Uint8Array(src.width * src.height * 3);
  for (let i = 0; i < src.width * src.height; i++) rgb[i * 3] = rgb[i * 3 + 1] = rgb[i * 3 + 2] = src.rgb[i];
  const r = resampleRgb({ width: src.width, height: src.height, rgb }, width, height);
  const out = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) out[i] = r.rgb[i * 3];
  return { width, height, rgb: out };
}

/** The service's answer back at the tile's size: brought to the canvas size it was asked for, its tile part cut out and scaled. */
export function fromCanvas(answer: Rgb8, fit: TileFit, tw: number, th: number): Rgb8 {
  const canvas = resampleRgb(answer, fit.width, fit.height);
  let part = canvas;
  if (fit.w !== fit.width || fit.h !== fit.height) {
    const rgb = new Uint8Array(fit.w * fit.h * 3);
    for (let y = 0; y < fit.h; y++) rgb.set(canvas.rgb.subarray(((fit.y + y) * fit.width + fit.x) * 3, ((fit.y + y) * fit.width + fit.x + fit.w) * 3), y * fit.w * 3);
    part = { width: fit.w, height: fit.h, rgb };
  }
  return resampleRgb(part, tw, th);
}

/** Whether an answer's size is within reason for what was sent (else it is refused as oversize, before it is decoded). */
export function answerSizeOk(width: number, height: number, fit: Pick<TileFit, 'width' | 'height'>): boolean {
  return width >= 1 && height >= 1 && width <= MAX_RESULT_SIDE && height <= MAX_RESULT_SIDE && width * height <= MAX_RESULT_PIXEL_RATIO * fit.width * fit.height;
}

// ------------------------------------------------------------------ what travels with a post

/** What the pipeline needs to call the API (the page sends it with every post of the desktop; never the key). */
export interface AiRemoteRequest {
  endpoint: ApiEndpoint;
  options: ApiOptions;
  /** The host the person agreed to send to: the launcher refuses a post whose URL names another. */
  consentedHost: string;
  /** The provider key (`STABILITY_SD3`…), for the report. */
  provider: ApiProvider;
}

/** A post that goes through an API (desktop: the launcher calls it; web: the page does). */
export type AiRemotePostRequest = AiPostRequest & { remote?: AiRemoteRequest };

/** The model key a remote post reports (`API_STABILITY_SD3`): never one of `ai-models.json`. */
export function apiModelKey(provider: ApiProvider): string {
  return `API_${provider}`;
}

/** What ran it, for the report's `runtime`: `api:<host>`. */
export function apiRuntime(host: string): string {
  return `api:${host}`;
}
