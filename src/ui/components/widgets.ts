// Small building blocks: thumbnails, inline confirmations, tabs, floating
// menus and popovers, and the global tooltip with shortcut.

import { h, icon } from '../dom';
import type { IconName } from '../icons';
import { t } from '../strings';

// --- Thumbnails -----------------------------------------------------------

export interface ThumbProps {
  src: string | null;
  caption: string;
  active: boolean;
  sphere?: boolean;
  title?: string;
  onClick(): void;
  /** Drag payload (a material), when the thumbnail can be dragged. */
  drag?: string;
}

export function thumb(p: ThumbProps): HTMLButtonElement {
  const img = p.src ? h('img', { src: p.src, alt: '', loading: 'lazy', draggable: false }) : h('span', { class: 'thumb-ph' });
  const el = h(
    'button',
    {
      type: 'button',
      class: `thumb${p.sphere ? ' sphere' : ''}${p.active ? ' is-active' : ''}`,
      'aria-pressed': String(p.active),
      'data-tip': p.title,
      onclick: p.onClick,
      draggable: p.drag ? 'true' : undefined,
    },
    img,
    h('span', { class: 'thumb-caption' }, p.caption),
  ) as HTMLButtonElement;
  if (p.drag) {
    el.addEventListener('dragstart', (e) => {
      e.dataTransfer?.setData('application/x-repackshot-material', p.drag!);
      e.dataTransfer?.setData('text/plain', p.caption);
      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy';
    });
  }
  return el;
}

/** Replaces the image of a thumbnail once it is rendered. */
export function setThumbImage(el: HTMLElement, src: string): void {
  const ph = el.querySelector('.thumb-ph, img');
  if (ph instanceof HTMLImageElement) {
    ph.src = src;
    return;
  }
  ph?.replaceWith(h('img', { src, alt: '', draggable: false }));
}

// --- Inline confirmation --------------------------------------------------

export interface ConfirmOption {
  label: string;
  primary?: boolean;
  run(): void;
}

export interface ConfirmSpec {
  message: string;
  options: ConfirmOption[];
  /** Label of the dismiss button (default: Cancel). */
  cancelLabel?: string;
}

/** An inline confirmation in place (UI.md §4.3): two or three buttons, Esc cancels. */
export function confirmBox(spec: ConfirmSpec, onDone: () => void): HTMLElement {
  const buttons = spec.options.map((o) =>
    h(
      'button',
      {
        type: 'button',
        class: `btn${o.primary ? ' btn-primary' : ''}`,
        onclick: () => {
          onDone();
          o.run();
        },
      },
      o.label,
    ),
  );
  const cancel = h('button', { type: 'button', class: 'btn', onclick: onDone }, spec.cancelLabel ?? t('common.cancel'));
  const el = h('div', { class: 'confirm', role: 'alertdialog', 'aria-label': spec.message }, h('div', { class: 'confirm-msg' }, spec.message), h('div', { class: 'confirm-actions' }, ...buttons, cancel));
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onDone();
    }
  });
  queueMicrotask(() => (buttons[0] as HTMLButtonElement | undefined)?.focus());
  return el;
}

/** Shows a confirmation in a host element, replacing what it shows until done. */
export function showConfirmIn(host: HTMLElement, spec: ConfirmSpec): void {
  host.replaceChildren(confirmBox(spec, () => host.replaceChildren()));
}

// --- Tabs -------------------------------------------------------------------

export interface TabItem<T extends string> {
  id: T;
  label: string;
  icon?: IconName;
}

export function tabs<T extends string>(items: readonly TabItem<T>[], current: T, onChange: (id: T) => void, ariaLabel: string): HTMLElement {
  return h(
    'div',
    { class: 'tabs', role: 'tablist', 'aria-label': ariaLabel },
    items.map((it) =>
      h(
        'button',
        {
          type: 'button',
          class: 'tab',
          role: 'tab',
          'aria-selected': String(it.id === current),
          onclick: () => onChange(it.id),
        },
        it.icon ? icon(it.icon, 14) : null,
        it.label,
      ),
    ),
  );
}

// --- Floating menus and popovers --------------------------------------------

let openFloatingClose: (() => void) | null = null;

/** Opens a floating element next to an anchor. Closes on outside click or Esc. */
export function openFloating(
  anchor: HTMLElement,
  content: HTMLElement,
  opts: { align?: 'start' | 'end'; above?: boolean; onClose?: () => void } = {},
): () => void {
  openFloatingClose?.();
  const el = h('div', { class: 'floating' }, content);
  document.body.appendChild(el);
  const place = () => {
    const r = anchor.getBoundingClientRect();
    const w = el.offsetWidth;
    const hgt = el.offsetHeight;
    let left = opts.align === 'end' ? r.right - w : r.left;
    left = Math.max(8, Math.min(window.innerWidth - w - 8, left));
    let top = opts.above ? r.top - hgt - 6 : r.bottom + 6;
    if (top + hgt > window.innerHeight - 8) top = Math.max(8, r.top - hgt - 6);
    if (top < 8) top = 8;
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  };
  place();
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    el.remove();
    document.removeEventListener('pointerdown', onDown, true);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', close);
    if (openFloatingClose === close) openFloatingClose = null;
    opts.onClose?.();
  };
  const onDown = (e: PointerEvent) => {
    const target = e.target as Node;
    if (!el.contains(target) && !anchor.contains(target)) close();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
      anchor.focus();
    }
  };
  setTimeout(() => {
    if (closed) return;
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', close);
  });
  openFloatingClose = close;
  return close;
}

export function closeFloating(): void {
  openFloatingClose?.();
}

export interface MenuEntry {
  label: string;
  icon?: IconName;
  checked?: boolean;
  disabled?: boolean;
  note?: string;
  kbd?: string;
  run?(): void;
}

/** Builds menu content; `null` is a separator. */
export function menuList(entries: readonly (MenuEntry | null | { heading: string })[], close: () => void): HTMLElement {
  const el = h('div', { class: 'menu', role: 'menu' });
  for (const e of entries) {
    if (e === null) {
      el.appendChild(h('div', { class: 'menu-sep', role: 'separator' }));
      continue;
    }
    if ('heading' in e) {
      el.appendChild(h('div', { class: 'menu-label aux' }, e.heading));
      continue;
    }
    el.appendChild(
      h(
        'button',
        {
          type: 'button',
          class: 'menu-item',
          role: e.checked === undefined ? 'menuitem' : 'menuitemradio',
          'aria-checked': e.checked === undefined ? undefined : String(e.checked),
          disabled: e.disabled,
          'data-tip': e.note,
          onclick: () => {
            close();
            e.run?.();
          },
        },
        e.checked !== undefined ? h('span', { class: 'check' }, e.checked ? icon('check', 14) : null) : e.icon ? icon(e.icon, 16) : null,
        h('span', null, e.label),
        e.kbd || e.disabled ? h('span', { class: 'menu-right' }, e.disabled && e.note ? h('span', { class: 'aux' }, t('common.comingSoon')) : null, e.kbd ? h('kbd', null, e.kbd) : null) : null,
      ),
    );
  }
  return el;
}

/** Opens a menu of entries under an anchor. */
export function openMenu(anchor: HTMLElement, entries: readonly (MenuEntry | null | { heading: string })[], align: 'start' | 'end' = 'start'): void {
  let close = () => {};
  const content = menuList(entries, () => close());
  close = openFloating(anchor, content, { align });
  (content.querySelector('.menu-item:not(:disabled)') as HTMLElement | null)?.focus();
}

// --- Tooltip -----------------------------------------------------------------

/** Global tooltip for every [data-tip] element; [data-kbd] adds the shortcut. */
export function installTooltips(): () => void {
  let tip: HTMLElement | null = null;
  let timer = 0;
  let current: HTMLElement | null = null;
  const hide = () => {
    window.clearTimeout(timer);
    tip?.remove();
    tip = null;
    current = null;
  };
  const show = (el: HTMLElement) => {
    const text = el.getAttribute('data-tip');
    if (!text) return;
    const kbd = el.getAttribute('data-kbd');
    tip = h('div', { class: 'tooltip', role: 'tooltip' }, h('span', null, text), kbd ? h('kbd', null, kbd) : null);
    document.body.appendChild(tip);
    const r = el.getBoundingClientRect();
    const w = tip.offsetWidth;
    const hh = tip.offsetHeight;
    let left = r.left + r.width / 2 - w / 2;
    left = Math.max(6, Math.min(window.innerWidth - w - 6, left));
    let top = r.bottom + 6;
    if (top + hh > window.innerHeight - 6) top = r.top - hh - 6;
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
  };
  const over = (e: MouseEvent) => {
    const el = (e.target as HTMLElement | null)?.closest?.('[data-tip]') as HTMLElement | null;
    if (el === current) return;
    hide();
    if (!el) return;
    current = el;
    timer = window.setTimeout(() => current === el && show(el), 450);
  };
  document.addEventListener('mouseover', over);
  document.addEventListener('pointerdown', hide, true);
  document.addEventListener('wheel', hide, { passive: true });
  return () => {
    hide();
    document.removeEventListener('mouseover', over);
    document.removeEventListener('pointerdown', hide, true);
    document.removeEventListener('wheel', hide);
  };
}
