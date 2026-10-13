// Right click ▸ Scale… (phase U9): a panel of our own next to where it was asked for (a row of the tree, the point
// of the viewport that was clicked), never a dialog of the browser. Uniform (%), per axis (X, Y, Z in %) or to size
// (the width, depth and height in millimetres, with the proportions locked or not), Apply and Reset scale. It acts
// on the selection at the level in force (what the menu was opened on), about its pivot, along the axes of the move
// and scale tools (global or local); Apply and Reset are one undo step each. Esc or a click outside closes it.

import type { Vec3 } from '../../core/math';
import type { NodeId } from '../../core/scene';
import { movableTargets, pivotModeOf, selectionExtents, selectionFrame } from '../../core/transform';
import * as cmd from '../commands';
import { field, lengthField, numberField, segmented, type Control } from '../components/controls';
import { openFloating } from '../components/widgets';
import { h, icon } from '../dom';
import { dyn, targetLabel } from '../names';
import type { Ctx } from '../reactive';
import { getLang, t } from '../strings';

export type ScaleMode = 'UNIFORM' | 'AXES' | 'SIZE';

/** The mode the panel opened in last (interface state, not the project's). */
let lastMode: ScaleMode = 'UNIFORM';

/** What Apply does with the values of the panel: the factors along the three axes. */
export function scaleFactors(mode: ScaleMode, values: { uniform: number; axes: Vec3; size: Vec3 }, extents: Vec3): Vec3 {
  if (mode === 'UNIFORM') return [values.uniform / 100, values.uniform / 100, values.uniform / 100];
  if (mode === 'AXES') return [values.axes[0] / 100, values.axes[1] / 100, values.axes[2] / 100];
  return extents.map((e, i) => (e > 0 ? values.size[i] / e : 1)) as Vec3;
}

/**
 * The sizes with one of them changed: with the proportions locked, the other two follow it (from the sizes the
 * selection has now); an axis without extent (a flat plane's height) stays as it is.
 */
export function lockedSizes(extents: Vec3, current: Vec3, axis: number, value: number, lock: boolean): Vec3 {
  const out: Vec3 = [current[0], current[1], current[2]];
  out[axis] = value;
  if (!lock || !(extents[axis] > 0)) return out;
  const k = value / extents[axis];
  // Not rounded: the factors stay exactly alike (the fields round what they show).
  for (let j = 0; j < 3; j++) if (j !== axis && extents[j] > 0) out[j] = extents[j] * k;
  return out;
}

/** The panel itself (`close` is called when it is done). */
export function scalePanel(ctx: Ctx, ids: readonly NodeId[], close: () => void): HTMLElement {
  const { store, ui } = ctx;
  const s = store.get();
  const targets = movableTargets(s, ids);
  const space = ui.get().space;
  const frame = selectionFrame(s, targets, space);
  const extents = frame ? selectionExtents(s, targets, frame.axes) : ([0, 0, 0] as Vec3);
  // The sizes as they are (Apply without a change is no change: the factors are exactly 1).
  const values = { uniform: 100, axes: [100, 100, 100] as Vec3, size: [extents[0], extents[1], extents[2]] as Vec3 };
  let mode: ScaleMode = lastMode;
  let lock = true;

  const pct = (label: string, aria: string, on: (v: number) => void, inline?: string): Control<number> =>
    numberField({ value: 100, min: 0.1, max: 100000, step: 1, digits: 1, unit: '%', label: inline, ariaLabel: aria || label, onChange: (v) => on(v) });
  const uniform = pct('', t('scalePanel.uniform'), (v) => (values.uniform = v));
  uniform.el.setAttribute('data-field', 'scale.uniform');
  const XYZ = ['X', 'Y', 'Z'];
  const axes = XYZ.map((a, i) => {
    const f = pct(a, `${t('scalePanel.factor')} ${a}`, (v) => (values.axes[i] = v), a);
    f.el.setAttribute('data-field', `scale.${a.toLowerCase()}`);
    return f;
  });
  const sizeLabels = [t('primParam.width'), t('primParam.depth'), t('primParam.height')];
  const sizes: Control<number>[] = [];
  const setSize = (i: number, v: number) => {
    values.size = lockedSizes(extents, values.size, i, v, lock);
    sizes.forEach((f, j) => j !== i && f.set(values.size[j]));
  };
  sizeLabels.forEach((label, i) => {
    const f = lengthField({ value: values.size[i], min: 0.01, step: 1, digits: 2, ariaLabel: label, disabled: !(extents[i] > 0), onChange: (v) => setSize(i, v) });
    f.el.setAttribute('data-field', `scale.size${i}`);
    sizes.push(f);
  });
  const lockBtn = h('button', { type: 'button', class: 'icon-btn sm', 'aria-label': t('scalePanel.lock'), 'data-tip': t('scalePanel.lock'), 'data-field': 'scale.lock' });
  const paintLock = () => {
    lockBtn.replaceChildren(icon(lock ? 'lock' : 'unlock', 14));
    lockBtn.setAttribute('aria-pressed', String(lock));
  };
  paintLock();
  lockBtn.addEventListener('click', () => {
    lock = !lock;
    paintLock();
  });

  const rows = {
    UNIFORM: h('div', { class: 'stack', style: 'gap:6px' }, field(t('scalePanel.factor'), uniform.el)),
    AXES: h('div', { class: 'field-row3' }, ...axes.map((f) => f.el)),
    SIZE: h(
      'div',
      { class: 'stack', style: 'gap:6px' },
      ...sizes.map((f, i) => field(sizeLabels[i], f.el)),
      h('div', { class: 'row', style: 'justify-content:flex-end;align-items:center;gap:6px' }, h('span', { class: 'aux' }, t('scalePanel.lock')), lockBtn),
    ),
  };
  const seg = segmented<ScaleMode>(
    [
      { value: 'UNIFORM', label: t('scalePanel.uniform') },
      { value: 'AXES', label: t('scalePanel.axes') },
      { value: 'SIZE', label: t('scalePanel.size') },
    ],
    mode,
    (m) => {
      mode = m;
      lastMode = m;
      seg.set(m);
      show();
    },
    { full: true, ariaLabel: t('scalePanel.mode') },
  );
  const show = () => {
    for (const [k, el] of Object.entries(rows)) el.style.display = k === mode ? '' : 'none';
  };
  show();

  const first = s.scene.nodes[targets[0]];
  const about = h('div', { class: 'aux' }, t('scalePanel.about', { pivot: t(dyn(`pivot.${pivotModeOf(first)}`)), space: t(dyn(`space.${space}`)) }));
  const apply = h('button', { type: 'button', class: 'btn btn-primary', 'data-action': 'scale.apply' }, t('scalePanel.apply'));
  apply.addEventListener('click', () => {
    close();
    cmd.scaleSelection(ctx, scaleFactors(mode, values, extents), targets, space);
  });
  const reset = h('button', { type: 'button', class: 'btn', 'data-action': 'scale.reset' }, t('scalePanel.reset'));
  reset.addEventListener('click', () => {
    close();
    cmd.resetScale(ctx, targets);
  });
  const cancel = h('button', { type: 'button', class: 'btn', onclick: close }, t('common.cancel'));
  const title = t('scalePanel.title', { target: targetLabel(s, targets)[getLang()] });
  return h(
    'div',
    { class: 'scale-panel stack', role: 'group', 'aria-label': title, 'data-panel': 'scale' },
    h('div', { class: 'confirm-msg' }, title),
    seg.el,
    rows.UNIFORM,
    rows.AXES,
    rows.SIZE,
    about,
    h('div', { class: 'confirm-actions' }, apply, reset, cancel),
  );
}

/** Opens the panel next to an element (a tree row) or at a point of the window (the viewport's right click). */
export function openScalePanel(ctx: Ctx, ids: readonly NodeId[], at: HTMLElement | { x: number; y: number }): void {
  const s = ctx.store.get();
  if (movableTargets(s, ids).length === 0) {
    ctx.ui.toast(t('scalePanel.locked'));
    return;
  }
  const anchor = at instanceof HTMLElement ? at : h('div', { style: `position:fixed;left:${at.x}px;top:${at.y - 6}px;width:0;height:0` });
  if (!(at instanceof HTMLElement)) document.body.appendChild(anchor);
  let closeIt = () => {};
  const panel = scalePanel(ctx, ids, () => closeIt());
  closeIt = openFloating(anchor, panel, { onClose: () => (at instanceof HTMLElement ? undefined : anchor.remove()) });
  // The first field of the mode in force.
  queueMicrotask(() => [...panel.querySelectorAll<HTMLElement>('.num:not(.is-disabled)')].find((el) => el.offsetParent !== null)?.focus());
}
