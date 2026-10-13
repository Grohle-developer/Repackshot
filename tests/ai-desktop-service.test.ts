// The desktop AI post-processing service (phase X3c, src/io/ai-post.ts) against a stand-in launcher: what it sends
// for a RENDER and an INLINE source, how the launcher's states become progress, the image it reads back, the
// refusals and failures it words, and cancelling. The real launcher is in tests/ai-desktop.test.ts and in
// engine/crates/rt-app/tests/ai_post.rs.

import { describe, expect, it } from 'vitest';
import type { AiPostProgress, AiPostRequest, GuardReport, LinearImage } from '../src/core/ai';
import { FLOOR_ID, type RenderPasses } from '../src/core/passes';
import { AiPostError, decodeLinearImage, DesktopAiService, encodeLinearImage, encodePasses, inlineBody, type AiPostState } from '../src/io/ai-post';
import { parsePasses } from '../src/render/pass-planes';
import { straightBytes, straightExr, straightOf, straightWords16, exactBytes, exactWords16, linearRgba } from '../src/render/tiles';

const REPORT: GuardReport = {
  verdict: 'ACCEPTED',
  usedFraction: 1,
  attempts: 1,
  size: { ok: true, value: 1, limit: 1 },
  outside: { ok: true, value: 0, limit: 0 },
  edges: { ok: true, value: 0.2, limit: 1.5 },
  detail: { ok: true, value: 0.995, limit: 0.98 },
  focus: { ok: true, value: 0.01, limit: 0.15 },
  materials: [{ materialId: FLOOR_ID, name: 'Floor', deltaEMean: 0.4, deltaEP95: 0.9, limit: 2, ok: true }],
  modelKey: 'ZIMAGE_Q4',
  runtime: 'SDCPP_LINUX_CPU',
  seed: 5,
  seconds: 12.5,
};

const state = (patch: Partial<AiPostState>): AiPostState => ({
  id: 3,
  state: 'QUEUED',
  stage: null,
  tile: 0,
  tiles: 2,
  attempt: 0,
  maxAttempts: 4,
  strength: 0,
  step: 0,
  steps: 0,
  fraction: 0,
  seconds: 0,
  version: 1,
  calls: 0,
  renderId: 7,
  model: 'ZIMAGE_Q4',
  runtime: 'SDCPP_LINUX_CPU',
  width: 4,
  height: 2,
  tonemap: 1,
  exposureEv: 0,
  verdict: null,
  report: null,
  error: null,
  message: null,
  ...patch,
});

interface Call {
  path: string;
  method: string;
  type: string | null;
  body: Uint8Array | string | null;
}

/** A launcher that answers from a script of states; records every request. */
function launcher(script: AiPostState[], opts: { refuse?: { status: number; body: unknown }; image?: LinearImage } = {}) {
  const calls: Call[] = [];
  let i = 0;
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const request = async (path: string, init: RequestInit = {}): Promise<Response> => {
    if (init.signal?.aborted) throw new DOMException('aborted', 'AbortError');
    const method = init.method ?? 'GET';
    const headers = new Headers(init.headers);
    const body = init.body instanceof Uint8Array ? init.body : typeof init.body === 'string' ? init.body : null;
    calls.push({ path, method, type: headers.get('Content-Type'), body });
    if (path.startsWith('/api/ai/runtime')) return json(200, { available: false, reason: 'MODEL_UNSUPPORTED', backend: 'CPU', device: 'Fake CPU', supports: ['ZIMAGE_Q4'], activeModel: 'SD15_LIGHT', detail: 'x', choice: null });
    if (method === 'POST' && path === '/api/ai/post') return opts.refuse ? json(opts.refuse.status, opts.refuse.body) : json(202, script[0]);
    if (method === 'DELETE') return new Response(null, { status: 204 });
    if (path.endsWith('/image')) return new Response(encodeLinearImage(opts.image ?? { width: 4, height: 2, rgba: new Float32Array(32).fill(0.25) }) as Uint8Array<ArrayBuffer>, { status: 200 });
    i = Math.min(i + 1, script.length - 1);
    return json(200, script[i]);
  };
  return { calls, native: { request } };
}

const SETTINGS = { intervention: 30, light: 50, bounce: 40, wear: 20, style: 'NATURAL', styleStrength: 30, seed: 5 } as const;
const render = (renderId = '7'): AiPostRequest => ({ source: { kind: 'RENDER', renderId }, settings: { ...SETTINGS }, prompt: 'a bottle', negative: 'changed shape', modelKey: 'ZIMAGE_Q4', materials: [{ materialId: 1, name: 'Glass', allowsWear: true, locked: false }] });
const query = () => ({ force: null, cpu: true, model: 'ZIMAGE_Q4' });

describe('the desktop AI service', () => {
  it('says what the launcher says: availability is its status, for the person’s settings', async () => {
    const l = launcher([]);
    const svc = new DesktopAiService(l.native, () => ({ force: 'VULKAN', cpu: false, model: 'SD15_LIGHT' }));
    expect(await svc.status()).toEqual({ available: false, reason: 'MODEL_UNSUPPORTED', backend: 'CPU', device: 'Fake CPU', supports: ['ZIMAGE_Q4'], activeModel: 'SD15_LIGHT' });
    expect(l.calls[0].path).toBe('/api/ai/runtime?force=VULKAN&model=SD15_LIGHT');
  });

  it('posts a RENDER source as JSON, follows it tile by tile and reads the image back', async () => {
    const script = [
      state({}),
      state({ state: 'LOADING', stage: 'LOADING', tile: 1, attempt: 1, fraction: 0.02, version: 3 }),
      state({ state: 'INFERENCE', stage: 'INFERENCE', tile: 1, attempt: 1, fraction: 0.3, version: 4 }),
      state({ state: 'INFERENCE', stage: 'INFERENCE', tile: 2, attempt: 1, fraction: 0.7, version: 5 }),
      state({ state: 'GUARD', stage: 'GUARD', tile: 2, attempt: 1, fraction: 0.9, version: 6 }),
      state({ state: 'DONE', tile: 2, attempt: 1, fraction: 1, version: 7, verdict: 'ACCEPTED', report: REPORT }),
    ];
    const image = { width: 4, height: 2, rgba: new Float32Array(32).map((_, k) => k / 32) };
    const l = launcher(script, { image });
    const progress: AiPostProgress[] = [];
    const res = await new DesktopAiService(l.native, query).post(render(), (p) => progress.push(p), new AbortController().signal);
    expect(res.report).toEqual(REPORT);
    expect(res.image).toEqual(image);
    const post = l.calls.find((c) => c.method === 'POST')!;
    expect(post.type).toBe('application/json');
    expect(JSON.parse(post.body as string)).toEqual({
      source: { kind: 'RENDER', renderId: '7' },
      settings: SETTINGS,
      prompt: 'a bottle',
      negative: 'changed shape',
      modelKey: 'ZIMAGE_Q4',
      materials: [{ materialId: 1, name: 'Glass', allowsWear: true, locked: false }],
      device: 'cpu',
    });
    // The long poll asks for what is newer than what it has.
    expect(l.calls.filter((c) => c.path.startsWith('/api/ai/post/3?after=')).map((c) => c.path)).toEqual(['/api/ai/post/3?after=1', '/api/ai/post/3?after=3', '/api/ai/post/3?after=4', '/api/ai/post/3?after=5', '/api/ai/post/3?after=6']);
    expect(progress.map((p) => `${p.stage} ${p.tile}/${p.tiles}`)).toEqual(['LOADING 1/2', 'INFERENCE 1/2', 'INFERENCE 2/2', 'GUARD 2/2', 'GUARD 2/2']);
    expect(progress.at(-1)!.fraction).toBe(1);
    // Collected, and forgotten.
    expect(l.calls.some((c) => c.method === 'DELETE' && c.path === '/api/ai/post/3')).toBe(true);
  });

  it('sends an INLINE source as one binary body: the JSON, the image and the passes', async () => {
    const l = launcher([state({ state: 'DONE', renderId: null, verdict: 'ACCEPTED', report: REPORT, version: 2 })]);
    const image = { width: 3, height: 2, rgba: new Float32Array(24).map((_, k) => k / 24) };
    const passes: RenderPasses = { width: 3, height: 2, partId: Uint32Array.from([0, 1, 1, FLOOR_ID, FLOOR_ID, 2]), materialId: Uint32Array.from([0, 1, 1, FLOOR_ID, FLOOR_ID, 3]), depth: Float32Array.from([Infinity, 1, 2, 3, 4, 5]) };
    await new DesktopAiService(l.native, query).post({ ...render(), source: { kind: 'INLINE', image, passes } }, () => undefined, new AbortController().signal);
    const post = l.calls.find((c) => c.method === 'POST')!;
    expect(post.type).toBe('application/octet-stream');
    const bytes = post.body as Uint8Array;
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(new TextDecoder().decode(bytes.subarray(0, 4))).toBe('RPI1');
    const len = v.getUint32(4, true);
    expect(JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + len))).source).toEqual({ kind: 'INLINE' });
    const rest = bytes.slice(8 + len).buffer;
    const img = decodeLinearImage(rest);
    expect(img).toEqual(image);
    const pp = parsePasses(rest.slice(16 + 24 * 4));
    expect([...pp.passes.partId!]).toEqual([...passes.partId!]);
    expect([...pp.passes.materialId!]).toEqual([...passes.materialId!]);
    expect([...pp.passes.depth!]).toEqual([...passes.depth!]);
    expect(pp.passes.normal).toBeUndefined();
    expect(inlineBody('{}', image, passes).length).toBe(8 + 2 + 16 + 96 + 32 + 6 * 4 * 3);
    // Larger than a preview: refused before anything is sent.
    const big = { width: 600, height: 2, rgba: new Float32Array(600 * 2 * 4) };
    await expect(new DesktopAiService(l.native, query).post({ ...render(), source: { kind: 'INLINE', image: big, passes: { width: 600, height: 2 } } }, () => undefined, new AbortController().signal)).rejects.toThrow(/at most 512/);
  });

  it('words a refusal with its reason, and a failure with its code', async () => {
    const refused = launcher([], { refuse: { status: 409, body: { error: 'unavailable', reason: 'MODEL_UNSUPPORTED', message: 'SD15_LIGHT is not one this runtime loads' } } });
    const err = await new DesktopAiService(refused.native, query).post(render(), () => undefined, new AbortController().signal).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AiPostError);
    expect(err).toMatchObject({ code: 'unavailable', reason: 'MODEL_UNSUPPORTED', status: 409, message: 'SD15_LIGHT is not one this runtime loads' });
    const failed = launcher([state({}), state({ state: 'FAILED', error: 'crashed', message: 'the runtime stopped: a DLL it needs is missing', version: 2 })]);
    await expect(new DesktopAiService(failed.native, query).post(render(), () => undefined, new AbortController().signal)).rejects.toMatchObject({ code: 'crashed', message: 'the runtime stopped: a DLL it needs is missing' });
  });

  it('a cancel stops the launcher’s post and is heard as an abort', async () => {
    const forever = [state({}), state({ state: 'INFERENCE', stage: 'INFERENCE', tile: 1, attempt: 1, fraction: 0.2, version: 2 })];
    const l = launcher(forever);
    const abort = new AbortController();
    let n = 0;
    const done = new DesktopAiService(l.native, query).post(render(), () => {
      if (++n === 3) abort.abort();
    }, abort.signal);
    await expect(done).rejects.toMatchObject({ name: 'AbortError' });
    expect(l.calls.some((c) => c.method === 'DELETE' && c.path === '/api/ai/post/3')).toBe(true);
    expect(l.calls.some((c) => c.path.endsWith('/image'))).toBe(false);
  });
});

describe('the AI image of a RENDER source is written as the engine’s file (X3c)', () => {
  // Sums of 3 samples: opaque pixels, a half-covered one, an empty one, bright and dark ones.
  const sums = new Float32Array([0.9, 0.6, 0.3, 3, 2.4, 1.5, 0.6, 3, 0.3, 0.15, 0.6, 1.5, 0, 0, 0, 0, 12, 9, 6, 3, 0.002, 0.001, 0.0005, 3, 0.4, 0.4, 0.4, 2.99999, 7.5, 0.2, 0.05, 3]);
  const straight = straightOf(sums, 3);

  for (const tonemap of [0, 1, 2, 3, 4]) {
    it(`at 8 and 16 bits it is the engine’s, bit for bit (tone curve ${tonemap})`, () => {
      expect([...straightBytes(straight, 0.5, tonemap)]).toEqual([...exactBytes(sums, 3, 0.5, tonemap)]);
      expect([...straightWords16(straight, -1.25, tonemap)]).toEqual([...exactWords16(sums, 3, -1.25, tonemap)]);
    });
  }

  it('in EXR, opaque pixels are the engine’s bit for bit and the others within a rounding', () => {
    const exr = straightExr(straight, 0.75);
    const ref = linearRgba(sums, 3, 0.75);
    for (let p = 0; p < sums.length / 4; p++) {
      const opaque = ref[p * 4 + 3] === 1;
      for (let c = 0; c < 4; c++) {
        if (opaque) expect(exr[p * 4 + c], `pixel ${p}`).toBe(ref[p * 4 + c]);
        else expect(Math.abs(exr[p * 4 + c] - ref[p * 4 + c])).toBeLessThanOrEqual(Math.abs(ref[p * 4 + c]) * 2.5e-7);
      }
    }
  });

  it('the straight image is the launcher’s linear_of: colour over coverage where it is not opaque', () => {
    expect(straight[3]).toBe(1);
    expect(straight[12 + 3]).toBe(0);
    expect(straight[4 * 2 + 3]).toBe(Math.fround(1.5 * Math.fround(1 / 3)));
    expect(straight[4 * 6 + 3]).toBeLessThan(1);
    // Every pass round trips through the launcher's file format too.
    const passes: RenderPasses = { width: 2, height: 1, normal: Float32Array.from([0, 0, 1, 1, 0, 0]), coc: Float32Array.from([0, 3.5]) };
    const pp = parsePasses(encodePasses(passes, 9, 4).buffer as ArrayBuffer);
    expect(pp.id).toBe(9);
    expect(pp.samples).toBe(4);
    expect([...pp.passes.normal!]).toEqual([0, 0, 1, 1, 0, 0]);
    expect([...pp.passes.coc!]).toEqual([0, 3.5]);
    expect(() => encodePasses({ width: 3, height: 1, depth: new Float32Array(2) })).toThrow(/depth/);
  });
});
