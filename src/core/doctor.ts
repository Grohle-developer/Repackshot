// The Doctor (SPEC §4): the fourteen base checks, the animation's aspect ratio (U13), S2's physics check (a
// dynamic part that starts below the floor) and the particle cap of the ambient effects (S4a), each with a
// detection and a fix.
// Scene checks run on the model. The engine checks (D1: workers, SIMD, denoise, view transform, fireflies, video
// output, time budget) live in core/doctor-engine.ts: they also read what the engine reports, which the page hands
// in, and they are UNAVAILABLE while it has not. The Doctor never changes anything
// unless asked: `fixDoctor` is only called from an explicit action.

import { DOCTOR_CHECKS } from '../data/doctor';
import type { DoctorCheckKey } from '../data/types';
import type { ActionBase, ProjectState } from './store';
import { activeCamera, aspectRatio, clipEndFor, clipStartFor } from './camera';
import { aspectText } from './aspect';
import { aspectForSize } from './render';
import { add, boxCenter, boxRadius, isEmptyBox, length, sub, transformPoint, type Mat4, type Vec3 } from './math';
import { defaultBevelMm, partMaterials } from './materials';
import { fitToCap, overCap } from './effects';
import { presetRefOf } from './lighting';
import { resolvePreset } from './rig';
import { boundsOf, isSetPiece, measuredSizeMm, ownParts, reduceScene, translateWorld, worldMatrix, worldToLocalDelta, type NodeId, type SceneNode } from './scene';
import { dynamicBelowFloor } from './physics';
import { engineCheck, engineFix } from './doctor-engine';
import { fixInterior, isInteriorCheck, runInteriorDoctor } from './doctor-interior';

export type DoctorStatus = 'OK' | 'WARN' | 'UNAVAILABLE';

/** Outcome of one check; `detail` feeds the sentence the interface shows. */
export interface DoctorResult {
  key: DoctorCheckKey;
  status: DoctorStatus;
  /** A one-click fix exists in this version. */
  fixable: boolean;
  detail: Record<string, number | string>;
}

/** Checks evaluated on the model in U1. The rest read the engine too (D1: core/doctor-engine.ts `ENGINE_CHECKS`). */
export const SCENE_CHECKS: ReadonlySet<DoctorCheckKey> = new Set<DoctorCheckKey>([
  'scale',
  'transform',
  'origin',
  'shading',
  'bevel',
  'clip',
  'lights',
  'aspect',
  'physics',
  'particles',
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

/** The roots that are not a set's decoration (L6): the Doctor looks at the user's scene, not at the set's cards. */
function ownRoots(state: ProjectState): NodeId[] {
  return state.scene.roots.filter((r) => !isSetPiece(state.scene.nodes[r]));
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
  const hints = ownRoots(state).map((r) => state.scene.nodes[r]?.source?.unitHint ?? null);
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
  // K1: in an interior the size to expect is a room's or a piece of furniture's, not the product type's (the interior Doctor's scale check asks that).
  if (preset && state.scene.type !== 'INTERIOR') {
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
  const off = ownParts(state).filter((p) => state.scene.nodes[p].transform.scale.some((s) => Math.abs(s - 1) > 0.01));
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
  for (const root of ownRoots(state)) {
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
  const b = boundsOf(state, ownRoots(state));
  let floorGap = 0;
  if (!isEmptyBox(b) && state.studio.floor && Math.abs(b.min[2]) > floorTolerance(state)) floorGap = b.min[2];
  if (issues.length === 0 && floorGap === 0) return ok('origin');
  return warn('origin', {
    offCentre: issues.length,
    floorGap: Math.round(floorGap * 100) / 100,
  });
}

function checkShading(state: ProjectState): DoctorResult {
  const faceted = ownParts(state).filter((p) => {
    const n = state.scene.nodes[p];
    return n.smooth === false && (n.mesh?.triangles ?? 0) > SHADING_MIN_TRIANGLES;
  });
  return faceted.length > 0 ? warn('shading', { count: faceted.length, name: state.scene.nodes[faceted[0]].name }) : ok('shading');
}

function usedMaterials(state: ProjectState): string[] {
  const used = new Set<string>();
  for (const p of ownParts(state)) for (const m of partMaterials(state.scene.nodes[p])) used.add(m);
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

/** S2: the dynamic parts that start below the floor (the simulator's floor is always at z = 0). */
function checkPhysics(state: ProjectState): DoctorResult {
  const below = dynamicBelowFloor(state, floorTolerance(state));
  return below.length > 0 ? warn('physics', { count: below.length, name: state.scene.nodes[below[0]].name }) : ok('physics');
}

function checkLights(state: ProjectState): DoctorResult {
  const seen = state.studio.lights.filter((l) => l.enabled && l.camera && !l.brightField);
  return seen.length > 0 ? warn('lights', { count: seen.length }) : ok('lights');
}

/** Two image ratios are the same when they differ by less than this (0.5 %, as a size rounded to a preset). */
const ASPECT_TOLERANCE = 0.005;

/** The shots whose camera takes another ratio than the output size (the shot's camera, or the active one for a shot without). */
function shotsOffRatio(state: ProjectState): { shot: number; camera: string }[] {
  const out = state.render.width / state.render.height;
  const off: { shot: number; camera: string }[] = [];
  state.animation.shots.forEach((s, i) => {
    const cam = (s.camera && state.camera.cameras[s.camera]) || activeCamera(state);
    if (cam && Math.abs(aspectRatio(cam) / out - 1) > ASPECT_TOLERANCE) off.push({ shot: i + 1, camera: cam.id });
  });
  return off;
}

function checkAspect(state: ProjectState): DoctorResult {
  const off = shotsOffRatio(state);
  if (off.length === 0) return ok('aspect');
  const cam = state.camera.cameras[off[0].camera];
  return warn('aspect', {
    count: off.length,
    shot: off[0].shot,
    camera: off[0].camera,
    aspect: aspectText(cam.aspect),
    output: `${state.render.width} × ${state.render.height}`,
  });
}

function checkParticles(state: ProjectState): DoctorResult {
  const over = overCap(state);
  if (over.length === 0) return ok('particles');
  const first = over[0];
  return warn('particles', { count: over.length, effect: first.effect.id, name: first.effect.name, preset: first.effect.preset, requested: first.requested, cap: first.cap });
}

/** Runs the checks, in catalogue order; while the scene is an interior, the interior Doctor's follow (K1, core/doctor-interior.ts). */
export function runDoctor(state: ProjectState): DoctorResult[] {
  return [...runBaseChecks(state), ...runInteriorDoctor(state)];
}

function runBaseChecks(state: ProjectState): DoctorResult[] {
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
      case 'aspect':
        return checkAspect(state);
      case 'physics':
        return checkPhysics(state);
      case 'particles':
        return checkParticles(state);
      default:
        // The checks that read the engine: UNAVAILABLE until the page hands in what it reports (D1).
        return engineCheck(c.key, state);
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
      const ids = ownParts(state).filter((p) => state.scene.nodes[p].smooth === false);
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
    case 'aspect': {
      // The cameras of the shots that discard the output's ratio take it (a preset when the size is exactly one).
      const off = new Set(shotsOffRatio(state).map((o) => o.camera));
      if (off.size === 0) return state;
      const aspect = aspectForSize(state.render.width, state.render.height);
      const cameras = { ...state.camera.cameras };
      for (const id of off) cameras[id] = { ...cameras[id], aspect };
      return { ...state, camera: { ...state.camera, cameras } };
    }
    case 'physics': {
      // Each mover up until its lowest point is on the floor.
      let next = state;
      for (const id of dynamicBelowFloor(state, floorTolerance(state))) {
        const b = boundsOf(next, [id]);
        if (!isEmptyBox(b)) next = translateWorld(next, [id], [0, 0, -b.min[2]]);
      }
      return next;
    }
    case 'particles':
      return fitToCap(state);
    case 'lights': {
      if (!state.studio.lights.some((l) => l.camera && !l.brightField)) return state;
      const lights = state.studio.lights.map((l) => (l.brightField ? l : { ...l, camera: false, glossy: l.recipeGlossy }));
      return { ...state, studio: { ...state.studio, lights } };
    }
    default:
      // K1: the checks of the interior Doctor; D1: the engine checks' fixes. A check without one leaves the state alone.
      return isInteriorCheck(key) ? fixInterior(state, key) : engineFix(state, key);
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
  | ({ type: 'doctor/fixAll' } & ActionBase)
  /**
   * Volatile: runs the checks again on the same project, after something they read outside it changed (the
   * engine's particle cap, Settings ▸ Render engine).
   */
  | ({ type: 'doctor/refresh' } & ActionBase);

export function reduceDoctor(state: ProjectState, action: DoctorAction): ProjectState {
  switch (action.type) {
    case 'doctor/fix':
      return fixDoctor(state, action.key);
    case 'doctor/fixAll':
      return fixAll(state);
    case 'doctor/refresh': {
      const results = runDoctor(state);
      return JSON.stringify(results) === JSON.stringify(state.doctor.results) ? state : { ...state, doctor: { results, stamp: state.doctor.stamp + 1 } };
    }
    default:
      return state;
  }
}
