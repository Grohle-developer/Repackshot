// The page of the browser test of the focal length's switch (phase C2, tests/focal-browser.test.ts): two flat cards
// square to the view, glowing red and green on black, nothing else lit. The store of the page changes the focal length
// as the inspector's field does (a drag: several `camera/focal` with one gesture; a press of the arrows: one) with the
// switch on or off, the preview engine draws the frame before and after, the canvas is read back, and the size and the
// centre in pixels of each card are returned. With the switch on, the card on the plane in focus must keep them.

import { activeCamera, type CameraState } from '../../src/core/camera';
import { instanceFromPreset } from '../../src/core/materials';
import { registerMesh } from '../../src/core/meshes';
import type { NodeId, SceneNode } from '../../src/core/scene';
import { createInitialState, createStore, reduce, type ProjectState, type Store } from '../../src/core/store';
import { focusPickAction } from '../../src/core/view-objects';
import { PreviewEngine } from '../../src/render/preview';
import { boxMesh } from './pass-scene';

/** What a card looks like in one frame: its lit pixels, their box and their centre (pixels, y down). */
export interface CardShot {
  pixels: number;
  width: number;
  height: number;
  cx: number;
  cy: number;
}

export interface FocalRun {
  name: string;
  before: { red: CardShot; green: CardShot };
  after: { red: CardShot; green: CardShot };
  /** The undo entries the change left (a drag or a press is one). */
  entries: number;
  focal: [number, number];
  distance: [number, number];
}

declare global {
  interface Window {
    runFocal?: (width: number, height: number) => FocalRun[];
    focalReady?: boolean;
  }
}

const canvas = document.getElementById('c') as HTMLCanvasElement;
const engine = new PreviewEngine();
engine.mount(canvas);
const gl = canvas.getContext('webgl2') as WebGL2RenderingContext;

/** The red card at the orbit target (on the plane in focus of a camera focused there), the green one 250 mm behind. */
export const CARDS = {
  red: { position: [-50, 0, 0] as [number, number, number], rgb: [1, 0, 0] },
  green: { position: [110, 250, 0] as [number, number, number], rgb: [0, 1, 0] },
} as const;
const CARD = { w: 60, thick: 0.2, h: 45 };

function cardScene(patch: Partial<CameraState>): ProjectState {
  const materials: ProjectState['materials'] = {};
  const nodes: Record<NodeId, SceneNode> = {};
  const keys = Object.keys(CARDS) as (keyof typeof CARDS)[];
  nodes.cards = { id: 'cards', name: 'cards', kind: 'MODEL', parent: null, children: keys, transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, visible: true, locked: false };
  for (const k of keys) {
    const inst = instanceFromPreset(`m${k}`, 'NEON_RED', 100)!;
    const c = CARDS[k];
    inst.params = { ...inst.params, emitColor: [c.rgb[0], c.rgb[1], c.rgb[2], 1], emitPower: 2 };
    materials[`m${k}`] = inst;
    nodes[k] = {
      id: k,
      name: k,
      kind: 'PART',
      parent: 'cards',
      children: [],
      transform: { position: [...c.position], rotation: [0, 0, 0], scale: [1, 1, 1] },
      visible: true,
      locked: false,
      mesh: registerMesh(`c2card:${k}`, boxMesh(CARD.w, CARD.thick, CARD.h)),
      material: `m${k}`,
      smooth: false,
    };
  }
  let s = reduce(createInitialState(), { type: 'scene/addModel', payload: { nodes, roots: ['cards'], materials }, replace: true });
  // Looking along +Y at the origin from 600 mm, focused there.
  s = reduce(s, { type: 'camera/set', id: s.camera.active, patch: { azimuth: 0, elevation: 0, distance: 600, target: [0, 0, 0], focusDistance: 600, focalMm: 50, fstop: 0, clipStart: 1, clipEnd: 100000, ...patch } });
  return { ...s, studio: { ...s.studio, floor: false, lights: [] }, environment: { ...s.environment, background: 'COLOR', color: [0, 0, 0, 1], strength: 0 }, image: { ...s.image, viewTransform: 'STANDARD' } };
}

function shoot(state: ProjectState, width: number, height: number): { red: CardShot; green: CardShot } {
  engine.sync(state, null);
  engine.resize(width, height, 1);
  engine.invalidate();
  engine.frame();
  const buf = new Uint8Array(width * height * 4);
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, buf);
  // The brightest value of each channel: a card's pixel is lit past half of it in its own channel.
  const peak = [0, 0];
  for (let i = 0; i < buf.length; i += 4) {
    peak[0] = Math.max(peak[0], buf[i]);
    peak[1] = Math.max(peak[1], buf[i + 1]);
  }
  const measure = (channel: 0 | 1): CardShot => {
    const half = Math.max(8, peak[channel] / 2);
    let n = 0;
    let sx = 0;
    let sy = 0;
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = 4 * ((height - 1 - y) * width + x);
        const on = buf[i + channel];
        const off = buf[i + (channel === 0 ? 1 : 0)];
        // Lit in its own channel past half, the others below that: the card (its anti-aliased edge counts from half covered).
        if (on < half || off >= half || buf[i + 2] >= half) continue;
        n++;
        sx += x + 0.5;
        sy += y + 0.5;
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x + 1);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y + 1);
      }
    }
    return n > 0 ? { pixels: n, width: x1 - x0, height: y1 - y0, cx: sx / n, cy: sy / n } : { pixels: 0, width: 0, height: 0, cx: NaN, cy: NaN };
  };
  return { red: measure(0), green: measure(1) };
}

/** Builds the store for a case, switches the focal's switch, and changes the focal the inspector's way. */
function run(name: string, width: number, height: number, opts: { patch?: Partial<CameraState>; keep: boolean; point?: keyof typeof CARDS; steps: number[]; gesture: boolean }): FocalRun {
  const store: Store = createStore(cardScene(opts.patch ?? {}));
  const id = store.get().camera.active;
  store.dispatch({ type: 'camera/set', id, patch: { keepFocusSize: opts.keep }, label: 'Camera: Keep the size of what is in focus' });
  if (opts.point) {
    // Point: the focus clicked on the front of a card (its face towards the camera).
    // (The scene gives its parts ids of its own: the card is found by its name.)
    const p = CARDS[opts.point].position;
    const node = Object.values(store.get().scene.nodes).find((n) => n.name === opts.point)!.id;
    const a = focusPickAction(store.get(), null, { node, point: [p[0], p[1] - CARD.thick / 2, p[2]] }, { label: 'Focus with a click' });
    if (!a) throw new Error('the focus pick found no camera or part');
    store.dispatch(a);
    if (activeCamera(store.get()).focusMode !== 'POINT') throw new Error('the camera is not in Point');
  }
  const c0 = activeCamera(store.get());
  const before = shoot(store.get(), width, height);
  const undo0 = store.history().undo.length;
  const g = `c2-${name}`;
  opts.steps.forEach((f, k) => store.dispatch({ type: 'camera/focal', id, focalMm: f, gesture: opts.gesture ? g : `${g}-${k}`, label: 'Camera: Focal length' }));
  const c1 = activeCamera(store.get());
  const after = shoot(store.get(), width, height);
  return { name, before, after, entries: store.history().undo.length - undo0, focal: [c0.focalMm, c1.focalMm], distance: [c0.distance, c1.distance] };
}

window.runFocal = (width, height) => [
  // A drag of the field from 50 to 85 mm, the focus at the target: the red card is on the plane in focus.
  run('distance', width, height, { keep: true, steps: [52, 58, 66, 77, 85], gesture: true }),
  // The same drag with the switch off: the camera stays and the red card grows by 85 / 50.
  run('off', width, height, { keep: false, steps: [52, 58, 66, 77, 85], gesture: true }),
  // Point on the green card, behind the target, and a wider focal (the camera comes closer): one press of the arrows.
  run('point', width, height, { keep: true, point: 'green', steps: [35], gesture: false }),
  // K3's straight verticals on a camera looking down 18°: the level camera that is rendered keeps the red card.
  run('verticals', width, height, { keep: true, patch: { elevation: 18, straightVerticals: true, focalMm: 35 }, steps: [45, 60, 70], gesture: true }),
];
window.focalReady = true;
