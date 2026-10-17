// The aspect ratio row of a camera (U13): the list of ratios and, for a custom one, its `w : h`. It goes in the
// scene's camera section and in the inspector of a saved camera (both draw `cameraFields`), and edits the camera
// it is given; the viewport's frame and the render window's size follow the active camera's.

import { ASPECT_CUSTOM_LABEL, ASPECT_PRESETS } from '../../data/aspects';
import { customAspect, presetAspect, type CameraAspect } from '../../core/aspect';
import type { CameraId } from '../../core/camera';
import * as cmd from '../commands';
import { field, numberField, select } from '../components/controls';
import { h } from '../dom';
import type { Ctx, Scope } from '../reactive';
import { lbl, t } from '../strings';

/** The list's value for a ratio: its preset's key, or CUSTOM. */
const CUSTOM = 'CUSTOM';

/**
 * The aspect rows of one camera: the list, and under it the `w : h` fields, enabled for a custom ratio (a preset
 * shows its own terms). Every change is one `camera/set`, so one undo entry; dragging a term is one gesture.
 */
export function aspectRows(ctx: Ctx, scope: Scope, camId: () => CameraId): HTMLElement {
  const { store } = ctx;
  const current = (): CameraAspect => (store.get().camera.cameras[camId()] ?? Object.values(store.get().camera.cameras)[0]).aspect;
  const write = (aspect: CameraAspect, gesture?: string) =>
    store.dispatch({ type: 'camera/set', id: camId(), patch: { aspect }, ...(gesture ? { gesture } : {}), label: cmd.editLabel('camera', 'camera.aspect') });
  const list = select(
    [...ASPECT_PRESETS.map((p) => ({ value: p.key as string, label: lbl(p.label) })), { value: CUSTOM, label: lbl(ASPECT_CUSTOM_LABEL) }],
    current().preset,
    (v) => {
      // Custom starts from the ratio it was.
      const cur = current();
      const next = v === CUSTOM ? customAspect(cur.w, cur.h) : presetAspect(v);
      if (next) write(next);
    },
    t('camera.aspect'),
  );
  // The terms scrub one pixel at a time (no maximum: the reducer keeps the ratio within the render window's limits).
  const term = (which: 'w' | 'h') => ({
    ctl: numberField({
      value: current()[which],
      min: 1,
      step: 1,
      digits: 2,
      ariaLabel: t(which === 'w' ? 'camera.aspectW' : 'camera.aspectH'),
      disabled: current().preset !== CUSTOM,
      onChange: (v: number, g: string) => {
        const cur = current();
        const next = customAspect(which === 'w' ? v : cur.w, which === 'h' ? v : cur.h);
        if (next) write(next, g);
      },
    }),
  });
  const w = term('w');
  const hh = term('h');
  const enable = (on: boolean) => {
    for (const x of [w, hh]) x.ctl.setDisabled(!on);
  };
  enable(current().preset === CUSTOM);
  scope.watch(
    (s) => (s.camera.cameras[camId()] ?? Object.values(s.camera.cameras)[0]).aspect,
    (a) => {
      list.set(a.preset);
      w.ctl.set(a.w);
      hh.ctl.set(a.h);
      enable(a.preset === CUSTOM);
    },
  );
  return h(
    'div',
    { class: 'stack', 'data-field': 'aspect' },
    field(t('camera.aspect'), list.el),
    h('div', { class: 'field' }, h('span'), h('div', { class: 'field-control' }, w.ctl.el, h('span', { class: 'aux' }, ':'), hh.ctl.el)),
  );
}
