// Catalogue data ported from EZPackshot (https://github.com/Grohle/EZPackshot, GPL-3.0) by its author for Repackshot (MIT); values are data, the implementation is new.

import type { LensPreset } from './types';

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
