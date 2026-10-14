// Settings ▸ Plugins (UI.md §2.9, ROADMAP P6 decision 3): the plugins of the registry and the ones installed from a
// file, each with its logo (once installed: the logo is in its package), name, publisher, version, size, summary,
// the Closed licence badge and its project page; Install, Update and Remove; the activation key asked for inline
// when the registry has no key address (or it failed); the state of the install; and, once installed, its licence
// and its notices in full in collapsibles, with the sentence that its code is closed and Repackshot's licence does
// not cover it. Under them, Install from file…: a `.rpk` and its key, so the tool stays in view for future plugins.
// Sizes come from the registry and from the package kept; nothing is assumed (CLAUDE.md rule 10).

import { formatBytes } from '../../core/models';
import type { InstalledPlugin, InstallOutcome, PluginFault, PluginsSnapshot, PluginTask } from '../../core/plugins';
import type { PluginRegistryEntry } from '../../data/plugins';
import { showConfirmIn } from '../components/widgets';
import { h, icon } from '../dom';
import { dyn } from '../names';
import type { Ctx, Scope } from '../reactive';
import { getLang, lbl, t } from '../strings';
import { rowShell } from './settings-rows';
import type { SettingsHooks } from './settings-sections';

const size = (bytes: number) => formatBytes(bytes, getLang());
const pct = (done: number, total: number) => (total > 0 ? Math.min(100, Math.floor((100 * done) / total)) : 0);

/** A fault as the end of a sentence ("the package is damaged or was altered"). */
export function faultText(fault: PluginFault, detail = ''): string {
  return t(dyn(`set.pl.fault.${fault}`), { detail });
}

/** An install's outcome as one line (for the status of Install from file… and the toasts). */
export function outcomeText(o: InstallOutcome, name: string): string {
  if (o.kind === 'DONE') return t('set.pl.fileDone', { name, version: o.version });
  if (o.kind === 'NEEDS_KEY') return t(dyn(`set.pl.key.${o.reason}`));
  return t('set.pl.failed', { reason: faultText(o.fault, o.detail) });
}

const link = (href: string, text: string) => h('a', { href, target: '_blank', rel: 'noopener noreferrer', class: 'sw-link' }, text, ' ↗');

/** A text file of an installed plugin in a disclosure that reads it (decrypted in memory) when opened. */
function pluginText(ctx: Ctx, id: string, file: string, title: string): HTMLElement {
  const pre = h('pre', { class: 'sw-licence-text' }, t('set.ai.loadingText'));
  const det = h('details', { class: 'sw-licence', 'data-plugin-text': file }, h('summary', null, title), pre) as HTMLDetailsElement;
  let loaded = false;
  det.addEventListener('toggle', () => {
    if (!det.open || loaded) return;
    loaded = true;
    void (ctx.services.plugins?.text(id, file) ?? Promise.resolve(null)).then((text) => (pre.textContent = text ?? t('set.ai.textMissing')));
  });
  return det;
}

/** The state line of a plugin: what its install is doing, or what is installed. */
export function stateLine(task: PluginTask | undefined, installed: InstalledPlugin | undefined): string {
  if (task) {
    switch (task.stage) {
      case 'DOWNLOADING':
        return t('set.pl.downloading', { pct: pct(task.done, task.total), done: size(task.done), total: size(task.total) });
      case 'VERIFYING':
        return t('set.pl.verifying');
      case 'INSTALLING':
        return t('set.pl.installing');
      case 'NEEDS_KEY':
        return t('set.pl.needsKey');
      case 'FAILED':
        return t('set.pl.failed', { reason: faultText(task.fault, task.detail) });
    }
  }
  if (!installed) return t('set.pl.notInstalled');
  if (installed.problem) return t('set.pl.problem', { reason: faultText(installed.problem) });
  return t(installed.source === 'file' ? 'set.pl.installedFile' : 'set.pl.installed', { version: installed.version, size: size(installed.size) });
}

/** One plugin of the list, kept up to date with the host's snapshot. */
function pluginCard(ctx: Ctx, id: string): { el: HTMLElement; update(snap: PluginsSnapshot): void } {
  const port = ctx.services.plugins!;
  const logo = h('div', { class: 'sw-pl-logo', 'aria-hidden': 'true' });
  const name = h('div', { class: 'sw-pl-name' });
  const meta = h('div', { class: 'note tabular sw-pl-meta' });
  const summary = h('p', { class: 'note sw-pl-summary' });
  const links = h('div', { class: 'note sw-pl-links' });
  const stateEl = h('div', { class: 'sw-pl-state note tabular', role: 'status', 'aria-live': 'polite' });
  const bar = h('div', { class: 'sw-bar', 'aria-hidden': 'true' }, h('span'));
  const closed = h('p', { class: 'note sw-pl-closed' }, t('set.pl.closedSentence'));
  const texts = h('div', { class: 'sw-pl-texts' });
  const actions = h('div', { class: 'sw-model-actions sw-pl-actions' });
  const panel = h('div', { class: 'sw-model-panel sw-pl-panel' });
  const el = h('div', { class: 'sw-pl', 'data-plugin': id, role: 'listitem' }, logo, h('div', { class: 'sw-pl-main' }, name, meta, summary, links, stateEl, bar, closed, texts), actions, panel);
  let lastActions = '';
  let lastPanel = '';
  let lastTexts = '';
  let lastLogo: string | null | undefined;

  const keyForm = (reason: 'NONE' | 'FAILED' | 'WRONG' | 'BAD', title: string) => {
    const input = h('input', { type: 'text', class: 'text-input sw-pl-key-input', 'aria-label': t('set.pl.keyField'), placeholder: t('set.pl.keyPlaceholder'), spellcheck: 'false', autocomplete: 'off', autocapitalize: 'off' }) as HTMLInputElement;
    const submit = h('button', { type: 'submit', class: 'btn btn-primary' }, t('set.pl.activate'));
    const form = h(
      'form',
      { class: 'sw-form sw-pl-key', 'data-reason': reason, 'aria-label': t('set.pl.keyTitle', { name: title }) },
      h('div', { class: 'sw-strong' }, t('set.pl.keyTitle', { name: title })),
      h('p', { class: `note${reason === 'WRONG' || reason === 'BAD' ? ' sw-warn' : ''}` }, t(dyn(`set.pl.key.${reason}`))),
      input,
      h('p', { class: 'note' }, t('set.pl.keyKept')),
      h('div', { class: 'sw-inline' }, submit, h('button', { type: 'button', class: 'btn', onclick: () => port.cancelInstall(id) }, t('common.cancel'))),
    );
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      submit.disabled = true;
      void port.provideKey(id, input.value).finally(() => (submit.disabled = false));
    });
    // Typing a key does not reach the window's shortcuts.
    input.addEventListener('keydown', (e) => e.stopPropagation());
    queueMicrotask(() => input.focus());
    return form;
  };

  return {
    el,
    update(snap) {
      const entry = port.registry.find((e) => e.id === id);
      const inst = snap.installed.find((p) => p.id === id);
      const task = snap.tasks[id];
      const m = inst?.manifest ?? null;
      const title = m ? lbl(m.name) : entry ? lbl(entry.name) : id;
      // The logo is the package's: shown once it is installed (an inline one of the registry before).
      const src = inst?.logo ?? (entry?.logo.startsWith('data:') ? entry.logo : null);
      if (src !== lastLogo) {
        lastLogo = src;
        logo.replaceChildren(src ? h('img', { src, alt: '', width: 40, height: 40, draggable: 'false' }) : icon('model', 20));
        logo.classList.toggle('is-empty', !src);
      }
      name.replaceChildren(h('span', null, title), h('span', { class: 'sw-badge aux sw-pl-licence', 'data-licence': 'closed' }, t('set.pl.closed')), ...(inst?.source === 'file' ? [h('span', { class: 'sw-badge aux' }, t('set.pl.fromFile'))] : []));
      const version = entry?.version ?? inst?.version ?? '';
      const bytes = entry?.bytes ?? inst?.size ?? 0;
      meta.textContent = t('set.pl.meta', { publisher: m?.publisher ?? entry?.publisher ?? '', version, size: size(bytes) });
      summary.textContent = m ? lbl(m.summary) : entry ? lbl(entry.summary) : '';
      const homepage = m?.homepage ?? entry?.homepage;
      links.replaceChildren(...(homepage ? [link(homepage, t('set.pl.homepage'))] : []));
      stateEl.textContent = stateLine(task, inst);
      el.dataset.state = task?.stage ?? (inst ? (inst.problem ? 'PROBLEM' : 'INSTALLED') : 'NOT_INSTALLED');
      el.dataset.version = inst?.version ?? '';
      const progress = task?.stage === 'DOWNLOADING' ? pct(task.done, task.total) : null;
      bar.style.display = progress === null ? 'none' : '';
      (bar.firstElementChild as HTMLElement).style.width = `${progress ?? 0}%`;
      // The licence and the notices, in full, once the package is on this computer.
      const textsKey = m ? `${m.id}|${m.version}|${m.licence.file ?? ''}|${m.notices ?? ''}|${getLang()}` : '';
      if (textsKey !== lastTexts) {
        lastTexts = textsKey;
        texts.replaceChildren(...(m?.licence.file ? [pluginText(ctx, id, m.licence.file, t('set.pl.licenceText', { label: lbl(m.licence.label) }))] : []), ...(m?.notices ? [pluginText(ctx, id, m.notices, t('set.pl.noticesText'))] : []));
      }
      // The buttons: what can be done now.
      const busy = task && task.stage !== 'FAILED' && task.stage !== 'NEEDS_KEY';
      const update = entry && inst && inst.version !== entry.version;
      const actionsKey = `${busy ? 'busy' : ''}|${inst ? 'i' : ''}|${update ? entry!.version : ''}|${entry ? 'r' : ''}|${task?.stage === 'NEEDS_KEY' ? 'k' : ''}|${getLang()}`;
      if (actionsKey !== lastActions) {
        lastActions = actionsKey;
        const list: HTMLElement[] = [];
        if (!busy && task?.stage !== 'NEEDS_KEY') {
          if (entry && !inst) list.push(h('button', { type: 'button', class: 'btn btn-sm btn-primary sw-pl-install', 'aria-label': `${t('set.pl.install')}: ${title}`, onclick: () => void port.install(id) }, icon('download', 14), t('set.pl.install')));
          if (update) list.push(h('button', { type: 'button', class: 'btn btn-sm btn-primary sw-pl-update', onclick: () => void port.install(id) }, icon('download', 14), t('set.pl.update', { version: entry!.version })));
          if (inst)
            list.push(
              h(
                'button',
                {
                  type: 'button',
                  class: 'btn btn-sm sw-pl-remove',
                  'aria-label': `${t('set.pl.remove')}: ${title}`,
                  onclick: () =>
                    showConfirmIn(panel, {
                      message: t('set.pl.removeConfirm', { name: title }),
                      options: [{ label: t('set.pl.remove'), primary: true, run: () => void port.remove(id) }],
                    }),
                },
                icon('trash', 14),
                t('set.pl.remove'),
              ),
            );
        }
        actions.replaceChildren(...list);
      }
      // The key, asked for inline while the install waits for it.
      const panelKey = task?.stage === 'NEEDS_KEY' ? `key|${task.reason}|${getLang()}` : '';
      if (panelKey !== lastPanel) {
        lastPanel = panelKey;
        if (task?.stage === 'NEEDS_KEY') panel.replaceChildren(keyForm(task.reason, title));
        else if (panel.querySelector('.sw-pl-key')) panel.replaceChildren();
      }
    },
  };
}

/** The ids the list shows: the registry's, in its order, then the ones installed from a file. */
export function listedIds(registry: readonly PluginRegistryEntry[], snap: PluginsSnapshot | null): string[] {
  const ids = registry.map((e) => e.id);
  for (const p of snap?.installed ?? []) if (!ids.includes(p.id)) ids.push(p.id);
  return ids;
}

function listRow(ctx: Ctx, scope: Scope): HTMLElement {
  const parts = rowShell('plugins.list', { control: null, wide: true, hideLabel: true });
  const port = ctx.services.plugins;
  const where = h('p', { class: 'note sw-pl-where' });
  const list = h('div', { class: 'sw-models sw-pls', role: 'list', 'aria-label': t('set.plugins.list') });
  parts.el.append(where, list);
  if (!port) {
    where.textContent = t('set.pl.unavailable');
    return parts.el;
  }
  const cards = new Map<string, ReturnType<typeof pluginCard>>();
  scope.watch(
    (_s, u) => u.plugins,
    (snap) => {
      where.textContent = !snap || !snap.ready ? t('set.pl.loading') : snap.persistent ? t('set.pl.where') : t('set.pl.memory');
      const ids = listedIds(port.registry, snap);
      for (const id of ids) if (!cards.has(id)) cards.set(id, pluginCard(ctx, id));
      for (const id of [...cards.keys()]) if (!ids.includes(id)) cards.delete(id);
      list.replaceChildren(...ids.map((id) => cards.get(id)!.el));
      if (ids.length === 0) list.replaceChildren(h('p', { class: 'note' }, t('set.pl.none')));
      if (snap) for (const c of cards.values()) c.update(snap);
    },
  );
  return parts.el;
}

function fileRow(ctx: Ctx, scope: Scope): HTMLElement {
  void scope;
  const port = ctx.services.plugins;
  let file: File | null = null;
  const fileName = h('span', { class: 'note sw-pl-file-name' }, t('set.pl.noFile'));
  const input = h('input', { type: 'file', accept: '.rpk,application/octet-stream', class: 'sw-pl-file-input', style: 'display:none' }) as HTMLInputElement;
  const choose = h('button', { type: 'button', class: 'btn sw-pl-choose', disabled: !port, onclick: () => input.click() }, icon('upload', 14), t('set.pl.chooseFile'));
  const key = h('input', { type: 'text', class: 'text-input sw-pl-file-key', 'aria-label': t('set.pl.keyField'), placeholder: t('set.pl.keyPlaceholder'), spellcheck: 'false', autocomplete: 'off', autocapitalize: 'off', disabled: !port }) as HTMLInputElement;
  const install = h('button', { type: 'button', class: 'btn btn-primary sw-pl-file-install', disabled: true }, t('set.pl.install'));
  const status = h('div', { class: 'note sw-pl-file-status', role: 'status', 'aria-live': 'polite' });
  const ready = () => (install.disabled = !port || !file || key.value.trim() === '');
  input.addEventListener('change', () => {
    file = input.files?.[0] ?? null;
    fileName.textContent = file ? `${file.name} · ${size(file.size)}` : t('set.pl.noFile');
    status.textContent = '';
    ready();
  });
  key.addEventListener('input', ready);
  key.addEventListener('keydown', (e) => e.stopPropagation());
  install.addEventListener('click', async () => {
    if (!port || !file) return;
    install.disabled = true;
    status.textContent = t('set.pl.verifying');
    const o = await port.installFile(file, key.value);
    const inst = port.snapshot().installed.find((p) => o.kind === 'DONE' && p.id === o.id);
    status.textContent = outcomeText(o, inst?.manifest ? lbl(inst.manifest.name) : o.kind === 'DONE' ? o.id : '');
    status.dataset.outcome = o.kind;
    if (o.kind === 'DONE') {
      key.value = '';
      file = null;
      input.value = '';
      fileName.textContent = t('set.pl.noFile');
    }
    ready();
  });
  const parts = rowShell('plugins.file', { control: null, wide: true, aux: t('set.pl.fileHint') });
  parts.el.append(h('div', { class: 'sw-inline sw-pl-file' }, choose, fileName, input), h('div', { class: 'sw-inline sw-pl-file' }, key, install), status);
  return parts.el;
}

export const PLUGINS_HOOKS: SettingsHooks = {
  rows: {
    'plugins.list': listRow,
    'plugins.file': fileRow,
  },
};
