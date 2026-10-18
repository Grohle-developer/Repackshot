// Physics (phase S2, SPEC §3.1 "Physics"): the rigid bodies the simulator is given, what its poses do to the scene,
// and the recorded track of a PHYSICS clip. Pure functions over ProjectState and the store's `physics/` actions.
//
// **Bodies.** A body is a *mover*, the node whose transform the simulation changes, and the parts it is made of: a
// part alone, or a group or model that falls as one body (its parts' points make one hull) unless its Physics
// section says *as parts*, when each of its parts falls on its own. **Drop** makes movers of the selection; Start
// uses the roles the inspector stored (`physics.role`, DYNAMIC on a node). Every other visible part, and
// the floor, is static. A locked node never moves.
//
// **Poses.** The simulator (engine/crates/rt-phys) frames every body with the world's axes at its centre of mass
// when it is added, and reports where that centre is (`p`) and how the body has turned since (`q`); `c₀` is the
// centre at step 0. So the mover's world matrix becomes `Δ · W₀` with `Δ = T(p) R(q) T(−c₀)`, and its local
// transform `P⁻¹ Δ W₀` (P: its parent's world matrix, which does not move). Its scale stays its own.
//
// **Tracks.** Every simulation records itself (ROADMAP, physics decision 5): when it starts, each mover gets a PHYSICS
// clip at the playhead that grows frame by frame at the project's fps while it runs and stays where it stopped; Stop
// (or settling) commits the movers' final poses, in the same undo step as the clips (one gesture); Reset takes the
// clips away and puts the movers back, as a step of its own. A track holds the mover's local position and rotation
// per frame as little-endian f32 (x, y, z, qx, qy, qz, qw) in base64, so the state stays plain JSON and the project
// file carries it as is; `TrackWriter` appends to it without encoding it all again, and `trackPose` interpolates.
// The clip's anchor is the node's position and rotation its frames refer to (where the run left it, once committed):
// a node moved afterwards takes its whole recorded fall with it.
//
// U16: the Physics section of a part also says how the weather of the scene treats it (Physics ▸ Weather): whether it
// gets wet (`getsWet`), whether dust and snow settle on it (`getsDust`), both on when absent, and the wettability family
// it wets as (`surface`; absent: its material's, data/wettability.ts `wettabilityFamilyOf`). Only what differs from the
// default is stored: `physics/set` drops `getsWet: true`, `getsDust: true` and `surface: null`.

import { DEFAULT_DENSITY, DENSITY_BY_CATEGORY, FLOOR_SURFACE, PHYSICS_DEFAULTS, PHYSICS_LIMITS } from '../data/physics';
import type { ClipAnchor, MotionClip } from './animation';
import { clamp, isEmptyBox, mat4Compose, mat4Identity, mat4Invert, mat4Multiply, type Mat4, type Vec3 } from './math';
import type { MeshId } from './meshes';
import { boundsOf, effectiveVisible, partsUnder, topMost, treeOrder, worldMatrix, type NodeId, type SceneNode, type Transform } from './scene';
import type { ActionBase, ProjectState } from './store';
import { cloneTransform, decomposeMatrix, isLocked } from './transform';
import { isWettabilityFamily, type WettabilityFamily } from '../data/wettability';
import type { GlassTrack } from './wet';
import type { PartsTrack } from './wet-parts';

/** What a part does in a simulation. Cloth (S9) and liquid (S7) come later. */
export type PhysicsRole = 'STATIC' | 'DYNAMIC';

/** The Physics section of a node (all optional: absent is the default). */
export interface PhysicsProps {
  /** STATIC when absent. A DYNAMIC group or model falls as one body unless `asParts`. */
  role?: PhysicsRole;
  /** kg/m³; absent or null: from the category of the material (data/physics.ts). */
  density?: number | null;
  /** Coulomb friction; absent: PHYSICS_DEFAULTS. */
  friction?: number;
  /** Restitution, 0..1; absent: PHYSICS_DEFAULTS. */
  bounciness?: number;
  /** GROUP or MODEL: each part is a body of its own. */
  asParts?: boolean;
  /** U16, on a part: false keeps it dry (no drops, no film; it still shelters what is below it). Absent: it gets wet. */
  getsWet?: boolean;
  /** U16, on a part: false keeps dust and snow off it (it still shelters). Absent: they settle on it. */
  getsDust?: boolean;
  /** U16, on a part: the wettability family it wets as; absent: its material's (data/wettability.ts). */
  surface?: WettabilityFamily;
}

/** What `physics/set` merges: a field set to null (or to its default) is cleared. */
export type PhysicsPatch = { [K in keyof PhysicsProps]?: PhysicsProps[K] | null };

/** One part of a body: its mesh and its world matrix when the simulation starts. */
export interface PhysicsPiece {
  part: NodeId;
  mesh: MeshId;
  matrix: Mat4;
}

/** A dynamic body. */
export interface PhysicsBody {
  mover: NodeId;
  pieces: PhysicsPiece[];
  density: number;
  friction: number;
  bounciness: number;
  /** The mover's world matrix at the start, and the inverse of its parent's. */
  start: Mat4;
  parentInv: Mat4;
}

/** A static part. */
export interface PhysicsStatic {
  piece: PhysicsPiece;
  friction: number;
  bounciness: number;
}

/** Everything the simulator is given. */
export interface PhysicsSpec {
  bodies: PhysicsBody[];
  statics: PhysicsStatic[];
  floor: { z: number; friction: number; bounciness: number };
}

/** Floats per body in the simulator's poses: translation x, y, z, rotation x, y, z, w. */
export const POSE_FLOATS = 7;

// ---------------------------------------------------------------------------
// A run of the simulator, as the engine side reports it (render/physics.ts) and the interface reads it
// ---------------------------------------------------------------------------

/** How a run goes: in real time, sampled at `fps`, for at most `maxSeconds` of simulated time. */
export interface PhysicsRunOptions {
  /** Frames per second of the recorded clip (the project's). */
  fps: number;
  /** It stops by itself after this much simulated time, settled or not. */
  maxSeconds: number;
}

/** What the simulator reports while it runs: only what it measured (rule 10). */
export interface PhysicsUpdate {
  /** Steps simulated (the time is steps / 240 s). */
  steps: number;
  awake: number;
  bodies: number;
  settled: boolean;
  /** The frames recorded since the last report (POSE_FLOATS per body of the world each), in order. */
  frames: Float32Array[];
  /**
   * S3b: with a front glass fed by the scene, the engine's record of each of those frames (rt_phys::wet `frame`:
   * the drops, the motes added and carried away), in the same order; absent without one.
   */
  glass?: Uint8Array[];
  /** S3c: with the parts wetted, the engine's record of each of those frames (rt_phys::wet_parts `frame`). */
  parts?: Uint8Array[];
}

/** When the world is built: where each body of the spec is among the poses, and the poses at step 0 (frame 0). */
export interface PhysicsStarted {
  ids: Uint32Array;
  initial: Float32Array;
  bodies: number;
  /** S3b: the record of the front glass at step 0 (a dry pane), when the run has one. */
  glass?: Uint8Array;
  /** S3c: the engine's layout of the samples of the parts, and their record at step 0, when the run wets them. */
  parts?: { layout: Uint8Array; frame: Uint8Array };
}

/** How a run ended: the frames not reported yet, and the poses of the last frame (what Stop commits). */
export interface PhysicsResult extends PhysicsUpdate {
  reason: 'SETTLED' | 'STOPPED' | 'TIME';
  poses: Float32Array;
}

/** A run in progress. */
export interface PhysicsRunHandle {
  /** Resolves when the world is built; rejects with the reason when the simulator is not there or the scene fails. */
  started: Promise<PhysicsStarted>;
  done: Promise<PhysicsResult>;
  /** Freezes it where it is (nothing is simulated until `resume`). */
  pause(): void;
  resume(): void;
  /** Stops it at the next step; `done` then resolves with reason STOPPED. */
  stop(): void;
}

/** Simulated steps per second (rt-phys: a fixed step of 1/240 s). */
export const STEPS_PER_SECOND = 240;

/** The steps at which RECORD samples frame `k` at `fps` (the nearest step; exact for 24, 30, 48, 60, 120 fps). */
export function frameStep(k: number, fps: number): number {
  return Math.round((k * STEPS_PER_SECOND) / fps);
}

// ---------------------------------------------------------------------------
// Roles and parameters
// ---------------------------------------------------------------------------

export function physicsOf(node: SceneNode | undefined): PhysicsProps {
  return node?.physics ?? {};
}

/** The role stored on a node (STATIC when none). */
export function roleOf(node: SceneNode | undefined): PhysicsRole {
  return node?.physics?.role ?? 'STATIC';
}

/** A group or a model falls as parts (each part its own body). */
export function fallsAsParts(node: SceneNode | undefined): boolean {
  return node?.kind !== 'PART' && node?.physics?.asParts === true;
}

/** The density a mover falls with: its own, or that of its first part's material category, or the default. */
export function densityOf(state: ProjectState, mover: NodeId): number {
  const own = state.scene.nodes[mover]?.physics?.density;
  if (typeof own === 'number' && Number.isFinite(own) && own > 0) return own;
  return materialDensity(state, mover);
}

/** The density of the material of a node's first part with a chosen material (the default without one). */
export function materialDensity(state: ProjectState, id: NodeId): number {
  for (const p of partsUnder(state, [id])) {
    const m = state.scene.nodes[p]?.material;
    const mat = m ? state.materials[m] : undefined;
    if (mat && mat.role !== 'DEFAULT') return DENSITY_BY_CATEGORY[mat.category] ?? DEFAULT_DENSITY;
  }
  return DEFAULT_DENSITY;
}

function frictionOf(node: SceneNode | undefined): number {
  const f = node?.physics?.friction;
  return typeof f === 'number' && Number.isFinite(f) ? clamp(f, PHYSICS_LIMITS.friction.min, PHYSICS_LIMITS.friction.max) : PHYSICS_DEFAULTS.friction;
}

function bouncinessOf(node: SceneNode | undefined): number {
  const b = node?.physics?.bounciness;
  return typeof b === 'number' && Number.isFinite(b) ? clamp(b, PHYSICS_LIMITS.bounciness.min, PHYSICS_LIMITS.bounciness.max) : PHYSICS_DEFAULTS.bounciness;
}

/** Friction shown for a node: its own or the default. */
export function shownFriction(node: SceneNode | undefined): number {
  return frictionOf(node);
}

/** Bounciness shown for a node: its own or the default. */
export function shownBounciness(node: SceneNode | undefined): number {
  return bouncinessOf(node);
}

// ---------------------------------------------------------------------------
// Bodies
// ---------------------------------------------------------------------------

/** The movers of a set of nodes: a part, or a group (one body, or each of its parts when it falls as parts). */
function moversOf(state: ProjectState, ids: readonly NodeId[]): { mover: NodeId; parts: NodeId[] }[] {
  const out: { mover: NodeId; parts: NodeId[] }[] = [];
  const visible = (p: NodeId) => effectiveVisible(state, p) && !!state.scene.nodes[p]?.mesh;
  for (const id of topMost(state, ids)) {
    const node = state.scene.nodes[id];
    if (!node || isLocked(state, id)) continue;
    if (node.kind === 'PART') {
      if (visible(id)) out.push({ mover: id, parts: [id] });
      continue;
    }
    const parts = partsUnder(state, [id]).filter(visible);
    if (fallsAsParts(node)) {
      for (const p of parts) if (!isLocked(state, p)) out.push({ mover: p, parts: [p] });
    } else if (parts.length > 0) out.push({ mover: id, parts });
  }
  return out;
}

/** The nodes whose stored role is DYNAMIC, top-most, in tree order. */
export function dynamicNodes(state: ProjectState): NodeId[] {
  const marked = treeOrder(state).filter((id) => roleOf(state.scene.nodes[id]) === 'DYNAMIC');
  return topMost(state, marked);
}

function pieceOf(state: ProjectState, part: NodeId, cache: Map<NodeId, Mat4>): PhysicsPiece | null {
  const node = state.scene.nodes[part];
  if (!node?.mesh) return null;
  return { part, mesh: node.mesh.id, matrix: worldMatrix(state, part, cache) };
}

/**
 * What the simulator is given: the movers of `drop` (Drop), or of the stored DYNAMIC roles when `drop` is absent,
 * every other visible part as static, and the floor. Null when nothing would move.
 */
export function physicsSpec(state: ProjectState, drop?: readonly NodeId[]): PhysicsSpec | null {
  const movers = moversOf(state, drop ?? dynamicNodes(state));
  if (movers.length === 0) return null;
  const cache = new Map<NodeId, Mat4>();
  const moving = new Set(movers.flatMap((m) => m.parts));
  const bodies: PhysicsBody[] = [];
  for (const m of movers) {
    const pieces = m.parts.map((p) => pieceOf(state, p, cache)).filter((p): p is PhysicsPiece => p !== null);
    if (pieces.length === 0) continue;
    const node = state.scene.nodes[m.mover];
    // A part of a group that falls as parts takes the group's settings unless it has its own.
    const owner = node.physics || !node.parent ? node : state.scene.nodes[node.parent];
    const own = owner.physics?.density;
    bodies.push({
      mover: m.mover,
      pieces,
      density: typeof own === 'number' && own > 0 ? own : materialDensity(state, m.mover),
      friction: frictionOf(owner),
      bounciness: bouncinessOf(owner),
      start: worldMatrix(state, m.mover, cache),
      parentInv: node.parent ? mat4Invert(worldMatrix(state, node.parent, cache)) : mat4Identity(),
    });
  }
  if (bodies.length === 0) return null;
  const statics: PhysicsStatic[] = [];
  for (const p of partsUnder(state, state.scene.roots)) {
    if (moving.has(p) || !effectiveVisible(state, p)) continue;
    const piece = pieceOf(state, p, cache);
    if (!piece) continue;
    const node = state.scene.nodes[p];
    statics.push({ piece, friction: frictionOf(node), bounciness: bouncinessOf(node) });
  }
  return { bodies, statics, floor: { z: 0, friction: FLOOR_SURFACE.friction, bounciness: FLOOR_SURFACE.bounciness } };
}

// ---------------------------------------------------------------------------
// Poses
// ---------------------------------------------------------------------------

export type Quat = [number, number, number, number];

/** The rotation matrix of a unit quaternion (x, y, z, w), as a Mat4 with no translation. */
export function quatMatrix(q: readonly number[]): Mat4 {
  const [x, y, z, w] = q;
  const m = mat4Identity();
  m[0] = 1 - 2 * (y * y + z * z);
  m[1] = 2 * (x * y + z * w);
  m[2] = 2 * (x * z - y * w);
  m[4] = 2 * (x * y - z * w);
  m[5] = 1 - 2 * (x * x + z * z);
  m[6] = 2 * (y * z + x * w);
  m[8] = 2 * (x * z + y * w);
  m[9] = 2 * (y * z - x * w);
  m[10] = 1 - 2 * (x * x + y * y);
  return m;
}

/** The unit quaternion of the rotation part of a matrix (its columns normalised), x, y, z, w. */
export function matrixQuat(m: Mat4): Quat {
  const col = (c: number) => {
    const l = Math.hypot(m[4 * c], m[4 * c + 1], m[4 * c + 2]) || 1;
    return [m[4 * c] / l, m[4 * c + 1] / l, m[4 * c + 2] / l];
  };
  const [a, b, c] = [col(0), col(1), col(2)];
  // r[row][col]
  const r = [
    [a[0], b[0], c[0]],
    [a[1], b[1], c[1]],
    [a[2], b[2], c[2]],
  ];
  const tr = r[0][0] + r[1][1] + r[2][2];
  let q: Quat;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    q = [(r[2][1] - r[1][2]) / s, (r[0][2] - r[2][0]) / s, (r[1][0] - r[0][1]) / s, 0.25 * s];
  } else if (r[0][0] > r[1][1] && r[0][0] > r[2][2]) {
    const s = Math.sqrt(1 + r[0][0] - r[1][1] - r[2][2]) * 2;
    q = [0.25 * s, (r[0][1] + r[1][0]) / s, (r[0][2] + r[2][0]) / s, (r[2][1] - r[1][2]) / s];
  } else if (r[1][1] > r[2][2]) {
    const s = Math.sqrt(1 + r[1][1] - r[0][0] - r[2][2]) * 2;
    q = [(r[0][1] + r[1][0]) / s, 0.25 * s, (r[1][2] + r[2][1]) / s, (r[0][2] - r[2][0]) / s];
  } else {
    const s = Math.sqrt(1 + r[2][2] - r[0][0] - r[1][1]) * 2;
    q = [(r[0][2] + r[2][0]) / s, (r[1][2] + r[2][1]) / s, 0.25 * s, (r[1][0] - r[0][1]) / s];
  }
  const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
}

/** The world matrix of body `i` of `spec` for the pose `poses[i]`, given its centre at step 0 (`initial[i]`). */
export function bodyWorld(spec: PhysicsSpec, i: number, initial: ArrayLike<number>, poses: ArrayLike<number>, at = i): Mat4 {
  const o = at * POSE_FLOATS;
  const c0: Vec3 = [initial[o], initial[o + 1], initial[o + 2]];
  const p: Vec3 = [poses[o], poses[o + 1], poses[o + 2]];
  const r = quatMatrix([poses[o + 3], poses[o + 4], poses[o + 5], poses[o + 6]]);
  // Δ = T(p) R T(−c₀): R applied to −c₀, plus p.
  const rc = [r[0] * c0[0] + r[4] * c0[1] + r[8] * c0[2], r[1] * c0[0] + r[5] * c0[1] + r[9] * c0[2], r[2] * c0[0] + r[6] * c0[1] + r[10] * c0[2]];
  const delta = [...r];
  delta[12] = p[0] - rc[0];
  delta[13] = p[1] - rc[1];
  delta[14] = p[2] - rc[2];
  return mat4Multiply(delta, spec.bodies[i].start);
}

/** The local matrix of body `i`'s mover for a pose. */
export function moverLocal(spec: PhysicsSpec, i: number, initial: ArrayLike<number>, poses: ArrayLike<number>, at = i): Mat4 {
  return mat4Multiply(spec.bodies[i].parentInv, bodyWorld(spec, i, initial, poses, at));
}

/**
 * The movers' local transforms for the simulator's `poses` (POSE_FLOATS per body, in the order of the world's
 * bodies; `ids[i]` says where body `i` of the spec is, or is NO_BODY when it had no mass). The scale of each mover is
 * kept exactly; its Euler angles are the ones closest to its current rotation.
 */
export function poseTransforms(state: ProjectState, spec: PhysicsSpec, ids: ArrayLike<number>, initial: ArrayLike<number>, poses: ArrayLike<number>): Record<NodeId, Transform> {
  const out: Record<NodeId, Transform> = {};
  spec.bodies.forEach((b, i) => {
    const at = ids[i];
    if (at === undefined || at >= NO_BODY || (at + 1) * POSE_FLOATS > poses.length) return;
    const node = state.scene.nodes[b.mover];
    if (!node) return;
    const t = decomposeMatrix(moverLocal(spec, i, initial, poses, at), node.transform);
    out[b.mover] = { position: t.position, rotation: t.rotation, scale: [...node.transform.scale] };
  });
  return out;
}

/** Index of a body of the spec that the simulator could not give a mass to. */
export const NO_BODY = 0xffffffff;

/** The movers' transforms now, to go back to (Reset). */
export function moverTransforms(state: ProjectState, spec: PhysicsSpec): Record<NodeId, Transform> {
  const out: Record<NodeId, Transform> = {};
  for (const b of spec.bodies) {
    const node = state.scene.nodes[b.mover];
    if (node) out[b.mover] = cloneTransform(node.transform);
  }
  return out;
}

// ---------------------------------------------------------------------------
// The Doctor: dynamic parts below the floor
// ---------------------------------------------------------------------------

/** The DYNAMIC movers whose lowest point starts below the floor by more than `tolerance` mm. */
export function dynamicBelowFloor(state: ProjectState, tolerance: number): NodeId[] {
  const out: NodeId[] = [];
  for (const m of moversOf(state, dynamicNodes(state))) {
    const b = boundsOf(state, m.parts);
    if (!isEmptyBox(b) && b.min[2] < -tolerance) out.push(m.mover);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Recorded tracks (PHYSICS clips)
// ---------------------------------------------------------------------------

/** A mover's recorded motion: `frames` samples at `fps`, local position and rotation, f32 LE, base64. */
export interface PhysicsTrack {
  fps: number;
  frames: number;
  /** POSE_FLOATS per frame: x, y, z (mm, local), qx, qy, qz, qw (local rotation). */
  data: string;
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(text: string): Uint8Array {
  const bin = atob(text);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** A track from its frames (POSE_FLOATS each, f32). */
export function makeTrack(fps: number, samples: ArrayLike<number>): PhysicsTrack {
  const floats = Float32Array.from(samples);
  const bytes = new Uint8Array(floats.length * 4);
  const view = new DataView(bytes.buffer);
  floats.forEach((v, i) => view.setFloat32(i * 4, v, true));
  return { fps, frames: Math.floor(floats.length / POSE_FLOATS), data: toBase64(bytes) };
}

const decoded = new WeakMap<PhysicsTrack, Float32Array>();

/** The floats of a track (decoded once per track object); null when it is damaged. */
export function trackFloats(track: PhysicsTrack): Float32Array | null {
  const hit = decoded.get(track);
  if (hit) return hit;
  let bytes: Uint8Array;
  try {
    bytes = fromBase64(track.data);
  } catch {
    return null;
  }
  if (bytes.length !== track.frames * POSE_FLOATS * 4 || track.frames < 1) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = new Float32Array(track.frames * POSE_FLOATS);
  for (let i = 0; i < out.length; i++) out[i] = view.getFloat32(i * 4, true);
  for (const v of out) if (!Number.isFinite(v)) return null;
  decoded.set(track, out);
  return out;
}

/** A track is well formed: fps and frames positive integers, data of that many finite frames. */
export function isTrack(x: unknown): x is PhysicsTrack {
  const t = x as Partial<PhysicsTrack> | null;
  return (
    !!t &&
    typeof t === 'object' &&
    typeof t.fps === 'number' &&
    t.fps > 0 &&
    Number.isInteger(t.frames) &&
    (t.frames ?? 0) >= 1 &&
    typeof t.data === 'string' &&
    trackFloats(t as PhysicsTrack) !== null
  );
}

/**
 * The pose of a track at `u` in [0, 1] of its length: the position interpolated linearly between the two frames
 * around it, the rotation by normalised linear interpolation of the quaternions (the shorter way). Euler angles
 * in degrees (XYZ, the convention of the scene), closest to `prev`.
 */
export function trackPose(track: PhysicsTrack, u: number, prev?: Transform, anchor?: ClipAnchor): { position: Vec3; rotation: Vec3 } | null {
  const f = trackFloats(track);
  if (!f) return null;
  const last = track.frames - 1;
  const x = clamp(u, 0, 1) * last;
  const i = Math.min(last, Math.floor(x));
  const j = Math.min(last, i + 1);
  const k = x - i;
  const a = i * POSE_FLOATS;
  const b = j * POSE_FLOATS;
  const position: Vec3 = [f[a] + (f[b] - f[a]) * k, f[a + 1] + (f[b + 1] - f[a + 1]) * k, f[a + 2] + (f[b + 2] - f[a + 2]) * k];
  const dot = f[a + 3] * f[b + 3] + f[a + 4] * f[b + 4] + f[a + 5] * f[b + 5] + f[a + 6] * f[b + 6];
  const s = dot < 0 ? -1 : 1;
  const q = [0, 1, 2, 3].map((c) => f[a + 3 + c] + (s * f[b + 3 + c] - f[a + 3 + c]) * k);
  const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  const m = quatMatrix([q[0] / l, q[1] / l, q[2] / l, q[3] / l]);
  if (prev && anchor && !sameRigid(prev, anchor)) {
    // The node has been moved since the recording: the frames go with it (B · A⁻¹ · frame, without scales).
    m[12] = position[0];
    m[13] = position[1];
    m[14] = position[2];
    const moved = mat4Multiply(mat4Multiply(mat4Compose(prev.position, prev.rotation, [1, 1, 1]), mat4Invert(mat4Compose(anchor.position, anchor.rotation, [1, 1, 1]))), m);
    return { position: [moved[12], moved[13], moved[14]], rotation: decomposeMatrix(moved, prev).rotation };
  }
  const t = decomposeMatrix(m, prev);
  return { position, rotation: t.rotation };
}

function sameRigid(a: ClipAnchor, b: ClipAnchor): boolean {
  for (let k = 0; k < 3; k++) if (a.position[k] !== b.position[k] || a.rotation[k] !== b.rotation[k]) return false;
  return true;
}

/** A node's position and rotation, the anchor of a PHYSICS clip. */
export function anchorOf(t: Transform): ClipAnchor {
  return { position: [t.position[0], t.position[1], t.position[2]], rotation: [t.rotation[0], t.rotation[1], t.rotation[2]] };
}

/** A well-formed anchor (two finite triples). */
export function isAnchor(v: unknown): v is ClipAnchor {
  const triple = (x: unknown) => Array.isArray(x) && x.length === 3 && x.every((n) => typeof n === 'number' && Number.isFinite(n));
  return typeof v === 'object' && v !== null && triple((v as ClipAnchor).position) && triple((v as ClipAnchor).rotation);
}

/** The local pose (x, y, z, qx, qy, qz, qw) of body `i`'s mover for a pose of the world. */
export function moverSample(spec: PhysicsSpec, i: number, initial: ArrayLike<number>, poses: ArrayLike<number>, at: number): number[] {
  const local = moverLocal(spec, i, initial, poses, at);
  const q = matrixQuat(local);
  return [local[12], local[13], local[14], q[0], q[1], q[2], q[3]];
}

/**
 * A track that grows a frame at a time. Base64 of bytes cut at a multiple of three is the base64 of the parts, so
 * only the bytes after the last such cut are encoded again; each `track()` is a new object whose floats are known.
 */
export class TrackWriter {
  private floats = new Float32Array(64 * POSE_FLOATS);
  private count = 0;
  private bytes = new Uint8Array(0);
  private encoded = '';
  /** Bytes already in `encoded` (a multiple of 3). */
  private done = 0;

  constructor(readonly fps: number) {}

  get frames(): number {
    return this.count;
  }

  push(sample: ArrayLike<number>): void {
    if ((this.count + 1) * POSE_FLOATS > this.floats.length) {
      const grown = new Float32Array(this.floats.length * 2);
      grown.set(this.floats);
      this.floats = grown;
    }
    for (let k = 0; k < POSE_FLOATS; k++) this.floats[this.count * POSE_FLOATS + k] = Math.fround(sample[k]);
    this.count++;
  }

  /** The track so far. */
  track(): PhysicsTrack {
    const n = this.count * POSE_FLOATS * 4;
    if (this.bytes.length < n) {
      const grown = new Uint8Array(Math.max(n, this.bytes.length * 2));
      grown.set(this.bytes.subarray(0, this.done));
      this.bytes = grown;
    }
    const view = new DataView(this.bytes.buffer);
    for (let i = this.done / 4 | 0; i < this.count * POSE_FLOATS; i++) view.setFloat32(i * 4, this.floats[i], true);
    const cut = n - (n % 3);
    if (cut > this.done) {
      this.encoded += toBase64(this.bytes.subarray(this.done, cut));
      this.done = cut;
    }
    const tail = n > this.done ? toBase64(this.bytes.subarray(this.done, n)) : '';
    const track: PhysicsTrack = { fps: this.fps, frames: this.count, data: this.encoded + tail };
    decoded.set(track, this.floats.slice(0, this.count * POSE_FLOATS));
    return track;
  }
}

/**
 * S3b: the PHYSICS clip of a camera's front glass fed by the scene, starting at `start` seconds, with its glass track so
 * far. It targets the camera (every shot: the glass is the camera's) and moves nothing: the pose says which frame of
 * the glass shows (core/animation.ts `Pose.glass`).
 */
export function glassClip(id: string, start: number, glass: GlassTrack): MotionClip {
  return {
    id,
    target: { kind: 'CAMERA' },
    move: 'PHYSICS',
    shot: null,
    start,
    duration: Math.max(0, glass.frames - 1) / glass.fps,
    amount: 0,
    easing: 'LINEAR',
    glass,
  };
}

/**
 * S3c: the PHYSICS clip of the rain, dust and snow on the parts, starting at `start` seconds, with its track so far. It
 * targets the scene and moves nothing: the pose says which frame the parts show (core/animation.ts `Pose.parts`).
 */
export function partsClip(id: string, start: number, parts: PartsTrack): MotionClip {
  return {
    id,
    target: { kind: 'SCENE' },
    move: 'PHYSICS',
    shot: null,
    start,
    duration: Math.max(0, parts.frames - 1) / parts.fps,
    amount: 0,
    easing: 'LINEAR',
    parts,
  };
}

/** A PHYSICS clip of a mover, starting at `start` seconds, with its track so far. */
export function physicsClip(id: string, mover: NodeId, start: number, track: PhysicsTrack, anchor?: ClipAnchor): MotionClip {
  return {
    id,
    target: { kind: 'NODE', id: mover },
    move: 'PHYSICS',
    shot: null,
    start,
    duration: Math.max(0, track.frames - 1) / track.fps,
    amount: 0,
    easing: 'LINEAR',
    track,
    ...(anchor ? { anchor: { position: [...anchor.position] as Vec3, rotation: [...anchor.rotation] as Vec3 } } : {}),
  };
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export type PhysicsAction =
  /** The Physics section of the inspector: merges `patch` into the nodes' properties (`density: null` clears it). */
  | ({ type: 'physics/set'; ids: NodeId[]; patch: PhysicsPatch } & ActionBase)
  /** A simulation starts: its PHYSICS clips (one frame each), and the roles Drop gives. */
  | ({ type: 'physics/begin'; clips: MotionClip[]; roles?: Record<NodeId, PhysicsRole> } & ActionBase)
  /** It runs: the clips' tracks so far (their durations follow), and S3b's glass tracks. Same gesture as `begin`. */
  | ({ type: 'physics/grow'; tracks: Record<string, PhysicsTrack>; glass?: Record<string, GlassTrack>; parts?: Record<string, PartsTrack> } & ActionBase)
  /**
   * It stopped (by itself or by Stop): the movers' final transforms, and the run's clips (`clips`) anchored to them.
   * Same gesture: one undo step for all.
   */
  | ({ type: 'physics/commit'; transforms: Record<NodeId, Transform>; clips?: string[] } & ActionBase)
  /** Reset: the transforms the movers had before, and the simulation's clips taken away. A step of its own. */
  | ({ type: 'physics/reset'; transforms: Record<NodeId, Transform>; clips: string[] } & ActionBase);

/** U16: a value that is the default of its field (stored as nothing), or one the field cannot take. */
function clears(k: keyof PhysicsProps, v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (k === 'getsWet' || k === 'getsDust') return v !== false;
  if (k === 'surface') return !isWettabilityFamily(v);
  return false;
}

function setProps(nodes: Record<NodeId, SceneNode>, id: NodeId, patch: PhysicsPatch): boolean {
  const node = nodes[id];
  if (!node) return false;
  const next: PhysicsProps = { ...(node.physics ?? {}) };
  for (const [k, v] of Object.entries(patch) as [keyof PhysicsProps, unknown][]) {
    if (clears(k, v)) delete next[k];
    else (next as Record<string, unknown>)[k] = v;
  }
  const same = JSON.stringify(next) === JSON.stringify(node.physics ?? {});
  if (same) return false;
  const copy: SceneNode = { ...node };
  if (Object.keys(next).length > 0) copy.physics = next;
  else delete copy.physics;
  nodes[id] = copy;
  return true;
}

function withTransforms(state: ProjectState, transforms: Record<NodeId, Transform>, roles?: Record<NodeId, PhysicsRole>): ProjectState {
  let nodes: Record<NodeId, SceneNode> | null = null;
  for (const [id, t] of Object.entries(transforms)) {
    const node = (nodes ?? state.scene.nodes)[id];
    if (!node) continue;
    nodes ??= { ...state.scene.nodes };
    nodes[id] = { ...node, transform: cloneTransform(t) };
  }
  for (const [id, role] of Object.entries(roles ?? {})) {
    nodes ??= { ...state.scene.nodes };
    setProps(nodes, id, { role });
  }
  return nodes ? { ...state, scene: { ...state.scene, nodes } } : state;
}

export function reducePhysics(state: ProjectState, action: PhysicsAction): ProjectState {
  switch (action.type) {
    case 'physics/set': {
      const nodes = { ...state.scene.nodes };
      let changed = false;
      for (const id of action.ids) changed = setProps(nodes, id, action.patch) || changed;
      return changed ? { ...state, scene: { ...state.scene, nodes } } : state;
    }
    case 'physics/begin': {
      const next = withTransforms(state, {}, action.roles);
      if (action.clips.length === 0) return next;
      const anim = next.animation;
      const taken = new Set(anim.clips.map((c) => c.id));
      const fresh = action.clips.filter((c) => !taken.has(c.id));
      return { ...next, animation: { ...anim, clips: [...anim.clips, ...fresh] } };
    }
    case 'physics/grow': {
      const anim = state.animation;
      let changed = false;
      const clips = anim.clips.map((c) => {
        const glass = action.glass?.[c.id];
        if (glass && c.move === 'PHYSICS' && c.glass !== glass) {
          changed = true;
          return { ...c, glass, duration: Math.max(0, glass.frames - 1) / glass.fps };
        }
        const parts = action.parts?.[c.id];
        if (parts && c.move === 'PHYSICS' && c.parts !== parts) {
          changed = true;
          return { ...c, parts, duration: Math.max(0, parts.frames - 1) / parts.fps };
        }
        const track = action.tracks[c.id];
        if (!track || c.move !== 'PHYSICS' || c.track === track) return c;
        changed = true;
        return { ...c, track, duration: Math.max(0, track.frames - 1) / track.fps };
      });
      return changed ? { ...state, animation: { ...anim, clips } } : state;
    }
    case 'physics/commit': {
      const next = withTransforms(state, action.transforms);
      const ids = new Set(action.clips ?? []);
      if (ids.size === 0) return next;
      const nodes = next.scene.nodes;
      const clips = next.animation.clips.map((c) => {
        const node = c.target.kind === 'NODE' ? nodes[c.target.id] : undefined;
        return ids.has(c.id) && c.move === 'PHYSICS' && node ? { ...c, anchor: anchorOf(node.transform) } : c;
      });
      return { ...next, animation: { ...next.animation, clips } };
    }
    case 'physics/reset': {
      const next = withTransforms(state, action.transforms);
      const gone = new Set(action.clips);
      const clips = next.animation.clips.filter((c) => !gone.has(c.id));
      return clips.length === next.animation.clips.length ? next : { ...next, animation: { ...next.animation, clips } };
    }
    default:
      return state;
  }
}
