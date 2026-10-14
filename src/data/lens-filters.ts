// The effect filters of a lens (phase O3a, ROADMAP O3a): the sheets screwed in front of a lens that scatter part of
// the light coming in. What changes between them is how much (the grade), with what angular shape (the PSF) and
// with what colour. The engine scatters the camera rays (rt-core `optics::filters`); the Fast viewport draws an
// image-space approximation (render/lens-filter-image.ts). Keys are stable: they are added, never renamed. Names
// are generic, never a brand's.
//
// The grades and their scattered fraction, and the widths of the PSFs, are the lead's proposals, fixed from the
// sheets (rule 11; the second one tinted only the halation and the lines, scaled the star's rays with the grade,
// shortened the net's cross and made the glimmer a cloud); the numbers here mirror rt-core `optics::filters` and a
// test keeps the two equal.

import type { Label } from './types';

export type LensFilterKey = 'DIFFUSION_WHITE' | 'DIFFUSION_BLACK' | 'DIFFUSION_GOLD' | 'GLIMMER' | 'SOFT' | 'NET' | 'STAR' | 'STREAK';

export interface LensFilterType {
  key: LensFilterKey;
  /** The engine's `FILTER_*` (the RSB `LENS` filter kind). */
  kind: number;
  name: Label;
  /** What it does, photographically, in one sentence. */
  help: Label;
  /** The tint of the scattered light when the filter has one to choose (null: neutral, no control). */
  tint: readonly [number, number, number] | null;
  /** Star: the number of points is chosen. */
  points: boolean;
  /** The angle of the lines (star, streak) or of the axes (net) is chosen. */
  angle: boolean;
}

/** The grades of the real filters, from the weakest. */
export const LENS_FILTER_GRADES: readonly number[] = [0.125, 0.25, 0.5, 1, 2];
/** The scattered fraction `s` of each grade (rt-core GRADE_S): the diffusions', the glimmer's and the net's. */
export const LENS_FILTER_S: readonly number[] = [0.03, 0.06, 0.12, 0.22, 0.38];
/** The star's `s` by grade (rt-core STAR_S): its rays keep their brightness near the light while they grow longer. */
export const LENS_FILTER_STAR_S: readonly number[] = [0.073, 0.082, 0.091, 0.1, 0.11];
/** The streak's `s` by grade (rt-core STREAK_S). */
export const LENS_FILTER_STREAK_S: readonly number[] = [0.02, 0.025, 0.035, 0.045, 0.07];
/** The length of the star's rays by grade, degrees (rt-core STAR_LENGTH_DEG). */
export const STAR_LENGTH_DEG: readonly number[] = [1.9, 3.0, 4.6, 7.2, 12.0];
/** The length of the net's cross by grade, degrees (rt-core NET_LENGTH_DEG). */
export const NET_LENGTH_DEG: readonly number[] = [0.6, 0.95, 1.45, 2.25, 3.5];
/** How the grades are written. */
export const GRADE_LABELS: readonly string[] = ['1/8', '1/4', '1/2', '1', '2'];
/** Filters a camera can stack. */
export const MAX_LENS_FILTERS = 3;
/** The star's points. */
export const STAR_POINTS: readonly number[] = [4, 6, 8];

/** The PSFs, as rt-core `optics::filters` builds them (degrees of field). */
export const FILTER_PSF = {
  sigmaCoreDeg: 0.25,
  sigmaTailDeg: 2.5,
  coreShare: 0.6,
  /** What the black diffusion lets through of the light it scatters. */
  blackTransmission: 0.7,
  softSScale: 2,
  softMaxS: 0.8,
  glimmerSparkles: 4096,
  glimmerCloudDeg: 1,
  glimmerShare: 0.3,
  /** The glimmer's soft halo: its share of the radial lobe (the rest in the narrow Gaussian). */
  glimmerHaloShare: 0.4,
  glimmerSigmaDeg: 0.03,
  netAxisShare: 0.1,
  lineStartDeg: 0.05,
  streakEndDeg: 15,
  lineWidthDeg: 0.02,
  /** The diffusion tail stops at this many tail widths. */
  tailReach: 12,
} as const;

export const LENS_FILTERS: readonly LensFilterType[] = [
  {
    key: 'DIFFUSION_WHITE',
    kind: 1,
    name: { es: 'Difusión blanca', en: 'White diffusion' },
    help: {
      es: 'Un halo claro alrededor de las luces y menos contraste: la luz dispersa levanta las sombras.',
      en: 'A light halo around the highlights and lower contrast: the scattered light lifts the shadows.',
    },
    tint: null,
    points: false,
    angle: false,
  },
  {
    key: 'DIFFUSION_BLACK',
    kind: 2,
    name: { es: 'Difusión negra', en: 'Black diffusion' },
    help: {
      es: 'Suaviza las altas luces con un halo y conserva el contraste: parte de la luz dispersa se absorbe.',
      en: 'Softens the highlights with a halo and keeps the contrast: part of the scattered light is absorbed.',
    },
    tint: null,
    points: false,
    angle: false,
  },
  {
    key: 'DIFFUSION_GOLD',
    kind: 3,
    name: { es: 'Difusión dorada', en: 'Gold diffusion' },
    help: {
      es: 'La difusión con un halo cálido alrededor de las altas luces, sin teñir la imagen.',
      en: 'Diffusion with a warm halo around the highlights, without tinting the picture.',
    },
    tint: [1.08, 1, 0.86],
    points: false,
    angle: false,
  },
  {
    key: 'GLIMMER',
    kind: 4,
    name: { es: 'Brillo', en: 'Glimmer' },
    help: {
      es: 'Un halo suave y granulado de destellos finos alrededor de las altas luces.',
      en: 'A soft, grainy halo of fine sparkle around the highlights.',
    },
    tint: null,
    points: false,
    angle: false,
  },
  {
    key: 'SOFT',
    kind: 5,
    name: { es: 'Suavizado', en: 'Soft' },
    help: {
      es: 'Quita nitidez por igual, sin halo alrededor de las luces.',
      en: 'Takes the edge off the sharpness evenly, without a halo around the lights.',
    },
    tint: null,
    points: false,
    angle: false,
  },
  {
    key: 'NET',
    kind: 6,
    name: { es: 'Red', en: 'Net' },
    help: {
      es: 'Como una media tensada delante del objetivo: suaviza toda la imagen y deja una cruz corta y tenue en las luces.',
      en: 'Like a stocking stretched over the lens: it softens the whole picture and leaves a short, faint cross on the highlights.',
    },
    tint: [1.06, 1, 0.94],
    points: false,
    angle: true,
  },
  {
    key: 'STAR',
    kind: 7,
    name: { es: 'Estrella', en: 'Star' },
    help: {
      es: 'Rayas rectas y finas que salen de cada luz, de 4, 6 u 8 puntas; el grado decide su largo.',
      en: 'Thin straight rays from every light, with 4, 6 or 8 points; the grade sets how long they are.',
    },
    tint: null,
    points: true,
    angle: true,
  },
  {
    key: 'STREAK',
    kind: 8,
    name: { es: 'Rayas', en: 'Streak' },
    help: {
      es: 'Una línea horizontal fina a través de cada luz, azulada, como la de un objetivo anamórfico.',
      en: 'A thin horizontal line through every light, bluish, like an anamorphic lens’s.',
    },
    tint: [0.82, 0.95, 1.25],
    points: false,
    angle: true,
  },
];

/** The type of a key (undefined for an unknown one). */
export function lensFilterType(key: string): LensFilterType | undefined {
  return LENS_FILTERS.find((t) => t.key === key);
}

/** A table by grade at `grade`, as the engine reads it (rt-core `by_grade`): linear between, towards 0 below 1/8. */
export function byGrade(table: readonly number[], grade: number): number {
  if (!(grade > 0)) return 0;
  const g = LENS_FILTER_GRADES;
  if (grade <= g[0]) return (table[0] * grade) / g[0];
  for (let i = 1; i < g.length; i++) {
    if (grade <= g[i]) {
      const t = (grade - g[i - 1]) / (g[i] - g[i - 1]);
      return table[i - 1] + (table[i] - table[i - 1]) * t;
    }
  }
  return table[table.length - 1];
}

/** The diffusions' scattered fraction of a grade (rt-core `grade_s`). */
export function gradeS(grade: number): number {
  return byGrade(LENS_FILTER_S, grade);
}

/** The scattered fraction of a filter type at a grade (rt-core `kind_s`). */
export function filterS(key: LensFilterKey, grade: number): number {
  if (key === 'STAR') return byGrade(LENS_FILTER_STAR_S, grade);
  if (key === 'STREAK') return byGrade(LENS_FILTER_STREAK_S, grade);
  if (key === 'SOFT') return Math.min(gradeS(grade) * FILTER_PSF.softSScale, FILTER_PSF.softMaxS);
  return gradeS(grade);
}

/** The length of a type's lines at a grade, degrees (rt-core `line_length_deg`; 0 without lines). */
export function lineLengthDeg(key: LensFilterKey, grade: number): number {
  let length: number;
  if (key === 'STAR') length = byGrade(STAR_LENGTH_DEG, grade);
  else if (key === 'NET') length = byGrade(NET_LENGTH_DEG, grade);
  else if (key === 'STREAK') length = FILTER_PSF.streakEndDeg;
  else return 0;
  return Math.max(length, 4 * FILTER_PSF.lineStartDeg);
}
