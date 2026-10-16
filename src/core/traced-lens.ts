// The traced lens of a camera (phase O2, STUDIO-TOOLS §1 mode 2): a prescription of src/data/lenses.json that the
// engine traces surface by surface (rt-core `optics::traced`), and what the person set on it. The project keeps the
// catalogue key and the settings, never a copy of the surfaces (the keys are stable); `composeLens` puts together
// what the engine is sent: the person's coating and variable gap, and an anamorphic adapter in front of the lens it
// is mounted on. The numbers the interface shows of a lens (focal length, T-stop, distortion...) are the engine's
// (rule 10), never computed here.

import { lensPrescription, LENS_PRESCRIPTIONS, type CoatingId, type LensFocus, type LensFocusTravel, type LensPrescription, type LensSurface } from '../data/lenses';

/** A camera's traced lens (CameraOptics.traced). */
export interface TracedLens {
  /** LENS_PRESCRIPTIONS key. */
  key: string;
  /** The coating of every air–glass surface; null: the prescription's own. */
  coating: CoatingId | null;
  /** The lens's own variable air gap (the soft-focus lens's spherical aberration), mm; null: its normal value. */
  variable: number | null;
  /** Artistic, not physical (0: off): barrel −1 … pincushion 1. */
  distortion: number;
  /** Artistic: extra falloff towards the corner, 0 … 1. */
  vignetting: number;
  /** Artistic: spherical aberration from a plate at the stop, −1 under-corrected … 1 over-corrected. */
  spherical: number;
  /** Artistic: focus breathing, −1 none … 1 twice the lens's own. */
  breathing: number;
  /** An adapter (the anamorphic one): the LENS_PRESCRIPTIONS key of the lens behind it; null: DEFAULT_MASTER. */
  master: string | null;
}

/** The lens an adapter goes in front of when none is chosen. */
export const DEFAULT_MASTER = 'double_gauss_normal';
/** Air between an adapter and its lens, in the adapter's (scaled) units, mm. */
export const ADAPTER_GAP_MM = 5;
/** An adapter is scaled so that its strongest surface's radius is this many times the front semi-aperture of its lens. */
export const ADAPTER_CLEARANCE = 2.2;
/** An adapter's focus: its widest air gap travels from its afocal value to this share of it (the near end, closer focus). */
export const ADAPTER_FOCUS_TRAVEL = 0.6;

/** The limits of the artistic overrides (rt-core refuses a LENS section outside them). */
export const TRACED_LIMITS = {
  distortion: { min: -1, max: 1 },
  vignetting: { min: 0, max: 1 },
  spherical: { min: -1, max: 1 },
  breathing: { min: -1, max: 1 },
} as const;

/** True for an afocal adapter: it forms no image on its own and is mounted in front of a lens. */
export function isAdapter(p: LensPrescription): boolean {
  return p.focus.mode === 'none';
}

/** The lenses that form an image (everything but the adapters): what an adapter can go in front of. */
export function masterLenses(): LensPrescription[] {
  return LENS_PRESCRIPTIONS.filter((p) => !isAdapter(p));
}

/** A new traced lens of `key` with nothing overridden. */
export function newTracedLens(key: string): TracedLens {
  return { key, coating: null, variable: null, distortion: 0, vignetting: 0, spherical: 0, breathing: 0, master: null };
}

const COATING_IDS: readonly CoatingId[] = ['none', 'single', 'multi'];

const clamp = (v: unknown, lo: number, hi: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : 0);

/** A traced lens of a project file within the engine's limits, or null when it is not one (an unknown key). */
export function normalizeTracedLens(v: unknown): TracedLens | null {
  const r = (typeof v === 'object' && v !== null ? v : {}) as Partial<Record<keyof TracedLens, unknown>>;
  const p = typeof r.key === 'string' ? lensPrescription(r.key) : undefined;
  if (!p) return null;
  const variable = p.variable?.[0];
  const master = typeof r.master === 'string' && lensPrescription(r.master) && !isAdapter(lensPrescription(r.master)!) ? r.master : null;
  const L = TRACED_LIMITS;
  return {
    key: p.key,
    coating: COATING_IDS.includes(r.coating as CoatingId) ? (r.coating as CoatingId) : null,
    variable: variable && typeof r.variable === 'number' && Number.isFinite(r.variable) ? Math.min(variable.max, Math.max(variable.min, r.variable)) : null,
    distortion: clamp(r.distortion, L.distortion.min, L.distortion.max),
    vignetting: clamp(r.vignetting, L.vignetting.min, L.vignetting.max),
    spherical: clamp(r.spherical, L.spherical.min, L.spherical.max),
    breathing: clamp(r.breathing, L.breathing.min, L.breathing.max),
    master: isAdapter(p) ? master : null,
  };
}

/** What the engine is sent of a traced lens: one sequence of surfaces with its stop, focus and limits. */
export interface ComposedLens {
  surfaces: LensSurface[];
  /** Index of the aperture stop in `surfaces`. */
  stop: number;
  focus: LensFocus;
  /** The fastest f-number (0: none given). */
  fNumberMin: number;
  /** Floating focus: the magnifications of the base and near states (0, 0 otherwise). */
  magnification: [number, number];
  /** The image is squeezed this many times horizontally on the sensor (an anamorphic adapter): it is rendered desqueezed. */
  squeeze: number;
  /** Central obstruction of the aperture (a mirror lens), fraction of its diameter. */
  obstruction: number;
  /**
   * An adapter in front of a lens that focuses as one unit: its gap that follows the focus so that the squeezed
   * meridian focuses with the other (rt-core FOCUS_ANAMORPHIC); null otherwise.
   */
  squeezeFocus: LensFocusTravel | null;
}

/** The magnification of a floating-focus state as the catalogue writes it ("magnification 0.1"), 0 when none. */
export function stateMagnification(state: string | undefined): number {
  const m = /magnification\s+([0-9.]+)/.exec(state ?? '');
  return m ? Number(m[1]) : 0;
}

/** The surfaces of `p` with the coating of every air–glass surface replaced (null keeps the prescription's). */
function withCoating(surfaces: readonly LensSurface[], coating: CoatingId | null): LensSurface[] {
  return surfaces.map((s) => (coating !== null && s.coating !== null ? { ...s, coating } : { ...s }));
}

/**
 * The lens the engine traces for `t`: the prescription with the person's coating and variable gap; an adapter in
 * front of its lens (scaled to clear that lens's front, its placeholder stop left out, the lens's stop and focus).
 * Null for an unknown key.
 */
export function composeLens(t: TracedLens): ComposedLens | null {
  const p = lensPrescription(t.key);
  if (!p) return null;
  if (isAdapter(p)) {
    const masterKey = t.master && lensPrescription(t.master) && !isAdapter(lensPrescription(t.master)!) ? t.master : DEFAULT_MASTER;
    const master = composeLens({ ...t, key: masterKey, master: null });
    if (!master) return null;
    const own = withCoating(p.surfaces, t.coating).filter((s) => s.role !== 'stop');
    const strongest = Math.min(...own.filter((s) => s.r !== null).map((s) => Math.abs(s.r!)));
    const front = master.surfaces[0].semiAperture ?? 0;
    const k = front > 0 && Number.isFinite(strongest) ? (ADAPTER_CLEARANCE * front) / strongest : 1;
    const scaled = own.map((s, i) => ({
      ...s,
      r: s.r === null ? null : s.r * k,
      d: i === own.length - 1 ? ADAPTER_GAP_MM * k : s.d === null ? null : s.d * k,
      semiAperture: s.semiAperture === null ? null : s.semiAperture * k,
    }));
    const pupil = p.reported.pupilMagnification ?? 1;
    // The adapter's widest air gap focuses it, when its lens moves as one unit.
    let gap = -1;
    scaled.forEach((s, i) => {
      if (i < scaled.length - 1 && s.glass === null && s.d !== null && (gap < 0 || s.d > scaled[gap].d!)) gap = i;
    });
    const unit = master.focus.mode === 'unit' && master.squeezeFocus === null;
    return {
      ...master,
      surfaces: [...scaled, ...master.surfaces],
      stop: master.stop + scaled.length,
      focus: { ...master.focus, moving: (master.focus.moving ?? []).map((m) => ({ ...m, surface: m.surface + scaled.length })) },
      squeeze: pupil > 1 ? pupil : 1 / Math.max(pupil, 1e-6),
      squeezeFocus: unit && gap >= 0 ? { surface: gap, dBase: scaled[gap].d!, dNear: scaled[gap].d! * ADAPTER_FOCUS_TRAVEL } : null,
    };
  }
  const surfaces = withCoating(p.surfaces, t.coating);
  const variable = p.variable?.[0];
  if (variable && t.variable !== null) surfaces[variable.surface] = { ...surfaces[variable.surface], d: t.variable };
  const stop = surfaces.findIndex((s) => s.role === 'stop');
  return {
    surfaces,
    stop: Math.max(0, stop),
    focus: p.focus,
    fNumberMin: p.fNumber ?? p.iris.fNumberMin ?? 0,
    magnification: p.focus.mode === 'floating' ? [stateMagnification(p.focus.base), stateMagnification(p.focus.near)] : [0, 0],
    squeeze: 1,
    obstruction: p.obstructionRatio ?? 0,
    squeezeFocus: null,
  };
}

/** What the engine computed of a traced lens (rt-core `LensInfo::to_json`): what the interface shows (rule 10). */
export interface EngineLensInfo {
  /** Paraxial focal length at infinity, mm (the camera's focal length). */
  eflMm: number;
  /** Back focal distance at infinity, from the rear vertex, mm. */
  bflMm: number;
  /** Focal length at the focus distance (breathing), mm. */
  eflFocusedMm: number;
  /** The f-number in use (never faster than the lens) and the fastest. */
  fNumber: number;
  fNumberMin: number;
  /** The f-number over the square root of the transmittance. */
  tStop: number;
  /** Transmittance per band (R, G, B). */
  transmittance: [number, number, number];
  /** First to last vertex, mm. */
  lengthMm: number;
  /** Entrance pupil: behind the first vertex, and its diameter, mm. */
  entrancePupilMm: [number, number];
  elements: number;
  groups: number;
  /** The sensor behind the rear vertex, mm. */
  sensorMm: number;
  /** Distortion, percent, against image height (mm on the sensor). */
  distortion: [number, number][];
  /** Relative illumination against image height. */
  relativeIllumination: [number, number][];
}

const pairs = (v: unknown): [number, number][] | null =>
  Array.isArray(v) && v.every((p) => Array.isArray(p) && p.length === 2 && p.every((x) => typeof x === 'number' && Number.isFinite(x)))
    ? (v as [number, number][])
    : null;

/**
 * The engine's lens information (the JSON of `rt_scene_lens_info` or the launcher's /api/lens/info): the numbers of
 * a traced lens, null for the thin lens, undefined for an answer that is not one.
 */
export function parseLensInfo(text: string): EngineLensInfo | null | undefined {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof v !== 'object' || v === null) return undefined;
  const r = v as Record<string, unknown>;
  if (r.traced === false) return null;
  if (r.traced !== true) return undefined;
  const num = (k: string) => (typeof r[k] === 'number' && Number.isFinite(r[k]) ? (r[k] as number) : NaN);
  const tri = Array.isArray(r.transmittance) && r.transmittance.length === 3 ? (r.transmittance as [number, number, number]) : null;
  const pupil = Array.isArray(r.entrancePupilMm) && r.entrancePupilMm.length === 2 ? (r.entrancePupilMm as [number, number]) : null;
  const distortion = pairs(r.distortion);
  const ri = pairs(r.relativeIllumination);
  const info: EngineLensInfo = {
    eflMm: num('eflMm'),
    bflMm: num('bflMm'),
    eflFocusedMm: num('eflFocusedMm'),
    fNumber: num('fNumber'),
    fNumberMin: num('fNumberMin'),
    tStop: num('tStop'),
    transmittance: tri ?? [NaN, NaN, NaN],
    lengthMm: num('lengthMm'),
    entrancePupilMm: pupil ?? [NaN, NaN],
    elements: num('elements'),
    groups: num('groups'),
    sensorMm: num('sensorMm'),
    distortion: distortion ?? [],
    relativeIllumination: ri ?? [],
  };
  const numbers = [info.eflMm, info.bflMm, info.fNumber, info.tStop, info.lengthMm, info.elements, info.groups, ...info.transmittance];
  return numbers.every(Number.isFinite) && distortion && ri ? info : undefined;
}
