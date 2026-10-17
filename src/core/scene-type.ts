// The scene type (K1, INTERIORS.md §3.1): `scene.type` is Product, Interior or Catalogue, and switching it rewrites the
// default values of a handful of settings (data/scene-types.ts) and nothing else: no control appears or disappears.
//
// Switching back must leave the project as it was, except for what the person touched in between. So every value a
// type writes is a "slot" with the value it replaced (`base`) and the value it wrote (`applied`), kept in
// `scene.typeBase` (saved with the project). On the next switch a slot whose current value is still `applied` is
// untouched: it goes back to `base` before the new type writes its own; a slot that no longer holds `applied` was
// edited by the person, and its value is the new `base`. Nothing the type did not write is kept.
//
// Pure functions over ProjectState; the one action is `scene/setType`, a normal undoable step.

import { QUALITY_KEYS, QUALITY_PRESETS } from '../data/quality';
import { SCENE_TYPE_KEYS, sceneTypeEntry, type SceneTypeDefaults } from '../data/scene-types';
import type { SceneType } from '../data/types';
import { CAUSTICS_MODES, DENOISE_MODES } from './caustics';
import { typeLightsUntouched, type CustomSetup, type LightInstance } from './lighting';
import { FINISH_BYS } from './render';
import { applySet, setOf } from './sets';
import type { ActionBase, ProjectState } from './store';

export type SceneTypeAction = { type: 'scene/setType'; sceneType: SceneType } & ActionBase;

type Json = number | string | boolean | null | Json[] | { [k: string]: Json };

/** One value a scene type wrote: what was there before it, and what it put. */
export interface TypeWrite {
  base: Json;
  applied: Json;
}

/** The writes of the scene type in force, by slot. Absent on a Product scene nobody switched. */
export type TypeMemory = Record<string, TypeWrite>;

interface Slot {
  key: string;
  /** The value now; undefined when the slot does not exist (a camera that is gone or locked). */
  read(state: ProjectState): Json | undefined;
  write(state: ProjectState, value: Json): ProjectState;
  /** What the type puts here (undefined: it leaves the slot alone). */
  target(state: ProjectState, d: SceneTypeDefaults, current: Json): Json | undefined;
  /** A value of this slot, as a project file may hold it. */
  valid(value: unknown): value is Json;
}

const same = (a: Json | undefined, b: Json | undefined): boolean => JSON.stringify(a) === JSON.stringify(b);
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const oneOf = <T extends string>(list: readonly T[]) => (v: unknown): v is T => typeof v === 'string' && (list as readonly string[]).includes(v);

const ENV_KINDS = ['STUDIO', 'SKY', 'FLAT', 'HDRI'] as const;
const VIEW_TRANSFORMS = ['STANDARD', 'FILMIC', 'AGX'] as const;
const BACKGROUNDS = ['ENVIRONMENT', 'COLOR', 'TRANSPARENT', 'BACKPLATE', 'GRADIENT'] as const;
const QUALITIES: readonly string[] = [...QUALITY_KEYS, 'CUSTOM'];

/** The quality tier that has exactly `samples`, else CUSTOM (what the render window shows). */
export function qualityForSamples(samples: number): string {
  return QUALITY_KEYS.find((k) => QUALITY_PRESETS[k].samples === samples) ?? 'CUSTOM';
}

const staticSlots: readonly Slot[] = [
  {
    key: 'environment.kind',
    read: (s) => s.environment.kind,
    write: (s, v) => ({ ...s, environment: { ...s.environment, kind: v as ProjectState['environment']['kind'] } }),
    // A loaded HDRI is the person's choice: no default replaces it.
    target: (_s, d, cur) => (d.environment === undefined || cur === 'HDRI' ? undefined : d.environment),
    valid: oneOf(ENV_KINDS),
  },
  {
    key: 'environment.background',
    read: (s) => ({ background: s.environment.background, color: [...s.environment.color] }),
    write: (s, v) => {
      const { background, color } = v as { background: ProjectState['environment']['background']; color: number[] };
      return { ...s, environment: { ...s.environment, background, color: [color[0], color[1], color[2], color[3]] } };
    },
    target: (_s, d) => (d.background ? { background: 'COLOR', color: [...d.background] } : undefined),
    valid: (v): v is Json => isObject(v) && oneOf(BACKGROUNDS)(v.background) && Array.isArray(v.color) && v.color.length === 4 && v.color.every(isNum),
  },
  {
    key: 'environment.groundShadow',
    read: (s) => s.environment.groundShadow,
    write: (s, v) => ({ ...s, environment: { ...s.environment, groundShadow: v as number } }),
    target: (_s, d) => d.floorShadow?.opacity,
    valid: isNum,
  },
  {
    key: 'studio.shadow',
    read: (s) => s.studio.shadow,
    write: (s, v) => ({ ...s, studio: { ...s.studio, shadow: v as boolean } }),
    target: (_s, d) => d.floorShadow?.on,
    valid: (v): v is boolean => typeof v === 'boolean',
  },
  {
    // K3: the automatic exposure (absent on a project of before: by hand).
    key: 'image.exposureMode',
    read: (s) => s.image.exposureMode ?? 'MANUAL',
    write: (s, v) => {
      const { exposureMode: _mode, ...image } = s.image;
      return { ...s, image: v === 'AUTO' ? { ...image, exposureMode: 'AUTO' } : image };
    },
    target: (_s, d) => (d.autoExposure ? 'AUTO' : undefined),
    valid: oneOf(['MANUAL', 'AUTO'] as const),
  },
  {
    key: 'image.viewTransform',
    read: (s) => s.image.viewTransform,
    write: (s, v) => ({ ...s, image: { ...s.image, viewTransform: v as ProjectState['image']['viewTransform'] } }),
    target: (_s, d) => d.viewTransform,
    valid: oneOf(VIEW_TRANSFORMS),
  },
  {
    key: 'render.samples',
    read: (s) => ({ quality: s.render.quality, maxSamples: s.render.maxSamples }),
    write: (s, v) => {
      const { quality, maxSamples } = v as { quality: ProjectState['render']['quality']; maxSamples: number };
      return { ...s, render: { ...s.render, quality, maxSamples } };
    },
    target: (_s, d) => (d.samples === undefined ? undefined : { quality: qualityForSamples(d.samples), maxSamples: d.samples }),
    valid: (v): v is Json => isObject(v) && oneOf(QUALITIES)(v.quality) && isNum(v.maxSamples),
  },
  {
    key: 'render.finishBy',
    read: (s) => s.render.finishBy,
    write: (s, v) => ({ ...s, render: { ...s.render, finishBy: v as ProjectState['render']['finishBy'] } }),
    target: (_s, d) => (d.adaptive ? 'NOISE' : undefined),
    valid: oneOf(FINISH_BYS),
  },
  {
    key: 'render.denoise',
    read: (s) => s.render.advanced.denoise,
    write: (s, v) => ({ ...s, render: { ...s.render, advanced: { ...s.render.advanced, denoise: v as ProjectState['render']['advanced']['denoise'] } } }),
    target: (_s, d) => (d.denoise ? 'BOTH' : undefined),
    valid: oneOf(DENOISE_MODES),
  },
  {
    key: 'render.maxBounces',
    read: (s) => s.render.advanced.maxBounces,
    write: (s, v) => ({ ...s, render: { ...s.render, advanced: { ...s.render.advanced, maxBounces: v as number | null } } }),
    target: (_s, d) => d.maxBounces,
    valid: (v): v is Json => v === null || isNum(v),
  },
  {
    key: 'render.caustics',
    read: (s) => s.render.advanced.caustics,
    write: (s, v) => ({ ...s, render: { ...s.render, advanced: { ...s.render.advanced, caustics: v as ProjectState['render']['advanced']['caustics'] } } }),
    target: (_s, d) => d.caustics,
    valid: oneOf(CAUSTICS_MODES),
  },
];

/**
 * C1: what putting a light recipe in force changes, as one value: the setup, its lights (the decoration's pool kept
 * among them), whether they were edited, the dome's strength and the exposure.
 */
interface Lighting {
  setup: string;
  /** Absent when the studio has no such field (a project of before). */
  custom?: CustomSetup | null;
  lights: LightInstance[];
  modified: boolean;
  strength: number;
  exposureEv: number;
}

const lightingOf = (s: ProjectState): Lighting => ({
  setup: s.studio.lightSetup,
  ...(s.studio.customSetup !== undefined ? { custom: s.studio.customSetup } : {}),
  lights: s.studio.lights,
  modified: s.studio.modified,
  strength: s.environment.strength,
  exposureEv: s.image.exposureEv,
});

function withLighting(s: ProjectState, v: Json): ProjectState {
  const l = v as unknown as Lighting;
  const { customSetup: _was, ...studio } = s.studio;
  return {
    ...s,
    studio: { ...studio, lightSetup: l.setup, ...(l.custom !== undefined ? { customSetup: l.custom } : {}), lights: l.lights, modified: l.modified },
    environment: { ...s.environment, strength: l.strength },
    image: { ...s.image, exposureEv: l.exposureEv },
  };
}

const validLighting = (v: unknown): v is Json =>
  isObject(v) &&
  typeof v.setup === 'string' &&
  (v.custom === undefined || v.custom === null || isObject(v.custom)) &&
  Array.isArray(v.lights) &&
  v.lights.every((l) => isObject(l) && typeof l.id === 'string') &&
  typeof v.modified === 'boolean' &&
  isNum(v.strength) &&
  isNum(v.exposureEv);

/**
 * C1: the type's light recipe (`SceneTypeDefaults.lightSetup`, the Interior's midday window), as choosing it in the
 * catalogue does, over the product type's own lights when they are untouched and nothing else. A set's decoration in
 * the scene is kept (the recipe has none of its own, as when it is added keeping the lights there were): taking it away
 * would make going back a matter of putting parts back in the scene, which a slot does not hold.
 */
const lightingSlot: Slot = {
  key: 'studio.lighting',
  read: (s) => lightingOf(s) as unknown as Json,
  write: withLighting,
  target: (s, d, base) => {
    const set = d.lightSetup === undefined ? undefined : setOf(d.lightSetup);
    if (!set) return undefined;
    const from = withLighting(s, base);
    if (!typeLightsUntouched(from)) return undefined;
    return lightingOf(applySet(from, set, {}, false, true)) as unknown as Json;
  },
  valid: validLighting,
};

const FOCAL = 'camera.focal:';
/** K3: the straight verticals of a camera. */
const VERTICALS = 'camera.verticals:';
const CAMERA_PREFIXES = [FOCAL, VERTICALS] as const;

/** One slot per camera: the focal length and the lens preset it came from. A locked camera is the person's, as it is. */
function cameraSlot(id: string): Slot {
  return {
    key: `${FOCAL}${id}`,
    read: (s) => {
      const cam = s.camera.cameras[id];
      return cam && !cam.locked ? { focalMm: cam.focalMm, lens: cam.lens } : undefined;
    },
    write: (s, v) => {
      const cam = s.camera.cameras[id];
      if (!cam) return s;
      const { focalMm, lens } = v as { focalMm: number; lens: string | null };
      return { ...s, camera: { ...s.camera, cameras: { ...s.camera.cameras, [id]: { ...cam, focalMm, lens } } } };
    },
    // A focal length the type puts is not a lens preset (the lens is dropped, as `camera/set` does); a camera already
    // at that focal length is left as it is.
    target: (_s, d, base) => (d.focalMm === undefined ? undefined : (base as { focalMm: number }).focalMm === d.focalMm ? base : { focalMm: d.focalMm, lens: null }),
    valid: (v): v is Json => isObject(v) && isNum(v.focalMm) && (v.lens === null || typeof v.lens === 'string'),
  };
}

/** K3: one slot per camera for its straight verticals (absent on a camera of before: off). */
function verticalsSlot(id: string): Slot {
  return {
    key: `${VERTICALS}${id}`,
    read: (s) => {
      const cam = s.camera.cameras[id];
      return cam && !cam.locked ? cam.straightVerticals === true : undefined;
    },
    write: (s, v) => {
      const cam = s.camera.cameras[id];
      if (!cam) return s;
      const { straightVerticals: _was, ...rest } = cam;
      return { ...s, camera: { ...s.camera, cameras: { ...s.camera.cameras, [id]: v === true ? { ...rest, straightVerticals: true } : rest } } };
    },
    target: (_s, d) => d.straightVerticals,
    valid: (v): v is boolean => typeof v === 'boolean',
  };
}

/** The slots of a project: the fixed ones and those of each camera, the cameras the memory remembers included. */
function slotsFor(cameras: Iterable<string>, memory: TypeMemory): Slot[] {
  const ids = new Set(cameras);
  for (const k of Object.keys(memory)) for (const prefix of CAMERA_PREFIXES) if (k.startsWith(prefix)) ids.add(k.slice(prefix.length));
  return [...staticSlots, lightingSlot, ...[...ids].flatMap((id) => [cameraSlot(id), verticalsSlot(id)])];
}

/**
 * Puts a scene type in force: each slot goes back to what it was before the type in force wrote it (when the person
 * has not touched it since), then the new type writes its defaults. Switching to the type already in force changes nothing.
 */
export function applySceneType(state: ProjectState, type: SceneType): ProjectState {
  if (!SCENE_TYPE_KEYS.includes(type) || state.scene.type === type) return state;
  const defaults = sceneTypeEntry(type).defaults;
  const memory: TypeMemory = { ...(state.scene.typeBase ?? {}) };
  let next = state;
  for (const slot of slotsFor(Object.keys(state.camera.cameras), memory)) {
    const entry = memory[slot.key];
    const cur = slot.read(next);
    if (cur === undefined) {
      delete memory[slot.key];
      continue;
    }
    const untouched = entry !== undefined && same(cur, entry.applied);
    const base = untouched ? entry.base : cur;
    const target = slot.target(next, defaults, base);
    const want = target ?? base;
    if (!same(cur, want)) next = slot.write(next, want);
    if (target !== undefined && !same(target, base)) memory[slot.key] = { base, applied: target };
    else delete memory[slot.key];
  }
  const scene = { ...next.scene, type };
  if (Object.keys(memory).length > 0) scene.typeBase = memory;
  else delete scene.typeBase;
  return { ...next, scene };
}

export function reduceSceneType(state: ProjectState, action: SceneTypeAction): ProjectState {
  return action.type === 'scene/setType' ? applySceneType(state, action.sceneType) : state;
}

/** The type a project file names; anything else is Product (a project from before K1 has none). */
export function normalizeSceneType(raw: unknown): SceneType {
  return typeof raw === 'string' && (SCENE_TYPE_KEYS as readonly string[]).includes(raw) ? (raw as SceneType) : 'PRODUCT';
}

/** The memory a project file holds, keeping only the writes of slots this version knows (undefined: none left). */
export function normalizeTypeBase(raw: unknown, state: Pick<ProjectState, 'camera'>): TypeMemory | undefined {
  if (!isObject(raw)) return undefined;
  const slots = new Map(slotsFor(Object.keys(state.camera.cameras), raw as TypeMemory).map((s) => [s.key, s]));
  const out: TypeMemory = {};
  for (const [key, entry] of Object.entries(raw)) {
    const slot = slots.get(key);
    if (!slot || !isObject(entry) || !slot.valid(entry.base) || !slot.valid(entry.applied)) continue;
    out[key] = { base: entry.base as Json, applied: entry.applied as Json };
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
