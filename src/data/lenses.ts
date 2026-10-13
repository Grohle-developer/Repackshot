// Catalogue data ported from EZPackshot (https://github.com/Grohle/EZPackshot, GPL-3.0) by its author for Repackshot (PolyForm Noncommercial 1.0.0); values are data, the implementation is new.

import type { Label, LensPreset } from './types';
import raw from './lenses.json';

// Camera lens presets (upstream LENS_PRESETS): focal length in millimetres and
// a typical aperture for the look of each lens.
export const LENS_PRESETS: readonly LensPreset[] = [
  { key: 'ULTRA', label: { es: '14 mm ultra gran angular', en: '14 mm ultra wide' }, focalMm: 14, fstop: 5.6 },
  { key: 'WIDE', label: { es: '24 mm gran angular', en: '24 mm wide' }, focalMm: 24, fstop: 5.6 },
  { key: 'DOC', label: { es: '35 mm reportaje', en: '35 mm reportage' }, focalMm: 35, fstop: 4 },
  { key: 'NORMAL', label: { es: '50 mm normal', en: '50 mm normal' }, focalMm: 50, fstop: 2.8 },
  { key: 'PORTRAIT', label: { es: '85 mm retrato', en: '85 mm portrait' }, focalMm: 85, fstop: 2 },
  { key: 'MACRO', label: { es: '100 mm macro', en: '100 mm macro' }, focalMm: 100, fstop: 8 },
  { key: 'TELE', label: { es: '135 mm tele corto', en: '135 mm short tele' }, focalMm: 135, fstop: 2.8 },
  { key: 'LONG', label: { es: '200 mm tele', en: '200 mm tele' }, focalMm: 200, fstop: 4 },
];

export function lensPreset(key: string): LensPreset | undefined {
  return LENS_PRESETS.find((l) => l.key === key);
}

// ---------------------------------------------------------------------------
// Lens prescriptions (STUDIO-TOOLS §1 and §6, docs/research/optics.md §2.3 and §5)
//
// Not from EZPackshot: the 16 starting lenses of the traced-lens mode, in
// lenses.json. Clean room: generic names only, the provenance (expired patent
// number, book) lives in `source`; glass is `nd` / `vd` and never a catalogue
// name. Keys are stable: they are added, never renamed.
//
// Sign convention (the usual one of lens design, in a single global frame):
// light travels along +z, a positive radius has its centre of curvature on
// the +z side of the vertex (convex toward the object), `d` is the signed
// distance from this surface to the next one and `glass` is the medium AFTER
// the surface (null = air). After a mirror the light travels back, so the
// distances that follow are negative (see catadioptric_mirror). A plane
// surface has `r: null`.
// ---------------------------------------------------------------------------

export type LensKind = 'sphere' | 'plane' | 'asphere' | 'cylinder' | 'mirror';
export type LensRole = 'normal' | 'stop';
export type LensCharacter = 'clinical' | 'soft' | 'swirl' | 'vintage' | 'anamorphic' | 'macro' | 'wide' | 'tele';
export type CoatingId = 'none' | 'single' | 'multi';
export type FocusMode = 'unit' | 'internal' | 'floating' | 'none';

/** Glass by refractive index and Abbe number at the d line only (never a catalogue name). */
export interface LensGlass {
  nd: number;
  vd: number;
  /** Deviation of the relative partial dispersion from the normal line, for low-secondary-spectrum glass. */
  dPgF?: number;
  /** True when the source gives no Abbe number and `vd` is an estimate. */
  vdEstimated?: true;
  /** The source's own values when they were not d-line (`nd` is then converted from them). */
  native?: { line: 'e'; n: number; v: number };
}

export interface LensSurface {
  kind: LensKind;
  /** Radius of curvature, mm; null for a plane. */
  r: number | null;
  /** Distance to the next surface, mm (signed after a mirror); null on the last surface unless the source lists a back focus. */
  d: number | null;
  /** The medium after the surface; null is air. */
  glass: LensGlass | null;
  /** Clear semi-aperture, mm, where the source gives it. */
  semiAperture: number | null;
  /** Exactly one surface of a lens is the aperture stop. */
  role: LensRole;
  /** Coating of an air-glass surface; null for cemented interfaces, stops and mirrors. */
  coating: CoatingId | null;
  /** Cylinder only: the axis of the cylinder (the straight generator); the power is in the perpendicular meridian. */
  axis?: 'x' | 'y';
  /** Asphere only (none of the first 16 lenses has one): conic constant and the even-order coefficients A4, A6... of the sag. */
  asphere?: { conic: number; coefficients: number[] };
}

export interface LensSource {
  /** Patent number, or the book / formulas the numbers come from. */
  doc: string;
  year: number | null;
  kind: 'patent' | 'book' | 'computed';
  note?: string;
}

export interface LensFocusTravel {
  /** Index into `surfaces` of the surface whose `d` changes. */
  surface: number;
  dBase: number;
  dNear: number;
}

export interface LensFocus {
  mode: FocusMode;
  /** 'default' when the source says nothing and the whole lens is assumed to move as one unit. */
  basis?: 'default';
  /** Name of the state the listed distances are for, and of the near state. */
  base?: string;
  near?: string;
  moving?: LensFocusTravel[];
}

/** An air gap that dials a look (soft-focus: the spherical aberration). */
export interface LensVariable {
  id: string;
  surface: number;
  label: Label;
  normal: number;
  soft: number;
  min: number;
  max: number;
  /** Research real-ray marginal longitudinal aberration, % of f, per gap value: [gap, percent]. */
  measuredLsaPctOfF: [number, number][];
}

export interface LensReported {
  /** Effective focal length and back focal distance of the research's own paraxial trace, mm. */
  eflMm: number | null;
  bflMm: number | null;
  /** Values the patent itself states, to compare within `patentToleranceRel` (default 1 %). */
  patent: { eflMm?: number; bflMm?: number; nearEflMm?: number } | null;
  /** Relative tolerance of a paraxial trace against the values above (default 0.05 %, the digits of the report). */
  toleranceRel?: number;
  /** Relative tolerance against the patent's own values (default 1 %, as the report states). */
  patentToleranceRel?: number;
  trackMm?: number;
  nearEflMm?: number;
  /** Mirror lens: where the image falls, measured from the vertex of the primary. */
  imageBehindFirstVertexMm?: number;
  /** Afocal adapter: angular and pupil-width magnification in the squeeze meridian. */
  angularMagnification?: number;
  pupilMagnification?: number;
}

export interface LensPrescription {
  key: string;
  family: string;
  name: Label;
  character: LensCharacter;
  source: LensSource;
  /** verified: checked against the source; caveat: with a known small doubt; experimental: awaits a second scan; own-design: not from a patent. */
  status: 'verified' | 'caveat' | 'experimental' | 'own-design';
  /** True when the research scaled the prescription to f of about 100 mm; false for native values. */
  scaled: boolean;
  referenceFocalMm: number | null;
  fNumber: number | null;
  fNumberBasis: 'stated' | 'derived' | null;
  /** Full field angle, degrees, when the source states it. */
  fieldDeg: number | null;
  /** 2 f tan(field / 2), mm, derived from `fieldDeg` and the reference focal length; null for a fisheye. */
  imageCircleMm: number | null;
  /** The position of the stop: stated by the source, assumed here (the source names the gap or nothing: the paraxial focal length and back focus do not depend on it, the aperture-dependent look does), or a placeholder (an adapter has no stop of its own). */
  stopBasis: 'stated' | 'assumed' | 'placeholder';
  /** Central obstruction as a fraction of the aperture diameter (mirror lenses). */
  obstructionRatio?: number;
  /** Fields that are computed from the source's numbers rather than transcribed. */
  derived?: string[];
  iris: { blades: number; roundness: number; rotationDeg: number; fNumberMin: number | null; fNumberMax: number | null };
  focus: LensFocus;
  variable: LensVariable[] | null;
  /** Artistic adjustments saved with a preset (empty on the built-in lenses). */
  overrides: Record<string, number>;
  reported: LensReported;
  notes: string[];
  surfaces: LensSurface[];
}

// Read through a function marked pure, so that a page that never asks for the prescriptions (the interface until the
// lens editor, phase O5) does not carry the 40 kB of lenses.json: the bundler drops an unused pure call.
const loadPrescriptions = (): LensPrescription[] => raw.lenses as unknown as LensPrescription[];

/** The 16 starting lenses, in the order of the research (optics.md §2.3). */
export const LENS_PRESCRIPTIONS: readonly LensPrescription[] = /* @__PURE__ */ loadPrescriptions();

export function lensPrescription(key: string): LensPrescription | undefined {
  return LENS_PRESCRIPTIONS.find((l) => l.key === key);
}

/** The character selector of the lens editor. */
export const LENS_CHARACTERS: readonly { key: LensCharacter; label: Label }[] = [
  { key: 'clinical', label: { es: 'Clínica', en: 'Clinical' } },
  { key: 'soft', label: { es: 'Suave', en: 'Soft' } },
  { key: 'swirl', label: { es: 'Remolino', en: 'Swirl' } },
  { key: 'vintage', label: { es: 'Vintage', en: 'Vintage' } },
  { key: 'anamorphic', label: { es: 'Anamórfica', en: 'Anamorphic' } },
  { key: 'macro', label: { es: 'Macro', en: 'Macro' } },
  { key: 'wide', label: { es: 'Gran angular', en: 'Wide' } },
  { key: 'tele', label: { es: 'Tele', en: 'Tele' } },
];

/**
 * Coatings (STUDIO-TOOLS §1): reflectance of an air-glass surface at normal incidence, nominal. The
 * physical transmission, tint and ghosts come from the engine (phase O3); this is the label and the id.
 */
export const COATINGS: readonly { key: CoatingId; label: Label; reflectance: number }[] = [
  { key: 'none', label: { es: 'Sin tratar', en: 'Uncoated' }, reflectance: 0.04 },
  { key: 'single', label: { es: 'Monocapa', en: 'Single layer' }, reflectance: 0.013 },
  { key: 'multi', label: { es: 'Multicapa', en: 'Multi-layer' }, reflectance: 0.003 },
];
