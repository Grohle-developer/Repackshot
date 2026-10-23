// The window that asks about a newer version when the application starts (the owner asked for it,
// 2026-10-20): the startup check found one, so before anything else the window asks whether to update
// now. It offers what Settings ▸ Updates offers for the version — Install and restart on the desktop
// (or Download where the application cannot install), Release notes, the install itself followed in
// the window (its progress, Cancel, Restart now, a failure with Try again) — plus what only the
// window has: a small What changed from the release's own notes, Skip this version (remembered: the
// version is not announced again, a newer one is) and Later. It is asked once per version and session
// (updates.ts `announce`); answering it closes it, and the offer stays as a line in the status bar.
// Esc, or a click outside the window, is Later.

import { formatBytes } from '../../core/models';
import { installActive, installPercent, type InstallStatus } from '../../core/updates';
import { h } from '../dom';
import { showConfirmIn } from '../components/widgets';
import { shallowEq, type Ctx, type Scope } from '../reactive';
import { getLang, t } from '../strings';
import { availableText, cancelInstall, dismissUpdatePrompt, downloadChoice, downloadUpdate, installFaultText, installRequestFor, installText, installUpdate, openReleaseNotes, restartNow, retryInstall, skipUpdate } from '../updates';

/** The download's thin bar, drawn as in Settings ▸ Updates (the same classes, so the same look). */
function bar(status: InstallStatus): HTMLElement {
  const percent = status.state === 'DOWNLOADING' ? installPercent(status) : null;
  const done = status.state !== 'DOWNLOADING';
  const attrs: Record<string, string> = { class: `sw-update-bar${percent === null ? ' is-unknown' : ''}`, role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100' };
  if (percent !== null) attrs['aria-valuenow'] = String(percent);
  return h('div', attrs, h('div', { class: 'sw-update-fill', style: `width:${done ? 100 : (percent ?? 100)}%` }));
}

export function updatePrompt(ctx: Ctx, scope: Scope): HTMLElement {
  const release = ctx.ui.get().updates.prompt;
  const root = h('div', { class: 'update-shield', 'data-update-prompt': '' });
  if (!release) return root;
  root.dataset.version = release.version;

  const later = () => dismissUpdatePrompt(ctx);
  const btn = (cls: string, label: string, dataAttr: string, onClick: () => void, tip?: string): HTMLButtonElement => {
    const b = h('button', { type: 'button', class: cls, [dataAttr]: '', ...(tip ? { 'data-tip': tip } : {}) }, label) as HTMLButtonElement;
    b.addEventListener('click', onClick);
    return b;
  };
  const laterBtn = () => btn('btn', t('up.later'), 'data-update-later', later);
  const notesBtn = () =>
    btn('btn', t('up.notes'), 'data-update-notes', () => {
      openReleaseNotes(ctx, release);
      dismissUpdatePrompt(ctx);
    });

  // The question about unsaved changes, in the window that was pressed (UI.md §4.3).
  const confirmHost = h('div', { class: 'update-window-confirm' });
  const ask = (spec: Parameters<typeof showConfirmIn>[1]) => showConfirmIn(confirmHost, spec);
  const body = h('div', { class: 'update-window-body' });
  const panel = h(
    'div',
    { class: 'update-window', role: 'dialog', 'aria-modal': 'true', 'aria-label': availableText(release) },
    h('h2', { class: 'update-window-title' }, availableText(release)),
    body,
    confirmHost,
  );
  root.appendChild(panel);

  const draw = () => {
    const install = ctx.ui.get().updates.install;
    const status = install.status;
    const lines: Node[] = [];
    if (installActive(status)) {
      const ready = status.state === 'INSTALLING' && status.ready;
      lines.push(h('div', { class: 'update-window-line sw-update-progress', 'data-state': status.state }, ready && install.deferred ? t('up.restartWaiting') : installText(status)), bar(status));
      const actions = h('div', { class: 'update-window-actions' });
      if (ready && install.deferred) actions.appendChild(btn('btn btn-primary', t('up.restartNow'), 'data-update-restart', () => restartNow(ctx)));
      else if (status.state !== 'INSTALLING') actions.appendChild(btn('btn', t('up.cancelInstall'), 'data-update-cancel', () => void cancelInstall(ctx)));
      actions.appendChild(laterBtn());
      lines.push(actions);
    } else if (status.state === 'FAILED') {
      const actions = h('div', { class: 'update-window-actions' });
      // A launcher that cannot install here still has the package to download by hand.
      if (status.error === 'not-updatable')
        actions.appendChild(
          btn('btn btn-primary', t('up.download'), 'data-update-download', () => {
            downloadUpdate(ctx, release);
            dismissUpdatePrompt(ctx);
          }),
        );
      else actions.appendChild(btn('btn btn-primary', t('up.retry'), 'data-update-retry', () => retryInstall(ctx, release, ask)));
      actions.appendChild(notesBtn());
      actions.appendChild(laterBtn());
      lines.push(h('div', { class: 'update-window-line is-fault' }, t('up.failedInstall', { reason: installFaultText(status.error) })), actions);
    } else {
      if (release.highlights.length) {
        lines.push(
          h(
            'div',
            { class: 'update-window-changes' },
            h('div', { class: 'update-window-changes-title' }, t('up.whatChanged')),
            h('ul', { class: 'update-window-changes-list' }, ...release.highlights.map((line) => h('li', {}, line))),
          ),
        );
      }
      const { asset } = downloadChoice(ctx, release);
      const installable = installRequestFor(ctx, release) !== null;
      const tip = asset ? `${installable ? t('up.install') : t('up.download')}: ${asset.name}${asset.size !== null ? ` · ${formatBytes(asset.size, getLang())}` : ''}` : t('up.openRelease');
      const main = installable
        ? btn('btn btn-primary', t('up.install'), 'data-update-install', () => installUpdate(ctx, release, ask), tip)
        : btn(
            'btn btn-primary',
            t('up.download'),
            'data-update-download',
            () => {
              downloadUpdate(ctx, release);
              dismissUpdatePrompt(ctx);
            },
            tip,
          );
      lines.push(h('div', { class: 'update-window-actions' }, main, notesBtn(), btn('btn', t('up.skip'), 'data-update-skip', () => skipUpdate(ctx)), laterBtn()));
      // In the web version Download only opens the release page, and the window says so, as the section does.
      if (!ctx.ui.get().desktop) lines.push(h('div', { class: 'update-window-line sw-update-web-note' }, t('up.webNote')));
    }
    body.replaceChildren(...lines);
  };
  draw();
  scope.watch((_s, u) => [u.updates, u.desktop] as const, draw, shallowEq);

  // A click on the dimmed ground outside the window is Later; a click inside it is not.
  root.addEventListener('click', (e) => {
    if (e.target === root) later();
  });
  const onKey = (e: KeyboardEvent) => {
    // While the question about unsaved changes is open, Esc is its own (it cancels the question).
    if (e.key === 'Escape' && !confirmHost.hasChildNodes()) later();
  };
  document.addEventListener('keydown', onKey);
  scope.onDispose(() => document.removeEventListener('keydown', onKey));
  return root;
}
