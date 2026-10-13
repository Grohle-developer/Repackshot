// Catalogue data ported from EZPackshot (https://github.com/Grohle/EZPackshot, GPL-3.0) by its author for Repackshot (PolyForm Noncommercial 1.0.0); values are data, the implementation is new.

import type { QualityKey, QualityPreset, ResolutionPreset } from './types';

// Render quality tiers (upstream QUALITY_PRESETS). Studio presets pick one of
// these by key; the sampler turns `threshold` into its adaptive-noise target.
export const QUALITY_PRESETS: Readonly<Record<QualityKey, QualityPreset>> = {
  DRAFT: {
    key: 'DRAFT', label: { es: 'Borrador', en: 'Draft' },
    samples: 64, threshold: 0.05, resPct: 50, bounces: 6,
  },
  PREVIEW: {
    key: 'PREVIEW', label: { es: 'Vista previa', en: 'Preview' },
    samples: 256, threshold: 0.02, resPct: 75, bounces: 8,
  },
  FINAL: {
    key: 'FINAL', label: { es: 'Final', en: 'Final' },
    samples: 1024, threshold: 0.005, resPct: 100, bounces: 12,
  },
};

/** Quality keys in ascending order of cost. */
export const QUALITY_KEYS: readonly QualityKey[] = ['DRAFT', 'PREVIEW', 'FINAL'];

// Output sizes in pixels (upstream RES_PRESETS). PRINT is A4 landscape at
// 300 dpi.
export const RESOLUTION_PRESETS: readonly ResolutionPreset[] = [
  { key: 'HD', label: { es: 'HD 1080p', en: 'HD 1080p' }, width: 1920, height: 1080 },
  { key: 'UHD', label: { es: 'UHD 4K', en: 'UHD 4K' }, width: 3840, height: 2160 },
  { key: 'SQUARE', label: { es: 'Cuadrado', en: 'Square' }, width: 2048, height: 2048 },
  { key: 'PORTRAIT', label: { es: 'Vertical', en: 'Portrait' }, width: 1080, height: 1350 },
  { key: 'PRINT', label: { es: 'Impresion A4 300 ppp', en: 'Print A4 300 dpi' }, width: 3508, height: 2480 },
];

export function resolutionPreset(key: string): ResolutionPreset | undefined {
  return RESOLUTION_PRESETS.find((r) => r.key === key);
}
