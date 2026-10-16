// The page of the browser test of the window of a lens's elements (phase O2b, tests/lens-peek-browser.test.ts): the
// real Camera ▸ Lens section of the inspector (ui/panels/insp-traced.ts) on a camera with a traced lens, in a column
// at the right like the inspector, with the real styles and a lens-information port that is not the engine
// (tests/browser/lens-peek-fake.ts) so the questions can be counted and the answers held back, refused or missing.

import '../../src/ui/theme.css';
import '../../src/ui/layout.css';
import '../../src/ui/components.css';
import '../../src/ui/panels.css';
import { opticsOf, tracedOf } from '../../src/core/optics';
import { createStore } from '../../src/core/store';
import { newTracedLens } from '../../src/core/traced-lens';
import { tracedLensFields } from '../../src/ui/panels/insp-traced';
import type { AppServices } from '../../src/ui/ports';
import { Root, Scope, type Ctx } from '../../src/ui/reactive';
import { setLang } from '../../src/ui/strings';
import { createUiStore } from '../../src/ui/ui-state';
import { exampleState } from '../helpers';
import { fakePort, type FakeMode, type FakePort } from './lens-peek-fake';

export interface PeekTest {
  /** How the port answers: 'ok', 'hold' (until `release`), 'none' (no engine), 'refuse', or 'nolink' (the page has no port at all). */
  setMode(mode: FakeMode | 'nolink'): void;
  release(): void;
  /** The questions the engine was asked: `key@focal`. */
  asked(): string[];
  /** The key of the lens on the camera. */
  lens(): string;
  setFocal(mm: number): void;
}

declare global {
  interface Window {
    peekTest?: PeekTest;
  }
}

// ?lang=es for the Spanish wording.
if (new URLSearchParams(location.search).get('lang') === 'es') setLang('es');

const store = createStore(exampleState());
const camId = store.get().camera.active;
store.dispatch({ type: 'camera/set', id: camId, patch: { optics: { ...opticsOf(store.get().camera.cameras[camId]), traced: newTracedLens('double_gauss_normal') }, focalMm: 50, fstop: 5.6 } });
const fake: FakePort = fakePort('ok');
const services = { lens: fake.port } as unknown as AppServices;
const ctx: Ctx = { store, ui: createUiStore(), services };
const root = new Root(ctx);
const scope = new Scope(root);

// The inspector's column: at the right edge of the window, the width the application gives it.
const column = document.createElement('div');
column.style.cssText = 'position:fixed;top:0;right:0;bottom:0;width:340px;overflow:auto;padding:12px;background:var(--bg-0);border-left:1px solid var(--line);';
column.append(tracedLensFields(ctx, scope, () => camId));
document.body.append(column);

window.peekTest = {
  setMode(mode) {
    if (mode === 'nolink') {
      (services as { lens: unknown }).lens = null;
      return;
    }
    (services as { lens: unknown }).lens = fake.port;
    fake.mode = mode;
  },
  release: () => fake.release(),
  asked: () => fake.asked.map((c) => `${tracedOf(c.optics)!.key}@${c.focalMm}`),
  lens: () => tracedOf(opticsOf(store.get().camera.cameras[camId]))!.key,
  setFocal: (mm) => store.dispatch({ type: 'camera/set', id: camId, patch: { focalMm: mm } }),
};
document.documentElement.setAttribute('data-ready', '1');
