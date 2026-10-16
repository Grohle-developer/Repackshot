// The window of a lens's elements (phase O2b, the triage's 1.4): when the pointer rests on a lens of Camera ▸ Lens, or
// the keyboard focus is on it, a small window next to it draws its cross-section (components/lens-section.ts, the one
// drawing of a lens), its name, its source and its key numbers, all as the engine reports them for that lens
// (ui/lens-peek.ts decides what that is, and when). The window is information only: it takes no pointer and no focus,
// so it never gets between the person and the list; it closes when the pointer or the focus leaves, on Escape and when
// the lens is chosen.

import type { CameraState } from '../../core/camera';
import { cssZoom, h, placeAt } from '../dom';
import { createPeekController, lensPeekCache, peekCard, PEEK_FIGURE, type PeekAnswer, type PeekCard } from '../lens-peek';
import type { Ctx } from '../reactive';
import { t } from '../strings';

/** What an entry of the list opens: the lenses to show, and a heading when they are a character's. */
export interface PeekSpec {
  /** Catalogue keys, in the order they are drawn. */
  keys: readonly string[];
  heading?: string;
}

export interface LensPeek {
  /**
   * Makes `el` open the window: hovering it, or focusing it with the keyboard, shows `spec()` next to it. `avoid` is the
   * box the window must not cover (the open list, the inspector): it goes beside that, level with the entry.
   */
  attach(el: HTMLElement, spec: () => PeekSpec | null, avoid?: () => HTMLElement | null): void;
  /** Closes the window and cancels the one about to open (the lens was chosen, the list was drawn again). */
  dismiss(): void;
  /** Closes it and lets go of everything (the section is gone). */
  dispose(): void;
  /** The window while it is open. */
  readonly el: HTMLElement | null;
}

/** The gap between the window and what it stands beside, and to the edge of the window, px. */
const GAP = 8;
const MARGIN = 8;
/** The window's horizontal padding and the gap between its columns (components.css `.lens-peek`, `.peek-cards`), px. */
const PAD = 20;
const COLUMN_GAP = 14;

interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * Where the window goes, in pixels of the screen: beside `avoid` on the side with more room (the other when the box does
 * not fit), level with the entry, and always inside the viewport.
 */
export function placePeek(box: { width: number; height: number }, entry: Rect, avoid: Rect, view: { width: number; height: number }): { left: number; top: number } {
  const roomLeft = avoid.left - GAP - MARGIN;
  const roomRight = view.width - avoid.right - GAP - MARGIN;
  const fitsLeft = roomLeft >= box.width;
  const fitsRight = roomRight >= box.width;
  const left = fitsLeft && (!fitsRight || roomLeft >= roomRight) ? avoid.left - GAP - box.width : fitsRight ? avoid.right + GAP : roomLeft >= roomRight ? avoid.left - GAP - box.width : avoid.right + GAP;
  const top = entry.top - 6;
  return {
    left: Math.max(MARGIN, Math.min(view.width - box.width - MARGIN, left)),
    top: Math.max(MARGIN, Math.min(view.height - box.height - MARGIN, top)),
  };
}

const rectOf = (el: HTMLElement): Rect => {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
};

let serial = 0;

/** The window of one section: `camera` is the camera whose lens the list changes, read when a window opens. */
export function createLensPeek(ctx: Ctx, camera: () => CameraState | undefined): LensPeek {
  const id = `lens-peek-${++serial}`;
  const attached = new WeakMap<HTMLElement, { spec: () => PeekSpec | null; avoid?: () => HTMLElement | null }>();
  let win: HTMLElement | null = null;
  let describing: HTMLElement | null = null;
  /** Answers that arrive after the window they were asked for closed are dropped. */
  let generation = 0;

  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    // The window is dismissed, and nothing else the key would do; an open list still closes by its own handler.
    e.stopPropagation();
    controller.dismiss();
  };

  const card = (c: PeekCard): HTMLElement => {
    const figure = h('div', { class: 'peek-figure', 'data-peek': c.figure ? 'figure' : 'note' });
    if (c.figure) figure.innerHTML = c.figure;
    else figure.append(h('div', { class: 'note' }, c.note ?? ''));
    return h(
      'div',
      { class: 'peek-card', 'data-lens-key': c.key, 'data-state': c.state },
      h('div', { class: 'peek-name', 'data-peek': 'name' }, c.name),
      figure,
      h('div', { class: 'note peek-source', 'data-peek': 'source' }, c.source),
      c.numbers.length > 0 ? h('dl', { class: 'peek-numbers' }, ...c.numbers.flatMap((r) => [h('dt', { class: 'aux' }, r.label), h('dd', { 'data-value': r.id }, r.value)])) : null,
    );
  };

  const open = (target: HTMLElement) => {
    const entry = attached.get(target);
    const cam = camera();
    const spec = entry?.spec();
    if (!entry || !cam || !spec || spec.keys.length === 0 || !target.isConnected) return;
    const port = ctx.services.lens;
    const cache = port ? lensPeekCache(port) : null;
    const gen = ++generation;
    const answers = new Map<string, PeekAnswer | undefined>();
    const el = h('div', { class: 'floating lens-peek', id, role: 'tooltip', 'aria-label': t('camera.lensPeekLabel'), 'data-lens-peek': '' });
    win = el;
    describing = target;
    target.setAttribute('aria-describedby', id);
    const draw = () => {
      if (win !== el) return;
      const cards = spec.keys.map((k) => peekCard(cam, k, answers.get(k))).filter((c): c is PeekCard => c !== null);
      // Two columns of cards at most, fewer where the viewport has no room, and never taller or wider than it.
      const zoom = cssZoom(el);
      const room = (window.innerWidth - 2 * MARGIN) / zoom - PAD;
      el.style.setProperty('--peek-w', `${PEEK_FIGURE.width}px`);
      el.style.setProperty('--peek-cols', String(Math.max(1, Math.min(2, cards.length, Math.floor((room + COLUMN_GAP) / (PEEK_FIGURE.width + COLUMN_GAP))))));
      el.style.maxWidth = `${(window.innerWidth - 2 * MARGIN) / zoom}px`;
      el.style.maxHeight = `${(window.innerHeight - 2 * MARGIN) / zoom}px`;
      el.replaceChildren(...(spec.heading && cards.length > 1 ? [h('div', { class: 'aux peek-heading', 'data-peek': 'heading' }, spec.heading)] : []), h('div', { class: 'peek-cards' }, ...cards.map(card)));
      const box = el.getBoundingClientRect();
      const avoid = entry.avoid?.() ?? target;
      const at = placePeek({ width: box.width, height: box.height }, rectOf(target), rectOf(avoid), { width: window.innerWidth, height: window.innerHeight });
      placeAt(el, at.left, at.top);
    };
    document.body.appendChild(el);
    document.addEventListener('keydown', onKey, true);
    for (const key of spec.keys) {
      if (!cache) {
        // No engine at all (the page has no module and there is no launcher): the name and the source, no numbers.
        answers.set(key, { state: 'none' });
        continue;
      }
      const known = cache.known(cam, key);
      if (known) answers.set(key, known);
      else
        void cache.load(cam, key).then((a) => {
          if (gen !== generation || win !== el) return;
          answers.set(key, a);
          draw();
        });
    }
    draw();
  };

  const close = () => {
    generation++;
    document.removeEventListener('keydown', onKey, true);
    win?.remove();
    win = null;
    describing?.removeAttribute('aria-describedby');
    describing = null;
  };

  const controller = createPeekController<HTMLElement>({ onOpen: open, onClose: close });

  /** Keyboard focus opens the window; the focus a click gives does not (the pointer's rest already did, or the click chose). */
  const keyboardFocus = (el: HTMLElement) => {
    try {
      return el.matches(':focus-visible');
    } catch {
      return true;
    }
  };

  return {
    attach(el, spec, avoid) {
      attached.set(el, { spec, avoid });
      el.addEventListener('pointerenter', (e) => {
        if (e.pointerType !== 'touch') controller.enter(el);
      });
      el.addEventListener('pointerleave', () => controller.leave(el));
      el.addEventListener('focus', () => keyboardFocus(el) && controller.enter(el));
      el.addEventListener('blur', () => controller.leave(el));
      // Pressing the entry is choosing it (or filtering by it): the window has said what it had to say.
      el.addEventListener('pointerdown', () => controller.dismiss());
    },
    dismiss: () => controller.dismiss(),
    dispose: () => controller.dismiss(),
    get el() {
      return win;
    },
  };
}
