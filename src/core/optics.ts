// A camera's optics beyond the plain simple lens (phase O1, STUDIO-TOOLS §1 mode 1; the interface called it the thin
// lens until O4): the bokeh of the simple lens, tilt and shift, the effect filters in front of the lens (phase O3a),
// and the traced lens (phase O2, core/traced-lens.ts). What the engine does with it is rt-core `optics` (the RSB
// `LENS` section, written by io/rsb.ts); this module is the project's side: the fields, the neutral optics (a camera
// without them renders exactly as before O1), the parameters of a bokeh type, the two lens models, and the limits.
//
// O4: the bokeh and the Advanced optics are the simple lens's. A traced camera keeps them in its state (switching back
// to the simple lens finds them as they were) but nothing applies a bokeh to it (`opticsForBokeh` refuses); the traced
// lens has a tilt of its own (`tracedTiltDeg`), and the shift is the camera's, whichever lens it has.

import { BOKEH_NEUTRAL, bokehParams, bokehType, type BokehThin, type PupilProfile } from '../data/bokeh';
import { LENS_FILTER_GRADES, lensFilterType, MAX_LENS_FILTERS, STAR_POINTS, type LensFilterKey } from '../data/lens-filters';
import { DEFAULT_MASTER, newTracedLens, normalizeTracedLens, tracedLensTilts, type TracedLens } from './traced-lens';

/** One effect filter in front of the lens (O3a; data/lens-filters.ts). */
export interface LensFilter {
  type: LensFilterKey;
  /** Grade, one of LENS_FILTER_GRADES (1/8 to 2). */
  grade: number;
  /** Tint of the scattered light (gold, net, streak); null: the type's own. */
  tint: [number, number, number] | null;
  /** Star and streak: the angle of the first line from the horizontal, degrees; net: of its axes. */
  angleDeg: number;
  /** Star: 4, 6 or 8 points. */
  points: number;
}

/** The optics of a camera (CameraState.optics; absent on cameras made before O1, which are the neutral optics). */
export interface CameraOptics extends BokehThin {
  /** BOKEH_TYPES key last chosen, or null after a knob was moved by hand. */
  bokeh: string | null;
  /** The type's variant last chosen (null: the type's own parameters). */
  variant: string | null;
  /** Lens shift on the sensor, millimetres (right, up): moves the frame without changing the perspective. */
  shiftXMm: number;
  shiftYMm: number;
  /**
   * The simple lens's tilt, degrees, about an axis in the sensor plane `tiltAxisDeg` from the horizontal: the focus
   * plane turns (Scheimpflug). A traced lens has its own (`tracedTiltDeg`): before O4 the engine ignored this one with a
   * traced lens, so an old traced camera with a tilt left here must not start tilting.
   */
  tiltDeg: number;
  tiltAxisDeg: number;
  /**
   * O4: the traced lens's tilt and its axis, degrees, as `tiltDeg` (absent: 0). The engine turns the lens until its plane
   * of sharp focus is the simple lens's of the same values. Kept while the camera has the simple lens.
   */
  tracedTiltDeg?: number;
  tracedTiltAxisDeg?: number;
  /** O3a: the effect filters in front of the lens, in order, at most MAX_LENS_FILTERS (absent before O3a: none). */
  filters?: LensFilter[];
  /**
   * O2: the traced lens (absent or null: the enhanced thin lens). With it the iris (blades, roundness, rotation,
   * obstruction) sits at the lens's stop, the squeeze desqueezes and the chromatic aberration and the swirl are its
   * artistic overrides; the pupil profile, the cat's eye, the tilt and the pictures belong to the thin lens.
   */
  traced?: TracedLens | null;
}

/** The plain thin lens: what a camera without optics is. */
export const OPTICS_NEUTRAL: Readonly<CameraOptics> = {
  ...BOKEH_NEUTRAL,
  bokeh: null,
  variant: null,
  shiftXMm: 0,
  shiftYMm: 0,
  tiltDeg: 0,
  tiltAxisDeg: 0,
};

/** Limits of the engine (rt-core `optics`), which refuses a LENS section outside them. */
export const OPTICS_LIMITS = {
  blades: { min: 3, max: 18 },
  obstruction: { min: 0, max: 0.95 },
  squeeze: { min: 1, max: 4 },
  tiltDeg: { min: -12, max: 12 },
  shiftMm: { min: -24, max: 24 },
} as const;

/** A new filter of `type` with its defaults: grade 1/2, the type's tint, six points at 0°. */
export function newLensFilter(type: LensFilterKey): LensFilter {
  return { type, grade: 0.5, tint: null, angleDeg: 0, points: 6 };
}

/** A filter of a project file within the engine's limits, or null when it is not one. */
export function normalizeLensFilter(f: unknown): LensFilter | null {
  const r = (typeof f === 'object' && f !== null ? f : {}) as Partial<Record<keyof LensFilter, unknown>>;
  const type = typeof r.type === 'string' ? lensFilterType(r.type) : undefined;
  if (!type) return null;
  const grade = typeof r.grade === 'number' && Number.isFinite(r.grade) ? Math.min(2, Math.max(0, r.grade)) : 0.5;
  const tint =
    Array.isArray(r.tint) && r.tint.length === 3 && r.tint.every((v) => typeof v === 'number' && Number.isFinite(v) && v >= 0) && r.tint.some((v) => (v as number) > 0)
      ? (r.tint.map((v) => Math.min(4, v as number)) as [number, number, number])
      : null;
  const angleDeg = typeof r.angleDeg === 'number' && Number.isFinite(r.angleDeg) ? Math.min(360, Math.max(-360, r.angleDeg)) : 0;
  const points = STAR_POINTS.includes(r.points as number) ? (r.points as number) : 6;
  return { type: type.key, grade, tint, angleDeg, points };
}

/** The filters of optics (none before O3a). */
export function filtersOf(o: CameraOptics | undefined): LensFilter[] {
  return o?.filters ?? [];
}

/** True when a filter scatters something (a grade above 0). */
export function filterActive(f: LensFilter): boolean {
  return f.grade > 0 && lensFilterType(f.type) !== undefined;
}

/** The grades offered, from the weakest. */
export const FILTER_GRADES: readonly number[] = LENS_FILTER_GRADES;

/** The anamorphic squeezes offered (1 none). */
export const SQUEEZES: readonly number[] = [1, 1.33, 2];

const PROFILES: readonly PupilProfile[] = ['uniform', 'centreBright', 'ringBright', 'apodized'];

const clamp = (v: unknown, lo: number, hi: number, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;

/** The optics of a camera, neutral when it has none. */
export function opticsOf(cam: { optics?: CameraOptics }): CameraOptics {
  return cam.optics ?? OPTICS_NEUTRAL;
}

/** Every field of `o` within the engine's limits, unknown or missing ones as the neutral optics (a project file's). */
export function normalizeOptics(o: unknown): CameraOptics {
  const r = (typeof o === 'object' && o !== null ? o : {}) as Partial<Record<keyof CameraOptics, unknown>>;
  const n = OPTICS_NEUTRAL;
  const bladesRaw = clamp(r.blades, 0, OPTICS_LIMITS.blades.max, n.blades);
  const blades = bladesRaw < OPTICS_LIMITS.blades.min ? 0 : Math.round(bladesRaw);
  const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);
  return {
    bokeh: str(r.bokeh),
    variant: str(r.variant),
    blades,
    roundness: clamp(r.roundness, 0, 1, n.roundness),
    rotationDeg: clamp(r.rotationDeg, -360, 360, n.rotationDeg),
    mask: str(r.mask),
    profile: PROFILES.includes(r.profile as PupilProfile) ? (r.profile as PupilProfile) : n.profile,
    profileParam: clamp(r.profileParam, 0, 1, n.profileParam),
    obstruction: clamp(r.obstruction, 0, OPTICS_LIMITS.obstruction.max, n.obstruction),
    catsEye: clamp(r.catsEye, 0, 1, n.catsEye),
    squeeze: clamp(r.squeeze, 1, OPTICS_LIMITS.squeeze.max, n.squeeze),
    streaks: clamp(r.streaks, 0, 1, n.streaks),
    caAmount: clamp(r.caAmount, 0, 1, n.caAmount),
    swirl: clamp(r.swirl, 0, 1, n.swirl),
    onionAmplitude: clamp(r.onionAmplitude, 0, 1, n.onionAmplitude),
    texture: str(r.texture),
    shiftXMm: clamp(r.shiftXMm, OPTICS_LIMITS.shiftMm.min, OPTICS_LIMITS.shiftMm.max, n.shiftXMm),
    shiftYMm: clamp(r.shiftYMm, OPTICS_LIMITS.shiftMm.min, OPTICS_LIMITS.shiftMm.max, n.shiftYMm),
    tiltDeg: clamp(r.tiltDeg, OPTICS_LIMITS.tiltDeg.min, OPTICS_LIMITS.tiltDeg.max, n.tiltDeg),
    tiltAxisDeg: clamp(r.tiltAxisDeg, -360, 360, n.tiltAxisDeg),
    ...(r.tracedTiltDeg !== undefined ? { tracedTiltDeg: clamp(r.tracedTiltDeg, OPTICS_LIMITS.tiltDeg.min, OPTICS_LIMITS.tiltDeg.max, 0) } : {}),
    ...(r.tracedTiltAxisDeg !== undefined ? { tracedTiltAxisDeg: clamp(r.tracedTiltAxisDeg, -360, 360, 0) } : {}),
    ...(Array.isArray(r.filters)
      ? { filters: r.filters.map(normalizeLensFilter).filter((f): f is LensFilter => f !== null).slice(0, MAX_LENS_FILTERS) }
      : {}),
    ...(r.traced !== undefined ? { traced: normalizeTracedLens(r.traced) } : {}),
  };
}

/** The traced lens of optics (null: the thin lens). */
export function tracedOf(o: CameraOptics | undefined): TracedLens | null {
  return o?.traced ?? null;
}

/** True when the optics change nothing the engine renders (no LENS section is written for them). */
export function isNeutralOptics(o: CameraOptics | undefined): boolean {
  if (!o) return true;
  const n = OPTICS_NEUTRAL;
  return (
    (o.blades === 0 || o.blades < 3) &&
    o.mask === null &&
    o.texture === null &&
    (o.profile === 'uniform' || (o.profileParam === 0 && o.profile !== 'apodized')) &&
    o.obstruction === 0 &&
    o.catsEye === 0 &&
    o.squeeze === 1 &&
    o.caAmount === 0 &&
    o.swirl === 0 &&
    o.shiftXMm === n.shiftXMm &&
    o.shiftYMm === n.shiftYMm &&
    o.tiltDeg === 0 &&
    !filtersOf(o).some(filterActive) &&
    !tracedOf(o)
  );
}

/** The two lens models of Camera ▸ Lens (O4: *Simple lens* is the stored `thin`, the key every project keeps). */
export type LensModel = 'thin' | 'traced';

/** The lens model of optics: traced with a traced lens, the simple lens otherwise. */
export function lensModelOf(o: CameraOptics | undefined): LensModel {
  return tracedOf(o) ? 'traced' : 'thin';
}

/** True when a bokeh type can apply to optics `o`: only with the simple lens (O4; a traced lens makes its own). */
export function bokehApplies(o: CameraOptics | undefined): boolean {
  return lensModelOf(o) === 'thin';
}

/**
 * The optics of a bokeh type (and variant) on top of `current`: the type's simple-lens parameters replace the bokeh
 * fields; a type of the traced lens (O2) puts its lens on the camera (the bokeh fields stay, for the simple lens). The
 * tilt, the shift and the filters stay. Null for a type nothing here can do (wave optics), and, since O4, for any type
 * on a camera with a traced lens: the bokeh is a simple-lens option, and choosing one never takes a camera out of its
 * traced lens.
 */
export function opticsForBokeh(current: CameraOptics, key: string, variant?: string | null): CameraOptics | null {
  const type = bokehType(key);
  if (!type || !bokehApplies(current)) return null;
  if (type.requires === 'traced') {
    if (!type.lens || !normalizeTracedLens({ key: type.lens })) return null;
    return { ...current, traced: newTracedLens(type.lens) };
  }
  if (type.requires !== null) return null;
  const v = variant ?? null;
  const thin = bokehParams(type, v ?? undefined);
  if (!thin) return null;
  return {
    ...current,
    ...thin,
    bokeh: key,
    variant: v && type.variants.some((x) => x.key === v) ? v : null,
  };
}

/**
 * The optics with lens model `model` (Camera ▸ Lens ▸ Simple lens · Traced lens): everything else stays, the bokeh type
 * chosen and the Advanced optics of the simple lens among it, so that switching back finds them as they were (O4).
 * The traced lens comes in as the default one.
 */
export function opticsWithLensModel(o: CameraOptics, model: LensModel): CameraOptics {
  if (model === lensModelOf(o)) return o;
  return model === 'thin' ? { ...o, traced: null } : { ...o, traced: newTracedLens(DEFAULT_MASTER) };
}

/** The tilt the lens model of `o` uses, degrees, and its axis. */
export function tiltOf(o: CameraOptics): { deg: number; axisDeg: number } {
  return tracedOf(o) ? { deg: o.tracedTiltDeg ?? 0, axisDeg: o.tracedTiltAxisDeg ?? 0 } : { deg: o.tiltDeg, axisDeg: o.tiltAxisDeg };
}

/** The optics with the tilt of their lens model set (the other model's stays). */
export function withTilt(o: CameraOptics, deg: number, axisDeg: number): CameraOptics {
  const L = OPTICS_LIMITS.tiltDeg;
  const d = Math.min(L.max, Math.max(L.min, deg));
  return tracedOf(o) ? { ...o, tracedTiltDeg: d, tracedTiltAxisDeg: axisDeg } : { ...o, tiltDeg: d, tiltAxisDeg: axisDeg };
}

/** True when the lens of `o` can tilt: the simple lens always, a traced lens without cylinders (the engine refuses those). */
export function canTilt(o: CameraOptics): boolean {
  const tr = tracedOf(o);
  return !tr || tracedLensTilts(tr);
}

/** The thin-lens parameters of `o` as the bokeh data names them (for comparing with a type). */
export function thinOf(o: CameraOptics): BokehThin {
  const out = {} as Record<string, unknown>;
  for (const k of Object.keys(BOKEH_NEUTRAL) as (keyof BokehThin)[]) out[k] = o[k];
  return out as unknown as BokehThin;
}

/** The ids of the aperture pictures the optics need (the mask and the texture). */
export function opticsPictures(o: CameraOptics | undefined): string[] {
  if (!o) return [];
  return [o.mask, o.texture].filter((m): m is string => m !== null);
}
