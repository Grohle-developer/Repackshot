// Phase P6, decision 9: a render job through a plugin switched on for jobs. Every image of the job goes through the
// plugin after the engine's is saved: a still with the seed set (seed0), each frame of an animation with seed0 + its
// index in the animation, so what the plugin draws at random is drawn again on every frame and not laid over them
// all; the plugin's images are saved next to the engine's, the first kept in the history with seed0 and the rule.
// The invert test plugin's noise is drawn from its seed: with it, frame 0 and frame 1 differ; without it they do not;
// and the same seed0 twice gives the same bytes. The queue runs with the real host, the worker shim and the service.

import { afterEach, describe, expect, it } from 'vitest';
import { frameControls, frameSeed, NO_PLUGINS, parseManifest, SEED_RULE, seedControl, seedProvenance, withPlugin, type PluginControlValue, type PluginsSettings } from '../src/core/plugins';
import { createStore } from '../src/core/store';
import { encodePng } from '../src/io/image';
import { memoryResultsStore } from '../src/io/results';
import { PluginHost } from '../src/plugins/host';
import { PluginsService } from '../src/plugins/service';
import { memoryPluginStore } from '../src/plugins/store';
import * as cmd from '../src/ui/commands';
import type { AppServices, FrameRequest, FrameResult, PluginsPort } from '../src/ui/ports';
import type { Ctx } from '../src/ui/reactive';
import { queueSettled } from '../src/ui/render-queue';
import { setLang } from '../src/ui/strings';
import { createUiStore } from '../src/ui/ui-state';
import { exampleState } from './helpers';
import { ModuleWorkerShim } from './module-worker-shim';
import { packInvert } from './plugin-fixtures';
import { fixtureDecoder } from './texture-helpers';
import { readFileSync } from 'node:fs';

const W = 12;
const H = 8;
const ID = 'test-invert';

const png = async (img: { width: number; height: number; rgba: Uint8ClampedArray }) => new Blob([(await encodePng({ width: img.width, height: img.height, data: img.rgba })) as Uint8Array<ArrayBuffer>], { type: 'image/png' });
const decode = async (blob: Blob) => {
  const img = await fixtureDecoder(new Uint8Array(await blob.arrayBuffer()), 'PNG');
  return { width: img.width, height: img.height, rgba: new Uint8ClampedArray(img.rgba) };
};

/** The engine's picture: the same on every frame, so that what changes between frames is the plugin's. */
function engineImage(): { width: number; height: number; rgba: Uint8ClampedArray } {
  const rgba = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) rgba.set([20 + 8 * (i % W), 30 + 10 * Math.floor(i / W), 120, 255], 4 * i);
  return { width: W, height: H, rgba };
}

interface Fake {
  ctx: Ctx;
  saved: { name: string; bytes: Uint8Array }[];
  workers: ModuleWorkerShim[];
}

async function makeCtx(opts: { install?: boolean } = {}): Promise<Fake> {
  const f: Fake = { ctx: null as unknown as Ctx, saved: [], workers: [] };
  const pstore = memoryPluginStore();
  const host = new PluginHost({
    store: pstore,
    registry: [],
    fetch: () => Promise.reject(new Error('offline')),
    spawn: (url) => {
      const w = new ModuleWorkerShim(url);
      f.workers.push(w);
      return w;
    },
    createObjectURL: (b) => URL.createObjectURL(b),
    revokeObjectURL: (u) => URL.revokeObjectURL(u),
    now: () => 0,
  });
  await host.start();
  if (opts.install !== false) {
    const pkg = await packInvert();
    expect(await host.installFile(new Blob([pkg.bytes.slice().buffer as ArrayBuffer]), pkg.keyText)).toMatchObject({ kind: 'DONE' });
  }
  const results = memoryResultsStore();
  const svc = new PluginsService({ host, registry: [], result: async (id) => (await results.get(id)) ?? null, decode, decodeExr: () => Promise.reject(new Error('no EXR')), encodePng: png, store: pstore, now: () => performance.now() });
  const plugins: PluginsPort = {
    registry: [],
    snapshot: () => svc.snapshot(),
    subscribe: (fn) => svc.subscribe(fn),
    install: (id) => svc.install(id),
    provideKey: (id, k) => svc.provideKey(id, k),
    cancelInstall: (id) => svc.cancelInstall(id),
    installFile: (file, k) => svc.installFile(file, k),
    remove: (id) => svc.remove(id),
    text: (id, file) => svc.text(id, file),
    presets: (id) => svc.presets(id),
    stop: (id) => svc.stop(id),
    run: (req, signal) => svc.run(req, signal),
    hasBase: (id) => svc.hasBase(id),
    runImage: (req, signal) => svc.runImage(req, signal),
    thumbnails: (id, on, signal) => svc.thumbnails(id, on, signal),
    encode: (img) => png(img),
  };
  const store = createStore(exampleState());
  store.dispatch({ type: 'meta/rename', name: 'Bottle' });
  store.dispatch({ type: 'render/set', patch: { width: W, height: H } });
  const services = {
    viewport: null,
    async renderFrame(req: FrameRequest): Promise<FrameResult> {
      return { file: await png(engineImage()), display: null, width: req.width, height: req.height, samples: 4, seconds: 0.25 };
    },
    results: {
      persistent: async () => results.persistent,
      list: () => results.list(),
      add: (m: Parameters<typeof results.add>[0], file: Blob, display: Blob | null, a?: Blob | null) => results.add(m, file, display, a),
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
        f.saved.push({ name, bytes: new Uint8Array(await blob.arrayBuffer()) });
        return 'DOWNLOAD' as const;
      },
      openFolder: async () => {},
    },
    plugins,
  } as Partial<AppServices> as AppServices;
  const ui = createUiStore();
  ui.set({ plugins: host.snapshot() });
  host.subscribe((snap) => ui.set({ plugins: snap }));
  f.ctx = { store, ui, services };
  return f;
}

const withJobs = (f: Fake, controls: Record<string, PluginControlValue>, jobs = true): PluginsSettings => {
  const s = withPlugin(f.ctx.store.get().render.plugins ?? NO_PLUGINS, ID, { recipe: 'full', controls, jobs });
  f.ctx.store.dispatch({ type: 'render/set', patch: { plugins: s } });
  return s;
};
const animate = (f: Fake, from: number, to: number) => {
  f.ctx.store.dispatch({ type: 'anim/preset', key: 'HERO' });
  f.ctx.store.dispatch({ type: 'render/set', patch: { mode: 'ANIMATION', name: '{project}_{camera}', animation: { ...f.ctx.store.get().render.animation, range: 'RANGE', from, to, fps: 25 } } });
};
const run = async (f: Fake) => {
  f.saved.length = 0;
  cmd.enqueue(f.ctx);
  cmd.toggleQueue(f.ctx);
  await queueSettled(f.ctx);
};
type RenderMsg = { type: string; controls: Record<string, PluginControlValue> };
const seedsSent = (f: Fake) => f.workers.flatMap((w) => w.sent.filter((m) => (m as RenderMsg).type === 'render').map((m) => (m as RenderMsg).controls.seed));
const file = (f: Fake, name: string) => f.saved.find((s) => s.name === name)?.bytes;
const pluginName = (n: number) => `Bottle_Camera 1_000${n}_${ID}.png`;

afterEach(() => setLang('en'));

describe('the seed rule (decision 9)', () => {
  it('seed0 + the frame, wrapped round the slider; only the seed changes; a still is frame 0', () => {
    const m = parseManifest(JSON.parse(readFileSync('tests/fixtures/plugins/invert/manifest.json', 'utf8')));
    if (!m.ok) throw new Error(m.problems.join(', '));
    const c = seedControl(m.manifest)!;
    expect(c.key).toBe('seed');
    expect([frameSeed(c, 7, 0), frameSeed(c, 7, 1), frameSeed(c, 7, 24)]).toEqual([7, 8, 31]);
    // The film plugin's seed is 0…999 999 999; the fixture's 0…1000: past the top it starts again at the bottom.
    expect([frameSeed(c, 1000, 1), frameSeed(c, 999, 3)]).toEqual([0, 1]);
    const base = { amount: 1, channel: 'all', noise: 0.5, seed: 7, mono: false };
    expect(frameControls(m.manifest, base, 2)).toEqual({ ...base, seed: 9 });
    expect(frameControls(m.manifest, base, 0)).toEqual(base);
    expect(seedProvenance(m.manifest, base, 3)).toEqual({ control: 'seed', seed0: 7, frame: 3, rule: SEED_RULE });
    // A plugin without a seed: the same controls on every frame, nothing to record.
    const noSeed = { controls: m.manifest.controls.filter((x) => x.key !== 'seed') };
    expect(frameControls(noSeed, base, 5)).toEqual(base);
    expect(seedProvenance(noSeed, base, 5)).toBeUndefined();
    // A seed is a whole-number slider, one a manifest.
    const raw = JSON.parse(readFileSync('tests/fixtures/plugins/invert/manifest.json', 'utf8')) as { controls: Record<string, unknown>[] };
    const bad = (patch: Record<string, unknown>) => parseManifest({ ...raw, controls: raw.controls.map((x) => (x.key === 'seed' ? { ...x, ...patch } : x)) });
    expect(bad({ step: 0.5 })).toMatchObject({ ok: false });
    expect(bad({ role: 'grain' })).toMatchObject({ ok: false });
    expect(parseManifest({ ...raw, controls: [...raw.controls, { ...raw.controls.find((x) => x.key === 'seed'), key: 'seed2' }] })).toMatchObject({ ok: false, problems: ['controls[5].role (a second seed)'] });
  });
});

describe('a render job through a plugin (decision 9)', { timeout: 60_000 }, () => {
  it('an animation: every frame through the plugin with seed0 + frame; the first kept with seed0 and the rule', async () => {
    const f = await makeCtx();
    withJobs(f, { noise: 0.5, seed: 7 });
    animate(f, 1, 3);
    await run(f);
    expect(f.saved.map((s) => s.name)).toEqual(['Bottle_Camera 1_0001.png', pluginName(1), 'Bottle_Camera 1_0002.png', pluginName(2), 'Bottle_Camera 1_0003.png', pluginName(3)]);
    expect(seedsSent(f)).toEqual([7, 8, 9]);
    // The engine's frames are the same picture; the plugin's differ, frame by frame, where its noise is drawn.
    expect(file(f, 'Bottle_Camera 1_0002.png')).toEqual(file(f, 'Bottle_Camera 1_0001.png'));
    const [a, b, c] = await Promise.all([1, 2, 3].map(async (n) => (await decode(new Blob([file(f, pluginName(n))!.slice().buffer]))).rgba));
    expect(a).not.toEqual(b);
    expect(b).not.toEqual(c);
    // The history: the engine's first frame and, kept after it, the plugin's, with seed0 and the rule.
    const [derived, engine] = f.ctx.ui.get().results;
    expect(engine.name).toBe('Bottle_Camera 1_0001.png');
    expect(derived.name).toBe(pluginName(1));
    expect(derived.provenance).toMatchObject({ plugin: ID, version: '1.0.0', recipe: 'full', from: engine.id, controls: { noise: 0.5, seed: 7 }, seed: { control: 'seed', seed0: 7, frame: 0, rule: 'seed0+frame' } });
    // The same seed0 again: the same bytes, frame for frame.
    const first = [1, 2, 3].map((n) => file(f, pluginName(n)));
    await run(f);
    expect([1, 2, 3].map((n) => file(f, pluginName(n)))).toEqual(first);
    expect(seedsSent(f).slice(3)).toEqual([7, 8, 9]);
  });

  it('where the plugin draws nothing from the seed the frames are the same; a range takes the seeds of its frames', async () => {
    const f = await makeCtx();
    withJobs(f, { noise: 0, seed: 7 });
    animate(f, 1, 2);
    await run(f);
    expect(seedsSent(f)).toEqual([7, 8]);
    expect(file(f, pluginName(2))).toEqual(file(f, pluginName(1)));
    // Frames 3 and 4 alone: seed0 + 2 and seed0 + 3, the grain they have in the whole animation.
    const g = await makeCtx();
    withJobs(g, { noise: 0.5, seed: 7 });
    animate(g, 3, 4);
    await run(g);
    expect(seedsSent(g)).toEqual([9, 10]);
    expect(g.ctx.ui.get().results[0].provenance?.seed).toEqual({ control: 'seed', seed0: 7, frame: 2, rule: SEED_RULE });
  });

  it('a still takes seed0; with the switch off the job leaves the plugin alone; a plugin not installed is said, the render kept', async () => {
    const f = await makeCtx();
    // Undoable, as every setting.
    withJobs(f, { noise: 0.5, seed: 41 });
    f.ctx.store.undo();
    expect(f.ctx.store.get().render.plugins[ID]).toBeUndefined();
    f.ctx.store.redo();
    expect(f.ctx.store.get().render.plugins[ID]).toEqual({ recipe: 'full', controls: { noise: 0.5, seed: 41 }, jobs: true });
    await run(f);
    expect(f.saved.map((s) => s.name)).toEqual(['Bottle_Camera 1_0001.png', pluginName(1)]);
    expect(seedsSent(f)).toEqual([41]);
    expect(f.ctx.ui.get().results[0].provenance?.seed).toMatchObject({ seed0: 41, frame: 0 });
    withJobs(f, { noise: 0.5, seed: 41 }, false);
    await run(f);
    // A still's second render is numbered after the first.
    expect(f.saved.map((s) => s.name)).toEqual(['Bottle_Camera 1_0002.png']);
    const missing = await makeCtx({ install: false });
    withJobs(missing, { noise: 0.5 });
    await run(missing);
    expect(missing.saved.map((s) => s.name)).toEqual(['Bottle_Camera 1_0001.png']);
    expect(missing.ctx.ui.get().toasts.map((x) => x.text)).toContain(`${ID} did not run on Bottle_Camera 1_0001.png: it is not installed. The engine image was saved.`);
  });
});
