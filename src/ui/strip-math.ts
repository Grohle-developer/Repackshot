// The recipe carousel's slider (P6b), as arithmetic: the slider under the strip steps through the strip's snap
// positions — one per card, the first card at each, and the last one the strip's end — so dragging it scrolls a card
// at a time (the strip snaps to cards) and scrolling the strip moves it; the chosen card is marked on it. No DOM: the
// strip gives its scroll range (`scrollWidth - clientWidth`) and a card's step (its width and the gap).

/** The slider's last value: the number of card steps the strip can scroll, the strip's end counted as one. */
export function scrubMax(maxScroll: number, step: number): number {
  if (!(maxScroll > 0) || !(step > 0)) return 0;
  return Math.ceil(maxScroll / step - 1e-6);
}

/** Where the slider is for a scroll position: the nearest card's step, the last value at the strip's end. */
export function scrubFromScroll(scrollLeft: number, maxScroll: number, step: number): number {
  const max = scrubMax(maxScroll, step);
  if (max === 0) return 0;
  if (scrollLeft >= maxScroll - 0.5) return max;
  return Math.max(0, Math.min(max, Math.round(scrollLeft / step)));
}

/** The scroll position of a slider value: its card's start, or the strip's end for the last value. */
export function scrollFromScrub(value: number, maxScroll: number, step: number): number {
  const max = scrubMax(maxScroll, step);
  if (max === 0) return 0;
  // The last value's card start is past the end (the max is rounded up): the end, then.
  return Math.min(maxScroll, Math.max(0, Math.min(max, Math.round(value))) * step);
}

/**
 * Where the chosen card (its place among the cards shown, from 0) is marked on the slider, from 0 at its left end
 * to 1 at its right: the slider value that brings the card to the strip's start, or the end for a card the strip
 * shows only once it has scrolled all the way. Null when no card is chosen among those shown.
 */
export function scrubMark(index: number | null, maxScroll: number, step: number): number | null {
  if (index === null || index < 0) return null;
  const max = scrubMax(maxScroll, step);
  if (max === 0) return 0;
  return Math.min(max, index) / max;
}
