// The interior Doctor (K1, INTERIORS.md §3.6): the checks of the classic mistakes of an interior that need no engine, each with
// its one-click fix. They run only while the scene type is Interior (core/scene-type.ts): in a product scene they would be
// noise, and the Doctor's list in the status bar does not mention them.
//
//   interiorScale    the scene's size is not that of a piece of furniture or a room (a file in metres read as millimetres);
//   interiorOpening  the camera is inside a closed space lit by the sun or the sky, and nothing in it is glass;
//   interiorGlass    a window pane of thick or refractive glass;
//   interiorLens     a camera with a lens wider than 18 mm, which stretches the edges;
//   interiorEye      a camera whose eye height is not a person's;
//   interiorClip     the near clip of a camera inside the room reaches the nearest wall;
//   interiorNormals  a closed surface (or a flat wall) that faces the wrong way.
//
// What the model has today stands in for what K2 brings: there is no room node with its openings yet, so a "closed space" is
// the camera inside the bounds of the scene, an "opening" is glass or a transparent material, and a wall is what the bounds
// say it is. K2 replaces those two with the room's own data; the checks and the fixes stay.
//
// The thresholds are a proposal (ROADMAP K1, pending Fable): INTERIORS.md names the checks, not the numbers.

import { INTERIOR_DOCTOR_CHECKS } from '../data/doctor-interior';
import type { DoctorCheckKey, InteriorCheckKey } from '../data/types';
import type { DoctorResult } from './doctor';
import { cameraPosition, type CameraId, type CameraState } from './camera';
import { reduceStudio } from './lighting';
import { dot, cross, length, mat4Invert, sub, type Box, type Mat4, type Vec3 } from './math';
import { partMaterials, reduceMaterials } from './materials';
import { getMesh, type MeshData } from './meshes';
import { boundsOf, effectiveVisible, isSetPiece, measuredSizeMm, ownParts, partWorldBounds, reduceScene, worldMatrix, type NodeId } from './scene';
import { reduceSet } from './sets';
import { solidOrientation } from './solid';
import type { ProjectState } from './store';
import { reduceTransform } from './transform';

/** The checks, in the order they are listed and fixed. */
export const INTERIOR_CHECKS: readonly InteriorCheckKey[] = INTERIOR_DOCTOR_CHECKS.map((c) => c.key as InteriorCheckKey);

/** Smallest and largest size, mm, of a scene that is furniture or a room: a vase is 100 mm, a loft 30 m. */
export const INTERIOR_MIN_MM = 100;
export const INTERIOR_MAX_MM = 30000;
/** A lens wider than this stretches the edges of the picture (INTERIORS.md §3.4). */
export const WIDE_LENS_MM = 18;
/** What the fix puts: the widest of the interior lenses (24, 28, 35 mm). */
export const INTERIOR_LENS_MM = 24;
/** The eye height of a person standing, and the heights a camera may have before the Doctor says so (mm above the floor). */
export const EYE_STANDING_MM = 1500;
export const EYE_MIN_MM = 300;
export const EYE_MAX_MM = 2200;
/** A room is at least this big on every side (mm): the camera inside the bounds of anything smaller is not in a room. */
const ROOM_MIN_MM = 1500;
/** A window pane is flat (thickness over its longest side) and has two big sides (the middle one over the longest). */
const PANE_FLAT = 0.12;
const PANE_WIDE = 0.2;
/** And big enough to be a window and not a plate (mm). */
const PANE_MIN_MM = 300;
/** A wall is flat: this thin over its longest side. Anything below this size is a card, not a wall (mm). */
const WALL_FLAT = 0.02;
const WALL_MIN_MM = 1000;
/** A mesh with more triangles than this is not examined for its normals (it would stall every change of the scene). */
const MAX_TRIANGLES = 300_000;
/** The elevation limit of the eye-height fix, degrees: higher than this a camera looks nearly straight down. */
const MAX_EYE_ELEVATION = 80;

/** The recipe the opening check's fix puts (light-setups.ts): lamps and panels in the picture, no sun and no sky. */
export const OPENING_FIX_SETUP = 'INT_WHITE_ROOM';

function ok(key: InteriorCheckKey): DoctorResult {
  return { key, status: 'OK', fixable: true, detail: {} };
}

function warn(key: InteriorCheckKey, detail: Record<string, number | string>): DoctorResult {
  return { key, status: 'WARN', fixable: true, detail };
}

/** Rounds a size for the message: whole millimetres, or three significant digits below 10. */
function roundSize(mm: number): number {
  return mm >= 10 ? Math.round(mm) : Number(mm.toPrecision(3));
}

/** The visible parts of the person's scene: what the checks look at (a set's decoration is not theirs). */
function interiorParts(state: ProjectState): NodeId[] {
  return ownParts(state).filter((p) => effectiveVisible(state, p));
}

function sceneBox(state: ProjectState): Box {
  return boundsOf(state, interiorParts(state), true);
}

const isBox = (b: Box): boolean => b.min[0] <= b.max[0] && b.min[1] <= b.max[1] && b.min[2] <= b.max[2];

function inside(b: Box, p: Vec3): boolean {
  return isBox(b) && p.every((v, i) => v >= b.min[i] && v <= b.max[i]);
}

/** The camera is in a room-sized space made by the scene: inside its bounds, which are big on every side. */
function cameraInRoom(cam: CameraState, box: Box): boolean {
  if (cam.projection !== 'PERSPECTIVE' || !isBox(box)) return false;
  if ([0, 1, 2].some((i) => box.max[i] - box.min[i] < ROOM_MIN_MM)) return false;
  return inside(box, cameraPosition(cam));
}

function activeCam(state: ProjectState): CameraState | undefined {
  return state.camera.cameras[state.camera.active];
}

// --- Scale and units ------------------------------------------------------------------------------------------------

/** The unit factor an importer suggested for every model of the scene (core/doctor.ts `unitHint`). */
function unitHint(state: ProjectState): 1000 | 0.001 | null {
  const roots = state.scene.roots.filter((r) => !isSetPiece(state.scene.nodes[r]));
  const hints = roots.map((r) => state.scene.nodes[r]?.source?.unitHint ?? null);
  return hints.length > 0 && hints.every((h) => h !== null && h === hints[0]) ? hints[0] : null;
}

/**
 * The factor that brings a scene of `size` mm to the size of an interior: the importer's own (metres, micrometres) when it
 * lands there, else the power of ten, the smallest change that does, else the exact bound.
 */
export function interiorScaleFactor(size: number, hint: 1000 | 0.001 | null = null): number {
  const fits = (f: number) => size * f >= INTERIOR_MIN_MM && size * f <= INTERIOR_MAX_MM;
  if (hint !== null && fits(hint)) return hint;
  const steps = size < INTERIOR_MIN_MM ? [10, 100, 1000] : [0.1, 0.01, 0.001];
  for (const f of steps) if (fits(f)) return f;
  return size < INTERIOR_MIN_MM ? INTERIOR_MIN_MM / size : INTERIOR_MAX_MM / size;
}

function checkScale(state: ProjectState): DoctorResult {
  const size = measuredSizeMm(state);
  if (!(size > 0) || (size >= INTERIOR_MIN_MM && size <= INTERIOR_MAX_MM)) return ok('interiorScale');
  const hint = unitHint(state);
  const factor = interiorScaleFactor(size, hint);
  return warn('interiorScale', {
    reason: size < INTERIOR_MIN_MM ? 'small' : 'large',
    actual: roundSize(size),
    min: INTERIOR_MIN_MM,
    max: INTERIOR_MAX_MM,
    factor: Number(factor.toPrecision(4)),
    ...(hint !== null && factor === hint ? { hint } : {}),
  });
}

function fixScale(state: ProjectState): ProjectState {
  const r = checkScale(state);
  if (r.status !== 'WARN') return state;
  const next = reduceScene(state, { type: 'scene/setPartSize', mm: measuredSizeMm(state) * Number(r.detail.factor) });
  // The importer's hint is spent: the scene is in millimetres now.
  const nodes = { ...next.scene.nodes };
  for (const root of next.scene.roots) {
    const source = nodes[root]?.source;
    if (!source?.unitHint) continue;
    const { unitHint: _spent, ...rest } = source;
    nodes[root] = { ...nodes[root], source: rest };
  }
  return { ...next, scene: { ...next.scene, nodes } };
}

// --- An opening for the sun and the sky -----------------------------------------------------------------------------

/** The sun or the sky lights the scene (an HDRI the person loaded may be an interior's: it is not asked about). */
function sunOrSky(state: ProjectState): boolean {
  return state.environment.kind === 'SKY' || state.studio.lights.some((l) => l.enabled && l.type === 'SUN' && l.power > 0);
}

/** A material that lets light through: glass, or a simple material that is mostly transmissive or transparent. */
function lightGoesThrough(state: ProjectState, id: string): boolean {
  const m = state.materials[id];
  if (!m) return false;
  return m.family === 'GLASS' || Number(m.params.transmission ?? 0) >= 0.5 || Number(m.params.opacity ?? 1) <= 0.5;
}

function hasOpening(state: ProjectState): boolean {
  return interiorParts(state).some((p) => partMaterials(state.scene.nodes[p]).some((m) => lightGoesThrough(state, m)));
}

function checkOpening(state: ProjectState): DoctorResult {
  const cam = activeCam(state);
  if (!cam || !sunOrSky(state) || !cameraInRoom(cam, sceneBox(state)) || hasOpening(state)) return ok('interiorOpening');
  return warn('interiorOpening', { camera: cam.id });
}

/** The room is lit from inside: the recipe of lamps and panels replaces the sun and the sky. */
function fixOpening(state: ProjectState): ProjectState {
  if (checkOpening(state).status !== 'WARN') return state;
  const action = { type: 'studio/setSetup', key: OPENING_FIX_SETUP } as const;
  return reduceSet(state, action) ?? reduceStudio(state, action);
}

// --- Window glass ---------------------------------------------------------------------------------------------------

/** Length of each column of a world matrix: how far the part's own axes are stretched. */
function axisScales(m: Mat4): Vec3 {
  return [Math.hypot(m[0], m[1], m[2]), Math.hypot(m[4], m[5], m[6]), Math.hypot(m[8], m[9], m[10])];
}

/** The world matrices of one run of a check (a part's is its parents' times its own: asked once). */
type MatrixCache = Map<NodeId, Mat4>;

/** The sorted sides of a part's own box, in the world's millimetres (a turned part is as flat as it was). */
function sides(state: ProjectState, id: NodeId, cache: MatrixCache): [number, number, number] | null {
  const node = state.scene.nodes[id];
  if (!node?.mesh) return null;
  const k = axisScales(worldMatrix(state, id, cache));
  const b = node.mesh.bounds;
  const s = [0, 1, 2].map((i) => (b.max[i] - b.min[i]) * k[i]);
  if (!s.every(Number.isFinite)) return null;
  return s.sort((a, c) => a - c) as [number, number, number];
}

/** A flat part with two big sides that is big enough to be a window. */
function isPane(state: ProjectState, id: NodeId, cache: MatrixCache): boolean {
  const s = sides(state, id, cache);
  return s !== null && s[2] >= PANE_MIN_MM && s[0] <= PANE_FLAT * s[2] && s[1] >= PANE_WIDE * s[2];
}

/** The glass materials that make a pane thick or refractive: solid walls, on a part that is a pane. */
function thickGlass(state: ProjectState): { panes: NodeId[]; materials: string[] } {
  const panes: NodeId[] = [];
  const materials = new Set<string>();
  const cache: MatrixCache = new Map();
  for (const p of interiorParts(state)) {
    if (!isPane(state, p, cache)) continue;
    const thick = partMaterials(state.scene.nodes[p]).filter((m) => state.materials[m]?.family === 'GLASS' && state.materials[m].params.walls !== 'THIN');
    if (thick.length === 0) continue;
    panes.push(p);
    for (const m of thick) materials.add(m);
  }
  return { panes, materials: [...materials] };
}

function checkGlass(state: ProjectState): DoctorResult {
  const { panes, materials } = thickGlass(state);
  if (panes.length === 0) return ok('interiorGlass');
  return warn('interiorGlass', { count: panes.length, name: state.scene.nodes[panes[0]].name, material: materials[0] });
}

/** The panes get a thin glass of their own (a copy, when the material is shared with a part that is not a pane): it no longer refracts. */
function fixGlass(state: ProjectState): ProjectState {
  const { panes, materials } = thickGlass(state);
  let next = state;
  for (const id of materials) {
    const users = Object.values(next.scene.nodes).filter((n) => partMaterials(n).includes(id)).map((n) => n.id);
    const mine = users.filter((u) => panes.includes(u));
    if (mine.length === 0) continue;
    let target = id;
    if (mine.length < users.length) {
      next = reduceMaterials(next, { type: 'material/detach', id, parts: mine });
      // The detached copy is what the first pane has now in the place of the material.
      const node = next.scene.nodes[mine[0]];
      target = partMaterials(node).find((m) => m !== id && next.materials[m]?.family === 'GLASS') ?? id;
    }
    next = reduceMaterials(next, { type: 'material/setParam', id: target, key: 'walls', value: 'THIN' });
  }
  return next;
}

// --- Cameras: lens, eye height, near clip ---------------------------------------------------------------------------

function perspectiveCameras(state: ProjectState): CameraState[] {
  return Object.values(state.camera.cameras).filter((c) => c.projection === 'PERSPECTIVE');
}

function checkLens(state: ProjectState): DoctorResult {
  const wide = perspectiveCameras(state).filter((c) => c.focalMm < WIDE_LENS_MM);
  if (wide.length === 0) return ok('interiorLens');
  return warn('interiorLens', { count: wide.length, camera: wide[0].id, focal: Math.round(wide[0].focalMm * 10) / 10, wide: WIDE_LENS_MM, fixed: INTERIOR_LENS_MM });
}

function fixLens(state: ProjectState): ProjectState {
  const cameras = { ...state.camera.cameras };
  let changed = false;
  for (const c of perspectiveCameras(state)) {
    if (c.focalMm >= WIDE_LENS_MM) continue;
    // A focal length that is not a lens preset's, as `camera/set` leaves it.
    cameras[c.id] = { ...c, focalMm: INTERIOR_LENS_MM, lens: null };
    changed = true;
  }
  return changed ? { ...state, camera: { ...state.camera, cameras } } : state;
}

/** Height of the eye above the floor (the studio's floor is z = 0). */
const eyeHeight = (c: CameraState): number => cameraPosition(c)[2];

/** The cameras whose height is not a person's: a locked camera is the person's, as it is, and a plan view has no eye. */
function oddEyes(state: ProjectState): CameraState[] {
  return perspectiveCameras(state).filter((c) => !c.locked && (eyeHeight(c) < EYE_MIN_MM || eyeHeight(c) > EYE_MAX_MM));
}

function checkEye(state: ProjectState): DoctorResult {
  const odd = oddEyes(state);
  if (odd.length === 0) return ok('interiorEye');
  return warn('interiorEye', { count: odd.length, camera: odd[0].id, height: Math.round(eyeHeight(odd[0])), fixed: EYE_STANDING_MM, min: EYE_MIN_MM, max: EYE_MAX_MM });
}

/**
 * The camera at the height of a standing person, looking at the same point from the same side: its elevation changes (the
 * subject stays framed); when the camera is too close to the target to reach that height at a sane angle, it steps back.
 */
export function atEyeHeight(c: CameraState, height = EYE_STANDING_MM): CameraState {
  if (!(c.distance > 0)) return c;
  const rise = height - c.target[2];
  const sin = Math.sin((MAX_EYE_ELEVATION * Math.PI) / 180);
  let distance = c.distance;
  let ratio = rise / distance;
  if (Math.abs(ratio) > sin) {
    distance = Math.abs(rise) / sin;
    ratio = Math.sign(rise) * sin;
  }
  const k = distance / c.distance;
  return { ...c, elevation: Math.round((Math.asin(ratio) * 180) / Math.PI * 1e6) / 1e6, distance, focusDistance: c.focusDistance * k };
}

function fixEye(state: ProjectState): ProjectState {
  const cameras = { ...state.camera.cameras };
  for (const c of oddEyes(state)) cameras[c.id] = atEyeHeight(c);
  return { ...state, camera: { ...state.camera, cameras } };
}

/** Distance from `p` to the faces of a box it is inside of: the nearest wall. */
function wallDistance(box: Box, p: Vec3): number {
  return Math.min(...[0, 1, 2].flatMap((i) => [p[i] - box.min[i], box.max[i] - p[i]]));
}

/** The cameras inside the room whose near clip reaches the nearest wall, with that wall's distance. */
function clippedCameras(state: ProjectState): { cam: CameraState; wall: number }[] {
  const box = sceneBox(state);
  const out: { cam: CameraState; wall: number }[] = [];
  for (const cam of perspectiveCameras(state)) {
    if (!cameraInRoom(cam, box)) continue;
    const wall = wallDistance(box, cameraPosition(cam));
    if (cam.clipStart >= wall) out.push({ cam, wall });
  }
  return out;
}

/** The near clip a camera that is `wall` mm from a wall gets: half the way, never nothing. */
export function clearClip(wall: number): number {
  return Math.max(0.01, Math.round(wall * 0.5 * 100) / 100);
}

function checkClip(state: ProjectState): DoctorResult {
  const bad = clippedCameras(state);
  if (bad.length === 0) return ok('interiorClip');
  const first = bad[0];
  return warn('interiorClip', { count: bad.length, camera: first.cam.id, clip: Math.round(first.cam.clipStart * 100) / 100, wall: Math.round(first.wall), fixed: clearClip(first.wall) });
}

function fixClip(state: ProjectState): ProjectState {
  const cameras: Record<CameraId, CameraState> = { ...state.camera.cameras };
  for (const { cam, wall } of clippedCameras(state)) cameras[cam.id] = { ...cam, clipStart: clearClip(wall) };
  return { ...state, camera: { ...state.camera, cameras } };
}

// --- Normals --------------------------------------------------------------------------------------------------------

/** What a sheet's triangles add up to: the vector sum of their area normals and the sum of their areas (a flat sheet: equal lengths). */
const sheets = new WeakMap<MeshData, { normal: Vec3; area: number }>();

function sheetNormal(data: MeshData): { normal: Vec3; area: number } {
  let known = sheets.get(data);
  if (!known) {
    const p = data.positions;
    const ix = data.indices;
    const sum: Vec3 = [0, 0, 0];
    let area = 0;
    for (let t = 0; t + 2 < ix.length; t += 3) {
      const a: Vec3 = [p[ix[t] * 3], p[ix[t] * 3 + 1], p[ix[t] * 3 + 2]];
      const b: Vec3 = [p[ix[t + 1] * 3], p[ix[t + 1] * 3 + 1], p[ix[t + 1] * 3 + 2]];
      const c: Vec3 = [p[ix[t + 2] * 3], p[ix[t + 2] * 3 + 1], p[ix[t + 2] * 3 + 2]];
      const n = cross(sub(b, a), sub(c, a));
      sum[0] += n[0] / 2;
      sum[1] += n[1] / 2;
      sum[2] += n[2] / 2;
      area += length(n) / 2;
    }
    known = { normal: sum, area };
    sheets.set(data, known);
  }
  return known;
}

/** Sign of the determinant of the 3 x 3 of a world matrix: negative when the part is mirrored (it faces the other way). */
function handedness(m: Mat4): number {
  const d = dot([m[0], m[1], m[2]], cross([m[4], m[5], m[6]], [m[8], m[9], m[10]]));
  return d < 0 ? -1 : 1;
}

/** A normal of a mesh in the world: the transpose of the inverse (the cofactor, so a mirrored part faces the other way too). */
function worldNormal(m: Mat4, n: Vec3): Vec3 {
  const inv = mat4Invert(m);
  // (M^-1)^T n: row i of the transpose is column i of the inverse.
  const t: Vec3 = [inv[0] * n[0] + inv[1] * n[1] + inv[2] * n[2], inv[4] * n[0] + inv[5] * n[1] + inv[6] * n[2], inv[8] * n[0] + inv[9] * n[1] + inv[10] * n[2]];
  const h = handedness(m);
  return [t[0] * h, t[1] * h, t[2] * h];
}

/**
 * The parts whose faces look the wrong way for where the camera is. A closed surface faces outwards unless the camera is inside
 * it (a room), when it should face inwards; a flat wall of the scene should face the camera that is inside the room. An open
 * surface that is not a wall, a part whose mesh is missing and a mesh of more than 300 000 triangles are not asked about.
 */
function invertedParts(state: ProjectState): NodeId[] {
  const cam = activeCam(state);
  const box = sceneBox(state);
  const eye = cam ? cameraPosition(cam) : null;
  const room = !!cam && cameraInRoom(cam, box);
  const cache: MatrixCache = new Map();
  const bad: NodeId[] = [];
  for (const id of interiorParts(state)) {
    const node = state.scene.nodes[id];
    const data = node.mesh ? getMesh(node.mesh.id) : undefined;
    if (!data || data.indices.length / 3 > MAX_TRIANGLES) continue;
    const m = worldMatrix(state, id, cache);
    const orientation = solidOrientation(data);
    if (orientation !== 'OPEN') {
      const outward = orientation === 'OUTWARD' ? handedness(m) > 0 : handedness(m) < 0;
      const around = eye !== null && inside(partWorldBounds(state, id, cache), eye);
      if (outward === around) bad.push(id);
      continue;
    }
    if (!room || !eye) continue;
    // A flat wall of the room: its faces must look at the camera.
    const s = sides(state, id, cache);
    if (!s || s[2] < WALL_MIN_MM || s[0] > WALL_FLAT * s[2]) continue;
    const { normal, area } = sheetNormal(data);
    if (!(area > 0) || length(normal) < 0.9 * area) continue;
    const n = worldNormal(m, normal);
    const b = partWorldBounds(state, id, cache);
    const centre: Vec3 = [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
    const toEye = sub(eye, centre);
    const facing = dot(n, toEye) / (length(n) * length(toEye) || 1);
    if (facing < -0.05) bad.push(id);
  }
  return bad;
}

function checkNormals(state: ProjectState): DoctorResult {
  const bad = invertedParts(state);
  if (bad.length === 0) return ok('interiorNormals');
  return warn('interiorNormals', { count: bad.length, name: state.scene.nodes[bad[0]].name });
}

function fixNormals(state: ProjectState): ProjectState {
  const bad = invertedParts(state);
  return bad.length > 0 ? reduceTransform(state, { type: 'scene/flipNormals', ids: bad }) : state;
}

// --- The list -------------------------------------------------------------------------------------------------------

const CHECKS: Record<InteriorCheckKey, { check: (s: ProjectState) => DoctorResult; fix: (s: ProjectState) => ProjectState }> = {
  interiorScale: { check: checkScale, fix: fixScale },
  interiorOpening: { check: checkOpening, fix: fixOpening },
  interiorGlass: { check: checkGlass, fix: fixGlass },
  interiorLens: { check: checkLens, fix: fixLens },
  interiorEye: { check: checkEye, fix: fixEye },
  interiorClip: { check: checkClip, fix: fixClip },
  interiorNormals: { check: checkNormals, fix: fixNormals },
};

export function isInteriorCheck(key: DoctorCheckKey): key is InteriorCheckKey {
  return (INTERIOR_CHECKS as readonly string[]).includes(key);
}

/** The results of the interior checks: none unless the scene type is Interior. */
export function runInteriorDoctor(state: ProjectState): DoctorResult[] {
  return state.scene.type === 'INTERIOR' ? INTERIOR_CHECKS.map((k) => CHECKS[k].check(state)) : [];
}

/** The fix of an interior check; any other key leaves the state alone. */
export function fixInterior(state: ProjectState, key: DoctorCheckKey): ProjectState {
  return isInteriorCheck(key) && state.scene.type === 'INTERIOR' ? CHECKS[key].fix(state) : state;
}
