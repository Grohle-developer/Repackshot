// Rain, dust and snow on the parts (phase S3c, SPEC §3.1 "Físicas", UI.md §2.5): what the ambient effects that fall on
// the parts (their `wetParts` switch) leave on the meshes of the scene. The engine simulates it (engine/crates/rt-phys
// `wet_parts`, through rt.wasm's `wpt_*` in the physics worker, next to the rigid bodies of S2 and the front glass of
// S3b) from a WPT1 spec (`wptBytes` writes it from `wetPartsSpec`): every visible part that does not move in the run,
// its mesh where it stands, the wettability of the family of its material (data/wettability.ts), the set's pieces as a
// film; per effect that falls on them, its particles per mm³ and their mean velocity in the world.
//
// The run's PHYSICS clip of the scene keeps it (`MotionClip.parts`, a `PartsTrack`): the engine's layout of the
// samples of every triangle (once), every version of every drop with the frames it held, the frame each sample first
// got wet and every frame the rain wiped it, base64, with the key of the simulation (`wetPartsKey`: the FNV-1a of its
// WPT1 bytes and the format's version). That track is the cache: saved with the project, the render (the WETP sections,
// io/rsb.ts) and the Fast preview (render/preview.ts) read the frame the playhead shows (`partsFrame`): each sample's
// bytes of wet, dust and snow (the dust from its rate since the rain last wiped it, the snow from its rate), each drop
// on its triangle in its part's object space.

import { PARTS_CELL_MM, PARTS_FEED, PARTS_MAX_SAMPLES, SET_PIECES_AS_FILM } from '../data/wet-parts';
import { DUST_REPOSE_DEG, SNOW_REPOSE_DEG, wettability, wettabilityFamilyOf, type WettabilityFamily } from '../data/wettability';
import type { Pose } from './animation';
import { effectVolumeM3, requestedParticles, type AmbientEffect } from './effects';
import type { Mat4, Vec3 } from './math';
import { getMesh, type MeshData, type MeshId } from './meshes';
import { allParts, effectiveVisible, isSetPiece, worldMatrix, type NodeId } from './scene';
import type { ProjectState } from './store';

/** The version of WPT1 this page writes (rt_phys::wet_parts::PARTS_VERSION). */
export const WPT1_VERSION = 1;
/** The version of the record format (and of the simulation it records): part of every key. */
export const PARTS_FORMAT_VERSION = 1;
/** A frame that has not come. */
export const NEVER = 0xffffffff;
/** The depth of snow a step of its byte stands for, mm (rt_core::weather::SNOW_STEP_MM). */
export const SNOW_STEP_MM = 0.02;
/** Steps of the simulation per second (rt-phys STEPS_PER_SECOND). */
const STEPS = 240;
/** WPT1 part flags: a film (rt_phys::wet_parts::PART_FILM). */
const PART_FILM = 1;

/** An effect as the parts see it (a source of WPT1). */
export interface PartsSourceSpec {
  kind: 'DROPS' | 'DUST' | 'SNOW';
  /** Particles per cubic millimetre. */
  density: number;
  /** Their mean velocity, world, mm/s. */
  velocity: Vec3;
  sizeMm: number;
  sizeVar: number;
  /** The effect it comes from. */
  effect: string;
}

/** A part as the simulation takes it. */
export interface WetPartEntry {
  node: NodeId;
  mesh: MeshId;
  /** Object to world (column-major), where it stands when the run starts. */
  matrix: Mat4;
  family: WettabilityFamily;
  advancingDeg: number;
  recedingDeg: number;
  soakMmPerS: number;
  /** How much a wet film darkens it (the WETP porosity). */
  porosity: number;
  /** A set's piece: no drops one by one, a film. */
  film: boolean;
}

/** What the simulation of the parts is given (rt_phys::wet_parts::PartsSpec). */
export interface WetPartsSpec {
  seed: number;
  cellMm: number;
  maxSamples: number;
  reposeDeg: number;
  snowReposeDeg: number;
  parts: WetPartEntry[];
  sources: PartsSourceSpec[];
}

/** The effects that fall on the parts: enabled, switched on for it, of a kind that leaves something, with particles. */
export function partsFeedingEffects(state: ProjectState): AmbientEffect[] {
  return state.effects.filter((e) => e.enabled && e.wetParts === true && PARTS_FEED[e.preset] !== null && e.sizeMm > 0 && requestedParticles(state, e) > 0);
}

/**
 * S3c: the render would draw the parts dry although some effect falls on them: the engine of the render does not draw
 * the weather of the parts (`readsWetParts` false: bit 8 of its features, render/engine.ts `readsWetParts`; an engine of
 * before S3c). Unknown (`undefined`: no engine yet) is no reason to warn.
 */
export function partsRenderDry(state: ProjectState, readsWetParts: boolean | undefined): boolean {
  return readsWetParts === false && partsFeedingEffects(state).length > 0;
}

/**
 * The spec of the simulation of the parts: every visible part with a mesh that is not among `moving` (the bodies the
 * run moves: they are not wetted), where it stands, the wettability of its material's family (data/wettability.ts),
 * the set's pieces as a film; per effect that falls on them, its density (the particles it asks for over the volume
 * they fill), its velocity (its wind plus its fall, m/s × 1000) and its size. Null when nothing falls or nothing is
 * there to wet.
 */
export function wetPartsSpec(state: ProjectState, moving: ReadonlySet<NodeId> = new Set()): WetPartsSpec | null {
  const sources: PartsSourceSpec[] = [];
  const feeding = partsFeedingEffects(state);
  for (const e of feeding) {
    const kind = PARTS_FEED[e.preset];
    const volume = effectVolumeM3(state, e);
    if (!kind || !(volume > 0)) continue;
    const density = requestedParticles(state, e) / (volume * 1e9);
    const velocity: Vec3 = [e.wind[0] * 1000, e.wind[1] * 1000, (e.wind[2] - e.fallSpeed * e.gravity) * 1000];
    sources.push({ kind, density, velocity, sizeMm: Math.min(50, e.sizeMm), sizeVar: Math.min(1, Math.max(0, e.sizeVar)), effect: e.id });
  }
  if (sources.length === 0) return null;
  const cache = new Map<NodeId, Mat4>();
  const parts: WetPartEntry[] = [];
  for (const id of allParts(state)) {
    const node = state.scene.nodes[id];
    if (!node?.mesh || moving.has(id) || !effectiveVisible(state, id) || !getMesh(node.mesh.id)) continue;
    const material = node.material ? state.materials[node.material] : undefined;
    const family = wettabilityFamilyOf(material);
    const w = wettability(family);
    parts.push({
      node: id,
      mesh: node.mesh.id,
      matrix: worldMatrix(state, id, cache),
      family,
      advancingDeg: w.advancingDeg,
      recedingDeg: w.recedingDeg,
      soakMmPerS: w.soakMmPerS,
      porosity: w.porosity,
      film: SET_PIECES_AS_FILM && isSetPiece(node),
    });
  }
  if (parts.length === 0) return null;
  return {
    seed: (feeding[0]?.seed ?? 0) >>> 0,
    cellMm: PARTS_CELL_MM,
    maxSamples: PARTS_MAX_SAMPLES,
    reposeDeg: DUST_REPOSE_DEG,
    snowReposeDeg: SNOW_REPOSE_DEG,
    parts,
    sources,
  };
}

/** The rows of the 3 × 4 object-to-world part of a column-major matrix. */
function rows(m: Mat4): number[] {
  return [m[0], m[4], m[8], m[12], m[1], m[5], m[9], m[13], m[2], m[6], m[10], m[14]];
}

/**
 * The WPT1 bytes of a spec (engine/crates/rt-phys/src/wet_parts.rs reads them). Little-endian 4-byte words:
 *
 *   "WPT1"  u32 version (1); u32 seed; f32 cell_mm; u32 max_samples; f32 repose_deg snow_repose_deg;
 *   u32 meshes; per mesh: u32 vertices indices; f32 positions[3 × vertices]; u32 indices[]
 *   u32 parts; per part: u32 mesh; f32 rows[12]; f32 advancing_deg receding_deg soak_mm_s; u32 flags (1: a film)
 *   u32 sources; per source: u32 kind (0 drops, 1 dust, 2 snow); f32 density; f32 velocity[3]; f32 size_mm size_var
 *
 * Each mesh the parts use once, in the order the parts first name them. A part whose mesh is not in the registry
 * (`meshes`) is left out.
 */
export function wptBytes(spec: WetPartsSpec, meshes: (id: MeshId) => MeshData | undefined = getMesh): Uint8Array {
  const index = new Map<MeshId, number>();
  const list: MeshData[] = [];
  const parts: { mesh: number; part: WetPartEntry }[] = [];
  for (const p of spec.parts) {
    let i = index.get(p.mesh);
    if (i === undefined) {
      const data = meshes(p.mesh);
      if (!data) continue;
      i = list.push(data) - 1;
      index.set(p.mesh, i);
    }
    parts.push({ mesh: i, part: p });
  }
  let size = 4 + 4 * 7;
  for (const m of list) size += 8 + 4 * (m.positions.length + m.indices.length);
  size += 4 + parts.length * 68 + 4 + spec.sources.length * 28;
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  out.set([0x57, 0x50, 0x54, 0x31], 0); // "WPT1"
  let at = 4;
  const u32 = (v: number) => {
    view.setUint32(at, v >>> 0, true);
    at += 4;
  };
  const f32 = (v: number) => {
    view.setFloat32(at, Number.isFinite(v) ? v : 0, true);
    at += 4;
  };
  u32(WPT1_VERSION);
  u32(spec.seed);
  f32(spec.cellMm);
  u32(spec.maxSamples);
  f32(spec.reposeDeg);
  f32(spec.snowReposeDeg);
  u32(list.length);
  for (const m of list) {
    u32(m.positions.length / 3);
    u32(m.indices.length);
    for (let i = 0; i < m.positions.length; i++) f32(m.positions[i]);
    for (let i = 0; i < m.indices.length; i++) u32(m.indices[i]);
  }
  u32(parts.length);
  for (const { mesh, part } of parts) {
    u32(mesh);
    for (const v of rows(part.matrix)) f32(v);
    f32(part.advancingDeg);
    f32(part.recedingDeg);
    f32(part.soakMmPerS);
    u32(part.film ? PART_FILM : 0);
  }
  u32(spec.sources.length);
  for (const s of spec.sources) {
    u32(s.kind === 'DROPS' ? 0 : s.kind === 'DUST' ? 1 : 2);
    f32(s.density);
    for (const v of s.velocity) f32(v);
    f32(s.sizeMm);
    f32(s.sizeVar);
  }
  return out;
}

/** The parts of a spec that `wptBytes` writes (those whose mesh is in the registry), in order. */
export function writtenParts(spec: WetPartsSpec, meshes: (id: MeshId) => MeshData | undefined = getMesh): WetPartEntry[] {
  return spec.parts.filter((p) => meshes(p.mesh) !== undefined);
}

/** The key of a simulation: the FNV-1a of its WPT1 bytes, and the version of the format. */
export function wetPartsKey(bytes: Uint8Array): string {
  let h = 0x811c9dc5;
  for (const b of bytes) h = Math.imul(h ^ b, 0x01000193) >>> 0;
  return `wpt${PARTS_FORMAT_VERSION}:${h.toString(16).padStart(8, '0')}`;
}

// ---------------------------------------------------------------------------
// The record of a run (the cache)
// ---------------------------------------------------------------------------

/** A part of a recorded run: the node, its mesh's triangles and samples, its drops' contact angle, its darkening. */
export interface PartsTrackPart {
  node: NodeId;
  mesh: MeshId;
  triangles: number;
  samples: number;
  capAngleDeg: number;
  porosity: number;
}

/** The recorded rain, dust and snow on the parts of a run (little-endian, base64, so the state stays plain JSON). */
export interface PartsTrack {
  fps: number;
  frames: number;
  /** The simulation's key (`wetPartsKey`). */
  key: string;
  parts: PartsTrackPart[];
  /** The engine's layout of the samples (rt_phys::wet_parts `WetParts::layout`). */
  layout: string;
  /** Every version of every drop: u32 id part triangle; f32 x y z a (object space); u32 first frame, the frame it ended (NEVER). */
  drops: string;
  /** Per sample first wet: u32 sample, u32 frame. */
  wet: string;
  /** Every wipe: u32 sample, u32 frame. */
  wiped: string;
  /** Per frame: u32 drops on the parts, u32 drips so far. */
  counts: string;
}

/** What the parts hold at a frame: per part its samples' bytes and its drops. */
export interface PartsFrame {
  parts: { values: Uint8Array; drops: { triangle: number; position: Vec3; radius: number }[] }[];
  /** Drops on all the parts and drips so far (the meter). */
  drops: number;
  drips: number;
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

  raw(src: Uint8Array): void {
    this.room(src.length);
    this.bytes.set(src, this.length);
    this.length += src.length;
  }

  data(): Uint8Array {
    return this.bytes.subarray(0, this.length);
  }
}

/** The parts a layout describes: per part its triangles, samples, flags and cap angle (rt_phys `WetParts::layout`). */
export function parseLayout(bytes: Uint8Array): { cellMm: number; parts: { triangles: number; samples: number; capAngleDeg: number; resolution: Uint8Array; dust: Float32Array | null; snow: Float32Array | null }[] } | null {
  if (bytes.length < 8 || bytes.length % 4 !== 0) return null;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const n = v.getUint32(0, true);
  const cellMm = v.getFloat32(4, true);
  let at = 8;
  const parts = [];
  for (let k = 0; k < n; k++) {
    if (at + 16 > bytes.length) return null;
    const triangles = v.getUint32(at, true);
    const samples = v.getUint32(at + 4, true);
    const flags = v.getUint32(at + 8, true);
    const capAngleDeg = v.getFloat32(at + 12, true);
    at += 16;
    const pad = Math.ceil(triangles / 4) * 4;
    if (at + pad > bytes.length) return null;
    const resolution = bytes.slice(at, at + triangles);
    at += pad;
    let total = 0;
    for (const r of resolution) {
      if (r < 1 || r > 255) return null;
      total += ((r + 1) * (r + 2)) / 2;
    }
    if (total !== samples) return null;
    const floats = (on: boolean): Float32Array | null => {
      if (!on) return null;
      const out = new Float32Array(samples);
      for (let s = 0; s < samples; s++) out[s] = v.getFloat32(at + 4 * s, true);
      at += 4 * samples;
      return out;
    };
    if (at + 4 * samples * ((flags & 1) + ((flags >> 1) & 1)) > bytes.length) return null;
    const dust = floats((flags & 1) !== 0);
    const snow = floats((flags & 2) !== 0);
    parts.push({ triangles, samples, capAngleDeg, resolution, dust, snow });
  }
  return at === bytes.length ? { cellMm, parts } : null;
}

/**
 * The track of a run, a frame at a time from the engine's records (rt_phys::wet_parts `WetParts::frame`):
 * `u32 changed; (u32 id part tri; f32 x y z a)[changed]; u32 gone; u32 ids[gone]; u32 wetted; u32 samples[];
 * u32 wiped; u32 samples[]; u32 drips; u32 drops`. The first record is frame 0 (the dry parts at step 0).
 */
export class PartsTrackWriter {
  private readonly versions = new Words();
  private readonly wet = new Words();
  private readonly wiped = new Words();
  private readonly counts = new Words();
  /** The version of each live drop (its index among the versions). */
  private readonly live = new Map<number, number>();
  private count = 0;
  private drips = 0;
  private readonly layoutText: string;
  readonly samples: number;

  constructor(
    readonly fps: number,
    readonly key: string,
    readonly parts: PartsTrackPart[],
    layout: Uint8Array,
  ) {
    this.layoutText = toBase64(layout);
    this.samples = parts.reduce((n, p) => n + p.samples, 0);
  }

  get frames(): number {
    return this.count;
  }

  /** Drops on the parts at the last frame, and drips so far. */
  lastDrops = 0;
  get totalDrips(): number {
    return this.drips;
  }

  /** Appends a frame from its record; throws on a record that does not follow from the frames before. */
  push(record: Uint8Array): void {
    const view = new DataView(record.buffer, record.byteOffset, record.byteLength);
    const words = record.byteLength / 4;
    const word = (i: number) => {
      if (i >= words) throw new Error('parts record: truncated');
      return view.getUint32(4 * i, true);
    };
    const frame = this.count;
    const nc = word(0);
    if (1 + 7 * nc > words) throw new Error('parts record: truncated');
    const close = (id: number) => {
      const v = this.live.get(id);
      if (v === undefined) return;
      this.versions.view.setUint32(v * 36 + 32, frame, true);
      this.live.delete(id);
    };
    for (let k = 0; k < nc; k++) {
      const at = 1 + 7 * k;
      const id = word(at);
      const part = word(at + 1);
      if (part >= this.parts.length || word(at + 2) >= this.parts[part].triangles) throw new Error('parts record: a drop off its part');
      close(id);
      this.live.set(id, this.versions.length / 36);
      this.versions.raw(record.subarray(4 * at, 4 * at + 28));
      this.versions.u32(frame);
      this.versions.u32(NEVER);
    }
    let at = 1 + 7 * nc;
    const ng = word(at);
    for (let k = 0; k < ng; k++) close(word(at + 1 + k));
    at += 1 + ng;
    const nw = word(at);
    for (let k = 0; k < nw; k++) {
      const s = word(at + 1 + k);
      if (s >= this.samples) throw new Error('parts record: a sample that is not there');
      this.wet.u32(s);
      this.wet.u32(frame);
    }
    at += 1 + nw;
    const nx = word(at);
    for (let k = 0; k < nx; k++) {
      const s = word(at + 1 + k);
      if (s >= this.samples) throw new Error('parts record: a sample that is not there');
      this.wiped.u32(s);
      this.wiped.u32(frame);
    }
    at += 1 + nx;
    this.drips += word(at);
    const drops = word(at + 1);
    if (drops !== this.live.size) throw new Error('parts record: the drops do not follow the frames before');
    if (4 * (at + 2) !== record.byteLength) throw new Error('parts record: bytes after the end');
    this.counts.u32(drops);
    this.counts.u32(this.drips);
    this.lastDrops = drops;
    this.count++;
  }

  /** The track so far. */
  track(): PartsTrack {
    const track: PartsTrack = {
      fps: this.fps,
      frames: this.count,
      key: this.key,
      parts: this.parts.map((p) => ({ ...p })),
      layout: this.layoutText,
      drops: toBase64(this.versions.data()),
      wet: toBase64(this.wet.data()),
      wiped: toBase64(this.wiped.data()),
      counts: toBase64(this.counts.data()),
    };
    return track;
  }
}

interface DecodedParts {
  layout: NonNullable<ReturnType<typeof parseLayout>>;
  /** Each part's first sample (global). */
  first: number[];
  /** Drop versions: u32 words (9 per version). */
  versions: Uint32Array;
  versionFloats: Float32Array;
  /** The frame each sample first got wet (NEVER). */
  wetFrame: Uint32Array;
  /** The wipes of each sample, frames ascending: CSR over samples. */
  wipeStart: Uint32Array;
  wipeFrames: Uint32Array;
  counts: Uint32Array;
}

const decodedTracks = new WeakMap<PartsTrack, DecodedParts | null>();
const frameCache = new WeakMap<PartsTrack, { frame: number; value: PartsFrame }>();

function decodeParts(track: PartsTrack): DecodedParts | null {
  const layout = parseLayout(fromBase64(track.layout));
  if (!layout || layout.parts.length !== track.parts.length) return null;
  const first: number[] = [];
  let samples = 0;
  for (let k = 0; k < layout.parts.length; k++) {
    const p = layout.parts[k];
    const t = track.parts[k];
    if (p.triangles !== t.triangles || p.samples !== t.samples) return null;
    first.push(samples);
    samples += p.samples;
  }
  const words = (text: string, per: number): Uint32Array | null => {
    const b = fromBase64(text);
    if (b.length % (4 * per) !== 0) return null;
    return new Uint32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.length));
  };
  const versions = words(track.drops, 9);
  const wet = words(track.wet, 2);
  const wiped = words(track.wiped, 2);
  const counts = words(track.counts, 2);
  if (!versions || !wet || !wiped || !counts || counts.length !== 2 * track.frames) return null;
  const versionFloats = new Float32Array(versions.buffer);
  for (let v = 0; v < versions.length / 9; v++) {
    const part = versions[9 * v + 1];
    if (part >= track.parts.length || versions[9 * v + 2] >= track.parts[part].triangles) return null;
    for (let c = 3; c < 7; c++) if (!Number.isFinite(versionFloats[9 * v + c])) return null;
  }
  const wetFrame = new Uint32Array(samples).fill(NEVER);
  for (let k = 0; k < wet.length; k += 2) {
    if (wet[k] >= samples) return null;
    wetFrame[wet[k]] = Math.min(wetFrame[wet[k]], wet[k + 1]);
  }
  const wipeStart = new Uint32Array(samples + 1);
  for (let k = 0; k < wiped.length; k += 2) {
    if (wiped[k] >= samples) return null;
    wipeStart[wiped[k] + 1]++;
  }
  for (let s = 0; s < samples; s++) wipeStart[s + 1] += wipeStart[s];
  const fill = wipeStart.slice(0, samples);
  const wipeFrames = new Uint32Array(wiped.length / 2);
  for (let k = 0; k < wiped.length; k += 2) wipeFrames[fill[wiped[k]]++] = wiped[k + 1];
  return { layout, first, versions, versionFloats, wetFrame, wipeStart, wipeFrames, counts };
}

function decoded(track: PartsTrack): DecodedParts | null {
  if (decodedTracks.has(track)) return decodedTracks.get(track)!;
  let d: DecodedParts | null = null;
  try {
    d = decodeParts(track);
  } catch {
    d = null;
  }
  decodedTracks.set(track, d);
  return d;
}

/** A well-formed parts track. */
export function isPartsTrack(x: unknown): x is PartsTrack {
  const t = x as Partial<PartsTrack> | null;
  return (
    !!t &&
    typeof t === 'object' &&
    typeof t.fps === 'number' &&
    t.fps > 0 &&
    Number.isInteger(t.frames) &&
    (t.frames ?? 0) >= 1 &&
    typeof t.key === 'string' &&
    Array.isArray(t.parts) &&
    t.parts.every((p) => !!p && typeof p.node === 'string' && typeof p.mesh === 'string' && Number.isInteger(p.triangles) && Number.isInteger(p.samples) && typeof p.capAngleDeg === 'number' && p.capAngleDeg >= 1 && p.capAngleDeg <= 179 && typeof p.porosity === 'number' && p.porosity >= 0 && p.porosity <= 1) &&
    typeof t.layout === 'string' &&
    typeof t.drops === 'string' &&
    typeof t.wet === 'string' &&
    typeof t.wiped === 'string' &&
    typeof t.counts === 'string' &&
    decoded(t as PartsTrack) !== null
  );
}

/** The seconds from the start of a run to frame `k` at `fps` (the step it was recorded at). */
function frameSeconds(k: number, fps: number): number {
  return Math.round((k * STEPS) / fps) / STEPS;
}

/** The byte of a share under dust (rt_phys::wet_parts `dust_byte`). */
export function dustByte(share: number): number {
  return Math.floor(Math.min(1, Math.max(0, share)) * 255 + 0.5);
}

/** The byte of a depth of snow (rt_phys::wet_parts `snow_byte`). */
export function snowByte(depthMm: number): number {
  return Math.min(255, Math.floor(Math.max(0, depthMm) / SNOW_STEP_MM + 0.5));
}

/** Frame `index` of a track (clamped to its frames), or null when the track is damaged. */
export function partsFrame(track: PartsTrack, index: number): PartsFrame | null {
  const d = decoded(track);
  if (!d) return null;
  const f = Math.max(0, Math.min(track.frames - 1, Math.round(index)));
  const kept = frameCache.get(track);
  if (kept && kept.frame === f) return kept.value;
  const t = frameSeconds(f, track.fps);
  const parts: PartsFrame['parts'] = d.layout.parts.map((p, k) => {
    const values = new Uint8Array(3 * p.samples);
    const base = d.first[k];
    for (let s = 0; s < p.samples; s++) {
      const g = base + s;
      values[3 * s] = d.wetFrame[g] <= f ? 255 : 0;
      if (p.dust) {
        // The dust piles from the last wipe at or before this frame (or the start).
        let since = 0;
        for (let w = d.wipeStart[g]; w < d.wipeStart[g + 1]; w++) {
          if (d.wipeFrames[w] > f) break;
          since = frameSeconds(d.wipeFrames[w], track.fps);
        }
        values[3 * s + 1] = dustByte(1 - Math.exp(-p.dust[s] * (t - since)));
      }
      if (p.snow) values[3 * s + 2] = snowByte(p.snow[s] * t);
    }
    return { values, drops: [] };
  });
  const ids: { id: number; v: number }[] = [];
  for (let v = 0; v < d.versions.length / 9; v++) {
    if (d.versions[9 * v + 7] <= f && f < d.versions[9 * v + 8]) ids.push({ id: d.versions[9 * v], v });
  }
  ids.sort((a, b) => a.id - b.id);
  for (const { v } of ids) {
    const fl = d.versionFloats;
    parts[d.versions[9 * v + 1]].drops.push({ triangle: d.versions[9 * v + 2], position: [fl[9 * v + 3], fl[9 * v + 4], fl[9 * v + 5]], radius: fl[9 * v + 6] });
  }
  const value: PartsFrame = { parts, drops: d.counts[2 * f], drips: d.counts[2 * f + 1] };
  frameCache.set(track, { frame: f, value });
  return value;
}

/** The resolutions of a recorded part's triangles (its layout), or null. */
export function partsResolution(track: PartsTrack, part: number): Uint8Array | null {
  return decoded(track)?.layout.parts[part]?.resolution ?? null;
}

/** The frame of a recorded run at clip phase `u` (0..1 of its length): the nearest one. */
export function partsFrameIndex(track: Pick<PartsTrack, 'frames'>, u: number): number {
  return Math.round(Math.max(0, Math.min(1, u)) * (track.frames - 1));
}

/**
 * S3c: the recorded parts the pose shows (the PHYSICS clip of the scene, `Pose.parts`): the track and its frame; null
 * without one.
 */
export function recordedParts(state: ProjectState, pose: Pose | null): { track: PartsTrack; frame: PartsFrame } | null {
  const pp = pose?.parts;
  const clip = pp ? state.animation.clips.find((c) => c.id === pp.clip) : undefined;
  if (!pp || !clip?.parts) return null;
  const frame = partsFrame(clip.parts, pp.frame);
  return frame ? { track: clip.parts, frame } : null;
}

/**
 * S3c: the weather of recorded part `k` at a frame as a WETP section takes it, for an instance made of the part's
 * triangles `tris` (a face-material group: their indices in the part's mesh, in the instance's order) or of all of
 * them (null): each triangle's resolution and its samples' bytes, in that order, and the drops on those triangles
 * (their index in the instance's mesh). Null when the track is damaged.
 */
export function partWeather(track: PartsTrack, frame: PartsFrame, k: number, tris: readonly number[] | null): { resolution: Uint8Array; values: Uint8Array; drops: { triangle: number; position: Vec3; radius: number }[] } | null {
  const res = partsResolution(track, k);
  const p = frame.parts[k];
  if (!res || !p) return null;
  if (!tris) return { resolution: res, values: p.values, drops: p.drops };
  const first = new Uint32Array(res.length + 1);
  for (let t = 0; t < res.length; t++) first[t + 1] = first[t] + ((res[t] + 1) * (res[t] + 2)) / 2;
  const local = new Map<number, number>();
  let total = 0;
  const resolution = new Uint8Array(tris.length);
  tris.forEach((t, i) => {
    resolution[i] = res[t] ?? 1;
    total += first[t + 1] - first[t];
    local.set(t, i);
  });
  const values = new Uint8Array(3 * total);
  let at = 0;
  for (const t of tris) {
    const n = 3 * (first[t + 1] - first[t]);
    values.set(p.values.subarray(3 * first[t], 3 * first[t] + n), at);
    at += n;
  }
  const drops = p.drops.flatMap((d) => {
    const i = local.get(d.triangle);
    return i === undefined ? [] : [{ ...d, triangle: i }];
  });
  return { resolution, values, drops };
}
