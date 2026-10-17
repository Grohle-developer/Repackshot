// Sets (phase L6): a light setup that also brings what the product reflects and stands on. Applying a set puts its
// lights in force like any setup, and then its decoration: the cards (planes of a card material facing the product),
// the backdrop (a colour, a gradient image or the infinity sweep of U9), the floor (a glossy, mirror or matte sheet
// under the product, or the sweep's own floor), the pool of light on the backdrop (a spot behind the product), the
// exposure offset over the product type's and the strength of the dome. One action, one undo step.
//
// The decoration is marked (`SceneNode.setPiece`, `LightInstance.setPiece`): it is not the product (part size, the
// rig's pivot, framing: core/scene.ts), the Doctor does not look at it, applying another setup replaces it without
// touching the user's parts, and Reset setup takes it away (the lights come back as the set has them). The camera a
// set suggests is never applied on its own: Use the set's camera (`studio/useSetCamera`) does it, and fits the
// backdrop and the floor to the new view.
//
// Everything is placed in part sizes around the rig pivot, as the lights are, so a set fits a ring and a sofa.

import { lightSetup } from '../data/light-setups';
import { materialPreset } from '../data/materials';
import type { Label, LightSetup, RGB, RGBA, SetCard, StudioPreset } from '../data/types';
import { activeCamera, cameraPosition, frameBox, outputAspect, type CameraState } from './camera';
import { kelvinToRgb, polar, toWorldAzimuth } from './light-math';
import { buildStudio, levelUp, lightsFromRig, polarAboutPivot, presetRefOf, reduceStudio, rigPivot, setupRefOf, worldFor, type LightInstance, type StudioAction } from './lighting';
import { nextId } from './ids';
import { instanceFromPreset, pruneMaterials, type MaterialId, type MaterialInstance } from './materials';
import { add, cross, dot, isEmptyBox, length, mat4Compose, normalize, round, scale, sub, transformPoint, type Mat4, type Vec3 } from './math';
import { getMesh, type MeshData } from './meshes';
import { fitSweep, FLOOR_LIFT, type SweepFit } from './primitive-ops';
import { ensurePrimitiveMesh, normalizeParams, type PrimitiveSpec } from './primitives';
import { POOL_THROW, recipeScale, poolWeight, resolvePreset, setupExposure } from './rig';
import { cleanSelection, isSetPiece, ownParts, productBounds, type FaceRange, type NodeId, type SceneNode, type SetPiece } from './scene';
import type { EnvironmentState, ProjectState } from './store';

/** What the pieces of a set are called (the interface gives them in its language; English otherwise). */
export interface SetPieceNames {
  /** By card material key (CARD_WHITE, CARD_BLACK, ALU_BRUSH...); a missing one takes the material's label. */
  cards?: Readonly<Record<string, string>>;
  backdrop?: string;
  floor?: string;
  pool?: string;
}

/** Where the pool's spot is aimed from: this many part sizes from the pivot, behind the product. */
export const POOL_STAND = 0.75;
/** The cone of the pool's spot, degrees: wide, so its pool has no edge (its size is its distance's, POOL_HALF). */
export const POOL_CONE = 150;
/** The pool's spot is soft from its axis to the edge of its cone. */
export const POOL_BLEND = 1;
/** Off its axis by this many degrees, a light near a wall lands half as bright (cos³: the angle and the distance). */
export const POOL_HALF = 37.5;
/** Size of the pool's bulb, part sizes. */
export const POOL_BULB = 0.05;
/** The most a pool's power is raised for meeting its backdrop at an angle: as if at 72 degrees from square. */
export const POOL_GRAZE = 0.3;
/** The catalogue material a backdrop's paper (and a matte floor) is made from, in the set's colour. */
export const PAPER_MATERIAL = 'CARD_WHITE';

/** A catalogue setup that is a set (L6): it brings decoration, a backdrop, a floor or its own exposure. */
export function isSet(setup: LightSetup | undefined): setup is LightSetup {
  return (
    setup !== undefined &&
    (setup.backdrop !== undefined || setup.floor !== undefined || setup.pool !== undefined || (setup.cards?.length ?? 0) > 0 || setup.exposureEv !== undefined || setup.envStrength !== undefined)
  );
}

/**
 * The set brings something to put in the scene or on the frame (a backdrop, a floor, a pool, cards). The Interior recipes
 * (K1) are sets that bring only a look (a world, an exposure, the strength of the environment): they dress nothing, and
 * so they leave the floor, the contact shadow and the background as the scene had them.
 */
export function hasDecoration(set: LightSetup): boolean {
  return set.backdrop !== undefined || set.floor !== undefined || set.pool !== undefined || (set.cards?.length ?? 0) > 0;
}

/** The set of a key, or undefined when the key is not a set. */
export function setOf(key: string): LightSetup | undefined {
  const s = lightSetup(key);
  return isSet(s) ? s : undefined;
}

/**
 * The set in force: the active setup when it is a set, or, with the product type's own rig (setup PRESET), the set the
 * type is (`StudioPreset.set`), whose decoration and look come with it.
 */
export function activeSet(state: ProjectState): LightSetup | undefined {
  if (state.studio.lightSetup === 'PRESET') {
    const own = resolvePreset(presetRefOf(state.studio))?.set;
    return own ? setOf(own) : undefined;
  }
  return setOf(state.studio.lightSetup);
}

/** The set in force is the product type's own (setup PRESET), not one chosen from the catalogue. */
export function isTypeSet(state: ProjectState): boolean {
  return state.studio.lightSetup === 'PRESET' && activeSet(state) !== undefined;
}

/** The scene holds something of the user's: a set is not dressed around nothing. */
function hasOwnParts(state: ProjectState): boolean {
  return ownParts(state).length > 0;
}

/** The parts of the scene that are a set's decoration, in tree order. */
export function setPieceIds(state: ProjectState): NodeId[] {
  return state.scene.roots.filter((r) => isSetPiece(state.scene.nodes[r]));
}

/** The backdrop is something that takes light (a sweep): SWEEP, or FLAT / GRADIENT with a pool, which needs a wall. */
export function setHasSweep(set: LightSetup): boolean {
  return set.backdrop?.kind === 'SWEEP' || (set.pool !== undefined && set.backdrop !== undefined);
}

/**
 * The set's backdrop when it is the background (a colour or a gradient behind the product, no sweep): what In the set
 * switches on and off. Null when the backdrop is a sweep (a piece of the decoration, also after Reset setup took it
 * away) or the set has none.
 */
export function setBackground(set: LightSetup): 'FLAT' | 'GRADIENT' | null {
  const b = set.backdrop;
  return b && !setHasSweep(set) && b.kind !== 'SWEEP' ? b.kind : null;
}

/** The colour of a set's sweep: SWEEP and FLAT their colour, GRADIENT its top. */
export function sweepColor(set: LightSetup): RGB {
  const b = set.backdrop;
  if (!b) return [0.5, 0.5, 0.5];
  if (b.kind === 'GRADIENT') return b.top ?? [0.1, 0.1, 0.1];
  return b.color ?? [0.5, 0.5, 0.5];
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

const r6 = (v: number): number => round(v, 6);
const DEG = 180 / Math.PI;

/**
 * XYZ Euler angles (degrees, the convention of `mat4Compose`) of the rotation whose columns are `x`, `y` and `z`
 * (an orthonormal, right-handed basis).
 */
export function eulerOf(x: Vec3, y: Vec3, z: Vec3): Vec3 {
  // m13 = z.x, m23 = z.y, m33 = z.z, m12 = y.x, m11 = x.x, m32 = y.z, m22 = y.y.
  const m13 = Math.max(-1, Math.min(1, z[0]));
  const ry = Math.asin(m13);
  if (Math.abs(m13) < 0.9999999) return [Math.atan2(-z[1], z[2]) * DEG, ry * DEG, Math.atan2(-y[0], x[0]) * DEG];
  return [Math.atan2(y[2], y[1]) * DEG, ry * DEG, 0];
}

/** Where a card goes: the centre of the plane, its axes (width along `right`, height along `up`) and its normal. */
export interface CardFrame {
  centre: Vec3;
  right: Vec3;
  up: Vec3;
  normal: Vec3;
  width: number;
  height: number;
}

/**
 * The frame of a card (world mm): at az / el / dist around `pivot` (camera-relative azimuth, part sizes), facing the
 * pivot, its width level with the floor and its height up (turned by its roll), lifted so it does not go through the
 * floor (`floorZ`): a card stands on the table, it is not buried in it.
 */
export function cardFrame(card: SetCard, pivot: Vec3, sizeMm: number, floorZ = 0): CardFrame {
  const width = card.size * sizeMm;
  const height = (card.sizeY ?? card.size) * sizeMm;
  let centre = add(pivot, polar(toWorldAzimuth(card.az), card.el, card.dist * sizeMm));
  const orient = (c: Vec3) => {
    let normal = normalize(sub(pivot, c));
    if (length(normal) === 0) normal = [0, 1, 0];
    // The panel's own up, level with the floor (as a light's), turned about the normal by the roll.
    let up = levelUp(scale(normal, -1));
    if (card.roll) {
      const a = (card.roll * Math.PI) / 180;
      const side = cross(up, normal);
      up = normalize(add(scale(up, Math.cos(a)), scale(side, Math.sin(a))));
    }
    const right = normalize(cross(up, normal));
    return { normal, up, right };
  };
  const o = orient(centre);
  // Its lowest point: the half extents along up and right, projected on Z. A card that would go through the floor is
  // raised as it is (it keeps facing where it faced): it stands on the floor.
  const low = centre[2] - (Math.abs(o.up[2]) * height) / 2 - (Math.abs(o.right[2]) * width) / 2;
  if (low < floorZ) centre = [centre[0], centre[1], centre[2] + (floorZ - low)];
  return { centre, right: o.right, up: o.up, normal: o.normal, width, height };
}

/** The four corners of a card, world mm, counter-clockwise seen from the pivot. */
export function cardCorners(f: CardFrame): Vec3[] {
  const w = scale(f.right, f.width / 2);
  const h = scale(f.up, f.height / 2);
  return [sub(sub(f.centre, w), h), sub(add(f.centre, w), h), add(add(f.centre, w), h), add(sub(f.centre, w), h)];
}

/** The floor plane of a set without a sweep: the floor of the sweep that would fit this camera (to where its curve starts). */
export function floorPlaneFit(fit: SweepFit): { spec: PrimitiveSpec; position: Vec3; rotation: Vec3 } {
  const { width, depth, radius, height } = fit.params;
  const theta = (fit.rotation[2] * Math.PI) / 180;
  const ey: Vec3 = [-Math.sin(theta), Math.cos(theta), 0];
  const flat = Math.max(1, depth - radius);
  // The sweep's floor runs from its front edge (-depth / 2 along ey) to where its curve starts (depth / 2 - radius).
  const along = -depth / 2 + flat / 2;
  const base: Vec3 = [fit.position[0], fit.position[1], fit.position[2] - height / 2];
  const centre = add(base, scale(ey, along));
  return {
    spec: { kind: 'PLANE', params: normalizeParams('PLANE', { width, depth: Math.round(flat) }) },
    position: [r6(centre[0]), r6(centre[1]), r6(centre[2])],
    rotation: [0, 0, r6(fit.rotation[2])],
  };
}

/** The nearest hit of a ray on a mesh placed by `m` (world mm) and the unit normal of the triangle hit, or null. Möller–Trumbore, both faces. */
export function rayHit(origin: Vec3, dir: Vec3, data: MeshData, m: Mat4): { point: Vec3; normal: Vec3 } | null {
  const pos = data.positions;
  const idx = data.indices;
  const p = (i: number): Vec3 => transformPoint(m, [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]]);
  let best = Infinity;
  let normal: Vec3 = [0, 0, 1];
  for (let t = 0; t + 2 < idx.length; t += 3) {
    const a = p(idx[t]);
    const e1 = sub(p(idx[t + 1]), a);
    const e2 = sub(p(idx[t + 2]), a);
    const q = cross(dir, e2);
    const det = dot(e1, q);
    if (Math.abs(det) < 1e-12) continue;
    const inv = 1 / det;
    const s0 = sub(origin, a);
    const u = dot(s0, q) * inv;
    if (u < 0 || u > 1) continue;
    const r = cross(s0, e1);
    const v = dot(dir, r) * inv;
    if (v < 0 || u + v > 1) continue;
    const d = dot(e2, r) * inv;
    if (d > 1e-9 && d < best) {
      best = d;
      normal = normalize(cross(e1, e2));
    }
  }
  return Number.isFinite(best) ? { point: add(origin, scale(dir, best)), normal } : null;
}

/**
 * Where a set's pool lands (world mm): the point of the backdrop the camera sees right over the product (its ray
 * through the top of the product's bounds at their far side, behind the rig pivot, on the sweep), so the pool is a
 * halo that rises from behind the product whatever the camera's height. Without a sweep to land on, three part sizes
 * beyond that point.
 */
export function poolTop(state: ProjectState): Vec3 {
  const pivot = rigPivot(state);
  const box = productBounds(state, true);
  if (isEmptyBox(box)) return pivot;
  const eye = cameraPosition(activeCamera(state));
  const ground = normalize([pivot[0] - eye[0], pivot[1] - eye[1], 0]);
  // How far the bounds reach behind the pivot, away from the camera.
  let back = 0;
  for (let i = 0; i < 4; i++) back = Math.max(back, dot(sub([i & 1 ? box.max[0] : box.min[0], i & 2 ? box.max[1] : box.min[1], 0], [pivot[0], pivot[1], 0]), ground));
  return [pivot[0] + ground[0] * back, pivot[1] + ground[1] * back, box.max[2]];
}

export function poolTarget(state: ProjectState, sweep: SceneNode | undefined): Vec3 {
  return poolLanding(state, sweep).point;
}

/** Where the pool lands and the backdrop's unit normal there (null without a backdrop). */
export function poolLanding(state: ProjectState, sweep: SceneNode | undefined): { point: Vec3; normal: Vec3 | null } {
  const top = poolTop(state);
  const eye = cameraPosition(activeCamera(state));
  const dir = normalize(sub(top, eye));
  const data = sweep?.mesh ? getMesh(sweep.mesh.id) : undefined;
  const hit = sweep && data ? rayHit(top, dir, data, mat4Compose(sweep.transform.position, sweep.transform.rotation, sweep.transform.scale)) : null;
  return hit ?? { point: add(top, scale(dir, 3 * (state.scene.partSizeMm || 1))), normal: null };
}

/**
 * The pool's spot (L6): a background light near its paper. It is aimed from behind the product, from the set's az / el
 * at POOL_STAND part sizes from the pivot (never under the floor), at `target`, and stands on that line as close to
 * the backdrop as makes the pool as wide as the set's cone makes it at POOL_THROW: its light falls off from the centre
 * of the pool with the angle and the distance (half as bright at POOL_HALF degrees off its axis), in a cone so wide
 * (POOL_CONE, soft from its axis) that the pool has no edge. Its glow is not seen (not by the camera, not in
 * reflections). `throwSizes` is how far it throws, in part sizes.
 */
export function poolGeometry(pool: { az: number; el: number; cone: number }, pivot: Vec3, target: Vec3, sizeMm: number, floorZ = 0): { stand: Vec3; throwSizes: number; cone: number } {
  let from = add(pivot, polar(toWorldAzimuth(pool.az), pool.el, POOL_STAND * sizeMm));
  if (from[2] < floorZ + 0.05 * sizeMm) from = [from[0], from[1], floorZ + 0.05 * sizeMm];
  const reach = length(sub(from, target));
  // The pool's radius at the reference throw, and the throw at which the falloff gives it that radius.
  const radius = POOL_THROW * Math.tan((Math.min(170, Math.max(1, pool.cone)) * Math.PI) / 360);
  const near = (radius / Math.tan((POOL_HALF * Math.PI) / 180)) * sizeMm;
  const stand = reach > near ? add(target, scale(sub(from, target), near / reach)) : from;
  return { stand, throwSizes: Math.max(0.05, length(sub(target, stand)) / sizeMm), cone: POOL_CONE };
}

/**
 * The glossy floor of a set whose pool lands on the sweep (L6): a sheet on the sweep's floor, from its front edge to
 * POOL_EDGE of the way from the product to the pool, so the pool lands on the paper and the sheet reflects it.
 */
export const POOL_EDGE = 0.55;

/** A sheet on the floor (world mm): the sweep fit's footprint, from its front edge to `back` mm behind the pivot along the sweep's axis. */
export function floorSheet(fit: SweepFit, pivot: Vec3, back: number, z: number): { spec: PrimitiveSpec; position: Vec3; rotation: Vec3 } {
  const { width, depth, height } = fit.params;
  const theta = (fit.rotation[2] * Math.PI) / 180;
  const ey: Vec3 = [-Math.sin(theta), Math.cos(theta), 0];
  const base: Vec3 = [fit.position[0], fit.position[1], fit.position[2] - height / 2];
  const front = dot(sub(base, pivot), ey) - depth / 2;
  const len = Math.max(1, back - front);
  const centre = add(add(pivot, scale(ey, front + len / 2)), [0, 0, 0]);
  return {
    spec: { kind: 'PLANE', params: normalizeParams('PLANE', { width, depth: Math.round(len) }) },
    position: [r6(centre[0]), r6(centre[1]), r6(z)],
    rotation: [0, 0, r6(fit.rotation[2])],
  };
}

// ---------------------------------------------------------------------------
// Applying a set
// ---------------------------------------------------------------------------

/** The scene without the decoration of any set: its pieces, their materials and the pool lights. */
export function withoutSetDecoration(state: ProjectState): ProjectState {
  const pieces = new Set(setPieceIds(state));
  const pools = state.studio.lights.some((l) => l.setPiece);
  if (pieces.size === 0 && !pools) return state;
  let next = state;
  if (pieces.size > 0) {
    const nodes = { ...state.scene.nodes };
    for (const id of pieces) delete nodes[id];
    next = { ...next, scene: { ...next.scene, nodes, roots: next.scene.roots.filter((r) => !pieces.has(r)) } };
    next = pruneMaterials(cleanSelection(next));
  }
  if (pools) {
    const lights = next.studio.lights.filter((l) => !l.setPiece);
    const ids = next.selection.ids.filter((id) => lights.some((l) => l.id === id) || !state.studio.lights.some((l) => l.id === id));
    next = { ...next, studio: { ...next.studio, lights }, selection: ids.length === next.selection.ids.length ? next.selection : { ...next.selection, ids } };
  }
  return next;
}

/**
 * The product type's environment, background and exposure (what Create studio sets), after leaving a set. The background
 * only when the set that is left had one on the frame (`background`): a set that brought a look alone (the Interior
 * recipes, K1) never touched it, so it is the person's.
 */
function presetLook(state: ProjectState, preset: StudioPreset | undefined, background = true): ProjectState {
  if (!preset) return state;
  const exposureEv = setupExposure(preset, setupRefOf(state.studio));
  const backdrop: EnvironmentState['background'] = preset.background === 'FLAT' ? 'COLOR' : 'ENVIRONMENT';
  return {
    ...state,
    environment: {
      ...state.environment,
      strength: preset.envStrength,
      ...(background ? { background: backdrop, color: [preset.backgroundColor[0], preset.backgroundColor[1], preset.backgroundColor[2], preset.backgroundColor[3]] as RGBA } : {}),
    },
    image: { ...state.image, exposureEv },
  };
}

/** The set in force brought a background with it: a backdrop on the frame, or a piece of the scene (a sweep). */
function broughtBackground(state: ProjectState): boolean {
  const set = activeSet(state);
  return (set !== undefined && set.backdrop !== undefined) || setPieceIds(state).length > 0;
}

/** A catalogue material for a piece: the scene's unedited instance of it, or a new one; `color` makes an own one. */
function pieceMaterial(state: ProjectState, preset: string, own: { color?: RGB; roughness?: number; name?: string } = {}): { state: ProjectState; id: MaterialId | null } {
  if (!own.color && own.roughness === undefined) {
    const existing = Object.values(state.materials).find((m) => m.preset === preset && !m.edited && m.role !== 'DEFAULT' && !m.library);
    if (existing) return { state, id: existing.id };
  }
  const id = nextId('m', Object.keys(state.materials));
  const base = instanceFromPreset(id, preset, state.scene.partSizeMm);
  if (!base) return { state, id: null };
  const params = { ...base.params };
  if (own.color) params.baseColor = [own.color[0], own.color[1], own.color[2], 1];
  if (own.roughness !== undefined) params.roughness = own.roughness;
  const inst: MaterialInstance = own.color || own.roughness !== undefined ? { ...base, name: own.name ?? null, edited: true, params } : base;
  return { state: { ...state, materials: { ...state.materials, [id]: inst } }, id };
}

/** Adds one piece of decoration at the root: a primitive part, marked. */
function addPiece(
  state: ProjectState,
  piece: SetPiece,
  name: string,
  spec: PrimitiveSpec,
  position: Vec3,
  rotation: Vec3,
  material: MaterialId | null,
  faces?: (ranges: { start: number; count: number }[], names: string[]) => FaceRange[],
): ProjectState {
  const id = nextId('n', Object.keys(state.scene.nodes));
  const made = ensurePrimitiveMesh(id, spec);
  const transform = { position: position.map(r6) as Vec3, rotation: rotation.map(r6) as Vec3, scale: [1, 1, 1] as Vec3 };
  const node: SceneNode = {
    id,
    name,
    kind: 'PART',
    parent: null,
    children: [],
    transform,
    initial: { position: [...transform.position], rotation: [...transform.rotation], scale: [1, 1, 1] },
    visible: true,
    locked: false,
    mesh: made.ref,
    material,
    faceRanges: made.faceRanges,
    smooth: true,
    primitive: spec,
    setPiece: piece,
  };
  const faceMaterials = faces?.(made.faceRanges, made.faceNames);
  if (faceMaterials && faceMaterials.length > 0) node.faceMaterials = faceMaterials;
  return { ...state, scene: { ...state.scene, nodes: { ...state.scene.nodes, [id]: node }, roots: [...state.scene.roots, id] } };
}

const labelIn = (label: Label | undefined, state: ProjectState, fallback: string): string => (label ? label[state.meta.lang] : fallback);

/** The pool's spot (a light of the set's decoration), with the power that lands its share on the backdrop. */
function poolLight(state: ProjectState, set: LightSetup, landing: { point: Vec3; normal: Vec3 | null }, name: string | undefined): LightInstance | null {
  const target = landing.point;
  const pool = set.pool;
  if (!pool || !set.lights) return null;
  const size = state.scene.partSizeMm || 1;
  const pivot = rigPivot(state);
  const g = poolGeometry(pool, pivot, target, size);
  // The set's own lights share the level with the pool; a product type that is the set keeps its lights at its level
  // and the pool stands to them as it does in the set.
  const preset = presetRefOf(state.studio);
  const k = state.studio.lightSetup === 'PRESET' ? recipeScale(preset, set.lights) : recipeScale(preset, set.lights, poolWeight(pool));
  // Measured at POOL_THROW (core/rig.ts) and square to the backdrop: as bright where it lands as that light would be
  // at that distance, facing it, whatever the angle the spot meets the backdrop at (up to POOL_GRAZE).
  const facing = landing.normal ? Math.abs(dot(landing.normal, normalize(sub(g.stand, target)))) : 1;
  const power = (k * pool.share * (g.throwSizes / POOL_THROW) ** 2) / Math.max(POOL_GRAZE, facing);
  const kelvin = pool.color ? null : (pool.kelvin ?? 5600);
  const color: RGB = pool.color ?? kelvinToRgb(kelvin ?? 5600);
  const id = nextId('l', [...state.studio.lights.map((l) => l.id), ...Object.keys(state.camera.cameras), ...Object.keys(state.scene.nodes)]);
  const at = polarAboutPivot(state, g.stand);
  const aim = scale(sub(target, pivot), 1 / size);
  return {
    id,
    role: 'RIM',
    type: 'SPOT',
    shape: 'SPHERE',
    size: POOL_BULB,
    sizeY: POOL_BULB,
    az: at ? r6(at.az) : pool.az,
    el: at ? r6(at.el) : pool.el,
    dist: at ? r6(at.dist) : POOL_STAND,
    spread: r6(g.cone),
    angle: 0.545,
    kelvin,
    color: [color[0], color[1], color[2]],
    power: Math.round(power * 1e6) / 1e6,
    glossy: false,
    camera: false,
    brightField: false,
    recipeGlossy: false,
    enabled: true,
    blend: POOL_BLEND,
    aim: [r6(aim[0]), r6(aim[1]), r6(aim[2])],
    setPiece: 'POOL',
    ...(name ? { name } : {}),
  };
}

/**
 * The decoration of `set` added to a scene whose lights are already the set's: the sweep (with the floor's material
 * on its floor), or the floor plane; the cards; the pool. Fitted to the active camera.
 */
export function addSetDecoration(state: ProjectState, set: LightSetup, names: SetPieceNames = {}): ProjectState {
  const size = state.scene.partSizeMm || 1;
  let next = state;
  const sweep = setHasSweep(set);
  const floor = set.floor;
  const glossy = floor !== undefined && (floor.kind === 'GLOSSY' || floor.kind === 'MIRROR');
  const fit = sweep || glossy || floor?.kind === 'MATTE' ? fitSweep(next) : null;
  const floorName = names.floor ?? 'Floor';
  const lift = Math.max(0.05, FLOOR_LIFT * size);
  const pivot = rigPivot(next);

  // The floor's material: its catalogue material (in its own colour when it has one), or matte paper.
  const floorMaterial = (): MaterialId | null => {
    if (!floor || floor.kind === 'CATCHER') return null;
    const preset = floor.kind === 'MATTE' ? PAPER_MATERIAL : (floor.material ?? 'ACRYLIC_BLACK');
    const color = floor.kind === 'MATTE' ? (floor.color ?? [0.5, 0.5, 0.5]) : floor.color;
    const roughness = floor.kind === 'MATTE' ? undefined : floor.roughness;
    const m = pieceMaterial(next, preset, color || roughness !== undefined ? { color, roughness, name: floorName } : {});
    next = m.state;
    return m.id;
  };

  let poolAt: { point: Vec3; normal: Vec3 | null } | null = null;
  if (sweep && fit) {
    const paper = pieceMaterial(next, PAPER_MATERIAL, { color: sweepColor(set), name: names.backdrop ?? 'Backdrop' });
    next = paper.state;
    // A matte floor on a sweep is the sweep's own floor. A glossy or mirror one is the sweep's floor in that material,
    // or, when a pool lands on the sweep, a sheet on it that stops short of the pool (the pool lands on paper).
    const onFloor = glossy && !set.pool ? floorMaterial() : null;
    next = addPiece(next, { kind: 'BACKDROP', index: 0 }, names.backdrop ?? 'Backdrop', { kind: 'SWEEP', params: fit.params }, fit.position, fit.rotation, paper.id, (ranges, faceNames) => {
      const i = faceNames.indexOf('floor');
      return onFloor && i >= 0 ? [{ start: ranges[i].start, count: ranges[i].count, material: onFloor }] : [];
    });
    if (set.pool) {
      const backdrop = next.scene.nodes[next.scene.roots[next.scene.roots.length - 1]];
      poolAt = poolLanding(next, backdrop);
      if (glossy) {
        const theta = (fit.rotation[2] * Math.PI) / 180;
        const ey: Vec3 = [-Math.sin(theta), Math.cos(theta), 0];
        const sheet = floorSheet(fit, pivot, POOL_EDGE * dot(sub(poolAt.point, pivot), ey), 2 * lift);
        const mat = floorMaterial();
        next = addPiece(next, { kind: 'FLOOR', index: 0 }, floorName, sheet.spec, sheet.position, sheet.rotation, mat);
      }
    }
  } else if (fit && floor && floor.kind !== 'CATCHER') {
    const mat = floorMaterial();
    const plane = floorPlaneFit(fit);
    next = addPiece(next, { kind: 'FLOOR', index: 0 }, floorName, plane.spec, plane.position, plane.rotation, mat);
  }

  // The cards, facing the product.
  (set.cards ?? []).forEach((card, index) => {
    const f = cardFrame(card, pivot, size, 2 * lift);
    const mat = pieceMaterial(next, card.material);
    next = mat.state;
    const spec: PrimitiveSpec = { kind: 'PLANE', params: normalizeParams('PLANE', { width: Math.round(f.width * 10) / 10, depth: Math.round(f.height * 10) / 10 }) };
    const name = names.cards?.[card.material] ?? labelIn(materialPreset(card.material)?.label, next, card.material);
    next = addPiece(next, { kind: 'CARD', index }, `${name} ${index + 1}`, spec, f.centre, eulerOf(f.right, f.up, f.normal), mat.id);
  });

  const pool = poolLight(next, set, poolAt ?? poolLanding(next, undefined), names.pool);
  if (pool) next = { ...next, studio: { ...next.studio, lights: [...next.studio.lights, pool] } };
  return next;
}

/** The set's look on the environment and the image: backdrop, the dome's strength, the exposure offset. */
function setLook(state: ProjectState, set: LightSetup, preset: StudioPreset | undefined): ProjectState {
  const env = { ...state.environment };
  const b = set.backdrop;
  if (b?.kind === 'FLAT' || b?.kind === 'SWEEP') {
    const c = b.color ?? [0.5, 0.5, 0.5];
    env.background = 'COLOR';
    env.color = [c[0], c[1], c[2], 1];
  } else if (b?.kind === 'GRADIENT') {
    const top = b.top ?? [0.1, 0.1, 0.1];
    const bottom = b.bottom ?? [0.02, 0.02, 0.02];
    env.background = 'GRADIENT';
    env.gradient = { top: [top[0], top[1], top[2]], bottom: [bottom[0], bottom[1], bottom[2]] };
    // Around the output frame (the viewport's margin), the bottom of the gradient.
    env.color = [bottom[0], bottom[1], bottom[2], 1];
  }
  env.strength = set.envStrength ?? preset?.envStrength ?? env.strength;
  const exposureEv = preset ? setupExposure(preset, setupRefOf(state.studio)) : (set.exposureEv ?? 0);
  return { ...state, environment: env, image: { ...state.image, exposureEv } };
}

/**
 * Puts a set in force: its lights, its look and its decoration (replacing any set's), over the user's scene. With
 * `asType`, the set is the product type's own rig (setup PRESET): the type's lights and exposure, the set's decoration.
 * A scene with nothing of the user's gets the lights and the look, and its decoration when a product comes in
 * (`studio/fitSet`).
 */
export function applySet(state: ProjectState, set: LightSetup, names: SetPieceNames = {}, asType = false): ProjectState {
  const preset = resolvePreset(presetRefOf(state.studio));
  const clean = withoutSetDecoration(state);
  const key = asType ? 'PRESET' : set.key;
  const lit: ProjectState = {
    ...clean,
    // A chosen set puts the studio's floor and contact shadow on; the type's own keeps the type's.
    studio: { ...clean.studio, lightSetup: key, customSetup: null, lights: lightsFromRig(presetRefOf(clean.studio), key), modified: false, ...(asType || !hasDecoration(set) ? {} : { floor: true, shadow: true }) },
    environment: { ...clean.environment, kind: worldFor(clean, key) },
  };
  // A set with no backdrop of its own (the Interior recipes, K1) does not paint over the one the set before it left on the
  // frame: that background goes back to the product type's.
  const base = set.backdrop === undefined && broughtBackground(state) ? presetLook(lit, preset) : lit;
  const looked = setLook(base, set, preset);
  return hasOwnParts(looked) ? addSetDecoration(looked, set, names) : looked;
}

/** The names the pieces of the decoration in force have now (so a refit keeps them). */
function namesInUse(state: ProjectState): { names: SetPieceNames; before: SceneNode[] } {
  const before = setPieceIds(state).map((id) => state.scene.nodes[id]);
  const names: SetPieceNames = { cards: {}, pool: state.studio.lights.find((l) => l.setPiece)?.name };
  for (const n of before) {
    if (n.setPiece?.kind === 'BACKDROP') names.backdrop = n.name;
    else if (n.setPiece?.kind === 'FLOOR') names.floor = n.name;
  }
  return { names, before };
}

/**
 * The decoration of the set in force made again for the scene as it is now (the product, the camera), each piece
 * keeping its name and whether it was on, and the pool; the lights and the look are left as they are. What Use the
 * set's camera ends with, and what a product coming into the scene asks for (`studio/fitSet`).
 */
function refitDecoration(state: ProjectState, set: LightSetup, given: SetPieceNames = {}): ProjectState {
  if (!hasOwnParts(state)) return state;
  const { names, before } = namesInUse(state);
  const pool = state.studio.lights.find((l) => l.setPiece);
  const merged: SetPieceNames = { ...given, ...Object.fromEntries(Object.entries(names).filter(([, v]) => v !== undefined && !(typeof v === 'object' && Object.keys(v).length === 0))) };
  let next = addSetDecoration(withoutSetDecoration(state), set, merged);
  const nodes = { ...next.scene.nodes };
  for (const id of setPieceIds(next)) {
    const n = nodes[id];
    const old = before.find((b) => b.setPiece?.kind === n.setPiece?.kind && b.setPiece?.index === n.setPiece?.index);
    if (old) nodes[id] = { ...n, name: old.name, visible: old.visible };
  }
  next = { ...next, scene: { ...next.scene, nodes }, studio: { ...next.studio, lights: next.studio.lights.map((l) => (l.setPiece && pool ? { ...l, enabled: pool.enabled } : l)) } };
  return next;
}

/** The camera a set suggests on the active camera, the product framed again; null when there is nothing to do. */
export function setCamera(state: ProjectState, set: LightSetup): CameraState | null {
  const cam = activeCamera(state);
  if (!cam || !set.camera || cam.locked) return null;
  let next: CameraState = {
    ...cam,
    elevation: set.camera.el ?? cam.elevation,
    focalMm: set.camera.focalMm ?? cam.focalMm,
    lens: set.camera.focalMm !== undefined && set.camera.focalMm !== cam.focalMm ? null : cam.lens,
    projection: 'PERSPECTIVE',
  };
  const box = productBounds(state, true);
  if (!isEmptyBox(box)) next = frameBox(next, box, outputAspect(state));
  return next;
}

/** Use the set's camera: the camera, then the backdrop, the floor and the pool fitted to it (cards stay where they are). */
function useSetCamera(state: ProjectState): ProjectState {
  const set = activeSet(state);
  if (!set) return state;
  const cam = setCamera(state, set);
  if (!cam) return state;
  const moved: ProjectState = { ...state, camera: { ...state.camera, cameras: { ...state.camera.cameras, [cam.id]: cam } } };
  return setPieceIds(state).length === 0 ? moved : refitDecoration(moved, set);
}

/**
 * The studio actions a set changes (store.ts routes them here first); null when the action is not one of them, so
 * the plain reducer (core/lighting.ts) handles it.
 *
 * - `studio/setSetup` with a set: the set in force (applySet). PRESET with a product type that is a set: the type's
 *   rig and that set's decoration. With any other setup, after a set: the set's decoration goes and the product type's
 *   environment, background and exposure come back.
 * - `studio/applySetup` (an own setup of the library), after a set: the same.
 * - `studio/build` with a set in force (chosen, or the type's own): Create studio, then the set's look and decoration
 *   fitted to the new framing.
 * - `studio/resetLights` with a set in force: the set's lights as they were, its decoration taken away.
 * - `studio/useSetCamera`: Use the set's camera.
 * - `studio/fitSet`: the decoration made again for the scene as it is (a product came in); nothing without a set.
 */
export function reduceSet(state: ProjectState, action: StudioAction): ProjectState | null {
  const decorated = () => activeSet(state) !== undefined || setPieceIds(state).length > 0 || state.studio.lights.some((l) => l.setPiece);
  switch (action.type) {
    case 'studio/setSetup': {
      const set = setOf(action.key);
      if (set) return applySet(state, set, action.names);
      if (action.key === 'PRESET') {
        const own = resolvePreset(presetRefOf(state.studio))?.set;
        const typeSet = own ? setOf(own) : undefined;
        if (typeSet) return applySet(state, typeSet, action.names, true);
      }
      if (!decorated()) return null;
      const background = broughtBackground(state);
      const next = reduceStudio(withoutSetDecoration(state), action);
      return next.studio.lightSetup === action.key ? presetLook(next, resolvePreset(presetRefOf(next.studio)), background) : null;
    }
    case 'studio/applySetup': {
      if (!decorated()) return null;
      const background = broughtBackground(state);
      const next = reduceStudio(withoutSetDecoration(state), action);
      return next.studio.lightSetup === action.setup.key ? presetLook(next, resolvePreset(presetRefOf(next.studio)), background) : null;
    }
    case 'studio/build': {
      const built = buildStudio(withoutSetDecoration(state));
      const set = activeSet(built);
      if (!set) return decorated() ? built : null;
      return applySet(built, set, action.names, isTypeSet(built));
    }
    case 'studio/resetLights': {
      if (!decorated()) return null;
      const clean = withoutSetDecoration(state);
      return { ...clean, studio: { ...clean.studio, lights: lightsFromRig(presetRefOf(clean.studio), setupRefOf(clean.studio)), modified: false } };
    }
    case 'studio/useSetCamera':
      return useSetCamera(state);
    case 'studio/fitSet': {
      const set = activeSet(state);
      return set ? refitDecoration(state, set, action.names) : state;
    }
    default:
      return null;
  }
}
