// Phase U14: the live view of a queue job. The cadence with a fake clock (core/live-frame.ts), the picture scaled from
// the sums (render/live-frame.ts), the queue's tap (render-queue.ts `liveTap`) and the queue with a fake render that
// delivers frames: the selected job in flight shows them, a finished one opens the results viewer, a waiting one says
// it has not started, and closing the view or choosing another job stops the frames.

import { afterEach, describe, expect, it } from 'vitest';
import { fitFactor, FrameCadence, LIVE_FRAME_MS, LIVE_MAX_BOX, liveBox, type FrameBox, type LiveFrame } from '../src/core/live-frame';
import type { RenderJob } from '../src/core/render';
import { createStore } from '../src/core/store';
import { memoryResultsStore } from '../src/io/results';
import { liveImage } from '../src/render/live-frame';
import { NativeEngine } from '../src/render/native';
import { alphaByte } from '../src/render/tiles';
import { DisplayCurve } from '../src/render/tonemap';
import * as cmd from '../src/ui/commands';
import { liveViewOf, liveDataText } from '../src/ui/panels/live-viewer';
import type { AppServices, FrameRequest, FrameResult } from '../src/ui/ports';
import type { Ctx } from '../src/ui/reactive';
import { liveTap, queueSettled, runJob } from '../src/ui/render-queue';
import { setLang } from '../src/ui/strings';
import { createUiStore } from '../src/ui/ui-state';
import { exampleState } from './helpers';
import { LauncherMock, viewBytes } from './launcher-mock';

afterEach(() => setLang('en'));

describe('the cadence (core/live-frame.ts)', () => {
  it('a picture is due at once, then not before LIVE_FRAME_MS, and at once again after a reset', () => {
    let now = 1000;
    const c = new FrameCadence(() => now);
    expect(c.ms).toBe(LIVE_FRAME_MS);
    expect(c.due()).toBe(true);
    c.mark();
    expect(c.due()).toBe(false);
    now += LIVE_FRAME_MS - 1;
    expect(c.due()).toBe(false);
    now += 1;
    expect(c.due()).toBe(true);
    c.mark();
    now += 10;
    expect(c.due()).toBe(false);
    c.reset();
    expect(c.due()).toBe(true);
  });

  it('the box is what the view measured within LIVE_MAX_BOX, and the factor the smallest whole one that fits', () => {
    expect(liveBox(null)).toEqual(LIVE_MAX_BOX);
    expect(liveBox({ width: 900.7, height: 500.2 })).toEqual({ width: 900, height: 500 });
    expect(liveBox({ width: 4000, height: 3000 })).toEqual(LIVE_MAX_BOX);
    expect(liveBox({ width: 0, height: -3 })).toEqual({ width: 1, height: 1 });
    // The launcher's rule (rt-app render.rs `fit_factor`, its test has the same cases).
    expect(fitFactor(1920, 1080, { width: 1280, height: 800 })).toBe(2);
    expect(fitFactor(1920, 1080, { width: 1920, height: 1080 })).toBe(1);
    expect(fitFactor(1920, 1080, { width: 4000, height: 4000 })).toBe(1);
    expect(fitFactor(1920, 1080, { width: 600, height: 600 })).toBe(4);
    expect(fitFactor(5, 3, { width: 2, height: 2 })).toBe(3);
    expect(fitFactor(5, 3, { width: 0, height: 0 })).toBe(5);
  });
});

describe('the picture (render/live-frame.ts)', () => {
  const curve = new DisplayCurve(0, 1);
  /** The bytes of one straight pixel through the curve, as the picture converts it. */
  const bytes = (r: number, g: number, b: number, a: number): number[] => {
    const out = new Uint8ClampedArray(4);
    curve.pixel(r, g, b, out, 0);
    out[3] = alphaByte(a);
    return [...out];
  };

  it('averages the means of the pixels of each box, the edge boxes over the pixels inside the image', () => {
    // 3 × 2 at 4 samples, k = 2: a 2 × 1 picture; the second box has only its first column inside.
    const sum = new Float32Array([0.4, 0.8, 1.2, 4, 0.8, 0.8, 0.8, 4, 2, 0, 0, 4, 1.2, 1.6, 2, 4, 0, 0.4, 0, 4, 0, 2, 0, 4]);
    const img = liveImage({ sum, width: 3, height: 2, samples: 4 }, 2, curve);
    expect([img.width, img.height]).toEqual([2, 1]);
    const mean = (ps: number[], c: number) => ps.reduce((n, p) => n + sum[p * 4 + c] / 4, 0) / ps.length;
    const a = [0, 1, 3, 4];
    const b = [2, 5];
    expect([...img.rgba.subarray(0, 4)]).toEqual(bytes(mean(a, 0), mean(a, 1), mean(a, 2), 1));
    expect([...img.rgba.subarray(4, 8)]).toEqual(bytes(mean(b, 0), mean(b, 1), mean(b, 2), 1));
  });

  it('mid-pass, each tile counts its own samples, and a box with none is transparent', () => {
    // 4 × 2 in tiles of 2: tile 0 has 2 samples, tile 1 none yet. k = 2.
    const sum = new Float32Array(4 * 2 * 4);
    for (const p of [0, 1, 4, 5]) sum.set([1, 0.5, 0.25, 2], p * 4);
    for (const p of [2, 3, 6, 7]) sum.set([9, 9, 9, 9], p * 4); // not counted: no samples in that tile
    const img = liveImage({ sum, width: 4, height: 2, samples: Int32Array.of(2, 0), tile: 2 }, 2, curve);
    expect([...img.rgba.subarray(0, 4)]).toEqual(bytes(0.5, 0.25, 0.125, 1));
    expect([...img.rgba.subarray(4, 8)]).toEqual([0, 0, 0, 0]);
  });

  it('where the background shows through, the colour is divided by the coverage and the alpha kept', () => {
    // One pixel, 2 samples: premultiplied radiance 0.5 with coverage 1 of 2 (alpha ½).
    const img = liveImage({ sum: new Float32Array([0.5, 0.5, 0.5, 1]), width: 1, height: 1, samples: 2 }, 1, curve);
    expect([...img.rgba]).toEqual(bytes(0.5, 0.5, 0.5, 0.5));
  });
});

// ------------------------------------------------------------------ the queue

interface Fake {
  ctx: Ctx;
  /** The frame request of the render in flight (null between renders). */
  req: FrameRequest | null;
  /** Pictures the fake engine made (it makes one only when `frameBox` asks for one). */
  made: number;
  /** The fake engine adds samples: one pass, and a picture when the live view wants one now. */
  pass(samples: number): void;
  /** Lets the render in flight end. */
  finish(): void;
}

const tick = () => new Promise((r) => setTimeout(r, 0));

function frameOf(box: FrameBox, samples: number): LiveFrame {
  const k = fitFactor(64, 36, box);
  const width = Math.ceil(64 / k);
  const height = Math.ceil(36 / k);
  return { width, height, rgba: new Uint8ClampedArray(width * height * 4).fill(samples), renderWidth: 64, renderHeight: 36, samples, seconds: samples / 10 };
}

function makeCtx(): Fake {
  const results = memoryResultsStore();
  let release: (() => void) | null = null;
  const fake: Fake = {
    ctx: null as unknown as Ctx,
    req: null,
    made: 0,
    pass(samples) {
      const req = fake.req;
      if (!req) throw new Error('no render in flight');
      req.onProgress?.(samples / 8, samples, samples / 10);
      const box = req.frameBox?.();
      if (!box) return;
      fake.made++;
      req.onFrame?.(frameOf(box, samples));
    },
    finish() {
      const r = release;
      release = null;
      r?.();
    },
  };
  const services = {
    viewport: null,
    renderImage: async () => new Blob(),
    async renderFrame(req: FrameRequest): Promise<FrameResult> {
      fake.req = req;
      await new Promise<void>((resolve, reject) => {
        release = resolve;
        req.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
      fake.req = null;
      return { file: new Blob([new Uint8Array(10)]), display: null, width: req.width, height: req.height, samples: 8, seconds: 0.8 };
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
      save: async () => 'DOWNLOAD' as const,
      openFolder: async () => {},
    },
  } as Partial<AppServices> as AppServices;
  const store = createStore(exampleState());
  store.dispatch({ type: 'meta/rename', name: 'Bottle' });
  // Small jobs that do not open their result by themselves: what opens it here is the live view.
  store.dispatch({ type: 'render/set', patch: { width: 64, height: 36, maxSamples: 8, showWhenDone: false } });
  fake.ctx = { store, ui: createUiStore(), services };
  return fake;
}

const jobs = (f: Fake): RenderJob[] => f.ctx.store.get().render.queue;

describe('the queue’s tap (render-queue.ts liveTap) with a fake clock', () => {
  it('asks for a picture only while the live view shows the job, at most every LIVE_FRAME_MS, the first at once', () => {
    const f = makeCtx();
    const { ctx } = f;
    cmd.enqueue(ctx);
    cmd.enqueue(ctx);
    const [a, b] = jobs(f);
    let now = 0;
    const tap = liveTap(ctx, a.id, () => now);
    // No live view: never.
    expect(tap.frameBox()).toBeNull();
    cmd.watchJob(ctx, a.id);
    expect(tap.frameBox()).toEqual(LIVE_MAX_BOX);
    // Within the cadence: none, however often the engine asks (the pool asks with every tile).
    for (let i = 0; i < 20; i++) {
      now += (LIVE_FRAME_MS - 1) / 20;
      expect(tap.frameBox()).toBeNull();
    }
    now = LIVE_FRAME_MS;
    // The box the viewer measured, within the cap.
    ctx.ui.set({ liveView: { jobId: a.id, box: { width: 800, height: 450 } } });
    expect(tap.frameBox()).toEqual({ width: 800, height: 450 });
    // Another job in the view: none, however long it waits.
    cmd.watchJob(ctx, b.id);
    now += 10 * LIVE_FRAME_MS;
    expect(tap.frameBox()).toBeNull();
    // Back on it (within the cadence of the last one taken): one at once.
    cmd.watchJob(ctx, a.id);
    expect(tap.frameBox()).not.toBeNull();
    expect(tap.frameBox()).toBeNull();
    // Closed: none.
    cmd.closeLive(ctx);
    now += 10 * LIVE_FRAME_MS;
    expect(tap.frameBox()).toBeNull();
  });

  it('a page in a background tab wants no picture; one that arrives after the view moved on is dropped', () => {
    const f = makeCtx();
    const { ctx } = f;
    cmd.enqueue(ctx);
    cmd.enqueue(ctx);
    const [a, b] = jobs(f);
    const tap = liveTap(ctx, a.id, () => 0);
    cmd.watchJob(ctx, a.id);
    const g = globalThis as { document?: unknown };
    const had = 'document' in g;
    g.document = { visibilityState: 'hidden' };
    try {
      expect(tap.frameBox()).toBeNull();
    } finally {
      if (had) g.document = undefined;
      else delete g.document;
    }
    const box = tap.frameBox();
    expect(box).not.toBeNull();
    cmd.watchJob(ctx, b.id);
    tap.onFrame(frameOf(box!, 3));
    expect(ctx.ui.get().liveFrame).toBeNull();
  });

  it('runJob hands the tap to the engine: with the view open the pictures come at the cadence and reach the view', async () => {
    const f = makeCtx();
    const { ctx } = f;
    cmd.enqueue(ctx);
    const [job] = jobs(f);
    cmd.watchJob(ctx, job.id);
    let now = 0;
    const abort = new AbortController();
    const run = runJob(ctx, job, abort.signal, () => now);
    await tick();
    expect(f.req?.frameBox).toBeTypeOf('function');
    // Passes every 100 ms for 2 s: one picture at once and then one every LIVE_FRAME_MS.
    for (let s = 1; s <= 20; s++) {
      f.pass(s);
      now += 100;
    }
    expect(f.made).toBe(Math.ceil(2000 / LIVE_FRAME_MS));
    const shown = ctx.ui.get().liveFrame;
    expect(shown?.jobId).toBe(job.id);
    expect(shown?.frame.samples).toBe(16);
    expect(shown?.frame.width).toBe(64);
    // Closing the view stops them: the engine asks, and is told no.
    cmd.closeLive(ctx);
    for (let s = 21; s <= 40; s++) {
      f.pass(s);
      now += 100;
    }
    expect(f.made).toBe(Math.ceil(2000 / LIVE_FRAME_MS));
    expect(ctx.ui.get().liveFrame).toBeNull();
    f.finish();
    await run;
  });
});

describe('the queue with a render that delivers frames', () => {
  it('the job in flight, selected, shows its frames with the engine’s samples; deselected, no more are made', async () => {
    const f = makeCtx();
    const { ctx } = f;
    cmd.enqueue(ctx);
    cmd.enqueue(ctx);
    cmd.toggleQueue(ctx);
    await tick();
    const [a, b] = jobs(f);
    expect([a.status, b.status]).toEqual(['RUNNING', 'QUEUED']);
    // Nobody looks: the engine is never asked to make a picture.
    f.pass(1);
    expect(f.made).toBe(0);
    // The row of the job in flight is clicked: the live view opens on it and the next pass is shown.
    cmd.selectJob(ctx, a.id);
    expect(ctx.ui.get().liveView?.jobId).toBe(a.id);
    expect(liveViewOf(ctx.store.get(), ctx.ui.get())?.kind).toBe('STARTING');
    f.pass(2);
    expect(f.made).toBe(1);
    const m = liveViewOf(ctx.store.get(), ctx.ui.get())!;
    expect(m.kind).toBe('LIVE');
    expect(m.frame?.samples).toBe(2);
    expect(m.line).toBe('');
    // The status is the row's, with the job's progress (the queue throttles its ticks: 0 % this soon).
    expect(m.status).toBe(`Rendering · ${Math.round(m.job.progress * 100)} %`);
    // The data line says the engine's numbers: 2 of 8 samples, 0:00 rendered.
    expect(liveDataText(ctx.store.get(), m.job, m.frame)).toBe('64 × 36 · 2 of 8 samples · 0:00 · Camera 1');
    // Another job chosen (the waiting one): no more pictures of the first.
    cmd.selectJob(ctx, b.id);
    expect(ctx.ui.get().liveFrame).toBeNull();
    await new Promise((r) => setTimeout(r, LIVE_FRAME_MS + 20));
    f.pass(3);
    f.pass(4);
    expect(f.made).toBe(1);
    // Closed: none either.
    cmd.selectJob(ctx, a.id);
    f.pass(5);
    expect(f.made).toBe(2);
    cmd.closeLive(ctx);
    await new Promise((r) => setTimeout(r, LIVE_FRAME_MS + 20));
    f.pass(6);
    expect(f.made).toBe(2);
    expect(ctx.ui.get().liveView).toBeNull();
    cmd.toggleQueue(ctx); // Pause
    await queueSettled(ctx);
  });

  it('a waiting job shows a line saying it has not started (en and es), and its picture when it starts', async () => {
    const f = makeCtx();
    const { ctx } = f;
    cmd.enqueue(ctx);
    const [a] = jobs(f);
    cmd.selectJob(ctx, a.id);
    const waiting = liveViewOf(ctx.store.get(), ctx.ui.get())!;
    expect(waiting.kind).toBe('WAITING');
    expect(waiting.frame).toBeNull();
    expect(waiting.line).toBe('This job has not started yet: its picture appears here as soon as it renders.');
    setLang('es');
    expect(liveViewOf(ctx.store.get(), ctx.ui.get())!.line).toBe('Este trabajo aún no ha empezado: su imagen aparecerá aquí en cuanto se renderice.');
    setLang('en');
    // The queue starts it: the view that waited shows its picture.
    cmd.toggleQueue(ctx);
    await tick();
    f.pass(1);
    expect(f.made).toBe(1);
    expect(liveViewOf(ctx.store.get(), ctx.ui.get())!.kind).toBe('LIVE');
    // Paused: it waits again, and says so instead of showing the picture of a render that starts over.
    cmd.toggleQueue(ctx);
    await queueSettled(ctx);
    expect(jobs(f)[0].status).toBe('QUEUED');
    expect(liveViewOf(ctx.store.get(), ctx.ui.get())!.kind).toBe('WAITING');
  });

  it('a finished job opens the results viewer; the job watched to its end becomes its result in the viewer', async () => {
    const f = makeCtx();
    const { ctx } = f;
    cmd.enqueue(ctx);
    cmd.enqueue(ctx);
    cmd.toggleQueue(ctx);
    await tick();
    const [a, b] = jobs(f);
    cmd.selectJob(ctx, a.id);
    f.pass(4);
    // It ends while it is watched (and does not open its result by itself): its result takes the live view's place.
    f.finish();
    await tick();
    await tick();
    await tick();
    const done = jobs(f)[0];
    expect(done.status).toBe('DONE');
    expect(ctx.ui.get().resultView?.id).toBe(done.resultIds[0]);
    expect(ctx.ui.get().liveView).toBeNull();
    expect(ctx.ui.get().liveFrame).toBeNull();
    // The second runs unwatched: it does not open anything when it ends.
    cmd.closeResult(ctx);
    await tick();
    f.finish();
    await queueSettled(ctx);
    expect(jobs(f).map((j) => j.status)).toEqual(['DONE', 'DONE']);
    expect(ctx.ui.get().resultView).toBeNull();
    // A click on a finished row opens its result, as before U14.
    cmd.selectJob(ctx, b.id);
    expect(ctx.ui.get().resultView?.id).toBe(jobs(f)[1].resultIds[0]);
    expect(ctx.ui.get().liveView).toBeNull();
    // And from the live view of another job too: the two never show at once.
    cmd.enqueue(ctx);
    cmd.selectJob(ctx, jobs(f)[2].id);
    expect(ctx.ui.get().resultView).toBeNull();
    cmd.selectJob(ctx, a.id);
    expect(ctx.ui.get().resultView?.id).toBe(jobs(f)[0].resultIds[0]);
    expect(ctx.ui.get().liveView).toBeNull();
  });

  it('a job that ended without a result says why; one removed from the queue takes its view with it', async () => {
    const f = makeCtx();
    const { ctx } = f;
    cmd.enqueue(ctx);
    cmd.enqueue(ctx);
    cmd.toggleQueue(ctx);
    await tick();
    const [a, b] = jobs(f);
    cmd.selectJob(ctx, a.id);
    cmd.stopJob(ctx, a.id);
    await tick();
    await tick();
    expect(jobs(f)[0].status).toBe('CANCELLED');
    expect(liveViewOf(ctx.store.get(), ctx.ui.get())).toMatchObject({ kind: 'STOPPED', line: 'This job was stopped before it finished.' });
    // A job without a result does nothing when clicked.
    cmd.closeLive(ctx);
    cmd.selectJob(ctx, a.id);
    expect([ctx.ui.get().liveView, ctx.ui.get().resultView]).toEqual([null, null]);
    cmd.selectJob(ctx, b.id);
    cmd.removeJob(ctx, b.id);
    expect(ctx.ui.get().liveView).toBeNull();
    await queueSettled(ctx);
  });
});

// ------------------------------------------------------------------ the engines

describe('the desktop engine (render/native.ts) and the launcher', () => {
  /** A final of 64 × 48 at 4 samples (the mock's passes: 1, 3, 4). */
  const source = { build: () => ({ meshKey: 'm', bytes: () => viewBytes(64, 48, true, 1) }), tone: () => ({ exposureEv: 0, tonemap: 1 }) };

  it('asks for the pass just published scaled to the box while a picture is wanted, and fetches nothing while not', async () => {
    const launcher = new LauncherMock();
    launcher.pollMs = 1;
    const engine = new NativeEngine({ request: launcher.request }, source, { threads: 8, isa: 'avx2' });
    engine.sync(exampleState(), null);
    const frames: LiveFrame[] = [];
    let wanted = true;
    const px = await engine.renderPixels({ width: 64, height: 48, maxSamples: 4, maxSeconds: 0, transparent: false, frameBox: () => (wanted ? { width: 16, height: 16 } : null), onFrame: (f) => frames.push(f) });
    expect(px.samples).toBe(4);
    // A picture after each pass but the last (the result is that one): 16 × 12 (k = 4), with the launcher's samples.
    expect(launcher.log.filter((l) => l.includes('fit=16x16'))).toHaveLength(2);
    expect(launcher.fitted.map((f) => [f.width, f.height])).toEqual([[16, 12], [16, 12]]);
    expect(frames.map((f) => [f.width, f.height, f.renderWidth, f.renderHeight, f.samples])).toEqual([
      [16, 12, 64, 48, 1],
      [16, 12, 64, 48, 3],
    ]);
    // Wanted nowhere: only headers travel.
    wanted = false;
    launcher.log.length = 0;
    frames.length = 0;
    await engine.renderPixels({ width: 64, height: 48, maxSamples: 4, maxSeconds: 0, transparent: false, frameBox: () => (wanted ? { width: 16, height: 16 } : null), onFrame: (f) => frames.push(f) });
    expect(launcher.log.some((l) => l.includes('fit='))).toBe(false);
    expect(launcher.log.filter((l) => l.startsWith('GET /api/render/') && !l.includes('data=0'))).toHaveLength(1);
    expect(frames).toHaveLength(0);
    expect(launcher.inUse).toBe(0);
  });

  it('a launcher that sends the frame whole (no fit=) is scaled on the page; a refused one is skipped and the render goes on', async () => {
    const launcher = new LauncherMock();
    launcher.pollMs = 1;
    const plain = launcher.request;
    let refuse = false;
    // An older launcher: it ignores `fit=` (and so sends the whole frame), or answers an error.
    const old = async (path: string, init?: RequestInit) => (refuse && path.includes('fit=') ? new Response('{"error":"x","message":"no"}', { status: 500 }) : plain(path.replace(/&?fit=\d+x\d+/, '').replace('?&', '?'), init));
    const engine = new NativeEngine({ request: old }, source, { threads: 8, isa: 'avx2' });
    engine.sync(exampleState(), null);
    const frames: LiveFrame[] = [];
    await engine.renderPixels({ width: 64, height: 48, maxSamples: 4, maxSeconds: 0, transparent: false, frameBox: () => ({ width: 16, height: 16 }), onFrame: (f) => frames.push(f) });
    expect(frames.map((f) => [f.width, f.height])).toEqual([[16, 12], [16, 12]]);
    refuse = true;
    frames.length = 0;
    const warn = console.warn;
    console.warn = () => undefined;
    try {
      const px = await engine.renderPixels({ width: 64, height: 48, maxSamples: 4, maxSeconds: 0, transparent: false, frameBox: () => ({ width: 16, height: 16 }), onFrame: (f) => frames.push(f) });
      expect(px.samples).toBe(4);
    } finally {
      console.warn = warn;
    }
    expect(frames).toHaveLength(0);
    expect(launcher.inUse).toBe(0);
  });
});
