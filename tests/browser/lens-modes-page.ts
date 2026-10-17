// The page of the browser test of the two lens models (phase O4, tests/lens-modes-browser.test.ts): the real optics of
// Camera in the inspector (ui/panels/insp-lens.ts: Lens, Bokeh, Advanced optics, Filters) on the example's camera, in a
// column at the right the width the application gives the inspector, with the real styles, and a lens-information port
// that is not the engine (tests/browser/lens-peek-fake.ts). `window.lensTest` reads the state and goes through the
// commands the way other parts of the interface would.

import '../../src/ui/theme.css';
import '../../src/ui/layout.css';
import '../../src/ui/components.css';
import '../../src/ui/panels.css';
import { lensModelOf, opticsOf, tiltOf, type CameraOptics } from '../../src/core/optics';
import { createStore } from '../../src/core/store';
import { applyBokeh } from '../../src/ui/lens-commands';
import { opticsFields } from '../../src/ui/panels/insp-lens';
import type { AppServices } from '../../src/ui/ports';
import { Root, Scope, type Ctx } from '../../src/ui/reactive';
import { setLang } from '../../src/ui/strings';
import { createUiStore } from '../../src/ui/ui-state';
import { exampleState } from '../helpers';
import { fakePort } from './lens-peek-fake';

export interface LensTest {
  optics(): CameraOptics;
  model(): string;
  tilt(): { deg: number; axisDeg: number };
  /** A bokeh through the command every path takes (a drop, a menu would). */
  applyBokeh(key: string): boolean;
  set(patch: Partial<CameraOptics>): void;
  undos(): number;
  toasts(): string[];
  ui(): { focusPlaneHover: boolean; focusPlanePinned: boolean; pickMode: unknown };
}

declare global {
  interface Window {
    lensTest?: LensTest;
  }
}

if (new URLSearchParams(location.search).get('lang') === 'es') setLang('es');

const store = createStore(exampleState());
const camId = store.get().camera.active;
const services = { lens: fakePort('ok').port } as unknown as AppServices;
const ctx: Ctx = { store, ui: createUiStore(), services };
const root = new Root(ctx);
const scope = new Scope(root);

const column = document.createElement('div');
column.setAttribute('data-column', '');
column.style.cssText = 'position:fixed;top:0;right:0;bottom:0;width:340px;overflow:auto;padding:12px;background:var(--bg-0);border-left:1px solid var(--line);box-sizing:border-box;';
column.append(opticsFields(ctx, scope, () => camId));
document.body.append(column);

const optics = () => opticsOf(store.get().camera.cameras[camId]);
window.lensTest = {
  optics,
  model: () => lensModelOf(optics()),
  tilt: () => tiltOf(optics()),
  applyBokeh: (key) => applyBokeh(ctx, camId, key, null),
  set: (patch) => store.dispatch({ type: 'camera/set', id: camId, patch: { optics: { ...optics(), ...patch } } }),
  undos: () => store.history().undo.length,
  toasts: () => ctx.ui.get().toasts.map((x) => x.text),
  ui: () => {
    const u = ctx.ui.get();
    return { focusPlaneHover: u.focusPlaneHover, focusPlanePinned: u.focusPlanePinned, pickMode: u.pickMode };
  },
};
document.documentElement.setAttribute('data-ready', '1');
