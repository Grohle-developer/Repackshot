// How the weather of the scene treats each part (phase U16, SPEC §3.1 "Physics", UI.md §2.4 Physics ▸ Weather): whether
// it gets wet, whether dust and snow settle on it, and which wettability family it wets as (the node's `physics`
// `getsWet`, `getsDust` and `surface`, core/physics.ts; absent: on, on, its material's). The spec of the simulation of
// the parts (core/wet-parts.ts `wetPartsSpec`) writes them as the WPT1 part flags (rt_phys::wet_parts `PART_DRY`,
// `PART_NO_DUST`) and the family's angles; the inspector shows them, mixed over a selection, and the size past which a
// drop runs down a face of that family (`criticalRadiusMm`, the engine's formula bit for bit).
//
// `criticalRadiusMm` is rt_phys::wet::critical_radius ported to the page with core/f32math.ts (the engine's f32 and
// its fmath, rounded the same way at every step): `tests/u16-weather.test.ts` requires the same bits as the engine's
// fixture (tests/fixtures/u16-critical.json, written by engine/crates/rt-phys/tests/wet_parts_u16.rs) for every family
// at several tilts, so the line of the inspector is a number the model gives (rule 10).

import { wettability, wettabilityFamilyOf, type WettabilityFamily } from '../data/wettability';
import { add, DEG_TO_RAD, div, f, mul, PI, sin, sinCos, sqrt, sub } from './f32math';
import { partsUnder, type NodeId, type SceneNode } from './scene';
import type { ProjectState } from './store';

/** Surface tension of water, N/mm (rt_phys::wet::SURFACE_TENSION). */
const SURFACE_TENSION = f(7.2e-5);
/** Weight per volume of water, N/mm³ (rt_phys::wet::WATER_WEIGHT). */
const WATER_WEIGHT = f(9.81e-6);

/** `K(θ)`, a cap's volume over the cube of its contact radius (rt_core::optics::glass::cap_volume_factor). */
function capVolumeFactor(s: number, c: number): number {
  const num = add(sub(2, mul(3, c)), mul(mul(c, c), c));
  const den = mul(mul(mul(3, s), s), s);
  return div(mul(PI, num), den);
}

/**
 * The critical contact radius of a drop, mm, on a face `sinAlpha` steep for contact angles `advancingDeg ≥
 * recedingDeg` (rt_phys::wet::critical_radius): past it, its weight along the face beats the hysteresis of its contact
 * line and it runs. Infinite on a level face; 0 without hysteresis.
 */
export function criticalRadiusMm(advancingDeg: number, recedingDeg: number, sinAlpha: number): number {
  const a = f(advancingDeg);
  const r = f(recedingDeg);
  // cap_constants: the cap at the mean angle, clamped to 1..179°.
  let mean = mul(0.5, add(a, r));
  mean = mean < 1 ? 1 : mean > 179 ? 179 : mean;
  const [s, c] = sinCos(mul(mean, DEG_TO_RAD));
  const k = capVolumeFactor(s, c);
  const h0 = sub(sinCos(mul(r, DEG_TO_RAD))[1], sinCos(mul(a, DEG_TO_RAD))[1]);
  const hysteresis = h0 > 0 ? h0 : 0;
  const tilt = Math.abs(f(sinAlpha));
  if (tilt <= 0 || hysteresis <= 0) return hysteresis <= 0 ? 0 : Infinity;
  return sqrt(div(mul(mul(2, SURFACE_TENSION), hysteresis), mul(mul(WATER_WEIGHT, k), tilt)));
}

/** The sine of a face's tilt from the horizontal, degrees, as the engine's fmath gives it. */
export function sinOfTilt(deg: number): number {
  return sin(mul(f(deg), DEG_TO_RAD));
}

/** The size across (twice the critical contact radius, mm) past which a drop runs down a face of `family` tilted `tiltDeg`. */
export function runSizeMm(family: WettabilityFamily, tiltDeg = 90): number {
  const w = wettability(family);
  return 2 * criticalRadiusMm(w.advancingDeg, w.recedingDeg, sinOfTilt(tiltDeg));
}

/** A part's weather: whether it gets wet, whether dust and snow settle on it, and the family it is given (null: its material's). */
export interface PartWeather {
  getsWet: boolean;
  getsDust: boolean;
  surface: WettabilityFamily | null;
}

export function partWeatherOf(node: SceneNode | undefined): PartWeather {
  const p = node?.physics;
  return { getsWet: p?.getsWet !== false, getsDust: p?.getsDust !== false, surface: p?.surface ?? null };
}

/** The family a part's material wets as (data/wettability.ts `wettabilityFamilyOf`; Paint without a material). */
export function materialFamily(state: ProjectState, part: NodeId): WettabilityFamily {
  const node = state.scene.nodes[part];
  return wettabilityFamilyOf(node?.material ? state.materials[node.material] : undefined);
}

/** The family a part wets as: the one its Physics section gives it, or its material's. */
export function surfaceFamily(state: ProjectState, part: NodeId): WettabilityFamily {
  return partWeatherOf(state.scene.nodes[part]).surface ?? materialFamily(state, part);
}

/** The parts an edit of Physics ▸ Weather applies to: every part under the selection (a group's, a model's), once each. */
export function weatherParts(state: ProjectState, ids: readonly NodeId[]): NodeId[] {
  return partsUnder(state, [...ids]).filter((id) => state.scene.nodes[id]?.kind === 'PART');
}

/** One value of a selection, or null when its parts differ (the inspector shows it indeterminate). */
export type Mixed<T> = T | null;

/** What Physics ▸ Weather shows for a set of parts. */
export interface WeatherView {
  parts: NodeId[];
  getsWet: Mixed<boolean>;
  getsDust: Mixed<boolean>;
  /** The family given to every part, 'AUTO' when every part takes its material's, null when they differ. */
  surface: Mixed<WettabilityFamily | 'AUTO'>;
  /** The families the parts' materials give, in order, once each (the label of *From the material*). */
  materialFamilies: WettabilityFamily[];
  /** The families the parts wet as now, in order, once each. */
  families: WettabilityFamily[];
}

function one<T>(values: readonly T[]): Mixed<T> {
  if (values.length === 0) return null;
  return values.every((v) => v === values[0]) ? values[0] : null;
}

function unique<T>(values: readonly T[]): T[] {
  return values.filter((v, i) => values.indexOf(v) === i);
}

export function weatherView(state: ProjectState, ids: readonly NodeId[]): WeatherView {
  const parts = weatherParts(state, ids);
  const w = parts.map((p) => partWeatherOf(state.scene.nodes[p]));
  return {
    parts,
    getsWet: one(w.map((x) => x.getsWet)),
    getsDust: one(w.map((x) => x.getsDust)),
    surface: one(w.map((x) => x.surface ?? 'AUTO')),
    materialFamilies: unique(parts.map((p) => materialFamily(state, p))),
    families: unique(parts.map((p) => surfaceFamily(state, p))),
  };
}
