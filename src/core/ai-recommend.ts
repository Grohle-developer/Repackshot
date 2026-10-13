// The recommendation rule of AI-POST.md §2.4, evaluated over the table in
// src/data/ai-models.json. Pure. The desktop launcher evaluates the same
// table with the same rule in Rust (engine/crates/rt-app/src/recommend.rs);
// both are tested against tests/fixtures/ai-recommend-cases.json.
//
// Rule: the rows are tried top to bottom and the first one that matches
// wins. A gpu row matches the dedicated VRAM of the chosen GPU, a cpu row the
// RAM, both with an inclusive minimum and an exclusive maximum (null: none).
// A web row matches whether the browser has WebGPU and, with WebGPU, a
// maximum buffer of at least `minBufferGiB`. A recommended or offered model
// that is not available is skipped (the recommendation passes to the first
// available offered model, else none) and the result lists it. A failed
// detection (no input, or an amount that is not a non-negative number) gives
// no recommendation at all, never a guess.

import { AI_MODELS, type AiModelsCatalogue, type AiRecommendRow } from '../data/ai-models';

export type RecommendInput =
  | { device: 'gpu'; vramGiB: number | null }
  | { device: 'cpu'; ramGiB: number | null }
  | { device: 'web'; webgpu: boolean; maxBufferGiB?: number | null }
  | null;

export interface Recommendation {
  /** The row that decided, or null when the detection worked but no row matches. */
  rowId: string | null;
  recommended: string | null;
  offered: string[];
  /** Keys of the row that were left out because their model is not available. */
  skipped: string[];
}

const amount = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);

function matches(row: AiRecommendRow, input: NonNullable<RecommendInput>, value: number | null): boolean {
  if (row.device !== input.device) return false;
  if (input.device === 'web') {
    if (row.webgpu !== input.webgpu) return false;
    return !input.webgpu || (value !== null && value >= (row.minBufferGiB ?? 0));
  }
  if (value === null) return false;
  const min = row.minGiB ?? 0;
  const max = row.maxGiB ?? null;
  return value >= min && (max === null || value < max);
}

/**
 * The recommendation for `input`, or null when the detection failed. `unavailable` marks more
 * models as unavailable than the catalogue does (the shared test cases use it).
 */
export function recommend(input: RecommendInput, catalogue: AiModelsCatalogue = AI_MODELS, unavailable: readonly string[] = []): Recommendation | null {
  if (!input || typeof input !== 'object') return null;
  let value: number | null;
  switch (input.device) {
    case 'gpu':
      value = amount(input.vramGiB);
      if (value === null) return null;
      break;
    case 'cpu':
      value = amount(input.ramGiB);
      if (value === null) return null;
      break;
    case 'web':
      if (typeof input.webgpu !== 'boolean') return null;
      value = input.webgpu ? amount(input.maxBufferGiB) : null;
      if (input.webgpu && value === null) return null;
      break;
    default:
      return null;
  }
  const row = catalogue.recommendation.find((r) => matches(r, input, value));
  if (!row) return { rowId: null, recommended: null, offered: [], skipped: [] };
  const usable = (key: string) => !unavailable.includes(key) && catalogue.models.some((m) => m.key === key && m.available);
  const skipped: string[] = [];
  const offered: string[] = [];
  for (const key of row.offered) {
    if (usable(key)) offered.push(key);
    else skipped.push(key);
  }
  let recommended = row.recommended;
  if (recommended !== null && !usable(recommended)) {
    skipped.unshift(recommended);
    recommended = offered.shift() ?? null;
  }
  return { rowId: row.id, recommended, offered, skipped };
}
