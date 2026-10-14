// What the AI runtime is asked with (phase X3c): the person's settings, the active model and the recommendation the
// active model falls back to. Shared by Settings ▸ AI post-processing, the render window's AI section and the
// desktop service (main.ts), so that all three ask the launcher the same question.

import type { AiRuntimeStatus } from '../core/ai';
import { promptCaps } from '../core/ai-post';
import type { PromptCaps } from '../core/ai-prompt';
import { recommend, type Recommendation } from '../core/ai-recommend';
import { runtimeQuery, type AiRuntimeQuery } from '../core/ai-runtimes';
import { activeModel, allModels, recommendInput, type ModelView } from '../core/models';
import type { UiState } from './ui-state';

/** The recommendation for what was detected, by the rule of the catalogue (P2's core/ai-recommend.ts). */
export function recommendationOf(u: UiState): Recommendation | null {
  const snap = u.models;
  if (!snap || u.hardware.state !== 'DONE') return null;
  return recommend(recommendInput(u.hardware.info, u.settings['ai.device'], u.settings['ai.gpu']), snap.catalogue);
}

/**
 * What the launcher's runtime is asked about (`/api/ai/runtime`, and every post of the desktop pipeline, X3c): the
 * person's backend and device, and the active model (the one chosen, else the fallback the manager would use).
 */
export function aiRuntimeQuery(u: UiState): AiRuntimeQuery {
  const snap = u.models;
  const active = snap?.ready ? activeModel(u.settings['ai.active'], allModels(snap), snap.installed, recommendationOf(u)) : null;
  return runtimeQuery(u.settings['ai.backend'], u.settings['ai.device'], active ?? null);
}

/**
 * When the AI section asks the service for its status again: whenever the question changes (the person's backend
 * or device, or the active model, which with no choice of theirs is the recommendation, so it changes when the
 * hardware detection ends) or the models on this computer do (the store answering, a download finishing).
 */
export function aiStatusKey(u: UiState): string {
  const q = aiRuntimeQuery(u);
  return [q.force ?? '', q.cpu ? 'cpu' : '', q.model ?? '', u.models?.ready ? 'ready' : '', u.models?.installed.join(',') ?? ''].join('|');
}

/**
 * The model the words go to (X4b): the one the service says is active, else the one the person's settings make
 * active; its view from the model manager (null when the manager does not know it, or has not answered yet).
 */
export function promptModel(u: UiState, status: Pick<AiRuntimeStatus, 'activeModel'> | null): ModelView | null {
  const snap = u.models;
  if (!snap) return null;
  const models = allModels(snap);
  const key = status?.activeModel ?? (snap.ready ? activeModel(u.settings['ai.active'], models, snap.installed, recommendationOf(u)) : null);
  return (key ? models.find((m) => m.key === key) : undefined) ?? null;
}

/** What a prompt is composed with (X4b): the system prompt of Settings and what the model that will run does with words. */
export function promptContext(u: UiState, status: Pick<AiRuntimeStatus, 'activeModel' | 'backend'> | null): { system: string; caps: PromptCaps; model: ModelView | null } {
  const model = promptModel(u, status);
  return { system: u.settings['ai.systemPrompt'], caps: promptCaps(status, model), model };
}
