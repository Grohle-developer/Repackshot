// The tilt and the shift of a camera in the inspector (phase O4, UI.md §2.4 Camera), the same block in the simple
// lens's Advanced optics and in the traced lens's More options: how far the plane of sharp focus turns (a slider of
// the amount), where on the image it runs away (a dial, four presets and the angle), the plane through two points of
// the product, the plane drawn in the viewport while the pointer is here or always (Show the plane), and the shift of
// the sensor. The amount and the direction are a photographer's reading of the stored `(tilt, axis)` of the lens model
// in use (core/focus-plane.ts `recedeOf`); every change goes through the store, one undo entry per drag.
//
// The shift is the camera's whichever lens it has (optics.shiftXMm / shiftYMm): a tool that solves it, as one that
// straightens the verticals, sets those two fields and these rows follow.

import type { CameraId, CameraState } from '../../core/camera';
import { recedeOf, tiltFromRecede } from '../../core/focus-plane';
import { canTilt, lensModelOf, OPTICS_LIMITS, OPTICS_NEUTRAL, opticsOf, tiltOf, withTilt, type CameraOptics } from '../../core/optics';
import * as cmd from '../commands';
import { field, newGesture, numberField, slider, toggle } from '../components/controls';
import { h, icon } from '../dom';
import type { IconName } from '../icons';
import { armTiltPick, tiltPicking } from '../lens-commands';
import { type Ctx, type Scope } from '../reactive';
import { t, type StringKey } from '../strings';

const SVG_NS = 'http://www.w3.org/2000/svg';
const DIAL = 40;

const tip = (el: HTMLElement, key: StringKey) => {
  el.setAttribute('data-tip', t(key));
  return el;
};

/** The dial of the direction the plane runs away to (degrees, 0 right, 90 up): drag it, or the arrow keys (Shift: 1°). */
function recedeDial(onChange: (deg: number, gesture: string) => void): { el: HTMLElement; set(deg: number, on: boolean): void } {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${DIAL} ${DIAL}`);
  svg.setAttribute('width', String(DIAL));
  svg.setAttribute('height', String(DIAL));
  svg.setAttribute('aria-hidden', 'true');
  const c = DIAL / 2;
  const r = c - 4;
  const ring = document.createElementNS(SVG_NS, 'circle');
  ring.setAttribute('cx', String(c));
  ring.setAttribute('cy', String(c));
  ring.setAttribute('r', String(r));
  ring.setAttribute('class', 'tilt-dial-ring');
  const needle = document.createElementNS(SVG_NS, 'line');
  needle.setAttribute('x1', String(c));
  needle.setAttribute('y1', String(c));
  needle.setAttribute('class', 'tilt-dial-needle');
  const knob = document.createElementNS(SVG_NS, 'circle');
  knob.setAttribute('r', '3.5');
  knob.setAttribute('class', 'tilt-dial-knob');
  const hub = document.createElementNS(SVG_NS, 'circle');
  hub.setAttribute('cx', String(c));
  hub.setAttribute('cy', String(c));
  hub.setAttribute('r', '1.8');
  hub.setAttribute('class', 'tilt-dial-hub');
  svg.append(ring, needle, knob, hub);
  const el = h('div', { class: 'tilt-dial', role: 'slider', tabindex: '0', 'aria-label': t('camera.tiltRecedeAngle'), 'aria-valuemin': '0', 'aria-valuemax': '359', 'data-tilt-dial': '' });
  el.appendChild(svg);
  let value = 90;
  const draw = (deg: number, on: boolean) => {
    value = deg;
    const a = (deg * Math.PI) / 180;
    const x = c + Math.cos(a) * r;
    const y = c - Math.sin(a) * r;
    needle.setAttribute('x2', x.toFixed(2));
    needle.setAttribute('y2', y.toFixed(2));
    knob.setAttribute('cx', x.toFixed(2));
    knob.setAttribute('cy', y.toFixed(2));
    el.setAttribute('aria-valuenow', String(Math.round(deg)));
    el.setAttribute('aria-valuetext', `${Math.round(deg)}°`);
    el.toggleAttribute('data-off', !on);
  };
  const angleAt = (e: PointerEvent, snap: boolean) => {
    const box = el.getBoundingClientRect();
    const deg = (Math.atan2(-(e.clientY - box.top - box.height / 2), e.clientX - box.left - box.width / 2) * 180) / Math.PI;
    const step = snap ? 15 : 1;
    return (((Math.round(deg / step) * step) % 360) + 360) % 360;
  };
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    el.focus();
    const gesture = newGesture('dial');
    el.setPointerCapture?.(e.pointerId);
    onChange(angleAt(e, e.shiftKey), gesture);
    const move = (m: PointerEvent) => onChange(angleAt(m, m.shiftKey), gesture);
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  });
  el.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 1 : 15;
    const d = e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -step : e.key === 'ArrowRight' || e.key === 'ArrowUp' ? step : 0;
    if (d === 0) return;
    e.preventDefault();
    onChange((((value + d) % 360) + 360) % 360, newGesture('dial'));
  });
  draw(90, false);
  return { el, set: draw };
}

/** The tilt and shift rows of camera `camId()`, for the lens model it has. */
export function tiltShiftFields(ctx: Ctx, scope: Scope, camId: () => CameraId): HTMLElement {
  const { store } = ctx;
  const cam = (): CameraState | undefined => store.get().camera.cameras[camId()];
  const optics = (): CameraOptics => {
    const c = cam();
    return c ? opticsOf(c) : OPTICS_NEUTRAL;
  };
  const dispatch = (next: CameraOptics, what: StringKey, gesture?: string) =>
    store.dispatch({ type: 'camera/set', id: camId(), patch: { optics: next }, gesture, label: cmd.editLabel('camera', what) });
  /** The direction kept while the amount is 0 (a tilt of 0 stores no direction a person can see). */
  let lastRecede = 90;
  const reading = (o: CameraOptics) => {
    const tl = tiltOf(o);
    const r = recedeOf(tl.deg, tl.axisDeg);
    if (r.amountDeg > 0) lastRecede = r.recedeDeg;
    return { amount: r.amountDeg, recede: r.amountDeg > 0 ? r.recedeDeg : lastRecede };
  };
  const setTilt = (amount: number, recede: number, what: StringKey, gesture?: string) => {
    lastRecede = recede;
    const s = tiltFromRecede(amount, recede);
    dispatch(withTilt(optics(), s.tiltDeg, s.axisDeg), what, gesture);
  };

  const r0 = reading(optics());
  const amount = slider({
    value: r0.amount,
    min: 0,
    max: OPTICS_LIMITS.tiltDeg.max,
    step: 0.1,
    digits: 1,
    unit: '°',
    ariaLabel: t('camera.tiltAmount'),
    onChange: (v, g) => setTilt(v, reading(optics()).recede, 'camera.tilt', g),
  });
  amount.el.setAttribute('data-tilt-amount', '');
  const dial = recedeDial((deg, g) => setTilt(reading(optics()).amount, deg, 'camera.tiltAxis', g));
  const angle = numberField({
    value: r0.recede,
    min: 0,
    max: 359,
    step: 1,
    unit: '°',
    ariaLabel: t('camera.tiltRecedeAngle'),
    onChange: (v, g) => setTilt(reading(optics()).amount, ((Math.round(v) % 360) + 360) % 360, 'camera.tiltAxis', g),
  });
  const presets: [number, IconName, StringKey][] = [
    [90, 'chevronUp', 'camera.tiltUp'],
    [270, 'chevronDown', 'camera.tiltDown'],
    [180, 'chevronLeft', 'camera.tiltLeft'],
    [0, 'chevronRight', 'camera.tiltRight'],
  ];
  const presetButtons = presets.map(([deg, ic, key]) => {
    const b = h('button', { type: 'button', class: 'icon-btn tilt-preset', 'aria-label': t(key), 'data-tip': t(key), 'data-recede': String(deg) }, icon(ic, 14)) as HTMLButtonElement;
    b.addEventListener('click', () => {
      // A preset on a plane square to the view gives it a start: a gentle tilt that way.
      const a = reading(optics()).amount;
      setTilt(a > 0 ? a : 2, deg, 'camera.tiltAxis');
    });
    return b;
  });
  const pick = h('button', { type: 'button', class: 'btn', 'data-action': 'tilt.pick', 'data-tip': t('camera.tiltPickAux'), onclick: () => armTiltPick(ctx, camId()) }, icon('target', 14), h('span', null, t('camera.tiltPick'))) as HTMLButtonElement;
  const level = h('button', { type: 'button', class: 'btn', 'data-action': 'tilt.level', 'data-tip': t('camera.tiltLevelAux'), onclick: () => setTilt(0, reading(optics()).recede, 'camera.tiltLevel') }, t('camera.tiltLevel')) as HTMLButtonElement;
  const show = toggle(ctx.ui.get().focusPlanePinned, (v) => ctx.ui.set({ focusPlanePinned: v, focusPlaneCamera: camId() }), t('camera.tiltShow'));
  show.el.setAttribute('data-tip', t('camera.tiltShowAux'));
  show.el.setAttribute('data-tilt-show', '');

  const shiftX = numberField({ value: optics().shiftXMm, min: OPTICS_LIMITS.shiftMm.min, max: OPTICS_LIMITS.shiftMm.max, step: 0.1, digits: 1, unit: 'mm', label: 'H', ariaLabel: t('camera.shiftX'), onChange: (v, g) => dispatch({ ...optics(), shiftXMm: v }, 'camera.shiftX', g) });
  const shiftY = numberField({ value: optics().shiftYMm, min: OPTICS_LIMITS.shiftMm.min, max: OPTICS_LIMITS.shiftMm.max, step: 0.1, digits: 1, unit: 'mm', label: 'V', ariaLabel: t('camera.shiftY'), onChange: (v, g) => dispatch({ ...optics(), shiftYMm: v }, 'camera.shiftY', g) });

  const cylinders = h('div', { class: 'note', 'data-tilt-cylinders': '' }, t('camera.tiltCylinders'));
  const tracedNote = h('div', { class: 'aux', 'data-tilt-traced': '' }, t('camera.tiltTracedNote'));
  const tiltRows = h(
    'div',
    { class: 'stack', 'data-tilt': '' },
    tip(field(t('camera.tiltAmount'), amount.el), 'camera.tiltAmountAux'),
    tip(field(t('camera.tiltRecede'), h('div', { class: 'tilt-recede' }, dial.el, h('div', { class: 'tilt-presets' }, ...presetButtons), angle.el)), 'camera.tiltRecedeAux'),
    h('div', { class: 'row tilt-actions' }, pick, level),
    field(t('camera.tiltShow'), show.el),
  );
  const block = h(
    'div',
    { class: 'stack', 'data-tilt-shift': '' },
    cylinders,
    tiltRows,
    tracedNote,
    tip(field(t('camera.shift'), shiftX.el, shiftY.el), 'camera.shiftAux'),
    h('div', { class: 'aux' }, t('camera.tiltNote')),
  );
  // The plane shows in the viewport while the pointer or the focus is on these rows.
  const hover = (on: boolean) => {
    if (ctx.ui.get().focusPlaneHover !== on || (on && ctx.ui.get().focusPlaneCamera !== camId())) ctx.ui.set({ focusPlaneHover: on, ...(on ? { focusPlaneCamera: camId() } : {}) });
  };
  tiltRows.addEventListener('pointerenter', () => hover(true));
  tiltRows.addEventListener('pointerleave', () => hover(tiltRows.contains(document.activeElement)));
  tiltRows.addEventListener('focusin', () => hover(true));
  tiltRows.addEventListener('focusout', (e) => hover(tiltRows.contains(e.relatedTarget as Node | null) || tiltRows.matches(':hover')));
  scope.onDispose(() => {
    if (ctx.ui.get().focusPlaneHover) ctx.ui.set({ focusPlaneHover: false });
  });

  scope.watch(
    (s, u) => [s.camera.cameras[camId()]?.optics, u.pickMode, u.focusPlanePinned] as const,
    () => {
      const o = optics();
      const r = reading(o);
      amount.set(r.amount);
      angle.set(Math.round(r.recede));
      const can = canTilt(o);
      dial.set(r.recede, r.amount > 0 && can);
      for (const [i, b] of presetButtons.entries()) b.setAttribute('aria-pressed', String(r.amount > 0 && Math.abs(((r.recede - presets[i][0] + 540) % 360) - 180) < 0.5));
      // A lens that does not tilt (the anamorphic adapter's cylinders) shows why instead of the rows.
      cylinders.style.display = can ? 'none' : '';
      tiltRows.style.display = can ? '' : 'none';
      tracedNote.style.display = lensModelOf(o) === 'traced' && can ? '' : 'none';
      level.disabled = !can || r.amount === 0;
      pick.setAttribute('aria-pressed', String(tiltPicking(ctx, camId())));
      show.set(ctx.ui.get().focusPlanePinned);
      shiftX.set(o.shiftXMm);
      shiftY.set(o.shiftYMm);
    },
    (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2],
  );
  return block;
}
