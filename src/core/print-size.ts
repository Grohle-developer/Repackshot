// Output size in pixels and its print size (UI.md §2.7, SPEC §3.8). Pixels
// rule: a print size is always derived from the pixels and the DPI; typing a
// print size recomputes the pixels at the current DPI, and changing the DPI
// leaves the pixels alone (the print size follows). Pure functions only.

export type PrintUnit = 'MM' | 'CM' | 'IN';
export const PRINT_UNITS: readonly PrintUnit[] = ['MM', 'CM', 'IN'];

/** Millimetres in one unit. */
export const MM_PER: Readonly<Record<PrintUnit, number>> = { MM: 1, CM: 10, IN: 25.4 };
const MM_PER_INCH = 25.4;

/** DPI accepted by the interface (and writable in a JFIF header: 16 bits). */
export const MIN_DPI = 1;
export const MAX_DPI = 9600;
export const DEFAULT_DPI = 300;

export function clampDpi(dpi: number): number {
  if (!Number.isFinite(dpi)) return DEFAULT_DPI;
  return Math.max(MIN_DPI, Math.min(MAX_DPI, Math.round(dpi)));
}

/** Print length of `px` pixels at `dpi`, in `unit` (not rounded). */
export function printLength(px: number, dpi: number, unit: PrintUnit): number {
  return ((px / Math.max(MIN_DPI, dpi)) * MM_PER_INCH) / MM_PER[unit];
}

/** Pixels for a print length in `unit` at `dpi`: `round(length in inches × dpi)`, at least 1. */
export function pixelsFor(length: number, unit: PrintUnit, dpi: number): number {
  const inches = (length * MM_PER[unit]) / MM_PER_INCH;
  return Math.max(1, Math.round(inches * Math.max(MIN_DPI, dpi)));
}

/** Pixels per metre, as the PNG `pHYs` chunk stores the density (unit 1). */
export function pixelsPerMetre(dpi: number): number {
  return Math.round(dpi / 0.0254);
}

/** The DPI a `pHYs` density in pixels per metre stands for (rounded to a whole DPI). */
export function dpiFromPixelsPerMetre(ppm: number): number {
  return Math.round(ppm * 0.0254);
}

/**
 * The other side of a size with a locked aspect ratio: `round(width / aspect)` or
 * `round(height × aspect)`, at least 1. `aspect` is width / height as it was when the lock
 * engaged, so repeated edits never drift.
 */
export function lockedSide(changed: 'width' | 'height', value: number, aspect: number): number {
  const a = aspect > 0 && Number.isFinite(aspect) ? aspect : 1;
  return Math.max(1, Math.round(changed === 'width' ? value / a : value * a));
}

/** A paper size at a DPI (UI.md §2.7: A4, A3, Letter, 10 × 15 cm at 300 DPI). */
export interface PrintPreset {
  key: 'A4' | 'A3' | 'LETTER' | 'PHOTO_10X15';
  /** Short side and long side, millimetres. */
  shortMm: number;
  longMm: number;
  dpi: number;
}

export const PRINT_PRESETS: readonly PrintPreset[] = [
  { key: 'A4', shortMm: 210, longMm: 297, dpi: 300 },
  { key: 'A3', shortMm: 297, longMm: 420, dpi: 300 },
  { key: 'LETTER', shortMm: 215.9, longMm: 279.4, dpi: 300 },
  { key: 'PHOTO_10X15', shortMm: 100, longMm: 150, dpi: 300 },
];

/** Pixels of a paper in landscape (long side across) or portrait. */
export function printPresetPixels(p: PrintPreset, landscape: boolean): { width: number; height: number; dpi: number } {
  const s = pixelsFor(p.shortMm, 'MM', p.dpi);
  const l = pixelsFor(p.longMm, 'MM', p.dpi);
  return landscape ? { width: l, height: s, dpi: p.dpi } : { width: s, height: l, dpi: p.dpi };
}

/** The print preset (in either orientation) a size and DPI match, if any. */
export function matchPrintPreset(width: number, height: number, dpi: number): PrintPreset | undefined {
  return PRINT_PRESETS.find((p) => {
    if (p.dpi !== dpi) return false;
    const a = printPresetPixels(p, true);
    return (a.width === width && a.height === height) || (a.width === height && a.height === width);
  });
}
