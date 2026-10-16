// The page of the browser test of the pick through a traced lens's profile (phase O2, tests/lens-pick-browser.test.ts):
// the preview engine draws the wall of boxes (tests/browser/lens-pick-scene.ts) through the profile of the lens
// information it is given, the canvas is read back, and every pixel whose colour is sure is picked: the part the pick
// finds must be the one whose colour is drawn there. Also the outline of a selected box, the selection by box, the
// faces' id pass and the gizmo, against what is drawn.

import { itemsInBox, type Rect } from '../../src/core/box-select';
import { reduce, type ProjectState } from '../../src/core/store';
import { parseLensInfo } from '../../src/core/traced-lens';
import { PreviewEngine } from '../../src/render/preview';
import { lensPickScene, pickBoxes, type PickClass } from './lens-pick-scene';

type Cls = PickClass | 'K' | '?';

interface PickRun {
  /** The class of each pixel (row by row from the top): R, G, B, K (background) or ? (not sure). */
  classes: string;
  checked: number;
  wrong: number;
  firstWrong: { x: number; y: number; drawn: Cls; picked: Cls }[];
}

export interface LensPickResult {
  thin: PickRun;
  noInfo: PickRun;
  /** The gizmo without a profile. */
  gizmo: GizmoRun;
  /** Looking through another camera (L4) with the active camera's traced lens told: not its lens, so drawn straight. */
  lookThrough: { run: PickRun; moved: number };
  profiles: Record<string, { run: PickRun; outline: { ink: number; near: number }; box: { mapped: boolean; unmapped: boolean }; faces: { mapped: number; unmapped: number }; gizmo: GizmoRun }>;
}

/** The pixels the gizmo of a box changes, and at how many of them the gizmo finds a handle. */
interface GizmoRun {
  drawn: number;
  hits: number;
}

declare global {
  interface Window {
    runLensPick?: (width: number, height: number, infos: Record<string, string>) => LensPickResult;
    lensPickReady?: boolean;
  }
}

const canvas = document.getElementById('c') as HTMLCanvasElement;
const engine = new PreviewEngine();
engine.mount(canvas);
const gl = canvas.getContext('webgl2') as WebGL2RenderingContext;
/** The box the outline, the selection by box and the faces are tried on: at a corner, where the lens moves it most. */
const SUBJECT = 'b00';
/** The box whose gizmo is drawn: off the axis, with its handles inside the frame. */
const GIZMO_SUBJECT = 'b11';
/** The store gives the boxes ids of its own: their classes by those ids, and the id of a box by its name. */
const classes0 = new Map<string, PickClass>(pickBoxes().map((b) => [b.id, b.cls]));
const classOf = (state: ProjectState, id: string): Cls => classes0.get(state.scene.nodes[id]?.name ?? '') ?? '?';
const idOf = (state: ProjectState, name: string): string => Object.values(state.scene.nodes).find((n) => n.name === name)!.id;

/** Draws `state` (with the lens information `info` for its camera) and reads the canvas back, rows from the bottom. */
function draw(state: ProjectState, width: number, height: number, info: string | null): Uint8Array {
  engine.sync(state, null);
  engine.resize(width, height, 1);
  engine.setLensInfo(state.camera.active, (info ? parseLensInfo(info) : null) ?? null);
  engine.invalidate();
  engine.frame();
  const buf = new Uint8Array(width * height * 4);
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, buf);
  return buf;
}

/** The class of a colour: the channel that clearly leads, black, or not sure (edges, highlights). */
function classify(r: number, g: number, b: number): Cls {
  const m = Math.max(r, g, b);
  if (m < 24) return 'K';
  if (m < 60) return '?';
  if (r === m && r > 2 * g && r > 2 * b) return 'R';
  if (g === m && g > 2 * r && g > 2 * b) return 'G';
  if (b === m && b > 2 * r && b > 2 * g) return 'B';
  return '?';
}

function classes(buf: Uint8Array, width: number, height: number): Cls[] {
  const out: Cls[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = ((height - 1 - y) * width + x) * 4;
      out.push(classify(buf[i], buf[i + 1], buf[i + 2]));
    }
  }
  return out;
}

/** Every pixel whose 3 × 3 neighbourhood is all one sure class is picked at its centre. */
function pickRun(state: ProjectState, width: number, height: number, info: string | null): PickRun {
  const cls = classes(draw(state, width, height, info), width, height);
  let checked = 0;
  let wrong = 0;
  const firstWrong: PickRun['firstWrong'] = [];
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const c = cls[y * width + x];
      if (c === '?') continue;
      let sure = true;
      for (let dy = -1; dy <= 1 && sure; dy++) for (let dx = -1; dx <= 1 && sure; dx++) sure = cls[(y + dy) * width + x + dx] === c;
      if (!sure) continue;
      checked++;
      const hit = engine.pick(x + 0.5, y + 0.5);
      const picked: Cls = hit ? classOf(state, hit.node) : 'K';
      if (picked !== c) {
        wrong++;
        if (firstWrong.length < 8) firstWrong.push({ x, y, drawn: c, picked });
      }
    }
  }
  return { classes: cls.join(''), checked, wrong, firstWrong };
}

/** The pixels where `SUBJECT` alone is drawn (every other box hidden). */
function subjectAlone(state: ProjectState, width: number, height: number, info: string): boolean[] {
  const nodes = { ...state.scene.nodes };
  for (const n of Object.values(nodes)) if (n.kind === 'PART' && n.name !== SUBJECT) nodes[n.id] = { ...n, visible: false };
  const buf = draw({ ...state, scene: { ...state.scene, nodes } }, width, height, info);
  const out: boolean[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = ((height - 1 - y) * width + x) * 4;
      out.push(Math.max(buf[i], buf[i + 1], buf[i + 2]) >= 24);
    }
  }
  return out;
}

/** The move gizmo of `GIZMO_SUBJECT` drawn through the profile, and hovered at every pixel it changes. */
function gizmoRun(state: ProjectState, width: number, height: number, info: string | null): GizmoRun {
  const without = draw(state, width, height, info);
  engine.setGizmo({ ids: [idOf(state, GIZMO_SUBJECT)], space: 'GLOBAL' });
  const withGizmo = draw(state, width, height, info);
  let drawn = 0;
  let hits = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = ((height - 1 - y) * width + x) * 4;
      if (Math.max(Math.abs(without[i] - withGizmo[i]), Math.abs(without[i + 1] - withGizmo[i + 1]), Math.abs(without[i + 2] - withGizmo[i + 2])) < 40) continue;
      drawn++;
      if (engine.gizmoHover(x + 0.5, y + 0.5)) hits++;
    }
  }
  engine.gizmoHover(-1, -1);
  engine.setGizmo(null);
  return { drawn, hits };
}

window.runLensPick = (width, height, infos) => {
  const traced = lensPickScene(width, height, 'fisheye_180');
  const first = Object.values(infos)[0] ?? null;
  const result: LensPickResult = {
    // The thin lens: the engine's numbers of a traced lens change nothing (they are not its lens).
    thin: pickRun(lensPickScene(width, height, null), width, height, first),
    noInfo: pickRun(traced, width, height, null),
    gizmo: gizmoRun(traced, width, height, null),
    lookThrough: { run: { classes: '', checked: 0, wrong: 0, firstWrong: [] }, moved: -1 },
    profiles: {},
  };
  // A second camera where the first is, with the same lens: the engine has told the active camera's numbers only.
  const two = reduce(traced, { type: 'camera/add', name: 'second', from: traced.camera.active });
  const other = Object.keys(two.camera.cameras).find((id) => id !== two.camera.active)!;
  engine.setGlyphs({ all: false, selected: null, lookThrough: { kind: 'CAMERA', id: other } });
  const through = pickRun(two, width, height, first);
  const straight = classes(draw(two, width, height, null), width, height);
  result.lookThrough = { run: through, moved: [...through.classes].filter((c, i) => c !== '?' && straight[i] !== '?' && c !== straight[i]).length };
  engine.setGlyphs({ all: false, selected: null, lookThrough: null });
  for (const [name, info] of Object.entries(infos)) {
    const run = pickRun(traced, width, height, info);
    // The outline of the selected box goes round it where it is drawn: its ink (white) next to the box's edge.
    const alone = subjectAlone(traced, width, height, info);
    const subject = idOf(traced, SUBJECT);
    const selected = reduce(traced, { type: 'scene/select', ids: [subject], mode: 'set', level: 'PART' });
    const buf = draw(selected, width, height, info);
    let ink = 0;
    let near = 0;
    for (let y = 2; y < height - 2; y++) {
      for (let x = 2; x < width - 2; x++) {
        const i = ((height - 1 - y) * width + x) * 4;
        if (Math.min(buf[i], buf[i + 1], buf[i + 2]) < 200) continue;
        ink++;
        // Within two pixels of a pixel of the box and of one that is not.
        let inBox = false;
        let outBox = false;
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            if (alone[(y + dy) * width + x + dx]) inBox = true;
            else outBox = true;
          }
        }
        if (inBox && outBox) near++;
      }
    }
    // The rectangle round the box as drawn (two pixels more) takes it in a window; without the map it would not.
    let x0 = width;
    let y0 = height;
    let x1 = 0;
    let y1 = 0;
    alone.forEach((on, k) => {
      if (!on) return;
      x0 = Math.min(x0, k % width);
      x1 = Math.max(x1, (k % width) + 1);
      y0 = Math.min(y0, Math.floor(k / width));
      y1 = Math.max(y1, Math.floor(k / width) + 1);
    });
    const rect: Rect = { x0: x0 - 2, y0: y0 - 2, x1: x1 + 2, y1: y1 + 2 };
    draw(traced, width, height, info);
    const mapped = engine.projection();
    const boxMapped = !!mapped && itemsInBox(traced, rect, 'window', 'PART', mapped).includes(subject);
    // The faces' id pass in the middle of the box as drawn.
    const inner: Rect = { x0: (x0 + x1) / 2 - 3, y0: (y0 + y1) / 2 - 3, x1: (x0 + x1) / 2 + 3, y1: (y0 + y1) / 2 + 3 };
    const facesMapped = engine.visibleTriangles(subject, inner)?.size ?? 0;
    // The same without the lens's numbers: what the undistorted picture has there.
    draw(traced, width, height, null);
    const unmapped = engine.projection();
    const boxUnmapped = !!unmapped && itemsInBox(traced, rect, 'window', 'PART', unmapped).includes(subject);
    const facesUnmapped = engine.visibleTriangles(subject, inner)?.size ?? 0;
    const gizmo = gizmoRun(traced, width, height, info);
    result.profiles[name] = { run, outline: { ink, near }, box: { mapped: boxMapped, unmapped: boxUnmapped }, faces: { mapped: facesMapped, unmapped: facesUnmapped }, gizmo };
  }
  return result;
};

window.lensPickReady = true;
