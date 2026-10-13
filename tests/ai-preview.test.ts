// The AI preview’s brain (phase X4, AI-POST.md §4): it updates when a control is released and never while one is
// dragged, it keeps the Fast-mode frame while only the controls change, it abandons a preview that a newer
// change has made stale, and it reports the time the pipeline measured. Fakes for the service, the frame and the
// clock; the timers are moved by hand.

import { describe, expect, it } from 'vitest';
import { DEFAULT_AI_PIPELINE, type AiPipelineSettings, type AiPostRequest, type AiPostResult, type LinearImage } from '../src/core/ai';
import { AiPreviewController, type AiPreviewDeps, type AiPreviewInput, type AiPreviewState } from '../src/ui/ai-preview';

const image = (v: number): LinearImage => ({ width: 2, height: 2, rgba: new Float32Array(16).fill(v) });

interface Harness {
  ctl: AiPreviewController;
  posts: AiPostRequest[];
  frames: number;
  signals: AbortSignal[];
  settings: AiPipelineSettings;
  key: unknown[];
  readNull: boolean;
  clock: number;
  /** Resolves the post in flight with a result tinted by its seed (so a stale answer is recognisable). */
  finish(): Promise<void>;
  fail(message: string): Promise<void>;
  /** How long the next pipeline call "takes", in ms of the fake clock. */
  cost: number;
  tick(ms: number): void;
  states: AiPreviewState[];
}

function harness(initialSeconds: number | null = null): Harness {
  const h = {
    posts: [] as AiPostRequest[],
    frames: 0,
    signals: [] as AbortSignal[],
    settings: { ...DEFAULT_AI_PIPELINE },
    key: ['scene-1'] as unknown[],
    readNull: false,
    clock: 0,
    cost: 3000,
    states: [] as AiPreviewState[],
  } as Harness;
  let pending: { resolve: (r: AiPostResult) => void; reject: (e: unknown) => void; request: AiPostRequest }[] = [];
  let timers: { at: number; fn: () => void; id: number }[] = [];
  let nextId = 1;
  const deps: AiPreviewDeps = {
    service: {
      post(request, _onProgress, signal) {
        h.posts.push(request);
        h.signals.push(signal);
        return new Promise<AiPostResult>((resolve, reject) => {
          pending.push({ resolve, reject, request });
          signal.addEventListener('abort', () => {
            pending = pending.filter((p) => p.request !== request);
            reject(new DOMException('aborted', 'AbortError'));
          });
        });
      },
    },
    read(): AiPreviewInput | null {
      if (h.readNull) return null;
      return {
        frameKey: h.key,
        frame: async () => {
          h.frames++;
          return { image: image(0.5), passes: { width: 2, height: 2 } };
        },
        settings: { ...h.settings },
        prompt: '',
        negative: '',
        modelKey: 'SYNTHETIC',
      };
    },
    now: () => h.clock,
    setTimer(fn, ms) {
      const id = nextId++;
      timers.push({ at: h.clock + ms, fn, id });
      return id;
    },
    clearTimer(handle) {
      timers = timers.filter((t) => t.id !== handle);
    },
    settleMs: 150,
  };
  h.ctl = new AiPreviewController(deps, initialSeconds);
  h.ctl.subscribe((s) => h.states.push(s));
  h.tick = (ms) => {
    h.clock += ms;
    const due = timers.filter((t) => t.at <= h.clock);
    timers = timers.filter((t) => t.at > h.clock);
    for (const t of due) t.fn();
  };
  const answer = (req: AiPostRequest): AiPostResult => ({
    image: image(0.5 + req.settings.seed / 1000),
    report: { verdict: 'ACCEPTED', usedFraction: 1, attempts: 1, size: { ok: true, value: 1, limit: 1 }, outside: { ok: true, value: 0, limit: 0 }, edges: { ok: true, value: 0, limit: 2 }, detail: { ok: true, value: 1, limit: 0.9 }, focus: { ok: true, value: 0, limit: 0.25 }, materials: [], modelKey: 'SYNTHETIC', runtime: 'synthetic', seed: req.settings.seed, seconds: 0 },
  });
  h.finish = async () => {
    const p = pending.shift();
    h.clock += h.cost;
    p?.resolve(answer(p.request));
    await flush();
  };
  h.fail = async (message) => {
    pending.shift()?.reject(new Error(message));
    await flush();
  };
  return h;
}

/** Lets the promises settle. */
const flush = async () => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
};

describe('the preview updates on release, never during a drag', () => {
  it('holds still while a control is dragged and computes once when it is released', async () => {
    const h = harness();
    h.ctl.hold();
    for (let v = 31; v <= 80; v++) {
      h.settings.light = v;
      h.ctl.touch();
      h.tick(20);
    }
    h.tick(2000);
    await flush();
    expect(h.posts).toHaveLength(0);
    expect(h.frames).toBe(0);
    expect(h.ctl.state.phase).toBe('IDLE');
    h.ctl.release();
    await flush();
    expect(h.frames).toBe(1);
    expect(h.posts).toHaveLength(1);
    expect(h.posts[0].settings.light).toBe(80);
    await h.finish();
    expect(h.ctl.state.phase).toBe('READY');
  });

  it('a release without a change computes nothing', async () => {
    const h = harness();
    h.ctl.hold();
    h.ctl.release();
    await flush();
    expect(h.posts).toHaveLength(0);
  });

  it('a change outside a drag settles for a moment, and a burst of them is one preview', async () => {
    const h = harness();
    h.ctl.touch();
    h.tick(100);
    h.ctl.touch();
    h.tick(100);
    h.ctl.touch();
    await flush();
    expect(h.posts).toHaveLength(0);
    h.tick(149);
    await flush();
    expect(h.posts).toHaveLength(0);
    h.tick(1);
    await flush();
    expect(h.posts).toHaveLength(1);
  });

  it('two drags at once (the slider and its field) release together', async () => {
    const h = harness();
    h.ctl.hold();
    h.ctl.hold();
    h.ctl.touch();
    h.ctl.release();
    await flush();
    expect(h.posts).toHaveLength(0);
    h.ctl.release();
    await flush();
    expect(h.posts).toHaveLength(1);
  });

  it('a change while a drag has begun is held until the drag ends, even after the pause', async () => {
    const h = harness();
    h.ctl.touch();
    h.ctl.hold(); // the pause had not run out yet
    h.tick(1000);
    await flush();
    expect(h.posts).toHaveLength(0);
    h.ctl.release();
    await flush();
    expect(h.posts).toHaveLength(1);
  });
});

describe('the frame and the pipeline', () => {
  it('draws the frame once while only the controls change, and again when the scene does', async () => {
    const h = harness();
    h.ctl.refresh();
    await flush();
    await h.finish();
    for (const light of [10, 20, 30]) {
      h.settings.light = light;
      h.ctl.touch();
      h.tick(200);
      await flush();
      await h.finish();
    }
    expect(h.frames).toBe(1);
    expect(h.posts).toHaveLength(4);
    h.key = ['scene-2'];
    h.ctl.refresh();
    await flush();
    await h.finish();
    expect(h.frames).toBe(2);
  });

  it('sends the frame’s image and passes inline, with the settings, the prompt and the model', async () => {
    const h = harness();
    h.settings = { ...h.settings, style: 'WARM', seed: 9 };
    h.ctl.refresh();
    await flush();
    const req = h.posts[0];
    expect(req.source.kind).toBe('INLINE');
    if (req.source.kind === 'INLINE') {
      expect(req.source.image.width).toBe(2);
      expect(req.source.passes.width).toBe(2);
    }
    expect(req.settings).toMatchObject({ style: 'WARM', seed: 9 });
    expect(req.modelKey).toBe('SYNTHETIC');
  });

  it('abandons a preview a newer change has made stale: the service is aborted and the late answer is ignored', async () => {
    const h = harness();
    h.settings.seed = 1;
    h.ctl.refresh();
    await flush();
    expect(h.posts).toHaveLength(1);
    h.settings.seed = 2;
    h.ctl.refresh();
    await flush();
    expect(h.signals[0].aborted).toBe(true);
    expect(h.posts).toHaveLength(2);
    await h.finish(); // the first was rejected on abort and left the list; this answers the second
    expect(h.ctl.state.phase).toBe('READY');
    expect(h.ctl.state.report?.seed).toBe(2);
    expect(h.ctl.state.error).toBeNull();
  });

  it('keeps the before image while the next after is made', async () => {
    const h = harness();
    h.ctl.refresh();
    await flush();
    await h.finish();
    const first = h.ctl.state;
    h.settings.light = 5;
    h.ctl.touch();
    h.tick(200);
    await flush();
    expect(h.ctl.state.phase).toBe('WORKING');
    expect(h.ctl.state.before).toBe(first.before);
    expect(h.ctl.state.after).toBe(first.after);
  });

  it('shows nothing to do when the section is folded or the switch is off (read gives null)', async () => {
    const h = harness();
    h.readNull = true;
    h.ctl.refresh();
    await flush();
    expect(h.posts).toHaveLength(0);
    expect(h.frames).toBe(0);
    expect(h.ctl.state.phase).toBe('IDLE');
  });

  it('says what went wrong, and recovers with the next change', async () => {
    const h = harness();
    h.ctl.refresh();
    await flush();
    await h.fail('out of memory');
    expect(h.ctl.state).toMatchObject({ phase: 'ERROR', error: 'out of memory' });
    h.ctl.touch();
    h.tick(200);
    await flush();
    await h.finish();
    expect(h.ctl.state).toMatchObject({ phase: 'READY', error: null });
  });

  it('cancel and dispose stop everything', async () => {
    const h = harness();
    h.ctl.refresh();
    await flush();
    h.ctl.cancel();
    expect(h.signals[0].aborted).toBe(true);
    await flush();
    expect(h.ctl.state.phase).toBe('IDLE');
    const g = harness();
    g.ctl.touch();
    g.ctl.dispose();
    g.tick(1000);
    await flush();
    expect(g.posts).toHaveLength(0);
  });
});

describe('the measured time', () => {
  it('is what the pipeline took, never an estimate, and starts as nothing', async () => {
    const h = harness();
    expect(h.ctl.state.seconds).toBeNull();
    h.cost = 9000;
    h.ctl.refresh();
    await flush();
    await h.finish();
    expect(h.ctl.state.seconds).toBe(9);
    h.cost = 2500;
    h.settings.light = 1;
    h.ctl.touch();
    h.tick(200);
    await flush();
    await h.finish();
    expect(h.ctl.state.seconds).toBe(2.5);
  });

  it('the frame’s time is not counted, and an earlier measure is kept until a new one', async () => {
    const h = harness(4.2);
    expect(h.ctl.state.seconds).toBe(4.2);
    h.ctl.refresh();
    await flush();
    expect(h.ctl.state.seconds).toBe(4.2);
    await h.finish();
    expect(h.ctl.state.seconds).toBe(3);
  });
});
