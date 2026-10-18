// C2, the focal length's switch (ROADMAP "Judgement calls" 1.7; core/focal.ts): *Keep the size of what is in
// focus*. Off, a focal change leaves the camera where it is and the framing changes; on, the camera dollies along its
// axis so that the plane in focus keeps its size in the image, measured here by projecting points of that plane through
// the camera as it is rendered (its straight verticals' level camera and lens shift included). One undo entry per change
// and per gesture; locked, orthographic and panoramic cameras do not move; the switch round-trips through projects and
// the library, and old ones read it as off.

import { describe, expect, it } from 'vitest';
import { activeCamera, cameraBasis, cameraPosition, type CameraState } from '../src/core/camera';
import { dollyForFocal, focalBehaviour, focusedPlaneDistance, keepsFocusSize, MIN_ORBIT_FRACTION, withFocal } from '../src/core/focal';
import { focusDistanceFor, focusTarget } from '../src/core/focus';
import { renderedCamera } from '../src/core/interior-camera';
import { emptyLibrary, fromCurrentStudio } from '../src/core/library';
import { add, dot, length, scale, sub, type Vec3 } from '../src/core/math';
import { createStore, type Action, type ProjectState } from '../src/core/store';
import { focusObjectAction, focusPickAction } from '../src/core/view-objects';
import { validateItem } from '../src/io/library';
import { loadProject, serializeProject } from '../src/io/project';
import { ACTIONS } from '../src/ui/shortcuts';
import { STRINGS } from '../src/ui/strings';
import { apply, exampleState, keyIds } from './helpers';

/** Where a world point lands on the sensor of the camera as it is rendered (mm from the frame's centre, its lens shift in). */
function onSensor(cam: CameraState, p: Vec3): [number, number] {
  const rc = renderedCamera(cam);
  const { forward, right, up } = cameraBasis(rc.azimuth, rc.elevation);
  const d = sub(p, cameraPosition(rc));
  const z = dot(d, forward);
  const f = rc.focalMm;
  return [(f * dot(d, right)) / z - (rc.optics?.shiftXMm ?? 0), (f * dot(d, up)) / z - (rc.optics?.shiftYMm ?? 0)];
}

/** The plane in focus of the rendered camera: four points on it round its crossing with the axis, `half` mm apart. */
function planePoints(cam: CameraState, half = 40, centre?: Vec3): Vec3[] {
  const rc = renderedCamera(cam);
  const { forward, right, up } = cameraBasis(rc.azimuth, rc.elevation);
  const c = centre ?? add(cameraPosition(rc), scale(forward, rc.focusDistance));
  return [add(c, scale(right, half)), add(c, scale(right, -half)), add(c, scale(up, half)), add(c, scale(up, -half))];
}

/** The size on the sensor of a set of points: the distances between the first and the second, and the third and the fourth. */
function sizes(cam: CameraState, pts: Vec3[]): [number, number] {
  const s = pts.map((p) => onSensor(cam, p));
  return [Math.hypot(s[0][0] - s[1][0], s[0][1] - s[1][1]), Math.hypot(s[2][0] - s[3][0], s[2][1] - s[3][1])];
}

const focal = (id: string, focalMm: number, gesture?: string): Action => ({ type: 'camera/focal', id, focalMm, ...(gesture ? { gesture } : {}), label: 'Camera: Focal length' });
const keep = (id: string, on = true): Action => ({ type: 'camera/set', id, patch: { keepFocusSize: on } });
const cam = (s: ProjectState) => activeCamera(s);
const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-12);

describe('the switch off (the default, as on a camera)', () => {
  it('a new camera and the example have it off; the focal changes, the camera stays where it is', () => {
    const s = exampleState();
    expect(cam(s).keepFocusSize).toBeUndefined();
    expect(focalBehaviour(cam(s))).toBe('FRAMING');
    const after = apply(s, focal('cam1', 135));
    const c0 = cam(s);
    const c1 = cam(after);
    expect(c1.focalMm).toBe(135);
    expect(c1.lens).toBeNull();
    expect(cameraPosition(c1)).toEqual(cameraPosition(c0));
    expect(c1.target).toEqual(c0.target);
    expect(c1.focusDistance).toBe(c0.focusDistance);
    // The framing changes: the plane in focus grows by the focal ratio.
    const pts = planePoints(c0);
    expect(sizes(c1, pts)[0] / sizes(c0, pts)[0]).toBeCloseTo(135 / c0.focalMm, 9);
  });
});

describe('the switch on: the camera dollies, the plane in focus keeps its size', () => {
  it('Distance, the focus at the orbit target: the distance goes by the focal ratio, the target stays', () => {
    const s = apply(exampleState(), keep('cam1'));
    const c0 = cam(s);
    expect(focalBehaviour(c0)).toBe('DOLLY');
    for (const f of [24, 50, 135, 300]) {
      const c1 = cam(apply(s, focal('cam1', f)));
      const r = f / c0.focalMm;
      expect(c1.focalMm).toBe(f);
      expect(rel(c1.distance, c0.distance * r)).toBeLessThan(1e-12);
      expect(rel(c1.focusDistance, c0.focusDistance * r)).toBeLessThan(1e-12);
      expect(c1.target).toEqual(c0.target);
      expect([c1.azimuth, c1.elevation]).toEqual([c0.azimuth, c0.elevation]);
      // Along its own axis: the camera is still on the line through its old place and its target.
      const axis = cameraBasis(c0.azimuth, c0.elevation).forward;
      const moved = sub(cameraPosition(c1), cameraPosition(c0));
      expect(length(sub(moved, scale(axis, dot(moved, axis))))).toBeLessThan(1e-9 * c0.distance);
      // Projected: every point of the plane in focus lands where it did.
      const pts = planePoints(c0);
      for (const p of pts) {
        const a = onSensor(c0, p);
        const b = onSensor(c1, p);
        expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeLessThan(1e-9);
      }
      const [w0, h0] = sizes(c0, pts);
      const [w1, h1] = sizes(c1, pts);
      expect(rel(w1, w0)).toBeLessThan(1e-9);
      expect(rel(h1, h0)).toBeLessThan(1e-9);
    }
  });

  it('the perspective changes: what is nearer or farther than the plane does not keep its size', () => {
    const s = apply(exampleState(), keep('cam1'));
    const c0 = cam(s);
    const c1 = cam(apply(s, focal('cam1', 200)));
    const { forward } = cameraBasis(c0.azimuth, c0.elevation);
    const near = planePoints(c0, 40, add(cameraPosition(c0), scale(forward, c0.focusDistance * 0.7)));
    const far = planePoints(c0, 40, add(cameraPosition(c0), scale(forward, c0.focusDistance * 1.5)));
    // Telephoto from farther away: the near one shrinks, the far one grows, relative to the plane in focus.
    expect(sizes(c1, near)[0] / sizes(c0, near)[0]).toBeLessThan(0.9);
    expect(sizes(c1, far)[0] / sizes(c0, far)[0]).toBeGreaterThan(1.1);
  });

  it('Distance, the focus off the orbit target: it is the plane in focus that keeps its size, not the target', () => {
    const s0 = apply(exampleState(), keep('cam1'));
    const s = apply(s0, { type: 'camera/set', id: 'cam1', patch: { focusDistance: cam(s0).distance * 0.8 } });
    const c0 = cam(s);
    const c1 = cam(apply(s, focal('cam1', 50)));
    const toward = c0.focusDistance * (1 - 50 / c0.focalMm);
    expect(rel(c1.distance, c0.distance - toward)).toBeLessThan(1e-12);
    expect(rel(c1.focusDistance, c0.focusDistance * (50 / c0.focalMm))).toBeLessThan(1e-12);
    const pts = planePoints(c0);
    expect(rel(sizes(c1, pts)[0], sizes(c0, pts)[0])).toBeLessThan(1e-9);
    // The plane in focus is still where it was in the world.
    expect(length(sub(planePoints(c1)[0], pts[0]))).toBeLessThan(1e-9 * c0.distance);
  });

  it('Point: the point clicked keeps its place and its size on the image, and stays in focus', () => {
    const s0 = apply(exampleState(), keep('cam1'));
    const ids = keyIds(s0);
    const c = cam(s0);
    const { forward, right, up } = cameraBasis(c.azimuth, c.elevation);
    const point = add(add(add(cameraPosition(c), scale(forward, c.distance - 25)), scale(right, 30)), scale(up, -12));
    const s = apply(s0, focusPickAction(s0, null, { node: ids.label, point }, { label: 'Focus with a click' })!);
    const c0 = cam(s);
    expect(c0.focusMode).toBe('POINT');
    expect(focusedPlaneDistance(s, c0)).toBeCloseTo(c.distance - 25, 9);
    const after = apply(s, focal('cam1', 35));
    const c1 = cam(after);
    // The square to the axis through the point, as the thin lens focuses it.
    const pts = planePoints(c0, 20, point);
    const a = onSensor(c0, point);
    const b = onSensor(c1, point);
    expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeLessThan(1e-9);
    expect(rel(sizes(c1, pts)[0], sizes(c0, pts)[0])).toBeLessThan(1e-9);
    expect(rel(sizes(c1, pts)[1], sizes(c0, pts)[1])).toBeLessThan(1e-9);
    // F1's distance follows the point: it is the point's new depth.
    expect(c1.focusDistance).toBeCloseTo(focusDistanceFor(c1, focusTarget(after, c1, null)!)!, 9);
    expect(c1.focusDistance).toBeCloseTo((c.distance - 25) * (35 / c0.focalMm), 9);
  });

  it('Point: the plane is F1’s resolution for the point, not the distance the camera last kept', () => {
    const s0 = apply(exampleState(), keep('cam1'));
    const ids = keyIds(s0);
    const c = cam(s0);
    const { forward, right } = cameraBasis(c.azimuth, c.elevation);
    const point = add(add(cameraPosition(c), scale(forward, c.distance + 40)), scale(right, -20));
    const s = apply(s0, focusPickAction(s0, null, { node: ids.label, point }, { label: 'Focus with a click' })!);
    // A camera whose kept distance is not the point's (as a file or a caller could hand it): the point still decides.
    const stale = { ...cam(s), focusDistance: cam(s).focusDistance * 0.5 };
    expect(focusedPlaneDistance(s, stale)).toBeCloseTo(c.distance + 40, 9);
    const moved = withFocal(s, stale, 70);
    const pts = planePoints(c, 20, point);
    expect(rel(sizes(moved, pts)[0], sizes(stale, pts)[0])).toBeLessThan(1e-9);
  });

  it('Object: the centre of the object followed keeps its size', () => {
    const s0 = apply(exampleState(), keep('cam1'));
    const ids = keyIds(s0);
    const s = apply(s0, focusObjectAction(s0, null, ids.closure)!);
    const c0 = cam(s);
    expect(c0.focusMode).toBe('OBJECT');
    const centre = focusTarget(s, c0, null)!;
    const c1 = cam(apply(s, focal('cam1', 120)));
    const pts = planePoints(c0, 15, centre);
    expect(rel(sizes(c1, pts)[0], sizes(c0, pts)[0])).toBeLessThan(1e-9);
    const a = onSensor(c0, centre);
    const b = onSensor(c1, centre);
    expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeLessThan(1e-9);
  });

  it('straight verticals (K3): the level camera that is rendered keeps the plane in focus, its size and its place', () => {
    const s0 = apply(exampleState(), keep('cam1'), { type: 'camera/set', id: 'cam1', patch: { straightVerticals: true, elevation: 25 } });
    const c0 = cam(s0);
    expect(renderedCamera(c0).elevation).toBe(0);
    // The sign of the shift: the target is in the centre of the frame.
    const t = onSensor(c0, c0.target);
    expect(Math.hypot(t[0], t[1])).toBeLessThan(1e-9);
    for (const f of [28, 135]) {
      const c1 = cam(apply(s0, focal('cam1', f)));
      const pts = planePoints(c0);
      for (const p of pts) {
        const a = onSensor(c0, p);
        const b = onSensor(c1, p);
        expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeLessThan(1e-9);
      }
      expect(rel(sizes(c1, pts)[0], sizes(c0, pts)[0])).toBeLessThan(1e-9);
      // Still level, its target still in the centre.
      const t1 = onSensor(c1, c1.target);
      expect(Math.hypot(t1[0], t1[1])).toBeLessThan(1e-9);
    }
  });

  it('a camera that would pass its target pushes it along the axis (never a target behind the camera)', () => {
    const s0 = apply(exampleState(), keep('cam1'));
    const s = apply(s0, { type: 'camera/set', id: 'cam1', patch: { focusDistance: cam(s0).distance * 3 } });
    const c0 = cam(s);
    const c1 = cam(apply(s, focal('cam1', 20)));
    const r = 20 / c0.focalMm;
    expect(c1.distance).toBeCloseTo(MIN_ORBIT_FRACTION * c0.distance * r, 9);
    const { forward } = cameraBasis(c0.azimuth, c0.elevation);
    expect(dot(sub(c1.target, cameraPosition(c1)), forward)).toBeGreaterThan(0);
    // The plane in focus still keeps its size.
    const pts = planePoints(c0);
    expect(rel(sizes(c1, pts)[0], sizes(c0, pts)[0])).toBeLessThan(1e-9);
  });

  it('moving away keeps the far clipping plane where it was in the world; nothing is ever NaN', () => {
    const s = apply(exampleState(), keep('cam1'));
    const c0 = cam(s);
    const c1 = cam(apply(s, focal('cam1', 600)));
    expect(c1.clipEnd - c1.distance).toBeCloseTo(c0.clipEnd - c0.distance, 6);
    expect(c1.clipStart).toBe(c0.clipStart);
    const odd = withFocal(s, { ...c0, focusDistance: 0 }, 50);
    expect([odd.distance, ...odd.target, odd.focusDistance].every(Number.isFinite)).toBe(true);
    expect(withFocal(s, c0, Number.NaN)).toBe(c0);
    expect(withFocal(s, c0, c0.focalMm)).toBe(c0);
  });

  it('K3’s interior lenses change the focal length too, and go through the switch', () => {
    const s = apply(exampleState(), keep('cam1'));
    const c0 = cam(s);
    const c1 = cam(apply(s, { type: 'camera/interiorLens', id: 'cam1', key: 'INT_24' }));
    expect(c1.focalMm).toBe(24);
    expect(rel(c1.distance, c0.distance * (24 / c0.focalMm))).toBeLessThan(1e-12);
    const off = cam(apply(exampleState(), { type: 'camera/interiorLens', id: 'cam1', key: 'INT_24' }));
    expect(off.distance).toBe(c0.distance);
  });
});

describe('where it does nothing, and says so', () => {
  it('a locked camera stays where it is (its focal changes, as with the switch off)', () => {
    const s = apply(exampleState(), keep('cam1'), { type: 'camera/set', id: 'cam1', patch: { locked: true } });
    const c0 = cam(s);
    expect(focalBehaviour(c0)).toBe('LOCKED');
    const c1 = cam(apply(s, focal('cam1', 135)));
    expect(c1.focalMm).toBe(135);
    expect(cameraPosition(c1)).toEqual(cameraPosition(c0));
    expect(c1.target).toEqual(c0.target);
  });

  it('orthographic and panoramic cameras are framed by their width or field: nothing moves', () => {
    for (const projection of ['ORTHOGRAPHIC', 'EQUIRECTANGULAR', 'FISHEYE'] as const) {
      const s = apply(exampleState(), keep('cam1'), { type: 'camera/set', id: 'cam1', patch: { projection } });
      const c0 = cam(s);
      expect(focalBehaviour(c0)).toBe(projection === 'ORTHOGRAPHIC' ? 'ORTHOGRAPHIC' : 'PANORAMA');
      const c1 = cam(apply(s, focal('cam1', 135)));
      expect(c1.focalMm).toBe(135);
      expect(c1.distance).toBe(c0.distance);
      expect(c1.orthoWidth).toBe(c0.orthoWidth);
      expect(c1.target).toEqual(c0.target);
      expect(dollyForFocal(s, c0, { ...c0, focalMm: 135 })).toEqual({ ...c0, focalMm: 135 });
    }
  });
});

describe('undo', () => {
  it('the switch is one entry; a focal change with it on, the dolly with it, is one more; undo puts the camera back', () => {
    const store = createStore(exampleState());
    const c0 = cam(store.get());
    store.dispatch({ ...keep('cam1'), label: 'Camera: Keep the size of what is in focus' });
    expect(keepsFocusSize(cam(store.get()))).toBe(true);
    store.dispatch(focal('cam1', 135));
    expect(store.history().undo.slice(0, 2)).toEqual(['Camera: Focal length', 'Camera: Keep the size of what is in focus']);
    store.undo();
    expect(cam(store.get())).toEqual({ ...c0, keepFocusSize: true });
    store.undo();
    expect(cam(store.get())).toEqual(c0);
  });

  it('a drag of the field (one gesture) is one entry, and ends where one change to its last value would', () => {
    const store = createStore(apply(exampleState(), keep('cam1')));
    const c0 = cam(store.get());
    const before = store.history().undo.length;
    for (const f of [90, 97, 110, 131, 160, 140]) store.dispatch(focal('cam1', f, 'drag-1'));
    expect(store.history().undo.length).toBe(before + 1);
    const one = cam(store.get());
    const direct = cam(apply(apply(exampleState(), keep('cam1')), focal('cam1', 140)));
    expect(rel(one.distance, direct.distance)).toBeLessThan(1e-12);
    expect(rel(one.focusDistance, direct.focusDistance)).toBeLessThan(1e-12);
    store.undo();
    expect(cam(store.get())).toEqual(c0);
  });

  it('each press of the arrows is its own entry (a held press, one gesture)', () => {
    const store = createStore(apply(exampleState(), keep('cam1')));
    const before = store.history().undo.length;
    store.dispatch(focal('cam1', 86, 'step-1'));
    store.dispatch(focal('cam1', 87, 'step-1'));
    store.dispatch(focal('cam1', 88, 'step-2'));
    expect(store.history().undo.length).toBe(before + 2);
    store.undo();
    expect(cam(store.get()).focalMm).toBe(87);
    store.undo();
    expect(cam(store.get()).focalMm).toBe(85);
  });
});

describe('saving and opening', () => {
  it('a project round-trips the switch; one saved before C2 (or with anything but true) opens with it off', async () => {
    const s = apply(exampleState(), keep('cam1'), { type: 'camera/add', name: 'Close-up' });
    const back = loadProject(await serializeProject(s).text()).state;
    expect(Object.values(back.camera.cameras).map((c) => c.keepFocusSize)).toEqual([true, true]);
    const old = loadProject(await serializeProject(exampleState()).text()).state;
    expect(cam(old).keepFocusSize).toBeUndefined();
    expect(focalBehaviour(cam(old))).toBe('FRAMING');
    const text = await serializeProject(s).text();
    const odd = text.replaceAll('"keepFocusSize": true', '"keepFocusSize": "yes"');
    expect(odd).not.toBe(text);
    const read = loadProject(odd).state;
    expect(Object.values(read.camera.cameras).every((c) => !('keepFocusSize' in c))).toBe(true);
  });

  it('a studio of the library keeps the camera’s switch; one saved before C2 reads it as off', () => {
    const s = apply(exampleState(), keep('cam1'));
    const item = JSON.parse(JSON.stringify(fromCurrentStudio(s, emptyLibrary(), 'Dolly')));
    const kept = validateItem(item) as unknown as { studio: { camera: CameraState } };
    expect(kept.studio.camera.keepFocusSize).toBe(true);
    delete item.studio.camera.keepFocusSize;
    const old = validateItem(item) as unknown as { studio: { camera: CameraState } };
    expect(old.studio.camera.keepFocusSize).toBeUndefined();
  });
});

describe('the palette', () => {
  it('has the command, named in both languages', () => {
    const a = ACTIONS.find((x) => x.id === 'keepFocusSize');
    expect(a?.label).toBe('action.keepFocusSize');
    expect(STRINGS.en['action.keepFocusSize']).toMatch(/keep the size/i);
    expect(STRINGS.es['action.keepFocusSize']).toMatch(/mantener el tamaño/i);
  });
});
