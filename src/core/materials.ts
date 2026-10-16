// Material instances, assignment by selection level with the overwrite
// inventory, parameters per family and the wear state (SPEC §3.3, UI §4.1).

import { MATERIAL_PRESETS, materialPreset } from '../data/materials';
import { WEAR_FAMILY_TYPES, wearPreset } from '../data/wear';
import type { MaterialCategory, MaterialFamily, MaterialParams, WearProps, WearType } from '../data/types';
import { WEAR_PROP_DEFAULTS } from '../data/wear';
import type { ActionBase, ProjectState } from './store';
import { nextId } from './ids';
import { ancestors, partsUnder, type FaceRange, type NodeId, type SceneNode } from './scene';
import { wearDefaults } from './wear';
import { cloneTextures, defaultTextures, type MaterialTextures } from './textures';
import { cloneGraph, type MaterialGraph } from './material-graph';

export { defaultTextures } from './textures';

export type MaterialId = string;

/** Image textures of a material (phase M2a): core/textures.ts. */
export type { MaterialTextures } from './textures';

/** A material used in the scene; the catalogue preset is only its origin (SPEC §3.3). */
export interface MaterialInstance {
  id: MaterialId;
  /** User name. null shows the catalogue label of `origin`, plus "(edited)" when edited. */
  name: string | null;
  /** Catalogue key it is still linked to, or null once it is the user's own material. */
  preset: string | null;
  /** Catalogue key it was created from, kept after detaching (null for imported materials). */
  origin: string | null;
  /** Edited away from its preset. */
  edited: boolean;
  /**
   * Id of the library item (U4) it was assigned from, while it is unedited; absent otherwise. It lets the
   * library mark the active material and lets two parts that took the same item share one instance. Deleting
   * the item clears it (`material/unlinkLibrary`): the instance keeps working as the user's own.
   */
  library?: string | null;
  family: MaterialFamily;
  category: MaterialCategory;
  params: MaterialParams;
  wear: WearProps;
  textures: MaterialTextures;
  /**
   * The material as a graph of nodes (phase M3a, core/material-graph.ts): present in Nodes mode, absent in Simple
   * mode. While it is present the graph is the material; `family` and `params` keep the Simple values.
   */
  graph?: MaterialGraph;
  /** Rounded-edge radius in millimetres (0 = no bevel). */
  bevelRadiusMm: number;
  /** 'DEFAULT': the neutral material a part gets when it comes without one. */
  role?: 'DEFAULT';
}

/** Preset of the neutral default material. */
export const DEFAULT_MATERIAL_PRESET = 'WHITE_STUDIO';

/** The neutral material of a part imported without one (shown as "Default"). */
export function defaultInstance(id: MaterialId, partSizeMm: number): MaterialInstance {
  return { ...instanceFromPreset(id, DEFAULT_MATERIAL_PRESET, partSizeMm)!, role: 'DEFAULT' };
}

/** A real choice of material (not missing, not the neutral default). */
function isChosen(mat: MaterialInstance | undefined): boolean {
  return mat !== undefined && mat.role !== 'DEFAULT';
}

/** How an assignment treats parts that already carry a material. */
export type AssignMode = 'REPLACE' | 'KEEP';

/** Description of one editable parameter of a family. */
export interface ParamSpec {
  key: string;
  kind: 'color' | 'number' | 'select';
  min?: number;
  max?: number;
  step?: number;
  /** Unit shown next to the value: '', 'K', 'W'... */
  unit?: string;
  options?: readonly string[];
  /** Value used when the instance does not carry the parameter. */
  fallback: unknown;
  /** The U1 preview draws it (otherwise it is stored and drawn by a later engine). */
  preview: boolean;
  /** The engine draws it (Full mode and renders) though the Fast preview does not (E6: the wood's rings). */
  engine?: boolean;
  /** Only shown when another parameter has a given value. */
  when?: { key: string; value: unknown };
  /**
   * Shown always, but only editable when another parameter (or its fallback) has one of these values; otherwise
   * disabled with the note `note` (E6: the knots of the woods without rings).
   */
  enabledWhen?: { key: string; values: readonly unknown[]; fallback: unknown; note: string };
  /** String key of the help shown on the row (`src/ui/strings.ts`). */
  tip?: string;
}

const unit = (min: number, max: number, step = 0.01) => ({ min, max, step });

/** The knots' knobs work on the woods with rings only. */
const KNOTTY = { key: 'woodFigure', values: ['RINGS'], fallback: 'RINGS', note: 'material.noKnots' } as const;

/** True when the inspector lets `spec` be edited on `inst` (`ParamSpec.enabledWhen`). */
export function paramEnabled(inst: MaterialInstance, spec: ParamSpec): boolean {
  const e = spec.enabledWhen;
  return !e || e.values.includes(inst.params[e.key] ?? e.fallback);
}

/** Parameters of each family, in the order the inspector shows them. */
export const FAMILY_PARAMS: Readonly<Record<MaterialFamily, readonly ParamSpec[]>> = {
  SIMPLE: [
    { key: 'baseColor', kind: 'color', fallback: [0.8, 0.8, 0.8, 1], preview: true },
    { key: 'metallic', kind: 'number', ...unit(0, 1), fallback: 0, preview: true },
    { key: 'roughness', kind: 'number', ...unit(0, 1), fallback: 0.5, preview: true },
    { key: 'coat', kind: 'number', ...unit(0, 1), fallback: 0, preview: true },
    { key: 'coatRoughness', kind: 'number', ...unit(0, 1), fallback: 0.03, preview: true },
    { key: 'ior', kind: 'number', ...unit(1, 2.5), fallback: 1.5, preview: true },
    { key: 'transmission', kind: 'number', ...unit(0, 1), fallback: 0, preview: true },
    { key: 'opacity', kind: 'number', ...unit(0, 1), fallback: 1, preview: true },
    { key: 'anisotropic', kind: 'number', ...unit(0, 1), fallback: 0, preview: true },
    { key: 'subsurface', kind: 'number', ...unit(0, 1), fallback: 0, preview: false },
  ],
  GLASS: [
    { key: 'baseColor', kind: 'color', fallback: [1, 1, 1, 1], preview: true },
    { key: 'roughness', kind: 'number', ...unit(0, 1), fallback: 0, preview: true },
    { key: 'ior', kind: 'number', ...unit(1, 2.5), fallback: 1.52, preview: true },
    { key: 'transmission', kind: 'number', ...unit(0, 1), fallback: 1, preview: true },
    // E5: the colour is what white light keeps after this many millimetres inside (Beer–Lambert); 0 tints the
    // surface instead, once per pass through the part.
    { key: 'absorptionMm', kind: 'number', min: 0, max: 5000, step: 1, unit: 'mm', fallback: 50, preview: true },
    // E5: a thin wall (a sheet, a bulb, a visor modelled as one surface) lets light straight through.
    { key: 'walls', kind: 'select', options: ['SOLID', 'THIN'], fallback: 'SOLID', preview: true },
    // E9: a scattering medium inside the solid (translucent plastics, wax, soap, milk, juice): the mean free path
    // (0: none), what each bounce keeps of each colour, and where light goes at each bounce (Henyey–Greenstein g).
    { key: 'scatterMm', kind: 'number', min: 0, max: 1000, step: 0.05, unit: 'mm', fallback: 0, preview: true, tip: 'param.scatterMm.tip' },
    { key: 'scatterColor', kind: 'color', fallback: [1, 1, 1, 1], preview: true, tip: 'param.scatterColor.tip' },
    { key: 'scatterG', kind: 'number', min: -0.9, max: 0.9, step: 0.05, fallback: 0, preview: true, tip: 'param.scatterG.tip' },
    // E9c: chromatic dispersion of solid glass, its Abbe number (0: none; 30–70 typical).
    { key: 'abbe', kind: 'number', min: 0, max: 100, step: 1, fallback: 0, preview: true, tip: 'param.abbe.tip' },
  ],
  WOOD: [
    { key: 'woodColor1', kind: 'color', fallback: [0.56, 0.38, 0.21, 1], preview: true },
    { key: 'woodColor2', kind: 'color', fallback: [0.3, 0.18, 0.09, 1], preview: true },
    { key: 'roughness', kind: 'number', ...unit(0, 1), fallback: 0.45, preview: true },
    // E6: rings per 100 mm (physical, the same on a ring box and on a table), times the scale.
    { key: 'ringDensity', kind: 'number', ...unit(1, 60, 1), fallback: 33, preview: false, engine: true },
    { key: 'woodScale', kind: 'number', ...unit(0.1, 10, 0.05), fallback: 1, preview: false, engine: true },
    { key: 'ringContrast', kind: 'number', ...unit(0, 1), fallback: 0.3, preview: false, engine: true },
    { key: 'ringVariation', kind: 'number', ...unit(0, 1), fallback: 0.4, preview: false, engine: true },
    { key: 'ringNoise', kind: 'number', ...unit(0, 1), fallback: 0.3, preview: false, engine: true },
    { key: 'axialNoise', kind: 'number', ...unit(0, 1), fallback: 0.2, preview: false, engine: true },
    { key: 'colorNoise', kind: 'number', ...unit(0, 1), fallback: 0.2, preview: false, engine: true },
    { key: 'poreDepth', kind: 'number', ...unit(0, 1), fallback: 0.3, preview: false, engine: true },
    // E6: knots (bamboo, fibreboard and ebony have none). The Fast preview shows where they are.
    { key: 'knotCount', kind: 'number', min: 0, max: 12, step: 1, fallback: 0, preview: true, enabledWhen: KNOTTY },
    { key: 'knotSize', kind: 'number', min: 5, max: 40, step: 0.5, unit: 'mm', fallback: 15, preview: true, enabledWhen: KNOTTY },
    { key: 'knotSizeVar', kind: 'number', ...unit(0, 1), fallback: 0.3, preview: true, enabledWhen: KNOTTY },
    { key: 'knotDarkness', kind: 'number', ...unit(0, 1), fallback: 0.6, preview: true, enabledWhen: KNOTTY },
  ],
  FABRIC: [
    { key: 'threadColor1', kind: 'color', fallback: [0.7, 0.7, 0.68, 1], preview: true },
    { key: 'threadColor2', kind: 'color', fallback: [0.6, 0.6, 0.58, 1], preview: true },
    // E6: the engine weaves them (Full mode and renders); the Fast preview shows the mean colour.
    { key: 'weave', kind: 'select', options: ['PLAIN', 'TWILL', 'TWILL31', 'SATIN', 'CANVAS', 'KNIT', 'FELT'], fallback: 'PLAIN', preview: false, engine: true },
    // E6: threads per cm (physical: the same on a phone case and on a sofa).
    { key: 'threadCount', kind: 'number', min: 2, max: 200, step: 1, unit: '/cm', fallback: 40, preview: false, engine: true },
    { key: 'weaveDepth', kind: 'number', ...unit(0, 1), fallback: 0.35, preview: false, engine: true },
    { key: 'roughness', kind: 'number', ...unit(0, 1), fallback: 0.75, preview: true },
    { key: 'fuzz', kind: 'number', ...unit(0, 1), fallback: 0.3, preview: true },
    { key: 'fuzzRoughness', kind: 'number', ...unit(0, 1), fallback: 0.4, preview: false },
  ],
  EMISSIVE: [
    { key: 'emitKind', kind: 'select', options: ['BLACKBODY', 'COLOR'], fallback: 'BLACKBODY', preview: true },
    { key: 'temperature', kind: 'number', min: 1000, max: 12000, step: 50, unit: 'K', fallback: 5600, preview: true, when: { key: 'emitKind', value: 'BLACKBODY' } },
    { key: 'emitColor', kind: 'color', fallback: [1, 1, 1, 1], preview: true, when: { key: 'emitKind', value: 'COLOR' } },
    { key: 'emitPower', kind: 'number', min: 0, max: 500, step: 1, unit: 'W', fallback: 50, preview: true },
  ],
};

/**
 * The share of a fabric's face its warp (`threadColor1`) covers, by weave, as rt_core::pattern::cloth measures it:
 * a warp-faced satin and 3/1 twill show mostly warp, the rest half and half.
 */
export const WEAVE_WARP_SHARE: Readonly<Record<string, number>> = { SATIN: 0.72, TWILL31: 0.685 };

/** The mean colour of a fabric's weave (linear RGB): what the Fast preview shows and what the engine averages to. */
export function fabricMeanColor(p: MaterialParams): [number, number, number] {
  const rgb = (v: unknown, f: readonly number[]) => (Array.isArray(v) && v.length >= 3 ? (v as number[]) : f);
  const a = rgb(p.threadColor1, [0.7, 0.7, 0.68]);
  const b = rgb(p.threadColor2, [0.6, 0.6, 0.58]);
  const w = WEAVE_WARP_SHARE[String(p.weave ?? 'PLAIN')] ?? 0.5;
  return [a[0] * w + b[0] * (1 - w), a[1] * w + b[1] * (1 - w), a[2] * w + b[2] * (1 - w)];
}

/** Current value of a parameter, with the family fallback. */
export function paramValue(mat: MaterialInstance, spec: ParamSpec): unknown {
  const v = mat.params[spec.key];
  return v === undefined ? spec.fallback : v;
}

/** The parameters the inspector should draw for a material right now. */
export function visibleParams(mat: MaterialInstance): ParamSpec[] {
  return FAMILY_PARAMS[mat.family].filter((p) => !p.when || paramValue(mat, FAMILY_PARAMS[mat.family].find((q) => q.key === p.when!.key)!) === p.when.value);
}

/** Bevel a new instance gets: 0.25 % of the part size (Doctor bevel fix). */
export function defaultBevelMm(partSizeMm: number): number {
  return Math.round(partSizeMm * 0.0025 * 1000) / 1000;
}

/** A new instance from a catalogue preset. Unknown key gives null. */
export function instanceFromPreset(id: MaterialId, presetKey: string, partSizeMm: number): MaterialInstance | null {
  const preset = materialPreset(presetKey);
  if (!preset) return null;
  return {
    id,
    name: null,
    preset: preset.key,
    origin: preset.key,
    edited: false,
    family: preset.family,
    category: preset.category,
    params: structuredCloneParams(preset.params),
    wear: wearDefaults(preset.key, partSizeMm / 1000) ?? { ...WEAR_PROP_DEFAULTS },
    textures: defaultTextures(),
    bevelRadiusMm: preset.family === 'EMISSIVE' ? 0 : defaultBevelMm(partSizeMm),
  };
}

/** A plain user material (imported files): SIMPLE family, no preset. */
export function plainInstance(id: MaterialId, name: string, params: MaterialParams): MaterialInstance {
  return {
    id,
    name,
    preset: null,
    origin: null,
    edited: false,
    family: 'SIMPLE',
    category: 'OTHER',
    params: structuredCloneParams(params),
    wear: { ...WEAR_PROP_DEFAULTS },
    textures: defaultTextures(),
    bevelRadiusMm: 0,
  };
}

function structuredCloneParams(p: MaterialParams): MaterialParams {
  const out: MaterialParams = {};
  for (const [k, v] of Object.entries(p)) out[k] = Array.isArray(v) ? [...v] : v;
  return out;
}

/** Identity used to decide whether two parts carry "the same" material. */
export function materialIdentity(mat: MaterialInstance): string {
  if (mat.role === 'DEFAULT' && !mat.edited) return 'default';
  if (mat.library && !mat.edited) return `library:${mat.library}`;
  return mat.preset && !mat.edited ? `preset:${mat.preset}` : `instance:${mat.id}`;
}

/** Every material id a part uses (whole part and face ranges). */
export function partMaterials(node: SceneNode): MaterialId[] {
  const out: MaterialId[] = [];
  if (node.material) out.push(node.material);
  for (const f of node.faceMaterials ?? []) if (!out.includes(f.material)) out.push(f.material);
  return out;
}

/** One line of the overwrite inventory. */
export interface InventoryEntry {
  material: MaterialId;
  /** Parts that carry it. */
  parts: number;
}

export interface Inventory {
  entries: InventoryEntry[];
  /** Parts without any material. */
  unassigned: number;
  /** The target holds materials that differ among themselves: ask before overwriting. */
  needsConfirm: boolean;
}

/**
 * What the target parts hold before an assignment (UI §4.1). Instances of the
 * same unedited preset count as one material; the neutral default counts as
 * no material.
 */
export function materialInventory(state: ProjectState, parts: readonly NodeId[]): Inventory {
  const byIdentity = new Map<string, InventoryEntry>();
  let unassigned = 0;
  for (const p of parts) {
    const node = state.scene.nodes[p];
    if (!node || node.kind !== 'PART') continue;
    const mats = partMaterials(node).filter((m) => isChosen(state.materials[m]));
    if (mats.length === 0) unassigned++;
    const seenHere = new Set<string>();
    for (const m of mats) {
      const key = materialIdentity(state.materials[m]);
      if (seenHere.has(key)) continue;
      seenHere.add(key);
      const e = byIdentity.get(key);
      if (e) e.parts++;
      else byIdentity.set(key, { material: m, parts: 1 });
    }
  }
  const entries = [...byIdentity.values()];
  return { entries, unassigned, needsConfirm: entries.length >= 2 };
}

/** Parts an assignment reaches for the current selection; empty selection = every part. */
export function assignmentParts(state: ProjectState, ids?: readonly NodeId[]): NodeId[] {
  const sel = ids ?? state.selection.ids.filter((id) => state.scene.nodes[id]);
  if (sel.length === 0) return partsUnder(state, state.scene.roots);
  return partsUnder(state, sel);
}

/** Converts a set of triangle indices to sorted runs. */
export function indicesToRanges(indices: readonly number[]): { start: number; count: number }[] {
  const sorted = [...new Set(indices)].sort((a, b) => a - b);
  const out: { start: number; count: number }[] = [];
  for (const i of sorted) {
    const last = out[out.length - 1];
    if (last && last.start + last.count === i) last.count++;
    else out.push({ start: i, count: 1 });
  }
  return out;
}

/**
 * Per-triangle material of a part: index i gives the material of triangle i
 * (face ranges win over the part material).
 */
export function triangleMaterials(node: SceneNode): (MaterialId | null)[] {
  const n = node.mesh?.triangles ?? 0;
  const out = new Array<MaterialId | null>(n).fill(node.material ?? null);
  for (const f of node.faceMaterials ?? []) {
    for (let i = f.start; i < Math.min(n, f.start + f.count); i++) out[i] = f.material;
  }
  return out;
}

/** Writes face materials for some triangles, merging with the existing ranges. */
export function withFaceMaterial(node: SceneNode, indices: readonly number[], material: MaterialId): SceneNode {
  const per = triangleMaterials({ ...node, material: null });
  for (const i of indices) if (i >= 0 && i < per.length) per[i] = material;
  const ranges: FaceRange[] = [];
  for (let i = 0; i < per.length; i++) {
    const m = per[i];
    if (!m) continue;
    const last = ranges[ranges.length - 1];
    if (last && last.material === m && last.start + last.count === i) last.count++;
    else ranges.push({ start: i, count: 1, material: m });
  }
  return { ...node, faceMaterials: ranges };
}

/** Removes instances no part uses. */
export function pruneMaterials(state: ProjectState): ProjectState {
  const used = new Set<MaterialId>();
  for (const node of Object.values(state.scene.nodes)) for (const m of partMaterials(node)) used.add(m);
  const ids = Object.keys(state.materials);
  if (ids.every((id) => used.has(id))) return state;
  const materials: Record<MaterialId, MaterialInstance> = {};
  for (const id of ids) if (used.has(id)) materials[id] = state.materials[id];
  return { ...state, materials };
}

/** A material of the user's library offered to an assignment: the item's id and the instance it describes. */
export interface LibrarySource {
  id: string;
  /** What the item describes; its `id` is a placeholder, the reducer gives the new instance its own. */
  instance: MaterialInstance;
}

export type MaterialAction =
  | ({
      type: 'material/assign';
      /** Catalogue key to instance, or... */
      preset?: string;
      /** ...a material of the library to instance (reusing the unedited one the scene already has), or... */
      library?: LibrarySource;
      /** ...an existing instance to reuse. */
      material?: MaterialId;
      /** Nodes at any level; expanded to their parts. Ignored when `faces` is set. */
      targets: NodeId[];
      faces?: { part: NodeId; indices: number[] };
      mode: AssignMode;
      /**
       * A new instance for this assignment alone (a copy of what the source names, shared by the targets of this
       * one action but by no other part), instead of the instance the scene already has. Dropping with Alt.
       */
      copy?: boolean;
    } & ActionBase)
  | ({ type: 'material/setParam'; id: MaterialId; key: string; value: unknown } & ActionBase)
  | ({ type: 'material/set'; id: MaterialId; patch: Partial<Pick<MaterialInstance, 'name' | 'bevelRadiusMm'>> } & ActionBase)
  /** A library item was deleted: the instances that came from it stay, no longer linked to it. */
  | ({ type: 'material/unlinkLibrary'; library: string } & ActionBase)
  | ({ type: 'material/detach'; id: MaterialId; parts: NodeId[] } & ActionBase)
  | ({ type: 'material/setWear'; id: MaterialId; patch: Partial<WearProps> } & ActionBase)
  | ({ type: 'material/wearPreset'; id: MaterialId; key: string } & ActionBase)
  | ({ type: 'material/wearToModel'; id: MaterialId } & ActionBase)
  /** Unlink material: each of the parts gets its own copy of every instance it shares with another part. */
  | ({ type: 'material/unlink'; parts: NodeId[] } & ActionBase)
  /** Paste material: a new instance with the content of `instance` (the clipboard) for the parts of `targets`. */
  | ({ type: 'material/paste'; instance: MaterialInstance; targets: NodeId[] } & ActionBase);

/** Instance for a catalogue key: reuses an unedited one of the same preset. */
function ensureInstance(state: ProjectState, presetKey: string): { state: ProjectState; id: MaterialId | null } {
  const existing = Object.values(state.materials).find((m) => m.preset === presetKey && !m.edited && m.role !== 'DEFAULT');
  if (existing) return { state, id: existing.id };
  const id = nextId('m', Object.keys(state.materials));
  const inst = instanceFromPreset(id, presetKey, state.scene.partSizeMm);
  if (!inst) return { state, id: null };
  return { state: { ...state, materials: { ...state.materials, [id]: inst } }, id };
}

/** Instance for a library material: reuses the unedited one of the same item. */
function ensureLibraryInstance(state: ProjectState, source: LibrarySource): { state: ProjectState; id: MaterialId } {
  const existing = Object.values(state.materials).find((m) => m.library === source.id && !m.edited && m.role !== 'DEFAULT');
  if (existing) return { state, id: existing.id };
  const id = nextId('m', Object.keys(state.materials));
  const inst: MaterialInstance = { ...cloneInstance(source.instance, id), library: source.id };
  return { state: { ...state, materials: { ...state.materials, [id]: inst } }, id };
}

/** A new instance, shared with no part, that is what the source of an assignment names. */
function copyInstance(state: ProjectState, action: Extract<MaterialAction, { type: 'material/assign' }>): { state: ProjectState; id: MaterialId | null } {
  const id = nextId('m', Object.keys(state.materials));
  let inst: MaterialInstance | null = null;
  if (action.material && state.materials[action.material]) inst = cloneInstance(state.materials[action.material], id);
  else if (action.library) inst = { ...cloneInstance(action.library.instance, id), library: action.library.id };
  else if (action.preset) inst = instanceFromPreset(id, action.preset, state.scene.partSizeMm);
  if (!inst) return { state, id: null };
  return { state: { ...state, materials: { ...state.materials, [id]: inst } }, id };
}

function assign(state: ProjectState, action: Extract<MaterialAction, { type: 'material/assign' }>): ProjectState {
  let next = state;
  let matId: MaterialId | null = null;
  if (action.copy) {
    const r = copyInstance(state, action);
    next = r.state;
    matId = r.id;
  } else if (action.material && state.materials[action.material]) matId = action.material;
  else if (action.library) {
    const r = ensureLibraryInstance(state, action.library);
    next = r.state;
    matId = r.id;
  } else if (action.preset) {
    const r = ensureInstance(state, action.preset);
    next = r.state;
    matId = r.id;
  }
  if (!matId) return state;
  const nodes = { ...next.scene.nodes };
  let changed = false;
  if (action.faces) {
    const node = nodes[action.faces.part];
    if (!node || node.kind !== 'PART' || action.faces.indices.length === 0) return state;
    // Faces that already carry it do not make a change (an assignment that changes nothing leaves no undo entry).
    const per = triangleMaterials(node);
    if (action.faces.indices.every((i) => i < 0 || i >= per.length || per[i] === matId)) return state;
    nodes[node.id] = withFaceMaterial(node, action.faces.indices, matId);
    changed = true;
  } else {
    const parts = partsUnder(next, action.targets);
    if (parts.length === 0) return state;
    for (const p of parts) {
      const node = nodes[p];
      const has = partMaterials(node).some((m) => isChosen(next.materials[m]));
      if (action.mode === 'KEEP' && has) continue;
      if (node.material === matId && !node.faceMaterials?.length) continue;
      const updated: SceneNode = { ...node, material: matId };
      delete updated.faceMaterials;
      nodes[p] = updated;
      changed = true;
    }
  }
  if (!changed) return state;
  next = { ...next, scene: { ...next.scene, nodes } };
  return pruneMaterials(next);
}

function patchMaterial(state: ProjectState, id: MaterialId, fn: (m: MaterialInstance) => MaterialInstance): ProjectState {
  const m = state.materials[id];
  if (!m) return state;
  const n = fn(m);
  return n === m ? state : { ...state, materials: { ...state.materials, [id]: n } };
}

/** Editing a parameter detaches the instance from its preset: it is now the user's own. */
function editParam(m: MaterialInstance, key: string, value: unknown): MaterialInstance {
  if (m.params[key] === value) return m;
  return { ...m, params: { ...m.params, [key]: value }, preset: null, edited: true };
}

function detach(state: ProjectState, id: MaterialId, parts: readonly NodeId[]): ProjectState {
  const m = state.materials[id];
  if (!m) return state;
  const users = Object.values(state.scene.nodes).filter((n) => partMaterials(n).includes(id)).map((n) => n.id);
  const mine = parts.filter((p) => users.includes(p));
  // Not shared beyond the given parts: detach in place.
  if (mine.length === 0 || mine.length === users.length) {
    return patchMaterial(state, id, (x) => (x.edited && x.preset === null ? x : { ...x, preset: null, edited: true }));
  }
  const copyId = nextId('m', Object.keys(state.materials));
  const copy: MaterialInstance = { ...m, id: copyId, preset: null, edited: true, params: structuredCloneParams(m.params), wear: { ...m.wear }, textures: cloneTextures(m.textures), ...(m.graph ? { graph: cloneGraph(m.graph) } : {}) };
  const nodes = { ...state.scene.nodes };
  for (const p of mine) {
    const node = nodes[p];
    nodes[p] = {
      ...node,
      material: node.material === id ? copyId : node.material,
      ...(node.faceMaterials ? { faceMaterials: node.faceMaterials.map((f) => (f.material === id ? { ...f, material: copyId } : f)) } : {}),
    };
  }
  return { ...state, scene: { ...state.scene, nodes }, materials: { ...state.materials, [copyId]: copy } };
}

/** A copy of an instance under another id that shares no arrays with it. */
export function cloneInstance(m: MaterialInstance, id: MaterialId): MaterialInstance {
  const wear = { ...m.wear };
  for (const [k, v] of Object.entries(wear)) if (Array.isArray(v)) (wear as Record<string, unknown>)[k] = [...v];
  return { ...m, id, params: structuredCloneParams(m.params), wear, textures: cloneTextures(m.textures), ...(m.graph ? { graph: cloneGraph(m.graph) } : {}) };
}

function unlink(state: ProjectState, parts: readonly NodeId[]): ProjectState {
  const targets = partsUnder(state, parts);
  if (targets.length === 0) return state;
  const nodes = { ...state.scene.nodes };
  const materials = { ...state.materials };
  let changed = false;
  for (const p of targets) {
    const node = nodes[p];
    const map = new Map<MaterialId, MaterialId>();
    for (const m of partMaterials(node)) {
      if (!materials[m]) continue;
      const shared = Object.values(nodes).some((n) => n.id !== p && n.kind === 'PART' && partMaterials(n).includes(m));
      if (!shared) continue;
      const id = nextId('m', Object.keys(materials));
      materials[id] = cloneInstance(materials[m], id);
      map.set(m, id);
    }
    if (map.size === 0) continue;
    changed = true;
    const next: SceneNode = { ...node, material: node.material ? (map.get(node.material) ?? node.material) : node.material };
    if (node.faceMaterials) next.faceMaterials = node.faceMaterials.map((f) => ({ ...f, material: map.get(f.material) ?? f.material }));
    nodes[p] = next;
  }
  return changed ? { ...state, scene: { ...state.scene, nodes }, materials } : state;
}

function paste(state: ProjectState, instance: MaterialInstance, targets: readonly NodeId[]): ProjectState {
  const parts = partsUnder(state, targets);
  if (parts.length === 0) return state;
  const id = nextId('m', Object.keys(state.materials));
  const nodes = { ...state.scene.nodes };
  for (const p of parts) {
    const updated: SceneNode = { ...nodes[p], material: id };
    delete updated.faceMaterials;
    nodes[p] = updated;
  }
  return pruneMaterials({ ...state, scene: { ...state.scene, nodes }, materials: { ...state.materials, [id]: cloneInstance(instance, id) } });
}

/** Wear types a family supports (UI shows a slider for each). */
export function wearTypesFor(family: MaterialFamily): WearType[] {
  return [...WEAR_FAMILY_TYPES[family]];
}

/** Root model of the parts using a material (for "apply to the whole part"). */
function modelOfMaterial(state: ProjectState, id: MaterialId): NodeId | null {
  for (const node of Object.values(state.scene.nodes)) {
    if (partMaterials(node).includes(id)) {
      const chain = [node.id, ...ancestors(state, node.id)];
      return chain[chain.length - 1];
    }
  }
  return null;
}

export function reduceMaterials(state: ProjectState, action: MaterialAction): ProjectState {
  switch (action.type) {
    case 'material/assign':
      return assign(state, action);
    case 'material/setParam':
      return patchMaterial(state, action.id, (m) => editParam(m, action.key, action.value));
    case 'material/set':
      return patchMaterial(state, action.id, (m) => {
        const next = { ...m, ...action.patch };
        if (next.name !== null && next.name.trim() === '') next.name = null;
        return next.name === m.name && next.bevelRadiusMm === m.bevelRadiusMm ? m : next;
      });
    case 'material/unlinkLibrary': {
      if (!Object.values(state.materials).some((m) => m.library === action.library)) return state;
      const materials: Record<MaterialId, MaterialInstance> = {};
      for (const [id, m] of Object.entries(state.materials)) materials[id] = m.library === action.library ? { ...m, library: null } : m;
      return { ...state, materials };
    }
    case 'material/detach':
      return detach(state, action.id, action.parts);
    case 'material/setWear':
      return patchMaterial(state, action.id, (m) => ({ ...m, wear: { ...m.wear, ...action.patch } }));
    case 'material/wearPreset': {
      const p = wearPreset(action.key);
      if (!p) return state;
      return patchMaterial(state, action.id, (m) => ({ ...m, wear: { ...m.wear, ...p.props, preset: p.key } }));
    }
    case 'material/unlink':
      return unlink(state, action.parts);
    case 'material/paste':
      return paste(state, action.instance, action.targets);
    case 'material/wearToModel': {
      const src = state.materials[action.id];
      const model = modelOfMaterial(state, action.id);
      if (!src || !model) return state;
      const ids = new Set<MaterialId>();
      for (const p of partsUnder(state, [model])) for (const m of partMaterials(state.scene.nodes[p])) ids.add(m);
      const materials = { ...state.materials };
      const mix: Partial<WearProps> = {
        amount: src.wear.amount,
        scale: src.wear.scale,
        seed: src.wear.seed,
        perObject: src.wear.perObject,
        preset: src.wear.preset,
      };
      for (const t of ['edges', 'scratches', 'smudges', 'dust', 'dirt', 'patina', 'roughVar', 'dents'] as const) mix[t] = src.wear[t];
      for (const id of ids) {
        if (id === src.id) continue;
        const m = materials[id];
        materials[id] = { ...m, wear: { ...m.wear, ...(m.family === 'EMISSIVE' ? { amount: 0 } : mix) } };
      }
      return { ...state, materials };
    }
    default:
      return state;
  }
}

/**
 * The assignment the current selection asks for (UI §4.1): faces at level
 * FACES, otherwise the selected nodes, otherwise every model.
 */
export function assignAction(
  state: ProjectState,
  src: { preset?: string; material?: MaterialId; library?: LibrarySource },
  mode: AssignMode = 'REPLACE',
  ids?: readonly NodeId[],
): Extract<MaterialAction, { type: 'material/assign' }> {
  const sel = state.selection;
  if (!ids && sel.level === 'FACES' && sel.faces && sel.faces.indices.length > 0) {
    return { type: 'material/assign', ...src, targets: [sel.faces.part], faces: { part: sel.faces.part, indices: [...sel.faces.indices] }, mode };
  }
  const nodes = (ids ?? sel.ids).filter((id) => state.scene.nodes[id]);
  return { type: 'material/assign', ...src, targets: nodes.length > 0 ? [...nodes] : [...state.scene.roots], mode };
}

/** Inventory of what an assignment would overwrite: faces count triangle by triangle. */
export function inventoryFor(state: ProjectState, action: Extract<MaterialAction, { type: 'material/assign' }>): Inventory {
  if (!action.faces) return materialInventory(state, partsUnder(state, action.targets));
  const node = state.scene.nodes[action.faces.part];
  if (!node) return { entries: [], unassigned: 0, needsConfirm: false };
  const per = triangleMaterials(node);
  const byIdentity = new Map<string, InventoryEntry>();
  let unassigned = 0;
  for (const i of action.faces.indices) {
    const m = per[i];
    if (!m || !isChosen(state.materials[m])) {
      unassigned++;
      continue;
    }
    const key = materialIdentity(state.materials[m]);
    if (!byIdentity.has(key)) byIdentity.set(key, { material: m, parts: 1 });
  }
  const entries = [...byIdentity.values()];
  return { entries, unassigned, needsConfirm: entries.length >= 2 };
}

/** Parts an assignment action reaches (for the inventory). */
export function actionParts(state: ProjectState, action: Extract<MaterialAction, { type: 'material/assign' }>): NodeId[] {
  return action.faces ? [action.faces.part] : partsUnder(state, action.targets);
}

/** Number of catalogue presets (77). */
export const MATERIAL_PRESET_COUNT = MATERIAL_PRESETS.length;
