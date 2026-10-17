// The Doctor's checks that read the engine (phase D1): rt.wasm loaded and how many workers it got, SIMD,
// the denoise, the view transform, the fireflies of the accumulation, the video output and the time budget
// against the speed the engine measured. The scene checks (core/doctor.ts) run on the model alone; these also
// read what the engine reports, and that is never part of the project: the page hands it in as `EngineFacts`
// (`setEngineFacts`, like the engine's particle cap of core/effects.ts) and asks the store to run the Doctor
// again (`doctor/refresh`) when it changes. With no facts every check here is UNAVAILABLE, exactly as before D1.
//
// Rules of the Doctor that hold here too:
//   - a fix changes the project and nothing else, so it goes through the store and is one undo step;
//   - what the project cannot change (rt.wasm missing, one worker, no simd128 in the system) is a warning that
//     says why, with no fix: when a Settings row holds it back, `detail.setting` names the row and the interface
//     offers to open it (the Doctor does not change application settings: they are not undoable);
//   - no number is made up: counts, speeds and times are what the engine reported, and the thresholds below are
//     the Doctor's own choices, written down as constants so a decision can change them in one place.
// Pure: no DOM, no engine.

import { QUALITY_PRESETS } from '../data/quality';
import { effectiveExposure } from './image-passes';
import type { DoctorCheckKey } from '../data/types';
import { adaptiveOf, advancedTouchesView, DEFAULT_ADVANCED, MAX_SECONDS, reduceRender, type VideoCodec } from './render';
import { denoiseIn } from './caustics';
import type { DoctorResult } from './doctor';
import type { ProjectState } from './store';

// ------------------------------------------------------------------ what the page tells the Doctor

/** Whether the engine runs (`ui.engine`): LOADING until it is known; the rest say why Full cannot run. */
export type EngineAvailability = 'LOADING' | 'READY' | 'NO_WASM' | 'NO_WORKERS' | 'OUTDATED' | 'FAILED';

/** Pixels of the frame by the stop of their brightest channel: `STOP_BINS` bins from `STOPS_FROM`. */
export const STOPS_FROM = -8;
export const STOP_BINS = 17;

/**
 * What the Full viewport's accumulation says (render/frame-scan.ts reads it; the engine's `status().scan`). It
 * describes the image of one project and no other: `basis` is that project, and a scan is not used for a
 * project whose image is another (`sameImage`).
 */
export interface FrameScan {
  basis: ProjectState;
  width: number;
  height: number;
  /** Samples of the pixel with the fewest. */
  samples: number;
  /**
   * Isolated very bright samples: the pixels where a single sample carries most of the light and that their
   * neighbours do not share (`pixels`), and the brightest of them (`peak`, the mean of the pixel, linear).
   * Null when the image the page holds is the denoised one: the fireflies were filtered out of it, and not told apart.
   */
  fireflies: { pixels: number; peak: number } | null;
  /**
   * The frame's pixels by the stop of their brightest channel (linear, before the exposure): bin `i` holds the
   * values from 2^(STOPS_FROM + i) up to the next stop; the first bin also takes what is darker and the last what
   * is brighter. The view transform check reads it for any exposure without looking at the image again.
   */
  stops: readonly number[];
  /**
   * K3: the automatic exposure of the frame (core/image-passes.ts `meterExposure`), stops; null when nothing was metered.
   * Absent on a scan of before (and of a test): treated as null.
   */
  metered?: number | null;
}

/** Everything the checks read of the engine and the system. Built by `ui/doctor-facts.ts`. */
export interface EngineFacts {
  availability: EngineAvailability;
  backend: 'wasm' | 'native' | null;
  /** Workers of the pool (wasm) or threads (native). */
  workers: number;
  /** What Automatic gives here (Settings ▸ Render engine ▸ Threads): a pool of one is the system's when this is 1. */
  autoWorkers: number;
  /** Logical cores the system reports, null when it does not. */
  cores: number | null;
  /** The SIMD build runs (wasm: rt-simd.wasm; native: a vector path), and whether the system can run it. */
  simd: boolean;
  simdSupported: boolean;
  /** Settings ▸ Render engine ▸ SIMD says Off. */
  simdOff: boolean;
  /** The engine has a denoiser (rt.wasm exports `rt_denoise`; the native engine always does). */
  denoise: boolean;
  /** N1: the video containers this system encodes now (WebCodecs, asked at run time; none before it answers). */
  videoCodecs: readonly VideoCodec[];
  /** Pixel-samples per second measured on this computer (the viewport's meter, Measure performance, a render); null before. */
  throughput: number | null;
  /** The Full viewport is the one on screen: there is an accumulation to read. */
  full: boolean;
  /** What the accumulation says, or null while there is none (not Full, too few samples, the view starting over). */
  scan: FrameScan | null;
}

let facts: EngineFacts | null = null;

/** Hands the Doctor what the engine reports (null: nothing known). The caller then dispatches `doctor/refresh`. */
export function setEngineFacts(next: EngineFacts | null): void {
  facts = next;
}

export function engineFacts(): EngineFacts | null {
  return facts;
}

// ------------------------------------------------------------------ the Doctor's thresholds (decisions pending)

/** A frame has fireflies when this many pixels are one: the larger of this and `FIREFLY_PER_PIXEL` of the frame. */
export const FIREFLY_MIN_PIXELS = 8;
export const FIREFLY_PER_PIXEL = 1e-5;
/** The indirect clamp the fireflies fix sets (Advanced ▸ Indirect clamp: the most a channel of indirect light can carry). */
export const FIREFLY_CLAMP = 10;
/**
 * Standard clips everything over 1 (display white) once the exposure is applied. The check counts what is over this
 * (linear: one stop over white), so a flat white background, which sits at 1, is not counted as clipped.
 */
export const CLIP_OVER_WHITE = 2;
/** The Standard view transform warns when this fraction of the frame is over `CLIP_OVER_WHITE`. */
export const CLIP_FRACTION = 0.01;
/** Finishing by whichever comes first, the time budget is short when it reaches less than this fraction of the samples asked. */
export const BUDGET_REACH = 0.5;
/**
 * The budget the fix sets reaches this many times the samples it was short of: the speed the engine measures moves from
 * one reading to the next (the meter takes a new one when it differs by a tenth), and a budget set to exactly what
 * the last reading needed would be short again by the next.
 */
export const BUDGET_HEADROOM = 1.25;

/** The checks that read the engine: UNAVAILABLE while the page has not handed in its facts. */
export const ENGINE_CHECKS: ReadonlySet<DoctorCheckKey> = new Set<DoctorCheckKey>(['engine', 'simd', 'lighttree', 'denoise', 'color', 'caustics', 'persist', 'output', 'budget']);

// ------------------------------------------------------------------ results

const ok = (key: DoctorCheckKey): DoctorResult => ({ key, status: 'OK', fixable: false, detail: {} });
const warn = (key: DoctorCheckKey, detail: Record<string, number | string>, fixable = false): DoctorResult => ({ key, status: 'WARN', fixable, detail });
/** UNAVAILABLE says why in `detail.reason` (the interface words it); without a reason it is the shape of before D1. */
const unavailable = (key: DoctorCheckKey, reason?: string): DoctorResult => ({ key, status: 'UNAVAILABLE', fixable: false, detail: reason ? { reason } : {} });

const round = (v: number, digits: number): number => {
  const k = 10 ** digits;
  return Math.round(v * k) / k;
};

/**
 * Whether two projects give the Full viewport the same image: render/pathtracer.ts `touchesImage` without the
 * playhead (the engine starts the view over when it moves; the Doctor is not asked to run at every tick). A
 * scan of the accumulation is about the image of its `basis` and is not used once this is false.
 */
export function sameImage(a: ProjectState, b: ProjectState): boolean {
  if (a === b) return true;
  const adaptive = (s: ProjectState) => adaptiveOf(s.render).adaptive?.noiseThreshold ?? null;
  return (
    a.scene === b.scene &&
    a.materials === b.materials &&
    a.studio === b.studio &&
    a.environment === b.environment &&
    a.effects === b.effects &&
    a.section === b.section &&
    a.camera === b.camera &&
    a.render.width === b.render.width &&
    a.render.height === b.render.height &&
    a.render.maxSamples === b.render.maxSamples &&
    a.render.quality === b.render.quality &&
    !advancedTouchesView(a.render.advanced, b.render.advanced) &&
    adaptive(a) === adaptive(b) &&
    a.animation.clips === b.animation.clips &&
    a.animation.shots === b.animation.shots
  );
}

/**
 * Whether the Doctor has to run again for a change from `a` to `b` of what these checks read of the project
 * (store.ts `reduce` asks, next to the scene parts the scene checks look at): the image settings, the render
 * window's engine, budget and animation-output settings, and, when the engine has handed in a scan, the project
 * ceasing to give the image that scan is about (or giving it again, by an undo): only then do the checks that read
 * the scan change, so a slider that moves the light all the way through does not run the Doctor at every step.
 */
export function engineInputsChanged(a: ProjectState, b: ProjectState): boolean {
  const x = a.render;
  const y = b.render;
  if (a.image !== b.image || x.mode !== y.mode || x.advanced !== y.advanced || x.animation !== y.animation || x.finishBy !== y.finishBy) return true;
  if (x.maxSamples !== y.maxSamples || x.maxSeconds !== y.maxSeconds || x.quality !== y.quality || x.width !== y.width || x.height !== y.height) return true;
  const scan = facts?.scan;
  return scan !== undefined && scan !== null && sameImage(scan.basis, a) !== sameImage(scan.basis, b);
}

/** The scan of the accumulation if it is about this project's image, else null. */
function freshScan(f: EngineFacts, state: ProjectState): FrameScan | null {
  return f.scan && sameImage(f.scan.basis, state) ? f.scan : null;
}

// ------------------------------------------------------------------ engine and workers

const DOWN: Partial<Record<EngineAvailability, string>> = { NO_WASM: 'noWasm', NO_WORKERS: 'noWorkers', OUTDATED: 'outdated', FAILED: 'failed' };

function checkEngine(f: EngineFacts): DoctorResult {
  if (f.availability === 'LOADING') return unavailable('engine', 'loading');
  const down = DOWN[f.availability];
  if (down) return warn('engine', { reason: down });
  // A pool of one worker. The system gives one when Automatic gives one; if Automatic would give more, a Threads
  // setting holds it back and the Settings row is the way out.
  if (f.backend === 'wasm' && f.workers <= 1) {
    return warn('engine', { reason: 'oneWorker', workers: f.workers, ...(f.cores ? { cores: f.cores } : {}), ...(f.autoWorkers > f.workers ? { setting: 'engine.threads', auto: f.autoWorkers } : {}) });
  }
  return ok('engine');
}

function checkSimd(f: EngineFacts): DoctorResult {
  if (f.availability === 'LOADING') return unavailable('simd', 'loading');
  if (f.availability !== 'READY') return unavailable('simd', 'noEngine');
  if (f.simd) return ok('simd');
  if (f.backend === 'native') return warn('simd', { reason: 'native' });
  if (!f.simdSupported) return warn('simd', { reason: 'unsupported' });
  // The system has simd128 and the scalar build runs: the setting says Off, or the SIMD build is not there.
  return f.simdOff ? warn('simd', { reason: 'off', setting: 'engine.simd' }) : warn('simd', { reason: 'build' });
}

// ------------------------------------------------------------------ denoise

type DenoiseReason = 'engine' | 'render' | 'strength';

/** What is wrong with the denoise of the Render, or null. A denoise that is off everywhere is a choice. */
function denoiseProblem(state: ProjectState, f: EngineFacts): DenoiseReason | null {
  const a = state.render.advanced;
  if (a.denoise === 'OFF') return null;
  if (!f.denoise) return 'engine';
  if (!denoiseIn(a.denoise, 'RENDER')) return 'render';
  if (!(a.denoiseStrength > 0)) return 'strength';
  return null;
}

function checkDenoise(state: ProjectState, f: EngineFacts): DoctorResult {
  if (f.availability === 'LOADING') return unavailable('denoise', 'loading');
  if (f.availability !== 'READY') return unavailable('denoise', 'noEngine');
  const why = denoiseProblem(state, f);
  if (!why) return ok('denoise');
  // The engine that cannot denoise is not the project's to change.
  return warn('denoise', { reason: why }, why !== 'engine');
}

// ------------------------------------------------------------------ view transform

/** Fraction of the frame over `CLIP_OVER_WHITE` after the exposure, from the stop histogram (whole bins: a bin is over when all of it is). */
export function clippedFraction(scan: FrameScan, exposureEv: number): number {
  const total = scan.width * scan.height;
  if (!(total > 0)) return 0;
  // A value v is over when v * 2^ev > CLIP_OVER_WHITE: log2(v) > log2(CLIP_OVER_WHITE) - ev. Bin i starts at STOPS_FROM + i.
  const first = Math.max(0, Math.ceil(Math.log2(CLIP_OVER_WHITE) - exposureEv - STOPS_FROM));
  let over = 0;
  for (let i = first; i < scan.stops.length; i++) over += scan.stops[i];
  return over / total;
}

function checkColor(state: ProjectState, f: EngineFacts): DoctorResult {
  if (f.availability === 'LOADING') return unavailable('color', 'loading');
  if (f.availability !== 'READY') return unavailable('color', 'noEngine');
  // Filmic and AgX roll the highlights off: nothing to measure. Standard clips them.
  if (state.image.viewTransform !== 'STANDARD') return ok('color');
  if (!f.full) return unavailable('color', 'noFull');
  const scan = freshScan(f, state);
  if (!scan) return unavailable('color', 'measuring');
  // K3: the exposure the image is shown with (the metered one plus the compensation, in automatic).
  const clipped = clippedFraction(scan, effectiveExposure(state.image, scan.metered ?? null));
  return clipped >= CLIP_FRACTION ? warn('color', { percent: round(clipped * 100, 1), samples: scan.samples }, true) : ok('color');
}

// ------------------------------------------------------------------ fireflies

/** What the fireflies fix changes in Advanced: caustics Off back to Automatic, an unclamped or looser indirect clamp to `FIREFLY_CLAMP`. */
function firefliesPatch(state: ProjectState): { caustics?: 'AUTO'; clampIndirect?: number } | null {
  const a = state.render.advanced;
  const patch: { caustics?: 'AUTO'; clampIndirect?: number } = {};
  if (a.caustics === 'OFF') patch.caustics = 'AUTO';
  if (a.clampIndirect === 0 || a.clampIndirect > FIREFLY_CLAMP) patch.clampIndirect = FIREFLY_CLAMP;
  return Object.keys(patch).length > 0 ? patch : null;
}

/** The fewest fireflies of a frame that count as a warning. */
export function fireflyThreshold(width: number, height: number): number {
  return Math.max(FIREFLY_MIN_PIXELS, Math.ceil(FIREFLY_PER_PIXEL * width * height));
}

function checkFireflies(state: ProjectState, f: EngineFacts): DoctorResult {
  if (f.availability === 'LOADING') return unavailable('caustics', 'loading');
  if (f.availability !== 'READY') return unavailable('caustics', 'noEngine');
  if (!f.full) return unavailable('caustics', 'noFull');
  const scan = freshScan(f, state);
  if (!scan) return unavailable('caustics', 'measuring');
  if (!scan.fireflies) return unavailable('caustics', 'denoised');
  if (scan.fireflies.pixels < fireflyThreshold(scan.width, scan.height)) return ok('caustics');
  const a = state.render.advanced;
  const patch = firefliesPatch(state);
  return warn('caustics', { pixels: scan.fireflies.pixels, samples: scan.samples, clamp: a.clampIndirect, caustics: a.caustics, to: FIREFLY_CLAMP, reason: patch ? 'fix' : 'more' }, patch !== null);
}

// ------------------------------------------------------------------ video output

/**
 * N1: an animation output as a video in a container this system cannot encode (a project made on another computer,
 * a browser without WebCodecs). A video the system encodes is not a fault. The fix is the frame sequence.
 */
function checkOutput(state: ProjectState, f: EngineFacts): DoctorResult {
  const r = state.render;
  if (r.mode !== 'ANIMATION' || r.animation.output !== 'VIDEO') return ok('output');
  return f.videoCodecs.includes(r.animation.video) ? ok('output') : warn('output', { reason: 'codec', video: r.animation.video }, true);
}

// ------------------------------------------------------------------ time budget

/** Seconds a render of `samples` samples takes at `throughput` pixel-samples a second, rounded up to a whole ten, never over the limit. */
function secondsFor(samples: number, pixels: number, throughput: number): number {
  return Math.min(MAX_SECONDS, Math.ceil((samples * pixels) / throughput / 10) * 10);
}

/** The samples a time budget reaches at `throughput` (at least 1: a render always renders one). */
function reachOf(seconds: number, pixels: number, throughput: number): number {
  return Math.max(1, Math.floor((throughput * seconds) / pixels));
}

interface BudgetProblem {
  reason: 'cut' | 'few';
  /** Samples the budget reaches, samples it falls short of, the seconds that would reach them, and what the fix sets (with headroom). */
  reach: number;
  wanted: number;
  need: number;
  to: number;
}

function budgetProblem(state: ProjectState, throughput: number): BudgetProblem | null {
  const s = state.render;
  const pixels = s.width * s.height;
  const reach = reachOf(s.maxSeconds, pixels, throughput);
  if (s.finishBy === 'FIRST') {
    // Whichever comes first: the time cuts the render at about half the samples or less.
    if (reach >= s.maxSamples * BUDGET_REACH) return null;
    return { reason: 'cut', reach, wanted: s.maxSamples, need: secondsFor(s.maxSamples, pixels, throughput), to: secondsFor(s.maxSamples * BUDGET_HEADROOM, pixels, throughput) };
  }
  if (s.finishBy === 'TIME') {
    // By time alone there is no samples to ask: the Draft tier's are the fewest that make a usable image.
    const wanted = QUALITY_PRESETS.DRAFT.samples;
    if (reach >= wanted) return null;
    return { reason: 'few', reach, wanted, need: secondsFor(wanted, pixels, throughput), to: secondsFor(wanted * BUDGET_HEADROOM, pixels, throughput) };
  }
  return null;
}

function checkBudget(state: ProjectState, f: EngineFacts): DoctorResult {
  const s = state.render;
  // By samples (or by noise) there is no time budget to fall short of.
  if (s.finishBy !== 'TIME' && s.finishBy !== 'FIRST') return ok('budget');
  if (!(f.throughput !== null && f.throughput > 0)) return unavailable('budget', 'unmeasured');
  const p = budgetProblem(state, f.throughput);
  if (!p) return ok('budget');
  const fixable = p.to > s.maxSeconds;
  return warn('budget', { reason: p.reason, reach: p.reach, wanted: p.wanted, budget: s.maxSeconds, need: p.need, to: p.to }, fixable);
}

// ------------------------------------------------------------------ the checks and their fixes

/** The result of an engine check (`runDoctor` asks for every key it has no scene check for). */
export function engineCheck(key: DoctorCheckKey, state: ProjectState): DoctorResult {
  const f = facts;
  if (!f) return unavailable(key);
  switch (key) {
    case 'engine':
      return checkEngine(f);
    case 'simd':
      return checkSimd(f);
    case 'denoise':
      return checkDenoise(state, f);
    case 'color':
      return checkColor(state, f);
    case 'caustics':
      return checkFireflies(state, f);
    case 'output':
      return checkOutput(state, f);
    case 'budget':
      return checkBudget(state, f);
    // Light trees are K4's, not built; persistent data is Blender's and has no counterpart in this engine.
    case 'lighttree':
      return unavailable(key, 'later');
    case 'persist':
      return unavailable(key, 'notApplicable');
    default:
      return unavailable(key);
  }
}

/**
 * The one-click fix of an engine check; a check without one leaves the project alone. A fix acts only while its
 * warning is real in the project it is given, so `fixAll`, which applies them one after another in catalogue order,
 * relies on a fix not making the next one's evidence stale: the view transform (it leaves the image as it is) comes
 * before the fireflies' (its clamp starts the view over, and the scan it read no longer describes the project).
 */
export function engineFix(state: ProjectState, key: DoctorCheckKey): ProjectState {
  const f = facts;
  if (!f) return state;
  switch (key) {
    case 'denoise': {
      if (checkDenoise(state, f).status !== 'WARN') return state;
      const a = state.render.advanced;
      const why = denoiseProblem(state, f);
      if (why === 'render') return reduceRender(state, { type: 'render/set', patch: { advanced: { ...a, denoise: 'BOTH' } } });
      if (why === 'strength') return reduceRender(state, { type: 'render/set', patch: { advanced: { ...a, denoiseStrength: DEFAULT_ADVANCED.denoiseStrength } } });
      return state;
    }
    case 'color':
      return checkColor(state, f).status === 'WARN' ? { ...state, image: { ...state.image, viewTransform: 'FILMIC' } } : state;
    case 'caustics': {
      if (checkFireflies(state, f).status !== 'WARN') return state;
      const patch = firefliesPatch(state);
      return patch ? reduceRender(state, { type: 'render/set', patch: { advanced: { ...state.render.advanced, ...patch } } }) : state;
    }
    case 'output': {
      if (checkOutput(state, f).status !== 'WARN') return state;
      // A frame sequence is written one image at a time and can be resumed; it is always available.
      return { ...state, render: { ...state.render, animation: { ...state.render.animation, output: 'FRAMES' } } };
    }
    case 'budget': {
      if (checkBudget(state, f).status !== 'WARN' || f.throughput === null) return state;
      const p = budgetProblem(state, f.throughput);
      return p && p.to > state.render.maxSeconds ? reduceRender(state, { type: 'render/set', patch: { maxSeconds: p.to } }) : state;
    }
    default:
      return state;
  }
}
