// The AI step of a render job and what it leaves in the history (phase X4, AI-POST.md §4): the engine’s image is
// saved first and always; the AI image is saved next to it with its report and kept in the history as the
// result’s second image; whatever goes wrong with the AI leaves the engine’s image as the whole result. The
// engine, the files, the history and the AI port are fakes; the store, the commands and the synthetic service
// are the real ones.

import { afterEach, describe, expect, it } from 'vitest';
import { createSyntheticService } from '../src/ai/synthetic';
import { notBuiltService } from '../src/ai/not-built';
import type { AiPostRequest, AiPostService, LinearImage } from '../src/core/ai';
import { AI_PERCENT_KEYS, DEFAULT_AI } from '../src/core/render';
import { evictionPlan, type ResultMeta } from '../src/core/results';
import { createStore } from '../src/core/store';
import { memoryResultsStore } from '../src/io/results';
import * as cmd from '../src/ui/commands';
import type { AiEncodeOptions, AiPort, AppServices, FrameRequest, FrameResult } from '../src/ui/ports';
import type { Ctx } from '../src/ui/reactive';
import { pauseQueue, queueSettled, startQueue } from '../src/ui/render-queue';
import { aiStatusText } from '../src/ui/panels/queue';
import { setLang } from '../src/ui/strings';
import { createUiStore } from '../src/ui/ui-state';
import { exampleState } from './helpers';

const W = 16;
const H = 16;

interface Fake {
  ctx: Ctx;
  saved: { name: string; size: number }[];
  requests: FrameRequest[];
  posts: number;
  encodeFails: boolean;
  /** The pipeline is held until abort (for the stop test). */
  hold: boolean;
  /** The service takes the RENDER source (the desktop launcher's), and the renders have an id. */
  renderSource: boolean;
  /** What the pipeline was asked, and how the AI image was encoded. */
  asked: AiPostRequest[];
  encoded: AiEncodeOptions[];
  decodes: number;
}

function port(f: Fake, service: AiPostService): AiPort {
  const counted: AiPostService = {
    status: () => service.status(),
    post: (...a) => {
      f.posts++;
      if (f.hold) return new Promise((_r, reject) => a[2].addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
      return service.post(...a);
    },
  };
  return {
    service: counted,
    frame: async () => {
      throw new Error('the job does not draw a preview');
    },
    passes: async ({ width, height }) => ({ width, height, partId: new Uint32Array(width * height).fill(1), materialId: new Uint32Array(width * height).fill(1) }),
    decode: async (): Promise<LinearImage> => {
      f.decodes++;
      return { width: W, height: H, rgba: new Float32Array(W * H * 4).map((_v, i) => (i % 4 === 3 ? 1 : 0.2 + (i % 7) * 0.05)) };
    },
    encode: async (img, o) => {
      f.encoded.push(o);
      if (f.encodeFails) throw new Error('the encoder broke');
      return new Blob([new Uint8Array(img.width * img.height * 3)]);
    },
    scenePrompt: () => ({ prompt: 'a bottle', negative: 'no changes to shapes' }),
    materials: () => [{ materialId: 1, name: 'Glass', allowsWear: true, locked: false }],
    renderSource: async () => f.renderSource,
  };
}

/** The launcher's service as the queue sees it: it takes RENDER, reports per tile, and gives back the render's light. */
function launcherLike(f: Fake, tiles = 3): AiPostService {
  return {
    status: async () => ({ available: true, backend: 'CPU', device: 'Fake CPU', supports: ['ZIMAGE_Q4'], activeModel: 'ZIMAGE_Q4' }),
    post: async (req, onProgress, signal) => {
      f.asked.push(req);
      for (let tile = 1; tile <= tiles; tile++) {
        if (signal.aborted) throw new DOMException('aborted', 'AbortError');
        onProgress({ stage: tile === 1 ? 'LOADING' : 'INFERENCE', tile, tiles, attempt: 1, fraction: tile / (tiles + 1) });
        await new Promise((r) => setTimeout(r, 1));
        onProgress({ stage: 'INFERENCE', tile, tiles, attempt: 1, fraction: (tile + 0.5) / (tiles + 1) });
      }
      onProgress({ stage: 'GUARD', tile: tiles, tiles, attempt: 1, fraction: 0.95 });
      return {
        image: { width: W, height: H, rgba: new Float32Array(W * H * 4).fill(0.5) },
        report: { verdict: 'ACCEPTED', usedFraction: 1, attempts: 1, size: { ok: true, value: 1, limit: 1 }, outside: { ok: true, value: 0, limit: 0 }, edges: { ok: true, value: 0, limit: 1.5 }, detail: { ok: true, value: 1, limit: 0.98 }, focus: { ok: true, value: 0, limit: 0.15 }, materials: [], modelKey: 'ZIMAGE_Q4', runtime: 'SDCPP_LINUX_CPU', seed: req.settings.seed, seconds: 1 },
      };
    },
  };
}

function makeCtx(service: AiPostService | null): Fake {
  const results = memoryResultsStore();
  const f: Fake = { ctx: null as unknown as Ctx, saved: [], requests: [], posts: 0, encodeFails: false, hold: false, renderSource: false, asked: [], encoded: [], decodes: 0 };
  const services = {
    viewport: null,
    renderImage: async () => new Blob(),
    async renderFrame(req: FrameRequest): Promise<FrameResult> {
      f.requests.push(req);
      const kept = req.aiPasses && f.renderSource ? { renderId: '41' } : {};
      return { file: new Blob([new Uint8Array(100)]), display: null, width: req.width, height: req.height, samples: 4, seconds: 0.25, tone: { exposureEv: -0.5, tonemap: 3 }, ...kept };
    },
    results: {
      persistent: async () => results.persistent,
      list: () => results.list(),
      add: (m: ResultMeta, file: Blob, display: Blob | null, ai?: Blob | null) => results.add(m, file, display, ai),
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
    ai: null as AiPort | null,
  } as Partial<AppServices> as AppServices;
  const store = createStore(exampleState());
  store.dispatch({ type: 'meta/rename', name: 'Bottle' });
  // A tiny job: the fake decodes to the job's own size, as a real decode does.
  store.dispatch({ type: 'render/set', patch: { width: W, height: H } });
  f.ctx = { store, ui: createUiStore(), services };
  if (service) (services as { ai: AiPort | null }).ai = port(f, service);
  return f;
}

const withAi = (f: Fake, patch: Partial<typeof DEFAULT_AI> = {}) => f.ctx.store.dispatch({ type: 'render/set', patch: { ai: { ...f.ctx.store.get().render.ai, enabled: true, ...patch } } });
const toasts = (f: Fake) => f.ctx.ui.get().toasts.map((x) => x.text);

afterEach(() => setLang('en'));

describe('a job with AI post-processing', () => {
  it('saves the engine’s image and, next to it, the AI’s; the history keeps both with the report', async () => {
    const f = makeCtx(createSyntheticService());
    withAi(f, { light: 80 });
    await cmd.renderNow(f.ctx);
    await queueSettled(f.ctx);
    expect(f.saved.map((s) => s.name)).toEqual(['Bottle_Camera 1_0001.png', 'Bottle_Camera 1_0001_AI.png']);
    expect(f.saved[0].size).toBe(100);
    expect(f.saved[1].size).toBe(W * H * 3);
    expect(f.posts).toBe(1);
    const [r] = f.ctx.ui.get().results;
    expect(r.ai).toMatchObject({ name: 'Bottle_Camera 1_0001_AI.png', bytes: W * H * 3 });
    expect(r.ai!.report).toMatchObject({ verdict: 'ACCEPTED', modelKey: 'SYNTHETIC', runtime: 'synthetic', attempts: 1 });
    expect(r.bytes).toBe(100 + W * H * 3);
    const blobs = await f.ctx.services.results.get(r.id);
    expect(blobs?.file.size).toBe(100);
    expect(blobs?.ai?.size).toBe(W * H * 3);
    expect(f.ctx.store.get().render.queue[0].status).toBe('DONE');
  });

  it('copies the job’s AI settings, not the window’s at the time it runs', async () => {
    const f = makeCtx(createSyntheticService());
    withAi(f, { style: 'WARM', seed: 77 });
    cmd.enqueue(f.ctx);
    // The window changes afterwards; the queued job keeps what it was made with.
    f.ctx.store.dispatch({ type: 'render/set', patch: { ai: { ...f.ctx.store.get().render.ai, enabled: false, seed: 1 } } });
    cmd.toggleQueue(f.ctx);
    await queueSettled(f.ctx);
    expect(f.posts).toBe(1);
    expect(f.ctx.ui.get().results[0].ai!.report.seed).toBe(77);
  });

  it('with the AI off nothing is asked of it and the result has one image', async () => {
    const f = makeCtx(createSyntheticService());
    await cmd.renderNow(f.ctx);
    await queueSettled(f.ctx);
    expect(f.posts).toBe(0);
    expect(f.saved.map((s) => s.name)).toEqual(['Bottle_Camera 1_0001.png']);
    expect(f.ctx.ui.get().results[0].ai).toBeUndefined();
    expect((await f.ctx.services.results.get(f.ctx.ui.get().results[0].id))?.ai).toBeUndefined();
  });

  it('Intervention 0 gives the same picture, and the report says it checked nothing was lost', async () => {
    const f = makeCtx(createSyntheticService());
    withAi(f, { intervention: 0 });
    await cmd.renderNow(f.ctx);
    await queueSettled(f.ctx);
    expect(f.ctx.ui.get().results[0].ai!.report).toMatchObject({ verdict: 'ACCEPTED', usedFraction: 1 });
  });

  it('a build without the pipeline says so, saves the engine’s image and finishes the job', async () => {
    const f = makeCtx(notBuiltService);
    withAi(f);
    await cmd.renderNow(f.ctx);
    await queueSettled(f.ctx);
    expect(f.posts).toBe(0);
    expect(f.saved.map((s) => s.name)).toEqual(['Bottle_Camera 1_0001.png']);
    expect(toasts(f).some((t) => t.startsWith('AI post-processing did not run: This version has no AI pipeline yet'))).toBe(true);
    expect(f.ctx.store.get().render.queue[0].status).toBe('DONE');
    expect(f.ctx.ui.get().results[0].ai).toBeUndefined();
  });

  it('without an AI port at all the render is the engine’s alone', async () => {
    const f = makeCtx(null);
    withAi(f);
    await cmd.renderNow(f.ctx);
    await queueSettled(f.ctx);
    expect(f.saved.map((s) => s.name)).toEqual(['Bottle_Camera 1_0001.png']);
    expect(f.ctx.store.get().render.queue[0].status).toBe('DONE');
  });

  it('a result the guard rejects keeps its report and no second image: the engine’s image is the result', async () => {
    const f = makeCtx(createSyntheticService({ limits: { deltaEMean: 1e-9, deltaEP95: 1e-9 } }));
    withAi(f, { intervention: 100, light: 100 });
    await cmd.renderNow(f.ctx);
    await queueSettled(f.ctx);
    expect(f.saved.map((s) => s.name)).toEqual(['Bottle_Camera 1_0001.png']);
    const [r] = f.ctx.ui.get().results;
    expect(r.ai).toMatchObject({ bytes: 0, thumb: '' });
    expect(r.ai!.report.verdict).toBe('REJECTED');
    expect(r.bytes).toBe(100);
    expect((await f.ctx.services.results.get(r.id))?.ai).toBeUndefined();
    expect(toasts(f)).toContain('The AI result was rejected by the guard: the engine image was kept.');
    expect(f.ctx.store.get().render.queue[0].status).toBe('DONE');
  });

  it('a limited result is delivered with how far it was limited', async () => {
    const f = makeCtx(createSyntheticService({ limits: { deltaEMean: 0.9, deltaEP95: 100, detail: -1, focus: 100, edgePx: 100 } }));
    withAi(f, { intervention: 100, light: 100, bounce: 100 });
    await cmd.renderNow(f.ctx);
    await queueSettled(f.ctx);
    const [r] = f.ctx.ui.get().results;
    expect(r.ai!.report.verdict).toBe('LIMITED');
    expect(r.ai!.report.usedFraction).toBeLessThan(1);
    expect(r.ai!.bytes).toBeGreaterThan(0);
  });

  it('an AI that fails does not take the render with it', async () => {
    const f = makeCtx(createSyntheticService());
    f.encodeFails = true;
    withAi(f);
    await cmd.renderNow(f.ctx);
    await queueSettled(f.ctx);
    expect(f.saved.map((s) => s.name)).toEqual(['Bottle_Camera 1_0001.png']);
    expect(toasts(f).some((t) => t.includes('AI post-processing did not run: the encoder broke'))).toBe(true);
    expect(f.ctx.store.get().render.queue[0].status).toBe('DONE');
    expect(f.ctx.ui.get().results[0].ai).toBeUndefined();
  });

  it('stopping the job during the AI step cancels it and keeps the engine’s image in the history', async () => {
    const f = makeCtx(createSyntheticService());
    f.hold = true;
    withAi(f);
    await cmd.renderNow(f.ctx);
    await new Promise((r) => setTimeout(r, 10));
    expect(f.posts).toBe(1);
    cmd.stopJob(f.ctx, f.ctx.store.get().render.queue[0].id);
    await queueSettled(f.ctx);
    const job = f.ctx.store.get().render.queue[0];
    expect(job.status).toBe('CANCELLED');
    expect(f.saved.map((s) => s.name)).toEqual(['Bottle_Camera 1_0001.png']);
    // X3c: the engine's image is the job's result, without a second one; the person is told why.
    const results = f.ctx.ui.get().results;
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ name: 'Bottle_Camera 1_0001.png', bytes: 100 });
    expect(results[0].ai).toBeUndefined();
    expect(job.resultIds).toEqual([results[0].id]);
    expect((await f.ctx.services.results.get(results[0].id))?.file.size).toBe(100);
    expect(toasts(f)).toContain('AI post-processing stopped: the engine image is kept in the history.');
    expect(f.ctx.store.get().render.running).toBeNull();
  });

  it('an animation is rendered without it, whatever the switch says', async () => {
    const f = makeCtx(createSyntheticService());
    withAi(f);
    f.ctx.store.dispatch({ type: 'anim/preset', key: 'HERO' });
    f.ctx.store.dispatch({ type: 'render/set', patch: { mode: 'ANIMATION', name: '{project}_{camera}', animation: { ...f.ctx.store.get().render.animation, range: 'RANGE', from: 1, to: 2, fps: 25 } } });
    await cmd.renderNow(f.ctx);
    await queueSettled(f.ctx);
    expect(f.posts).toBe(0);
    expect(f.saved).toHaveLength(2);
    expect(f.ctx.ui.get().results[0].ai).toBeUndefined();
  });
});

describe('a job with AI on the desktop (X3c): the RENDER source', () => {
  it('asks for the launcher to keep the render, posts its id with the material table, and writes the AI image with the render’s look', async () => {
    const f = makeCtx(null);
    f.renderSource = true;
    (f.ctx.services as { ai: AiPort | null }).ai = port(f, launcherLike(f));
    withAi(f, { light: 80, seed: 9 });
    await cmd.renderNow(f.ctx);
    await queueSettled(f.ctx);
    expect(f.requests[0].aiPasses).toBe(true);
    expect(f.asked).toHaveLength(1);
    expect(f.asked[0].source).toEqual({ kind: 'RENDER', renderId: '41' });
    expect(f.asked[0].materials).toEqual([{ materialId: 1, name: 'Glass', allowsWear: true, locked: false }]);
    expect(f.asked[0].modelKey).toBe('ZIMAGE_Q4');
    expect(f.asked[0].settings).toMatchObject({ light: 80, seed: 9 });
    // The pixels did not travel to the page and back: nothing was decoded for the pipeline.
    expect(f.decodes).toBe(0);
    // Written as the engine's file was: from the render's light, with its exposure and curve.
    expect(f.encoded).toEqual([{ format: 'PNG', bitDepth: 8, jpegQuality: expect.any(Number), dpi: expect.any(Number), transparent: false, tone: { exposureEv: -0.5, tonemap: 3 } }]);
    expect(f.saved.map((s) => s.name)).toEqual(['Bottle_Camera 1_0001.png', 'Bottle_Camera 1_0001_AI.png']);
    const [r] = f.ctx.ui.get().results;
    expect(r.ai!.report).toMatchObject({ verdict: 'ACCEPTED', runtime: 'SDCPP_LINUX_CPU', seed: 9 });
    expect((await f.ctx.services.results.get(r.id))?.ai?.size).toBe(W * H * 3);
    expect(f.ctx.store.get().render.queue[0].status).toBe('DONE');
  });

  it('a service without the RENDER source gets the picture inline, and the render is not asked to keep passes', async () => {
    const f = makeCtx(createSyntheticService());
    withAi(f);
    await cmd.renderNow(f.ctx);
    await queueSettled(f.ctx);
    expect(f.requests[0].aiPasses).toBeUndefined();
    expect(f.decodes).toBe(1);
    expect(f.encoded[0].tone).toBeUndefined();
    expect(f.ctx.ui.get().results[0].ai!.report.verdict).toBe('ACCEPTED');
  });

  it('shows the pipeline’s progress tile by tile while it runs', async () => {
    const f = makeCtx(null);
    f.renderSource = true;
    const seen: string[] = [];
    const svc = launcherLike(f, 3);
    const spy: AiPostService = {
      status: () => svc.status(),
      post: (req, onProgress, signal) =>
        svc.post(
          req,
          (p) => {
            onProgress(p);
            const running = f.ctx.store.get().render.running;
            if (running?.ai) seen.push(`${aiStatusText(running.ai)} @${Math.round(running.progress * 100)}`);
          },
          signal,
        ),
    };
    (f.ctx.services as { ai: AiPort | null }).ai = port(f, spy);
    withAi(f);
    await cmd.renderNow(f.ctx);
    await queueSettled(f.ctx);
    expect(seen[0]).toBe('AI · loading the model @25');
    expect(seen).toContain('AI · tile 2 of 3 @50');
    expect(seen).toContain('AI · tile 3 of 3 @75');
    // Ticks within the same tile are throttled (at most one every 200 ms): the half-way one is not shown.
    expect(seen).not.toContain('AI · tile 3 of 3 @88');
    expect(seen.at(-1)).toBe('AI · checking @95');
    expect(aiStatusText({ stage: 'RETRY', tile: 1, tiles: 4, attempt: 2 })).toBe('AI · tile 1 of 4 · attempt 2');
    setLang('es');
    expect(aiStatusText({ stage: 'INFERENCE', tile: 2, tiles: 4, attempt: 1 })).toBe('IA · mosaico 2 de 4');
  });

  it('Pause during the AI step frees it at once: the job waits again, the engine’s image is kept, and Resume renders it whole', async () => {
    const f = makeCtx(null);
    f.renderSource = true;
    const svc = launcherLike(f, 2);
    (f.ctx.services as { ai: AiPort | null }).ai = port(f, svc);
    f.hold = true;
    withAi(f);
    cmd.enqueue(f.ctx);
    startQueue(f.ctx);
    await new Promise((r) => setTimeout(r, 10));
    expect(f.posts).toBe(1);
    pauseQueue(f.ctx);
    await queueSettled(f.ctx);
    let job = f.ctx.store.get().render.queue[0];
    expect(job.status).toBe('QUEUED');
    expect(f.ctx.ui.get().queueRun).toBe('PAUSED');
    expect(f.ctx.ui.get().results).toHaveLength(1);
    expect(f.ctx.ui.get().results[0].ai).toBeUndefined();
    expect(f.ctx.store.get().render.running).toBeNull();
    // Resume: the job goes on (a render cannot resume halfway: it renders again), now with the AI's image too.
    f.hold = false;
    startQueue(f.ctx);
    await queueSettled(f.ctx);
    job = f.ctx.store.get().render.queue[0];
    expect(job.status).toBe('DONE');
    expect(f.requests).toHaveLength(2);
    const results = f.ctx.ui.get().results;
    expect(results).toHaveLength(2);
    expect(results[0].ai?.report.verdict).toBe('ACCEPTED');
    expect(job.resultIds).toEqual([results[0].id]);
  });
});

describe('saving a result again', () => {
  it('saves either image under its own name', async () => {
    const f = makeCtx(createSyntheticService());
    withAi(f, { light: 80 });
    await cmd.renderNow(f.ctx);
    await queueSettled(f.ctx);
    const [r] = f.ctx.ui.get().results;
    f.saved.length = 0;
    await cmd.saveResultAgain(f.ctx, r.id);
    await cmd.saveResultAgain(f.ctx, r.id, 'AI');
    expect(f.saved).toEqual([
      { name: 'Bottle_Camera 1_0001.png', size: 100 },
      { name: 'Bottle_Camera 1_0001_AI.png', size: W * H * 3 },
    ]);
  });

  it('says the image is gone when the result has no AI image', async () => {
    const f = makeCtx(createSyntheticService());
    await cmd.renderNow(f.ctx);
    await queueSettled(f.ctx);
    const [r] = f.ctx.ui.get().results;
    f.saved.length = 0;
    await cmd.saveResultAgain(f.ctx, r.id, 'AI');
    expect(f.saved).toEqual([]);
    expect(toasts(f).at(-1)).toBe('This image is no longer in the history');
  });
});

describe('the history with a second image', () => {
  const meta = (id: string, createdAt: number): ResultMeta => ({
    id,
    jobId: 'j',
    name: `${id}.png`,
    createdAt,
    width: W,
    height: H,
    dpi: 72,
    samples: 1,
    seconds: 1,
    cameraId: 'cam1',
    camera: 'Camera 1',
    format: 'PNG',
    bitDepth: 8,
    savedTo: { kind: 'DOWNLOADS' },
    thumb: '',
    bytes: 0,
  });

  it('stores it next to the first, counts its bytes, and hands both back', async () => {
    const store = memoryResultsStore();
    await store.add(meta('a', 1), new Blob([new Uint8Array(10)]), null, new Blob([new Uint8Array(7)]));
    await store.add(meta('b', 2), new Blob([new Uint8Array(10)]), new Blob([new Uint8Array(3)]));
    const [b, a] = await store.list();
    expect([a.bytes, b.bytes]).toEqual([17, 13]);
    expect((await store.get('a'))?.ai?.size).toBe(7);
    expect((await store.get('b'))?.ai).toBeUndefined();
    expect((await store.get('b'))?.display?.size).toBe(3);
  });

  it('evicts by the bytes of both images, oldest first', async () => {
    const store = memoryResultsStore({ count: 50, bytes: 30 });
    await store.add(meta('a', 1), new Blob([new Uint8Array(10)]), null, new Blob([new Uint8Array(10)]));
    const gone = await store.add(meta('b', 2), new Blob([new Uint8Array(10)]), null, new Blob([new Uint8Array(10)]));
    expect(gone).toEqual(['a']);
    expect(evictionPlan([{ id: 'x', createdAt: 1, bytes: 20 }, { id: 'y', createdAt: 2, bytes: 20 }], { count: 50, bytes: 30 }, 'y')).toEqual(['x']);
  });

  it('the AI settings take part in the project like every other control', () => {
    expect(AI_PERCENT_KEYS).toEqual(['intervention', 'light', 'bounce', 'wear', 'styleStrength']);
  });
});
