// Updates (Settings ▸ Updates, and the quiet notice at startup): the pure part. Versions and how to
// compare them, what a published release is, how the answer of the release feed is read and checked,
// which package of a release is for this computer, why a check can fail, and what the interface says
// about all of it. The request itself is in src/io/updates.ts; the feed's address in
// src/data/update-feed.ts. No DOM, no network, no clock.

/** A semantic version: `major.minor.patch` and, after a hyphen, pre-release identifiers. */
export interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  pre: string[];
}

const IDENT = '[0-9A-Za-z-]+';
const VERSION_RE = new RegExp(`^[vV]?(\\d{1,9})\\.(\\d{1,9})\\.(\\d{1,9})(?:-(${IDENT}(?:\\.${IDENT})*))?(?:\\+${IDENT}(?:\\.${IDENT})*)?$`);

/** `v0.2.0`, `0.2.0`, `1.0.0-beta.2`, `1.0.0+build5`; null for anything else. */
export function parseVersion(text: string): ParsedVersion | null {
  const m = VERSION_RE.exec(text.trim());
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), pre: m[4] ? m[4].split('.') : [] };
}

const isNumeric = (s: string) => /^\d+$/.test(s);

function comparePre(a: string[], b: string[]): -1 | 0 | 1 {
  // A version without pre-release identifiers is later than one with them.
  if (a.length === 0 || b.length === 0) return a.length === b.length ? 0 : a.length === 0 ? 1 : -1;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const x = a[i];
    const y = b[i];
    if (x === y) continue;
    const nx = isNumeric(x);
    const ny = isNumeric(y);
    if (nx && ny) return Number(x) < Number(y) ? -1 : 1;
    // Numbers sort before words; words by their characters.
    if (nx !== ny) return nx ? -1 : 1;
    return x < y ? -1 : 1;
  }
  return a.length === b.length ? 0 : a.length < b.length ? -1 : 1;
}

/** -1, 0 or 1 as `a` is older than, the same as or newer than `b`; null when either is not a version. */
export function compareVersions(a: string, b: string): -1 | 0 | 1 | null {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) return null;
  for (const k of ['major', 'minor', 'patch'] as const) if (x[k] !== y[k]) return x[k] < y[k] ? -1 : 1;
  return comparePre(x.pre, y.pre);
}

/** `version` is a later version than `current` (false when either cannot be read). */
export function isNewer(version: string, current: string): boolean {
  return compareVersions(version, current) === 1;
}

// ------------------------------------------------------------------ releases

export interface ReleaseAsset {
  name: string;
  /** https link that downloads the file. */
  url: string;
  /** Bytes, as the feed says; null when it does not. */
  size: number | null;
}

/** A published release, as far as the interface needs it. Plain JSON: it is also what the settings document keeps. */
export interface ReleaseInfo {
  /** The tag without a leading `v`: `0.2.0`. */
  version: string;
  /** ISO date-time of the publication, when the feed gives one. */
  publishedAt: string | null;
  /** https page of the release (its notes). */
  pageUrl: string;
  assets: ReleaseAsset[];
}

const MAX_ASSETS = 50;
const MAX_URL = 2048;

/** An https URL, or null (never `javascript:`, `http:` or a relative path: these links are opened). */
export function httpsUrl(v: unknown): string | null {
  if (typeof v !== 'string' || v.length === 0 || v.length > MAX_URL) return null;
  try {
    return new URL(v).protocol === 'https:' ? v : null;
  } catch {
    return null;
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function validAsset(name: unknown, url: unknown, size: unknown): ReleaseAsset | null {
  const u = httpsUrl(url);
  if (typeof name !== 'string' || name === '' || name.length > 200 || !u) return null;
  return { name, url: u, size: typeof size === 'number' && Number.isFinite(size) && size >= 0 ? Math.round(size) : null };
}

function validDate(v: unknown): string | null {
  return typeof v === 'string' && v.length <= 40 && Number.isFinite(Date.parse(v)) ? v : null;
}

/**
 * The answer of `GET /repos/<owner>/<repo>/releases/latest` as a release: `tag_name` (a version, with or
 * without `v`), `published_at`, `html_url` and `assets[].name / browser_download_url / size`. Null when it
 * is not the answer of a release (no readable tag, no https page).
 */
export function parseRelease(json: unknown): ReleaseInfo | null {
  if (!isRecord(json) || typeof json.tag_name !== 'string') return null;
  const tag = json.tag_name.trim();
  if (!parseVersion(tag)) return null;
  const pageUrl = httpsUrl(json.html_url);
  if (!pageUrl) return null;
  const assets: ReleaseAsset[] = [];
  if (Array.isArray(json.assets)) {
    for (const a of json.assets) {
      if (assets.length >= MAX_ASSETS) break;
      const asset = isRecord(a) ? validAsset(a.name, a.browser_download_url, a.size) : null;
      if (asset) assets.push(asset);
    }
  }
  return { version: tag.replace(/^v/i, ''), publishedAt: validDate(json.published_at), pageUrl, assets };
}

/** A release read back from the settings document (the shape of ReleaseInfo, not the feed's); null when it is not one. */
export function validRelease(raw: unknown): ReleaseInfo | null {
  if (!isRecord(raw) || typeof raw.version !== 'string' || !parseVersion(raw.version) || raw.version.length > 64) return null;
  const pageUrl = httpsUrl(raw.pageUrl);
  if (!pageUrl) return null;
  const assets: ReleaseAsset[] = [];
  if (Array.isArray(raw.assets)) {
    for (const a of raw.assets) {
      if (assets.length >= MAX_ASSETS) break;
      const asset = isRecord(a) ? validAsset(a.name, a.url, a.size) : null;
      if (asset) assets.push(asset);
    }
  }
  return { version: raw.version, publishedAt: validDate(raw.publishedAt), pageUrl, assets };
}

// ------------------------------------------------------------------ which package is for this computer

/** What the page knows about where it runs: the browser, or the desktop application (its system and package). */
export interface UpdateTarget {
  desktop: boolean;
  /** The launcher's `os`: `windows`, `linux`, `macos`. */
  os?: string;
  /** The launcher's `arch`: `x86_64`, `aarch64`. */
  arch?: string;
  /** Running from a portable folder rather than installed. */
  portable?: boolean;
}

export type PackageKind = 'WINDOWS_SETUP' | 'WINDOWS_PORTABLE' | 'LINUX_PORTABLE';

/** The file name packaging/release.mjs gives each package of a version. */
export function packageName(version: string, kind: PackageKind): string {
  switch (kind) {
    case 'WINDOWS_SETUP':
      return `Repackshot-${version}-windows-x64-setup.exe`;
    case 'WINDOWS_PORTABLE':
      return `Repackshot-${version}-windows-x64-portable.zip`;
    case 'LINUX_PORTABLE':
      return `Repackshot-${version}-linux-x64-portable.tar.gz`;
  }
}

/** The package that replaces what runs here, or null (the browser, another system, another architecture). */
export function packageFor(target: UpdateTarget): PackageKind | null {
  if (!target.desktop) return null;
  // Only x64 packages are built.
  if (target.arch !== undefined && !['x86_64', 'x64', 'amd64'].includes(target.arch.toLowerCase())) return null;
  if (target.os === 'windows') return target.portable ? 'WINDOWS_PORTABLE' : 'WINDOWS_SETUP';
  if (target.os === 'linux') return 'LINUX_PORTABLE';
  return null;
}

/** The asset of a release to download for this computer; null sends the person to the release page. */
export function pickAsset(release: ReleaseInfo, target: UpdateTarget): ReleaseAsset | null {
  const kind = packageFor(target);
  if (!kind) return null;
  const name = packageName(release.version, kind);
  return release.assets.find((a) => a.name === name) ?? null;
}

// ------------------------------------------------------------------ why a check fails

export type UpdateFaultCode = 'NOT_FOUND' | 'RATE_LIMITED' | 'OFFLINE' | 'TIMEOUT' | 'BAD_FEED' | 'HTTP';

export interface UpdateFault {
  code: UpdateFaultCode;
  /** HTTP: the status the feed answered with. */
  status?: number;
}

export type UpdateOutcome = { ok: true; release: ReleaseInfo } | { ok: false; fault: UpdateFault };

/**
 * The fault of an HTTP answer that is not a success. 404: no published release (a private repository answers
 * the same as one without releases). GitHub says "rate limited" with 429, or 403 and `x-ratelimit-remaining: 0`
 * or `retry-after`; any other 403 is just an error.
 */
export function faultFromStatus(status: number, header: (name: string) => string | null): UpdateFault {
  if (status === 404) return { code: 'NOT_FOUND' };
  if (status === 429) return { code: 'RATE_LIMITED' };
  if (status === 403 && (header('x-ratelimit-remaining')?.trim() === '0' || header('retry-after') !== null)) return { code: 'RATE_LIMITED' };
  return { code: 'HTTP', status };
}

// ------------------------------------------------------------------ what the interface says

export interface UpdateSummary {
  /** CHECKING, then FAILED (the last check of this session), AVAILABLE, LATEST (what is known is not newer), NEVER. */
  state: 'CHECKING' | 'FAILED' | 'AVAILABLE' | 'LATEST' | 'NEVER';
  fault: UpdateFault | null;
  /** A published release newer than the running version, from this check or an earlier one; shown even when the last check failed. */
  available: ReleaseInfo | null;
}

export function summarizeUpdates(o: { current: string; checking: boolean; fault: UpdateFault | null; latest: ReleaseInfo | null }): UpdateSummary {
  const available = o.latest && isNewer(o.latest.version, o.current) ? o.latest : null;
  const state = o.checking ? 'CHECKING' : o.fault ? 'FAILED' : available ? 'AVAILABLE' : o.latest ? 'LATEST' : 'NEVER';
  return { state, fault: o.fault, available };
}
