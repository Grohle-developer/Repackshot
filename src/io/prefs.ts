// The settings document and the small remembered things, over a key-value store: the browser's
// localStorage in the web version, the launcher's data folder on the desktop (io/platform.ts gives
// each its `KeyValue`). Every access is wrapped: private windows, blocked storage or quota errors
// fall back to defaults.
//
// The application settings (core/settings.ts) live in one entry, `repackshot.settings`:
// `{ schema, settings, layout }`. The loose entries of before (`repackshot.lang`,
// `repackshot.theme`, `repackshot.ui.*`) are read once, migrated into it and removed.

import { LEGACY_PREF_KEYS, migrateDoc, migrateLegacy, type SettingsDoc } from '../core/settings';

export const PREFIX = 'repackshot.';
export const SETTINGS_STORAGE_KEY = `${PREFIX}settings`;

/** The part of the Storage API used here (window.localStorage, the launcher's store, or a test double). */
export interface KeyValue {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** The browser's localStorage, or null where it cannot be had. Only the web platform calls this. */
export function browserKeyValue(): KeyValue | null {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}

/** A remembered value (JSON under `repackshot.<key>`), or `fallback` when missing, unreadable or of another type. */
export function readPref<T>(kv: KeyValue | null, key: string, fallback: T): T {
  try {
    const raw = kv?.getItem(PREFIX + key) ?? null;
    if (raw === null) return fallback;
    const v = JSON.parse(raw) as unknown;
    return v === null || v === undefined || (fallback !== null && typeof v !== typeof fallback) ? fallback : (v as T);
  } catch {
    return fallback;
  }
}

export function writePref(kv: KeyValue | null, key: string, value: unknown): void {
  try {
    kv?.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // Storage unavailable or full: the preference simply is not remembered.
  }
}

/**
 * The settings document: the stored one (migrated from whatever version wrote it), or the loose preferences of
 * before migrated into a new one (then saved, and the old entries removed), or the factory values.
 */
export function loadSettingsDoc(kv: KeyValue | null): { doc: SettingsDoc; migrated: boolean } {
  if (!kv) return { doc: migrateDoc(null), migrated: false };
  let raw: string | null = null;
  try {
    raw = kv.getItem(SETTINGS_STORAGE_KEY);
  } catch {
    raw = null;
  }
  if (raw !== null) {
    try {
      return { doc: migrateDoc(JSON.parse(raw)), migrated: false };
    } catch {
      // A broken entry: the factory values (the broken text is kept aside for a look).
      try {
        kv.setItem(`${SETTINGS_STORAGE_KEY}.corrupt`, raw);
      } catch {
        // Nothing more to do.
      }
      return { doc: migrateDoc(null), migrated: false };
    }
  }
  const legacy: Record<string, unknown> = {};
  for (const k of LEGACY_PREF_KEYS) {
    try {
      const v = kv.getItem(PREFIX + k);
      if (v !== null) legacy[k] = JSON.parse(v);
    } catch {
      // An unreadable entry is left out.
    }
  }
  const doc = migrateLegacy(legacy);
  if (Object.keys(legacy).length === 0) return { doc, migrated: false };
  if (saveSettingsDoc(doc, kv)) {
    for (const k of LEGACY_PREF_KEYS) {
      try {
        kv.removeItem(PREFIX + k);
      } catch {
        // Left behind: harmless, it is never read again.
      }
    }
  }
  return { doc, migrated: true };
}

/** Saves the document; false when the store keeps nothing. */
export function saveSettingsDoc(doc: SettingsDoc, kv: KeyValue | null): boolean {
  if (!kv) return false;
  try {
    kv.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(doc));
    return true;
  } catch {
    return false;
  }
}
