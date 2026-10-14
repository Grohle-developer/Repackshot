// Settings ▸ Updates (UI.md §2.9): the installed version, Check for updates with its result on the
// row (Checking… · the latest version · a newer one with Install and restart (the desktop) or Download (the
// web) and Release notes · why the check failed), Check at startup (a generated toggle row) and when the feed
// last answered. The result is what core/updates.ts summarises from the state the commands of ui/updates.ts
// keep; nothing is assumed. While an update installs, the row shows where it is (Downloading… 45 % · 3,2 of
// 7,1 MB, Verifying…, Installing…), and a failure with its reason and Try again (phase P5).

import { formatBytes } from '../../core/models';
import { installActive, installPercent } from '../../core/updates';
import { VERSION } from '../../core/version';
import { h } from '../dom';
import { showConfirmIn } from '../components/widgets';
import { shallowEq, type Ctx, type Scope } from '../reactive';
import { formatDateTime, getLang, t } from '../strings';
import { availableText, cancelInstall, checkForUpdates, downloadChoice, downloadUpdate, faultText, installFaultText, installRequestFor, installText, installUpdate, openReleaseNotes, restartNow, retryInstall, updateSummary } from '../updates';
import { infoRow, rowLabel, rowShell } from './settings-rows';
import type { SettingsHooks } from './settings-sections';

/** A thin bar for the download: how far it is, or a dim full bar while the size is not known. */
function bar(status: Parameters<typeof installPercent>[0] & { state: string }): HTMLElement {
  const percent = status.state === 'DOWNLOADING' ? installPercent(status) : null;
  const done = status.state !== 'DOWNLOADING';
  const attrs: Record<string, string> = { class: `sw-update-bar${percent === null ? ' is-unknown' : ''}`, role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100' };
  if (percent !== null) attrs['aria-valuenow'] = String(percent);
  return h('div', attrs, h('div', { class: 'sw-update-fill', style: `width:${done ? 100 : (percent ?? 100)}%` }));
}

function checkRow(ctx: Ctx, scope: Scope): HTMLElement {
  const button = h('button', { type: 'button', class: 'btn btn-primary sw-update-check' }, t('set.updates.check'));
  button.addEventListener('click', () => void checkForUpdates(ctx, 'manual'));
  const out = h('div', { class: 'sw-update-out', role: 'status', 'aria-live': 'polite' });
  // The question about unsaved changes, in the place of the button that was pressed (UI.md §4.3).
  const confirmHost = h('div', { class: 'sw-update-confirm' });
  const ask = (spec: Parameters<typeof showConfirmIn>[1]) => showConfirmIn(confirmHost, spec);
  const parts = rowShell('updates.check', { control: button, wide: true });
  parts.el.append(out, confirmHost);
  const draw = () => {
    const sum = updateSummary(ctx);
    const checking = sum.state === 'CHECKING';
    button.disabled = checking;
    button.textContent = checking ? t('up.checking') : t('set.updates.check');
    // Install and restart (or Download) is the main action of the row while there is something to install.
    button.classList.toggle('btn-primary', !sum.available);
    out.dataset.state = sum.state;
    out.dataset.version = sum.available?.version ?? '';
    const lines: Node[] = [];
    if (checking) lines.push(h('div', { class: 'sw-update-line' }, t('up.checking')));
    else if (sum.state === 'FAILED' && sum.fault) lines.push(h('div', { class: 'sw-update-line is-fault' }, t('up.failed', { reason: faultText(sum.fault) })));
    else if (sum.state === 'LATEST') lines.push(h('div', { class: 'sw-update-line' }, t('up.latest', { version: VERSION })));
    else if (sum.state === 'NEVER') lines.push(h('div', { class: 'sw-update-line' }, t('up.neverChecked')));
    const release = sum.available;
    const install = ctx.ui.get().updates.install;
    out.dataset.install = install.status.state;
    if (release) {
      lines.push(h('div', { class: 'sw-update-line is-result' }, availableText(release)));
      const notes = h('button', { type: 'button', class: 'btn sw-update-notes', onclick: () => openReleaseNotes(ctx, release) }, t('up.notes'));
      const status = install.status;
      if (installActive(status)) {
        const ready = status.state === 'INSTALLING' && status.ready;
        lines.push(h('div', { class: 'sw-update-line sw-update-progress', 'data-state': status.state }, ready && install.deferred ? t('up.restartWaiting') : installText(status)), bar(status));
        const actions = h('div', { class: 'sw-update-actions' });
        if (ready && install.deferred) actions.appendChild(h('button', { type: 'button', class: 'btn btn-primary sw-update-restart', onclick: () => restartNow(ctx) }, t('up.restartNow')));
        else if (status.state !== 'INSTALLING') actions.appendChild(h('button', { type: 'button', class: 'btn sw-update-cancel', onclick: () => void cancelInstall(ctx) }, t('up.cancelInstall')));
        if (actions.childNodes.length) lines.push(actions);
      } else if (status.state === 'FAILED') {
        const reason = installFaultText(status.error);
        const actions = h('div', { class: 'sw-update-actions' });
        // A launcher that cannot install here still has the package to download by hand.
        if (status.error === 'not-updatable') actions.appendChild(h('button', { type: 'button', class: 'btn btn-primary sw-update-download', onclick: () => downloadUpdate(ctx, release) }, t('up.download')));
        else actions.appendChild(h('button', { type: 'button', class: 'btn btn-primary sw-update-retry', onclick: () => retryInstall(ctx, release, ask) }, t('up.retry')));
        actions.appendChild(notes);
        lines.push(h('div', { class: 'sw-update-line is-fault sw-update-failure', 'data-error': status.error ?? '', 'data-tip': status.message ?? undefined }, t('up.failedInstall', { reason })), actions);
      } else {
        const { asset } = downloadChoice(ctx, release);
        const installable = installRequestFor(ctx, release) !== null;
        const tip = asset ? `${installable ? t('up.install') : t('up.download')}: ${asset.name}${asset.size !== null ? ` · ${formatBytes(asset.size, getLang())}` : ''}` : t('up.openRelease');
        const main = installable
          ? h('button', { type: 'button', class: 'btn btn-primary sw-update-install', 'data-tip': tip, onclick: () => installUpdate(ctx, release, ask) }, t('up.install'))
          : h('button', { type: 'button', class: 'btn btn-primary sw-update-download', 'data-tip': tip, onclick: () => downloadUpdate(ctx, release) }, t('up.download'));
        lines.push(h('div', { class: 'sw-update-actions' }, main, notes));
        // In the web version Download only opens the release page, and the row says so.
        if (!ctx.ui.get().desktop) lines.push(h('div', { class: 'sw-update-line sw-update-web-note' }, t('up.webNote')));
      }
    }
    out.replaceChildren(...lines);
  };
  scope.watch((_s, u) => [u.updates, u.updateLatest, u.desktop] as const, draw, shallowEq);
  return parts.el;
}

function lastRow(_ctx: Ctx, scope: Scope): HTMLElement {
  const when = h('span', { class: 'sw-value tabular' });
  scope.watch(
    (_s, u) => u.updateCheckedAt,
    (at) => {
      when.textContent = at === null ? t('up.never') : formatDateTime(at, getLang());
      when.dataset.at = at === null ? '' : String(at);
    },
  );
  return infoRow('updates.last', rowLabel('updates.last'), when);
}

export const UPDATES_HOOKS: SettingsHooks = {
  rows: {
    'updates.current': () => infoRow('updates.current', rowLabel('updates.current'), t('set.ab.version', { version: VERSION })),
    'updates.check': checkRow,
    'updates.last': lastRow,
  },
};
