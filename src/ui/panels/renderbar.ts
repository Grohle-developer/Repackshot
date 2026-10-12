// Render bar (UI.md §2.5) (filled in below).

import { h } from '../dom';
import type { Ctx, Scope } from '../reactive';

export function renderBar(_ctx: Ctx, _scope: Scope): HTMLElement {
  return h('section', { class: 'bar-wrap' }, h('div', { class: 'bar' }));
}
