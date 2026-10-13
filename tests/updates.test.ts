// Updates (Settings ▸ Updates and the check at startup): versions and their order, reading the answer of
// GitHub's `releases/latest`, which package is for which computer, every way the request can fail (with a fake
// fetch: no network), the check at startup (only with the setting on, once, a version announced once, never a
// window), what is remembered between sessions, and where the section sits in the Settings window.

import { describe, expect, it, vi } from 'vitest';
import {
  compareVersions,
  faultFromStatus,
  isNewer,
  packageFor,
  packageName,
  parseRelease,
  parseVersion,
  pickAsset,
  summarizeUpdates,
  validRelease,
  type ReleaseInfo,
  type UpdateOutcome,
  type UpdateTarget,
} from '../src/core/updates';
import { defaultLayout, defaultSettings, migrateDoc, rowsOf, searchSettings, SECTIONS, SETTING_ROWS, withSetting, type RowMeta } from '../src/core/settings';
import { createInitialState, createStore } from '../src/core/store';
import { VERSION } from '../src/core/version';
import { UPDATE_FEED } from '../src/data/update-feed';
import type { Lang } from '../src/data/types';
import { fetchLatestRelease, latestReleaseUrl, UPDATE_TIMEOUT_MS } from '../src/io/updates';
import { CUSTOM_ROW_IDS } from '../src/ui/panels/settings-window';
import type { AppServices } from '../src/ui/ports';
import type { Ctx } from '../src/ui/reactive';
import { STRINGS, formatDate, formatDateTime, type StringKey } from '../src/ui/strings';
import { createUiStore } from '../src/ui/ui-state';
import { availableText, checkForUpdates, dismissUpdateNotice, downloadChoice, downloadUpdate, faultText, openReleaseNotes, startupUpdateCheck, updateSummary } from '../src/ui/updates';

// ------------------------------------------------------------------ fixtures

/** The shape of GitHub's answer (REST: "Get the latest release"), with the fields the application ignores. */
const GITHUB_LATEST = {
  url: 'https://api.github.com/repos/Grohle-developer/Repackshot/releases/301',
  assets_url: 'https://api.github.com/repos/Grohle-developer/Repackshot/releases/301/assets',
  html_url: 'https://github.com/Grohle-developer/Repackshot/releases/tag/v0.2.0',
  id: 301,
  author: { login: 'Grohle-developer', id: 1, type: 'User' },
  node_id: 'RE_kwDOAAAAAA',
  tag_name: 'v0.2.0',
  target_commitish: 'main',
  name: 'Repackshot 0.2.0',
  draft: false,
  prerelease: false,
  created_at: '2026-10-14T08:00:00Z',
  published_at: '2026-10-14T09:30:00Z',
  assets: [
    {
      url: 'https://api.github.com/repos/Grohle-developer/Repackshot/releases/assets/1',
      id: 1,
      name: 'Repackshot-0.2.0-windows-x64-setup.exe',
      content_type: 'application/x-msdownload',
      state: 'uploaded',
      size: 38_400_000,
      download_count: 12,
      browser_download_url: 'https://github.com/Grohle-developer/Repackshot/releases/download/v0.2.0/Repackshot-0.2.0-windows-x64-setup.exe',
    },
    {
      id: 2,
      name: 'Repackshot-0.2.0-windows-x64-portable.zip',
      size: 41_000_000,
      browser_download_url: 'https://github.com/Grohle-developer/Repackshot/releases/download/v0.2.0/Repackshot-0.2.0-windows-x64-portable.zip',
    },
    {
      id: 3,
      name: 'Repackshot-0.2.0-linux-x64-portable.tar.gz',
      size: 39_000_000,
      browser_download_url: 'https://github.com/Grohle-developer/Repackshot/releases/download/v0.2.0/Repackshot-0.2.0-linux-x64-portable.tar.gz',
    },
    {
      id: 4,
      name: 'SHA256SUMS.txt',
      size: 300,
      browser_download_url: 'https://github.com/Grohle-developer/Repackshot/releases/download/v0.2.0/SHA256SUMS.txt',
    },
  ],
  tarball_url: 'https://api.github.com/repos/Grohle-developer/Repackshot/tarball/v0.2.0',
  body: '## 0.2.0\n\nUpdates.',
};

const RELEASE_020 = parseRelease(GITHUB_LATEST) as ReleaseInfo;
const SETUP = 'Repackshot-0.2.0-windows-x64-setup.exe';
const ZIP = 'Repackshot-0.2.0-windows-x64-portable.zip';
const TARGZ = 'Repackshot-0.2.0-linux-x64-portable.tar.gz';

const releaseOf = (version: string): ReleaseInfo => ({ ...RELEASE_020, version, pageUrl: `https://github.com/Grohle-developer/Repackshot/releases/tag/v${version}` });

// ------------------------------------------------------------------ versions

describe('versions: reading', () => {
  it('reads major.minor.patch with or without v, a pre-release and build metadata', () => {
    expect(parseVersion('0.2.0')).toEqual({ major: 0, minor: 2, patch: 0, pre: [] });
    expect(parseVersion('v0.2.0')).toEqual({ major: 0, minor: 2, patch: 0, pre: [] });
    expect(parseVersion('V10.20.30')).toEqual({ major: 10, minor: 20, patch: 30, pre: [] });
    expect(parseVersion(' 1.0.0-beta.2 ')).toEqual({ major: 1, minor: 0, patch: 0, pre: ['beta', '2'] });
    expect(parseVersion('1.0.0+build.5')).toEqual({ major: 1, minor: 0, patch: 0, pre: [] });
  });

  it('rejects what is not a version', () => {
    for (const bad of ['', 'v', 'abc', 'nightly', '1', '1.2', '1.2.x', '1.2.3.4', 'v1..2', '-1.0.0', '1.0.0-', '1.0.0-beta..1', '1.0.0 beta']) expect(parseVersion(bad), JSON.stringify(bad)).toBeNull();
  });
});

describe('versions: order', () => {
  it('equal, newer and older, numerically and not by characters', () => {
    expect(compareVersions('0.1.0', '0.1.0')).toBe(0);
    expect(compareVersions('v0.1.0', '0.1.0')).toBe(0);
    expect(compareVersions('0.2.0', '0.1.0')).toBe(1);
    expect(compareVersions('0.1.0', '0.2.0')).toBe(-1);
    expect(compareVersions('0.1.1', '0.1.0')).toBe(1);
    expect(compareVersions('1.0.0', '0.99.99')).toBe(1);
    expect(compareVersions('0.10.0', '0.9.0')).toBe(1);
    expect(compareVersions('0.9.0', '0.10.0')).toBe(-1);
    expect(compareVersions('0.1.10', '0.1.9')).toBe(1);
  });

  it('a pre-release sorts before its release, and pre-releases among themselves as semver says', () => {
    expect(compareVersions('1.0.0-beta', '1.0.0')).toBe(-1);
    expect(compareVersions('1.0.0', '1.0.0-rc.1')).toBe(1);
    expect(compareVersions('1.0.0-alpha', '1.0.0-beta')).toBe(-1);
    expect(compareVersions('1.0.0-beta.2', '1.0.0-beta.11')).toBe(-1);
    expect(compareVersions('1.0.0-beta', '1.0.0-beta.1')).toBe(-1);
    expect(compareVersions('1.0.0-1', '1.0.0-alpha')).toBe(-1);
    expect(compareVersions('1.0.0-rc.1', '1.0.0-rc.1')).toBe(0);
    // A pre-release of a later version is still later than the earlier release.
    expect(compareVersions('0.3.0-beta', '0.2.0')).toBe(1);
    // Build metadata does not count.
    expect(compareVersions('1.0.0+a', '1.0.0+b')).toBe(0);
  });

  it('says nothing about garbage', () => {
    expect(compareVersions('abc', '1.0.0')).toBeNull();
    expect(compareVersions('1.0.0', '')).toBeNull();
    expect(isNewer('abc', '0.1.0')).toBe(false);
    expect(isNewer('0.2.0', 'abc')).toBe(false);
    expect(isNewer('0.2.0', '0.1.0')).toBe(true);
    expect(isNewer('0.1.0', '0.1.0')).toBe(false);
    expect(isNewer('0.1.0', '0.2.0')).toBe(false);
  });
});

// ------------------------------------------------------------------ the answer of the feed

describe('the release feed: reading the answer', () => {
  it('reads GitHub’s answer: the tag without v, the date, the page and the assets', () => {
    expect(RELEASE_020).toEqual({
      version: '0.2.0',
      publishedAt: '2026-10-14T09:30:00Z',
      pageUrl: 'https://github.com/Grohle-developer/Repackshot/releases/tag/v0.2.0',
      assets: [
        { name: SETUP, url: `https://github.com/Grohle-developer/Repackshot/releases/download/v0.2.0/${SETUP}`, size: 38_400_000 },
        { name: ZIP, url: `https://github.com/Grohle-developer/Repackshot/releases/download/v0.2.0/${ZIP}`, size: 41_000_000 },
        { name: TARGZ, url: `https://github.com/Grohle-developer/Repackshot/releases/download/v0.2.0/${TARGZ}`, size: 39_000_000 },
        { name: 'SHA256SUMS.txt', url: 'https://github.com/Grohle-developer/Repackshot/releases/download/v0.2.0/SHA256SUMS.txt', size: 300 },
      ],
    });
  });

  it('a tag without v, no assets and no date are fine', () => {
    expect(parseRelease({ tag_name: '1.4.0', html_url: 'https://github.com/o/r/releases/tag/1.4.0' })).toEqual({ version: '1.4.0', publishedAt: null, pageUrl: 'https://github.com/o/r/releases/tag/1.4.0', assets: [] });
    expect(parseRelease({ ...GITHUB_LATEST, published_at: 'yesterday' })?.publishedAt).toBeNull();
  });

  it('is not the answer of a release when the tag is no version or the page is no https link', () => {
    expect(parseRelease({ ...GITHUB_LATEST, tag_name: 'nightly' })).toBeNull();
    expect(parseRelease({ ...GITHUB_LATEST, tag_name: undefined })).toBeNull();
    expect(parseRelease({ ...GITHUB_LATEST, tag_name: 2 })).toBeNull();
    expect(parseRelease({ ...GITHUB_LATEST, html_url: undefined })).toBeNull();
    expect(parseRelease({ ...GITHUB_LATEST, html_url: 'javascript:alert(1)' })).toBeNull();
    expect(parseRelease({ ...GITHUB_LATEST, html_url: 'http://github.com/o/r' })).toBeNull();
    for (const junk of [null, undefined, 'text', 3, [], [GITHUB_LATEST], {}, { message: 'Not Found', documentation_url: 'https://docs.github.com' }]) expect(parseRelease(junk), JSON.stringify(junk)).toBeNull();
  });

  it('drops assets that are unusable instead of failing: no name, no https link, a size that is not a number', () => {
    const r = parseRelease({
      ...GITHUB_LATEST,
      assets: [
        { name: 'a.zip', browser_download_url: 'http://example.com/a.zip', size: 1 },
        { name: 'b.zip', browser_download_url: 'javascript:alert(1)', size: 1 },
        { name: '', browser_download_url: 'https://example.com/c.zip', size: 1 },
        { browser_download_url: 'https://example.com/d.zip', size: 1 },
        'junk',
        null,
        { name: 'e.zip', browser_download_url: 'https://example.com/e.zip', size: 'big' },
        { name: 'f.zip', browser_download_url: 'https://example.com/f.zip' },
      ],
    });
    expect(r?.assets).toEqual([
      { name: 'e.zip', url: 'https://example.com/e.zip', size: null },
      { name: 'f.zip', url: 'https://example.com/f.zip', size: null },
    ]);
  });
});

// ------------------------------------------------------------------ which package

describe('the package for this computer', () => {
  const web: UpdateTarget = { desktop: false };
  const win = (portable: boolean): UpdateTarget => ({ desktop: true, os: 'windows', arch: 'x86_64', portable });
  const linux = (portable: boolean): UpdateTarget => ({ desktop: true, os: 'linux', arch: 'x86_64', portable });

  it('names the files as packaging/release.mjs does', () => {
    expect(packageName('0.2.0', 'WINDOWS_SETUP')).toBe(SETUP);
    expect(packageName('0.2.0', 'WINDOWS_PORTABLE')).toBe(ZIP);
    expect(packageName('0.2.0', 'LINUX_PORTABLE')).toBe(TARGZ);
  });

  it('the browser gets the release page (no asset), whatever system it runs on', () => {
    expect(packageFor(web)).toBeNull();
    expect(pickAsset(RELEASE_020, web)).toBeNull();
    expect(pickAsset(RELEASE_020, { desktop: false, os: 'windows', arch: 'x86_64', portable: false })).toBeNull();
    expect(pickAsset(RELEASE_020, { desktop: false, os: 'linux', arch: 'x86_64', portable: true })).toBeNull();
  });

  it('Windows installed gets the installer, Windows portable the zip, Linux the tar.gz', () => {
    expect(pickAsset(RELEASE_020, win(false))?.name).toBe(SETUP);
    expect(pickAsset(RELEASE_020, win(true))?.name).toBe(ZIP);
    expect(pickAsset(RELEASE_020, linux(true))?.name).toBe(TARGZ);
    // The only Linux package is the portable one, installed or not.
    expect(pickAsset(RELEASE_020, linux(false))?.name).toBe(TARGZ);
    expect(pickAsset(RELEASE_020, win(false))?.url).toContain('/download/v0.2.0/');
  });

  it('another system, another architecture or a package that was not published get the release page', () => {
    expect(pickAsset(RELEASE_020, { desktop: true, os: 'macos', arch: 'aarch64', portable: false })).toBeNull();
    expect(pickAsset(RELEASE_020, { desktop: true, os: 'windows', arch: 'aarch64', portable: false })).toBeNull();
    expect(pickAsset(RELEASE_020, { desktop: true, portable: false })).toBeNull();
    expect(pickAsset({ ...RELEASE_020, assets: [] }, win(false))).toBeNull();
    expect(pickAsset({ ...RELEASE_020, assets: RELEASE_020.assets.filter((a) => a.name !== SETUP) }, win(false))).toBeNull();
    // A file of another version is not this release's.
    expect(pickAsset({ ...RELEASE_020, version: '0.3.0' }, win(false))).toBeNull();
  });

  it('Download opens the package when there is one, else the release page', () => {
    const ctx = makeCtx(async () => ({ ok: true, release: RELEASE_020 }));
    expect(downloadChoice(ctx, RELEASE_020)).toEqual({ asset: null, url: RELEASE_020.pageUrl });
    ctx.ui.set({ desktop: { portable: false, dataDir: 'd', modelsDir: 'm', logsDir: 'l', browser: null, version: '0.1.0', os: 'windows', arch: 'x86_64' } });
    expect(downloadChoice(ctx, RELEASE_020).asset?.name).toBe(SETUP);
    expect(downloadChoice(ctx, RELEASE_020).url).toBe(RELEASE_020.assets[0].url);
    ctx.ui.set({ desktop: { portable: true, dataDir: 'd', modelsDir: 'm', logsDir: 'l', browser: null, version: '0.1.0', os: 'windows', arch: 'x86_64' } });
    expect(downloadChoice(ctx, RELEASE_020).asset?.name).toBe(ZIP);
    expect(downloadChoice(ctx, { ...RELEASE_020, assets: [] })).toEqual({ asset: null, url: RELEASE_020.pageUrl });
  });

  it('Download and Release notes go out through services.openExternal (https only), never window.open', async () => {
    const opened: string[] = [];
    const ctx = makeCtx(async () => ({ ok: true, release: RELEASE_020 }));
    (ctx.services as { openExternal: (u: string) => Promise<void> }).openExternal = async (u) => void opened.push(u);
    ctx.ui.set({ desktop: { portable: true, dataDir: 'd', modelsDir: 'm', logsDir: 'l', browser: null, version: '0.1.0', os: 'windows', arch: 'x86_64' } });
    downloadUpdate(ctx, RELEASE_020);
    openReleaseNotes(ctx, RELEASE_020);
    // A feed that names something else than https:// opens nothing.
    openReleaseNotes(ctx, { ...RELEASE_020, pageUrl: 'javascript:alert(1)' });
    downloadUpdate(ctx, { ...RELEASE_020, assets: [], pageUrl: 'http://example.org/' });
    await Promise.resolve();
    expect(opened).toEqual([RELEASE_020.assets[1].url, RELEASE_020.pageUrl]);
  });
});

// ------------------------------------------------------------------ the request

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;
const answer = (body: unknown, init: ResponseInit = {}) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' }, ...init });
const fetchOf = (make: () => Response | Promise<Response>) => vi.fn<FetchFn>(async () => make());

describe('the request', () => {
  it('asks GitHub’s releases/latest of the repository in the data constant, with the GitHub Accept header', async () => {
    const fetch = fetchOf(() => answer(GITHUB_LATEST));
    const out = await fetchLatestRelease({ fetch });
    expect(out).toEqual({ ok: true, release: RELEASE_020 });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('https://api.github.com/repos/Grohle-developer/Repackshot/releases/latest');
    expect(url).toBe(latestReleaseUrl(UPDATE_FEED));
    expect(UPDATE_FEED).toEqual({ owner: 'Grohle-developer', repo: 'Repackshot' });
    expect(new Headers(init?.headers).get('accept')).toBe('application/vnd.github+json');
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    // Nothing about the person leaves with it.
    expect(init?.credentials).toBe('omit');
    expect(init?.referrerPolicy).toBe('no-referrer');
  });

  it('the repository is switched by the constant alone', async () => {
    const fetch = fetchOf(() => answer(GITHUB_LATEST));
    await fetchLatestRelease({ fetch, feed: { owner: 'someone', repo: 'else' } });
    expect(fetch.mock.calls[0][0]).toBe('https://api.github.com/repos/someone/else/releases/latest');
    expect(latestReleaseUrl({ owner: 'a/b', repo: 'c d' })).toBe('https://api.github.com/repos/a%2Fb/c%20d/releases/latest');
  });
});

describe('the request: every failure says its reason', () => {
  const fault = async (make: () => Response | Promise<Response>, timeoutMs?: number) => {
    const out = await fetchLatestRelease({ fetch: fetchOf(make), timeoutMs });
    expect(out.ok).toBe(false);
    return out.ok ? null : out.fault;
  };

  it('404: no published release (a private repository answers the same)', async () => {
    expect(await fault(() => answer({ message: 'Not Found' }, { status: 404 }))).toEqual({ code: 'NOT_FOUND' });
  });

  it('403 with the rate limit used up, 403 with retry-after and 429: the limit was reached', async () => {
    expect(await fault(() => answer({ message: 'API rate limit exceeded' }, { status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1760000000' } }))).toEqual({ code: 'RATE_LIMITED' });
    expect(await fault(() => answer({ message: 'secondary rate limit' }, { status: 403, headers: { 'retry-after': '60' } }))).toEqual({ code: 'RATE_LIMITED' });
    expect(await fault(() => answer({}, { status: 429 }))).toEqual({ code: 'RATE_LIMITED' });
  });

  it('a 403 that is not the rate limit, and other errors, are reported with their status', async () => {
    expect(await fault(() => answer({}, { status: 403, headers: { 'x-ratelimit-remaining': '57' } }))).toEqual({ code: 'HTTP', status: 403 });
    expect(await fault(() => answer({}, { status: 500 }))).toEqual({ code: 'HTTP', status: 500 });
    expect(await fault(() => answer({}, { status: 503 }))).toEqual({ code: 'HTTP', status: 503 });
    expect(faultFromStatus(403, () => null)).toEqual({ code: 'HTTP', status: 403 });
  });

  it('a network that is not there: no connection', async () => {
    expect(await fault(() => Promise.reject(new TypeError('Failed to fetch')))).toEqual({ code: 'OFFLINE' });
  });

  it('an answer that is not JSON, or not a release: the feed could not be read', async () => {
    expect(await fault(() => answer('<html>Service unavailable</html>'))).toEqual({ code: 'BAD_FEED' });
    expect(await fault(() => answer(''))).toEqual({ code: 'BAD_FEED' });
    expect(await fault(() => answer({ message: 'hello' }))).toEqual({ code: 'BAD_FEED' });
    expect(await fault(() => answer([]))).toEqual({ code: 'BAD_FEED' });
    expect(await fault(() => answer({ ...GITHUB_LATEST, tag_name: 'latest' }))).toEqual({ code: 'BAD_FEED' });
  });

  it('no answer in time: a timeout, whether the fetch obeys the abort signal or not', async () => {
    const obeys = vi.fn<FetchFn>(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }),
    );
    const t0 = Date.now();
    const out = await fetchLatestRelease({ fetch: obeys, timeoutMs: 30 });
    expect(out).toEqual({ ok: false, fault: { code: 'TIMEOUT' } });
    expect(Date.now() - t0).toBeLessThan(2000);
    expect((obeys.mock.calls[0][1]?.signal as AbortSignal).aborted).toBe(true);
    // A fetch that never looks at the signal cannot hold the check either.
    expect(await fault(() => new Promise<Response>(() => undefined), 30)).toEqual({ code: 'TIMEOUT' });
    // The body counts: headers arrive, the rest never does.
    const slowBody = new Response(new ReadableStream({ start: () => undefined }), { status: 200 });
    expect(await fault(() => slowBody, 30)).toEqual({ code: 'TIMEOUT' });
  });

  it('the time limit is ten seconds', () => {
    expect(UPDATE_TIMEOUT_MS).toBe(10_000);
  });
});

// ------------------------------------------------------------------ the check, as the interface runs it

function makeCtx(latest: () => Promise<UpdateOutcome>, layout = defaultLayout()): Ctx & { calls: () => number } {
  let calls = 0;
  const services = {
    updates: {
      latest: () => {
        calls++;
        return latest();
      },
    },
  } as unknown as AppServices;
  return { store: createStore(createInitialState()), ui: createUiStore({}, { layout }), services, calls: () => calls };
}

const NEWER = releaseOf('9.9.9');
const SAME = releaseOf(VERSION);
const found = (release: ReleaseInfo) => async (): Promise<UpdateOutcome> => ({ ok: true, release });

describe('the check at startup', () => {
  it('runs once, in the background, with Check at startup on (it is on from the factory)', async () => {
    expect(defaultSettings()['updates.atStartup']).toBe(true);
    const ctx = makeCtx(found(SAME));
    const pending = startupUpdateCheck(ctx);
    // Started, not waited for: the interface is not held by it.
    expect(ctx.ui.get().updates.checking).toBe(true);
    await pending;
    expect(ctx.calls()).toBe(1);
    await startupUpdateCheck(ctx);
    await startupUpdateCheck(ctx);
    expect(ctx.calls()).toBe(1);
    expect(ctx.ui.get().updates).toMatchObject({ checking: false, startupDone: true, fault: null });
  });

  it('does not run with the setting off, not even when it is switched on later in the same session', async () => {
    const ctx = makeCtx(found(NEWER));
    ctx.ui.set({ settings: withSetting(ctx.ui.get().settings, 'updates.atStartup', false) });
    await startupUpdateCheck(ctx);
    expect(ctx.calls()).toBe(0);
    expect(ctx.ui.get().updates.notice).toBeNull();
    ctx.ui.set({ settings: withSetting(ctx.ui.get().settings, 'updates.atStartup', true) });
    await startupUpdateCheck(ctx);
    expect(ctx.calls()).toBe(0);
  });

  it('a newer version becomes a quiet notice: no window, no toast', async () => {
    const ctx = makeCtx(found(NEWER));
    await startupUpdateCheck(ctx);
    expect(ctx.ui.get().updates.notice).toEqual(NEWER);
    expect(ctx.ui.get().settingsWindow).toBeNull();
    expect(ctx.ui.get().renderWindow).toBeNull();
    expect(ctx.ui.get().toasts).toEqual([]);
    expect(ctx.ui.get().prompt).toBeNull();
  });

  it('the same version, or an older one, announces nothing but is remembered', async () => {
    for (const release of [SAME, releaseOf('0.0.1')]) {
      const ctx = makeCtx(found(release));
      await startupUpdateCheck(ctx);
      expect(ctx.ui.get().updates.notice).toBeNull();
      expect(ctx.ui.get().updates.announced).toEqual([]);
      expect(ctx.ui.get().updateLatest).toEqual(release);
      expect(ctx.ui.get().updateCheckedAt).toBeGreaterThan(0);
    }
  });

  it('Later hides the notice, and the version is not announced again in the same session', async () => {
    const ctx = makeCtx(found(NEWER));
    await startupUpdateCheck(ctx);
    expect(ctx.ui.get().updates.notice?.version).toBe('9.9.9');
    dismissUpdateNotice(ctx);
    expect(ctx.ui.get().updates.notice).toBeNull();
    // Asked again (a second check at startup does not exist, but the rule must not depend on that).
    await checkForUpdates(ctx, 'startup');
    expect(ctx.calls()).toBe(2);
    expect(ctx.ui.get().updates.notice).toBeNull();
    expect(ctx.ui.get().updates.announced).toEqual(['9.9.9']);
    // A later version than the dismissed one is news.
    const ctx2 = makeCtx(found(NEWER));
    await startupUpdateCheck(ctx2);
    dismissUpdateNotice(ctx2);
    (ctx2.services.updates as { latest: () => Promise<UpdateOutcome> }).latest = found(releaseOf('9.9.10'));
    await checkForUpdates(ctx2, 'startup');
    expect(ctx2.ui.get().updates.notice?.version).toBe('9.9.10');
  });

  it('a check the person asks for shows its result in the section and announces nothing', async () => {
    const ctx = makeCtx(found(NEWER));
    await checkForUpdates(ctx, 'manual');
    expect(ctx.ui.get().updates.notice).toBeNull();
    expect(ctx.ui.get().updates.startupDone).toBe(false);
    expect(updateSummary(ctx)).toMatchObject({ state: 'AVAILABLE', available: NEWER });
  });

  it('a failure is silent at startup: the reason waits in the section, and the last answer is kept', async () => {
    const earlier = { ...defaultLayout(), updateCheckedAt: 1_700_000_000_000, updateLatest: NEWER };
    const ctx = makeCtx(async () => ({ ok: false, fault: { code: 'OFFLINE' } }), earlier);
    await startupUpdateCheck(ctx);
    expect(ctx.ui.get().updates).toMatchObject({ checking: false, fault: { code: 'OFFLINE' }, notice: null });
    expect(ctx.ui.get().toasts).toEqual([]);
    expect(ctx.ui.get().updateCheckedAt).toBe(1_700_000_000_000);
    expect(ctx.ui.get().updateLatest).toEqual(NEWER);
    expect(updateSummary(ctx)).toMatchObject({ state: 'FAILED', fault: { code: 'OFFLINE' }, available: NEWER });
  });

  it('a port that throws is no connection, not a crash', async () => {
    const ctx = makeCtx(() => Promise.reject(new Error('boom')));
    await checkForUpdates(ctx, 'manual');
    expect(ctx.ui.get().updates).toMatchObject({ checking: false, fault: { code: 'OFFLINE' } });
  });

  it('a second request while one is running is ignored; a success clears an earlier failure', async () => {
    let release!: (o: UpdateOutcome) => void;
    const ctx = makeCtx(() => new Promise<UpdateOutcome>((r) => (release = r)));
    ctx.ui.set({ updates: { ...ctx.ui.get().updates, fault: { code: 'NOT_FOUND' } } });
    const first = checkForUpdates(ctx, 'manual');
    await checkForUpdates(ctx, 'manual');
    expect(ctx.calls()).toBe(1);
    expect(ctx.ui.get().updates).toMatchObject({ checking: true, fault: null });
    release({ ok: true, release: SAME });
    await first;
    expect(ctx.ui.get().updates).toMatchObject({ checking: false, fault: null });
  });
});

describe('what is remembered between sessions', () => {
  it('the last answer goes to the settings layout, and comes back', async () => {
    const saved: object[] = [];
    const ui = createUiStore({}, { layout: defaultLayout(), onLayout: (p) => saved.push(p) });
    const ctx: Ctx = { store: createStore(createInitialState()), ui, services: { updates: { latest: found(NEWER) } } as unknown as AppServices };
    await checkForUpdates(ctx, 'manual');
    expect(saved).toEqual([{ updateCheckedAt: expect.any(Number), updateLatest: NEWER }]);
    const doc = migrateDoc(JSON.parse(JSON.stringify({ schema: 1, settings: {}, layout: { ...defaultLayout(), ...saved[0] } })));
    expect(doc.layout.updateLatest).toEqual(NEWER);
    expect(doc.layout.updateCheckedAt).toBe((saved[0] as { updateCheckedAt: number }).updateCheckedAt);
    // The next start has it, without any request.
    const next = makeCtx(found(SAME), doc.layout);
    expect(next.ui.get().updateLatest).toEqual(NEWER);
    expect(updateSummary(next)).toMatchObject({ state: 'AVAILABLE', available: NEWER });
  });

  it('a damaged or hostile stored answer is dropped, never opened', () => {
    const read = (updateLatest: unknown, updateCheckedAt: unknown = 1) => migrateDoc({ schema: 1, settings: {}, layout: { updateLatest, updateCheckedAt } }).layout;
    expect(read(NEWER).updateLatest).toEqual(NEWER);
    expect(read({ ...NEWER, pageUrl: 'javascript:alert(1)' }).updateLatest).toBeNull();
    expect(read({ ...NEWER, pageUrl: 'http://example.com/' }).updateLatest).toBeNull();
    expect(read({ ...NEWER, version: 'soon' }).updateLatest).toBeNull();
    expect(read('9.9.9').updateLatest).toBeNull();
    expect(read({ ...NEWER, assets: [{ name: 'x', url: 'file:///etc/passwd', size: 1 }, { name: 'y', url: 'https://example.com/y', size: 2 }] }).updateLatest?.assets).toEqual([{ name: 'y', url: 'https://example.com/y', size: 2 }]);
    expect(read(null, -5).updateCheckedAt).toBeNull();
    expect(read(null, 'yesterday').updateCheckedAt).toBeNull();
    expect(read(null, Number.NaN).updateCheckedAt).toBeNull();
    expect(read(null, 1_700_000_000_000.4).updateCheckedAt).toBe(1_700_000_000_000);
    expect(validRelease(undefined)).toBeNull();
    expect(migrateDoc({ schema: 1, settings: {}, layout: {} }).layout).toEqual(defaultLayout());
  });
});

describe('what the section says', () => {
  const sum = (o: Partial<Parameters<typeof summarizeUpdates>[0]>) => summarizeUpdates({ current: '0.1.0', checking: false, fault: null, latest: null, ...o });

  it('never checked, checking, the latest, a newer one, a failure', () => {
    expect(sum({}).state).toBe('NEVER');
    expect(sum({ checking: true }).state).toBe('CHECKING');
    expect(sum({ latest: releaseOf('0.1.0') })).toMatchObject({ state: 'LATEST', available: null });
    expect(sum({ latest: releaseOf('0.0.9') }).state).toBe('LATEST');
    expect(sum({ latest: releaseOf('0.2.0') })).toMatchObject({ state: 'AVAILABLE', available: { version: '0.2.0' } });
    expect(sum({ fault: { code: 'NOT_FOUND' } })).toMatchObject({ state: 'FAILED', fault: { code: 'NOT_FOUND' }, available: null });
    // The last known newer version stays visible under a failure, and while checking.
    expect(sum({ fault: { code: 'OFFLINE' }, latest: releaseOf('0.2.0') })).toMatchObject({ state: 'FAILED', available: { version: '0.2.0' } });
    expect(sum({ checking: true, latest: releaseOf('0.2.0') })).toMatchObject({ state: 'CHECKING', available: { version: '0.2.0' } });
  });

  it('says it in both languages, with the honest reason', () => {
    const say = (key: StringKey, lang: Lang, params: Record<string, string> = {}) => STRINGS[lang][key].replace(/\{(\w+)\}/g, (_m, k: string) => params[k]);
    expect(say('up.latest', 'en', { version: '0.1.0' })).toBe('You have the latest version (0.1.0)');
    expect(say('up.latest', 'es', { version: '0.1.0' })).toBe('Tienes la última versión (0.1.0)');
    expect(say('up.checking', 'en')).toBe('Checking…');
    expect(STRINGS.en['up.err.notFound']).toBe('No published releases found (the repository may be private or have no releases yet)');
    expect(STRINGS.en['up.err.rateLimit']).toContain('request limit');
    expect(STRINGS.en['up.err.offline']).toBe('No connection');
    expect(STRINGS.en['up.err.badFeed']).toBe('The release feed could not be read');
    expect(STRINGS.es['up.err.notFound']).toContain('repositorio');
    expect(STRINGS.es['up.err.offline']).toBe('Sin conexión');
    expect(faultText({ code: 'NOT_FOUND' })).toBe(STRINGS.en['up.err.notFound']);
    expect(faultText({ code: 'RATE_LIMITED' })).toBe(STRINGS.en['up.err.rateLimit']);
    expect(faultText({ code: 'OFFLINE' })).toBe(STRINGS.en['up.err.offline']);
    expect(faultText({ code: 'TIMEOUT' })).toBe(STRINGS.en['up.err.timeout']);
    expect(faultText({ code: 'BAD_FEED' })).toBe(STRINGS.en['up.err.badFeed']);
    expect(faultText({ code: 'HTTP', status: 502 })).toBe('GitHub answered with an error (502)');
    expect(availableText(RELEASE_020)).toBe(`Repackshot 0.2.0 is available, published ${formatDate('2026-10-14T09:30:00Z', 'en')}`);
    expect(formatDate('2026-10-14T12:00:00Z', 'en')).toBe('14 Oct 2026');
    expect(formatDate('2026-10-14T12:00:00Z', 'es')).toMatch(/^14 oct\.? 2026$/);
    expect(availableText({ ...RELEASE_020, publishedAt: null })).toBe('Repackshot 0.2.0 is available');
    expect(formatDateTime(Date.UTC(2026, 9, 14, 12, 0), 'en')).toContain('2026');
    expect(formatDateTime(Number.NaN, 'en')).toBe('–');
  });
});

// ------------------------------------------------------------------ where it sits in the window

describe('Settings ▸ Updates', () => {
  const label = (row: RowMeta, lang: Lang) => STRINGS[lang][`set.${row.id}` as StringKey] ?? '';
  const find = (q: string, lang: Lang, desktop = false) => searchSettings(q, { lang, label, desktop }).map((h) => h.row.id);

  it('is the section right above About, in the System group, for the browser and the desktop alike', () => {
    const ids = SECTIONS.map((s) => s.id);
    expect(ids.at(-1)).toBe('about');
    expect(ids.at(-2)).toBe('updates');
    expect(ids.indexOf('updates')).toBe(ids.indexOf('about') - 1);
    expect(ids.indexOf('desktop')).toBe(ids.indexOf('updates') - 1);
    expect(ids.indexOf('storage')).toBeLessThan(ids.indexOf('desktop'));
    const spec = SECTIONS.find((s) => s.id === 'updates')!;
    expect(spec.group).toBe('system');
    expect(spec.desktopOnly).toBeUndefined();
  });

  it('has the installed version, the check, the toggle (on) and the last check, in that order', () => {
    expect(rowsOf('updates').map((r) => r.id)).toEqual(['updates.current', 'updates.check', 'updates.atStartup', 'updates.last']);
    const toggle = SETTING_ROWS.find((r) => r.id === 'updates.atStartup');
    expect(toggle).toMatchObject({ kind: 'setting', control: { kind: 'toggle' } });
    for (const id of ['updates.current', 'updates.check', 'updates.last']) expect(CUSTOM_ROW_IDS, id).toContain(id);
    for (const key of ['set.sec.updates', 'set.updates.current', 'set.updates.check', 'set.updates.atStartup', 'set.updates.last'] as const) {
      expect(STRINGS.en[key], key).toBeTruthy();
      expect(STRINGS.es[key], key).toBeTruthy();
    }
    expect(STRINGS.en['set.updates.check']).toBe('Check for updates');
    expect(STRINGS.es['set.updates.check']).toBe('Buscar actualizaciones');
    expect(STRINGS.en['set.updates.atStartup']).toBe('Check at startup');
  });

  it('is found by "updates" and by "actualizaciones", in either interface language, in the browser and on the desktop', () => {
    for (const desktop of [false, true]) {
      expect(find('updates', 'en', desktop)[0]).toBe('updates.check');
      expect(find('updates', 'en', desktop)).toEqual(expect.arrayContaining(['updates.check', 'updates.atStartup', 'updates.last']));
      expect(find('actualizaciones', 'es', desktop)[0]).toBe('updates.check');
      expect(find('actualizaciones', 'en', desktop)).toContain('updates.check');
      expect(find('updates', 'es', desktop)).toContain('updates.check');
      expect(find('actualizar', 'es', desktop)).toContain('updates.check');
      expect(find('nueva versión', 'en', desktop)).toContain('updates.check');
      expect(find('new version', 'es', desktop)).toContain('updates.check');
      expect(find('arranque', 'es', desktop)).toContain('updates.atStartup');
    }
  });

  it('the old coming-soon row of the Desktop section is gone, with its string', () => {
    expect(SETTING_ROWS.some((r) => r.id === 'desktop.updates')).toBe(false);
    expect(rowsOf('desktop').map((r) => r.id)).toEqual(['desktop.portable', 'desktop.browser', 'desktop.logs']);
    expect(rowsOf('desktop').some((r) => r.kind === 'extra' && r.comingSoon)).toBe(false);
    expect('set.desktop.updates' in STRINGS.en).toBe(false);
    expect('set.desktop.updates' in STRINGS.es).toBe(false);
    expect(find('updates', 'en', true)).not.toContain('desktop.updates');
    // Nothing in the section is marked coming soon: everything in it works.
    expect(rowsOf('updates').some((r) => r.comingSoon)).toBe(false);
  });
});
