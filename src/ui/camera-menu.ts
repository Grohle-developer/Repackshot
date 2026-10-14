// The viewport's camera list (the chip at the top right): one row per saved camera, the active one checked, its lens
// as quiet text, and a pencil at the right end that opens that camera's own inspector (cmd.editCamera). Pure data
// over the state, so a test can read it without a DOM.

import type { CameraState } from '../core/camera';
import * as cmd from './commands';
import type { MenuEntry } from './components/widgets';
import { cameraName } from './names';
import { formatNumber, t } from './strings';
import type { Ctx } from './reactive';

/** The lens of a camera in one short line: `85 mm · f/5.6`. */
export function cameraLensSummary(cam: Pick<CameraState, 'focalMm' | 'fstop'>): string {
  return t('cameras.lens', { focal: formatNumber(cam.focalMm, undefined, 0), fstop: formatNumber(cam.fstop, undefined, 1) });
}

/** The rows of the camera list, in the cameras' order. */
export function cameraMenuEntries(ctx: Ctx): MenuEntry[] {
  const s = ctx.store.get();
  return Object.values(s.camera.cameras).map((c) => {
    const name = cameraName(s, c);
    return {
      label: name,
      aux: cameraLensSummary(c),
      checked: c.id === s.camera.active,
      run: () => cmd.activateCamera(ctx, c.id),
      action: { icon: 'edit', label: t('cameras.edit', { name }), run: () => cmd.editCamera(ctx, c.id) },
    };
  });
}
