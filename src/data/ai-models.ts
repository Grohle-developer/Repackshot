// The list of AI post-processing models and the recommendation table
// (AI-POST.md §2.4). The data lives in ai-models.json because two programs
// read it: this interface and the desktop launcher (engine/crates/rt-app,
// which embeds the same file at build time for `repackshot --hardware`).
// Keys are stable: they are added, never renamed.

import raw from './ai-models.json';
import type { Label } from './types';

export type AiRuntime = 'desktop' | 'web';
export type AiFamily = 'z-image' | 'flux2-klein' | 'qwen-image-edit' | 'sd15' | 'sdxl';

export interface AiModelFile {
  role: 'transformer' | 'text-encoder' | 'vae' | 'controlnet' | 'mmproj' | 'config';
  /** File name on disk, under models/<key>/. */
  name: string;
  /** Pinned to a commit. */
  url: string;
  bytes: number;
  sha256: string;
  /** Licence of this file when it differs from the model's. */
  licenceSpdx?: string;
}

export interface AiModelEntry {
  key: string;
  label: Label;
  summary: Label;
  family: AiFamily;
  role: 'img2img' | 'edit';
  quantization: string;
  runtimes: AiRuntime[];
  /** Exactly one model is the built-in default; never a noncommercial one. */
  default: boolean;
  /** False when no downloadable build exists yet (then `unavailableReason`). */
  available: boolean;
  unavailableReason?: Label;
  licence: {
    spdx: string;
    url: string;
    commercialUse: boolean;
    /** OpenRAIL-style use restrictions, shown and accepted before the download. */
    useRestrictions: boolean;
  };
  files: AiModelFile[];
  totalBytes: number;
  requirements: { minVramGiB: number | null; minRamGiB: number | null };
  /**
   * What the model does with words (X4b). `textPrompt`: it follows a free-text prompt, so the job's own prompt is sent;
   * `maxPromptTokens`: the most tokens its text encoder reads, start and end included (SD 1.5's CLIP: 77), when the
   * prompt has to be fitted. Absent: no text prompt, no known limit.
   */
  capabilities?: { textPrompt?: boolean; maxPromptTokens?: number };
}

/** One row of the recommendation table: evaluated top to bottom, the first match wins. */
export interface AiRecommendRow {
  id: string;
  device: 'gpu' | 'cpu' | 'web';
  /** gpu / cpu rows: inclusive lower bound of VRAM or RAM, GiB. */
  minGiB?: number;
  /** gpu / cpu rows: exclusive upper bound, null for none. */
  maxGiB?: number | null;
  /** web rows: whether the browser has WebGPU. */
  webgpu?: boolean;
  /** web rows with WebGPU: the smallest acceptable maximum buffer, GiB. */
  minBufferGiB?: number;
  recommended: string | null;
  offered: string[];
}

export interface AiModelsCatalogue {
  schema: number;
  /** Thresholds not yet measured (X1 part B). */
  provisional?: boolean;
  researched?: string;
  models: AiModelEntry[];
  recommendation: AiRecommendRow[];
}

export const AI_MODELS: AiModelsCatalogue = raw as AiModelsCatalogue;

export function aiModel(key: string, catalogue: AiModelsCatalogue = AI_MODELS): AiModelEntry | undefined {
  return catalogue.models.find((m) => m.key === key);
}
