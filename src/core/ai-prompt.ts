// The words the AI post-processing sends with an image (phase X4b, AI-POST.md §4): the general system prompt of
// Settings, the scene's own prompt (src/ai/prompt.ts builds it from the store) and the job's own prompt, in that
// order, and how they are fitted to a model that reads a limited number of tokens (SD 1.5's CLIP: 77). Pure text: no
// store, no DOM. The fixed negative prompt is not here: it goes apart, always the same (src/ai/prompt.ts).
//
// The guard does not read any of these words (AI-POST.md §1.3): they only make the model's job easier, and what is
// protected stays protected whatever they say.

import { MAX_USER_PROMPT } from './ai';

/**
 * The system prompt of a new installation (the lead's text, in English: the models' text encoders do best in it).
 * Settings ▸ AI post-processing ▸ System prompt changes it for every image, and *Restore default* brings it back.
 */
export const DEFAULT_SYSTEM_PROMPT =
  'Photorealistic product photograph. Keep the image exactly as rendered: the same composition, framing, geometry, proportions, edges, materials, colours, labels, text and logos. Respect the existing lighting: the direction, size, softness and colour of every light, and the shadows and reflections they cast. Respect the existing depth of field: what is in focus stays sharp, what is out of focus stays soft. Improve only realism and naturalness: subtle light falloff, soft contact shadows, natural bounce light and colour bleeding, believable highlight roll-off, fine surface micro-detail and gentle, plausible imperfections. True-to-life tones, as if shot with a high-end camera and lens. No stylisation, no added objects or props, no change of background.';

/** The default's short form, for a model with a prompt-length limit (`maxPromptTokens`), used while the default is unedited. */
export const SHORT_SYSTEM_PROMPT =
  'photorealistic product photo, same composition, geometry, materials and labels, same lighting and depth of field, natural soft shadows, subtle bounce light, realistic highlights, fine micro-detail, true-to-life colours, nothing added';

/** Longest system prompt, in characters. */
export const MAX_SYSTEM_PROMPT = 2000;

/** Tokens a CLIP-style encoder adds around every prompt (start and end): they count against `maxPromptTokens`. */
export const PROMPT_SPECIAL_TOKENS = 2;

/** What the model in use does with words (ai-models.json `capabilities`, or an imported model's manifest). */
export interface PromptCaps {
  /** It follows a free-text prompt: the job's own prompt is sent. */
  textPrompt: boolean;
  /** The most tokens it reads (start and end included), or null for no limit worth fitting to. */
  maxPromptTokens: number | null;
}

/** A model that takes words without a limit (and the synthetic service). */
export const OPEN_PROMPT_CAPS: Readonly<PromptCaps> = Object.freeze({ textPrompt: true, maxPromptTokens: null });

/** Line ends as `\n`, the ends trimmed. */
const tidy = (text: string): string => text.replace(/\r\n?/g, '\n').trim();

/** A job's own prompt as the store keeps it: a string, trimmed, at most MAX_USER_PROMPT characters. */
export function normaliseUserPrompt(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return tidy(tidy(raw).slice(0, MAX_USER_PROMPT));
}

/** The system prompt as Settings keeps it: trimmed, at most MAX_SYSTEM_PROMPT characters; empty is allowed (none). */
export function normaliseSystemPrompt(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  return tidy(tidy(raw).slice(0, MAX_SYSTEM_PROMPT));
}

/** The person has not changed the default system prompt (the same words, whatever the spaces and line breaks). */
export function isDefaultSystemPrompt(system: string): boolean {
  return system.replace(/\s+/g, ' ').trim() === DEFAULT_SYSTEM_PROMPT;
}

/**
 * The system prompt a model gets: the short form of the default when it reads a limited number of tokens and the
 * person kept the default; otherwise the person's own text, as it is.
 */
export function systemPromptFor(system: string, caps: Pick<PromptCaps, 'maxPromptTokens'>): { text: string; short: boolean } {
  if (caps.maxPromptTokens !== null && isDefaultSystemPrompt(system)) return { text: SHORT_SYSTEM_PROMPT, short: true };
  return { text: tidy(system), short: false };
}

/**
 * A conservative estimate of the tokens a CLIP-style tokenizer makes of a text, without the start and end tokens:
 * it may count more than the real tokenizer, never fewer, so a prompt fitted with it is never cut by the model.
 * The text is split as CLIP splits it before its byte-pair merges (runs of letters, single digits, runs of other
 * signs) and then:
 *
 *   - a run of ASCII letters counts one token for every 5 letters or part of them (most English words of up to
 *     five letters are one token; longer ones are one or two, rare ones split into pieces of three to five);
 *   - every letter outside ASCII counts one token more (an accent or another script may be a token of its own);
 *   - every digit counts one token (CLIP never merges digits);
 *   - every other sign (comma, hyphen, full stop, bracket…) counts one token, as each may be one.
 */
export function estimatePromptTokens(text: string): number {
  let n = 0;
  for (const m of text.toLowerCase().matchAll(/\p{L}+|\p{N}|[^\s\p{L}\p{N}]+/gu)) {
    const run = m[0];
    if (/^\p{L}/u.test(run)) {
      let ascii = 0;
      let other = 0;
      for (const ch of run) {
        if (/[a-z]/.test(ch)) ascii++;
        else other++;
      }
      n += Math.ceil(ascii / 5) + other;
    } else if (/^\p{N}$/u.test(run)) n += 1;
    else n += [...run].length;
  }
  return n;
}

/** How much of a part was left out to fit the model: nothing, the end of it, or all of it. */
export type PromptCut = 'NONE' | 'PART' | 'ALL';

/** The prompt that goes to the model, and what was done to fit it. */
export interface ComposedPrompt {
  prompt: string;
  /** The estimated tokens of `prompt` (start and end tokens not included). */
  tokens: number;
  /** The model's limit (start and end tokens included), or null when it has none. */
  limit: number | null;
  /** The short form of the default system prompt was used. */
  shortSystem: boolean;
  cut: { system: PromptCut; scene: PromptCut; user: PromptCut };
  /** The job had its own prompt and the model does not take one: it was not sent. */
  userNotSent: boolean;
}

/** Joins parts in order: a part that does not end a sentence or a list gets a full stop before the next one. */
function join(parts: readonly string[]): string {
  let out = '';
  for (const p of parts) {
    if (!p) continue;
    if (out) out += /[.!?;:,]$/.test(out) ? ' ' : '. ';
    out += p;
  }
  return out;
}

/** The words of a text and the text of its first `n` words (the line breaks become spaces). */
const words = (text: string): string[] => text.split(/\s+/).filter(Boolean);
const firstWords = (list: readonly string[], n: number): string => list.slice(0, n).join(' ').replace(/[\s,;:(\-–—]+$/u, '');

/**
 * The prompt for a model: the system prompt (its short form where it applies), the scene's prompt and the job's own
 * prompt, in that order. For a model with a limit, words are left out from the end of the job's prompt first, then
 * from the end of the scene's, then from the end of the system prompt's, until the estimate fits.
 */
export function composePrompt(input: { system: string; scene: string; user: string }, caps: PromptCaps): ComposedPrompt {
  const sys = systemPromptFor(input.system, caps);
  const user = caps.textPrompt ? tidy(input.user) : '';
  const parts = [sys.text, tidy(input.scene), user];
  const base = { limit: caps.maxPromptTokens, shortSystem: sys.short, userNotSent: !caps.textPrompt && tidy(input.user) !== '' };
  const cut: ComposedPrompt['cut'] = { system: 'NONE', scene: 'NONE', user: 'NONE' };
  let prompt = join(parts);
  if (caps.maxPromptTokens === null) return { prompt, tokens: estimatePromptTokens(prompt), cut, ...base };
  const budget = Math.max(0, caps.maxPromptTokens - PROMPT_SPECIAL_TOKENS);
  const keys = ['system', 'scene', 'user'] as const;
  // The job's prompt goes first, the system prompt last.
  for (let i = parts.length - 1; i >= 0 && estimatePromptTokens(prompt) > budget; i--) {
    const list = words(parts[i]);
    if (list.length === 0) continue;
    // The most words of this part that fit, by bisection (the estimate grows with the words kept).
    let lo = 0;
    let hi = list.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      const trial = [...parts];
      trial[i] = firstWords(list, mid);
      if (estimatePromptTokens(join(trial)) <= budget) lo = mid;
      else hi = mid - 1;
    }
    parts[i] = firstWords(list, lo);
    cut[keys[i]] = lo === 0 || parts[i] === '' ? 'ALL' : 'PART';
    prompt = join(parts);
  }
  return { prompt, tokens: estimatePromptTokens(prompt), cut, ...base };
}
