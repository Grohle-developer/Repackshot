// Phase U11, live denoise of the Full viewport: one switch (the top bar's Denoise, the meter's button, `D` and the
// Viewport part of Render settings ▸ Advanced ▸ Denoise are the same project state, through the store, undoable,
// saved), off to the hand in Fast mode, in both languages and in the guided tour; and the launcher's engine
// (render/native.ts) turning it on the job it follows without posting the view again. The pool's lane is in
// tests/pathtracer.test.ts, the launcher's in rt-app (render.rs, tests/parity.rs).

import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { advancedTouchesView, defaultRenderSettings, DEFAULT_ADVANCED } from '../src/core/render';
import { createInitialState, createStore, type ProjectState } from '../src/core/store';
import { parseProject, serializeProject } from '../src/io/project';
import { FLAG_DENOISED, NativeEngine, parseFrame } from '../src/render/native';
import { ALBEDO_BIT, PassAccumulator } from '../src/render/pass-planes';
import { tileGrid } from '../src/render/tiles';
import type { SceneSource } from '../src/render/pathtracer';
import * as cmd from '../src/ui/commands';
import type { AppServices } from '../src/ui/ports';
import type { Ctx } from '../src/ui/reactive';
import { ACTIONS, actionById, shortcutGroup } from '../src/ui/shortcuts';
import { setLang, STRINGS, t } from '../src/ui/strings';
import { stepWords, TOUR_STEPS } from '../src/ui/tour';
import { createUiStore, type UiState } from '../src/ui/ui-state';
import { frameBytes, installDom, LauncherMock, viewBytes } from './launcher-mock';

function makeCtx(ui: Partial<UiState> = { viewportMode: 'FULL', engine: 'READY' }): Ctx {
  return { store: createStore(createInitialState()), ui: createUiStore(ui), services: {} as unknown as AppServices };
}

afterEach(() => setLang('en'));

describe('one switch: the top bar, the meter, D and Advanced ▸ Denoise ▸ Viewport', () => {
  it('is the Viewport part of the project’s Advanced ▸ Denoise, on by default', () => {
    const ctx = makeCtx();
    expect(ctx.store.get().render.advanced.denoise).toBe('BOTH');
    expect(cmd.viewportDenoiseOn(ctx.store.get())).toBe(true);
    for (const [mode, on] of [['OFF', false], ['VIEWPORT', true], ['RENDER', false], ['BOTH', true]] as const) {
      const s = ctx.store.get();
      expect(cmd.viewportDenoiseOn({ ...s, render: { ...s.render, advanced: { ...s.render.advanced, denoise: mode } } }), mode).toBe(on);
    }
  });

  it('turns through the store: only the Viewport part, one undo step each, with its words', () => {
    const ctx = makeCtx();
    cmd.toggleViewportDenoise(ctx);
    expect(ctx.store.get().render.advanced.denoise).toBe('RENDER');
    expect(ctx.store.history().undo[0]).toBe(t('undo.denoiseOff'));
    cmd.toggleViewportDenoise(ctx);
    expect(ctx.store.get().render.advanced.denoise).toBe('BOTH');
    expect(ctx.store.history().undo[0]).toBe(t('undo.denoiseOn'));
    ctx.store.undo();
    expect(ctx.store.get().render.advanced.denoise).toBe('RENDER');
    ctx.store.undo();
    expect(ctx.store.get().render.advanced.denoise).toBe('BOTH');
    ctx.store.redo();
    expect(ctx.store.get().render.advanced.denoise).toBe('RENDER');
    // From Viewport only: off is Off, and back.
    ctx.store.dispatch({ type: 'render/set', patch: { advanced: { ...DEFAULT_ADVANCED, denoise: 'VIEWPORT' } }, label: { en: 'x', es: 'x' } });
    cmd.toggleViewportDenoise(ctx);
    expect(ctx.store.get().render.advanced.denoise).toBe('OFF');
    // The other Advanced settings are kept.
    expect({ ...ctx.store.get().render.advanced, denoise: 'VIEWPORT' }).toEqual({ ...DEFAULT_ADVANCED, denoise: 'VIEWPORT' });
  });

  it('turns the project’s settings even while the render window edits a job of the queue', () => {
    const ctx = makeCtx();
    const draft = defaultRenderSettings();
    ctx.ui.set({ renderWindow: { kind: 'EDIT', jobId: 'j1', draft } as never });
    cmd.toggleViewportDenoise(ctx);
    expect(ctx.store.get().render.advanced.denoise).toBe('RENDER');
    expect((ctx.ui.get().renderWindow as unknown as { draft: typeof draft }).draft).toBe(draft);
  });

  it('is off to the hand in Fast mode: the reason, and the command does nothing but say it', () => {
    for (const ui of [{ viewportMode: 'FAST' as const, engine: 'READY' as const }, { viewportMode: 'FULL' as const, engine: 'NO_WASM' as const }]) {
      const ctx = makeCtx(ui);
      expect(cmd.viewportDenoiseReason(ctx)).toBe('header.denoiseFastTip');
      const before = ctx.store.get();
      cmd.toggleViewportDenoise(ctx);
      expect(ctx.store.get()).toBe(before);
      expect(ctx.ui.get().toasts.map((x) => x.text)).toEqual([t('header.denoiseFastTip')]);
    }
    expect(cmd.viewportDenoiseReason(makeCtx())).toBeNull();
    expect([STRINGS.en['header.denoiseFastTip'], STRINGS.es['header.denoiseFastTip']]).toEqual(['Applies to Full mode', 'Se aplica al modo Completo']);
  });

  it('is saved with the project and opens as it was saved', () => {
    const ctx = makeCtx();
    cmd.toggleViewportDenoise(ctx);
    return serializeProject(ctx.store.get())
      .text()
      .then((text) => expect(parseProject(text).render.advanced.denoise).toBe('RENDER'));
  });

  it('never starts the viewport’s image over (the other Advanced settings do)', () => {
    const a = DEFAULT_ADVANCED;
    expect(advancedTouchesView(a, { ...a })).toBe(false);
    expect(advancedTouchesView(a, { ...a, denoise: 'RENDER' })).toBe(false);
    expect(advancedTouchesView(a, { ...a, denoise: 'OFF', saveNoisy: true })).toBe(false);
    expect(advancedTouchesView(a, { ...a, seed: 3 })).toBe(true);
    expect(advancedTouchesView(a, { ...a, caustics: 'OFF' })).toBe(true);
    expect(advancedTouchesView(a, { ...a, maxBounces: 4 })).toBe(true);
  });

  it('the top bar, the meter and D all run that command and show that state', () => {
    const header = readFileSync('src/ui/panels/header.ts', 'utf8');
    const meter = readFileSync('src/ui/panels/viewport-overlays.ts', 'utf8');
    for (const src of [header, meter]) {
      expect(src).toContain('cmd.toggleViewportDenoise(ctx)');
      expect(src).toContain('cmd.viewportDenoiseOn(');
      // Nobody writes the denoise mode by hand any more.
      expect(src).not.toContain('toggledViewportDenoise');
    }
    const ctx = makeCtx();
    const action = actionById('viewportDenoise')!;
    expect(action.keys).toBe('d');
    void action.run(ctx);
    expect(ctx.store.get().render.advanced.denoise).toBe('RENDER');
    expect(shortcutGroup('viewportDenoise')).toBe('view');
    // A key of its own.
    const keys = ACTIONS.flatMap((a) => [a.keys, ...(a.altKeys ?? [])]).filter(Boolean);
    expect(keys.filter((k) => k === 'd')).toHaveLength(1);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('has its words in both languages and the guided tour’s Fast and Full step names it with its key', () => {
    for (const k of ['header.denoise', 'header.denoiseTip', 'header.denoiseFastTip', 'action.viewportDenoise', 'undo.denoiseOn', 'undo.denoiseOff'] as const) {
      expect(STRINGS.en[k], k).toBeTruthy();
      expect(STRINGS.es[k], k).toBeTruthy();
    }
    expect([STRINGS.en['header.denoise'], STRINGS.es['header.denoise']]).toEqual(['Denoise', 'Reducir ruido']);
    const step = TOUR_STEPS.find((s) => s.id === 'mode')!;
    expect(step.targets).toEqual(['viewport-mode']);
    for (const lang of ['en', 'es'] as const) {
      setLang(lang);
      const text = stepWords(step).text;
      expect(text, lang).toContain(STRINGS[lang]['header.denoise']);
      expect(text, lang).toContain('(D)');
    }
    // The area the step rings holds both controls.
    expect(readFileSync('src/ui/panels/header.ts', 'utf8')).toMatch(/h\('div', \{ class: 'hdr-mode', 'data-guide': 'viewport-mode' \}, mode\.el, denoise\)/);
  });
});

describe('the guides of a live view (U11)', () => {
  it('take the albedo of later samples after a gap (the switch was off), in index order still; a Render’s do not', () => {
    const tiles = tileGrid(4, 2, 32);
    const sample = (v: number) => new Float32Array(4 * 2 * 3).fill(v);
    const live = new PassAccumulator(4, 2, ALBEDO_BIT, tiles, { gaps: true });
    expect(live.addAlbedo(0, 0, 1, sample(0.2))).toBe(true);
    // Samples 1 .. 9 rendered without albedo: sample 10 is taken, an older one is not.
    expect(live.addAlbedo(0, 10, 1, sample(0.6))).toBe(true);
    expect(live.addAlbedo(0, 5, 1, sample(0.9))).toBe(false);
    expect(live.albedoSamples[0]).toBe(2);
    expect(Array.from(live.resolve().albedo!.subarray(0, 3)).map((v) => Math.round(v * 100) / 100)).toEqual([0.4, 0.4, 0.4]);
    const render = new PassAccumulator(4, 2, ALBEDO_BIT, tiles);
    expect(render.addAlbedo(0, 0, 1, sample(0.2))).toBe(true);
    expect(render.addAlbedo(0, 10, 1, sample(0.6))).toBe(false);
  });
});

// ------------------------------------------------------------------ the launcher's engine

/** A scene source whose bytes say the view's size (and the view, so the denoise does not change them). */
function source(): SceneSource {
  return {
    build: (_s, view) => ({ meshKey: 'm', bytes: (meshes) => viewBytes(view.width, view.height, meshes, (view.denoise ?? 0) + 1) }),
    tone: () => ({ exposureEv: 0, tonemap: 1 }),
  };
}

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

describe('the launcher’s Full viewport turns its live denoise on the job it follows (U11)', () => {
  let restore: (() => void) | null = null;
  const engines: NativeEngine[] = [];
  beforeEach(() => {
    restore = installDom().restore;
  });
  afterEach(() => {
    engines.splice(0).forEach((e) => e.setActive(false));
    restore?.();
  });

  function rig(samples = 1 << 30): { launcher: LauncherMock; engine: NativeEngine; state: ProjectState } {
    const launcher = new LauncherMock();
    launcher.viewportSamples = samples;
    const engine = new NativeEngine({ request: launcher.request }, source(), { threads: 8, isa: 'avx2' });
    engines.push(engine);
    const dom = installDom();
    engine.mount(dom.canvas as unknown as HTMLCanvasElement);
    const state = createInitialState({ lang: 'en', theme: 'dark' });
    engine.sync(state, null);
    engine.resize(8, 6, 1);
    engine.setActive(true);
    return { launcher, engine, state };
  }

  async function until(engine: NativeEngine, cond: () => boolean, ms = 10000): Promise<boolean> {
    const end = performance.now() + ms;
    while (!cond()) {
      if (performance.now() > end) return false;
      engine.frame();
      await tick(3);
    }
    return true;
  }

  const withDenoise = (s: ProjectState, denoise: 'OFF' | 'VIEWPORT' | 'RENDER' | 'BOTH'): ProjectState => ({ ...s, render: { ...s.render, advanced: { ...s.render.advanced, denoise } } });

  it('posts the view with its switch, turns it without posting the view again, and follows the image by its number', async () => {
    const { launcher, engine, state } = rig();
    expect(await until(engine, () => (engine.status().passes ?? 0) >= 2)).toBe(true);
    const views = () => launcher.log.filter((l) => l.startsWith('POST /api/render?'));
    expect(views()).toHaveLength(1);
    expect(views()[0]).toContain('&denoise=1');
    expect(launcher.log.some((l) => /^GET \/api\/render\/\d+\?after=\d+&version=\d+$/.test(l))).toBe(true);
    expect(engine.status().denoised).toBe(true);
    // Off: the launcher hears it; the view goes on (no new view posted) and its next image is the noisy one.
    const off = withDenoise(state, 'RENDER');
    engine.sync(off, state);
    expect(await until(engine, () => launcher.log.some((l) => /^POST \/api\/render\/\d+\/denoise\?on=0$/.test(l)))).toBe(true);
    expect(await until(engine, () => engine.status().denoised !== true)).toBe(true);
    // On again.
    engine.sync(state, off);
    expect(await until(engine, () => launcher.log.some((l) => /^POST \/api\/render\/\d+\/denoise\?on=1$/.test(l)))).toBe(true);
    expect(await until(engine, () => engine.status().denoised === true)).toBe(true);
    expect(views()).toHaveLength(1);
    expect(engine.status().liveDenoise?.images).toBeGreaterThan(0);
  });

  it('a view that is over is followed again for the image the switch asks for', async () => {
    const { launcher, engine, state } = rig(6);
    const off = withDenoise(state, 'OFF');
    engine.sync(off, state);
    // Posted on, turned off before or after: either way it ends noisy.
    expect(await until(engine, () => engine.status().converged === true && engine.status().denoised !== true)).toBe(true);
    const polls = launcher.log.filter((l) => l.startsWith('GET /api/render/')).length;
    engine.sync(state, off);
    expect(await until(engine, () => engine.status().denoised === true)).toBe(true);
    expect(launcher.log.filter((l) => l.startsWith('GET /api/render/')).length).toBeGreaterThan(polls);
    expect(launcher.log.filter((l) => l.startsWith('POST /api/render?'))).toHaveLength(1);
    expect(engine.status().converged).toBe(true);
  });

  it('frames carry the number of their image; a header of before has none', () => {
    const f = parseFrame(frameBytes({ pass: 2, samples: 3, width: 1, height: 1, flags: FLAG_DENOISED, version: 7 }).buffer as ArrayBuffer);
    expect([f.version, f.flags & FLAG_DENOISED]).toEqual([7, FLAG_DENOISED]);
    const old = new Uint8Array(48);
    old.set(frameBytes({ pass: 2, samples: 3, width: 1, height: 1, flags: 0 }).subarray(0, 48));
    new DataView(old.buffer).setUint32(4, 48, true);
    expect(parseFrame(old.buffer).version).toBe(0);
  });
});
