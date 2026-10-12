// Status bar (UI.md §2.6) (filled in below).

import { h } from '../dom';
import type { Ctx, Scope } from '../reactive';

export function statusBar(_ctx: Ctx, _scope: Scope): HTMLElement {
  return h('footer', { class: 'status' });
}
