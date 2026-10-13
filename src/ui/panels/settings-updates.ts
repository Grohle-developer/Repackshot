// Settings ▸ Updates (UI.md §2.9): the installed version, Check for updates with its result on the
// row (Checking… · the latest version · a newer one with Download and Release notes · why the check
// failed), Check at startup (a generated toggle row) and when the feed last answered. The result is
// what core/updates.ts summarises from the state the commands of ui/updates.ts keep; nothing is assumed.

import { formatBytes } from '../../core/models';
import { VERSION } from '../../core/version';
import { h } from '../dom';
import { shallowEq, type Ctx, type Scope } from '../reactive';
import { formatDateTime, getLang, t } from '../strings';
import { availableText, checkForUpdates, downloadChoice, downloadUpdate, faultText, openReleaseNotes, updateSummary } from '../updates';
import { infoRow, rowLabel, rowShell } from './settings-rows';
import type { SettingsHooks } from './settings-sections';

function checkRow(ctx: Ctx, scope: Scope): HTMLElement {
  const button = h('button', { type: 'button', class: 'btn btn-primary sw-update-check' }, t('set.updates.check'));
  button.addEventListener('click', () => void checkForUpdates(ctx, 'manual'));
  const out = h('div', { class: 'sw-update-out', role: 'status', 'aria-live': 'polite' });
  const parts = rowShell('updates.check', { control: button, wide: true });
  parts.el.appendChild(out);
  const draw = () => {
    const sum = updateSummary(ctx);
    const checking = sum.state === 'CHECKING';
    button.disabled = checking;
    button.textContent = checking ? t('up.checking') : t('set.updates.check');
    // Download is the main action of the row while there is something to download.
    button.classList.toggle('btn-primary', !sum.available);
    out.dataset.state = sum.state;
    out.dataset.version = sum.available?.version ?? '';
    const lines: Node[] = [];
    if (checking) lines.push(h('div', { class: 'sw-update-line' }, t('up.checking')));
    else if (sum.state === 'FAILED' && sum.fault) lines.push(h('div', { class: 'sw-update-line is-fault' }, t('up.failed', { reason: faultText(sum.fault) })));
    else if (sum.state === 'LATEST') lines.push(h('div', { class: 'sw-update-line' }, t('up.latest', { version: VERSION })));
    else if (sum.state === 'NEVER') lines.push(h('div', { class: 'sw-update-line' }, t('up.neverChecked')));
    const release = sum.available;
    if (release) {
      const { asset } = downloadChoice(ctx, release);
      const tip = asset ? `${t('up.download')}: ${asset.name}${asset.size !== null ? ` · ${formatBytes(asset.size, getLang())}` : ''}` : t('up.openRelease');
      lines.push(
        h('div', { class: 'sw-update-line is-result' }, availableText(release)),
        h(
          'div',
          { class: 'sw-update-actions' },
          h('button', { type: 'button', class: 'btn btn-primary sw-update-download', 'data-tip': tip, onclick: () => downloadUpdate(ctx, release) }, t('up.download')),
          h('button', { type: 'button', class: 'btn sw-update-notes', onclick: () => openReleaseNotes(release) }, t('up.notes')),
        ),
      );
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
