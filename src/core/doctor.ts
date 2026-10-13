// The Doctor (SPEC §4): fourteen checks, each with a detection and a fix.
// Scene checks run on the model; engine checks report UNAVAILABLE until the
// engine phases (D1) provide the data. The Doctor never changes anything
// unless asked: `fixDoctor` is only called from an explicit action.

import { DOCTOR_CHECKS } from '../data/doctor';
import type { DoctorCheckKey } from '../data/types';
import type { ActionBase, ProjectState } from './store';
import { clipEndFor, clipStartFor } from './camera';
import { add, boxCenter, boxRadius, isEmptyBox, length, sub, transformPoint, type Mat4, type Vec3 } from './math';
import { defaultBevelMm, partMaterials } from './materials';
import { presetRefOf } from './lighting';
import { resolvePreset } from './rig';
import { allParts, boundsOf, measuredSizeMm, reduceScene, worldMatrix, worldToLocalDelta, type NodeId, type SceneNode } from './scene';

export type DoctorStatus = 'OK' | 'WARN' | 'UNAVAILABLE';

/** Outcome of one check; `detail` feeds the sentence the interface shows. */
export interface DoctorResult {
  key: DoctorCheckKey;
  status: DoctorStatus;
  /** A one-click fix exists in this version. */
  fixable: boolean;
  detail: Record<string, number | string>;
}

/** Checks evaluated on the model in U1. The rest depend on the engine (phase D1). */
export const SCENE_CHECKS: ReadonlySet<DoctorCheckKey> = new Set<DoctorCheckKey>([
  'scale',
  'transform',
  'origin',
  'shading',
  'bevel',
  'clip',
  'lights',
]);

/** A scale is off when the ratio leaves [1/20, 20]. */
const SCALE_RATIO = 20;
/** An importer's unit hint is still trusted while the result stays within this ratio of the product type. */
const HINT_RATIO = SCALE_RATIO * SCALE_RATIO;
/** Origin farther than 40 % of the bounding radius from the bounds centre. */
const ORIGIN_RATIO = 0.4;
/** Meshes above this many triangles must have smooth shading. */
const SHADING_MIN_TRIANGLES = 200;

function ok(key: DoctorCheckKey, fixable = true): DoctorResult {
  return { key, status: 'OK', fixable, detail: {} };
}

function warn(key: DoctorCheckKey, detail: Record<string, number | string>, fixable = true): DoctorResult {
  return { key, status: 'WARN', fixable, detail };
}

/** Tolerance for "resting on the floor": 0.2 % of the part, at least 0.01 mm. */
function floorTolerance(state: ProjectState): number {
  return Math.max(0.01, state.scene.partSizeMm * 0.002);
}

/** Rounds a size for the message: whole millimetres, or three significant digits below 10. */
function roundSize(mm: number): number {
  return mm >= 10 ? Math.round(mm) : Number(mm.toPrecision(3));
}

/**
 * The unit factor an importer suggested for the model (metres: 1000, micrometres: 0.001), when
 * every model of the scene agrees on it.
 */
function unitHint(state: ProjectState): 1000 | 0.001 | null {
  const hints = state.scene.roots.map((r) => state.scene.nodes[r]?.source?.unitHint ?? null);
  return hints.length > 0 && hints.every((h) => h !== null && h === hints[0]) ? hints[0] : null;
}

function checkScale(state: ProjectState): DoctorResult {
  const actual = measuredSizeMm(state);
  if (actual <= 0) return ok('scale');
  const declared = state.scene.partSizeMm;
  const r1 = actual / declared;
  if (declared > 0 && (r1 > SCALE_RATIO || r1 < 1 / SCALE_RATIO)) {
    return warn('scale', { reason: 'declared', actual: roundSize(actual), expected: roundSize(declared) });
  }
  const preset = resolvePreset(presetRefOf(state.studio));
  if (preset) {
    const r2 = actual / preset.sizeMm;
    if (r2 > SCALE_RATIO || r2 < 1 / SCALE_RATIO) {
      // The importer saw a size that looks like metres or micrometres. That is evidence of a unit mix-up,
      // so its exact factor is offered even when the result is small or large for the product type (a 3 mm
      // screw is not a 200 mm bottle); it is dropped when it would still leave the model absurd.
      const hint = unitHint(state);
      const r3 = hint ? (actual * hint) / preset.sizeMm : 0;
      const factor = hint && r3 <= HINT_RATIO && r3 >= 1 / HINT_RATIO ? hint : null;
      return warn('scale', { reason: 'preset', actual: roundSize(actual), expected: preset.sizeMm, preset: preset.key, ...(factor ? { factor } : {}) });
    }
  }
  return ok('scale');
}

function checkTransform(state: ProjectState): DoctorResult {
  const off = allParts(state).filter((p) => state.scene.nodes[p].transform.scale.some((s) => Math.abs(s - 1) > 0.01));
  // Baking a scale into the mesh needs the geometry registry: fix comes with U2.
  return off.length > 0 ? warn('transform', { count: off.length }, false) : ok('transform', false);
}

interface OriginIssue {
  root: NodeId;
  offCentre: boolean;
  offset: number;
}

function originIssues(state: ProjectState): OriginIssue[] {
  const out: OriginIssue[] = [];
  const cache = new Map<NodeId, Mat4>();
  for (const root of state.scene.roots) {
    const b = boundsOf(state, [root]);
    if (isEmptyBox(b)) continue;
    const origin = transformPoint(worldMatrix(state, root, cache), [0, 0, 0]);
    const d = length(sub(origin, boxCenter(b)));
    const radius = boxRadius(b);
    out.push({ root, offCentre: radius > 0 && d > ORIGIN_RATIO * radius, offset: d });
  }
  return out;
}

function checkOrigin(state: ProjectState): DoctorResult {
  const issues = originIssues(state).filter((i) => i.offCentre);
  const b = boundsOf(state, state.scene.roots);
  let floorGap = 0;
  if (!isEmptyBox(b) && state.studio.floor && Math.abs(b.min[2]) > floorTolerance(state)) floorGap = b.min[2];
  if (issues.length === 0 && floorGap === 0) return ok('origin');
  return warn('origin', {
    offCentre: issues.length,
    floorGap: Math.round(floorGap * 100) / 100,
  });
}

function checkShading(state: ProjectState): DoctorResult {
  const faceted = allParts(state).filter((p) => {
    const n = state.scene.nodes[p];
    return n.smooth === false && (n.mesh?.triangles ?? 0) > SHADING_MIN_TRIANGLES;
  });
  return faceted.length > 0 ? warn('shading', { count: faceted.length, name: state.scene.nodes[faceted[0]].name }) : ok('shading');
}

function usedMaterials(state: ProjectState): string[] {
  const used = new Set<string>();
  for (const p of allParts(state)) for (const m of partMaterials(state.scene.nodes[p])) used.add(m);
  return [...used].filter((m) => state.materials[m]);
}

function checkBevel(state: ProjectState): DoctorResult {
  const bare = usedMaterials(state).filter((m) => {
    const mat = state.materials[m];
    return mat.family !== 'EMISSIVE' && !(mat.bevelRadiusMm > 0);
  });
  return bare.length > 0 ? warn('bevel', { count: bare.length }) : ok('bevel');
}

function checkClip(state: ProjectState): DoctorResult {
  const limit = state.scene.partSizeMm * 0.05;
  const bad = Object.values(state.camera.cameras).filter((c) => c.clipStart > limit);
  return bad.length > 0 ? warn('clip', { count: bad.length, clipStart: Math.round(bad[0].clipStart * 100) / 100 }) : ok('clip');
}

function checkLights(state: ProjectState): DoctorResult {
  const seen = state.studio.lights.filter((l) => l.enabled && l.camera && !l.brightField);
  return seen.length > 0 ? warn('lights', { count: seen.length }) : ok('lights');
}

/** Runs the fourteen checks, in catalogue order. */
export function runDoctor(state: ProjectState): DoctorResult[] {
  return DOCTOR_CHECKS.map((c) => {
    switch (c.key) {
      case 'scale':
        return checkScale(state);
      case 'transform':
        return checkTransform(state);
      case 'origin':
        return checkOrigin(state);
      case 'shading':
        return checkShading(state);
      case 'bevel':
        return checkBevel(state);
      case 'clip':
        return checkClip(state);
      case 'lights':
        return checkLights(state);
      default:
        return { key: c.key, status: 'UNAVAILABLE', fixable: false, detail: {} };
    }
  });
}

/** Number of checks currently warning. */
export function warningCount(results: readonly DoctorResult[]): number {
  return results.filter((r) => r.status === 'WARN').length;
}

/** Moves a root's origin to the centre of its bounds without moving the geometry. */
function centreOrigin(state: ProjectState, root: NodeId): ProjectState {
  const b = boundsOf(state, [root]);
  if (isEmptyBox(b)) return state;
  const cache = new Map<NodeId, Mat4>();
  const origin = transformPoint(worldMatrix(state, root, cache), [0, 0, 0]);
  const delta = sub(boxCenter(b), origin);
  const node = state.scene.nodes[root];
  const nodes: Record<NodeId, SceneNode> = { ...state.scene.nodes };
  const rootLocal = worldToLocalDelta(state, root, delta, cache);
  nodes[root] = { ...node, transform: { ...node.transform, position: add(node.transform.position, rootLocal) } };
  for (const c of node.children) {
    const child = state.scene.nodes[c];
    const local = worldToLocalDelta(state, c, delta, cache);
    nodes[c] = { ...child, transform: { ...child.transform, position: sub(child.transform.position, local) as Vec3 } };
  }
  return { ...state, scene: { ...state.scene, nodes } };
}

/** Applies the one-click fix of a check. Checks without a fix leave the state alone. */
export function fixDoctor(state: ProjectState, key: DoctorCheckKey): ProjectState {
  switch (key) {
    case 'scale': {
      const r = checkScale(state);
      if (r.status !== 'WARN') return state;
      // A file in metres or micrometres: the exact unit factor, otherwise the typical size.
      const factor = Number(r.detail.factor);
      const mm = factor > 0 ? measuredSizeMm(state) * factor : Number(r.detail.expected);
      const next = reduceScene(state, { type: 'scene/setPartSize', mm });
      // The hint is spent: the model is in millimetres now.
      const nodes = { ...next.scene.nodes };
      for (const root of next.scene.roots) {
        const source = nodes[root]?.source;
        if (!source?.unitHint) continue;
        const spent = { ...source };
        delete spent.unitHint;
        nodes[root] = { ...nodes[root], source: spent };
      }
      return { ...next, scene: { ...next.scene, nodes } };
    }
    case 'origin': {
      let next = state;
      for (const i of originIssues(state)) if (i.offCentre) next = centreOrigin(next, i.root);
      if (next.studio.floor) next = reduceScene(next, { type: 'scene/restOnFloor', ids: [] });
      return next;
    }
    case 'shading': {
      const ids = allParts(state).filter((p) => state.scene.nodes[p].smooth === false);
      return ids.length ? reduceScene(state, { type: 'scene/setSmooth', ids, smooth: true }) : state;
    }
    case 'bevel': {
      const mm = defaultBevelMm(state.scene.partSizeMm);
      const materials = { ...state.materials };
      let changed = false;
      for (const m of usedMaterials(state)) {
        const mat = materials[m];
        if (mat.family !== 'EMISSIVE' && !(mat.bevelRadiusMm > 0)) {
          materials[m] = { ...mat, bevelRadiusMm: mm };
          changed = true;
        }
      }
      return changed ? { ...state, materials } : state;
    }
    case 'clip': {
      const start = clipStartFor(state.scene.partSizeMm);
      const end = clipEndFor(state.scene.partSizeMm);
      const cameras = { ...state.camera.cameras };
      for (const [id, c] of Object.entries(cameras)) cameras[id] = { ...c, clipStart: start, clipEnd: end };
      return { ...state, camera: { ...state.camera, cameras } };
    }
    case 'lights': {
      if (!state.studio.lights.some((l) => l.camera && !l.brightField)) return state;
      const lights = state.studio.lights.map((l) => (l.brightField ? l : { ...l, camera: false, glossy: l.recipeGlossy }));
      return { ...state, studio: { ...state.studio, lights } };
    }
    default:
      return state;
  }
}

/** Fixes every warning that has a fix. */
export function fixAll(state: ProjectState): ProjectState {
  let next = state;
  for (const r of runDoctor(state)) if (r.status === 'WARN' && r.fixable) next = fixDoctor(next, r.key);
  return next;
}

export type DoctorAction =
  | ({ type: 'doctor/fix'; key: DoctorCheckKey } & ActionBase)
  | ({ type: 'doctor/fixAll' } & ActionBase);

export function reduceDoctor(state: ProjectState, action: DoctorAction): ProjectState {
  switch (action.type) {
    case 'doctor/fix':
      return fixDoctor(state, action.key);
    case 'doctor/fixAll':
      return fixAll(state);
    default:
      return state;
  }
}
