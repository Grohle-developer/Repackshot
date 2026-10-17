// The active light rig: built from a product preset (`studioRig`) or from a
// catalogue setup normalised to the preset (`setupRig`), editable light by
// light (`modified`), saved studios and placement by reflection (SPEC §3.4).

import { CAMERA_AZIMUTH_DEG, CAMERA_ELEVATION_DEG, SPEC_DEFAULTS, lightSetup } from '../data/light-setups';
import { QUALITY_PRESETS } from '../data/quality';
import { studioPreset } from '../data/studios';
import type { IesRef, LightRole, LightShape, LightSpec, LightType, RGB, StudioPreset, WorldKind } from '../data/types';
import { iesEfficiency, iesHalfAngle, iesProfileOf } from './ies';
import { kelvinToRgb, polar, specIrradiance, toWorldAzimuth } from './light-math';
import { areaLightFlux, luminance, LUMENS_PER_WATT, pointLightFlux, spotFraction } from './photometry';
import { activeRig, presetIrradiance, resolvePreset, setupExposure, type PresetRef, type SetupRef } from './rig';
import type { ActionBase, EnvironmentState, ImageState, ProjectState } from './store';
import type { SetPieceNames } from './sets';
import { activeCamera, cameraPosition, frameBox, outputAspect, type CameraState } from './camera';
import { nextId } from './ids';
import { add, boxCenter, cross, dot, isEmptyBox, length, normalize, rotateAbout, scale, sub, type Vec3 } from './math';
import { partMaterials, pruneMaterials, type MaterialId, type MaterialInstance } from './materials';
import { productBounds, type FaceRange, type NodeId } from './scene';

/**
 * The profile of an IES light (L5): the file as `IesRef` has it and `base`, the power the light was given with it (what
 * it had when the profile came in): the multiplier the inspector shows is `power / base`, 1 for the level the picture
 * was at, so the light is brightened or dimmed in steps of the picture, not of a file's candela.
 */
export interface IesLight extends IesRef {
  base: number;
}

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
  /** L4: added with Add light, not by the setup (Reset to setup takes it away). */
  own?: boolean;
  /** L4: the name the person gave it; absent, its role (a setup's light) or its type (an own light), numbered. */
  name?: string;
  /** SPOT (L4): the soft edge, a fraction of the cone's half-angle (0 a hard edge); `spread` is the cone angle. */
  blend?: number;
  /** L4: casts shadows; absent means it does. */
  shadow?: boolean;
  /** L4: where it aims, in part sizes from the rig pivot; absent, at the pivot (where every setup light aims). */
  aim?: Vec3;
  /** L4: turned about its own axis, degrees; absent or 0, a panel's sides are level with the floor. */
  roll?: number;
  /** L6: the pool of light of a set (a spot aimed at its backdrop): set decoration, like its cards (core/sets.ts). */
  setPiece?: 'POOL';
  /**
   * L5: the photometric profile of an IES light (type IES). It stays when the light's type is changed to another, so
   * changing back finds it. `power` is the level (a profile is the shape: as bright at its peak as a point light of
   * `power`); `ies.base` is what the multiplier is measured from.
   */
  ies?: IesLight;
}

/** What Add light ▸ adds (UI.md §2.2): three area shapes, a point, a spot and a sun. Stable keys. */
export type NewLightKind = 'RECTANGLE' | 'DISK' | 'SPHERE' | 'POINT' | 'SPOT' | 'SUN';
export const NEW_LIGHT_KINDS: readonly NewLightKind[] = ['RECTANGLE', 'DISK', 'SPHERE', 'POINT', 'SPOT', 'SUN'];

/** A spot's cone and soft edge when nothing says otherwise. */
export const SPOT_DEFAULTS = { cone: 40, blend: 0.25 } as const;

/** Where a new light goes (UI.md §2.2: in front of and above the part, from the active camera), its size and its share. */
export const NEW_LIGHT = {
  /** Degrees to the camera's right of its line of sight. */
  side: 25,
  /** Degrees above the horizon (a sun higher). */
  el: 40,
  sunEl: 50,
  /** Part sizes from the pivot. */
  dist: 2,
  /** Sizes in part sizes: a panel, a disc, a glowing sphere (diameter) and the bulb of a point or a spot (diameter). */
  rect: [0.8, 0.5] as const,
  disk: 0.6,
  sphere: 0.3,
  bulb: 0.02,
} as const;

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
      // What an own setup of the library carries for its lights (L4); no catalogue recipe has them.
      ...(spec?.blend !== undefined ? { blend: spec.blend } : {}),
      ...(spec?.shadow === false ? { shadow: false } : {}),
      ...(spec?.aim ? { aim: [spec.aim[0], spec.aim[1], spec.aim[2]] as Vec3 } : {}),
      ...(spec?.roll ? { roll: spec.roll } : {}),
      // An own IES light of the setup keeps its profile (L5); its multiplier starts again from the power it has here.
      ...(spec?.ies ? { ies: { name: spec.ies.name, text: spec.ies.text, base: r.energy } } : {}),
    };
  });
}

/** The irradiance (same unit as `lightIrradiance`) a new light starts with: the mean of the lights on, or a third of the type's. */
function newLightIrradiance(state: ProjectState): number {
  const on = state.studio.lights.filter((l) => l.enabled && l.power > 0);
  if (on.length > 0) return on.reduce((a, l) => a + lightIrradiance(l), 0) / on.length;
  return presetIrradiance(presetRefOf(state.studio)) / 3;
}

/**
 * A light of Add light ▸ (UI.md §2.2): in front of and above the part as the active camera sees it, switched on,
 * as bright as the mean of the lights that are on (so the picture does not jump), white at 5600 K.
 */
export function newLight(state: ProjectState, kind: NewLightKind, id: string): LightInstance {
  const cam = activeCamera(state);
  const azWorld = (cam?.azimuth ?? CAMERA_AZIMUTH_DEG) + NEW_LIGHT.side;
  const sun = kind === 'SUN';
  const type: LightInstance['type'] = sun ? 'SUN' : kind === 'POINT' ? 'POINT' : kind === 'SPOT' ? 'SPOT' : 'AREA';
  const shape: LightInstance['shape'] = kind === 'DISK' ? 'DISK' : kind === 'SPHERE' ? 'SPHERE' : 'RECTANGLE';
  const [w, h] = kind === 'RECTANGLE' ? NEW_LIGHT.rect : kind === 'DISK' ? [NEW_LIGHT.disk, NEW_LIGHT.disk] : kind === 'SPHERE' ? [NEW_LIGHT.sphere, NEW_LIGHT.sphere] : [NEW_LIGHT.bulb, NEW_LIGHT.bulb];
  const dist = NEW_LIGHT.dist;
  const target = newLightIrradiance(state);
  // specIrradiance backwards: the rest spread with the square of the distance. A sun's power is its irradiance, which
  // the engine delivers as it is, while a panel, a point or a spot deliver pi times their measure on their axis
  // (core/photometry.ts): the sun gets pi times the mean, so it looks as bright as the others.
  const power = sun ? Math.PI * target : target * 4 * Math.PI * dist * dist;
  const kelvin = SPEC_DEFAULTS.kelvin;
  return {
    id,
    role: 'FILL',
    type,
    shape,
    size: w,
    sizeY: h,
    az: wrapDeg(azWorld - CAMERA_AZIMUTH_DEG),
    el: sun ? NEW_LIGHT.sunEl : NEW_LIGHT.el,
    dist,
    spread: kind === 'SPOT' ? SPOT_DEFAULTS.cone : 180,
    angle: SPEC_DEFAULTS.angle,
    kelvin,
    color: kelvinToRgb(kelvin),
    power: Math.round(power * 1000) / 1000,
    glossy: true,
    camera: false,
    brightField: false,
    recipeGlossy: true,
    enabled: true,
    own: true,
    ...(kind === 'SPOT' ? { blend: SPOT_DEFAULTS.blend } : {}),
  };
}

/**
 * Add light ▸ IES… (L5): a point light that follows the profile of `ies`, placed and calibrated like a new point light
 * (in front of and above the part, as bright on its axis as the mean of the lights that are on, so the picture does not
 * jump). Its peak is where the profile is brightest, and the light is aimed at the centre of the product, so a profile
 * that is brightest on its axis lights the product as the point light would, and a batwing a little less.
 */
export function newIesLight(state: ProjectState, ies: IesRef, id: string): LightInstance {
  const point = newLight(state, 'POINT', id);
  return { ...point, type: 'IES', ies: { name: ies.name, text: ies.text, base: point.power } };
}

/** A fresh light id: never one of a light, a camera or a scene node. */
export function nextLightId(state: ProjectState): string {
  return nextId('l', [...state.studio.lights.map((l) => l.id), ...Object.keys(state.camera.cameras), ...Object.keys(state.scene.nodes)]);
}

/** Irradiance of one light (same unit as `presetIrradiance`); 0 when switched off. */
export function lightIrradiance(l: LightInstance): number {
  if (!l.enabled) return 0;
  return specIrradiance({ type: l.type, energy: l.power, dist: l.dist });
}

/** The `cos^n` exponent of an area light's spread (the engine's `spread_exponent`): its intensity halves at spread / 2. */
export function spreadExponent(spreadDeg: number): number {
  if (spreadDeg >= 180) return 0;
  const half = (Math.max(1, spreadDeg) * Math.PI) / 360;
  return -1 / Math.log2(Math.cos(half));
}

/**
 * The light's lumens (L4: the aid next to its watts), from the flux the engine is given for it (RSB `LGHT.power`)
 * and the luminance of its colour (`LUMENS_PER_WATT`): a panel's flux narrowed by its spread, a point's or a
 * sphere's whole flux, a spot's share of it in its cone. A sun has lux instead (its irradiance in lumens per m2).
 */
export function lightLumens(state: ProjectState, l: LightInstance): { value: number; unit: 'lm' | 'lx' } {
  const y = luminance(l.color) * LUMENS_PER_WATT;
  const p = Math.max(0, l.power);
  if (l.type === 'SUN') return { value: p * y, unit: 'lx' };
  const size = state.scene.partSizeMm;
  if (l.type === 'SPOT') return { value: pointLightFlux(p, size) * spotFraction(l.spread, l.blend ?? SPOT_DEFAULTS.blend) * y, unit: 'lm' };
  // An IES light sends the share of its peak's point that its profile has over the sphere (the file's flux over 4 pi times
  // its peak: its efficiency), whatever the lumens the file was written for.
  if (l.type === 'IES') {
    const profile = l.ies ? iesProfileOf(l.ies.text) : null;
    return { value: pointLightFlux(p, size) * (profile ? iesEfficiency(profile) : 1) * y, unit: 'lm' };
  }
  if (isSphereLike(l)) return { value: pointLightFlux(p, size) * y, unit: 'lm' };
  const n = spreadExponent(l.spread);
  return { value: areaLightFlux(p, size) * (2 / (n + 2)) * y, unit: 'lm' };
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
export function skySunDirection(state: ProjectState, lights: readonly Pick<LightInstance, 'type' | 'enabled' | 'power' | 'az' | 'el' | 'dist' | 'aim'>[] = state.studio.lights): Vec3 {
  const sun = lights.find((l) => l.type === 'SUN' && l.enabled && l.power > 0);
  // A sun aimed elsewhere (L4) shines from its position towards its aim, as the engine has it.
  if (sun?.aim) {
    const d = normalize(sub(lightPosition(state, sun), lightAimPoint(state, sun)));
    if (length(d) > 0) return d;
  }
  const { az, el } = sun ?? state.environment.skySun;
  return normalize(polar(toWorldAzimuth(az), el, 1));
}

/** World position of a light, millimetres. */
export function lightPosition(state: ProjectState, l: Pick<LightInstance, 'az' | 'el' | 'dist'>): Vec3 {
  return add(rigPivot(state), polar(toWorldAzimuth(l.az), l.el, l.dist * state.scene.partSizeMm));
}

/** The world point a light aims at, millimetres: the rig pivot, or its own aim (L4) measured from there. */
export function lightAimPoint(state: ProjectState, l: Pick<LightInstance, 'aim'>): Vec3 {
  const pivot = rigPivot(state);
  return l.aim ? add(pivot, scale(l.aim, state.scene.partSizeMm)) : pivot;
}

/**
 * The up vector of something that looks along `forward` with no roll: the world's Z made square to it (its Y
 * when it looks straight up or down). A panel's sides are then level with the floor.
 */
export function levelUp(forward: Vec3): Vec3 {
  const z = sub([0, 0, 1], scale(forward, forward[2]));
  if (length(z) > 1e-6) return normalize(z);
  return normalize(sub([0, 1, 0], scale(forward, forward[1])));
}

/** Where a light is and how it is turned (L4): unit `forward` (where its light goes), `up` (rolled) and `right` = forward × up. */
export interface LightFrame {
  position: Vec3;
  target: Vec3;
  forward: Vec3;
  up: Vec3;
  right: Vec3;
}

export function lightFrame(state: ProjectState, l: Pick<LightInstance, 'az' | 'el' | 'dist' | 'aim' | 'roll'>): LightFrame {
  const position = lightPosition(state, l);
  const target = lightAimPoint(state, l);
  let forward = normalize(sub(target, position));
  if (length(forward) === 0) forward = normalize(sub(rigPivot(state), position));
  if (length(forward) === 0) forward = [0, 0, -1];
  const up = normalize(rotateAbout(levelUp(forward), forward, l.roll ?? 0));
  return { position, target, forward, up, right: cross(forward, up) };
}

/** Signed angle (degrees) that turns `from` into `to` about `axis` (all square to it). */
function angleAbout(from: Vec3, to: Vec3, axis: Vec3): number {
  return (Math.atan2(dot(axis, cross(from, to)), dot(from, to)) * 180) / Math.PI;
}

/** Degrees in [-180, 180). */
export const wrapDeg = (a: number): number => ((((a + 180) % 360) + 360) % 360) - 180;

/** The az / el / dist (around the rig pivot, as a light has them) of a world position; null at the pivot itself. */
export function polarAboutPivot(state: ProjectState, pos: Vec3): Pick<LightInstance, 'az' | 'el' | 'dist'> | null {
  const rel = sub(pos, rigPivot(state));
  const dist = length(rel);
  const size = state.scene.partSizeMm || 1;
  if (dist < size * 1e-6) return null;
  const el = (Math.asin(Math.max(-1, Math.min(1, rel[2] / dist))) * 180) / Math.PI;
  const az = wrapDeg((Math.atan2(rel[0], -rel[1]) * 180) / Math.PI - CAMERA_AZIMUTH_DEG);
  return { az, el, dist: dist / size };
}

/** A world aim point as a light keeps it: part sizes from the pivot. */
export function aimOffset(state: ProjectState, target: Vec3): Vec3 {
  const size = state.scene.partSizeMm || 1;
  const d = sub(target, rigPivot(state));
  return [d[0] / size, d[1] / size, d[2] / size];
}

/**
 * The placement (what `studio/setLight` takes) of a light at the world `position`, aiming at `target`, with `up`
 * (null: keep its roll). Null when the position is the pivot itself or the light would aim at itself.
 */
export function placementOf(state: ProjectState, position: Vec3, target: Vec3, up: Vec3 | null, roll = 0): Partial<LightInstance> | null {
  const polarPos = polarAboutPivot(state, position);
  const forward = normalize(sub(target, position));
  if (!polarPos || length(forward) === 0) return null;
  const patch: Partial<LightInstance> = { ...polarPos, aim: aimOffset(state, target) };
  patch.roll = up ? wrapDeg(angleAbout(levelUp(forward), normalize(sub(up, scale(forward, dot(up, forward)))), forward)) : roll;
  if (Math.abs(patch.roll) < 1e-9) patch.roll = 0;
  return patch;
}

/** A light the engine draws as a glowing sphere (or a point): a point, a spot, an IES light, or an area light of shape SPHERE. */
export function isSphereLike(l: Pick<LightInstance, 'type' | 'shape'>): boolean {
  return l.type === 'POINT' || l.type === 'SPOT' || l.type === 'IES' || (l.type === 'AREA' && l.shape === 'SPHERE');
}

/**
 * The full angle of the cone of a light that has one, degrees: a spot's, and for an IES light (L5) its beam angle, twice
 * the angle at which the profile falls to half of its peak (`iesHalfAngle`: what the glyph draws, what looking through the
 * light frames; the Fast preview's spot light has its soft edge around it, `iesSpot`). Null for the others, and for an IES
 * light whose file cannot be read (it is drawn as a point).
 */
export function lightConeDeg(l: Pick<LightInstance, 'type' | 'spread' | 'ies'>): number | null {
  if (l.type === 'SPOT') return Math.min(179, Math.max(1, l.spread));
  if (l.type === 'IES') {
    const profile = l.ies ? iesProfileOf(l.ies.text) : null;
    return profile ? Math.min(179, Math.max(2, 2 * iesHalfAngle(profile))) : null;
  }
  return null;
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
  if (length(sub(pos, pivot)) < 1e-9) return null;
  return polarAboutPivot(state, pos);
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

/**
 * The project with a saved studio put on (what `studio/restore` does): its materials, lights, floor, environment and
 * image, and, unless `camera` is false (N2: a batch renders each camera in each studio, so the studio must not take the
 * camera's view away), its camera's view and optics. A pure function of the two: it changes nothing in any store.
 */
export function restoreStudio(state: ProjectState, saved: SavedStudio, opts: { camera?: boolean } = {}): ProjectState {
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
    // The camera's view and optics come back; the ratio of the image is the project's choice (U13), not the studio's.
    camera:
      cam && opts.camera !== false
        ? { ...state.camera, cameras: { ...state.camera.cameras, [cam.id]: { ...saved.camera, id: cam.id, name: cam.name, aspect: cam.aspect } } }
        : state.camera,
  };
  return pruneMaterials(restored);
}

/** Environment kind a setup asks for, unless the user loaded an HDRI (which wins). */
export function worldFor(state: ProjectState, setup: SetupRef): EnvironmentState['kind'] {
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
    // L6: a type that is a set has its offset in its exposure; any other setup starts from the type's base.
    image: { ...state.image, exposureEv: setupExposure(p, setupRefOf(state.studio)) },
    render: { ...state.render, quality: p.quality, maxSamples: QUALITY_PRESETS[p.quality].samples },
    camera,
  };
}

export type StudioAction =
  /** A catalogue product type by `key`, or an own one (`custom`, whose key is `libraryKey(id)`). */
  | ({ type: 'studio/setPreset'; key: string; custom?: StudioPreset } & ActionBase)
  /** `names`: what the pieces of a set (L6) are called, in the interface's language (core/sets.ts). */
  | ({ type: 'studio/build'; names?: SetPieceNames } & ActionBase)
  | ({ type: 'studio/setSetup'; key: string; names?: SetPieceNames } & ActionBase)
  /** L6: Use the set's camera — the elevation and focal length the set in force suggests, the product framed again. */
  | ({ type: 'studio/useSetCamera' } & ActionBase)
  /** L6: the decoration of the set in force made again for the scene as it is (a product came in). */
  | ({ type: 'studio/fitSet'; names?: SetPieceNames } & ActionBase)
  /** An own light setup (library): normalised to the product type in force, like a catalogue one. */
  | ({ type: 'studio/applySetup'; setup: CustomSetup } & ActionBase)
  | ({ type: 'studio/setLight'; id: string; patch: Partial<Omit<LightInstance, 'id'>> } & ActionBase)
  | ({ type: 'studio/placeLight'; id: string; point: Vec3; normal: Vec3 } & ActionBase)
  /** L4: Add light ▸ — a new own light, selected. */
  | ({ type: 'studio/addLight'; kind: NewLightKind } & ActionBase)
  /** L5: Add light ▸ IES… — a new own light with the photometric profile `ies` (a file that cannot be read adds nothing), selected. */
  | ({ type: 'studio/addIesLight'; ies: IesRef } & ActionBase)
  /** L4: a copy of a light (an own light, a little to the side), selected. */
  | ({ type: 'studio/duplicateLight'; id: string } & ActionBase)
  /** L4: a light of the setup or an own one goes. */
  | ({ type: 'studio/deleteLight'; id: string } & ActionBase)
  /** L4: Aim at… a world point; null aims it at the rig pivot again (the centre of the product). */
  | ({ type: 'studio/aimLight'; id: string; target: Vec3 | null } & ActionBase)
  /** L4: Place on surface — the light stands over `point` along `normal`, as far as it was from its aim, and aims there. */
  | ({ type: 'studio/placeOnSurface'; id: string; point: Vec3; normal: Vec3 } & ActionBase)
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
    case 'studio/addLight': {
      if (!NEW_LIGHT_KINDS.includes(action.kind)) return state;
      const id = nextLightId(state);
      const light = newLight(state, action.kind, id);
      return { ...state, studio: { ...state.studio, lights: [...state.studio.lights, light], modified: true }, selection: { level: state.selection.level, ids: [id] } };
    }
    case 'studio/addIesLight': {
      if (!iesProfileOf(action.ies.text)) return state;
      const id = nextLightId(state);
      const light = newIesLight(state, action.ies, id);
      return { ...state, studio: { ...state.studio, lights: [...state.studio.lights, light], modified: true }, selection: { level: state.selection.level, ids: [id] } };
    }
    case 'studio/duplicateLight': {
      const src = state.studio.lights.find((l) => l.id === action.id);
      if (!src) return state;
      const id = nextLightId(state);
      const copy: LightInstance = { ...src, id, own: true, az: wrapDeg(src.az + 15), color: [src.color[0], src.color[1], src.color[2]] };
      delete copy.name;
      if (src.aim) copy.aim = [src.aim[0], src.aim[1], src.aim[2]];
      const i = state.studio.lights.indexOf(src);
      const lights = [...state.studio.lights.slice(0, i + 1), copy, ...state.studio.lights.slice(i + 1)];
      return { ...state, studio: { ...state.studio, lights, modified: true }, selection: { level: state.selection.level, ids: [id] } };
    }
    case 'studio/deleteLight': {
      if (!state.studio.lights.some((l) => l.id === action.id)) return state;
      const lights = state.studio.lights.filter((l) => l.id !== action.id);
      const ids = state.selection.ids.filter((x) => x !== action.id);
      const selection = ids.length === state.selection.ids.length ? state.selection : { ...state.selection, ids };
      return { ...state, studio: { ...state.studio, lights, modified: true }, selection };
    }
    case 'studio/aimLight': {
      const i = state.studio.lights.findIndex((l) => l.id === action.id);
      if (i < 0) return state;
      const l = state.studio.lights[i];
      const next: LightInstance = { ...l };
      if (action.target === null) delete next.aim;
      else {
        const aim = aimOffset(state, action.target);
        if (length(sub(action.target, lightPosition(state, l))) < 1e-9) return state;
        next.aim = aim;
      }
      if (JSON.stringify(next.aim ?? null) === JSON.stringify(l.aim ?? null)) return state;
      const lights = [...state.studio.lights];
      lights[i] = next;
      return { ...state, studio: { ...state.studio, lights, modified: true } };
    }
    case 'studio/placeOnSurface': {
      const i = state.studio.lights.findIndex((l) => l.id === action.id);
      if (i < 0) return state;
      const l = state.studio.lights[i];
      const n = normalize(action.normal);
      if (length(n) === 0) return state;
      const f = lightFrame(state, l);
      const reach = Math.max(length(sub(f.position, f.target)), (state.scene.partSizeMm || 1) * 0.05);
      const placed = placementOf(state, add(action.point, scale(n, reach)), action.point, null, l.roll ?? 0);
      if (!placed) return state;
      const lights = [...state.studio.lights];
      lights[i] = { ...l, ...placed };
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
