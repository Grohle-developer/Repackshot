// The AI through an API, as the interface handles it (phase X7, AI-POST.md §8): the consent that has to be given before
// a render leaves this computer for a host, and the words of what can go wrong.
//
// Consent is asked in place (UI.md §4.3: no modals): in the render window's AI section when the AI is turned on with an
// API whose host was never allowed, and in Settings ▸ Model by API. It is remembered per host (`ai.apiConsent`) and
// can be revoked there. The service itself refuses to send to a host not allowed (`withApiConsent`), so nothing — the
// preview, a queued job — can send before the person said yes; a job then keeps its engine image and says why.

import type { AiPostService } from '../core/ai';
import { apiActive, apiConnection, consented, withConsent, withoutConsent } from '../core/ai-api-settings';
import { ApiCallError, API_ERRORS, type ApiErrorCode } from '../core/ai-remote';
import type { Settings } from '../core/settings';
import { lbl, t, type StringKey } from './strings';

/** The service, refusing every post to a host the person has not allowed (while the model runs through an API). */
export function withApiConsent(service: AiPostService, settings: () => Settings): AiPostService {
  return {
    status: () => service.status(),
    post: (request, onProgress, signal) => {
      const s = settings();
      if (apiActive(s)) {
        const host = apiConnection(s).host;
        if (!consented(s, host)) return Promise.reject(new ApiCallError('api-consent', `sending to ${host ?? 'this API'} was not allowed`));
      }
      return service.post(request, onProgress, signal);
    },
  };
}

/** The settings with `host` allowed, or no longer allowed. */
export function consentPatch(s: Settings, host: string, allow: boolean): string[] {
  return allow ? withConsent(s['ai.apiConsent'], host) : withoutConsent(s['ai.apiConsent'], host);
}

/** What the person is asked before the first send to a host (◆ the wording is the lead's to confirm). */
export function consentQuestion(s: Settings): string {
  const c = apiConnection(s);
  const host = c.host ?? '';
  return t(c.options.sendPasses ? 'ai.api.consentPasses' : 'ai.api.consent', { host, provider: lbl(c.preset.label) });
}

/** A failure in words, in the interface's language: the code's sentence, with the tries made and the service's own words. */
export function apiErrorText(err: unknown): string | null {
  if (!(err instanceof ApiCallError) && !(err instanceof Error && 'code' in err && (API_ERRORS as readonly string[]).includes(String((err as { code: unknown }).code)))) return null;
  const e = err as ApiCallError;
  const code = e.code as ApiErrorCode;
  const base = t(`ai.api.err.${code}` as StringKey, { status: e.status ?? '', detail: e.detail ?? '' });
  const tries = (e.attempts ?? 1) > 1 ? ` ${t('ai.api.err.tries', { n: e.attempts })}` : '';
  const words = e.detail && code !== 'api-format' && code !== 'api-oversize' ? ` ${t('ai.api.err.said', { detail: e.detail })}` : '';
  return `${base}${tries}${words}`;
}

/** The service with its API failures worded (the queue and the preview show the message as it is). */
export function withApiWords(service: AiPostService): AiPostService {
  return {
    status: () => service.status(),
    post: async (request, onProgress, signal) => {
      try {
        return await service.post(request, onProgress, signal);
      } catch (err) {
        const text = apiErrorText(err);
        if (text === null || (err instanceof Error && err.name === 'AbortError')) throw err;
        const e = err as ApiCallError;
        throw new ApiCallError(e.code, text, e.attempts, e.status, e.detail);
      }
    },
  };
}
