// Selection by box with the Select tool (UI.md §4.1): window and crossing on the projected geometry of parts, groups
// and models, the faces that show in a rectangle, the modifiers, the mouse schemes (a plain drag stays an orbit
// where the left button orbits), and the command that applies it to the store. The pointer is checked in the
// browser by tools/box-select-check.mjs; here the viewport is a stub that projects with a plain orthographic matrix.

import { describe, expect, it } from 'vitest';
import {
  applyBox,
  boxArmed,
  boxFromDrag,
  CLICK_PIXELS,
  clickModeOf,
  clickMods,
  clipVertices,
  combineOf,
  facesInBox,
  isClick,
  itemsInBox,
  polygonInside,
  polygonTouches,
  triangleOnScreen,
  type Mods,
  type Projection,
  type Rect,
} from '../src/core/box-select';
import { buildExample } from '../src/core/example';
import { mat4Multiply, type Mat4 } from '../src/core/math';
import { buildMesh, getMesh, type MeshData } from '../src/core/meshes';
import { partsUnder, worldMatrix, type NodeId } from '../src/core/scene';
import { createInitialState, createStore, reduce, type ProjectState } from '../src/core/store';
import * as cmd from '../src/ui/commands';
import type { AppServices, ViewportPort } from '../src/ui/ports';
import type { Ctx } from '../src/ui/reactive';
import { createUiStore } from '../src/ui/ui-state';
import { cadBox, sceneWith } from './cad-fixtures';
import { keyIds } from './helpers';

const none: Mods = { shift: false, ctrl: false, meta: false, alt: false };
const mods = (m: Partial<Mods>): Mods => ({ ...none, ...m });

// --- A viewport that looks along +Y (front) or down -Z (top) with an orthographic camera ----------------------

const W = 800;
const H = 600;

/** clip = M * (x, y, z, 1); one millimetre is `s` pixels and the world origin is at (ox, oy) of the screen. */
function ortho(kind: 'front' | 'top', s: number, ox = W / 2, oy = H / 2): Mat4 {
  // screen x = ox + s X; screen y = oy - s U with U = Z (front) or Y (top).
  const m = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1];
  m[0] = (2 * s) / W;
  m[12] = (2 * ox) / W - 1;
  const up = kind === 'front' ? 9 : 5;
  m[up] = (2 * s) / H;
  m[13] = 1 - (2 * oy) / H;
  return m;
}

function projection(state: ProjectState, view: Mat4): Projection {
  return { width: W, height: H, mvp: (id) => (state.scene.nodes[id]?.mesh ? mat4Multiply(view, worldMatrix(state, id)) : null) };
}

/** The screen bounds of a part: where its vertices land. */
function bounds(state: ProjectState, id: NodeId, view: Mat4): Rect {
  const data = getMesh(state.scene.nodes[id].mesh!.id)!;
  const clip = clipVertices(data.positions, mat4Multiply(view, worldMatrix(state, id)));
  const r = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (let v = 0; v < clip.length / 3; v++) {
    const x = (clip[3 * v] / clip[3 * v + 2] * 0.5 + 0.5) * W;
    const y = (1 - (clip[3 * v + 1] / clip[3 * v + 2] * 0.5 + 0.5)) * H;
    r.x0 = Math.min(r.x0, x);
    r.x1 = Math.max(r.x1, x);
    r.y0 = Math.min(r.y0, y);
    r.y1 = Math.max(r.y1, y);
  }
  return r;
}

const grow = (r: Rect, d: number): Rect => ({ x0: r.x0 - d, y0: r.y0 - d, x1: r.x1 + d, y1: r.y1 + d });
const union = (a: Rect, b: Rect): Rect => ({ x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) });
const centre = (r: Rect): { x: number; y: number } => ({ x: (r.x0 + r.x1) / 2, y: (r.y0 + r.y1) / 2 });
const tiny = (c: { x: number; y: number }): Rect => ({ x0: c.x - 1, y0: c.y - 1, x1: c.x + 1, y1: c.y + 1 });

const NAMES = { model: 'Bottle', closure: 'Closure', base: 'Base', body: 'Body', label: 'Label', collar: 'Collar', cap: 'Cap' };
function bottle(): ProjectState {
  return reduce(createInitialState(), { type: 'scene/addModel', payload: buildExample(NAMES), replace: true });
}
const FRONT = ortho('front', 4, W / 2, H - 40);

// --- The gesture ---------------------------------------------------------------------------------------------

describe('the box a drag makes', () => {
  it('left to right is a window, right to left is crossing; the rectangle is the same either way', () => {
    expect(boxFromDrag(10, 20, 110, 90)).toEqual({ rect: { x0: 10, y0: 20, x1: 110, y1: 90 }, mode: 'window' });
    expect(boxFromDrag(110, 90, 10, 20)).toEqual({ rect: { x0: 10, y0: 20, x1: 110, y1: 90 }, mode: 'crossing' });
    // Up and to the right is a window too, down and to the left is crossing: only the horizontal direction counts.
    expect(boxFromDrag(10, 90, 110, 20)).toEqual({ rect: { x0: 10, y0: 20, x1: 110, y1: 90 }, mode: 'window' });
    expect(boxFromDrag(110, 20, 10, 90).mode).toBe('crossing');
    expect(boxFromDrag(50, 50, 50, 90).mode).toBe('window');
  });

  it('a drag of a few pixels is a click', () => {
    expect(CLICK_PIXELS).toBe(4);
    expect(isClick(0, 0)).toBe(true);
    expect(isClick(3, 3)).toBe(false);
    expect(isClick(2, 2)).toBe(true);
    expect(isClick(4, 0)).toBe(true);
    expect(isClick(5, 0)).toBe(false);
    expect(isClick(-3, 2)).toBe(true);
    expect(isClick(-3, 4)).toBe(false);
    expect(isClick(4, 4)).toBe(false);
  });

  it('a box replaces; Shift adds, Alt (Option) takes out; Ctrl (Cmd) only arms it', () => {
    expect(combineOf(none)).toBe('replace');
    expect(combineOf(mods({ ctrl: true }))).toBe('replace');
    expect(combineOf(mods({ meta: true }))).toBe('replace');
    expect(combineOf(mods({ shift: true }))).toBe('add');
    expect(combineOf(mods({ ctrl: true, shift: true }))).toBe('add');
    expect(combineOf(mods({ meta: true, shift: true }))).toBe('add');
    expect(combineOf(mods({ alt: true }))).toBe('remove');
    expect(combineOf(mods({ ctrl: true, alt: true }))).toBe('remove');
    expect(combineOf(mods({ meta: true, alt: true }))).toBe('remove');
    expect(combineOf(mods({ alt: true, shift: true }))).toBe('remove');
  });

  it('a click: plain replaces, Shift adds, Ctrl (Cmd) takes in or out, Alt takes out', () => {
    expect(clickModeOf(none)).toBe('set');
    expect(clickModeOf(mods({ shift: true }))).toBe('add');
    expect(clickModeOf(mods({ ctrl: true }))).toBe('toggle');
    expect(clickModeOf(mods({ meta: true }))).toBe('toggle');
    expect(clickModeOf(mods({ alt: true }))).toBe('remove');
  });

  it('applies the box to the selection that was', () => {
    expect(applyBox(['a', 'b'], ['c'], 'replace')).toEqual(['c']);
    expect(applyBox(['a', 'b'], ['b', 'c'], 'add')).toEqual(['a', 'b', 'c']);
    expect(applyBox(['a', 'b'], ['b', 'c'], 'remove')).toEqual(['a']);
    expect(applyBox(['a'], [], 'replace')).toEqual([]);
    expect(applyBox([], ['x'], 'remove')).toEqual([]);
  });
});

describe('which presses start a box: the camera keeps its buttons', () => {
  const schemes = ['LEFT', 'ALT_LEFT', 'MIDDLE'] as const;

  it('Ctrl (Cmd) + drag is a box in every scheme, with the Select tool and the Move tool', () => {
    for (const scheme of schemes) {
      for (const tool of ['select', 'move']) {
        expect(boxArmed(scheme, tool, mods({ ctrl: true }))).toBe(true);
        expect(boxArmed(scheme, tool, mods({ meta: true }))).toBe(true);
        expect(boxArmed(scheme, tool, mods({ ctrl: true, shift: true }))).toBe(true);
        expect(boxArmed(scheme, tool, mods({ meta: true, shift: true }))).toBe(true);
        expect(boxArmed(scheme, tool, mods({ ctrl: true, alt: true }))).toBe(true);
        expect(boxArmed(scheme, tool, mods({ meta: true, alt: true }))).toBe(true);
        expect(boxArmed(scheme, tool, mods({ ctrl: true, shift: true, alt: true }))).toBe(true);
      }
    }
  });

  it('where the left button orbits (the default), only Ctrl (Cmd) arms the box: a plain, Shift or Alt drag is the camera', () => {
    expect(boxArmed('LEFT', 'select', none)).toBe(false);
    expect(boxArmed('LEFT', 'select', mods({ shift: true }))).toBe(false);
    expect(boxArmed('LEFT', 'select', mods({ alt: true }))).toBe(false);
    expect(boxArmed('LEFT', 'select', mods({ shift: true, alt: true }))).toBe(false);
    expect(boxArmed('LEFT', 'move', none)).toBe(false);
    expect(boxArmed('LEFT', 'move', mods({ shift: true }))).toBe(false);
    expect(boxArmed('LEFT', 'move', mods({ alt: true }))).toBe(false);
  });

  it('where Alt + left button orbits, a plain drag (or with Shift) boxes and Alt alone is the camera', () => {
    expect(boxArmed('ALT_LEFT', 'select', none)).toBe(true);
    expect(boxArmed('ALT_LEFT', 'select', mods({ shift: true }))).toBe(true);
    expect(boxArmed('ALT_LEFT', 'select', mods({ alt: true }))).toBe(false);
    expect(boxArmed('ALT_LEFT', 'select', mods({ alt: true, shift: true }))).toBe(false);
  });

  it('where the middle button orbits, the left button is free: every press boxes', () => {
    for (const m of [none, mods({ shift: true }), mods({ alt: true }), mods({ ctrl: true }), mods({ shift: true, alt: true })]) expect(boxArmed('MIDDLE', 'select', m)).toBe(true);
  });

  it('only the Select tool and the Move tool box; Orbit, Pan and Zoom own the left button', () => {
    for (const tool of ['orbit', 'pan', 'zoom']) {
      for (const scheme of schemes) for (const m of [none, mods({ shift: true }), mods({ ctrl: true }), mods({ meta: true, alt: true })]) expect(boxArmed(scheme, tool, m)).toBe(false);
    }
  });
});

describe('a press that did not arm a box is a click', () => {
  it('Alt takes out, except where Alt + left button orbits and Alt is the camera', () => {
    const alt = mods({ alt: true });
    expect(clickModeOf(clickMods('LEFT', alt))).toBe('remove');
    expect(clickModeOf(clickMods('MIDDLE', alt))).toBe('remove');
    expect(clickModeOf(clickMods('ALT_LEFT', alt))).toBe('set');
    expect(clickModeOf(clickMods('ALT_LEFT', mods({ alt: true, shift: true })))).toBe('add');
  });

  it('the other modifiers are kept in every scheme', () => {
    for (const scheme of ['LEFT', 'ALT_LEFT', 'MIDDLE'] as const) {
      expect(clickMods(scheme, none)).toEqual(none);
      expect(clickModeOf(clickMods(scheme, mods({ shift: true })))).toBe('add');
      expect(clickModeOf(clickMods(scheme, mods({ ctrl: true })))).toBe('toggle');
      expect(clickModeOf(clickMods(scheme, mods({ meta: true })))).toBe('toggle');
    }
  });
});

// --- Geometry on the screen -----------------------------------------------------------------------------------

describe('triangles and rectangles on the screen', () => {
  const R: Rect = { x0: 100, y0: 100, x1: 200, y1: 200 };
  const tri = (...p: number[]) => p;

  it('a window needs every corner inside; the border counts', () => {
    expect(polygonInside(R, tri(110, 110, 190, 110, 150, 190))).toBe(true);
    expect(polygonInside(R, tri(100, 100, 200, 100, 200, 200))).toBe(true);
    expect(polygonInside(R, tri(110, 110, 190, 110, 201, 190))).toBe(false);
    expect(polygonInside(R, [])).toBe(false);
  });

  it('crossing: a corner inside, the rectangle inside the triangle, or an edge through it with no corner inside', () => {
    expect(polygonTouches(R, tri(150, 150, 300, 150, 300, 300))).toBe(true);
    // The triangle swallows the rectangle.
    expect(polygonTouches(R, tri(0, 0, 400, 0, 0, 400))).toBe(true);
    // A thin triangle slicing across with all its corners outside.
    expect(polygonTouches(R, tri(50, 140, 250, 150, 50, 160))).toBe(true);
    // The border counts.
    expect(polygonTouches(R, tri(200, 200, 300, 200, 300, 300))).toBe(true);
    expect(polygonTouches(R, tri(200, 100, 300, 100, 300, 200))).toBe(true);
  });

  it('crossing: bounds that overlap are not enough, the triangle itself must reach the rectangle', () => {
    // The corner of the box of this triangle is in the rectangle; the triangle is not.
    expect(polygonTouches(R, tri(90, 90, 210, 90, 90, 210))).toBe(true);
    expect(polygonTouches(R, tri(0, 0, 300, 0, 0, 90))).toBe(false);
    expect(polygonTouches({ x0: 150, y0: 150, x1: 250, y1: 250 }, tri(0, 0, 220, 0, 0, 220))).toBe(false);
    expect(polygonTouches(R, tri(300, 300, 400, 300, 300, 400))).toBe(false);
    expect(polygonTouches(R, tri(0, 0, 10, 0, 5, 5))).toBe(false);
    expect(polygonTouches(R, [])).toBe(false);
  });

  it('a triangle that passes behind the camera is cut where it does: clip w is the distance', () => {
    // Three corners in clip space (x, y, w): two in front, one behind (w < 0).
    const clip = Float64Array.from([-0.5, 0, 1, 0.5, 0, 1, 0, 0.5, -1]);
    const poly = triangleOnScreen(clip, 0, 1, 2, 800, 600);
    expect(poly.length).toBe(8);
    expect(poly.every(Number.isFinite)).toBe(true);
    // Every corner of the cut is in front: it is a polygon of the screen, not a mirror of what lies behind.
    const all = Float64Array.from([-0.5, 0, -1, 0.5, 0, -1, 0, 0.5, -1]);
    expect(triangleOnScreen(all, 0, 1, 2, 800, 600)).toEqual([]);
    const front = Float64Array.from([-0.5, 0, 1, 0.5, 0, 1, 0, 0.5, 1]);
    expect(triangleOnScreen(front, 0, 1, 2, 800, 600)).toEqual([200, 300, 600, 300, 400, 150]);
  });
});

// --- Models, groups and parts -----------------------------------------------------------------------------------

describe('models, groups and parts by box', () => {
  const s = bottle();
  const k = keyIds(s);
  const proj = projection(s, FRONT);
  const b = (key: string) => bounds(s, k[key], FRONT);
  const ids = (level: 'MODEL' | 'GROUP' | 'PART', rect: Rect, mode: 'window' | 'crossing', state = s, p = proj) => itemsInBox(state, rect, mode, level, p);

  it('fixtures: the bottle is on the screen, and the cap is above the collar', () => {
    for (const key of ['base', 'body', 'label', 'collar', 'cap']) {
      const r = b(key);
      expect(r.x0).toBeGreaterThan(0);
      expect(r.x1).toBeLessThan(W);
      expect(r.y0).toBeGreaterThan(0);
      expect(r.y1).toBeLessThan(H);
    }
    expect(b('cap').y1).toBeLessThanOrEqual(b('collar').y0 + 1);
  });

  it('Part, window: the parts that lie entirely inside', () => {
    expect(ids('PART', grow(b('cap'), 1), 'window')).toEqual([k.cap]);
    // A window a hair too small for the cap takes nothing: part of it is outside.
    expect(ids('PART', grow(b('cap'), -2), 'window')).toEqual([]);
    // The whole bottle: every part.
    const all = grow(union(union(b('base'), b('body')), union(b('cap'), b('collar'))), 2);
    expect(ids('PART', all, 'window').sort()).toEqual([k.base, k.body, k.label, k.collar, k.cap].sort());
    // Cap and collar, not the body they sit on.
    expect(ids('PART', grow(union(b('cap'), b('collar')), 1), 'window').sort()).toEqual([k.cap, k.collar].sort());
  });

  it('Part, crossing: the parts the rectangle touches, however little', () => {
    expect(ids('PART', tiny(centre(b('cap'))), 'crossing')).toEqual([k.cap]);
    // The label lies on the body: a rectangle in the middle of both touches both.
    expect(ids('PART', tiny(centre(b('label'))), 'crossing').sort()).toEqual([k.body, k.label].sort());
    // A rectangle that does not reach the bottle takes nothing.
    expect(ids('PART', { x0: 0, y0: 0, x1: 20, y1: 20 }, 'crossing')).toEqual([]);
    // One that spans the bottle from side to side, at the height of the cap, touches the cap and the collar below it.
    const c = centre(b('cap'));
    expect(ids('PART', { x0: 0, y0: c.y - 1, x1: W, y1: c.y + 1 }, 'crossing')).toEqual([k.cap]);
  });

  it('Group: a window takes a group when all of its parts are inside; a part with no group stands for itself', () => {
    const closure = grow(union(b('cap'), b('collar')), 1);
    expect(ids('GROUP', closure, 'window')).toEqual([k.closure]);
    // Only the cap inside: the closure is not entirely in the window.
    expect(ids('GROUP', grow(b('cap'), 1), 'window')).toEqual([]);
    // Crossing the cap alone reaches the closure; crossing the body reaches the body itself (it has no group).
    expect(ids('GROUP', tiny(centre(b('cap'))), 'crossing')).toEqual([k.closure]);
    // (The label lies on the body: a rectangle on both reaches the two, and neither is in a group.)
    expect(ids('GROUP', tiny(centre(b('label'))), 'crossing').sort()).toEqual([k.body, k.label].sort());
    expect(ids('GROUP', tiny(centre(b('base'))), 'crossing')).toEqual([k.base]);
    // A window around the base is the base: it has no group either.
    expect(ids('GROUP', grow(b('base'), 1), 'window')).toEqual([k.base]);
  });

  it('Model: a window takes the model when everything is inside, crossing when anything is touched', () => {
    const all = grow(union(union(b('base'), b('body')), union(b('cap'), b('collar'))), 2);
    expect(ids('MODEL', all, 'window')).toEqual([k.model]);
    expect(ids('MODEL', grow(b('cap'), 1), 'window')).toEqual([]);
    expect(ids('MODEL', tiny(centre(b('cap'))), 'crossing')).toEqual([k.model]);
    expect(ids('MODEL', { x0: 0, y0: 0, x1: 20, y1: 20 }, 'crossing')).toEqual([]);
  });

  it('parts that are hidden (or inside a hidden group) are not in the box', () => {
    const hidden = reduce(s, { type: 'scene/setVisible', ids: [k.cap], visible: false });
    expect(itemsInBox(hidden, tiny(centre(b('cap'))), 'crossing', 'PART', proj)).toEqual([]);
    // A window around the closure takes the group by what is visible of it: the collar.
    const hiddenCap = itemsInBox(hidden, grow(union(b('cap'), b('collar')), 1), 'window', 'GROUP', proj);
    expect(hiddenCap).toEqual([k.closure]);
    const none = reduce(s, { type: 'scene/setVisible', ids: [k.closure], visible: false });
    expect(itemsInBox(none, grow(union(b('cap'), b('collar')), 1), 'window', 'GROUP', proj)).toEqual([]);
  });

  it('nothing is occluded: a part behind another is in the box too', () => {
    // From the front the label is in front of the body and the body's far wall is behind it: both are taken.
    expect(ids('PART', tiny(centre(b('label'))), 'crossing')).toContain(k.body);
  });

  it('a part with a corner behind the camera is not inside a window, but crossing still finds what is in front', () => {
    // A perspective-like matrix: w = 1 + 0.01 * (y offset), the part straddles w = 0 when moved far enough.
    const m = ortho('front', 4, W / 2, H - 40);
    const near = [...m];
    // clip w = 1 + y / 20: the vertices with y < -20 are behind the camera.
    near[7] = 1 / 20;
    near[15] = 1;
    const p: Projection = { width: W, height: H, mvp: (id) => (s.scene.nodes[id]?.mesh ? mat4Multiply(near, worldMatrix(s, id)) : null) };
    const big: Rect = { x0: -1e6, y0: -1e6, x1: 1e6, y1: 1e6 };
    // The bottle is about 63 mm wide, so some of its vertices are behind the camera: no window takes those parts.
    const behind = partsUnder(s, s.scene.roots).filter((part) => {
      const data = getMesh(s.scene.nodes[part].mesh!.id)!;
      const clip = clipVertices(data.positions, p.mvp(part)!);
      for (let v = 0; v < clip.length / 3; v++) if (clip[3 * v + 2] <= 0) return true;
      return false;
    });
    expect(behind.length).toBeGreaterThan(0);
    for (const part of behind) expect(itemsInBox(s, big, 'window', 'PART', p)).not.toContain(part);
    expect(itemsInBox(s, big, 'crossing', 'PART', p).length).toBeGreaterThan(0);
  });
});

// --- Faces ------------------------------------------------------------------------------------------------------

/** A plate `nx` by `ny` by 1 seen from above: the top, the bottom under it, and four sides that are lines on the screen. */
function plate(nx: number, ny: number): { data: MeshData; top: number[]; bottom: number[]; sides: number[] } {
  type P = [number, number, number];
  const tris: [P, P, P][] = [];
  const quad = (a: P, b: P, c: P, d: P) => tris.push([a, b, c], [a, c, d]);
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) quad([i, j, 1], [i + 1, j, 1], [i + 1, j + 1, 1], [i, j + 1, 1]);
  const top = tris.map((_, i) => i);
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) quad([i, j, 0], [i, j + 1, 0], [i + 1, j + 1, 0], [i + 1, j, 0]);
  const bottom = tris.map((_, i) => i).slice(top.length);
  quad([0, 0, 0], [nx, 0, 0], [nx, 0, 1], [0, 0, 1]);
  quad([nx, 0, 0], [nx, ny, 0], [nx, ny, 1], [nx, 0, 1]);
  quad([nx, ny, 0], [0, ny, 0], [0, ny, 1], [nx, ny, 1]);
  quad([0, ny, 0], [0, 0, 0], [0, 0, 1], [0, ny, 1]);
  const sides = tris.map((_, i) => i).slice(top.length + bottom.length);
  const positions = new Float32Array(tris.length * 9);
  tris.forEach((t, i) => t.forEach((p, k) => positions.set(p, 9 * i + 3 * k)));
  const built = buildMesh({ positions })!;
  return { data: built.data, top, bottom, sides };
}

describe('faces by box', () => {
  // The plate from above: 40 px a millimetre, the corner at (100, 500): it covers x 100..260, y 340..500 for 4 x 4.
  const TOP = ortho('top', 40, 100, 500);
  const p = plate(4, 4);
  const query = (rect: Rect, mode: 'window' | 'crossing', visible: Set<number> | null, extra: object = {}) => facesInBox({ data: p.data, mvp: TOP, width: W, height: H, rect, mode, visible, ...extra });
  const shown = new Set(p.top);

  it('crossing takes the whole face that shows in the rectangle, not the triangles alone', () => {
    // A rectangle over a corner of the top: the whole top comes, and only the top (it is what shows).
    expect(query({ x0: 110, y0: 460, x1: 130, y1: 490 }, 'crossing', shown)).toEqual(p.top);
  });

  it('with X-ray the faces behind count: the bottom under the top is taken too', () => {
    expect(query({ x0: 110, y0: 460, x1: 130, y1: 490 }, 'crossing', null)).toEqual([...p.top, ...p.bottom]);
  });

  it('a window takes the faces that lie entirely inside; a rectangle over half the top takes nothing', () => {
    expect(query({ x0: 100, y0: 340, x1: 180, y1: 500 }, 'window', shown)).toEqual([]);
    expect(query({ x0: 90, y0: 330, x1: 270, y1: 510 }, 'window', shown)).toEqual(p.top);
    // X-ray: everything inside, the bottom and the sides too (the sides are lines on the screen).
    expect(query({ x0: 90, y0: 330, x1: 270, y1: 510 }, 'window', null)).toEqual([...p.top, ...p.bottom, ...p.sides].sort((a, b) => a - b));
  });

  it('nothing shows, nothing is taken: a rectangle over empty space, and a face that is not in the visible set', () => {
    expect(query({ x0: 400, y0: 100, x1: 500, y1: 200 }, 'crossing', new Set())).toEqual([]);
    expect(query({ x0: 400, y0: 100, x1: 500, y1: 200 }, 'crossing', null)).toEqual([]);
    expect(query({ x0: 90, y0: 330, x1: 270, y1: 510 }, 'window', new Set())).toEqual([]);
  });

  it('the CAD faces of a part (STEP, IGES) are the faces: a top cut in two is two faces', () => {
    const faceRanges = [
      { start: 0, count: 16 },
      { start: 16, count: 16 },
      { start: 32, count: p.data.indices.length / 3 - 32 },
    ];
    // The mesh does not know its top is two faces, the ranges do. The grid goes column by column, as `plate` builds
    // it, so columns 0 and 1 are triangles 0..15 (the left half of the top) and columns 2 and 3 are 16..31.
    const left = p.top.slice(0, 16);
    const right = p.top.slice(16, 32);
    // What shows in a rectangle over the first column: those triangles only (the viewport reports what is in it).
    const crossingLeft = facesInBox({ data: p.data, faceRanges, mvp: TOP, width: W, height: H, rect: { x0: 110, y0: 460, x1: 130, y1: 490 }, mode: 'crossing', visible: new Set(p.top.slice(0, 8)) });
    expect(crossingLeft).toEqual(left);
    // A window over the left half takes the left face and not the right one.
    const window = facesInBox({ data: p.data, faceRanges, mvp: TOP, width: W, height: H, rect: { x0: 90, y0: 330, x1: 190, y1: 510 }, mode: 'window', visible: new Set(left) });
    expect(window).toEqual(left);
    // A rectangle that shows both halves takes both.
    const both = facesInBox({ data: p.data, faceRanges, mvp: TOP, width: W, height: H, rect: { x0: 170, y0: 460, x1: 190, y1: 490 }, mode: 'crossing', visible: new Set([...p.top.slice(8, 16), ...p.top.slice(16, 24)]) });
    expect(both).toEqual([...left, ...right]);
    // Without the ranges the same window takes nothing: the top is one surface and is not inside.
    expect(query({ x0: 90, y0: 330, x1: 190, y1: 510 }, 'window', shown)).toEqual([]);
  });

  it('a window around a cube takes the faces of the visible set, whole (a CAD box: two triangles a face)', () => {
    const box = cadBox();
    const view = ortho('front', 100, W / 2, H / 2);
    const rect = grow({ x0: 350, y0: 250, x1: 450, y1: 350 }, 5);
    const out = facesInBox({ data: box.data, faceRanges: box.faces, mvp: view, width: W, height: H, rect, mode: 'window', visible: new Set([0, 3]) });
    // Triangle 0 is in the first face and triangle 3 in the second: both faces lie inside the window, whole.
    expect(out).toEqual([0, 1, 2, 3]);
  });
});

// --- The command ---------------------------------------------------------------------------------------------------

describe('selecting by box in the store', () => {
  function boxCtx(state: ProjectState, seen: Record<NodeId, Set<number>> = {}) {
    const calls: { part: NodeId; rect: Rect }[] = [];
    const viewport = {
      projection: () => projection(state, FRONT),
      visibleTriangles: (part: NodeId, rect: Rect) => {
        calls.push({ part, rect });
        return seen[part] ?? new Set<number>();
      },
      pick: () => null,
    } as unknown as ViewportPort;
    const ctx: Ctx = { store: createStore(state), ui: createUiStore(), services: { viewport } as unknown as AppServices };
    return { ctx, calls };
  }
  const bottleState = bottle();
  const k = keyIds(bottleState);
  const b = (key: string) => bounds(bottleState, k[key], FRONT);

  it('replaces, adds and takes out at the Part level; the level stays', () => {
    const { ctx } = boxCtx(bottleState);
    const sel = () => ctx.store.get().selection;
    cmd.selectInBox(ctx, { rect: grow(b('cap'), 1), mode: 'window' }, 'replace');
    expect(sel()).toMatchObject({ level: 'PART', ids: [k.cap] });
    cmd.selectInBox(ctx, { rect: grow(b('collar'), 1), mode: 'window' }, 'add');
    expect(sel().ids).toEqual([k.cap, k.collar]);
    cmd.selectInBox(ctx, { rect: grow(b('cap'), 1), mode: 'window' }, 'remove');
    expect(sel().ids).toEqual([k.collar]);
    // Replacing with a box that reaches nothing clears the selection, as a click on empty space does.
    cmd.selectInBox(ctx, { rect: { x0: 0, y0: 0, x1: 10, y1: 10 }, mode: 'crossing' }, 'replace');
    expect(sel().ids).toEqual([]);
    // Selection is not undoable and does not dirty the project.
    expect(ctx.store.history().undo).toEqual([]);
    expect(ctx.store.get().meta.dirty).toBe(false);
  });

  it('follows the level: a group at Group, the model at Model', () => {
    const { ctx } = boxCtx(bottleState);
    ctx.store.dispatch({ type: 'scene/setLevel', level: 'GROUP' });
    const n = cmd.selectInBox(ctx, { rect: grow(union(b('cap'), b('collar')), 1), mode: 'window' }, 'replace');
    expect(n).toBe(1);
    expect(ctx.store.get().selection).toMatchObject({ level: 'GROUP', ids: [k.closure] });
    ctx.store.dispatch({ type: 'scene/setLevel', level: 'MODEL' });
    cmd.selectInBox(ctx, { rect: tiny(centre(b('cap'))), mode: 'crossing' }, 'replace');
    expect(ctx.store.get().selection).toMatchObject({ level: 'MODEL', ids: [k.model] });
  });

  it('at the Faces level it takes the faces that show, in the part being worked on, and adds or removes them', () => {
    const cad = sceneWith(cadBox());
    const state = cad.state;
    const data = getMesh(state.scene.nodes[cad.part].mesh!.id)!;
    expect(data.indices.length / 3).toBe(12);
    const view = ortho('front', 100, W / 2, H / 2);
    const viewport = (seen: Set<number>, calls: Rect[]) =>
      ({
        projection: () => ({ width: W, height: H, mvp: (id: NodeId) => (state.scene.nodes[id]?.mesh ? mat4Multiply(view, worldMatrix(state, id)) : null) }),
        visibleTriangles: (_part: NodeId, rect: Rect) => (calls.push(rect), seen),
        pick: () => null,
      }) as unknown as ViewportPort;
    const calls: Rect[] = [];
    const ctx: Ctx = { store: createStore(state), ui: createUiStore(), services: { viewport: viewport(new Set([0, 1, 2, 3]), calls) } as unknown as AppServices };
    ctx.store.dispatch({ type: 'scene/select', ids: [cad.part], mode: 'set', level: 'PART' });
    ctx.store.dispatch({ type: 'scene/setLevel', level: 'FACES' });
    const wide: Rect = { x0: 0, y0: 0, x1: W, y1: H };
    cmd.selectInBox(ctx, { rect: wide, mode: 'crossing' }, 'replace');
    // The visible set holds triangles 0..3: the first two CAD faces (two triangles each), whole.
    expect(ctx.store.get().selection.faces).toEqual({ part: cad.part, indices: [0, 1, 2, 3] });
    expect(calls).toEqual([wide]);
    // Remove one face; add another that shows.
    (ctx.services.viewport as unknown as { visibleTriangles: unknown }).visibleTriangles = (_p: NodeId, r: Rect) => (calls.push(r), new Set([2]));
    cmd.selectInBox(ctx, { rect: wide, mode: 'crossing' }, 'remove');
    expect(ctx.store.get().selection.faces).toEqual({ part: cad.part, indices: [0, 1] });
    (ctx.services.viewport as unknown as { visibleTriangles: unknown }).visibleTriangles = (_p: NodeId, r: Rect) => (calls.push(r), new Set([8]));
    cmd.selectInBox(ctx, { rect: wide, mode: 'crossing' }, 'add');
    expect(ctx.store.get().selection.faces).toEqual({ part: cad.part, indices: [0, 1, 8, 9] });
    // X-ray: the viewport is not asked what shows; the geometry decides (the whole cube is under a wide rectangle).
    ctx.ui.set({ boxXray: true });
    const before = calls.length;
    cmd.selectInBox(ctx, { rect: wide, mode: 'crossing' }, 'replace', { xray: true });
    expect(calls.length).toBe(before);
    expect(ctx.store.get().selection.faces!.indices).toEqual(Array.from({ length: 12 }, (_, i) => i));
    expect(ctx.store.get().selection.level).toBe('FACES');
    expect(ctx.store.history().undo).toEqual([]);
  });

  it('at the Faces level with nothing selected, the part at the middle of the box is the one', () => {
    const cad = sceneWith(cadBox());
    const state = cad.state;
    const view = ortho('front', 100, W / 2, H / 2);
    const picks: number[][] = [];
    const viewport = {
      projection: () => ({ width: W, height: H, mvp: (id: NodeId) => (state.scene.nodes[id]?.mesh ? mat4Multiply(view, worldMatrix(state, id)) : null) }),
      visibleTriangles: () => new Set([0]),
      pick: (x: number, y: number) => (picks.push([x, y]), { node: cad.part, face: 0, point: [0, 0, 0], normal: [0, 0, 1] }),
    } as unknown as ViewportPort;
    const ctx: Ctx = { store: createStore(state), ui: createUiStore(), services: { viewport } as unknown as AppServices };
    ctx.store.dispatch({ type: 'scene/setLevel', level: 'FACES' });
    expect(ctx.store.get().selection.ids).toEqual([]);
    cmd.selectInBox(ctx, { rect: { x0: 300, y0: 200, x1: 500, y1: 400 }, mode: 'crossing' }, 'replace');
    expect(picks).toEqual([[400, 300]]);
    expect(ctx.store.get().selection.faces).toEqual({ part: cad.part, indices: [0, 1] });
  });

  it('without a viewport that can project, nothing happens', () => {
    const ctx: Ctx = { store: createStore(bottleState), ui: createUiStore(), services: { viewport: null } as unknown as AppServices };
    expect(cmd.selectInBox(ctx, { rect: { x0: 0, y0: 0, x1: 10, y1: 10 }, mode: 'crossing' }, 'replace')).toBeNull();
    expect(ctx.store.get().selection.ids).toEqual([]);
  });
});
