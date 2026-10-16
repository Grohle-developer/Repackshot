// A list to pick one entry from that is drawn by the interface instead of the browser (phase O2b): the closed control
// is a select's twin (same frame, same caret), and the open list is the interface's own menu (widgets.ts), whose
// entries are elements of the page that can be hovered and focused. A native select's entries are drawn by the system
// and tell the page nothing until one is chosen, which is why the lens list is this: the window of a lens's elements
// (components/lens-peek.ts) opens from the entry the pointer rests on. Up and Down move between the entries, Enter
// chooses, Escape closes and gives the focus back to the control.

import { h } from '../dom';
import type { Control, SelectOption } from './controls';
import { menuList, openFloating } from './widgets';

export interface PickMenuHooks {
  /** Called for every entry of the list as it opens: where the caller wires what the entry does on hover and focus. */
  entry?(el: HTMLElement, option: SelectOption, list: HTMLElement): void;
  /** The list closed (an entry chosen, Escape, a click outside). */
  onClose?(): void;
}

export interface PickMenu extends Control<string> {
  el: HTMLButtonElement;
  /** Closes the list if it is open. */
  close(): void;
  readonly isOpen: boolean;
}

/**
 * The control: it shows the label of the entry whose value is `current` (`placeholder` when none is, as a select's
 * disabled first option did) and opens the list on a click, Enter, Space or the Down and Up arrows.
 */
export function pickMenu(options: readonly SelectOption[], current: string, onChange: (v: string) => void, ariaLabel: string, placeholder = '', hooks: PickMenuHooks = {}): PickMenu {
  let value = current;
  let closeList: (() => void) | null = null;
  const text = h('span', { class: 'select-text' });
  const el = h('button', { type: 'button', class: 'select select-button', 'aria-haspopup': 'menu', 'aria-expanded': 'false' }, text);
  const show = () => {
    const shown = options.find((o) => o.value === value)?.label ?? placeholder;
    text.textContent = shown;
    el.setAttribute('aria-label', shown ? `${ariaLabel}: ${shown}` : ariaLabel);
    el.setAttribute('data-value', value);
  };
  show();

  const openList = () => {
    if (closeList) return;
    const list = menuList(
      options.map((o) => ({
        label: o.label,
        checked: o.value === value,
        disabled: o.disabled,
        run: () => {
          // The control gets the focus back before the choice: whoever redraws it takes the focus with it.
          el.focus();
          onChange(o.value);
        },
      })),
      () => closeList?.(),
    );
    list.style.minWidth = `${el.offsetWidth}px`;
    const items = [...list.querySelectorAll<HTMLElement>('.menu-item')];
    items.forEach((item, i) => {
      item.setAttribute('data-value', options[i].value);
      hooks.entry?.(item, options[i], list);
    });
    el.setAttribute('aria-expanded', 'true');
    closeList = openFloating(el, list, {
      align: 'start',
      onClose: () => {
        closeList = null;
        el.setAttribute('aria-expanded', 'false');
        hooks.onClose?.();
      },
    });
    (list.querySelector<HTMLElement>('[aria-checked="true"]:not(:disabled)') ?? list.querySelector<HTMLElement>('.menu-item:not(:disabled)'))?.focus();
  };

  el.addEventListener('click', () => (closeList ? closeList() : openList()));
  el.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    openList();
  });
  return {
    el,
    set(v) {
      value = v;
      show();
    },
    close: () => closeList?.(),
    get isOpen() {
      return closeList !== null;
    },
  };
}
