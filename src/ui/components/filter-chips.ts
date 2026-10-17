// Rows of filter chips (P6b): one row per filter, its name, All and its options; the filters combine (AND) and the
// caller decides what they leave. The plugin's recipe filters (render window) and the light catalogue's filters (L7,
// the Light section) are drawn by it. Achromatic: the chips of components.css, pressed when chosen.

import { h } from '../dom';

export interface ChipFilter {
  id: string;
  label: string;
  options: readonly { value: string; label: string; title?: string }[];
}

export interface ChipRows {
  /** One `.rw-pl-chips` row per filter, for a `.rw-pl-filters` container. */
  rows: HTMLElement[];
  /** Marks the chosen value of each filter (a filter not in `chosen` is at All). */
  set(chosen: Readonly<Record<string, string | undefined>>): void;
}

export function filterChipRows(filters: readonly ChipFilter[], allLabel: string, onPick: (filter: ChipFilter, value: string | null) => void): ChipRows {
  const buttons: { filter: string; value: string; el: HTMLButtonElement }[] = [];
  const rows = filters.map((f) => {
    const chip = (value: string | null, text: string, title?: string) => {
      const b = h('button', { type: 'button', class: 'chip rw-pl-chip', 'aria-pressed': 'false', 'data-value': value ?? '', ...(title ? { 'data-tip': title } : {}), onclick: () => onPick(f, value) }, text) as HTMLButtonElement;
      buttons.push({ filter: f.id, value: value ?? '', el: b });
      return b;
    };
    return h('div', { class: 'rw-pl-chips', role: 'group', 'aria-label': f.label, 'data-filter': f.id }, h('span', { class: 'rw-pl-chips-name aux' }, f.label), chip(null, allLabel), ...f.options.map((o) => chip(o.value, o.label, o.title)));
  });
  return {
    rows,
    set(chosen) {
      for (const b of buttons) b.el.setAttribute('aria-pressed', String((chosen[b.filter] ?? '') === b.value));
    },
  };
}
