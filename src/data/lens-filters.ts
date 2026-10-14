// The effect filters of a lens (phase O3a, ROADMAP O3a): the sheets screwed in front of a lens that scatter part of
// the light coming in. What changes between them is how much (the grade), with what angular shape (the PSF) and
// with what colour. The engine scatters the camera rays (rt-core `optics::filters`); the Fast viewport draws an
// image-space approximation (render/lens-filter-image.ts). Keys are stable: they are added, never renamed. Names
// are generic, never a brand's.
//
// The grades and their scattered fraction, and the widths of the PSFs, are the lead's proposals, fixed from the
// sheet (rule 11); the numbers here mirror rt-core `optics::filters` and a test keeps the two equal.

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
/** The scattered fraction `s` of each grade (rt-core GRADE_S). */
export const LENS_FILTER_S: readonly number[] = [0.03, 0.06, 0.12, 0.22, 0.38];
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
  glimmerCells: 6,
  glimmerShare: 0.5,
  glimmerSigmaDeg: 0.03,
  netAxisShare: 0.5,
  lineStartDeg: 0.05,
  lineEndDeg: 6,
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
      es: 'La difusión con un halo cálido, que da un tono dorado a las luces y a la piel.',
      en: 'Diffusion with a warm halo that gives the highlights and skin a golden glow.',
    },
    tint: [1.25, 0.98, 0.62],
    points: false,
    angle: false,
  },
  {
    key: 'GLIMMER',
    kind: 4,
    name: { es: 'Brillo', en: 'Glimmer' },
    help: {
      es: 'Pequeños destellos alrededor de las luces, sin apenas velar la imagen.',
      en: 'Small sparkles around the highlights, with hardly any veil over the picture.',
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
      es: 'Como una media tensada delante del objetivo: un brillo suave con una cruz tenue en las luces.',
      en: 'Like a stocking stretched over the lens: a soft glow with a faint cross on the highlights.',
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
      es: 'Rayas rectas que salen de cada luz, de 4, 6 u 8 puntas.',
      en: 'Straight rays from every light, with 4, 6 or 8 points.',
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
      es: 'Una línea horizontal a través de cada luz, azulada, como la de un objetivo anamórfico.',
      en: 'A horizontal line through every light, bluish, like an anamorphic lens’s.',
    },
    tint: [0.7, 0.92, 1.4],
    points: false,
    angle: true,
  },
];

/** The type of a key (undefined for an unknown one). */
export function lensFilterType(key: string): LensFilterType | undefined {
  return LENS_FILTERS.find((t) => t.key === key);
}

/** The scattered fraction of a grade, as the engine computes it (rt-core `grade_s`): the table, linear between. */
export function gradeS(grade: number): number {
  if (!(grade > 0)) return 0;
  const g = LENS_FILTER_GRADES;
  const s = LENS_FILTER_S;
  if (grade <= g[0]) return (s[0] * grade) / g[0];
  for (let i = 1; i < g.length; i++) {
    if (grade <= g[i]) {
      const t = (grade - g[i - 1]) / (g[i] - g[i - 1]);
      return s[i - 1] + (s[i] - s[i - 1]) * t;
    }
  }
  return s[s.length - 1];
}
