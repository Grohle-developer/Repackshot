// Where the API keys live (phase X7, AI-POST.md §8.3): on this computer only, one per host, never in a setting, a
// project, the library, a log or a crash report.
//
// - Desktop: the launcher keeps them in its data folder (`<data>/ai/api-keys.json`, readable only by the user) and
//   uses them itself when it calls the API; the page can store or forget one and list them masked, never read one back.
// - Web: the browser's local storage of this site (`repackshot.ai.apiKeys`), which anyone using this browser profile can
//   read; Settings says so before a key is saved (◆ where the key lives in the browser is the lead's to confirm).
//
// A key belongs to its host: a key typed for `api.stability.ai` is never sent to another, even if the URL changes.

import { maskKey, validKey } from '../core/ai-remote';
import type { NativeClient } from './native';

/** A stored key as the interface may see it. */
export interface StoredKey {
  host: string;
  masked: string;
}

export interface ApiKeyStore {
  /** Where the keys are: the launcher's data folder, or this browser. */
  readonly where: 'LAUNCHER' | 'BROWSER';
  list(): Promise<StoredKey[]>;
  has(host: string): Promise<boolean>;
  save(host: string, key: string): Promise<void>;
  forget(host: string): Promise<void>;
}

/** The web's store also hands the key to the page's own API backend (io/ai-api.ts): there is no one else to call. */
export interface BrowserApiKeyStore extends ApiKeyStore {
  key(host: string): string | null;
}

/** The local storage entry. */
export const BROWSER_KEYS_ENTRY = 'repackshot.ai.apiKeys';

/** Local storage, or what stands in for it (tests). */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export class BrowserKeyStore implements BrowserApiKeyStore {
  readonly where = 'BROWSER' as const;
  constructor(private readonly storage: KeyValueStorage | null) {}

  private read(): Record<string, string> {
    try {
      const v = JSON.parse(this.storage?.getItem(BROWSER_KEYS_ENTRY) ?? '{}') as unknown;
      if (typeof v !== 'object' || v === null || Array.isArray(v)) return {};
      return Object.fromEntries(Object.entries(v as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === 'string' && validKey(e[1])));
    } catch {
      return {};
    }
  }

  private write(keys: Record<string, string>): void {
    if (!this.storage) throw new Error('this browser keeps nothing for this page');
    if (Object.keys(keys).length === 0) this.storage.removeItem(BROWSER_KEYS_ENTRY);
    else this.storage.setItem(BROWSER_KEYS_ENTRY, JSON.stringify(keys));
  }

  async list(): Promise<StoredKey[]> {
    return Object.entries(this.read()).map(([host, key]) => ({ host, masked: maskKey(key) }));
  }

  async has(host: string): Promise<boolean> {
    return host in this.read();
  }

  key(host: string): string | null {
    return this.read()[host] ?? null;
  }

  async save(host: string, key: string): Promise<void> {
    if (!validKey(key)) throw new Error('not a key');
    this.write({ ...this.read(), [host]: key });
  }

  async forget(host: string): Promise<void> {
    const keys = this.read();
    delete keys[host];
    this.write(keys);
  }
}

/** The launcher's store (`/api/ai/apikeys`): the key goes in once and never comes back. */
export class LauncherKeyStore implements ApiKeyStore {
  readonly where = 'LAUNCHER' as const;
  constructor(private readonly native: Pick<NativeClient, 'request'>) {}

  private async call(path: string, init?: RequestInit): Promise<unknown> {
    const res = await this.native.request(path, init);
    const text = await res.text();
    if (!res.ok) {
      let message = `${res.status}`;
      try {
        message = (JSON.parse(text) as { message?: string }).message ?? message;
      } catch {
        // The status alone.
      }
      throw new Error(message);
    }
    return text ? (JSON.parse(text) as unknown) : null;
  }

  async list(): Promise<StoredKey[]> {
    const v = (await this.call('/api/ai/apikeys')) as { keys?: StoredKey[] } | null;
    return (v?.keys ?? []).filter((k) => typeof k.host === 'string' && typeof k.masked === 'string');
  }

  async has(host: string): Promise<boolean> {
    return (await this.list()).some((k) => k.host === host);
  }

  async save(host: string, key: string): Promise<void> {
    if (!validKey(key)) throw new Error('not a key');
    await this.call('/api/ai/apikeys', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ host, key }) });
  }

  async forget(host: string): Promise<void> {
    await this.call('/api/ai/apikeys/forget', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ host }) });
  }
}
