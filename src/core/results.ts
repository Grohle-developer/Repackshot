// The results history (UI.md §2.8): every image a render job wrote, kept in
// the browser (src/io/results.ts) with what the results viewer shows about it.
// This file is the pure part: the record and what to evict when the history
// is over its limits (oldest first).

import type { GuardReport } from './ai';
import type { ResultProvenance } from './plugins';
import type { BitDepth, OutputFormat } from './render';

/**
 * The AI post-processing of a result (AI-POST.md §4): the image it made is stored next to the engine's, and
 * the guard's report says what was checked. The engine's image is always the result's own `file`.
 */
export interface AiResultInfo {
  /** The file name the AI image was saved under. */
  name: string;
  /** A small JPEG (data URL) of the AI image, for the queue and the history. */
  thumb: string;
  /** Bytes the AI image takes in the history (also counted in the result's `bytes`). */
  bytes: number;
  report: GuardReport;
}

/** One result: an image a job wrote, and its data. */
export interface ResultMeta {
  id: string;
  /** The job that wrote it (its id in the queue then). */
  jobId: string;
  /** The file name it was saved under. */
  name: string;
  /** Milliseconds since the epoch. */
  createdAt: number;
  width: number;
  height: number;
  dpi: number;
  samples: number;
  /** Seconds the render took. */
  seconds: number;
  cameraId: string | null;
  /** The camera's name when it was rendered. */
  camera: string;
  format: OutputFormat;
  bitDepth: BitDepth;
  /** Where it was saved: the downloads, or a folder by its name. */
  savedTo: { kind: 'DOWNLOADS' } | { kind: 'FOLDER'; id: string; name: string };
  /** Animation: the frame this image is, and the frames of the job. */
  frame?: number;
  frames?: number;
  /** A small JPEG (data URL) for the queue and the history. */
  thumb: string;
  /** Bytes the stored blobs take. */
  bytes: number;
  /**
   * The AI post-processing this result went through, when it did (added in X4; older results have none). With
   * several variants (X4b) this is the first one.
   */
  ai?: AiResultInfo;
  /** Variants 2 and on, in order, when the job made more than one (X4b); `ai` is the first. */
  aiMore?: AiResultInfo[];
  /**
   * A result a plugin made from another one (P6, Render window ▸ Plugins ▸ Apply): the plugin, its version, the recipe
   * and the controls it was given, and the result it came from. Absent for what a render job wrote.
   */
  provenance?: ResultProvenance;
}

/** Every AI variant of a result, the first one first (a result of before X4b has one at most). */
export function aiVariantsOf(r: Pick<ResultMeta, 'ai' | 'aiMore'>): AiResultInfo[] {
  return r.ai ? [r.ai, ...(r.aiMore ?? [])] : [];
}

/** The variants whose image the guard let through (a REJECTED one keeps its report but has no image of its own). */
export function aiImagesOf(r: Pick<ResultMeta, 'ai' | 'aiMore'>): { info: AiResultInfo; variant: number }[] {
  return aiVariantsOf(r)
    .map((info, i) => ({ info, variant: i + 1 }))
    .filter((v) => v.info.bytes > 0);
}

export interface HistoryLimits {
  count: number;
  bytes: number;
}

/** Default limits: 50 results or 500 MB, whichever is reached first. */
export const HISTORY_LIMITS: HistoryLimits = { count: 50, bytes: 500 * 1024 * 1024 };

/**
 * Ids to evict so the history fits its limits, oldest first. `keep` (the result just added) is
 * never evicted, even when it alone is over the size limit.
 */
export function evictionPlan(list: readonly Pick<ResultMeta, 'id' | 'createdAt' | 'bytes'>[], limits: HistoryLimits = HISTORY_LIMITS, keep?: string): string[] {
  const byAge = [...list].sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  let count = byAge.length;
  let bytes = byAge.reduce((n, r) => n + Math.max(0, r.bytes), 0);
  const out: string[] = [];
  for (const r of byAge) {
    if (count <= limits.count && bytes <= limits.bytes) break;
    if (r.id === keep) continue;
    out.push(r.id);
    count--;
    bytes -= Math.max(0, r.bytes);
  }
  return out;
}

/** Newest first. */
export function sortResults<T extends Pick<ResultMeta, 'createdAt' | 'id'>>(list: readonly T[]): T[] {
  return [...list].sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
}

/** Results to compare a result with: the others of the same camera first, then the rest; newest first. */
export function compareCandidates<T extends Pick<ResultMeta, 'id' | 'createdAt' | 'cameraId' | 'jobId'>>(list: readonly T[], of: T): T[] {
  const others = sortResults(list.filter((r) => r.id !== of.id));
  const same = others.filter((r) => r.cameraId === of.cameraId);
  return [...same, ...others.filter((r) => r.cameraId !== of.cameraId)];
}
