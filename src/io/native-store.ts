// The page's state kept by the desktop launcher (phase P3e, engine/crates/rt-app/src/appdata.rs):
// the settings document, small named documents, the library, the results history, the thumbnail
// cache and the space the data folder takes. A client over `NativeClient.request` (io/native.ts),
// which adds the launch token; the contract is engine/crates/rt-app/README.md (§ Page state).

import type { NativeClient } from './native';
import { NativeError } from './native';

/** The part of the launcher's client this needs (a test double implements just this). */
export type NativeRequester = Pick<NativeClient, 'request'>;

/** One part of the data folder as the launcher measured it. */
export interface FolderUsage {
  /** `models`, `results`, `library`, `thumbs`, `logs`, `window` (the window's own profile) or `other`. */
  id: string;
  path: string | null;
  bytes: number;
  files: number;
}

/** `GET /api/storage/usage`. */
export interface StorageUsage {
  dataDir: string;
  total: number;
  files: number;
  folders: FolderUsage[];
}

/** Names of the store: lower case `[a-z0-9._-]`, as the launcher accepts them. */
export const STORE_NAME_RE = /^[a-z0-9_-](?:[a-z0-9._-]{0,94}[a-z0-9_-])?$/;

export function checkStoreName(name: string): string {
  if (!STORE_NAME_RE.test(name) || name.includes('..')) throw new Error(`not a store name: ${name}`);
  return name;
}

/** Fetch's `keepalive` carries at most 64 KiB: a bigger body goes without it. */
const KEEPALIVE_MAX = 60 * 1024;

export class NativeStore {
  constructor(private readonly client: NativeRequester) {}

  private async send(path: string, init: RequestInit = {}): Promise<Response> {
    const res = await this.client.request(path, init);
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
      throw new NativeError(res.status, body.error ?? 'http', body.message ?? `${res.status}`);
    }
    return res;
  }

  private async getJson<T>(path: string): Promise<T> {
    return (await (await this.send(path)).json()) as T;
  }

  private async getText(path: string): Promise<string | null> {
    const text = await (await this.send(path)).text();
    return text === 'null' || text === '' ? null : text;
  }

  private async put(path: string, body: BodyInit, contentType: string, keepalive = false): Promise<void> {
    const size = typeof body === 'string' ? body.length * 3 : body instanceof Blob ? body.size : Infinity;
    await this.send(path, { method: 'PUT', body, headers: { 'Content-Type': contentType }, ...(keepalive && size <= KEEPALIVE_MAX ? { keepalive: true } : {}) });
  }

  private async del(path: string): Promise<Response> {
    return this.send(path, { method: 'DELETE' });
  }

  /** The settings document's text, or null when there is none yet. */
  settings(): Promise<string | null> {
    return this.getText('/api/store/settings');
  }

  /** `keepalive`: the write outlives the page (the window closing). */
  putSettings(text: string, keepalive = false): Promise<void> {
    return this.put('/api/store/settings', text, 'application/json', keepalive);
  }

  async deleteSettings(): Promise<void> {
    await this.del('/api/store/settings');
  }

  /** Every small document, by name. */
  docs(): Promise<Record<string, unknown>> {
    return this.getJson('/api/store/docs');
  }

  putDoc(name: string, text: string, keepalive = false): Promise<void> {
    return this.put(`/api/store/docs/${checkStoreName(name)}`, text, 'application/json', keepalive);
  }

  async deleteDoc(name: string): Promise<void> {
    await this.del(`/api/store/docs/${checkStoreName(name)}`);
  }

  /** The library file's text, or null. */
  library(): Promise<string | null> {
    return this.getText('/api/store/library');
  }

  putLibrary(text: string, keepalive = false): Promise<void> {
    return this.put('/api/store/library', text, 'application/json', keepalive);
  }

  async deleteLibrary(): Promise<void> {
    await this.del('/api/store/library');
  }

  /** The records of the results history, as they were sent. */
  async results(): Promise<unknown[]> {
    return (await this.getJson<{ results: unknown[] }>('/api/store/results')).results;
  }

  /**
   * A result: its file, its picture (when the file is one a page cannot show), the images the AI made (X4; X4b: each
   * variant as `…/ai/<n>`, the launcher's `<id>.ai.<n>.<ext>`), then its record.
   */
  async putResult(id: string, meta: unknown, file: Blob, display: Blob | null, ai: Blob | null = null, aiMore: readonly (Blob | null)[] = []): Promise<void> {
    const name = checkStoreName(id);
    const type = file.type || 'image/png';
    await this.put(`/api/store/results/${name}?type=${encodeURIComponent(type)}`, file, type);
    if (display) await this.put(`/api/store/results/${name}/display`, display, 'image/png');
    const variants = [ai, ...aiMore];
    for (const [i, blob] of variants.entries()) {
      if (!blob) continue;
      const aiType = blob.type || type;
      await this.put(`/api/store/results/${name}/ai/${i + 1}?type=${encodeURIComponent(aiType)}`, blob, aiType);
    }
    await this.put(`/api/store/results/${name}/meta`, JSON.stringify(meta), 'application/json');
  }

  /**
   * A result's file (`true`: its picture; `'ai'`: an image the AI made, `variant` 1 by default; the launcher reads a
   * result of before X4b's single AI image as variant 1), or null when it is not there.
   */
  async resultFile(id: string, part: boolean | 'ai' = false, variant = 1): Promise<Blob | null> {
    const res = await this.client.request(`/api/store/results/${checkStoreName(id)}${part === 'ai' ? `/ai/${Math.max(1, Math.round(variant))}` : part ? '/display' : ''}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new NativeError(res.status, 'http', `${res.status}`);
    const blob = await res.blob();
    const type = res.headers.get('content-type') ?? '';
    return type && blob.type !== type ? new Blob([blob], { type }) : blob;
  }

  async deleteResult(id: string): Promise<void> {
    await this.del(`/api/store/results/${checkStoreName(id)}`);
  }

  async clearResults(): Promise<void> {
    await this.del('/api/store/results');
  }

  /** A cached thumbnail, or null (the launcher answers a miss with 204). */
  async cacheGet(key: string): Promise<string | null> {
    const res = await this.client.request(`/api/store/cache/${checkStoreName(key)}`);
    if (res.status === 204 || res.status === 404) return null;
    if (!res.ok) throw new NativeError(res.status, 'http', `${res.status}`);
    return res.text();
  }

  cachePut(key: string, text: string): Promise<void> {
    return this.put(`/api/store/cache/${checkStoreName(key)}`, text, 'text/plain; charset=utf-8');
  }

  /** Deletes the thumbnail cache; the bytes freed. */
  async cacheClear(): Promise<number> {
    const body = (await (await this.del('/api/store/cache')).json()) as { freed?: number };
    return body.freed ?? 0;
  }

  usage(): Promise<StorageUsage> {
    return this.getJson('/api/storage/usage');
  }
}
