// Dragging a material with pointer events (UI.md §2.2, §2.3): from a thumbnail of the catalogue, of Mine, or the
// sphere of the material of the selection, onto a part of the viewport or a row of the tree.
//
// Not the browser's own drag and drop: that needs a native drag session, which a desktop webview does not always
// give, and it has no say over the ghost, the pen or Esc. A press that moves more than a few pixels starts the
// drag; a ghost thumbnail follows the pointer; the element under it, if it belongs to a registered drop zone, shows
// what a drop would reach; releasing drops, Esc, a lost pointer or leaving the window cancels, and a press that
// never moved is still a click (which assigns).
//
// What a drop means is not decided here (core/material-drop.ts, ui/commands.ts): a zone is given the point and the
// payload ("preset:GOLD", "library:<id>", "material:m3") and does the rest.

import { h, icon } from '../dom';
import { t } from '../strings';

/** Where the pointer is during a drag. */
export interface DragPoint {
  /** Client coordinates. */
  x: number;
  y: number;
  /** Alt (Option) is down: the drop gives a copy. */
  alt: boolean;
  /** The element under the pointer (the ghost does not count). */
  el: Element;
}

/** Somewhere a material can be dropped. */
export interface DropZone {
  /** The pointer is over the zone: show what a drop here would reach. Returns whether a drop here would do something. */
  over(p: DragPoint): boolean;
  /** The pointer left the zone, or the drag ended: remove what `over` showed. */
  leave(): void;
  /** The button was released over the zone. */
  drop(p: DragPoint, payload: string): void;
}

const zones = new Map<Element, DropZone>();

/** Makes `el` (and what is inside it) a place to drop materials. Returns the function that undoes it. */
export function registerDropZone(el: Element, zone: DropZone): () => void {
  zones.set(el, zone);
  return () => {
    if (zones.get(el) === zone) zones.delete(el);
  };
}

function zoneAt(el: Element | null): DropZone | null {
  for (let e: Element | null = el; e; e = e.parentElement) {
    const z = zones.get(e);
    if (z) return z;
  }
  return null;
}

/** Pixels the pointer must travel before a press becomes a drag (a click moves a little). */
export const DRAG_THRESHOLD = 5;

/** How far above the pointer the ghost sits, px (a little more than its height). */
const GHOST_RISE = 56;

/** The class the body wears while a drag is in progress (cursor, no text selection, no tooltips). */
export const DRAGGING_CLASS = 'is-material-drag';

interface Drag {
  pointer: number;
  x0: number;
  y0: number;
  payload: string;
  ghost: () => { src: string | null; name: string };
  started: boolean;
  ghostEl: HTMLElement | null;
  zone: DropZone | null;
  alt: boolean;
  x: number;
  y: number;
  raf: number;
  stop: AbortController;
}

let active: Drag | null = null;

/** A material is being dragged (past the threshold): other hover behaviour of the viewport stands aside. */
export function materialDragActive(): boolean {
  return active?.started === true;
}

export interface DragSourceOptions {
  /** The payload when the press starts; null: nothing to drag now. */
  payload(): string | null;
  /** The picture and name of the ghost. Default: the first image inside the element and its caption. */
  ghost?(): { src: string | null; name: string };
}

/** Makes `el` a source: pressing it and moving drags the material its payload names. */
export function dragSource(el: HTMLElement, opts: DragSourceOptions): void {
  el.setAttribute('data-drag-source', '');
  el.addEventListener('pointerdown', (e) => {
    // Mouse and pen; a finger scrolls the panel (a tap still assigns).
    if (e.button !== 0 || e.pointerType === 'touch' || active) return;
    const payload = opts.payload();
    if (!payload) return;
    begin(e, payload, opts.ghost ?? (() => defaultGhost(el)));
  });
}

function defaultGhost(el: HTMLElement): { src: string | null; name: string } {
  const img = el.querySelector('img');
  return { src: img instanceof HTMLImageElement && img.src ? img.src : null, name: el.querySelector('.thumb-caption')?.textContent ?? el.getAttribute('aria-label') ?? '' };
}

function begin(e: PointerEvent, payload: string, ghost: Drag['ghost']): void {
  const stop = new AbortController();
  const drag: Drag = { pointer: e.pointerId, x0: e.clientX, y0: e.clientY, payload, ghost, started: false, ghostEl: null, zone: null, alt: e.altKey, x: e.clientX, y: e.clientY, raf: 0, stop };
  active = drag;
  const on = { signal: stop.signal };
  window.addEventListener('pointermove', (ev) => move(drag, ev), on);
  window.addEventListener('pointerup', (ev) => release(drag, ev), on);
  window.addEventListener('pointercancel', (ev) => ev.pointerId === drag.pointer && end(drag, false), on);
  // The window lost the pointer (focus moved to another application): nothing is dropped.
  window.addEventListener('blur', () => end(drag, false), on);
  window.addEventListener('keydown', (ev) => key(drag, ev), { ...on, capture: true });
  window.addEventListener('keyup', (ev) => key(drag, ev), { ...on, capture: true });
}

function move(drag: Drag, e: PointerEvent): void {
  if (e.pointerId !== drag.pointer) return;
  drag.x = e.clientX;
  drag.y = e.clientY;
  drag.alt = e.altKey;
  if (!drag.started) {
    if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < DRAG_THRESHOLD) return;
    start(drag);
  }
  placeGhost(drag);
  // The zone is asked once per frame: the viewport's answer is a pick.
  if (!drag.raf) {
    drag.raf = requestAnimationFrame(() => {
      drag.raf = 0;
      if (active === drag) hover(drag);
    });
  }
}

function start(drag: Drag): void {
  drag.started = true;
  const g = drag.ghost();
  const pic = g.src ? h('img', { class: 'drag-ghost-pic', src: g.src, alt: '', draggable: false }) : h('span', { class: 'drag-ghost-pic' });
  const copy = h('span', { class: 'drag-ghost-copy' }, icon('plus', 12), t('drag.copy'));
  drag.ghostEl = h('div', { class: 'drag-ghost', 'aria-hidden': 'true' }, pic, g.name ? h('span', { class: 'drag-ghost-name' }, g.name) : null, copy);
  document.body.appendChild(drag.ghostEl);
  document.body.classList.add(DRAGGING_CLASS);
  document.body.dataset.drop = 'no';
}

function placeGhost(drag: Drag): void {
  if (!drag.ghostEl) return;
  // Above and to the right of the pointer: the name of the part under it (the hover label) sits below and to the right.
  drag.ghostEl.style.transform = `translate(${drag.x + 14}px, ${Math.max(4, drag.y - GHOST_RISE)}px)`;
  drag.ghostEl.classList.toggle('is-copy', drag.alt);
}

/** The point of the pointer and the zone under it. */
function aim(drag: Drag): { zone: DropZone | null; point: DragPoint | null } {
  const el = document.elementFromPoint(drag.x, drag.y);
  if (!el) return { zone: null, point: null };
  return { zone: zoneAt(el), point: { x: drag.x, y: drag.y, alt: drag.alt, el } };
}

function hover(drag: Drag): void {
  const { zone, point } = aim(drag);
  if (zone !== drag.zone) {
    drag.zone?.leave();
    drag.zone = zone;
  }
  document.body.dataset.drop = zone && point && zone.over(point) ? 'yes' : 'no';
}

function key(drag: Drag, e: KeyboardEvent): void {
  if (e.type === 'keydown' && e.key === 'Escape' && drag.started) {
    // Nothing else sees this Esc: it cancels the drag, not the selection.
    e.preventDefault();
    e.stopPropagation();
    end(drag, false);
    return;
  }
  if (e.key === 'Alt') {
    // Alt alone would open a menu in some shells.
    e.preventDefault();
    drag.alt = e.type === 'keydown';
    placeGhost(drag);
    if (drag.started && !drag.raf) hover(drag);
  }
}

function release(drag: Drag, e: PointerEvent): void {
  if (e.pointerId !== drag.pointer) return;
  drag.x = e.clientX;
  drag.y = e.clientY;
  drag.alt = e.altKey;
  end(drag, true);
}

/** Cleans up; with `drop`, hands the payload to the zone under the pointer first. */
function end(drag: Drag, drop: boolean): void {
  if (active !== drag) return;
  active = null;
  drag.stop.abort();
  cancelAnimationFrame(drag.raf);
  drag.raf = 0;
  const was = drag.started;
  let target: { zone: DropZone; point: DragPoint } | null = null;
  if (was && drop) {
    const { zone, point } = aim(drag);
    if (zone && point) target = { zone, point };
  }
  // What the zones showed goes first, so a drop starts from a clean viewport and tree.
  drag.zone?.leave();
  if (target && target.zone !== drag.zone) target.zone.leave();
  drag.zone = null;
  drag.ghostEl?.remove();
  document.body.classList.remove(DRAGGING_CLASS);
  delete document.body.dataset.drop;
  if (!was) return;
  // The click a release produces must not assign the material a second time (or at all, after a cancel).
  const swallow = (ev: Event) => {
    ev.stopPropagation();
    ev.preventDefault();
  };
  window.addEventListener('click', swallow, { capture: true, once: true });
  setTimeout(() => window.removeEventListener('click', swallow, true), 0);
  if (target) target.zone.drop(target.point, drag.payload);
}
