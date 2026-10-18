// Liquids (phase S7, SPEC §3.1 "Liquids"): a part turned into liquid, the scene the simulator is given (LIQ1), the
// recorded run (a PHYSICS clip's liquid track: the cache) and the surface each frame shows. Pure functions over
// ProjectState and the store's `liquid/` actions.
//
// **Convert to liquid** (`liquid/convert`, one undo step): the part is hidden and a *Liquid* part is born at the top
// of the tree, with the part's shape in world space (its own mesh, so moving the source afterwards changes nothing),
// role LIQUID, the preset's look as its material and the preset's motion (data/liquids.ts). Until a run records it,
// it shows that shape; the simulator fills it with particles by ray parity when a run starts (rt_phys::liquid::fill).
//
// **The run.** Start (ui/physics.ts) hands the physics worker the LIQ1 of every visible liquid: its mesh and spacing,
// its preset's motion, and every other visible part that does not move in the run, as its containers (the floor is
// always there). The worker steps the liquids with the bodies and, at every frame of the project's fps, sends each
// liquid's frame record (rt_phys::liquid `frame_bytes`: its particles in 16 bits) and the surface rebuilt from it by
// marching cubes (`mesh_from_frame`). The records grow the liquid's PHYSICS clip (`MotionClip.liquid`, this track):
// the cache, saved with the project and keyed by the LIQ1's FNV-1a.
//
// **The surface of a frame.** The pose says which frame of which clip a liquid shows (core/animation.ts
// `Pose.liquids`); `posedLiquidMesh` gives the mesh of that frame: the one the worker sent while the run went on, or
// rebuilt from the record by the page's own rt.wasm (`setLiquidSurfacer`, the same function) when it is not in hand
// (a project opened, a frame scrubbed to long after). The Fast preview and the render draw that mesh as the part's.

import { CONTAINER_PRIORITY, DEFAULT_LIQUID, LIQUID_PRIORITY, LIQUID_SPACING_LIMITS, LIQUID_TARGET_PARTICLES, liquidPreset, type LiquidPreset } from '../data/liquids';
import type { MotionClip } from './animation';
import { nextId } from './ids';
import { instanceFromPreset, type MaterialId, type MaterialInstance } from './materials';
import { mat4Invert, type Mat4 } from './math';
import { getMesh, hasMesh, registerMesh, unregisterMesh, type MeshData, type MeshId } from './meshes';
import { defaultTextures } from './textures';
import { effectiveVisible, partsUnder, worldMatrix, type NodeId, type SceneNode } from './scene';
import type { ActionBase, ProjectState } from './store';
import type { Pose } from './animation';
import { WEAR_PROP_DEFAULTS } from '../data/wear';

/** The Liquid section of a liquid part. */
export interface LiquidProps {
  /** Its preset (data/liquids.ts), how it moves (and how it looked when it was made). */
  preset: string;
  /** The particle spacing, mm; absent: from the part's volume (`autoSpacing`). */
  spacingMm?: number;
  /** The part it was made from (hidden), or null when that part is gone. */
  source?: NodeId | null;
}

/** A part that is a liquid. */
export function isLiquid(node: SceneNode | undefined): boolean {
  return !!node?.liquid && node.kind === 'PART';
}

/** The visible liquid parts, in tree order. */
export function liquidParts(state: ProjectState): NodeId[] {
  return partsUnder(state, state.scene.roots).filter((p) => isLiquid(state.scene.nodes[p]) && effectiveVisible(state, p) && !!state.scene.nodes[p].mesh);
}

/** The scene has a liquid part. */
export function hasLiquid(state: ProjectState): boolean {
  return Object.values(state.scene.nodes).some(isLiquid);
}

/** The preset of a liquid part (the default one for an unknown key). */
export function presetOf(node: SceneNode | undefined): LiquidPreset {
  return liquidPreset(node?.liquid?.preset ?? DEFAULT_LIQUID) ?? liquidPreset(DEFAULT_LIQUID)!;
}

// ---------------------------------------------------------------------------
// Volume and spacing
// ---------------------------------------------------------------------------

/** The volume a closed, outward mesh encloses under `m`, mm³ (the divergence theorem over its triangles). */
export function meshVolume(data: MeshData, m?: Mat4): number {
  const p = data.positions;
  const at = (i: number): [number, number, number] => {
    const x = p[3 * i];
    const y = p[3 * i + 1];
    const z = p[3 * i + 2];
    if (!m) return [x, y, z];
    return [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
  };
  let sum = 0;
  const idx = data.indices;
  for (let t = 0; t + 2 < idx.length; t += 3) {
    const a = at(idx[t]);
    const b = at(idx[t + 1]);
    const c = at(idx[t + 2]);
    sum += a[0] * (b[1] * c[2] - b[2] * c[1]) + a[1] * (b[2] * c[0] - b[0] * c[2]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
  }
  return sum / 6;
}

/** The spacing a part of `volume` mm³ is filled at without one of its own: about LIQUID_TARGET_PARTICLES particles (◆). */
export function autoSpacing(volume: number): number {
  const v = Math.abs(volume);
  if (!(v > 0)) return LIQUID_SPACING_LIMITS.min;
  const s = Math.cbrt(v / LIQUID_TARGET_PARTICLES);
  return Math.min(LIQUID_SPACING_LIMITS.max, Math.max(LIQUID_SPACING_LIMITS.min, Math.round(s * 100) / 100));
}

/** The volume of a liquid part, mm³ (its mesh in the world). */
export function liquidVolume(state: ProjectState, id: NodeId): number {
  const node = state.scene.nodes[id];
  const data = node?.mesh ? getMesh(node.mesh.id) : undefined;
  return data ? Math.abs(meshVolume(data, worldMatrix(state, id))) : 0;
}

/** The spacing a liquid part is filled at: its own, or from its volume. */
export function liquidSpacing(state: ProjectState, id: NodeId): number {
  const own = state.scene.nodes[id]?.liquid?.spacingMm;
  if (typeof own === 'number' && Number.isFinite(own) && own > 0) return Math.min(LIQUID_SPACING_LIMITS.max, Math.max(LIQUID_SPACING_LIMITS.min, own));
  return autoSpacing(liquidVolume(state, id));
}

// ---------------------------------------------------------------------------
// Priorities (nested dielectrics, ◆)
// ---------------------------------------------------------------------------

/** A material's own nested-dielectric priority (its GLASS `priority` parameter, 0 when absent). */
export function ownPriority(inst: MaterialInstance | undefined): number {
  const p = inst?.params?.priority;
  return typeof p === 'number' && Number.isFinite(p) && p > 0 ? Math.round(p) : 0;
}

/**
 * The priority a material is rendered with: its own when it has one; else, in a scene with a liquid, LIQUID_PRIORITY for
 * a material a liquid wears and CONTAINER_PRIORITY for any other clear solid of the GLASS family (the glass holds the
 * liquid); else 0. A scene where every material renders at 0 is traced as before S7.
 */
export function renderedPriority(state: ProjectState, id: MaterialId | null): number {
  const inst = id ? state.materials[id] : undefined;
  const own = ownPriority(inst);
  if (own > 0 || !inst) return own;
  if (!hasLiquid(state)) return 0;
  const worn = Object.values(state.scene.nodes).some((n) => isLiquid(n) && n.material === id);
  if (worn) return LIQUID_PRIORITY;
  const p = inst.params;
  const clear = inst.family === 'GLASS' && p.walls !== 'THIN' && (typeof p.transmission !== 'number' || p.transmission > 0);
  return clear ? CONTAINER_PRIORITY : 0;
}

// ---------------------------------------------------------------------------
// LIQ1: the scene the simulator is given (rt_phys::liquid `LiquidSpec`)
// ---------------------------------------------------------------------------

/** LIQ1 version this page writes (rt_phys::liquid `VERSION`). */
export const LIQ1_VERSION = 1;
/** Bumped when the record or the simulator changes what a key stands for. */
export const LIQUID_FORMAT_VERSION = 1;

/** What a run of liquids is given: the LIQ1 bytes, its key, and the liquid parts in their order there. */
export interface LiquidRunSpec {
  bytes: Uint8Array;
  key: string;
  nodes: NodeId[];
}

class Writer {
  private buf = new ArrayBuffer(1024);
  private view = new DataView(this.buf);
  len = 0;
  private room(n: number): void {
    if (this.len + n <= this.buf.byteLength) return;
    const grown = new ArrayBuffer(Math.max(this.buf.byteLength * 2, this.len + n));
    new Uint8Array(grown).set(new Uint8Array(this.buf, 0, this.len));
    this.buf = grown;
    this.view = new DataView(grown);
  }
  u32(v: number): void {
    this.room(4);
    this.view.setUint32(this.len, v >>> 0, true);
    this.len += 4;
  }
  f32(v: number): void {
    this.room(4);
    this.view.setFloat32(this.len, Number.isFinite(v) ? v : 0, true);
    this.len += 4;
  }
  ascii(s: string): void {
    for (let i = 0; i < s.length; i++) {
      this.room(1);
      this.view.setUint8(this.len++, s.charCodeAt(i));
    }
  }
  bytes(): Uint8Array {
    return new Uint8Array(this.buf.slice(0, this.len));
  }
}

/** The three rows of the 3 × 4 object-to-world matrix of a Mat4 (column-major). */
function rows(m: Mat4): number[] {
  return [m[0], m[4], m[8], m[12], m[1], m[5], m[9], m[13], m[2], m[6], m[10], m[14]];
}

/** FNV-1a of LIQ1 bytes: the key of a recorded run. */
export function liquidKey(bytes: Uint8Array): string {
  let h = 0x811c9dc5;
  for (const b of bytes) h = Math.imul(h ^ b, 0x01000193) >>> 0;
  return `liq${LIQUID_FORMAT_VERSION}:${h.toString(16).padStart(8, '0')}`;
}

/**
 * The LIQ1 of the scene's visible liquids, with every other visible part that `moving` does not hold as a container,
 * and the floor at z = 0 (the studio floor is always there for the simulator, data/physics.ts). Null without a liquid.
 */
export function liquidRunSpec(state: ProjectState, moving: ReadonlySet<NodeId> = new Set()): LiquidRunSpec | null {
  const liquids = liquidParts(state).filter((id) => !moving.has(id));
  if (liquids.length === 0) return null;
  const cache = new Map<NodeId, Mat4>();
  const meshes: MeshId[] = [];
  const meshIndex = new Map<MeshId, number>();
  const use = (id: MeshId): number => {
    let i = meshIndex.get(id);
    if (i === undefined) {
      i = meshes.push(id) - 1;
      meshIndex.set(id, i);
    }
    return i;
  };
  const statics: { mesh: number; m: Mat4 }[] = [];
  for (const p of partsUnder(state, state.scene.roots)) {
    const node = state.scene.nodes[p];
    if (!node?.mesh || isLiquid(node) || moving.has(p) || !effectiveVisible(state, p) || !getMesh(node.mesh.id)) continue;
    statics.push({ mesh: use(node.mesh.id), m: worldMatrix(state, p, cache) });
  }
  const sources = liquids.map((id) => ({ id, mesh: use(state.scene.nodes[id].mesh!.id), m: worldMatrix(state, id, cache), spacing: liquidSpacing(state, id), preset: presetOf(state.scene.nodes[id]) }));
  const w = new Writer();
  w.ascii('LIQ1');
  w.u32(LIQ1_VERSION);
  w.u32(meshes.length);
  for (const id of meshes) {
    const data = getMesh(id)!;
    w.u32(data.positions.length / 3);
    w.u32(data.indices.length);
    for (const v of data.positions) w.f32(v);
    for (const i of data.indices) w.u32(i);
  }
  w.u32(statics.length);
  for (const s of statics) {
    w.u32(s.mesh);
    for (const v of rows(s.m)) w.f32(v);
  }
  w.u32(1);
  w.f32(0);
  w.u32(sources.length);
  for (const s of sources) {
    w.u32(s.mesh);
    for (const v of rows(s.m)) w.f32(v);
    w.f32(s.spacing);
    for (const v of [s.preset.density, s.preset.viscosity, s.preset.cohesion, s.preset.surfaceTension, s.preset.adhesion]) w.f32(v);
  }
  const bytes = w.bytes();
  return { bytes, key: liquidKey(bytes), nodes: liquids };
}

// ---------------------------------------------------------------------------
// The record of a run (the cache)
// ---------------------------------------------------------------------------

/** Bytes of a frame record before its particles (rt_phys::liquid `FRAME_HEADER`). */
export const FRAME_HEADER = 36;

/** The length of a frame record of `n` particles (rt_phys::liquid `frame_len`): whole groups of 12 bytes. */
export function frameLength(n: number): number {
  return Math.ceil((FRAME_HEADER + 6 * n) / 12) * 12;
}

/** The recorded liquid of a run: every frame's record (the same length each), one after another, base64. */
export interface LiquidTrack {
  fps: number;
  frames: number;
  /** The run's key (`liquidKey` of its LIQ1). */
  key: string;
  /** The liquid part it records. */
  node: NodeId;
  /** Particles (the engine's fill of the part). */
  particles: number;
  /** Their spacing, mm (the fill's). */
  spacing: number;
  /** Bytes per frame record. */
  record: number;
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

/** The particles and spacing a frame record says, or null when it is not one. */
export function readRecordHeader(record: Uint8Array): { particles: number; spacing: number } | null {
  if (record.length < FRAME_HEADER || String.fromCharCode(record[0], record[1], record[2], record[3]) !== 'LQF1') return null;
  const view = new DataView(record.buffer, record.byteOffset, record.byteLength);
  const particles = view.getUint32(4, true);
  if (record.length !== frameLength(particles)) return null;
  return { particles, spacing: view.getFloat32(8, true) };
}

/** A liquid track that grows a frame at a time (each record is whole groups of base64: appended as is). */
export class LiquidTrackWriter {
  private parts: string[] = [];
  private count = 0;
  private record = 0;
  private particles = 0;
  private spacing = 0;

  constructor(
    readonly fps: number,
    readonly key: string,
    readonly node: NodeId,
  ) {}

  get frames(): number {
    return this.count;
  }

  /** Particles of the run (0 before the first frame). */
  get particleCount(): number {
    return this.particles;
  }

  /** Appends a frame; throws on a record that is not one, or of another length than the first. */
  push(record: Uint8Array): void {
    const head = readRecordHeader(record);
    if (!head) throw new Error('liquid record: not a frame record');
    if (this.count === 0) {
      this.record = record.length;
      this.particles = head.particles;
      this.spacing = head.spacing;
    } else if (record.length !== this.record) throw new Error('liquid record: a frame of another length');
    this.parts.push(toBase64(record));
    this.count++;
  }

  track(): LiquidTrack {
    if (this.parts.length > 1) this.parts = [this.parts.join('')];
    return { fps: this.fps, frames: this.count, key: this.key, node: this.node, particles: this.particles, spacing: this.spacing, record: this.record, data: this.parts[0] ?? '' };
  }
}

/** The frame of a track at `u` in [0, 1] of its length (the nearest recorded frame). */
export function liquidFrameIndex(track: Pick<LiquidTrack, 'frames'>, u: number): number {
  return Math.round(Math.max(0, Math.min(1, u)) * (track.frames - 1));
}

/** The record of frame `k` of a track, or null when the track is damaged. */
export function liquidRecord(track: LiquidTrack, k: number): Uint8Array | null {
  if (!(track.record > 0) || track.record % 12 !== 0 || k < 0 || k >= track.frames) return null;
  const chars = (track.record / 3) * 4;
  const text = track.data.slice(k * chars, (k + 1) * chars);
  if (text.length !== chars) return null;
  let bytes: Uint8Array;
  try {
    bytes = fromBase64(text);
  } catch {
    return null;
  }
  return readRecordHeader(bytes) ? bytes : null;
}

/** A well-formed liquid track (its every frame a record of the same length). */
export function isLiquidTrack(x: unknown): x is LiquidTrack {
  const t = x as Partial<LiquidTrack> | null;
  if (!t || typeof t !== 'object') return false;
  if (typeof t.fps !== 'number' || !(t.fps > 0) || !Number.isInteger(t.frames) || (t.frames ?? 0) < 1) return false;
  if (typeof t.key !== 'string' || typeof t.node !== 'string' || typeof t.data !== 'string') return false;
  if (!Number.isInteger(t.particles) || !Number.isInteger(t.record) || typeof t.spacing !== 'number') return false;
  if (t.record !== frameLength(t.particles!) || t.data.length !== (t.record! / 3) * 4 * t.frames!) return false;
  return liquidRecord(t as LiquidTrack, 0) !== null && liquidRecord(t as LiquidTrack, t.frames! - 1) !== null;
}

/** A PHYSICS clip of a liquid part, starting at `start` seconds, with its track so far. It moves nothing. */
export function liquidClip(id: string, node: NodeId, start: number, track: LiquidTrack): MotionClip {
  return {
    id,
    target: { kind: 'NODE', id: node },
    move: 'PHYSICS',
    shot: null,
    start,
    duration: Math.max(0, track.frames - 1) / track.fps,
    amount: 0,
    easing: 'LINEAR',
    liquid: track,
  };
}

// ---------------------------------------------------------------------------
// The surface of a frame
// ---------------------------------------------------------------------------

/** Builds the surface of a frame record (the page's rt.wasm, `liq_mesh`), or null without one. */
export type LiquidSurfacer = (record: Uint8Array) => MeshData | null;

let surfacer: LiquidSurfacer | null = null;

/** main.ts hands the page's module's surfacer here once it is loaded (null: none). */
export function setLiquidSurfacer(s: LiquidSurfacer | null): void {
  surfacer = s;
}

export function hasLiquidSurfacer(): boolean {
  return surfacer !== null;
}

/** The meshes of recorded frames kept registered, the most recent last. */
const MAX_FRAME_MESHES = 48;
const frameMeshes: MeshId[] = [];

function frameMeshId(track: Pick<LiquidTrack, 'key' | 'node'>, frame: number): MeshId {
  return `liquid:${track.key}:${track.node}:${frame}`;
}

function remember(id: MeshId): void {
  const at = frameMeshes.indexOf(id);
  if (at >= 0) frameMeshes.splice(at, 1);
  frameMeshes.push(id);
  while (frameMeshes.length > MAX_FRAME_MESHES) unregisterMesh(frameMeshes.shift()!);
}

/** The bytes of a surface (rt_phys::liquid `SurfaceMesh::to_bytes`) as mesh data, or null when they are not one. */
export function surfaceMesh(bytes: Uint8Array): MeshData | null {
  if (bytes.length < 8) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const nv = view.getUint32(0, true);
  const ni = view.getUint32(4, true);
  if (bytes.length !== 8 + 24 * nv + 4 * ni || ni % 3 !== 0) return null;
  const positions = new Float32Array(3 * nv);
  const normals = new Float32Array(3 * nv);
  const indices = new Uint32Array(ni);
  for (let i = 0; i < 3 * nv; i++) positions[i] = view.getFloat32(8 + 4 * i, true);
  for (let i = 0; i < 3 * nv; i++) normals[i] = view.getFloat32(8 + 12 * nv + 4 * i, true);
  for (let i = 0; i < ni; i++) {
    const v = view.getUint32(8 + 24 * nv + 4 * i, true);
    if (v >= nv) return null;
    indices[i] = v;
  }
  return { positions, normals, indices };
}

/** The worker's surface of frame `frame` of a run (the same the record rebuilds to): registered for the pose. */
export function putLiquidMesh(state: ProjectState, track: Pick<LiquidTrack, 'key' | 'node'>, frame: number, data: MeshData): MeshId {
  const id = frameMeshId(track, frame);
  registerMesh(id, inPart(state, track.node, data));
  remember(id);
  return id;
}

/** World-space surface data in the frame of liquid part `node` (as it is: its matrix is the identity until it moves). */
function inPart(state: ProjectState, node: NodeId, data: MeshData): MeshData {
  const m = worldMatrix(state, node);
  return m.every((v, i) => v === (i % 5 === 0 ? 1 : 0)) ? data : toLocal(data, mat4Invert(m));
}

/** The recorded liquids the pose shows: per liquid part, the track and the frame. */
export function recordedLiquid(state: ProjectState, pose: Pose | null, node: NodeId): { track: LiquidTrack; frame: number } | null {
  const lp = pose?.liquids?.[node];
  const clip = lp ? state.animation.clips.find((c) => c.id === lp.clip) : undefined;
  if (!lp || !clip?.liquid || clip.liquid.node !== node) return null;
  return { track: clip.liquid, frame: Math.max(0, Math.min(clip.liquid.frames - 1, lp.frame)) };
}

/**
 * The mesh a liquid part shows at the pose: the surface of its recorded frame (in hand, or rebuilt from the record by
 * the page's module), or null for its own mesh (no recording at the pose, or no module to rebuild it with).
 */
export function posedLiquidMesh(state: ProjectState, pose: Pose | null, node: NodeId): MeshId | null {
  const rec = recordedLiquid(state, pose, node);
  if (!rec) return null;
  const id = frameMeshId(rec.track, rec.frame);
  if (hasMesh(id)) {
    remember(id);
    return id;
  }
  if (!surfacer) return null;
  const record = liquidRecord(rec.track, rec.frame);
  const data = record ? surfacer(record) : null;
  if (!data) return null;
  // The frames are world space and the liquid part's matrix places them (it is the identity until the part is moved:
  // then the recorded liquid moves with it, as a recorded fall does).
  registerMesh(id, inPart(state, node, data));
  remember(id);
  return id;
}

/** World-space mesh data in the frame of a part whose world matrix is the inverse of `inv`. */
function toLocal(data: MeshData, inv: Mat4): MeshData {
  const p = data.positions;
  const n = data.normals;
  const positions = new Float32Array(p.length);
  const normals = new Float32Array(n.length);
  for (let i = 0; i < p.length; i += 3) {
    positions[i] = inv[0] * p[i] + inv[4] * p[i + 1] + inv[8] * p[i + 2] + inv[12];
    positions[i + 1] = inv[1] * p[i] + inv[5] * p[i + 1] + inv[9] * p[i + 2] + inv[13];
    positions[i + 2] = inv[2] * p[i] + inv[6] * p[i + 1] + inv[10] * p[i + 2] + inv[14];
    // Normals by the inverse transpose of the inverse (the matrix itself, transposed back).
    const x = inv[0] * n[i] + inv[1] * n[i + 1] + inv[2] * n[i + 2];
    const y = inv[4] * n[i] + inv[5] * n[i + 1] + inv[6] * n[i + 2];
    const z = inv[8] * n[i] + inv[9] * n[i + 1] + inv[10] * n[i + 2];
    const l = Math.hypot(x, y, z) || 1;
    normals[i] = x / l;
    normals[i + 1] = y / l;
    normals[i + 2] = z / l;
  }
  return { positions, normals, indices: data.indices };
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export type LiquidAction =
  /** Convert to liquid: the part is hidden and a liquid part of `preset` is born from its shape. One undo step. */
  | ({ type: 'liquid/convert'; source: NodeId; preset: string } & ActionBase)
  /** The Liquid section: a new preset (its motion, and its look on the liquid's material) or spacing (`null`: auto). */
  | ({ type: 'liquid/set'; ids: NodeId[]; preset?: string; spacingMm?: number | null } & ActionBase);

/** The material a liquid of `preset` looks like: the catalogue's recipe it names, or its own look (GLASS family). */
export function liquidMaterial(id: MaterialId, preset: LiquidPreset, lang: 'en' | 'es', partSizeMm: number): MaterialInstance {
  if (preset.material) {
    const inst = instanceFromPreset(id, preset.material, partSizeMm);
    if (inst) return inst;
  }
  const look = preset.look ?? { baseColor: [1, 1, 1, 1], roughness: 0, ior: 1.333, transmission: 1, absorptionMm: 0 };
  return {
    id,
    name: preset.label[lang],
    preset: null,
    origin: null,
    edited: false,
    family: 'GLASS',
    category: 'OTHER',
    params: { walls: 'SOLID', scatterMm: 0, scatterColor: [1, 1, 1, 1], scatterG: 0, abbe: 0, ...structuredClone(look) },
    wear: { ...WEAR_PROP_DEFAULTS, amount: 0 },
    textures: defaultTextures(),
    bevelRadiusMm: 0,
  };
}

/** The part's mesh in world space (positions by its world matrix, normals by the inverse transpose). */
function worldMesh(data: MeshData, m: Mat4): MeshData {
  const inv = mat4Invert(m);
  const p = data.positions;
  const n = data.normals;
  const positions = new Float32Array(p.length);
  const normals = new Float32Array(n.length);
  for (let i = 0; i < p.length; i += 3) {
    positions[i] = m[0] * p[i] + m[4] * p[i + 1] + m[8] * p[i + 2] + m[12];
    positions[i + 1] = m[1] * p[i] + m[5] * p[i + 1] + m[9] * p[i + 2] + m[13];
    positions[i + 2] = m[2] * p[i] + m[6] * p[i + 1] + m[10] * p[i + 2] + m[14];
    const x = inv[0] * n[i] + inv[1] * n[i + 1] + inv[2] * n[i + 2];
    const y = inv[4] * n[i] + inv[5] * n[i + 1] + inv[6] * n[i + 2];
    const z = inv[8] * n[i] + inv[9] * n[i + 1] + inv[10] * n[i + 2];
    const l = Math.hypot(x, y, z) || 1;
    normals[i] = x / l;
    normals[i + 1] = y / l;
    normals[i + 2] = z / l;
  }
  // A mirroring matrix turns the triangles inside out: wind them back.
  const det = m[0] * (m[5] * m[10] - m[6] * m[9]) - m[4] * (m[1] * m[10] - m[2] * m[9]) + m[8] * (m[1] * m[6] - m[2] * m[5]);
  let indices = data.indices;
  if (det < 0) {
    indices = new Uint32Array(indices);
    for (let t = 0; t + 2 < indices.length; t += 3) [indices[t + 1], indices[t + 2]] = [indices[t + 2], indices[t + 1]];
  }
  return { positions, normals, indices };
}

/** The parts a Convert to liquid may take: visible parts with a mesh that are not liquid already. */
export function convertible(state: ProjectState, ids: readonly NodeId[]): NodeId[] {
  return partsUnder(state, ids.filter((id) => state.scene.nodes[id])).filter((p) => {
    const node = state.scene.nodes[p];
    return !!node?.mesh && !isLiquid(node) && effectiveVisible(state, p) && !!getMesh(node.mesh.id);
  });
}

function convert(state: ProjectState, action: Extract<LiquidAction, { type: 'liquid/convert' }>): ProjectState {
  const source = state.scene.nodes[action.source];
  const preset = liquidPreset(action.preset);
  if (!source?.mesh || isLiquid(source) || !preset) return state;
  const data = getMesh(source.mesh.id);
  if (!data) return state;
  const id = nextId('n', Object.keys(state.scene.nodes));
  const matId = nextId('m', Object.keys(state.materials));
  // The part's shape in world space, its own mesh (the same content for the same part: a redo registers it again).
  const meshId = `liquid:${id}:${source.mesh.id}`;
  const ref = registerMesh(meshId, worldMesh(data, worldMatrix(state, action.source)));
  const material = liquidMaterial(matId, preset, state.meta.lang, state.scene.partSizeMm);
  const names = Object.values(state.scene.nodes).map((n) => n.name);
  const base = `${source.name} (${preset.label[state.meta.lang]})`;
  let name = base;
  for (let k = 2; names.includes(name); k++) name = `${base} ${k}`;
  const node: SceneNode = {
    id,
    name,
    kind: 'PART',
    parent: null,
    children: [],
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    initial: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    visible: true,
    locked: false,
    mesh: ref,
    material: matId,
    smooth: true,
    physics: { role: 'LIQUID' },
    liquid: { preset: preset.key, source: action.source },
  };
  const nodes = { ...state.scene.nodes, [id]: node, [action.source]: { ...source, visible: false } };
  const level = state.selection.level === 'FACES' ? 'PART' : state.selection.level;
  return {
    ...state,
    materials: { ...state.materials, [matId]: material },
    scene: { ...state.scene, nodes, roots: [...state.scene.roots, id] },
    selection: { level, ids: [id] },
  };
}

function setLiquid(state: ProjectState, action: Extract<LiquidAction, { type: 'liquid/set' }>): ProjectState {
  let nodes: Record<NodeId, SceneNode> | null = null;
  let materials: Record<MaterialId, MaterialInstance> | null = null;
  const preset = action.preset !== undefined ? liquidPreset(action.preset) : undefined;
  for (const id of action.ids) {
    const node = (nodes ?? state.scene.nodes)[id];
    if (!isLiquid(node)) continue;
    const props: LiquidProps = { ...node.liquid! };
    if (preset) props.preset = preset.key;
    if (action.spacingMm === null) delete props.spacingMm;
    else if (typeof action.spacingMm === 'number' && Number.isFinite(action.spacingMm) && action.spacingMm > 0) props.spacingMm = Math.min(LIQUID_SPACING_LIMITS.max, Math.max(LIQUID_SPACING_LIMITS.min, action.spacingMm));
    if (JSON.stringify(props) === JSON.stringify(node.liquid)) continue;
    nodes ??= { ...state.scene.nodes };
    nodes[id] = { ...node, liquid: props };
    // A new preset brings its look to the liquid's own material (one that only liquids wear).
    const mat = node.material;
    if (preset && mat && preset.key !== node.liquid!.preset && (materials ?? state.materials)[mat]) {
      const others = Object.values(state.scene.nodes).some((n) => n.id !== id && n.material === mat && !isLiquid(n));
      if (!others) {
        materials ??= { ...state.materials };
        materials[mat] = liquidMaterial(mat, preset, state.meta.lang, state.scene.partSizeMm);
      }
    }
  }
  if (!nodes) return state;
  return { ...state, scene: { ...state.scene, nodes }, ...(materials ? { materials } : {}) };
}

export function reduceLiquid(state: ProjectState, action: LiquidAction): ProjectState {
  switch (action.type) {
    case 'liquid/convert':
      return convert(state, action);
    case 'liquid/set':
      return setLiquid(state, action);
    default:
      return state;
  }
}
