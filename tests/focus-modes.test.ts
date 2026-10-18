// Focus by distance, point and object (phase F1, core/focus.ts): the focus on a point stays on that point whatever the
// camera, the part or the animation does; the focus on an object follows it; the rule of a tilted lens; the engine's
// own rays and focus (rt.wasm) where the viewport and the render need them; the fall-back when the point's part or
// the object is gone; the old projects; the save and open round trip; undo.

import { describe, expect, it } from 'vitest';
import { evaluate, playheadPose, type MotionClip } from '../src/core/animation';
import { activeCamera, cameraBasis, cameraPosition, focusFollowsOrbit, orbitPatch, type CameraState } from '../src/core/camera';
import { anchorOf, focusDistanceAt, focusDistanceFor, focusModeOf, focusRange, focusTarget, normaliseFocus, objectFocusPoint, posedBounds, posedWorldMatrix, resolvedFocusDistance, setFocusSolver, syncFocus } from '../src/core/focus';
import { add, boxCenter, cross, dot, length, scale, sub, transformPoint, type Vec3 } from '../src/core/math';
import { OPTICS_NEUTRAL, withTilt } from '../src/core/optics';
import { focusPlaneOf, planeDistance } from '../src/core/focus-plane';
import { createStore, type ProjectState } from '../src/core/store';
import { newTracedLens } from '../src/core/traced-lens';
import { focusCameraOf, focusModeAction, focusObjectAction, focusPickAction, glyphsOf, viewProjector } from '../src/core/view-objects';
import { cameraToRsb, focusPickRsb, lensInfoRsb, projectScene, writeRsb } from '../src/io/rsb';
import { loadProject, serializeProject } from '../src/io/project';
import { engineFocusAt, enginePick, focusSolverOf, hasFocusExports, settledFocusPick, settledScenePick } from '../src/render/focus-pick';
import { apply, exampleState, keyIds } from './helpers';
import { loadRt, RT_WASM } from './wasm-engine';

const along = (c: CameraState, d: number, right = 0, up = 0): Vec3 => {
  const b = cameraBasis(c.azimuth, c.elevation);
  return add(add(add(cameraPosition(c), scale(b.forward, d)), scale(b.right, right)), scale(b.up, up));
};
const depthOf = (c: CameraState, p: Vec3) => dot(sub(p, cameraPosition(c)), cameraBasis(c.azimuth, c.elevation).forward);
/** The example with its camera at f/2 and the focus picked on the label at a point off the axis. */
function picked(): { s: ProjectState; ids: Record<string, string>; point: Vec3 } {
  const s0 = apply(exampleState(), { type: 'camera/set', id: 'cam1', patch: { fstop: 2 } });
  const ids = keyIds(s0);
  const cam = activeCamera(s0);
  const point = along(cam, cam.distance - 20, 30, -15);
  const a = focusPickAction(s0, null, { node: ids.label, point }, { label: 'Focus with a click' })!;
  return { s: apply(s0, a), ids, point };
}

describe('the focus distance of a point, by the engine’s rule', () => {
  const cam = activeCamera(exampleState());

  it('the thin lens: the depth along the view axis', () => {
    const p = along(cam, 500, 120, -80);
    expect(focusDistanceFor(cam, p)).toBeCloseTo(500, 9);
    expect(focusDistanceFor(cam, along(cam, -10))).toBeNull();
  });

  it('a tilted lens: the distance whose hinge-rule plane passes through the point (the depth would miss it)', () => {
    const tilted: CameraState = { ...cam, fstop: 2, optics: { ...OPTICS_NEUTRAL, tiltDeg: 8, tiltAxisDeg: 20 } };
    const { forward, right, up } = cameraBasis(cam.azimuth, cam.elevation);
    const axis = add(scale(right, Math.cos((20 * Math.PI) / 180)), scale(up, Math.sin((20 * Math.PI) / 180)));
    const b = cross(forward, axis);
    for (const [r, u] of [[150, 90], [-140, 60], [0, -120], [90, -90]]) {
      const p = along(cam, 600, r, u);
      const d = focusDistanceFor(tilted, p)!;
      // The plane through the axis point at d with the normal f·forward + d·sin α·b passes through p.
      const n = add(scale(forward, cam.focalMm), scale(b, d * Math.sin((8 * Math.PI) / 180)));
      expect(Math.abs(dot(sub(p, along(cam, d)), n)) / length(n)).toBeLessThan(1e-6);
      expect(Math.abs(d - 600)).toBeGreaterThan(1);
    }
  });

  it('a tilted traced lens (O4) without the engine: the paraxial distance is the simple lens’s plane through the point', () => {
    const c: CameraState = { ...cam, fstop: 2, optics: withTilt({ ...OPTICS_NEUTRAL, traced: newTracedLens('double_gauss_normal') }, 6, 20) };
    for (const [d, r, u] of [[500, 100, 60], [900, -200, 30], [700, 0, -150]]) {
      const p = along(c, d, r, u);
      const f = focusDistanceFor(c, p)!;
      expect(Math.abs(planeDistance(focusPlaneOf({ ...c, focusDistance: f }), p))).toBeLessThan(1e-6);
      expect(Math.abs(f - depthOf(c, p))).toBeGreaterThan(1);
    }
  });

  it.skipIf(!RT_WASM)('is the engine’s (rt_scene_focus_at) for the thin lens, the shift, the tilt and K3’s cameras', async () => {
    const rt = await loadRt();
    expect(hasFocusExports(rt)).toBe(true);
    if (!hasFocusExports(rt)) return;
    const cams: CameraState[] = [
      { ...cam, fstop: 2 },
      { ...cam, fstop: 2, optics: { ...OPTICS_NEUTRAL, shiftXMm: 4, shiftYMm: -3 } },
      { ...cam, fstop: 2, optics: { ...OPTICS_NEUTRAL, tiltDeg: 10, tiltAxisDeg: 35 } },
      { ...cam, fstop: 2, optics: { ...OPTICS_NEUTRAL, tiltDeg: -6, tiltAxisDeg: -70, shiftXMm: 2, shiftYMm: 0 } },
      // K3's cameras: orthographic, the two panoramas (a pinhole: the distance, behind the camera too) and straight
      // verticals (the level camera the engine renders, its focus written as the camera's times cos(corrected tilt)).
      { ...cam, fstop: 2, projection: 'ORTHOGRAPHIC' },
      { ...cam, fstop: 2, projection: 'EQUIRECTANGULAR', aspect: { preset: '2:1', w: 2, h: 1 } },
      { ...cam, fstop: 2, projection: 'FISHEYE', fisheyeFovDeg: 200 },
      { ...cam, fstop: 2, elevation: 12, straightVerticals: true },
      { ...cam, fstop: 2, elevation: -9, straightVerticals: true, optics: { ...OPTICS_NEUTRAL, tiltDeg: 5, tiltAxisDeg: 10 } },
    ];
    for (const c of cams) {
      const points: [number, number, number][] = [[500, 100, 60], [900, -200, 30], [700, 0, -150]];
      if (c.projection === 'EQUIRECTANGULAR' || c.projection === 'FISHEYE') points.push([-400, 50, 20]);
      for (const [d, r, u] of points) {
        const p = along(c, d, r, u);
        const ts = focusDistanceFor(c, p)!;
        // What the RSB carries for the camera focused there, against the engine's own focus for the point.
        const written = cameraToRsb({ ...c, focusDistance: ts }, c.aspect.w, c.aspect.h, c.aspect.w, c.aspect.h).focusDist;
        const engine = engineFocusAt(rt, lensInfoRsb(c, c.aspect.w, c.aspect.h), p)!;
        expect(Math.abs(written - engine) / engine, `${c.projection} ${c.straightVerticals ? 'verticals' : ''} ${d}`).toBeLessThan(2e-5);
      }
    }
  });
});

describe('focus on a point: it stays on the point', () => {
  it('a click puts the camera in Point, anchored to the part, at the point’s distance', () => {
    const { s, ids, point } = picked();
    const cam = activeCamera(s);
    expect(cam.focusMode).toBe('POINT');
    expect(cam.focusPoint?.node).toBe(ids.label);
    // The anchor is in the part's own coordinates: through its matrix it is the clicked point.
    expect(length(sub(transformPoint(posedWorldMatrix(s, ids.label, null)!, cam.focusPoint!.point), point))).toBeLessThan(1e-9);
    expect(cam.focusDistance).toBeCloseTo(depthOf(cam, point), 9);
  });

  it('follows an orbit, a zoom and a pan of the camera (the old focus stayed at the clicked distance)', () => {
    const { s, point } = picked();
    const cam = activeCamera(s);
    expect(focusFollowsOrbit(cam)).toBe(false);
    for (const v of [
      { azimuth: cam.azimuth + 25, elevation: cam.elevation, distance: cam.distance, target: cam.target },
      { azimuth: cam.azimuth, elevation: cam.elevation + 10, distance: cam.distance * 0.7, target: cam.target },
      { azimuth: cam.azimuth, elevation: cam.elevation, distance: cam.distance, target: add(cam.target, [30, 0, 10]) as Vec3 },
    ]) {
      const moved = apply(s, { type: 'camera/set', id: cam.id, patch: orbitPatch(cam, v)! });
      const c = activeCamera(moved);
      expect(c.focusDistance).toBeCloseTo(depthOf(c, point), 9);
      expect(resolvedFocusDistance(moved, c, null)).toBeCloseTo(depthOf(c, point), 9);
    }
  });

  it('follows its part when it moves, turns or its group moves', () => {
    const { s, ids } = picked();
    const cam0 = activeCamera(s);
    const world = (st: ProjectState) => transformPoint(posedWorldMatrix(st, ids.label, null)!, activeCamera(st).focusPoint!.point);
    const label = s.scene.nodes[ids.label];
    const model = s.scene.nodes[ids.model];
    for (const next of [
      apply(s, { type: 'scene/setTransforms', transforms: { [ids.label]: { ...label.transform, position: add(label.transform.position, [0, 40, 25]) } } }),
      apply(s, { type: 'scene/setTransforms', transforms: { [ids.model]: { ...model.transform, rotation: [0, 0, 35] } } }),
    ]) {
      const c = activeCamera(next);
      expect(c.focusMode).toBe('POINT');
      expect(c.focusDistance).toBeCloseTo(depthOf(c, world(next)), 9);
      expect(Math.abs(c.focusDistance - cam0.focusDistance)).toBeGreaterThan(1);
    }
  });

  it('follows its part’s animation and the camera’s at every instant (the old focus used the stored pose)', () => {
    const { s, ids } = picked();
    const move: Omit<MotionClip, 'id'> = { target: { kind: 'NODE', id: ids.model }, move: 'MOVE', shot: null, start: 0, duration: 2, amount: 1, vector: [0.3, 0.4, 0], easing: 'LINEAR' };
    const orbit: Omit<MotionClip, 'id'> = { target: { kind: 'CAMERA' }, move: 'ORBIT', shot: null, start: 0, duration: 2, amount: 30, easing: 'LINEAR' };
    const anim = apply(s, { type: 'anim/addClip', clip: move }, { type: 'anim/addClip', clip: orbit });
    const cam = activeCamera(anim);
    for (const t of [0.5, 1, 2]) {
      const pose = evaluate(anim, t);
      const posed = { ...cam, ...pose.camera!, id: cam.id };
      const point = transformPoint(posedWorldMatrix(anim, ids.label, pose)!, cam.focusPoint!.point);
      expect(focusDistanceAt(anim, cam.id, t)).toBeCloseTo(depthOf(posed, point), 6);
      // The frame the engine gets carries it.
      const atT = apply(anim, { type: 'anim/playhead', t });
      expect(projectScene(atT, { width: 32, height: 18, maxSamples: 1, maxSeconds: 0 }).scene.camera.focusDist).toBeCloseTo(depthOf(posed, point), 3);
      // At rest (the stored focus) it is somewhere else.
      expect(Math.abs(focusDistanceAt(anim, cam.id, t)! - cam.focusDistance)).toBeGreaterThan(1);
    }
  });

  it('a click at an instant of the timeline anchors the point that instant shows, for the camera that instant shows', () => {
    const s0 = exampleState();
    const ids = keyIds(s0);
    const orbit: Omit<MotionClip, 'id'> = { target: { kind: 'CAMERA' }, move: 'ORBIT', shot: null, start: 0, duration: 2, amount: 30, easing: 'LINEAR' };
    const move: Omit<MotionClip, 'id'> = { target: { kind: 'NODE', id: ids.model }, move: 'MOVE', shot: null, start: 0, duration: 2, amount: 1, vector: [0, 0, 0.5], easing: 'LINEAR' };
    const s = apply(s0, { type: 'anim/addClip', clip: orbit }, { type: 'anim/addClip', clip: move }, { type: 'anim/playhead', t: 1 });
    const pose = playheadPose(s)!;
    const posed = { ...activeCamera(s), ...pose.camera! };
    const hitPoint = along(posed, posed.distance - 15, 20, 10);
    const a = focusPickAction(s, null, { node: ids.label, point: hitPoint }, {}, pose)!;
    const after = apply(s, a);
    expect(focusDistanceAt(after, 'cam1', 1)).toBeCloseTo(depthOf(posed, hitPoint), 6);
    expect(length(sub(focusTarget(after, { ...activeCamera(after), ...pose.camera! }, pose)!, hitPoint))).toBeLessThan(1e-6);
  });

  it('the camera of the shot the playhead is in takes a click (the viewport shows it)', () => {
    let s = apply(exampleState(), { type: 'camera/add', name: 'Side' });
    const side = s.camera.active;
    s = apply(s, { type: 'camera/activate', id: 'cam1' }, { type: 'anim/addShot', duration: 2 });
    const shots = s.animation.shots.map((sh, i) => (i === 0 ? { ...sh, camera: side } : sh));
    s = { ...s, animation: { ...s.animation, shots, clips: [{ id: 'c1', target: { kind: 'CAMERA' }, move: 'ORBIT', shot: null, start: 0, duration: 1, amount: 5, easing: 'LINEAR' }] } };
    s = apply(s, { type: 'anim/playhead', t: 0.5 });
    expect(focusCameraOf(s, null, playheadPose(s))?.id).toBe(side);
  });

  it('a rack focus (a FOCUS clip) pulls from the followed distance', () => {
    const { s } = picked();
    const cam = activeCamera(s);
    const pull: Omit<MotionClip, 'id'> = { target: { kind: 'CAMERA' }, move: 'FOCUS', shot: null, start: 0, duration: 2, amount: 2, easing: 'LINEAR' };
    const anim = apply(s, { type: 'anim/addClip', clip: pull });
    expect(focusDistanceAt(anim, cam.id, 0)).toBeCloseTo(cam.focusDistance, 6);
    expect(focusDistanceAt(anim, cam.id, 1)).toBeCloseTo((cam.focusDistance + 2000) / 2, 6);
    expect(focusDistanceAt(anim, cam.id, 2)).toBeCloseTo(2000, 6);
  });
});

describe('focus on an object', () => {
  it('follows the surface the camera sees at the centre of the outline of a part, a group or the model (the default)', () => {
    const s0 = exampleState();
    const ids = keyIds(s0);
    for (const id of [ids.cap, ids.closure, ids.model]) {
      const s = apply(s0, focusObjectAction(s0, null, id)!);
      const cam = activeCamera(s);
      expect(cam.focusMode).toBe('OBJECT');
      const seen = objectFocusPoint(s, cam, id, null, 'SILHOUETTE')!;
      expect(cam.focusDistance).toBeCloseTo(depthOf(cam, seen), 9);
      // In front of the centre of its box: the face the camera sees, not the inside of the part.
      expect(depthOf(cam, seen)).toBeLessThan(depthOf(cam, boxCenter(posedBounds(s, id, null))));
      const moved = apply(s, { type: 'camera/set', id: cam.id, patch: orbitPatch(cam, { azimuth: cam.azimuth + 40, elevation: cam.elevation, distance: cam.distance * 0.8, target: cam.target })! });
      const c = activeCamera(moved);
      expect(c.focusDistance).toBeCloseTo(depthOf(c, objectFocusPoint(moved, c, id, null, 'SILHOUETTE')!), 9);
    }
  });

  it('wide open, the face of the object the camera sees is in focus (owner’s report, 2026-10-18, at f/1)', () => {
    // The bottle's body at f/1: the thin lens's circle of confusion, in pixels of a 1920-wide frame, of the surface the
    // camera sees at the centre of the body's outline. Focused on the centre of the body's box (the first rule), that
    // surface was some 30 mm in front of the focus and more than ten pixels across; on the surface, none.
    const s0 = apply(exampleState(), { type: 'camera/set', id: 'cam1', patch: { fstop: 1 } });
    const ids = keyIds(s0);
    const s = apply(s0, focusObjectAction(s0, null, ids.body)!);
    const cam = activeCamera(s);
    const seen = objectFocusPoint(s, cam, ids.body, null, 'SILHOUETTE')!;
    const cocPx = (focus: number, z: number) => {
      const f = cam.focalMm;
      return (((f * f) / (cam.fstop * (focus - f))) * (Math.abs(z - focus) / z) * 1920) / 36;
    };
    const z = depthOf(cam, seen);
    expect(cocPx(cam.focusDistance, z)).toBeLessThan(0.01);
    expect(cocPx(depthOf(cam, boxCenter(posedBounds(s, ids.body, null))), z)).toBeGreaterThan(10);
  });

  it('the other candidates for Fable: the nearest vertex along the axis and the surface at the centre of the outline', () => {
    const s = exampleState();
    const ids = keyIds(s);
    const cam = activeCamera(s);
    const centre = objectFocusPoint(s, cam, ids.body, null, 'BOUNDS_CENTRE')!;
    const nearest = objectFocusPoint(s, cam, ids.body, null, 'NEAREST')!;
    const outline = objectFocusPoint(s, cam, ids.body, null, 'SILHOUETTE')!;
    expect(depthOf(cam, nearest)).toBeLessThan(depthOf(cam, centre));
    expect(depthOf(cam, outline)).toBeLessThan(depthOf(cam, centre));
    expect(depthOf(cam, outline)).toBeGreaterThanOrEqual(depthOf(cam, nearest) - 1e-6);
  });
});

describe('the fall-back, the modes and undo', () => {
  it('deleting the point’s part keeps the last distance, by distance; undo brings the point back', () => {
    const { s, ids } = picked();
    const store = createStore(s);
    const before = activeCamera(store.get());
    store.dispatch({ type: 'scene/delete', ids: [ids.label], label: 'Delete' });
    const after = activeCamera(store.get());
    expect(after.focusMode).toBe('DISTANCE');
    expect(after.focusPoint).toBeNull();
    expect(after.focusDistance).toBe(before.focusDistance);
    expect(Number.isFinite(resolvedFocusDistance(store.get(), after, null))).toBe(true);
    store.undo();
    expect(activeCamera(store.get()).focusMode).toBe('POINT');
    expect(activeCamera(store.get()).focusPoint?.node).toBe(ids.label);
  });

  it('deleting the object does the same', () => {
    const s0 = exampleState();
    const ids = keyIds(s0);
    const s = apply(s0, focusObjectAction(s0, null, ids.cap)!);
    const gone = apply(s, { type: 'scene/delete', ids: [ids.cap] });
    expect(activeCamera(gone).focusMode).toBe('DISTANCE');
    expect(activeCamera(gone).focusDistance).toBe(activeCamera(s).focusDistance);
  });

  it('never a NaN: a point behind the camera, a part scaled to nothing', () => {
    const { s, ids } = picked();
    const cam = activeCamera(s);
    const behind: CameraState = { ...cam, focusPoint: anchorOf(s, ids.label, along(cam, -100))! };
    const flat = apply(s, { type: 'scene/setTransforms', transforms: { [ids.model]: { ...s.scene.nodes[ids.model].transform, scale: [0, 0, 0] } } });
    for (const [st, c] of [[s, behind], [flat, activeCamera(flat)]] as const) {
      const d = resolvedFocusDistance(st, c, null);
      expect(Number.isFinite(d) && d > 0).toBe(true);
    }
    expect(resolvedFocusDistance(s, behind, null)).toBe(cam.focusDistance);
  });

  it('Distance takes the distance the camera is focused at; Point goes back to the kept point; each is one undo entry', () => {
    const { s } = picked();
    const store = createStore(s);
    const cam = activeCamera(store.get());
    const moved = orbitPatch(cam, { azimuth: cam.azimuth + 30, elevation: cam.elevation, distance: cam.distance, target: cam.target })!;
    store.dispatch({ type: 'camera/set', id: cam.id, patch: moved, label: 'Orbit' });
    const followed = activeCamera(store.get()).focusDistance;
    store.dispatch(focusModeAction(store.get(), cam.id, 'DISTANCE', { label: 'Focus: Distance' })!);
    expect(focusModeOf(activeCamera(store.get()))).toBe('DISTANCE');
    expect(activeCamera(store.get()).focusDistance).toBeCloseTo(followed, 9);
    // The point is kept for the way back.
    store.dispatch(focusModeAction(store.get(), cam.id, 'POINT', { label: 'Focus: Point' })!);
    expect(focusModeOf(activeCamera(store.get()))).toBe('POINT');
    expect(store.history().undo.slice(0, 2)).toEqual(['Focus: Point', 'Focus: Distance']);
    store.undo();
    store.undo();
    expect(activeCamera(store.get()).focusDistance).toBeCloseTo(followed, 9);
    // Object without an object to go back to: nothing (the interface starts the pick).
    expect(focusModeAction(store.get(), cam.id, 'OBJECT')).toBeNull();
  });

  it('a click is one undo entry, and undo takes the camera back to the distance it had', () => {
    const s0 = exampleState();
    const store = createStore(s0);
    const before = activeCamera(s0);
    const ids = keyIds(s0);
    store.dispatch(focusPickAction(store.get(), null, { node: ids.label, point: along(before, before.distance - 40) }, { label: 'Focus with a click' })!);
    expect(store.history().undo.at(-1)).toBe('Focus with a click');
    store.undo();
    expect(activeCamera(store.get())).toEqual(before);
  });

  it('syncFocus leaves the state alone when neither the cameras nor the scene changed, and distance cameras always', () => {
    const s = exampleState();
    expect(syncFocus(s, s)).toBe(s);
    const moved = apply(s, { type: 'camera/set', id: 'cam1', patch: { azimuth: 10 } });
    expect(syncFocus(moved, s)).toBe(moved);
  });
});

describe('old projects, saving and opening, the library', () => {
  it('a project saved before F1 opens by distance, unchanged', async () => {
    const s = exampleState();
    const loaded = loadProject(await serializeProject(s).text()).state;
    expect(focusModeOf(activeCamera(loaded))).toBe('DISTANCE');
    expect(activeCamera(loaded).focusMode).toBeUndefined();
    expect(activeCamera(loaded).focusDistance).toBe(activeCamera(s).focusDistance);
  });

  it('Point and Object round-trip; a damaged or orphaned one opens by distance', async () => {
    const { s, ids } = picked();
    const back = loadProject(await serializeProject(s).text()).state;
    expect(activeCamera(back).focusMode).toBe('POINT');
    expect(activeCamera(back).focusPoint).toEqual(activeCamera(s).focusPoint);
    const obj = apply(s, focusObjectAction(s, null, ids.closure)!);
    expect(activeCamera(loadProject(await serializeProject(obj).text()).state)).toMatchObject({ focusMode: 'OBJECT', focusObject: ids.closure });
    const text = await serializeProject(s).text();
    const broken = text.replace(`"node": "${ids.label}"`, '"node": "nowhere"');
    expect(broken).not.toBe(text);
    expect(focusModeOf(activeCamera(loadProject(broken).state))).toBe('DISTANCE');
    expect(normaliseFocus({ focusMode: 'POINT', focusPoint: { node: 'p', point: [1, Number.NaN, 2] } })).toEqual({});
    expect(normaliseFocus({ focusMode: 'SOMETHING' })).toEqual({});
  });
});

describe('the mark in the viewport and the slider', () => {
  it('a selected camera in Point or Object marks the point where it is', () => {
    const { s, point } = picked();
    const glyphs = glyphsOf(s, { all: false, selected: { kind: 'CAMERA', id: 'cam1' } });
    expect(glyphs).toHaveLength(1);
    expect(glyphs[0].dots[0][0]).toBeCloseTo(point[0], 9);
    expect(glyphs[0].lines.length).toBeGreaterThan(8);
    expect(glyphsOf(exampleState(), { all: false, selected: { kind: 'CAMERA', id: 'cam1' } })).toHaveLength(0);
  });

  it('the slider spans the scene’s depth from the camera, a decade at least, with the distance in it', () => {
    const s = exampleState();
    const cam = activeCamera(s);
    const r = focusRange(s, cam, cam.focusDistance);
    expect(r.lo).toBeLessThan(cam.focusDistance);
    expect(r.hi).toBeGreaterThan(cam.focusDistance);
    expect(r.hi / r.lo).toBeGreaterThanOrEqual(10);
    expect(focusRange(s, cam, 1e5).hi).toBeGreaterThanOrEqual(1e5);
  });
});

describe.skipIf(!RT_WASM)('a click focuses on what the image shows there (owner’s report, 2026-10-18)', () => {
  const [w, h] = [640, 400];
  const sceneOf = (s: ProjectState) => {
    const { scene, ids } = projectScene(s, { width: w, height: h, maxSamples: 1, maxSeconds: 0, maxDepth: 1, cameras: true, viewport: { viewW: w, viewH: h } });
    return { rsb: writeRsb(scene, { meshes: true }), nodeOf: (i: number) => ids.instances[i]?.node ?? null };
  };
  /** A pixel of the view where the engine shows the label. */
  const labelPixel = async (s: ProjectState, label: string): Promise<[number, number]> => {
    const rt = await loadRt();
    for (let y = 150; y < 300; y += 4) {
      const { rsb, nodeOf } = sceneOf(s);
      const hit = enginePick(rt as never, rsb, 0.5, y / h)?.hit;
      if (hit && nodeOf(Math.round(hit.instance)) === label) return [0.5, y / h];
    }
    throw new Error('no label pixel');
  };

  it('the point the engine meets at the pixel, the label where the label is seen', async () => {
    const rt = await loadRt();
    if (!hasFocusExports(rt)) throw new Error('rt.wasm has no focus pick: npm run engine:build');
    const s = apply(exampleState(), { type: 'camera/set', id: 'cam1', patch: { fstop: 1 } });
    const ids = keyIds(s);
    const [u, v] = await labelPixel(s, ids.label);
    const hit = settledScenePick(rt, s, u, v, sceneOf, (st, p) => {
      const a = focusPickAction(st, null, p);
      return a ? apply(st, a) : null;
    })!;
    expect(hit.node).toBe(ids.label);
    const focused = apply(s, focusPickAction(s, null, hit)!);
    // The engine's own focus for what that pixel shows is the camera's focus now: in focus to a hundredth of a mm.
    const seen = enginePick(rt, sceneOf(focused).rsb, u, v)!.hit!;
    expect(Math.abs(activeCamera(focused).focusDistance - seen.focusDist!)).toBeLessThan(0.01);
  });

  it('never a part the image does not show there: a part hidden to the camera is looked through', async () => {
    const rt = await loadRt();
    if (!hasFocusExports(rt)) throw new Error('rt.wasm has no focus pick: npm run engine:build');
    const s0 = apply(exampleState(), { type: 'camera/set', id: 'cam1', patch: { fstop: 1 } });
    const ids = keyIds(s0);
    const [u, v] = await labelPixel(s0, ids.label);
    const s = apply(s0, { type: 'scene/setCameraHidden', ids: [ids.label], hidden: true });
    const hit = settledScenePick(rt, s, u, v, sceneOf, null)!;
    expect(hit.node).not.toBe(ids.label);
    const cam = activeCamera(s);
    const labelHit = enginePick(rt, sceneOf(s0).rsb, u, v)!.hit!;
    expect(depthOf(cam, hit.point)).toBeGreaterThan(labelHit.depth);
  });
});

describe.skipIf(!RT_WASM)('the engine’s rays and focus for the view (rt.wasm)', () => {
  it('a saved camera looked through renders its own frame: the engine’s ray of a pixel is the viewport’s', async () => {
    const rt = await loadRt();
    if (!hasFocusExports(rt)) throw new Error('rt.wasm has no focus pick: npm run engine:build');
    let s = apply(exampleState(), { type: 'camera/add', name: 'Tall', from: 'cam1' });
    const tall = s.camera.active;
    s = apply(s, { type: 'camera/set', id: tall, patch: { azimuth: -10, aspect: { preset: '9:16', w: 9, h: 16 } } }, { type: 'camera/activate', id: 'cam1' });
    const through = s.camera.cameras[tall];
    const { id: _id, ...patch } = through;
    const [w, h] = [640, 400];
    const project = viewProjector(through, w, h, 9, 16);
    for (const [x, y] of [[320, 200], [250, 60], [390, 340]]) {
      const pick = enginePick(rt, focusPickRsb(s, { width: w, height: h, viewport: { viewW: w, viewH: h }, cameraPatch: patch }), x / w, y / h)!;
      const back = project(add(pick.origin, scale(pick.dir, 500)))!;
      expect(Math.hypot(back.x - x, back.y - y)).toBeLessThan(0.01);
    }
  });

  it('a traced lens in the viewport is the frame’s: the Full view’s ray of a frame point is the render’s', async () => {
    const rt = await loadRt();
    if (!hasFocusExports(rt)) throw new Error('rt.wasm has no focus pick: npm run engine:build');
    const s0 = exampleState();
    const cam = { ...activeCamera(s0), fstop: 2, optics: { ...OPTICS_NEUTRAL, traced: { ...newTracedLens('double_gauss_fast'), distortion: 1 } } };
    const s = apply(s0, { type: 'camera/set', id: cam.id, patch: { fstop: 2, optics: cam.optics } });
    const [w, h] = [640, 400];
    const frame = { x: 24, y: (400 - 592 * (9 / 16)) / 2, width: 592, height: 592 * (9 / 16) };
    let worst = 0;
    for (const [u, v] of [[0.08, 0.1], [0.9, 0.88], [0.5, 0.5], [0.15, 0.8]]) {
      const full = enginePick(rt, focusPickRsb(s, { width: w, height: h, viewport: { viewW: w, viewH: h } }), (frame.x + u * frame.width) / w, (frame.y + v * frame.height) / h)!;
      const final = enginePick(rt, focusPickRsb(s, { width: 1920, height: 1080 }), u, v)!;
      worst = Math.max(worst, length(sub(full.dir, final.dir)));
    }
    expect(worst).toBeLessThan(1e-4);
  });

  it('a traced lens wide open focuses on the point by its own rays, millimetres from the paraxial distance', async () => {
    const rt = await loadRt();
    if (!hasFocusExports(rt)) throw new Error('rt.wasm has no focus pick: npm run engine:build');
    const { s: s0, ids } = picked();
    const optics = { ...OPTICS_NEUTRAL, traced: newTracedLens('double_gauss_fast') };
    const s = apply(s0, { type: 'camera/set', id: 'cam1', patch: { fstop: 1.4, optics } });
    const cam = activeCamera(s);
    const point = transformPoint(posedWorldMatrix(s, ids.label, null)!, cam.focusPoint!.point);
    const paraxial = projectScene(s, { width: 32, height: 18, maxSamples: 1, maxSeconds: 0 }).scene.camera.focusDist;
    expect(paraxial).toBeCloseTo(depthOf(cam, point), 3);
    setFocusSolver(focusSolverOf(rt, (c) => lensInfoRsb(c, c.aspect.w, c.aspect.h)));
    try {
      const exact = projectScene(s, { width: 32, height: 18, maxSamples: 1, maxSeconds: 0 }).scene.camera.focusDist;
      expect(exact).toBeCloseTo(engineFocusAt(rt, lensInfoRsb(cam, 16, 9), point)!, 3);
      expect(Math.abs(exact - paraxial)).toBeGreaterThan(0.5);
      // A gesture's frames take the engine's last offset for the lens instead of solving again.
      const fast = projectScene(s, { width: 32, height: 18, maxSamples: 1, maxSeconds: 0, focusFast: true }).scene.camera.focusDist;
      expect(fast).toBeCloseTo(exact, 3);
    } finally {
      setFocusSolver(null);
    }
  });

  it('a click through K3’s cameras: the Full view writes the engine’s focus for the point its ray meets', async () => {
    const rt = await loadRt();
    if (!hasFocusExports(rt)) throw new Error('rt.wasm has no focus pick: npm run engine:build');
    const s0 = exampleState();
    const ids = keyIds(s0);
    const base = activeCamera(s0);
    const patches: Partial<CameraState>[] = [
      { projection: 'ORTHOGRAPHIC' },
      { projection: 'EQUIRECTANGULAR', aspect: { preset: '2:1', w: 2, h: 1 } },
      { projection: 'FISHEYE', fisheyeFovDeg: 180 },
      { elevation: 14, straightVerticals: true },
    ];
    // A surface slanted 45° through the target, met analytically along the engine's ray.
    const { forward, right } = cameraBasis(base.azimuth, base.elevation);
    const normal = scale(add(forward, right), -Math.SQRT1_2);
    const centre = along(base, base.distance);
    const cast = (o: Vec3, d: Vec3) => {
      const k = dot(d, normal);
      const t = Math.abs(k) > 1e-9 ? dot(sub(centre, o), normal) / k : -1;
      return t > 0 ? { node: ids.label, point: add(o, scale(d, t)) } : null;
    };
    const [w, h] = [640, 400];
    const view = { width: w, height: h, viewport: { viewW: w, viewH: h } };
    for (const patch of patches) {
      const s = apply(s0, { type: 'camera/set', id: base.id, patch: { fstop: 2, ...patch } });
      let met = 0;
      for (const [u, v] of [[0.5, 0.5], [0.3, 0.42], [0.62, 0.58]]) {
        const ray = enginePick(rt, focusPickRsb(s, view), u, v)!;
        const hit = cast(ray.origin, ray.dir);
        if (!hit) continue;
        const focused = apply(s, focusPickAction(s, null, hit, { label: '' })!);
        const written = projectScene(focused, { ...view, maxSamples: 1, maxSeconds: 0 }).scene.camera.focusDist;
        const engine = engineFocusAt(rt, focusPickRsb(focused, view), hit.point)!;
        expect(Math.abs(written - engine) / engine, `${patch.projection ?? 'verticals'} (${u}, ${v})`).toBeLessThan(2e-5);
        met++;
      }
      expect(met, `${patch.projection ?? 'verticals'}: the rays met the surface`).toBeGreaterThan(1);
    }
  });

  it('a traced lens breathes: the click settles on what the pixel shows once it is in focus', async () => {
    // The field of view of a traced lens changes with its focus, so the point the first pick meets moves off the pixel
    // as the focus moves to it (some 0.9 mm of depth on a slanted surface wide open, before the settled pick).
    const rt = await loadRt();
    if (!hasFocusExports(rt)) throw new Error('rt.wasm has no focus pick: npm run engine:build');
    const s0 = exampleState();
    const ids = keyIds(s0);
    const optics = { ...OPTICS_NEUTRAL, traced: newTracedLens('double_gauss_fast') };
    const s = apply(s0, { type: 'camera/set', id: 'cam1', patch: { fstop: 1.4, focalMm: 135, optics } });
    const cam = activeCamera(s);
    // A surface slanted 45° through the target (its depth changes across the frame), met analytically.
    const { forward, right } = cameraBasis(cam.azimuth, cam.elevation);
    const normal = scale(add(forward, right), -Math.SQRT1_2);
    const centre = along(cam, cam.distance);
    const cast = (o: Vec3, d: Vec3) => {
      const t = dot(sub(centre, o), normal) / dot(d, normal);
      return t > 0 ? { node: ids.label, point: add(o, scale(d, t)) } : null;
    };
    const [w, h] = [480, 300];
    const view = { width: w, height: h, viewport: { viewW: w, viewH: h } };
    const rsbOf = (st: ProjectState) => focusPickRsb(st, view);
    const focusedOn = (st: ProjectState, hit: { node: string; point: Vec3 }) => apply(st, focusPickAction(st, null, hit, { label: '' })!);
    setFocusSolver(focusSolverOf(rt, (c) => lensInfoRsb(c, c.aspect.w, c.aspect.h)));
    try {
      const miss = (tries: number) => {
        let worst = 0;
        for (const [u, v] of [[0.12, 0.16], [0.88, 0.8]]) {
          const hit = settledFocusPick(rt, s, u, v, rsbOf, cast, focusedOn, tries)!;
          const focused = focusedOn(s, hit);
          const shown = cast(...(Object.values(enginePick(rt, rsbOf(focused), u, v)!).slice(0, 2) as [Vec3, Vec3]))!;
          const written = projectScene(focused, { ...view, maxSamples: 1, maxSeconds: 0 }).scene.camera.focusDist;
          worst = Math.max(worst, Math.abs(written - engineFocusAt(rt, lensInfoRsb(cam, 16, 9), shown.point)!));
        }
        return worst;
      };
      expect(miss(1)).toBeGreaterThan(0.3);
      expect(miss(4)).toBeLessThan(0.02);
    } finally {
      setFocusSolver(null);
    }
  }, 300000);
});

describe('the viewport camera written for the engine', () => {
  it('the frame of a camera looked through is its own (it was the active camera’s)', () => {
    let s = apply(exampleState(), { type: 'camera/add', name: 'Tall', from: 'cam1' });
    const tall = s.camera.active;
    s = apply(s, { type: 'camera/set', id: tall, patch: { aspect: { preset: '9:16', w: 9, h: 16 } } }, { type: 'camera/activate', id: 'cam1' });
    const { id: _id, ...patch } = s.camera.cameras[tall];
    const viewport = { viewW: 640, viewH: 400 };
    const written = projectScene(s, { width: 640, height: 400, maxSamples: 1, maxSeconds: 0, viewport, cameraPatch: patch }).scene.camera;
    expect(written.sensorMm).toBeCloseTo(cameraToRsb(s.camera.cameras[tall], 9, 16, 640, 400, viewport).sensorMm, 6);
    expect(written.sensorMm).not.toBeCloseTo(cameraToRsb(s.camera.cameras[tall], 16, 9, 640, 400, viewport).sensorMm, 2);
  });
});
