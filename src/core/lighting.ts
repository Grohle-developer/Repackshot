// The active light rig: built from a product preset (`studioRig`) or from a
// catalogue setup normalised to the preset (`setupRig`), editable light by
// light (`modified`), saved studios and placement by reflection (SPEC §3.4).

import { CAMERA_AZIMUTH_DEG, CAMERA_ELEVATION_DEG, SPEC_DEFAULTS, lightSetup } from '../data/light-setups';
import { QUALITY_PRESETS } from '../data/quality';
import { studioPreset } from '../data/studios';
import type { LightRole, LightShape, LightSpec, LightType, RGB, StudioPreset, WorldKind } from '../data/types';
import { kelvinToRgb, polar, specIrradiance, toWorldAzimuth } from './light-math';
import { activeRig, resolvePreset, type PresetRef, type SetupRef } from './rig';
import type { ActionBase, EnvironmentState, ImageState, ProjectState } from './store';
import { activeCamera, cameraPosition, frameBox, outputAspect, type CameraState } from './camera';
import { nextId } from './ids';
import { add, boxCenter, dot, isEmptyBox, length, normalize, scale, sub, type Vec3 } from './math';
import { partMaterials, pruneMaterials, type MaterialId, type MaterialInstance } from './materials';
import { productBounds, type FaceRange, type NodeId } from './scene';

/** One light of the active rig (SPEC §3.4). Sizes and distance in part sizes. */
export interface LightInstance {
  id: string;
  role: LightRole;
  type: LightType;
  shape: LightShape;
  size: number;
  sizeY: number;
  /** Degrees relative to the reference camera axis (0 behind the camera, 180 behind the part). */
  az: number;
  /** Degrees above the horizon. */
  el: number;
  dist: number;
  /** Beam spread, degrees. */
  spread: number;
  /** Angular diameter of a sun, radians. */
  angle: number;
  /** Colour temperature of a white source; null when `color` was given explicitly. */
  kelvin: number | null;
  /** Linear RGB, normalised. Follows `kelvin` when that is set. */
  color: RGB;
  /** Watts at part size 1 (AREA) or W/m2 (SUN). */
  power: number;
  /** Visible in reflections. */
  glossy: boolean;
  /** Visible to the camera. */
  camera: boolean;
  /** The recipe wants the camera to see it (bright field): the Doctor leaves it alone. */
  brightField: boolean;
  /** What the recipe said for `glossy`, so the Doctor can restore it. */
  recipeGlossy: boolean;
  enabled: boolean;
}

/** Prefix of the keys that name something of the user's library instead of a catalogue entry. */
export const LIBRARY_PREFIX = 'LIB:';

/** The key under which a library item is the current product type or light setup. */
export const libraryKey = (id: string): string => `${LIBRARY_PREFIX}${id}`;

export const isLibraryKey = (key: string): boolean => key.startsWith(LIBRARY_PREFIX);

/**
 * A light setup of the user's library as the project holds it (U4). The recipe travels with the project, so
 * deleting the library item, or opening the project on another machine, leaves the rig as it was: Create studio
 * and Reset to setup keep working.
 */
export interface CustomSetup {
  /** `libraryKey(id)`: what `studio.lightSetup` holds while it is active. */
  key: string;
  name: string;
  world: WorldKind;
  /** Camera-relative recipe lights; `share` is the weight of each, normalised when applied. */
  lights: LightSpec[];
}

/** The part of `ProjectState.studio` that names the product type and the setup in force. */
export interface StudioRefs {
  preset: string;
  lightSetup: string;
  customPreset?: StudioPreset | null;
  customSetup?: CustomSetup | null;
}

/** The product type in force: its library definition when it is an own one, its catalogue key otherwise. */
export function presetRefOf(studio: StudioRefs): PresetRef {
  return studio.customPreset && studio.customPreset.key === studio.preset ? studio.customPreset : studio.preset;
}

/** The light setup in force: its library recipe when it is an own one, its catalogue key otherwise. */
export function setupRefOf(studio: StudioRefs): SetupRef {
  return studio.customSetup && studio.customSetup.key === studio.lightSetup ? studio.customSetup : studio.lightSetup;
}

/** A saved studio: camera, light, environment, image and the material set (UI §2.2). */
export interface SavedStudio {
  id: string;
  name: string;
  preset: string;
  lightSetup: string;
  /** The own product type / light setup in force when it was saved (their definitions travel with the studio). */
  customPreset?: StudioPreset | null;
  customSetup?: CustomSetup | null;
  lights: LightInstance[];
  modified: boolean;
  floor: boolean;
  shadow: boolean;
  environment: EnvironmentState;
  image: ImageState;
  camera: CameraState;
  assignments: Record<NodeId, { material: MaterialId | null; faceMaterials?: FaceRange[] }>;
  instances: Record<MaterialId, MaterialInstance>;
  visibility: Record<NodeId, boolean>;
}

/** The recipe a rig was resolved from, in the same order as `setupRig` returns it. */
function rigSpecs(preset: PresetRef, setupRef: SetupRef): readonly LightSpec[] {
  const setup = typeof setupRef === 'string' ? lightSetup(setupRef) : setupRef;
  if (setupRef !== 'PRESET' && setup?.lights && setup.lights.length > 0) return setup.lights;
  return resolvePreset(preset)?.lights ?? [];
}

/** Light instances for a product type and a setup ('PRESET' = the product type's own rig). */
export function lightsFromRig(preset: PresetRef, setupRef: SetupRef): LightInstance[] {
  const rig = activeRig(preset, setupRef);
  const specs = rigSpecs(preset, setupRef);
  return rig.map((r, i) => {
    const spec: LightSpec | undefined = specs[i];
    const kelvin = spec && spec.color === undefined && !spec.colorFromPreset ? (spec.kelvin ?? SPEC_DEFAULTS.kelvin) : null;
    return {
      id: `l${i + 1}`,
      role: r.role,
      type: r.type,
      shape: r.shape,
      size: r.size,
      sizeY: r.sizeY,
      az: r.azimuthWorld - CAMERA_AZIMUTH_DEG,
      el: r.elevation,
      dist: r.dist,
      spread: r.spread,
      angle: r.angle,
      kelvin,
      color: [r.color[0], r.color[1], r.color[2]],
      power: r.energy,
      glossy: r.glossy,
      camera: r.camera,
      brightField: r.camera,
      recipeGlossy: r.glossy,
      enabled: true,
    };
  });
}

/** Irradiance of one light (same unit as `presetIrradiance`); 0 when switched off. */
export function lightIrradiance(l: LightInstance): number {
  if (!l.enabled) return 0;
  return specIrradiance({ type: l.type, energy: l.power, dist: l.dist });
}

/** Share of each light in the total irradiance, 0..1 (what "power %" shows). */
export function lightShares(lights: readonly LightInstance[]): number[] {
  const each = lights.map(lightIrradiance);
  const total = each.reduce((a, b) => a + b, 0);
  return each.map((e) => (total > 0 ? e / total : 0));
}

/** The point the rig is placed around and aimed at: centre of the visible product (not of its base or backdrop). */
export function rigPivot(state: ProjectState): Vec3 {
  const b = productBounds(state, true);
  if (isEmptyBox(b)) return [0, 0, state.scene.partSizeMm / 2];
  return boxCenter(b);
}

/**
 * Unit direction towards the sky's sun (environment kind SKY): the rig's first enabled sun light, else the
 * environment's own sun, camera-relative like a light (SPEC §3.4: sky and sun from the sun light).
 */
export function skySunDirection(state: ProjectState, lights: readonly Pick<LightInstance, 'type' | 'enabled' | 'power' | 'az' | 'el'>[] = state.studio.lights): Vec3 {
  const sun = lights.find((l) => l.type === 'SUN' && l.enabled && l.power > 0);
  const { az, el } = sun ?? state.environment.skySun;
  return normalize(polar(toWorldAzimuth(az), el, 1));
}

/** World position of a light, millimetres. */
export function lightPosition(state: ProjectState, l: Pick<LightInstance, 'az' | 'el' | 'dist'>): Vec3 {
  return add(rigPivot(state), polar(toWorldAzimuth(l.az), l.el, l.dist * state.scene.partSizeMm));
}

/**
 * Placement by reflection (SPEC §3.4): the light moves onto the camera ray
 * reflected at `point` about `normal`, keeping its distance to the pivot.
 * Returns the new az / el / dist, or null when the geometry is degenerate.
 */
export function placeByReflection(
  state: ProjectState,
  light: LightInstance,
  point: Vec3,
  normal: Vec3,
): Pick<LightInstance, 'az' | 'el' | 'dist'> | null {
  const cam = activeCamera(state);
  if (!cam) return null;
  const n = normalize(normal);
  const d = normalize(sub(point, cameraPosition(cam)));
  if (length(n) === 0 || length(d) === 0) return null;
  const r = normalize(sub(d, scale(n, 2 * dot(d, n))));
  const pivot = rigPivot(state);
  const size = state.scene.partSizeMm || 1;
  const radius = Math.max(light.dist * size, 1e-6);
  const pc = sub(point, pivot);
  const b = dot(r, pc);
  const c = dot(pc, pc) - radius * radius;
  const disc = b * b - c;
  const t = disc >= 0 ? -b + Math.sqrt(disc) : radius;
  const pos = add(point, scale(r, Math.max(t, 0)));
  const rel = sub(pos, pivot);
  const dist = length(rel);
  if (dist < 1e-9) return null;
  const el = (Math.asin(Math.max(-1, Math.min(1, rel[2] / dist))) * 180) / Math.PI;
  let az = (Math.atan2(rel[0], -rel[1]) * 180) / Math.PI - CAMERA_AZIMUTH_DEG;
  az = ((((az + 180) % 360) + 360) % 360) - 180;
  return { az, el, dist: dist / size };
}

/** Captures the current scene as a saved studio. */
export function snapshotStudio(state: ProjectState, id: string, name: string): SavedStudio {
  const assignments: SavedStudio['assignments'] = {};
  const visibility: Record<NodeId, boolean> = {};
  const used = new Set<MaterialId>();
  for (const node of Object.values(state.scene.nodes)) {
    visibility[node.id] = node.visible;
    if (node.kind !== 'PART') continue;
    const a: { material: MaterialId | null; faceMaterials?: FaceRange[] } = { material: node.material ?? null };
    if (node.faceMaterials) a.faceMaterials = node.faceMaterials.map((f) => ({ ...f }));
    assignments[node.id] = a;
    for (const m of partMaterials(node)) used.add(m);
  }
  const instances: Record<MaterialId, MaterialInstance> = {};
  for (const m of used) if (state.materials[m]) instances[m] = state.materials[m];
  return {
    id,
    name,
    preset: state.studio.preset,
    lightSetup: state.studio.lightSetup,
    customPreset: state.studio.customPreset ?? null,
    customSetup: state.studio.customSetup ?? null,
    lights: state.studio.lights,
    modified: state.studio.modified,
    floor: state.studio.floor,
    shadow: state.studio.shadow,
    environment: state.environment,
    image: state.image,
    camera: activeCamera(state),
    assignments,
    instances,
    visibility,
  };
}

function restoreStudio(state: ProjectState, saved: SavedStudio): ProjectState {
  const nodes = { ...state.scene.nodes };
  for (const [id, a] of Object.entries(saved.assignments)) {
    const node = nodes[id];
    if (!node || node.kind !== 'PART') continue;
    const next = { ...node, material: a.material };
    if (a.faceMaterials) next.faceMaterials = a.faceMaterials;
    else delete next.faceMaterials;
    nodes[id] = next;
  }
  for (const [id, v] of Object.entries(saved.visibility)) {
    if (nodes[id] && nodes[id].visible !== v) nodes[id] = { ...nodes[id], visible: v };
  }
  const cam = activeCamera(state);
  const restored: ProjectState = {
    ...state,
    scene: { ...state.scene, nodes },
    materials: { ...state.materials, ...saved.instances },
    studio: {
      ...state.studio,
      preset: saved.preset,
      lightSetup: saved.lightSetup,
      customPreset: saved.customPreset ?? null,
      customSetup: saved.customSetup ?? null,
      lights: saved.lights,
      modified: saved.modified,
      floor: saved.floor,
      shadow: saved.shadow,
      built: true,
    },
    environment: saved.environment,
    image: saved.image,
    camera: cam
      ? { ...state.camera, cameras: { ...state.camera.cameras, [cam.id]: { ...saved.camera, id: cam.id, name: cam.name } } }
      : state.camera,
  };
  return pruneMaterials(restored);
}

/** Environment kind a setup asks for, unless the user loaded an HDRI (which wins). */
function worldFor(state: ProjectState, setup: SetupRef): EnvironmentState['kind'] {
  if (state.environment.kind === 'HDRI') return 'HDRI';
  return typeof setup === 'string' ? (lightSetup(setup)?.world ?? 'STUDIO') : setup.world;
}

/** "Create studio": lights, floor, camera and engine settings of the product preset (UI §2.4). */
export function buildStudio(state: ProjectState): ProjectState {
  const p = resolvePreset(presetRefOf(state.studio));
  if (!p) return state;
  const cam = activeCamera(state);
  let camera = state.camera;
  if (cam) {
    let next: CameraState = {
      ...cam,
      focalMm: p.focalMm,
      fstop: p.fstop,
      lens: null,
      azimuth: CAMERA_AZIMUTH_DEG,
      elevation: CAMERA_ELEVATION_DEG,
      projection: 'PERSPECTIVE',
    };
    // The product, not the set around it (a sweep would frame the backdrop).
    const box = productBounds(state, true);
    if (!isEmptyBox(box)) next = frameBox(next, box, outputAspect(state));
    camera = { ...state.camera, cameras: { ...state.camera.cameras, [cam.id]: next } };
  }
  const background: EnvironmentState['background'] = p.background === 'FLAT' ? 'COLOR' : 'ENVIRONMENT';
  return {
    ...state,
    studio: {
      ...state.studio,
      built: true,
      floor: p.floor,
      shadow: p.shadow,
      lights: lightsFromRig(p, setupRefOf(state.studio)),
      modified: false,
    },
    environment: {
      ...state.environment,
      kind: worldFor(state, setupRefOf(state.studio)),
      strength: p.envStrength,
      background,
      color: [p.backgroundColor[0], p.backgroundColor[1], p.backgroundColor[2], p.backgroundColor[3]],
    },
    image: { ...state.image, exposureEv: p.exposure },
    render: { ...state.render, quality: p.quality, maxSamples: QUALITY_PRESETS[p.quality].samples },
    camera,
  };
}

export type StudioAction =
  /** A catalogue product type by `key`, or an own one (`custom`, whose key is `libraryKey(id)`). */
  | ({ type: 'studio/setPreset'; key: string; custom?: StudioPreset } & ActionBase)
  | ({ type: 'studio/build' } & ActionBase)
  | ({ type: 'studio/setSetup'; key: string } & ActionBase)
  /** An own light setup (library): normalised to the product type in force, like a catalogue one. */
  | ({ type: 'studio/applySetup'; setup: CustomSetup } & ActionBase)
  | ({ type: 'studio/setLight'; id: string; patch: Partial<Omit<LightInstance, 'id'>> } & ActionBase)
  | ({ type: 'studio/placeLight'; id: string; point: Vec3; normal: Vec3 } & ActionBase)
  | ({ type: 'studio/resetLights' } & ActionBase)
  | ({ type: 'studio/set'; patch: Partial<{ floor: boolean; shadow: boolean }> } & ActionBase)
  | ({ type: 'studio/save'; name: string } & ActionBase)
  /** Restores a saved studio of the project (`id`), or the given one (`snapshot`, from the library). */
  | ({ type: 'studio/restore'; id: string; snapshot?: SavedStudio } & ActionBase)
  | ({ type: 'studio/deleteSaved'; id: string } & ActionBase);

function patchLight(l: LightInstance, patch: Partial<Omit<LightInstance, 'id'>>): LightInstance {
  const next = { ...l, ...patch };
  // A temperature drives the colour; an explicit colour drops the temperature.
  if (patch.kelvin !== undefined && patch.kelvin !== null) next.color = kelvinToRgb(patch.kelvin);
  else if (patch.color !== undefined && patch.kelvin === undefined) next.kelvin = null;
  return next;
}

export function reduceStudio(state: ProjectState, action: StudioAction): ProjectState {
  switch (action.type) {
    case 'studio/setPreset': {
      const custom = action.custom;
      if (custom) {
        const same = state.studio.preset === custom.key && JSON.stringify(state.studio.customPreset) === JSON.stringify(custom);
        return same ? state : { ...state, studio: { ...state.studio, preset: custom.key, customPreset: custom } };
      }
      if (!studioPreset(action.key) || (state.studio.preset === action.key && !state.studio.customPreset)) return state;
      return { ...state, studio: { ...state.studio, preset: action.key, customPreset: null } };
    }
    case 'studio/build':
      return buildStudio(state);
    case 'studio/setSetup': {
      if (action.key !== 'PRESET' && !lightSetup(action.key)) return state;
      return {
        ...state,
        studio: {
          ...state.studio,
          lightSetup: action.key,
          customSetup: null,
          lights: lightsFromRig(presetRefOf(state.studio), action.key),
          modified: false,
        },
        environment: { ...state.environment, kind: worldFor(state, action.key) },
      };
    }
    case 'studio/applySetup': {
      const setup = action.setup;
      if (setup.lights.length === 0 || !isLibraryKey(setup.key)) return state;
      return {
        ...state,
        studio: {
          ...state.studio,
          lightSetup: setup.key,
          customSetup: setup,
          lights: lightsFromRig(presetRefOf(state.studio), setup),
          modified: false,
        },
        environment: { ...state.environment, kind: worldFor(state, setup) },
      };
    }
    case 'studio/setLight': {
      const i = state.studio.lights.findIndex((l) => l.id === action.id);
      if (i < 0) return state;
      const lights = [...state.studio.lights];
      lights[i] = patchLight(lights[i], action.patch);
      return { ...state, studio: { ...state.studio, lights, modified: true } };
    }
    case 'studio/placeLight': {
      const i = state.studio.lights.findIndex((l) => l.id === action.id);
      if (i < 0) return state;
      const placed = placeByReflection(state, state.studio.lights[i], action.point, action.normal);
      if (!placed) return state;
      const lights = [...state.studio.lights];
      lights[i] = { ...lights[i], ...placed };
      return { ...state, studio: { ...state.studio, lights, modified: true } };
    }
    case 'studio/resetLights':
      return {
        ...state,
        studio: { ...state.studio, lights: lightsFromRig(presetRefOf(state.studio), setupRefOf(state.studio)), modified: false },
      };
    case 'studio/set':
      return { ...state, studio: { ...state.studio, ...action.patch } };
    case 'studio/save': {
      const id = nextId('st', state.studio.saved.map((s) => s.id));
      return { ...state, studio: { ...state.studio, saved: [...state.studio.saved, snapshotStudio(state, id, action.name)] } };
    }
    case 'studio/restore': {
      const saved = action.snapshot ?? state.studio.saved.find((s) => s.id === action.id);
      return saved ? restoreStudio(state, saved) : state;
    }
    case 'studio/deleteSaved':
      return { ...state, studio: { ...state.studio, saved: state.studio.saved.filter((s) => s.id !== action.id) } };
    default:
      return state;
  }
}
