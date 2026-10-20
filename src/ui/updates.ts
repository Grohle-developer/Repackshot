// Updates, as the interface runs them (Settings ▸ Updates, the notice in the status bar and the window
// at startup): asking the release feed through `services.updates`, keeping the answer, announcing a
// newer version once, and opening the download or the release notes. The pure parts (versions, which
// package is for this computer, the faults) are in core/updates.ts. A newer version found at startup is
// announced two ways: a window that asks whether to update now (the owner asked for it, 2026-10-20 — it
// is the one window the update check opens, UI.md §4.3), and a line in the status bar that stays until
// dismissed with Later, so the offer is still there after the window is answered.
//
// On the desktop (phase P5) the main action is Install and restart: the question about unsaved changes (the
// same as closing, with Save as…), then the launcher downloads the package, checks its sum and installs it
// (`services.updates.installer`, src/io/update-install.ts), the page follows it every few hundred milliseconds
// (the state lives in the launcher, so closing Settings does not stop it and a reload picks it up again), and
// when the files are in place the window closes, asking again if the project changed meanwhile; the launcher
// then starts the new version. Where the application cannot do that (the web, a release without the package or
// its checksums) the main action is still Download.

import {
  formatProgress,
  httpsUrl,
  installActive,
  installErrorCode,
  installPercent,
  installRequest,
  isNewer,
  NO_INSTALL,
  pickAsset,
  summarizeUpdates,
  type InstallErrorCode,
  type InstallRequest,
  type InstallStatus,
  type ReleaseAsset,
  type ReleaseInfo,
  type UpdateFault,
  type UpdateOutcome,
  type UpdateSummary,
  type UpdateTarget,
} from '../core/updates';
import { VERSION } from '../core/version';
import { afterUnsavedCheck, closeForUpdate, unsavedQuestion } from './commands';
import type { ConfirmSpec } from './components/widgets';
import type { Ctx } from './reactive';
import { formatDate, getLang, t } from './strings';
import type { InstallUi } from './ui-state';

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

/** Announces a newer version (notice and startup window), unless this session has announced it already, or the person skipped this version. */
function announce(ctx: Ctx, release: ReleaseInfo): void {
  const ui = ctx.ui.get();
  const u = ui.updates;
  if (u.announced.includes(release.version)) return;
  if (ui.updateSkipped === release.version) return;
  ctx.ui.set({ updates: { ...u, notice: release, prompt: release, announced: [...u.announced, release.version] } });
}

/** Skip this version (the window's Skip): the version is remembered as skipped, the window and the notice go, and this version is not announced again — a newer one is. Settings still offers it: skipping silences the announcement, not the update. */
export function skipUpdate(ctx: Ctx): void {
  const ui = ctx.ui.get();
  const release = ui.updates.prompt ?? ui.updates.notice;
  if (!release) return;
  const u = ui.updates;
  ctx.ui.set({ updateSkipped: release.version, updates: { ...u, notice: null, prompt: null, announced: u.announced.includes(release.version) ? u.announced : [...u.announced, release.version] } });
}

/** The startup window is answered: it closes. The notice stays in the status bar, and the version is not announced again in this session. */
export function dismissUpdatePrompt(ctx: Ctx): void {
  const u = ctx.ui.get().updates;
  if (u.prompt) ctx.ui.set({ updates: { ...u, prompt: null } });
}

/** Later: the notice goes until the next start, and this version is not announced again in this session. */
export function dismissUpdateNotice(ctx: Ctx): void {
  const u = ctx.ui.get().updates;
  if (u.notice || u.prompt) ctx.ui.set({ updates: { ...u, notice: null, prompt: null } });
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

// ------------------------------------------------------------------ installing from inside the application (P5)

/** How often the page asks the launcher where the update is, while it is under way. */
export const INSTALL_POLL_MS = 400;
/** Answers in a row the launcher may fail to give while it downloads before the update is called lost. */
const LOST_AFTER = 10;

/** What Install and restart sends for this release; null where the application cannot install it (then Download). */
export function installRequestFor(ctx: Ctx, release: ReleaseInfo): InstallRequest | null {
  if (!ctx.services.updates.installer || !ctx.ui.get().desktop) return null;
  return installRequest(release, updateTarget(ctx));
}

/** An update is being downloaded, checked or installed. */
export const installing = (ctx: Ctx): boolean => installActive(ctx.ui.get().updates.install.status);

function setInstall(ctx: Ctx, patch: Partial<InstallUi>): void {
  const u = ctx.ui.get().updates;
  ctx.ui.set({ updates: { ...u, install: { ...u.install, ...patch } } });
}

/** A failure the page found itself (the launcher refused the request, or could not be reached). */
function failed(ctx: Ctx, error: InstallErrorCode, message: string | null, tag: string | null): void {
  setInstall(ctx, { status: { ...NO_INSTALL, state: 'FAILED', tag, error, message } });
}

let poller: ReturnType<typeof setTimeout> | null = null;
let lost = 0;

function stopPolling(): void {
  if (poller !== null) clearTimeout(poller);
  poller = null;
}

/** Follows the launcher until the update is ready, failed or cancelled. One follower at a time. */
function follow(ctx: Ctx): void {
  stopPolling();
  const installer = ctx.services.updates.installer;
  if (!installer) return;
  const tick = async (): Promise<void> => {
    poller = null;
    let status: InstallStatus;
    try {
      status = await installer.status();
      lost = 0;
    } catch (err) {
      if (++lost >= LOST_AFTER) return failed(ctx, 'lost', err instanceof Error ? err.message : String(err), ctx.ui.get().updates.install.status.tag);
      poller = setTimeout(() => void tick(), INSTALL_POLL_MS);
      return;
    }
    setInstall(ctx, { status });
    if (status.state === 'INSTALLING' && status.ready) return restartNow(ctx);
    if (installActive(status)) poller = setTimeout(() => void tick(), INSTALL_POLL_MS);
  };
  poller = setTimeout(() => void tick(), INSTALL_POLL_MS);
}

/**
 * The update is in place: the window closes so that the launcher can start the new version, after the question about
 * unsaved changes if the project has some now. If the person answers Cancel (or a save does not happen) the new
 * version waits: Restart now asks again, and closing the window by hand does the same.
 */
export function restartNow(ctx: Ctx): void {
  const stay = () => setInstall(ctx, { deferred: true });
  setInstall(ctx, { deferred: false });
  if (!closeForUpdate(ctx, stay, ctx.ui.get().updates.install.answeredAt)) stay();
}

/** Starts the install: the launcher is told, and followed. `request` stays for Try again. */
async function startInstall(ctx: Ctx, request: InstallRequest): Promise<void> {
  const installer = ctx.services.updates.installer;
  if (!installer) return;
  stopPolling();
  lost = 0;
  setInstall(ctx, { request, deferred: false, status: { ...NO_INSTALL, state: 'DOWNLOADING', tag: request.tag, total: request.size ?? 0 } });
  try {
    setInstall(ctx, { status: await installer.install(request) });
  } catch (err) {
    const code = err && typeof err === 'object' && 'code' in err ? (err as { code: unknown }).code : null;
    failed(ctx, installErrorCode(code), err instanceof Error ? err.message : String(err), request.tag);
    return;
  }
  follow(ctx);
}

/**
 * Install and restart (the main action of an available version on the desktop): the question about unsaved changes,
 * then the launcher installs. Where the application cannot install, this is Download. Nothing happens while an
 * update is under way.
 */
export function installUpdate(ctx: Ctx, release: ReleaseInfo, show?: ShowQuestion): void {
  const request = installRequestFor(ctx, release);
  if (!request) return downloadUpdate(ctx, release);
  if (installing(ctx)) return;
  askThenInstall(ctx, request, show);
}

/**
 * Try again after a failure: the same request (or, in a page that was reloaded since, the one for this release),
 * after the same question.
 */
export function retryInstall(ctx: Ctx, release: ReleaseInfo, show?: ShowQuestion): void {
  const { request, status } = ctx.ui.get().updates.install;
  const again = request ?? installRequestFor(ctx, release);
  if (!again || installActive(status)) return;
  askThenInstall(ctx, again, show);
}

/** Where the question about unsaved changes shows: in the place of the button that was pressed (UI.md §4.3), else under the project name. */
export type ShowQuestion = (spec: ConfirmSpec) => void;

/** "Save changes to “X” before updating?" (only if there are some): Save · Save as… · Quit without saving, Esc cancels. */
function askThenInstall(ctx: Ctx, request: InstallRequest, show?: ShowQuestion): void {
  const name = ctx.store.get().meta.name || t('app.untitled');
  const go = () => {
    // The person has answered for the project as it is now: it is not asked again unless it changes.
    setInstall(ctx, { answeredAt: ctx.store.revision() });
    void startInstall(ctx, request);
  };
  const message = t('project.unsavedUpdate', { name });
  const opts = { leaveLabel: t('project.quitWithout') };
  if (!show) return afterUnsavedCheck(ctx, message, go, opts);
  const q = unsavedQuestion(ctx, message, go, opts);
  if (q) show(q.spec);
}

/** Stops the download or the check, and clears a failure (the launcher keeps nothing of either). */
export async function cancelInstall(ctx: Ctx): Promise<void> {
  const installer = ctx.services.updates.installer;
  stopPolling();
  try {
    setInstall(ctx, { status: installer ? await installer.cancel() : NO_INSTALL, deferred: false });
  } catch {
    // Too late to cancel (the files are being installed): the row goes on with what the launcher says.
    if (installer) follow(ctx);
  }
}

/** At start: an update the launcher is already running (the page was reloaded) is followed again. */
export async function syncInstall(ctx: Ctx): Promise<void> {
  const installer = ctx.services.updates.installer;
  if (!installer) return;
  try {
    const status = await installer.status();
    if (status.state === 'IDLE') return;
    setInstall(ctx, { status });
    if (installActive(status)) follow(ctx);
  } catch {
    // The launcher does not answer: nothing to follow.
  }
}

// ------------------------------------------------------------------ the words of the install

/** The row while an update is under way: "Downloading… 45 % · 3,2 of 7,1 MB", "Verifying…", "Installing…". */
export function installText(status: InstallStatus): string {
  switch (status.state) {
    case 'DOWNLOADING': {
      const percent = installPercent(status);
      const amount = formatProgress(status.received, status.total, getLang(), t('up.of'));
      return percent === null ? t('up.downloadingOf', { amount }) : t('up.downloadingPercent', { percent: String(percent), amount });
    }
    case 'VERIFYING':
      return t('up.verifying');
    case 'INSTALLING':
      return t('up.installing');
    default:
      return '';
  }
}

/** Why an update failed, in the interface language. */
export function installFaultText(code: InstallErrorCode | null): string {
  switch (code) {
    case 'download':
      return t('up.fail.download');
    case 'disk-full':
      return t('up.fail.disk');
    case 'sums':
      return t('up.fail.sums');
    case 'checksum':
      return t('up.fail.checksum');
    case 'extract':
      return t('up.fail.extract');
    case 'install':
      return t('up.fail.install');
    case 'not-updatable':
      return t('up.fail.notUpdatable');
    case 'busy':
      return t('up.fail.busy');
    case 'lost':
      return t('up.fail.lost');
    default:
      return t('up.fail.other');
  }
}
