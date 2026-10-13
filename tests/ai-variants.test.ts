// Phase X4b, AI variants: a job with N variants is one render of the engine and N posts of the AI with consecutive
// seeds, each image saved under its own name (`_AI`, `_AI_2`…) with its own report, all kept with the render in the
// history (memory, IndexedDB's record, the launcher's `<id>.ai.<n>.<ext>`; a result of before with a single AI image
// reads as variant 1); stopping in the middle keeps the render and the variants already finished. The queue drives
// the synthetic service, a launcher-like one, and the desktop service against a stand-in launcher; the real launcher
// with the fake runtime is in tests/ai-desktop.test.ts.

import { afterEach, describe, expect, it } from 'vitest';
import { buildPrompt, NEGATIVE_PROMPT } from '../src/ai/prompt';
import { createSyntheticService } from '../src/ai/synthetic';
import type { AiPostRequest, AiPostService, GuardReport, LinearImage } from '../src/core/ai';
import { DEFAULT_SYSTEM_PROMPT, SHORT_SYSTEM_PROMPT } from '../src/core/ai-prompt';
import { emptySnapshot } from '../src/core/models';
import { DEFAULT_AI } from '../src/core/render';
import { aiImagesOf, aiVariantsOf, type ResultMeta } from '../src/core/results';
import { createStore } from '../src/core/store';
import { AI_MODELS } from '../src/data/ai-models';
import { DesktopAiService, encodeLinearImage, type AiPostState } from '../src/io/ai-post';
import { NativeStore } from '../src/io/native-store';
import { blobVariants, launcherResultsStore, memoryResultsStore } from '../src/io/results';
import * as cmd from '../src/ui/commands';
import { aiStatusText } from '../src/ui/panels/queue';
import type { AiPort, AppServices, FrameRequest, FrameResult } from '../src/ui/ports';
import type { Ctx } from '../src/ui/reactive';
import { queueSettled } from '../src/ui/render-queue';
import { setLang } from '../src/ui/strings';
import { createUiStore } from '../src/ui/ui-state';
import { fakeLauncher } from './fake-launcher';
import { exampleState } from './helpers';

const W = 16;
const H = 16;

const REPORT = (seed: number, verdict: GuardReport['verdict'] = 'ACCEPTED'): GuardReport => ({
  verdict,
  usedFraction: verdict === 'REJECTED' ? 0 : 1,
  attempts: verdict === 'REJECTED' ? 4 : 1,
  size: { ok: true, value: 1, limit: 1 },
  outside: { ok: true, value: 0, limit: 0 },
  edges: { ok: verdict !== 'REJECTED', value: 0, limit: 1.5 },
  detail: { ok: true, value: 1, limit: 0.98 },
  focus: { ok: true, value: 0, limit: 0.15 },
  materials: [],
  modelKey: 'ZIMAGE_Q4',
  runtime: 'SDCPP_LINUX_CPU',
  seed,
  seconds: 1,
});

interface Fake {
  ctx: Ctx;
  saved: { name: string; size: number }[];
  renders: FrameRequest[];
  asked: AiPostRequest[];
  decodes: number;
  /** The post that never ends (1-based), to stop the job in the middle. */
  holdAt: number | null;
  /** The post that fails (1-based). */
  failAt: number | null;
  /** Posts the guard rejects (1-based). */
  rejectAt: Set<number>;
}

/** The launcher's service as the queue sees it: it takes RENDER, reports per tile, and gives back the render's light. */
function launcherLike(f: Fake, tiles = 4): AiPostService {
  return {
    status: async () => ({ available: true, backend: 'CPU', device: 'Fake CPU', supports: ['ZIMAGE_Q4'], activeModel: 'ZIMAGE_Q4' }),
    post: async (req, onProgress, signal) => {
      f.asked.push(req);
      const n = f.asked.length;
      if (f.holdAt === n) return new Promise((_r, reject) => signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
      if (f.failAt === n) throw new Error('the runtime stopped');
      for (let tile = 1; tile <= tiles; tile++) {
        onProgress({ stage: 'INFERENCE', tile, tiles, attempt: 1, fraction: tile / (tiles + 1) });
        await new Promise((r) => setTimeout(r, 1));
      }
      // Each variant's picture differs (its seed), as a model's would.
      const rgba = new Float32Array(W * H * 4).fill(0.25 + 0.05 * (req.settings.seed % 8));
      return { image: { width: W, height: H, rgba }, report: REPORT(req.settings.seed, f.rejectAt.has(n) ? 'REJECTED' : 'ACCEPTED') };
    },
  };
}

function makeCtx(service: (f: Fake) => AiPostService, opts: { renderSource?: boolean } = {}): Fake {
  const results = memoryResultsStore();
  const f: Fake = { ctx: null as unknown as Ctx, saved: [], renders: [], asked: [], decodes: 0, holdAt: null, failAt: null, rejectAt: new Set() };
  const store = createStore(exampleState());
  store.dispatch({ type: 'meta/rename', name: 'Bottle' });
  store.dispatch({ type: 'render/set', patch: { width: W, height: H } });
  const ai: AiPort = {
    service: null as unknown as AiPostService,
    frame: async () => {
      throw new Error('no preview here');
    },
    passes: async ({ width, height }) => ({ width, height, partId: new Uint32Array(width * height).fill(1), materialId: new Uint32Array(width * height).fill(1) }),
    decode: async (): Promise<LinearImage> => {
      f.decodes++;
      return { width: W, height: H, rgba: new Float32Array(W * H * 4).map((_v, i) => (i % 4 === 3 ? 1 : 0.2 + (i % 7) * 0.05)) };
    },
    // Each image's bytes are its first channel, so the variants can be told apart in the history.
    encode: async (img) => new Blob([new Uint8Array(img.width * img.height).fill(Math.round(img.rgba[0] * 100))]),
    scenePrompt: (state, settings, context) => buildPrompt(state, settings ?? state.render.ai, context),
    materials: () => [{ materialId: 1, name: 'Glass', allowsWear: true, locked: false }],
    renderSource: async () => opts.renderSource === true,
  };
  const services = {
    viewport: null,
    async renderFrame(req: FrameRequest): Promise<FrameResult> {
      f.renders.push(req);
      const kept = req.aiPasses && opts.renderSource ? { renderId: '41' } : {};
      return { file: new Blob([new Uint8Array(100)]), display: null, width: req.width, height: req.height, samples: 4, seconds: 0.25, tone: { exposureEv: 0, tonemap: 1 }, ...kept };
    },
    results: {
      persistent: async () => results.persistent,
      list: () => results.list(),
      add: (m: ResultMeta, file: Blob, display: Blob | null, a?: Blob | null, more?: readonly (Blob | null)[]) => results.add(m, file, display, a, more),
      get: (id: string) => results.get(id),
      remove: (id: string) => results.remove(id),
      clear: () => results.clear(),
    },
    files: {
      canChooseFolder: false,
      canOpenFolder: false,
      chooseFolder: async () => null,
      ensureAccess: async () => false,
      save: async (_dest: unknown, name: string, blob: Blob) => {
        f.saved.push({ name, size: blob.size });
        return 'DOWNLOAD' as const;
      },
      openFolder: async () => {},
    },
    ai,
  } as Partial<AppServices> as AppServices;
  f.ctx = { store, ui: createUiStore(), services };
  (ai as { service: AiPostService }).service = service(f);
  return f;
}

const withAi = (f: Fake, patch: Partial<typeof DEFAULT_AI> = {}) => f.ctx.store.dispatch({ type: 'render/set', patch: { ai: { ...f.ctx.store.get().render.ai, enabled: true, ...patch } } });
const toasts = (f: Fake) => f.ctx.ui.get().toasts.map((x) => x.text);
const until = async (ok: () => boolean) => {
  for (let i = 0; i < 400 && !ok(); i++) await new Promise((r) => setTimeout(r, 5));
};

afterEach(() => setLang('en'));

describe('a job with N variants', () => {
  it('renders once and posts N times with consecutive seeds; each image is saved under its own name with its report', async () => {
    const f = makeCtx(() => createSyntheticService());
    withAi(f, { light: 80, seed: 41, variants: 3 });
    await cmd.renderNow(f.ctx);
    await queueSettled(f.ctx);
    expect(f.renders).toHaveLength(1);
    expect(f.saved.map((s) => s.name)).toEqual(['Bottle_Camera 1_0001.png', 'Bottle_Camera 1_0001_AI.png', 'Bottle_Camera 1_0001_AI_2.png', 'Bottle_Camera 1_0001_AI_3.png']);
    const [r] = f.ctx.ui.get().results;
    const variants = aiVariantsOf(r);
    expect(variants.map((v) => v.name)).toEqual(['Bottle_Camera 1_0001_AI.png', 'Bottle_Camera 1_0001_AI_2.png', 'Bottle_Camera 1_0001_AI_3.png']);
    expect(variants.map((v) => v.report.seed)).toEqual([41, 42, 43]);
    expect(r.ai!.name).toBe('Bottle_Camera 1_0001_AI.png');
    expect(r.aiMore).toHaveLength(2);
    // The history keeps the render and the three images; its bytes count all of them.
    const blobs = await f.ctx.services.results.get(r.id);
    expect(blobVariants(blobs!).map((b) => b?.size)).toEqual([W * H, W * H, W * H]);
    expect(r.bytes).toBe(100 + 3 * W * H);
    expect(f.ctx.store.get().render.queue[0].status).toBe('DONE');
    // The decoded picture is decoded once for all three (INLINE).
    expect(f.decodes).toBe(1);
  });

  it('one variant (the default) is what there was before: one post, `_AI`, no other', async () => {
    const f = makeCtx(launcherLike);
    withAi(f, { seed: 5 });
    await cmd.renderNow(f.ctx);
    await queueSettled(f.ctx);
    expect(f.asked.map((a) => a.settings.seed)).toEqual([5]);
    expect(f.saved.map((s) => s.name)).toEqual(['Bottle_Camera 1_0001.png', 'Bottle_Camera 1_0001_AI.png']);
    expect(f.ctx.ui.get().results[0].aiMore).toBeUndefined();
  });

  it('on the desktop every post takes the same kept render (one render, the model loaded once) and says which variant it is', async () => {
    const f = makeCtx(launcherLike, { renderSource: true });
    const seen: string[] = [];
    withAi(f, { seed: 100, variants: 4 });
    const un = f.ctx.store.subscribe((s) => {
      const ai = s.render.running?.ai;
      if (ai) seen.push(aiStatusText(ai));
    });
    await cmd.renderNow(f.ctx);
    await queueSettled(f.ctx);
    un();
    expect(f.renders).toHaveLength(1);
    expect(f.renders[0].aiPasses).toBe(true);
    expect(f.asked.map((a) => a.source)).toEqual(Array(4).fill({ kind: 'RENDER', renderId: '41' }));
    expect(f.asked.map((a) => a.settings.seed)).toEqual([100, 101, 102, 103]);
    expect(new Set(f.asked.map((a) => a.prompt)).size).toBe(1);
    expect(f.decodes).toBe(0);
    expect(seen).toContain('AI · variant 1 of 4 · tile 1 of 4');
    expect(seen).toContain('AI · variant 2 of 4 · tile 3 of 4');
    expect(seen).toContain('AI · variant 4 of 4 · tile 4 of 4');
    // The job's bar measures the variants as one: the second variant's third tile is past a quarter.
    expect(aiStatusText({ stage: 'RETRY', tile: 1, tiles: 2, attempt: 2, variant: 3, variants: 4 })).toBe('AI · variant 3 of 4 · tile 1 of 2 · attempt 2');
    expect(aiStatusText({ stage: 'LOADING', tile: 0, tiles: 2, attempt: 1, variant: 1, variants: 2 })).toBe('AI · variant 1 of 2 · loading the model');
    setLang('es');
    expect(aiStatusText({ stage: 'INFERENCE', tile: 3, tiles: 4, attempt: 1, variant: 2, variants: 4 })).toBe('IA · variante 2 de 4 · mosaico 3 de 4');
    expect(aiStatusText({ stage: 'GUARD', tile: 4, tiles: 4, attempt: 1, variant: 4, variants: 4 })).toBe('IA · variante 4 de 4 · comprobando');
    setLang('en');
    // The time of the AI on this computer was measured, for the window's estimate.
    expect(f.ctx.ui.get().aiThroughput).toBeGreaterThan(0);
    const [r] = f.ctx.ui.get().results;
    expect(aiImagesOf(r).map((v) => v.variant)).toEqual([1, 2, 3, 4]);
  });

  it('stopping in the middle keeps the render and the variants finished, and cancels the one in flight', async () => {
    const f = makeCtx(launcherLike, { renderSource: true });
    f.holdAt = 3;
    withAi(f, { seed: 10, variants: 4 });
    await cmd.renderNow(f.ctx);
    await until(() => f.asked.length === 3);
    expect(f.asked).toHaveLength(3);
    cmd.stopJob(f.ctx, f.ctx.store.get().render.queue[0].id);
    await queueSettled(f.ctx);
    const job = f.ctx.store.get().render.queue[0];
    expect(job.status).toBe('CANCELLED');
    expect(f.renders).toHaveLength(1);
    expect(f.saved.map((s) => s.name)).toEqual(['Bottle_Camera 1_0001.png', 'Bottle_Camera 1_0001_AI.png', 'Bottle_Camera 1_0001_AI_2.png']);
    const results = f.ctx.ui.get().results;
    expect(results).toHaveLength(1);
    expect(aiVariantsOf(results[0]).map((v) => v.report.seed)).toEqual([10, 11]);
    expect(job.resultIds).toEqual([results[0].id]);
    const blobs = await f.ctx.services.results.get(results[0].id);
    expect(blobVariants(blobs!).map((b) => b?.size)).toEqual([W * H, W * H]);
    expect(toasts(f)).toContain('AI post-processing stopped: the render and the 2 AI images finished are kept in the history.');
    expect(f.ctx.store.get().render.running).toBeNull();
  });

  it('stopping during the first variant keeps the render alone, as before', async () => {
    const f = makeCtx(launcherLike, { renderSource: true });
    f.holdAt = 1;
    withAi(f, { variants: 3 });
    await cmd.renderNow(f.ctx);
    await until(() => f.asked.length === 1);
    cmd.stopJob(f.ctx, f.ctx.store.get().render.queue[0].id);
    await queueSettled(f.ctx);
    expect(f.saved.map((s) => s.name)).toEqual(['Bottle_Camera 1_0001.png']);
    expect(f.ctx.ui.get().results[0].ai).toBeUndefined();
    expect(toasts(f)).toContain('AI post-processing stopped: the engine image is kept in the history.');
  });

  it('a variant the guard rejects keeps its report and no image; the others are saved', async () => {
    const f = makeCtx(launcherLike, { renderSource: true });
    f.rejectAt = new Set([2]);
    withAi(f, { seed: 1, variants: 3 });
    await cmd.renderNow(f.ctx);
    await queueSettled(f.ctx);
    expect(f.saved.map((s) => s.name)).toEqual(['Bottle_Camera 1_0001.png', 'Bottle_Camera 1_0001_AI.png', 'Bottle_Camera 1_0001_AI_3.png']);
    const [r] = f.ctx.ui.get().results;
    expect(aiVariantsOf(r).map((v) => [v.report.verdict, v.bytes > 0])).toEqual([
      ['ACCEPTED', true],
      ['REJECTED', false],
      ['ACCEPTED', true],
    ]);
    expect(aiImagesOf(r).map((v) => v.variant)).toEqual([1, 3]);
    const blobs = await f.ctx.services.results.get(r.id);
    expect(blobVariants(blobs!).map((b) => (b ? b.size : null))).toEqual([W * H, null, W * H]);
    expect(toasts(f)).toContain('The guard rejected AI variant 2 of 3: it has no image of its own.');
    expect(f.ctx.store.get().render.queue[0].status).toBe('DONE');
  });

  it('a variant that fails keeps the render and the variants before it, and says so', async () => {
    const f = makeCtx(launcherLike, { renderSource: true });
    f.failAt = 2;
    withAi(f, { variants: 3 });
    await cmd.renderNow(f.ctx);
    await queueSettled(f.ctx);
    expect(f.asked).toHaveLength(2);
    expect(f.saved.map((s) => s.name)).toEqual(['Bottle_Camera 1_0001.png', 'Bottle_Camera 1_0001_AI.png']);
    expect(aiVariantsOf(f.ctx.ui.get().results[0])).toHaveLength(1);
    expect(toasts(f)).toContain('AI variant 2 of 3 did not run: the runtime stopped. The render and the variants before it were kept.');
    expect(f.ctx.store.get().render.queue[0].status).toBe('DONE');
  });

  it('an animation makes no variants, whatever the number says', async () => {
    const f = makeCtx(() => createSyntheticService());
    withAi(f, { variants: 4 });
    f.ctx.store.dispatch({ type: 'anim/preset', key: 'HERO' });
    f.ctx.store.dispatch({ type: 'render/set', patch: { mode: 'ANIMATION', name: '{project}_{camera}', animation: { ...f.ctx.store.get().render.animation, range: 'RANGE', from: 1, to: 2, fps: 25 } } });
    await cmd.renderNow(f.ctx);
    await queueSettled(f.ctx);
    expect(f.saved).toHaveLength(2);
    expect(f.ctx.ui.get().results[0].ai).toBeUndefined();
  });
});

describe('the words of a job', () => {
  it('reach the model after the system prompt and the scene’s, the negative the fixed one, for every variant', async () => {
    const f = makeCtx(launcherLike, { renderSource: true });
    f.ctx.ui.set({ models: { ...emptySnapshot(AI_MODELS), ready: true, installed: ['ZIMAGE_Q4'] } });
    withAi(f, { variants: 2, userPrompt: 'Late afternoon light, a calm mood' });
    await cmd.renderNow(f.ctx);
    await queueSettled(f.ctx);
    expect(f.asked).toHaveLength(2);
    for (const a of f.asked) {
      expect(a.prompt.startsWith(DEFAULT_SYSTEM_PROMPT)).toBe(true);
      expect(a.prompt.indexOf('Professional product photograph')).toBeGreaterThan(DEFAULT_SYSTEM_PROMPT.length - 1);
      expect(a.prompt.endsWith('Late afternoon light, a calm mood')).toBe(true);
      expect(a.negative).toBe(NEGATIVE_PROMPT);
    }
  });

  it('a model that reads 77 tokens gets the short system prompt and the job’s words are cut first', async () => {
    const f = makeCtx((ff) => ({ ...launcherLike(ff), status: async () => ({ available: true, backend: 'CPU', device: 'Fake CPU', supports: ['SD15_LIGHT'], activeModel: 'SD15_LIGHT' }) }), { renderSource: true });
    f.ctx.ui.set({ models: { ...emptySnapshot(AI_MODELS), ready: true, installed: ['SD15_LIGHT'] } });
    withAi(f, { userPrompt: 'Late afternoon light, a calm mood' });
    await cmd.renderNow(f.ctx);
    await queueSettled(f.ctx);
    expect(f.asked[0].prompt.startsWith(SHORT_SYSTEM_PROMPT)).toBe(true);
    expect(f.asked[0].prompt).not.toContain('afternoon');
    expect(f.asked[0].modelKey).toBe('SD15_LIGHT');
  });

  it('a model without a text prompt does not get the job’s words', async () => {
    const f = makeCtx((ff) => ({ ...launcherLike(ff), status: async () => ({ available: true, backend: 'CPU', device: 'Fake CPU', supports: ['user-mine'], activeModel: 'user-mine' }) }), { renderSource: true });
    f.ctx.ui.set({ models: { ...emptySnapshot(AI_MODELS), ready: true, installed: ['user-mine'], imported: [{ format: 'repackshot-model', schema: 1, key: 'user-mine', name: 'Mine', family: 'z-image', role: 'img2img', quantization: 'Q4', licence: { spdx: 'Apache-2.0', url: 'https://example.com', commercialUse: true }, files: [], capabilities: { strength: true, referenceEdit: false, control: [] }, source: 'x' }] } });
    withAi(f, { userPrompt: 'Late afternoon light' });
    await cmd.renderNow(f.ctx);
    await queueSettled(f.ctx);
    expect(f.asked[0].prompt.startsWith(DEFAULT_SYSTEM_PROMPT)).toBe(true);
    expect(f.asked[0].prompt).not.toContain('afternoon');
  });
});

describe('the desktop service against a stand-in launcher', () => {
  /** A launcher that finishes each post at once, its report with the seed it was asked; it records every request. */
  function launcher() {
    const posts: Record<string, unknown>[] = [];
    let next = 1;
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    const st = (id: number, seed: number): AiPostState => ({ id, state: 'DONE', stage: null, tile: 1, tiles: 1, attempt: 1, maxAttempts: 4, strength: 0.1, step: 1, steps: 1, fraction: 1, seconds: 1, version: 2, calls: 1, renderId: 41, model: 'ZIMAGE_Q4', runtime: 'SDCPP_LINUX_CPU', width: W, height: H, tonemap: 1, exposureEv: 0, verdict: 'ACCEPTED', report: REPORT(seed), error: null, message: null });
    const seeds = new Map<number, number>();
    const request = async (path: string, init: RequestInit = {}): Promise<Response> => {
      const method = init.method ?? 'GET';
      if (path.startsWith('/api/ai/runtime')) return json(200, { available: true, backend: 'CPU', device: 'Fake CPU', supports: ['ZIMAGE_Q4'], activeModel: 'ZIMAGE_Q4' });
      if (method === 'POST' && path === '/api/ai/post') {
        const body = JSON.parse(init.body as string) as { settings: { seed: number } };
        posts.push(body);
        const id = next++;
        seeds.set(id, body.settings.seed);
        return json(202, st(id, body.settings.seed));
      }
      if (method === 'DELETE') return new Response(null, { status: 204 });
      const id = Number(/\/api\/ai\/post\/(\d+)/.exec(path)?.[1]);
      if (path.endsWith('/image')) return new Response(encodeLinearImage({ width: W, height: H, rgba: new Float32Array(W * H * 4).fill(0.5) }) as Uint8Array<ArrayBuffer>, { status: 200 });
      return json(200, st(id, seeds.get(id) ?? 0));
    };
    return { posts, native: { request } };
  }

  it('N variants are N posts of the one kept render, with consecutive seeds, and nothing the launcher does not read', async () => {
    const l = launcher();
    const f = makeCtx(() => new DesktopAiService(l.native, () => ({ force: null, cpu: true, model: 'ZIMAGE_Q4' })), { renderSource: true });
    withAi(f, { seed: 7, variants: 3, userPrompt: 'soft light' });
    await cmd.renderNow(f.ctx);
    await queueSettled(f.ctx);
    expect(f.renders).toHaveLength(1);
    expect(l.posts.map((p) => p.source)).toEqual(Array(3).fill({ kind: 'RENDER', renderId: '41' }));
    expect(l.posts.map((p) => (p.settings as { seed: number }).seed)).toEqual([7, 8, 9]);
    // The launcher reads the controls and the seed; the job's own prompt goes in the prompt, the count nowhere.
    for (const p of l.posts) expect(Object.keys(p.settings as object).sort()).toEqual(['bounce', 'intervention', 'light', 'seed', 'style', 'styleStrength', 'wear']);
    expect(f.saved.map((s) => s.name)).toEqual(['Bottle_Camera 1_0001.png', 'Bottle_Camera 1_0001_AI.png', 'Bottle_Camera 1_0001_AI_2.png', 'Bottle_Camera 1_0001_AI_3.png']);
    expect(aiVariantsOf(f.ctx.ui.get().results[0]).map((v) => v.report.seed)).toEqual([7, 8, 9]);
  });
});

describe('the variants in the history', () => {
  const meta = (id: string, variants: number[]): ResultMeta => {
    const info = (n: number, bytes: number) => ({ name: `${id}_AI${n > 1 ? `_${n}` : ''}.png`, thumb: '', bytes, report: REPORT(n, bytes > 0 ? 'ACCEPTED' : 'REJECTED') });
    const [first, ...more] = variants.map((b, i) => info(i + 1, b));
    return { id, jobId: 'j', name: `${id}.png`, createdAt: 1, width: W, height: H, dpi: 72, samples: 1, seconds: 1, cameraId: 'cam1', camera: 'Camera 1', format: 'PNG', bitDepth: 8, savedTo: { kind: 'DOWNLOADS' }, thumb: '', bytes: 0, ...(first ? { ai: first } : {}), ...(more.length ? { aiMore: more } : {}) };
  };
  const png = (text: string) => new Blob([text], { type: 'image/png' });

  it('in memory: every variant comes back in order, a rejected one as null; the bytes count them all', async () => {
    const store = memoryResultsStore();
    await store.add(meta('a', [3, 0, 3]), png('engine'), null, png('one'), [null, png('333')]);
    const back = await store.get('a');
    expect(await Promise.all(blobVariants(back!).map((b) => b?.text() ?? null))).toEqual(['one', null, '333']);
    expect((await store.list())[0].bytes).toBe(12);
    // One variant (and every result of before) is stored as it was.
    await store.add(meta('b', [3]), png('engine'), null, png('one'));
    expect(await store.get('b')).toEqual({ file: expect.any(Blob), display: null, ai: expect.any(Blob) });
  });

  it('on the desktop: each variant is its own file through `…/ai/<n>`, a result of before reads its single AI image as variant 1', async () => {
    const l = fakeLauncher();
    const store = launcherResultsStore(new NativeStore(l.client), { count: 10, bytes: 1e9 });
    await store.add(meta('v1', [3, 0, 5]), png('engine'), null, png('one'), [null, png('three')]);
    expect(l.calls.filter((c) => c.includes('store/results/v1'))).toEqual(['PUT /api/store/results/v1', 'PUT /api/store/results/v1/ai/1', 'PUT /api/store/results/v1/ai/3', 'PUT /api/store/results/v1/meta']);
    const back = await store.get('v1');
    expect(await Promise.all(blobVariants(back!).map((b) => b?.text() ?? null))).toEqual(['one', null, 'three']);
    // The rejected one is never asked for.
    expect(l.calls.some((c) => c.endsWith('v1/ai/2'))).toBe(false);
    // A result written before X4b: its single AI image went to `…/ai` and comes back as variant 1.
    const put = async (path: string, body: BodyInit, type: string) => expect((await l.client.request(path, { method: 'PUT', body, headers: { 'Content-Type': type } })).status).toBe(204);
    await put('/api/store/results/old?type=image/png', png('engine'), 'image/png');
    await put('/api/store/results/old/ai?type=image/png', png('the-old-one'), 'image/png');
    await put('/api/store/results/old/meta', JSON.stringify(meta('old', [11])), 'application/json');
    const oldBack = await store.get('old');
    expect(await oldBack?.ai?.text()).toBe('the-old-one');
    expect(oldBack?.aiMore).toBeUndefined();
    expect(l.calls).toContain('GET /api/store/results/old/ai/1');
  });

  it('Save this variant and Save all save the images again under their names', async () => {
    const f = makeCtx(launcherLike, { renderSource: true });
    f.rejectAt = new Set([2]);
    withAi(f, { variants: 3 });
    await cmd.renderNow(f.ctx);
    await queueSettled(f.ctx);
    const [r] = f.ctx.ui.get().results;
    f.saved.length = 0;
    await cmd.saveResultAgain(f.ctx, r.id, 'AI', 3);
    expect(f.saved.map((s) => s.name)).toEqual(['Bottle_Camera 1_0001_AI_3.png']);
    f.saved.length = 0;
    await cmd.saveAllVariants(f.ctx, r.id);
    expect(f.saved.map((s) => s.name)).toEqual(['Bottle_Camera 1_0001_AI.png', 'Bottle_Camera 1_0001_AI_3.png']);
    expect(toasts(f).at(-1)).toBe('2 AI images saved');
    // A variant without an image: nothing to save, and the person is told.
    f.saved.length = 0;
    await cmd.saveResultAgain(f.ctx, r.id, 'AI', 2);
    expect(f.saved).toEqual([]);
    expect(toasts(f).at(-1)).toBe('This image is no longer in the history');
  });
});
