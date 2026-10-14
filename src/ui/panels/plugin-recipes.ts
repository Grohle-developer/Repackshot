// The recipe carousel of a plugin's block (Render window ▸ Plugins, ROADMAP P6 decision 8): a horizontal strip, like
// a film strip, one card a recipe — its picture above (the plugin's base picture through that recipe, made once and
// kept; a neutral placeholder until it arrives), its public name below and its category as a small label — and a
// first card for no recipe. The wheel and a trackpad scroll it sideways a card at a time, the arrow keys (and Home
// and End) choose the card beside, a click chooses one; the chosen card is outlined, the strip snaps to cards and
// fades at the end where there are more. The chrome is achromatic: colour is only inside the pictures.
//
// P6b: a slider under the strip, as wide as it, bound both ways to its scroll (dragging it scrolls the strip a card a
// step, scrolling the strip moves it: strip-math.ts), with the chosen card's place marked on it; and a card can be
// drawn as outside the filters (the chosen recipe when the filters leave it out: first, dimmed, said so).

import { h } from '../dom';
import { scrollFromScrub, scrubFromScroll, scrubMark, scrubMax } from '../strip-math';

export interface RecipeCard {
  /** The recipe's id; null: no recipe. */
  id: string | null;
  name: string;
  category: string;
  /** The chosen recipe, drawn although the filters leave it out. */
  outside?: boolean;
}

export interface RecipeStrip {
  el: HTMLElement;
  /** The cards, in order (the chosen one kept). */
  setCards(cards: readonly RecipeCard[]): void;
  /** Outlines a card (what is kept: the store's recipe), and brings it into view. */
  select(id: string | null): void;
  /** A card's picture, as an object URL the strip revokes when it is replaced or the strip goes. */
  picture(id: string | null, url: string): void;
  destroy(): void;
}

const keyOf = (id: string | null) => id ?? '';

/** Wheel lines are about this many pixels; a card is stepped once this much has been scrolled. */
const LINE_PX = 40;

export function recipeStrip(opts: { label: string; pending: string; outside: string; scrub: string; onPick(id: string | null): void }): RecipeStrip {
  const strip = h('div', { class: 'rw-pl-strip', role: 'listbox', tabindex: '0', 'aria-label': opts.label, 'aria-orientation': 'horizontal' });
  const wrap = h('div', { class: 'rw-pl-strip-wrap' }, strip);
  // The slider: a step a card, the chosen card marked on its track.
  const range = h('input', { type: 'range', class: 'rw-pl-scrub-range', min: '0', max: '0', step: '1', value: '0', 'aria-label': opts.scrub }) as HTMLInputElement;
  const mark = h('span', { class: 'rw-pl-scrub-mark', 'aria-hidden': 'true' });
  const scrub = h('div', { class: 'rw-pl-scrub' }, range, mark);
  const root = h('div', { class: 'rw-pl-carousel' }, wrap, scrub);
  let cards: RecipeCard[] = [];
  let chosen: string | null = null;
  const els = new Map<string, HTMLElement>();
  const urls = new Map<string, string>();
  let uid = Math.random().toString(36).slice(2, 8);

  const fades = () => {
    const max = strip.scrollWidth - strip.clientWidth;
    wrap.classList.toggle('fade-l', strip.scrollLeft > 1);
    wrap.classList.toggle('fade-r', max - strip.scrollLeft > 1);
  };
  /** The strip's scroll range and a card's step (its width and the gap). */
  const measure = () => {
    const first = strip.firstElementChild as HTMLElement | null;
    const gap = parseFloat(getComputedStyle(strip).columnGap || '0') || 0;
    return { maxScroll: Math.max(0, strip.scrollWidth - strip.clientWidth), step: first ? first.offsetWidth + gap : 0 };
  };
  let scrubbing = false;
  const syncScrub = () => {
    const { maxScroll, step } = measure();
    const max = scrubMax(maxScroll, step);
    range.max = String(max);
    if (!scrubbing) range.value = String(scrubFromScroll(strip.scrollLeft, maxScroll, step));
    const at = cards.findIndex((c) => keyOf(c.id) === keyOf(chosen));
    const f = scrubMark(at < 0 ? null : at, maxScroll, step);
    mark.hidden = f === null;
    if (f !== null) mark.style.setProperty('--mark', String(f));
    scrub.classList.toggle('is-idle', max === 0);
    range.disabled = max === 0;
  };
  const onScroll = () => {
    fades();
    syncScrub();
  };
  strip.addEventListener('scroll', onScroll, { passive: true });
  // Dragging (or the keys on it) scrolls the strip; the strip snaps to the card once it is let go.
  const release = () => {
    if (!scrubbing) return;
    scrubbing = false;
    strip.classList.remove('is-scrubbing');
    syncScrub();
  };
  range.addEventListener('input', () => {
    scrubbing = true;
    strip.classList.add('is-scrubbing');
    const { maxScroll, step } = measure();
    strip.scrollLeft = scrollFromScrub(Number(range.value), maxScroll, step);
    fades();
  });
  range.addEventListener('change', release);
  range.addEventListener('pointerup', release);
  range.addEventListener('blur', release);
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(onScroll) : null;
  ro?.observe(strip);

  const cardEl = (c: RecipeCard): HTMLElement => {
    const k = keyOf(c.id);
    const url = urls.get(k);
    const thumb = h('div', { class: `rw-pl-thumb${url ? '' : ' is-empty'}`, title: url ? null : opts.pending }, url ? h('img', { src: url, alt: '', width: 160, height: 100, draggable: 'false' }) : null);
    const el = h(
      'div',
      { class: `rw-pl-card${c.outside ? ' is-outside' : ''}`, role: 'option', id: `rw-pl-${uid}-${els.size}`, 'aria-selected': 'false', 'data-recipe': k, onclick: () => opts.onPick(c.id) },
      thumb,
      h('div', { class: 'rw-pl-card-name' }, c.name),
      h('div', { class: 'rw-pl-card-cat aux' }, c.outside ? opts.outside : c.category),
    );
    return el;
  };

  const markChosen = () => {
    for (const [k, el] of els) el.setAttribute('aria-selected', k === keyOf(chosen) ? 'true' : 'false');
    const el = els.get(keyOf(chosen));
    if (el) strip.setAttribute('aria-activedescendant', el.id);
    else strip.removeAttribute('aria-activedescendant');
  };

  const reveal = () => {
    const el = els.get(keyOf(chosen));
    if (!el || strip.clientWidth === 0) return;
    const left = el.offsetLeft - strip.offsetLeft;
    const right = left + el.offsetWidth;
    if (left < strip.scrollLeft) strip.scrollLeft = left;
    else if (right > strip.scrollLeft + strip.clientWidth) strip.scrollLeft = right - strip.clientWidth;
  };

  // Up and down too: the strip is the one list here, and a person reaching for the keys may try either.
  strip.addEventListener('keydown', (e) => {
    if (cards.length === 0) return;
    const at = Math.max(0, cards.findIndex((c) => keyOf(c.id) === keyOf(chosen)));
    const to = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? at + 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? at - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? cards.length - 1 : null;
    if (to === null) return;
    e.preventDefault();
    const next = cards[Math.max(0, Math.min(cards.length - 1, to))];
    if (keyOf(next.id) !== keyOf(chosen)) opts.onPick(next.id);
  });

  // A vertical wheel scrolls sideways, a card a step; at an end it is the page's again.
  let acc = 0;
  strip.addEventListener(
    'wheel',
    (e) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      const d = e.deltaY * (e.deltaMode === 1 ? LINE_PX : e.deltaMode === 2 ? strip.clientWidth : 1);
      const max = strip.scrollWidth - strip.clientWidth;
      if ((d < 0 && strip.scrollLeft <= 0) || (d > 0 && strip.scrollLeft >= max - 1)) return;
      e.preventDefault();
      acc += d;
      if (Math.abs(acc) < LINE_PX) return;
      const first = strip.firstElementChild as HTMLElement | null;
      const step = first ? first.offsetWidth + parseFloat(getComputedStyle(strip).columnGap || '0') : LINE_PX;
      strip.scrollBy({ left: Math.sign(acc) * Math.max(step, Math.abs(acc) >= 3 * step ? Math.abs(acc) : step) });
      acc = 0;
    },
    { passive: false },
  );

  return {
    el: root,
    setCards(next) {
      cards = [...next];
      els.clear();
      uid = Math.random().toString(36).slice(2, 8);
      strip.replaceChildren(
        ...cards.map((c) => {
          const el = cardEl(c);
          els.set(keyOf(c.id), el);
          return el;
        }),
      );
      markChosen();
      requestAnimationFrame(() => {
        reveal();
        fades();
        syncScrub();
      });
    },
    select(id) {
      chosen = id;
      markChosen();
      reveal();
      syncScrub();
    },
    picture(id, url) {
      const k = keyOf(id);
      const was = urls.get(k);
      if (was && was !== url) URL.revokeObjectURL(was);
      urls.set(k, url);
      const el = els.get(k);
      const thumb = el?.querySelector('.rw-pl-thumb');
      if (thumb) {
        thumb.classList.remove('is-empty');
        thumb.removeAttribute('title');
        thumb.replaceChildren(h('img', { src: url, alt: '', width: 160, height: 100, draggable: 'false' }));
      }
    },
    destroy() {
      ro?.disconnect();
      for (const u of urls.values()) URL.revokeObjectURL(u);
      urls.clear();
    },
  };
}
