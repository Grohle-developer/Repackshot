// The smoothing of edges (phase E11, Settings ▸ Render engine ▸ Antialiasing):
// two lists, each from the cheapest to the costliest, and what each choice
// asks of the engine that draws it. Global settings of the application (not of
// a project): they are kept with the other settings, in settings.json on the
// desktop. No cost is given in numbers (CLAUDE.md rule 10): the order and a
// line of help.
//
// Fast mode (three.js): multisampling of the scene, none to 8×, capped by what
// the device can do (render/preview.ts says what it uses).
// Full mode and the render (the engine, `RNDR.pixel_filter` and
// `RNDR.edge_supersample`, rt_core::pixel_filter): the pixel filter and the
// extra samples on edges, in one list. Pure: no DOM, no engine.

/** Fast mode's multisampling, cheapest first. */
export type FastAa = 'NONE' | 'MSAA2' | 'MSAA4' | 'MSAA8';
export const FAST_AA: readonly FastAa[] = ['NONE', 'MSAA2', 'MSAA4', 'MSAA8'];
export const DEFAULT_FAST_AA: FastAa = 'MSAA4';

/** Full mode's and the render's pixel filter and edge samples, cheapest first. */
export type PixelFilterSetting = 'NONE' | 'STANDARD' | 'SOFT' | 'FINE' | 'FINE_EDGES2' | 'FINE_EDGES4';
export const PIXEL_FILTERS: readonly PixelFilterSetting[] = ['NONE', 'STANDARD', 'SOFT', 'FINE', 'FINE_EDGES2', 'FINE_EDGES4'];
/** The factory choice: Fine, the production filter, which costs the same rays as Standard (the engine's own default, for an RSB
 * without the field, stays the box). */
export const DEFAULT_PIXEL_FILTER: PixelFilterSetting = 'FINE';

/** `RNDR.pixel_filter` (rt_core::pixel_filter): 0 the box of one pixel (the default), 1 none, 2 tent, 3 Blackman–Harris. */
export const FILTER_STANDARD = 0;
export const FILTER_NONE = 1;
export const FILTER_TENT = 2;
export const FILTER_BLACKMAN_HARRIS = 3;

/** What the engine is told for a choice of the list: `RNDR.pixel_filter` and `RNDR.edge_supersample`. */
export interface PixelFilterFields {
  pixelFilter: number;
  edgeSupersample: number;
}

const FIELDS: Readonly<Record<PixelFilterSetting, PixelFilterFields>> = {
  NONE: { pixelFilter: FILTER_NONE, edgeSupersample: 1 },
  STANDARD: { pixelFilter: FILTER_STANDARD, edgeSupersample: 1 },
  SOFT: { pixelFilter: FILTER_TENT, edgeSupersample: 1 },
  FINE: { pixelFilter: FILTER_BLACKMAN_HARRIS, edgeSupersample: 1 },
  FINE_EDGES2: { pixelFilter: FILTER_BLACKMAN_HARRIS, edgeSupersample: 2 },
  FINE_EDGES4: { pixelFilter: FILTER_BLACKMAN_HARRIS, edgeSupersample: 4 },
};

/** The engine's fields for a choice (an unknown one: the standard filter). */
export function pixelFilterFields(s: PixelFilterSetting): PixelFilterFields {
  return { ...(FIELDS[s] ?? FIELDS.STANDARD) };
}

/** The choice of the list the engine's fields are (what the meter names), or null when none is. */
export function pixelFilterSetting(f: PixelFilterFields): PixelFilterSetting | null {
  return PIXEL_FILTERS.find((k) => FIELDS[k].pixelFilter === f.pixelFilter && FIELDS[k].edgeSupersample === f.edgeSupersample) ?? null;
}

/** The samples per pixel a Fast choice asks for (0: none). */
export function msaaSamples(s: FastAa): number {
  return s === 'NONE' ? 0 : s === 'MSAA2' ? 2 : s === 'MSAA8' ? 8 : 4;
}

/** What the device draws for a request: no more than its maximum (`max` 0: the device has no multisampling). */
export function msaaInUse(wanted: number, max: number): number {
  return Math.max(0, Math.min(wanted, max));
}
