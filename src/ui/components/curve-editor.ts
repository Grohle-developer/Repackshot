// The custom time curve of a clip (phase N1, UI.md §2.5 "Curva"): the curve from (0, 0) to (1, 1) drawn with its two
// handles, which are dragged (one undo entry per drag) or moved with the arrow keys (x with ← →, y with ↑ ↓; Shift:
// ten times as far). The handles' x stay within 0..1 and their y within the overshoot the curve allows
// (core/curve.ts). Achromatic: the ink of the theme.

import { bezierEase, CURVE_Y_MAX, CURVE_Y_MIN, normaliseCurve, type CurveHandles } from '../../core/curve';
import { newGesture } from './controls';
import { t } from '../strings';

const SVG_NS = 'http://www.w3.org/2000/svg';
/** The drawing: x 0..1 over 10..90, y over 80 (0) to 20 (1); the view box leaves room for the overshoot. */
const px = (x: number): number => 10 + 80 * x;
const py = (y: number): number => 80 - 60 * y;
const VIEW = { x: 0, y: py(CURVE_Y_MAX) - 4, w: 100, h: py(CURVE_Y_MIN) - py(CURVE_Y_MAX) + 8 };

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

export interface CurveEditor {
  el: SVGSVGElement;
  set(handles: CurveHandles): void;
}

/** The editor of a custom curve; `onChange` hears the handles with the gesture of the drag or key press. */
export function curveEditor(initial: CurveHandles, onChange: (handles: [number, number, number, number], gesture: string) => void): CurveEditor {
  let h = normaliseCurve(initial);
  const svg = el('svg', { viewBox: `${VIEW.x} ${VIEW.y} ${VIEW.w} ${VIEW.h}`, class: 'anim-curve anim-curve-edit', role: 'group', 'aria-label': t('anim.curveEditor') });
  const axes = el('path', { d: `M${px(0)} ${py(1)}V${py(0)}H${px(1)}`, class: 'anim-curve-axes' });
  const diag = el('path', { d: `M${px(0)} ${py(0)}L${px(1)} ${py(1)}`, class: 'anim-curve-axes anim-curve-diag' });
  const line = el('polyline', { class: 'anim-curve-line', points: '' });
  const arm1 = el('line', { class: 'anim-curve-arm' });
  const arm2 = el('line', { class: 'anim-curve-arm' });
  const knobs = [0, 1].map((i) =>
    el('circle', { r: 3.4, class: 'anim-curve-handle', tabindex: 0, role: 'slider', 'data-handle': i + 1, 'aria-label': t(i === 0 ? 'anim.handle1' : 'anim.handle2') }),
  );
  svg.append(axes, diag, line, arm1, arm2, ...knobs);

  const draw = () => {
    const pts: string[] = [];
    for (let i = 0; i <= 48; i++) {
      const x = i / 48;
      pts.push(`${px(x).toFixed(2)},${py(bezierEase(x, h)).toFixed(2)}`);
    }
    line.setAttribute('points', pts.join(' '));
    const [x1, y1, x2, y2] = h;
    for (const [arm, ax, ay, bx, by] of [
      [arm1, 0, 0, x1, y1],
      [arm2, 1, 1, x2, y2],
    ] as const) {
      arm.setAttribute('x1', String(px(ax)));
      arm.setAttribute('y1', String(py(ay)));
      arm.setAttribute('x2', String(px(bx)));
      arm.setAttribute('y2', String(py(by)));
    }
    knobs.forEach((k, i) => {
      const x = h[i * 2];
      const y = h[i * 2 + 1];
      k.setAttribute('cx', String(px(x)));
      k.setAttribute('cy', String(py(y)));
      k.setAttribute('aria-valuetext', `x ${x.toFixed(2)}, y ${y.toFixed(2)}`);
    });
  };
  const round = (v: number) => Math.round(v * 100) / 100;
  const move = (i: number, x: number, y: number, gesture: string) => {
    const next = [...h] as [number, number, number, number];
    next[i * 2] = round(x);
    next[i * 2 + 1] = round(y);
    h = normaliseCurve(next);
    draw();
    onChange([...h] as [number, number, number, number], gesture);
  };
  knobs.forEach((k, i) => {
    k.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const gesture = newGesture('curve');
      try {
        k.setPointerCapture(e.pointerId);
      } catch {
        // Synthetic events.
      }
      const at = (ev: PointerEvent) => {
        const r = svg.getBoundingClientRect();
        const vx = VIEW.x + ((ev.clientX - r.left) / Math.max(1, r.width)) * VIEW.w;
        const vy = VIEW.y + ((ev.clientY - r.top) / Math.max(1, r.height)) * VIEW.h;
        move(i, (vx - 10) / 80, (80 - vy) / 60, gesture);
      };
      const up = () => {
        k.removeEventListener('pointermove', at);
        k.removeEventListener('pointerup', up);
        k.removeEventListener('pointercancel', up);
      };
      k.addEventListener('pointermove', at);
      k.addEventListener('pointerup', up);
      k.addEventListener('pointercancel', up);
    });
    k.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? 0.1 : 0.01;
      const dx = e.key === 'ArrowRight' ? step : e.key === 'ArrowLeft' ? -step : 0;
      const dy = e.key === 'ArrowUp' ? step : e.key === 'ArrowDown' ? -step : 0;
      if (!dx && !dy) return;
      e.preventDefault();
      e.stopPropagation();
      move(i, h[i * 2] + dx, h[i * 2 + 1] + dy, newGesture('curve'));
    });
  });
  draw();
  return {
    el: svg,
    set(next) {
      const n = normaliseCurve(next);
      if (n.every((v, i) => v === h[i])) return;
      h = n;
      draw();
    },
  };
}
