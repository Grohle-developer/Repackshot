// The guided tour's overlay (phase U10, UI.md §4.7): a layer over the whole application that dims everything but the
// area the step talks about, rings it, and puts a card with a short text beside it. Next · Back · Skip, progress
// dots, and the keyboard (→ ← Esc). It is modal: the layer takes the pointer and the keys, so nothing under it
// changes while it is up. Its steps, its rules and the commands that move it are in ui/tour.ts.
//
// The area is looked for on every frame (the interface moves under it: a panel opens, a window is dragged, the
// window is resized), and a step whose area never appears is skipped in the direction the person was going.

import { h, placeAt } from '../dom';
import type { Ctx, Scope } from '../reactive';
import { t } from '../strings';
import { applyStage, endTour, findTarget, goToStep, placeCard, stepWords, tourBack, tourKeyAction, tourNext, tourSteps, type Box, type TourStep } from '../tour';

/** How long a step waits for its area to appear before it is skipped. */
const WAIT_MS = 700;
/** The ring's room around the area, and the width of the ring itself. */
const PAD = 4;
const RING = 4;

/** The part of an element that is on screen: its box cut by every ancestor that clips (a scrolled panel, a window). */
export function visibleBox(el: HTMLElement): Box | null {
  const r = el.getBoundingClientRect();
  let x0 = r.left;
  let y0 = r.top;
  let x1 = r.right;
  let y1 = r.bottom;
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    const s = getComputedStyle(p);
    if (s.overflowX === 'visible' && s.overflowY === 'visible') continue;
    const b = p.getBoundingClientRect();
    x0 = Math.max(x0, b.left);
    y0 = Math.max(y0, b.top);
    x1 = Math.min(x1, b.right);
    y1 = Math.min(y1, b.bottom);
  }
  x0 = Math.max(0, x0);
  y0 = Math.max(0, y0);
  x1 = Math.min(window.innerWidth, x1);
  y1 = Math.min(window.innerHeight, y1);
  return x1 - x0 < 1 || y1 - y0 < 1 ? null : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** What a person presses or types in: where the card must not sit when it has to go over an area. */
const CONTROLS = 'button, input, select, textarea, a[href], summary, [role="switch"], [role="spinbutton"], [role="option"], [role="tab"], [tabindex="0"]';

/** The boxes of the controls that are on screen inside an element (the tour's own are not among them). */
export function controlBoxes(root: HTMLElement): Box[] {
  const out: Box[] = [];
  for (const el of root.querySelectorAll<HTMLElement>(CONTROLS)) {
    if (el.closest('.tour')) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    out.push({ x: r.left, y: r.top, w: r.width, h: r.height });
  }
  return out;
}

export function tourOverlay(ctx: Ctx, scope: Scope): HTMLElement {
  const { ui } = ctx;
  const root = h('div', { class: 'tour is-center', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('tour.label'), 'data-tour': '' });
  const shield = h('div', { class: 'tour-shield' });
  const spot = h('div', { class: 'tour-spot', 'aria-hidden': 'true' });
  const count = h('div', { class: 'tour-count', 'aria-hidden': 'true' });
  const title = h('h2', { class: 'tour-title' });
  const text = h('p', { class: 'tour-text' });
  const dots = h('div', { class: 'tour-dots', role: 'img' });
  const skipBtn = h('button', { type: 'button', class: 'btn tour-skip', 'data-tour-skip': '', onclick: () => endTour(ctx) }, t('tour.skip'));
  const backBtn = h('button', { type: 'button', class: 'btn', 'data-tour-back': '', onclick: () => tourBack(ctx) }, t('tour.back'));
  const nextBtn = h('button', { type: 'button', class: 'btn btn-primary', 'data-tour-next': '', onclick: () => tourNext(ctx) });
  const card = h(
    'div',
    { class: 'tour-card', 'aria-live': 'polite' },
    count,
    title,
    text,
    dots,
    h('div', { class: 'tour-actions' }, skipBtn, h('span', { style: 'flex:1' }), backBtn, nextBtn),
    h('div', { class: 'tour-keys' }, t('tour.keys')),
  );
  root.append(shield, spot, card);

  let current: TourStep | null = null;
  let index = 0;
  let direction: 1 | -1 = 1;
  let shownAt = 0;
  let scrolled = false;
  let skipped = false;
  let last = '';
  let raf = 0;

  // ------------------------------------------------------------------ the step on the card
  const show = (i: number) => {
    const steps = tourSteps(ctx);
    const step = steps[i];
    if (!step) return;
    direction = i < index ? -1 : 1;
    index = i;
    current = step;
    shownAt = performance.now();
    scrolled = false;
    skipped = false;
    last = '';
    const words = stepWords(step);
    title.textContent = words.title;
    text.textContent = words.text;
    count.textContent = t('tour.step', { n: i + 1, total: steps.length });
    dots.setAttribute('aria-label', t('tour.dots', { n: i + 1, total: steps.length }));
    dots.replaceChildren(...steps.map((s, k) => h('span', { class: `tour-dot${k < i ? ' is-done' : ''}${k === i ? ' is-on' : ''}`, 'data-step': s.id })));
    const lastStep = i === steps.length - 1;
    nextBtn.textContent = lastStep ? t('tour.finish') : t('tour.next');
    backBtn.disabled = i === 0;
    skipBtn.style.visibility = lastStep ? 'hidden' : '';
    root.dataset.step = step.id;
    root.dataset.target = '';
    if (step.targets.length === 0) {
      spot.style.display = 'none';
      place(null);
    }
    nextBtn.focus({ preventScroll: true });
  };

  // ------------------------------------------------------------------ the ring and the card
  const place = (area: Box | null, avoid: Box | null = null, controls?: () => Box[]) => {
    const key = area ? `${area.x}|${area.y}|${area.w}|${area.h}` : 'center';
    const box = card.getBoundingClientRect();
    const full = `${key}|${avoid ? `${avoid.x}|${avoid.y}|${avoid.w}|${avoid.h}` : ''}|${box.width}|${box.height}|${window.innerWidth}|${window.innerHeight}`;
    if (full === last) return;
    last = full;
    root.classList.toggle('is-center', area === null);
    if (area) {
      // The ring (white inside, black outside: 4 px in all) stays inside the window, so it is seen on every side.
      const x = Math.max(RING, area.x - PAD);
      const y = Math.max(RING, area.y - PAD);
      Object.assign(spot.style, {
        display: '',
        left: `${x}px`,
        top: `${y}px`,
        width: `${Math.min(window.innerWidth - RING, area.x + area.w + PAD) - x}px`,
        height: `${Math.min(window.innerHeight - RING, area.y + area.h + PAD) - y}px`,
      });
    }
    const at = placeCard(area, { w: box.width, h: box.height }, { w: window.innerWidth, h: window.innerHeight }, avoid, undefined, undefined, controls);
    placeAt(card, at.x, at.y);
    root.dataset.place = at.where;
  };

  const skipStep = () => {
    if (skipped || !current) return;
    skipped = true;
    // Forwards past the last step ends the tour; backwards stops at the first, which has no area to miss.
    if (direction === 1) {
      if (index >= tourSteps(ctx).length - 1) endTour(ctx);
      else goToStep(ctx, index + 1);
    } else goToStep(ctx, Math.max(0, index - 1));
  };

  const tick = (now: number) => {
    raf = requestAnimationFrame(tick);
    const step = current;
    if (!step || step.targets.length === 0) {
      if (step) place(null);
      return;
    }
    const target = findTarget(step);
    if (!target) {
      // Not there (yet): the screen stays dimmed, and after a moment the step is skipped.
      spot.style.display = 'none';
      root.classList.add('is-center');
      last = '';
      if (now - shownAt > WAIT_MS) skipStep();
      return;
    }
    // An area inside a scrolled panel or window is brought into view once, and measured on the next frame.
    if (!scrolled) {
      scrolled = true;
      if (target.closest('.side-scroll, .rw-body, .sw-content')) {
        target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        return;
      }
    }
    root.dataset.target = target.getAttribute('data-guide') ?? '';
    // An area inside a window (the render window, Settings) is talked about from outside it when there is room.
    const win = target.closest<HTMLElement>('.rw, .sw');
    const wb = win && win !== target ? win.getBoundingClientRect() : null;
    place(visibleBox(target), wb ? { x: wb.left, y: wb.top, w: wb.width, h: wb.height } : null, () => controlBoxes(win ?? target));
  };

  // ------------------------------------------------------------------ keys: the tour owns them all
  const onKey = (e: KeyboardEvent) => {
    if (e.isComposing) return;
    const action = tourKeyAction(e);
    if (action) {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (action === 'next') tourNext(ctx);
      else if (action === 'back') tourBack(ctx);
      else endTour(ctx);
      return;
    }
    if (e.key === 'Tab') {
      // Focus stays on the card's buttons.
      e.stopImmediatePropagation();
      const order = [skipBtn, backBtn, nextBtn].filter((b) => !b.disabled && b.style.visibility !== 'hidden');
      if (order.length === 0) return;
      const at = order.indexOf(document.activeElement as HTMLButtonElement);
      e.preventDefault();
      order[at < 0 ? 0 : (at + (e.shiftKey ? order.length - 1 : 1)) % order.length].focus({ preventScroll: true });
      return;
    }
    // Enter and Space press the focused button (the default action); anywhere else Enter goes on. Every other key is
    // swallowed so that no shortcut of the application runs under the tour.
    e.stopImmediatePropagation();
    if ((e.key === 'Enter' || e.key === ' ') && !(e.target instanceof HTMLButtonElement)) {
      e.preventDefault();
      tourNext(ctx);
    }
  };
  window.addEventListener('keydown', onKey, true);
  const keepFocus = (e: FocusEvent) => {
    if (!root.contains(e.target as Node)) nextBtn.focus({ preventScroll: true });
  };
  document.addEventListener('focusin', keepFocus);
  // A window that changes size may change which panels are drawers: the step puts its area on screen again.
  const onResize = () => applyStage(ctx, current?.stage);
  window.addEventListener('resize', onResize);
  // The layer owns the pointer: nothing under it is clicked, dragged or scrolled.
  for (const type of ['pointerdown', 'mousedown', 'click', 'wheel', 'contextmenu'] as const) {
    shield.addEventListener(type, (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
  }

  scope.onDispose(() => {
    cancelAnimationFrame(raf);
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', onResize);
    document.removeEventListener('focusin', keepFocus);
  });
  scope.watch((_s, u) => u.tour?.step ?? -1, (i) => i >= 0 && show(i));
  raf = requestAnimationFrame(tick);
  void ui;
  return root;
}
