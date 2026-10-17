// Phase N2, queue, passes and batches: cameras × studios become jobs and files named by the template, the queue keeps its
// order and a cancelled job leaves the next ones, the passes come back as files beside the image, and the files of a
// batch go into a ZIP of our own when the last job ends. The engine, the files and the history are fakes; the store, the
// commands, the runner and the ZIP writer are the real ones, and the ZIP is read back by fflate.

import { unzipSync } from 'three/examples/jsm/libs/fflate.module.js';
import { afterEach, describe, expect, it } from 'vitest';
import { addItem, emptyLibrary, fromCurrentStudio, type Library } from '../src/core/library';
import { passFileNames, type PassesOutput } from '../src/core/pass-files';
import { batchSize, expandJobs, jobStudio, migrateRender, normaliseStudio, patchSettings, settingsOf, studiosOf, type RenderSettings, type StudioRef } from '../src/core/render';
import { repeatedNames, zipFileName } from '../src/core/name-template';
import { createStore, type ProjectState } from '../src/core/store';
import { zipStore } from '../src/io/zip';
import { memoryResultsStore } from '../src/io/results';
import * as cmd from '../src/ui/commands';
import type { AppServices, FrameRequest, FrameResult } from '../src/ui/ports';
import type { Ctx } from '../src/ui/reactive';
import { flushIdleZips, jobFileNames, jobProject, pendingZipFiles, queueSettled, studioRefs } from '../src/ui/render-queue';
import { setLang } from '../src/ui/strings';
import { createUiStore } from '../src/ui/ui-state';
import { apply, exampleState } from './helpers';

const NOW = 1_700_000_000_000;

interface Fake {
  ctx: Ctx;
  requests: FrameRequest[];
  /** Everything saved, in order: the name and the bytes' length. */
  saved: { name: string; blob: Blob }[];
  hold: boolean;
  /** Holds only the render of this request number (1-based) until `release()`. */
  holdAt: number | null;
  release(): void;
  fail: ((req: FrameRequest) => string | null) | null;
  archiveFails: boolean;
}

/** A project with two saved studios (Studio A is the Jewellery type, Studio B the Watch one) and a second camera. */
function makeCtx(opts: { archive?: boolean } = {}): Fake {
  const results = memoryResultsStore();
  let waiters: (() => void)[] = [];
  const fake: Fake = {
    ctx: null as unknown as Ctx,
    requests: [],
    saved: [],
    hold: false,
    holdAt: null,
    release: () => {
      const w = waiters;
      waiters = [];
      w.forEach((fn) => fn());
    },
    fail: null,
    archiveFails: false,
  };
  const services = {
    viewport: null,
    renderImage: async () => new Blob(),
    async renderFrame(req: FrameRequest): Promise<FrameResult> {
      fake.requests.push(req);
      const reason = fake.fail?.(req) ?? null;
      if (reason) throw new Error(reason);
      if (fake.hold || fake.holdAt === fake.requests.length) {
        await new Promise<void>((resolve, reject) => {
          waiters.push(resolve);
          req.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        });
      }
      req.onProgress?.(0.5, 2, 0.1);
      // The pass files, named as the real service names them (core/pass-files.ts).
      const extras = req.passes && req.imageName ? passFileNames(req.imageName, req.passes).map((name) => ({ name, blob: new Blob([`pass ${name}`]) })) : undefined;
      return { file: new Blob([`image ${req.camera ?? 'active'}:${req.state?.studio.preset ?? 'open'}`]), display: null, width: req.width, height: req.height, samples: 4, seconds: 0.25, ...(extras ? { extras } : {}) };
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
      save: async (_dest, name, blob) => {
        fake.saved.push({ name, blob });
        return 'DOWNLOAD' as const;
      },
      openFolder: async () => {},
    },
    ...(opts.archive === false
      ? {}
      : {
          archive: {
            zip: async (entries: readonly { name: string; data: Blob }[]) => {
              if (fake.archiveFails) throw new Error('no memory');
              return zipStore(entries, { date: new Date(2026, 9, 17, 12, 0, 0) });
            },
          },
        }),
  } as Partial<AppServices> as AppServices;
  const base = exampleState();
  const cam1 = base.camera.cameras.cam1;
  let state: ProjectState = { ...base, camera: { ...base.camera, cameras: { ...base.camera.cameras, cam2: { ...cam1, id: 'cam2', name: 'Top' } } } };
  state = apply(state, { type: 'meta/rename', name: 'Bottle' });
  const store = createStore(state);
  let lib: Library = emptyLibrary();
  for (const [id, name, preset] of [['std-a', 'Studio A', 'JEWELLERY'], ['std-b', 'Studio B', 'WATCH']] as const) {
    const s = apply(state, { type: 'studio/setPreset', key: preset }, { type: 'studio/build' });
    lib = addItem(lib, fromCurrentStudio(s, lib, name, { id, now: NOW }));
  }
  const ui = createUiStore();
  ui.set({ library: lib });
  fake.ctx = { store, ui, services };
  return fake;
}

const tick = () => new Promise((r) => setTimeout(r, 0));
const statuses = (f: Fake) => f.ctx.store.get().render.queue.map((j) => j.status);
const names = (f: Fake) => f.saved.map((x) => x.name);
const read = async (b: Blob) => unzipSync(new Uint8Array(await b.arrayBuffer()));

afterEach(() => setLang('en'));

describe('cameras × studios: the jobs and their names', () => {
  const refs: StudioRef[] = [
    { id: 'std-a', name: 'Studio A' },
    { id: 'std-b', name: 'Studio B' },
  ];

  it('a 2 × 2 batch is four jobs, camera by camera, each with its camera and its studio, numbered in order', () => {
    const f = makeCtx();
    const st = f.ctx.store.get();
    const s: RenderSettings = { ...settingsOf(st.render), name: '{project}_{camera}_{studio}', camera: { kind: 'ALL' }, studio: { kind: 'ALL' } };
    expect(batchSize(st, s, refs)).toBe(4);
    const jobs = expandJobs(st, s, NOW, refs);
    expect(jobs.map((j) => [j.seq, j.settings.camera, jobStudio(j)?.name])).toEqual([
      [1, { kind: 'ONE', id: 'cam1' }, 'Studio A'],
      [2, { kind: 'ONE', id: 'cam1' }, 'Studio B'],
      [3, { kind: 'ONE', id: 'cam2' }, 'Studio A'],
      [4, { kind: 'ONE', id: 'cam2' }, 'Studio B'],
    ]);
    expect(new Set(jobs.map((j) => j.id)).size).toBe(4);
    // The names of the template with the project, the camera and the studio: four different files.
    const files = jobs.flatMap((j) => jobFileNames({ ...st, render: { ...st.render, queue: jobs } }, j, new Date(2026, 9, 17)));
    expect(files).toEqual(['Bottle_Camera 1_Studio A.png', 'Bottle_Camera 1_Studio B.png', 'Bottle_Top_Studio A.png', 'Bottle_Top_Studio B.png']);
    expect(repeatedNames(files)).toEqual([]);
  });

  it('a template without the camera, the studio or the number would give the same name twice, and says which', () => {
    const f = makeCtx();
    const st = f.ctx.store.get();
    const s: RenderSettings = { ...settingsOf(st.render), name: '{project}', camera: { kind: 'ALL' }, studio: { kind: 'ALL' } };
    const files = expandJobs(st, s, NOW, refs).flatMap((j) => jobFileNames(st, j));
    expect(files).toEqual(['Bottle.png', 'Bottle.png', 'Bottle.png', 'Bottle.png']);
    expect(repeatedNames(files)).toEqual(['Bottle.png']);
    expect(repeatedNames(['A.png', 'a.PNG', 'b.png', 'b.png', 'b.png'])).toEqual(['A.png', 'b.png']);
    expect(repeatedNames([])).toEqual([]);
  });

  it('one studio, the scene as it is, All studios with none saved, and an animation: the choices and what they stand for', () => {
    expect(studiosOf({ kind: 'CURRENT' }, refs)).toEqual([null]);
    expect(studiosOf({ kind: 'ONE', id: 'std-b', name: 'Studio B' }, refs)).toEqual([{ id: 'std-b', name: 'Studio B' }]);
    expect(studiosOf({ kind: 'ALL' }, refs)).toEqual(refs);
    expect(studiosOf({ kind: 'ALL' }, [])).toEqual([null]);
    expect(studiosOf({ kind: 'ALL' }, refs, true)).toEqual([null]);
    expect(studiosOf(undefined, refs)).toEqual([null]);
    const f = makeCtx();
    const st = f.ctx.store.get();
    // One camera, all studios: two jobs. All cameras, the current scene: two jobs (as before N2).
    expect(batchSize(st, { ...settingsOf(st.render), studio: { kind: 'ALL' } }, refs)).toBe(2);
    expect(batchSize(st, { ...settingsOf(st.render), camera: { kind: 'ALL' } }, refs)).toBe(2);
    expect(batchSize(st, { ...settingsOf(st.render), camera: { kind: 'ALL' }, studio: { kind: 'ALL' }, mode: 'ANIMATION' }, refs)).toBe(1);
  });

  it('{studio} is the saved studio of the job, and the product type’s name as before for any other', () => {
    const f = makeCtx();
    const st = f.ctx.store.get();
    const [none] = expandJobs(st, { ...settingsOf(st.render), name: '{studio}' }, NOW);
    expect(jobStudio(none)).toBeNull();
    expect(jobFileNames(st, none)[0]).toBe('Standard.png'); // the product type of the example
    const [one] = expandJobs(st, { ...settingsOf(st.render), name: '{studio}', studio: { kind: 'ONE', id: 'std-b', name: 'Studio B' } }, NOW);
    expect(jobFileNames(st, one)).toEqual(['Studio B.png']);
  });

  it('an animation renders the scene as it is and writes no pass files, whatever the window says', () => {
    const f = makeCtx();
    const st = f.ctx.store.get();
    const s: RenderSettings = { ...settingsOf(st.render), mode: 'ANIMATION', studio: { kind: 'ONE', id: 'std-a', name: 'Studio A' }, passes: { keys: ['depth'], format: 'EXR' } };
    const [job] = expandJobs(st, s, NOW, refs);
    expect(job.settings.studio).toEqual({ kind: 'CURRENT' });
    expect(job.settings.passes.keys).toEqual([]);
    expect(jobStudio(job)).toBeNull();
  });
});

describe('the settings and the jobs keep the new fields', () => {
  it('a settings object of before has no studio, passes or ZIP: the defaults; a bad one is cleaned', () => {
    const base = settingsOf(exampleState().render);
    expect([base.studio, base.passes, base.zip]).toEqual([{ kind: 'CURRENT' }, { keys: [], format: 'EXR' }, false]);
    const { studio: _s, passes: _p, zip: _z, ...old } = base;
    expect(settingsOf(old as RenderSettings)).toMatchObject({ studio: { kind: 'CURRENT' }, passes: { keys: [] }, zip: false });
    const patched = patchSettings(base, { studio: { kind: 'ONE', id: 'x', name: '' }, passes: { keys: ['normal', 'alpha', 'alpha'] as never, format: 'TIFF' as never }, zip: 'yes' as never });
    expect(patched.studio).toEqual({ kind: 'ONE', id: 'x', name: 'x' });
    expect(patched.passes).toEqual({ keys: ['alpha', 'normal'], format: 'EXR' });
    expect(patched.zip).toBe(false);
    expect(normaliseStudio({ kind: 'ONE' }, base.studio)).toBe(base.studio);
    expect(normaliseStudio({ kind: 'ALL' })).toEqual({ kind: 'ALL' });
  });

  it('a project saved before N2 opens with the same queue: no studio, no passes, no ZIP', () => {
    const r = migrateRender({ queue: [{ id: 'j1', seq: 1, status: 'DONE', settings: { name: '{project}_{n}', camera: { kind: 'ONE', id: 'cam1' } } }], seq: 1 });
    expect(r.queue[0]).toMatchObject({ zip: null, settings: { studio: { kind: 'CURRENT' }, passes: { keys: [], format: 'EXR' }, zip: false } });
    // And a job written by N2 keeps its studio, its passes and its ZIP group.
    const again = migrateRender({ ...r, queue: [{ ...r.queue[0], zip: 'z1', settings: { ...r.queue[0].settings, studio: { kind: 'ONE', id: 'std-a', name: 'Studio A' }, passes: { keys: ['depth', 'partId'], format: 'PNG16' }, zip: true } }] });
    expect(again.queue[0]).toMatchObject({ zip: 'z1', settings: { studio: { kind: 'ONE', id: 'std-a', name: 'Studio A' }, passes: { keys: ['depth', 'partId'], format: 'PNG16' }, zip: true } });
  });

  it('Add to queue with All cameras × All studios is one undo entry, and undoing it takes the four jobs out', () => {
    const f = makeCtx();
    const { ctx } = f;
    ctx.store.dispatch({ type: 'render/set', patch: { camera: { kind: 'ALL' }, studio: { kind: 'ALL' } } });
    cmd.enqueue(ctx);
    expect(ctx.store.get().render.queue).toHaveLength(4);
    expect(ctx.store.history().undo[0]).toBe('Add to queue');
    ctx.store.undo();
    expect(ctx.store.get().render.queue).toHaveLength(0);
    expect(ctx.store.get().render.seq).toBe(0);
  });

  it('editing a job with All studios keeps its own studio, as All cameras keeps its camera; the ZIP group follows the switch', () => {
    const f = makeCtx();
    const { ctx } = f;
    ctx.store.dispatch({ type: 'render/set', patch: { studio: { kind: 'ALL' }, zip: true } });
    cmd.enqueue(ctx);
    const q = ctx.store.get().render.queue;
    expect(q.map((j) => j.zip)).toEqual(['z1', 'z1']);
    const draft = { ...q[1].settings, studio: { kind: 'ALL' as const }, zip: false };
    ctx.store.dispatch({ type: 'render/updateJob', id: q[1].id, settings: draft });
    const edited = ctx.store.get().render.queue[1];
    expect([edited.settings.studio, edited.zip]).toEqual([{ kind: 'ONE', id: 'std-b', name: 'Studio B' }, null]);
    // A duplicate starts a ZIP of its own when its settings ask for one.
    cmd.duplicateJob(ctx, q[0].id);
    const copy = ctx.store.get().render.queue[1];
    expect([copy.zip, copy.settings.zip]).toEqual(['z3', true]);
  });

  it('the saved studios the window lists: the library’s, then an older project’s own, without repeats', () => {
    const f = makeCtx();
    expect(studioRefs(f.ctx)).toEqual([
      { id: 'std-a', name: 'Studio A' },
      { id: 'std-b', name: 'Studio B' },
    ]);
  });
});

describe('a batch at work', () => {
  it('a 2 × 2 batch renders four images, in the order of the queue, each in its studio and through its camera, and leaves the open project as it was', async () => {
    const f = makeCtx();
    const { ctx } = f;
    const before = ctx.store.get();
    ctx.store.dispatch({ type: 'render/set', patch: { name: '{project}_{camera}_{studio}', camera: { kind: 'ALL' }, studio: { kind: 'ALL' } } });
    await cmd.renderNow(ctx);
    await queueSettled(ctx);
    expect(statuses(f)).toEqual(['DONE', 'DONE', 'DONE', 'DONE']);
    expect(names(f)).toEqual(['Bottle_Camera 1_Studio A.png', 'Bottle_Camera 1_Studio B.png', 'Bottle_Top_Studio A.png', 'Bottle_Top_Studio B.png']);
    expect(f.requests.map((r) => r.camera)).toEqual(['cam1', 'cam1', 'cam2', 'cam2']);
    // The studio is on the copy the engine gets: the Jewellery type for A, the Watch one for B; the camera's view is the job's own.
    expect(f.requests.map((r) => r.state?.studio.preset)).toEqual(['JEWELLERY', 'WATCH', 'JEWELLERY', 'WATCH']);
    expect(f.requests.map((r) => r.state?.camera.cameras[r.camera!])).toEqual(f.requests.map((r) => before.camera.cameras[r.camera!]));
    // The open project is the one it was: not a studio restored, not a camera moved, no undo entry for the batch's work.
    expect(ctx.store.get().studio.preset).toBe(before.studio.preset);
    expect(ctx.store.get().camera).toBe(before.camera);
    expect(ctx.store.history().undo.filter((x) => /studio/i.test(x))).toEqual([]);
    // Every image is in the history, with its own name.
    expect(ctx.ui.get().results.map((r) => r.name).sort()).toEqual([...names(f)].sort());
  });

  it('the order of the queue is the order of the renders, and cancelling the second leaves the third (it is rendered after the first)', async () => {
    const f = makeCtx();
    const { ctx } = f;
    for (const w of [640, 800, 1024]) {
      ctx.store.dispatch({ type: 'render/set', patch: { width: w, height: 480 } });
      cmd.enqueue(ctx);
    }
    // Run the queue with the second job held: stop it while it renders.
    f.holdAt = 2;
    cmd.toggleQueue(ctx);
    await tick();
    await tick();
    expect(statuses(f)).toEqual(['DONE', 'RUNNING', 'QUEUED']);
    cmd.stopJob(ctx, ctx.store.get().render.queue[1].id);
    await queueSettled(ctx);
    expect(statuses(f)).toEqual(['DONE', 'CANCELLED', 'DONE']);
    expect(f.requests.map((r) => r.width)).toEqual([640, 800, 1024]);
    expect(names(f)).toEqual(['Bottle_Camera 1_0001.png', 'Bottle_Camera 1_0003.png']);
  });

  it('removing the second job while the first renders leaves the third, which renders next', async () => {
    const f = makeCtx();
    const { ctx } = f;
    for (const w of [640, 800, 1024]) {
      ctx.store.dispatch({ type: 'render/set', patch: { width: w, height: 480 } });
      cmd.enqueue(ctx);
    }
    f.holdAt = 1;
    cmd.toggleQueue(ctx);
    await tick();
    await tick();
    expect(statuses(f)).toEqual(['RUNNING', 'QUEUED', 'QUEUED']);
    cmd.removeJob(ctx, ctx.store.get().render.queue[1].id);
    f.release();
    await queueSettled(ctx);
    expect(statuses(f)).toEqual(['DONE', 'DONE']);
    expect(f.requests.map((r) => r.width)).toEqual([640, 1024]);
    expect(names(f)).toEqual(['Bottle_Camera 1_0001.png', 'Bottle_Camera 1_0003.png']);
  });

  it('a studio that is not saved any more fails its job with the reason, and the next job goes on', async () => {
    const f = makeCtx();
    const { ctx } = f;
    ctx.store.dispatch({ type: 'render/set', patch: { name: '{studio}', studio: { kind: 'ALL' } } });
    cmd.enqueue(ctx);
    // Studio A is deleted from the library after the jobs were made.
    ctx.ui.set({ library: { ...ctx.ui.get().library, studios: ctx.ui.get().library.studios.filter((x) => x.id !== 'std-a') } });
    cmd.toggleQueue(ctx);
    await queueSettled(ctx);
    const [a, b] = ctx.store.get().render.queue;
    expect([a.status, a.error, b.status]).toEqual(['FAILED', 'The studio “Studio A” is not saved any more', 'DONE']);
    expect(names(f)).toEqual(['Studio B.png']);
    expect(() => jobProject(ctx, a)).toThrow(/Studio A/);
  });

  it('a studio of a batch does not go through the AI, and says so', async () => {
    const f = makeCtx();
    const { ctx } = f;
    (ctx.services as { ai?: unknown }).ai = { service: {} };
    ctx.store.dispatch({ type: 'render/set', patch: { studio: { kind: 'ONE', id: 'std-a', name: 'Studio A' }, ai: { ...settingsOf(ctx.store.get().render).ai, enabled: true } } });
    await cmd.renderNow(ctx);
    await queueSettled(ctx);
    expect(statuses(f)).toEqual(['DONE']);
    expect(ctx.ui.get().toasts.map((x) => x.text)).toContain('AI post-processing does not run on a studio of a batch (Studio A): the engine image is saved');
  });
});

describe('the passes beside the image', () => {
  const passes: PassesOutput = { keys: ['alpha', 'depth', 'partId'], format: 'EXR' };

  it('the request carries the passes and the image’s name; the files come back and are saved under it, the legend too', async () => {
    const f = makeCtx();
    const { ctx } = f;
    ctx.store.dispatch({ type: 'render/set', patch: { passes } });
    await cmd.renderNow(ctx);
    await queueSettled(ctx);
    expect(f.requests[0].passes).toEqual(passes);
    expect(f.requests[0].imageName).toBe('Bottle_Camera 1_0001.png');
    expect(names(f)).toEqual(['Bottle_Camera 1_0001.png', 'Bottle_Camera 1_0001_alpha.exr', 'Bottle_Camera 1_0001_depth.exr', 'Bottle_Camera 1_0001_partId.exr', 'Bottle_Camera 1_0001_partId.json']);
    expect(ctx.ui.get().toasts.at(-1)?.text).toBe('Saved Bottle_Camera 1_0001.png and 4 pass files');
    // The history keeps the image once.
    expect(ctx.ui.get().results).toHaveLength(1);
  });

  it('no passes asked: nothing is requested and nothing extra is saved; an animation never asks', async () => {
    const f = makeCtx();
    const { ctx } = f;
    await cmd.renderNow(ctx);
    await queueSettled(ctx);
    expect(f.requests[0].passes).toBeUndefined();
    expect(names(f)).toEqual(['Bottle_Camera 1_0001.png']);
    const g = makeCtx();
    g.ctx.store.dispatch({ type: 'render/set', patch: { passes, mode: 'ANIMATION' } });
    await cmd.renderNow(g.ctx);
    await queueSettled(g.ctx);
    expect(g.requests.every((r) => r.passes === undefined)).toBe(true);
  });

  it('the engine failing to give the passes fails the job with the reason and saves nothing of it', async () => {
    const f = makeCtx();
    const { ctx } = f;
    f.fail = (req) => (req.passes ? 'The engine returned no passes' : null);
    ctx.store.dispatch({ type: 'render/set', patch: { passes } });
    await cmd.renderNow(ctx);
    await queueSettled(ctx);
    expect(ctx.store.get().render.queue[0]).toMatchObject({ status: 'FAILED', error: 'The engine returned no passes' });
    expect(f.saved).toEqual([]);
  });
});

describe('the ZIP of a batch', () => {
  it('a 2 × 2 batch to Downloads is one ZIP once the fourth ends, with the four images (and nothing before)', async () => {
    const f = makeCtx();
    const { ctx } = f;
    ctx.store.dispatch({ type: 'render/set', patch: { name: '{project}_{camera}_{studio}', camera: { kind: 'ALL' }, studio: { kind: 'ALL' }, zip: true } });
    f.holdAt = 4;
    await cmd.renderNow(ctx);
    await tick();
    await tick();
    // Three are done and packed in memory; the fourth is rendering: nothing was saved yet.
    expect(statuses(f)).toEqual(['DONE', 'DONE', 'DONE', 'RUNNING']);
    expect(f.saved).toEqual([]);
    expect(pendingZipFiles(ctx)).toBe(3);
    f.release();
    await queueSettled(ctx);
    expect(names(f)).toEqual(['Bottle_0001-0004.zip']);
    expect(pendingZipFiles(ctx)).toBe(0);
    const files = await read(f.saved[0].blob);
    expect(Object.keys(files)).toEqual(['Bottle_Camera 1_Studio A.png', 'Bottle_Camera 1_Studio B.png', 'Bottle_Top_Studio A.png', 'Bottle_Top_Studio B.png']);
    expect(new TextDecoder().decode(files['Bottle_Top_Studio B.png'])).toBe('image cam2:WATCH');
    expect(ctx.ui.get().toasts.at(-1)?.text).toBe('Saved Bottle_0001-0004.zip · 4 files');
    // One history entry per image, as without the ZIP.
    expect(ctx.ui.get().results).toHaveLength(4);
  });

  it('the passes go into the same ZIP, beside their image', async () => {
    const f = makeCtx();
    const { ctx } = f;
    ctx.store.dispatch({ type: 'render/set', patch: { name: '{project}_{studio}', studio: { kind: 'ALL' }, zip: true, passes: { keys: ['depth', 'normal'], format: 'PNG16' } } });
    await cmd.renderNow(ctx);
    await queueSettled(ctx);
    expect(names(f)).toEqual(['Bottle_0001-0002.zip']);
    expect(Object.keys(await read(f.saved[0].blob)).sort()).toEqual(['Bottle_Studio A.png', 'Bottle_Studio A_depth.png', 'Bottle_Studio A_normal.png', 'Bottle_Studio B.png', 'Bottle_Studio B_depth.png', 'Bottle_Studio B_normal.png']);
  });

  it('a job stopped in the middle leaves the others’ files, and the ZIP is written when the rest has ended', async () => {
    const f = makeCtx();
    const { ctx } = f;
    ctx.store.dispatch({ type: 'render/set', patch: { name: '{project}_{camera}_{studio}', studio: { kind: 'ALL' }, zip: true } });
    cmd.enqueue(ctx);
    ctx.store.dispatch({ type: 'render/set', patch: { camera: { kind: 'ONE', id: 'cam2' } } });
    cmd.enqueue(ctx);
    expect(ctx.store.get().render.queue.map((j) => j.zip)).toEqual(['z1', 'z1', 'z3', 'z3']);
    f.holdAt = 2;
    cmd.toggleQueue(ctx);
    await tick();
    await tick();
    cmd.stopJob(ctx, ctx.store.get().render.queue[1].id);
    await queueSettled(ctx);
    expect(statuses(f)).toEqual(['DONE', 'CANCELLED', 'DONE', 'DONE']);
    // Two groups, two ZIPs: the first has the one image that ended, the second its two.
    expect(names(f)).toEqual(['Bottle_0001.zip', 'Bottle_0003-0004.zip']);
    expect(Object.keys(await read(f.saved[0].blob))).toEqual(['Bottle_Camera 1_Studio A.png']);
    expect(Object.keys(await read(f.saved[1].blob))).toEqual(['Bottle_Camera 1_Studio A.png', 'Bottle_Camera 1_Studio B.png'].map((n) => n.replace('Camera 1', 'Top')));
  });

  it('removing the last waiting job of a batch writes the ZIP of what the others made', async () => {
    const f = makeCtx();
    const { ctx } = f;
    ctx.store.dispatch({ type: 'render/set', patch: { name: '{studio}', studio: { kind: 'ALL' }, zip: true } });
    cmd.enqueue(ctx);
    f.holdAt = 2;
    cmd.toggleQueue(ctx);
    await tick();
    await tick();
    cmd.toggleQueue(ctx); // Pause: the second goes back to waiting
    await queueSettled(ctx);
    expect(statuses(f)).toEqual(['DONE', 'QUEUED']);
    expect(f.saved).toEqual([]);
    expect(pendingZipFiles(ctx)).toBe(1);
    cmd.removeJob(ctx, ctx.store.get().render.queue[1].id);
    await tick();
    await tick();
    expect(names(f)).toEqual(['Bottle_0001.zip']);
    expect(pendingZipFiles(ctx)).toBe(0);
  });

  it('a ZIP that cannot be made saves the files one by one instead, and says so', async () => {
    const f = makeCtx();
    const { ctx } = f;
    f.archiveFails = true;
    ctx.store.dispatch({ type: 'render/set', patch: { name: '{studio}', studio: { kind: 'ALL' }, zip: true } });
    await cmd.renderNow(ctx);
    await queueSettled(ctx);
    expect(names(f)).toEqual(['Studio A.png', 'Studio B.png']);
    expect(ctx.ui.get().toasts.map((x) => x.text)).toContain('Could not make the ZIP (no memory); the files are saved one by one');
  });

  it('without the archive service the files are saved one by one, as before N2', async () => {
    const f = makeCtx({ archive: false });
    const { ctx } = f;
    ctx.store.dispatch({ type: 'render/set', patch: { name: '{studio}', studio: { kind: 'ALL' }, zip: true } });
    await cmd.renderNow(ctx);
    await queueSettled(ctx);
    expect(names(f)).toEqual(['Studio A.png', 'Studio B.png']);
    expect(pendingZipFiles(ctx)).toBe(0);
  });

  it('without a ZIP asked nothing is packed: one save per file', async () => {
    const f = makeCtx();
    const { ctx } = f;
    ctx.store.dispatch({ type: 'render/set', patch: { name: '{studio}', studio: { kind: 'ALL' } } });
    await cmd.renderNow(ctx);
    await queueSettled(ctx);
    expect(names(f)).toEqual(['Studio A.png', 'Studio B.png']);
    await flushIdleZips(ctx);
    expect(names(f)).toHaveLength(2);
  });

  it('names the ZIP from the project and the render numbers', () => {
    expect(zipFileName('Bottle', [3, 1, 4, 2])).toBe('Bottle_0001-0004.zip');
    expect(zipFileName('Bottle', [7])).toBe('Bottle_0007.zip');
    expect(zipFileName('Bottle', [5, 5])).toBe('Bottle_0005.zip');
    expect(zipFileName('a/b:c?', [1, 2])).toBe('abc_0001-0002.zip');
    expect(zipFileName('', [1])).toBe('render_0001.zip');
  });
});
