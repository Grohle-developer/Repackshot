// Collapsible inspector section with a remembered state (UI.md §2.4).

import { h, icon } from '../dom';
import type { Ctx } from '../reactive';

export function section(ctx: Ctx, id: string, title: string, body: Node, extra?: Node | null, defaultCollapsed = false): HTMLElement {
  const collapsed = ctx.ui.get().sections[id] ?? defaultCollapsed;
  const chevron = h('span', null, icon(collapsed ? 'chevronRight' : 'chevronDown', 14));
  const head = h(
    'button',
    { type: 'button', class: 'section-head', 'aria-expanded': String(!collapsed) },
    chevron,
    h('span', null, title),
    extra ? h('span', { class: 'section-extra' }, extra) : null,
  );
  const el = h('section', { class: 'section', 'data-section': id }, head, h('div', { class: 'section-body' }, body));
  if (collapsed) el.setAttribute('data-collapsed', '');
  head.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('.section-extra button')) return;
    const now = !el.hasAttribute('data-collapsed');
    el.toggleAttribute('data-collapsed', now);
    head.setAttribute('aria-expanded', String(!now));
    chevron.replaceChildren(icon(now ? 'chevronRight' : 'chevronDown', 14));
    ctx.ui.set({ sections: { ...ctx.ui.get().sections, [id]: now } });
  });
  return el;
}
