// L4's extension: lights and cameras in the viewport. Their glyphs and the click that picks one, the move tool's gizmo
// on them (a light with its aim handle, a camera with its target; one drag, one undo entry), and Look through: the
// viewport looks from one, and Orbit, Pan and Zoom move it (a light aims where the view looks); Lock camera holds a
// camera; coming back leaves the active camera as it was.

import { describe, expect, it } from 'vitest';
import { activeCamera, cameraBasis, cameraPosition, fieldOfView, orbitFromPosition, type CameraState } from '../src/core/camera';
import { polar } from '../src/core/light-math';
import { lightAimPoint, lightFrame, lightPosition, rigPivot, type LightInstance } from '../src/core/lighting';
import { add, dot, length, normalize, rotateAbout, sub, type Vec3 } from '../src/core/math';
import { createStore, reduce, type ProjectState } from '../src/core/store';
import { gizmoTransforms } from '../src/core/transform';
import {
  glyphsOf,
  lookThroughAction,
  lookThroughCamera,
  objectFrame,
  objectGizmoAction,
  pickGlyph,
  rollOf,
  selectedObject,
  viewProjector,
  type ViewObject,
} from '../src/core/view-objects';
import { ACTIONS } from '../src/ui/shortcuts';
import { drawAllGlyphs } from '../src/ui/ui-state';
import { apply, exampleState } from './helpers';

const near = (a: readonly number[], b: readonly number[], digits = 6) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], digits));
const W = 1280;
const H = 720;

/** The example with a spot added, a second camera saved (the first one stays active) and the spot selected. */
function scene(): { s: ProjectState; spot: LightInstance; cam: CameraState } {
  let s = apply(exampleState(), { type: 'studio/addLight', kind: 'SPOT' });
  const spot = s.studio.lights[s.studio.lights.length - 1];
  const first = s.camera.active;
  s = apply(s, { type: 'camera/add', name: 'Side' });
  const id = s.camera.active;
  s = apply(s, { type: 'camera/set', id, patch: { azimuth: 60, elevation: 10 } }, { type: 'camera/activate', id: first });
  return { s, spot, cam: s.camera.cameras[id] };
}

const project = (s: ProjectState) => viewProjector(activeCamera(s), W, H, s.render.width, s.render.height);

describe('glyphs', () => {
  it('every light and every saved camera but the active one has a glyph; off, only the selected one', () => {
    const { s, spot, cam } = scene();
    const all = glyphsOf(s, { all: true });
    expect(all.filter((g) => g.obj.kind === 'LIGHT')).toHaveLength(s.studio.lights.length);
    expect(all.filter((g) => g.obj.kind === 'CAMERA').map((g) => g.obj.id)).toEqual([cam.id]);
    expect(all.every((g) => g.lines.length > 0 && g.lines.length % 2 === 0)).toBe(true);
    expect(glyphsOf(s, { all: false })).toEqual([]);
    expect(glyphsOf(s, { all: false, selected: { kind: 'LIGHT', id: spot.id } }).map((g) => g.obj.id)).toEqual([spot.id]);
    // What the view looks from has none (the view is from inside it).
    expect(glyphsOf(s, { all: true, lookThrough: { kind: 'CAMERA', id: cam.id } }).some((g) => g.obj.id === cam.id)).toBe(false);
  });

  it('a click on a glyph picks it, a click away from every glyph picks nothing', () => {
    const { s, spot } = scene();
    const glyphs = glyphsOf(s, { all: true });
    const at = project(s)(lightPosition(s, spot))!;
    expect(pickGlyph(glyphs, project(s), at.x + 3, at.y - 2)).toEqual({ kind: 'LIGHT', id: spot.id });
    expect(pickGlyph(glyphs, project(s), W / 2, 5)).toBeNull();
    // The key light: anywhere on its panel's outline (the middle of an edge), not inside it.
    const key = s.studio.lights[0];
    const f = lightFrame(s, key);
    const half = (key.size * s.scene.partSizeMm) / 2;
    const edge = project(s)(add(f.position, f.right.map((v) => v * half)))!;
    expect(pickGlyph(glyphs, project(s), edge.x, edge.y)).toEqual({ kind: 'LIGHT', id: key.id });
  });

  it('a saved camera is picked by its frustum', () => {
    const { s, cam } = scene();
    const glyph = glyphsOf(s, { all: true }).find((g) => g.obj.id === cam.id)!;
    const mid = add(glyph.lines[0], glyph.lines[1]).map((v) => v / 2) as Vec3;
    const p = project(s)(mid)!;
    expect(pickGlyph([glyph], project(s), p.x, p.y)).toEqual({ kind: 'CAMERA', id: cam.id });
  });

  it('only while the person works with lights or cameras (or one is selected) are they all drawn', () => {
    const u = { showGlyphs: true, sceneTab: 'parts' as const, lookThrough: null };
    expect(drawAllGlyphs(u, null)).toBe(false);
    expect(drawAllGlyphs({ ...u, sceneTab: 'lights' }, null)).toBe(true);
    expect(drawAllGlyphs({ ...u, sceneTab: 'cameras' }, null)).toBe(true);
    expect(drawAllGlyphs(u, { kind: 'LIGHT', id: 'l1' })).toBe(true);
    expect(drawAllGlyphs({ ...u, lookThrough: { kind: 'LIGHT', id: 'l1' } }, null)).toBe(true);
    expect(drawAllGlyphs({ ...u, showGlyphs: false, sceneTab: 'lights' }, { kind: 'LIGHT', id: 'l1' })).toBe(false);
  });

  it('the projection is what the preview draws: the target in the middle, the frame inset', () => {
    const s = exampleState();
    const cam = activeCamera(s);
    near(Object.values(viewProjector(cam, W, H, 1920, 1080)(cam.target)!), [W / 2, H / 2], 9);
    // The top of the vertical field of view is the top of the output frame (16:9 inside 16:9 less 24 px a side).
    const b = cameraBasis(cam.azimuth, cam.elevation);
    const fov = fieldOfView(cam.focalMm, 16 / 9);
    const edge = add(cam.target, b.up.map((v) => v * cam.distance * Math.tan(fov.v / 2)));
    const frameH = Math.min(H - 48, (W - 48) / (16 / 9));
    expect(viewProjector(cam, W, H, 1920, 1080)(edge)!.y).toBeCloseTo((H - frameH) / 2, 6);
    // Behind the camera nothing is drawn.
    const behind = add(cameraPosition(cam), cameraBasis(cam.azimuth, cam.elevation).forward.map((v) => -v * 10));
    expect(viewProjector(cam, W, H, 1920, 1080)(behind)).toBeNull();
  });
});

describe('the move tool on a light', () => {
  it('sits on the light with its aim handle; LOCAL axes are its right, up and back', () => {
    const { s, spot } = scene();
    const obj: ViewObject = { kind: 'LIGHT', id: spot.id };
    const placed = objectFrame(s, obj, 'LOCAL')!;
    const f = lightFrame(s, spot);
    near(placed.frame.origin, f.position, 9);
    near(placed.aim.target, f.target, 9);
    near(placed.frame.axes[0], f.right, 12);
    near(placed.frame.axes[1], f.up, 12);
    near(placed.frame.axes[2], f.forward.map((v) => -v), 12);
    expect(objectFrame(s, obj, 'GLOBAL')!.frame.axes).toEqual([[1, 0, 0], [0, 1, 0], [0, 0, 1]]);
  });

  it('moving keeps it aimed where it was; turning turns its aim about it; the aim handle moves its aim', () => {
    const { s, spot } = scene();
    const obj: ViewObject = { kind: 'LIGHT', id: spot.id };
    const { frame } = objectFrame(s, obj, 'GLOBAL')!;
    const before = lightFrame(s, spot);
    const moved = reduce(s, objectGizmoAction(s, obj, frame, { kind: 'move', amounts: [40, -25, 30] }, false)!);
    const m = moved.studio.lights.find((l) => l.id === spot.id)!;
    near(lightPosition(moved, m), add(before.position, [40, -25, 30]), 6);
    near(lightAimPoint(moved, m), before.target, 9);
    // Shift: increments of 10 mm.
    const snapped = reduce(s, objectGizmoAction(s, obj, frame, { kind: 'move', amounts: [43, 0, 0] }, true)!);
    near(lightPosition(snapped, snapped.studio.lights.find((l) => l.id === spot.id)!), add(before.position, [40, 0, 0]), 6);
    const turned = reduce(s, objectGizmoAction(s, obj, frame, { kind: 'rotate', axis: 2, deg: 30 }, false)!);
    const t = turned.studio.lights.find((l) => l.id === spot.id)!;
    near(lightPosition(turned, t), before.position, 9);
    near(lightFrame(turned, t).forward, rotateAbout(before.forward, [0, 0, 1], 30), 9);
    const target: Vec3 = add(rigPivot(s), [25, 25, 0]);
    const aimed = reduce(s, objectGizmoAction(s, obj, frame, { kind: 'aim', target }, false)!);
    near(lightAimPoint(aimed, aimed.studio.lights.find((l) => l.id === spot.id)!), target, 9);
    // Scaling is not for lights.
    expect(objectGizmoAction(s, obj, frame, { kind: 'scale', factors: [2, 2, 2] }, false)).toBeNull();
  });

  it('turning about its own axis rolls it', () => {
    const s0 = apply(exampleState(), { type: 'studio/addLight', kind: 'RECTANGLE' });
    const l = s0.studio.lights[s0.studio.lights.length - 1];
    const obj: ViewObject = { kind: 'LIGHT', id: l.id };
    const { frame } = objectFrame(s0, obj, 'LOCAL')!;
    // LOCAL Z is the back of the light: a turn of -20 about it is +20 about where it shines.
    const s = reduce(s0, objectGizmoAction(s0, obj, frame, { kind: 'rotate', axis: 2, deg: -20 }, false)!);
    const r = s.studio.lights.find((x) => x.id === l.id)!;
    expect(r.roll).toBeCloseTo(20, 6);
    near(lightFrame(s, r).forward, lightFrame(s0, l).forward, 9);
    expect(rollOf([0, 1, 0], [0, 0, 1])).toBe(0);
  });

  it('one drag is one undo entry, and undo puts it back', () => {
    const { s, spot } = scene();
    const store = createStore(s);
    const obj: ViewObject = { kind: 'LIGHT', id: spot.id };
    const { frame } = objectFrame(s, obj, 'GLOBAL')!;
    for (let i = 1; i <= 5; i++) store.dispatch(objectGizmoAction(s, obj, frame, { kind: 'move', amounts: [i * 10, 0, 0] }, false, { gesture: 'g1', label: 'move' })!);
    expect(store.history().undo).toEqual(['move']);
    store.undo();
    expect(store.get().studio.lights).toEqual(s.studio.lights);
  });
});

describe('the move tool on a camera', () => {
  it('moves the camera and keeps its target; turns and aims it; a locked camera has no gizmo', () => {
    const { s, cam } = scene();
    const obj: ViewObject = { kind: 'CAMERA', id: cam.id };
    const { frame, aim } = objectFrame(s, obj, 'LOCAL')!;
    const pos = cameraPosition(cam);
    near(frame.origin, pos, 9);
    near(aim.target, cam.target, 9);
    const moved = reduce(s, objectGizmoAction(s, obj, frame, { kind: 'move', amounts: [0, 50, 0] }, false)!);
    const m = moved.camera.cameras[cam.id];
    near(cameraPosition(m), add(pos, frame.axes[1].map((v) => v * 50)), 6);
    near(m.target, cam.target, 9);
    // The active camera does not move.
    expect(moved.camera.cameras[moved.camera.active]).toBe(s.camera.cameras[s.camera.active]);
    const turned = reduce(s, objectGizmoAction(s, obj, frame, { kind: 'rotate', axis: 1, deg: 10 }, false)!);
    near(cameraPosition(turned.camera.cameras[cam.id]), pos, 6);
    const target: Vec3 = add(cam.target, [30, 0, 10]);
    const aimed = reduce(s, objectGizmoAction(s, obj, frame, { kind: 'aim', target }, false)!);
    near(aimed.camera.cameras[cam.id].target, target, 9);
    near(cameraPosition(aimed.camera.cameras[cam.id]), pos, 6);
    const locked = apply(s, { type: 'camera/set', id: cam.id, patch: { locked: true } });
    expect(objectFrame(locked, obj, 'GLOBAL')).toBeNull();
    expect(objectGizmoAction(locked, obj, frame, { kind: 'move', amounts: [10, 0, 0] }, false)).toBeNull();
  });

  it('a selected light or camera is the object the gizmo acts on, not the parts', () => {
    const { s, spot, cam } = scene();
    expect(selectedObject(s)).toEqual({ kind: 'LIGHT', id: spot.id });
    expect(selectedObject(apply(s, { type: 'scene/select', ids: [cam.id], mode: 'set' }))).toEqual({ kind: 'CAMERA', id: cam.id });
    expect(selectedObject(apply(s, { type: 'scene/select', ids: [], mode: 'set' }))).toBeNull();
    // The parts' gizmo maths never see a light.
    expect(gizmoTransforms(s, [spot.id], { origin: [0, 0, 0], axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]] }, { kind: 'move', amounts: [1, 0, 0] }, false)).toEqual({});
  });
});

describe('Look through', () => {
  it('from a light: at the light, looking at its aim; a spot fits its cone', () => {
    const { s, spot } = scene();
    const view = lookThroughCamera(s, { kind: 'LIGHT', id: spot.id })!;
    near(cameraPosition(view), lightPosition(s, spot), 6);
    near(view.target, lightAimPoint(s, spot), 9);
    expect(view.projection).toBe('PERSPECTIVE');
    // The cone's half-angle fills half the frame's shorter side (16:9: the height).
    const half = Math.atan(18 / (16 / 9) / view.focalMm);
    expect((half * 360) / Math.PI).toBeCloseTo(spot.spread, 6);
    // The active camera is the view already; something gone is nothing to look through.
    expect(lookThroughCamera(s, { kind: 'CAMERA', id: s.camera.active })).toBeNull();
    expect(lookThroughCamera(s, { kind: 'LIGHT', id: 'gone' })).toBeNull();
  });

  it('orbit, pan and zoom move the light; it aims where the view looks; it is one undo entry and the camera stays', () => {
    const { s, spot } = scene();
    const obj: ViewObject = { kind: 'LIGHT', id: spot.id };
    const view = lookThroughCamera(s, obj)!;
    const store = createStore(s);
    // Orbit: 20 degrees round the target; pan: the target and the view move together; zoom: closer.
    const steps = [
      { ...view, azimuth: view.azimuth + 20 },
      { ...view, azimuth: view.azimuth + 20, target: add(view.target, [10, 0, 5]) },
      { ...view, azimuth: view.azimuth + 20, target: add(view.target, [10, 0, 5]), distance: view.distance * 0.7 },
    ];
    for (const v of steps) store.dispatch(lookThroughAction(store.get(), obj, v, { gesture: 'orbit1', label: 'look' })!);
    const final = steps[2];
    const l = store.get().studio.lights.find((x) => x.id === spot.id)!;
    near(lightPosition(store.get(), l), add(final.target, polar(final.azimuth, final.elevation, final.distance)), 6);
    near(lightAimPoint(store.get(), l), final.target, 6);
    expect(store.history().undo).toEqual(['look']);
    expect(store.get().camera).toBe(s.camera);
    // The view from it again is the view the navigation left.
    const again = lookThroughCamera(store.get(), obj)!;
    near([again.azimuth, again.elevation, again.distance], [final.azimuth, final.elevation, final.distance], 6);
    // Unchanged: no entry.
    expect(lookThroughAction(store.get(), obj, again)).toBeNull();
    store.undo();
    expect(store.get().studio.lights).toEqual(s.studio.lights);
  });

  it('from a saved camera: the navigation moves that camera, not the active one; Lock camera holds it', () => {
    const { s, cam } = scene();
    const obj: ViewObject = { kind: 'CAMERA', id: cam.id };
    expect(lookThroughCamera(s, obj)).toBe(cam);
    const a = lookThroughAction(s, obj, { azimuth: cam.azimuth + 15, elevation: cam.elevation, distance: cam.distance, target: cam.target })!;
    const t = reduce(s, a);
    expect(t.camera.cameras[cam.id].azimuth).toBeCloseTo(cam.azimuth + 15, 9);
    expect(t.camera.cameras[t.camera.active]).toBe(s.camera.cameras[s.camera.active]);
    expect(t.camera.active).toBe(s.camera.active);
    const locked = apply(s, { type: 'camera/set', id: cam.id, patch: { locked: true } });
    expect(lookThroughAction(locked, obj, { azimuth: cam.azimuth + 15, elevation: cam.elevation, distance: cam.distance, target: cam.target })).toBeNull();
    expect(lookThroughCamera(locked, obj)!.locked).toBe(true);
  });

  it('Ctrl/⌘ ⇧ L looks through; Esc comes back first', () => {
    const a = ACTIONS.find((x) => x.id === 'lookThrough')!;
    expect(a.keys).toBe('mod+shift+l');
    expect(ACTIONS.filter((x) => x.keys === 'mod+shift+l')).toHaveLength(1);
  });

  it('a light seen from a camera looking at it is in the middle of the view', () => {
    const { s, spot } = scene();
    const pos = lightPosition(s, spot);
    const cam = { ...activeCamera(s), ...orbitFromPosition(cameraPosition(activeCamera(s)), pos), target: pos };
    const p = viewProjector(cam, W, H, 1920, 1080)(pos)!;
    near([p.x, p.y], [W / 2, H / 2], 6);
    expect(dot(normalize(sub(pos, cameraPosition(cam))), cameraBasis(cam.azimuth, cam.elevation).forward)).toBeCloseTo(1, 9);
    expect(length(sub(pos, cameraPosition(cam)))).toBeGreaterThan(0);
  });
});
