// Rain and dust on the front glass (phase S3b, SPEC §3.1 "Physics", UI.md §2.4 and §2.5): what the scene's ambient
// effects leave on the pane in front of a camera whose front glass is fed by the scene. The engine simulates it
// (engine/crates/rt-phys `wet`, through rt.wasm's `wet_*` in the physics worker, next to the rigid bodies of S2) from a
// WET1 spec (`wetBytes` writes it from `wetSpec`): the pane's square, gravity in the pane's axes, the contact angles of
// water on glass (data/wettability.ts) and, per effect that feeds it (data/front-glass.ts GLASS_FEED), its particles
// per mm³ and their mean velocity in the pane's axes. Each frame of the run comes back as the engine's record (the
// drops, the motes added and carried away since the frame before), and `GlassTrackWriter` keeps them in the run's
// PHYSICS clip of the camera: a `GlassTrack`, the drops of every frame and every mote with the frames it was on the
// pane, little-endian, base64, with the key of the simulation (`wetKey`: the FNV-1a of its WET1 bytes and the format's
// version). That track is the cache: saved with the project, it is what the render (the GLAS section laid out drop by
// drop, io/rsb.ts) and the Fast preview's approximation (render/glass-overlay.ts) read at the playhead, and a run with
// the same key gives the same frames, bit for bit (the engine is deterministic).

import { DUST_REPOSE_DEG, FRONT_GLASS_FAMILY, wettability } from '../data/wettability';
import { GLASS_FEED } from '../data/front-glass';
import { isPanoramic, type CameraId } from './camera';
import { glassFromScene } from './optics';
import { effectVolumeM3, requestedParticles, type AmbientEffect } from './effects';
import type { Vec3 } from './math';
import type { Pose } from './animation';
import type { ProjectState } from './store';

/** The version of the record format (and of the simulation it records): part of every key. */
export const WET_FORMAT_VERSION = 1;
/** A mote still on the pane at the last frame. */
export const NEVER = 0xffffffff;

/** An effect as the pane sees it (a source of WET1). */
export interface WetSourceSpec {
  kind: 'DROPS' | 'DUST';
  /** Particles per cubic millimetre. */
  density: number;
  /** Their mean velocity in the pane's axes (right, up, out of the outer face), mm/s. */
  velocity: Vec3;
  sizeMm: number;
  sizeVar: number;
  /** The effect it comes from. */
  effect: string;
}

/** What the simulation of a pane is given (rt_phys::wet::WetSpec). */
export interface WetPaneSpec {
  seed: number;
  /** Half the side of the pane's square, mm (the engine's, for the camera's frame). */
  halfExtent: number;
  /** Gravity's direction in the pane's axes (right, up, out). */
  gravity: Vec3;
  advancingDeg: number;
  recedingDeg: number;
  reposeDeg: number;
  sources: WetSourceSpec[];
}

/** The axes of a camera's front glass: its right, up and forward (out of the outer face), unit, world. */
export interface PaneAxes {
  right: Vec3;
  up: Vec3;
  forward: Vec3;
}

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]);
  return l > 0 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0];
};
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** The pane's axes of a camera at `position` looking at `target` with `up`, as the engine's `Camera::basis` makes them. */
export function paneAxes(position: Vec3, target: Vec3, up: Vec3): PaneAxes {
  let forward = norm([target[0] - position[0], target[1] - position[1], target[2] - position[2]]);
  if (dot(forward, forward) === 0) forward = [0, 1, 0];
  let right = norm(cross(forward, up));
  if (dot(right, right) < 0.5) right = norm(cross(forward, Math.abs(forward[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]));
  return { right, up: cross(right, forward), forward };
}

/** A world vector in the pane's axes. */
export function toPane(axes: PaneAxes, v: Vec3): Vec3 {
  return [dot(v, axes.right), dot(v, axes.up), dot(v, axes.forward)];
}

/** The effects that feed a pane fed by the scene: enabled, of a kind that leaves something, with particles. */
export function feedingEffects(state: ProjectState): AmbientEffect[] {
  return state.effects.filter((e) => e.enabled && GLASS_FEED[e.preset] !== null && e.sizeMm > 0 && requestedParticles(state, e) > 0);
}

/**
 * S3c: the render would draw camera `camera`'s front glass clean although the scene feeds it: the glass is on, fed by
 * the scene (not through a panoramic camera, which has none), some effect rains or dusts on it, and the engine of the
 * render does not read a pane laid out drop by drop (`readsLayout` false: bit 7 of its features, render/engine.ts
 * `readsGlassLayout`; an engine of S3, such as an older desktop launcher). Unknown (`undefined`: no engine yet) is
 * not a reason to warn.
 */
export function glassRendersClean(state: ProjectState, camera: CameraId, readsLayout: boolean | undefined): boolean {
  if (readsLayout !== false) return false;
  const cam = state.camera.cameras[camera];
  const g = cam?.optics?.frontGlass;
  if (!cam || !g?.on || !glassFromScene(g) || isPanoramic(cam.projection)) return false;
  return feedingEffects(state).length > 0;
}

/**
 * The spec of the simulation of the front glass of a camera whose pane has `axes`, `halfExtent` and `seed`: gravity
 * and each feeding effect's mean velocity (its wind plus its fall, m/s × 1000) in the pane's axes, its density (the
 * particles it asks for over the volume they fill: the photographic densities of the presets), its size. Null when no
 * effect feeds it.
 */
export function wetSpec(state: ProjectState, axes: PaneAxes, halfExtent: number, seed: number): WetPaneSpec | null {
  const sources: WetSourceSpec[] = [];
  for (const e of feedingEffects(state)) {
    const kind = GLASS_FEED[e.preset];
    const volume = effectVolumeM3(state, e);
    if (!kind || !(volume > 0)) continue;
    const density = requestedParticles(state, e) / (volume * 1e9);
    const v: Vec3 = [e.wind[0] * 1000, e.wind[1] * 1000, (e.wind[2] - e.fallSpeed * e.gravity) * 1000];
    sources.push({ kind, density, velocity: toPane(axes, v), sizeMm: Math.min(50, e.sizeMm), sizeVar: Math.min(1, Math.max(0, e.sizeVar)), effect: e.id });
  }
  if (sources.length === 0) return null;
  const w = wettability(FRONT_GLASS_FAMILY);
  return {
    seed: Math.max(0, Math.round(seed)) >>> 0,
    halfExtent,
    gravity: toPane(axes, [0, 0, -1]),
    advancingDeg: w.advancingDeg,
    recedingDeg: w.recedingDeg,
    reposeDeg: DUST_REPOSE_DEG,
    sources,
  };
}

/** The contact angle the drops of a pane are drawn with: the mean of the advancing and the receding one (the engine's cap). */
export function capAngleDeg(spec: Pick<WetPaneSpec, 'advancingDeg' | 'recedingDeg'>): number {
  return 0.5 * (spec.advancingDeg + spec.recedingDeg);
}

/**
 * The WET1 bytes of a spec (engine/crates/rt-phys/src/wet.rs reads them). Little-endian 4-byte words:
 *
 *   "WET1"  u32 version (1); u32 seed; f32 half_extent (mm); f32 gravity[3] (unit, the pane's axes);
 *   f32 advancing_deg receding_deg repose_deg; u32 sources;
 *   per source: u32 kind (0 drops, 1 dust); f32 density (per mm³); f32 velocity[3] (mm/s, the pane's axes);
 *               f32 size_mm size_var
 */
export function wetBytes(spec: WetPaneSpec): Uint8Array {
  const bytes = new Uint8Array(4 * (11 + 7 * spec.sources.length));
  const view = new DataView(bytes.buffer);
  bytes.set([0x57, 0x45, 0x54, 0x31], 0);
  let at = 4;
  const u32 = (v: number) => {
    view.setUint32(at, v >>> 0, true);
    at += 4;
  };
  const f32 = (v: number) => {
    view.setFloat32(at, v, true);
    at += 4;
  };
  u32(WET1_VERSION);
  u32(spec.seed);
  f32(spec.halfExtent);
  for (const g of spec.gravity) f32(g);
  f32(spec.advancingDeg);
  f32(spec.recedingDeg);
  f32(spec.reposeDeg);
  u32(spec.sources.length);
  for (const src of spec.sources) {
    u32(src.kind === 'DROPS' ? 0 : 1);
    f32(src.density);
    for (const v of src.velocity) f32(v);
    f32(src.sizeMm);
    f32(src.sizeVar);
  }
  return bytes;
}

/** The version of WET1 this page writes (rt_phys::wet::WET_VERSION). */
export const WET1_VERSION = 1;

/** The key of a simulation: the FNV-1a of its WET1 bytes, and the version of the format. */
export function wetKey(bytes: Uint8Array): string {
  let h = 0x811c9dc5;
  for (const b of bytes) h = Math.imul(h ^ b, 0x01000193) >>> 0;
  return `wet${WET_FORMAT_VERSION}:${h.toString(16).padStart(8, '0')}`;
}

// ---------------------------------------------------------------------------
// The record of a run (the cache)
// ---------------------------------------------------------------------------

/**
 * The recorded front glass of a run: every frame's drops, and every mote with the frame it landed in and the frame it
 * was carried away in (NEVER: still there). Little-endian, base64, so the state stays plain JSON.
 */
export interface GlassTrack {
  /** The camera whose glass it is. */
  camera: CameraId;
  fps: number;
  frames: number;
  /** The simulation's key (`wetKey`). */
  key: string;
  /** The contact angle its drops are drawn with, degrees. */
  capAngleDeg: number;
  /** Per frame: u32 count, then f32 (x, y, a) per drop, mm in the pane's axes. */
  drops: string;
  /** Per mote: f32 x, y, r; u32 first frame, u32 the frame it left in (NEVER). */
  motes: string;
}

/** A frame of the glass: the drops (x, y, a) and the motes there (x, y, r), mm in the pane's axes. */
export interface GlassFrame {
  drops: Float32Array;
  motes: Float32Array;
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

/** A growable buffer of 4-byte words. */
class Words {
  bytes = new Uint8Array(256);
  view = new DataView(this.bytes.buffer);
  length = 0;

  private room(n: number): void {
    if (this.length + n <= this.bytes.length) return;
    const grown = new Uint8Array(Math.max(this.bytes.length * 2, this.length + n));
    grown.set(this.bytes.subarray(0, this.length));
    this.bytes = grown;
    this.view = new DataView(grown.buffer);
  }

  u32(v: number): void {
    this.room(4);
    this.view.setUint32(this.length, v >>> 0, true);
    this.length += 4;
  }

  /** Raw little-endian words copied as they are (the engine's floats keep their bits). */
  raw(src: Uint8Array): void {
    this.room(src.length);
    this.bytes.set(src, this.length);
    this.length += src.length;
  }

  data(): Uint8Array {
    return this.bytes.subarray(0, this.length);
  }
}

/**
 * The track of a run, a frame at a time from the engine's records (`WetPane::frame`):
 * `u32 drops; f32 (x y a)[drops]; u32 first; u32 added; f32 (x y r)[added]; u32 removed; u32 ids[removed]`.
 */
export class GlassTrackWriter {
  private readonly drops = new Words();
  private readonly motes = new Words();
  private moteCount = 0;
  private count = 0;
  private dropsText = '';
  private dropsDone = 0;

  constructor(
    readonly camera: CameraId,
    readonly fps: number,
    readonly key: string,
    readonly capAngle: number,
  ) {}

  get frames(): number {
    return this.count;
  }

  /** Mote ids in the order they landed. */
  get motesLanded(): number {
    return this.moteCount;
  }

  /** The drops of the last frame, and the motes on the pane then. */
  lastDrops = 0;
  motesAlive = 0;

  /** Appends a frame from its record; throws on a record that does not follow from the frames before. */
  push(record: Uint8Array): void {
    const view = new DataView(record.buffer, record.byteOffset, record.byteLength);
    const word = (i: number) => {
      if (4 * i + 4 > record.byteLength) throw new Error('glass record: truncated');
      return view.getUint32(4 * i, true);
    };
    const frame = this.count;
    const nd = word(0);
    if (4 * (1 + 3 * nd) > record.byteLength) throw new Error('glass record: truncated');
    this.drops.u32(nd);
    this.drops.raw(record.subarray(4, 4 + 12 * nd));
    let at = 1 + 3 * nd;
    const first = word(at);
    const added = word(at + 1);
    if (first !== this.moteCount) throw new Error('glass record: the motes do not follow the frames before');
    at += 2;
    if (4 * (at + 3 * added) > record.byteLength) throw new Error('glass record: truncated');
    for (let k = 0; k < added; k++) {
      this.motes.raw(record.subarray(4 * (at + 3 * k), 4 * (at + 3 * k + 3)));
      this.motes.u32(frame);
      this.motes.u32(NEVER);
    }
    this.moteCount += added;
    at += 3 * added;
    const removed = word(at);
    for (let k = 0; k < removed; k++) {
      const id = word(at + 1 + k);
      if (id >= this.moteCount) throw new Error('glass record: a mote that never landed');
      if (this.motes.view.getUint32(id * 20 + 16, true) === NEVER) this.motesAlive--;
      this.motes.view.setUint32(id * 20 + 16, frame, true);
    }
    this.motesAlive += added;
    this.lastDrops = nd;
    this.count++;
  }

  /** The track so far (the drops are encoded once, a cut at a multiple of three bytes at a time; the motes again). */
  track(): GlassTrack {
    const bytes = this.drops.data();
    const cut = bytes.length - (bytes.length % 3);
    if (cut > this.dropsDone) {
      this.dropsText += toBase64(bytes.subarray(this.dropsDone, cut));
      this.dropsDone = cut;
    }
    const tail = bytes.length > this.dropsDone ? toBase64(bytes.subarray(this.dropsDone)) : '';
    const track: GlassTrack = { camera: this.camera, fps: this.fps, frames: this.count, key: this.key, capAngleDeg: this.capAngle, drops: this.dropsText + tail, motes: toBase64(this.motes.data()) };
    decodedTracks.set(track, decodeParts(bytes.slice(), this.motes.data().slice(), this.count));
    return track;
  }
}

interface Decoded {
  /** Each frame's first drop word (after its count) and its count. */
  frameAt: Uint32Array;
  frameCount: Uint32Array;
  drops: Float32Array;
  motes: Float32Array;
  /** First frame and the frame it left in, per mote. */
  span: Uint32Array;
}

const decodedTracks = new WeakMap<GlassTrack, Decoded | null>();

function decodeParts(dropBytes: Uint8Array, moteBytes: Uint8Array, frames: number): Decoded | null {
  if (dropBytes.length % 4 !== 0 || moteBytes.length % 20 !== 0 || frames < 1) return null;
  const words = new DataView(dropBytes.buffer, dropBytes.byteOffset, dropBytes.byteLength);
  const drops = new Float32Array(dropBytes.length / 4);
  for (let i = 0; i < drops.length; i++) drops[i] = words.getFloat32(4 * i, true);
  const frameAt = new Uint32Array(frames);
  const frameCount = new Uint32Array(frames);
  let at = 0;
  for (let f = 0; f < frames; f++) {
    if (4 * at + 4 > dropBytes.length) return null;
    const n = words.getUint32(4 * at, true);
    if (4 * (at + 1 + 3 * n) > dropBytes.length) return null;
    frameAt[f] = at + 1;
    frameCount[f] = n;
    at += 1 + 3 * n;
  }
  if (4 * at !== dropBytes.length) return null;
  const m = new DataView(moteBytes.buffer, moteBytes.byteOffset, moteBytes.byteLength);
  const count = moteBytes.length / 20;
  const motes = new Float32Array(3 * count);
  const span = new Uint32Array(2 * count);
  for (let k = 0; k < count; k++) {
    for (let c = 0; c < 3; c++) motes[3 * k + c] = m.getFloat32(20 * k + 4 * c, true);
    span[2 * k] = m.getUint32(20 * k + 12, true);
    span[2 * k + 1] = m.getUint32(20 * k + 16, true);
  }
  for (const v of drops) if (!Number.isFinite(v)) return null;
  for (const v of motes) if (!Number.isFinite(v)) return null;
  return { frameAt, frameCount, drops, motes, span };
}

function decoded(track: GlassTrack): Decoded | null {
  if (decodedTracks.has(track)) return decodedTracks.get(track)!;
  let d: Decoded | null = null;
  try {
    d = decodeParts(fromBase64(track.drops), fromBase64(track.motes), track.frames);
  } catch {
    d = null;
  }
  decodedTracks.set(track, d);
  return d;
}

/** A well-formed glass track. */
export function isGlassTrack(x: unknown): x is GlassTrack {
  const t = x as Partial<GlassTrack> | null;
  return (
    !!t &&
    typeof t === 'object' &&
    typeof t.camera === 'string' &&
    typeof t.fps === 'number' &&
    t.fps > 0 &&
    Number.isInteger(t.frames) &&
    (t.frames ?? 0) >= 1 &&
    typeof t.key === 'string' &&
    typeof t.capAngleDeg === 'number' &&
    t.capAngleDeg >= 5 &&
    t.capAngleDeg <= 175 &&
    typeof t.drops === 'string' &&
    typeof t.motes === 'string' &&
    decoded(t as GlassTrack) !== null
  );
}

/** Frame `index` of a track (clamped to its frames), or null when the track is damaged. */
export function glassFrame(track: GlassTrack, index: number): GlassFrame | null {
  const d = decoded(track);
  if (!d) return null;
  const f = Math.max(0, Math.min(track.frames - 1, Math.round(index)));
  const at = d.frameAt[f];
  const drops = d.drops.subarray(at, at + 3 * d.frameCount[f]);
  let n = 0;
  for (let k = 0; k < d.span.length / 2; k++) if (d.span[2 * k] <= f && f < d.span[2 * k + 1]) n++;
  const motes = new Float32Array(3 * n);
  let j = 0;
  for (let k = 0; k < d.span.length / 2; k++) {
    if (d.span[2 * k] <= f && f < d.span[2 * k + 1]) {
      motes.set(d.motes.subarray(3 * k, 3 * k + 3), 3 * j);
      j++;
    }
  }
  return { drops, motes };
}

/**
 * S3b: the frame of camera `camera`'s recorded front glass that `pose` shows (its PHYSICS clip, core/wet.ts), with the
 * contact angle it was recorded with; null without one.
 */
export function recordedGlass(state: ProjectState, pose: Pose | null, camera: string): (GlassFrame & { capAngleDeg: number }) | null {
  const gp = pose?.glass?.[camera];
  const clip = gp ? state.animation.clips.find((c) => c.id === gp.clip) : undefined;
  if (!gp || !clip?.glass || clip.glass.camera !== camera) return null;
  const frame = glassFrame(clip.glass, gp.frame);
  return frame ? { ...frame, capAngleDeg: clip.glass.capAngleDeg } : null;
}

/** The frame of a recorded glass at clip phase `u` (0..1 of its length): the nearest one (drops do not interpolate). */
export function glassFrameIndex(track: Pick<GlassTrack, 'frames'>, u: number): number {
  return Math.round(Math.max(0, Math.min(1, u)) * (track.frames - 1));
}

// ---------------------------------------------------------------------------
// What the engine says of a pane (rt.wasm `rt_scene_glass`)
// ---------------------------------------------------------------------------

/** A camera's front glass as the engine laid it out: where it is, how much of it the rays cross, what is on it by hand. */
export interface EnginePane {
  distanceMm: number;
  /** Half the side of the square of the pane the camera's rays cross (the simulation's square). */
  halfExtentMm: number;
  contactAngleDeg: number;
  ior: number;
  dustOpacity: number;
  /** x, y, a per drop; x, y, r per mote (mm, the pane's axes). */
  drops: Float32Array;
  motes: Float32Array;
}

/**
 * The engine's bytes of a pane: `f32 distance half_extent contact_angle_deg ior dust_opacity; u32 drops motes;
 * f32 (x y a)[drops] (x y r)[motes]`; null when there is no pane (no bytes) or they are not one.
 */
export function parseEnginePane(bytes: Uint8Array): EnginePane | null {
  if (bytes.length < 28 || bytes.length % 4 !== 0) return null;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const f = (i: number) => v.getFloat32(4 * i, true);
  const nd = v.getUint32(20, true);
  const nm = v.getUint32(24, true);
  if (bytes.length !== 4 * (7 + 3 * (nd + nm))) return null;
  const drops = new Float32Array(3 * nd);
  const motes = new Float32Array(3 * nm);
  for (let i = 0; i < 3 * nd; i++) drops[i] = f(7 + i);
  for (let i = 0; i < 3 * nm; i++) motes[i] = f(7 + 3 * nd + i);
  return { distanceMm: f(0), halfExtentMm: f(1), contactAngleDeg: f(2), ior: f(3), dustOpacity: f(4), drops, motes };
}
