// The user's library as a file and in the browser (U4, SPEC §3.9). The same envelope is the exported JSON and
// what `localStorage` holds under one key: `{ format: 'repackshot-library', schema: 1, items }`, `items` a flat
// list of items, each with its `kind`. Everything that comes in (a file, the storage) is validated item by item
// and rebuilt from the fields it knows; an item that does not pass is skipped with its reason and the rest are
// kept. Depends on core, never the other way.

import { LIGHT_ROLES, LIGHT_SHAPES, LIGHT_TYPES } from '../data/light-setups';
import type { LightSpec, RGB, RGBA, StudioPreset, WearProps, WorldKind } from '../data/types';
import { WEAR_PROP_DEFAULTS } from '../data/wear';
import type { CameraState } from '../core/camera';
import {
  COLLECTION,
  LIBRARY_FORMAT,
  LIBRARY_KINDS,
  LIBRARY_SCHEMA,
  addItem,
  allItems,
  emptyLibrary,
  itemsOf,
  type ItemBase,
  type ImportResult,
  type Library,
  type LibraryItem,
  type SkippedItem,
  type MaterialPayload,
  type ProductTypePayload,
  type StudioPayload,
} from '../core/library';
import { isLibraryKey, type CustomSetup, type LightInstance } from '../core/lighting';
import { defaultTextures, type MaterialInstance, type MaterialTextures } from '../core/materials';
import type { EnvironmentState, ImageState } from '../core/store';

export { LIBRARY_FORMAT, LIBRARY_SCHEMA };
export type { ImportResult, SkippedItem };

/** Key of the one `localStorage` entry that holds the library. */
export const LIBRARY_STORAGE_KEY = 'repackshot.library';

/** An imported file or storage entry larger than this many items is refused as a whole. */
export const MAX_ITEMS = 5000;

/** A thumbnail longer than this (as a data URL) is dropped; the item is kept. */
const THUMB_MAX = 300_000;

// --- Export -------------------------------------------------------------------------------

export interface LibraryFile {
  format: typeof LIBRARY_FORMAT;
  schema: number;
  items: LibraryItem[];
}

/** The library as JSON text: `{ format, schema, items }`. */
export function exportLibrary(lib: Library): string {
  const file: LibraryFile = { format: LIBRARY_FORMAT, schema: LIBRARY_SCHEMA, items: allItems(lib) };
  return JSON.stringify(file, null, 1);
}

// --- Validation ---------------------------------------------------------------------------

/** Why a value was refused: a path and what was wrong with it. */
class Invalid extends Error {}

const fail = (path: string, what: string): never => {
  throw new Invalid(`${path}: ${what}`);
};

type Rec = Record<string, unknown>;

function obj(v: unknown, path: string): Rec {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) fail(path, 'is not an object');
  return v as Rec;
}

function arr(v: unknown, path: string, min = 0, max = 256): unknown[] {
  if (!Array.isArray(v)) fail(path, 'is not a list');
  const a = v as unknown[];
  if (a.length < min || a.length > max) fail(path, `has ${a.length} entries (${min}..${max} expected)`);
  return a;
}

function str(v: unknown, path: string, max = 200): string {
  if (typeof v !== 'string') fail(path, 'is not text');
  if ((v as string).length > max) fail(path, `is longer than ${max} characters`);
  return v as string;
}

function num(v: unknown, path: string, min = -1e9, max = 1e9): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) fail(path, 'is not a number');
  const n = v as number;
  if (n < min || n > max) fail(path, `is ${n} (${min}..${max} expected)`);
  return n;
}

function bool(v: unknown, path: string): boolean {
  if (typeof v !== 'boolean') fail(path, 'is not true or false');
  return v as boolean;
}

function oneOf<T extends string>(v: unknown, path: string, options: readonly T[]): T {
  if (typeof v !== 'string' || !options.includes(v as T)) fail(path, `is not one of ${options.join(', ')}`);
  return v as T;
}

function rgb(v: unknown, path: string): RGB {
  const a = arr(v, path, 3, 3);
  return [num(a[0], `${path}[0]`, 0, 100), num(a[1], `${path}[1]`, 0, 100), num(a[2], `${path}[2]`, 0, 100)];
}

function rgba(v: unknown, path: string): RGBA {
  const a = arr(v, path, 4, 4);
  return [num(a[0], `${path}[0]`, 0, 100), num(a[1], `${path}[1]`, 0, 100), num(a[2], `${path}[2]`, 0, 100), num(a[3], `${path}[3]`, 0, 1)];
}

const opt = <T>(v: unknown, read: (x: unknown) => T): T | undefined => (v === undefined || v === null ? undefined : read(v));

/** Keys that would reach the prototype of a plain object. */
const isUnsafeKey = (k: string): boolean => k === '__proto__';

function lightSpec(v: unknown, path: string): LightSpec {
  const o = obj(v, path);
  const spec: LightSpec = {
    role: oneOf(o.role, `${path}.role`, Object.keys(LIGHT_ROLES) as (keyof typeof LIGHT_ROLES)[]),
    size: num(o.size, `${path}.size`, 0.001, 1000),
    az: num(o.az, `${path}.az`, -720, 720),
    el: num(o.el, `${path}.el`, -90, 90),
    dist: num(o.dist, `${path}.dist`, 0.001, 1000),
  };
  const type = opt(o.type, (x) => oneOf(x, `${path}.type`, LIGHT_TYPES));
  if (type) spec.type = type;
  const shape = opt(o.shape, (x) => oneOf(x, `${path}.shape`, LIGHT_SHAPES));
  if (shape) spec.shape = shape;
  const sizeY = opt(o.sizeY, (x) => num(x, `${path}.sizeY`, 0.001, 1000));
  if (sizeY !== undefined) spec.sizeY = sizeY;
  const spread = opt(o.spread, (x) => num(x, `${path}.spread`, 0, 360));
  if (spread !== undefined) spec.spread = spread;
  const angle = opt(o.angle, (x) => num(x, `${path}.angle`, 0, 7));
  if (angle !== undefined) spec.angle = angle;
  const kelvin = opt(o.kelvin, (x) => num(x, `${path}.kelvin`, 1000, 40000));
  if (kelvin !== undefined) spec.kelvin = kelvin;
  const color = opt(o.color, (x) => rgb(x, `${path}.color`));
  if (color) spec.color = color;
  const share = opt(o.share, (x) => num(x, `${path}.share`, 0, 1e6));
  if (share !== undefined) spec.share = share;
  const energy = opt(o.energy, (x) => num(x, `${path}.energy`, 0, 1e7));
  if (energy !== undefined) spec.energy = energy;
  const glossy = opt(o.glossy, (x) => bool(x, `${path}.glossy`));
  if (glossy !== undefined) spec.glossy = glossy;
  const camera = opt(o.camera, (x) => bool(x, `${path}.camera`));
  if (camera !== undefined) spec.camera = camera;
  const fromPreset = opt(o.colorFromPreset, (x) => bool(x, `${path}.colorFromPreset`));
  if (fromPreset !== undefined) spec.colorFromPreset = fromPreset;
  return spec;
}

function lightSpecs(v: unknown, path: string, min: number): LightSpec[] {
  return arr(v, path, min, 32).map((x, i) => lightSpec(x, `${path}[${i}]`));
}

const FAMILIES = ['SIMPLE', 'GLASS', 'WOOD', 'FABRIC', 'EMISSIVE'] as const;
const CATEGORIES = ['METAL', 'PLASTIC', 'WOOD', 'FABRIC', 'GLASS', 'EMISSIVE', 'OTHER'] as const;
const WORLDS: readonly WorldKind[] = ['STUDIO', 'SKY', 'FLAT'];
const QUALITIES = ['DRAFT', 'PREVIEW', 'FINAL'] as const;
const PROJECTIONS = ['BOX', 'PLANAR', 'CYLINDRICAL', 'UV'] as const;

/** Parameters of a material: any name made of letters and digits, with a number, text, flag or colour. */
function params(v: unknown, path: string): MaterialInstance['params'] {
  const o = obj(v, path);
  const out: Rec = {};
  for (const [k, x] of Object.entries(o)) {
    if (!/^[A-Za-z][A-Za-z0-9]{0,40}$/.test(k) || isUnsafeKey(k)) fail(`${path}.${k}`, 'is not a parameter name');
    if (typeof x === 'number') out[k] = num(x, `${path}.${k}`);
    else if (typeof x === 'string') out[k] = str(x, `${path}.${k}`, 64);
    else if (typeof x === 'boolean') out[k] = x;
    else if (Array.isArray(x)) out[k] = arr(x, `${path}.${k}`, 1, 4).map((n, i) => num(n, `${path}.${k}[${i}]`));
    else fail(`${path}.${k}`, 'is not a number, text, flag or colour');
  }
  return out as MaterialInstance['params'];
}

/** The wear of a material: every property of the table, the file's value when it has one and the default when not. */
function wear(v: unknown, path: string): WearProps {
  const o = v === undefined ? {} : obj(v, path);
  const out: Rec = {};
  for (const [k, d] of Object.entries(WEAR_PROP_DEFAULTS)) {
    const x = o[k];
    if (x === undefined) out[k] = Array.isArray(d) ? [...d] : d;
    else if (typeof d === 'number') out[k] = num(x, `${path}.${k}`);
    else if (typeof d === 'boolean') out[k] = bool(x, `${path}.${k}`);
    else if (typeof d === 'string') out[k] = str(x, `${path}.${k}`, 64);
    else out[k] = rgba(x, `${path}.${k}`);
  }
  return out as unknown as WearProps;
}

function textures(v: unknown, path: string): MaterialTextures {
  const d = defaultTextures();
  if (v === undefined) return d;
  const o = obj(v, path);
  const off = o.offset === undefined ? d.offset : arr(o.offset, `${path}.offset`, 2, 2).map((n, i) => num(n, `${path}.offset[${i}]`));
  return {
    // Image maps name files of a project: they do not travel in a library.
    color: null,
    roughness: null,
    metal: null,
    normal: null,
    alpha: null,
    projection: o.projection === undefined ? d.projection : oneOf(o.projection, `${path}.projection`, PROJECTIONS),
    scale: o.scale === undefined ? d.scale : num(o.scale, `${path}.scale`, 0.0001, 1e6),
    rotationDeg: o.rotationDeg === undefined ? d.rotationDeg : num(o.rotationDeg, `${path}.rotationDeg`, -3600, 3600),
    offset: [off[0], off[1]],
  };
}

function materialPayload(v: unknown, path: string): MaterialPayload {
  const o = obj(v, path);
  return {
    family: oneOf(o.family, `${path}.family`, FAMILIES),
    category: oneOf(o.category, `${path}.category`, CATEGORIES),
    params: params(o.params, `${path}.params`),
    wear: wear(o.wear, `${path}.wear`),
    textures: textures(o.textures, `${path}.textures`),
    bevelRadiusMm: o.bevelRadiusMm === undefined ? 0 : num(o.bevelRadiusMm, `${path}.bevelRadiusMm`, 0, 1e6),
  };
}

function productTypePayload(v: unknown, path: string): ProductTypePayload {
  const o = obj(v, path);
  return {
    sizeMm: num(o.sizeMm, `${path}.sizeMm`, 0.01, 1e6),
    focalMm: num(o.focalMm, `${path}.focalMm`, 4, 2000),
    fstop: num(o.fstop, `${path}.fstop`, 0.5, 64),
    envStrength: num(o.envStrength, `${path}.envStrength`, 0, 100),
    exposure: num(o.exposure, `${path}.exposure`, -20, 20),
    background: oneOf(o.background, `${path}.background`, ['FLAT', 'HDRI'] as const),
    backgroundColor: rgba(o.backgroundColor, `${path}.backgroundColor`),
    floor: bool(o.floor, `${path}.floor`),
    shadow: bool(o.shadow, `${path}.shadow`),
    caustics: bool(o.caustics, `${path}.caustics`),
    quality: oneOf(o.quality, `${path}.quality`, QUALITIES),
    lights: lightSpecs(o.lights, `${path}.lights`, 1),
  };
}

function lightInstance(v: unknown, path: string): LightInstance {
  const o = obj(v, path);
  return {
    id: str(o.id, `${path}.id`, 64),
    role: oneOf(o.role, `${path}.role`, Object.keys(LIGHT_ROLES) as (keyof typeof LIGHT_ROLES)[]),
    type: oneOf(o.type, `${path}.type`, LIGHT_TYPES),
    shape: oneOf(o.shape, `${path}.shape`, LIGHT_SHAPES),
    size: num(o.size, `${path}.size`, 0.001, 1000),
    sizeY: num(o.sizeY, `${path}.sizeY`, 0.001, 1000),
    az: num(o.az, `${path}.az`, -720, 720),
    el: num(o.el, `${path}.el`, -90, 90),
    dist: num(o.dist, `${path}.dist`, 0.001, 1000),
    spread: num(o.spread, `${path}.spread`, 0, 360),
    angle: num(o.angle, `${path}.angle`, 0, 7),
    kelvin: o.kelvin === null ? null : num(o.kelvin, `${path}.kelvin`, 1000, 40000),
    color: rgb(o.color, `${path}.color`),
    power: num(o.power, `${path}.power`, 0, 1e7),
    glossy: bool(o.glossy, `${path}.glossy`),
    camera: bool(o.camera, `${path}.camera`),
    brightField: bool(o.brightField, `${path}.brightField`),
    recipeGlossy: bool(o.recipeGlossy, `${path}.recipeGlossy`),
    enabled: bool(o.enabled, `${path}.enabled`),
  };
}

function environment(v: unknown, path: string): EnvironmentState {
  const o = obj(v, path);
  return {
    kind: oneOf(o.kind, `${path}.kind`, ['STUDIO', 'SKY', 'FLAT', 'HDRI'] as const),
    strength: num(o.strength, `${path}.strength`, 0, 100),
    rotationDeg: num(o.rotationDeg, `${path}.rotationDeg`, -3600, 3600),
    background: oneOf(o.background, `${path}.background`, ['ENVIRONMENT', 'COLOR', 'TRANSPARENT', 'BACKPLATE'] as const),
    color: rgba(o.color, `${path}.color`),
    groundShadow: num(o.groundShadow, `${path}.groundShadow`, 0, 1),
    groundReflection: num(o.groundReflection, `${path}.groundReflection`, 0, 1),
    // E5: the library keeps no image files, so a studio comes back without its HDRI or background image
    // (the dome and the colour stand in); the other fields of E5 are optional, older files lack them.
    hdri: null,
    backplate: null,
    backplateFit: o.backplateFit === undefined ? 'FILL' : oneOf(o.backplateFit, `${path}.backplateFit`, ['FILL', 'FIT', 'STRETCH'] as const),
    skyTurbidity: o.skyTurbidity === undefined ? 3 : num(o.skyTurbidity, `${path}.skyTurbidity`, 1, 10),
    skySun: o.skySun === undefined ? { az: -55, el: 55 } : { az: num(obj(o.skySun, `${path}.skySun`).az, `${path}.skySun.az`, -3600, 3600), el: num(obj(o.skySun, `${path}.skySun`).el, `${path}.skySun.el`, -90, 90) },
  };
}

function image(v: unknown, path: string): ImageState {
  const o = obj(v, path);
  return {
    exposureEv: num(o.exposureEv, `${path}.exposureEv`, -20, 20),
    viewTransform: oneOf(o.viewTransform, `${path}.viewTransform`, ['STANDARD', 'FILMIC', 'AGX'] as const),
    bloom: num(o.bloom, `${path}.bloom`, 0, 1),
    sharpen: num(o.sharpen, `${path}.sharpen`, 0, 1),
    saturation: num(o.saturation, `${path}.saturation`, -1, 1),
    contrast: num(o.contrast, `${path}.contrast`, -1, 1),
    vignette: num(o.vignette, `${path}.vignette`, 0, 1),
  };
}

function vec3(v: unknown, path: string): [number, number, number] {
  const a = arr(v, path, 3, 3);
  return [num(a[0], `${path}[0]`), num(a[1], `${path}[1]`), num(a[2], `${path}[2]`)];
}

function camera(v: unknown, path: string): CameraState {
  const o = obj(v, path);
  return {
    id: str(o.id, `${path}.id`, 64),
    name: str(o.name, `${path}.name`),
    azimuth: num(o.azimuth, `${path}.azimuth`, -3600, 3600),
    elevation: num(o.elevation, `${path}.elevation`, -90, 90),
    distance: num(o.distance, `${path}.distance`, 0, 1e9),
    target: vec3(o.target, `${path}.target`),
    focalMm: num(o.focalMm, `${path}.focalMm`, 4, 2000),
    fstop: num(o.fstop, `${path}.fstop`, 0.5, 64),
    focusDistance: num(o.focusDistance, `${path}.focusDistance`, 0, 1e9),
    projection: oneOf(o.projection, `${path}.projection`, ['PERSPECTIVE', 'ORTHOGRAPHIC'] as const),
    orthoWidth: num(o.orthoWidth, `${path}.orthoWidth`, 0, 1e9),
    clipStart: num(o.clipStart, `${path}.clipStart`, 0, 1e9),
    clipEnd: num(o.clipEnd, `${path}.clipEnd`, 0, 1e9),
    locked: bool(o.locked, `${path}.locked`),
    lens: o.lens === null ? null : str(o.lens, `${path}.lens`, 64),
  };
}

function materialInstance(v: unknown, path: string, id: string): MaterialInstance {
  const o = obj(v, path);
  const p = materialPayload(o, path);
  return {
    id,
    name: o.name === null ? null : str(o.name, `${path}.name`),
    preset: o.preset === null || o.preset === undefined ? null : str(o.preset, `${path}.preset`, 64),
    origin: o.origin === null || o.origin === undefined ? null : str(o.origin, `${path}.origin`, 64),
    edited: o.edited === undefined ? false : bool(o.edited, `${path}.edited`),
    ...(o.library === undefined ? {} : { library: o.library === null ? null : str(o.library, `${path}.library`, 100) }),
    ...p,
    ...(o.role === 'DEFAULT' ? { role: 'DEFAULT' as const } : {}),
  };
}

function record<T>(v: unknown, path: string, read: (x: unknown, p: string, key: string) => T): Record<string, T> {
  const o = obj(v, path);
  const out: Record<string, T> = {};
  const keys = Object.keys(o);
  if (keys.length > 5000) fail(path, 'has too many entries');
  for (const k of keys) {
    if (isUnsafeKey(k)) fail(path, `has the key ${k}`);
    out[k] = read(o[k], `${path}.${k}`, k);
  }
  return out;
}

function customPreset(v: unknown, path: string): StudioPreset {
  const o = obj(v, path);
  const key = str(o.key, `${path}.key`, 100);
  if (!isLibraryKey(key)) fail(`${path}.key`, 'is not a library key');
  const label = obj(o.label, `${path}.label`);
  return { key, label: { en: str(label.en, `${path}.label.en`), es: str(label.es, `${path}.label.es`) }, ...productTypePayload(o, path) };
}

function customSetup(v: unknown, path: string): CustomSetup {
  const o = obj(v, path);
  const key = str(o.key, `${path}.key`, 100);
  if (!isLibraryKey(key)) fail(`${path}.key`, 'is not a library key');
  return { key, name: str(o.name, `${path}.name`), world: oneOf(o.world, `${path}.world`, WORLDS), lights: lightSpecs(o.lights, `${path}.lights`, 1) };
}

function studioPayload(v: unknown, path: string): StudioPayload {
  const o = obj(v, path);
  const out: StudioPayload = {
    preset: str(o.preset, `${path}.preset`, 100),
    lightSetup: str(o.lightSetup, `${path}.lightSetup`, 100),
    lights: arr(o.lights, `${path}.lights`, 0, 32).map((x, i) => lightInstance(x, `${path}.lights[${i}]`)),
    modified: bool(o.modified, `${path}.modified`),
    floor: bool(o.floor, `${path}.floor`),
    shadow: bool(o.shadow, `${path}.shadow`),
    environment: environment(o.environment, `${path}.environment`),
    image: image(o.image, `${path}.image`),
    camera: camera(o.camera, `${path}.camera`),
    assignments: record(o.assignments, `${path}.assignments`, (x, p) => {
      const a = obj(x, p);
      const r: StudioPayload['assignments'][string] = { material: a.material === null ? null : str(a.material, `${p}.material`, 64) };
      if (a.faceMaterials !== undefined) {
        r.faceMaterials = arr(a.faceMaterials, `${p}.faceMaterials`, 0, 100000).map((f, i) => {
          const fo = obj(f, `${p}.faceMaterials[${i}]`);
          return { start: num(fo.start, `${p}.faceMaterials[${i}].start`, 0), count: num(fo.count, `${p}.faceMaterials[${i}].count`, 0), material: str(fo.material, `${p}.faceMaterials[${i}].material`, 64) };
        });
      }
      return r;
    }),
    instances: record(o.instances, `${path}.instances`, (x, p, key) => materialInstance(x, p, key)),
    visibility: record(o.visibility, `${path}.visibility`, (x, p) => bool(x, p)),
  };
  if (o.customPreset !== undefined) out.customPreset = o.customPreset === null ? null : customPreset(o.customPreset, `${path}.customPreset`);
  if (o.customSetup !== undefined) out.customSetup = o.customSetup === null ? null : customSetup(o.customSetup, `${path}.customSetup`);
  return out;
}

/** A picture the interface may show: a small data URL of an image. Anything else is dropped. */
function thumb(v: unknown): string | undefined {
  if (typeof v !== 'string' || v.length > THUMB_MAX) return undefined;
  return /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(v) ? v : undefined;
}

/**
 * One item of a file, rebuilt from the fields it is known to have. Throws `Invalid` with the reason. The
 * name is not made unique here (adding does that).
 */
export function validateItem(v: unknown, path = 'item'): LibraryItem {
  const o = obj(v, path);
  const kind = oneOf(o.kind, `${path}.kind`, LIBRARY_KINDS);
  const id = str(o.id, `${path}.id`, 100);
  if (id.trim() === '') fail(`${path}.id`, 'is empty');
  const name = str(o.name, `${path}.name`, 200).replace(/\s+/g, ' ').trim();
  if (name === '') fail(`${path}.name`, 'is empty');
  const b: ItemBase = {
    id,
    name,
    createdAt: o.createdAt === undefined ? Date.now() : num(o.createdAt, `${path}.createdAt`, 0, 1e15),
  };
  const th = thumb(o.thumb);
  if (th) b.thumb = th;
  if (o.source !== undefined && o.source !== null) b.source = str(o.source, `${path}.source`, 100);
  switch (kind) {
    case 'material':
      return { ...b, kind, material: materialPayload(o.material, `${path}.material`) };
    case 'lightSetup':
      return { ...b, kind, world: oneOf(o.world, `${path}.world`, WORLDS), lights: lightSpecs(o.lights, `${path}.lights`, 1) };
    case 'productType':
      return { ...b, kind, preset: productTypePayload(o.preset, `${path}.preset`) };
    case 'studio':
      return { ...b, kind, studio: studioPayload(o.studio, `${path}.studio`) };
  }
}

// --- Import -------------------------------------------------------------------------------

/** Steps an older envelope up to the current schema, one version at a time. None exist yet: schema 1 is the first. */
const MIGRATIONS: Readonly<Record<number, (file: Rec) => Rec>> = {};

function readEnvelope(json: string): { items: unknown[] } | { error: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { error: 'the file is not JSON' };
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { error: 'the file is not a library' };
  let file = raw as Rec;
  if (file.format !== LIBRARY_FORMAT) return { error: `the file is not a ${LIBRARY_FORMAT} file` };
  let schema = file.schema;
  if (typeof schema !== 'number' || !Number.isInteger(schema) || schema < 1) return { error: 'the file has no valid schema version' };
  if (schema > LIBRARY_SCHEMA) return { error: `the file is schema ${schema}, this version reads up to ${LIBRARY_SCHEMA}` };
  while (schema < LIBRARY_SCHEMA) {
    const step = MIGRATIONS[schema];
    if (!step) return { error: `no migration from schema ${schema}` };
    file = step(file);
    schema++;
  }
  if (!Array.isArray(file.items)) return { error: 'the file has no list of items' };
  if (file.items.length > MAX_ITEMS) return { error: `the file has ${file.items.length} items (at most ${MAX_ITEMS})` };
  return { items: file.items };
}

/**
 * Merges the library in `json` into `lib`. An item whose id is already there is skipped (it is the same item);
 * one whose name is already taken by another gets a suffix ("Gold 2"); an invalid item is skipped with its
 * reason and the rest go on. The given library is not modified.
 */
export function importLibrary(json: string, lib: Library): ImportResult {
  const env = readEnvelope(json);
  if ('error' in env) return { lib, added: 0, skipped: [{ index: -1, name: '', code: 'file', reason: env.error }], error: env.error };
  let next = lib;
  let added = 0;
  const skipped: SkippedItem[] = [];
  env.items.forEach((raw, index) => {
    let item: LibraryItem;
    try {
      item = validateItem(raw, `items[${index}]`);
    } catch (err) {
      if (!(err instanceof Invalid)) throw err;
      const name = typeof (raw as Rec | null)?.name === 'string' ? String((raw as Rec).name) : '';
      skipped.push({ index, name, code: 'invalid', reason: err.message });
      return;
    }
    if (allItems(next).some((i) => i.id === item.id)) {
      skipped.push({ index, name: item.name, code: 'duplicate', reason: `an item with the id ${item.id} is already in the library` });
      return;
    }
    const before = itemsOf(next, item.kind).length;
    next = addItem(next, item);
    if (itemsOf(next, item.kind).length > before) added++;
  });
  return { lib: next, added, skipped };
}

// --- Browser storage ----------------------------------------------------------------------

/** The part of `Storage` the library uses, so a test can pass a plain object. */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function browserStorage(): KeyValueStorage | null {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}

export type LoadStatus = 'ok' | 'empty' | 'unavailable' | 'corrupt';

export interface LoadResult {
  lib: Library;
  status: LoadStatus;
  /** Items that did not pass validation and are gone from the library (their raw text is kept apart). */
  skipped: SkippedItem[];
}

/** Reads the library from the storage. Never throws: a missing, blocked or damaged entry gives an empty library. */
export function loadLibrary(storage: KeyValueStorage | null = browserStorage()): LoadResult {
  if (!storage) return { lib: emptyLibrary(), status: 'unavailable', skipped: [] };
  let raw: string | null;
  try {
    raw = storage.getItem(LIBRARY_STORAGE_KEY);
  } catch {
    return { lib: emptyLibrary(), status: 'unavailable', skipped: [] };
  }
  if (raw === null) return { lib: emptyLibrary(), status: 'empty', skipped: [] };
  const r = importLibrary(raw, emptyLibrary());
  if (r.error || r.skipped.length > 0) {
    // Keep what could not be read: the next save would overwrite it.
    try {
      storage.setItem(`${LIBRARY_STORAGE_KEY}.corrupt`, raw);
    } catch {
      // No room for the backup: nothing else to do.
    }
  }
  return { lib: r.lib, status: r.error ? 'corrupt' : 'ok', skipped: r.skipped };
}

export type SaveStatus = 'ok' | 'no-thumbs' | 'failed';

function withoutThumbs(lib: Library): Library {
  let out = emptyLibrary();
  for (const item of allItems(lib)) {
    const { thumb: _thumb, ...rest } = item;
    out = { ...out, [COLLECTION[item.kind]]: [...(out[COLLECTION[item.kind]] as LibraryItem[]), rest] };
  }
  return out;
}

/**
 * Writes the library under its one key. When the storage is full the thumbnails are left out and it tries
 * again (`no-thumbs`: the pictures are rendered again when they are needed); `failed` when even that does not fit.
 */
export function saveLibrary(lib: Library, storage: KeyValueStorage | null = browserStorage()): SaveStatus {
  if (!storage) return 'failed';
  try {
    storage.setItem(LIBRARY_STORAGE_KEY, exportLibrary(lib));
    return 'ok';
  } catch {
    // Quota or a blocked storage: try without the pictures.
  }
  try {
    storage.setItem(LIBRARY_STORAGE_KEY, exportLibrary(withoutThumbs(lib)));
    return 'no-thumbs';
  } catch {
    return 'failed';
  }
}
