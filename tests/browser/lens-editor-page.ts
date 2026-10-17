// The page of the browser test of the lens editor (phase O2c, tests/lens-editor-browser.test.ts): the real window
// (ui/panels/lens-editor.ts) with the real styles, open on the example's camera with the catalogue's double Gauss, and
// the real engine: the page's own rt.wasm answers the lens questions as main.ts does (io/rsb.ts lensInfoRsb,
// render/lens-info.ts readLensVerdict). `window.lensEditorTest` reads the store and undoes.

import '../../src/ui/theme.css';
import '../../src/ui/layout.css';
import '../../src/ui/components.css';
import '../../src/ui/panels.css';
import '../../src/ui/lens-editor.css';
import type { CameraState } from '../../src/core/camera';
import { opticsOf, tracedOf } from '../../src/core/optics';
import { createStore } from '../../src/core/store';
import { newTracedLens, type TracedLens } from '../../src/core/traced-lens';
import { lensInfoRsb } from '../../src/io/rsb';
import { hasLensInfoExport, readLensVerdict } from '../../src/render/lens-info';
import { lensEditor } from '../../src/ui/panels/lens-editor';
import type { AppServices, LensCheck, LensPort } from '../../src/ui/ports';
import { Root, Scope, type Ctx } from '../../src/ui/reactive';
import { setLang } from '../../src/ui/strings';
import { createUiStore } from '../../src/ui/ui-state';
import { exampleState } from '../helpers';

export interface LensEditorTest {
  /** The camera's own lens and the editor's copy. */
  lens(): TracedLens | null;
  draft(): TracedLens | null;
  undos(): number;
  undo(): void;
  /** How many questions the engine was asked. */
  asked(): number;
}

declare global {
  interface Window {
    lensEditorTest?: LensEditorTest;
  }
}

if (new URLSearchParams(location.search).get('lang') === 'es') setLang('es');

const store = createStore(exampleState());
const camId = store.get().camera.active;
store.dispatch({ type: 'camera/set', id: camId, patch: { optics: { ...opticsOf(store.get().camera.cameras[camId]), traced: newTracedLens('double_gauss_normal') }, focalMm: 50, fstop: 4 } });

let asked = 0;
const bytes = await (await fetch('/engine/rt.wasm')).arrayBuffer();
const { instance } = await WebAssembly.instantiate(bytes, {});
const rt = instance.exports as unknown as object;
if (!hasLensInfoExport(rt)) throw new Error('rt.wasm tells no lens information');
const check = async (cam: CameraState): Promise<LensCheck> => {
  asked++;
  const v = readLensVerdict(rt, lensInfoRsb(cam, cam.aspect.w, cam.aspect.h));
  return v.state === 'ready' ? v : v.state === 'thin' ? { state: 'none' } : { state: 'refused', reason: v.reason };
};
const port: LensPort = {
  info: async (cam) => {
    const c = await check(cam);
    return c.state === 'ready' ? c.info : c.state === 'refused' ? undefined : null;
  },
  check,
};
const services = { lens: port } as unknown as AppServices;
const ctx: Ctx = { store, ui: createUiStore(), services };
ctx.ui.set({ lensEditor: { camera: camId } });
const root = new Root(ctx);
const scope = new Scope(root);
document.body.append(lensEditor(ctx, scope));

const cam = () => store.get().camera.cameras[camId];
window.lensEditorTest = {
  lens: () => tracedOf(opticsOf(cam())),
  draft: () => cam().lensDraft ?? null,
  undos: () => store.history().undo.length,
  undo: () => store.undo(),
  asked: () => asked,
};
document.documentElement.setAttribute('data-ready', '1');
