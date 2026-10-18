// Ambient effects (phase S4a, SPEC §3.1): particles of the air (dust, pollen, rain, snow, a dust cloud, ash,
// rising bubbles, falling confetti) as data of the project. An effect holds only parameters: the engine's
// simulator (engine/crates/rt-sim) turns them into particles, the same in the Fast preview (`particles_eval` of
// rt.wasm) and in the render (the RSB `FXAM` section, io/rsb.ts). Every change is an action of the store and can
// be undone (`effect/add`, `effect/remove`, `effect/set`, `effect/preset`); the effects are saved with the
// project, and a project saved before S4a opens with none.
//
// S3 adds the drop shape, the mixes of shapes (`shapeMix`), a drop's length and tip and the variation of the drops' and
// capsules' lengths (`dropTail`, `dropTip`, `shapeVar`): the S3 fields of FXAM, written only when one is set and only for
// an engine that draws them (rt_core::FEATURE_DROPS; `effectFxam`'s `drops`).
//
// The eight photographer's knobs of the interface are views of these fields: Amount is `density` (or `count`),
// Size `sizeMm`, Energy `energy`, Chaos `chaos`, Wind the horizontal part of `wind` as a speed and a direction,
// Gravity `gravity`, Variation `sizeVar` and `fallVar` together, Seed `seed`. Advanced shows the rest.

import { AVAILABLE_EFFECTS, DEFAULT_MIX, DROP_TAIL, DROP_TIP, EFFECT_SHAPES, effectPreset, isEffectKind, type EffectKind, type EffectMaterial, type EffectShape, type EffectValues, type ShapeMix } from '../data/effects';
import { materialPreset } from '../data/materials';
import type { RGB } from '../data/types';
import { isEmptyBox, type Box, type Vec3 } from './math';
import { productBounds } from './scene';
import type { ActionBase, ProjectState } from './store';

/** The largest number of particles of one effect a browser evaluates unless Settings say otherwise. */
export const BROWSER_PARTICLE_CAP = 100_000;
/** The same for the native engine of the desktop application. */
export const NATIVE_PARTICLE_CAP = 1_000_000;
/** The most an effect may ever ask for (the engine's own limit, rt_sim::MAX_COUNT). */
export const MAX_PARTICLES = 1 << 24;
/** The most particles the Fast preview draws of an effect. */
export const PREVIEW_PARTICLES = 50_000;
/** Most tints of a palette (rt_sim::MAX_PALETTE). */
export const MAX_PALETTE = 4;

export type AmountMode = 'DENSITY' | 'COUNT';
export type RegionMode = 'SCENE' | 'BOX';

/** Where the particles are: a box around the scene with a margin, or a box of its own; a band of heights. */
export interface EffectRegion {
  mode: RegionMode;
  /** SCENE: the margin around the product's bounds, mm (the floor stays the bottom). */
  marginMm: number;
  /** BOX: centre and full size, mm. */
  center: Vec3;
  size: Vec3;
}

export interface EffectBand {
  on: boolean;
  /** Heights kept, mm. */
  min: number;
  max: number;
}

/** The cloud envelope (the dust cloud): particles are born inside a soft sphere instead of the region box. */
export interface EffectCloud {
  on: boolean;
  center: Vec3;
  radiusMm: number;
  softness: number;
}

export interface AmbientEffect {
  id: string;
  /** The preset it came from (or was last set to). */
  preset: EffectKind;
  /** The name the person gave it; empty: the preset's. */
  name: string;
  enabled: boolean;
  amountMode: AmountMode;
  /** Particles per cubic metre of the region (or of the cloud), in DENSITY mode. */
  density: number;
  /** Particles, in COUNT mode. */
  count: number;
  sizeMm: number;
  sizeVar: number;
  shape: EffectShape;
  /** Speed a particle is born with, m/s. */
  energy: number;
  /** Turbulence strength as a share of its scale (0..2). */
  chaos: number;
  turbulenceScaleMm: number;
  /** How fast the turbulence changes, m/s. */
  turbulenceSpeed: number;
  /** Wind velocity, m/s (x, y, z). */
  wind: Vec3;
  /** Terminal fall speed at 1 g, m/s. */
  fallSpeed: number;
  fallVar: number;
  /** Multiple of g; negative rises. */
  gravity: number;
  /** Turns per second of a disc. */
  spin: number;
  /** Capsule length over speed, s. */
  streak: number;
  /** S3: a drop's length (its tip's centre from its body's, in body radii, 0..16) and tip (over the body's radius, 0..1). */
  dropTail: number;
  dropTip: number;
  /** S3: how much each drop's (or capsule's) length varies, 0..1. */
  shapeVar: number;
  /** S3: a mix of shapes (on: each particle picks one by the weights; `shape` is then what an older engine draws). */
  shapeMix: ShapeMix;
  region: EffectRegion;
  band: EffectBand;
  cloud: EffectCloud;
  /** A key of the material catalogue (data/materials.ts), or '' for the effect's own material. */
  material: string;
  /** The effect's own material (the preset's, copied when it was set). */
  ownMaterial: EffectMaterial;
  tintVar: number;
  palette: RGB[];
  /** The instant the effect is frozen at, s (Freeze at). */
  time: number;
  camera: boolean;
  reflections: boolean;
  shadows: boolean;
  /** The most particles of this effect (0: the engine's cap, Settings ▸ Render engine). */
  cap: number;
  seed: number;
  /**
   * S3c: its particles fall on the parts when the physics bar runs (rain wets them, dust and snow pile on them;
   * core/wet-parts.ts). Absent: no (an effect of before S3c, and a new one until it is switched on).
   */
  wetParts?: boolean;
}

/** What `effect/set` may change: anything but the id. */
export type EffectPatch = Partial<Omit<AmbientEffect, 'id'>>;

export type EffectAction =
  | ({ type: 'effect/add'; preset: EffectKind } & ActionBase)
  | ({ type: 'effect/remove'; id: string } & ActionBase)
  | ({ type: 'effect/set'; id: string; patch: EffectPatch } & ActionBase)
  | ({ type: 'effect/preset'; id: string; preset: EffectKind } & ActionBase);

// ------------------------------------------------------------------ the engine's cap

let engineCap = BROWSER_PARTICLE_CAP;

/**
 * The cap of the engine that renders here (Settings ▸ Render engine ▸ Particles per effect, 0: automatic, the
 * browser's or the native engine's). main.ts sets it when the engine or the setting changes, then refreshes the
 * Doctor (`doctor/refresh`).
 */
export function setEngineParticleCap(cap: number): void {
  engineCap = Number.isFinite(cap) && cap > 0 ? Math.min(MAX_PARTICLES, Math.round(cap)) : BROWSER_PARTICLE_CAP;
}

export function engineParticleCap(): number {
  return engineCap;
}

/** The engine's cap for a setting (0: automatic) and where it runs. */
export function particleCapFor(setting: number, native: boolean): number {
  if (setting > 0) return Math.min(MAX_PARTICLES, Math.round(setting));
  return native ? NATIVE_PARTICLE_CAP : BROWSER_PARTICLE_CAP;
}

// ------------------------------------------------------------------ creation

const finite = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Wind as a vector from a speed (m/s) and the direction it blows towards (degrees from +X towards +Y). */
export function windVector(speed: number, dirDeg: number, z = 0): Vec3 {
  const a = (dirDeg * Math.PI) / 180;
  const round = (v: number) => Math.round(v * 1e6) / 1e6;
  return [round(speed * Math.cos(a)), round(speed * Math.sin(a)), z];
}

/** The horizontal wind of an effect as speed (m/s) and direction (degrees, 0..360). */
export function windPolar(wind: Vec3): { speed: number; dirDeg: number } {
  const speed = Math.hypot(wind[0], wind[1]);
  const deg = speed > 0 ? (Math.atan2(wind[1], wind[0]) * 180) / Math.PI : 0;
  return { speed, dirDeg: Math.round(((deg % 360) + 360) % 360 * 1e4) / 1e4 };
}

/** The product's bounds, or a box of the part size standing on the floor at the origin when there is none. */
function sceneBox(state: ProjectState): Box {
  const b = productBounds(state);
  if (!isEmptyBox(b)) return b;
  const h = Math.max(1, state.scene.partSizeMm) / 2;
  return { min: [-h, -h, 0], max: [h, h, 2 * h] };
}

/** The fields of a preset (its values and its material) as effect fields, for a scene of this size. */
function presetFields(state: ProjectState, key: EffectKind): Omit<AmbientEffect, 'id' | 'name' | 'enabled' | 'region' | 'band' | 'time' | 'seed' | 'cap' | 'amountMode' | 'count' | 'material'> {
  const p = effectPreset(key);
  const v: EffectValues = p?.values ?? AVAILABLE_EFFECTS[0].values!;
  const m: EffectMaterial = p?.material ?? AVAILABLE_EFFECTS[0].material!;
  const b = sceneBox(state);
  const size = Math.max(1, state.scene.partSizeMm);
  const radius = v.cloudRadius * size;
  return {
    preset: key,
    density: v.density,
    sizeMm: v.sizeMm,
    sizeVar: v.sizeVar,
    shape: v.shape,
    energy: v.energy,
    chaos: v.chaos,
    turbulenceScaleMm: v.turbulenceScaleMm,
    turbulenceSpeed: v.turbulenceSpeed,
    wind: windVector(v.windSpeed, v.windDirDeg),
    fallSpeed: v.fallSpeed,
    fallVar: v.fallVar,
    gravity: v.gravity,
    spin: v.spin,
    streak: v.streak,
    dropTail: v.dropTail ?? DROP_TAIL,
    dropTip: v.dropTip ?? DROP_TIP,
    shapeVar: v.shapeVar ?? 0,
    shapeMix: { ...(v.mix ?? DEFAULT_MIX) },
    cloud: {
      on: v.cloudRadius > 0,
      // Around the base of the product, a third of the cloud below the floor (it is mirrored above it).
      center: [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, Math.max(0, b.min[2]) + radius / 3],
      radiusMm: Math.round(radius > 0 ? radius : size),
      softness: v.cloudSoftness,
    },
    ownMaterial: { ...m, baseColor: [m.baseColor[0], m.baseColor[1], m.baseColor[2]] },
    tintVar: v.tintVar,
    palette: v.palette.map((c) => [c[0], c[1], c[2]] as RGB),
    camera: v.camera,
    reflections: v.reflections,
    shadows: v.shadows,
  };
}

/** The id an added effect gets: `fx<n>`, one more than the largest there is. */
export function nextEffectId(effects: readonly AmbientEffect[]): string {
  let n = 0;
  for (const e of effects) {
    const m = /^fx(\d+)$/.exec(e.id);
    if (m) n = Math.max(n, Number(m[1]));
  }
  return `fx${n + 1}`;
}

/** A new effect of preset `key` for this scene: the region is the scene's box with a margin of 3/4 the part size. */
export function makeEffect(state: ProjectState, key: EffectKind, id = nextEffectId(state.effects)): AmbientEffect {
  const b = sceneBox(state);
  const size = Math.max(1, state.scene.partSizeMm);
  const margin = Math.round(0.75 * size);
  const n = Number(/^fx(\d+)$/.exec(id)?.[1] ?? 1);
  return {
    id,
    name: '',
    enabled: true,
    amountMode: 'DENSITY',
    count: 2_000,
    region: {
      mode: 'SCENE',
      marginMm: margin,
      // What a box of its own starts from: the scene's box with the margin.
      center: [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (Math.max(0, b.min[2] - margin) + b.max[2] + margin) / 2],
      size: [b.max[0] - b.min[0] + 2 * margin, b.max[1] - b.min[1] + 2 * margin, b.max[2] + margin - Math.max(0, b.min[2] - margin)],
    },
    band: { on: false, min: 0, max: Math.round(b.max[2] + margin) },
    material: '',
    time: 0,
    cap: 0,
    seed: n,
    ...presetFields(state, key),
  };
}

// ------------------------------------------------------------------ what the engine gets

/** The region box of an effect in model space (Z up, mm), never below the floor, with its band applied. */
export function effectRegion(state: ProjectState, e: AmbientEffect): Box {
  let min: Vec3;
  let max: Vec3;
  if (e.region.mode === 'BOX') {
    min = [0, 1, 2].map((k) => e.region.center[k] - Math.abs(e.region.size[k]) / 2) as Vec3;
    max = [0, 1, 2].map((k) => e.region.center[k] + Math.abs(e.region.size[k]) / 2) as Vec3;
  } else {
    const b = sceneBox(state);
    const m = Math.max(0, e.region.marginMm);
    min = [b.min[0] - m, b.min[1] - m, b.min[2] - m];
    max = [b.max[0] + m, b.max[1] + m, b.max[2] + m];
  }
  if (e.band.on && e.band.min < e.band.max) {
    min[2] = Math.max(min[2], e.band.min);
    max[2] = Math.min(max[2], e.band.max);
  }
  min[2] = Math.max(0, min[2]);
  max[2] = Math.max(min[2], max[2]);
  return { min, max };
}

/** Cubic metres the particles fill: the cloud's sphere, or the region box. */
export function effectVolumeM3(state: ProjectState, e: AmbientEffect): number {
  if (e.cloud.on && e.cloud.radiusMm > 0) return ((4 / 3) * Math.PI * (e.cloud.radiusMm / 1000) ** 3);
  const r = effectRegion(state, e);
  return ((r.max[0] - r.min[0]) * (r.max[1] - r.min[1]) * (r.max[2] - r.min[2])) / 1e9;
}

/** The particles an effect asks for: its count, or its density times its volume. */
export function requestedParticles(state: ProjectState, e: AmbientEffect): number {
  const n = e.amountMode === 'COUNT' ? e.count : e.density * effectVolumeM3(state, e);
  return Math.max(0, Math.min(MAX_PARTICLES, Math.round(finite(n, 0))));
}

/** The most particles the engine evaluates of an effect: its own cap, at most the engine's. */
export function effectCap(e: AmbientEffect, engine = engineCap): number {
  return e.cap > 0 ? Math.min(e.cap, engine) : engine;
}

/** The particles the engine evaluates of an effect (none when it is off). */
export function effectParticles(state: ProjectState, e: AmbientEffect, engine = engineCap): number {
  return e.enabled ? Math.min(requestedParticles(state, e), effectCap(e, engine)) : 0;
}

/** The effects whose amount is above their cap (what the Doctor warns about). */
export function overCap(state: ProjectState, engine = engineCap): { effect: AmbientEffect; requested: number; cap: number }[] {
  return state.effects
    .filter((e) => e.enabled)
    .map((effect) => ({ effect, requested: requestedParticles(state, effect), cap: effectCap(effect, engine) }))
    .filter((o) => o.requested > o.cap);
}

/** The amount of every effect over its cap brought down to it (the Doctor's fix). */
export function fitToCap(state: ProjectState, engine = engineCap): ProjectState {
  const over = new Map(overCap(state, engine).map((o) => [o.effect.id, o]));
  if (over.size === 0) return state;
  const effects = state.effects.map((e) => {
    const o = over.get(e.id);
    if (!o) return e;
    if (e.amountMode === 'COUNT') return { ...e, count: o.cap };
    // Just under the cap after rounding.
    return { ...e, density: Math.floor((e.density * o.cap) / o.requested) };
  });
  return { ...state, effects };
}

/** The `FXAM` fields of an effect (rt_sim::AmbientParams), in the engine's units (mm, mm/s). */
export interface FxamFields {
  kind: number;
  seed: number;
  time: number;
  count: number;
  regionCenter: Vec3;
  regionHalf: Vec3;
  band: [number, number];
  sizeMm: number;
  sizeVar: number;
  shape: number;
  fallSpeed: number;
  fallVar: number;
  wind: Vec3;
  turbulence: Vec3;
  cloudCenter: Vec3;
  cloudRadius: number;
  cloudSoftness: number;
  materialId: number;
  tintVar: number;
  flags: number;
  streak: number;
  gravity: number;
  energy: number;
  spin: number;
  palette: RGB[];
  /** S4b: the forward lobe of the particles' material (share 0..1, asymmetry). */
  forward: number;
  forwardG: number;
  /** S3: the weights of the mix (sphere, disc, capsule, drop; all 0: every particle is `shape`). */
  mix: [number, number, number, number];
  /** S3: a drop's length and tip, and the variation of the drops' and capsules' lengths. */
  dropTail: number;
  dropTip: number;
  shapeVar: number;
}

/** `FXAM.flags`. */
export const FX_FLAG_CAMERA = 1;
export const FX_FLAG_REFLECTIONS = 2;
export const FX_FLAG_SHADOW = 4;

const SHAPE_CODES: Record<EffectShape, number> = { SPHERE: 0, DISC: 1, CAPSULE: 2, DROP: 3 };

/** S3: the weights of an effect's mix in the engine's order, or null when it draws one shape (off, or no weight). */
export function mixWeights(e: AmbientEffect): [number, number, number, number] | null {
  const m = e.shapeMix;
  if (!m?.on) return null;
  const w = EFFECT_SHAPES.map((k) => Math.max(0, finite(m[k], 0))) as [number, number, number, number];
  return w.some((x) => x > 0) ? w : null;
}

/** True when some particle of the effect can be of `shape` (its shape, or a shape of its mix with a weight). */
export function effectHasShape(e: AmbientEffect, shape: EffectShape): boolean {
  const w = mixWeights(e);
  return w ? w[EFFECT_SHAPES.indexOf(shape)] > 0 : e.shape === shape;
}

/** S3: the shape a mix draws most (the first of the heaviest), what an engine without mixes draws for every particle. */
export function heaviestShape(e: AmbientEffect): EffectShape {
  const w = mixWeights(e);
  if (!w) return e.shape;
  let best = 0;
  for (let i = 1; i < 4; i++) if (w[i] > w[best]) best = i;
  return EFFECT_SHAPES[best];
}

/** True when an effect renders with its own material (no catalogue key, or one the catalogue does not have). */
export function usesOwnMaterial(e: AmbientEffect): boolean {
  return !e.material || !materialPreset(e.material);
}

/**
 * S4b: the forward lobe an effect's particles get, `[share, g]`: its own material's (an opaque one only: the engine
 * gives a clear material none), none with a material of the catalogue.
 */
export function effectForward(e: AmbientEffect): [number, number] {
  const m = e.ownMaterial;
  if (!usesOwnMaterial(e) || m.kind === 'GLASS' || !(m.transmission <= 0)) return [0, 0];
  const share = clamp(finite(m.forward ?? 0, 0), 0, 1);
  return share > 0 ? [share, clamp(finite(m.forwardG ?? 0, 0), -0.95, 0.95)] : [0, 0];
}

/**
 * The engine's parameters of an effect whose material is RSB material `materialId`. `drops` (S3) is whether the engine
 * draws drops and mixes (rt_core::FEATURE_DROPS): without it a mix is its heaviest shape, a drop a sphere, and no S3
 * field is written.
 */
export function effectFxam(state: ProjectState, e: AmbientEffect, materialId: number, engine = engineCap, drops = true): FxamFields {
  const [forward, forwardG] = effectForward(e);
  const r = effectRegion(state, e);
  const mm = (v: number) => v * 1000;
  const pos = (v: number) => Math.max(0, finite(v, 0));
  return {
    kind: effectPreset(e.preset)?.code ?? 0,
    seed: Math.max(0, Math.round(finite(e.seed, 0))) >>> 0,
    time: finite(e.time, 0),
    count: effectParticles(state, e, engine),
    regionCenter: [(r.min[0] + r.max[0]) / 2, (r.min[1] + r.max[1]) / 2, (r.min[2] + r.max[2]) / 2],
    regionHalf: [(r.max[0] - r.min[0]) / 2, (r.max[1] - r.min[1]) / 2, (r.max[2] - r.min[2]) / 2],
    // The band is already in the box.
    band: [0, 0],
    sizeMm: pos(e.sizeMm),
    sizeVar: clamp(finite(e.sizeVar, 0), 0, 1),
    shape: drops || heaviestShape(e) !== 'DROP' ? (SHAPE_CODES[heaviestShape(e)] ?? 0) : 0,
    fallSpeed: mm(pos(e.fallSpeed)),
    fallVar: clamp(finite(e.fallVar, 0), 0, 1),
    wind: [mm(finite(e.wind[0], 0)), mm(finite(e.wind[1], 0)), mm(finite(e.wind[2], 0))],
    turbulence: [pos(e.chaos) * pos(e.turbulenceScaleMm), pos(e.turbulenceScaleMm), mm(pos(e.turbulenceSpeed))],
    cloudCenter: e.cloud.on ? [finite(e.cloud.center[0], 0), finite(e.cloud.center[1], 0), finite(e.cloud.center[2], 0)] : [0, 0, 0],
    cloudRadius: e.cloud.on ? pos(e.cloud.radiusMm) : 0,
    cloudSoftness: clamp(finite(e.cloud.softness, 0), 0, 1),
    materialId,
    tintVar: clamp(finite(e.tintVar, 0), 0, 1),
    flags: (e.camera ? FX_FLAG_CAMERA : 0) | (e.reflections ? FX_FLAG_REFLECTIONS : 0) | (e.shadows ? FX_FLAG_SHADOW : 0),
    streak: (drops ? effectHasShape(e, 'CAPSULE') : heaviestShape(e) === 'CAPSULE') ? pos(e.streak) : 0,
    gravity: finite(e.gravity, 1),
    energy: mm(pos(e.energy)),
    spin: finite(e.spin, 0),
    palette: e.palette.slice(0, MAX_PALETTE),
    forward,
    forwardG,
    mix: (drops && mixWeights(e)) || [0, 0, 0, 0],
    dropTail: drops ? clamp(finite(e.dropTail, DROP_TAIL), 0, MAX_DROP_TAIL) : DROP_TAIL,
    dropTip: drops ? clamp(finite(e.dropTip, DROP_TIP), 0, 1) : DROP_TIP,
    shapeVar: drops ? clamp(finite(e.shapeVar, 0), 0, 1) : 0,
  };
}

/** S3: the longest drop (rt_sim::MAX_DROP_TAIL). */
export const MAX_DROP_TAIL = 16;

/** S3: true when an effect's FXAM carries the S3 fields (rt_sim::AmbientParams::has_s3_fields, on the f32 values). */
export function hasS3Fields(e: FxamFields): boolean {
  const f = Math.fround;
  return e.shape === 3 || e.mix.some((w) => f(w) !== 0) || f(e.shapeVar) !== 0 || f(e.dropTail) !== f(DROP_TAIL) || f(e.dropTip) !== f(DROP_TIP);
}

/** Bytes of an `FXAM` payload (rt_sim::FXAM_BYTES; 192 in S4a, 200 with the forward lobe of S4b). */
export const FXAM_BYTES = 200;
/** Bytes of an `FXAM` payload with the S3 fields (rt_sim::FXAM_S3_BYTES). */
export const FXAM_S3_BYTES = 228;

/**
 * The `FXAM` payload of an effect, little-endian, in the field order of rt_sim::params (the writer of the RSB and the
 * Fast preview's `rt_particles_eval` both send these bytes).
 */
export function fxamPayload(e: FxamFields): Uint8Array {
  const s3 = hasS3Fields(e);
  const out = new Uint8Array(s3 ? FXAM_S3_BYTES : FXAM_BYTES);
  const v = new DataView(out.buffer);
  let o = 0;
  const u32 = (x: number) => {
    v.setUint32(o, x >>> 0, true);
    o += 4;
  };
  const f32 = (x: number) => {
    v.setFloat32(o, x, true);
    o += 4;
  };
  const vec = (x: readonly number[]) => {
    f32(x[0]);
    f32(x[1]);
    f32(x[2]);
  };
  u32(e.kind);
  u32(e.seed);
  f32(e.time);
  u32(e.count);
  vec(e.regionCenter);
  vec(e.regionHalf);
  f32(e.band[0]);
  f32(e.band[1]);
  f32(e.sizeMm);
  f32(e.sizeVar);
  u32(e.shape);
  f32(e.fallSpeed);
  f32(e.fallVar);
  vec(e.wind);
  vec(e.turbulence);
  vec(e.cloudCenter);
  f32(e.cloudRadius);
  f32(e.cloudSoftness);
  u32(e.materialId);
  f32(e.tintVar);
  u32(e.flags);
  f32(e.streak);
  f32(e.gravity);
  f32(e.energy);
  f32(e.spin);
  const tints = e.palette.slice(0, MAX_PALETTE);
  u32(tints.length);
  for (let i = 0; i < MAX_PALETTE; i++) vec(tints[i] ?? [1, 1, 1]);
  f32(e.forward);
  f32(e.forwardG);
  if (s3) {
    for (const w of e.mix) f32(w);
    f32(e.dropTail);
    f32(e.dropTip);
    f32(e.shapeVar);
  }
  return out;
}

// ------------------------------------------------------------------ the reducer

function withEffect(state: ProjectState, id: string, f: (e: AmbientEffect) => AmbientEffect): ProjectState {
  const i = state.effects.findIndex((e) => e.id === id);
  if (i < 0) return state;
  const next = f(state.effects[i]);
  if (next === state.effects[i]) return state;
  const effects = state.effects.slice();
  effects[i] = next;
  return { ...state, effects };
}

/** Keeps a patch inside the ranges the interface offers (a value from a hand-edited file, a drag past the end). */
function cleanPatch(patch: EffectPatch): EffectPatch {
  const out: EffectPatch = { ...patch };
  const nonNeg = ['density', 'count', 'sizeMm', 'energy', 'chaos', 'turbulenceScaleMm', 'turbulenceSpeed', 'fallSpeed', 'streak', 'time', 'cap'] as const;
  for (const k of nonNeg) if (out[k] !== undefined) (out as Record<string, number>)[k] = Math.max(0, finite(out[k], 0));
  for (const k of ['sizeVar', 'fallVar', 'tintVar', 'shapeVar', 'dropTip'] as const) if (out[k] !== undefined) out[k] = clamp(finite(out[k], 0), 0, 1);
  if (out.dropTail !== undefined) out.dropTail = clamp(finite(out.dropTail, DROP_TAIL), 0, MAX_DROP_TAIL);
  if (out.shapeMix !== undefined) {
    const m = out.shapeMix;
    out.shapeMix = { on: m.on === true, SPHERE: Math.max(0, finite(m.SPHERE, 0)), DISC: Math.max(0, finite(m.DISC, 0)), CAPSULE: Math.max(0, finite(m.CAPSULE, 0)), DROP: Math.max(0, finite(m.DROP, 0)) };
  }
  if (out.count !== undefined) out.count = Math.min(MAX_PARTICLES, Math.round(out.count));
  if (out.cap !== undefined) out.cap = Math.min(MAX_PARTICLES, Math.round(out.cap));
  if (out.seed !== undefined) out.seed = Math.max(0, Math.min(0xffffffff, Math.round(finite(out.seed, 0))));
  if (out.palette !== undefined) out.palette = out.palette.slice(0, MAX_PALETTE);
  if (out.preset !== undefined && !isEffectKind(out.preset)) delete out.preset;
  if (out.wetParts !== undefined) out.wetParts = out.wetParts === true;
  return out;
}

function samePatch(e: AmbientEffect, patch: EffectPatch): boolean {
  return (Object.keys(patch) as (keyof EffectPatch)[]).every((k) => JSON.stringify(e[k]) === JSON.stringify(patch[k]));
}

export function reduceEffects(state: ProjectState, action: EffectAction): ProjectState {
  switch (action.type) {
    case 'effect/add': {
      const p = effectPreset(action.preset);
      if (!p || p.soon) return state;
      return { ...state, effects: [...state.effects, makeEffect(state, action.preset)] };
    }
    case 'effect/remove': {
      const effects = state.effects.filter((e) => e.id !== action.id);
      return effects.length === state.effects.length ? state : { ...state, effects };
    }
    case 'effect/set': {
      const patch = cleanPatch(action.patch);
      return withEffect(state, action.id, (e) => (samePatch(e, patch) ? e : { ...e, ...patch }));
    }
    case 'effect/preset': {
      const p = effectPreset(action.preset);
      if (!p || p.soon) return state;
      // Everything the preset decides; where the effect is, its instant, its seed, its cap and its name stay.
      return withEffect(state, action.id, (e) => (e.preset === action.preset ? e : { ...e, ...presetFields(state, action.preset) }));
    }
    default:
      return state;
  }
}

// ------------------------------------------------------------------ files

/**
 * The effects of a project file, checked: an entry that is not an effect is dropped, a preset this version does
 * not know (a newer file) keeps its parameters under the first preset, and every field it lacks takes the value
 * of its preset (a file of an earlier version of S4a). A project saved before S4a has none.
 */
export function normalizeEffects(raw: unknown, state: ProjectState): AmbientEffect[] {
  if (!Array.isArray(raw)) return [];
  const out: AmbientEffect[] = [];
  const seen = new Set<string>();
  for (const r of raw) {
    if (typeof r !== 'object' || r === null || Array.isArray(r)) continue;
    const o = r as Record<string, unknown>;
    if (typeof o.id !== 'string' || !o.id || seen.has(o.id)) continue;
    seen.add(o.id);
    const preset: EffectKind = isEffectKind(o.preset) && !effectPreset(o.preset)!.soon ? o.preset : AVAILABLE_EFFECTS[0].key;
    const base = makeEffect(state, preset, o.id);
    const merged: AmbientEffect = { ...base };
    for (const k of Object.keys(base) as (keyof AmbientEffect)[]) {
      if (k === 'id' || k === 'preset') continue;
      const have = o[k];
      const want = base[k];
      if (have === undefined) continue;
      const kind = (v: unknown) => (Array.isArray(v) ? 'array' : typeof v);
      if (kind(have) !== kind(want)) continue;
      if (typeof want === 'object' && want !== null && !Array.isArray(want)) {
        (merged as unknown as Record<string, unknown>)[k] = { ...want, ...(have as object) };
      } else {
        (merged as unknown as Record<string, unknown>)[k] = have;
      }
    }
    if (!['DENSITY', 'COUNT'].includes(merged.amountMode)) merged.amountMode = base.amountMode;
    if (!(EFFECT_SHAPES as readonly string[]).includes(merged.shape)) merged.shape = base.shape;
    if (!['SCENE', 'BOX'].includes(merged.region.mode)) merged.region = base.region;
    const vec = (v: unknown, fallback: Vec3): Vec3 => (Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'number' && Number.isFinite(x)) ? [v[0], v[1], v[2]] : fallback);
    merged.wind = vec(merged.wind, base.wind);
    merged.region = { ...merged.region, center: vec(merged.region.center, base.region.center), size: vec(merged.region.size, base.region.size) };
    merged.cloud = { ...merged.cloud, center: vec(merged.cloud.center, base.cloud.center) };
    merged.palette = Array.isArray(merged.palette) ? merged.palette.filter((c) => Array.isArray(c) && c.length === 3 && c.every((x) => typeof x === 'number' && Number.isFinite(x))).slice(0, MAX_PALETTE) : [];
    const own = merged.ownMaterial as Partial<EffectMaterial>;
    merged.ownMaterial = { ...base.ownMaterial, ...own, baseColor: vec(own.baseColor, base.ownMaterial.baseColor as Vec3) };
    const next: AmbientEffect = { ...merged, ...cleanPatch(merged), id: o.id, preset };
    // S3c: falls on the parts (absent unless a file says so).
    if (o.wetParts === true) next.wetParts = true;
    else delete next.wetParts;
    out.push(next);
  }
  return out;
}
