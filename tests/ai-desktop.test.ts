// The desktop AI pipeline end to end (phase X3c): the real launcher (engine/crates/rt-app, the `repackshot`
// binary) with its runtime replaced by the fake `rt-fake-sd` installed where the real stable-diffusion.cpp build
// would be, and the page's own code around it: the native engine renders a final that leaves its linear image and
// passes in the launcher, the queue posts it by id through the desktop service (src/io/ai-post.ts), the launcher
// tiles it, runs the fake, guards it with rt-post and answers; the AI image is written as the engine's file was and
// both land in the results history with the report. Skipped where the launcher has not been built
// (`cargo build -p rt-app`) or on another system than Linux x86-64 (the fake stands in for that build).

import { spawn, type ChildProcess } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildPrompt, guardMaterials } from '../src/ai/prompt';
import type { AiPostService, LinearImage } from '../src/core/ai';
import { AI_GUARD_PASSES, pipelineOf, withGuardTolerances } from '../src/core/ai-post';
import { defaultSettings, withSetting } from '../src/core/settings';
import { FLOOR_ID } from '../src/core/passes';
import type { ResultMeta } from '../src/core/results';
import { createStore } from '../src/core/store';
import { DesktopAiService, type AiPostState } from '../src/io/ai-post';
import { encodePng16 } from '../src/io/image';
import { NativeClient, type NativeInfo } from '../src/io/native';
import { memoryResultsStore } from '../src/io/results';
import { projectScene, tonemapFor, writeRsb } from '../src/io/rsb';
import { NativeEngine } from '../src/render/native';
import { exactWords16, straightWords16 } from '../src/render/tiles';
import * as cmd from '../src/ui/commands';
import type { AiPort, AppServices, FrameRequest, FrameResult } from '../src/ui/ports';
import type { Ctx } from '../src/ui/reactive';
import { queueSettled } from '../src/ui/render-queue';
import { createUiStore } from '../src/ui/ui-state';
import { passScene } from './browser/pass-scene';

// Vitest runs from the repository's root.
const ROOT = resolve('.');
const newest = (names: string[]): string | null => {
  const found = names.map((n) => join(ROOT, 'engine', 'target', n)).filter((p) => existsSync(p));
  found.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return found[0] ?? null;
};
const LAUNCHER = newest(['debug/repackshot', 'release/repackshot']);
const FAKE = LAUNCHER ? join(LAUNCHER, '..', 'rt-fake-sd') : null;
const HERE = process.platform === 'linux' && process.arch === 'x64';
const READY = HERE && !!LAUNCHER && !!FAKE && existsSync(FAKE);

const W = 160;
const H = 96;

interface Launcher {
  proc: ChildProcess;
  base: string;
  native: NativeClient;
  runtimeDir: string;
  dir: string;
}

/** The fake in place of the pinned Linux CPU build, a model "downloaded", the launcher serving. */
async function startLauncher(): Promise<Launcher> {
  const dir = mkdtempSync(join(tmpdir(), 'repack-x3c-'));
  const data = join(dir, 'data');
  const app = join(dir, 'app');
  mkdirSync(app, { recursive: true });
  writeFileSync(join(app, 'index.html'), '<!doctype html><title>Repackshot</title>');
  const runtimes = JSON.parse(readFileSync(join(ROOT, 'src/data/ai-runtimes.json'), 'utf8')) as { runtimes: { key: string; os: string; arch: string; backend: string; sha256: string; archive: { server: string; cli: string } }[] };
  const build = runtimes.runtimes.find((r) => r.os === 'linux' && r.arch === 'x86_64' && r.backend === 'CPU')!;
  const runtimeDir = join(data, 'ai', 'runtimes', build.sha256);
  mkdirSync(runtimeDir, { recursive: true });
  for (const name of [build.archive.server, build.archive.cli]) {
    copyFileSync(FAKE!, join(runtimeDir, name));
    chmodSync(join(runtimeDir, name), 0o755);
  }
  writeFileSync(join(runtimeDir, 'repackshot-runtime.json'), JSON.stringify({ key: build.key, sha256: build.sha256 }));
  writeFileSync(join(runtimeDir, 'fake-sd.json'), JSON.stringify({ image: 'gain', stepMs: 5 }));
  const models = JSON.parse(readFileSync(join(ROOT, 'src/data/ai-models.json'), 'utf8')) as { models: { key: string; files: { sha256: string }[] }[] };
  mkdirSync(join(data, 'models', 'blobs'), { recursive: true });
  for (const f of models.models.find((m) => m.key === 'ZIMAGE_Q4')!.files) writeFileSync(join(data, 'models', 'blobs', f.sha256), 'fake weights');
  const proc = spawn(LAUNCHER!, ['--serve-only', '--data-dir', data, '--app-dir', app, '--threads', '2'], { stdio: ['ignore', 'pipe', 'pipe'] });
  const url = await new Promise<string>((ok, fail) => {
    let out = '';
    const timer = setTimeout(() => fail(new Error(`the launcher did not start: ${out}`)), 60000);
    proc.stdout!.on('data', (b: Uint8Array) => {
      out += new TextDecoder().decode(b);
      const m = /(http:\/\/127\.0\.0\.1:\d+)\/#token=([0-9a-f]+)/.exec(out);
      if (m) {
        clearTimeout(timer);
        ok(m[0]);
      }
    });
    proc.on('exit', (code) => fail(new Error(`the launcher exited (${code}): ${out}`)));
  });
  const m = /(http:\/\/127\.0\.0\.1:\d+)\/#token=([0-9a-f]+)/.exec(url)!;
  const base = m[1];
  const token = m[2];
  const fetchFn = (path: string, init?: RequestInit) => fetch(base + path, init);
  const info = (await (await fetchFn('/api/info', { headers: { 'X-Repackshot-Token': token } })).json()) as NativeInfo;
  return { proc, base, native: new NativeClient(token, info, fetchFn), runtimeDir, dir };
}

const sceneSource = {
  build(state: Parameters<typeof projectScene>[0], view: Parameters<typeof projectScene>[1]) {
    const { scene, meshKey } = projectScene(state, view);
    return { meshKey, bytes: (meshes: boolean) => writeRsb(scene, { meshes }) };
  },
  tone: (state: Parameters<typeof projectScene>[0]) => ({ exposureEv: state.image.exposureEv, tonemap: tonemapFor(state.image.viewTransform) }),
};

/** A queue context whose services are main.ts's for the desktop: the native engine, 16-bit PNG files, the launcher's AI. */
function desktopCtx(l: Launcher, service: AiPostService) {
  const engine = new NativeEngine(l.native, sceneSource, { threads: 2, isa: 'scalar' });
  const results = memoryResultsStore();
  const files: { name: string; bytes: Uint8Array }[] = [];
  const store = createStore(passScene(W, H));
  store.dispatch({ type: 'meta/rename', name: 'Desk' });
  store.dispatch({ type: 'render/set', patch: { width: W, height: H, format: 'PNG', bitDepth: 16, maxSamples: 2, finishBy: 'SAMPLES', transparent: false } });
  const ai: AiPort = {
    service,
    frame: async () => {
      throw new Error('no preview in this test');
    },
    passes: async () => {
      throw new Error('the RENDER source needs no passes from the page');
    },
    decode: async () => {
      throw new Error('the RENDER source decodes nothing');
    },
    // main.ts's encodeLinear with the render's tone, at 16 bits.
    encode: async (img: LinearImage, o) => new Blob([(await encodePng16({ width: img.width, height: img.height, data: straightWords16(img.rgba, o.tone!.exposureEv, o.tone!.tonemap) }, { dpi: o.dpi })) as Uint8Array<ArrayBuffer>], { type: 'image/png' }),
    scenePrompt: (state, settings) => buildPrompt(state, settings ?? pipelineOf(state.render.ai)),
    materials: (state, camera) => guardMaterials(state, projectScene(state, { width: 16, height: 16, maxSamples: 1, maxSeconds: 0, ...(camera ? { camera } : {}) }).materialOrder),
    renderSource: async () => true,
  };
  const services = {
    viewport: null,
    async renderFrame(req: FrameRequest): Promise<FrameResult> {
      // main.ts's renderFrame for a 16-bit PNG on the native engine.
      const kept = req.aiPasses === true;
      const px = await engine.renderPixels({ state: store.get(), width: req.width, height: req.height, finishBy: req.finishBy, maxSamples: req.maxSamples, maxSeconds: req.maxSeconds, transparent: req.transparent, keepLinear: true, ...(req.signal ? { signal: req.signal } : {}), ...(kept ? { passes: AI_GUARD_PASSES, passesInLauncher: true } : {}) });
      const words = exactWords16(px.sum!, px.samples, px.exposureEv, px.tonemap);
      const file = new Blob([(await encodePng16({ width: px.width, height: px.height, data: words }, { dpi: req.dpi })) as Uint8Array<ArrayBuffer>], { type: 'image/png' });
      return { file, display: null, width: px.width, height: px.height, samples: px.samples, seconds: px.seconds, tone: { exposureEv: px.exposureEv, tonemap: px.tonemap }, ...(kept && px.renderId !== undefined ? { renderId: String(px.renderId) } : {}) };
    },
    results: {
      persistent: async () => results.persistent,
      list: () => results.list(),
      add: (m: ResultMeta, file: Blob, display: Blob | null, aiBlob?: Blob | null, more?: readonly (Blob | null)[]) => results.add(m, file, display, aiBlob, more),
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
        files.push({ name, bytes: new Uint8Array(await blob.arrayBuffer()) });
        return 'DOWNLOAD' as const;
      },
      openFolder: async () => {},
    },
    ai,
  } as Partial<AppServices> as AppServices;
  const ctx: Ctx = { store, ui: createUiStore(), services };
  return { ctx, files, engine };
}

const withAi = (ctx: Ctx, patch: Record<string, unknown>) => ctx.store.dispatch({ type: 'render/set', patch: { ai: { ...ctx.store.get().render.ai, enabled: true, ...patch } } });
const sidecar = async (l: Launcher) => ((await (await l.native.request('/api/ai/runtime?device=cpu&model=ZIMAGE_Q4')).json()) as { sidecar: { state: string } }).sidecar.state;
const starts = (l: Launcher) => (existsSync(join(l.runtimeDir, 'args.log')) ? readFileSync(join(l.runtimeDir, 'args.log'), 'utf8').trim().split('\n').length : 0);

describe.skipIf(!READY)('the desktop AI pipeline against the real launcher and the fake runtime', () => {
  let l: Launcher;
  const query = () => ({ force: null, cpu: true, model: 'ZIMAGE_Q4' });

  beforeAll(async () => {
    l = await startLauncher();
  }, 120000);

  afterAll(async () => {
    if (!l) return;
    await l.native.request('/api/ai/sidecar', { method: 'DELETE' }).catch(() => undefined);
    l.proc.kill();
    await new Promise((r) => setTimeout(r, 200));
    rmSync(l.dir, { recursive: true, force: true });
  });

  it('is available: the launcher reports the pipeline, the runtime and the model', async () => {
    expect(l.native.info.aiPost).toBe(1);
    const st = await new DesktopAiService(l.native, query).status();
    expect(st).toMatchObject({ available: true, backend: 'CPU', activeModel: 'ZIMAGE_Q4' });
    expect(st.supports).toContain('ZIMAGE_Q4');
  });

  it('Intervention 0: the AI image is the engine’s file bit for bit, and the runtime never starts', async () => {
    const { ctx, files } = desktopCtx(l, new DesktopAiService(l.native, query));
    withAi(ctx, { intervention: 0 });
    await cmd.renderNow(ctx);
    await queueSettled(ctx);
    expect(ctx.store.get().render.queue[0].status).toBe('DONE');
    expect(files.map((f) => f.name)).toEqual(['Desk_Camera 1_0001.png', 'Desk_Camera 1_0001_AI.png']);
    expect(files[1].bytes).toEqual(files[0].bytes);
    const [r] = ctx.ui.get().results;
    expect(r.ai!.report).toMatchObject({ verdict: 'ACCEPTED', attempts: 0, usedFraction: 1, modelKey: 'ZIMAGE_Q4' });
    expect(starts(l)).toBe(0);
    expect(await sidecar(l)).toBe('stopped');
  }, 120000);

  it('a final render with AI leaves both images and the report in the history', async () => {
    const service = new DesktopAiService(l.native, query);
    const { ctx, files } = desktopCtx(l, service);
    withAi(ctx, { intervention: 60, light: 80, bounce: 40, styleStrength: 40, style: 'WARM', seed: 3 });
    await cmd.renderNow(ctx);
    await queueSettled(ctx);
    const job = ctx.store.get().render.queue[0];
    expect(job.status, job.error ?? '').toBe('DONE');
    expect(files.map((f) => f.name)).toEqual(['Desk_Camera 1_0001.png', 'Desk_Camera 1_0001_AI.png']);
    expect(files[1].bytes).not.toEqual(files[0].bytes);
    const [r] = ctx.ui.get().results;
    expect(r.ai!.report).toMatchObject({ verdict: 'ACCEPTED', attempts: 1, modelKey: 'ZIMAGE_Q4', runtime: 'SDCPP_LINUX_CPU', seed: 3 });
    // The guard's table came from the page: the scene's materials by name, and the studio floor by its own.
    const names = r.ai!.report.materials.map((m) => m.name);
    expect(names).toContain('Floor');
    expect(r.ai!.report.materials.find((m) => m.materialId === FLOOR_ID)?.ok).toBe(true);
    expect(names.some((n) => n !== 'Floor' && !n.startsWith('#'))).toBe(true);
    const kept = await ctx.services.results.get(r.id);
    expect(new Uint8Array(await kept!.file.arrayBuffer())).toEqual(files[0].bytes);
    expect(new Uint8Array(await kept!.ai!.arrayBuffer())).toEqual(files[1].bytes);
    // The runtime was asked with the real prompt and the fixed negative, one tile at its padded size.
    const req = readFileSync(join(l.runtimeDir, 'requests.log'), 'utf8').trim().split('\n').map((x) => JSON.parse(x) as Record<string, unknown>).pop()!;
    expect(req.prompt).toMatch(/^Professional product photograph/);
    expect(String(req.negative_prompt)).toContain('changed shape');
    expect([req.width, req.height]).toEqual([W, H]);
    expect(await sidecar(l)).toBe('ready');
  }, 180000);

  it('C1: the guard tolerances of Settings reach the launcher’s guard: its report checks against them', async () => {
    let settings = withSetting(withSetting(withSetting(defaultSettings(), 'ai.guardDeltaE', 7.5), 'ai.guardDeltaE95', 9), 'ai.guardEdgePx', 6);
    const service = withGuardTolerances(new DesktopAiService(l.native, query), () => settings);
    const { ctx } = desktopCtx(l, service);
    withAi(ctx, { intervention: 60, light: 80, seed: 4 });
    await cmd.renderNow(ctx);
    await queueSettled(ctx);
    const job = ctx.store.get().render.queue[0];
    expect(job.status, job.error ?? '').toBe('DONE');
    const [r] = ctx.ui.get().results;
    expect(r.ai!.report.edges.limit).toBe(6);
    expect(r.ai!.report.materials.every((m) => m.limit === 7.5)).toBe(true);
    // Back to the factory values: the launcher's provisional ones, the same numbers.
    settings = defaultSettings();
    const again = desktopCtx(l, service);
    withAi(again.ctx, { intervention: 60, light: 80, seed: 4 });
    await cmd.renderNow(again.ctx);
    await queueSettled(again.ctx);
    const [r2] = again.ctx.ui.get().results;
    expect(r2.ai!.report.edges.limit).toBe(settings['ai.guardEdgePx']);
    expect(r2.ai!.report.materials.every((m) => m.limit === settings['ai.guardDeltaE'])).toBe(true);
  }, 240000);

  it('three variants (X4b): one render, three posts of the kept render with consecutive seeds, the runtime started once', async () => {
    const service = new DesktopAiService(l.native, query);
    const { ctx, files } = desktopCtx(l, service);
    const logged = () => (existsSync(join(l.runtimeDir, 'requests.log')) ? readFileSync(join(l.runtimeDir, 'requests.log'), 'utf8').trim().split('\n').filter(Boolean).map((x) => JSON.parse(x) as Record<string, unknown>) : []);
    const before = logged().length;
    const startsBefore = starts(l);
    let renders = 0;
    const renderFrame = ctx.services.renderFrame.bind(ctx.services);
    (ctx.services as { renderFrame: typeof renderFrame }).renderFrame = (req) => (renders++, renderFrame(req));
    withAi(ctx, { intervention: 60, light: 80, seed: 20, variants: 3 });
    await cmd.renderNow(ctx);
    await queueSettled(ctx);
    const job = ctx.store.get().render.queue[0];
    expect(job.status, job.error ?? '').toBe('DONE');
    expect(renders).toBe(1);
    expect(files.map((f) => f.name)).toEqual(['Desk_Camera 1_0001.png', 'Desk_Camera 1_0001_AI.png', 'Desk_Camera 1_0001_AI_2.png', 'Desk_Camera 1_0001_AI_3.png']);
    // The runtime was asked three times, one tile each, with the job's seed and the two after it.
    const asked = logged().slice(before);
    expect(asked.map((r) => r.seed)).toEqual([20, 21, 22]);
    // The model stayed loaded: the runtime did not start again for the second and third (it may have started once).
    expect(starts(l) - startsBefore).toBeLessThanOrEqual(1);
    const [r] = ctx.ui.get().results;
    const variants = [r.ai!, ...(r.aiMore ?? [])];
    expect(variants.map((v) => [v.report.verdict, v.report.seed])).toEqual([
      ['ACCEPTED', 20],
      ['ACCEPTED', 21],
      ['ACCEPTED', 22],
    ]);
    const kept = await ctx.services.results.get(r.id);
    expect(new Uint8Array(await kept!.aiMore![1]!.arrayBuffer())).toEqual(files[3].bytes);
    expect(await sidecar(l)).toBe('ready');
  }, 240000);

  it('cancelling mid-way keeps the engine’s image and stops the launcher’s post', async () => {
    writeFileSync(join(l.runtimeDir, 'fake-sd.json'), JSON.stringify({ image: 'gain', stepMs: 400 }));
    try {
      const service = new DesktopAiService(l.native, query);
      const { ctx, files } = desktopCtx(l, service);
      withAi(ctx, { intervention: 100, light: 80 });
      await cmd.renderNow(ctx);
      const deadline = Date.now() + 120000;
      while (ctx.store.get().render.running?.ai?.stage !== 'INFERENCE') {
        if (Date.now() > deadline) throw new Error('the AI step never ran');
        await new Promise((r) => setTimeout(r, 20));
      }
      cmd.stopJob(ctx, ctx.store.get().render.queue[0].id);
      await queueSettled(ctx);
      expect(ctx.store.get().render.queue[0].status).toBe('CANCELLED');
      expect(files.map((f) => f.name)).toEqual(['Desk_Camera 1_0001.png']);
      const results = ctx.ui.get().results;
      expect(results).toHaveLength(1);
      expect(results[0].ai).toBeUndefined();
      // The launcher stops its post too (the cancel reaches the runtime between two of its looks at it): soon no
      // post of this launcher is running, and the last one ended cancelled.
      const states = async () => {
        const out: string[] = [];
        for (let id = 1; id <= 12; id++) {
          const res = await l.native.request(`/api/ai/post/${id}`);
          if (res.ok) out.push(((await res.json()) as AiPostState).state);
          else await res.text();
        }
        return out;
      };
      const until = Date.now() + 30000;
      let seen = await states();
      while (seen.some((st) => !['DONE', 'FAILED', 'CANCELLED'].includes(st)) && Date.now() < until) {
        await new Promise((r) => setTimeout(r, 100));
        seen = await states();
      }
      expect(seen.at(-1)).toBe('CANCELLED');
      expect(seen.filter((st) => !['DONE', 'FAILED', 'CANCELLED'].includes(st))).toEqual([]);
      // The model stays loaded for the next one.
      expect(await sidecar(l)).toBe('ready');
    } finally {
      writeFileSync(join(l.runtimeDir, 'fake-sd.json'), JSON.stringify({ image: 'gain', stepMs: 5 }));
    }
  }, 180000);
});
