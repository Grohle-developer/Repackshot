// The Focus of a camera (phase F1, UI.md §5.1 "Cámara"): a segmented control Distance · Point · Object, and under it
// the focus distance as a slider with its value field (a logarithmic slider over the depth of the scene, core/focus.ts
// `focusRange`). Distance edits it (one undo entry per gesture); Point and Object show the distance the camera works
// out for the point or the object, and moving it switches the camera to Distance from there (one undo entry), with the
// pick (Focus with a click; Pick what to focus on) and the name of what it follows. It goes in the scene's camera
// section and in the inspector of a saved camera (both draw `cameraFields`) and edits the camera it is given.

import { playheadPose } from '../../core/animation';
import { activeCamera, FOCUS_MODES, type CameraId, type CameraState, type FocusMode } from '../../core/camera';
import { focusModeOf, focusRange, resolvedFocusDistance } from '../../core/focus';
import type { ProjectState } from '../../core/store';
import * as cmd from '../commands';
import { field, lengthSlider, segmented } from '../components/controls';
import { h, icon } from '../dom';
import { dyn } from '../names';
import { dynamic, type Ctx, type Scope } from '../reactive';
import { t } from '../strings';

/** The camera `id` as the viewport shows it at the playhead (posed when a clip moves it), and that pose. */
function shown(s: ProjectState, id: CameraId): { cam: CameraState; pose: ReturnType<typeof playheadPose> } | null {
  const base = s.camera.cameras[id];
  if (!base) return null;
  const pose = playheadPose(s);
  const cam = pose?.camera?.camera === id ? { ...base, ...pose.camera, id } : base;
  return { cam, pose };
}

/** The distance the camera is focused at now: its own, or the one it works out for its point or object. */
export function shownFocusDistance(s: ProjectState, id: CameraId): number {
  const v = shown(s, id);
  return v ? resolvedFocusDistance(s, v.cam, v.pose) : NaN;
}

export function focusRows(ctx: Ctx, scope: Scope, camId: () => CameraId): HTMLElement {
  const { store } = ctx;
  const current = (): CameraState => store.get().camera.cameras[camId()] ?? activeCamera(store.get());
  const seg = segmented(
    FOCUS_MODES.map((m) => ({ value: m, label: t(dyn(`camera.focusMode.${m}`)), title: t(dyn(`camera.focusModeTip.${m}`)) })),
    focusModeOf(current()),
    (m) => cmd.setFocusMode(ctx, m, camId()),
    { full: true, ariaLabel: t('camera.focusMode') },
  );
  seg.el.setAttribute('data-focus-mode', '');
  // The segment pressed: the camera's mode, or the one whose pick is on for this camera.
  scope.watch(
    (s, u) => {
      const pm = u.pickMode;
      const mine = (c?: string) => !c || c === camId();
      if (pm?.kind === 'focus' && mine(pm.camera)) return 'POINT' as FocusMode;
      if (pm?.kind === 'focusObject' && mine(pm.camera)) return 'OBJECT' as FocusMode;
      return focusModeOf(s.camera.cameras[camId()] ?? activeCamera(s));
    },
    (m) => seg.set(m),
  );
  // The distance: one slider for every mode (it is not drawn again when a move switches the mode, so the drag goes on).
  const distance = distanceRow(ctx, scope, camId);
  const body = dynamic(scope, (s) => focusModeOf(s.camera.cameras[camId()] ?? activeCamera(s)), (inner, mode) => modeRows(ctx, inner, camId, mode));
  return h('div', { class: 'stack', 'data-focus': '' }, field(t('camera.focusMode'), seg.el), distance, body);
}

/**
 * The focus distance as a logarithmic slider with its field. In Distance it is the camera's own; in Point and Object
 * it shows the distance worked out for the point or the object, and moving it switches the camera to Distance from
 * there (the decision on F1's ◆: one undo entry, the switch and the gesture together).
 */
function distanceRow(ctx: Ctx, scope: Scope, camId: () => CameraId): HTMLElement {
  const { store } = ctx;
  // The slider's range follows the scene and the camera; its scale is logarithmic.
  let range = { lo: 1, hi: 1e5 };
  const scale = {
    toUnit: (v: number) => Math.log(Math.max(v, range.lo) / range.lo) / Math.log(range.hi / range.lo),
    fromUnit: (u: number) => range.lo * Math.exp(u * Math.log(range.hi / range.lo)),
  };
  const s0 = store.get();
  const ctl = lengthSlider({
    value: shownFocusDistance(s0, camId()),
    min: 1,
    max: 1e6,
    step: 1,
    ariaLabel: t('camera.focus'),
    scale,
    onChange: (v, g) => {
      const cam = store.get().camera.cameras[camId()];
      const patch: Partial<CameraState> = focusModeOf(cam ?? activeCamera(store.get())) === 'DISTANCE' ? { focusDistance: v } : { focusMode: 'DISTANCE', focusDistance: v };
      store.dispatch({ type: 'camera/set', id: camId(), patch, gesture: g, label: cmd.editLabel('camera', 'camera.focus') });
    },
  });
  ctl.el.setAttribute('data-focus-distance', '');
  scope.watch(
    (s) => [s.camera.cameras[camId()], s.scene.nodes, s.animation] as const,
    () => {
      const s = store.get();
      const v = shown(s, camId());
      if (!v) return;
      const d = resolvedFocusDistance(s, v.cam, v.pose);
      range = focusRange(s, v.cam, d);
      ctl.set(d);
    },
    (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2],
  );
  return field(t('camera.focus'), ctl.el);
}

function modeRows(ctx: Ctx, scope: Scope, camId: () => CameraId, mode: FocusMode): HTMLElement {
  const rows: HTMLElement[] = [];
  if (mode !== 'DISTANCE') {
    const point = mode === 'POINT';
    const pickKind = point ? 'focus' : 'focusObject';
    const label = t(point ? 'camera.focusClick' : 'camera.focusObjectPick');
    const pick = h(
      'button',
      { type: 'button', class: 'icon-btn', 'aria-label': label, 'data-tip': label, onclick: () => (point ? cmd.pickFocusPoint(ctx, camId()) : cmd.pickFocusObject(ctx, camId())) },
      icon(point ? 'focus' : 'target'),
    );
    scope.watch((_s, u) => u.pickMode?.kind === pickKind, (on) => pick.setAttribute('aria-pressed', String(on)));
    const what = h('span', { class: 'aux', 'data-focus-on': '' });
    scope.watch(
      (s) => {
        const c = s.camera.cameras[camId()];
        const id = point ? c?.focusPoint?.node : c?.focusObject;
        return id ? (s.scene.nodes[id]?.name ?? '') : null;
      },
      (name) => (what.textContent = name === null ? t('camera.focusNothing') : t('camera.focusOn', { name })),
    );
    rows.push(field(t(dyn(`camera.focusMode.${mode}`)), h('div', { class: 'row', style: 'gap:6px;align-items:center;min-width:0' }, pick, what)));
    rows.push(h('div', { class: 'note' }, t(point ? 'camera.focusDerived' : 'camera.focusDerivedObject')));
  }
  return h('div', { class: 'stack' }, ...rows);
}
