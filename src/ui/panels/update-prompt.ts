// The window that asks about a newer version when the application starts (the owner asked for it,
// 2026-10-20): the startup check found one, so before anything else the window asks whether to update
// now — Install and restart on the desktop, Download where the application cannot install — with the
// release notes and Later. It is asked once per version and session (updates.ts `announce`); answering
// it in any way closes it, and the offer stays as a line in the status bar. Esc, or a click outside the
// window, is Later.

import { h } from '../dom';
import type { Ctx, Scope } from '../reactive';
import { t } from '../strings';
import { availableText, dismissUpdatePrompt, downloadUpdate, installRequestFor, installUpdate, openReleaseNotes } from '../updates';

export function updatePrompt(ctx: Ctx, scope: Scope): HTMLElement {
  const release = ctx.ui.get().updates.prompt;
  const root = h('div', { class: 'update-shield', 'data-update-prompt': '' });
  if (!release) return root;
  root.dataset.version = release.version;

  const later = () => dismissUpdatePrompt(ctx);
  const installable = installRequestFor(ctx, release) !== null;
  const main = installable
    ? h('button', { type: 'button', class: 'btn btn-primary', 'data-update-install': '' }, t('up.install'))
    : h('button', { type: 'button', class: 'btn btn-primary', 'data-update-download': '' }, t('up.download'));
  main.addEventListener('click', () => {
    dismissUpdatePrompt(ctx);
    if (installable) installUpdate(ctx, release);
    else downloadUpdate(ctx, release);
  });
  const notes = h('button', { type: 'button', class: 'btn', 'data-update-notes': '' }, t('up.notes'));
  notes.addEventListener('click', () => {
    openReleaseNotes(ctx, release);
    dismissUpdatePrompt(ctx);
  });
  const laterBtn = h('button', { type: 'button', class: 'btn', 'data-update-later': '' }, t('up.later'));
  laterBtn.addEventListener('click', later);

  const panel = h(
    'div',
    { class: 'update-window', role: 'dialog', 'aria-modal': 'true', 'aria-label': availableText(release) },
    h('h2', { class: 'update-window-title' }, availableText(release)),
    h('div', { class: 'update-window-actions' }, main, notes, laterBtn),
  );
  root.appendChild(panel);
  // A click on the dimmed ground outside the window is Later; a click inside it is not.
  root.addEventListener('click', (e) => {
    if (e.target === root) later();
  });
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') later();
  };
  document.addEventListener('keydown', onKey);
  scope.onDispose(() => document.removeEventListener('keydown', onKey));
  return root;
}
