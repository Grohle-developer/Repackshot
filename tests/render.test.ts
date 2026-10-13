// The render window's model (phase U5, SPEC §3.8): settings and their rules, the queue (Render and
// + Add to queue, All cameras, edit, duplicate, reorder, undo), the U1 migration, animation output.

import { describe, expect, it } from 'vitest';
import {
  carryRuntime,
  defaultRenderSettings,
  estimateSamples,
  estimateSeconds,
  frameRange,
  frameTime,
  matchResolution,
  migrateRender,
  patchSettings,
  settingsOf,
  type RenderJob,
} from '../src/core/render';
import { createInitialState, createStore, type Store } from '../src/core/store';
import { migrateProject, parseProject, PROJECT_FORMAT, PROJECT_SCHEMA, serializeProject } from '../src/io/project';
import u1RenderText from './fixtures/u1-render.json?raw';
import { apply, exampleState } from './helpers';

const u1Render = JSON.parse(u1RenderText) as Record<string, unknown>;

const names = (store: Store) => store.get().render.queue.map((j) => `${j.id}:${j.settings.camera.kind === 'ONE' ? j.settings.camera.id : '-'}:${j.settings.width}`);

describe('render settings', () => {
  it('quality tiers set the sample budget; touching it makes it custom', () => {
    let s = apply(exampleState(), { type: 'render/quality', quality: 'FINAL' });
    expect([s.render.quality, s.render.maxSamples]).toEqual(['FINAL', 1024]);
    s = apply(s, { type: 'render/set', patch: { maxSamples: 300 } });
    expect(s.render.quality).toBe('CUSTOM');
    // A tier chosen with its samples (the window's shortcuts) stays that tier.
    s = apply(s, { type: 'render/set', patch: { quality: 'DRAFT', maxSamples: 64 } });
    expect([s.render.quality, s.render.maxSamples]).toEqual(['DRAFT', 64]);
  });

  it('formats without alpha switch transparency off; 16 bits only in PNG', () => {
    let s = apply(exampleState(), { type: 'render/set', patch: { transparent: true, bitDepth: 16 } });
    expect([s.render.transparent, s.render.bitDepth]).toEqual([true, 16]);
    s = apply(s, { type: 'render/set', patch: { format: 'EXR' } });
    expect([s.render.transparent, s.render.bitDepth]).toEqual([true, 8]);
    s = apply(s, { type: 'render/set', patch: { format: 'JPEG' } });
    expect(s.render.transparent).toBe(false);
    s = apply(s, { type: 'render/set', patch: { bitDepth: 16 } });
    expect(s.render.bitDepth).toBe(8);
  });

  it('sizes are clamped and matched to presets', () => {
    const s = apply(exampleState(), { type: 'render/set', patch: { width: 99999, height: 3 } });
    expect([s.render.width, s.render.height]).toEqual([8192, 16]);
    expect(matchResolution(1920, 1080)).toBe('HD');
    expect(matchResolution(1000, 1000)).toBe('CUSTOM');
  });

  it('the aspect lock: one side typed, the other follows the ratio of when it was locked, without drift', () => {
    let s = defaultRenderSettings();
    expect(s.aspectLock).toBe(true);
    s = patchSettings(s, { width: 1000 });
    expect([s.width, s.height]).toEqual([1000, 563]); // 1000 / (16/9) = 562.5
    s = patchSettings(s, { width: 1920 });
    expect([s.width, s.height]).toEqual([1920, 1080]); // the locked ratio, not 1000 / 563
    s = patchSettings(s, { height: 2160 });
    expect([s.width, s.height]).toEqual([3840, 2160]);
    // Unlocked, each side is free and the ratio follows; locking again keeps the new one.
    s = patchSettings(s, { aspectLock: false });
    s = patchSettings(s, { height: 3840 });
    expect([s.width, s.height]).toEqual([3840, 3840]);
    s = patchSettings(s, { aspectLock: true });
    s = patchSettings(s, { width: 500 });
    expect([s.width, s.height]).toEqual([500, 500]);
    // A preset gives both sides: that is the ratio now.
    s = patchSettings(s, { width: 1080, height: 1350 });
    s = patchSettings(s, { height: 2700 });
    expect([s.width, s.height]).toEqual([2160, 2700]);
  });

  it('video and AI stay off until they exist', () => {
    const s = patchSettings(defaultRenderSettings(), { animation: { ...defaultRenderSettings().animation, output: 'VIDEO' }, ai: { enabled: true } });
    expect(s.animation.output).toBe('FRAMES');
    expect(s.ai.enabled).toBe(false);
  });

  it('a new frame rate keeps the range where it was in time', () => {
    let s = patchSettings(defaultRenderSettings(), { animation: { ...defaultRenderSettings().animation, range: 'RANGE', from: 25, to: 49, fps: 24 } });
    s = patchSettings(s, { animation: { ...s.animation, fps: 48 } });
    expect([s.animation.from, s.animation.to]).toEqual([49, 97]);
    expect(frameTime(s.animation.from, 48)).toBe(1);
  });
});

describe('the queue', () => {
  it('Render puts its job first; + Add to queue puts it last', () => {
    const store = createStore(exampleState());
    store.dispatch({ type: 'render/enqueue', at: 1, position: 'LAST' }); // + Add to queue: A
    store.dispatch({ type: 'render/set', patch: { width: 1000, height: 1000 } });
    store.dispatch({ type: 'render/enqueue', at: 2, position: 'LAST' }); // + Add to queue: B
    store.dispatch({ type: 'render/set', patch: { width: 640, height: 480 } });
    store.dispatch({ type: 'render/enqueue', at: 3, position: 'FIRST' }); // Render: C
    expect(names(store)).toEqual(['j3:cam1:640', 'j1:cam1:1920', 'j2:cam1:1000']);
    expect(store.get().render.queue.map((j) => [j.seq, j.status, j.createdAt])).toEqual([
      [3, 'QUEUED', 3],
      [1, 'QUEUED', 1],
      [2, 'QUEUED', 2],
    ]);
  });

  it('All cameras: one job per camera, in the order of the project', () => {
    const store = createStore(exampleState());
    const s0 = store.get();
    const cams = { ...s0.camera.cameras, cam2: { ...s0.camera.cameras.cam1, id: 'cam2', name: 'Top' }, cam3: { ...s0.camera.cameras.cam1, id: 'cam3', name: 'Side' } };
    store.reset({ ...s0, camera: { ...s0.camera, cameras: cams } });
    store.dispatch({ type: 'render/set', patch: { camera: { kind: 'ALL' } } });
    store.dispatch({ type: 'render/enqueue', at: 1, position: 'LAST' });
    expect(names(store)).toEqual(['j1:cam1:1920', 'j2:cam2:1920', 'j3:cam3:1920']);
    expect(store.get().render.seq).toBe(3);
    // Render with All cameras: all of them first, in order.
    store.dispatch({ type: 'render/enqueue', at: 2, position: 'FIRST' });
    expect(names(store).slice(0, 3)).toEqual(['j4:cam1:1920', 'j5:cam2:1920', 'j6:cam3:1920']);
    // One undo takes the three away.
    store.undo();
    expect(store.get().render.queue).toHaveLength(3);
  });

  it('an animation is one job whatever the camera says (the camera track decides)', () => {
    const store = createStore(exampleState());
    store.dispatch({ type: 'render/set', patch: { mode: 'ANIMATION', camera: { kind: 'ALL' } } });
    store.dispatch({ type: 'render/enqueue', at: 1, position: 'LAST' });
    expect(store.get().render.queue).toHaveLength(1);
    expect(store.get().render.queue[0].settings.camera).toEqual({ kind: 'ACTIVE' });
  });

  it('queue edits are undoable; what a running job reports is not, and undo keeps it', () => {
    const store = createStore(exampleState());
    store.dispatch({ type: 'render/enqueue', at: 1, position: 'LAST', label: 'Add' });
    store.dispatch({ type: 'render/enqueue', at: 2, position: 'LAST', label: 'Add' });
    const [a, b] = store.get().render.queue.map((j) => j.id);
    expect(store.history().undo).toEqual(['Add', 'Add']);
    // Ticks of a running job: no history entries, no dirty mark of their own.
    store.dispatch({ type: 'render/job', id: a, patch: { status: 'RUNNING', progress: 0.1, startedAt: 10 } });
    for (let i = 2; i < 30; i++) store.dispatch({ type: 'render/job', id: a, patch: { progress: i / 30 } });
    store.dispatch({ type: 'render/running', running: { jobId: a, progress: 0.9, samples: 8, seconds: 3 } });
    expect(store.history().undo).toEqual(['Add', 'Add']);
    // Undo the second Add: B goes, A keeps running with its progress.
    store.undo();
    expect(store.get().render.queue.map((j) => [j.id, j.status, j.progress])).toEqual([[a, 'RUNNING', 29 / 30]]);
    expect(store.get().render.running?.jobId).toBe(a);
    store.redo();
    expect(store.get().render.queue.map((j) => j.id)).toEqual([a, b]);
    expect(store.get().render.queue[0].status).toBe('RUNNING');
  });

  it('a job that comes back with an undo is not running any more', () => {
    const store = createStore(exampleState());
    store.dispatch({ type: 'render/enqueue', at: 1, position: 'LAST' });
    const id = store.get().render.queue[0].id;
    store.dispatch({ type: 'render/job', id, patch: { status: 'RUNNING', progress: 0.5, startedAt: 5 } });
    store.dispatch({ type: 'render/removeJob', id });
    store.dispatch({ type: 'render/running', running: null });
    store.undo();
    expect(store.get().render.queue.map((j) => [j.status, j.progress, j.startedAt])).toEqual([['QUEUED', 0, null]]);
  });

  it('carryRuntime keeps a snapshot as it is when nothing ran', () => {
    const s = createInitialState().render;
    expect(carryRuntime(s, s)).toBe(s);
  });

  it('edit, duplicate, reorder, remove and clear finished', () => {
    const store = createStore(exampleState());
    for (let i = 0; i < 3; i++) store.dispatch({ type: 'render/enqueue', at: i, position: 'LAST' });
    const [a, b, c] = store.get().render.queue.map((j) => j.id);
    store.dispatch({ type: 'render/job', id: a, patch: { status: 'DONE', progress: 1, resultIds: ['r1'] } });
    // Edit: new settings; a finished job waits again (its results stay).
    store.dispatch({ type: 'render/updateJob', id: a, settings: { ...settingsOf(store.get().render), width: 800, height: 600, camera: { kind: 'ALL' } } });
    const edited = store.get().render.queue[0];
    expect([edited.settings.width, edited.status, edited.progress, edited.resultIds, edited.settings.camera]).toEqual([800, 'QUEUED', 0, ['r1'], { kind: 'ONE', id: 'cam1' }]);
    // Duplicate: right after it, waiting, a new render number.
    store.dispatch({ type: 'render/duplicateJob', id: b, at: 9 });
    const q = store.get().render.queue;
    expect(q.map((j) => j.id)).toEqual([a, b, 'j4', c]);
    expect([q[2].settings, q[2].seq, q[2].status]).toEqual([q[1].settings, 4, 'QUEUED']);
    // Drag to reorder.
    store.dispatch({ type: 'render/moveJob', id: c, to: 0 });
    expect(store.get().render.queue.map((j) => j.id)).toEqual([c, a, b, 'j4']);
    store.dispatch({ type: 'render/moveJob', id: c, to: 99 });
    expect(store.get().render.queue.map((j) => j.id)).toEqual([a, b, 'j4', c]);
    // A running job cannot be edited.
    store.dispatch({ type: 'render/job', id: b, patch: { status: 'RUNNING' } });
    const before = store.get();
    store.dispatch({ type: 'render/updateJob', id: b, settings: defaultRenderSettings() });
    expect(store.get()).toBe(before);
    // Clear finished.
    store.dispatch({ type: 'render/job', id: c, patch: { status: 'FAILED' } });
    store.dispatch({ type: 'render/job', id: 'j4', patch: { status: 'DONE' } });
    store.dispatch({ type: 'render/clearFinished' });
    expect(store.get().render.queue.map((j) => j.id)).toEqual([a, b]);
    store.dispatch({ type: 'render/removeJob', id: a });
    expect(store.get().render.queue.map((j) => j.id)).toEqual([b]);
  });
});

describe('migration of a U1 project', () => {
  const u1Project = () => ({ format: PROJECT_FORMAT, schema: 1, state: { ...createInitialState(), render: u1Render } });

  it('schema 2 is written', async () => {
    expect(PROJECT_SCHEMA).toBe(2);
    const body = JSON.parse(await serializeProject(createInitialState()).text());
    expect([body.format, body.schema]).toEqual([PROJECT_FORMAT, 2]);
  });

  it('the U1 render block becomes the window settings and full jobs', () => {
    const s = migrateProject(u1Project());
    const r = s.render;
    expect([r.width, r.height, r.aspect, r.quality, r.maxSamples, r.maxSeconds, r.finishBy, r.format, r.transparent, r.bitDepth, r.dpi]).toEqual([
      1080, 1350, 0.8, 'FINAL', 1024, 300, 'FIRST', 'JPEG', false, 8, 300,
    ]);
    expect([r.mode, r.name, r.destination, r.camera, r.ai]).toEqual(['IMAGE', '{project}_{camera}_{n}', { kind: 'DOWNLOADS' }, { kind: 'ACTIVE' }, { enabled: false }]);
    // Nothing runs after a load.
    expect(r.running).toBeNull();
    const [a, b, c] = r.queue as RenderJob[];
    expect([a.id, a.status, a.progress, a.seq, a.settings.name, a.settings.camera, a.settings.width, a.settings.transparent, a.settings.quality, a.settings.finishBy]).toEqual([
      'j1', 'DONE', 1, 1, 'Render 1', { kind: 'ONE', id: 'cam1' }, 1920, true, 'PREVIEW', 'FIRST',
    ]);
    // U1's 0 s was "no time limit": samples only.
    expect([b.status, b.progress, b.startedAt, b.settings.quality, b.settings.maxSamples, b.settings.finishBy, b.settings.camera]).toEqual(['QUEUED', 0, null, 'CUSTOM', 300, 'SAMPLES', { kind: 'ONE', id: 'cam2' }]);
    expect([c.settings.format, c.settings.quality, c.settings.maxSamples]).toEqual(['EXR', 'DRAFT', 64]);
    expect(r.seq).toBe(3);
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });

  it('is idempotent, and a file of this schema goes through it too', () => {
    const once = migrateRender(u1Render);
    expect(migrateRender(JSON.parse(JSON.stringify(once)))).toEqual(once);
    const text = JSON.stringify({ format: PROJECT_FORMAT, schema: 2, state: { ...createInitialState(), render: { ...once, running: { jobId: 'j1', progress: 0.5, samples: 1, seconds: 1 }, queue: once.queue.map((j) => ({ ...j, status: 'RUNNING' })) } } });
    const loaded = parseProject(text);
    expect(loaded.render.running).toBeNull();
    expect(loaded.render.queue.every((j) => j.status === 'QUEUED')).toBe(true);
  });

  it('garbage becomes the defaults; other files are refused', () => {
    expect(migrateRender(null)).toEqual(createInitialState().render);
    expect(migrateRender({ queue: [{ nope: 1 }, 'x', { id: 'j1' }, { id: 'j1' }] }).queue.map((j) => j.id)).toEqual(['j1']);
    expect(() => parseProject('{')).toThrow();
    expect(() => migrateProject({ format: 'other' })).toThrow();
    expect(() => migrateProject({ format: PROJECT_FORMAT, schema: 99, state: {} })).toThrow(/newer/);
  });
});

describe('animation output', () => {
  const a = defaultRenderSettings().animation;

  it('All is every frame of the timeline; a range is from–to, 1-based and inclusive', () => {
    expect(frameRange({ ...a, fps: 24 }, 4)).toEqual({ first: 1, last: 96, count: 96 });
    expect(frameRange({ ...a, fps: 30 }, 0)).toEqual({ first: 1, last: 1, count: 1 });
    expect(frameRange({ ...a, range: 'RANGE', from: 10, to: 12 }, 4)).toEqual({ first: 10, last: 12, count: 3 });
    expect(frameTime(1, 24)).toBe(0);
    expect(frameTime(25, 24)).toBe(1);
  });
});

describe('the estimate', () => {
  const s = { ...defaultRenderSettings(), width: 1000, height: 500, maxSamples: 100, maxSeconds: 60 };

  it('comes from the measured throughput, or says nothing', () => {
    expect(estimateSeconds(s, null)).toBeNull();
    expect(estimateSeconds(s, 1_000_000)).toBe(50);
    expect(estimateSeconds({ ...s, finishBy: 'TIME' }, null)).toBe(60);
    expect(estimateSeconds({ ...s, finishBy: 'FIRST' }, 1_000_000)).toBe(50);
    expect(estimateSeconds({ ...s, finishBy: 'FIRST' }, 100_000)).toBe(60);
    expect(estimateSeconds(s, 1_000_000, 24)).toBe(1200);
    expect(estimateSamples({ ...s, finishBy: 'TIME' }, 1_000_000)).toBe(120);
    expect(estimateSamples(s, null)).toBeNull();
  });
});
