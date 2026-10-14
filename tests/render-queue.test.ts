// The queue at work (phase U5): Render runs only its job, Start queue runs them all in order, Pause
// and Stop, a removed job stops, frame sequences, names, results, and no engine means no render.
// The engine, the files and the history are fakes; the store and the commands are the real ones.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { totalDuration } from '../src/core/animation';
import { createStore } from '../src/core/store';
import { memoryResultsStore } from '../src/io/results';
import * as cmd from '../src/ui/commands';
import type { AppServices, FrameRequest, FrameResult } from '../src/ui/ports';
import type { Ctx } from '../src/ui/reactive';
import { jobFileNames, queueSettled } from '../src/ui/render-queue';
import { queueButton } from '../src/ui/panels/queue';
import { NativeEngine } from '../src/render/native';
import { LauncherMock } from './launcher-mock';
import { setLang } from '../src/ui/strings';
import { createUiStore } from '../src/ui/ui-state';
import { exampleState } from './helpers';

interface Fake {
  ctx: Ctx;
  requests: FrameRequest[];
  saved: string[];
  /** Holds every render until `release()` (for pause and stop). */
  hold: boolean;
  release(): void;
  fail: string | null;
}

function makeCtx(): Fake {
  const results = memoryResultsStore();
  let waiters: (() => void)[] = [];
  const fake: Fake = {
    ctx: null as unknown as Ctx,
    requests: [],
    saved: [],
    hold: false,
    release: () => {
      const w = waiters;
      waiters = [];
      w.forEach((fn) => fn());
    },
    fail: null,
  };
  const services = {
    viewport: null,
    renderImage: async () => new Blob(),
    async renderFrame(req: FrameRequest): Promise<FrameResult> {
      fake.requests.push(req);
      if (fake.fail) throw new Error(fake.fail);
      if (fake.hold) {
        await new Promise<void>((resolve, reject) => {
          waiters.push(resolve);
          req.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        });
      }
      req.onProgress?.(0.5, 2, 0.1);
      return { file: new Blob([new Uint8Array(10)]), display: null, width: req.width, height: req.height, samples: 4, seconds: 0.25 };
    },
    results: {
      persistent: async () => results.persistent,
      list: () => results.list(),
      add: (m, f, d) => results.add(m, f, d),
      get: (id) => results.get(id),
      remove: (id) => results.remove(id),
      clear: () => results.clear(),
    },
    files: {
      canChooseFolder: false,
      canOpenFolder: false,
      chooseFolder: async () => null,
      ensureAccess: async () => false,
      save: async (_dest, name) => {
        fake.saved.push(name);
        return 'DOWNLOAD' as const;
      },
      openFolder: async () => {},
    },
  } as Partial<AppServices> as AppServices;
  const store = createStore(exampleState());
  store.dispatch({ type: 'meta/rename', name: 'Bottle' });
  fake.ctx = { store, ui: createUiStore(), services };
  return fake;
}

const tick = () => new Promise((r) => setTimeout(r, 0));
const statuses = (f: Fake) => f.ctx.store.get().render.queue.map((j) => j.status);

afterEach(() => setLang('en'));

describe('Render and + Add to queue', () => {
  it('Render puts the job first, starts it now and renders only it; the window closes', async () => {
    const f = makeCtx();
    const { ctx } = f;
    cmd.openRenderWindow(ctx);
    await cmd.addToQueueFromWindow(ctx); // waits
    await cmd.addToQueueFromWindow(ctx); // waits
    expect(ctx.ui.get().renderWindow).not.toBeNull();
    expect(ctx.ui.get().toasts.map((x) => x.text)).toEqual(['Added to queue · 1 job', 'Added to queue · 2 jobs']);
    ctx.store.dispatch({ type: 'render/set', patch: { width: 800, height: 600 } });
    await cmd.renderFromWindow(ctx);
    expect(ctx.ui.get().renderWindow).toBeNull();
    await queueSettled(ctx);
    const q = ctx.store.get().render.queue;
    expect(q.map((j) => [j.seq, j.settings.width, j.status])).toEqual([
      [3, 800, 'DONE'],
      [1, 1920, 'QUEUED'],
      [2, 1920, 'QUEUED'],
    ]);
    // Always the path tracer's frame request, with the job's settings and camera.
    expect(f.requests).toHaveLength(1);
    expect(f.requests[0]).toMatchObject({ width: 800, height: 600, finishBy: 'SAMPLES', maxSamples: 256, format: 'PNG', bitDepth: 8, dpi: 300, camera: 'cam1' });
    expect(f.saved).toEqual(['Bottle_Camera 1_0003.png']);
    // The result is in the history and the job, and opens when done.
    const [r] = ctx.ui.get().results;
    expect([r.name, r.width, r.height, r.samples, r.dpi, r.jobId]).toEqual(['Bottle_Camera 1_0003.png', 800, 600, 4, 300, q[0].id]);
    expect(q[0].resultIds).toEqual([r.id]);
    expect(ctx.ui.get().resultView?.id).toBe(r.id);
    expect(ctx.store.get().render.running).toBeNull();
    // Progress ticks never reached the undo history: Rename, Add, Add, Size, Add (newest first).
    expect(ctx.store.history().undo).toEqual(['Add to queue', 'render/set', 'Add to queue', 'Add to queue', 'meta/rename']);
  });

  it('saves the image before denoise next to the render when the engine hands it back (E5b-1)', async () => {
    const f = makeCtx();
    const { ctx } = f;
    const plain = ctx.services.renderFrame;
    ctx.services.renderFrame = async (req) => ({ ...(await plain(req)), denoised: true, noisyFile: new Blob([new Uint8Array(3)]) });
    ctx.store.dispatch({ type: 'render/set', patch: { advanced: { ...ctx.store.get().render.advanced, saveNoisy: true } } });
    await cmd.renderFromWindow(ctx);
    await queueSettled(ctx);
    expect(f.requests[0].advanced).toMatchObject({ denoise: 'BOTH', saveNoisy: true });
    expect(f.saved).toEqual(['Bottle_Camera 1_0001.png', 'Bottle_Camera 1_0001-noisy.png']);
    // The history keeps the render (the denoised image) only.
    expect(ctx.ui.get().results.map((r) => r.name)).toEqual(['Bottle_Camera 1_0001.png']);
  });

  it('Start queue renders every waiting job in order', async () => {
    const f = makeCtx();
    const { ctx } = f;
    for (const w of [640, 800, 1024]) {
      ctx.store.dispatch({ type: 'render/set', patch: { width: w, height: 480 } });
      cmd.enqueue(ctx);
    }
    cmd.toggleQueue(ctx);
    expect(ctx.ui.get().queueRun).toBe('ALL');
    await queueSettled(ctx);
    expect(f.requests.map((r) => r.width)).toEqual([640, 800, 1024]);
    expect(statuses(f)).toEqual(['DONE', 'DONE', 'DONE']);
    expect(ctx.ui.get().queueRun).toBe('IDLE');
  });

  it('All cameras renders one job per camera', async () => {
    const f = makeCtx();
    const { ctx } = f;
    const s = ctx.store.get();
    ctx.store.reset({ ...s, camera: { ...s.camera, cameras: { ...s.camera.cameras, cam2: { ...s.camera.cameras.cam1, id: 'cam2', name: 'Top' } } } });
    ctx.store.dispatch({ type: 'render/set', patch: { camera: { kind: 'ALL' } } });
    await cmd.renderNow(ctx);
    await queueSettled(ctx);
    expect(f.requests.map((r) => r.camera)).toEqual(['cam1', 'cam2']);
    expect(f.saved).toEqual(['Bottle_Camera 1_0001.png', 'Bottle_Top_0002.png']);
  });

  it('Pause stops now and the job waits again; Stop cancels it; removing it stops its render', async () => {
    const f = makeCtx();
    const { ctx } = f;
    f.hold = true;
    cmd.enqueue(ctx);
    cmd.enqueue(ctx);
    cmd.toggleQueue(ctx);
    await tick();
    expect(statuses(f)).toEqual(['RUNNING', 'QUEUED']);
    cmd.toggleQueue(ctx); // Pause
    await queueSettled(ctx);
    expect(statuses(f)).toEqual(['QUEUED', 'QUEUED']);
    expect(ctx.store.get().render.queue[0].progress).toBe(0);
    // Stop: this job is cancelled, the queue goes on to the next.
    cmd.toggleQueue(ctx);
    await tick();
    cmd.stopJob(ctx, ctx.store.get().render.queue[0].id);
    await tick();
    expect(statuses(f)[0]).toBe('CANCELLED');
    expect(statuses(f)[1]).toBe('RUNNING');
    // Removing the running job (or undoing its Add) stops its render.
    cmd.removeJob(ctx, ctx.store.get().render.queue[1].id);
    await queueSettled(ctx);
    expect(statuses(f)).toEqual(['CANCELLED']);
    expect(ctx.store.get().render.running).toBeNull();
    expect(f.saved).toEqual([]);
  });

  it('without the engine the job fails with the reason; nothing is saved', async () => {
    const f = makeCtx();
    f.fail = 'Render needs the engine';
    await cmd.renderNow(f.ctx);
    await queueSettled(f.ctx);
    const [job] = f.ctx.store.get().render.queue;
    expect([job.status, job.error]).toEqual(['FAILED', 'Render needs the engine']);
    expect(f.saved).toEqual([]);
    expect(f.ctx.ui.get().toasts.at(-1)?.text).toBe('Render failed: Render needs the engine');
  });
});

describe('frame sequences', () => {
  it('one job renders every frame of the range at its instant, named …_0001.png and on', async () => {
    const f = makeCtx();
    const { ctx } = f;
    ctx.store.dispatch({ type: 'anim/preset', key: 'HERO' });
    const seconds = totalDuration(ctx.store.get());
    expect(seconds).toBeGreaterThan(0);
    ctx.store.dispatch({ type: 'render/set', patch: { mode: 'ANIMATION', name: '{project}_{camera}', animation: { ...ctx.store.get().render.animation, range: 'RANGE', from: 1, to: 5, fps: 25 } } });
    const job = (cmd.enqueue(ctx), ctx.store.get().render.queue[0]);
    expect(jobFileNames(ctx.store.get(), job)).toEqual(['Bottle_Camera 1_0001.png', 'Bottle_Camera 1_0002.png', 'Bottle_Camera 1_0003.png', 'Bottle_Camera 1_0004.png', 'Bottle_Camera 1_0005.png']);
    cmd.toggleQueue(ctx);
    await queueSettled(ctx);
    expect(f.saved).toEqual(jobFileNames(ctx.store.get(), job));
    // The instant of each frame, and the camera track (no camera named).
    expect(f.requests.map((r) => r.time)).toEqual([0, 0.04, 0.08, 0.12, 0.16]);
    expect(f.requests.every((r) => r.camera === undefined)).toBe(true);
    const done = ctx.store.get().render.queue[0];
    expect([done.status, done.frames, done.frame, done.resultIds.length]).toEqual(['DONE', 5, 5, 1]);
    // The history keeps the first frame, with the frame count.
    expect(ctx.ui.get().results.map((r) => [r.name, r.frame, r.frames])).toEqual([['Bottle_Camera 1_0001.png', 1, 5]]);
  });

  it('All renders every frame of the timeline; {n} in the template is the frame number', async () => {
    const f = makeCtx();
    const { ctx } = f;
    ctx.store.dispatch({ type: 'anim/preset', key: 'HERO' });
    const frames = Math.round(totalDuration(ctx.store.get()) * 24);
    ctx.store.dispatch({ type: 'render/set', patch: { mode: 'ANIMATION', name: 'shot-{n}', format: 'JPEG' } });
    cmd.enqueue(ctx);
    cmd.toggleQueue(ctx);
    await queueSettled(ctx);
    expect(f.saved).toHaveLength(frames);
    expect(f.saved[0]).toBe('shot-0001.jpg');
    expect(f.saved[frames - 1]).toBe(`shot-${String(frames).padStart(4, '0')}.jpg`);
    expect(f.requests[frames - 1].time).toBeCloseTo((frames - 1) / 24, 10);
  });
});

// ------------------------------------------------------------------ phase P3a: Pause, Resume, Start queue

describe('Pause and Resume', () => {
  it('the button says Pause while it runs, Resume after a Pause, Start queue otherwise', async () => {
    expect(queueButton('IDLE', false)).toMatchObject({ state: 'START', label: 'queue.start', disabled: true });
    expect(queueButton('IDLE', true)).toMatchObject({ state: 'START', label: 'queue.start', icon: 'play', disabled: false });
    expect(queueButton('ALL', true)).toMatchObject({ state: 'PAUSE', label: 'queue.pause', icon: 'pause', disabled: false });
    expect(queueButton('ONLY', false)).toMatchObject({ state: 'PAUSE', disabled: false });
    expect(queueButton('PAUSED', true)).toMatchObject({ state: 'RESUME', label: 'queue.resume', tip: 'queue.resumeTip', disabled: false });
    // Paused with nothing left to resume: Start queue, disabled.
    expect(queueButton('PAUSED', false)).toMatchObject({ state: 'START', disabled: true });
    // The drawer follows the runner.
    const f = makeCtx();
    const { ctx } = f;
    f.hold = true;
    cmd.enqueue(ctx);
    cmd.enqueue(ctx);
    cmd.toggleQueue(ctx);
    expect(ctx.ui.get().queueRun).toBe('ALL');
    await tick();
    cmd.toggleQueue(ctx);
    expect(ctx.ui.get().queueRun).toBe('PAUSED');
    await queueSettled(ctx);
    expect(ctx.ui.get().queueRun).toBe('PAUSED');
    expect(statuses(f)).toEqual(['QUEUED', 'QUEUED']);
    cmd.toggleQueue(ctx);
    expect(ctx.ui.get().queueRun).toBe('ALL');
    await tick();
    expect(statuses(f)).toEqual(['RUNNING', 'QUEUED']);
    f.hold = false;
    f.release();
    await queueSettled(ctx);
    expect(statuses(f)).toEqual(['DONE', 'DONE']);
    expect(ctx.ui.get().queueRun).toBe('IDLE');
  });

  it('Pause and then Resume at once is not lost while the stopped job winds down', async () => {
    const f = makeCtx();
    const { ctx } = f;
    f.hold = true;
    cmd.enqueue(ctx);
    cmd.enqueue(ctx);
    cmd.toggleQueue(ctx);
    await tick();
    expect(statuses(f)).toEqual(['RUNNING', 'QUEUED']);
    cmd.toggleQueue(ctx); // Pause
    cmd.toggleQueue(ctx); // Resume, before the paused job has even let go
    await tick();
    await tick();
    expect(ctx.ui.get().queueRun).toBe('ALL');
    expect(statuses(f)).toEqual(['RUNNING', 'QUEUED']);
    expect(f.requests).toHaveLength(2);
    f.hold = false;
    f.release();
    await queueSettled(ctx);
    expect(statuses(f)).toEqual(['DONE', 'DONE']);
  });

  it('Resume after pausing a Render goes on with just that job; Render after a Pause renders just its own', async () => {
    const f = makeCtx();
    const { ctx } = f;
    f.hold = true;
    cmd.enqueue(ctx); // waits, not started
    await cmd.renderNow(ctx); // Render: first, and only it runs
    await tick();
    const [rendered, waiting] = ctx.store.get().render.queue;
    expect([rendered.status, waiting.status]).toEqual(['RUNNING', 'QUEUED']);
    cmd.toggleQueue(ctx); // Pause
    await queueSettled(ctx);
    cmd.toggleQueue(ctx); // Resume: the Render's job, not the whole queue
    expect(ctx.ui.get().queueRun).toBe('ONLY');
    f.hold = false;
    f.release();
    await queueSettled(ctx);
    expect(ctx.store.get().render.queue.map((j) => j.status)).toEqual(['DONE', 'QUEUED']);
    // Pause the whole queue, then Render something new: that one renders, the paused one keeps waiting.
    f.hold = true;
    cmd.toggleQueue(ctx);
    await tick();
    cmd.toggleQueue(ctx); // Pause
    await queueSettled(ctx);
    f.hold = false;
    await cmd.renderNow(ctx);
    await queueSettled(ctx);
    expect(ctx.store.get().render.queue.map((j) => j.status)).toEqual(['DONE', 'DONE', 'QUEUED']);
    expect(ctx.ui.get().queueRun).toBe('IDLE');
  });

  it('with the native engine and a launcher that never answers, Pause stops at once and Resume renders again', async () => {
    // The real engine of the desktop (render/native.ts) instead of a fake that always lets go: the mock was more
    // permissive than reality, which is how a Pause that could not reach the launcher went unseen.
    const launcher = new LauncherMock();
    launcher.hangPolls = true;
    const source = { build: () => ({ meshKey: 'm', bytes: () => new Uint8Array([1, 4, 0, 3, 0, 1]) }), tone: () => ({ exposureEv: 0, tonemap: 1 }) };
    const engine = new NativeEngine({ request: launcher.request }, source, { threads: 8, isa: 'avx2' });
    const f = makeCtx();
    const { ctx } = f;
    engine.sync(ctx.store.get(), null);
    ctx.services.renderFrame = async (req: FrameRequest): Promise<FrameResult> => {
      f.requests.push(req);
      const px = await engine.renderPixels({ width: 4, height: 3, maxSamples: 4, maxSeconds: 0, transparent: false, ...(req.signal ? { signal: req.signal } : {}) });
      return { file: new Blob([new Uint8Array(4)]), display: null, width: px.width, height: px.height, samples: px.samples, seconds: px.seconds };
    };
    cmd.enqueue(ctx);
    cmd.toggleQueue(ctx);
    await vi.waitFor(() => expect(launcher.log.some((l) => l.startsWith('GET /api/render/'))).toBe(true));
    expect(statuses(f)).toEqual(['RUNNING']);
    const t0 = performance.now();
    cmd.toggleQueue(ctx); // Pause
    await queueSettled(ctx);
    expect(performance.now() - t0).toBeLessThan(500);
    expect(statuses(f)).toEqual(['QUEUED']);
    expect(ctx.ui.get().queueRun).toBe('PAUSED');
    expect(launcher.log.some((l) => l.startsWith('DELETE /api/render/'))).toBe(true);
    // The launcher answers again: Resume renders the job to the end.
    launcher.hangPolls = false;
    launcher.pollMs = 1;
    cmd.toggleQueue(ctx);
    await queueSettled(ctx);
    expect(statuses(f)).toEqual(['DONE']);
    expect(launcher.queued).toBe(0);
  });
});
