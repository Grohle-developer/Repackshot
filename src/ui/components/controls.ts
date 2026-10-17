// Form controls: NumberField (scrubbable, units, keyboard, one undo entry
// per drag), Slider, Segmented, Toggle, Select, ColorField, TextField.

import { UNIT_TO_MM } from '../../core/import-options';
import type { LengthUnit } from '../../core/settings';
import { formatNumber, getLang, t, type StringKey } from '../strings';
import { h, hexToLinear, linearToHex } from '../dom';

let gestureCounter = 0;
/** A fresh gesture token: actions carrying it collapse into one undo entry. */
export function newGesture(prefix = 'g'): string {
  return `${prefix}${++gestureCounter}`;
}

export interface Control<T> {
  el: HTMLElement;
  set(value: T): void;
}

export interface NumberFieldProps {
  value: number;
  min?: number;
  max?: number;
  /** Step of the arrow keys; also the drag sensitivity for unbounded fields. */
  step?: number;
  unit?: string;
  /** Unit written before the value (f/). */
  prefix?: string;
  digits?: number;
  /** Small inline label (X, Y, Z). */
  label?: string;
  ariaLabel?: string;
  disabled?: boolean;
  /** Draw a thin bar for where the value sits between min and max. */
  fill?: boolean;
  /** Custom display of the value (the field still edits the raw number). */
  format?: (value: number) => string;
  /** Called on every change with the gesture token of the drag / edit. */
  onChange(value: number, gesture: string): void;
  /** A drag began / ended: what is costly to redo (the AI preview) waits for the release. */
  onHold?(): void;
  onRelease?(): void;
}

function clampTo(v: number, min?: number, max?: number): number {
  if (min !== undefined && v < min) v = min;
  if (max !== undefined && v > max) v = max;
  return v;
}

function roundTo(v: number, step: number): number {
  const decimals = Math.max(0, Math.min(6, Math.ceil(-Math.log10(step)) + 1));
  const k = 10 ** decimals;
  return Math.round(v * k) / k;
}

/**
 * One numeric field (UI.md §4.4): drag horizontally to change (Shift fine,
 * Ctrl coarse), arrows ±1 step, double click or Enter to type, Enter
 * confirms, Esc restores. A drag is one gesture: one undo entry.
 */
export function numberField(p: NumberFieldProps): Control<number> {
  let value = p.value;
  const step = p.step ?? 1;
  const digits = p.digits ?? (step >= 1 ? 0 : step >= 0.1 ? 1 : 2);
  const valueEl = h('span', { class: 'num-value' });
  const fillEl = p.fill && p.min !== undefined && p.max !== undefined ? h('span', { class: 'num-fill' }) : null;
  const el = h(
    'div',
    {
      class: `num${p.disabled ? ' is-disabled' : ''}`,
      tabindex: p.disabled ? -1 : 0,
      role: 'spinbutton',
      'aria-label': p.ariaLabel ?? p.label ?? '',
      'aria-valuemin': p.min,
      'aria-valuemax': p.max,
    },
    p.label ? h('span', { class: 'num-label' }, p.label) : null,
    p.prefix ? h('span', { class: 'num-unit', style: 'margin:0 3px 0 0' }, p.prefix) : null,
    valueEl,
    p.unit ? h('span', { class: 'num-unit' }, p.unit) : null,
    fillEl,
  );
  const render = () => {
    valueEl.textContent = p.format ? p.format(value) : formatNumber(value, getLang(), digits);
    el.setAttribute('aria-valuenow', String(value));
    if (fillEl && p.min !== undefined && p.max !== undefined) {
      fillEl.style.width = `${(100 * (value - p.min)) / (p.max - p.min || 1)}%`;
    }
  };
  render();

  const commit = (v: number, gesture: string) => {
    const next = clampTo(roundTo(v, step / 10), p.min, p.max);
    if (next === value) return;
    value = next;
    render();
    p.onChange(value, gesture);
  };

  let editing: HTMLInputElement | null = null;
  const startEdit = () => {
    if (p.disabled || editing) return;
    el.classList.add('is-editing');
    const input = h('input', { type: 'text', value: String(value), 'aria-label': p.ariaLabel ?? p.label ?? '' }) as HTMLInputElement;
    editing = input;
    el.appendChild(input);
    input.focus();
    input.select();
    const gesture = newGesture('edit');
    const finish = (ok: boolean) => {
      if (!editing) return;
      const text = input.value.replace(',', '.').trim();
      editing = null;
      input.remove();
      el.classList.remove('is-editing');
      if (ok) {
        const v = Number(text);
        if (text !== '' && Number.isFinite(v)) commit(v, gesture);
      }
      el.focus();
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') finish(true);
      else if (e.key === 'Escape') finish(false);
    });
    input.addEventListener('blur', () => finish(true));
  };

  // Drag to scrub.
  let drag: { x: number; start: number; moved: boolean; gesture: string; acc: number } | null = null;
  el.addEventListener('pointerdown', (e) => {
    if (p.disabled || editing || e.button !== 0) return;
    e.preventDefault();
    el.focus();
    el.setPointerCapture(e.pointerId);
    drag = { x: e.clientX, start: value, moved: false, gesture: newGesture('drag'), acc: 0 };
  });
  el.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    if (!drag.moved && Math.abs(dx) < 3) return;
    if (!drag.moved) p.onHold?.();
    drag.moved = true;
    el.classList.add('is-dragging');
    drag.x = e.clientX;
    const perPx = p.min !== undefined && p.max !== undefined ? (p.max - p.min) / 240 : step;
    const k = e.shiftKey ? 0.1 : e.ctrlKey || e.metaKey ? 10 : 1;
    drag.acc += dx * perPx * k;
    commit(drag.start + drag.acc, drag.gesture);
  });
  const endDrag = () => {
    const moved = drag?.moved;
    drag = null;
    el.classList.remove('is-dragging');
    if (moved) p.onRelease?.();
  };
  el.addEventListener('pointerup', endDrag);
  el.addEventListener('pointercancel', endDrag);
  el.addEventListener('dblclick', startEdit);

  let keyGesture = newGesture('key');
  let keyTimer = 0;
  el.addEventListener('keydown', (e) => {
    if (p.disabled || editing) return;
    const k = e.shiftKey ? 0.1 : e.ctrlKey || e.metaKey ? 10 : 1;
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
      e.preventDefault();
      e.stopPropagation();
      commit(value + step * k, keyGesture);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
      e.preventDefault();
      e.stopPropagation();
      commit(value - step * k, keyGesture);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      startEdit();
      return;
    } else return;
    window.clearTimeout(keyTimer);
    keyTimer = window.setTimeout(() => (keyGesture = newGesture('key')), 700);
  });

  return {
    el,
    set(v) {
      if (editing || drag || v === value) return;
      value = v;
      render();
    },
  };
}

let lengthUnit: LengthUnit = 'mm';
/** Settings ▸ General ▸ Interface units (app.ts sets it before building the interface). */
export function setLengthUnit(u: LengthUnit): void {
  lengthUnit = u;
}
export function getLengthUnit(): LengthUnit {
  return lengthUnit;
}

/** A length in the interface units, from millimetres. */
export function lengthIn(mm: number, unit: LengthUnit = lengthUnit): number {
  return mm / UNIT_TO_MM[unit];
}

/**
 * A NumberField for a length the model keeps in millimetres, shown and typed in the interface units (mm, cm, m,
 * in). Steps become the power of ten nearest to the same length; the decimals grow with the unit.
 */
export function lengthField(p: NumberFieldProps): Control<number> {
  const unit = lengthUnit;
  if (unit === 'mm') return numberField({ ...p, unit: p.unit ?? 'mm' });
  const k = UNIT_TO_MM[unit];
  const step = 10 ** Math.round(Math.log10((p.step ?? 1) / k));
  const digits = (p.digits ?? (p.step !== undefined && p.step < 1 ? 2 : 0)) + Math.ceil(Math.log10(k));
  const field = numberField({
    ...p,
    value: p.value / k,
    min: p.min === undefined ? undefined : p.min / k,
    max: p.max === undefined ? undefined : p.max / k,
    step,
    digits,
    unit: t(`set.general.units.${unit}` as StringKey),
    onChange: (v, g) => p.onChange(v * k, g),
  });
  return { el: field.el, set: (mm) => field.set(mm / k) };
}

export interface SliderProps extends NumberFieldProps {
  min: number;
  max: number;
}

/** A slider always paired with its value field. */
export function slider(p: SliderProps): Control<number> {
  const step = p.step ?? 0.01;
  const range = h('input', {
    type: 'range',
    min: p.min,
    max: p.max,
    step,
    value: p.value,
    'aria-label': p.ariaLabel ?? p.label ?? '',
    disabled: p.disabled,
  }) as HTMLInputElement;
  let gesture = newGesture('slide');
  const field = numberField({
    ...p,
    onChange: (v, g) => {
      range.value = String(v);
      p.onChange(v, g);
    },
  });
  // While the pointer holds the thumb, the thumb is the person's; any other time (an undo, a reset) it follows the value.
  let dragging = false;
  range.addEventListener('pointerdown', () => {
    gesture = newGesture('slide');
    dragging = true;
    p.onHold?.();
    // The drag ends wherever the pointer is let go.
    const up = () => {
      document.removeEventListener('pointerup', up, true);
      document.removeEventListener('pointercancel', up, true);
      dragging = false;
      p.onRelease?.();
    };
    document.addEventListener('pointerup', up, true);
    document.addEventListener('pointercancel', up, true);
  });
  range.addEventListener('keydown', () => (gesture = newGesture('slide')));
  range.addEventListener('input', () => {
    const v = Number(range.value);
    field.set(v);
    p.onChange(v, gesture);
  });
  const el = h('div', { class: 'slider' }, range, field.el);
  return {
    el,
    set(v) {
      if (!dragging) range.value = String(v);
      field.set(v);
    },
  };
}

export interface SegOption<T extends string> {
  value: T;
  label: string | Node;
  title?: string;
  disabled?: boolean;
}

export function segmented<T extends string>(
  options: readonly SegOption<T>[],
  current: T | null,
  onChange: (v: T) => void,
  opts: { full?: boolean; compact?: boolean; ariaLabel?: string } = {},
): Control<T | null> {
  const buttons = new Map<T, HTMLButtonElement>();
  // `compact`: narrower buttons, for a control of five options in the width of a field.
  const el = h('div', { class: `seg${opts.full ? ' full' : ''}${opts.compact ? ' compact' : ''}`, role: 'group', 'aria-label': opts.ariaLabel ?? '' });
  for (const o of options) {
    const b = h(
      'button',
      {
        type: 'button',
        'data-tip': o.title,
        'aria-label': typeof o.label === 'string' ? o.label : (o.title ?? ''),
        disabled: o.disabled,
        onclick: () => onChange(o.value),
      },
      o.label,
    ) as HTMLButtonElement;
    buttons.set(o.value, b);
    el.appendChild(b);
  }
  const set = (v: T | null) => {
    for (const [k, b] of buttons) b.setAttribute('aria-pressed', String(k === v));
  };
  set(current);
  return { el, set };
}

export function toggle(checked: boolean, onChange: (v: boolean) => void, label: string, disabled = false): Control<boolean> {
  let value = checked;
  const el = h('button', {
    type: 'button',
    class: 'toggle',
    role: 'switch',
    'aria-label': label,
    'aria-checked': String(checked),
    disabled,
    onclick: () => onChange(!value),
  });
  return {
    el,
    set(v) {
      value = v;
      el.setAttribute('aria-checked', String(v));
    },
  };
}

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export function select(options: readonly SelectOption[], current: string, onChange: (v: string) => void, ariaLabel: string): Control<string> {
  const el = h('select', { class: 'select', 'aria-label': ariaLabel }) as HTMLSelectElement;
  for (const o of options) el.appendChild(h('option', { value: o.value, disabled: o.disabled }, o.label));
  el.value = current;
  el.addEventListener('change', () => onChange(el.value));
  return {
    el,
    set(v) {
      el.value = v;
    },
  };
}

/** Colour swatch editing a linear RGB value. Live while the picker is open, one undo entry per opening. */
export function colorField(rgb: readonly number[], onChange: (rgb: [number, number, number], gesture: string) => void, label: string): Control<readonly number[]> {
  const el = h('input', { type: 'color', class: 'color-input', value: linearToHex(rgb), 'aria-label': label }) as HTMLInputElement;
  let gesture = newGesture('color');
  el.addEventListener('click', () => (gesture = newGesture('color')));
  el.addEventListener('input', () => onChange(hexToLinear(el.value), gesture));
  return {
    el,
    set(v) {
      const hex = linearToHex(v);
      if (el.value !== hex) el.value = hex;
    },
  };
}

/** Text field that commits on Enter or blur; Esc restores. */
export function textField(value: string, onCommit: (v: string) => void, ariaLabel: string, placeholder = ''): Control<string> {
  let committed = value;
  const el = h('input', { type: 'text', class: 'text-input', value, placeholder, 'aria-label': ariaLabel }) as HTMLInputElement;
  el.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') el.blur();
    else if (e.key === 'Escape') {
      el.value = committed;
      el.blur();
    }
  });
  el.addEventListener('blur', () => {
    if (el.value !== committed) {
      committed = el.value;
      onCommit(el.value);
    }
  });
  return {
    el,
    set(v) {
      committed = v;
      if (document.activeElement !== el) el.value = v;
    },
  };
}

export interface TextAreaProps {
  value: string;
  /** Most characters (the field refuses more). */
  maxLength: number;
  ariaLabel: string;
  placeholder?: string;
  rows?: number;
  disabled?: boolean;
  /**
   * The text, when typing stops (after `settleMs`) and when the field loses focus, with the gesture of this visit to
   * the field: every commit of one visit carries the same one, so the visit is one undo entry, never one a keystroke.
   */
  onCommit(value: string, gesture: string): void;
  /** Every keystroke (a counter, a live line): nothing is committed by it. */
  onInput?(value: string): void;
  /** The text as it is kept (trimmed…): a commit that keeps the same is no commit, and a kept value equal to it leaves the field alone. */
  normalise?(value: string): string;
  /** Pause after the last keystroke before committing (default 700 ms). */
  settleMs?: number;
}

/**
 * A multi-line text field (X4b): it commits when typing stops and when it loses focus (Esc leaves it), one undo
 * entry a visit. While it has the focus, what it is given back is not written over what is being typed unless the
 * kept value really changed (an undo from the menu), so a commit that trims a trailing space never eats it.
 */
export function textArea(p: TextAreaProps): Control<string> & { el: HTMLTextAreaElement; flush(): void; setDisabled(v: boolean): void } {
  const norm = p.normalise ?? ((v: string) => v);
  const el = h('textarea', { class: 'text-input text-area', rows: p.rows ?? 3, maxlength: p.maxLength, placeholder: p.placeholder ?? '', 'aria-label': p.ariaLabel }) as HTMLTextAreaElement;
  el.value = p.value;
  el.disabled = p.disabled === true;
  let committed = norm(p.value);
  let given = p.value;
  let gesture: string | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const clear = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  const commit = () => {
    clear();
    const v = norm(el.value);
    if (v === committed) return;
    committed = v;
    p.onCommit(v, gesture ?? (gesture = newGesture('text')));
  };
  el.addEventListener('focus', () => (gesture = newGesture('text')));
  el.addEventListener('input', () => {
    p.onInput?.(el.value);
    clear();
    timer = setTimeout(commit, p.settleMs ?? 700);
  });
  el.addEventListener('blur', () => {
    commit();
    gesture = null;
  });
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      el.blur();
    }
  });
  return {
    el,
    flush: commit,
    setDisabled(v) {
      el.disabled = v;
    },
    set(v) {
      if (v === given) return;
      given = v;
      committed = norm(v);
      // Typing: keep the person's text when it is what was kept (the kept one may be trimmed); an undo writes over it.
      if (document.activeElement === el && norm(el.value) === committed) return;
      clear();
      el.value = v;
    },
  };
}

/** A labelled row: label on the left, control on the right. */
export function field(label: string, ...controls: (Node | null)[]): HTMLElement {
  return h('div', { class: 'field' }, h('label', { class: 'field-label', title: label }, label), h('div', { class: 'field-control' }, ...controls));
}

/** Seconds as `hh:mm:ss` (the render window's time field). */
export function formatHms(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const p2 = (n: number) => String(n).padStart(2, '0');
  return `${p2(Math.floor(s / 3600))}:${p2(Math.floor((s % 3600) / 60))}:${p2(s % 60)}`;
}

/** `hh:mm:ss`, `mm:ss` or plain seconds to seconds; null when it is not a time. */
export function parseHms(text: string): number | null {
  const parts = text.trim().split(':');
  if (parts.length === 0 || parts.length > 3 || parts.some((p) => !/^\d+(\.\d+)?$/.test(p.trim()))) return null;
  const nums = parts.map((p) => Number(p.trim()));
  let s = 0;
  for (const n of nums) s = s * 60 + n;
  return Number.isFinite(s) ? Math.round(s) : null;
}

/** A time field in `hh:mm:ss`: commits on Enter or blur, Esc restores, anything else that is not a time is refused. */
export function timeField(seconds: number, onCommit: (seconds: number) => void, ariaLabel: string): Control<number> {
  let value = seconds;
  const el = h('input', { type: 'text', class: 'text-input time-input tabular', value: formatHms(seconds), 'aria-label': ariaLabel, inputmode: 'numeric', spellcheck: 'false' }) as HTMLInputElement;
  const commit = () => {
    const v = parseHms(el.value);
    if (v === null || v <= 0) {
      el.value = formatHms(value);
      return;
    }
    el.value = formatHms(v);
    if (v !== value) {
      value = v;
      onCommit(v);
    }
  };
  el.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') el.blur();
    else if (e.key === 'Escape') {
      el.value = formatHms(value);
      el.blur();
    }
  });
  el.addEventListener('blur', commit);
  return {
    el,
    set(v) {
      value = v;
      if (document.activeElement !== el) el.value = formatHms(v);
    },
  };
}
