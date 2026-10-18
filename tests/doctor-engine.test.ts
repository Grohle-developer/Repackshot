// Phase D1, the Doctor's checks that read the engine (core/doctor-engine.ts), driven by a fake engine that simulates
// each state the real one can be in: not built, one worker, no simd128, no denoiser, a firefly image, a slow machine.
// The fake sits where the real engine does. It writes what the page knows into the interface state and answers
// `status()` like the viewport engine, and the real `installDoctorFacts` (ui/doctor-facts.ts) hands that to the Doctor;
// so each check goes from the state of the engine to the findings in the store. Every check fires, and its fix clears it.

import { afterEach, describe, expect, it } from 'vitest';
import { DOCTOR_CHECKS, doctorCheck } from '../src/data/doctor';
import { INTERIOR_DOCTOR_CHECKS } from '../src/data/doctor-interior';
import type { DoctorCheckKey } from '../src/data/types';
import { SCENE_CHECKS, fixAll, fixDoctor, runDoctor, warningCount, type DoctorResult } from '../src/core/doctor';
import { INTERIOR_CHECKS } from '../src/core/doctor-interior';
import {
  BUDGET_REACH,
  CLIP_FRACTION,
  CLIP_OVER_WHITE,
  ENGINE_CHECKS,
  FIREFLY_CLAMP,
  clippedFraction,
  engineFacts,
  fireflyThreshold,
  sameImage,
  setEngineFacts,
  STOP_BINS,
  STOPS_FROM,
  type EngineAvailability,
  type EngineFacts,
  type FrameScan,
} from '../src/core/doctor-engine';
import { DEFAULT_ADVANCED, MAX_SECONDS, VIDEO_AVAILABLE } from '../src/core/render';
import { createInitialState, createStore, reduce, type Action, type ProjectState, type Store } from '../src/core/store';
import { SETTING_ROWS } from '../src/core/settings';
import { touchesImage as nativeTouchesImage } from '../src/render/native';
import { touchesImage } from '../src/render/pathtracer';
import { poolSize } from '../src/render/tiles';
import * as cmd from '../src/ui/commands';
import { encodableCodecs, engineFactsFrom, installDoctorFacts, sameEngineFacts } from '../src/ui/doctor-facts';
import { doctorRowAction, doctorSentence, doctorUnavailable } from '../src/ui/panels/status';
import type { AppServices } from '../src/ui/ports';
import type { Ctx } from '../src/ui/reactive';
import { setLang, STRINGS, t } from '../src/ui/strings';
import { createUiStore, type EngineInfo, type UiStore } from '../src/ui/ui-state';
import { apply, exampleState } from './helpers';

// ------------------------------------------------------------------ the fake engine

const WIDTH = 1280;
const HEIGHT = 720;

/** Pixels of the fake frame that are fireflies while the image is not clamped. */
const FAKE_FIREFLIES = 40;
/** The share of the fake frame in the bin of [4, 8) linear: two stops over white, a lamp's reflection. */
const FAKE_HIGHLIGHTS = 0.03;

/** What the fake accumulation of a project says: fireflies unless the indirect light is clamped; some highlights always. */
function accumulationOf(state: ProjectState, samples = 64): FrameScan {
  const a = state.render.advanced;
  const stops = new Array<number>(STOP_BINS).fill(0);
  const total = WIDTH * HEIGHT;
  const hot = Math.round(total * FAKE_HIGHLIGHTS);
  stops[2 - STOPS_FROM] = hot;
  stops[-1 - STOPS_FROM] = total - hot;
  return { basis: state, width: WIDTH, height: HEIGHT, samples, fireflies: a.clampIndirect > 0 && a.clampIndirect <= FIREFLY_CLAMP ? { pixels: 0, peak: 0 } : { pixels: FAKE_FIREFLIES, peak: 12 }, stops };
}

/**
 * A stand-in for the engine and the system around it. Its fields are the world (the build, the cores, simd128, the
 * denoiser) and the Settings rows that matter; `publish()` writes them where the page does, and `measure()` is the
 * viewport reading its accumulation of the project as it is now.
 */
class FakeEngine {
  availability: EngineAvailability = 'READY';
  backend: 'wasm' | 'native' = 'wasm';
  cores: number | null = 8;
  simdSupported = true;
  /** rt-simd.wasm is there. */
  simdBuild = true;
  canDenoise = true;
  /** The native engine's threads and whether it runs a vector path. */
  nativeThreads = 16;
  nativeVector = true;
  throughput: number | null = null;
  full = true;
  /** Settings ▸ Render engine ▸ Threads (0: Automatic) and SIMD. */
  threads = 0;
  simdOff = false;
  /** What the viewport last read of its accumulation. */
  scan: FrameScan | null = null;

  constructor(private readonly ui: UiStore) {}

  private info(): EngineInfo | null {
    if (this.availability !== 'READY') return null;
    if (this.backend === 'native') {
      return { backend: 'native', version: '0.3.0', build: this.nativeVector ? 'avx2' : 'scalar', workers: this.nativeThreads, autoThreads: this.nativeThreads, simd: this.nativeVector, simdSupported: true, cores: this.cores, denoise: true };
    }
    const auto = poolSize(this.cores ?? undefined);
    const simd = this.simdSupported && this.simdBuild && !this.simdOff;
    return { backend: 'wasm', version: '0.3.0', build: simd ? 'rt-simd.wasm' : 'rt.wasm', workers: this.threads > 0 ? this.threads : auto, autoThreads: auto, simd, simdSupported: this.simdSupported, cores: this.cores, denoise: this.canDenoise };
  }

  /** The page writes what it knows (main.ts: `ui.set({ engine, engineInfo })`, the meter's throughput, the settings, the mode). */
  publish(): void {
    this.ui.set({
      engine: this.availability,
      engineInfo: this.info(),
      throughput: this.throughput,
      viewportMode: this.full ? 'FULL' : 'FAST',
      settings: { ...this.ui.get().settings, 'engine.simd': this.simdOff ? 'OFF' : 'AUTO', 'engine.threads': this.threads },
    });
  }

  /** The viewport engine's `status()`. */
  status(): { scan?: FrameScan } {
    return this.scan ? { scan: this.scan } : {};
  }

  /** The viewport has accumulated the project as it is now. */
  measure(state: ProjectState, samples = 64): void {
    this.scan = accumulationOf(state, samples);
  }
}

interface Rig {
  store: Store;
  ui: UiStore;
  engine: FakeEngine;
  ctx: Ctx;
  sync(): void;
  result(key: DoctorCheckKey): DoctorResult;
  /** The project, with an action applied through the store. */
  do(...actions: Action[]): void;
  /** The faults of this state that the project can fix, as the interface would offer them. */
  fixable(): DoctorCheckKey[];
  dispose(): void;
}

let rigs: Rig[] = [];

function rig(setup?: (e: FakeEngine, state: ProjectState) => void): Rig {
  const store = createStore(exampleState());
  const ui = createUiStore({});
  const engine = new FakeEngine(ui);
  setup?.(engine, store.get());
  engine.publish();
  const glue = installDoctorFacts(store, ui, () => engine.status());
  glue.sync();
  const r: Rig = {
    store,
    ui,
    engine,
    ctx: { store, ui, services: {} as unknown as AppServices },
    sync: glue.sync,
    result: (key) => store.get().doctor.results.find((x) => x.key === key)!,
    do: (...actions) => actions.forEach((a) => store.dispatch(a)),
    fixable: () => store.get().doctor.results.filter((x) => x.status === 'WARN' && x.fixable).map((x) => x.key),
    dispose: glue.dispose,
  };
  rigs.push(r);
  return r;
}

afterEach(() => {
  rigs.forEach((r) => r.dispose());
  rigs = [];
  setEngineFacts(null);
  setLang('en');
});

const advanced = (patch: Partial<typeof DEFAULT_ADVANCED>): Action => ({ type: 'render/set', patch: { advanced: { ...DEFAULT_ADVANCED, ...patch } } });
const settingRow = (id: string) => SETTING_ROWS.some((r) => r.id === id);
/** A project whose animation is output as video (since N1 the window can say it; the Doctor judges the codec). */
const asVideo = (s: ProjectState, video: 'MP4' | 'WEBM' = 'MP4'): ProjectState => ({ ...s, render: { ...s.render, mode: 'ANIMATION', animation: { ...s.render.animation, output: 'VIDEO', video } } });

// ------------------------------------------------------------------ the checks, without the engine and with it

describe('the Doctor without an engine fact', () => {
  it('lists the engine checks as unavailable with the shape of before D1, and the scene checks as they were', () => {
    expect(engineFacts()).toBeNull();
    const results = runDoctor(exampleState());
    expect(results.map((r) => r.key)).toEqual(DOCTOR_CHECKS.map((c) => c.key));
    for (const r of results) {
      if (SCENE_CHECKS.has(r.key)) expect(r.status).toBe('OK');
      else expect(r).toEqual({ key: r.key, status: 'UNAVAILABLE', fixable: false, detail: {} });
    }
  });

  it('splits the catalogue into scene checks and engine checks, with nothing in both and nothing left over', () => {
    const keys = DOCTOR_CHECKS.map((c) => c.key);
    for (const k of ENGINE_CHECKS) expect(SCENE_CHECKS.has(k), k).toBe(false);
    for (const k of keys) expect(SCENE_CHECKS.has(k) || ENGINE_CHECKS.has(k), k).toBe(true);
    expect(keys).toHaveLength(SCENE_CHECKS.size + ENGINE_CHECKS.size);
  });

  it('keeps the interior Doctor’s keys in their own list: none of them is a scene check or an engine check, and each has its descriptor', () => {
    const interior = INTERIOR_DOCTOR_CHECKS.map((c) => c.key);
    expect(interior).toEqual([...INTERIOR_CHECKS]);
    for (const k of interior) {
      expect(SCENE_CHECKS.has(k), k).toBe(false);
      expect(ENGINE_CHECKS.has(k), k).toBe(false);
      expect(DOCTOR_CHECKS.some((c) => c.key === k), k).toBe(false);
      expect(doctorCheck(k), k).toBeDefined();
    }
    // A product scene lists the 19 and nothing more; the checks of both lists have a descriptor.
    expect(runDoctor(exampleState()).map((r) => r.key)).toEqual(DOCTOR_CHECKS.map((c) => c.key));
  });

  it('fixes nothing of the engine checks, and Fix all leaves the project as it was', () => {
    const s = exampleState();
    for (const k of ENGINE_CHECKS) expect(fixDoctor(s, k)).toBe(s);
    expect(fixAll(s)).toBe(s);
  });
});

describe('a healthy engine', () => {
  it('has every check OK, or waiting for the image it reads, and the two that have no counterpart say so', () => {
    const r = rig();
    const status = (k: DoctorCheckKey) => r.result(k).status;
    for (const k of ['engine', 'simd', 'denoise', 'color', 'output', 'budget'] as const) expect(status(k), k).toBe('OK');
    // The fireflies are read from an image: nothing is said before the viewport has a few samples.
    expect(r.result('caustics')).toMatchObject({ status: 'UNAVAILABLE', detail: { reason: 'measuring' } });
    expect(r.result('lighttree')).toMatchObject({ status: 'UNAVAILABLE', detail: { reason: 'later' } });
    expect(r.result('persist')).toMatchObject({ status: 'UNAVAILABLE', detail: { reason: 'notApplicable' } });
    expect(warningCount(r.store.get().doctor.results)).toBe(0);
  });

  it('does not touch the undo history: the engine reporting is not an edit', () => {
    const r = rig();
    const before = r.store.history();
    r.engine.threads = 1;
    r.engine.publish();
    r.engine.threads = 0;
    r.engine.publish();
    expect(r.store.history()).toEqual(before);
    expect(r.store.get().meta.dirty).toBe(false);
  });
});

// ------------------------------------------------------------------ engine and workers

describe('engine', () => {
  it('is unavailable while the engine loads, and warns with its reason when it is not there; none of it has a fix', () => {
    const r = rig((e) => (e.availability = 'LOADING'));
    expect(r.result('engine')).toMatchObject({ status: 'UNAVAILABLE', detail: { reason: 'loading' } });
    for (const [availability, reason] of [['NO_WASM', 'noWasm'], ['NO_WORKERS', 'noWorkers'], ['OUTDATED', 'outdated'], ['FAILED', 'failed']] as const) {
      r.engine.availability = availability;
      r.engine.publish();
      expect(r.result('engine'), availability).toEqual({ key: 'engine', status: 'WARN', fixable: false, detail: { reason } });
      // The project cannot rebuild rt.wasm: the fix leaves it alone, and so does Fix all.
      const before = r.store.get();
      r.do({ type: 'doctor/fix', key: 'engine' }, { type: 'doctor/fixAll' });
      expect(r.store.get()).toBe(before);
    }
    r.engine.availability = 'READY';
    r.engine.publish();
    expect(r.result('engine').status).toBe('OK');
  });

  it('warns about one worker when the system gives only one, with no way out in the project or in Settings', () => {
    const r = rig((e) => (e.cores = 2));
    // A pool is the cores less one, at least one: two cores give one.
    expect(r.ui.get().engineInfo).toMatchObject({ workers: 1, autoThreads: 1, cores: 2 });
    expect(r.result('engine')).toEqual({ key: 'engine', status: 'WARN', fixable: false, detail: { reason: 'oneWorker', workers: 1, cores: 2 } });
    r.engine.cores = 1;
    r.engine.publish();
    expect(r.result('engine').detail).toMatchObject({ reason: 'oneWorker', cores: 1 });
    r.engine.cores = null;
    r.engine.publish();
    expect(r.result('engine').detail).toEqual({ reason: 'oneWorker', workers: 1 });
    // More cores: the warning clears with them.
    r.engine.cores = 8;
    r.engine.publish();
    expect(r.result('engine').status).toBe('OK');
  });

  it('points at the Threads row when the setting is what holds the pool to one worker, and clears when the person sets it back', () => {
    const r = rig((e) => (e.threads = 1));
    const w = r.result('engine');
    expect(w).toEqual({ key: 'engine', status: 'WARN', fixable: false, detail: { reason: 'oneWorker', workers: 1, cores: 8, setting: 'engine.threads', auto: 7 } });
    expect(settingRow(String(w.detail.setting))).toBe(true);
    // The Doctor does not change the application's settings.
    r.do({ type: 'doctor/fixAll' });
    expect(r.ui.get().settings['engine.threads']).toBe(1);
    r.engine.threads = 0;
    r.engine.publish();
    expect(r.result('engine').status).toBe('OK');
  });

  it('does not warn about the desktop engine’s threads', () => {
    const r = rig((e) => {
      e.backend = 'native';
      e.nativeThreads = 1;
    });
    expect(r.result('engine').status).toBe('OK');
  });
});

// ------------------------------------------------------------------ SIMD

describe('simd', () => {
  it('warns when the scalar build runs, says whose it is, and points at the SIMD row only when the setting is Off', () => {
    const r = rig((e) => (e.simdSupported = false));
    expect(r.result('simd')).toEqual({ key: 'simd', status: 'WARN', fixable: false, detail: { reason: 'unsupported' } });
    r.engine.simdSupported = true;
    r.engine.simdOff = true;
    r.engine.publish();
    const off = r.result('simd');
    expect(off).toEqual({ key: 'simd', status: 'WARN', fixable: false, detail: { reason: 'off', setting: 'engine.simd' } });
    expect(settingRow('engine.simd')).toBe(true);
    // The person turns it back on in Settings: the engine starts again with the SIMD build.
    r.engine.simdOff = false;
    r.engine.publish();
    expect(r.result('simd').status).toBe('OK');
    r.engine.simdBuild = false;
    r.engine.publish();
    expect(r.result('simd')).toEqual({ key: 'simd', status: 'WARN', fixable: false, detail: { reason: 'build' } });
    r.engine.simdBuild = true;
    r.engine.publish();
    expect(r.result('simd').status).toBe('OK');
  });

  it('cannot be told while the engine is not running, and the desktop engine warns when it has no vector path', () => {
    const r = rig((e) => (e.availability = 'NO_WASM'));
    expect(r.result('simd')).toMatchObject({ status: 'UNAVAILABLE', detail: { reason: 'noEngine' } });
    r.engine.availability = 'LOADING';
    r.engine.publish();
    expect(r.result('simd')).toMatchObject({ status: 'UNAVAILABLE', detail: { reason: 'loading' } });
    r.engine.availability = 'READY';
    r.engine.backend = 'native';
    r.engine.nativeVector = false;
    r.engine.publish();
    expect(r.result('simd')).toEqual({ key: 'simd', status: 'WARN', fixable: false, detail: { reason: 'native' } });
    r.engine.nativeVector = true;
    r.engine.publish();
    expect(r.result('simd').status).toBe('OK');
  });
});

// ------------------------------------------------------------------ denoise

describe('denoise', () => {
  it('leaves a denoise that is off everywhere alone: that is a choice', () => {
    const r = rig();
    r.do(advanced({ denoise: 'OFF' }));
    expect(r.result('denoise').status).toBe('OK');
    // Even with an engine that cannot denoise.
    r.engine.canDenoise = false;
    r.engine.publish();
    expect(r.result('denoise').status).toBe('OK');
  });

  it('warns when the viewport is clean and the Render would not be, and the fix turns the Render’s on, undoably', () => {
    const r = rig();
    r.do(advanced({ denoise: 'VIEWPORT' }));
    expect(r.result('denoise')).toEqual({ key: 'denoise', status: 'WARN', fixable: true, detail: { reason: 'render' } });
    expect(warningCount(r.store.get().doctor.results)).toBe(1);
    cmd.doctorFix(r.ctx, 'denoise');
    expect(r.store.get().render.advanced.denoise).toBe('BOTH');
    expect(r.result('denoise').status).toBe('OK');
    expect(r.store.history().undo[0]).toBe('Doctor: Denoising');
    r.store.undo();
    expect(r.store.get().render.advanced.denoise).toBe('VIEWPORT');
    expect(r.result('denoise').status).toBe('WARN');
    r.store.redo();
    expect(r.result('denoise').status).toBe('OK');
  });

  it('does not nag about the viewport being raw: Render only is fine', () => {
    const r = rig();
    r.do(advanced({ denoise: 'RENDER' }));
    expect(r.result('denoise').status).toBe('OK');
  });

  it('warns about a denoise at strength 0 and the fix brings it back to the default', () => {
    const r = rig();
    r.do(advanced({ denoiseStrength: 0 }));
    expect(r.result('denoise')).toEqual({ key: 'denoise', status: 'WARN', fixable: true, detail: { reason: 'strength' } });
    r.do({ type: 'doctor/fix', key: 'denoise' });
    expect(r.store.get().render.advanced).toMatchObject({ denoise: 'BOTH', denoiseStrength: DEFAULT_ADVANCED.denoiseStrength });
    expect(r.result('denoise').status).toBe('OK');
    // Zero strength with the Render's own denoise only: the same.
    r.do(advanced({ denoise: 'RENDER', denoiseStrength: 0 }));
    r.do({ type: 'doctor/fix', key: 'denoise' });
    expect(r.store.get().render.advanced).toMatchObject({ denoise: 'RENDER', denoiseStrength: 100 });
  });

  it('warns when the engine has no denoiser, which is not the project’s to fix, and clears when the engine has one', () => {
    const r = rig((e) => (e.canDenoise = false));
    expect(r.result('denoise')).toEqual({ key: 'denoise', status: 'WARN', fixable: false, detail: { reason: 'engine' } });
    const before = r.store.get();
    r.do({ type: 'doctor/fix', key: 'denoise' });
    expect(r.store.get()).toBe(before);
    r.engine.canDenoise = true;
    r.engine.publish();
    expect(r.result('denoise').status).toBe('OK');
  });
});

// ------------------------------------------------------------------ view transform

describe('color', () => {
  it('needs no image for Filmic and AgX, which roll the highlights off', () => {
    const r = rig();
    for (const viewTransform of ['FILMIC', 'AGX'] as const) {
      r.do({ type: 'image/set', patch: { viewTransform } });
      expect(r.result('color').status, viewTransform).toBe('OK');
    }
  });

  it('with Standard waits for the Full viewport and for an image of this project', () => {
    const r = rig((e) => (e.full = false));
    r.do({ type: 'image/set', patch: { viewTransform: 'STANDARD' } });
    expect(r.result('color')).toMatchObject({ status: 'UNAVAILABLE', detail: { reason: 'noFull' } });
    r.engine.full = true;
    r.engine.publish();
    expect(r.result('color')).toMatchObject({ status: 'UNAVAILABLE', detail: { reason: 'measuring' } });
    r.engine.measure(r.store.get());
    r.sync();
    expect(r.result('color').status).toBe('WARN');
  });

  it('warns when Standard clips the highlights, and the fix is AgX (C1), undoable, with no new image needed', () => {
    const r = rig();
    r.do({ type: 'image/set', patch: { viewTransform: 'STANDARD' } });
    r.engine.measure(r.store.get());
    r.sync();
    const w = r.result('color');
    expect(w).toMatchObject({ status: 'WARN', fixable: true, detail: { percent: 3, samples: 64 } });
    cmd.doctorFix(r.ctx, 'color');
    expect(r.store.get().image.viewTransform).toBe('AGX');
    expect(r.result('color').status).toBe('OK');
    expect(r.store.history().undo[0]).toBe('Doctor: View transform');
    r.store.undo();
    expect(r.store.get().image.viewTransform).toBe('STANDARD');
    expect(r.result('color').status).toBe('WARN');
  });

  it('follows the exposure without another image: the same histogram is over white or not', () => {
    const r = rig();
    r.do({ type: 'image/set', patch: { viewTransform: 'STANDARD' } });
    r.engine.measure(r.store.get());
    r.sync();
    expect(r.result('color').status).toBe('WARN');
    // The highlights are 4–8 linear: two stops under that is 1–2, not over one stop above white.
    r.do({ type: 'image/set', patch: { exposureEv: -2 } });
    expect(r.result('color').status).toBe('OK');
    r.do({ type: 'image/set', patch: { exposureEv: -1 } });
    expect(r.result('color').status).toBe('WARN');
  });

  it('is clear under the fraction and over it, counting whole bins that are over white', () => {
    const scan = (over: number): FrameScan => {
      const stops = new Array<number>(STOP_BINS).fill(0);
      stops[1] = 1000 - over;
      stops[-1 - STOPS_FROM + 2] = over;
      return { basis: exampleState(), width: 100, height: 10, samples: 32, fireflies: { pixels: 0, peak: 0 }, stops };
    };
    expect(CLIP_OVER_WHITE).toBe(2);
    expect(CLIP_FRACTION).toBe(0.01);
    // The bin [2, 4): all of it is over 2.
    expect(clippedFraction(scan(10), 0)).toBeCloseTo(0.01, 6);
    expect(clippedFraction(scan(9), 0)).toBeCloseTo(0.009, 6);
    // At +1 EV the bin [1, 2) is over too; at -1 EV the bin [2, 4) halves to [1, 2) and is not.
    expect(clippedFraction(scan(10), -1)).toBe(0);
    expect(clippedFraction(scan(10), 1)).toBeCloseTo(0.01, 6);
    expect(clippedFraction({ ...scan(10), width: 0 }, 0)).toBe(0);
  });

  it('forgets an image that is not of this project any more, and reads the new one when it comes', () => {
    const r = rig();
    r.do({ type: 'image/set', patch: { viewTransform: 'STANDARD' } });
    r.engine.measure(r.store.get());
    r.sync();
    expect(r.result('color').status).toBe('WARN');
    // The light changed: the image the engine accumulated is another one, and says nothing until it has the new.
    const light = r.store.get().studio.lights[0].id;
    r.do({ type: 'studio/setLight', id: light, patch: { power: 777 } });
    expect(r.result('color')).toMatchObject({ status: 'UNAVAILABLE', detail: { reason: 'measuring' } });
    r.engine.measure(r.store.get());
    r.sync();
    expect(r.result('color').status).toBe('WARN');
  });

  it('does so also for what only the image depends on (the environment), and an undo back to the image it was read from trusts it again', () => {
    const r = rig();
    r.do({ type: 'image/set', patch: { viewTransform: 'STANDARD' } });
    r.engine.measure(r.store.get());
    r.sync();
    expect(r.result('color').status).toBe('WARN');
    r.do({ type: 'env/set', patch: { strength: 3.5 } });
    expect(r.result('color')).toMatchObject({ status: 'UNAVAILABLE', detail: { reason: 'measuring' } });
    r.store.undo();
    expect(r.store.get().environment.strength).not.toBe(3.5);
    expect(r.result('color').status).toBe('WARN');
  });

  it('trusts the scan again when the project gives the image it was read from again (the noise target put back)', () => {
    const r = rig();
    r.do({ type: 'render/set', patch: { finishBy: 'NOISE', noiseThreshold: 1 } }, { type: 'image/set', patch: { viewTransform: 'STANDARD' } });
    r.engine.measure(r.store.get());
    r.sync();
    expect(r.result('color').status).toBe('WARN');
    // Another target samples the view another way: another image. Put back, it is the one that was read.
    r.do({ type: 'render/set', patch: { noiseThreshold: 2 } });
    expect(r.result('color')).toMatchObject({ status: 'UNAVAILABLE', detail: { reason: 'measuring' } });
    r.do({ type: 'render/set', patch: { noiseThreshold: 1 } });
    expect(r.result('color').status).toBe('WARN');
  });

  it('does not run the Doctor at every step of something it does not read (the environment, with no scan to go stale)', () => {
    const r = rig();
    const stamp = r.store.get().doctor.stamp;
    r.do({ type: 'env/set', patch: { strength: 1.5 } }, { type: 'env/set', patch: { strength: 2 } }, { type: 'env/set', patch: { strength: 2.5 } });
    expect(r.store.get().doctor.stamp).toBe(stamp);
    // With a scan of this image in hand the first change makes it stale (one run), and the next ones find it stale already.
    r.engine.measure(r.store.get());
    r.sync();
    const withScan = r.store.get().doctor.stamp;
    r.do({ type: 'env/set', patch: { strength: 3 } });
    const first = r.store.get().doctor.stamp;
    expect(first).toBeGreaterThan(withScan);
    r.do({ type: 'env/set', patch: { strength: 3.5 } }, { type: 'env/set', patch: { strength: 4 } });
    expect(r.store.get().doctor.stamp).toBe(first);
  });
});

// ------------------------------------------------------------------ fireflies

describe('caustics (fireflies)', () => {
  it('waits for the Full viewport, for enough samples, and for an image that is not denoised', () => {
    const r = rig((e) => (e.full = false));
    expect(r.result('caustics')).toMatchObject({ status: 'UNAVAILABLE', detail: { reason: 'noFull' } });
    r.engine.full = true;
    r.engine.publish();
    expect(r.result('caustics')).toMatchObject({ status: 'UNAVAILABLE', detail: { reason: 'measuring' } });
    r.engine.scan = { ...accumulationOf(r.store.get()), fireflies: null };
    r.sync();
    expect(r.result('caustics')).toMatchObject({ status: 'UNAVAILABLE', detail: { reason: 'denoised' } });
    r.engine.availability = 'NO_WASM';
    r.engine.publish();
    expect(r.result('caustics')).toMatchObject({ status: 'UNAVAILABLE', detail: { reason: 'noEngine' } });
  });

  it('warns about the fireflies it was told of and the fix calms them: caustics back to Automatic, the indirect light clamped', () => {
    const r = rig();
    r.do(advanced({ caustics: 'OFF' }));
    r.engine.measure(r.store.get());
    r.sync();
    expect(r.result('caustics')).toEqual({
      key: 'caustics',
      status: 'WARN',
      fixable: true,
      detail: { pixels: FAKE_FIREFLIES, samples: 64, clamp: 0, caustics: 'OFF', to: FIREFLY_CLAMP, reason: 'fix' },
    });
    cmd.doctorFix(r.ctx, 'caustics');
    expect(r.store.get().render.advanced).toMatchObject({ caustics: 'AUTO', clampIndirect: FIREFLY_CLAMP });
    expect(r.store.history().undo[0]).toBe('Doctor: Fireflies');
    // The image is another one now: the Doctor waits for the engine to accumulate it, then finds it clean.
    expect(r.result('caustics')).toMatchObject({ status: 'UNAVAILABLE', detail: { reason: 'measuring' } });
    expect(warningCount(r.store.get().doctor.results)).toBe(0);
    r.engine.measure(r.store.get());
    r.sync();
    expect(r.result('caustics').status).toBe('OK');
    // And one undo gives back the settings that had fireflies.
    r.store.undo();
    expect(r.store.get().render.advanced).toMatchObject({ caustics: 'OFF', clampIndirect: 0 });
  });

  it('tightens a clamp that is looser than the Doctor’s, and keeps a tighter one', () => {
    const r = rig();
    r.do(advanced({ clampIndirect: 40 }));
    r.engine.measure(r.store.get());
    r.sync();
    expect(r.result('caustics')).toMatchObject({ status: 'WARN', fixable: true });
    r.do({ type: 'doctor/fix', key: 'caustics' });
    expect(r.store.get().render.advanced.clampIndirect).toBe(FIREFLY_CLAMP);
    expect(r.store.get().render.advanced.caustics).toBe('AUTO');
  });

  it('says that more samples are what is left when the project is already as the fix would have it, and offers no fix', () => {
    const r = rig();
    r.do(advanced({ clampIndirect: 5 }));
    // An engine that still has fireflies under a clamp of 5.
    r.engine.scan = { ...accumulationOf(r.store.get()), fireflies: { pixels: 25, peak: 9 } };
    r.sync();
    expect(r.result('caustics')).toEqual({
      key: 'caustics',
      status: 'WARN',
      fixable: false,
      detail: { pixels: 25, samples: 64, clamp: 5, caustics: 'AUTO', to: FIREFLY_CLAMP, reason: 'more' },
    });
    const before = r.store.get();
    r.do({ type: 'doctor/fix', key: 'caustics' }, { type: 'doctor/fixAll' });
    expect(r.store.get()).toBe(before);
  });

  it('does not warn under the threshold, which is a few pixels or a millionth-ish of the frame', () => {
    expect(fireflyThreshold(64, 32)).toBe(8);
    expect(fireflyThreshold(WIDTH, HEIGHT)).toBe(10);
    expect(fireflyThreshold(4096, 4096)).toBe(168);
    const r = rig();
    const few = (pixels: number) => ({ ...accumulationOf(r.store.get()), fireflies: { pixels, peak: 9 } });
    r.engine.scan = few(9);
    r.sync();
    expect(r.result('caustics').status).toBe('OK');
    r.engine.scan = few(10);
    r.sync();
    expect(r.result('caustics').status).toBe('WARN');
  });
});

describe('C1: the decisions on the engine Doctor (docs/ROADMAP.md, Judgement calls, D1)', () => {
  it('Standard clipping is a warning and nothing more, and its fix proposes AgX in the catalogue and the sentence', () => {
    const r = rig();
    r.do({ type: 'image/set', patch: { viewTransform: 'STANDARD' } });
    r.engine.measure(r.store.get());
    r.sync();
    expect(r.result('color')).toMatchObject({ status: 'WARN', fixable: true });
    // A warning counts as one, as any other: it is never more than that.
    expect(warningCount(r.store.get().doctor.results)).toBeGreaterThanOrEqual(1);
    expect(doctorCheck('color')?.fix.en).toContain('AgX');
    expect(doctorCheck('color')?.fix.es).toContain('AgX');
    for (const lang of ['en', 'es'] as const) {
      setLang(lang);
      const said = doctorSentence(r.result('color'), r.store.get());
      expect(said, lang).toContain('AgX');
      expect(said, lang).not.toMatch(/Filmic|Fílmica/);
    }
    setLang('en');
    r.do({ type: 'doctor/fix', key: 'color' });
    expect(r.store.get().image.viewTransform).toBe('AGX');
  });

  it('the video check is awake (N1 is done): an animation as video is judged by what this system encodes', () => {
    expect(VIDEO_AVAILABLE).toBe(true);
    const r = rig();
    r.store.reset(asVideo(r.store.get(), 'WEBM'));
    r.do({ type: 'doctor/refresh' });
    expect(r.result('output')).toMatchObject({ status: 'WARN', fixable: true, detail: { reason: 'codec', video: 'WEBM' } });
    r.ui.set({ video: { MP4: null, WEBM: 'VP9' } });
    expect(r.result('output').status).toBe('OK');
  });

  it('the denoise check stays as it was: it warns of a viewport denoised and a Render that is not, and fixes it with both', () => {
    const r = rig();
    r.do(advanced({ denoise: 'VIEWPORT' }));
    expect(r.result('denoise')).toMatchObject({ status: 'WARN', fixable: true, detail: { reason: 'render' } });
    r.do(advanced({ denoise: 'RENDER' }));
    expect(r.result('denoise').status).toBe('OK');
    r.do(advanced({ denoise: 'VIEWPORT' }), { type: 'doctor/fix', key: 'denoise' });
    expect(r.store.get().render.advanced.denoise).toBe('BOTH');
  });
});

// ------------------------------------------------------------------ video output

describe('output', () => {
  it('asks nothing of an image, or of an animation written as frames', () => {
    const r = rig();
    expect(r.result('output').status).toBe('OK');
    r.do({ type: 'render/set', patch: { mode: 'ANIMATION' } });
    expect(r.result('output').status).toBe('OK');
    // N1: the settings say video now; with nothing known of the system's encoders it cannot be written.
    expect(VIDEO_AVAILABLE).toBe(true);
    r.do({ type: 'render/set', patch: { animation: { ...r.store.get().render.animation, output: 'VIDEO' } } });
    expect(r.store.get().render.animation.output).toBe('VIDEO');
    expect(r.result('output')).toMatchObject({ status: 'WARN', detail: { reason: 'codec' } });
    r.do({ type: 'render/set', patch: { animation: { ...r.store.get().render.animation, output: 'FRAMES' } } });
    expect(r.result('output').status).toBe('OK');
  });

  it('reads what the system encodes from the browser’s answer (ui.video), and none before it answers', () => {
    expect(encodableCodecs(null)).toEqual([]);
    expect(encodableCodecs({ MP4: null, WEBM: null })).toEqual([]);
    expect(encodableCodecs({ MP4: null, WEBM: 'VP9' })).toEqual(['WEBM']);
    expect(encodableCodecs({ MP4: 'H264', WEBM: 'VP8' })).toEqual(['MP4', 'WEBM']);
    const r = rig();
    r.store.reset(asVideo(r.store.get(), 'WEBM'));
    r.do({ type: 'doctor/refresh' });
    expect(r.result('output').status).toBe('WARN');
    // The browser answers: WebM is encoded here. The facts follow the interface state and the warning goes.
    r.ui.set({ video: { MP4: null, WEBM: 'VP9' } });
    expect(engineFacts()?.videoCodecs).toEqual(['WEBM']);
    expect(r.result('output').status).toBe('OK');
    // The same project asking for MP4, which this system does not encode: the warning is back.
    r.do({ type: 'render/set', patch: { animation: { ...r.store.get().render.animation, video: 'MP4' } } });
    expect(r.result('output')).toEqual({ key: 'output', status: 'WARN', fixable: true, detail: { reason: 'codec', video: 'MP4' } });
  });

  it('does not look at the animation’s output while the window is set to an image: it only matters in Animation', () => {
    const r = rig();
    const s = r.store.get();
    // A project that holds a video output but renders an image today.
    r.store.reset({ ...s, render: { ...s.render, mode: 'IMAGE', animation: { ...s.render.animation, output: 'VIDEO' } } });
    r.do({ type: 'doctor/refresh' });
    expect(r.store.get().render.animation.output).toBe('VIDEO');
    expect(r.result('output').status).toBe('OK');
    // The window goes to Animation (only a patch of the animation settings coerces the output to frames): now it matters.
    r.do({ type: 'render/set', patch: { mode: 'ANIMATION' } });
    expect(r.result('output')).toMatchObject({ status: 'WARN', detail: { reason: 'codec' } });
  });

  it('warns when a project asks for a codec this system cannot encode, and the fix is the frame sequence', () => {
    const r = rig();
    r.store.reset(asVideo(r.store.get()));
    r.do({ type: 'doctor/refresh' });
    expect(r.result('output')).toEqual({ key: 'output', status: 'WARN', fixable: true, detail: { reason: 'codec', video: 'MP4' } });
    cmd.doctorFix(r.ctx, 'output');
    expect(r.store.get().render.animation.output).toBe('FRAMES');
    expect(r.result('output').status).toBe('OK');
    expect(r.store.history().undo[0]).toBe('Doctor: Output format');
    r.store.undo();
    expect(r.store.get().render.animation.output).toBe('VIDEO');
    expect(r.result('output').status).toBe('WARN');
  });

  it('does not warn of a video the system encodes (N1: a video is not a fault), and judges each codec on its own', () => {
    const r = rig();
    r.store.reset(asVideo(r.store.get(), 'WEBM'));
    // WebM can be written here, MP4 cannot.
    setEngineFacts({ ...engineFacts()!, videoCodecs: ['WEBM'] });
    r.do({ type: 'doctor/refresh' });
    expect(r.result('output')).toEqual({ key: 'output', status: 'OK', fixable: false, detail: {} });
    // Nothing to fix: the fix leaves a video it can write alone.
    r.do({ type: 'doctor/fix', key: 'output' });
    expect(r.store.get().render.animation.output).toBe('VIDEO');
    r.store.reset(asVideo(r.store.get(), 'MP4'));
    r.do({ type: 'doctor/refresh' });
    expect(r.result('output').detail).toEqual({ reason: 'codec', video: 'MP4' });
    r.do({ type: 'doctor/fix', key: 'output' });
    expect(r.result('output').status).toBe('OK');
    expect(r.store.get().render.animation.output).toBe('FRAMES');
  });
});

// ------------------------------------------------------------------ time budget

describe('budget', () => {
  // 1920 × 1080 is 2 073 600 pixels: at a million pixel-samples a second, 256 samples take 531 s.
  const finish = (patch: object): Action => ({ type: 'render/set', patch: patch as never });

  it('has nothing to fall short of when the render finishes by samples or by noise', () => {
    const r = rig((e) => (e.throughput = 1e3));
    expect(r.store.get().render.finishBy).toBe('SAMPLES');
    expect(r.result('budget').status).toBe('OK');
    r.do(finish({ finishBy: 'NOISE' }));
    expect(r.result('budget').status).toBe('OK');
  });

  it('cannot be told before the engine has measured its speed: no number is made up', () => {
    const r = rig();
    r.do(finish({ finishBy: 'TIME', maxSeconds: 10 }));
    expect(r.result('budget')).toMatchObject({ status: 'UNAVAILABLE', detail: { reason: 'unmeasured' } });
    r.engine.throughput = 1e6;
    r.engine.publish();
    expect(r.result('budget').status).toBe('WARN');
  });

  it('warns when a time budget reaches fewer samples than a Draft, and the fix gives it the time those need', () => {
    const r = rig((e) => (e.throughput = 1e6));
    r.do(finish({ finishBy: 'TIME', maxSeconds: 120 }));
    // 120 s at 1e6 pixel-samples a second: 57 samples of 2 073 600 pixels, under the 64 of a Draft, which take 133 s.
    expect(r.result('budget')).toEqual({ key: 'budget', status: 'WARN', fixable: true, detail: { reason: 'few', reach: 57, wanted: 64, budget: 120, need: 140, to: 170 } });
    cmd.doctorFix(r.ctx, 'budget');
    // 170 s, not 140: the fix leaves a quarter of headroom for the speed to move (it reaches 81 samples).
    expect(r.store.get().render.maxSeconds).toBe(170);
    expect(r.result('budget').status).toBe('OK');
    expect(r.store.history().undo[0]).toBe('Doctor: Time budget');
    r.store.undo();
    expect(r.store.get().render.maxSeconds).toBe(120);
    expect(r.result('budget').status).toBe('WARN');
  });

  it('is fine for a time budget that reaches a Draft', () => {
    const r = rig((e) => (e.throughput = 1e6));
    r.do(finish({ finishBy: 'TIME', maxSeconds: 140 }));
    expect(r.result('budget').status).toBe('OK');
    r.do(finish({ maxSeconds: 139 }));
    // 139 s reach 66: still a Draft’s worth.
    expect(r.result('budget').status).toBe('OK');
    r.do(finish({ maxSeconds: 130 }));
    expect(r.result('budget').status).toBe('WARN');
  });

  it('warns when whichever-first would be cut by the time to under half the samples asked, and the fix raises the time', () => {
    const r = rig((e) => (e.throughput = 1e6));
    expect(BUDGET_REACH).toBe(0.5);
    r.do(finish({ finishBy: 'FIRST', maxSamples: 256, maxSeconds: 120 }));
    expect(r.result('budget')).toEqual({ key: 'budget', status: 'WARN', fixable: true, detail: { reason: 'cut', reach: 57, wanted: 256, budget: 120, need: 540, to: 670 } });
    r.do({ type: 'doctor/fix', key: 'budget' });
    expect(r.store.get().render.maxSeconds).toBe(670);
    expect(r.result('budget').status).toBe('OK');
    // Half the samples is enough to leave it be: 266 s reach 128, exactly half of 256.
    r.do(finish({ maxSeconds: 266 }));
    expect(r.result('budget').status).toBe('OK');
    r.do(finish({ maxSeconds: 260 }));
    expect(r.result('budget').status).toBe('WARN');
  });

  it('follows the samples asked and the seconds given one at a time', () => {
    const r = rig((e) => (e.throughput = 1e6));
    r.do(finish({ finishBy: 'FIRST', maxSamples: 100, maxSeconds: 120 }));
    // 120 s reach 57 samples: 100 asked, more than half of them.
    expect(r.result('budget').status).toBe('OK');
    r.do(finish({ maxSamples: 1000 }));
    expect(r.result('budget').status).toBe('WARN');
    r.do(finish({ maxSamples: 100 }));
    expect(r.result('budget').status).toBe('OK');
    r.do(finish({ maxSeconds: 10 }));
    expect(r.result('budget').status).toBe('WARN');
  });

  it('holds after the fix when the speed measured moves down a fifth, which a budget set to exactly what was needed would not', () => {
    const r = rig((e) => (e.throughput = 1e6));
    r.do(finish({ finishBy: 'TIME', maxSeconds: 30 }));
    r.do({ type: 'doctor/fix', key: 'budget' });
    expect(r.result('budget').status).toBe('OK');
    // The meter takes a new reading, a fifth slower (it takes one when it differs by a tenth).
    r.ui.set({ throughput: 0.8e6 });
    expect(r.result('budget').status).toBe('OK');
    // A third slower is a different machine: the Doctor says so again.
    r.ui.set({ throughput: 0.6e6 });
    expect(r.result('budget').status).toBe('WARN');
  });

  it('judges an animation by the budget of each frame', () => {
    const r = rig((e) => (e.throughput = 1e6));
    r.do(finish({ mode: 'ANIMATION', finishBy: 'FIRST', maxSamples: 256, maxSeconds: 120 }));
    expect(r.result('budget').status).toBe('WARN');
    r.do({ type: 'doctor/fix', key: 'budget' });
    expect(r.result('budget').status).toBe('OK');
  });

  it('offers no fix when the time it would take is more than a render may be given', () => {
    const r = rig((e) => (e.throughput = 1));
    r.do(finish({ finishBy: 'TIME', maxSeconds: 60 }));
    const w = r.result('budget');
    expect(w.status).toBe('WARN');
    expect(Number(w.detail.need)).toBe(MAX_SECONDS);
    expect(w.fixable).toBe(true);
    // At the limit already: the budget cannot grow, so the Doctor has nothing to change.
    r.do(finish({ maxSeconds: MAX_SECONDS }));
    expect(r.result('budget')).toMatchObject({ status: 'WARN', fixable: false });
  });
});

// ------------------------------------------------------------------ every check fires and its fix clears it

describe('every engine check fires and its fix clears it', () => {
  interface Case {
    name: string;
    key: DoctorCheckKey;
    /** The fault, as the fake engine and the project would be in. */
    fault(r: Rig): void;
    /** What the Doctor offers: a one-click fix of the project, a pointer to a Settings row, or only the explanation. */
    offers: 'fix' | 'settings' | 'nothing';
    /** What clears it: the Doctor's fix, or what the person does outside the project. */
    clear(r: Rig): void;
  }
  const measured = (r: Rig) => {
    r.engine.measure(r.store.get());
    r.sync();
  };
  const useFix = (key: DoctorCheckKey) => (r: Rig) => {
    cmd.doctorFix(r.ctx, key);
    measured(r);
  };
  const CASES: Case[] = [
    { name: 'engine not built', key: 'engine', fault: (r) => ((r.engine.availability = 'NO_WASM'), r.engine.publish()), offers: 'nothing', clear: (r) => ((r.engine.availability = 'READY'), r.engine.publish()) },
    { name: 'engine out of date', key: 'engine', fault: (r) => ((r.engine.availability = 'OUTDATED'), r.engine.publish()), offers: 'nothing', clear: (r) => ((r.engine.availability = 'READY'), r.engine.publish()) },
    { name: 'one worker (the system)', key: 'engine', fault: (r) => ((r.engine.cores = 2), r.engine.publish()), offers: 'nothing', clear: (r) => ((r.engine.cores = 8), r.engine.publish()) },
    { name: 'one worker (Threads)', key: 'engine', fault: (r) => ((r.engine.threads = 1), r.engine.publish()), offers: 'settings', clear: (r) => ((r.engine.threads = 0), r.engine.publish()) },
    { name: 'no simd128', key: 'simd', fault: (r) => ((r.engine.simdSupported = false), r.engine.publish()), offers: 'nothing', clear: (r) => ((r.engine.simdSupported = true), r.engine.publish()) },
    { name: 'SIMD off', key: 'simd', fault: (r) => ((r.engine.simdOff = true), r.engine.publish()), offers: 'settings', clear: (r) => ((r.engine.simdOff = false), r.engine.publish()) },
    { name: 'no SIMD build', key: 'simd', fault: (r) => ((r.engine.simdBuild = false), r.engine.publish()), offers: 'nothing', clear: (r) => ((r.engine.simdBuild = true), r.engine.publish()) },
    { name: 'denoise only in the viewport', key: 'denoise', fault: (r) => r.do(advanced({ denoise: 'VIEWPORT' })), offers: 'fix', clear: useFix('denoise') },
    { name: 'denoise at zero', key: 'denoise', fault: (r) => r.do(advanced({ denoiseStrength: 0 })), offers: 'fix', clear: useFix('denoise') },
    { name: 'no denoiser', key: 'denoise', fault: (r) => ((r.engine.canDenoise = false), r.engine.publish()), offers: 'nothing', clear: (r) => ((r.engine.canDenoise = true), r.engine.publish()) },
    {
      name: 'Standard clips highlights',
      key: 'color',
      fault: (r) => (r.do({ type: 'image/set', patch: { viewTransform: 'STANDARD' } }), measured(r)),
      offers: 'fix',
      clear: useFix('color'),
    },
    { name: 'fireflies', key: 'caustics', fault: (r) => measured(r), offers: 'fix', clear: useFix('caustics') },
    { name: 'video that cannot be encoded', key: 'output', fault: (r) => (r.store.reset(asVideo(r.store.get())), r.do({ type: 'doctor/refresh' })), offers: 'fix', clear: useFix('output') },
    {
      name: 'a time budget that reaches too few samples',
      key: 'budget',
      fault: (r) => ((r.engine.throughput = 1e6), r.engine.publish(), r.do({ type: 'render/set', patch: { finishBy: 'TIME', maxSeconds: 30 } })),
      offers: 'fix',
      clear: useFix('budget'),
    },
  ];

  for (const c of CASES) {
    it(`${c.key}: ${c.name}`, () => {
      const r = rig();
      // Start from a healthy engine and a project whose image has been read, so the fault is the only difference.
      if (c.key === 'caustics') r.do(advanced({ clampIndirect: 0 }));
      expect(r.result(c.key).status).not.toBe('WARN');
      const healthy = r.store.get();
      c.fault(r);
      const w = r.result(c.key);
      expect(w.status, JSON.stringify(w)).toBe('WARN');
      expect(w.fixable).toBe(c.offers === 'fix');
      expect(typeof w.detail.setting === 'string').toBe(c.offers === 'settings');
      if (typeof w.detail.setting === 'string') expect(settingRow(w.detail.setting)).toBe(true);
      expect(warningCount(r.store.get().doctor.results)).toBeGreaterThanOrEqual(1);
      // The warning has its sentence, in both languages, with every placeholder filled.
      for (const lang of ['en', 'es'] as const) {
        setLang(lang);
        const sentence = doctorSentence(w, r.store.get());
        expect(sentence.length, `${lang} ${c.key}`).toBeGreaterThan(10);
        expect(sentence).not.toMatch(/[{}]|NaN|undefined/);
      }
      setLang('en');
      const faulty = r.store.get();
      c.clear(r);
      expect(r.result(c.key).status, `${c.key} after its clear: ${JSON.stringify(r.result(c.key))}`).toBe('OK');
      // A fix changed the project through the store (one undo step that brings the fault back); the rest did not touch it.
      if (c.offers === 'fix') {
        expect(r.store.get()).not.toBe(faulty);
        expect(r.store.history().undo.length).toBeGreaterThanOrEqual(1);
      } else {
        expect(r.store.get().render).toBe(faulty.render);
        expect(r.store.get().image).toBe(faulty.image);
      }
      expect(healthy).toBeDefined();
    });
  }

  it('Fix all in one click clears what the project can change in one undo step, and leaves what it cannot with its explanation', () => {
    const r = rig((e) => {
      e.cores = 2;
      e.simdSupported = false;
      e.throughput = 1e6;
    });
    r.do(advanced({ denoise: 'VIEWPORT', clampIndirect: 0 }), { type: 'image/set', patch: { viewTransform: 'STANDARD' } }, { type: 'render/set', patch: { finishBy: 'TIME', maxSeconds: 30 } });
    r.engine.measure(r.store.get());
    r.sync();
    const warned = (): DoctorCheckKey[] => r.store.get().doctor.results.filter((x) => x.status === 'WARN').map((x) => x.key);
    expect(warned().sort()).toEqual(['budget', 'caustics', 'color', 'denoise', 'engine', 'simd']);
    expect(r.fixable().sort()).toEqual(['budget', 'caustics', 'color', 'denoise']);
    const before = r.store.history().undo.length;
    cmd.doctorFixAll(r.ctx);
    // One undo entry for all four, named as the button.
    expect(r.store.history().undo.length).toBe(before + 1);
    expect(r.store.history().undo[0]).toBe('Doctor: fix all');
    const after = r.store.get();
    expect(after.render.advanced).toMatchObject({ denoise: 'BOTH', clampIndirect: FIREFLY_CLAMP });
    expect(after.image.viewTransform).toBe('AGX');
    expect(after.render.maxSeconds).toBe(170);
    // The image is another one now (the clamp), so the fireflies are waited for; what the system limits stays, with its words.
    r.engine.measure(r.store.get());
    r.sync();
    expect(warned().sort()).toEqual(['engine', 'simd']);
    expect(r.fixable()).toEqual([]);
    r.store.undo();
    expect(r.store.get().render.advanced).toMatchObject({ denoise: 'VIEWPORT', clampIndirect: 0 });
    expect(r.store.get().image.viewTransform).toBe('STANDARD');
    expect(r.store.get().render.maxSeconds).toBe(30);
  });
});

// ------------------------------------------------------------------ the store runs the Doctor when the engine checks' inputs change

describe('the Doctor runs again when what an engine check reads of the project changes', () => {
  it('after the image, Advanced, Finish by, the budget and the animation output, with no refresh asked', () => {
    const r = rig((e) => (e.throughput = 1e6));
    const was = r.store.get().doctor.stamp;
    r.do({ type: 'image/set', patch: { viewTransform: 'STANDARD' } });
    expect(r.store.get().doctor.stamp).toBeGreaterThan(was);
    r.do(advanced({ denoise: 'VIEWPORT' }));
    expect(r.result('denoise').status).toBe('WARN');
    r.do({ type: 'render/set', patch: { finishBy: 'TIME', maxSeconds: 30 } });
    expect(r.result('budget').status).toBe('WARN');
    r.do({ type: 'render/set', patch: { maxSeconds: 3000 } });
    expect(r.result('budget').status).toBe('OK');
    r.do({ type: 'render/set', patch: { mode: 'ANIMATION' } });
    expect(r.store.get().render.mode).toBe('ANIMATION');
  });

  it('but not for what a running render reports, which is volatile and frequent', () => {
    const r = rig();
    r.do({ type: 'render/set', patch: { finishBy: 'FIRST' } });
    const stamp = r.store.get().doctor.stamp;
    r.do({ type: 'render/running', running: { jobId: 'j1', progress: 0.2, samples: 4, seconds: 1 } });
    r.do({ type: 'render/running', running: { jobId: 'j1', progress: 0.4, samples: 8, seconds: 2 } });
    r.do({ type: 'anim/playhead', t: 0.5 });
    expect(r.store.get().doctor.stamp).toBe(stamp);
  });

  it('after an undo or a redo the findings are those of the engine as it is now, not those the snapshot was left with', () => {
    const r = rig();
    r.do(advanced({ denoise: 'VIEWPORT' }));
    expect(r.result('denoise').detail).toEqual({ reason: 'render' });
    r.do({ type: 'doctor/fix', key: 'denoise' });
    expect(r.result('denoise').status).toBe('OK');
    // The engine loses its denoiser while the project is as the fix left it: the denoise is on and nothing can do it.
    r.engine.canDenoise = false;
    r.engine.publish();
    expect(r.result('denoise').detail).toEqual({ reason: 'engine' });
    r.store.undo();
    expect(r.store.get().render.advanced.denoise).toBe('VIEWPORT');
    // The project before the fix, judged by the engine that cannot denoise (the snapshot said the Render was the problem).
    expect(r.result('denoise')).toEqual({ key: 'denoise', status: 'WARN', fixable: false, detail: { reason: 'engine' } });
    r.engine.canDenoise = true;
    r.engine.publish();
    r.store.redo();
    expect(r.result('denoise').status).toBe('OK');
  });

  it('runs on its own when only one thing the facts are made of changes: the speed, the viewport mode, the SIMD setting', () => {
    const r = rig();
    r.do({ type: 'render/set', patch: { finishBy: 'TIME', maxSeconds: 30 } });
    expect(r.result('budget')).toMatchObject({ status: 'UNAVAILABLE', detail: { reason: 'unmeasured' } });
    // The meter measures the speed: nothing else is told.
    r.ui.set({ throughput: 1e6 });
    expect(r.result('budget').status).toBe('WARN');
    // The person switches to Fast: nothing is accumulated to read.
    r.do({ type: 'image/set', patch: { viewTransform: 'STANDARD' } });
    r.engine.measure(r.store.get());
    r.sync();
    expect(r.result('color').status).toBe('WARN');
    r.ui.set({ viewportMode: 'FAST' });
    expect(r.result('color')).toMatchObject({ status: 'UNAVAILABLE', detail: { reason: 'noFull' } });
    r.ui.set({ viewportMode: 'FULL' });
    expect(r.result('color').status).toBe('WARN');
    // SIMD set to Off while the scalar build is the one that runs because the SIMD build is missing: the row to open is named at once.
    r.engine.simdBuild = false;
    r.engine.publish();
    expect(r.result('simd').detail).toEqual({ reason: 'build' });
    r.ui.set({ settings: { ...r.ui.get().settings, 'engine.simd': 'OFF' } });
    expect(r.result('simd').detail).toEqual({ reason: 'off', setting: 'engine.simd' });
  });

  it('is told once: the same facts again dispatch nothing', () => {
    const r = rig();
    const dispatched: string[] = [];
    const dispatch = r.store.dispatch.bind(r.store);
    r.store.dispatch = (a) => (dispatched.push(a.type), dispatch(a));
    r.sync();
    r.sync();
    r.engine.publish();
    expect(dispatched.filter((t) => t === 'doctor/refresh')).toEqual([]);
    r.engine.cores = 2;
    r.engine.publish();
    r.sync();
    expect(dispatched.filter((t) => t === 'doctor/refresh')).toHaveLength(1);
  });

  it('runs again, without an undo entry, when the engine facts change, and not when they stay as they were', () => {
    const r = rig();
    const stamp = r.store.get().doctor.stamp;
    r.engine.publish();
    r.sync();
    expect(r.store.get().doctor.stamp).toBe(stamp);
    r.engine.simdOff = true;
    r.engine.publish();
    expect(r.store.get().doctor.stamp).toBeGreaterThan(stamp);
    expect(r.store.history().undo).toEqual([]);
  });
});

describe('sameImage agrees with what makes the Full viewport start over', () => {
  it('on a change of the scene, the light, the camera, the size, the samples and Advanced; not on the image settings, the denoise or a rename', () => {
    const s = exampleState();
    const light = s.studio.lights[0].id;
    const model = Object.values(s.scene.nodes).find((n) => n.key === 'model')!.id;
    const cases: [string, Action][] = [
      ['move', { type: 'scene/setTransform', id: model, transform: { position: [0, 0, 5] } }],
      ['light', { type: 'studio/setLight', id: light, patch: { power: 321 } }],
      ['camera', { type: 'camera/set', id: s.camera.active, patch: { clipStart: 3 } }],
      ['environment', { type: 'env/set', patch: { strength: 2.5 } }],
      ['effect', { type: 'effect/add', preset: 'SNOW' }],
      ['samples', { type: 'render/set', patch: { maxSamples: 999 } }],
      ['quality', { type: 'render/quality', quality: 'FINAL' }],
      ['size', { type: 'render/set', patch: { width: 801 } }],
      ['clamp', advanced({ clampIndirect: 7 })],
      ['caustics', advanced({ caustics: 'OFF' })],
      ['denoise', advanced({ denoise: 'OFF' })],
      ['strength', advanced({ denoiseStrength: 40 })],
      ['exposure', { type: 'image/set', patch: { exposureEv: 1 } }],
      ['view transform', { type: 'image/set', patch: { viewTransform: 'AGX' } }],
      ['rename', { type: 'meta/rename', name: 'Another' }],
      ['noise target', { type: 'render/set', patch: { finishBy: 'NOISE', noiseThreshold: 2 } }],
    ];
    for (const [name, action] of cases) {
      const next = reduce(s, action);
      expect(next, name).not.toBe(s);
      expect(sameImage(s, next), `${name} (pool)`).toBe(!touchesImage(next, s));
      expect(sameImage(s, next), `${name} (launcher)`).toBe(!nativeTouchesImage(next, s));
    }
    expect(sameImage(s, s)).toBe(true);
  });
});

// ------------------------------------------------------------------ the facts, and the words

describe('engineFactsFrom', () => {
  it('reads the interface state and the viewport’s scan, and only reads a scan in Full', () => {
    const ui = createUiStore({});
    const e = new FakeEngine(ui);
    e.throughput = 4.2e6;
    e.cores = 6;
    e.publish();
    const scan = accumulationOf(exampleState());
    const facts = engineFactsFrom(ui.get(), { scan });
    expect(facts).toEqual({
      availability: 'READY',
      backend: 'wasm',
      workers: 5,
      autoWorkers: 5,
      cores: 6,
      simd: true,
      simdSupported: true,
      simdOff: false,
      denoise: true,
      videoCodecs: [],
      throughput: 4.2e6,
      full: true,
      scan,
    });
    e.full = false;
    e.publish();
    expect(engineFactsFrom(ui.get(), { scan })).toMatchObject({ full: false, scan: null });
    // No engine info yet: nothing is assumed beyond the page's own state.
    const loading = createUiStore({ engine: 'LOADING' });
    expect(engineFactsFrom(loading.get(), null)).toMatchObject({ availability: 'LOADING', backend: null, workers: 0, simd: false, denoise: true, scan: null, full: false });
  });

  it('compares facts field by field, the scan by identity', () => {
    const ui = createUiStore({});
    new FakeEngine(ui).publish();
    const a = engineFactsFrom(ui.get(), null);
    expect(sameEngineFacts(a, { ...a })).toBe(true);
    for (const patch of [{ workers: 3 }, { simd: false }, { throughput: 5 }, { full: false }, { availability: 'FAILED' as const }, { videoCodecs: ['MP4' as const] }, { scan: accumulationOf(exampleState()) }]) {
      expect(sameEngineFacts(a, { ...a, ...patch } as EngineFacts), JSON.stringify(Object.keys(patch))).toBe(false);
    }
    const scan = accumulationOf(exampleState());
    expect(sameEngineFacts({ ...a, scan }, { ...a, scan })).toBe(true);
    expect(sameEngineFacts({ ...a, scan }, { ...a, scan: { ...scan } })).toBe(false);
  });
});

describe('what a row of the Doctor offers', () => {
  const row = (r: Partial<DoctorResult> & { key: DoctorCheckKey }): DoctorResult => ({ status: 'WARN', fixable: false, detail: {}, ...r });

  it('a Fix when the project can change, the Settings button when a row holds it back, and an honest word otherwise', () => {
    expect(doctorRowAction(row({ key: 'denoise', fixable: true }))).toEqual({ kind: 'fix' });
    expect(doctorRowAction(row({ key: 'engine', detail: { reason: 'oneWorker', setting: 'engine.threads' } }))).toEqual({ kind: 'settings', setting: 'engine.threads' });
    expect(doctorRowAction(row({ key: 'simd', detail: { reason: 'unsupported' } }))).toEqual({ kind: 'noFix' });
    expect(doctorRowAction(row({ key: 'caustics', detail: { reason: 'more' } }))).toEqual({ kind: 'noFix' });
    // A scene check without a fix yet keeps its old words.
    expect(doctorRowAction(row({ key: 'transform' }))).toEqual({ kind: 'soon' });
    expect(doctorRowAction(row({ key: 'denoise', status: 'OK' }))).toEqual({ kind: 'ok' });
    expect(doctorRowAction(row({ key: 'denoise', status: 'UNAVAILABLE' }))).toBeNull();
    // The Fix wins when there is both (the project can be changed).
    expect(doctorRowAction(row({ key: 'engine', fixable: true, detail: { setting: 'engine.threads' } }))).toEqual({ kind: 'fix' });
  });

  it('is what the rig’s warnings offer: the fixable ones a Fix, the held-back ones their row, the rest nothing to click', () => {
    const r = rig((e) => {
      e.threads = 1;
      e.simdSupported = false;
    });
    r.do(advanced({ denoise: 'VIEWPORT' }));
    const kinds = Object.fromEntries(r.store.get().doctor.results.filter((x) => x.status === 'WARN').map((x) => [x.key, doctorRowAction(x)?.kind]));
    expect(kinds).toEqual({ engine: 'settings', simd: 'noFix', denoise: 'fix' });
  });
});

// ------------------------------------------------------------------ with the interior Doctor (K1)

describe('the engine checks and the interior Doctor run together', () => {
  const box = (name: string, size: [number, number, number], position: [number, number, number], material?: string): Action => ({
    type: 'scene/addPrimitive',
    kind: 'BOX',
    params: { width: size[0], depth: size[1], height: size[2], bevel: 0, bevelSegments: 1 },
    position,
    name,
    ...(material ? { material } : {}),
  });
  /** A 4 x 4 x 2.6 m room with a thick glass pane, the camera inside with a 12 mm lens and a clip that reaches the wall (K1's own scene of faults). */
  const roomWithFaults = (): ProjectState =>
    apply(
      reduce(apply(createInitialState(), box('Room', [4000, 4000, 2600], [0, 0, 1300]), box('Pane', [1500, 30, 1000], [0, 1990, 1300], 'GLASS_CLEAR')), { type: 'scene/setType', sceneType: 'INTERIOR' }),
      { type: 'camera/set', id: 'cam1', patch: { target: [0, 0, 1300], distance: 1900, azimuth: 0, elevation: 0, focalMm: 12, clipStart: 400 } },
    );
  const interiorKeys = (rs: readonly DoctorResult[]) => rs.filter((x) => (INTERIOR_CHECKS as readonly string[]).includes(x.key));
  const engineRig = () => {
    const r = rig((e) => {
      e.cores = 2;
      e.throughput = 1e6;
    });
    r.store.reset(roomWithFaults());
    r.do({ type: 'render/set', patch: { finishBy: 'TIME', maxSeconds: 30 } }, advanced({ denoise: 'VIEWPORT' }));
    return r;
  };

  it('lists the 19 of the catalogue and then the 7 of the interior, each judged by its own Doctor, in an interior scene only', () => {
    const r = engineRig();
    const results = r.store.get().doctor.results;
    expect(results.map((x) => x.key)).toEqual([...DOCTOR_CHECKS.map((c) => c.key), ...INTERIOR_CHECKS]);
    const warned = results.filter((x) => x.status === 'WARN').map((x) => x.key);
    // Engine: one worker (the system), denoise on in the viewport only, a 30 s budget. Interior: the pane, the lens, the clip.
    for (const k of ['engine', 'denoise', 'budget', 'interiorGlass', 'interiorLens', 'interiorClip']) expect(warned, k).toContain(k);
    // A product scene has only the 19, with the same engine facts.
    r.store.reset(exampleState());
    r.do({ type: 'doctor/refresh' });
    expect(r.store.get().doctor.results).toHaveLength(DOCTOR_CHECKS.length);
    expect(interiorKeys(r.store.get().doctor.results)).toEqual([]);
  });

  it('gives every warning a row action that is not "fix coming soon": a Fix, a Settings button or "not fixable here"', () => {
    const r = engineRig();
    for (const x of r.store.get().doctor.results.filter((y) => y.status === 'WARN')) {
      const kind = doctorRowAction(x)?.kind;
      expect(kind, `${x.key} ${JSON.stringify(x.detail)}`).toBeDefined();
      if (interiorKeys([x]).length > 0) expect(x.fixable, x.key).toBe(true);
      if (x.fixable) expect(kind, x.key).toBe('fix');
    }
  });

  it('Fix all clears both kinds in one undo step, leaves the engine ones the project cannot fix, and one undo brings everything back', () => {
    const r = engineRig();
    const before = r.store.get();
    const warnedBefore = before.doctor.results.filter((x) => x.status === 'WARN').map((x) => x.key);
    expect(warnedBefore).toEqual(expect.arrayContaining(['engine', 'denoise', 'budget', 'interiorGlass', 'interiorLens', 'interiorClip']));
    const undo = r.store.history().undo.length;
    cmd.doctorFixAll(r.ctx);
    expect(r.store.history().undo.length).toBe(undo + 1);
    expect(r.store.history().undo[0]).toBe('Doctor: fix all');
    const after = r.store.get().doctor.results;
    const warnedAfter = after.filter((x) => x.status === 'WARN').map((x) => x.key);
    // The interior ones and the fixable engine ones are gone; what the system limits stays with its words.
    expect(interiorKeys(after).filter((x) => x.status === 'WARN').map((x) => x.key)).toEqual([]);
    for (const k of ['denoise', 'budget']) expect(warnedAfter, k).not.toContain(k);
    expect(warnedAfter).toContain('engine');
    expect(r.store.get().render.advanced.denoise).toBe('BOTH');
    expect(r.store.get().render.maxSeconds).toBe(170);
    expect(r.store.get().camera.cameras.cam1.focalMm).not.toBe(12);
    r.store.undo();
    expect(r.store.get().render.advanced.denoise).toBe('VIEWPORT');
    expect(r.store.get().render.maxSeconds).toBe(30);
    expect(r.store.get().camera.cameras.cam1.focalMm).toBe(12);
    expect(r.store.get().doctor.results.filter((x) => x.status === 'WARN').map((x) => x.key)).toEqual(warnedBefore);
  });

  it('each kind’s fix is its own: an interior key is never an engine fix and an engine key is never an interior one', () => {
    const r = engineRig();
    const s = r.store.get();
    expect(fixDoctor(s, 'interiorLens')).not.toBe(s);
    expect(fixDoctor(s, 'denoise').render.advanced.denoise).toBe('BOTH');
    // The interior fix changes the camera and nothing the engine reads; the engine fix changes the render and no camera.
    expect(fixDoctor(s, 'interiorLens').render).toBe(s.render);
    expect(fixDoctor(s, 'denoise').camera).toBe(s.camera);
  });
});

describe('the words', () => {
  const reasons = ['loading', 'noEngine', 'noFull', 'measuring', 'denoised', 'unmeasured', 'later', 'notApplicable'];

  it('says why a check cannot be told, in both languages, and keeps the old words for a check with no reason', () => {
    for (const lang of ['en', 'es'] as const) {
      setLang(lang);
      for (const reason of reasons) {
        const text = doctorUnavailable({ key: 'engine', status: 'UNAVAILABLE', fixable: false, detail: { reason } });
        expect(text, `${lang} ${reason}`).toBe(STRINGS[lang][`doctor.unavailable.${reason}` as keyof (typeof STRINGS)['en']]);
        expect(text).not.toMatch(/[{}]/);
      }
      expect(doctorUnavailable({ key: 'engine', status: 'UNAVAILABLE', fixable: false, detail: {} })).toBe(t('doctor.unavailable'));
    }
  });

  it('has the Doctor strings of D1 in both languages, differing between them, and none that speaks of a browser', () => {
    const keys = (Object.keys(STRINGS.en) as (keyof (typeof STRINGS)['en'])[]).filter((k) => k.startsWith('doctor.'));
    expect(keys.length).toBeGreaterThan(45);
    for (const k of keys) {
      expect(STRINGS.en[k].length, k).toBeGreaterThan(1);
      expect(STRINGS.es[k].length, k).toBeGreaterThan(1);
      if (k.startsWith('doctor.engine.') || k.startsWith('doctor.simd.') || k.startsWith('doctor.unavailable.')) expect(`${STRINGS.en[k]} ${STRINGS.es[k]}`, k).not.toMatch(/browser|navegador/i);
    }
  });

  it('words the budget in time, the video by name, and the percent with the language’s separator', () => {
    const r = rig((e) => (e.throughput = 1e6));
    r.do({ type: 'render/set', patch: { finishBy: 'FIRST', maxSamples: 256, maxSeconds: 120 } });
    const w = r.result('budget');
    expect(doctorSentence(w, r.store.get())).toBe('256 samples need about 9 min at the speed measured here, and the budget is 2 min: the render stops at about 57 of them.');
    setLang('es');
    expect(doctorSentence(w, r.store.get())).toBe('256 muestras necesitan unos 9 min a la velocidad medida aquí, y el presupuesto es de 2 min: el render se detiene hacia 57 de ellas.');
    setLang('en');
    // A budget that reaches one sample says it without a plural to agree with.
    const slow = { key: 'budget' as const, status: 'WARN' as const, fixable: true, detail: { reason: 'few', reach: 1, wanted: 64, budget: 5, need: 420 } };
    expect(doctorSentence(slow, r.store.get())).toBe('A budget of 5 s reaches only 1 of the 64 samples of a Draft at the speed measured here. About 7 min would.');
    const more = { key: 'caustics' as const, status: 'WARN' as const, fixable: false, detail: { pixels: 25, samples: 64, clamp: 5, caustics: 'AUTO', to: 10, reason: 'more' } };
    expect(doctorSentence(more, r.store.get())).toBe('25 fireflies after 64 samples, and the indirect clamp (5) is already at 10 or under: more samples are what is left.');
    expect(doctorSentence({ ...more, fixable: true, detail: { ...more.detail, clamp: 0, reason: 'fix' } }, r.store.get())).toBe('25 fireflies after 64 samples: single samples far brighter than their neighbours. The fix clamps the indirect light at 10.');
    const video = { key: 'output' as const, status: 'WARN' as const, fixable: true, detail: { reason: 'codec', video: 'WEBM' } };
    expect(doctorSentence(video, r.store.get())).toBe('This system cannot encode WebM VP9. A frame sequence can always be written.');
    const color = { key: 'color' as const, status: 'WARN' as const, fixable: true, detail: { percent: 3.5, samples: 64 } };
    expect(doctorSentence(color, r.store.get())).toContain('3.5 %');
    setLang('es');
    expect(doctorSentence(color, r.store.get())).toContain('3,5 %');
  });
});
