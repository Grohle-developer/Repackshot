// AI post-processing, the pure parts the interface leans on (AI-POST.md §4, §7.5): the order of the
// configurator's controls, a new seed, the size of the Fast-mode preview, the protections, and the
// guard's report as the lines the results viewer shows. No DOM and no pipeline here: the pipeline is
// `AiPostService` (core/ai.ts), the settings live in `RenderSettings.ai` (core/render.ts).

import { PREVIEW_MAX_SIDE, type AiPipelineSettings, type AiRuntimeStatus, type AiUnavailableReason, type GuardReport } from './ai';
import { OPEN_PROMPT_CAPS, type PromptCaps } from './ai-prompt';
import type { PassKey } from './passes';
import type { AiSettings } from './render';

/**
 * The passes a final render keeps for the guard (X3c, engine/crates/rt-post): the ids, the normal, the depth and the
 * circle of confusion. Not the albedo: the guard does not use it, and it costs a ray per sample.
 */
export const AI_GUARD_PASSES: readonly PassKey[] = ['normal', 'depth', 'partId', 'materialId', 'coc'];

/** The smallest side the preview is drawn at (AI-POST.md §4: 384–512 px); the slower the computer, the nearer to it. */
export const PREVIEW_MIN_SIDE = 384;

/** The protections of AI-POST.md §1.2, in the order the window lists them. Fixed chips: nothing turns them off. */
export const AI_PROTECTIONS = ['geometry', 'materials', 'resolution', 'dof', 'framing', 'text'] as const;
export type AiProtection = (typeof AI_PROTECTIONS)[number];

/** The pipeline's part of a job's AI settings (what `AiPostRequest.settings` takes). */
export function pipelineOf(ai: AiSettings): Required<AiPipelineSettings> {
  return { intervention: ai.intervention, light: ai.light, bounce: ai.bounce, wear: ai.wear, style: ai.style, styleStrength: ai.styleStrength, seed: ai.seed, userPrompt: ai.userPrompt, variants: ai.variants };
}

/** The seed of variant `n` (1-based) of a job: the job's seed for the first, then one more each (on 32 bits). */
export function variantSeed(seed: number, n: number): number {
  return ((seed >>> 0) + Math.max(0, Math.round(n) - 1)) >>> 0;
}

/** The settings of one request: variant `n` of the job (its seed), one image. */
export function variantSettings(s: Required<AiPipelineSettings>, n: number): Required<AiPipelineSettings> {
  return { ...s, seed: variantSeed(s.seed, n) };
}

/**
 * A file name with `_AI` before its extension: the image the AI made next to the engine's (`Bottle_0001.png` →
 * `Bottle_0001_AI.png`); variant 2 and on with their number (`Bottle_0001_AI_2.png`, X4b).
 */
export function aiFileName(name: string, variant = 1): string {
  const tag = variant > 1 ? `_AI_${Math.round(variant)}` : '_AI';
  const dot = name.lastIndexOf('.');
  return dot > 0 && !/[\\/]/.test(name.slice(dot)) ? `${name.slice(0, dot)}${tag}${name.slice(dot)}` : `${name}${tag}`;
}

/**
 * What the model that will run does with words (X4b): the synthetic service takes any (it ignores them); a model of
 * the catalogue or an imported one says so in its capabilities (`model`, the model manager's view of it); a model
 * the interface does not know takes no text prompt (nothing of the job's own is sent) and has no known limit.
 */
export function promptCaps(status: Pick<AiRuntimeStatus, 'backend'> | null, model: { textPrompt: boolean; maxPromptTokens: number | null } | null | undefined): PromptCaps {
  if (status?.backend === 'SYNTHETIC') return { ...OPEN_PROMPT_CAPS };
  if (!model) return { textPrompt: false, maxPromptTokens: null };
  return { textPrompt: model.textPrompt, maxPromptTokens: model.maxPromptTokens };
}

/**
 * The seed "Another variation" gives next. A deterministic scramble (a linear congruential step on 32 bits,
 * full period, so it never returns the same seed): undoable and reproducible, not random.
 */
export function nextSeed(seed: number): number {
  return (Math.imul(seed >>> 0, 1664525) + 1013904223) >>> 0;
}

/**
 * The preview's size for a job of `width × height`: the same shape, the long side `side` pixels (at most
 * `PREVIEW_MAX_SIDE`), never larger than the job itself. Both sides at least 16.
 */
export function previewSize(width: number, height: number, side: number = PREVIEW_MAX_SIDE): { width: number; height: number } {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const long = Math.min(Math.max(PREVIEW_MIN_SIDE, Math.min(side, PREVIEW_MAX_SIDE)), Math.max(w, h));
  const k = long / Math.max(w, h);
  return { width: Math.max(16, Math.round(w * k)), height: Math.max(16, Math.round(h * k)) };
}

/**
 * What the switch does for a status. `OPEN_SETTINGS`: the person has to download a model or the runtime first, so
 * the switch leads to Settings ▸ AI; `DISABLED`: this computer or this build cannot run it, with the reason;
 * `SWITCH`: it turns on.
 */
export type SwitchAction = { kind: 'SWITCH' } | { kind: 'OPEN_SETTINGS' } | { kind: 'DISABLED'; reason: AiUnavailableReason };

export function switchAction(status: { available: boolean; reason?: AiUnavailableReason }, hasModel: boolean, needsModel: boolean): SwitchAction {
  if (!status.available) {
    if (status.reason === 'NO_MODEL' || status.reason === 'NO_RUNTIME') return { kind: 'OPEN_SETTINGS' };
    return { kind: 'DISABLED', reason: status.reason ?? 'NOT_BUILT' };
  }
  if (needsModel && !hasModel) return { kind: 'OPEN_SETTINGS' };
  return { kind: 'SWITCH' };
}

/** One group of the guard's report as the results viewer words it. */
export interface ReportItem {
  key: 'geometry' | 'materials' | 'resolution' | 'focus';
  ok: boolean;
  /** Materials: the largest mean ΔE₀₀ over the materials checked (null when none was). */
  deltaE?: number | null;
}

/**
 * The report's lines: geometry (the edges match, nothing changed outside the allowed regions and the
 * high-band detail kept), materials (every region within its ΔE₀₀ limit, with the largest mean), resolution
 * (the exact size) and focus (sharpness against the blur map).
 */
export function reportItems(r: GuardReport): ReportItem[] {
  const de = r.materials.length > 0 ? Math.max(...r.materials.map((m) => m.deltaEMean)) : null;
  return [
    { key: 'geometry', ok: r.edges.ok && r.outside.ok && r.detail.ok },
    { key: 'materials', ok: r.materials.every((m) => m.ok), deltaE: de },
    { key: 'resolution', ok: r.size.ok },
    { key: 'focus', ok: r.focus.ok },
  ];
}

/** The percentage of the asked intervention a LIMITED result used (23 for 0.23); null when it was not limited. */
export function limitedPercent(r: GuardReport): number | null {
  return r.verdict === 'LIMITED' ? Math.max(0, Math.min(100, Math.round(r.usedFraction * 100))) : null;
}

/** The groups that failed (what a REJECTED report names). */
export function failedItems(r: GuardReport): ReportItem['key'][] {
  return reportItems(r)
    .filter((i) => !i.ok)
    .map((i) => i.key);
}
