// Per-browser interface preferences in localStorage. Every access is wrapped:
// private windows, blocked storage or quota errors fall back to defaults.

const PREFIX = 'repackshot.';

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
