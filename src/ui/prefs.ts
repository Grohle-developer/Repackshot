// Per-browser interface preferences in localStorage. Every access is wrapped:
// private windows, blocked storage or quota errors fall back to defaults.
//
// The application settings (core/settings.ts) live in one entry,
// `repackshot.settings`: `{ schema, settings, layout }`. The loose entries of
// before (`repackshot.lang`, `repackshot.theme`, `repackshot.ui.*`) are read
// once, migrated into it and removed. On the desktop the window is a browser
// profile inside the data folder, so this travels with a portable folder.

import { LEGACY_PREF_KEYS, migrateDoc, migrateLegacy, type SettingsDoc } from '../core/settings';

const PREFIX = 'repackshot.';
export const SETTINGS_STORAGE_KEY = `${PREFIX}settings`;

export function readPref<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    if (raw === null) return fallback;
    const v = JSON.parse(raw) as unknown;
    return v === null || v === undefined || typeof v !== typeof fallback ? fallback : (v as T);
  } catch {
    return fallback;
  }
}

export function writePref(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // Storage unavailable or full: the preference simply is not remembered.
  }
}

/** The part of the Storage API used here (window.localStorage, or a test double). */
export interface KeyValue {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function storage(): KeyValue | null {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}

/**
 * The settings document: the stored one (migrated from whatever version wrote it), or the loose preferences of
 * before migrated into a new one (then saved, and the old entries removed), or the factory values.
 */
export function loadSettingsDoc(kv: KeyValue | null = storage()): { doc: SettingsDoc; migrated: boolean } {
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

/** Saves the document; false when the browser keeps nothing. */
export function saveSettingsDoc(doc: SettingsDoc, kv: KeyValue | null = storage()): boolean {
  if (!kv) return false;
  try {
    kv.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(doc));
    return true;
  } catch {
    return false;
  }
}
