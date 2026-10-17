// The interior camera (phase K3, INTERIORS.md §3.4): the straight verticals (the criterion: tilted 10°, the verticals
// of a cube stay parallel to a tenth of a pixel at 1080p, in the engine's projection and in the preview's), the camera
// as it is rendered, the eye height and the interior lenses, the panoramas' map (and, with the real rt.wasm, that the
// engine's panorama shows in six directions what the map says: the preview's is checked in a browser,
// tests/panorama-browser.test.ts), the parts hidden to the camera, the exterior factor, the CAMR fields byte for byte
// with rt's, and the projects of before.

import { readFileSync, writeFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { cameraPosition, fieldOfView, makeCamera, type CameraState } from '../src/core/camera';
import { atHeight, eyeHeightOf, exteriorOf, focusDistanceFor, renderedCamera, verticalsOf } from '../src/core/interior-camera';
import { OPTICS_NEUTRAL } from '../src/core/optics';
import { fisheyeFov, panoramaDirection, panoramaFov, panoramaPoint } from '../src/core/panorama';
import { hiddenToCamera } from '../src/core/scene';
import { createInitialState, reduce, type ProjectState } from '../src/core/store';
import { VERTICALS_MAX_TILT_DEG } from '../src/data/interior-camera';
import { parseProject, serializeProject } from '../src/io/project';
import { cameraToRsb, defaultEnvironment, defaultFloor, defaultRender, INSTANCE_NO_CAMERA, projectScene, writeRsb, writesCameraK3, type RsbCamera, type RsbScene } from '../src/io/rsb';
import { perspectiveProjection, shiftNdc } from '../src/render/camera-projection';
import { readsCameras } from '../src/render/engine';
import { cameraFrame, colourClass, panoramaRoom, ROOM_WALLS } from './browser/panorama-scene';
import { k3RoomState } from './browser/k3-room-scene';
import { apply, exampleState } from './helpers';
import { readRsb, sections } from './rsb-reader';
import { fnv1a, loadRt, pinned, renderWithPasses, resolveRgb, RT_WASM } from './wasm-engine';

const K3_TESTS = 'engine/crates/rt-core/src/render/k3_tests.rs';
const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);

/** A 28 mm camera 3 m from the middle of a 600 mm cube standing on the floor, looking down at it by `tilt` degrees. */
function tilted(tilt: number, patch: Partial<CameraState> = {}): CameraState {
  return { ...makeCamera('cam1', '', 600), azimuth: 20, elevation: tilt, distance: 3000, target: [0, 0, 300], focalMm: 28, fstop: 0, focusDistance: 3000, aspect: { preset: '16:9', w: 16, h: 9 }, ...patch };
}

/** The vertical edges of the cube: bottom and top corner of each. */
const EDGES: [number, number][] = [
  [-300, -300],
  [300, -300],
  [-300, 300],
  [300, 300],
];

const sub3 = (a: readonly number[], b: readonly number[]) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot3 = (a: readonly number[], b: readonly number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross3 = (a: readonly number[], b: readonly number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: readonly number[]) => {
  const l = Math.hypot(a[0], a[1], a[2]);
  return [a[0] / l, a[1] / l, a[2] / l];
};

/**
 * Where the engine's camera (rt-core `Camera::generate_ray` and `Lens::thin_ray`, through the lens centre) puts a point
 * on a `w × h` image: the basis of position, target and up, the point on the sensor at the focal length less the lens
 * shift, the sensor's 36 mm on the longer side.
 */
function engineProject(c: RsbCamera, w: number, h: number, p: readonly number[]): [number, number] {
  const forward = unit(sub3(c.target, c.position));
  const right = unit(cross3(forward, c.up));
  const up = cross3(right, forward);
  const d = sub3(p, c.position);
  const z = dot3(d, forward);
  const aspect = w / h;
  const sensorW = aspect >= 1 ? c.sensorMm : c.sensorMm * aspect;
  const sensorH = aspect >= 1 ? c.sensorMm / aspect : c.sensorMm;
  const x = (c.focalMm * dot3(d, right)) / z - (c.lens?.shiftXMm ?? 0);
  const y = (c.focalMm * dot3(d, up)) / z - (c.lens?.shiftYMm ?? 0);
  return [(x / sensorW + 0.5) * w, (0.5 - y / sensorH) * h];
}

/** Where the Fast preview's perspective camera (render/preview.ts placeCamera, applyPerspective) puts a point on a `w × h` view showing the frame whole. */
function previewProject(cam: CameraState, w: number, h: number, p: readonly number[]): [number, number] {
  const toThree = (v: readonly number[]) => new THREE.Vector3(v[0], v[2], -v[1]);
  const three = new THREE.PerspectiveCamera();
  three.position.copy(toThree(cameraPosition(cam)));
  three.up.set(0, 1, 0);
  three.lookAt(toThree(cam.target));
  three.updateMatrixWorld();
  const fov = fieldOfView(cam.focalMm, w / h);
  const v = verticalsOf(cam);
  const shift = shiftNdc(cam.optics?.shiftXMm ?? 0, (cam.optics?.shiftYMm ?? 0) + (v?.shiftYMm ?? 0), { viewW: w, viewH: h, frameW: w, frameH: h, outAspect: w / h });
  perspectiveProjection(THREE.MathUtils.radToDeg(fov.v), w / h, 1, 1e6, shift, v ? v.correctedDeg : 0, three.projectionMatrix);
  const q = toThree(p).applyMatrix4(three.matrixWorldInverse).applyMatrix4(three.projectionMatrix);
  return [((q.x + 1) / 2) * w, ((1 - q.y) / 2) * h];
}

/** How far apart (pixels across) the bottom and the top of each vertical edge fall, the worst of the four. */
function lean(project: (p: readonly number[]) => [number, number]): number {
  let worst = 0;
  for (const [x, y] of EDGES) worst = Math.max(worst, Math.abs(project([x, y, 0])[0] - project([x, y, 600])[0]));
  return worst;
}

describe('straight verticals (the criterion: tilted 10°, ±0.1 px at 1080p)', () => {
  const W = 1920;
  const H = 1080;

  it('keeps the vertical edges of a cube parallel in the engine’s projection, and the target in the middle', () => {
    const cam = tilted(10, { straightVerticals: true });
    const rsb = cameraToRsb(cam, W, H, W, H);
    // The camera that is written is level, and its lens shifted down by f·tan 10°.
    expect(rsb.position[2]).toBeCloseTo(rsb.target[2], 6);
    expect(rsb.lens?.shiftYMm).toBeCloseTo(-28 * Math.tan((10 * Math.PI) / 180), 9);
    const straight = lean((p) => engineProject(rsb, W, H, p));
    const plain = lean((p) => engineProject(cameraToRsb(tilted(10), W, H, W, H), W, H, p));
    expect(straight).toBeLessThanOrEqual(0.1);
    expect(plain).toBeGreaterThan(6);
    const [cx, cy] = engineProject(rsb, W, H, cam.target);
    expect(Math.abs(cx - W / 2)).toBeLessThan(1e-6);
    expect(Math.abs(cy - H / 2)).toBeLessThan(1e-6);
  });

  it('and in the Fast preview’s, which agrees with the engine’s point for point', () => {
    const cam = tilted(10, { straightVerticals: true });
    expect(lean((p) => previewProject(cam, W, H, p))).toBeLessThanOrEqual(0.1);
    expect(lean((p) => previewProject(tilted(10), W, H, p))).toBeGreaterThan(6);
    const rsb = cameraToRsb(cam, W, H, W, H);
    for (const [x, y] of EDGES) {
      for (const z of [0, 600]) {
        const a = engineProject(rsb, W, H, [x, y, z]);
        const b = previewProject(cam, W, H, [x, y, z]);
        expect(Math.hypot(a[0] - b[0], a[1] - b[1]), `${x},${y},${z}`).toBeLessThan(0.01);
      }
    }
  });

  it('writes the camera of the fixture the engine checks (tests/fixtures/k3-verticals.rsb)', () => {
    // rt-core's camera tests read this file and project the cube with the engine's own rays.
    const cam = tilted(10, { straightVerticals: true });
    const scene: RsbScene = { camera: cameraToRsb(cam, W, H, W, H), materials: [], meshes: [], instances: null, lights: [], environment: defaultEnvironment(), floor: defaultFloor(), render: { ...defaultRender(), width: W, height: H }, bitmaps: [] };
    const bytes = writeRsb(scene);
    if (process.env.REPACK_WRITE_FIXTURES) writeFileSync('tests/fixtures/k3-verticals.rsb', bytes);
    expect(sameBytes(new Uint8Array(readFileSync('tests/fixtures/k3-verticals.rsb')), bytes)).toBe(true);
  });

  it('corrects up to its largest tilt, and the camera keeps the rest (no jump)', () => {
    const at = (el: number) => verticalsOf(tilted(el, { straightVerticals: true }))!;
    expect(at(10)).toMatchObject({ keepDeg: 0, correctedDeg: 10 });
    expect(at(VERTICALS_MAX_TILT_DEG + 15)).toMatchObject({ keepDeg: 15, correctedDeg: VERTICALS_MAX_TILT_DEG });
    expect(at(-50).keepDeg).toBeCloseTo(-50 + VERTICALS_MAX_TILT_DEG, 9);
    // Either side of the limit the picture is the same: the chief ray through the middle keeps pointing at the target.
    for (const el of [VERTICALS_MAX_TILT_DEG - 1e-6, VERTICALS_MAX_TILT_DEG + 1e-6, 50]) {
      const cam = tilted(el, { straightVerticals: true });
      const [cx, cy] = engineProject(cameraToRsb(cam, W, H, W, H), W, H, cam.target);
      expect(Math.hypot(cx - W / 2, cy - H / 2), `${el}`).toBeLessThan(1e-4);
    }
    // Nothing to correct: off, level, orthographic, a fisheye.
    expect(verticalsOf(tilted(10))).toBeNull();
    expect(verticalsOf(tilted(0, { straightVerticals: true }))).toBeNull();
    expect(verticalsOf(tilted(10, { straightVerticals: true, projection: 'ORTHOGRAPHIC' }))).toBeNull();
    expect(verticalsOf(tilted(10, { straightVerticals: true, projection: 'FISHEYE' }))).toBeNull();
    // An equirectangular panorama is rendered level, without a shift.
    expect(verticalsOf(tilted(10, { straightVerticals: true, projection: 'EQUIRECTANGULAR' }))).toEqual({ keepDeg: 0, correctedDeg: 10, shiftYMm: 0 });
  });

  it('renders the camera where it is: the same position and azimuth, the focus on its axis, the optics’ own shift added', () => {
    const cam = tilted(20, { straightVerticals: true, focusDistance: 2500, optics: { ...OPTICS_NEUTRAL, shiftYMm: 2, shiftXMm: 1 } });
    const r = renderedCamera(cam);
    const [p, q] = [cameraPosition(cam), cameraPosition(r)];
    for (let i = 0; i < 3; i++) expect(q[i]).toBeCloseTo(p[i], 6);
    expect(r.azimuth).toBe(cam.azimuth);
    expect(r.elevation).toBe(0);
    expect(r.focusDistance).toBeCloseTo(2500 * Math.cos((20 * Math.PI) / 180), 9);
    expect(r.optics!.shiftYMm).toBeCloseTo(2 - 28 * Math.tan((20 * Math.PI) / 180), 9);
    expect(r.optics!.shiftXMm).toBe(1);
    // Without straight verticals it is the camera itself.
    expect(renderedCamera(tilted(20))).toEqual(tilted(20));
    // A click on a point focuses the plane through it square to the rendered axis.
    const point: [number, number, number] = [100, 200, 0];
    const f = focusDistanceFor(cam, point);
    const focused = renderedCamera({ ...cam, focusDistance: f });
    const pos = cameraPosition(focused);
    const axis = unit(sub3(focused.target, pos));
    expect(dot3(sub3(point, pos), axis)).toBeCloseTo(focused.focusDistance, 6);
  });
});

describe('eye height and the interior lenses', () => {
  it('puts the camera straight up or down at a height, looking at the same point, in one undo step', () => {
    const s0 = exampleState();
    const id = s0.camera.active;
    const before = s0.camera.cameras[id];
    const s1 = apply(s0, { type: 'camera/eyeHeight', id, heightMm: 1500 });
    const cam = s1.camera.cameras[id];
    expect(eyeHeightOf(cam)).toBeCloseTo(1500, 6);
    expect(cam.target).toEqual(before.target);
    const [a, b] = [cameraPosition(before), cameraPosition(cam)];
    expect(b[0]).toBeCloseTo(a[0], 6);
    expect(b[1]).toBeCloseTo(a[1], 6);
    // A locked camera is the person's.
    const locked = apply(s0, { type: 'camera/set', id, patch: { locked: true } }, { type: 'camera/eyeHeight', id, heightMm: 1100 });
    expect(locked.camera.cameras[id]).toEqual({ ...before, locked: true });
    // The focus follows the orbit distance only if it was there.
    const away = atHeight({ ...before, focusDistance: before.distance + 100 }, 1100);
    expect(away.focusDistance).toBe(before.distance + 100);
  });

  it('puts an interior lens: 24 and 35 mm are lens presets, 28 mm a focal length', () => {
    const s0 = exampleState();
    const id = s0.camera.active;
    const c = (key: string) => apply(s0, { type: 'camera/interiorLens', id, key }).camera.cameras[id];
    expect(c('INT_24')).toMatchObject({ focalMm: 24, lens: 'WIDE' });
    expect(c('INT_28')).toMatchObject({ focalMm: 28, lens: null });
    expect(c('INT_35')).toMatchObject({ focalMm: 35, lens: 'DOC' });
    expect(apply(s0, { type: 'camera/interiorLens', id, key: 'NOPE' })).toBe(s0);
  });

  it('the elevation and the plan are orthographic views', () => {
    const s = apply(exampleState(), { type: 'camera/view', view: 'PLAN' });
    const cam = s.camera.cameras[s.camera.active];
    expect(cam.projection).toBe('ORTHOGRAPHIC');
    expect(cam.elevation).toBeCloseTo(89.9, 9);
    const e = apply(exampleState(), { type: 'camera/view', view: 'ELEVATION' }).camera.cameras[s.camera.active];
    expect([e.projection, e.elevation]).toEqual(['ORTHOGRAPHIC', 0]);
  });
});

describe('the panoramas’ map', () => {
  it('puts the six directions of an equirectangular panorama where the engine does', () => {
    // The same cases as rt-core's: the axis in the middle, the right a quarter turn on, the back at the edges, the
    // zenith and the nadir on the top and bottom rows.
    const cases: [number, number, [number, number, number]][] = [
      [0.5, 0.5, [1, 0, 0]],
      [0.75, 0.5, [0, 1, 0]],
      [0.25, 0.5, [0, -1, 0]],
      [0, 0.5, [-1, 0, 0]],
      [0.5, 0, [0, 0, 1]],
      [0.5, 1, [0, 0, -1]],
    ];
    for (const [u, v, d] of cases) {
      const got = panoramaDirection('EQUIRECTANGULAR', 360, 180, 2, u, v)!;
      for (let i = 0; i < 3; i++) expect(got[i], `${u},${v}`).toBeCloseTo(d[i], 12);
      if (u > 0 && v > 0 && v < 1) expect(panoramaPoint('EQUIRECTANGULAR', 360, 180, 2, d)).toEqual([u, v]);
    }
  });

  it('is equidistant and square for the fisheye, blind beyond half a turn, and its own inverse', () => {
    for (const [u, v] of [
      [0.5, 0.5],
      [0.8, 0.3],
      [0.1, 0.9],
    ]) {
      const d = panoramaDirection('FISHEYE', 180, 0, 1.5, u, v)!;
      expect(Math.hypot(...d)).toBeCloseTo(1, 12);
      const back = panoramaPoint('FISHEYE', 180, 0, 1.5, d)!;
      expect(back[0]).toBeCloseTo(u, 9);
      expect(back[1]).toBeCloseTo(v, 9);
    }
    // 90° from the axis at the edge of the width, as many degrees per pixel up the height.
    expect(panoramaDirection('FISHEYE', 180, 0, 1.5, 1, 0.5)![1]).toBeCloseTo(1, 12);
    expect(Math.acos(panoramaDirection('FISHEYE', 180, 0, 1.5, 0.5, 0)![0]) * (180 / Math.PI)).toBeCloseTo(60, 9);
    expect(panoramaDirection('FISHEYE', 400, 0, 1, 0, 0)).toBeNull();
  });

  it('gives the engine the fields of the output frame, and of a viewport image that covers more than it', () => {
    const cam = { ...makeCamera('c', '', 200), projection: 'EQUIRECTANGULAR' as const, aspect: { preset: '2:1' as const, w: 2, h: 1 } };
    expect(panoramaFov(cam, 2048, 1024, 2048, 1024)).toEqual({ x: 360, y: 180 });
    const out = cameraToRsb(cam, 2, 1, 2048, 1024);
    expect([out.projection, out.fovXDeg, out.fovYDeg]).toEqual([1, 360, 180]);
    // A viewport 1000 × 600 frames a 2:1 image of 952 × 476: the image spans more than a turn.
    const view = cameraToRsb(cam, 2, 1, 1000, 600, { viewW: 1000, viewH: 600 });
    expect(view.fovXDeg).toBeCloseTo((360 * 1000) / 952, 6);
    expect(view.fovYDeg).toBeCloseTo((180 * 600) / 476, 6);
    // The fisheye's field is across the frame's diagonal: 180° on 16:9 is so many degrees across the width.
    const fish = { ...cam, projection: 'FISHEYE' as const, aspect: { preset: '16:9' as const, w: 16, h: 9 } };
    expect(cameraToRsb(fish, 16, 9, 1600, 900).fovXDeg).toBeCloseTo((180 * 16) / Math.hypot(16, 9), 6);
    expect(fisheyeFov({ fisheyeFovDeg: 9999 })).toBe(360);
    expect(fisheyeFov({})).toBe(180);
    // A panorama writes no LENS (it is a pinhole), the perspective camera of before no K3 field.
    expect(cameraToRsb({ ...cam, optics: { ...OPTICS_NEUTRAL, blades: 6 } }, 2, 1, 200, 100).lens).toBeUndefined();
    expect(writesCameraK3(cameraToRsb(makeCamera('c', '', 200), 16, 9, 1600, 900))).toBe(false);
  });
});

describe('CAMR and INST: the bytes rt writes', () => {
  for (const view of ['plan', 'panorama', 'fisheye']) {
    it(`reads the K3 ${view} fixture written by rt and writes it back to the same bytes`, () => {
      const fixture = new Uint8Array(readFileSync(`tests/fixtures/k3-${view}.rsb`));
      const r = readRsb(fixture);
      expect(sections(fixture).find((s) => s.tag === 'CAMR')!.payload.byteLength).toBe(76);
      const back: RsbScene = { camera: r.camera!, materials: r.materials, meshes: r.meshes, instances: r.instances, lights: r.lights, environment: r.environment!, floor: r.floor!, render: r.render!, bitmaps: r.bitmaps };
      expect(sameBytes(writeRsb(back), fixture)).toBe(true);
    });
  }

  it('the plan fixture hides its ceiling with INST bit 2, and the page writes the flag for a part hidden to the camera', () => {
    const r = readRsb(new Uint8Array(readFileSync('tests/fixtures/k3-plan.rsb')));
    expect(r.instances!.map((i) => i.flags & INSTANCE_NO_CAMERA)).toEqual([0, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(r.camera!.exterior).toBe(0.5);
    const s0 = exampleState();
    const part = Object.values(s0.scene.nodes).find((n) => n.kind === 'PART')!.id;
    const hidden = apply(s0, { type: 'scene/setCameraHidden', ids: [part], hidden: true });
    const view = { width: 64, height: 48, maxSamples: 1, maxSeconds: 0, cameras: true };
    const flags = (s: ProjectState, v = view) => projectScene(s, v).scene.instances!.map((i) => i.flags);
    expect(flags(hidden).filter((f) => f & INSTANCE_NO_CAMERA).length).toBeGreaterThan(0);
    // Not for an engine that does not read it, and nothing without a hidden part (the bytes of before).
    expect(flags(hidden, { ...view, cameras: false }).some((f) => f & INSTANCE_NO_CAMERA)).toBe(false);
    expect(sameBytes(writeRsb(projectScene(s0, view).scene), writeRsb(projectScene(s0, { ...view, cameras: false }).scene))).toBe(true);
  });

  it('a hidden group hides what is under it, and Visible to camera is one undo step that a project keeps', async () => {
    const s0 = exampleState();
    const model = s0.scene.roots[0];
    const s1 = apply(s0, { type: 'scene/setCameraHidden', ids: [model], hidden: true });
    const parts = Object.values(s1.scene.nodes).filter((n) => n.kind === 'PART');
    expect(parts.every((p) => hiddenToCamera(s1, p.id))).toBe(true);
    expect(apply(s1, { type: 'scene/setCameraHidden', ids: [model], hidden: false }).scene.nodes[model]).toEqual(s0.scene.nodes[model]);
    const back = parseProject(await serializeProject(s1).text());
    expect(back.scene.nodes[model].cameraHidden).toBe(true);
  });

  it('the exterior factor goes in CAMR for an engine that reads it, and a project of before opens as it was', async () => {
    const s = apply(exampleState(), { type: 'env/set', patch: { exterior: 0.3 } });
    const view = { width: 64, height: 48, maxSamples: 1, maxSeconds: 0, cameras: true };
    expect(projectScene(s, view).scene.camera.exterior).toBe(0.3);
    expect(projectScene(s, { ...view, cameras: false }).scene.camera.exterior).toBeUndefined();
    expect(exteriorOf(0)).toBe(0.05);
    expect(exteriorOf(undefined)).toBe(1);
    // A project file with damaged K3 fields opens with them as they can be.
    const file = JSON.parse(await serializeProject(exampleState()).text());
    const cam = file.state.camera.cameras[file.state.camera.active];
    Object.assign(cam, { projection: 'CYLINDER', straightVerticals: 'yes', fisheyeFovDeg: 9000 });
    file.state.environment.exterior = 'bright';
    file.state.image.exposureMode = 'SOMETIMES';
    const opened = parseProject(JSON.stringify(file));
    const c = opened.camera.cameras[opened.camera.active];
    expect([c.projection, c.straightVerticals, c.fisheyeFovDeg]).toEqual(['PERSPECTIVE', undefined, 360]);
    expect(opened.environment.exterior).toBeUndefined();
    expect(opened.image.exposureMode).toBeUndefined();
  });

  it('the engine says whether it reads the interior cameras (rt_features bit 4)', () => {
    expect(readsCameras(16)).toBe(true);
    expect(readsCameras(15)).toBe(false);
    expect(readsCameras(undefined)).toBe(false);
  });
});

describe('the scene type Interior', () => {
  it('turns the straight verticals and the automatic exposure on, and switching back leaves the project as it was', () => {
    const s0 = createInitialState();
    const s1 = reduce(s0, { type: 'scene/setType', sceneType: 'INTERIOR' });
    const cam = s1.camera.cameras[s1.camera.active];
    expect(cam.straightVerticals).toBe(true);
    expect(s1.image.exposureMode).toBe('AUTO');
    const s2 = reduce(s1, { type: 'scene/setType', sceneType: 'PRODUCT' });
    expect(s2.camera).toEqual(s0.camera);
    expect(s2.image).toEqual(s0.image);
    // What the person turned off in between stays off.
    const touched = reduce(reduce(s1, { type: 'camera/set', id: s1.camera.active, patch: { straightVerticals: false } }), { type: 'scene/setType', sceneType: 'PRODUCT' });
    expect(touched.camera.cameras[s1.camera.active].straightVerticals).toBe(false);
    expect(touched.image.exposureMode).toBeUndefined();
  });
});

describe.skipIf(!RT_WASM)('the real rt.wasm', () => {
  for (const view of ['plan', 'panorama', 'fisheye']) {
    it(`renders the K3 ${view} fixture to the native engine’s pinned hash`, async () => {
      const rt = await loadRt();
      const rsb = new Uint8Array(readFileSync(`tests/fixtures/k3-${view}.rsb`));
      const r = readRsb(rsb);
      const { image } = renderWithPasses(rt, rsb, r.render!.width, r.render!.height, 4, 0);
      expect(fnv1a(resolveRgb(image, 4)).toString(16)).toBe(pinned(K3_TESTS, `PINNED_K3_${view.toUpperCase()}_4SPP`).toString(16));
    }, 120000);
  }

  it('shows in six directions of its equirectangular panorama the wall the page’s map says, and of its fisheye five', async () => {
    // The page writes a cube room of six glowing walls with the camera in the middle, turned 30°: each world axis
    // falls where core/panorama.ts puts it (the map the preview's pass draws with), and the engine's pixel there has
    // that wall's colour. The preview's own panorama is checked the same way in Chromium (panorama-browser.test.ts).
    const rt = await loadRt();
    for (const [projection, w, h, dirs] of [
      ['EQUIRECTANGULAR', 128, 64, ROOM_WALLS.map((x) => x.key)],
      ['FISHEYE', 96, 64, ['+X', '-X', '+Y', '+Z', '-Z']],
    ] as const) {
      const state = panoramaRoom({ projection, azimuth: 30, aspect: projection === 'FISHEYE' ? { preset: '3:2', w: 3, h: 2 } : { preset: '2:1', w: 2, h: 1 }, fisheyeFovDeg: 360 });
      const scene = projectScene({ ...state, image: { ...state.image, viewTransform: 'STANDARD' } }, { width: w, height: h, maxSamples: 1, maxSeconds: 0, cameras: true }).scene;
      const cam = state.camera.cameras[state.camera.active];
      const fov = panoramaFov(cam, w, h, w, h);
      const { image } = renderWithPasses(rt, writeRsb(scene), w, h, 1, 0);
      const rgb = resolveRgb(image, 1);
      for (const key of dirs) {
        const wall = ROOM_WALLS.find((x) => x.key === key)!;
        const at = panoramaPoint(projection, fov.x, fov.y, w / h, cameraFrame(cam, wall.dir));
        expect(at, `${projection} ${key}`).not.toBeNull();
        const x = Math.min(w - 1, Math.floor(at![0] * w));
        const y = Math.min(h - 1, Math.floor(at![1] * h));
        const i = 3 * (y * w + x);
        expect(colourClass(rgb[i], rgb[i + 1], rgb[i + 2]), `${projection} ${key} at ${x},${y}`).toBe(wall.cls);
      }
    }
  }, 120000);
});

describe('the room of the browser check', () => {
  it('is the project file tools/k3-check.mjs opens (tests/fixtures/k3-room.repack.json), as the builder makes it now', async () => {
    const text = await serializeProject(k3RoomState()).text();
    if (process.env.REPACK_WRITE_FIXTURES) writeFileSync('tests/fixtures/k3-room.repack.json', text);
    const saved = parseProject(readFileSync('tests/fixtures/k3-room.repack.json', 'utf8'));
    const now = parseProject(text);
    expect(saved.scene.nodes).toEqual(now.scene.nodes);
    expect(saved.camera).toEqual(now.camera);
    expect(saved.scene.type).toBe('INTERIOR');
    // The camera stands 1.5 m up inside the room, tilted 10° down, its verticals left for the check to straighten.
    const cam = saved.camera.cameras[saved.camera.active];
    expect(eyeHeightOf(cam)).toBeCloseTo(1500, 3);
    expect(cam.straightVerticals).not.toBe(true);
  });
});
