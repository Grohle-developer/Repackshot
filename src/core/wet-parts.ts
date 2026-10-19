// Rain, dust and snow on the parts (phase S3c, SPEC §3.1 "Physics", UI.md §2.5): what the ambient effects that fall on
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
//
// S3d: the drips and the drops splashes throw fly through the air (rt_phys::wet_parts): every frame records the drops in
// the air (the part each left, its centre in the world, the radius of its sphere), which the track keeps frame by frame
// (`PartsTrack.falling`), the render draws (the WETF section, for an engine with bit 9) and Fast too. `partsShown` says
// what the frame holds, for the meter: rain, dust and snow, on how many parts, the drops on them and in the air.
//
// S3f: the drops are organic (rt_phys::wet_parts): they grow, let go past their critical size, gather the drops on their
// path, merge with a neck that relaxes, leave a rivulet, hang and pinch off. Every changed drop's record carries its
// shape (rt_core::weather::DropShape: 15 numbers, `DropShape` here), which the track keeps per version
// (`PartsTrack.shapes`), the render draws (the shape tail of WETP, for an engine with bit 10) and Fast too.
//
// S3e: the parts the run moves (S2's Dynamic ones) are in the spec with their body (version 2 of WPT1): the engine
// steps them with the bodies and wets them where they are (their records stay in their object space, and the render
// and Fast draw their weather on their instance, which the run's clips move). The studio floor is a film of square
// cells under the effects' region (the WETG section, for an engine with bit 11; `PartsFrame.floor`), the set's film
// triangles that a shadow edge crosses take fine samples (two-byte resolutions: WTP2, bit 12), the dust leaves its
// motes (the motes tail, bit 13), and the wind of the effects pushes the drops in the air.
//
// U16: each part says how the weather treats it (Physics ▸ Weather, core/part-weather.ts): a part that does not get wet
// is flagged dry (rt_phys::wet_parts::PART_DRY: no drops, no film, the drops in the air that meet it gone), one that
// takes no dust or snow is flagged so (PART_NO_DUST: no rates); either stays in the spec and shelters what is below it.
// Its family is the one it is given, or its material's. The page runs the simulation in its own rt.wasm, so the flags
// need no capability bit; a part with neither flag writes the bytes it wrote before.

import { FLOOR_CELL_MM, FLOOR_MAX_CELLS, PARTS_CELL_MM, PARTS_EDGE_BUDGET, PARTS_EDGE_CELL_MM, PARTS_FEED, PARTS_MAX_SAMPLES, SET_PIECES_AS_FILM } from '../data/wet-parts';
import { DUST_REPOSE_DEG, SNOW_REPOSE_DEG, wettability, type WettabilityFamily } from '../data/wettability';
import type { Pose } from './animation';
import { effectRegion, effectVolumeM3, requestedParticles, type AmbientEffect } from './effects';
import type { Mat4, Vec3 } from './math';
import { getMesh, type MeshData, type MeshId } from './meshes';
import { partWeatherOf, surfaceFamily } from './part-weather';
import { allParts, effectiveVisible, isSetPiece, worldMatrix, type NodeId } from './scene';
import type { ProjectState } from './store';

/**
 * The version of WPT1 this page writes (rt_phys::wet_parts::PARTS_VERSION): 2 (S3e) when the spec has a part that moves,
 * a wind, the studio floor or the set's fine samples; 1 otherwise, so a spec of before keeps its bytes.
 */
export const WPT1_VERSION = 2;
/** S3e: the body of a part that does not move (rt_phys::wet_parts::NO_BODY). */
export const NO_BODY = 0xffffffff;
/**
 * The version of the record format (and of the simulation it records): part of every key. 2 (S3d): the drops in the
 * air, and the drips and splashes that land later than they leave. 3 (S3f): the shapes of the drops, and the organic
 * drops (the gathering, the merges that relax, the rivulets, the drops that hang at an edge and pinch off). 4 (S3e): the
 * studio floor, the parts that move, the set's fine samples, the wind on the drops in the air and the drops that run
 * along a sloping edge.
 */
export const PARTS_FORMAT_VERSION = 4;
/**
 * S3f: a drop's shape (rt_core::weather::DropShape, its floats in the order of the WETP tail): axis[3] aspect bulge
 * taper, merge_axis[3] merge_along merge_across neck shift, sag pinch. The axes are in the part's object space.
 */
export type DropShape = readonly number[];
/** S3f: the floats of a shape. */
export const SHAPE_FLOATS = 15;
/** S3f: a round cap. */
export const ROUND_SHAPE: DropShape = Object.freeze([0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0]);
/** S3f: true for a round cap. */
export function isRoundShape(s: DropShape): boolean {
  return s.length === SHAPE_FLOATS && s.every((v, i) => v === ROUND_SHAPE[i]);
}
/** S3f: true when every value of a shape is finite and in its range (rt_core::weather `DropShape::is_valid`). */
export function isValidShape(s: DropShape): boolean {
  if (s.length !== SHAPE_FLOATS || !s.every(Number.isFinite)) return false;
  const axis = (i: number) => Math.max(Math.abs(s[i]), Math.abs(s[i + 1]), Math.abs(s[i + 2])) <= 1e6;
  const within = (v: number, lo: number, hi: number) => v >= lo && v <= hi;
  return (
    axis(0) &&
    axis(6) &&
    within(s[3], 1, 16) &&
    within(s[4], -2, 2) &&
    within(s[5], -0.95, 0.95) &&
    within(s[9], 0.1, 16) &&
    within(s[10], 0.1, 16) &&
    within(s[11], 0, 0.95) &&
    within(s[12], -16, 16) &&
    within(s[13], 0, 8) &&
    within(s[14], 0, 0.95)
  );
}
/** A frame that has not come. */
export const NEVER = 0xffffffff;
/** The depth of snow a step of its byte stands for, mm (rt_core::weather::SNOW_STEP_MM). */
export const SNOW_STEP_MM = 0.02;
/** Steps of the simulation per second (rt-phys STEPS_PER_SECOND). */
const STEPS = 240;
/** WPT1 part flags: a film (rt_phys::wet_parts::PART_FILM). */
const PART_FILM = 1;
/** U16: WPT1 part flags: no water on it (rt_phys::wet_parts::PART_DRY). */
export const PART_DRY = 2;
/** U16: WPT1 part flags: no dust or snow on it (rt_phys::wet_parts::PART_NO_DUST). */
export const PART_NO_DUST = 4;

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
  /** U16: it does not get wet (Physics ▸ Weather ▸ Gets wet off): it takes no water and still shelters. */
  dry?: boolean;
  /** U16: dust and snow do not settle on it (Gets dust and snow off): it still shelters. */
  noDust?: boolean;
  /**
   * S3e: the dynamic body it moves with (its order among the spec's bodies: the PHY1 scene's dynamic bodies); absent: it
   * stays where it stands.
   */
  body?: number;
}

/** S3e: the studio floor as the simulation takes it (rt_phys::wet_parts::FloorSpec). */
export interface WetFloorSpec {
  /** Height of the plane, mm. */
  z: number;
  /** The corners of its rectangle, world XY, mm. */
  min: [number, number];
  max: [number, number];
  cellMm: number;
  maxCells: number;
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
  /** S3e: the air the drops in the air are in, world, mm/s (absent: still). */
  wind?: Vec3;
  /** S3e: the studio floor (absent: none). */
  floor?: WetFloorSpec | null;
  /** S3e: the cell of the set's film triangles a shadow edge crosses, mm, and the samples they may take (absent: none). */
  edgeCellMm?: number;
  edgeBudget?: number;
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
 * S3d: the render would draw the parts wet but not the drops in the air (drips and splashes falling) although some effect
 * rains on them: its engine draws the weather of the parts (bit 8) but not the drops in the air (`readsWetFlight` false:
 * bit 9, render/engine.ts; an engine of S3c). Unknown is no reason to warn, nor an engine without bit 8 (the note of
 * `partsRenderDry` says more).
 */
export function partsRenderNoFlight(state: ProjectState, readsWetParts: boolean | undefined, readsWetFlight: boolean | undefined): boolean {
  return readsWetParts === true && readsWetFlight === false && partsFeedingEffects(state).some((e) => PARTS_FEED[e.preset] === 'DROPS');
}

/**
 * S3f: the render would draw the drops on the parts round although some effect rains on them: its engine draws the
 * weather of the parts (bit 8) but not the shapes of the drops (`readsWetShapes` false: bit 10, render/engine.ts; an
 * engine of S3c or S3d). Unknown is no reason to warn, nor an engine without bit 8.
 */
export function partsRenderRound(state: ProjectState, readsWetParts: boolean | undefined, readsWetShapes: boolean | undefined): boolean {
  return readsWetParts === true && readsWetShapes === false && partsFeedingEffects(state).some((e) => PARTS_FEED[e.preset] === 'DROPS');
}

/**
 * S3e: the render would draw the studio floor dry although some effect falls on the parts and the floor is on: its engine
 * draws the weather of the parts (bit 8) but not the floor's (`readsWetFloor` false: bit 11, render/engine.ts; an engine
 * of S3c to S3f). Unknown is no reason to warn, nor an engine without bit 8.
 */
export function partsRenderNoFloor(state: ProjectState, readsWetParts: boolean | undefined, readsWetFloor: boolean | undefined): boolean {
  return readsWetParts === true && readsWetFloor === false && state.studio.floor && partsFeedingEffects(state).length > 0;
}

/**
 * S3e: the render would draw the dust's layer without its motes although some dust falls on the parts: its engine draws
 * the weather of the parts (bit 8) but not the motes (`readsWetMotes` false: bit 13). Unknown is no reason to warn.
 */
export function partsRenderNoMotes(state: ProjectState, readsWetParts: boolean | undefined, readsWetMotes: boolean | undefined): boolean {
  return readsWetParts === true && readsWetMotes === false && partsFeedingEffects(state).some((e) => PARTS_FEED[e.preset] === 'DUST');
}

/**
 * The spec of the simulation of the parts: every visible part with a mesh, where it stands, the wettability of its
 * material's family (data/wettability.ts), the set's pieces as a film; S3e: a part among `moving` (the parts the run
 * moves, each with the index of its body among the run's bodies) with its body, never as a film. Per effect that falls
 * on them, its density (the particles it asks for over the volume they fill), its velocity (its wind plus its fall,
 * m/s × 1000) and its size; S3e: the air the drops in the air are in (the wind of the effects that rain, weighted by
 * their densities), the studio floor when it is on (a film under the effects' region, ◆) and the set's fine samples.
 * Null when nothing falls or nothing is there to wet.
 */
export function wetPartsSpec(state: ProjectState, moving: ReadonlyMap<NodeId, number> = new Map()): WetPartsSpec | null {
  const sources: PartsSourceSpec[] = [];
  const feeding = partsFeedingEffects(state);
  const wind: Vec3 = [0, 0, 0];
  let rain = 0;
  const lo: [number, number] = [Infinity, Infinity];
  const hi: [number, number] = [-Infinity, -Infinity];
  for (const e of feeding) {
    const kind = PARTS_FEED[e.preset];
    const volume = effectVolumeM3(state, e);
    if (!kind || !(volume > 0)) continue;
    const density = requestedParticles(state, e) / (volume * 1e9);
    const velocity: Vec3 = [e.wind[0] * 1000, e.wind[1] * 1000, (e.wind[2] - e.fallSpeed * e.gravity) * 1000];
    sources.push({ kind, density, velocity, sizeMm: Math.min(50, e.sizeMm), sizeVar: Math.min(1, Math.max(0, e.sizeVar)), effect: e.id });
    // S3e: the air of the drops in the air, from the effects that rain.
    if (kind === 'DROPS' && density > 0) {
      for (let k = 0; k < 3; k++) wind[k] += density * e.wind[k] * 1000;
      rain += density;
    }
    const r = effectRegion(state, e);
    lo[0] = Math.min(lo[0], r.min[0]);
    lo[1] = Math.min(lo[1], r.min[1]);
    hi[0] = Math.max(hi[0], r.max[0]);
    hi[1] = Math.max(hi[1], r.max[1]);
  }
  if (sources.length === 0) return null;
  const cache = new Map<NodeId, Mat4>();
  const parts: WetPartEntry[] = [];
  for (const id of allParts(state)) {
    const node = state.scene.nodes[id];
    if (!node?.mesh || !effectiveVisible(state, id) || !getMesh(node.mesh.id)) continue;
    const body = moving.get(id);
    // U16: the family it is given in Physics ▸ Weather, or its material's; and whether it keeps dry or bare.
    const family = surfaceFamily(state, id);
    const w = wettability(family);
    const weather = partWeatherOf(node);
    parts.push({
      node: id,
      mesh: node.mesh.id,
      matrix: worldMatrix(state, id, cache),
      family,
      advancingDeg: w.advancingDeg,
      recedingDeg: w.recedingDeg,
      soakMmPerS: w.soakMmPerS,
      porosity: w.porosity,
      film: body === undefined && SET_PIECES_AS_FILM && isSetPiece(node),
      ...(weather.getsWet ? {} : { dry: true }),
      ...(weather.getsDust ? {} : { noDust: true }),
      ...(body !== undefined ? { body } : {}),
    });
  }
  if (parts.length === 0) return null;
  const floor: WetFloorSpec | null =
    state.studio.floor && hi[0] > lo[0] && hi[1] > lo[1] ? { z: 0, min: [lo[0], lo[1]], max: [hi[0], hi[1]], cellMm: FLOOR_CELL_MM, maxCells: FLOOR_MAX_CELLS } : null;
  return {
    seed: (feeding[0]?.seed ?? 0) >>> 0,
    cellMm: PARTS_CELL_MM,
    maxSamples: PARTS_MAX_SAMPLES,
    reposeDeg: DUST_REPOSE_DEG,
    snowReposeDeg: SNOW_REPOSE_DEG,
    parts,
    sources,
    wind: rain > 0 ? [wind[0] / rain, wind[1] / rain, wind[2] / rain] : [0, 0, 0],
    floor,
    edgeCellMm: PARTS_EDGE_CELL_MM,
    edgeBudget: PARTS_EDGE_BUDGET,
  };
}

/** S3e: true when a spec needs version 2 of WPT1 (rt_phys::wet_parts `PartsSpec::needs_v2`). */
export function needsWpt2(spec: WetPartsSpec): boolean {
  return spec.parts.some((p) => p.body !== undefined) || (spec.wind ?? [0, 0, 0]).some((v) => v !== 0) || !!spec.floor || (spec.edgeCellMm ?? 0) !== 0 || (spec.edgeBudget ?? 0) !== 0;
}

/** The rows of the 3 × 4 object-to-world part of a column-major matrix. */
function rows(m: Mat4): number[] {
  return [m[0], m[4], m[8], m[12], m[1], m[5], m[9], m[13], m[2], m[6], m[10], m[14]];
}

/**
 * The WPT1 bytes of a spec (engine/crates/rt-phys/src/wet_parts.rs reads them). Little-endian 4-byte words:
 *
 *   "WPT1"  u32 version (1 or 2); u32 seed; f32 cell_mm; u32 max_samples; f32 repose_deg snow_repose_deg;
 *   u32 meshes; per mesh: u32 vertices indices; f32 positions[3 × vertices]; u32 indices[]
 *   u32 parts; per part: u32 mesh; f32 rows[12]; f32 advancing_deg receding_deg soak_mm_s;
 *              u32 flags (1: a film; U16: 2: dry, 4: no dust or snow);
 *              v2: u32 body (0xffffffff: it stays)
 *   u32 sources; per source: u32 kind (0 drops, 1 dust, 2 snow); f32 density; f32 velocity[3]; f32 size_mm size_var
 *   v2: f32 wind[3]; u32 floor (0, 1); [f32 z x0 y0 x1 y1 cell_mm; u32 max_cells]; f32 edge_cell_mm; u32 edge_budget
 *
 * Version 1 when the spec needs none of version 2 (`needsWpt2`).
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
  const v2 = needsWpt2(spec);
  let size = 4 + 4 * 7;
  for (const m of list) size += 8 + 4 * (m.positions.length + m.indices.length);
  size += 4 + parts.length * (v2 ? 72 : 68) + 4 + spec.sources.length * 28;
  if (v2) size += 4 * (3 + 1 + (spec.floor ? 7 : 0) + 2);
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
  u32(v2 ? WPT1_VERSION : 1);
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
    u32((part.film ? PART_FILM : 0) | (part.dry ? PART_DRY : 0) | (part.noDust ? PART_NO_DUST : 0));
    if (v2) u32(part.body ?? NO_BODY);
  }
  u32(spec.sources.length);
  for (const s of spec.sources) {
    u32(s.kind === 'DROPS' ? 0 : s.kind === 'DUST' ? 1 : 2);
    f32(s.density);
    for (const v of s.velocity) f32(v);
    f32(s.sizeMm);
    f32(s.sizeVar);
  }
  if (v2) {
    for (const v of spec.wind ?? [0, 0, 0]) f32(v);
    const fl = spec.floor;
    u32(fl ? 1 : 0);
    if (fl) {
      for (const v of [fl.z, fl.min[0], fl.min[1], fl.max[0], fl.max[1], fl.cellMm]) f32(v);
      u32(fl.maxCells);
    }
    f32(spec.edgeCellMm ?? 0);
    u32(spec.edgeBudget ?? 0);
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
  /**
   * S3d: per frame, the drops in the air: u32 n; (u32 part; f32 x y z r (world, the radius of its sphere))[n]. Absent
   * in a track of before (no drop in the air).
   */
  falling?: string;
  /** S3f: the shape of every version of every drop (`DropShape`, f32 × 15 each, in the order of `drops`). Absent in a track of before (round drops). */
  shapes?: string;
  /** S3e: per cell of the studio floor first wet: u32 cell, u32 frame. Absent without a floor (the layout says). */
  floor?: string;
  /** S3e: the grains of the dust drawn over its layer (the motes tail of WETP): the dust effect's size, its variation, the seed. */
  motes?: { sizeMm: number; sizeVar: number; seed: number };
}

/** S3e: the studio floor at a frame: its cells (nx × ny of `cell` mm from (x0, y0), at height z) and their bytes. */
export interface FloorFrame {
  nx: number;
  ny: number;
  x0: number;
  y0: number;
  cell: number;
  z: number;
  /** Wet, dust and snow bytes of each cell, row after row. */
  values: Uint8Array;
}

/** S3d: a drop in the air at a frame: the part it left (its index in the track), its centre (world) and its radius. */
export interface FallingDropFrame {
  part: number;
  position: Vec3;
  radius: number;
}

/** What the parts hold at a frame: per part its samples' bytes and its drops. */
/** A drop on a part at a frame: its triangle, its centre (object space), its contact radius; S3f: its shape. */
export interface PartsFrameDrop {
  triangle: number;
  position: Vec3;
  radius: number;
  shape?: DropShape;
}

export interface PartsFrame {
  parts: { values: Uint8Array; drops: PartsFrameDrop[] }[];
  /** Drops on all the parts and drips so far (the meter). */
  drops: number;
  drips: number;
  /** S3d: the drops in the air. */
  falling: FallingDropFrame[];
  /** S3e: the studio floor, when the run had one. */
  floor?: FloorFrame;
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

  f32(v: number): void {
    this.room(4);
    this.view.setFloat32(this.length, v, true);
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

/** S3e: the studio floor a layout describes: its cells and their rates of dust and snow. */
export interface FloorLayout {
  nx: number;
  ny: number;
  x0: number;
  y0: number;
  cell: number;
  z: number;
  dust: Float32Array | null;
  snow: Float32Array | null;
}

/**
 * The parts a layout describes: per part its triangles, samples, flags and cap angle (rt_phys `WetParts::layout`); S3e:
 * a resolution may take two bytes (flag 4), and the studio floor follows the parts when the run has one.
 */
export function parseLayout(bytes: Uint8Array): { cellMm: number; parts: { triangles: number; samples: number; capAngleDeg: number; resolution: Uint16Array; dust: Float32Array | null; snow: Float32Array | null }[]; floor: FloorLayout | null } | null {
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
    const wide = (flags & 4) !== 0;
    const pad = Math.ceil((wide ? 2 : 1) * triangles / 4) * 4;
    if (at + pad > bytes.length) return null;
    const resolution = new Uint16Array(triangles);
    for (let t = 0; t < triangles; t++) resolution[t] = wide ? v.getUint16(at + 2 * t, true) : bytes[at + t];
    at += pad;
    let total = 0;
    for (const r of resolution) {
      if (r < 1 || r > MAX_FINE_RESOLUTION) return null;
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
  // S3e: the studio floor.
  let floor: FloorLayout | null = null;
  if (at < bytes.length) {
    if (at + 28 > bytes.length) return null;
    const nx = v.getUint32(at, true);
    const ny = v.getUint32(at + 4, true);
    const flags = v.getUint32(at + 24, true);
    const n = nx * ny;
    if (!(n > 0) || at + 28 + 4 * n * ((flags & 1) + ((flags >> 1) & 1)) !== bytes.length) return null;
    const head = { nx, ny, x0: v.getFloat32(at + 8, true), y0: v.getFloat32(at + 12, true), cell: v.getFloat32(at + 16, true), z: v.getFloat32(at + 20, true) };
    at += 28;
    const floats = (on: boolean): Float32Array | null => {
      if (!on) return null;
      const out = new Float32Array(n);
      for (let c = 0; c < n; c++) out[c] = v.getFloat32(at + 4 * c, true);
      at += 4 * n;
      return out;
    };
    const dust = floats((flags & 1) !== 0);
    const snow = floats((flags & 2) !== 0);
    floor = { ...head, dust, snow };
  }
  return at === bytes.length ? { cellMm, parts, floor } : null;
}

/** S3e: most steps of a triangle's grid per side (rt_core::weather::MAX_FINE_RESOLUTION; WETP takes 255). */
export const MAX_FINE_RESOLUTION = 4095;

/**
 * The track of a run, a frame at a time from the engine's records (rt_phys::wet_parts `WetParts::frame`):
 * `u32 changed; (u32 id part tri; f32 x y z a)[changed]; u32 gone; u32 ids[gone]; u32 wetted; u32 samples[];
 * u32 wiped; u32 samples[]; u32 drips; u32 drops; u32 falling; (u32 id part; f32 x y z r)[falling]`; S3f: then
 * `u32 shaped (= changed); f32 shape[15][changed]` (a record of before, without it: round drops); S3e: then, when the
 * layout has the studio floor, `u32 floor_wetted; u32 cells[floor_wetted]`. The first record is frame 0 (the dry parts
 * at step 0).
 */
export class PartsTrackWriter {
  private readonly versions = new Words();
  private readonly wet = new Words();
  private readonly wiped = new Words();
  private readonly counts = new Words();
  private readonly falling = new Words();
  /** S3f: the shape of each version, and whether any record carried shapes (an engine of before writes none). */
  private readonly shapes = new Words();
  private shaped = false;
  /** S3e: the studio floor's cells of the layout (0: no floor), and each cell's first wet frame. */
  private readonly floorCells: number;
  private readonly floorWet = new Words();
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
    /** S3e: the dust's motes the track draws (its size, variation and seed), or none. */
    readonly motes: PartsTrack['motes'] | null = null,
  ) {
    this.layoutText = toBase64(layout);
    this.samples = parts.reduce((n, p) => n + p.samples, 0);
    const fl = parseLayout(layout)?.floor ?? null;
    this.floorCells = fl ? fl.nx * fl.ny : 0;
  }

  get frames(): number {
    return this.count;
  }

  /** Drops on the parts at the last frame, and drips so far. */
  lastDrops = 0;
  /** S3d: drops in the air at the last frame. */
  lastFalling = 0;
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
    // S3f: the shapes come at the end (none in a record of before): check them before anything is written.
    let shapesAt = -1;
    let floorAt = -1;
    {
      let end = 1 + 7 * nc;
      end += 1 + word(end);
      end += 1 + word(end);
      end += 1 + word(end);
      end += 2;
      end += 1 + 6 * word(end);
      if (end < words) {
        if (word(end) !== nc || end + 1 + 15 * nc > words) throw new Error('parts record: the shapes are not one per changed drop');
        for (let k = 0; k < 15 * nc; k++) if (!Number.isFinite(view.getFloat32(4 * (end + 1 + k), true))) throw new Error('parts record: a shape that is not finite');
        shapesAt = end + 1;
        end += 1 + 15 * nc;
        // S3e: the studio floor's cells, when the run has a floor.
        if (this.floorCells > 0) {
          if (end >= words || end + 1 + word(end) !== words) throw new Error('parts record: the floor does not follow the shapes');
          for (let k = 0; k < word(end); k++) if (word(end + 1 + k) >= this.floorCells) throw new Error('parts record: a cell of the floor that is not there');
          floorAt = end;
        } else if (end !== words) throw new Error('parts record: the shapes are not one per changed drop');
      } else if (this.floorCells > 0) {
        throw new Error('parts record: the floor does not follow the shapes');
      }
    }
    if (shapesAt >= 0) this.shaped = true;
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
      if (shapesAt >= 0) this.shapes.raw(record.subarray(4 * (shapesAt + 15 * k), 4 * (shapesAt + 15 * (k + 1))));
      else for (const v of ROUND_SHAPE) this.shapes.f32(v);
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
    // S3d: the drops in the air, whole: u32 n; (u32 id part; f32 x y z r)[n].
    at += 2;
    const nf = word(at);
    if (at + 1 + 6 * nf > words) throw new Error('parts record: truncated');
    if (4 * (at + 1 + 6 * nf) !== record.byteLength && shapesAt < 0) throw new Error('parts record: bytes after the end');
    const fallingAt = this.falling.length;
    this.falling.u32(nf);
    for (let k = 0; k < nf; k++) {
      const f = at + 1 + 6 * k;
      if (word(f + 1) >= this.parts.length) {
        this.falling.length = fallingAt;
        throw new Error('parts record: a drop in the air from a part that is not there');
      }
      this.falling.raw(record.subarray(4 * (f + 1), 4 * (f + 6)));
    }
    // S3e: the floor's cells first wet in this frame.
    if (floorAt >= 0) {
      for (let k = 0; k < word(floorAt); k++) {
        this.floorWet.u32(word(floorAt + 1 + k));
        this.floorWet.u32(frame);
      }
    }
    this.counts.u32(drops);
    this.counts.u32(this.drips);
    this.lastDrops = drops;
    this.lastFalling = nf;
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
      falling: toBase64(this.falling.data()),
      ...(this.shaped ? { shapes: toBase64(this.shapes.data()) } : {}),
      ...(this.floorCells > 0 ? { floor: toBase64(this.floorWet.data()) } : {}),
      ...(this.motes ? { motes: { ...this.motes } } : {}),
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
  /** S3d: the words of the drops in the air, and where each frame's begin (its count), or null (a track of before). */
  falling: Uint32Array | null;
  fallingAt: Uint32Array | null;
  /** S3f: the shape of each version (15 floats each), or null (a track of before: round drops). */
  shapes: Float32Array | null;
  /** S3e: the frame each cell of the studio floor first got wet (NEVER), or null without a floor. */
  floorWet: Uint32Array | null;
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
  // S3d: the drops in the air, a block per frame.
  let falling: Uint32Array | null = null;
  let fallingAt: Uint32Array | null = null;
  if (track.falling !== undefined) {
    falling = words(track.falling, 1);
    if (!falling) return null;
    const floats = new Float32Array(falling.buffer);
    fallingAt = new Uint32Array(track.frames);
    let at = 0;
    for (let f = 0; f < track.frames; f++) {
      if (at >= falling.length) return null;
      fallingAt[f] = at;
      const n = falling[at];
      if (at + 1 + 5 * n > falling.length) return null;
      for (let k = 0; k < n; k++) {
        const w = at + 1 + 5 * k;
        if (falling[w] >= track.parts.length) return null;
        for (let c = 1; c < 5; c++) if (!Number.isFinite(floats[w + c])) return null;
        if (!(floats[w + 4] > 0)) return null;
      }
      at += 1 + 5 * n;
    }
    if (at !== falling.length) return null;
  }
  // S3f: the shapes, one per version.
  let shapes: Float32Array | null = null;
  if (track.shapes !== undefined) {
    const w = words(track.shapes, SHAPE_FLOATS);
    if (!w || w.length !== (versions.length / 9) * SHAPE_FLOATS) return null;
    shapes = new Float32Array(w.buffer);
    for (let v = 0; v < versions.length / 9; v++) if (!isValidShape(Array.from(shapes.subarray(SHAPE_FLOATS * v, SHAPE_FLOATS * (v + 1))))) return null;
  }
  // S3e: the studio floor's first wet frames.
  let floorWet: Uint32Array | null = null;
  if (layout.floor) {
    const n = layout.floor.nx * layout.floor.ny;
    floorWet = new Uint32Array(n).fill(NEVER);
    if (track.floor !== undefined) {
      const fw = words(track.floor, 2);
      if (!fw) return null;
      for (let k = 0; k < fw.length; k += 2) {
        if (fw[k] >= n) return null;
        floorWet[fw[k]] = Math.min(floorWet[fw[k]], fw[k + 1]);
      }
    }
  } else if (track.floor !== undefined) return null;
  return { layout, first, versions, versionFloats, wetFrame, wipeStart, wipeFrames, counts, falling, fallingAt, shapes, floorWet };
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
    (t.falling === undefined || typeof t.falling === 'string') &&
    (t.shapes === undefined || typeof t.shapes === 'string') &&
    (t.floor === undefined || typeof t.floor === 'string') &&
    (t.motes === undefined || (!!t.motes && typeof t.motes === 'object' && t.motes.sizeMm > 0 && t.motes.sizeMm <= 50 && t.motes.sizeVar >= 0 && t.motes.sizeVar <= 1 && Number.isInteger(t.motes.seed))) &&
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
    const drop: PartsFrameDrop = { triangle: d.versions[9 * v + 2], position: [fl[9 * v + 3], fl[9 * v + 4], fl[9 * v + 5]], radius: fl[9 * v + 6] };
    // S3f: its shape, when the track has them.
    if (d.shapes) drop.shape = Array.from(d.shapes.subarray(SHAPE_FLOATS * v, SHAPE_FLOATS * (v + 1)));
    parts[d.versions[9 * v + 1]].drops.push(drop);
  }
  // S3d: the drops in the air at this frame.
  const falling: FallingDropFrame[] = [];
  if (d.falling && d.fallingAt) {
    const fl = new Float32Array(d.falling.buffer);
    const at = d.fallingAt[f];
    for (let k = 0; k < d.falling[at]; k++) {
      const w = at + 1 + 5 * k;
      falling.push({ part: d.falling[w], position: [fl[w + 1], fl[w + 2], fl[w + 3]], radius: fl[w + 4] });
    }
  }
  const value: PartsFrame = { parts, drops: d.counts[2 * f], drips: d.counts[2 * f + 1], falling };
  // S3e: the studio floor at this frame.
  const fl = d.layout.floor;
  if (fl && d.floorWet) {
    const n = fl.nx * fl.ny;
    const values = new Uint8Array(3 * n);
    for (let c = 0; c < n; c++) {
      values[3 * c] = d.floorWet[c] <= f ? 255 : 0;
      if (fl.dust) values[3 * c + 1] = dustByte(1 - Math.exp(-fl.dust[c] * t));
      if (fl.snow) values[3 * c + 2] = snowByte(fl.snow[c] * t);
    }
    value.floor = { nx: fl.nx, ny: fl.ny, x0: fl.x0, y0: fl.y0, cell: fl.cell, z: fl.z, values };
  }
  frameCache.set(track, { frame: f, value });
  return value;
}

/** The resolutions of a recorded part's triangles (its layout; S3e: up to MAX_FINE_RESOLUTION), or null. */
export function partsResolution(track: PartsTrack, part: number): Uint16Array | null {
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
export function partWeather(track: PartsTrack, frame: PartsFrame, k: number, tris: readonly number[] | null): { resolution: Uint16Array; values: Uint8Array; drops: PartsFrameDrop[] } | null {
  const res = partsResolution(track, k);
  const p = frame.parts[k];
  if (!res || !p) return null;
  if (!tris) return { resolution: res, values: p.values, drops: p.drops };
  const first = new Uint32Array(res.length + 1);
  for (let t = 0; t < res.length; t++) first[t + 1] = first[t] + ((res[t] + 1) * (res[t] + 2)) / 2;
  const local = new Map<number, number>();
  let total = 0;
  const resolution = new Uint16Array(tris.length);
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

/**
 * S3e: a part's weather with no triangle finer than 255 steps per side (the one byte of WETP, for an engine without bit
 * 12): a finer triangle is read at the points of a grid of 255 steps, each taking its nearest fine sample; the others
 * stay as they are. The same object when none is finer.
 */
export function coarseWeather<W extends { resolution: ArrayLike<number>; values: Uint8Array }>(w: W): W | (Omit<W, 'resolution' | 'values'> & { resolution: Uint16Array; values: Uint8Array }) {
  const res = Array.from(w.resolution);
  if (res.every((r) => r <= 255)) return w;
  const out: number[] = [];
  let first = 0;
  const resolution = new Uint16Array(res.length);
  res.forEach((r, t) => {
    const n = ((r + 1) * (r + 2)) / 2;
    if (r <= 255) {
      resolution[t] = r;
      for (let k = 0; k < 3 * n; k++) out.push(w.values[3 * first + k]);
    } else {
      const c = 255;
      resolution[t] = c;
      for (let j = 0; j <= c; j++) {
        for (let i = 0; i <= c - j; i++) {
          let fi = Math.round((i * r) / c);
          let fj = Math.round((j * r) / c);
          if (fi + fj > r) fi = r - fj;
          if (fi < 0) [fi, fj] = [0, r];
          const k = first + fj * (r + 1) - (fj * Math.max(0, fj - 1)) / 2 + fi;
          out.push(w.values[3 * k], w.values[3 * k + 1], w.values[3 * k + 2]);
        }
      }
    }
    first += n;
  });
  return { ...w, resolution, values: Uint8Array.from(out) };
}

/** S3d: what a frame holds on the parts, for the meter: rain (a wet sample, a drop on a part or in the air), dust, snow. */
export interface PartsShown {
  /** Parts that hold something (a wet, dusty or snowy sample, a drop). */
  parts: number;
  /** Drops on the parts, and in the air. */
  drops: number;
  falling: number;
  rain: boolean;
  dust: boolean;
  snow: boolean;
}

/**
 * S3d: what `frame` holds, over the parts `drawn` takes (all of them by default: the meter counts those the viewport
 * draws). The drops in the air count when the part they left is drawn.
 */
export function partsShown(frame: PartsFrame, drawn: (k: number) => boolean = () => true): PartsShown {
  const out: PartsShown = { parts: 0, drops: 0, falling: 0, rain: false, dust: false, snow: false };
  frame.parts.forEach((p, k) => {
    if (!drawn(k)) return;
    let wet = p.drops.length > 0;
    let dust = false;
    let snow = false;
    for (let i = 0; i < p.values.length; i += 3) {
      wet ||= p.values[i] > 0;
      dust ||= p.values[i + 1] > 0;
      snow ||= p.values[i + 2] > 0;
      if (wet && dust && snow) break;
    }
    if (wet || dust || snow) out.parts++;
    out.drops += p.drops.length;
    out.rain ||= wet;
    out.dust ||= dust;
    out.snow ||= snow;
  });
  out.falling = frame.falling.filter((f) => drawn(f.part)).length;
  out.rain ||= out.falling > 0;
  return out;
}

// ---------------------------------------------------------------------------
// S3e: the dust's motes (the twin of rt_core::weather `motes_on`, for the Fast preview)
// ---------------------------------------------------------------------------

/** S3e: the dust share of a sample above which grains show over the layer (rt_core::weather::MOTE_THRESHOLD, ◆). */
export const MOTE_THRESHOLD = 0.3;
/** S3e: the share of the grains a sample's dust stands for that are drawn one by one (rt_core::weather::MOTE_SHARE, ◆). */
export const MOTE_SHARE = 0.02;
/** S3e: most motes of all the parts together (rt_core::weather::MAX_MOTES). */
export const MAX_MOTES = 20_000;

/** S3e: Wellons' `lowbias32` (rt_core::weather::hash32). */
export function hash32(x: number): number {
  x = (x ^ (x >>> 16)) >>> 0;
  x = Math.imul(x, 0x7feb352d) >>> 0;
  x = (x ^ (x >>> 15)) >>> 0;
  x = Math.imul(x, 0x846ca68b) >>> 0;
  return (x ^ (x >>> 16)) >>> 0;
}

/** S3e: the uniform number of a hash, its top 24 bits (rt_core::weather::unit32). */
function unit32(h: number): number {
  return (h >>> 8) / 16777216;
}

/** S3e: a grain of dust on a part: its triangle, its foot on the surface and the face's normal (object space), its radius. */
export interface Mote {
  triangle: number;
  position: Vec3;
  normal: Vec3;
  radius: number;
}

/**
 * S3e: the grains of dust of a part's weather (its triangles' resolutions and samples' bytes) on the triangles `corners`
 * gives (object space, outward), sample by sample in their order, at most `budget`: where a sample's share under dust
 * passes MOTE_THRESHOLD, MOTE_SHARE of the `−ln(1 − c) / (π r̄²)` grains per unit area its share stands for, over the
 * sample's share of its triangle; each placed in the cell around its sample and sized by `hash32` of the seed, the
 * triangle, the sample and its number (rt_core::weather `motes_on`, in doubles: the same grains but for one whose count
 * falls on a rounding edge).
 */
export function motesOn(resolution: ArrayLike<number>, values: Uint8Array, corners: (t: number) => [Vec3, Vec3, Vec3] | null, spec: { sizeMm: number; sizeVar: number; seed: number }, budget = MAX_MOTES): Mote[] {
  const out: Mote[] = [];
  const rMean = 0.5 * spec.sizeMm;
  const v = Math.min(1, Math.max(0, spec.sizeVar));
  const grain = Math.PI * rMean * rMean * (1 + (v * v) / 3);
  if (!(grain > 0)) return out;
  let first = 0;
  for (let t = 0; t < resolution.length; t++) {
    const r = resolution[t];
    const n = ((r + 1) * (r + 2)) / 2;
    const at = first;
    first += n;
    let thick = false;
    for (let k = 0; k < n && !thick; k++) thick = values[3 * (at + k) + 1] >= MOTE_THRESHOLD * 255;
    if (!thick) continue;
    const c = corners(t);
    if (!c) continue;
    const [a, b, d] = c;
    const e1: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const e2: Vec3 = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
    const cr: Vec3 = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const len = Math.hypot(cr[0], cr[1], cr[2]);
    if (!(len > 0)) continue;
    const normal: Vec3 = [cr[0] / len, cr[1] / len, cr[2] / len];
    const area = (0.5 * len) / n;
    for (let j = 0; j <= r; j++) {
      for (let i = 0; i <= r - j; i++) {
        const k = j * (r + 1) - (j * Math.max(0, j - 1)) / 2 + i;
        const share = values[3 * (at + k) + 1] / 255;
        if (share < MOTE_THRESHOLD) continue;
        const mean = (MOTE_SHARE * -Math.log(1 - Math.min(0.999, share)) * area) / grain;
        const key = hash32((spec.seed ^ hash32((t ^ hash32(k)) >>> 0)) >>> 0);
        const count = Math.floor(mean + unit32(hash32((key ^ 0x6d6f7465) >>> 0)));
        for (let m = 0; m < count; m++) {
          if (out.length >= budget) return out;
          const h = hash32((key ^ hash32((m + 1) >>> 0)) >>> 0);
          const h2 = hash32(h);
          const h3 = hash32(h2);
          let u = Math.max(0, i + unit32(h) - 0.5) / r;
          let w = Math.max(0, j + unit32(h2) - 0.5) / r;
          if (u + w > 1) {
            const s = u + w;
            u /= s;
            w /= s;
          }
          const radius = Math.max(0.01, rMean * (1 + v * (2 * unit32(h3) - 1)));
          out.push({ triangle: t, position: [a[0] + e1[0] * u + e2[0] * w, a[1] + e1[1] * u + e2[1] * w, a[2] + e1[2] * u + e2[2] * w], normal, radius });
        }
      }
    }
  }
  return out;
}
