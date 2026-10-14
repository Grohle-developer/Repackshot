// The single project store (ARCHITECTURE §4): one immutable state tree,
// actions as plain objects, undo / redo over snapshots, subscription.
// Reducers are pure functions in the core modules; effects (render,
// download) live outside and subscribe.

import type { Label, Lang, RGB, RGBA, StudioPreset } from '../data/types';
import type { ImageRef } from './images';
import type { SkyModel } from './sky';
import { VERSION } from './version';
import { reduceAnimation, type AnimationAction, type MotionClip, type Shot } from './animation';
import { makeCamera, reduceCamera, type CameraAction, type CameraId, type CameraState } from './camera';
import { reduceDoctor, runDoctor, type DoctorAction, type DoctorResult } from './doctor';
import { buildStudio, lightsFromRig, reduceStudio, type CustomSetup, type LightInstance, type SavedStudio, type StudioAction } from './lighting';
import { reduceMaterials, type MaterialAction, type MaterialId, type MaterialInstance } from './materials';
import { carryRuntime, defaultRenderState, reduceRender, type RenderAction, type RenderState } from './render';
import { cleanSelection, reduceScene, type NodeId, type SceneAction, type SceneNode, type Selection } from './scene';
import { reduceTransform, type TransformAction } from './transform';
import { reducePrimitive, type PrimitiveAction } from './primitive-ops';
import { reduceSet } from './sets';
import { reduceTextures, type TextureAction } from './textures';

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
  /** GRADIENT (L6): `gradient` from the top of the output frame to its bottom (the colour around the frame). */
  background: 'ENVIRONMENT' | 'COLOR' | 'TRANSPARENT' | 'BACKPLATE' | 'GRADIENT';
  /** Background colour (and the colour of FLAT), linear RGBA. */
  color: RGBA;
  /** The two colours of the GRADIENT background (L6), linear RGB: the top and the bottom of the frame. */
  gradient: { top: RGB; bottom: RGB };
  /** Opacity of the contact shadow on the floor, 0..1. */
  groundShadow: number;
  /** Strength of the floor reflection, 0..1. */
  groundReflection: number;
  /** The HDRI file of kind HDRI (the image registry, core/images.ts); null: none loaded (the studio dome lights). */
  hdri: ImageRef | null;
  /** The background image of background BACKPLATE; null: none loaded (the colour shows). */
  backplate: ImageRef | null;
  /** How the background image fits the output frame. */
  backplateFit: 'FILL' | 'FIT' | 'STRETCH';
  /** Haze of the sky (kind SKY): 2 very clear, 3 clear, 6 hazy. */
  skyTurbidity: number;
  /** The sky's daylight model (E5c): PHYSICAL (ours, the default; projects saved before it open with it too) or CLASSIC (Preetham, E5's). */
  skyModel: SkyModel;
  /** Where the sky's sun is when the rig has no sun light: degrees, camera-relative like a light's. */
  skySun: { az: number; el: number };
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
    /** Saved studios of this project. Legacy: the interface saves studios to the library now (U4). */
    saved: SavedStudio[];
    /** The product type in force, when it is one of the user's library (`preset` is then `libraryKey(id)`). */
    customPreset?: StudioPreset | null;
    /** The light setup in force, when it is one of the user's library (`lightSetup` is then `libraryKey(id)`). */
    customSetup?: CustomSetup | null;
  };
  environment: EnvironmentState;
  camera: { active: CameraId; cameras: Record<CameraId, CameraState> };
  image: ImageState;
  animation: { shots: Shot[]; clips: MotionClip[]; fps: number; playhead: number; playing: boolean };
  /** The render window's settings, the queue and the job in flight (core/render.ts). */
  render: RenderState;
  doctor: { results: DoctorResult[]; stamp: number };
}

export type MetaAction =
  | ({ type: 'meta/rename'; name: string } & ActionBase)
  | ({ type: 'meta/lang'; lang: Lang } & ActionBase)
  | ({ type: 'meta/theme'; theme: ThemeSetting } & ActionBase)
  /**
   * The project was written to a file. `revision` is the store's revision when the file's content was taken
   * (default: now): changes made while the file was being written leave the project dirty.
   */
  | ({ type: 'meta/saved'; revision?: number } & ActionBase);

export type EnvironmentAction = { type: 'env/set'; patch: Partial<EnvironmentState> } & ActionBase;
export type ImageAction = { type: 'image/set'; patch: Partial<ImageState> } & ActionBase;

/** Sent to subscribers when the history moves or the state is replaced; reducers ignore it. */
export type HistoryAction = { type: 'history/undo' | 'history/redo' | 'history/reset' | 'history/commit' } & ActionBase;

/** Every action the store understands. */
export type Action =
  | SceneAction
  | TransformAction
  | PrimitiveAction
  | MaterialAction
  | TextureAction
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
 * (ARCHITECTURE §4: language, theme, playhead; also selection, and what a
 * running render job reports). Queue edits are project state (U5): undoable.
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
  'render/job',
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
      gradient: { top: [0.1, 0.1, 0.1], bottom: [0.02, 0.02, 0.02] },
      groundShadow: 0.6,
      groundReflection: 0,
      hdri: null,
      backplate: null,
      backplateFit: 'FILL',
      skyTurbidity: 3,
      skyModel: 'PHYSICAL',
      skySun: { az: -55, el: 55 },
    },
    camera: { active: 'cam1', cameras: { cam1: makeCamera('cam1', '', partSizeMm) } },
    image: { exposureEv: 0, viewTransform: 'FILMIC', bloom: 0, sharpen: 0, saturation: 0, contrast: 0, vignette: 0 },
    animation: { shots: [], clips: [], fps: 24, playhead: 0, playing: false },
    render: defaultRenderState(),
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
      // The tree and selection (scene.ts), the part operations (transform.ts) and the primitives (primitive-ops.ts)
      // share the prefix.
      const next = reduceScene(state, action as SceneAction);
      if (next !== state) return next;
      const moved = reduceTransform(state, action as TransformAction);
      return moved !== state ? moved : reducePrimitive(state, action as PrimitiveAction);
    }
    case 'material':
      return reduceMaterials(state, action as MaterialAction);
    case 'texture':
      // The image maps and labels of a material (M2a).
      return reduceTextures(state, action as TextureAction);
    case 'studio':
      // A set (L6) brings decoration and a look: core/sets.ts handles the actions it changes, the rest is the rig's.
      return reduceSet(state, action as StudioAction) ?? reduceStudio(state, action as StudioAction);
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
  /**
   * Replaces the whole state (New, Open) and clears the history. The state is the new saved baseline: the
   * project is clean (`meta.dirty` false) and its revision is a new one.
   */
  reset(state: ProjectState): void;
  /**
   * The revision of the project: a number that changes with every undoable change and that comes back to an
   * earlier value when undo or redo returns to that state. `meta.dirty` is `revision() !== the revision of the
   * last save or load` (a counter, never a comparison of states).
   */
  revision(): number;
}

interface HistoryEntry {
  state: ProjectState;
  label: ActionLabel;
  gesture?: string;
  /** The revision of `state`. */
  rev: number;
}

/** How many undo steps are kept. */
export const HISTORY_LIMIT = 200;

/** Keeps the interface-only parts of `current` when jumping to a snapshot; `dirty` is the jump's own. */
function carryVolatile(snapshot: ProjectState, current: ProjectState, dirty: boolean): ProjectState {
  const meta =
    snapshot.meta.lang === current.meta.lang && snapshot.meta.theme === current.meta.theme && snapshot.meta.dirty === dirty
      ? snapshot.meta
      : { ...snapshot.meta, lang: current.meta.lang, theme: current.meta.theme, dirty };
  const anim =
    snapshot.animation.playhead === current.animation.playhead && snapshot.animation.playing === current.animation.playing
      ? snapshot.animation
      : { ...snapshot.animation, playhead: current.animation.playhead, playing: current.animation.playing };
  // The queue's edits come back with the snapshot; what running jobs reported stays (core/render.ts).
  const render = carryRuntime(snapshot.render, current.render);
  return cleanSelection({ ...snapshot, meta, animation: anim, render, selection: current.selection });
}

/** The same state with `meta.dirty` set (the same object when it already is). */
function withDirty(state: ProjectState, dirty: boolean): ProjectState {
  return state.meta.dirty === dirty ? state : { ...state, meta: { ...state.meta, dirty } };
}

export function createStore(initial: ProjectState = createInitialState()): Store {
  let state = initial;
  let past: HistoryEntry[] = [];
  let future: HistoryEntry[] = [];
  let lastGesture: string | null = null;
  let txDepth = 0;
  let txBefore: ProjectState | null = null;
  let txBeforeRev = 0;
  let txHistoric = false;
  // Revisions (never a deep comparison): every undoable change gets a number nobody had, history entries
  // remember the revision of their snapshot, and the project is clean exactly when the current revision is
  // the one of the last save or load. Undoing back to the saved state makes it clean again.
  let lastRev = 0;
  let rev = 0;
  let savedRev = 0;
  state = withDirty(state, false);
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
    if (action.type === 'meta/saved') {
      // The file holds the project as it was at `revision`; anything changed since is not in it.
      savedRev = action.revision ?? rev;
      const dirty = rev !== savedRev;
      if (prev.meta.dirty === dirty) return;
      state = withDirty(prev, dirty);
      notify(state, prev, action);
      return;
    }
    let next = reduce(prev, action);
    if (next === prev) return;
    const volatile = isVolatile(action);
    if (!volatile) {
      const label = action.label ?? action.type;
      if (txDepth > 0) {
        txHistoric = true;
      } else if (action.gesture && lastGesture === action.gesture && past.length > 0) {
        future = [];
      } else {
        push({ state: prev, label, gesture: action.gesture, rev });
      }
      lastGesture = txDepth > 0 ? null : (action.gesture ?? null);
      rev = ++lastRev;
      next = withDirty(next, true);
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
      future.push({ state: prev, label: entry.label, rev });
      rev = entry.rev;
      state = carryVolatile(entry.state, prev, rev !== savedRev);
      lastGesture = null;
      notify(state, prev, { type: 'history/undo', label: entry.label });
    },
    redo() {
      const entry = future.pop();
      if (!entry) return;
      const prev = state;
      past.push({ state: prev, label: entry.label, rev });
      rev = entry.rev;
      state = carryVolatile(entry.state, prev, rev !== savedRev);
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
        txBeforeRev = rev;
        txHistoric = false;
      }
      txDepth++;
      try {
        fn();
      } finally {
        txDepth--;
        if (txDepth === 0) {
          const committed = txHistoric && txBefore !== null && txBefore !== state;
          if (committed) push({ state: txBefore!, label, rev: txBeforeRev });
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
      rev = ++lastRev;
      savedRev = rev;
      state = withDirty(next, false);
      past = [];
      future = [];
      lastGesture = null;
      notify(state, prev, { type: 'history/reset' });
    },
    revision: () => rev,
  };
  return store;
}
