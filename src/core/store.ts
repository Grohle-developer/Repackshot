// The single project store (ARCHITECTURE §4): one immutable state tree,
// actions as plain objects, undo / redo over snapshots, subscription.
// Reducers are pure functions in the core modules; effects (render,
// download) live outside and subscribe.

import type { Label, Lang, RGBA } from '../data/types';
import { QUALITY_PRESETS } from '../data/quality';
import { VERSION } from './version';
import { reduceAnimation, type AnimationAction, type MotionClip, type Shot } from './animation';
import { makeCamera, reduceCamera, type CameraAction, type CameraId, type CameraState } from './camera';
import { reduceDoctor, runDoctor, type DoctorAction, type DoctorResult } from './doctor';
import { buildStudio, lightsFromRig, reduceStudio, type LightInstance, type SavedStudio, type StudioAction } from './lighting';
import { reduceMaterials, type MaterialAction, type MaterialId, type MaterialInstance } from './materials';
import { reduceRender, type OutputFormat, type RenderAction, type RenderJob, type RenderProgress, type RenderQuality } from './render';
import { cleanSelection, reduceScene, type NodeId, type SceneAction, type SceneNode, type Selection } from './scene';
import { reduceTransform, type TransformAction } from './transform';

/** A history label: plain text, or one text per language (shown in the current one). */
export type ActionLabel = string | Label;

/** Fields every action may carry. */
export interface ActionBase {
  /** Readable label for the undo history ("Assign Gold to Body"). */
  label?: ActionLabel;
  /**
   * Gesture token: consecutive actions with the same token collapse into one
   * undo entry (a drag of a field, one orbit of the camera).
   */
  gesture?: string;
}

export type ThemeSetting = 'dark' | 'light' | 'system';

/** Lighting environment and background (SPEC §3.4). */
export interface EnvironmentState {
  kind: 'STUDIO' | 'SKY' | 'FLAT' | 'HDRI';
  strength: number;
  rotationDeg: number;
  background: 'ENVIRONMENT' | 'COLOR' | 'TRANSPARENT' | 'BACKPLATE';
  /** Background colour (and the colour of FLAT), linear RGBA. */
  color: RGBA;
  /** Opacity of the contact shadow on the floor, 0..1. */
  groundShadow: number;
  /** Strength of the floor reflection, 0..1. */
  groundReflection: number;
}

/** Image settings applied after the render (SPEC §3.6). All zero = unchanged. */
export interface ImageState {
  exposureEv: number;
  viewTransform: 'STANDARD' | 'FILMIC' | 'AGX';
  bloom: number;
  sharpen: number;
  saturation: number;
  contrast: number;
  vignette: number;
}

export interface ProjectState {
  meta: { name: string; version: string; dirty: boolean; lang: Lang; theme: ThemeSetting };
  scene: { nodes: Record<NodeId, SceneNode>; roots: NodeId[]; partSizeMm: number };
  selection: Selection;
  materials: Record<MaterialId, MaterialInstance>;
  studio: {
    preset: string;
    lightSetup: string;
    built: boolean;
    floor: boolean;
    shadow: boolean;
    lights: LightInstance[];
    modified: boolean;
    /** Saved studios (Studios tab). */
    saved: SavedStudio[];
  };
  environment: EnvironmentState;
  camera: { active: CameraId; cameras: Record<CameraId, CameraState> };
  image: ImageState;
  animation: { shots: Shot[]; clips: MotionClip[]; fps: number; playhead: number; playing: boolean };
  render: {
    quality: RenderQuality;
    width: number;
    height: number;
    maxSamples: number;
    maxSeconds: number;
    format: OutputFormat;
    transparent: boolean;
    queue: RenderJob[];
    running: RenderProgress | null;
  };
  doctor: { results: DoctorResult[]; stamp: number };
}

export type MetaAction =
  | ({ type: 'meta/rename'; name: string } & ActionBase)
  | ({ type: 'meta/lang'; lang: Lang } & ActionBase)
  | ({ type: 'meta/theme'; theme: ThemeSetting } & ActionBase)
  | ({ type: 'meta/saved' } & ActionBase);

export type EnvironmentAction = { type: 'env/set'; patch: Partial<EnvironmentState> } & ActionBase;
export type ImageAction = { type: 'image/set'; patch: Partial<ImageState> } & ActionBase;

/** Sent to subscribers when the history moves or the state is replaced; reducers ignore it. */
export type HistoryAction = { type: 'history/undo' | 'history/redo' | 'history/reset' | 'history/commit' } & ActionBase;

/** Every action the store understands. */
export type Action =
  | SceneAction
  | TransformAction
  | MaterialAction
  | StudioAction
  | CameraAction
  | AnimationAction
  | RenderAction
  | DoctorAction
  | MetaAction
  | EnvironmentAction
  | ImageAction
  | HistoryAction;

export type ActionType = Action['type'];

/**
 * Actions that change interface state, not the project: they are not undone,
 * do not mark the project dirty and do not enter the history
 * (ARCHITECTURE §4: language, theme, playhead; also selection and the queue).
 */
export const VOLATILE_ACTIONS: ReadonlySet<ActionType> = new Set<ActionType>([
  'scene/select',
  'scene/setLevel',
  'scene/selectFaces',
  'meta/lang',
  'meta/theme',
  'meta/saved',
  'anim/playhead',
  'anim/play',
  'render/enqueue',
  'render/job',
  'render/removeJob',
  'render/clearQueue',
  'render/running',
  'history/undo',
  'history/redo',
  'history/reset',
  'history/commit',
]);

export function isVolatile(action: Action): boolean {
  return VOLATILE_ACTIONS.has(action.type);
}

/**
 * The state of a new, empty project: Standard mode, everything already set.
 * The GENERIC ("Standard") studio is built (its rig, the studio dome, the
 * reference camera, PREVIEW quality, HD), so nothing has to be chosen before
 * importing or loading the example. It is the base of the history: undo
 * cannot go before it.
 */
export function createInitialState(opts: { lang?: Lang; theme?: ThemeSetting } = {}): ProjectState {
  const partSizeMm = 200;
  const base: ProjectState = {
    meta: { name: '', version: VERSION, dirty: false, lang: opts.lang ?? 'en', theme: opts.theme ?? 'system' },
    scene: { nodes: {}, roots: [], partSizeMm },
    selection: { level: 'PART', ids: [] },
    materials: {},
    studio: {
      preset: 'GENERIC',
      lightSetup: 'PRESET',
      built: false,
      floor: true,
      shadow: true,
      lights: lightsFromRig('GENERIC', 'PRESET'),
      modified: false,
      saved: [],
    },
    environment: {
      kind: 'STUDIO',
      strength: 0.6,
      rotationDeg: 0,
      background: 'ENVIRONMENT',
      color: [0.05, 0.05, 0.05, 1],
      groundShadow: 0.6,
      groundReflection: 0,
    },
    camera: { active: 'cam1', cameras: { cam1: makeCamera('cam1', '', partSizeMm) } },
    image: { exposureEv: 0, viewTransform: 'FILMIC', bloom: 0, sharpen: 0, saturation: 0, contrast: 0, vignette: 0 },
    animation: { shots: [], clips: [], fps: 24, playhead: 0, playing: false },
    render: {
      quality: 'PREVIEW',
      width: 1920,
      height: 1080,
      maxSamples: QUALITY_PRESETS.PREVIEW.samples,
      maxSeconds: 120,
      format: 'PNG',
      transparent: false,
      queue: [],
      running: null,
    },
    doctor: { results: [], stamp: 0 },
  };
  const built = buildStudio(base);
  return { ...built, doctor: { results: runDoctor(built), stamp: 0 } };
}

function reduceMeta(state: ProjectState, action: MetaAction): ProjectState {
  const m = state.meta;
  switch (action.type) {
    case 'meta/rename':
      return m.name === action.name ? state : { ...state, meta: { ...m, name: action.name } };
    case 'meta/lang':
      return m.lang === action.lang ? state : { ...state, meta: { ...m, lang: action.lang } };
    case 'meta/theme':
      return m.theme === action.theme ? state : { ...state, meta: { ...m, theme: action.theme } };
    case 'meta/saved':
      return m.dirty ? { ...state, meta: { ...m, dirty: false } } : state;
    default:
      return state;
  }
}

function shallowPatch<T extends object>(obj: T, patch: Partial<T>): T {
  for (const k of Object.keys(patch) as (keyof T)[]) {
    if (obj[k] !== patch[k]) return { ...obj, ...patch };
  }
  return obj;
}

function reduceAny(state: ProjectState, action: Action): ProjectState {
  const prefix = action.type.slice(0, action.type.indexOf('/'));
  switch (prefix) {
    case 'scene': {
      // The tree and selection (scene.ts) and the part operations (transform.ts) share the prefix.
      const next = reduceScene(state, action as SceneAction);
      return next !== state ? next : reduceTransform(state, action as TransformAction);
    }
    case 'material':
      return reduceMaterials(state, action as MaterialAction);
    case 'studio':
      return reduceStudio(state, action as StudioAction);
    case 'camera':
      return reduceCamera(state, action as CameraAction);
    case 'anim':
      return reduceAnimation(state, action as AnimationAction);
    case 'render':
      return reduceRender(state, action as RenderAction);
    case 'doctor':
      return reduceDoctor(state, action as DoctorAction);
    case 'meta':
      return reduceMeta(state, action as MetaAction);
    case 'env': {
      const env = shallowPatch(state.environment, (action as EnvironmentAction).patch);
      return env === state.environment ? state : { ...state, environment: env };
    }
    case 'image': {
      const img = shallowPatch(state.image, (action as ImageAction).patch);
      return img === state.image ? state : { ...state, image: img };
    }
    default:
      return state;
  }
}

/**
 * Root reducer: applies the action, then refreshes what is derived from the
 * model (the Doctor results) when the parts it looks at changed.
 */
export function reduce(state: ProjectState, action: Action): ProjectState {
  const next = reduceAny(state, action);
  if (next === state) return state;
  if (
    next.scene !== state.scene ||
    next.materials !== state.materials ||
    next.camera !== state.camera ||
    next.studio !== state.studio
  ) {
    return { ...next, doctor: { results: runDoctor(next), stamp: state.doctor.stamp + 1 } };
  }
  return next;
}

/** Label of an action in a language. */
export function labelText(label: ActionLabel | undefined, lang: Lang, fallback: string): string {
  if (label === undefined) return fallback;
  return typeof label === 'string' ? label : label[lang];
}

export type Listener = (state: ProjectState, prev: ProjectState, action: Action) => void;

export interface Store {
  get(): ProjectState;
  /** Applies, records in the history (unless volatile), notifies. */
  dispatch(action: Action): void;
  subscribe(fn: Listener): () => void;
  undo(): void;
  redo(): void;
  /** Readable labels, most recent first. */
  history(): { undo: string[]; redo: string[] };
  /** Groups several dispatches into one undo entry. */
  transaction(label: ActionLabel, fn: () => void): void;
  /** Replaces the whole state (New, Open) and clears the history. */
  reset(state: ProjectState): void;
}

interface HistoryEntry {
  state: ProjectState;
  label: ActionLabel;
  gesture?: string;
}

/** How many undo steps are kept. */
export const HISTORY_LIMIT = 200;

/** Keeps the interface-only parts of `current` when jumping to a snapshot. */
function carryVolatile(snapshot: ProjectState, current: ProjectState): ProjectState {
  const meta =
    snapshot.meta.lang === current.meta.lang && snapshot.meta.theme === current.meta.theme && snapshot.meta.dirty
      ? snapshot.meta
      : { ...snapshot.meta, lang: current.meta.lang, theme: current.meta.theme, dirty: true };
  const anim =
    snapshot.animation.playhead === current.animation.playhead && snapshot.animation.playing === current.animation.playing
      ? snapshot.animation
      : { ...snapshot.animation, playhead: current.animation.playhead, playing: current.animation.playing };
  const render =
    snapshot.render.queue === current.render.queue && snapshot.render.running === current.render.running
      ? snapshot.render
      : { ...snapshot.render, queue: current.render.queue, running: current.render.running };
  return cleanSelection({ ...snapshot, meta, animation: anim, render, selection: current.selection });
}

export function createStore(initial: ProjectState = createInitialState()): Store {
  let state = initial;
  let past: HistoryEntry[] = [];
  let future: HistoryEntry[] = [];
  let lastGesture: string | null = null;
  let txDepth = 0;
  let txBefore: ProjectState | null = null;
  let txHistoric = false;
  const listeners = new Set<Listener>();
  const queue: Action[] = [];
  let notifying = false;

  const notify = (next: ProjectState, prev: ProjectState, action: Action): void => {
    notifying = true;
    try {
      for (const fn of [...listeners]) fn(next, prev, action);
    } finally {
      notifying = false;
    }
  };

  const push = (entry: HistoryEntry): void => {
    past.push(entry);
    if (past.length > HISTORY_LIMIT) past = past.slice(past.length - HISTORY_LIMIT);
    future = [];
  };

  const apply = (action: Action): void => {
    const prev = state;
    let next = reduce(prev, action);
    if (next === prev) return;
    const volatile = isVolatile(action);
    if (!volatile) {
      if (!next.meta.dirty) next = { ...next, meta: { ...next.meta, dirty: true } };
      const label = action.label ?? action.type;
      if (txDepth > 0) {
        txHistoric = true;
      } else if (action.gesture && lastGesture === action.gesture && past.length > 0) {
        future = [];
      } else {
        push({ state: prev, label, gesture: action.gesture });
      }
      lastGesture = txDepth > 0 ? null : (action.gesture ?? null);
    }
    state = next;
    notify(next, prev, action);
  };

  const store: Store = {
    get: () => state,
    dispatch(action) {
      if (notifying) {
        queue.push(action);
        return;
      }
      apply(action);
      while (queue.length > 0 && !notifying) apply(queue.shift()!);
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    undo() {
      const entry = past.pop();
      if (!entry) return;
      const prev = state;
      future.push({ state: prev, label: entry.label });
      state = carryVolatile(entry.state, prev);
      lastGesture = null;
      notify(state, prev, { type: 'history/undo', label: entry.label });
    },
    redo() {
      const entry = future.pop();
      if (!entry) return;
      const prev = state;
      past.push({ state: prev, label: entry.label });
      state = carryVolatile(entry.state, prev);
      lastGesture = null;
      notify(state, prev, { type: 'history/redo', label: entry.label });
    },
    history() {
      const lang = state.meta.lang;
      return {
        undo: past.map((e) => labelText(e.label, lang, '')).reverse(),
        redo: future.map((e) => labelText(e.label, lang, '')).reverse(),
      };
    },
    transaction(label, fn) {
      if (txDepth === 0) {
        txBefore = state;
        txHistoric = false;
      }
      txDepth++;
      try {
        fn();
      } finally {
        txDepth--;
        if (txDepth === 0) {
          const committed = txHistoric && txBefore !== null && txBefore !== state;
          if (committed) push({ state: txBefore!, label });
          txBefore = null;
          txHistoric = false;
          lastGesture = null;
          // The entry exists only now: tell listeners that show the history (state unchanged).
          if (committed) notify(state, state, { type: 'history/commit', label });
        }
      }
    },
    reset(next) {
      const prev = state;
      state = next;
      past = [];
      future = [];
      lastGesture = null;
      notify(state, prev, { type: 'history/reset' });
    },
  };
  return store;
}
