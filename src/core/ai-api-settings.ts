// The API connection the settings describe (phase X7, AI-POST.md §8): which endpoint (the generic one the person wrote
// or a preset's), the options of its calls, its host, and what is still missing. Pure: the key is not here (it never
// is in a setting); whether one is stored is asked of the key store (io/api-keys.ts) and passed in.

import type { AiRuntimeStatus } from './ai';
import { apiModelKey, endpointProblems, hostOf, type AiRemoteRequest, type ApiEndpoint, type ApiOptions, type ApiProblem, type ApiProvider } from './ai-remote';
import type { Settings } from './settings';
import { apiPreset, type ApiPreset } from '../data/ai-api-presets';

export interface ApiConnection {
  provider: ApiProvider;
  preset: ApiPreset;
  /** The endpoint in use: the generic one of the settings, or the preset's own. */
  endpoint: ApiEndpoint;
  options: ApiOptions;
  /** Where the render would go (null while the URL is not one). */
  host: string | null;
  problems: ApiProblem[];
  /** The endpoint takes a key (it names a header for it). */
  needsKey: boolean;
}

/** Whether the model runs through an API on this computer. */
export function apiActive(s: Settings): boolean {
  return s['ai.source'] === 'API';
}

export function apiConnection(s: Settings): ApiConnection {
  const provider = s['ai.apiProvider'];
  const preset = apiPreset(provider);
  const endpoint = provider === 'GENERIC' ? s['ai.apiEndpoint'] : preset.endpoint;
  const options: ApiOptions = { sendPasses: s['ai.apiSendPasses'], timeoutSeconds: s['ai.apiTimeout'], attempts: s['ai.apiAttempts'] };
  return { provider, preset, endpoint, options, host: hostOf(endpoint.url), problems: endpointProblems(endpoint, options), needsKey: endpoint.authHeader !== '' };
}

/** Whether the person agreed to send renders to `host`. */
export function consented(s: Settings, host: string | null): boolean {
  return host !== null && s['ai.apiConsent'].includes(host);
}

/** The list with `host` allowed (once). */
export function withConsent(list: readonly string[], host: string): string[] {
  return list.includes(host) ? [...list] : [...list, host];
}

/** The list without `host`. */
export function withoutConsent(list: readonly string[], host: string): string[] {
  return list.filter((h) => h !== host);
}

/**
 * What the AI section is told when the model runs through an API: available when the endpoint is complete and, if it
 * takes a key, one is stored for its host. The model is the provider's (`API_<provider>`), the device its host.
 */
export function apiStatus(c: ApiConnection, hasKey: boolean): AiRuntimeStatus {
  const base = { backend: 'API' as const, device: c.host, supports: [], activeModel: apiModelKey(c.provider) };
  if (c.problems.length > 0 || !c.host) return { available: false, reason: 'API_NOT_SET', ...base };
  if (c.needsKey && !hasKey) return { available: false, reason: 'NO_API_KEY', ...base };
  return { available: true, ...base };
}

/** What a post carries to the pipeline for this connection (null while it cannot be used). */
export function remoteRequest(c: ApiConnection): AiRemoteRequest | null {
  if (!c.host || c.problems.length > 0) return null;
  return { endpoint: c.endpoint, options: c.options, consentedHost: c.host, provider: c.provider };
}
