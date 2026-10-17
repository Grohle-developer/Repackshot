import type { FuzzPreset } from './types';

// Fuzz and hair presets (data only). The fibres are
// physical: lengths and radii are in metres and the presets are calibrated on
// a part of FUZZ_REF_SIZE_M. On a smaller part the fibre shrinks in proportion
// (an 8 mm fuzz on a 30 mm ring is a mane); on a bigger one it keeps its
// physical size. Density is parent fibres per FUZZ_REF_AREA_M2 (one dm2).

/** Reference part size the fuzz presets are calibrated to: 200 mm. */
export const FUZZ_REF_SIZE_M = 0.2;
/** Area the density is expressed in: 0.01 m2, i.e. one dm2. */
export const FUZZ_REF_AREA_M2 = 0.01;

export const FUZZ_PRESETS: readonly FuzzPreset[] = [
  {
    key: 'VELVET',
    label: { es: 'Terciopelo', en: 'Velvet' },
    params: { length: 0.0015, lengthVar: 0.15, density: 6000, rootRadius: 0.00004, tipRadius: 0.00002,
      straightness: 0.92, frizz: 0.08, curl: 'NO', gravity: 0.05, clump: 0, segments: 2 },
  },
  {
    key: 'FELT',
    label: { es: 'Fieltro', en: 'Felt' },
    params: { length: 0.0025, lengthVar: 0.6, density: 4000, rootRadius: 0.00007, tipRadius: 0.00004,
      straightness: 0.25, frizz: 0.7, curl: 'CURL', curlAmplitude: 0.2, curlFrequency: 3,
      gravity: 0.2, clump: 0.1, segments: 4 },
  },
  {
    key: 'TOWEL',
    label: { es: 'Rizo de toalla', en: 'Towel loop' },
    params: { length: 0.006, lengthVar: 0.25, density: 1800, rootRadius: 0.0002, tipRadius: 0.00018,
      straightness: 0.4, frizz: 0.25, curl: 'CURL', curlAmplitude: 0.5, curlFrequency: 2,
      gravity: 0.15, clump: 0.25, segments: 6 },
  },
  {
    key: 'CORDUROY',
    label: { es: 'Pana', en: 'Corduroy' },
    params: { length: 0.0022, lengthVar: 0.1, density: 4500, rootRadius: 0.00006, tipRadius: 0.00003,
      straightness: 0.85, frizz: 0.1, curl: 'NO', direction: [0, 0, 1], gravity: 0.05,
      clump: 0.05, segments: 3 },
  },
  {
    key: 'WOOL',
    label: { es: 'Lana', en: 'Wool' },
    params: { length: 0.008, lengthVar: 0.45, density: 1200, rootRadius: 0.00012, tipRadius: 0.00006,
      straightness: 0.2, frizz: 0.55, curl: 'CURL', curlAmplitude: 0.6, curlFrequency: 4,
      gravity: 0.5, clump: 0.3, segments: 7 },
  },
  {
    key: 'CASHMERE',
    label: { es: 'Cachemira', en: 'Cashmere' },
    params: { length: 0.004, lengthVar: 0.35, density: 3000, rootRadius: 0.00005, tipRadius: 0.000025,
      straightness: 0.55, frizz: 0.35, curl: 'WAVE', curlAmplitude: 0.25, curlFrequency: 2.5,
      gravity: 0.45, clump: 0.2, segments: 5 },
  },
  {
    key: 'CARPET',
    label: { es: 'Alfombra', en: 'Carpet' },
    params: { length: 0.012, lengthVar: 0.3, density: 900, rootRadius: 0.00025, tipRadius: 0.0002,
      straightness: 0.75, frizz: 0.2, curl: 'NO', gravity: 0.1, clump: 0.15, segments: 4 },
  },
  {
    key: 'PLUSH',
    label: { es: 'Peluche', en: 'Plush' },
    params: { length: 0.005, lengthVar: 0.4, density: 2500, rootRadius: 0.0001, tipRadius: 0.00005,
      straightness: 0.45, frizz: 0.5, curl: 'WAVE', curlAmplitude: 0.35, curlFrequency: 3,
      gravity: 0.35, clump: 0.25, segments: 5 },
  },
  {
    key: 'MOHAIR',
    label: { es: 'Mohair', en: 'Mohair' },
    params: { length: 0.015, lengthVar: 0.5, density: 800, rootRadius: 0.00009, tipRadius: 0.00004,
      straightness: 0.3, frizz: 0.45, curl: 'WAVE', curlAmplitude: 0.5, curlFrequency: 2,
      gravity: 0.7, clump: 0.35, segments: 8 },
  },
  {
    key: 'FLOCK',
    label: { es: 'Flocado', en: 'Flocking' },
    params: { length: 0.0008, lengthVar: 0.1, density: 9000, rootRadius: 0.00003, tipRadius: 0.00002,
      straightness: 0.95, frizz: 0.05, curl: 'NO', gravity: 0.02, clump: 0, segments: 2 },
  },
];

export function fuzzPreset(key: string): FuzzPreset | undefined {
  return FUZZ_PRESETS.find((p) => p.key === key);
}
