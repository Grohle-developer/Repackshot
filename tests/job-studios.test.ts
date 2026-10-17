// Phase N2b, the studio travels with the project: a job over a saved studio keeps a copy of it in the project
// (`render.studios`, once per studio id and content), the file carries it (its images in the `images` block, once), and a
// project opened where the library lacks the studio renders its jobs in the copy. The engine, the files and the history
// are fakes; the store, the commands, the runner and the project file are the real ones.

import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getImage, registerImage, retainImages } from '../src/core/images';
import { canonicalJson, findEmbedded, resolveStudio, studioHash, studiosToAdopt } from '../src/core/job-studios';
import { addItem, emptyLibrary, findItem, fromCurrentStudio, type Library } from '../src/core/library';
import { migrateRender } from '../src/core/render';
import { createInitialState, createStore, type ProjectState } from '../src/core/store';
import { loadHdri } from '../src/io/hdri';
import { migrateProject, readProjectFile, serializeProject } from '../src/io/project';
import { memoryResultsStore } from '../src/io/results';
import * as cmd from '../src/ui/commands';
import type { AppServices, FrameRequest, FrameResult } from '../src/ui/ports';
import type { Ctx } from '../src/ui/reactive';
import { jobProject, queueSettled } from '../src/ui/render-queue';
import { setLang } from '../src/ui/strings';
import { createUiStore } from '../src/ui/ui-state';
import { apply, exampleState } from './helpers';
import v1Text from './fixtures/project-v1.json?raw';
import v2Text from './fixtures/project-v2.json?raw';

const NOW = 1_700_000_000_000;
const fixture = (name: string) => new Uint8Array(readFileSync(`tests/fixtures/${name}`));

interface Fake {
  ctx: Ctx;
  requests: FrameRequest[];
  saved: string[];
}

/** A machine: a store with `state`, a library, and an engine that renders nothing (it keeps what it was asked). */
function machine(state: ProjectState, library: Library = emptyLibrary()): Fake {
  const results = memoryResultsStore();
  const fake: Fake = { ctx: null as unknown as Ctx, requests: [], saved: [] };
  const services = {
    viewport: null,
    renderImage: async () => new Blob(),
    async renderFrame(req: FrameRequest): Promise<FrameResult> {
      fake.requests.push(req);
      req.onProgress?.(0.5, 2, 0.1);
      return { file: new Blob([`image ${req.camera}:${req.state?.studio.preset}`]), display: null, width: req.width, height: req.height, samples: 4, seconds: 0.25 };
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
    project: { serialize: serializeProject, open: (file: File) => readProjectFile(file) },
    projectFiles: { adopt: () => {} } as unknown as AppServices['projectFiles'],
  } as Partial<AppServices> as AppServices;
  const ui = createUiStore();
  ui.set({ library });
  fake.ctx = { store: createStore(state), ui, services };
  return fake;
}

/** The example with a second camera, named Bottle. */
function project(): ProjectState {
  const base = exampleState();
  const cam1 = base.camera.cameras.cam1;
  const state: ProjectState = { ...base, camera: { ...base.camera, cameras: { ...base.camera.cameras, cam2: { ...cam1, id: 'cam2', name: 'Top' } } } };
  return apply(state, { type: 'meta/rename', name: 'Bottle' });
}

/** Studio A (Jewellery, exposure +0.7) and Studio B (Watch, exposure -0.4), saved to a library from `state`. */
function twoStudios(state: ProjectState): Library {
  let lib = emptyLibrary();
  for (const [id, name, preset, ev] of [['std-a', 'Studio A', 'JEWELLERY', 0.7], ['std-b', 'Studio B', 'WATCH', -0.4]] as const) {
    const s = apply(state, { type: 'studio/setPreset', key: preset }, { type: 'studio/build' }, { type: 'image/set', patch: { exposureEv: ev } });
    lib = addItem(lib, fromCurrentStudio(s, lib, name, { id, now: NOW }));
  }
  return lib;
}

/** Saves the project of `from` and opens it on `to`, the way the menu does. */
async function reopen(from: Fake, to: Fake, blob: Blob = serializeProject(from.ctx.store.get())): Promise<void> {
  await cmd.openProjectFile(to.ctx, new File([blob], 'bottle.repack'));
}

const fileBody = async (state: ProjectState) => JSON.parse(await serializeProject(state).text());

beforeEach(() => retainImages([]));
afterEach(() => setLang('en'));

describe('the studio of a batch travels with the project', () => {
  it('a 2 × 2 batch over two library studios, saved, opened where the library is empty, renders each job in its studio', async () => {
    const state = project();
    const here = machine(state, twoStudios(state));
    here.ctx.store.dispatch({ type: 'render/set', patch: { name: '{project}_{camera}_{studio}', camera: { kind: 'ALL' }, studio: { kind: 'ALL' } } });
    cmd.enqueue(here.ctx);
    expect(here.ctx.store.get().render.queue).toHaveLength(4);
    // Another machine, another browser profile: nothing in its library.
    const there = machine(createInitialState());
    await reopen(here, there);
    expect(there.ctx.ui.get().library.studios).toEqual([]);
    expect(there.ctx.store.get().render.queue).toHaveLength(4);
    cmd.toggleQueue(there.ctx);
    await queueSettled(there.ctx);
    const queue = there.ctx.store.get().render.queue;
    expect(queue.map((j) => [j.status, j.error])).toEqual(Array(4).fill(['DONE', null]));
    expect(there.saved).toEqual(['Bottle_Camera 1_Studio A.png', 'Bottle_Camera 1_Studio B.png', 'Bottle_Top_Studio A.png', 'Bottle_Top_Studio B.png']);
    // Each job rendered its studio's settings: the product type, its lights and its exposure, through its own camera.
    expect(there.requests.map((r) => r.camera)).toEqual(['cam1', 'cam1', 'cam2', 'cam2']);
    expect(there.requests.map((r) => r.state?.studio.preset)).toEqual(['JEWELLERY', 'WATCH', 'JEWELLERY', 'WATCH']);
    expect(there.requests.map((r) => r.state?.image.exposureEv)).toEqual([0.7, -0.4, 0.7, -0.4]);
    const lib = here.ctx.ui.get().library;
    const lights = (id: string) => findItem(lib, 'studio', id)!.studio.lights;
    expect(there.requests.map((r) => r.state?.studio.lights)).toEqual([lights('std-a'), lights('std-b'), lights('std-a'), lights('std-b')]);
    // The open project is the one that was opened: the batch put nothing on it.
    expect(there.ctx.store.get().studio.preset).toBe(state.studio.preset);
  });

  it('the copy is the studio as it was when the jobs were made: it wins over a library studio of the same id that changed since (◆)', async () => {
    const state = project();
    const f = machine(state, twoStudios(state));
    f.ctx.store.dispatch({ type: 'render/set', patch: { studio: { kind: 'ONE', id: 'std-a', name: 'Studio A' } } });
    cmd.enqueue(f.ctx);
    // Studio A of the library is saved over, under the same id, with another product type.
    const changed = fromCurrentStudio(apply(state, { type: 'studio/setPreset', key: 'COSMETICS' }, { type: 'studio/build' }), emptyLibrary(), 'Studio A', { id: 'std-a', now: NOW });
    f.ctx.ui.set({ library: { ...f.ctx.ui.get().library, studios: f.ctx.ui.get().library.studios.map((x) => (x.id === 'std-a' ? changed : x)) } });
    const job = f.ctx.store.get().render.queue[0];
    expect(resolveStudio(f.ctx.store.get(), f.ctx.ui.get().library, 'std-a', job.studioCopy)?.from).toBe('PROJECT');
    expect(jobProject(f.ctx, job).studio.preset).toBe('JEWELLERY');
    // A new job of Studio A takes the library's studio as it is now: a second copy, under the same id.
    cmd.enqueue(f.ctx);
    const [a, b] = f.ctx.store.get().render.queue;
    expect(a.studioCopy).not.toBe(b.studioCopy);
    expect(f.ctx.store.get().render.studios.map((e) => e.studio.id)).toEqual(['std-a', 'std-a']);
    expect(jobProject(f.ctx, b).studio.preset).toBe('COSMETICS');
    expect(jobProject(f.ctx, a).studio.preset).toBe('JEWELLERY');
  });
});

describe('a studio is embedded once', () => {
  it('jobs of one studio share one copy, Add to queue twice too; the file holds it once', async () => {
    const state = project();
    const f = machine(state, twoStudios(state));
    f.ctx.store.dispatch({ type: 'render/set', patch: { camera: { kind: 'ALL' }, studio: { kind: 'ONE', id: 'std-b', name: 'Studio B' } } });
    cmd.enqueue(f.ctx);
    cmd.enqueue(f.ctx);
    const r = f.ctx.store.get().render;
    expect(r.queue).toHaveLength(4);
    expect(new Set(r.queue.map((j) => j.studioCopy)).size).toBe(1);
    expect(r.studios).toHaveLength(1);
    expect(r.studios[0].hash).toBe(r.queue[0].studioCopy);
    expect(r.studios[0].hash).toBe(studioHash(r.studios[0].studio));
    const body = await fileBody(f.ctx.store.get());
    expect(body.state.render.studios).toHaveLength(1);
    expect(body.state.render.studios[0].studio.name).toBe('Studio B');
    // The jobs name the copy by its hash, not by carrying the studio.
    expect(body.state.render.queue.map((j: { studioCopy?: string }) => j.studioCopy)).toEqual(Array(4).fill(r.studios[0].hash));
  });

  it('the hash is the content: key order, the id and the name do not change it; a setting does', () => {
    const state = project();
    const lib = twoStudios(state);
    const a = findItem(lib, 'studio', 'std-a')!;
    const st = { ...a.studio, id: 'std-a', name: 'Studio A' };
    // The same content with every object's keys the other way round.
    const flip = (v: unknown): unknown => (Array.isArray(v) ? v.map(flip) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).reverse().map(([k, x]) => [k, flip(x)])) : v);
    const reordered = flip(st) as typeof st;
    expect(JSON.stringify(reordered)).not.toBe(JSON.stringify(st));
    expect(canonicalJson(reordered)).toBe(canonicalJson(st));
    expect(studioHash({ ...reordered, id: 'other', name: 'Renamed' })).toBe(studioHash(st));
    expect(studioHash({ ...st, floor: !st.floor })).not.toBe(studioHash(st));
  });

  it('the copies follow the jobs: undoing the Add takes them out, removing the last job of a studio drops its copy, undo brings it back', () => {
    const state = project();
    const f = machine(state, twoStudios(state));
    const { store } = f.ctx;
    store.dispatch({ type: 'render/set', patch: { studio: { kind: 'ALL' } } });
    cmd.enqueue(f.ctx);
    expect(store.get().render.studios.map((e) => e.studio.name)).toEqual(['Studio A', 'Studio B']);
    const [a] = store.get().render.queue;
    cmd.removeJob(f.ctx, a.id);
    expect(store.get().render.studios.map((e) => e.studio.name)).toEqual(['Studio B']);
    store.undo();
    expect(store.get().render.studios.map((e) => e.studio.name)).toEqual(['Studio A', 'Studio B']);
    store.undo();
    expect(store.get().render.queue).toEqual([]);
    expect(store.get().render.studios).toEqual([]);
    // A duplicate shares the copy of the job it copies.
    store.redo();
    cmd.duplicateJob(f.ctx, store.get().render.queue[0].id);
    expect(store.get().render.queue.map((j) => j.studioCopy)).toEqual([a.studioCopy, a.studioCopy, store.get().render.queue[2].studioCopy]);
    expect(store.get().render.studios).toHaveLength(2);
  });

  it('an edit that keeps the studio keeps the copy; one that moves it to another takes that one and lets the old go', () => {
    const state = project();
    const f = machine(state, twoStudios(state));
    const { store } = f.ctx;
    store.dispatch({ type: 'render/set', patch: { studio: { kind: 'ONE', id: 'std-a', name: 'Studio A' } } });
    cmd.enqueue(f.ctx);
    const job = store.get().render.queue[0];
    // The library's Studio A changes; an edit of the job (its size) still renders the copy it had.
    const changed = fromCurrentStudio(apply(state, { type: 'studio/setPreset', key: 'COSMETICS' }, { type: 'studio/build' }), emptyLibrary(), 'Studio A', { id: 'std-a', now: NOW });
    f.ctx.ui.set({ library: { ...f.ctx.ui.get().library, studios: f.ctx.ui.get().library.studios.map((x) => (x.id === 'std-a' ? changed : x)) } });
    cmd.editJob(f.ctx, job.id);
    cmd.setRenderSettings(f.ctx, { width: 800 });
    cmd.saveJobEdit(f.ctx);
    expect(store.get().render.queue[0].studioCopy).toBe(job.studioCopy);
    expect(jobProject(f.ctx, store.get().render.queue[0]).studio.preset).toBe('JEWELLERY');
    // Moved to Studio B: B's copy comes in, A's goes (no job names it).
    cmd.editJob(f.ctx, job.id);
    cmd.setRenderSettings(f.ctx, { studio: { kind: 'ONE', id: 'std-b', name: 'Studio B' } });
    cmd.saveJobEdit(f.ctx);
    const r = store.get().render;
    expect(r.studios.map((e) => e.studio.id)).toEqual(['std-b']);
    expect(r.queue[0].studioCopy).toBe(r.studios[0].hash);
  });
});

describe('an HDRI studio is not duplicated', () => {
  it('a studio with the project’s HDRI adds its JSON and not the image; reopened in a new session, the copy has the image', async () => {
    const hdri = await loadHdri('studio.hdr', fixture('studio.hdr'), 'hdri:1');
    const s0 = project();
    const state: ProjectState = { ...s0, environment: { ...s0.environment, kind: 'HDRI', hdri } };
    let lib = emptyLibrary();
    lib = addItem(lib, fromCurrentStudio(apply(state, { type: 'image/set', patch: { exposureEv: 1.5 } }), lib, 'HDRI studio', { id: 'std-h', now: NOW }));
    const f = machine(state, lib);
    f.ctx.store.dispatch({ type: 'render/set', patch: { camera: { kind: 'ALL' }, studio: { kind: 'ALL' } } });
    cmd.enqueue(f.ctx);
    const plain = serializeProject(state);
    const withJobs = serializeProject(f.ctx.store.get());
    const body = JSON.parse(await withJobs.text());
    // One image entry, the project's and the copy's alike.
    expect(body.images.map((e: { id: string }) => e.id)).toEqual(['hdri:1']);
    expect(body.state.render.studios).toHaveLength(1);
    expect(body.state.render.studios[0].studio.environment.hdri.id).toBe('hdri:1');
    // The file grows by the copy's JSON (and the jobs), far less than the image's 84 kB of base64.
    const image = body.images[0].file.length;
    expect(withJobs.size - plain.size).toBeLessThan(image / 2);
    // Opened in a new session (the registry empty): the copy names the HDRI the project placed.
    retainImages([]);
    const there = machine(createInitialState());
    await reopen(f, there, withJobs);
    expect(there.ctx.ui.get().toasts.map((x) => x.text).filter((x) => /missing|not/i.test(x))).toEqual([]);
    const opened = there.ctx.store.get();
    const ref = opened.render.studios[0].studio.environment.hdri!;
    expect(ref.id).toBe(opened.environment.hdri!.id);
    expect(getImage(ref.id)!.bytes).toEqual(fixture('studio.hdr'));
    expect(jobProject(there.ctx, opened.render.queue[0]).environment.hdri).toEqual(ref);
    // In a session where `hdri:1` names another image, the project's HDRI and the copy's move to the same new id.
    retainImages([]);
    registerImage('hdri:1', 'other.hdr', { format: 'HDR', bytes: new Uint8Array([1, 2, 3]), width: 1, height: 1, linear: new Float32Array(3) });
    const third = machine(createInitialState());
    await reopen(f, third, withJobs);
    const moved = third.ctx.store.get();
    expect(moved.environment.hdri!.id).not.toBe('hdri:1');
    expect(moved.render.studios[0].studio.environment.hdri).toEqual(moved.environment.hdri);
    expect(getImage(moved.environment.hdri!.id)!.bytes).toEqual(fixture('studio.hdr'));
  });

  it('an HDRI only the studio has travels in the images block too, once for every job, and comes back to the copy', async () => {
    const hdri = await loadHdri('studio.hdr', fixture('studio.hdr'), 'hdri:1');
    const state = project();
    let lib = emptyLibrary();
    lib = addItem(lib, fromCurrentStudio({ ...state, environment: { ...state.environment, kind: 'HDRI', hdri } }, lib, 'HDRI studio', { id: 'std-h', now: NOW }));
    const f = machine(state, lib);
    f.ctx.store.dispatch({ type: 'render/set', patch: { camera: { kind: 'ALL' }, studio: { kind: 'ALL' } } });
    cmd.enqueue(f.ctx);
    const file = serializeProject(f.ctx.store.get());
    const body = JSON.parse(await file.text());
    expect(body.images.map((e: { id: string }) => e.id)).toEqual(['hdri:1']);
    retainImages([]);
    const there = machine(createInitialState());
    await reopen(f, there, file);
    const ref = there.ctx.store.get().render.studios[0].studio.environment.hdri!;
    expect(there.ctx.store.get().environment.hdri).toBeNull();
    expect(getImage(ref.id)!.bytes).toEqual(fixture('studio.hdr'));
  });
});

describe('old projects and missing studios', () => {
  it('projects of before N2b open unchanged: no copies, the same jobs', () => {
    for (const text of [v1Text, v2Text]) {
      const s = migrateProject(JSON.parse(text));
      expect(s.render.studios).toEqual([]);
      expect(s.render.queue.every((j) => !('studioCopy' in j))).toBe(true);
    }
    // A job written by N2 (its studio by id and name, no copy) keeps exactly that.
    const n2 = { queue: [{ id: 'j1', seq: 1, status: 'QUEUED', settings: { camera: { kind: 'ONE', id: 'cam1' }, studio: { kind: 'ONE', id: 'std-a', name: 'Studio A' } } }], seq: 1 };
    const r = migrateRender(n2);
    expect(r.studios).toEqual([]);
    expect(r.queue[0].settings.studio).toEqual({ kind: 'ONE', id: 'std-a', name: 'Studio A' });
    expect('studioCopy' in r.queue[0]).toBe(false);
  });

  it('a job of before N2b renders in the library’s studio, and fails with the reason when neither the project nor the library has it', async () => {
    const state = project();
    const lib = twoStudios(state);
    const job = { id: 'j1', seq: 1, status: 'QUEUED', settings: { name: '{studio}', camera: { kind: 'ONE', id: 'cam1' }, studio: { kind: 'ONE', id: 'std-a', name: 'Studio A' } } };
    const old: ProjectState = { ...state, render: migrateRender({ queue: [job, { ...job, id: 'j2', seq: 2, settings: { ...job.settings, studio: { kind: 'ONE', id: 'std-b', name: 'Studio B' } } }], seq: 2 }) };
    const f = machine(old, { ...lib, studios: lib.studios.filter((x) => x.id === 'std-b') });
    cmd.toggleQueue(f.ctx);
    await queueSettled(f.ctx);
    const [a, b] = f.ctx.store.get().render.queue;
    expect([a.status, a.error, b.status]).toEqual(['FAILED', 'The studio “Studio A” is not saved any more', 'DONE']);
    expect(f.requests.map((r) => r.state?.studio.preset)).toEqual(['WATCH']);
  });

  it('an edit of a job of before N2b gives it a copy of the studio the library has', () => {
    const state = project();
    const job = { id: 'j1', seq: 1, status: 'QUEUED', settings: { camera: { kind: 'ONE', id: 'cam1' }, studio: { kind: 'ONE', id: 'std-a', name: 'Studio A' } } };
    const f = machine({ ...state, render: migrateRender({ queue: [job], seq: 1 }) }, twoStudios(state));
    cmd.editJob(f.ctx, 'j1');
    cmd.saveJobEdit(f.ctx);
    const r = f.ctx.store.get().render;
    expect(r.studios.map((e) => e.studio.id)).toEqual(['std-a']);
    expect(findEmbedded(r.studios, 'std-a', r.queue[0].studioCopy)).toBeTruthy();
  });

  it('a damaged copy is left out, not the project: its job looks the studio up in the library as before', async () => {
    const state = project();
    const f = machine(state, twoStudios(state));
    f.ctx.store.dispatch({ type: 'render/set', patch: { studio: { kind: 'ALL' } } });
    cmd.enqueue(f.ctx);
    const body = await fileBody(f.ctx.store.get());
    body.state.render.studios[0].studio.environment = 'not an environment';
    body.state.render.studios[1].studio.assignments = { n1: { material: 'no-such-material' } };
    const s = migrateProject(body);
    expect(s.render.studios).toEqual([]);
    expect(s.render.queue).toHaveLength(2);
    // A copy that passes keeps what it had, its lights and materials read as the project's.
    const good = migrateProject(await fileBody(f.ctx.store.get()));
    expect(good.render.studios.map((e) => [e.studio.id, e.studio.preset, e.hash])).toEqual(f.ctx.store.get().render.studios.map((e) => [e.studio.id, e.studio.preset, e.hash]));
  });
});

describe('Add to my library', () => {
  it('offers the studios that came in the project and are not in the library, and adds each under its own id', async () => {
    const state = project();
    const here = machine(state, twoStudios(state));
    here.ctx.store.dispatch({ type: 'render/set', patch: { studio: { kind: 'ALL' } } });
    cmd.enqueue(here.ctx);
    // On this machine both are in the library: nothing to offer.
    expect(studiosToAdopt(here.ctx.store.get(), here.ctx.ui.get().library)).toEqual([]);
    const there = machine(createInitialState());
    await reopen(here, there);
    expect(studiosToAdopt(there.ctx.store.get(), there.ctx.ui.get().library).map((x) => x.name)).toEqual(['Studio A', 'Studio B']);
    const revision = there.ctx.store.revision();
    cmd.addProjectStudioToLibrary(there.ctx, 'std-a');
    const lib = there.ctx.ui.get().library;
    expect(lib.studios.map((x) => [x.id, x.name])).toEqual([['std-a', 'Studio A']]);
    expect(findItem(lib, 'studio', 'std-a')!.studio).toEqual(findItem(here.ctx.ui.get().library, 'studio', 'std-a')!.studio);
    expect(studiosToAdopt(there.ctx.store.get(), lib).map((x) => x.name)).toEqual(['Studio B']);
    // The project does not change (the library is the person's), and the job still renders its copy.
    expect(there.ctx.store.revision()).toBe(revision);
    expect(there.ctx.ui.get().toasts.map((x) => x.text)).toContain('Saved “Studio A” to Mine');
    cmd.addProjectStudioToLibrary(there.ctx, 'std-a');
    expect(there.ctx.ui.get().library.studios).toHaveLength(1);
  });
});
