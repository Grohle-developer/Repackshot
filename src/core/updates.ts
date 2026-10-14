// Updates (Settings ▸ Updates, and the quiet notice at startup): the pure part. Versions and how to
// compare them, what a published release is, how the answer of the release feed is read and checked,
// which package of a release is for this computer, why a check can fail, what the interface says
// about all of it, and (phase P5) what the application asks of the desktop launcher to install a new
// version from inside itself and how it reads the launcher's answer. The request for the feed is in
// src/io/updates.ts; the feed's address in src/data/update-feed.ts. No DOM, no network, no clock.

import type { Lang } from '../data/types';
import { UPDATE_FEED, type UpdateFeed } from '../data/update-feed';

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

// ------------------------------------------------------------------ installing from inside the application (P5)

/** The checksums file every release carries (packaging/release.mjs): the launcher holds the package to it. */
export const SUMS_NAME = 'SHA256SUMS.txt';

/**
 * `https://github.com/<owner>/<repo>/releases/download/<tag>/<file>` of the feed's repository and of this version
 * (with or without the `v` in the path), nothing more: no query, no fragment, no escape, no other path. The
 * launcher checks the same before it downloads anything (rt-app/src/update/feed.rs); this keeps the page from
 * even asking for anything else.
 */
export function downloadUrlAllowed(url: string, version: string, feed: UpdateFeed = UPDATE_FEED): boolean {
  const prefix = `https://github.com/${feed.owner}/${feed.repo}/releases/download/`;
  if (typeof url !== 'string' || url.length <= prefix.length || url.length > MAX_URL) return false;
  if (url.slice(0, prefix.length).toLowerCase() !== prefix.toLowerCase()) return false;
  const rest = url.slice(prefix.length).split('/');
  if (rest.length !== 2) return false;
  const [segment, file] = rest;
  if (segment !== version && segment !== `v${version}`) return false;
  return /^[A-Za-z0-9_][A-Za-z0-9._-]*$/.test(file) && !file.includes('..');
}

/** What `POST /api/update/install` takes. `size` is only for the progress (the package's size by the feed's word). */
export interface InstallRequest {
  tag: string;
  assetUrl: string;
  sumsUrl: string;
  size?: number;
}

/**
 * The request that installs `release` here: the package for this computer and the release's checksums, both
 * downloads of the feed's repository. Null when the application cannot (the web, a system without a package, a
 * release that lacks the package or its checksums): then Download, which opens the release page or the package.
 */
export function installRequest(release: ReleaseInfo, target: UpdateTarget, feed: UpdateFeed = UPDATE_FEED): InstallRequest | null {
  const asset = pickAsset(release, target);
  const sums = release.assets.find((a) => a.name === SUMS_NAME);
  if (!asset || !sums) return null;
  if (!downloadUrlAllowed(asset.url, release.version, feed) || !downloadUrlAllowed(sums.url, release.version, feed)) return null;
  return { tag: release.version, assetUrl: asset.url, sumsUrl: sums.url, ...(asset.size !== null && asset.size > 0 ? { size: asset.size } : {}) };
}

export type InstallState = 'IDLE' | 'DOWNLOADING' | 'VERIFYING' | 'INSTALLING' | 'FAILED';

/** The launcher's codes for a failed update (`error` of `GET /api/update`, and of a refused request). */
export type InstallErrorCode = 'download' | 'disk-full' | 'sums' | 'checksum' | 'extract' | 'install' | 'not-updatable' | 'busy' | 'bad-url' | 'bad-asset' | 'bad-tag' | 'lost' | 'other';

const ERROR_CODES: readonly string[] = ['download', 'disk-full', 'sums', 'checksum', 'extract', 'install', 'not-updatable', 'busy', 'bad-url', 'bad-asset', 'bad-tag', 'lost'];

/** `GET /api/update`, as the page keeps it. */
export interface InstallStatus {
  state: InstallState;
  /** The version being installed. */
  tag: string | null;
  /** Bytes downloaded, and the package's size (0: not known). */
  received: number;
  total: number;
  /** INSTALLING and the files are in place: the launcher waits for the window to close. */
  ready: boolean;
  error: InstallErrorCode | null;
  /** The launcher's own words, in English: for the log and the tooltip, not for the row. */
  message: string | null;
}

export const NO_INSTALL: InstallStatus = { state: 'IDLE', tag: null, received: 0, total: 0, ready: false, error: null, message: null };

/** An update under way: downloading, checking or installing. */
export const installActive = (s: Pick<InstallStatus, 'state'>): boolean => s.state === 'DOWNLOADING' || s.state === 'VERIFYING' || s.state === 'INSTALLING';

/** The code of an error word the launcher sent; `other` for one this version does not know. */
export function installErrorCode(code: unknown): InstallErrorCode {
  return typeof code === 'string' && ERROR_CODES.includes(code) ? (code as InstallErrorCode) : 'other';
}

const count = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : 0);

/** The launcher's `GET /api/update` answer; null when it is not one. */
export function parseInstallStatus(raw: unknown): InstallStatus | null {
  if (!isRecord(raw) || typeof raw.state !== 'string') return null;
  const state = (['IDLE', 'DOWNLOADING', 'VERIFYING', 'INSTALLING', 'FAILED'] as const).find((s) => s === raw.state);
  if (!state) return null;
  return {
    state,
    tag: typeof raw.tag === 'string' && raw.tag.length <= 64 ? raw.tag : null,
    received: count(raw.received),
    total: count(raw.total),
    ready: raw.ready === true,
    error: raw.error === null || raw.error === undefined ? null : installErrorCode(raw.error),
    message: typeof raw.message === 'string' ? raw.message.slice(0, 500) : null,
  };
}

/** How far a download is, 0 to 100, or null while the package's size is not known. */
export function installPercent(s: Pick<InstallStatus, 'received' | 'total'>): number | null {
  return s.total > 0 ? Math.min(100, Math.max(0, Math.floor((s.received / s.total) * 100))) : null;
}

/** `3,2 de 7,1 MB`: both in the unit of the total (so the unit is said once); the plain amount without a total. */
export function formatProgress(received: number, total: number, lang: Lang, of: string): string {
  const units = ['B', 'kB', 'MB', 'GB'];
  const nf = (digits: number) => new Intl.NumberFormat(lang === 'es' ? 'es-ES' : 'en-GB', { maximumFractionDigits: digits, minimumFractionDigits: digits });
  let unit = 0;
  for (let v = Math.max(total, received); v >= 1000 && unit < units.length - 1; v /= 1000) unit++;
  const scale = 1000 ** unit;
  const digits = unit === 0 ? 0 : Math.max(total, received) / scale < 10 ? 1 : 0;
  const fmt = nf(digits);
  const amount = (n: number) => fmt.format(n / scale);
  return total > 0 ? `${amount(Math.min(received, total))} ${of} ${amount(total)} ${units[unit]}` : `${amount(received)} ${units[unit]}`;
}

/**
 * The launcher's side of an update, as the interface uses it (src/io/update-install.ts). `install` and `cancel`
 * throw a NativeError (`code`: `not-updatable`, `bad-url`, `busy`…) when the launcher refuses or cannot be reached.
 */
export interface InstallerPort {
  status(): Promise<InstallStatus>;
  install(req: InstallRequest): Promise<InstallStatus>;
  cancel(): Promise<InstallStatus>;
}
