// The desktop launcher's AI runtime (engine/crates/rt-app/src/ai/, the
// contract in engine/crates/rt-app/README.md ▸ IA): the status of the chosen
// stable-diffusion.cpp build, its download (the launcher downloads it with
// the system's curl: GitHub's release downloads cannot be fetched from this
// page), pause, removal, installing an archive the person downloaded, and one
// raw img2img inference with progress and cancel. The guard and the pipeline
// are X3a and X3c; this is what they call on the desktop.

import type { AiRunRequest, AiRunState, AiRuntimeEntryState, AiRuntimePort, AiRuntimeQuery, AiRuntimeReport } from '../core/ai-runtimes';
import { NativeError, type NativeClient } from './native';

const KEY_RE = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,127}$/;

function checkKey(key: string): string {
  if (!KEY_RE.test(key) || key.includes('..')) throw new Error(`not a runtime key: ${key}`);
  return key;
}

/** The query string of `GET /api/ai/runtime`. */
export function statusQuery(q: AiRuntimeQuery): string {
  const p = new URLSearchParams();
  if (q.force) p.set('force', q.force);
  if (q.cpu) p.set('device', 'cpu');
  if (q.model) p.set('model', q.model);
  const s = p.toString();
  return s ? `?${s}` : '';
}

const FINISHED: readonly string[] = ['DONE', 'FAILED', 'CANCELLED'];

/** A run that did not give an image. */
export class AiRunError extends Error {
  constructor(
    readonly state: AiRunState,
  ) {
    super(state.message ?? state.state);
  }
}

export class AiRuntimeClient implements AiRuntimePort {
  constructor(private readonly native: NativeClient) {}

  private async json<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await this.native.request(path, init);
    const text = await res.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    if (!res.ok) {
      const e = (body ?? {}) as { error?: string; message?: string; reason?: string };
      throw new NativeError(res.status, e.reason ?? e.error ?? 'http', e.message ?? `${res.status}`);
    }
    return body as T;
  }

  status(q: AiRuntimeQuery): Promise<AiRuntimeReport> {
    return this.json(`/api/ai/runtime${statusQuery(q)}`);
  }

  entry(key: string): Promise<AiRuntimeEntryState> {
    return this.json(`/api/ai/runtimes/${checkKey(key)}`);
  }

  async download(key: string): Promise<void> {
    await this.json(`/api/ai/runtimes/${checkKey(key)}/download`, { method: 'POST' });
  }

  async pause(key: string): Promise<void> {
    await this.json(`/api/ai/runtimes/${checkKey(key)}/pause`, { method: 'POST' });
  }

  async remove(key: string): Promise<void> {
    await this.json(`/api/ai/runtimes/${checkKey(key)}`, { method: 'DELETE' });
  }

  /** Asks the installed runtime its version and devices again. */
  probe(key: string): Promise<AiRuntimeEntryState> {
    return this.json(`/api/ai/runtimes/${checkKey(key)}/probe`, { method: 'POST' });
  }

  async installFromFile(key: string, dialog: { title: string; filterName: string }): Promise<boolean> {
    const chosen = await this.native.dialogOpen({ title: dialog.title, filters: [{ name: dialog.filterName, extensions: ['zip'] }] });
    if (chosen.cancelled) return false;
    await this.json(`/api/ai/runtimes/${checkKey(key)}/import`, { method: 'POST', body: JSON.stringify({ file: chosen.file.id }) });
    return true;
  }

  async release(): Promise<void> {
    await this.json('/api/ai/sidecar', { method: 'DELETE' });
  }

  /** Queues one inference. */
  run(req: AiRunRequest): Promise<AiRunState> {
    return this.json('/api/ai/run', { method: 'POST', body: JSON.stringify(req) });
  }

  /** The run's state; with `after`, waits up to a second for a newer one. */
  runState(id: number, after?: number): Promise<AiRunState> {
    return this.json(`/api/ai/run/${id}${after === undefined ? '' : `?after=${after}`}`);
  }

  async runImage(id: number): Promise<Blob> {
    const res = await this.native.request(`/api/ai/run/${id}/image`);
    if (!res.ok) throw new NativeError(res.status, 'not-done', `${res.status}`);
    return res.blob();
  }

  /** Cancels a run, or forgets a finished one. */
  async cancelRun(id: number): Promise<void> {
    await this.json(`/api/ai/run/${id}`, { method: 'DELETE' });
  }

  /**
   * One inference to its end: the progress as it comes, the PNG at the end; `signal` cancels. A run that fails
   * throws an AiRunError with its state (the error code and message).
   */
  async infer(req: AiRunRequest, onProgress: (s: AiRunState) => void, signal?: AbortSignal): Promise<Blob> {
    let s = await this.run(req);
    const cancel = () => void this.cancelRun(s.id).catch(() => undefined);
    signal?.addEventListener('abort', cancel, { once: true });
    try {
      onProgress(s);
      while (!FINISHED.includes(s.state)) {
        s = await this.runState(s.id, s.version);
        onProgress(s);
      }
      if (s.state !== 'DONE') throw new AiRunError(s);
      const png = await this.runImage(s.id);
      await this.cancelRun(s.id).catch(() => undefined);
      return png;
    } finally {
      signal?.removeEventListener('abort', cancel);
    }
  }
}
