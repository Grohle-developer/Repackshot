// The warning about the inference runtime (phase U10, AI-POST.md §7.1) in the two places the person turns the AI on:
// the render window's AI section and Settings ▸ AI post-processing. When a model is installed and the runtime is not
// (or is on its way, or Windows lacks Microsoft's Visual C++ runtime so it does not start) it says so, with the
// buttons that fix it: Install (the launcher downloads the build the rule chose, as the Runtime row does), Resume,
// Pause, Microsoft's page for Visual C++ and Check again. Everything shown is what the launcher said, polled by the
// one RuntimeWatch (ui/ai-runtime-state.ts); it draws nothing where there is nothing to say or nothing to ask.

import { runtimeWarning, type RuntimeWarning } from '../../core/ai-runtimes';
import { formatBytes } from '../../core/models';
import { hasModel, openVcRuntime, runtimeWatch } from '../ai-runtime-state';
import * as cmd from '../commands';
import { h, icon } from '../dom';
import type { Ctx, Scope } from '../reactive';
import { getLang, t } from '../strings';

const size = (bytes: number) => formatBytes(bytes, getLang());

/** The words of a warning: a title, a sentence, and a progress fraction (0..1) when something is downloading. */
export function warningText(w: RuntimeWarning): { title: string; text: string; progress: number | null } {
  switch (w.kind) {
    case 'MISSING':
      return { title: t('rt.missing'), text: [t('rt.missingText'), w.error ? t('set.rt.failed', { error: w.error }) : null].filter(Boolean).join(' '), progress: null };
    case 'PAUSED':
      return { title: t('rt.paused'), text: t('rt.pausedText', { pct: w.pct }), progress: w.pct / 100 };
    case 'PROGRESS':
      return {
        title: t('rt.progress'),
        text: w.phase === 'downloading' ? t('set.rt.state.downloading', { pct: w.pct, done: size(w.done), total: size(w.total) }) : t(w.phase === 'verifying' ? 'set.rt.state.verifying' : 'set.rt.state.installing'),
        progress: w.phase === 'downloading' ? w.pct / 100 : 1,
      };
    case 'VC_RUNTIME':
      return { title: t('rt.vc'), text: t('set.rt.vcRuntime'), progress: null };
    case 'BROKEN':
      return { title: t('rt.broken'), text: t('set.rt.probeError', { error: w.error }), progress: null };
    case 'NO_BUILD':
      return { title: t('rt.noBuild'), text: t('set.rt.noBuild', { os: w.os, arch: w.arch }), progress: null };
  }
}

/**
 * The notice. `where`: the render window (it also offers a way to Settings, where the Runtime row has the rest) or
 * Settings itself. Hidden while there is nothing to say (no model, runtime fine, no launcher to ask).
 */
export function runtimeNotice(ctx: Ctx, scope: Scope, where: 'render' | 'settings'): HTMLElement {
  const el = h('div', { class: 'rt-notice', role: 'status', 'aria-live': 'polite', 'data-runtime-notice': where, hidden: true });
  const watch = runtimeWatch(ctx);
  if (!watch) return el;
  let shown = '';
  const draw = () => {
    const w = runtimeWarning(watch.report, hasModel(ctx.ui.get()));
    el.hidden = w === null;
    if (!w) {
      el.dataset.kind = '';
      shown = '';
      el.replaceChildren();
      return;
    }
    el.dataset.kind = w.kind;
    const words = warningText(w);
    // The progress moves every few hundred milliseconds: only the bar and the line are touched, never the buttons.
    const line = watch.actionError ? `${words.text} ${t('rt.actionFailed', { error: watch.actionError })}` : words.text;
    const frame = `${w.kind}|${w.kind === 'PROGRESS' || w.kind === 'PAUSED' ? '' : JSON.stringify(w)}|${getLang()}|${where}`;
    if (frame === shown && el.firstChild) {
      el.querySelector('.rt-notice-line')!.textContent = line;
      const bar = el.querySelector<HTMLElement>('.rt-notice-bar > span');
      if (bar && words.progress !== null) bar.style.width = `${Math.round(words.progress * 100)}%`;
      return;
    }
    shown = frame;
    const button = (label: string, run: () => void, primary = false, iconName?: Parameters<typeof icon>[0]) =>
      h('button', { type: 'button', class: `btn btn-sm${primary ? ' btn-primary' : ''}`, onclick: run }, iconName ? icon(iconName, 14) : null, label);
    const actions: HTMLElement[] = [];
    if (w.kind === 'MISSING') actions.push(button(t('rt.install', { size: size(w.bytes) }), () => void watch.install(w.key), true, 'download'));
    else if (w.kind === 'PAUSED') actions.push(button(t('set.ai.resume'), () => void watch.install(w.key), true, 'play'));
    else if (w.kind === 'PROGRESS' && w.phase === 'downloading') actions.push(button(t('set.ai.pause'), () => void watch.pause(w.key), false, 'pause'));
    else if (w.kind === 'VC_RUNTIME') {
      actions.push(
        h('button', { type: 'button', class: 'btn btn-sm btn-primary', 'data-vc-runtime': '', 'data-tip': t('set.rt.vcRuntimeTip'), onclick: () => void openVcRuntime(ctx, { vcRuntimeUrl: w.url }).catch(() => undefined) }, icon('download', 14), t('set.rt.vcRuntimeInstall')),
        button(t('set.rt.probe'), () => void watch.probe(w.key)),
      );
    } else if (w.kind === 'BROKEN') actions.push(button(t('set.rt.probe'), () => void watch.probe(w.key)));
    if (where === 'render') actions.push(button(t('menu.settings'), () => cmd.openSettings(ctx, 'ai.runtime')));
    const main = h('div', { class: 'rt-notice-main' }, h('div', { class: 'rt-notice-title' }, words.title), h('div', { class: 'note rt-notice-line' }, line));
    if (words.progress !== null) main.appendChild(h('div', { class: 'sw-bar rt-notice-bar', 'aria-hidden': 'true' }, h('span', { style: `width:${Math.round(words.progress * 100)}%` })));
    el.replaceChildren(h('span', { class: 'sw-warn-dot', 'aria-hidden': 'true' }), main);
    if (actions.length > 0) el.appendChild(h('div', { class: 'rt-notice-actions' }, ...actions));
  };
  const off = watch.subscribe(draw);
  scope.onDispose(off);
  // A model arriving or leaving, and a language switch, change what there is to say.
  scope.watch((_s, u) => [u.models?.installed.join(',') ?? '', u.models?.ready ?? false] as const, draw, (a, b) => a[0] === b[0] && a[1] === b[1]);
  return el;
}

/**
 * The small marker in the title of a folded AI section: the notice inside is out of sight until it is unfolded, so
 * the title says there is something to do.
 */
export function runtimeBadge(ctx: Ctx, scope: Scope): HTMLElement {
  const el = h('span', { class: 'rt-badge', hidden: true, 'data-runtime-badge': '' }, h('span', { class: 'sw-warn-dot', 'aria-hidden': 'true' }), h('span', null, t('rt.badge')));
  const watch = runtimeWatch(ctx);
  if (!watch) return el;
  const draw = () => {
    const w = runtimeWarning(watch.report, hasModel(ctx.ui.get()));
    const show = w !== null && w.kind !== 'PROGRESS' && w.kind !== 'NO_BUILD';
    el.hidden = !show;
    el.setAttribute('data-tip', w ? warningText(w).title : '');
  };
  scope.onDispose(watch.subscribe(draw));
  scope.watch((_s, u) => [u.models?.installed.join(',') ?? '', u.models?.ready ?? false] as const, draw, (a, b) => a[0] === b[0] && a[1] === b[1]);
  return el;
}
