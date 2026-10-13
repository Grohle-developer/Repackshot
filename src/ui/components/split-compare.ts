// Split compare (UI.md §2.8, AI-POST.md §4): any two images side by side
// under one vertical divider: A on the left of it, B on the right, the same
// zoom and pan for both, corner labels, the divider dragged with the pointer
// or moved with ← → (⇧ for bigger steps), and *Only A · Only B · Split*.
// U5 uses it in the results viewer (a result against an earlier one); X3
// reuses it for Render against AI. With only A it is a plain zoomable image.

import { h } from '../dom';
import { t } from '../strings';
import type { SplitMode } from '../ui-state';

/** What can be drawn: a decoded image, a bitmap or a canvas. */
export type SplitImage = HTMLImageElement | HTMLCanvasElement | ImageBitmap;

/** Divider steps of the arrow keys, as a fraction of the width. */
export const SPLIT_STEP = 0.01;
export const SPLIT_STEP_BIG = 0.1;

/** The divider stays inside the frame. */
export function clampSplit(pos: number): number {
  if (!Number.isFinite(pos)) return 0.5;
  return Math.max(0, Math.min(1, pos));
}

/** The divider after an arrow key (← → ; ⇧ for bigger steps); other keys leave it. */
export function stepSplit(pos: number, key: string, shift: boolean): number {
  const step = shift ? SPLIT_STEP_BIG : SPLIT_STEP;
  if (key === 'ArrowLeft') return clampSplit(Math.round((pos - step) * 1000) / 1000);
  if (key === 'ArrowRight') return clampSplit(Math.round((pos + step) * 1000) / 1000);
  if (key === 'Home') return 0;
  if (key === 'End') return 1;
  return pos;
}

/** The divider for a pointer at `x` over a frame from `left` of `width` pixels. */
export function splitAt(x: number, left: number, width: number): number {
  return clampSplit(width > 0 ? (x - left) / width : 0.5);
}

/** Zoom and pan of the images: `scale` image pixels to CSS pixels, `x y` the image's top left in the frame. */
export interface SplitView {
  scale: number;
  x: number;
  y: number;
}

/** The view that fits an image of `iw × ih` in a frame of `fw × fh`, centred (never enlarged past 100 %). */
export function fitView(iw: number, ih: number, fw: number, fh: number): SplitView {
  const scale = Math.min(1, iw > 0 && ih > 0 ? Math.min(fw / iw, fh / ih) : 1);
  return { scale, x: (fw - iw * scale) / 2, y: (fh - ih * scale) / 2 };
}

/** Zoom by `factor` about a point of the frame (the point under the cursor stays put). */
export function zoomAt(v: SplitView, factor: number, px: number, py: number, min = 0.02, max = 32): SplitView {
  const scale = Math.max(min, Math.min(max, v.scale * factor));
  const k = scale / v.scale;
  return { scale, x: px - (px - v.x) * k, y: py - (py - v.y) * k };
}

export interface SplitCompareProps {
  a: SplitImage;
  b?: SplitImage | null;
  labels?: { a: string; b: string };
  /** Texts of the three mode buttons (default: Only left · Only right · Split). */
  modeLabels?: { a: string; b: string; split: string };
  mode?: SplitMode;
  position?: number;
  onPosition?(pos: number): void;
  onMode?(mode: SplitMode): void;
  /** Called when the zoom changes (the viewer shows it). */
  onView?(v: SplitView, fitted: boolean): void;
  /** The wheel zooms and a drag pans (default). Off: a small fixed picture inside a scrolling window (the AI preview). */
  zoomable?: boolean;
}

export interface SplitCompare {
  el: HTMLElement;
  setPosition(pos: number): void;
  setMode(mode: SplitMode): void;
  /** Fit the frame, or 100 %. */
  fit(): void;
  actual(): void;
  zoom(factor: number): void;
  position(): number;
  /** Lays the images out again (after the frame changed size). */
  layout(): void;
  /** Another image on the right (an AI variant, X4b), with its label: the zoom, the pan, the divider and the mode stay. */
  setB(img: SplitImage, label?: string): void;
  destroy(): void;
}

function sizeOf(img: SplitImage): { w: number; h: number } {
  if (img instanceof HTMLImageElement) return { w: img.naturalWidth, h: img.naturalHeight };
  return { w: img.width, h: img.height };
}

/**
 * A canvas showing an image (ImageBitmaps and images become canvases so both layers scale alike);
 * with a size, the image is drawn to it (B always covers A's frame, whatever its own size).
 */
function layer(img: SplitImage, size?: { w: number; h: number }): HTMLCanvasElement {
  const own = sizeOf(img);
  if (img instanceof HTMLCanvasElement && (!size || (size.w === own.w && size.h === own.h))) return img;
  const w = size?.w ?? own.w;
  const ht = size?.h ?? own.h;
  const c = document.createElement('canvas');
  c.width = Math.max(1, w);
  c.height = Math.max(1, ht);
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
  return c;
}

export function splitCompare(p: SplitCompareProps): SplitCompare {
  const imgA = layer(p.a);
  let imgB = p.b ? layer(p.b, { w: imgA.width, h: imgA.height }) : null;
  imgA.className = 'split-img split-a';
  if (imgB) imgB.className = 'split-img split-b';
  const iw = imgA.width;
  const ih = imgA.height;
  let pos = clampSplit(p.position ?? 0.5);
  let mode: SplitMode = imgB ? (p.mode ?? 'SPLIT') : 'A';
  let view: SplitView = { scale: 1, x: 0, y: 0 };
  let fitted = true;

  const labelA = h('span', { class: 'split-label split-label-a' }, p.labels?.a ?? '');
  const labelB = h('span', { class: 'split-label split-label-b' }, p.labels?.b ?? '');
  const handle = h('div', {
    class: 'split-handle',
    role: 'slider',
    tabindex: 0,
    'aria-label': t('split.divider'),
    'aria-valuemin': 0,
    'aria-valuemax': 100,
  });
  const divider = h('div', { class: 'split-divider' }, handle);
  const stage = h('div', { class: 'split-stage' }, imgA, imgB);
  const el = h('div', { class: 'split', 'data-mode': mode }, stage, imgB ? divider : null, imgB ? labelA : null, imgB ? labelB : null);

  const modeBtns = imgB
    ? (['A', 'B', 'SPLIT'] as const).map((m) =>
        h(
          'button',
          { type: 'button', 'data-split': m, onclick: () => setMode(m) },
          m === 'A' ? (p.modeLabels?.a ?? t('split.onlyA')) : m === 'B' ? (p.modeLabels?.b ?? t('split.onlyB')) : (p.modeLabels?.split ?? t('split.split')),
        ),
      )
    : [];
  if (modeBtns.length) el.appendChild(h('div', { class: 'split-modes seg', role: 'group' }, ...modeBtns));

  const apply = () => {
    const w = el.clientWidth;
    const css = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
    imgA.style.transform = css;
    if (imgB) imgB.style.transform = css;
    el.dataset.mode = mode;
    // B shows right of the divider; in Only A / Only B one layer covers the frame.
    const cut = mode === 'SPLIT' ? pos * w : mode === 'A' ? w : 0;
    if (imgB) {
      imgB.style.clipPath = `inset(0 0 0 ${Math.max(0, (cut - view.x) / view.scale)}px)`;
      imgA.style.visibility = mode === 'B' ? 'hidden' : '';
      imgB.style.visibility = mode === 'A' ? 'hidden' : '';
    }
    divider.style.left = `${pos * 100}%`;
    divider.style.display = mode === 'SPLIT' ? '' : 'none';
    labelA.style.display = mode === 'B' ? 'none' : '';
    labelB.style.display = mode === 'A' ? 'none' : '';
    handle.setAttribute('aria-valuenow', String(Math.round(pos * 100)));
    for (const b of modeBtns) b.setAttribute('aria-pressed', String(b.dataset.split === mode));
    el.style.setProperty('--zoom-pct', String(Math.round(view.scale * 100)));
  };

  const setPosition = (v: number) => {
    const next = clampSplit(v);
    if (next === pos) return;
    pos = next;
    apply();
    p.onPosition?.(pos);
  };
  const setMode = (m: SplitMode) => {
    if (!imgB) return;
    mode = m;
    apply();
    p.onMode?.(m);
  };
  const setView = (v: SplitView, isFit: boolean) => {
    view = v;
    fitted = isFit;
    apply();
    p.onView?.(view, fitted);
  };
  const fit = () => setView(fitView(iw, ih, el.clientWidth, el.clientHeight), true);
  const actual = () => setView({ scale: 1, x: (el.clientWidth - iw) / 2, y: (el.clientHeight - ih) / 2 }, false);
  const zoom = (factor: number) => setView(zoomAt(view, factor, el.clientWidth / 2, el.clientHeight / 2), false);

  // Divider: drag anywhere on it, keys when focused.
  handle.addEventListener('keydown', (e) => {
    const next = stepSplit(pos, e.key, e.shiftKey);
    if (next === pos && e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    e.stopPropagation();
    setPosition(next);
  });
  divider.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    handle.focus();
    try {
      divider.setPointerCapture(e.pointerId);
    } catch {
      // Synthetic events.
    }
    const move = (ev: PointerEvent) => {
      const r = el.getBoundingClientRect();
      setPosition(splitAt(ev.clientX, r.left, r.width));
    };
    const up = () => {
      divider.removeEventListener('pointermove', move);
      divider.removeEventListener('pointerup', up);
      divider.removeEventListener('pointercancel', up);
    };
    divider.addEventListener('pointermove', move);
    divider.addEventListener('pointerup', up);
    divider.addEventListener('pointercancel', up);
  });

  // Zoom with the wheel about the cursor; pan by dragging the image.
  const zoomable = p.zoomable !== false;
  if (zoomable) {
    el.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const r = el.getBoundingClientRect();
        setView(zoomAt(view, Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top), false);
      },
      { passive: false },
    );
  }
  stage.addEventListener('pointerdown', (e) => {
    if (!zoomable || e.button !== 0) return;
    e.preventDefault();
    const start = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
    try {
      stage.setPointerCapture(e.pointerId);
    } catch {
      // Synthetic events.
    }
    el.classList.add('is-panning');
    const move = (ev: PointerEvent) => setView({ scale: view.scale, x: start.vx + ev.clientX - start.x, y: start.vy + ev.clientY - start.y }, false);
    const up = () => {
      el.classList.remove('is-panning');
      stage.removeEventListener('pointermove', move);
      stage.removeEventListener('pointerup', up);
      stage.removeEventListener('pointercancel', up);
    };
    stage.addEventListener('pointermove', move);
    stage.addEventListener('pointerup', up);
    stage.addEventListener('pointercancel', up);
  });

  // Fitted images refit when the frame changes size.
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => (fitted ? fit() : apply())) : null;
  ro?.observe(el);
  apply();

  return {
    el,
    setPosition,
    setMode,
    fit,
    actual,
    zoom,
    position: () => pos,
    layout: () => (fitted ? fit() : apply()),
    setB(img, label) {
      if (!imgB) return;
      const next = layer(img, { w: iw, h: ih });
      next.className = 'split-img split-b';
      stage.replaceChild(next, imgB);
      imgB = next;
      if (label !== undefined) labelB.textContent = label;
      apply();
    },
    destroy: () => ro?.disconnect(),
  };
}
