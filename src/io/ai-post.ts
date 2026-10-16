// The desktop AI post-processing service (phase X3c, AI-POST.md §7.3): the `AiPostService` of the launcher's
// window. Everything with pixels happens in the launcher (engine/crates/rt-app/src/ai/post.rs): the page sends the
// settings, the prompt and the guard's material table, and for a final render only its id (`RENDER`: the launcher
// kept its linear image and its exact passes, AI-POST.md §7.3); the Fast-mode preview sends its picture and passes
// along (`INLINE`, at most PREVIEW_MAX_SIDE a side). The job is followed like a render job (long poll, `DELETE` to
// cancel) and its image comes back once, as linear light (`RPL1`), in the space it went in: the render's scene light
// for `RENDER` (the page encodes it with the render's own exposure and curve), the preview's for `INLINE`.
//
// `status()` is the launcher's `/api/ai/runtime` for the person's settings and the active model: whether the switch
// can be on is what it says (AI_AVAILABLE is gone).

import { PREVIEW_MAX_SIDE, type AiPostProgress, type AiPostRequest, type AiPostResult, type AiPostService, type AiPostStage, type AiRuntimeStatus, type AiUnavailableReason, type GuardReport, type LinearImage } from '../core/ai';
import type { AiRuntimeQuery, AiRuntimeReport } from '../core/ai-runtimes';
import { PASS_CHANNELS, PASS_KEYS, type RenderPasses } from '../core/passes';
import { statusQuery } from './ai-runtime';
import { NativeError, type NativeClient } from './native';

/** `"RPI1"`: an inline post (the JSON, then the image and its passes). */
export const INLINE_MAGIC = 0x31495052;
/** `"RPL1"`: a linear image (straight-alpha RGBA f32, rows from the top). */
export const IMAGE_MAGIC = 0x314c5052;
const IMAGE_HEADER = 16;
/** `"RPP1"`: the passes file of engine/crates/rt-app/src/kept.rs. */
const PASSES_MAGIC = 0x31505052;
const PASSES_HEADER = 32;

const STAGES: readonly string[] = ['LOADING', 'CONDITIONING', 'INFERENCE', 'GUARD', 'RETRY'];
const FINISHED: readonly string[] = ['DONE', 'FAILED', 'CANCELLED'];

/** What `GET /api/ai/post/<id>` says. */
export interface AiPostState {
  id: number;
  state: 'QUEUED' | AiPostStage | 'DONE' | 'FAILED' | 'CANCELLED';
  stage: AiPostStage | null;
  tile: number;
  tiles: number;
  attempt: number;
  maxAttempts: number;
  /** Why the guard sent the previous attempt back, in its words; null until it did. */
  lastFailure?: string | null;
  strength: number;
  step: number;
  steps: number;
  fraction: number;
  seconds: number;
  version: number;
  /** Calls made to the inference runtime. */
  calls: number;
  renderId: number | null;
  model: string;
  runtime: string;
  width: number;
  height: number;
  /** How the image is looked at (RSB codes): the render's for RENDER. */
  tonemap: number;
  exposureEv: number;
  verdict: GuardReport['verdict'] | null;
  report: GuardReport | null;
  error: string | null;
  message: string | null;
}

/** A post that could not start or did not finish: the launcher's code, and the reason the switch words. */
export class AiPostError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly reason: AiUnavailableReason | null = null,
    readonly status = 0,
  ) {
    super(message);
    this.name = 'AiPostError';
  }
}

/** A linear image as `RPL1` bytes. */
export function encodeLinearImage(img: LinearImage): Uint8Array {
  const out = new Uint8Array(IMAGE_HEADER + img.rgba.length * 4);
  const v = new DataView(out.buffer);
  v.setUint32(0, IMAGE_MAGIC, true);
  v.setUint32(4, IMAGE_HEADER, true);
  v.setUint32(8, img.width, true);
  v.setUint32(12, img.height, true);
  new Float32Array(out.buffer, IMAGE_HEADER, img.rgba.length).set(img.rgba);
  return out;
}

/** Reads `RPL1` bytes. */
export function decodeLinearImage(buf: ArrayBuffer): LinearImage {
  if (buf.byteLength < IMAGE_HEADER) throw new Error('short image');
  const v = new DataView(buf);
  if (v.getUint32(0, true) !== IMAGE_MAGIC) throw new Error('not a linear image');
  const header = v.getUint32(4, true);
  const width = v.getUint32(8, true);
  const height = v.getUint32(12, true);
  const n = width * height * 4;
  if (header < IMAGE_HEADER || header % 4 !== 0 || header + n * 4 > buf.byteLength) throw new Error('bad linear image');
  return { width, height, rgba: new Float32Array(buf.slice(header, header + n * 4)) };
}

/** The passes as an `RPP1` file (what the launcher reads for an inline post; render/pass-planes.ts reads it back). */
export function encodePasses(passes: RenderPasses, id = 0, samples = 1): Uint8Array {
  const n = passes.width * passes.height;
  let mask = 0;
  let words = 0;
  PASS_KEYS.forEach((k, i) => {
    const plane = passes[k];
    if (!plane) return;
    if (plane.length !== n * PASS_CHANNELS[k]) throw new Error(`the ${k} pass is not ${passes.width} × ${passes.height}`);
    mask |= 1 << i;
    words += plane.length;
  });
  const out = new Uint8Array(PASSES_HEADER + words * 4);
  const v = new DataView(out.buffer);
  [PASSES_MAGIC, PASSES_HEADER, passes.width, passes.height, mask, samples, id, 0].forEach((w, i) => v.setUint32(i * 4, w >>> 0, true));
  let pos = PASSES_HEADER;
  for (const k of PASS_KEYS) {
    const plane = passes[k];
    if (!plane) continue;
    // Every browser is little-endian, as the files are: the planes go in as they are.
    out.set(new Uint8Array(plane.buffer, plane.byteOffset, plane.byteLength), pos);
    pos += plane.byteLength;
  }
  return out;
}

/** The body of an inline post. */
export function inlineBody(json: string, image: LinearImage, passes: RenderPasses): Uint8Array {
  const text = new TextEncoder().encode(json);
  const img = encodeLinearImage(image);
  const pp = encodePasses(passes);
  const out = new Uint8Array(8 + text.length + img.length + pp.length);
  const v = new DataView(out.buffer);
  v.setUint32(0, INLINE_MAGIC, true);
  v.setUint32(4, text.length, true);
  out.set(text, 8);
  out.set(img, 8 + text.length);
  out.set(pp, 8 + text.length + img.length);
  return out;
}

const abortError = (): DOMException => new DOMException('aborted', 'AbortError');

/** The settings the launcher reads, and nothing else (a store object may carry more). */
function requestJson(req: AiPostRequest, q: AiRuntimeQuery, inline: { tonemap?: number; exposureEv?: number } | null): string {
  const s = req.settings;
  return JSON.stringify({
    source: req.source.kind === 'RENDER' ? { kind: 'RENDER', renderId: req.source.renderId } : { kind: 'INLINE', ...inline },
    settings: { intervention: s.intervention, light: s.light, bounce: s.bounce, wear: s.wear, style: s.style, styleStrength: s.styleStrength, seed: s.seed >>> 0 },
    prompt: req.prompt,
    negative: req.negative,
    modelKey: req.modelKey,
    ...(req.materials ? { materials: req.materials } : {}),
    ...(q.cpu ? { device: 'cpu' } : {}),
    ...(q.force ? { force: q.force } : {}),
  });
}

export class DesktopAiService implements AiPostService {
  /**
   * `query`: the person's settings and the active model as `/api/ai/runtime` takes them (ui/panels/settings-ai.ts
   * `aiRuntimeQuery`), read at every call.
   */
  constructor(
    private readonly native: Pick<NativeClient, 'request'>,
    private readonly query: () => AiRuntimeQuery,
  ) {}

  private async json<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await this.native.request(path, init);
    const text = await res.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    if (!res.ok) {
      const e = (body ?? {}) as { error?: string; message?: string; reason?: AiUnavailableReason };
      throw new AiPostError(e.error ?? 'http', e.message ?? `${res.status}`, e.reason ?? null, res.status);
    }
    return body as T;
  }

  async status(): Promise<AiRuntimeStatus> {
    const r = await this.json<AiRuntimeReport>(`/api/ai/runtime${statusQuery(this.query())}`);
    return { available: r.available, ...(r.reason ? { reason: r.reason } : {}), backend: r.backend, device: r.device, supports: r.supports, activeModel: r.activeModel };
  }

  /** A post's state; with `after`, waits up to a second for a newer one. */
  state(id: number, after?: number, signal?: AbortSignal): Promise<AiPostState> {
    return this.json(`/api/ai/post/${id}${after === undefined ? '' : `?after=${after}`}`, signal ? { signal } : {});
  }

  private async forget(id: number): Promise<void> {
    const res = await this.native.request(`/api/ai/post/${id}`, { method: 'DELETE' });
    await res.text().catch(() => '');
  }

  async post(request: AiPostRequest, onProgress: (p: AiPostProgress) => void, signal: AbortSignal): Promise<AiPostResult> {
    if (signal.aborted) throw abortError();
    const q = this.query();
    let init: RequestInit;
    if (request.source.kind === 'INLINE') {
      const { image, passes } = request.source;
      if (image.width > PREVIEW_MAX_SIDE || image.height > PREVIEW_MAX_SIDE) throw new AiPostError('size', `an inline image is at most ${PREVIEW_MAX_SIDE} px a side`);
      const body = inlineBody(requestJson(request, q, null), image, passes);
      init = { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: body as Uint8Array<ArrayBuffer> };
    } else init = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: requestJson(request, q, null) };
    // Not cut short by the signal: a post the launcher took is always told to stop (an abort in flight would leave
    // it running unseen until the launcher gives up on it).
    let s = await this.json<AiPostState>('/api/ai/post', init);
    const id = s.id;
    // Pause or Stop: the launcher stops the post (it keeps the model loaded) and the caller hears an abort.
    const cancel = () => void this.forget(id).catch(() => undefined);
    if (signal.aborted) {
      cancel();
      throw abortError();
    }
    signal.addEventListener('abort', cancel, { once: true });
    try {
      for (;;) {
        if (signal.aborted) throw abortError();
        if (STAGES.includes(s.state)) onProgress({ stage: s.state as AiPostStage, tile: s.tile, tiles: s.tiles, attempt: s.attempt, ...(s.maxAttempts > 0 ? { maxAttempts: s.maxAttempts } : {}), ...(s.lastFailure ? { reason: s.lastFailure } : {}), fraction: s.fraction });
        if (FINISHED.includes(s.state)) break;
        s = await this.state(id, s.version, signal);
      }
      if (s.state === 'CANCELLED') throw signal.aborted ? abortError() : new AiPostError('cancelled', 'the post was cancelled');
      if (s.state === 'FAILED' || !s.report) throw new AiPostError(s.error ?? 'failed', s.message ?? 'the post failed');
      const res = await this.native.request(`/api/ai/post/${id}/image`, { signal });
      if (!res.ok) throw new NativeError(res.status, 'image', await res.text());
      const image = decodeLinearImage(await res.arrayBuffer());
      onProgress({ stage: 'GUARD', tile: s.tiles, tiles: s.tiles, attempt: s.attempt, ...(s.maxAttempts > 0 ? { maxAttempts: s.maxAttempts } : {}), ...(s.lastFailure ? { reason: s.lastFailure } : {}), fraction: 1 });
      // Collected: the launcher may forget it.
      void this.forget(id).catch(() => undefined);
      return { image, report: s.report };
    } catch (err) {
      if (signal.aborted || (err instanceof Error && err.name === 'AbortError')) throw abortError();
      throw err;
    } finally {
      signal.removeEventListener('abort', cancel);
    }
  }
}
