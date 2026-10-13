// Updates, as the interface runs them (Settings ▸ Updates and the quiet notice in the status bar):
// asking the release feed through `services.updates`, keeping the answer, announcing a newer version
// once, and opening the download or the release notes. The pure parts (versions, which package is for
// this computer, the faults) are in core/updates.ts. Nothing here opens a window by itself (UI.md §4.3):
// a newer version found at startup is a line in the status bar the person can dismiss with Later.

import { httpsUrl, isNewer, pickAsset, summarizeUpdates, type ReleaseAsset, type ReleaseInfo, type UpdateFault, type UpdateOutcome, type UpdateSummary, type UpdateTarget } from '../core/updates';
import { VERSION } from '../core/version';
import type { Ctx } from './reactive';
import { formatDate, getLang, t } from './strings';

/** Where this runs, for choosing the package: the browser, or the desktop application (installed or portable). */
export function updateTarget(ctx: Ctx): UpdateTarget {
  const d = ctx.ui.get().desktop;
  return d ? { desktop: true, os: d.os, arch: d.arch, portable: d.portable } : { desktop: false };
}

/** What the section says now: checking, failed, a newer version, the latest, or never checked. */
export function updateSummary(ctx: Ctx): UpdateSummary {
  const u = ctx.ui.get();
  return summarizeUpdates({ current: VERSION, checking: u.updates.checking, fault: u.updates.fault, latest: u.updateLatest });
}

/** What Download opens: the package for this computer when the release has it, else the release page. */
export function downloadChoice(ctx: Ctx, release: ReleaseInfo): { url: string; asset: ReleaseAsset | null } {
  const asset = pickAsset(release, updateTarget(ctx));
  return { asset, url: asset?.url ?? release.pageUrl };
}

/** An external link (https only), through `services.openExternal`: the system's browser on the desktop, a new tab on the web. */
export function openLink(ctx: Ctx, url: string): void {
  const safe = httpsUrl(url);
  if (safe) void ctx.services.openExternal(safe).catch((err: unknown) => console.warn(`open ${safe}: ${err instanceof Error ? err.message : String(err)}`));
}

export const downloadUpdate = (ctx: Ctx, release: ReleaseInfo): void => openLink(ctx, downloadChoice(ctx, release).url);
export const openReleaseNotes = (ctx: Ctx, release: ReleaseInfo): void => openLink(ctx, release.pageUrl);

/** Shows the notice for a newer version, unless this session has announced it already. */
function announce(ctx: Ctx, release: ReleaseInfo): void {
  const u = ctx.ui.get().updates;
  if (u.announced.includes(release.version)) return;
  ctx.ui.set({ updates: { ...u, notice: release, announced: [...u.announced, release.version] } });
}

/** Later: the notice goes until the next start, and this version is not announced again in this session. */
export function dismissUpdateNotice(ctx: Ctx): void {
  const u = ctx.ui.get().updates;
  if (u.notice) ctx.ui.set({ updates: { ...u, notice: null } });
}

/**
 * Asks the feed. The answer is kept (when it was, and the latest release it named) so a start without a
 * connection can still show it; a failure keeps the last answer and says why for the rest of the session. `startup`
 * announces a newer version; a check the person asked for shows its result in the section, with no notice.
 */
export async function checkForUpdates(ctx: Ctx, why: 'manual' | 'startup'): Promise<void> {
  if (ctx.ui.get().updates.checking) return;
  ctx.ui.set({ updates: { ...ctx.ui.get().updates, checking: true, fault: null } });
  const out = await ctx.services.updates.latest().catch((): UpdateOutcome => ({ ok: false, fault: { code: 'OFFLINE' } }));
  const u = ctx.ui.get().updates;
  if (!out.ok) {
    ctx.ui.set({ updates: { ...u, checking: false, fault: out.fault } });
    return;
  }
  ctx.ui.set({ updateCheckedAt: Date.now(), updateLatest: out.release, updates: { ...u, checking: false, fault: null } });
  if (why === 'startup' && isNewer(out.release.version, VERSION)) announce(ctx, out.release);
}

/**
 * The check when the application starts: once, in the background, only with Updates ▸ Check at startup on.
 * main.ts calls it when the interface has painted; it never waits for anything the interface needs.
 */
export async function startupUpdateCheck(ctx: Ctx): Promise<void> {
  const u = ctx.ui.get();
  if (u.updates.startupDone) return;
  ctx.ui.set({ updates: { ...u.updates, startupDone: true } });
  if (!u.settings['updates.atStartup']) return;
  await checkForUpdates(ctx, 'startup');
}

// ------------------------------------------------------------------ words

/** Why a check failed, in the interface language and without softening it. */
export function faultText(fault: UpdateFault): string {
  switch (fault.code) {
    case 'NOT_FOUND':
      return t('up.err.notFound');
    case 'RATE_LIMITED':
      return t('up.err.rateLimit');
    case 'OFFLINE':
      return t('up.err.offline');
    case 'TIMEOUT':
      return t('up.err.timeout');
    case 'BAD_FEED':
      return t('up.err.badFeed');
    case 'HTTP':
      return t('up.err.http', { status: String(fault.status ?? '') });
  }
}

/** "Repackshot 0.2.0 is available, published 14 Oct 2026" (without the date when the feed gave none). */
export function availableText(release: ReleaseInfo): string {
  return release.publishedAt ? t('up.availableOn', { version: release.version, date: formatDate(release.publishedAt, getLang()) }) : t('up.available', { version: release.version });
}
