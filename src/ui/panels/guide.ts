// Guide (UI.md §4.6): a three-line strip above the inspector with the current
// step and an arrow pointing at the control it talks about, without hiding
// or moving anything.

import { h } from '../dom';
import type { Ctx, Scope } from '../reactive';
import { t, type StringKey } from '../strings';

/** The control each step points at ([data-guide] values). */
export const GUIDE_TARGETS = ['empty-actions', 'product-type', 'material', 'setups', 'camera', 'render'] as const;

const SVG_NS = 'http://www.w3.org/2000/svg';

export function guideStrip(ctx: Ctx, scope: Scope): HTMLElement {
  const { ui } = ctx;
  const host = h('div', { class: 'guide-host' });
  let arrow: SVGSVGElement | null = null;
  let raf = 0;

  const removeArrow = () => {
    cancelAnimationFrame(raf);
    arrow?.remove();
    arrow = null;
  };

  const drawArrow = (from: HTMLElement, step: number) => {
    removeArrow();
    arrow = document.createElementNS(SVG_NS, 'svg');
    arrow.setAttribute('class', 'guide-arrow');
    arrow.setAttribute('aria-hidden', 'true');
    document.body.appendChild(arrow);
    const line = document.createElementNS(SVG_NS, 'path');
    const head = document.createElementNS(SVG_NS, 'path');
    arrow.append(line, head);
    const tick = () => {
      const target = [...document.querySelectorAll<HTMLElement>(`[data-guide="${GUIDE_TARGETS[step]}"]`)].find((el) => el.offsetParent !== null);
      if (!arrow) return;
      if (!target) {
        arrow.style.display = 'none';
      } else {
        arrow.style.display = '';
        const a = from.getBoundingClientRect();
        const b = target.getBoundingClientRect();
        const x1 = a.left + 18;
        const y1 = a.bottom - 4;
        const tx = Math.max(b.left + 8, Math.min(b.right - 8, x1));
        const ty = b.top > y1 ? b.top - 4 : b.bottom + 4;
        const tx2 = b.right < x1 ? b.right + 4 : b.left > x1 ? b.left - 4 : tx;
        const ex = b.top > y1 || b.bottom < a.top ? tx : tx2;
        const ey = b.top > y1 || b.bottom < a.top ? ty : (b.top + b.bottom) / 2;
        const mx = (x1 + ex) / 2;
        line.setAttribute('d', `M${x1},${y1} Q${mx},${Math.min(y1, ey) - 30} ${ex},${ey}`);
        const ang = Math.atan2(ey - (Math.min(y1, ey) - 30), ex - mx);
        const s = 9;
        head.setAttribute(
          'd',
          `M${ex - s * Math.cos(ang - 0.45)},${ey - s * Math.sin(ang - 0.45)} L${ex},${ey} L${ex - s * Math.cos(ang + 0.45)},${ey - s * Math.sin(ang + 0.45)}`,
        );
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
  };

  scope.watch(
    (_s, u) => u.guideStep,
    (step) => {
      removeArrow();
      host.replaceChildren();
      if (step === null) return;
      const total = GUIDE_TARGETS.length;
      const last = step >= total - 1;
      const strip = h(
        'div',
        { class: 'guide', role: 'status' },
        h('div', { class: 'aux' }, t('guide.step', { n: step + 1, total })),
        h('div', { class: 'guide-text' }, t(`guide.${step + 1}` as StringKey)),
        h(
          'div',
          { class: 'row' },
          h('button', { type: 'button', class: 'btn btn-primary', onclick: () => ui.set({ guideStep: last ? null : step + 1 }) }, last ? t('guide.done') : t('common.next')),
          h('button', { type: 'button', class: 'btn', onclick: () => ui.set({ guideStep: null }) }, t('common.close')),
        ),
      );
      host.appendChild(strip);
      requestAnimationFrame(() => drawArrow(strip, step));
    },
  );
  scope.onDispose(removeArrow);
  return host;
}
