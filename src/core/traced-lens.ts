// The traced lens of a camera (phase O2, STUDIO-TOOLS §1 mode 2): a prescription of src/data/lenses.json that the
// engine traces surface by surface (rt-core `optics::traced`), and what the person set on it. The project keeps the
// catalogue key and the settings, and a copy of the surfaces only when the person edited its elements (O2c,
// core/lens-edit.ts: `edited`, which then replaces the catalogue's); `composeLens` puts together what the engine is
// sent: the person's coating and variable gap (or the edited surfaces), and an anamorphic adapter in front of the
// lens it is mounted on. The numbers the interface shows of a lens (focal length, T-stop, distortion...) are the engine's
// (rule 10), never computed here.

import { lensPrescription, LENS_PRESCRIPTIONS, type CoatingId, type LensFocus, type LensFocusTravel, type LensGlass, type LensPrescription, type LensSurface } from '../data/lenses';
import { editableLens, editedFocus, editedFrom, MAX_SURFACES, type EditedLens } from './lens-edit';

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
  /**
   * O2c: the lens's elements as the person edited them (core/lens-edit.ts), in place of the catalogue's surfaces;
   * `key` still names the lens they came from (its iris, f-number range and source). Absent: the catalogue lens, as
   * every lens of before O2c (whose files do not change by a byte).
   */
  edited?: EditedLens;
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
  const edited = r.edited !== undefined && editableLens(p) ? normalizeEdited(r.edited) : null;
  return {
    key: p.key,
    coating: COATING_IDS.includes(r.coating as CoatingId) ? (r.coating as CoatingId) : null,
    variable: !edited && variable && typeof r.variable === 'number' && Number.isFinite(r.variable) ? Math.min(variable.max, Math.max(variable.min, r.variable)) : null,
    distortion: clamp(r.distortion, L.distortion.min, L.distortion.max),
    vignetting: clamp(r.vignetting, L.vignetting.min, L.vignetting.max),
    spherical: clamp(r.spherical, L.spherical.min, L.spherical.max),
    breathing: clamp(r.breathing, L.breathing.min, L.breathing.max),
    master: isAdapter(p) ? master : null,
    ...(edited ? { edited } : {}),
  };
}

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const SURFACE_KINDS: readonly LensSurface['kind'][] = ['sphere', 'plane', 'asphere'];

/** A glass of a file (index 1 to 3, Abbe number not negative), or undefined when it is not one. */
function normalizeGlass(v: unknown): LensGlass | null | undefined {
  if (v === null) return null;
  if (typeof v !== 'object') return undefined;
  const g = v as Partial<Record<keyof LensGlass, unknown>>;
  if (!num(g.nd) || g.nd < 1 || g.nd > 3 || !num(g.vd) || g.vd < 0) return undefined;
  return { nd: g.nd, vd: g.vd, ...(num(g.dPgF) ? { dPgF: g.dPgF } : {}), ...(g.vdEstimated === true ? { vdEstimated: true as const } : {}) };
}

/**
 * The edited elements of a file (O2c), or null when they cannot be read: then the lens opens as the catalogue's.
 * Only the structure is checked (every number a number, one stop, at most 64 surfaces, in air at the end); what the
 * engine makes of it (an image, light through it) is asked again when the lens is used or edited.
 */
export function normalizeEdited(v: unknown): EditedLens | null {
  if (typeof v !== 'object' || v === null) return null;
  const r = v as Record<string, unknown>;
  if (!Array.isArray(r.surfaces) || r.surfaces.length < 2 || r.surfaces.length > MAX_SURFACES) return null;
  const surfaces: LensSurface[] = [];
  for (const raw of r.surfaces as unknown[]) {
    if (typeof raw !== 'object' || raw === null) return null;
    const x = raw as Record<string, unknown>;
    const kind = SURFACE_KINDS.includes(x.kind as LensSurface['kind']) ? (x.kind as LensSurface['kind']) : null;
    const glass = normalizeGlass(x.glass);
    if (!kind || glass === undefined) return null;
    if (!(x.r === null || num(x.r)) || !(x.d === null || num(x.d)) || !(x.semiAperture === null || (num(x.semiAperture) && x.semiAperture >= 0))) return null;
    const coating = x.coating === null || COATING_IDS.includes(x.coating as CoatingId) ? (x.coating as CoatingId | null) : null;
    const s: LensSurface = {
      kind: kind === 'sphere' && (x.r === null || x.r === 0) ? 'plane' : kind,
      r: x.r === 0 ? null : (x.r as number | null),
      d: x.d as number | null,
      glass,
      semiAperture: x.semiAperture as number | null,
      role: x.role === 'stop' ? 'stop' : 'normal',
      coating,
    };
    if (kind === 'asphere') {
      const a = (x.asphere ?? {}) as Record<string, unknown>;
      const coefficients = Array.isArray(a.coefficients) ? (a.coefficients as unknown[]).filter(num).slice(0, 4) : [];
      s.asphere = { conic: num(a.conic) ? a.conic : 0, coefficients };
    }
    surfaces.push(s);
  }
  if (surfaces.filter((s) => s.role === 'stop').length !== 1 || surfaces[surfaces.length - 1].glass !== null) return null;
  const f = (typeof r.focus === 'object' && r.focus !== null ? r.focus : {}) as Record<string, unknown>;
  const mode = f.mode === 'internal' || f.mode === 'floating' ? f.mode : 'unit';
  const moving: LensFocusTravel[] = [];
  for (const m of Array.isArray(f.moving) ? (f.moving as unknown[]) : []) {
    const x = (typeof m === 'object' && m !== null ? m : {}) as Record<string, unknown>;
    if (!num(x.surface) || !Number.isInteger(x.surface) || x.surface < 0 || x.surface >= surfaces.length - 1 || !num(x.dBase) || !num(x.dNear) || x.dBase < 0 || x.dNear < 0) return null;
    moving.push({ surface: x.surface, dBase: x.dBase, dNear: x.dNear });
  }
  const focus = editedFocus({ mode, moving, ...(typeof f.base === 'string' ? { base: f.base.slice(0, 64) } : {}), ...(typeof f.near === 'string' ? { near: f.near.slice(0, 64) } : {}) });
  const name = typeof r.name === 'string' && r.name.trim() ? r.name.trim().slice(0, 64) : 'Lens';
  return { name, surfaces, focus };
}

/**
 * O2c: lens `t` with its elements copied to be edited: the surfaces the engine traces for it now (its coating and
 * variable gap in), its focus, and `name`. An edited lens is returned as it is; null for a lens whose elements
 * cannot be edited (the anamorphic adapter, the mirror lens) or an unknown key.
 */
export function startEdit(t: TracedLens, name: string): TracedLens | null {
  if (t.edited) return t;
  const p = lensPrescription(t.key);
  if (!p || !editableLens(p)) return null;
  const c = composeLens(t);
  if (!c) return null;
  return { ...t, variable: null, edited: editedFrom(name, c.surfaces, c.focus) };
}

/** True when the engine tilts `t` (O4): a lens with cylinders (the anamorphic adapter) does not. */
export function tracedLensTilts(t: TracedLens): boolean {
  const c = composeLens(t);
  return !!c && c.surfaces.every((s) => s.kind !== 'cylinder');
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
  // O2c: the edited elements replace the catalogue's (their focus is the edited lens's own).
  const edited = t.edited ?? null;
  const surfaces = withCoating(edited ? edited.surfaces : p.surfaces, t.coating);
  const variable = p.variable?.[0];
  if (!edited && variable && t.variable !== null) surfaces[variable.surface] = { ...surfaces[variable.surface], d: t.variable };
  const stop = surfaces.findIndex((s) => s.role === 'stop');
  const focus = edited ? edited.focus : p.focus;
  return {
    surfaces,
    stop: Math.max(0, stop),
    focus,
    fNumberMin: p.fNumber ?? p.iris.fNumberMin ?? 0,
    magnification: focus.mode === 'floating' ? [stateMagnification(focus.base), stateMagnification(focus.near)] : [0, 0],
    squeeze: 1,
    obstruction: p.obstructionRatio ?? 0,
    squeezeFocus: null,
  };
}

/** What the engine computed of a traced lens (rt-core `LensInfo::to_json`): what the interface shows (rule 10). */
export interface EngineLensInfo {
  /** Paraxial focal length at infinity, mm (the camera's focal length). */
  eflMm: number;
  /**
   * O2c: the prescription's own focal length as written, before the engine scales it to the camera's, mm (NaN from an
   * engine of before O2c): what editing its elements changes; `eflMm / designEflMm` is the scale the camera puts on it.
   */
  designEflMm: number;
  /** Back focal distance at infinity, from the rear vertex, mm. */
  bflMm: number;
  /** Focal length at the focus distance (breathing), mm. */
  eflFocusedMm: number;
  /**
   * Image height per unit tangent of the object angle near the axis, mm, at the focus and with the artistic
   * overrides (a thin lens's is its focal length): what the frame shows, and what the distortion is measured against.
   */
  imageScaleMm: number;
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
  /** An anamorphic lens's squeeze as traced at its focus (1 without cylinders): what the image is desqueezed by. */
  squeeze: number;
  /** O4: the angle the lens turns against the sensor for the camera's tilt, degrees (0: upright). */
  tiltDeg: number;
  /** Distortion, percent, against image height (mm on the sensor). */
  distortion: [number, number][];
  /** Relative illumination against image height. */
  relativeIllumination: [number, number][];
  /** The lens as the engine traces it (scaled, focused, every semi-aperture), for its cross-section. */
  section: LensSection | null;
}

/** One surface of the engine's prepared lens (rt-core `SectionSurface`). */
export interface SectionSurface {
  /** Vertex position from the first vertex along the axis, mm (back again after a mirror). */
  z: number;
  /** rt-core SURFACE_*: 0 sphere, 1 plane, 2 asphere, 3 cylinder (axis x), 4 cylinder (axis y), 5 mirror. */
  kind: number;
  /** Curvature, 1/mm, in the horizontal meridian (0: plane). */
  curvature: number;
  semiAperture: number;
  /** d-line index of the medium after it (1: air). */
  index: number;
  conic: number;
  aspheric: [number, number, number, number];
}

/** The engine's prepared lens (rt-core `LensSection`). */
export interface LensSection {
  surfaces: SectionSurface[];
  stop: number;
  /** The iris for the f-number in use, mm. */
  stopRadiusMm: number;
  /** The sensor from the first vertex, mm. */
  sensorZMm: number;
}

const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

/** The `section` of the engine's lens information, or null when it is not one. */
function parseSection(v: unknown): LensSection | null {
  if (typeof v !== 'object' || v === null) return null;
  const r = v as Record<string, unknown>;
  if (!finite(r.stop) || !finite(r.stopRadiusMm) || !finite(r.sensorZMm) || !Array.isArray(r.surfaces)) return null;
  const surfaces: SectionSurface[] = [];
  for (const s of r.surfaces) {
    if (!Array.isArray(s) || s.length !== 10 || !s.every(finite)) return null;
    const n = s as number[];
    surfaces.push({ z: n[0], kind: n[1], curvature: n[2], semiAperture: n[3], index: n[4], conic: n[5], aspheric: [n[6], n[7], n[8], n[9]] });
  }
  return surfaces.length >= 2 && r.stop < surfaces.length ? { surfaces, stop: r.stop, stopRadiusMm: r.stopRadiusMm, sensorZMm: r.sensorZMm } : null;
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
    designEflMm: num('designEflMm'),
    bflMm: num('bflMm'),
    eflFocusedMm: num('eflFocusedMm'),
    imageScaleMm: num('imageScaleMm'),
    fNumber: num('fNumber'),
    fNumberMin: num('fNumberMin'),
    tStop: num('tStop'),
    transmittance: tri ?? [NaN, NaN, NaN],
    lengthMm: num('lengthMm'),
    entrancePupilMm: pupil ?? [NaN, NaN],
    elements: num('elements'),
    groups: num('groups'),
    sensorMm: num('sensorMm'),
    squeeze: r.squeeze === undefined ? 1 : num('squeeze'),
    tiltDeg: r.tiltDeg === undefined ? 0 : num('tiltDeg'),
    distortion: distortion ?? [],
    relativeIllumination: ri ?? [],
    section: parseSection(r.section),
  };
  const numbers = [info.eflMm, info.bflMm, info.imageScaleMm, info.fNumber, info.tStop, info.lengthMm, info.elements, info.groups, info.squeeze, info.tiltDeg, ...info.transmittance];
  return numbers.every(Number.isFinite) && distortion && ri ? info : undefined;
}
