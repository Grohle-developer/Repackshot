// The stored example of the AI section's preview (X6, AI-POST.md §4): AI results made once, ahead of time, from a
// reference scene rendered by the Full engine and passed through the real guard (post.wasm) with the test model
// (rt-post's `test_model`), at fixed steps of every control. The section shows the one for the current controls the
// moment a slider moves, without calling any model; it says what it is (the reference scene, the Full engine, the test
// model) and at which values it was made, where those differ from the person's. tools/ai-preview-sheet.mjs makes them
// (public/ai-preview/: index.json and one WebP each); this file is the grid, the index's shape and the lookup.

import { AI_STYLES, DEFAULT_AI_PIPELINE, type AiPipelineSettings, type AiStyle, type GuardReport } from '../core/ai';

/** The steps every 0..100 control is stored at. */
export const SHEET_STEPS = [0, 25, 50, 75, 100] as const;
/** Seeds stored for the example at the stored defaults (Another variation cycles through them). */
export const SHEET_SEEDS = 4;
/** Where the sheet lives, relative to the page. */
export const SHEET_DIR = 'ai-preview/';

/** The controls a stored example is made at. */
export type SheetSettings = Required<Pick<AiPipelineSettings, 'intervention' | 'light' | 'bounce' | 'wear' | 'style' | 'styleStrength' | 'seed'>>;

/** The controls the lookup compares, in the order the section lists them. */
export const SHEET_CONTROLS = ['intervention', 'light', 'bounce', 'wear', 'style', 'styleStrength'] as const;
export type SheetControl = (typeof SHEET_CONTROLS)[number];

/** What the guard said about one stored example: the verdict, the share used, and where it held a band back. */
export interface SheetReport {
  verdict: GuardReport['verdict'];
  usedFraction: number;
  capped?: GuardReport['capped'];
  /** The lowest share of its colour change a material kept (1: none was limited), and which. */
  kept?: { name: string; kept: number } | null;
  /** The guard's own words, in English (for the log and the sheet; the interface words it from the rest). */
  reason?: string;
  /** Why the guard sent each attempt back, in its words (English), in order. */
  sentBack?: string[];
}

export interface SheetEntry {
  key: string;
  settings: SheetSettings;
  /** The image's file in SHEET_DIR. */
  file: string;
  report: SheetReport;
}

/** public/ai-preview/index.json. */
export interface PreviewSheet {
  version: 1;
  width: number;
  height: number;
  /** The engine's image the examples start from (the divider's left side). */
  before: string;
  /** What made it, for the label: the reference scene, its samples, the engine. */
  scene: { name: string; samples: number; engine: 'FULL' };
  /** The model that stood in: the deterministic test model. */
  model: 'TEST_MODEL';
  entries: SheetEntry[];
  /** Total bytes of the images, written by the tool. */
  bytes: number;
}

/** The nearest step of a 0..100 control. */
export function snap(v: number): number {
  let best: number = SHEET_STEPS[0];
  for (const s of SHEET_STEPS) if (Math.abs(s - v) < Math.abs(best - v)) best = s;
  return best;
}

/** The stored defaults: the configurator's defaults snapped to the steps (Light 50, Bounces 50, Wear 25, Natural 25). */
export const SHEET_BASE: Omit<SheetSettings, 'intervention' | 'seed'> = {
  light: snap(DEFAULT_AI_PIPELINE.light),
  bounce: snap(DEFAULT_AI_PIPELINE.bounce),
  wear: snap(DEFAULT_AI_PIPELINE.wear),
  style: DEFAULT_AI_PIPELINE.style,
  styleStrength: snap(DEFAULT_AI_PIPELINE.styleStrength),
};

/** The key of one stored example. */
export function sheetKey(s: SheetSettings): string {
  return `i${s.intervention}-l${s.light}-b${s.bounce}-w${s.wear}-${s.style}-s${s.styleStrength}-${s.seed}`;
}

/**
 * Every example the sheet stores, from the snapped defaults `base` (Intervention aside): at Intervention 0 one (the
 * engine's image, whatever the rest); at each other step, the defaults with its seeds, each band control at each of its
 * other steps, every style at every non-zero strength, and Style strength 0.
 */
export function sheetGrid(base: Omit<SheetSettings, 'intervention' | 'seed'>): SheetSettings[] {
  const out: SheetSettings[] = [{ ...base, intervention: 0, seed: 0 }];
  for (const intervention of SHEET_STEPS.filter((v) => v > 0)) {
    const at = (patch: Partial<SheetSettings>): SheetSettings => ({ ...base, intervention, seed: 0, ...patch });
    for (let seed = 0; seed < SHEET_SEEDS; seed++) out.push(at({ seed }));
    for (const key of ['light', 'bounce', 'wear'] as const) for (const v of SHEET_STEPS) if (v !== base[key]) out.push(at({ [key]: v }));
    for (const style of AI_STYLES) for (const v of SHEET_STEPS.filter((x) => x > 0)) if (!(style === base.style && v === base.styleStrength)) out.push(at({ style, styleStrength: v }));
    if (base.styleStrength !== 0) out.push(at({ styleStrength: 0 }));
  }
  return out;
}

/** One control the shown example was made at differently from the person's. */
export interface SheetDifference {
  control: SheetControl;
  shown: number | AiStyle;
  yours: number | AiStyle;
}

export interface SheetPick {
  entry: SheetEntry;
  /** Where the example's values are not the person's (after snapping or because no stored example has them all). */
  differs: SheetDifference[];
  /** The example's seed is not the person's (the seed only has examples at the stored defaults). */
  seedDiffers: boolean;
}

/**
 * The stored example for the current controls: at the snapped Intervention, the one that differs from the snapped
 * values in the fewest controls; on a tie, the one that has the control moved last at its value, then the one with the
 * seed's slot. Null for an empty sheet.
 */
export function pickExample(sheet: Pick<PreviewSheet, 'entries'>, current: SheetSettings, lastMoved: SheetControl | null = null): SheetPick | null {
  if (sheet.entries.length === 0) return null;
  const want: SheetSettings = {
    intervention: snap(current.intervention),
    light: snap(current.light),
    bounce: snap(current.bounce),
    wear: snap(current.wear),
    style: current.style,
    styleStrength: snap(current.styleStrength),
    seed: (current.seed >>> 0) % SHEET_SEEDS,
  };
  const at = sheet.entries.filter((e) => e.settings.intervention === want.intervention);
  const pool = at.length > 0 ? at : sheet.entries;
  /** Whether a control of an entry is the wanted one (a style at strength 0 is no style: any matches). */
  const same = (e: SheetSettings, c: SheetControl): boolean => {
    if (c === 'style') return e.styleStrength === 0 && want.styleStrength === 0 ? true : e.style === want.style;
    return e[c] === want[c];
  };
  const misses = (e: SheetSettings) => (want.intervention === 0 ? 0 : SHEET_CONTROLS.filter((c) => c !== 'intervention' && !same(e, c)).length);
  let best: SheetEntry | null = null;
  let bestScore = Infinity;
  for (const e of pool) {
    const s = e.settings;
    const score = misses(s) * 100 + (lastMoved && lastMoved !== 'intervention' && !same(s, lastMoved) ? 10 : 0) + (s.seed === want.seed ? 0 : 1);
    if (score < bestScore) {
      best = e;
      bestScore = score;
    }
  }
  const entry = best!;
  const differs: SheetDifference[] = [];
  for (const c of SHEET_CONTROLS) {
    const shown = entry.settings[c];
    const yours = current[c];
    // At Intervention 0 the example is the engine's image: the other controls do not show in it.
    if (c !== 'intervention' && entry.settings.intervention === 0) continue;
    if (c === 'style' && entry.settings.styleStrength === 0 && current.styleStrength === 0) continue;
    if (shown !== yours) differs.push({ control: c, shown, yours });
  }
  return { entry, differs, seedDiffers: entry.settings.intervention > 0 && entry.settings.seed !== want.seed };
}

/** Reads an index.json: the shape checked enough that a broken file shows nothing instead of failing later. */
export function parseSheet(v: unknown): PreviewSheet | null {
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Partial<PreviewSheet>;
  if (o.version !== 1 || typeof o.width !== 'number' || typeof o.height !== 'number' || typeof o.before !== 'string' || !Array.isArray(o.entries)) return null;
  const entries = o.entries.filter((e): e is SheetEntry => typeof e === 'object' && e !== null && typeof e.file === 'string' && typeof e.settings === 'object' && (AI_STYLES as readonly string[]).includes(e.settings.style));
  return { ...(o as PreviewSheet), entries };
}
