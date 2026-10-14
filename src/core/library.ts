// The user's own library (U4, SPEC §3.9): materials, light setups, product types and studios the person
// made and wants to reuse between projects. It is user state like the theme, not project state: it is not in
// `ProjectState`, has no undo and is not saved in `.repack.json` (persistence and the JSON file are
// `io/library.ts`; the interface holds the current value in its own state). This module is pure functions on
// plain data: add, rename, remove, make an item from what is on screen, and turn an item back into what the
// project understands.

import { lightSetup } from '../data/light-setups';
import type { LightSpec, MaterialCategory, MaterialFamily, MaterialParams, ResolvedLight, StudioPreset, WearProps, WorldKind } from '../data/types';
import { WEAR_PROP_DEFAULTS } from '../data/wear';
import { activeCamera } from './camera';
import { isLibraryKey, libraryKey, presetRefOf, snapshotStudio, type CustomSetup, type LightInstance, type SavedStudio } from './lighting';
import { cloneInstance, defaultTextures, type MaterialInstance, type MaterialTextures } from './materials';
import { resolvePreset, rigFromRecipe, type PresetRef } from './rig';
import type { ProjectState } from './store';

/** Name of the JSON envelope, shared by the file and the browser storage. */
export const LIBRARY_FORMAT = 'repackshot-library';
/** Schema version of that envelope; `io/library.ts` migrates older ones. */
export const LIBRARY_SCHEMA = 1;

export type LibraryKind = 'material' | 'lightSetup' | 'productType' | 'studio';
export const LIBRARY_KINDS: readonly LibraryKind[] = ['material', 'lightSetup', 'productType', 'studio'];

/** Fields every item has. */
export interface ItemBase {
  id: string;
  /** Unique among the items of its kind. */
  name: string;
  /** Milliseconds since the epoch. */
  createdAt: number;
  /** Small picture as a data URL (a rendered sphere or a capture of the viewport). */
  thumb?: string;
  /** The factory (catalogue) key it was derived from, when there is one. */
  source?: string;
}

/** What a material instance is, without its identity in a project. */
export interface MaterialPayload {
  family: MaterialFamily;
  category: MaterialCategory;
  params: MaterialParams;
  wear: WearProps;
  textures: MaterialTextures;
  bevelRadiusMm: number;
}

/** A product type is a studio preset: everything but the key and the label, which the item provides. */
export type ProductTypePayload = Omit<StudioPreset, 'key' | 'label'>;

/** A studio is a saved studio of a project without its id and name. */
export type StudioPayload = Omit<SavedStudio, 'id' | 'name'>;

export interface MaterialItem extends ItemBase {
  kind: 'material';
  material: MaterialPayload;
}

export interface LightSetupItem extends ItemBase {
  kind: 'lightSetup';
  world: WorldKind;
  /** Camera-relative, `share` normalised to 1: applicable to any product type. */
  lights: LightSpec[];
}

export interface ProductTypeItem extends ItemBase {
  kind: 'productType';
  preset: ProductTypePayload;
}

export interface StudioItem extends ItemBase {
  kind: 'studio';
  studio: StudioPayload;
}

export type LibraryItem = MaterialItem | LightSetupItem | ProductTypeItem | StudioItem;

/** The four collections, in insertion order. */
export interface Library {
  materials: MaterialItem[];
  lightSetups: LightSetupItem[];
  productTypes: ProductTypeItem[];
  studios: StudioItem[];
}

/** An item of an imported file that was not added. */
export interface SkippedItem {
  /** Position in the file's `items`; -1 for the file as a whole. */
  index: number;
  /** The item's name when it had one. */
  name: string;
  /** `duplicate`: the id is already in the library. `invalid`: the item failed validation. `file`: the file is not a library. */
  code: 'duplicate' | 'invalid' | 'file';
  /** What was wrong, in English, for the person who made the file. */
  reason: string;
}

/** What importing a library file did. */
export interface ImportResult {
  lib: Library;
  added: number;
  skipped: SkippedItem[];
  /** The file as a whole was refused (not JSON, not a library, from a newer version): nothing was added. */
  error?: string;
}

export type ItemOf<K extends LibraryKind> = Extract<LibraryItem, { kind: K }>;

export const COLLECTION: Readonly<{ [K in LibraryKind]: keyof Library }> = {
  material: 'materials',
  lightSetup: 'lightSetups',
  productType: 'productTypes',
  studio: 'studios',
};

export function emptyLibrary(): Library {
  return { materials: [], lightSetups: [], productTypes: [], studios: [] };
}

export function libraryIsEmpty(lib: Library): boolean {
  return LIBRARY_KINDS.every((k) => lib[COLLECTION[k]].length === 0);
}

/** The items of one kind. */
export function itemsOf<K extends LibraryKind>(lib: Library, kind: K): ItemOf<K>[] {
  return lib[COLLECTION[kind]] as unknown as ItemOf<K>[];
}

/** Every item, kind by kind. */
export function allItems(lib: Library): LibraryItem[] {
  return LIBRARY_KINDS.flatMap((k) => itemsOf(lib, k) as LibraryItem[]);
}

export function findItem<K extends LibraryKind>(lib: Library, kind: K, id: string): ItemOf<K> | undefined {
  return itemsOf(lib, kind).find((i) => i.id === id);
}

function withItems<K extends LibraryKind>(lib: Library, kind: K, items: ItemOf<K>[]): Library {
  return { ...lib, [COLLECTION[kind]]: items };
}

// --- Ids and names ----------------------------------------------------------------

const ID_PREFIX: Readonly<Record<LibraryKind, string>> = { material: 'mat', lightSetup: 'set', productType: 'typ', studio: 'std' };

/**
 * A fresh id for an item: kind prefix, time and a random tail, so two libraries made on two machines do not
 * collide when one is imported into the other. `entropy` is injectable for tests.
 */
export function newItemId(kind: LibraryKind, lib: Library, now: number = Date.now(), entropy: () => number = Math.random): string {
  const taken = new Set(allItems(lib).map((i) => i.id));
  for (;;) {
    const id = `${ID_PREFIX[kind]}-${Math.floor(now).toString(36)}${Math.floor(entropy() * 36 ** 4)
      .toString(36)
      .padStart(4, '0')}`;
    if (!taken.has(id)) return id;
    now += 1;
  }
}

const nameKey = (name: string): string => name.trim().toLowerCase();

/**
 * `name` if no one in `taken` has it (case aside), otherwise "name 2", "name 3"... A trailing number of the
 * name itself is replaced, so a copy of "Gold 2" is "Gold 3" and not "Gold 2 2".
 */
export function uniqueName(name: string, taken: Iterable<string>): string {
  const used = new Set([...taken].map(nameKey));
  const base = name.trim();
  if (!used.has(nameKey(base))) return base;
  const stem = base.replace(/\s+\d+$/, '') || base;
  for (let n = 2; ; n++) {
    const candidate = `${stem} ${n}`;
    if (!used.has(nameKey(candidate))) return candidate;
  }
}

/** The longest name the interface accepts for an item. */
export const NAME_MAX = 80;

/** A name the person typed, trimmed and bounded; '' when there is nothing usable. */
export function cleanName(name: string): string {
  return name.replace(/\s+/g, ' ').trim().slice(0, NAME_MAX).trim();
}

// --- Add, rename, remove ------------------------------------------------------------

/**
 * Adds an item. Its name is made unique among the items of its kind, and a clashing id gets a fresh one (the
 * library never holds two items with one id). An item without a usable name is not added.
 */
export function addItem(lib: Library, item: LibraryItem): Library {
  const name = cleanName(item.name);
  if (!name) return lib;
  const same = itemsOf(lib, item.kind) as LibraryItem[];
  const id = allItems(lib).some((i) => i.id === item.id) ? newItemId(item.kind, lib, item.createdAt) : item.id;
  const next = { ...item, id, name: uniqueName(name, same.map((i) => i.name)) } as LibraryItem;
  return withItems(lib, item.kind, [...same, next] as never);
}

/** Renames an item; the name stays unique among the others of its kind. Unknown id or empty name: unchanged. */
export function renameItem(lib: Library, kind: LibraryKind, id: string, name: string): Library {
  const clean = cleanName(name);
  const list = itemsOf(lib, kind) as LibraryItem[];
  const cur = list.find((i) => i.id === id);
  if (!cur || !clean) return lib;
  const unique = uniqueName(clean, list.filter((i) => i.id !== id).map((i) => i.name));
  if (unique === cur.name) return lib;
  return withItems(lib, kind, list.map((i) => (i.id === id ? { ...i, name: unique } : i)) as never);
}

/** Removes an item. Whatever of the project came from it stays as it is (nothing in the project depends on the library). */
export function removeItem(lib: Library, kind: LibraryKind, id: string): Library {
  const list = itemsOf(lib, kind) as LibraryItem[];
  if (!list.some((i) => i.id === id)) return lib;
  return withItems(lib, kind, list.filter((i) => i.id !== id) as never);
}

// --- Making items from what is on screen ----------------------------------------------

/** What every `from*` function can be told. */
export interface MakeOptions {
  thumb?: string;
  now?: number;
  /** Fixed id (tests); otherwise a fresh one. */
  id?: string;
}

function base(kind: LibraryKind, lib: Library, name: string, source: string | undefined, o: MakeOptions): ItemBase {
  const now = o.now ?? Date.now();
  const b: ItemBase = { id: o.id ?? newItemId(kind, lib, now), name: cleanName(name), createdAt: now };
  if (o.thumb) b.thumb = o.thumb;
  if (source) b.source = source;
  return b;
}

/** The material of an instance as the library keeps it: the edited parameters, not the preset it started from. */
export function fromMaterialInstance(lib: Library, inst: MaterialInstance, name: string, o: MakeOptions = {}): MaterialItem {
  const copy = cloneInstance(inst, 'x');
  return {
    ...base('material', lib, name, inst.preset ?? inst.origin ?? undefined, o),
    kind: 'material',
    // Image maps are not carried: they name files of the project (phase M2 decides how they travel).
    material: {
      family: copy.family,
      category: copy.category,
      params: copy.params,
      wear: copy.wear,
      textures: { ...copy.textures, color: null, roughness: null, metal: null, normal: null, alpha: null },
      bevelRadiusMm: copy.bevelRadiusMm,
    },
  };
}

/** A library material as an instance (with a placeholder id) ready to be assigned. */
export function instanceFromItem(item: MaterialItem): MaterialInstance {
  const m = item.material;
  const inst: MaterialInstance = {
    id: '',
    name: item.name,
    preset: null,
    origin: item.source ?? null,
    edited: false,
    library: item.id,
    family: m.family,
    category: m.category,
    params: m.params,
    wear: { ...WEAR_PROP_DEFAULTS, ...m.wear },
    textures: { ...defaultTextures(), ...m.textures },
    bevelRadiusMm: m.bevelRadiusMm,
  };
  return cloneInstance(inst, '');
}

/** The lights that count in a rig: the ones switched on. */
function enabledLights(lights: readonly LightInstance[]): LightInstance[] {
  return lights.filter((l) => l.enabled);
}

/** One light of the rig as a recipe light (no `share` or `energy` yet). */
function specOf(l: LightInstance): LightSpec {
  const spec: LightSpec = {
    role: l.role,
    type: l.type,
    shape: l.shape,
    size: l.size,
    sizeY: l.sizeY,
    az: l.az,
    el: l.el,
    dist: l.dist,
    spread: l.spread,
    angle: l.angle,
    glossy: l.glossy,
    camera: l.camera,
  };
  if (l.kelvin !== null) spec.kelvin = l.kelvin;
  else spec.color = [l.color[0], l.color[1], l.color[2]];
  // An own light's soft edge, shadow, aim and roll (L4) travel with the setup; a setup light leaves them out.
  if (l.blend !== undefined) spec.blend = l.blend;
  if (l.shadow === false) spec.shadow = false;
  if (l.aim) spec.aim = [l.aim[0], l.aim[1], l.aim[2]];
  if (l.roll) spec.roll = l.roll;
  return spec;
}

/** The world a setup asks for: what the scene has, except a loaded HDRI, which is the person's and not the setup's. */
function worldOf(state: ProjectState): WorldKind {
  const k = state.environment.kind;
  return k === 'HDRI' ? 'STUDIO' : k;
}

/**
 * The current rig as a light setup: lights camera-relative as they already are, `share` the weight of each
 * (its power over the total, so the shares sum to 1). The level is not part of a setup: applying it to a
 * product type scales it to that type's irradiance (`applyLibrarySetup`). Null when no light is on.
 */
export function fromCurrentRig(state: ProjectState, lib: Library, name: string, o: MakeOptions = {}): LightSetupItem | null {
  const on = enabledLights(state.studio.lights);
  if (on.length === 0) return null;
  const total = on.reduce((a, l) => a + Math.max(0, l.power), 0);
  const lights = on.map((l) => ({ ...specOf(l), share: total > 0 ? Math.max(0, l.power) / total : 1 / on.length }));
  const key = state.studio.lightSetup;
  const source = key !== 'PRESET' && lightSetup(key) ? key : undefined;
  return { ...base('lightSetup', lib, name, source, o), kind: 'lightSetup', world: worldOf(state), lights };
}

/** A recipe of the library as the definition the project keeps (`studio/applySetup`). */
export function customSetupOf(item: LightSetupItem): CustomSetup {
  return { key: libraryKey(item.id), name: item.name, world: item.world, lights: item.lights.map((l) => ({ ...l })) };
}

/**
 * The rig a library setup gives on a product type: its recipe with the energy scaled so the total irradiance
 * is the one of the product type (`presetIrradiance`), exactly as for a catalogue setup (ARCHITECTURE §3).
 */
export function applyLibrarySetup(preset: PresetRef, item: LightSetupItem): ResolvedLight[] {
  return rigFromRecipe(preset, item.lights);
}

/**
 * The studio on screen as a product type: size of the part, optics, exposure, background, floor, shadow,
 * quality and the rig, each light with its own `energy` in watts (a product type carries the level).
 */
export function fromCurrentProductType(state: ProjectState, lib: Library, name: string, o: MakeOptions = {}): ProductTypeItem {
  const cam = activeCamera(state);
  const current = resolvePreset(presetRefOf(state.studio));
  const lights = enabledLights(state.studio.lights).map((l) => ({ ...specOf(l), energy: l.power }));
  const quality = state.render.quality === 'CUSTOM' ? (current?.quality ?? 'PREVIEW') : state.render.quality;
  const key = state.studio.preset;
  const bg = state.environment.color;
  return {
    ...base('productType', lib, name, isLibraryKey(key) ? undefined : key, o),
    kind: 'productType',
    preset: {
      sizeMm: state.scene.partSizeMm,
      focalMm: cam.focalMm,
      fstop: cam.fstop,
      envStrength: state.environment.strength,
      exposure: state.image.exposureEv,
      // A gradient (L6) is not a product type's background: its colour (the bottom of the gradient) is.
      background: state.environment.background === 'COLOR' || state.environment.background === 'GRADIENT' ? 'FLAT' : 'HDRI',
      backgroundColor: [bg[0], bg[1], bg[2], bg[3]],
      floor: state.studio.floor,
      shadow: state.studio.shadow,
      caustics: current?.caustics ?? false,
      quality,
      lights,
    },
  };
}

/** A product type of the library as the preset the project keeps (`studio/setPreset` with `custom`). */
export function presetOfItem(item: ProductTypeItem): StudioPreset {
  const p = item.preset;
  return { ...p, key: libraryKey(item.id), label: { en: item.name, es: item.name }, backgroundColor: [...p.backgroundColor], lights: p.lights.map((l) => ({ ...l })) };
}

/** The studio of the project as a library item: camera, rig, environment, image, materials per part, visibility. */
export function fromCurrentStudio(state: ProjectState, lib: Library, name: string, o: MakeOptions = {}): StudioItem {
  const b = base('studio', lib, name, undefined, o);
  const { id: _id, name: _name, ...studio } = snapshotStudio(state, b.id, b.name);
  return { ...b, kind: 'studio', studio };
}

/** A library studio as the saved studio `studio/restore` brings back. */
export function savedStudioOf(item: StudioItem): SavedStudio {
  return { ...item.studio, id: item.id, name: item.name };
}

/** Studios saved inside a project (before the library existed) moved to the library; the others are untouched. */
export function migrateSavedStudios(lib: Library, saved: readonly SavedStudio[], o: { now?: number } = {}): Library {
  let next = lib;
  for (const st of saved) {
    const { id: _id, name, ...studio } = st;
    const now = o.now ?? Date.now();
    next = addItem(next, { id: newItemId('studio', next, now), name, createdAt: now, kind: 'studio', studio });
  }
  return next;
}
