// The seam between this phase (U6) and phase P2, which brings the AI model
// list (src/data/ai-models.json, typed by src/data/ai-models.ts) and the
// recommendation rule (src/core/ai-recommend.ts). Everything in U6 reads the
// catalogue and the rule through this file only.
//
// Until P2 is merged into this branch the catalogue here is EMPTY and the rule
// gives no recommendation, so the interface says "no models" honestly instead
// of guessing. After the merge this file becomes, and nothing else changes:
//
//   export { AI_MODELS, aiModel } from '../data/ai-models';
//   export type { AiFamily, AiModelEntry, AiModelFile, AiModelsCatalogue, AiRecommendRow, AiRuntime } from '../data/ai-models';
//   export { recommend } from './ai-recommend';
//   export type { RecommendInput, Recommendation } from './ai-recommend';
//
// The types below are the parts of P2's types that U6 uses, written to be
// structurally identical, so the switch is a drop-in.

import type { Label } from '../data/types';

export type AiRuntime = 'desktop' | 'web';
export type AiFamily = 'z-image' | 'flux2-klein' | 'qwen-image-edit' | 'sd15' | 'sdxl';

export interface AiModelFile {
  role: 'transformer' | 'text-encoder' | 'vae' | 'controlnet' | 'mmproj' | 'config';
  name: string;
  url: string;
  bytes: number;
  sha256: string;
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
  default: boolean;
  available: boolean;
  unavailableReason?: Label;
  licence: { spdx: string; url: string; commercialUse: boolean; useRestrictions: boolean };
  files: AiModelFile[];
  totalBytes: number;
  requirements: { minVramGiB: number | null; minRamGiB: number | null };
}

export interface AiRecommendRow {
  id: string;
  device: 'gpu' | 'cpu' | 'web';
  minGiB?: number;
  maxGiB?: number | null;
  webgpu?: boolean;
  minBufferGiB?: number;
  recommended: string | null;
  offered: string[];
}

export interface AiModelsCatalogue {
  schema: number;
  provisional?: boolean;
  researched?: string;
  models: AiModelEntry[];
  recommendation: AiRecommendRow[];
}

export type RecommendInput =
  | { device: 'gpu'; vramGiB: number | null }
  | { device: 'cpu'; ramGiB: number | null }
  | { device: 'web'; webgpu: boolean; maxBufferGiB?: number | null }
  | null;

export interface Recommendation {
  rowId: string | null;
  recommended: string | null;
  offered: string[];
  skipped: string[];
}

/** Pre-merge: no catalogue in this tree yet (P2 brings it). */
export const AI_MODELS: AiModelsCatalogue = { schema: 1, models: [], recommendation: [] };

export function aiModel(key: string, catalogue: AiModelsCatalogue = AI_MODELS): AiModelEntry | undefined {
  return catalogue.models.find((m) => m.key === key);
}

/** Pre-merge: the rule arrives with P2; without it nothing is recommended (never a guess). */
export function recommend(_input: RecommendInput, _catalogue: AiModelsCatalogue = AI_MODELS, _unavailable: readonly string[] = []): Recommendation | null {
  return null;
}
