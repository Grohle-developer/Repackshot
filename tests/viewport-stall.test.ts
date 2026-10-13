// Full mode that never gets stuck (phase P3a), native engine (render/native.ts) against a launcher behind
// the browser's six HTTP/1.1 connections (tests/launcher-mock.ts): every root cause found reproducing the
// report of v0.1.0 on Windows has its test here.
//
//  1. Responses left unread (the long-poll of a replaced view) kept the browser's connections: after six,
//     every request to the launcher waited for ever. The viewport stopped, a running Render never ended
//     ("Full · paused while Render runs") and Pause could not reach the launcher.
//  2. Render's requests ignored the abort signal: Pause waited for a request that never came back.
//  3. A view the launcher dropped (404) or refused was never posted again; at reduced resolution its
//     "frame in flight" stayed set and no view was ever posted again.
//  4. Two views could be posted at once and arrive in the other order (the older replacing the newer).
//  5. Nothing noticed any of it: the watchdog now does, and says so.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createInitialState, type ProjectState } from '../src/core/store';
import { FLAG_PAUSED, FLAG_SHARED, NativeEngine, viewportShare } from '../src/render/native';
import type { SceneSource } from '../src/render/pathtracer';
import { WATCHDOG } from '../src/render/watchdog';
import { installDom, LauncherMock, viewBytes, type FakeCanvas } from './launcher-mock';

/** A scene source whose bytes say the view's size and which version of the project it is. */
function source(): { src: SceneSource; bump: () => ProjectState; state: () => ProjectState } {
  let version = 1;
  let state = createInitialState({ lang: 'en', theme: 'dark' });
  const versions = new WeakMap<ProjectState, number>([[state, version]]);
  return {
    src: {
      build: (s, view) => ({ meshKey: 'm', bytes: (meshes) => viewBytes(view.width, view.height, meshes, versions.get(s) ?? 0) }),
      tone: () => ({ exposureEv: 0, tonemap: 1 }),
    },
    bump: () => {
      // Another project state (the camera moved, a material changed): what the engine is synced with.
      state = { ...state, camera: { ...state.camera } };
      versions.set(state, ++version);
      return state;
    },
    state: () => state,
  };
}

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

interface Rig {
  launcher: LauncherMock;
  engine: NativeEngine;
  canvas: FakeCanvas;
  scene: ReturnType<typeof source>;
  /** Changes the project (a restart of the view). */
  change(): void;
  /** The page's animation loop: frame() every few milliseconds for `ms`. */
  run(ms: number, every?: number, onFrame?: () => void): Promise<void>;
}

let restore: (() => void) | null = null;
const engines: NativeEngine[] = [];

beforeEach(() => {
  const dom = installDom();
  restore = dom.restore;
});

afterEach(() => {
  engines.splice(0).forEach((e) => e.setActive(false));
  restore?.();
  restore = null;
  vi.restoreAllMocks();
});

function rig(threads = 8, width = 8, height = 6): Rig {
  const launcher = new LauncherMock();
  const scene = source();
  const engine = new NativeEngine({ request: launcher.request }, scene.src, { threads, isa: 'avx2' });
  engines.push(engine);
  const dom = installDom();
  const canvas = dom.canvas;
  engine.mount(canvas as unknown as HTMLCanvasElement);
  engine.sync(scene.state(), null);
  engine.resize(width, height, 1);
  engine.setActive(true);
  return {
    launcher,
    engine,
    canvas,
    scene,
    change: () => {
      const prev = scene.state();
      engine.sync(scene.bump(), prev);
    },
    run: async (ms, every = 4, onFrame) => {
      const end = performance.now() + ms;
      while (performance.now() < end) {
        engine.frame();
        onFrame?.();
        await tick(every);
      }
    },
  };
}

/** A clock the engine reads (performance.now), moved by hand. */
function manualClock(): { now: number; advance(ms: number): void } {
  const c = { now: performance.now(), advance: (ms: number) => void (c.now += ms) };
  vi.spyOn(performance, 'now').mockImplementation(() => c.now);
  return c;
}

/** `ms` of the page's animation loop on the manual clock: a frame every 100 ms (and the promises in between). */
async function frames(engine: NativeEngine, clock: { advance(ms: number): void }, ms: number): Promise<void> {
  for (let t = 0; t < ms; t += 100) {
    clock.advance(100);
    engine.frame();
    await tick(0);
  }
}

describe('the viewport and the browser connections to the launcher', () => {
  it('never leaves a response unread: forty fast changes later the viewport still gets passes', { timeout: 15000 }, async () => {
    const r = rig();
    r.launcher.pollMs = 25;
    // Changes come faster than the long-polls answer: each one replaces a view whose poll is in flight.
    let frames = 0;
    await r.run(1500, 3, () => {
      if (++frames % 10 === 0 && frames <= 400) r.change();
    });
    // Quiet again: the last view converges, and nothing waits for a connection.
    const before = r.engine.status().passes ?? 0;
    for (let i = 0; i < 10 && (r.engine.status().passes ?? 0) <= before + 2; i++) await r.run(300);
    expect(r.engine.status().passes ?? 0).toBeGreaterThan(before + 2);
    expect(r.engine.status().samples).toBeGreaterThan(0);
    expect(r.launcher.queued).toBe(0);
    // The poll of the view on screen (and a POST or a DELETE on the way) hold a connection; never all six.
    expect(r.launcher.maxInUse).toBeLessThan(r.launcher.connections);
    expect(r.launcher.inUse).toBeLessThanOrEqual(2);
    const posts = r.launcher.log.filter((l) => l.startsWith('POST'));
    expect(posts.length).toBeGreaterThan(10);
  });

  it('posts one view at a time, numbered, so an older one cannot replace a newer one', { timeout: 15000 }, async () => {
    const r = rig();
    const seqs: number[] = [];
    let inFlight = 0;
    let most = 0;
    const request = r.launcher.request;
    // The POSTs take a while to be answered; meanwhile the project keeps changing.
    (r.launcher as unknown as { request: typeof request }).request = request;
    const slow: typeof request = async (path, init) => {
      if (init?.method === 'POST') {
        inFlight++;
        most = Math.max(most, inFlight);
        seqs.push(Number(new URL(path, 'http://x').searchParams.get('seq')));
        await tick(400);
        try {
          return await request(path, init);
        } finally {
          inFlight--;
        }
      }
      return request(path, init);
    };
    const engine = new NativeEngine({ request: slow }, r.scene.src, { threads: 8, isa: 'avx2' });
    engines.push(engine);
    engine.mount(r.canvas as unknown as HTMLCanvasElement);
    engine.sync(r.scene.state(), null);
    engine.resize(8, 6, 1);
    engine.setActive(true);
    // Changes far enough apart to render at full resolution (no frame in flight holds them back), each while
    // the previous view is still being posted.
    for (let i = 0; i < 4; i++) {
      const prev = r.scene.state();
      engine.sync(r.scene.bump(), prev);
      const until = performance.now() + 280;
      while (performance.now() < until) {
        engine.frame();
        await tick(5);
      }
    }
    const end = performance.now() + 900;
    while (performance.now() < end) {
      engine.frame();
      await tick(5);
    }
    expect(most).toBe(1);
    expect(seqs.length).toBeGreaterThan(2);
    expect(seqs.every((s, i) => i === 0 || s > seqs[i - 1])).toBe(true);
  });
});

describe('a view the launcher drops or refuses', () => {
  it('is posted again when the launcher no longer has it (404), also at reduced resolution', async () => {
    const r = rig();
    await r.run(80);
    const job = [...r.launcher.jobs.values()][0];
    expect(job).toBeTruthy();
    const posts = () => r.launcher.log.filter((l) => l.startsWith('POST')).length;
    const before = posts();
    r.launcher.forget.add(job.id);
    await r.run(150);
    expect(posts()).toBeGreaterThan(before);
    expect(r.engine.status().samples).toBeGreaterThan(0);
    // A gesture frame (¼ resolution) whose job is dropped: the next view is not held back for ever.
    r.engine.beginGesture();
    r.engine.gestureView({ azimuth: 1 });
    r.engine.frame();
    await tick(5);
    const gestureJob = [...r.launcher.jobs.values()].at(-1)!;
    r.launcher.forget.add(gestureJob.id);
    r.engine.endGesture();
    const afterGesture = posts();
    await r.run(200);
    expect(posts()).toBeGreaterThan(afterGesture);
    expect(r.engine.status().scale).toBe(1);
    expect(r.engine.status().samples).toBeGreaterThan(0);
  });

  it('a refused view says why on the meter and is tried again', async () => {
    const r = rig();
    r.launcher.refuse.push({ status: 503, error: 'busy', message: 'too many windows rendering' });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    r.engine.frame();
    await tick(10);
    const st = r.engine.status();
    expect(st.samples).toBe(0);
    expect(st.issue).toMatchObject({ kind: 'FAILED', detail: 'too many windows rendering' });
    expect(st.issue?.seconds).toBeGreaterThan(0);
    expect(warn.mock.calls.some((c) => String(c[0]).includes('too many windows rendering'))).toBe(true);
    // A second later it is posted again, and renders.
    await r.run(1300);
    expect(r.launcher.log.filter((l) => l.startsWith('POST')).length).toBe(2);
    expect(r.engine.status().samples).toBeGreaterThan(0);
    expect(r.engine.status().issue).toBeUndefined();
  });
});

describe('the watchdog', () => {
  it('starts the view again when the launcher stops answering, and logs what the launcher was doing', async () => {
    const r = rig();
    await r.run(60);
    expect(r.engine.status().samples).toBeGreaterThan(0);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    // The launcher is stuck: long-polls never come back.
    r.launcher.hangPolls = true;
    await r.run(40);
    const clock = manualClock();
    const posts = () => r.launcher.log.filter((l) => l.startsWith('POST')).length;
    const before = posts();
    await frames(r.engine, clock, WATCHDOG.silentMs - 500);
    expect(r.engine.watchdogFires).toBe(0);
    // While it waits, the meter says so (never "0 samples" in silence).
    expect(r.engine.status().issue?.kind).toBe('WAITING');
    r.launcher.hangPolls = false;
    await frames(r.engine, clock, 1000);
    expect(r.engine.watchdogFires).toBe(1);
    expect(warn.mock.calls.some((c) => /watchdog.*not answered/.test(String(c[0])))).toBe(true);
    await tick(20);
    expect(r.launcher.log.some((l) => l.startsWith('GET /api/render/state?log=1&reason=watchdog'))).toBe(true);
    // The stuck poll was aborted (its connection is free) and the view is posted again.
    vi.restoreAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await r.run(150);
    expect(posts()).toBeGreaterThan(before);
    expect(r.engine.status().issue?.kind).toBe('RESTARTED');
    expect(r.launcher.queued).toBe(0);
  });

  it('notices passes that arrive and are not drawn', async () => {
    const r = rig();
    await r.run(60);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    // Someone resized the canvas under the engine: tiles of the old size cannot be drawn.
    r.canvas.width = 3;
    const clock = manualClock();
    for (let t = 0; t < WATCHDOG.displayMs + 1000; t += 100) {
      clock.advance(100);
      r.engine.frame();
      await tick(2);
    }
    expect(warn.mock.calls.some((c) => /watchdog.*not drawn/.test(String(c[0])))).toBe(true);
  });

  it('does not fire for a view that is just converging, or once it is done', async () => {
    const r = rig();
    r.launcher.pollMs = 1;
    const clock = manualClock();
    for (let i = 0; i < 50; i++) {
      r.engine.frame();
      await tick(2);
      clock.advance(200);
    }
    expect(r.engine.watchdogFires).toBe(0);
    expect(r.engine.status().samples).toBeGreaterThan(0);
  });

  it('draws from a timer when the page stops calling frame() while it is visible', async () => {
    const r = rig();
    await r.run(60);
    const draws = r.canvas.draws;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    // No frame() for over WATCHDOG.frameMs: the engine's own timer draws.
    await tick(WATCHDOG.frameMs + 1300);
    expect(warn.mock.calls.some((c) => /no frame drawn/.test(String(c[0])))).toBe(true);
    expect(r.canvas.draws).toBeGreaterThan(draws);
  }, 10000);
});

describe('the canvas shows the project as it is', () => {
  it('the scene on screen is the scene of the project, after a change too', async () => {
    const r = rig();
    await r.run(80);
    let st = r.engine.status();
    expect(st.shownKey).toBeTruthy();
    expect(st.shownKey).toBe(st.wantKey);
    r.change();
    st = r.engine.status();
    expect(st.wantKey).not.toBe(st.shownKey);
    // (A change right after another renders at reduced resolution first, then at full.)
    await r.run(500);
    st = r.engine.status();
    expect(st.shownKey).toBe(st.wantKey);
  });
});

describe('the end of a job', () => {
  it('may come apart from its last pass (no data): the viewport keeps the image and knows it converged; Render gets it', async () => {
    const r = rig();
    r.launcher.doneApart = true;
    r.launcher.viewportSamples = 6; // passes of 1, 2, 3 samples
    r.launcher.pollMs = 2;
    await r.run(200);
    const st = r.engine.status();
    expect(st).toMatchObject({ samples: 6, converged: true });
    expect(st.shownKey).toBe(st.wantKey);
    expect(r.engine.watchdogFires).toBe(0);
    // A Render reads its image once it is done, so the end without data does not lose it.
    const px = await r.engine.renderPixels({ width: 4, height: 3, maxSamples: 4, maxSeconds: 0, transparent: false });
    expect(px.samples).toBe(4);
  });
});

describe('while a Render runs', () => {
  it('the viewport asks for a quarter of the threads and the meter says it shares them', async () => {
    expect([viewportShare(1), viewportShare(4), viewportShare(16)]).toEqual([1, 1, 4]);
    const r = rig(16);
    await r.run(40);
    expect(r.launcher.log.find((l) => l.startsWith('POST'))).toContain('&share=4');
    r.launcher.viewportFlags = FLAG_SHARED;
    r.launcher.viewportThreads = 4;
    await r.run(60);
    expect(r.engine.status()).toMatchObject({ rendering: true, renderShare: 'SHARED', share: { n: 4, of: 16 } });
    expect(r.engine.status().samples).toBeGreaterThan(0);
    // Pause the viewport (fastest render): no share; the launcher says it waits.
    r.engine.setWhileRender('PAUSE');
    await r.run(60);
    expect(r.launcher.log.filter((l) => l.startsWith('POST')).at(-1)).not.toContain('share=');
    r.launcher.viewportFlags = FLAG_PAUSED;
    await r.run(60);
    expect(r.engine.status()).toMatchObject({ rendering: true, renderShare: 'PAUSED' });
  });

  it('Pause rejects at once even if the launcher never answers, and cancels the job', async () => {
    const r = rig();
    r.launcher.hangPolls = true;
    const stop = new AbortController();
    const pending = r.engine.renderPixels({ width: 4, height: 3, maxSamples: 4, maxSeconds: 0, transparent: false, signal: stop.signal });
    await tick(20);
    expect(r.engine.status().rendering).toBe(true);
    const t0 = performance.now();
    stop.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(performance.now() - t0).toBeLessThan(200);
    await tick(10);
    expect(r.launcher.log.some((l) => /^DELETE \/api\/render\/\d+$/.test(l))).toBe(true);
    expect(r.engine.status().rendering).toBe(false);
    // Its connection is free again.
    expect(r.launcher.queued).toBe(0);
  });
});
