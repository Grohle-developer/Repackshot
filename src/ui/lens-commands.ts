// The commands of a camera's lens model, bokeh and tilt (phase O4): Camera ▸ Lens ▸ Simple lens · Traced lens, a bokeh
// type (the simple lens's only: a traced camera is never taken out of its lens by one, it gets a notice), and the
// plane of sharp focus through two points of the product (the viewport's pick, one undo entry for the tilt and the
// focus distance). Everything goes through the store (camera/set); the pick mode and the plane's overlay are interface
// state.

import type { CameraId, CameraState } from '../core/camera';
import { exactFocusDistance } from '../core/focus';
import { isTiltSolution, solveTilt, type TiltRefusal } from '../core/focus-plane';
import type { Vec3 } from '../core/math';
import { bokehApplies, OPTICS_LIMITS, opticsForBokeh, opticsOf, opticsWithLensModel, tracedOf, withTilt, type LensModel } from '../core/optics';
import { editLabel } from './commands';
import type { Ctx } from './reactive';
import { formatNumber, L, t } from './strings';

/** Camera `camId` with lens model `model`: its bokeh and Advanced optics stay for when it comes back (one undo entry). */
export function setLensModel(ctx: Ctx, camId: CameraId, model: LensModel): void {
  const cam = ctx.store.get().camera.cameras[camId];
  if (!cam) return;
  const o = opticsOf(cam);
  const next = opticsWithLensModel(o, model);
  if (next !== o) ctx.store.dispatch({ type: 'camera/set', id: camId, patch: { optics: next }, label: editLabel('camera', 'camera.lensModel') });
}

/**
 * Bokeh type `key` (and `variant`) on camera `camId`: true when it applied. A camera with a traced lens keeps its lens
 * and says why (the bokeh is a simple-lens option); every way a bokeh reaches a camera goes through here.
 */
export function applyBokeh(ctx: Ctx, camId: CameraId, key: string, variant: string | null): boolean {
  const cam = ctx.store.get().camera.cameras[camId];
  if (!cam) return false;
  const o = opticsOf(cam);
  if (!bokehApplies(o)) {
    ctx.ui.toast(t('camera.bokehSimpleOnly'));
    return false;
  }
  const next = opticsForBokeh(o, key, variant);
  if (!next) return false;
  ctx.store.dispatch({ type: 'camera/set', id: camId, patch: { optics: next }, label: editLabel('camera', 'camera.bokehType') });
  return true;
}

/** True while the next clicks put camera `camId`'s plane of sharp focus through two points. */
export function tiltPicking(ctx: Ctx, camId?: CameraId): boolean {
  const pm = ctx.ui.get().pickMode;
  return pm?.kind === 'tiltPlane' && (camId === undefined || pm.camera === camId);
}

/** Arms the viewport's next two clicks for camera `camId`'s plane (pressing again, or Esc, puts it down). */
export function armTiltPick(ctx: Ctx, camId: CameraId): void {
  ctx.ui.set({ pickMode: tiltPicking(ctx, camId) ? null : { kind: 'tiltPlane', camera: camId, first: null }, focusPlaneCamera: camId });
}

/** What a refused pick says. */
export function tiltRefusalText(r: TiltRefusal): string {
  if (r.reason === 'steep') return t('camera.tiltRefused.steep', { deg: formatNumber(r.neededDeg, undefined, 1), max: formatNumber(OPTICS_LIMITS.tiltDeg.max, undefined, 0) });
  return t(r.reason === 'same' ? 'camera.tiltRefused.same' : r.reason === 'line' ? 'camera.tiltRefused.line' : 'camera.tiltRefused.behind');
}

/**
 * A click of the two-point pick at `point` (model space): the first is kept; the second sets the tilt and the focus
 * distance of the camera so that the plane of sharp focus goes through both (one undo entry). A second point that makes
 * no plane the lens can reach is refused with a notice and the pick waits for another.
 */
export function finishTiltPick(ctx: Ctx, point: readonly number[]): void {
  const pm = ctx.ui.get().pickMode;
  if (pm?.kind !== 'tiltPlane') return;
  const p: Vec3 = [point[0], point[1], point[2]];
  if (!pm.first) {
    ctx.ui.set({ pickMode: { ...pm, first: p } });
    return;
  }
  const cam = ctx.store.get().camera.cameras[pm.camera];
  if (!cam) {
    ctx.ui.set({ pickMode: null });
    return;
  }
  const r = solveTilt(cam, [pm.first, p]);
  if (!isTiltSolution(r)) {
    ctx.ui.toast(tiltRefusalText(r));
    return;
  }
  const optics = withTilt(opticsOf(cam), r.tiltDeg, r.axisDeg);
  // F1: a traced lens refocuses with its real rays (the engine's solve), the tilt the simple lens's plane (O4): the
  // distance that puts each point in focus with that tilt, their mean. The camera is focused by distance from now on
  // (it may have followed a point or an object), in the same undo entry.
  let focusDistance = r.focusDistance;
  if (tracedOf(optics)) {
    const tilted: CameraState = { ...cam, optics, focusDistance };
    const [d1, d2] = [pm.first, p].map((q) => exactFocusDistance(tilted, q));
    if (d1 !== null && d2 !== null) focusDistance = 0.5 * (d1 + d2);
  }
  ctx.store.dispatch({ type: 'camera/set', id: pm.camera, patch: { optics, focusDistance, focusMode: 'DISTANCE' }, label: L('undo.tiltPlane') });
  ctx.ui.set({ pickMode: null });
}

/** What the pick banner says. */
export function tiltBanner(first: Vec3 | null): string {
  return t(first ? 'viewport.pickTiltSecond' : 'viewport.pickTiltFirst');
}
