// The AI service when the model runs through an API (phase X7, AI-POST.md §8), and the switch between it and the local
// one. The pipeline is the same either way: on the desktop the launcher runs it (rt-app/src/ai/post.rs, with its
// remote backend), and the page only adds the endpoint to the post; on the web it runs here, with the guard of
// post.wasm (src/ai/post-wasm.ts, the same rt-post) and the page's API backend (io/ai-api.ts) as the model. Every
// image an API returns goes through the guard: the same protections, the same report, the engine image unchanged when
// it is rejected.
//
// Nothing here knows where the key is: the composition root (main.ts) hands in what can say whether one is stored and
// build the backend with it.

import type { AiPostProgress, AiPostRequest, AiPostResult, AiPostService, AiRuntimeStatus } from '../core/ai';
import type { AiModelBackend } from '../core/ai-backend';
import { apiConnection, apiStatus, remoteRequest, type ApiConnection } from '../core/ai-api-settings';
import { ApiCallError, type AiRemotePostRequest, type AiRemoteRequest } from '../core/ai-remote';
import type { Settings } from '../core/settings';
import { jobTolerances, runGuarded, type PostGuard } from './post-wasm';

/** What the page's pipeline (the web) needs. */
export interface ApiPipelineDeps {
  /** The guard, loaded once (post.wasm). */
  guard(): Promise<PostGuard>;
  /** The model for one post: the API backend with this request's endpoint and the host's key. */
  backend(remote: AiRemoteRequest): Promise<AiModelBackend>;
}

/**
 * The pipeline on the page with an API as the model (the web). It takes `INLINE` sources (the web has no launcher to
 * keep a render): the picture and the passes at the job's size, looked at as they are (linear, 0 EV, like the
 * desktop's inline source).
 */
export class ApiPipeline {
  constructor(private readonly deps: ApiPipelineDeps) {}

  async post(request: AiRemotePostRequest, onProgress: (p: AiPostProgress) => void, signal: AbortSignal): Promise<AiPostResult> {
    const remote = request.remote;
    if (!remote) throw new ApiCallError('api-config', 'no API endpoint in the request');
    if (request.source.kind !== 'INLINE') throw new ApiCallError('api-config', 'the page sends the picture itself to the API');
    const { image, passes } = request.source;
    const [guard, backend] = await Promise.all([this.deps.guard(), this.deps.backend(remote)]);
    signal.throwIfAborted();
    const session = guard.open(
      {
        width: image.width,
        height: image.height,
        tonemap: 0,
        exposureEv: 0,
        settings: request.settings,
        materials: request.materials ?? [],
        modelKey: request.modelKey,
        runtime: backend.runtime,
        ...(request.tolerances ? { tolerances: jobTolerances(request.tolerances) } : {}),
      },
      image,
      passes,
    );
    try {
      const r = await runGuarded(
        session,
        (t) => backend.run({ tile: t.tile + 1, tiles: t.tiles, attempt: t.attempt, strength: t.strength, seed: t.seed, width: t.width, height: t.height, input: t.input, edges: t.edges, depth: t.depth, prompt: request.prompt, negative: request.negative }, signal),
        onProgress,
        signal,
      );
      return { image: r.image, report: r.report };
    } finally {
      session.close();
    }
  }
}

/** What the API service is built from. */
export interface ApiServiceDeps {
  settings(): Settings;
  /** Whether a key is stored for a host. */
  hasKey(host: string): Promise<boolean>;
  /** Runs one post with the endpoint added: the launcher's pipeline (desktop) or the page's (web). */
  run(request: AiRemotePostRequest, onProgress: (p: AiPostProgress) => void, signal: AbortSignal): Promise<AiPostResult>;
}

/** The service of the API mode: its status from the settings and the key store, and posts with the endpoint added. */
export function apiService(deps: ApiServiceDeps): AiPostService {
  const connection = (): ApiConnection => apiConnection(deps.settings());
  return {
    async status(): Promise<AiRuntimeStatus> {
      const c = connection();
      return apiStatus(c, c.host !== null && c.needsKey ? await deps.hasKey(c.host) : true);
    },
    async post(request: AiPostRequest, onProgress, signal) {
      const c = connection();
      const remote = remoteRequest(c);
      if (!remote) throw new ApiCallError('api-config', 'the API endpoint is not complete');
      if (c.needsKey && !(await deps.hasKey(remote.consentedHost))) throw new ApiCallError('api-no-key', `no API key for ${remote.consentedHost}`);
      return deps.run({ ...request, remote }, onProgress, signal);
    },
  };
}

/**
 * The service the interface talks to: the API one while Settings says the model runs through an API, the local one
 * otherwise. Read at every call, so changing the setting takes effect on the next status and the next post. With the
 * local mode, requests reach the local service exactly as they were (nothing is added or taken away).
 */
export function routeAiService(local: AiPostService, api: AiPostService, useApi: () => boolean): AiPostService {
  return {
    status: () => (useApi() ? api : local).status(),
    post: (request, onProgress, signal) => (useApi() ? api : local).post(request, onProgress, signal),
  };
}
