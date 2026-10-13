// Rows of the Settings window (UI.md §2.9), generated from the metadata of
// core/settings.ts: label, an optional auxiliary line, the control on the
// right (segment, toggle, number field of §4.4, dropdown, text), a dot when the
// value differs from the factory one with an inline Reset on hover, and what
// is not built yet visible, disabled, marked coming soon. Every change goes
// through cmd.setSetting: saved at once, never undone.
//
// Label, auxiliary line, value and control never overlap, at any width and
// interface size (settings.css): the label column keeps a minimum and wraps,
// the control wraps under itself, and a narrow window stacks the row. A long
// value (a folder, a sentence) is a stacked row (`valueRow`): the value on its
// own line under the label, a path in the monospace style broken anywhere, the
// buttons under it, and the full text as the hover title.

import { defaultSettings, isFactory, type ControlSpec, type SettingKey, type SettingMeta, type Settings } from '../../core/settings';
import * as cmd from '../commands';
import { numberField, segmented, select, textField, toggle } from '../components/controls';
import { h } from '../dom';
import { dyn } from '../names';
import type { Ctx, Scope } from '../reactive';
import { t } from '../strings';

export const rowLabel = (id: string): string => t(dyn(`set.${id}`));
export const optionLabel = (id: string, option: string | number): string => t(dyn(`set.${id}.${option}`));

const UNIT_TEXT: Record<string, () => string> = { DPI: () => t('rw.dpiUnit'), min: () => t('set.unit.min') };
export const unitText = (u: string | undefined): string | undefined => (u === undefined ? undefined : (UNIT_TEXT[u]?.() ?? u));

let rowSeq = 0;

export interface RowParts {
  el: HTMLElement;
  labelEl: HTMLElement;
  auxEl: HTMLElement;
  ctrlEl: HTMLElement;
}

/**
 * The frame of a row: `id` names it for deep links and the search (`data-row`). `soon` disables it visibly with
 * "coming soon"; `badges` are small auxiliary words after the label (for new projects, desktop only).
 */
export function rowShell(id: string, o: { label?: string; aux?: string | null; control?: Node | null; soon?: boolean; badges?: string[]; wide?: boolean; stacked?: boolean; hideLabel?: boolean } = {}): RowParts {
  const labelId = `sw-l${++rowSeq}`;
  // A row that is the whole of its block keeps its label for screen readers only (the block's title says it).
  const labelEl = h('div', { class: `sw-label${o.hideLabel ? ' sr-only' : ''}`, id: labelId }, o.label ?? rowLabel(id), ...(o.badges ?? []).map((b) => h('span', { class: 'sw-badge aux' }, b)), o.soon ? h('span', { class: 'sw-badge aux' }, t('common.comingSoon')) : null);
  const auxEl = h('div', { class: 'sw-aux note' }, o.aux ?? '');
  if (!o.aux) auxEl.style.display = 'none';
  const ctrlEl = h('div', { class: 'sw-ctrl' }, o.control ?? null);
  const el = h(
    'div',
    { class: `sw-row${o.wide ? ' is-wide' : ''}${o.stacked ? ' is-stacked' : ''}${o.soon ? ' is-soon' : ''}`, 'data-row': id, role: 'group', 'aria-labelledby': labelId },
    h('div', { class: 'sw-text' }, h('span', { class: 'sw-dot', 'aria-hidden': 'true' }), labelEl, auxEl),
    ctrlEl,
  );
  return { el, labelEl, auxEl, ctrlEl };
}

/** Disables every control in a container (coming soon). */
function disableAll(root: HTMLElement): void {
  for (const c of root.querySelectorAll<HTMLElement>('button, input, select, [role="spinbutton"]')) {
    if (c instanceof HTMLButtonElement || c instanceof HTMLInputElement || c instanceof HTMLSelectElement) c.disabled = true;
    else {
      c.classList.add('is-disabled');
      c.tabIndex = -1;
      c.setAttribute('aria-disabled', 'true');
    }
  }
}

export interface ControlHandle {
  el: HTMLElement;
  set(v: unknown): void;
}

/** The control of a setting from its spec; `onChange` gets valid values (the core validates again). */
export function controlFor(meta: SettingMeta, value: unknown, onChange: (v: unknown) => void, opts: { disabledOptions?: readonly (string | number)[]; optionTip?: (o: string | number) => string | undefined } = {}): ControlHandle | null {
  const c: ControlSpec = meta.control;
  const label = rowLabel(meta.id);
  switch (c.kind) {
    case 'choice': {
      const off = new Set([...(c.soon ?? []), ...(opts.disabledOptions ?? [])].map(String));
      const tip = (o: string | number) => opts.optionTip?.(o) ?? (c.soon?.includes(o) ? `${t('common.comingSoon')}: ${t(dyn(`set.${meta.id}.${o}soon`))}` : undefined);
      if (c.select || c.options.length > 4) {
        const sel = select(
          c.options.map((o) => ({ value: String(o), label: optionLabel(meta.id, o) + (off.has(String(o)) && c.soon?.includes(o) ? ` · ${t('common.comingSoon')}` : ''), disabled: off.has(String(o)) })),
          String(value),
          (v) => onChange(typeof c.options[0] === 'number' ? Number(v) : v),
          label,
        );
        return { el: sel.el, set: (v) => sel.set(String(v)) };
      }
      const seg = segmented(
        c.options.map((o) => ({ value: String(o), label: optionLabel(meta.id, o), disabled: off.has(String(o)), title: tip(o) })),
        String(value),
        (v) => onChange(typeof c.options[0] === 'number' ? Number(v) : v),
        { ariaLabel: label },
      );
      return { el: seg.el, set: (v) => seg.set(String(v)) };
    }
    case 'toggle': {
      const tg = toggle(value === true, (v) => onChange(v), label);
      return { el: tg.el, set: (v) => tg.set(v === true) };
    }
    case 'number': {
      const zero = c.zero ? t('set.auto') : null;
      const nf = numberField({
        value: Number(value),
        min: c.min,
        max: c.max,
        step: c.step,
        unit: unitText(c.unit),
        ariaLabel: label,
        ...(zero ? { format: (v: number) => (v <= 0 ? zero : String(v)) } : {}),
        onChange: (v) => onChange(v),
      });
      nf.el.classList.add('sw-num');
      return { el: nf.el, set: (v) => nf.set(Number(v)) };
    }
    case 'text': {
      const tf = textField(String(value), (v) => onChange(v), label);
      tf.el.classList.add('sw-text-input');
      tf.el.setAttribute('maxlength', String(c.maxLength));
      return { el: tf.el, set: (v) => tf.set(String(v)) };
    }
    default:
      return null;
  }
}

export interface SettingRowOptions {
  /** A control drawn by the section itself (a folder picker…). */
  control?: Node;
  /** An auxiliary line that depends on the moment (how many workers Automatic is…). */
  aux?: (s: Settings) => string | null;
  /** Options that cannot be chosen here (Native in the browser). */
  disabledOptions?: readonly (string | number)[];
  optionTip?: (o: string | number) => string | undefined;
  /** The row is shown only when this says so (the samples field only for "At N samples"). */
  visible?: (s: Settings) => boolean;
}

/** A row for one setting, kept in step with `ui.settings`. */
export function settingRow(ctx: Ctx, scope: Scope, meta: SettingMeta, o: SettingRowOptions = {}): HTMLElement {
  const key: SettingKey = meta.id;
  const s0 = ctx.ui.get().settings;
  const handle = o.control ? null : controlFor(meta, s0[key], (v) => cmd.setSetting(ctx, key, v as Settings[typeof key]), { disabledOptions: o.disabledOptions, optionTip: o.optionTip });
  // "Only in the desktop application" is never said inside it.
  const badges = [meta.newProjects ? t('set.newProjects') : null, meta.desktopOnly && !ctx.ui.get().desktop ? t('set.desktopOnly') : null].filter((x): x is string => x !== null);
  const parts = rowShell(key, { aux: meta.aux ? t(dyn(`set.${key}.aux`)) : null, control: o.control ?? handle?.el ?? null, soon: meta.comingSoon, badges });
  const reset = h('button', { type: 'button', class: 'btn-link sw-reset', 'data-tip': `${t('set.resetTip')}: ${factoryText(meta)}`, 'aria-label': `${t('set.reset')}: ${rowLabel(key)}`, onclick: () => cmd.resetOneSetting(ctx, key) }, t('set.reset'));
  parts.ctrlEl.prepend(reset);
  if (meta.comingSoon) disableAll(parts.ctrlEl);
  scope.watch(
    (_s, u) => [u.settings, u.engineInfo, u.desktop] as const,
    ([s]) => {
      handle?.set(s[key]);
      const changed = !isFactory(s, key);
      parts.el.classList.toggle('is-changed', changed);
      parts.el.dataset.changed = changed ? '1' : '0';
      reset.style.display = changed && !meta.comingSoon ? '' : 'none';
      const dot = parts.el.querySelector('.sw-dot') as HTMLElement;
      dot.setAttribute('aria-hidden', changed ? 'false' : 'true');
      dot.title = changed ? t('set.changed') : '';
      if (o.aux) {
        const a = o.aux(s);
        parts.auxEl.textContent = a ?? (meta.aux ? t(dyn(`set.${key}.aux`)) : '');
        parts.auxEl.style.display = parts.auxEl.textContent ? '' : 'none';
      }
      if (o.visible) parts.el.style.display = o.visible(s) ? '' : 'none';
    },
    (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2],
  );
  return parts.el;
}

/** A titled block of rows, a thin rule between blocks (UI.md §2.9). */
export function blockEl(id: string, title: string, ...rows: (Node | null)[]): HTMLElement {
  const titleId = `sw-b-${id}`;
  return h('section', { class: 'sw-block', 'data-block': id, 'aria-labelledby': titleId }, h('h4', { class: 'sw-block-title aux', id: titleId }, title), ...rows);
}

/** A row that only shows information (label on the left, a short text on the right, its full text as the title). */
export function infoRow(id: string, label: string, value: Node | string, aux?: string): HTMLElement {
  const parts = rowShell(id, { label, aux: aux ?? null, control: typeof value === 'string' ? h('span', { class: 'sw-value tabular', title: value }, value) : value });
  return parts.el;
}

/**
 * A row whose value is long (a folder, a sentence): stacked, the value on its own line under the label (`text`,
 * then `path` in the monospace style, broken anywhere), the buttons under it, the full text as the hover title.
 */
export function valueRow(id: string, label: string, o: { text?: string; path?: string; actions?: (Node | null)[]; aux?: string }): HTMLElement {
  const lines = [o.text ? h('span', { class: 'sw-value-text', title: o.text }, o.text) : null, o.path ? h('code', { class: 'sw-path', title: o.path, translate: 'no' }, o.path) : null].filter((x) => x !== null);
  const actions = (o.actions ?? []).filter((x): x is Node => x !== null);
  const parts = rowShell(id, { label, aux: o.aux ?? null, control: actions.length ? h('div', { class: 'sw-inline' }, ...actions) : null, stacked: true });
  parts.el.insertBefore(h('div', { class: 'sw-value-block', 'data-value': id }, ...lines), parts.ctrlEl);
  return parts.el;
}

/** The factory value of a setting, as a label (the Reset tooltip). */
export function factoryText(meta: SettingMeta): string {
  const v = defaultSettings()[meta.id];
  if (meta.control.kind === 'choice') return optionLabel(meta.id, v as string | number);
  if (meta.control.kind === 'toggle') return v ? t('common.on') : t('common.off');
  return String(v);
}
