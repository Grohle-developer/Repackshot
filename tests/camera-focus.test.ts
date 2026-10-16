import { describe, expect, it } from 'vitest';
import { activeCamera, cameraBasis, cameraPosition, focusDistanceTo, focusFollowsOrbit, orbitPatch, type CameraState } from '../src/core/camera';
import { add, dot, length, normalize, scale, sub, type Vec3 } from '../src/core/math';
import { createStore } from '../src/core/store';
import { focusPickAction, lookThroughAction, objectGizmoAction, type ViewObject } from '../src/core/view-objects';
import { apply, exampleState } from './helpers';

// The engine focuses a plane at right angles to the view axis (rt-core `Camera::generate_ray`):
// a ray through the lens centre in direction `dir` is in focus at `position + dir * (focus / dir·forward)`.
function engineFocusPoint(position: Vec3, forward: Vec3, through: Vec3, focus: number): Vec3 {
  const dir = normalize(sub(through, position));
  return add(position, scale(dir, focus / dot(dir, forward)));
}

const cam = { azimuth: -35, elevation: 18, distance: 900, target: [0, 0, 60] as Vec3 };

describe('focus with a click (user report: the click did not focus exactly on the clicked point)', () => {
  const pos = cameraPosition(cam);
  const { forward, right, up } = cameraBasis(cam.azimuth, cam.elevation);

  it('puts a point off the centre of the frame exactly on the focus plane', () => {
    const point = add(pos, add(scale(forward, 500), add(scale(right, 220), scale(up, -140))));
    const focus = focusDistanceTo(cam, point);
    expect(focus).toBeCloseTo(500, 6);
    const p = engineFocusPoint(pos, forward, point, focus);
    expect(length(sub(p, point))).toBeLessThan(1e-6);
    // The straight-line distance (what the click used before) focuses about 66 mm behind the point.
    const straight = length(sub(point, pos));
    expect(length(sub(engineFocusPoint(pos, forward, point, straight), point))).toBeGreaterThan(50);
  });

  it('is the straight-line distance for a point on the view axis', () => {
    const point = add(pos, scale(forward, 750));
    expect(focusDistanceTo(cam, point)).toBeCloseTo(length(sub(point, pos)), 6);
  });

  it('never goes below 1 mm, even for a point beside or behind the lens', () => {
    expect(focusDistanceTo(cam, add(pos, scale(right, 100)))).toBe(1);
    expect(focusDistanceTo(cam, add(pos, scale(forward, -100)))).toBe(1);
  });
});

// The view the navigation reports when a gesture ends (preview.ts ViewChange): the camera's own orbit.
const viewOf = (c: CameraState) => ({ azimuth: c.azimuth, elevation: c.elevation, distance: c.distance, target: c.target });
const pickPoint = (c: CameraState, along: number): Vec3 => add(cameraPosition(c), scale(cameraBasis(c.azimuth, c.elevation).forward, along));

describe('orbit patch (user report: Focus with a click was undone by the same click)', () => {
  const fresh = activeCamera(exampleState());

  it('a fresh camera has its focus at the orbit distance, and a picked one does not', () => {
    expect(focusFollowsOrbit(fresh)).toBe(true);
    expect(focusFollowsOrbit({ ...fresh, focusDistance: fresh.distance - 28 })).toBe(false);
  });

  it('a view that is the camera\'s own gives no patch, whatever the focus is (the click that ended a gesture that did not move)', () => {
    expect(orbitPatch(fresh, viewOf(fresh))).toBeNull();
    const picked = { ...fresh, focusDistance: 660 };
    expect(orbitPatch(picked, viewOf(picked))).toBeNull();
    // Float noise and a whole turn of azimuth are the same view.
    expect(orbitPatch(picked, { ...viewOf(picked), azimuth: picked.azimuth + 360, distance: picked.distance * (1 + 1e-9) })).toBeNull();
  });

  it('an orbit takes the focus along when it sat at the orbit distance', () => {
    const patch = orbitPatch(fresh, { ...viewOf(fresh), azimuth: fresh.azimuth + 30, distance: fresh.distance * 0.8 })!;
    expect(patch.azimuth).toBeCloseTo(fresh.azimuth + 30, 9);
    expect(patch.distance).toBeCloseTo(fresh.distance * 0.8, 9);
    expect(patch.focusDistance).toBeCloseTo(fresh.distance * 0.8, 9);
  });

  it('an orbit after a focus pick, or a typed focus, keeps the focus', () => {
    const picked = { ...fresh, focusDistance: 660 };
    const patch = orbitPatch(picked, { ...viewOf(picked), azimuth: picked.azimuth + 30, distance: picked.distance * 0.8 })!;
    expect(patch.azimuth).toBeCloseTo(picked.azimuth + 30, 9);
    expect(patch).not.toHaveProperty('focusDistance');
    // Pan alone (the target) is a change too.
    expect(orbitPatch(picked, { ...viewOf(picked), target: add(picked.target, [10, 0, 0]) })).toEqual({ ...viewOf(picked), target: add(picked.target, [10, 0, 0]) });
  });

  it('the width of an orthographic view is part of the view', () => {
    const ortho = { ...fresh, projection: 'ORTHOGRAPHIC' as const, orthoWidth: 320 };
    expect(orbitPatch(ortho, { ...viewOf(ortho), orthoWidth: 320 })).toBeNull();
    expect(orbitPatch(ortho, { ...viewOf(ortho), orthoWidth: 250 })!.orthoWidth).toBe(250);
  });

  it('click to focus, then the click\'s own end of gesture: the focus stays and the undo entry is the focus one', () => {
    const store = createStore(exampleState());
    const cam = activeCamera(store.get());
    const point = pickPoint(cam, cam.distance - 28);
    store.dispatch(focusPickAction(store.get(), null, point, { label: 'focus click' })!);
    const picked = activeCamera(store.get());
    expect(picked.focusDistance).toBeCloseTo(cam.distance - 28, 6);
    // main.ts: preview.onViewChange(view) on the pointer-up of that same click.
    const patch = orbitPatch(picked, viewOf(picked));
    if (patch) store.dispatch({ type: 'camera/set', id: picked.id, patch, label: 'orbit' });
    expect(activeCamera(store.get()).focusDistance).toBeCloseTo(cam.distance - 28, 6);
    expect(store.history().undo.at(-1)).toBe('focus click');
    // Typed focus, then a click that selects a part: the same.
    store.dispatch({ type: 'camera/set', id: picked.id, patch: { focusDistance: 638 } });
    const typed = activeCamera(store.get());
    expect(orbitPatch(typed, viewOf(typed))).toBeNull();
  });

  it('Look through a saved camera: its focus is kept by a click and followed only if it followed', () => {
    let s = apply(exampleState(), { type: 'camera/add', name: 'Side' });
    const id = s.camera.active;
    s = apply(s, { type: 'camera/set', id, patch: { azimuth: 60, focusDistance: 500 } }, { type: 'camera/activate', id: 'cam1' });
    const obj: ViewObject = { kind: 'CAMERA', id };
    const side = s.camera.cameras[id];
    expect(lookThroughAction(s, obj, viewOf(side))).toBeNull();
    const orbit = lookThroughAction(s, obj, { ...viewOf(side), azimuth: 80 })!;
    expect(orbit.type === 'camera/set' && orbit.patch).toMatchObject({ azimuth: 80 });
    expect(orbit.type === 'camera/set' && orbit.patch).not.toHaveProperty('focusDistance');
    // A camera whose focus sat at its distance takes the new distance.
    const following = apply(s, { type: 'camera/set', id, patch: { focusDistance: side.distance } });
    const zoom = lookThroughAction(following, obj, { ...viewOf(side), distance: side.distance * 0.5 })!;
    expect(zoom.type === 'camera/set' && zoom.patch.focusDistance).toBeCloseTo(side.distance * 0.5, 9);
  });

  it('the camera gizmo keeps using the same rule', () => {
    const s = apply(exampleState(), { type: 'camera/set', id: 'cam1', patch: { focusDistance: 640 } });
    const cam = activeCamera(s);
    const a = objectGizmoAction(s, { kind: 'CAMERA', id: cam.id }, { origin: cameraPosition(cam), axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]] }, { kind: 'aim', target: add(cam.target, [20, 0, 0]) }, false);
    expect(a?.type === 'camera/set' && a.patch).not.toHaveProperty('focusDistance');
  });
});

describe('focus with a click, measured from the camera that is seen', () => {
  it('the active camera when nothing is looked through', () => {
    const s = exampleState();
    const cam = activeCamera(s);
    const a = focusPickAction(s, null, pickPoint(cam, 500))!;
    expect(a).toMatchObject({ type: 'camera/set', id: cam.id });
    expect(a.type === 'camera/set' && a.patch.focusDistance).toBeCloseTo(500, 6);
  });

  it('looking through a saved camera, that camera takes the focus, measured from it', () => {
    let s = apply(exampleState(), { type: 'camera/add', name: 'Side' });
    const side = s.camera.active;
    s = apply(s, { type: 'camera/set', id: side, patch: { azimuth: 75, elevation: 5, distance: 700 } }, { type: 'camera/activate', id: 'cam1' });
    const seen = s.camera.cameras[side];
    const point = pickPoint(seen, 420);
    const a = focusPickAction(s, { kind: 'CAMERA', id: side }, point)!;
    expect(a).toMatchObject({ type: 'camera/set', id: side });
    expect(a.type === 'camera/set' && a.patch.focusDistance).toBeCloseTo(420, 6);
    // The active camera sees that point at another distance: it is not the one measured.
    expect(Math.abs(focusDistanceTo(activeCamera(s), point) - 420)).toBeGreaterThan(1);
    expect(apply(s, a).camera.cameras.cam1.focusDistance).toBe(activeCamera(s).focusDistance);
  });

  it('looking through a light, the active camera takes the focus: a light has none', () => {
    const s = apply(exampleState(), { type: 'studio/addLight', kind: 'SPOT' });
    const spot = s.studio.lights[s.studio.lights.length - 1];
    const cam = activeCamera(s);
    const a = focusPickAction(s, { kind: 'LIGHT', id: spot.id }, pickPoint(cam, 610))!;
    expect(a).toMatchObject({ type: 'camera/set', id: cam.id });
    expect(a.type === 'camera/set' && a.patch.focusDistance).toBeCloseTo(610, 6);
  });
});
