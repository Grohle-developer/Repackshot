// Selection by box in the viewport (UI.md §4.1): with the Select tool, a rectangle dragged over the viewport takes
// what lies inside it (left to right, a window: drawn solid) or what it touches (right to left, crossing: drawn
// dashed), at the selection level in force. Ctrl/Cmd + drag draws it in every mouse scheme (Shift adds, Alt takes
// out); where the left button is free a plain drag does too (the camera's gestures are not taken away: see
// `boxArmed` in core/box-select.ts). A drag of a few pixels is a click, Esc
// cancels, a pen is a mouse, a finger keeps orbiting. Selection is not undoable: a box is no history entry.

import { boxArmed, boxFromDrag, combineOf, isClick, type BoxCombine, type Mods } from '../../core/box-select';
import * as cmd from '../commands';
import { h } from '../dom';
import type { Ctx, Scope } from '../reactive';

export interface BoxHooks {
  /** Another gesture of the viewport (the gizmo's drag) has the pointer. */
  busy(): boolean;
  /** Client coordinates to the canvas's own. */
  local(e: { clientX: number; clientY: number }): { x: number; y: number };
  /** A press that moved too little to be a box: a click with these modifiers. */
  click(e: { clientX: number; clientY: number }, mods: Mods): void;
}

const modsOf = (e: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; altKey: boolean }): Mods => ({ shift: e.shiftKey, ctrl: e.ctrlKey, meta: e.metaKey, alt: e.altKey });

/** Wires the gesture; returns the rectangle that shows the box (an overlay of the viewport). */
export function boxSelection(ctx: Ctx, scope: Scope, vp: HTMLElement, canvas: HTMLCanvasElement, hooks: BoxHooks): HTMLElement {
  const { ui } = ctx;
  const rect = h('div', { class: 'box-select', 'aria-hidden': 'true', style: 'display:none' });
  const off = new AbortController();
  scope.onDispose(() => off.abort());
  let live: AbortController | null = null;

  vp.addEventListener(
    'pointerdown',
    (e) => {
      if (e.button !== 0 || e.target !== canvas || hooks.busy() || live) return;
      // A finger keeps orbiting; the mouse and the pen box.
      if (e.pointerType === 'touch') return;
      const u = ui.get();
      if (u.pickMode || !ctx.services.viewport) return;
      const mods = modsOf(e);
      if (!boxArmed(u.settings['viewport.mouse'], u.tool, mods)) return;
      // Taken before the camera controls see it.
      e.stopPropagation();
      e.preventDefault();
      canvas.focus({ preventScroll: true });
      begin(e, mods, combineOf(mods));
    },
    { capture: true, signal: off.signal },
  );

  const begin = (down: PointerEvent, mods: Mods, combine: BoxCombine) => {
    const stop = new AbortController();
    live = stop;
    const a = hooks.local(down);
    let moved = false;
    const finish = () => {
      stop.abort();
      live = null;
      rect.style.display = 'none';
      rect.classList.remove('is-window', 'is-crossing');
      try {
        canvas.releasePointerCapture(down.pointerId);
      } catch {
        // Not captured.
      }
    };
    try {
      canvas.setPointerCapture(down.pointerId);
    } catch {
      // Synthetic events have no active pointer to capture.
    }
    const on = { signal: stop.signal };
    window.addEventListener(
      'pointermove',
      (e) => {
        if (e.pointerId !== down.pointerId) return;
        const b = hooks.local(e);
        if (!moved && isClick(b.x - a.x, b.y - a.y)) return;
        moved = true;
        const box = boxFromDrag(a.x, a.y, b.x, b.y);
        Object.assign(rect.style, { display: '', left: `${box.rect.x0}px`, top: `${box.rect.y0}px`, width: `${box.rect.x1 - box.rect.x0}px`, height: `${box.rect.y1 - box.rect.y0}px` });
        rect.classList.toggle('is-window', box.mode === 'window');
        rect.classList.toggle('is-crossing', box.mode === 'crossing');
      },
      on,
    );
    window.addEventListener(
      'pointerup',
      (e) => {
        if (e.pointerId !== down.pointerId) return;
        const b = hooks.local(e);
        finish();
        if (!moved) {
          hooks.click(e, mods);
          return;
        }
        cmd.selectInBox(ctx, boxFromDrag(a.x, a.y, b.x, b.y), combine, { xray: ui.get().boxXray });
      },
      on,
    );
    window.addEventListener('pointercancel', (e) => e.pointerId === down.pointerId && finish(), on);
    window.addEventListener('blur', finish, on);
    // Esc cancels the box (and is not heard by anything else: it would deselect).
    window.addEventListener(
      'keydown',
      (e) => {
        if (e.key !== 'Escape') return;
        e.preventDefault();
        e.stopPropagation();
        finish();
      },
      { ...on, capture: true },
    );
  };

  return rect;
}
